/**
 * Daily / weekly / monthly summaries for the family, at the hour each person
 * picked, in their own time zone (NotificationPreferences.timezone, default IST).
 *
 *   daily    only for people who chose "one summary a day" (routine call results wait for it)
 *   weekly   on by default, the day and hour they pick (Sunday 9 AM)
 *   monthly  on by default, the 1st of the month at the weekly hour, with the doctor-report link
 *
 * The cron runs every ~5 minutes; each summary is sent once per person per period
 * (WhatsAppMessage / EmailLog unique keys). Quiet weeks still get a short summary,
 * so families keep a reason to look without being flooded.
 */
import { prisma } from './prisma';
import { ownerPlanFor } from './planAccess';
import { familyRecipients } from './familyAccess';
import { whatsappAllowed } from './familyNotify';
import { CallFact, computeBaseline, subjectsIn, COMPLAINT_SUBJECTS, isoWeekKey } from './insightRules';
import { toCallFact } from './insights';
import { sendSummary, SummaryPeriod, NotifyDeps } from './familyNotify';
import { sendCareSummaryEmail } from './email';
import { checkBp, checkSugar, parseRanges, ReadingRanges } from './readings';

const IST = 'Asia/Kolkata';
const DAY = 86400000;

export interface LocalParts {
  hour: number;
  weekday: number; // 0 = Sunday
  day: number;
  dateKey: string; // YYYY-MM-DD
  monthKey: string; // YYYY-MM
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localParts(now: Date, timeZone: string | null | undefined): LocalParts {
  let tz = timeZone || IST;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = IST;
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short'
    })
      .formatToParts(now)
      .map(p => [p.type, p.value])
  );
  return {
    hour: parseInt(parts.hour, 10) % 24,
    weekday: WEEKDAYS.indexOf(parts.weekday),
    day: parseInt(parts.day, 10),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    monthKey: `${parts.year}-${parts.month}`
  };
}

/** Which summaries are due for one person right now. */
export function dueSummaries(
  prefs: {
    dailySummary: boolean;
    dailySummaryHour: number;
    weeklyDigest: boolean;
    digestDay: number;
    digestHour: number;
    monthlySummary: boolean;
    timezone: string | null;
  },
  now: Date
): Array<{ period: SummaryPeriod; refKey: string }> {
  const t = localParts(now, prefs.timezone);
  const due: Array<{ period: SummaryPeriod; refKey: string }> = [];
  if (prefs.dailySummary && t.hour === prefs.dailySummaryHour) due.push({ period: 'daily', refKey: `daily:${t.dateKey}` });
  if (prefs.weeklyDigest && t.weekday === prefs.digestDay && t.hour === prefs.digestHour) {
    due.push({ period: 'weekly', refKey: `weekly:${isoWeekKey(now)}` });
  }
  if (prefs.monthlySummary && t.day === 1 && t.hour === prefs.digestHour) due.push({ period: 'monthly', refKey: `monthly:${t.monthKey}` });
  return due;
}

const PERIOD_DAYS: Record<SummaryPeriod, number> = { daily: 1, weekly: 7, monthly: 30 };

function shortDay(date: string) {
  return new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: IST });
}

/** A BP / sugar reading as the summaries see it (said on a call or typed in by the family). */
export interface ReadingFact {
  kind: string;
  systolic: number | null;
  diastolic: number | null;
  value: number | null;
  context: string | null;
  takenAt: Date;
}

const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
const WHEN: Record<string, string> = { fasting: 'fasting', after_food: 'after food' };

/**
 * One short line about the period's BP and sugar readings, e.g.
 *   weekly: "Readings: BP 5 times, average 141/88, highest 156/96 (Tue), previous week 136/84; sugar 3 times,
 *            fasting average 132, after food average 168; 1 outside the limits."
 *   daily:  "Readings: BP 142/88; sugar 151 (after food)."
 * Numbers only, never "good" or "bad". Null when there were no readings. Pure.
 */
