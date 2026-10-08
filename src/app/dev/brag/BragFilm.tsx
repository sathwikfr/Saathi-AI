'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  Phone, Heart, AlarmClock, MessageCircle, Volume2, Video, MicOff, UserPlus, Grid3x3, PhoneOff,
  ChevronLeft, Reply, ExternalLink, Mic, Plus, Camera,
} from 'lucide-react';
import c from '@/components/landing/liveCallPhone.module.css';
import { CALL_SCRIPT, formatCallTime } from '@/components/landing/callScript';
import s from './brag.module.css';

/**
 * The /brag launch video, 1080x1920 (360x640 CSS px at DPR 3), 24 s.
 * Every frame is a pure function of `t`: headless Chrome calls window.__brag.seek(ms) and takes a
 * screenshot. CSS animations and transitions are paused and seeked to their age in film time, so the
 * real phone styles (liveCallPhone.module.css) animate exactly as on the site. Storyboard:
 * brag-output/brag-plan.md.
 */

export const DURATION = 24000;

/* ---------- Timeline (ms) ---------- */

const SLIDE_FROM = 1900;      // the knob starts sliding
const ANSWER_AT = 2900;       // the knob arrives: call screen
const CALL_AT = 3000;         // call clock 0:00
/** When each line of the landing page's example call is said in the film (retimed for 24 s). */
const LINES = [
  { i: 0, start: 3400, end: 5300 },
  { i: 1, start: 5500, end: 6200 },
  { i: 2, start: 6400, end: 7300 },
  { i: 3, start: 7500, end: 9200 },
  { i: 4, start: 9500, end: 11400 },
];
const CUT_WA = 12000;
const MSG_AT = 12650;
const ZOOM_WA: [number, number] = [13000, 13800];
const HL1: [number, number] = [13900, 14450];
const HL2: [number, number] = [14700, 15250];
const TAP_AT = 16000;
const CUT_LANG = 16800;
const CUT_OUT = 19800;

/* ---------- Helpers ---------- */

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeIn = (x: number) => x * x * x;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const expoOut = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const hash = (n: number) => {
  const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/** Fade + rise in over [a, a+dur], fade + rise out over [b-dur, b]. */
function inOut(t: number, a: number, b: number, dur = 500, rise = 14) {
  const pin = expoOut(prog(t, a, a + dur));
  const pout = easeIn(prog(t, b - dur * 0.8, b));
  return { opacity: pin * (1 - pout), transform: `translateY(${(1 - pin) * rise - pout * rise}px)` };
}

/* ---------- Phone geometry ---------- */

const DW = 240;                          // device width, CSS px
const DH = (DW * 147.6) / 71.6;          // device height
const INSET = DW * 0.0454;               // screen inset
const PT = DW * 0.0023135;               // one iOS point

type Cam = { x: number; y: number; s: number };
const centred = (cx: number, cy: number, sc: number): Cam => ({ x: cx - (DW / 2) * sc, y: cy - (DH / 2) * sc, s: sc });
const mixCam = (a: Cam, b: Cam, p: number): Cam => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), s: lerp(a.s, b.s, p) });
/** Put device point (dx, dy) at film point (fx, fy) at scale sc. */
const focus = (dx: number, dy: number, fx: number, fy: number, sc: number): Cam => ({ x: fx - dx * sc, y: fy - dy * sc, s: sc });
const pt = (n: number) => INSET + n * PT;

/** Amma's phone: rings, then the camera eases into the call screen, then it lifts away. */
function camCall(t: number): Cam {
  const start = centred(180, 388, 1);
  const pushed = centred(180, 388, 1.05);
  const call = { x: 180 - (DW / 2) * 1.58, y: -10, s: 1.58 };
  if (t < 2600) return mixCam(start, pushed, easeInOut(prog(t, 0, 2600)));
  const inCall = mixCam(pushed, call, easeInOut(prog(t, 2600, 3700)));
  const drift = prog(t, 3700, CUT_WA) * 6;
  return { ...inCall, y: inCall.y - drift };
}

/** Your phone: rises in, then zooms onto the message. */
function camWa(t: number): Cam {
  const rest = centred(180, 400, 1);
  const enter = expoOut(prog(t, CUT_WA + 100, CUT_WA + 850));
  const below = { ...rest, y: rest.y + 360 };
  const base = mixCam(below, rest, enter);
  const zoom = focus(INSET + 174 * PT, pt(322), 180, 428, 1.7);
  const p = easeInOut(prog(t, ZOOM_WA[0], ZOOM_WA[1]));
  const cam = mixCam(base, zoom, p);
  return { ...cam, y: cam.y - prog(t, ZOOM_WA[1], CUT_LANG) * 8 };
}

