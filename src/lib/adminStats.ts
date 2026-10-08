import prisma from './prisma';
import { PLANS, freeTrialDaysLeft, getEffectivePlan } from './plans';
import { istDateString } from './ist';
import { TEST_EMAIL_PREFIX } from './adminEmail';
import { PlanId } from './types';

const DAY_MS = 86400000;
const CHART_DAYS = 14;
const CALL_WINDOW_DAYS = 30;
const CUSTOMER_LIMIT = 200;

// Read-only: nothing in this file writes to the database.
const realUser = { NOT: { email: { startsWith: TEST_EMAIL_PREFIX } } };

export type PlanBucket = 'free_active' | 'free_ended' | 'essential' | 'solo' | 'family' | 'extended';

export interface AdminCustomer {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  planBucket: PlanBucket;
  planLabel: string;
  subscriptionStatus: string;
  trialDaysLeft: number | null;
  parents: number;
  calls7d: number;
  lastCallAt: string | null;
}

export interface AdminDay {
  date: string; // IST YYYY-MM-DD
  label: string;
  answered: number;
  notAnswered: number;
  pending: number;
  total: number;
}

export interface AdminAlert {
  id: string;
  level: number;
  title: string;
  parentName: string;
  customerName: string;
  customerEmail: string;
  createdAt: string;
}

export interface AdminStats {
  generatedAt: string;
  customers: { total: number; new7d: number; new30d: number };
  plans: {
    buckets: Record<PlanBucket, number>;
    payingActive: number;
    onPaidTrial: number;
    pastDue: number;
    cancelling: number;
    estimatedMrr: number;
  };
  parents: { active: number; paused: number; archived: number };
  calls: {
    today: number;
    last30: number;
    answered30: number;
    answerRatePct: number | null;
    /** Answered calls with a recorded length (last 30 days): what Sarvam bills (every started minute). */
    length: { calls: number; avgSeconds: number | null; avgBilledMinutes: number | null; over60Pct: number | null; estMonthlyCostPerParent: number | null };
    byStatus30: Record<string, number>;
    days: AdminDay[];
  };
  customerList: AdminCustomer[];
  alerts: AdminAlert[];
  engagement: AdminEngagement;
}

/** Is it working for families? (docs/v1-care-plan.md §6: measure it.) */
export interface AdminEngagement {
  familiesWithParents: number;
  activeFamilies7d: number;
  familyMembers: number;
  alertsNeedingAction30: number;
  alertsActedOn30: number;
  escalations30: { total: number; handled: number; exhausted: number };
  parentConsent: { given: number; pending: number; said_no: number };
  cancelReasons: { reason: string; at: string }[];
}

/** Engagement numbers; real customers only (test accounts are filtered like the rest of the page). */
async function getEngagement(now: Date): Promise<AdminEngagement> {
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const real = { user: realUser };
  const [families, active, members, needing, actedOn, escalations, consent, cancels] = await Promise.all([
    prisma.user.count({ where: { ...realUser, parents: { some: { isDeleted: false } } } }),
    prisma.user.count({ where: { ...realUser, parents: { some: { isDeleted: false } }, lastSeenAt: { gte: since7 } } }),
    prisma.caregiverInvite.count({ where: { status: 'accepted', parent: real } }),
    prisma.alertRecord.count({ where: { level: { gte: 2 }, createdAt: { gte: since30 }, parent: real } }),
    prisma.alertRecord.count({
      where: { level: { gte: 2 }, createdAt: { gte: since30 }, parent: real, OR: [{ acknowledgedAt: { not: null } }, { outcome: { not: null } }] }
    }),
    prisma.escalation.groupBy({ by: ['status'], where: { kind: { not: 'practice' }, createdAt: { gte: since30 }, parent: real }, _count: true }),
    prisma.parentProfile.groupBy({ by: ['parentConsent'], where: { isDeleted: false, ...real }, _count: true }),
    prisma.userSubscription.findMany({
      where: { cancelReason: { not: null }, user: realUser },
      orderBy: { cancelledAt: 'desc' },
      take: 20,
      select: { cancelReason: true, cancelledAt: true, updatedAt: true }
    })
  ]);
  const escCount = (st: string) => escalations.find(e => e.status === st)?._count || 0;
  const consentCount = (vals: Array<string | null>) =>
    consent.filter(c => vals.includes(c.parentConsent)).reduce((n, c) => n + c._count, 0);
  return {
    familiesWithParents: families,
    activeFamilies7d: active,
    familyMembers: members,
    alertsNeedingAction30: needing,
    alertsActedOn30: actedOn,
    escalations30: {
      total: escalations.reduce((n, e) => n + e._count, 0),
      handled: escCount('handled') + escCount('closed'),
      exhausted: escCount('exhausted')
    },
    parentConsent: { given: consentCount(['given']), pending: consentCount(['pending', null]), said_no: consentCount(['declined', 'withdrawn']) },
    cancelReasons: cancels.map(c => ({ reason: c.cancelReason || '', at: (c.cancelledAt || c.updatedAt).toISOString() }))
  };
}

