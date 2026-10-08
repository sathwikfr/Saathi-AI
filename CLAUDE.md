@AGENTS.md

# Aaptha — project guide for Claude sessions

> Full audit + bug/security pass + Sarvam call pipeline: 2026-09-30. Calling is fully built and tested against a fake Sarvam;
> **First real calls succeeded 2026-10-01** (local app via ngrok, agent Test-Saathi v4, Telugu): webhook, per-medicine results and alerts all worked. Emergency test also passed (mid-call escalate -> L4 within seconds, no duplicate L4 from the webhook). Still to do: own domain, cron (see `docs/sarvam-agent.md`).
> **Email verification is parked on branch `email-verification` (2026-10-03, pushed; not in `main`):** emailed 6-digit code for signup and for profile email changes. Don't rebuild it and don't merge it until a domain is verified in Resend: with the `onboarding@resend.dev` test sender only the Resend owner gets codes, so nobody could sign up on the live site. The user is choosing the app name and will buy the domain first.
> **v1 care features (2026-10-03/04, branch `v1-care-features`, not merged yet):** emergency escalation ladder (phones family + nearby contacts, "I'm on it", outcomes), the parent's own consent on the first call + "stop calling me", trust set-up (intro script, fixed-number contact card, weekly safety line, remembers the last concern), "later" follow-up calls, the family's "why" per medicine, quiet-stopping and refill checks, sleep/appetite/pain questions, trends vs the parent's own baseline ("health twin"), family circle (invite links, roles), daily/weekly/monthly summaries, timeline + journal, doctor report, emergency card, Ask about Amma + WhatsApp scam check (Claude), weekly companion call, health record vault (Supabase Storage), call-backs, 90-day transcript clean-up, admin engagement metrics. Plan and decisions: `docs/v1-care-plan.md`. Schema applied to the live DB 2026-10-03 (reviewed additive SQL; backup in `D:/sathwik/aaptha-db-backups/`). Before real calls use it: paste the new Saathi prompt + variables and create the "Aaptha Alert" agent (`docs/sarvam-agent.md` §3–6, §9–10), submit the 2 new WhatsApp templates, add the new env keys.
> **v1.1 extras (2026-10-04, same branch, not committed yet at time of writing):** BP/sugar readings by voice (+ chart, limits, level-3 alert), family messages read out by Saathi (and replies), doctor/lab appointment reminders + "how did it go?", one call for a couple sharing a phone, weather note (Open-Meteo), festivals the family ticks + own special/fasting days, sibling bill split via UPI links (Aaptha never holds money), life-stories book, chemist refill list (WhatsApp text the family sends), hearing-friendly mode, paid-helper check. No SMS. Details: `docs/v1-care-plan.md` "v1.1 extras". Schema applied 2026-10-04 (reviewed additive SQL). The new agent variables/prompt must be pasted into Sarvam before live calls use them.
> **Remind plan + plan tiers (2026-10-04/05, same branch, not committed — the user wants to check everything first; don't commit until they say):** **Remind ₹149** (internal plan id stays `essential`; was "Essential"): WhatsApp medicine checks, no calls. At each medicine time "did you take your 8:00 AM medicine: …?" with **Yes, taken / Not yet**; Not yet or no reply -> asked again every 30 min, **3 asks**; still no Yes 30 min later -> missed, level-2 dashboard alert and the **optional caretaker** (husband/parent, opts in with their own START link) gets a WhatsApp to call (**max 2 a day**, template `aaptha_caretaker_alert` with ONE button "I'll handle it" -> marks the alert handled, no reply); late Yes -> caretaker told "taken after all" (`aaptha_caretaker_update`); warning words -> ONE warm message to the person (still mentions 108) + caretaker alert + L4, then quiet for 6 h. **No spam (user, 2026-10-05):** the person may pay for themselves, the caretaker is optional, other messages get NO reply (the old 12-hourly "this number only sends…" note is gone), repeats within a gap get nothing. **Everyday symptoms** (fever, headache, dizziness, vomiting, cough, weakness, "not feeling well", in 9 languages: `safety.scanForSymptoms`; decided 2026-10-05) -> caretaker told at once (at most once per 2 h) + L3; on calls the same scan backs up the agent's `health_concern` (family L3 alert the same day); a calling-plan parent's WhatsApp message is checked for emergencies (L4 + calling ladder) and symptoms (L3 to family) BEFORE the scam check. **Typed answers count like the buttons** (`parseTypedAnswer`: "yes / haan / avunu / done / 👍", "no / nahi / ledu / not yet", 9 languages; whole message or answer + comma, so "no fever" is not an answer) on today's latest open check. **"Pause today"** by message (`parsePauseToday`, 9 languages, 2026-10-05): Remind -> today's open checks `answer: 'paused'` (never missed, no caretaker alert); calling-plan parent -> no more calls today + one L2 alert to the family (`PARENT_PAUSE_TITLE`); both restart at midnight IST (`tomorrowStartIst`, existing `pauseUntil` auto-resume). **Tablets running out** (2026-10-08, `Medicine.tabletsLeft` + `refillNotifiedAt`, applied additively; counted only when set on the dashboard Medicines tab or by the person replying e.g. "Iron 30", `parseTopUp`): each Yes counts down one dose (`tabletsPerDose`, default 1); at <= 3 days left (`REFILL_WARN_DAYS`, `dosesPerDay` from the reminder times) the "Noted" reply carries ONE running-low line, once per refill (no extra message, no template). **Check-up reminders on Remind** (2026-10-08; `appointments.dueWhatsappAppointments`, template `aaptha_appointment_reminder`): the same appointments the family adds on the dashboard (doctor, scan, lab) get one WhatsApp the evening before (from 6 PM IST) and one the morning of (from 7 AM IST), at most 2 per appointment, never after it starts or when cancelled, no "how did it go?" afterwards (no spam). **Weekly progress, opt-in** (`ParentProfile.weeklyProgress/weeklyProgressToCaretaker/weeklyProgressSentAt`, template `aaptha_weekly_progress`, toggles on the Remind dashboard): Sundays from 6 PM IST, "This week you confirmed 13 of 14 medicine checks", only when the week had >= 3 checks; the caretaker line goes out only if switched on AND they opted in. **Messages in the person's language** (`lib/waTranslations.ts`, 8 languages besides English, language picked in the Remind setup wizard and stored in `ParentProfile.language`; `waLang()` = the notice rule: "Hindi & English" -> hi): the medicine check, check-up reminder and weekly progress are Meta template translations (same template names, language codes hi/te/ta/kn/ml/bn/mr/gu), and the person's free-text replies come from `repliesFor(language)`; untranslated replies and everything to the caretaker/family stay English. If Meta says the translation doesn't exist yet (error 132001) the English template is sent instead of nothing. **The translations are DRAFTS: a native speaker must check them before real families use them.** Submit them with `create-whatsapp-templates.ts --languages all --confirm`. The setup wizard also asks "Tablets you have now (optional)". Course end dates, discreet mode, STOP/START for both. **Calling plans:** a missed call is retried **once** (`MAX_CALL_ATTEMPTS = 2`); "How are you feeling today?" (`ask_feeling`) + **one rotating wellbeing question a day** (`wellbeing_topic` sleep/appetite/pain, `callPlanning.wellbeingTopicFor`); WhatsApp updates for **1 / 2 / 5** family members (`plan.whatsappPeople`, `familyNotify.whatsappAllowed`; level-4 alerts reach everyone opted in; numbers abroad default to problems + daily summary); Ask **10 / 20 / 30**; **Family/Extended-only** (`plan.premium`, `lib/planAccess.ts`): the couple call and the timeline. BP/sugar + health trends = the **Health Monitor** add-on and festivals/birthday/weather/helper = the **Daily Touches** add-on (any calling plan, see the add-ons paragraph). **Family messages and life stories were removed on 2026-10-08** (user: messages read out by Saathi can come between a parent and the family; life stories needed the weekly chat, which isn't offered). Safety, hearing mode and **doctor/lab appointment reminders** (since 2026-10-05, `callDispatch.basicFamilyAsks`) are in every calling plan. Code: `lib/reminders.ts`, `lib/planAccess.ts`, `components/dashboard/RemindersPanel.tsx` (+ caretaker card/settings), onboarding Remind mode. Schema applied 2026-10-04 (two reviewed additive SQL files + backups in `D:/sathwik/aaptha-db-backups/`). Before real use: get templates `aaptha_medicine_check` + `aaptha_caretaker_alert` + `aaptha_caretaker_update` + `aaptha_appointment_reminder` + `aaptha_weekly_progress` approved (plus the translations), paste the new Saathi prompt (`ask_feeling`, `wellbeing_topic`), create the ₹149 Razorpay plan. Tests: `npx tsx scripts/test-whatsapp-reminders.ts` (191 checks).
> **Brand rename (2026-10-01): CareCircle → Aaptha.** All user-visible text, emails, legal pages, receipts and docs say Aaptha (Saathi AI keeps its name).
> Internal identifiers deliberately keep the old name so nothing breaks: session cookie `carecircle_session` (renaming signs everyone out),
> Razorpay note keys `carecircle_user_id` / `carecircle_plan_id`, sandbox HMAC seed, process-global cache names `__carecircle_*`, synthetic
> `@carecircle.user` OTP emails, seed account `demo@carecircle.in`, placeholder plan ids, the GitHub repo/folder name and `package.json` name.
> When code and this file disagree, **trust the code** and update this file.

## 1. Rules for working in this repo (read first)

1. **Never run destructive DB operations.** No `prisma migrate reset`, no `prisma db push --accept-data-loss`, no bulk `deleteMany` on user data, and never run `scripts/clear-database.ts` (it wipes every table). There is **no `prisma/migrations` folder**; the schema has been synced with `prisma db push`, so schema changes must be **additive only** (new nullable columns / new tables). Take a Supabase backup and show the user the diff first.
2. **Never touch Groq vision internals** (`src/lib/groqVision.ts`, `src/lib/medicineExtractor.ts`) unless the user explicitly asks. Extraction is always an **editable draft the user confirms**; manual entry stays as the fallback.
3. **Never print secrets.** Read env files only for key *names*. Never commit env files.
4. **Ask before deleting any file.**
5. This is **Next.js 16**: read `node_modules/next/dist/docs/` before framework code. `middleware.ts` is deprecated → **`src/proxy.ts`**.
6. User data is soft-deleted (`ParentProfile.isDeleted`). Never hard-delete parents, call logs, alerts, medicines.
7. Don't reintroduce Twilio or Groq into the calling pipeline (see §9).
8. Every `/api/parents/[id]/*` route must use `requireParentAccess(id, 'view' | 'manage' | 'owner')` (or `requireOwnedParent()` = owner only) from `src/lib/access.ts`; every other private route uses `requireUser()`. Roles: owner (pays), co_manager and viewer (accepted family invites, `lib/familyAccess.ts`). Owner-only: billing, removing the parent, managing the family circle.
9. Never fabricate data shown to families (no fake call logs, demo stats, or sample medicines presented as real).
10. Testing on localhost writes to the **real Supabase DB** unless `TEST_DATABASE_URL` is set (a second Supabase project: `docs/testing.md`, `scripts/setup-test-db.ts`; every suite imports `scripts/lib/testDb.ts` and says which database it uses). Use a throwaway `claude-e2e-*@example.com` account and delete only that account's rows afterwards.

## 2. Product summary

- **Aaptha** (renamed from Aaptha on 2026-10-01): platform for adult children in India to look after elderly parents living apart. Paying customer = the child.
- **Saathi AI**: voice companion that phones the parent on schedule: short medicine-reminder calls (did you take it? yes or no), no small talk, but anything the parent volunteers is passed on; results update the child's dashboard and raise alerts.
- Core loop: call → ask 2–3 questions → record answers → update dashboard → alert if needed. Alert levels 0 (fine) … 4 (emergency).
- Plans (`src/lib/plans.ts`, **re-priced 2026-10-04**; the v1/v1.1 features roughly doubled the cost per called parent to ~₹530-640/month): **Free Trial** ₹0 (7 days from account creation, 1 parent, 1 call/day, then calls stop; can't be restarted), **Remind ₹149** (internal id `essential`; WhatsApp medicine checks only, `channel: 'whatsapp'`, 1 person + 1 caretaker, up to 4 times/day, no calls, no Ask), **Solo ₹899** (lowered from ₹999 on 2026-10-08; 1 parent, 3 calls/day, 1 retry 30 min later, **10** Ask questions/month, 1 WhatsApp person; optional **Health Monitor +₹299** add-on, see below), **Family ₹1,699** (lowered from ₹1,999 on 2026-10-08; 2 parents, 3 calls/day each, 20 Ask, 2 WhatsApp people, the timeline and the couple call (`plan.premium`); no BP/sugar, no daily touches: those are add-ons), **Extended ₹3,999** (lowered from ₹4,999 on 2026-10-08, ₹800 a parent; 5 parents, 30 Ask, 5 WhatsApp people, the timeline and couple call, priority support; the same add-ons); calling plans have deliberately thin margins (~30% typical), the user wants prices minimal. To keep calls cheap (Sarvam bills every STARTED minute, so a call over 60 s costs 2) the health bundle ("How are you feeling?" + the day's one health question + the weekly extras) rides on ONE call a day: the **earliest call that fits in about 56 s** (`callPlanning.chooseHealthSlot`: ~12 s + ~7 s per tablet + ~20 s for the bundle; a slot's own average of real calls replaces the estimate after 3 calls); if none fits, only "How are you feeling?" goes on the lightest call; if the chosen call never happens a later one takes over after 2 h (`healthCarryFor`). Saathi never cuts a parent off. `/admin` shows the average billed minutes per call, the share over 60 s and the resulting cost per parent. **No extra "you said later" calls** (`maxFollowUpsPerDay()` = 0, env `FOLLOW_UP_CALLS_PER_DAY` switches them back on): a "later" tablet is asked again on the next scheduled call (`laterToday`), and still "later" on the last call of the day is a level-2 missed-medicine alert (`snapshot.finalCall`). A missed call is retried once, **30 minutes** later (`RETRY_DELAY_MINUTES`). **Changing plan or adding Health Monitor inside a paid period** (`plans.carriedPeriod`, 2026-10-08): the new Razorpay subscription is created with `start_at` = the end of the paid period (and a plan change during the 7-day trial keeps the trial), our row keeps that `currentPeriodEnd`/status, the invoice line is 0 rupees, and the old subscription is cancelled at once: no double charge and no free gap. Cancelled / failing / first-ever subscriptions are not carried (first-ever gets the trial). The Razorpay webhook handles the future first charge exactly like a trial's. Not testable without live Razorpay: watch the first real switch in test mode. Every paid plan has a 7-day trial. **3 calls/day is mandatory on calling plans (user, 2026-10-04): never lower the cap to save cost, change prices instead.** `reminderChannelFor(plan, parent)`: Remind always means WhatsApp; on calling plans a person can be switched to WhatsApp in Settings (`ParentProfile.reminderChannel`). `smallestPlanFor()` never suggests Remind as an upgrade. "Ask about your parent" defaults to **Claude Sonnet 5.5** with a monthly allowance per plan (`askPerMonth`, counted against the account owner in the database: table `AskUsage`, `lib/askUsage.ts`, an atomic conditional update, IST calendar month; a question the AI fails to answer is given back). The **weekly chat is not included**: it is planned as a ₹199 add-on (`COMPANION_ADDON_PRICE`); until that has billing `plan.weeklyChat` is false everywhere, so it is neither offered nor dispatched. Margins/assumptions (1.2 billed min per call is a guess: check real `durationSeconds`) are in the `plans.ts` comment. **New Razorpay plans are needed** (`create-razorpay-plans.ts`, new envs `RAZORPAY_PLAN_ID_ESSENTIAL` and the add-on combinations; old ids are for old prices, Solo is now ₹899 and Family ₹1,699). Superseded prices: Solo ₹999 / ₹799, Family ₹1,999 / ₹1,299, Extended ₹4,999 / ₹3,499. `getEffectivePlan(subscription, user.createdAt)` decides which limits apply (returns a synthetic `expired` plan with 0 calls once the trial is over; the dispatcher, reminders, test calls and adding parents all respect it). Every new account gets a free-trial `UserSubscription` row; a paid checkout replaces it. **Payment details come first (since 2026-10-03):** a parent can only be added on a paid plan (`canAddParents()`; `trialing` counts, because starting the 7-day trial means setting up Razorpay AutoPay, with a ~₹5 refundable check). So the `free` row means "no plan yet": `POST /api/parents` returns 402 `PAYMENT_REQUIRED` (+ `upgradePlanId`), `GET /api/parents` `planLimits.paymentRequired`; onboarding, the dashboard empty state and the navbar send people to checkout; checkout doesn't offer Free and old `?plan=free` links land on Family; free-trial reminder emails only go to accounts that already have a parent. The Free Trial is not shown as a plan card (it is what every signup gets); billing still lists it.
- Parked, do not build: wearable integration.

**Add-ons (2026-10-08, any calling plan: Solo, Family, Extended; `HEALTH_MONITOR` / `DAILY_TOUCHES` in `plans.ts`, picked at checkout with `?monitor=1&touches=1`):**
- **Health Monitor: Solo ₹299, Family ₹499 (2 parents), Extended ₹999 (5 parents).** BP and sugar by voice, the chart, the family's limits and alerts, health trends against the parent's own normal (`insights.ts`), and ONE short extra call a day per parent with no tablets (a `wellness` slot labelled "Health readings", set in Settings -> `PATCH action: 'vitals_call'`) that sits **outside the 3-call cap** and is the only call that asks for readings (without it the readings are asked on the first medicine call). Gate: `planAccess.ownerHasHealthMonitor()` (add-on bought, plan not lapsed) on the readings route, the `details` PATCH and insights. Not included: a "full daily health check" (it would push the readings call past a minute).
- **Daily Touches ₹99:** festival and birthday wishes, the weather note, the "did the helper come?" check (settings in the Settings tab once bought). They only go on a call that has room: `planCallExtras` takes `family.baseSeconds` (tablets + health questions + partner's tablets) and adds a touch only while the call stays within `CALL_BUDGET_SECONDS` (wish 6 s, weather 6 s, helper 8 s, an appointment reminder 12 s counts first). Gate: `ownerHasDailyTouches()` on the `details` and `city` actions. Tests can set `DispatchDeps.baseSecondsOverride`.
- Stored in `UserSubscription.healthMonitor` / `dailyTouches` (columns added 2026-10-08, additive). The amount is `monthlyPrice(plan, addons)`. **A Razorpay add-on is a one-time charge, so every combination is its own plan: `RAZORPAY_PLAN_ID_<PLAN>[_MONITOR][_TOUCHES]`** (12 for the three calling plans; `create-razorpay-plans.ts` creates them all; subscription notes carry `carecircle_addon: health_monitor,daily_touches` and verify checks them). Test-mode ids are in `.env.local` (2026-10-08); live mode and Vercel still need them.
- Retired but not deleted (ask before deleting files): `MessagesCard.tsx`, `StoriesPanel.tsx`, the `/api/parents/[id]/messages` and `/stories` routes (they answer 410) and `/dashboard/stories/[parentId]` (404). The tables stay.
- Tests: `npx tsx scripts/test-call-placement.ts` (66 checks).

## 3. AI safety rules (non-negotiable)

- Saathi never diagnoses, never acts like a doctor, never panics the parent; defers to a real doctor or family member.
- **Code-level safety net**: after every call, scan the final transcript for emergency words in all supported languages (Hindi, Telugu, Tamil, Kannada, Bengali, Marathi, Gujarati, Malayalam, English) and raise an alert independently of the voice provider.
- Medicine data from AI extraction is never saved without explicit user confirmation. On extraction failure the user gets an error, never substitute medicines.

## 4. Tech stack (as found in code)

| Area | Reality |
|---|---|
| Framework | Next.js **16.3.6** App Router, React 19.2, TypeScript strict. |
| Styling | Plain CSS design system in `src/app/globals.css` (tokens on `:root`, dark theme under `[data-theme='dark']`, shared classes: `.btn`, `.panel`, `.form-input`, `.segmented`, `.badge`, `.notice`, …) + CSS module for the landing page + `lucide-react`. Palette is warm ivory paper (`--paper` #f8f5ef) with an ocean-blue brand (`--teal` #006baa for text/borders, `--teal-fill` for solid backgrounds with `--on-teal` white; dark mode text #8ccdf7. **Was peacock-teal until 2026-10-03: the user doesn't want green/teal, and also rejected violet**). The main CTAs (hero, featured plan) use `.btn-glow`, a slowly turning blue/sky/pink gradient adapted from codefronts.com (MIT) and a marigold accent (`--gold` #a8510c for text, `--marigold` #f2a33a for fills); fonts are Bricolage Grotesque (headings) + Figtree (body) via next/font in `layout.tsx`; the token names are legacy. The landing hero is the exception: its voice orb (`SaathiBlob`) is blue→violet→magenta (leans cyan while Saathi talks, pink for the family) with its own palette in `voiceHero.module.css` and the component. Use tokens (`var(--teal)`, `--teal-fill` + `--on-teal`, `--teal-text`), never raw hex. Dark mode: inline `<head>` script from `lib/theme.ts` + `ThemeToggle`. **No Tailwind / shadcn.** |
| DB | Prisma 6 + Supabase Postgres. `db push`, no migrations history. |
| Data layer | `src/lib/db.ts` is **Prisma-only** (no caches); write helpers throw on failure. |
| Auth | Custom. bcrypt passwords; opaque DB sessions (`sess_…` in cookie `carecircle_session`), checked against `DBSession` on every request; no JWT. Google = Google Identity Services ID token verified server-side (needs `GOOGLE_CLIENT_ID`). OTP = DB-stored hashed codes; **no SMS provider**, so phone OTP only works under `next dev` (503 elsewhere). Master OTP `123456` works only under `next dev`. |
| Payments | Razorpay Checkout + server signature verification + subscription ownership check (notes.carecircle_user_id). Until keys **and** all three `RAZORPAY_PLAN_ID_*` are set: local sandbox **only under `next dev`** (test keys alone used to send placeholder plan ids and checkout failed); production returns 503. The PLANS `razorpayPlanId` values are placeholders and are never sent. Checkout refuses a plan smaller than the parents already added (`PLAN_TOO_SMALL`); paying for a new plan cancels the previous Razorpay subscription (no double billing). Webhook requires valid signature. |
| WhatsApp | **Call updates go to WhatsApp, email is only account/billing** (rule set by the user 2026-10-01). Meta WhatsApp Cloud API via `fetch` (`lib/whatsapp.ts`), one message per call (`lib/familyMessages.ts` + `lib/familyNotify.ts`), webhook for statuses/button taps/STOP (`lib/whatsappInbound.ts`). Inactive until `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` are set; until then alerts are emailed as before. Setup + exact template texts: `docs/whatsapp-setup.md`. |
| Email | Resend (`lib/email.ts`). Default sender `onboarding@resend.dev` only delivers to the Resend account owner (warning logged); needs a verified domain in `RESEND_FROM_EMAIL`. Replies go to `NEXT_PUBLIC_SUPPORT_EMAIL`. Billing emails are sent once each via `lib/emailLog.ts` (see §7a). |
| AI | Groq vision via `fetch` for prescription photos (images only; PDFs rejected). **Claude** (`@anthropic-ai/sdk`, `lib/claude.ts`, default `claude-opus-5-5`, server-side refusal fallback `"default"`) for "Ask about your parent" (`lib/familyAsk.ts`) and the WhatsApp scam check (`lib/scamCheck.ts`); off until `ANTHROPIC_API_KEY`. Never in the calling pipeline. |
| Calling | **Built** on Sarvam Voice Agents: `lib/sarvam.ts` (client), `lib/callDispatch.ts` (scheduler/retries), `lib/callResults.ts` (webhook), `lib/alerts.ts` + `lib/safety.ts` (alerts + emergency scan). Inactive until `SARVAM_*` are set; then `/api/cron/dispatch` (external cron) places calls. Twilio/Groq-calling removed. |
| Page guards | `src/proxy.ts` redirects signed-out users away from /dashboard, /onboarding, /account, /checkout. |
| Deploy | Vercel, live since 2026-10-01 at https://saathi-ai-delta.vercel.app. Cron = any external scheduler hitting `/api/cron/dispatch` every ~5 min (Vercel Cron needs a paid plan for that interval; no `vercel.json`). |

Env keys added 2026-10-03: `SARVAM_ALERT_APP_ID`, `SARVAM_ALERT_APP_VERSION`, `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (optional `SUPABASE_STORAGE_BUCKET`), `NEXT_PUBLIC_SUPPORT_PHONE`, optional `TRANSCRIPT_RETENTION_DAYS` (default 90, 0 = off).
Env keys (names only): `DATABASE_URL`, `DIRECT_URL`, `GROQ_API_KEY`, `GROQ_VISION_MODEL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_ID_SOLO`, `RAZORPAY_PLAN_ID_FAMILY`, plus one per add-on combination: `RAZORPAY_PLAN_ID_{SOLO,FAMILY,EXTENDED}_{MONITOR,TOUCHES,MONITOR_TOUCHES}` (2026-10-08), `RAZORPAY_PLAN_ID_EXTENDED`, `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `CRON_SECRET`, `SARVAM_API_KEY`, `SARVAM_ORG_ID`, `SARVAM_WORKSPACE_ID`, `SARVAM_APP_ID`, `SARVAM_APP_VERSION`, `SARVAM_CONNECTION_ID`, `SARVAM_AGENT_PHONE_NUMBER`, `SARVAM_WEBHOOK_SECRET` (generated locally), optional `SARVAM_API_BASE`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, optional `WHATSAPP_API_VERSION` / `WHATSAPP_TEMPLATE_LANGUAGE` / `WHATSAPP_BUSINESS_NUMBER` (START links; else asked from Meta), `RAZORPAY_PLAN_ID_ESSENTIAL`, `ADMIN_EMAILS` (comma-separated; who can open `/admin`). Removed: `GROQ_CALL_MODEL`, `TWILIO_*`, `JWT_SECRET`. **Keys go in `.env.local`** (Next.js reads it before `.env`; several keys existed in both and `.env.local` silently won). Also `NEXT_PUBLIC_SUPPORT_EMAIL` (Privacy/Terms contact). As of 2026-10-01 (`check:setup`): Sarvam and Groq READY; Razorpay in test mode but plan ids missing; `NEXT_PUBLIC_APP_URL` not https; Resend sender is still resend.dev; Google unset. Run `npm run check:setup` to see exactly what is missing (never prints values).

## 5. Folder map

```
prisma/schema.prisma        17 models (see §6); prisma/seed.ts (demo data, NOT applied to live DB)
scripts/                    tsx scripts. `test-care-features.ts` = 157-check v1 suite; `test-whatsapp-reminders.ts` = 191-check Remind + plan-tier + symptom suite (fake Meta/Sarvam/email + clock, throwaway `reminder-test-*` accounts); `test-care-extras.ts` = 98-check v1.1 suite; `test-ask-usage.ts` = 10-check suite for the durable Ask counters; `test-call-placement.ts` = 66-check suite (where the health questions go, "later" rules, Health Monitor, admin call length) (fake Sarvam + weather, throwaway `extras-test-*` rows); `backup-database.ts` (read-only JSON backup, written outside the repo); `create-storage-bucket.ts` (vault bucket, dry run by default). `test-call-pipeline.ts` = 145-check suite (see §9; runs with WhatsApp off); `test-whatsapp.ts` = 68-check WhatsApp suite (pure logic + DB flow with fake Meta/Sarvam/email, webhook route; cleans up); `test-billing-emails.ts` = 69-check suite for billing/lifecycle emails (see §7a); `check-setup.ts` (`npm run check:setup`); `create-razorpay-plans.ts`; clear-database.ts = DANGEROUS
.github/workflows/dispatch-calls.yml   free 5-minute cron calling /api/cron/dispatch (needs APP_URL + CRON_SECRET repo secrets)
docs/launch-checklist.md    every account/key still needed, in order
docs/sarvam-agent.md        how to build the Saathi agent in Sarvam: prompt, input/output variables, tool, cron, live test
docs/whatsapp-setup.md      Meta WhatsApp setup, the 3 template texts (must match lib/whatsapp.ts), webhook, env keys, live test
src/proxy.ts                optimistic page guard (cookie presence) → /login?redirect=…
src/lib/
  prisma.ts                 PrismaClient singleton
  db.ts                     Prisma-only repository (users, parents, slots, medicines, logs, alerts, reports…)
                            incl. linkMedicinesIntoSchedule() and newId()
  access.ts                 requireUser(), requireOwnedParent() for API routes
  security.ts               in-memory rate limits (best-effort); OTP, sessions, reset tokens in DB
  auth.ts                   bcrypt helpers, getSessionUser(), getSessionToken()
  razorpay.ts               config detection, create/verify/cancel subscription, webhook signature
  medicineReportIntake.ts   shared upload parsing + extraction (no sample fallback)
  redirect.ts               safeRedirectPath() (client-safe)
  types.ts, plans.ts        domain types; plans + getEffectivePlan()
  email.ts                  Resend transport + templates (receipt, activated, payment failed, stopped, cancelled, trial reminders, alerts)
  emailLog.ts               sendOnce()/markEmailSent(): once-only emails via the EmailLog unique key
  lifecycleEmails.ts        runLifecycleEmails(): free-trial ending/ended + paid-trial-ending reminders (run by the cron route)
  groqVision.ts, medicineExtractor.ts   extraction internals (don't touch)
  scheduleGenerator.ts      medicines → call slots + per-medicine question scripts
  phone.ts                  E.164 normaliser
  ist.ts                    IST (UTC+5:30) date/time helpers, slot-due logic
  sarvam.ts                 Sarvam Instant Outbound client, config, language mapping, request builder
  callDispatch.ts           runDispatch() (due slots, plan cap, retries, stale cleanup), placeManualCall()
  callResults.ts            processSarvamWebhook() (idempotent), raiseToolEscalation(), retry rules
  callInterpretation.ts     pure: Sarvam output variables -> per-medicine results, mood, alert decisions
  safety.ts                 multilingual emergency-phrase scan (parent turns only)
  alerts.ts                 recordAlert() (dedupe per call+title), raiseAlert() = record + notify, raiseUnreachableAlert()
  whatsapp.ts               Meta Cloud API client, WHATSAPP_TEMPLATES (names/bodies/quick-reply order), webhook signature check
  familyMessages.ts         pure: which ONE message per call (call_update / attention / emergency) + its words, reply texts
  familyNotify.ts           notifyFamily(): WhatsApp to opted-in owner; level 3-4 email backup; legacy alert emails while WhatsApp is unconfigured
  whatsappInbound.ts        processWhatsAppWebhook(): statuses (forward-only, failed L3+ -> email once), "I'll handle it", "Call again", STOP/START, auto-reply
  secrets.ts                timing-safe secret compare, Bearer/header reader
  adminEmail.ts, admin.ts   ADMIN_EMAILS check (isAdminEmail, no imports) + requireAdminPage() (404 for non-admins)
  --- v1 care features (2026-10-03) ---
  callPlanning.ts           pure: per-call extras (consent, safety line, last-call note, wellbeing, refill, birthday; max 2), CallSnapshot, NON_RETRY_SLOTS
  escalation.ts             emergency / wellness-check / practice ladders, "Aaptha Alert" calls, markHandled ("I'm on it"), outcomes, cron advance
  familyAccess.ts           parentRoleFor / roleAllows / familyRecipients (owner + accepted members); familyInvites.ts = invite links
  insightRules.ts (pure) + insights.ts   patterns vs the parent's own 60-day baseline; one level-2 nudge when several change in a week
  digests.ts                daily / weekly / monthly summaries at each person's hour + time zone (template aaptha_care_summary)
  timeline.ts (pure)        day-by-day timeline + journal (names, no pronouns)
  parentNotices.ts          parent notice + intro script in 9 languages (DRAFT translations: native review needed)
  claude.ts, familyAsk.ts, scamCheck.ts   Claude features; storage.ts = Supabase Storage REST (vault); retention.ts = 90-day transcript clean-up
  --- v1.1 (2026-10-04) ---
  readings.ts (pure)        parse BP/sugar, family limits + fixed safety limits; appointments.ts (pure) reminders/follow-up
  weather.ts, festivals.ts  Open-Meteo note (3 h cache) / Google India holiday ICS (12 h cache) + specialDayFor()
  familyMoney.ts (pure), billShare.ts   UPI share link, equal share, chemist WhatsApp text / payer + member views
  adminStats.ts             read-only queries for /admin (customers, plans, parents, calls/day, alerts); hides `claude-e2e-*` accounts
  --- Remind plan + tiers (2026-10-04) ---
  reminders.ts              Remind plan: runReminders() (cron: ask 1-3 / missed -> caretaker, capped), handleReminderInbound() (person + caretaker START codes, Yes / Not yet, STOP/START, warning words), getRemindersForParent()
  planAccess.ts             ownerPlanFor(), isPremiumParent(), premiumRequired() (402): the OWNER's plan decides Family/Extended features
src/app/card/[token], notice/[lang], invite/[token], dashboard/report/[parentId]   emergency card (public, noindex, revocable), parent notice, invite accept, printable doctor summary
src/app/admin/page.tsx      read-only admin overview (server component). NOT in proxy.ts matcher on purpose: signed-out visitors get a 404, not a login redirect
src/components/GoogleSignInButton.tsx   GIS button (hidden when not configured)
src/components/ui/ThinkingOrb.tsx   client wrapper for `thinking-orbs` (added 2026-10-05): dotted canvas orb, tinted with the surrounding
                              text colour (follows light/dark). Only at 32/64 px for AI activity: Ask "Going through Amma's calls…"
                              = composing 32, prescription reading = searching 64, call in progress (`.status-orb.live`) = listening 32.
                              Buttons keep `.spinner`: at 20 px on a dimmed busy button the orb reads as a grey smudge (tried 2026-10-05).
                              Never pass theme="dark" (invisible on the ivory theme); no gravity.
                              All 9 states: /dev/thinking-orbs (dev only)
src/components/LegalPage.tsx + app/privacy + app/terms   plain-language Privacy Policy and Terms (draft; lawyer review advised); linked from Footer and checkout
src/components/               Navbar (+Brand), Footer, Reveal, ThemeToggle, ui/Modal (portal),
                              auth/AuthUI (AuthShell, PasswordField, PhoneField, StrengthMeter),
                              onboarding/WizardUI (WizardShell, StepHeader, SlotPicker, FoodPicker),
                              checkout/CheckoutUI, account/AccountUI, landing/* (LiveCallPhone, DashboardPreview),
                              dashboard/* (helpers.computeCallStats, 6 panels, DashboardModals)
src/components/landing/VoiceHero.tsx   landing hero: pitch on the left, Saathi's voice orb on the right with live
                              captions INSIDE the orb (one sentence at a time) and an English/Telugu/Hindi switch.
                              Tapping plays a sample greeting through the browser's speechSynthesis (English
                              voice + note when the browser has no Telugu/Hindi voice; pre-recorded Sarvam clips
                              were offered and deferred). No real call, no data.
src/components/landing/LiveCallPhone.tsx   "How it works": scripted example call on a CSS iPhone 16 (true proportions,
                              sized in iOS points via --pt/cqw). Rings (phone icon shakes in the island; the phone itself stays still), slide-to-answer
                              (SlideToAnswer.tsx; auto-slides if nobody drags), then a live transcript; island bars
                              (IslandWave.tsx, canvas) flow left->right green for Saathi, right->left red for Amma.
                              Script in callScript.ts: hand-written English/Telugu/Hindi, shared timings, no API.
                              Plays twice by itself, then waits with "Ring again". The summary card's call length reads CALL_MS.
src/components/voice/SaathiBlob.tsx    the hero's voice orb (raw WebGL1, no three.js): a living glass blob. Bumpy
                              geodesic net of dots + lines, glass rim/glint, two inner ribbons (cyan = Saathi,
                              pink = family), offscreen bloom (two blur sizes), drifting dust.
                              Voice (2026-10-04): each word -> rough sounds (vowel/hum/hiss/stop, Indic letters too) -> a
                              loudness level like real audio: swell + rim/inner-light flare per syllable, hiss sparkle,
                              one thin ring per syllable in the speaker's colour (out from the centre = Saathi, in from
                              the rim = family). Touch: spring physics (turns/leans to the pointer, surface rises + glows
                              under it, light streams in, dust parts, jelly wobble on fast moves; press = dent, drag =
                              stretch, release = ripple; a drag swallows the click so it never starts the call).
                              Modes idle/ringing/saathi/family/thinking/ended; 'day' variant = ink on light pages. Handle
                              (setMode/pulse/say/level/echo) shared with the older SaathiOrb (red/blue ring, also
                              exports NOISE + syllables) and SaathiSphere (wave-line sheet); those two are only used
                              by src/app/dev/orb, the dev-only playground ("Look" button cycles; 404 outside `next dev`)
src/app/                    pages: landing, login, signup, reset-password, onboarding (6 steps),
                            dashboard (6 tabs; panels in components/dashboard), account/profile, account/billing,
                            checkout/confirm → payment → success
```

## 6. Data model (prisma/schema.prisma)

User · **EmailLog** (once-only email guard, added 2026-09-30) · **WhatsAppMessage** (every message sent/received; unique (kind, refKey) = one message per call per number; status pending→sent→delivered→read|failed; `fallbackEmailedAt`; added 2026-10-01) · DBSession · OTPRecord · PasswordResetRecord · OAuthAccount (Google links) · UserSubscription · Invoice · **ParentProfile** · **ScheduledCallSlot** · **Medicine** · EmergencyContact · **CallLog** · **AlertRecord** · ScheduleSuggestion · CaregiverInvite · NotificationPreferences · MedicineReport (now persisted).

Call-relevant fields:
- `ParentProfile`: phone (E.164), `language` (free text; **no `preferredLanguage` yet**), timezone, `callTime` (legacy display), isPaused, pauseReason, pauseUntil (real Date), consentGiven, isDeleted.
- `ScheduledCallSlot`: time ("08:30 AM", IST), slot (morning/afternoon/evening/bedtime/wellness/custom), label, linkedMedicineNames[], `linkedMedicinesJson` (name, dosage, foodRelation, questionScript), isActive. **Slot ids are always generated server-side.**
- `CallLog`: scheduledTime, actualAnswerTime, status (`scheduled` -> `placed` -> `answered` | `unanswered` | `busy` | `failed`), durationSeconds, medicationConfirmed, mood, summary, notes, createdAt, plus (added 2026-09-30, all optional) slotId, slot, callDate (IST YYYY-MM-DD), attemptNumber (default 1), providerAttemptId (unique), interactionId, failureReason, transcriptJson (English), resultJson (`{medicines, medicineResults, ...}`), startedAt, endedAt, nextRetryAt, processedAt. **Unique (parentId, slotId, callDate, attemptNumber)** = double-dial guard. `slot` is `test`/`manual` for owner-requested calls (slotId null, never retried).
- v1 (2026-10-03): `ParentProfile` parentConsent (pending/given/declined/withdrawn; null = pending), emergency-card fields, cardToken, livesAlone, trust timestamps (introducedAt, numberSavedAt, lastSafetyLineAt, lastWellbeingAt, lastRefillCheckAt), birthDate, companion*; `Medicine.purpose`; `EmergencyContact` role/isLocal/practice*; `CallLog.followUpAt/parentWords`; `AlertRecord` handledBy*/outcome*; `CaregiverInvite` userId/token/phone/acceptedAt/revokedAt; `NotificationPreferences` timezone/dailySummary/digest*/monthlySummary/wakeForEmergency/emergencyPhone; `User.lastSeenAt`; `UserSubscription.cancelReason/cancelledAt`. New tables `Escalation`, `EscalationAttempt`, `HealthInsight`, `HealthDocument`.
- Remind (2026-10-04): `ParentProfile.reminderChannel` (null/call | whatsapp), `reminderStartCode` (unique, rotated after use), `reminderWhatsapp` (number that sent START; reminders only go there), `reminderOptInAt`, `reminderOptOutAt` (STOP), `discreetReminders`; `Medicine.endsOn` (IST YYYY-MM-DD, last day of a course: reminders AND calls leave it out after, `medicineIsCurrent()`); table `MedicineReminder` (one row per person + reminder time + IST day, unique; status pending/sent/failed, answer taken/not_yet/missed (later/skipped: first version), askCount, nextAskAt, caretakerAlertedAt; nudgedAt/snoozeUntil/snoozeCount no longer written); caretaker columns `caretakerName/Phone/StartCode/Whatsapp/OptInAt/OptOutAt`. WhatsAppMessage kinds `reminder` (refKey `<reminderId>:ask1|ask2|ask3`), `caretaker_missed|taken|emergency`, `Medicine.tabletsLeft/refillNotifiedAt` (Remind tablet count), `ParentProfile.weeklyProgress*` (opt-in weekly message), WhatsAppMessage kinds `appointment` (refKey `<appointmentId>:day_before|same_day`), `weekly_progress`, `caretaker_weekly`, `reminder_reply`, `reminder_auto_reply`.
- `AlertRecord`: level 0–4, title, message, channel (`dashboard` at creation, then `whatsapp` / `email` once delivered; old rows `email`), timestamp (ISO string), status (`resolved` once acknowledged), callLogId (dedupe per call+title), `acknowledgedAt` ("I'll handle it" on WhatsApp).
- `NotificationPreferences`: `whatsappNumber` (null = account phone), `whatsappOptInAt` (explicit consent; null = no WhatsApp), `minimumAlertLevel` (1 = every call result, 2 needs attention, 3 health, 4 emergencies), `email` (= email backup). The `whatsapp` boolean is only written by opt-in/STOP, never by the profile PATCH.

Live DB baseline: **wiped to zero on 2026-10-03** at the user's request (every table, all 5 accounts) so they can test from signup by hand; a JSON backup of the old rows is at `D:/sathwik/aaptha-db-backups/db-backup-2026-10-03.json` (outside the repo, has personal data). `scripts/clear-database.ts` is stale (misses EmailLog, WhatsAppMessage, OAuthAccount).

## 7. API routes

All private routes: **S** = `requireUser`, **O** = `requireOwnedParent` (404 for other users' parents).

| Route | Method | Purpose | Auth |
|---|---|---|---|
| /api/auth/signup | POST | email + password + E.164 phone (unique) → user, session | — |
| /api/auth/login | POST | email or phone + password, rate-limited | — |
| /api/auth/otp/send, /verify | POST | phone OTP (dev only until an SMS provider exists) | — |
| /api/auth/google | POST | verifies Google ID token (`credential`), login/signup | — |
| /api/auth/logout | POST | revokes DB session + clears cookie | — |
| /api/auth/me | GET | current user | S |
| /api/auth/forgot-password, /reset-password | POST | single-use 20-min token; reset revokes all sessions | — |
| /api/account/profile | GET/PATCH | profile + notification prefs (phone must be unique) | S |
| /api/account/whatsapp | GET/POST | WhatsApp status / opt in (`{optIn:true, number?}`, stores consent time) / opt out | S |
| /api/whatsapp/webhook | GET/POST | Meta verification (`WHATSAPP_VERIFY_TOKEN`) / signed statuses + replies (`X-Hub-Signature-256`, `WHATSAPP_APP_SECRET`); idempotent | signature |
| /api/account/password | POST | change password (min 8) | S |
| /api/account/billing | GET/POST | invoices; cancel (also cancels Razorpay at cycle end), reactivate (only before period end), switch-plan (**Free only**; paid → 402 + checkoutUrl; blocked if over parent limit) | S |
| /api/razorpay/create-subscription | POST | Razorpay subscription for the logged-in user (sandbox only under dev) | S |
| /api/razorpay/verify | POST | signature + ownership verification → activate | S |
| /api/razorpay/webhook | POST | signed events → active / past_due / cancelled; also invoice + emails (§7a) | signature |
| /api/parents | GET/POST | list; create parent + slots + meds + contacts (validated first; soft-deletes on partial failure) | S |
| /api/parents/[id] | GET/PATCH/DELETE | details; pause (future ISO date), resume (clears reason/until), update (whitelisted), archive | O |
| /api/parents/[id]/medicines | POST/PATCH | add (+ links into call slots, may create a slot) / toggle | O |
| /api/parents/[id]/caregivers | POST | pending invite row (no email yet; says so) | O |
| /api/parents/[id]/suggestions | POST | accept (moves matching slot times) / dismiss | O |
| /api/parents/[id]/test-call | POST | real 1-time Saathi call to the parent (2/hour, 5/day); 503 until Sarvam is configured; never fakes logs | O |
| /api/parents/[id]/medicine-reports | GET/POST | persisted draft extraction | O |
| /api/parents/[id]/medicine-reports/[reportId]/confirm | POST | save confirmed meds, link into schedule, mark report confirmed (once) | O |
| /api/medicine-reports/extract | GET/POST | samples list / onboarding extraction | GET —, POST S |
| /api/calls/trigger | POST | owner "call now" (rate-limited, no retry) | S |
| /api/cron/dispatch | GET/POST | `runDispatch()` (no-op when Sarvam not configured) **and** `runLifecycleEmails()` (runs even without Sarvam); `x-cron-secret` or `Bearer CRON_SECRET` | cron secret |
| /api/calls/sarvam-webhook | POST | end-of-call result; `?token=SARVAM_WEBHOOK_SECRET`; idempotent | token |
| /api/calls/escalate | POST | Sarvam API tool: mid-call emergency -> level-4 alert; `Bearer SARVAM_WEBHOOK_SECRET` | secret |
| /api/parents/[id]/alerts/[alertId] | POST | `on_it` (stops escalation, tells the family) / `outcome` (closes) | view |
| /api/parents/[id]/practice-alert | POST | practice call to one contact | manage |
| /api/parents/[id]/caregivers | POST/PATCH/DELETE | family circle: invite link / role / remove or leave | owner (leave: member) |
| /api/parents/[id]/documents(/[docId]) | GET/POST/PATCH/DELETE | health record vault (signed 5-min links, soft delete) | view / manage |
| /api/parents/[id]/ask | POST | Ask about your parent (Claude, 20/day/person) | view |
| /api/parents/[id]/report, /insights/[id] | GET / PATCH | doctor summary data / dismiss a nudge | view |
| /api/invites/[token] | GET/POST | invite preview / accept | — / S |
| /api/saathi/contact | GET | Saathi.vcf contact card | — |
| /api/calls/sarvam-inbound, /api/calls/inbound-context | POST | call-back webhook / on-start lookup | token / Bearer |
| /api/dev/emails | GET/POST | dev outbox + sample sends (`type`: password_reset, verification, receipt, alert, activated, payment_failed, stopped, cancelled, trial_ending, trial_ended, paid_trial_ending); **404 outside `next dev`** | dev only |

### 7a. Billing and lifecycle emails (added 2026-09-30)
Every email goes through `lib/email.ts` (Resend). Anything that must reach the customer exactly once claims a row in `EmailLog` first (`sendOnce()`; unique on userId+kind+refKey; a failed send releases the claim so it retries).

| Email | Sent by | Once-only key |
|---|---|---|
| Subscription activated / free-trial started | `/api/razorpay/verify` | `subscription_activated` + Razorpay subscription id |
| Payment receipt (+ saves an `Invoice`) | webhook `subscription.charged` | `payment_receipt` + payment id (invoice number `CC-<year>-<last 6 of payment id>` is shared with checkout) |
| Payment failed | webhook `payment.failed` / `subscription.pending` | first failure of a streak only (status -> `past_due` via `updateMany`); recovers on the next charge |
| Subscription stopped (Razorpay gave up) | webhook `subscription.halted` | `subscription_ended` + subscription id. **Halted now sets status `cancelled`**, so calls stop when the paid period ends (it used to stay `past_due`, i.e. free service forever) |
| Cancelled | in-app cancel (`/api/account/billing`) or webhook `subscription.cancelled` | same `subscription_ended` key, so the customer gets one email even when both fire |
| Free trial ending (48 h before) / ended (up to 3 days after) | `runLifecycleEmails()` via cron | `trial_ending` / `trial_ended` + `free-trial`; accounts whose trial ended long ago are never emailed |
| Paid trial ending (3 days before first charge) | `runLifecycleEmails()` via cron | `paid_trial_ending` + trial end date |

Cron reminders are fail-closed (no EmailLog row = no email, so they never repeat every 5 minutes); payment/cancel notices are fail-open. Dates in emails are IST. Tests: `npx tsx scripts/test-billing-emails.ts` (69 checks; throwaway `billing-test-*@example.com` accounts, Resend key removed in-process, reminder runs scoped by `userIds`). Not built: email-verification flow, caregiver invite emails.

## 8. Status (plan vs reality)

| Item | Status |
|---|---|
| Auth: password, sessions, remember-me, reset | DONE (DB-authoritative) |
| Google sign-in | DONE in code; needs `GOOGLE_CLIENT_ID` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to appear |
| Phone OTP | PARTIAL: needs an SMS provider (MSG91/Twilio Verify/etc.) before production |
| Email verification | NOT BUILT: email signups are marked verified; the "verify" link just opens the dashboard |
| Razorpay subscriptions | DONE in code; needs real keys, plan ids and webhook secret; untested against live Razorpay |
| Groq vision draft → confirm | DONE; reports persisted; no sample fallback; PDFs rejected |
| Free trial | DONE: 7 days from signup, then calls stop (`plans.ts` `freeTrialEnd`, dashboard/billing banners, tested in A7/B14/B15) |
| Privacy + Terms pages | DONE (draft written from how the product works; needs a lawyer's read) |
| Onboarding wizard | DONE (meds keep timing/food relation; Malayalam added; honest test-call) |
| Admin overview (`/admin`) | DONE 2026-09-30: read-only; only emails in `ADMIN_EMAILS`; shows customers, plans, est. revenue, parents, calls/day, answer rate, recent alerts. Admin link in the user menu via `user.isAdmin`. Email verification isn't built, so only list an email whose account already exists (otherwise someone could sign up with it) |
| Dashboard | Today card, Trends, call history from real data; CSV export. Split into `components/dashboard/*` (DONE 2026-09-30) |
| Pause/resume | DONE (real dates) |
| Caregiver invites | PARTIAL: row only; no email, no invitee access |
| Smart call-time suggestions | PARTIAL: accept/dismiss works; **no generator** |
| Alert engine + family notifications | DONE (levels 1–4, dedupe, prefs). WhatsApp BUILT 2026-10-01 (one message per call, buttons, STOP/START, email backup for L3-4); schema applied to the live DB 2026-10-01 (reviewed additive SQL); opt-in UI verified in the browser. **Meta setup progress (2026-10-01):** business portfolio + developer app both named "Test-Saathi" (user chose to keep the name; app id 975090058479487), WhatsApp use case added, Meta test number +1 555 169 7486 claimed (Phone Number ID 1420353401150573, test WABA 1118057450666325), "Hello World" received on the user's phone. **2026-10-02:** all 4 `WHATSAPP_*` keys are in `.env.local` (system user `saathi-server`; **2026-10-03 the first token suddenly got `200 API access blocked` on every call while app/business/account showed no issues; a newly generated system-user token works**. It is a 60-day token, expires ~2 Dec 2026: make a "Never" token before real families); 3 templates submitted with `scripts/create-whatsapp-templates.ts --waba <id> --app-url <https url> [--confirm]` (dry run by default; re-run it to see status; re-run with the real WABA id later) (first wording `aaptha_call_update` / `aaptha_needs_attention` / `aaptha_emergency` was reclassified by Meta as MARKETING, ~7x the price and capped per person; reworded as `aaptha_call_result` / `aaptha_call_alert` / `aaptha_call_emergency`, which Meta lists as UTILITY, PENDING review; the 3 old ones are unused and can be deleted in WhatsApp Manager); webhook verified on the ngrok URL, `messages` subscribed, app subscribed to the WABA (`POST /{waba}/subscribed_apps`, needed or no webhooks arrive), app **Published** (unpublished apps only get dashboard test webhooks). Inbound verified live: a "hi" from the user's phone was stored, and after opting in on localhost the auto-reply arrived. **Next:** templates approved -> live test call -> WhatsApp update -> tap "I'll handle it"; then commit/push, add `WHATSAPP_*` to Vercel and move the Meta callback URL to the Vercel/own domain. Later: new SIM for the real number, business verification. Still needs approved templates and `WHATSAPP_*` keys (`docs/whatsapp-setup.md`). Co-managers get email only (no WhatsApp yet). SMS NOT built |
| Saathi voice calling (Sarvam) | BUILT + tested with a fake Sarvam (146 checks). Live-tested 2026-10-01 through ngrok (answered call with 1 taken / 1 missed -> L2 alert; voicemail -> `no_response`; busy). Live emergency test passed ("chest pain" -> escalate tool mid-call -> L4, then L3 health + L1 mood from the webhook). Still needs: own domain (not vercel.app), cron |
| Cron dispatcher | DONE (`/api/cron/dispatch`); **no working scheduler yet (checked 2026-10-03)**. `.github/workflows/dispatch-calls.yml` is live but GitHub only fired it 13 times in ~3 days (gaps of 3-6 h, not 5 min), and its dispatcher step finishes in 0 s, i.e. probably the "APP_URL/CRON_SECRET not set; skipping" path. Use cron-job.org (true 5-min) instead. Every call in the DB so far is a test call |
| v1 care features | BUILT 2026-10-03/04 on branch `v1-care-features` (not merged). Tests: `npx tsx scripts/test-care-features.ts` (156 checks, fake Sarvam/WhatsApp/email/Claude, throwaway `care-test-*` rows). Browser-checked with a throwaway claude-e2e account: urgent banner + I'm on it + outcome, emergency card + share link, invite link → second account joins as co-manager (owner-only actions hidden, 403 on delete), onboarding emergency plan + intro step, account summary settings, doctor report. Live calls not yet tested with the new prompt |
| v1.1 extras | BUILT 2026-10-04 (see the note at the top). Browser-checked with throwaway claude-e2e accounts: Today-tab messages + appointments, BP/sugar chart + tooltip + manual entry, Settings preferences (all fields saved, town lookup, couple link), refill list, Stories tab + book, bill split as payer and as sibling, view-only sibling gets 403 on every change, no sideways scroll at 375 px |
| `preferredLanguage` | NOT STARTED |
| Calls per day vs plan | ENFORCED at dispatch: `callsPerDay` Free 1 / Family 3 / Extended 3 (earliest slots win); dashboard warns when a schedule exceeds it |
| Replace legacy db.ts with Prisma | DONE (same exports, Prisma-only) |
| E.164 phone normalisation | DONE |
| International customers' phone numbers | DONE 2026-09-30: `PhoneField` has a country picker (`PHONE_COUNTRIES` in `lib/phone.ts`; typing a full `+44…` switches it); signup/login/OTP validate with `normalizePhone()` and send E.164. The **parent's** phone stays India-only (`indiaOnly`, fixed +91) because Saathi calls Indian numbers |

## 9. Sarvam call pipeline (built 2026-09-30)

```
external cron (~5 min) -> /api/cron/dispatch -> runDispatch()
   due = IST slot time passed within 90 min; parent active/consented/not paused (auto-resume); plan callsPerDay cap
   claim CallLog (unique index) -> Sarvam Instant Outbound (X-API-Key) -> status `placed`
Sarvam agent calls the parent (rented number, Vobiz underneath)
   mid-call emergency -> tool -> /api/calls/escalate -> level-4 alert
   end of call -> /api/calls/sarvam-webhook?token= -> processSarvamWebhook()
       connected -> answered; per-medicine results; mood; summary; alerts (2 missed med, 3 health/unwell, 4 emergency, 1 low mood)
       no_answer/busy -> retry +30 min (max 2 attempts since 2026-10-04, same IST day, scheduled slots only) -> level-2 "couldn't reach"
       failed -> no retry, level-2 alert (DND reason kept)
   no result within 45 min -> closed as failed `result_not_received` (a late webhook still applies)
```
Rules baked in: a call that connects but where the parent never speaks (transcript has no parent turn, or the agent reports `not_asked`; agent nudges then hangs up) is treated like an unanswered call (`failureReason: no_response`, retry +30 min, then the level-2 alert); wellness-only calls count as "medication confirmed"; alerts dedupe per call+title (webhook, tool and scan never double-alert);
emergency scan reads **parent turns only** (Sarvam supplies English `en_text`); a newly added parent skips slots that had already passed when it was added (later slots the same day are still called);
a 401/402/403 from Sarvam (our config, or **402 = Sarvam credits used up**: top up in the Sarvam dashboard) never retries or alerts families, logs a `[calls]` error, and a test call tells the owner "a problem on our side" (503 `CALLING_UNAVAILABLE`); failed test calls never alert families; attempts Sarvam refused (no attempt id) do not count toward the 2/hour, 5/day test-call limit.
The agent contract (variable names, prompt, tool) is in **`docs/sarvam-agent.md`** and must stay in sync with `lib/sarvam.ts` / `lib/callInterpretation.ts`.

**Tests:** `npx tsx scripts/test-call-pipeline.ts` (146 checks; pure logic + full pipeline on throwaway DB rows with a fake Sarvam,
fake clock and fake email; every dispatch is scoped with `parentIds` so real parents are never touched; cleans up after itself).

Verified live 2026-10-01: webhook payload shape (`interaction_transcript` = array of {role: agent|user, en_text, indic_text}; `output_agent_variables` as in the doc), voicemail pickups end up as `no_response`, and the escalate tool sends bearer auth when its token is a Sarvam Secret **with a value** (an empty secret sends no Authorization header at all). Agent version in use: `SARVAM_APP_VERSION=4`; Sarvam only uses committed versions ("Commit version"), so bump it after every commit.
Local live testing: `ngrok http 3000` gives the fixed free domain `https://clock-monologue-scrounger.ngrok-free.dev`; `NEXT_PUBLIC_APP_URL` in `.env.local` points there (it was `http://localhost:3000`). The Sarvam API key must come from the Voice Agents dashboard (Settings → API Key); a key from the speech-API dashboard gives `401 Invalid API key format`.
Still unverified: per-minute price, DND/NDNC handling, webhook retry behaviour.

## 10. Known remaining issues

- Calling is not live: needs Sarvam account/KYC, agent, `SARVAM_*`, public HTTPS URL (ngrok locally), and an external cron.
- No SMS provider (phone OTP dev-only), no email verification flow, no caregiver invite emails/access, no SMS alerts. WhatsApp is built but not live (Meta setup pending); templates are English only.
- The WhatsApp code reads the columns added 2026-10-01 (applied to the live DB that day). Any other database (a new Supabase project, a restore from an older backup) needs them before this code runs.
- Rate limits are per-process memory (weak on serverless), EXCEPT the Ask limits, which are in the database (`AskUsage`, 2026-10-08, locked down like the other tables). All parent times are treated as IST (single timezone).
- Pricing (reset 2026-10-01 from real Sarvam bills: ₹4.90/min incl. telephony, billed per started minute, ~₹4.90 per call): at 2 calls/day Solo ~57%, Family ~48%, Extended ~51% margin; at the 3-calls/day cap ~37% / ~23% / ~28%. Details in the `plans.ts` comment. Free trial ≈ ₹35-50 of calls per user. GST not included in prices.
- Razorpay plans for the new prices must be created: `npx tsx scripts/create-razorpay-plans.ts` (dry run) then `--confirm`, with real keys; put the printed ids in `RAZORPAY_PLAN_ID_SOLO` / `_FAMILY` / `_EXTENDED`. Plans are immutable in Razorpay, so a price change needs new plans.
- Razorpay live path and Google sign-in are implemented but untested with real credentials.
- 3 old CallLogs in the DB are from earlier tests (left untouched). `db push` is used, not migrations (the call-pipeline columns were applied as reviewed additive SQL; never `--accept-data-loss`).
- A dev server started before a schema change keeps a stale Prisma client: restart `next dev` after schema changes. On Windows `prisma generate` can fail with EPERM while a dev server holds the engine DLL.
- Lint: 8 pre-existing errors (react-hooks set-state-in-effect in data-loading effects, one `any` in onboarding, `prefer-const` in medicineExtractor).
- UI shows sample prescriptions only under `next dev`. Privacy/Terms pages exist but are unreviewed drafts (refund, liability and governing-law clauses are business decisions).
- `scripts/cleanup-e2e-account.ts <claude-e2e-…@example.com> [--confirm]` removes one throwaway test account (dry run by default).
- v1 (2026-10-03): the parent-facing translations (`lib/parentNotices.ts`) are drafts; get native speakers to check them. The Sarvam on-start request format for call-backs is not in Sarvam's public docs (route accepts several field names). Vault files are soft-deleted only (file stays in the bucket). Erasure on consent withdrawal (DPDP) is still manual. Summaries/handled-alert WhatsApp templates need Meta approval. `scripts/backup-database.ts` = read-only JSON backup of every table, written outside the repo.

## 10b. Security hardening (2026-10-05; two sessions + a hunter-based audit, all uncommitted on `v1-care-features`)
Audit notes live outside the repo: `~/security-audit-skill/Saathi-AI/run-1/` (FINDINGS-WAVE1.md, FINDINGS-WAVE2.md; static review only, validators can't run on Windows, so coverage is PARTIAL). Regression checks: `npx tsx scripts/test-security-fixes.ts` (pure, 21 checks) plus the six existing suites (all green, 653 checks).
- Sessions and reset tokens are stored hashed (`hashToken`, `h1_` prefix; old raw rows upgrade on first use). A password change signs out every other device; changing email or phone needs the current password (accounts with no password are exempt).
- CSRF: `requireUser()` and every auth POST route refuse a browser `Origin` that isn't this site (`isCrossSiteRequest`). Server-to-server callers send no Origin and are unaffected.
- Password-reset links are built only from `NEXT_PUBLIC_APP_URL`, never from a request header.
- Dev shortcuts (reset link / OTP in the response, master OTP 123456, sandbox payments) need `NODE_ENV=development` AND a direct loopback request (`lib/devMode.ts`), so a `next dev` shared through ngrok no longer gives them away.
- Security headers + `Cache-Control: no-store` on `/api` in `next.config.ts` (no full CSP yet: Razorpay and Google inject scripts).
- Vault uploads are checked by magic bytes; prescription photo reading is limited to 20/hour per person; invites expire after 14 days; removing a co-manager rotates the emergency-card link and the unused START codes; the "I'm on it" WhatsApp button re-checks the tapper is still in the family circle.
- Emergencies must not be lost: the Sarvam webhook releases its claim and the WhatsApp inbound row is removed if processing fails (so the provider's retry re-runs the alert steps); the cron advances emergency escalations FIRST and reschedules a failed round; stale `scheduled`/`placed` calls are closed and the family is told; the emergency scan reads native-script text too ("but" starts a new clause). A parent's repeated emergency texts raise one alert per 30 minutes.
- Paid trial only for the first paid subscription; verify enforces the plan's parent limit; `scripts/clear-database.ts` and `prisma/seed.ts` refuse to run against the live DB.
- Supabase RLS was OFF with `anon` access (fixed 2026-10-05, see memory `supabase-rls-lockdown`): re-run `scripts/lock-down-database.ts` after any `prisma db push` that adds a table.
- Vault: 300 files / 500 MB per person and 20 uploads/hour per user (`documents/route.ts`). Sarvam routes: set `SARVAM_ESCALATE_SECRET` and/or `SARVAM_INBOUND_CONTEXT_SECRET` (optional, new) so the end-of-call webhook URL token no longer opens the emergency tool or the call-back lookup; update the matching secret in the Sarvam dashboard when you set them. `docs/emergency-phrases-review.md` = sheet for native speakers to check the emergency phrases.
- Family WhatsApp updates now need proof of the number: `NotificationPreferences.whatsappVerifiedAt` (column added 2026-10-05, backup `D:/sathwik/aaptha-db-backups/db-backup-2026-10-05T10-25-20-030Z.json`) is set only when that number sends START to our number; `whatsappRecipient()` returns null until then, STOP clears it for every account on that number. Existing opted-in accounts must send START once. The opt-in screen shows the wa.me START link.
- View-only members can no longer close or "I'm on it" an alert (dashboard and WhatsApp button) or queue messages read to the parent; owner and co-managers only. Paid plans fail closed: `getEffectivePlan` treats a paid plan whose period ended more than `PAID_GRACE_DAYS` (3) ago as lapsed (every Razorpay charge moves `currentPeriodEnd`, so confirm the Razorpay webhook works in test mode before launch). `groqVision.ts` no longer logs prescription text (owner approved 2026-10-05).
- Still open (see the findings files): emergency contacts and `emergencyPhone` are still unproven (a Meta-approved "you were added as a contact" template is needed first); the shared webhook secret (set the two optional per-route secrets); no full CSP; production scheduler / function timeout unchecked; native-script emergency phrases need a native speaker's review; JSON extraction size caps; Privacy page needs a lawyer.

## 11. Open questions for the user
- `preferredLanguage`: not added; `toSarvamLanguage()` derives it from the free-text `language`. Add a column later if needed.
- Hosting/cron provider (Vercel vs other).
- Adopt `prisma migrate` (baseline the current DB)?
