/**
 * Remind plan messages in the person's own language (2026-10-08): the medicine check, the check-up reminder and the
 * weekly progress (Meta templates, one per language) plus the free-text replies the person gets.
 *
 * DRAFT translations: they were written without a native speaker and must be checked before real families use them,
 * like `parentNotices.ts` (docs/v1-care-plan.md). Gender-neutral wording on purpose (Hindi, Marathi, Gujarati have
 * gendered verbs). "STOP", "START" and "108" stay as they are: they are commands and a phone number.
 *
 * Messages to the caretaker and to the family stay English: we don't know their language.
 * Pure and client-safe. English lives in reminders.ts / whatsapp.ts / appointments.ts; this file is everything else.
 */
import { NoticeLang, noticeLangFor } from './parentNotices';

export type WaLang = NoticeLang;

/** "Telugu" -> te, "Hindi & English" -> hi, "English" -> en. Same rule as the notices. */
export function waLang(language: string | null | undefined): WaLang {
  return noticeLangFor(language);
}

/** WhatsApp's language code for a template translation. English uses the configured default (WHATSAPP_TEMPLATE_LANGUAGE). */
export const META_LANGUAGE: Record<Exclude<WaLang, 'en'>, string> = {
  hi: 'hi', te: 'te', ta: 'ta', kn: 'kn', ml: 'ml', bn: 'bn', mr: 'mr', gu: 'gu'
};

export interface Phrases {
  startedHead: string; // {name} {times}
  startedCare: string; // {n} {caretaker}
  startedTail: string;
  restarted: string;
  stopped: string;
  taken: string; // {at}
  courseDone: string;
  notYet: string; // {at}
  notYetLastHead: string;
  notYetLastCare: string; // {at} {caretaker}
  pausedTodayTime: string; // {time}
  pausedToday: string;
  alreadyTaken: string;
  low: string; // {name} {left} {days}
  lowOut: string; // {name}
  lowTail: string; // {example}
  toppedUp: string; // {name} {count}
  emergencyHead: string; // {name}
  emergencyCare: string; // {caretaker}
  emergencyTail: string;
  unwellHead: string;
  unwellCare: string; // {caretaker}
  unwellTail: string;
  today: string;
  tomorrow: string;
  fasting: string;
  note: string;
  weeklyAll: string; // {total}
  weeklyGood: string; // {taken} {total}
  weeklyLow: string; // {taken} {total}
  /** Meta template bodies ({{1}} = name, {{2}} = time / text, {{3}} = medicines) and button labels (max 25 characters). */
  tplReminder: string;
  tplYes: string;
  tplNotYet: string;
  tplAppointment: string;
  tplWeekly: string;
}

