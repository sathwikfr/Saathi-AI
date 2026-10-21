'use client';

import React, { useEffect, useRef } from 'react';
import type { OrbMode } from '@/components/voice/SaathiOrb';

/**
 * Voice bars for behind Saathi's orb (not used on a page yet): a canvas with
 * thin mirrored audio bars running out of the orb to both sides, and a few
 * faint silk lines. Size the canvas to the orb's footprint (its height = 2 x
 * the orb's radius) and as wide as the screen.
 *
 * Calm at rest, alive on voice. Pass `voice`, a function returning the voice's
 * loudness 0..1 right now (e.g. from the orb), and the bars swell with it:
 *  - mode 'saathi' (and 'ringing'): the left side swells, each syllable
 *    travelling OUT from the orb, the way the orb's rings go out.
 *  - mode 'family': the right side swells, the syllables travelling IN
 *    towards the orb, like the orb's incoming rings.
 *  - mode 'thinking': a shimmer right next to the orb.
 * Paused offscreen; one still frame with reduced motion.
 */

type Side = 'saathi' | 'family';

// Bursts of speech along one side (centre 0 = at the orb .. 1 = the far end, width, height).
const BURSTS: Record<Side, [number, number, number][]> = {
  saathi: [[0.06, 0.08, 0.9], [0.3, 0.1, 1], [0.58, 0.09, 0.7], [0.84, 0.08, 0.45]],
  family: [[0.08, 0.08, 1], [0.36, 0.1, 0.8], [0.62, 0.08, 0.9], [0.86, 0.07, 0.4]],
};

// far left -> next to the orb (left) | next to the orb (right) -> far right
const COLORS = {
  day: { bars: ['#a9b8ff', '#5b5ef2', '#a24ff0', '#eaa6d2'], silkL: '91, 94, 242', silkR: '162, 79, 240' },
  night: { bars: ['#2f63e8', '#7f95ff', '#c27bff', '#f05cc0'], silkL: '143, 147, 255', silkR: '197, 139, 255' },
};

const HIST = 54;        // samples of loudness kept per side (~0.9 s): how long a syllable takes to cross a side
const HIST_DT = 1 / 60;

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function baseHeight(side: Side, d: number, i: number) {
  let v = 0;
  for (const [c, w, h] of BURSTS[side]) v += h * Math.exp(-(((d - c) / w) ** 2));
  return Math.min(1, v) * (0.55 + 0.45 * hash(i + (side === 'family' ? 97 : 0)));
}

type Props = {
  mode: OrbMode;
  dark: boolean;
  /** The voice's loudness right now, 0..1. */
  voice: () => number;
  /** Where the bars start, as a fraction of the orb's radius (just outside the ball). */
  inner?: number;
  /** The faint silk lines fanning out (off inside a small capsule). */
  silk?: boolean;
  className?: string;
};

