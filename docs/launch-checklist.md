# Go-live checklist

The code is finished. What is left is accounts, keys and people. Work down this page in order and tick each box.
Any time, this shows what is still missing (it never prints a secret):

```bash
npm run check:setup
```

Keys go in **`.env.local`** locally (it wins over `.env`) and in **Vercel → Project → Settings → Environment Variables**
in production. `NEXT_PUBLIC_*` values are baked in at build time: **redeploy after changing one**.

## Where things stand (checked 2026-10-23, local, test mode)

| Area | Ready now | Still needed to go live |
|---|---|---|
| App address | ngrok address for local tests | your domain in `NEXT_PUBLIC_APP_URL` |
| Email | Resend key; sender is `resend.dev`, support email is Gmail | verify the domain in Resend, new sender + support email |
| Razorpay | test keys, Subscriptions on, all 7 plans at today's prices | live keys, the same 7 plans in live mode, live webhook |
| Sarvam | Saathi agent v17, Alert agent v2, number rented | paste the current prompts + commit new versions; emergency tool + call-back URLs to the domain |
| WhatsApp | Meta test number, 4 keys set | "Never" token before ~2 Dec 2026, templates (they contain the app link), webhook URL, real number |
| Scheduler | heartbeat (`CRON_HEARTBEAT_URL`) set | cron-job.org job, GitHub workflow off |
| Database | reachable, every table/column present | nothing |
| Optional | Supabase vault, Groq | support phone, business details, separate Sarvam secrets, Claude key, Google sign-in |

## A. Do now (no domain needed)

- [ ] **WhatsApp "Never" token.** The current token expires around **2 Dec 2026**; after that no family gets WhatsApp.
  Meta Business Settings → Users → System users → `saathi-server` → Generate new token → expiry **Never** →
  permissions `whatsapp_business_messaging` + `whatsapp_business_management` → put it in `WHATSAPP_ACCESS_TOKEN`.
  *Check:* the token list in System users shows the new token with "Never" expiry, and `check:setup` still says WhatsApp READY.
- [ ] **New Sarvam versions.** `docs/sarvam-agent.md` changed after v17 (variables are data, never instructions; the
  `medicines_taken` description). Paste §4 + §6 into the Saathi agent and §9 into "Aaptha Alert", **Commit version**
  on each, then set `SARVAM_APP_VERSION` and `SARVAM_ALERT_APP_VERSION` to the new numbers.
  *Check:* one test call from the dashboard to your own phone is answered and shows in Call history.