export const PHRASES: Record<Exclude<WaLang, 'en'>, Phrases> = {
  hi: {
    startedHead: 'सब तैयार है, {name}। {times} पर आपसे पूछा जाएगा कि आपने दवा ली या नहीं। दवा लेने के बाद "हाँ, ले ली" दबाइए।',
    startedCare: ' {n} रिमाइंडर के बाद भी खुराक की पुष्टि न हुई, तो {caretaker} को बताया जाएगा।',
    startedTail: ' रोकने के लिए कभी भी STOP लिखिए।',
    restarted: 'आपकी दवा की जाँच फिर से चालू है। रोकने के लिए कभी भी STOP लिखिए।',
    stopped: 'आपकी दवा की जाँच बंद कर दी गई है। फिर चालू करने के लिए कभी भी START लिखिए।',
    taken: 'दर्ज हो गया: {at} को ली गई। ✓',
    courseDone: 'यह आपके कोर्स की आखिरी खुराक थी, इसलिए दवा की जाँच यहीं रुकती है। आपके अच्छे स्वास्थ्य की कामना!',
    notYet: 'ठीक है, {at} पर फिर पूछा जाएगा।',
    notYetLastHead: 'ठीक है। दवा लेने के बाद "हाँ, ले ली" दबाइए।',
    notYetLastCare: ' अगर {at} तक पुष्टि न हुई, तो {caretaker} को बताया जाएगा।',
    pausedTodayTime: 'ठीक है, आज और दवा की जाँच नहीं होगी। कल {time} से फिर शुरू होगी।',
    pausedToday: 'ठीक है, आज और दवा की जाँच नहीं होगी। कल से फिर शुरू होगी।',
    alreadyTaken: 'यह पहले ही "ली गई" दर्ज है। ✓',
    low: '{name}: सिर्फ़ {left} गोलियाँ बची हैं, लगभग {days} दिन के लिए।',
    lowOut: '{name} की गोलियाँ गिनती के हिसाब से ख़त्म हो गई हैं।',
    lowTail: ' नई लाने के बाद नाम और संख्या लिखकर भेजिए, जैसे "{example} 30"।',
    toppedUp: 'ठीक है: {name} की {count} गोलियाँ। कम पड़ने पर बता दिया जाएगा।',
    emergencyHead: '{name}, अपना ध्यान रखिए।',
    emergencyCare: ' {caretaker} को तुरंत बता दिया गया है।',
    emergencyTail: ' तुरंत मदद चाहिए तो एम्बुलेंस के लिए 108 पर कॉल कीजिए, या पास में किसी से कहिए।',
    unwellHead: 'आपकी तबीयत ठीक नहीं है, यह जानकर दुख हुआ।',
    unwellCare: ' {caretaker} को बता दिया गया है।',
    unwellTail: ' चिकित्सा सलाह देना संभव नहीं है: कृपया आराम कीजिए, और तबीयत बिगड़े तो डॉक्टर को दिखाइए। आपात स्थिति में 108 पर कॉल कीजिए।',
    today: 'आज',
    tomorrow: 'कल',
    fasting: ' खाली पेट रहना है।',
    note: ' नोट:',
    weeklyAll: 'इस हफ़्ते आपने सभी {total} दवा-जाँच की पुष्टि की। शाबाश! 💪',
    weeklyGood: 'इस हफ़्ते आपने {total} में से {taken} दवा-जाँच की पुष्टि की। शाबाश! 💪',
    weeklyLow: 'इस हफ़्ते आपने {total} में से {taken} दवा-जाँच की पुष्टि की। कल से नया हफ़्ता शुरू होगा।',
    tplReminder: 'नमस्ते {{1}}, क्या आपने अपनी {{2}} की दवा ली: {{3}}?\n\nयह वह दवा जाँच है जो आपने Aaptha पर सेट की थी।',
    tplYes: 'हाँ, ले ली',
    tplNotYet: 'अभी नहीं',
    tplAppointment: 'नमस्ते {{1}}, याद दिलाना: {{2}}\n\nयह रिमाइंडर Aaptha पर सेट किया गया था।',
    tplWeekly: 'नमस्ते {{1}}, आपका हफ़्ता: {{2}}\n\nयह साप्ताहिक सारांश Aaptha पर सेट किया गया था।'
  },
  te: {
    startedHead: 'అంతా సిద్ధం, {name}. {times} కు మీరు మందు వేసుకున్నారా అని అడుగుతాను. వేసుకున్న తర్వాత "అవును" నొక్కండి.',
    startedCare: ' {n} రిమైండర్ల తర్వాత కూడా నిర్ధారణ కాకపోతే {caretaker} కు తెలియజేస్తాను.',
    startedTail: ' ఆపడానికి ఎప్పుడైనా STOP అని పంపండి.',
    restarted: 'మీ మందుల తనిఖీ మళ్లీ ప్రారంభమైంది. ఆపడానికి ఎప్పుడైనా STOP అని పంపండి.',
    stopped: 'మీ మందుల తనిఖీ ఆగిపోయింది. మళ్లీ ప్రారంభించడానికి ఎప్పుడైనా START అని పంపండి.',
    taken: 'నమోదైంది: {at} కి వేసుకున్నారు. ✓',
    courseDone: 'ఇది మీ కోర్సులో చివరి మోతాదు, కాబట్టి మందుల తనిఖీ ఇక్కడితో ఆగుతుంది. మీరు ఆరోగ్యంగా ఉండాలని కోరుకుంటున్నాను!',
    notYet: 'సరే, {at} కి మళ్లీ అడుగుతాను.',
    notYetLastHead: 'సరే. వేసుకున్న తర్వాత "అవును" నొక్కండి.',
    notYetLastCare: ' {at} కల్లా నిర్ధారణ కాకపోతే {caretaker} కు తెలియజేస్తాను.',
    pausedTodayTime: 'సరే, ఈ రోజు ఇక మందుల తనిఖీలు ఉండవు. రేపు {time} కు మళ్లీ మొదలవుతాయి.',
    pausedToday: 'సరే, ఈ రోజు ఇక మందుల తనిఖీలు ఉండవు. రేపు మళ్లీ మొదలవుతాయి.',
    alreadyTaken: 'ఇది ఇప్పటికే "వేసుకున్నారు" అని నమోదైంది. ✓',
    low: '{name}: {left} మాత్రలు మిగిలాయి, సుమారు {days} రోజులకు సరిపోతాయి.',
    lowOut: 'నా లెక్క ప్రకారం మీ {name} మాత్రలు అయిపోయాయి.',
    lowTail: ' మళ్లీ కొన్న తర్వాత పేరు, సంఖ్య పంపండి, ఉదా. "{example} 30".',
    toppedUp: 'సరే: {name} {count} మాత్రలు. తగ్గినప్పుడు చెబుతాను.',
    emergencyHead: '{name}, జాగ్రత్తగా ఉండండి.',
    emergencyCare: ' {caretaker} కు వెంటనే తెలియజేశాను.',
    emergencyTail: ' అత్యవసర సహాయం కావాలంటే అంబులెన్స్ కోసం 108 కు కాల్ చేయండి, లేదా దగ్గరలో ఉన్నవారిని అడగండి.',
    unwellHead: 'మీకు ఆరోగ్యం బాగోలేదని తెలిసి బాధగా ఉంది.',
    unwellCare: ' {caretaker} కు తెలియజేశాను.',
    unwellTail: ' నేను వైద్య సలహా ఇవ్వలేను: విశ్రాంతి తీసుకోండి, ఎక్కువైతే డాక్టర్‌ను కలవండి. అత్యవసరమైతే 108 కు కాల్ చేయండి.',
    today: 'ఈ రోజు',
    tomorrow: 'రేపు',
    fasting: ' ఖాళీ కడుపుతో ఉండాలి.',
    note: ' గమనిక:',
    weeklyAll: 'ఈ వారం మీరు మొత్తం {total} మందుల తనిఖీలను నిర్ధారించారు. శభాష్! 💪',
    weeklyGood: 'ఈ వారం {total} లో {taken} మందుల తనిఖీలను నిర్ధారించారు. శభాష్! 💪',
    weeklyLow: 'ఈ వారం {total} లో {taken} మందుల తనిఖీలను నిర్ధారించారు. రేపటి నుంచి కొత్త వారం మొదలవుతుంది.',
    tplReminder: 'నమస్తే {{1}}, మీరు మీ {{2}} మందు వేసుకున్నారా: {{3}}?\n\nఇది మీరు Aaptha లో సెట్ చేసిన మందుల తనిఖీ.',
    tplYes: 'అవును, వేసుకున్నాను',
    tplNotYet: 'ఇంకా లేదు',
    tplAppointment: 'నమస్తే {{1}}, గుర్తు చేస్తున్నాం: {{2}}\n\nఈ రిమైండర్ Aaptha లో సెట్ చేయబడింది.',
    tplWeekly: 'నమస్తే {{1}}, మీ వారం: {{2}}\n\nఈ వారపు సారాంశం Aaptha లో సెట్ చేయబడింది.'
  },
  ta: {
    startedHead: 'எல்லாம் தயார், {name}. {times} மணிக்கு நீங்கள் மருந்து எடுத்துக்கொண்டீர்களா என்று கேட்பேன். எடுத்த பிறகு "ஆம்" என்பதை அழுத்துங்கள்.',
    startedCare: ' {n} நினைவூட்டல்களுக்குப் பிறகும் உறுதியாகவில்லை என்றால் {caretaker}-இடம் தெரிவிப்பேன்.',
    startedTail: ' நிறுத்த எப்போது வேண்டுமானாலும் STOP என்று அனுப்புங்கள்.',
    restarted: 'உங்கள் மருந்து சரிபார்ப்பு மீண்டும் தொடங்கியது. நிறுத்த எப்போது வேண்டுமானாலும் STOP என்று அனுப்புங்கள்.',
    stopped: 'உங்கள் மருந்து சரிபார்ப்பு நிறுத்தப்பட்டது. மீண்டும் தொடங்க START என்று அனுப்புங்கள்.',
    taken: 'பதிவு செய்யப்பட்டது: {at} மணிக்கு எடுத்தீர்கள். ✓',
    courseDone: 'இது உங்கள் சிகிச்சையின் கடைசி டோஸ், எனவே மருந்து சரிபார்ப்பு இத்துடன் நிற்கிறது. நலமாக இருங்கள்!',
    notYet: 'சரி, {at} மணிக்கு மீண்டும் கேட்பேன்.',
    notYetLastHead: 'சரி. எடுத்த பிறகு "ஆம்" என்பதை அழுத்துங்கள்.',
    notYetLastCare: ' {at}-க்குள் உறுதியாகவில்லை என்றால் {caretaker}-இடம் தெரிவிப்பேன்.',
    pausedTodayTime: 'சரி, இன்று இனி மருந்து சரிபார்ப்பு இல்லை. நாளை {time} மணிக்கு மீண்டும் தொடங்கும்.',
    pausedToday: 'சரி, இன்று இனி மருந்து சரிபார்ப்பு இல்லை. நாளை மீண்டும் தொடங்கும்.',
    alreadyTaken: 'இது ஏற்கனவே "எடுத்தது" என்று பதிவாகியுள்ளது. ✓',
    low: '{name}: {left} மாத்திரைகள் மீதமுள்ளன, சுமார் {days} நாட்களுக்கு போதும்.',
    lowOut: 'என் கணக்குப்படி உங்கள் {name} மாத்திரைகள் தீர்ந்துவிட்டன.',
    lowTail: ' மீண்டும் வாங்கியதும் பெயரையும் எண்ணையும் அனுப்புங்கள், எ.கா. "{example} 30".',
    toppedUp: 'சரி: {name} {count} மாத்திரைகள். குறையும்போது சொல்கிறேன்.',
    emergencyHead: '{name}, கவனமாக இருங்கள்.',
    emergencyCare: ' {caretaker}-இடம் உடனே தெரிவித்துவிட்டேன்.',
    emergencyTail: ' உடனடி உதவி தேவைப்பட்டால் ஆம்புலன்சுக்கு 108-ஐ அழையுங்கள், அல்லது அருகில் உள்ளவரிடம் கேளுங்கள்.',
    unwellHead: 'உங்களுக்கு உடல்நிலை சரியில்லை என்பது வருத்தமாக உள்ளது.',
    unwellCare: ' {caretaker}-இடம் தெரிவித்துவிட்டேன்.',
    unwellTail: ' என்னால் மருத்துவ ஆலோசனை தர முடியாது: ஓய்வெடுங்கள், மோசமானால் மருத்துவரைப் பாருங்கள். அவசரம் என்றால் 108-ஐ அழையுங்கள்.',
    today: 'இன்று',
    tomorrow: 'நாளை',
    fasting: ' வெறும் வயிற்றில் இருக்க வேண்டும்.',
    note: ' குறிப்பு:',
    weeklyAll: 'இந்த வாரம் நீங்கள் {total} மருந்து சரிபார்ப்புகளையும் உறுதிசெய்தீர்கள். வாழ்த்துகள்! 💪',
    weeklyGood: 'இந்த வாரம் {total}-இல் {taken} மருந்து சரிபார்ப்புகளை உறுதிசெய்தீர்கள். வாழ்த்துகள்! 💪',
    weeklyLow: 'இந்த வாரம் {total}-இல் {taken} மருந்து சரிபார்ப்புகளை உறுதிசெய்தீர்கள். நாளை புதிய வாரம் தொடங்கும்.',
    tplReminder: 'வணக்கம் {{1}}, உங்கள் {{2}} மருந்தை எடுத்துக்கொண்டீர்களா: {{3}}?\n\nஇது நீங்கள் Aaptha-வில் அமைத்த மருந்து சரிபார்ப்பு.',
    tplYes: 'ஆம், எடுத்தேன்',
    tplNotYet: 'இன்னும் இல்லை',
    tplAppointment: 'வணக்கம் {{1}}, நினைவூட்டல்: {{2}}\n\nஇந்த நினைவூட்டல் Aaptha-வில் அமைக்கப்பட்டது.',
    tplWeekly: 'வணக்கம் {{1}}, உங்கள் வாரம்: {{2}}\n\nஇந்த வாராந்திர சுருக்கம் Aaptha-வில் அமைக்கப்பட்டது.'
  },
  kn: {
    startedHead: 'ಎಲ್ಲವೂ ಸಿದ್ಧ, {name}. {times} ಕ್ಕೆ ನೀವು ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿರಾ ಎಂದು ಕೇಳುತ್ತೇನೆ. ತೆಗೆದುಕೊಂಡ ಮೇಲೆ "ಹೌದು" ಒತ್ತಿ.',
    startedCare: ' {n} ಜ್ಞಾಪನೆಗಳ ನಂತರವೂ ಖಚಿತವಾಗದಿದ್ದರೆ {caretaker} ಅವರಿಗೆ ತಿಳಿಸುತ್ತೇನೆ.',
    startedTail: ' ನಿಲ್ಲಿಸಲು ಯಾವಾಗ ಬೇಕಾದರೂ STOP ಎಂದು ಕಳುಹಿಸಿ.',
    restarted: 'ನಿಮ್ಮ ಔಷಧಿ ಪರಿಶೀಲನೆ ಮತ್ತೆ ಆರಂಭವಾಗಿದೆ. ನಿಲ್ಲಿಸಲು ಯಾವಾಗ ಬೇಕಾದರೂ STOP ಎಂದು ಕಳುಹಿಸಿ.',
    stopped: 'ನಿಮ್ಮ ಔಷಧಿ ಪರಿಶೀಲನೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಮತ್ತೆ ಆರಂಭಿಸಲು START ಎಂದು ಕಳುಹಿಸಿ.',
    taken: 'ದಾಖಲಾಗಿದೆ: {at} ಕ್ಕೆ ತೆಗೆದುಕೊಂಡಿದ್ದೀರಿ. ✓',
    courseDone: 'ಇದು ನಿಮ್ಮ ಕೋರ್ಸ್‌ನ ಕೊನೆಯ ಡೋಸ್, ಆದ್ದರಿಂದ ಔಷಧಿ ಪರಿಶೀಲನೆ ಇಲ್ಲಿಗೆ ನಿಲ್ಲುತ್ತದೆ. ಆರೋಗ್ಯವಾಗಿರಿ!',
    notYet: 'ಸರಿ, {at} ಕ್ಕೆ ಮತ್ತೆ ಕೇಳುತ್ತೇನೆ.',
    notYetLastHead: 'ಸರಿ. ತೆಗೆದುಕೊಂಡ ಮೇಲೆ "ಹೌದು" ಒತ್ತಿ.',
    notYetLastCare: ' {at} ಒಳಗೆ ಖಚಿತವಾಗದಿದ್ದರೆ {caretaker} ಅವರಿಗೆ ತಿಳಿಸುತ್ತೇನೆ.',
    pausedTodayTime: 'ಸರಿ, ಇಂದು ಇನ್ನು ಔಷಧಿ ಪರಿಶೀಲನೆ ಇರುವುದಿಲ್ಲ. ನಾಳೆ {time} ಕ್ಕೆ ಮತ್ತೆ ಆರಂಭವಾಗುತ್ತದೆ.',
    pausedToday: 'ಸರಿ, ಇಂದು ಇನ್ನು ಔಷಧಿ ಪರಿಶೀಲನೆ ಇರುವುದಿಲ್ಲ. ನಾಳೆ ಮತ್ತೆ ಆರಂಭವಾಗುತ್ತದೆ.',
    alreadyTaken: 'ಇದು ಈಗಾಗಲೇ "ತೆಗೆದುಕೊಂಡಿದ್ದೀರಿ" ಎಂದು ದಾಖಲಾಗಿದೆ. ✓',
    low: '{name}: {left} ಮಾತ್ರೆಗಳು ಉಳಿದಿವೆ, ಸುಮಾರು {days} ದಿನಗಳಿಗೆ ಸಾಕು.',
    lowOut: 'ನನ್ನ ಲೆಕ್ಕದ ಪ್ರಕಾರ ನಿಮ್ಮ {name} ಮಾತ್ರೆಗಳು ಮುಗಿದಿವೆ.',
    lowTail: ' ಮತ್ತೆ ಖರೀದಿಸಿದ ಮೇಲೆ ಹೆಸರು ಮತ್ತು ಸಂಖ್ಯೆ ಕಳುಹಿಸಿ, ಉದಾ. "{example} 30".',
    toppedUp: 'ಸರಿ: {name} {count} ಮಾತ್ರೆಗಳು. ಕಡಿಮೆಯಾದಾಗ ತಿಳಿಸುತ್ತೇನೆ.',
    emergencyHead: '{name}, ಜಾಗ್ರತೆಯಾಗಿರಿ.',
    emergencyCare: ' {caretaker} ಅವರಿಗೆ ತಕ್ಷಣ ತಿಳಿಸಿದ್ದೇನೆ.',
    emergencyTail: ' ತುರ್ತು ಸಹಾಯ ಬೇಕಾದರೆ ಆಂಬುಲೆನ್ಸ್‌ಗಾಗಿ 108 ಗೆ ಕರೆ ಮಾಡಿ, ಅಥವಾ ಹತ್ತಿರದವರನ್ನು ಕೇಳಿ.',
    unwellHead: 'ನಿಮ್ಮ ಆರೋಗ್ಯ ಸರಿಯಿಲ್ಲ ಎಂದು ತಿಳಿದು ಬೇಸರವಾಯಿತು.',
    unwellCare: ' {caretaker} ಅವರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ.',
    unwellTail: ' ನಾನು ವೈದ್ಯಕೀಯ ಸಲಹೆ ನೀಡಲಾರೆ: ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ, ಹೆಚ್ಚಾದರೆ ವೈದ್ಯರನ್ನು ಭೇಟಿ ಮಾಡಿ. ತುರ್ತು ಇದ್ದರೆ 108 ಗೆ ಕರೆ ಮಾಡಿ.',
    today: 'ಇಂದು',
    tomorrow: 'ನಾಳೆ',
    fasting: ' ಖಾಲಿ ಹೊಟ್ಟೆಯಲ್ಲಿರಬೇಕು.',
    note: ' ಸೂಚನೆ:',
    weeklyAll: 'ಈ ವಾರ ನೀವು ಎಲ್ಲಾ {total} ಔಷಧಿ ಪರಿಶೀಲನೆಗಳನ್ನು ದೃಢಪಡಿಸಿದ್ದೀರಿ. ಶಹಬ್ಬಾಸ್! 💪',
    weeklyGood: 'ಈ ವಾರ {total} ರಲ್ಲಿ {taken} ಔಷಧಿ ಪರಿಶೀಲನೆಗಳನ್ನು ದೃಢಪಡಿಸಿದ್ದೀರಿ. ಶಹಬ್ಬಾಸ್! 💪',
    weeklyLow: 'ಈ ವಾರ {total} ರಲ್ಲಿ {taken} ಔಷಧಿ ಪರಿಶೀಲನೆಗಳನ್ನು ದೃಢಪಡಿಸಿದ್ದೀರಿ. ನಾಳೆಯಿಂದ ಹೊಸ ವಾರ ಆರಂಭವಾಗುತ್ತದೆ.',
    tplReminder: 'ನಮಸ್ಕಾರ {{1}}, ನೀವು ನಿಮ್ಮ {{2}} ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿರಾ: {{3}}?\n\nಇದು ನೀವು Aaptha ನಲ್ಲಿ ಹೊಂದಿಸಿದ ಔಷಧಿ ಪರಿಶೀಲನೆ.',
    tplYes: 'ಹೌದು, ತೆಗೆದುಕೊಂಡೆ',
    tplNotYet: 'ಇನ್ನೂ ಇಲ್ಲ',
    tplAppointment: 'ನಮಸ್ಕಾರ {{1}}, ಜ್ಞಾಪನೆ: {{2}}\n\nಈ ಜ್ಞಾಪನೆಯನ್ನು Aaptha ನಲ್ಲಿ ಹೊಂದಿಸಲಾಗಿದೆ.',
    tplWeekly: 'ನಮಸ್ಕಾರ {{1}}, ನಿಮ್ಮ ವಾರ: {{2}}\n\nಈ ವಾರದ ಸಾರಾಂಶವನ್ನು Aaptha ನಲ್ಲಿ ಹೊಂದಿಸಲಾಗಿದೆ.'
  },
  ml: {
    startedHead: 'എല്ലാം തയ്യാർ, {name}. {times} ന് നിങ്ങൾ മരുന്ന് കഴിച്ചോ എന്ന് ചോദിക്കും. കഴിച്ചതിന് ശേഷം "അതെ" അമർത്തുക.',
    startedCare: ' {n} ഓർമ്മപ്പെടുത്തലുകൾക്ക് ശേഷവും ഉറപ്പായില്ലെങ്കിൽ {caretaker} നെ അറിയിക്കും.',
    startedTail: ' നിർത്താൻ എപ്പോൾ വേണമെങ്കിലും STOP എന്ന് അയയ്ക്കുക.',
    restarted: 'നിങ്ങളുടെ മരുന്ന് പരിശോധന വീണ്ടും തുടങ്ങി. നിർത്താൻ എപ്പോൾ വേണമെങ്കിലും STOP എന്ന് അയയ്ക്കുക.',
    stopped: 'നിങ്ങളുടെ മരുന്ന് പരിശോധന നിർത്തി. വീണ്ടും തുടങ്ങാൻ START എന്ന് അയയ്ക്കുക.',
    taken: 'രേഖപ്പെടുത്തി: {at} ന് കഴിച്ചു. ✓',
    courseDone: 'ഇത് നിങ്ങളുടെ കോഴ്സിലെ അവസാന ഡോസ് ആയിരുന്നു, അതിനാൽ മരുന്ന് പരിശോധന ഇവിടെ അവസാനിക്കുന്നു. ആരോഗ്യത്തോടെ ഇരിക്കൂ!',
    notYet: 'ശരി, {at} ന് വീണ്ടും ചോദിക്കും.',
    notYetLastHead: 'ശരി. കഴിച്ചതിന് ശേഷം "അതെ" അമർത്തുക.',
    notYetLastCare: ' {at} ന് ഉള്ളിൽ ഉറപ്പായില്ലെങ്കിൽ {caretaker} നെ അറിയിക്കും.',
    pausedTodayTime: 'ശരി, ഇന്ന് ഇനി മരുന്ന് പരിശോധന ഉണ്ടാകില്ല. നാളെ {time} ന് വീണ്ടും തുടങ്ങും.',
    pausedToday: 'ശരി, ഇന്ന് ഇനി മരുന്ന് പരിശോധന ഉണ്ടാകില്ല. നാളെ വീണ്ടും തുടങ്ങും.',
    alreadyTaken: 'ഇത് ഇതിനകം "കഴിച്ചു" എന്ന് രേഖപ്പെടുത്തിയിട്ടുണ്ട്. ✓',
    low: '{name}: {left} ഗുളികകൾ ബാക്കിയുണ്ട്, ഏകദേശം {days} ദിവസത്തേക്ക് മതി.',
    lowOut: 'എന്റെ കണക്ക് പ്രകാരം നിങ്ങളുടെ {name} ഗുളികകൾ തീർന്നു.',
    lowTail: ' വീണ്ടും വാങ്ങിയാൽ പേരും എണ്ണവും അയയ്ക്കുക, ഉദാ. "{example} 30".',
    toppedUp: 'ശരി: {name} {count} ഗുളികകൾ. കുറയുമ്പോൾ അറിയിക്കും.',
    emergencyHead: '{name}, ശ്രദ്ധിക്കുക.',
    emergencyCare: ' {caretaker} നെ ഉടൻ അറിയിച്ചിട്ടുണ്ട്.',
    emergencyTail: ' അടിയന്തര സഹായം വേണമെങ്കിൽ ആംബുലൻസിന് 108 ൽ വിളിക്കുക, അല്ലെങ്കിൽ അടുത്തുള്ളവരോട് പറയുക.',
    unwellHead: 'നിങ്ങൾക്ക് സുഖമില്ലെന്ന് അറിഞ്ഞതിൽ വിഷമമുണ്ട്.',
    unwellCare: ' {caretaker} നെ അറിയിച്ചിട്ടുണ്ട്.',
    unwellTail: ' എനിക്ക് വൈദ്യോപദേശം നൽകാൻ കഴിയില്ല: വിശ്രമിക്കൂ, കൂടുതലായാൽ ഡോക്ടറെ കാണൂ. അടിയന്തരമാണെങ്കിൽ 108 ൽ വിളിക്കുക.',
    today: 'ഇന്ന്',
    tomorrow: 'നാളെ',
    fasting: ' വെറും വയറ്റിൽ ആയിരിക്കണം.',
    note: ' കുറിപ്പ്:',
    weeklyAll: 'ഈ ആഴ്ച നിങ്ങൾ എല്ലാ {total} മരുന്ന് പരിശോധനകളും സ്ഥിരീകരിച്ചു. അഭിനന്ദനങ്ങൾ! 💪',
    weeklyGood: 'ഈ ആഴ്ച {total} ൽ {taken} മരുന്ന് പരിശോധനകൾ സ്ഥിരീകരിച്ചു. അഭിനന്ദനങ്ങൾ! 💪',
    weeklyLow: 'ഈ ആഴ്ച {total} ൽ {taken} മരുന്ന് പരിശോധനകൾ സ്ഥിരീകരിച്ചു. നാളെ മുതൽ പുതിയ ആഴ്ച തുടങ്ങും.',
    tplReminder: 'നമസ്കാരം {{1}}, നിങ്ങളുടെ {{2}} മരുന്ന് കഴിച്ചോ: {{3}}?\n\nഇത് നിങ്ങൾ Aaptha-യിൽ സജ്ജമാക്കിയ മരുന്ന് പരിശോധനയാണ്.',
    tplYes: 'അതെ, കഴിച്ചു',
    tplNotYet: 'ഇതുവരെ ഇല്ല',
    tplAppointment: 'നമസ്കാരം {{1}}, ഓർമ്മപ്പെടുത്തൽ: {{2}}\n\nഈ ഓർമ്മപ്പെടുത്തൽ Aaptha-യിൽ സജ്ജമാക്കിയതാണ്.',
    tplWeekly: 'നമസ്കാരം {{1}}, നിങ്ങളുടെ ആഴ്ച: {{2}}\n\nഈ ആഴ്ചത്തെ സംഗ്രഹം Aaptha-യിൽ സജ്ജമാക്കിയതാണ്.'
  },
  bn: {
    startedHead: 'সব ঠিক আছে, {name}। {times}-এ আপনাকে জিজ্ঞেস করা হবে ওষুধ খেয়েছেন কিনা। খাওয়ার পর "হ্যাঁ" চাপুন।',
    startedCare: ' {n}টি রিমাইন্ডারের পরও নিশ্চিত না হলে {caretaker}-কে জানানো হবে।',
    startedTail: ' বন্ধ করতে যেকোনো সময় STOP লিখুন।',
    restarted: 'আপনার ওষুধ পরীক্ষা আবার চালু হয়েছে। বন্ধ করতে যেকোনো সময় STOP লিখুন।',
    stopped: 'আপনার ওষুধ পরীক্ষা বন্ধ করা হয়েছে। আবার চালু করতে START লিখুন।',
    taken: 'নথিভুক্ত হয়েছে: {at}-এ খেয়েছেন। ✓',
    courseDone: 'এটি আপনার কোর্সের শেষ ডোজ ছিল, তাই ওষুধ পরীক্ষা এখানেই শেষ। সুস্থ থাকুন!',
    notYet: 'ঠিক আছে, {at}-এ আবার জিজ্ঞেস করা হবে।',
    notYetLastHead: 'ঠিক আছে। খাওয়ার পর "হ্যাঁ" চাপুন।',
    notYetLastCare: ' {at}-এর মধ্যে নিশ্চিত না হলে {caretaker}-কে জানানো হবে।',
    pausedTodayTime: 'ঠিক আছে, আজ আর ওষুধ পরীক্ষা হবে না। কাল {time}-এ আবার শুরু হবে।',
    pausedToday: 'ঠিক আছে, আজ আর ওষুধ পরীক্ষা হবে না। কাল আবার শুরু হবে।',
    alreadyTaken: 'এটি আগেই "খেয়েছেন" হিসেবে নথিভুক্ত। ✓',
    low: '{name}: {left}টি ট্যাবলেট বাকি, প্রায় {days} দিনের জন্য যথেষ্ট।',
    lowOut: 'আমার হিসাবে আপনার {name} ট্যাবলেট শেষ হয়ে গেছে।',
    lowTail: ' আবার কেনার পর নাম ও সংখ্যা লিখে পাঠান, যেমন "{example} 30"।',
    toppedUp: 'ঠিক আছে: {name} {count}টি ট্যাবলেট। কমে গেলে জানানো হবে।',
    emergencyHead: '{name}, নিজের যত্ন নিন।',
    emergencyCare: ' {caretaker}-কে এখনই জানানো হয়েছে।',
    emergencyTail: ' জরুরি সাহায্য লাগলে অ্যাম্বুলেন্সের জন্য 108-এ ফোন করুন, অথবা কাছের কাউকে বলুন।',
    unwellHead: 'আপনার শরীর ভালো নেই জেনে দুঃখিত।',
    unwellCare: ' {caretaker}-কে জানানো হয়েছে।',
    unwellTail: ' আমি চিকিৎসা পরামর্শ দিতে পারি না: বিশ্রাম নিন, বেশি খারাপ হলে ডাক্তার দেখান। জরুরি হলে 108-এ ফোন করুন।',
    today: 'আজ',
    tomorrow: 'কাল',
    fasting: ' খালি পেটে থাকতে হবে।',
    note: ' নোট:',
    weeklyAll: 'এই সপ্তাহে আপনি সব {total}টি ওষুধ পরীক্ষা নিশ্চিত করেছেন। শাবাশ! 💪',
    weeklyGood: 'এই সপ্তাহে {total}টির মধ্যে {taken}টি ওষুধ পরীক্ষা নিশ্চিত করেছেন। শাবাশ! 💪',
    weeklyLow: 'এই সপ্তাহে {total}টির মধ্যে {taken}টি ওষুধ পরীক্ষা নিশ্চিত করেছেন। কাল থেকে নতুন সপ্তাহ শুরু।',
    tplReminder: 'নমস্কার {{1}}, আপনি কি আপনার {{2}} এর ওষুধ খেয়েছেন: {{3}}?\n\nএটি আপনি Aaptha-তে সেট করা ওষুধ পরীক্ষা।',
    tplYes: 'হ্যাঁ, খেয়েছি',
    tplNotYet: 'এখনও না',
    tplAppointment: 'নমস্কার {{1}}, মনে করিয়ে দিচ্ছি: {{2}}\n\nএই রিমাইন্ডার Aaptha-তে সেট করা হয়েছে।',
    tplWeekly: 'নমস্কার {{1}}, আপনার সপ্তাহ: {{2}}\n\nএই সাপ্তাহিক সারাংশ Aaptha-তে সেট করা হয়েছে।'
  },
  mr: {
    startedHead: 'सर्व तयार आहे, {name}. {times} वाजता तुम्ही औषध घेतले का असे विचारले जाईल. घेतल्यावर "हो" दाबा.',
    startedCare: ' {n} आठवणींनंतरही खात्री झाली नाही तर {caretaker} यांना कळवले जाईल.',
    startedTail: ' थांबवण्यासाठी केव्हाही STOP लिहा.',
    restarted: 'तुमची औषध तपासणी पुन्हा सुरू झाली आहे. थांबवण्यासाठी केव्हाही STOP लिहा.',
    stopped: 'तुमची औषध तपासणी थांबवली आहे. पुन्हा सुरू करण्यासाठी START लिहा.',
    taken: 'नोंद झाली: {at} ला घेतले. ✓',
    courseDone: 'हा तुमच्या कोर्सचा शेवटचा डोस होता, म्हणून औषध तपासणी इथे थांबते. निरोगी राहा!',
    notYet: 'ठीक आहे, {at} ला पुन्हा विचारले जाईल.',
    notYetLastHead: 'ठीक आहे. घेतल्यावर "हो" दाबा.',
    notYetLastCare: ' {at} पर्यंत खात्री झाली नाही तर {caretaker} यांना कळवले जाईल.',
    pausedTodayTime: 'ठीक आहे, आज आणखी औषध तपासणी होणार नाही. उद्या {time} ला पुन्हा सुरू होईल.',
    pausedToday: 'ठीक आहे, आज आणखी औषध तपासणी होणार नाही. उद्या पुन्हा सुरू होईल.',
    alreadyTaken: 'हे आधीच "घेतले" म्हणून नोंदले आहे. ✓',
    low: '{name}: {left} गोळ्या उरल्या आहेत, सुमारे {days} दिवस पुरतील.',
    lowOut: 'माझ्या हिशोबाने तुमच्या {name} गोळ्या संपल्या आहेत.',
    lowTail: ' पुन्हा आणल्यावर नाव आणि संख्या पाठवा, उदा. "{example} 30".',
    toppedUp: 'ठीक आहे: {name} च्या {count} गोळ्या. कमी झाल्यावर सांगेन.',
    emergencyHead: '{name}, काळजी घ्या.',
    emergencyCare: ' {caretaker} यांना लगेच कळवले आहे.',
    emergencyTail: ' तातडीची मदत हवी असल्यास रुग्णवाहिकेसाठी 108 वर फोन करा, किंवा जवळच्या व्यक्तीला सांगा.',
    unwellHead: 'तुमची तब्येत बरी नाही हे ऐकून वाईट वाटले.',
    unwellCare: ' {caretaker} यांना कळवले आहे.',
    unwellTail: ' मी वैद्यकीय सल्ला देऊ शकत नाही: विश्रांती घ्या, जास्त त्रास झाल्यास डॉक्टरांना दाखवा. तातडीचे असल्यास 108 वर फोन करा.',
    today: 'आज',
    tomorrow: 'उद्या',
    fasting: ' रिकाम्या पोटी राहायचे आहे.',
    note: ' टीप:',
    weeklyAll: 'या आठवड्यात तुम्ही सर्व {total} औषध तपासण्यांची खात्री दिली. शाबास! 💪',
    weeklyGood: 'या आठवड्यात {total} पैकी {taken} औषध तपासण्यांची खात्री दिली. शाबास! 💪',
    weeklyLow: 'या आठवड्यात {total} पैकी {taken} औषध तपासण्यांची खात्री दिली. उद्यापासून नवा आठवडा सुरू होईल.',
    tplReminder: 'नमस्कार {{1}}, तुम्ही तुमचे {{2}} चे औषध घेतले का: {{3}}?\n\nही तुम्ही Aaptha वर सेट केलेली औषध तपासणी आहे.',
    tplYes: 'हो, घेतले',
    tplNotYet: 'अजून नाही',
    tplAppointment: 'नमस्कार {{1}}, आठवण: {{2}}\n\nही आठवण Aaptha वर सेट केली आहे.',
    tplWeekly: 'नमस्कार {{1}}, तुमचा आठवडा: {{2}}\n\nहा साप्ताहिक सारांश Aaptha वर सेट केला आहे.'
  },
  gu: {
    startedHead: 'બધું તૈયાર છે, {name}. {times} વાગ્યે તમને પૂછવામાં આવશે કે દવા લીધી કે નહીં. લીધા પછી "હા" દબાવો.',
    startedCare: ' {n} રિમાઇન્ડર પછી પણ ખાતરી ન થાય તો {caretaker} ને જણાવવામાં આવશે.',
    startedTail: ' બંધ કરવા માટે ગમે ત્યારે STOP લખો.',
    restarted: 'તમારી દવાની તપાસ ફરી ચાલુ થઈ છે. બંધ કરવા માટે ગમે ત્યારે STOP લખો.',
    stopped: 'તમારી દવાની તપાસ બંધ કરવામાં આવી છે. ફરી ચાલુ કરવા START લખો.',
    taken: 'નોંધાયું: {at} એ લીધી. ✓',
    courseDone: 'આ તમારા કોર્સનો છેલ્લો ડોઝ હતો, એટલે દવાની તપાસ અહીં અટકે છે. સ્વસ્થ રહો!',
    notYet: 'ઠીક છે, {at} એ ફરી પૂછવામાં આવશે.',
    notYetLastHead: 'ઠીક છે. લીધા પછી "હા" દબાવો.',
    notYetLastCare: ' {at} સુધી ખાતરી ન થાય તો {caretaker} ને જણાવવામાં આવશે.',
    pausedTodayTime: 'ઠીક છે, આજે હવે દવાની તપાસ નહીં થાય. કાલે {time} એ ફરી શરૂ થશે.',
    pausedToday: 'ઠીક છે, આજે હવે દવાની તપાસ નહીં થાય. કાલે ફરી શરૂ થશે.',
    alreadyTaken: 'આ પહેલેથી "લીધી" તરીકે નોંધાયેલ છે. ✓',
    low: '{name}: {left} ગોળીઓ બાકી છે, લગભગ {days} દિવસ ચાલશે.',
    lowOut: 'ગણતરી પ્રમાણે તમારી {name} ગોળીઓ પૂરી થઈ ગઈ છે.',
    lowTail: ' ફરી લાવ્યા પછી નામ અને સંખ્યા મોકલો, જેમ કે "{example} 30".',
    toppedUp: 'ઠીક છે: {name} ની {count} ગોળીઓ. ઓછી થશે ત્યારે જણાવવામાં આવશે.',
    emergencyHead: '{name}, ધ્યાન રાખજો.',
    emergencyCare: ' {caretaker} ને તરત જણાવવામાં આવ્યું છે.',
    emergencyTail: ' તાત્કાલિક મદદ જોઈએ તો એમ્બ્યુલન્સ માટે 108 પર ફોન કરો, અથવા નજીકના કોઈને કહો.',
    unwellHead: 'તમારી તબિયત સારી નથી એ જાણીને દુઃખ થયું.',
    unwellCare: ' {caretaker} ને જણાવવામાં આવ્યું છે.',
    unwellTail: ' તબીબી સલાહ આપવી શક્ય નથી: આરામ કરો, વધે તો ડૉક્ટરને બતાવો. કટોકટી હોય તો 108 પર ફોન કરો.',
    today: 'આજે',
    tomorrow: 'કાલે',
    fasting: ' ખાલી પેટે રહેવાનું છે.',
    note: ' નોંધ:',
    weeklyAll: 'આ અઠવાડિયે તમે બધી {total} દવાની તપાસની પુષ્ટિ કરી. શાબાશ! 💪',
    weeklyGood: 'આ અઠવાડિયે {total} માંથી {taken} દવાની તપાસની પુષ્ટિ કરી. શાબાશ! 💪',
    weeklyLow: 'આ અઠવાડિયે {total} માંથી {taken} દવાની તપાસની પુષ્ટિ કરી. કાલથી નવું અઠવાડિયું શરૂ થશે.',
    tplReminder: 'નમસ્તે {{1}}, શું તમે તમારી {{2}} ની દવા લીધી: {{3}}?\n\nઆ તમે Aaptha પર સેટ કરેલી દવાની તપાસ છે.',
    tplYes: 'હા, લીધી',
    tplNotYet: 'હજી નહીં',
    tplAppointment: 'નમસ્તે {{1}}, યાદ અપાવવા: {{2}}\n\nઆ રિમાઇન્ડર Aaptha પર સેટ કરેલું છે.',
    tplWeekly: 'નમસ્તે {{1}}, તમારું અઠવાડિયું: {{2}}\n\nઆ સાપ્તાહિક સારાંશ Aaptha પર સેટ કરેલો છે.'
  }
};

