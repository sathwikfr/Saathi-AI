/**
 * Call pipeline tests: `npx tsx scripts/test-call-pipeline.ts`
 *
 * Part A: pure logic (no database, no network).
 * Part B: the whole pipeline against THROWAWAY rows in the real database, with
 *         a fake Sarvam server, a fake clock and a fake email sender.
 *         Every dispatch run is scoped to the test parent (`parentIds`), so real
 *         parents are never touched. All test rows are deleted at the end.
 */
import 'dotenv/config';
import './lib/testDb';
import { prisma } from '../src/lib/prisma';
import { newId, createUser, updateUserSubscription } from '../src/lib/db';
import { getEffectivePlan, freeTrialDaysLeft, freeTrialEnd, FREE_TRIAL_DAYS } from '../src/lib/plans';
import { toSarvamLanguage, buildOutboundRequest, getSarvamConfig, SarvamConfig } from '../src/lib/sarvam';
import { istDateString, istMinutesOfDay, isSlotDue, parseClockTime, formatIstClock } from '../src/lib/ist';
import { scanForEmergency } from '../src/lib/safety';
import { interpretCallResult, decideAlerts } from '../src/lib/callInterpretation';
import { runDispatch, placeManualCall, slotMedicines } from '../src/lib/callDispatch';
import { processSarvamWebhook, raiseToolEscalation, RESULT_NOT_RECEIVED } from '../src/lib/callResults';
import { LinkedMedicineDetail } from '../src/lib/types';

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