export function readingsLine(readings: ReadingFact[], opts: { period: SummaryPeriod; now: Date; ranges?: ReadingRanges }): string | null {
  const span = PERIOD_DAYS[opts.period] * DAY;
  const end = opts.now.getTime();
  const inRange = (r: ReadingFact, from: number, to: number) => r.takenAt.getTime() >= from && r.takenAt.getTime() < to;
  const cur = readings.filter(r => inRange(r, end - span, end + 1));
  const prev = readings.filter(r => inRange(r, end - 2 * span, end - span));
  const isBp = (r: ReadingFact) => r.kind === 'bp' && !!r.systolic && !!r.diastolic;
  const isSugar = (r: ReadingFact) => r.kind === 'sugar' && !!r.value;
  const bp = cur.filter(isBp);
  const sugar = cur.filter(isSugar);
  if (!bp.length && !sugar.length) return null;

  const parts: string[] = [];
  const times = (n: number) => (n === 1 ? 'once' : `${n} times`);
  const dayLabel = (d: Date) =>
    d.toLocaleDateString('en-IN', opts.period === 'weekly' ? { weekday: 'short', timeZone: IST } : { day: 'numeric', month: 'short', timeZone: IST });

  if (bp.length && opts.period === 'daily') {
    parts.push(`BP ${bp.map(r => `${r.systolic}/${r.diastolic}`).join(', ')}`);
  } else if (bp.length) {
    const bits = [`BP ${times(bp.length)}`, bp.length > 1 ? `average ${avg(bp.map(r => r.systolic!))}/${avg(bp.map(r => r.diastolic!))}` : `${bp[0].systolic}/${bp[0].diastolic}`];
    if (bp.length > 1) {
      const top = bp.reduce((a, b) => (b.systolic! > a.systolic! ? b : a));
      bits.push(`highest ${top.systolic}/${top.diastolic} (${dayLabel(top.takenAt)})`);
    }
    const pbp = prev.filter(isBp);
    if (bp.length > 1 && pbp.length > 1) {
      bits.push(`previous ${opts.period === 'weekly' ? 'week' : 'month'} ${avg(pbp.map(r => r.systolic!))}/${avg(pbp.map(r => r.diastolic!))}`);
    }
    parts.push(bits.join(', '));
  }

  if (sugar.length && opts.period === 'daily') {
    parts.push(`sugar ${sugar.map(r => `${Math.round(r.value!)}${r.context && WHEN[r.context] ? ` (${WHEN[r.context]})` : ''}`).join(', ')}`);
  } else if (sugar.length) {
    // Fasting and after-food numbers mean different things, so they are averaged separately.
    const groups = ['fasting', 'after_food', 'other']
      .map(key => ({ key, rows: sugar.filter(r => (key === 'other' ? !WHEN[r.context || ''] : r.context === key)) }))
      .filter(g => g.rows.length);
    const desc = groups.map(g => {
      const label = g.key === 'other' ? (groups.length > 1 ? 'other times ' : '') : `${WHEN[g.key]} `;
      return g.rows.length > 1 ? `${label}average ${avg(g.rows.map(r => r.value!))}` : `${label}${Math.round(g.rows[0].value!)}`;
    });
    parts.push(`sugar ${times(sugar.length)}, ${desc.join(', ')}`);
  }

  const ranges = opts.ranges || {};
  const outside = cur.filter(r =>
    isBp(r)
      ? checkBp({ systolic: r.systolic!, diastolic: r.diastolic! }, ranges).outside
      : isSugar(r) && checkSugar({ value: r.value!, context: r.context as 'fasting' | 'after_food' | 'random' | null }, ranges).outside
  ).length;
  if (outside) parts.push(`${outside} outside the limits`);
  return `Readings: ${parts.join('; ')}.`;
}

