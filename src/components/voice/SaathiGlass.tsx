'use client';

import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { syllables, type OrbMode, type SaathiOrbHandle } from './SaathiOrb';
import { link, madeUp, plan, sample, settle, spring, wordBits, type Seg } from './SaathiBlob';

/**
 * Saathi's orb as a dark glass ball with a voice wave inside, like the Siri orb (ported from
 * the "Glass Liquid" Siri preset the user picked, 2026-10-17).
 *
 * - Inside: a hot white crest across the middle, with four colour bands (gold, cyan, pink,
 *   violet) fanning out above and below it. They fade out toward the left and right edges
 *   and drift sideways.
 * - Glass: the rim bends the wave the way a lens would, with each colour bent a little
 *   differently, so the edge has a rainbow fringe. There is a thin bright rim (cool at the
 *   top right, warm at the bottom left), a key light at the top left and a soft shadow below.
 * - Voice: each word is played as a loudness level (SaathiBlob's word-to-sounds code). It
 *   speeds the wave up, spreads the bands, wobbles the outline and brightens the glass,
 *   syllable by syllable. Colours lean cyan while Saathi talks and pink for the family.
 *   'thinking' turns vivid and fast within 220 ms and settles back over 650 ms; 'ringing'
 *   pulses on every ring; 'ended' dims.
 * - Touch (`interactive`): the key light and the rim swing toward the pointer, the outline
 *   bulges toward it, the crest reaches for it, and the ball leans a little. Fast moves
 *   wobble it, a press dents it, and letting go springs it back with a ripple. A drag never
 *   counts as a tap.
 *
 * The ball is dark in both themes, by the user's choice. Same ref handle as SaathiBlob.
 * Raw WebGL1, one full-screen triangle. Paused offscreen. Reduced motion: one still frame.
 */

type Look = {
  speed: number; zoom: number; warp: number; ridge: number; shade: number; sheen: number; gloss: number;
  midA: number; edgeA: number; exposure: number; glassOp: number; edgeGlow: number;
  A: number[]; B: number[]; C: number[]; D: number[]; hi: number[]; inner: number[]; mid: number[]; edge: number[];
  sheenC: number[]; spec: number[]; canvas: number[]; glow: number[];
};
const SCALARS = ['speed', 'zoom', 'warp', 'ridge', 'shade', 'sheen', 'gloss', 'midA', 'edgeA', 'exposure', 'glassOp', 'edgeGlow'] as const;
const COLORS = ['A', 'B', 'C', 'D', 'hi', 'inner', 'mid', 'edge', 'sheenC', 'spec', 'canvas', 'glow'] as const;

// The reference's "thinking" seed: vivid gold / cyan / pink / violet.
const THINKING: Look = {
  speed: 0.82, zoom: 0.36, warp: 3.2, ridge: 0.5, shade: 0.12, sheen: 0.28, gloss: 0.24, midA: 0.18, edgeA: 0.18,
  exposure: 2, glassOp: 0.44, edgeGlow: 0.1,
  A: [1, 0.847, 0.42], B: [0.51, 0.957, 1], C: [1, 0.482, 0.835], D: [0.557, 0.424, 1],
  hi: [1, 1, 1], inner: [1, 1, 1], mid: [0.608, 0.957, 1], edge: [0.773, 0.663, 1],
  sheenC: [0.918, 0.957, 1], spec: [0.863, 0.918, 1], canvas: [0.012, 0.016, 0.035], glow: [0.584, 0.424, 1],
};
// At rest: the same colours (the look in the user's screenshot), slower and a little softer.
const IDLE: Look = { ...THINKING, speed: 0.3, zoom: 0.34, warp: 1.9, ridge: 0.3, exposure: 1.7 };
const LOOKS: Record<OrbMode, Look> = {
  idle: IDLE,
  thinking: THINKING,
  // Saathi talking: the inner bands lean sky blue, the outer one blue-violet.
  saathi: { ...THINKING, speed: 0.55, C: [0.42, 0.8, 1], D: [0.4, 0.5, 1], glow: [0.36, 0.7, 1] },
  // The family talking: the bands lean pink and peach.
  family: { ...THINKING, speed: 0.5, A: [1, 0.66, 0.52], B: [1, 0.56, 0.8], glow: [1, 0.45, 0.75] },
  ringing: { ...THINKING, speed: 0.6 },
  ended: { ...IDLE, speed: 0.12, exposure: 1.05, edgeGlow: 0.03 },
};

