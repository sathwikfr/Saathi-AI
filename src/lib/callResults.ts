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
  partnerPayload,
  Interpretation,
  ALERT_TITLES
} from './callInterpretation';
import { parseRanges } from './readings';
import { Prisma } from '@prisma/client';
import { raiseAlert, raiseUnreachableAlert, recordAlert, notifyThenEscalate, RaiseAlertResult, RecordAlertResult, AlertDeps } from './alerts';
import { notifyFamily } from './familyNotify';
import { describeAnsweredCall } from './familyMessages';
import { readSnapshot, CallSnapshot, CallExtras, PartnerSnapshot, NON_RETRY_SLOTS } from './callPlanning';
import { findAlertAttempt, processAlertCallResult } from './escalation';
import { runInsightsForParent } from './insights';
import { buildAgentVariables, OutboundCallInput } from './sarvam';
import { slotMedicines } from './callDispatch';
import { LinkedMedicineDetail } from './types';

/** First try + one retry (decided 2026-10-04): a missed call is tried once more, then the family is told. */
export const MAX_CALL_ATTEMPTS = 2;
export const RETRY_DELAY_MINUTES = 30; // was 15; decided 2026-10-08
/** "Later" / "not yet": Saathi calls back this many minutes after the call. */
export const FOLLOW_UP_DELAY_MINUTES = 40;
/**
 * Extra "you said later" calls: off since 2026-10-08 (3 calls a day only). A "later" tablet is asked again on the next
 * scheduled call, and still "later" on the last call of the day counts as not taken (alert). The follow-up code stays,
 * so an exception can switch it on again (env FOLLOW_UP_CALLS_PER_DAY, 1-3).
 */
export const maxFollowUpsPerDay = (): number => {
  const n = Number(process.env.FOLLOW_UP_CALLS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 3) : 0;
};

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
/** Readings, the parent's message back, and a shared memory: kept for the family. */
async function saveFromCall(parentId: string, callLogId: string, interp: Interpretation, now: Date, kind: 'self' | 'partner') {
  const rows: Prisma.HealthReadingCreateManyInput[] = [];
  if (interp.bp) rows.push({ id: newId('rdg'), parentId, callLogId, kind: 'bp', systolic: interp.bp.systolic, diastolic: interp.bp.diastolic, takenAt: now, source: 'call' });
  if (interp.sugar) rows.push({ id: newId('rdg'), parentId, callLogId, kind: 'sugar', value: interp.sugar.value, context: interp.sugar.context, takenAt: now, source: 'call' });
  if (rows.length) await prisma.healthReading.createMany({ data: rows });
  if (interp.feedback) {
    const parent = await prisma.parentProfile.findUnique({ where: { id: parentId }, select: { name: true } });
    await prisma.familyMessage.create({
      data: { id: newId('msg'), parentId, authorName: parent?.name || 'Your parent', direction: 'from_parent', text: interp.feedback, status: 'received', callLogId, deliveredAt: now }
    });
  }
  // Life stories were retired on 2026-10-08 (the weekly chat that fed them isn't offered): nothing new is saved.
}

/** Family messages read out, appointment reminders given and "how did it go?" answered on this call. */
async function markFamilyAsksDone(callLogId: string, asked: CallExtras | undefined, interp: Interpretation, now: Date) {
  if (!asked) return;
  if (asked.familyMessageIds?.length) {
    await prisma.familyMessage.updateMany({
      where: { id: { in: asked.familyMessageIds }, status: 'pending' },
      data: { status: 'delivered', deliveredAt: now, callLogId }
    });
  }
  for (const r of asked.appointmentReminded || []) {
    await prisma.appointment.updateMany({ where: { id: r.id }, data: r.which === 'day_before' ? { remindedDayBefore: now } : { remindedSameDay: now } });
  }
  if (asked.appointmentFollowUpId && (interp.appointmentUpdate || interp.transcript.some(t => t.role === 'user'))) {
    await prisma.appointment.updateMany({
      where: { id: asked.appointmentFollowUpId, followedUpAt: null },
      data: { followedUpAt: now, outcomeText: interp.appointmentUpdate }
    });
  }
}

