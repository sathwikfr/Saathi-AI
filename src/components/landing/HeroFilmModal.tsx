'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
// The /dev/brag launch film's scenes: every frame is a pure function of film time `t`.
import { CallPhone, WaPhone, ANSWER_AT, CUT_WA, TAP_AT, DW, DH, type Cam } from '@/app/dev/brag/BragFilm';
import { LiveCallPhone } from './LiveCallPhone';
import type { CallLang } from './callScript';
import s from './voiceHero.module.css';

/**
 * The hero's "Watch video": the morning-call film (Amma's phone rings, Saathi asks, the update lands on
 * your WhatsApp) in a player that grows out of the button (a shared `layoutId`) and shrinks back into it.
 * Plays once on its own clock; the chapter bars jump to a part. Reduced motion: no morph, and the
 * self-playing phone demo instead of the film.
 */

const END = TAP_AT + 700;
const PAD = 12;
const FW = DW + PAD * 2;
const FH = DH + PAD * 2;
const STILL: Cam = { x: PAD, y: PAD, s: 1 };

const CHAPTERS = [
  { from: 0, kicker: '8:30 AM', text: 'Saathi calls Amma on her own phone.' },
  { from: ANSWER_AT, kicker: 'On the call', text: 'Her medicines, in her language.' },
  { from: CUT_WA - 300, kicker: '8:31 AM', text: 'A minute later, the update is on your WhatsApp.' },
  { from: TAP_AT - 1000, kicker: 'One tap', text: '“I’ll handle it”, and the family sees who is on it.' },
];

const subscribe = () => () => {};

export function HeroFilmModal({ open, onClose, lang, layoutId }: { open: boolean; onClose: () => void; lang: CallLang; layoutId: string }) {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  if (!isClient) return null;
  return createPortal(
    <AnimatePresence>{open && <FilmDialog key="film" onClose={onClose} lang={lang} layoutId={layoutId} />}</AnimatePresence>,
    document.body,
  );
}

function FilmDialog({ onClose, lang, layoutId }: { onClose: () => void; lang: CallLang; layoutId: string }) {
  const reduce = useReducedMotion();
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [k, setK] = useState(1);
  const tRef = useRef(0);
  const slot = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Fit the whole phone into its space.
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setK(Math.max(0.4, Math.min(1.5, height / FH, width / FW)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The film's clock: runs to the end once, then waits for Replay.
  useEffect(() => {
    if (!playing || reduce) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(64, now - last) : 0;
      last = now;
      const next = Math.min(END, tRef.current + dt);
      tRef.current = next;
      setT(next);
      if (next >= END) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, reduce]);

  const seek = (v: number) => { tRef.current = v; setT(v); setPlaying(true); };
  const ended = t >= END;

  let ch = 0;
  CHAPTERS.forEach((c, i) => { if (t >= c.from) ch = i; });
  const fill = (i: number) => {
    const end = CHAPTERS[i + 1]?.from ?? END;
    return Math.min(1, Math.max(0, (t - CHAPTERS[i].from) / (end - CHAPTERS[i].from)));
  };

  return (
    <motion.div
      className={s.filmBackdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        layoutId={layoutId}
        className={s.filmCard}
        style={{ borderRadius: 28 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hero-film-title"
        transition={{ type: 'spring', stiffness: 220, damping: 28 }}
      >
        <motion.div
          className={s.filmInner}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.28, duration: 0.35 } }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          <div className={s.filmTop}>
            <h2 id="hero-film-title" className={s.filmTitle}>One morning call, start to finish</h2>
            <button ref={closeBtn} type="button" className={s.filmIconBtn} onClick={onClose} aria-label="Close the video">
              <X size={18} />
            </button>
          </div>

          <div className={s.filmBody}>
            <div className={s.filmText} aria-live="polite">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={ch}
                  initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -14, filter: 'blur(6px)' }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span className={s.filmKicker}>{CHAPTERS[ch].kicker}</span>
                  <p className={s.filmCaption}>{CHAPTERS[ch].text}</p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className={s.filmSlot} ref={slot} data-chapter={ch}>
              {reduce ? (
                <LiveCallPhone />
              ) : (
                <div className={s.filmScreen} style={{ width: FW * k, height: FH * k }} aria-hidden="true">
                  <div className={s.filmFrame} style={{ width: FW, height: FH, transform: `scale(${k})` }}>
                    <CallPhone t={t} lang={lang} still={STILL} />
                    <WaPhone t={t} still={STILL} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {!reduce && (
            <div className={s.filmControls}>
              <button
                type="button"
                className={s.filmIconBtn}
                onClick={() => (ended ? seek(0) : setPlaying((p) => !p))}
                aria-label={ended ? 'Play again' : playing ? 'Pause' : 'Play'}
              >
                {ended ? <RotateCcw size={16} /> : playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
              </button>
              <ol className={s.filmChapters} aria-label="Parts of the video">
                {CHAPTERS.map((c, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => seek(c.from)} aria-label={`Play from: ${c.text}`} aria-current={i === ch || undefined}>
                      <i style={{ transform: `scaleX(${fill(i)})` }} />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