/** The few lines about one parent for one period. Pure. */
export function parentSummary(
  name: string,
  facts: CallFact[],
  opts: {
    period: SummaryPeriod;
    now: Date;
    insightTitles?: string[];
    renewals?: string[];
    paused?: boolean;
    readings?: ReadingFact[];
    readingRanges?: ReadingRanges;
  }
): string {
  const since = opts.now.getTime() - PERIOD_DAYS[opts.period] * DAY;
  const inPeriod = facts.filter(f => f.at.getTime() >= since && !['placed', 'scheduled'].includes(f.status));
  const lines: string[] = [];

  if (inPeriod.length === 0) {
    lines.push(opts.paused ? `${name}: calls are paused.` : `${name}: no check-in calls in this period.`);
    // Readings the family typed in still count.
    const readingText = readingsLine(opts.readings || [], { period: opts.period, now: opts.now, ranges: opts.readingRanges });
    if (readingText) lines.push(readingText);
  } else {
    const answered = inPeriod.filter(f => f.status === 'answered');
    const meds = answered.flatMap(f => f.medicineResults).filter(m => m.status !== 'unknown' && m.status !== 'later');
    const taken = meds.filter(m => m.status === 'taken').length;
    const bits: string[] = [`answered ${answered.length} of ${inPeriod.length} calls`];
    if (meds.length) bits.push(`medicines taken ${taken} of ${meds.length} times (${Math.round((taken / meds.length) * 100)}%)`);
    const moods = answered.reduce<Record<string, number>>((acc, f) => ((acc[f.mood] = (acc[f.mood] || 0) + 1), acc), {});
    const topMood = Object.entries(moods).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topMood) bits.push(`mood mostly ${topMood}`);
    lines.push(`${name}: ${bits.join(', ')}.`);

    const mentions = new Map<string, string[]>();
    for (const f of answered) for (const s of subjectsIn(f)) mentions.set(s, [...(mentions.get(s) || []), f.date]);
    if (mentions.size) {
      const list = [...mentions.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 3)
        .map(([key, dates]) => {
          const label = COMPLAINT_SUBJECTS.find(s => s.key === key)!.label;
          return opts.period === 'daily' ? label : `${label} (${[...new Set(dates)].map(shortDay).join(', ')})`;
        });
      lines.push(`Mentioned: ${list.join('; ')}.`);
    }
    const readingText = readingsLine(opts.readings || [], { period: opts.period, now: opts.now, ranges: opts.readingRanges });
    if (readingText) lines.push(readingText);
    const said = answered.map(f => f.feedback).filter((x): x is string => !!x);
    if (said.length) lines.push(`Wanted you to know: "${said[0]}".`);
    if (opts.period !== 'daily' && facts.length >= 10) {
      const { usual, thisWeek } = computeBaseline(facts, opts.now);
      if (usual.adherencePct !== null && thisWeek.adherencePct !== null && Math.abs(usual.adherencePct - thisWeek.adherencePct) >= 15) {
        lines.push(`Usually takes ${usual.adherencePct}% of medicines.`);
      }
    }
  }
  for (const t of (opts.insightTitles || []).slice(0, 2)) lines.push(`Noticed: ${t}.`);
  if (opts.insightTitles?.length) lines.push(`Today might be a good day to call ${name.split(' ')[0]}.`);
  for (const r of (opts.renewals || []).slice(0, 1)) lines.push(r);
  return lines.join(' ');
}

