VERDICT: HOLD

# 01b final module gate — 2026-10-27

Branch `module-01b` at `1b88a84`. Spec: `docs/specs/01b_Staff_Roles_Spec_v1.0.md`. Plan: `docs/plans/01b-plan.md`. Read-only on code. impl: Claude Code (autobuild).

The module is not ready to merge. Only 2 of 62 plan tasks are done (T1 cloud migration, T5 domain catalogue). The 14 new routes, the directory v2, the hub changes, owner auth, `seed-tenant` and the owner app views are not built yet.

## Human inbox (newest decision needed first)

- **P-2 (T61)** The release drill needs the hub hardware. Pick A (you run it after T58–T60) or B (defer it, README says "pending release drill"). See `docs/reviews/01b-parked.md`.
- **P-1 (T0)** The foundation §6.2 edit is forbidden to autobuild. Pick A (you edit it), B (allow autobuild to do Task 0) or C (skip it and accept the drift). Until then `packages/domain/src/errors.ts:49-50` (and the other 01b §9 codes) are ahead of foundation §6.2.
- **Build not finished:** 58 tasks are TODO (T2–T4, T6–T60). This is not a blocker in the code. The autobuild loop has to run its implement steps before this gate can pass.
- No AD-n is flagged. No review Blocker is open.

## 1. Coverage (spec §10, tests 1–107)

`pnpm test`: **164 files, 677 tests passed, 0 failed, 0 skipped** (run at 20:18, 151.96 s).

Tests tagged `[01b #N]` in the code: **#70, #77** only. Both are in `apps/cloud/test/db/staff-roles-migration.int.test.ts:60` and `:107`, and both pass.

**Missing (105):** #1–#69, #71–#76, #78–#107. The E2E flows #49–#54 are in this list.

Result: **not met.**

## 2. Definition of Done (§12.1)

| Item | Status | Evidence |
|---|---|---|
| Every test 1–107 has one matching test and passes in CI | **Not met** | Only #70 and #77 exist (see §1) |
| 00 v1.5 and 01a v1.3 approved in the same change set; README updated | Met | `docs/specs/README.md:14` (00 v1.5 APPROVED 2026-10-27), `:15` (01a v1.3 APPROVED), `:16` (01b v1.0 APPROVED) |
| Release done in the §7.4 order; every branch "Up to date" (B19) | **Not met** | T58–T60 TODO, T61 PARKED (P-2) |
| No route returns `pin_hash`; redaction tests pass | **Not met** (cannot check) | Staff routes not built: `apps/cloud/src` has no `admin/staff` or `admin/roles` route. Redaction test #25 is missing |
| Route-inventory and cross-tenant tests cover the 14 new routes (D54) | **Not met** | Routes and tests #55, #96 are missing (T57) |

Endpoint checklist §12.2: none of the 01b routes, CLIs or changed 00/01a routes is implemented yet. Every row is not met.

## 3. Status board (`docs/plans/01b-status.md`)

| DONE | PARKED | WAITING | BLOCKED | TODO |
|---|---|---|---|---|
| 2 (T1, T5) | 2 (T0, T61) | 0 | 0 | 58 |

The board has 62 tasks in all (T0–T61).

## 4. Open Blockers in `docs/reviews/01b-autoreview-history.md`

There was one batch review (tasks 1 and 5), with VERDICT PASS and **no Blockers and no Should-fix**. It left four Nits open:
- R-1: #70 does not re-read the rows at the length limits.
- R-2: the #77 duplicate case cannot tell "smallest id" from "first inserted".
- R-3: scratch databases are left behind after a crash.
- R-4: the `GROUPS` order in `permissions.ts`.

Nits do not block the gate. Result: **clean.**

## 5. Auto-decisions (`docs/reviews/01b-auto-decisions.md`)

- **AD-1 (T1)** tests #77 on a rolled-back prefix of 0005. This is still **Class B**. It is a test technique only and changes no schema, spec text or contract. The duplicate-name abort stays covered by #89 (T3).
- **AD-2 (T5)** places permissions in the six catalogue groups. This is still **Class B**. It only affects the roles editor layout and has no schema, API, sync or security effect.

Nothing should have been Class C. Result: **clean.**

## 6. Skipped tests

One conditional skip exists: `apps/hub/test/boot/boot-budget.int.test.ts:20` uses `it.skipIf(POS_SKIP_BIG === '1')`. It belongs to module 00 test #100, and `docs/plans/00-plan.md:563` allows it. The variable was not set in this run, so the test ran and passed.

There are no 01b skips and no `.skip` or `.todo`. Result: **clean.**

## 7. Foundation §6 conformance spot-check (built parts only)

- **Migrations:** `apps/cloud/src/db/migrations/0005_staff_roles.sql` follows 0001–0004 in sequence. It is the §5.1 block (autoreview confirmed this line for line), and no merged migration was edited. OK.
- **Error codes:** the 01b §9 codes are in `packages/domain/src/errors.ts` with their statuses (e.g. `:49` `STAFF_NAME_TAKEN` 409, `:50` `LAST_ADMIN_REQUIRED` 409). They are **not yet in foundation §6.2**; this is the known drift tracked as P-1.
- **Naming and folder layout:** the migration test is at `apps/cloud/test/db/`, not `test/staff-roles/` as spec §10 says. The plan names this path (`docs/plans/01b-plan.md:244`), so it is accepted. Test names cite `[01b #N]`. OK.
- **Envelopes:** there are no new routes yet, so nothing to check.

Result: **clean for what exists, but most of the module does not exist yet.**

## Gate result

Checks 1 and 2 fail, and PARKED = 2 and TODO = 58. **VERDICT: HOLD.** The README status for 01b is not changed.
