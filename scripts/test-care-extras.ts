/**
 * v1.1 extras tests: `npx tsx scripts/test-care-extras.ts`
 *
 * Part A: pure logic (readings, appointments, weather, festivals, UPI share, chemist list,
 *         call planning with family asks, agent variables, couple-call interpretation).
 * Part B: flows against THROWAWAY rows in the real database with a fake Sarvam, a fake weather
 *         service and an injected holiday list: a couple call (two parents, one phone), readings
 *         with ranges, family messages both ways, appointment reminder + "how did it go?",
 *         helper check, weather note, festival greeting, life story, "later" for the partner,
 *         unanswered couple calls, and the bill share. Scoped to the test parents; cleaned up.
 */
import 'dotenv/config';
import './lib/testDb';
// Extra "you said later" calls are off by default since 2026-10-08 (see callResults.maxFollowUpsPerDay); these suites cover the code path that stays, so switch it on here. The default is tested in test-call-placement.ts.
process.env.FOLLOW_UP_CALLS_PER_DAY = '2';
import { prisma } from '../src/lib/prisma';
import { newId, setCallTogether } from '../src/lib/db';
import { parseBp, parseSugar, checkBp, checkSugar } from '../src/lib/readings';
import { planAppointments, AppointmentRow } from '../src/lib/appointments';
import { weatherNote } from '../src/lib/weather';
import { parseHolidayFeed, specialDayFor, upcomingFestivalNames } from '../src/lib/festivals';
import { isValidUpiId, shareAmount, upiLink, chemistMessage, istMonth } from '../src/lib/familyMoney';
import { planCallExtras, FamilyAsks } from '../src/lib/callPlanning';
import { buildAgentVariables, SarvamConfig } from '../src/lib/sarvam';
import { interpretCallResult, decideAlerts, partnerPayload, ALERT_TITLES } from '../src/lib/callInterpretation';
import { describeAnsweredCall } from '../src/lib/familyMessages';
import { runDispatch, coupleOf, partnerSpecialDay } from '../src/lib/callDispatch';
import { processSarvamWebhook } from '../src/lib/callResults';
import { ownerView, memberView, setUpiId, setSharesBill, markSharePaid } from '../src/lib/billShare';
import { LinkedMedicineDetail } from '../src/lib/types';
import { PLANS } from '../src/lib/plans';
import { readingsLine, parentSummary, ReadingFact } from '../src/lib/digests';

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

const DAY = 864e5;
const MED = (name: string): LinkedMedicineDetail => ({ name, dosage: '1 tab', foodRelation: 'after_food', questionScript: `Did you take your ${name}?` });

