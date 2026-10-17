'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { PhoneCall, AlertTriangle, Check, Camera, Pause } from 'lucide-react';
import { Reveal } from '@/components/Reveal';
import { WordReveal } from '@/components/motion/WordReveal';
import s from './home.module.css';
import x from './safety.module.css';

/**
 * "A companion, not a doctor": the four safety promises as equal cards, each
 * showing a tiny example of the promise in action (like the phone demo above)
 * with a title and one line under it. Once a card has scrolled into view its example plays as a
 * short loop (each card a little out of step with the others, a soft tint of its own behind it).
 * Everything here is illustrative; nothing is fetched.
 */

function DoctorDemo() {
  return (
    <div className={x.chat}>
      <span className={`${x.bubble} ${x.fromAmma}`}>
        <small>Amma</small>Can I take two tablets for the pain?
      </span>
      <span className={`${x.bubble} ${x.fromSaathi}`}>
        <small>Saathi</small>
        <span className={x.reply}>I can’t advise on medicines. Please ask your doctor, and I’ll tell your family.</span>
        <span className={x.dots}><i /><i /><i /></span>
      </span>
    </div>
  );
}

function WarningDemo() {
  return (
    <div className={x.stack}>
      <span className={x.alert}>
        <span className={x.alertIcon}><AlertTriangle size={16} /></span>
        <span className={x.alertText}>
          <b>Amma said she felt dizzy</b>
          <small>Saathi asked her to call someone nearby.</small>
        </span>
      </span>
      <span className={x.sent}><Check size={13} strokeWidth={3} /> Sent to you right away · 8:32 AM</span>
    </div>
  );
}

function ConsentDemo() {
  return (
    <div className={x.settings}>
      <span className={x.setRow}>
        <span className={x.okDot}><Check size={12} strokeWidth={3} /></span>
        <span>Amma agreed to the calls</span>
      </span>
      <span className={x.setRow}>
        <span>Daily calls</span>
        <span className={x.toggle} />
      </span>
      <span className={x.setRow}>
        <span>Going on a trip?</span>
        <span className={x.pauseBtn}><Pause size={12} /> Pause</span>
      </span>
    </div>
  );
}

function MedsDemo() {
  return (
    <div className={x.meds}>
      <span className={x.medsHead}><Camera size={13} /> Read from the prescription photo</span>
      <span className={x.med}>
        <span className={x.box}><Check size={12} strokeWidth={3} /></span>
        <b>Amlodipine 5mg</b><small>after breakfast</small>
      </span>
      <span className={x.med}>
        <span className={x.box}><Check size={12} strokeWidth={3} /></span>
        <b>Metformin 500mg</b><small>after dinner</small>
      </span>
      <span className={x.confirm}>Confirm list</span>
    </div>
  );
}

// The film (Remotion) loads only as the section comes near, so it never weighs on the first page load.
const SafetyFilmPlayer = dynamic(() => import('@/components/film/SafetyFilmPlayer'), { ssr: false });

/** A 9:16 screen that reserves its space and mounts the film once it is within a screen of view. */
function FilmSlot() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={x.film} aria-label="Example: what happens when Amma mentions chest pain on a call" role="img">
      {near && <SafetyFilmPlayer />}
    </div>
  );
}

const PROMISES = [
  { title: 'Never plays doctor', body: 'Saathi doesn’t diagnose or give medical advice. Health questions go to their doctor, or to you.', Demo: DoctorDemo, tint: 'var(--green-soft)' },
  { title: 'Listens for warning signs', body: 'A fall, chest pain, feeling faint: Saathi stays calm, asks them to get help, and tells you straight away.', Demo: WarningDemo, tint: 'var(--red-soft)' },
  { title: 'Consent comes first', body: 'Calls only start once your parent has agreed. Pause or stop them at any time.', Demo: ConsentDemo, tint: 'var(--teal-soft)' },
  { title: 'You confirm every medicine', body: 'We draft the list from a prescription photo. Nothing is saved until you have checked it.', Demo: MedsDemo, tint: 'var(--blue-soft)' },
];

export function SafetySection() {
  return (
    <section id="safety" className="section">
      <div className="wrap">
        <Reveal className={s.head}>
          <WordReveal>A companion, <span className={s.grad}>not a doctor.</span></WordReveal>
          <p>Saathi is gentle and knows its limits. It keeps your parents connected to you, and never replaces the people who care for them.</p>
        </Reveal>

        <div className={x.split}>
          <Reveal variant="scale" className={x.filmCol}>
            <div data-grow>
              <FilmSlot />
            </div>
          </Reveal>

          <div className={x.grid}>
            {PROMISES.map(({ title, body, Demo, tint }, i) => (
              <Reveal
                key={title}
                delay={i * 90}
                className={x.card}
                data-spot
                style={{ ['--phase' as string]: `${i * -1.75}s`, ['--tint' as string]: tint }}
              >
                <div className={x.demo} aria-hidden="true"><Demo /></div>
                <div className={x.text}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <Reveal className={x.sos}>
          <PhoneCall size={16} aria-hidden="true" />
          <span>Aaptha is not an emergency service. In an emergency, call <b>112</b>.</span>
        </Reveal>
      </div>
    </section>
  );
}
