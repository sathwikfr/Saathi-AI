/**
 * Call dispatcher: decides which Saathi calls are due and places them through
 * Sarvam. Driven by an external cron hitting /api/cron/dispatch every ~5 minutes.
 *
 * Guarantees:
 *  - A call is only placed after its CallLog row is created; a unique index on
 *    (parent, slot, IST date, attempt) makes double-dialling impossible, even
 *    with overlapping cron runs.
 *  - Nothing happens (and nothing is logged) when Sarvam isn't configured.
 *  - Each plan's calls-per-day cap applies, controlling call cost.
 *  - A parent who said no (or "stop calling me") is never called until the
 *    family resumes calls, and then Saathi asks again first.
 *
 * Besides the scheduled slots it places: retries, one follow-up about medicines
 * the parent said they'd take "later", and the weekly companion call.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { newId } from './db';
import { getEffectivePlan } from './plans';
import { normalizePhone } from './phone';
import { generateMedicineCheckinQuestion } from './scheduleGenerator';
import { istDateString, istMinutesOfDay, isSlotDue, parseClockTime } from './ist';
import {
  SarvamConfig, getSarvamConfig, createOutboundCall, SarvamApiError, OutboundCallInput, CallType, isProviderAccountProblem, logProviderProblem
} from './sarvam';
import { LinkedMedicineDetail, PlanId } from './types';
import { MAX_CALL_ATTEMPTS, RETRY_DELAY_MINUTES, RESULT_NOT_RECEIVED } from './callResults';
import { raiseUnreachableAlert, AlertDeps } from './alerts';
import { CallExtras, NO_EXTRAS, CallSnapshot, planCallExtras, readSnapshot, NON_RETRY_SLOTS } from './callPlanning';
import { parentRoleFor, roleAllows } from './familyAccess';

/** A slot stays "due" for this long after its scheduled time (covers cron gaps and outages). */
export const DUE_WINDOW_MINUTES = 90;
/** A call with no end-of-call result after this long is closed as "result not received". */
export const STALE_PLACED_MINUTES = 45;
/** Slot ids for calls that aren't one of the parent's ScheduledCallSlots (kept unique per day by the same index). */
export const COMPANION_SLOT_ID = 'companion';

export interface DispatchDeps {
  now?: Date;
  fetchImpl?: typeof fetch;
  config?: SarvamConfig | null;
  alertDeps?: AlertDeps;
  /** Restrict the run to these parents (used by tests so they never touch real data). */
  parentIds?: string[];
}

export interface DispatchSummary {
  configured: boolean;
  parentsChecked: number;
  placed: number;
  retried: number;
  followUps: number;
  companion: number;
  failedToPlace: number;
  alreadyCalled: number;
  cappedByPlan: number;
  staleClosed: number;
  autoResumed: number;
  errors: string[];
}

function emptySummary(configured: boolean): DispatchSummary {
  return {
    configured, parentsChecked: 0, placed: 0, retried: 0, followUps: 0, companion: 0, failedToPlace: 0,
    alreadyCalled: 0, cappedByPlan: 0, staleClosed: 0, autoResumed: 0, errors: []
  };
}

