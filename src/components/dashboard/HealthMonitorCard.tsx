'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { HeartPulse } from 'lucide-react';
import { ParentProfile, PlanId } from '@/lib/types';
import { HEALTH_MONITOR, healthMonitorListPrice } from '@/lib/plans';

type Props = {
  parent: ParentProfile;
  /** Solo with the Health Monitor add-on. */
  enabled: boolean;
  /** The time of the short readings call ("08:00 AM"), if one is set. */
  vitalsCall: string | null;
  /** The owner's plan id and what the add-on costs on it (per month). */
  planId: string;
  price: number;
  isOwner: boolean;
  onChanged: () => void;
  onToast: (text: string, type?: 'success' | 'info' | 'error') => void;
};

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
const str = (v?: number) => (v === undefined || v === null ? '' : String(v));

/** "08:00 AM" -> "08:00" for <input type="time">. */
function to24(t: string | null): string {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t || '');
  if (!m) return '';
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** "08:00" -> "08:00 AM" (the form the call schedule uses). */
function to12(t: string): string {
  const [hh, mm] = t.split(':').map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

/**
 * Solo: the Health Monitor add-on. Without it, an offer; with it, which readings Saathi asks for, the family's limits,
 * and the time of the short readings call (a call of its own, so the medicine calls stay under a minute).
 */
export function HealthMonitorCard({ parent, enabled, vitalsCall, planId, price, isOwner, onChanged, onToast }: Props) {
  const first = parent.name.split(' ')[0];
  const r = parent.readingRanges ?? {};
  const [readings, setReadings] = useState<string[]>(parent.readingsToAsk);
  const [sysMax, setSysMax] = useState(str(r.bpSysMax));
  const [diaMax, setDiaMax] = useState(str(r.bpDiaMax));
  const [sysMin, setSysMin] = useState(str(r.bpSysMin));
  const [sugarMax, setSugarMax] = useState(str(r.sugarMax));
  const [sugarMin, setSugarMin] = useState(str(r.sugarMin));
  const [time, setTime] = useState(to24(vitalsCall) || '08:00');
  const [everyDays, setEveryDays] = useState(parent.readingsEveryDays === 3 ? 3 : 1);
  const [saving, setSaving] = useState(false);

  const toggle = (k: string) => setReadings(l => (l.includes(k) ? l.filter(x => x !== k) : [...l, k]));

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    const res = await fetch(`/api/parents/${parent.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    onToast(res.ok ? data.message || 'Saved.' : data.error || 'Could not save.', res.ok ? 'success' : 'error');
    if (res.ok) onChanged();
  };

  if (!enabled) {
    return (
      <section className="panel" aria-labelledby="hm-title" style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        <span className="icon-tile gold"><HeartPulse size={20} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong id="hm-title" style={{ display: 'block', marginBottom: '4px' }}>{HEALTH_MONITOR.name}: +{healthMonitorListPrice(planId as PlanId) && <s className="was-price">₹{healthMonitorListPrice(planId as PlanId)}</s>}₹{price}/month</strong>
          <p style={{ fontSize: '0.88rem', color: 'var(--ink-muted)', margin: 0 }}>
            {HEALTH_MONITOR.tagline}. Saathi asks {first} every day or every 3 days (your choice) on a short call of its own, shows a chart, alerts you when a reading is out of range, and tells you when sleep, mood or appetite drift from {first}&apos;s usual. Saathi never comments on the numbers.
          </p>
          {isOwner && (
            <Link href={`/checkout/confirm?plan=${planId}&monitor=1`} className="btn btn-ghost btn-sm" style={{ marginTop: '10px' }}>
              Add {HEALTH_MONITOR.name}
            </Link>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="hm-title">
      <div className="panel-head">
        <div>
          <h3 id="hm-title"><HeartPulse size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />{HEALTH_MONITOR.name}</h3>
          <p>BP and sugar by voice. Saathi never comments on the numbers.</p>
        </div>
      </div>

      <fieldset className="pref-block">
        <legend>Readings call</legend>
        <p className="form-hint">One short call, just for the readings, so the medicine calls stay short. Choose a time when {first} usually checks.</p>
        <div className="ask-form" style={{ marginTop: '10px', maxWidth: '420px' }}>
          <label htmlFor="hm-time" className="sr-only">Time of the readings call</label>
          <input id="hm-time" type="time" className="form-input" value={time} onChange={e => setTime(e.target.value)} />
          <button type="button" className="btn btn-primary" disabled={saving || !time} onClick={() => patch({ action: 'vitals_call', time: to12(time) })}>
            {vitalsCall ? 'Change time' : 'Start the calls'}
          </button>
          {vitalsCall && <button type="button" className="btn btn-quiet" disabled={saving} onClick={() => patch({ action: 'vitals_call', time: null })}>Turn off</button>}
        </div>
        <p className="form-hint" style={{ marginTop: '6px' }}>
          {vitalsCall
            ? `Saathi calls ${first} at ${vitalsCall} for BP and sugar, ${everyDays === 3 ? 'every 3 days' : 'every day'}.`
            : `No readings call yet: Saathi asks for the readings on the medicine calls, ${everyDays === 3 ? 'every 3 days' : 'every day'}.`}
        </p>
        <p className="form-label" style={{ marginTop: '12px' }}>How often</p>
        <div className="segmented" role="radiogroup" aria-label="How often Saathi asks for readings">
          {[1, 3].map(n => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={everyDays === n}
              className={everyDays === n ? 'active' : ''}
              disabled={saving}
              onClick={() => { setEveryDays(n); patch({ action: 'details', updates: { readingsEveryDays: n } }); }}
            >
              {n === 1 ? 'Every day' : 'Every 3 days'}
            </button>
          ))}
        </div>
        <p className="form-hint" style={{ marginTop: '6px' }}>If {first} misses a day, Saathi asks again the next day.</p>
      </fieldset>

      <fieldset className="pref-block">
        <legend>What to ask for</legend>
        <div className="pill-toggles" style={{ margin: '10px 0' }}>
          <button type="button" className="pill-toggle" aria-pressed={readings.includes('bp')} onClick={() => toggle('bp')}>Ask for BP</button>
          <button type="button" className="pill-toggle" aria-pressed={readings.includes('sugar')} onClick={() => toggle('sugar')}>Ask for sugar</button>
        </div>
        <p className="form-hint" style={{ marginBottom: '8px' }}>Limits are optional. Ask {first}&apos;s doctor which numbers to watch. Readings outside them, or at levels doctors treat as urgent, come to you as an alert.</p>
        <div className="row-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="hm-sysmax">BP top number above</label>
            <input id="hm-sysmax" className="form-input" inputMode="numeric" value={sysMax} onChange={e => setSysMax(e.target.value)} placeholder="e.g. 150" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="hm-diamax">BP bottom number above</label>
            <input id="hm-diamax" className="form-input" inputMode="numeric" value={diaMax} onChange={e => setDiaMax(e.target.value)} placeholder="e.g. 95" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="hm-sysmin">BP top number below</label>
            <input id="hm-sysmin" className="form-input" inputMode="numeric" value={sysMin} onChange={e => setSysMin(e.target.value)} placeholder="e.g. 100" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="hm-sugmax">Sugar above (mg/dL)</label>
            <input id="hm-sugmax" className="form-input" inputMode="numeric" value={sugarMax} onChange={e => setSugarMax(e.target.value)} placeholder="e.g. 200" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="hm-sugmin">Sugar below (mg/dL)</label>
            <input id="hm-sugmin" className="form-input" inputMode="numeric" value={sugarMin} onChange={e => setSugarMin(e.target.value)} placeholder="e.g. 80" />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: '12px' }}
          disabled={saving}
          onClick={() =>
            patch({
              action: 'details',
              updates: {
                readingsToAsk: readings,
                readingRanges: { bpSysMax: numOrNull(sysMax), bpDiaMax: numOrNull(diaMax), bpSysMin: numOrNull(sysMin), sugarMax: numOrNull(sugarMax), sugarMin: numOrNull(sugarMin) }
              }
            })
          }
        >
          {saving ? <span className="spinner" /> : 'Save'}
        </button>
      </fieldset>
    </section>
  );
}
