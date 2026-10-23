---
target: onboarding
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:D:\\sathwik\\Saathi-AI\\src\\app\\onboarding\\page.tsx"
target_fingerprint: "sha256:3526192de187e3308f376bcdc0bc39d7f24948b89c575b95133a1a0a8c1dca75"
target_path: "D:\\sathwik\\Saathi-AI\\src\\app\\onboarding\\page.tsx"
timestamp: 2026-10-21T14-05-04Z
slug: src-app-onboarding-page-tsx
---
⚠️ DEGRADED: single-context (sub-agents only on explicit request). Browser: steps 1-4 walked at 375px with a throwaway account (stopped before Finish, account deleted).

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Focus falls to body on step change |
| 2 | Match System / Real World | 3 | Parent timezone picker offers US/UK/UAE/SG |
| 3 | User Control and Freedom | 2 | Back from step 3 wipes custom times/labels; Exit discards silently |
| 4 | Consistency and Standards | 3 | Step-4 phone is a plain input, not PhoneField |
| 5 | Error Prevention | 2 | Add another parent inherits data; contact 1 blank + "Son" |
| 6 | Recognition Rather Than Recall | 3 | Chips and "Saathi will ask" preview |
| 7 | Flexibility and Efficiency | 2 | No draft |
| 8 | Aesthetic and Minimalist Design | 2 | 1518px / 41 controls per medicine at 375px |
| 9 | Error Recovery | 2 | Errors at page top, not on fields |
| 10 | Help and Documentation | 3 | Hints explain why |
| Total | | 25/40 | Acceptable |

## Detector
33 advisory: 32 off-ramp font sizes incl. 0.72rem at page.tsx:1441; 1 radius 9px. None of the priority issues.

## Priority Issues
1. [P1] Feeling question promised (page.tsx:912 "No medicines" card, 1728 consent script; dashboard OverviewPanel too) but askFeeling needs Health Monitor (callDispatch.ts:526). Product decision. /impeccable clarify
2. [P1] Add another parent (page.tsx:1968) keeps medicines, schedule, contacts, address, livesAlone, test result, introDone, createdParentId. /impeccable harden
3. [P1] Emergency contact 1 initialised before user loads: blank name/phone, relation "Son / Primary Caregiver"; error shown at top, fields not marked. /impeccable harden
4. [P1] One medicine card = 1518px, 41 controls at 375px. Fold optional fields. /impeccable distill
5. [P2] Step 3 regenerates schedule on entry (page.tsx:419) so edits are lost on Back; Exit setup has no warning and no draft. /impeccable harden

## Persona Red Flags
- Sam: focus to body on step change; future step names hidden on phone; errors not tied to fields.
- Casey: 1518px per medicine; "Drop a photo" on phones; interruption loses everything.
- Priya: default relation "Son"; foreign timezones for an India-only service; test call offered right under "tell Amma first".

## Minor
- Two competing flag badges on entry cards; uppercase gold kickers; step-4 phone not PhoneField.
