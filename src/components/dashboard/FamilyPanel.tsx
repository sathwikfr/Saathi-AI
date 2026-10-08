'use client';

import React, { useState } from 'react';
import { Copy, ExternalLink, Link2, LogOut, MessageCircle, Phone, Plus, ShieldAlert, Trash2, UserRound, Users } from 'lucide-react';
import { ParentProfile, EmergencyContact, CaregiverInvite, ParentAccessRole, ContactRole } from '@/lib/types';
import { canManage, copyText, formatPhone, whatsappShareLink } from './helpers';

type Toast = (text: string, type?: 'success' | 'info' | 'error') => void;

type Props = {
  parent: ParentProfile;
  role: ParentAccessRole;
  caregivers: CaregiverInvite[];
  contacts: EmergencyContact[];
  cardUrl: string | null;
  onInvite: () => void;
  onChanged: () => void;
  onLeft: () => void;
  onToast: Toast;
};

const ROLES: { value: ContactRole; label: string }[] = [
  { value: 'family', label: 'Family' },
  { value: 'neighbour', label: 'Neighbour' },
  { value: 'security', label: 'Building security' },
  { value: 'doctor', label: 'Doctor' },
  { value: 'caregiver', label: 'Nurse / carer' },
  { value: 'other', label: 'Other' }
];

const BLOOD_GROUPS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

