'use client';

import React, { useState } from 'react';
import { MessageCircle, Copy, Check, Clock, X, AlertTriangle, BellOff, Pill, Pause, Play, Pencil, Trash2, EyeOff, RefreshCw, PhoneCall, UserCheck } from 'lucide-react';
import { ParentProfile, ParentAccessRole, ReminderView, Medicine } from '@/lib/types';
import { formatReminderSummary, timeToMinutes } from '@/lib/scheduleGenerator';
import { PhoneField } from '@/components/auth/AuthUI';
import { copyText, formatPhone, whatsappShareLink, canManage } from './helpers';

/**
 * Remind plan (WhatsApp medicine checks): the Today view and the settings for one person.
 * No calls: at each medicine time the person gets "did you take it?" with Yes, taken / Not yet, asked up to
 * 3 times, 30 minutes apart; still no Yes, and their caretaker gets a WhatsApp to call.
 */

type Toast = (text: string, type?: 'success' | 'info' | 'error') => void;
type StartInfo = { whatsappReady: boolean; link: string | null; code: string | null; caretakerLink?: string | null } | null | undefined;

const DAY_MS = 86400000;

/** Today's date in IST as YYYY-MM-DD (reminder dates are IST). */
function istToday(offsetDays = 0): string {
  return new Date(Date.now() + 330 * 60000 - offsetDays * DAY_MS).toISOString().slice(0, 10);
}

function shortTime(t: string) {
  return t.replace(/^0/, '');
}

function clock(iso?: string) {
  return iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';
}

type Tone = 'green' | 'red' | 'amber' | 'neutral' | 'teal';

/** What happened to one medicine check, in words. */
export function reminderState(r: ReminderView | undefined, slotTime: string, isToday: boolean): { tone: Tone; text: string } {
  if (!r) {
    if (!isToday) return { tone: 'neutral', text: 'Not sent' };
    const now = new Date(Date.now() + 330 * 60000);
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    return timeToMinutes(slotTime) > nowMin ? { tone: 'neutral', text: 'Coming up' } : { tone: 'neutral', text: 'Not sent' };
  }
  if (r.status === 'failed') return { tone: 'red', text: "Couldn't send" };
  switch (r.answer) {
    case 'taken':
      return { tone: 'green', text: `Taken${r.answeredAt ? ` at ${clock(r.answeredAt)}` : ''}${r.caretakerTold ? ' (late)' : ''}` };
    case 'missed':
    case 'skipped':
      return { tone: 'red', text: r.caretakerTold ? 'Not confirmed, caretaker told' : 'Not confirmed' };
    case 'paused':
      return { tone: 'neutral', text: 'Paused for today' };
    case 'not_yet':
    case 'later':
      return { tone: 'amber', text: `Said "not yet" (asked ${r.asks}×)` };
    default:
      return { tone: 'teal', text: r.asks > 1 ? `Asked ${r.asks}×, no answer yet` : 'Asked, no answer yet' };
  }
}

/** A START link: opened on this phone (self), or sent to someone on WhatsApp. */
function StartLink({ link, ready, sendTo, sendName, self, onToast }: { link?: string | null; ready: boolean; sendTo?: string; sendName: string; self: boolean; onToast: Toast }) {
  if (!ready || !link) {
    return (
      <div className="notice amber" role="status" style={{ marginBottom: 0 }}>
        <AlertTriangle size={18} />
        <span>WhatsApp messages are still being switched on for Aaptha. The start link appears here as soon as they are live; nothing is sent until then.</span>
      </div>
    );
  }
  const shareText = `Hi ${sendName}, tap this link and press send to start the Aaptha medicine messages on WhatsApp: ${link}`;
  return (
    <div className="row-actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {self ? (
        <a className="btn btn-primary btn-sm" href={link} target="_blank" rel="noreferrer">
          <MessageCircle size={14} /> Open WhatsApp and send START
        </a>
      ) : (
        <a className="btn btn-primary btn-sm" href={whatsappShareLink(shareText, sendTo)} target="_blank" rel="noreferrer">
          <MessageCircle size={14} /> Send {sendName} the start link
        </a>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={async () => onToast((await copyText(self ? link : shareText)) ? 'Copied.' : 'Could not copy.', 'info')}>
        <Copy size={14} /> Copy link
      </button>
    </div>
  );
}

