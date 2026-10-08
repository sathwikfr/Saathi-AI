'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, CheckCircle2, X } from 'lucide-react';
import { PhoneField } from '@/components/auth/AuthUI';
import { CheckRow } from '@/components/checkout/CheckoutUI';

export interface WhatsAppStatus {
  available: boolean;
  optedIn: boolean;
  optedInAt: string | null;
  number: string;
  /** This number has sent us START, so updates are really being sent. */
  verified: boolean;
  /** wa.me link that opens WhatsApp with START ready to send (null when already proven). */
  startLink: string | null;
}

export function useWhatsAppStatus() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/whatsapp', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setStatus(data.whatsapp);
    } catch {
      /* leave status null: the UI simply doesn't show WhatsApp controls */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data loading on mount
    load();
  }, [load]);

  const save = useCallback(async (optIn: boolean, number?: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch('/api/account/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn, number })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save your WhatsApp setting.');
        return false;
      }
      setStatus(data.whatsapp);
      return true;
    } catch {
      setError('Network error. Please try again.');
      return false;
    }
  }, []);

  return { status, error, save };
}

function pretty(e164: string): string {
  const m = e164.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/** Profile page: turn WhatsApp call updates on (number + explicit consent) or off. */
export function WhatsAppSettings() {
  const { status, error, save } = useWhatsAppStatus();
  const [number, setNumber] = useState('');
  const [consent, setConsent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill once the status arrives
    if (status) setNumber(status.number);
  }, [status]);

  if (!status) return null;

  const run = async (optIn: boolean) => {
    setBusy(true);
    const ok = await save(optIn, optIn ? number : undefined);
    setBusy(false);
    if (ok) {
      setEditing(false);
      setConsent(false);
    }
  };

  const notLive = !status.available && (
    <p className="form-hint" style={{ marginTop: '8px' }}>
      WhatsApp updates are being switched on. Turn them on now and they will start automatically.
    </p>
  );

  if (status.optedIn && !editing) {
    return (
      <div className="toggle-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <strong><MessageCircle size={16} color="var(--green)" /> WhatsApp {status.verified ? <span className="badge badge-green">On</span> : <span className="badge">Waiting for START</span>}</strong>
          {status.verified ? (
            <p>Call updates and alerts go to {pretty(status.number)}. Reply STOP on WhatsApp at any time to turn them off.</p>
          ) : (
            <>
              <p>
                <strong>One more step:</strong> to make sure {pretty(status.number)} is really your number, send the word START to Aaptha from that WhatsApp.
                Updates begin as soon as we receive it.
              </p>
              {status.startLink && (
                <p style={{ marginTop: '6px' }}>
                  <a className="btn btn-primary btn-sm" href={status.startLink} target="_blank" rel="noopener noreferrer">Open WhatsApp and send START</a>
                </p>
              )}
            </>
          )}
          {notLive}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Change number</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(false)}>Turn off</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid var(--line-subtle)' }}>
      <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
        <MessageCircle size={16} color="var(--teal)" /> WhatsApp call updates
      </strong>
      <p style={{ fontSize: '0.88rem', color: 'var(--ink-muted)', margin: '4px 0 12px' }}>
        After each call we send you one short WhatsApp message: what your parent said, which medicines were taken, and anything that needs you.
        Emergencies arrive while the call is still going on.
      </p>
      <div className="form-group">
        <label className="form-label" htmlFor="wa-number">WhatsApp number</label>
        <PhoneField id="wa-number" value={number} onChange={setNumber} />
      </div>
      <CheckRow checked={consent} onChange={setConsent} title="Send call updates to this WhatsApp number">
        I agree to receive messages from Aaptha on WhatsApp about calls with my parents. I can reply STOP at any time.
      </CheckRow>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={!consent || busy || !number.trim()} onClick={() => run(true)}>
          {busy ? <><span className="spinner" /> Saving…</> : <><CheckCircle2 size={15} /> Turn on WhatsApp updates</>}
        </button>
        {editing && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setNumber(status.number); }}>Cancel</button>
        )}
      </div>
      {notLive}
    </div>
  );
}

const DISMISS_KEY = 'aaptha_wa_banner_dismissed';

/** Dashboard prompt for families who haven't turned WhatsApp updates on yet. */
export function WhatsAppOptInBanner() {
  const { status, error, save } = useWhatsAppStatus();
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let hidden = false;
    try {
      hidden = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      hidden = false;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read browser storage after mount
    setDismissed(hidden);
  }, []);

  if (!status || status.optedIn || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage blocked: hide for this visit only */
    }
  };

  return (
    <div className="banner gold" role="region" aria-label="WhatsApp call updates">
      <span className="icon-tile gold"><MessageCircle size={20} /></span>
      <div>
        <strong>Get call updates on WhatsApp</strong>
        <span style={{ color: 'var(--ink-muted)' }}>
          One short message after each call, and emergencies straight away.
          {!status.available && ' WhatsApp updates are being switched on; turn them on now and they will start automatically.'}
        </span>
        {error && <span className="form-error" role="alert" style={{ display: 'block' }}>{error}</span>}
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {status.number ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => { setBusy(true); await save(true); setBusy(false); }}
          >
            Send them to {pretty(status.number)}
          </button>
        ) : null}
        <Link href="/account/profile?tab=notifications" className="btn btn-ghost btn-sm">
          {status.number ? 'Use another number' : 'Add WhatsApp number'}
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" aria-label="Hide" onClick={dismiss}><X size={16} /></button>
      </div>
    </div>
  );
}
