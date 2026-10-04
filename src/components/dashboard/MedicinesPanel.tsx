'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Camera, Plus, Pill, Pencil, FileText } from 'lucide-react';
import { Medicine, CallLog, MedicineStatus } from '@/lib/types';
import { medicineKey } from '@/lib/callInterpretation';
import { foodRelationLabel } from './helpers';

const FREQUENCY: Record<Medicine['frequency'], string> = {
  daily: 'Daily',
  twice_daily: 'Twice a day',
  as_needed: 'As needed'
};

const STATUS_WORD: Record<MedicineStatus | 'none', string> = {
  taken: 'taken', missed: 'missed', later: 'said later', stopped: 'stopped', unknown: 'not sure', none: 'no answer'
};

type Props = {
  parentId: string;
  parentName: string;
  medicines: Medicine[];
  callLogs: CallLog[];
  manage: boolean;
  onUpload: () => void;
  onAdd: () => void;
  onToggle: (id: string) => void;
  onChanged: () => void;
  onToast: (text: string, type?: 'success' | 'info' | 'error') => void;
};

/** Last 7 days for one medicine: the worst answer of each day (missed beats taken). */
function weekFor(name: string, calls: CallLog[]): { day: string; status: MedicineStatus | 'none' }[] {
  const key = medicineKey(name);
  const rank: Record<MedicineStatus, number> = { stopped: 4, missed: 3, later: 2, unknown: 1, taken: 0 };
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dayStr = d.toDateString();
    let status: MedicineStatus | 'none' = 'none';
    for (const c of calls) {
      if (c.status !== 'answered' || new Date(c.createdAt || c.scheduledTime).toDateString() !== dayStr) continue;
      for (const r of c.details?.medicineResults || []) {
        if (medicineKey(r.name) !== key) continue;
        if (status === 'none' || rank[r.status] > rank[status]) status = r.status;
      }
    }
    return { day: d.toLocaleDateString('en-IN', { weekday: 'short' }), status };
  });
}

function PurposeEditor({ parentId, med, onDone, onToast }: { parentId: string; med: Medicine; onDone: () => void; onToast: Props['onToast'] }) {
  const [value, setValue] = useState(med.purpose || '');
  const [saving, setSaving] = useState(false);
  return (
    <form
      style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}
      onSubmit={async e => {
        e.preventDefault();
        setSaving(true);
        const res = await fetch(`/api/parents/${parentId}/medicines`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ medicineId: med.id, action: 'purpose', purpose: value || null })
        });
        setSaving(false);
        if (res.ok) onDone();
        else onToast('Could not save.', 'error');
      }}
    >
      <label htmlFor={`purpose-${med.id}`} className="sr-only">Why it matters</label>
      <input
        id={`purpose-${med.id}`}
        className="form-input"
        style={{ flex: 1, minWidth: '200px', padding: '8px 12px', fontSize: '0.88rem' }}
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="In your words, e.g. keeps your BP steady"
        maxLength={160}
        autoFocus
      />
      <button className="btn btn-primary btn-sm" disabled={saving}>Save</button>
    </form>
  );
}

export function MedicinesPanel({ parentId, parentName, medicines, callLogs, manage, onUpload, onAdd, onToggle, onChanged, onToast }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const actions = (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <Link href={`/dashboard/report/${parentId}`} className="btn btn-ghost btn-sm">
        <FileText size={15} /> Summary for the doctor
      </Link>
      {manage && (
        <>
          <button onClick={onUpload} className="btn btn-ghost btn-sm">
            <Camera size={15} /> Scan prescription
          </button>
          <button onClick={onAdd} className="btn btn-primary btn-sm">
            <Plus size={15} /> Add medicine
          </button>
        </>
      )}
    </div>
  );

  return (
    <section className="panel" aria-labelledby="medicines-title">
      <div className="panel-head">
        <div>
          <h3 id="medicines-title">{parentName}&apos;s medicines</h3>
          <p>Saathi asks about each active medicine on the matching call, and repeats your reason for it. It never gives medical advice.</p>
        </div>
        {actions}
      </div>

      {medicines.length === 0 ? (
        <div className="empty" style={{ padding: '32px 16px' }}>
          <span className="icon-tile"><Pill size={24} /></span>
          <h3>No medicines yet</h3>
          <p>Add them by hand or scan a prescription, and Saathi will start asking about them.</p>
        </div>
      ) : (
        <div className="list">
          {medicines.map((m) => {
            const food = foodRelationLabel(m.foodRelation);
            const week = weekFor(m.name, callLogs);
            return (
              <div key={m.id} className={`list-row${m.isActive ? '' : ' dim'}`} style={{ flexWrap: 'wrap' }}>
                <div className="row-main" style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flex: 1, minWidth: '240px' }}>
                  <span className="icon-tile" style={{ width: '40px', height: '40px' }}><Pill size={18} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row-title">
                      {m.name}
                      {!m.isActive && <span className="badge badge-neutral">Paused</span>}
                    </div>
                    <div className="row-sub" style={{ textTransform: 'none' }}>
                      {[m.dosage, m.timeOfDay.charAt(0).toUpperCase() + m.timeOfDay.slice(1), food, FREQUENCY[m.frequency]].filter(Boolean).join(' · ')}
                    </div>
                    {editing === m.id ? (
                      <PurposeEditor parentId={parentId} med={m} onToast={onToast} onDone={() => { setEditing(null); onChanged(); }} />
                    ) : (
                      <div style={{ fontSize: '0.86rem', marginTop: '4px', color: m.purpose ? 'var(--ink)' : 'var(--ink-subtle)' }}>
                        {m.purpose ? <>Why: {m.purpose}</> : 'No reason added yet. Saathi says it when one is there.'}
                        {manage && (
                          <button type="button" className="link-btn" style={{ marginLeft: '8px' }} onClick={() => setEditing(m.id)}>
                            <Pencil size={12} /> {m.purpose ? 'Edit' : 'Add'}
                          </button>
                        )}
                      </div>
                    )}
                    {m.isActive && (
                      <div className="med-week" style={{ marginTop: '8px' }} aria-label={`Last 7 days: ${week.map(w => `${w.day} ${STATUS_WORD[w.status]}`).join(', ')}`}>
                        {week.map((w, i) => <i key={i} className={w.status} title={`${w.day}: ${STATUS_WORD[w.status]}`} />)}
                        <span style={{ fontSize: '0.75rem', color: 'var(--ink-subtle)', marginLeft: '6px' }}>last 7 days</span>
                      </div>
                    )}
                  </div>
                </div>
                {manage && (
                  <button onClick={() => onToggle(m.id)} className={`btn btn-sm ${m.isActive ? 'btn-ghost' : 'btn-primary'}`}>
                    {m.isActive ? 'Pause' : 'Resume'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
