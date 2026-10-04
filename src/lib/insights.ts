/**
 * Stores the patterns lib/insightRules.ts finds (one HealthInsight per kind and
 * subject per week) and, when several different things change in one week,
 * raises one level-2 "worth a call today" alert. Single insights are shown on
 * the dashboard and in the digests only, so quiet weeks stay quiet.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { newId } from './db';
import { CallFact, detectInsights, combinedNudge, isoWeekKey, BASELINE_DAYS } from './insightRules';
import { NON_RETRY_SLOTS } from './callPlanning';
import { ALERT_TITLES } from './callInterpretation';
import { recordAlert, AlertDeps } from './alerts';
import { notifyFamily } from './familyNotify';
import { HealthInsight, MedicineStatus } from './types';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

type CallRow = Prisma.CallLogGetPayload<object>;

/** A CallLog as the insight rules see it. */
export function toCallFact(c: CallRow): CallFact {
  let r: Record<string, unknown> = {};
  try {
    r = JSON.parse(c.resultJson || '{}');
  } catch {
    r = {};
  }
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    id: c.id,
    date: c.callDate || c.createdAt.toISOString().slice(0, 10),
    at: c.createdAt,
    status: c.status,
    scheduled: !!c.slotId && !NON_RETRY_SLOTS.includes(c.slot || ''),
    mood: c.mood,
    healthConcern: str(r.healthConcern),
    feedback: c.notes || null,
    pain: str(r.pain),
    painWhere: str(r.painWhere),
    sleep: str(r.sleep),
    appetite: str(r.appetite),
    parentWords: c.parentWords,
    medicineResults: Array.isArray(r.medicineResults) ? (r.medicineResults as { name: string; status: MedicineStatus }[]) : []
  };
}

export async function loadCallFacts(parentId: string, now: Date): Promise<CallFact[]> {
  const rows = await prisma.callLog.findMany({
    where: { parentId, createdAt: { gte: new Date(now.getTime() - BASELINE_DAYS * 86400000) } },
    orderBy: { createdAt: 'desc' }
  });
  return rows.map(toCallFact);
}

/** Runs the rules for one parent; returns the insights that are new this time. */
export async function runInsightsForParent(parentId: string, opts: { now?: Date; deps?: AlertDeps } = {}) {
  const now = opts.now || new Date();
  const parent = await prisma.parentProfile.findUnique({ where: { id: parentId }, select: { id: true, name: true, isDeleted: true } });
  if (!parent || parent.isDeleted) return [];

  const all = detectInsights(await loadCallFacts(parentId, now), parent.name, now);
  // Cheap check first so the routine "already noticed this week" case doesn't hit the unique index (and log an error).
  const seen = all.length
    ? await prisma.healthInsight.findMany({ where: { parentId, refKey: { in: all.map(d => d.refKey) } }, select: { kind: true, refKey: true } })
    : [];
  const drafts = all.filter(d => !seen.some(e => e.kind === d.kind && e.refKey === d.refKey));
  const created = [];
  for (const d of drafts) {
    try {
      created.push(
        await prisma.healthInsight.create({
          data: {
            id: newId('ins'),
            parentId,
            kind: d.kind,
            refKey: d.refKey,
            level: d.level,
            title: d.title,
            message: d.message,
            evidence: JSON.stringify(d.evidence)
          }
        })
      );
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // already noticed this week
    }
  }
  if (created.length === 0) return created;

  // Several different changes in one week: one message to the family.
  const week = isoWeekKey(now);
  const thisWeek = await prisma.healthInsight.findMany({
    where: { parentId, refKey: { startsWith: week }, kind: { not: 'combined' } },
    select: { kind: true, title: true }
  });
  const nudge = combinedNudge(parent.name, thisWeek);
  const alreadyNudged = nudge
    ? await prisma.healthInsight.findUnique({ where: { parentId_kind_refKey: { parentId, kind: 'combined', refKey: week } }, select: { id: true } })
    : null;
  if (nudge && !alreadyNudged) {
    let first = false;
    try {
      await prisma.healthInsight.create({
        data: { id: newId('ins'), parentId, kind: 'combined', refKey: week, level: 2, title: nudge.title, message: nudge.message }
      });
      first = true;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    if (first) {
      const rec = await recordAlert({ parentId, callLogId: null, level: 2, title: ALERT_TITLES.insightsCombined, message: nudge.message });
      if (rec.alert) await notifyFamily({ parentId, callLogId: null, alerts: [rec.alert] }, opts.deps || {});
    }
  }
  return created;
}

/** Daily cron pass over every active parent (catches "missing calls" weeks with no answered call to trigger it). */
export async function runInsightsForAll(opts: { now?: Date; deps?: AlertDeps; parentIds?: string[] } = {}) {
  const parents = await prisma.parentProfile.findMany({
    where: { isDeleted: false, ...(opts.parentIds ? { id: { in: opts.parentIds } } : {}) },
    select: { id: true }
  });
  let created = 0;
  for (const p of parents) {
    try {
      created += (await runInsightsForParent(p.id, opts)).length;
    } catch (err) {
      console.error(`[insights] ${p.id} failed:`, err);
    }
  }
  return { parents: parents.length, created };
}

export async function getInsightsForParent(parentId: string, sinceDays = 60): Promise<HealthInsight[]> {
  const rows = await prisma.healthInsight.findMany({
    where: { parentId, createdAt: { gte: new Date(Date.now() - sinceDays * 86400000) } },
    orderBy: { createdAt: 'desc' }
  });
  return rows.map(r => ({
    id: r.id,
    parentId: r.parentId,
    kind: r.kind,
    level: r.level,
    title: r.title,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    dismissedAt: r.dismissedAt?.toISOString()
  }));
}
