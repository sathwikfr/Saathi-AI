import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { describeRazorpayPaymentMethod, invoiceNumberForPayment, verifyWebhookSignature } from '@/lib/razorpay';
import { getPlan } from '@/lib/plans';
import { sendOnce } from '@/lib/emailLog';
import { newId } from '@/lib/db';
import {
  formatEmailDate,
  sendPaymentFailedEmail,
  sendPaymentReceiptEmail,
  sendSubscriptionCancelledEmail,
  sendSubscriptionStoppedEmail
} from '@/lib/email';

/**
 * Razorpay webhook. Requires RAZORPAY_WEBHOOK_SECRET; unsigned or wrongly
 * signed requests are rejected. Keeps UserSubscription in sync with the
 * subscription lifecycle in Razorpay and emails the customer about it:
 *   subscription.charged   -> invoice + payment receipt (once per payment)
 *   payment.failed/pending -> "payment failed" (once per failure streak)
 *   subscription.halted    -> "subscription stopped" (Razorpay gave up), plan ends
 *   subscription.cancelled -> "cancelled" (once, even if the customer cancelled in the app too)
 * Razorpay can deliver an event more than once, so every email is deduplicated. A failing email
 * never fails the webhook: the subscription state is already saved.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  try {
    const payload = JSON.parse(rawBody || '{}');
    const event: string = payload.event;
    const subEntity = payload.payload?.subscription?.entity;
    const paymentEntity = payload.payload?.payment?.entity;
    const subscriptionId: string | undefined = subEntity?.id || paymentEntity?.subscription_id;

    if (!subscriptionId) {
      return NextResponse.json({ status: 'ignored' });
    }

    const current = await prisma.userSubscription.findFirst({ where: { razorpaySubscriptionId: subscriptionId } });
    if (!current) {
      console.warn(`[Razorpay Webhook] ${event} for unknown subscription ${subscriptionId}`);
      return NextResponse.json({ status: 'ignored' });
    }

    const now = new Date();
    const periodEnd = subEntity?.current_end ? new Date(subEntity.current_end * 1000) : undefined;
    const plan = getPlan(current.planId);
    const user = await prisma.user.findUnique({ where: { id: current.userId }, select: { id: true, email: true, name: true } });

    switch (event) {
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.resumed':
        await prisma.userSubscription.update({
          where: { id: current.id },
          data: {
            status: 'active',
            cancelAtPeriodEnd: false,
            ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
            ...(paymentEntity?.id ? { razorpayPaymentId: paymentEntity.id } : {})
          }
        });

        // "activated" fires when the mandate is set up (the checkout route already emailed that);
        // a real charge is what gets an invoice and a receipt.
        if (event === 'subscription.charged' && user && paymentEntity?.id && paymentEntity.amount > 0) {
          const paymentId: string = paymentEntity.id;
          const amount = Math.round(paymentEntity.amount / 100);
          const invoiceNumber = invoiceNumberForPayment(paymentId, now);
          const paymentMethod = describeRazorpayPaymentMethod(paymentEntity);

          await sendOnce({ userId: user.id, kind: 'payment_receipt', refKey: paymentId, failOpen: true }, async () => {
            const existing = await prisma.invoice.findFirst({ where: { userId: user.id, invoiceNumber } });
            if (!existing) {
              await prisma.invoice.create({
                data: {
                  id: newId('inv'),
                  userId: user.id,
                  invoiceNumber,
                  date: formatEmailDate(now),
                  amount,
                  planName: `${plan.name} (Monthly)`,
                  status: 'paid',
                  paymentMethod
                }
              });
            }
            return sendPaymentReceiptEmail({
              to: user.email,
              name: user.name,
              planName: plan.name,
              amount,
              invoiceNumber,
              date: formatEmailDate(now),
              nextBillingDate: periodEnd ? formatEmailDate(periodEnd) : undefined,
              paymentMethod
            });
          });
        }
        break;

      case 'subscription.pending':
      case 'payment.failed': {
        // Only the first failure of a streak moves the plan to past_due and emails; retries of the
        // same failure, and events for an already cancelled plan, change nothing.
        const moved = await prisma.userSubscription.updateMany({
          where: { id: current.id, status: { notIn: ['past_due', 'cancelled'] } },
          data: { status: 'past_due' }
        });
        if (moved.count > 0 && user) {
          try {
            await sendPaymentFailedEmail({
              to: user.email,
              name: user.name,
              planName: plan.name,
              amount: current.amount,
              retryUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/account/billing`
            });
          } catch (err) {
            console.error('[Razorpay Webhook] payment-failed email failed:', err instanceof Error ? err.message : err);
          }
        }
        break;
      }

      case 'subscription.halted': {
        // Razorpay stopped retrying: the plan ends (calls stop once the paid period is over).
        await prisma.userSubscription.update({
          where: { id: current.id },
          data: { status: 'cancelled', cancelAtPeriodEnd: true, ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}) }
        });
        if (user) {
          await sendOnce({ userId: user.id, kind: 'subscription_ended', refKey: subscriptionId, failOpen: true }, () =>
            sendSubscriptionStoppedEmail({
              to: user.email,
              name: user.name,
              planName: plan.name,
              amount: current.amount,
              accessUntil: periodEnd ?? current.currentPeriodEnd
            })
          );
        }
        break;
      }

      case 'subscription.cancelled':
      case 'subscription.completed':
        await prisma.userSubscription.update({
          where: { id: current.id },
          data: { status: 'cancelled', cancelAtPeriodEnd: true, ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}) }
        });
        if (event === 'subscription.cancelled' && user) {
          const accessEnd = periodEnd ?? current.currentPeriodEnd;
          await sendOnce({ userId: user.id, kind: 'subscription_ended', refKey: subscriptionId, failOpen: true }, () =>
            sendSubscriptionCancelledEmail({
              to: user.email,
              name: user.name,
              planName: plan.name,
              accessUntil: formatEmailDate(accessEnd.getTime() > now.getTime() ? accessEnd : now)
            })
          );
        }
        break;

      default:
        break;
    }

    return NextResponse.json({ status: 'ok', received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Webhook processing error' }, { status: 500 });
  }
}
