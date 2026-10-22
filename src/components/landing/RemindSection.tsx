'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Pause, Play } from 'lucide-react';
// The Remind launch film's phones (/dev/brag-remind): every frame is a pure function of film time `t`.
import { PersonPhone, CaretakerPhone, NOT_YET_AT, YES_AT, CUT_CARE, CARE_TAP_AT } from '@/app/dev/brag/RemindFilm';
import { DW, DH, type Cam } from '@/app/dev/brag/BragFilm';
import { PLANS } from '@/lib/plans';
import x from './howFilm.module.css';
import m from './remindSection.module.css';

/**
 * Remind (₹99, WhatsApp only) as a short film beside "How it works": the medicine check on WhatsApp,
 * "Not yet", asked again, "Yes, taken", then the caretaker's alert. Same player and the same layout as
 * HowFilm (plays while on screen, rests, fades, loops; the bars jump to a part), mirrored: phone on the
 * left, captions on the right. The price and trial button live in the Plans section, not here.
 */

const START = 3000;
const END = CARE_TAP_AT + 1200;
const HOLD_MS = 2400;
const FADE_MS = 500;

const PAD = 12;
const FW = DW + PAD * 2;
const FH = DH + PAD * 2;
const STILL: Cam = { x: PAD, y: PAD, s: 1 };

const BEATS = [
  { from: START, kicker: '8:00 AM', title: ['A', 'WhatsApp', 'at', 'medicine', 'time.'], body: '“Did you take your 8:00 AM medicine?” Yes, taken or Not yet: one tap.' },
  { from: NOT_YET_AT, kicker: 'Not yet', title: ['Asked', 'again', 'in', '30', 'minutes.'], body: 'Up to 3 times. No reply counts as not yet.' },
  { from: YES_AT - 300, kicker: 'Yes, taken', title: ['Noted.', 'That’s', 'all.'], body: 'No app to install, and no spam: Aaptha only writes when a medicine is due.' },
  { from: CUT_CARE - 300, kicker: 'Caretaker', title: ['Not', 'confirmed?', 'You’re', 'told.'], body: 'Optional: a caretaker (you, a husband, a parent) hears only when a dose isn’t confirmed, at most twice a day.' },
];
const ACCENT = new Set(['time.', 'minutes.', 'Noted.', 'told.']);

/** `embedded` / `onEnd`: as in HowFilm (shown inside HowSection, which switches films when this one ends). */
export function RemindSection({ embedded = false, onEnd }: { embedded?: boolean; onEnd?: () => void }) {
  const reduce = useReducedMotion();
  const onEndRef = useRef(onEnd);
  useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);
  const root = useRef<HTMLElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const tRef = useRef(START);
  const [played, setT] = useState(START);
  const [k, setK] = useState(1);
  const [fading, setFading] = useState(false);
  const [paused, setPaused] = useState(false);   // WCAG 2.2.2: the film that starts by itself can be stopped
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  // Reduced motion: one still frame ("Yes, taken" noted) instead of the film.
  const t = reduce ? YES_AT + 1800 : played;

  const seek = (v: number) => { tRef.current = v; setT(v); setFading(false); };

  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setK(Math.max(0.5, Math.min(1.6, height / FH, width / FW)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Play while on screen; rest on the last frame, fade out, start again, fade in.
  useEffect(() => {
    if (reduce) return;
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
          next = START;
          setFading(false);
        }
        else if (held > HOLD_MS) setFading(true);
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

  let beat = 0;
  BEATS.forEach((b, i) => { if (t >= b.from) beat = i; });
  const stepFill = (i: number) => {
    const end = BEATS[i + 1]?.from ?? END;
    return Math.min(1, Math.max(0, (t - BEATS[i].from) / (end - BEATS[i].from)));
  };

  return (
    <section id={embedded ? undefined : 'remind'} ref={root} className={`${x.film} ${embedded ? x.embedded : ''}`} aria-label="Remind: medicine checks on WhatsApp, an example morning">
      <div className={`wrap ${x.grid} ${m.grid}`}>
        <div className={x.copy}>
          <p className={x.eyebrow}>How it works <span className={m.plan}>{PLANS.essential.name}</span></p>

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

          <ol className={`${x.steps} ${m.steps}`} aria-label="Parts of the film">
            {BEATS.map((b, i) => (
              <li key={i}>
                <button type="button" onClick={() => seek(b.from)} aria-label={`Play from: ${b.title.join(' ')}`} aria-current={i === beat || undefined}>
                  <i style={{ transform: `scaleX(${stepFill(i)})` }} />
                </button>
              </li>
            ))}
          </ol>

          {!reduce && (
            <div className={x.controls}>
              <button type="button" className={x.pause} aria-pressed={paused} aria-label={paused ? 'Play the film' : 'Pause the film'} onClick={() => setPaused((p) => !p)}>
                {paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
              </button>
            </div>
          )}
        </div>

        <div className={`${x.slot} ${m.slot}`} ref={slot} data-beat={beat}>
          <div className={`${x.glow} ${m.glow}`} aria-hidden="true" />
          <div className={x.screen} data-fading={fading || undefined} style={{ width: FW * k, height: FH * k }} aria-hidden="true">
            <div className={x.frame} style={{ width: FW, height: FH, transform: `scale(${k})` }}>
              <PersonPhone t={t} still={STILL} />
              <CaretakerPhone t={t} still={STILL} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
