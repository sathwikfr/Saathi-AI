# WhatsApp call updates: setup

Call-related news goes to families on **WhatsApp** (one message per call). **Email is only for account and billing**
(receipts, payment failed, trial ending, cancellation, password reset), plus one safety exception: a level 3–4 alert
(health concern / emergency) that can't be delivered on WhatsApp is emailed instead.

Code: `src/lib/whatsapp.ts` (Meta client + template definitions), `src/lib/familyMessages.ts` (which message, which words),
`src/lib/familyNotify.ts` (delivery + email backup), `src/lib/whatsappInbound.ts` + `/api/whatsapp/webhook` (statuses, button taps,
replies), `/api/account/whatsapp` (opt in / out). Tests: `npx tsx scripts/test-whatsapp.ts`.

## What families get

| Call outcome | Template | Buttons |
|---|---|---|
| Answered, all fine (or only a low mood) | `aaptha_call_result` | Open Aaptha |
| Missed medicine, feeling unwell, couldn't reach (level 2–3) | `aaptha_call_alert` | I'll handle it · Call again · Open Aaptha |
| Emergency (level 4), sent mid-call by the escalate tool | `aaptha_call_emergency` | I'm on it · Open Aaptha |

- **One message per call.** Unanswered attempts that will be retried send nothing; the message comes after the last attempt.
- **I'll handle it / I'm on it** marks the alert as handled (dashboard shows "Handled by you").
- **Call again** places a Saathi call right away (same limits as "Call now": 2/hour, 5/day).
- **STOP** turns WhatsApp off for the account; **START** turns it back on. Any other text gets one automatic reply
  (at most every 12 hours) pointing to the dashboard. Messages from unknown numbers are stored but never answered.
- Families choose in Profile → Call updates: every call result (default) / only when something needs attention /
  only health concerns / only emergencies. Emergencies are always sent.
- **Opt-in is required by Meta.** Nobody gets WhatsApp messages until they turn it on (Profile, or the dashboard prompt);
  the time of consent is stored in `NotificationPreferences.whatsappOptInAt`.

**Before WhatsApp is configured** (no `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`), alerts are emailed exactly as before,
so families never go from getting something to getting nothing. Once configured: opted-in families get WhatsApp only;
families who haven't opted in get level 3–4 alerts by email and everything else on the dashboard.

## 1. Meta account and app

1. Create a **Meta Business portfolio** at business.facebook.com (business name: Aaptha).
2. At developers.facebook.com → **Create app** → type **Business** → add the **WhatsApp** product.
3. WhatsApp → **API Setup** gives a free **test number** that can message up to 5 verified numbers. Add your own number
   there to test everything before Meta approves anything.
4. For real use, add a **phone number** for Aaptha that is **not** registered on the normal WhatsApp / WhatsApp Business app
   (a new SIM or a virtual number that can receive an SMS/voice code). Request the display name **Aaptha**.
5. Start **business verification** (Business Settings → Security Centre). Until it's done, Meta limits how many people
   you can message per day.
