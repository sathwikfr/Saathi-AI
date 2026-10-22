'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { PhoneCall, Pill, Bell, Check, PhoneMissed, Pause, Clock, AlertTriangle, Plus, MessageCircle, X } from 'lucide-react';
import { ParentProfile } from '@/lib/types';
import { timeToMinutes } from '@/lib/scheduleGenerator';
import { CountUp } from '@/components/motion/CountUp';
import { ParentDetails, computeCallStats, displayName, initial, isTestCall, onTabListKey } from './helpers';

export type Status = { tone: 'green' | 'amber' | 'red' | 'neutral'; text: string; icon: React.ReactNode };

const DAY = 86400000;

function isToday(iso?: string) {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.toDateString() === new Date().toDateString();
}

/** IST date (YYYY-MM-DD) of today: WhatsApp reminder dates are IST. */
function istToday() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

/** Status for someone on WhatsApp reminders (Remind): started? today's doses taken or missed? */
function reminderStatus(parent: ParentProfile, details?: ParentDetails): Status {
  if (parent.isPaused) return { tone: 'amber', text: 'Reminders paused', icon: <Pause size={12} /> };
  if (!parent.reminderOptInAt) return { tone: 'amber', text: 'Waiting for START', icon: <MessageCircle size={12} /> };
  if (parent.reminderOptOutAt) return { tone: 'neutral', text: 'Reminders stopped', icon: <MessageCircle size={12} /> };
  const today = (details?.reminders || []).filter(r => r.date === istToday());
  const missed = today.find(r => r.answer === 'missed' || r.status === 'failed');
  if (missed) return { tone: 'amber', text: `Missed the ${missed.time.replace(/^0/, '')} dose`, icon: <X size={12} /> };
  if (today.length && today.every(r => r.answer === 'taken')) return { tone: 'green', text: 'All taken today', icon: <Check size={12} /> };
  if (today.some(r => !r.answer || r.answer === 'later')) return { tone: 'neutral', text: 'Waiting for an answer', icon: <Clock size={12} /> };
  return { tone: 'green', text: 'Reminders on', icon: <MessageCircle size={12} /> };
}

export function parentStatus(parent: ParentProfile, details?: ParentDetails): Status {
  if (details?.channel === 'whatsapp' || (!details && parent.reminderChannel === 'whatsapp')) return reminderStatus(parent, details);
  if (parent.isPaused) return { tone: 'amber', text: 'Calls paused', icon: <Pause size={12} /> };
  const stats = computeCallStats(details?.callLogs || [], parent.callSchedule || []);
  const openToday = (details?.alerts || []).filter(a => a.status !== 'resolved' && isToday(a.createdAt || a.timestamp));
  // Red only for an emergency; a health concern (fever, unwell) is amber, like the Alerts tab.
  if (openToday.some(a => a.level >= 4)) return { tone: 'red', text: 'Emergency today', icon: <AlertTriangle size={12} /> };
  if (openToday.some(a => a.level === 3)) return { tone: 'amber', text: 'Health concern today', icon: <AlertTriangle size={12} /> };
  // Latest attempt of each scheduled call today (newest first); any of them going wrong outranks a later good call.
  const seen = new Set<string>();
  const perSlot = stats.todayCalls
    .filter(c => c.status !== 'scheduled' && c.status !== 'placed' && !isTestCall(c))
    .filter(c => { const k = c.slotId || c.id; if (seen.has(k)) return false; seen.add(k); return true; });
  const last = perSlot.find(c => !(c.status === 'answered' && c.medicationConfirmed)) ?? perSlot[0] ?? stats.latestToday;
  if (last) {
    const time = new Date(last.createdAt || last.scheduledTime).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    if (last.status === 'answered') {
      return last.medicationConfirmed
        ? { tone: 'green', text: 'All good today', icon: <Check size={12} /> }
        : { tone: 'amber', text: 'Medicine not confirmed', icon: <Pill size={12} /> };
    }
    return { tone: 'amber', text: `Missed the ${time} call`, icon: <PhoneMissed size={12} /> };
  }
  if (stats.nextSlot) return { tone: 'neutral', text: `Next call ${stats.nextSlot.time}`, icon: <Clock size={12} /> };
  if (stats.activeSlots.length) return { tone: 'neutral', text: `Tomorrow ${stats.activeSlots[0].time}`, icon: <Clock size={12} /> };
  return { tone: 'neutral', text: 'No calls set up', icon: <Clock size={12} /> };
}

