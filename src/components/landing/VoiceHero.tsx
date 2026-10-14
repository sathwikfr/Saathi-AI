'use client';

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowRight, Play, Square, RotateCcw } from 'lucide-react';
import { type OrbMode, type SaathiOrbHandle } from '@/components/voice/SaathiOrb';
import { SaathiBlob } from '@/components/voice/SaathiBlob';
import { MagneticLink } from '@/components/motion/MagneticLink';
import { WordReveal } from '@/components/motion/WordReveal';
import s from './voiceHero.module.css';

/**
 * Landing hero: the pitch on the left, Saathi's voice orb (a living glass blob) on the right.
 * Tap it and Saathi greets Amma out loud (browser speech synthesis), Amma
 * answers, and Saathi says hello to you. The live captions appear inside the
 * orb, one sentence at a time with the spoken words lighting up, above its
 * centre; the language switch sits just under it.
 */

type LangKey = 'te' | 'hi' | 'en';

const LANGS: Record<LangKey, {
  label: string;
  voice: string;           // BCP-47 prefix we look for
  native: string;          // spoken when the browser has a voice for it
  roman: string;           // spoken (in English voice) when it doesn't
  en: string;
  reply: { native: string; roman: string; en: string };
}> = {
  en: {
    label: 'English',
    voice: 'en',
    native: 'Hello Amma! This is Saathi. Have you had breakfast? Did you take your BP tablet?',
    roman: 'Hello Amma! This is Saathi. Have you had breakfast? Did you take your BP tablet?',
    en: '',
    reply: { native: 'Yes, I took it.', roman: 'Yes, I took it.', en: '' },
  },
  te: {
    label: 'తెలుగు',
    voice: 'te',
    native: 'నమస్కారం అమ్మగారు! నేను సాథీ. టిఫిన్ అయ్యిందా? బీపీ టాబ్లెట్ వేసుకున్నారా?',
    roman: 'Namaskaram Ammagaru! Nenu Saathi. Tiffin ayyinda? BP tablet vesukunnara?',
    en: 'Hello Ammagaru! I’m Saathi. Have you had breakfast? Did you take your BP tablet?',
    reply: { native: 'ఆ, వేసుకున్నాను.', roman: 'Aa, vesukunnanu.', en: 'Yes, I took it.' },
  },
  hi: {
    label: 'हिंदी',
    voice: 'hi',
    native: 'नमस्ते अम्मा जी! मैं साथी हूँ। नाश्ता हो गया? बीपी की गोली ली?',
    roman: 'Namaste Amma ji! Main Saathi hoon. Nashta ho gaya? BP ki goli li?',
    en: 'Hello Amma ji! I’m Saathi. Have you had breakfast? Did you take your BP tablet?',
    reply: { native: 'हाँ, ले ली।', roman: 'Haan, le li.', en: 'Yes, I took it.' },
  },
};

const TO_YOU = 'Hello to you too. I’m Saathi. I’ll call your mother like this every day, and tell you how she is.';

type Line = { text: string; lang: string; voice?: SpeechSynthesisVoice; en: string; to: 'parent' | 'reply' | 'you'; pitch: number };
type Status = 'idle' | 'speaking' | 'done';
type Chunk = { start: number; text: string };

function pickVoice(voices: SpeechSynthesisVoice[], prefix: string) {
  const match = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(prefix));
  return match.find((v) => /-in$/i.test(v.lang.replace('_', '-'))) ?? match[0];
}

function buildScript(lang: LangKey, voices: SpeechSynthesisVoice[]) {
  const L = LANGS[lang];
  const english = pickVoice(voices, 'en');
  const own = lang === 'en' ? english : pickVoice(voices, L.voice);
  const hasOwn = !!own || lang === 'en';
  const ownLang = hasOwn ? own?.lang ?? `${L.voice}-IN` : english?.lang ?? 'en-IN';
  const ownVoice = hasOwn ? own : english;
  const lines: Line[] = [
    { text: hasOwn ? L.native : L.roman, lang: ownLang, voice: ownVoice, en: L.en, to: 'parent', pitch: 1.05 },
    // Amma's answer, in a lower voice so the two sides sound different.
    { text: hasOwn ? L.reply.native : L.reply.roman, lang: ownLang, voice: ownVoice, en: L.reply.en, to: 'reply', pitch: 0.8 },
    { text: TO_YOU, lang: english?.lang ?? 'en-IN', voice: english, en: '', to: 'you', pitch: 1.05 },
  ];
  return { lines, missingVoice: !hasOwn };
}

