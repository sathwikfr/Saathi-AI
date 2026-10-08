/**
 * Launch readiness check: `npm run check:setup` (add `-- --strict` to exit 1 when something is missing).
 *
 * Reads .env.local then .env (the same order Next.js uses: .env.local wins) and reports, per feature, which
 * settings are still missing or still placeholders, and where to get each one. It never prints a secret value.
 * It also checks that the database is reachable and has the call-pipeline columns, and that Razorpay accepts the
 * keys and has Subscriptions enabled (read-only API calls).
 */
import { config } from 'dotenv';
import fs from 'fs';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const PLACEHOLDER = /demo|your_|xxxx|changeme|carecircle2025|plan_x|\+91x{4}|^$/i;

type Check = { name: string; hint: string; valid?: (v: string) => string | null };
interface Group {
  title: string;
  why: string;
  optional?: boolean;
  checks: Check[];
  extra?: (env: NodeJS.ProcessEnv) => string[];
}

const isSet = (v: string | undefined) => !!v && !PLACEHOLDER.test(v);

const GROUPS: Group[] = [
  {
    title: 'Website address & cron',
    why: 'Sarvam and Razorpay call these URLs; the scheduler proves who it is with CRON_SECRET.',
    checks: [
      {
        name: 'NEXT_PUBLIC_APP_URL',
        hint: 'Your public https address, e.g. https://your-domain.com (an ngrok URL works for local call tests)',
        valid: v => (/^https:\/\//.test(v) ? (/localhost|127\.0\.0\.1/.test(v) ? 'still localhost' : null) : 'must start with https:// for production')
      },
      { name: 'CRON_SECRET', hint: 'Any long random string (already generated locally)', valid: v => (v.length >= 24 ? null : 'too short (use 24+ characters)') },
      { name: 'NEXT_PUBLIC_SUPPORT_EMAIL', hint: 'The email shown on the Privacy and Terms pages for requests' }
    ]
  },
  {
    title: 'Email (password resets, alerts, receipts)',
    why: 'Without a verified sender, emails only reach the Resend account owner.',
    checks: [
      { name: 'RESEND_API_KEY', hint: 'Resend dashboard → API Keys' },
      {
        name: 'RESEND_FROM_EMAIL',
        hint: 'An address on a domain you verified in Resend, e.g. Aaptha <no-reply@yourdomain.com>',
        valid: v => (/@resend\.dev/i.test(v) ? 'resend.dev only delivers to your own address' : null)
      }
    ]
  },
  {
    title: 'Prescription reading (Groq)',
    why: 'Reads medicines from a photo of a prescription.',
    checks: [
      { name: 'GROQ_API_KEY', hint: 'console.groq.com → API Keys' },
      { name: 'GROQ_VISION_MODEL', hint: 'A Groq vision model id (already set)' }
    ]
  },
  {
    title: 'Payments (Razorpay)',
    why: 'Takes subscriptions for Solo Care, Family Care and Extended Family.',
    checks: [
      { name: 'RAZORPAY_KEY_ID', hint: 'Razorpay → Account & Settings → API Keys (starts rzp_test_ or rzp_live_)' },
      { name: 'NEXT_PUBLIC_RAZORPAY_KEY_ID', hint: 'The same Key ID again (the browser needs it)' },
      { name: 'RAZORPAY_KEY_SECRET', hint: 'Shown once when you generate the key' },
      { name: 'RAZORPAY_WEBHOOK_SECRET', hint: 'Any random string; paste the same value in Razorpay → Webhooks (generated locally already)' },
      { name: 'RAZORPAY_PLAN_ID_ESSENTIAL', hint: 'Printed by the same script' },
      { name: 'RAZORPAY_PLAN_ID_SOLO', hint: 'Run: npx tsx scripts/create-razorpay-plans.ts --confirm' },
      { name: 'RAZORPAY_PLAN_ID_FAMILY', hint: 'Printed by the same script' },
      { name: 'RAZORPAY_PLAN_ID_EXTENDED', hint: 'Printed by the same script' }
    ],
    extra: env => {
      const notes: string[] = [];
      const a = env.RAZORPAY_KEY_ID;
      const b = env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
      if (isSet(a) && isSet(b) && a !== b) notes.push('RAZORPAY_KEY_ID and NEXT_PUBLIC_RAZORPAY_KEY_ID differ: checkout would fail');
      if (isSet(a)) notes.push(`mode: ${a!.startsWith('rzp_live_') ? 'LIVE (real money)' : a!.startsWith('rzp_test_') ? 'test' : 'unknown key prefix'}`);
      return notes;
    }
  },
  {
    title: 'Saathi voice calls (Sarvam)',
    why: 'Places the daily check-in calls. Calling stays off until all of these are set.',
    checks: [
      { name: 'SARVAM_API_KEY', hint: 'Sarvam dashboard → Settings → API Key' },
      { name: 'SARVAM_ORG_ID', hint: 'In the Sarvam dashboard URL / Settings' },
      { name: 'SARVAM_WORKSPACE_ID', hint: 'In the Sarvam dashboard URL / Settings' },
      { name: 'SARVAM_APP_ID', hint: 'The published Saathi agent (see docs/sarvam-agent.md)' },
      { name: 'SARVAM_CONNECTION_ID', hint: 'Deploy → Phone Numbers → your Sarvam Vobiz connection' },
      { name: 'SARVAM_AGENT_PHONE_NUMBER', hint: 'The number you rented, in +91… format' },
      { name: 'SARVAM_WEBHOOK_SECRET', hint: 'Random string (already generated locally); use it as the agent tool bearer token' }
    ]
  },
  {
    title: 'Emergency phone calls (Sarvam "Aaptha Alert" agent)',
    why: 'Phones you and a nearby contact in an emergency, and neighbours when a parent who lives alone is unreachable. Without it, escalations send WhatsApp/email only.',
    checks: [
      { name: 'SARVAM_ALERT_APP_ID', hint: 'The second agent in docs/sarvam-agent.md §9' },
      { name: 'SARVAM_ALERT_APP_VERSION', hint: 'Its committed version number' }
    ]
  },
  {
    title: 'Family AI and scam check (Claude)',
    why: '"Ask about your parent" and the WhatsApp scam check. Optional: everything else works without it.',
    optional: true,
    checks: [{ name: 'ANTHROPIC_API_KEY', hint: 'platform.claude.com → API keys' }]
  },
  {
    title: 'Health record vault (Supabase Storage)',
    why: 'Private storage for reports, scans and bills. Optional: the vault shows "not switched on" without it.',
    optional: true,
    checks: [
      { name: 'SUPABASE_URL', hint: 'Supabase → Project settings → API → Project URL' },
      { name: 'SUPABASE_SERVICE_ROLE_KEY', hint: 'Supabase → Project settings → API → service_role key (server only, never NEXT_PUBLIC)' }
    ]
  },
  {
    title: 'Scheduler heartbeat',
    why: 'Emails you when the 5-minute cron stops running (no calls, no reminders). Optional, but set it before real families.',
    optional: true,
    checks: [{ name: 'CRON_HEARTBEAT_URL', hint: 'healthchecks.io → new check, period 5 min, grace 15 min → its ping URL', valid: v => (/^https:\/\//.test(v) ? null : 'must start with https://') }]
  },
  {
    title: 'Support phone',
    why: 'A human number parents can call to check Saathi is real or to stop the calls.',
    optional: true,
    checks: [{ name: 'NEXT_PUBLIC_SUPPORT_PHONE', hint: 'Any number a person answers, in +91… format' }]
  },
  {
    title: 'WhatsApp call updates (Meta Cloud API)',
    why: 'Sends families one WhatsApp message per call. Until these are set, call alerts are emailed as before.',
    checks: [
      { name: 'WHATSAPP_ACCESS_TOKEN', hint: 'Meta Business Settings → System users → generate a permanent token (see docs/whatsapp-setup.md)' },
      { name: 'WHATSAPP_PHONE_NUMBER_ID', hint: 'Meta app → WhatsApp → API Setup → Phone number ID (not the phone number itself)' },
      { name: 'WHATSAPP_APP_SECRET', hint: 'Meta app → App settings → Basic → App secret (verifies the webhook)' },
      { name: 'WHATSAPP_VERIFY_TOKEN', hint: 'Any random string you also type into the Meta webhook settings', valid: v => (v.length >= 16 ? null : 'too short (use 16+ characters)') }
    ]
  },
  {
    title: 'Google sign-in',
    why: 'Adds a "Continue with Google" button. Optional: email and password work without it.',
    optional: true,
    checks: [
      { name: 'GOOGLE_CLIENT_ID', hint: 'Google Cloud Console → Credentials → OAuth client (Web)' },
      { name: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', hint: 'The same client id again' }
    ]
  }
];

function readKeys(file: string): Record<string, string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('dotenv').parse(fs.readFileSync(file));
  } catch {
    return {};
  }
}

async function checkDatabase(): Promise<string[]> {
  const lines: string[] = [];
  if (!isSet(process.env.DATABASE_URL) || !isSet(process.env.DIRECT_URL)) {
    return ['✗ DATABASE_URL / DIRECT_URL missing'];
  }
  try {
    const { prisma } = await import('../src/lib/prisma');
    const users = await prisma.user.count();
    lines.push(`✓ database reachable (${users} account${users === 1 ? '' : 's'})`);
    try {
      await prisma.callLog.findFirst({ select: { providerAttemptId: true, nextRetryAt: true, processedAt: true } });
      await prisma.alertRecord.findFirst({ select: { callLogId: true } });
      lines.push('✓ call-pipeline columns exist');
    } catch {
      lines.push('✗ call-pipeline columns are missing: the schema needs the additive update (see CLAUDE.md, never --accept-data-loss)');
    }
    try {
      await prisma.whatsAppMessage.findFirst({ select: { id: true } });
      await prisma.notificationPreferences.findFirst({ select: { whatsappOptInAt: true } });
      await prisma.alertRecord.findFirst({ select: { acknowledgedAt: true } });
      lines.push('✓ WhatsApp tables/columns exist');
    } catch {
      lines.push('✗ WhatsApp tables/columns are missing: apply the additive WhatsApp schema update (see CLAUDE.md, never --accept-data-loss)');
    }
    try {
      await prisma.escalation.findFirst({ select: { id: true } });
      await prisma.healthInsight.findFirst({ select: { id: true } });
      await prisma.healthDocument.findFirst({ select: { id: true } });
      await prisma.parentProfile.findFirst({ select: { parentConsent: true, cardToken: true, companionEnabled: true } });
      lines.push('✓ v1 care tables/columns exist (escalations, insights, vault, consent)');
    } catch {
      lines.push('✗ v1 care tables/columns are missing: apply the reviewed additive SQL (docs/v1-care-plan.md, never --accept-data-loss)');
    }
    await prisma.$disconnect();
  } catch (err) {
    lines.push(`✗ database not reachable: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 120) : 'unknown error'}`);
  }
  return lines;
}

/**
 * Asks Razorpay whether the keys work and whether Subscriptions is switched on for the account.
 * Razorpay answers 401 on /plans and /subscriptions (while /orders works) when the Subscriptions
 * product isn't enabled, which looks like a key problem but isn't one.
 */
async function checkRazorpay(): Promise<string[]> {
  const id = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!isSet(id) || !isSet(secret)) return ['· skipped: keys not set'];
  const auth = 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
  const status = async (path: string) => {
    try {
      return (await fetch(`https://api.razorpay.com/v1${path}`, { headers: { Authorization: auth } })).status;
    } catch {
      return 0;
    }
  };

  const orders = await status('/orders?count=1');
  if (orders === 0) return ['✗ could not reach api.razorpay.com'];
  if (orders === 401) return ['✗ keys rejected: Key ID and Key Secret do not match (regenerate them in Razorpay → API Keys)'];
  const lines = ['✓ keys accepted'];

  const plans = await status('/plans?count=1');
  if (plans !== 200) {
    lines.push(
      `✗ Subscriptions is not enabled on this Razorpay account (plans API answered ${plans}). Checkout cannot work until it is:` +
        ' ask Razorpay support to enable Subscriptions (dashboard and API). Account activation (KYC) may be needed first.'
    );
    return lines;
  }
  lines.push('✓ Subscriptions enabled');

  for (const name of ['RAZORPAY_PLAN_ID_ESSENTIAL', 'RAZORPAY_PLAN_ID_SOLO', 'RAZORPAY_PLAN_ID_FAMILY', 'RAZORPAY_PLAN_ID_EXTENDED']) {
    const planId = process.env[name];
    if (!isSet(planId)) continue;
    const s = await status(`/plans/${encodeURIComponent(planId!)}`);
    lines.push(s === 200 ? `✓ ${name} exists in Razorpay` : `✗ ${name} not found in this Razorpay account/mode (${s})`);
  }
  return lines;
}

async function main() {
  const strict = process.argv.includes('--strict');
  const env = process.env;
  let notReady = 0;

  console.log('Aaptha launch readiness\n');

  const conflicts: string[] = [];
  const local = readKeys('.env.local');
  const base = readKeys('.env');
  for (const k of Object.keys(local)) {
    if (k in base && local[k] !== base[k]) conflicts.push(k);
  }

  for (const g of GROUPS) {
    const problems: string[] = [];
    for (const c of g.checks) {
      const v = env[c.name];
      if (v === undefined || v === '') problems.push(`  ✗ ${c.name}: missing. ${c.hint}`);
      else if (PLACEHOLDER.test(v)) problems.push(`  ✗ ${c.name}: still a placeholder. ${c.hint}`);
      else {
        const why = c.valid?.(v);
        if (why) problems.push(`  ✗ ${c.name}: ${why}`);
      }
    }
    const notes = g.extra ? g.extra(env) : [];
    const ready = problems.length === 0;
    if (!ready && !g.optional) notReady += 1;
    console.log(`${ready ? '✓ READY ' : g.optional ? '○ OPTIONAL' : '✗ NEEDS KEYS'}  ${g.title}`);
    if (!ready) console.log(`  ${g.why}`);
    problems.forEach(p => console.log(p));
    notes.forEach(n => console.log(`  · ${n}`));
    console.log('');
  }

  console.log('Database');
  for (const l of await checkDatabase()) console.log(`  ${l}`);
  console.log('\nRazorpay account');
  for (const l of await checkRazorpay()) console.log(`  ${l}`);
  if (conflicts.length) {
    console.log(`\n⚠ These keys exist in both .env and .env.local with DIFFERENT values; .env.local wins in Next.js:\n  ${conflicts.join(', ')}`);
  }
  console.log('\nKeys can go in .env.local (recommended: Next.js reads it first). On Vercel add the same names under Project → Settings → Environment Variables.');
  console.log(notReady === 0 ? '\nAll required settings are in place.' : `\n${notReady} required group${notReady === 1 ? '' : 's'} still need keys. Nothing else is blocking.`);
  process.exit(strict && notReady > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('check-setup failed:', err instanceof Error ? err.message : err);
  process.exit(2);
});
