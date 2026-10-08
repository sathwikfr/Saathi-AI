'use client';

import React, { useEffect, useState } from 'react';
import { Ear, Plus, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import { ParentProfile } from '@/lib/types';
import { PhoneField } from '@/components/auth/AuthUI';
import Link from 'next/link';
import { DAILY_TOUCHES } from '@/lib/plans';

type Props = {
  parent: ParentProfile;
  isOwner: boolean;
  /** Family / Extended: BP/sugar, weather, festivals, special days, helper check, couple calls. */
  premium: boolean;
  /** Daily Touches add-on on, the owner's plan id, and its price. */
  touches: boolean;
  planId: string;
  touchesPrice: number;
  callTogetherCandidates: { id: string; name: string }[];
  onChanged: () => void;
  onToast: (text: string, type?: 'success' | 'info' | 'error') => void;
};

type SpecialDay = { date: string; label: string; kind: 'greet' | 'fast'; yearly: boolean };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Turns a stored special day ("MM-DD" = every year, "YYYY-MM-DD" = once) into form state. */
function toForm(d: { date: string; label: string; kind: 'greet' | 'fast' }): SpecialDay {
  const yearly = d.date.length === 5;
  return { date: yearly ? `${new Date().getFullYear()}-${d.date}` : d.date, label: d.label, kind: d.kind, yearly };
}

/** What Saathi does on the calls besides medicines: readings, hearing mode, weather, festivals, helper, chemist, couple calls. */
export function SaathiPreferences({ parent, isOwner, premium, touches, planId, touchesPrice, callTogetherCandidates, onChanged, onToast }: Props) {
  const first = parent.name.split(' ')[0];
  const [hearing, setHearing] = useState(parent.hearingMode);
  const [festivals, setFestivals] = useState<string[]>(parent.festivals);
  const [options, setOptions] = useState<{ name: string; nextDate: string | null }[] | null>(null);
  const [days, setDays] = useState<SpecialDay[]>(parent.specialDays.map(toForm));
  const [helperName, setHelperName] = useState(parent.helperName || '');
  const [helperDays, setHelperDays] = useState<number[]>(parent.helperDays);
  const [chemistName, setChemistName] = useState(parent.chemistName || '');
  const [chemistPhone, setChemistPhone] = useState((parent.chemistPhone || '').replace(/^\+91/, ''));
  const [city, setCity] = useState(parent.city || '');
  const [saving, setSaving] = useState(false);
  const [savingCity, setSavingCity] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/festivals')
      .then(res => (res.ok ? res.json() : { festivals: [] }))
      .then(d => !cancelled && setOptions(d.festivals || []))
      .catch(() => !cancelled && setOptions([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/parents/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'details',
        // Everyone: hearing-friendly calls and the chemist. Daily Touches adds the festivals, special days and the helper.
        // (BP / sugar are saved from the Health Monitor card.)
        updates: touches
          ? {
              hearingMode: hearing,
              festivals,
              specialDays: days
                .filter(d => d.label.trim() && d.date)
                .map(d => ({ date: d.yearly ? d.date.slice(5, 10) : d.date.slice(0, 10), label: d.label, kind: d.kind })),
              helperName,
              helperDays,
              chemistName,
              chemistPhone: chemistPhone || null
            }
          : { hearingMode: hearing, chemistName, chemistPhone: chemistPhone || null }
      })
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    onToast(res.ok ? 'Saved. Saathi uses this from the next call.' : data.error || 'Could not save.', res.ok ? 'success' : 'error');
    if (res.ok) onChanged();
  };

  const saveCity = async () => {
    setSavingCity(true);
    const res = await fetch(`/api/parents/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'city', city })
    });
    const data = await res.json().catch(() => ({}));
    setSavingCity(false);
    if (res.ok && data.city) setCity(data.city);
    onToast(res.ok ? data.message : data.error || 'Could not save.', res.ok ? 'success' : 'error');
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

  // Festivals the family ticked earlier stay visible even if the calendar feed doesn't list them this year.
  const festivalNames = [...new Set([...(options || []).map(o => o.name), ...festivals])];
  const nextDate = (name: string) => {
    const d = options?.find(o => o.name === name)?.nextDate;
    return d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null;
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

        {touches ? (
          <>
            <fieldset className="pref-block">
              <legend>Weather</legend>
              <p className="form-hint">On very hot, cold or heavy-rain days, Saathi adds one line, like &ldquo;drink plenty of water today&rdquo;.</p>
              <div className="ask-form" style={{ marginTop: '10px', maxWidth: '460px' }}>
                <label htmlFor="pr-city" className="sr-only">Town or city</label>
                <input id="pr-city" className="form-input" value={city} onChange={e => setCity(e.target.value)} placeholder="Town or city, e.g. Vijayawada" maxLength={80} />
                <button type="button" className="btn btn-ghost" onClick={saveCity} disabled={savingCity}>
                  {savingCity ? <span className="spinner" /> : city.trim() ? 'Save town' : 'Turn off'}
                </button>
              </div>
              {parent.hasWeatherLocation && parent.city && <p className="form-hint" style={{ marginTop: '6px' }}>Weather notes for {parent.city}.</p>}
            </fieldset>

            <fieldset className="pref-block">
              <legend>Festivals {first} celebrates</legend>
              <p className="form-hint">Saathi wishes {first} only on the festivals you tick.</p>
              {options === null ? (
                <div className="skeleton" style={{ height: '40px', marginTop: '10px' }} />
              ) : festivalNames.length === 0 ? (
                <p className="form-hint" style={{ marginTop: '8px' }}>The festival calendar couldn&apos;t be loaded right now. You can still add days below.</p>
              ) : (
                <div className="pill-toggles" style={{ marginTop: '10px', maxHeight: '220px', overflowY: 'auto' }}>
                  {festivalNames.map(name => (
                    <button key={name} type="button" className="pill-toggle" aria-pressed={festivals.includes(name)} onClick={() => setFestivals(l => toggle(l, name))}>
                      {name}{nextDate(name) && <small>{nextDate(name)}</small>}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className="pref-block">
              <legend>{first}&apos;s own special days</legend>
              <p className="form-hint">An anniversary, a family puja, or a fasting day (Saathi won&apos;t talk about food that day).</p>
              <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                {days.map((d, i) => (
                  <div key={i} className="special-day-row">
                    <input className="form-input" aria-label="Name of the day" value={d.label} maxLength={60} placeholder="e.g. Wedding anniversary"
                      onChange={e => setDays(l => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <input className="form-input" type="date" aria-label="Date" value={d.date}
                      onChange={e => setDays(l => l.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
                    <select className="form-input" aria-label="Kind of day" value={`${d.kind}-${d.yearly ? 'y' : 'o'}`}
                      onChange={e => {
                        const [kind, y] = e.target.value.split('-');
                        setDays(l => l.map((x, j) => (j === i ? { ...x, kind: kind as 'greet' | 'fast', yearly: y === 'y' } : x)));
                      }}>
                      <option value="greet-y">Wish them, every year</option>
                      <option value="greet-o">Wish them, this date only</option>
                      <option value="fast-y">Fasting day, every year</option>
                      <option value="fast-o">Fasting day, this date only</option>
                    </select>
                    <button type="button" className="icon-btn" aria-label="Remove this day" onClick={() => setDays(l => l.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
              {days.length < 30 && (
                <button type="button" className="btn btn-quiet btn-sm" style={{ marginTop: '8px' }}
                  onClick={() => setDays(l => [...l, { date: '', label: '', kind: 'greet', yearly: true }])}>
                  <Plus size={14} /> Add a day
                </button>
              )}
            </fieldset>

            <fieldset className="pref-block">
              <legend>Paid helper</legend>
              <p className="form-hint">If a cook, maid or nurse is meant to come, Saathi asks &ldquo;Did they come today?&rdquo; on the last call of those days. You hear if they didn&apos;t.</p>
              <div className="row-grid" style={{ marginTop: '10px' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="pr-helper">Their name</label>
                  <input id="pr-helper" className="form-input" value={helperName} onChange={e => setHelperName(e.target.value)} maxLength={60} placeholder="e.g. Lakshmi" />
                </div>
                <div className="form-group">
                  <span className="form-label">Days they come</span>
                  <div className="pill-toggles">
                    {WEEKDAYS.map((w, i) => (
                      <button key={w} type="button" className="pill-toggle" aria-pressed={helperDays.includes(i)} onClick={() => setHelperDays(l => toggle(l, i))}>{w}</button>
                    ))}
                  </div>
                </div>
              </div>
            </fieldset>
          </>
        ) : (
          <section className="pref-block" aria-label={DAILY_TOUCHES.name}>
            <strong style={{ display: 'block', marginBottom: '4px' }}>{DAILY_TOUCHES.name}: +₹{touchesPrice}/month</strong>
            <p className="form-hint" style={{ margin: 0 }}>
              {DAILY_TOUCHES.tagline}. Saathi adds them only on a call that has room, so calls stay short.
            </p>
            {isOwner && (
              <Link href={`/checkout/confirm?plan=${planId}&touches=1`} className="btn btn-ghost btn-sm" style={{ marginTop: '10px' }}>
                Add {DAILY_TOUCHES.name}
              </Link>
            )}
          </section>
        )}

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
