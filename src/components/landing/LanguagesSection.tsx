'use client';

import React, { useEffect, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { Reveal } from '@/components/Reveal';
import { WordReveal } from '@/components/motion/WordReveal';
import s from './home.module.css';
import x from './languages.module.css';

/**
 * "Speaks the way Amma speaks": a stage with one big greeting (how Saathi says hello, in that language's
 * own script: greeting words only, so every script is something we're sure of) beside the nine languages
 * to pick from. It opens on Telugu and changes only when someone picks a language. "Hear it" says the
 * greeting aloud with the browser's own voice for that language (when the browser has none, it reads the
 * transliteration in English and says so); the bars move while it speaks.
 */

type Lang = { key: string; name: string; native: string; hello: string; say: string };

const LANGS: Lang[] = [
  { key: 'hi', name: 'Hindi', native: 'हिंदी', hello: 'नमस्ते', say: 'namaste' },
  { key: 'te', name: 'Telugu', native: 'తెలుగు', hello: 'నమస్కారం', say: 'namaskaram' },
  { key: 'ta', name: 'Tamil', native: 'தமிழ்', hello: 'வணக்கம்', say: 'vanakkam' },
  { key: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', hello: 'ನಮಸ್ಕಾರ', say: 'namaskara' },
  { key: 'ml', name: 'Malayalam', native: 'മലയാളം', hello: 'നമസ്കാരം', say: 'namaskaram' },
  { key: 'bn', name: 'Bengali', native: 'বাংলা', hello: 'নমস্কার', say: 'nomoshkar' },
  { key: 'mr', name: 'Marathi', native: 'मराठी', hello: 'नमस्कार', say: 'namaskar' },
  { key: 'gu', name: 'Gujarati', native: 'ગુજરાતી', hello: 'નમસ્તે', say: 'namaste' },
  { key: 'en', name: 'English', native: 'English', hello: 'Hello', say: 'or a mix of both' },
];

const TELUGU = 1;
const BARS = 28;

/** Letters (code points) in a greeting, at least 5: sets its size so long words fit and short ones stay big. */
const wordLen = (w: string) => Math.max(5, [...w].length);

/** The browser's voices; the list can be empty until 'voiceschanged' fires, so wait for it briefly. */
function voicesOf(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => { synth.removeEventListener('voiceschanged', done); resolve(synth.getVoices()); };
    synth.addEventListener('voiceschanged', done);
    window.setTimeout(done, 1200);
  });
}

function pickVoice(voices: SpeechSynthesisVoice[], prefix: string) {
  const match = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(prefix));
  return match.find((v) => /-in$/i.test(v.lang.replace('_', '-'))) ?? match[0];
}

export function LanguagesSection() {
  const [idx, setIdx] = useState(TELUGU);
  const [speaking, setSpeaking] = useState(false);
  const [note, setNote] = useState('');
  const l = LANGS[idx];

  // Stop talking when the section goes away.
  useEffect(() => () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }, []);

  const pick = (i: number) => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeaking(false);
    setNote('');
    setIdx(i);
  };

  const hear = async () => {
    if (!('speechSynthesis' in window)) { setNote('Your browser can’t play speech, so this shows the words only.'); return; }
    const synth = window.speechSynthesis;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    synth.cancel();
    const voices = await voicesOf(synth);
    const own = pickVoice(voices, l.key);
    const english = pickVoice(voices, 'en');
    const u = new SpeechSynthesisUtterance(own || l.key === 'en' ? l.hello : l.say);
    u.lang = own?.lang ?? english?.lang ?? 'en-IN';
    u.voice = own ?? english ?? null;
    u.rate = 0.9;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setNote(own || l.key === 'en'
      ? 'This uses your browser’s voice. Real calls use Saathi’s own voice.'
      : `Your browser has no ${l.name} voice, so it reads “${l.say}” in English. Real calls speak ${l.name}.`);
    setSpeaking(true);
    synth.speak(u);
  };

  return (
    <section className={`section ${s.alt} ${x.section}`}>
      <div className="wrap">
        <Reveal className={s.head}>
          <WordReveal>Speaks the way <span className={s.grad}>Amma speaks.</span></WordReveal>
          <p>Saathi talks in the language your parent thinks in. You choose it when you add them, and can change it any time.</p>
        </Reveal>

        <Reveal variant="scale">
          <div className={x.stage}>
            <span className={x.aura} aria-hidden="true" />

            {/* The greeting */}
            <div className={x.feature} aria-live="polite">
              <span className={x.count} aria-hidden="true">
                {String(idx + 1).padStart(2, '0')}<i> / {String(LANGS.length).padStart(2, '0')}</i>
              </span>
              <span key={l.key} className={x.big} lang={l.key} style={{ ['--len' as string]: wordLen(l.hello) }}>{l.hello}</span>
              <span key={`${l.key}-m`} className={x.meta}>
                <b>{l.name}</b>
                {l.native !== l.name && <span lang={l.key}>{l.native}</span>}
                <span>{l.say}</span>
              </span>

              <div className={x.voice} data-on={speaking || undefined} aria-hidden="true">
                {Array.from({ length: BARS }, (_, i) => (
                  <i key={i} style={{ ['--b' as string]: i, ['--h' as string]: (0.3 + 0.7 * Math.abs(Math.sin(i * 1.7 + idx))).toFixed(2) }} />
                ))}
              </div>

              <div className={x.footRow}>
                <button type="button" className={x.hear} onClick={hear} aria-pressed={speaking}>
                  {speaking
                    ? <><Square size={11} fill="currentColor" strokeWidth={0} /> Stop</>
                    : <><Play size={12} fill="currentColor" strokeWidth={0} /> Hear it in {l.name}</>}
                </button>
              </div>
              {note && <p className={x.hearNote}>{note}</p>}
            </div>

            {/* The nine to pick from */}
            <ul className={x.grid} aria-label="Languages Saathi speaks">
              {LANGS.map((g, i) => (
                <li key={g.key}>
                  <button type="button" className={x.tile} aria-pressed={i === idx} onClick={() => pick(i)}>
                    <span className={x.tileHello} lang={g.key} style={{ ['--len' as string]: wordLen(g.hello) }}>{g.hello}</span>
                    <span className={x.tileName}>{g.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
