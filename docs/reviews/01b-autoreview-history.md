# 01b autoreview history

## 2026-10-27 — batch review, tasks 1, 5 (commits c8fe165, 736506c, e78a327)

VERDICT: PASS

Scope: no earlier `review(01b)` commit, so every 01b commit on the branch: `c8fe165` (task 1), `736506c` (task 5), `e78a327` (status board, build log). Checked against foundation §6, 01b spec v1.0 §3.3, §4.2, §5.1, §9, tests #70 and #77, plan tasks 1 and 5 ("Done when", Interfaces Domain block), and AD-1, AD-2.

What was checked:
- `0005_staff_roles.sql` is the §5.1 block line for line. The only change is the `password_changed_at` comment ("audit and display"), which the plan requires. Constraint names match the D-5 list. The clamp runs before the tightened CHECKs. No file under `apps/cloud/src/` other than the SQL changed.
- No cloud source path writes `staff.is_active = false`, so the new `staff_left` CHECK breaks no runtime writer. The only test fixture affected (`hub-registration`) was fixed as the plan says. Branch-name uniqueness in `issue-registration-code` and `default_key` in `seed-tenant` belong to tasks 34 and 48; they are out of scope here.
- Domain: `PERMISSION_SCOPES` matches the §3.3 table (`own_tables` is on no permission). `PERMISSION_CATALOGUE`, `SCOPES`, `Scope`, `DEFAULT_KEYS` and `DefaultKey` match the plan's Interfaces block. The nine §9 codes have the right statuses. `index.ts` already re-exports `permissions.js`.
- AD-1 is correctly Class B (really a test technique; no schema, spec or contract change). Two active "Manager" roles cannot survive `roles_active_name` in the same migration, so testing the backfill on a rolled-back prefix of the real SQL checks the spec rule without changing it.
- AD-2 is correctly Class B. Catalogue groups only affect the roles editor layout; they have no schema, API, sync or security effect. All six groups are used.
- P-1 (the foundation §6.2 edit) is parked correctly. `errors.ts` is ahead of foundation §6.2 until the human answers it.
- No money, stock, event, sync, auth or lock code in this batch. No tests skipped or weakened.

Findings: no Blockers. No Should-fix.

- **R-1 (Nit, T1)** `apps/cloud/test/db/staff-roles-migration.int.test.ts:61` — #70 shows that the migration committed and that each constraint is `convalidated`, but it never re-reads the 40/60-character rows. A future migration could silently truncate names and #70 would still pass. Fix: assert the branch name is still 60 characters and the staff and role names are still 40 after `migrate()`.
- **R-2 (Nit, T1)** `apps/cloud/test/db/staff-roles-migration.int.test.ts:113` — the duplicate-"Manager" case cannot tell "smallest role_id" apart from "first inserted", because the extra role is both larger and inserted later. Fix: insert a role with a smaller id (for example `'00000000000000000000000000'`) after the seed, and expect it to get the key.
- **R-3 (Nit, T1)** `apps/cloud/test/helpers/scratch-db.ts:38` — a crashed run leaves its `pos_test_0005_<pid>_*` databases behind. The build log already reports 12 from an earlier process. Fix: in `scratchDatabaseAt`, drop any `pos_test_0005_%` database whose pid is no longer running, or document a manual cleanup step in the runbook.
- **R-4 (Nit, T5)** `packages/domain/src/permissions.ts:54` — `GROUPS` is listed in `PERMISSIONS` order rather than by group, so reviewing AD-2 means reading it twice. Fix: order the entries by group, or add a comment that points to AD-2.

## 2026-10-27 — batch review, tasks 0, 2, 3, 4, 6, 34 (commits d1cef54..040b31a)

VERDICT: BLOCKERS


**Scope:** the commits after `fbec27e review(01b): final gate`:
- `d1cef54` task 0 (done by the human, P-1 answer A)
- `e54601d` P-2 answer
- `543eb2f` autobuild chore
- `d21d8d1` task 2
- `8eb9cd4` task 3
- `ca61be9` task 4
- `7385fce` task 6
- `e0ec2b8` task 34
- `040b31a` docs

**Checked against:**
- foundation §6 (D46 upcasters and fixtures, §6.2)
- 01b spec v1.0: B7, B11, B12, B16, B18, B22, §3.3, §3.4, §4.3 rows 19–20, §4.3.1, §5.3, §6.2–§6.10, tests #64, #66, #86, #89, #93, #94, #105, #106
- plan tasks 2, 3, 4, 6, 34 ("Done when") and the Interfaces block
- AD-3 and AD-4

`pnpm vitest run packages/events apps/cloud/test/cli/issue-code.int.test.ts apps/cloud/test/db/migrate-ahead.int.test.ts` passes: 10 files, 35 tests.

**Class B audit:**
- **AD-3 is correctly Class B.** The wire shape is exactly §4.3.1. The interim values are the v1 meaning that B18 a defines, and no write path can create leads, floors, scopes or responsibilities before task 7.
- **AD-4 is correctly Class B.** The reissue path changes no directory data, so B11's "every write that changes directory data bumps" does not apply.
- **The task 6 "rulings" are Class B decisions that were never recorded.** See R-2.

There are no Blockers. The verdict is BLOCKERS because of three Should-fix findings.

## Findings

### R-1 — Should-fix — T34 — `apps/cloud/src/cli/issue-registration-code.ts:58`