/** Who is told when a dose isn't confirmed, and whether they have said yes. */
function CaretakerCard({ parent, start, manage, me, onOpenSettings, onToast }: { parent: ParentProfile; start: StartInfo; manage: boolean; me: boolean; onOpenSettings: () => void; onToast: Toast }) {
  const name = parent.caretakerName?.split(' ')[0];
  let badge: React.ReactNode;
  let text: string;
  if (!parent.caretakerName) {
    badge = <span className="badge badge-neutral">Optional</span>;
    text = `No caretaker. If you like, add someone (husband, parent, friend) who gets a WhatsApp to call ${parent.relationship === 'Self' ? 'you' : parent.name} only when a dose isn't confirmed after 3 reminders, or if something is urgent.`;
  } else if (parent.caretakerOptOutAt) {
    badge = <span className="badge badge-neutral">Stopped</span>;
    text = `${name} replied STOP, so ${name} isn't told about missed doses. Sending START on WhatsApp turns it back on.`;
  } else if (!parent.caretakerOptInAt) {
    badge = <span className="badge badge-amber"><Clock size={12} /> Waiting for START</span>;
    text = me
      ? 'You are the caretaker. You start getting these messages after sending START from your WhatsApp (Meta requires your own yes).'
      : `${name} starts getting these messages after sending START from their own WhatsApp (Meta requires their own yes).`;
  } else {
    badge = <span className="badge badge-green"><UserCheck size={12} /> Active</span>;
    text = `${name} is told only when needed: a dose not confirmed after 3 reminders (at most twice a day), or anything urgent. ${name} answers with one button, "I'll handle it".`;
  }
  return (
    <section className="panel" aria-labelledby="caretaker-title">
      <div className="panel-head">
        <div>
          <h3 id="caretaker-title"><UserCheck size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Caretaker{name ? `: ${parent.caretakerName}` : ''}</h3>
          <p>{text}</p>
        </div>
        {badge}
      </div>
      {manage && (
        parent.caretakerName && !parent.caretakerOptInAt
          ? <StartLink link={start?.caretakerLink} ready={!!start?.whatsappReady} sendTo={parent.caretakerPhone} sendName={name || 'them'} self={me} onToast={onToast} />
          : !parent.caretakerName
            ? <button type="button" className="btn btn-primary btn-sm" onClick={onOpenSettings}>Add a caretaker</button>
            : null
      )}
    </section>
  );
}

type PanelProps = {
  parent: ParentProfile;
  reminders: ReminderView[];
  start: StartInfo;
  medicines: Medicine[];
  manage: boolean;
  /** Plan cap: reminder times a day that are sent (earliest win). */
  perDay: number;
  onOpenMedicines: () => void;
  onOpenSettings: () => void;
  /** The caretaker is the signed-in account holder (their START link opens on this phone). */
  caretakerIsMe?: boolean;
  onToast: Toast;
};

