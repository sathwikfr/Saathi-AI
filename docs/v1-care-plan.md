# Aaptha v1 care features — build plan

Started 2026-10-03 on branch `v1-care-features`. Scope: everything in the "features to build" brief (emergencies,
consent, trust, adherence, health risks, family engagement) plus the strategy list (timeline, health memory, weekly
report, risk prediction, family circle, local emergency network, family AI, companion calls, scam check, voice journal,
health record vault). Decisions taken with the user on 2026-10-03:

| Question | Decision |
|---|---|
| Text AI for Family AI chat + scam check | **Claude API** (`ANTHROPIC_API_KEY`) |
| Companion calls | **Weekly, opt-in per parent, 5-minute cap, included in paid plans** (worst case ~₹105/month per parent) |
| Health record vault storage | **Supabase Storage**, private bucket (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) |
| Call transcript retention | **90 days**, then the transcript text is cleared; summary, medicine results, mood and alerts stay |

Not in v1 because they need a real partner (rule 9: never show made-up providers): pharmacy ordering, doctor booking,
care marketplace, insurance claims, ambulance dispatch. Wearables stay parked. The honest v1 versions are listed below.

## Build order

1. **Before real families**: emergencies, the parent's own consent, trust set-up, family circle.
2. **Next**: medication workflows, trends across calls ("health twin" baseline), digests, timeline + journal, doctor report.
3. **Then**: Family AI chat, scam check, companion calls, vault, transcript clean-up, engagement metrics.

The 10–20 family test can start after step 1 if the user wants.

## 1. Emergency protocols — `lib/escalation.ts`

Ladder for every level-4 alert (mid-call tool or end-of-call scan), one `Escalation` row per alert:

| Round | Who | How |
|---|---|---|
| 0 (at once) | account owner + family circle | WhatsApp emergency message (existing template) **and** a phone call from the *Aaptha Alert* agent to the owner's emergency number (`wakeForEmergency`, default on) |
| 0 (at once) | first local contact (`isLocal`, else first contact) | phone call: parent's name, address, what was said, "can you go now? say yes or no" |
| +10 min, nobody said yes | next contact | phone call |
| +10 min | the parent again | short call: "are you okay? if it is serious, dial 112" |
| +10 min … | remaining contacts | one per round |
| all tried | owner | final WhatsApp/email: nobody confirmed, call 112 or local help |

- "I'm on it": WhatsApp button (existing `ack` payload), "yes" on an alert call, or the dashboard button. Stops the ladder;
  everyone else gets "X is handling it" (template `aaptha_alert_handled`).
- Afterwards the family records the outcome (fine / doctor visit / hospital / other + note) on the dashboard; that closes the alert.
- **Lives alone**: if a `livesAlone` parent can't be reached after all retries, a `wellness_check` escalation calls the local contacts.
- **Emergency card** per parent: address, nearest hospital, blood group, conditions, allergies, doctor, current medicines,
  emergency contacts. Shareable read-only link `/card/<token>` (unguessable, revocable, `noindex`).
- **Practice alert** from onboarding/settings: one practice call to a contact (`kind: practice`), records `practiceAt`.
- Onboarding, the card and Saathi itself say: Aaptha is not an emergency service; dial **112**.
- Local contacts are phoned, not WhatsApped (they never opted in to WhatsApp). No SMS provider yet.

Needs outside the code: a second Sarvam agent, *Aaptha Alert* (`SARVAM_ALERT_APP_ID`, `SARVAM_ALERT_APP_VERSION`;
prompt in `docs/sarvam-agent.md` §9), and the new WhatsApp template.

## 2. Consent and privacy

- `ParentProfile.parentConsent`: `pending` (new and existing parents) → Saathi asks on the next call, in the parent's language:
  it is an AI assistant, `caregiver_name` asked it to call about medicines, and what they say is shared with the family. "Is that okay?"
  - yes → `given` (+ date + call id), the call continues.
  - no → `declined`: calls pause, the family is told (level 2). Resuming sets it back to `pending` so Saathi asks again.
  - unclear → stays `pending`, asked again next call.
- "Stop calling me" on any call → `withdrawn`, calls pause at once, family told. Same resume rule.
- The family checkbox in onboarding now says "I have told them; Saathi will ask them on the first call".
- Parent notice page `/notice/<lang>` in English + 8 Indian languages (shareable on WhatsApp). **Native speakers should review the translations.**
- Privacy page: adds Meta (WhatsApp), Anthropic (Family AI, scam check), Supabase Storage (vault), the 90-day transcript rule,
  the parent's own consent, and what emergency contacts are told.
- Transcript clean-up job (cron): `transcriptJson` cleared after `TRANSCRIPT_RETENTION_DAYS` (default 90; `0` turns it off).
  Call logs themselves are never deleted (rule 6).
- Open, for the lawyer: erasure on withdrawal (DPDP) vs the soft-delete rule; Privacy/Terms review before May 2027.

## 3. Trust with older adults

