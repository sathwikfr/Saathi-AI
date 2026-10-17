import React from 'react';
import { Play } from 'lucide-react';
import { Reveal } from '@/components/Reveal';
import { WordReveal } from '@/components/motion/WordReveal';
import { CALL_LANG_EVENT, isCallLang } from './callScript';
import s from './home.module.css';
import x from './languages.module.css';

/**
 * "Speaks the way Amma speaks": two slow rows of greeting cards drifting in
 * opposite directions, one card per language, each showing how Saathi says
 * hello in that language's own script (greeting words only, so every script
 * is something we're sure of). Hovering a row pauses it. The languages the
 * phone demo has (English, Telugu, Hindi) get "Hear it", which scrolls up to
 * the phone and switches its call to that language. Under the rows, a parent
 * mixing English into Hindi. With reduced motion the cards sit still.
 */

type Lang = { key: string; name: string; native: string; hello: string; say: string };

const ROW_A: Lang[] = [
  { key: 'hi', name: 'Hindi', native: 'हिंदी', hello: 'नमस्ते', say: 'namaste' },
  { key: 'te', name: 'Telugu', native: 'తెలుగు', hello: 'నమస్కారం', say: 'namaskaram' },
  { key: 'ta', name: 'Tamil', native: 'தமிழ்', hello: 'வணக்கம்', say: 'vanakkam' },
  { key: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', hello: 'ನಮಸ್ಕಾರ', say: 'namaskara' },
  { key: 'ml', name: 'Malayalam', native: 'മലയാളം', hello: 'നമസ്കാരം', say: 'namaskaram' },
];

const ROW_B: Lang[] = [
  { key: 'bn', name: 'Bengali', native: 'বাংলা', hello: 'নমস্কার', say: 'nomoshkar' },
  { key: 'mr', name: 'Marathi', native: 'मराठी', hello: 'नमस्कार', say: 'namaskar' },
  { key: 'gu', name: 'Gujarati', native: 'ગુજરાતી', hello: 'નમસ્તે', say: 'namaste' },
  { key: 'en', name: 'English', native: 'English', hello: 'Hello', say: 'or a mix of both' },
];

/** Copies of a row in each half of the track, so one half is wider than a wide screen. */
const COPIES = 3;

function hearIt(key: string) {
  if (!isCallLang(key)) return;
  window.dispatchEvent(new CustomEvent(CALL_LANG_EVENT, { detail: key }));
  document.getElementById('how')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Card({ l, hidden }: { l: Lang; hidden: boolean }) {
  return (
    <li className={x.card} aria-hidden={hidden || undefined}>
      <span className={x.name}>{l.name}</span>
      <span className={x.hello} lang={l.key}>{l.hello}</span>
      <span className={x.say}>
        {l.native !== l.name && <><span lang={l.key}>{l.native}</span> · </>}
        {l.say}
      </span>
      {isCallLang(l.key) && (
        <button
          type="button"
          className={x.hear}
          onClick={() => hearIt(l.key)}
          tabIndex={hidden ? -1 : undefined}
          aria-label={`Hear the example call in ${l.name}`}
        >
          <Play size={11} fill="currentColor" strokeWidth={0} /> Hear it
        </button>
      )}
    </li>
  );
}

function Row({ langs, reverse }: { langs: Lang[]; reverse?: boolean }) {
  // Two identical halves; the track slides by exactly one half, so the loop is seamless.
  const half = Array.from({ length: COPIES }, () => langs).flat();
  return (
    <div className={x.row}>
      <ul className={`${x.track} ${reverse ? x.reverse : ''}`}>
        {[...half, ...half].map((l, i) => (
          <Card key={`${l.key}-${i}`} l={l} hidden={i >= langs.length} />
        ))}
      </ul>
    </div>
  );
}

export function LanguagesSection() {
  return (
    <section className={`section ${s.alt}`}>
      <div className="wrap">
        <Reveal className={s.head}>
          <WordReveal>Speaks the way <span className={s.grad}>Amma speaks.</span></WordReveal>
          <p>Saathi talks in the language your parent thinks in. You choose it when you add them, and can change it any time.</p>
        </Reveal>
      </div>

      <Reveal variant="fade" className={x.marquee}>
        <div role="group" aria-label="Languages Saathi speaks">
          <Row langs={ROW_A} />
          <Row langs={ROW_B} reverse />
        </div>
      </Reveal>

      {/* Mixing in English is fine */}
      <Reveal className={`wrap ${x.mix}`}>
        <span className={`${x.bubble} ${x.fromSaathi}`}><small>Saathi</small>BP ki goli li?</span>
        <span className={`${x.bubble} ${x.fromAmma}`}><small>Amma</small>Haan, tablet le li. Bas knee mein thoda pain hai.</span>
        <p className={x.mixNote}>A little English mixed in? Saathi still understands.</p>
      </Reveal>
    </section>
  );
}