// ============================================================================
// PART A — pure logic
// ============================================================================
function partA() {
  console.log('\nA1. Language mapping');
  check('Hindi & English → Hindi', toSarvamLanguage('Hindi & English') === 'Hindi');
  check('Pure Hindi → Hindi', toSarvamLanguage('Pure Hindi') === 'Hindi');
  check('English → English', toSarvamLanguage('English') === 'English');
  check('English & Kannada → Kannada', toSarvamLanguage('English & Kannada') === 'Kannada');
  check('Telugu → Telugu', toSarvamLanguage('Telugu') === 'Telugu');
  check('Malayalam → Malayalam', toSarvamLanguage('Malayalam') === 'Malayalam');
  check('empty → Hindi', toSarvamLanguage('') === 'Hindi');

  console.log('\nA2. IST time handling');
  const nine = new Date('2026-10-05T03:30:00Z'); // 09:00 IST
  check('09:00 IST minutes', istMinutesOfDay(nine) === 540);
  check('IST date', istDateString(nine) === '2026-10-05');
  check('late-night UTC rolls to next IST day', istDateString(new Date('2026-10-05T19:00:00Z')) === '2026-10-06');
  check('format clock', formatIstClock(nine) === '09:00 AM');
  check('parse 12:00 AM', parseClockTime('12:00 AM') === 0);
  check('parse 12:30 PM', parseClockTime('12:30 PM') === 750);
  check('parse invalid', parseClockTime('25:00 PM') === null);
  check('08:30 AM due at 09:00 (window 90)', isSlotDue('08:30 AM', nine, 90));
  check('07:00 AM NOT due at 09:00 (missed by 2h)', !isSlotDue('07:00 AM', nine, 90));
  check('09:30 AM NOT due yet', !isSlotDue('09:30 AM', nine, 90));

  console.log('\nA3. Emergency scan (all languages, parent turns only)');
  const user = (text: string) => [{ role: 'user', text }];
  const hits: Array<[string, string]> = [
    ['English chest pain', 'I have chest pain since morning'],
    ['English cannot breathe', "I can't breathe properly"],
    ['English fell', 'No. I fell down in the bathroom'],
    ['English unconscious', 'she became unconscious'],
    ['English self-harm', 'I just want to die'],
    ['Hindi', 'मुझे सीने में दर्द हो रहा है'],
    ['Hindi romanised', 'mujhe saans nahi aa rahi'],
    ['Telugu', 'నాకు ఛాతీ నొప్పి గా ఉంది'],
    ['Tamil', 'எனக்கு நெஞ்சு வலி இருக்கிறது'],
    ['Kannada', 'ನನಗೆ ಎದೆ ನೋವು ಇದೆ'],
    ['Bengali', 'আমার বুকে ব্যথা করছে'],
    ['Marathi', 'मी पडलो'],
    ['Gujarati', 'મને છાતીમાં દુખાવો થાય છે'],
    ['Malayalam', 'എനിക്ക് നെഞ്ചുവേദന ഉണ്ട്']
  ];
  for (const [label, text] of hits) check(`hit: ${label}`, scanForEmergency(user(text)).hit, text);
  const clean: Array<[string, string]> = [
    ['negated chest pain', 'No chest pain today, I am fine'],
    ['blood pressure is not an emergency', 'I took my blood pressure tablet'],
    ['normal chat', 'I had breakfast and went for a walk'],
    ['agent turn ignored', '__agent__']
  ];
  for (const [label, text] of clean) {
    const turns = text === '__agent__' ? [{ role: 'agent', text: 'If you have chest pain or cannot breathe, tell me' }] : user(text);
    check(`no hit: ${label}`, !scanForEmergency(turns).hit, text);
  }

  console.log('\nA4. Result interpretation');
  const meds: LinkedMedicineDetail[] = [
    { name: 'Telmisartan (BP Tablet)', dosage: '40mg', questionScript: 'Did you take it?' },
    { name: 'Metformin 500', dosage: '1 tab', questionScript: 'Did you take it?' }
  ];
  const allYes = interpretCallResult(
    { final_agent_variables: { all_medicines_taken: 'yes', mood: 'Cheerful', health_concern: 'none', emergency: 'no', call_summary: 'All good.' } },
    meds, 'Amma'
  );
  check('all taken → confirmed', allYes.medicationConfirmed && allYes.medicineResults.every(r => r.status === 'taken'));
  check('mood cheerful', allYes.mood === 'cheerful');
  check('no alerts when all fine', decideAlerts(allYes, 'Amma', 'morning').length === 0);
  check('uses agent summary', allYes.summary === 'All good.');

  const partial = interpretCallResult(
    { final_agent_variables: { all_medicines_taken: 'partial', medicines_taken: 'Telmisartan', medicines_missed: 'metformin', mood: 'calm' } },
    meds, 'Amma'
  );
  check('partial: telmisartan taken', partial.medicineResults[0].status === 'taken');
  check('partial: metformin missed', partial.medicineResults[1].status === 'missed');
  check('partial → not confirmed', !partial.medicationConfirmed);
  const partialAlerts = decideAlerts(partial, 'Amma', 'morning');
  check('partial → level-2 missed alert', partialAlerts.length === 1 && partialAlerts[0].level === 2 && partialAlerts[0].message.includes('Metformin 500'), partialAlerts);

  const noMeds = interpretCallResult({ final_agent_variables: { mood: 'calm' } }, [], 'Appa');
  check('wellness-only call counts as confirmed', noMeds.medicationConfirmed);

  const concern = interpretCallResult({ final_agent_variables: { all_medicines_taken: 'yes', health_concern: 'headache since last night', mood: 'unwell' } }, meds, 'Amma');
  const concernAlerts = decideAlerts(concern, 'Amma', 'morning');
  check('health concern → level 3', concernAlerts.some(a => a.level === 3), concernAlerts);

  const emergencyByScan = interpretCallResult(
    { final_agent_variables: { all_medicines_taken: 'yes', emergency: 'no' }, interaction_transcript: [{ role: 'user', en_text: 'I have severe chest pain' }] },
    meds, 'Amma'
  );
  check('scan catches emergency even when agent said no', decideAlerts(emergencyByScan, 'Amma', 'morning').some(a => a.level === 4));

  const unknown = interpretCallResult({ final_agent_variables: null }, meds, 'Amma');
  check('missing variables → unknown, not confirmed', !unknown.medicationConfirmed && unknown.medicineResults.every(r => r.status === 'unknown'));

  const silentTranscript = [
    { role: 'agent', text: 'Hello Amma garu, did you take your Telmisartan tablet?' },
    { role: 'agent', text: 'Hello, are you there?' },
    { role: 'agent', text: 'I did not get any response, so I am ending the call.' }
  ];
  const silent = interpretCallResult({ final_agent_variables: { all_medicines_taken: 'not_asked' }, interaction_transcript: silentTranscript }, meds, 'Amma');
  check('picked up but never replied → noResponse', silent.noResponse === true);
  const spoke = interpretCallResult({ final_agent_variables: null, interaction_transcript: [...silentTranscript, { role: 'user', text: 'hmm' }] }, meds, 'Amma');
  check('parent spoke (even unclear) → not noResponse', spoke.noResponse === false);
  check('no data at all → not assumed silent', unknown.noResponse === false);
  check('no medicines → never noResponse', interpretCallResult({ final_agent_variables: { mood: 'calm' }, interaction_transcript: silentTranscript }, [], 'Appa').noResponse === false);

  console.log('\nA5. Outbound request');
  const cfg = fakeConfig();
  const body = buildOutboundRequest(cfg, {
    callLogId: 'call_1', parentId: 'parent_1', slotId: 'slot_1', slot: 'morning', slotLabel: 'Morning', parentName: 'Amma',
    parentPhone: '+919000012345', language: 'Telugu', caregiverName: 'Sathwik', relationship: 'Mother', medicines: meds
  });
  check('agent phone + connection', body.app_config.connection_config.agent_phone_number === '+910000000000' && body.app_config.connection_config.connection_id === 'conn_1');
  check('language override Telugu', body.app_config.app_overrides.initial_language_name === 'Telugu');
  check('user phone E.164', body.user_config.user_phone_number === '+919000012345');
  check('metadata carries callLogId', body.webhook_config.metadata.callLogId === 'call_1');
  check('webhook url has token', body.webhook_config.url === 'http://app.test/api/calls/sarvam-webhook?token=s3cret');
  check('checklist numbered', body.app_config.agent_variables.medicines_checklist.startsWith('1. Telmisartan (BP Tablet) (40mg)'));
  check('has_medicines yes', body.app_config.agent_variables.has_medicines === 'yes');
  check('config null when incomplete', getSarvamConfig({} as NodeJS.ProcessEnv) === null);

  console.log('\nA6. Slot medicines');
  const slot = { id: 's', slot: 'morning', time: '08:30 AM', label: 'x', linkedMedicineNames: ['Old Med'], linkedMedicinesJson: null };
  check('falls back to names + generated question', slotMedicines(slot, new Set()).length === 1 && !!slotMedicines(slot, new Set())[0].questionScript);
  check('drops paused medicines', slotMedicines(slot, new Set(['Old Med'])).length === 0);

  console.log('\nA7. Free 7-day trial and effective plan');
  const DAY = 864e5;
  const t0 = new Date('2026-10-10T06:00:00Z');
  const ago = (days: number) => new Date(t0.getTime() - days * DAY);
  const iso = (d: Date) => d.toISOString();
  const noSub3 = getEffectivePlan(null, ago(3), t0);
  check('no subscription, 3 days old → free, 1 call/day', noSub3.id === 'free' && noSub3.callsPerDay === 1 && !noSub3.expired);
  const noSub8 = getEffectivePlan(null, ago(8), t0);
  check('no subscription, 8 days old → trial ended, 0 calls', !!noSub8.expired && noSub8.callsPerDay === 0);
  check('free sub, period ended → trial ended', !!getEffectivePlan({ planId: 'free', status: 'free', currentPeriodEnd: iso(ago(1)) }, ago(9), t0).expired);
  check('free sub, period future, account 3 days old → free', getEffectivePlan({ planId: 'free', status: 'free', currentPeriodEnd: iso(new Date(t0.getTime() + 4 * DAY)) }, ago(3), t0).callsPerDay === 1);
  check('free sub with old 365-day period but 10-day-old account → trial ended', !!getEffectivePlan({ planId: 'free', status: 'free', currentPeriodEnd: iso(new Date(t0.getTime() + 300 * DAY)) }, ago(10), t0).expired);
  check('active family → family, 3 calls', getEffectivePlan({ planId: 'family', status: 'active', currentPeriodEnd: iso(new Date(t0.getTime() + 20 * DAY)) }, ago(60), t0).callsPerDay === 3);
  check('trialing extended → extended', getEffectivePlan({ planId: 'extended', status: 'trialing', currentPeriodEnd: iso(new Date(t0.getTime() + 5 * DAY)) }, ago(1), t0).id === 'extended');
  check('cancelled family, period over, old account → trial ended', !!getEffectivePlan({ planId: 'family', status: 'cancelled', currentPeriodEnd: iso(ago(2)) }, ago(90), t0).expired);
  check('cancelled family, still inside paid period → family', getEffectivePlan({ planId: 'family', status: 'cancelled', currentPeriodEnd: iso(new Date(t0.getTime() + 2 * DAY)) }, ago(90), t0).id === 'family');
  check('trial end = created + 7 days', freeTrialEnd(ago(0)).getTime() === t0.getTime() + FREE_TRIAL_DAYS * DAY);
  check('days left: day 0 → 7, day 6 → 1, day 8 → 0', freeTrialDaysLeft(ago(0), t0) === 7 && freeTrialDaysLeft(ago(6), t0) === 1 && freeTrialDaysLeft(ago(8), t0) === 0);
}