function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function bucketFor(planId: PlanId, expired: boolean): PlanBucket {
  if (planId === 'essential') return 'essential';
  if (planId === 'solo') return 'solo';
  if (planId === 'family') return 'family';
  if (planId === 'extended') return 'extended';
  return expired ? 'free_ended' : 'free_active';
}

const RUPEES_PER_BILLED_MINUTE = 4.9;

/** How long the answered calls ran, and what that costs (Sarvam bills every started minute; a call over 60 s is 2 minutes). */
export function callLength(calls: Array<{ status: string; durationSeconds: number }>) {
  const timed = calls.filter(c => c.status === 'answered' && c.durationSeconds > 0);
  if (timed.length === 0) return { calls: 0, avgSeconds: null, avgBilledMinutes: null, over60Pct: null, estMonthlyCostPerParent: null };
  const seconds = timed.reduce((a, c) => a + c.durationSeconds, 0) / timed.length;
  const billed = timed.reduce((a, c) => a + Math.ceil(c.durationSeconds / 60), 0) / timed.length;
  const over = timed.filter(c => c.durationSeconds > 60).length;
  return {
    calls: timed.length,
    avgSeconds: Math.round(seconds),
    avgBilledMinutes: Math.round(billed * 100) / 100,
    over60Pct: Math.round((over / timed.length) * 100),
    // 3 calls a day for 30 days at the average billed length
    estMonthlyCostPerParent: Math.round(billed * 3 * 30 * RUPEES_PER_BILLED_MINUTE)
  };
}