// ============================================================================
// PART A
// ============================================================================
function partA() {
  const now = new Date(Date.UTC(2026, 10, 7, 3, 30)); // Sat 7 Nov 2026, 09:00 IST

  console.log('\nA1. Readings');
  check('BP "140/90"', JSON.stringify(parseBp('140/90')) === '{"systolic":140,"diastolic":90}');
  check('BP "150 by 95"', parseBp('150 by 95')?.diastolic === 95);
  check('BP "none" / nonsense / reversed', parseBp('none') === null && parseBp('high') === null && parseBp('80/140') === null);
  check('sugar "160 mg/dl" fasting', parseSugar('160 mg/dl', 'fasting')?.value === 160 && parseSugar('160', 'before breakfast')?.context === 'fasting');
  check('sugar implausible', parseSugar('9') === null && parseSugar('none') === null);
  check('BP crisis always alerts', checkBp({ systolic: 185, diastolic: 100 }, {}).outside);
  check('BP above the family range', checkBp({ systolic: 155, diastolic: 88 }, { bpSysMax: 150, bpDiaMax: 95 }).why.includes('150/95'));
  check('BP normal, no range: fine', !checkBp({ systolic: 128, diastolic: 82 }, {}).outside);
  check('sugar low / very high', checkSugar({ value: 62, context: null }, {}).outside && checkSugar({ value: 320, context: null }, {}).outside);
  check('sugar above the family range', checkSugar({ value: 210, context: 'after_food' }, { sugarMax: 180 }).outside && !checkSugar({ value: 140, context: null }, { sugarMax: 180 }).outside);

  console.log('\nA2. Appointments');
  const appt = (h: number, f: Partial<AppointmentRow> = {}): AppointmentRow => ({
    id: `a${h}`, title: 'eye check-up', kind: 'doctor', startsAt: new Date(now.getTime() + h * 3600000), location: 'Apollo', notes: null,
    fasting: false, remindedDayBefore: null, remindedSameDay: null, followedUpAt: null, cancelledAt: null, ...f
  });
  const tomorrow = planAppointments([appt(25, { fasting: true, kind: 'lab', title: 'blood test' })], now);
  check('day-before reminder with fasting note', !!tomorrow.note && tomorrow.note.startsWith('Tomorrow at 10 AM: blood test at Apollo.') && tomorrow.note.includes('not to eat'), tomorrow.note);
  const today = planAppointments([appt(2)], now);
  check('same-day reminder', today.note?.startsWith('Today at 11 AM') === true && today.reminded[0].which === 'same_day', today);
  check('already reminded: nothing', planAppointments([appt(2, { remindedSameDay: now })], now).note === null);
  check('cancelled: nothing', planAppointments([appt(2, { cancelledAt: now })], now).note === null);
  const after = planAppointments([appt(-5)], now);
  check('"how did it go?" after the visit', after.followUp?.question === 'How did the eye check-up visit go?', after.followUp);
  check('not asked too soon or too late', planAppointments([appt(-1)], now).followUp === null && planAppointments([appt(-120)], now).followUp === null);
  const theirAppt = planAppointments([appt(25, { who: 'Appa', kind: 'lab', title: 'blood test' }), appt(-5, { id: 'b', who: 'Appa', kind: 'lab', title: 'blood test' })], now);
  check('the other parent\'s appointment is named', theirAppt.note?.startsWith("Tomorrow at 10 AM: Appa's blood test at Apollo.") === true && theirAppt.followUp?.question === "How did Appa's blood test go?", theirAppt);

  console.log('\nA3. Weather and festivals');
  check('extreme heat', weatherNote({ maxC: 43, minC: 30, rainMm: 0 })?.includes('extremely hot') === true);
  check('hot', weatherNote({ maxC: 40, minC: 28, rainMm: 0 })?.includes('very hot') === true);
  check('heavy rain', weatherNote({ maxC: 30, minC: 24, rainMm: 45 })?.includes('Heavy rain') === true);
  check('ordinary day: no note', weatherNote({ maxC: 32, minC: 24, rainMm: 2 }) === null && weatherNote(null) === null);
  const feed = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261108\r\nSUMMARY:Diwali/Deepavali\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261107\r\nSUMMARY:Some\\, Day\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const holidays = parseHolidayFeed(feed);
  check('feed parsed and sorted', holidays.length === 2 && holidays[0].name === 'Some, Day' && holidays[1].date === '2026-11-08', holidays);
  check('upcoming names', upcomingFestivalNames(holidays, now).includes('Diwali/Deepavali'));
  const diwaliDay = new Date(Date.UTC(2026, 10, 8, 3, 30));
  check('greets only festivals they celebrate', specialDayFor({ birthDate: null, festivals: ['Diwali/Deepavali'], specialDays: [], holidays }, diwaliDay) === 'Diwali/Deepavali' &&
    specialDayFor({ birthDate: null, festivals: [], specialDays: [], holidays }, diwaliDay) === null);
  check('birthday comes first', specialDayFor({ birthDate: '11-08', festivals: ['Diwali/Deepavali'], specialDays: [], holidays }, diwaliDay) === 'birthday');
  check('the other parent\'s day says whose', partnerSpecialDay('birthday', 'Appa (Ramesh)') === 'birthday of Appa' &&
    partnerSpecialDay('fasting day (Ekadashi)', 'Appa') === 'fasting day (Ekadashi) for Appa' && partnerSpecialDay('Wedding anniversary', 'Appa') === 'Wedding anniversary (Appa)' && partnerSpecialDay(null, 'Appa') === null);
  check('family-added fasting day', specialDayFor({ birthDate: null, festivals: [], specialDays: [{ date: '11-07', label: 'Ekadashi', kind: 'fast' }], holidays }, now) === 'fasting day (Ekadashi)');

  console.log('\nA4. Money and chemist (Aaptha never handles either)');
  check('UPI ID check', isValidUpiId('ravi.rao@okhdfcbank') && !isValidUpiId('ravi') && !isValidUpiId('a@1'));
  check('share rounds up', shareAmount(1299, 3) === 433 && shareAmount(1299, 1) === 1299);
  const link = upiLink({ upiId: 'ravi@okbank', payeeName: 'Ravi', amount: 433, note: 'Aaptha Family Care 2026-11' });
  check('UPI link', link.startsWith('upi://pay?') && link.includes('pa=ravi%40okbank') && link.includes('am=433.00') && link.includes('cu=INR'), link);
  check('IST month', istMonth(new Date(Date.UTC(2026, 9, 31, 20, 0))) === '2026-11');
  const chem = chemistMessage({ chemistName: 'Sri Sai Medicals', parentName: 'Amma', address: '4 Test Lane', phone: '+91 90000 11111', senderName: 'Ravi', items: [{ name: 'Telmisartan', dosage: '40mg', quantity: '2 strips' }, { name: '', quantity: '' }] });
  check('chemist list', chem.includes('Sri Sai Medicals') && chem.includes('1. Telmisartan 40mg: 2 strips') && chem.includes('Address: 4 Test Lane') && !chem.includes('2.'), chem);

  console.log('\nA4b. Readings in the family summaries');
  const sunday = new Date(Date.UTC(2026, 10, 8, 3, 30)); // Sun 8 Nov 2026, 09:00 IST
  const ago = (days: number) => new Date(sunday.getTime() - days * DAY);
  const R = (kind: string, d: number, a: number, b?: number, context: string | null = null): ReadingFact =>
    kind === 'bp' ? { kind, systolic: a, diastolic: b!, value: null, context: null, takenAt: ago(d) } : { kind, systolic: null, diastolic: null, value: a, context, takenAt: ago(d) };
  const week = [R('bp', 1, 138, 86), R('bp', 3, 156, 96), R('bp', 5, 140, 88), R('bp', 9, 132, 82), R('bp', 11, 136, 84),
    R('sugar', 2, 128, undefined, 'fasting'), R('sugar', 4, 136, undefined, 'fasting'), R('sugar', 2, 175, undefined, 'after_food')];
  const wl = readingsLine(week, { period: 'weekly', now: sunday, ranges: { bpSysMax: 150, bpDiaMax: 95 } });
  check('weekly: BP average, highest day, last week', wl?.includes('BP 3 times, average 145/90, highest 156/96 (Thu), previous week 134/83') === true, wl);
  check('weekly: fasting and after-food sugar apart', wl?.includes('sugar 3 times, fasting average 132, after food 175') === true, wl);
  check('weekly: counts readings outside the limits, no judgement words', wl?.endsWith('1 outside the limits.') === true && !/good|bad|normal/i.test(wl!), wl);
  const dl = readingsLine(week, { period: 'daily', now: sunday });
  check('daily: just the numbers', dl === 'Readings: BP 138/86.', dl);
  check('nothing to say: no line', readingsLine([R('bp', 20, 130, 80)], { period: 'weekly', now: sunday }) === null);
  const noCalls = parentSummary('Amma', [], { period: 'weekly', now: sunday, readings: week });
  check('typed-in readings show even without calls', noCalls.startsWith('Amma: no check-in calls in this period. Readings: BP 3 times'), noCalls);

  console.log('\nA5. Call planning with what the family set up');
  const rhythm = { parentConsent: 'given', lastSafetyLineAt: now, lastWellbeingAt: now, lastRefillCheckAt: now, birthDate: null };
  const family = (f: Partial<FamilyAsks> = {}): FamilyAsks => ({
    messages: [{ id: 'm1', authorName: 'Ravi', text: "I'll call  on Sunday." }, { id: 'm2', authorName: 'Priya', text: 'Love you' }, { id: 'm3', authorName: 'Ravi', text: 'third' }],
    appointments: [appt(25)],
    readingsToAsk: ['bp', 'sugar'],
    readingsTakenToday: ['sugar'],
    weatherNote: 'It will be very hot today, around 40 degrees. Please drink plenty of water.',
    helper: { name: 'Lakshmi', days: [6], askedToday: false, lastCallOfDay: true },
    hearingMode: true,
    specialDay: 'Diwali/Deepavali',
    ...f
  });
  const ex = planCallExtras({ callType: 'reminder', rhythm, lastAnswered: null, activeMedicineNames: ['X'], answeredToday: false, now, family: family() });
  check('family messages are retired: nothing is read out', !ex.familyMessage && !ex.familyMessageIds, ex.familyMessage);
  check('appointment reminder', ex.appointmentNote?.startsWith('Tomorrow') === true && ex.appointmentReminded?.[0]?.which === 'day_before');
  check('only readings not yet taken today', ex.askReadings?.join() === 'bp', ex.askReadings);
  check('weather, festival, hearing mode', !!ex.weatherNote && ex.specialDay === 'Diwali/Deepavali' && ex.hearingMode === true);
  check('helper asked on their day, last call', ex.helperQuestion === 'Did Lakshmi come today?');
  check('helper not asked on other calls', !planCallExtras({ callType: 'reminder', rhythm, lastAnswered: null, activeMedicineNames: [], answeredToday: false, now, family: family({ helper: { name: 'Lakshmi', days: [6], askedToday: false, lastCallOfDay: false } }) }).helperQuestion);
  const fu = planCallExtras({ callType: 'followup', rhythm, lastAnswered: null, activeMedicineNames: [], answeredToday: true, now, family: family() });
  check('follow-up: nothing extra', !fu.familyMessage && !fu.appointmentNote && !fu.askReadings && !fu.weatherNote && !fu.helperQuestion && !fu.specialDay);
  // Daily Touches only go where the call has room (baseSeconds = what the call already holds).
  const roomy = planCallExtras({ callType: 'reminder', rhythm, lastAnswered: null, activeMedicineNames: [], answeredToday: false, now, family: family({ appointments: [], baseSeconds: 20 }) });
  check('room on the call: wish, weather and helper all go on', roomy.specialDay === 'Diwali/Deepavali' && !!roomy.weatherNote && !!roomy.helperQuestion, roomy);
  const tight = planCallExtras({ callType: 'reminder', rhythm, lastAnswered: null, activeMedicineNames: [], answeredToday: false, now, family: family({ appointments: [], baseSeconds: 40 }) });
  check('40 s already: the wish and the weather fit (12 s), the helper check (8 s) does not', tight.specialDay === 'Diwali/Deepavali' && !!tight.weatherNote && !tight.helperQuestion, tight);
  const full = planCallExtras({ callType: 'reminder', rhythm, lastAnswered: null, activeMedicineNames: [], answeredToday: false, now, family: family({ appointments: [], baseSeconds: 55 }) });
  check('a call already at the limit gets no touches (but the hearing mode stays)', !full.specialDay && !full.weatherNote && !full.helperQuestion && full.hearingMode === true, full);
  const withAppt = planCallExtras({ callType: 'reminder', rhythm, lastAnswered: null, activeMedicineNames: [], answeredToday: false, now, family: family({ baseSeconds: 36 }) });
  check('an appointment reminder (12 s) uses up the room first', !!withAppt.appointmentNote && !withAppt.weatherNote && !withAppt.helperQuestion, withAppt);
  check('companion: no readings', !planCallExtras({ callType: 'companion', rhythm, lastAnswered: null, activeMedicineNames: [], answeredToday: false, now, family: family() }).askReadings);
  check('greeting only on the first answered call', planCallExtras({ callType: 'reminder', rhythm, lastAnswered: null, activeMedicineNames: [], answeredToday: true, now, family: family() }).specialDay === null);

  console.log('\nA6. Agent variables and couple calls');
  const vars = buildAgentVariables({
    callLogId: 'c', parentId: 'p', slot: 'morning', slotLabel: 'Morning', parentName: 'Amma', parentPhone: '+919000000001', language: 'Telugu',
    caregiverName: 'Ravi', relationship: 'Mother', medicines: [MED('Telmisartan')], familyMessage: 'From Ravi: hi', appointmentNote: 'Tomorrow…',
    appointmentQuestion: 'How did it go?', askReadings: ['bp', 'sugar'], weatherNote: 'Hot', hearingMode: true, helperQuestion: 'Did Lakshmi come today?',
    partner: { name: 'Appa', medicines: [MED('Metformin')], askReadings: ['sugar'] }
  });
  check('new variables', vars.family_message === 'From Ravi: hi' && vars.ask_readings === 'blood pressure (BP), blood sugar' && vars.hearing_mode === 'yes' && vars.helper_question.startsWith('Did'));
  check('partner variables', vars.partner_name === 'Appa' && vars.partner_has_medicines === 'yes' && vars.partner_medicines_checklist.includes('Metformin') && vars.partner_ask_readings === 'blood sugar');
  const none = buildAgentVariables({ callLogId: 'c', parentId: 'p', slot: 's', slotLabel: 'l', parentName: 'n', parentPhone: '+91', language: 'Hindi', caregiverName: 'c', relationship: 'r', medicines: [] });
  check('defaults "none" / "no"', none.partner_name === 'none' && none.family_message === 'none' && none.hearing_mode === 'no' && none.ask_readings === 'none');

  const payload = {
    final_agent_variables: {
      all_medicines_taken: 'yes', mood: 'calm', bp_reading: '165/95', helper_visited: 'no', appointment_update: 'Doctor changed the BP tablet dose',
      memory_title: 'The wedding in 1971', memory_story: 'Amma remembered her wedding in Rajahmundry in 1971, the rain that day, and how the whole street came to help.',
      partner_medicines_missed: 'Metformin', partner_mood: 'anxious', partner_sugar_reading: '210', partner_sugar_when: 'after_food', partner_health_concern: 'none'
    },
    interaction_transcript: [{ role: 'user', en_text: 'yes I took it, BP was 165 by 95' }]
  };
  const mine = interpretCallResult(payload, [MED('Telmisartan')], 'Amma');
  check('own readings, helper, appointment, memory', mine.bp?.systolic === 165 && mine.helperVisited === 'no' && !!mine.appointmentUpdate && mine.memory?.title === 'The wedding in 1971');
  const theirs = interpretCallResult(partnerPayload(payload), [MED('Metformin')], 'Appa');
  check('partner answers mapped', theirs.medicineResults[0].status === 'missed' && theirs.mood === 'anxious' && theirs.sugar?.value === 210 && theirs.bp === null && theirs.memory === null, theirs);
  const myAlerts = decideAlerts(mine, 'Amma', 'morning', { ranges: { bpSysMax: 150 }, helperName: 'Lakshmi' });
  check('reading out of range → level 3', myAlerts.some(a => a.title === ALERT_TITLES.reading && a.level === 3 && a.message.includes('165/95')), myAlerts);
  check('helper missed → level 2', myAlerts.some(a => a.title === ALERT_TITLES.helperMissed && a.message.includes('Lakshmi')));
  check('no helper alert unless asked', !decideAlerts(mine, 'Amma', 'morning', {}).some(a => a.title === ALERT_TITLES.helperMissed));
  const scanned = interpretCallResult({ interaction_transcript: [{ role: 'user', en_text: 'I have chest pain' }] }, [], 'Appa');
  check('couple: scan stays with the first parent', !decideAlerts(scanned, 'Appa', 'morning', { skipScan: true }).some(a => a.level === 4) && decideAlerts(scanned, 'Amma', 'morning').some(a => a.level === 4));
  check('update text carries readings', describeAnsweredCall({ slotLabel: 'morning', medicineResults: [], extra: ['BP 165/95'] }).includes('BP 165/95.'));

  const P = (id: string, f: Record<string, unknown> = {}) => ({ id, userId: 'u', phone: '+919000000009', callTogetherWithId: id === 'a' ? 'b' : 'a', isPaused: false, isDeleted: false, parentConsent: 'given', ...f });
  const map = new Map([['a', P('a')], ['b', P('b')]]);
  check('couple: smaller id is called', coupleOf(map.get('a')!, map)?.primary === true && coupleOf(map.get('b')!, map)?.primary === false);
  const paused = new Map([['a', P('a')], ['b', P('b', { isPaused: true })]]);
  check('couple off when one is paused', coupleOf(paused.get('a')!, paused) === null);
  const notAsked = new Map([['a', P('a')], ['b', P('b', { parentConsent: 'pending' })]]);
  check('couple off until both said yes', coupleOf(notAsked.get('a')!, notAsked) === null);
  const otherPhone = new Map([['a', P('a')], ['b', P('b', { phone: '+919000000008' })]]);
  check('couple off on different phones', coupleOf(otherPhone.get('a')!, otherPhone) === null);
}

