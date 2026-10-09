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
 *
 * Couple calls: when two parents of one account share a phone and both have said
 * yes, the parent with the smaller id is called and asked about both; the other
 * parent's matching slots (same time of day) are not called separately.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { newId } from './db';
import { getEffectivePlan, reminderChannelFor, healthMonitorAvailable, firmCallLimit } from './plans';
import { ownerHasHealthMonitor, ownerPlanFor } from './planAccess';
import { normalizePhone } from './phone';
import { generateMedicineCheckinQuestion } from './scheduleGenerator';
import { istDateString, istMinutesOfDay, isSlotDue, parseClockTime } from './ist';
import {
  SarvamConfig, getSarvamConfig, createOutboundCall, SarvamApiError, OutboundCallInput, CallType, isProviderAccountProblem, logProviderProblem
} from './sarvam';
import { LinkedMedicineDetail, PlanId } from './types';
import { MAX_CALL_ATTEMPTS, RETRY_DELAY_MINUTES, RESULT_NOT_RECEIVED, maxFollowUpsPerDay } from './callResults';
import { raiseUnreachableAlert, AlertDeps } from './alerts';
import {
  CallExtras, NO_EXTRAS, CallSnapshot, PartnerSnapshot, FamilyAsks, planCallExtras, readSnapshot, NON_RETRY_SLOTS,
  HealthCarry, SlotLoad, healthCarryFor, MIN_SAMPLES_FOR_TYPICAL, HEALTH_BUNDLE_SECONDS, FEELING_SECONDS, CALL_BASE_SECONDS, PER_MEDICINE_SECONDS, slotSeconds
} from './callPlanning';
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
  /** Tests: pretend every call is this many seconds long (default: the real estimate). */
  baseSecondsOverride?: number;
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

type MedicineRow = { name: string; isActive: boolean; purpose: string | null; endsOn?: string | null };

/** Switched on and not past its course end date (`today` is IST YYYY-MM-DD). */
export function medicineIsCurrent(m: { isActive: boolean; endsOn?: string | null }, today: string): boolean {
  return m.isActive && (!m.endsOn || m.endsOn >= today);
}

export function medicineMaps(medicines: MedicineRow[], today: string) {
  const current = medicines.filter(m => medicineIsCurrent(m, today));
  const inactiveNames = new Set(medicines.filter(m => !medicineIsCurrent(m, today)).map(m => m.name));
  const purposes = new Map(current.filter(m => m.purpose?.trim()).map(m => [m.name, m.purpose!.trim()]));
  const activeNames = current.map(m => m.name);
  return { inactiveNames, purposes, activeNames };
}

