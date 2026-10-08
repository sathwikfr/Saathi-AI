/**
 * Code-level safety net. After every call the transcript is scanned for
 * emergency phrases in all supported languages, independently of whatever the
 * voice agent concluded. When in doubt this errs toward raising the alert.
 *
 * Only the PARENT's turns are scanned: the agent may itself say things like
 * "if you have chest pain, call your family" that must not trigger an alarm.
 */

export interface TranscriptTurn {
  role: string;
  text: string;
  /** What was actually said, in the person's own script (Sarvam's `indic_text`), when it differs from the English. */
  native?: string;
}

/** The English translation and the native-script words are both scanned: a mistranslation must not hide an emergency. */
function expandTurns(turns: TranscriptTurn[]): TranscriptTurn[] {
  const out: TranscriptTurn[] = [];
  for (const t of turns) {
    out.push({ role: t.role, text: t.text });
    if (t.native && t.native !== t.text) out.push({ role: t.role, text: t.native });
  }
  return out;
}

/** English phrases that can be negated ("no chest pain") — skipped when negated in the same clause. */
const ENGLISH_NEGATABLE = [
  'chest tightness',
  'tightness in my chest',
  'chest is paining',
  'chest paining',
  'heart pain',
  'breathless',
  'breathing problem',
  'chest pain',
  'chest pains',
  'pain in my chest',
  'pain in the chest',
  'severe pain',
  'bleeding',
  'coughing blood',
  'coughing up blood',
  'vomiting blood',
  'vomited blood',
  'blood in',
  'emergency',
  // Pregnancy warning signs (WhatsApp reminders are used by pregnant women too)
  'severe headache',
  'blurred vision',
  'blurry vision',
  'heavy bleeding',
  'leaking fluid'
];

/** Phrases that already carry their own meaning (never suppressed). */
const ENGLISH_DIRECT = [
  "can't breathe",
  'cant breathe',
  'cannot breathe',
  'can not breathe',
  'unable to breathe',
  'trouble breathing',
  'difficulty breathing',
  'difficulty in breathing',
  'short of breath',
  'shortness of breath',
  'struggling to breathe',
  'i fell',
  'i have fallen',
  "i've fallen",
  'fell down',
  'fallen down',
  'passed out',
  'fainted',
  'unconscious',
  'heart attack',
  'having a stroke',
  'call an ambulance',
  'call the ambulance',
  'need an ambulance',
  "i'm dying",
  'i am dying',
  'want to die',
  'end my life',
  'kill myself',
  // Pregnancy
  'baby is not moving',
  'baby not moving',
  'baby stopped moving',
  'baby has stopped moving',
  "baby isn't moving",
  "can't feel the baby",
  'cannot feel the baby',
  'water broke',
  'waters broke',
  'water has broken',
  'having fits',
  'seizure',
  'convulsion'
];

