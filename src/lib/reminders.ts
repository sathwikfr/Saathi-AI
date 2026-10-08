/**
 * Remind plan (₹149; internal plan id `essential`): WhatsApp medicine checks, no calls. Decided with the user 2026-10-04.
 *
 * At each medicine time the person gets "did you take your 8:00 AM medicine: …?" with **Yes, taken** / **Not yet**.
 * "Not yet" or no reply: asked again ASK_GAP_MINUTES later, MAX_ASKS times in all. Still no "Yes" ASK_GAP_MINUTES
 * after the last ask: the dose counts as missed and the **caretaker** (husband, parent, …) gets a WhatsApp to call,
 * at most CARETAKER_ALERTS_PER_DAY times a day. A late "Yes" tells the caretaker it was taken after all.
 * Replies with emergency or pregnancy warning words get a "call 108 / 112" reply and the caretaker is told at once.
 *
 * No spam (the user's rule, 2026-10-05): we only write when it is needed. No "this number only…" replies to other
 * messages, and repeated symptom / emergency messages within the gap get no second reply or alert.
 *
 * Everyone opts in themselves by sending "START <code>" to our number (wa.me links from onboarding / the dashboard):
 * the person with their code, the caretaker with theirs. That message also opens WhatsApp's 24-hour window, so our
 * replies can be free text. STOP ends the messages to that number, START turns them back on. Messages only ever go to
 * the number that sent the code, and a used code is replaced.
 *
 * Safe to run every few minutes and to run twice: each (person, reminder time, day) is claimed once (unique index),
 * every ask is claimed by its count, and each message has its own (kind, refKey) row.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { newId, newReminderStartCode, cleanTabletCount } from './db';
import { getEffectivePlan, reminderChannelFor } from './plans';
import { PlanId, LinkedMedicineDetail, FoodRelation, ReminderView, ReminderAnswer } from './types';
import { istDateString, istMinutesOfDay, isSlotDue, parseClockTime, formatIstClock } from './ist';
import { medicineMaps, medicineIsCurrent, slotMedicines } from './callDispatch';
import {
  WhatsAppConfig,
  getWhatsAppConfig,
  sendTemplate,
  sendText,
  renderTemplate,
  WHATSAPP_TEMPLATES,
  WA_PAYLOAD
} from './whatsapp';
import { scanMessage, scanSymptomMessage } from './safety';
import { recordAlert } from './alerts';
import { notifyFamily, NotifyDeps } from './familyNotify';

/** A reminder time is sent if it passed within this many minutes (cron runs every ~5). */
export const REMINDER_DUE_WINDOW_MINUTES = 60;
/** Minutes between asks ("Not yet" or no reply). */
export const ASK_GAP_MINUTES = 30;
/** Asks per dose before the caretaker is told. */
export const MAX_ASKS = 3;
/** "Please call" messages to the caretaker per person per day (emergencies are never capped). */
export const CARETAKER_ALERTS_PER_DAY = 2;
/** Reminder times a day when the plan doesn't set it (a calling plan with someone switched to WhatsApp). */
export const DEFAULT_REMINDERS_PER_DAY = 4;
/** Words that may mean an emergency: one warm reply and one caretaker alert, then quiet for this many hours. */
export const EMERGENCY_REPLY_GAP_HOURS = 6;
export const REMINDER_EMERGENCY_TITLE = 'Possible emergency in a WhatsApp reply';
export const REMINDER_MISSED_TITLE = 'Medicine not confirmed';
export const REMINDER_UNWELL_TITLE = 'Not feeling well (WhatsApp reply)';
/** Fever, headache, dizziness, …: the caretaker is told at once, then at most once per this many hours (more messages just get the reply). */
export const UNWELL_ALERT_GAP_HOURS = 2;
/** "Running low" note once this many days of tablets (or fewer) are left; once per refill. */
export const REFILL_WARN_DAYS = 3;

export type { ReminderAnswer, ReminderView } from './types';

const MINUTE = 60000;

// ---------------------------------------------------------------------------
// Pure helpers (tested in scripts/test-whatsapp-reminders.ts)
// ---------------------------------------------------------------------------

const FOOD_TEXT: Record<FoodRelation, string> = {
  before_food: 'before food',
  after_food: 'after food',
  with_food: 'with food',
  not_specified: ''
};

/** "08:30 AM" -> "8:30 AM". */
export function displayTime(slotTime: string): string {
  return slotTime.trim().replace(/^0(\d)/, '$1');
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim() || 'there';
}

/** "+919876543210" -> "+91 98765 43210" (other numbers as given). */
export function prettyPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : e164;
}

/** "Folic acid (1 tablet after breakfast), Iron (after food)", or "your medicines" in discreet mode. */
export function reminderMedicineText(meds: Pick<LinkedMedicineDetail, 'name' | 'dosage' | 'foodRelation'>[], discreet: boolean): string {
  if (discreet || meds.length === 0) return 'your medicines';
  return meds
    .map(m => {
      const detail = m.dosage?.trim() || FOOD_TEXT[m.foodRelation || 'not_specified'];
      return detail ? `${m.name} (${detail})` : m.name;
    })
    .join(', ');
}

/** The three template parameters: first name, the reminder time, the medicines. */
export function reminderParams(personName: string, slotTime: string, meds: Pick<LinkedMedicineDetail, 'name' | 'dosage' | 'foodRelation'>[], discreet: boolean): string[] {
  return [firstName(personName), displayTime(slotTime), reminderMedicineText(meds, discreet)];
}

/** "8:00 AM, 2:00 PM and 9:00 PM". */
export function listTimes(times: string[]): string {
  const t = times.map(displayTime);
  if (t.length <= 1) return t[0] || '';
  return `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`;
}

/** Medicine names for the caretaker ("" in discreet mode). Names only, no doses. */
function namesForCaretaker(meds: Pick<LinkedMedicineDetail, 'name'>[], discreet: boolean): string {
  return discreet || meds.length === 0 ? '' : ` (${meds.map(m => m.name).join(', ')})`;
}

/** What the caretaker reads. Names, never pronouns: we don't know how the person is addressed. */
export const CARETAKER_TEXT = {
  missed: (name: string, slotTime: string, meds: Pick<LinkedMedicineDetail, 'name'>[], discreet: boolean, phone: string, nthToday: number) =>
    `${firstName(name)} has not confirmed the ${displayTime(slotTime)} medicines${namesForCaretaker(meds, discreet)} after ${MAX_ASKS} reminders. ` +
    `You may want to call ${firstName(name)} on ${prettyPhone(phone)}.` +
    (nthToday >= CARETAKER_ALERTS_PER_DAY ? ' This is the second dose not confirmed today, so we will not send more of these today.' : ''),
  takenLate: (name: string, slotTime: string, at: string) =>
    `Good news: ${firstName(name)} has now confirmed the ${displayTime(slotTime)} medicines (at ${at}).`,
  emergency: (name: string, words: string, phone: string) =>
    `${firstName(name)} wrote: "${words}". This may be urgent. Please call ${firstName(name)} now on ${prettyPhone(phone)}. ` +
    `We have asked ${firstName(name)} to call 108 if help is needed right away.`,
  unwell: (name: string, words: string, phone: string) =>
    `${firstName(name)} may not be feeling well and wrote: "${words}". You may want to call ${firstName(name)} on ${prettyPhone(phone)}.`
} as const;

