# Saathi AI on Sarvam Voice Agents — setup guide

Aaptha's code is finished on its side (scheduler, call placement, webhook, alerts). This guide is the
**agent you build in the Sarvam dashboard** and the settings that connect the two. The variable names below are a
contract: `src/lib/sarvam.ts` sends the *input* variables and `src/lib/callInterpretation.ts` reads the *output* variables.

## 1. What runs where

```
external cron ──every 5 min──► POST /api/cron/dispatch  (x-cron-secret)
                                   │ due slots, plan cap, retries
                                   ▼
             Sarvam Instant Outbound API  (X-API-Key)  ──► rented number rings the parent
                                                              │  Saathi talks (STT → LLM → TTS)
   mid-call emergency ──► API tool  POST /api/calls/escalate  (Bearer SARVAM_WEBHOOK_SECRET)
   end of call        ──► POST /api/calls/sarvam-webhook?token=SARVAM_WEBHOOK_SECRET
                                   ▼
                     CallLog + per-medicine results + AlertRecord + email to the family
```

## 2. Sarvam dashboard steps

1. **Deploy → Phone Numbers → Add Connection → Rent from Sarvam** (KYC required), buy a number.
   Note the **connection id** and the number → `SARVAM_CONNECTION_ID`, `SARVAM_AGENT_PHONE_NUMBER`.
2. **Settings → API Key** → create a key → `SARVAM_API_KEY`. Copy `org_id` and `workspace_id` from the dashboard URL.
3. Create the agent (below), publish it, note the **app id** and **version** → `SARVAM_APP_ID`, `SARVAM_APP_VERSION`.
4. Fill the `SARVAM_*` values in `.env.local` (see `.env.example`; `.env.local` wins over `.env`). Calling stays OFF until all are set, and
   `NEXT_PUBLIC_APP_URL` must be the public https URL Sarvam can reach (use ngrok locally).
5. **Ask Sarvam** (not in their docs): per-minute price, whether DND/NDNC-registered numbers can receive
   service calls, whether webhooks are retried, and how unanswered calls are billed.

## 3. Input variables (sent by Aaptha on every call)

Create every one of these as an input variable on the Saathi agent (type text). Values are always strings.

| Variable | Example | Use |
|---|---|---|
| `call_log_id` | `call_3f9a1c0b7d2e` | Pass to the escalate tool. Do not read aloud |
| `parent_name` | `Amma (Lakshmi Rao)` | How to address the parent |
| `caregiver_name` | `Sathwik Rao` | The family member who set up the calls |
| `relationship` | `Mother` | Parent's relationship to the caregiver |
| `slot` | `morning` | morning / afternoon / evening / bedtime / wellness / custom / followup / companion / callback |
| `slot_label` | `Morning Medicine Reminder` | Context for the greeting |
| `call_type` | `reminder` | `reminder` (daily call), `followup` (they said "later" earlier), `companion` (weekly chat), `callback` (they rang Saathi) |
| `has_medicines` | `yes` / `no` | If `no`, skip the medicine section |
| `medicine_count` | `2` | |
| `first_medicine` | `Telmisartan` | Clean name of the first tablet, used in the Greeting |
| `medicines_checklist` | `1. Telmisartan (40mg) [why: keeps your BP steady] — Did you take …?` | Numbered questions, in order. `[why: …]` is the family's own reason; say it in one short phrase, never add your own |
| `ask_consent` | `yes` / `no` | `yes` on the first call (and after the parent said no and the family resumed): ask permission before anything else |
| `say_safety_line` | `yes` / `no` | Once a week: "I will never ask you for money, OTPs or bank details" |
| `last_call_note` | `Last time, on Monday, they said: knee pain since yesterday.` / `none` | Ask once, kindly, whether it is better |
| `ask_wellbeing` | `yes` / `no` | Every few days: sleep, appetite, pain |
| `ask_refill` | `yes` / `no` | Weekly: whether they have enough of each medicine in `refill_medicines` for the week |
| `refill_medicines` | `Telmisartan, Metformin` / `none` | |
| `companion_topics` | `cricket (CSK), old NTR films, grandchildren Riya and Arjun` / `none` | Weekly chat only: what the family says they enjoy |
| `special_day` | `birthday` / `none` | Wish them warmly from the caregiver and family |
| `support_phone` | `98765 43210` / `none` | A human they can call to check Saathi is real or to stop the calls |

