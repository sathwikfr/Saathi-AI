---
target: the dashboard
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:D:\\sathwik\\Saathi-AI\\src\\app\\dashboard\\page.tsx"
target_fingerprint: "sha256:ebe0c4132c10f7bc8b5ed3d8bca07f34720e6430c258efa3266c1e111ddc8a4e"
target_path: "D:\\sathwik\\Saathi-AI\\src\\app\\dashboard\\page.tsx"
timestamp: 2026-10-21T13-50-49Z
slug: src-app-dashboard-page-tsx
---
⚠️ DEGRADED: single-context (sub-agents not spawned: session runs agents only on explicit user request). No browser pass on the dashboard: viewing it needs a throwaway account + parent in the live Supabase DB, and the Vercel cron could phone that number. Detector + full source review ran.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Medicine on/off toggle fails silently (handleToggleMed) |
| 2 | Match System / Real World | 2 | "Level 3 · Urgent"; raw api_error/result_not_received in Call history |
| 3 | User Control and Freedom | 3 | Pause/resume, Undo on ticks, confirmed delete with export |
| 4 | Consistency and Standards | 2 | Two tablists; 56 off-ramp inline font sizes; "I'm on it" shown to viewers in banner only |
| 5 | Error Prevention | 3 | Nickname / same-time guards, confirm before remove |
| 6 | Recognition Rather Than Recall | 2 | 9 tabs, hidden scrollbar: Records/Settings off-screen on phones |
| 7 | Flexibility and Efficiency | 2 | CSV export; no arrow keys on tablists |
| 8 | Aesthetic and Minimalist Design | 2 | Up to 8 stacked banners; parent name shown 3 times |
| 9 | Error Recovery | 2 | Mostly "Could not save."; technical strings reach families |
| 10 | Help and Documentation | 3 | Setup checklist and empty states explain well |
| Total | | 24/40 | Acceptable |

## Design Specificity Verdict
Authored for this product (trust checklist, consent, "I'm on it" ladder, Namaste greeting); the generic part is structure: 9-tab admin shell + banner stack.
Detector: 58 advisory (56 design-system-font-size incl. 0.72rem at RemindersPanel.tsx:261; 2 design-system-radius, harmless). Detector caught none of the priority issues.

## Priority Issues
1. [P1] Broken promise: Settings birthday "Saathi wishes them on the day" (SettingsPanel.tsx:119) but callDispatch.ts:518 passes birthDate null; weekly-chat card pitched though not sold. Fix: remove/honest copy. /impeccable clarify
2. [P1] Raw failureReason in Call history (CallHistoryPanel.tsx:72): api_error: …, result_not_received, rate_limited. Fix: map to plain words. /impeccable clarify
3. [P1] Colour-only status: Remind week dots (title only, red/green legend, 0.72rem labels; RemindersPanel.tsx:255-274) and family rail rings (FamilyOverview.tsx:194). Fix: aria-labels, shape per state, >=0.75rem. MedicinesPanel.tsx:370 is the model. /impeccable audit
4. [P1] 9-tab pill bar on phones: hidden scrollbar, no overflow cue, ~40px tall tabs. Fix: edge fade or More, 44px min, consider merging Timeline + Calls. /impeccable adapt
5. [P2] Banner overload (up to 8) + escalation banner "I'm on it" shown to view-only members (page.tsx:690) who get an error. Fix: max 2 banners by priority; gate on manage, viewers get "Call {name}". /impeccable distill

## Persona Red Flags
- Sam: two h1s, 48 h3s and no h2; tablists without arrow keys/aria-controls; tabpanel unlabeled; h1 contains badges; colour-only status.
- Casey: banner stack + hidden tabs on phone; checklist collapse not remembered; 5 buttons in one checklist row, tick duplicates "I've told them".
- Priya (NRI daughter): Remind welcome says "Saathi starts calling"; L3 fever shown with the same Siren/red as L4 emergency.

## Minor Observations
- handleToggleMed has no failure toast.
- "Calls missed" tile counts retries.
- Mood fact always uses a smile icon.
- Today repeats the medicine list already in schedule chips.
- 56 inline fontSize values: consolidate into ramp classes.

## Questions to Consider
- Phone Today = status sentence, next call, the one thing needing a look?
- Does a family need "Level 3", or just "Needs a look today" vs "Emergency"?
- Merge Timeline and Calls?