6. Add a payment method in WhatsApp Manager (Meta bills per delivered template message; utility messages in India are
   well under ₹1 each; check Meta's current rate card).

## 2. Permanent access token

Business Settings → **Users → System users** → add an admin system user → **Assign assets** (the app + the WhatsApp account,
full control) → **Generate token** with `whatsapp_business_messaging` and `whatsapp_business_management`, expiry **Never**.
The temporary token on the API Setup page expires in 24 hours: don't use it beyond a first test.

## 3. Message templates

**Easiest:** `npx tsx scripts/create-whatsapp-templates.ts --waba <WhatsApp Business account id> --app-url https://<your-domain>`
(dry run), then add `--confirm`. It creates the templates exactly as `WHATSAPP_TEMPLATES` in `src/lib/whatsapp.ts`
defines them; re-running it shows each template's review status. Templates belong to one WhatsApp Business account,
so run it again for the real account when you move off Meta's test number.

To create them by hand instead: WhatsApp Manager → Message templates → Create, category **Utility**, language
**English**, text exactly as below (variables, order, and quick-reply button order must match the code). Use your
final domain in the URL buttons; when the domain changes, edit the templates.

**Category matters.** Meta files promotional-sounding templates under **Marketing** (about 7x the price, and Meta caps
or drops marketing messages per person: an emergency alert could go missing). The first wording (`aaptha_call_update`,
`aaptha_needs_attention`, `aaptha_emergency`, "Open Aaptha for the full call details…") was moved to Marketing on
2026-10-02; the wording below ties every message to the check-in calls the family scheduled. If Meta still picks
Marketing, appeal in WhatsApp Manager (template → Request review).

### `aaptha_call_result`
Body:
```
Your scheduled check-in call with {{1}} has ended. Result: {{2}}

This is an automated update for the care plan you set up on Aaptha.
```
Buttons: **Visit website**, text `Open Aaptha`, URL `https://<your-domain>/dashboard` (static).
Samples: `{{1}}` = `Amma`, `{{2}}` = `Answered the morning call at 09:10 AM. Medicines: Telmisartan taken, Metformin taken. Mood: cheerful.`

### `aaptha_call_alert`
Body:
```
Your scheduled check-in call with {{1}} needs your attention. Details: {{2}}

This alert is part of the care plan you set up on Aaptha.
```
Buttons, in this order: **Quick reply** `I'll handle it` · **Quick reply** `Call again` · **Visit website** `Open Aaptha` → `https://<your-domain>/dashboard`.
Samples: `{{1}}` = `Amma`, `{{2}}` = `Amma said she has not taken Metformin this evening. Call details: Answered the evening call at 08:05 PM.`

### `aaptha_call_emergency`
Body:
```
Urgent alert from your scheduled check-in call with {{1}}: {{2}}

Their phone number is {{3}}. Please call them now.
```
Buttons, in this order: **Quick reply** `I'm on it` · **Visit website** `Open Aaptha` → `https://<your-domain>/dashboard`.
Samples: `{{1}}` = `Amma`, `{{2}}` = `During the afternoon call, Amma may have described an emergency: "chest pain".`, `{{3}}` = `+91 98765 43210`.

### `aaptha_alert_handled` (added 2026-10-03)
Sent to everyone else in the family once someone says "I'm on it" during an urgent alert.
Body:
```
Update on the urgent alert from the check-in call with {{1}}: {{2}} is handling it now.

This update is part of the care plan you set up on Aaptha.
```
Buttons: **Visit website** `Open Aaptha` → `https://<your-domain>/dashboard`.
Samples: `{{1}}` = `Amma`, `{{2}}` = `Ravi (neighbour)`.

### `aaptha_care_summary` (added 2026-10-03)
The daily / weekly / monthly summary, at the hour each family member picked.
Body:
```
Your {{1}} summary of the check-in calls with {{2}}: {{3}}

This summary is part of the care plan you set up on Aaptha.
```
Buttons: **Visit website** `Open Aaptha` → `https://<your-domain>/dashboard`.
Samples: `{{1}}` = `weekly`, `{{2}}` = `Amma`, `{{3}}` = `Medicines taken on 19 of 21 calls (90%). Mood mostly calm. Mentioned knee pain on Tuesday and Friday.`

### `aaptha_medicine_check` (Remind plan, 2026-10-04)
The medicine check sent to the person who takes the medicine (not the family) at each medicine time, and again for
asks 2 and 3 (30 minutes apart) when they tap "Not yet" or don't answer. Category **UTILITY**.
Body:
```
Hi {{1}}, did you take your {{2}} medicine: {{3}}?

This is the medicine check you set up on Aaptha.
```
Buttons (quick replies, in this order): `Yes, taken`, `Not yet`. **No website button** (the person may have no Aaptha account).
Samples: `{{1}}` = `Priya`, `{{2}}` = `8:00 AM`, `{{3}}` = `Folic acid 5 mg (after food), Iron 1 tablet`.
In discreet mode `{{3}}` is `your medicines`.

### `aaptha_caretaker_alert` (Remind plan, 2026-10-05)
To the optional caretaker (husband, parent): a dose not confirmed after 3 asks (at most 2 a day), "not feeling well"
(at most once per 2 hours), or words that may mean an emergency (once per 6 hours). Category **UTILITY**.
Body:
```
Medicine alert for {{1}}: {{2}}

You get this as the caretaker named for the medicine checks set up on Aaptha.
```
Buttons: ONE quick reply, `I'll handle it` (the user's rule: no other option). Tapping it marks the dashboard alert handled
by the caretaker; we send nothing back.
Samples: `{{1}}` = `Priya`, `{{2}}` = `Priya has not confirmed the 8:00 AM medicines (Folic acid, Iron) after 3 reminders. You may want to call Priya on +91 98765 43210.`

### `aaptha_appointment_reminder` (Remind plan, 2026-10-08)
To the person: a doctor / scan / lab visit the family added on the dashboard, once the evening before (from 6 PM IST) and
once the morning of (from 7 AM IST). Category **UTILITY**, no buttons.
```
Hi {{1}}, a reminder: {{2}}

This reminder was set up on Aaptha.
```
Sample: `{{1}}` = `Priya`, `{{2}}` = `Tomorrow at 10 AM: scan at Apollo Clinic. Needs an empty stomach.`

### `aaptha_weekly_progress` (Remind plan, opt-in, 2026-10-08)
To the person, Sunday from 6 PM IST, only if they (or the family) switched "Weekly progress" on and the week had at least 3 checks.
The caretaker gets the same news through `aaptha_caretaker_update` only if that is switched on too. Category **UTILITY**, no buttons.
```
Hi {{1}}, your week: {{2}}

This weekly summary was set up on Aaptha.
```
Sample: `{{1}}` = `Priya`, `{{2}}` = `This week you confirmed 13 of 14 medicine checks. Well done! 💪`

### Translations (Remind plan, 2026-10-08)
`aaptha_medicine_check`, `aaptha_appointment_reminder` and `aaptha_weekly_progress` also exist in hi, te, ta, kn, ml, bn, mr, gu
(`src/lib/waTranslations.ts`; `npx tsx scripts/create-whatsapp-templates.ts --waba <id> --app-url <https url> --languages all --confirm`).
They are **drafts**: have a native speaker check them first. The person's language is `ParentProfile.language` (picked in the
Remind setup wizard). If a translation isn't approved yet, Meta answers error 132001 and the app sends the English template instead.
The person's free-text replies are translated too (`repliesFor`); everything to the caretaker and the family stays English.

### `aaptha_caretaker_update` (Remind plan, 2026-10-04)
Good news after an alert: the dose was taken after all. Category **UTILITY**. Same body as above with "Medicine update for".
```
Medicine update for {{1}}: {{2}}

You get this as the caretaker named for the medicine checks set up on Aaptha.
```
No buttons. Samples: `{{1}}` = `Priya`, `{{2}}` = `Good news: Priya has now confirmed the 8:00 AM medicines (at 9:42 AM).`

(`aaptha_medicine_reminder` from the first version is no longer sent; don't submit it, or delete it if it was.)

`scripts/create-whatsapp-templates.ts` submits all eight; re-run it (dry run first) to add new ones. **Submit the three Remind
templates early:** the Remind plan sends nothing until Meta approves them.
Meta may file a summary under MARKETING; if it does, reword it to be more transactional before families rely on it.

**Remind plan: the person and their caretaker message this number too.** Each starts with their own link from onboarding /
the dashboard (`https://wa.me/<our number>?text=START <code>`; a code changes once used). The person taps Yes, taken / Not yet (or types it: "yes / haan / avunu / done / 👍", "no / nahi / ledu / not yet" count the same, on today's latest open check);
"Not yet" or no reply is asked again every 30 minutes, 3 asks in all; still no Yes 30 minutes later -> the caretaker (optional)
gets `aaptha_caretaker_alert` (at most 2 a day). **No spam** (the user's rule, 2026-10-05): other messages get no reply at all,
and repeated symptom / emergency messages within the gap get nothing more. Both can reply STOP / START. Anything else the person writes is checked for
emergency words (incl. pregnancy warning signs): one warm message (it still mentions 108), the caretaker is alerted at once and a
level-4 dashboard alert is raised, then nothing more for 6 hours. Everyday symptoms (fever, headache, dizziness, …, 9 languages)
get a kind reply, the caretaker is alerted (at most once per 2 hours) and a level-3 alert is raised. **"Pause today"** (2026-10-05:
"pause", "not today", "aaj nahi", "ఈరోజు వద్దు", … `parsePauseToday`): today's open checks are marked paused (never missed, no
caretaker alert), one reply says when they start again, and they restart by themselves at midnight IST. **Tablets running out:** if the family set a tablet count (dashboard, Medicines tab) each Yes counts one dose down;
when about 3 days are left the "Noted" reply adds one line ("Iron is running low: 6 tablets left, about 3 days. Once you buy
more, reply with the name and number, like "Iron 30""), once per refill. No separate message, so no template. The person's
reply "Iron 30" (or just "30" when only one medicine is counted) resets the count. Other text: no reply.
Code: `lib/reminders.ts`.

**Calling-plan parents can write "pause today" too** (`lib/whatsappInbound.ts`): no more calls that day, one reply with the
next call time, one level-2 alert to the family ("Asked for no calls today"), calls restart at midnight IST. Checked after
the emergency scan, so "not today, chest pain" is still an emergency.

**How many family members get WhatsApp updates** (calling plans): Solo 1, Family 2, Extended 5 (owner first, then family
members in the order they joined, counting only those who opted in). Urgent (level 4) alerts go to everyone who opted in.
People whose number is not +91 start on "only when something needs attention + one daily summary" (foreign messages cost more).

**Parents can also message this number.** A message (or screenshot) from a parent's phone gets the scam check: a short
reply in their language, never "this is safe", and a dashboard alert for the family when it looks like a scam.
That reply is free-form, which WhatsApp allows within 24 hours of the parent's own message.

Approval usually takes minutes to a few hours. A template that is rejected or not yet approved makes sends fail with
error 132001; level 3–4 alerts then fall back to email.

## 4. Webhook

Meta app → WhatsApp → **Configuration** → Webhook:
- Callback URL: `https://<your-domain>/api/whatsapp/webhook`
- Verify token: the value of `WHATSAPP_VERIFY_TOKEN`
- Then **Manage** → subscribe to the **messages** field (this carries both replies and delivery statuses).

The POST is checked against `WHATSAPP_APP_SECRET` (App settings → Basic → App secret); unsigned or wrongly signed requests get 401.
Locally, use the ngrok URL from `docs/sarvam-agent.md`.

## 5. Environment keys (`.env.local` locally, Vercel → Settings → Environment Variables in production)

| Key | Where it comes from |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Step 2 (permanent system-user token) |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API Setup → **Phone number ID** (not the number itself) |
| `WHATSAPP_APP_SECRET` | App settings → Basic → App secret |
| `WHATSAPP_VERIFY_TOKEN` | Any random string of 16+ characters; the same value goes in the webhook settings |
| `WHATSAPP_API_VERSION` | Optional, default `v23.0` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Optional, default `en` (must match the templates' language) |
| `WHATSAPP_BUSINESS_NUMBER` | Optional: our WhatsApp number for the START links (e.g. `+15551697486`). Without it the app asks Meta for the display number once and keeps it for 12 h |

`npm run check:setup` reports which are missing (never prints values). WhatsApp switches on as soon as the token and
phone number id are set; redeploy after adding them on Vercel.

## 6. Live test

1. Opt in on your own account (dashboard prompt or Profile → Call updates) with a number added to the test number's list.
2. Place a test call from the dashboard and answer it: you should get `aaptha_call_result` (or `aaptha_call_alert` if you say you skipped a medicine).
3. Tap **I'll handle it**: the alert on the dashboard shows "Handled by you", and WhatsApp replies with a confirmation.
4. Reply `STOP`, then `START`.
5. Remind plan: add yourself on a Remind account with a second phone as caretaker; tap **Open WhatsApp and send START** on
   both phones. At the next medicine time (the cron sends it within ~5 minutes) tap **Not yet**, then don't answer: after
   3 asks the caretaker phone gets "has not confirmed…". Tap **Yes, taken** on the last ask: the caretaker gets "Good news…".
5. `WhatsAppMessage` rows show each message's status moving sent → delivered → read.
