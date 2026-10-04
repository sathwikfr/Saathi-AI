'use client';

import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { NOISE, syllables, type OrbMode, type SaathiOrbHandle } from './SaathiOrb';

/**
 * Saathi's voice orb: a living glass blob, never a fixed circle.
 *
 * - Body: a ball whose surface keeps rolling into soft bumps, drawn as a net of
 *   glowing dots joined by fine lines (a geodesic mesh: no seams, no poles).
 *   Patches of the net light up and drift like signals. The net is brightest where
 *   the surface turns away from you and calm where it faces you, so captions over
 *   the middle stay readable.
 * - Glass: a see-through skin whose edge glows along the bumpy outline, with a
 *   crisp bright rim, a rainbow shimmer, a soft sheen and a sharp glint that
 *   slide over the bumps, a faint warm light from below, and drifting wisps.
 * - Ribbons: two translucent ribbons of light twist slowly inside the glass, a
 *   cyan one for Saathi and a pink one for the family; the speaker's ribbon
 *   brightens and turns faster.
 * - Inner light: a soft glow inside the glass (a pastel glow on light pages).
 * - Glow: the orb is also drawn small offscreen and blurred at two sizes (a tight
 *   glow and a wide halo), behind the crisp, anti-aliased orb.
 * - Dust: twinkling dots drift around it; the nearest are bigger and softer,
 *   like out of focus, and they swirl faster while someone talks.
 *
 * The voice moves it the way real audio would. Each word is broken into rough
 * sounds (vowels swell, m/n/l/r hum, s/sh/h hiss, t/k/p pop; Indian scripts by
 * their letters) and played as a loudness level, fast up and slower down. Every
 * syllable makes the ball breathe out and its rim and inner light flare, hissing
 * sounds make the net sparkle, and each syllable sends a thin ring of light across
 * the net in the speaker's colour: out from the centre while Saathi talks, in from
 * the rim while the family talks (sound leaving, sound arriving). Between words it
 * goes quiet.
 * Colours run blue -> violet -> magenta and lean cyan for Saathi, pink for the
 * family. Between turns ('thinking') it draws in, its ribbons spin up and an arc
 * of light circles the net. Ringing sends rings out and makes it shiver and puff
 * out dust; when the call ends it settles and dims.
 *
 * It also has weight and give under the pointer. It turns a little toward the
 * pointer, its glass catches the light from that side and its inner light drifts
 * over; the surface rises to meet the pointer with a glow, streams of light
 * flowing in toward it, and nearby dust moves aside. Move fast and it wobbles like
 * jelly. Press and the surface gives; drag and it stretches after you; let go and
 * it springs back with a ripple (a drag never counts as a tap). Phones get the
 * press and the ripple. Reduced motion: one still frame, no touch effects.
 *
 * On light pages ('day') the same orb is laid down as deeper ink with a coloured haze.
 * Same controls as SaathiOrb (`mode`, `variant`, and the ref handle: setMode,
 * pulse, say, level, echo). Raw WebGL1, no libraries.
 */

const PALETTE = {
  night: { blue: [0.22, 0.48, 1.0], violet: [0.52, 0.32, 1.0], magenta: [0.98, 0.3, 0.82], saathi: [0.3, 0.86, 1.0], family: [1.0, 0.38, 0.7] },
  day: { blue: [0.12, 0.3, 0.86], violet: [0.36, 0.18, 0.78], magenta: [0.72, 0.1, 0.55], saathi: [0.0, 0.46, 0.66], family: [0.8, 0.12, 0.42] },
};

// The two ribbons inside the glass: Saathi's (cyan into violet) and the family's (pink into blue).
const RIBBONS = [
  { who: 'saathi' as const, yaw: 0.4, pitch: 0.55, roll: 0.25, spin: 0.07, rad: 0.62, width: 0.16, twist: 1, speed: 0.22, to: 'violet' as const },
  { who: 'family' as const, yaw: -0.9, pitch: -0.45, roll: -0.6, spin: -0.05, rad: 0.52, width: 0.12, twist: 2, speed: -0.16, to: 'blue' as const },
];

// The voice's recent loudness, kept for the rings: HIST samples, HIST_DT apart (~0.46 s centre to rim).
const HIST = 24;
const HIST_DT = 1 / 50;

/* ---------- The voice: words as rough sounds, played like an audio level ---------- */

type Sound = 'vowel' | 'hum' | 'hiss' | 'stop';
// How long each kind of sound lasts (relative), how loud it is, and how much it hisses.
const SOUND: Record<Sound, { len: number; loud: number; hiss: number }> = {
  vowel: { len: 1, loud: 1, hiss: 0 },
  hum: { len: 0.55, loud: 0.5, hiss: 0 },      // m n l r w y
  hiss: { len: 0.7, loud: 0.26, hiss: 1 },     // s sh f h th
  stop: { len: 0.45, loud: 0.85, hiss: 0.4 },  // t k p b d g: a short silence, then a pop
};
type Bit = { k: Sound; len: number };
type Seg = { a: number; b: number; k: Sound; loud: number; hiss: number };

const LATIN: Record<string, Sound> = {};
for (const [letters, k] of [['aeiou', 'vowel'], ['lmnrwy', 'hum'], ['sfvzh', 'hiss'], ['bcdgjkpqtx', 'stop']] as const) {
  for (const c of letters) LATIN[c] = k;
}

function latinBits(word: string): Bit[] {
  // "BP" is said letter by letter: "bee pee" (but "ess", "em": the vowel comes first)
  if (/^[A-Z]{1,4}$/.test(word)) {
    return [...word].flatMap((ch): Bit[] => {
      const k = LATIN[ch.toLowerCase()] ?? 'stop';
      if (k === 'vowel') return [{ k, len: 1.2 }];
      return 'FLMNRSX'.includes(ch) ? [{ k: 'vowel', len: 1 }, { k, len: 1 }] : [{ k, len: 1 }, { k: 'vowel', len: 1.2 }];
    });
  }
  let w = word.toLowerCase().replace(/sh|th|ph/g, 'f').replace(/ch/g, 'j').replace(/ck/g, 'k');
  if (w.length > 2 && w.endsWith('e') && /[aeiouy]/.test(w.slice(0, -1))) w = w.slice(0, -1);   // silent e
  const out: Bit[] = [];
  [...w].forEach((ch, i) => {
    let k = LATIN[ch];
    if (!k) return;
    if (ch === 'y') k = i === 0 ? 'hum' : 'vowel';
    const last = out[out.length - 1];
    if (last && last.k === k && (k === 'vowel' || k === 'hiss')) last.len += 0.4;   // "aa", "ss": one longer sound
    else out.push({ k, len: 1 });
  });
  return out;
}

/** Indian scripts share one letter layout (Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam). */
function indicBits(word: string): Bit[] {
  const cps = [...word].map((c) => c.codePointAt(0) ?? 0);
  const indic = (cp: number) => cp >= 0x0900 && cp <= 0x0d7f;
  const out: Bit[] = [];
  cps.forEach((cp, i) => {
    if (!indic(cp)) return;
    const o = cp & 0x7f;
    if ((o >= 0x05 && o <= 0x14) || (o >= 0x3e && o <= 0x4c)) out.push({ k: 'vowel', len: 1.1 });   // a vowel letter or sign
    else if (o >= 0x01 && o <= 0x03) out.push({ k: 'hum', len: 0.7 });                             // nasal hum, breath
    else if (o >= 0x15 && o <= 0x39) {
      // A consonant: its own sound, then the 'a' it carries unless a vowel sign or virama follows.
      const nasal = [0x19, 0x1e, 0x23, 0x28, 0x2e].includes(o);
      out.push({ k: nasal || (o >= 0x2f && o <= 0x35) ? 'hum' : o >= 0x36 ? 'hiss' : 'stop', len: 1 });
      let j = i + 1;
      while (j < cps.length && indic(cps[j]) && (cps[j] & 0x7f) === 0x3c) j++;   // nukta
      const next = j < cps.length && indic(cps[j]) ? cps[j] & 0x7f : -1;
      const carries = !((next >= 0x3e && next <= 0x4c) || next === 0x4d);
      const hindiEnd = (cp & ~0x7f) === 0x0900 && j >= cps.length;           // Hindi drops a final 'a': "Ram", not "Rama"
      if (carries && !hindiEnd) out.push({ k: 'vowel', len: 0.9 });
    }
  });
  return out;
}

function wordBits(word: string): Bit[] {
  const w = word.replace(/[^\p{L}\p{M}]/gu, '');
  if (!w) return [];
  if (/[ऀ-ൿ]/.test(w)) return indicBits(w);
  if (/^[a-z]+$/i.test(w)) return latinBits(w);
  return Array.from({ length: syllables(w) }, (): Bit[] => [{ k: 'stop', len: 1 }, { k: 'vowel', len: 1 }]).flat();
}

