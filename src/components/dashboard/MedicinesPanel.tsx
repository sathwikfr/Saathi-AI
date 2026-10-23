'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Camera, Plus, Pill, Pencil, FileText, ClipboardList, CalendarClock } from 'lucide-react';
import { Medicine, CallLog, MedicineStatus, ParentProfile, ReminderView } from '@/lib/types';
import { RefillListModal } from './RefillListModal';
import { medicineKey, freeNickname } from '@/lib/callInterpretation';
import { nicknameFromName } from '@/lib/prescriptionHints';
import { foodRelationLabel } from './helpers';
import { MedicineNameChips, NAME_HINT } from '@/components/onboarding/WizardUI';

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
  /** For the chemist refill list (chemist, address, phone). */
  parent: ParentProfile;
  familyName: string;
  medicines: Medicine[];
  callLogs: CallLog[];
  /** WhatsApp reminders instead of calls (Remind): the 7-day dots come from the reminders. */
  whatsapp?: boolean;
  reminders?: ReminderView[];
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

/** Last 7 days for one medicine from WhatsApp reminders: missed beats skipped beats taken. */
function weekFromReminders(name: string, reminders: ReminderView[]): { day: string; status: MedicineStatus | 'none' }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + 330 * 60000 - (6 - i) * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const answers = reminders.filter(r => r.date === iso && r.medicines.includes(name)).map(r => r.answer);
    const status: MedicineStatus | 'none' = answers.includes('missed') ? 'missed' : answers.includes('skipped') ? 'later' : answers.includes('taken') ? 'taken' : 'none';
    return { day: new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }), status };
  });
}

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Last day of a course: reminders and calls leave the medicine out after it. */
function EndsOnEditor({ parentId, med, onDone, onToast }: { parentId: string; med: Medicine; onDone: () => void; onToast: Props['onToast'] }) {
  const [value, setValue] = useState(med.endsOn || '');
  const [saving, setSaving] = useState(false);
  const save = async (endsOn: string | null) => {
    setSaving(true);
    const res = await fetch(`/api/parents/${parentId}/medicines`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medicineId: med.id, action: 'ends_on', endsOn })
    });
    setSaving(false);
    if (res.ok) onDone();
    else onToast((await res.json().catch(() => ({}))).error || 'Could not save.', 'error');
  };
  return (
    <form style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }} onSubmit={e => { e.preventDefault(); save(value || null); }}>
      <label htmlFor={`ends-${med.id}`} className="sr-only">Last day of the course</label>
      <input id={`ends-${med.id}`} type="date" className="form-input" style={{ maxWidth: '190px', padding: '8px 12px', fontSize: '0.88rem' }} value={value} onChange={e => setValue(e.target.value)} />
      <button className="btn btn-primary btn-sm" disabled={saving}>Save</button>
      {med.endsOn && <button type="button" className="btn btn-quiet btn-sm" disabled={saving} onClick={() => save(null)}>No end date</button>}
    </form>
  );
}

/** Remind plan: how many tablets are left. Counted down on each "Yes"; a "running low" note comes ~3 days before. */
function TabletsEditor({ parentId, med, onDone, onToast }: { parentId: string; med: Medicine; onDone: () => void; onToast: Props['onToast'] }) {
  const [value, setValue] = useState(med.tabletsLeft == null ? '' : String(med.tabletsLeft));
  const [saving, setSaving] = useState(false);
  const save = async (tabletsLeft: string | null) => {
    setSaving(true);
    const res = await fetch(`/api/parents/${parentId}/medicines`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medicineId: med.id, action: 'tablets_left', tabletsLeft: tabletsLeft === null ? null : Number(tabletsLeft) })
    });
    setSaving(false);
    if (res.ok) onDone();
    else onToast((await res.json().catch(() => ({}))).error || 'Could not save.', 'error');
  };
  return (
    <form style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }} onSubmit={e => { e.preventDefault(); save(value.trim() === '' ? null : value.trim()); }}>
      <label htmlFor={`tabs-${med.id}`} className="sr-only">Tablets left</label>
      <input id={`tabs-${med.id}`} type="number" inputMode="numeric" min={0} max={999} className="form-input" style={{ maxWidth: '110px', padding: '8px 12px', fontSize: '0.88rem' }} value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 30" />
      <button className="btn btn-primary btn-sm" disabled={saving}>Save</button>
      {med.tabletsLeft != null && <button type="button" className="btn btn-quiet btn-sm" disabled={saving} onClick={() => save(null)}>Stop counting</button>}
    </form>
  );
}

