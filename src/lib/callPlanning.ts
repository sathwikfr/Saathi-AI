/**
 * What each Saathi call should include besides the medicine questions.
 * Pure functions: the dispatcher loads the data and stores the decision in the
 * CallLog snapshot, so the webhook knows what was asked.
 *
 * Calls stay short (billed per started minute): besides the consent question on
 * a first call, at most MAX_EXTRAS of these ride along, most useful first:
 *   1. last_call_note  — "Last time you said your knee hurt; is it better?"
 *   2. wellbeing       — sleep, appetite, pain, every WELLBEING_EVERY_DAYS
 *   3. refill          — "enough of X for the week?", every REFILL_EVERY_DAYS
 *   4. safety line     — "I will never ask for money or OTPs", every SAFETY_LINE_EVERY_DAYS
 * Anything left over is due again on the next call.
 */
import { CallType } from './sarvam';
import { cleanMedicineNameForSpeech } from './scheduleGenerator';

/** Call types that are not one of the parent's daily slots: never retried, and no "lives alone" check when unanswered. */
export const NON_RETRY_SLOTS = ['companion', 'followup', 'callback', 'test', 'manual'];

export const MAX_EXTRAS = 2;
export const WELLBEING_EVERY_DAYS = 3;
export const REFILL_EVERY_DAYS = 7;
export const SAFETY_LINE_EVERY_DAYS = 7;
export const LAST_NOTE_MAX_AGE_DAYS = 7;

export interface CallExtras {
  askConsent: boolean;
  saySafetyLine: boolean;
  lastCallNote: string | null;
  askWellbeing: boolean;
  refillMedicines: string[];
  specialDay: string | null;
}

export const NO_EXTRAS: CallExtras = {
  askConsent: false,
  saySafetyLine: false,
  lastCallNote: null,
  askWellbeing: false,
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
}): CallExtras {
  const { callType, rhythm, now } = input;
  const extras: CallExtras = { ...NO_EXTRAS, refillMedicines: [] };
  extras.askConsent = needsConsent(rhythm.parentConsent);

  // A birthday wish on the first call the parent answers that day.
  if (rhythm.birthDate && rhythm.birthDate === istMonthDay(now) && !input.answeredToday) extras.specialDay = 'birthday';

  // Follow-ups are about one or two tablets only; nothing else rides along.
  if (callType === 'followup') return extras;

  let slots = MAX_EXTRAS;
  const note = lastCallNote(input.lastAnswered, now);
  if (note && slots > 0) {
    extras.lastCallNote = note;
    slots -= 1;
  }
  if (slots > 0 && olderThan(rhythm.lastWellbeingAt, WELLBEING_EVERY_DAYS, now)) {
    extras.askWellbeing = true;
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
  asked?: CallExtras;
  /** Follow-up calls: the call whose "later" answer they follow up. */
  followUpOf?: string;
}

export function readSnapshot(resultJson: string | null): CallSnapshot {
  if (!resultJson) return { medicines: [] };
  try {
    const parsed = JSON.parse(resultJson);
    return {
      medicines: Array.isArray(parsed?.medicines) ? parsed.medicines : [],
      callType: parsed?.callType,
      asked: parsed?.asked,
      followUpOf: parsed?.followUpOf
    };
  } catch {
    return { medicines: [] };
  }
}