interface ParentForCall {
  id: string;
  userId: string;
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
  readingsToAsk: string[];
  readingsEveryDays?: number;
  latitude: number | null;
  longitude: number | null;
  lastWeatherNoteAt: Date | null;
  festivals: string[];
  specialDaysJson: string | null;
  hearingMode: boolean;
  helperName: string | null;
  helperDays: number[];
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
  const ownerPlan = await ownerPlanFor(parent.userId, now);
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
    wellbeingTopic: extras.wellbeingTopic ?? null,
    askFeeling: extras.askFeeling,
    refillMedicines: extras.refillMedicines,
    specialDay: extras.specialDay,
    companionTopics: snapshot.callType === 'companion' ? parent.companionTopics || null : null,
    supportPhone: supportPhone(),
    familyMessage: extras.familyMessage,
    appointmentNote: extras.appointmentNote,
    appointmentQuestion: extras.appointmentQuestion,
    askReadings: extras.askReadings,
    weatherNote: extras.weatherNote,
    hearingMode: extras.hearingMode,
    firmTimeLimit: firmCallLimit(ownerPlan.id),
    helperQuestion: extras.helperQuestion,
    partner: snapshot.partner
      ? { name: snapshot.partner.name, medicines: snapshot.partner.medicines, askReadings: snapshot.partner.askReadings }
      : null
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

const istDayStart = (now: Date) => new Date(Date.parse(`${istDateString(now)}T00:00:00+05:30`));

/** A call with no tablets: the short readings call of the Health Monitor add-on. */
export function isVitalsSlot(s: { slot: string; linkedMedicineNames: string[] }): boolean {
  return s.slot === 'wellness' && (s.linkedMedicineNames || []).length === 0;
}

/** The most calls a day on any calling plan (Solo / Family / Extended): enough to plan where the health bundle goes. */
const HEALTH_PLAN_SLOTS = 3;

/** Has "How are you feeling today?" already been asked on an answered call today? */
async function feelingAskedToday(parentId: string, today: string): Promise<boolean> {
  const rows = await prisma.callLog.findMany({ where: { parentId, status: 'answered', callDate: today }, select: { resultJson: true } });
  return rows.some(r => !!readSnapshot(r.resultJson).asked?.askFeeling);
}

/**
 * How heavy each of today's calls is: the tablets asked about, or (once there are a few real calls for the slot) its own
 * average length with the health questions taken out, so a chatty parent's calls count as longer.
 */
async function healthLoads(
  parentId: string,
  slots: Array<Parameters<typeof slotMedicines>[0] & { id: string; time: string }>,
  inactiveNames: Set<string>,
  purposes: Map<string, string>,
  now: Date
): Promise<SlotLoad[]> {
  const ids = slots.map(s => s.id);
  const rows = ids.length
    ? await prisma.callLog.findMany({
        where: { parentId, slotId: { in: ids }, status: 'answered', durationSeconds: { gt: 0 }, createdAt: { gte: new Date(now.getTime() - 14 * 86400000) } },
        select: { slotId: true, durationSeconds: true, resultJson: true },
        take: 100
      })
    : [];
  const samples = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.slotId) continue;
    const asked = readSnapshot(r.resultJson).asked;
    const bundle = asked?.askFeeling ? (asked.wellbeingTopic ? HEALTH_BUNDLE_SECONDS : FEELING_SECONDS) : 0;
    samples.set(r.slotId, [...(samples.get(r.slotId) || []), Math.max(10, r.durationSeconds - bundle)]);
  }
  return slots.map(s => {
    const own = samples.get(s.id) || [];
    return {
      id: s.id,
      minutes: parseClockTime(s.time) as number,
      medicines: slotMedicines(s, inactiveNames, purposes).length,
      typicalSeconds: own.length >= MIN_SAMPLES_FOR_TYPICAL ? Math.round(own.reduce((a, b) => a + b, 0) / own.length) : null
    };
  });
}

/** Tablets the parent said "later" about on an earlier answered call today and hasn't confirmed since (no extra calls: they're asked again on the next one). */
async function laterToday(parentId: string, today: string): Promise<LinkedMedicineDetail[]> {
  const rows = await prisma.callLog.findMany({ where: { parentId, status: 'answered', callDate: today }, orderBy: { createdAt: 'asc' }, select: { resultJson: true } });
  const key = (name: string) => name.trim().toLowerCase();
  const state = new Map<string, { status: string; detail: LinkedMedicineDetail }>();
  for (const r of rows) {
    let parsed: { medicines?: LinkedMedicineDetail[]; medicineResults?: Array<{ name: string; status: string }> } = {};
    try {
      parsed = JSON.parse(r.resultJson || '{}');
    } catch {
      continue;
    }
    const details = new Map((Array.isArray(parsed.medicines) ? parsed.medicines : []).map(m => [key(m.name), m]));
    for (const res of Array.isArray(parsed.medicineResults) ? parsed.medicineResults : []) {
      state.set(key(res.name), { status: res.status, detail: details.get(key(res.name)) || ({ name: res.name } as LinkedMedicineDetail) });
    }
  }
  return [...state.values()].filter(v => v.status === 'later').map(v => v.detail);
}

