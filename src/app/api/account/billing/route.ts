import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import {
  getUserInvoices,
  cancelSubscription,
  reactivateSubscription,
  updateUserSubscription,
  getParentsForUser
} from '@/lib/db';
import { PlanId } from '@/lib/types';
import { PLANS, getEffectivePlan } from '@/lib/plans';
import { cancelRazorpaySubscription } from '@/lib/razorpay';
import { sendOnce } from '@/lib/emailLog';

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const invoices = await getUserInvoices(user.id);

  return NextResponse.json({
    user,
    subscription: user.subscription || null,
    currentPlan: getEffectivePlan(user.subscription, user.createdAt),
    invoices
  });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    const { action, newPlanId, reason } = await req.json();

    if (action === 'cancel') {
      if (!user.subscription || user.subscription.planId === 'free') {
        return NextResponse.json({ error: 'There is no paid subscription to cancel.' }, { status: 400 });
      }
      await cancelRazorpaySubscription(user.subscription.razorpaySubscriptionId, true);
      const ok = await cancelSubscription(user.id, typeof reason === 'string' ? reason : null);
      console.log(`User ${user.id} cancelled subscription. Reason: ${reason || 'Not specified'}`);

      const plan = PLANS[user.subscription.planId];
      const accessUntil = new Date(user.subscription.currentPeriodEnd).toLocaleDateString('en-IN', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

      const { sendSubscriptionCancelledEmail } = await import('@/lib/email');
      // Same key the Razorpay webhook uses, so the customer gets one cancellation email, not two.
      await sendOnce(
        { userId: user.id, kind: 'subscription_ended', refKey: user.subscription.razorpaySubscriptionId || user.subscription.id, failOpen: true },
        () => sendSubscriptionCancelledEmail({ to: user.email, name: user.name, planName: plan.name, accessUntil })
      );

      return NextResponse.json({
        success: ok,
        message: `Your subscription will end on ${accessUntil}. Check-in calls continue until then.`
      });
    }

    if (action === 'reactivate') {
      const ok = await reactivateSubscription(user.id);
      if (!ok) {
        return NextResponse.json(
          { error: 'This subscription can no longer be reactivated. Please choose a plan again.' },
          { status: 400 }
        );
      }
      return NextResponse.json({ success: true, message: 'Your subscription has been reactivated.' });
    }

    if (action === 'switch-plan') {
      const target = PLANS[newPlanId as PlanId];
      if (!target) {
        return NextResponse.json({ error: 'Invalid plan selected' }, { status: 400 });
      }

      // Paid plans are only activated after a verified Razorpay checkout.
      if (target.priceMonthly > 0) {
        return NextResponse.json(
          {
            error: 'Paid plans need checkout.',
            requiresCheckout: true,
            checkoutUrl: `/checkout/confirm?plan=${target.id}`
          },
          { status: 402 }
        );
      }

      const parents = await getParentsForUser(user.id);
      if (parents.length > target.parentsIncluded) {
        return NextResponse.json(
          {
            error: `${target.name} includes ${target.parentsIncluded} parent profile. Please archive ${parents.length - target.parentsIncluded} profile(s) before downgrading.`
          },
          { status: 400 }
        );
      }

      // Downgrade to Free: stop future Razorpay charges immediately.
      await cancelRazorpaySubscription(user.subscription?.razorpaySubscriptionId, false);
      const updated = await updateUserSubscription(user.id, { planId: 'free' });

      return NextResponse.json({
        success: true,
        message: `Plan changed to ${target.name}.`,
        subscription: updated
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Billing action error:', err);
    return NextResponse.json({ error: 'Failed to update billing settings.' }, { status: 500 });
  }
}