/** Native-script and romanised phrases by language (matched as substrings, never suppressed). */
export const EMERGENCY_TERMS: Record<string, string[]> = {
  hindi: [
    'सीने में दर्द', 'छाती में दर्द', 'सांस नहीं', 'साँस नहीं', 'सांस लेने में तकलीफ', 'साँस लेने में तकलीफ',
    'गिर गया', 'गिर गई', 'गिर गयी', 'बेहोश', 'दिल का दौरा', 'हार्ट अटैक', 'एम्बुलेंस', 'एंबुलेंस', 'बचाओ',
    'seene mein dard', 'chhati mein dard', 'saans nahi', 'saans lene mein', 'gir gaya', 'gir gayi', 'behosh',
    'bachao', 'ambulance bulao',
    // pregnancy
    'बच्चा हिल नहीं रहा', 'बच्चा नहीं हिल रहा', 'पानी की थैली फट', 'बहुत खून', 'baccha hil nahi raha', 'bachcha hil nahi raha', 'bahut khoon'
  ],
  telugu: [
    'ఛాతీ నొప్పి', 'ఛాతి నొప్పి', 'గుండె నొప్పి', 'ఊపిరి ఆడటం లేదు', 'ఊపిరి ఆడడం లేదు', 'శ్వాస తీసుకోలేకపోతున్నా',
    'కింద పడ్డాను', 'పడిపోయాను', 'స్పృహ తప్పి', 'గుండెపోటు', 'అంబులెన్స్', 'కాపాడండి',
    'chaati noppi', 'gunde noppi', 'oopiri aadatam ledu', 'padipoyanu', 'kindha paddanu'
  ],
  tamil: [
    'நெஞ்சு வலி', 'நெஞ்சு வலிக்கிறது', 'மூச்சு விட முடியவில்லை', 'மூச்சு திணறல்', 'கீழே விழுந்தேன்',
    'மயங்கி', 'மாரடைப்பு', 'ஆம்புலன்ஸ்', 'காப்பாற்றுங்கள்',
    'nenju vali', 'moochu vida mudiyala', 'keezhe vizhundhen', 'mayanghi'
  ],
  kannada: [
    'ಎದೆ ನೋವು', 'ಉಸಿರಾಡಲು ಆಗುತ್ತಿಲ್ಲ', 'ಉಸಿರು ಕಟ್ಟುತ್ತಿದೆ', 'ಬಿದ್ದುಬಿಟ್ಟೆ', 'ಬಿದ್ದೆ', 'ಪ್ರಜ್ಞೆ ತಪ್ಪಿ',
    'ಹೃದಯಾಘಾತ', 'ಆಂಬ್ಯುಲೆನ್ಸ್', 'ಕಾಪಾಡಿ',
    'ede novu', 'usiraadalu aagtilla', 'biddu bitte'
  ],
  bengali: [
    'বুকে ব্যথা', 'বুকের ব্যথা', 'শ্বাস নিতে পারছি না', 'শ্বাসকষ্ট', 'পড়ে গেছি', 'অজ্ঞান', 'হার্ট অ্যাটাক',
    'অ্যাম্বুলেন্স', 'বাঁচাও',
    'buke byatha', 'shash nite parchi na', 'pore gechi', 'bachao'
  ],
  marathi: [
    'छातीत दुखतंय', 'छातीत दुखत आहे', 'छातीत दुखणे', 'श्वास घेता येत नाही', 'श्वास घेण्यास त्रास', 'पडलो', 'पडले',
    'बेशुद्ध', 'हृदयविकाराचा झटका', 'रुग्णवाहिका', 'वाचवा',
    'chhatit dukhtay', 'shwas gheta yet nahi', 'padlo'
  ],
  gujarati: [
    'છાતીમાં દુખાવો', 'શ્વાસ લઈ શકતો નથી', 'શ્વાસ લઈ શકતી નથી', 'શ્વાસ લેવામાં તકલીફ', 'પડી ગયો', 'પડી ગઈ',
    'બેભાન', 'હાર્ટ એટેક', 'એમ્બ્યુલન્સ', 'બચાવો',
    'chhati ma dukhavo', 'padi gayo', 'padi gai'
  ],
  malayalam: [
    'നെഞ്ചുവേദന', 'നെഞ്ച് വേദന', 'ശ്വാസം കിട്ടുന്നില്ല', 'ശ്വാസം മുട്ടൽ', 'വീണു', 'ബോധം പോയി', 'ഹൃദയാഘാതം',
    'ആംബുലൻസ്', 'രക്ഷിക്കൂ',
    'nenju vedana', 'shwasam kittunnilla', 'veenu'
  ]
};