// ============================================================================
// PART B
// ============================================================================
function fakeConfig(): SarvamConfig {
  return {
    apiKey: 'k', orgId: 'o', workspaceId: 'w', appId: 'app_1', appVersion: 1, connectionId: 'c',
    agentPhoneNumber: '+910000000000', apiBase: 'http://sarvam.test/api/outbounds', webhookSecret: 's', appUrl: 'http://app.test'
  };
}

async function partB() {
  console.log('\nB. Flows against throwaway database rows');
  const calls: Array<{ vars: Record<string, string>; attemptId: string; to: string }> = [];
  let n = 0;
  const sarvamFetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    n += 1;
    const attemptId = `att_extra_${Date.now()}_${n}`;
    calls.push({ vars: body.app_config.agent_variables, attemptId, to: body.user_config.user_phone_number });
    return new Response(JSON.stringify({ attempt_id: attemptId }), { status: 200 });
  }) as unknown as typeof fetch;
  const weatherFetch = (async () => new Response(JSON.stringify({ daily: { temperature_2m_max: [41], temperature_2m_min: [29], precipitation_sum: [0] } }), { status: 200 })) as unknown as typeof fetch;
  const emails: string[] = [];
  const alertDeps = {
    whatsapp: null, config: null, alertAgent: null,
    sendEmail: (async (p: { alertType: string }) => (emails.push(p.alertType), { success: true })) as never
  };
  const cfg = fakeConfig();
  const at = (d: number, h: number, m: number) => new Date(Date.UTC(2026, 10, d, h, m)); // November 2026, UTC
  const holidays = [{ date: '2026-11-08', name: 'Diwali/Deepavali' }];
  const stamp = Date.now();

  const stale = await prisma.user.findMany({ where: { email: { startsWith: 'extras-test-' }, createdAt: { lt: new Date(Date.now() - 3600000) } }, select: { id: true } });
  if (stale.length) await prisma.user.deleteMany({ where: { id: { in: stale.map(u => u.id) }, email: { startsWith: 'extras-test-' } } });

  const owner = await prisma.user.create({
    data: {
      id: newId('usr'), name: 'Ravi Extras', email: `extras-test-${stamp}@example.com`,
      subscription: { create: { id: newId('sub'), planId: 'family', status: 'active', currentPeriodEnd: new Date(Date.now() + 60 * DAY), amount: 1699, healthMonitor: true, dailyTouches: true } },
      notificationPreferences: { create: {} }
    }
  });
  const member = await prisma.user.create({ data: { id: newId('usr'), name: 'Priya Extras', email: `extras-test-m-${stamp}@example.com`, notificationPreferences: { create: {} } } });

  try {
    const mk = async (name: string, meds: LinkedMedicineDetail[], extra: Record<string, unknown>) =>
      prisma.parentProfile.create({
        data: {
          id: newId('parent'), userId: owner.id, name, relationship: name === 'Amma X' ? 'Mother' : 'Father', phone: '+919000077777', language: 'Telugu',
          consentGiven: true, parentConsent: 'given', createdAt: new Date(Date.UTC(2026, 9, 1)),
          callSchedule: { create: [{ id: newId('slot'), time: '08:30 AM', slot: 'morning', label: 'Morning', linkedMedicineNames: meds.map(m => m.name), linkedMedicinesJson: JSON.stringify(meds) }] },
          medicines: { create: meds.map(m => ({ id: newId('med'), name: m.name, dosage: '1 tab', timeOfDay: 'morning', timingSlots: ['morning'] })) },
          ...extra
        },
        include: { callSchedule: true }
      });
    const amma = await mk('Amma X', [MED('Telmisartan')], {
      readingsToAsk: ['bp'], readingRanges: JSON.stringify({ bpSysMax: 150 }), helperName: 'Lakshmi', helperDays: [0, 1, 2, 3, 4, 5, 6],
      latitude: 17.38, longitude: 78.48, city: 'Hyderabad', festivals: ['Diwali/Deepavali']
    });
    const appa = await mk('Appa X', [MED('Metformin')], { readingsToAsk: ['sugar'] });
    const [primary, secondary] = amma.id < appa.id ? [amma, appa] : [appa, amma];
    const scope = [amma.id, appa.id];
    const secWho = secondary.name.split(' ')[0];
    // Set up on the SECOND parent: they must still reach the one call the couple gets.
    await prisma.familyMessage.create({ data: { id: newId('msg'), parentId: secondary.id, userId: owner.id, authorName: 'Ravi', direction: 'to_parent', text: 'I will call on Sunday' } });
    await prisma.appointment.create({ data: { id: newId('appt'), parentId: secondary.id, createdById: owner.id, title: 'blood test', kind: 'lab', startsAt: at(9, 4, 30), location: 'Vijaya Labs', fasting: true } });

    console.log('\nB1. Linking the couple');
    check('linked both ways', (await setCallTogether(amma.id, appa.id)).ok);
    const otherPhone = await prisma.parentProfile.create({ data: { id: newId('parent'), userId: owner.id, name: 'Aunty X', relationship: 'Aunt', phone: '+919000066666', consentGiven: true } });
    check('different phones refused', !(await setCallTogether(amma.id, otherPhone.id)).ok);

    console.log('\nB2. One call for both, with everything the family set up (Diwali eve, 7 Nov)');
    // Diwali is 8 Nov; make the greeting test on 8 Nov morning instead.
    const s1 = await runDispatch({ now: at(8, 3, 30), fetchImpl: sarvamFetch, config: cfg, alertDeps, parentIds: scope, weatherFetch, holidays, baseSecondsOverride: 10 });
    check('one call placed, not two', s1.placed === 1 && calls.length === 1, s1);
    const v = calls[0]?.vars || {};
    check('the first parent is called, about both', v.parent_name === primary.name && v.partner_name === secondary.name, { p: v.parent_name, q: v.partner_name });
    check('both checklists', v.medicines_checklist.includes(primary.name === 'Amma X' ? 'Telmisartan' : 'Metformin') && v.partner_medicines_checklist.includes(secondary.name === 'Amma X' ? 'Telmisartan' : 'Metformin'));
    check('family messages are retired: a waiting message is not read out', v.family_message === 'none', v.family_message);
    check('the other parent\'s appointment (tomorrow, empty stomach)', v.appointment_note.startsWith(`Tomorrow at 10 AM: ${secWho}'s blood test at Vijaya Labs.`) && v.appointment_note.includes('not to eat'), v.appointment_note);
    const ammaFirst = primary.id === amma.id;
    check('readings asked per person', ammaFirst ? (v.ask_readings === 'blood pressure (BP)' && v.partner_ask_readings === 'blood sugar') : (v.ask_readings === 'blood sugar' && v.partner_ask_readings === 'blood pressure (BP)'), v);
    // Set on Amma; the household gets them whichever parent is rung.
    check('weather note on a hot day', v.weather_note.includes('very hot'), v.weather_note);
    check('Diwali greeting (they celebrate it)', v.special_day === 'Diwali/Deepavali', v.special_day);
    check('helper question', v.helper_question === 'Did Lakshmi come today?', v.helper_question);

    console.log('\nB3. Both answer');
    const primaryVars = ammaFirst
      ? { all_medicines_taken: 'yes', mood: 'calm', bp_reading: '165/95', helper_visited: 'no', feedback: 'tell Ravi to bring my glasses',
          memory_title: 'Our wedding', memory_story: 'She remembered the wedding in Rajahmundry in 1971 and how the whole street came to help when it rained.' }
      : { all_medicines_taken: 'yes', mood: 'calm', sugar_reading: '140', helper_visited: 'no', feedback: 'tell Ravi to bring my glasses',
          memory_title: 'Our wedding', memory_story: 'He remembered the wedding in Rajahmundry in 1971 and how the whole street came to help when it rained.' };
    const partnerVars = ammaFirst
      ? { partner_medicines_later: 'Metformin', partner_mood: 'calm', partner_sugar_reading: '140' }
      : { partner_medicines_later: 'Telmisartan', partner_mood: 'calm', partner_bp_reading: '165/95' };
    const r3 = await processSarvamWebhook({
      attempt_id: calls[0].attemptId, status: 'connected', duration: 120,
      final_agent_variables: { ...primaryVars, ...partnerVars },
      interaction_transcript: [{ role: 'user', en_text: 'Yes we are both here, I took my tablet' }]
    }, { now: at(8, 3, 34), deps: alertDeps });
    check('processed, with a follow-up for the partner\'s "later"', r3.status === 'processed' && !!r3.followUpAt, r3);
    const pLog = await prisma.callLog.findUnique({ where: { providerAttemptId: calls[0].attemptId } });
    const sLog = pLog?.pairedCallLogId ? await prisma.callLog.findUnique({ where: { id: pLog.pairedCallLogId } }) : null;
    check('partner gets their own linked call log', !!sLog && sLog.parentId === secondary.id && sLog.status === 'answered' && sLog.pairedCallLogId === pLog!.id);
    const bp = await prisma.healthReading.findFirst({ where: { parentId: amma.id, kind: 'bp' } });
    check('BP saved for Amma', bp?.systolic === 165 && bp.diastolic === 95);
    check('sugar saved for Appa', (await prisma.healthReading.findFirst({ where: { parentId: appa.id, kind: 'sugar' } }))?.value === 140);
    check('BP above the family range → level 3 for Amma', !!(await prisma.alertRecord.findFirst({ where: { parentId: amma.id, title: ALERT_TITLES.reading, level: 3 } })));
    const helperAlert = await prisma.alertRecord.findFirst({ where: { parentId: primary.id, title: ALERT_TITLES.helperMissed } });
    check('helper missed → level 2, naming the helper', helperAlert?.level === 2 && helperAlert.message.includes('Lakshmi'), helperAlert?.message);
    check('and it stays unsent (never delivered)', (await prisma.familyMessage.findFirst({ where: { parentId: secondary.id, direction: 'to_parent' } }))?.status === 'pending');
    check('the parent\'s message back is kept', !!(await prisma.familyMessage.findFirst({ where: { parentId: primary.id, direction: 'from_parent', text: { contains: 'glasses' } } })));
    check('the other parent\'s appointment marked reminded', !!(await prisma.appointment.findFirst({ where: { parentId: secondary.id } }))?.remindedDayBefore);
    check('life stories are retired: nothing is saved', (await prisma.lifeStory.count({ where: { parentId: primary.id } })) === 0);
    check('weather noted for today', !!(await prisma.parentProfile.findUnique({ where: { id: primary.id } }))?.lastWeatherNoteAt);

    console.log('\nB4. Follow-up about the partner\'s "later" tablet');
    const before = calls.length;
    const s4 = await runDispatch({ now: at(8, 4, 15), fetchImpl: sarvamFetch, config: cfg, alertDeps, parentIds: scope, weatherFetch, holidays, baseSecondsOverride: 10 });
    const f = calls[before];
    check('one follow-up placed', s4.followUps === 1 && !!f, s4);
    check('only the partner\'s tablet, nothing else', f?.vars.call_type === 'followup' && f.vars.has_medicines === 'no' && f.vars.partner_has_medicines === 'yes' && f.vars.appointment_note === 'none', f?.vars);

    console.log('\nB5. "How did the blood test go?" the day after');
    await processSarvamWebhook({ attempt_id: f.attemptId, status: 'connected', final_agent_variables: { partner_all_medicines_taken: 'yes' }, interaction_transcript: [{ role: 'user', en_text: 'yes took it' }] }, { now: at(8, 4, 17), deps: alertDeps });
    const before5 = calls.length;
    await runDispatch({ now: at(9, 9, 0), fetchImpl: sarvamFetch, config: cfg, alertDeps, parentIds: scope, weatherFetch, holidays, baseSecondsOverride: 10 });
    // 9 Nov 08:30 IST slot isn't due at 14:30 IST; use the next morning instead.
    await runDispatch({ now: at(10, 3, 30), fetchImpl: sarvamFetch, config: cfg, alertDeps, parentIds: scope, weatherFetch, holidays, baseSecondsOverride: 10 });
    const c5 = calls.slice(before5).find(c => c.vars.appointment_question !== 'none');
    check('asks how the other parent\'s test went', c5?.vars.appointment_question === `How did ${secWho}'s blood test go?`, calls.slice(before5).map(c => c.vars.appointment_question));
    if (c5) {
      await processSarvamWebhook({
        attempt_id: c5.attemptId, status: 'connected', final_agent_variables: { all_medicines_taken: 'yes', appointment_update: 'The test went fine, results on Friday' },
        interaction_transcript: [{ role: 'user', en_text: 'it went fine' }]
      }, { now: at(10, 3, 33), deps: alertDeps });
      const a = await prisma.appointment.findFirst({ where: { parentId: secondary.id } });
      check('answer kept on the appointment', a?.outcomeText === 'The test went fine, results on Friday' && !!a.followedUpAt);
    }

    console.log('\nB6. Nobody answers a couple call');
    const before6 = calls.length;
    await runDispatch({ now: at(11, 3, 30), fetchImpl: sarvamFetch, config: cfg, alertDeps, parentIds: scope, weatherFetch, holidays, baseSecondsOverride: 10 });
    const c6 = calls[before6];
    await processSarvamWebhook({ attempt_id: c6.attemptId, status: 'no_answer' }, { now: at(11, 3, 32), deps: alertDeps });
    const p6 = await prisma.callLog.findUnique({ where: { providerAttemptId: c6.attemptId } });
    const s6 = p6?.pairedCallLogId ? await prisma.callLog.findUnique({ where: { id: p6.pairedCallLogId } }) : null;
    check('partner\'s log shows the missed call too', s6?.status === 'unanswered' && s6.parentId === secondary.id);
    check('retry stays a couple call', !!p6?.nextRetryAt);
    const before6b = calls.length;
    await runDispatch({ now: at(11, 4, 5), fetchImpl: sarvamFetch, config: cfg, alertDeps, parentIds: scope, weatherFetch, holidays, baseSecondsOverride: 10 });
    check('retry asks about both', calls[before6b]?.vars.partner_name === secondary.name);

    console.log('\nB7. Unlinking: separate calls again');
    await setCallTogether(amma.id, null);
    const before7 = calls.length;
    await runDispatch({ now: at(12, 3, 30), fetchImpl: sarvamFetch, config: cfg, alertDeps, parentIds: scope, weatherFetch, holidays, baseSecondsOverride: 10 });
    check('two separate calls', calls.length - before7 === 2 && calls.slice(before7).every(c => c.vars.partner_name === 'none'));

    console.log('\nB8. Siblings share the bill');
    await prisma.caregiverInvite.create({ data: { id: newId('cg'), parentId: amma.id, email: '', name: 'Priya', role: 'viewer', status: 'accepted', userId: member.id } });
    check('bad UPI ID refused', !(await setUpiId(owner.id, 'ravi')).ok);
    check('UPI ID saved', (await setUpiId(owner.id, 'ravi.extras@okbank')).ok);
    check('member marked as sharing', await setSharesBill(owner.id, member.id, true));
    const ov = await ownerView(owner.id);
    check('Family Care split two ways', ov.perPerson === Math.ceil(PLANS.family.priceMonthly / 2) && ov.members.length === 1 && ov.members[0].sharesBill, ov);
    const mv = await memberView(member.id);
    check('member sees their share and a UPI link', mv.length === 1 && mv[0].amount === Math.ceil(PLANS.family.priceMonthly / 2) && !!mv[0].upiLink?.includes(`am=${Math.ceil(PLANS.family.priceMonthly / 2)}.00`), mv);
    check('"I\'ve paid" recorded', (await markSharePaid(owner.id, member.id, true)).ok && (await ownerView(owner.id)).members[0].paidThisMonth);
    check('non-sharer can\'t mark paid', !(await markSharePaid(owner.id, owner.id, true)).ok);
  } finally {
    await prisma.whatsAppMessage.deleteMany({ where: { userId: { in: [owner.id, member.id] } } });
    await prisma.billShare.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.delete({ where: { id: member.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: owner.id } });
    const left = await prisma.user.count({ where: { email: { startsWith: 'extras-test-' } } });
    const orphans = await prisma.parentProfile.count({ where: { phone: { in: ['+919000077777', '+919000066666'] } } });
    console.log(`\nCleanup: ${left === 0 && orphans === 0 ? 'clean' : 'LEFTOVER ROWS!'}`);
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
