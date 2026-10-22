# Pilot kit: 10 families, 4 weeks

Goal: prove that parents keep answering and children keep looking. Not revenue yet.
**Pass = 70%+ of parents still answering in week 4, and 5 of 10 families say they would pay ₹899.**

## 1. Who to pick
- Children you know (friends, cousins, colleagues) whose parent takes **daily BP or sugar tablets**.
- Mostly **Telugu**-speaking parents (one language done well). 2-3 Hindi or English ones are fine as a comparison.
- Mix: some children in Hyderabad/Bangalore, some abroad (US, UK, Gulf).
- Skip parents with memory loss or serious hearing loss for this first round: you want to learn what normal looks like.

## 2. Invite message (WhatsApp, from you personally)
> Hi <name>, I've built something for parents who live away from us: a short phone call to Amma/Nanna at their tablet
> times, in Telugu, asking if they took them. You get a WhatsApp/dashboard update, and an alert if something's wrong.
> I'm looking for 10 families to try it free for a month. In return, a 15-minute chat with me once a week.
> Would your parent be up for it? (They'll be asked for their own OK on the first call.)

## 3. Set-up, per family (about 20 minutes, do it on a call with the child)
1. The child signs up on the site.
2. You give them the free month (dry run first, then `--confirm`):
   ```bash
   npx tsx scripts/grant-pilot.ts <their email>
   npx tsx scripts/grant-pilot.ts <their email> --monitor --confirm
   ```
   `--monitor` adds the health questions ("How are you feeling?", BP/sugar). Use it for half the families so you can
   compare. `--plan family` if both parents take tablets. It ends by itself after 30 days (`--days` to change).
3. The child adds the parent: tablets (nicknames the parent knows), times, language, emergency contacts.
4. **The child tells the parent first** ("a lady called Saathi will call you about your tablets"). Unexplained calls
   from an unknown number get ignored or blocked. Ask them to save the number (contact card on the dashboard).
5. Test call from the dashboard while you're still on the phone together.

## 4. Every day (10 minutes)
- `/admin` → **Pilot families**. Look at the Status column:
  - **At risk** (not answering): message the child that day. Common causes: wrong time (parent at temple, bath, nap),
    number saved as spam, parent didn't understand who Saathi is.
  - **Fading** (child not opening the dashboard): ask the child if the WhatsApp update is enough, or if they've lost interest.
- Read a few call transcripts. Note anything that confused the parent or sounded robotic.

## 5. Weekly 15-minute chat with the child
Ask the same questions every week, write the answers down:
1. Did you look at the updates this week? When, and why?
2. Did anything surprise you, good or bad?
3. What did Amma/Nanna say about the calls? (Ask them to ask the parent directly.)
4. Did it change anything? (Fewer worried calls from you? A tablet that would have been missed?)
5. Anything annoying? Anything missing?

## 6. End of week 4: the money question
Ask plainly, and don't argue with the answer:
- "If this cost ₹899 a month from next month, would you pay for it?" (Yes / Maybe / No, and why)
- "What would make it a clear yes?"
- "Who else do you know who should have this?" (your first referrals)

## 7. What to write down (one row per family)
| Family | Parent language | Week 1-4 answering % | Tablets confirmed % | Would pay? | Biggest complaint | Best moment |
|---|---|---|---|---|---|---|

The first four columns come from `/admin`. The rest come from the weekly chats.

## Rules for the pilot
- **Fix only what the pilot families hit.** No new features during the 4 weeks.
- Never pretend a call happened, never fill the dashboard by hand (CLAUDE.md rule 9).
- If a parent says no to the calls on the first call, that's their decision: thank the child and move on.
