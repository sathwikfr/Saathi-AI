'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PLANS, PAID_PLAN_IDS, getPlan, HEALTH_MONITOR, DAILY_TOUCHES, healthMonitorPrice, cleanAddons, monthlyPrice } from '@/lib/plans';
import { PlanId } from '@/lib/types';
import { Check, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { CheckoutShell, PageTitle, CheckRow, SummaryRow } from '@/components/checkout/CheckoutUI';

function ConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only paid plans are offered: each starts with a 7-day trial once AutoPay is set up (old ?plan=free links land on Family).
  const requestedPlan = searchParams.get('plan');
  const initialPlan: PlanId = requestedPlan === 'essential' || requestedPlan === 'solo' || requestedPlan === 'extended' ? requestedPlan : 'family';

  const [selectedPlanId, setSelectedPlanId] = useState<PlanId>(initialPlan);
  // Add-ons on a calling plan: Health Monitor and Daily Touches. ?monitor=1 / ?touches=1 pre-tick them.
  const [wantsMonitor, setWantsMonitor] = useState(searchParams.get('monitor') === '1');
  const [wantsTouches, setWantsTouches] = useState(searchParams.get('touches') === '1');
  const [parentConsentChecked, setParentConsentChecked] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [errorNotice, setErrorNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const plan = getPlan(selectedPlanId);
  const add = cleanAddons(plan.id, { healthMonitor: wantsMonitor, dailyTouches: wantsTouches });
  const offersAddons = plan.channel === 'call' && plan.priceMonthly > 0;
  const price = monthlyPrice(plan.id, add);

  // Calculate trial and first billing dates
  const [today] = useState(() => Date.now());
  const formattedTrialEnd = new Date(today + plan.trialDays * 86400000).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const handleProceed = async () => {
    setErrorNotice('');

    if (!parentConsentChecked) {
      setErrorNotice('Please confirm that your parent knows about the calls and has agreed to them.');
      return;
    }

    if (!termsChecked) {
      setErrorNotice('Please confirm you understand Aaptha is not a medical or emergency service.');
      return;
    }

    setLoading(true);
    router.push(`/checkout/payment?plan=${plan.id}${add.healthMonitor ? '&monitor=1' : ''}${add.dailyTouches ? '&touches=1' : ''}`);
  };

  return (
    <CheckoutShell step={2}>
      <PageTitle title="Choose your plan" sub="You can switch or cancel any time from your billing page." />

      <div className="checkout-grid">
        {/* PLAN */}
        <section className="panel" aria-labelledby="plan-title">
          <div className="plan-options" role="radiogroup" aria-label="Plan" style={{ marginBottom: '24px' }}>
            {PAID_PLAN_IDS.map((pid) => {
              const p = PLANS[pid];
              return (
                <button
                  key={pid}
                  type="button"
                  role="radio"
                  aria-checked={p.id === selectedPlanId}
                  className="plan-option"
                  onClick={() => setSelectedPlanId(pid)}
                >
                  <strong>{p.name}</strong>
                  <span>{p.priceMonthly === 0 ? 'Free' : `₹${p.priceMonthly}/month`}</span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '6px' }}>
            <div>
              <h2 id="plan-title" style={{ fontSize: '1.5rem', letterSpacing: '-0.02em' }}>{plan.name}</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)', marginTop: '2px' }}>{plan.tagline}</p>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '2.2rem', fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1 }}>
                ₹{price}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: '4px' }}>
                {plan.priceMonthly === 0 ? 'for 7 days' : 'per month'}
              </div>
            </div>
          </div>

          <div className="divider" style={{ margin: '20px 0' }} />

          <ul className="feature-list">
            {plan.features.map((feat) => (
              <li key={feat}>
                <span><Check size={12} strokeWidth={3} /></span>
                <span>{feat}</span>
              </li>
            ))}
          </ul>

          {offersAddons && (
            <div style={{ marginTop: '16px', display: 'grid', gap: '10px' }}>
              <label className="notice" style={{ margin: 0, display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" checked={wantsMonitor} onChange={e => setWantsMonitor(e.target.checked)} style={{ marginTop: '4px' }} />
                <span>
                  <strong>Add {HEALTH_MONITOR.name}: +₹{healthMonitorPrice(plan.id)}/month</strong>
                  <span style={{ display: 'block', fontSize: '0.86rem', color: 'var(--ink-muted)', marginTop: '2px' }}>
                    {HEALTH_MONITOR.tagline}. {plan.parentsIncluded > 1 ? `A short readings call a day for each parent (up to ${plan.parentsIncluded}).` : 'A short call a day just for the readings.'} You can add it later too.
                  </span>
                </span>
              </label>
              <label className="notice" style={{ margin: 0, display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" checked={wantsTouches} onChange={e => setWantsTouches(e.target.checked)} style={{ marginTop: '4px' }} />
                <span>
                  <strong>Add {DAILY_TOUCHES.name}: +₹{DAILY_TOUCHES.priceMonthly}/month</strong>
                  <span style={{ display: 'block', fontSize: '0.86rem', color: 'var(--ink-muted)', marginTop: '2px' }}>
                    {DAILY_TOUCHES.tagline}. Only on a call that has room, so calls stay short.
                  </span>
                </span>
              </label>
            </div>
          )}

          {plan.channel === 'whatsapp' && (
            <p className="notice teal" style={{ marginTop: '16px', marginBottom: 0, fontSize: '0.86rem' }}>
              {plan.name} sends WhatsApp reminders only: Saathi does not call. For check-in calls to a parent, choose {PLANS.solo.name} or bigger.
            </p>
          )}
        </section>

        {/* SUMMARY + CONSENT */}
        <section className="panel" aria-labelledby="summary-title">
          <h3 id="summary-title" style={{ fontSize: '1.2rem', marginBottom: '14px' }}>Summary</h3>

          <div className="summary" style={{ marginBottom: '14px' }}>
            {plan.hasTrial ? (
              <>
                <SummaryRow label={`Due today (${plan.trialDays}-day trial)`} value="₹0" tone="green" strong />
                <SummaryRow label={`First charge on ${formattedTrialEnd}`} value={`₹${price}`} />
                <SummaryRow label="After that" value={`₹${price} every month`} />
                {(add.healthMonitor || add.dailyTouches) && (
                  <SummaryRow
                    label="Includes"
                    value={`${plan.name} ₹${plan.priceMonthly}${add.healthMonitor ? ` + ${HEALTH_MONITOR.name} ₹${healthMonitorPrice(plan.id)}` : ''}${add.dailyTouches ? ` + ${DAILY_TOUCHES.name} ₹${DAILY_TOUCHES.priceMonthly}` : ''}`}
                  />
                )}
              </>
            ) : (
              <>
                <SummaryRow label="Due today" value="₹0" tone="green" strong />
                <SummaryRow label="Payment details" value="Not needed" />
              </>
            )}
          </div>

          {plan.hasTrial && (
            <p className="fine-print" style={{ marginBottom: '20px' }}>
              <ShieldCheck size={16} />
              <span>Cancel from your billing page before {formattedTrialEnd} and you won&apos;t be charged anything.</span>
            </p>
          )}

          {plan.channel === 'whatsapp' ? (
            <CheckRow checked={parentConsentChecked} onChange={(v) => { setParentConsentChecked(v); setErrorNotice(''); }} title="Whoever gets the reminders agrees">
              The reminders are for me, or the person they are for knows about them. They start them by sending START on WhatsApp and can stop them any time.
            </CheckRow>
          ) : (
            <CheckRow checked={parentConsentChecked} onChange={(v) => { setParentConsentChecked(v); setErrorNotice(''); }} title="My parent knows and has agreed">
              I&apos;ve told my parent(s) about Saathi and they&apos;re happy to receive check-in calls on their phone.
            </CheckRow>
          )}
          <CheckRow checked={termsChecked} onChange={(v) => { setTermsChecked(v); setErrorNotice(''); }} title="Not a medical service">
            I understand Aaptha is a family check-in companion, not a doctor or an emergency service.
            {' '}By continuing I agree to the <Link href="/terms" target="_blank">Terms of Service</Link> and <Link href="/privacy" target="_blank">Privacy Policy</Link>.
          </CheckRow>

          {errorNotice && (
            <div className="alert-box error" role="alert" style={{ marginTop: '14px', marginBottom: 0 }}>
              <AlertCircle size={18} />
              <span>{errorNotice}</span>
            </div>
          )}

          <button onClick={handleProceed} disabled={loading} className="btn btn-primary btn-block btn-lg" style={{ marginTop: '18px' }}>
            {loading ? (
              <><span className="spinner" /> Setting up…</>
            ) : (
              <>Continue to payment <ArrowRight size={18} className="arrow" /></>
            )}
          </button>
        </section>
      </div>
    </CheckoutShell>
  );
}

export default function CheckoutConfirmPage() {
  return (
    <Suspense fallback={<div className="wrap" style={{ paddingTop: '120px' }}><div className="skeleton" style={{ height: '420px', maxWidth: '1000px', margin: '0 auto' }} /></div>}>
      <ConfirmContent />
    </Suspense>
  );
}