const TIME_LABEL: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', bedtime: 'Bedtime', as_needed: 'As needed' };
/** "Morning, Bedtime" (every time it is taken, not just the first). */
const timesText = (m: Medicine) => (m.timingSlots?.length ? m.timingSlots : [m.timeOfDay]).map(t => TIME_LABEL[t] || t).join(', ');

/** The family's own name for a medicine ("BP tablet"); Saathi asks with exactly this name from the next call. */
function NameEditor({ parentId, med, onDone, onCancel, onToast }: { parentId: string; med: Medicine; onDone: () => void; onCancel: () => void; onToast: Props['onToast'] }) {
  const [value, setValue] = useState(med.name);
  // A tablet still called by its prescription name keeps that as the real name when it is renamed.
  const [official, setOfficial] = useState(med.officialName || (nicknameFromName(med.name) ? med.name : ''));
  const [saving, setSaving] = useState(false);
  return (
    <form
      style={{ marginTop: '8px' }}
      onSubmit={async e => {
        e.preventDefault();
        setSaving(true);
        const res = await fetch(`/api/parents/${parentId}/medicines`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ medicineId: med.id, action: 'rename', name: value, officialName: official.trim() || null })
        });
        setSaving(false);
        if (res.ok) onDone();
        else onToast((await res.json().catch(() => ({}))).error || 'Could not save.', 'error');
      }}
    >
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <label htmlFor={`name-${med.id}`} className="sr-only">Medicine name</label>
        <input
          id={`name-${med.id}`}
          className="form-input"
          style={{ flex: 1, minWidth: '200px', padding: '8px 12px', fontSize: '0.88rem' }}
          value={value}
          onChange={e => setValue(e.target.value)}
          maxLength={120}
          required
          autoFocus
        />
        <button className="btn btn-primary btn-sm" disabled={saving || !value.trim()}>Save</button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
      <MedicineNameChips value={value} onPick={setValue} realName={official} />
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-subtle)', margin: '6px 0 0' }}>{NAME_HINT} Past calls keep the old name.</p>
      <label htmlFor={`official-${med.id}`} className="mini-label" style={{ marginTop: '10px', display: 'block' }}>Real medicine name (optional)</label>
      <input
        id={`official-${med.id}`}
        className="form-input"
        style={{ padding: '8px 12px', fontSize: '0.88rem' }}
        value={official}
        onChange={e => setOfficial(e.target.value)}
        placeholder="e.g. Amlodipine 5 mg"
        maxLength={120}
      />
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-subtle)', margin: '6px 0 0' }}>For the doctor summary, chemist list and emergency card. Saathi doesn&apos;t say it.</p>
    </form>
  );
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

