'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ThinkingOrb as Orb, type OrbSize, type OrbState } from 'thinking-orbs';

/**
 * Dotted "Saathi is busy" indicator (thinking-orbs) for AI activity only: reading a prescription,
 * writing an answer, placing a call. Plain saves keep `.spinner`.
 *
 * The orb is tinted with the text colour around it, so it reads blue in a panel, white on a filled
 * button, and follows the light/dark toggle. The package only accepts #hex / rgb() colours, so the
 * computed `color` (always rgb()) is passed in rather than a CSS variable.
 */
export function ThinkingOrb({ state, size = 20, label, speed, className, style }: {
  state: OrbState;
  size?: OrbSize;
  /** Screen-reader text; defaults to the package's per-state label. */
  label?: string;
  speed?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [color, setColor] = useState<string>();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const read = () => setColor(getComputedStyle(host).color || undefined);
    read();
    const watch = new MutationObserver(read);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => watch.disconnect();
  }, []);

  return (
    <span
      ref={hostRef}
      className={className}
      style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0, verticalAlign: 'middle', ...style }}
    >
      {color && <Orb state={state} size={size} color={color} speed={speed} aria-label={label} />}
    </span>
  );
}
