/**
 * Applies Sarvam's end-of-call webhook to the database: updates the CallLog,
 * schedules retries and follow-ups, records the parent's consent, and raises
 * alerts. Safe to call twice for the same call (Sarvam's webhook retry
 * behaviour is undocumented).
 *
 * The same webhook URL also receives the "Aaptha Alert" agent's calls
 * (escalations); those are routed to lib/escalation.ts. Calls the parent makes
 * TO Saathi (call-back) arrive through processInboundCall.
 */
import { prisma } from './prisma';
import { newId } from './db';
import { istDateString, formatIstClock, istMinutesOfDay, parseClockTime } from './ist';
import { normalizePhone } from './phone';
import {
  SarvamWebhookPayload,
  SARVAM_STATUSES,
  SarvamStatus,
  interpretCallResult,
  decideAlerts,
  parseTranscript,
  ALERT_TITLES
} from './callInterpretation';
import { raiseAlert, raiseUnreachableAlert, recordAlert, escalateEmergencies, RaiseAlertResult, RecordAlertResult, AlertDeps } from './alerts';
import { notifyFamily } from './familyNotify';
import { describeAnsweredCall } from './familyMessages';
import { readSnapshot, CallSnapshot, NON_RETRY_SLOTS } from './callPlanning';
import { findAlertAttempt, processAlertCallResult, startEscalation } from './escalation';
import { runInsightsForParent } from './insights';
import { buildAgentVariables, OutboundCallInput } from './sarvam';
import { slotMedicines } from './callDispatch';
import { LinkedMedicineDetail } from './types';

export const MAX_CALL_ATTEMPTS = 3;
export const RETRY_DELAY_MINUTES = 15;
/** "Later" / "not yet": Saathi calls back this many minutes after the call. */
export const FOLLOW_UP_DELAY_MINUTES = 40;
export const MAX_FOLLOW_UPS_PER_DAY = 2;

/** Marker set when a call was given up on because no result ever arrived. */
export const RESULT_NOT_RECEIVED = 'result_not_received';

export type WebhookOutcome =
  | { status: 'processed'; callLogId: string; alertsRaised: number; retryAt: string | null; followUpAt?: string | null }
  | { status: 'duplicate'; callLogId: string }
  | { status: 'alert_call'; escalationAttemptId: string; result: 'processed' | 'duplicate' }
  | { status: 'unknown_attempt' }
  | { status: 'invalid'; reason: string };

/** The medicines asked about, stored on the CallLog when the call was placed. */
export function readMedicineSnapshot(resultJson: string | null): LinkedMedicineDetail[] {
  return readSnapshot(resultJson).medicines;
}

function metadataCallLogId(webhookConfig: unknown): string | null {
  if (!webhookConfig || typeof webhookConfig !== 'object') return null;
  const meta = (webhookConfig as Record<string, unknown>).metadata;
  if (!meta || typeof meta !== 'object') return null;
  const id = (meta as Record<string, unknown>).callLogId;
  return typeof id === 'string' && id ? id : null;
}

function metadataOf(payload: SarvamWebhookPayload): unknown {
  const wc = payload.webhook_config;
  if (wc && typeof wc === 'object' && (wc as Record<string, unknown>).metadata) return (wc as Record<string, unknown>).metadata;
  return payload.metadata;
}

type CallLogRow = NonNullable<Awaited<ReturnType<typeof prisma.callLog.findUnique>>>;
type ParentRow = NonNullable<Awaited<ReturnType<typeof prisma.parentProfile.findUnique>>>;

/**
 * Everything that follows an answered call: the record, the parent's consent and
 * "stop calling me", follow-ups, alerts, one family message, escalation and trends.
 */