export const REMINDER_REPLIES = {
  started: (name: string, times: string[], caretaker: string | null) =>
    `You're all set, ${firstName(name)}.${times.length ? ` At ${listTimes(times)} I'll ask whether you've taken your medicines.` : ''} ` +
    `Tap Yes once you have.${caretaker ? ` If a dose isn't confirmed after ${MAX_ASKS} reminders, I'll let ${firstName(caretaker)} know.` : ''} ` +
    'Reply STOP any time to stop.',
  badCode: 'That code did not match. Please use the WhatsApp link from the Aaptha dashboard.',
  restarted: 'Your medicine checks are back on. Reply STOP any time to stop them.',
  alreadyOn: 'Your medicine checks are already on. Reply STOP any time to stop them.',
  stopped: 'Your medicine checks are stopped. Send START any time to turn them back on.',
  taken: (at: string) => `Noted: taken at ${at}. ✓`,
  courseDone: 'That was the last dose of your course, so the medicine checks stop here. Wishing you good health!',
  notYet: (at: string) => `OK, I'll ask again at ${at}.`,
  notYetLast: (at: string, caretaker: string | null) =>
    `OK. Tap Yes once you've taken it.${caretaker ? ` If it isn't confirmed by ${at}, I'll let ${firstName(caretaker)} know.` : ''}`,
  afterMissed: 'OK. Tap Yes once you have taken it.',
  pausedToday: (firstTomorrow: string | null) =>
    `OK, no more medicine checks today. They start again tomorrow${firstTomorrow ? ` at ${displayTime(firstTomorrow)}` : ''}.`,
  alreadyTaken: 'This one is already marked as taken. ✓',
  /** Added under "Noted" when tablets are running low (once per refill). */
  runningLow: (items: { name: string; left: number; days: number }[]) =>
    items.map(i => i.left <= 0
      ? `By my count your ${i.name} tablets have run out.`
      : `${i.name} is running low: ${i.left} tablet${i.left === 1 ? '' : 's'} left, about ${i.days} day${i.days === 1 ? '' : 's'}.`).join(' ') +
    ` Once you buy more, reply with the name and number, like "${items[0].name} 30".`,
  toppedUp: (name: string, count: number) => `Got it: ${count} ${name} tablet${count === 1 ? '' : 's'}. I'll tell you when they're running low.`,
  whichMedicine: (example: string) => `Which medicine is that? Reply with the name and number, like "${example} 30".`,
  /** One warm message, once (EMERGENCY_REPLY_GAP_HOURS). 108 stays in it: we can't send help ourselves. */
  emergency: (name: string, caretaker: string | null) =>
    `${firstName(name)}, please take care.${caretaker ? ` I've let ${firstName(caretaker)} know right away.` : ''} ` +
    'If you need help urgently, please call 108 for an ambulance, or ask someone near you.',
  unwell: (caretaker: string | null) =>
    `Sorry you're not feeling well.${caretaker ? ` I've let ${firstName(caretaker)} know.` : ''} I can't give medical advice: please rest, ` +
    'and if it gets worse, see a doctor. In an emergency call 108.',
  // To the caretaker
  caretakerStarted: (caretaker: string, name: string) =>
    `Thank you, ${firstName(caretaker)}. If ${firstName(name)} doesn't confirm a medicine dose after ${MAX_ASKS} reminders, I'll message you here so you can call. ` +
    'Reply STOP any time to stop these messages.',
  caretakerStopped: (name: string) => `You won't get ${firstName(name)}'s medicine updates any more. Send START to turn them back on.`,
  caretakerRestarted: (name: string) => `You'll get ${firstName(name)}'s medicine updates again. Reply STOP any time to stop them.`
} as const;

// Codes are 8 characters from newReminderStartCode()'s alphabet (no 0/O, 1/I/L), so "start please" never matches.
const START_RE = /^start\s+([a-hj-km-np-z2-9]{8})$/i;
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'stop all']);
const START_WORDS = new Set(['start', 'subscribe', 'unstop']);

/** "START AB12CD34" -> "AB12CD34" (null for anything else). */
export function parseStartCode(text: string): string | null {
  const m = START_RE.exec(text.trim());
  return m ? m[1].toUpperCase() : null;
}

/**
 * Typed answers count like the buttons (2026-10-05): many people type "yes" / "haan" instead of tapping.
 * Only a whole-message answer, or one followed by a comma / full stop ("no, I have fever"), counts;
 * "no fever" is not an answer.
 */
const YES_ANSWERS = [
  'yes', 'yes taken', 'yes done', 'yes i took it', 'yes i have', 'yeah', 'yep', 'yup', 'ya', 'yaa', 'taken', 'took it', 'i took it',
  'i have taken', 'i have taken it', 'done', 'ok done', 'okay done', 'had it', 'i had it', 'already taken', 'already took it',
  // Hindi
  'haan', 'han', 'ha', 'haa', 'haan ji', 'ha ji', 'ji haan', 'ji', 'le liya', 'le li', 'haan le liya', 'haan le li', 'kha liya', 'kha li',
  'le liya hai', 'le li hai', 'kha li hai', 'हाँ', 'हां', 'जी हाँ', 'ले ली', 'ले लिया', 'खा ली', 'खा लिया',
  // Telugu
  'avunu', 'aunu', 'avnu', 'vesukunna', 'vesukunnanu', 'veskunna', 'tesukunna', 'teesukunna', 'tisukunna', 'avunu vesukunna',
  'అవును', 'వేసుకున్నా', 'వేసుకున్నాను', 'తీసుకున్నా', 'తీసుకున్నాను',
  // Tamil / Kannada / Bengali / Marathi / Gujarati / Malayalam
  'aama', 'aamaa', 'ama', 'saapten', 'ஆமா', 'ஆம்', 'சாப்பிட்டேன்', 'haudu', 'ಹೌದು', 'ತೆಗೆದುಕೊಂಡೆ', 'hyan', 'kheyechi', 'হ্যাঁ', 'খেয়েছি',
  'hoy', 'ghetli', 'होय', 'घेतली', 'હા', 'લીધી', 'uvvu', 'kazhichu', 'ഉവ്വ്', 'കഴിച്ചു',
  '👍', '✅', '✔️', '✔', '👌'
];
const NOT_YET_ANSWERS = [
  'no', 'nope', 'not yet', 'not taken', 'not taken yet', 'not now', 'later', 'will take', 'will take later', 'will take it later',
  // Hindi
  'nahi', 'nahin', 'nai', 'na', 'naa', 'nahi liya', 'abhi nahi', 'baad mein', 'baad me', 'thodi der mein', 'नहीं', 'अभी नहीं', 'बाद में',
  // Telugu
  'ledu', 'inka ledu', 'inkaa ledu', 'tarvata', 'taruvata', 'లేదు', 'ఇంకా లేదు', 'తర్వాత',
  // Tamil / Kannada / Bengali / Marathi / Gujarati / Malayalam
  'illa', 'illai', 'innum illa', 'apram', 'இல்லை', 'இன்னும் இல்லை', 'அப்புறம்', 'ಇಲ್ಲ', 'ಇನ್ನೂ ಇಲ್ಲ', 'না', 'এখনও না',
  'nahi ajun', 'नाही', 'अजून नाही', 'ના', 'હજી નહીં', 'ഇല്ല', 'ഇതുവരെ ഇല്ല', '👎', '❌'
];
const ANSWER_LIST: { phrase: string; answer: 'yes' | 'not_yet' }[] = [
  ...YES_ANSWERS.map(phrase => ({ phrase, answer: 'yes' as const })),
  ...NOT_YET_ANSWERS.map(phrase => ({ phrase, answer: 'not_yet' as const }))
].sort((a, b) => b.phrase.length - a.phrase.length);

/** "yes" / "haan, le liya" / "👍" -> 'yes'; "no" / "ledu" / "not yet." -> 'not_yet'; anything else -> null. */
export function parseTypedAnswer(text: string): 'yes' | 'not_yet' | null {
  const t = text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const whole = t.replace(/[.!?,;:]+$/g, '').trim();
  for (const { phrase, answer } of ANSWER_LIST) {
    if (whole === phrase) return answer;
  }
  // "no, I have fever" / "yes. thanks" / "👍 thanks": an answer followed by a separator.
  for (const { phrase, answer } of ANSWER_LIST) {
    if (t.startsWith(phrase)) {
      const rest = t.slice(phrase.length);
      if (/^\s*[,.!;:\-–—]/.test(rest) || (/^[^\p{L}\p{N}]/u.test(phrase) && /^\s/.test(rest))) return answer;
    }
  }
  return null;
}

/**
 * "pause today" (2026-10-05): no more checks or calls today; they start again tomorrow by themselves.
 * Whole message, or the phrase followed by a separator or more words ("pause today, travelling").
 */
const PAUSE_TODAY = [
  'pause', 'pause today', 'pause for today', 'skip today', 'not today', 'stop today', 'stop for today', 'no more today',
  'no reminders today', 'no checks today', 'no calls today', "don't call today", 'dont call today', 'do not call today',
  // Hindi / Telugu / Tamil / Kannada / Bengali / Marathi / Gujarati / Malayalam
  'aaj nahi', 'aaj mat', 'aaj band', 'aaj call mat karo', 'आज नहीं', 'आज मत', 'आज बंद',
  'ivala vaddu', 'ivvala vaddu', 'eeroju vaddu', 'ఈరోజు వద్దు', 'ఇవాళ వద్దు',
  'indru vendam', 'inniki vendam', 'இன்று வேண்டாம்', 'ivattu beda', 'ಇವತ್ತು ಬೇಡ',
  'aaj na', 'আজ না', 'aaj nako', 'आज नको', 'aaje nahi', 'આજે નહીં', 'innu venda', 'ഇന്ന് വേണ്ട'
].sort((a, b) => b.length - a.length);

export function parsePauseToday(text: string): boolean {
  const t = text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  const whole = t.replace(/[.!?,;:]+$/g, '').trim();
  return PAUSE_TODAY.some(p => whole === p || (t.startsWith(p) && /^[\s,.!;:\-–—]/.test(t.slice(p.length))));
}

/** Midnight IST at the start of tomorrow: when a "pause today" ends. */
export function tomorrowStartIst(now: Date): Date {
  return new Date(`${istDateString(new Date(now.getTime() + 86400000))}T00:00:00+05:30`);
}

/**
 * Tablets per dose from the dosage text: "2 tablets" -> 2, "1 capsule" -> 1, "5 mg" -> 1 (not a count).
 * Anything odd counts as 1, so the count can only run down slower than real life, never faster.
 */
export function tabletsPerDose(dosage: string | null | undefined): number {
  const m = (dosage || '').match(/(\d+)\s*(?:tab|tabs|tablet|tablets|capsule|capsules|cap|caps|pill|pills|goli|golis)\b/i);
  const n = m ? parseInt(m[1], 10) : 1;
  return n >= 1 && n <= 4 ? n : 1;
}

/** How many reminder times a day include this medicine (the reminders' own lists, case-insensitive). */
export function dosesPerDay(name: string, slots: { linkedMedicineNames: string[] }[]): number {
  const key = name.trim().toLowerCase();
  return slots.filter(s => s.linkedMedicineNames.some(n => n.trim().toLowerCase() === key)).length;
}

const TOPUP_FILLER = new Set(['i', 'bought', 'buy', 'got', 'have', 'now', 'new', 'more', 'tablets', 'tablet', 'tabs', 'tab', 'capsules', 'pills', 'strip', 'of', 'for', 'left', 'total', 'refill', 'refilled', '-', ':', '=']);

/**
 * "Iron 30", "30 iron tablets", "bought 30 Folic acid", or a bare "30" (only when exactly one medicine is counted).
 * Every word must be the number, a medicine name or filler, so "fever 102" or "I took 2" is never a refill.
 * Returns { name: null } for a bare number that could be several medicines.
 */
export function parseTopUp(text: string, medicines: { name: string; counted: boolean }[]): { name: string | null; count: number } | null {
  const t = text.normalize('NFC').toLowerCase().replace(/[.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const nums = t.match(/\b\d{1,3}\b/g);
  if (!nums || nums.length !== 1) return null;
  const count = cleanTabletCount(Number(nums[0]));
  if (count === null || count === 0) return null;
  let rest = ` ${t.replace(/\b\d{1,3}\b/, ' ')} `;
  // Longest names first, so "folic acid" wins over a medicine called "acid".
  const found = [...medicines].sort((a, b) => b.name.length - a.name.length).filter(m => {
    const key = ` ${m.name.trim().toLowerCase()} `;
    if (!rest.includes(key)) return false;
    rest = rest.replace(key, ' ');
    return true;
  });
  if (rest.trim().split(' ').some(w => w && !TOPUP_FILLER.has(w))) return null;
  if (found.length > 1) return null;
  if (found.length === 1) return { name: found[0].name, count };
  const counted = medicines.filter(m => m.counted);
  if (counted.length === 1) return { name: counted[0].name, count };
  return medicines.length === 1 ? { name: medicines[0].name, count } : { name: null, count };
}

/** The person's reminder times for today, earliest first, capped by the plan. */
export function cappedSlots<T extends { time: string }>(slots: T[], cap: number): T[] {
  return [...slots]
    .filter(s => parseClockTime(s.time) !== null)
    .sort((a, b) => (parseClockTime(a.time) as number) - (parseClockTime(b.time) as number))
    .slice(0, cap);
}

/** Midnight IST of `now`'s IST day, as a real Date. */
function istDayStart(now: Date): Date {
  return new Date(`${istDateString(now)}T00:00:00+05:30`);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface ReminderDeps extends NotifyDeps {
  now?: Date;
  /** Limit a run to these people (tests). */
  parentIds?: string[];
}

export interface ReminderSummary {
  configured: boolean;
  peopleChecked: number;
  /** First asks at a reminder time. */
  sent: number;
  /** Second and third asks. */
  asked: number;
  missed: number;
  caretakerAlerts: number;
  failed: number;
}

type ReminderRow = Prisma.MedicineReminderGetPayload<object>;
type PersonRow = {
  id: string;
  name: string;
  isDeleted: boolean;
  isPaused: boolean;
  reminderWhatsapp: string | null;
  reminderOptInAt: Date | null;
  reminderOptOutAt: Date | null;
  discreetReminders: boolean;
  caretakerName: string | null;
  caretakerWhatsapp: string | null;
  caretakerOptInAt: Date | null;
  caretakerOptOutAt: Date | null;
};

function readMedicines(json: string): LinkedMedicineDetail[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Opted in, not stopped, not paused or removed: we may message them. */
function canReceive(p: PersonRow): boolean {
  return !p.isDeleted && !p.isPaused && !!p.reminderOptInAt && !p.reminderOptOutAt && !!p.reminderWhatsapp;
}

/** The caretaker said yes (START) and hasn't said STOP. */
export function caretakerReady(p: Pick<PersonRow, 'caretakerWhatsapp' | 'caretakerOptInAt' | 'caretakerOptOutAt'>): boolean {
  return !!p.caretakerWhatsapp && !!p.caretakerOptInAt && !p.caretakerOptOutAt;
}

/** A WhatsApp row claimed first (unique kind + refKey), then the template sent. */
async function sendClaimedTemplate(
  cfg: WhatsAppConfig,
  row: { kind: string; refKey: string; parentId: string; phone: string; alertId?: string | null },
  template: 'reminder' | 'caretaker' | 'caretakerAlert',
  params: string[],
  deps: ReminderDeps,
  now: Date
): Promise<{ ok: boolean; error?: string }> {
  let msg;
  try {
    msg = await prisma.whatsAppMessage.create({
      data: {
        id: newId('wam'),
        userId: null,
        parentId: row.parentId,
        kind: row.kind,
        refKey: row.refKey,
        phone: row.phone,
        // The caretaker's "I'll handle it" marks this alert handled.
        alertId: row.alertId || null,
        templateName: WHATSAPP_TEMPLATES[template].name,
        body: renderTemplate(template, params),
        // The run's clock: the per-day caretaker cap counts these rows.
        createdAt: now
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'already sent' };
    throw err;
  }
  try {
    const { messageId } = await sendTemplate(cfg, row.phone, template, params, deps.fetchImpl);
    await prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { status: 'sent', providerMessageId: messageId } });
    return { ok: true };
  } catch (err) {
    const message = (err instanceof Error ? err.message : 'unknown error').slice(0, 300);
    await prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { status: 'failed', error: message } });
    console.error(`[reminders] WhatsApp ${template} failed:`, message);
    return { ok: false, error: message };
  }
}

/** One "did you take it?" message (ask 1, 2 or 3). */
function sendAsk(cfg: WhatsAppConfig, rem: ReminderRow, person: PersonRow, ask: number, deps: ReminderDeps, now: Date) {
  if (!person.reminderWhatsapp) return Promise.resolve({ ok: false, error: 'no WhatsApp number' });
  const params = reminderParams(person.name, rem.slotTime, readMedicines(rem.medicinesJson), person.discreetReminders);
  return sendClaimedTemplate(cfg, { kind: 'reminder', refKey: `${rem.id}:ask${ask}`, parentId: person.id, phone: person.reminderWhatsapp }, 'reminder', params, deps, now);
}

/**
 * A message to the caretaker. Alerts (missed / unwell / emergency) carry one button, "I'll handle it", tied to the
 * dashboard alert; "taken after all" is a plain update. `missed` is capped per day by the caller.
 * Returns true when it was sent.
 */
async function messageCaretaker(
  cfg: WhatsAppConfig,
  person: PersonRow & { phone?: string },
  kind: 'missed' | 'taken' | 'emergency' | 'unwell',
  refKey: string,
  text: string,
  deps: ReminderDeps,
  now: Date,
  alertId: string | null = null
): Promise<boolean> {
  if (!caretakerReady(person)) return false;
  const res = await sendClaimedTemplate(
    cfg,
    { kind: `caretaker_${kind}`, refKey, parentId: person.id, phone: person.caretakerWhatsapp!, alertId },
    kind === 'taken' ? 'caretaker' : 'caretakerAlert',
    [firstName(person.name), text],
    deps,
    now
  );
  return res.ok;
}

/** The dashboard alert says who was asked to call, once the caretaker's message went out. */
async function noteCaretakerAsked(alertId: string | undefined, person: { caretakerName: string | null }) {
  if (!alertId) return;
  const a = await prisma.alertRecord.findUnique({ where: { id: alertId }, select: { message: true } });
  if (a) await prisma.alertRecord.update({ where: { id: alertId }, data: { message: `${a.message} ${firstName(person.caretakerName || 'The caretaker')} was asked to call.` } });
}

/** Caretaker "please call" alerts already sent to this person's caretaker today (IST). */
function caretakerAlertsToday(parentId: string, now: Date): Promise<number> {
  return prisma.whatsAppMessage.count({ where: { parentId, kind: 'caretaker_missed', createdAt: { gte: istDayStart(now) } } });
}

/** Sends due medicine checks and repeat asks, and closes unconfirmed doses (telling the caretaker). */
export async function runReminders(deps: ReminderDeps = {}): Promise<ReminderSummary> {
  const now = deps.now || new Date();
  const cfg = deps.whatsapp !== undefined ? deps.whatsapp : getWhatsAppConfig();
  const summary: ReminderSummary = { configured: !!cfg, peopleChecked: 0, sent: 0, asked: 0, missed: 0, caretakerAlerts: 0, failed: 0 };
  if (!cfg) return summary;

  const today = istDateString(now);
  const scope = deps.parentIds ? { parentId: { in: deps.parentIds } } : {};
  const open = { status: 'sent', OR: [{ answer: null }, { answer: 'not_yet' }] };

  // 1. Asked MAX_ASKS times and still no "Yes" ASK_GAP_MINUTES later: missed. Dashboard alert, caretaker told (capped).
  const toClose = await prisma.medicineReminder.findMany({
    where: { ...scope, ...open, askCount: { gte: MAX_ASKS }, nextAskAt: { lte: now } },
    include: { parent: true },
    take: 200
  });
  for (const rem of toClose) {
    const claimed = await prisma.medicineReminder.updateMany({
      where: { id: rem.id, OR: [{ answer: null }, { answer: 'not_yet' }] },
      data: { answer: 'missed', nextAskAt: null }
    });
    if (claimed.count !== 1) continue;
    summary.missed += 1;
    const person = rem.parent;
    if (person.isDeleted) continue;
    const rec = await recordAlert({
      parentId: person.id,
      callLogId: null,
      level: 2,
      title: REMINDER_MISSED_TITLE,
      message: `${person.name} didn't confirm the ${displayTime(rem.slotTime)} medicines after ${MAX_ASKS} WhatsApp reminders.`
    });
    if (caretakerReady(person) && !person.isPaused && (await caretakerAlertsToday(person.id, now)) < CARETAKER_ALERTS_PER_DAY) {
      const nth = (await caretakerAlertsToday(person.id, now)) + 1;
      const text = CARETAKER_TEXT.missed(person.name, rem.slotTime, readMedicines(rem.medicinesJson), person.discreetReminders, person.reminderWhatsapp || person.phone, nth);
      if (await messageCaretaker(cfg, person, 'missed', rem.id, text, deps, now, rec.alertId || null)) {
        summary.caretakerAlerts += 1;
        await prisma.medicineReminder.update({ where: { id: rem.id }, data: { caretakerAlertedAt: now } });
        await noteCaretakerAsked(rec.alertId, person);
      }
    }
  }

  // 2. "Not yet" or no reply: ask again (asks 2 and 3).
  const toAsk = await prisma.medicineReminder.findMany({
    where: { ...scope, ...open, askCount: { gte: 1, lt: MAX_ASKS }, nextAskAt: { lte: now } },
    include: { parent: true },
    take: 200
  });
  for (const rem of toAsk) {
    const ask = rem.askCount + 1;
    const claimed = await prisma.medicineReminder.updateMany({
      where: { id: rem.id, askCount: rem.askCount, OR: [{ answer: null }, { answer: 'not_yet' }] },
      data: { askCount: ask, nextAskAt: new Date(now.getTime() + ASK_GAP_MINUTES * MINUTE) }
    });
    if (claimed.count !== 1 || !canReceive(rem.parent)) continue;
    const res = await sendAsk(cfg, rem, rem.parent, ask, deps, now);
    if (res.ok) summary.asked += 1;
    else summary.failed += 1;
  }

  // 3. Reminder times that are due now: the first ask.
  const people = await prisma.parentProfile.findMany({
    where: {
      ...(deps.parentIds ? { id: { in: deps.parentIds } } : {}),
      isDeleted: false,
      reminderOptInAt: { not: null },
      reminderOptOutAt: null,
      reminderWhatsapp: { not: null }
    },
    include: { callSchedule: { where: { isActive: true } }, medicines: true, user: { include: { subscription: true } } }
  });

  for (const p of people) {
    summary.peopleChecked += 1;
    try {
      const sub = p.user.subscription;
      const plan = getEffectivePlan(
        sub ? { planId: sub.planId as PlanId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString() } : null,
        p.user.createdAt,
        now
      );
      if (plan.expired || reminderChannelFor(plan, p) !== 'whatsapp') continue;

      if (p.isPaused) {
        // Same rule as calls: a pause with an end date ends by itself.
        if (p.pauseUntil && p.pauseUntil.getTime() <= now.getTime()) {
          await prisma.parentProfile.update({ where: { id: p.id }, data: { isPaused: false, pauseReason: null, pauseUntil: null } });
          p.isPaused = false;
        } else {
          continue;
        }
      }

      const { inactiveNames, purposes } = medicineMaps(p.medicines, today);
      const optInToday = p.reminderOptInAt && istDateString(p.reminderOptInAt) === today;
      const optInMinutes = p.reminderOptInAt ? istMinutesOfDay(p.reminderOptInAt) : 0;

      for (const slot of cappedSlots(p.callSchedule, plan.remindersPerDay || DEFAULT_REMINDERS_PER_DAY)) {
        if (!isSlotDue(slot.time, now, REMINDER_DUE_WINDOW_MINUTES)) continue;
        // Started their checks after this time today: begin with the next one.
        if (optInToday && (parseClockTime(slot.time) as number) < optInMinutes) continue;
        const meds = slotMedicines(slot, inactiveNames, purposes);
        if (meds.length === 0) continue; // nothing current at this time (course over, or switched off)

        // The cheap check keeps the unique index (the real guard against double sends) out of the error log.
        const exists = await prisma.medicineReminder.findUnique({
          where: { parentId_slotId_reminderDate: { parentId: p.id, slotId: slot.id, reminderDate: today } },
          select: { id: true }
        });
        if (exists) continue;
        let rem: ReminderRow;
        try {
          rem = await prisma.medicineReminder.create({
            data: {
              id: newId('rem'),
              parentId: p.id,
              slotId: slot.id,
              slotTime: slot.time,
              reminderDate: today,
              medicinesJson: JSON.stringify(meds.map(m => ({ name: m.name, dosage: m.dosage, foodRelation: m.foodRelation }))),
              askCount: 1,
              nextAskAt: new Date(now.getTime() + ASK_GAP_MINUTES * MINUTE)
            }
          });
        } catch (err) {
          if (isUniqueViolation(err)) continue; // already sent today
          throw err;
        }
        const res = await sendAsk(cfg, rem, p, 1, deps, now);
        await prisma.medicineReminder.update({
          where: { id: rem.id },
          data: res.ok ? { status: 'sent', sentAt: now } : { status: 'failed', failureReason: res.error || 'not sent', nextAskAt: null }
        });
        if (res.ok) summary.sent += 1;
        else summary.failed += 1;
      }
    } catch (err) {
      console.error(`[reminders] Person ${p.id} failed:`, err);
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Replies (from the person, or from their caretaker)
// ---------------------------------------------------------------------------

export interface ReminderInbound {
  /** Our row for the inbound message (WhatsAppMessage.id). */
  inboundId: string;
  phone: string;
  type: string;
  text: string;
  payload: string;
  /** The message a button was tapped on (Meta's context.id). */
  contextId: string;
}

async function replyTo(cfg: WhatsAppConfig | null, inbound: ReminderInbound, parentId: string | null, text: string, deps: ReminderDeps, kind = 'reminder_reply'): Promise<number> {
  if (!cfg) return 0;
  let row;
  try {
    row = await prisma.whatsAppMessage.create({
      // createdAt follows the run's clock, so the 12-hour auto-reply gap also holds under a test clock.
      data: { id: newId('wam'), userId: null, parentId, kind, refKey: `reply:${inbound.inboundId}`, phone: inbound.phone, body: text, createdAt: deps.now || new Date() }
    });
  } catch (err) {
    if (isUniqueViolation(err)) return 0;
    throw err;
  }
  try {
    const { messageId } = await sendText(cfg, inbound.phone, text, deps.fetchImpl);
    await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'sent', providerMessageId: messageId } });
    return 1;
  } catch (err) {
    const message = (err instanceof Error ? err.message : 'unknown error').slice(0, 300);
    await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'failed', error: message } });
    console.error('[reminders] Reply failed:', message);
    return 0;
  }
}

