/**
 * What each Saathi call should include besides the medicine questions.
 * Pure functions: the dispatcher loads the data and stores the decision in the
 * CallLog snapshot, so the webhook knows what was asked.
 *
 * Calls stay short (billed per started minute, so under 60 seconds matters). The health bundle ("How are you feeling
 * today?" + the day's one health question + the optional extras below) rides on ONE call a day: the EARLIEST call
 * that fits in the budget, so a morning with many tablets stays short and the questions move to a lighter call
 * (decided with the user 2026-10-08, see chooseHealthSlot). Besides the consent question on a first call, at most
 * MAX_EXTRAS of these ride along, most useful first:
 *   1. last_call_note  — "Last time you said your knee hurt; is it better?"
 *   2. wellbeing       — ONE question a day in turn (sleep, appetite, pain), so each comes back every 3 days
 *                        (decided 2026-10-04: three at once made one long call that billed 2 minutes)
 *   3. refill          — "enough of X for the week?", every REFILL_EVERY_DAYS
 *   4. safety line     — "I will never ask for money or OTPs", every SAFETY_LINE_EVERY_DAYS
 * Anything left over is due again on the next call.
 *
 * Always included when due (v1.1), because the family asked for them:
 *   family messages, appointment reminders / "how did it go?", BP / sugar readings,
 *   "did the helper come today?". One-liners that don't count: festival / birthday
 *   greeting, a weather note on very hot / cold / rainy days, hearing-friendly mode.
 */
import { CallType } from './sarvam';
import { cleanMedicineNameForSpeech } from './scheduleGenerator';
import { AppointmentRow, planAppointments } from './appointments';

/** Call types that are not one of the parent's daily slots: never retried, and no "lives alone" check when unanswered. */
export const NON_RETRY_SLOTS = ['companion', 'followup', 'callback', 'test', 'manual'];

export const MAX_EXTRAS = 2;
/** What the Daily Touches add-on costs in call time (seconds), in the order they are tried. */
export const TOUCH_SECONDS = { special: 6, weather: 6, helper: 8 };
/** An appointment reminder, and a "how did it go?". */
export const APPOINTMENT_SECONDS = 12;

// ---- Where the health bundle goes (2026-10-08) ----
// Sarvam bills every started minute, and Saathi never cuts a parent off, so the plan is made BEFORE the call:
// estimate how long each of the day's calls takes and put the health questions on the earliest one that still fits.
/** Greeting, goodbye and the family notes. */
export const CALL_BASE_SECONDS = 12;
export const PER_MEDICINE_SECONDS = 7;
/** "How are you feeling?" + the one rotating question (+ the weekly extras, which are rare). */
export const HEALTH_BUNDLE_SECONDS = 20;
/** Only "How are you feeling?". */
export const FEELING_SECONDS = 10;
/** A call stays under a minute when the estimate is at most this. */
export const CALL_BUDGET_SECONDS = 56;
/** If the chosen call never happened (missed, no retry left), a later one may take the questions after this long. */
export const HEALTH_TAKEOVER_AFTER_MINUTES = 120;
/** A slot's own average (from real calls) replaces the estimate once there are this many calls. */
export const MIN_SAMPLES_FOR_TYPICAL = 3;

export type HealthCarry = 'full' | 'feeling' | 'none';

export interface SlotLoad {
  id: string;
  /** Minutes after midnight IST. */
  minutes: number;
  /** Tablets asked about on that call. */
  medicines: number;
  /** Average seconds of this slot's recent answered calls without the health bundle; null = no data yet. */
  typicalSeconds?: number | null;
}

export function slotSeconds(l: SlotLoad): number {
  return l.typicalSeconds ?? CALL_BASE_SECONDS + PER_MEDICINE_SECONDS * l.medicines;
}

/**
 * The call that carries the health questions: the earliest one where the whole bundle fits in the budget; if none
 * does, the lightest one gets only "How are you feeling?" (the daily check the family counts on).
 */