async function applyAnsweredCall(
  log: CallLogRow,
  parent: ParentRow,
  interp: ReturnType<typeof interpretCallResult>,
  snapshot: CallSnapshot,
  opts: { now: Date; deps: AlertDeps; duration: number; interactionId: string | null }
): Promise<WebhookOutcome> {
  const { now, deps } = opts;
  const callType = snapshot.callType || (log.slot === 'callback' ? 'callback' : 'reminder');
  const slotLabel = callType === 'companion' ? 'weekly chat' : callType === 'followup' ? 'follow-up' : log.slot || 'check-in';
  const asked = snapshot.asked;

  // One follow-up about "later" medicines, a couple of times a day at most.
  let followUpAt: Date | null = null;
  const hasLater = interp.medicineResults.some(r => r.status === 'later');
  const parentStopping = interp.stopCalls || (asked?.askConsent && interp.consent === 'no');
  if (hasLater && callType !== 'followup' && !parentStopping && !parent.isPaused) {
    const today = istDateString(now);
    const [placed, pending] = await Promise.all([
      prisma.callLog.count({ where: { parentId: parent.id, slot: 'followup', callDate: today } }),
      prisma.callLog.count({ where: { parentId: parent.id, callDate: today, followUpAt: { not: null } } })
    ]);
    // Never past 10 PM IST.
    const at = new Date(now.getTime() + FOLLOW_UP_DELAY_MINUTES * 60000);
    if (placed + pending < MAX_FOLLOW_UPS_PER_DAY && istMinutesOfDay(at) <= 22 * 60 && istDateString(at) === today) followUpAt = at;
  }

  await prisma.callLog.update({
    where: { id: log.id },
    data: {
      status: 'answered',
      durationSeconds: opts.duration,
      actualAnswerTime: formatIstClock(now),
      medicationConfirmed: interp.medicationConfirmed,
      mood: interp.mood,
      summary: interp.summary,
      notes: interp.feedback,
      interactionId: opts.interactionId,
      failureReason: null,
      nextRetryAt: null,
      followUpAt,
      endedAt: now,
      parentWords: interp.parentWords,
      transcriptJson: interp.transcript.length ? JSON.stringify(interp.transcript) : null,
      resultJson: JSON.stringify({
        ...snapshot,
        callType,
        medicineResults: interp.medicineResults,
        healthConcern: interp.healthConcern,
        emergencyFlag: interp.emergencyFlag,
        sleep: interp.sleep,
        appetite: interp.appetite,
        pain: interp.pain,
        painWhere: interp.painWhere,
        runningLow: interp.runningLow,
        stoppedReason: interp.stoppedReason,
        consent: asked?.askConsent ? interp.consent : null,
        stopCalls: interp.stopCalls
      })
    }
  });

  // The parent's own consent, and "stop calling me".
  const parentData: Record<string, unknown> = {};
  if (asked?.askConsent && interp.consent === 'yes' && !interp.stopCalls) {
    parentData.parentConsent = 'given';
    parentData.parentConsentAt = now;
    parentData.parentConsentCallId = log.id;
  }
  if (asked?.askConsent && interp.consent === 'no') {
    Object.assign(parentData, {
      parentConsent: 'declined', parentConsentAt: now, parentConsentCallId: log.id,
      isPaused: true, pauseReason: `${parent.name} said no to the calls`, pauseUntil: null
    });
  }
  if (interp.stopCalls) {
    Object.assign(parentData, {
      parentConsent: 'withdrawn', parentConsentAt: now, parentConsentCallId: log.id,
      isPaused: true, pauseReason: `${parent.name} asked Saathi to stop calling`, pauseUntil: null
    });
  }
  // What was asked this time is not due again for a while (only once the parent actually answered).
  if (asked?.saySafetyLine) parentData.lastSafetyLineAt = now;
  if (asked?.askWellbeing) parentData.lastWellbeingAt = now;
  if (asked?.refillMedicines?.length) parentData.lastRefillCheckAt = now;
  if (callType === 'companion') parentData.lastCompanionAt = now;
  if (Object.keys(parentData).length) await prisma.parentProfile.update({ where: { id: parent.id }, data: parentData });

  const recorded: RecordAlertResult[] = [];
  for (const decision of decideAlerts(asked?.askConsent ? interp : { ...interp, consent: 'not_asked' }, parent.name, slotLabel, { callType })) {
    recorded.push(await recordAlert({ parentId: parent.id, callLogId: log.id, ...decision }));
  }
  // One message to the family about the whole call.
  await notifyFamily(
    {
      parentId: parent.id,
      callLogId: log.id,
      alerts: recorded.flatMap(r => (r.alert ? [r.alert] : [])),
      update: describeAnsweredCall({
        slotLabel,
        answeredAt: formatIstClock(now),
        medicineResults: interp.medicineResults,
        mood: interp.mood,
        feedback: interp.feedback
      })
    },
    deps
  );
  // Level 4: phone the people who can act (the WhatsApp above already went to the family).
  await escalateEmergencies(parent.id, recorded, interp.healthConcern || interp.summary, deps);

  // Trends across calls never block the webhook.
  try {
    await runInsightsForParent(parent.id, { now, deps });
  } catch (err) {
    console.error('[calls] Insight check failed:', err);
  }

  return {
    status: 'processed',
    callLogId: log.id,
    alertsRaised: recorded.filter(r => r.created).length,
    retryAt: null,
    followUpAt: followUpAt ? followUpAt.toISOString() : null
  };
}

