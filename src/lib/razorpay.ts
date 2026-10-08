import crypto from 'crypto';
import { PlanId } from './types';
import { PLANS, PAID_PLAN_IDS, HEALTH_MONITOR, DAILY_TOUCHES, Addons, cleanAddons, monthlyPrice } from './plans';
import { isLocalDevRequest } from './devMode';

/**
 * Razorpay configuration.
 *  - Live/test-mode Razorpay: RAZORPAY_KEY_ID (or NEXT_PUBLIC_RAZORPAY_KEY_ID),
 *    RAZORPAY_KEY_SECRET, and real plan ids in RAZORPAY_PLAN_ID_SOLO /
 *    RAZORPAY_PLAN_ID_FAMILY / RAZORPAY_PLAN_ID_EXTENDED (scripts/create-razorpay-plans.ts).
 *  - Until keys AND all three plan ids are set, a local sandbox is available ONLY under
 *    `next dev`. Production never falls back to sandbox.
 */
const PLACEHOLDER = /demo|CareCircle|xxxx|your_/i;

export function getRazorpayKeyId(): string {
  return process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '';
}

function getRazorpayKeySecret(): string {
  return process.env.RAZORPAY_KEY_SECRET || '';
}

export function isRazorpayConfigured(): boolean {
  const id = getRazorpayKeyId();
  const secret = getRazorpayKeySecret();
  return Boolean(id && secret && !PLACEHOLDER.test(id) && !PLACEHOLDER.test(secret));
}

/** Test keys alone can't take a subscription, so under `next dev` the sandbox stays until the plan ids exist too. */
export async function isSandboxAllowed(): Promise<boolean> {
  if (process.env.NODE_ENV !== 'development') return false;
  if (isRazorpayConfigured() && hasAllRazorpayPlanIds()) return false;
  // A dev server shared through a tunnel is not a laptop: sandbox "payments" would give paid plans away.
  return isLocalDevRequest();
}

const SANDBOX_PREFIX = 'sub_sandbox_';

/**
 * Invoice / receipt number for one payment. Derived from the payment id so the checkout route,
 * the invoice row and the webhook all agree on it, and a repeated webhook can find the invoice
 * it already created.
 */
export function invoiceNumberForPayment(paymentId: string, when: Date = new Date()): string {
  return `CC-${when.getFullYear()}-${paymentId.slice(-6).toUpperCase()}`;
}

/** Human-readable payment method from a Razorpay payment entity (never includes personal details). */
export function describeRazorpayPaymentMethod(payment: {
  method?: string;
  card?: { network?: string; last4?: string };
} | null | undefined): string {
  if (!payment?.method) return 'Razorpay';
  switch (payment.method) {
    case 'upi':
      return 'UPI AutoPay';
    case 'card':
      return payment.card?.last4 ? `${payment.card.network || 'Card'} •••• ${payment.card.last4}` : 'Card';
    case 'emandate':
    case 'nach':
      return 'Bank mandate';
    default:
      return 'Razorpay';
  }
}

/**
 * The real Razorpay plan id from the env (scripts/create-razorpay-plans.ts). The ids in PLANS are
 * placeholders that don't exist in Razorpay, so they are never sent.
 */
/** "" | "_MONITOR" | "_TOUCHES" | "_MONITOR_TOUCHES": the end of the env variable name for a combination. */
export function addonSuffix(add: Addons): string {
  return `${add.healthMonitor ? '_MONITOR' : ''}${add.dailyTouches ? '_TOUCHES' : ''}`;
}

function getRazorpayPlanId(planId: PlanId, addons: Partial<Addons> = {}): string | undefined {
  const add = cleanAddons(planId, addons);
  if (planId === 'free') return undefined;
  const id = process.env[`RAZORPAY_PLAN_ID_${planId.toUpperCase()}${addonSuffix(add)}`];
  return id && !PLACEHOLDER.test(id) ? id : undefined;
}