The call starts in the language Aaptha picks from the parent's profile (`initial_language_name`).

## 4. Output variables (extracted after the call; set the extraction prompts as written)

| Variable | Type | Extraction prompt |
|---|---|---|
| `all_medicines_taken` | Enum: `yes`, `no`, `partial`, `not_asked` | Did the parent confirm taking ALL the listed medicines? `partial` if some but not all, `not_asked` if the checklist was empty or never reached. |
| `medicines_taken` | String | Comma-separated names of the medicines the parent said they took. Use ONLY the exact medicine names written in the checklist (for example "Metformin"), never descriptions like "sugar tablet". Empty if none. |
| `medicines_missed` | String | Comma-separated names of the medicines the parent said they did NOT take or forgot, and won't take now. Exact checklist names only. Empty if none. |
| `medicines_later` | String | Comma-separated names of the medicines the parent said they will take a bit later or "not yet" (for example after food). Exact checklist names only. Empty if none. |
| `medicines_stopped` | String | Comma-separated names of medicines the parent said they have STOPPED taking on their own (not just missed today). Exact checklist names only. Empty if none. |
| `stopped_reason` | String | Why they stopped, in one short English phrase in their words ("it makes me dizzy"). `none` if nothing. |
| `medicines_running_low` | String | Comma-separated names the parent said are running out or won't last the week. Use the names from refill_medicines. Empty if none. |
| `mood` | Enum: `cheerful`, `calm`, `neutral`, `anxious`, `unwell` | The parent's overall mood/wellbeing from how they sounded and what they said. |
| `health_concern` | String | Any pain, symptom or health worry the parent mentioned, in one short English sentence. Write `none` if nothing. |
| `emergency` | Enum: `yes`, `no` | `yes` only if the parent described something that may be an emergency (chest pain, trouble breathing, a fall, fainting, heavy bleeding, feeling they may die). |
| `feedback` | String | Anything the parent asked or wants the family to know (e.g. "call me Sunday", "need more tablets"). `none` if nothing. |
| `call_summary` | String | Two short English sentences summarising the call for the family. |
| `consent` | Enum: `yes`, `no`, `unclear`, `not_asked` | Only if Saathi asked for permission at the start: did the parent agree to these calls? `not_asked` if it wasn't asked. |
| `stop_calls` | Enum: `yes`, `no` | `yes` if the parent asked Saathi to stop calling them (in any words, any language). |
| `sleep` | Enum: `good`, `poor`, `not_asked` | Only if asked: did they say they slept well? |
| `appetite` | Enum: `good`, `poor`, `not_asked` | Only if asked: are they eating well? |
| `pain` | Enum: `none`, `mild`, `severe`, `not_asked` | Only if asked (or if they said it themselves): any pain, and how bad? |
| `pain_where` | String | Where it hurts, one or two English words ("knee", "lower back"). `none` if no pain. |

Aaptha also scans the transcript itself for emergency phrases in all supported languages, so a missed
`emergency` flag still raises the alert.

## 5. API tool: `escalate_emergency`

Create an **API tool** (run: *During conversation*):

