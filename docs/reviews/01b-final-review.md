VERDICT: HOLD

# 01b final module gate — 2026-10-28

Branch `module-01b` at `da0233f`. Spec: `docs/specs/01b_Staff_Roles_Spec_v1.0.md` (v1.0.1). Plan: `docs/plans/01b-plan.md`. Read-only on code. impl: Claude Code (autobuild).

The code is complete and green. All 107 spec tests except the six Playwright flows (#49–#54) exist and pass. The module is on HOLD only because the plan stops after T58. T59 and T60 (page flows) are WAITING for the human, and T61 (release drill on hardware) is PARKED under P-2. No code Blocker is open.

## Human inbox (newest decision needed first)

- **T59/T60 (plan STOP after T58).** Confirm that autobuild may run the Playwright page flows #49–#54 (webapp-testing). Then set T59 to TODO in `docs/plans/01b-status.md`.
- **P-2 (T61).** You answered A: you run the §7.4 release drill on the hub hardware after T58–T60 and log it in `docs/reviews/build-log.md`. T61 stays PARKED until then.
- **R-1 fix `da0233f` was not re-reviewed.** It fixes the last batch review's Blocker (T56 / AD-33, my_stations with no day open). The fix looks right to this gate (see §4), but no batch review has run since `8b4e70a`.
- **AD-11 (flagged, soft).** A foreign `?branch_id` on `GET /v1/admin/staff` returns `200 []`, not `404 BRANCH_NOT_FOUND`. It leaks nothing, but it differs from #48, #59 and #61, which return 404 for a branch outside the owner's list. This is a public API response choice in the cross-tenant area. Confirm it, or ask for 404.
- **P-4 follow-up.** You promised to amend 01a S50 a (v1.3.1) for the phone Menu button. Until then the code (`apps/client/src/features/owner/Shell.tsx`) is ahead of 01a's approved text by your answer.

## 1. Coverage (spec §10, tests 1–107)

`pnpm test`: **218 files, 907 tests passed, 0 failed, 0 skipped** (347.78 s, 2026-10-28, HEAD `da0233f`).

Tests tagged `[01b #N]` in `apps/` and `packages/`: #1–#48 and #55–#107. All of them are in the passing run.

**Missing (6):** #49, #50, #51, #52, #53, #54. These are the §10.9 Playwright page flows (plan T59–T60, WAITING).

Result: **not met** (6 missing; they wait for the human at the plan STOP).

## 2. Definition of Done (§12.1)

| Item | Status | Evidence |
|---|---|---|
| Every test 1–107 has one matching test and passes in CI | **Not met** | #49–#54 are missing (§1); the rest pass |
| 00 v1.5 and 01a v1.3 approved in the same change set; README updated | Met | `docs/specs/README.md:14`, `:15`, `:16` |
| Release done in the §7.4 order; every branch "Up to date" (B19) | **Not met** | T61 PARKED (P-2, hardware) |
| No route returns `pin_hash`; redaction tests pass | Met | Reads select only `pin_hash IS NOT NULL AS has_pin` (`apps/cloud/src/modules/staff-roles/repository.ts:87`, `:679`). Redaction #25 and #44 pass. #58 asserts that no audit row has `pin`/`pin_hash` |
| Route-inventory and cross-tenant tests cover the 14 new routes (D54) | Met | `apps/cloud/test/route-inventory.int.test.ts` and `cross-tenant.int.test.ts` via `test/helpers/route-cases.ts` (AD-8). The last batch review found the list equal to §6.16's 14 routes |

Endpoint checklist §12.2: every row's cited tests exist and pass. The only exception is the page parts #49–#54, which no checklist row cites as its sole test. Cloud migrations runner #105, CLIs (#20, #41, #72, #86, #93–#95, #97, #99, #100), hub queries (#19, #36, #62) and 01a changed routes (#21, #24, #34, #67, #68, #71, #83) are all green.

## 3. Status board (`docs/plans/01b-status.md`)

| DONE | PARKED | WAITING | BLOCKED | TODO |
|---|---|---|---|---|
| 60 (T0–T58 incl. T50b) | 1 (T61) | 2 (T59, T60) | 0 | 0 |

## 4. Open Blockers in `docs/reviews/01b-autoreview-history.md`

| Review | Finding | State | Evidence |
|---|---|---|---|
| tasks 7, 8, 11, 35, 48 | R-1 Blocker (#20 test that lies) | Fixed | Status T48 note ("#20 split …, R-1"); #20 passes in both halves |
| tasks 17, 18, 20, 25, 27 | R-1 Blocker (AD-18 audit rows per holder) | Fixed | AD-18 amendment; one `staff` row per former holder; #5 passes |
| R-1/R-2 + 26, 28, 30–32 | R-1 Blocker (cascaded `responsibility` audit rows) | Fixed | AD-15 amendment; the next review (`14424a8`) was PASS |
| 43, 44, 46, 47, 50b | R-1 (AD-29 identity check), R-2 (AD-31 phone shell) | Fixed by human answers | P-3 → call-back runbook (`5187dab`); P-4 B → kit Dialog nav (`515ec25`); review 51–55 checked both |
| 56, 57, 58 | R-1 Blocker (T56 / AD-33 hides rows and the Selling switch with no day open) | **Fixed, not re-reviewed** | `da0233f`. Rows stay under a warn banner (`stock-pages.test.tsx:551-556`). New test `[01b §4.4 row 11] … Selling switch still sends set-item-availability` (`stock-pages.test.tsx:583`). AD-33 amendment recorded. This is the required fix (a) |

Every Should-fix in the history was answered by a later PASS or by a "Checked and fine" entry. The Nits left open (e.g. N-1 role-named `admin_stock.counter.note`, N-2 fixture shape) do not block. N-1 is gone: `da0233f` removes two keys from `en.ts`. Result: **clean**, with the caveat that `da0233f` has had no batch review.

## 5. Auto-decisions (`docs/reviews/01b-auto-decisions.md`)

Still Class B: AD-1, AD-2, AD-4, AD-5, AD-6, AD-7, AD-8, AD-9 (free strings in an existing event field, no schema change), AD-10, AD-12, AD-13, AD-14, AD-16, AD-17, AD-19, AD-20 (follows the spec's later J-6), AD-21, AD-22, AD-23 (field mandated by §4.4 row 13; hub and page ship together), AD-24, AD-25 (spec auto-patched to v1.0.1), AD-26, AD-27, AD-28, AD-30, AD-32 (+ amendment).

Already corrected by review or the human (no action):
- AD-3 (interim, removed by T8)
- AD-15 and AD-18: amended to "spec-mandated"
- AD-29: superseded by P-3
- AD-31: phone part superseded by P-4
- AD-33: amended to spec text

Flagged:
- **AD-11**: a foreign `?branch_id` gets an empty list instead of `404`. This touches the public response shape of a cross-tenant read (D54). It is better confirmed by the human than decided by autobuild. It does not leak data, so it is not a Blocker.

## 6. Skipped tests

- `pnpm test` skipped nothing (0 skipped of 907).
- The only conditional skip in the code is `apps/hub/test/boot/boot-budget.int.test.ts:20`. It is `it.skipIf(process.env.POS_SKIP_BIG === '1')`, an opt-in env switch on 00 test #100, and is not an 01b test. The switch is unset in `pnpm test`, so the test ran.
- No `.skip`, `.todo`, `xit` or `xdescribe` anywhere in `apps/` or `packages/`.

Result: **clean.**

## 7. Foundation §6 conformance spot-check

- **Error codes:**
  - All nine 01b §9 codes are in foundation §6.2: `docs/specs/00_Foundation_Spec_v1.7.md:1339-1343` (P-1, edited by the human).
  - They are also in `packages/domain/src/errors.ts:14`, `:23`, `:37`, `:49-53`, `:58`.
  - Routes throw `DomainError`, so the envelope comes from the shared handler (`apps/cloud/src/modules/staff-roles/service.ts:102`, `:115`; `routes.ts:203`).
- **Migrations:**
  - Additive, numbered, roll-forward only: `apps/cloud/src/db/migrations/0005_staff_roles.sql` and `apps/hub/src/db/migrations/0005_directory_v2.sql`.
  - Merged migrations 0001–0004 are untouched on this branch.
  - The runner refuses unknown versions (#105).
- **Folder layout:**
  - Cloud module in `apps/cloud/src/modules/staff-roles/` (routes, service, repository, schemas, guards, versions, write).
  - CLIs in `apps/cloud/src/cli/`.
  - Wire schemas in `packages/events/src/admin/`.
  - Tests in `apps/cloud/test/staff-roles/` and `apps/cloud/test/owner-auth/` as §10 says.
- **Naming and role names:** #55 (R5 grep) and #96 (renamed roles on the hub) pass.

Result: **clean.**

## Why HOLD

Items 4–7 are clean (soft notes on AD-11 and the unreviewed `da0233f`). Item 1 is not met: #49–#54 are missing. Item 2 is not met: the page tests and the release drill are outstanding. The board has PARKED 1 and WAITING 2. README 01b status stays "Implemented, pending page flows and release drill".