interface SlotRow {
  id: string;
  slot: string;
  time: string;
  label: string;
  linkedMedicineNames: string[];
  linkedMedicinesJson: string | null;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Medicines Saathi should ask about on this slot (skips ones the family has since paused),
 * with the family's current "why" for each.
 */
export function slotMedicines(slot: SlotRow, inactiveNames: Set<string>, purposes: Map<string, string> = new Map()): LinkedMedicineDetail[] {
  let linked: LinkedMedicineDetail[] = [];
  if (slot.linkedMedicinesJson) {
    try {
      const parsed = JSON.parse(slot.linkedMedicinesJson);
      if (Array.isArray(parsed)) linked = parsed;
    } catch {
      linked = [];
    }
  }
  if (linked.length === 0) {
    linked = (slot.linkedMedicineNames || []).map(name => ({
      name,
      foodRelation: 'not_specified' as const,
      questionScript: generateMedicineCheckinQuestion(name, 'not_specified', slot.slot)
    }));
  }
  return linked
    .filter(m => !inactiveNames.has(m.name))
    .map(m => (purposes.get(m.name) ? { ...m, purpose: purposes.get(m.name) } : m));
}

type MedicineRow = { name: string; isActive: boolean; purpose: string | null };

function medicineMaps(medicines: MedicineRow[]) {
  const inactiveNames = new Set(medicines.filter(m => !m.isActive).map(m => m.name));
  const purposes = new Map(medicines.filter(m => m.isActive && m.purpose?.trim()).map(m => [m.name, m.purpose!.trim()]));
  const activeNames = medicines.filter(m => m.isActive).map(m => m.name);
  return { inactiveNames, purposes, activeNames };
}

interface ParentForCall {
  id: string;
  name: string;
  phone: string;
  language: string;
  relationship: string;
  parentConsent: string | null;
  lastSafetyLineAt: Date | null;
  lastWellbeingAt: Date | null;
  lastRefillCheckAt: Date | null;
  birthDate: string | null;
  companionTopics?: string | null;
  user: { name: string };
}

interface ClaimData {
  parentId: string;
  slotId: string | null;
  slot: string;
  callDate: string;
  attemptNumber: number;
  snapshot: CallSnapshot;
  now: Date;
}

/** Creates the CallLog that reserves this attempt; null when another run already holds it. */
async function claimAttempt(data: ClaimData) {
  // Cheap check first so the routine "already called today" case doesn't hit the
  // unique index (and log a database error) on every cron run. The index stays
  // as the backstop against two runs racing each other.
  if (data.slotId) {
    const existing = await prisma.callLog.findFirst({
      where: { parentId: data.parentId, slotId: data.slotId, callDate: data.callDate, attemptNumber: data.attemptNumber },
      select: { id: true }
    });
    if (existing) return null;
  }
  try {
    return await prisma.callLog.create({
      data: {
        id: newId('call'),
        parentId: data.parentId,
        slotId: data.slotId,
        slot: data.slot,
        callDate: data.callDate,
        attemptNumber: data.attemptNumber,
        // The dispatcher's clock (same as the database's in production; tests run on a fake clock).
        createdAt: data.now,
        scheduledTime: data.now.toISOString(),
        status: 'scheduled',
        durationSeconds: 0,
        medicationConfirmed: false,
        mood: 'neutral',
        summary: 'Call is being placed.',
        // Snapshot of what Saathi is asked to check, so the result can be matched later.
        resultJson: JSON.stringify(data.snapshot)
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

/** 'provider_account' = our own Sarvam account can't place calls (bad key, no access, out of credits). */
type PlaceOutcome = 'placed' | 'failed' | 'provider_account';

function supportPhone(): string | null {
  return process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim() || null;
}

async function placeClaimedCall(
  cfg: SarvamConfig,
  log: { id: string; parentId: string; slotId: string | null; slot: string | null; attemptNumber: number },
  parent: ParentForCall,
  slotLabel: string,
  snapshot: CallSnapshot,
  deps: DispatchDeps,
  now: Date,
  summary: DispatchSummary
): Promise<PlaceOutcome> {
  const extras: CallExtras = snapshot.asked || NO_EXTRAS;
  const input: OutboundCallInput = {
    callLogId: log.id,
    parentId: parent.id,
    slotId: log.slotId,
    slot: log.slot || 'check-in',
    slotLabel,
    parentName: parent.name,
    parentPhone: parent.phone,
    language: parent.language,
    caregiverName: parent.user.name,
    relationship: parent.relationship,
    medicines: snapshot.medicines,
    callType: snapshot.callType || 'reminder',
    askConsent: extras.askConsent,
    saySafetyLine: extras.saySafetyLine,
    lastCallNote: extras.lastCallNote,
    askWellbeing: extras.askWellbeing,
    refillMedicines: extras.refillMedicines,
    specialDay: extras.specialDay,
    companionTopics: snapshot.callType === 'companion' ? parent.companionTopics || null : null,
    supportPhone: supportPhone()
  };

  try {
    const { attemptId } = await createOutboundCall(cfg, input, deps.fetchImpl);
    await prisma.callLog.update({
      where: { id: log.id },
      data: { status: 'placed', providerAttemptId: attemptId, startedAt: now, summary: 'Call placed. Waiting for the result.' }
    });
    return 'placed';
  } catch (err) {
    const httpStatus = err instanceof SarvamApiError ? err.status : undefined;
    const message = err instanceof Error ? err.message : 'unknown error';
    const configProblem = isProviderAccountProblem(httpStatus);
    if (configProblem) logProviderProblem(httpStatus);
    const retryable = !configProblem && (httpStatus === undefined || httpStatus >= 500 || httpStatus === 429);
    const scheduled = !!log.slotId && !NON_RETRY_SLOTS.includes(log.slot || '');
    const canRetry = retryable && scheduled && log.attemptNumber < MAX_CALL_ATTEMPTS;
    const retryAt = canRetry ? new Date(now.getTime() + RETRY_DELAY_MINUTES * 60000) : null;

    await prisma.callLog.update({
      where: { id: log.id },
      data: {
        status: 'failed',
        failureReason: `api_error: ${message}`.slice(0, 300),
        processedAt: now,
        endedAt: now,
        nextRetryAt: retryAt,
        summary: retryAt ? 'The call could not be placed. We will retry shortly.' : 'The call could not be placed.'
      }
    });
    summary.failedToPlace += 1;
    summary.errors.push(`${parent.id}: ${message}`);

    // Only scheduled calls alert the family; a failed test call is just reported back to the user.
    if (!retryAt && !configProblem && scheduled) {
      await raiseUnreachableAlert(
        { id: log.id, parentId: parent.id, attemptNumber: log.attemptNumber, slot: log.slot },
        parent.name,
        'failed',
        'the calling service was unavailable',
        deps.alertDeps
      );
    }
    return configProblem ? 'provider_account' : 'failed';
  }
}

/**
 * The data planCallExtras needs about a parent's recent calls. "The last call" for the
 * remember-the-last-call note is the latest answered call that mentioned a concern, as long
 * as no call since then has already asked about it (a short follow-up call in between
 * doesn't make Saathi forget the morning's knee pain).
 */
async function recentCallFacts(parentId: string, today: string, now: Date) {
  const [recent, answeredToday] = await Promise.all([
    prisma.callLog.findMany({
      where: { parentId, status: 'answered', createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { createdAt: true, resultJson: true }
    }),
    prisma.callLog.count({ where: { parentId, status: 'answered', callDate: today } })
  ]);
  let lastAnswered = null;
  for (const call of recent) {
    let r: Record<string, unknown> = {};
    try {
      r = JSON.parse(call.resultJson || '{}');
    } catch {
      r = {};
    }
    const concern = typeof r.healthConcern === 'string' ? r.healthConcern : null;
    const pain = typeof r.pain === 'string' ? r.pain : null;
    if (concern || pain === 'mild' || pain === 'severe') {
      lastAnswered = { createdAt: call.createdAt, healthConcern: concern, pain, painWhere: typeof r.painWhere === 'string' ? r.painWhere : null };
      break;
    }
    // A later call already followed up on a concern and heard nothing new: nothing to remember.
    const asked = r.asked as { lastCallNote?: string | null } | undefined;
    if (asked?.lastCallNote) break;
  }
  return { lastAnswered, answeredToday: answeredToday > 0 };
}

async function extrasFor(parent: ParentForCall, callType: CallType, activeNames: string[], now: Date): Promise<CallExtras> {
  const facts = await recentCallFacts(parent.id, istDateString(now), now);
  return planCallExtras({
    callType,
    rhythm: {
      parentConsent: parent.parentConsent,
      lastSafetyLineAt: parent.lastSafetyLineAt,
      lastWellbeingAt: parent.lastWellbeingAt,
      lastRefillCheckAt: parent.lastRefillCheckAt,
      birthDate: parent.birthDate
    },
    lastAnswered: facts.lastAnswered,
    activeMedicineNames: activeNames,
    answeredToday: facts.answeredToday,
    now
  });
}

/** Parents who said no, or asked Saathi to stop, are not called until the family resumes calls. */
export function consentBlocksCalls(parentConsent: string | null | undefined): boolean {
  return parentConsent === 'declined' || parentConsent === 'withdrawn';
}

/** IST weekday, 0 = Sunday. */
function istWeekday(now: Date): number {
  return new Date(now.getTime() + 5.5 * 3600000).getUTCDay();
}

/** Places every call that is due right now, plus retries, follow-ups and companion calls. */
export async function runDispatch(deps: DispatchDeps = {}): Promise<DispatchSummary> {
  const now = deps.now || new Date();
  const cfg = deps.config !== undefined ? deps.config : getSarvamConfig();
  const summary = emptySummary(!!cfg);
  if (!cfg) return summary;

  const today = istDateString(now);

  // 1. Close calls whose result never arrived.
  const scope = deps.parentIds ? { in: deps.parentIds } : undefined;
  const stale = await prisma.callLog.updateMany({
    where: {
      ...(scope ? { parentId: scope } : {}),
      status: 'placed',
      processedAt: null,
      startedAt: { lt: new Date(now.getTime() - STALE_PLACED_MINUTES * 60000) }
    },
    data: {
      status: 'failed',
      failureReason: RESULT_NOT_RECEIVED,
      processedAt: now,
      endedAt: now,
      summary: 'No result was received from the calling service for this call.'
    }
  });
  summary.staleClosed = stale.count;

  // 2. Scheduled slots that are due (and the weekly companion call).
  const parents = await prisma.parentProfile.findMany({
    where: { isDeleted: false, consentGiven: true, ...(scope ? { id: scope } : {}) },
    include: {
      callSchedule: { where: { isActive: true } },
      medicines: true,
      user: { include: { subscription: true } }
    }
  });

  for (const parent of parents) {
    summary.parentsChecked += 1;
    try {
      if (parent.isPaused) {
        // A pause the parent asked for ("no" / "stop calling me") never ends by itself.
        if (parent.pauseUntil && parent.pauseUntil.getTime() <= now.getTime() && !consentBlocksCalls(parent.parentConsent)) {
          await prisma.parentProfile.update({
            where: { id: parent.id },
            data: { isPaused: false, pauseReason: null, pauseUntil: null }
          });
          summary.autoResumed += 1;
        } else {
          continue;
        }
      }
      if (consentBlocksCalls(parent.parentConsent)) continue;

      const phone = normalizePhone(parent.phone);
      if (!phone.ok) continue;

      const sub = parent.user.subscription;
      const plan = getEffectivePlan(
        sub ? { planId: sub.planId as PlanId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString() } : null,
        parent.user.createdAt,
        now
      );
      if (plan.expired) continue; // free trial over: no calls until a plan is chosen

      const slots = [...parent.callSchedule]
        .filter(s => parseClockTime(s.time) !== null)
        .sort((a, b) => (parseClockTime(a.time) as number) - (parseClockTime(b.time) as number));
      if (slots.length > plan.callsPerDay) summary.cappedByPlan += slots.length - plan.callsPerDay;

      const { inactiveNames, purposes, activeNames } = medicineMaps(parent.medicines);
      const createdToday = istDateString(parent.createdAt) === today;
      const createdMinutes = istMinutesOfDay(parent.createdAt);
      const forCall: ParentForCall = { ...parent, phone: phone.e164 };
      // Extras (wellbeing, refill, …) go on the first call placed in this run only.
      let extrasUsed = false;

      for (const slot of slots.slice(0, plan.callsPerDay)) {
        if (!isSlotDue(slot.time, now, DUE_WINDOW_MINUTES)) continue;
        // A newly added parent is first called the next day, not about a slot that already passed.
        if (createdToday && (parseClockTime(slot.time) as number) <= createdMinutes) continue;

        const medicines = slotMedicines(slot, inactiveNames, purposes);
        const extras = extrasUsed
          ? { ...NO_EXTRAS, askConsent: forCall.parentConsent !== 'given' }
          : await extrasFor(forCall, 'reminder', activeNames, now);
        const snapshot: CallSnapshot = { medicines, callType: 'reminder', asked: extras };
        const log = await claimAttempt({
          parentId: parent.id,
          slotId: slot.id,
          slot: slot.slot,
          callDate: today,
          attemptNumber: 1,
          snapshot,
          now
        });
        if (!log) {
          summary.alreadyCalled += 1;
          continue;
        }
        extrasUsed = true;
        const outcome = await placeClaimedCall(cfg, log, forCall, slot.label, snapshot, deps, now, summary);
        if (outcome === 'placed') summary.placed += 1;
      }

      // Weekly companion call: opted in, paid plan (trial included), its day and time.
      if (
        parent.companionEnabled &&
        plan.id !== 'free' &&
        parent.companionDay === istWeekday(now) &&
        parent.companionTime &&
        isSlotDue(parent.companionTime, now, DUE_WINDOW_MINUTES) &&
        !(createdToday && (parseClockTime(parent.companionTime) ?? 0) <= createdMinutes)
      ) {
        const extras = extrasUsed
          ? { ...NO_EXTRAS, askConsent: forCall.parentConsent !== 'given' }
          : await extrasFor(forCall, 'companion', activeNames, now);
        const snapshot: CallSnapshot = { medicines: [], callType: 'companion', asked: extras };
        const log = await claimAttempt({
          parentId: parent.id,
          slotId: COMPANION_SLOT_ID,
          slot: 'companion',
          callDate: today,
          attemptNumber: 1,
          snapshot,
          now
        });
        if (log) {
          const outcome = await placeClaimedCall(cfg, log, forCall, 'Weekly chat', snapshot, deps, now, summary);
          if (outcome === 'placed') summary.companion += 1;
        }
      }
    } catch (err) {
      summary.errors.push(`${parent.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Retries for unanswered / busy / temporarily failed calls (same IST day, scheduled slots only).
  const retries = await prisma.callLog.findMany({
    where: {
      ...(scope ? { parentId: scope } : {}),
      nextRetryAt: { lte: now },
      callDate: today,
      attemptNumber: { lt: MAX_CALL_ATTEMPTS },
      slotId: { not: null },
      NOT: { slot: { in: NON_RETRY_SLOTS } }
    },
    orderBy: { nextRetryAt: 'asc' },
    take: 100
  });

  for (const prev of retries) {
    try {
      // Claim the retry so overlapping runs cannot both pick it up.
      const claimedRetry = await prisma.callLog.updateMany({
        where: { id: prev.id, nextRetryAt: { not: null } },
        data: { nextRetryAt: null }
      });
      if (claimedRetry.count !== 1) continue;

      const parent = await prisma.parentProfile.findUnique({
        where: { id: prev.parentId },
        include: { callSchedule: true, medicines: true, user: true }
      });
      if (!parent || parent.isDeleted || parent.isPaused || consentBlocksCalls(parent.parentConsent)) continue;
      const phone = normalizePhone(parent.phone);
      if (!phone.ok) continue;

      const slot = parent.callSchedule.find(s => s.id === prev.slotId && s.isActive);
      const { inactiveNames, purposes, activeNames } = medicineMaps(parent.medicines);
      const medicines = slot ? slotMedicines(slot, inactiveNames, purposes) : [];
      const forCall: ParentForCall = { ...parent, phone: phone.e164 };
      const snapshot: CallSnapshot = { medicines, callType: 'reminder', asked: await extrasFor(forCall, 'reminder', activeNames, now) };

      const log = await claimAttempt({
        parentId: parent.id,
        slotId: prev.slotId,
        slot: prev.slot || 'check-in',
        callDate: today,
        attemptNumber: prev.attemptNumber + 1,
        snapshot,
        now
      });
      if (!log) continue;

      const outcome = await placeClaimedCall(cfg, log, forCall, slot?.label || prev.slot || 'check-in', snapshot, deps, now, summary);
      if (outcome === 'placed') summary.retried += 1;
    } catch (err) {
      summary.errors.push(`retry ${prev.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Follow-ups: the parent said "later" / "not yet" about some medicines.
  const followUps = await prisma.callLog.findMany({
    where: { ...(scope ? { parentId: scope } : {}), followUpAt: { lte: now }, callDate: today },
    orderBy: { followUpAt: 'asc' },
    take: 100
  });

  for (const prev of followUps) {
    try {
      const claimed = await prisma.callLog.updateMany({
        where: { id: prev.id, followUpAt: { not: null } },
        data: { followUpAt: null }
      });
      if (claimed.count !== 1) continue;

      const parent = await prisma.parentProfile.findUnique({ where: { id: prev.parentId }, include: { user: true } });
      if (!parent || parent.isDeleted || parent.isPaused || consentBlocksCalls(parent.parentConsent)) continue;
      const phone = normalizePhone(parent.phone);
      if (!phone.ok) continue;

      const original = readSnapshot(prev.resultJson);
      let laterNames: string[] = [];
      try {
        const results = JSON.parse(prev.resultJson || '{}')?.medicineResults;
        if (Array.isArray(results)) laterNames = results.filter((r: { status?: string }) => r.status === 'later').map((r: { name: string }) => r.name);
      } catch {
        laterNames = [];
      }
      const medicines = original.medicines.filter(m => laterNames.includes(m.name));
      if (medicines.length === 0) continue;

      const forCall: ParentForCall = { ...parent, phone: phone.e164 };
      const snapshot: CallSnapshot = {
        medicines,
        callType: 'followup',
        asked: await extrasFor(forCall, 'followup', [], now),
        followUpOf: prev.id
      };
      const log = await claimAttempt({
        parentId: parent.id,
        slotId: null,
        slot: 'followup',
        callDate: today,
        attemptNumber: 1,
        snapshot,
        now
      });
      if (!log) continue;
      const outcome = await placeClaimedCall(cfg, log, forCall, 'Follow-up', snapshot, deps, now, summary);
      if (outcome === 'placed') summary.followUps += 1;
    } catch (err) {
      summary.errors.push(`follow-up ${prev.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summary;
}

export type ManualCallResult =
  | { ok: true; callLogId: string; attemptId: string }
  | { ok: false; status: number; code: string; error: string };

const MAX_MANUAL_PER_HOUR = 2;
const MAX_MANUAL_PER_DAY = 5;

/**
 * A call requested by the parent's family ("test call" / "call now"). Never
 * retried, and rate-limited because every call costs money.
 * `requesterId` must already have manage access to the parent (owner or co-manager).
 */
export async function placeManualCall(
  input: { parentId: string; requesterId: string; kind: 'test' | 'manual'; slotType?: string },
  deps: DispatchDeps = {}
): Promise<ManualCallResult> {
  const cfg = deps.config !== undefined ? deps.config : getSarvamConfig();
  if (!cfg) {
    return {
      ok: false,
      status: 503,
      code: 'CALLING_NOT_CONNECTED',
      error: 'Saathi voice calling is being connected. No call was placed yet — test calls will be enabled as soon as it is live.'
    };
  }
  const now = deps.now || new Date();

  const parent = await prisma.parentProfile.findUnique({
    where: { id: input.parentId },
    include: { callSchedule: { where: { isActive: true } }, medicines: true, user: { include: { subscription: true } } }
  });
  // Routes check access too; this keeps the rule even for callers that forget (e.g. a WhatsApp button).
  if (!parent || parent.isDeleted || !roleAllows(await parentRoleFor(input.requesterId, parent.id), 'manage')) {
    return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Parent profile not found.' };
  }
  const sub = parent.user.subscription;
  const plan = getEffectivePlan(
    sub ? { planId: sub.planId as PlanId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString() } : null,
    parent.user.createdAt,
    now
  );
  if (plan.expired) {
    return { ok: false, status: 402, code: 'TRIAL_ENDED', error: 'Your free trial has ended. Choose a plan to place calls again.' };
  }
  if (!parent.consentGiven) {
    return { ok: false, status: 409, code: 'NO_CONSENT', error: 'Parent consent is required before calls can be placed.' };
  }
  if (consentBlocksCalls(parent.parentConsent)) {
    return {
      ok: false,
      status: 409,
      code: 'PARENT_SAID_NO',
      error: `${parent.name} asked not to be called. Talk with them first; resuming calls lets Saathi ask them again.`
    };
  }
  if (parent.isPaused) {
    return { ok: false, status: 409, code: 'PAUSED', error: 'Calls are paused for this parent. Resume calls first.' };
  }
  const phone = normalizePhone(parent.phone);
  if (!phone.ok) {
    return { ok: false, status: 422, code: 'BAD_PHONE', error: phone.reason };
  }

  const hourAgo = new Date(now.getTime() - 60 * 60000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60000);
  // Attempts Sarvam refused (no attempt id, the phone never rang) don't use up the limit.
  const manualCalls = {
    parentId: parent.id,
    slot: { in: ['test', 'manual'] },
    NOT: { status: 'failed', providerAttemptId: null }
  };
  const [lastHour, lastDay] = await Promise.all([
    prisma.callLog.count({ where: { ...manualCalls, createdAt: { gte: hourAgo } } }),
    prisma.callLog.count({ where: { ...manualCalls, createdAt: { gte: dayAgo } } })
  ]);
  if (lastHour >= MAX_MANUAL_PER_HOUR || lastDay >= MAX_MANUAL_PER_DAY) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      error: 'Too many test calls to this number recently. Please try again later.'
    };
  }

  const slots = [...parent.callSchedule]
    .filter(s => parseClockTime(s.time) !== null)
    .sort((a, b) => (parseClockTime(a.time) as number) - (parseClockTime(b.time) as number));
  const chosen =
    (input.slotType ? slots.find(s => s.slot === input.slotType) : undefined) ||
    slots.find(s => s.linkedMedicineNames.length > 0) ||
    slots[0];

  const { inactiveNames, purposes, activeNames } = medicineMaps(parent.medicines);
  const medicines = chosen ? slotMedicines(chosen, inactiveNames, purposes) : [];
  const forCall: ParentForCall = { ...parent, phone: phone.e164 };
  const snapshot: CallSnapshot = { medicines, callType: 'reminder', asked: await extrasFor(forCall, 'reminder', activeNames, now) };

  const log = await claimAttempt({
    parentId: parent.id,
    slotId: null,
    slot: input.kind,
    callDate: istDateString(now),
    attemptNumber: 1,
    snapshot,
    now
  });
  if (!log) {
    return { ok: false, status: 409, code: 'DUPLICATE', error: 'A call is already being placed.' };
  }

  const summary = emptySummary(true);
  summary.parentsChecked = 1;
  const outcome = await placeClaimedCall(cfg, log, forCall, chosen?.label || 'check-in', snapshot, deps, now, summary);
  if (outcome === 'provider_account') {
    return {
      ok: false,
      status: 503,
      code: 'CALLING_UNAVAILABLE',
      error: "Saathi can't place calls right now because of a problem on our side. No call was made. Please try again later."
    };
  }
  if (outcome === 'failed') {
    return { ok: false, status: 502, code: 'PLACE_FAILED', error: 'The call could not be placed. Please try again in a few minutes.' };
  }

  const placed = await prisma.callLog.findUnique({ where: { id: log.id } });
  return { ok: true, callLogId: log.id, attemptId: placed?.providerAttemptId || '' };
}
