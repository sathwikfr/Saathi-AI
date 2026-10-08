'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { CallLog, Medicine, AlertRecord, HealthInsight, ParentProfile } from '@/lib/types';
import { medicineKey } from '@/lib/callInterpretation';

type Report = {
  parent: ParentProfile;
  days: number;
  generatedAt: string;
  medicines: Medicine[];
  callLogs: CallLog[];
  alerts: AlertRecord[];
  insights: HealthInsight[];
  doctor: { name: string | null; phone: string | null };
  readings?: { kind: 'bp' | 'sugar'; systolic: number | null; diastolic: number | null; value: number | null; context: string | null; takenAt: string; source: string }[];
};

const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const short = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** One printable page for the doctor: what the parent said on the calls, not a clinical record. */
export default function DoctorReportPage() {
  const { parentId } = useParams<{ parentId: string }>();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/parents/${parentId}/report?days=${days}`)
      .then(async r => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (ok) setData(body);
        else setError(body.error || 'Could not load the summary.');
      })
      .catch(() => !cancelled && setError('Could not load the summary.'));
    return () => {
      cancelled = true;
    };
  }, [parentId, days]);

  const view = useMemo(() => {
    if (!data) return null;
    const done = data.callLogs.filter(c => c.status !== 'scheduled' && c.status !== 'placed');
    const answered = done.filter(c => c.status === 'answered');
    const perMed = data.medicines.filter(m => m.isActive).map(m => {
      const results = answered.flatMap(c => (c.details?.medicineResults || []).filter(r => medicineKey(r.name) === medicineKey(m.name)).map(r => ({ ...r, at: c.createdAt! })));
      const counted = results.filter(r => r.status !== 'unknown' && r.status !== 'later');
      const taken = counted.filter(r => r.status === 'taken').length;
      return {
        med: m,
        asked: counted.length,
        taken,
        missedDates: results.filter(r => r.status === 'missed').map(r => short(r.at)),
        stopped: results.some(r => r.status === 'stopped')
      };
    });
    const concerns = answered
      .filter(c => c.details?.healthConcern || (c.details?.pain && c.details.pain !== 'none'))
      .map(c => ({
        date: short(c.createdAt!),
        text: c.details?.healthConcern || `pain${c.details?.painWhere ? ` (${c.details.painWhere})` : ''}: ${c.details?.pain}`
      }));
    const moods = answered.reduce<Record<string, number>>((acc, c) => ((acc[c.mood] = (acc[c.mood] || 0) + 1), acc), {});
    const sleepPoor = answered.filter(c => c.details?.sleep === 'poor').length;
    const sleepAsked = answered.filter(c => c.details?.sleep).length;
    const appetitePoor = answered.filter(c => c.details?.appetite === 'poor').length;
    const appetiteAsked = answered.filter(c => c.details?.appetite).length;
    const bp = (data.readings || []).filter(r => r.kind === 'bp' && r.systolic && r.diastolic);
    const sugarBy = (ctx: string) => (data.readings || []).filter(r => r.kind === 'sugar' && r.value && r.context === ctx);
    const sugarRows = [
      { label: 'Fasting', rows: sugarBy('fasting') },
      { label: 'After food', rows: sugarBy('after_food') },
      { label: 'Other times', rows: (data.readings || []).filter(r => r.kind === 'sugar' && r.value && r.context !== 'fasting' && r.context !== 'after_food') }
    ].filter(g => g.rows.length);
    return { done, answered, perMed, concerns, moods, sleepPoor, sleepAsked, appetitePoor, appetiteAsked, bp, sugarRows };
  }, [data]);

  if (error) return <main className="wrap" style={{ padding: '48px 16px' }}><p>{error}</p><Link href="/dashboard">Back to the dashboard</Link></main>;
  if (!data || !view) return <main className="wrap" style={{ padding: '48px 16px' }}><div className="skeleton" style={{ height: '400px' }} /></main>;
  const p = data.parent;

  return (
    <main style={{ padding: '24px 16px 64px', background: 'var(--paper)', minHeight: '100vh' }}>
      <div className="no-print" style={{ maxWidth: '820px', margin: '0 auto 16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Link href="/dashboard" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Dashboard</Link>
        <div className="segmented" role="radiogroup" aria-label="Period">
          {[30, 60, 90].map(d => (
            <button key={d} type="button" role="radio" aria-checked={days === d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{d} days</button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}><Printer size={14} /> Print or save as PDF</button>
      </div>

      <article className="card-sheet print-sheet" style={{ maxWidth: '820px' }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>Aaptha check-in summary · {fmt(new Date(new Date(data.generatedAt).getTime() - data.days * 86400000).toISOString())} to {fmt(data.generatedAt)}</p>
        <h1>{p.name}</h1>
        <p style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
          {[p.relationship, p.conditions && `Conditions (from family): ${p.conditions}`, p.allergies && `Allergies: ${p.allergies}`].filter(Boolean).join(' · ')}
        </p>
        <div className="notice amber" style={{ marginTop: '14px' }}>
          <span>Collected by an automated reminder service from what {p.name} said on short phone calls. Self-reported; not a clinical record.</span>
        </div>

        <h2 style={{ fontSize: '1.1rem', marginTop: '22px' }}>Calls</h2>
        <p>{view.answered.length} of {view.done.length} calls answered ({view.done.length ? Math.round((view.answered.length / view.done.length) * 100) : 0}%).</p>

        <h2 style={{ fontSize: '1.1rem', marginTop: '22px' }}>Medicines</h2>
        <div className="table-wrap" style={{ marginTop: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>Medicine</th>
                <th style={{ padding: '8px' }}>Said taken</th>
                <th style={{ padding: '8px' }}>Not taken on</th>
              </tr>
            </thead>
            <tbody>
              {view.perMed.map(r => (
                <tr key={r.med.id} style={{ borderTop: '1px solid var(--line-subtle)' }}>
                  <td style={{ padding: '8px' }}><b>{r.med.name}</b> {r.med.dosage}{r.stopped ? ' · said they stopped it' : ''}</td>
                  <td style={{ padding: '8px' }}>{r.asked ? `${r.taken} of ${r.asked} (${Math.round((r.taken / r.asked) * 100)}%)` : 'not asked yet'}</td>
                  <td style={{ padding: '8px' }}>{r.missedDates.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(view.bp.length > 0 || view.sugarRows.length > 0) && (
          <>
            <h2 style={{ fontSize: '1.1rem', marginTop: '22px' }}>Home readings</h2>
            <p style={{ fontSize: '0.86rem', color: 'var(--ink-muted)' }}>Read out by {p.name} on calls or typed in by the family from a home machine. Not checked by a clinician.</p>
            <div className="table-wrap" style={{ marginTop: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: '8px' }}>Reading</th>
                    <th style={{ padding: '8px' }}>Count</th>
                    <th style={{ padding: '8px' }}>Average</th>
                    <th style={{ padding: '8px' }}>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {view.bp.length > 0 && (
                    <tr style={{ borderTop: '1px solid var(--line-subtle)' }}>
                      <td style={{ padding: '8px' }}><b>Blood pressure</b> (mmHg)</td>
                      <td style={{ padding: '8px' }}>{view.bp.length}</td>
                      <td style={{ padding: '8px' }}>{avg(view.bp.map(r => r.systolic!))}/{avg(view.bp.map(r => r.diastolic!))}</td>
                      <td style={{ padding: '8px' }}>
                        {Math.min(...view.bp.map(r => r.systolic!))}–{Math.max(...view.bp.map(r => r.systolic!))} / {Math.min(...view.bp.map(r => r.diastolic!))}–{Math.max(...view.bp.map(r => r.diastolic!))}
                      </td>
                    </tr>
                  )}
                  {view.sugarRows.map(g => (
                    <tr key={g.label} style={{ borderTop: '1px solid var(--line-subtle)' }}>
                      <td style={{ padding: '8px' }}><b>Sugar, {g.label.toLowerCase()}</b> (mg/dL)</td>
                      <td style={{ padding: '8px' }}>{g.rows.length}</td>
                      <td style={{ padding: '8px' }}>{avg(g.rows.map(r => r.value!))}</td>
                      <td style={{ padding: '8px' }}>{Math.round(Math.min(...g.rows.map(r => r.value!)))}–{Math.round(Math.max(...g.rows.map(r => r.value!)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {view.bp.length > 0 && (
              <p style={{ fontSize: '0.86rem', marginTop: '8px' }}>
                Latest BP: {view.bp.slice(-6).reverse().map(r => `${r.systolic}/${r.diastolic} (${short(r.takenAt)})`).join(', ')}
              </p>
            )}
          </>
        )}

        <h2 style={{ fontSize: '1.1rem', marginTop: '22px' }}>What {p.name} mentioned</h2>
        {view.concerns.length === 0 ? <p>No health worries mentioned on the calls.</p> : (
          <ul style={{ paddingLeft: '20px', display: 'grid', gap: '4px' }}>
            {view.concerns.map((c, i) => <li key={i}><b>{c.date}</b>: {c.text}</li>)}
          </ul>
        )}

        <h2 style={{ fontSize: '1.1rem', marginTop: '22px' }}>Mood, sleep and appetite</h2>
        <p>
          Mood on answered calls: {Object.entries(view.moods).map(([m, n]) => `${m} ${n}`).join(', ') || '—'}.
          {view.sleepAsked > 0 && ` Slept badly on ${view.sleepPoor} of ${view.sleepAsked} days asked.`}
          {view.appetiteAsked > 0 && ` Not eating well on ${view.appetitePoor} of ${view.appetiteAsked} days asked.`}
        </p>

        {data.insights.filter(i => i.kind !== 'combined').length > 0 && (
          <>
            <h2 style={{ fontSize: '1.1rem', marginTop: '22px' }}>Patterns noticed</h2>
            <ul style={{ paddingLeft: '20px', display: 'grid', gap: '4px' }}>
              {data.insights.filter(i => i.kind !== 'combined').map(i => <li key={i.id}><b>{short(i.createdAt)}</b>: {i.message}</li>)}
            </ul>
          </>
        )}

        {data.alerts.length > 0 && (
          <>
            <h2 style={{ fontSize: '1.1rem', marginTop: '22px' }}>Alerts</h2>
            <ul style={{ paddingLeft: '20px', display: 'grid', gap: '4px' }}>
              {data.alerts.map(a => <li key={a.id}><b>{short(a.createdAt || a.timestamp)}</b>: {a.title}{a.outcome ? ` (afterwards: ${a.outcome.replace('_', ' ')}${a.outcomeNote ? `, ${a.outcomeNote}` : ''})` : ''}</li>)}
            </ul>
          </>
        )}

        {data.doctor.name && <p style={{ marginTop: '22px', fontSize: '0.86rem', color: 'var(--ink-muted)' }}>Prepared for {data.doctor.name}.</p>}
      </article>
    </main>
  );
}