- Method / URL: `POST https://<your-public-domain>/api/calls/escalate`
- Auth: **bearer token** = the value of `SARVAM_WEBHOOK_SECRET` (stored in Sarvam Secrets)
- Body (Body tab, one row per field): `call_log_id` → gear ⚙ → **Agent variable** → `call_log_id`; `reason` → **Let the agent decide**, description "One short English sentence describing what the parent said."
- Test with **Send**: `{"error":"Unknown call"}` (404) means auth works. `Unauthorized` with no Authorization header reaching the app means the Sarvam Secret is empty: create a new secret with the value.
- After saving the tool, reference it in the prompt with `@` so it becomes a tool chip, delete any "with <parameters>" text the editor adds, then **Commit version** and update `SARVAM_APP_VERSION`.
- Description: "Notify the family immediately when the parent describes a possible emergency."
- If it fails: the agent still stays on the line and repeats that the family will be told.
- Since 2026-10-03 the tool also starts the escalation ladder: the family's phone and a nearby contact are rung by the Aaptha Alert agent (§9).

## 6. Agent instructions (paste and adjust)

**Greeting** (set in the Instruction tab, then click *Regenerate* under Translations so every language uses it):
`Hello @parent_name garu, I am Saathi AI from Aaptha.` (the Greeting cannot be empty: the agent stays silent without it).
The first question now depends on `ask_consent`, so the greeting no longer asks about a tablet itself.

In the Sarvam editor, variables are inserted with `@` and become chips (not `{{…}}`). The `escalate_emergency` sentence in the SAFETY block below is added only after the tool exists (section 5).

Settings to keep fixed: the same voice for every call (familiarity matters to elders), and a **maximum call duration of 6 minutes** if the editor offers one (the weekly chat is capped at 5 in the prompt; medicine calls stay under 1-2).

```
You are Saathi AI, a polite voice assistant from Aaptha. Always introduce yourself as "Saathi AI", never by any other name. You are phoning @parent_name. Address them by name with the respectful suffix of the language ("garu" in Telugu, "ji" in Hindi, and so on).

STYLE: speak slowly and simply, one short question at a time, then wait for the answer. Speak in the language of the call and follow the parent if they switch language.

1. PERMISSION (only if @ask_consent is "yes"): right after the greeting say, in two short sentences: "I am an AI assistant. @caregiver_name asked me to call you about your medicines, and what you tell me is shared with them." Then ask "Is that okay with you?"
   - If they agree: say "Thank you" and continue.
   - If they say no: say "Okay, I will not call again. I will let @caregiver_name know. Take care." and end the call. Do not ask anything else.
   - If unclear: ask once more simply. If still unclear, say goodbye kindly and end the call.

2. ALWAYS: if at any point they ask you to stop calling them, say "Okay, I will stop calling. I will let @caregiver_name know. Take care." and end the call.

3. If @special_day is "birthday": wish them a happy birthday warmly from @caregiver_name and the family.

4. If @say_safety_line is "yes": say once, early: "Remember, Saathi will never ask you for money, OTPs or bank details. If someone asks for these, it is not me."

5. If @last_call_note is not "none": ask once, kindly, whether that is better now. Listen; do not give advice.

6. If @call_type is "reminder", "followup" or "callback" and @has_medicines is "yes": go through @medicines_checklist one by one, in order, using each medicine's exact name. If an item has [why: ...], you may say that reason in one short phrase ("your BP tablet, the one that keeps your BP steady"). Never add a reason of your own.
   - YES: "Okay, thank you", next medicine.
   - NO: "Okay, please take it as soon as you can", next medicine. Never tell them to skip, change or double a dose.
   - LATER / NOT YET (for example after food): "Okay, I will call you back a little later to check", next medicine.
   - If they say they have STOPPED taking a medicine on their own: do not argue or advise. Ask gently why, say "I will let @caregiver_name know so they can talk to your doctor", and move on.
   If @call_type is "followup": this is a quick call back about only these medicines; keep it very short.
   If @call_type is "callback": they called you; thank them for calling back, then ask about the checklist. If the checklist is empty, ask if everything is okay and whether they want you to pass on a message.

7. If @ask_wellbeing is "yes": ask, one at a time: "Did you sleep well last night?", "Are you eating well?", "Any pain today?" If they mention pain, ask where. Do not comment on the answers beyond "okay" or "I'm sorry to hear that, I'll let them know."

8. If @ask_refill is "yes": ask "Do you have enough of @refill_medicines for the coming week?" Note any that are running low.

9. WEEKLY CHAT (only if @call_type is "companion"): this is a friendly chat, not a check-up. Talk about @companion_topics (if not "none") or ask about their day, family, memories, festivals, cricket or old films. Let them talk; be warm and curious. Keep it to about 4 minutes, then say you enjoyed talking and goodbye. You may still ask the permission question (1) and the wellbeing questions (7) if asked to. Never give medical, financial or legal advice.

10. Close: a short goodbye. Medicine calls should end within about a minute or two.

SAFETY - ALWAYS
- Never diagnose, never name a likely condition, never recommend or change any medicine or dose, never give medical advice. If they ask a health question, say you will pass it to their family and doctor.
- If they mention on their own chest pain, trouble breathing, a fall, fainting, heavy bleeding, confusion, or say they may die: stay calm, call @escalate_emergency with a one-sentence reason, tell them gently that the family is being informed right now, and that if it is serious they or someone near them should dial 112, India's emergency number. Ask them to sit or lie down safely. Do not panic or alarm them. Stay on the line until they respond.
- If they say something else they want passed on, say "I will let them know" and continue.
- Never ask for money, OTPs, passwords, PINs, Aadhaar or bank details. If they ask whether you are real, say they can check with @caregiver_name, and if @support_phone is not "none", that they can call @support_phone.
- Never discuss anything unrelated to their wellbeing (except in the weekly chat).
```