/** Today's remaining reminder times after `now`. */
function nextTimeToday(slots: { time: string }[], now: Date): string | null {
  const nowMin = istMinutesOfDay(now);
  const next = cappedSlots(slots, 24).find(s => (parseClockTime(s.time) as number) > nowMin);
  return next ? displayTime(next.time) : null;
}

/** True when the last medicine course ends today and nothing is left for tomorrow. */
function courseEndsNow(medicines: { isActive: boolean; endsOn: string | null }[], now: Date): boolean {
  const today = istDateString(now);
  const tomorrow = istDateString(new Date(now.getTime() + 86400000));
  const endsToday = medicines.some(m => m.isActive && m.endsOn === today);
  return endsToday && !medicines.some(m => medicineIsCurrent(m, tomorrow));
}

async function planFor(userId: string, now: Date) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { subscription: true } });
  const sub = user?.subscription;
  return getEffectivePlan(
    sub ? { planId: sub.planId as PlanId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString() } : null,
    user?.createdAt,
    now
  );
}

/** STOP means nothing more to this number: family updates for an account on the same number stop too. */
async function stopFamilyUpdates(phone: string) {
  await prisma.notificationPreferences.updateMany({
    where: { OR: [{ whatsappNumber: phone }, { user: { phone } }] },
    data: { whatsapp: false, whatsappOptInAt: null, whatsappVerifiedAt: null }
  });
}

