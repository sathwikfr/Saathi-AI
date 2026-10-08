/**
 * The plan that applies to a parent: always the account OWNER's plan (a family member's own plan doesn't matter).
 * Server-only (reads the database); `plans.ts` stays client-safe.
 */
import { NextResponse } from 'next/server';
import { prisma } from './prisma';
import { getEffectivePlan, PLANS } from './plans';
import { Plan, PlanId } from './types';

export async function ownerPlanFor(userId: string, now: Date = new Date()): Promise<Plan> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { subscription: true } });
  const sub = user?.subscription;
  return getEffectivePlan(
    sub ? { planId: sub.planId as PlanId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString() } : null,
    user?.createdAt,
    now
  );
}

/** Family and Extended features (BP/sugar, trends, family messages, appointments, festivals, stories, couple calls). */
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
