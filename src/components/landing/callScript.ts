/**
 * The example call played on the phone in "How it works". Hand-written in each
 * language (no translation API, no Sarvam keys); add a language by adding a key
 * to CALL_LANGS and a text for it on every line.
 *
 * Timings are shared by every language, so switching language mid-call keeps
 * the call where it is and only swaps the words.
 */

export type CallLang = 'en' | 'te' | 'hi';
export type Speaker = 'saathi' | 'parent';

export const CALL_LANGS: { key: CallLang; label: string; name: string }[] = [
  { key: 'en', label: 'English', name: 'English' },
  { key: 'te', label: 'తెలుగు', name: 'Telugu' },
  { key: 'hi', label: 'हिंदी', name: 'Hindi' },
];

/**
 * Other sections can switch the example call's language by dispatching this
 * window event with the language key as `detail` (LiveCallPhone listens).
 */
export const CALL_LANG_EVENT = 'aaptha:call-lang';

export function isCallLang(v: unknown): v is CallLang {
  return CALL_LANGS.some((l) => l.key === v);
}

export type ScriptLine = { who: Speaker; ms: number; text: Record<CallLang, string> };

export const CALL_SCRIPT: ScriptLine[] = [
  {
    who: 'saathi',
    ms: 3800,
    text: {
      en: 'Good morning, Amma! This is Saathi. Did you take your BP tablet after breakfast?',
      te: 'నమస్కారం అమ్మా! నేను Saathi ని. టిఫిన్ అయ్యాక బీపీ టాబ్లెట్ వేసుకున్నారా?',
      hi: 'नमस्ते अम्मा! मैं साथी हूँ। नाश्ते के बाद बीपी की गोली ली?',
    },
  },
  {
    who: 'parent',
    ms: 1900,
    text: {
      en: 'Yes, I took it just now.',
      te: 'ఆ, ఇప్పుడే వేసుకున్నాను.',
      hi: 'हाँ बेटा, अभी ले ली।',
    },
  },
  {
    who: 'saathi',
    ms: 2300,
    text: {
      en: 'Very good. How are you feeling today?',
      te: 'చాలా మంచిది. ఈ రోజు ఒంట్లో ఎలా ఉన్నారు?',
      hi: 'बहुत अच्छा। आज तबीयत कैसी है?',
    },
  },
  {
    who: 'parent',
    ms: 3300,
    text: {
      en: 'I’m fine. My knee has been hurting a little since yesterday.',
      te: 'బాగానే ఉన్నాను. నిన్నటి నుంచి మోకాలు కొంచెం నొప్పిగా ఉంది.',
      hi: 'ठीक हूँ। बस कल से घुटने में थोड़ा दर्द है।',
    },
  },
  {
    who: 'saathi',
    ms: 3700,
    text: {
      en: 'I’ll let your family know. If it gets worse, please tell your doctor.',
      te: 'ఈ విషయం మీ కుటుంబానికి చెప్తాను. నొప్పి ఎక్కువైతే డాక్టర్‌కి చెప్పండి.',
      hi: 'हम घरवालों को बता देंगे। दर्द बढ़े तो डॉक्टर को ज़रूर बताइए।',
    },
  },
  {
    who: 'parent',
    ms: 1500,
    text: {
      en: 'Okay. Thank you.',
      te: 'సరే. థాంక్యూ.',
      hi: 'ठीक है, शुक्रिया।',
    },
  },
  {
    who: 'saathi',
    ms: 2800,
    text: {
      en: 'Take care, Amma. I’ll call again in the evening.',
      te: 'జాగ్రత్తగా ఉండండి అమ్మా. సాయంత్రం మళ్ళీ కాల్ చేస్తాను.',
      hi: 'अपना ध्यान रखिए अम्मा। शाम को फिर फ़ोन करेंगे।',
    },
  },
];

/** Silence after the call is picked up, and between turns. */
export const LEAD_MS = 700;
export const GAP_MS = 650;
const TAIL_MS = 900;

export type Segment = { index: number; who: Speaker; start: number; end: number };

/** When each line is spoken, in ms from the moment the call is answered. */
export const TIMELINE: Segment[] = (() => {
  let t = LEAD_MS;
  return CALL_SCRIPT.map((l, index) => {
    const seg = { index, who: l.who, start: t, end: t + l.ms };
    t = seg.end + GAP_MS;
    return seg;
  });
})();

export const CALL_MS = TIMELINE[TIMELINE.length - 1].end + TAIL_MS;

/** "0:07" style call timer. */
export function formatCallTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
