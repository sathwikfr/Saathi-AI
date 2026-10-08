'use client';

import React, { useState, useEffect } from 'react';
import { AccountShell } from '@/components/account/AccountUI';
import { BillShare } from '@/components/account/BillShare';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import { PLANS, PAID_PLAN_IDS, getEffectivePlan } from '@/lib/plans';
import { PlanId, Invoice, UserSubscription } from '@/lib/types';
import { CreditCard, AlertTriangle, CheckCircle, Download, ArrowUpRight, Shield, X, HeartCrack } from 'lucide-react';

export default function AccountBillingPage() {
  const { user, refreshUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modal states
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [selectedNewPlan, setSelectedNewPlan] = useState<PlanId>('extended');
  const [switchLoading, setSwitchLoading] = useState(false);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('Parent moved in with me');
  const [cancelLoading, setCancelLoading] = useState(false);

  // Fetch billing data
  const fetchBillingData = async () => {
    try {
      const res = await fetch('/api/account/billing');
      if (res.ok) {
        const data = await res.json();
        setSubscription(data.subscription || user?.subscription || null);
        setInvoices(data.invoices || []);
      }
    } catch (err) {
      console.error('Failed to fetch billing data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBillingData();
  }, [user]);

  const currentPlan = getEffectivePlan(subscription, user?.createdAt);

  // Handle Plan Upgrade/Downgrade
  const handleSwitchPlan = async () => {
    setSwitchLoading(true);
    try {
      const res = await fetch('/api/account/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch-plan', newPlanId: selectedNewPlan })
      });
      const data = await res.json();
      if (data.checkoutUrl) {
        // Paid plans go through Razorpay checkout; they can't be switched on directly.
        window.location.href = data.checkoutUrl;
        return;
      }
      if (res.ok) {
        setNotification({ type: 'success', message: data.message || 'Plan updated successfully!' });
        setShowSwitchModal(false);
        await refreshUser();
        await fetchBillingData();
      } else {
        setNotification({ type: 'error', message: data.error || 'Failed to change plan' });
      }
    } catch {
      setNotification({ type: 'error', message: 'Network error while updating plan.' });
    } finally {
      setSwitchLoading(false);
    }
  };

  // Handle Self-Service Cancellation
  const handleCancelSubscription = async () => {
    setCancelLoading(true);
    try {
      const res = await fetch('/api/account/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', reason: cancelReason })
      });
      const data = await res.json();
      if (res.ok) {
        setNotification({ type: 'success', message: data.message });
        setShowCancelModal(false);
        await refreshUser();
        await fetchBillingData();
      } else {
        setNotification({ type: 'error', message: data.error || 'Failed to cancel subscription' });
      }
    } catch {
      setNotification({ type: 'error', message: 'Network error while cancelling.' });
    } finally {
      setCancelLoading(false);
    }
  };

  // Handle Reactivate Subscription
  const handleReactivate = async () => {
    try {
      const res = await fetch('/api/account/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reactivate' })
      });
      const data = await res.json();
      if (res.ok) {
        setNotification({ type: 'success', message: data.message });
        await refreshUser();
        await fetchBillingData();
      } else {
        setNotification({ type: 'error', message: data.error || 'Failed to reactivate.' });
      }
    } catch {
      setNotification({ type: 'error', message: 'Failed to reactivate.' });
    }
  };

  // Plain-text receipt of a recorded payment
  const handleDownloadInvoice = (inv: Invoice) => {
    const text = `=====================================\nAAPTHA PAYMENT RECEIPT\n=====================================\nReceipt: ${inv.invoiceNumber}\nDate: ${inv.date}\nAmount: ₹${inv.amount}\nPlan: ${inv.planName}\nPayment Method: ${inv.paymentMethod}\nStatus: ${inv.status.toUpperCase()}\n=====================================\nThank you for choosing Aaptha for your parents!\n`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${inv.invoiceNumber}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const status = subscription?.status || 'free';
  const isFree = currentPlan.priceMonthly === 0;
  // What is actually charged each month: the plan plus any add-ons (Health Monitor, Daily Touches).
  const monthlyTotal = isFree ? 0 : subscription?.amount ?? currentPlan.priceMonthly;
  const addonNames = [subscription?.healthMonitor ? 'Health Monitor' : '', subscription?.dailyTouches ? 'Daily Touches' : ''].filter(Boolean);
  const formatDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const periodEnd = formatDate(subscription?.currentPeriodEnd);
  const trialEnd = formatDate(subscription?.trialEndsAt);

  const statusBadge =
    status === 'cancelled'
      ? { cls: 'badge-amber', text: periodEnd ? `Ends ${periodEnd}` : 'Cancelled' }
      : status === 'trialing'
        ? { cls: 'badge-gold', text: `Free trial${trialEnd ? ` until ${trialEnd}` : ''}` }
        : status === 'past_due'
          ? { cls: 'badge-red', text: 'Payment due' }
          : status === 'active'
            ? { cls: 'badge-green', text: 'Active' }
            : currentPlan.expired
              ? { cls: 'badge-red', text: 'Trial ended' }
              : { cls: 'badge-gold', text: 'No plan yet' };

  const hasMethod = !!(subscription?.paymentMethodBrand || subscription?.paymentMethodLast4);

  return (
    <AccountShell active="billing" title="Subscription & billing" sub="Your plan, payments and receipts.">
      {notification && (
        <div className={`alert-box ${notification.type}`} role={notification.type === 'error' ? 'alert' : 'status'}>
          {notification.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          <span style={{ flex: 1 }}>{notification.message}</span>
          <button className="icon-btn" onClick={() => setNotification(null)} aria-label="Dismiss" style={{ width: '24px', height: '24px' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="panel-grid">
          <div className="skeleton" style={{ height: '260px', borderRadius: 'var(--r-xl)' }} />
          <div className="skeleton" style={{ height: '260px', borderRadius: 'var(--r-xl)' }} />
        </div>
      ) : (
        <>
          <div className="panel-grid" style={{ marginBottom: '20px' }}>
            {/* CURRENT PLAN */}
            <section className="panel" aria-labelledby="plan-title">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '18px' }}>
                <div>
                  <span className={`badge ${statusBadge.cls}`} style={{ marginBottom: '10px' }}>{statusBadge.text}</span>
                  <h2 id="plan-title" style={{ fontSize: '1.6rem', letterSpacing: '-0.02em' }}>{currentPlan.name}{addonNames.length > 0 && ` + ${addonNames.join(' + ')}`}</h2>
                  <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)', marginTop: '2px' }}>{currentPlan.tagline}</p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: '2.2rem', fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1 }}>
                    ₹{monthlyTotal}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: '4px' }}>{isFree ? 'no plan yet' : 'per month'}</div>
                </div>
              </div>

              <div className="summary">
                <div className="summary-row">
                  <span>{currentPlan.channel === 'whatsapp' ? 'People' : 'Parents'}</span>
                  <b>Up to {currentPlan.parentsIncluded}</b>
                </div>
                <div className="summary-row">
                  <span>{currentPlan.channel === 'whatsapp' ? 'WhatsApp medicine checks' : 'Calls per parent'}</span>
                  <b>Up to {currentPlan.channel === 'whatsapp' ? currentPlan.remindersPerDay : currentPlan.callsPerDay} a day</b>
                </div>
                {!isFree && periodEnd && (
                  <div className="summary-row">
                    <span>{status === 'cancelled' ? 'Access until' : status === 'trialing' ? 'First charge' : 'Next charge'}</span>
                    <b>{status === 'trialing' && trialEnd ? trialEnd : periodEnd}</b>
                  </div>
                )}
                {subscription?.razorpaySubscriptionId && (
                  <div className="summary-row">
                    <span>AutoPay mandate</span>
                    <b><span className="mono">{subscription.razorpaySubscriptionId}</span></b>
                  </div>
                )}
              </div>

              {status === 'past_due' && (
                <div className="alert-box error" style={{ marginTop: '16px', marginBottom: 0 }}>
                  <AlertTriangle size={18} />
                  <span>Your last payment didn&apos;t go through. Razorpay will retry; update your AutoPay method in your UPI or banking app if needed.</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '20px' }}>
                <button onClick={() => setShowSwitchModal(true)} className="btn btn-primary btn-sm">
                  {isFree ? 'Choose a plan' : 'Change plan'} <ArrowUpRight size={14} />
                </button>
                {status === 'cancelled' ? (
                  <button onClick={handleReactivate} className="btn btn-ghost btn-sm">Keep my subscription</button>
                ) : !isFree ? (
                  <button onClick={() => setShowCancelModal(true)} className="btn btn-quiet btn-sm" style={{ color: 'var(--red)' }}>
                    Cancel subscription
                  </button>
                ) : null}
              </div>
            </section>

            {/* PAYMENT METHOD */}
            <section className="panel" aria-labelledby="method-title">
              <div className="panel-head" style={{ marginBottom: '14px' }}>
                <h3 id="method-title">Payment method</h3>
              </div>

              {hasMethod ? (
                <div className="list-row" style={{ marginBottom: '14px' }}>
                  <div className="row-main" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span className="icon-tile" style={{ width: '40px', height: '40px' }}><CreditCard size={18} /></span>
                    <div>
                      <div className="row-title">{subscription?.paymentMethodBrand || 'AutoPay'}</div>
                      {subscription?.paymentMethodLast4 && <div className="row-sub">Ending in •••• {subscription.paymentMethodLast4}</div>}
                    </div>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: '0.92rem', color: 'var(--ink-muted)', marginBottom: '14px' }}>
                  {isFree ? 'None yet. You set up AutoPay when you choose a plan; its 7-day trial is free.' : 'Your AutoPay details are held by Razorpay.'}
                </p>
              )}

              <p className="fine-print">
                <Shield size={16} />
                <span>Cards and UPI mandates are handled by Razorpay under RBI recurring-payment rules. Aaptha never sees your card number or UPI PIN.</span>
              </p>
            </section>
          </div>

          {/* RECEIPTS */}
          <section className="panel" aria-labelledby="receipts-title">
            <div className="panel-head">
              <h3 id="receipts-title">Payments</h3>
            </div>

            {invoices.length === 0 ? (
              <p style={{ fontSize: '0.92rem', color: 'var(--ink-muted)' }}>
                {isFree ? 'No payments yet.' : 'No payments yet. Your first one will appear here.'}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Date</th>
                      <th>Plan</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}><span className="sr-only">Download</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 600 }}>{inv.invoiceNumber}</td>
                        <td style={{ color: 'var(--ink-muted)' }}>{inv.date}</td>
                        <td>{inv.planName}</td>
                        <td style={{ fontWeight: 600 }}>₹{inv.amount}</td>
                        <td>
                          <span className={`badge ${inv.status === 'paid' ? 'badge-green' : inv.status === 'failed' ? 'badge-red' : 'badge-amber'}`} style={{ textTransform: 'capitalize' }}>
                            {inv.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button onClick={() => handleDownloadInvoice(inv)} className="btn btn-quiet btn-sm">
                            <Download size={14} /> Receipt
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <BillShare onNotify={(type, message) => setNotification({ type, message })} />

      {/* CHANGE PLAN */}
      <Modal open={showSwitchModal} onClose={() => setShowSwitchModal(false)} labelledBy="switch-title">
        <h2 id="switch-title" style={{ fontSize: '1.45rem', letterSpacing: '-0.02em', marginBottom: '6px', paddingRight: '32px' }}>Change your plan</h2>
        <p style={{ fontSize: '0.92rem', color: 'var(--ink-muted)', marginBottom: '20px' }}>
          Your parents&apos; schedules stay as they are. Paid plans go through Razorpay checkout.
        </p>

        <div role="radiogroup" aria-label="Plans" style={{ display: 'grid', gap: '8px', marginBottom: '22px' }}>
          {(['free', ...PAID_PLAN_IDS] as PlanId[]).map((pid) => {
            const p = PLANS[pid];
            const isCurrent = currentPlan.id === pid;
            return (
              <button
                key={pid}
                type="button"
                role="radio"
                aria-checked={selectedNewPlan === pid}
                className="plan-option"
                onClick={() => setSelectedNewPlan(pid)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px' }}
              >
                <div style={{ display: 'grid', gap: '2px' }}>
                  <strong style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {p.name}
                    {isCurrent && <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>Current</span>}
                  </strong>
                  <span>
                    {p.channel === 'whatsapp'
                      ? `1 person · WhatsApp medicine checks, up to ${p.remindersPerDay} a day, caretaker told, no calls`
                      : `${p.parentsIncluded} parent${p.parentsIncluded === 1 ? '' : 's'} · up to ${p.callsPerDay} call${p.callsPerDay === 1 ? '' : 's'} a day`}
                  </span>
                </div>
                <strong style={{ fontSize: '1rem' }}>{p.priceMonthly === 0 ? 'Free' : `₹${p.priceMonthly}/mo`}</strong>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setShowSwitchModal(false)} className="btn btn-ghost">Cancel</button>
          <button type="button" disabled={switchLoading || selectedNewPlan === currentPlan.id} onClick={handleSwitchPlan} className="btn btn-primary">
            {switchLoading ? <><span className="spinner" /> Updating…</> : selectedNewPlan === 'free' ? 'Switch to Free' : 'Continue'}
          </button>
        </div>
      </Modal>

      {/* CANCEL */}
      <Modal open={showCancelModal} onClose={() => setShowCancelModal(false)} labelledBy="cancel-title">
        <span className="icon-tile gold" style={{ marginBottom: '14px' }}><HeartCrack size={20} /></span>
        <h2 id="cancel-title" style={{ fontSize: '1.45rem', letterSpacing: '-0.02em', marginBottom: '6px', paddingRight: '32px' }}>Cancel your subscription?</h2>
        <p style={{ fontSize: '0.92rem', color: 'var(--ink-muted)', marginBottom: '18px' }}>
          Your parents&apos; check-in calls continue until <strong style={{ color: 'var(--ink)' }}>{periodEnd || 'the end of this billing period'}</strong>, then you move to the Free plan. You won&apos;t be charged again.
        </p>

        <div className="form-group">
          <label className="form-label" htmlFor="cancel-reason">What made you cancel? <span className="form-hint">Optional</span></label>
          <select id="cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="form-input">
            <option value="Parent moved in with me">My parent moved in with me</option>
            <option value="Timing of calls didn't suit">The call times didn&apos;t suit them</option>
            <option value="Temporary financial reason">Taking a break</option>
            <option value="Other">Something else</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button type="button" onClick={() => setShowCancelModal(false)} className="btn btn-ghost">Keep my plan</button>
          <button type="button" disabled={cancelLoading} onClick={handleCancelSubscription} className="btn btn-danger">
            {cancelLoading ? <><span className="spinner" /> Cancelling…</> : 'Cancel subscription'}
          </button>
        </div>
      </Modal>
    </AccountShell>
  );
}
