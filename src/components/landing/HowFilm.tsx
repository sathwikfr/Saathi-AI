'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Pause, Play } from 'lucide-react';
// The /dev/brag launch film's scenes: every frame is a pure function of film time `t`.
import { CallPhone, WaPhone, ANSWER_AT, CUT_WA, TAP_AT, DW, DH, type Cam } from '@/app/dev/brag/BragFilm';
import { Reveal } from '@/components/Reveal';
import { WordReveal } from '@/components/motion/WordReveal';
import { LiveCallPhone } from './LiveCallPhone';
import { CALL_LANGS, CALL_LANG_EVENT, isCallLang, type CallLang } from './callScript';
import s from './home.module.css';
import x from './howFilm.module.css';

/**
 * "How it works" as a short film that plays by itself while it is on screen: Amma's phone rings,
 * Saathi asks about her tablet in her language, she mentions her knee, and a minute later the update
 * lands on your WhatsApp, where you tap "I'll handle it". Then it rests a moment and plays again.
 * It pauses off screen; the step bars jump to a part. The whole phone is always in view (a still
 * camera, scaled to the space). The en/te/hi switch (and the Languages section's "Hear it") changes
 * the call's language. With reduced motion it is the self-playing phone demo instead.
 */

const END = TAP_AT + 700;    // the tap on "I'll handle it" lands
const HOLD_MS = 2400;        // rest on the last frame...
const FADE_MS = 500;         // ...then fade the phone out, start again, and fade it back in
const PARENT_KNEE_AT = 7400; // BragFilm LINES[3]: Amma mentions her knee

// The film frame hugs the phone: the device plus a little room for its shadow and side buttons.
const PAD = 12;
const FW = DW + PAD * 2;
const FH = DH + PAD * 2;
const STILL: Cam = { x: PAD, y: PAD, s: 1 };

const BEATS = [
  { from: 0, kicker: '8:30 AM', title: ['Saathi', 'calls', 'Amma.'], body: 'Her own phone rings. Nothing to install, nothing to learn.' },
  { from: ANSWER_AT + 300, kicker: 'On the call', title: ['Her', 'medicines,', 'in', 'her', 'language.'], body: '“Did you take your BP tablet?” “Yes, just now.”' },
  { from: PARENT_KNEE_AT, kicker: 'Listening', title: ['It', 'hears', 'what', 'she', 'mentions.'], body: 'Knee pain since yesterday: noted, and passed on to you.' },
  { from: CUT_WA - 300, kicker: '8:31 AM', title: ['A', 'minute', 'later,', 'on', 'your', 'WhatsApp.'], body: 'What she took, how she felt, and what needs you.' },
  { from: TAP_AT - 1000, kicker: 'One tap', title: ['You’ve', 'got', 'it.'], body: '“I’ll handle it”, and the family can see who is on it.' },
];
const ACCENT = new Set(['Amma.', 'language.', 'mentions.', 'WhatsApp.', 'it.']);

/**
 * `embedded`: shown inside HowSection (no id of its own, a little shorter to leave room for the toggle).
 * `onEnd`: called when the film has rested and faded out, instead of looping (HowSection then shows the other film).
 */
