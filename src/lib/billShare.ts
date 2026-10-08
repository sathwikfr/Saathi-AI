/**
 * Siblings sharing the bill. One person pays Aaptha as usual (the account owner).
 * Family members the owner marks as "shares the bill" see their equal share and a UPI
 * button that pays the owner directly. Aaptha never holds or moves the money; it only
 * keeps a "paid for this month" note so everyone can see who has chipped in.
 */
import { prisma } from './prisma';
import { newId } from './db';
import { getEffectivePlan } from './plans';
import { PlanId } from './types';
import { istMonth, shareAmount, upiLink, isValidUpiId } from './familyMoney';

async function ownerPlanPrice(ownerId: string): Promise<{ price: number; planName: string; paid: boolean }> {
  const user = await prisma.user.findUnique({ where: { id: ownerId }, include: { subscription: true } });
  if (!user) return { price: 0, planName: '', paid: false };
  const sub = user.subscription;
  const plan = getEffectivePlan(
    sub ? { planId: sub.planId as PlanId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString() } : null,
    user.createdAt
  );
  return { price: plan.expired ? 0 : plan.priceMonthly, planName: plan.name, paid: !plan.expired && plan.priceMonthly > 0 };
}

/** Accepted family members across all of the owner's parents (one row per person). */
async function membersOf(ownerId: string) {
  const invites = await prisma.caregiverInvite.findMany({
    where: { status: 'accepted', userId: { not: null }, parent: { userId: ownerId, isDeleted: false } },
    select: { userId: true, name: true, sharesBill: true }
  });
  const byUser = new Map<string, { userId: string; name: string; sharesBill: boolean }>();
  for (const i of invites) {
    const prev = byUser.get(i.userId!);
    byUser.set(i.userId!, { userId: i.userId!, name: prev?.name || i.name, sharesBill: (prev?.sharesBill || false) || i.sharesBill });
  }
  byUser.delete(ownerId);
  return [...byUser.values()];
}

export async function ownerView(ownerId: string, now: Date = new Date()) {
  const [owner, plan, members] = await Promise.all([
    prisma.user.findUnique({ where: { id: ownerId }, select: { upiId: true, name: true } }),
    ownerPlanPrice(ownerId),
    membersOf(ownerId)
  ]);
  const month = istMonth(now);
  const sharers = members.filter(m => m.sharesBill);
  const amount = shareAmount(plan.price, sharers.length + 1);
  const paidRows = await prisma.billShare.findMany({ where: { ownerId, month } });
  return {
    upiId: owner?.upiId || null,
    planName: plan.planName,
    planPrice: plan.price,
    month,
    perPerson: sharers.length ? amount : plan.price,
    members: members.map(m => ({
      ...m,
      paidThisMonth: !!paidRows.find(r => r.memberId === m.userId && r.paidMarkedAt)
    }))
  };
}

/** What a family member owes, to each owner whose bill they share. */
export async function memberView(memberId: string, now: Date = new Date()) {
  const invites = await prisma.caregiverInvite.findMany({
    where: { userId: memberId, status: 'accepted', sharesBill: true, parent: { isDeleted: false } },
    select: { parent: { select: { userId: true } } }
  });
  const ownerIds = [...new Set(invites.map(i => i.parent.userId))].filter(id => id !== memberId);
  const month = istMonth(now);
  const out = [];
  for (const ownerId of ownerIds) {
    const view = await ownerView(ownerId, now);
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } });
    if (!view.planPrice) continue;
    const paid = await prisma.billShare.findUnique({ where: { ownerId_memberId_month: { ownerId, memberId, month } } });
    out.push({
      ownerId,
      ownerName: owner?.name || 'Your family',
      planName: view.planName,
      month,
      amount: view.perPerson,
      upiId: view.upiId,
      upiLink: view.upiId
        ? upiLink({ upiId: view.upiId, payeeName: owner?.name || 'Aaptha share', amount: view.perPerson, note: `Aaptha ${view.planName} ${month}` })
        : null,
      paidThisMonth: !!paid?.paidMarkedAt
    });
  }
  return out;
}

export async function setUpiId(ownerId: string, upiId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (upiId && !isValidUpiId(upiId)) return { ok: false, error: 'That doesn\'t look like a UPI ID (for example name@okbank).' };
  await prisma.user.update({ where: { id: ownerId }, data: { upiId: upiId ? upiId.trim() : null } });
  return { ok: true };
}

/** The owner chooses who shares the bill (applies to all of that person's invites on the owner's parents). */
export async function setSharesBill(ownerId: string, memberId: string, shares: boolean): Promise<boolean> {
  const res = await prisma.caregiverInvite.updateMany({
    where: { userId: memberId, status: 'accepted', parent: { userId: ownerId } },
    data: { sharesBill: shares }
  });
  return res.count > 0;
}

export async function markSharePaid(ownerId: string, memberId: string, paid: boolean, now: Date = new Date()) {
  const view = (await memberView(memberId, now)).find(v => v.ownerId === ownerId);
  if (!view) return { ok: false as const, error: 'You are not sharing this bill.' };
  const month = istMonth(now);
  await prisma.billShare.upsert({
    where: { ownerId_memberId_month: { ownerId, memberId, month } },
    create: { id: newId('share'), ownerId, memberId, month, amount: view.amount, paidMarkedAt: paid ? now : null },
    update: { paidMarkedAt: paid ? now : null, amount: view.amount }
  });
  return { ok: true as const };
}