- [ ] **Separate Sarvam secrets (recommended).** Make three random values, one per key:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  `SARVAM_ESCALATE_SECRET` (the `escalate_emergency` tool's bearer token), `SARVAM_INBOUND_CONTEXT_SECRET` (the call-back
  on-start hook's bearer token), `SARVAM_INBOUND_WEBHOOK_SECRET` (the `?token=` on the call-back webhook URL). Put the same
  value in Sarvam's Secrets for each, then commit a version. *Check:* `check:setup` group "Separate Sarvam secrets" is ✓.
- [ ] **Start Razorpay activation (KYC)** for live mode: it can take days. If it asks for the website, give the domain once
  you have it. The policy pages it looks for exist (`/terms`, `/privacy`, `/refunds`); the footer shows your business
  name, address and phone once the two items below are set, so do those first.
- [ ] **Support phone:** a number a person answers → `NEXT_PUBLIC_SUPPORT_PHONE` (+91…). Parents use it to check Saathi is real.
- [ ] **Business details** for the legal pages: `NEXT_PUBLIC_BUSINESS_NAME`, `NEXT_PUBLIC_BUSINESS_ADDRESS`
  (`NEXT_PUBLIC_GSTIN` only once GST-registered). Nothing shows until they are set.
- [ ] **People:** a native Telugu reader for `docs/telugu-review.md` and `docs/emergency-phrases-review.md`, and a lawyer for
  Privacy, Terms and Refunds (refund, liability, governing law and GST wording are business decisions).

## B. The day you have the domain (in this order)

1. [ ] **Resend:** Domains → add the domain → add the DNS records it shows → wait for "Verified".
   Then `RESEND_FROM_EMAIL=Aaptha <no-reply@yourdomain>` and `NEXT_PUBLIC_SUPPORT_EMAIL=support@yourdomain`
   (that inbox must be read). *Check:* `check:setup` Email is READY and no Gmail note shows.
2. [ ] **Vercel:** Settings → Domains → add the domain, follow its DNS steps. Then Environment Variables:
   - **Copy as they are** (from `.env.local`, or `.env` where noted): `DATABASE_URL`, `DIRECT_URL`, `ADMIN_EMAILS`,
     `CRON_SECRET` (`.env`), `CRON_HEARTBEAT_URL`, `GROQ_API_KEY`, `GROQ_VISION_MODEL`, `RESEND_API_KEY` (`.env.local`; it differs
     from `.env`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SARVAM_API_KEY`, `SARVAM_ORG_ID`, `SARVAM_WORKSPACE_ID`,
     `SARVAM_APP_ID`, `SARVAM_APP_VERSION`, `SARVAM_ALERT_APP_ID`, `SARVAM_ALERT_APP_VERSION`, `SARVAM_CONNECTION_ID`,
     `SARVAM_AGENT_PHONE_NUMBER`, `SARVAM_WEBHOOK_SECRET` (`.env`), the three separate Sarvam secrets from A,
     `WHATSAPP_ACCESS_TOKEN` (the "Never" one), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
     `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPPORT_PHONE`, the business details.
   - **New values for production:** `NEXT_PUBLIC_APP_URL=https://yourdomain` (no slash at the end), the Resend sender and
     support email from step 1, and the live Razorpay values from step 3.
   - **Don't copy:** the eight `RAZORPAY_PLAN_ID_*_TOUCHES` ids (Daily Touches was removed) and the test Razorpay keys.
3. [ ] **Razorpay live:** switch the dashboard to Live → API Keys → generate. In a PowerShell window (the scripts use
   values set in the shell before `.env.local`, so your test keys stay untouched):
   ```powershell
   $env:RAZORPAY_KEY_ID = 'rzp_live_…'; $env:NEXT_PUBLIC_RAZORPAY_KEY_ID = $env:RAZORPAY_KEY_ID; $env:RAZORPAY_KEY_SECRET = '…'
   npx tsx scripts/create-razorpay-plans.ts
   npx tsx scripts/create-razorpay-plans.ts --confirm
   ```
   Close that window afterwards. In Vercel set `RAZORPAY_KEY_ID` and `NEXT_PUBLIC_RAZORPAY_KEY_ID` (both the live key id)
   and `RAZORPAY_KEY_SECRET`.
   Put the 7 printed `RAZORPAY_PLAN_ID_*` values in Vercel. Webhooks → add `https://yourdomain/api/razorpay/webhook`,
   secret = `RAZORPAY_WEBHOOK_SECRET`, events: `subscription.activated`, `subscription.charged`, `subscription.resumed`,
   `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `payment.failed`.
   *Check:* in the same window, also set the 7 new `$env:RAZORPAY_PLAN_ID_…` values and run `npm run check:setup`:
   "mode: LIVE (real money)" and 7 ✓ lines with today's prices (a ✗ "charges ₹…" line means an old plan id).
4. [ ] **Sarvam:** the end-of-call webhook needs nothing (each call sends `NEXT_PUBLIC_APP_URL`). Change the
   `escalate_emergency` tool to `https://yourdomain/api/calls/escalate`, and the call-back deployment (§10) to
   `https://yourdomain/api/calls/inbound-context` and `https://yourdomain/api/calls/sarvam-inbound?token=…`.
   Commit a version on both agents, update both version keys in Vercel.
5. [ ] **Meta:** WhatsApp → Configuration → Webhook: `https://yourdomain/api/whatsapp/webhook`, verify token =
   `WHATSAPP_VERIFY_TOKEN`, subscribe to **messages**. Then submit the templates (they contain the app link):
   ```bash
   npx tsx scripts/create-whatsapp-templates.ts --waba <WABA id> --app-url https://yourdomain
   npx tsx scripts/create-whatsapp-templates.ts --waba <WABA id> --app-url https://yourdomain --languages te --confirm
   ```
   Re-run without `--confirm` to see each template's status; all must be **Utility** and **Approved**. When you move to
   the real number, run it again with that account's WABA id.
6. [ ] **Redeploy** on Vercel, then open `https://yourdomain`, sign in, and check `/admin`.
7. [ ] `npm run check:setup` with production values: only optional groups may be left.
8. [ ] **Who will be called:** `npx tsx scripts/preview-calls.ts` (read-only). Pause or remove anyone who shouldn't get a
   call (your own test parents too).
9. [ ] **Scheduler:** cron-job.org → new job → `https://yourdomain/api/cron/dispatch`, every 5 minutes, method **POST**,
   header `Authorization: Bearer <CRON_SECRET>`, longest timeout, notify on failure. "Test run" → HTTP 200 and
   `"success": true`. `/admin` Scheduler tile turns green ("Just now"); it goes amber after 15 minutes without a run.
   Then GitHub → Actions → **Dispatch Saathi calls** → ··· → **Disable workflow**.
10. [ ] **Live tests** (`docs/sarvam-agent.md` §8, about 15 minutes, your own phone): an answered call with a missed
    medicine, a "chest pain" call (level-4 alert, your phone rings), an unanswered call (retry after 30 minutes).
11. [ ] **One real payment:** check out Solo with your own card, see the receipt email and the invoice in Billing, then
    cancel from Billing.

## C. After going live

- [ ] Merge branch `email-verification` (emailed signup codes) once Resend sends from the domain.
- [ ] After a clean week (a Razorpay checkout, a Google sign-in if used, no `[csp]` lines in the Vercel logs): move the
  report-only directives in `next.config.ts` into the enforced `Content-Security-Policy`.
- [ ] Move every service to the work email with fresh keys.
- [ ] The 10-family pilot: `docs/pilot-kit.md` (free month with `scripts/grant-pilot.ts`, no new features during it).

## Optional any time

- **Ask about your parent + scam check:** `ANTHROPIC_API_KEY` (paid).
- **Google sign-in:** Google Cloud Console → Credentials → OAuth client (Web) → authorised origin `https://yourdomain` →
  `GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (same value). The button appears by itself.