export function chooseHealthSlot(loads: SlotLoad[]): { id: string; carry: 'full' | 'feeling' } | null {
  if (loads.length === 0) return null;
  const byTime = [...loads].sort((a, b) => a.minutes - b.minutes);
  const full = byTime.find(l => slotSeconds(l) + HEALTH_BUNDLE_SECONDS <= CALL_BUDGET_SECONDS);
  if (full) return { id: full.id, carry: 'full' };
  const lightest = [...byTime].sort((a, b) => slotSeconds(a) - slotSeconds(b) || a.minutes - b.minutes)[0];
  return { id: lightest.id, carry: 'feeling' };
}

/** What the call for `slotId` carries today. */
export function healthCarryFor(input: { loads: SlotLoad[]; slotId: string | null; feelingAskedToday: boolean; nowMinutes: number }): HealthCarry {
  if (input.feelingAskedToday || !input.slotId) return 'none';
  const chosen = chooseHealthSlot(input.loads);
  if (!chosen) return 'none';
  if (chosen.id === input.slotId) return chosen.carry;
  // The chosen call didn't happen: a later one takes over, once enough time has passed to be sure.
  const chosenLoad = input.loads.find(l => l.id === chosen.id);
  if (!chosenLoad || input.nowMinutes < chosenLoad.minutes + HEALTH_TAKEOVER_AFTER_MINUTES) return 'none';
  const next = chooseHealthSlot(input.loads.filter(l => l.minutes > chosenLoad.minutes));
  return next && next.id === input.slotId ? next.carry : 'none';
}
/** Each wellbeing topic comes back every this many days (one topic a day, in turn). */
export const WELLBEING_EVERY_DAYS = 3;
export type WellbeingTopic = 'sleep' | 'appetite' | 'pain';
export const WELLBEING_TOPICS: WellbeingTopic[] = ['sleep', 'appetite', 'pain'];

/** Today's wellbeing topic (IST day number in turn): the same for every parent on a given day. */
export function wellbeingTopicFor(now: Date): WellbeingTopic {
  const istDay = Math.floor((now.getTime() + 330 * 60000) / 86400000);
  return WELLBEING_TOPICS[istDay % WELLBEING_TOPICS.length];
}
export const REFILL_EVERY_DAYS = 7;
export const SAFETY_LINE_EVERY_DAYS = 7;
export const LAST_NOTE_MAX_AGE_DAYS = 7;

export interface CallExtras {
  askConsent: boolean;
  saySafetyLine: boolean;
  lastCallNote: string | null;
  /** First version: all three wellbeing questions at once. Old call snapshots only. */
  askWellbeing?: boolean;
  /** Today's one wellbeing question (null = none on this call). */
  wellbeingTopic?: WellbeingTopic | null;
  /** "How are you feeling today?" on the first call the parent answers each day. */
  askFeeling?: boolean;
  refillMedicines: string[];
  specialDay: string | null;
  // v1.1 (optional so older call snapshots still read)
  familyMessage?: string | null;
  familyMessageIds?: string[];
  appointmentNote?: string | null;
  appointmentReminded?: { id: string; which: 'day_before' | 'same_day' }[];
  appointmentQuestion?: string | null;
  appointmentFollowUpId?: string | null;
  askReadings?: string[];
  weatherNote?: string | null;
  helperQuestion?: string | null;
  /** The helper asked about (on a couple call the helper may be set on the other parent). */
  helperName?: string | null;
  hearingMode?: boolean;
}

/** What the family queued or set up for this parent (gathered by the dispatcher). */
export interface FamilyAsks {
  messages: { id: string; authorName: string; text: string }[];
  appointments: AppointmentRow[];
  readingsToAsk: string[];
  readingsTakenToday: string[];
  /** False on the calls that don't ask for readings (Health Monitor: only the short readings call does). Unset = ask. */
  readingsHere?: boolean;
  /**
   * Estimated seconds of this call before the daily touches (tablets, the health questions, the partner's tablets).
   * The touches (a special-day wish, the weather, the helper check) go on only while the call stays within
   * CALL_BUDGET_SECONDS; unset = no limit.
   */
  baseSeconds?: number;
  /** Already decided by the dispatcher (only on days worth mentioning, once a day). */
  weatherNote: string | null;
  helper: { name: string | null; days: number[]; askedToday: boolean; lastCallOfDay: boolean };
  hearingMode: boolean;
  /** Festival / personal day / birthday, from lib/festivals.ts. */
  specialDay: string | null;
}

