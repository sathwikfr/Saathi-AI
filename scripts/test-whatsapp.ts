/**
 * WhatsApp call-update tests: `npx tsx scripts/test-whatsapp.ts`
 *
 * Part A: pure logic (message choice and wording, Meta request shape, webhook signature).
 * Part B: the whole flow against THROWAWAY rows in the real database, with a fake
 *         Meta Graph API, a fake Sarvam and a fake email sender. Nothing is sent
 *         to real phones. All test rows are deleted at the end.
 */
import 'dotenv/config';
import './lib/testDb';
import crypto from 'crypto';
import { prisma } from '../src/lib/prisma';
import { newId } from '../src/lib/db';
import {
  WhatsAppConfig, buildTemplateRequest, cleanParam, renderTemplate, verifyMetaSignature, WHATSAPP_TEMPLATES
} from '../src/lib/whatsapp';
import { describeAnsweredCall, planFamilyMessage, WA_REPLIES } from '../src/lib/familyMessages';
import { processSarvamWebhook, raiseToolEscalation } from '../src/lib/callResults';
import { runDispatch } from '../src/lib/callDispatch';
import { processWhatsAppWebhook, InboundDeps } from '../src/lib/whatsappInbound';
import { whatsappRecipient } from '../src/lib/familyNotify';
import { SarvamConfig } from '../src/lib/sarvam';
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
  console.log('\nA1. Template parameters and requests');
  check('newlines/tabs flattened', cleanParam('a\nb\t c   d') === 'a b c d');
  check('long text cut with an ellipsis', cleanParam('x'.repeat(900)).length === 700 && cleanParam('x'.repeat(900)).endsWith('…'));
  check('empty param becomes "-"', cleanParam('  ') === '-');
  const req = buildTemplateRequest('attention', '+91 98765 43210', ['Amma', 'Missed\nMetformin'], 'en');
  check('to = digits only', req.to === '919876543210');
  check('template name', req.template.name === 'aaptha_call_alert');
  const comps = req.template.components as Array<{ type: string; index?: string; parameters: Array<{ text?: string; payload?: string }> }>;
  check('body params cleaned', comps[0].type === 'body' && comps[0].parameters[1].text === 'Missed Metformin');
  check('quick replies in order: ack, recall', comps[1]?.parameters[0].payload === 'ack' && comps[1].index === '0' && comps[2]?.parameters[0].payload === 'recall' && comps[2].index === '1');
  const upd = buildTemplateRequest('call_update', '+919876543210', ['Amma', 'All good'], 'en');
  check('call update has no quick replies', upd.template.components.length === 1);
  check('render fills placeholders', renderTemplate('emergency', ['Amma', 'Chest pain.', '+919876543210']).startsWith('Urgent alert from your scheduled check-in call with Amma: Chest pain.'));
  check('every template ends with fixed text (Meta rule)', Object.values(WHATSAPP_TEMPLATES).every(t => !/\}\}\s*$/.test(t.body) && !/^\s*\{\{/.test(t.body)));

  console.log('\nA2. Webhook signature');
  const body = '{"entry":[]}';
  const sig = 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(body).digest('hex');
  check('valid signature accepted', verifyMetaSignature(body, sig, 'app-secret'));
  check('tampered body rejected', !verifyMetaSignature(body + ' ', sig, 'app-secret'));
  check('wrong secret rejected', !verifyMetaSignature(body, sig, 'other'));
  check('missing header rejected', !verifyMetaSignature(body, null, 'app-secret'));
  check('no secret configured rejected', !verifyMetaSignature(body, sig, undefined));

  console.log('\nA3. Which message, and its words');
  const line = describeAnsweredCall({
    slotLabel: 'morning', answeredAt: '09:10 AM', mood: 'calm', feedback: 'Call me on Sunday',
    medicineResults: [{ name: 'Telmisartan', status: 'taken' }, { name: 'Metformin', status: 'missed' }]
  });
  check('call description', line === 'Answered the morning call at 09:10 AM. Medicines: Telmisartan taken, Metformin missed. Mood: calm. They said: "Call me on Sunday"', line);
  const base = { parentName: 'Amma', parentPhone: '+919876543210' };
  const fine = planFamilyMessage({ ...base, alerts: [], update: 'All good.', minimumAlertLevel: 1 });
  check('all fine + "every call" → call update', fine?.kind === 'call_update' && fine.level === 0 && fine.alertId === null, fine);
  check('all fine + "needs attention only" → nothing', planFamilyMessage({ ...base, alerts: [], update: 'All good.', minimumAlertLevel: 2 }) === null);
  check('nothing to say → nothing', planFamilyMessage({ ...base, alerts: [], update: null, minimumAlertLevel: 1 }) === null);
  const missed = planFamilyMessage({ ...base, alerts: [{ id: 'a2', level: 2, title: 'Missed medicine', message: 'Amma missed Metformin.' }], update: 'Answered.', minimumAlertLevel: 1 });
  check('missed medicine → needs attention, acks that alert', missed?.kind === 'attention' && missed.alertId === 'a2' && missed.params[1].includes('Call details: Answered.'), missed);
  const low = planFamilyMessage({ ...base, alerts: [{ id: 'a1', level: 1, title: 'Low', message: 'Amma seemed low.' }], update: 'Answered.', minimumAlertLevel: 1 });
  check('low mood only → call update mentioning it', low?.kind === 'call_update' && low.params[1] === 'Answered. Amma seemed low.' && low.alertId === null, low);
  check('low mood + "needs attention only" → nothing', planFamilyMessage({ ...base, alerts: [{ id: 'a1', level: 1, title: 'Low', message: 'x' }], minimumAlertLevel: 2 }) === null);
  const emerg = planFamilyMessage({
    ...base, minimumAlertLevel: 1,
    alerts: [{ id: 'h', level: 3, title: 'Health', message: 'Unwell.' }, { id: 'e', level: 4, title: 'Emergency', message: 'Chest pain.' }]
  });
  check('emergency wins, carries the parent phone', emerg?.kind === 'emergency' && emerg.alertId === 'e' && emerg.params[2] === '+919876543210', emerg);
  check('"emergencies only" skips a health concern', planFamilyMessage({ ...base, alerts: [{ id: 'h', level: 3, title: 'H', message: 'x' }], minimumAlertLevel: 4 }) === null);
  check('"emergencies only" still sends an emergency', planFamilyMessage({ ...base, alerts: [{ id: 'e', level: 4, title: 'E', message: 'x' }], minimumAlertLevel: 4 })?.kind === 'emergency');
}

