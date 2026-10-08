/**
 * What the account OWNER's plan and add-ons switch on for a parent (a family member's own plan doesn't matter).
 * Server-only (reads the database); `plans.ts` stays client-safe.
 *
 *   plan.premium   Family / Extended: one call for a couple sharing a phone, the timeline.
 *   Health Monitor add-on (any calling plan): BP / sugar by voice, the chart, health trends, the short readings call.
 *   Daily Touches add-on (any calling plan): festival / birthday wishes, weather notes, the helper check.
 * Family messages and life stories were removed (2026-10-08).
 */
import { NextResponse } from 'next/server';
import { prisma } from './prisma';
import { getEffectivePlan, PLANS, HEALTH_MONITOR, DAILY_TOUCHES, healthMonitorAvailable, dailyTouchesAvailable } from './plans';
import { Plan, PlanId } from './types';

async function ownerSubscription(userId: string, now: Date) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { subscription: true } });
  const sub = user?.subscription;
  const plan = getEffectivePlan(
    sub ? { planId: sub.planId as PlanId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString() } : null,
    user?.createdAt,
    now
  );
  return { sub, plan };
}

export async function ownerPlanFor(userId: string, now: Date = new Date()): Promise<Plan> {
  return (await ownerSubscription(userId, now)).plan;
}

/** Health Monitor bought, on a plan that still counts (not expired or lapsed). */
export async function ownerHasHealthMonitor(userId: string, now: Date = new Date()): Promise<boolean> {
  const { sub, plan } = await ownerSubscription(userId, now);
  return !!sub?.healthMonitor && !plan.expired && healthMonitorAvailable(plan.id);
}

/** Daily Touches bought, on a plan that still counts. */
export async function ownerHasDailyTouches(userId: string, now: Date = new Date()): Promise<boolean> {
  const { sub, plan } = await ownerSubscription(userId, now);
  return !!sub?.dailyTouches && !plan.expired && dailyTouchesAvailable(plan.id);
}

/** BP / sugar by voice, health trends: the Health Monitor add-on. */
export async function canTrackReadings(userId: string, now: Date = new Date()): Promise<boolean> {
  return ownerHasHealthMonitor(userId, now);
}

/** Family and Extended features: the couple call and the timeline. */
export async function isPremiumParent(parentOwnerId: string, now: Date = new Date()): Promise<boolean> {
  return (await ownerPlanFor(parentOwnerId, now)).premium;
}

/** 402 for a Family / Extended feature on a smaller plan, with where to upgrade. */
export function premiumRequired(feature: string): NextResponse {
  return NextResponse.json(
    {
      error: `${feature} comes with ${PLANS.family.name} and ${PLANS.extended.name}.`,
      code: 'PLAN_UPGRADE_REQUIRED',
      upgradePlanId: 'family'
    },
    { status: 402 }
  );
}

/** 402 for BP / sugar / trends without the Health Monitor add-on. */
export function readingsRequired(): NextResponse {
  return NextResponse.json(
    {
      error: `BP and sugar tracking is the ${HEALTH_MONITOR.name} add-on. You can add it from your plan page.`,
      code: 'PLAN_UPGRADE_REQUIRED',
      addon: HEALTH_MONITOR.id
    },
    { status: 402 }
  );
}

/** 402 for festivals, weather and the helper check without the Daily Touches add-on. */
export function touchesRequired(): NextResponse {
  return NextResponse.json(
    {
      error: `Festival wishes, weather notes and the helper check are the ${DAILY_TOUCHES.name} add-on. You can add it from your plan page.`,
      code: 'PLAN_UPGRADE_REQUIRED',
      addon: DAILY_TOUCHES.id
    },
    { status: 402 }
  );
}
