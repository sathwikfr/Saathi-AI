'use client';

import React, { useEffect, useState } from 'react';
import { Copy, IndianRupee, Users } from 'lucide-react';

type OwnerView = {
  upiId: string | null;
  planName: string;
  planPrice: number;
  month: string;
  perPerson: number;
  members: { userId: string; name: string; sharesBill: boolean; paidThisMonth: boolean }[];
};
type MemberShare = {
  ownerId: string;
  ownerName: string;
  planName: string;
  month: string;
  amount: number;
  upiId: string | null;
  upiLink: string | null;
  paidThisMonth: boolean;
};

const monthName = (m: string) => new Date(`${m}-01T00:00:00+05:30`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

/**
 * Siblings sharing the bill: the payer adds a UPI ID and picks who chips in; each sharer sees
 * their share with a UPI button and marks "I've paid". Aaptha never holds or moves the money.
 */
export function BillShare({ onNotify }: { onNotify: (type: 'success' | 'error', message: string) => void }) {
  const [owner, setOwner] = useState<OwnerView | null>(null);
  const [shares, setShares] = useState<MemberShare[]>([]);
  const [upi, setUpi] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/bill-share')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return;
        setOwner(d.asOwner);
        setShares(d.asMember || []);
        setUpi(d.asOwner?.upiId || '');
        setLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const post = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const res = await fetch('/api/account/bill-share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return onNotify('error', data.error || 'Could not save.');
    setOwner(data.asOwner);
    setShares(data.asMember || []);
    onNotify('success', ok);
  };

  if (!loaded) return null;
  const showOwner = !!owner && owner.planPrice > 0;
  if (!showOwner && shares.length === 0) return null;
  const sharers = owner?.members.filter(m => m.sharesBill) || [];

  return (
    <>
      {shares.map(s => (
        <section key={s.ownerId} className="panel" aria-labelledby={`share-${s.ownerId}`} style={{ marginTop: '20px' }}>
          <div className="panel-head">
            <div>
              <h3 id={`share-${s.ownerId}`}><IndianRupee size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Your share for {monthName(s.month)}</h3>
              <p>{s.ownerName.split(' ')[0]} pays for Aaptha {s.planName}. You pay {s.ownerName.split(' ')[0]} directly; Aaptha never handles the money.</p>
            </div>
            <span className={`badge ${s.paidThisMonth ? 'badge-green' : 'badge-neutral'}`}>{s.paidThisMonth ? 'Marked as paid' : 'Not paid yet'}</span>
          </div>
          <div className="stat-value" style={{ fontSize: '2rem', margin: '0 0 12px' }}>₹{s.amount.toLocaleString('en-IN')}</div>
          {s.upiLink ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <a className="btn btn-primary" href={s.upiLink}>Pay with a UPI app</a>
              <button type="button" className="btn btn-ghost" onClick={async () => {
                try {
                  await navigator.clipboard.writeText(s.upiId!);
                  onNotify('success', 'UPI ID copied.');
                } catch {
                  onNotify('error', 'Could not copy.');
                }
              }}>
                <Copy size={15} /> {s.upiId}
              </button>
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => post({ ownerId: s.ownerId, paid: !s.paidThisMonth }, s.paidThisMonth ? 'Marked as not paid.' : 'Thanks! Marked as paid.')}>
                {s.paidThisMonth ? 'Undo "paid"' : "I've paid"}
              </button>
            </div>
          ) : (
            <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)' }}>{s.ownerName.split(' ')[0]} hasn&apos;t added a UPI ID yet.</p>
          )}
          <p className="form-hint" style={{ marginTop: '10px' }}>The UPI button opens a payment app on your phone. On a computer, copy the UPI ID instead.</p>
        </section>
      ))}

      {showOwner && owner && (
        <section className="panel" aria-labelledby="split-title" style={{ marginTop: '20px' }}>
          <div className="panel-head">
            <div>
              <h3 id="split-title"><Users size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Share the bill with family</h3>
              <p>Brothers and sisters you invited can chip in for {owner.planName}. They pay you directly by UPI; Aaptha never handles the money.</p>
            </div>
          </div>

          <form
            className="ask-form"
            style={{ maxWidth: '460px', marginBottom: '16px' }}
            onSubmit={e => {
              e.preventDefault();
              post({ upiId: upi }, upi.trim() ? 'UPI ID saved.' : 'UPI ID removed.');
            }}
          >
            <label htmlFor="upi-id" className="sr-only">Your UPI ID</label>
            <input id="upi-id" className="form-input" value={upi} onChange={e => setUpi(e.target.value)} placeholder="Your UPI ID, e.g. ravi@okhdfcbank" maxLength={100} />
            <button type="submit" className="btn btn-ghost" disabled={busy}>Save</button>
          </form>

          {owner.members.length === 0 ? (
            <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)' }}>
              Invite a brother or sister from a parent&apos;s Family tab. Once they join, you can choose who shares the bill here.
            </p>
          ) : (
            <>
              <p style={{ fontSize: '0.92rem', marginBottom: '10px' }}>
                {sharers.length
                  ? <>₹{owner.perPerson.toLocaleString('en-IN')} each for {monthName(owner.month)}, split between you and {sharers.length} other{sharers.length === 1 ? '' : 's'}.</>
                  : 'Nobody shares the bill yet.'}
              </p>
              <div className="list">
                {owner.members.map(m => (
                  <div key={m.userId} className="list-row compact">
                    <div className="row-main">
                      <div className="row-title">
                        {m.name}
                        {m.sharesBill && (
                          <span className={`badge ${m.paidThisMonth ? 'badge-green' : 'badge-neutral'}`}>{m.paidThisMonth ? `Paid for ${monthName(owner.month).split(' ')[0]}` : 'Not paid yet'}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={m.sharesBill}
                      aria-label={`${m.name} shares the bill`}
                      className="switch"
                      disabled={busy}
                      onClick={() => post({ memberId: m.userId, shares: !m.sharesBill }, m.sharesBill ? `${m.name} no longer shares the bill.` : `${m.name} now sees their share.`)}
                    />
                  </div>
                ))}
              </div>
              {sharers.length > 0 && !owner.upiId && <p className="form-hint" style={{ marginTop: '10px' }}>Add your UPI ID so they get a pay button.</p>}
            </>
          )}
        </section>
      )}
    </>
  );
}