/* ---------- Island bars (deterministic copy of IslandWave) ---------- */

const GREEN = '48, 209, 88';
const RED = '255, 69, 58';
const WHITE = '255, 255, 255';
const BARS = 17;
const STEP_MS = 64;

function speakerAt(tt: number): 'saathi' | 'parent' | null {
  const l = LINES.find((x) => tt >= x.start && tt < x.end);
  return l ? CALL_SCRIPT[l.i].who : null;
}

function WaveDet({ t }: { t: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = 3;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (t < ANSWER_AT) return;

    const callMs = t - ANSWER_AT;
    const n = Math.floor(callMs / STEP_MS);
    const frac = (callMs % STEP_MS) / STEP_MS;
    const now = speakerAt(t);
    let dir = 1;
    if (now === 'parent') dir = -1;
    else if (!now) {
      // Keep the last speaker's direction while quiet.
      for (let k = n; k >= 0; k--) {
        const w2 = speakerAt(ANSWER_AT + k * STEP_MS);
        if (w2) { dir = w2 === 'parent' ? -1 : 1; break; }
      }
    }

    const gap = w / BARS;
    const bw = Math.max(1.5, Math.min(gap * 0.46, h * 0.13));
    const mid = h / 2;
    ctx.lineCap = 'round';
    ctx.lineWidth = bw;
    let quietSince = 0;
    for (let i = 0; i < BARS + 2; i++) {
      const m = n - i;
      if (m < 0) break;
      const tt = ANSWER_AT + m * STEP_MS;
      const who = speakerAt(tt);
      let a = 0.06;
      let col = WHITE;
      if (who) {
        const syll = Math.abs(Math.sin((tt / 1000) * Math.PI * 4.1 + Math.sin(tt / 370) * 1.4));
        a = (0.3 + 0.7 * syll) * (0.55 + 0.45 * hash(m));
        if (hash(m + 7.3) < 0.09) a *= 0.2;
        a = Math.max(0.06, a * Math.pow(0.86, quietSince));
        col = who === 'saathi' ? GREEN : RED;
      } else {
        quietSince++;
      }
      const fromLeft = (i - 0.5 + frac) * gap;
      const x = dir === 1 ? fromLeft : w - fromLeft;
      if (x < -bw || x > w + bw) continue;
      const edge = Math.min(1, Math.min(x, w - x) / (gap * 1.6));
      const half = Math.max(0.5, (a * (h - bw * 2)) / 2);
      const alpha = (col === WHITE ? 0.3 : 0.55 + a * 0.45) * Math.max(0, edge);
      ctx.strokeStyle = `rgba(${col}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(x, mid - half);
      ctx.lineTo(x, mid + half);
      ctx.stroke();
    }
  }, [t]);
  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

/* ---------- Phone pieces (same markup as LiveCallPhone) ---------- */

function StatusBar({ time = '8:30', color }: { time?: string; color?: string }) {
  return (
    <div className={c.status} style={color ? { color } : undefined} aria-hidden="true">
      <span className={c.statusSide}><time>{time}</time></span>
      <span className={c.statusSide}>
        <svg viewBox="0 0 18 12" className={c.sbSignal}>
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 16 12" className={c.sbWifi}>
          <path d="M8 2.6c2.3 0 4.4.9 6 2.4l1.2-1.3A10.5 10.5 0 0 0 8 .8C5.2.8 2.7 1.9.8 3.7L2 5c1.6-1.5 3.7-2.4 6-2.4Z" />
          <path d="M8 6.2c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.8 6.8 0 0 0 8 4.4c-1.8 0-3.4.7-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3Z" />
          <path d="M8 9.8 10 7.9A2.9 2.9 0 0 0 8 7.1c-.8 0-1.5.3-2 .8L8 9.8Z" />
        </svg>
        <svg viewBox="0 0 27 13" className={c.sbBattery}>
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.6" fill="none" stroke="currentColor" strokeOpacity="0.4" />
          <rect x="2.2" y="2.2" width="16" height="8.6" rx="2" />
          <path d="M25 4.3v4.4c.9-.3 1.5-1.2 1.5-2.2s-.6-1.9-1.5-2.2Z" fillOpacity="0.45" />
        </svg>
      </span>
    </div>
  );
}

function Shell({ cam, style, ringing, children }: { cam: Cam; style?: React.CSSProperties; ringing?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={s.cam}
      style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`, ...style }}
    >
      <div className={c.device} data-ringing={ringing || undefined} style={{ '--dw': `${DW}px` } as React.CSSProperties}>
        <span className={`${c.hw} ${c.hwAction}`} />
        <span className={`${c.hw} ${c.hwVolUp}`} />
        <span className={`${c.hw} ${c.hwVolDown}`} />
        <span className={`${c.hw} ${c.hwSide}`} />
        <span className={`${c.hw} ${c.hwCamera}`} />
        <div className={c.bezel} />
        {children}
      </div>
    </div>
  );
}

