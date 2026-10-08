/**
 * Patterns across calls: the parent's own baseline (their "health twin") compared
 * with the last week. Pure functions with no server imports, so the dashboard can
 * use them as well (lib/insights.ts stores and sends what they find).
 *
 * Every message is a nudge for the family, never a diagnosis:
 * "Amma has said she's tired on 4 of the last 5 calls; it may be worth a chat or a doctor visit."
 */
import { MedicineStatus } from './types';

export const RECENT_DAYS = 7;
export const BASELINE_DAYS = 60;

export interface CallFact {
  id: string;
  /** IST calendar date, YYYY-MM-DD */
  date: string;
  at: Date;
  status: string; // answered | unanswered | busy | failed | placed | scheduled
  /** One of the parent's daily slots (not a test, follow-up, companion or call-back). */
  scheduled: boolean;
  mood: string;
  healthConcern: string | null;
  feedback: string | null;
  pain: string | null;
  painWhere: string | null;
  sleep: string | null;
  appetite: string | null;
  parentWords: number | null;
  medicineResults: { name: string; status: MedicineStatus }[];
}

export type InsightKind =
  | 'repeat_complaint'
  | 'low_mood'
  | 'shorter_answers'
  | 'missed_calls'
  | 'adherence_drop'
  | 'poor_sleep'
  | 'poor_appetite';

export interface InsightDraft {
  kind: InsightKind;
  refKey: string;
  level: 1 | 2;
  title: string;
  message: string;
  evidence: { callLogId: string; date: string; text?: string }[];
}

/** Things parents mention, matched in the English summary fields. Emergencies are handled per call, not here. */
export const COMPLAINT_SUBJECTS: Array<{ key: string; label: string; re: RegExp }> = [
  { key: 'knee', label: 'knee pain', re: /\bknee/ },
  { key: 'back', label: 'back pain', re: /\bback\s*(pain|ache|hurt)|backache|lower back/ },
  { key: 'joint', label: 'joint pain', re: /\bjoint/ },
  { key: 'head', label: 'headaches', re: /head\s*ache|headache/ },
  { key: 'stomach', label: 'stomach trouble', re: /stomach|abdom|acidity|indigestion|vomit|loose motion|diarrh|constipat/ },
  { key: 'leg', label: 'leg or foot pain', re: /\blegs?\b|\bfoot\b|\bfeet\b|ankle/ },
  { key: 'arm', label: 'arm or shoulder pain', re: /\barms?\b|shoulder|wrist/ },
  { key: 'dizzy', label: 'dizziness', re: /dizz|giddi|vertigo|light-?headed/ },
  { key: 'tired', label: 'tiredness', re: /tired|weak|fatigue|exhaust|no energy|letharg/ },
  { key: 'cough', label: 'a cough or cold', re: /cough|\bcold\b|sore throat|runny nose|congest/ },
  { key: 'fever', label: 'fever', re: /fever|temperature/ },
  { key: 'breath', label: 'getting out of breath', re: /out of breath|breathless|short of breath/ },
  { key: 'sleep', label: 'poor sleep', re: /can'?t sleep|cannot sleep|not sleep|insomnia|awake at night|poor sleep|slept badly/ },
  { key: 'appetite', label: 'not eating well', re: /appetite|not eating|no hunger|skipp\w* (meal|food|lunch|dinner|breakfast)/ },
  { key: 'eyes', label: 'eye trouble', re: /\beyes?\b|vision|blurr/ },
  { key: 'teeth', label: 'tooth pain', re: /tooth|teeth|\bgums?\b/ },
  { key: 'swelling', label: 'swelling', re: /swell|swollen/ },
  { key: 'bp', label: 'blood pressure worries', re: /blood pressure|\bbp\b/ },
  { key: 'sugar', label: 'blood sugar worries', re: /\bsugar\b|glucose|diabet/ },
  { key: 'urine', label: 'trouble passing urine', re: /urin|bladder/ },
  { key: 'lonely', label: 'feeling lonely', re: /lonely|loneliness|feel(s|ing)? alone/ },
  { key: 'bodyache', label: 'body aches', re: /body ?(pain|ache)|aches all over|pain all over/ }
];

const DAY = 86400000;

/** ISO week in IST, e.g. "2026-W40". */
export function isoWeekKey(date: Date): string {
  const d = new Date(date.getTime() + 5.5 * 3600000);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weekday(date: string): string {
  return new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
}

/** "Mon, Wed and Fri" */
function dayList(dates: string[]): string {
  const days = [...new Set(dates)].sort().map(weekday);
  return days.length <= 1 ? days.join('') : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
}

function complaintText(f: CallFact): string {
  return [f.healthConcern, f.feedback, f.painWhere ? `${f.painWhere} pain` : null].filter(Boolean).join(' ').toLowerCase();
}

/** Subjects mentioned on one call. */
export function subjectsIn(f: CallFact): string[] {
  const text = complaintText(f);
  if (!text) return [];
  return COMPLAINT_SUBJECTS.filter(s => s.re.test(text)).map(s => s.key);
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const isLowMood = (m: string) => m === 'anxious' || m === 'unwell';

/** The parent's usual pattern over the baseline window (everything before the last week). */
export interface Baseline {
  answeredCalls: number;
  answerRatePct: number | null;
  adherencePct: number | null;
  usualMood: string | null;
  lowMoodPct: number | null;
  avgWords: number | null;
  commonComplaints: { label: string; count: number }[];
}

function summarise(facts: CallFact[]): Baseline {
  const scheduled = facts.filter(f => f.scheduled && f.status !== 'placed' && f.status !== 'scheduled');
  const answered = facts.filter(f => f.status === 'answered');
  const meds = answered.flatMap(f => f.medicineResults).filter(r => r.status !== 'unknown' && r.status !== 'later');
  const taken = meds.filter(r => r.status === 'taken').length;
  const moods = answered.reduce<Record<string, number>>((acc, f) => ((acc[f.mood] = (acc[f.mood] || 0) + 1), acc), {});
  const usualMood = Object.entries(moods).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const words = answered.map(f => f.parentWords).filter((w): w is number => typeof w === 'number' && w > 0);
  const counts = new Map<string, number>();
  for (const f of answered) for (const s of subjectsIn(f)) counts.set(s, (counts.get(s) || 0) + 1);
  return {
    answeredCalls: answered.length,
    answerRatePct: scheduled.length ? pct(scheduled.filter(f => f.status === 'answered').length, scheduled.length) : null,
    adherencePct: meds.length ? pct(taken, meds.length) : null,
    usualMood,
    lowMoodPct: answered.length ? pct(answered.filter(f => isLowMood(f.mood)).length, answered.length) : null,
    avgWords: words.length ? Math.round(words.reduce((a, b) => a + b, 0) / words.length) : null,
    commonComplaints: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, count]) => ({ label: COMPLAINT_SUBJECTS.find(s => s.key === key)!.label, count }))
  };
}

