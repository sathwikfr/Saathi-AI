/**
 * The day-by-day health timeline and the one-line journal for each day,
 * built from call results. Pure and client-safe (the dashboard and the
 * summaries both use it). Rule-based on purpose: it only repeats what the
 * parent said, in plain words, and never interprets it.
 *
 * Names, not pronouns: "Amma took all medicines", never "she", because the
 * relationship field doesn't tell us how a parent wants to be referred to.
 */
import { CallLog, AlertRecord, HealthInsight } from './types';

export type ChipTone = 'good' | 'warn' | 'alert' | 'info';

export interface TimelineDay {
  /** IST YYYY-MM-DD */
  date: string;
  label: string;
  chips: { tone: ChipTone; text: string }[];
  journal: string;
  callCount: number;
}

const IST = 'Asia/Kolkata';

export function istDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
}

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const d = new Date(`${date}T12:00:00+05:30`);
  const y = new Date(`${today}T12:00:00+05:30`);
  if (y.getTime() - d.getTime() < 1.5 * 86400000) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: IST });
}

const MOOD_WORD: Record<string, string> = {
  cheerful: 'sounded cheerful',
  calm: 'sounded calm',
  neutral: 'sounded okay',
  anxious: 'sounded low or worried',
  unwell: "didn't feel well"
};

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** One day's chips and journal line for one parent. */
export function describeDay(name: string, calls: CallLog[], alerts: AlertRecord[], insights: HealthInsight[]): Omit<TimelineDay, 'date' | 'label'> {
  const done = calls.filter(c => c.status !== 'scheduled' && c.status !== 'placed');
  const answered = done.filter(c => c.status === 'answered');
  const chips: TimelineDay['chips'] = [];
  const parts: string[] = [];

  const results = answered.flatMap(c => c.details?.medicineResults || []);
  const taken = results.filter(r => r.status === 'taken').length;
  const missed = [...new Set(results.filter(r => r.status === 'missed').map(r => r.name))];
  const stopped = [...new Set(results.filter(r => r.status === 'stopped').map(r => r.name))];
  const later = [...new Set(results.filter(r => r.status === 'later').map(r => r.name))];

  if (done.length > 0) {
    const scheduled = done.filter(c => c.slot !== 'test' && c.slot !== 'manual');
    if (answered.length === 0) {
      chips.push({ tone: 'warn', text: 'No answer' });
      parts.push(`${name} didn't answer ${scheduled.length === 1 ? 'the call' : `any of the ${scheduled.length || done.length} calls`}.`);
    } else {
      const answeredText = done.length > 1 ? `answered ${answered.length} of ${done.length} calls` : 'answered the call';
      if (results.length > 0 && missed.length === 0 && stopped.length === 0 && later.length === 0 && taken > 0) {
        chips.push({ tone: 'good', text: 'Took medicines' });
        parts.push(`${name} ${answeredText} and took all medicines.`);
      } else {
        parts.push(`${name} ${answeredText}.`);
        if (missed.length) {
          chips.push({ tone: 'warn', text: `Missed ${missed.join(', ')}` });
          parts.push(`Didn't take ${missed.join(', ')}.`);
        }
        if (later.length) parts.push(`Would take ${later.join(', ')} later.`);
        if (stopped.length) {
          chips.push({ tone: 'alert', text: `Stopped ${stopped.join(', ')}` });
          parts.push(`Has stopped taking ${stopped.join(', ')}.`);
        }
      }
    }
  }

  const moods = answered.map(c => c.mood);
  const worst = moods.includes('unwell') ? 'unwell' : moods.includes('anxious') ? 'anxious' : moods[0];
  if (worst) {
    if (worst === 'unwell' || worst === 'anxious') chips.push({ tone: 'warn', text: worst === 'unwell' ? 'Not feeling well' : 'Low mood' });
    else if (worst === 'cheerful') chips.push({ tone: 'good', text: 'Good mood' });
    parts.push(`${name.split(' ')[0]} ${MOOD_WORD[worst] || 'sounded okay'}.`);
  }

  const concerns = [...new Set(answered.map(c => c.details?.healthConcern).filter((x): x is string => !!x))];
  for (const concern of concerns.slice(0, 2)) {
    chips.push({ tone: 'warn', text: concern.length > 40 ? `${concern.slice(0, 39)}…` : concern });
    parts.push(`Mentioned: ${lowerFirst(concern.replace(/\.$/, ''))}.`);
  }
  const sleep = answered.find(c => c.details?.sleep)?.details?.sleep;
  const appetite = answered.find(c => c.details?.appetite)?.details?.appetite;
  if (sleep === 'poor') chips.push({ tone: 'warn', text: "Didn't sleep well" });
  if (appetite === 'poor') chips.push({ tone: 'warn', text: 'Not eating well' });
  if (sleep || appetite) {
    const bits = [sleep ? `slept ${sleep === 'good' ? 'well' : 'badly'}` : null, appetite ? `appetite ${appetite}` : null].filter(Boolean) as string[];
    const sentence = bits.join(', ');
    parts.push(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`);
  }
  const said = [...new Set(answered.map(c => c.notes).filter((x): x is string => !!x))];
  for (const s of said.slice(0, 2)) parts.push(`Wanted you to know: "${s.replace(/\.$/, '')}".`);
  const low = [...new Set(answered.flatMap(c => c.details?.runningLow || []))];
  if (low.length) {
    chips.push({ tone: 'warn', text: `Running low: ${low.join(', ')}` });
  }

  if (alerts.some(a => a.level >= 4)) chips.unshift({ tone: 'alert', text: 'Urgent alert' });
  for (const i of insights.filter(x => x.kind !== 'combined').slice(0, 1)) chips.push({ tone: 'info', text: i.title });

  return { chips, journal: parts.join(' '), callCount: done.length };
}

/** Newest first; only days with calls, alerts or insights. */
export function buildTimeline(
  name: string,
  calls: CallLog[],
  alerts: AlertRecord[],
  insights: HealthInsight[],
  opts: { days?: number; now?: Date } = {}
): TimelineDay[] {
  const now = opts.now || new Date();
  const today = istDate(now);
  const since = now.getTime() - (opts.days || 30) * 86400000;
  const byDate = new Map<string, { calls: CallLog[]; alerts: AlertRecord[]; insights: HealthInsight[] }>();
  const bucket = (date: string) => {
    if (!byDate.has(date)) byDate.set(date, { calls: [], alerts: [], insights: [] });
    return byDate.get(date)!;
  };
  for (const c of calls) {
    const at = new Date(c.createdAt || c.scheduledTime);
    if (Number.isNaN(at.getTime()) || at.getTime() < since) continue;
    bucket(istDate(at)).calls.push(c);
  }
  for (const a of alerts) {
    const at = new Date(a.createdAt || a.timestamp);
    if (Number.isNaN(at.getTime()) || at.getTime() < since || a.level === 0) continue;
    bucket(istDate(at)).alerts.push(a);
  }
  for (const i of insights) {
    const at = new Date(i.createdAt);
    if (at.getTime() < since) continue;
    bucket(istDate(at)).insights.push(i);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, d]) => ({ date, label: dayLabel(date, today), ...describeDay(name, d.calls, d.alerts, d.insights) }))
    .filter(d => d.callCount > 0 || d.chips.length > 0);
}