/**
 * A WhatsApp message from someone in a medicine-check conversation (the person, their caretaker, or a START code).
 * Returns the number of replies sent, or null when this number isn't one of ours
 * (the caller then carries on with the family / parent handling).
 */
export async function handleReminderInbound(input: ReminderInbound, cfg: WhatsAppConfig | null, deps: ReminderDeps = {}): Promise<number | null> {
  const now = deps.now || new Date();
  const word = input.text.toLowerCase().replace(/[.!]+$/, '').trim();

  // ---- "START <code>" from a wa.me link: the person's or the caretaker's own opt-in.
  const code = input.type === 'text' ? parseStartCode(input.text) : null;
  if (code) {
    const person = await prisma.parentProfile.findFirst({
      where: { reminderStartCode: code, isDeleted: false },
      include: { callSchedule: { where: { isActive: true } } }
    });
    if (person) {
      await prisma.parentProfile.update({
        where: { id: person.id },
        // A used code is replaced, so a forwarded or leaked link can't move the messages to another phone later.
        data: { reminderWhatsapp: input.phone, reminderOptInAt: now, reminderOptOutAt: null, reminderStartCode: newReminderStartCode() }
      });
      await prisma.whatsAppMessage.update({ where: { id: input.inboundId }, data: { parentId: person.id } });
      const plan = await planFor(person.userId, now);
      const times = cappedSlots(person.callSchedule, plan.remindersPerDay || DEFAULT_REMINDERS_PER_DAY).map(s => s.time);
      return replyTo(cfg, input, person.id, REMINDER_REPLIES.started(person.name, times, caretakerReady(person) ? person.caretakerName : null), deps);
    }
    const caredFor = await prisma.parentProfile.findFirst({ where: { caretakerStartCode: code, isDeleted: false } });
    if (caredFor) {
      await prisma.parentProfile.update({
        where: { id: caredFor.id },
        data: { caretakerWhatsapp: input.phone, caretakerOptInAt: now, caretakerOptOutAt: null, caretakerStartCode: newReminderStartCode() }
      });
      await prisma.whatsAppMessage.update({ where: { id: input.inboundId }, data: { parentId: caredFor.id } });
      return replyTo(cfg, input, caredFor.id, REMINDER_REPLIES.caretakerStarted(caredFor.caretakerName || 'there', caredFor.name), deps);
    }
    return replyTo(cfg, input, null, REMINDER_REPLIES.badCode, deps);
  }

  // Family buttons on call alerts are not ours.
  if (input.payload === WA_PAYLOAD.ack || input.payload === WA_PAYLOAD.recall) return null;

  const person = await prisma.parentProfile.findFirst({
    where: { reminderWhatsapp: input.phone, isDeleted: false, reminderOptInAt: { not: null } },
    include: { callSchedule: { where: { isActive: true } }, medicines: true, user: { include: { notificationPreferences: true } } },
    orderBy: { createdAt: 'asc' }
  });
  const plan = person ? await planFor(person.userId, now) : null;

  if (person && plan && reminderChannelFor(plan, person) === 'whatsapp') {
    await prisma.whatsAppMessage.update({ where: { id: input.inboundId }, data: { parentId: person.id } });
    return personMessage(person, input, cfg, deps, now, word);
  }

  // ---- The caretaker writing back: "I'll handle it", STOP / START. Nothing else gets a reply.
  const caredFor = await prisma.parentProfile.findFirst({
    where: { caretakerWhatsapp: input.phone, isDeleted: false, caretakerOptInAt: { not: null } },
    orderBy: { createdAt: 'asc' }
  });
  if (!caredFor) return null;
  await prisma.whatsAppMessage.update({ where: { id: input.inboundId }, data: { parentId: caredFor.id } });
  // "I'll handle it": the alert on the dashboard is marked handled by the caretaker. No reply (only when needed).
  if (input.payload === WA_PAYLOAD.careAck) {
    const original = input.contextId ? await prisma.whatsAppMessage.findUnique({ where: { providerMessageId: input.contextId } }) : null;
    if (!original || original.direction !== 'out' || !original.kind.startsWith('caretaker_') || original.phone !== input.phone || original.parentId !== caredFor.id || !original.alertId) return 0;
    await prisma.alertRecord.updateMany({
      where: { id: original.alertId, parentId: caredFor.id, acknowledgedAt: null },
      data: { acknowledgedAt: now, status: 'resolved', handledByName: caredFor.caretakerName || 'Caretaker', handledVia: 'whatsapp' }
    });
    return 0;
  }
  if (STOP_WORDS.has(word)) {
    await prisma.parentProfile.update({ where: { id: caredFor.id }, data: { caretakerOptOutAt: now } });
    await stopFamilyUpdates(input.phone);
    return replyTo(cfg, input, caredFor.id, REMINDER_REPLIES.caretakerStopped(caredFor.name), deps);
  }
  if (START_WORDS.has(word)) {
    await prisma.parentProfile.update({ where: { id: caredFor.id }, data: { caretakerOptOutAt: null, caretakerOptInAt: now } });
    return replyTo(cfg, input, caredFor.id, REMINDER_REPLIES.caretakerRestarted(caredFor.name), deps);
  }
  return 0;
}

