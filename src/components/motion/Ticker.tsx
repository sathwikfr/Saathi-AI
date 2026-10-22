'use client';

import React, { useState } from 'react';
import { Pause, Play } from 'lucide-react';

type TickerItem = { icon?: React.ReactNode; text: string; sub?: string };

/** Endless horizontal ticker. Content is duplicated so the loop is seamless. `sub` adds a small second line under an item. A pause button (and hover / keyboard focus) stops it. */
export function Ticker({ items, label = 'Highlights', className }: { items: TickerItem[]; label?: string; className?: string }) {
  const [paused, setPaused] = useState(false);
  const row = (hidden: boolean) =>
    items.map((it, i) => (
      <span key={`${hidden ? 'b' : 'a'}${i}`} className="ticker-item" aria-hidden={hidden || undefined}>
        {it.icon}
        {it.sub ? <span className="ticker-text">{it.text}<small>{it.sub}</small></span> : it.text}
      </span>
    ));
  return (
    <div className={`ticker${className ? ` ${className}` : ''}`} role="region" aria-label={label} data-paused={paused || undefined}>
      <div className="ticker-viewport">
        <div className="ticker-track">
          {row(false)}
          {row(true)}
        </div>
      </div>
      <button type="button" className="ticker-pause" aria-label={paused ? `Play ${label}` : `Pause ${label}`} onClick={() => setPaused((p) => !p)}>
        {paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
      </button>
    </div>
  );
}
