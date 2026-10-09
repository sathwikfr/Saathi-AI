/**
 * Creates the WhatsApp templates the app sends, exactly as WHATSAPP_TEMPLATES in
 * src/lib/whatsapp.ts defines them (same text, placeholders and quick-reply order).
 *
 *   npx tsx scripts/create-whatsapp-templates.ts --waba <WhatsApp Business account id> --app-url https://your-domain
 *   ... add --confirm to actually submit (without it: dry run, prints what would be sent)
 *   ... add --languages hi,te,ta,kn,ml,bn,mr,gu (or "all") to also submit the translations of the three Remind
 *       templates the person reads (medicine check, check-up reminder, weekly progress). DRAFT translations
 *       (src/lib/waTranslations.ts): have a native speaker check them first. Until a translation is approved the
 *       app sends the English template, so nothing is lost.
 *
 * Templates belong to one WhatsApp Business account (WABA): run it again for the real
 * account when you move off Meta's test number. Uses WHATSAPP_ACCESS_TOKEN from .env.local
 * (needs whatsapp_business_management). Never prints the token. Existing templates with
 * the same name are reported, not overwritten.
 */
import { config } from 'dotenv';
import { WHATSAPP_TEMPLATES, WhatsAppTemplateKind, DEFAULT_WHATSAPP_API_VERSION } from '../src/lib/whatsapp';
import { PHRASES, META_LANGUAGE } from '../src/lib/waTranslations';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const BUTTON_TEXT: Record<string, string> = {
  ack: "I'll handle it",
  recall: 'Call again',
  rem_taken: 'Yes, taken',
  rem_not_yet: 'Not yet',
  care_ack: "I'll handle it"
};
const EMERGENCY_ACK_TEXT = "I'm on it";

