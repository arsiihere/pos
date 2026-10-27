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

## 2026-10-27 — batch review, tasks 7, 8, 11, 35, 48 (commits b8af80d..d71e18e)

VERDICT: BLOCKERS


**Scope:** the commits after `a24c0ce review(01b): batch review`:
- `b8af80d`, `7b2ad61`, `ff391ce`: R-2, R-3 and R-1 fixes from the previous review
- `76f631f` task 7
- `365d868` task 8
- `7ccb562` task 11
- `2c26807` task 35
- `60caf88` task 48
- `d71e18e` docs

**Checked against:**
- foundation §6 (D46 fixtures, §6.2 codes)
- 01b spec v1.0: B3, B5, B7, B14, B17, B18, B23, §3.3, §4.3 rows 5, 8, 11, 12, 18, §4.3.1, §5.1, §5.2, §5.3, §6.13, §6.15, tests #20–#24, #65, #73, #83, #84, #91, #107
- plan tasks 7, 8, 11, 35, 48 ("Done when"), P-2 and the Interfaces block
- AD-5 to AD-9

`pnpm vitest run` on the batch's six test files passes: 33 tests.

**Previous review fixes:**
- R-1 (AD-6) and R-2 (AD-5) are done as required.
- R-3 is done with a recorded deviation: the v2 fixture has an empty `skipped`, because of the single `latest.json` rule. That is acceptable.

**Class B audit:**
- AD-7, AD-8 and AD-9 are correctly Class B.
- AD-9 sets only free-string `id` / `reason` values inside the existing v2 `skipped` schema, and keeps role subjects of a responsibility, which B18 b ("someone") does not cover. No event schema, sync contract or security behaviour changes.
- AD-8 is really Class A (test infrastructure).

**Code checks with no findings:**
- Task 7 `loadDirectory`: 8 statements, PIN-less staff left out, m3 approver roles included, archived floors and stations excluded, dual-written `approver_role_id`.
- Task 8: migration verbatim to §5.2, delete order, `changed` still means PIN-only (a lead or floor change ends no session), skip semantics per B18 b and c.
- Task 11: version inputs match §5.3 exactly.
- Task 35: guard order (verify → one read → 503 on a failed read → 401 on no row or `cv` mismatch → 403 on `/v1/admin/*`); refresh refuses a stale `credential_version` before reuse detection, so nothing is revoked.
- Task 48: §6.15 table.

The refresh and login paths still read the owner row without a lock, so a change that lands mid-request issues a token with the old `cv`. That fails safe, because the guard refuses it, and tasks 36–37 own the lock order. It is not a finding.

## Findings

### R-1 — Blocker (test that lies) — T48 — `apps/cloud/test/cli/seed-tenant.int.test.ts:221-235`

**Problem:** The test is titled `[01b #20] … both roles sign in once with the union …`. Spec #20 requires "a staff member given both roles signs in once and `resolve` returns the union (no mode)". The test instead inserts two `staff_roles` rows for `S_BOTH` and reads the same two rows back. It never calls `resolve`, never builds a directory, and never signs in.

The comment says the hub's `resolve` takes the union, but nothing asserts it. Both default roles also have no grants, so even a real `resolve` would only show `not_granted`.

**Failure scenario:** A future change breaks the union, for example:
- `loadDirectory` sends only one of a person's roles, or
- the hub's `resolve` stops unioning (task 9 rewrites `resolve` for scopes).

#20 stays green. The build log and status board record #20 as covered, so nobody adds the missing check.

