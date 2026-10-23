'use client';

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, BellRing, CirclePlay, Clock, Headphones, Languages, MessageCircle, Mic, Pause, PhoneCall, Play, RotateCcw, ShieldCheck, Sparkles, Square } from 'lucide-react';
import { Ticker } from '@/components/motion/Ticker';
import { type OrbMode, type SaathiOrbHandle } from '@/components/voice/SaathiOrb';
import { SaathiBlob } from '@/components/voice/SaathiBlob';
import { SaathiGlass } from '@/components/voice/SaathiGlass';
import { MagneticLink } from '@/components/motion/MagneticLink';
import { HeroWaves } from './HeroWaves';
import { HeroFilmModal } from './HeroFilmModal';
import { CALL_LANG_EVENT, isCallLang } from './callScript';
import s from './voiceHero.module.css';
import { PLANS } from '@/lib/plans';

/**
 * Landing hero, three columns on a soft aurora:
 *  - left: the pitch and the trial button.
 *  - centre: Saathi's voice orb (the living glass blob, SaathiBlob, or the Siri-style SaathiGlass: a switch above picks one) and,
 *    only while the sample plays, a dark capsule under it: the mic in the middle stops it, and the capsule's waves move with
 *    the voice, Saathi's on the left, Amma's on the right.
 *  - right: the call as it happens: the words being said (spoken part lit), the
 *    translation, "Hear a sample call" and "Watch video" (the call film, in a player that grows out
 *    of the button).
 * The greeting's language is picked under the buttons (CALL_LANG_EVENT, which the film follows too).
 * It opens like a film (CSS: the light comes up, the orb forms, the capsule opens from the mic).
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
    native: 'Good morning, Amma. It’s Saathi. Have you had your breakfast? And your BP tablet?',
    roman: 'Good morning, Amma. It’s Saathi. Have you had your breakfast? And your BP tablet?',
    en: '',
    reply: { native: 'Yes, I took it after breakfast.', roman: 'Yes, I took it after breakfast.', en: '' },
  },
  te: {
    label: 'తెలుగు',
    voice: 'te',
    native: 'నమస్కారం అమ్మగారు! నేను సాథీ. టిఫిన్ అయ్యిందా? బీపీ టాబ్లెట్ వేసుకున్నారా?',
    roman: 'Namaskaram Ammagaru! Nenu Saathi. Tiffin ayyinda? BP tablet vesukunnara?',
    en: 'Good morning, Amma. It’s Saathi. Have you had breakfast? Did you take your BP tablet?',
    reply: { native: 'ఆ, వేసుకున్నాను.', roman: 'Aa, vesukunnanu.', en: 'Yes, I took it.' },
  },
  hi: {
    label: 'हिंदी',
    voice: 'hi',
    native: 'नमस्ते अम्मा जी! मैं साथी हूँ। नाश्ता हो गया? बीपी की गोली ली?',
    roman: 'Namaste Amma ji! Main Saathi hoon. Nashta ho gaya? BP ki goli li?',
    en: 'Good morning, Amma ji. It’s Saathi. Have you had breakfast? Did you take your BP tablet?',
    reply: { native: 'हाँ, ले ली।', roman: 'Haan, le li.', en: 'Yes, I took it.' },
  },
};

const TO_YOU = 'Hi, I’m Saathi. I’ll check on your parents like this at every medicine time, and send you the answer on WhatsApp.';

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

/**
 * A heading whose words rise out of a mask one after another. Both hero headings use it, as CSS from the first
 * paint, so they start together (the left one used to wait for hydration, and the right one did not).
 * `step` is the gap between words: 0.06 s for the 11-word left heading, 0.15 s for the 5-word right one, so both
 * finish together. ('br' = a line break; motion's AnimatePresence initial={false} would skip a motion entrance.)
 */
function RiseWords({ items, step }: { items: (React.ReactNode | 'br')[]; step: number }) {
  let n = 0;
  return (
    <>
      {items.map((w, i) => w === 'br'
        ? <br key={i} />
        : (
          <React.Fragment key={i}>
            {n > 0 && items[i - 1] !== 'br' && ' '}
            <span className={s.idleWord}>
              <span style={{ ['--w' as string]: n++, ['--step' as string]: `${step}s` }}>{w}</span>
            </span>
          </React.Fragment>
        ))}
    </>
  );
}

