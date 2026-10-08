/**
 * Billing / lifecycle email tests: `npx tsx scripts/test-billing-emails.ts`
 *
 * Part A: email content (no database, no network).
 * Part B: trial reminders and the Razorpay webhook against THROWAWAY accounts
 *         (billing-test-*@example.com) in the real database. Needs the EmailLog table.
 *         The Resend key is removed for this process, so nothing is ever sent: emails
 *         are captured in the in-memory outbox. Reminder runs are scoped to the test
 *         accounts (`userIds`), so real customers are never touched. Test rows are deleted at the end.
 */
import 'dotenv/config';
import './lib/testDb';
import crypto from 'crypto';

// Never send real email from a test run.
delete process.env.RESEND_API_KEY;
process.env.NEXT_PUBLIC_SUPPORT_EMAIL = 'support@test.example';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.test.example';
process.env.RAZORPAY_WEBHOOK_SECRET = 'billing-test-webhook-secret';

import { prisma } from '../src/lib/prisma';
import { PLANS } from '../src/lib/plans';
import { createUser } from '../src/lib/db';
import {
  getRecentEmails,
  sendPaymentFailedEmail,
  sendPaymentReceiptEmail,
  sendSubscriptionActivatedEmail,
  sendSubscriptionCancelledEmail,
  sendSubscriptionStoppedEmail,
  sendTrialEmail,
  type TrialEmailInput
} from '../src/lib/email';
import { runLifecycleEmails } from '../src/lib/lifecycleEmails';
import { sendOnce } from '../src/lib/emailLog';
import { invoiceNumberForPayment, describeRazorpayPaymentMethod } from '../src/lib/razorpay';
import { POST as webhookPost } from '../src/app/api/razorpay/webhook/route';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail !== undefined ? '  →  ' + JSON.stringify(detail) : ''}`);
  }
}

const DAY = 86400000;
const last = () => getRecentEmails(1)[0];
const emailsTo = (to: string, template?: string) => getRecentEmails(500).filter(e => e.to === to && (!template || e.template === template));

// ============================================================================
// PART A: content
// ============================================================================
async function partA() {
  console.log('\nA1. Subscription activated (free-trial start)');
  await sendSubscriptionActivatedEmail({
    to: 'a@example.com', name: '<b>Ravi</b> Kumar', planName: 'Family Care', monthlyAmount: 1299, paidToday: 0,
    invoiceNumber: 'CC-2026-ABC123', paymentMethod: 'UPI AutoPay', trialDays: 14, firstChargeDate: '14 Oct 2026', parentsIncluded: 2
  });
  let e = last();
  check('template + recipient', e.template === 'subscription_activated' && e.to === 'a@example.com');
  check('says the free trial started', /free trial has started/i.test(e.subject) && /14-day free trial/.test(e.html));
  check('shows first monthly charge and date', e.html.includes('₹1,299 on 14 Oct 2026') && e.text.includes('₹1,299 on 14 Oct 2026'));
  check('paid today is ₹0', e.html.includes('₹0'));
  check('tells them how to avoid the charge', /cancel before 14 Oct 2026/.test(e.html));
  check('customer name is HTML-escaped', !e.html.includes('<b>Ravi</b>') && e.html.includes('&lt;b&gt;Ravi'));
  check('footer shows the support address', e.html.includes('support@test.example'));
  check('reference number present', e.html.includes('CC-2026-ABC123'));

  console.log('\nA2. Subscription activated (charged immediately)');
  await sendSubscriptionActivatedEmail({
    to: 'a@example.com', name: 'Asha', planName: 'Extended Family', monthlyAmount: 2999, paidToday: 2999,
    invoiceNumber: 'CC-2026-XYZ789', paymentMethod: 'Card', firstChargeDate: '30 Oct 2026', parentsIncluded: 5
  });
  e = last();
  check('subject says active, not trial', /subscription is active/i.test(e.subject) && !/free trial/i.test(e.html));
  check('shows next renewal', e.html.includes('Next renewal') && e.html.includes('30 Oct 2026'));
  check('up to 5 parents', e.html.includes('up to 5 parents'));

  console.log('\nA3. Payment receipt (renewal)');
  await sendPaymentReceiptEmail({ to: 'a@example.com', name: 'Asha', planName: 'Family Care', amount: 1299, invoiceNumber: 'CC-2026-R1', date: '14 Oct 2026', nextBillingDate: '14 Nov 2026', paymentMethod: 'UPI AutoPay' });
  e = last();
  check('receipt shows amount, invoice and next renewal', e.html.includes('₹1299') && e.html.includes('CC-2026-R1') && e.html.includes('14 Nov 2026') && e.text.includes('14 Nov 2026'));
  check('no longer says "Thank you for subscribing"', !e.html.includes('Thank you for subscribing'));

  console.log('\nA4. Payment failed');
  await sendPaymentFailedEmail({ to: 'a@example.com', name: 'Asha', planName: 'Family Care', amount: 1299, retryUrl: 'https://app.test.example/account/billing' });
  e = last();
  check('links to billing', e.html.includes('https://app.test.example/account/billing'));
  check('does not promise an unverified 48-hour retry', !/48 hours/.test(e.html + e.text));
  check('says calls continue for now', /continue for now/.test(e.html));

  console.log('\nA5. Subscription stopped / cancelled');
  await sendSubscriptionStoppedEmail({ to: 'a@example.com', name: 'Asha', planName: 'Family Care', amount: 1299, accessUntil: new Date(Date.now() + 5 * DAY) });
  e = last();
  check('stopped, calls continue until the paid period ends', /has been stopped/i.test(e.html) && /continue until/.test(e.html));
  await sendSubscriptionStoppedEmail({ to: 'a@example.com', name: 'Asha', planName: 'Family Care', amount: 1299, accessUntil: new Date(Date.now() - DAY) });
  e = last();
  check('stopped, period already over: calls have paused', /have paused/.test(e.html) && !/continue until/.test(e.html));
  await sendSubscriptionCancelledEmail({ to: 'a@example.com', name: 'Asha', planName: 'Family Care', accessUntil: '14 Oct 2026' });
  check('cancelled email no longer says "As requested"', !last().html.includes('As requested'));

  console.log('\nA6. Trial reminders');
  const cases: Array<[string, TrialEmailInput, RegExp[]]> = [
    ['free ending', { variant: 'free_ending', to: 'a@example.com', name: 'Asha', endsOn: new Date('2026-10-20T06:00:00Z') }, [/20 Oct 2026/, /will stop/, new RegExp(`Family Care is ₹${PLANS.family.priceMonthly.toLocaleString('en-IN')} a month`)]],
    ['free ended', { variant: 'free_ended', to: 'a@example.com', name: 'Asha', endedOn: new Date('2026-10-20T06:00:00Z') }, [/20 Oct 2026/, /have paused/, /safe/]],
    ['paid ending', { variant: 'paid_ending', to: 'a@example.com', name: 'Asha', planName: 'Family Care', amount: 1299, chargeOn: new Date('2026-10-20T06:00:00Z') }, [/₹1,299/, /20 Oct 2026/, /cancel before 20 Oct 2026/]]
  ];
  for (const [label, input, patterns] of cases) {
    await sendTrialEmail(input);
    e = last();
    check(`${label}: template + recipient`, e.template === `trial_${input.variant}` && e.to === 'a@example.com');
    check(`${label}: content`, patterns.every(p => p.test(e.html)), patterns.filter(p => !p.test(e.html)).map(String));
    check(`${label}: plain-text part has the billing link`, e.text.includes('https://app.test.example/account/billing'));
  }
  await sendTrialEmail({ variant: 'free_ending', to: 'a@example.com', name: 'Asha', endsOn: new Date('2026-10-20T20:00:00Z') });
  check('dates are shown in IST (20:00 UTC is already 21 Oct in India)', last().html.includes('21 Oct 2026'));

  console.log('\nA7. Razorpay helpers');
  check('invoice number derives from the payment id', invoiceNumberForPayment('pay_Abc123xyz789', new Date('2026-05-01')) === 'CC-2026-XYZ789');
  check('UPI method', describeRazorpayPaymentMethod({ method: 'upi' }) === 'UPI AutoPay');
  check('card method uses last4 only', describeRazorpayPaymentMethod({ method: 'card', card: { network: 'Visa', last4: '4366' } }) === 'Visa •••• 4366');
  check('unknown method falls back', describeRazorpayPaymentMethod({ method: 'wallet' }) === 'Razorpay' && describeRazorpayPaymentMethod(null) === 'Razorpay');
}

// ============================================================================
// PART B: database
// ============================================================================
const stamp = Date.now();
const mkEmail = (tag: string) => `billing-test-${tag}-${stamp}@example.com`;

/** A throwaway account. By default it has one parent (free-trial reminders only go to accounts with a parent). */
async function mkUser(tag: string, createdDaysAgo: number, withParent = true) {
  const u = await createUser({ name: `Billing Tester ${tag}`, email: mkEmail(tag), phone: null });
  await prisma.user.update({ where: { id: u.id }, data: { createdAt: new Date(Date.now() - createdDaysAgo * DAY) } });
  if (withParent) {
    await prisma.parentProfile.create({ data: { userId: u.id, name: `Parent of ${tag}`, relationship: 'Mother', phone: '+919000000000', consentGiven: false } });
  }
  return u;
}

async function makePaid(userId: string, opts: { subId: string; trialEndsInDays?: number; cancelAtPeriodEnd?: boolean; status?: string }) {
  await prisma.userSubscription.update({
    where: { userId },
    data: {
      planId: 'family',
      status: opts.status ?? 'trialing',
      amount: 1299,
      razorpaySubscriptionId: opts.subId,
      trialEndsAt: opts.trialEndsInDays === undefined ? null : new Date(Date.now() + opts.trialEndsInDays * DAY),
      currentPeriodEnd: new Date(Date.now() + (opts.trialEndsInDays ?? 20) * DAY),
      cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false
    }
  });
}

async function hook(event: string, subId: string, extra: { payment?: Record<string, unknown>; currentEnd?: number } = {}, signWith = 'billing-test-webhook-secret') {
  const raw = JSON.stringify({
    event,
    payload: {
      subscription: { entity: { id: subId, ...(extra.currentEnd ? { current_end: extra.currentEnd } : {}) } },
      ...(extra.payment ? { payment: { entity: { subscription_id: subId, ...extra.payment } } } : {})
    }
  });
  const signature = crypto.createHmac('sha256', signWith).update(raw).digest('hex');
  const res = await webhookPost(new Request('http://localhost/api/razorpay/webhook', { method: 'POST', body: raw, headers: { 'x-razorpay-signature': signature } }));
  return res.status;
}

async function partB() {
  try {
    await prisma.emailLog.count();
  } catch {
    console.log('\nPART B SKIPPED: the EmailLog table does not exist in the database yet (apply the reviewed schema change first).');
    return false;
  }

  try {
    // ---- B1: free-trial reminders -----------------------------------------------------
    console.log('\nB1. Free-trial reminders');
    const ending = await mkUser('ending', 5.5); // trial ends in 1.5 days
    const early = await mkUser('early', 3); // 4 days left: too early
    const ended = await mkUser('ended', 7.5); // ended half a day ago
    const old = await mkUser('old', 30); // ended weeks ago: must not be emailed
    const paid = await mkUser('paid', 5.5); // same age as `ending` but on a paid plan
    await makePaid(paid.id, { subId: `sub_test_paid_${stamp}`, trialEndsInDays: 10, status: 'active' });
    const noParent = await mkUser('noparent', 5.5, false); // same age as `ending` but never added a parent
    const scope = [ending.id, early.id, ended.id, old.id, paid.id, noParent.id];

    const sent: Array<{ variant: string; to: string }> = [];
    const okSend = async (input: TrialEmailInput) => {
      sent.push({ variant: input.variant, to: input.to });
      return { success: true };
    };

    const r1 = await runLifecycleEmails({ userIds: scope, send: okSend });
    check('one "ending" and one "ended" email', r1.freeEnding === 1 && r1.freeEnded === 1 && r1.duplicates === 0 && r1.failed === 0, r1);
    check('ending user got free_ending', sent.some(s => s.to === ending.email && s.variant === 'free_ending'));
    check('ended user got free_ended', sent.some(s => s.to === ended.email && s.variant === 'free_ended'));
    check('too-early, long-ago and paid accounts got nothing', !sent.some(s => [early.email, old.email, paid.email].includes(s.to)), sent);
    check('an account that never added a parent gets no "calls will stop" email', !sent.some(s => s.to === noParent.email), sent);

    const r2 = await runLifecycleEmails({ userIds: scope, send: okSend });
    check('a second run sends nothing new (exactly once)', r2.freeEnding === 0 && r2.freeEnded === 0 && sent.length === 2, { r2, sent });

    // Half a day later the "ending" user's trial is over: they now get "ended" (a different email, once).
    const later = new Date(Date.now() + 2 * DAY);
    const r3 = await runLifecycleEmails({ userIds: scope, send: okSend, now: later });
    check('when the trial passes, the ending user gets the ended email once', r3.freeEnded === 1 && sent.filter(s => s.to === ending.email).length === 2, { r3, sent });

    // ---- B2: a failed send is retried, not lost ----------------------------------------
    console.log('\nB2. Failed send is retried on the next run');
    const flaky = await mkUser('flaky', 5.5);
    let attempts = 0;
    const flakySend = async () => {
      attempts += 1;
      return attempts === 1 ? { success: false, error: 'resend down' } : { success: true };
    };
    const f1 = await runLifecycleEmails({ userIds: [flaky.id], send: flakySend });
    check('first run reports the failure', f1.failed === 1 && f1.freeEnding === 0, f1);
    const f2 = await runLifecycleEmails({ userIds: [flaky.id], send: flakySend });
    check('next run retries and succeeds', f2.freeEnding === 1 && attempts === 2, { f2, attempts });
    const f3 = await runLifecycleEmails({ userIds: [flaky.id], send: flakySend });
    check('and then stops', f3.freeEnding === 0 && attempts === 2, { f3, attempts });

    // ---- B3: paid trial about to convert -----------------------------------------------
    console.log('\nB3. Paid trial about to convert');
    const soon = await mkUser('soon', 20);
    await makePaid(soon.id, { subId: `sub_test_soon_${stamp}`, trialEndsInDays: 2 });
    const far = await mkUser('far', 20);
    await makePaid(far.id, { subId: `sub_test_far_${stamp}`, trialEndsInDays: 10 });
    const cancelled = await mkUser('cancelled', 20);
    await makePaid(cancelled.id, { subId: `sub_test_canc_${stamp}`, trialEndsInDays: 2, cancelAtPeriodEnd: true, status: 'cancelled' });
    const paidSent: TrialEmailInput[] = [];
    const paidScope = [soon.id, far.id, cancelled.id];
    const p1 = await runLifecycleEmails({ userIds: paidScope, send: async i => (paidSent.push(i), { success: true }) });
    check('only the trial ending in 2 days is warned', p1.paidEnding === 1 && paidSent.length === 1 && paidSent[0].to === soon.email, { p1, paidSent });
    const info = paidSent[0];
    check('email carries plan, amount and charge date', info.variant === 'paid_ending' && info.planName === 'Family Care' && info.amount === PLANS.family.priceMonthly);
    const p2 = await runLifecycleEmails({ userIds: paidScope, send: async i => (paidSent.push(i), { success: true }) });
    check('warned only once', p2.paidEnding === 0 && paidSent.length === 1, p2);

    // ---- B4: sendOnce guarantees ---------------------------------------------------------
    console.log('\nB4. sendOnce');
    let calls = 0;
    const claim = { userId: soon.id, kind: 'unit_test', refKey: 'k1', failOpen: false };
    check('first call sends', (await sendOnce(claim, async () => (calls++, { success: true }))) === 'sent');
    check('same key is a duplicate', (await sendOnce(claim, async () => (calls++, { success: true }))) === 'duplicate' && calls === 1);
    check('different key sends', (await sendOnce({ ...claim, refKey: 'k2' }, async () => (calls++, { success: true }))) === 'sent' && calls === 2);
    check('a throwing sender is reported as failed, not thrown', (await sendOnce({ ...claim, refKey: 'k3' }, async () => { throw new Error('boom'); })) === 'failed');
    check('and its claim is released for a retry', (await sendOnce({ ...claim, refKey: 'k3' }, async () => ({ success: true }))) === 'sent');

    // ---- B5: Razorpay webhook ------------------------------------------------------------
    console.log('\nB5. Razorpay webhook');
    const buyer = await mkUser('buyer', 20);
    const subId = `sub_test_buyer_${stamp}`;
    await makePaid(buyer.id, { subId, trialEndsInDays: 0.01, status: 'active' });
    const nextEnd = Math.floor((Date.now() + 30 * DAY) / 1000);
    const pay1 = `pay_TEST${stamp}AAA111`;

    check('bad signature is rejected', (await hook('subscription.charged', subId, { payment: { id: pay1, amount: 129900, method: 'upi' } }, 'wrong-secret')) === 400);
    check('unknown subscription is ignored (200)', (await hook('subscription.charged', 'sub_unknown_xyz', { payment: { id: 'pay_x', amount: 100 } })) === 200 && emailsTo(buyer.email).length === 0);

    await hook('subscription.charged', subId, { currentEnd: nextEnd, payment: { id: pay1, amount: 129900, method: 'upi' } });
    const receipts = emailsTo(buyer.email, 'payment_receipt');
    check('charge → one receipt email to the customer', receipts.length === 1, receipts.length);
    check('receipt has amount, plan and next renewal', receipts[0]?.html.includes('₹1299') && receipts[0].html.includes('Family Care') && receipts[0].html.includes('UPI AutoPay'));
    const invoices = await prisma.invoice.findMany({ where: { userId: buyer.id } });
    check('an invoice row was saved with the same number', invoices.length === 1 && invoices[0].amount === 1299 && receipts[0].html.includes(invoices[0].invoiceNumber), invoices);
    check('subscription is active with the new period end', (await prisma.userSubscription.findUnique({ where: { userId: buyer.id } }))?.currentPeriodEnd.getTime() === nextEnd * 1000);

    await hook('subscription.charged', subId, { currentEnd: nextEnd, payment: { id: pay1, amount: 129900, method: 'upi' } });
    check('the same webhook delivered twice → still one email and one invoice', emailsTo(buyer.email, 'payment_receipt').length === 1 && (await prisma.invoice.count({ where: { userId: buyer.id } })) === 1);

    await hook('payment.failed', subId, { payment: { id: `pay_TEST${stamp}FAIL01`, amount: 129900, method: 'upi' } });
    check('failed payment → past_due + one email', (await prisma.userSubscription.findUnique({ where: { userId: buyer.id } }))?.status === 'past_due' && emailsTo(buyer.email, 'payment_failed').length === 1);
    await hook('payment.failed', subId, { payment: { id: `pay_TEST${stamp}FAIL02`, amount: 129900, method: 'upi' } });
    await hook('subscription.pending', subId);
    check('further failures in the same streak do not email again', emailsTo(buyer.email, 'payment_failed').length === 1);

    const pay2 = `pay_TEST${stamp}BBB222`;
    await hook('subscription.charged', subId, { currentEnd: nextEnd, payment: { id: pay2, amount: 129900, method: 'card', card: { network: 'Visa', last4: '4366' } } });
    check('a later successful charge recovers to active and gets its own receipt', (await prisma.userSubscription.findUnique({ where: { userId: buyer.id } }))?.status === 'active' && emailsTo(buyer.email, 'payment_receipt').length === 2);
    check('second invoice saved', (await prisma.invoice.count({ where: { userId: buyer.id } })) === 2);

    await hook('payment.failed', subId, { payment: { id: `pay_TEST${stamp}FAIL03`, amount: 129900, method: 'upi' } });
    check('a new failure after recovering emails again', emailsTo(buyer.email, 'payment_failed').length === 2);

    await hook('subscription.halted', subId, { currentEnd: Math.floor((Date.now() - DAY) / 1000) });
    const haltedSub = await prisma.userSubscription.findUnique({ where: { userId: buyer.id } });
    check('halted → plan ends and one "stopped" email', haltedSub?.status === 'cancelled' && haltedSub.cancelAtPeriodEnd && emailsTo(buyer.email, 'subscription_stopped').length === 1);
    await hook('subscription.halted', subId, {});
    check('halted delivered twice → still one email', emailsTo(buyer.email, 'subscription_stopped').length === 1);

    // A customer who cancels in Razorpay
    const leaver = await mkUser('leaver', 20);
    const leaverSub = `sub_test_leaver_${stamp}`;
    await makePaid(leaver.id, { subId: leaverSub, trialEndsInDays: 15, status: 'active' });
    await hook('subscription.cancelled', leaverSub, { currentEnd: Math.floor((Date.now() + 10 * DAY) / 1000) });
    check('cancelled → one cancellation email', emailsTo(leaver.email, 'subscription_cancelled').length === 1);
    await hook('subscription.cancelled', leaverSub, {});
    check('cancelled delivered twice → still one', emailsTo(leaver.email, 'subscription_cancelled').length === 1);
    // What the in-app "cancel" button does after Razorpay already sent the webhook: same claim key.
    const dupe = await sendOnce({ userId: leaver.id, kind: 'subscription_ended', refKey: leaverSub, failOpen: true }, async () => ({ success: true }));
    check('the in-app cancel path would not send a second email', dupe === 'duplicate');
    await hook('payment.failed', leaverSub, { payment: { id: `pay_TEST${stamp}LATE01`, amount: 129900 } });
    check('a stale payment.failed after cancelling changes nothing', (await prisma.userSubscription.findUnique({ where: { userId: leaver.id } }))?.status === 'cancelled' && emailsTo(leaver.email, 'payment_failed').length === 0);
    return true;
  } finally {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'billing-test-' } } });
    const left = await prisma.user.count({ where: { email: { startsWith: 'billing-test-' } } });
    console.log(`\nCleanup: throwaway accounts removed (${left === 0 ? 'clean' : 'LEFTOVER ROWS!'})`);
  }
}

async function main() {
  await partA();
  await partB();
  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error(err);
  await prisma.user.deleteMany({ where: { email: { startsWith: 'billing-test-' } } }).catch(() => undefined);
  process.exit(1);
});