/**
 * Split a line into short caption chunks (sentences; a long sentence is cut at
 * the comma nearest its middle), keeping each chunk's offset in the line so the
 * spoken position can find the chunk being said.
 */
function chunk(text: string): Chunk[] {
  const out: Chunk[] = [];
  const re = /[^.!?।]+[.!?।]*\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const t = m[0];
    if (!t.trim()) continue;
    const commas = [...t.matchAll(/,\s*/g)].map((c) => (c.index ?? 0) + c[0].length);
    if (t.length > 46 && commas.length) {
      const mid = t.length / 2;
      const cut = commas.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
      out.push({ start: m.index, text: t.slice(0, cut) });
      out.push({ start: m.index + cut, text: t.slice(cut) });
    } else {
      out.push({ start: m.index, text: t });
    }
  }
  return out.length ? out : [{ start: 0, text }];
}

const CHARS_PER_SEC = 13;            // estimate when a browser voice doesn't report word timing
const THINK_MS = 650;                // after Amma answers, Saathi 'thinks' this long before replying

/* The site theme (<html data-theme>): the orb glows on dark pages and uses ink on light ones (no dark backing). */
const subscribeTheme = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
};
const readDarkTheme = () => document.documentElement.getAttribute('data-theme') === 'dark';

/** The browser's voices, waiting (briefly) for them to load if the list is still empty. */
function loadVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener('voiceschanged', done);
      resolve(synth.getVoices());
    };
    synth.addEventListener('voiceschanged', done);
    window.setTimeout(done, 1500);
  });
}

/* ---------- The hero ---------- */

