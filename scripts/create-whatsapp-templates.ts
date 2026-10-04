/**
 * Creates the 3 WhatsApp templates the app sends, exactly as WHATSAPP_TEMPLATES in
 * src/lib/whatsapp.ts defines them (same text, placeholders and quick-reply order).
 *
 *   npx tsx scripts/create-whatsapp-templates.ts --waba <WhatsApp Business account id> --app-url https://your-domain
 *   ... add --confirm to actually submit (without it: dry run, prints what would be sent)
 *
 * Templates belong to one WhatsApp Business account (WABA): run it again for the real
 * account when you move off Meta's test number. Uses WHATSAPP_ACCESS_TOKEN from .env.local
 * (needs whatsapp_business_management). Never prints the token. Existing templates with
 * the same name are reported, not overwritten.
 */
import { config } from 'dotenv';
import { WHATSAPP_TEMPLATES, WhatsAppTemplateKind, DEFAULT_WHATSAPP_API_VERSION } from '../src/lib/whatsapp';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const BUTTON_TEXT: Record<string, string> = { ack: "I'll handle it", recall: 'Call again' };
const EMERGENCY_ACK_TEXT = "I'm on it";

const EXAMPLES: Record<WhatsAppTemplateKind, string[]> = {
  call_update: ['Amma', 'Answered the morning call at 09:10 AM. Medicines: Telmisartan taken, Metformin taken. Mood: cheerful.'],
  attention: ['Amma', 'Amma said she has not taken Metformin this evening. Call details: Answered the evening call at 08:05 PM.'],
  emergency: ['Amma', 'During the afternoon call, Amma may have described an emergency: "chest pain".', '+91 98765 43210'],
  handled: ['Amma', 'Ravi (neighbour)'],
  summary: ['weekly', 'Amma', 'Medicines taken on 19 of 21 calls (90%). Mood mostly calm. Mentioned knee pain on Tuesday and Friday.']
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
  buttons.push({ type: 'URL', text: 'Open Aaptha', url: `${appUrl}/dashboard` });
  return {
    name: tpl.name,
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en',
    category: 'UTILITY',
    components: [
      { type: 'BODY', text: tpl.body, example: { body_text: [EXAMPLES[kind]] } },
      { type: 'BUTTONS', buttons }
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
  const have = new Map<string, string>((existing.data || []).map((t: { name: string; status: string }) => [t.name, t.status]));

  for (const kind of Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKind[]) {
    const body = buildTemplate(kind, appUrl);
    if (have.has(body.name)) {
      console.log(`= ${body.name}: already exists (status ${have.get(body.name)}), left unchanged`);
      continue;
    }
    if (!confirm) {
      console.log(`would create ${body.name}:\n${JSON.stringify(body, null, 2)}\n`);
      continue;
    }
    const res = await fetch(base, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.error) {
      console.log(`✗ ${body.name}: ${data.error.code} ${data.error.error_user_msg || data.error.message}`);
    } else {
      console.log(`✓ ${body.name}: submitted, status ${data.status} (id ${data.id})`);
    }
  }
  if (!confirm) console.log('Dry run only. Add --confirm to submit.');
}

main().catch(err => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