type InboundPerson = PersonRow & {
  userId: string;
  phone: string;
  callSchedule: { time: string; linkedMedicineNames: string[] }[];
  medicines: { id: string; name: string; dosage: string; isActive: boolean; endsOn: string | null; tabletsLeft: number | null; refillNotifiedAt: Date | null }[];
  user: { phone: string | null; notificationPreferences: { whatsappNumber: string | null } | null };
};

/** Records Yes / Not yet on one check and returns the reply (shared by the buttons and typed answers). */
async function answerCheck(cfg: WhatsAppConfig | null, person: InboundPerson, rem: ReminderRow, yes: boolean, deps: ReminderDeps, now: Date): Promise<string> {
  const caretaker = caretakerReady(person) ? person.caretakerName : null;
  if (yes) {
    if (rem.answer === 'taken') return REMINDER_REPLIES.alreadyTaken;
    await prisma.medicineReminder.update({ where: { id: rem.id }, data: { answer: 'taken', answeredAt: now, nextAskAt: null } });
    // Told the caretaker it was missed? Tell them it's been taken after all.
    if (rem.caretakerAlertedAt && cfg) {
      await messageCaretaker(cfg, person, 'taken', rem.id, CARETAKER_TEXT.takenLate(person.name, rem.slotTime, displayTime(formatIstClock(now))), deps, now);
    }
    const done = courseEndsNow(person.medicines, now) && !nextTimeToday(person.callSchedule, now);
    const low = done ? [] : await countTablets(person, rem, now);
    return `${REMINDER_REPLIES.taken(displayTime(formatIstClock(now)))}${done ? `\n\n${REMINDER_REPLIES.courseDone}` : ''}` +
      `${low.length ? `\n\n${REMINDER_REPLIES.runningLow(low)}` : ''}`;
  }
  if (rem.answer === 'taken') return REMINDER_REPLIES.alreadyTaken;
  if (rem.answer === 'missed') return REMINDER_REPLIES.afterMissed;
  const next = new Date(now.getTime() + ASK_GAP_MINUTES * MINUTE);
  await prisma.medicineReminder.update({ where: { id: rem.id }, data: { answer: 'not_yet', nextAskAt: next } });
  const at = displayTime(formatIstClock(next));
  return rem.askCount >= MAX_ASKS ? REMINDER_REPLIES.notYetLast(at, caretaker) : REMINDER_REPLIES.notYet(at);
}