- Onboarding "Introduce Saathi" step: a script in the parent's language for a WhatsApp voice note from the child, a
  "Send on WhatsApp" link, and a `Saathi.vcf` contact card with the fixed calling number (`/api/saathi/contact`). Both are
  ticked off (`introducedAt`, `numberSavedAt`) and shown in a set-up checklist on the dashboard.
- Saathi says the safety line ("I will never ask you for money, OTPs or bank details") once a week (`say_safety_line`).
- Saathi remembers the last call: `last_call_note` = the most recent concern from the past 7 days, asked about once.
- A support number (`NEXT_PUBLIC_SUPPORT_PHONE`) is on the notice page, the card and in Saathi's answer to "is this real?".
- Call-back: an inbound Sarvam deployment on the same number; `/api/calls/inbound-context` gives Saathi the caller's
  medicines (on-start hook, field mapping to confirm in Sarvam), `/api/calls/sarvam-inbound` records the result like any call.
- Same voice and time: agent settings (doc note), the schedule already keeps fixed times.

## 4. Medication adherence

New agent outputs drive these (contract in `docs/sarvam-agent.md`):
- **"Later" / "not yet"** (`medicines_later`): no missed alert yet; one follow-up call 40 minutes later about those medicines
  only (`CallLog.followUpAt`, max 2 a day per parent). Still not taken → level 2.
- **Why it matters**: `Medicine.purpose`, written by the family; Saathi repeats it, never invents one.
- **Quiet stopping** (`medicines_stopped` + `stopped_reason`): level 3, "talk to her doctor"; Saathi never advises.
- **Refill check** weekly (`ask_refill`, `medicines_running_low`): level 2 "running low".
- Per-medicine 7-day view in the Medicines tab; printable doctor summary `/dashboard/report/<parentId>`.
- New prescription: the confirm step lists what is new, already there, and no longer on the prescription (family may stop those).

## 5. Health risks from conversations — `lib/insights.ts`

- Every 3 days Saathi asks about sleep, appetite and pain (`ask_wellbeing`; outputs `sleep`, `appetite`, `pain`, `pain_where`).
- After each call and daily, rule-based checks against the parent's **own baseline** (the "health twin": last 60 days):
  same complaint ≥2 times in 7 days, low mood on 3 of the last 5 calls, answers much shorter than usual (`parentWords`),
  pick-up rate or adherence well below usual, poor sleep/appetite twice in a week, severe pain.
- Worded as nudges, never a diagnosis: "Amma has said she's tired on 4 of the last 5 calls; it may be worth a chat or a doctor visit."
- Two or more different changes in one week → one level-2 "worth a call today" message; the rest go to the dashboard and digest.
- Voice cues (pace, pauses): not built; research only, needs explicit consent.

## 6. Long-term family engagement

- **Family circle**: invite by link (copy / WhatsApp share; email too once a Resend domain is verified). Members sign up or
  log in, see the parent's dashboard (viewer or co-manager), get their own WhatsApp updates and can say "I'm on it".
  Owner-only: billing, removing the parent, managing members.
- **Message frequency**: every call / only problems / one daily summary (problems still immediate).
- **Weekly digest** on the day and hour the family picks, in their time zone; **monthly summary** with the doctor-report link.
  One WhatsApp template `aaptha_care_summary`; email only while WhatsApp isn't set up.
- **Reason to call** banner when mood dips or something was mentioned.
- **Timeline** tab: day-by-day health timeline with a one-line journal per day (rule-based, from the calls).
- **Admin metrics**: weekly-active families (`User.lastSeenAt`), share of alerts acknowledged, escalation outcomes, cancel reasons.

## 7. Strategy-list features

| Feature | v1 version |
|---|---|
| Family AI chat | "Ask about Amma" panel; Claude answers only from the last 90 days of calls, insights, medicines and vault titles, cites dates, never diagnoses. 20 questions/day/user |
| Scam check | Parent forwards a message or screenshot to the Aaptha WhatsApp number → Claude flags warning signs and replies simply in their language; never says "safe"; family told when it looks like a scam |
| Companion calls | Weekly, opt-in, 5-minute cap: stories, cricket, family topics the family writes; birthday wish on the day; same safety rules and emergency detection |
| Health record vault | Upload reports, prescriptions, scans, bills, discharge summaries, insurance (10 MB, PDF/images) to Supabase Storage; signed links; insurance renewal dates shown as reminders |
| Doctor integration | Insights suggest a visit; the doctor's name/number on the card; printable summary for the doctor. Booking: partner needed |
| Care marketplace | The family's own trusted local people (neighbour, security, nurse, doctor) as contacts. Marketplace: partner needed |

## Data model (additive only; applied with `prisma db push` after a backup)

New tables: `Escalation`, `EscalationAttempt`, `HealthInsight`, `HealthDocument`.
New columns: `User.lastSeenAt`; `UserSubscription.cancelReason/cancelledAt`; `ParentProfile` consent, emergency-card,
trust and companion fields; `Medicine.purpose`; `EmergencyContact.role/isLocal/practiceAt/practiceResult`;
`CallLog.followUpAt/parentWords`; `AlertRecord.handledByName/handledVia/outcome*`; `CaregiverInvite.userId/token/phone/invitedById/acceptedAt/revokedAt`;
`NotificationPreferences` time zone, daily summary, digest and emergency-call settings.

