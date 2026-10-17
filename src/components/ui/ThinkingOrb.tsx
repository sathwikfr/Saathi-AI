'use client';

import React from 'react';
import { SaathiGlass } from '@/components/voice/SaathiGlass';

export type OrbState = 'composing' | 'searching' | 'listening';

const LABELS: Record<OrbState, string> = { composing: 'Writing', searching: 'Reading', listening: 'On a call' };

/**
 * "Saathi is busy" indicator for AI activity only: reading a prescription, writing an answer, a
 * call in progress. Plain saves keep `.spinner`. A small SaathiGlass (the hero's dark glass orb):
 * writing and reading spin it up like 'thinking', a live call shows Saathi talking.
 */
export function ThinkingOrb({ state, size = 32, label, className, style }: {
  state: OrbState;
  size?: number;
  /** Screen-reader text; defaults to a short per-state label. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      role="img"
      aria-label={label ?? LABELS[state]}
      className={className}
      style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0, verticalAlign: 'middle', ...style }}
    >
      {/* ponytail: one WebGL context per orb (browsers allow ~16); fine for the 1-2 on screen, share a canvas if a list ever shows many */}
      <SaathiGlass mode={state === 'listening' ? 'saathi' : 'thinking'} radius={0.94} interactive={false} />
    </span>
  );
}