/** Lays sounds out over `seconds` (the last tenth is the gap before the next word). */
function plan(bits: Bit[], seconds: number): Seg[] {
  const total = bits.reduce((a, b) => a + b.len * SOUND[b.k].len, 0);
  if (!total) return [];
  const unit = (seconds * 0.9) / total;
  let at = 0, stressed = false;
  return bits.map((b) => {
    const s = SOUND[b.k];
    const len = b.len * s.len * unit;
    // a little uneven, like a real voice; the first vowel is the loudest
    let loud = s.loud * (0.82 + 0.22 * Math.random());
    if (b.k === 'vowel' && !stressed) { loud *= 1.15; stressed = true; }
    const seg = { a: at, b: at + len, k: b.k, loud: Math.min(1, loud), hiss: s.hiss };
    at += len;
    return seg;
  });
}

/** Loudness and hiss of a planned word, `tau` seconds in. */
function sample(segs: Seg[], tau: number): [number, number] {
  for (const s of segs) {
    if (tau < s.a || tau >= s.b) continue;
    const x = (tau - s.a) / (s.b - s.a);
    if (s.k === 'stop') return x < 0.5 ? [0.03, 0] : [s.loud * Math.exp(-(x - 0.5) * 5), s.hiss * Math.exp(-(x - 0.5) * 8)];
    if (s.k === 'vowel') return [s.loud * Math.pow(Math.sin(Math.PI * (0.15 + 0.85 * x)), 0.4), 0];
    return [s.loud, s.hiss];
  }
  return [0, 0];
}

/** Made-up speech for when no words come (the mode alone says someone is talking): 1-3 syllables. */
function madeUp(n: number): Bit[] {
  const out: Bit[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    out.push({ k: r < 0.5 ? 'stop' : r < 0.8 ? 'hum' : 'hiss', len: 1 }, { k: 'vowel', len: 0.8 + Math.random() * 0.6 });
  }
  if (Math.random() < 0.4) out.push({ k: Math.random() < 0.5 ? 'hum' : 'hiss', len: 1 });
  return out;
}

/* ---------- The ball: one vertex shader, three looks (glass skin, lines, dots) ---------- */

const MESH_VERT = `
precision highp float;
attribute vec4 aV;                 // direction on the unit ball, seed
uniform mat3 uRot;
uniform float uTime; uniform float uScale; uniform float uAspect; uniform vec2 uShift;
uniform float uAmp; uniform float uFine; uniform float uFlow; uniform float uBreath; uniform float uPoint; uniform float uPx;
uniform vec3 uGrad; uniform float uFireAmt; uniform float uThink;
uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uSpeak; uniform float uSpeakMix;
uniform vec3 uTouch; uniform float uTouchAmp; uniform float uTouchWide; uniform float uTouchGlow;   // the pointer on the ball; how far and how wide the surface reaches for it; its glow
uniform vec3 uStretch; uniform float uSquash;                             // squash and stretch (direction x amount), a press
uniform vec4 uRip[3]; uniform vec3 uRipAmp;                               // ripples: where they started, their age; their strength
uniform vec4 uOut[6]; uniform vec4 uIn[6]; uniform float uEnvFrac; uniform float uRingsOn;   // syllable pings, newest first: going out, coming in
varying vec3 vCol; varying float vFres; varying float vFront; varying float vSeed; varying float vWisp; varying float vFire; varying vec3 vN; varying float vTouch; varying float vRing;
${NOISE}
float pickOut(float i) { float q = floor(i / 4.0); float c = i - q * 4.0; vec4 v = uOut[int(q)]; return c < 0.5 ? v.x : c < 1.5 ? v.y : c < 2.5 ? v.z : v.w; }
float pickIn(float i) { float q = floor(i / 4.0); float c = i - q * 4.0; vec4 v = uIn[int(q)]; return c < 0.5 ? v.x : c < 1.5 ? v.y : c < 2.5 ? v.z : v.w; }
// Each syllable sends a ring across the ball: its distance from the centre (rho, as seen, 0..1)
// grows with its age, out from the centre for Saathi's voice and in from the rim for the family's.
float rings(float rho) {
  if (uRingsOn < 0.5) return 0.0;
  float a = clamp(rho * ${HIST - 1}.0 - uEnvFrac, 0.0, ${HIST - 2}.999);
  float b = clamp((1.0 - rho) * ${HIST - 1}.0 - uEnvFrac, 0.0, ${HIST - 2}.999);
  float ia = floor(a); float ib = floor(b);
  return mix(pickOut(ia), pickOut(ia + 1.0), a - ia) + mix(pickIn(ib), pickIn(ib + 1.0), b - ib);
}
// Ripples running out over the ball from where it was touched.
float ripples(vec3 dv) {
  float s = 0.0;
  if (uRipAmp.x + uRipAmp.y + uRipAmp.z <= 0.0) return s;
  for (int i = 0; i < 3; i++) {
    float x = acos(clamp(dot(dv, uRip[i].xyz), -1.0, 1.0)) - uRip[i].w * 2.6;
    s += uRipAmp[i] * sin(x * 9.0) * exp(-x * x * 5.0) * exp(-uRip[i].w * 1.4);
  }
  return s;
}
// How far out the surface is in direction d: slow big bumps and finer ones, a soft mound
// rising toward the pointer (or a dent under a press) in a slight dip like a stretched skin,
// squash and stretch, ripples, and the voice's rings.
float field(vec3 d) {
  vec3 dv = uRot * d;
  float n = snoise(d * 1.2 + vec3(0.0, uFlow * 0.5, uTime * 0.11));
  float f = snoise(d * 2.6 + vec3(uFlow, 0.0, uTime * 0.19));
  float r = uBreath + uAmp * n + uFine * f;
  float c = 1.0 - dot(dv, uTouch);
  r += uTouchAmp * (exp(-c * uTouchWide) - 0.22 * exp(-c * 2.5));
  float sl = max(length(uStretch), 1e-4);
  float sd = dot(dv, uStretch);
  r *= 1.0 + 1.5 * sd * sd / sl - 0.5 * sl - 0.04 * uSquash;   // keeps the volume about the same
  r += 0.045 * ripples(dv);
  float rho = length(dv.xy);
  r += 0.07 * rings(rho) * smoothstep(0.05, 0.4, rho);
  return r;
}
void main() {
  vec3 d = aV.xyz;
  vec3 p = d * field(d);
  // The surface normal, from two neighbouring points.
  vec3 up = abs(d.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t1 = normalize(cross(up, d));
  vec3 t2 = cross(d, t1);
  vec3 d1 = normalize(d + t1 * 0.03);
  vec3 d2 = normalize(d + t2 * 0.03);
  vec3 n = normalize(cross(d1 * field(d1) - p, d2 * field(d2) - p));
  if (dot(n, d) < 0.0) n = -n;

  vec3 dv = uRot * d;
  vec3 pr = uRot * p;
  vec3 nr = normalize(uRot * n);
  float cam = 4.5;
  vec3 view = normalize(vec3(-pr.xy, cam - pr.z));
  float facing = dot(nr, view);
  vFres = 1.0 - abs(facing);                     // 1 where the surface turns away (the outline)
  vFront = smoothstep(-0.2, 0.2, pr.z);          // 1 on the near side
  vN = nr;

  // Blue up and to the left, violet across the middle, magenta down and to the right; held
  // still while the ball turns, like a light (drifting slowly). The speaker's colour leans in.
  float g = clamp(0.5 + 0.5 * dot(normalize(pr), uGrad), 0.0, 1.0);
  vec3 col = mix(uC1, uC2, smoothstep(0.1, 0.55, g));
  col = mix(col, uC3, smoothstep(0.5, 0.95, g));
  vCol = mix(col, uSpeak, uSpeakMix);
  vSeed = aV.w;
  float w = snoise(pr * 1.3 + vec3(0.0, uTime * 0.15, -uTime * 0.1));
  vWisp = exp(-w * w * 9.0);                     // thin drifting bands of light inside the glass

  // Light on the net: drifting patches; under the pointer a glow, with streaks of light
  // streaming in toward it from all round (noise laid out by distance from the pointer, flowing
  // inward); the voice's rings (faint over the middle, where the captions sit); ripples; and
  // while Saathi thinks, an arc of light circling like a loader.
  float act = snoise(d * 2.2 + vec3(uTime * 0.32, -uTime * 0.21, uFlow * 0.7));
  float tc = 1.0 - dot(dv, uTouch);
  float streams = 0.0;
  if (uTouchGlow > 0.01) {
    vec3 tu = normalize(cross(uTouch, abs(uTouch.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
    float around = atan(dot(dv, cross(uTouch, tu)), dot(dv, tu));
    float inflow = snoise(vec3(sqrt(2.0 * max(tc, 0.0)) * 4.0 + uTime * 2.2, cos(around) * 1.6, sin(around) * 1.6 + aV.w * 0.2));
    streams = smoothstep(0.25, 0.75, inflow) * exp(-tc * 2.2) * smoothstep(0.0, 0.05, tc);
  }
  vTouch = uTouchGlow * exp(-tc * 10.0);
  float touch = uTouchGlow * (exp(-tc * 18.0) * (0.75 + 0.25 * sin(uTime * 9.0 + aV.w * 30.0)) + 0.9 * streams);
  float rho = length(dv.xy);
  vRing = clamp(rings(rho), 0.0, 1.0) * smoothstep(0.3, 0.8, rho);
  float arc = uThink * pow(max(cos(atan(pr.y, pr.x) - uTime * 4.5), 0.0), 18.0);
  vFire = clamp(smoothstep(0.55, 0.85, act) * uFireAmt + touch + abs(ripples(dv)) * 0.7 + arc, 0.0, 1.0);

  float k = cam / (cam - pr.z);                  // perspective
  vec2 q = pr.xy * k + uShift;
  gl_Position = vec4(q.x * uScale / uAspect, q.y * uScale, 0.0, 1.0);
  gl_PointSize = uPoint * uPx * (0.6 + 0.8 * aV.w) * (0.6 + 0.8 * vFres) * k * (1.0 + 1.4 * vFire + 0.9 * vRing);
}`;

