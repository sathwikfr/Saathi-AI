'use client';

import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import { ParentProfile } from '@/lib/types';
import { checkBp, checkSugar, ReadingRanges } from '@/lib/readings';
import { LineChart, ChartLegend, ChartSeries, ChartRefLine } from './LineChart';

type Reading = {
  id: string;
  kind: 'bp' | 'sugar';
  systolic: number | null;
  diastolic: number | null;
  value: number | null;
  context: 'fasting' | 'after_food' | 'random' | null;
  takenAt: string;
  source: 'call' | 'family';
};

type Props = {
  parent: ParentProfile;
  manage: boolean;
  onToast: (text: string, type?: 'success' | 'info' | 'error') => void;
  onOpenSettings?: () => void;
};

const CONTEXT: Record<string, string> = { fasting: 'fasting', after_food: 'after food', random: 'random' };
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function AddReadingForm({ parentId, onDone, onCancel, onToast }: { parentId: string; onDone: () => void; onCancel: () => void; onToast: Props['onToast'] }) {
  const [kind, setKind] = useState<'bp' | 'sugar'>('bp');
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [value, setValue] = useState('');
  const [context, setContext] = useState('fasting');
  const [takenAt, setTakenAt] = useState(nowLocalInput);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/parents/${parentId}/readings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        kind === 'bp'
          ? { kind, systolic: Number(sys), diastolic: Number(dia), takenAt: new Date(takenAt).toISOString() }
          : { kind, value: Number(value), context, takenAt: new Date(takenAt).toISOString() }
      )
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return onToast(data.error || 'Could not save the reading.', 'error');
    onToast('Reading saved.', 'success');
    onDone();
  };

  return (
    <form onSubmit={submit} className="inline-form">
      <div className="segmented" role="radiogroup" aria-label="Reading">
        <button type="button" role="radio" aria-checked={kind === 'bp'} className={kind === 'bp' ? 'active' : ''} onClick={() => setKind('bp')}>Blood pressure</button>
        <button type="button" role="radio" aria-checked={kind === 'sugar'} className={kind === 'sugar' ? 'active' : ''} onClick={() => setKind('sugar')}>Sugar</button>
      </div>
      <div className="row-grid" style={{ marginTop: '12px' }}>
        {kind === 'bp' ? (
          <>
            <div className="form-group">
              <label className="form-label" htmlFor="rd-sys">Top number</label>
              <input id="rd-sys" className="form-input" inputMode="numeric" value={sys} onChange={e => setSys(e.target.value)} placeholder="e.g. 130" required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="rd-dia">Bottom number</label>
              <input id="rd-dia" className="form-input" inputMode="numeric" value={dia} onChange={e => setDia(e.target.value)} placeholder="e.g. 85" required />
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label" htmlFor="rd-sugar">Sugar (mg/dL)</label>
              <input id="rd-sugar" className="form-input" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 120" required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="rd-ctx">When</label>
              <select id="rd-ctx" className="form-input" value={context} onChange={e => setContext(e.target.value)}>
                <option value="fasting">Fasting (before food)</option>
                <option value="after_food">After food</option>
                <option value="random">Any other time</option>
              </select>
            </div>
          </>
        )}
        <div className="form-group">
          <label className="form-label" htmlFor="rd-at">Taken at</label>
          <input id="rd-at" type="datetime-local" className="form-input" value={takenAt} onChange={e => setTakenAt(e.target.value)} required />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? <><span className="spinner" /> Saving…</> : 'Save reading'}</button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** BP and sugar: what the parent read out on calls, plus readings the family typed in. Not checked by a doctor. */