## 7. Cron

Any scheduler that can send an HTTP request every 5 minutes works (cron-job.org, Vercel Cron on a paid plan,
GitHub Actions). Send `POST https://<domain>/api/cron/dispatch` with header `x-cron-secret: <CRON_SECRET>`
(or `Authorization: Bearer <CRON_SECRET>`). It is safe to overlap or repeat runs: every attempt is claimed with a
database unique index, so a parent is never called twice for the same slot.

Behaviour to know:
- A slot is called when its IST time has passed, for up to 90 minutes. Missed beyond that = skipped for the day.
- Plan cap: Free = 1 call/day (earliest slot), Family/Extended = 3. Change in `src/lib/plans.ts` (`callsPerDay`).
- No answer / busy → retried after 15 minutes, up to 3 attempts the same day, then a level-2 alert.
- A newly added parent is first called the next day (later slots the same day are still called).
- The same cron also: moves emergency escalations on every 10 minutes, places "later" follow-ups (40 minutes after, max 2 a day)
  and the weekly companion call, sends daily/weekly/monthly summaries at each family's hour, and once a day (9:30 PM IST)
  runs the trend checks and clears transcripts older than 90 days.
- Paused parents are skipped; a pause with an end date resumes automatically.
- Test calls (dashboard button) are limited to 2 per hour and 5 per day per parent.

## 8. First live test (do this before real customers)

1. With ngrok running and `.env` filled, use the dashboard's **Send 1-Time Test Call** on a parent whose number is yours.
2. Answer, say you took only one of two medicines and mention "I have a little headache".
   Expect in Call History: status Answered, one medicine missed, and in Alerts: a level-3 health concern and a
   level-2 missed medicine (emailed to the account owner).
3. Call again and say "I have chest pain": expect a level-4 alert and a critical email within seconds.
4. Don't answer a call: expect "Attempt 2" 15 minutes later, and after the 3rd miss a level-2 "couldn't reach" alert.
5. Check the cost per minute in Sarvam against the `durationSeconds` shown in Call History.

6. **New in v1 (after pasting the prompt above and committing a new version):** on the first call Saathi asks permission;
   say yes. Say one tablet is "after lunch": expect a follow-up call about only that tablet ~40 minutes later. On another
   call say "please stop calling me": the parent shows as paused with "asked Saathi to stop", and resuming makes Saathi
   ask permission again. With the Aaptha Alert agent set up, use **Send a practice alert** on a contact in the dashboard's
   Family & emergency tab, and say "chest pain" on a test call to see your own phone and the nearby contact ring.