export async function processSarvamWebhook(
  payload: SarvamWebhookPayload,
  opts: { now?: Date; deps?: AlertDeps } = {}
): Promise<WebhookOutcome> {
  const now = opts.now || new Date();
  const deps = opts.deps || {};

  const attemptId = typeof payload.attempt_id === 'string' ? payload.attempt_id : '';
  const status = payload.status as SarvamStatus;
  if (!attemptId) return { status: 'invalid', reason: 'attempt_id is required' };
  if (!SARVAM_STATUSES.includes(status)) return { status: 'invalid', reason: 'unknown status' };

  let log = await prisma.callLog.findUnique({ where: { providerAttemptId: attemptId } });
  if (!log) {
    const fallbackId = metadataCallLogId(payload.webhook_config);
    if (fallbackId) {
      const byId = await prisma.callLog.findUnique({ where: { id: fallbackId } });
      if (byId && (!byId.providerAttemptId || byId.providerAttemptId === attemptId)) log = byId;
    }
  }
  if (!log) {
    // An "Aaptha Alert" call to a family member, neighbour or the parent during an escalation.
    const alertAttempt = await findAlertAttempt(attemptId, metadataOf(payload));
    if (alertAttempt) {
      const result = await processAlertCallResult(alertAttempt.id, payload, { ...deps, now });
      return { status: 'alert_call', escalationAttemptId: alertAttempt.id, result };
    }
    return { status: 'unknown_attempt' };
  }

  // Atomic claim: only one delivery applies the result. A late result may
  // replace a call that was previously given up on as "no result received".
  const claimed = await prisma.callLog.updateMany({
    where: { id: log.id, OR: [{ processedAt: null }, { failureReason: RESULT_NOT_RECEIVED }] },
    data: { processedAt: now, providerAttemptId: attemptId }
  });
  if (claimed.count !== 1) return { status: 'duplicate', callLogId: log.id };

  const parent = await prisma.parentProfile.findUnique({ where: { id: log.parentId } });
  if (!parent) return { status: 'invalid', reason: 'parent not found' };

  const snapshot = readSnapshot(log.resultJson);
  const callType = snapshot.callType || 'reminder';
  const slotLabel = callType === 'companion' ? 'weekly chat' : callType === 'followup' ? 'follow-up' : log.slot || 'check-in';
  const duration = typeof payload.duration === 'number' && payload.duration > 0 ? Math.round(payload.duration) : 0;
  const interactionId = typeof payload.interaction_id === 'string' ? payload.interaction_id : null;
  const failureReason =
    typeof payload.failure_reason === 'string' && payload.failure_reason.trim()
      ? payload.failure_reason.trim().slice(0, 300)
      : null;

  const alertResults: RaiseAlertResult[] = [];

  // ---------------------------------------------------------------- answered
  const connectedInterp =
    status === 'connected'
      ? interpretCallResult(payload, snapshot.medicines, parent.name, { refillMedicines: snapshot.asked?.refillMedicines })
      : null;
  // Picked up but never replied (the agent nudged and hung up): handled like an unanswered call below.
  const silentPickup = !!connectedInterp?.noResponse;

  if (status === 'connected' && connectedInterp && !silentPickup) {
    return applyAnsweredCall(log, parent, connectedInterp, snapshot, { now, deps, duration, interactionId });
  }

  // ------------------------------------------------------------------ failed
  if (status === 'failed') {
    await prisma.callLog.update({
      where: { id: log.id },
      data: {
        status: 'failed',
        durationSeconds: 0,
        interactionId,
        failureReason: failureReason || 'call_failed',
        nextRetryAt: null,
        endedAt: now,
        summary: `The ${slotLabel} call could not be placed${failureReason ? ` (${failureReason})` : ''}.`
      }
    });
    if (callType !== 'companion') {
      alertResults.push(await raiseUnreachableAlert(
        { id: log.id, parentId: parent.id, attemptNumber: log.attemptNumber, slot: log.slot },
        parent.name,
        'failed',
        failureReason,
        deps
      ));
    }
    return { status: 'processed', callLogId: log.id, alertsRaised: alertResults.filter(r => r.created).length, retryAt: null };
  }

  // ------------------------------------------------- no answer / busy: retry
  const finalStatus = status === 'busy' ? 'busy' : 'unanswered';
  const sameDay = log.callDate === istDateString(now);
  const parentCallable = !parent.isDeleted && !parent.isPaused;
  const scheduled = !!log.slotId && !NON_RETRY_SLOTS.includes(log.slot || '');
  const canRetry = scheduled && sameDay && parentCallable && log.attemptNumber < MAX_CALL_ATTEMPTS;
  const retryAt = canRetry ? new Date(now.getTime() + RETRY_DELAY_MINUTES * 60000) : null;

  await prisma.callLog.update({
    where: { id: log.id },
    data: {
      status: finalStatus,
      durationSeconds: silentPickup ? duration : 0,
      interactionId,
      failureReason: silentPickup ? 'no_response' : failureReason,
      nextRetryAt: retryAt,
      endedAt: now,
      summary: silentPickup
        ? `${parent.name} picked up the ${slotLabel} call but did not reply.${retryAt ? ' We will try again shortly.' : ''}`
        : `${parent.name} did not pick up the ${slotLabel} call (${finalStatus === 'busy' ? 'line busy' : 'no answer'}).${retryAt ? ' We will try again shortly.' : ''}`
    }
  });

  if (!retryAt) {
    if (callType === 'followup') {
      // The "later" medicines are still unconfirmed.
      const names = snapshot.medicines.map(m => m.name).join(', ');
      alertResults.push(await raiseAlert(
        {
          parentId: parent.id,
          callLogId: log.id,
          level: 2,
          title: ALERT_TITLES.missed,
          message: `${parent.name} said they would take ${names} later, but didn't answer when Saathi called back to check.`
        },
        deps
      ));
    } else if (callType !== 'companion') {
      alertResults.push(await raiseUnreachableAlert(
        { id: log.id, parentId: parent.id, attemptNumber: log.attemptNumber, slot: log.slot },
        parent.name,
        status === 'busy' ? 'busy' : 'no_answer',
        failureReason,
        deps
      ));
    }
  }

  return {
    status: 'processed',
    callLogId: log.id,
    alertsRaised: alertResults.filter(r => r.created).length,
    retryAt: retryAt ? retryAt.toISOString() : null
  };
}