const MESH_VARYINGS = `
varying vec3 vCol; varying float vFres; varying float vFront; varying float vSeed; varying float vWisp; varying float vFire; varying vec3 vN; varying float vTouch; varying float vRing;`;

// Output: premultiplied colour. Light pages lay colour down like ink; dark pages add light
// (alpha follows brightness, so faint light never paints black over the page).
const OUT = `
  if (uFInk > 0.5) {
    a = clamp(a, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
  } else {
    vec3 c = col * a;
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }`;

const SKIN_FRAG = `
precision mediump float;
${MESH_VARYINGS}
uniform float uFTime; uniform float uFAlpha; uniform float uFInk; uniform float uFVoice; uniform float uFGloss;
uniform vec3 uFLight; uniform vec3 uFGlint;    // the glass lights: up and to the left, swinging toward the pointer
void main() {
  float fres = clamp(vFres, 0.0, 1.0);
  vec3 n = normalize(vN);
  float rim = pow(fres, 2.4) * (1.0 + uFVoice * mix(0.45, 0.15, uFInk));   // the glowing edge flares with the voice
  float edge = pow(fres, 9.0);                                // the crisp bright rim of the glass
  // a rainbow shimmer along the glass edge
  vec3 irid = 0.55 + 0.45 * cos(6.2831 * (fres * 0.9 + vec3(0.0, 0.33, 0.67) + uFTime * 0.04));
  vec3 col = mix(vCol, irid, 0.45 * pow(fres, 3.0) * (1.0 - 0.7 * uFInk));
  float a = 0.03 + 0.75 * rim + vWisp * (0.04 + 0.1 * uFVoice) * (1.0 - rim) + vFire * 0.06;
  // A soft sheen and a sharp glint that slide over the bumps, and a faint warm light from
  // down and to the right.
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  float sheen = pow(max(dot(n, uFLight), 0.0), 40.0);
  float glint = smoothstep(0.975, 0.992, dot(r, uFGlint));
  float spec = (sheen * 0.5 + glint * 0.8) * vFront * uFGloss;
  float warm = pow(max(dot(n, normalize(vec3(0.75, -0.55, 0.35))), 0.0), 12.0) * uFGloss;
  col = mix(col, mix(irid, vec3(1.0), 0.5), edge * 0.6 * uFGloss);
  col = mix(col, vec3(1.0), clamp(spec, 0.0, 1.0) * 0.7);
  col += warm * vec3(0.5, 0.15, 0.35);
  // under the pointer the glass lights up softly, like a fingertip on frosted glass (a pastel
  // tint of its colour on light pages)
  float tl = clamp(vTouch, 0.0, 1.0);
  col = mix(col, mix(vec3(0.82, 0.93, 1.0), mix(vCol, vec3(1.0), 0.35), uFInk), tl * 0.6);
  a = (a + spec * 0.3 + edge * 0.45 + warm * 0.12 + tl * tl * mix(0.5, 0.3, uFInk)) * uFAlpha;
${OUT}
}`;

const LINE_FRAG = `
precision mediump float;
${MESH_VARYINGS}
uniform float uFAlpha; uniform float uFInk; uniform vec3 uFRing;
void main() {
  float fres = clamp(vFres, 0.0, 1.0);
  float a = (0.1 + 0.9 * pow(fres, 1.5) + vFire * mix(0.8, 0.4, uFInk) + vRing * mix(0.7, 0.4, uFInk)) * mix(0.18, 1.0, vFront) * uFAlpha;
  vec3 col = mix(vCol, vec3(1.0), (0.25 * pow(fres, 4.0) + 0.45 * vFire) * (1.0 - uFInk));
  col = mix(col, uFRing, vRing * 0.75);          // the voice's rings, in the speaker's colour
${OUT}
}`;

const NODE_FRAG = `
precision mediump float;
${MESH_VARYINGS}
uniform float uFTime; uniform float uFAlpha; uniform float uFInk; uniform float uFHiss; uniform vec3 uFRing;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float l = length(pc);
  if (l > 0.5) discard;
  float tw = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(uFTime * (1.0 + vSeed * 2.0) + vSeed * 40.0), 3.0);
  tw += uFHiss * 1.4 * pow(0.5 + 0.5 * sin(uFTime * 31.0 + vSeed * 97.0), 8.0);   // hissing sounds sparkle
  float a = smoothstep(0.5, 0.0, l) * (tw + vFire * mix(1.3, 0.6, uFInk) + vRing * mix(1.0, 0.5, uFInk)) * (0.25 + 0.75 * clamp(vFres, 0.0, 1.0)) * mix(0.2, 1.0, vFront) * uFAlpha;
  vec3 col = mix(vCol, vec3(1.0), (0.35 + 0.4 * vFire) * (1.0 - uFInk));
  col = mix(col, uFRing, vRing * 0.7);
${OUT}
}`;

/* ---------- Ribbons: translucent bands of light twisting inside the glass ---------- */

const RIBBON_VERT = `
precision highp float;
attribute vec2 aR;                 // along the loop (0..1), across the ribbon (-1..1)
uniform mat3 uRot; uniform mat3 uRib;
uniform float uScale; uniform float uAspect; uniform vec2 uShift;
uniform float uRad; uniform float uWidth; uniform float uTwist; uniform float uPhase; uniform float uWob;
uniform vec3 uCa; uniform vec3 uCb;
varying vec3 vCol; varying float vA;
// The ribbon's centre line: a wavy loop around the inside of the ball.
vec3 loopAt(float a) {
  vec3 c = vec3(cos(a), 0.0, sin(a)) * uRad;
  c.y = 0.22 * sin(a * 2.0 + uPhase) + 0.08 * sin(a * 3.0 - uPhase * 1.3);
  c.xz *= 1.0 + uWob * 0.15 * sin(a * 3.0 + uPhase * 0.7);
  return uRib * c;
}
void main() {
  float a = aR.x * 6.28318530718;
  vec3 c = loopAt(a);
  vec3 T = normalize(loopAt(a + 0.01) - c);
  vec3 N0 = normalize(cross(T, uRib * vec3(0.0, 1.0, 0.0)));
  vec3 B = cross(T, N0);
  float th = a * uTwist + uPhase;                // whole turns, so the loop closes cleanly
  vec3 W = cos(th) * N0 + sin(th) * B;
  float w = uWidth * (0.55 + 0.45 * sin(a * 2.0 - uPhase * 0.8));
  vec3 p = uRot * (c + W * aR.y * w);
  vec3 n = normalize(uRot * cross(T, W));
  float edgeOn = 1.0 - abs(n.z);
  float k = 4.5 / (4.5 - p.z);
  vec2 q = p.xy * k;
  gl_Position = vec4((q.x + uShift.x) * uScale / uAspect, (q.y + uShift.y) * uScale, 0.0, 1.0);
  // Brightest where the ribbon folds edge-on and along its two edges; faint in the middle of
  // the ball (behind the captions) and at the back.
  float side = abs(aR.y);
  vA = (0.05 + 0.55 * pow(edgeOn, 2.0) + 0.4 * pow(side, 6.0))
     * mix(0.3, 1.0, smoothstep(0.12, 0.6, length(q)))
     * (0.6 + 0.4 * smoothstep(-0.5, 0.5, p.z));
  vCol = mix(uCa, uCb, 0.5 + 0.5 * sin(a + uPhase * 0.5));
}`;