// ============================================================================
// PART B — flow against throwaway database rows
// ============================================================================
interface GraphRequest { url: string; auth: string; body: { to: string; type: string; template?: { name: string; components: unknown[] }; text?: { body: string } } }

function makeFakeGraph(stamp: number) {
  const requests: GraphRequest[] = [];
  let mode: 'ok' | 'fail' = 'ok';
  let n = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    requests.push({ url: String(url), auth: headers.Authorization, body: JSON.parse(String(init.body)) });
    if (mode === 'fail') {
      return new Response(JSON.stringify({ error: { message: 'Message undeliverable', code: 131026 } }), { status: 400 });
    }
    n += 1;
    return new Response(JSON.stringify({ messages: [{ id: `wamid.test.${stamp}.${n}` }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { requests, fetchImpl, setMode: (m: 'ok' | 'fail') => { mode = m; } };
}

function makeFakeSarvam(stamp: number) {
  let n = 0;
  const calls: unknown[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    n += 1;
    return new Response(JSON.stringify({ attempt_id: `att_wa_${stamp}_d${n}` }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const sarvamConfig: SarvamConfig = {
  apiKey: 'test-key', orgId: 'org_1', workspaceId: 'ws_1', appId: 'app_1', appVersion: 2, connectionId: 'conn_1',
  agentPhoneNumber: '+910000000000', apiBase: 'http://sarvam.test/api/outbounds', webhookSecret: 's3cret', appUrl: 'http://app.test'
};
const waConfig: WhatsAppConfig = {
  accessToken: 'wa-token', phoneNumberId: '1234567890', apiVersion: 'v23.0', apiBase: 'http://graph.test',
  templateLanguage: 'en', appUrl: 'http://app.test'
};

const envelope = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', ...value } }] }]
});

async function partB() {
  console.log('\nB. Flow against throwaway database rows');
  const stamp = Date.now();
  const digits8 = String(stamp).slice(-8);
  const ownerPhone = `+9198${digits8}`;
  const ownerDigits = ownerPhone.slice(1);
  const strangerPhone = `+9197${digits8}`;
  const parentPhone = `+9196${digits8}`;

  try {
    await prisma.whatsAppMessage.findFirst({ select: { id: true } });
  } catch {
    console.log('  SKIP  WhatsApp tables are not in the database yet (apply the additive schema update first).');
    return;
  }

  const emails: Array<{ to: string; alertType: string; alertLevel: string }> = [];
  const sendEmail = (async (p: { to: string; alertType: string; alertLevel: string }) => {
    emails.push({ to: p.to, alertType: p.alertType, alertLevel: p.alertLevel });
    return { success: true, simulated: true };
  }) as never;
  const graph = makeFakeGraph(stamp);
  const sarvam = makeFakeSarvam(stamp);
  const deps = { whatsapp: waConfig, fetchImpl: graph.fetchImpl, sendEmail };
  const inboundDeps: InboundDeps = { ...deps, dispatch: { config: sarvamConfig, fetchImpl: sarvam.fetchImpl } };

  const user = await prisma.user.create({
    data: {
      id: newId('usr'), name: 'WhatsApp Tester', email: `whatsapp-test-${stamp}@example.com`, phone: ownerPhone,
      subscription: { create: { id: newId('sub'), planId: 'family', status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 864e5), amount: 1299 } },
      notificationPreferences: { create: { whatsapp: true, whatsappOptInAt: new Date(), whatsappVerifiedAt: new Date(), minimumAlertLevel: 1 } }
    }
  });

  try {
    const med = (name: string): LinkedMedicineDetail => ({ name, dosage: '1 tab', foodRelation: 'after_food', questionScript: `Did you take your ${name}?` });
    const meds = [med('Telmisartan'), med('Metformin')];
    const parent = await prisma.parentProfile.create({
      data: {
        id: newId('parent'), userId: user.id, name: 'Test Amma', relationship: 'Mother', phone: parentPhone,
        language: 'Telugu', callTime: '08:30 AM', consentGiven: true, createdAt: new Date(Date.UTC(2026, 8, 20)),
        callSchedule: { create: [{ id: newId('slot'), time: '08:30 AM', slot: 'morning', label: 'Morning', linkedMedicineNames: meds.map(m => m.name), linkedMedicinesJson: JSON.stringify(meds) }] }
      }
    });

    let k = 0;
    const placedCall = async (slot = 'evening') => {
      k += 1;
      return prisma.callLog.create({
        data: {
          id: newId('call'), parentId: parent.id, slot, callDate: '2026-10-05', scheduledTime: new Date().toISOString(),
          status: 'placed', summary: 'Call placed.', providerAttemptId: `att_wa_${stamp}_${k}`, startedAt: new Date(),
          resultJson: JSON.stringify({ medicines: meds })
        }
      });
    };
    const answer = (attemptId: string, vars: Record<string, string>, said = 'Yes, I am fine') =>
      processSarvamWebhook(
        { attempt_id: attemptId, status: 'connected', duration: 60, final_agent_variables: vars, interaction_transcript: [{ role: 'agent', en_text: 'Hello' }, { role: 'user', en_text: said }] },
        { deps }
      );
    const templatesSent = () => graph.requests.filter(r => r.body.type === 'template');
    const lastTemplate = () => templatesSent()[templatesSent().length - 1];
    const msgRow = (callLogId: string, kind?: string) => prisma.whatsAppMessage.findFirst({ where: { callLogId, ...(kind ? { kind } : {}) } });

    // ---- B1 all fine: the real dispatcher + webhook → one call update ------------------
    console.log('\nB1. All medicines taken → one "call update" message, no email');
    await runDispatch({ now: new Date(Date.UTC(2026, 9, 5, 3, 30)), fetchImpl: sarvam.fetchImpl, config: sarvamConfig, alertDeps: deps, parentIds: [parent.id] });
    const log1 = await prisma.callLog.findFirst({ where: { parentId: parent.id, slot: 'morning' } });
    check('morning call placed', log1?.status === 'placed' && !!log1.providerAttemptId, log1?.status);
    await answer(log1!.providerAttemptId!, { all_medicines_taken: 'yes', mood: 'cheerful', health_concern: 'none', emergency: 'no' });
    check('one template sent', templatesSent().length === 1, graph.requests.length);
    const t1 = lastTemplate();
    check('aaptha_call_result to the owner', t1?.body.template?.name === 'aaptha_call_result' && t1.body.to === ownerDigits, t1?.body);
    check('bearer token + phone number id in URL', t1?.auth === 'Bearer wa-token' && t1.url === 'http://graph.test/v23.0/1234567890/messages');
    const row1 = await msgRow(log1!.id);
    check('stored as sent with Meta id', row1?.status === 'sent' && !!row1.providerMessageId && row1.body.includes('Telmisartan taken'), row1);
    check('no email', emails.length === 0);
    await answer(log1!.providerAttemptId!, { all_medicines_taken: 'yes' });
    check('duplicate webhook sends nothing more', templatesSent().length === 1);

    // ---- B2 missed medicine → needs attention ------------------------------------------
    console.log('\nB2. Missed medicine → one "needs attention" message with buttons');
    const log2 = await placedCall();
    await answer(log2.providerAttemptId!, { all_medicines_taken: 'partial', medicines_taken: 'Telmisartan', medicines_missed: 'Metformin', mood: 'calm' });
    const t2 = lastTemplate();
    check('aaptha_call_alert', t2?.body.template?.name === 'aaptha_call_alert' && templatesSent().length === 2, t2?.body.template?.name);
    const alert2 = await prisma.alertRecord.findFirst({ where: { callLogId: log2.id } });
    check('alert marked as sent on WhatsApp', alert2?.channel === 'whatsapp', alert2?.channel);
    const row2 = await msgRow(log2.id);
    check('message points at the alert', row2?.alertId === alert2?.id && row2?.level === 2);
    check('still no email (level 2)', emails.length === 0);

    // ---- B3 delivery statuses only move forward -----------------------------------------
    console.log('\nB3. Delivery statuses');
    const st = (status: string, id = row2!.providerMessageId!) => envelope({ statuses: [{ id, status, recipient_id: ownerDigits, timestamp: '1' }] });
    await processWhatsAppWebhook(st('delivered'), inboundDeps);
    await processWhatsAppWebhook(st('read'), inboundDeps);
    await processWhatsAppWebhook(st('delivered'), inboundDeps);
    check('read is kept (no downgrade)', (await prisma.whatsAppMessage.findUnique({ where: { id: row2!.id } }))?.status === 'read');
    const unknown = await processWhatsAppWebhook(st('read', 'wamid.unknown'), inboundDeps);
    check('unknown message id ignored', unknown.statuses === 0);

    // ---- B4 "I'll handle it" ---------------------------------------------------------
    console.log('\nB4. "I\'ll handle it" button');
    const tap = (from: string, id: string, payload: string, contextId: string) =>
      envelope({ messages: [{ from, id, timestamp: '1', type: 'button', context: { from: 'biz', id: contextId }, button: { payload, text: payload } }] });
    await processWhatsAppWebhook(tap(strangerPhone.slice(1), `wamid.in.${stamp}.1`, 'ack', row2!.providerMessageId!), inboundDeps);
    check('tap from another number does nothing', !(await prisma.alertRecord.findUnique({ where: { id: alert2!.id } }))?.acknowledgedAt);
    const before4 = graph.requests.length;
    const r4 = await processWhatsAppWebhook(tap(ownerDigits, `wamid.in.${stamp}.2`, 'ack', row2!.providerMessageId!), inboundDeps);
    const alert4 = await prisma.alertRecord.findUnique({ where: { id: alert2!.id } });
    check('alert acknowledged + resolved', !!alert4?.acknowledgedAt && alert4.status === 'resolved', alert4);
    const reply4 = graph.requests[graph.requests.length - 1];
    check('free-text confirmation sent', r4.replies === 1 && reply4.body.type === 'text' && reply4.body.text?.body === WA_REPLIES.acknowledged);
    await processWhatsAppWebhook(tap(ownerDigits, `wamid.in.${stamp}.2`, 'ack', row2!.providerMessageId!), inboundDeps);
    check('re-delivered tap ignored', graph.requests.length === before4 + 1);

    // ---- B5 "Call again" ----------------------------------------------------------------
    console.log('\nB5. "Call again" button');
    const callsBefore = sarvam.calls.length;
    const r5 = await processWhatsAppWebhook(tap(ownerDigits, `wamid.in.${stamp}.3`, 'recall', row2!.providerMessageId!), inboundDeps);
    const manual = await prisma.callLog.findFirst({ where: { parentId: parent.id, slot: 'manual' } });
    check('Saathi call placed', sarvam.calls.length === callsBefore + 1 && manual?.status === 'placed', manual?.status);
    check('reply says it is calling', r5.replies === 1 && graph.requests[graph.requests.length - 1].body.text?.body === WA_REPLIES.calling('Test Amma'));

    // ---- B6 emergency mid-call, then the end-of-call result -------------------------------
    console.log('\nB6. Emergency from the mid-call tool, then the call ends');
    const log6 = await placedCall('afternoon');
    await raiseToolEscalation(log6.id, 'I have chest pain', deps);
    const t6 = lastTemplate();
    const p6 = (t6?.body.template?.components[0] as { parameters: Array<{ text: string }> }).parameters;
    check('aaptha_call_emergency sent immediately with the parent phone', t6?.body.template?.name === 'aaptha_call_emergency' && p6[2].text === parentPhone, p6);
    await answer(log6.providerAttemptId!, { all_medicines_taken: 'yes', emergency: 'yes', health_concern: 'chest pain', mood: 'unwell' }, 'I have chest pain');
    const kinds6 = (await prisma.whatsAppMessage.findMany({ where: { callLogId: log6.id } })).map(m => m.kind).sort();
    check('one emergency + one end-of-call update (no second emergency)', JSON.stringify(kinds6) === JSON.stringify(['attention', 'emergency']), kinds6);
    check('no email while WhatsApp works', emails.length === 0);

    // ---- B7 WhatsApp fails on a health concern → email backup ----------------------------
    console.log('\nB7. Send fails for a level-3 alert → email backup');
    graph.setMode('fail');
    const log7 = await placedCall();
    await answer(log7.providerAttemptId!, { all_medicines_taken: 'yes', health_concern: 'dizzy since morning', mood: 'unwell' });
    graph.setMode('ok');
    const row7 = await msgRow(log7.id);
    check('message stored as failed', row7?.status === 'failed' && !!row7.error && !!row7.fallbackEmailedAt, row7);
    check('owner emailed the level-3 alert', emails.length === 1 && emails[0].to === user.email && emails[0].alertLevel === 'level_3', emails);

    console.log('\nB8. Send fails for a level-2 alert → no email');
    graph.setMode('fail');
    const log8 = await placedCall();
    await answer(log8.providerAttemptId!, { all_medicines_taken: 'no', mood: 'calm' });
    graph.setMode('ok');
    check('failed, but no email for level 2', (await msgRow(log8.id))?.status === 'failed' && emails.length === 1);

    // ---- B9 accepted by Meta, fails later (status webhook) --------------------------------
    console.log('\nB9. Level-3 message fails later in the status webhook → email once');
    const log9 = await placedCall();
    await answer(log9.providerAttemptId!, { all_medicines_taken: 'yes', health_concern: 'knee pain', mood: 'unwell' });
    const row9 = await msgRow(log9.id);
    const failedStatus = envelope({ statuses: [{ id: row9!.providerMessageId, status: 'failed', recipient_id: ownerDigits, errors: [{ code: 131026, title: 'Message undeliverable' }] }] });
    await processWhatsAppWebhook(failedStatus, inboundDeps);
    await processWhatsAppWebhook(failedStatus, inboundDeps);
    const row9b = await prisma.whatsAppMessage.findUnique({ where: { id: row9!.id } });
    check('status failed with the error', row9b?.status === 'failed' && (row9b.error || '').includes('131026'), row9b?.error);
    check('emailed exactly once', emails.length === 2, emails.length);

    // ---- B10 family settings --------------------------------------------------------------
    console.log('\nB10. "Only when something needs attention"');
    await prisma.notificationPreferences.update({ where: { userId: user.id }, data: { minimumAlertLevel: 2 } });
    const sent10 = templatesSent().length;
    const log10 = await placedCall();
    await answer(log10.providerAttemptId!, { all_medicines_taken: 'yes', mood: 'calm' });
    check('all-fine call sends nothing', templatesSent().length === sent10);
    const log10b = await placedCall();
    await processSarvamWebhook({ attempt_id: log10b.providerAttemptId, status: 'no_answer' }, { deps });
    check('unreachable (no retry for this call) still sends', templatesSent().length === sent10 + 1 && lastTemplate().body.template?.name === 'aaptha_call_alert');
    await prisma.notificationPreferences.update({ where: { userId: user.id }, data: { minimumAlertLevel: 1 } });

    console.log('\nB11. Not opted in → no WhatsApp; only level 3-4 emailed');
    await prisma.notificationPreferences.update({ where: { userId: user.id }, data: { whatsappOptInAt: null } });
    const sent11 = graph.requests.length;
    const log11 = await placedCall();
    await answer(log11.providerAttemptId!, { all_medicines_taken: 'no', mood: 'calm' });
    check('level 2: nothing sent, no email', graph.requests.length === sent11 && emails.length === 2);
    const log11b = await placedCall();
    await answer(log11b.providerAttemptId!, { all_medicines_taken: 'yes', health_concern: 'fever', mood: 'unwell' });
    check('level 3: emailed, still no WhatsApp', graph.requests.length === sent11 && emails.length === 3);
    await prisma.notificationPreferences.update({ where: { userId: user.id }, data: { whatsappOptInAt: new Date(), whatsappVerifiedAt: new Date() } });

    console.log('\nB12. WhatsApp not configured → alert emails as before');
    const log12 = await placedCall();
    const sent12 = graph.requests.length;
    await processSarvamWebhook(
      { attempt_id: log12.providerAttemptId, status: 'connected', duration: 40, final_agent_variables: { all_medicines_taken: 'no', mood: 'calm' }, interaction_transcript: [{ role: 'user', en_text: 'No' }] },
      { deps: { whatsapp: null, sendEmail } }
    );
    check('level 2 emailed, no WhatsApp call', emails.length === 4 && emails[3].alertLevel === 'level_2' && graph.requests.length === sent12, emails.length);
    check('alert channel = email', (await prisma.alertRecord.findFirst({ where: { callLogId: log12.id } }))?.channel === 'email');

    // ---- B13 replies ------------------------------------------------------------------------
    console.log('\nB13. STOP, START, other text, strangers');
    const text = (from: string, id: string, body: string) => envelope({ messages: [{ from, id, timestamp: '1', type: 'text', text: { body } }] });
    await processWhatsAppWebhook(text(ownerDigits, `wamid.in.${stamp}.10`, 'STOP'), inboundDeps);
    let prefs = await prisma.notificationPreferences.findUnique({ where: { userId: user.id } });
    check('STOP opts out', prefs?.whatsappOptInAt === null && prefs?.whatsapp === false && prefs?.whatsappVerifiedAt === null);
    check('STOP confirmed', graph.requests[graph.requests.length - 1].body.text?.body === WA_REPLIES.stopped);
    await processWhatsAppWebhook(text(ownerDigits, `wamid.in.${stamp}.11`, 'start'), inboundDeps);
    prefs = await prisma.notificationPreferences.findUnique({ where: { userId: user.id } });
    check('START opts back in (account number)', !!prefs?.whatsappOptInAt && prefs.whatsapp === true && prefs.whatsappNumber === null, prefs);
    check('START from the number also proves it is theirs', !!prefs?.whatsappVerifiedAt, prefs);
    // An account pointed at a number nobody has proven gets nothing: opt in with a stranger's number, then see no send.
    await prisma.notificationPreferences.update({ where: { userId: user.id }, data: { whatsappNumber: '+919123456780', whatsappVerifiedAt: null } });
    const unprovenUser = await prisma.user.findUnique({ where: { id: user.id }, include: { notificationPreferences: true } });
    check('an unproven number is never a recipient', unprovenUser ? whatsappRecipient(unprovenUser) === null : false);
    await prisma.notificationPreferences.update({ where: { userId: user.id }, data: { whatsappNumber: null, whatsappVerifiedAt: new Date() } });
    const r13 = await processWhatsAppWebhook(text(ownerDigits, `wamid.in.${stamp}.12`, 'How is amma?'), inboundDeps);
    check('other text gets the auto-reply', r13.replies === 1 && (graph.requests[graph.requests.length - 1].body.text?.body || '').includes('http://app.test/dashboard'));
    const r13b = await processWhatsAppWebhook(text(ownerDigits, `wamid.in.${stamp}.13`, 'Hello?'), inboundDeps);
    check('second message within 12 h: no repeat auto-reply', r13b.replies === 0);
    const sent13 = graph.requests.length;
    const r13c = await processWhatsAppWebhook(text(strangerPhone.slice(1), `wamid.in.${stamp}.14`, 'hi'), inboundDeps);
    check('unknown number: stored, never answered', r13c.messages === 1 && r13c.replies === 0 && graph.requests.length === sent13);

    // ---- B14 the webhook route itself -------------------------------------------------------
    console.log('\nB14. Webhook route');
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me-please-123';
    process.env.WHATSAPP_APP_SECRET = 'route-secret';
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    const route = await import('../src/app/api/whatsapp/webhook/route');
    const ok = await route.GET(new Request('http://app.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me-please-123&hub.challenge=42'));
    check('verification echoes the challenge', ok.status === 200 && (await ok.text()) === '42');
    const bad = await route.GET(new Request('http://app.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42'));
    check('wrong verify token → 403', bad.status === 403);
    const raw = JSON.stringify(envelope({ statuses: [] }));
    const unsigned = await route.POST(new Request('http://app.test/api/whatsapp/webhook', { method: 'POST', body: raw }));
    check('unsigned POST → 401', unsigned.status === 401);
    const signed = await route.POST(new Request('http://app.test/api/whatsapp/webhook', {
      method: 'POST', body: raw,
      headers: { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'route-secret').update(raw).digest('hex') }
    }));
    check('signed POST → 200', signed.status === 200);
  } finally {
    await prisma.whatsAppMessage.deleteMany({ where: { OR: [{ userId: user.id }, { phone: { in: [ownerPhone, strangerPhone] } }] } });
    await prisma.user.delete({ where: { id: user.id } });
    const left = (await prisma.user.count({ where: { email: { startsWith: 'whatsapp-test-' } } }))
      + (await prisma.whatsAppMessage.count({ where: { phone: { in: [ownerPhone, strangerPhone] } } }));
    console.log(`\nCleanup: test rows removed (${left === 0 ? 'clean' : 'LEFTOVER ROWS!'})`);
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
