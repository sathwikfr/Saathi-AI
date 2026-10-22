'use client';

import React from 'react';
import { CheckCircle2, PhoneMissed, PhoneOff, Clock, History, Download } from 'lucide-react';
import { ThinkingOrb } from '@/components/ui/ThinkingOrb';
import { CallLog } from '@/lib/types';
import { formatCallTime, formatDuration, moodLabel } from './helpers';

/** Saathi is on the call right now. */
function LiveCall() {
  return <ThinkingOrb state="listening" size={32} label="Call in progress" />;
}

function statusView(status: CallLog['status']) {
  if (status === 'answered') return { label: 'Answered', badge: 'badge-green', orb: 'good', Icon: CheckCircle2 };
  if (status === 'busy') return { label: 'Busy', badge: 'badge-amber', orb: 'warn', Icon: PhoneOff };
  if (status === 'placed') return { label: 'In progress', badge: 'badge-teal', orb: 'live', Icon: LiveCall };
  if (status === 'scheduled') return { label: 'Scheduled', badge: 'badge-neutral', orb: '', Icon: Clock };
  if (status === 'failed') return { label: 'Couldn’t connect', badge: 'badge-red', orb: 'warn', Icon: PhoneOff };
  return { label: 'Not answered', badge: 'badge-amber', orb: 'warn', Icon: PhoneMissed };
}

export function CallHistoryPanel({ parentName, callLogs, onExport }: { parentName: string; callLogs: CallLog[]; onExport: () => void }) {
  if (callLogs.length === 0) {
    return (
      <div className="panel empty">
        <span className="icon-tile"><History size={24} /></span>
        <h3>No calls yet</h3>
        <p>Every check-in call with {parentName} will be listed here, with a short summary of how it went.</p>
      </div>
    );
  }

  return (
    <section className="panel" aria-labelledby="history-title">
      <div className="panel-head">
        <div>
          <h3 id="history-title">Call history</h3>
          <p>{callLogs.length} call{callLogs.length === 1 ? '' : 's'} with {parentName}</p>
        </div>
        <button onClick={onExport} className="btn btn-ghost btn-sm">
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div>
        {callLogs.map((call) => {
          const v = statusView(call.status);
          const duration = formatDuration(call.durationSeconds);
          return (
            <article key={call.id} className="call-entry">
              <span className={`status-orb ${v.orb}`}><v.Icon size={20} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="call-entry-head">
                  <strong>{formatCallTime(call.createdAt || call.scheduledTime)}</strong>
                  <div className="call-entry-meta">
                    <span className={`badge ${v.badge}`}>{v.label}</span>
                    {call.status === 'answered' && (
                      <span className={`badge ${call.medicationConfirmed ? 'badge-green' : 'badge-red'}`}>
                        {call.medicationConfirmed ? 'Medicines taken' : 'Medicines not confirmed'}
                      </span>
                    )}
                  </div>
                </div>
                {call.summary && <p style={{ fontSize: '0.92rem', lineHeight: 1.55 }}>{call.summary}</p>}
                <div className="call-entry-meta" style={{ marginTop: '8px' }}>
                  {call.status === 'answered' && <span>Mood: {moodLabel(call.mood)}</span>}
                  {duration && <span>· {duration}</span>}
                  {call.actualAnswerTime && <span>· Picked up {call.actualAnswerTime}</span>}
                  {call.attemptNumber && call.attemptNumber > 1 && <span>· Attempt {call.attemptNumber}</span>}
                </div>
                {call.status === 'failed' && call.failureReason && (
                  <p style={{ fontSize: '0.84rem', color: 'var(--red)', marginTop: '6px' }}>{call.failureReason}</p>
                )}
                {call.notes && (
                  <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: '6px' }}>{call.notes}</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
