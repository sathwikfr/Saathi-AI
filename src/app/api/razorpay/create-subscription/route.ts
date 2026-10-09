import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { createSubscriptionServer, PaymentsUnavailableError } from '@/lib/razorpay';
import { PlanId } from '@/lib/types';
import { PLANS, carriedPeriod } from '@/lib/plans';
import { getParentsForUser, hasHadPaidSubscription } from '@/lib/db';
import { consumeRateLimit } from '@/lib/security';

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    const { planId, healthMonitor } = await req.json();

    if (!planId || !PLANS[planId as PlanId]) {
      return NextResponse.json({ error: 'Invalid plan selected.' }, { status: 400 });
    }
    const plan = PLANS[planId as PlanId];
    if (plan.priceMonthly === 0) {
      return NextResponse.json({ error: 'Free plan does not require payment processing.' }, { status: 400 });
    }
    // Don't take payment for a plan that can't hold the parents already added.
    const parentCount = (await getParentsForUser(user.id)).length;
    if (parentCount > plan.parentsIncluded) {
      return NextResponse.json(
        {
          error: `You have ${parentCount} parents on your account and ${plan.name} includes ${plan.parentsIncluded}. Please choose a bigger plan.`,
          code: 'PLAN_TOO_SMALL'
        },
        { status: 400 }
      );
    }

    // Every Razorpay subscription made here is real (and notifies the customer): keep one account from filling it.
    if (!consumeRateLimit(`rzp-create:${user.id}`, 10, 60 * 60 * 1000).allowed) {
      return NextResponse.json({ error: 'Too many checkout attempts. Please try again in a little while.' }, { status: 429 });
    }
    // The 7-day free trial is for the first paid plan only: anyone who has had a Razorpay subscription before pays from day one.
    const subResult = await createSubscriptionServer(
      planId as PlanId,
      { userId: user.id, email: user.email, name: user.name, phone: user.phone || undefined },
      {
        noTrial: await hasHadPaidSubscription(user.id),
        healthMonitor: healthMonitor === true,
        // Paid days left on the current plan are not charged twice: the new plan's first charge waits for them.
        startAt: carriedPeriod(user.subscription)?.periodEnd
      }
    );

    return NextResponse.json({
      success: true,
      subscriptionId: subResult.subscriptionId,
      keyId: subResult.keyId,
      planId: subResult.planId,
      amount: subResult.amount,
      currency: subResult.currency,
      isSandbox: subResult.isSandbox
    });
  } catch (err: unknown) {
    if (err instanceof PaymentsUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error('Create subscription error:', err);
    return NextResponse.json({ error: 'Failed to start checkout. Please try again.' }, { status: 500 });
  }
}