/**
 * A "Yes" uses up one dose of each counted medicine in that check. When REFILL_WARN_DAYS or fewer days are left
 * (and the course doesn't end before then) the "Noted" reply carries one "running low" line, once per refill.
 */
async function countTablets(person: InboundPerson, rem: ReminderRow, now: Date): Promise<{ name: string; left: number; days: number }[]> {
  const inCheck = new Set(readMedicines(rem.medicinesJson).map(m => m.name.trim().toLowerCase()));
  const low: { name: string; left: number; days: number }[] = [];
  for (const med of person.medicines) {
    if (!med.isActive || med.tabletsLeft === null || !inCheck.has(med.name.trim().toLowerCase())) continue;
    const per = tabletsPerDose(med.dosage);
    const left = Math.max(0, med.tabletsLeft - per);
    const perDay = Math.max(1, dosesPerDay(med.name, person.callSchedule)) * per;
    const days = Math.floor(left / perDay);
    const lastDay = istDateString(new Date(now.getTime() + days * 86400000));
    const warn = !med.refillNotifiedAt && days <= REFILL_WARN_DAYS && !(med.endsOn && med.endsOn <= lastDay);
    await prisma.medicine.update({ where: { id: med.id }, data: { tabletsLeft: left, ...(warn ? { refillNotifiedAt: now } : {}) } });
    med.tabletsLeft = left;
    if (warn) low.push({ name: med.name, left, days });
  }
  return low;
}

