'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckoutShell, PageTitle, SummaryRow } from '@/components/checkout/CheckoutUI';
import { getPlan, monthlyPrice, HEALTH_MONITOR, cleanAddons } from '@/lib/plans';
import { PlanId } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { Lock, ShieldCheck, AlertTriangle, ArrowRight } from 'lucide-react';

interface CreateSubscriptionResponse {
  subscriptionId?: string;
  keyId?: string;
  isSandbox?: boolean;
  error?: string;
}

interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, cb: (resp: { error?: { description?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof window === 'undefined') return resolve(false);
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function PaymentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planParam = (searchParams.get('plan') as PlanId) || 'family';
  const plan = getPlan(planParam);
  // The add-on picked on the plan page (?monitor=1).
  const add = cleanAddons(plan.id, { healthMonitor: searchParams.get('monitor') === '1' });
  const monitor = add.healthMonitor;
  const price = monthlyPrice(plan.id, add);

  const { user, loading: authLoading } = useAuth();

  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [subscriptionData, setSubscriptionData] = useState<{
    subscriptionId: string;
    keyId: string;
    isSandbox: boolean;
  } | null>(null);
  const [initError, setInitError] = useState('');
  // Captured once so render stays pure.
  const [pageLoadedAt] = useState(() => Date.now());

  // Sandbox-only outcome simulator (local development without Razorpay keys)
  const [simulateOutcome, setSimulateOutcome] = useState<'success' | 'declined' | 'network'>('success');

  // One Razorpay subscription per user + plan on this page. The effect re-runs when the auth user
  // object refreshes (and twice under StrictMode); each run reuses the same request instead of
  // creating another subscription in Razorpay.
  const userId = user?.id;
  const subscriptionRequest = useRef<{ key: string; result: Promise<{ ok: boolean; data: CreateSubscriptionResponse }> } | null>(null);

  useEffect(() => {
    if (plan.priceMonthly === 0) {
      router.replace('/checkout/confirm');
      return;
    }
    if (authLoading || !userId) return;

    const key = `${userId}:${plan.id}:${monitor ? 'm' : ''}`;
    if (subscriptionRequest.current?.key !== key) {
      subscriptionRequest.current = {
        key,
        result: fetch('/api/razorpay/create-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: plan.id, healthMonitor: monitor })
        }).then(async res => ({ ok: res.ok, data: (await res.json()) as CreateSubscriptionResponse }))
      };
    }
    const request = subscriptionRequest.current;

    let cancelled = false;
    request.result
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok && data.subscriptionId) {
          setSubscriptionData({ subscriptionId: data.subscriptionId, keyId: data.keyId || '', isSandbox: Boolean(data.isSandbox) });
        } else {
          setInitError(data.error || 'Could not start checkout. Please try again.');
        }
      })
      .catch(() => {
        // Let a later run (or a reload) try again.
        if (subscriptionRequest.current === request) subscriptionRequest.current = null;
        if (!cancelled) setInitError('Network error while starting checkout. Please retry.');
      });
    return () => {
      cancelled = true;
    };
  }, [plan.id, plan.priceMonthly, monitor, userId, authLoading, router]);

  const verifyWithServer = async (resp: RazorpaySuccessResponse, brand: string) => {
    const res = await fetch('/api/razorpay/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...resp, planId: plan.id, healthMonitor: monitor, paymentMethodBrand: brand })
    });
    const verifyData = await res.json();
    if (!res.ok) {
      throw new Error(verifyData.error || 'Payment verification failed. You have not been charged twice — please contact support if money was debited.');
    }
    router.push(`/checkout/success?plan=${plan.id}&sub_id=${encodeURIComponent(resp.razorpay_subscription_id)}`);
  };

  const handleRazorpayCheckout = async () => {
    if (!subscriptionData || !user) return;
    setErrorMessage('');
    setProcessing(true);

    const loaded = await loadRazorpayScript();
    if (!loaded || !window.Razorpay) {
      setProcessing(false);
      setErrorMessage('Could not load Razorpay. Check your connection and try again.');
      return;
    }

    const rzp = new window.Razorpay({
      key: subscriptionData.keyId,
      subscription_id: subscriptionData.subscriptionId,
      name: 'Aaptha',
      description: `${plan.name}${monitor ? ` + ${HEALTH_MONITOR.name}` : ''} — monthly subscription`,
      prefill: { name: user.name, email: user.email, contact: user.phone || '' },
      theme: { color: '#2563eb' },
      handler: async (resp: RazorpaySuccessResponse) => {
        try {
          await verifyWithServer(resp, 'Razorpay');
        } catch (err) {
          setProcessing(false);
          setErrorMessage(err instanceof Error ? err.message : 'Payment verification failed.');
        }
      },
      modal: {
        ondismiss: () => setProcessing(false)
      }
    });
    rzp.on('payment.failed', resp => {
      setProcessing(false);
      setErrorMessage(resp.error?.description || 'The payment did not go through. Please try again.');
    });
    rzp.open();
  };

  const handleSandboxCheckout = async () => {
    if (!subscriptionData) return;
    setErrorMessage('');
    setProcessing(true);
    await new Promise(r => setTimeout(r, 800));

    if (simulateOutcome === 'declined') {
      setProcessing(false);
      setErrorMessage('Sandbox: your bank declined the transaction.');
      return;
    }
    if (simulateOutcome === 'network') {
      setProcessing(false);
      setErrorMessage('Sandbox: connection timed out while contacting the bank. You have not been charged.');
      return;
    }

    try {
      await verifyWithServer(
        {
          razorpay_payment_id: `pay_sandbox_${Date.now()}`,
          razorpay_subscription_id: subscriptionData.subscriptionId,
          razorpay_signature: 'sig_test_sandbox'
        },
        'Sandbox'
      );
    } catch (err) {
      setProcessing(false);
      setErrorMessage(err instanceof Error ? err.message : 'Sandbox verification failed.');
    }
  };

  if (!authLoading && !user) {
    return (
      <CheckoutShell step={3} wide={false}>
        <div className="panel empty">
          <span className="icon-tile"><Lock size={22} /></span>
          <h3>Please log in to continue</h3>
          <p style={{ marginBottom: '20px' }}>You need a Aaptha account before starting a subscription.</p>
          <Link href={`/login?redirect=${encodeURIComponent(`/checkout/payment?plan=${plan.id}`)}`} className="btn btn-primary">
            Log in <ArrowRight size={16} className="arrow" />
          </Link>
        </div>
      </CheckoutShell>
    );
  }

  const firstCharge = new Date(pageLoadedAt + plan.trialDays * 86400000).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <CheckoutShell step={3}>
      <PageTitle
        title={plan.hasTrial ? 'Set up AutoPay for your trial' : 'Payment'}
        sub={
          plan.hasTrial
            ? `Your first ₹${price} payment is on ${firstCharge}. To set up AutoPay, Razorpay takes a small amount now (usually ₹5) and refunds it.`
            : `₹${price} will be charged today.`
        }
      />

      <div className="checkout-grid">
        <section className="panel" aria-labelledby="pay-title">
          {(errorMessage || initError) && (
            <div className="alert-box error" role="alert">
              <AlertTriangle size={18} />
              <div>
                <strong style={{ display: 'block', marginBottom: '2px' }}>
                  {initError ? 'Checkout unavailable' : 'Payment didn’t go through'}
                </strong>
                <span>{errorMessage || initError}</span>
              </div>
            </div>
          )}

          <h2 id="pay-title" className="panel-label" style={{ marginBottom: '10px' }}>Billing contact</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '22px' }}>
            <span className="avatar" style={{ width: '40px', height: '40px', fontSize: '0.85rem' }}>{user?.avatar || 'CC'}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{user?.name}</div>
              <div style={{ fontSize: '0.86rem', color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
            </div>
          </div>

          <div className="notice teal" style={{ marginBottom: '20px' }}>
            <Lock size={18} />
            <span>
              You&apos;ll set up AutoPay with your card or bank account in Razorpay&apos;s secure window. Aaptha never sees your card number, CVV or bank login.
            </span>
          </div>

          {subscriptionData?.isSandbox && (
            <div className="notice amber" style={{ display: 'block' }}>
              <strong style={{ marginBottom: '8px' }}>Local sandbox: no real payment happens</strong>
              <div className="segmented" role="radiogroup" aria-label="Simulated outcome">
                {(['success', 'declined', 'network'] as const).map(outcome => (
                  <button
                    key={outcome}
                    type="button"
                    role="radio"
                    aria-checked={simulateOutcome === outcome}
                    className={simulateOutcome === outcome ? 'active' : ''}
                    onClick={() => setSimulateOutcome(outcome)}
                  >
                    {outcome === 'declined' ? 'Declined' : outcome === 'network' ? 'Network error' : 'Success'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={subscriptionData?.isSandbox ? handleSandboxCheckout : handleRazorpayCheckout}
            disabled={processing || !subscriptionData}
            className="btn btn-primary btn-block btn-lg"
          >
            {processing ? (
              <><span className="spinner" /> Waiting for Razorpay…</>
            ) : !subscriptionData && !initError ? (
              <><span className="spinner" /> Preparing secure checkout…</>
            ) : (
              <>
                {plan.hasTrial ? `Start ${plan.trialDays}-day free trial` : `Pay ₹${price}`} <ArrowRight size={18} className="arrow" />
              </>
            )}
          </button>

          <div style={{ textAlign: 'center', marginTop: '14px' }}>
            <Link href={`/checkout/confirm?plan=${plan.id}${monitor ? '&monitor=1' : ''}`} className="link" style={{ fontSize: '0.88rem' }}>Change plan</Link>
          </div>
        </section>

        {/* ORDER SUMMARY */}
        <section className="panel" aria-labelledby="order-title">
          <h3 id="order-title" style={{ fontSize: '1.2rem', marginBottom: '14px' }}>Order summary</h3>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '14px' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '1.02rem' }}>{plan.name}{monitor ? ` + ${HEALTH_MONITOR.name}` : ''}</div>
              <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)' }}>Monthly subscription</div>
            </div>
            <div style={{ fontWeight: 600 }}>₹{price}<span style={{ color: 'var(--ink-muted)', fontWeight: 400, fontSize: '0.84rem' }}>/mo</span></div>
          </div>

          {plan.hasTrial && (
            <div className="summary" style={{ marginBottom: '16px' }}>
              <SummaryRow label="Free trial" value={`${plan.trialDays} days`} />
              <SummaryRow label="Due today" value="₹0" tone="green" strong />
              <SummaryRow label={`First charge on ${firstCharge}`} value={`₹${price}`} />
            </div>
          )}

          <p className="fine-print">
            <ShieldCheck size={16} />
            <span>Cancel any time from your billing page. {plan.hasTrial ? 'Cancel before your trial ends and you won’t be charged.' : ''}</span>
          </p>
        </section>
      </div>
    </CheckoutShell>
  );
}

export default function PaymentPage() {
  return (
    <Suspense fallback={<div className="wrap" style={{ paddingTop: '120px' }}><div className="skeleton" style={{ height: '420px', maxWidth: '1000px', margin: '0 auto' }} /></div>}>
      <PaymentContent />
    </Suspense>
  );
}
