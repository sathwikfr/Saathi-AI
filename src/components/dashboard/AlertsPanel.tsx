'use client';

import React, { useState } from 'react';
import { Bell, BellRing, Siren, Info, PhoneCall, CheckCircle2 } from 'lucide-react';
import { AlertRecord } from '@/lib/types';
import { formatCallTime } from './helpers';

const LEVEL_LABEL: Record<number, string> = {
  0: 'All fine',
  1: 'For your information',
  2: 'Needs attention',
  3: 'Urgent',
  4: 'Emergency'
};

const OUTCOMES: { value: NonNullable<AlertRecord['outcome']>; label: string }[] = [
  { value: 'fine', label: 'All fine' },
  { value: 'doctor_visit', label: 'Saw a doctor' },
  { value: 'hospital', label: 'Went to hospital' },
  { value: 'other', label: 'Something else' }
];

const ATTEMPT_STATUS: Record<string, string> = {
  pending: 'calling',
  placed: 'ringing',
  answered: 'answered',
  no_answer: 'no answer',
  busy: 'line busy',
  failed: "couldn't call"
};

type Toast = (text: string, type?: 'success' | 'info' | 'error') => void;

async function act(parentId: string, alertId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/parents/${parentId}/alerts/${alertId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

function OutcomeForm({ parentId, alert, onDone, onToast }: { parentId: string; alert: AlertRecord; onDone: () => void; onToast: Toast }) {
  const [outcome, setOutcome] = useState<AlertRecord['outcome']>();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <div className="card-flat" style={{ marginTop: '12px', background: 'var(--paper)', padding: '12px 14px' }}>
      <div style={{ fontSize: '0.86rem', fontWeight: 600, marginBottom: '8px' }}>What happened? This closes the alert.</div>
      <div className="segmented" role="radiogroup" aria-label="What happened" style={{ marginBottom: '8px', flexWrap: 'wrap' }}>
        {OUTCOMES.map(o => (
          <button key={o.value} type="button" role="radio" aria-checked={outcome === o.value} className={outcome === o.value ? 'active' : ''} onClick={() => setOutcome(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input className="form-input" style={{ flex: 1, minWidth: '180px' }} value={note} onChange={e => setNote(e.target.value)} placeholder="A note for the family (optional)" maxLength={500} />
        <button
          className="btn btn-primary btn-sm"
          disabled={!outcome || saving}
          onClick={async () => {
            setSaving(true);
            const r = await act(parentId, alert.id, { action: 'outcome', outcome, note });
            setSaving(false);
            onToast(r.ok ? r.data.message : r.data.error || 'Could not save.', r.ok ? 'success' : 'error');
            if (r.ok) onDone();
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

export function AlertsPanel({ parentId, parentName, alerts, onChanged, onToast, manage = true }: { parentId: string; parentName: string; alerts: AlertRecord[]; onChanged: () => void; onToast: Toast; /** false for view-only members: no "I'm on it" / closing, they call the parent themselves */ manage?: boolean }) {
  const shown = alerts.filter(a => a.level > 0);
  if (shown.length === 0) {
    return (
      <div className="panel empty">
        <span className="icon-tile" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}><Bell size={24} /></span>
        <h3>Nothing to worry about</h3>
        <p>If a call with {parentName} raises a concern, like a missed medicine, a low mood or a mention of feeling unwell, it will show up here.</p>
      </div>
    );
  }

  return (
    <section className="panel" aria-labelledby="alerts-title">
      <div className="panel-head">
        <div>
          <h3 id="alerts-title">Alerts</h3>
          <p>Raised from {parentName}&apos;s calls. Each alert shows how we told you and who is handling it.</p>
        </div>
      </div>

      <div className="list">
        {shown.map((alt) => {
          const tone = alt.level >= 3 ? 'critical' : alt.level >= 2 ? 'urgent' : '';
          const Icon = alt.level >= 3 ? Siren : alt.level >= 2 ? BellRing : Info;
          const esc = alt.escalation;
          const live = esc?.status === 'active';
          const needsOutcome = alt.level >= 3 && !alt.outcome && (!!alt.acknowledgedAt || (esc && esc.status !== 'active'));
          return (
            <article key={alt.id} className={`alert-item ${tone}`}>
              <span className="level-orb"><Icon size={19} /></span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <strong style={{ fontWeight: 600 }}>{alt.title}</strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--ink-subtle)' }}>{formatCallTime(alt.createdAt || alt.timestamp)}</span>
                </div>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.55, color: 'var(--ink)' }}>{alt.message}</p>

                {esc && esc.kind !== 'practice' && esc.attempts.length > 0 && (
                  <ul className="esc-steps" aria-label="Who we called">
                    {esc.attempts.map((a, i) => (
                      <li key={i}>
                        <PhoneCall size={14} />
                        <span>
                          <b>{a.targetType === 'parent' ? `${parentName} again` : a.name}</b>: {ATTEMPT_STATUS[a.status] || a.status}
                          {a.response === 'yes' && (a.targetType === 'parent' ? ', said they are okay' : ', said they are on it')}
                          {a.response === 'no' && ', could not help'}
                        </span>
                      </li>
                    ))}
                    {live && esc.nextStepAt && <li>Next person at {new Date(esc.nextStepAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} if nobody says they are on it.</li>}
                  </ul>
                )}

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px', alignItems: 'center' }}>
                  <span className={`badge ${alt.level >= 3 ? 'badge-red' : alt.level >= 2 ? 'badge-amber' : 'badge-neutral'}`}>
                    Level {alt.level} · {LEVEL_LABEL[alt.level] || 'Alert'}
                  </span>
                  {alt.channel === 'whatsapp' && <span className="badge badge-neutral">Sent on WhatsApp</span>}
                  {alt.channel === 'email' && alt.level >= 2 && <span className="badge badge-neutral">Emailed</span>}
                  {alt.outcome ? (
                    <span className="badge badge-green"><CheckCircle2 size={12} /> Closed: {OUTCOMES.find(o => o.value === alt.outcome)?.label}{alt.outcomeNote ? ` (${alt.outcomeNote})` : ''}</span>
                  ) : alt.acknowledgedAt ? (
                    <span className="badge badge-green">Handled by {alt.handledByName || 'you'} · {formatCallTime(alt.acknowledgedAt)}</span>
                  ) : alt.status === 'resolved' ? (
                    <span className="badge badge-green">Resolved</span>
                  ) : null}
                  {manage && !alt.acknowledgedAt && !alt.outcome && alt.level >= 2 && (
                    <button
                      className={`btn btn-sm ${live ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={async () => {
                        const r = await act(parentId, alt.id, { action: 'on_it' });
                        onToast(r.ok ? r.data.message : r.data.error || 'Could not save.', r.ok ? 'success' : 'error');
                        if (r.ok) onChanged();
                      }}
                    >
                      I&apos;m on it
                    </button>
                  )}
                </div>
                {manage && needsOutcome && <OutcomeForm parentId={parentId} alert={alt} onDone={onChanged} onToast={onToast} />}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
