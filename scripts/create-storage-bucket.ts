/**
 * Creates the private Supabase Storage bucket for the health record vault.
 *   npx tsx scripts/create-storage-bucket.ts            (dry run: shows what it would do)
 *   npx tsx scripts/create-storage-bucket.ts --confirm  (creates it; safe to re-run)
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local. Never prints the key.
 */
import { config } from 'dotenv';
import { getStorageConfig, createBucket, MAX_DOCUMENT_BYTES, ALLOWED_DOCUMENT_TYPES } from '../src/lib/storage';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

async function main() {
  const cfg = getStorageConfig();
  if (!cfg) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.');
    process.exit(1);
  }
  console.log(`Bucket "${cfg.bucket}" at ${cfg.url.replace(/\/storage\/v1$/, '')}: private, max ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB, types ${ALLOWED_DOCUMENT_TYPES.join(', ')}`);
  if (!process.argv.includes('--confirm')) {
    console.log('Dry run. Re-run with --confirm to create it.');
    return;
  }
  console.log(`Result: ${await createBucket(cfg)}`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