/** At most this many family messages per call (the rest wait for the next call). */
export const MAX_MESSAGES_PER_CALL = 2;

export const NO_EXTRAS: CallExtras = {
  askConsent: false,
  saySafetyLine: false,
  lastCallNote: null,
  wellbeingTopic: null,
  askFeeling: false,
  refillMedicines: [],
  specialDay: null
};

export interface ParentRhythm {
  parentConsent: string | null;
  lastSafetyLineAt: Date | null;
  lastWellbeingAt: Date | null;
  lastRefillCheckAt: Date | null;
  birthDate: string | null; // MM-DD
}

export interface LastAnsweredCall {
  createdAt: Date;
  healthConcern: string | null;
  pain: string | null;
  painWhere: string | null;
}

const DAY = 86400000;
const olderThan = (d: Date | null, days: number, now: Date) => !d || now.getTime() - d.getTime() >= days * DAY;

/** True while the parent hasn't said yes on a call yet (new parents, and after a "no" or "stop" that the family resumed). */
export function needsConsent(parentConsent: string | null | undefined): boolean {
  return parentConsent !== 'given';
}

/** "Last time, on Monday, you said: knee pain since morning." (English; the agent says it in the call language). */
export function lastCallNote(last: LastAnsweredCall | null, now: Date): string | null {
  if (!last || now.getTime() - last.createdAt.getTime() > LAST_NOTE_MAX_AGE_DAYS * DAY) return null;
  const day = last.createdAt.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  if (last.healthConcern) return `Last time, on ${day}, they said: ${last.healthConcern.replace(/\.$/, '')}.`;
  if (last.pain === 'mild' || last.pain === 'severe') {
    return `Last time, on ${day}, they mentioned pain${last.painWhere ? ` in their ${last.painWhere}` : ''}.`;
  }
  return null;
}

