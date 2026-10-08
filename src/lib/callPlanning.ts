/**
 * What each Saathi call should include besides the medicine questions.
 * Pure functions: the dispatcher loads the data and stores the decision in the
 * CallLog snapshot, so the webhook knows what was asked.
 *
 * Calls stay short (billed per started minute). On the first call the parent answers each day Saathi asks
 * "How are you feeling today?" (ask_feeling). Besides the consent question on a first call, at most MAX_EXTRAS
 * of these ride along, most useful first:
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
}): CallExtras {
  const { callType, rhythm, now, family } = input;
  const extras: CallExtras = { ...NO_EXTRAS, refillMedicines: [] };
  extras.askConsent = needsConsent(rhythm.parentConsent);

  // A greeting (birthday, a festival they celebrate, a family-added day) on the first call the parent answers that day.
  if (!input.answeredToday) {
    if (family?.specialDay) extras.specialDay = family.specialDay;
    else if (rhythm.birthDate && rhythm.birthDate === istMonthDay(now)) extras.specialDay = 'birthday';
  }

  if (family) {
    extras.hearingMode = family.hearingMode;
    // Messages from the family go on any call: they are why the family opened the app.
    const msgs = family.messages.slice(0, MAX_MESSAGES_PER_CALL);
    if (msgs.length) {
      extras.familyMessage = msgs.map(m => `From ${m.authorName}: ${m.text.replace(/\s+/g, ' ').trim()}`).join(' ');
      extras.familyMessageIds = msgs.map(m => m.id);
    }
  }

  // Follow-ups are about one or two tablets only; nothing else rides along.
  if (callType === 'followup') return extras;

  // "How are you feeling today?" once a day, on the first call they answer.
  if (!input.answeredToday) extras.askFeeling = true;

  if (family) {
    const appt = planAppointments(family.appointments, now);
    if (appt.note) {
      extras.appointmentNote = appt.note;
      extras.appointmentReminded = appt.reminded;
    }
    if (appt.followUp) {
      extras.appointmentQuestion = appt.followUp.question;
      extras.appointmentFollowUpId = appt.followUp.id;
    }
    if (callType !== 'companion') {
      const due = family.readingsToAsk.filter(k => !family.readingsTakenToday.includes(k));
      if (due.length) extras.askReadings = due;
    }
    if (family.weatherNote) extras.weatherNote = family.weatherNote;
    const weekday = new Date(now.getTime() + 5.5 * 3600000).getUTCDay();
    if (family.helper.name && family.helper.days.includes(weekday) && family.helper.lastCallOfDay && !family.helper.askedToday) {
      extras.helperQuestion = `Did ${family.helper.name} come today?`;
      extras.helperName = family.helper.name;
    }
  }

  // Cost control: Sarvam bills every started minute, so the optional extras ride only on the first call the
  // parent answers each day; later calls stay a short medicine check (family messages, readings and appointments above still go).
  let slots = input.answeredToday ? 0 : MAX_EXTRAS;
  const note = lastCallNote(input.lastAnswered, now);
  if (note && slots > 0) {
    extras.lastCallNote = note;
    slots -= 1;
  }
  // One wellbeing question a day, in turn, on the first answered call.
  if (slots > 0 && !input.answeredToday) {
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
      asked: parsed?.asked,
      followUpOf: parsed?.followUpOf,
      partner: parsed?.partner && typeof parsed.partner.parentId === 'string' ? parsed.partner : undefined
    };
  } catch {
    return { medicines: [] };
  }
}
