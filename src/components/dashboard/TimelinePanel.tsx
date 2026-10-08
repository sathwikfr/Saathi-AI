'use client';

import React, { useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { CallLog, AlertRecord, HealthInsight } from '@/lib/types';
import { buildTimeline } from '@/lib/timeline';

type Props = { parentName: string; callLogs: CallLog[]; alerts: AlertRecord[]; insights: HealthInsight[] };

const RANGES = [
  { days: 7, label: 'Week' },
  { days: 30, label: 'Month' },
  { days: 90, label: '3 months' }
];

/** Day-by-day health timeline with a one-line journal per day, built only from what was said on the calls. */
export function TimelinePanel({ parentName, callLogs, alerts, insights }: Props) {
  const [days, setDays] = useState(30);
  const timeline = useMemo(() => buildTimeline(parentName, callLogs, alerts, insights, { days }), [parentName, callLogs, alerts, insights, days]);

  return (
    <section className="panel" aria-labelledby="timeline-title">
      <div className="panel-head">
        <div>
          <h3 id="timeline-title">{parentName}&apos;s days</h3>
          <p>A short journal from each day&apos;s calls: medicines, mood and anything {parentName} mentioned.</p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="How far back">
          {RANGES.map(r => (
            <button key={r.days} type="button" role="radio" aria-checked={days === r.days} className={days === r.days ? 'active' : ''} onClick={() => setDays(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {timeline.length === 0 ? (
        <div className="empty" style={{ padding: '32px 16px' }}>
          <span className="icon-tile"><BookOpen size={24} /></span>
          <h3>Nothing here yet</h3>
          <p>Each day with a call gets an entry here, so after a few weeks you can see how {parentName} has really been.</p>
        </div>
      ) : (
        <div className="day-list">
          {timeline.map(day => (
            <article key={day.date} className="day-item">
              <time dateTime={day.date}>
                {day.label}
                <small>{day.callCount ? `${day.callCount} call${day.callCount === 1 ? '' : 's'}` : ''}</small>
              </time>
              <div>
                {day.chips.length > 0 && (
                  <div className="chip-row">
                    {day.chips.map((c, i) => <span key={i} className={`chip ${c.tone}`}>{c.text}</span>)}
                  </div>
                )}
                {day.journal && <p>{day.journal}</p>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
