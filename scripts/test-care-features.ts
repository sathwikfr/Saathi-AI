/**
 * v1 care features tests: `npx tsx scripts/test-care-features.ts`
 *
 * Part A: pure logic (call planning, new agent variables and outputs, alert wording,
 *         escalation ladder, insights, timeline, summaries, scam-check guard).
 * Part B: the flows against THROWAWAY rows in the real database with a fake Sarvam,
 *         fake WhatsApp, fake email and a fake Claude client: consent, "later"
 *         follow-ups, "stop calling me", emergency escalation, practice alerts,
 *         lives-alone wellness checks, family circle, insights, summaries, transcript
 *         clean-up, call-backs, the scam check and "Ask about Amma".
 *         Every run is scoped to the test parent; all test rows are deleted at the end.
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../src/lib/prisma';
import { newId, updateParent, getSharedParentsForUser } from '../src/lib/db';
import { SarvamConfig, AlertAgentConfig, buildAgentVariables, buildAlertCallRequest, buildMedicineChecklist, spokenPhone } from '../src/lib/sarvam';
import { planCallExtras, lastCallNote, istMonthDay, needsConsent } from '../src/lib/callPlanning';
import { interpretCallResult, decideAlerts, ALERT_TITLES } from '../src/lib/callInterpretation';
import { runDispatch, placeManualCall } from '../src/lib/callDispatch';
import { processSarvamWebhook, raiseToolEscalation, buildInboundContext, processInboundCall } from '../src/lib/callResults';
import { ladderRounds, advanceEscalations, startPracticeAlert, recordOutcome } from '../src/lib/escalation';
import { detectInsights, combinedNudge, isoWeekKey, CallFact, subjectsIn } from '../src/lib/insightRules';
import { runInsightsForParent } from '../src/lib/insights';
import { describeDay, buildTimeline } from '../src/lib/timeline';
import { localParts, dueSummaries, parentSummary, runDigests } from '../src/lib/digests';
import { clearOldTranscripts, transcriptRetentionDays } from '../src/lib/retention';
import { createInvite, acceptInvite, getInvitePreview, revokeMember, setMemberRole } from '../src/lib/familyInvites';
import { parentRoleFor } from '../src/lib/familyAccess';
import { notifyFamily } from '../src/lib/familyNotify';
import { recordAlert } from '../src/lib/alerts';
import { vouches, cautiousReply } from '../src/lib/scamCheck';
import { processWhatsAppWebhook } from '../src/lib/whatsappInbound';
import { WhatsAppConfig } from '../src/lib/whatsapp';
import { askAboutParent, formatRecords } from '../src/lib/familyAsk';
import { CallLog, LinkedMedicineDetail } from '../src/lib/types';

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
const MED = (name: string, dosage = '1 tab', purpose?: string): LinkedMedicineDetail => ({
  name, dosage, foodRelation: 'after_food', questionScript: `Did you take your ${name}?`, ...(purpose ? { purpose } : {})
});

function fakeConfig(): SarvamConfig {
  return {
    apiKey: 'test-key', orgId: 'org_1', workspaceId: 'ws_1', appId: 'app_1', appVersion: 2, connectionId: 'conn_1',
    agentPhoneNumber: '+910000000000', apiBase: 'http://sarvam.test/api/outbounds', webhookSecret: 's3cret', appUrl: 'http://app.test'
  };
}
const ALERT_AGENT: AlertAgentConfig = { appId: 'alert_app', appVersion: 1 };

// ============================================================================
// PART A — pure logic
// ============================================================================
function partA() {
  const now = new Date(Date.UTC(2026, 9, 12, 3, 30)); // Mon 12 Oct 2026, 09:00 IST

  console.log('\nA1. Call planning (what rides along on a call)');
  const rhythm = { parentConsent: null, lastSafetyLineAt: null, lastWellbeingAt: null, lastRefillCheckAt: null, birthDate: null };
  const first = planCallExtras({ callType: 'reminder', rhythm, lastAnswered: null, activeMedicineNames: ['Tab. Telmisartan 40'], answeredToday: false, now });
  check('first call asks consent', first.askConsent);
  check('first call says the safety line', first.saySafetyLine);
  check('at most 2 extras besides consent', [first.askWellbeing, first.refillMedicines.length > 0, !!first.lastCallNote].filter(Boolean).length <= 2, first);
  check('refill names cleaned for speech', first.refillMedicines[0] === 'Telmisartan 40', first.refillMedicines);
  const given = planCallExtras({
    callType: 'reminder',
    rhythm: { ...rhythm, parentConsent: 'given', lastSafetyLineAt: new Date(now.getTime() - DAY), lastWellbeingAt: new Date(now.getTime() - DAY), lastRefillCheckAt: new Date(now.getTime() - DAY) },
    lastAnswered: { createdAt: new Date(now.getTime() - DAY), healthConcern: 'knee pain since yesterday', pain: null, painWhere: null },
    activeMedicineNames: ['Metformin'], answeredToday: false, now
  });
  check('consent given → not asked again', !given.askConsent);
  check('nothing due → no wellbeing, refill or safety line', !given.askWellbeing && given.refillMedicines.length === 0 && !given.saySafetyLine, given);
  check('remembers the last concern', !!given.lastCallNote && given.lastCallNote.includes('knee pain'), given.lastCallNote);
  const followUp = planCallExtras({ callType: 'followup', rhythm, lastAnswered: null, activeMedicineNames: ['X'], answeredToday: true, now });
  check('follow-up: no extras except consent', followUp.askConsent && !followUp.askWellbeing && !followUp.saySafetyLine && followUp.refillMedicines.length === 0);
  check('old concern (8 days) is not brought up', lastCallNote({ createdAt: new Date(now.getTime() - 8 * DAY), healthConcern: 'cough', pain: null, painWhere: null }, now) === null);
  check('IST month-day', istMonthDay(now) === '10-12');
  const bday = planCallExtras({ callType: 'reminder', rhythm: { ...rhythm, parentConsent: 'given', birthDate: '10-12' }, lastAnswered: null, activeMedicineNames: [], answeredToday: false, now });
  check('birthday wish on the day', bday.specialDay === 'birthday');
  check('needsConsent: declined/withdrawn/pending ask again', needsConsent('pending') && needsConsent(null) && needsConsent('withdrawn') && !needsConsent('given'));

  console.log('\nA2. Agent variables and requests');
  const vars = buildAgentVariables({
    callLogId: 'call_1', parentId: 'p', slot: 'morning', slotLabel: 'Morning', parentName: 'Amma', parentPhone: '+919000000001',
    language: 'Telugu', caregiverName: 'Ravi', relationship: 'Mother', medicines: [MED('Telmisartan', '40mg', 'keeps your BP steady')],
    callType: 'reminder', askConsent: true, saySafetyLine: true, lastCallNote: 'Last time, on Monday, they said: knee pain.',
    askWellbeing: true, refillMedicines: ['Telmisartan'], supportPhone: '+919876543210'
  });
  check('ask_consent yes', vars.ask_consent === 'yes');
  check('checklist carries the family\'s "why"', vars.medicines_checklist.includes('[why: keeps your BP steady]'), vars.medicines_checklist);
  check('refill list', vars.ask_refill === 'yes' && vars.refill_medicines === 'Telmisartan');
  check('support number spoken in groups', vars.support_phone === '98765 43210', vars.support_phone);
  check('defaults: none / no', buildAgentVariables({
    callLogId: 'c', parentId: 'p', slot: 's', slotLabel: 'l', parentName: 'n', parentPhone: '+91', language: 'Hindi', caregiverName: 'c', relationship: 'r', medicines: []
  }).last_call_note === 'none');
  check('checklist without purpose unchanged', buildMedicineChecklist([MED('X')]) === '1. X (1 tab) — Did you take your X?');
  const alertReq = buildAlertCallRequest(fakeConfig(), ALERT_AGENT, {
    attemptId: 'esa_1', escalationId: 'esc_1', kind: 'emergency', recipientName: 'Sunita', recipientPhone: '+919822222222',
    parentName: 'Amma', parentPhone: '+919000000001', parentAddress: '12 MG Road, Hyderabad', familyName: 'Ravi', reason: 'chest pain', language: 'Telugu'
  });
  check('alert call uses the alert agent', alertReq.app_config.app_id === 'alert_app');
  check('alert call carries address and kind', alertReq.app_config.agent_variables.parent_address === '12 MG Road, Hyderabad' && alertReq.app_config.agent_variables.alert_kind === 'emergency');
  check('alert call metadata names the attempt', alertReq.webhook_config.metadata.escalationAttemptId === 'esa_1');
  check('spokenPhone', spokenPhone('+919000000001') === '90000 00001');

  console.log('\nA3. New answers from the call');
  const meds = [MED('Telmisartan (BP Tablet)', '40mg'), MED('Metformin 500')];
  const later = interpretCallResult({
    final_agent_variables: {
      consent: 'yes', all_medicines_taken: 'partial', medicines_taken: 'Telmisartan', medicines_later: 'Metformin',
      sleep: 'poor', appetite: 'good', pain: 'mild', pain_where: 'knee', medicines_running_low: 'telmisartan', mood: 'calm'
    },
    interaction_transcript: [{ role: 'agent', en_text: 'Hello' }, { role: 'user', en_text: 'Yes I took the BP one, sugar tablet after lunch' }]
  }, meds, 'Amma', { refillMedicines: ['Telmisartan', 'Metformin'] });
  check('later status', later.medicineResults[1].status === 'later', later.medicineResults);
  check('not confirmed while one is "later"', !later.medicationConfirmed);
  check('consent yes', later.consent === 'yes');
  check('running low matched to refill names', later.runningLow.length === 1 && later.runningLow[0] === 'Telmisartan', later.runningLow);
  check('sleep poor / appetite good / pain mild', later.sleep === 'poor' && later.appetite === 'good' && later.pain === 'mild' && later.painWhere === 'knee');
  check('parent words counted', later.parentWords === 10, later.parentWords);
  const laterAlerts = decideAlerts(later, 'Amma', 'morning');
  check('"later" is not a missed medicine', !laterAlerts.some(a => a.title === ALERT_TITLES.missed), laterAlerts);
  check('running low → level 2', laterAlerts.some(a => a.title === ALERT_TITLES.runningLow && a.level === 2));
  const followUpAlerts = decideAlerts(later, 'Amma', 'follow-up', { callType: 'followup' });
  check('follow-up: "later" again → missed', followUpAlerts.some(a => a.title === ALERT_TITLES.missed && a.message.includes('still had not taken')), followUpAlerts);

  const stopped = interpretCallResult({ final_agent_variables: { medicines_stopped: 'Metformin', stopped_reason: 'it makes me dizzy', medicines_taken: 'Telmisartan' } }, meds, 'Amma');
  const stoppedAlerts = decideAlerts(stopped, 'Amma', 'morning');
  check('quiet stopping → level 3, no advice', stoppedAlerts.some(a => a.level === 3 && a.title === ALERT_TITLES.stoppedMedicine && a.message.includes('doctor') && a.message.includes('dizzy')), stoppedAlerts);

  const no = interpretCallResult({ final_agent_variables: { consent: 'no' }, interaction_transcript: [{ role: 'user', en_text: 'No, I do not want this' }] }, meds, 'Amma');
  check('consent no is not "no response"', !no.noResponse);
  check('consent no → level 2', decideAlerts(no, 'Amma', 'morning').some(a => a.title === ALERT_TITLES.consentDeclined));
  const stop = interpretCallResult({ final_agent_variables: { stop_calls: 'yes', all_medicines_taken: 'yes' } }, meds, 'Amma');
  check('stop calling → level 2', decideAlerts(stop, 'Amma', 'morning').some(a => a.title === ALERT_TITLES.stopRequested));
  const severe = interpretCallResult({ final_agent_variables: { pain: 'severe', pain_where: 'back', all_medicines_taken: 'yes' } }, meds, 'Amma');
  check('severe pain → level 3 health', decideAlerts(severe, 'Amma', 'morning').some(a => a.level === 3 && a.message.includes('back')));
  const emergency = interpretCallResult({ final_agent_variables: { emergency: 'yes' } }, meds, 'Amma');
  check('emergency message mentions 112', decideAlerts(emergency, 'Amma', 'morning').some(a => a.level === 4 && a.message.includes('112')));
  const inbound = interpretCallResult({ output_agent_variables: { all_medicines_taken: 'yes', mood: 'cheerful' } }, meds, 'Amma');
  check('inbound output_agent_variables are read', inbound.medicationConfirmed && inbound.mood === 'cheerful');

  console.log('\nA4. Escalation ladder');
  const owner = { id: 'u1', name: 'Ravi', phone: '+919811111111', wake: true };
  const parent = { id: 'p1', name: 'Amma', phone: '+919000054321' };
  const t0 = new Date(2026, 0, 1);
  const contacts = [
    { id: 'c1', name: 'Ravi (son)', phone: '+919811111111', isLocal: false, priority: 'primary', createdAt: t0 },
    { id: 'c2', name: 'Security', phone: '+919833333333', isLocal: false, priority: 'secondary', createdAt: new Date(t0.getTime() + 2) },
    { id: 'c3', name: 'Sunita', phone: '+919822222222', isLocal: true, priority: 'secondary', createdAt: new Date(t0.getTime() + 1) }
  ];
  const rounds = ladderRounds({ kind: 'emergency', owner, parent, contacts });
  check('round 0: owner woken + nearest local contact', rounds[0].map(t => t.name).join('|') === 'Ravi|Sunita', rounds[0]);
  check('owner not phoned twice via their own contact row', !rounds.flat().some(t => t.targetId === 'c1'));
  check('then the next contact', rounds[1]?.[0]?.name === 'Security');
  check('then the parent again', rounds[2]?.[0]?.targetType === 'parent' && rounds[2][0].callKind === 'parent_check');
  check('3 rounds in all', rounds.length === 3, rounds.length);
  const noWake = ladderRounds({ kind: 'emergency', owner: { ...owner, wake: false }, parent, contacts });
  check('wake off: owner not called, their contact row is', noWake[0].map(t => t.name).join('|') === 'Sunita', noWake[0]);
  const wellness = ladderRounds({ kind: 'wellness_check', owner, parent, contacts });
  check('wellness check: local contacts only, not the owner', wellness.length === 2 && wellness[0][0].name === 'Sunita' && wellness[0][0].callKind === 'wellness_check', wellness);
  const practice = ladderRounds({ kind: 'practice', owner, parent, contacts, practiceContactId: 'c2' });
  check('practice: one call to the chosen contact', practice.length === 1 && practice[0][0].name === 'Security' && practice[0][0].callKind === 'practice');

  console.log('\nA5. Patterns across calls');
  const fact = (daysAgo: number, f: Partial<CallFact>): CallFact => {
    const at = new Date(now.getTime() - daysAgo * DAY);
    return {
      id: `c${daysAgo}-${Math.random()}`, date: new Date(at.getTime() + 5.5 * 3600000).toISOString().slice(0, 10), at,
      status: 'answered', scheduled: true, mood: 'calm', healthConcern: null, feedback: null, pain: null, painWhere: null,
      sleep: null, appetite: null, parentWords: 20, medicineResults: [{ name: 'X', status: 'taken' }], ...f
    };
  };
  const baseline = Array.from({ length: 20 }, (_, i) => fact(10 + i * 2, {}));
  const knee = [fact(1, { healthConcern: 'my knee is hurting' }), fact(3, { painWhere: 'knee', pain: 'mild' }), fact(5, { healthConcern: 'Knee pain again' })];
  const found = detectInsights([...knee, ...baseline], 'Amma', now);
  const kneeInsight = found.find(i => i.kind === 'repeat_complaint');
  check('same complaint 3 times → insight', !!kneeInsight && kneeInsight.refKey.endsWith(':knee') && kneeInsight.message.includes('3 calls'), kneeInsight);
  check('nudge, never a diagnosis', !!kneeInsight && /worth a chat|doctor visit/.test(kneeInsight.message));
  check('subjects: chest pain is not a trend subject', subjectsIn(fact(1, { healthConcern: 'chest pain' })).length === 0);
  const low = detectInsights([fact(1, { mood: 'anxious' }), fact(2, { mood: 'unwell' }), fact(3, { mood: 'anxious' }), fact(4, {}), ...baseline], 'Amma', now);
  check('low mood 3 of 4 → insight, unusual for them', low.some(i => i.kind === 'low_mood' && i.message.includes('unusual')), low.map(i => i.kind));
  const short = detectInsights([fact(1, { parentWords: 4 }), fact(2, { parentWords: 5 }), fact(3, { parentWords: 3 }), ...baseline], 'Amma', now);
  check('much shorter answers → insight', short.some(i => i.kind === 'shorter_answers'), short.map(i => i.kind));
  const missed = detectInsights([
    fact(1, { status: 'unanswered', medicineResults: [] }), fact(2, { status: 'unanswered', medicineResults: [] }),
    fact(3, { status: 'unanswered', medicineResults: [] }), fact(4, {}), ...baseline
  ], 'Amma', now);
  check('picking up less than usual → insight', missed.some(i => i.kind === 'missed_calls'), missed.map(i => i.kind));
  const adherence = detectInsights([
    fact(1, { medicineResults: [{ name: 'X', status: 'missed' }] }), fact(2, { medicineResults: [{ name: 'X', status: 'missed' }] }),
    fact(3, { medicineResults: [{ name: 'X', status: 'missed' }] }), fact(4, {}), ...baseline
  ], 'Amma', now);
  check('taking medicines less than usual → insight', adherence.some(i => i.kind === 'adherence_drop'), adherence.map(i => i.kind));
  const sleep = detectInsights([fact(1, { sleep: 'poor' }), fact(3, { sleep: 'poor' }), ...baseline], 'Amma', now);
  check('poor sleep twice → insight', sleep.some(i => i.kind === 'poor_sleep'));
  check('quiet week → nothing', detectInsights(baseline, 'Amma', now).length === 0);
  check('ISO week key (IST)', isoWeekKey(now) === '2026-W42', isoWeekKey(now));
  check('combined nudge needs 2 different things', !combinedNudge('Amma', [{ kind: 'low_mood', title: 'x' }]) && !!combinedNudge('Amma', [{ kind: 'low_mood', title: 'Amma has sounded low lately' }, { kind: 'poor_sleep', title: 'Amma said they are not sleeping well' }]));

  console.log('\nA6. Timeline and journal');
  const log = (f: Partial<CallLog>): CallLog => ({
    id: 'l', parentId: 'p', scheduledTime: now.toISOString(), createdAt: now.toISOString(), status: 'answered', durationSeconds: 40,
    medicationConfirmed: true, mood: 'calm', summary: '', ...f
  });
  const dayDesc = describeDay('Amma', [
    log({ details: { medicineResults: [{ name: 'Telmisartan', status: 'taken' }] } }),
    log({ mood: 'unwell', notes: 'call me Sunday', details: { medicineResults: [{ name: 'Metformin', status: 'missed' }], healthConcern: 'Mild cough', sleep: 'poor' } })
  ], [], []);
  check('journal names the missed medicine', dayDesc.journal.includes("Didn't take Metformin"), dayDesc.journal);
  check('journal repeats what they asked', dayDesc.journal.includes('call me Sunday'));
  check('chips: cough and poor sleep', dayDesc.chips.some(c => c.text === 'Mild cough') && dayDesc.chips.some(c => c.text === "Didn't sleep well"), dayDesc.chips);
  check('journal never uses he/she', !/\b(she|he|her|his)\b/i.test(dayDesc.journal), dayDesc.journal);
  const all = describeDay('Amma', [log({ details: { medicineResults: [{ name: 'X', status: 'taken' }] } })], [], []);
  check('all taken → "Took medicines"', all.chips.some(c => c.text === 'Took medicines') && all.journal.includes('took all medicines'));
  const tl = buildTimeline('Amma', [log({}), log({ createdAt: new Date(now.getTime() - 2 * DAY).toISOString() })], [], [], { now });
  check('timeline groups by day, newest first', tl.length === 2 && tl[0].label === 'Today', tl.map(d => d.label));

  console.log('\nA7. Summaries');
  const ny = localParts(new Date(Date.UTC(2026, 9, 18, 13, 5)), 'America/New_York'); // 09:05 EDT
  check('local time in the family\'s time zone', ny.hour === 9 && ny.weekday === 0, ny);
  check('bad time zone falls back to IST', localParts(now, 'Not/AZone').hour === 9);
  const prefs = { dailySummary: true, dailySummaryHour: 20, weeklyDigest: true, digestDay: 0, digestHour: 9, monthlySummary: true, timezone: 'America/New_York' };
  check('weekly due on their Sunday 9 AM', dueSummaries(prefs, new Date(Date.UTC(2026, 9, 18, 13, 5))).some(d => d.period === 'weekly'));
  check('daily due at 8 PM', dueSummaries(prefs, new Date(Date.UTC(2026, 9, 19, 0, 10))).some(d => d.period === 'daily'));
  check('monthly on the 1st (after the DST change)', dueSummaries(prefs, new Date(Date.UTC(2026, 10, 1, 14, 5))).some(d => d.period === 'monthly'));
  check('nothing due at other times', dueSummaries(prefs, new Date(Date.UTC(2026, 9, 18, 15, 5))).length === 0);
  const text = parentSummary('Amma', [...knee, fact(2, { medicineResults: [{ name: 'X', status: 'missed' }] })], { period: 'weekly', now, insightTitles: ['Amma mentioned knee pain 3 times this week'] });
  check('weekly text: calls, medicines, mentions, a reason to call', /answered 4 of 4 calls/.test(text) && /medicines taken 3 of 4/.test(text) && /knee pain/.test(text) && /good day to call Amma/.test(text), text);
  check('paused parent', parentSummary('Appa', [], { period: 'weekly', now, paused: true }) === 'Appa: calls are paused.');

  console.log('\nA8. Scam check guard + retention');
  check('vouching is caught', vouches('This looks genuine, you can reply.') && vouches("It's safe."));
  check('caution is not', !vouches("I can't be sure it is genuine.") && !vouches('This is not safe.') && !vouches('Never share an OTP.'));
  check('cautious reply repeats the OTP rule', cautiousReply('Ravi').includes('OTP') && cautiousReply('Ravi').includes('Ravi'));
  check('transcript retention default 90 days', transcriptRetentionDays({} as NodeJS.ProcessEnv) === 90 && transcriptRetentionDays({ TRANSCRIPT_RETENTION_DAYS: '0' } as unknown as NodeJS.ProcessEnv) === 0);
}

// ============================================================================
// PART B — flows against throwaway database rows
// ============================================================================
interface SarvamReq { url: string; body: { app_config: { app_id: string; agent_variables: Record<string, string> }; user_config: { user_phone_number: string }; webhook_config: { metadata: Record<string, string> } } }

function makeFakeSarvam() {
  const calls: Array<SarvamReq & { attemptId: string }> = [];
  let n = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    n += 1;
    const attemptId = `att_care_${Date.now()}_${n}`;
    calls.push({ url: String(url), body: JSON.parse(String(init.body)), attemptId });
    return new Response(JSON.stringify({ attempt_id: attemptId }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl, saathi: () => calls.filter(c => c.body.app_config.app_id === 'app_1'), alerts: () => calls.filter(c => c.body.app_config.app_id === 'alert_app') };
}

async function partB() {
  console.log('\nB. Flows against throwaway database rows');
  const emails: Array<{ to: string; alertType: string }> = [];
  const summaries: Array<{ to: string; text: string; period: string }> = [];
  const sarvam = makeFakeSarvam();
  const cfg = fakeConfig();
  const deps = {
    whatsapp: null,
    config: cfg,
    alertAgent: ALERT_AGENT,
    fetchImpl: sarvam.fetchImpl,
    sendEmail: (async (p: { to: string; alertType: string }) => {
      emails.push({ to: p.to, alertType: p.alertType });
      return { success: true, simulated: true };
    }) as never
  };
  // A crashed earlier run (e.g. a dropped database connection) may have left its throwaway accounts behind.
  const stale = await prisma.user.findMany({
    where: { email: { startsWith: 'care-test-' }, createdAt: { lt: new Date(Date.now() - 3600000) } },
    select: { id: true }
  });
  if (stale.length) {
    await prisma.whatsAppMessage.deleteMany({ where: { OR: [{ userId: { in: stale.map(u => u.id) } }, { phone: '+919000054321' }] } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map(u => u.id) }, email: { startsWith: 'care-test-' } } });
    console.log(`  (removed ${stale.length} leftover test account(s) from an earlier run)`);
  }

  const stamp = Date.now();
  const owner = await prisma.user.create({
    data: {
      id: newId('usr'), name: 'Ravi Tester', email: `care-test-${stamp}@example.com`, phone: '+919811111111',
      subscription: { create: { id: newId('sub'), planId: 'family', status: 'active', currentPeriodEnd: new Date(Date.now() + 60 * DAY), amount: 1299 } },
      notificationPreferences: { create: {} }
    }
  });
  const member = await prisma.user.create({
    data: { id: newId('usr'), name: 'Priya Tester', email: `care-test-member-${stamp}@example.com`, phone: '+919844444444', notificationPreferences: { create: {} } }
  });

  try {
    const morning = [MED('Telmisartan', '40mg'), MED('Metformin 500')];
    const parent = await prisma.parentProfile.create({
      data: {
        id: newId('parent'), userId: owner.id, name: 'Care Amma', relationship: 'Mother', phone: '+919000054321',
        language: 'Hindi & English', callTime: '08:30 AM', consentGiven: true, livesAlone: true, address: '12 MG Road, Hyderabad',
        createdAt: new Date(Date.UTC(2026, 9, 1)),
        callSchedule: { create: [{ id: newId('slot'), time: '08:30 AM', slot: 'morning', label: 'Morning Medicine Reminder', linkedMedicineNames: morning.map(m => m.name), linkedMedicinesJson: JSON.stringify(morning) }] },
        medicines: {
          create: [
            { id: newId('med'), name: 'Telmisartan', dosage: '40mg', timeOfDay: 'morning', timingSlots: ['morning'], purpose: 'keeps your BP steady' },
            { id: newId('med'), name: 'Metformin 500', dosage: '1 tab', timeOfDay: 'morning', timingSlots: ['morning'] }
          ]
        },
        emergencyContacts: {
          create: [
            { id: newId('emg'), name: 'Ravi (son)', relation: 'Son', phone: '+919811111111', priority: 'primary' },
            { id: newId('emg'), name: 'Sunita', relation: 'Neighbour', phone: '+919822222222', priority: 'secondary', isLocal: true, role: 'neighbour' },
            { id: newId('emg'), name: 'Security desk', relation: 'Security', phone: '+919833333333', priority: 'secondary', role: 'security' }
          ]
        }
      },
      include: { callSchedule: true, emergencyContacts: true }
    });
    const scope = [parent.id];
    const at = (d: number, hh: number, mm: number) => new Date(Date.UTC(2026, 9, d, hh, mm)); // October 2026, UTC
    const sunita = parent.emergencyContacts.find(c => c.name === 'Sunita')!;
    const webhook = (attemptId: string, status: string, vars: Record<string, unknown> = {}, userSays = 'yes, I took it') =>
      processSarvamWebhook(
        { attempt_id: attemptId, status, duration: 45, final_agent_variables: vars, interaction_transcript: status === 'connected' ? [{ role: 'agent', en_text: 'Hello' }, { role: 'user', en_text: userSays }] : [] },
        { now: new Date(), deps }
      );

    // ---- B1 first call asks the parent's own consent ------------------------
    console.log('\nB1. First call: consent, the "why", wellbeing and refill');
    const s1 = await runDispatch({ now: at(12, 3, 30), fetchImpl: sarvam.fetchImpl, config: cfg, alertDeps: deps, parentIds: scope });
    const c1 = sarvam.saathi()[0];
    check('one call placed', s1.placed === 1 && !!c1, s1);
    check('asks consent (new and legacy parents)', c1?.body.app_config.agent_variables.ask_consent === 'yes');
    check('says the safety line', c1?.body.app_config.agent_variables.say_safety_line === 'yes');
    check('medicine reason from the family', c1?.body.app_config.agent_variables.medicines_checklist.includes('[why: keeps your BP steady]'));
    check('wellbeing and refill questions ride along', c1?.body.app_config.agent_variables.ask_wellbeing === 'yes' && c1?.body.app_config.agent_variables.ask_refill === 'yes', c1?.body.app_config.agent_variables);

    // ---- B2 the answers ------------------------------------------------------
    console.log('\nB2. Yes to consent, Metformin "later", knee pain, running low');
    const r2 = await processSarvamWebhook({
      attempt_id: c1.attemptId, status: 'connected', duration: 70,
      final_agent_variables: {
        consent: 'yes', all_medicines_taken: 'partial', medicines_taken: 'Telmisartan', medicines_later: 'Metformin',
        sleep: 'poor', appetite: 'good', pain: 'mild', pain_where: 'knee', health_concern: 'knee pain since yesterday',
        medicines_running_low: 'Telmisartan', mood: 'calm', call_summary: 'Took BP tablet; sugar tablet after lunch.'
      },
      interaction_transcript: [{ role: 'agent', en_text: 'Is that okay?' }, { role: 'user', en_text: 'Yes that is fine, I took the BP one, my knee hurts' }]
    }, { now: at(12, 3, 35), deps });
    const p2 = await prisma.parentProfile.findUnique({ where: { id: parent.id } });
    check('consent given, with date and call', p2?.parentConsent === 'given' && !!p2.parentConsentAt && p2.parentConsentCallId === (r2 as { callLogId?: string }).callLogId, p2?.parentConsent);
    check('wellbeing / refill / safety line marked done', !!p2?.lastWellbeingAt && !!p2?.lastRefillCheckAt && !!p2?.lastSafetyLineAt);
    check('follow-up scheduled 40 min later', r2.status === 'processed' && !!r2.followUpAt && new Date(r2.followUpAt).getTime() === at(12, 4, 15).getTime(), r2);
    const a2 = await prisma.alertRecord.findMany({ where: { parentId: parent.id } });
    check('no missed-medicine alert for "later"', !a2.some(a => a.title === ALERT_TITLES.missed), a2.map(a => a.title));
    check('knee pain → level 3; running low → level 2', a2.some(a => a.level === 3 && a.title === ALERT_TITLES.health) && a2.some(a => a.level === 2 && a.title === ALERT_TITLES.runningLow));
    const log2 = await prisma.callLog.findUnique({ where: { id: (r2 as { callLogId: string }).callLogId } });
    check('parent words stored', (log2?.parentWords || 0) >= 10, log2?.parentWords);

    // ---- B3/B4 follow-up ---------------------------------------------------
    console.log('\nB3. Follow-up call about the "later" medicine only');
    const s3 = await runDispatch({ now: at(12, 4, 16), fetchImpl: sarvam.fetchImpl, config: cfg, alertDeps: deps, parentIds: scope });
    const c3 = sarvam.saathi()[1];
    check('one follow-up placed', s3.followUps === 1 && s3.placed === 0, s3);
    check('follow-up type, Metformin only', c3?.body.app_config.agent_variables.call_type === 'followup' && c3.body.app_config.agent_variables.medicines_checklist.includes('Metformin') && !c3.body.app_config.agent_variables.medicines_checklist.includes('Telmisartan'));
    check('follow-up has no extra questions', c3?.body.app_config.agent_variables.ask_wellbeing === 'no' && c3?.body.app_config.agent_variables.ask_consent === 'no');
    const s3b = await runDispatch({ now: at(12, 4, 21), fetchImpl: sarvam.fetchImpl, config: cfg, alertDeps: deps, parentIds: scope });
    check('follow-up placed only once', s3b.followUps === 0);
    const r4 = await processSarvamWebhook({
      attempt_id: c3.attemptId, status: 'connected', duration: 30, final_agent_variables: { medicines_later: 'Metformin', mood: 'calm' },
      interaction_transcript: [{ role: 'user', en_text: 'not yet, after lunch' }]
    }, { now: at(12, 4, 18), deps });
    const missedAlert = await prisma.alertRecord.findFirst({ where: { parentId: parent.id, title: ALERT_TITLES.missed } });
    check('still "later" on the follow-up → missed alert', !!missedAlert && missedAlert.message.includes('still had not taken'), missedAlert?.message);
    check('no follow-up of a follow-up', r4.status === 'processed' && !r4.followUpAt);

    // ---- B5/B6 next day: remembers; then "stop calling me" ------------------
    console.log('\nB5. Next day: remembers the knee, then "stop calling me"');
    await runDispatch({ now: at(13, 3, 30), fetchImpl: sarvam.fetchImpl, config: cfg, alertDeps: deps, parentIds: scope });
    const c5 = sarvam.saathi()[2];
    check('consent not asked again', c5?.body.app_config.agent_variables.ask_consent === 'no');
    check('remembers the knee from yesterday (past the follow-up)', /knee/.test(c5?.body.app_config.agent_variables.last_call_note || ''), c5?.body.app_config.agent_variables.last_call_note);
    check('no safety line this soon', c5?.body.app_config.agent_variables.say_safety_line === 'no');
    await processSarvamWebhook({
      attempt_id: c5.attemptId, status: 'connected', duration: 20, final_agent_variables: { stop_calls: 'yes', all_medicines_taken: 'yes' },
      interaction_transcript: [{ role: 'user', en_text: 'Please stop calling me' }]
    }, { now: at(13, 3, 32), deps });
    const p6 = await prisma.parentProfile.findUnique({ where: { id: parent.id } });
    check('withdrawn + paused at once', p6?.parentConsent === 'withdrawn' && p6.isPaused === true, p6?.parentConsent);
    check('family told (level 2)', !!(await prisma.alertRecord.findFirst({ where: { parentId: parent.id, title: ALERT_TITLES.stopRequested } })));
    const s6 = await runDispatch({ now: at(14, 3, 30), fetchImpl: sarvam.fetchImpl, config: cfg, alertDeps: deps, parentIds: scope });
    check('no calls while they said stop', s6.placed === 0);
    const m6 = await placeManualCall({ parentId: parent.id, requesterId: owner.id, kind: 'test' }, { config: cfg, fetchImpl: sarvam.fetchImpl, now: at(14, 4, 0) });
    check('test call refused too', !m6.ok && m6.code === 'PARENT_SAID_NO', m6);
    await updateParent(parent.id, { isPaused: false });
    const p7 = await prisma.parentProfile.findUnique({ where: { id: parent.id } });
    check('resume → Saathi asks again first', p7?.parentConsent === 'pending' && !p7.isPaused);
    await runDispatch({ now: at(15, 3, 30), fetchImpl: sarvam.fetchImpl, config: cfg, alertDeps: deps, parentIds: scope });
    const c7 = sarvam.saathi()[3];
    check('asks consent again after resuming', c7?.body.app_config.agent_variables.ask_consent === 'yes');
    await webhook(c7.attemptId, 'connected', { consent: 'yes', all_medicines_taken: 'yes', mood: 'cheerful' });
    const log7 = await prisma.callLog.findUnique({ where: { providerAttemptId: c7.attemptId } });

    // ---- B8/B9 emergency escalation -----------------------------------------
    console.log('\nB8. Emergency: phone the son and the neighbour, "I\'m on it"');
    const before = sarvam.alerts().length;
    const esc8 = await raiseToolEscalation(log7!.id, 'chest pain and sweating', deps);
    check('level-4 raised', esc8.status === 'raised');
    const alert8 = await prisma.alertRecord.findFirst({ where: { parentId: parent.id, level: 4 } });
    const e8 = await prisma.escalation.findUnique({ where: { alertId: alert8!.id }, include: { attempts: true } });
    check('escalation started', e8?.status === 'active' && e8.kind === 'emergency' && !!e8.nextStepAt);
    const placed8 = sarvam.alerts().slice(before);
    check('owner woken + neighbour called at once', placed8.map(c => c.body.user_config.user_phone_number).sort().join(',') === '+919811111111,+919822222222', placed8.map(c => c.body.user_config.user_phone_number));
    check('neighbour hears the address', placed8.some(c => c.body.app_config.agent_variables.parent_address === '12 MG Road, Hyderabad'));
    check('no duplicate escalation from the end-of-call scan', (await raiseToolEscalation(log7!.id, 'again', deps)).status === 'already_raised' && (await prisma.escalation.count({ where: { parentId: parent.id } })) === 1);
    const neighbourAttempt = e8!.attempts.find(a => a.name === 'Sunita')!;
    const call9 = placed8.find(c => c.body.user_config.user_phone_number === '+919822222222')!;
    const emailsBefore = emails.length;
    const r9 = await processSarvamWebhook({ attempt_id: call9.attemptId, status: 'connected', final_agent_variables: { response: 'yes' } }, { now: new Date(), deps });
    check('alert-call result routed to the escalation', r9.status === 'alert_call' && r9.escalationAttemptId === neighbourAttempt.id, r9);
    const e9 = await prisma.escalation.findUnique({ where: { id: e8!.id } });
    const alert9 = await prisma.alertRecord.findUnique({ where: { id: alert8!.id } });
    check('handled by the neighbour, ladder stopped', e9?.status === 'handled' && e9.handledByName === 'Sunita' && !e9.nextStepAt);
    check('alert shows who is handling it', alert9?.handledByName === 'Sunita' && alert9.handledVia === 'call' && !!alert9.acknowledgedAt);
    check('family told "Sunita is handling it"', emails.slice(emailsBefore).some(e => e.alertType.includes('Sunita is handling')), emails.slice(emailsBefore));
    check('repeated result ignored', (await processSarvamWebhook({ attempt_id: call9.attemptId, status: 'connected', final_agent_variables: { response: 'yes' } }, { now: new Date(), deps })).status === 'alert_call');
    const outcomeOk = await recordOutcome({ alertId: alert8!.id, parentId: parent.id, outcome: 'doctor_visit', note: 'BP was high', userId: owner.id, userName: owner.name }, deps);
    const closed = await prisma.escalation.findUnique({ where: { id: e8!.id } });
    check('outcome recorded closes it', outcomeOk && closed?.status === 'closed' && (await prisma.alertRecord.findUnique({ where: { id: alert8!.id } }))?.outcome === 'doctor_visit');

    console.log('\nB10. Nobody answers: the ladder moves on every 10 minutes');
    const log10 = await prisma.callLog.create({
      data: { id: newId('call'), parentId: parent.id, scheduledTime: new Date().toISOString(), status: 'answered', mood: 'unwell', summary: 'x', callDate: '2026-10-16' }
    });
    const n10 = sarvam.alerts().length;
    await raiseToolEscalation(log10.id, 'fell in the bathroom', deps);
    const e10 = await prisma.escalation.findFirst({ where: { parentId: parent.id, status: 'active' } });
    const later = (min: number) => new Date(e10!.createdAt.getTime() + min * 60000);
    await advanceEscalations({ ...deps, now: later(11), parentIds: scope });
    const round1 = sarvam.alerts().slice(n10 + 2);
    check('round 1: the next contact', round1.length === 1 && round1[0].body.user_config.user_phone_number === '+919833333333', round1.map(c => c.body.user_config.user_phone_number));
    await advanceEscalations({ ...deps, now: later(22), parentIds: scope });
    const round2 = sarvam.alerts().slice(n10 + 3);
    check('round 2: the parent again', round2.length === 1 && round2[0].body.app_config.agent_variables.alert_kind === 'parent_check');
    await advanceEscalations({ ...deps, now: later(23), parentIds: scope });
    check('not before the 10 minutes are up', sarvam.alerts().length === n10 + 4);
    await advanceEscalations({ ...deps, now: later(33), parentIds: scope });
    const e10b = await prisma.escalation.findUnique({ where: { id: e10!.id } });
    check('ladder used up → exhausted', e10b?.status === 'exhausted');
    check('family told plainly nobody confirmed', !!(await prisma.alertRecord.findFirst({ where: { parentId: parent.id, title: ALERT_TITLES.escalationExhausted, level: 3 } })));

    console.log('\nB11. Practice alert');
    const n11 = sarvam.alerts().length;
    const pr = await startPracticeAlert({ parentId: parent.id, contactId: sunita.id }, deps);
    const pc = sarvam.alerts()[n11];
    check('practice call placed to the contact', pr.ok && pc?.body.app_config.agent_variables.alert_kind === 'practice' && pc.body.user_config.user_phone_number === '+919822222222');
    await processSarvamWebhook({ attempt_id: pc.attemptId, status: 'connected', final_agent_variables: { response: 'yes' } }, { now: new Date(), deps });
    const sun = await prisma.emergencyContact.findUnique({ where: { id: sunita.id } });
    check('contact marked as practised', !!sun?.practiceAt && sun.practiceResult === 'yes');
    check('practice is not an alert', !(await prisma.alertRecord.findFirst({ where: { parentId: parent.id, message: { contains: 'practice' } } })));

    console.log('\nB12. Lives alone and unreachable: a neighbour is asked to check');
    const slot = parent.callSchedule[0];
    const last = await prisma.callLog.create({
      data: {
        id: newId('call'), parentId: parent.id, slotId: slot.id, slot: 'morning', callDate: '2026-10-17', attemptNumber: 3,
        scheduledTime: new Date().toISOString(), status: 'placed', providerAttemptId: `att_care_last_${stamp}`, mood: 'neutral', summary: 'x',
        resultJson: JSON.stringify({ medicines: morning, callType: 'reminder' })
      }
    });
    const n12 = sarvam.alerts().length;
    await processSarvamWebhook({ attempt_id: last.providerAttemptId!, status: 'no_answer' }, { now: at(17, 4, 30), deps });
    const unreachable = await prisma.alertRecord.findFirst({ where: { parentId: parent.id, callLogId: last.id } });
    check('level 3 for someone who lives alone', unreachable?.level === 3 && unreachable.message.includes('lives alone'), unreachable);
    const wc = sarvam.alerts().slice(n12);
    check('neighbour asked to check (not the son)', wc.length === 1 && wc[0].body.app_config.agent_variables.alert_kind === 'wellness_check' && wc[0].body.user_config.user_phone_number === '+919822222222', wc.map(c => c.body.user_config.user_phone_number));

    // ---- B13 family circle -----------------------------------------------------
    console.log('\nB13. Family circle');
    const inv = await createInvite({ parentId: parent.id, invitedBy: { id: owner.id, name: owner.name, email: owner.email }, name: 'Priya', role: 'viewer' });
    check('invite link created', inv.ok && inv.url.includes('/invite/'));
    const token = inv.ok ? inv.url.split('/invite/')[1] : '';
    const preview = await getInvitePreview(token);
    check('invite preview shows only names', preview?.parentName === 'Care Amma' && preview.inviterName === 'Ravi Tester' && Object.keys(preview).length === 4, preview);
    check('owner can\'t accept own invite', !(await acceptInvite(token, { id: owner.id })).ok);
    check('member accepts', (await acceptInvite(token, { id: member.id })).ok);
    check('link is single use', !(await acceptInvite(token, { id: member.id })).ok);
    check('member is a viewer', (await parentRoleFor(member.id, parent.id)) === 'viewer');
    check('shared parent on their dashboard', (await getSharedParentsForUser(member.id)).some(p => p.id === parent.id && p.accessRole === 'viewer' && p.ownerName === 'Ravi Tester'));
    const viewerCall = await placeManualCall({ parentId: parent.id, requesterId: member.id, kind: 'test' }, { config: cfg, fetchImpl: sarvam.fetchImpl, now: at(17, 6, 0) });
    check('a viewer can\'t place calls', !viewerCall.ok && viewerCall.status === 404);
    const invite = await prisma.caregiverInvite.findFirst({ where: { parentId: parent.id, userId: member.id } });
    await setMemberRole(parent.id, invite!.id, 'co_manager');
    check('co-manager after the owner changes the role', (await parentRoleFor(member.id, parent.id)) === 'co_manager');
    const famEmailsBefore = emails.length;
    const rec13 = await recordAlert({ parentId: parent.id, callLogId: null, level: 2, title: 'Family test alert', message: 'test' });
    await notifyFamily({ parentId: parent.id, callLogId: null, alerts: [rec13.alert!] }, deps);
    const to13 = emails.slice(famEmailsBefore).map(e => e.to).sort();
    check('both the son and the sister are told', to13.length === 2 && to13.includes(owner.email) && to13.includes(member.email), to13);
    await revokeMember(parent.id, invite!.id);
    check('removed member loses access', (await parentRoleFor(member.id, parent.id)) === null);

    // ---- B14 insights --------------------------------------------------------------
    console.log('\nB14. Patterns across calls');
    await prisma.callLog.create({
      data: {
        id: newId('call'), parentId: parent.id, slotId: slot.id, slot: 'morning', callDate: '2026-10-14', scheduledTime: '', status: 'answered',
        mood: 'calm', summary: 'x', createdAt: at(14, 3, 40), resultJson: JSON.stringify({ medicineResults: [], healthConcern: 'my knee hurts again' })
      }
    });
    const ins = await runInsightsForParent(parent.id, { now: at(15, 6, 0), deps });
    check('knee pain twice this week → insight', ins.some(i => i.kind === 'repeat_complaint' && i.refKey.endsWith(':knee')), ins.map(i => i.refKey));
    check('noticed once per week', (await runInsightsForParent(parent.id, { now: at(15, 7, 0), deps })).length === 0);

    // ---- B15 summaries --------------------------------------------------------------
    console.log('\nB15. Weekly summary at the family\'s hour');
    const sendSummaryEmail = (async (p: { to: string; text: string; period: string }) => {
      summaries.push({ to: p.to, text: p.text, period: p.period });
      return { success: true, simulated: true };
    }) as never;
    const sunday9 = new Date(Date.UTC(2026, 9, 18, 3, 35)); // Sun 18 Oct, 09:05 IST
    const d15 = await runDigests({ now: sunday9, deps: { whatsapp: null, sendSummaryEmail }, userIds: [owner.id] });
    check('one weekly summary sent', d15.sent === 1 && summaries.length === 1 && summaries[0].period === 'weekly', d15);
    check('summary mentions the parent and the knee', summaries[0]?.text.includes('Care Amma') && /knee/.test(summaries[0]?.text || ''), summaries[0]?.text);
    const d15b = await runDigests({ now: new Date(sunday9.getTime() + 5 * 60000), deps: { whatsapp: null, sendSummaryEmail }, userIds: [owner.id] });
    check('not sent twice in the same week', d15b.sent === 0 && summaries.length === 1);

    // ---- B16 transcript clean-up ------------------------------------------------------
    console.log('\nB16. Transcripts cleared after 90 days, call kept');
    const old = await prisma.callLog.create({
      data: {
        id: newId('call'), parentId: parent.id, scheduledTime: '', status: 'answered', mood: 'calm', summary: 'Old call summary',
        transcriptJson: JSON.stringify([{ role: 'user', text: 'hello' }]), createdAt: new Date(Date.now() - 100 * DAY)
      }
    });
    const cleared = await clearOldTranscripts({ parentIds: scope });
    const oldAfter = await prisma.callLog.findUnique({ where: { id: old.id } });
    check('old transcript cleared', cleared.cleared >= 1 && oldAfter?.transcriptJson === null);
    check('call log and summary kept', oldAfter?.summary === 'Old call summary');
    check('recent transcripts kept', (await prisma.callLog.count({ where: { parentId: parent.id, transcriptJson: { not: null } } })) > 0);

    // ---- B17 call-back -------------------------------------------------------------------
    console.log('\nB17. The parent calls Saathi back');
    const ctx = await buildInboundContext('+91 90000 54321', at(17, 5, 0));
    check('caller recognised', !!ctx && ctx.variables.parent_name === 'Care Amma' && ctx.variables.call_type === 'callback', ctx?.variables);
    check('asks about today\'s unconfirmed medicines', !!ctx && ctx.variables.has_medicines === 'yes');
    check('unknown caller gets nothing', (await buildInboundContext('+919999999999')) === null);
    const cb = await processInboundCall({
      interaction_id: `int_care_${stamp}`, user_phone_number: '+919000054321', duration: 50,
      final_agent_variables: { all_medicines_taken: 'yes', mood: 'cheerful' },
      interaction_transcript: [{ role: 'user', en_text: 'I missed your call, I took both tablets' }]
    }, { now: at(17, 5, 2), deps });
    check('call-back recorded on the same log', cb.status === 'processed' && cb.callLogId === ctx?.callLogId, cb);
    check('call-back is idempotent', (await processInboundCall({ interaction_id: `int_care_${stamp}`, user_phone_number: '+919000054321' }, { deps })).status === 'duplicate');

    // ---- B18 scam check ----------------------------------------------------------------------
    console.log('\nB18. Scam check on WhatsApp');
    const wa: WhatsAppConfig = { accessToken: 't', phoneNumberId: 'pn', apiVersion: 'v23.0', apiBase: 'http://graph.test', templateLanguage: 'en', appUrl: 'http://app.test' };
    const sentTexts: string[] = [];
    const waFetch = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body || '{}'));
      if (body.text?.body) sentTexts.push(body.text.body);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.care.${sentTexts.length}.${stamp}` }] }), { status: 200 });
    }) as unknown as typeof fetch;
    let claudeRequest: Record<string, unknown> | null = null;
    const fakeClaude = {
      beta: {
        messages: {
          parse: async (params: Record<string, unknown>) => {
            claudeRequest = params;
            return { stop_reason: 'end_turn', parsed_output: { verdict: 'likely_scam', warning_signs: ['asks for an OTP', 'account blocked threat'], reply: 'Yeh dhokha lag raha hai. OTP mat dijiye. Ravi se baat kijiye.' } };
          },
          create: async (params: Record<string, unknown>) => {
            claudeRequest = params;
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Care Amma took the BP tablet on Mon 12 Oct and mentioned knee pain.' }] };
          }
        }
      }
    } as unknown as Anthropic;
    const summary18 = await processWhatsAppWebhook({
      entry: [{ changes: [{ value: { messages: [{ id: `wamid.in.${stamp}`, from: '919000054321', type: 'text', text: { body: 'Dear customer your SBI account is blocked. Share OTP to unblock.' } }] } }] }]
    }, { whatsapp: wa, fetchImpl: waFetch, claude: fakeClaude, sendEmail: deps.sendEmail });
    check('parent gets a reply', summary18.replies === 1 && sentTexts[0]?.includes('OTP'), { summary18, sentTexts });
    const req18 = claudeRequest as unknown as { fallbacks?: string; betas?: string[]; messages: Array<{ content: Array<{ type: string; text?: string }> }> } | null;
    check('asked in the parent\'s language, with refusal fallback on', !!req18 && req18.fallbacks === 'default' && !!req18.betas?.includes('server-side-fallback-2026-07-01') &&
      req18.messages[0].content.some(b => b.text?.includes('Reply language: Hindi')));
    check('family alerted about the scam', !!(await prisma.alertRecord.findFirst({ where: { parentId: parent.id, title: 'Possible scam message', level: 2 } })));
    check('stored as a scam reply for this parent', (await prisma.whatsAppMessage.count({ where: { parentId: parent.id, kind: 'scam_reply' } })) === 1);

    // ---- B19 Ask about Amma ---------------------------------------------------------------
    console.log('\nB19. Ask about Amma');
    const ask = await askAboutParent({ parentId: parent.id, question: 'How has she been this week?' }, { client: fakeClaude, now: at(17, 6, 0) });
    check('answer returned', ask.ok && ask.answer.includes('knee'), ask);
    const req19 = claudeRequest as unknown as { system: string; messages: Array<{ content: Array<{ type: string; text: string; cache_control?: unknown }> }>; fallbacks: string; output_config: { effort: string } };
    const records = req19.messages[0].content[0].text;
    check('records include calls, the knee and the family\'s "why"', records.includes('knee pain since yesterday') && records.includes('family says: keeps your BP steady'), records.slice(0, 300));
    check('records cached, question separate', !!req19.messages[0].content[0].cache_control && req19.messages[0].content[1].text === 'How has she been this week?');
    check('never diagnose rule in the system prompt', /Never diagnose/.test(req19.system) && req19.output_config.effort === 'medium' && req19.fallbacks === 'default');
    const withHistory = await askAboutParent({
      parentId: parent.id, question: 'And yesterday?',
      history: [{ role: 'user', content: 'How has she been?' }, { role: 'assistant', content: 'Fine.' }]
    }, { client: fakeClaude });
    const req19b = claudeRequest as unknown as { messages: Array<{ role: string }> };
    check('follow-up questions keep the conversation', withHistory.ok && req19b.messages.map(m => m.role).join(',') === 'user,assistant,user');
    const full = await prisma.parentProfile.findUnique({
      where: { id: parent.id },
      include: { medicines: true, callSchedule: true, callLogs: true, alerts: true, insights: true, documents: true }
    });
    check('records format is deterministic (prompt cache)', formatRecords(full!, at(17, 6, 0)) === formatRecords(full!, at(17, 6, 0)));
  } finally {
    await prisma.whatsAppMessage.deleteMany({ where: { OR: [{ userId: { in: [owner.id, member.id] } }, { phone: '+919000054321' }] } });
    await prisma.user.delete({ where: { id: member.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: owner.id } });
    const left = await prisma.user.count({ where: { email: { startsWith: 'care-test-' } } });
    const orphans = await prisma.parentProfile.count({ where: { phone: '+919000054321' } });
    console.log(`\nCleanup: test users removed (${left === 0 && orphans === 0 ? 'clean' : 'LEFTOVER ROWS!'})`);
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
