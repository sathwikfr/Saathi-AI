'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FileText, FolderHeart, Trash2, UploadCloud, ExternalLink, CalendarClock } from 'lucide-react';
import { HealthDocument } from '@/lib/types';

const KINDS: { value: HealthDocument['kind']; label: string }[] = [
  { value: 'prescription', label: 'Prescription' },
  { value: 'lab_report', label: 'Lab report' },
  { value: 'scan', label: 'Scan / X-ray / ECG' },
  { value: 'discharge', label: 'Discharge summary' },
  { value: 'bill', label: 'Bill' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'other', label: 'Other' }
];
const kindLabel = (k: string) => KINDS.find(x => x.value === k)?.label || k;

type Toast = (text: string, type?: 'success' | 'info' | 'error') => void;

/** Health record vault: reports, prescriptions, scans, bills, discharge summaries, insurance papers. */
export function RecordsPanel({ parentId, parentName, manage, onToast }: { parentId: string; parentName: string; manage: boolean; onToast: Toast }) {
  const [docs, setDocs] = useState<HealthDocument[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<HealthDocument['kind']>('lab_report');
  const [title, setTitle] = useState('');
  const [docDate, setDocDate] = useState('');
  const [renewalDate, setRenewalDate] = useState('');
  const [notes, setNotes] = useState('');
  const [now] = useState(() => Date.now());

  const load = useCallback(() => {
    fetch(`/api/parents/${parentId}/documents`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        setDocs(data?.documents || []);
        setEnabled(data?.enabled !== false);
      })
      .catch(() => setDocs([]));
  }, [parentId]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    form.append('title', title);
    form.append('docDate', docDate);
    form.append('renewalDate', kind === 'insurance' ? renewalDate : '');
    form.append('notes', notes);
    const res = await fetch(`/api/parents/${parentId}/documents`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    setUploading(false);
    if (!res.ok) return onToast(data.error || 'Could not upload.', 'error');
    setFile(null);
    setTitle('');
    setDocDate('');
    setRenewalDate('');
    setNotes('');
    onToast('Saved to the vault.', 'success');
    load();
  };

  const open = async (doc: HealthDocument) => {
    const res = await fetch(`/api/parents/${parentId}/documents/${doc.id}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) window.open(data.url, '_blank', 'noopener');
    else onToast(data.error || 'Could not open the file.', 'error');
  };

  const remove = async (doc: HealthDocument) => {
    if (!window.confirm(`Remove "${doc.title}" from the vault?`)) return;
    const res = await fetch(`/api/parents/${parentId}/documents/${doc.id}`, { method: 'DELETE' });
    if (res.ok) load();
    else onToast('Could not remove it.', 'error');
  };

  const today = new Date(now).toISOString().slice(0, 10);
  const soon = new Date(now + 30 * 86400000).toISOString().slice(0, 10);
  const renewals = (docs || []).filter(d => d.renewalDate && d.renewalDate >= today && d.renewalDate <= soon);

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      {renewals.map(d => (
        <div key={d.id} className="banner gold" role="status">
          <CalendarClock size={20} />
          <div>
            <strong>{d.title} renews on {new Date(d.renewalDate!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
            <span>A reminder so it doesn&apos;t lapse.</span>
          </div>
        </div>
      ))}

      <section className="panel" aria-labelledby="vault-title">
        <div className="panel-head">
          <div>
            <h3 id="vault-title"><FolderHeart size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />{parentName}&apos;s health records</h3>
            <p>Reports, prescriptions, scans and bills in one private place. &ldquo;Ask about {parentName.split(' ')[0]}&rdquo; can find them by title and date.</p>
          </div>
        </div>

        {!enabled && <div className="notice amber"><span>The vault is not switched on yet. Files can be added once storage is connected.</span></div>}

        {docs === null ? (
          <div className="skeleton" style={{ height: '120px' }} />
        ) : docs.length === 0 ? (
          <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)' }}>Nothing saved yet.</p>
        ) : (
          <div className="list">
            {docs.map(d => (
              <div key={d.id} className="list-row">
                <div className="row-main" style={{ display: 'flex', gap: '12px', alignItems: 'center', minWidth: 0 }}>
                  <span className="icon-tile" style={{ width: '38px', height: '38px' }}><FileText size={17} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="row-title">{d.title}</div>
                    <div className="row-sub" style={{ textTransform: 'none' }}>
                      {[kindLabel(d.kind), d.docDate && new Date(d.docDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }), d.notes].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => open(d)}><ExternalLink size={14} /> Open</button>
                  {manage && <button className="icon-btn danger" aria-label={`Remove ${d.title}`} onClick={() => remove(d)}><Trash2 size={16} /></button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {manage && enabled && (
        <section className="panel" aria-labelledby="vault-add">
          <div className="panel-head">
            <div>
              <h3 id="vault-add">Add a record</h3>
              <p>PDF or a photo, up to 10 MB. Only your family circle can open it.</p>
            </div>
          </div>
          <form onSubmit={upload}>
            <div className="dropzone" style={{ marginBottom: '14px' }}>
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" aria-label="Choose a file" onChange={e => setFile(e.target.files?.[0] || null)} />
              <span className="icon-tile" style={{ margin: '0 auto 8px' }}><UploadCloud size={22} /></span>
              <div style={{ fontWeight: 600 }}>{file ? file.name : 'Choose a file'}</div>
            </div>
            <div className="row-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="doc-kind">Type</label>
                <select id="doc-kind" className="form-input" value={kind} onChange={e => setKind(e.target.value as HealthDocument['kind'])}>
                  {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="doc-title">Title</label>
                <input id="doc-title" className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. ECG, Apollo Hospital" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="doc-date">Date of the record</label>
                <input id="doc-date" type="date" className="form-input" value={docDate} onChange={e => setDocDate(e.target.value)} />
              </div>
              {kind === 'insurance' && (
                <div className="form-group">
                  <label className="form-label" htmlFor="doc-renewal">Renewal date</label>
                  <input id="doc-renewal" type="date" className="form-input" value={renewalDate} onChange={e => setRenewalDate(e.target.value)} />
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="doc-notes">Notes <span className="form-hint">Optional</span></label>
              <input id="doc-notes" className="form-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Dr Rao asked for a repeat in 3 months" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={!file || uploading}>
              {uploading ? <><span className="spinner" /> Saving…</> : 'Save to the vault'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
