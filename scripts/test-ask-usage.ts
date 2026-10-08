/**
 * The Ask-question counters (2026-10-08): `npx tsx scripts/test-ask-usage.ts`
 * Pure key logic + the real database (throwaway keys starting with `test-ask-`, deleted at the end).
 */
import 'dotenv/config';
import './lib/testDb';
import { prisma } from '../src/lib/prisma';
import { claimAsk, releaseAsk, askUsed, monthKey, dayKey } from '../src/lib/askUsage';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail !== undefined ? '  →  ' + JSON.stringify(detail) : ''}`);
  }
}

async function main() {
  console.log('\nA. Keys (IST calendar month and day)');
  check('month key', monthKey('usr_1', new Date('2026-10-08T05:00:00Z')) === 'month:usr_1:2026-10');
  check('a month ends at midnight IST, not UTC', monthKey('usr_1', new Date('2026-10-31T19:00:00Z')) === 'month:usr_1:2026-11' && monthKey('usr_1', new Date('2026-10-31T17:00:00Z')) === 'month:usr_1:2026-10');
  check('day key', dayKey('usr_2', new Date('2026-10-08T20:00:00Z')) === 'day:usr_2:2026-10-09');

  console.log('\nB. Counting against the database');
  const stamp = Date.now();
  const key = `test-ask-${stamp}`;
  try {
    const first = await claimAsk(key, 3);
    check('first question allowed, 1 used', first.ok && first.used === 1, first);
    await claimAsk(key, 3);
    const third = await claimAsk(key, 3);
    check('third allowed, 3 used', third.ok && third.used === 3, third);
    const fourth = await claimAsk(key, 3);
    check('fourth refused: the allowance is used up', !fourth.ok && (await askUsed(key)) === 3, fourth);
    await releaseAsk(key);
    check('a question the AI could not answer is given back', (await askUsed(key)) === 2 && (await claimAsk(key, 3)).ok);
    const zero = await claimAsk(`${key}-zero`, 0);
    check('an allowance of 0 means none (nothing is recorded)', !zero.ok && (await askUsed(`${key}-zero`)) === 0);

    const race = `${key}-race`;
    const results = await Promise.all(Array.from({ length: 15 }, () => claimAsk(race, 10)));
    check('15 questions at the same moment, allowance 10: exactly 10 get through (no bypass)', results.filter(r => r.ok).length === 10 && (await askUsed(race)) === 10, { ok: results.filter(r => r.ok).length, used: await askUsed(race) });

    await releaseAsk(`${key}-none`);
    check('giving back with nothing recorded never goes below zero', (await askUsed(`${key}-none`)) === 0);
  } finally {
    await prisma.askUsage.deleteMany({ where: { key: { startsWith: 'test-ask-' } } });
    const left = await prisma.askUsage.count({ where: { key: { startsWith: 'test-ask-' } } });
    console.log(`\nCleanup: ${left === 0 ? 'clean' : 'LEFTOVER ROWS!'}`);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error('TEST RUN CRASHED:', err);
  await prisma.askUsage.deleteMany({ where: { key: { startsWith: 'test-ask-' } } }).catch(() => undefined);
  await prisma.$disconnect();
  process.exit(2);
});