const VERT = `
attribute vec2 aQ;
void main() { gl_Position = vec4(aQ, 0.0, 1.0); }`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uSize; uniform float uT; uniform float uRadius; uniform vec2 uShift;
uniform float uZoom; uniform float uWarp; uniform float uRidge; uniform float uShade; uniform float uSheen; uniform float uGloss;
uniform float uMidA; uniform float uEdgeA; uniform float uExposure; uniform float uGlassOp; uniform float uEdgeGlow; uniform float uContour;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec3 uD; uniform vec3 uHi; uniform vec3 uInner; uniform vec3 uMid; uniform vec3 uEdge;
uniform vec3 uSheenC; uniform vec3 uSpec; uniform vec3 uCanvas; uniform vec3 uGlow;
uniform vec2 uPtr; uniform float uNear; uniform float uReach; uniform float uPress; uniform vec2 uKey;
uniform vec3 uRip; uniform float uRipAmp;   // ripple: direction (xy) and age (z); its strength
uniform float uDay;                         // 1 on light pages: a dark outer edge, the rim lights just inside it

vec2 siriBand(vec2 q, float drift, float ph, float amp, float mainY, float env, float soft) {
  float y = amp * env * sin(q.x + drift + ph);
  float d = abs(q.y - y);
  float line = 0.018 / (sqrt(d * d + soft * soft) + 0.026);
  float bd = max(0.0, max(q.y - max(mainY, y), min(mainY, y) - q.y));
  return vec2(line, 0.018 / (bd + 0.075));
}

// The wave inside, at a point in ball space (|p| = 1 on the rim).
vec3 fluid(vec2 p) {
  vec2 q = p / (0.74 + uZoom * 0.34);
  float t = uT;
  // the crest reaches for the pointer
  q.y -= uReach * exp(-(q.x - uPtr.x) * (q.x - uPtr.x) * 2.5);
  float eb = cos(1.5707963 * min(abs(0.9 * q.x), 1.0));
  float env = eb * eb;
  float low = 0.5 + 0.5 * cos(t * 0.37);
  float mid = 0.5 + 0.5 * sin(t * 0.51 + 1.2);
  float high = 0.5 + 0.5 * cos(t * 0.73 + 2.1);
  float drift = t * 2.4;
  float mainAmp = 0.25 + uRidge * 0.075 + low * 0.018;
  float bandAmp = mainAmp + mid * 0.025 + high * 0.018;
  float mainY = mainAmp * env * sin(q.x * 1.1 + drift);
  float sep = 1.85 + uWarp * 0.2 + mid * 0.28;
  float soft = 0.035 + (1.0 - uRidge) * 0.018 + mid * 0.006;
  vec2 b0 = siriBand(q, drift, -sep, bandAmp, mainY, env, soft);
  vec2 b1 = siriBand(q, drift, -sep * 0.34, bandAmp, mainY, env, soft);
  vec2 b2 = siriBand(q, drift, sep * 0.34, bandAmp, mainY, env, soft);
  vec2 b3 = siriBand(q, drift, sep, bandAmp, mainY, env, soft);
  float w0 = b0.x + b0.y; float w1 = b1.x + b1.y; float w2 = b2.x + b2.y; float w3 = b3.x + b3.y;
  float d0 = w0 * w0; float d1 = w1 * w1; float d2 = w2 * w2; float d3 = w3 * w3;
  vec3 spectral = (uA * d0 + uC * d1 + uB * d2 + uD * d3) / max(d0 + d1 + d2 + d3, 0.0001);
  float energy = (1.0 - exp(-(w0 + w1 + w2 + w3) * 0.58)) * env;
  float md = abs(q.y - mainY);
  float core = exp(-md * md / 0.0028) * env;
  vec3 col = mix(uD, uB, smoothstep(-0.7, 0.7, q.y)) * 0.018 + spectral * energy * 1.14 + uHi * core * (0.18 + 0.1 * low);
  col = col / (vec3(1.0) + col * 0.18);
  // the glass's own light and shade over the fluid
  col = mix(col, uHi, uShade * 0.22 * smoothstep(0.15, 1.15, dot(p, vec2(-0.32, 0.78))));
  col *= 1.0 - uShade * 0.34 * smoothstep(-0.1, 1.2, dot(p, vec2(0.45, -0.62)));
  col *= 1.0 - uShade * 0.22 * smoothstep(0.72, 1.08, length(p));
  return clamp(col, 0.0, 1.0);
}

