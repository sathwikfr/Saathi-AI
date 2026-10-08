'use client';

import React from 'react';
import {
  Check, CheckCircle2, AlertTriangle, Clock, PhoneCall, Pause, Play, Users, Plus, Pill, ChevronRight, Smile, PhoneMissed
} from 'lucide-react';
import { ParentProfile, Medicine } from '@/lib/types';
import {
  CallStats, formatCallTime, formatDuration, moodLabel, foodRelationLabel, shortSlotLabel, displayName, isTestCall, slotOutcome
} from './helpers';

type Props = {
  parent: ParentProfile;
  medicines: Medicine[];
  stats: CallStats;
  testCalling: boolean;
  onTestCall: () => void;
  onPause: () => void;
  onResume: () => void;
  onInvite: () => void;
  onAddMedicine: () => void;
  onOpenMedicines: () => void;
  /** Owner or co-manager (viewers only see the day). */
  manage?: boolean;
  isOwner?: boolean;
};

export function OverviewPanel({
  parent, medicines, stats, testCalling, onTestCall, onPause, onResume, onInvite, onAddMedicine, onOpenMedicines, manage = true, isOwner = true
}: Props) {
  const { latestToday, todayCalls, activeSlots, nextSlot, now } = stats;
  const name = displayName(parent.name);
  const answered = latestToday?.status === 'answered';
  const tone = latestToday ? (answered && latestToday.medicationConfirmed ? 'good' : 'warn') : '';
  const activeMeds = medicines.filter(m => m.isActive);

  return (
    <div className="panel-grid">
      <div>
        {/* TODAY */}
        <section className={`panel today ${tone}`} aria-labelledby="today-title">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <span className="panel-label" id="today-title">Today</span>
            <span style={{ fontSize: '0.84rem', color: 'var(--ink-subtle)' }}>
              {now.toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' })}
            </span>
          </div>

          {latestToday ? (
            <>
              <div className="today-status">
                <span className={`status-orb ${answered ? 'good' : 'warn'}`}>
                  {answered ? <CheckCircle2 size={28} /> : <PhoneMissed size={26} />}
                </span>
                <div>
                  <h3>
                    {answered
                      ? `${name} picked up`
                      : latestToday.status === 'busy'
                        ? 'The line was busy'
                        : latestToday.status === 'failed'
                          ? 'The call couldn’t connect'
                          : `${name} didn’t pick up`}
                  </h3>
                  <p>
                    {formatCallTime(latestToday.createdAt || latestToday.scheduledTime)}
                    {formatDuration(latestToday.durationSeconds) && ` · ${formatDuration(latestToday.durationSeconds)}`}
                    {isTestCall(latestToday) && <span className="badge badge-neutral">Test call</span>}
                  </p>
                </div>
              </div>

              {latestToday.summary && <div className="summary-box">{latestToday.summary}</div>}

              {answered && (
                <div className="fact-grid">
                  <div className="fact">
                    <span>Medicines</span>
                    <strong style={{ color: latestToday.medicationConfirmed ? 'var(--green)' : 'var(--red)' }}>
                      {latestToday.medicationConfirmed ? <><CheckCircle2 size={16} /> Taken</> : <><AlertTriangle size={16} /> Not confirmed</>}
                    </strong>
                  </div>
                  <div className="fact">
                    <span>Mood</span>
                    <strong><Smile size={16} color="var(--gold)" /> {moodLabel(latestToday.mood)}</strong>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="today-status" style={{ marginBottom: 0 }}>
              <span className="status-orb"><Clock size={26} /></span>
              <div>
                <h3>No check-in yet today</h3>
                <p>
                  {parent.isPaused
                    ? 'Calls are paused.'
                    : nextSlot
                      ? `Next call at ${nextSlot.time} · ${shortSlotLabel(nextSlot.label)}`
                      : activeSlots.length > 0
                        ? `Next call tomorrow at ${activeSlots[0].time}`
                        : 'No call times are set up yet.'}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* SCHEDULE */}
        <section className="panel" aria-labelledby="schedule-title">
          <div className="panel-head">
            <div>
              <h3 id="schedule-title">Daily check-ins</h3>
              <p>{activeSlots.length ? `${activeSlots.length} call${activeSlots.length === 1 ? '' : 's'} a day, ${parent.timezone}` : 'No calls scheduled'}</p>
            </div>
          </div>

          {activeSlots.length === 0 ? (
            <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)' }}>Add a medicine or a call time to start daily check-ins.</p>
          ) : (
            <ol className="timeline">
              {activeSlots.map((slot, idx) => {
                const nextIdx = nextSlot ? activeSlots.indexOf(nextSlot) : activeSlots.length;
                const isNext = !parent.isPaused && idx === nextIdx;
                const isPast = idx < nextIdx;
                const meds = slot.linkedMedicines?.map(m => m.name) || slot.linkedMedicineNames || [];
                const outcome = slotOutcome(todayCalls, slot.id, isPast);
                const state = outcome && outcome.tone !== 'muted' ? outcome.tone : isNext ? 'next' : isPast ? 'past' : '';
                return (
                  <li key={slot.id} className={state}>
                    <time>{slot.time}</time>
                    <span className="node" aria-hidden="true">
                      {outcome?.tone === 'good' && <Check size={10} strokeWidth={3.5} />}
                    </span>
                    <div>
                      <strong>
                        {shortSlotLabel(slot.label)}
                        {isNext && !outcome && <span className="badge badge-teal">Next</span>}
                        {outcome && <span className={`slot-outcome ${outcome.tone}`}>{outcome.text}</span>}
                      </strong>
                      {meds.length > 0 ? (
                        <span className="med-chips">
                          {meds.slice(0, 3).map((m) => <span key={m}><Pill size={11} /> {displayName(m)}</span>)}
                          {meds.length > 3 && <span className="more">+{meds.length - 3} more</span>}
                        </span>
                      ) : (
                        <small>Wellbeing check-in</small>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <div>
        {/* ACTIONS */}
        {manage && <section className="panel" aria-labelledby="actions-title">
          <div className="panel-head" style={{ marginBottom: '12px' }}>
            <h3 id="actions-title">Quick actions</h3>
          </div>
          <div className="action-list">
            <button type="button" className="action" onClick={onTestCall} disabled={testCalling}>
              <span className="icon-tile"><PhoneCall size={17} /></span>
              <span>
                {testCalling ? 'Requesting…' : 'Request a test call'}
                <small>Hear what Saathi sounds like</small>
              </span>
              <ChevronRight size={16} />
            </button>

            {parent.isPaused ? (
              <button type="button" className="action" onClick={onResume}>
                <span className="icon-tile" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}><Play size={17} /></span>
                <span>
                  Resume calls
                  <small>Start daily check-ins again</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ) : (
              <button type="button" className="action" onClick={onPause}>
                <span className="icon-tile gold"><Pause size={17} /></span>
                <span>
                  Pause calls
                  <small>Travel, a hospital stay, a visit to you</small>
                </span>
                <ChevronRight size={16} />
              </button>
            )}

            {isOwner && (
              <button type="button" className="action" onClick={onInvite}>
                <span className="icon-tile"><Users size={17} /></span>
                <span>
                  Invite a sibling
                  <small>Share the care with family</small>
                </span>
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        </section>}

        {/* MEDICINES */}
        <section className="panel" aria-labelledby="meds-title">
          <div className="panel-head" style={{ marginBottom: '12px' }}>
            <h3 id="meds-title">Medicines</h3>
            {manage && (
              <button type="button" onClick={onAddMedicine} className="btn btn-ghost btn-sm">
                <Plus size={14} /> Add
              </button>
            )}
          </div>

          {activeMeds.length === 0 ? (
            <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)' }}>No medicines yet. Saathi will just ask how {name} is doing.</p>
          ) : (
            <div className="list" style={{ gap: '8px' }}>
              {activeMeds.slice(0, 5).map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="icon-tile" style={{ width: '34px', height: '34px', borderRadius: '10px' }}><Pill size={15} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                      {displayName(m.name)}
                      {m.dosage && <span style={{ fontWeight: 400, color: 'var(--ink-subtle)' }}> · {m.dosage}</span>}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-subtle)' }}>
                      {m.timeOfDay.charAt(0).toUpperCase() + m.timeOfDay.slice(1)}{foodRelationLabel(m.foodRelation) ? ` · ${foodRelationLabel(m.foodRelation)}` : ''}
                    </div>
                  </div>
                </div>
              ))}
              {medicines.length > 0 && (
                <button type="button" className="link-btn" onClick={onOpenMedicines} style={{ justifySelf: 'start', marginTop: '6px', fontSize: '0.88rem' }}>
                  Manage all medicines
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