type Props = {
  userName?: string;
  parents: ParentProfile[];
  detailsById: Record<string, ParentDetails>;
  selectedId: string;
  onSelect: (id: string) => void;
  canAddMore?: boolean;
  /** Checkout link shown instead of "Add a parent" when the plan is full (none on the biggest plan). */
  upgradeHref?: string;
  /** Everyone here gets WhatsApp reminders (Remind): count reminders, not calls. */
  whatsappOnly?: boolean;
};

/** Family-level header: greeting, live totals across every parent, and a parent picker with today's status. */
export function FamilyOverview({ userName, parents, detailsById, selectedId, onSelect, canAddMore = true, upgradeHref, whatsappOnly = false }: Props) {
  const firstName = userName?.split(' ')[0];
  const [nowMs] = useState(() => Date.now());

  let callsToday = 0;
  let answeredToday = 0;
  let missedToday = 0;
  let confirmedToday = 0;
  let needsLook = 0;
  let next: { name: string; time: string; mins: number } | null = null;
  const nowMinutes = new Date(nowMs).getHours() * 60 + new Date(nowMs).getMinutes();

  for (const p of parents) {
    const d = detailsById[p.id];
    const stats = computeCallStats(d?.callLogs || [], p.callSchedule || []);
    const today = stats.completedCalls.filter(c => isToday(c.createdAt || c.scheduledTime));
    callsToday += today.length;
    answeredToday += today.filter(c => c.status === 'answered').length;
    missedToday += today.filter(c => c.status !== 'answered').length;
    confirmedToday += today.filter(c => c.status === 'answered' && c.medicationConfirmed).length;
    needsLook += (d?.alerts || []).filter(a => a.level >= 2 && a.status !== 'resolved' && nowMs - new Date(a.createdAt || a.timestamp).getTime() < DAY).length;
    if (!p.isPaused && stats.nextSlot) {
      const mins = timeToMinutes(stats.nextSlot.time);
      if (mins > nowMinutes && (!next || mins < next.mins)) next = { name: displayName(p.name), time: stats.nextSlot.time, mins };
    }
  }

  // WhatsApp reminders (Remind): today's reminders instead of calls.
  const todayIst = istToday();
  const remindersToday = whatsappOnly ? parents.flatMap(p => (detailsById[p.id]?.reminders || []).filter(r => r.date === todayIst)) : [];
  const remSent = remindersToday.filter(r => r.status === 'sent').length;
  const remTaken = remindersToday.filter(r => r.answer === 'taken').length;
  const remMissed = remindersToday.filter(r => r.answer === 'missed' || r.status === 'failed').length;

  const tiles: { icon: typeof PhoneCall; value: number; of?: number; label: string; warn?: boolean }[] = whatsappOnly
    ? [
        { icon: MessageCircle, value: remSent, label: 'Reminders sent' },
        { icon: Pill, value: remTaken, of: remSent || undefined, label: 'Doses taken' },
        { icon: X, value: remMissed, label: 'Doses missed', warn: remMissed > 0 },
        { icon: Bell, value: needsLook, label: 'Needs a look', warn: needsLook > 0 },
      ]
    : [
        { icon: PhoneCall, value: answeredToday, of: callsToday || undefined, label: 'Calls answered' },
        { icon: Pill, value: confirmedToday, label: 'Medicines confirmed' },
        { icon: PhoneMissed, value: missedToday, label: 'Calls missed', warn: missedToday > 0 },
        { icon: Bell, value: needsLook, label: 'Needs a look', warn: needsLook > 0 },
      ];

  const nextText = next
    ? whatsappOnly && parents.length === 1
      ? `Next reminder at ${next.time.replace(/^0/, '')}.`
      : `${whatsappOnly ? 'Next reminder' : 'Next check-in'}: ${next.name} at ${next.time}.`
    : '';
  // Everyone paused: "No more calls today" read like the day was simply over.
  const allPaused = parents.length > 0 && parents.every(p => p.isPaused);
  const summary = allPaused
    ? `${whatsappOnly ? 'Reminders' : 'Calls'} are paused${parents.length > 1 ? ' for everyone' : ''} right now.`
    : whatsappOnly
    ? (remSent === 0
        ? (next ? `No reminders yet today. ${nextText}` : 'No more reminders today.')
        : `${remTaken} of ${remSent} reminder${remSent === 1 ? '' : 's'} answered "Taken" today.${nextText ? ` ${nextText}` : ''}`)
    : callsToday === 0
      ? (next ? `No calls yet today. ${nextText}` : 'No more calls today.')
      : `${answeredToday} of ${callsToday} call${callsToday === 1 ? '' : 's'} answered today.${nextText ? ` ${nextText}` : ''}`;

  return (
    <section className="family" aria-label="Your family today">
      <div className="family-head">
        <div>
          <p className="family-date">
            {new Date(nowMs).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1>Namaste{firstName ? `, ${firstName}` : ''}</h1>
          <p className="family-summary">{summary}</p>
        </div>
        {canAddMore ? (
          <Link href="/onboarding" className="btn btn-ghost btn-sm">
            <Plus size={15} /> {whatsappOnly ? 'Add a person' : 'Add a parent'}
          </Link>
        ) : upgradeHref ? (
          <Link href={upgradeHref} className="btn btn-ghost btn-sm" title="Your plan is full. Upgrade to add another parent.">
            <Plus size={15} /> {whatsappOnly ? 'Add a parent with calls' : 'Upgrade to add a parent'}
          </Link>
        ) : null}
      </div>

      <div className="family-stats">
        {tiles.map((t, i) => (
          <motion.div
            key={t.label}
            className={`family-stat${t.warn ? ' warn' : ''}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 * i, type: 'spring', stiffness: 300, damping: 30 }}
          >
            <span className={`icon-tile${t.warn ? ' gold' : ''}`}><t.icon size={17} /></span>
            <div>
              <b>
                <CountUp value={t.value} />
                {t.of !== undefined && <small> / {t.of}</small>}
              </b>
              <span>{t.label}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Mobile-app style: a rail of ringed avatars (ring = today's status). The chosen parent's details are the
          header right below, so there is no second card repeating the name. */}
      {parents.length > 1 && (() => {
        const sel = parents.find(p => p.id === selectedId) ?? parents[0];
        return (
      <div className="family-rail">
        {/* display: contents keeps the rail's layout; the tablist holds only tabs (the Add link sits beside it). */}
        <div
          role="tablist"
          aria-label="Choose parent"
          style={{ display: 'contents' }}
          onKeyDown={(e) => onTabListKey(e, parents.map(p => p.id), sel.id, onSelect)}
        >
          {parents.map((p) => {
            const pst = parentStatus(p, detailsById[p.id]);
            const active = p.id === sel.id;
            return (
              <button key={p.id} type="button" role="tab" data-tab={p.id} aria-selected={active} tabIndex={active ? 0 : -1} aria-label={`${displayName(p.name)}: ${pst.text}`} className="rail-item" data-tone={pst.tone} onClick={() => onSelect(p.id)}>
                <span className="rail-ring"><span className="rail-avatar">{initial(p.name)}</span><i className="rail-dot" aria-hidden="true" /></span>
                <span className="rail-name">{displayName(p.name)}</span>
              </button>
            );
          })}
        </div>
        {canAddMore && (
          <Link href="/onboarding" className="rail-item rail-add" aria-label={whatsappOnly ? 'Add a person' : 'Add a parent'}>
            <span className="rail-ring"><span className="rail-avatar"><Plus size={22} /></span></span>
            <span className="rail-name">Add</span>
          </Link>
        )}
      </div>
        );
      })()}
    </section>
  );
}