function hasAllRazorpayPlanIds(): boolean {
  return PAID_PLAN_IDS.every(id => Boolean(getRazorpayPlanId(id)));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getClient(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Razorpay = require('razorpay');
  return new Razorpay({ key_id: getRazorpayKeyId(), key_secret: getRazorpayKeySecret() });
}

export interface CreateSubscriptionResult {
  subscriptionId: string;
  planId: PlanId;
  amount: number;
  currency: string;
  keyId: string;
  isSandbox: boolean;
}

export class PaymentsUnavailableError extends Error {}

export async function createSubscriptionServer(
  planId: PlanId,
  customer: { userId: string; email: string; name: string; phone?: string },
  opts: { noTrial?: boolean; healthMonitor?: boolean; dailyTouches?: boolean; /** First charge on this date (a plan change: the old paid period runs until then). */ startAt?: Date } = {}
): Promise<CreateSubscriptionResult> {
  const plan = PLANS[planId];
  if (!plan || plan.priceMonthly === 0) {
    throw new Error('Free plan does not require a Razorpay subscription.');
  }
  const add = cleanAddons(planId, opts);
  const amount = monthlyPrice(planId, add);
  const addonTag = addonSuffix(add).toLowerCase();

  const rzpPlanId = isRazorpayConfigured() ? getRazorpayPlanId(planId, add) : undefined;
  if (rzpPlanId && !(await isSandboxAllowed())) {
    const response = await getClient().subscriptions.create({
      plan_id: rzpPlanId,
      total_count: 120,
      quantity: 1,
      customer_notify: 1,
      ...(opts.startAt && opts.startAt.getTime() > Date.now() + 3600000
        ? { start_at: Math.floor(opts.startAt.getTime() / 1000) }
        : plan.hasTrial && !opts.noTrial ? { start_at: Math.floor(Date.now() / 1000) + plan.trialDays * 86400 } : {}),
      notes: {
        carecircle_user_id: customer.userId,
        carecircle_plan_id: planId,
        ...(add.healthMonitor || add.dailyTouches ? { carecircle_addon: [add.healthMonitor ? HEALTH_MONITOR.id : '', add.dailyTouches ? DAILY_TOUCHES.id : ''].filter(Boolean).join(',') } : {}),
        customer_email: customer.email
      }
    });

    return {
      subscriptionId: response.id,
      planId,
      amount,
      currency: 'INR',
      keyId: getRazorpayKeyId(),
      isSandbox: false
    };
  }

  if (await isSandboxAllowed()) {
    // Sandbox ids are bound to the user so they can't be replayed for another account.
    const tag = crypto
      .createHmac('sha256', 'carecircle-dev-sandbox')
      .update(`${customer.userId}|${planId}${addonTag}`)
      .digest('hex')
      .slice(0, 16);
    return {
      subscriptionId: `${SANDBOX_PREFIX}${planId}${addonTag}_${tag}`,
      planId,
      amount,
      currency: 'INR',
      keyId: 'rzp_test_sandbox',
      isSandbox: true
    };
  }

  if (isRazorpayConfigured() && !rzpPlanId) {
    console.error(`[payments] RAZORPAY_PLAN_ID_${planId.toUpperCase()}${addonSuffix(add)} is missing: run scripts/create-razorpay-plans.ts and add the ids.`);
    if (add.healthMonitor || add.dailyTouches) throw new PaymentsUnavailableError('That add-on cannot be added just yet. Please start without it and add it later, or try again soon.');
  }
  throw new PaymentsUnavailableError('Online payments are not set up yet. Please try again later.');
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Verifies a checkout result and that the subscription belongs to this user
 * and plan. Returns an error message when verification fails.
 */
export async function verifySubscriptionPayment(params: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
  userId: string;
  planId: PlanId;
  /** Add-ons bought with the plan. */
  healthMonitor?: boolean;
  dailyTouches?: boolean;
}): Promise<{ ok: true; isSandbox: boolean } | { ok: false; error: string }> {
  const { paymentId, subscriptionId, signature, userId, planId } = params;
  const add = cleanAddons(planId, params);
  const addonTag = addonSuffix(add).toLowerCase();

  if (subscriptionId.startsWith(SANDBOX_PREFIX)) {
    if (!(await isSandboxAllowed())) return { ok: false, error: 'Sandbox payments are disabled.' };
    const expected = crypto
      .createHmac('sha256', 'carecircle-dev-sandbox')
      .update(`${userId}|${planId}${addonTag}`)
      .digest('hex')
      .slice(0, 16);
    if (subscriptionId !== `${SANDBOX_PREFIX}${planId}${addonTag}_${expected}`) {
      return { ok: false, error: 'Sandbox subscription does not match this account.' };
    }
    return { ok: true, isSandbox: true };
  }

  if (!isRazorpayConfigured()) {
    return { ok: false, error: 'Online payments are not configured.' };
  }

  // Razorpay subscription signature: HMAC_SHA256(payment_id + "|" + subscription_id, key_secret)
  const expectedSignature = crypto
    .createHmac('sha256', getRazorpayKeySecret())
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');
  if (!signature || !safeEqualHex(expectedSignature, signature)) {
    return { ok: false, error: 'Invalid payment signature.' };
  }

  // Make sure this subscription was created for this user and plan.
  const sub = await getClient().subscriptions.fetch(subscriptionId);
  if (sub?.notes?.carecircle_user_id !== userId || sub?.notes?.carecircle_plan_id !== planId) {
    return { ok: false, error: 'This subscription does not belong to your account.' };
  }
  // The add-on must match what was bought: one cannot be claimed on a plan that didn't include it (or the reverse).
  const boughtAddons = String(sub?.notes?.carecircle_addon || '').split(',').filter(Boolean).sort().join(',');
  const expectedAddons = [add.dailyTouches ? DAILY_TOUCHES.id : '', add.healthMonitor ? HEALTH_MONITOR.id : ''].filter(Boolean).sort().join(',');
  if (boughtAddons !== expectedAddons) {
    return { ok: false, error: 'This subscription is for a different plan.' };
  }
  // The signature never expires, so an old checkout could be replayed after cancelling to get a new trial.
  // Only a subscription that is still live in Razorpay, on the plan's real Razorpay plan, can activate.
  if (['cancelled', 'completed', 'expired', 'halted'].includes(String(sub?.status))) {
    return { ok: false, error: 'This subscription has ended. Please start a new checkout.' };
  }
  const expectedPlan = getRazorpayPlanId(planId, add);
  if (expectedPlan && sub?.plan_id && sub.plan_id !== expectedPlan) {
    return { ok: false, error: 'This subscription is for a different plan.' };
  }

  return { ok: true, isSandbox: false };
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  if (!secret || PLACEHOLDER.test(secret) || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

/**
 * Cancels a real Razorpay subscription (at the end of the current cycle by
 * default). Sandbox ids and unconfigured environments are a no-op.
 */
export async function cancelRazorpaySubscription(subscriptionId: string | undefined, atCycleEnd = true): Promise<void> {
  if (!subscriptionId || subscriptionId.startsWith(SANDBOX_PREFIX) || !isRazorpayConfigured()) return;
  await getClient().subscriptions.cancel(subscriptionId, atCycleEnd);
}