const RIBBON_FRAG = `
precision mediump float;
varying vec3 vCol; varying float vA;
uniform float uFAlpha; uniform float uFInk;
void main() {
  float a = vA * uFAlpha;
  vec3 col = vCol;
${OUT}
}`;

/* ---------- Dust: a loose cloud of twinkling dots around the ball ---------- */

const DUST_VERT = `
precision highp float;
attribute vec4 aD;                 // direction, seed
uniform mat3 uRot; uniform float uTime; uniform float uScale; uniform float uAspect; uniform vec2 uShift;
uniform float uPush; uniform float uPoint; uniform float uPx; uniform float uSwirl;
uniform vec2 uPtr; uniform float uPtrAmt;
uniform vec3 uC1; uniform vec3 uC3; uniform vec3 uGrad;
varying vec3 vCol; varying float vA;
void main() {
  float s = aD.w;
  float r = 1.22 + 0.32 * fract(s * 7.13) + uPush * (0.5 + s);
  float sw = uSwirl * (0.4 + s);                 // each dot circles at its own pace
  float cs = cos(sw), sn = sin(sw);
  vec3 d0 = vec3(cs * aD.x + sn * aD.z, aD.y, -sn * aD.x + cs * aD.z);
  vec3 d = normalize(d0 + 0.15 * vec3(sin(uTime * 0.3 + s * 20.0), cos(uTime * 0.27 + s * 13.0), sin(uTime * 0.23 + s * 7.0)));
  vec3 p = uRot * (d * r);
  float k = 4.5 / (4.5 - p.z);
  vec2 q = p.xy * k;
  // dots near the pointer drift out of its way
  vec2 dq = q - uPtr;
  float aside = uPtrAmt * exp(-dot(dq, dq) * 4.0);
  q += dq / max(length(dq), 0.05) * aside * 0.25 + uShift * 0.7;
  gl_Position = vec4(q.x * uScale / uAspect, q.y * uScale, 0.0, 1.0);
  float g = clamp(0.5 + 0.5 * dot(normalize(p), uGrad), 0.0, 1.0);
  vCol = mix(uC1, uC3, g);
  float tw = pow(0.5 + 0.5 * sin(uTime * (0.8 + s * 1.7) + s * 31.0), 4.0);
  float near = smoothstep(0.5, 1.5, p.z);        // the nearest dots: bigger and softer, out of focus
  vA = (0.15 + 0.85 * tw) * smoothstep(1.9, 1.45, r) * (p.z > -0.2 ? 1.0 : 0.45) * (1.0 - 0.6 * near) * (1.0 + 0.6 * aside);
  gl_PointSize = uPoint * uPx * (0.6 + 0.9 * fract(s * 3.7)) * k * (1.0 + 2.0 * near);
}`;

const DUST_FRAG = `
precision mediump float;
varying vec3 vCol; varying float vA;
uniform float uFAlpha; uniform float uFInk;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float l = length(pc);
  if (l > 0.5) discard;
  float a = smoothstep(0.5, 0.0, l) * vA * uFAlpha;
  vec3 col = vCol;
${OUT}
}`;

/* ---------- Glow: shrink, blur, and add back at two sizes ---------- */

const QUAD_VERT = `
attribute vec2 aQ;
varying vec2 vUv;
void main() {
  vUv = aQ * 0.5 + 0.5;
  gl_Position = vec4(aQ, 0.0, 1.0);
}`;

const DOWN_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex; uniform vec2 uTexel;     // one texel of the bigger source
void main() {
  vec4 c = texture2D(uTex, vUv + uTexel * vec2(-1.0, -1.0));
  c += texture2D(uTex, vUv + uTexel * vec2(1.0, -1.0));
  c += texture2D(uTex, vUv + uTexel * vec2(-1.0, 1.0));
  c += texture2D(uTex, vUv + uTexel * vec2(1.0, 1.0));
  gl_FragColor = c * 0.25;
}`;

const BLUR_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex; uniform vec2 uStep;
void main() {
  vec4 c = texture2D(uTex, vUv) * 0.227;
  c += (texture2D(uTex, vUv + uStep) + texture2D(uTex, vUv - uStep)) * 0.1945;
  c += (texture2D(uTex, vUv + uStep * 2.0) + texture2D(uTex, vUv - uStep * 2.0)) * 0.1216;
  c += (texture2D(uTex, vUv + uStep * 3.0) + texture2D(uTex, vUv - uStep * 3.0)) * 0.054;
  c += (texture2D(uTex, vUv + uStep * 4.0) + texture2D(uTex, vUv - uStep * 4.0)) * 0.0162;
  gl_FragColor = c;
}`;