function extraFacts(interp: Interpretation): string[] {
  const out: string[] = [];
  if (interp.bp) out.push(`BP ${interp.bp.systolic}/${interp.bp.diastolic}`);
  if (interp.sugar) out.push(`Sugar ${Math.round(interp.sugar.value)}${interp.sugar.context === 'fasting' ? ' (fasting)' : interp.sugar.context === 'after_food' ? ' (after food)' : ''}`);
  if (interp.appointmentUpdate) out.push(`About the appointment: ${interp.appointmentUpdate}`);
  if (interp.helperVisited) out.push(interp.helperVisited === 'yes' ? 'Helper came today' : "Helper didn't come today");
  return out;
}

/**
 * Couple calls: the second parent gets their own call log (linked to the first), results,
 * readings, alerts and family update. The emergency scan stays with the first parent's alerts
 * (one escalation per call); the partner's own "emergency" answer still raises theirs.
 */
async function applyPartner(
  primaryLog: CallLogRow,
  part: PartnerSnapshot,
  interp: Interpretation,
  opts: { now: Date; deps: AlertDeps; duration: number; status: 'answered' | 'unanswered' | 'busy' | 'failed'; summary?: string }
) {
  const partner = await prisma.parentProfile.findUnique({ where: { id: part.parentId } });
  if (!partner || partner.isDeleted) return;
  const answered = opts.status === 'answered';
  const data = {
    parentId: partner.id,
    slot: primaryLog.slot === 'followup' ? 'followup' : part.slot,
    callDate: primaryLog.callDate,
    attemptNumber: primaryLog.attemptNumber,
    createdAt: opts.now,
    scheduledTime: primaryLog.scheduledTime,
    status: opts.status,
    durationSeconds: answered ? opts.duration : 0,
    actualAnswerTime: answered ? formatIstClock(opts.now) : null,
    medicationConfirmed: answered && interp.medicationConfirmed,
    mood: answered ? interp.mood : 'neutral',
    summary: opts.summary || (answered ? interp.summary : `${partner.name} was not reached (shared call).`),
    notes: answered ? interp.feedback : null,
    processedAt: opts.now,
    endedAt: opts.now,
    pairedCallLogId: primaryLog.id,
    resultJson: JSON.stringify({
      medicines: part.medicines,
      callType: 'couple',
      medicineResults: answered ? interp.medicineResults : [],
      healthConcern: answered ? interp.healthConcern : null,
      emergencyFlag: answered && interp.emergencyFlag,
      bp: interp.bp,
      sugar: interp.sugar
    })
  };
  let partnerLog;
  try {
    partnerLog = await prisma.callLog.create({ data: { id: newId('call'), ...data, slotId: primaryLog.slot === 'followup' ? null : part.slotId } });
  } catch (err) {
    // The partner already has a log for that slot today (e.g. called separately earlier): keep this one unslotted.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    partnerLog = await prisma.callLog.create({ data: { id: newId('call'), ...data, slotId: null } });
  }
  await prisma.callLog.update({ where: { id: primaryLog.id }, data: { pairedCallLogId: partnerLog.id } });
  if (!answered) return;

  await saveFromCall(partner.id, partnerLog.id, interp, opts.now, 'partner');
  const recorded: RecordAlertResult[] = [];
  for (const decision of decideAlerts({ ...interp, consent: 'not_asked' }, partner.name, part.slot || 'check-in', {
    callType: primaryLog.slot === 'followup' ? 'followup' : 'reminder',
    ranges: parseRanges(partner.readingRanges),
    skipScan: true
  })) {
    recorded.push(await recordAlert({ parentId: partner.id, callLogId: partnerLog.id, ...decision }));
  }
  await notifyThenEscalate(
    partner.id,
    () => notifyFamily(
      {
        parentId: partner.id,
        callLogId: partnerLog.id,
        alerts: recorded.flatMap(r => (r.alert ? [r.alert] : [])),
        update: describeAnsweredCall({
          slotLabel: `${part.slot || 'check-in'} (shared call)`,
          answeredAt: formatIstClock(opts.now),
          medicineResults: interp.medicineResults,
          mood: interp.mood,
          feedback: interp.feedback,
          extra: extraFacts(interp)
        })
      },
      opts.deps
    ),
    recorded,
    interp.healthConcern || interp.summary,
    opts.deps
  );
  try {
    await runInsightsForParent(partner.id, { now: opts.now, deps: opts.deps });
  } catch (err) {
    console.error('[calls] Insight check failed:', err);
  }
}