/**
 * Called by the agent's mid-call "escalate" tool when the parent describes an
 * emergency. Raises the level-4 alert immediately and starts phoning the people
 * who can act (the end-of-call result will not duplicate it: alerts are unique
 * per call and title, escalations unique per alert).
 */
export async function raiseToolEscalation(
  callLogId: string,
  reason: string,
  deps: AlertDeps = {}
): Promise<{ status: 'raised' | 'already_raised' | 'unknown_call' }> {
  const log = await prisma.callLog.findUnique({ where: { id: callLogId } });
  if (!log) return { status: 'unknown_call' };

  const parent = await prisma.parentProfile.findUnique({ where: { id: log.parentId } });
  if (!parent) return { status: 'unknown_call' };

  const cleanReason = reason.replace(/\s+/g, ' ').trim().slice(0, 300);
  const res = await raiseAlert(
    {
      parentId: parent.id,
      callLogId: log.id,
      level: 4,
      title: ALERT_TITLES.emergency,
      message: `During a check-in call, ${parent.name} may have described an emergency${cleanReason ? `: "${cleanReason}"` : ''}. Please call ${parent.name} right away. If it is serious, call 112 or ask someone nearby to go to them.`
    },
    deps
  );
  if (res.created && res.alertId) {
    await startEscalation(
      { parentId: parent.id, alertId: res.alertId, kind: 'emergency', reason: cleanReason || 'They may have described an emergency on the call.' },
      deps
    ).catch(err => console.error('[calls] Escalation could not start:', err));
  }
  return { status: res.created ? 'raised' : 'already_raised' };
}

