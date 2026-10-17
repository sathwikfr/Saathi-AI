'use client';

import React, { useEffect, useImperativeHandle, useRef } from 'react';

/**
 * Saathi's voice orb: a ring of ~40k dots drawn as the line of a phone call.
 * Red on top (the family), blue below (Saathi), woven like thin lightning.
 *
 * The voice is shown as phone waves: a few dotted white waveform lines across
 * the middle of the ring that taper at both ends and swell with the voice.
 * They travel left to right while Saathi speaks and right to left while the
 * family answers, and every word sends a bump through them. Ringing sends
 * echo rings outward.
 *
 * Around it: a soft red/blue haze (one full-canvas glow pass) and a few faint
 * drifting sparkles. Raw WebGL, four tiny programs. No three.js.
 *
 * `variant`: 'night' (default) is light on a transparent canvas, for dark pages:
 * glowing strands and white waves. 'day' is for light pages: the strands, waves
 * and sparkles are drawn like coloured ink straight on the page, and the waves
 * take the speaker's colour (blue for Saathi, red for the family, charcoal when
 * calm). `darkCore` adds a dark disc inside the ring (off by default).
 *
 * Drive it with the `mode` prop, or imperatively through `ref`:
 *   orb.current.say('tablet')      // a word is being spoken: the waves swell once per syllable
 *   orb.current.pulse('saathi')    // one bump, no word
 *   orb.current.level(0.7)         // real loudness (0-1), e.g. from an AnalyserNode on a recorded clip;
 *                                  // while it keeps coming it overrides the word rhythm
 */

/** 'thinking' = the pause between turns (SaathiBlob shows it; the older looks treat it as idle). */
export type OrbMode = 'idle' | 'ringing' | 'saathi' | 'family' | 'thinking' | 'ended';
export type OrbSide = 'saathi' | 'family';
export type SaathiOrbHandle = {
  setMode: (m: OrbMode) => void;
  pulse: (from?: OrbSide) => void;
  /** A word starts now. `seconds` = how long it lasts, if known (else estimated from the word). */
  say: (word: string, seconds?: number) => void;
  level: (v: number) => void;
  echo: () => void;
  /** The voice's loudness right now, 0..1 (SaathiBlob only). */
  loudness?: () => number;
};

/** Rough syllable count: vowel groups for Latin text, letters (less vowel signs) for Indian scripts. */
export function syllables(word: string) {
  const w = word.replace(/[^\p{L}\p{M}]/gu, '');
  if (!w) return 1;
  if (/^[A-Z]{1,4}$/.test(w)) return w.length;                    // "BP" is said letter by letter
  if (/^[a-z]+$/i.test(w)) return Math.max(1, (w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g) ?? []).length);
  return Math.max(1, Math.round(w.replace(/\p{M}/gu, '').length * 0.85));
}

// Saathi = blue (bottom), family = red (top), lilac where they meet on the sides.
const BLUE = [0.2, 0.45, 1.0];
const RED = [1.0, 0.3, 0.16];
const LILAC = [0.86, 0.6, 0.92];
// On a light page the same hues as ink: deeper, so they hold their colour.
const BLUE_DAY = [0.13, 0.33, 0.9];
const RED_DAY = [0.86, 0.2, 0.1];
const LILAC_DAY = [0.58, 0.32, 0.84];
const INK = [0.1, 0.1, 0.12];
// Phone waves on a dark page: glowing white when calm, blue for Saathi, red for the family.
const WAVE_WHITE = [1, 0.97, 0.95];
const WAVE_BLUE = [0.22, 0.48, 1.0];
const WAVE_RED = [1.0, 0.26, 0.12];

export const NOISE = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + 2.0 * C.xxx; vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}`;

/* ---------- The ring ---------- */

const RING_VERT = `
attribute vec3 aRing;              // angle, offset across the band (-1..1), seed
uniform float uTime; uniform float uVoice; uniform float uScale; uniform float uAspect; uniform float uFlow;
uniform float uSize; uniform float uRadius; uniform float uAlpha; uniform float uPoles; uniform float uPoleGrow;
uniform vec2 uMouse; uniform float uMouseAmt; uniform float uDay; uniform float uBack;
uniform vec3 uBlue; uniform vec3 uRed; uniform vec3 uLilac;
varying vec3 vCol; varying float vA;
${NOISE}
const float PI = 3.14159265;
float angDist(float a, float b) { return abs(atan(sin(a - b), cos(a - b))); }