// Three soft lobes of light drifting round each other a little below the centre (the
// captions sit above it), leaning toward the pointer. Dark pages: light inside the glass;
// light pages: a pastel glow.
const CORE_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform float uCAspect; uniform float uCScale; uniform float uCSwirl; uniform float uCAmt; uniform float uCR; uniform float uCInk; uniform vec2 uCOff;
uniform vec3 uK1; uniform vec3 uK2; uniform vec3 uK3;
void main() {
  vec2 p = vec2((vUv.x * 2.0 - 1.0) * uCAspect, vUv.y * 2.0 - 1.0) / uCScale + vec2(0.0, 0.1) - uCOff;
  float sw = uCSwirl;
  vec2 c1 = 0.2 * vec2(cos(sw), sin(sw * 1.3));
  vec2 c2 = 0.2 * vec2(cos(sw * 0.8 + 2.1), sin(sw * 1.1 + 2.1));
  vec2 c3 = 0.2 * vec2(cos(sw * 1.2 + 4.2), sin(sw * 0.9 + 4.2));
  float r2 = uCR * uCR;
  float g1 = exp(-dot(p - c1, p - c1) / r2);
  float g2 = exp(-dot(p - c2, p - c2) / r2);
  float g3 = exp(-dot(p - c3, p - c3) / r2);
  float g = g1 + g2 + g3;
  vec3 col = (uK1 * g1 + uK2 * g2 + uK3 * g3) / max(g, 1e-4);
  if (uCInk > 0.5) {
    float a = clamp(g * 0.45 * uCAmt, 0.0, 0.7);
    gl_FragColor = vec4(col * a, a);
  } else {
    vec3 c = col * g * 0.45 * uCAmt;
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
}`;

const GLOW_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTight; uniform sampler2D uWide; uniform float uTightAmt; uniform float uWideAmt;
void main() {
  gl_FragColor = clamp(texture2D(uTight, vUv) * uTightAmt + texture2D(uWide, vUv) * uWideAmt, 0.0, 1.0);
}`;

/* ---------- Helpers ---------- */

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('SaathiBlob shader:', gl.getShaderInfoLog(sh));
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
    console.warn('SaathiBlob link:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

/** A geodesic ball: evenly spread points (with a random seed each), its triangles and its unique edges. */
function geodesic(level: number) {
  const g = (1 + Math.sqrt(5)) / 2;
  const unit = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const pts: number[][] = [
    [-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g],
    [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1],
  ].map(unit);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      pts.push(unit([(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2, (pts[a][2] + pts[b][2]) / 2]));
      cache.set(key, pts.length - 1);
      return pts.length - 1;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const verts = new Float32Array(pts.length * 4);
  pts.forEach((p, i) => { verts.set([p[0], p[1], p[2], Math.random()], i * 4); });
  const edgeSet = new Set<string>();
  const edges: number[] = [];
  for (const [a, b, c] of faces) {
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const key = x < y ? `${x}_${y}` : `${y}_${x}`;
      if (!edgeSet.has(key)) { edgeSet.add(key); edges.push(x, y); }
    }
  }
  return { verts, tris: new Uint16Array(faces.flat()), edges: new Uint16Array(edges) };
}

/** A ribbon as a grid: `along` steps around the loop, `across` steps over its width. */
function ribbonGrid(along: number, across: number) {
  const verts = new Float32Array((along + 1) * (across + 1) * 2);
  let i = 0;
  for (let a = 0; a <= along; a++) {
    for (let b = 0; b <= across; b++) { verts[i++] = a / along; verts[i++] = (b / across) * 2 - 1; }
  }
  const at = (a: number, b: number) => a * (across + 1) + b;
  const idx: number[] = [];
  for (let a = 0; a < along; a++) {
    for (let b = 0; b < across; b++) idx.push(at(a, b), at(a + 1, b), at(a, b + 1), at(a, b + 1), at(a + 1, b), at(a + 1, b + 1));
  }
  return { verts, idx: new Uint16Array(idx) };
}

function dustPoints(count: number) {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    out.set([r * Math.cos(a), z, r * Math.sin(a), Math.random()], i * 4);
  }
  return out;
}

/** Rotation (yaw about y, then pitch about x, then roll about z) as a column-major mat3. */
function rotation(yaw: number, pitch: number, roll: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const mul = (a: number[], b: number[]) => {
    const o = new Array(9).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
    return o;
  };
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const Rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  const m = mul(Rz, mul(Rx, Ry));
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

type Spring = { x: number; v: number };
const spring = (): Spring => ({ x: 0, v: 0 });

/** Moves a spring toward `to` over `dt` seconds: `hz` is how fast it swings, `damp` below 1 lets it overshoot and wobble. */
function settle(s: Spring, to: number, hz: number, damp: number, dt: number) {
  const w = 2 * Math.PI * hz;
  const n = Math.max(1, Math.ceil(dt / 0.004));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (w * w * (to - s.x) - 2 * damp * w * s.v) * h;
    s.x += s.v * h;
  }
}

const smooth = (a: number, b: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const norm3 = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const mix3 = (a: number[], b: number[], k: number) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/**
 * The direction of the point on the ball seen at (x, y) (ball units on screen): where the
 * eye's ray through it meets the ball, or, past the outline, the point it passes closest to.
 * (The shaders' camera sits 4.5 out; the ball's surface averages a little over 1.)
 */
function onBall(x: number, y: number, radius = 1.04) {
  const cam = 4.5;
  const a = x * x + y * y + cam * cam;
  const b = -2 * cam * cam;
  const disc = b * b - 4 * a * (cam * cam - radius * radius);
  const t = disc >= 0 ? (-b - Math.sqrt(disc)) / (2 * a) : -b / (2 * a);
  return norm3([x * t, y * t, cam - cam * t]);
}

// The glass lights when nobody points: a sheen up and to the left, a glint just past it.
const SHEEN = norm3([-0.45, 0.55, 1.0]);
const GLINT = norm3([-0.5, 0.62, 0.6]);

type Target = { fb: WebGLFramebuffer | null; tex: WebGLTexture | null; w: number; h: number; ok: boolean };

function makeTarget(gl: WebGLRenderingContext, w: number, h: number): Target {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, w, h, ok };
}

function dropTarget(gl: WebGLRenderingContext, t: Target | null) {
  if (!t) return;
  gl.deleteFramebuffer(t.fb);
  gl.deleteTexture(t.tex);
}

type Props = {
  mode?: OrbMode;
  /** Ball radius as a fraction of the canvas half-height (default 0.6: fills the hero's orb footprint). */
  scale?: number;
  /** 'night' for dark pages (default), 'day' for light pages (ink on the page). */
  variant?: 'night' | 'day';
  className?: string;
  ref?: React.Ref<SaathiOrbHandle>;
};

export function SaathiBlob({ mode = 'idle', scale = 0.6, variant = 'night', className, ref }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef(scale);
  const dayRef = useRef(variant === 'day');
  const engine = useRef({
    mode: 'idle' as OrbMode,
    rings: [] as number[],
    now: 0,
    word: { at: -10, end: -10, segs: [] as Seg[] },   // the word being said, as rough sounds
    lastSay: -10,                                     // when a real word last came (without words it makes up speech)
    levelAt: -10,
    level: 0,
    redraw: null as null | (() => void),  // set while reduced motion keeps the loop off
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
  }));

  useEffect(() => { engine.current.mode = mode; engine.current.redraw?.(); }, [mode]);
  useEffect(() => { scaleRef.current = scale; engine.current.redraw?.(); }, [scale]);
  useEffect(() => { dayRef.current = variant === 'day'; engine.current.redraw?.(); }, [variant]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Anti-aliased: the crisp orb is drawn straight onto the canvas (the glow is drawn offscreen).
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
    const skinProg = gl && link(gl, MESH_VERT, SKIN_FRAG);
    const lineProg = gl && link(gl, MESH_VERT, LINE_FRAG);
    const nodeProg = gl && link(gl, MESH_VERT, NODE_FRAG);
    const ribbonProg = gl && link(gl, RIBBON_VERT, RIBBON_FRAG);
    const dustProg = gl && link(gl, DUST_VERT, DUST_FRAG);
    const downProg = gl && link(gl, QUAD_VERT, DOWN_FRAG);
    const blurProg = gl && link(gl, QUAD_VERT, BLUR_FRAG);
    const glowProg = gl && link(gl, QUAD_VERT, GLOW_FRAG);
    const coreProg = gl && link(gl, QUAD_VERT, CORE_FRAG);
    if (!gl || !skinProg || !lineProg || !nodeProg || !ribbonProg || !dustProg || !downProg || !blurProg || !glowProg || !coreProg) {
      canvas.dataset.fallback = 'true';
      return;
    }

    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    const ball = geodesic(4);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, ball.verts, gl.STATIC_DRAW);
    const triIbo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ball.tris, gl.STATIC_DRAW);
    const edgeIbo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ball.edges, gl.STATIC_DRAW);
    const nodeCount = ball.verts.length / 4;
    const rib = ribbonGrid(small ? 140 : 200, 6);
    const ribVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ribVbo);
    gl.bufferData(gl.ARRAY_BUFFER, rib.verts, gl.STATIC_DRAW);
    const ribIbo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ribIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, rib.idx, gl.STATIC_DRAW);
    const dust = dustPoints(small ? 260 : 460);
    const dustBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
    gl.bufferData(gl.ARRAY_BUFFER, dust, gl.STATIC_DRAW);
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const locs = (prog: WebGLProgram, names: string[]) =>
      Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)])) as Record<string, WebGLUniformLocation | null>;
    const MESH_U = ['uRot', 'uTime', 'uScale', 'uAspect', 'uShift', 'uAmp', 'uFine', 'uFlow', 'uBreath', 'uPoint', 'uPx', 'uGrad', 'uFireAmt', 'uThink',
      'uC1', 'uC2', 'uC3', 'uSpeak', 'uSpeakMix', 'uTouch', 'uTouchAmp', 'uTouchWide', 'uTouchGlow', 'uStretch', 'uSquash', 'uRip', 'uRipAmp', 'uOut', 'uIn', 'uEnvFrac', 'uRingsOn',
      'uFTime', 'uFAlpha', 'uFInk', 'uFVoice', 'uFGloss', 'uFLight', 'uFGlint', 'uFHiss', 'uFRing'];
    const meshProgs = [skinProg, lineProg, nodeProg].map((prog) => ({ prog, u: locs(prog, MESH_U), aV: gl.getAttribLocation(prog, 'aV') }));
    const [skin, lines, nodes] = meshProgs;
    const ru = locs(ribbonProg, ['uRot', 'uRib', 'uScale', 'uAspect', 'uShift', 'uRad', 'uWidth', 'uTwist', 'uPhase', 'uWob', 'uCa', 'uCb', 'uFAlpha', 'uFInk']);
    const aR = gl.getAttribLocation(ribbonProg, 'aR');
    const du = locs(dustProg, ['uRot', 'uTime', 'uScale', 'uAspect', 'uShift', 'uPush', 'uPoint', 'uPx', 'uSwirl', 'uPtr', 'uPtrAmt', 'uC1', 'uC3', 'uGrad', 'uFAlpha', 'uFInk']);
    const aD = gl.getAttribLocation(dustProg, 'aD');
    const downU = locs(downProg, ['uTex', 'uTexel']);
    const blurU = locs(blurProg, ['uTex', 'uStep']);
    const glowU = locs(glowProg, ['uTight', 'uWide', 'uTightAmt', 'uWideAmt']);
    const quadA = [downProg, blurProg, glowProg].map((p) => gl.getAttribLocation(p, 'aQ'));
    const cu = locs(coreProg, ['uCAspect', 'uCScale', 'uCSwirl', 'uCAmt', 'uCR', 'uCInk', 'uCOff', 'uK1', 'uK2', 'uK3']);
    const coreA = gl.getAttribLocation(coreProg, 'aQ');

    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    // Offscreen: the orb at half size (the glow's source), a quarter-size pair (the tight
    // glow) and an eighth-size pair (the wide halo).
    let width = 1, height = 1, dpr = 1;
    let src: Target | null = null, tA: Target | null = null, tB: Target | null = null, wA: Target | null = null, wB: Target | null = null;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      [src, tA, tB, wA, wB].forEach((t) => dropTarget(gl, t));
      const sized = (div: number) => makeTarget(gl, Math.max(1, Math.round(width / div)), Math.max(1, Math.round(height / div)));
      src = sized(2);
      tA = sized(4);
      tB = sized(4);
      wA = sized(8);
      wB = sized(8);
    };
    resize();

    const e = engine.current;

    // The pointer, in ball units around the orb's centre (y up), and springs that give the
    // orb weight: it turns and leans toward the pointer, the surface reaches for it, lags a
    // little behind, overshoots and wobbles.
    const ptr = { x: 9, y: 9, cx: 0, cy: 0, on: false, down: false, dragged: false, px: 0, py: 0, vx: 0, vy: 0, at: 0, inside: false, lastRip: -10 };
    const sp = {
      tx: spring(), ty: spring(),   // where the mound is
      amp: spring(),                // how far the surface reaches for the pointer (+) or gives under a press (-)
      glow: spring(),
      sx: spring(), sy: spring(),   // squash and stretch
      lx: spring(), ly: spring(),   // lean: the whole orb drifts a little
      ax: spring(), ay: spring(),   // turn
      squash: spring(),
    };
    const rips: { d: number[]; t0: number; amp: number }[] = [];
    let swallowClick = false;
    const ballAt = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const unit = (scaleRef.current * rect.height) / 2;   // px per ball unit
      return [(clientX - rect.left - rect.width / 2) / unit, -(clientY - rect.top - rect.height / 2) / unit];
    };
    const ripple = (x: number, y: number, amp: number) => {
      rips.push({ d: onBall(x, y), t0: e.now, amp });
      if (rips.length > 3) rips.shift();
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType === 'touch' && !ptr.down) return;
      const [x, y] = ballAt(ev.clientX, ev.clientY);
      const gap = (ev.timeStamp - ptr.at) / 1000;
      if (ptr.on && gap > 0.004 && gap < 0.2) {
        const k = Math.min(1, gap / 0.06);
        ptr.vx += ((x - ptr.x) / gap - ptr.vx) * k;
        ptr.vy += ((y - ptr.y) / gap - ptr.vy) * k;
      }
      ptr.x = x;
      ptr.y = y;
      ptr.cx = ev.clientX;
      ptr.cy = ev.clientY;
      ptr.at = ev.timeStamp;
      ptr.on = true;
      if (ptr.down && !ptr.dragged && Math.hypot(x - ptr.px, y - ptr.py) > 0.07) ptr.dragged = true;
      // touching the surface sends a soft ripple out from that point
      const inside = Math.hypot(x, y) < 1;
      if (inside && !ptr.inside && !ptr.down && e.now - ptr.lastRip > 0.6) { ripple(x, y, 0.35); ptr.lastRip = e.now; }
      ptr.inside = inside;
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const [x, y] = ballAt(ev.clientX, ev.clientY);
      if (Math.hypot(x, y) > 1.08) return;
      if ((ev.target as Element | null)?.closest?.('a, input, select, textarea, label, [contenteditable="true"]')) return;
      Object.assign(ptr, { x, y, cx: ev.clientX, cy: ev.clientY, px: x, py: y, on: true, down: true, dragged: false, vx: 0, vy: 0, at: ev.timeStamp, inside: Math.hypot(x, y) < 1 });
    };
    const onUp = (ev: PointerEvent) => {
      if (!ptr.down) return;
      ptr.down = false;
      ripple(sp.tx.x, sp.ty.x, ptr.dragged ? 1 : 0.8);
      ptr.lastRip = e.now;
      // a drag is play, not a tap: the click that follows it doesn't start anything
      if (ptr.dragged) { swallowClick = true; window.setTimeout(() => { swallowClick = false; }, 0); }
      if (ev.pointerType === 'touch') ptr.on = false;   // a lifted finger leaves no hover behind
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
    if (!reduced) {
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerdown', onDown, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
      window.addEventListener('pointercancel', onCancel, { passive: true });
      window.addEventListener('pointerout', onOut, { passive: true });
      window.addEventListener('blur', onBlur);
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('click', onClick, true);
    }

    // Recent syllable pings, for the rings: going out (Saathi, ringing) and coming in (the family).
    const histOut = new Float32Array(HIST), histIn = new Float32Array(HIST);
    let histAcc = 0;
    const ripU = new Float32Array(12), ripA = new Float32Array(3);

    const st = {
      loud: 0, hiss: 0, talk: 0, gap: 0, ping: 0, prevT: 0, vSaathi: 0, vFamily: 0, amp: 0.13, flow: 0, spin: 0, dir: 1, glow: 0.9, push: 0, swirl: 0,
      speakMix: 0, fire: 0.35, speak: [...PALETTE.night.saathi], ribPhase: [0, 2.1], nextRing: 0, ringStep: 0, lastT: 0,
      think: 0, core: 0.24, coreSwirl: 0, aside: 0, wide: 0,
    };
    const start = performance.now();

    const draw = (nowMs: number) => {
      const t = (nowMs - start) / 1000;
      const dt = Math.min(0.05, Math.max(0, t - st.lastT));
      // Easing follows real time (same feel at 60 fps, and no slow-motion on a slow phone).
      const step = Math.min(1, Math.max(0, t - st.lastT));
      const ease = (rate: number) => 1 - Math.exp(-rate * step);
      st.lastT = t;
      e.now = t;
      const m = e.mode;
      const speaking = m === 'saathi' || m === 'family';
      const thinking = m === 'thinking';
      const day = dayRef.current;
      const pal = day ? PALETTE.day : PALETTE.night;

      // Ringing: ring-ring … pause; each ring makes the ball shiver and puff out dust.
      if (m === 'ringing' && t > st.nextRing) {
        e.rings.push(t);
        st.ringStep = (st.ringStep + 1) % 2;
        st.nextRing = t + (st.ringStep === 1 ? 0.32 : 1.4);
      }
      e.rings = e.rings.filter((s0) => t - s0 < 1.2);
      const shiver = e.rings.reduce((acc, s0) => acc + Math.exp(-(t - s0) * 6), 0);

      // The voice, like a level meter on real audio: loudness (fast up, slower down) and hiss,
      // from real levels if they're fed, else the word being said, else made-up speech.
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
      if (m === 'ringing') loudT = 0.6 * Math.min(1, e.rings.reduce((acc, s0) => acc + Math.exp(-(t - s0) * 9), 0));
      // A syllable starting (the level jumping up) sends a ring; it fades in ~50 ms, so rings stay thin.
      st.ping *= Math.exp(-dt * 22);
      if (loudT - st.prevT > 0.18) st.ping = Math.max(st.ping, Math.min(1, loudT));
      st.prevT = loudT;
      st.loud += (loudT - st.loud) * ease(loudT > st.loud ? 40 : 14);
      st.hiss += (hissT - st.hiss) * ease(30);
      st.talk += ((speaking ? 0.35 + 0.65 * st.loud : 0) - st.talk) * ease(2.5);   // how much talking is going on
      const loud = st.loud * (m === 'family' ? 0.75 : 1);                           // listening is a little softer
      histAcc += dt;
      for (let n = 0; histAcc >= HIST_DT && n < HIST; n++) {
        histAcc -= HIST_DT;
        histOut.copyWithin(1, 0, HIST - 1);
        histIn.copyWithin(1, 0, HIST - 1);
        histOut[0] = m === 'family' ? 0 : st.ping;
        histIn[0] = m === 'family' ? st.ping * 0.85 : 0;
      }
      histAcc = Math.min(histAcc, HIST_DT);
      const ringsOn = histOut.some((v) => v > 0.002) || histIn.some((v) => v > 0.002);

      st.vSaathi += ((m === 'saathi' ? st.talk : 0) - st.vSaathi) * ease(6);
      st.vFamily += ((m === 'family' ? st.talk : 0) - st.vFamily) * ease(6);
      st.think += ((thinking ? 1 : 0) - st.think) * ease(6);

      const ampT = speaking ? 0.14 + 0.04 * st.talk : m === 'ringing' ? 0.14 + 0.05 * shiver : thinking ? 0.11 : m === 'ended' ? 0.08 : 0.13;
      st.amp += (ampT - st.amp) * ease(5);
      const amp = st.amp + 0.05 * loud;              // the bumps rise with every syllable
      const fine = (m === 'ringing' ? 0.03 + 0.04 * shiver : 0.025 + 0.025 * st.talk) + 0.04 * st.hiss;
      if (m === 'family') st.dir = -1;
      else if (m === 'saathi') st.dir = 1;
      st.flow += dt * (0.1 + 0.5 * st.talk) * st.dir;
      st.spin += dt * (0.12 + 0.15 * st.talk + 0.25 * st.think);
      st.swirl += dt * (0.04 + 0.4 * st.talk);
      const glowT = speaking ? 0.92 + 0.1 * st.talk : m === 'ringing' ? 0.95 + 0.4 * shiver : m === 'ended' ? 0.55 : 0.85;
      st.glow += (glowT - st.glow) * ease(4);
      const fireT = speaking ? 0.45 + 0.2 * st.talk : m === 'ringing' ? 0.5 + 0.4 * shiver : m === 'ended' ? 0.12 : 0.35;
      st.fire += (fireT - st.fire) * ease(5);
      const pushT = speaking ? 0.08 * st.talk : thinking ? -0.06 : 0;
      st.push += (pushT + 0.18 * shiver - st.push) * ease(5);
      // the speaker's colour leans in (less on light pages, where it reads as darker ink)
      st.speakMix += ((speaking ? (day ? 0.28 : 0.4) : 0) - st.speakMix) * ease(5);
      const speakT = m === 'family' ? pal.family : pal.saathi;
      if (speaking) for (let i = 0; i < 3; i++) st.speak[i] += (speakT[i] - st.speak[i]) * ease(6);
      RIBBONS.forEach((r, i) => {
        const v = r.who === 'saathi' ? st.vSaathi : st.vFamily;
        st.ribPhase[i] += dt * r.speed * (1 + 2.5 * v + 3 * st.think);
      });

      // The pointer.
      if (nowMs - ptr.at > 50) { const f = Math.exp(-dt * 12); ptr.vx *= f; ptr.vy *= f; }   // it stopped moving
      const live = !reduced && ptr.on;
      const L = Math.hypot(ptr.x, ptr.y);
      const near = live ? 1 - smooth(1, 2.4, L) : 0;     // 1 over the ball, 0 far from it
      const over = live ? 1 - smooth(0.9, 1.15, L) : 0;
      const pulling = live && ptr.down && ptr.dragged;
      const pressing = live && ptr.down && !ptr.dragged;
      const gx = L > 1.1 ? (ptr.x * 1.1) / L : ptr.x, gy = L > 1.1 ? (ptr.y * 1.1) / L : ptr.y;   // under the pointer, or on the outline toward it
      const pullX = pulling ? ptr.x - ptr.px : 0, pullY = pulling ? ptr.y - ptr.py : 0;
      const pl = Math.hypot(pullX, pullY);
      const give = 1 - Math.exp(-pl * 1.6);             // like rubber: the further it goes, the harder it pulls back
      const pdx = pl > 1e-4 ? pullX / pl : 0, pdy = pl > 1e-4 ? pullY / pl : 0;
      const calm = speaking ? 0.7 : 1;                  // while someone talks, the voice leads
      settle(sp.tx, live ? gx : sp.tx.x, 2.6, 0.6, dt);
      settle(sp.ty, live ? gy : sp.ty.x, 2.6, 0.6, dt);
      settle(sp.amp, pressing ? -0.1 : pulling ? 0.14 + 0.3 * give : 0.24 * near ** 1.5 * calm, 2.2, 0.35, dt);
      settle(sp.glow, pressing || pulling ? 1 : 0.75 * over + 0.15 * near, 3, 0.9, dt);
      let svx = near * ptr.vx * 0.012, svy = near * ptr.vy * 0.012;       // fast moves stretch it along the way
      const sv = Math.hypot(svx, svy);
      if (sv > 0.13) { svx *= 0.13 / sv; svy *= 0.13 / sv; }
      settle(sp.sx, svx + pdx * 0.14 * give, 1.7, 0.22, dt);
      settle(sp.sy, svy + pdy * 0.14 * give, 1.7, 0.22, dt);
      settle(sp.lx, near * gx * 0.05 + pdx * 0.22 * give, 1.6, 0.45, dt);
      settle(sp.ly, near * gy * 0.05 + pdy * 0.22 * give, 1.6, 0.45, dt);
      settle(sp.ax, near * Math.max(-1.5, Math.min(1.5, ptr.x)) * 0.2, 0.9, 0.7, dt);
      settle(sp.ay, near * Math.max(-1.5, Math.min(1.5, ptr.y)) * 0.2, 0.9, 0.7, dt);
      settle(sp.squash, pressing ? 1 : 0, 2.8, 0.3, dt);
      st.aside += ((live ? near : 0) - st.aside) * ease(5);
      st.wide += ((pulling ? give : 0) - st.wide) * ease(6);
      const touch = onBall(sp.tx.x - sp.lx.x, sp.ty.x - sp.ly.x);
      // the glass catches the light from the pointer's side (the glint: where the pointer's spot would reflect)
      const toward = Math.min(1, near + Math.max(0, sp.glow.x));
      const light = norm3(mix3(SHEEN, norm3([touch[0], touch[1], touch[2] + 0.8]), 0.65 * toward));
      const tz = norm3([touch[0], touch[1], Math.max(touch[2], 0.55)]);
      const glint = norm3(mix3(GLINT, [2 * tz[2] * tz[0], 2 * tz[2] * tz[1], 2 * tz[2] * tz[2] - 1], 0.6 * toward));
      rips.forEach((r, i) => {
        const age = t - r.t0;
        ripU.set([r.d[0], r.d[1], r.d[2], age], i * 4);
        ripA[i] = age < 2.5 && !reduced ? r.amp : 0;
      });

      const aspect = width / height;
      const T = reduced ? 3 : t;
      const rot = rotation(reduced ? 0.6 : st.spin + sp.ax.x, 0.3 + (reduced ? 0 : 0.06 * Math.sin(t * 0.21)) - sp.ay.x, reduced ? 0 : 0.08 * Math.sin(t * 0.17));
      // The inner light: flares with every syllable, pulses gently while thinking, wakes a little under the pointer.
      const coreT = speaking ? 0.2 + 0.3 * loud : thinking ? 0.27 + 0.08 * Math.sin(t * 5.5)
        : m === 'ringing' ? 0.22 + 0.2 * shiver : m === 'ended' ? 0.08 : 0.21;
      st.core += (coreT - st.core) * ease(speaking ? 25 : 5);
      st.coreSwirl += dt * (0.35 + 1.0 * st.talk + 2.4 * st.think);
      // The whole ball breathes out a little on every syllable.
      const breath = 1 + (reduced ? 0 : 0.015 * Math.sin(t * 1.3) + (m === 'family' ? 0.035 : 0.05) * st.loud) - 0.025 * st.think;
      const gAng = -0.72 + (reduced ? 0 : 0.25 * Math.sin(t * 0.07));
      const grad = [Math.cos(gAng) * 0.88, Math.sin(gAng) * 0.88, 0.35];
      const gLen = Math.hypot(grad[0], grad[1], grad[2]);
      const gradN = new Float32Array([grad[0] / gLen, grad[1] / gLen, grad[2] / gLen]);
      const dim = m === 'ended' ? 0.6 : 1;
      const ringCol = day ? (m === 'family' ? pal.family : pal.saathi) : mix3(m === 'family' ? pal.family : pal.saathi, [1, 1, 1], 0.35);

      // Draws the whole orb into whatever framebuffer is bound. `px` scales point sizes
      // (0.5 for the half-size glow source).
      const renderOrb = (px: number) => {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, day ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);

        // dust
        gl.useProgram(dustProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
        gl.enableVertexAttribArray(aD);
        gl.vertexAttribPointer(aD, 4, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix3fv(du.uRot, false, rot);
        gl.uniform1f(du.uTime, T);
        gl.uniform1f(du.uScale, scaleRef.current);
        gl.uniform1f(du.uAspect, aspect);
        gl.uniform2f(du.uShift, sp.lx.x, sp.ly.x);
        gl.uniform1f(du.uPush, st.push);
        gl.uniform1f(du.uPoint, 2.2 * dpr);
        gl.uniform1f(du.uPx, px);
        gl.uniform1f(du.uSwirl, reduced ? 0 : st.swirl);
        gl.uniform2f(du.uPtr, ptr.x, ptr.y);
        gl.uniform1f(du.uPtrAmt, st.aside);
        gl.uniform3fv(du.uC1, pal.blue);
        gl.uniform3fv(du.uC3, pal.magenta);
        gl.uniform3fv(du.uGrad, gradN);
        gl.uniform1f(du.uFAlpha, (day ? 0.55 : 0.7) * (m === 'ended' ? 0.5 : 1));
        gl.uniform1f(du.uFInk, day ? 1 : 0);
        gl.drawArrays(gl.POINTS, 0, dust.length / 4);

        // the inner light: its colours lean to the speaker's; pastel on light pages
        const tint = (c: number[]) => {
          const k = Math.min(0.6, st.speakMix * 1.3);
          const out = c.map((v, i) => v + (st.speak[i] - v) * k);
          return day ? out.map((v) => v * 0.55 + 0.45) : out;
        };
        gl.useProgram(coreProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(coreA);
        gl.vertexAttribPointer(coreA, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1f(cu.uCAspect, aspect);
        gl.uniform1f(cu.uCScale, scaleRef.current);
        gl.uniform1f(cu.uCSwirl, reduced ? 1 : st.coreSwirl);
        gl.uniform1f(cu.uCAmt, (st.core + 0.06 * Math.max(0, sp.glow.x)) * dim * (day ? 1.6 : 1) * (px < 1 ? 0.3 : 1));
        gl.uniform1f(cu.uCR, 0.36 + 0.1 * loud);
        gl.uniform1f(cu.uCInk, day ? 1 : 0);
        gl.uniform2f(cu.uCOff, sp.lx.x + 0.25 * near * sp.tx.x, sp.ly.x + 0.25 * near * sp.ty.x);
        gl.uniform3fv(cu.uK1, tint(pal.blue));
        gl.uniform3fv(cu.uK2, tint(pal.violet));
        gl.uniform3fv(cu.uK3, tint(pal.magenta));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // ribbons, inside the glass
        gl.useProgram(ribbonProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, ribVbo);
        gl.enableVertexAttribArray(aR);
        gl.vertexAttribPointer(aR, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ribIbo);
        gl.uniformMatrix3fv(ru.uRot, false, rot);
        gl.uniform1f(ru.uScale, scaleRef.current);
        gl.uniform1f(ru.uAspect, aspect);
        gl.uniform2f(ru.uShift, sp.lx.x, sp.ly.x);
        gl.uniform1f(ru.uFInk, day ? 1 : 0);
        RIBBONS.forEach((r, i) => {
          const v = (r.who === 'saathi' ? st.vSaathi : st.vFamily) + (m === (r.who === 'saathi' ? 'saathi' : 'family') ? 0.3 * loud : 0);
          gl.uniformMatrix3fv(ru.uRib, false, rotation(r.yaw + (reduced ? 0 : t * r.spin), r.pitch, r.roll));
          gl.uniform1f(ru.uRad, r.rad);
          gl.uniform1f(ru.uWidth, r.width * (1 + 0.35 * v));
          gl.uniform1f(ru.uTwist, r.twist);
          gl.uniform1f(ru.uPhase, st.ribPhase[i]);
          gl.uniform1f(ru.uWob, 0.4 + 0.8 * v);
          gl.uniform3fv(ru.uCa, pal[r.who]);
          gl.uniform3fv(ru.uCb, pal[r.to]);
          gl.uniform1f(ru.uFAlpha, (day ? 0.32 : 0.42) * (0.75 + (day ? 0.35 : 0.6) * v) * dim);
          gl.drawElements(gl.TRIANGLES, rib.idx.length, gl.UNSIGNED_SHORT, 0);
        });

        // the ball: glass skin, then lines, then the dots at the joints
        const setMesh = (p: (typeof meshProgs)[number], alpha: number) => {
          gl.useProgram(p.prog);
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          gl.enableVertexAttribArray(p.aV);
          gl.vertexAttribPointer(p.aV, 4, gl.FLOAT, false, 0, 0);
          const u = p.u;
          gl.uniformMatrix3fv(u.uRot, false, rot);
          gl.uniform1f(u.uTime, T);
          gl.uniform1f(u.uScale, scaleRef.current);
          gl.uniform1f(u.uAspect, aspect);
          gl.uniform2f(u.uShift, sp.lx.x, sp.ly.x);
          gl.uniform1f(u.uAmp, reduced ? 0.13 : amp);
          gl.uniform1f(u.uFine, reduced ? 0.025 : fine);
          gl.uniform1f(u.uFlow, st.flow);
          gl.uniform1f(u.uBreath, breath);
          gl.uniform1f(u.uPoint, 2.4 * dpr);
          gl.uniform1f(u.uPx, px);
          gl.uniform3fv(u.uGrad, gradN);
          gl.uniform1f(u.uFireAmt, reduced ? 0.3 : st.fire * (day ? 0.6 : 1));
          gl.uniform1f(u.uThink, st.think);
          gl.uniform3fv(u.uC1, pal.blue);
          gl.uniform3fv(u.uC2, pal.violet);
          gl.uniform3fv(u.uC3, pal.magenta);
          gl.uniform3fv(u.uSpeak, st.speak);
          gl.uniform1f(u.uSpeakMix, st.speakMix);
          gl.uniform3fv(u.uTouch, touch);
          gl.uniform1f(u.uTouchAmp, sp.amp.x);
          gl.uniform1f(u.uTouchWide, 10 - 5 * st.wide);   // a pull draws out a broad swell, not a point
          gl.uniform1f(u.uTouchGlow, Math.max(0, sp.glow.x));
          gl.uniform3f(u.uStretch, sp.sx.x, sp.sy.x, 0);
          gl.uniform1f(u.uSquash, sp.squash.x);
          gl.uniform4fv(u.uRip, ripU);
          gl.uniform3fv(u.uRipAmp, ripA);
          gl.uniform4fv(u.uOut, histOut);
          gl.uniform4fv(u.uIn, histIn);
          gl.uniform1f(u.uEnvFrac, histAcc / HIST_DT);
          gl.uniform1f(u.uRingsOn, ringsOn ? 1 : 0);
          gl.uniform1f(u.uFTime, T);
          gl.uniform1f(u.uFAlpha, alpha);
          gl.uniform1f(u.uFInk, day ? 1 : 0);
          gl.uniform1f(u.uFVoice, loud);
          gl.uniform1f(u.uFGloss, day ? 0 : 1);
          gl.uniform3fv(u.uFLight, light);
          gl.uniform3fv(u.uFGlint, glint);
          gl.uniform1f(u.uFHiss, st.hiss);
          gl.uniform3fv(u.uFRing, ringCol);
        };
        setMesh(skin, (day ? 0.6 : 0.55) * dim);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triIbo);
        gl.drawElements(gl.TRIANGLES, ball.tris.length, gl.UNSIGNED_SHORT, 0);
        setMesh(lines, (day ? 0.62 : 0.75) * dim);   // lighter lines on light pages, so it reads as a glowing orb
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeIbo);
        gl.drawElements(gl.LINES, ball.edges.length, gl.UNSIGNED_SHORT, 0);
        setMesh(nodes, (day ? 0.72 : 0.8) * dim);
        gl.drawArrays(gl.POINTS, 0, nodeCount);
      };

      const useGlow = !!(src?.ok && tA?.ok && tB?.ok && wA?.ok && wB?.ok);
      if (useGlow) {
        const S = src!, A = tA!, B = tB!, C = wA!, D = wB!;
        // 1. the orb at half size, as the glow's source
        gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
        gl.viewport(0, 0, S.w, S.h);
        gl.clear(gl.COLOR_BUFFER_BIT);
        renderOrb(0.5);

        // 2. shrink and blur: a tight glow (quarter size), then a wide halo (eighth size)
        gl.disable(gl.BLEND);
        const quad = (prog: WebGLProgram, a: number) => {
          gl.useProgram(prog);
          gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
          gl.enableVertexAttribArray(a);
          gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
        };
        gl.activeTexture(gl.TEXTURE0);
        const shrink = (from: Target, to: Target) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
          gl.viewport(0, 0, to.w, to.h);
          quad(downProg, quadA[0]);
          gl.bindTexture(gl.TEXTURE_2D, from.tex);
          gl.uniform1i(downU.uTex, 0);
          gl.uniform2f(downU.uTexel, 1 / from.w, 1 / from.h);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        const blur = (a: Target, b: Target, spreads: number[]) => {
          quad(blurProg, quadA[1]);
          gl.uniform1i(blurU.uTex, 0);
          gl.viewport(0, 0, a.w, a.h);
          for (const spread of spreads) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
            gl.bindTexture(gl.TEXTURE_2D, a.tex);
            gl.uniform2f(blurU.uStep, spread / a.w, 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb);
            gl.bindTexture(gl.TEXTURE_2D, b.tex);
            gl.uniform2f(blurU.uStep, 0, spread / a.h);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          }
        };
        shrink(S, A);
        blur(A, B, [1, 1.8]);
        shrink(A, C);
        blur(C, D, [1.2, 2.4]);

        // 3. on screen: the glow first, then the crisp orb over it
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        quad(glowProg, quadA[2]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, A.tex);
        gl.uniform1i(glowU.uTight, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, C.tex);
        gl.uniform1i(glowU.uWide, 1);
        // on light pages the haze doesn't grow while someone talks (it would read as darker)
        const glowAmt = day ? Math.min(st.glow, 0.88) : st.glow + 0.08 * loud;
        gl.uniform1f(glowU.uTightAmt, (day ? 0.32 : 0.7) * glowAmt);
        gl.uniform1f(glowU.uWideAmt, (day ? 0.4 : 0.85) * glowAmt);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.activeTexture(gl.TEXTURE0);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      renderOrb(1);
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
    // Reduced motion: no loop, one still frame, redrawn when the mode or theme changes.
    if (reduced) {
      e.redraw = () => draw(performance.now());
      draw(performance.now());
    }
    startLoop();

    return () => {
      stopLoop();
      e.redraw = null;
      io.disconnect();
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
      [src, tA, tB, wA, wB].forEach((tg) => dropTarget(gl, tg));
      [vbo, triIbo, edgeIbo, ribVbo, ribIbo, dustBuf, quadBuf].forEach((b) => gl.deleteBuffer(b));
      [skinProg, lineProg, nodeProg, ribbonProg, dustProg, downProg, blurProg, glowProg, coreProg].forEach((p) => gl.deleteProgram(p));
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }} />;
}