export async function getAdminStats(now: Date = new Date()): Promise<AdminStats> {
  const since30 = new Date(now.getTime() - CALL_WINDOW_DAYS * DAY_MS);

  const [users, calls, alertRows, engagement] = await Promise.all([
    prisma.user.findMany({
      where: realUser,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        subscription: { select: { planId: true, status: true, currentPeriodEnd: true, trialEndsAt: true, amount: true } },
        parents: { select: { id: true, isDeleted: true, isPaused: true } }
      }
    }),
    prisma.callLog.findMany({
      where: { createdAt: { gte: since30 }, parent: { user: realUser } },
      select: { status: true, callDate: true, createdAt: true, parentId: true, durationSeconds: true, parent: { select: { userId: true } } }
    }),
    prisma.alertRecord.findMany({
      where: { parent: { user: realUser } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        level: true,
        title: true,
        createdAt: true,
        parent: { select: { name: true, user: { select: { name: true, email: true } } } }
      }
    }),
    getEngagement(now)
  ]);

  // ---- calls -------------------------------------------------------------
  const today = istDateString(now);
  const dayKeys: string[] = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) dayKeys.push(istDateString(new Date(now.getTime() - i * DAY_MS)));
  const days = new Map<string, AdminDay>(
    dayKeys.map((date) => [date, { date, label: dayLabel(date), answered: 0, notAnswered: 0, pending: 0, total: 0 }])
  );

  const byStatus30: Record<string, number> = {};
  const callsByUser7d = new Map<string, number>();
  const lastCallByUser = new Map<string, Date>();
  const since7 = istDateString(new Date(now.getTime() - 6 * DAY_MS));
  let callsToday = 0;
  let answered30 = 0;
  let finished30 = 0;

  for (const c of calls) {
    const date = c.callDate || istDateString(c.createdAt);
    byStatus30[c.status] = (byStatus30[c.status] || 0) + 1;
    if (c.status === 'answered') answered30++;
    if (['answered', 'unanswered', 'busy', 'failed'].includes(c.status)) finished30++;
    if (date === today) callsToday++;

    const day = days.get(date);
    if (day) {
      day.total++;
      if (c.status === 'answered') day.answered++;
      else if (['unanswered', 'busy', 'failed'].includes(c.status)) day.notAnswered++;
      else day.pending++;
    }

    const userId = c.parent.userId;
    if (date >= since7) callsByUser7d.set(userId, (callsByUser7d.get(userId) || 0) + 1);
    const prev = lastCallByUser.get(userId);
    if (!prev || c.createdAt > prev) lastCallByUser.set(userId, c.createdAt);
  }

  // ---- customers, plans, parents ----------------------------------------
  const buckets: Record<PlanBucket, number> = { free_active: 0, free_ended: 0, essential: 0, solo: 0, family: 0, extended: 0 };
  let payingActive = 0;
  let onPaidTrial = 0;
  let pastDue = 0;
  let cancelling = 0;
  let estimatedMrr = 0;
  const parents = { active: 0, paused: 0, archived: 0 };
  const customerList: AdminCustomer[] = [];

  for (const u of users) {
    const sub = u.subscription
      ? {
          planId: u.subscription.planId as PlanId,
          status: u.subscription.status,
          currentPeriodEnd: u.subscription.currentPeriodEnd.toISOString()
        }
      : null;
    const plan = getEffectivePlan(sub, u.createdAt, now);
    const bucket = bucketFor(plan.id, !!plan.expired);
    buckets[bucket]++;

    const status = plan.id === 'free' ? (plan.expired ? 'ended' : 'trial') : sub?.status || 'active';
    if (plan.id !== 'free') {
      if (status === 'active') {
        payingActive++;
        // What is charged: the plan plus its add-ons (the subscription row holds the total).
        estimatedMrr += u.subscription?.amount || PLANS[plan.id].priceMonthly;
      } else if (status === 'trialing') onPaidTrial++;
      else if (status === 'past_due') pastDue++;
      else if (status === 'cancelled') cancelling++;
    }

    let trialDaysLeft: number | null = null;
    if (plan.id === 'free' && !plan.expired) trialDaysLeft = freeTrialDaysLeft(u.createdAt, now);
    else if (status === 'trialing' && u.subscription?.trialEndsAt) {
      trialDaysLeft = Math.max(0, Math.ceil((u.subscription.trialEndsAt.getTime() - now.getTime()) / DAY_MS));
    }

    const liveParents = u.parents.filter((p) => !p.isDeleted);
    for (const p of u.parents) {
      if (p.isDeleted) parents.archived++;
      else if (p.isPaused) parents.paused++;
      else parents.active++;
    }

    if (customerList.length < CUSTOMER_LIMIT) {
      customerList.push({
        id: u.id,
        name: u.name,
        email: u.email,
        createdAt: u.createdAt.toISOString(),
        planBucket: bucket,
        planLabel: plan.name,
        subscriptionStatus: status,
        trialDaysLeft,
        parents: liveParents.length,
        calls7d: callsByUser7d.get(u.id) || 0,
        lastCallAt: lastCallByUser.get(u.id)?.toISOString() || null
      });
    }
  }

  const ms7 = now.getTime() - 7 * DAY_MS;
  const ms30 = now.getTime() - 30 * DAY_MS;

  return {
    generatedAt: now.toISOString(),
    customers: {
      total: users.length,
      new7d: users.filter((u) => u.createdAt.getTime() >= ms7).length,
      new30d: users.filter((u) => u.createdAt.getTime() >= ms30).length
    },
    plans: { buckets, payingActive, onPaidTrial, pastDue, cancelling, estimatedMrr },
    parents,
    calls: {
      today: callsToday,
      last30: calls.length,
      answered30,
      answerRatePct: finished30 ? Math.round((answered30 / finished30) * 100) : null,
      length: callLength(calls),
      byStatus30,
      days: dayKeys.map((k) => days.get(k)!)
    },
    customerList,
    alerts: alertRows.map((a) => ({
      id: a.id,
      level: a.level,
      title: a.title,
      parentName: a.parent.name,
      customerName: a.parent.user.name,
      customerEmail: a.parent.user.email,
      createdAt: a.createdAt.toISOString()
    })),
    engagement
  };
}
