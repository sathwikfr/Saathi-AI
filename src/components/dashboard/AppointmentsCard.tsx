'use client';

import React, { useEffect, useState } from 'react';
import { CalendarCheck, Check, Plus } from 'lucide-react';

type Appointment = {
  id: string;
  title: string;
  kind: 'doctor' | 'lab' | 'other';
  startsAt: string;
  location: string | null;
  notes: string | null;
  fasting: boolean;
  remindedDayBefore?: string;
  remindedSameDay?: string;
  followedUpAt?: string;
  outcomeText: string | null;
  cancelledAt?: string;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function AddAppointmentForm({ parentId, onDone, onCancel, onToast }: {
  parentId: string;
  onDone: () => void;
  onCancel: () => void;
  onToast: (text: string, type?: 'success' | 'info' | 'error') => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'doctor' | 'lab' | 'other'>('doctor');
  const [startsAt, setStartsAt] = useState('');
  const [location, setLocation] = useState('');
  const [fasting, setFasting] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/parents/${parentId}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, kind, startsAt: startsAt ? new Date(startsAt).toISOString() : '', location, fasting })
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return onToast(data.error || 'Could not save.', 'error');
    onToast(data.message, 'success');
    onDone();
  };

  return (
    <form onSubmit={submit} className="inline-form">
      <div className="segmented" role="radiogroup" aria-label="Kind">
        {(['doctor', 'lab', 'other'] as const).map(k => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {k === 'doctor' ? 'Doctor' : k === 'lab' ? 'Lab test' : 'Other'}
          </button>
        ))}
      </div>
      <div className="row-grid" style={{ marginTop: '12px' }}>
        <div className="form-group">
          <label className="form-label" htmlFor="ap-title">What for</label>
          <input id="ap-title" className="form-input" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} required
            placeholder={kind === 'lab' ? 'e.g. blood test' : kind === 'doctor' ? 'e.g. eye check-up' : 'e.g. physiotherapy'} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="ap-when">Date and time</label>
          <input id="ap-when" type="datetime-local" className="form-input" value={startsAt} onChange={e => setStartsAt(e.target.value)} required />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label" htmlFor="ap-where">Where <span className="form-hint">optional</span></label>
          <input id="ap-where" className="form-input" value={location} onChange={e => setLocation(e.target.value)} maxLength={120} placeholder="e.g. Apollo Clinic, Jubilee Hills" />
        </div>
      </div>
      <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.9rem', marginBottom: '12px' }}>
        <input type="checkbox" checked={fasting} onChange={e => setFasting(e.target.checked)} />
        Needs an empty stomach (we mention it in the reminder, as your instruction)
      </label>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? <><span className="spinner" /> Saving…</> : 'Save'}</button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Doctor visits and lab tests: Saathi reminds the day before and on the day, then asks how it went. */
export function AppointmentsCard({ parentId, parentName, manage, onToast, whatsapp = false }: {
  parentId: string;
  parentName: string;
  manage: boolean;
  /** Remind: reminders go on WhatsApp (the evening before and the morning of), with no "how did it go?" afterwards. */
  whatsapp?: boolean;
  onToast: (text: string, type?: 'success' | 'info' | 'error') => void;
}) {
  const [rows, setRows] = useState<Appointment[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  const [now] = useState(() => Date.now());
  const first = parentName.split(' ')[0];

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/parents/${parentId}/appointments`)
      .then(r => (r.ok ? r.json() : { appointments: [] }))
      .then(d => !cancelled && setRows(d.appointments || []))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [parentId, version]);

  const cancel = async (id: string) => {
    const res = await fetch(`/api/parents/${parentId}/appointments`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, cancel: true })
    });
    if (res.ok) {
      onToast('Cancelled. Saathi won\'t mention it.', 'info');
      setVersion(v => v + 1);
    }
  };

  const live = (rows || []).filter(a => !a.cancelledAt);
  const upcoming = live.filter(a => Date.parse(a.startsAt) >= now - 2 * 3600000);
  const past = live.filter(a => Date.parse(a.startsAt) < now - 2 * 3600000).reverse().slice(0, 3);

  return (
    <section className="panel" aria-labelledby="appt-title">
      <div className="panel-head">
        <div>
          <h3 id="appt-title"><CalendarCheck size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Appointments</h3>
          <p>{whatsapp ? `We message ${first} on WhatsApp the evening before and the morning of.` : `Saathi reminds ${first} the day before and on the day, then asks how it went.`}</p>
        </div>
        {manage && !adding && <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> Add</button>}
      </div>

      {adding && (
        <AddAppointmentForm parentId={parentId} onToast={onToast} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); setVersion(v => v + 1); }} />
      )}

      {rows === null ? (
        <div className="skeleton" style={{ height: '60px' }} />
      ) : upcoming.length === 0 && past.length === 0 ? (
        !adding && <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)' }}>Nothing coming up.</p>
      ) : (
        <div className="list">
          {upcoming.map(a => (
            <div key={a.id} className="list-row compact">
              <div className="row-main">
                <div className="row-title">
                  {a.title}
                  {a.fasting && <span className="badge badge-amber">Empty stomach</span>}
                </div>
                <div className="row-sub">{fmt(a.startsAt)}{a.location ? ` · ${a.location}` : ''}</div>
                {(a.remindedDayBefore || a.remindedSameDay) && (
                  <div className="row-sub" style={{ color: 'var(--green)' }}>
                    <Check size={12} style={{ verticalAlign: '-1px' }} /> {whatsapp ? `We messaged ${first}` : `Saathi reminded ${first}`}{a.remindedSameDay ? ' on the day' : ' the day before'}
                  </div>
                )}
              </div>
              {manage && <button className="btn btn-quiet btn-sm" onClick={() => cancel(a.id)}>Cancel</button>}
            </div>
          ))}
          {past.map(a => (
            <div key={a.id} className="list-row compact">
              <div className="row-main">
                <div className="row-title">{a.title} <span className="badge badge-neutral">{new Date(a.startsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></div>
                <div className="row-sub">
                  {a.outcomeText
                    ? <>Afterwards {first} said: &ldquo;{a.outcomeText}&rdquo;</>
                    : !whatsapp && now - Date.parse(a.startsAt) < 4 * 86400000
                      ? `Saathi will ask ${first} how it went.`
                      : whatsapp ? 'Done.' : 'No update from the calls.'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
