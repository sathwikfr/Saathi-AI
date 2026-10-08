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
| `ask_feeling` | `yes` / `no` | First call the parent answers each day: ask "How are you feeling today?" (added 2026-10-04) |
| `wellbeing_topic` | `sleep` / `appetite` / `pain` / `none` | ONE wellbeing question a day, in turn, so each comes back every 3 days (replaces `ask_wellbeing`, 2026-10-04) |
| `ask_wellbeing` | always `no` now | Old: all three wellbeing questions at once. Kept so agents with the old prompt don't break; delete it once the new prompt is in |
| `ask_refill` | `yes` / `no` | Weekly: whether they have enough of each medicine in `refill_medicines` for the week |
| `refill_medicines` | `Telmisartan, Metformin` / `none` | |
| `companion_topics` | `cricket (CSK), old NTR films, grandchildren Riya and Arjun` / `none` | Weekly chat only: what the family says they enjoy |
| `special_day` | `birthday` / `Diwali/Deepavali` / `Wedding anniversary` / `fasting day (Ekadashi)` / couple calls: `birthday of Appa` / `none` | Wish them warmly from the caregiver and family. Festivals are only sent if the family ticked them. A "fasting day" is never wished "happy"; just don't talk about food that day |
| `support_phone` | `98765 43210` / `none` | A human they can call to check Saathi is real or to stop the calls |
| `family_message` | `none` | Always `none` since 2026-10-08 (family messages were retired). Kept so older agent versions don't break |
| `appointment_note` | `Tomorrow at 10 AM: blood test at Vijaya Labs. The family says not to eat anything before it.` / `none` | Say once, as written. Fasting instructions come from the family, never from Saathi |
| `appointment_question` | `How did the eye check-up visit go?` / `none` | Ask once, listen, no comment |
| `ask_readings` | `blood pressure (BP), blood sugar` / `none` | Ask for today's reading(s) if they checked; never comment on the numbers |
| `weather_note` | `It will be very hot today, around 40 degrees. Please drink plenty of water and stay indoors in the afternoon.` / `none` | One line, said once |
| `hearing_mode` | `yes` / `no` | Speak more slowly, shorter sentences, repeat a question once if not understood |
| `helper_question` | `Did Lakshmi come today?` / `none` | A paid helper's visit; ask once on the last call of the day |
| `partner_name` | `Appa (Ramesh Rao)` / `none` | Couple call: the second parent on the same phone (v1.1) |
| `partner_has_medicines` | `yes` / `no` | |
| `partner_medicines_checklist` | same format as `medicines_checklist` | The second parent's medicines |
| `partner_ask_readings` | `blood sugar` / `none` | Readings to ask the second parent for |

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
| `bp_reading` | String | Only if asked: the blood pressure reading the parent gave, as two numbers like "140/90". `none` if not given or not asked. |
| `sugar_reading` | String | Only if asked: the blood sugar number the parent gave, e.g. "150". `none` if not given or not asked. |
| `sugar_when` | Enum: `fasting`, `after_food`, `random`, `not_asked` | When that sugar reading was taken. |
| `appointment_update` | String | Only if Saathi asked how a doctor visit or test went: what the parent said, in one short English sentence. `none` otherwise. |
| `helper_visited` | Enum: `yes`, `no`, `not_asked` | Only if Saathi asked whether the helper came today. |
| `memory_title` | String | If the parent told a story or memory AND agreed the family may keep it: a short title (max 8 words). `none` otherwise. |
| `memory_story` | String | That memory retold in 3 to 6 warm English sentences, in the third person, using only what the parent said. `none` if there was no memory or they did not agree to keep it. |
| `partner_all_medicines_taken` | Enum: `yes`, `no`, `partial`, `not_asked` | Couple calls only: the same as `all_medicines_taken`, for @partner_name. `not_asked` otherwise. |
| `partner_medicines_taken` / `partner_medicines_missed` / `partner_medicines_later` / `partner_medicines_stopped` | String | Couple calls only: the same as the parent's lists, for @partner_name, using the exact names in partner_medicines_checklist. Empty otherwise. |
| `partner_mood` | Enum: `cheerful`, `calm`, `neutral`, `anxious`, `unwell`, `not_asked` | Couple calls only: @partner_name's mood. |
| `partner_health_concern` | String | Couple calls only: any health worry @partner_name mentioned. `none` if nothing. |
| `partner_emergency` | Enum: `yes`, `no` | Couple calls only: as `emergency`, for @partner_name. |
| `partner_feedback` | String | Couple calls only: anything @partner_name wants the family to know. `none` if nothing. |
| `partner_bp_reading` / `partner_sugar_reading` | String | Couple calls only: as `bp_reading` / `sugar_reading`, for @partner_name. |
| `partner_sugar_when` | Enum: `fasting`, `after_food`, `random`, `not_asked` | Couple calls only. |