const EXAMPLES: Record<WhatsAppTemplateKind, string[]> = {
  call_update: ['Amma', 'Answered the morning call at 09:10 AM. Medicines: Telmisartan taken, Metformin taken. Mood: cheerful.'],
  attention: ['Amma', 'Amma said she has not taken Metformin this evening. Call details: Answered the evening call at 08:05 PM.'],
  emergency: ['Amma', 'During the afternoon call, Amma may have described an emergency: "chest pain".', '+91 98765 43210'],
  handled: ['Amma', 'Ravi (neighbour)'],
  summary: ['weekly', 'Amma', 'Medicines taken on 19 of 21 calls (90%). Mood mostly calm. Mentioned knee pain on Tuesday and Friday.'],
  reminder: ['Priya', '8:00 AM', 'Folic acid 5 mg (after food), Iron 1 tablet'],
  caretakerAlert: ['Priya', 'Priya has not confirmed the 8:00 AM medicines (Folic acid, Iron) after 3 reminders. You may want to call Priya on +91 98765 43210.'],
  caretaker: ['Priya', 'Good news: Priya has now confirmed the 8:00 AM medicines (at 9:42 AM).'],
  appointment: ['Priya', 'Tomorrow at 10 AM: scan at Apollo Clinic. Needs an empty stomach.'],
  weekly: ['Priya', 'This week you confirmed 13 of 14 medicine checks. Well done!']
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function buildTemplate(kind: WhatsAppTemplateKind, appUrl: string) {
  const tpl = WHATSAPP_TEMPLATES[kind];
  const buttons: Array<Record<string, string>> = tpl.quickReplies.map(payload => ({
    type: 'QUICK_REPLY',
    text: kind === 'emergency' && payload === 'ack' ? EMERGENCY_ACK_TEXT : BUTTON_TEXT[payload]
  }));
  // Medicine checks go to the person and their caretaker, who may have no Aaptha account: no dashboard link.
  if (kind !== 'reminder' && kind !== 'caretaker' && kind !== 'caretakerAlert') buttons.push({ type: 'URL', text: 'Open Aaptha', url: `${appUrl}/dashboard` });
  return {
    name: tpl.name,
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en',
    category: 'UTILITY',
    components: [
      { type: 'BODY', text: tpl.body, example: { body_text: [EXAMPLES[kind]] } },
      ...(buttons.length ? [{ type: 'BUTTONS', buttons }] : []) // Meta rejects an empty button list (aaptha_caretaker_update has none)
    ]
  };
}

/** The translated version of a template the person reads (null for the others, which stay English). */
function buildTranslation(kind: WhatsAppTemplateKind, lang: keyof typeof PHRASES) {
  const p = PHRASES[lang];
  const tpl = WHATSAPP_TEMPLATES[kind];
  const body = kind === 'reminder' ? p.tplReminder : kind === 'appointment' ? p.tplAppointment : kind === 'weekly' ? p.tplWeekly : null;
  if (!body) return null;
  const buttons = kind === 'reminder' ? [{ type: 'QUICK_REPLY', text: p.tplYes }, { type: 'QUICK_REPLY', text: p.tplNotYet }] : [];
  return {
    name: tpl.name,
    language: META_LANGUAGE[lang],
    category: 'UTILITY',
    components: [
      { type: 'BODY', text: body, example: { body_text: [EXAMPLES[kind]] } },
      ...(buttons.length ? [{ type: 'BUTTONS', buttons }] : [])
    ]
  };
}

async function main() {
  const waba = arg('--waba');
  const appUrl = (arg('--app-url') || '').replace(/\/$/, '');
  const confirm = process.argv.includes('--confirm');
  if (!waba || !/^\d+$/.test(waba) || !/^https:\/\//.test(appUrl)) {
    console.error('Usage: --waba <numeric WABA id> --app-url https://your-domain [--confirm]');
    process.exit(1);
  }
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) {
    console.error('WHATSAPP_ACCESS_TOKEN is not set in .env.local');
    process.exit(1);
  }
  const version = process.env.WHATSAPP_API_VERSION?.trim() || DEFAULT_WHATSAPP_API_VERSION;
  const base = `https://graph.facebook.com/${version}/${waba}/message_templates`;
  const auth = { Authorization: `Bearer ${token}` };

  const existing = await fetch(`${base}?fields=name,status,language&limit=200`, { headers: auth }).then(r => r.json());
  if (existing.error) {
    console.error(`Meta error ${existing.error.code}: ${existing.error.message}`);
    process.exit(1);
  }
  const keyOf = (name: string, language: string) => `${name}|${language}`;
  const have = new Map<string, string>((existing.data || []).map((t: { name: string; status: string; language: string }) => [keyOf(t.name, t.language), t.status]));

  const langArg = arg('--languages');
  const langs = (langArg === 'all' ? Object.keys(PHRASES) : (langArg || '').split(',').map(x => x.trim()).filter(Boolean)) as Array<keyof typeof PHRASES>;
  const unknown = langs.filter(l => !(l in PHRASES));
  if (unknown.length) {
    console.error(`Unknown language(s): ${unknown.join(', ')}. Use: ${Object.keys(PHRASES).join(', ')} or all`);
    process.exit(1);
  }
  const jobs: Array<ReturnType<typeof buildTemplate>> = [];
  for (const kind of Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKind[]) {
    jobs.push(buildTemplate(kind, appUrl));
    for (const lang of langs) {
      const t = buildTranslation(kind, lang);
      if (t) jobs.push(t as ReturnType<typeof buildTemplate>);
    }
  }

  for (const body of jobs) {
    if (have.has(keyOf(body.name, body.language))) {
      console.log(`= ${body.name} (${body.language}): already exists (status ${have.get(keyOf(body.name, body.language))}), left unchanged`);
      continue;
    }
    if (!confirm) {
      console.log(`would create ${body.name} (${body.language}):\n${JSON.stringify(body, null, 2)}\n`);
      continue;
    }
    const res = await fetch(base, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.error) {
      console.log(`✗ ${body.name} (${body.language}): ${data.error.code} ${data.error.error_user_msg || data.error.message}`);
    } else {
      console.log(`✓ ${body.name} (${body.language}): submitted, status ${data.status} (id ${data.id})`);
    }
  }
  if (!confirm) console.log('Dry run only. Add --confirm to submit.');
}

main().catch(err => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