/** "{name}" -> value. Meta's "{{1}}" placeholders are never passed through here. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const clock = (slot: string) => slot.replace(/^0/, '');

/**
 * The person's free-text replies in their language, same signatures as REMINDER_REPLIES in reminders.ts.
 * Keys not listed here stay English (code errors, "already on", the caretaker's messages).
 */
export function localReplies(lang: Exclude<WaLang, 'en'>, maxAsks: number) {
  const p = PHRASES[lang];
  return {
    started: (name: string, times: string[], caretaker: string | null) =>
      fill(p.startedHead, { name: first(name), times: times.map(clock).join(', ') }) +
      (caretaker ? fill(p.startedCare, { n: maxAsks, caretaker: first(caretaker) }) : '') +
      p.startedTail,
    restarted: p.restarted,
    stopped: p.stopped,
    taken: (at: string) => fill(p.taken, { at: clock(at) }),
    courseDone: p.courseDone,
    notYet: (at: string) => fill(p.notYet, { at: clock(at) }),
    notYetLast: (at: string, caretaker: string | null) =>
      p.notYetLastHead + (caretaker ? fill(p.notYetLastCare, { at: clock(at), caretaker: first(caretaker) }) : ''),
    pausedToday: (firstTomorrow: string | null) => (firstTomorrow ? fill(p.pausedTodayTime, { time: clock(firstTomorrow) }) : p.pausedToday),
    alreadyTaken: p.alreadyTaken,
    runningLow: (items: { name: string; left: number; days: number }[]) =>
      items.map(i => (i.left <= 0 ? fill(p.lowOut, { name: i.name }) : fill(p.low, { name: i.name, left: i.left, days: i.days }))).join(' ') +
      fill(p.lowTail, { example: items[0].name }),
    toppedUp: (name: string, count: number) => fill(p.toppedUp, { name, count }),
    emergency: (name: string, caretaker: string | null) =>
      fill(p.emergencyHead, { name: first(name) }) + (caretaker ? fill(p.emergencyCare, { caretaker: first(caretaker) }) : '') + p.emergencyTail,
    unwell: (caretaker: string | null) => p.unwellHead + (caretaker ? fill(p.unwellCare, { caretaker: first(caretaker) }) : '') + p.unwellTail
  };
}