function fakeConfig(): SarvamConfig {
  return {
    apiKey: 'test-key', orgId: 'org_1', workspaceId: 'ws_1', appId: 'app_1', appVersion: 2, connectionId: 'conn_1',
    agentPhoneNumber: '+910000000000', apiBase: 'http://sarvam.test/api/outbounds', webhookSecret: 's3cret', appUrl: 'http://app.test'
  };
}

// ============================================================================
// PART B — pipeline against throwaway database rows
// ============================================================================
interface FakeCall { url: string; headers: Record<string, string>; body: ReturnType<typeof buildOutboundRequest> }

function makeFakeSarvam(behaviour: { mode: 'ok' | 'http'; status?: number } = { mode: 'ok' }) {
  const calls: FakeCall[] = [];
  let n = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    if (behaviour.mode === 'http') return new Response('{}', { status: behaviour.status || 503 });
    n += 1;
    return new Response(JSON.stringify({ attempt_id: `att_${Date.now()}_${n}` }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

async function partB() {
  console.log('\nB. Pipeline against throwaway database rows');
  const emails: Array<{ to: string; alertType: string; alertLevel: string }> = [];
  const alertDeps = {
    whatsapp: null, // WhatsApp off: the original alert emails (WhatsApp has its own suite, test-whatsapp.ts)
    sendEmail: (async (p: { to: string; alertType: string; alertLevel: string }) => {
      emails.push({ to: p.to, alertType: p.alertType, alertLevel: p.alertLevel });
      return { success: true, simulated: true };
    }) as never
  };

  const stamp = Date.now();
    const user = await prisma.user.create({
    data: {
      id: newId('usr'), name: 'Pipeline Tester', email: `pipeline-test-${stamp}@example.com`, phone: null,
      subscription: { create: { id: newId('sub'), planId: 'family', status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 864e5), amount: 399 } },
      notificationPreferences: { create: {} }
    }
  });

  try {
    const med = (name: string, dosage: string): LinkedMedicineDetail => ({
      name, dosage, foodRelation: 'after_food', questionScript: `Did you take your ${name}?`
    });
    const morningMeds = [med('Telmisartan (BP Tablet)', '40mg'), med('Metformin 500', '1 tab')];
    const parent = await prisma.parentProfile.create({
      data: {
        id: newId('parent'), userId: user.id, name: 'Test Amma', relationship: 'Mother', phone: '+919000012345',
        language: 'Telugu', callTime: '08:30 AM', consentGiven: true,
        createdAt: new Date(Date.UTC(2026, 8, 28)), // a fixed old date: never "created today" on the fake days (a real-clock offset broke on 8 Oct)
        callSchedule: {
          create: [
            { id: newId('slot'), time: '08:30 AM', slot: 'morning', label: 'Morning Medicine Reminder', linkedMedicineNames: morningMeds.map(m => m.name), linkedMedicinesJson: JSON.stringify(morningMeds) },
            { id: newId('slot'), time: '01:00 PM', slot: 'afternoon', label: 'Afternoon Check', linkedMedicineNames: ['Calcium'], linkedMedicinesJson: JSON.stringify([med('Calcium', '1 tab')]) },
            { id: newId('slot'), time: '09:00 PM', slot: 'bedtime', label: 'Night Check', linkedMedicineNames: ['Metformin 500'], linkedMedicinesJson: JSON.stringify([med('Metformin 500', '1 tab')]) }
          ]
        },
        medicines: { create: morningMeds.map(m => ({ id: newId('med'), name: m.name, dosage: m.dosage || '1 tab', timeOfDay: 'morning', timingSlots: ['morning'], foodRelation: 'after_food', frequency: 'daily' })) }
      },
      include: { callSchedule: true }
    });
    const scope = [parent.id];
    const cfg = fakeConfig();
    const day1 = (hh: number, mm: number) => new Date(Date.UTC(2026, 9, 5, hh, mm)); // 05 Oct 2026, UTC clock
    // 09:00 IST = 03:30Z, 01:10 PM IST = 07:40Z, 09:05 PM IST = 15:35Z

    // ---- B1 due slot is called, with the right request ----------------------
    console.log('\nB1. Morning slot due at 09:00 IST');
    const sarvam1 = makeFakeSarvam();
    const s1 = await runDispatch({ now: day1(3, 30), fetchImpl: sarvam1.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('one call placed', s1.placed === 1 && sarvam1.calls.length === 1, s1);
    const req1 = sarvam1.calls[0];
    check('URL scoped to org/workspace', req1?.url === 'http://sarvam.test/api/outbounds/v1/orgs/org_1/workspaces/ws_1/outbounds', req1?.url);
    check('X-API-Key header sent', req1?.headers['X-API-Key'] === 'test-key');
    check('language Telugu', req1?.body.app_config.app_overrides.initial_language_name === 'Telugu');
    check('2 medicines in checklist', req1?.body.app_config.agent_variables.medicine_count === '2');
    check('first_medicine is the clean first tablet name', req1?.body.app_config.agent_variables.first_medicine === 'Telmisartan');
    const log1 = await prisma.callLog.findFirst({ where: { parentId: parent.id, callDate: '2026-10-05', slot: 'morning' } });
    check('CallLog placed with provider id', log1?.status === 'placed' && !!log1.providerAttemptId && log1.attemptNumber === 1, log1);
    check('metadata callLogId matches', req1?.body.webhook_config.metadata.callLogId === log1?.id);

    console.log('\nB2. Same run again never double-calls');
    const s1b = await runDispatch({ now: day1(3, 32), fetchImpl: sarvam1.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('nothing new placed', s1b.placed === 0 && sarvam1.calls.length === 1 && s1b.alreadyCalled === 1, s1b);

    console.log('\nB3. Webhook: partial medicines → level-2 alert + email, idempotent');
    const payload3 = {
      attempt_id: log1!.providerAttemptId, status: 'connected', duration: 132, interaction_id: 'int_1',
      final_agent_variables: { all_medicines_taken: 'partial', medicines_taken: 'Telmisartan', medicines_missed: 'Metformin', mood: 'calm', health_concern: 'none', emergency: 'no', feedback: 'Please call on Sunday', call_summary: 'Took BP tablet, skipped Metformin.' },
      interaction_transcript: [{ role: 'agent', en_text: 'Good morning Amma' }, { role: 'user', en_text: 'Good morning, I took the BP tablet' }]
    };
    const out3 = await processSarvamWebhook(payload3, { now: day1(3, 40), deps: alertDeps });
    check('processed', out3.status === 'processed', out3);
    const after3 = await prisma.callLog.findUnique({ where: { id: log1!.id } });
    check('status answered, duration, mood', after3?.status === 'answered' && after3.durationSeconds === 132 && after3.mood === 'calm');
    check('medication NOT confirmed (Metformin missed)', after3?.medicationConfirmed === false);
    check('feedback stored in notes', after3?.notes === 'Please call on Sunday');
    check('transcript stored', !!after3?.transcriptJson && after3.transcriptJson.includes('BP tablet'));
    check('pickup time in IST', after3?.actualAnswerTime === '09:10 AM', after3?.actualAnswerTime);
    const alerts3 = await prisma.alertRecord.findMany({ where: { callLogId: log1!.id } });
    check('one level-2 missed-medicine alert', alerts3.length === 1 && alerts3[0].level === 2 && alerts3[0].message.includes('Metformin 500'), alerts3);
    check('owner emailed once', emails.length === 1 && emails[0].to === user.email, emails);
    const out3b = await processSarvamWebhook(payload3, { now: day1(3, 41), deps: alertDeps });
    check('duplicate delivery ignored', out3b.status === 'duplicate', out3b);
    check('no second alert / email', (await prisma.alertRecord.count({ where: { callLogId: log1!.id } })) === 1 && emails.length === 1);

    // ---- B4 emergency in transcript, and escalate tool dedupe ------------------
    console.log('\nB4. Emergency detected in transcript (agent said "no") + escalation tool');
    const sarvam4 = makeFakeSarvam();
    await runDispatch({ now: day1(7, 40), fetchImpl: sarvam4.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    const log4 = await prisma.callLog.findFirst({ where: { parentId: parent.id, slot: 'afternoon', callDate: '2026-10-05' } });
    check('afternoon call placed', log4?.status === 'placed');
    const emailsBefore = emails.length;
    const tool = await raiseToolEscalation(log4!.id, 'I have chest pain and feel dizzy', alertDeps);
    check('escalation tool raises level 4', tool.status === 'raised', tool);
    const out4 = await processSarvamWebhook({
      attempt_id: log4!.providerAttemptId, status: 'connected', duration: 60,
      final_agent_variables: { all_medicines_taken: 'yes', emergency: 'no', mood: 'calm' },
      interaction_transcript: [{ role: 'user', en_text: 'I have severe chest pain' }]
    }, { now: day1(7, 50), deps: alertDeps });
    check('processed', out4.status === 'processed', out4);
    const alerts4 = await prisma.alertRecord.findMany({ where: { callLogId: log4!.id } });
    check('exactly one level-4 alert (tool + scan deduped)', alerts4.length === 1 && alerts4[0].level === 4, alerts4);
    check('one critical email', emails.length === emailsBefore + 1 && emails[emails.length - 1].alertLevel === 'level_3');
    check('escalate again is a no-op', (await raiseToolEscalation(log4!.id, 'again', alertDeps)).status === 'already_raised');
    check('escalate unknown call', (await raiseToolEscalation('nope', 'x', alertDeps)).status === 'unknown_call');

    // ---- B5 no answer → retries → final alert ---------------------------------
    console.log('\nB5. No answer → retry after 30 min → busy → retry → final alert');
    const sarvam5 = makeFakeSarvam();
    await runDispatch({ now: day1(15, 35), fetchImpl: sarvam5.fetchImpl, config: cfg, alertDeps, parentIds: scope }); // 09:05 PM IST
    const a1 = await prisma.callLog.findFirst({ where: { parentId: parent.id, slot: 'bedtime', attemptNumber: 1 } });
    check('bedtime attempt 1 placed', a1?.status === 'placed');
    // Attempt 1: the line connects but the parent never says anything (agent nudges, then hangs up) → same as unanswered.
    const o5a = await processSarvamWebhook({
      attempt_id: a1!.providerAttemptId,
      status: 'connected',
      duration: 25,
      final_agent_variables: { all_medicines_taken: 'not_asked', mood: 'neutral' },
      interaction_transcript: [
        { role: 'agent', text: 'Did you take your tablet?' },
        { role: 'agent', text: 'I did not get any response, so I am ending the call.' }
      ]
    }, { now: day1(15, 36), deps: alertDeps });
    check('retry scheduled', o5a.status === 'processed' && !!o5a.retryAt, o5a);
    const a1after = await prisma.callLog.findUnique({ where: { id: a1!.id } });
    check('attempt 1 (silent pickup) unanswered with nextRetryAt +30m', a1after?.status === 'unanswered' && a1after.nextRetryAt?.getTime() === day1(16, 6).getTime(), a1after?.nextRetryAt);
    check('silent pickup marked no_response, not a missed medicine', a1after?.failureReason === 'no_response' && a1after.medicationConfirmed !== true);
    check('no alert yet (retry pending)', (await prisma.alertRecord.count({ where: { callLogId: a1!.id } })) === 0);
    const early = await runDispatch({ now: day1(15, 55), fetchImpl: sarvam5.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('too early: no retry', early.retried === 0);
    const r2 = await runDispatch({ now: day1(16, 7), fetchImpl: sarvam5.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('retry placed', r2.retried === 1, r2);
    const a2 = await prisma.callLog.findFirst({ where: { parentId: parent.id, slot: 'bedtime', attemptNumber: 2 } });
    check('attempt 2 exists and placed', a2?.status === 'placed');
    const r2again = await runDispatch({ now: day1(16, 8), fetchImpl: sarvam5.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('retry not repeated', r2again.retried === 0);
    // One retry only (2026-10-04): attempt 2 is the last; busy again -> the family is told.
    const o5c = await processSarvamWebhook({ attempt_id: a2!.providerAttemptId, status: 'busy' }, { now: day1(16, 8), deps: alertDeps });
    check('no retry after attempt 2', o5c.status === 'processed' && o5c.retryAt === null, o5c);
    const finalAlert = await prisma.alertRecord.findMany({ where: { callLogId: a2!.id } });
    check("final level-2 'couldn't reach' alert", finalAlert.length === 1 && finalAlert[0].level === 2 && finalAlert[0].message.includes('2 times'), finalAlert);
    const r3 = await runDispatch({ now: day1(16, 40), fetchImpl: sarvam5.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('no 3rd attempt', r3.retried === 0 && (await prisma.callLog.count({ where: { parentId: parent.id, slot: 'bedtime' } })) === 2);

    // ---- B6 plan cap ----------------------------------------------------------
    console.log('\nB6. Free plan: only 1 call/day');
    await prisma.userSubscription.update({ where: { userId: user.id }, data: { planId: 'free', status: 'free' } });
    const sarvam6 = makeFakeSarvam();
    const day2 = (hh: number, mm: number) => new Date(Date.UTC(2026, 9, 6, hh, mm));
    const s6 = await runDispatch({ now: day2(7, 40), fetchImpl: sarvam6.fetchImpl, config: cfg, alertDeps, parentIds: scope }); // 01:10 PM
    check('afternoon slot not called (beyond cap)', s6.placed === 0 && s6.cappedByPlan === 2 && sarvam6.calls.length === 0, s6);
    const s6b = await runDispatch({ now: day2(3, 30), fetchImpl: sarvam6.fetchImpl, config: cfg, alertDeps, parentIds: scope }); // 09:00 IST
    check('first slot of the day still called', s6b.placed === 1, s6b);
    await prisma.userSubscription.update({ where: { userId: user.id }, data: { planId: 'family', status: 'active' } });

    // ---- B7 paused / auto-resume / new parent -----------------------------------
    console.log('\nB7. Paused parents');
    await prisma.parentProfile.update({ where: { id: parent.id }, data: { isPaused: true, pauseUntil: new Date(Date.UTC(2026, 9, 20)) } });
    const day3 = (hh: number, mm: number) => new Date(Date.UTC(2026, 9, 7, hh, mm));
    const sarvam7 = makeFakeSarvam();
    const s7 = await runDispatch({ now: day3(3, 30), fetchImpl: sarvam7.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('paused parent not called', s7.placed === 0 && sarvam7.calls.length === 0, s7);
    await prisma.parentProfile.update({ where: { id: parent.id }, data: { pauseUntil: new Date(Date.UTC(2026, 9, 6)) } });
    const s7b = await runDispatch({ now: day3(3, 30), fetchImpl: sarvam7.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('pause expired → auto-resumed and called', s7b.autoResumed === 1 && s7b.placed === 1, s7b);
    check('parent no longer paused', (await prisma.parentProfile.findUnique({ where: { id: parent.id } }))?.isPaused === false);

    // ---- B8 API failures --------------------------------------------------------
    console.log('\nB8. Sarvam API failures');
    const day4 = (hh: number, mm: number) => new Date(Date.UTC(2026, 9, 8, hh, mm));
    const down = makeFakeSarvam({ mode: 'http', status: 503 });
    const s8 = await runDispatch({ now: day4(3, 30), fetchImpl: down.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    const f1 = await prisma.callLog.findFirst({ where: { parentId: parent.id, callDate: '2026-10-08', attemptNumber: 1 } });
    check('503 → failed with retry scheduled', s8.failedToPlace === 1 && f1?.status === 'failed' && !!f1.nextRetryAt, f1);
    check('no family alert for a transient error yet', (await prisma.alertRecord.count({ where: { callLogId: f1!.id } })) === 0);
    const back = makeFakeSarvam();
    const s8b = await runDispatch({ now: day4(4, 10), fetchImpl: back.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('retry succeeds when service is back', s8b.retried === 1, s8b);
    const day5 = (hh: number, mm: number) => new Date(Date.UTC(2026, 9, 9, hh, mm));
    const denied = makeFakeSarvam({ mode: 'http', status: 401 });
    // (Earlier unfinished fake-day calls are now closed AND reported as lost by the sweep, so only this call's alerts are checked.)
    const s8c = await runDispatch({ now: day5(3, 30), fetchImpl: denied.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    const f2 = await prisma.callLog.findFirst({ where: { parentId: parent.id, callDate: '2026-10-09', attemptNumber: 1 } });
    check('401 (our config) → failed, no retry, no family alert', s8c.failedToPlace === 1 && f2?.status === 'failed' && f2.nextRetryAt === null && (await prisma.alertRecord.count({ where: { callLogId: f2.id } })) === 0, f2);
    const dayB8d = (hh: number, mm: number) => new Date(Date.UTC(2026, 9, 11, hh, mm));
    const noCredits = makeFakeSarvam({ mode: 'http', status: 402 });
    const s8d = await runDispatch({ now: dayB8d(3, 30), fetchImpl: noCredits.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    const f3 = await prisma.callLog.findFirst({ where: { parentId: parent.id, callDate: '2026-10-11', attemptNumber: 1 } });
    check('402 (our Sarvam credits used up) → failed, no retry, no family alert',
      s8d.failedToPlace === 1 && f3?.status === 'failed' && f3.nextRetryAt === null &&
      (await prisma.alertRecord.count({ where: { callLogId: f3.id } })) === 0, f3);

    // ---- B9 stale placed calls --------------------------------------------------
    console.log('\nB9. Result never arrives');
    const day6 = (hh: number, mm: number) => new Date(Date.UTC(2026, 9, 10, hh, mm));
    const sarvam9 = makeFakeSarvam();
    await runDispatch({ now: day6(3, 30), fetchImpl: sarvam9.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    const p9 = await prisma.callLog.findFirst({ where: { parentId: parent.id, callDate: '2026-10-10' } });
    const s9 = await runDispatch({ now: day6(4, 30), fetchImpl: sarvam9.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('stale placed call closed (earlier unfinished fake-day calls are swept too)', s9.staleClosed >= 1, s9);
    const p9after = await prisma.callLog.findUnique({ where: { id: p9!.id } });
    check('marked failed / result_not_received', p9after?.status === 'failed' && p9after.failureReason === RESULT_NOT_RECEIVED);
    const late = await processSarvamWebhook({ attempt_id: p9!.providerAttemptId, status: 'connected', duration: 50, final_agent_variables: { all_medicines_taken: 'yes', mood: 'cheerful' } }, { now: day6(4, 40), deps: alertDeps });
    check('late webhook still applies', late.status === 'processed', late);
    check('now answered', (await prisma.callLog.findUnique({ where: { id: p9!.id } }))?.status === 'answered');

    // ---- B10 webhook validation --------------------------------------------------
    console.log('\nB10. Webhook validation');
    check('unknown attempt', (await processSarvamWebhook({ attempt_id: 'nope', status: 'connected' }, { deps: alertDeps })).status === 'unknown_attempt');
    check('missing attempt_id', (await processSarvamWebhook({ status: 'connected' }, { deps: alertDeps })).status === 'invalid');
    check('bad status', (await processSarvamWebhook({ attempt_id: 'x', status: 'weird' }, { deps: alertDeps })).status === 'invalid');
    const day8 = (hh: number, mm: number) => new Date(Date.UTC(2026, 9, 14, hh, mm));
    await runDispatch({ now: day8(3, 30), fetchImpl: makeFakeSarvam().fetchImpl, config: cfg, alertDeps, parentIds: scope });
    const failedPayloadLog = await prisma.callLog.findFirst({ where: { parentId: parent.id, callDate: '2026-10-14', status: 'placed' } });
    const fo = await processSarvamWebhook({ attempt_id: failedPayloadLog!.providerAttemptId, status: 'failed', failure_reason: 'exotel: Phone number is registered under TRAI NDNC' }, { now: day8(3, 40), deps: alertDeps });
    const failedLog = await prisma.callLog.findUnique({ where: { id: failedPayloadLog!.id } });
    check('failed status: no retry, DND reason kept', fo.status === 'processed' && failedLog?.status === 'failed' && failedLog.nextRetryAt === null && !!failedLog.failureReason?.includes('NDNC'), failedLog);
    check('failed status raises level-2 alert', (await prisma.alertRecord.count({ where: { callLogId: failedLog!.id, level: 2 } })) === 1);

    // ---- B11 manual / test calls --------------------------------------------------
    console.log('\nB11. Test / manual calls');
    const sarvam11 = makeFakeSarvam();
    const noCfg = await placeManualCall({ parentId: parent.id, requesterId: user.id, kind: 'test' }, { config: null });
    check('not configured → 503', !noCfg.ok && noCfg.status === 503 && noCfg.code === 'CALLING_NOT_CONNECTED');
    const wrongOwner = await placeManualCall({ parentId: parent.id, requesterId: 'someone-else', kind: 'test' }, { config: cfg, fetchImpl: sarvam11.fetchImpl });
    check("someone else's parent → 404, no call", !wrongOwner.ok && wrongOwner.status === 404 && sarvam11.calls.length === 0);
    const m1 = await placeManualCall({ parentId: parent.id, requesterId: user.id, kind: 'test' }, { config: cfg, fetchImpl: sarvam11.fetchImpl });
    check('test call placed', m1.ok && sarvam11.calls.length === 1, m1);
    const mlog = m1.ok ? await prisma.callLog.findUnique({ where: { id: m1.callLogId } }) : null;
    check("test call logged with slot 'test', no slot id", mlog?.slot === 'test' && mlog.slotId === null && mlog.status === 'placed');
    const mo = m1.ok ? await processSarvamWebhook({ attempt_id: mlog!.providerAttemptId, status: 'no_answer' }, { deps: alertDeps }) : null;
    check('test call never retried', mo?.status === 'processed' && (mo as { retryAt: string | null }).retryAt === null);
    const noCredits11 = makeFakeSarvam({ mode: 'http', status: 402 });
    const mx = await placeManualCall({ parentId: parent.id, requesterId: user.id, kind: 'test' }, { config: cfg, fetchImpl: noCredits11.fetchImpl });
    check('402 from Sarvam → clear "problem on our side" error (503), not "try again in a few minutes"', !mx.ok && mx.status === 503 && mx.code === 'CALLING_UNAVAILABLE', mx);
    const m2 = await placeManualCall({ parentId: parent.id, requesterId: user.id, kind: 'test' }, { config: cfg, fetchImpl: sarvam11.fetchImpl });
    const m3 = await placeManualCall({ parentId: parent.id, requesterId: user.id, kind: 'test' }, { config: cfg, fetchImpl: sarvam11.fetchImpl });
    check('2 per hour allowed, 3rd rate-limited (a refused attempt does not count)', m2.ok && !m3.ok && m3.status === 429, [m2.ok, m3.ok]);
    await prisma.parentProfile.update({ where: { id: parent.id }, data: { isPaused: true } });
    const mp = await placeManualCall({ parentId: parent.id, requesterId: user.id, kind: 'test' }, { config: cfg, fetchImpl: sarvam11.fetchImpl });
    check('paused parent → 409', !mp.ok && mp.status === 409);

    // ---- B12 unconfigured dispatch does nothing ------------------------------------
    console.log('\nB12. Not configured');
    const before = await prisma.callLog.count({ where: { parentId: parent.id } });
    const sNone = await runDispatch({ now: day1(3, 30), config: null, parentIds: scope });
    check('does nothing and creates no logs', !sNone.configured && sNone.placed === 0 && (await prisma.callLog.count({ where: { parentId: parent.id } })) === before);

    // ---- B13 new parent is not called about a slot that already passed today -----
    console.log('\nB13. Brand-new parent');
    await prisma.parentProfile.update({ where: { id: parent.id }, data: { isPaused: false, createdAt: new Date(Date.UTC(2026, 9, 13, 3, 0)) } }); // 08:30 IST creation
    const sarvam13 = makeFakeSarvam();
    const s13 = await runDispatch({ now: new Date(Date.UTC(2026, 9, 13, 3, 45)), fetchImpl: sarvam13.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('slot before creation time skipped', s13.placed === 0 && sarvam13.calls.length === 0, s13);

    // ---- B14 free trial over: no scheduled calls, no test calls ---------------------
    console.log('\nB14. Free trial ended');
    await prisma.user.update({ where: { id: user.id }, data: { createdAt: new Date(Date.now() - 10 * 864e5) } });
    await prisma.userSubscription.update({ where: { userId: user.id }, data: { planId: 'free', status: 'free', currentPeriodEnd: new Date(Date.now() - 3 * 864e5) } });
    const sarvam14 = makeFakeSarvam();
    const s14 = await runDispatch({ now: new Date(Date.UTC(2026, 9, 15, 3, 30)), fetchImpl: sarvam14.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('expired trial: no calls placed', s14.placed === 0 && sarvam14.calls.length === 0, s14);
    const m14 = await placeManualCall({ parentId: parent.id, requesterId: user.id, kind: 'test' }, { config: cfg, fetchImpl: sarvam14.fetchImpl });
    check('expired trial: test call refused (402 TRIAL_ENDED)', !m14.ok && m14.status === 402 && m14.code === 'TRIAL_ENDED', m14);
    await prisma.userSubscription.update({ where: { userId: user.id }, data: { planId: 'family', status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 864e5) } });
    const s14b = await runDispatch({ now: new Date(Date.UTC(2026, 9, 15, 3, 35)), fetchImpl: sarvam14.fetchImpl, config: cfg, alertDeps, parentIds: scope });
    check('after choosing a paid plan, calls resume', s14b.placed === 1, s14b);

    // ---- B15 account creation gives a 7-day trial; downgrading never restarts it ------
    console.log('\nB15. New accounts start the 7-day trial');
    const trialUser = await createUser({ name: 'Trial Tester', email: `pipeline-test-trial-${stamp}@example.com`, phone: null, planId: 'family' });
    const trialSub = await prisma.userSubscription.findUnique({ where: { userId: trialUser.id } });
    const daysToEnd = trialSub ? (trialSub.currentPeriodEnd.getTime() - Date.now()) / 864e5 : -1;
    check('every new account gets a free subscription', trialSub?.planId === 'free' && trialSub.status === 'free');
    check('trial ends about 7 days from now', daysToEnd > 6.9 && daysToEnd <= 7.01, daysToEnd);
    await prisma.user.update({ where: { id: trialUser.id }, data: { createdAt: new Date(Date.now() - 20 * 864e5) } });
    await updateUserSubscription(trialUser.id, { planId: 'free' });
    const after = await prisma.userSubscription.findUnique({ where: { userId: trialUser.id } });
    check('switching to Free does not restart the trial', !!after && after.currentPeriodEnd.getTime() < Date.now(), after?.currentPeriodEnd);
    await prisma.user.delete({ where: { id: trialUser.id } });
  } finally {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'pipeline-test-trial-' } } });
    await prisma.user.delete({ where: { id: user.id } });
    const left = await prisma.user.count({ where: { email: { startsWith: 'pipeline-test-' } } });
    console.log(`\nCleanup: test user removed (${left === 0 ? 'clean' : 'LEFTOVER ROWS!'})`);
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
  await prisma.$disconnect();
  process.exit(2);
});
