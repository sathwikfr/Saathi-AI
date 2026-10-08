/**
 * Remind plan (WhatsApp medicine checks) + plan tier tests: `npx tsx scripts/test-whatsapp-reminders.ts`
 *
 * Part A: pure logic (wording, START codes, plans, course end dates, warning words, rotating health question,
 *         WhatsApp allowance, one call retry).
 * Part B: the whole Remind flow against THROWAWAY rows in the real database (`reminder-test-*@example.com`),
 *         with a fake Meta Graph API, a fake Sarvam, a fake email sender and a fake clock.
 *         Nothing reaches a real phone. Every test row is deleted at the end.
 */
import 'dotenv/config';
import './lib/testDb';
import { prisma } from '../src/lib/prisma';
import { newId, createParent, setMedicinesForParent, newReminderStartCode, setCaretaker } from '../src/lib/db';
import { WhatsAppConfig, buildTemplateRequest, renderTemplate, WA_PAYLOAD } from '../src/lib/whatsapp';
import {
  runReminders, displayTime, firstName, prettyPhone, reminderMedicineText, reminderParams, listTimes, parseStartCode, cappedSlots, parseTypedAnswer,
  parsePauseToday, tomorrowStartIst, tabletsPerDose, dosesPerDay, parseTopUp, weeklyProgressText, isWeeklyTime, repliesFor,
  REMINDER_REPLIES, CARETAKER_TEXT, REMINDER_EMERGENCY_TITLE, REMINDER_MISSED_TITLE, REMINDER_UNWELL_TITLE, MAX_ASKS, CARETAKER_ALERTS_PER_DAY
} from '../src/lib/reminders';
import { processWhatsAppWebhook } from '../src/lib/whatsappInbound';
import { runDispatch, placeManualCall, medicineIsCurrent, medicineMaps } from '../src/lib/callDispatch';
import { MAX_CALL_ATTEMPTS } from '../src/lib/callResults';
import { wellbeingTopicFor, planCallExtras } from '../src/lib/callPlanning';
import { whatsappAllowed } from '../src/lib/familyNotify';
import { PLANS, smallestPlanFor, reminderChannelFor } from '../src/lib/plans';
import { scanMessage, scanSymptomMessage } from '../src/lib/safety';
import { interpretCallResult, decideAlerts, ALERT_TITLES } from '../src/lib/callInterpretation';
import { PARENT_REPLIES, PARENT_PAUSE_TITLE } from '../src/lib/whatsappInbound';
import { SarvamConfig } from '../src/lib/sarvam';
import { Medicine, ScheduledCallSlot } from '../src/lib/types';
import { dueWhatsappAppointments, AppointmentRow } from '../src/lib/appointments';
import { PHRASES, META_LANGUAGE, waLang, appointmentWords, fill } from '../src/lib/waTranslations';

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

/** IST wall-clock time on a day in October 2026 as a real Date. */
const ist = (day: number, hh: number, mm: number) => new Date(Date.UTC(2026, 9, day, hh, mm) - 330 * 60000);

