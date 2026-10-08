# Running the tests safely (a separate test database)

The test suites in `scripts/test-*.ts` create **throwaway rows** (accounts like `reminder-test-…@example.com`), run the real code
against them with a fake Sarvam / Meta / email, and delete them again. Until you set up a test database they do this in the
**live** database. They are scoped to their own rows, but once real customers exist that is not a risk worth taking.

## One-time setup (about 10 minutes, free)

1. **Create a second Supabase project** (supabase.com → New project; the free plan is enough). Call it `aaptha-test`.
   Pick the same region as the live one. Wait until it is ready.
2. In that project: **Project Settings → Database → Connection string**. Copy the *Transaction pooler* string and the
   *Direct connection* string (the same two kinds you used for the live project).
3. Put them in `.env.local` (this file is never committed):

   ```
   TEST_DATABASE_URL=<the pooler string of aaptha-test>
   TEST_DIRECT_URL=<the direct string of aaptha-test>
   ```

   They must be a different project from `DATABASE_URL`: the suites and the setup script refuse to run if they match.
4. Create the tables there (the test database is empty, so this is safe):

   ```
   npx tsx scripts/setup-test-db.ts            # dry run: shows which database it will use
   npx tsx scripts/setup-test-db.ts --confirm  # creates the tables
   ```
5. Run any suite as before, for example `npx tsx scripts/test-call-placement.ts`. The first line it prints is
   `[tests] using the TEST database`. Without `TEST_DATABASE_URL` it prints a warning that it is using the live database.

## After a schema change

Run `npx tsx scripts/setup-test-db.ts --confirm` again so the test database has the new columns / tables (the live database
is changed separately, with reviewed additive SQL and a backup, as always).

## The suites

| Suite | What it covers |
|---|---|
| `test-call-placement.ts` | where the health questions go, "later" rules, add-ons, plan change credit, admin call length |
| `test-whatsapp-reminders.ts` | the Remind plan end to end, translations, tablets, appointments, weekly progress |
| `test-whatsapp.ts` | WhatsApp updates to the family |
| `test-call-pipeline.ts` | the Sarvam call pipeline (dispatch, webhook, retries, alerts) |
| `test-care-features.ts`, `test-care-extras.ts` | the v1 / v1.1 care features |
| `test-billing-emails.ts` | billing and lifecycle emails |
| `test-security-fixes.ts` | the security regression checks (no database) |
| `test-ask-usage.ts` | the durable "Ask about your parent" counters |
