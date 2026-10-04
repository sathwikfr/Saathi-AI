/**
 * Words written for the PARENT, in their language:
 *   - the short notice about Saathi (/notice/<lang>): what it is, what the family sees,
 *     the 90-day rule, the "never asks for money or OTPs" line, how to stop, 112;
 *   - the introduction the child sends before the first call (WhatsApp text or voice note).
 *
 * Translations were drafted for v1 and must be checked by native speakers before
 * real families use them (docs/v1-care-plan.md). Client-safe (no server imports).
 */
export const NOTICE_LANGS = ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'bn', 'mr', 'gu'] as const;
export type NoticeLang = (typeof NOTICE_LANGS)[number];

const BY_NAME: Array<[string, NoticeLang]> = [
  ['telugu', 'te'], ['tamil', 'ta'], ['kannada', 'kn'], ['malayalam', 'ml'], ['bengali', 'bn'],
  ['marathi', 'mr'], ['gujarati', 'gu'], ['hindi', 'hi']
];

/** "Hindi & English" -> hi, "English" -> en (same rule as the call language). */
export function noticeLangFor(language: string | null | undefined): NoticeLang {
  const text = (language || '').toLowerCase();
  for (const [needle, code] of BY_NAME) if (text.includes(needle)) return code;
  return text.includes('english') ? 'en' : 'hi';
}

export function isNoticeLang(v: string): v is NoticeLang {
  return (NOTICE_LANGS as readonly string[]).includes(v);
}

interface NoticeText {
  label: string; // language name in that language
  title: string;
  lines: string[];
  support: (phone: string) => string;
  /** Introduction from the child; {parent}, {time}, {family} are filled in. */
  intro: string;
}

