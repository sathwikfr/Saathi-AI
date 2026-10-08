'use client';

import React, { useState } from 'react';
import { Ear, SlidersHorizontal, Users } from 'lucide-react';
import { ParentProfile } from '@/lib/types';
import { PhoneField } from '@/components/auth/AuthUI';

type Props = {
  parent: ParentProfile;
  isOwner: boolean;
  /** Family / Extended: one call for a couple sharing a phone. */
  premium: boolean;
  callTogetherCandidates: { id: string; name: string }[];
  onChanged: () => void;
  onToast: (text: string, type?: 'success' | 'info' | 'error') => void;
};

/** What Saathi does on the calls besides medicines: hearing mode, the chemist, couple calls. */
export function SaathiPreferences({ parent, isOwner, premium, callTogetherCandidates, onChanged, onToast }: Props) {
  const first = parent.name.split(' ')[0];
  const [hearing, setHearing] = useState(parent.hearingMode);
  const [chemistName, setChemistName] = useState(parent.chemistName || '');
  const [chemistPhone, setChemistPhone] = useState((parent.chemistPhone || '').replace(/^\+91/, ''));
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/parents/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'details',
        // Hearing-friendly calls and the chemist. (BP / sugar are saved from the Health Monitor card.)
        updates: { hearingMode: hearing, chemistName, chemistPhone: chemistPhone || null }
      })
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    onToast(res.ok ? 'Saved. Saathi uses this from the next call.' : data.error || 'Could not save.', res.ok ? 'success' : 'error');
    if (res.ok) onChanged();
  };

  const callTogether = async (partnerId: string | null) => {
    const res = await fetch(`/api/parents/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'call_together', partnerId })
    });
    const data = await res.json().catch(() => ({}));
    onToast(res.ok ? data.message : data.error || 'Could not save.', res.ok ? 'success' : 'error');
    if (res.ok) onChanged();
  };

  return (
    <section className="panel" aria-labelledby="prefs-title">
      <div className="panel-head">
        <div>
          <h3 id="prefs-title"><SlidersHorizontal size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />What Saathi does on the calls</h3>
          <p>Small extras on top of the medicine questions. Calls stay short.</p>
        </div>
      </div>

      {premium && isOwner && callTogetherCandidates.length > 0 && (
        <div className="toggle-row" style={{ paddingTop: 0 }}>
          <div>
            <strong><Users size={15} style={{ verticalAlign: '-2px', marginRight: '6px' }} />One call for {first} and {callTogetherCandidates[0].name.split(' ')[0]}</strong>
            <p>
              They share a phone, so Saathi can ask about both on one call. It starts once both have said yes on their own first call.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={parent.callTogetherWithId === callTogetherCandidates[0].id}
            aria-label="Call them together"
            className="switch"
            onClick={() => callTogether(parent.callTogetherWithId === callTogetherCandidates[0].id ? null : callTogetherCandidates[0].id)}
          />
        </div>
      )}

      <form onSubmit={save}>
        <div className="toggle-row" style={premium && isOwner && callTogetherCandidates.length > 0 ? undefined : { paddingTop: 0 }}>
          <div>
            <strong><Ear size={15} style={{ verticalAlign: '-2px', marginRight: '6px' }} />Hearing-friendly calls</strong>
            <p>Saathi speaks more slowly, in short sentences, and repeats a question once if {first} didn&apos;t catch it.</p>
          </div>
          <button type="button" role="switch" aria-checked={hearing} aria-label="Hearing-friendly calls" className="switch" onClick={() => setHearing(v => !v)} />
        </div>

        <fieldset className="pref-block">
          <legend>Chemist</legend>
          <p className="form-hint">For the refill list on the Medicines tab. You send it yourself on WhatsApp; Aaptha doesn&apos;t order anything.</p>
          <div className="row-grid" style={{ marginTop: '10px' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="pr-chemist">Shop name</label>
              <input id="pr-chemist" className="form-input" value={chemistName} onChange={e => setChemistName(e.target.value)} maxLength={120} placeholder="e.g. Sri Sai Medicals" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="pr-chemist-phone">Their WhatsApp number</label>
              <PhoneField id="pr-chemist-phone" value={chemistPhone} onChange={setChemistPhone} indiaOnly optional />
            </div>
          </div>
        </fieldset>

        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <><span className="spinner" /> Saving…</> : 'Save'}</button>
      </form>
    </section>
  );
}