## New environment keys

`SARVAM_ALERT_APP_ID`, `SARVAM_ALERT_APP_VERSION` (alert agent) · `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`) ·
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `SUPABASE_STORAGE_BUCKET` · `NEXT_PUBLIC_SUPPORT_PHONE` ·
optional `TRANSCRIPT_RETENTION_DAYS`. New WhatsApp templates: `aaptha_alert_handled`, `aaptha_care_summary`.

## v1.1 extras (2026-10-04, same branch)

Built after v1 when the user asked for "all" of a second list. Decisions: siblings split the bill with **UPI links**
(Aaptha never holds money); **no SMS** for now. Partner-dependent items stay out (pharmacy ordering, doctor booking).

| Feature | How it works | Where |
|---|---|---|
| BP / sugar readings | Also in the daily / weekly / monthly WhatsApp summary (`readingsLine()` in `lib/digests.ts`: averages, highest, previous week, fasting and after-food sugar apart, how many outside the limits; numbers only). Family ticks BP and/or sugar and optional limits; Saathi asks once a day (not on the weekly chat) and never comments on the numbers. Readings outside the family's limits, or past fixed safety limits (180/120, top under 90, sugar under 70 or over 300), raise a level-3 alert that says "check with their doctor". Family can also type readings in. Chart + list on the Trends tab | `lib/readings.ts`, `HealthReading`, `/api/parents/[id]/readings`, `ReadingsPanel` + `LineChart` |
| Family messages | Anyone in the family circle sends a short message (200 chars, 10/day); Saathi reads up to 2 per call, oldest first, on any answered call. What the parent wants passed back (`feedback`) shows in the same thread | `FamilyMessage`, `/messages`, `MessagesCard` |
| Appointments | Family adds a doctor visit / lab test (+ "empty stomach"); Saathi reminds the day before and on the day, then asks "how did it go?" 2 h–4 days after; the answer is kept on the appointment | `lib/appointments.ts`, `Appointment`, `/appointments`, `AppointmentsCard` |
| Couple on one phone | Owner links two parents who share a number; once both have said yes on their own first call, one call covers both (`partner_*` variables). The partner gets their own linked call log, readings, alerts and follow-ups. The second parent's family messages and appointments ride along labelled ("From Ravi (for Appa)", "Appa's blood test"); household things (helper, weather, festivals, hearing mode, a special day) come from either parent | `coupleOf()` in `callDispatch.ts`, `applyPartner()` in `callResults.ts`, Settings switch |
| Weather note | Town looked up once (Open-Meteo geocoding); on very hot / cold / heavy-rain days Saathi adds one line, at most once a day | `lib/weather.ts` |
| Festivals and special days | Google's public India holiday calendar; Saathi greets only the festivals the family ticks. Family-added days (anniversary, puja, fasting day: no food talk that day) | `lib/festivals.ts`, `/api/festivals`, Settings |
| Bill split | Payer adds a UPI ID and switches on which family members share; each sees their equal share (rounded up), a `upi://pay` link and "I've paid". Aaptha only records the note | `lib/familyMoney.ts`, `lib/billShare.ts`, `BillShare`, `/api/account/bill-share` |
| Life stories | When the parent tells a memory and agrees the family may keep it, it's saved; Stories tab + printable book (`/dashboard/stories/[parentId]`); family can leave a story out | `LifeStory`, `/stories`, `StoriesPanel` |
| Chemist refill list | WhatsApp text for the family's own chemist (ticks what the parent said was running low); the family sends it themselves | `chemistMessage()`, `RefillListModal` |
| Hearing-friendly mode | Slower, shorter sentences, repeat once | `hearing_mode` variable |
| Paid-helper check | "Did Lakshmi come today?" on the last call of the helper's days; "no" → level-2 alert | `helper_question`, `helper_visited` |

Schema (applied 2026-10-04 as reviewed additive SQL; copy in `D:/sathwik/aaptha-db-backups/applied-2026-10-04-v11-extras.sql`):
new tables `HealthReading`, `FamilyMessage`, `Appointment`, `LifeStory`, `BillShare`; new columns `User.upiId`,
`ParentProfile` readingsToAsk / readingRanges / callTogetherWithId / city / latitude / longitude / festivals /
specialDaysJson / chemistName / chemistPhone / hearingMode / helperName / helperDays / lastWeatherNoteAt,
`CallLog.pairedCallLogId`, `CaregiverInvite.sharesBill`. No new env keys.

Tests: `npx tsx scripts/test-care-extras.ts` (98 checks: pure logic + couple call, readings, messages, appointment
reminder and follow-up, helper, weather, festival, life story, bill share on throwaway `extras-test-*` rows with a
fake Sarvam and fake weather; nothing hits the network). The agent prompt and variables are in `docs/sarvam-agent.md` §3, §4 and §6.
