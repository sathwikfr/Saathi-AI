'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { PhoneCall, MessageCircle } from 'lucide-react';
import { HowFilm } from './HowFilm';
import { RemindSection } from './RemindSection';
import s from './howSection.module.css';

/**
 * "How it works" in one frame: a toggle between the phone-call film (phone on the right) and the WhatsApp
 * reminder film (phone on the left), laid out alike. On its own it plays one, then the other, forever
 * (each film hands over when it has rested and faded out); the moment someone picks a side it stays there
 * and loops. The nav's "#how" and "#remind" links both land here, "#remind" on the WhatsApp side.
 */

type Tab = 'call' | 'remind';

/** Fired with 'call' | 'remind' when the visitor picks a side (not on the toggle's own switching); the
 * "Know how she is" section below follows it. */
export const HOW_PICK_EVENT = 'aaptha:how-pick';

export function HowSection() {
  const [tab, setTab] = useState<Tab>('call');
  const [auto, setAuto] = useState(true);

  const pick = useCallback((t: Tab) => {
    setAuto(false);
    setTab(t);
    // after this commit's effects, so the section below is listening even when "#remind" picks on load
    queueMicrotask(() => window.dispatchEvent(new CustomEvent(HOW_PICK_EVENT, { detail: t })));
  }, []);
  const next = useCallback(() => setTab((t) => (t === 'call' ? 'remind' : 'call')), []);

  // "#remind" (the nav's WhatsApp link, the Remind plan card) opens the WhatsApp side. Next's <Link> changes the
  // hash with pushState, which fires no hashchange, and a second click on a hash already in the URL changes nothing,
  // so the clicks themselves are watched too.
  useEffect(() => {
    const sync = () => { if (window.location.hash === '#remind') pick('remind'); };
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('a[href$="#remind"]')) pick('remind');
    };
    sync();
    window.addEventListener('hashchange', sync);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', sync);
      document.removeEventListener('click', onClick);
    };
  }, [pick]);

  return (
    <section id="how" className={s.wrap}>
      <span id="remind" className={s.anchor} aria-hidden="true" />
      <div className={s.bar}>
        <div className={s.toggle} role="group" aria-label="How it works">
          <span className={s.thumb} data-tab={tab} aria-hidden="true" />
          <button type="button" aria-pressed={tab === 'call'} onClick={() => pick('call')}>
            <PhoneCall size={16} /> A phone call
          </button>
          <button type="button" aria-pressed={tab === 'remind'} onClick={() => pick('remind')}>
            <MessageCircle size={16} /> WhatsApp reminders
          </button>
        </div>
      </div>
      <div key={tab} className={s.film}>
        {tab === 'call'
          ? <HowFilm embedded onEnd={auto ? next : undefined} />
          : <RemindSection embedded onEnd={auto ? next : undefined} />}
      </div>
    </section>
  );
}