// The outline's radius at angle a (canvas units): a slow wobble, a bulge toward the pointer, a press, a ripple.
float contourR(float a) {
  float t = uT;
  float wave = sin(a * 3.0 + t * 0.62) * 0.52 + sin(a * 5.0 - t * 0.41 + 1.7) * 0.31 + sin(a * 2.0 + t * 0.23 + 3.1) * 0.17;
  vec2 dir = vec2(cos(a), sin(a));
  float toward = max(dot(dir, normalize(uPtr + vec2(1e-4))), 0.0);
  float bulge = uNear * 0.045 * pow(toward, 6.0);
  float rip = uRipAmp * 0.05 * sin(uRip.z * 22.0 - 2.0) * exp(-uRip.z * 4.5) * (0.55 + 0.45 * dot(dir, uRip.xy));
  return uRadius * (1.0 + uContour * 0.09 * wave + bulge + rip - uPress * 0.045);
}

float lobe(vec2 n, vec2 d, float cut, float pw) {
  return pow(clamp((dot(n, d) - cut) / max(1.0 - cut, 0.001), 0.0, 1.0), pw);
}
vec3 over(vec3 dst, vec3 src, float a) { float k = clamp(a, 0.0, 1.0); return src * k + dst * (1.0 - k); }

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uSize) / min(uSize.x, uSize.y) - uShift;
  float dist = length(uv);
  float a = atan(uv.y, uv.x);
  float cR = contourR(a);
  // fade to nothing at the canvas edge
  vec2 qf = (2.0 * gl_FragCoord.xy - uSize) / uSize;
  float fit = 1.0 - smoothstep(min(mix(cR, 1.0, 0.5), 0.99), 1.0, max(abs(qf.x), abs(qf.y)));
  float glow = uEdgeGlow * exp(-max(dist - cR, 0.0) * 11.0) * smoothstep(cR - 0.004, cR + 0.004, dist);
  if (dist > cR * 1.012) {
    vec3 h = clamp(uGlow * glow, 0.0, 1.0) * fit;
    gl_FragColor = vec4(h, max(h.r, max(h.g, h.b)));
    return;
  }
  vec2 p = uv / cR;
  float pd = length(p);
  float clearFa = 1.0 - smoothstep(0.995, 1.04, pd);
  // the outline's normal (from its slope) for the lens and the rim lights
  vec2 radial = dist > 1e-4 ? uv / dist : vec2(0.0, 1.0);   // (the exact centre has no direction)
  vec2 tangent = vec2(-radial.y, radial.x);
  float dR = (contourR(a + 0.01) - contourR(a - 0.01)) / 0.02;
  vec2 n = normalize(radial - tangent * dR / max(dist, 1e-3));

  // the lens: near the rim the wave is seen bent inward, each colour a little differently
  float edgeDepth = max(1.0 - pd, 0.0);
  float rt = clamp(edgeDepth / (0.015 + 0.95 * clamp(uMidA, 0.0, 1.0)), 0.0, 1.0);
  float prof = pow(1.0 - sqrt(max(1.0 - (1.0 - rt) * (1.0 - rt), 0.0)), 0.68);
  vec2 rp = p - n * (1.6 * uGlassOp * prof);
  float split = 0.14 * clamp(uGloss, 0.0, 2.0) * uGlassOp * prof;
  vec3 col = vec3(fluid(rp - n * split).r, fluid(rp).g, fluid(rp + n * split).b);

  float lum = dot(col, vec3(0.213, 0.715, 0.072));
  vec3 sat = clamp(vec3(lum) + (col - vec3(lum)) * 1.22, 0.0, 1.0);
  vec3 c = over(uCanvas, sat, 0.99 * clearFa);

  // the glass rim: a thin bright arc, cool and warm light split, a shadow below, key and fill lights
  // (on a light page a white rim at the very edge would melt into the page, so it moves in a little)
  float lip = 0.016 * uDay;
  float band = (1.0 - smoothstep(0.0, 0.026 + 0.055 * clamp(uEdgeA, 0.0, 1.0), max(edgeDepth - lip, 0.0))) * clearFa;
  float rim = pow(band, 1.8);
  c = over(c, uInner, rim * uGlassOp * 0.45);
  float disp = rim * clamp(uGloss, 0.0, 2.0) * (0.8 + 0.8 * uEdgeA);
  c = over(c, uMid, disp * lobe(n, normalize(vec2(0.84, 0.54)), -0.32, 1.8));
  c = over(c, uEdge, disp * lobe(n, normalize(vec2(-0.62, -0.78)), -0.28, 2.0));
  c *= 1.0 - rim * (0.015 + 0.15 * uEdgeA) * (0.15 + 0.85 * max(dot(n, vec2(0.45, -0.89)), 0.0));
  float sh = clamp(uSheen, 0.0, 2.0);
  c = over(c, uSheenC, rim * lobe(n, uKey, 0.2, 2.8) * sh * 1.4);
  c = over(c, uSpec, rim * lobe(n, -uKey, 0.4, 3.6) * sh);
  c = mix(c, uCanvas * 0.6, uDay * (1.0 - smoothstep(lip * 0.3, lip, edgeDepth)));

  float ballA = 1.0 - smoothstep(0.99, 1.01, pd);
  c = clamp(c * uExposure, 0.0, 1.0) * ballA + uGlow * glow;
  c = clamp(c, 0.0, 1.0);
  float alpha = max(ballA, max(c.r, max(c.g, c.b)));
  gl_FragColor = vec4(c * fit, alpha * fit);
}`;

// Colours blend in linear light, like the reference, so a change doesn't go muddy halfway.
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

type Props = {
  mode?: OrbMode;
  /** Ball radius as a fraction of the canvas half-size (default 0.87). */
  radius?: number;
  /** Pointer play (lean, bulge, press, ripple). Off for the small busy orbs. */
  interactive?: boolean;
  className?: string;
  ref?: React.Ref<SaathiOrbHandle>;
};

export function SaathiGlass({ mode = 'idle', radius = 0.87, interactive = true, className, ref }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const radiusRef = useRef(radius);
  const engine = useRef({
    mode: 'idle' as OrbMode,
    rings: [] as number[],
    now: 0,
    word: { at: -10, end: -10, segs: [] as Seg[] },
    lastSay: -10,
    levelAt: -10,
    level: 0,
    loud: 0,
    redraw: null as null | (() => void),
  });

  useImperativeHandle(ref, () => ({
    setMode: (m) => { engine.current.mode = m; engine.current.redraw?.(); },
    pulse: () => {
      const e = engine.current;
      e.word = { at: e.now, end: e.now + 0.22, segs: plan([{ k: 'stop', len: 1 }, { k: 'vowel', len: 1 }], 0.22) };
    },
    say: (word, seconds) => {
      const e = engine.current;
      const dur = seconds ?? Math.min(1.1, 0.1 + 0.17 * syllables(word));
      e.word = { at: e.now, end: e.now + dur, segs: plan(wordBits(word), dur) };
      e.lastSay = e.now;
    },
    level: (v) => {
      const e = engine.current;
      e.level = Math.max(0, Math.min(1, v));
      e.levelAt = e.now;
    },
    echo: () => { engine.current.rings.push(engine.current.now); },
    loudness: () => engine.current.loud,
  }));

  useEffect(() => { engine.current.mode = mode; engine.current.redraw?.(); }, [mode]);
  useEffect(() => { radiusRef.current = radius; engine.current.redraw?.(); }, [radius]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true });
    const prog = gl && link(gl, VERT, FRAG);
    if (!gl || !prog) {
      // No WebGL: a still dark glass ball with a glow line, so there's never a hole in the page.
      canvas.dataset.fallback = 'true';
      canvas.style.borderRadius = '50%';
      canvas.style.background = `radial-gradient(ellipse 60% 9% at 50% 50%, #fff 0, #ff7bd5 35%, #8e6cff 60%, transparent 100%),
        radial-gradient(circle closest-side, #0b0d18 ${radius * 96}%, transparent ${radius * 100}%)`;
      return;
    }
    const names = ['uSize', 'uDay', 'uT', 'uRadius', 'uShift', 'uContour', 'uPtr', 'uNear', 'uReach', 'uPress', 'uKey', 'uRip', 'uRipAmp',
      ...SCALARS.map((k) => `u${k[0].toUpperCase()}${k.slice(1)}`), ...COLORS.map((k) => `u${k[0].toUpperCase()}${k.slice(1)}`)];
    const U = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]));
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aQ = gl.getAttribLocation(prog, 'aQ');
    gl.useProgram(prog);
    gl.enableVertexAttribArray(aQ);
    gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    let width = 1, height = 1;
    const resize = () => {
      // Layout size, not getBoundingClientRect: the hero's entrance scales the orb, which would shrink the canvas.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      canvas.width = width;
      canvas.height = height;
    };
    resize();

    const e = engine.current;
    // Light or dark page (<html data-theme>): the ball stays dark, only its edge changes.
    let day = 0;
    const readTheme = () => { day = document.documentElement.getAttribute('data-theme') === 'dark' ? 0 : 1; e.redraw?.(); };
    const themeWatch = new MutationObserver(readTheme);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    readTheme();

    // The pointer in ball units (y up, 1 = the rim), and springs that give the ball weight.
    const ptr = { x: 9, y: 9, cx: 0, cy: 0, on: false, down: false, dragged: false, px: 0, py: 0, speed: 0, at: 0 };
    const sp = { near: spring(), reach: spring(), press: spring(), lx: spring(), ly: spring(), kx: spring(), ky: spring(), wob: spring() };
    const rip = { x: 1, y: 0, t0: -10, amp: 0 };
    let swallowClick = false;
    const ballAt = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const unit = (radiusRef.current * Math.min(rect.width, rect.height)) / 2;
      return [(clientX - rect.left - rect.width / 2) / unit, -(clientY - rect.top - rect.height / 2) / unit];
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType === 'touch' && !ptr.down) return;
      const [x, y] = ballAt(ev.clientX, ev.clientY);
      const gap = (ev.timeStamp - ptr.at) / 1000;
      if (ptr.on && gap > 0.004 && gap < 0.2) ptr.speed = Math.max(ptr.speed, Math.hypot(x - ptr.x, y - ptr.y) / gap);
      Object.assign(ptr, { x, y, cx: ev.clientX, cy: ev.clientY, at: ev.timeStamp, on: true });
      if (ptr.down && !ptr.dragged && Math.hypot(x - ptr.px, y - ptr.py) > 0.07) ptr.dragged = true;
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const [x, y] = ballAt(ev.clientX, ev.clientY);
      if (Math.hypot(x, y) > 1.05) return;
      if ((ev.target as Element | null)?.closest?.('a, button, input, select, textarea, label, [contenteditable="true"]')) return;
      Object.assign(ptr, { x, y, cx: ev.clientX, cy: ev.clientY, px: x, py: y, on: true, down: true, dragged: false, at: ev.timeStamp });
    };
    const onUp = (ev: PointerEvent) => {
      if (!ptr.down) return;
      ptr.down = false;
      const l = Math.hypot(ptr.x, ptr.y) || 1;
      Object.assign(rip, { x: ptr.x / l, y: ptr.y / l, t0: e.now, amp: ptr.dragged ? 1 : 0.8 });
      if (ptr.dragged) { swallowClick = true; window.setTimeout(() => { swallowClick = false; }, 0); }
      if (ev.pointerType === 'touch') ptr.on = false;
    };
    const onCancel = (ev: PointerEvent) => { ptr.down = false; if (ev.pointerType === 'touch') ptr.on = false; };
    const onOut = (ev: PointerEvent) => { if (!ev.relatedTarget && !ptr.down) ptr.on = false; };
    const onBlur = () => { ptr.on = false; ptr.down = false; };
    const onScroll = () => { if (ptr.on) [ptr.x, ptr.y] = ballAt(ptr.cx, ptr.cy); };
    const onClick = (ev: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      ev.stopPropagation();
      ev.preventDefault();
    };
    const touch = interactive && !reduced;
    if (touch) {
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerdown', onDown, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
      window.addEventListener('pointercancel', onCancel, { passive: true });
      window.addEventListener('pointerout', onOut, { passive: true });
      window.addEventListener('blur', onBlur);
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('click', onClick, true);
    }

    // The look being drawn: blends from where it was to the mode's look (in 220 ms, back out in 650 ms).
    let shownMode = e.mode;
    let from = LOOKS[shownMode], to = LOOKS[shownMode], blendAt = -10, blendDur = 0;
    const cur: Look = structuredClone(to);
    const lookAt = (t: number) => {
      if (e.mode !== shownMode) {
        from = structuredClone(cur);
        to = LOOKS[e.mode];
        blendAt = t;
        blendDur = e.mode === 'idle' || e.mode === 'ended' ? 0.65 : 0.22;
        shownMode = e.mode;
      }
      const raw = blendDur ? Math.min(1, Math.max(0, (t - blendAt) / blendDur)) : 1;
      const k = blendDur === 0.22 ? 1 - (1 - raw) ** 3 : raw * raw * (3 - 2 * raw);
      for (const s of SCALARS) cur[s] = from[s] + (to[s] - from[s]) * k;
      for (const c of COLORS) cur[c] = from[c].map((v, i) => toSrgb(toLin(v) + (toLin(to[c][i]) - toLin(v)) * k));
      return cur;
    };

    const st = { loud: 0, hiss: 0, gap: 0, phase: 0, lastT: 0, nextRing: 0, ringStep: 0 };
    const start = performance.now();

    const draw = (nowMs: number) => {
      const t = (nowMs - start) / 1000;
      const dt = Math.min(0.05, Math.max(0, t - st.lastT));
      const ease = (rate: number) => 1 - Math.exp(-rate * dt);
      st.lastT = t;
      e.now = t;
      const m = e.mode;
      const speaking = m === 'saathi' || m === 'family';

      // Ringing: ring-ring … pause.
      if (m === 'ringing' && t > st.nextRing) {
        e.rings.push(t);
        st.ringStep = (st.ringStep + 1) % 2;
        st.nextRing = t + (st.ringStep === 1 ? 0.32 : 1.4);
      }
      e.rings = e.rings.filter((s0) => t - s0 < 1.2);
      const ring = e.rings.reduce((acc, s0) => acc + Math.exp(-(t - s0) * 7), 0);

      // The voice as a level meter: real levels if fed, else the word being said, else made-up speech.
      let loudT = 0, hissT = 0;
      if (speaking && !reduced) {
        if (t - e.levelAt < 0.25) loudT = 0.15 + 0.85 * e.level;
        else {
          if (t - e.lastSay > 0.9 && t > e.word.end + st.gap) {
            const n = 1 + Math.floor(Math.random() * 3);
            const dur = 0.17 * n + 0.05;
            e.word = { at: t, end: t + dur, segs: plan(madeUp(n), dur) };
            st.gap = Math.random() < 0.15 ? 0.45 : 0.05 + Math.random() * 0.15;
          }
          [loudT, hissT] = sample(e.word.segs, t - e.word.at);
        }
      }
      if (m === 'ringing') loudT = 0.6 * Math.min(1, ring);
      st.loud += (loudT - st.loud) * ease(loudT > st.loud ? 40 : 14);
      st.hiss += (hissT - st.hiss) * ease(30);
      e.loud = st.loud;

      // The reference's audio rules (strength 0.8): loudness speeds the wave, spreads it,
      // wobbles the outline and brightens the glass; hiss adds sheen.
      const L = lookAt(t);
      const v = st.loud * (m === 'family' ? 0.65 : 0.8);
      const h = st.hiss * 0.8;
      const speed = L.speed * (1 + 0.7 * v);
      const warp = Math.min(Math.max(7, L.warp), L.warp + 0.85 * v);
      const sheen = L.sheen + 0.16 * h;
      const exposure = L.exposure * (1 + 0.12 * v + 0.08 * ring);
      st.phase += dt * speed;

      // Touch springs.
      const pd = Math.hypot(ptr.x, ptr.y);
      const near = touch && ptr.on ? Math.max(0, 1 - Math.max(0, pd - 0.6) / 1.4) : 0;
      ptr.speed *= Math.exp(-dt * 6);
      settle(sp.near, near, 2.2, 0.8, dt);
      settle(sp.reach, near * Math.max(-0.5, Math.min(0.5, ptr.y * 0.4)), 1.8, 0.45, dt);
      settle(sp.press, ptr.down ? 1 : 0, 3.5, 0.35, dt);
      settle(sp.lx, near * Math.max(-1, Math.min(1, ptr.x)) * 0.025, 1.6, 0.5, dt);
      settle(sp.ly, near * Math.max(-1, Math.min(1, ptr.y)) * 0.025, 1.6, 0.5, dt);
      settle(sp.wob, Math.min(1, ptr.speed / 8) * near, 2.5, 0.3, dt);
      // the key light swings from the top left toward the pointer
      const kd = touch && ptr.on && pd > 0.05 ? [ptr.x / pd, ptr.y / pd] : [-0.68, 0.73];
      settle(sp.kx, kd[0] * near + -0.68 * (1 - near), 1.5, 0.7, dt);
      settle(sp.ky, kd[1] * near + 0.73 * (1 - near), 1.5, 0.7, dt);
      const kl = Math.hypot(sp.kx.x, sp.ky.x) || 1;

      gl.viewport(0, 0, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uSize, width, height);
      gl.uniform1f(U.uT, st.phase);
      gl.uniform1f(U.uRadius, radiusRef.current);
      gl.uniform2f(U.uShift, sp.lx.x, sp.ly.x);
      gl.uniform1f(U.uContour, Math.min(1, 0.075 * v + 0.6 * ring + 0.9 * sp.wob.x + 0.15));
      gl.uniform2f(U.uPtr, ptr.on ? ptr.x : 0, ptr.on ? ptr.y : 0);
      gl.uniform1f(U.uNear, sp.near.x);
      gl.uniform1f(U.uReach, sp.reach.x);
      gl.uniform1f(U.uPress, sp.press.x);
      gl.uniform2f(U.uKey, sp.kx.x / kl, sp.ky.x / kl);
      gl.uniform3f(U.uRip, rip.x, rip.y, t - rip.t0);
      gl.uniform1f(U.uRipAmp, t - rip.t0 < 1.5 ? rip.amp : 0);
      gl.uniform1f(U.uSpeed, speed);
      gl.uniform1f(U.uZoom, L.zoom);
      gl.uniform1f(U.uWarp, warp);
      gl.uniform1f(U.uRidge, L.ridge);
      gl.uniform1f(U.uShade, L.shade);
      gl.uniform1f(U.uSheen, sheen);
      gl.uniform1f(U.uGloss, L.gloss);
      gl.uniform1f(U.uMidA, L.midA);
      gl.uniform1f(U.uEdgeA, L.edgeA);
      gl.uniform1f(U.uExposure, exposure);
      gl.uniform1f(U.uGlassOp, L.glassOp);
      gl.uniform1f(U.uEdgeGlow, L.edgeGlow * (1 + v + ring) * (1 - day));   // no haze on a light page: it reads as blur
      gl.uniform1f(U.uDay, day);
      for (const c of COLORS) gl.uniform3fv(U[`u${c[0].toUpperCase()}${c.slice(1)}`], L[c]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let raf = 0, onScreen = true;
    const loop = (now: number) => { draw(now); raf = requestAnimationFrame(loop); };
    const startLoop = () => { if (!raf && onScreen && !document.hidden && !reduced) raf = requestAnimationFrame(loop); };
    const stopLoop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    const io = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; if (onScreen) startLoop(); else stopLoop(); });
    const onVis = () => (document.hidden ? stopLoop() : startLoop());
    // Reduced motion: no loop, one still frame (a little way in, so the wave isn't flat), redrawn on change.
    const still = () => { st.phase = 2.2; st.lastT = (performance.now() - start) / 1000 + 10; draw(performance.now() + 10000); };
    const ro = new ResizeObserver(() => { resize(); if (reduced) still(); });
    ro.observe(canvas);
    io.observe(canvas);
    document.addEventListener('visibilitychange', onVis);
    if (reduced) {
      e.redraw = still;
      still();
    }
    startLoop();

    return () => {
      stopLoop();
      e.redraw = null;
      io.disconnect();
      themeWatch.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('pointerout', onOut);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('click', onClick, true);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
    // `radius` and `interactive` are read once at mount (radius updates through radiusRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }} />;
}