void main() {
  float th = aRing.x; float b = aRing.y; float seed = aRing.z;
  vec2 dir = vec2(cos(th), sin(th));
  float t = uTime;
  // The strands' shape is sampled at a slowly turning angle, so they flow
  // around the ring like current; colour stays put (red top, blue bottom).
  float thF = th - uFlow;
  vec2 dirF = vec2(cos(thF), sin(thF));

  float n1 = snoise(vec3(dirF * 1.3, t * 0.22 + b * 0.25));
  float n2 = snoise(vec3(dirF * 3.2 + b * 0.6, t * 0.6));
  float n3 = snoise(vec3(dirF * 7.0, t * 1.7 + seed * 3.0));
  float strand = snoise(vec3(dirF * 2.2, t * 0.35 + b * 1.7)) * 0.034;
  // ~24 jagged bumps, a different phase per strand: the strands cross like woven lightning
  float weave = sin(thF * 24.0 + b * 5.0 + t * 2.4 + snoise(vec3(dirF * 4.0, t * 0.8 + b)) * 6.0)
    * 0.024 * (0.55 + 0.9 * abs(snoise(vec3(dirF * 3.0, t * 0.5 + b * 0.7))));
  float jag = snoise(vec3(dirF * 9.0 + b * 2.0, t * 1.1)) * 0.02;

  float w = 0.13 * (1.0 + 0.45 * uVoice);
  float r = 1.0 + b * w + n1 * 0.05 + strand + weave + jag + n2 * (0.02 + 0.04 * uVoice) + n3 * 0.025 * uVoice;

  float md = angDist(th, atan(uMouse.y, uMouse.x));
  r += uMouseAmt * exp(-md * md * 9.0) * 0.07;            // the ring leans toward the pointer
  r *= (1.0 + 0.012 * sin(t * 1.3) + 0.02 * uVoice) * uRadius;

  float z = n1 * 0.3 + b * 0.25;
  vec2 pos = dir * r / (1.0 + z * 0.12);
  gl_Position = vec4(pos.x * uScale / uAspect, pos.y * uScale, 0.0, 1.0);

  // Red above, blue below, a thin lilac blend at the sides.
  float s = sin(th);
  vec3 col = mix(uBlue, uRed, smoothstep(-0.3, 0.3, s));
  col = mix(col, uLilac, 0.18 * pow(1.0 - abs(s), 4.0));
  // faint white cores in some strands, like the reference filaments
  float core = smoothstep(0.55, 0.9, snoise(vec3(dirF * 6.0, t * 0.9 + b * 3.0)));
  // a soft glow at the poles when calm; uPoles is 0 while anyone talks
  float pole = (exp(-pow(angDist(th, 0.5 * PI), 2.0) * 40.0) + exp(-pow(angDist(th, -0.5 * PI), 2.0) * 40.0)) * uPoles;
  col = mix(col, vec3(1.0, 0.97, 0.95), clamp(core * 0.35 + pole * 0.35, 0.0, 0.7) * mix(1.0, 0.2, uDay));
  vCol = col;

  float edge = 1.0 - smoothstep(0.35, 1.0, abs(b)) * 0.85;
  vA = (0.5 + 0.35 * core + 0.4 * pole + 0.25 * uVoice) * edge * uAlpha;
  if (uBack > 0.5) {                 // the dark ribbon under the strands (light pages)
    vCol = vec3(0.028, 0.032, 0.055);
    vA = 0.5 * edge * uAlpha;
  }
  gl_PointSize = uSize * (1.0 + uPoleGrow * pole);
}`;

/* ---------- The voice: dotted phone waves across the middle of the ring ---------- */

const CURTAIN_VERT = `
attribute vec3 aC;                 // u along a line (0..1), v which line (0..1), seed
uniform float uTime; uniform float uScale; uniform float uAspect; uniform float uSize;
uniform float uDir; uniform float uAmp; uniform float uAlpha; uniform float uWaveY;
uniform float uRipple; uniform float uRippleAge;
varying float vA;

