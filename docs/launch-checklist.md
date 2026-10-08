# Launch checklist

Everything in the code is finished. What is left is **accounts and keys**. Run this any time to see what is missing
(it never prints a secret):

```bash
npm run check:setup
```

Put keys in **`.env.local`** (Next.js reads it before `.env`, so a key in `.env.local` always wins). On Vercel, add the
same names under Project → Settings → Environment Variables.

## 1. Sarvam (start first: KYC takes days)
1. Sign up at Sarvam Voice Agents, complete KYC, **Deploy → Phone Numbers → Add Connection → Rent from Sarvam**, buy a number.
2. Ask Sarvam: price per minute, whether Do-Not-Disturb numbers can receive service calls, whether unanswered calls are billed, whether webhooks are retried.
3. Build the agent with `docs/sarvam-agent.md` (prompt, input/output variables, the `escalate_emergency` tool).
4. Fill `SARVAM_API_KEY`, `SARVAM_ORG_ID`, `SARVAM_WORKSPACE_ID`, `SARVAM_APP_ID`, `SARVAM_APP_VERSION`, `SARVAM_CONNECTION_ID`, `SARVAM_AGENT_PHONE_NUMBER`. (`SARVAM_WEBHOOK_SECRET` is already generated; paste it into the agent tool's bearer token.)
5. Re-check the prices in `src/lib/plans.ts` against Sarvam's quote (the margin table is at the top of that file).

## 2. Razorpay
0. **Subscriptions must be enabled on the account.** If the dashboard's Subscriptions/Plans pages say "Something went wrong"
   and `npm run check:setup` says "Subscriptions is not enabled", ask Razorpay support to enable it (dashboard and API,
   test and live). Until then the plans API answers 401 even with correct keys, and checkout cannot work.
1. **Test mode first.** Dashboard → API Keys → generate. Set `RAZORPAY_KEY_ID`, `NEXT_PUBLIC_RAZORPAY_KEY_ID` (same Key ID) and `RAZORPAY_KEY_SECRET`.
2. Create the plans: `npx tsx scripts/create-razorpay-plans.ts` (preview), then add `--confirm`. Put the three printed ids in `RAZORPAY_PLAN_ID_SOLO` / `RAZORPAY_PLAN_ID_FAMILY` / `RAZORPAY_PLAN_ID_EXTENDED`.
3. Dashboard → Webhooks → add `https://<your-domain>/api/razorpay/webhook`, paste the value of `RAZORPAY_WEBHOOK_SECRET` (already generated), and tick the `subscription.*` and `payment.failed` events.
4. Test a subscription with the test card `4718 6091 0820 4366` (any CVV, any future expiry, OTP of 4-10 digits to succeed).
5. Repeat 1-3 with **Live** keys when you go live. Live and test plan ids are different. GST: prices do not include it; decide whether to add it.

## 3. Email
Resend → Domains → verify a domain you own → set `RESEND_FROM_EMAIL=Aaptha <no-reply@yourdomain>`. Also set `NEXT_PUBLIC_SUPPORT_EMAIL` (shown on the Privacy and Terms pages).

## 3a. WhatsApp call updates (start early: business verification takes days)
Call results and alerts go to families on WhatsApp; email is only for account and billing. Full steps and the exact
template texts are in `docs/whatsapp-setup.md`.
1. (Done 2026-10-01) The WhatsApp tables/columns are in the database.
2. Meta Business portfolio + WhatsApp app; a number not already on WhatsApp; display name "Aaptha"; start business verification.
3. Submit the 3 utility templates (`aaptha_call_result`, `aaptha_call_alert`, `aaptha_call_emergency`) with `scripts/create-whatsapp-templates.ts`; make sure Meta lists them as **Utility**, not Marketing.
4. System-user token → `WHATSAPP_ACCESS_TOKEN` (**the testing token made 2026-10-02 expires after 60 days, ~1 Dec 2026: generate a "Never" token before real families use it**); `WHATSAPP_PHONE_NUMBER_ID`; `WHATSAPP_APP_SECRET`; a random `WHATSAPP_VERIFY_TOKEN`.
5. Webhook `https://<your-domain>/api/whatsapp/webhook`, subscribe to **messages**.

## 4. Deploy (Vercel)
1. Import the GitHub repo. Framework: Next.js. Build command stays `npm run build`.
2. Add every variable from `.env.local` to the Vercel environment. Set `NEXT_PUBLIC_APP_URL` to the real `https://` address.
3. Point your domain at it. Never copy `.env` files into the repository.

## 5. Scheduler (cron-job.org) + heartbeat
Nothing is called and no WhatsApp reminder goes out unless `/api/cron/dispatch` is hit every 5 minutes. GitHub Actions schedules proved unreliable (13 runs in ~3 days), so use cron-job.org (free, true 5-minute interval):
1. cron-job.org → Create cronjob. URL `https://<your-domain>/api/cron/dispatch`, every 5 minutes.
2. Advanced → Request method **POST**, header `Authorization: Bearer <CRON_SECRET>` (the same value as in Vercel). Timeout: the maximum allowed.
3. Notifications: on failure, and when the job is disabled after repeated failures.
4. "Test run" → expect HTTP 200 and `"success": true`.
5. `/admin` → the **Scheduler** tile shows "Just now" in green. It turns amber after 15 minutes without a run, or when a run had a failure, and shows how long the last run took. The route allows 60 s (`maxDuration`, safe on every Vercel plan); if runs get close to that, raise it (Fluid compute allows up to 300).

Heartbeat (emails you when the runs **stop**, which cron-job.org itself can't tell you): healthchecks.io (free) → new check, period 5 minutes, grace 15 minutes → copy its ping URL into `CRON_HEARTBEAT_URL` in Vercel. Every run pings it; a run where any job failed pings `<url>/fail` (immediate email). Test: wait 20 minutes with the cron job paused, expect the "down" email.

The GitHub workflow `.github/workflows/dispatch-calls.yml` can stay as a backup (it skips itself without the `APP_URL` / `CRON_SECRET` repo secrets; two schedulers running together are harmless because every call and reminder is claimed once).

## 6. Optional: Google sign-in
Google Cloud Console → Credentials → OAuth client (Web) → add your domain as an authorised origin → set `GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. The button appears automatically.

## 7. Live test before real families (about 15 minutes, use your own phone)
Follow `docs/sarvam-agent.md` §8: an answered call with a missed medicine, a "chest pain" call (expect a level-4 alert and a critical email), and an unanswered call (expect a retry 30 minutes later and a "couldn't reach" alert after the third miss).

## 8. Legal
The Privacy Policy and Terms pages are written from how the product works. Have a lawyer read them once, especially the refund, liability and governing-law clauses, before you take payments.