**Required fix:** Make #20 prove the union. Two options:
- **(a)** In the cloud test, give `order_taker` and `waiter` one distinct test grant each, put `S_BOTH` (with a PIN) on a branch, and call `loadDirectory`. Assert that the directory has one `S_BOTH` row with both `role_ids`, and that both grants appear on the wire.
- **(b)** Keep the cloud half as (a) without `resolve`, and add `[01b #20 hub half]` to the hub suite (task 9's `staff-directory-v2.int.test.ts`): one staff with Order taker and Waiter, one grant each, `resolve` returns `allowed` for both. Record the split in the status board, as was done for P-3.

Either way, retitle the cloud test so it does not claim more than it asserts.

### R-2 — Should-fix — T7 — `apps/cloud/test/staff-roles/load-directory.int.test.ts:246`; plan coverage row `21, 24, 83 | 7`

**Problem:** Spec #83 has two halves:
- **Cloud half:** `loadDirectory(B)` includes the Manager role.
- **Hub half:** "on the hub, a cashier's `apply-discount` resolves `requires_approval` with `approver_role_ids [manager]`, not skipped".

The `[01b #83]` test covers only the cloud half. The plan maps #83 to task 7 alone, so no later task will add the hub half.

#84 covers dropping an unknown approver, not the m3 case. In the m3 case the approver role reaches the hub only as an approver, held by nobody at the branch, and the grant must survive the apply.

**Failure scenario:** A hub change that builds `roleIds` from roles that someone holds would skip the Cashier grant with kind `approver`. Examples: a "prune unused roles" step, or a `retainRole`-style filter applied to incoming roles. Cashiers at a branch with no manager then lose discounts with approval. #83 stays green.

**Required fix:**
1. Add `[01b #83 hub half]` to `apps/hub/test/auth/apply-directory.int.test.ts`: apply a directory where the Manager role is in `roles` but in no staff row's `role_ids`. Assert that the cashier's `resolve('apply-discount')` is `{ grant: 'requires_approval', approver_role_ids: [manager] }` and that `skipped` has no `approver` entry.
2. Note the split on the status board.

## Nits (non-blocking)

- **N-1 (T8)** `apps/hub/src/auth/apply-directory.ts:277`: `readCache` joins approvers to grants with `filter` per grant, which is O(grants × approvers) in memory. `StaffDirectory.load` already uses a map (`approversByGrant`). Use the same map here.
- **N-2 (T35)** `apps/cloud/src/plugins/tenant-scope.ts:59`: #107 forces the failure through a hook that throws **before** `ownerGuardRow` runs. The real paths the spec names are not exercised: a pg connection error and a statement timeout. One case with a `statement_timeout`-forced or closed-pool read would prove the catch covers them.
- **N-3 (T35)** `apps/cloud/test/owner-auth/guard.int.test.ts:109`: `toBeGreaterThanOrEqual(19)` would still pass if a `/v1/admin/*` route dropped out of the inventory. Pin the exact expected count, 19 now and 32 once 01b's routes land, or reuse the route-inventory test's list.
- **N-4 (T7)** `[01b #24]` stops at the schema boundary, per P-2. Fine as answered. Note that a v1.4 hub's apply of a v2 directory now hinges on 00's tests alone.
- **N-5 (T11)** `toResponsibilitySet(_branchId, …)` ignores its `branchId` argument. If the Interfaces block keeps it, add a guard such as asserting every row belongs to the branch, or drop the parameter in task 12.

## 2026-10-27 — batch review, tasks 9, 12, 36, 37, 38 (commits d08e093..a680d6a)

VERDICT: BLOCKERS

# 01b batch review: tasks 9, 12, 36, 37, 38 (2026-10-27)

**Scope:** the commits after `4e9e5df review(01b): batch review`:
- `d08e093`, `2213337`: fixes for R-2 and R-1 from the previous review
- `cf2b61a` docs
- `5ee236f` task 9
- `156fe20` task 12
- `ba6e263` task 36
- `5af3f2b` task 37
- `434dd4f` task 38
- `a680d6a` docs

**Checked against:**
- foundation §6
- 01b spec v1.0: §3.2 rules 1–6, §3.3, §3.5, §3.6, §3.7, §6 (directory write script), §6.1, §6.2, §6.11, §6.13, §7.2, B8, B11, B12, B23
- tests #4, #6, #7, #12, #13, #18, #20, #31, #33, #37, #40, #42, #44, #56, #81, #83
- plan tasks 9, 12, 36, 37 and 38 ("Done when"), and the Interfaces block
- AD-10, AD-11, AD-12

**Test run:** `pnpm vitest run` on the batch's 26 test files passes (133 tests). `tsc --noEmit` for cloud is clean.

**Previous review fixes:**
- R-1 is done. `[01b #20 cloud half]` now gives each role a distinct grant and asserts one directory row with both roles and both grants. `[01b #20 hub half]` asserts that `resolve` returns the union, both on the applied directory and after `load`.
- R-2 is done. The `[01b #83 hub half]` test is present, and the split is recorded on the status board.

**Class B audit:**
- **AD-10** (`directoryWrite` returns `IdempotentResult`, and `fn` returns `{ body, bump }`) is an internal signature. Correctly Class B.
- **AD-11** sets `field` paths and a reason taken from the catalogue. Its "foreign `?branch_id` gives an empty list" rule changes no shared contract and no error code. Correctly Class B. However, the code does not keep AD-11's own "repeats are de-duplicated" promise for floors (R-1).
- **AD-12** moves where the spec-fixed response schema lives and adds a column to an internal row type. Correctly Class B. The route case's wrong password counts one per-IP failure per sweep, which is harmless.

**Code checks with no findings:**
- **Task 9 `resolve`:** takes the widest scope among the roles that grant the winning type. An allowed grant is never widened by a requires-approval grant (#12). The approver union is sorted. `floorsOf`, `leadOf`, `teamOf`, `stationsOf` and `responsibilityHolders` match §3.5–§3.6 and §4.3 row 7.
- **Task 12, directory write script:**
  - order: idempotency key → tenant `FOR NO KEY UPDATE` → owner row → B8 coverage → rules → write → audit (wire without `version`) → `directory_version + 1`
  - rule order matches §6.2 (1)–(5)
  - B12 is case-insensitive and ignores leavers
  - `GET` runs 6 statements
  - both routes are in `ROUTE_CASES`, and #93 and #73 are extended
- **Task 36 login success transaction:** takes `lockOwnerRow` with the verified hash.
  - A changed hash gives `401` and counts nothing.
  - An expired temporary password rolls back, then takes the failure path.
  - The notice is read and cleared under the same lock.
  - The lock `UPDATE` sets `lock_notice_at` in the same statement.
- **Task 37 refresh:** lock order is token without a lock → owner `FOR NO KEY UPDATE` → token `FOR UPDATE` → `credential_version` equality, and nothing is revoked on a mismatch. A test proves the lock order. The rotating path clears the notice. The grace path returns `null` and writes nothing (#81).
- **Task 38 change-password:**
  - (0) uses the shared limiter; (1) runs before any hash work.
  - The new hash is computed outside the transaction.
  - (5a) takes the lock with the verified hash, and no row gives `401` with nothing counted.
  - (5b) is one `UPDATE` that sets `credential_version + 1` and resets the counter.
  - (5c) revokes, issues a new pair with the new `cv`, and writes the audit with no password fields.
  - Logger redaction covers both password fields (#44).
  - Steps (3) and (4) (the account lock and counter) are left to task 39, as the plan splits them. Until then, a wrong current password counts only for the per-IP limit. That is recorded on the status board and is not a finding.
- **Deadlocks:** every path takes the owner row in one mode before any token row. The `UPDATE`s on non-key columns of the owner row take the same `NO KEY UPDATE` mode, so nothing is upgraded.

## Findings

### R-1 — Should-fix — T12 — `apps/cloud/src/modules/staff-roles/service.ts:63` (with `repository.ts` `insertStaff`, `staff_floors` PK)

**Problem:** AD-11 says "repeats are de-duplicated (lists are sets)". `createStaff` removes repeats only *inside* one `floors` entry (`unique(entry.floor_ids)`). The `Floors` Zod schema allows two entries for the same `branch_id`.

**Failure scenario:** `POST /v1/admin/staff` sends `floors: [{ branch_id: A, floor_ids: [F1] }, { branch_id: A, floor_ids: [F1] }]`.
1. `checkFloors` passes both entries.
2. `insertStaff` inserts `(A, S, F1)` twice.
3. The `staff_floors` primary key `(tenant_id, branch_id, staff_id, floor_id)` raises pg `23505`. Nothing maps that error, so the owner gets `500 INTERNAL` instead of a defined answer, and an idempotency key that was used may be left in an error state. Task 14's PATCH will reuse the same path.

No test covers repeated ids, although AD-11 claims they are handled.

**Required fix:**
- De-duplicate `(branch_id, floor_id)` pairs across entries before the insert, for example `unique` on `pairKey` over the flattened list. Keeping AD-11's "lists are sets" rule is the smallest change.
- Add a test: repeated `role_ids`, `branch_ids` and `denied_permissions`, and a `floors` list with the same branch twice, all give `200`, with each id stored once.

## Nits (non-blocking)

1. `listStaff` runs its 6 reads on the pool with no shared transaction or snapshot. A write that lands between the reads can produce a `StaffWire` and `version` for a state that never existed. This fails safe: the next PATCH gets `409 CONFIG_STALE`. A `REPEATABLE READ` read-only transaction would make the reads consistent.
2. `changePassword` (and the existing `login`) count a server error, such as a DB failure, as a per-IP failure, because the limiter is released only on the paths that are marked "not a guess".
3. `routes.ts` change-password verifies the JWT a second time (`app.jwt.verify(access).sub`) after the tenant guard has already verified it. This is the same pattern as `staff-roles/routes.ts`. It is harmless but redundant.
4. AD-12's `ROUTE_CASES` body for change-password sends a wrong current password. After task 39 that also counts toward tenant A's account counter, once per sweep. Watch for tests that run the sweep more than 9 times against one owner in a 15-minute window.
