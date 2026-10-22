/**
 * Gives ONE account a free pilot plan for a few weeks, without Razorpay (launch plan, Phase 4).
 *
 *   npx tsx scripts/grant-pilot.ts amma.son@gmail.com                      # dry run: shows what would change
 *   npx tsx scripts/grant-pilot.ts amma.son@gmail.com --confirm            # Solo, 30 days
 *   npx tsx scripts/grant-pilot.ts amma.son@gmail.com --plan family --days 45 --monitor --confirm
 *
 * A pilot = status 'active', amount 0, no Razorpay subscription. It works like the plan until
 * currentPeriodEnd (+ the usual PAID_GRACE_DAYS), then lapses like any unpaid plan and the family can
 * pay through checkout (they still get the 7-day trial: no invoice is written, nothing was charged).
 * /admin counts these as "Free pilot", never as paying or revenue.
 * Refuses to touch an account that has a Razorpay subscription still running.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { PLANS, PAID_PLAN_IDS, cleanAddons } from '../src/lib/plans';
import { PlanId } from '../src/lib/types';

const DAY_MS = 86400000;
const MAX_DAYS = 60;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const confirm = process.argv.includes('--confirm');
  const planId = (arg('plan') || 'solo') as PlanId;
  const days = Number(arg('days') || 30);

  if (!email.includes('@')) {
    console.error('Usage: npx tsx scripts/grant-pilot.ts <email> [--plan solo|family|extended|essential] [--days 30] [--monitor] [--confirm]');
    process.exit(1);
  }
  if (!PAID_PLAN_IDS.includes(planId)) {
    console.error(`Unknown plan "${planId}". Use one of: ${PAID_PLAN_IDS.join(', ')}.`);
    process.exit(1);
  }
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    console.error(`--days must be a whole number from 1 to ${MAX_DAYS}.`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, subscription: true } });
  if (!user) {
    console.error(`No account for ${email}. The family signs up first, then you run this.`);
    process.exit(1);
  }

  const now = new Date();
  const current = user.subscription;
  if (current?.razorpaySubscriptionId && ['active', 'trialing', 'past_due'].includes(current.status) && current.currentPeriodEnd > now) {
    console.error(`Refusing: ${email} has a running Razorpay subscription (${current.planId}, ${current.status}). Don't overwrite a paying customer.`);
    process.exit(1);
  }

  const { healthMonitor } = cleanAddons(planId, { healthMonitor: process.argv.includes('--monitor') });
  const periodEnd = new Date(now.getTime() + days * DAY_MS);
  const fields = {
    planId,
    status: 'active',
    startDate: now,
    trialEndsAt: null,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    amount: 0,
    healthMonitor,
    dailyTouches: false,
    paymentMethodLast4: null,
    paymentMethodBrand: null,
    razorpaySubscriptionId: null,
    razorpayPaymentId: null
  };

  console.log(`Account: ${user.name} <${email}>`);
  console.log(`Now:     ${current ? `${current.planId} / ${current.status} until ${current.currentPeriodEnd.toISOString().slice(0, 10)}` : 'no subscription row'}`);
  console.log(`Pilot:   ${PLANS[planId].name}${healthMonitor ? ' + Health Monitor' : ''}, free for ${days} days, until ${periodEnd.toISOString().slice(0, 10)}`);

  if (!confirm) {
    console.log('\nDry run: nothing changed. Add --confirm to apply.');
    return;
  }
  await prisma.userSubscription.upsert({
    where: { userId: user.id },
    create: { id: `sub_pilot_${user.id}`, userId: user.id, ...fields },
    update: fields
  });
  console.log('\nDone. The family can add their parent now.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