/**
 * The check a typed answer is about: today's latest one still open (no answer / "not yet");
 * for a "yes" also today's latest missed or taken one (a late yes, or a second yes).
 */
async function checkForTypedAnswer(parentId: string, yes: boolean, now: Date): Promise<ReminderRow | null> {
  const todays = await prisma.medicineReminder.findMany({
    where: { parentId, reminderDate: istDateString(now), status: 'sent' },
    orderBy: { sentAt: 'desc' }
  });
  const open = todays.find(r => r.answer === null || r.answer === 'not_yet');
  if (open) return open;
  return yes ? todays.find(r => r.answer === 'missed') || todays.find(r => r.answer === 'taken') || null : null;
}

/**
 * Fever, headache, dizziness, …: the caretaker is told straight away (2026-10-05), at most once every
 * UNWELL_ALERT_GAP_HOURS. Within the gap nothing is sent (no spam): `text` is null.
 */
async function noteUnwell(cfg: WhatsAppConfig | null, person: InboundPerson, input: ReminderInbound, deps: ReminderDeps, now: Date): Promise<{ text: string | null; kind: string }> {
  const gapStart = new Date(now.getTime() - UNWELL_ALERT_GAP_HOURS * 3600000);
  const alreadyTold = (await prisma.whatsAppMessage.count({ where: { parentId: person.id, kind: 'unwell_reply', createdAt: { gte: gapStart } } })) > 0;
  if (alreadyTold) return { text: null, kind: 'unwell_reply_quiet' };
  const rec = await recordAlert({
    parentId: person.id,
    callLogId: null,
    level: 3,
    title: REMINDER_UNWELL_TITLE,
    message: `${person.name} may not be feeling well and wrote: "${input.text.slice(0, 200)}".`
  });
  let caretakerTold = false;
  if (cfg) {
    caretakerTold = await messageCaretaker(cfg, person, 'unwell', input.inboundId, CARETAKER_TEXT.unwell(person.name, input.text.slice(0, 200), person.reminderWhatsapp || person.phone), deps, now, rec.alertId || null);
    if (caretakerTold) await noteCaretakerAsked(rec.alertId, person);
  }
  // The account holder too, unless that is the person or the caretaker who was just told.
  const ownerNumber = person.user.notificationPreferences?.whatsappNumber || person.user.phone;
  if (rec.alert && ownerNumber !== input.phone && !(caretakerTold && ownerNumber === person.caretakerWhatsapp)) {
    await notifyFamily({ parentId: person.id, callLogId: null, alerts: [rec.alert] }, deps);
  }
  // Only replies that went with an alert start the gap.
  return { text: REMINDER_REPLIES.unwell(caretakerTold ? person.caretakerName : null), kind: 'unwell_reply' };
}