/** MM-DD in IST, for birthday matching. */
export function istMonthDay(now: Date): string {
  const d = new Date(now.getTime() + 5.5 * 3600000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function planCallExtras(input: {
  callType: CallType;
  rhythm: ParentRhythm;
  lastAnswered: LastAnsweredCall | null;
  activeMedicineNames: string[];
  answeredToday: boolean;
  now: Date;
  family?: FamilyAsks;
  /** Which part of the health bundle this call carries; unset = the old rule (first answered call of the day). */
  healthCarry?: HealthCarry;
}): CallExtras {
  const { callType, rhythm, now, family } = input;
  const extras: CallExtras = { ...NO_EXTRAS, refillMedicines: [] };
  extras.askConsent = needsConsent(rhythm.parentConsent);

  // The Daily Touches only go on while the call has room (family.baseSeconds is what the call already holds).
  let touchRoom = family?.baseSeconds === undefined ? Infinity : CALL_BUDGET_SECONDS - family.baseSeconds;
  const fits = (seconds: number) => {
    if (touchRoom < seconds) return false;
    touchRoom -= seconds;
    return true;
  };

  // A greeting (birthday, a festival they celebrate, a family-added day) on the first call the parent answers that day.
  if (!input.answeredToday) {
    if (family?.specialDay) {
      if (fits(TOUCH_SECONDS.special)) extras.specialDay = family.specialDay;
    } else if (rhythm.birthDate && rhythm.birthDate === istMonthDay(now) && fits(TOUCH_SECONDS.special)) extras.specialDay = 'birthday';
  }

  if (family) extras.hearingMode = family.hearingMode;

  // Follow-ups are about one or two tablets only; nothing else rides along.
  if (callType === 'followup') return extras;

  // "How are you feeling today?" once a day, on the call chosen by chooseHealthSlot (legacy: the first one answered).
  const carry: HealthCarry = input.healthCarry ?? (input.answeredToday ? 'none' : 'full');
  if (carry !== 'none') extras.askFeeling = true;

  if (family) {
    const appt = planAppointments(family.appointments, now);
    if (appt.note) {
      extras.appointmentNote = appt.note;
      extras.appointmentReminded = appt.reminded;
      touchRoom -= APPOINTMENT_SECONDS;
    }
    if (appt.followUp) {
      extras.appointmentQuestion = appt.followUp.question;
      extras.appointmentFollowUpId = appt.followUp.id;
      touchRoom -= APPOINTMENT_SECONDS;
    }
    if (callType !== 'companion' && family.readingsHere !== false) {
      const due = family.readingsToAsk.filter(k => !family.readingsTakenToday.includes(k));
      if (due.length) extras.askReadings = due;
    }
    if (family.weatherNote && fits(TOUCH_SECONDS.weather)) extras.weatherNote = family.weatherNote;
    const weekday = new Date(now.getTime() + 5.5 * 3600000).getUTCDay();
    if (family.helper.name && family.helper.days.includes(weekday) && family.helper.lastCallOfDay && !family.helper.askedToday && fits(TOUCH_SECONDS.helper)) {
      extras.helperQuestion = `Did ${family.helper.name} come today?`;
      extras.helperName = family.helper.name;
    }
  }

  // Cost control: Sarvam bills every started minute, so the optional extras ride only on the one call that carries the
  // health bundle; the other calls stay a short medicine check (family messages, readings and appointments above still go).
  let slots = carry === 'full' ? MAX_EXTRAS : 0;
  const note = lastCallNote(input.lastAnswered, now);
  if (note && slots > 0) {
    extras.lastCallNote = note;
    slots -= 1;
  }
  // One wellbeing question a day, in turn, on the first answered call.
  if (slots > 0) {
    extras.wellbeingTopic = wellbeingTopicFor(now);
    slots -= 1;
  }
  if (slots > 0 && callType !== 'companion' && input.activeMedicineNames.length > 0 && olderThan(rhythm.lastRefillCheckAt, REFILL_EVERY_DAYS, now)) {
    extras.refillMedicines = input.activeMedicineNames.map(cleanMedicineNameForSpeech).slice(0, 6);
    slots -= 1;
  }
  // The safety line is short, and the first call always has it.
  if ((slots > 0 || extras.askConsent) && olderThan(rhythm.lastSafetyLineAt, SAFETY_LINE_EVERY_DAYS, now)) {
    extras.saySafetyLine = true;
  }
  return extras;
}

/** Stored on the CallLog when the call is placed (resultJson), read back by the webhook. */
export interface CallSnapshot {
  medicines: import('./types').LinkedMedicineDetail[];
  callType?: CallType;
  /** The last scheduled call of the day: a tablet still "later" now counts as not taken (no extra follow-up calls). */
  finalCall?: boolean;
  /** Tablets the parent said "later" about earlier today, asked again on this call. */
  carriedLater?: string[];
  asked?: CallExtras;
  /** Follow-up calls: the call whose "later" answer they follow up. */
  followUpOf?: string;
  /** Couple call: the other parent on the same phone, asked about in the same call. */
  partner?: PartnerSnapshot;
}

export interface PartnerSnapshot {
  parentId: string;
  name: string;
  slotId: string | null;
  slot: string | null;
  medicines: import('./types').LinkedMedicineDetail[];
  askReadings: string[];
}

export function readSnapshot(resultJson: string | null): CallSnapshot {
  if (!resultJson) return { medicines: [] };
  try {
    const parsed = JSON.parse(resultJson);
    return {
      medicines: Array.isArray(parsed?.medicines) ? parsed.medicines : [],
      callType: parsed?.callType,
      finalCall: parsed?.finalCall === true,
      carriedLater: Array.isArray(parsed?.carriedLater) ? parsed.carriedLater : undefined,
      asked: parsed?.asked,
      followUpOf: parsed?.followUpOf,
      partner: parsed?.partner && typeof parsed.partner.parentId === 'string' ? parsed.partner : undefined
    };
  } catch {
    return { medicines: [] };
  }
}
