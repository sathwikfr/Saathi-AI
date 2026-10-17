'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from 'motion/react';
// The /dev/brag launch film's scenes: every frame is a pure function of film time `t`, so the scroll can play them.
import { CallPhone, WaPhone, ANSWER_AT, CUT_WA, TAP_AT } from '@/app/dev/brag/BragFilm';
import { Reveal } from '@/components/Reveal';
import { WordReveal } from '@/components/motion/WordReveal';
import { LiveCallPhone } from './LiveCallPhone';
import { CALL_LANGS, CALL_LANG_EVENT, isCallLang, type CallLang } from './callScript';
import s from './home.module.css';
import x from './howFilm.module.css';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * "How it works" as a film your scroll plays: Amma's phone rings, Saathi asks about her tablet in her
 * language, she mentions her knee, and a minute later the update lands on your WhatsApp, where you tap
 * "I'll handle it". The section is tall and its frame sticks while the scroll scrubs film time; one
 * caption per beat rises in word by word. The en/te/hi switch (and the Languages section's "Hear it")
 * changes the call's language. With reduced motion it is today's self-playing phone demo instead.
 */

const END = TAP_AT + 350;   // the tap on "I'll handle it" lands, then the section lets go
const PARENT_KNEE_AT = 7400; // BragFilm LINES[3]: Amma mentions her knee

const BEATS = [
  { from: 0, kicker: '8:30 AM', title: ['Saathi', 'calls', 'Amma.'], body: 'Her own phone rings. Nothing to install, nothing to learn.' },
  { from: ANSWER_AT + 300, kicker: 'On the call', title: ['Her', 'medicines,', 'in', 'her', 'language.'], body: '“Did you take your BP tablet?” “Yes, just now.”' },
  { from: PARENT_KNEE_AT, kicker: 'Listening', title: ['It', 'hears', 'what', 'she', 'mentions.'], body: 'Knee pain since yesterday: noted, and passed on to you.' },
  { from: CUT_WA - 300, kicker: '8:31 AM', title: ['A', 'minute', 'later,', 'on', 'your', 'WhatsApp.'], body: 'What she took, how she felt, and what needs you.' },
  { from: TAP_AT - 1000, kicker: 'One tap', title: ['You’ve', 'got', 'it.'], body: '“I’ll handle it”, and the family can see who is on it.' },
];
const ACCENT = new Set(['Amma.', 'language.', 'mentions.', 'WhatsApp.', 'it.']);

export function HowFilm() {
  const reduce = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [k, setK] = useState(0.8);
  const [lang, setLang] = useState<CallLang>('en');

  // "Hear it" in the Languages section switches the call's language.
  useEffect(() => {
    const onLang = (e: Event) => { const v = (e as CustomEvent).detail; if (isCallLang(v)) setLang(v); };
    window.addEventListener(CALL_LANG_EVENT, onLang);
    return () => window.removeEventListener(CALL_LANG_EVENT, onLang);
  }, []);

  // Fit the 360x640 film into the space beside (or under) the captions.
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setK(Math.max(0.3, Math.min(1.3, (height - 8) / 640, width / 360)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [reduce]);

  // The scroll through the section is film time.
  useGSAP(() => {
    if (!root.current) return;
    const proxy = { t: 0 };
    gsap.to(proxy, {
      t: END, ease: 'none',
      onUpdate: () => setT(proxy.t),
      scrollTrigger: { trigger: root.current, start: 'top 68px', end: 'bottom bottom', scrub: 0.6 },
    });
  }, { dependencies: [reduce], revertOnUpdate: true });

  if (reduce) {
    return (
      <section id="how" className={`section ${s.alt}`}>
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
    <section id="how" ref={root} className={x.film} aria-label="How it works: an example morning call" data-t={Math.round(t)}>
      <div className={x.sticky}>
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

          <ol className={x.steps} aria-hidden="true">
            {BEATS.map((b, i) => <li key={i}><i style={{ transform: `scaleX(${stepFill(i)})` }} /></li>)}
          </ol>

          <div className={x.langs} role="group" aria-label="Call language">
            {CALL_LANGS.map((l) => (
              <button key={l.key} type="button" aria-pressed={lang === l.key} onClick={() => setLang(l.key)}>{l.label}</button>
            ))}
          </div>
        </div>

        <div className={x.slot} ref={slot} data-beat={beat}>
          <div className={x.glow} aria-hidden="true" />
          <div className={x.screen} data-grow style={{ width: 360 * k, height: 640 * k }} aria-hidden="true">
            <div className={x.frame} style={{ transform: `scale(${k})` }}>
              <CallPhone t={t} lang={lang} />
              <WaPhone t={t} />
            </div>
            <span className={x.bar}><i style={{ transform: `scaleX(${t / END})` }} /></span>
          </div>
        </div>
      </div>
    </section>
  );
}