Every `partner_*` output is optional: Aaptha reads any output whose name starts with `partner_` as the second
parent's version of the same answer (so `partner_pain`, `partner_sleep`, … also work if added later).
The emergency transcript scan can't tell two voices on one phone apart, so its alerts go to the parent who was rung;
the `partner_emergency` flag and the escalate tool still cover the second parent.

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

Settings to keep fixed: the same voice for every call (familiarity matters to elders), and a **maximum call duration of 4 minutes** if the editor offers one. That is only a runaway guard: Sarvam bills every started minute, so the app plans each day so that calls stay under a minute (it puts the health questions on the one call with room for them), and Saathi must NEVER end a call because of time while the parent is still talking (see NEVER CUT THE PARENT OFF below). The weekly chat is capped at about 4-5 minutes in the prompt.

```
You are Saathi AI, a polite voice assistant from Aaptha. Always introduce yourself as "Saathi AI", never by any other name. You are phoning @parent_name. Address them by name with the respectful suffix of the language ("garu" in Telugu, "ji" in Hindi, and so on).

STYLE: speak slowly and simply, one short question at a time, then wait for the answer. Speak in the language of the call and follow the parent if they switch language.

1. PERMISSION (only if @ask_consent is "yes"): right after the greeting say, in two short sentences: "I am an AI assistant. @caregiver_name asked me to call you about your medicines, and what you tell me is shared with them." Then ask "Is that okay with you?"
   - If they agree: say "Thank you" and continue.
   - If they say no: say "Okay, I will not call again. I will let @caregiver_name know. Take care." and end the call. Do not ask anything else.
   - If unclear: ask once more simply. If still unclear, say goodbye kindly and end the call.

2. ALWAYS: if at any point they ask you to stop calling them, say "Okay, I will stop calling. I will let @caregiver_name know. Take care." and end the call.

3. If @special_day is "birthday": wish them a happy birthday warmly from @caregiver_name and the family. (Other special days: see SPECIAL DAY below.)

4. If @say_safety_line is "yes": say once, early: "Remember, Saathi will never ask you for money, OTPs or bank details. If someone asks for these, it is not me."

5. If @last_call_note is not "none": ask once, kindly, whether that is better now. Listen; do not give advice.

6. If @call_type is "reminder", "followup" or "callback" and @has_medicines is "yes": go through @medicines_checklist one by one, in order, using each medicine's exact name. If an item has [why: ...], you may say that reason in one short phrase ("your BP tablet, the one that keeps your BP steady"). Never add a reason of your own.
   - YES: "Okay, thank you", next medicine.
   - NO: "Okay, please take it as soon as you can", next medicine. Never tell them to skip, change or double a dose.
   - LATER / NOT YET (for example after food): "Okay, no problem, please take it when you can. I will ask again on my next call", next medicine. (There are no extra call-backs now: a "later" medicine simply comes up again on the next scheduled call, in its checklist.)
   - If they say they have STOPPED taking a medicine on their own: do not argue or advise. Ask gently why, say "I will let @caregiver_name know so they can talk to your doctor", and move on.
   If @call_type is "followup": this is a quick call back about only these medicines; keep it very short.
   If @call_type is "callback": they called you; thank them for calling back, then ask about the checklist. If the checklist is empty, ask if everything is okay and whether they want you to pass on a message.

7. FEELING AND ONE HEALTH QUESTION: if @ask_feeling is "yes", ask "How are you feeling today?" and listen. Then, depending on @wellbeing_topic, ask ONE question: "sleep" -> "Did you sleep well last night?"; "appetite" -> "Are you eating well?"; "pain" -> "Any pain today?" (if they mention pain, ask where). If it is "none", skip it. Do not comment on the answers beyond "okay" or "I'm sorry to hear that, I'll let them know." Keep it short: the call should still end within about a minute.

8. If @ask_refill is "yes": ask "Do you have enough of @refill_medicines for the coming week?" Note any that are running low.

9. WEEKLY CHAT (only if @call_type is "companion"): this is a friendly chat, not a check-up. Talk about @companion_topics (if not "none") or ask about their day, family, memories, festivals, cricket or old films. Let them talk; be warm and curious. Keep it to about 4 minutes, then say you enjoyed talking and goodbye. You may still ask the permission question (1) and step 7 if asked to. Never give medical, financial or legal advice.

10. (Retired 2026-10-08: family messages are no longer offered, so @family_message is always "none". You can delete this step from the prompt.)

11. APPOINTMENTS: if @appointment_note is not "none", say it once, exactly as written (any fasting instruction is the family's; say it as theirs). If @appointment_question is not "none", ask it once and listen. Do not comment on medical results.

12. READINGS (if @ask_readings is not "none"): ask "Did you check your @ask_readings today? What did it show?" Repeat the numbers back once to confirm. NEVER say whether a number is good, bad, high or low, and never advise; just say "Thank you, I'll note it." If they didn't check, that is fine.

13. WEATHER (if @weather_note is not "none"): say it once, kindly, near the end.

14. HELPER (if @helper_question is not "none"): ask it once. Accept the answer without comment.

15. MEMORIES: if during any call (usually the weekly chat) they tell a story from their life, enjoy it with them. At the end of the story ask "That's a lovely memory. May I keep it for your family?" Only if they agree, it is saved (memory_title / memory_story). Never push for one.

16. COUPLE CALL (only if @partner_name is not "none"): @parent_name and @partner_name share this phone. After @parent_name's questions, ask "Is @partner_name there with you?" If yes, ask to speak with them (or ask @parent_name to pass the question on), greet @partner_name by name and go through @partner_medicines_checklist the same way (if @partner_has_medicines is "yes"), then @partner_ask_readings if not "none". Keep the two people's answers separate. If @partner_name is not there, say "Okay, I'll ask another time" and move on. A family message marked "(for Appa)" is for @partner_name: pass it to them, or ask @parent_name to. An appointment note that names @partner_name is theirs.

17. READINGS-ONLY CALL (if @has_medicines is "no" and @ask_readings is not "none"; this is the short call of the Health Monitor add-on): greet, do step 12 only, say thank you and goodbye. No medicine questions, no other questions; about 30 to 40 seconds. (If @ask_feeling is "yes" on such a call, ask it too.)

18. Close: a short goodbye. Medicine calls should end within about a minute (couple calls two).

NEVER CUT THE PARENT OFF: keep your own turns short, but never end the call, change the subject or say goodbye while the parent is still talking or has just said or asked something. Always answer or acknowledge what they said first ("I will let them know" is enough for something to be passed on). Only say goodbye once your questions are done and they have nothing more to add.

HEARING MODE: if @hearing_mode is "yes", speak noticeably more slowly, use very short sentences, and if they don't catch a question, repeat it once in simpler words before moving on.

SPECIAL DAY: if @special_day is a festival or day name, greet them for it warmly at the start (from @caregiver_name and the family). If it names someone ("birthday of Appa", "Wedding anniversary (Appa)"), the wish is for that person. If it starts with "fasting day", don't wish them "happy"; just say you hope the fast goes well and don't talk about food or eating that day (for that person, if it names someone).

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
- No answer / busy → tried once more after 30 minutes (2 attempts in all, the same day; 30 min since 2026-10-08), then a level-2 alert.
- **Call length (2026-10-08):** keep every call under 60 seconds (Sarvam bills every started minute) but NEVER cut the parent off: always answer what they say. Set a generous maximum call duration in the agent (about 4 minutes) only as a runaway guard. The health questions (`ask_feeling`, `wellbeing_topic`) arrive only on the one call the app chose for them; when they are `no` / `none`, do not ask them.
- **"Later" tablets:** there are no extra follow-up calls any more. A tablet the parent said "later" about earlier today is simply listed again in `medicines_checklist` on the next scheduled call; report it as taken / missed / later as usual (still "later" on the last call of the day counts as not taken).
- **Readings call (Health Monitor add-on):** a call with `has_medicines = no` and `ask_readings` set (e.g. "blood pressure (BP), blood sugar"): greet, ask for the readings, say thanks, end. No medicine questions.
- A newly added parent is first called the next day (later slots the same day are still called).
- The same cron also: moves emergency escalations on every 10 minutes, places "later" follow-ups only if FOLLOW_UP_CALLS_PER_DAY is set (off by default since 2026-10-08)
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
4. Don't answer a call: expect "Attempt 2" 30 minutes later, and after that 2nd miss a level-2 "couldn't reach" alert.
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
