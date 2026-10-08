/**
 * Closes Supabase's public REST door to the app's tables.
 *
 * Supabase serves the `public` schema over its REST API (PostgREST) to anyone holding the project's
 * anon key, which Supabase treats as a public value. Found 2026-10-05: every table had Row Level Security
 * off and the `anon` / `authenticated` roles had SELECT, INSERT, UPDATE and DELETE on all of them
 * (users, password hashes, sessions, parents, medicines, call transcripts). The app never uses those
 * roles: Prisma connects as `postgres`, which has BYPASSRLS, and the vault uses the service role.
 *
 * What it does (no data is read, changed or deleted):
 *   1. ENABLE ROW LEVEL SECURITY on every table in `public` (no policies = anon/authenticated see nothing)
 *   2. REVOKE ALL on tables, sequences and functions in `public` from anon and authenticated
 *   3. ALTER DEFAULT PRIVILEGES so tables `prisma db push` creates later aren't granted to them either
 *      (new tables still need step 1 run again: re-run this script after any schema change)
 *
 * Usage:  npx tsx scripts/lock-down-database.ts            (dry run: prints the current state + the SQL)
 *         npx tsx scripts/lock-down-database.ts --confirm  (applies it in one transaction, then re-checks)
 * Undo (not recommended): ALTER TABLE ... DISABLE ROW LEVEL SECURITY; GRANT ... TO anon, authenticated.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ quiet: true });
import { prisma } from '../src/lib/prisma';

type TableState = { table: string; rls: boolean; anon_select: boolean; anon_write: boolean };

async function state(): Promise<TableState[]> {
  return prisma.$queryRawUnsafe<TableState[]>(`
    SELECT c.relname AS table,
           c.relrowsecurity AS rls,
           has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
           (has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE')
             OR has_table_privilege('anon', c.oid, 'DELETE')) AS anon_write
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY 1`);
}

function sqlFor(tables: string[]): string[] {
  return [
    ...tables.map(t => `ALTER TABLE public."${t.replace(/"/g, '""')}" ENABLE ROW LEVEL SECURITY`),
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated`
  ];
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const [{ current_user, bypass }] = await prisma.$queryRawUnsafe<{ current_user: string; bypass: boolean }[]>(
    `SELECT current_user, (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) AS bypass`
  );
  console.log(`Connected as ${current_user} (bypasses RLS: ${bypass})`);
  if (!bypass) {
    console.error('The app role does not bypass RLS: enabling RLS would lock the app out. Stopping.');
    process.exit(1);
  }

  const before = await state();
  const open = before.filter(t => !t.rls || t.anon_select || t.anon_write);
  console.log(`${before.length} tables in public; ${open.length} reachable or without RLS:`);
  console.table(open);
  const statements = sqlFor(before.map(t => t.table));

  if (!confirm) {
    console.log('\nDry run. This SQL would run in one transaction:\n');
    console.log(statements.map(s => s + ';').join('\n'));
    console.log('\nRe-run with --confirm to apply.');
    return;
  }

  await prisma.$transaction(statements.map(s => prisma.$executeRawUnsafe(s)));
  const after = await state();
  const stillOpen = after.filter(t => !t.rls || t.anon_select || t.anon_write);
  console.log(stillOpen.length === 0 ? `Done: all ${after.length} tables have RLS on and no anon access.` : 'Still open:');
  if (stillOpen.length) console.table(stillOpen);

  // The app must still work through Prisma.
  const users = await prisma.user.count();
  console.log(`Sanity check through Prisma: User table readable (${users} rows).`);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