export function ReadingsPanel({ parent, manage, onToast, onOpenSettings }: Props) {
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState<Reading[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [version, setVersion] = useState(0);
  const ranges: ReadingRanges = parent.readingRanges || {};
  const name = parent.name.split(' ')[0];

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/parents/${parent.id}/readings?days=${days}`)
      .then(r => (r.ok ? r.json() : { readings: [] }))
      .then(d => !cancelled && setRows(d.readings || []))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [parent.id, days, version]);

  const remove = async (id: string) => {
    const res = await fetch(`/api/parents/${parent.id}/readings?readingId=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) setVersion(v => v + 1);
  };

  const bp = (rows || []).filter(r => r.kind === 'bp' && r.systolic && r.diastolic);
  const sugar = (rows || []).filter(r => r.kind === 'sugar' && r.value);
  const check = (r: Reading) => (r.kind === 'bp'
    ? checkBp({ systolic: r.systolic!, diastolic: r.diastolic! }, ranges)
    : checkSugar({ value: r.value!, context: r.context }, ranges));
  const note = (r: Reading) => [r.context ? CONTEXT[r.context] : null, r.source === 'family' ? 'typed in by family' : 'said on a call'].filter(Boolean).join(' · ');
  // The chart tooltip also says when a reading is outside the limits (the list below says it too).
  const tipNote = (r: Reading) => {
    const c = check(r);
    return c.outside ? `${note(r)} · ${c.why}` : note(r);
  };
  const bpSeries: ChartSeries[] = [
    { key: 'sys', label: 'Top number (systolic)', color: 'var(--chart-1)', points: bp.map(r => ({ t: Date.parse(r.takenAt), v: r.systolic!, note: tipNote(r) })) },
    { key: 'dia', label: 'Bottom number (diastolic)', color: 'var(--chart-2)', points: bp.map(r => ({ t: Date.parse(r.takenAt), v: r.diastolic!, note: tipNote(r) })) }
  ];
  const bpRefs: ChartRefLine[] = [
    ranges.bpSysMax ? { v: ranges.bpSysMax, label: `Your top limit ${ranges.bpSysMax}` } : null,
    ranges.bpDiaMax ? { v: ranges.bpDiaMax, label: `Your bottom limit ${ranges.bpDiaMax}` } : null
  ].filter((r): r is ChartRefLine => !!r);
  const sugarSeries: ChartSeries[] = [
    { key: 'sugar', label: 'Sugar', color: 'var(--chart-1)', points: sugar.map(r => ({ t: Date.parse(r.takenAt), v: r.value!, note: tipNote(r) })) }
  ];
  const sugarRefs: ChartRefLine[] = [
    ranges.sugarMax ? { v: ranges.sugarMax, label: `Your limit ${ranges.sugarMax}` } : null,
    ranges.sugarMin ? { v: ranges.sugarMin, label: `Your lower limit ${ranges.sugarMin}` } : null
  ].filter((r): r is ChartRefLine => !!r);

  const list = [...(rows || [])].reverse();
  const shown = showAll ? list : list.slice(0, 8);
  const lastBp = bp[bp.length - 1];
  const lastSugar = sugar[sugar.length - 1];
  const asking = parent.readingsToAsk.length > 0;

  return (
    <section className="panel" aria-labelledby="readings-title">
      <div className="panel-head">
        <div>
          <h3 id="readings-title"><Activity size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />BP and sugar</h3>
          <p>
            {asking
              ? `Saathi asks ${name} for ${parent.readingsToAsk.map(k => (k === 'bp' ? 'BP' : 'sugar')).join(' and ')} once a day. Saathi never comments on the numbers.`
              : `Readings you type in from a home machine.`}
            {' '}Self-reported, not checked by a doctor.
          </p>
        </div>
        {manage && !adding && (
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> Add a reading</button>
        )}
      </div>

      {adding && (
        <AddReadingForm parentId={parent.id} onToast={onToast} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); setVersion(v => v + 1); }} />
      )}

      {rows === null ? (
        <div className="skeleton" style={{ height: '200px' }} />
      ) : rows.length === 0 ? (
        <div className="notice">
          <span>
            No readings in the last {days} days.
            {!asking && manage && onOpenSettings && (
              <> Saathi can ask {name} on calls: <button type="button" className="link-btn" onClick={onOpenSettings}>turn it on in Settings</button>.</>
            )}
          </span>
        </div>
      ) : (
        <>
          <div className="segmented" role="radiogroup" aria-label="Period" style={{ marginBottom: '14px', width: 'fit-content', maxWidth: '100%' }}>
            {[30, 90, 365].map(d => (
              <button key={d} type="button" role="radio" aria-checked={days === d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>
                {d === 365 ? '1 year' : `${d} days`}
              </button>
            ))}
          </div>

          {bp.length > 0 && (
            <figure className="chart-block">
              <figcaption>
                <strong>Blood pressure</strong> <span>mmHg</span>
              </figcaption>
              <ChartLegend series={bpSeries} />
              <LineChart
                series={bpSeries}
                refLines={bpRefs}
                unit="mmHg"
                ariaLabel={`Blood pressure, ${bp.length} reading${bp.length === 1 ? '' : 's'}; latest ${lastBp.systolic}/${lastBp.diastolic} on ${when(lastBp.takenAt)}. The list below has every reading.`}
              />
            </figure>
          )}

          {sugar.length > 0 && (
            <figure className="chart-block">
              <figcaption>
                <strong>Blood sugar</strong> <span>mg/dL</span>
              </figcaption>
              <LineChart
                series={sugarSeries}
                refLines={sugarRefs}
                unit="mg/dL"
                ariaLabel={`Blood sugar, ${sugar.length} reading${sugar.length === 1 ? '' : 's'}; latest ${Math.round(lastSugar.value!)} on ${when(lastSugar.takenAt)}. The list below has every reading.`}
              />
            </figure>
          )}

          <div className="list" style={{ marginTop: '6px' }}>
            {shown.map(r => {
              const c = check(r);
              return (
                <div key={r.id} className="list-row compact">
                  <div className="row-main">
                    <div className="row-title">
                      {r.kind === 'bp' ? `BP ${r.systolic}/${r.diastolic}` : `Sugar ${Math.round(r.value!)}`}
                      {c.outside && <span className="badge badge-amber"><AlertTriangle size={12} /> {c.why.charAt(0).toUpperCase() + c.why.slice(1)}</span>}
                    </div>
                    <div className="row-sub">{when(r.takenAt)} · {note(r)}</div>
                  </div>
                  {manage && r.source === 'family' && (
                    <button className="icon-btn" aria-label="Remove this reading" title="Remove" onClick={() => remove(r.id)}><Trash2 size={15} /></button>
                  )}
                </div>
              );
            })}
          </div>
          {list.length > 8 && (
            <button type="button" className="btn btn-quiet btn-sm" style={{ marginTop: '8px' }} onClick={() => setShowAll(v => !v)}>
              {showAll ? <><X size={14} /> Show fewer</> : `Show all ${list.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