// ---------------------------------------------------------------------------
// Call-back: the parent rings Saathi's number (Sarvam inbound deployment)
// ---------------------------------------------------------------------------

/** Parents whose phone is this number (two parents can share a landline). */
async function parentsForCaller(phone: string) {
  const norm = normalizePhone(phone);
  if (!norm.ok) return [];
  return prisma.parentProfile.findMany({
    where: { phone: norm.e164, isDeleted: false },
    include: { callSchedule: { where: { isActive: true } }, medicines: true, user: true },
    orderBy: { createdAt: 'asc' }
  });
}

/** Medicines from today's slots that have passed without a confirmed answer. */
async function unconfirmedToday(parent: Awaited<ReturnType<typeof parentsForCaller>>[number], now: Date): Promise<LinkedMedicineDetail[]> {
  const today = istDateString(now);
  const logs = await prisma.callLog.findMany({ where: { parentId: parent.id, callDate: today }, orderBy: { createdAt: 'desc' } });
  const nowMin = istMinutesOfDay(now);
  const inactive = new Set(parent.medicines.filter(m => !m.isActive).map(m => m.name));
  const purposes = new Map(parent.medicines.filter(m => m.isActive && m.purpose).map(m => [m.name, m.purpose!]));
  const out: LinkedMedicineDetail[] = [];
  for (const slot of parent.callSchedule) {
    const t = parseClockTime(slot.time);
    if (t === null || t > nowMin) continue;
    const latest = logs.find(l => l.slotId === slot.id);
    if (latest?.status === 'answered' && latest.medicationConfirmed) continue;
    for (const m of slotMedicines(slot, inactive, purposes)) if (!out.some(o => o.name === m.name)) out.push(m);
  }
  return out;
}

/**
 * Sarvam "on-start" lookup for a call-back: which parent is calling and what Saathi
 * should ask. Creates the CallLog up front so the escalate tool has a call id.
 * Returns null for numbers that aren't a parent (the agent then just takes a message).
 */
