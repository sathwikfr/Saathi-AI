/**
 * Import this FIRST (right after dotenv) in every test suite. It points the suite at the TEST database when
 * TEST_DATABASE_URL is set (a second Supabase project, see docs/testing.md). Without it the suite writes its
 * throwaway rows to whatever DATABASE_URL points at, which today is the live database, so it says so loudly.
 */
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
config({ quiet: true });

const testUrl = process.env.TEST_DATABASE_URL?.trim();
if (testUrl) {
  if (testUrl === process.env.DATABASE_URL || testUrl === process.env.DIRECT_URL) {
    console.error('[tests] TEST_DATABASE_URL is the same as the live database. Create a separate project (docs/testing.md).');
    process.exit(2);
  }
  process.env.DATABASE_URL = testUrl;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL?.trim() || testUrl;
  console.log('[tests] using the TEST database');
} else {
  console.warn('[tests] WARNING: no TEST_DATABASE_URL: this suite writes throwaway rows to the LIVE database (it deletes them again).');
}