/**
 * Kinds of reading that are not due: recorded (from a call or typed in by the family) today, or within the family's
 * gap (every 3 days = today and the 2 days before). A missed day is asked again the next day, not 3 days later.
 */
async function readingsTakenToday(parentId: string, now: Date, everyDays = 1): Promise<string[]> {
  const since = new Date(istDayStart(now).getTime() - (Math.max(1, everyDays) - 1) * 86400000);
  const rows = await prisma.healthReading.findMany({ where: { parentId, takenAt: { gte: since } }, select: { kind: true } });
  return [...new Set(rows.map(r => r.kind))];
}

const nearbyAppointments = (parentId: string, now: Date) =>
  prisma.appointment.findMany({
    where: { parentId, cancelledAt: null, startsAt: { gte: new Date(now.getTime() - 4 * 86400000), lte: new Date(now.getTime() + 2 * 86400000) } }
  });

/** What each reading asked for costs in call time (seconds): the question, the number, repeating it back. */
const READING_SECONDS = 12;

/**
 * What the household set up for this parent, by what the account bought (2026-10-08): appointment reminders on every
 * plan; BP / sugar with Health Monitor; hearing-friendly mode always (it is accessibility). Family messages and the
 * Daily Touches (festival wishes, weather, the helper check) were removed on 2026-10-08. On a couple call the second parent's
 * appointments ride along, labelled with their name, and household things come from either parent.
 */
async function familyAsksFor(
  parent: ParentForCall,
  callType: CallType,
  now: Date,
  deps: DispatchDeps,
  lastCallOfDay: boolean,
  partner: ParentForCall | undefined,
  access: { monitor: boolean; readingsHere: boolean; baseSeconds?: number }
): Promise<FamilyAsks> {
  const [appointments, taken, partnerAppointments] = await Promise.all([
    nearbyAppointments(parent.id, now),
    access.monitor ? readingsTakenToday(parent.id, now, parent.readingsEveryDays) : Promise.resolve([] as string[]),
    partner ? nearbyAppointments(partner.id, now) : Promise.resolve([])
  ]);
  const who = partner?.name.split(' ')[0] || '';

  return {
    messages: [],
    appointments: [...appointments, ...partnerAppointments.map(a => ({ ...a, who }))],
    readingsToAsk: access.monitor ? parent.readingsToAsk : [],
    readingsTakenToday: taken,
    readingsHere: access.readingsHere,
    weatherNote: null,
    helper: { name: null, days: [], askedToday: false, lastCallOfDay },
    hearingMode: parent.hearingMode || !!partner?.hearingMode,
    specialDay: null,
    baseSeconds: access.baseSeconds
  };
}

async function extrasFor(
  parent: ParentForCall,
  callType: CallType,
  activeNames: string[],
  now: Date,
  deps: DispatchDeps = {},
  lastCallOfDay = false,
  partner?: ParentForCall,
  /** Which part of the health bundle this call carries (see callPlanning.healthCarryFor); unset = the old "first answered call" rule. */
  carry?: HealthCarry,
  /** Health Monitor: whether THIS call is where readings are asked (false when a separate readings call exists). */
  readingsHere = true,
  /** Estimated seconds of this call (tablets + health questions); passed on for the appointment line's room check. */
  baseSeconds?: number
): Promise<CallExtras> {
  const monitor = await ownerHasHealthMonitor(parent.userId, now);
  const [facts, family] = await Promise.all([
    recentCallFacts(parent.id, istDateString(now), now),
    familyAsksFor(parent, callType, now, deps, lastCallOfDay, partner, { monitor, readingsHere, baseSeconds })
  ]);
  return planCallExtras({
    callType,
    rhythm: {
      parentConsent: parent.parentConsent,
      lastSafetyLineAt: parent.lastSafetyLineAt,
      lastWellbeingAt: parent.lastWellbeingAt,
      lastRefillCheckAt: parent.lastRefillCheckAt,
      birthDate: null
    },
    lastAnswered: facts.lastAnswered,
    activeMedicineNames: activeNames,
    answeredToday: facts.answeredToday,
    now,
    family,
    healthCarry: carry,
    healthQuestions: monitor
  });
}