export function HeroWaves({ mode, dark, voice, inner: innerAt = 0.98, silk = true, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const darkRef = useRef(dark);
  const voiceRef = useRef(voice);
  const innerRef = useRef(innerAt);
  const redraw = useRef<(() => void) | null>(null);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { darkRef.current = dark; redraw.current?.(); }, [dark]);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  useEffect(() => { innerRef.current = innerAt; redraw.current?.(); }, [innerAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0, H = 0, R = 0, cx = 0, cy = 0, step = 7;
    const hist: Record<Side, Float32Array> = { saathi: new Float32Array(HIST), family: new Float32Array(HIST) };
    let histAcc = 0;
    const st = { think: 0, talk: 0, last: 0 };
    const start = performance.now();

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2;
      cy = H / 2;
      R = H / 2;                       // the canvas is the orb's footprint
      step = W < 700 ? 5.5 : 7;
    };

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const dt = Math.min(0.05, Math.max(0, t - st.last));
      st.last = t;
      const m = modeRef.current;
      const night = darkRef.current;
      const pal = night ? COLORS.night : COLORS.day;
      const intro = reduced ? 1 : Math.min(1, t / 1.6);
      const grow = 1 - (1 - intro) ** 3;

      // Loudness history per side: Saathi (and the ringing) on the left, Amma on the right.
      const loud = reduced ? 0 : voiceRef.current();
      histAcc += dt;
      while (histAcc >= HIST_DT) {
        histAcc -= HIST_DT;
        hist.saathi.copyWithin(1, 0, HIST - 1);
        hist.family.copyWithin(1, 0, HIST - 1);
        hist.saathi[0] = m === 'saathi' || m === 'ringing' ? loud : 0;
        hist.family[0] = m === 'family' ? loud : 0;
      }
      const ease = (rate: number) => 1 - Math.exp(-dt * rate);
      st.think += ((m === 'thinking' ? 1 : 0) - st.think) * ease(6);
      // While a call plays the whole field lifts a little, and settles back after.
      st.talk += ((m === 'idle' || m === 'ended' ? 0 : 1) - st.talk) * ease(2);

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = night ? 'lighter' : 'source-over';

      const inner = R * innerRef.current;              // the bars start just outside the ball
      const outer = Math.min(cx - 12, inner + 560);    // and run out to here
      const span = Math.max(1, outer - inner);
      const maxH = Math.min(H * 0.5, R);

      /* Silk: three faint lines a side that gather into the orb. */
      for (const side of silk ? [-1, 1] : []) {
        const rgb = side < 0 ? pal.silkL : pal.silkR;
        for (let j = 0; j < 3; j++) {
          ctx.beginPath();
          for (let p = 0; p <= 1.0001; p += 0.02) {
            const x = cx + side * (inner * 0.95 + span * p);
            const fan = Math.pow(p, 1.3) * H * 0.34;
            const y = cy + fan * (0.8 * Math.sin(p * 3 + j * 1.1 + t * 0.18 + (side > 0 ? 1.9 : 0)) + (j - 1) * 0.12);
            if (p === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(${rgb}, ${(night ? 0.12 : 0.13) * intro})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      /* The bars (dots in the quiet stretches), both sides in one path. */
      const bars = new Path2D();
      const dots = new Path2D();
      const n = Math.max(2, Math.floor(span / step));
      const flick = Math.floor(t * 14);                // a voice's jitter, ~14 changes a second
      for (const side of ['saathi', 'family'] as Side[]) {
        const sgn = side === 'saathi' ? -1 : 1;
        const h = hist[side];
        for (let i = 0; i < n; i++) {
          const d = i / (n - 1);
          if (d > grow) break;
          // Saathi's syllables travel out from the orb; Amma's travel in towards it.
          const k = Math.round((side === 'saathi' ? d : 1 - d) * (HIST - 1));
          const v = h[k];
          const base = baseHeight(side, d, i);
          const breathe = reduced ? 0.45 : 0.4 + 0.1 * Math.sin(t * 1.1 - d * 6 + (side === 'family' ? 2 : 0)) + 0.12 * st.talk;
          const jitter = 0.6 + 0.8 * hash(i * 13 + flick + (side === 'family' ? 51 : 0));
          const think = st.think * Math.exp(-d * 7) * (0.3 + 0.2 * Math.sin(t * 6 - d * 20));
          const fade = Math.min(1, (1 - d) / 0.35);    // taper towards the far end
          const hh = maxH * fade * (base * breathe + v * (0.35 + 0.75 * base) * jitter + think);
          const x = cx + sgn * (inner + d * span);
          if (hh < 2.5) {
            dots.moveTo(x + 1, cy);
            dots.arc(x, cy, 1, 0, Math.PI * 2);
          } else {
            bars.moveTo(x, cy - hh / 2);
            bars.lineTo(x, cy + hh / 2);
          }
        }
      }
      const grad = ctx.createLinearGradient(cx - outer, 0, cx + outer, 0);
      grad.addColorStop(0, pal.bars[0]);
      // Clamp both ways: on a tiny canvas outer/inner go out of range and addColorStop throws, which kills the frame loop.
      const stop = (v: number) => Math.min(0.99, Math.max(0.01, Number.isFinite(v) ? v : 0.5));
      grad.addColorStop(stop((outer - inner) / (2 * outer)), pal.bars[1]);
      grad.addColorStop(stop((outer + inner) / (2 * outer)), pal.bars[2]);
      grad.addColorStop(1, pal.bars[3]);
      ctx.strokeStyle = grad;
      ctx.fillStyle = grad;
      ctx.lineCap = 'round';
      const bw = Math.max(1.8, step * 0.36);
      ctx.globalAlpha = night ? 0.14 : 0.08;           // a whisper of glow
      ctx.lineWidth = bw * 3;
      ctx.stroke(bars);
      ctx.globalAlpha = night ? 0.9 : 0.85;
      ctx.lineWidth = bw;
      ctx.stroke(bars);
      ctx.globalAlpha = 0.45;
      ctx.fill(dots);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    resize();
    let raf = 0;
    let visible = true;
    const loop = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      if (!reduced && visible && !document.hidden) raf = requestAnimationFrame(loop);
    };

    const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; run(); });
    io.observe(canvas);
    const onVis = () => run();
    document.addEventListener('visibilitychange', onVis);
    redraw.current = () => draw(performance.now());

    if (reduced) draw(performance.now() + 2000);
    else run();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      redraw.current = null;
    };
  }, [silk]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