export function VoiceHero({ primaryHref, primaryLabel, trialDays }: { primaryHref: string; primaryLabel: string; trialDays: number }) {
  const orb = useRef<SaathiOrbHandle>(null);
  const [orbMode, setOrbMode] = useState<OrbMode>('idle');
  const dark = useSyncExternalStore(subscribeTheme, readDarkTheme, () => false);

  const [lang, setLang] = useState<LangKey>('en');
  const [status, setStatus] = useState<Status>('idle');
  const [begun, setBegun] = useState(false);       // false while it "rings", before the first word
  const [lineIdx, setLineIdx] = useState(0);
  const [spokenTo, setSpokenTo] = useState(-1);    // char reached in the current line (from word events)
  const [estTo, setEstTo] = useState(0);           // char estimate when there are no word events
  const [script, setScript] = useState<Line[]>([]);
  const [missingVoice, setMissingVoice] = useState(false);
  const [noSpeech, setNoSpeech] = useState(false);
  const timers = useRef<number[]>([]);
  const runId = useRef(0);
  const lineStart = useRef(0);
  const lineToken = useRef(0);        // which line the estimated word timers belong to
  const realWords = useRef(false);    // true once the browser reports word timing for this line

  const clearTimers = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };

  const stop = useCallback(() => {
    runId.current++;
    clearTimers();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setOrbMode('idle');
    setStatus('idle');
    setBegun(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  // Voices load asynchronously in Chrome; touching getVoices() early starts that.
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.getVoices();
  }, []);

  // While a line is being said without word events, move the captions on an estimate.
  useEffect(() => {
    if (status !== 'speaking' || !begun) return;
    const id = window.setInterval(() => {
      setEstTo(Math.floor(((Date.now() - lineStart.current) / 1000) * CHARS_PER_SEC));
    }, 200);
    return () => window.clearInterval(id);
  }, [status, begun, lineIdx]);

  const play = useCallback((which: LangKey) => {
    stop();
    const id = ++runId.current;
    const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
    setNoSpeech(!synth);
    setMissingVoice(false);
    setLineIdx(0);
    setSpokenTo(-1);
    setEstTo(0);
    setStatus('speaking');

    // A short "ringing" before the first word.
    setOrbMode('ringing');
    // Until (unless) the browser reports word timing, feed the orb each word on the
    // same estimate the captions use, so the lines still swell with the words.
    const estimateWords = (l: Line) => {
      const token = ++lineToken.current;
      realWords.current = false;
      const words = [...l.text.matchAll(/\S+/g)];
      words.forEach((w, k) => {
        const at = (w.index ?? 0) / CHARS_PER_SEC;
        const next = k + 1 < words.length ? (words[k + 1].index ?? 0) / CHARS_PER_SEC : at + w[0].length / CHARS_PER_SEC;
        timers.current.push(window.setTimeout(() => {
          if (id !== runId.current || token !== lineToken.current || realWords.current) return;
          orb.current?.say(w[0], (next - at) * 0.85);
        }, at * 1000));
      });
    };
    const begin = (i: number, l: Line) => {
      if (id !== runId.current) return;
      estimateWords(l);
      lineStart.current = Date.now();
      setBegun(true);
      setOrbMode(l.to === 'reply' ? 'family' : 'saathi');
      setLineIdx(i);
      setSpokenTo(-1);
      setEstTo(0);
    };
    const finish = () => {
      if (id !== runId.current) return;
      setOrbMode('ended');
      setStatus('done');
      timers.current.push(window.setTimeout(() => { if (id === runId.current) setOrbMode('idle'); }, 2600));
    };

    // Ring for a moment while the voices load, then speak.
    const ring = new Promise<void>((r) => { timers.current.push(window.setTimeout(r, 1600)); });
    Promise.all([synth ? loadVoices(synth) : Promise.resolve([] as SpeechSynthesisVoice[]), ring]).then(([voices]) => {
      if (id !== runId.current) return;
      const { lines, missingVoice: missing } = buildScript(which, voices);
      setScript(lines);
      setMissingVoice(!!synth && missing);
      if (!synth) {
        // No speech in this browser: play the captions on a timer instead.
        let at = 0;
        lines.forEach((l, i) => {
          timers.current.push(window.setTimeout(() => begin(i, l), at));
          at += Math.max(2200, (l.text.length / CHARS_PER_SEC) * 1000);
          if (l.to === 'reply' && i < lines.length - 1) {
            timers.current.push(window.setTimeout(() => { if (id === runId.current) setOrbMode('thinking'); }, at));
            at += THINK_MS;
          }
        });
        timers.current.push(window.setTimeout(finish, at));
        return;
      }
      synth.cancel();
      // One line at a time, so Saathi can pause to think after Amma answers.
      const speakLine = (i: number) => {
        if (id !== runId.current) return;
        if (i >= lines.length) { finish(); return; }
        const l = lines[i];
        const u = new SpeechSynthesisUtterance(l.text);
        u.lang = l.lang;
        if (l.voice) u.voice = l.voice;
        u.rate = l.to === 'reply' ? 0.88 : 0.95;
        u.pitch = l.pitch;
        u.onstart = () => begin(i, l);
        u.onboundary = (e) => {
          if (id !== runId.current || e.name === 'sentence') return;
          realWords.current = true;
          const word = /^\S+/.exec(l.text.slice(e.charIndex))?.[0] ?? '';
          orb.current?.say(word);
          setSpokenTo(e.charIndex + (e.charLength || word.length));
        };
        u.onend = () => {
          if (id !== runId.current) return;
          if (l.to === 'reply' && i < lines.length - 1) {
            setOrbMode('thinking');
            timers.current.push(window.setTimeout(() => speakLine(i + 1), THINK_MS));
          } else {
            speakLine(i + 1);
          }
        };
        u.onerror = () => { if (id === runId.current) finish(); };
        synth.speak(u);
      };
      speakLine(0);
    });
  }, [stop]);

  const onCircle = () => (status === 'speaking' ? stop() : play(lang));
  const chooseLang = (k: LangKey) => { setLang(k); if (status !== 'idle') play(k); };

  // The caption: the chunk of the current line that is being said, its spoken part lit.
  const line = begun ? script[lineIdx] : undefined;
  const reached = spokenTo >= 0 ? spokenTo : estTo;
  const parts = line ? chunk(line.text) : [];
  let ci = 0;
  parts.forEach((p, i) => { if (p.start <= Math.max(0, reached - 1)) ci = i; });
  const current = parts[ci];
  const litTo = current ? Math.max(0, Math.min(current.text.length, reached - current.start)) : 0;
  const enParts = line?.en ? chunk(line.en) : [];
  const enText = enParts.length === parts.length ? enParts[ci]?.text : line?.en;
  const who = line ? (line.to === 'parent' ? 'Saathi → Amma' : line.to === 'reply' ? 'Amma' : 'Saathi → you') : '';

  const note = noSpeech && status !== 'idle'
    ? 'Your browser can’t play speech, so this preview shows the words only.'
    : missingVoice && status !== 'idle'
      ? `Your browser has no ${LANGS[lang].label} voice, so this preview reads it in English. Real calls use Saathi’s own voice.`
      : status !== 'idle'
        ? 'Preview uses your browser’s voice. Real calls use Saathi’s own voice.'
        : 'Turn your sound on. Saathi asks, Amma answers, then Saathi says hello to you.';

  return (
    <section className={s.hero} aria-label="Meet Saathi">
      <div className={s.panel}>
        {/* Left: the pitch */}
        <div className={s.left}>
          <div className={s.copy}>
            <span className={`${s.tagline} anim-load d1`}><span className={s.mark} aria-hidden="true" />Saathi · a voice companion for parents</span>
            <WordReveal as="h1" className={s.h1} delay={0.15} onLoad>A daily call for<br />your parents.<br /><em>Peace of mind</em><br />for you.</WordReveal>
            <p className={`${s.proof} anim-load d3`}>{trialDays}-day free trial · 9 Indian languages · no app for your parents</p>
          </div>

          <div className={`${s.ctas} anim-load d4`}>
            <MagneticLink href={primaryHref} className={`${s.btnSolid} btn-glow`}>{primaryLabel} <ArrowRight size={18} /></MagneticLink>
            <Link href="#how" className={s.btnGhost}>See how it works</Link>
          </div>
        </div>

        {/* Right: the demo. The orb, with the live captions inside its ring */}
        <div className={s.right}>
          <div className={s.stage}>
            {/* The ring is the call, the waves are the voice: dead centre, captions above, pill below */}
            <div className={s.orb} aria-hidden="true">
              <SaathiBlob ref={orb} mode={orbMode} variant={dark ? 'night' : 'day'} scale={0.52} />
            </div>

            {/* Live captions, inside the ring above the waves */}
            <div className={s.inside} aria-live="polite">
              {status === 'idle' && (
                <div className={s.insideIdle}>
                  <span className={s.insideLabel}>Live preview</span>
                  <p className={s.insideTitle}>Hear how Saathi greets Amma</p>
                </div>
              )}
              {status === 'speaking' && !line && (
                <div className={s.insideIdle}>
                  <span className={s.insideLabel}>Calling Amma…</span>
                </div>
              )}
              {status === 'speaking' && line && current && (
                <div key={`${lang}-${lineIdx}-${ci}`} className={s.insideLine}>
                  <span className={`${s.who} ${line.to === 'reply' ? s.whoWarm : ''}`}>{who}</span>
                  <p className={s.insideText}><mark>{current.text.slice(0, litTo)}</mark>{current.text.slice(litTo)}</p>
                  {enText && <small className={s.insideEn}>{enText}</small>}
                </div>
              )}
              {status === 'done' && (
                <div className={s.insideIdle}>
                  <span className={s.insideLabel}>Call ended</span>
                  <p className={s.insideTitle}>That’s how Saathi checks in, every day</p>
                </div>
              )}
            </div>

            {/* Tap the orb to hear Saathi */}
            <button
              type="button"
              className={s.circle}
              onClick={onCircle}
              aria-pressed={status === 'speaking'}
              aria-label={status === 'speaking' ? 'Stop Saathi' : 'Hear how Saathi greets Amma (plays sound)'}
            >
              <span className={s.circleHint}>
                {status === 'speaking'
                  ? <><span className={s.circleIcon}><Square size={11} fill="currentColor" /></span>Stop</>
                  : status === 'done'
                    ? <><span className={s.circleIcon}><RotateCcw size={14} /></span>Hear it again</>
                    : <><span className={s.circleIcon}><Play size={13} fill="currentColor" /></span>Tap to hear Saathi</>}
              </span>
            </button>
          </div>

          {/* Under the ring: the greeting language, and one line about the preview voice */}
          <div className={`${s.controls} anim-load d5`}>
            <div className={s.langs} role="group" aria-label="Greeting language">
              {(Object.keys(LANGS) as LangKey[]).map((k) => (
                <button key={k} type="button" aria-pressed={lang === k} onClick={() => chooseLang(k)}>{LANGS[k].label}</button>
              ))}
            </div>
            <p className={s.note}>{note}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
