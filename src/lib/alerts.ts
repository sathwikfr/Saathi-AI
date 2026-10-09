/**
 * Alert engine: records AlertRecords. Telling the family is familyNotify.ts
 * (WhatsApp, one message per call; email only as described there).
 *
 * `recordAlert` only writes the alert (callers that raise several alerts for
 * one call notify once afterwards); `raiseAlert` records and notifies.
 */
import { prisma } from './prisma';
import { newId } from './db';
import { ALERT_TITLES } from './callInterpretation';
import { NotifyAlert } from './familyMessages';
import { notifyFamily, NotifyDeps, NotifyResult } from './familyNotify';
import { startEscalation, EscalationDeps } from './escalation';
import { NON_RETRY_SLOTS } from './callPlanning';

/** Injectable dependencies (tests replace the email sender and WhatsApp). */
export type AlertDeps = NotifyDeps & EscalationDeps;

export interface RaiseAlertInput {
  parentId: string;
  callLogId?: string | null;
  level: 1 | 2 | 3 | 4;
  title: string;
  message: string;
}

export interface RecordAlertResult {
  created: boolean;
  alertId?: string;
  /** Set when the alert still has to reach the family: newly created, or recorded earlier but never delivered. */
  alert?: NotifyAlert;
}

export interface RaiseAlertResult extends RecordAlertResult {
  notified?: NotifyResult;
}

/**
 * Creates the alert once per (call, title). An alert that already exists but was never delivered (channel still
 * 'dashboard': the attempt that recorded it failed before telling anyone) is handed back again, so a retry tells the
 * family and starts the ladder instead of stopping at "already recorded". Repeating is safe: family messages are unique
 * per call and number, escalations unique per alert.
 */
export async function recordAlert(input: RaiseAlertInput): Promise<RecordAlertResult> {
  if (input.callLogId) {
    const existing = await prisma.alertRecord.findFirst({ where: { callLogId: input.callLogId, title: input.title } });
    if (existing) {
      return {
        created: false,
        alertId: existing.id,
        ...(existing.channel === 'dashboard'
          ? { alert: { id: existing.id, level: existing.level, title: existing.title, message: existing.message } }
          : {})
      };
    }
  }

  const parent = await prisma.parentProfile.findUnique({ where: { id: input.parentId }, select: { id: true } });
  if (!parent) return { created: false };

  const alert = await prisma.alertRecord.create({
    data: {
      id: newId('alt'),
      parentId: parent.id,
      callLogId: input.callLogId || null,
      level: input.level,
      title: input.title,
      message: input.message,
      channel: 'dashboard', // updated to whatsapp / email once delivered
      timestamp: new Date().toISOString(),
      status: 'sent'
    }
  });
  return {
    created: true,
    alertId: alert.id,
    alert: { id: alert.id, level: alert.level, title: alert.title, message: alert.message }
  };
}

/** Records one alert and notifies the family about it straight away. */
export async function raiseAlert(input: RaiseAlertInput, deps: AlertDeps = {}): Promise<RaiseAlertResult> {
  const rec = await recordAlert(input);
  if (!rec.alert) return rec;
  const notified = await notifyFamily(
    { parentId: input.parentId, callLogId: input.callLogId || null, alerts: [rec.alert] },
    deps
  );
  return { ...rec, notified };
}

/** Level-2 alert once every attempt to reach the parent has failed (level 3, plus a wellness check, if they live alone). */
export async function raiseUnreachableAlert(
  callLog: { id: string; parentId: string; attemptNumber: number; slot: string | null },
  parentName: string,
  reason: 'no_answer' | 'busy' | 'failed',
  failureReason?: string | null,
  deps: AlertDeps = {}
): Promise<RaiseAlertResult> {
  const slotText = callLog.slot ? `${callLog.slot} ` : '';
  if (reason === 'failed') {
    return raiseAlert(
      {
        parentId: callLog.parentId,
        callLogId: callLog.id,
        level: 2,
        title: ALERT_TITLES.failed,
        message: `The ${slotText}check-in call to ${parentName} could not be placed${failureReason ? ` (${failureReason})` : ''}. Please check that their phone number is correct and reachable.`
      },
      deps
    );
  }
  const parent = await prisma.parentProfile.findUnique({ where: { id: callLog.parentId }, select: { livesAlone: true } });
  // Only a missed daily call means "nobody has heard from them today"; a missed test call doesn't.
  const livesAlone = !!parent?.livesAlone && !NON_RETRY_SLOTS.includes(callLog.slot || '');
  const tried = `We tried ${callLog.attemptNumber} time${callLog.attemptNumber === 1 ? '' : 's'} today but could not reach ${parentName} for the ${slotText}check-in call (${reason === 'busy' ? 'line busy' : 'no answer'}).`;
  const res = await raiseAlert(
    {
      parentId: callLog.parentId,
      callLogId: callLog.id,
      level: livesAlone ? 3 : 2,
      title: ALERT_TITLES.unreachable,
      message: livesAlone
        ? `${tried} ${parentName} lives alone, so we are asking their local contact to check on them. Please call them too.`
        : `${tried} Please call them when you can.`
    },
    deps
  );
  // "Are you OK?" check: a parent who lives alone and can't be reached gets a visit from someone nearby.
  if (livesAlone && res.alertId && res.alert) {
    await startEscalation(
      {
        parentId: callLog.parentId,
        alertId: res.alertId,
        kind: 'wellness_check',
        reason: `${parentName} lives alone and has not answered their check-in calls today.`
      },
      deps
    ).catch(err => console.error('[alerts] Wellness check could not start:', err));
  }
  return res;
}

/**
 * Tells the family about the alerts, then starts the ladder for the level-4 ones, even when telling the family
 * failed: the phone calls must not depend on WhatsApp working. A notify error is re-thrown afterwards so the
 * caller's retry (Sarvam / Meta) still re-runs it.
 */
export async function notifyThenEscalate(
  parentId: string,
  notify: () => Promise<unknown>,
  recorded: RecordAlertResult[],
  reason: string,
  deps: AlertDeps = {}
): Promise<void> {
  let notifyError: unknown = null;
  try {
    await notify();
  } catch (err) {
    notifyError = err;
  }
  await escalateEmergencies(parentId, recorded, reason, deps);
  if (notifyError) throw notifyError;
}

/** Starts the escalation ladder for every level-4 alert that still has to reach the family. */
export async function escalateEmergencies(parentId: string, created: RecordAlertResult[], reason: string, deps: AlertDeps = {}) {
  for (const r of created) {
    if (!r.alert || r.alert.level < 4) continue;
    await startEscalation({ parentId, alertId: r.alert.id, kind: 'emergency', reason }, deps).catch(err =>
      console.error('[alerts] Escalation could not start:', err)
    );
  }
}