function normalise(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** True if the text before `index` (same clause, last 3 words) contains a negation. */
function isNegated(text: string, index: number): boolean {
  const clauseStart = Math.max(
    text.lastIndexOf('.', index - 1),
    text.lastIndexOf('!', index - 1),
    text.lastIndexOf('?', index - 1),
    text.lastIndexOf(',', index - 1),
    text.lastIndexOf(';', index - 1),
    // "no problem but chest pain": what comes after "but" is a new statement, not covered by the "no"
    (() => { const b = text.lastIndexOf(' but ', index - 1); return b === -1 ? -1 : b + 4; })()
  );
  const words = text.slice(clauseStart + 1, index).trim().split(' ').filter(Boolean).slice(-3);
  return words.some(w => /^(no|not|without|never|nothing|none|neither|nor)$/.test(w) || /n't$/.test(w));
}

export interface EmergencyScanResult {
  hit: boolean;
  matches: string[];
}

export function scanForEmergency(allTurns: TranscriptTurn[]): EmergencyScanResult {
  const matches = new Set<string>();

  for (const turn of expandTurns(allTurns)) {
    if (turn.role !== 'user') continue;
    const text = normalise(turn.text || '');
    if (!text) continue;

    for (const phrase of ENGLISH_DIRECT) {
      if (text.includes(phrase)) matches.add(phrase);
    }

    for (const phrase of ENGLISH_NEGATABLE) {
      let from = 0;
      let idx = text.indexOf(phrase, from);
      while (idx !== -1) {
        if (!isNegated(text, idx)) {
          matches.add(phrase);
          break;
        }
        from = idx + phrase.length;
        idx = text.indexOf(phrase, from);
      }
    }

    for (const phrases of Object.values(EMERGENCY_TERMS)) {
      for (const phrase of phrases) {
        if (text.includes(normalise(phrase))) matches.add(phrase);
      }
    }
  }

  return { hit: matches.size > 0, matches: [...matches] };
}

/** One message someone typed to us (e.g. a WhatsApp reply to a medicine reminder). */
export function scanMessage(text: string): EmergencyScanResult {
  return scanForEmergency([{ role: 'user', text }]);
}

// ---------------------------------------------------------------------------
// Everyday symptoms (not emergencies): fever, headache, dizziness, vomiting, …
// The family / caretaker is told straight away (decided with the user 2026-10-05),
// on every plan. Never a diagnosis: we only pass on what the person said.
// ---------------------------------------------------------------------------

/** English: matched as whole words, skipped when negated in the same clause ("no fever"). */
const SYMPTOMS_ENGLISH = [
  'fever', 'temperature', 'high temperature', 'chills', 'shivering',
  'headache', 'head ache', 'head is paining', 'head pain', 'migraine',
  'dizzy', 'dizziness', 'giddy', 'giddiness', 'vertigo', 'light headed', 'lightheaded',
  'nausea', 'nauseous', 'vomit', 'vomiting', 'vomited', 'threw up', 'throwing up',
  'loose motion', 'loose motions', 'diarrhea', 'diarrhoea', 'stomach ache', 'stomach pain', 'stomachache',
  'cough', 'coughing', 'sore throat', 'caught a cold', 'have a cold', 'cold and cough', 'runny nose',
  'body pain', 'body ache', 'body aches', 'back pain', 'joint pain', 'knee pain', 'leg pain',
  'feeling weak', 'weakness', 'very tired', 'feeling tired', 'fatigue', 'exhausted',
  'not feeling well', 'not well', 'unwell', 'feeling sick', "i'm sick", 'i am sick', 'feeling low', 'feeling bad',
  'swelling', 'swollen', 'rash', 'itching', 'burning urine', 'burning sensation',
  'bp is high', 'bp high', 'high bp', 'bp is low', 'low bp', 'sugar is high', 'high sugar', 'sugar is low', 'low sugar',
  'cramps', 'palpitations', "can't sleep", 'cannot sleep', "couldn't sleep", 'no sleep'
];

/** Other languages (native script and common romanised spellings). Native script: substring; romanised: whole words. */
const SYMPTOMS_OTHER: string[] = [
  // Hindi
  'बुखार', 'सिर दर्द', 'सिरदर्द', 'चक्कर', 'उल्टी', 'खांसी', 'खाँसी', 'जुकाम', 'कमज़ोरी', 'कमजोरी', 'थकान', 'पेट दर्द', 'दस्त', 'तबीयत ठीक नहीं', 'बदन दर्द',
  'bukhar', 'bukhaar', 'sir dard', 'sardard', 'chakkar', 'ulti', 'khansi', 'zukam', 'jukam', 'kamzori', 'thakan', 'pet dard', 'dast', 'tabiyat theek nahi', 'tabiyat thik nahi', 'badan dard',
  // Telugu
  'జ్వరం', 'తలనొప్పి', 'తల నొప్పి', 'కళ్ళు తిరుగుతున్నాయి', 'వాంతి', 'వాంతులు', 'దగ్గు', 'జలుబు', 'నీరసం', 'కడుపు నొప్పి', 'ఒళ్ళు నొప్పులు', 'బాగాలేదు', 'ఒంట్లో బాగాలేదు',
  'jwaram', 'jvaram', 'tala noppi', 'thala noppi', 'talanoppi', 'kallu tirugutunnayi', 'vanthi', 'vanti', 'daggu', 'jalubu', 'neerasam', 'kadupu noppi', 'ollu noppulu', 'baagaledu', 'bagaledu', 'ontlo bagaledu',
  // Tamil
  'காய்ச்சல்', 'தலைவலி', 'தலை வலி', 'மயக்கம்', 'வாந்தி', 'இருமல்', 'சளி', 'உடம்பு சரியில்லை',
  'kaaichal', 'kaichal', 'thalai vali', 'thalaivali', 'vaanthi', 'irumal', 'udambu sariyilla',
  // Kannada
  'ಜ್ವರ', 'ತಲೆ ನೋವು', 'ತಲೆನೋವು', 'ತಲೆ ಸುತ್ತು', 'ವಾಂತಿ', 'ಕೆಮ್ಮು', 'ನೆಗಡಿ', 'ಹುಷಾರಿಲ್ಲ',
  'jvara', 'jwara', 'tale novu', 'talenovu', 'kemmu', 'negadi', 'husharilla',
  // Bengali
  'জ্বর', 'মাথা ব্যথা', 'মাথাব্যথা', 'মাথা ঘোরা', 'বমি', 'কাশি', 'সর্দি', 'শরীর খারাপ',
  'matha byatha', 'matha ghora', 'bomi', 'kashi', 'shorir kharap',
  // Marathi
  'ताप', 'डोकेदुखी', 'डोकं दुखतंय', 'उलटी', 'सर्दी', 'बरं नाही',
  'dokedukhi', 'doka dukhtay', 'bara nahi',
  // Gujarati
  'તાવ', 'માથું દુખે', 'માથાનો દુખાવો', 'ચક્કર', 'ઉલટી', 'ઉધરસ', 'શરદી', 'તબિયત સારી નથી',
  'mathu dukhe', 'tabiyat sari nathi',
  // Malayalam
  'പനി', 'തലവേദന', 'തലകറക്കം', 'ഛർദി', 'ചുമ', 'ജലദോഷം', 'സുഖമില്ല',
  'thalavedana', 'thalakarakkam', 'chhardi', 'sukhamilla'
];

const LATIN = /^[\x20-\x7e]+$/;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LATIN_PHRASES = [...SYMPTOMS_ENGLISH, ...SYMPTOMS_OTHER.filter(p => LATIN.test(p))].map(p => ({
  phrase: p,
  re: new RegExp(`(^|[^a-z'])${escapeRe(p)}(?![a-z])`, 'g')
}));
const NATIVE_PHRASES = SYMPTOMS_OTHER.filter(p => !LATIN.test(p)).map(p => normalise(p));

/** Everyday symptoms the parent / person mentioned (their own turns only). Whole words; "no fever" doesn't count. */
export function scanForSymptoms(allTurns: TranscriptTurn[]): EmergencyScanResult {
  const matches = new Set<string>();
  for (const turn of expandTurns(allTurns)) {
    if (turn.role !== 'user') continue;
    const text = normalise(turn.text || '');
    if (!text) continue;
    for (const { phrase, re } of LATIN_PHRASES) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const start = m.index + m[1].length;
        if (!isNegated(text, start)) {
          matches.add(phrase);
          break;
        }
      }
    }
    for (const phrase of NATIVE_PHRASES) {
      if (text.includes(phrase)) matches.add(phrase);
    }
  }
  return { hit: matches.size > 0, matches: [...matches] };
}

/** One message someone typed to us. */
export function scanSymptomMessage(text: string): EmergencyScanResult {
  return scanForSymptoms([{ role: 'user', text }]);
}