async function patchParent(parentId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/parents/${parentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export function FamilyPanel({ parent, role, caregivers, contacts, cardUrl, onInvite, onChanged, onLeft, onToast }: Props) {
  const manage = canManage(role);
  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      <div className="notice amber" role="note">
        <ShieldAlert size={18} />
        <div>
          <b>Aaptha is not an emergency service.</b> If {parent.name} needs urgent help, call <b>112</b> (India&apos;s emergency number) or someone near them. Our alerts help your family act faster; they don&apos;t replace that call.
        </div>
      </div>
      <FamilyCircle parent={parent} role={role} caregivers={caregivers} onInvite={onInvite} onChanged={onChanged} onLeft={onLeft} onToast={onToast} />
      <ContactsEditor key={contacts.map(c => c.id + c.practiceAt).join('|')} parent={parent} contacts={contacts} manage={manage} onChanged={onChanged} onToast={onToast} />
      <EmergencyCard key={parent.id + (parent.address || '') + parent.livesAlone} parent={parent} manage={manage} cardUrl={cardUrl} onChanged={onChanged} onToast={onToast} />
    </div>
  );
}

/* ---------------- Family circle ---------------- */

function FamilyCircle({ parent, role, caregivers, onInvite, onChanged, onLeft, onToast }: Omit<Props, 'contacts' | 'cardUrl'>) {
  const owner = role === 'owner';
  const active = caregivers.filter(c => c.status === 'accepted' || c.status === 'pending');

  const call = async (method: 'PATCH' | 'DELETE', body: Record<string, unknown>) => {
    const res = await fetch(`/api/parents/${parent.id}/caregivers`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) onToast(data.error || 'Something went wrong.', 'error');
    return { ok: res.ok, data };
  };

  return (
    <section className="panel" aria-labelledby="circle-title">
      <div className="panel-head">
        <div>
          <h3 id="circle-title"><Users size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Family circle</h3>
          <p>Brothers, sisters and carers who share the care of {parent.name}. Each gets their own updates and can say &ldquo;I&apos;m on it&rdquo;.</p>
        </div>
        {owner ? (
          <button onClick={onInvite} className="btn btn-primary btn-sm"><Plus size={14} /> Invite</button>
        ) : (
          <button
            onClick={async () => {
              if (!window.confirm(`Stop getting updates about ${parent.name}?`)) return;
              const r = await call('DELETE', {});
              if (r.ok) { onToast(r.data.message, 'info'); onLeft(); }
            }}
            className="btn btn-ghost btn-sm"
          >
            <LogOut size={14} /> Leave
          </button>
        )}
      </div>
      {active.length === 0 ? (
        <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)' }}>
          {owner ? 'Nobody else yet. Invite a sibling so the alerts and the work are shared.' : 'You are the only other family member here.'}
        </p>
      ) : (
        <div className="list">
          {active.map(cg => (
            <div key={cg.id} className="list-row">
              <div className="row-main" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span className="icon-tile" style={{ width: '38px', height: '38px' }}><UserRound size={17} /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="row-title">
                    {cg.name}
                    <span className={`badge ${cg.status === 'accepted' ? 'badge-green' : 'badge-neutral'}`}>{cg.status === 'accepted' ? 'Joined' : 'Invited'}</span>
                  </div>
                  <div className="row-sub" style={{ textTransform: 'none' }}>
                    {cg.role === 'co_manager' ? 'Can manage calls and medicines' : 'Can see updates'}
                    {cg.email ? ` · ${cg.email}` : ''}
                  </div>
                </div>
              </div>
              {owner && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {cg.inviteUrl && (
                    <>
                      <button className="btn btn-quiet btn-sm" onClick={async () => onToast((await copyText(cg.inviteUrl!)) ? 'Invite link copied.' : 'Could not copy.', 'info')}>
                        <Copy size={14} /> Link
                      </button>
                      <a
                        className="btn btn-quiet btn-sm"
                        target="_blank"
                        rel="noreferrer"
                        href={whatsappShareLink(`Join me in looking after ${parent.name} on Aaptha: ${cg.inviteUrl}`, cg.phone)}
                      >
                        <MessageCircle size={14} /> WhatsApp
                      </a>
                    </>
                  )}
                  <select
                    aria-label={`What ${cg.name} can do`}
                    className="form-input"
                    style={{ width: 'auto', padding: '6px 10px', fontSize: '0.84rem' }}
                    value={cg.role}
                    onChange={async e => {
                      if ((await call('PATCH', { inviteId: cg.id, role: e.target.value })).ok) onChanged();
                    }}
                  >
                    <option value="co_manager">Can manage</option>
                    <option value="viewer">Can see</option>
                  </select>
                  <button
                    className="icon-btn danger"
                    aria-label={`Remove ${cg.name}`}
                    onClick={async () => {
                      if (!window.confirm(`Remove ${cg.name}? They stop getting updates about ${parent.name}.`)) return;
                      if ((await call('DELETE', { inviteId: cg.id })).ok) onChanged();
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------- Emergency contacts (the ladder) ---------------- */

type Row = { id?: string; name: string; relation: string; phone: string; role: ContactRole | ''; isLocal: boolean; practiceAt?: string; practiceResult?: string };

function ContactsEditor({ parent, contacts, manage, onChanged, onToast }: { parent: ParentProfile; contacts: EmergencyContact[]; manage: boolean; onChanged: () => void; onToast: Toast }) {
  const [rows, setRows] = useState<Row[]>(
    contacts.map(c => ({ id: c.id, name: c.name, relation: c.relation, phone: c.phone, role: c.role || '', isLocal: !!c.isLocal, practiceAt: c.practiceAt, practiceResult: c.practiceResult }))
  );
  const [saving, setSaving] = useState(false);
  const [practising, setPractising] = useState<string | null>(null);
  const dirty = JSON.stringify(rows.map(r => ({ id: r.id, name: r.name, relation: r.relation, phone: r.phone, role: r.role, isLocal: r.isLocal }))) !==
    JSON.stringify(contacts.map(c => ({ id: c.id, name: c.name, relation: c.relation, phone: c.phone, role: c.role || '', isLocal: !!c.isLocal })));
  const update = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    const { ok, data } = await patchParent(parent.id, { action: 'contacts', contacts: rows });
    setSaving(false);
    onToast(ok ? 'Emergency contacts saved.' : data.error || 'Could not save.', ok ? 'success' : 'error');
    if (ok) onChanged();
  };

  const practice = async (contactId: string) => {
    setPractising(contactId);
    const res = await fetch(`/api/parents/${parent.id}/practice-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId })
    });
    const data = await res.json().catch(() => ({}));
    setPractising(null);
    onToast(res.ok ? data.message : data.error || 'Could not place the practice call.', res.ok ? 'success' : 'info');
  };

  return (
    <section className="panel" id="emergency-plan" aria-labelledby="contacts-title" style={{ scrollMarginTop: '90px' }}>
      <div className="panel-head">
        <div>
          <h3 id="contacts-title"><Phone size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Who we phone in an emergency</h3>
          <p>
            If Saathi hears an emergency, we phone you and the first contact who lives near {parent.name}, with the address. If nobody says &ldquo;I&apos;m on it&rdquo; within 10 minutes, we phone the next person, then {parent.name} again.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '12px' }}>
        {rows.map((r, i) => (
          <div key={r.id || `new-${i}`} className="row-card">
            <div className="row-card-head">
              <span className={`badge ${i === 0 ? 'badge-teal' : 'badge-neutral'}`}>{r.isLocal ? 'Lives nearby' : i === 0 ? 'First contact' : `Backup ${i}`}</span>
              {manage && rows.length > 1 && (
                <button type="button" className="icon-btn danger" aria-label={`Remove ${r.name || 'contact'}`} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <div className="row-grid">
              <div className="form-group">
                <label className="mini-label" htmlFor={`ec-name-${i}`}>Name</label>
                <input id={`ec-name-${i}`} className="form-input" value={r.name} disabled={!manage} onChange={e => update(i, { name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="mini-label" htmlFor={`ec-phone-${i}`}>Mobile number</label>
                <input id={`ec-phone-${i}`} className="form-input" type="tel" inputMode="tel" value={r.phone} disabled={!manage} onChange={e => update(i, { phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="mini-label" htmlFor={`ec-role-${i}`}>Who are they?</label>
                <select id={`ec-role-${i}`} className="form-input" value={r.role} disabled={!manage} onChange={e => update(i, { role: e.target.value as ContactRole, relation: ROLES.find(x => x.value === e.target.value)?.label || r.relation })}>
                  <option value="">Choose…</option>
                  {ROLES.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '0.88rem', fontWeight: 500 }}>
                  <button type="button" role="switch" aria-checked={r.isLocal} className="switch" disabled={!manage} onClick={() => update(i, { isLocal: !r.isLocal })} />
                  Lives near {parent.name} (can go there)
                </label>
              </div>
            </div>
            {r.id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '8px', fontSize: '0.84rem', color: 'var(--ink-muted)' }}>
                {r.practiceAt
                  ? <span className="badge badge-green">Practised {new Date(r.practiceAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                  : r.practiceResult ? <span className="badge badge-amber">Practice call: {r.practiceResult.replace('_', ' ')}</span>
                  : <span>No practice alert yet.</span>}
                {manage && (
                  <button type="button" className="btn btn-quiet btn-sm" disabled={!!practising || dirty} onClick={() => practice(r.id!)}>
                    {practising === r.id ? <><span className="spinner" /> Calling…</> : 'Send a practice alert'}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {manage && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '14px' }}>
          {rows.length < 6 && (
            <button type="button" className="add-row" style={{ flex: 1 }} onClick={() => setRows(rs => [...rs, { name: '', relation: 'Neighbour', phone: '', role: 'neighbour', isLocal: true }])}>
              <Plus size={16} /> Add a neighbour, relative nearby or building security
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
            {saving ? <><span className="spinner" /> Saving…</> : 'Save contacts'}
          </button>
        </div>
      )}
    </section>
  );
}

/* ---------------- Emergency card ---------------- */

function EmergencyCard({ parent, manage, cardUrl, onChanged, onToast }: { parent: ParentProfile; manage: boolean; cardUrl: string | null; onChanged: () => void; onToast: Toast }) {
  const [form, setForm] = useState({
    address: parent.address || '',
    livesAlone: parent.livesAlone,
    bloodGroup: parent.bloodGroup || '',
    conditions: parent.conditions || '',
    allergies: parent.allergies || '',
    nearestHospital: parent.nearestHospital || '',
    doctorName: parent.doctorName || '',
    doctorPhone: parent.doctorPhone || ''
  });
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState(cardUrl);
  const set = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { ok, data } = await patchParent(parent.id, { action: 'details', updates: form });
    setSaving(false);
    onToast(ok ? 'Emergency card saved.' : data.error || 'Could not save.', ok ? 'success' : 'error');
    if (ok) onChanged();
  };

  const share = async (shared: boolean) => {
    const { ok, data } = await patchParent(parent.id, { action: 'share_card', shared });
    if (!ok) return onToast(data.error || 'Could not change the link.', 'error');
    setLink(data.cardUrl);
    onToast(data.message, 'info');
  };

  return (
    <section className="panel" aria-labelledby="card-title">
      <div className="panel-head">
        <div>
          <h3 id="card-title">Emergency card</h3>
          <p>What a neighbour, ambulance crew or hospital needs to know about {parent.name}, on one page you can share as a link.</p>
        </div>
      </div>
      <form onSubmit={save}>
        <div className="form-group">
          <label className="form-label" htmlFor="card-address">Home address</label>
          <textarea id="card-address" className="form-input" rows={2} value={form.address} disabled={!manage} onChange={e => set('address', e.target.value)} placeholder="House, street, area, city, PIN, landmark" />
          <span className="form-hint">Read out to your nearby contact during an emergency call.</span>
        </div>
        <div className="toggle-row">
          <div>
            <strong>{parent.name} lives alone</strong>
            <p>If {parent.name} can&apos;t be reached all day, we ask a nearby contact to go and check.</p>
          </div>
          <button type="button" role="switch" aria-checked={form.livesAlone} aria-label="Lives alone" className="switch" disabled={!manage} onClick={() => set('livesAlone', !form.livesAlone)} />
        </div>
        <div className="row-grid" style={{ marginTop: '12px' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="card-blood">Blood group</label>
            <select id="card-blood" className="form-input" value={form.bloodGroup} disabled={!manage} onChange={e => set('bloodGroup', e.target.value)}>
              {BLOOD_GROUPS.map(b => <option key={b} value={b}>{b || 'Not known'}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="card-hospital">Nearest hospital</label>
            <input id="card-hospital" className="form-input" value={form.nearestHospital} disabled={!manage} onChange={e => set('nearestHospital', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="card-conditions">Health conditions</label>
            <input id="card-conditions" className="form-input" value={form.conditions} disabled={!manage} onChange={e => set('conditions', e.target.value)} placeholder="e.g. diabetes, high BP" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="card-allergies">Allergies</label>
            <input id="card-allergies" className="form-input" value={form.allergies} disabled={!manage} onChange={e => set('allergies', e.target.value)} placeholder="e.g. penicillin" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="card-doctor">Doctor</label>
            <input id="card-doctor" className="form-input" value={form.doctorName} disabled={!manage} onChange={e => set('doctorName', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="card-doctor-phone">Doctor&apos;s number</label>
            <input id="card-doctor-phone" className="form-input" type="tel" value={form.doctorPhone} disabled={!manage} onChange={e => set('doctorPhone', e.target.value)} />
          </div>
        </div>
        {manage && (
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <><span className="spinner" /> Saving…</> : 'Save card'}
          </button>
        )}
      </form>

      {manage && (
        <div className="card-flat" style={{ marginTop: '18px', background: 'var(--paper)' }}>
          <div className="toggle-row" style={{ paddingTop: 0 }}>
            <div>
              <strong><Link2 size={16} /> Share as a link</strong>
              <p>Anyone with the link can see the card (current medicines included). Turn it off to stop the old link working.</p>
            </div>
            <button type="button" role="switch" aria-checked={!!link} aria-label="Share the emergency card" className="switch" onClick={() => share(!link)} />
          </div>
          {link && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <a className="btn btn-ghost btn-sm" href={link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
              <button className="btn btn-quiet btn-sm" onClick={async () => onToast((await copyText(link)) ? 'Link copied.' : 'Could not copy.', 'info')}><Copy size={14} /> Copy</button>
              <a className="btn btn-quiet btn-sm" href={whatsappShareLink(`${parent.name}'s emergency card: ${link}`)} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>
            </div>
          )}
        </div>
      )}
      {!manage && parent.address && <p style={{ marginTop: '8px', fontSize: '0.86rem', color: 'var(--ink-muted)' }}>Phone: {formatPhone(parent.phone)}</p>}
    </section>
  );
}
