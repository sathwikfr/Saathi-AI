'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Small time-series line chart (plain SVG, no library) for readings.
 * One y-axis, 2px lines, dots with a surface ring, hairline grid, optional
 * reference lines (the family's limits), crosshair + tooltip on hover and
 * arrow keys. Colors come from the --chart-* tokens; text stays in ink tokens.
 */
export type ChartPoint = { t: number; v: number; note?: string };
export type ChartSeries = { key: string; label: string; color: string; points: ChartPoint[] };
export type ChartRefLine = { v: number; label: string };

const DAY = 86400000;
const M = { top: 14, right: 48, bottom: 28, left: 40 };

function niceStep(range: number, target: number) {
  const raw = Math.max(range, 1) / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

const dateLabel = (t: number) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const fullLabel = (t: number) =>
  new Date(t).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export function LineChart({ series, refLines = [], unit, height = 220, ariaLabel }: {
  series: ChartSeries[];
  refLines?: ChartRefLine[];
  unit: string;
  height?: number;
  ariaLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setWidth(Math.max(260, Math.round(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const times = useMemo(() => [...new Set(series.flatMap(s => s.points.map(p => p.t)))].sort((a, b) => a - b), [series]);

  const geo = useMemo(() => {
    if (!times.length) return null;
    let tMin = times[0];
    let tMax = times[times.length - 1];
    if (tMax - tMin < DAY) {
      tMin -= DAY;
      tMax += DAY;
    }
    const values = [...series.flatMap(s => s.points.map(p => p.v)), ...refLines.map(r => r.v)];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max(5, (hi - lo) * 0.12);
    const step = niceStep(hi - lo + 2 * pad, height < 200 ? 3 : 4);
    const yMin = Math.max(0, Math.floor((lo - pad) / step) * step);
    const yMax = Math.ceil((hi + pad) / step) * step;
    const w = width - M.left - M.right;
    const h = height - M.top - M.bottom;
    const x = (t: number) => M.left + ((t - tMin) / (tMax - tMin)) * w;
    const y = (v: number) => M.top + (1 - (v - yMin) / (yMax - yMin)) * h;
    const yTicks: number[] = [];
    for (let v = yMin; v <= yMax + 1e-9; v += step) yTicks.push(Math.round(v * 10) / 10);
    const n = width < 420 ? 3 : 5;
    const xTicks = Array.from({ length: n }, (_, i) => tMin + ((tMax - tMin) * i) / (n - 1));
    return { x, y, yTicks, xTicks, w, h };
  }, [times, series, refLines, width, height]);

  if (!geo) return null;
  const { x, y, yTicks, xTicks } = geo;

  // Direct end labels only when they don't collide; the legend always carries identity.
  const ends = series
    .filter(s => s.points.length)
    .map(s => ({ s, last: s.points[s.points.length - 1] }));
  const endsCollide = ends.some((a, i) => ends.some((b, j) => j > i && Math.abs(y(a.last.v) - y(b.last.v)) < 14));

  const nearest = (px: number) => {
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(x(times[i]) - px) < Math.abs(x(times[best]) - px)) best = i;
    return best;
  };

  const hoverT = hover !== null ? times[hover] : null;
  const hoverRows = hoverT !== null
    ? series.map(s => ({ s, p: s.points.find(p => p.t === hoverT) })).filter((r): r is { s: ChartSeries; p: ChartPoint } => !!r.p)
    : [];
  const tipLeft = hoverT !== null ? x(hoverT) : 0;
  const tipOnLeft = tipLeft > width / 2;

  return (
    <div
      ref={wrapRef}
      className="lc"
      tabIndex={0}
      role="img"
      aria-label={ariaLabel}
      onFocus={() => setHover(times.length - 1)}
      onBlur={() => setHover(null)}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') setHover(h => Math.max(0, (h ?? times.length) - 1));
        else if (e.key === 'ArrowRight') setHover(h => Math.min(times.length - 1, (h ?? -1) + 1));
        else return;
        e.preventDefault();
      }}
    >
      <svg width={width} height={height} aria-hidden="true">
        {yTicks.map(v => (
          <g key={v}>
            <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} className="lc-grid" />
            <text x={M.left - 8} y={y(v) + 4} textAnchor="end" className="lc-tick">{v}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={t} x={x(t)} y={height - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} className="lc-tick">
            {dateLabel(t)}
          </text>
        ))}
        {refLines.map(r => (
          <g key={`${r.label}-${r.v}`}>
            <line x1={M.left} x2={width - M.right} y1={y(r.v)} y2={y(r.v)} className="lc-ref" />
            <text x={M.left + 6} y={y(r.v) - 5} className="lc-ref-label">{r.label}</text>
          </g>
        ))}
        {hoverT !== null && <line x1={x(hoverT)} x2={x(hoverT)} y1={M.top} y2={height - M.bottom} className="lc-cross" />}
        {series.map(s => (
          <g key={s.key}>
            {s.points.length > 1 && (
              <polyline
                points={s.points.map(p => `${x(p.t)},${y(p.v)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {s.points.map(p => (
              <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={p.t === hoverT ? 6 : 4} fill={s.color} className="lc-dot" />
            ))}
          </g>
        ))}
        {!endsCollide && ends.map(({ s, last }) => (
          <text key={s.key} x={x(last.t) + 9} y={y(last.v) + 4} className="lc-end">{Math.round(last.v)}</text>
        ))}
        <rect
          x={M.left}
          y={0}
          width={Math.max(0, width - M.left - M.right)}
          height={height}
          fill="transparent"
          onPointerMove={e => {
            const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
            setHover(nearest(e.clientX - r.left));
          }}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hoverT !== null && hoverRows.length > 0 && (
        <div
          className="lc-tip"
          style={tipOnLeft ? { right: width - tipLeft + 12, top: 8 } : { left: tipLeft + 12, top: 8 }}
        >
          <div className="lc-tip-when">{fullLabel(hoverT)}</div>
          {hoverRows.map(({ s, p }) => (
            <div key={s.key} className="lc-tip-row">
              <i style={{ background: s.color }} />
              <strong>{Math.round(p.v)}</strong>
              <span>{series.length > 1 ? s.label : unit}</span>
            </div>
          ))}
          {hoverRows.map(r => r.p.note).filter(Boolean).slice(0, 1).map(n => (
            <div key={n} className="lc-tip-note">{n}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Legend with line keys (mirrors the marks). Only for two or more series. */
export function ChartLegend({ series }: { series: Pick<ChartSeries, 'key' | 'label' | 'color'>[] }) {
  if (series.length < 2) return null;
  return (
    <div className="lc-legend">
      {series.map(s => (
        <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
      ))}
    </div>
  );
}