export function HowFilm({ embedded = false, onEnd }: { embedded?: boolean; onEnd?: () => void }) {
  const reduce = useReducedMotion();
  const onEndRef = useRef(onEnd);
  useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);
  const root = useRef<HTMLElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const tRef = useRef(0);
  const [t, setT] = useState(0);
  const [k, setK] = useState(1);
  const [fading, setFading] = useState(false);
  const [lang, setLang] = useState<CallLang>('en');
  const [paused, setPaused] = useState(false);   // WCAG 2.2.2: the film that starts by itself can be stopped
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const seek =(v: number) => { tRef.current = v; setT(v); setFading(false); };

  // "Hear it" in the Languages section switches the call's language and plays it from the start.
  useEffect(() => {
    const onLang = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (isCallLang(v)) { setLang(v); tRef.current = 0; setT(0); setFading(false); }
    };
    window.addEventListener(CALL_LANG_EVENT, onLang);
    return () => window.removeEventListener(CALL_LANG_EVENT, onLang);
  }, []);

  // Fit the whole phone into its space, whatever the screen.
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setK(Math.max(0.5, Math.min(1.6, height / FH, width / FW)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [reduce]);

  // Play on its own clock while on screen; rest on the last frame, fade out, start again, fade in.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    let last = 0;
    let held = 0;
    const tick = (now: number) => {
      if (pausedRef.current) { last = now; raf = requestAnimationFrame(tick); return; }
      const dt = last ? Math.min(64, now - last) : 0;
      last = now;
      let next = tRef.current;
      if (next >= END) {
        held += dt;
        if (held > HOLD_MS + FADE_MS) {
          held = 0;
          if (onEndRef.current) { onEndRef.current(); cancelAnimationFrame(raf); return; }
          next = 0;
          setFading(false);
        } else if (held > HOLD_MS) {
          setFading(true);
        }
      } else {
        held = 0;
        next = Math.min(END, next + dt);
      }
      if (next !== tRef.current) { tRef.current = next; setT(next); }
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf);
      if (e.isIntersecting) { last = 0; raf = requestAnimationFrame(tick); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [reduce]);

  if (reduce) {
    return (
      <section id={embedded ? undefined : 'how'} className={`section ${s.alt}`}>
        <div className="wrap">
          <Reveal className={s.head}>
            <WordReveal>Set it up once. <span className={s.grad}>Saathi does the rest.</span></WordReveal>
            <p>A few minutes to set up. After that, Saathi calls on time and you see how every call went.</p>
          </Reveal>
          <LiveCallPhone />
        </div>
      </section>
    );
  }

  let beat = 0;
  BEATS.forEach((b, i) => { if (t >= b.from) beat = i; });
  const stepFill = (i: number) => {
    const end = BEATS[i + 1]?.from ?? END;
    return Math.min(1, Math.max(0, (t - BEATS[i].from) / (end - BEATS[i].from)));
  };

  return (
    <section id={embedded ? undefined : 'how'} ref={root} className={`${x.film} ${embedded ? x.embedded : ''}`} aria-label="How it works: an example morning call">
      <div className={`wrap ${x.grid}`}>
        <div className={x.copy}>
          <p className={x.eyebrow}>How it works</p>

          <div className={x.kickers} aria-hidden="true">
            {BEATS.map((b, i) => <span key={i} className={x.kicker} data-on={i === beat || undefined}>{b.kicker}</span>)}
          </div>

          <div className={x.titles}>
            {BEATS.map((b, i) => (
              <h2 key={i} className={x.title} data-on={i === beat || undefined} data-past={i < beat || undefined} aria-hidden={i !== beat || undefined}>
                {b.title.map((w, wi) => (
                  <React.Fragment key={wi}>
                    {wi > 0 && ' '}
                    <span className={x.word}>
                      <span style={{ ['--w' as string]: wi }}>{ACCENT.has(w) ? <em>{w}</em> : w}</span>
                    </span>
                  </React.Fragment>
                ))}
              </h2>
            ))}
          </div>

          <div className={x.bodies}>
            {BEATS.map((b, i) => <p key={i} className={x.body} data-on={i === beat || undefined} aria-hidden={i !== beat || undefined}>{b.body}</p>)}
          </div>

          <ol className={x.steps} aria-label="Parts of the film">
            {BEATS.map((b, i) => (
              <li key={i}>
                <button type="button" onClick={() => seek(b.from)} aria-label={`Play from: ${b.title.join(' ')}`} aria-current={i === beat || undefined}>
                  <i style={{ transform: `scaleX(${stepFill(i)})` }} />
                </button>
              </li>
            ))}
          </ol>

          <div className={x.controls}>
            <div className={x.langs} role="group" aria-label="Call language">
              {CALL_LANGS.map((l) => (
                <button key={l.key} type="button" aria-pressed={lang === l.key} onClick={() => { setLang(l.key); seek(0); }}>{l.label}</button>
              ))}
            </div>
            <button type="button" className={x.pause} aria-pressed={paused} aria-label={paused ? 'Play the film' : 'Pause the film'} onClick={() => setPaused((p) => !p)}>
              {paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
            </button>
          </div>
        </div>

        <div className={x.slot} ref={slot} data-beat={beat}>
          <div className={x.glow} aria-hidden="true" />
          <div className={x.screen} data-grow data-fading={fading || undefined} style={{ width: FW * k, height: FH * k }} aria-hidden="true">
            <div className={x.frame} style={{ width: FW, height: FH, transform: `scale(${k})` }}>
              <CallPhone t={t} lang={lang} still={STILL} />
              <WaPhone t={t} still={STILL} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
