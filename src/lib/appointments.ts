/**
 * Doctor visits and lab tests: what Saathi says about them on a call. Pure.
 *   day before   "Tomorrow at 10 AM you have your eye check-up at Apollo. The test needs an empty stomach."
 *   same day     "Today at 10 AM: eye check-up at Apollo."
 *   afterwards   "How did the eye check-up go?" (the answer goes to the family)
 * The fasting line is the family's own instruction (they tick it); Saathi adds no advice.
 */
import { AppointmentWords, ENGLISH_APPOINTMENT_WORDS } from './waTranslations';

const IST_MS = 5.5 * 3600000;
const DAY = 86400000;

export interface AppointmentRow {
  id: string;
  title: string;
  kind: string;
  startsAt: Date;
  location: string | null;
  notes: string | null;
  fasting: boolean;
  remindedDayBefore: Date | null;
  remindedSameDay: Date | null;
  followedUpAt: Date | null;
  cancelledAt: Date | null;
  /** Couple calls: whose appointment it is when it's the other parent's ("Appa"). */
  who?: string;
}

export interface AppointmentPlan {
  /** One English sentence or two for Saathi to say; null when nothing is due. */
  note: string | null;
  reminded: { id: string; which: 'day_before' | 'same_day' }[];
  followUp: { id: string; question: string } | null;
}

const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

function clock(d: Date) {
  const t = new Date(d.getTime() + IST_MS);
  const h = t.getUTCHours();
  const m = t.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

function what(a: AppointmentRow) {
  return `${a.who ? `${a.who}'s ` : ''}${a.title}${a.location ? ` at ${a.location}` : ''}`;
}

/** WhatsApp (Remind): the evening before is sent from 6 PM IST, the morning of from 7 AM IST. */
export const WA_DAY_BEFORE_FROM_MINUTES = 18 * 60;
export const WA_SAME_DAY_FROM_MINUTES = 7 * 60;

export interface WhatsappAppointmentReminder {
  id: string;
  which: 'day_before' | 'same_day';
  /** One short line for the message: no newlines (Meta's rule for template parameters). */
  text: string;
}

/**
 * Check-up reminders for people on WhatsApp: at most two per appointment (the evening before, the morning of), never
 * for a cancelled or past one, never twice. No "how did it go?" afterwards: we only write when it is needed.
 */
export function dueWhatsappAppointments(rows: AppointmentRow[], now: Date, words: AppointmentWords = ENGLISH_APPOINTMENT_WORDS): WhatsappAppointmentReminder[] {
  const today = istDay(now);
  const tomorrow = istDay(new Date(now.getTime() + DAY));
  const t = new Date(now.getTime() + IST_MS);
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  const out: WhatsappAppointmentReminder[] = [];
  for (const a of rows.filter(r => !r.cancelledAt).sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())) {
    const day = istDay(a.startsAt);
    const extra = `${a.fasting ? words.fasting : ''}${a.notes ? `${words.note} ${a.notes.replace(/\s+/g, ' ')}` : ''}`;
    const what = `${a.who ? `${a.who}'s ` : ''}${a.location ? words.join(a.title, a.location) : a.title}`;
    if (day === today && a.startsAt.getTime() > now.getTime() && !a.remindedSameDay && minutes >= WA_SAME_DAY_FROM_MINUTES) {
      out.push({ id: a.id, which: 'same_day', text: `${words.today} ${clock(a.startsAt)}: ${what}.${extra}` });
    } else if (day === tomorrow && !a.remindedDayBefore && minutes >= WA_DAY_BEFORE_FROM_MINUTES) {
      out.push({ id: a.id, which: 'day_before', text: `${words.tomorrow} ${clock(a.startsAt)}: ${what}.${extra}` });
    }
  }
  return out;
}

export function planAppointments(rows: AppointmentRow[], now: Date): AppointmentPlan {
  const today = istDay(now);
  const tomorrow = istDay(new Date(now.getTime() + DAY));
  const live = rows.filter(a => !a.cancelledAt).sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
  const parts: string[] = [];
  const reminded: AppointmentPlan['reminded'] = [];

  for (const a of live) {
    const day = istDay(a.startsAt);
    if (day === today && a.startsAt.getTime() > now.getTime() && !a.remindedSameDay) {
      parts.push(`Today at ${clock(a.startsAt)}: ${what(a)}.${a.fasting ? ' The family says it needs an empty stomach.' : ''}${a.notes ? ` Note: ${a.notes}` : ''}`);
      reminded.push({ id: a.id, which: 'same_day' });
    } else if (day === tomorrow && !a.remindedDayBefore) {
      parts.push(`Tomorrow at ${clock(a.startsAt)}: ${what(a)}.${a.fasting ? ' The family says not to eat before it.' : ''}${a.notes ? ` Note: ${a.notes}` : ''}`);
      reminded.push({ id: a.id, which: 'day_before' });
    }
    if (reminded.length >= 2) break;
  }

  // Ask once how it went, between 2 hours and 4 days afterwards.
  const done = live.filter(a => !a.followedUpAt && a.startsAt.getTime() < now.getTime() - 2 * 3600000 && a.startsAt.getTime() > now.getTime() - 4 * DAY);
  const last = done[done.length - 1];
  return {
    note: parts.length ? parts.join(' ') : null,
    reminded,
    followUp: last ? { id: last.id, question: `How did ${last.who ? `${last.who}'s` : 'the'} ${last.title}${last.kind === 'lab' ? '' : ' visit'} go?` } : null
  };
}