/** Today tab for someone on the Remind plan. */
export function RemindersPanel({ parent, reminders, start, medicines, manage, perDay, onOpenMedicines, onOpenSettings, caretakerIsMe = false, onToast }: PanelProps) {
  const self = parent.relationship === 'Self';
  const slots = [...(parent.callSchedule || [])]
    .filter(s => s.isActive)
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))
    .slice(0, perDay || 4);
  const today = istToday();
  const todays = reminders.filter(r => r.date === today);

  // Last 14 days: taken out of the doses that were answered or closed.
  const closed = reminders.filter(r => r.answer === 'taken' || r.answer === 'missed' || r.answer === 'skipped');
  const taken = closed.filter(r => r.answer === 'taken').length;
  const missed = closed.length - taken;
  const days = Array.from({ length: 14 }, (_, i) => istToday(13 - i));
  const current = medicines.filter(m => m.isActive && (!m.endsOn || m.endsOn >= today));
  const ended = medicines.filter(m => m.isActive && m.endsOn && m.endsOn < today);

  let status: React.ReactNode;
  if (!parent.reminderOptInAt) {
    status = (
      <section className="panel" aria-labelledby="rem-start-title">
        <div className="panel-head">
          <div>
            <h3 id="rem-start-title"><MessageCircle size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Medicine checks haven&apos;t started yet</h3>
            <p>
              {self
                ? 'Send START to our WhatsApp number from your phone. That turns the checks on; reply STOP any time to stop them.'
                : `${parent.name} turns them on by sending START from their own WhatsApp (their choice, and they can reply STOP any time). Send them the link below.`}
            </p>
          </div>
          <span className="badge badge-amber"><Clock size={12} /> Waiting for START</span>
        </div>
        {manage && <StartLink link={start?.link} ready={!!start?.whatsappReady} sendTo={parent.phone} sendName={parent.name} self={self} onToast={onToast} />}
      </section>
    );
  } else if (parent.reminderOptOutAt) {
    status = (
      <section className="panel" aria-labelledby="rem-stop-title">
        <div className="panel-head">
          <div>
            <h3 id="rem-stop-title"><BellOff size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Medicine checks are stopped</h3>
            <p>
              {self ? 'You' : parent.name} replied STOP on {new Date(parent.reminderOptOutAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.
              {' '}Sending START on WhatsApp turns them back on{self ? '' : '; only they can do that'}.
            </p>
          </div>
          <span className="badge badge-neutral">Stopped</span>
        </div>
      </section>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      {status}

      <section className="panel" aria-labelledby="rem-today-title">
        <div className="panel-head">
          <div>
            <h3 id="rem-today-title">Today&apos;s medicine checks</h3>
            <p>
              {slots.length ? `${formatReminderSummary(slots)}.` : 'No times yet.'} Each is asked up to 3 times, 30 minutes apart.
              {parent.discreetReminders && ' Discreet mode: the messages don\'t name the medicines.'}
            </p>
          </div>
          {parent.isPaused && <span className="badge badge-amber"><Pause size={12} /> Paused</span>}
        </div>
        {slots.length === 0 ? (
          <div className="empty" style={{ padding: '24px 16px' }}>
            <p>Add medicines with a time of day and they get a check.</p>
          </div>
        ) : (
          <div className="list">
            {slots.map(slot => {
              const r = todays.find(x => x.time === slot.time);
              const st = reminderState(r, slot.time, true);
              const names = r?.medicines.length ? r.medicines : (slot.linkedMedicineNames || []).filter(n => current.some(m => m.name === n));
              return (
                <div key={slot.id} className="list-row">
                  <div className="row-main" style={{ display: 'flex', gap: '14px', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <span className="icon-tile" style={{ width: '40px', height: '40px' }}><Pill size={18} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div className="row-title">{shortTime(slot.time)}</div>
                      <div className="row-sub" style={{ textTransform: 'none' }}>{names.length ? names.join(', ') : 'Nothing current at this time'}</div>
                    </div>
                  </div>
                  <span className={`badge badge-${st.tone}`}>
                    {st.tone === 'green' ? <Check size={12} /> : st.tone === 'red' ? <X size={12} /> : <Clock size={12} />} {st.text}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <CaretakerCard parent={parent} start={start} manage={manage} me={caretakerIsMe} onOpenSettings={onOpenSettings} onToast={onToast} />

      <section className="panel" aria-labelledby="rem-history-title">
        <div className="panel-head">
          <div>
            <h3 id="rem-history-title">Last 14 days</h3>
            <p>
              {closed.length
                ? `${taken} of ${closed.length} doses confirmed${missed ? `, ${missed} not confirmed` : ''}.`
                : `Nothing yet. Once ${self ? 'you start' : `${parent.name} starts`} answering the checks, it shows here.`}
            </p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: '8px' }}>
          {days.map(d => {
            const dayRems = reminders.filter(r => r.date === d);
            const label = new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
            return (
              <div key={d} className="card-flat" style={{ padding: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--ink-subtle)', marginBottom: '6px' }}>{label}</div>
                <div className="med-week" style={{ justifyContent: 'center', minHeight: '10px', flexWrap: 'wrap' }}>
                  {dayRems.length === 0
                    ? <i title="No checks" />
                    : [...dayRems].reverse().map(r => {
                        const cls = r.answer === 'taken' ? 'taken' : r.answer === 'missed' || r.answer === 'skipped' || r.status === 'failed' ? 'missed' : r.answer === 'not_yet' ? 'later' : '';
                        return <i key={r.id} className={cls} title={`${shortTime(r.time)}: ${reminderState(r, r.time, d === today).text}`} />;
                      })}
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--ink-subtle)', margin: '10px 0 0' }}>Green taken · red not confirmed · amber said not yet · grey waiting</p>
      </section>

      <section className="panel" aria-labelledby="rem-meds-title">
        <div className="panel-head">
          <div>
            <h3 id="rem-meds-title">In the checks</h3>
            <p>{current.length ? current.map(m => `${m.name}${m.endsOn ? ` (until ${new Date(`${m.endsOn}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })})` : ''}`).join(', ') : 'No current medicines.'}</p>
            {ended.length > 0 && <p style={{ color: 'var(--ink-subtle)' }}>Course finished: {ended.map(m => m.name).join(', ')}.</p>}
          </div>
          {manage && <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenMedicines}><Pencil size={14} /> Edit medicines</button>}
        </div>
      </section>
    </div>
  );
}

type SettingsProps = {
  parent: ParentProfile;
  role: ParentAccessRole;
  start: StartInfo;
  /** The owner's plan is a calling plan: this person can be switched back to calls. */
  canUseCalls: boolean;
  caretakerIsMe?: boolean;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onChanged: () => void;
  onToast: Toast;
};

async function patchParent(parentId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/parents/${parentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, message: (data.message || data.error || '') as string };
}

/** Name + WhatsApp number of the caretaker (any country), with save / remove / new link. */
function CaretakerSettings({ parent, start, me, run, saving, onToast }: { parent: ParentProfile; start: StartInfo; me: boolean; run: (body: Record<string, unknown>) => Promise<boolean>; saving: boolean; onToast: Toast }) {
  const [name, setName] = useState(parent.caretakerName || '');
  const [phone, setPhone] = useState(parent.caretakerPhone || '');
  const changed = name.trim() !== (parent.caretakerName || '') || phone.trim() !== (parent.caretakerPhone || '');
  return (
    <section className="panel" aria-labelledby="care-set-title">
      <div className="panel-head">
        <div>
          <h3 id="care-set-title"><UserCheck size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Caretaker</h3>
          <p>Gets a WhatsApp to call {parent.name} when a dose isn&apos;t confirmed after 3 reminders (at most twice a day), and straight away if {parent.name} writes something urgent. They start it by sending START from their own WhatsApp.</p>
        </div>
      </div>
      <form
        style={{ display: 'grid', gap: '10px' }}
        onSubmit={async e => {
          e.preventDefault();
          if (await run({ action: 'caretaker', caretaker: { name: name.trim(), phone: phone.trim() } })) setPhone(p => p.trim());
        }}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="mini-label" htmlFor="care-name">Name</label>
            <input id="care-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ravi (husband)" maxLength={80} />
          </div>
          <div className="form-group">
            <label className="mini-label" htmlFor="care-phone">WhatsApp number</label>
            <PhoneField id="care-phone" value={phone} onChange={setPhone} optional />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" disabled={saving || !changed || !name.trim() || !phone.trim()}>Save caretaker</button>
          {parent.caretakerName && (
            <button type="button" className="btn btn-quiet btn-sm" disabled={saving} onClick={async () => { if (await run({ action: 'caretaker', caretaker: null })) { setName(''); setPhone(''); } }}>
              <Trash2 size={14} /> Remove
            </button>
          )}
          {parent.caretakerName && (
            <button type="button" className="btn btn-quiet btn-sm" disabled={saving} onClick={() => run({ action: 'new_caretaker_code' })}>
              <RefreshCw size={14} /> New link
            </button>
          )}
        </div>
      </form>
      {parent.caretakerName && !parent.caretakerOptInAt && (
        <div style={{ marginTop: '12px' }}>
          <StartLink link={start?.caretakerLink} ready={!!start?.whatsappReady} sendTo={parent.caretakerPhone} sendName={parent.caretakerName.split(' ')[0]} self={me} onToast={onToast} />
        </div>
      )}
    </section>
  );
}

/** Settings tab for someone on the Remind plan. */
export function ReminderSettings({ parent, role, start, canUseCalls, caretakerIsMe = false, onPause, onResume, onDelete, onEdit, onChanged, onToast }: SettingsProps) {
  const manage = canManage(role);
  const [saving, setSaving] = useState(false);
  const self = parent.relationship === 'Self';
  const slots = (parent.callSchedule || []).filter(s => s.isActive);

  const run = async (body: Record<string, unknown>) => {
    setSaving(true);
    const res = await patchParent(parent.id, body);
    setSaving(false);
    onToast(res.message || (res.ok ? 'Saved.' : 'Could not save.'), res.ok ? 'success' : 'error');
    if (res.ok) onChanged();
    return res.ok;
  };

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      <section className="panel" aria-labelledby="rem-set-title">
        <div className="panel-head">
          <div>
            <h3 id="rem-set-title">WhatsApp medicine checks</h3>
            <p>&ldquo;Did you take it?&rdquo; at each medicine time, asked up to 3 times, 30 minutes apart. No calls.</p>
          </div>
          {manage && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={onEdit} className="btn btn-ghost btn-sm"><Pencil size={14} /> Edit details</button>
              {parent.isPaused ? (
                <button onClick={onResume} className="btn btn-primary btn-sm"><Play size={15} /> Resume checks</button>
              ) : (
                <button onClick={onPause} className="btn btn-ghost btn-sm"><Pause size={15} /> Pause checks</button>
              )}
            </div>
          )}
        </div>
        <div className="kv">
          <div>
            <span>Times</span>
            <strong>{formatReminderSummary(slots)}</strong>
          </div>
          <div>
            <span>WhatsApp</span>
            <strong>
              {parent.reminderOptOutAt
                ? 'Stopped (replied STOP)'
                : parent.reminderOptInAt
                  ? `Started ${new Date(parent.reminderOptInAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                  : 'Waiting for START'}
            </strong>
          </div>
          <div>
            <span>Phone</span>
            <strong>{formatPhone(parent.phone)}</strong>
          </div>
          <div>
            <span>Language</span>
            <strong>English</strong>
          </div>
        </div>
      </section>

      {manage && <CaretakerSettings key={`${parent.caretakerName}-${parent.caretakerPhone}`} parent={parent} start={start} me={caretakerIsMe} run={run} saving={saving} onToast={onToast} />}

      {manage && (
        <section className="panel" aria-labelledby="rem-privacy-title">
          <div className="toggle-row">
            <div>
              <strong id="rem-privacy-title"><EyeOff size={15} style={{ verticalAlign: '-2px', marginRight: '6px' }} />Discreet mode</strong>
              <p>The message says &ldquo;did you take your 8:00 AM medicine: your medicines?&rdquo;, without naming them, so nothing private shows on a lock screen. The caretaker&apos;s message leaves the names out too.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={parent.discreetReminders}
              aria-label="Discreet mode"
              className="switch"
              disabled={saving}
              onClick={() => run({ action: 'reminder_settings', discreet: !parent.discreetReminders })}
            />
          </div>
        </section>
      )}

      {manage && (
        <section className="panel" aria-labelledby="rem-weekly-title">
          <div className="toggle-row">
            <div>
              <strong id="rem-weekly-title">Weekly progress</strong>
              <p>One short message on Sunday evening, like &ldquo;This week you confirmed 13 of 14 medicine checks.&rdquo; Off unless you turn it on.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={parent.weeklyProgress}
              aria-label="Weekly progress"
              className="switch"
              disabled={saving}
              onClick={() => run({ action: 'reminder_settings', weeklyProgress: !parent.weeklyProgress })}
            />
          </div>
          {parent.weeklyProgress && parent.caretakerPhone && (
            <div className="toggle-row" style={{ marginTop: '12px' }}>
              <div>
                <strong id="rem-weekly-care-title">Send it to {parent.caretakerName || 'the caretaker'} too</strong>
                <p>Only if they have said yes on WhatsApp.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={parent.weeklyProgressToCaretaker}
                aria-labelledby="rem-weekly-care-title"
                className="switch"
                disabled={saving}
                onClick={() => run({ action: 'reminder_settings', weeklyProgressToCaretaker: !parent.weeklyProgressToCaretaker })}
              />
            </div>
          )}
        </section>
      )}

      {manage && (
        <section className="panel" aria-labelledby="rem-link-title">
          <div className="panel-head">
            <div>
              <h3 id="rem-link-title">{self ? 'Your' : `${parent.name}'s`} start link</h3>
              <p>
                {parent.reminderOptInAt
                  ? `New phone or number? ${self ? 'Send' : `Have ${parent.name} send`} START again with this link; the checks move to the number that sends it.`
                  : `${self ? 'Send' : `${parent.name} sends`} START with this link to turn the checks on.`}
                {' '}Each link works once.
              </p>
            </div>
            <button type="button" className="btn btn-quiet btn-sm" disabled={saving} onClick={() => run({ action: 'new_start_code' })}>
              <RefreshCw size={14} /> New link
            </button>
          </div>
          <StartLink link={start?.link} ready={!!start?.whatsappReady} sendTo={parent.phone} sendName={parent.name} self={self} onToast={onToast} />
        </section>
      )}

      {manage && canUseCalls && (
        <section className="panel" aria-labelledby="rem-channel-title">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <div style={{ maxWidth: '56ch' }}>
              <h3 id="rem-channel-title"><PhoneCall size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Switch to Saathi calls</h3>
              <p>Your plan includes check-in calls. Saathi would call {parent.name} at these times instead, and the WhatsApp checks stop.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => run({ action: 'reminder_channel', channel: 'call' })}>
              Use calls
            </button>
          </div>
        </section>
      )}

      {role === 'owner' && (
        <section className="panel danger-zone" aria-labelledby="rem-danger-title">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <div style={{ maxWidth: '56ch' }}>
              <h3 id="rem-danger-title" style={{ color: 'var(--red)' }}>Remove {parent.name}</h3>
              <p>Stops all checks and removes {parent.name} from your dashboard. Past checks are kept.</p>
            </div>
            <button onClick={onDelete} className="btn btn-danger-ghost btn-sm"><Trash2 size={14} /> Remove profile</button>
          </div>
        </section>
      )}
    </div>
  );
}

/** Settings on a calling plan: send WhatsApp checks instead of calls (for someone who carries their phone). */
export function ReminderChannelSwitch({ parent, onChanged, onToast }: { parent: ParentProfile; onChanged: () => void; onToast: Toast }) {
  const [saving, setSaving] = useState(false);
  return (
    <section className="panel" aria-labelledby="channel-title">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <div style={{ maxWidth: '56ch' }}>
          <h3 id="channel-title"><MessageCircle size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />WhatsApp checks instead of calls</h3>
          <p>For someone who always has their phone: a WhatsApp &ldquo;did you take it?&rdquo; at each medicine time with Yes / Not yet buttons, and no calls. {parent.name} starts them by sending START.</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            const res = await patchParent(parent.id, { action: 'reminder_channel', channel: 'whatsapp' });
            setSaving(false);
            onToast(res.message || (res.ok ? 'Saved.' : 'Could not save.'), res.ok ? 'success' : 'error');
            if (res.ok) onChanged();
          }}
        >
          Use WhatsApp
        </button>
      </div>
    </section>
  );
}