const CONTROLS = [
  { icon: Volume2, label: 'speaker' },
  { icon: Video, label: 'video' },
  { icon: MicOff, label: 'mute' },
  { icon: UserPlus, label: 'add' },
  { icon: PhoneOff, label: 'end', end: true },
  { icon: Grid3x3, label: 'keypad' },
];

/** Amma's phone: the landing page's "How it works" call, driven by film time. */
function CallPhone({ t }: { t: number }) {
  const onCall = t >= ANSWER_AT;
  const callMs = Math.max(0, t - CALL_AT);
  const talking = speakerAt(t) !== null;
  const slide = easeInOut(prog(t, SLIDE_FROM, ANSWER_AT - 60));
  const travel = (341 - 66 - 14) * PT;
  const out = easeIn(prog(t, CUT_WA - 350, CUT_WA + 50));

  return (
    <Shell cam={camCall(t)} ringing={!onCall} style={{ opacity: 1 - out, translate: `0 ${-out * 60}px` }}>
      <div className={c.screen} data-screen={onCall ? 'call' : 'incoming'}>
        <div className={c.wallpaper} />
        <StatusBar />
        <div className={c.island} data-mode={onCall ? 'call' : 'ring'}>
          <span className={c.islandIcon}><Phone fill="currentColor" strokeWidth={0} /></span>
          <span className={c.islandWave}><WaveDet t={t} /></span>
          <span className={c.islandTime}>{formatCallTime(callMs)}</span>
          <span className={c.lens} />
        </div>

        <div className={c.incoming}>
          <div className={c.caller}>
            <span className={c.callerName}>Saathi</span>
            <span className={c.callerSub}>Aaptha · morning check-in</span>
          </div>
          <div className={c.avatar}><Heart fill="currentColor" strokeWidth={0} /></div>
          <div className={c.quick}>
            <span><i><AlarmClock /></i>Remind Me</span>
            <span><i><MessageCircle fill="currentColor" strokeWidth={0} /></i>Message</span>
          </div>
          <div className={c.slider} data-mode="drag">
            <span className={c.sliderText} style={{ opacity: Math.max(0, 1 - slide * 1.8) }}>slide to answer</span>
            <span className={c.knob} style={{ transform: `translateX(${slide * travel}px)` }}>
              <Phone size={20} fill="currentColor" strokeWidth={0} />
            </span>
          </div>
        </div>

        <div className={c.incall}>
          <div className={c.callHead}>
            <span className={c.headName}>Saathi</span>
            <span className={c.headSub}>{formatCallTime(callMs)}</span>
          </div>
          <div className={c.transcript}>
            <span className={c.liveLabel}>
              <span className={c.liveDot} data-on={talking || undefined} />
              Live transcript · English
            </span>
            <div className={c.feed}>
              {LINES.filter((l) => t >= l.start).map((l) => {
                const line = CALL_SCRIPT[l.i];
                const words = line.text.en.split(' ');
                const p = prog(t, l.start, l.end);
                const upTo = Math.ceil(p * words.length);
                return (
                  <div key={l.i} className={`${c.bubble} ${line.who === 'saathi' ? c.bSaathi : c.bParent}`} data-live={p < 1 || undefined}>
                    <span className={c.bubbleWho}>{line.who === 'saathi' ? 'Saathi' : 'Amma'}</span>
                    <p>
                      {words.map((w, i) => (
                        <span key={i} data-on={i < upTo || undefined}>{w}{i < words.length - 1 ? ' ' : ''}</span>
                      ))}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
          <div className={c.controls}>
            {CONTROLS.map((b) => (
              <span key={b.label} className={`${c.ctl} ${b.end ? c.ctlEnd : ''}`}>
                <i><b.icon /></i>
                {b.label}
              </span>
            ))}
          </div>
        </div>

        <span className={c.homeBar} />
        <span className={c.glare} />
      </div>
    </Shell>
  );
}

/* ---------- Your phone: the WhatsApp update ---------- */

// Exactly what planFamilyMessage() sends for this call (brag-output/work/msg.ts runs the example call
// through interpretCallResult -> decideAlerts -> planFamilyMessage): template aaptha_call_alert.
const HL1_TEXT = 'Knee has been hurting a little since yesterday';
const HL2_TEXT = 'Medicines: Amlodipine 5mg taken. Mood: calm.';
const MSG_A = 'Your scheduled check-in call with Amma needs your attention. Details: Amma mentioned not feeling well: "';
const MSG_B = '". Please check in with them today. Call details: Answered the morning call at 08:30 AM. ';
const MSG_FOOT = 'This alert is part of the care plan you set up on Aaptha.';

function Highlight({ p, children }: { p: number; children: React.ReactNode }) {
  return <mark className={s.hl} style={{ backgroundSize: `${p * 100}% 100%` }}>{children}</mark>;
}

function WaPhone({ t }: { t: number }) {
  const msgIn = expoOut(prog(t, MSG_AT, MSG_AT + 450));
  const tap = prog(t, TAP_AT, TAP_AT + 600);
  const pressed = t >= TAP_AT && t < TAP_AT + 320;
  const out = easeIn(prog(t, CUT_LANG - 450, CUT_LANG - 50));
  if (t < CUT_WA) return null;

  return (
    <Shell cam={camWa(t)} style={{ opacity: 1 - out, translate: `0 ${out * 90}px` }}>
      <div className={c.screen} style={{ background: '#efe7dd', color: '#111b21' }}>
        <StatusBar time="8:31" color="#111b21" />
        <div className={c.island} data-mode="idle"><span className={c.lens} /></div>
        <div className={s.wa}>
          <div className={s.waTop}>
            <div className={s.waHead}>
              <ChevronLeft className={s.waBack} />
              <span className={s.waAvatar}><Heart fill="currentColor" strokeWidth={0} /></span>
              <span className={s.waName}>Aaptha</span>
              <Video className={s.waIcon} />
              <Phone className={s.waIcon} />
            </div>
          </div>
          <div className={s.waChat}>
            <span className={s.waDate}>Today</span>
            <div className={s.waMsg} style={{ opacity: msgIn, transform: `translateY(${(1 - msgIn) * 16}px) scale(${0.96 + msgIn * 0.04})` }}>
              <div className={s.waBody}>
                {MSG_A}
                <Highlight p={easeInOut(prog(t, HL1[0], HL1[1]))}>{HL1_TEXT}</Highlight>
                {MSG_B}
                <Highlight p={easeInOut(prog(t, HL2[0], HL2[1]))}>{HL2_TEXT}</Highlight>
                {'\n\n'}
                {MSG_FOOT}
                <span className={s.waTime}>8:31 AM</span>
              </div>
              <div className={s.waBtn} style={pressed ? { background: '#e9edef' } : undefined}>
                {t >= TAP_AT && <span className={s.tap} style={{ opacity: (1 - tap) * 0.5, transform: `scale(${0.2 + expoOut(tap) * 1.4})` }} />}
                <Reply /> I&apos;ll handle it
              </div>
              <div className={s.waBtn}><Reply /> Call again</div>
              <div className={s.waBtn}><ExternalLink /> Open Aaptha</div>
            </div>
          </div>
          <div className={s.waInput}>
            <Plus />
            <span className={s.waField} />
            <Camera />
            <Mic />
          </div>
        </div>
        <span className={c.homeBar} style={{ background: '#111b21' }} />
      </div>
    </Shell>
  );
}

/* ---------- Languages ---------- */

// The landing page's language cards (LanguagesSection.tsx).
const HELLOS = [
  { hello: 'नमस्ते', name: 'Hindi' },
  { hello: 'నమస్కారం', name: 'Telugu' },
  { hello: 'வணக்கம்', name: 'Tamil' },
  { hello: 'ನಮಸ್ಕಾರ', name: 'Kannada' },
  { hello: 'നമസ്കാരം', name: 'Malayalam' },
  { hello: 'নমস্কার', name: 'Bengali' },
  { hello: 'नमस्कार', name: 'Marathi' },
  { hello: 'નમસ્તે', name: 'Gujarati' },
  { hello: 'Hello', name: 'English' },
];

function Languages({ t }: { t: number }) {
  if (t < CUT_LANG - 100 || t > CUT_OUT + 200) return null;
  const out = easeIn(prog(t, CUT_OUT - 350, CUT_OUT));
  return (
    <div className={s.langs} style={{ opacity: 1 - out, transform: `translateY(${-out * 18}px)` }}>
      <h2 className={s.langTitle} style={inOut(t, CUT_LANG + 120, CUT_OUT + 1000, 600, 18)}>9 Indian languages.</h2>
      <p className={s.langSub} style={inOut(t, CUT_LANG + 320, CUT_OUT + 1000, 600, 12)}>No app for your parents.</p>
      <div className={s.langGrid}>
        {HELLOS.map((h, i) => {
          const p = expoOut(prog(t, CUT_LANG + 500 + i * 110, CUT_LANG + 1100 + i * 110));
          return (
            <div key={h.name} className={s.langCard} style={{ opacity: p, transform: `translateY(${(1 - p) * 16}px) scale(${0.94 + p * 0.06})` }}>
              <b>{h.hello}</b>
              <small>{h.name}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Outro ---------- */

function Outro({ t }: { t: number }) {
  if (t < CUT_OUT - 100) return null;
  const line = (i: number) => inOut(t, CUT_OUT + 250 + i * 130, DURATION + 5000, 700, 16);
  return (
    <div className={s.outro}>
      <div className={s.brand} style={inOut(t, CUT_OUT + 50, DURATION + 5000, 700, 12)}>
        <span className={s.brandHeart}><Heart fill="white" strokeWidth={0} /></span>
        <span className={s.brandWord}>Aaptha</span>
      </div>
      <h1 className={s.outroH1}>
        <span style={line(0)}>A daily call for</span>
        <span style={line(1)}>your parents.</span>
        <span style={line(2)}><em>Peace of mind</em></span>
        <span style={line(3)}>for you.</span>
      </h1>
      <p className={s.tagline} style={inOut(t, CUT_OUT + 950, DURATION + 5000, 700, 10)}>
        <span className={s.ring} />Saathi · a voice companion for parents
      </p>
    </div>
  );
}

/* ---------- The film ---------- */

/** Pause every CSS animation/transition and set it to its age in film time. */
const born = new WeakMap<Animation, number>();
function syncAnimations(t: number) {
  for (const a of document.getAnimations()) {
    if (!born.has(a)) born.set(a, t);
    a.pause();
    a.currentTime = Math.max(0, t - born.get(a)!);
  }
}

declare global {
  interface Window { __brag?: { duration: number; seek: (ms: number) => Promise<void> } }
}

export function BragFilm() {
  const [t, setT] = useState(0);

  useEffect(() => {
    const q = Number(new URLSearchParams(window.location.search).get('t'));
    window.__brag = {
      duration: DURATION,
      seek: (ms: number) => new Promise<void>((resolve) => {
        flushSync(() => setT(ms));
        syncAnimations(ms);
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
    };
    if (q) {
      // Stills: walk up to the time so transitions are where they would be.
      let at = Math.max(0, q - 1500);
      const step = () => {
        flushSync(() => setT(at));
        syncAnimations(at);
        if (at < q) { at = Math.min(q, at + 1000 / 30); requestAnimationFrame(step); }
      };
      step();
    } else {
      syncAnimations(0);
    }
  }, []);

  const bgDrift = t / DURATION;
  return (
    <div className={s.film}>
      <style>{'nextjs-portal{display:none!important}'}</style>
      <div className={s.bg} style={{ transform: `translate(${bgDrift * -14}px, ${bgDrift * 22}px)` }} />

      <CallPhone t={t} />
      <WaPhone t={t} />

      {/* Captions sit over the phones on a paper fade */}
      <div className={s.capWrap} style={{ height: t < 3000 ? 150 : 178, opacity: t < 3000 ? 1 : t >= CUT_WA + 100 && t < CUT_LANG ? 1 : 0 }}>
        {t < 3000 && (
          <p className={s.caption} style={inOut(t, -400, 2900, 450, 14)}>
            Every morning, <span>Saathi</span> calls Amma.
          </p>
        )}
        {t >= CUT_WA && t < CUT_LANG && (
          <p className={s.caption} style={inOut(t, CUT_WA + 250, CUT_LANG - 250, 550, 14)}>
            You get the update on <span>WhatsApp</span>.
          </p>
        )}
      </div>

      <Languages t={t} />
      <Outro t={t} />
    </div>
  );
}
