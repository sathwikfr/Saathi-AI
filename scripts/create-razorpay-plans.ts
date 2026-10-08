/**
 * Creates the Aaptha monthly plans in Razorpay at the prices in src/lib/plans.ts.
 *
 *   npx tsx scripts/create-razorpay-plans.ts             dry run: shows what would be created
 *   npx tsx scripts/create-razorpay-plans.ts --confirm   creates the plans
 *
 * Needs REAL keys in .env.local (or .env): RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. Test-mode keys (rzp_test_…)
 * create test-mode plans; live keys (rzp_live_…) create live plans. Do both: test first, then live.
 *
 * Razorpay plans are IMMUTABLE (amount can't be edited), so a price change needs a new plan.
 * This script never overwrites anything: if a plan with the same name and amount already exists
 * it is reused. It prints the ids to put in .env.local; it does not write any file itself.
 */
import { config } from 'dotenv';

// Same order as Next.js: .env.local wins over .env.
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
import { PLANS, PAID_PLAN_IDS } from '../src/lib/plans';

const PLACEHOLDER = /demo|CareCircle|xxxx|your_/i;

interface RzpPlan {
  id: string;
  item: { name: string; amount: number; currency: string };
  period: string;
  interval: number;
  notes?: Record<string, string>;
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

  if (!keyId || !keySecret || PLACEHOLDER.test(keyId) || PLACEHOLDER.test(keySecret)) {
    console.error(
      'Real Razorpay keys are not set. Put your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env\n' +
        '(Razorpay Dashboard → Account & Settings → API Keys), then run this again.'
    );
    process.exit(1);
  }
  const mode = keyId.startsWith('rzp_live_') ? 'LIVE' : keyId.startsWith('rzp_test_') ? 'TEST' : 'UNKNOWN';
  console.log(`Razorpay mode: ${mode}${confirm ? '' : '   (dry run: nothing will be created)'}\n`);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Razorpay = require('razorpay');
  const client = new Razorpay({ key_id: keyId, key_secret: keySecret });

  const existing: RzpPlan[] = [];
  for (let skip = 0; ; skip += 100) {
    const page = await client.plans.all({ count: 100, skip });
    const items: RzpPlan[] = page.items || [];
    existing.push(...items);
    if (items.length < 100) break;
  }

  const results: Record<string, string> = {};
  for (const plan of PAID_PLAN_IDS.map(id => PLANS[id])) {
    const amountPaise = plan.priceMonthly * 100;
    const name = `Aaptha ${plan.name} (monthly)`;
    const found = existing.find(
      p => p.item.name === name && p.item.amount === amountPaise && p.item.currency === 'INR' && p.period === 'monthly' && p.interval === 1
    );

    if (found) {
      console.log(`✓ ${plan.name}: already exists at ₹${plan.priceMonthly}/month → ${found.id}`);
      results[plan.id] = found.id;
      continue;
    }
    if (!confirm) {
      console.log(`• ${plan.name}: would create ₹${plan.priceMonthly}/month (${amountPaise} paise)`);
      continue;
    }
    const created: RzpPlan = await client.plans.create({
      period: 'monthly',
      interval: 1,
      item: {
        name,
        amount: amountPaise,
        currency: 'INR',
        description: `${plan.tagline}. Up to ${plan.parentsIncluded} ${plan.parentsIncluded === 1 ? 'parent' : 'parents'}, up to ${plan.callsPerDay} calls a day each.`
      },
      notes: { carecircle_plan_id: plan.id }
    });
    console.log(`+ ${plan.name}: created ₹${plan.priceMonthly}/month → ${created.id}`);
    results[plan.id] = created.id;
  }

  if (results.solo || results.family || results.extended) {
    console.log('\nAdd these to .env (and to your hosting environment):');
    if (results.essential) console.log(`RAZORPAY_PLAN_ID_ESSENTIAL=${results.essential}`);
    if (results.solo) console.log(`RAZORPAY_PLAN_ID_SOLO=${results.solo}`);
    if (results.family) console.log(`RAZORPAY_PLAN_ID_FAMILY=${results.family}`);
    if (results.extended) console.log(`RAZORPAY_PLAN_ID_EXTENDED=${results.extended}`);
  }
  if (!confirm) console.log('\nRun again with --confirm to create the missing plans.');
}

main().catch(err => {
  // Razorpay errors carry the reason in err.error.description (or a bare string in err.error); never print the keys.
  if (err?.statusCode === 401) {
    console.error(
      'Failed: Razorpay answered 401 Unauthorized on the plans API.\n' +
        'If `npm run check:setup` says the keys are accepted, Subscriptions is not enabled on this Razorpay account:\n' +
        'ask Razorpay support to enable it (dashboard and API). Otherwise regenerate the API keys.'
    );
    process.exit(1);
  }
  const reason =
    err?.error?.description || (typeof err?.error === 'string' ? err.error : '') || err?.message || JSON.stringify(err);
  console.error(`Failed${err?.statusCode ? ` (${err.statusCode})` : ''}:`, reason);
  process.exit(1);
});
