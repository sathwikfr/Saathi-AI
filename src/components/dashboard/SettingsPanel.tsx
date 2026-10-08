'use client';

import React, { useState } from 'react';
import { MessageCircleHeart, Pause, Pencil, Play, ShieldCheck, Trash2 } from 'lucide-react';
import { ParentProfile, ParentAccessRole } from '@/lib/types';
import { formatScheduleSummary, getSelectableCallTimes } from '@/lib/scheduleGenerator';
import { CallStats, formatPhone, canManage } from './helpers';
import { SaathiPreferences } from './SaathiPreferences';
import { HealthMonitorCard } from './HealthMonitorCard';

type Props = {
  parent: ParentProfile;
  role: ParentAccessRole;
  stats: CallStats;
  companionAllowed: boolean;
  /** Family / Extended features unlocked (the owner's plan). */
  premium: boolean;
  /** The owner's plan, what the add-ons cost on it, and which add-ons are on. */
  planId: string;
  monitorPrice: number;
  touchesPrice: number;
  healthMonitor: boolean;
  dailyTouches: boolean;
  /** The time of the short readings call, if one is set. */
  vitalsCall: string | null;
  callTogetherCandidates: { id: string; name: string }[];
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onChanged: () => void;
  onToast: (text: string, type?: 'success' | 'info' | 'error') => void;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CONSENT_TEXT: Record<ParentProfile['parentConsent'], string> = {
  pending: 'Saathi will ask on the next call, in their language, before anything else.',
  given: 'Said yes on a call.',
  declined: 'Said no to the calls. Calls are paused until you resume them; Saathi then asks again.',
  withdrawn: 'Asked Saathi to stop calling. Calls are paused until you resume them; Saathi then asks again.'
};

function CompanionSettings({ parent, companionAllowed, onChanged, onToast }: Pick<Props, 'parent' | 'companionAllowed' | 'onChanged' | 'onToast'>) {
  const [enabled, setEnabled] = useState(parent.companionEnabled);
  const [day, setDay] = useState(parent.companionDay ?? 0);
  const [time, setTime] = useState(parent.companionTime || '05:00 PM');
  const [topics, setTopics] = useState(parent.companionTopics || '');
  const [birthday, setBirthday] = useState(parent.birthDate ? `2000-${parent.birthDate}` : '');
  const [saving, setSaving] = useState(false);
  const times = getSelectableCallTimes(parent.companionTime);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/parents/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'details',
        updates: {
          companionEnabled: enabled && companionAllowed,
          companionDay: day,
          companionTime: time,
          companionTopics: topics,
          birthDate: birthday ? birthday.slice(5, 10) : null
        }
      })
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    onToast(res.ok ? 'Saved.' : data.error || 'Could not save.', res.ok ? 'success' : 'error');
    if (res.ok) onChanged();
  };

  return (
    <section className="panel" aria-labelledby="companion-title">
      <div className="panel-head">
        <div>
          <h3 id="companion-title"><MessageCircleHeart size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Weekly chat call</h3>
          <p>Once a week, up to 5 minutes, Saathi calls just to chat: stories, cricket, old films, the grandchildren. Medicine calls stay short.</p>
        </div>
      </div>
      <form onSubmit={save}>
        <div className="toggle-row" style={{ paddingTop: 0 }}>
          <div>
            <strong>Turn on the weekly chat</strong>
            <p>{companionAllowed ? 'Included in your plan.' : 'Coming soon as an add-on.'} Saathi still listens for anything worrying and tells you.</p>
          </div>
          <button type="button" role="switch" aria-checked={enabled} aria-label="Weekly chat call" className="switch" disabled={!companionAllowed} onClick={() => setEnabled(v => !v)} />
        </div>
        {enabled && (
          <div className="row-grid" style={{ marginTop: '12px' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="companion-day">Day</label>
              <select id="companion-day" className="form-input" value={day} onChange={e => setDay(Number(e.target.value))}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="companion-time">Time (India)</label>
              <select id="companion-time" className="form-input" value={time} onChange={e => setTime(e.target.value)}>
                {times.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label" htmlFor="companion-topics">What does {parent.name} enjoy talking about?</label>
              <textarea
                id="companion-topics"
                className="form-input"
                rows={2}
                value={topics}
                onChange={e => setTopics(e.target.value)}
                placeholder="e.g. cricket (CSK), old NTR films, the temple, grandchildren Riya (8) and Arjun (5)"
                maxLength={400}
              />
            </div>
          </div>
        )}
        <div className="form-group" style={{ marginTop: '12px', maxWidth: '260px' }}>
          <label className="form-label" htmlFor="parent-birthday">Birthday <span className="form-hint">Saathi wishes them on the day</span></label>
          <input id="parent-birthday" type="date" className="form-input" value={birthday} onChange={e => setBirthday(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <><span className="spinner" /> Saving…</> : 'Save'}</button>
      </form>
    </section>
  );
}

export function SettingsPanel({ parent, role, stats, companionAllowed, premium, planId, monitorPrice, touchesPrice, healthMonitor, dailyTouches, vitalsCall, callTogetherCandidates, onPause, onResume, onDelete, onEdit, onChanged, onToast }: Props) {
  const manage = canManage(role);
  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      <section className="panel" aria-labelledby="routine-title">
        <div className="panel-head">
          <div>
            <h3 id="routine-title">Calls</h3>
            <p>How and when Saathi calls {parent.name}.</p>
          </div>
          {manage && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={onEdit} className="btn btn-ghost btn-sm"><Pencil size={14} /> Edit details</button>
              {parent.isPaused ? (
                <button onClick={onResume} className="btn btn-primary btn-sm"><Play size={15} /> Resume calls</button>
              ) : (
                <button onClick={onPause} className="btn btn-ghost btn-sm"><Pause size={15} /> Pause calls</button>
              )}
            </div>
          )}
        </div>
        <div className="kv">
          <div>
            <span>Schedule</span>
            <strong>{stats.activeSlots.length > 0 ? formatScheduleSummary(stats.activeSlots) : 'No calls scheduled'}</strong>
          </div>
          <div>
            <span>Language</span>
            <strong>{parent.language}</strong>
          </div>
          <div>
            <span>Time zone</span>
            <strong>{parent.timezone}</strong>
          </div>
          <div>
            <span>Phone</span>
            <strong>{formatPhone(parent.phone)}</strong>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="consent-title">
        <div className="panel-head" style={{ marginBottom: '8px' }}>
          <div>
            <h3 id="consent-title"><ShieldCheck size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />{parent.name}&apos;s own consent</h3>
            <p>{CONSENT_TEXT[parent.parentConsent]}</p>
          </div>
          <span className={`badge ${parent.parentConsent === 'given' ? 'badge-green' : parent.parentConsent === 'pending' ? 'badge-neutral' : 'badge-amber'}`}>
            {parent.parentConsent === 'given' ? 'Agreed' : parent.parentConsent === 'pending' ? 'Not asked yet' : 'Said no'}
          </span>
        </div>
        <p style={{ fontSize: '0.86rem', color: 'var(--ink-muted)' }}>
          {parent.name} can say &ldquo;stop calling me&rdquo; on any call: calls pause at once and you are told.
        </p>
      </section>

      {manage && (
        <SaathiPreferences parent={parent} isOwner={role === 'owner'} premium={premium} touches={dailyTouches} planId={planId} touchesPrice={touchesPrice} callTogetherCandidates={callTogetherCandidates} onChanged={onChanged} onToast={onToast} />
      )}

      {manage && (
        <HealthMonitorCard parent={parent} enabled={healthMonitor} vitalsCall={vitalsCall} planId={planId} price={monitorPrice} isOwner={role === 'owner'} onChanged={onChanged} onToast={onToast} />
      )}

      {manage && <CompanionSettings parent={parent} companionAllowed={companionAllowed} onChanged={onChanged} onToast={onToast} />}

      {role === 'owner' && (
        <section className="panel danger-zone" aria-labelledby="danger-title">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <div style={{ maxWidth: '56ch' }}>
              <h3 id="danger-title" style={{ color: 'var(--red)' }}>Remove {parent.name}</h3>
              <p>Stops all calls and removes {parent.name} from your dashboard. You can download their history first.</p>
            </div>
            <button onClick={onDelete} className="btn btn-danger-ghost btn-sm"><Trash2 size={14} /> Remove profile</button>
          </div>
        </section>
      )}
    </div>
  );
}
