import { prisma } from './prisma';
import { FREE_TRIAL_DAYS, freeTrialEnd, getEffectivePlan } from './plans';
import { sendTrialEmail as defaultSendTrialEmail } from './email';
import { sendOnce } from './emailLog';
import type { PlanId } from './types';

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

/** Free trial: "ends soon" goes out 48 hours before the end, "ended" for up to 3 days after it. */
const FREE_ENDING_WINDOW_MS = 48 * HOUR_MS;
const FREE_ENDED_GRACE_MS = 3 * DAY_MS;
/** Paid trial: warn 3 days before the first monthly charge. */
const PAID_ENDING_WINDOW_MS = 3 * DAY_MS;

export interface LifecycleSummary {
  freeEnding: number;
  freeEnded: number;
  paidEnding: number;
  duplicates: number;
  failed: number;
}

export interface LifecycleOptions {
  now?: Date;
  /** Restrict to these accounts (tests use this so real customers are never emailed). */
  userIds?: string[];
  send?: typeof defaultSendTrialEmail;
}

/**
 * Trial reminder emails, run from the cron endpoint. Each email is claimed in EmailLog first, so
 * running every few minutes (or twice at once) never sends the same reminder twice, and a failed
 * send is retried on the next run. Accounts whose trial ended long ago are never emailed, so the
 * first run after deploying does not mail old accounts.
 */
export async function runLifecycleEmails(opts: LifecycleOptions = {}): Promise<LifecycleSummary> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? defaultSendTrialEmail;
  const summary: LifecycleSummary = { freeEnding: 0, freeEnded: 0, paidEnding: 0, duplicates: 0, failed: 0 };
  const scope = opts.userIds ? { in: opts.userIds } : undefined;

  const record = (result: 'sent' | 'duplicate' | 'failed', counter: 'freeEnding' | 'freeEnded' | 'paidEnding') => {
    if (result === 'sent') summary[counter] += 1;
    else if (result === 'duplicate') summary.duplicates += 1;
    else summary.failed += 1;
  };

  // ---- Free trial (7 days from account creation) ----
  const newest = new Date(now.getTime() - (FREE_TRIAL_DAYS * DAY_MS - FREE_ENDING_WINDOW_MS));
  const oldest = new Date(now.getTime() - (FREE_TRIAL_DAYS * DAY_MS + FREE_ENDED_GRACE_MS));
  // Only accounts with a parent on the free plan (added before payment details were required) have
  // calls to lose; an account that never added a parent gets no "calls will stop" email.
  const freeUsers = await prisma.user.findMany({
    where: {
      createdAt: { gte: oldest, lte: newest },
      parents: { some: { isDeleted: false } },
      ...(scope ? { id: scope } : {})
    },
    include: { subscription: true }
  });

  for (const user of freeUsers) {
    const sub = user.subscription
      ? { planId: user.subscription.planId as PlanId, status: user.subscription.status, currentPeriodEnd: user.subscription.currentPeriodEnd.toISOString() }
      : null;
    if (getEffectivePlan(sub, user.createdAt, now).id !== 'free') continue; // has a paid plan

    const endsAt = freeTrialEnd(user.createdAt);
    const msLeft = endsAt.getTime() - now.getTime();
    const claim = { userId: user.id, refKey: 'free-trial', failOpen: false };

    if (msLeft > 0 && msLeft <= FREE_ENDING_WINDOW_MS) {
      const result = await sendOnce({ ...claim, kind: 'trial_ending' }, () =>
        send({ variant: 'free_ending', to: user.email, name: user.name, endsOn: endsAt })
      );
      record(result, 'freeEnding');
    } else if (msLeft <= 0 && msLeft > -FREE_ENDED_GRACE_MS) {
      const result = await sendOnce({ ...claim, kind: 'trial_ended' }, () =>
        send({ variant: 'free_ended', to: user.email, name: user.name, endedOn: endsAt })
      );
      record(result, 'freeEnded');
    }
  }

  // ---- Paid plan's free trial, about to turn into the first monthly charge ----
  const paidTrials = await prisma.userSubscription.findMany({
    where: {
      planId: { in: ['essential', 'solo', 'family', 'extended'] },
      status: { in: ['trialing', 'active'] },
      cancelAtPeriodEnd: false,
      razorpaySubscriptionId: { not: null },
      trialEndsAt: { gt: now, lte: new Date(now.getTime() + PAID_ENDING_WINDOW_MS) },
      ...(scope ? { userId: scope } : {})
    },
    include: { user: true }
  });

  for (const sub of paidTrials) {
    if (!sub.trialEndsAt) continue;
    const plan = getEffectivePlan({ planId: sub.planId as PlanId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString() }, sub.user.createdAt, now);
    const result = await sendOnce(
      // One reminder per trial: a later re-subscription has a different trial end, so gets its own.
      { userId: sub.userId, kind: 'paid_trial_ending', refKey: sub.trialEndsAt.toISOString().slice(0, 10), failOpen: false },
      () =>
        send({
          variant: 'paid_ending',
          to: sub.user.email,
          name: sub.user.name,
          planName: plan.name,
          amount: plan.priceMonthly,
          chargeOn: sub.trialEndsAt as Date
        })
    );
    record(result, 'paidEnding');
  }

  return summary;
}
