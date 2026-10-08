'use client';

import React, { useMemo } from 'react';
import { Download, LineChart, Sparkles } from 'lucide-react';
import { CallStats, moodLabel, callLogToFact, formatCallTime } from './helpers';
import { CountUp } from '@/components/motion/CountUp';
import { computeBaseline } from '@/lib/insightRules';
import { HealthInsight } from '@/lib/types';

type Props = { parentName: string; stats: CallStats; insights: HealthInsight[]; onExport: () => void };

export function TrendsPanel({ parentName, stats, insights, onExport }: Props) {
  const { completedCalls, adherencePct, reachabilityPct, answered30, last30, confirmed30, moodBreakdown, last7Days } = stats;
  // The parent's own normal (last 60 days before this week) vs this week: their "health twin".
  const base = useMemo(() => computeBaseline(completedCalls.map(callLogToFact), new Date()), [completedCalls]);
  const shownInsights = insights.filter(i => i.kind !== 'combined').slice(0, 6);

  if (completedCalls.length === 0) {
    return (
      <div className="panel empty">
        <span className="icon-tile"><LineChart size={24} /></span>
        <h3>No trends yet</h3>
        <p>Medicine, mood and pickup trends appear here after {parentName}&apos;s first few check-in calls.</p>
      </div>
    );
  }

  const topMood = moodBreakdown[0];

  return (
    <>
      <div className="stat-grid">
        <div className="stat">
          <span className="panel-label">Medicines taken</span>
          <div className="stat-value" style={{ color: 'var(--teal)' }}>{adherencePct === null ? '—' : <CountUp value={adherencePct} suffix="%" />}</div>
          <p>{confirmed30} of {answered30.length} answered calls, last 30 days</p>
          <div className="meter" aria-hidden="true"><i style={{ width: `${adherencePct ?? 0}%` }} /></div>
        </div>

        <div className="stat">
          <span className="panel-label">Picked up</span>
          <div className="stat-value" style={{ color: 'var(--green)' }}>{reachabilityPct === null ? '—' : <CountUp value={reachabilityPct} suffix="%" />}</div>
          <p>{answered30.length} of {last30.length} calls, last 30 days</p>
          <div className="meter" aria-hidden="true"><i style={{ width: `${reachabilityPct ?? 0}%`, background: 'var(--green)' }} /></div>
        </div>

        <div className="stat">
          <span className="panel-label">Usual mood</span>
          <div className="stat-value" style={{ color: 'var(--gold)', fontSize: '2rem', margin: '14px 0 10px' }}>
            {topMood ? moodLabel(topMood.mood) : '—'}
          </div>
          <p>
            {moodBreakdown.length
              ? moodBreakdown.map(m => `${m.pct}% ${moodLabel(m.mood).toLowerCase()}`).join(' · ')
              : 'No answered calls yet'}
          </p>
        </div>
      </div>

      {base.usual.answeredCalls >= 5 && (
        <section className="panel" aria-labelledby="usual-title">
          <div className="panel-head">
            <div>
              <h3 id="usual-title">This week vs {parentName}&apos;s usual</h3>
              <p>Compared with {parentName}&apos;s own last two months, not with anyone else.</p>
            </div>
          </div>
          <div className="kv">
            <div>
              <span>Picks up</span>
              <strong>{base.thisWeek.answerRatePct ?? '—'}% <small style={{ color: 'var(--ink-subtle)', fontWeight: 500 }}>usually {base.usual.answerRatePct ?? '—'}%</small></strong>
            </div>
            <div>
              <span>Takes medicines</span>
              <strong>{base.thisWeek.adherencePct ?? '—'}% <small style={{ color: 'var(--ink-subtle)', fontWeight: 500 }}>usually {base.usual.adherencePct ?? '—'}%</small></strong>
            </div>
            <div>
              <span>Mood</span>
              <strong>{moodLabel(base.thisWeek.usualMood || undefined)} <small style={{ color: 'var(--ink-subtle)', fontWeight: 500 }}>usually {moodLabel(base.usual.usualMood || undefined).toLowerCase()}</small></strong>
            </div>
            <div>
              <span>Often mentions</span>
              <strong>{base.usual.commonComplaints.map(c => c.label).join(', ') || 'Nothing in particular'}</strong>
            </div>
          </div>
        </section>
      )}

      {shownInsights.length > 0 && (
        <section className="panel" aria-labelledby="noticed-title">
          <div className="panel-head">
            <div>
              <h3 id="noticed-title"><Sparkles size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Noticed across calls</h3>
              <p>Patterns over several days. A nudge to check in, never a diagnosis.</p>
            </div>
          </div>
          <div className="list">
            {shownInsights.map(i => (
              <div key={i.id} className="list-row">
                <div className="row-main">
                  <div className="row-title">{i.title}</div>
                  <div className="row-sub" style={{ textTransform: 'none' }}>{i.message}</div>
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--ink-subtle)', whiteSpace: 'nowrap' }}>{formatCallTime(i.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel" aria-labelledby="week-title">
        <div className="panel-head">
          <div>
            <h3 id="week-title">The last 7 days</h3>
            <p>Share of calls each day where medicines were confirmed</p>
          </div>
          <button onClick={onExport} className="btn btn-ghost btn-sm">
            <Download size={14} /> Export CSV
          </button>
        </div>

        <div className="bars" role="img" aria-label="Medicines confirmed per day, last 7 days">
          {last7Days.map((bar, i) => (
            <div key={i} className="bar-col">
              <span className="pct">{bar.total ? `${bar.pct}%` : ''}</span>
              <div
                className={`bar ${!bar.total ? 'none' : bar.concern ? 'warn' : ''}`}
                style={{ height: bar.total ? `${Math.max(bar.pct, 6) * 1.5}px` : '4px', '--i': i } as React.CSSProperties}
              />
            </div>
          ))}
        </div>
        <div className="bar-days">
          {last7Days.map((bar, i) => (
            <div key={i}>
              <strong>{bar.day}</strong>
              <span>{bar.total ? (bar.mood ? moodLabel(bar.mood) : 'No answer') : 'No call'}</span>
            </div>
          ))}
        </div>

        <div className="legend" style={{ marginTop: '18px' }}>
          <span><i style={{ background: 'var(--teal)' }} />All good</span>
          <span><i style={{ background: 'var(--gold)' }} />Missed call or low mood</span>
          <span><i style={{ background: 'var(--line-subtle)' }} />No call</span>
        </div>
      </section>
    </>
  );
}