type LoadedParent = Prisma.ParentProfileGetPayload<{
  include: { callSchedule: true; medicines: true; user: { include: { subscription: true } } };
}>;

/**
 * Couple calls: both parents of one account on the same phone, linked both ways, both said yes,
 * neither paused. Returns the partner and whether `p` is the one who gets the call.
 */
export function coupleOf<T extends { id: string; userId: string; phone: string; callTogetherWithId: string | null; isPaused: boolean; isDeleted: boolean; parentConsent: string | null }>(
  p: T,
  byId: Map<string, T>
): { partner: T; primary: boolean } | null {
  const q = p.callTogetherWithId ? byId.get(p.callTogetherWithId) : undefined;
  if (!q || q.callTogetherWithId !== p.id || q.userId !== p.userId || q.isDeleted || p.isDeleted) return null;
  const a = normalizePhone(p.phone);
  const b = normalizePhone(q.phone);
  if (!a.ok || !b.ok || a.e164 !== b.e164) return null;
  if (p.isPaused || q.isPaused || p.parentConsent !== 'given' || q.parentConsent !== 'given') return null;
  return { partner: q, primary: p.id < q.id };
}

/** The second parent of a couple call, as the dispatcher needs them (for retries and follow-ups, which only kept the id). */
async function loadPartnerForCall(id: string): Promise<ParentForCall | undefined> {
  const p = await prisma.parentProfile.findUnique({ where: { id }, include: { user: true } });
  return p && !p.isDeleted ? p : undefined;
}