export async function buildInboundContext(callerPhone: string, now: Date = new Date()) {
  const parents = await parentsForCaller(callerPhone);
  const parent = parents[0];
  if (!parent) return null;
  const medicines = await unconfirmedToday(parent, now);
  const snapshot: CallSnapshot = {
    medicines,
    callType: 'callback',
    asked: {
      askConsent: parent.parentConsent !== 'given',
      saySafetyLine: false,
      lastCallNote: null,
      askWellbeing: false,
      refillMedicines: [],
      specialDay: null
    }
  };
  const log = await prisma.callLog.create({
    data: {
      id: newId('call'),
      parentId: parent.id,
      slot: 'callback',
      callDate: istDateString(now),
      createdAt: now,
      scheduledTime: now.toISOString(),
      status: 'placed',
      startedAt: now,
      mood: 'neutral',
      summary: `${parent.name} called Saathi.`,
      resultJson: JSON.stringify(snapshot)
    }
  });
  const input: OutboundCallInput = {
    callLogId: log.id,
    parentId: parent.id,
    slot: 'callback',
    slotLabel: 'Call-back',
    parentName: parent.name,
    parentPhone: parent.phone,
    language: parent.language,
    caregiverName: parent.user.name,
    relationship: parent.relationship,
    medicines,
    callType: 'callback',
    askConsent: snapshot.asked!.askConsent,
    supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim() || null
  };
  return { callLogId: log.id, parentId: parent.id, variables: buildAgentVariables(input) };
}

/** End-of-call webhook of an inbound (call-back) call. Idempotent by interaction id. */
export async function processInboundCall(
  payload: SarvamWebhookPayload,
  opts: { now?: Date; deps?: AlertDeps } = {}
): Promise<WebhookOutcome> {
  const now = opts.now || new Date();
  const interactionId = typeof payload.interaction_id === 'string' ? payload.interaction_id : '';
  const caller = typeof payload.user_phone_number === 'string' ? payload.user_phone_number : '';
  if (!interactionId || !caller) return { status: 'invalid', reason: 'interaction_id and user_phone_number are required' };

  const existing = await prisma.callLog.findUnique({ where: { providerAttemptId: interactionId } });
  if (existing?.processedAt) return { status: 'duplicate', callLogId: existing.id };

  const parents = await parentsForCaller(caller);
  if (parents.length === 0) return { status: 'unknown_attempt' };

  // The log made by the on-start lookup a few minutes ago, if Sarvam called it.
  let log =
    existing ||
    (await prisma.callLog.findFirst({
      where: {
        parentId: { in: parents.map(p => p.id) },
        slot: 'callback',
        providerAttemptId: null,
        processedAt: null,
        createdAt: { gte: new Date(now.getTime() - 30 * 60000) }
      },
      orderBy: { createdAt: 'desc' }
    }));
  if (!log) {
    const parent = parents[0];
    log = await prisma.callLog.create({
      data: {
        id: newId('call'),
        parentId: parent.id,
        slot: 'callback',
        callDate: istDateString(now),
        createdAt: now,
        scheduledTime: now.toISOString(),
        status: 'placed',
        startedAt: now,
        mood: 'neutral',
        summary: `${parent.name} called Saathi.`,
        resultJson: JSON.stringify({ medicines: await unconfirmedToday(parent, now), callType: 'callback' })
      }
    });
  }

  const claimed = await prisma.callLog.updateMany({
    where: { id: log.id, processedAt: null },
    data: { processedAt: now, providerAttemptId: interactionId }
  });
  if (claimed.count !== 1) return { status: 'duplicate', callLogId: log.id };

  const parent = await prisma.parentProfile.findUnique({ where: { id: log.parentId } });
  if (!parent) return { status: 'invalid', reason: 'parent not found' };
  const snapshot = readSnapshot(log.resultJson);
  const interp = interpretCallResult(payload, snapshot.medicines, parent.name);
  const duration = typeof payload.duration === 'number' && payload.duration > 0 ? Math.round(payload.duration) : 0;
  return applyAnsweredCall(log, parent, interp, { ...snapshot, callType: 'callback' }, {
    now,
    deps: opts.deps || {},
    duration,
    interactionId
  });
}

export { parseTranscript };