/** Words for a check-up reminder line: "Tomorrow at 10 AM: scan at Apollo Clinic. Needs an empty stomach." */
export interface AppointmentWords {
  today: string;
  tomorrow: string;
  /** Joins the title and the place: "scan at Apollo Clinic" / "scan, Apollo Clinic". */
  join: (title: string, place: string) => string;
  fasting: string;
  note: string;
}

export const ENGLISH_APPOINTMENT_WORDS: AppointmentWords = {
  today: 'Today at',
  tomorrow: 'Tomorrow at',
  join: (t, l) => `${t} at ${l}`,
  fasting: ' Needs an empty stomach.',
  note: ' Note:'
};

export function appointmentWords(lang: WaLang): AppointmentWords {
  if (lang === 'en') return ENGLISH_APPOINTMENT_WORDS;
  const p = PHRASES[lang];
  return { today: p.today, tomorrow: p.tomorrow, join: (t, l) => `${t}, ${l}`, fasting: p.fasting, note: p.note };
}

/** The weekly progress line, one line (Meta's rule for template parameters). */
export function localWeeklyText(lang: Exclude<WaLang, 'en'>, taken: number, total: number): string {
  const p = PHRASES[lang];
  if (taken >= total) return fill(p.weeklyAll, { total });
  return fill(taken / total >= 0.8 ? p.weeklyGood : p.weeklyLow, { taken, total });
}