/** The partner's part of a couple call for one time of day (same slot type), or null if they have nothing then. */
async function partnerPart(partner: LoadedParent, slotType: string, now: Date, readings: { monitor: boolean; here: boolean } = { monitor: false, here: true }): Promise<PartnerSnapshot | null> {
  const slot = partner.callSchedule.find(s => s.isActive && s.slot === slotType);
  if (!slot) return null;
  const { inactiveNames, purposes } = medicineMaps(partner.medicines, istDateString(now));
  const taken = readings.monitor && readings.here ? await readingsTakenToday(partner.id, now, partner.readingsEveryDays) : [];
  return {
    parentId: partner.id,
    name: partner.name,
    slotId: slot.id,
    slot: slot.slot,
    medicines: slotMedicines(slot, inactiveNames, purposes),
    askReadings: readings.monitor && readings.here ? partner.readingsToAsk.filter(k => !taken.includes(k)) : []
  };
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
  const staleBefore = new Date(now.getTime() - STALE_PLACED_MINUTES * 60000);
  const staleRows = await prisma.callLog.findMany({
    where: {
      ...(scope ? { parentId: scope } : {}),
      processedAt: null,
      OR: [
        { status: 'placed', startedAt: { lt: staleBefore } },
        // Claimed but never handed to Sarvam (the run was cut off between the two): it would block the slot all day.
        { status: 'scheduled', createdAt: { lt: staleBefore } }
      ]
    },
    select: { id: true, parentId: true, attemptNumber: true, slot: true, status: true, createdAt: true },
    take: 200
  });
  let staleClosed = 0;
  for (const row of staleRows) {
    const closed = await prisma.callLog.updateMany({
      where: { id: row.id, processedAt: null, status: row.status },
      data: {
        status: 'failed',
        failureReason: row.status === 'placed' ? RESULT_NOT_RECEIVED : 'not_placed',
        processedAt: now,
        endedAt: now,
        summary: row.status === 'placed'
          ? 'No result was received from the calling service for this call.'
          : 'This call was never handed to the calling service.'
      }
    });
    if (closed.count !== 1) continue;
    staleClosed += 1;
    // A scheduled check-in that silently vanished must not look like "all fine": tell the family (test and manual calls excepted).
    // Only for recent ones: old leftovers (from before this check existed) are closed quietly, never reported as news.
    const recent = now.getTime() - row.createdAt.getTime() < 12 * 3600000;
    if (recent && row.slot && !NON_RETRY_SLOTS.includes(row.slot)) {
      try {
        const p = await prisma.parentProfile.findUnique({ where: { id: row.parentId }, select: { name: true } });
        await raiseUnreachableAlert(row, p?.name || 'your parent', 'failed', 'we did not get the call result from our calling service', deps.alertDeps);
      } catch (err) {
        console.error(`[calls] Could not raise the lost-call alert for ${row.id}:`, err);
      }
    }
  }
  summary.staleClosed = staleClosed;

  // 2. Scheduled slots that are due (and the weekly companion call).
  const parents = await prisma.parentProfile.findMany({
    where: { isDeleted: false, consentGiven: true, ...(scope ? { id: scope } : {}) },
    include: {
      callSchedule: { where: { isActive: true } },
      medicines: true,
      user: { include: { subscription: true } }
    }
  });

  const byId = new Map(parents.map(p => [p.id, p]));

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
      // WhatsApp-only reminders (Remind, or switched to WhatsApp): never called (lib/reminders.ts sends those).
      if (reminderChannelFor(plan, parent) === 'whatsapp') continue;

      const slots = [...parent.callSchedule]
        .filter(s => parseClockTime(s.time) !== null)
        .sort((a, b) => (parseClockTime(a.time) as number) - (parseClockTime(b.time) as number));
      // Health Monitor (Solo add-on): ONE short call with no tablets (a "wellness" slot) is for BP / sugar and sits outside
      // the 3-call cap, so the medicine calls stay under a minute.
      const hasMonitor = !!sub?.healthMonitor && healthMonitorAvailable(plan.id);
      const vitalsSlot = hasMonitor ? slots.find(isVitalsSlot) : undefined;
      const medSlots = vitalsSlot ? slots.filter(s => s.id !== vitalsSlot.id) : slots;
      if (medSlots.length > plan.callsPerDay) summary.cappedByPlan += medSlots.length - plan.callsPerDay;

      const { inactiveNames, purposes, activeNames } = medicineMaps(parent.medicines, today);
      const createdToday = istDateString(parent.createdAt) === today;
      const createdMinutes = istMinutesOfDay(parent.createdAt);
      const forCall: ParentForCall = { ...parent, phone: phone.e164 };
      // Extras (wellbeing, refill, …) go on the first call placed in this run only.
      let extrasUsed = false;
      const medCapped = medSlots.slice(0, plan.callsPerDay);
      const capped = vitalsSlot
        ? [...medCapped, vitalsSlot].sort((a, b) => (parseClockTime(a.time) as number) - (parseClockTime(b.time) as number))
        : medCapped;
      // One call for a couple sharing a phone: Family / Extended only.
      const couple = plan.premium ? coupleOf(parent, byId) : null;
      // The other parent's call covers these times of day.
      const coveredByPartner = couple && !couple.primary
        ? new Set(couple.partner.callSchedule.filter(s => s.isActive).map(s => s.slot))
        : new Set<string>();

      // Where today's health questions go (decided once per parent, only when a call is actually due).
      let loads: SlotLoad[] | null = null;
      let feelingAsked = false;

      for (const slot of capped) {
        if (!isSlotDue(slot.time, now, DUE_WINDOW_MINUTES)) continue;
        // A newly added parent is first called the next day, not about a slot that already passed.
        if (createdToday && (parseClockTime(slot.time) as number) <= createdMinutes) continue;
        if (coveredByPartner.has(slot.slot)) continue;
        // The tablet-free readings call only rings on days a reading is due (every day, or every 3 days).
        if (vitalsSlot && slot.id === vitalsSlot.id) {
          const done = await readingsTakenToday(parent.id, now, parent.readingsEveryDays);
          if (!parent.readingsToAsk.some(k => !done.includes(k))) continue;
        }

        if (!loads) {
          loads = await healthLoads(parent.id, medCapped, inactiveNames, purposes, now);
          feelingAsked = await feelingAskedToday(parent.id, today);
        }
        const own = slotMedicines(slot, inactiveNames, purposes);
        // "Later" earlier today: asked again here (there are no extra follow-up calls).
        const carried = (await laterToday(parent.id, today)).filter(m => !inactiveNames.has(m.name) && !own.some(o => o.name.trim().toLowerCase() === m.name.trim().toLowerCase()));
        const medicines = [...own, ...carried];
        const lastCallOfDay = slot.id === medCapped[medCapped.length - 1]?.id;
        // The health questions are Health Monitor only (2026-10-08); without it nothing is reserved for them.
        const carry = hasMonitor ? healthCarryFor({ loads, slotId: slot.id, feelingAskedToday: feelingAsked, nowMinutes: istMinutesOfDay(now) }) : 'none';
        const readingsHere = !vitalsSlot || slot.id === vitalsSlot.id;
        const partner = couple?.primary ? await partnerPart(couple.partner, slot.slot, now, { monitor: hasMonitor, here: readingsHere }) : null;
        // About how long this call runs before the daily touches: tablets (own, carried "later", the partner's) + the health questions.
        const load = loads.find(l => l.id === slot.id);
        const baseSeconds =
          (load ? slotSeconds(load) : readingsHere && vitalsSlot ? CALL_BASE_SECONDS + READING_SECONDS * forCall.readingsToAsk.length : CALL_BASE_SECONDS) +
          PER_MEDICINE_SECONDS * (carried.length + (partner?.medicines.length || 0)) +
          (carry === 'full' ? HEALTH_BUNDLE_SECONDS : carry === 'feeling' ? FEELING_SECONDS : 0);
        const extras = extrasUsed
          ? { ...NO_EXTRAS, askConsent: forCall.parentConsent !== 'given' }
          : await extrasFor(forCall, 'reminder', activeNames, now, deps, lastCallOfDay, couple?.primary ? couple.partner : undefined, carry, readingsHere, deps.baseSecondsOverride ?? baseSeconds);
        const snapshot: CallSnapshot = {
          medicines,
          callType: 'reminder',
          asked: extras,
          ...(lastCallOfDay && maxFollowUpsPerDay() === 0 ? { finalCall: true } : {}),
          ...(carried.length ? { carriedLater: carried.map(m => m.name) } : {}),
          ...(partner ? { partner } : {})
        };
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

      // Weekly companion call: opted in, plan includes it (plan.weeklyChat), its day and time.
      if (
        parent.companionEnabled &&
        plan.weeklyChat &&
        parent.companionDay === istWeekday(now) &&
        parent.companionTime &&
        isSlotDue(parent.companionTime, now, DUE_WINDOW_MINUTES) &&
        !(createdToday && (parseClockTime(parent.companionTime) ?? 0) <= createdMinutes)
      ) {
        const extras = extrasUsed
          ? { ...NO_EXTRAS, askConsent: forCall.parentConsent !== 'given' }
          : await extrasFor(forCall, 'companion', activeNames, now, deps);
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
    // Claim the retry with a short lease so overlapping runs cannot both pick it up. A lease (not "cleared") means a
    // run that is killed half-way (function time limit) leaves the retry to be picked up again a few minutes later;
    // the unique attempt number stops it being dialled twice. The lease is cleared once the retry has been handled.
    const lease = new Date(now.getTime() + RETRY_LEASE_MINUTES * 60000);
    const claimedRetry = await prisma.callLog.updateMany({
      where: { id: prev.id, nextRetryAt: prev.nextRetryAt },
      data: { nextRetryAt: lease }
    });
    if (claimedRetry.count !== 1) continue;
    try {

      const parent = await prisma.parentProfile.findUnique({
        where: { id: prev.parentId },
        include: { callSchedule: true, medicines: true, user: { include: { subscription: true } } }
      });
      if (!parent || parent.isDeleted || parent.isPaused || consentBlocksCalls(parent.parentConsent)) continue;
      // The plan lapsed, or moved to WhatsApp reminders (Remind, or this parent switched) since the first attempt: no more calls.
      const retrySub = parent.user.subscription;
      const retryPlan = getEffectivePlan(
        retrySub ? { planId: retrySub.planId as PlanId, status: retrySub.status, currentPeriodEnd: retrySub.currentPeriodEnd.toISOString() } : null,
        parent.user.createdAt,
        now
      );
      if (retryPlan.expired || reminderChannelFor(retryPlan, parent) === 'whatsapp') continue;
      const phone = normalizePhone(parent.phone);
      if (!phone.ok) continue;

      const slot = parent.callSchedule.find(s => s.id === prev.slotId && s.isActive);
      const { inactiveNames, purposes, activeNames } = medicineMaps(parent.medicines, today);
      const own = slot ? slotMedicines(slot, inactiveNames, purposes) : [];
      const carried = (await laterToday(parent.id, today)).filter(m => !inactiveNames.has(m.name) && !own.some(o => o.name.trim().toLowerCase() === m.name.trim().toLowerCase()));
      const medicines = [...own, ...carried];
      const forCall: ParentForCall = { ...parent, phone: phone.e164 };
      // A couple call is retried as a couple call.
      const partner = readSnapshot(prev.resultJson).partner;
      const retryVitals = parent.user.subscription?.healthMonitor ? parent.callSchedule.find(s => s.isActive && isVitalsSlot(s)) : undefined;
      const todaysSlots = [...parent.callSchedule]
        .filter(s => s.isActive && parseClockTime(s.time) !== null && s.id !== retryVitals?.id)
        .sort((a, b) => (parseClockTime(a.time) as number) - (parseClockTime(b.time) as number))
        .slice(0, HEALTH_PLAN_SLOTS);
      const retryLoads = await healthLoads(parent.id, todaysSlots, inactiveNames, purposes, now);
      const retryCarry = !parent.user.subscription?.healthMonitor ? 'none' : healthCarryFor({
        loads: retryLoads,
        slotId: prev.slotId,
        feelingAskedToday: await feelingAskedToday(parent.id, today),
        nowMinutes: istMinutesOfDay(now)
      });
      const retryReadingsHere = !retryVitals || prev.slotId === retryVitals.id;
      const retryLoad = retryLoads.find(l => l.id === prev.slotId);
      const retryBase =
        (retryLoad ? slotSeconds(retryLoad) : retryReadingsHere && retryVitals ? CALL_BASE_SECONDS + READING_SECONDS * parent.readingsToAsk.length : CALL_BASE_SECONDS) +
        PER_MEDICINE_SECONDS * carried.length +
        (retryCarry === 'full' ? HEALTH_BUNDLE_SECONDS : retryCarry === 'feeling' ? FEELING_SECONDS : 0);
      const finalCall = maxFollowUpsPerDay() === 0 && !!prev.slotId && todaysSlots[todaysSlots.length - 1]?.id === prev.slotId;
      const snapshot: CallSnapshot = {
        medicines,
        callType: 'reminder',
        asked: await extrasFor(forCall, 'reminder', activeNames, now, deps, false, partner ? await loadPartnerForCall(partner.parentId) : undefined, retryCarry, retryReadingsHere, retryBase),
        ...(finalCall ? { finalCall: true } : {}),
        ...(carried.length ? { carriedLater: carried.map(m => m.name) } : {}),
        ...(partner ? { partner } : {})
      };

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
    } finally {
      await prisma.callLog.updateMany({ where: { id: prev.id, nextRetryAt: lease }, data: { nextRetryAt: null } }).catch(() => undefined);
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
      if (parent.reminderChannel === 'whatsapp') continue;
      const phone = normalizePhone(parent.phone);
      if (!phone.ok) continue;

      const original = readSnapshot(prev.resultJson);
      const later = (key: 'medicineResults' | 'partnerMedicineResults'): string[] => {
        try {
          const results = JSON.parse(prev.resultJson || '{}')?.[key];
          return Array.isArray(results) ? results.filter((r: { status?: string }) => r.status === 'later').map((r: { name: string }) => r.name) : [];
        } catch {
          return [];
        }
      };
      const laterNames = later('medicineResults');
      const partnerLater = later('partnerMedicineResults');
      const medicines = original.medicines.filter(m => laterNames.includes(m.name));
      const partner = original.partner
        ? { ...original.partner, medicines: original.partner.medicines.filter(m => partnerLater.includes(m.name)), askReadings: [] }
        : null;
      if (medicines.length === 0 && !partner?.medicines.length) continue;

      const forCall: ParentForCall = { ...parent, phone: phone.e164 };
      const snapshot: CallSnapshot = {
        medicines,
        callType: 'followup',
        asked: await extrasFor(forCall, 'followup', [], now, deps, false, original.partner ? await loadPartnerForCall(original.partner.parentId) : undefined),
        followUpOf: prev.id,
        ...(partner?.medicines.length ? { partner } : {})
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
/** How long a claimed retry is held before another run may pick it up again (a run killed half-way). */
const RETRY_LEASE_MINUTES = 5;
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
  if (reminderChannelFor(plan, parent) === 'whatsapp') {
    return {
      ok: false,
      status: 409,
      code: 'WHATSAPP_ONLY',
      error: `${parent.name} gets medicine reminders on WhatsApp, not calls.${plan.channel === 'whatsapp' ? ' Calls come with the Solo, Family and Extended plans.' : ' Switch them to calls in Settings first.'}`
    };
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

  const slots = [...parent.callSchedule]
    .filter(s => parseClockTime(s.time) !== null)
    .sort((a, b) => (parseClockTime(a.time) as number) - (parseClockTime(b.time) as number));
  const chosen =
    (input.slotType ? slots.find(s => s.slot === input.slotType) : undefined) ||
    slots.find(s => s.linkedMedicineNames.length > 0) ||
    slots[0];

  const { inactiveNames, purposes, activeNames } = medicineMaps(parent.medicines, istDateString(now));
  const medicines = chosen ? slotMedicines(chosen, inactiveNames, purposes) : [];
  const forCall: ParentForCall = { ...parent, phone: phone.e164 };
  const snapshot: CallSnapshot = { medicines, callType: 'reminder', asked: await extrasFor(forCall, 'reminder', activeNames, now, deps) };

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

  // The limit is counted AFTER this attempt is recorded, so requests sent at the same moment can't all slip under it
  // (they all see each other and are refused), and by phone number across every profile with it, deleted ones too,
  // so removing and re-adding the parent doesn't start a fresh count. Attempts Sarvam refused (no attempt id, the
  // phone never rang) and attempts refused here don't use up the limit.
  const hourAgo = new Date(now.getTime() - 60 * 60000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60000);
  const manualCalls = {
    parent: { phone: { in: [...new Set([parent.phone, phone.e164])] } },
    slot: { in: ['test', 'manual'] },
    NOT: { status: 'failed', providerAttemptId: null }
  };
  const [lastHour, lastDay] = await Promise.all([
    prisma.callLog.count({ where: { ...manualCalls, createdAt: { gte: hourAgo } } }),
    prisma.callLog.count({ where: { ...manualCalls, createdAt: { gte: dayAgo } } })
  ]);
  if (lastHour > MAX_MANUAL_PER_HOUR || lastDay > MAX_MANUAL_PER_DAY) {
    await prisma.callLog.update({
      where: { id: log.id },
      data: { status: 'failed', failureReason: 'rate_limited', processedAt: now, endedAt: now, summary: 'Not placed: too many test calls to this number recently.' }
    });
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      error: 'Too many test calls to this number recently. Please try again later.'
    };
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
