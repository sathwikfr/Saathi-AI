import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { cancelRazorpaySubscription, invoiceNumberForPayment, verifySubscriptionPayment } from '@/lib/razorpay';
import { updateUserSubscription, getParentsForUser } from '@/lib/db';
import { PlanId } from '@/lib/types';
import { PLANS, cleanAddons, monthlyPrice, carriedPeriod } from '@/lib/plans';
import { formatEmailDate, sendSubscriptionActivatedEmail } from '@/lib/email';
import { markEmailSent, sendOnce } from '@/lib/emailLog';

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, planId, paymentMethodBrand, healthMonitor: wantsMonitor } = await req.json();

    if (!razorpay_payment_id || !razorpay_subscription_id) {
      return NextResponse.json({ error: 'Missing payment or subscription identifiers.' }, { status: 400 });
    }

    const plan = PLANS[planId as PlanId];
    if (!plan || plan.priceMonthly === 0) {
      return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 });
    }

    const { healthMonitor } = cleanAddons(planId as PlanId, { healthMonitor: wantsMonitor === true });
    const price = monthlyPrice(planId as PlanId, healthMonitor);
    const planLabel = `${plan.name}${healthMonitor ? ' + Health Monitor' : ''}`;

    const verification = await verifySubscriptionPayment({
      paymentId: String(razorpay_payment_id),
      subscriptionId: String(razorpay_subscription_id),
      signature: String(razorpay_signature || ''),
      userId: user.id,
      planId: planId as PlanId,
      healthMonitor
    });

    if (!verification.ok) {
      return NextResponse.json({ error: verification.error }, { status: 400 });
    }

    // A plan that is smaller than the parents already added must not be activated (checkout only checked at the start).
    const parentCount = (await getParentsForUser(user.id)).length;
    if (parentCount > plan.parentsIncluded) {
      return NextResponse.json(
        { error: `You have ${parentCount} parents on your account and ${plan.name} includes ${plan.parentsIncluded}. Please choose a bigger plan.`, code: 'PLAN_TOO_SMALL' },
        { status: 400 }
      );
    }

    const previousSubscriptionId = user.subscription?.razorpaySubscriptionId;
    // Already activated (a double submit or a replay): don't restart the trial dates.
    if (previousSubscriptionId === String(razorpay_subscription_id) && user.subscription?.planId === planId && !!user.subscription?.healthMonitor === healthMonitor) {
      return NextResponse.json({ success: true, message: 'Subscription is already active.', subscription: user.subscription });
    }
    const invoiceNumber = invoiceNumberForPayment(String(razorpay_payment_id));
    // Paid days left on the old plan carry over: the new plan's first charge is on the day that period ends.
    const carry = carriedPeriod(user.subscription) || undefined;
    const updatedSub = await updateUserSubscription(user.id, {
      planId: planId as PlanId,
      razorpaySubscriptionId: String(razorpay_subscription_id),
      razorpayPaymentId: String(razorpay_payment_id),
      paymentMethodBrand: verification.isSandbox ? 'Sandbox (no charge)' : (paymentMethodBrand || 'Razorpay').toString().slice(0, 40),
      invoiceNumber,
      // Same rule as at checkout: only the first paid subscription gets the free trial.
      noTrial: !!previousSubscriptionId,
      healthMonitor,
      carry
    });

    // Switching from another paid plan: stop the old Razorpay subscription so the customer isn't
    // charged for both. Its webhooks no longer match this account's row, so they are ignored.
    if (previousSubscriptionId && previousSubscriptionId !== String(razorpay_subscription_id)) {
      try {
        await cancelRazorpaySubscription(previousSubscriptionId, false);
      } catch (err) {
        console.error(`[payments] Could not cancel replaced subscription ${previousSubscriptionId} for ${user.id}; cancel it in the Razorpay dashboard.`, err);
      }
    }

    // Tell the customer their subscription is active. Awaited (not fire-and-forget) so a
    // serverless host can't cut the request off before the email is handed to Resend.
    const paymentMethod = verification.isSandbox ? 'Sandbox (no charge)' : 'Razorpay';
    const hasTrial = !carry && plan.hasTrial && !previousSubscriptionId;
    // A trial or a carried-over period means nothing is charged today.
    const firstChargeDate = formatEmailDate(carry ? carry.periodEnd : new Date(Date.now() + (hasTrial ? plan.trialDays : 30) * 86400000));
    await sendOnce({ userId: user.id, kind: 'subscription_activated', refKey: String(razorpay_subscription_id), failOpen: true }, () =>
      sendSubscriptionActivatedEmail({
        to: user.email,
        name: user.name,
        planName: planLabel,
        monthlyAmount: price,
        paidToday: hasTrial || carry ? 0 : price,
        invoiceNumber,
        paymentMethod,
        trialDays: hasTrial ? plan.trialDays : undefined,
        firstChargeDate,
        parentsIncluded: plan.parentsIncluded
      })
    );
    // Without a trial this payment is charged right now; the webhook must not send a second receipt for it.
    if (!hasTrial && !carry) {
      await markEmailSent({ userId: user.id, kind: 'payment_receipt', refKey: String(razorpay_payment_id) });
    }

    return NextResponse.json({
      success: true,
      message: 'Subscription verified and activated successfully.',
      subscription: updatedSub,
      receiptDetails: {
        paymentId: razorpay_payment_id,
        subscriptionId: razorpay_subscription_id,
        planName: planLabel,
        amount: price,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Verify payment error:', err);
    return NextResponse.json({ error: 'Server error during payment verification.' }, { status: 500 });
  }
}