/** Yes / Not yet (buttons or typed), STOP / START and anything else the person writes. */
async function personMessage(person: InboundPerson, input: ReminderInbound, cfg: WhatsAppConfig | null, deps: ReminderDeps, now: Date, word: string): Promise<number> {
  // ---- Yes, taken / Not yet buttons (older "later" / "skip" buttons count as Not yet)
  const isYes = input.payload === WA_PAYLOAD.taken;
  const isNotYet = input.payload === WA_PAYLOAD.notYet || input.payload === 'rem_later' || input.payload === 'rem_skip';
  if (isYes || isNotYet) {
    const original = input.contextId ? await prisma.whatsAppMessage.findUnique({ where: { providerMessageId: input.contextId } }) : null;
    if (!original || original.kind !== 'reminder' || original.direction !== 'out' || original.phone !== input.phone) return 0;
    const rem = await prisma.medicineReminder.findUnique({ where: { id: original.refKey.split(':')[0] } });
    if (!rem || rem.parentId !== person.id) return 0;
    return replyTo(cfg, input, person.id, await answerCheck(cfg, person, rem, isYes, deps, now), deps);
  }

  // ---- STOP / START
  if (STOP_WORDS.has(word)) {
    await prisma.parentProfile.update({ where: { id: person.id }, data: { reminderOptOutAt: now } });
    await stopFamilyUpdates(input.phone);
    return replyTo(cfg, input, person.id, REMINDER_REPLIES.stopped, deps);
  }
  if (START_WORDS.has(word)) {
    if (!person.reminderOptOutAt) return replyTo(cfg, input, person.id, REMINDER_REPLIES.alreadyOn, deps);
    await prisma.parentProfile.update({ where: { id: person.id }, data: { reminderOptOutAt: null, reminderOptInAt: now } });
    return replyTo(cfg, input, person.id, REMINDER_REPLIES.restarted, deps);
  }

  // ---- Words that may mean an emergency: always first. One warm message to the person and one alert to the caretaker
  // (with "I'll handle it"), then quiet for EMERGENCY_REPLY_GAP_HOURS.
  const scan = input.text ? scanMessage(input.text) : { hit: false, matches: [] as string[] };
  if (scan.hit) {
    const gapStart = new Date(now.getTime() - EMERGENCY_REPLY_GAP_HOURS * 3600000);
    if ((await prisma.whatsAppMessage.count({ where: { parentId: person.id, kind: 'emergency_reply', createdAt: { gte: gapStart } } })) > 0) return 0;
    const rec = await recordAlert({
      parentId: person.id,
      callLogId: null,
      level: 4,
      title: REMINDER_EMERGENCY_TITLE,
      message: `${person.name} replied to a medicine check with words that may mean an emergency (${scan.matches.slice(0, 3).join(', ')}): "${input.text.slice(0, 200)}". ` +
        `We asked ${firstName(person.name)} to call 108 if help is needed right away.`
    });
    let caretakerTold = false;
    if (cfg) {
      caretakerTold = await messageCaretaker(cfg, person, 'emergency', input.inboundId, CARETAKER_TEXT.emergency(person.name, input.text.slice(0, 200), person.reminderWhatsapp || person.phone), deps, now, rec.alertId || null);
      if (caretakerTold) await noteCaretakerAsked(rec.alertId, person);
    }
    const sent = await replyTo(cfg, input, person.id, REMINDER_REPLIES.emergency(person.name, caretakerTold ? person.caretakerName : null), deps, 'emergency_reply');
    // The account holder too, unless that is the person (they just got the reply) or the caretaker (already told).
    const ownerNumber = person.user.notificationPreferences?.whatsappNumber || person.user.phone;
    if (rec.alert && ownerNumber !== input.phone && !(caretakerTold && ownerNumber === person.caretakerWhatsapp)) {
      await notifyFamily({ parentId: person.id, callLogId: null, alerts: [rec.alert] }, deps);
    }
    return sent;
  }

  const symptoms = input.text ? scanSymptomMessage(input.text) : { hit: false, matches: [] as string[] };

  // ---- "pause today": today's open checks stop, everything starts again tomorrow by itself.
  if (input.type === 'text' && parsePauseToday(input.text)) {
    await prisma.parentProfile.update({
      where: { id: person.id },
      data: { isPaused: true, pauseReason: 'Paused for today (asked on WhatsApp)', pauseUntil: tomorrowStartIst(now) }
    });
    await prisma.medicineReminder.updateMany({
      where: { parentId: person.id, reminderDate: istDateString(now), OR: [{ answer: null }, { answer: 'not_yet' }] },
      data: { answer: 'paused', nextAskAt: null }
    });
    const first = cappedSlots(person.callSchedule, 24)[0]?.time || null;
    const unwell = symptoms.hit ? await noteUnwell(cfg, person, input, deps, now) : null;
    return replyTo(cfg, input, person.id, `${REMINDER_REPLIES.pausedToday(first)}${unwell?.text ? `\n\n${unwell.text}` : ''}`, deps, unwell?.text ? unwell.kind : 'reminder_reply');
  }

  // ---- "Iron 30": bought more tablets. Only whole messages made of a number, a medicine name and filler words.
  if (input.type === 'text' && !symptoms.hit) {
    const active = person.medicines.filter(m => m.isActive);
    const topUp = parseTopUp(input.text, active.map(m => ({ name: m.name, counted: m.tabletsLeft !== null })));
    if (topUp) {
      if (!topUp.name) return replyTo(cfg, input, person.id, REMINDER_REPLIES.whichMedicine(active[0]?.name || 'Iron'), deps);
      const med = active.find(m => m.name === topUp.name)!;
      await prisma.medicine.update({ where: { id: med.id }, data: { tabletsLeft: topUp.count, refillNotifiedAt: null } });
      return replyTo(cfg, input, person.id, REMINDER_REPLIES.toppedUp(med.name, topUp.count), deps);
    }
  }

  // ---- Typed "yes" / "haan" / "ledu" … on today's open check (plus any symptom in the same message).
  const typed = input.type === 'text' ? parseTypedAnswer(input.text) : null;
  if (typed) {
    const rem = await checkForTypedAnswer(person.id, typed === 'yes', now);
    if (rem) {
      const answerText = await answerCheck(cfg, person, rem, typed === 'yes', deps, now);
      if (symptoms.hit) {
        const unwell = await noteUnwell(cfg, person, input, deps, now);
        return unwell.text ? replyTo(cfg, input, person.id, `${answerText}\n\n${unwell.text}`, deps, unwell.kind) : replyTo(cfg, input, person.id, answerText, deps);
      }
      return replyTo(cfg, input, person.id, answerText, deps);
    }
  }

  // ---- Everyday symptoms on their own.
  if (symptoms.hit) {
    const unwell = await noteUnwell(cfg, person, input, deps, now);
    return unwell.text ? replyTo(cfg, input, person.id, unwell.text, deps, unwell.kind) : 0;
  }

  // Anything else ("hello", "thanks"): no reply. We only write when it is needed.
  return 0;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** The last `days` days of medicine checks, newest first. */
export async function getRemindersForParent(parentId: string, days = 14, now: Date = new Date()): Promise<ReminderView[]> {
  const since = istDateString(new Date(now.getTime() - days * 86400000));
  const rows = await prisma.medicineReminder.findMany({
    where: { parentId, reminderDate: { gte: since } },
    orderBy: [{ reminderDate: 'desc' }, { createdAt: 'desc' }],
    take: 200
  });
  return rows.map(r => ({
    id: r.id,
    date: r.reminderDate,
    time: r.slotTime,
    medicines: readMedicines(r.medicinesJson).map(m => m.name),
    status: r.status,
    answer: (r.answer as ReminderAnswer | null) || null,
    sentAt: r.sentAt?.toISOString(),
    answeredAt: r.answeredAt?.toISOString(),
    asks: r.askCount,
    caretakerTold: !!r.caretakerAlertedAt
  }));
}