const ACCENT = ['Now', 'you’ll', 'know.'];
const LEFT_WORDS: (React.ReactNode | 'br')[] = [
  'Did', 'Amma', 'take', 'br', 'her', 'BP', 'tablet?', 'br',
  ...ACCENT.map((w, i) => <em key={w} style={{ ['--i' as string]: i }}>{w}</em>),
];
const RIGHT_WORDS: React.ReactNode[] = ['Hear', 'how', 'Saathi', 'greets', <em key="amma">Amma</em>];


const SUB_RIGHT = 'Short, friendly calls at medicine time, in their language, and an update on your WhatsApp after every call.';

/* Opening-shot delay for the pieces that rise in (CSS reads --d). */
const rise = (d: number) => ({ ['--d' as string]: d });

/* ---------- The hero ---------- */

/* The site theme (<html data-theme>): the blob glows on dark pages and uses ink on light ones. */
const subscribeTheme = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
};
const readDarkTheme = () => document.documentElement.getAttribute('data-theme') === 'dark';
// Both orbs are shown to people for now (user, 2026-10-23): the switch above the orb picks one, /?orb=glass starts on glass.
const readGlass = () => new URLSearchParams(window.location.search).get('orb') === 'glass';
const noSubscribe = () => () => {};

export function VoiceHero({ primaryHref, primaryLabel, trialDays }: { primaryHref: string; primaryLabel: string; trialDays: number }) {
  const orb = useRef<SaathiOrbHandle>(null);
  const [orbMode, setOrbMode] = useState<OrbMode>('idle');
  const dark = useSyncExternalStore(subscribeTheme, readDarkTheme, () => false);
  const urlGlass = useSyncExternalStore(noSubscribe, readGlass, () => false);
  const [orbPick, setOrbPick] = useState<'blob' | 'glass' | null>(null);
  const glass = orbPick ? orbPick === 'glass' : urlGlass;

  const [lang, setLang] = useState<LangKey>('en');
  const [status, setStatus] = useState<Status>('idle');
  const [begun, setBegun] = useState(false);       // false while it "rings", before the first word
  const [lineIdx, setLineIdx] = useState(0);
  const [spokenTo, setSpokenTo] = useState(-1);    // char reached in the current line (from word events)
  const [estTo, setEstTo] = useState(0);           // char estimate when there are no word events
  const [script, setScript] = useState<Line[]>([]);
  const [missingVoice, setMissingVoice] = useState(false);
  const [noSpeech, setNoSpeech] = useState(false);
  const [filmOpen, setFilmOpen] = useState(false);
  const timers = useRef<number[]>([]);
  const runId = useRef(0);
  const statusRef = useRef<Status>('idle');
  const lineStart = useRef(0);
  const lineToken = useRef(0);        // which line the estimated word timers belong to
  const realWords = useRef(false);    // true once the browser reports word timing for this line
  const filmBtn = useRef<HTMLButtonElement>(null);

  const clearTimers = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };

  useEffect(() => { statusRef.current = status; }, [status]);

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
        const u = new SpeechSynthesisUtterance(l.text.replace(/Saathi/g, 'Saathee'));   // English voices say 'Sati' otherwise
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

  // The language switch under the buttons (and the Languages section's "Hear it") pick the greeting language.
  useEffect(() => {
    const onLang = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (!isCallLang(v)) return;
      setLang(v);
      if (statusRef.current === 'speaking') play(v);
    };
    window.addEventListener(CALL_LANG_EVENT, onLang);
    return () => window.removeEventListener(CALL_LANG_EVENT, onLang);
  }, [play]);

  const onPlay = () => (status === 'speaking' ? stop() : play(lang));
  const openFilm = () => { stop(); setFilmOpen(true); };
  const closeFilm = useCallback(() => {
    setFilmOpen(false);
    filmBtn.current?.focus();
  }, []);
  const voice = useCallback(() => orb.current?.loudness?.() ?? 0, []);

  // The caption: the chunk of the current line that is being said, its spoken part lit.
  const line = begun ? script[lineIdx] : undefined;
  const reached = spokenTo >= 0 ? spokenTo : estTo;
  const parts = line ? chunk(line.text) : [];
  let ci = 0;
  parts.forEach((p, i) => { if (p.start <= Math.max(0, reached - 1)) ci = i; });
  const current = parts[ci];
  const litTo = current ? Math.max(0, Math.min(current.text.length, reached - current.start)) : 0;

  const speaking = status === 'speaking';

  const captionKey = status === 'idle' ? 'idle' : status === 'done' ? 'done' : line && current ? `${lang}-${lineIdx}-${ci}` : 'ring';
  const caption = status === 'idle'
    ? <RiseWords items={RIGHT_WORDS} step={0.15} />
    : status === 'done'
      ? <>“That’s how Saathi checks in, <em>every day”</em></>
      : line && current
        ? <><mark>{current.text.slice(0, litTo)}</mark>{current.text.slice(litTo)}</>
        : <>Ringing Amma’s <em>phone…</em></>;

  const note = noSpeech && status !== 'idle'
    ? 'Your browser can’t play speech, so this preview shows the words only.'
    : missingVoice && status !== 'idle'
      ? `Your browser has no ${LANGS[lang].label} voice, so this preview reads it in English. Real calls use Saathi’s own voice.`
      : status !== 'idle'
        ? 'Preview uses your browser’s voice. Real calls use Saathi’s own voice.'
        : 'Turn your sound on.';

  return (
    <section className={s.hero} data-scene="hero" aria-label="Meet Saathi">
      {/* The backdrop: a slow aurora */}
      <div className={s.aurora} aria-hidden="true" />

      <div className={s.panel}>
        {/* Left: the pitch */}
        <div className={s.left} data-hero-copy>
          <h1 className={s.h1}><RiseWords items={LEFT_WORDS} step={0.06} /></h1>
          <p className={`${s.sub} ${s.rise}`} style={rise(6)}>
            Saathi calls your parents at every tablet time, in their own language, and sends you the answer on WhatsApp. No nagging from you.
          </p>
          <div className={`${s.ctas} ${s.rise}`} style={rise(7)}>
            <MagneticLink href={primaryHref} className={`${s.btnGlow} btn-glow`}>{primaryLabel} <ArrowRight size={18} /></MagneticLink>
            <Link href="#how" className={s.btnOutline}><CirclePlay size={20} strokeWidth={1.8} /> See how it works</Link>
          </div>
          <ul className={`${s.proof} ${s.rise}`} style={rise(8)}>
            <li>{trialDays}-day free trial</li>
            <li>No app for your parents</li>
            <li>9 Indian languages</li>
          </ul>
        </div>

        {/* Centre: the orb, and the capsule across it with the mic and the voice */}
        <div className={s.stage} data-hero-orb>
          <div className={`${s.langs} ${s.orbSwitch}`} role="group" aria-label="Orb style">
            {(['blob', 'glass'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={glass === (k === 'glass')} onClick={() => setOrbPick(k)}>
                {k === 'blob' ? 'Blob' : 'Glass'}
              </button>
            ))}
          </div>
          <div className={s.orb} data-kind={glass ? 'glass' : 'blob'} aria-hidden="true">
            {glass ? <SaathiGlass ref={orb} mode={orbMode} /> : <SaathiBlob ref={orb} mode={orbMode} variant={dark ? 'night' : 'day'} scale={0.52} />}
          </div>
          <div className={s.capsule} data-live={speaking || undefined}>
            <HeroWaves className={s.waves} mode={orbMode} dark voice={voice} inner={1.4} silk={false} />
            <button
              type="button"
              className={s.mic}
              onClick={onPlay}
              aria-pressed={speaking}
              aria-label={speaking ? 'Stop Saathi' : 'Hear how Saathi greets Amma (plays sound)'}
            >
              {speaking ? <Square size={14} fill="currentColor" /> : <Mic size={19} strokeWidth={2} />}
            </button>
          </div>
        </div>

        {/* Right: the call as it happens */}
        <div className={s.right} data-hero-side>
          {/* With the pitch on the left: the heading and its line at the top, then the buttons and the language + note level with the left's */}
          <div className={s.rtop}>
          <div className={s.caption} aria-live="polite">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={captionKey}
                className={`${s.quote} ${line && current && speaking ? s.quoteLive : ''}`}
                data-who={line?.to}
                initial={{ opacity: 0, y: 22, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -18, filter: 'blur(8px)' }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              >
                {caption}
              </motion.p>
            </AnimatePresence>
          </div>
          <p className={`${s.rsub} ${s.rise}`} style={rise(6)}>{SUB_RIGHT}</p>
            {/* What Saathi says, in the chosen language (the live captions take over while it plays) */}
            {/* While a line is being said the card shows that whole line (its English meaning when it isn't English), so the column stays full */}
            {(() => {
              const live = speaking && line;
              const who = !line ? '' : line.to === 'reply' ? 'Amma' : 'Saathi';
              return (
                <blockquote className={`${s.greet} ${s.rise}`} style={rise(7)} data-live={live || undefined}>
                  {live ? <p lang={line.en ? 'en' : lang}>“{line.en || line.text}”</p>
                    : <><p lang={lang}>“{LANGS[lang].native}”</p>{LANGS[lang].en && <small>{LANGS[lang].en}</small>}</>}
                  <footer><i aria-hidden="true" />{live ? `${who} · ${line.to === 'reply' ? 'replying' : 'speaking'}` : 'Saathi · 8:30 AM morning call'}</footer>
                </blockquote>
              );
            })()}
          </div>
          <div className={`${s.rctas} ${s.rise}`} style={rise(7)}>
            <button type="button" className={s.btnInk} onClick={onPlay} aria-pressed={speaking}>
              {speaking ? <><Square size={14} fill="currentColor" /> Stop</>
                : status === 'done' ? <><RotateCcw size={17} /> Hear it again</>
                  : <><Headphones size={18} /> Hear a sample call</>}
            </button>
            <button ref={filmBtn} type="button" className={s.btnLight} onClick={openFilm}>
              {!filmOpen && <motion.span layoutId="hero-film" className={s.btnLightBg} style={{ borderRadius: 999 }} />}
              <Play size={14} fill="currentColor" /> Watch video
            </button>
          </div>
          <div className={s.rfoot}>
            {/* The greeting's language; the How it works film follows it too (CALL_LANG_EVENT). */}
            <div className={`${s.langs} ${s.rise}`} style={rise(8)} role="group" aria-label="Greeting language">
              {(['en', 'te', 'hi'] as LangKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={lang === k}
                  onClick={() => window.dispatchEvent(new CustomEvent(CALL_LANG_EVENT, { detail: k }))}
                >
                  {LANGS[k].label}
                </button>
              ))}
            </div>
            <p className={`${s.note} ${s.rise}`} style={rise(8)}>{note}</p>
          </div>
        </div>

      </div>

      {/* Along the bottom: what Saathi does, running past on a transparent strip (pauses on hover) */}
      <Ticker
        className={`${s.ticker} ${s.rise}`}
        label="What Saathi does"
        items={[
          { icon: <Clock size={17} />, text: 'Calls at their medicine times' },
          { icon: <PhoneCall size={17} />, text: 'Works on any phone, even a landline' },
          { icon: <Languages size={17} />, text: '9 Indian languages' },
          { icon: <MessageCircle size={17} />, text: 'A WhatsApp update after every call' },
          { icon: <RotateCcw size={17} />, text: 'Tries again if they miss the call' },
          { icon: <BellRing size={17} />, text: 'Urgent alerts to family and neighbours' },
          { icon: <ShieldCheck size={17} />, text: 'Never gives medical advice' },
          { icon: <Pause size={17} />, text: 'Pause any time for a trip' },
          { icon: <BellRing size={17} />, text: `Just reminders? ${PLANS.essential.name} on WhatsApp, ₹${PLANS.essential.priceMonthly} a month` },
          { icon: <Sparkles size={17} />, text: `${trialDays}-day free trial` },
        ]}
      />

      <HeroFilmModal open={filmOpen} onClose={closeFilm} lang={lang} layoutId="hero-film" />
    </section>
  );
}