/** Splits facts into the last RECENT_DAYS and the baseline window before it. */
export function splitWindows(facts: CallFact[], now: Date) {
  const recentStart = now.getTime() - RECENT_DAYS * DAY;
  const baselineStart = now.getTime() - BASELINE_DAYS * DAY;
  return {
    recent: facts.filter(f => f.at.getTime() >= recentStart && f.at.getTime() <= now.getTime()),
    baseline: facts.filter(f => f.at.getTime() >= baselineStart && f.at.getTime() < recentStart)
  };
}

export function computeBaseline(facts: CallFact[], now: Date): { usual: Baseline; thisWeek: Baseline } {
  const { recent, baseline } = splitWindows(facts, now);
  return { usual: summarise(baseline), thisWeek: summarise(recent) };
}

export function detectInsights(facts: CallFact[], parentName: string, now: Date): InsightDraft[] {
  const week = isoWeekKey(now);
  const { recent, baseline } = splitWindows(facts, now);
  const recentAnswered = recent.filter(f => f.status === 'answered').sort((a, b) => b.at.getTime() - a.at.getTime());
  const out: InsightDraft[] = [];

  // 1. The same complaint on two or more calls this week.
  const bySubject = new Map<string, CallFact[]>();
  for (const f of recentAnswered) for (const s of subjectsIn(f)) bySubject.set(s, [...(bySubject.get(s) || []), f]);
  const monthAgo = now.getTime() - 30 * DAY;
  for (const [key, calls] of bySubject) {
    if (calls.length < 2) continue;
    const subject = COMPLAINT_SUBJECTS.find(s => s.key === key)!;
    const monthCount = facts.filter(f => f.status === 'answered' && f.at.getTime() >= monthAgo && subjectsIn(f).includes(key)).length;
    const doctor = monthCount >= 4
      ? ` That's ${monthCount} times this month, so a doctor's visit may be worth booking.`
      : ' It may be worth a chat, or a doctor visit if it keeps coming up.';
    out.push({
      kind: 'repeat_complaint',
      refKey: `${week}:${key}`,
      level: 1,
      title: `${parentName} mentioned ${subject.label} ${calls.length} times this week`,
      message: `${parentName} mentioned ${subject.label} on ${calls.length} calls this week (${dayList(calls.map(c => c.date))}).${doctor}`,
      evidence: calls.map(c => ({ callLogId: c.id, date: c.date, text: complaintText(c).slice(0, 160) }))
    });
  }

  // 2. Low mood on several recent calls.
  const last5 = recentAnswered.slice(0, 5);
  const low = last5.filter(f => isLowMood(f.mood));
  if (last5.length >= 3 && low.length >= 3) {
    const usual = summarise(baseline);
    const unusual = usual.lowMoodPct !== null && usual.answeredCalls >= 5 && usual.lowMoodPct < 25 ? ' That is unusual for them.' : '';
    out.push({
      kind: 'low_mood',
      refKey: week,
      level: 1,
      title: `${parentName} has sounded low lately`,
      message: `${parentName} sounded low or unwell on ${low.length} of the last ${last5.length} calls.${unusual} Today might be a good day to call them.`,
      evidence: low.map(c => ({ callLogId: c.id, date: c.date, text: c.mood }))
    });
  }

  // 3. Much shorter answers than their own usual.
  const recentWords = recentAnswered.map(f => f.parentWords).filter((w): w is number => typeof w === 'number' && w > 0);
  const baseWords = baseline.filter(f => f.status === 'answered').map(f => f.parentWords).filter((w): w is number => typeof w === 'number' && w > 0);
  if (recentWords.length >= 3 && baseWords.length >= 5) {
    const r = recentWords.reduce((a, b) => a + b, 0) / recentWords.length;
    const b = baseWords.reduce((a, c) => a + c, 0) / baseWords.length;
    if (b >= 8 && r < b * 0.6) {
      out.push({
        kind: 'shorter_answers',
        refKey: week,
        level: 1,
        title: `${parentName} is saying less than usual`,
        message: `${parentName}'s answers on the calls this week are much shorter than usual (about ${Math.round(r)} words a call, usually ${Math.round(b)}). It may be nothing, but a chat could tell you more.`,
        evidence: recentAnswered.slice(0, 5).map(c => ({ callLogId: c.id, date: c.date, text: `${c.parentWords ?? 0} words` }))
      });
    }
  }

  // 4. Picking up less often than usual.
  const recentSched = recent.filter(f => f.scheduled && !['placed', 'scheduled'].includes(f.status));
  const baseSched = baseline.filter(f => f.scheduled && !['placed', 'scheduled'].includes(f.status));
  if (recentSched.length >= 4 && baseSched.length >= 7) {
    const r = pct(recentSched.filter(f => f.status === 'answered').length, recentSched.length);
    const b = pct(baseSched.filter(f => f.status === 'answered').length, baseSched.length);
    if (r < 75 && b - r >= 25) {
      out.push({
        kind: 'missed_calls',
        refKey: week,
        level: 1,
        title: `${parentName} is missing more calls than usual`,
        message: `${parentName} answered ${recentSched.filter(f => f.status === 'answered').length} of ${recentSched.length} calls this week (${r}%), usually ${b}%. Worth checking that their phone is working and they are well.`,
        evidence: recentSched.filter(f => f.status !== 'answered').map(c => ({ callLogId: c.id, date: c.date, text: c.status }))
      });
    }
  }

  // 5. Taking medicines less often than usual.
  const counted = (fs: CallFact[]) =>
    fs.filter(f => f.status === 'answered').flatMap(f => f.medicineResults).filter(m => m.status !== 'unknown' && m.status !== 'later');
  const rMeds = counted(recent);
  const bMeds = counted(baseline);
  if (rMeds.length >= 4 && bMeds.length >= 8) {
    const r = pct(rMeds.filter(m => m.status === 'taken').length, rMeds.length);
    const b = pct(bMeds.filter(m => m.status === 'taken').length, bMeds.length);
    if (b - r >= 20) {
      out.push({
        kind: 'adherence_drop',
        refKey: week,
        level: 1,
        title: `${parentName} is missing more medicines than usual`,
        message: `${parentName} confirmed ${r}% of medicines this week, usually ${b}%. A gentle word from you, or a pill box, may help.`,
        evidence: recent.filter(f => f.medicineResults.some(m => m.status === 'missed' || m.status === 'stopped')).map(c => ({ callLogId: c.id, date: c.date }))
      });
    }
  }

  // 6. Sleep and appetite answers (asked every few days).
  for (const [kind, field, label] of [
    ['poor_sleep', 'sleep', 'not sleeping well'],
    ['poor_appetite', 'appetite', 'not eating well']
  ] as const) {
    const poor = recentAnswered.filter(f => f[field] === 'poor');
    if (poor.length >= 2) {
      out.push({
        kind,
        refKey: week,
        level: 1,
        title: `${parentName} said they are ${label}`,
        message: `${parentName} told Saathi they were ${label} on ${poor.length} calls this week (${dayList(poor.map(c => c.date))}). It may be worth asking them about it.`,
        evidence: poor.map(c => ({ callLogId: c.id, date: c.date }))
      });
    }
  }

  return out;
}

/** A combined nudge when several different things changed in the same week. */
export function combinedNudge(parentName: string, kindsThisWeek: { kind: string; title: string }[]): { title: string; message: string } | null {
  const distinct = new Map(kindsThisWeek.map(k => [k.kind === 'repeat_complaint' ? k.title : k.kind, k.title]));
  if (distinct.size < 2) return null;
  const items = [...distinct.values()].slice(0, 4).map(t => t.replace(`${parentName} `, ''));
  return {
    title: 'Several changes this week',
    message: `A few things have changed for ${parentName} this week: ${items.join('; ')}. Today might be a good day to call them, and to think about a doctor visit if it continues.`
  };
}