async function applyAnsweredCall(
  log: CallLogRow,
  parent: ParentRow,
  payload: SarvamWebhookPayload,
  interp: ReturnType<typeof interpretCallResult>,
  snapshot: CallSnapshot,
  opts: { now: Date; deps: AlertDeps; duration: number; interactionId: string | null }
): Promise<WebhookOutcome> {
  const { now, deps } = opts;
  const callType = snapshot.callType || (log.slot === 'callback' ? 'callback' : 'reminder');
  const slotLabel = callType === 'companion' ? 'weekly chat' : callType === 'followup' ? 'follow-up' : log.slot || 'check-in';
  const asked = snapshot.asked;
  const partnerInterp = snapshot.partner
    ? interpretCallResult(partnerPayload(payload), snapshot.partner.medicines, snapshot.partner.name)
    : null;

  // One follow-up about "later" medicines, a couple of times a day at most.
  let followUpAt: Date | null = null;
  const hasLater = interp.medicineResults.some(r => r.status === 'later') || !!partnerInterp?.medicineResults.some(r => r.status === 'later');
  const parentStopping = interp.stopCalls || (asked?.askConsent && interp.consent === 'no');
  if (hasLater && callType !== 'followup' && !parentStopping && !parent.isPaused) {
    const today = istDateString(now);
    const [placed, pending] = await Promise.all([
      prisma.callLog.count({ where: { parentId: parent.id, slot: 'followup', callDate: today } }),
      prisma.callLog.count({ where: { parentId: parent.id, callDate: today, followUpAt: { not: null } } })
    ]);
    // Never past 10 PM IST.
    const at = new Date(now.getTime() + FOLLOW_UP_DELAY_MINUTES * 60000);
    if (placed + pending < maxFollowUpsPerDay() && istMinutesOfDay(at) <= 22 * 60 && istDateString(at) === today) followUpAt = at;
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
        stopCalls: interp.stopCalls,
        bp: interp.bp,
        sugar: interp.sugar,
        appointmentUpdate: interp.appointmentUpdate,
        helperVisited: interp.helperVisited,
        ...(partnerInterp ? { partnerMedicineResults: partnerInterp.medicineResults } : {})
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
  if (asked?.askWellbeing || asked?.wellbeingTopic) parentData.lastWellbeingAt = now;
  if (asked?.refillMedicines?.length) parentData.lastRefillCheckAt = now;
  if (callType === 'companion') parentData.lastCompanionAt = now;
  if (asked?.weatherNote) parentData.lastWeatherNoteAt = now;
  if (Object.keys(parentData).length) await prisma.parentProfile.update({ where: { id: parent.id }, data: parentData });

  await saveFromCall(parent.id, log.id, interp, now, 'self');
  await markFamilyAsksDone(log.id, asked, interp, now);

  const recorded: RecordAlertResult[] = [];
  for (const decision of decideAlerts(asked?.askConsent ? interp : { ...interp, consent: 'not_asked' }, parent.name, slotLabel, {
    callType,
    finalCall: snapshot.finalCall === true,
    ranges: parseRanges(parent.readingRanges),
    helperName: asked?.helperQuestion ? asked.helperName ?? parent.helperName : null
  })) {
    recorded.push(await recordAlert({ parentId: parent.id, callLogId: log.id, ...decision }));
  }
  // One message to the family about the whole call; level 4 then phones the people who can act (even if the message failed).
  await notifyThenEscalate(
    parent.id,
    () => notifyFamily(
      {
        parentId: parent.id,
        callLogId: log.id,
        alerts: recorded.flatMap(r => (r.alert ? [r.alert] : [])),
        update: describeAnsweredCall({
          slotLabel,
          answeredAt: formatIstClock(now),
          medicineResults: interp.medicineResults,
          mood: interp.mood,
          feedback: interp.feedback,
          extra: extraFacts(interp)
        })
      },
      deps
    ),
    recorded,
    interp.healthConcern || interp.summary,
    deps
  );

  if (snapshot.partner && partnerInterp) {
    await applyPartner(log, snapshot.partner, partnerInterp, { now, deps, duration: opts.duration, status: 'answered' });
  }

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

/**
 * The result is claimed (processedAt) before it is applied so two deliveries never apply it twice. If applying it
 * then fails halfway (database error, timeout), the claim is released before the error goes up: Sarvam's retry
 * must be able to run the alert steps again, otherwise a real emergency call would be marked "done" with no alert.
 * Everything the retry repeats is idempotent (alerts are unique per call and title, one message per call).
 */
export async function processSarvamWebhook(
  payload: SarvamWebhookPayload,
  opts: { now?: Date; deps?: AlertDeps } = {}
): Promise<WebhookOutcome> {
  const claim: { logId: string | null } = { logId: null };
  try {
    return await processSarvamWebhookInner(payload, opts, claim);
  } catch (err) {
    if (claim.logId) {
      try {
        await prisma.callLog.updateMany({ where: { id: claim.logId }, data: { processedAt: null } });
      } catch (releaseErr) {
        console.error('[calls] Could not release the result claim after a failure:', releaseErr);
      }
    }
    throw err;
  }
}

async function processSarvamWebhookInner(
  payload: SarvamWebhookPayload,
  opts: { now?: Date; deps?: AlertDeps },
  claim: { logId: string | null }
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
  claim.logId = log.id;

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
    return applyAnsweredCall(log, parent, payload, connectedInterp, snapshot, { now, deps, duration, interactionId });
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
    if (snapshot.partner) {
      await applyPartner(log, snapshot.partner, interpretCallResult({}, snapshot.partner.medicines, snapshot.partner.name), {
        now, deps, duration: 0, status: 'failed', summary: `The shared call could not be placed${failureReason ? ` (${failureReason})` : ''}.`
      });
    }
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

  if (snapshot.partner) {
    await applyPartner(log, snapshot.partner, interpretCallResult({}, snapshot.partner.medicines, snapshot.partner.name), {
      now, deps, duration: 0, status: finalStatus,
      summary: `${snapshot.partner.name} did not pick up the shared ${slotLabel} call.${retryAt ? ' We will try again shortly.' : ''}`
    });
  }

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
  // Recorded, then the family told and the ladder started; the ladder starts even if the message fails, and an alert
  // that was recorded but never delivered (an earlier failed attempt) is delivered now.
  const rec = await recordAlert({
    parentId: parent.id,
    callLogId: log.id,
    level: 4,
    title: ALERT_TITLES.emergency,
    message: `During a check-in call, ${parent.name} may have described an emergency${cleanReason ? `: "${cleanReason}"` : ''}. Please call ${parent.name} right away. If it is serious, call 112 or ask someone nearby to go to them.`
  });
  if (rec.alert) {
    const alert = rec.alert;
    await notifyThenEscalate(
      parent.id,
      () => notifyFamily({ parentId: parent.id, callLogId: log.id, alerts: [alert] }, deps),
      [rec],
      cleanReason || 'They may have described an emergency on the call.',
      deps
    );
  }
  return { status: rec.created ? 'raised' : 'already_raised' };
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
      wellbeingTopic: null,
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
  return applyAnsweredCall(log, parent, payload, interp, { ...snapshot, callType: 'callback' }, {
    now,
    deps: opts.deps || {},
    duration,
    interactionId
  });
}

export { parseTranscript };