void main() {
  float u = aC.x; float v = aC.y;
  float x = (u * 2.0 - 1.0) * 0.8;
  // taper to nothing at both ends, like a voice waveform inside the circle
  float env = pow(max(1.0 - (x / 0.8) * (x / 0.8), 0.0), 1.6);

  // each line is its own wave: different frequency, speed, phase and height
  float freq = 7.0 + v * 9.0;
  float speed = 3.6 + v * 2.4;
  float height = 0.55 + 0.45 * sin(v * 9.0 + 1.3);
  float y = uWaveY + (v - 0.5) * 0.05;               // uWaveY moves the whole waveform (ring units)
  y += uAmp * env * height * sin(x * freq - uTime * speed * uDir + v * 5.3);
  y += uAmp * env * 0.35 * sin(x * freq * 2.1 + uTime * 1.7 + v * 2.0);   // a second harmonic

  // A word: a bump that travels across from the speaker's side.
  float front = -0.9 + uRippleAge * 2.2;
  float d = x * uDir - front;
  float ripple = exp(-d * d * 10.0) * uRipple * (1.0 - smoothstep(0.6, 1.0, uRippleAge));
  y += ripple * env * 0.12 * sin(x * 26.0 - uTime * 9.0 * uDir + v * 3.0);

  gl_Position = vec4(x * uScale / uAspect, y * uScale, 0.0, 1.0);

  float centre = 1.0 - abs(v - 0.5) * 1.2;              // middle lines brightest
  vA = sqrt(env) * centre * uAlpha * (1.0 + ripple * 0.6);
  gl_PointSize = uSize;
}`;

const CURTAIN_FRAG = `
precision mediump float;
varying float vA;
uniform vec3 uInk; uniform float uInkMode;   // 0 = white light (dark pages), 1 = coloured ink (light pages)
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float l = length(pc);
  if (l > 0.5) discard;
  float a = smoothstep(0.5, 0.0, l) * vA;
  if (uInkMode > 0.5) {
    a = clamp(a, 0.0, 1.0);
    gl_FragColor = vec4(uInk * a, a);          // premultiplied ink, blended src-over
  } else {
    vec3 c = uInk * a;                          // glowing light in the speaker's colour
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
}`;

/* ---------- Glow: a soft red/blue haze hugging the ring (one full-canvas pass) ---------- */

const GLOW_VERT = `
attribute vec2 aQ;
uniform float uScale; uniform float uAspect;
varying vec2 vP;
void main() {
  vP = vec2(aQ.x * uAspect, aQ.y) / uScale;           // ring space: the ring sits at r = 1
  gl_Position = vec4(aQ, 0.0, 1.0);
}`;

const GLOW_FRAG = `
precision mediump float;
varying vec2 vP;
uniform vec3 uBlue; uniform vec3 uRed; uniform float uGlow; uniform float uTime;
uniform float uCore; uniform float uOuter; uniform float uCoreR; uniform float uTint;
void main() {
  float r = length(vP);
  float s = vP.y / max(r, 1e-4);
  vec3 col = mix(uBlue, uRed, smoothstep(-0.35, 0.35, s));
  float d = r - 1.0;
  float outer = exp(-max(d, 0.0) * 3.0) * step(0.0, d);
  float inner = exp(-max(-d, 0.0) * 5.0) * step(d, 0.0);
  float rim = exp(-d * d * 50.0);
  if (uTint > 0.5) {
    // Light pages: light can't brighten a light page, so the glow is laid down as a
    // coloured haze instead: red above, blue below, strongest straight up and down
    // (the 'lighting' at the poles of the dark-mode orb). No dark anywhere.
    float pole = pow(abs(s), 3.0);
    float gt = (outer * 1.1 + rim * 0.7 + inner * 0.25) * (0.35 + 1.6 * pole) * uGlow;
    gt *= 0.9 + 0.1 * sin(atan(vP.y, vP.x) * 3.0 + uTime * 0.6);
    gt *= smoothstep(1.6, 1.3, r);
    float a = clamp(gt, 0.0, 0.85);
    gl_FragColor = vec4(col * a, a);
    return;
  }
  // even all the way round (no pole hot spots), with a slow drift so it breathes
  float g = (outer * 0.55 * uOuter + inner * 0.3 + rim * 0.45) * uGlow;
  g *= 0.85 + 0.15 * sin(atan(vP.y, vP.x) * 3.0 + uTime * 0.6);
  g *= smoothstep(1.6, 1.3, r);                        // fade out before the canvas edge
  vec3 c = col * g;
  // 'day': a dark core only inside the ring, fading out under its inner edge
  float core = (1.0 - smoothstep(uCoreR - 0.03, uCoreR + 0.05, r)) * uCore;   // dark disc out to uCoreR ring radii
  vec3 coreCol = mix(vec3(0.05, 0.055, 0.085), vec3(0.018, 0.02, 0.03), smoothstep(0.0, 0.85, r));
  // premultiplied: the core is an opaque-ish dark fill, the glow adds light on top
  gl_FragColor = vec4(coreCol * core + c, clamp(core + max(c.r, max(c.g, c.b)), 0.0, 1.0));
}`;

/* ---------- Sparkles: a few faint motes drifting around the ring ---------- */

const MOTE_VERT = `
attribute vec3 aM;                 // angle, radius, seed
uniform float uTime; uniform float uScale; uniform float uAspect; uniform float uSize; uniform float uAlpha;
uniform vec3 uBlue; uniform vec3 uRed; uniform vec2 uMoteR; uniform float uTintMix;
varying vec3 vCol; varying float vA;
void main() {
  float a = aM.x + uTime * (0.015 + 0.02 * aM.z);       // a slow orbit
  float r = mix(uMoteR.x, uMoteR.y, aM.y) + 0.04 * sin(uTime * (0.3 + aM.z * 0.4) + aM.z * 20.0);
  vec2 p = vec2(cos(a), sin(a)) * r;
  gl_Position = vec4(p.x * uScale / uAspect, p.y * uScale, 0.0, 1.0);
  vec3 tint = mix(uBlue, uRed, smoothstep(-0.4, 0.4, sin(a)));
  vCol = mix(vec3(1.0), tint, uTintMix);
  float tw = pow(0.5 + 0.5 * sin(uTime * (0.7 + aM.z * 1.3) + aM.z * 31.0), 5.0);   // twinkle
  vA = (0.12 + 0.6 * tw) * smoothstep(1.6, 1.25, r) * uAlpha;
  gl_PointSize = uSize * (0.7 + 0.8 * aM.z);
}`;

const RING_FRAG = `
precision mediump float;
varying vec3 vCol; varying float vA;
uniform float uHard;               // 1 = crisp ink dots (light pages), 0 = soft light dots
uniform float uRibbon;             // 1 = the dark ribbon: an opaque-ish fill, not light
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float l = length(pc);
  if (l > 0.5) discard;
  if (uRibbon > 0.5) {
    float ab = smoothstep(0.5, 0.0, l) * vA;
    gl_FragColor = vec4(vCol * ab, ab);
    return;
  }
  vec3 c = vCol * smoothstep(0.5, mix(0.0, 0.3, uHard), l) * vA;
  // premultiplied: alpha follows brightness so faint glow never paints black over the page
  gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('SaathiOrb shader:', gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

function link(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = vs && fs ? gl.createProgram() : null;
  if (!prog || !vs || !fs) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('SaathiOrb link:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

function ringPoints(around: number, across: number, jitter: number) {
  const out = new Float32Array(around * across * 3);
  let i = 0;
  for (let a = 0; a < around; a++) {
    for (let k = 0; k < across; k++) {
      out[i++] = ((a + Math.random() * jitter) / around) * Math.PI * 2;
      out[i++] = across === 1 ? (Math.random() * 2 - 1) * 0.3 : (k / (across - 1)) * 2 - 1;
      out[i++] = Math.random();
    }
  }
  return out;
}

function motePoints(count: number) {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = Math.random() * Math.PI * 2;
    out[i * 3 + 1] = Math.sqrt(Math.random());                 // 0..1, mapped to a radius range in the shader
    out[i * 3 + 2] = Math.random();
  }
  return out;
}

function wavePoints(lines: number, dots: number) {
  const out = new Float32Array(lines * dots * 3);
  let i = 0;
  for (let k = 0; k < lines; k++) {
    for (let d = 0; d < dots; d++) {
      out[i++] = d / (dots - 1);
      out[i++] = k / (lines - 1);
      out[i++] = Math.random();
    }
  }
  return out;
}

type Props = {
  mode?: OrbMode;
  /** Ring radius as a fraction of the canvas half-height (default 0.62). */
  scale?: number;
  /** Move the phone waves up/down inside the ring, in ring radii (negative = down). */
  waveY?: number;
  /** Scale the phone waves' height (1 = default). */
  waveAmp?: number;
  /** 'night' for dark pages (default), 'day' for light pages (ink on the page). */
  variant?: 'night' | 'day';
  /** Paint a dark disc behind the orb (so the glow reads on a light page). */
  darkCore?: boolean;
  /** How far the dark disc reaches, in ring radii (0.94 = just inside the ring, 1.2 = past its outer edge). */
  coreRadius?: number;
  className?: string;
  ref?: React.Ref<SaathiOrbHandle>;
};

export function SaathiOrb({ mode = 'idle', scale = 0.62, variant = 'night', darkCore = false, coreRadius = 0.94, waveY = 0, waveAmp = 1, className, ref }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef(scale);
  const dayRef = useRef(variant === 'day');
  const coreRef = useRef(darkCore);
  const coreRRef = useRef(coreRadius);
  const waveRef = useRef({ y: waveY, amp: waveAmp });
  const engine = useRef({
    mode: 'idle' as OrbMode,
    echoes: [] as number[],
    lastPulse: -10,
    rippleAt: -10,
    now: 0,
    word: { at: -10, dur: 0, syl: 1 },   // the word being said: the waves swell once per syllable
    levelAt: -10,
    level: 0,
  });

  useImperativeHandle(ref, () => ({
    setMode: (m) => { engine.current.mode = m; },
    pulse: () => {
      const e = engine.current;
      e.lastPulse = e.now;
      if (e.now - e.rippleAt > 0.35) e.rippleAt = e.now;   // one bump at a time through the waves
    },
    say: (word, seconds) => {
      const e = engine.current;
      const syl = syllables(word);
      e.word = { at: e.now, dur: seconds ?? Math.min(1.1, 0.1 + 0.17 * syl), syl };
      e.lastPulse = e.now;
      if (e.now - e.rippleAt > 0.35) e.rippleAt = e.now;
    },
    level: (v) => {
      const e = engine.current;
      e.level = Math.max(0, Math.min(1, v));
      e.levelAt = e.now;
    },
    echo: () => {
      const e = engine.current;
      e.echoes.push(e.now);
      if (e.echoes.length > 4) e.echoes.shift();
    },
  }));

  useEffect(() => { engine.current.mode = mode; }, [mode]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { dayRef.current = variant === 'day'; }, [variant]);
  useEffect(() => { coreRef.current = darkCore; }, [darkCore]);
  useEffect(() => { coreRRef.current = coreRadius; }, [coreRadius]);
  useEffect(() => { waveRef.current = { y: waveY, amp: waveAmp }; }, [waveY, waveAmp]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true });
    const ringProg = gl && link(gl, RING_VERT, RING_FRAG);
    const curtainProg = gl && link(gl, CURTAIN_VERT, CURTAIN_FRAG);
    const glowProg = gl && link(gl, GLOW_VERT, GLOW_FRAG);
    const moteProg = gl && link(gl, MOTE_VERT, RING_FRAG);
    if (!gl || !ringProg || !curtainProg || !glowProg || !moteProg) {
      canvas.dataset.fallback = 'true';
      return;
    }

    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    const mk = (data: Float32Array) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return { buf: b, count: data.length / 3 };
    };
    const ringBuf = mk(ringPoints(small ? 700 : 1300, small ? 36 : 50, 0.9));
    const haloBuf = mk(ringPoints(small ? 900 : 1600, 1, 1));       // sparse centre line for the echo rings
    const curtainBuf = mk(wavePoints(small ? 5 : 7, small ? 120 : 170));
    const moteBuf = mk(motePoints(small ? 90 : 170));
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const R = (n: string) => gl.getUniformLocation(ringProg, n);
    const ru = {
      time: R('uTime'), voice: R('uVoice'), scale: R('uScale'), aspect: R('uAspect'), size: R('uSize'), flow: R('uFlow'),
      radius: R('uRadius'), alpha: R('uAlpha'), poles: R('uPoles'), poleGrow: R('uPoleGrow'),
      mouse: R('uMouse'), mouseAmt: R('uMouseAmt'), day: R('uDay'), hard: R('uHard'), back: R('uBack'), ribbon: R('uRibbon'),
      blue: R('uBlue'), red: R('uRed'), lilac: R('uLilac'),
    };
    const aRing = gl.getAttribLocation(ringProg, 'aRing');
    gl.useProgram(ringProg);
    gl.uniform3fv(R('uBlue'), BLUE);
    gl.uniform3fv(R('uRed'), RED);
    gl.uniform3fv(R('uLilac'), LILAC);

    const C = (n: string) => gl.getUniformLocation(curtainProg, n);
    const cu = {
      time: C('uTime'), scale: C('uScale'), aspect: C('uAspect'), size: C('uSize'),
      dir: C('uDir'), amp: C('uAmp'), alpha: C('uAlpha'), ripple: C('uRipple'), rippleAge: C('uRippleAge'),
      ink: C('uInk'), inkMode: C('uInkMode'), waveY: C('uWaveY'),
    };
    const aC = gl.getAttribLocation(curtainProg, 'aC');

    const G = (n: string) => gl.getUniformLocation(glowProg, n);
    const gu = { scale: G('uScale'), aspect: G('uAspect'), glow: G('uGlow'), time: G('uTime'), core: G('uCore'), outer: G('uOuter'), coreR: G('uCoreR'), tint: G('uTint') };
    const aQ = gl.getAttribLocation(glowProg, 'aQ');
    gl.useProgram(glowProg);
    gl.uniform3fv(G('uBlue'), BLUE);
    gl.uniform3fv(G('uRed'), RED);

    const M = (n: string) => gl.getUniformLocation(moteProg, n);
    const mu = { time: M('uTime'), scale: M('uScale'), aspect: M('uAspect'), size: M('uSize'), alpha: M('uAlpha'), moteR: M('uMoteR'), tintMix: M('uTintMix') };
    const aM = gl.getAttribLocation(moteProg, 'aM');
    gl.useProgram(moteProg);
    gl.uniform3fv(M('uBlue'), BLUE);
    gl.uniform3fv(M('uRed'), RED);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    let width = 1, height = 1, dpr = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };
    resize();

    const ptr = { x: 0, y: 1, amt: 0, target: 0 };
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const cy = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      const x = (cx * (width / height)) / scaleRef.current, y = cy / scaleRef.current;
      const d = Math.hypot(x, y);
      ptr.x = x; ptr.y = y;
      ptr.target = d > 0.2 && d < 2.2 ? 1 - Math.min(1, Math.abs(d - 1) / 1.2) : 0;
    };
    const onLeave = () => { ptr.target = 0; };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    // The waves travel toward the listener: `dir` flips with who is talking.
    const st = { voice: 0.05, poles: 1, curtainAlpha: 0, amp: 0.03, dir: 1, nextRing: 0, ringStep: 0, glow: 0.2, flow: 0, lastT: 0, ink: [0.2, 0.2, 0.23], light: [1, 0.97, 0.95] };
    const e = engine.current;
    const start = performance.now();

    const draw = (nowMs: number) => {
      const t = (nowMs - start) / 1000;
      const dt = Math.min(0.05, Math.max(0, t - st.lastT));
      // Easing follows real time (same feel at 60 fps, and no slow-motion on a slow phone).
      const step = Math.min(1, Math.max(0, t - st.lastT));
      const ease = (rate: number) => 1 - Math.exp(-rate * step);
      const hue = ease(6);
      st.lastT = t;
      e.now = t;
      const m = e.mode;
      const speaking = m === 'saathi' || m === 'family';

      // The voice: real loudness if it's being fed, else one swell per syllable of the word
      // being said (quiet between words and at commas), else a generic talking rhythm.
      const sinceWord = t - e.lastPulse;
      let talk: number;
      if (t - e.levelAt < 0.25) talk = 0.2 + 0.75 * e.level;
      else if (t - e.word.at < e.word.dur) {
        const k = ((t - e.word.at) / e.word.dur) * e.word.syl;
        const beat = Math.pow(Math.sin(Math.PI * (k - Math.floor(k))), 0.7);
        talk = 0.25 + 0.6 * beat * (k < 1 ? 1 : 0.8);                    // first syllable a little stronger
      } else if (sinceWord < 0.9) talk = 0.2;                            // the gap between words
      else talk = 0.35 + 0.5 * Math.abs(Math.sin(t * 7.1) * Math.sin(t * 2.7)) * (Math.sin(t * 1.7) > -0.55 ? 1 : 0.15);
      const vTarget = speaking ? talk : m === 'ringing' ? 0.15 : m === 'ended' ? 0 : 0.05;
      st.voice += (vTarget - st.voice) * ease(vTarget > st.voice ? 14 : 8);
      // no pole shine while anyone talks
      st.poles += ((speaking ? 0 : m === 'ended' ? 0.3 : 1) - st.poles) * ease(5);
      // the waves are strong while talking, a quiet line when calm
      st.curtainAlpha += ((speaking ? 1 : m === 'ended' ? 0.25 : 0.55) - st.curtainAlpha) * ease(3.7);
      const ampT = speaking ? 0.06 + 0.24 * st.voice : m === 'ringing' ? 0.07 + 0.05 * Math.max(0, Math.sin(t * 9)) : m === 'ended' ? 0.01 : 0.025;
      st.amp += (ampT - st.amp) * ease(6.3);
      if (m === 'family') st.dir = -1;
      else if (m === 'saathi') st.dir = 1;
      // the haze breathes with the voice, evenly all round
      const glowT = speaking ? 0.38 + 0.3 * st.voice : m === 'ringing' ? 0.32 + 0.14 * Math.max(0, Math.sin(t * 9)) : m === 'ended' ? 0.14 : 0.27;
      st.glow += (glowT - st.glow) * ease(3.7);
      // the strands flow around the ring, a little faster while talking
      st.flow += dt * (0.05 + 0.14 * st.voice);
      // on light pages the waves take the speaker's colour
      const inkT = m === 'saathi' || m === 'ringing' ? BLUE_DAY : m === 'family' ? RED_DAY : INK;
      for (let i = 0; i < 3; i++) st.ink[i] += (inkT[i] - st.ink[i]) * hue;
      // on dark pages the same rule as light: white when calm, blue for Saathi, red for the family
      const lightT = m === 'saathi' || m === 'ringing' ? WAVE_BLUE : m === 'family' ? WAVE_RED : WAVE_WHITE;
      for (let i = 0; i < 3; i++) st.light[i] += (lightT[i] - st.light[i]) * hue;

      if (m === 'ringing' && t > st.nextRing) {          // ring-ring … pause
        e.echoes.push(t);
        st.ringStep = (st.ringStep + 1) % 2;
        st.nextRing = t + (st.ringStep === 1 ? 0.32 : 1.4);
      }
      if (speaking && sinceWord > 0.6 && t - e.rippleAt > 0.7) e.rippleAt = t;   // keep ripples flowing without word events
      e.echoes = e.echoes.filter((s0) => t - s0 < 1.6);

      ptr.amt += (ptr.target - ptr.amt) * ease(5);
      const aspect = width / height;
      const T = reduced ? 3 : t;

      gl.clear(gl.COLOR_BUFFER_BIT);

      // --- glow: the soft haze behind everything ---
      gl.useProgram(glowProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(aQ);
      gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(gu.scale, scaleRef.current);
      gl.uniform1f(gu.aspect, aspect);
      gl.uniform1f(gu.glow, st.glow);
      gl.uniform1f(gu.tint, dayRef.current && !coreRef.current ? 1 : 0);   // light page: coloured haze, not light
      gl.uniform1f(gu.time, T);
      gl.uniform1f(gu.core, coreRef.current ? 1 : 0);
      gl.uniform1f(gu.coreR, coreRRef.current);
      gl.uniform1f(gu.outer, dayRef.current ? 0.45 : 1);   // on a light page the outer haze is just a tint
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // --- sparkles ---
      gl.useProgram(moteProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, moteBuf.buf);
      gl.enableVertexAttribArray(aM);
      gl.vertexAttribPointer(aM, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(mu.time, T);
      gl.uniform1f(mu.scale, scaleRef.current);
      gl.uniform1f(mu.aspect, aspect);
      gl.uniform1f(mu.size, 2.2 * dpr);
      const dayMotes = dayRef.current;
      gl.uniform1f(mu.alpha, (m === 'ended' ? 0.5 : 1) * (dayMotes ? 0.6 : 1));
      gl.uniform1f(mu.tintMix, dayMotes ? 1 : 0.35);   // white sparkles vanish on a light page: use colour
      // night: around the ring; day: inside it, near the waves
      if (dayMotes) gl.uniform2f(mu.moteR, 0.12, 0.72);
      else gl.uniform2f(mu.moteR, 0.25, 1.5);
      if (dayMotes) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, moteBuf.count);
      gl.blendFunc(gl.ONE, gl.ONE);

      // --- ring program: echoes, ring ---
      gl.useProgram(ringProg);
      const day = dayRef.current;
      // Echo rings: on a light page they're drawn like ink (src-over, deeper colours).
      gl.uniform1f(ru.day, day ? 1 : 0);
      gl.uniform3fv(ru.blue, day ? BLUE_DAY : BLUE);
      gl.uniform3fv(ru.red, day ? RED_DAY : RED);
      gl.uniform3fv(ru.lilac, day ? LILAC_DAY : LILAC);
      if (day) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(ru.time, T);
      gl.uniform1f(ru.flow, st.flow);
      gl.uniform1f(ru.voice, st.voice);
      gl.uniform1f(ru.scale, scaleRef.current);
      gl.uniform1f(ru.aspect, aspect);
      gl.uniform1f(ru.poles, st.poles);
      gl.uniform2f(ru.mouse, ptr.x, ptr.y);
      gl.uniform1f(ru.mouseAmt, ptr.amt);
      const bind = (b: { buf: WebGLBuffer | null }, loc: number) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      };

      bind(haloBuf, aRing);
      gl.uniform1f(ru.poleGrow, 0);
      gl.uniform1f(ru.size, 3.2 * dpr);
      e.echoes.forEach((s0) => {
        const age = t - s0;
        gl.uniform1f(ru.radius, 1 + age * 0.38);            // stops at ~1.6, inside the canvas
        gl.uniform1f(ru.alpha, 1.6 * Math.pow(1 - age / 1.6, 2));
        gl.drawArrays(gl.POINTS, 0, haloBuf.count);
      });

      // The ring: bright red/blue strands. On a dark page they add up as light; on a
      // light page they're laid on as soft colour (no dark backing, no white cores).
      bind(ringBuf, aRing);
      gl.uniform1f(ru.radius, 1);
      gl.uniform1f(ru.hard, 0);
      gl.uniform1f(ru.back, 0);
      gl.uniform1f(ru.ribbon, 0);
      gl.blendFunc(gl.ONE, day ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);
      gl.uniform1f(ru.day, day ? 1 : 0);
      gl.uniform3fv(ru.blue, BLUE);
      gl.uniform3fv(ru.red, RED);
      gl.uniform3fv(ru.lilac, LILAC);
      gl.uniform1f(ru.size, (day ? 1.8 : 1.6) * dpr);
      gl.uniform1f(ru.alpha, day ? 2.1 : 1.0);   // on a light page: strong colour, no dark shadow
      gl.drawArrays(gl.POINTS, 0, ringBuf.count);
      gl.blendFunc(gl.ONE, gl.ONE);

      // --- wave program: the white dotted phone waves ---
      if (st.curtainAlpha > 0.01) {
        gl.useProgram(curtainProg);
        bind(curtainBuf, aC);
        gl.uniform1f(cu.time, T);
        gl.uniform1f(cu.scale, scaleRef.current);
        gl.uniform1f(cu.aspect, aspect);
        gl.uniform1f(cu.size, 2.6 * dpr);
        gl.uniform1f(cu.dir, st.dir);
        gl.uniform1f(cu.amp, (reduced ? 0.08 : st.amp) * waveRef.current.amp);
        gl.uniform1f(cu.waveY, waveRef.current.y);
        gl.uniform1f(cu.alpha, (dayRef.current && !coreRef.current ? 2.2 : 1.7) * Math.max(st.curtainAlpha, 0.6));
        gl.uniform1f(cu.ripple, speaking ? 1 : 0);
        gl.uniform1f(cu.rippleAge, t - e.rippleAt);
        const inkWaves = dayRef.current && !coreRef.current;   // on a dark core, white still reads best
        gl.uniform1f(cu.inkMode, inkWaves ? 1 : 0);
        gl.uniform3fv(cu.ink, inkWaves ? st.ink : st.light);
        if (inkWaves) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.POINTS, 0, curtainBuf.count);
        gl.blendFunc(gl.ONE, gl.ONE);
      }
    };

    let raf = 0, onScreen = true;
    const loop = (now: number) => { draw(now); raf = requestAnimationFrame(loop); };
    const startLoop = () => { if (!raf && onScreen && !document.hidden && !reduced) raf = requestAnimationFrame(loop); };
    const stopLoop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    const io = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; if (onScreen) startLoop(); else stopLoop(); });
    const onVis = () => (document.hidden ? stopLoop() : startLoop());
    const ro = new ResizeObserver(() => { resize(); if (reduced) draw(performance.now()); });
    ro.observe(canvas);
    io.observe(canvas);
    document.addEventListener('visibilitychange', onVis);
    if (reduced) draw(performance.now());
    startLoop();

    return () => {
      stopLoop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      [ringBuf, haloBuf, curtainBuf, moteBuf].forEach((b) => gl.deleteBuffer(b.buf));
      gl.deleteBuffer(quadBuf);
      [ringProg, curtainProg, glowProg, moteProg].forEach((pr) => gl.deleteProgram(pr));
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }} />;
}
