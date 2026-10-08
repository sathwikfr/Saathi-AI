/**
 * Durable counters for "Ask about your parent" (2026-10-08). Each question is a paid AI request (about ₹6), so the limits
 * must hold across serverless instances: the old in-memory counters each had a copy per instance and could be bypassed.
 *
 *   month:<ownerId>:<YYYY-MM>   the plan's monthly allowance, shared by the whole family circle (IST calendar month)
 *   day:<userId>:<YYYY-MM-DD>   one person's daily limit (IST)
 *
 * `claimAsk` takes one use atomically (a conditional UPDATE), `releaseAsk` gives it back when the AI call failed, so
 * an error never costs the family a question.
 */
import { prisma } from './prisma';
import { istDateString } from './ist';

export const monthKey = (ownerId: string, now: Date) => `month:${ownerId}:${istDateString(now).slice(0, 7)}`;
export const dayKey = (userId: string, now: Date) => `day:${userId}:${istDateString(now)}`;

/** Takes one use if fewer than `limit` have been used. */
export async function claimAsk(key: string, limit: number): Promise<{ ok: boolean; used: number }> {
  if (limit <= 0) return { ok: false, used: 0 };
  try {
    await prisma.askUsage.create({ data: { key, count: 0 } });
  } catch {
    // Already there (or another request just created it): fine.
  }
  const res = await prisma.askUsage.updateMany({ where: { key, count: { lt: limit } }, data: { count: { increment: 1 } } });
  if (res.count === 1) {
    const row = await prisma.askUsage.findUnique({ where: { key }, select: { count: true } });
    return { ok: true, used: row?.count ?? 1 };
  }
  return { ok: false, used: limit };
}

/** Gives a use back (never below zero). */
export async function releaseAsk(key: string): Promise<void> {
  await prisma.askUsage.updateMany({ where: { key, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
}

/** How many have been used (0 when nothing is recorded yet). */
export async function askUsed(key: string): Promise<number> {
  return (await prisma.askUsage.findUnique({ where: { key }, select: { count: true } }))?.count ?? 0;
}