// ============================================================================
// PART A — pure logic
// ============================================================================
function partA() {
  console.log('\nA1. Wording');
  check('time without leading zero', displayTime('08:05 AM') === '8:05 AM' && displayTime('10:30 PM') === '10:30 PM');
  check('first name', firstName('Priya Sharma') === 'Priya' && firstName('  ') === 'there');
  check('Indian number spaced', prettyPhone('+919876543210') === '+91 98765 43210' && prettyPhone('+447700900123') === '+447700900123');
  const meds = [
    { name: 'Folic acid', dosage: '5 mg after breakfast', foodRelation: 'after_food' as const },
    { name: 'Iron', foodRelation: 'after_food' as const },
    { name: 'Vitamin D' }
  ];
  check('medicine list uses dosage, else food', reminderMedicineText(meds, false) === 'Folic acid (5 mg after breakfast), Iron (after food), Vitamin D', reminderMedicineText(meds, false));
  check('discreet mode names nothing', reminderMedicineText(meds, true) === 'your medicines');
  check('template params', JSON.stringify(reminderParams('Priya Sharma', '08:00 AM', meds.slice(0, 1), false)) === JSON.stringify(['Priya', '8:00 AM', 'Folic acid (5 mg after breakfast)']));
  check('times listed', listTimes(['08:00 AM', '02:00 PM', '09:00 PM']) === '8:00 AM, 2:00 PM and 9:00 PM' && listTimes(['08:00 AM']) === '8:00 AM');
  const body = renderTemplate('reminder', ['Priya', '8:00 AM', 'Folic acid']);
  check('the check asks "did you take…?"', body.startsWith('Hi Priya, did you take your 8:00 AM medicine: Folic acid?'), body);
  const req = buildTemplateRequest('reminder', '+919876543210', ['Priya', '8:00 AM', 'Folic acid'], 'en') as unknown as { template: { name: string; components: Array<{ type: string; parameters: Array<{ payload?: string }> }> } };
  const buttons = req.template.components.filter(c => c.type === 'button');
  check('template aaptha_medicine_check', req.template.name === 'aaptha_medicine_check');
  check('two buttons: Yes, Not yet', buttons.length === 2 && buttons.map(b => b.parameters[0].payload).join(',') === 'rem_taken,rem_not_yet', buttons);
  const missed = CARETAKER_TEXT.missed('Priya Sharma', '08:00 AM', [{ name: 'Iron' }], false, '+919876543210', 1);
  check('caretaker: who, when, what, number', missed.includes('Priya has not confirmed the 8:00 AM medicines (Iron) after 3 reminders') && missed.includes('+91 98765 43210'), missed);
  check('caretaker, discreet: no medicine names', !CARETAKER_TEXT.missed('Priya', '08:00 AM', [{ name: 'Iron' }], true, '+919876543210', 1).includes('Iron'));
  check('second alert of the day says no more today', CARETAKER_TEXT.missed('Priya', '08:00 AM', [], false, '+919876543210', 2).includes('will not send more of these today'));
  check('no pronouns for the person', !/\b(she|he|her|his)\b/i.test(missed + CARETAKER_TEXT.takenLate('Priya', '08:00 AM', '9:40 AM')));
  const alertReq = buildTemplateRequest('caretakerAlert', '+919876543210', ['Priya', 'x'], 'en') as unknown as { template: { name: string; components: Array<{ type: string; parameters: Array<{ payload?: string }> }> } };
  const alertButtons = alertReq.template.components.filter(c => c.type === 'button');
  check("caretaker alert: one button only, \"I'll handle it\"", alertReq.template.name === 'aaptha_caretaker_alert' && alertButtons.length === 1 && alertButtons[0].parameters[0].payload === 'care_ack', alertButtons);
  check('caretaker template has no website button', !(buildTemplateRequest('caretaker', '+919876543210', ['Priya', 'x'], 'en') as unknown as { template: { components: Array<{ type: string }> } }).template.components.some(c => c.type === 'button'));

  console.log('\nA2. START codes');
  const code = newReminderStartCode();
  check('code is 8 characters, no look-alikes', /^[A-HJ-KM-NP-Z2-9]{8}$/.test(code), code);
  check('START <code> parsed (any case)', parseStartCode(`start ${code.toLowerCase()}`) === code && parseStartCode(`START  ${code}`) === code);
  check('"start please" is not a code', parseStartCode('start please') === null && parseStartCode('START') === null && parseStartCode('start ABCDEFGO') === null);

  console.log('\nA2b. Typed answers');
  check('yes in many forms', ['yes', 'Yes!', 'done', 'haan le liya', 'avunu', 'అవును', 'हाँ', '👍', '👍 thanks', 'yes, but headache'].every(t => parseTypedAnswer(t) === 'yes'));
  check('not yet in many forms', ['no', 'Not yet.', 'nahi', 'ledu', 'ఇంకా లేదు', 'abhi nahi', 'no, I have fever'].every(t => parseTypedAnswer(t) === 'not_yet'));
  check('not answers: "no fever", "hello", "not feeling well", "yesterday"', ['no fever', 'hello', 'not feeling well', 'yesterday'].every(t => parseTypedAnswer(t) === null));

  console.log('\nA2c. "Pause today"');
  check('pause in many forms', ['pause', 'Pause today', 'not today.', 'skip today, travelling', 'aaj nahi', 'ఈరోజు వద్దు', 'indru vendam', 'आज नहीं'].every(t => parsePauseToday(t)));
  check('not a pause: stop, yes, no, "paused?", "today I took it"', ['stop', 'yes', 'no', 'paused?', 'today I took it', 'pausemenow'].every(t => !parsePauseToday(t)));
  check('a pause ends at midnight IST', tomorrowStartIst(ist(6, 23, 50)).toISOString() === ist(7, 0, 0).toISOString() && tomorrowStartIst(ist(6, 0, 10)).toISOString() === ist(7, 0, 0).toISOString());

  console.log('\nA2d. Tablets running out');
  check('tablets per dose from the dosage', tabletsPerDose('2 tablets') === 2 && tabletsPerDose('1 capsule after food') === 1 && tabletsPerDose('5 mg') === 1 && tabletsPerDose('10 tablets') === 1 && tabletsPerDose(undefined) === 1);
  check('doses a day = reminder times that include it', dosesPerDay('iron', [{ linkedMedicineNames: ['Iron'] }, { linkedMedicineNames: ['Folic acid', 'IRON'] }, { linkedMedicineNames: [] }]) === 2);
  const two = [{ name: 'Iron', counted: true }, { name: 'Folic acid', counted: false }];
  check('"Iron 30", "30 iron tablets", "bought 30 Folic acid"', JSON.stringify(parseTopUp('Iron 30', two)) === '{"name":"Iron","count":30}' && parseTopUp('30 iron tablets', two)?.name === 'Iron' && parseTopUp('bought 30 Folic acid', two)?.name === 'Folic acid');
  check('bare number: the one counted medicine', parseTopUp('30', two)?.name === 'Iron' && parseTopUp('30', [{ name: 'A', counted: true }, { name: 'B', counted: true }])?.name === null);
  check('not a refill: "fever 102", "I took 2", two numbers, zero', [parseTopUp('fever 102', two), parseTopUp('I took 2', two), parseTopUp('Iron 30 Folic acid 20', two), parseTopUp('0', two)].every(x => x === null));
  check('running-low wording', REMINDER_REPLIES.runningLow([{ name: 'Iron', left: 6, days: 3 }]).startsWith('Iron is running low: 6 tablets left, about 3 days.') && REMINDER_REPLIES.runningLow([{ name: 'Iron', left: 0, days: 0 }]).startsWith('By my count your Iron tablets have run out.'));

  console.log('\nA2e. Check-up reminders on WhatsApp');
  const appt = (over: Partial<AppointmentRow> = {}): AppointmentRow => ({
    id: 'a1', title: 'scan', kind: 'doctor', startsAt: ist(17, 10, 0), location: 'Apollo Clinic', notes: null, fasting: true,
    remindedDayBefore: null, remindedSameDay: null, followedUpAt: null, cancelledAt: null, ...over
  });
  check('nothing before 6 PM the evening before', dueWhatsappAppointments([appt()], ist(16, 17, 59)).length === 0);
  const eve = dueWhatsappAppointments([appt()], ist(16, 18, 0));
  check('evening before: one line with time, place and empty stomach', eve.length === 1 && eve[0].which === 'day_before' && eve[0].text === 'Tomorrow at 10 AM: scan at Apollo Clinic. Needs an empty stomach.', eve);
  check('not again once sent', dueWhatsappAppointments([appt({ remindedDayBefore: ist(16, 18, 5) })], ist(16, 20, 0)).length === 0);
  check('nothing before 7 AM on the day', dueWhatsappAppointments([appt({ remindedDayBefore: ist(16, 18, 5) })], ist(17, 6, 59)).length === 0);
  check('morning of: today at 10 AM', dueWhatsappAppointments([appt({ remindedDayBefore: ist(16, 18, 5) })], ist(17, 7, 0))[0]?.text.startsWith('Today at 10 AM: scan at Apollo Clinic.') === true);
  check('never once it has started, or when cancelled', dueWhatsappAppointments([appt()], ist(17, 10, 30)).length === 0 && dueWhatsappAppointments([appt({ cancelledAt: new Date() })], ist(16, 19, 0)).length === 0);
  check('notes stay on one line (Meta rule)', !/[\n\t]/.test(dueWhatsappAppointments([appt({ notes: 'bring\nold  reports' })], ist(16, 19, 0))[0].text));
  const tpl = buildTemplateRequest('appointment', '+919876543210', ['Priya', 'Tomorrow at 10 AM: scan'], 'en') as unknown as { template: { name: string; components: Array<{ type: string }> } };
  check('template aaptha_appointment_reminder, no buttons', tpl.template.name === 'aaptha_appointment_reminder' && !tpl.template.components.some(c => c.type === 'button'));

  console.log('\nA2f. Weekly progress');
  check('all taken: well done', weeklyProgressText(14, 14) === 'This week you confirmed all 14 medicine checks. Well done! 💪');
  check('mostly: "13 of 14", still kind', weeklyProgressText(13, 14) === 'This week you confirmed 13 of 14 medicine checks. Well done! 💪');
  check('fewer: no scolding, a fresh week', weeklyProgressText(6, 14) === 'This week you confirmed 6 of 14 medicine checks. A fresh week starts tomorrow.');
  check('one line only (Meta rule)', !/[\n\t]/.test(weeklyProgressText(6, 14)));
  check('only Sunday from 6 PM IST', isWeeklyTime(ist(11, 18, 0)) && !isWeeklyTime(ist(11, 17, 59)) && !isWeeklyTime(ist(12, 19, 0)) && !isWeeklyTime(ist(10, 19, 0)));

  console.log('\nA2g. Messages in the person\'s language');
  const langs = Object.keys(PHRASES) as Array<keyof typeof PHRASES>;
  check('8 languages besides English', langs.length === 8 && langs.every(l => META_LANGUAGE[l] === l));
  check('"Telugu" -> te, "Hindi" and "Hindi & English" -> hi, "English" -> en', waLang('Telugu') === 'te' && waLang('Hindi') === 'hi' && waLang('Hindi & English') === 'hi' && waLang('English') === 'en' && waLang(null) === 'hi');
  const refKeys = Object.keys(PHRASES.hi).sort().join();
  check('every language has every phrase, none empty', langs.every(l => Object.keys(PHRASES[l]).sort().join() === refKeys && Object.values(PHRASES[l]).every(v => typeof v === 'string' && v.trim().length > 0)));
  const bad: string[] = [];
  for (const l of langs) {
    const R = repliesFor(l === 'hi' ? 'Hindi' : { te: 'Telugu', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', bn: 'Bengali', mr: 'Marathi', gu: 'Gujarati' }[l]);
    const all = [
      R.started('Priya Rao', ['08:00 AM', '09:00 PM'], 'Ravi Kumar'), R.started('Priya Rao', ['08:00 AM'], null), R.restarted, R.stopped, R.taken('8:10 AM'),
      R.courseDone, R.notYet('8:40 AM'), R.notYetLast('9:10 AM', 'Ravi Kumar'), R.notYetLast('9:10 AM', null), R.pausedToday('08:00 AM'), R.pausedToday(null),
      R.alreadyTaken, R.runningLow([{ name: 'Iron', left: 6, days: 3 }, { name: 'Calcium', left: 0, days: 0 }]), R.toppedUp('Iron', 30),
      R.emergency('Priya Rao', 'Ravi Kumar'), R.emergency('Priya Rao', null), R.unwell('Ravi Kumar'), R.unwell(null), weeklyProgressText(14, 14, l), weeklyProgressText(13, 14, l), weeklyProgressText(6, 14, l)
    ];
    if (all.some(t => /\{\w+\}/.test(t) || /undefined|null|NaN/.test(t))) bad.push(`${l}: leftover placeholder`);
    if (!R.stopped.includes('START') || !R.restarted.includes('STOP') || !R.started('Priya', [], null).includes('STOP')) bad.push(`${l}: STOP/START missing`);
    if (!R.emergency('Priya', null).includes('108') || !R.unwell(null).includes('108')) bad.push(`${l}: 108 missing`);
    if (!R.started('Priya Rao', ['08:00 AM'], 'Ravi Kumar').includes('Priya') || R.started('Priya Rao', ['08:00 AM'], 'Ravi Kumar').includes('Rao')) bad.push(`${l}: first names`);
    if (!R.runningLow([{ name: 'Iron', left: 6, days: 3 }]).includes('"Iron 30"')) bad.push(`${l}: top-up example`);
    if (all.some(t => /[\n\t]/.test(weeklyProgressText(6, 14, l)) || t.length > 1000)) bad.push(`${l}: weekly one line / length`);
    const p = PHRASES[l];
    const vars = (t: string) => (t.match(/\{\{\d\}\}/g) || []).join('');
    if (vars(p.tplReminder) !== '{{1}}{{2}}{{3}}' || vars(p.tplAppointment) !== '{{1}}{{2}}' || vars(p.tplWeekly) !== '{{1}}{{2}}') bad.push(`${l}: template variables`);
    if ([p.tplReminder, p.tplAppointment, p.tplWeekly].some(t => /^\{\{/.test(t) || /\}\}$/.test(t.trim()))) bad.push(`${l}: template starts/ends with a variable`);
    if (p.tplYes.length > 25 || p.tplNotYet.length > 25) bad.push(`${l}: button over 25 characters`);
  }
  check('every translation: no leftover placeholders, STOP/START and 108 kept, first names, Meta template rules, buttons ≤ 25', bad.length === 0, bad);
  check('English stays the default; untranslated replies fall back to English', repliesFor('English') === REMINDER_REPLIES && repliesFor('Telugu').badCode === REMINDER_REPLIES.badCode && repliesFor('Telugu').taken('8:10 AM') !== REMINDER_REPLIES.taken('8:10 AM'));
  check('check-up line in Telugu: day word, clock, title and place', dueWhatsappAppointments([appt()], ist(16, 18, 0), appointmentWords('te'))[0].text === `${PHRASES.te.tomorrow} 10 AM: scan, Apollo Clinic.${PHRASES.te.fasting}`, dueWhatsappAppointments([appt()], ist(16, 18, 0), appointmentWords('te')));
  check('fill() leaves Meta placeholders alone', fill('Hi {{1}} {name}', { name: 'X' }) === 'Hi {{1}} X');

  console.log('\nA3. Plans');
  check('Remind (internal id essential): WhatsApp only, ₹149', PLANS.essential.name === 'Remind' && PLANS.essential.channel === 'whatsapp' && PLANS.essential.priceMonthly === 149 && PLANS.essential.callsPerDay === 0);
  check('calling plans keep 3 calls a day', [PLANS.solo, PLANS.family, PLANS.extended].every(p => p.channel === 'call' && p.callsPerDay === 3));
  check('Ask: 10 / 20 / 30, none on Remind', PLANS.solo.askPerMonth === 10 && PLANS.family.askPerMonth === 20 && PLANS.extended.askPerMonth === 30 && PLANS.essential.askPerMonth === 0);
  check('WhatsApp people: 1 / 2 / 5', PLANS.solo.whatsappPeople === 1 && PLANS.family.whatsappPeople === 2 && PLANS.extended.whatsappPeople === 5);
  check('premium: Family and Extended only', !PLANS.solo.premium && !PLANS.essential.premium && PLANS.family.premium && PLANS.extended.premium);
  check('upgrade suggestion is never Remind', smallestPlanFor(1)?.id === 'solo' && smallestPlanFor(2)?.id === 'family');
  check('Remind always means WhatsApp', reminderChannelFor(PLANS.essential, { reminderChannel: null }) === 'whatsapp');
  check('calling plan follows the person', reminderChannelFor(PLANS.solo, { reminderChannel: 'whatsapp' }) === 'whatsapp' && reminderChannelFor(PLANS.solo, { reminderChannel: null }) === 'call');
  check('earliest reminder times win', cappedSlots([{ time: '09:00 PM' }, { time: '08:00 AM' }, { time: 'bad' }, { time: '02:00 PM' }], 2).map(s => s.time).join() === '08:00 AM,02:00 PM');
  check('a missed call is tried once more (2 attempts)', MAX_CALL_ATTEMPTS === 2);

  console.log('\nA4. WhatsApp allowance');
  const person = (id: string, opted: boolean) => ({ id, phone: '+919000000000', notificationPreferences: opted ? { whatsappOptInAt: new Date(), whatsappVerifiedAt: new Date(), whatsapp: true, whatsappNumber: null } : null }) as never;
  const people = [person('owner', true), person('m1', false), person('m2', true), person('m3', true)];
  check('Family: owner + first opted-in member', [...whatsappAllowed(people, 2)].join() === 'owner,m2');
  check('Solo: owner only', [...whatsappAllowed(people, 1)].join() === 'owner');
  check('owner not opted in: the slot goes to a member', [...whatsappAllowed([person('owner', false), person('m1', true)], 1)].join() === 'm1');

  console.log('\nA5. Health questions on the calls');
  const topics = [5, 6, 7, 8].map(d => wellbeingTopicFor(ist(d, 9, 0)));
  check('one topic a day, in turn', new Set(topics.slice(0, 3)).size === 3 && topics[3] === topics[0], topics);
  const rhythm = { parentConsent: 'given', lastSafetyLineAt: new Date(), lastWellbeingAt: null, lastRefillCheckAt: new Date(), birthDate: null };
  const first = planCallExtras({ callType: 'reminder', rhythm, lastAnswered: null, activeMedicineNames: ['A'], answeredToday: false, now: ist(6, 8, 0) });
  const later = planCallExtras({ callType: 'reminder', rhythm, lastAnswered: null, activeMedicineNames: ['A'], answeredToday: true, now: ist(6, 14, 0) });
  check('first call of the day: "how are you feeling" + one health question', !!first.askFeeling && first.wellbeingTopic === wellbeingTopicFor(ist(6, 8, 0)));
  check('later calls: medicines only', !later.askFeeling && !later.wellbeingTopic);

  console.log('\nA6. Course end dates');
  check('no end date: current', medicineIsCurrent({ isActive: true, endsOn: null }, '2026-10-06'));
  check('ends today: still current', medicineIsCurrent({ isActive: true, endsOn: '2026-10-06' }, '2026-10-06'));
  check('ended yesterday: not current', !medicineIsCurrent({ isActive: true, endsOn: '2026-10-05' }, '2026-10-06'));
  const maps = medicineMaps([{ name: 'A', isActive: true, purpose: null, endsOn: '2026-10-05' }, { name: 'B', isActive: true, purpose: null }], '2026-10-06');
  check('ended course leaves the call too', maps.inactiveNames.has('A') && maps.activeNames.join() === 'B');

  console.log('\nA7. Warning words in replies');
  check('"my water broke"', scanMessage('I think my water broke').hit);
  check('"baby is not moving"', scanMessage('the baby is not moving since morning').hit);
  check('negated: "no severe headache"', !scanMessage('no severe headache today, all good').hit);
  check('ordinary reply', !scanMessage('took it with breakfast, thanks').hit);

  console.log('\nA8. Everyday symptoms (fever, headache, dizziness, …)');
  check('fever', scanSymptomMessage('I have fever since morning').hit);
  check('headache + dizzy', scanSymptomMessage('bit of a headache and feeling dizzy').matches.length === 2);
  check('Hindi: chakkar / tabiyat theek nahi', scanSymptomMessage('chakkar aa raha hai').hit && scanSymptomMessage('tabiyat theek nahi hai').hit);
  check('Telugu script: jwaram', scanSymptomMessage('జ్వరం వచ్చింది').hit);
  check('"no fever, no headache" does not count', !scanSymptomMessage('I am fine, no headache, no fever').hit);
  check('whole words only: "company", "cold today"', !scanSymptomMessage('our company is good').hit && !scanSymptomMessage('it is cold today').hit);
  const heardOnCall = interpretCallResult({ status: 'connected', interaction_transcript: [{ role: 'agent', en_text: 'Did you take it?' }, { role: 'user', en_text: 'Yes. I have a headache since morning.' }] }, [], 'Amma');
  const callAlerts = decideAlerts(heardOnCall, 'Amma', 'morning');
  check("calls: a symptom in the parent's words alerts the family (L3) even if the agent missed it", callAlerts.some(a => a.level === 3 && a.title === ALERT_TITLES.health && a.message.includes('headache')), callAlerts);
  const agentSaid = decideAlerts(interpretCallResult({ status: 'connected', interaction_transcript: [{ role: 'agent', en_text: 'If you have fever, tell your family.' }, { role: 'user', en_text: 'Okay.' }] }, [], 'Amma'), 'Amma', 'morning');
  check("calls: Saathi's own words never count", !agentSaid.some(a => a.title === ALERT_TITLES.health));
}

// ============================================================================
// PART B — the Remind flow against throwaway rows
// ============================================================================
interface GraphRequest { url: string; body: { to: string; type: string; template?: { name: string; language?: { code: string }; components: Array<{ type: string; parameters: Array<{ text?: string }> }> }; text?: { body: string } } }

function makeFakeGraph(stamp: number) {
  const requests: GraphRequest[] = [];
  let n = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
    n += 1;
    return new Response(JSON.stringify({ messages: [{ id: `wamid.rem.${stamp}.${n}` }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { requests, fetchImpl };
}

const waConfig: WhatsAppConfig = {
  accessToken: 'wa-token', phoneNumberId: '1234567890', apiVersion: 'v23.0', apiBase: 'http://graph.test',
  templateLanguage: 'en', appUrl: 'http://app.test'
};
const sarvamConfig: SarvamConfig = {
  apiKey: 'test-key', orgId: 'org_1', workspaceId: 'ws_1', appId: 'app_1', appVersion: 2, connectionId: 'conn_1',
  agentPhoneNumber: '+910000000000', apiBase: 'http://sarvam.test/api/outbounds', webhookSecret: 's3cret', appUrl: 'http://app.test'
};
const DAY = '2026-10-06';

const envelope = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', ...value } }] }]
});

async function partB() {
  console.log('\nB. Remind flow against throwaway database rows');
  const stamp = Date.now();
  const d8 = String(stamp).slice(-8);
  const selfPhone = `+9195${d8}`;
  const husbandPhone = `+9194${d8}`;
  const wifePhone = `+9193${d8}`;
  const strangerPhone = `+9192${d8}`;
  const caretakerPhone = `+9191${d8}`;
  const phones = [selfPhone, husbandPhone, wifePhone, strangerPhone, caretakerPhone];

  const graph = makeFakeGraph(stamp);
  const emails: string[] = [];
  const sendEmail = (async (p: { to: string }) => {
    emails.push(p.to);
    return { success: true, simulated: true };
  }) as never;
  const deps = { whatsapp: waConfig, fetchImpl: graph.fetchImpl, sendEmail };
  let inN = 0;
  const say = (from: string, text: string, now: Date) =>
    processWhatsAppWebhook(envelope({ messages: [{ from: from.slice(1), id: `wamid.in.${stamp}.${++inN}`, type: 'text', text: { body: text } }] }), { ...deps, now });
  const tap = (from: string, payload: string, contextId: string, now: Date) =>
    processWhatsAppWebhook(envelope({ messages: [{ from: from.slice(1), id: `wamid.in.${stamp}.${++inN}`, type: 'button', button: { payload, text: payload }, context: { id: contextId } }] }), { ...deps, now });
  const lastText = () => graph.requests[graph.requests.length - 1]?.body.text?.body || '';
  const askId = async (remId: string, n: number) =>
    (await prisma.whatsAppMessage.findFirst({ where: { kind: 'reminder', refKey: `${remId}:ask${n}` } }))?.providerMessageId || '';
  const toCaretaker = (from: number) => graph.requests.slice(from).filter(q => q.body.to === caretakerPhone.slice(1) && (q.body.template?.name === 'aaptha_caretaker_alert' || q.body.template?.name === 'aaptha_caretaker_update'));
  const caretakerSaid = (q: GraphRequest) => q.body.template?.components[0].parameters[1].text || '';
  const remAt = (parentId: string, date: string, time: string) => prisma.medicineReminder.findFirst({ where: { parentId, reminderDate: date, slotTime: time } });

  const userIds: string[] = [];
  try {
    // ---- a self-user on Remind (pays for their own medicine checks)
    const self = await prisma.user.create({
      data: {
        id: newId('usr'), name: 'Priya Reminder', email: `reminder-test-${stamp}@example.com`, phone: selfPhone,
        subscription: { create: { id: newId('sub'), planId: 'essential', status: 'trialing', currentPeriodEnd: new Date(Date.now() + 30 * 86400000), amount: 149 } },
        notificationPreferences: { create: {} }
      }
    });
    userIds.push(self.id);
    const slots = [
      { slot: 'morning', time: '08:00 AM', label: 'Morning', linkedMedicineNames: ['Folic acid', 'Iron', 'Old course'], linkedMedicines: [{ name: 'Folic acid', dosage: '5 mg' }, { name: 'Iron', foodRelation: 'after_food' }, { name: 'Old course' }], isActive: true },
      { slot: 'bedtime', time: '09:00 PM', label: 'Night', linkedMedicineNames: ['Antibiotic'], linkedMedicines: [{ name: 'Antibiotic', dosage: '1 capsule' }], isActive: true }
    ] as unknown as ScheduledCallSlot[];
    const person = await createParent({
      userId: self.id, name: 'Priya', relationship: 'Self', phone: selfPhone, language: 'English', callSchedule: slots,
      consentGiven: true, reminderChannel: 'whatsapp'
    });
    const med = (name: string, endsOn?: string): Medicine => ({ id: newId('med'), parentId: person.id, name, dosage: '1', timeOfDay: 'morning', frequency: 'daily', isActive: true, endsOn });
    await setMedicinesForParent(person.id, [med('Folic acid'), med('Iron'), med('Old course', '2026-10-05'), med('Antibiotic', DAY)]);
    const startCode = (await prisma.parentProfile.findUnique({ where: { id: person.id } }))!.reminderStartCode!;
    check('Remind person is created as WhatsApp, with a START code', person.reminderChannel === 'whatsapp' && /^[A-Z2-9]{8}$/.test(startCode));
    const scope = [person.id];

    console.log('\nB1. Opt-in with START <code>');
    let r = await runReminders({ ...deps, now: ist(6, 8, 5), parentIds: scope });
    check('nothing sent before the person starts', r.sent === 0 && r.peopleChecked === 0, r);
    await say(selfPhone, 'START ZZZZZZZZ', ist(6, 7, 40));
    check('wrong code: told so', lastText() === REMINDER_REPLIES.badCode, lastText());
    await say(selfPhone, `start ${startCode.toLowerCase()}`, ist(6, 7, 45));
    let p = await prisma.parentProfile.findUnique({ where: { id: person.id } });
    check('opted in from this number', !!p?.reminderOptInAt && p.reminderWhatsapp === selfPhone && !p.reminderOptOutAt);
    check('confirmation lists the times', lastText().includes("You're all set, Priya") && lastText().includes('8:00 AM and 9:00 PM'), lastText());
    check('used code is replaced', !!p?.reminderStartCode && p.reminderStartCode !== startCode);
    await say(strangerPhone, `START ${startCode}`, ist(6, 7, 46));
    p = await prisma.parentProfile.findUnique({ where: { id: person.id } });
    check('old code from another phone does nothing', p?.reminderWhatsapp === selfPhone && lastText() === REMINDER_REPLIES.badCode);

    console.log('\nB2. First ask, no calls');
    const before = graph.requests.length;
    r = await runReminders({ ...deps, now: ist(6, 8, 5), parentIds: scope });
    check('one check sent at 8:05', r.sent === 1, r);
    const sentReq = graph.requests[before];
    const params = sentReq?.body.template?.components[0].parameters.map(x => x.text) || [];
    check('to the opted-in number, medicine-check template', sentReq?.body.to === selfPhone.slice(1) && sentReq.body.template?.name === 'aaptha_medicine_check');
    check('names current medicines, not the ended course', params[2] === 'Folic acid (5 mg), Iron (after food)', params);
    r = await runReminders({ ...deps, now: ist(6, 8, 7), parentIds: scope });
    check('not sent twice', r.sent === 0 && r.asked === 0, r);
    const sarvamCalls: unknown[] = [];
    const sarvamFetch = (async (_u: string, init: RequestInit) => { sarvamCalls.push(init.body); return new Response(JSON.stringify({ attempt_id: `att_${stamp}` }), { status: 200 }); }) as unknown as typeof fetch;
    await runDispatch({ now: ist(6, 8, 5), config: sarvamConfig, fetchImpl: sarvamFetch, parentIds: scope });
    check('Saathi never calls a Remind person', sarvamCalls.length === 0);
    const manual = await placeManualCall({ parentId: person.id, requesterId: self.id, kind: 'test' }, { config: sarvamConfig, fetchImpl: sarvamFetch });
    check('test call refused', !manual.ok && manual.code === 'WHATSAPP_ONLY', manual);

    console.log('\nB3. Not yet, asked again, then Yes');
    const rem = (await remAt(person.id, DAY, '08:00 AM'))!;
    await tap(selfPhone, WA_PAYLOAD.notYet, await askId(rem.id, 1), ist(6, 8, 10));
    let row = await prisma.medicineReminder.findUnique({ where: { id: rem.id } });
    check('"Not yet": asked again in 30 minutes', row?.answer === 'not_yet' && lastText() === REMINDER_REPLIES.notYet('8:40 AM'), { a: row?.answer, t: lastText() });
    r = await runReminders({ ...deps, now: ist(6, 8, 35), parentIds: scope });
    check('not before the 30 minutes are up', r.asked === 0, r);
    r = await runReminders({ ...deps, now: ist(6, 8, 41), parentIds: scope });
    row = await prisma.medicineReminder.findUnique({ where: { id: rem.id } });
    check('second ask', r.asked === 1 && row?.askCount === 2, r);
    r = await runReminders({ ...deps, now: ist(6, 9, 12), parentIds: scope });
    row = await prisma.medicineReminder.findUnique({ where: { id: rem.id } });
    check('no reply: third ask 30 minutes later', r.asked === 1 && row?.askCount === MAX_ASKS, r);
    r = await runReminders({ ...deps, now: ist(6, 9, 30), parentIds: scope });
    check('never a fourth ask', r.asked === 0, r);
    await tap(selfPhone, WA_PAYLOAD.taken, await askId(rem.id, 3), ist(6, 9, 35));
    row = await prisma.medicineReminder.findUnique({ where: { id: rem.id } });
    check('Yes recorded', row?.answer === 'taken' && !!row.answeredAt && lastText() === REMINDER_REPLIES.taken('9:35 AM'), lastText());
    await tap(selfPhone, WA_PAYLOAD.notYet, await askId(rem.id, 1), ist(6, 9, 36));
    check('Not yet after Yes keeps Yes', (await prisma.medicineReminder.findUnique({ where: { id: rem.id } }))?.answer === 'taken' && lastText() === REMINDER_REPLIES.alreadyTaken);
    await tap(strangerPhone, WA_PAYLOAD.notYet, await askId(rem.id, 1), ist(6, 9, 37));
    check('a tap from another number is ignored', (await prisma.medicineReminder.findUnique({ where: { id: rem.id } }))?.answer === 'taken');
    r = await runReminders({ ...deps, now: ist(6, 10, 30), parentIds: scope });
    check('a Yes is never marked missed', r.missed === 0, r);

    console.log('\nB4. Last dose of a course');
    await prisma.medicine.updateMany({ where: { parentId: person.id, name: { in: ['Folic acid', 'Iron'] } }, data: { endsOn: DAY } });
    r = await runReminders({ ...deps, now: ist(6, 21, 2), parentIds: scope });
    check('night check sent', r.sent === 1, r);
    const night = (await remAt(person.id, DAY, '09:00 PM'))!;
    await tap(selfPhone, WA_PAYLOAD.taken, await askId(night.id, 1), ist(6, 21, 10));
    check('last dose: "course finished" note', lastText().includes(REMINDER_REPLIES.courseDone), lastText());
    r = await runReminders({ ...deps, now: ist(7, 8, 5), parentIds: scope });
    check('next day: nothing left to check', r.sent === 0, r);
    await prisma.medicine.updateMany({ where: { parentId: person.id, name: { in: ['Folic acid', 'Iron'] } }, data: { endsOn: null } });

    console.log('\nB5. Caretaker: opt-in, missed dose, late Yes');
    await setCaretaker(person.id, { name: 'Ravi Kumar', phone: caretakerPhone });
    const careCode = (await prisma.parentProfile.findUnique({ where: { id: person.id } }))!.caretakerStartCode!;
    let b = graph.requests.length;
    await runReminders({ ...deps, now: ist(8, 8, 5), parentIds: scope });
    await runReminders({ ...deps, now: ist(8, 8, 36), parentIds: scope });
    await runReminders({ ...deps, now: ist(8, 9, 7), parentIds: scope });
    r = await runReminders({ ...deps, now: ist(8, 9, 38), parentIds: scope });
    const day8 = (await remAt(person.id, '2026-10-08', '08:00 AM'))!;
    check('3 asks, then missed', day8.askCount === 3 && day8.answer === 'missed' && r.missed === 1, { asks: day8.askCount, a: day8.answer, r });
    check('caretaker not opted in yet: not messaged', toCaretaker(b).length === 0 && !day8.caretakerAlertedAt);
    check('missed dose shows as a dashboard alert', !!(await prisma.alertRecord.findFirst({ where: { parentId: person.id, title: REMINDER_MISSED_TITLE } })));
    await say(caretakerPhone, `START ${careCode}`, ist(8, 10, 0));
    p = await prisma.parentProfile.findUnique({ where: { id: person.id } });
    check('caretaker opts in with their own link', p?.caretakerWhatsapp === caretakerPhone && !!p.caretakerOptInAt && p.caretakerStartCode !== careCode);
    check('caretaker told what to expect', lastText() === REMINDER_REPLIES.caretakerStarted('Ravi Kumar', 'Priya'), lastText());
    b = graph.requests.length;
    await runReminders({ ...deps, now: ist(9, 8, 5), parentIds: scope });
    await runReminders({ ...deps, now: ist(9, 8, 36), parentIds: scope });
    await runReminders({ ...deps, now: ist(9, 9, 7), parentIds: scope });
    r = await runReminders({ ...deps, now: ist(9, 9, 38), parentIds: scope });
    const day9 = (await remAt(person.id, '2026-10-09', '08:00 AM'))!;
    const care = toCaretaker(b);
    check('no Yes after 3 asks: caretaker asked to call', r.caretakerAlerts === 1 && care.length === 1 && !!day9.caretakerAlertedAt, r);
    check('caretaker message: name, time, medicines, number', caretakerSaid(care[0]).includes('Priya has not confirmed the 8:00 AM medicines (Folic acid, Iron)') && caretakerSaid(care[0]).includes(prettyPhone(selfPhone)), caretakerSaid(care[0]));
    check('caretaker alert carries the "I\'ll handle it" button', care[0].body.template?.name === 'aaptha_caretaker_alert');
    const careMsg = await prisma.whatsAppMessage.findFirst({ where: { kind: 'caretaker_missed', refKey: day9.id } });
    const bAck = graph.requests.length;
    await tap(caretakerPhone, WA_PAYLOAD.careAck, careMsg?.providerMessageId || '', ist(9, 9, 45));
    const handled = careMsg?.alertId ? await prisma.alertRecord.findUnique({ where: { id: careMsg.alertId } }) : null;
    check("\"I'll handle it\": alert marked handled by the caretaker", !!handled?.acknowledgedAt && handled.handledByName === 'Ravi Kumar' && handled.status === 'resolved', handled);
    check("\"I'll handle it\": no reply sent (only when needed)", graph.requests.length === bAck);
    await say(caretakerPhone, 'ok thanks', ist(9, 9, 46));
    check('caretaker writes anything else: no reply', graph.requests.length === bAck);
    b = graph.requests.length;
    await tap(selfPhone, WA_PAYLOAD.taken, await askId(day9.id, 3), ist(9, 9, 50));
    check('late Yes: recorded, and the caretaker hears it was taken', (await prisma.medicineReminder.findUnique({ where: { id: day9.id } }))?.answer === 'taken' && toCaretaker(b).some(q => caretakerSaid(q).startsWith('Good news: Priya has now confirmed the 8:00 AM medicines')));

    console.log('\nB6. At most 2 caretaker alerts a day');
    // Three current doses that day: the night antibiotic's course is extended for this check.
    await prisma.medicine.updateMany({ where: { parentId: person.id, name: 'Antibiotic' }, data: { endsOn: null } });
    await prisma.scheduledCallSlot.create({
      data: { id: newId('slot'), parentId: person.id, time: '02:00 PM', slot: 'afternoon', label: 'Afternoon', linkedMedicineNames: ['Iron'], linkedMedicinesJson: JSON.stringify([{ name: 'Iron' }]), isActive: true }
    });
    b = graph.requests.length;
    for (const [h, m] of [[8, 5], [8, 36], [9, 7], [9, 38], [14, 5], [14, 36], [15, 7], [15, 38], [21, 5], [21, 36], [22, 7], [22, 38]]) {
      await runReminders({ ...deps, now: ist(10, h, m), parentIds: scope });
    }
    const care10 = toCaretaker(b);
    const missed10 = await prisma.medicineReminder.count({ where: { parentId: person.id, reminderDate: '2026-10-10', answer: 'missed' } });
    check('3 doses missed, caretaker told twice', missed10 === 3 && care10.length === CARETAKER_ALERTS_PER_DAY, { missed10, care: care10.length });
    check('second alert says no more today', caretakerSaid(care10[1] || care10[0]).includes('will not send more of these today'));

    console.log('\nB7. Discreet mode, STOP / START, replies, emergency');
    await prisma.parentProfile.update({ where: { id: person.id }, data: { discreetReminders: true } });
    b = graph.requests.length;
    await runReminders({ ...deps, now: ist(11, 8, 5), parentIds: scope });
    check('discreet: "your medicines"', graph.requests[b]?.body.template?.components[0].parameters[2].text === 'your medicines', graph.requests[b]?.body);
    await say(selfPhone, 'STOP', ist(11, 10, 0));
    p = await prisma.parentProfile.findUnique({ where: { id: person.id } });
    check('STOP stops the checks', !!p?.reminderOptOutAt && lastText() === REMINDER_REPLIES.stopped);
    r = await runReminders({ ...deps, now: ist(12, 8, 5), parentIds: scope });
    check('nothing sent after STOP', r.sent === 0, r);
    await say(selfPhone, 'start', ist(12, 9, 0));
    check('START turns them back on', !(await prisma.parentProfile.findUnique({ where: { id: person.id } }))?.reminderOptOutAt && lastText() === REMINDER_REPLIES.restarted);
    const bh = graph.requests.length;
    await say(selfPhone, 'hello, is this a real person?', ist(12, 9, 5));
    await say(selfPhone, 'ok thanks', ist(12, 9, 6));
    check('other text gets no reply (no spam)', graph.requests.length === bh);
    b = graph.requests.length;
    await say(selfPhone, 'I think my water broke', ist(12, 9, 10));
    check('warning words: one warm message that still mentions 108', graph.requests.slice(b).filter(q => q.body.text).length === 1 && graph.requests.slice(b).some(q => q.body.text?.body === REMINDER_REPLIES.emergency('Priya', 'Ravi Kumar')) && REMINDER_REPLIES.emergency('Priya', 'Ravi Kumar').includes('108'));
    check('caretaker told at once, with the one button', toCaretaker(b).some(q => q.body.template?.name === 'aaptha_caretaker_alert' && caretakerSaid(q).includes('This may be urgent')));
    check('level-4 alert on the dashboard', (await prisma.alertRecord.findFirst({ where: { parentId: person.id, title: REMINDER_EMERGENCY_TITLE } }))?.level === 4);
    b = graph.requests.length;
    await say(selfPhone, 'still bleeding', ist(12, 9, 20));
    check('emergency words again within 6 hours: nothing more sent', graph.requests.length === b && (await prisma.alertRecord.count({ where: { parentId: person.id, title: REMINDER_EMERGENCY_TITLE } })) === 1);
    b = graph.requests.length;
    await say(selfPhone, 'I have fever and a headache since morning', ist(12, 9, 30));
    check('symptoms: kind reply that names the caretaker', graph.requests.slice(b).some(q => q.body.text?.body === REMINDER_REPLIES.unwell('Ravi Kumar')));
    check('symptoms: caretaker told straight away', toCaretaker(b).some(q => caretakerSaid(q).startsWith('Priya may not be feeling well and wrote: "I have fever and a headache since morning"')));
    check('symptoms: level-3 alert on the dashboard', (await prisma.alertRecord.findFirst({ where: { parentId: person.id, title: REMINDER_UNWELL_TITLE } }))?.level === 3);
    b = graph.requests.length;
    await say(selfPhone, 'still feeling dizzy', ist(12, 10, 0));
    check('within 2 hours: nothing sent again (no spam)', graph.requests.length === b);
    b = graph.requests.length;
    await say(selfPhone, 'fever again now', ist(12, 11, 45));
    check('after 2 hours: caretaker told again', toCaretaker(b).length === 1);

    console.log('\nB8. Caretaker STOP');
    await prisma.parentProfile.update({ where: { id: person.id }, data: { discreetReminders: false } });
    await say(caretakerPhone, 'STOP', ist(12, 11, 0));
    check('caretaker STOP', !!(await prisma.parentProfile.findUnique({ where: { id: person.id } }))?.caretakerOptOutAt && lastText() === REMINDER_REPLIES.caretakerStopped('Priya'));
    b = graph.requests.length;
    for (const [h, m] of [[8, 5], [8, 36], [9, 7], [9, 38]]) await runReminders({ ...deps, now: ist(13, h, m), parentIds: scope });
    check('after STOP the caretaker gets nothing', toCaretaker(b).length === 0);

    console.log('\nB8b. Typed answers instead of buttons');
    await runReminders({ ...deps, now: ist(14, 8, 5), parentIds: scope });
    await say(selfPhone, 'haan le liya', ist(14, 8, 12));
    const t8 = await remAt(person.id, '2026-10-14', '08:00 AM');
    check('"haan le liya" = Yes', t8?.answer === 'taken' && lastText() === REMINDER_REPLIES.taken('8:12 AM'), { a: t8?.answer, t: lastText() });
    await runReminders({ ...deps, now: ist(14, 14, 5), parentIds: scope });
    b = graph.requests.length;
    await say(selfPhone, 'no, I have fever since morning', ist(14, 14, 10));
    const t14 = await remAt(person.id, '2026-10-14', '02:00 PM');
    check('"no, I have fever" = Not yet, and noted as not feeling well', t14?.answer === 'not_yet' && graph.requests.slice(b).some(q => (q.body.text?.body || '').startsWith(REMINDER_REPLIES.notYet('2:40 PM')) && (q.body.text?.body || '').includes("Sorry you're not feeling well")), graph.requests.slice(b).map(q => q.body.text?.body));
    await runReminders({ ...deps, now: ist(14, 21, 5), parentIds: scope });
    await say(selfPhone, 'ledu', ist(14, 21, 8));
    check('"ledu" = Not yet on the latest open check', (await remAt(person.id, '2026-10-14', '09:00 PM'))?.answer === 'not_yet');
    await say(selfPhone, '👍', ist(14, 21, 20));
    check('"👍" = Yes on the latest open check', (await remAt(person.id, '2026-10-14', '09:00 PM'))?.answer === 'taken');
    await say(selfPhone, 'done', ist(14, 21, 25));
    check('afternoon still open: a second "done" answers it', (await remAt(person.id, '2026-10-14', '02:00 PM'))?.answer === 'taken');
    await say(selfPhone, 'yes', ist(14, 21, 30));
    check('nothing open: "yes" gets "already taken"', lastText() === REMINDER_REPLIES.alreadyTaken, lastText());

    console.log('\nB8c. "Pause today"');
    await runReminders({ ...deps, now: ist(15, 8, 5), parentIds: scope });
    b = graph.requests.length;
    await say(selfPhone, 'pause today, travelling', ist(15, 8, 20));
    p = await prisma.parentProfile.findUnique({ where: { id: person.id } });
    check('paused until midnight', !!p?.isPaused && p.pauseUntil?.toISOString() === ist(16, 0, 0).toISOString(), { paused: p?.isPaused, until: p?.pauseUntil });
    check('one reply: when the checks start again', graph.requests.length === b + 1 && lastText() === REMINDER_REPLIES.pausedToday('08:00 AM'), lastText());
    check("today's open check is marked paused, not missed", (await remAt(person.id, '2026-10-15', '08:00 AM'))?.answer === 'paused');
    b = graph.requests.length;
    for (const [h, m] of [[8, 50], [9, 30], [14, 5], [21, 5]]) await runReminders({ ...deps, now: ist(15, h, m), parentIds: scope });
    check('nothing more sent that day, no caretaker alert', graph.requests.length === b && (await prisma.medicineReminder.count({ where: { parentId: person.id, reminderDate: '2026-10-15', answer: 'missed' } })) === 0);
    r = await runReminders({ ...deps, now: ist(16, 8, 5), parentIds: scope });
    p = await prisma.parentProfile.findUnique({ where: { id: person.id } });
    check('next morning: back on by itself', r.sent === 1 && !p?.isPaused && !p?.pauseUntil, r);

    console.log('\nB8d. Tablets running out');
    await prisma.medicine.updateMany({ where: { parentId: person.id, name: 'Iron' }, data: { tabletsLeft: 7, refillNotifiedAt: null } });
    const day16 = (await remAt(person.id, '2026-10-16', '08:00 AM'))!;
    await tap(selfPhone, WA_PAYLOAD.taken, await askId(day16.id, 1), ist(16, 8, 10));
    let iron = await prisma.medicine.findFirst({ where: { parentId: person.id, name: 'Iron' } });
    check('Yes counts one Iron tablet down (7 -> 6)', iron?.tabletsLeft === 6, iron?.tabletsLeft);
    check('3 days left (2 a day): one "running low" line under Noted', lastText().startsWith(REMINDER_REPLIES.taken('8:10 AM')) && lastText().includes('Iron is running low: 6 tablets left, about 3 days') && !!iron?.refillNotifiedAt, lastText());
    check('medicines not being counted stay uncounted', (await prisma.medicine.findFirst({ where: { parentId: person.id, name: 'Folic acid' } }))?.tabletsLeft === null);
    await runReminders({ ...deps, now: ist(16, 14, 5), parentIds: scope });
    await say(selfPhone, 'done', ist(16, 14, 10));
    iron = await prisma.medicine.findFirst({ where: { parentId: person.id, name: 'Iron' } });
    check('next Yes: 5 left, no second warning (once per refill)', iron?.tabletsLeft === 5 && lastText() === REMINDER_REPLIES.taken('2:10 PM'), { left: iron?.tabletsLeft, t: lastText() });
    await say(selfPhone, 'Iron 30', ist(16, 15, 0));
    iron = await prisma.medicine.findFirst({ where: { parentId: person.id, name: 'Iron' } });
    check('"Iron 30": count reset, warning re-armed', iron?.tabletsLeft === 30 && !iron.refillNotifiedAt && lastText() === REMINDER_REPLIES.toppedUp('Iron', 30), lastText());
    b = graph.requests.length;
    await say(selfPhone, 'I took 2', ist(16, 15, 5));
    check('"I took 2" is not a refill', (await prisma.medicine.findFirst({ where: { parentId: person.id, name: 'Iron' } }))?.tabletsLeft === 30);
    await say(selfPhone, '40', ist(16, 15, 10));
    check('bare "40": the one counted medicine', (await prisma.medicine.findFirst({ where: { parentId: person.id, name: 'Iron' } }))?.tabletsLeft === 40);

    console.log('\nB8e. Check-up reminders');
    const scan = await prisma.appointment.create({ data: { id: newId('appt'), parentId: person.id, createdById: self.id, title: 'scan', kind: 'doctor', startsAt: ist(17, 10, 0), location: 'Apollo Clinic', fasting: true } });
    const apptMsgs = (from: number) => graph.requests.slice(from).filter(q => q.body.template?.name === 'aaptha_appointment_reminder');
    b = graph.requests.length;
    r = await runReminders({ ...deps, now: ist(16, 17, 0), parentIds: scope });
    check('before 6 PM: nothing', apptMsgs(b).length === 0 && r.appointments === 0, r);
    r = await runReminders({ ...deps, now: ist(16, 18, 5), parentIds: scope });
    check('evening before: one reminder to the person', r.appointments === 1 && apptMsgs(b).length === 1 && apptMsgs(b)[0].body.to === selfPhone.slice(1) && (apptMsgs(b)[0].body.template?.components[0].parameters[1].text || '').startsWith('Tomorrow at 10 AM: scan at Apollo Clinic.'), apptMsgs(b).map(q => q.body.template?.components[0].parameters));
    r = await runReminders({ ...deps, now: ist(16, 18, 10), parentIds: scope });
    check('not sent twice', r.appointments === 0 && apptMsgs(b).length === 1);
    check('marked on the appointment', !!(await prisma.appointment.findUnique({ where: { id: scan.id } }))?.remindedDayBefore);
    r = await runReminders({ ...deps, now: ist(17, 6, 30), parentIds: scope });
    check('7 AM rule: nothing at 6:30', r.appointments === 0);
    r = await runReminders({ ...deps, now: ist(17, 7, 5), parentIds: scope });
    check('morning of: second and last reminder', r.appointments === 1 && apptMsgs(b).length === 2 && (apptMsgs(b)[1].body.template?.components[0].parameters[1].text || '').startsWith('Today at 10 AM'));
    r = await runReminders({ ...deps, now: ist(17, 9, 0), parentIds: scope });
    check('no "how did it go?" or any third message', r.appointments === 0 && apptMsgs(b).length === 2);
    const cancelled = await prisma.appointment.create({ data: { id: newId('appt'), parentId: person.id, createdById: self.id, title: 'dentist', kind: 'doctor', startsAt: ist(18, 11, 0), cancelledAt: new Date() } });
    r = await runReminders({ ...deps, now: ist(17, 19, 0), parentIds: scope });
    check('a cancelled appointment is never reminded', r.appointments === 0 && !(await prisma.appointment.findUnique({ where: { id: cancelled.id } }))?.remindedDayBefore);

    console.log('\nB8f. Weekly progress (opt-in)');
    const weeklyMsgs = (from: number, to?: string) => graph.requests.slice(from).filter(q => (q.body.template?.name === 'aaptha_weekly_progress' || (q.body.template?.name === 'aaptha_caretaker_update' && (q.body.template.components[0].parameters[1].text || '').includes('this week'))) && (!to || q.body.to === to));
    b = graph.requests.length;
    r = await runReminders({ ...deps, now: ist(18, 18, 5), parentIds: scope });
    check('off by default: nothing on Sunday evening', r.weekly === 0 && weeklyMsgs(b).length === 0, r);
    await prisma.parentProfile.update({ where: { id: person.id }, data: { weeklyProgress: true } });
    r = await runReminders({ ...deps, now: ist(17, 18, 30), parentIds: scope });
    check('not on a Saturday', r.weekly === 0);
    r = await runReminders({ ...deps, now: ist(18, 17, 30), parentIds: scope });
    check('not before 6 PM on Sunday', r.weekly === 0);
    const weekDates = Array.from({ length: 7 }, (_, i) => `2026-10-${String(18 - i).padStart(2, '0')}`);
    const wk = await prisma.medicineReminder.findMany({ where: { parentId: person.id, reminderDate: { in: weekDates }, status: 'sent' }, select: { answer: true } });
    const wkTaken = wk.filter(x => x.answer === 'taken').length;
    r = await runReminders({ ...deps, now: ist(18, 18, 5), parentIds: scope });
    const wm = weeklyMsgs(b, selfPhone.slice(1));
    check('Sunday 6 PM: one message to the person, with this week\'s real numbers', r.weekly === 1 && wm.length === 1 && wm[0].body.template?.components[0].parameters[1].text === weeklyProgressText(wkTaken, wk.length), { wkTaken, total: wk.length, sent: wm.map(q => q.body.template?.components[0].parameters) });
    check('caretaker not told (not switched on)', weeklyMsgs(b, caretakerPhone.slice(1)).length === 0);
    r = await runReminders({ ...deps, now: ist(18, 18, 10), parentIds: scope });
    check('once only', r.weekly === 0 && weeklyMsgs(b, selfPhone.slice(1)).length === 1);
    await prisma.whatsAppMessage.deleteMany({ where: { parentId: person.id, kind: 'weekly_progress' } });
    await prisma.parentProfile.update({ where: { id: person.id }, data: { weeklyProgressToCaretaker: true, caretakerOptOutAt: null } });
    r = await runReminders({ ...deps, now: ist(18, 18, 15), parentIds: scope });
    const cw = weeklyMsgs(b, caretakerPhone.slice(1));
    check('caretaker switched on and opted in: gets one line', cw.length === 1 && (cw[0].body.template?.components[0].parameters[1].text || '') === `Priya confirmed ${wkTaken} of ${wk.length} medicine checks this week.`, cw.map(q => q.body.template?.components[0].parameters));
    await prisma.parentProfile.update({ where: { id: person.id }, data: { weeklyProgress: false, weeklyProgressToCaretaker: false } });

    console.log('\nB8g. Messages in the person\'s language');
    await prisma.parentProfile.update({ where: { id: person.id }, data: { language: 'Telugu' } });
    const RT = repliesFor('Telugu');
    b = graph.requests.length;
    await runReminders({ ...deps, now: ist(19, 8, 5), parentIds: scope });
    const teAsk = graph.requests.slice(b).find(q => q.body.template?.name === 'aaptha_medicine_check');
    check('medicine check goes out in Telugu (template translation te), same two buttons', teAsk?.body.template?.language?.code === 'te' && teAsk.body.template.components.filter(c => c.type === 'button').length === 2, teAsk?.body.template);
    const rem19 = (await remAt(person.id, '2026-10-19', '08:00 AM'))!;
    await tap(selfPhone, WA_PAYLOAD.taken, await askId(rem19.id, 1), ist(19, 8, 10));
    check('the reply is in Telugu too', lastText() === RT.taken('8:10 AM') && lastText() !== REMINDER_REPLIES.taken('8:10 AM'), lastText());
    await say(selfPhone, 'STOP', ist(19, 9, 0));
    check('STOP: Telugu reply', lastText() === RT.stopped, lastText());
    await say(selfPhone, 'start', ist(19, 9, 5));
    check('START: Telugu reply', lastText() === RT.restarted, lastText());
    await say(selfPhone, 'I think my water broke', ist(19, 9, 10));
    check('warning words: Telugu reply keeps 108', graph.requests.slice(-3).some(q => q.body.text?.body === RT.emergency('Priya', 'Ravi Kumar')) && RT.emergency('Priya', null).includes('108'));
    const teAppt = await prisma.appointment.create({ data: { id: newId('appt'), parentId: person.id, createdById: self.id, title: 'scan', kind: 'doctor', startsAt: ist(22, 10, 0), location: 'Apollo Clinic' } });
    b = graph.requests.length;
    await runReminders({ ...deps, now: ist(21, 18, 5), parentIds: scope });
    const teAppts = graph.requests.slice(b).filter(q => q.body.template?.name === 'aaptha_appointment_reminder');
    check('check-up reminder in Telugu', teAppts.length === 1 && teAppts[0].body.template?.language?.code === 'te' && (teAppts[0].body.template.components[0].parameters[1].text || '') === `${PHRASES.te.tomorrow} 10 AM: scan, Apollo Clinic.`, teAppts.map(q => q.body.template));
    await prisma.appointment.update({ where: { id: teAppt.id }, data: { cancelledAt: new Date() } });

    // Translation not approved by Meta yet: the English message goes out instead of nothing.
    const rejectTelugu = (async (url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body));
      if (sent.template?.language?.code === 'te') return new Response(JSON.stringify({ error: { message: 'Template name does not exist in the translation', code: 132001 } }), { status: 400 });
      return graph.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    b = graph.requests.length;
    r = await runReminders({ ...deps, fetchImpl: rejectTelugu, now: ist(20, 8, 5), parentIds: scope });
    check('translation not approved yet: the English check is sent instead', r.sent === 1 && r.failed === 0 && graph.requests.slice(b).some(q => q.body.template?.name === 'aaptha_medicine_check' && q.body.template.language?.code === 'en'), { r, t: graph.requests.slice(b).map(q => q.body.template?.name) });
    await prisma.parentProfile.update({ where: { id: person.id }, data: { language: 'English' } });

    console.log('\nB9. Husband pays, wife gets the checks');
    const husband = await prisma.user.create({
      data: {
        id: newId('usr'), name: 'Ravi Reminder', email: `reminder-test-h-${stamp}@example.com`, phone: husbandPhone,
        subscription: { create: { id: newId('sub'), planId: 'essential', status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86400000), amount: 149 } },
        notificationPreferences: { create: { email: true } }
      }
    });
    userIds.push(husband.id);
    const wife = await createParent({
      userId: husband.id, name: 'Meena', relationship: 'Wife', phone: wifePhone, language: 'English',
      callSchedule: [{ slot: 'morning', time: '09:00 AM', label: 'Morning', linkedMedicineNames: ['Calcium'], linkedMedicines: [{ name: 'Calcium' }], isActive: true }] as unknown as ScheduledCallSlot[],
      consentGiven: true, reminderChannel: 'whatsapp', caretaker: { name: 'Ravi', phone: husbandPhone }
    });
    await setMedicinesForParent(wife.id, [{ ...med('Calcium'), id: newId('med'), parentId: wife.id }]);
    const w0 = (await prisma.parentProfile.findUnique({ where: { id: wife.id } }))!;
    check('caretaker saved at setup with its own code', w0.caretakerPhone === husbandPhone && !!w0.caretakerStartCode && w0.caretakerStartCode !== w0.reminderStartCode);
    await say(wifePhone, `START ${w0.reminderStartCode}`, ist(6, 8, 0));
    await say(husbandPhone, `START ${w0.caretakerStartCode}`, ist(6, 8, 1));
    const w = await prisma.parentProfile.findUnique({ where: { id: wife.id } });
    check('wife and husband each opt in from their own phone', w?.reminderWhatsapp === wifePhone && w?.caretakerWhatsapp === husbandPhone);
    const bw = graph.requests.length;
    await runReminders({ ...deps, now: ist(6, 9, 5), parentIds: [wife.id] });
    check('the check goes to her, not the payer', graph.requests[bw]?.body.to === wifePhone.slice(1));
    emails.length = 0;
    const be = graph.requests.length;
    await say(wifePhone, 'bleeding a lot, the baby is not moving', ist(6, 9, 20));
    check('her warning words reach the husband on WhatsApp', graph.requests.slice(be).some(q => q.body.to === husbandPhone.slice(1) && q.body.template?.name === 'aaptha_caretaker_alert'));

    console.log('\nB10. Calling plan: a parent writes "dizzy" on WhatsApp');
    const son = await prisma.user.create({
      data: {
        id: newId('usr'), name: 'Kiran Reminder', email: `reminder-test-s-${stamp}@example.com`, phone: strangerPhone,
        subscription: { create: { id: newId('sub'), planId: 'solo', status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86400000), amount: 999 } },
        notificationPreferences: { create: { email: true } }
      }
    });
    userIds.push(son.id);
    const amma = await createParent({
      userId: son.id, name: 'Amma', relationship: 'Mother', phone: caretakerPhone.replace('+9191', '+9190'), language: 'Telugu',
      callSchedule: [
        { slot: 'morning', time: '09:00 AM', label: 'Morning', linkedMedicineNames: [], isActive: true },
        { slot: 'evening', time: '06:00 PM', label: 'Evening', linkedMedicineNames: [], isActive: true }
      ] as unknown as ScheduledCallSlot[],
      consentGiven: true
    });
    phones.push(amma.phone);
    await prisma.parentProfile.update({ where: { id: amma.id }, data: { parentConsent: 'given' } });
    emails.length = 0;
    const bs = graph.requests.length;
    await say(amma.phone, 'chakkar aa raha hai since morning', ist(6, 10, 0));
    check('parent gets a kind reply naming the family (no scam check)', graph.requests.slice(bs).some(q => q.body.to === amma.phone.slice(1) && q.body.text?.body === PARENT_REPLIES.unwell('Kiran')));
    check('family told the same moment (L3, email while WhatsApp is off for them)', !!(await prisma.alertRecord.findFirst({ where: { parentId: amma.id, title: ALERT_TITLES.health, level: 3 } })) && emails.includes(son.email), emails);

    console.log('\nB11. Solo: check-up reminders ride on the call');
    await prisma.appointment.create({ data: { id: newId('appt'), parentId: amma.id, createdById: son.id, title: 'eye check-up', kind: 'doctor', startsAt: ist(7, 11, 0), location: 'Vasan Eye Care' } });
    const soloCalls: Array<Record<string, string>> = [];
    const soloFetch = (async (_u: string, init: RequestInit) => {
      soloCalls.push(JSON.parse(String(init.body)).app_config.agent_variables);
      return new Response(JSON.stringify({ attempt_id: `att_solo_${stamp}_${soloCalls.length}` }), { status: 200 });
    }) as unknown as typeof fetch;
    await runDispatch({ now: ist(6, 9, 5), config: sarvamConfig, fetchImpl: soloFetch, parentIds: [amma.id] });
    check('Solo call carries the appointment note', soloCalls.length === 1 && (soloCalls[0].appointment_note || '').startsWith('Tomorrow at 11 AM') && soloCalls[0].appointment_note.includes('eye check-up'), soloCalls[0]?.appointment_note);
    check('Solo: no family messages or BP/sugar asks', soloCalls[0]?.family_message === 'none' && (soloCalls[0]?.ask_readings || 'none') === 'none', { m: soloCalls[0]?.family_message, r: soloCalls[0]?.ask_readings });

    console.log('\nB12. Calling plan: the parent writes "aaj nahi"');
    emails.length = 0;
    const bp = graph.requests.length;
    await say(amma.phone, 'aaj nahi', ist(6, 12, 0));
    const ap = await prisma.parentProfile.findUnique({ where: { id: amma.id } });
    check('calls paused until midnight', !!ap?.isPaused && ap.pauseUntil?.toISOString() === ist(7, 0, 0).toISOString());
    check('parent told when Saathi calls next', graph.requests.slice(bp).some(q => q.body.to === amma.phone.slice(1) && q.body.text?.body === PARENT_REPLIES.pausedToday('09:00 AM')), graph.requests.slice(bp).map(q => q.body.text?.body));
    check('family told once (L2)', (await prisma.alertRecord.count({ where: { parentId: amma.id, title: PARENT_PAUSE_TITLE, level: 2 } })) === 1 && emails.length <= 1, emails);
    const callsBefore = soloCalls.length;
    await runDispatch({ now: ist(6, 18, 5), config: sarvamConfig, fetchImpl: soloFetch, parentIds: [amma.id] });
    check('no evening call that day', soloCalls.length === callsBefore);
    await runDispatch({ now: ist(7, 9, 5), config: sarvamConfig, fetchImpl: soloFetch, parentIds: [amma.id] });
    check('next morning: Saathi calls again', soloCalls.length === callsBefore + 1 && !(await prisma.parentProfile.findUnique({ where: { id: amma.id } }))?.isPaused);
  } finally {
    // Clean up every test row.
    const testParentIds = (await prisma.parentProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map(x => x.id);
    await prisma.whatsAppMessage.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { phone: { in: phones } }, { parentId: { in: testParentIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    const left = await prisma.parentProfile.count({ where: { userId: { in: userIds } } });
    console.log(`\nCleanup: ${left === 0 ? 'clean' : `${left} parent rows left`}`);
  }
}

async function main() {
  partA();
  await partB();
  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async err => {
  console.error('TEST RUN CRASHED:', err);
  await prisma.$disconnect();
  process.exit(1);
});