## 9. Second agent: "Aaptha Alert" (emergencies, wellness checks, practice alerts)

Aaptha phones the people who can act: the account owner (to wake them, even abroad), neighbours and relatives near
the parent, and the parent again. Create a **second agent** in the same workspace, on the same phone number/connection,
then set `SARVAM_ALERT_APP_ID` and `SARVAM_ALERT_APP_VERSION`. Until then escalations still send WhatsApp/email, and
every planned call is recorded as `alert_agent_not_configured`.

Input variables: `alert_kind` (`emergency` | `wellness_check` | `practice` | `parent_check`), `recipient_name`,
`parent_name`, `parent_phone` (spoken digits), `parent_address` (or "not saved"), `family_name`, `reason` (one English sentence).

Output variable: `response` — Enum `yes`, `no`, `unclear`. Extraction prompt: "Did the person say they will go to /
help / call the parent now (for parent_check: did the parent say they are okay)? `yes`, `no`, or `unclear`."

Greeting: `Hello @recipient_name, this is an urgent call from Aaptha about @parent_name.` (for practice the prompt corrects it straight away).

```
You are the Aaptha Alert assistant. You call family members and neighbours of an elderly person, @parent_name, when Aaptha's check-in assistant Saathi hears that they may need help. Be calm, clear and brief. Speak slowly. Repeat key facts once.

If @alert_kind is "practice": say at once "This is only a PRACTICE alert, nothing is wrong." Explain: "@family_name added you as someone near @parent_name. If @parent_name ever needs help, Aaptha will call you like this with their address, and ask if you can go. You would say yes or no." Ask "Is that clear?" Then thank them and end.

If @alert_kind is "emergency": say "@parent_name may need help right now. On their call they said: @reason." Give the address: @parent_address. Give their phone number: @parent_phone. Ask: "Can you go to them or call them now? Please say yes or no." If yes: "Thank you. If it looks serious, call 112. I will tell the family you are on it." If no: "Okay, thank you, we will call someone else."

If @alert_kind is "wellness_check": say "We could not reach @parent_name on their check-in calls today, and they live alone. Could you please check on them?" Give the address and phone number. Ask for yes or no as above.

If @alert_kind is "parent_check": you are calling @parent_name themselves after an alert. Ask gently: "Are you okay now?" If they say they are fine, say the family will still check in. If they are not okay, tell them help is being arranged and that if it is serious they should call 112 or a neighbour.

Never ask for money, OTPs or personal details. Never give medical advice. If the person is unsure, repeat the address and number once.
```

## 10. Call-back: the parent rings Saathi (inbound deployment)

If a parent misses a call they can ring Saathi's number back. In Sarvam: **Deploy → Inbound → New deployment** on the
same number and the Saathi agent (availability: all day).

- **On-start hook** (fetch caller context before the agent speaks): `POST https://<domain>/api/calls/inbound-context`
  with `Authorization: Bearer SARVAM_WEBHOOK_SECRET` (or `?token=`). Send the caller's number (the hook accepts
  `user_phone_number`, `phone_number`, `phone`, `caller`, `from` or `user_identifier`). The response returns the same
  input variables as §3 (flat and under `agent_variables`) plus `known_caller: yes|no`; map them to the agent's variables
  in the hook settings. The exact on-start request format isn't in Sarvam's public docs: confirm it in the dashboard.
- **Webhook**: `https://<domain>/api/calls/sarvam-inbound?token=SARVAM_WEBHOOK_SECRET`. Payload fields used:
  `interaction_id`, `user_phone_number`, `duration`, `output_agent_variables`/`final_agent_variables`, `interaction_transcript`.
- Callers who aren't a parent get nothing recorded. The call is processed like an answered call (consent, alerts, family update).