export const NOTICES: Record<NoticeLang, NoticeText> = {
  en: {
    label: 'English',
    title: 'About Saathi',
    lines: [
      'Saathi is an AI voice assistant from Aaptha. Your family set it up to call you about your medicines.',
      'What you tell Saathi (whether you took your medicines, how you feel, and anything you ask it to pass on) is shown to your family on Aaptha.',
      'A short written summary of each call is kept. The full written conversation is deleted after 90 days.',
      'Saathi will never ask for money, OTPs, PINs or bank details. If a caller asks for these, it is not Saathi.',
      'To stop the calls, say "stop calling me" on any call, or tell your family.',
      'Saathi is not an emergency service. In an emergency, call 112.'
    ],
    support: phone => `You can also call ${phone}.`,
    intro: '{parent}, a helper called Saathi will call you around {time} about your medicines. It is from me. Saathi will never ask for money, OTPs or bank details. Please pick up, and tell it if you need anything. — {family}'
  },
  hi: {
    label: 'हिन्दी',
    title: 'Saathi के बारे में',
    lines: [
      'Saathi, Aaptha का एक AI आवाज़ सहायक है। आपके परिवार ने इसे आपकी दवाइयों के बारे में फ़ोन करने के लिए लगाया है।',
      'आप Saathi को जो बताते हैं, जैसे दवा ली या नहीं, आप कैसा महसूस कर रहे हैं, या कोई संदेश, वह Aaptha पर आपके परिवार को दिखाया जाता है।',
      'हर कॉल का एक छोटा लिखित सार रखा जाता है। पूरी बातचीत का लिखा हुआ रूप 90 दिन बाद हटा दिया जाता है।',
      'Saathi कभी पैसे, OTP, PIN या बैंक की जानकारी नहीं माँगेगा। अगर कोई कॉल करने वाला यह माँगे, तो वह Saathi नहीं है।',
      'कॉल बंद करवाने के लिए किसी भी कॉल पर कहिए "मुझे कॉल मत करो", या अपने परिवार को बताइए।',
      'Saathi आपातकालीन सेवा नहीं है। आपात स्थिति में 112 पर कॉल करें।'
    ],
    support: phone => `आप ${phone} पर भी कॉल कर सकते हैं।`,
    intro: '{parent}, Saathi नाम का एक सहायक आपको लगभग {time} पर आपकी दवाइयों के बारे में फ़ोन करेगा। यह मेरी तरफ़ से है। Saathi कभी पैसे, OTP या बैंक की जानकारी नहीं माँगेगा। कृपया फ़ोन उठाइए, और कुछ चाहिए तो उसे बता दीजिए। — {family}'
  },
  te: {
    label: 'తెలుగు',
    title: 'Saathi గురించి',
    lines: [
      'Saathi అనేది Aaptha నుండి ఒక AI వాయిస్ సహాయకుడు. మీ మందుల గురించి మీకు ఫోన్ చేయడానికి మీ కుటుంబం దీన్ని ఏర్పాటు చేసింది.',
      'మీరు Saathi కి చెప్పేవి — మందులు వేసుకున్నారా లేదా, మీరు ఎలా ఉన్నారు, మీరు చెప్పమన్న విషయాలు — Aaptha లో మీ కుటుంబానికి కనిపిస్తాయి.',
      'ప్రతి కాల్ యొక్క చిన్న రాతపూర్వక సారాంశం ఉంచబడుతుంది. పూర్తి సంభాషణ పాఠం 90 రోజుల తర్వాత తొలగించబడుతుంది.',
      'Saathi ఎప్పుడూ డబ్బు, OTP, PIN లేదా బ్యాంక్ వివరాలు అడగదు. ఎవరైనా కాల్ చేసి ఇవి అడిగితే, అది Saathi కాదు.',
      'కాల్స్ ఆపాలంటే, ఏ కాల్‌లోనైనా "నాకు కాల్ చేయొద్దు" అని చెప్పండి, లేదా మీ కుటుంబానికి చెప్పండి.',
      'Saathi అత్యవసర సేవ కాదు. అత్యవసర పరిస్థితిలో 112 కి కాల్ చేయండి.'
    ],
    support: phone => `మీరు ${phone} కి కూడా కాల్ చేయవచ్చు.`,
    intro: '{parent}, Saathi అనే సహాయకుడు సుమారు {time} కి మీ మందుల గురించి మీకు ఫోన్ చేస్తుంది. ఇది నా తరఫునుండే. Saathi ఎప్పుడూ డబ్బు, OTP లేదా బ్యాంక్ వివరాలు అడగదు. దయచేసి ఫోన్ ఎత్తండి, ఏదైనా కావాలంటే చెప్పండి. — {family}'
  },
  ta: {
    label: 'தமிழ்',
    title: 'Saathi பற்றி',
    lines: [
      'Saathi என்பது Aaptha-வின் ஒரு AI குரல் உதவியாளர். உங்கள் மருந்துகள் பற்றி உங்களை அழைக்க உங்கள் குடும்பத்தினர் இதை அமைத்துள்ளனர்.',
      'நீங்கள் Saathi-யிடம் சொல்வது — மருந்து எடுத்தீர்களா, நீங்கள் எப்படி உணர்கிறீர்கள், நீங்கள் சொல்லச் சொன்ன செய்திகள் — Aaptha-வில் உங்கள் குடும்பத்தினருக்குக் காட்டப்படும்.',
      'ஒவ்வொரு அழைப்பின் சிறிய எழுத்துச் சுருக்கம் வைக்கப்படும். முழு உரையாடலின் எழுத்து வடிவம் 90 நாட்களுக்குப் பிறகு நீக்கப்படும்.',
      'Saathi ஒருபோதும் பணம், OTP, PIN அல்லது வங்கி விவரங்களைக் கேட்காது. யாராவது அழைத்து இவற்றைக் கேட்டால், அது Saathi அல்ல.',
      'அழைப்புகளை நிறுத்த, எந்த அழைப்பிலும் "என்னை அழைக்க வேண்டாம்" என்று சொல்லுங்கள், அல்லது உங்கள் குடும்பத்தினரிடம் சொல்லுங்கள்.',
      'Saathi அவசர சேவை அல்ல. அவசர நிலையில் 112-ஐ அழைக்கவும்.'
    ],
    support: phone => `நீங்கள் ${phone} என்ற எண்ணையும் அழைக்கலாம்.`,
    intro: '{parent}, Saathi என்ற உதவியாளர் சுமார் {time} மணிக்கு உங்கள் மருந்துகள் பற்றி உங்களை அழைக்கும். இது என் சார்பாக. Saathi ஒருபோதும் பணம், OTP அல்லது வங்கி விவரங்களைக் கேட்காது. தயவுசெய்து போனை எடுங்கள், ஏதாவது வேண்டுமென்றால் சொல்லுங்கள். — {family}'
  },
  kn: {
    label: 'ಕನ್ನಡ',
    title: 'Saathi ಬಗ್ಗೆ',
    lines: [
      'Saathi ಎಂಬುದು Aaptha ದಿಂದ ಒಂದು AI ಧ್ವನಿ ಸಹಾಯಕ. ನಿಮ್ಮ ಔಷಧಿಗಳ ಬಗ್ಗೆ ನಿಮಗೆ ಕರೆ ಮಾಡಲು ನಿಮ್ಮ ಕುಟುಂಬದವರು ಇದನ್ನು ಹೊಂದಿಸಿದ್ದಾರೆ.',
      'ನೀವು Saathi ಗೆ ಹೇಳುವುದು — ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿರಾ, ನೀವು ಹೇಗಿದ್ದೀರಿ, ನೀವು ತಿಳಿಸಲು ಹೇಳಿದ ವಿಷಯಗಳು — Aaptha ನಲ್ಲಿ ನಿಮ್ಮ ಕುಟುಂಬಕ್ಕೆ ಕಾಣಿಸುತ್ತದೆ.',
      'ಪ್ರತಿ ಕರೆಯ ಚಿಕ್ಕ ಬರಹದ ಸಾರಾಂಶವನ್ನು ಇಡಲಾಗುತ್ತದೆ. ಪೂರ್ಣ ಸಂಭಾಷಣೆಯ ಬರಹವನ್ನು 90 ದಿನಗಳ ನಂತರ ಅಳಿಸಲಾಗುತ್ತದೆ.',
      'Saathi ಎಂದಿಗೂ ಹಣ, OTP, PIN ಅಥವಾ ಬ್ಯಾಂಕ್ ವಿವರಗಳನ್ನು ಕೇಳುವುದಿಲ್ಲ. ಯಾರಾದರೂ ಕರೆ ಮಾಡಿ ಇವುಗಳನ್ನು ಕೇಳಿದರೆ, ಅದು Saathi ಅಲ್ಲ.',
      'ಕರೆಗಳನ್ನು ನಿಲ್ಲಿಸಲು, ಯಾವುದೇ ಕರೆಯಲ್ಲಿ "ನನಗೆ ಕರೆ ಮಾಡಬೇಡಿ" ಎಂದು ಹೇಳಿ, ಅಥವಾ ನಿಮ್ಮ ಕುಟುಂಬಕ್ಕೆ ತಿಳಿಸಿ.',
      'Saathi ತುರ್ತು ಸೇವೆ ಅಲ್ಲ. ತುರ್ತು ಪರಿಸ್ಥಿತಿಯಲ್ಲಿ 112 ಗೆ ಕರೆ ಮಾಡಿ.'
    ],
    support: phone => `ನೀವು ${phone} ಗೆ ಸಹ ಕರೆ ಮಾಡಬಹುದು.`,
    intro: '{parent}, Saathi ಎಂಬ ಸಹಾಯಕ ಸುಮಾರು {time} ಕ್ಕೆ ನಿಮ್ಮ ಔಷಧಿಗಳ ಬಗ್ಗೆ ನಿಮಗೆ ಕರೆ ಮಾಡುತ್ತದೆ. ಇದು ನನ್ನ ಕಡೆಯಿಂದ. Saathi ಎಂದಿಗೂ ಹಣ, OTP ಅಥವಾ ಬ್ಯಾಂಕ್ ವಿವರಗಳನ್ನು ಕೇಳುವುದಿಲ್ಲ. ದಯವಿಟ್ಟು ಫೋನ್ ಎತ್ತಿ, ಏನಾದರೂ ಬೇಕಿದ್ದರೆ ಹೇಳಿ. — {family}'
  },
  ml: {
    label: 'മലയാളം',
    title: 'Saathi-യെ കുറിച്ച്',
    lines: [
      'Saathi, Aaptha-യുടെ ഒരു AI ശബ്ദ സഹായിയാണ്. നിങ്ങളുടെ മരുന്നുകളെക്കുറിച്ച് നിങ്ങളെ വിളിക്കാൻ നിങ്ങളുടെ കുടുംബം ഇത് ഏർപ്പാടാക്കിയതാണ്.',
      'നിങ്ങൾ Saathi-യോട് പറയുന്നത് — മരുന്ന് കഴിച്ചോ, നിങ്ങൾക്ക് എങ്ങനെയുണ്ട്, നിങ്ങൾ അറിയിക്കാൻ പറഞ്ഞ കാര്യങ്ങൾ — Aaptha-യിൽ നിങ്ങളുടെ കുടുംബത്തിന് കാണാം.',
      'ഓരോ കോളിന്റെയും ചെറിയ എഴുത്ത് സംഗ്രഹം സൂക്ഷിക്കും. മുഴുവൻ സംഭാഷണത്തിന്റെ എഴുത്ത് 90 ദിവസത്തിന് ശേഷം നീക്കം ചെയ്യും.',
      'Saathi ഒരിക്കലും പണം, OTP, PIN അല്ലെങ്കിൽ ബാങ്ക് വിവരങ്ങൾ ചോദിക്കില്ല. ആരെങ്കിലും വിളിച്ച് ഇവ ചോദിച്ചാൽ, അത് Saathi അല്ല.',
      'കോളുകൾ നിർത്താൻ, ഏത് കോളിലും "എന്നെ വിളിക്കേണ്ട" എന്ന് പറയുക, അല്ലെങ്കിൽ നിങ്ങളുടെ കുടുംബത്തോട് പറയുക.',
      'Saathi ഒരു അടിയന്തര സേവനമല്ല. അടിയന്തര സാഹചര്യത്തിൽ 112-ൽ വിളിക്കുക.'
    ],
    support: phone => `നിങ്ങൾക്ക് ${phone} എന്ന നമ്പറിലും വിളിക്കാം.`,
    intro: '{parent}, Saathi എന്ന ഒരു സഹായി ഏകദേശം {time}-ന് നിങ്ങളുടെ മരുന്നുകളെക്കുറിച്ച് നിങ്ങളെ വിളിക്കും. ഇത് എന്റെ ഭാഗത്ത് നിന്നാണ്. Saathi ഒരിക്കലും പണം, OTP അല്ലെങ്കിൽ ബാങ്ക് വിവരങ്ങൾ ചോദിക്കില്ല. ദയവായി ഫോൺ എടുക്കുക, എന്തെങ്കിലും വേണമെങ്കിൽ പറയുക. — {family}'
  },
  bn: {
    label: 'বাংলা',
    title: 'Saathi সম্পর্কে',
    lines: [
      'Saathi হলো Aaptha-র একটি AI ভয়েস সহকারী। আপনার ওষুধের ব্যাপারে আপনাকে ফোন করার জন্য আপনার পরিবার এটি চালু করেছে।',
      'আপনি Saathi-কে যা বলেন — ওষুধ খেয়েছেন কিনা, কেমন আছেন, বা যা জানাতে বলেন — তা Aaptha-তে আপনার পরিবার দেখতে পায়।',
      'প্রতিটি কলের একটি ছোট লিখিত সারাংশ রাখা হয়। পুরো কথোপকথনের লেখা ৯০ দিন পরে মুছে ফেলা হয়।',
      'Saathi কখনো টাকা, OTP, PIN বা ব্যাংকের তথ্য চাইবে না। কেউ ফোন করে এগুলো চাইলে, সেটা Saathi নয়।',
      'কল বন্ধ করতে, যেকোনো কলে বলুন "আমাকে আর ফোন কোরো না", অথবা আপনার পরিবারকে জানান।',
      'Saathi জরুরি পরিষেবা নয়। জরুরি অবস্থায় 112-এ ফোন করুন।'
    ],
    support: phone => `আপনি ${phone} নম্বরেও ফোন করতে পারেন।`,
    intro: '{parent}, Saathi নামে একজন সহকারী মোটামুটি {time}-এ আপনার ওষুধের ব্যাপারে আপনাকে ফোন করবে। এটা আমার তরফ থেকে। Saathi কখনো টাকা, OTP বা ব্যাংকের তথ্য চাইবে না। দয়া করে ফোনটা ধরবেন, কিছু দরকার হলে বলবেন। — {family}'
  },
  mr: {
    label: 'मराठी',
    title: 'Saathi बद्दल',
    lines: [
      'Saathi हा Aaptha चा एक AI आवाज सहाय्यक आहे. तुमच्या औषधांबद्दल तुम्हाला फोन करण्यासाठी तुमच्या कुटुंबाने तो सुरू केला आहे.',
      'तुम्ही Saathi ला जे सांगता — औषध घेतले का, तुम्हाला कसे वाटते, किंवा तुम्ही सांगायला सांगितलेले निरोप — ते Aaptha वर तुमच्या कुटुंबाला दिसते.',
      'प्रत्येक कॉलचा एक छोटा लेखी सारांश ठेवला जातो. संपूर्ण संभाषणाचा लेखी मजकूर 90 दिवसांनंतर हटवला जातो.',
      'Saathi कधीही पैसे, OTP, PIN किंवा बँकेची माहिती मागणार नाही. कोणी फोन करून हे मागितले, तर तो Saathi नाही.',
      'कॉल थांबवण्यासाठी, कोणत्याही कॉलवर "मला फोन करू नका" असे सांगा, किंवा तुमच्या कुटुंबाला सांगा.',
      'Saathi ही आपत्कालीन सेवा नाही. आपत्कालीन परिस्थितीत 112 वर फोन करा.'
    ],
    support: phone => `तुम्ही ${phone} वरही फोन करू शकता.`,
    intro: '{parent}, Saathi नावाचा एक सहाय्यक साधारण {time} वाजता तुमच्या औषधांबद्दल तुम्हाला फोन करेल. हे माझ्याकडून आहे. Saathi कधीही पैसे, OTP किंवा बँकेची माहिती मागणार नाही. कृपया फोन उचला, आणि काही हवे असेल तर सांगा. — {family}'
  },
  gu: {
    label: 'ગુજરાતી',
    title: 'Saathi વિશે',
    lines: [
      'Saathi એ Aaptha નો એક AI અવાજ સહાયક છે. તમારી દવાઓ વિશે તમને ફોન કરવા માટે તમારા પરિવારે તેને ગોઠવ્યો છે.',
      'તમે Saathi ને જે કહો છો — દવા લીધી કે નહીં, તમને કેવું લાગે છે, અથવા તમે જણાવવાનું કહેલા સંદેશા — તે Aaptha પર તમારા પરિવારને દેખાય છે.',
      'દરેક કોલનો એક નાનો લેખિત સારાંશ રાખવામાં આવે છે. આખી વાતચીતનું લખાણ 90 દિવસ પછી કાઢી નાખવામાં આવે છે.',
      'Saathi ક્યારેય પૈસા, OTP, PIN કે બેંકની વિગતો માંગશે નહીં. જો કોઈ ફોન કરીને આ માંગે, તો તે Saathi નથી.',
      'કોલ બંધ કરાવવા માટે, કોઈપણ કોલ પર કહો "મને ફોન ન કરો", અથવા તમારા પરિવારને કહો.',
      'Saathi કટોકટી સેવા નથી. કટોકટીમાં 112 પર ફોન કરો.'
    ],
    support: phone => `તમે ${phone} પર પણ ફોન કરી શકો છો.`,
    intro: '{parent}, Saathi નામનો એક સહાયક લગભગ {time} વાગ્યે તમારી દવાઓ વિશે તમને ફોન કરશે. આ મારા તરફથી છે. Saathi ક્યારેય પૈસા, OTP કે બેંકની વિગતો માંગશે નહીં. કૃપા કરીને ફોન ઉપાડજો, અને કંઈ જોઈએ તો કહેજો. — {family}'
  }
};

/** "08:30 AM" -> "8:30 AM" */
function friendlyTime(time: string): string {
  return time.replace(/^0(\d)/, '$1');
}

export function introScript(lang: NoticeLang, v: { parentName: string; time: string; familyName: string }): string {
  return NOTICES[lang].intro
    .replace('{parent}', v.parentName)
    .replace('{time}', friendlyTime(v.time))
    .replace('{family}', v.familyName);
}
