/**
 * Puts the app's tables into the TEST database (a second, empty Supabase project): `npx tsx scripts/setup-test-db.ts`
 * (dry run) and `--confirm` to apply. It refuses to run unless TEST_DATABASE_URL is set AND differs from the live
 * DATABASE_URL, so it can never push the schema to the live database. See docs/testing.md.
 */
import './lib/testDb';
import { spawnSync } from 'child_process';

const confirm = process.argv.includes('--confirm');
const test = process.env.TEST_DATABASE_URL?.trim();

function host(url: string | undefined) {
  try {
    return new URL(url || '').host;
  } catch {
    return '(not a valid URL)';
  }
}

if (!test) {
  console.error('TEST_DATABASE_URL is not set in .env.local. Create a second Supabase project first (docs/testing.md).');
  process.exit(1);
}
console.log(`Test database: ${host(test)}`);
if (!confirm) {
  console.log('Dry run: nothing changed. Run again with --confirm to create the tables there (prisma db push, on this EMPTY database only).');
  process.exit(0);
}
// testDb.ts already pointed DATABASE_URL / DIRECT_URL at the test database for this process and its children.
const res = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate'], { stdio: 'inherit', shell: true, env: process.env });
process.exit(res.status ?? 1);