export function MedicinesPanel({ parentId, parentName, parent, familyName, medicines, callLogs, whatsapp = false, reminders = [], manage, onUpload, onAdd, onToggle, onChanged, onToast }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editingEnd, setEditingEnd] = useState<string | null>(null);
  const [editingTabs, setEditingTabs] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  /**
   * "TAB. ATARAX 25MG" -> "Allergy tablet" for every tablet still called by its prescription name.
   * Worked out together, so two of them never get the same name ("Allergy tablet", "Night allergy tablet").
   */
  const suggestions = new Map<string, string>();
  const names = new Map(medicines.filter(o => o.isActive).map(o => [o.id, o.name]));
  for (const m of medicines) {
    if (!nicknameFromName(m.name)) continue;
    const wanted = nicknameFromName(m.officialName || m.name);
    if (!wanted || medicineKey(wanted) === medicineKey(m.name)) continue;
    const others = [...names].filter(([id]) => id !== m.id).map(([, n]) => n);
    const nick = freeNickname(wanted, m.timingSlots?.length ? m.timingSlots : [m.timeOfDay], others);
    suggestions.set(m.id, nick);
    if (m.isActive) names.set(m.id, nick);
  }
  const rename = (m: Medicine, name: string) => fetch(`/api/parents/${parentId}/medicines`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ medicineId: m.id, action: 'rename', name, officialName: m.officialName || m.name })
  });
  const applyNickname = async (m: Medicine, name: string) => {
    const res = await rename(m, name);
    if (res.ok) { onToast(`Saathi will call it "${name}" from the next call.`, 'success'); onChanged(); }
    else onToast((await res.json().catch(() => ({}))).error || 'Could not save.', 'error');
  };
  // One after another: the server checks each new name against the ones already saved.
  const applyAll = async () => {
    setApplyingAll(true);
    let done = 0;
    let error = '';
    for (const m of medicines) {
      const name = suggestions.get(m.id);
      if (!name) continue;
      const res = await rename(m, name);
      if (res.ok) done++;
      else error ||= (await res.json().catch(() => ({}))).error || 'Could not save.';
    }
    setApplyingAll(false);
    if (error) onToast(`${done} renamed. ${error}`, 'error');
    else onToast(`${done} medicines renamed. Saathi uses the new names from the next call.`, 'success');
    onChanged();
  };
  // IST date once per mount (course end dates are IST).
  const [today] = useState(() => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10));
  const [refill, setRefill] = useState(false);
  const [sayingReal, setSayingReal] = useState(false);
  const setSayReal = async (on: boolean) => {
    setSayingReal(true);
    const res = await fetch(`/api/parents/${parentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'official_names', on }) });
    const data = await res.json().catch(() => ({}));
    setSayingReal(false);
    onToast(data.message || data.error || (res.ok ? 'Saved.' : 'Could not save.'), res.ok ? 'success' : 'error');
    if (res.ok) onChanged();
  };
  const actions = (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <Link href={`/dashboard/report/${parentId}`} className="btn btn-ghost btn-sm">
        <FileText size={15} /> Summary for the doctor
      </Link>
      {medicines.some(m => m.isActive) && (
        <button onClick={() => setRefill(true)} className="btn btn-ghost btn-sm">
          <ClipboardList size={15} /> Refill list
        </button>
      )}
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
          <p>
            {whatsapp
              ? 'Each active medicine is in the WhatsApp reminder at its time. After its last day (if set) it is left out.'
              : 'Saathi asks about each active medicine on the matching call, and repeats your reason for it. It never gives medical advice.'}
          </p>
        </div>
        {actions}
      </div>

      {manage && medicines.some(m => m.officialName) && (
        <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '0.88rem', margin: '0 0 14px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!parent.useOfficialNames}
            disabled={sayingReal}
            onChange={e => setSayReal(e.target.checked)}
            style={{ width: '17px', height: '17px', accentColor: 'var(--teal)', marginTop: '2px' }}
          />
          <span>
            Say the real medicine names too
            <span className="form-hint" style={{ display: 'block' }}>
              Off: Saathi and WhatsApp use only the names {parentName} knows, like &ldquo;BP tablet&rdquo;. The real names stay in Aaptha for the doctor, chemist and emergency card.
            </span>
          </span>
        </label>
      )}

      {manage && suggestions.size > 1 && (
        <div className="notice" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 14px' }}>
          <span style={{ flex: 1, minWidth: '200px', fontSize: '0.88rem' }}>
            {suggestions.size} medicines still use their prescription names. Everyday names are easier for {parentName} to recognise on calls; the prescription names stay saved.
          </span>
          <button type="button" className="btn btn-primary btn-sm" disabled={applyingAll} onClick={applyAll}>
            {applyingAll ? 'Renaming…' : 'Use all suggested names'}
          </button>
        </div>
      )}

      {medicines.length === 0 ? (
        <div className="empty" style={{ padding: '32px 16px' }}>
          <span className="icon-tile"><Pill size={24} /></span>
          <h3>No medicines yet</h3>
          <p>{whatsapp ? 'Add them by hand or scan a prescription, and they go into the WhatsApp reminders.' : 'Add them by hand or scan a prescription, and Saathi will start asking about them.'}</p>
        </div>
      ) : (
        <div className="list">
          {medicines.map((m) => {
            const food = foodRelationLabel(m.foodRelation);
            const week = whatsapp ? weekFromReminders(m.name, reminders) : weekFor(m.name, callLogs);
            const ended = !!m.endsOn && m.endsOn < today;
            const suggestion = manage && renaming !== m.id ? suggestions.get(m.id) : undefined;
            return (
              <div key={m.id} className={`list-row${m.isActive ? '' : ' dim'}`} style={{ flexWrap: 'wrap' }}>
                <div className="row-main" style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flex: 1, minWidth: '240px' }}>
                  <span className="icon-tile" style={{ width: '40px', height: '40px' }}><Pill size={18} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row-title">
                      {m.name}
                      {!m.isActive && <span className="badge badge-neutral">Paused</span>}
                      {m.isActive && ended && <span className="badge badge-neutral">Course finished</span>}
                      {manage && renaming !== m.id && (
                        <button type="button" className="link-btn" style={{ marginLeft: '8px', fontSize: '0.84rem', fontWeight: 400 }} aria-label={`Rename ${m.name}`} onClick={() => setRenaming(m.id)}>
                          <Pencil size={12} /> Rename
                        </button>
                      )}
                    </div>
                    {suggestion && (
                      <div style={{ fontSize: '0.84rem', marginTop: '4px', color: 'var(--ink-muted)' }}>
                        Easier for {parentName} to recognise:
                        <button type="button" className="pill-toggle" style={{ marginLeft: '8px' }} onClick={() => applyNickname(m, suggestion)}>
                          Call it &ldquo;{suggestion}&rdquo;
                        </button>
                      </div>
                    )}
                    {renaming === m.id && (
                      <NameEditor parentId={parentId} med={m} onToast={onToast} onCancel={() => setRenaming(null)} onDone={() => { setRenaming(null); onChanged(); }} />
                    )}
                    <div className="row-sub" style={{ textTransform: 'none' }}>
                      {[m.officialName, m.dosage, timesText(m), food, FREQUENCY[m.frequency]].filter(Boolean).join(' · ')}
                    </div>
                    {editingEnd === m.id ? (
                      <EndsOnEditor parentId={parentId} med={m} onToast={onToast} onDone={() => { setEditingEnd(null); onChanged(); }} />
                    ) : (m.endsOn || manage) && (
                      <div style={{ fontSize: '0.84rem', marginTop: '4px', color: 'var(--ink-muted)' }}>
                        <CalendarClock size={12} style={{ verticalAlign: '-1px', marginRight: '4px' }} />
                        {m.endsOn ? `${ended ? 'Course ended' : 'Last day'} ${shortDate(m.endsOn)}` : 'No end date'}
                        {manage && (
                          <button type="button" className="link-btn" style={{ marginLeft: '8px' }} onClick={() => setEditingEnd(m.id)}>
                            <Pencil size={12} /> {m.endsOn ? 'Change' : 'Set a last day'}
                          </button>
                        )}
                      </div>
                    )}
                    {whatsapp ? (
                      editingTabs === m.id ? (
                        <TabletsEditor parentId={parentId} med={m} onToast={onToast} onDone={() => { setEditingTabs(null); onChanged(); }} />
                      ) : (m.tabletsLeft != null || manage) && m.isActive && (
                        <div style={{ fontSize: '0.84rem', marginTop: '4px', color: 'var(--ink-muted)' }}>
                          <Pill size={12} style={{ verticalAlign: '-1px', marginRight: '4px' }} />
                          {m.tabletsLeft == null
                            ? 'Tablets left: not counted'
                            : `${m.tabletsLeft} tablet${m.tabletsLeft === 1 ? '' : 's'} left`}
                          {manage && (
                            <button type="button" className="link-btn" style={{ marginLeft: '8px' }} onClick={() => setEditingTabs(m.id)}>
                              <Pencil size={12} /> {m.tabletsLeft == null ? 'Count them' : 'Change'}
                            </button>
                          )}
                          {m.tabletsLeft == null && (
                            <span style={{ display: 'block', color: 'var(--ink-subtle)', marginTop: '2px' }}>
                              We count down on each Yes and say when about 3 days are left. They can also reply &quot;{m.name} 30&quot; on WhatsApp.
                            </span>
                          )}
                        </div>
                      )
                    ) : editing === m.id ? (
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
                      <div className="med-week" style={{ marginTop: '8px' }} role="img" aria-label={`Last 7 days: ${week.map(w => `${w.day} ${STATUS_WORD[w.status]}`).join(', ')}`}>
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
      {refill && (
        <RefillListModal open onClose={() => setRefill(false)} parent={parent} medicines={medicines} callLogs={callLogs} senderName={familyName} />
      )}
    </section>
  );
}