/** Every parent a person looks after: their own and the ones shared with them. */
async function parentsOf(userId: string) {
  const [owned, shared] = await Promise.all([
    prisma.parentProfile.findMany({ where: { userId, isDeleted: false }, select: { id: true, name: true, isPaused: true, readingRanges: true, reminderChannel: true } }),
    prisma.caregiverInvite.findMany({
      where: { userId, status: 'accepted' },
      select: { parent: { select: { id: true, name: true, isPaused: true, isDeleted: true, readingRanges: true, reminderChannel: true } } }
    })
  ]);
  // WhatsApp-reminder people (Remind) have no calls to summarise. (Filtered here: a NOT on a nullable column would drop nulls too.)
  const all = [...owned, ...shared.map(s => s.parent).filter(p => !p.isDeleted)].filter(p => p.reminderChannel !== 'whatsapp');
  const unique = all.filter((p, i) => all.findIndex(q => q.id === p.id) === i);
  // Shared parents: only if this member is within that parent's WhatsApp allowance (Solo 1, Family 2, Extended 5).
  const ownedIds = new Set(owned.map(p => p.id));
  const kept = [];
  for (const p of unique) {
    if (ownedIds.has(p.id)) { kept.push(p); continue; }
    const fam = await familyRecipients(p.id);
    if (!fam) continue;
    const allowed = whatsappAllowed([fam.owner, ...fam.members], (await ownerPlanFor(fam.parent.userId)).whatsappPeople);
    if (allowed.has(userId)) kept.push(p);
  }
  return kept;
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** Builds the full summary text for one person (all their parents). */
export async function buildSummaryFor(userId: string, period: SummaryPeriod, now: Date) {
  const parents = await parentsOf(userId);
  if (parents.length === 0) return null;
  const lines: string[] = [];
  for (const p of parents) {
    const rows = await prisma.callLog.findMany({
      where: { parentId: p.id, createdAt: { gte: new Date(now.getTime() - 60 * DAY) } },
      orderBy: { createdAt: 'desc' }
    });
    const insights = await prisma.healthInsight.findMany({
      where: { parentId: p.id, kind: { not: 'combined' }, dismissedAt: null, createdAt: { gte: new Date(now.getTime() - PERIOD_DAYS[period] * DAY) } },
      orderBy: { createdAt: 'desc' },
      select: { title: true }
    });
    // Two periods back, so the weekly / monthly line can compare with the one before.
    const readings = await prisma.healthReading.findMany({
      where: { parentId: p.id, takenAt: { gte: new Date(now.getTime() - 2 * PERIOD_DAYS[period] * DAY) } },
      orderBy: { takenAt: 'asc' },
      select: { kind: true, systolic: true, diastolic: true, value: true, context: true, takenAt: true }
    });
    const renewals: string[] = [];
    if (period !== 'daily') {
      const soon = new Date(now.getTime() + 30 * DAY).toISOString().slice(0, 10);
      const docs = await prisma.healthDocument.findMany({
        where: { parentId: p.id, isDeleted: false, renewalDate: { not: null, lte: soon, gte: now.toISOString().slice(0, 10) } },
        select: { title: true, renewalDate: true }
      });
      for (const d of docs) renewals.push(`Reminder: ${d.title} renews on ${d.renewalDate}.`);
    }
    lines.push(
      parentSummary(p.name, rows.map(toCallFact), {
        period,
        now,
        insightTitles: insights.map(i => i.title),
        renewals,
        paused: p.isPaused,
        readings,
        readingRanges: parseRanges(p.readingRanges)
      })
    );
  }
  // A daily summary with no calls at all isn't worth a message.
  if (period === 'daily' && lines.every(l => /no check-in calls|calls are paused/.test(l))) return null;
  return {
    parentNames: parents.map(p => p.name).join(' & '),
    text: lines.join('\n'),
    reportUrl: period === 'monthly' && parents.length === 1 ? `${appUrl()}/dashboard/report/${parents[0].id}` : `${appUrl()}/dashboard`
  };
}

export async function runDigests(
  opts: { now?: Date; deps?: NotifyDeps & { sendSummaryEmail?: typeof sendCareSummaryEmail }; userIds?: string[] } = {}
): Promise<{ checked: number; sent: number }> {
  const now = opts.now || new Date();
  // Everyone who looks after at least one parent.
  const people = await prisma.user.findMany({
    where: {
      ...(opts.userIds ? { id: { in: opts.userIds } } : {}),
      OR: [{ parents: { some: { isDeleted: false } } }, { id: { in: await memberIds() } }]
    },
    include: { notificationPreferences: true }
  });
  let sent = 0;
  for (const person of people) {
    const prefs = person.notificationPreferences;
    const due = dueSummaries(
      {
        dailySummary: prefs?.dailySummary ?? false,
        dailySummaryHour: prefs?.dailySummaryHour ?? 20,
        weeklyDigest: prefs?.weeklyDigest ?? true,
        digestDay: prefs?.digestDay ?? 0,
        digestHour: prefs?.digestHour ?? 9,
        monthlySummary: prefs?.monthlySummary ?? true,
        timezone: prefs?.timezone ?? null
      },
      now
    );
    for (const d of due) {
      try {
        const summary = await buildSummaryFor(person.id, d.period, now);
        if (!summary) continue;
        const res = await sendSummary({ person, period: d.period, refKey: d.refKey, ...summary }, opts.deps || {});
        if (res === 'whatsapp' || res === 'email') sent += 1;
      } catch (err) {
        console.error(`[digests] ${d.period} for ${person.id} failed:`, err);
      }
    }
  }
  return { checked: people.length, sent };
}

async function memberIds(): Promise<string[]> {
  const rows = await prisma.caregiverInvite.findMany({ where: { status: 'accepted', userId: { not: null } }, select: { userId: true } });
  return [...new Set(rows.map(r => r.userId!))];
}