**Problem:** The plan text for task 34 says "qualifying admins only (`qualifyingAdmins` without the branch filter)". `qualifyingAdmins` is the single-statement §3.4 helper defined in the Interfaces block (`guards.ts`, task 19). Task 34 instead inlines a second, independent SQL definition of "qualifying admin". This deviation is not recorded anywhere:
- The status board gives T34 a dependency on `T1` only, when it should be T19.
- No AD covers the choice.

**Failure scenario:** Task 19 builds `qualifyingAdmins` with the full §3.3 `resolve` in SQL, or a later fix changes what counts as an admin (for example, excluding grants from archived roles). The CLI keeps its own copy. Then `issue-registration-code` and the B7 guards disagree about who is an admin:
- If the CLI's copy is wider, it assigns a non-admin (for example a stock counter) to a new branch. That person gets hub admin there.
- If the CLI's copy is narrower, it leaves out an admin the guards rely on.

The owner-link argument in §6.15a ("`issue-registration-code` assigns qualifying admins … so the owner's row covers new branches too") depends on the two definitions being identical.

**Required fix:**
1. Record the interim choice as an AD.
2. Set T34's dependency to T19 and add a note on T19's row: "switch `issue-registration-code` to `qualifyingAdmins` (no branch filter) and keep #93 green".
3. When task 19 lands, replace the inline SQL with the helper.

### R-2 — Should-fix — T6 — `packages/events/src/admin/staff.ts:130`, `:159`

**Problem:** `StaffPatchBody` and `RolePatchBody` refuse a body that contains only `expected_version`, returning `400 VALIDATION_FAILED`. This is a decision on a public API request shape. Two things are wrong:
- **The spec text disagrees.** Spec §6.4 and §6.7 say "`expected_version` (required) **and any of** …". The directory write script defines the no-op rule: "the version check runs first, so a stale no-op is still `409`". A version-only body is the purest no-op, so under the spec it gets `200` with the stored entity, or `409 CONFIG_STALE` when stale. The refine turns both into `400`.
- **It was not recorded.** The build log calls these "rulings", but nothing was added to `01b-auto-decisions.md`, which Class B requires.

The 01a precedent (`restaurant.ts` uses `> 0` refines) is not quoted in either 01b section.

**Failure scenario:** A client that has nothing to change sends `{ expected_version }` to confirm its copy is still fresh, for example the S08 inline idle edit after the user reverts the field. It gets `400` instead of `409 CONFIG_STALE` or `200`. Spec test cases on the no-op rule (§6.4, §6.7) built from a version-only body would fail.

**Required fix:** Pick one of these:
- Drop the `> 1` refine so a version-only body follows the no-op rule (smallest change; it matches the spec text).
- Keep the refine, record it as AD-5 (01a precedent), and patch the spec to v1.0.1 ("auto-patch AD-5"): "at least one field besides `expected_version`".

Record the `PinBody` `[0-9]` ruling in the same AD. It is equivalent to the spec's `\d` because JavaScript's `\d` without the `u` flag is ASCII-only.

### R-3 — Should-fix — T6 — `packages/events/src/fixtures.test.ts:10`, `packages/events/fixtures/`

**Problem:** Foundation §6 says `packages/events/fixtures/<EventType>.v<N>.json` holds "one stored sample per schema version, never edited after merge". `StaffDirectoryApplied` v2 is now registered, and `latest.json` was bumped to `schema_version: 2`, but no `StaffDirectoryApplied.v2.json` was added. The fixtures test also iterates `*.v1.json` only, so a v2 sample would never be checked.

**Failure scenario:** A future v3 lands, and its upcaster test (latest = v3) only proves v1 → v3. A stored v2 row with a `'lead'` or `'responsibility'` skip kind, which only exists from v2, is never covered by a fixture. A v2 → v3 upcaster that mishandles those kinds then breaks hub replay with no failing test.

**Required fix:**
1. Add `packages/events/fixtures/StaffDirectoryApplied.v2.json` with a `'lead'` skip.
2. Extend the fixtures test to upcast every `*.v<N>.json`, not only v1, to its `.latest.json`.

## Nits (non-blocking)

- **N-1 (T34)** `apps/cloud/test/cli/issue-code.int.test.ts:266`: #86's lock-wait check would also pass if the CLI took no lock up front, because the `UPDATE tenants … directory_version` at the end blocks on the held row too. The test does not prove the lock is taken **first**, which is what B11's lock order requires. Fix: in the waiting loop, assert through `pg_locks` / `pg_stat_activity` that the waiting statement is the `SELECT … FROM tenants … FOR NO KEY UPDATE`.
- **N-2 (T6)** The directory and #64 tests were not seen failing against the old code (the build log says so). Next time, confirm fail-first with `git stash`.
- **N-3 (T2)** `[01b #66]` does not assert that the stale > gap CHECK still holds after the clamp, which the spec names as `branches_day_settings`. Add `UPDATE … day_stale_after_hours = 12, day_min_gap_hours = 12` and expect that constraint.
- **N-4 (T4)** `[01b #105]` checks "boot succeeds" with `migrate()` only, not with the spawned process. The spawned process uses a fixed `PORT 3001`, which can collide on a developer machine.
- **N-5 (T34)** No test asserts that `directory_version` is unchanged on the `--branch-id` reissue path, which is AD-4's choice.
