/**
 * Where the health questions go, and the "later" rules (2026-10-08): `npx tsx scripts/test-call-placement.ts`
 *
 * Part A: pure logic (the call-length estimate, which call carries "How are you feeling?" + the day's health question).
 * Part B: the dispatcher against THROWAWAY rows (`placement-test-*@example.com`) with a fake Sarvam and a fake clock:
 *         a heavy morning moves the questions to the afternoon, a light morning keeps them, a call that never happened
 *         hands them to a later call, "later" tablets are asked again on the next call (no extra follow-up calls) and
 *         still "later" on the last call of the day is a missed-medicine alert.
 */
import 'dotenv/config';
import './lib/testDb';
import { prisma } from '../src/lib/prisma';
import { newId } from '../src/lib/db';
import { SarvamConfig, buildAgentVariables } from '../src/lib/sarvam';
import { runDispatch } from '../src/lib/callDispatch';
import { processSarvamWebhook, RETRY_DELAY_MINUTES, maxFollowUpsPerDay } from '../src/lib/callResults';
import {
  chooseHealthSlot, healthCarryFor, slotSeconds, planCallExtras, SlotLoad,
  CALL_BASE_SECONDS, PER_MEDICINE_SECONDS, HEALTH_BUNDLE_SECONDS, CALL_BUDGET_SECONDS, HEALTH_TAKEOVER_AFTER_MINUTES
} from '../src/lib/callPlanning';
import { LinkedMedicineDetail } from '../src/lib/types';
import { PLANS, healthMonitorPrice, healthMonitorListPrice, monthlyPrice, healthMonitorAvailable, cleanAddons, carriedPeriod, firmCallLimit } from '../src/lib/plans';
import { updateUserSubscription } from '../src/lib/db';
import { ownerHasHealthMonitor, canTrackReadings, isPremiumParent } from '../src/lib/planAccess';
import { callLength } from '../src/lib/adminStats';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail !== undefined ? '  →  ' + JSON.stringify(detail) : ''}`);
  }
}

const load = (id: string, minutes: number, medicines: number, typicalSeconds: number | null = null): SlotLoad => ({ id, minutes, medicines, typicalSeconds });

function partA() {
  console.log('\nA1. Call-length estimate');
  check('estimate = greeting + tablets', slotSeconds(load('a', 510, 3)) === CALL_BASE_SECONDS + 3 * PER_MEDICINE_SECONDS);
  check('real average beats the estimate', slotSeconds(load('a', 510, 5, 31)) === 31);
  check('3 tablets + the health pair fit a minute; 4 do not', slotSeconds(load('a', 510, 3)) + HEALTH_BUNDLE_SECONDS <= CALL_BUDGET_SECONDS && slotSeconds(load('a', 510, 4)) + HEALTH_BUNDLE_SECONDS > CALL_BUDGET_SECONDS);

  console.log('\nA2. Which call carries the health questions');
  const day = [load('morning', 510, 4), load('afternoon', 780, 1), load('evening', 1260, 2)];
  check('heavy morning (4 tablets): the afternoon call', chooseHealthSlot(day)?.id === 'afternoon' && chooseHealthSlot(day)?.carry === 'full');
  check('light morning (2 tablets): the morning call', chooseHealthSlot([load('morning', 510, 2), ...day.slice(1)])?.id === 'morning');
  check('earliest that fits, not the lightest', chooseHealthSlot([load('morning', 510, 3), load('afternoon', 780, 0)])?.id === 'morning');
  check('nothing fits: only "How are you feeling?" on the lightest call', (() => {
    const c = chooseHealthSlot([load('m', 510, 6), load('a', 780, 5), load('e', 1260, 7)]);
    return c?.id === 'a' && c.carry === 'feeling';
  })());
  check('a chatty parent: the real average moves it', chooseHealthSlot([load('morning', 510, 1, 48), load('afternoon', 780, 1, 20)])?.id === 'afternoon');
  check('a quiet parent with many tablets: the real average lets the morning carry it', chooseHealthSlot([load('morning', 510, 5, 30), load('afternoon', 780, 1)])?.id === 'morning');
  check('one call a day', chooseHealthSlot([load('only', 600, 2)])?.id === 'only' && chooseHealthSlot([])?.id === undefined);

  console.log('\nA3. What each call carries today');
  const carry = (slotId: string, nowMinutes: number, asked = false) => healthCarryFor({ loads: day, slotId, feelingAskedToday: asked, nowMinutes });
  check('chosen call: full; the others: none (once asked)', carry('afternoon', 790) === 'full' && carry('morning', 520) === 'none' && carry('evening', 1265, true) === 'none');
  check('already asked today: nothing more', carry('afternoon', 790, true) === 'none');
  check('the chosen call never happened: a later one takes over after 2 hours', carry('evening', 780 + HEALTH_TAKEOVER_AFTER_MINUTES + 5) === 'full' && carry('evening', 780 + 60) === 'none');
  check('the morning never takes over from the afternoon', carry('morning', 1300) === 'none');
  check('no slot (test / manual call): nothing', healthCarryFor({ loads: day, slotId: null, feelingAskedToday: false, nowMinutes: 600 }) === 'none');

  console.log('\nA4. planCallExtras follows the carry');
  const base = {
    callType: 'reminder' as const, rhythm: { parentConsent: 'given', lastSafetyLineAt: new Date(), lastWellbeingAt: null, lastRefillCheckAt: new Date(), birthDate: null },
    lastAnswered: null, activeMedicineNames: ['A'], answeredToday: false, now: new Date('2026-10-12T03:30:00Z')
  };
  const none = planCallExtras({ ...base, healthCarry: 'none' });
  const full = planCallExtras({ ...base, healthCarry: 'full' });
  const feeling = planCallExtras({ ...base, healthCarry: 'feeling' });
  check('none: no questions', !none.askFeeling && !none.wellbeingTopic);
  check('full: feeling + one health question', !!full.askFeeling && !!full.wellbeingTopic);
  check('feeling: only "How are you feeling?"', !!feeling.askFeeling && !feeling.wellbeingTopic && feeling.refillMedicines.length === 0);
  const consentCall = planCallExtras({ ...base, rhythm: { ...base.rhythm, parentConsent: null }, healthCarry: 'full' });
  check('permission call: only permission + safety line + tablets (health questions move on)', consentCall.askConsent && !consentCall.askFeeling && !consentCall.wellbeingTopic && consentCall.refillMedicines.length === 0 && !consentCall.lastCallNote, consentCall);
  const noMonitor = planCallExtras({ ...base, rhythm: { ...base.rhythm, lastSafetyLineAt: null, lastRefillCheckAt: null }, healthCarry: 'full', healthQuestions: false, lastAnswered: { createdAt: new Date('2026-10-11T03:30:00Z'), healthConcern: 'knee pain', pain: null, painWhere: null } });
  check('no Health Monitor: tablets only (no feeling, health question, refill or "is it better?")', !noMonitor.askFeeling && !noMonitor.wellbeingTopic && noMonitor.refillMedicines.length === 0 && !noMonitor.lastCallNote, noMonitor);
  check('no Health Monitor: no weekly safety line, only on the first (permission) call', !noMonitor.saySafetyLine && planCallExtras({ ...base, rhythm: { ...base.rhythm, parentConsent: null, lastSafetyLineAt: null }, healthQuestions: false }).saySafetyLine);
  check('old rule still there when nothing is decided', !!planCallExtras(base).askFeeling && !planCallExtras({ ...base, answeredToday: true }).askFeeling);
  check('retry gap is 30 minutes, no extra follow-up calls by default', RETRY_DELAY_MINUTES === 30 && maxFollowUpsPerDay() === 0);

  console.log('\nA5. Admin: what the calls really cost');
  const len = callLength([{ status: 'answered', durationSeconds: 45 }, { status: 'answered', durationSeconds: 75 }, { status: 'unanswered', durationSeconds: 0 }, { status: 'answered', durationSeconds: 0 }]);
  check('average length, billed minutes (every started minute), share over 60 s, monthly cost', len.calls === 2 && len.avgSeconds === 60 && len.avgBilledMinutes === 1.5 && len.over60Pct === 50 && len.estMonthlyCostPerParent === 662, len);
  check('no timed calls yet: nothing invented', callLength([]).avgBilledMinutes === null);

  console.log('\nA6. Changing plan inside a paid period: no double charge');
  const nowD = new Date('2026-10-10T06:00:00Z');
  const sub = (over: Record<string, unknown> = {}) => ({
    planId: 'solo' as const, status: 'active', currentPeriodEnd: new Date('2026-10-25T06:00:00Z').toISOString(), cancelAtPeriodEnd: false, razorpaySubscriptionId: 'sub_x', ...over
  });
  const c = carriedPeriod(sub(), nowD);
  check('paid and running: the new plan\'s first charge waits for the end of the period', c?.periodEnd.toISOString() === '2026-10-25T06:00:00.000Z' && c.status === 'active' && c.trialEndsAt === null, c);
  const ct = carriedPeriod(sub({ status: 'trialing', trialEndsAt: '2026-10-14T06:00:00.000Z', currentPeriodEnd: '2026-10-14T06:00:00.000Z' }), nowD);
  check('still on the 7-day trial: the trial is kept, not restarted or charged now', ct?.status === 'trialing' && ct.trialEndsAt?.toISOString() === '2026-10-14T06:00:00.000Z', ct);
  check('nothing to carry: no subscription, no Razorpay id, cancelled, failing, free, or under a day left', [
    carriedPeriod(null, nowD), carriedPeriod(sub({ razorpaySubscriptionId: undefined }), nowD), carriedPeriod(sub({ cancelAtPeriodEnd: true }), nowD),
    carriedPeriod(sub({ status: 'cancelled' }), nowD), carriedPeriod(sub({ status: 'past_due' }), nowD), carriedPeriod(sub({ planId: 'free', status: 'free' }), nowD),
    carriedPeriod(sub({ currentPeriodEnd: '2026-10-10T20:00:00.000Z' }), nowD)
  ].every(x => x === null));

  console.log('\nA7. Plans and the Health Monitor add-on');
  check('Solo ₹899, 10 Ask questions, 3 calls a day', PLANS.solo.priceMonthly === 899 && PLANS.solo.askPerMonth === 10 && PLANS.solo.callsPerDay === 3);
  check('launch offer: Remind 149 -> 99, Solo 999 -> 899, Family 1,999 -> 1,699, Extended 4,999 -> 3,999', PLANS.essential.priceMonthly === 99 && PLANS.essential.listPrice === 149 &&
    PLANS.solo.listPrice === 999 && PLANS.family.listPrice === 1999 && PLANS.extended.listPrice === 4999 && PLANS.free.listPrice === undefined);
  check('Health Monitor ₹249 Solo (was ₹299) / ₹499 Family / ₹999 Extended; none on Remind or Free', healthMonitorPrice('solo') === 249 && healthMonitorListPrice('solo') === 299 && healthMonitorListPrice('family') === undefined && healthMonitorPrice('family') === 499 && healthMonitorPrice('extended') === 999 && !healthMonitorAvailable('essential') && !healthMonitorAvailable('free'));
  check('firm call limit (wrap up ~90 s) on Family and Extended only', firmCallLimit('family') && firmCallLimit('extended') && !firmCallLimit('solo') && !firmCallLimit('essential'));
  {
    const base = { callLogId: 'c', parentId: 'p', slot: 'morning', slotLabel: 'Morning', parentName: 'Amma', parentPhone: '+919999999999', language: 'Telugu', caregiverName: 'Ravi', relationship: 'mother', medicines: [] };
    const partner = { name: 'Appa', medicines: [], askReadings: [] };
    check('firm_time_limit: yes (one parent) / couple (couple call) / no (Solo)',
      buildAgentVariables({ ...base, firmTimeLimit: true }).firm_time_limit === 'yes' &&
      buildAgentVariables({ ...base, firmTimeLimit: true, partner }).firm_time_limit === 'couple' &&
      buildAgentVariables({ ...base, firmTimeLimit: false, partner }).firm_time_limit === 'no');
  }
  check('Family ₹1,699, 2 parents, 2 WhatsApp people, 20 Ask', PLANS.family.priceMonthly === 1699 && PLANS.family.parentsIncluded === 2 && PLANS.family.whatsappPeople === 2 && PLANS.family.askPerMonth === 20);
  check('Extended ₹3,999, 5 parents, 5 WhatsApp people, 30 Ask; ₹800 a parent, cheaper per parent than Family and Solo', PLANS.extended.priceMonthly === 3999 && PLANS.extended.parentsIncluded === 5 && PLANS.extended.whatsappPeople === 5 && PLANS.extended.askPerMonth === 30 &&
    PLANS.extended.priceMonthly / 5 < PLANS.family.priceMonthly / 2 && PLANS.family.priceMonthly / 2 < PLANS.solo.priceMonthly);
  check('Extended totals: 3,999 / with Health Monitor 4,998', monthlyPrice('extended', false) === 3999 && monthlyPrice('extended', true) === 4998);
  check('Family is cheaper than two Solo plans', PLANS.family.priceMonthly < 2 * PLANS.solo.priceMonthly && PLANS.family.priceMonthly < 1800);
  check('monthly totals: Solo 899 / +monitor 1,148; Family 1,699 / 2,198', monthlyPrice('solo', false) === 899 && monthlyPrice('solo', true) === 1148 &&
    monthlyPrice('family', false) === 1699 && monthlyPrice('family', true) === 2198 && monthlyPrice('family', { healthMonitor: true }) === 2198);
  check('add-ons ignored where not offered (Remind)', monthlyPrice('essential', true) === PLANS.essential.priceMonthly && !cleanAddons('essential', { healthMonitor: true }).healthMonitor);
}

function fakeConfig(): SarvamConfig {
  return {
    apiKey: 'test-key', orgId: 'org_1', workspaceId: 'ws_1', appId: 'app_1', appVersion: 2, connectionId: 'conn_1',
    agentPhoneNumber: '+910000000000', apiBase: 'http://sarvam.test/api/outbounds', webhookSecret: 's3cret', appUrl: 'http://app.test'
  };
}

interface FakeCall { attemptId: string; vars: Record<string, string> }
function makeFakeSarvam() {
  const calls: FakeCall[] = [];
  let n = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    n += 1;
    const attemptId = `att_place_${Date.now()}_${n}`;
    calls.push({ attemptId, vars: JSON.parse(String(init.body)).app_config.agent_variables });
    return new Response(JSON.stringify({ attempt_id: attemptId }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

async function partB() {
  console.log('\nB. Dispatcher against throwaway database rows');
  const stamp = Date.now();
  const emails: string[] = [];
  const alertDeps = { whatsapp: null, sendEmail: (async (p: { to: string }) => { emails.push(p.to); return { success: true, simulated: true }; }) as never };
  const user = await prisma.user.create({
    data: {
      id: newId('usr'), name: 'Placement Tester', email: `placement-test-${stamp}@example.com`, phone: null,
      subscription: { create: { id: newId('sub'), planId: 'family', status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 864e5), amount: 2198, healthMonitor: true } },
      notificationPreferences: { create: {} }
    }
  });
  try {
    const med = (name: string): LinkedMedicineDetail => ({ name, dosage: '1 tab', foodRelation: 'after_food', questionScript: `Did you take your ${name}?` });
    const make = async (name: string, phone: string, slots: Array<{ time: string; slot: string; meds: string[] }>) => {
      const all = [...new Set(slots.flatMap(s => s.meds))];
      return prisma.parentProfile.create({
        data: {
          id: newId('parent'), userId: user.id, name, relationship: 'Mother', phone, language: 'English', callTime: slots[0].time, consentGiven: true,
          parentConsent: 'given', createdAt: new Date(Date.UTC(2026, 8, 20)),
          lastSafetyLineAt: new Date(Date.UTC(2026, 9, 11)), lastRefillCheckAt: new Date(Date.UTC(2026, 9, 11)),
          callSchedule: { create: slots.map(s => ({ id: newId('slot'), time: s.time, slot: s.slot, label: `${s.slot} check`, linkedMedicineNames: s.meds, linkedMedicinesJson: JSON.stringify(s.meds.map(med)) })) },
          medicines: { create: all.map(n => ({ id: newId('med'), name: n, dosage: '1 tab', timeOfDay: 'morning', timingSlots: ['morning'], foodRelation: 'after_food', frequency: 'daily' })) }
        }
      });
    };
    // Heavy morning (4 tablets), light afternoon (1), evening (2).
    const heavy = await make('Heavy Morning', '+919000022001', [
      { time: '08:30 AM', slot: 'morning', meds: ['Aspirin A', 'Bpill B', 'Cpill C', 'Dpill D'] },
      { time: '01:00 PM', slot: 'afternoon', meds: ['Calcium'] },
      { time: '09:00 PM', slot: 'bedtime', meds: ['Eone', 'Etwo'] }
    ]);
    // Light morning (2 tablets): the morning keeps the questions.
    const light = await make('Light Morning', '+919000022002', [
      { time: '08:30 AM', slot: 'morning', meds: ['Lone', 'Ltwo'] },
      { time: '01:00 PM', slot: 'afternoon', meds: ['Lthree'] },
      { time: '09:00 PM', slot: 'bedtime', meds: ['Lfour'] }
    ]);
    const cfg = fakeConfig();
    const utc = (day: number, hh: number, mm: number) => new Date(Date.UTC(2026, 9, day, hh, mm));
    // 09:00 IST = 03:30Z, 01:10 PM IST = 07:40Z, 09:05 PM IST = 15:35Z
    const answer = (attemptId: string, vars: Record<string, string>, at: Date, duration = 40) =>
      processSarvamWebhook({
        attempt_id: attemptId, status: 'connected', duration, final_agent_variables: { mood: 'calm', ...vars },
        interaction_transcript: [{ role: 'agent', en_text: 'Hello' }, { role: 'user', en_text: 'yes I took it' }]
      }, { now: at, deps: alertDeps });
    const forParent = (calls: FakeCall[], name: string) => calls.filter(c => c.vars.parent_name?.startsWith(name.split(' ')[0]));

    console.log('\nB1. Heavy morning: the questions move to the afternoon');
    const s1 = makeFakeSarvam();
    await runDispatch({ now: utc(12, 3, 30), fetchImpl: s1.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id, light.id] });
    const heavyMorning = forParent(s1.calls, 'Heavy')[0];
    const lightMorning = forParent(s1.calls, 'Light')[0];
    check('both mornings are called', !!heavyMorning && !!lightMorning, s1.calls.map(c => c.vars.parent_name));
    check('heavy morning: no health questions', heavyMorning?.vars.ask_feeling === 'no' && heavyMorning.vars.wellbeing_topic === 'none', heavyMorning?.vars);
    check('light morning: "How are you feeling?" + one health question', lightMorning?.vars.ask_feeling === 'yes' && ['sleep', 'appetite', 'pain'].includes(lightMorning.vars.wellbeing_topic), lightMorning?.vars);
    await answer(heavyMorning.attemptId, { all_medicines_taken: 'yes' }, utc(12, 3, 40));
    await answer(lightMorning.attemptId, { all_medicines_taken: 'yes', sleep: 'good' }, utc(12, 3, 41));
    await runDispatch({ now: utc(12, 7, 40), fetchImpl: s1.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id, light.id] });
    const heavyNoon = forParent(s1.calls, 'Heavy')[1];
    const lightNoon = forParent(s1.calls, 'Light')[1];
    check('heavy afternoon carries the questions', heavyNoon?.vars.ask_feeling === 'yes' && ['sleep', 'appetite', 'pain'].includes(heavyNoon.vars.wellbeing_topic), heavyNoon?.vars);
    check('light afternoon: nothing more (asked in the morning)', lightNoon?.vars.ask_feeling === 'no' && lightNoon.vars.wellbeing_topic === 'none');
    await answer(heavyNoon.attemptId, { all_medicines_taken: 'yes', sleep: 'good' }, utc(12, 7, 50));
    await runDispatch({ now: utc(12, 15, 35), fetchImpl: s1.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
    const heavyNight = forParent(s1.calls, 'Heavy')[2];
    check('heavy evening: already asked today', heavyNight?.vars.ask_feeling === 'no' && heavyNight.vars.wellbeing_topic === 'none');

    console.log('\nB2. The chosen call never happens: a later call takes the questions');
    const s2 = makeFakeSarvam();
    await runDispatch({ now: utc(13, 3, 30), fetchImpl: s2.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
    const noonCall = (await (async () => {
      await runDispatch({ now: utc(13, 7, 40), fetchImpl: s2.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
      return s2.calls[s2.calls.length - 1];
    })());
    check('the afternoon call (chosen) carries them on the first attempt', noonCall?.vars.ask_feeling === 'yes', noonCall?.vars);
    await processSarvamWebhook({ attempt_id: noonCall.attemptId, status: 'no_answer' }, { now: utc(13, 7, 45), deps: alertDeps });
    const retryAt = (await prisma.callLog.findFirst({ where: { parentId: heavy.id, callDate: '2026-10-13', slot: 'afternoon', attemptNumber: 1 } }))?.nextRetryAt;
    check('retry is 30 minutes later', retryAt?.getTime() === utc(13, 8, 15).getTime(), retryAt);
    await runDispatch({ now: utc(13, 8, 16), fetchImpl: s2.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
    const noonRetry = s2.calls[s2.calls.length - 1];
    check('the retry of the chosen call carries them too', noonRetry?.vars.ask_feeling === 'yes', noonRetry?.vars);
    await processSarvamWebhook({ attempt_id: noonRetry.attemptId, status: 'no_answer' }, { now: utc(13, 8, 20), deps: alertDeps });
    await runDispatch({ now: utc(13, 15, 35), fetchImpl: s2.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
    const nightTakeover = s2.calls[s2.calls.length - 1];
    check('the evening call takes them over (2 tablets, fits)', nightTakeover?.vars.ask_feeling === 'yes' && nightTakeover.vars.wellbeing_topic !== 'none', nightTakeover?.vars);

    console.log('\nB3. "Later": asked again on the next call, no extra call, alert on the last call');
    const s3 = makeFakeSarvam();
    await runDispatch({ now: utc(14, 3, 30), fetchImpl: s3.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
    const m = s3.calls[0];
    const r3 = await answer(m.attemptId, { all_medicines_taken: 'partial', medicines_taken: 'Bpill B, Cpill C, Dpill D', medicines_later: 'Aspirin A' }, utc(14, 3, 40));
    check('no follow-up call is scheduled', r3.status === 'processed' && !(r3 as { followUpAt?: string | null }).followUpAt, r3);
    check('no missed-medicine alert yet', (await prisma.alertRecord.count({ where: { parentId: heavy.id, title: 'Missed medicine' } })) === 0);
    const followUps = await runDispatch({ now: utc(14, 4, 20), fetchImpl: s3.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
    check('nothing placed in between', followUps.followUps === 0 && s3.calls.length === 1, followUps);
    await runDispatch({ now: utc(14, 7, 40), fetchImpl: s3.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
    const noon = s3.calls[1];
    check('afternoon call asks about Calcium AND Aspirin A again', noon?.vars.medicines_checklist.includes('Calcium') && noon.vars.medicines_checklist.includes('Aspirin A'), noon?.vars.medicines_checklist);
    await answer(noon.attemptId, { all_medicines_taken: 'partial', medicines_taken: 'Calcium', medicines_later: 'Aspirin A' }, utc(14, 7, 50));
    await runDispatch({ now: utc(14, 15, 35), fetchImpl: s3.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
    const night = s3.calls[2];
    check('evening call still asks about Aspirin A', night?.vars.medicines_checklist.includes('Aspirin A') && night.vars.medicines_checklist.includes('Eone'), night?.vars.medicines_checklist);
    await answer(night.attemptId, { all_medicines_taken: 'partial', medicines_taken: 'Eone, Etwo', medicines_later: 'Aspirin A' }, utc(14, 15, 45));
    const missed = await prisma.alertRecord.findFirst({ where: { parentId: heavy.id, title: 'Missed medicine' } });
    check('still "later" on the last call of the day: missed-medicine alert', !!missed && missed.message.includes('Aspirin A') && missed.message.includes('by the last call of the day'), missed?.message);

    console.log('\nB4. Taken after "later": not asked again');
    const s4 = makeFakeSarvam();
    await runDispatch({ now: utc(15, 3, 30), fetchImpl: s4.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
    await answer(s4.calls[0].attemptId, { all_medicines_taken: 'partial', medicines_taken: 'Bpill B, Cpill C, Dpill D', medicines_later: 'Aspirin A' }, utc(15, 3, 40));
    await runDispatch({ now: utc(15, 7, 40), fetchImpl: s4.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
    await answer(s4.calls[1].attemptId, { all_medicines_taken: 'yes', medicines_taken: 'Calcium, Aspirin A' }, utc(15, 7, 50));
    await runDispatch({ now: utc(15, 15, 35), fetchImpl: s4.fetchImpl, config: cfg, alertDeps, parentIds: [heavy.id] });
    check('evening call leaves Aspirin A out', !s4.calls[2]?.vars.medicines_checklist.includes('Aspirin A') && s4.calls[2].vars.medicines_checklist.includes('Eone'), s4.calls[2]?.vars.medicines_checklist);

    console.log('\nB5. Solo + Health Monitor: BP / sugar on a short call of its own');
    const solo = await prisma.user.create({
      data: {
        id: newId('usr'), name: 'Monitor Tester', email: `placement-test-solo-${stamp}@example.com`, phone: null,
        subscription: { create: { id: newId('sub'), planId: 'solo', status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 864e5), amount: 899 } },
        notificationPreferences: { create: {} }
      }
    });
    const soloParent = await prisma.parentProfile.create({
      data: {
        id: newId('parent'), userId: solo.id, name: 'Solo Amma', relationship: 'Mother', phone: '+919000022003', language: 'English', callTime: '08:30 AM', consentGiven: true,
        parentConsent: 'given', createdAt: new Date(Date.UTC(2026, 8, 20)), readingsToAsk: ['bp', 'sugar'],
        lastSafetyLineAt: new Date(Date.UTC(2026, 9, 11)), lastRefillCheckAt: new Date(Date.UTC(2026, 9, 11)),
        callSchedule: {
          create: [
            { id: newId('slot'), time: '07:30 AM', slot: 'wellness', label: 'Health readings', linkedMedicineNames: [], linkedMedicinesJson: '[]' },
            { id: newId('slot'), time: '08:30 AM', slot: 'morning', label: 'morning check', linkedMedicineNames: ['Sone', 'Stwo'], linkedMedicinesJson: JSON.stringify([med('Sone'), med('Stwo')]) },
            { id: newId('slot'), time: '01:00 PM', slot: 'afternoon', label: 'afternoon check', linkedMedicineNames: ['Sthree'], linkedMedicinesJson: JSON.stringify([med('Sthree')]) },
            { id: newId('slot'), time: '09:00 PM', slot: 'bedtime', label: 'evening check', linkedMedicineNames: ['Sfour'], linkedMedicinesJson: JSON.stringify([med('Sfour')]) }
          ]
        },
        medicines: { create: ['Sone', 'Stwo', 'Sthree', 'Sfour'].map(n => ({ id: newId('med'), name: n, dosage: '1 tab', timeOfDay: 'morning', timingSlots: ['morning'], foodRelation: 'after_food', frequency: 'daily' })) }
      }
    });
    check('without the add-on: not Health Monitor, no readings', !(await ownerHasHealthMonitor(solo.id)) && !(await canTrackReadings(solo.id)) && !(await isPremiumParent(solo.id)));
    const noAddon = makeFakeSarvam();
    const r5a = await runDispatch({ now: utc(16, 2, 10), fetchImpl: noAddon.fetchImpl, config: cfg, alertDeps, parentIds: [soloParent.id] });
    check('without the add-on a 4th call (the no-tablet one) is over the cap of 3', r5a.cappedByPlan === 1, r5a);
    await prisma.userSubscription.update({ where: { userId: solo.id }, data: { healthMonitor: true, amount: 1148 } });
    check('with the add-on: Health Monitor yes, Family features (couple call, timeline) no', (await ownerHasHealthMonitor(solo.id)) && (await canTrackReadings(solo.id)) && !(await isPremiumParent(solo.id)));
    const withAddon = makeFakeSarvam();
    await runDispatch({ now: utc(17, 2, 10), fetchImpl: withAddon.fetchImpl, config: cfg, alertDeps, parentIds: [soloParent.id] }); // 07:40 IST
    const vitals = withAddon.calls[0];
    check('07:40 IST: the readings call asks for BP and sugar, no tablets', !!vitals && /BP/i.test(vitals.vars.ask_readings) && /sugar/i.test(vitals.vars.ask_readings) && vitals.vars.has_medicines === 'no', vitals?.vars);
    await answer(vitals.attemptId, { all_medicines_taken: 'not_asked' }, utc(17, 2, 20), 30);
    const r5b = await runDispatch({ now: utc(17, 3, 40), fetchImpl: withAddon.fetchImpl, config: cfg, alertDeps, parentIds: [soloParent.id] }); // 09:10 IST
    const soloMorning = withAddon.calls[1];
    check('the 4th call is not over the cap with the add-on', r5b.cappedByPlan === 0, r5b);
    check('the morning medicine call does NOT ask for readings', !!soloMorning && soloMorning.vars.ask_readings === 'none' && soloMorning.vars.has_medicines === 'yes', soloMorning?.vars);
    check('and the questions go on the earliest medicine call that fits (the morning, 2 tablets)', soloMorning?.vars.ask_feeling === 'yes', soloMorning?.vars.ask_feeling);
    // Every 3 days (family's choice): readings on the 17th cover the 18th and 19th; the 20th rings again.
    await prisma.parentProfile.update({ where: { id: soloParent.id }, data: { readingsEveryDays: 3 } });
    await prisma.healthReading.createMany({ data: [
      { parentId: soloParent.id, kind: 'bp', systolic: 130, diastolic: 85, takenAt: utc(17, 2, 15), source: 'family' },
      { parentId: soloParent.id, kind: 'sugar', value: 140, takenAt: utc(17, 2, 15), source: 'family' }
    ] });
    const every3 = makeFakeSarvam();
    await runDispatch({ now: utc(19, 2, 10), fetchImpl: every3.fetchImpl, config: cfg, alertDeps, parentIds: [soloParent.id] }); // 19th 07:40 IST
    check('every 3 days: no readings call 2 days after a reading', every3.calls.length === 0, every3.calls.map(c => c.vars.slot));
    await runDispatch({ now: utc(20, 2, 10), fetchImpl: every3.fetchImpl, config: cfg, alertDeps, parentIds: [soloParent.id] }); // 20th 07:40 IST
    check('every 3 days: the readings call rings again on the 3rd day', every3.calls.length === 1 && /BP/i.test(every3.calls[0].vars.ask_readings), every3.calls.map(c => c.vars.ask_readings));
    await prisma.parentProfile.update({ where: { id: soloParent.id }, data: { readingsEveryDays: 1 } });
    // No readings call set: the readings are asked on the first medicine call.
    await prisma.scheduledCallSlot.updateMany({ where: { parentId: soloParent.id, slot: 'wellness' }, data: { isActive: false } });
    const noVitals = makeFakeSarvam();
    await runDispatch({ now: utc(18, 3, 40), fetchImpl: noVitals.fetchImpl, config: cfg, alertDeps, parentIds: [soloParent.id] });
    check('no readings call set: the morning call asks for the readings', /BP/i.test(noVitals.calls[0]?.vars.ask_readings || ''), noVitals.calls[0]?.vars.ask_readings);
    // Subscription bookkeeping
    const sub = await updateUserSubscription(solo.id, { planId: 'solo', healthMonitor: true, noTrial: true });
    check('subscription stores the add-on and the total price', sub.healthMonitor === true && sub.amount === 1148, sub);
    const subFamily = await updateUserSubscription(solo.id, { planId: 'family', healthMonitor: true, noTrial: true });
    check('Family + Health Monitor: ₹1,699 + ₹499, flag kept', subFamily.healthMonitor === true && subFamily.amount === 2198, subFamily);
    check('Family: readings allowed with the add-on, and the couple call / timeline too', (await canTrackReadings(solo.id)) && (await isPremiumParent(solo.id)));
    await updateUserSubscription(solo.id, { planId: 'family', noTrial: true });
    check('Family without the add-on: no BP / sugar (it used to be included)', !(await canTrackReadings(solo.id)) && (await isPremiumParent(solo.id)));
    const lapsed = await prisma.userSubscription.update({ where: { userId: solo.id }, data: { planId: 'solo', healthMonitor: true, status: 'cancelled', currentPeriodEnd: new Date(Date.now() - 10 * 864e5) } });
    check('a lapsed subscription no longer has the add-on', lapsed.healthMonitor && !(await ownerHasHealthMonitor(solo.id)));

    console.log('\nB6. Adding Health Monitor inside a paid period');
    const paidUntil = new Date(Date.now() + 12 * 864e5);
    await prisma.userSubscription.update({ where: { userId: solo.id }, data: { planId: 'solo', healthMonitor: false, status: 'active', currentPeriodEnd: paidUntil, cancelAtPeriodEnd: false, razorpaySubscriptionId: `sub_test_${stamp}` } });
    const before = await prisma.userSubscription.findUnique({ where: { userId: solo.id } });
    const carry = carriedPeriod({ planId: 'solo', status: before!.status, currentPeriodEnd: before!.currentPeriodEnd.toISOString(), cancelAtPeriodEnd: before!.cancelAtPeriodEnd, razorpaySubscriptionId: before!.razorpaySubscriptionId || undefined });
    check('12 paid days left: carried', carry?.periodEnd.getTime() === paidUntil.getTime(), carry);
    const invoicesBefore = await prisma.invoice.count({ where: { userId: solo.id } });
    const upgraded = await updateUserSubscription(solo.id, { planId: 'solo', healthMonitor: true, noTrial: true, carry: carry || undefined, razorpaySubscriptionId: `sub_test_new_${stamp}`, invoiceNumber: `CC-TEST-${stamp}`.slice(0, 20) });
    check('the add-on applies now, at the new total', upgraded.healthMonitor === true && upgraded.amount === 1148, upgraded);
    check('access runs to the end of the period already paid for (no new 30 days, no gap)', new Date(upgraded.currentPeriodEnd).getTime() === paidUntil.getTime() && upgraded.status === 'active', upgraded);
    const inv = await prisma.invoice.findFirst({ where: { userId: solo.id }, orderBy: { createdAt: 'desc' } });
    check('nothing is charged today: a 0-rupee line that says when the first charge is', (await prisma.invoice.count({ where: { userId: solo.id } })) === invoicesBefore + 1 && inv?.amount === 0 && /first charge/.test(inv.planName), inv);
  } finally {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'placement-test-' } } });
    const left = await prisma.user.count({ where: { email: { startsWith: 'placement-test-' } } });
    console.log(`\nCleanup: ${left === 0 ? 'clean' : 'LEFTOVER ROWS!'}`);
  }
}

async function main() {
  partA();
  await partB();
  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error('TEST RUN CRASHED:', err);
  await prisma.user.deleteMany({ where: { email: { startsWith: 'placement-test-' } } }).catch(() => undefined);
  await prisma.$disconnect();
  process.exit(2);
});
