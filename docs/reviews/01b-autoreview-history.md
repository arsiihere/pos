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

## 2026-10-28 — batch review, tasks 10, 13, 14, 21, 22 (commits 13889a0..80fd0c1)

VERDICT: PASS

# 01b batch review: tasks 10, 13, 14, 21, 22 (2026-10-28)

**Scope:** the commits after `06a116b review(01b): batch review`: `13889a0` (R-1 fix), `700ce3f` (autobuild prompt), `ecd44f3` (T10), `0a4785c` (T13), `7d6700a` (T14), `b2ff8a3` (T21), `1e6331f` (T22), `80fd0c1` (docs).

**Checked against:** foundation §6, 01b spec v1.0 §3.1 (B3, B8, B9, B10, B11, B12, B21, B23), §3.2, §3.3, §3.4, §4.3 rows 9–10, §5.1, §5.3, §6 directory write script, §6.3–§6.6, §9, tests #2, #3, #8, #13–#15, #19, #25, #36, #58, #60, #85, #87; plan tasks 10, 13, 14, 21, 22 ("Done when"); AD-13, AD-14.

**What holds:**
- Directory write script order is right: idempotency key first (role POST) → tenants `FOR NO KEY UPDATE` → owner row and B8 → target `FOR UPDATE` in id order → version compare → rules → write → audit → `directory_version + 1` → commit. A no-op skips the bump and the audit (tested in #2), and the version compare runs before the no-op check, so a stale no-op is `409` (B23 test).
- PIN (§6.3, B9): argon2id with M8 parameters, hashed outside the transaction; 404 for a leaver, unknown id or another tenant's person; the audit row holds only `{ has_pin, pin_set_at }`; `pin` is redacted in the logger; never a no-op; version unchanged; bumps the directory, so the hub gets the new hash (#3 hub half ends sessions `credentials_changed`).
- Staff PATCH (§6.4): the `branch_ids` diff leaves the kept `staff_branches` row untouched (#87 checks the ctid); the person's own leads and floors at a removed branch go by FK cascade; whole-list replace for denials, leads and floors; B12 re-runs on a rename or an added branch.
- Roles (§6.5, §6.6, B10): 4 statements; `approver_role_id` is dual-written as the first approver in UTF-16 sort order, with one `role_permission_approvers` row per approver; approvers are checked as active roles of the tenant; the name check is case-insensitive among active roles (backed by the `roles_active_name` index); `staff_count` counts only active staff; the audit `after` leaves out `version` and `staff_count`; replay and mismatch are covered by #60.
- T21: the tenant lock is `FOR NO KEY UPDATE`. #85 proves a menu-item create does not wait on it, and the build log records that the test fails when the lock is switched to `FOR UPDATE`.
- T10: roster responsibilities come from memory, the statement count stays at 2, and the 00 #46 / #82 expectations were widened, not weakened.
- AD-13 is correctly Class B: it adds no code or reason value, the status is the one test #13 asks for, and no other module consumes these new routes. AD-14 is correctly Class B: it only decides which rule checks re-run, with no schema, contract or security effect.
- No skipped or weakened tests. The fixture's `Z…` seed-id space is test infrastructure only.

## Findings

None at Blocker or Should-fix.

## Nits (non-blocking)

- N-1 (T14) `apps/cloud/src/modules/staff-roles/service.ts:178-179`: while task 16 is pending, a body `{ expected_version, is_active: false }` is taken as a no-op and answers `200`, so the person stays active and in the directory. This is tracked on the T16 status row. Task 16 must make this path change state and add a test that fails if `is_active` is ignored.
- N-2 (T14) `apps/cloud/src/modules/staff-roles/repository.ts:316-319` and `0005_staff_roles.sql:86`: removing a branch from a person who leads someone there hits the `staff_leads.lead_staff_id` FK (no cascade), so the call fails with a `500` (pg 23503) instead of the B15 move. Staff responsibilities at the removed branch are also left behind. Both belong to task 16 (status note). Its tests must cover a lead losing a branch, not only a lead leaving.
- N-3 (T14) `service.ts:197` (`checkReportsTo`): with no loop walk yet, `reports_to` naming the person themself reaches the `staff_leads` CHECK and returns a `500`, and a two-person loop A→B→A is stored. Task 15 (loop walk, #27) must include the self-lead case and expect `422 loop`.
- N-4 (T14) staff PATCH runs no admin guards (§3.4) until task 19. This follows the plan's order, but until then a PATCH can remove the last qualifying admin or the owner's own admin access. Do not release before task 19.
- N-5 (T22) `repository.ts:108-113`: the `staff_count` query filters `staff_roles` by `role_id = ANY($2)`. If `staff_roles` has no index leading with `(tenant_id, role_id)`, this scans the whole tenant. That is fine at pilot size; note it for task 25 (archive cleanup uses the same access path).

## 2026-10-28 — batch review, tasks 15, 16, 19, 23, 24 (commits 08ef777..2c117c7)

VERDICT: PASS

# 01b batch review: tasks 15, 16, 19, 23, 24 (2026-10-28)

**Scope:** the commits after `30bca55 review(01b): batch review`: `08ef777` (T15), `93c27a0` (T16), `1df74d0` (T19), `ee8c4cd` (T23), `aa2f6dd` (T24), `2c117c7` (docs).

**Checked against:** foundation §6 (envelope, `DomainError` codes), 01b B7, B8, B11, B12, B13, B15, B21, B22, B23, §3.2 rules 1/5, §3.4, §3.5, §3.6, §6 directory write script, §6.4, §6.7; tests #10, #17, #18, #26–#30, #57, #69, #79; plan tasks 15, 16, 19, 23, 24 "Done when"; the Interfaces "Cloud guards" block; AD-15, AD-16, AD-17.

**Run:** `guards`, `leaving`, `reports-to`, `role-patch`, `roles`, `cross-tenant` int tests: 6 files, 26 tests, all pass.

**Previous nits closed:** last review's N-1 (`is_active` now applied, #10), N-2 (a lead losing a branch moves their reports first, then the branch row goes, #30) and N-3 (a self-lead and A→B→A give `422 loop`, #27). N-4 (staff guards) is done by T19.

## What holds up
- **Guards (§3.4, B7):** `qualifyingAdmins` is one statement (`pgCounter` = 1), evaluated after the tenant lock both before the rules and after the write. Own-admin runs first, then the fail-safe `owner_not_linked` (anyone who stops qualifying at a branch), then last-admin over `A_before \ A_after` only, so branches with no admin before are not blocked. The signature matches the Interfaces block. A stock counter (`access-hub-admin` only) is shown not to qualify.
- **B15 / §3.5:** reports are re-parented to the leaver's own lead (or have their row deleted) before `removeBranches`. This is needed because the `lead_staff_id` FK has no cascade. Each move writes one `staff` / `reports_to_reassigned` audit row with `{ branch_id, lead_staff_id }` and its branch, and appears in `moved_reports` and `changed_versions.staff`. The leaver's own lead rows are deleted. Staff responsibilities are deleted at every branch (leaving) or at the removed branch, and those branches go into `changed_versions.responsibilities`, built by the one builder (B23).
- **Loop walk:** one recursive statement per `reports_to` entry, capped by the branch's active staff count, and it stops when it reaches the person. Leads from other branches are not counted (checked in #27).
- **Role PATCH (§6.7 without archive):** target is locked `FOR UPDATE` after the tenant lock; a missing or foreign role gives `404 ROLE_NOT_FOUND`. The version is compared before the no-op check, so a stale no-op still answers `409`. §6.6 grant rules run on the sent grants, and the name is checked only when it changes. `default_key` is never written. `replaceGrants` cascades to the approver rows and dual-writes `approver_role_id`, checked by #79 against the v1.4 SQL fixture. Exactly one `role` / `update` audit row, with grants and without `version` / `staff_count`.
- **Class B review:** AD-15 (a leaver's sent `reports_to` is ignored; one person audit row `left`/`returned`/`update`; extra responsibility branches may be listed), AD-16 (shared person predicate; CLI behaviour unchanged from AD-6) and AD-17 (`archived` accepted, not yet applied) leave event schemas, the sync contract, request/response shapes, error codes, money/stock and auth unchanged. They are correctly Class B.

## Findings
No Blockers and no Should-fix.

## Nits (non-blocking)
- N-1 (T24) `apps/cloud/src/modules/staff-roles/service.ts:325-373`: role PATCH runs no admin guards yet (§3.4 lists role PATCH grants). Right now a grant edit can remove `manage-devices` from the Owner role and leave every branch without a qualifying admin. The plan assigns this to task 26 (#63, #76), but the T24 status note records only the `archived` interim. Add "no guards until T26" to that note, and do not release before T26.
- N-2 (T23/T24) #18 cloud half: `idle_minutes` 0 / 241 → `400` is tested only on `POST /roles`. `RolePatchBody` uses the same `IdleMinutes`, but no PATCH case would catch a later schema split. Add the PATCH case when task 30 touches the file.
- N-3 (T15) `repository.ts` `leadLineReaches`: the hop cap ("≤ active staff", plan Done when) is never exercised. No test builds an existing cycle that does not include the person (hand-written SQL) to show the walk ends and answers "no loop" instead of hanging.
- N-4 (T16) #10 "no `credentials_changed`" is shown only indirectly, by the same `pin_hash` in the cloud `loadDirectory`. The hub apply is not run. That is acceptable as 00 code (P-3 pattern), but T17's hub test (`poller-leaver.int.test.ts`) could also assert a returner raises no `credentials_changed`.
- N-5 (T19) #69 "after `seed-tenant` the link is set" is simulated by an SQL `UPDATE owner_users SET staff_id`. `seed-tenant` setting the link is covered elsewhere (T48), so this is wording only.


## 2026-10-28 batch review: tasks 17, 18, 20, 25, 27 (202dd11..cfaf4cf)

VERDICT: BLOCKERS

# 01b batch review: tasks 17, 18, 20, 25, 27 (202dd11..cfaf4cf)

Checked against: foundation §6, 01b spec §3.4, §3.6, §6 (directory write script), §6.4, §6.7, §6.8, B14, tests #1, #5, #9, #11, #16, #32, #35, #101, #103; the plan tasks' "Done when"; AD-18 and AD-19.

## R-1 Blocker (T25, AD-18 (2) is not a valid Class B decision; test #5 contradicts the spec)

- `apps/cloud/src/modules/staff-roles/service.ts:390-411` and `apps/cloud/test/staff-roles/role-archive.int.test.ts:242,282`.
- The spec does not leave this open. The §6 directory write script says `writeConfigAudit (one row per changed entity …)`. The same paragraph names "a role archive removing the role from its holders" as a cascade that changes those staff records' versions. Test #5 says "role assignment writes exactly one `config_audit` row per changed entity". §6.4 follows the same rule for cascades: every B15 move writes its own `staff` row. AD-18 calls this a spec gap and chooses to write only the `role` / `archive` row. That changes the behaviour of the immutable audit log, which is a story requirement (E6 AC5). It should have been followed as written or parked; it was not a Class B decision.
- Failure scenario: Bilal holds Waiter and Shift lead. The owner archives Shift lead. Bilal's `role_ids` changes from `[waiter, shift]` to `[waiter]` and his version changes, but no `staff` audit row records it. An auditor reading Bilal's history cannot see when or why he lost the role. The #5 test asserts exactly one row for this archive, while its holder `p` loses the role in that same write, so the test protects the behaviour the spec rules out.
- Required fix: on archive, write one `staff` / `update` row per former holder, with `before` / `after` in wire shape (role_ids before and after). Change #5 to expect 1 + holders rows, and assert that the holder's row exists. Change AD-18 (2) to record the decision as spec-mandated. If the implementer still reads this as ambiguous, park it as P-n (audit behaviour) instead of deciding it. (AD-15's leaver → `responsibility` cascade has the same gap; it was accepted in an earlier batch, but it should be looked at again together with this one.)

## R-2 Should-fix (T25): restore does not check the stored grants against §6.6

- `apps/cloud/src/modules/staff-roles/service.ts:363`: `checkGrants` runs only when `body.grants` is sent. A restore (`archived: false`) re-checks only the name.
- Failure scenario: role X has `apply-discount` `requires_approval` with approver Y. Archive X. Y can now be archived, because B14 only blocks an approver of an **active** role. Restore X. X is active again with a grant whose only approver is an archived role. §6.6 ("approvers active roles of the tenant") fails on the merged row, which §6.7 ("rules as §6.6") requires. On the hub, B18 then drops or skips the approver, so cashiers holding X can never get a discount approved, and nothing warns the owner.
- Required fix: on restore, run the approver check on the merged grants (stored grants when `grants` is not sent). Answer `422 CONFIG_REFERENCE_INVALID { field: 'grants.N.approver_role_ids.M', reason: 'role_archived' }`, an existing code and reason, with nothing written. Add a test.

## Nits (non-blocking)

- N-1 (T27) `service.ts` `putResponsibilities`: the no-op comparison runs before `checkResponsibilities`. A body that repeats a station, or that has an empty entry naming a foreign or archived station, gets `200` when it collapses to the stored set and `422` otherwise. AD-19's "repeated station → 422" therefore depends on state. Consider running the per-entry station checks before the no-op comparison.
- N-2 (T25) `roleUsedBy` / `setRoleArchived` filter `staff_roles` by `role_id`, but the only index is the PK `(tenant_id, staff_id, role_id)`, so each query scans the tenant's rows. That is fine at pilot scale, and merged migrations are frozen. Note it for a later migration.
- N-3 (T20) `guards-race.int.test.ts`: between runs, the test deletes every `staff_branches` row at branch C. That leaves active staff with no branch, which §3.2 rule 1 forbids. The test does not depend on this, but it leaves invalid fixture state behind. Deactivating the two admins, or giving each run its own fixture, would be cleaner.
- N-4 (T17) `poller-leaver.int.test.ts` builds the "after" directory by hand from `aDirectory` instead of from the cloud's `loadDirectory` output. P-3 allows this, but the cloud and hub halves of #9 are linked only by a comment.
- N-5 (T27): plan task 27 lists `apps/cloud/test/cross-tenant.int.test.ts`, but the change was made in `test/helpers/route-cases.ts`. That is correct if cross-tenant iterates `ROUTE_CASES`. The build log should say so.

## Checked and fine

- T17: `STAFF_LINKED_TO_OWNER` is checked after the version and no-op checks and before `qualifyingAdmins`, so the answer is the same with or without a second admin. #101 covers the hand-linked row that is not an admin.
- T18 / T20: the tenant lock serialises the writes. Both race tests are 20 runs, and both were watched failing with the lock removed. #11 asserts the 409 code and branch.
- T27: GET is 1 statement (`pgCounter`). The PUT compares and replaces active-station rows only, and #103 shows the archived station's rows survive. The PUT bumps `directory_version` and writes one audit row with branch_id. The DB CHECK already allows the `responsibility` entity.
- AD-18 (1) (run the role-PATCH guards from T25) and AD-19 are valid Class B decisions: they use existing codes and reasons and change no wire shape.


## 2026-10-28 batch review: R-1, R-2 fixes and tasks 26, 28, 30, 31, 32 (6de0948..993880e)

VERDICT: BLOCKERS

# 01b batch review: fixes R-1, R-2 and tasks 26, 28, 30, 31, 32 (6de0948..993880e)

Checked against: foundation §6, the 01b spec §6 directory write script, §4.4 rows 9–13, §6.7, §6.9, §6.10, B8, B14, B16, B20, B23, and tests #5, #34, #45–#48, #59, #63, #76, #80, #82, #88, #102 and #104. Also checked: the plan tasks' "Done when", AD-15 (reopened by the last review), the AD-18 amendment, and AD-20 to AD-22.

## R-1 Blocker (R-1 fix 6de0948 / T25, and T16 via AD-15): cascaded responsibility-set changes write no `responsibility` audit row

- Code: `apps/cloud/src/modules/staff-roles/service.ts:407-411` (role archive) and `service.ts:262` (leaver).
- The §6 directory write script requires `writeConfigAudit` with one row per changed entity, and it lists both cascades by name: "responsibility entries deleted with a leaver" and "an archived role". The code already treats each branch's responsibility set as a changed entity, because it lists that set in `changed_versions.responsibilities` with a new version. Yet neither path writes a `responsibility` / `update` row for it. The R-1 fix in this batch added the per-holder `staff` rows, then stopped. The AD-18 amendment calls the per-entity rule "spec-mandated, not a decision", which applies equally to the responsibility sets. The last review explicitly reopened AD-15 for this batch, and it is still not addressed. Choosing to write fewer audit rows than §6 requires is not a Class B decision (same reasoning as the previous R-1).
- Failure scenario: Branch A's responsibilities say "Shift lead counts stock at Grill". The owner archives Shift lead. `setRoleArchived` deletes that responsibility row, and the response lists A in `changed_versions.responsibilities` with a new version. `config_audit` gets one `role` / `archive` row and the holders' `staff` rows, but no `responsibility` row for A. An auditor reading A's responsibility history sees the Grill counter disappear with no record. The leaver case is the same: when Bilal leaves, his `count_stock` entries are deleted silently.
- Required fix:
  - For each branch whose active responsibility set the cascade changed, write one `responsibility` / `update` row with `branch_id` set. Its `before` / `after` must be the active set in wire shape, built with the GET's statement before and after the delete.
  - Write no row for a branch where only rows at an archived station were deleted, because its active set did not change.
  - Extend #5 (archive) and the leaver test to assert these rows.
  - Amend AD-15 the same way as AD-18 (spec-mandated). If the implementer still reads this as open, park it as P-n instead of deciding it.

## R-2 Should-fix (T28): the stock query's `meta_version` ignores the `my_stations` scope, so a scope change mid-session does not reach the page

- Code: `apps/hub/src/queries/stock.ts:31`. `metaVersion` is `${config_version}.${start}`, but under B20 `items_meta` and `items` now depend on the directory: the person's `count_stock` stations and their `manage-stock` scope. A directory change (`directory_version`) moves neither part of the version.
- Failure scenario:
  1. A stock counter has the stock page open for station S1.
  2. The owner also gives them S2 through `PUT …/responsibilities`, and the directory syncs to the hub.
  3. The next poll sends the same `meta_version` and `stock_version`, so the hub answers `unchanged: true` with `items_meta: null, items: null`.
  4. `StockApp.tsx:163-164` keeps the old rows. S2's items stay missing until a menu or config change, a day open or close, a stock movement, or a page reload.
  5. Even when stock moves, `items` includes S2's items but `items_meta` is still null. The page builds its rows from `meta` (`StockApp.tsx:178`), so S2's rows still do not show.
  6. The reverse happens when a role's scope changes from `my_stations` to `branch`.
- Required fix: make the meta part of the version depend on the scope, without an extra statement. For example, append a scope key: `b` for scope `branch`, or a short hash of the in-scope item ids under `my_stations`. Then an in-scope change returns fresh `items_meta` and `items`. Add a test: query, change the directory with `seedDirectory`, query again with the returned versions, and expect the new items.

## Nits (non-blocking)

- N-1 (T26, AD-20): spec test #63 still says "marking themselves as left → `409 OWN_ADMIN_ACCESS`", which contradicts J-6 and #101. AD-20's reading is right, but the spec stays self-contradictory. An auto-patch (v1.0.1, test #63's wording only) would stop the next reader from tripping over it.
- N-2 (T30 / R-2 fix): `checkGrants(…, roleId)` treats the role being written as active even when the PATCH edits the grants of a role that stays archived. That is harmless: restore re-checks the grants, and an archived role grants nothing. But the comment says "counts as active here" without saying the role is still archived.
- N-3 (R-1 fix): `selectRoleHolders` repeats the holder list that `setRoleArchived` already returns. The archive path now costs two extra statements: holder ids, then staff before and after. Fine at pilot scale; one `selectStaff` keyed by role would do.
- N-4 (T28): until task 29, a `my_stations` holder can still `OpenBusinessDay` / `CloseBusinessDay` (§4.4 row 12, D-6). This is expected interim state. Keep T29 next so the gap does not ship.
- N-5 (T31, AD-22): the `branch` audit row holds `{ name }` only, while `branch_settings` rows hold the three settings fields. Both are fine. The build log or AD-22 could say that 01a's "`before` = the locked row" is read as "the fields the route owns" for both.

## Checked and fine

- R-2 fix: restore runs `checkGrants` on the stored grants. A role that approves its own grant still restores, and an archived approver → `422 role_archived` with nothing written.
- T26: #63, #76 a–d and #82 assert codes, `branch_ids` and "nothing written". The tests were watched failing with the guards removed.
- T28: the scope check comes after the 01a checks (AD-21, a valid Class B: no new code or shape). `item_ids` lists every outside item. The rejected commands append nothing and leave no `processed_commands` row. The query keeps 1 statement, and a holder with no stations sees none.
- T30: the version hook is called at all three in-transaction compares, and #104's source check is real. #80 and #102 were watched failing with the cascade marks removed.
- T31: its own script (B8 → `FOR UPDATE` → no-op → update → 23505 `branches_name` → `409`), no version bump, tenant-filtered lock → 404 across tenants. #88 runs 10 concurrent pairs. `AuditEntity` `branch` is allowed by the 0005 CHECK.
- T32: the merged stale ≤ gap check → `400 VALIDATION_FAILED` on `day_min_gap_hours`, in the same issue shape as 01a. The no-op writes nothing. Exactly one branch's `config_version` is bumped (#45). GET is 1 statement, with the guard read excluded. B8 → 403 is tested.

# 01b batch review: fixes R-1, R-2 and tasks 29, 33, 39, 40, 41 (f348bcd..14424a8) — 2026-10-28, VERDICT: PASS

Checked against: foundation §6; the 01b spec B5, B19, B20, D-6, D-11, §4.4 rows 6, 7, 12–14, §6 directory write script, §6.11, §6.13, §6.14; 01a v1.3 §6.1 step (6) and §6.7b; tests #38, #39, #41, #43, #67, #68, #71 (server part), #75, #90 and #92; the plan tasks' "Done when"; the last review's R-1 and R-2; the AD-15 amendment, AD-23 and AD-24.

No Blockers. No Should-fix.

## Nits (non-blocking)

- N-1 (T29): `requireBranchScope` and `manageStockScope` live in `apps/hub/src/commands/set-precooked-stock.ts`, and `open-business-day.ts` and `close-business-day.ts` import them from there. A day command depending on a stock-item command file is an odd edge. A small shared `stock-scope.ts` next to them would read better.
- N-2 (T33): `apps/cloud/src/modules/config-sync/service.ts:31-33`. The hub-times `UPDATE` runs after the read, as 01a §6.1 step (6) says. If it fails (for example, a lock wait behind a long owner write on the same `branches` row), the hub gets an error for a poll whose read succeeded. That is harmless, because the hub retries at the next interval. A one-line comment saying a failure here is acceptable would stop a later reader from "fixing" it by moving it into the read transaction.
- N-3 (T33): if a config write commits between the `REPEATABLE READ` snapshot and the `UPDATE`, a `304` stamps `hub_synced_at` a few milliseconds after the hub actually fell behind. The next poll answers `200` and stops `hub_synced_at` moving, so the warning still fires within the threshold. This follows the spec as written, so it is noted only.
- N-4 (T41): #41's check "the temporary password never appears in captured logs" only shows that the Fastify app never logs it. The CLI writes only to the injected `out`/`err`, so the claim holds by construction. The assertion still proves less than its name says.
- N-5 (R-2 fix): `scopeKey` hashes the in-scope item ids on every poll from a `my_stations` holder. That is cheap at pilot scale (a few hundred ids). If the item list grows, it could be memoised per `(config_version, directory_version, staff_id)`.

## Checked and fine

- R-1 fix (f348bcd): the leaver, team-removal and role-archive cascades read the affected branches' sets before the delete (1 statement) and the active sets after it (1 statement). Each branch whose active set changed gets one `responsibility` / `update` row, with before/after in GET wire shape and `branch_id` set. A branch that only lost rows at an archived station gets none, and the test asserts this with ST_X on b2. Restore writes nothing extra. The AD-15 amendment records this as spec-mandated, which is correct. The spec fixes no statement count for PATCH staff/role, so +2 statements stays within it.
- R-2 fix (c7a67a1): `meta_version` gains a hash of the in-scope item ids only when the config is scoped. Scope `branch` keeps 01a's version unchanged, and 01a's tests stay green. The new test covers stations added, stations removed and scope changed to `branch`, each reaching the next poll with fresh `items_meta` and `items`, then `unchanged: true` once nothing moves. The statement count is unchanged.
- T29: `OpenBusinessDay` / `CloseBusinessDay` check scope first inside `handle`, which runs after the `manage-stock` resolution (§4.4 row 12). The error is `403 PERMISSION_DENIED { permission: 'manage-stock', reason: 'outside_scope', required_scope: 'branch' }`, exactly as in D-6. #68 asserts no hub event and no `processed_commands` row. Scope `branch` opens as in 01a. AD-23 is a valid Class B decision: the field is already in the spec, sending it on unchanged answers comes from memory, and §3.3 allows only `branch` and `my_stations` for `manage-stock`, so the "anything else → branch" fallback cannot widen access.
- T33: `CONFIG_POLL_INTERVAL_MS` is exported from `@pos/events`, and the poller's own constant is gone (#92 source check plus fake timers). Step (6) is one `UPDATE` after the read transaction, tenant- and branch-filtered: `304` sets both times, `200` sets `hub_last_seen_at` only. #67 covers a stuck `config_version`, a lagging directory, another branch left untouched, and counts of 2 and ≤ 17. `GET /v1/admin/branches` stays 1 statement and returns `hub_stale_after_ms = 3 × interval`. The 01a test edits (#1 count 1 → 2; list shape) are exactly what 01a v1.3 §6.1 / §6.7b require, not weakening. No version hash or trigger reads the hub times, so polls cannot cause spurious `409`s.
- T39: step (3) locked → dummy verify, `PASSWORD_INVALID`, account counter untouched, IP failure counted (the limiter slot is not released). Step (4) mismatch → login's counter `UPDATE` (lock + `lock_notice_at`), IP counted. #38 shows that change-password and login failures share one per-IP budget (31st → 429). #39 covers 30 locked attempts, the counter unchanged, then 429, and the change succeeding once the lock passes.
- T40: #43 and #90 run 20 times each and order the waiters deterministically with a held `FOR NO KEY UPDATE` and `pg_stat_activity` lock-waiter polling. Cloud test files run serially (`fileParallelism: false`), so the waiter count is not polluted. The loser is not counted. One audit row each. The reset-vs-change case leaves `must_change_password` true and the temporary password working.
- T41: `SystemContext`, `lower(email)` (unique index `owner_users_email`), `FOR NO KEY UPDATE` before any write, 4×4 Crockford (80 bits), `credential_version + 1`, a 24 h expiry, counters, lock and notice cleared, every refresh token revoked, and the audit row `owner_user` / `password_reset` with `actor_kind 'cli'` and the spec's before/after fields. An unknown email or a usage error → exit 1, nothing written. AD-24 (output format, test hook) is a valid Class B decision.

# 01b batch review: tasks 42, 45, 49, 50 (0f9ad19..ef31407) — 2026-10-28, VERDICT: BLOCKERS

Checked against: foundation §6; the 01b spec §6.11 (Retry), §6.12, §6.13, §6.15a steps 1–11, §8, §9; tests #61, #62, #72, #74 a–b, #97, #100; the plan's "Done when" for tasks 42, 45, 49 and 50; AD-25 to AD-28. I re-ran the 10 test files in this batch: 36/36 pass.

## Should-fix

- **R-1 (Should-fix, T45 / AD-25)**: `docs/specs/01b_Staff_Roles_Spec_v1.0.md:1054` (test #97), `apps/cloud/test/cli/link-owner-staff.int.test.ts:180`.
  - **Problem:** test #97 says Y is not a qualifying admin at B because of "a denial of `manage-devices` at B". `staff_permission_denials` has no branch column (00 0001), so that state cannot exist, and the test was rewritten with B as a branch Y is not assigned to. The decision itself is sound and is Class B: no schema, contract or security change, and the CLI is unchanged. But it changes what a spec test says without patching the spec. AUTOBUILD says: "If the spec text itself must change, patch the spec as a minor version … 'auto-patch AD-n'".
  - **Failure scenario:** the spec still describes a test that cannot be built. A later task or human reviewer who checks #97 against the spec finds a test that does not match its text. T46 (#95, "a denial of `access-hub-admin`") or a future 01b revision could also "fix" the schema to fit the stale text, adding a per-branch denial, which is a schema change used by 00.
  - **Required fix:** patch the spec to v1.0.1, changing #97 to "at B and C it is not assigned (denials are per person, not per branch)". Add a change-log line "auto-patch AD-25", and note the patch in AD-25. No code change.

## Nits (non-blocking)

- N-1 (T50): `apps/client/src/api/cloud-admin.ts:403`. `changePassword` goes through the shared `call`. On `401 JWT_INVALID` that path refreshes and re-sends the non-idempotent change. On a double-tap (§6.11 Retry, test 90), the second request can get `JWT_INVALID` before the first's `200` has stored the new pair. It would then refresh with the old refresh token (refused because `cv` no longer matches) and log the owner out, although "the first response's tokens stay valid". This is harmless once T55 disables the submit button while a request is in flight. Mention it in T55 or skip the refresh-and-retry for this one call.
- N-2 (T50): `apps/client/src/features/owner/Shell.tsx:37,39`. Staff and Teams both use the `user` icon.
- N-3 (T50): the plan puts the owner menu under `apps/client/src/components/`, but it lives in `features/owner/Shell.tsx`. This is a correct Class A path fix, but the build log does not mention it.
- N-4 (T49): `getTeamTree` silently drops people in a lead cycle (they are never roots and never reachable). §3.5 refuses loops on write, so this cannot happen today. A one-line comment would make the assumption explicit next to AD-28's "nobody active is hidden".

## Checked and fine

- **T42:** `afterOwnerRowLock` fires right after the owner-row lock on login, change and refresh. It is passed only when `testHooks` is set. #74 a shows the refresh's access token → `401 JWT_INVALID` on `/v1/admin/staff`, its successor → `401 REFRESH_TOKEN_INVALID`, and the change's token still working. #74 b shows the refresh → `401 REFRESH_TOKEN_INVALID` with exactly 2 token rows (none from the refresh). Waiting is proven with `pg_stat_activity` lock waiters, which is safe because cloud files run serially. Status records the check with the lock removed.
- **T45:** §6.15a steps 1–11 run in order, in one `SystemContext` transaction. The lock order is tenant → owner row (`FOR NO KEY UPDATE`), with `afterTenantLock` after the tenant lock.
  - Step 4: the refusals come in spec order. The "linked to another owner" check leaves out the acting owner's own row (AD-26, correct: that case is step 6's no-op).
  - Step 5: the target is printed before the no-op and confirm-name checks.
  - Step 7: the name comparison is exact, with no trim.
  - Step 8: a tenant with no branch is refused.
  - Step 9: one `qualifyingAdmins` statement, the same §3.4 SQL as the guards, lists every failing branch by name and id.
  - Step 10: the audit is `owner_user` / `update`, `actor_kind 'cli'`, `{ staff_id }` old → new, with no directory bump.
  - The tests: `expectRefused` asserts link unchanged, no audit row and no directory bump on every exit-1 path, including the usage path. #72 also asserts that test 69's write then gets `OWN_ADMIN_ACCESS` without `owner_not_linked`. #100 covers missing, case, double-space and trailing-space names, with the summary printed each time.
  - AD-26 (output format) is Class B.
- **T49:** 3 statements (counter reset at `handlerStart`, so the guard read is excluded). The count is re-checked after 6 more staff. The tree is built in memory and ordered `lower(display_name), staff_id`. `role_ids` are JS-sorted (§5.3). `has_pin` comes from `pin_hash IS NOT NULL`. A leaver is absent. A branch outside the JWT list and another tenant's branch both → `404 BRANCH_NOT_FOUND`. The route is added to `ROUTE_CASES` (AD-8) so the cross-tenant and guard sweeps cover it. #62 cloud half: a no-PIN Cook saved with `reports_to` shows in the tree and is absent from `loadDirectory`. Hub half: not in the roster, `POST /auth/pin` → `404 STAFF_NOT_FOUND`, no `auth_lockouts` row, no event. AD-28 is Class B (read-only display, defensive).
- **T50:** each API call's method, path, body and `Idempotency-Key` are asserted against §6. Only creating POSTs carry a key, and change-password carries none (§6.11). `changePassword` stores the new pair and clears `must_change_password`. That follows §6.11 (every older token dies; "the client keeps the first response"), so AD-27 is not a hidden session decision. `applyChangedVersions` returns a new store and leaves the old one unchanged. The router covers all six §8 hashes plus their edit routes and rejects others. The §8 support copy matches word for word. The test checks every `perm.<key>` from `PERMISSIONS`, every §9 code and every new reason. Missing Urdu is tracked in `docs/design/handoff/01b/urdu-todo.md` and enforced by the test, which meets the plan's "Done when". The request types are type-only additions to `@pos/events`, with no schema change.
- Scope: no file outside the four tasks, no migration touched, no test skipped or weakened.

## 2026-10-28 batch review: R-1 fix and tasks 43, 44, 46, 47, 50b (5658542..5dcfc6e)

VERDICT: BLOCKERS

# 01b batch review: R-1 fix and tasks 43, 44, 46, 47, 50b (5658542..5dcfc6e)

Checked against: foundation §6; the 01b spec §6.13, §6.14, §6.15a, §7.5, §8, B7, B11; tests #74 c–e, #95, #98, #99; 01a v1.3 S50 a (the owner shell, which 01b does not change); the plan's "Done when" for tasks 43, 44, 46, 47 and 50b; AD-25 (amended) and AD-29 to AD-31. I re-ran the 4 test files in this batch: 26/26 pass.

## Blockers

- **R-1 (Blocker, T47 / AD-29: a wrong Class B)**: `docs/runbooks/owner-password-reset.md:17-34`, `docs/reviews/01b-auto-decisions.md` (AD-29).
  - **Problem:** §7.5 asks for "identity check questions" but does not list them. AD-29 picked them itself: the sign-in e-mail, the restaurant and branch names, and the name on the owner's hub tile. Who may receive a temporary owner password is auth and security behaviour. AUTOBUILD puts that explicitly in the Class B exclusion list, so this decision must be Class C (park it for the owner). The chosen questions are also weak:
    - the restaurant and branch names are public;
    - every staff member sees the owner's tile name on the hub;
    - the e-mail is often on invoices or business cards.
    
    AD-29 also says "no call-back rule invented". So nothing ties the caller to a known phone number.
  - **Failure scenario:** a staff member who has left phones support, claims to be the owner and answers all three questions from what they saw at work. Support runs `reset-owner-password` and reads the temporary password aloud. The caller signs in, sets a new password and owns the tenant: staff, roles, PIN resets and the owner lockout. Every one of the real owner's sessions is revoked.
  - **Required fix:**
    - Park this as P-n (task T47) with options, for example: (A) call back on a phone number recorded at onboarding; (B) a shared secret set at onboarding; (C) an in-person or video check.
    - Set T47 to PARKED.
    - Until the owner answers, change the runbook's identity section to say "Identity check: PENDING owner decision (P-n). Do not reset without the owner's agreed check". Keep the three questions only as a minimum, not as enough.
    - Mark AD-29 as superseded by P-n.

- **R-2 (Blocker, T50b / AD-31: a wrong Class B, and a change to another module's approved spec)**: `apps/client/src/features/owner/Shell.tsx:100-120,130-138`, `docs/reviews/01b-auto-decisions.md` (AD-31).
  - **Problem:** 01a v1.3 S50 a (APPROVED) says the owner shell is "a side menu … and, at phone width (≤ 760 px), a bottom tab bar". 01b §8 and §4.4 do not change S50 a. T50b removed the phone tab bar and replaced it with an app-bar Menu button that opens the side nav in an overlay. That is a user-visible behaviour change to 01a's approved spec, made because the design hand-off's frames show it.
    - AUTOBUILD puts "a fix that needs another module's spec to change" in Class C.
    - CLAUDE.md says "If code and spec disagree, STOP and ask" and "Any behaviour change goes spec-first".
    - The plan's "Done when" (render like `StaffPhoneList.html`) points at the design, but the plan ranks below the spec. The conflict had to be parked, not resolved in the plan's favour.
    - The menu, floor and station pages (01a views) are affected too, not only the 01b views.
  - **Failure scenario:** the 01a spec and the client now disagree on the phone shell. A later 01a re-review or T59's Playwright pass, if written from S50 a, fails or "fixes" it back. Any future reader of S50 a gets the wrong picture. On the phone, Sign out, which the tab bar's page reached before, is now two taps behind an overlay that no spec describes.
  - **Required fix:**
    - Park as P-n (task T50b): "01b design shows a Menu button with an overlay nav on phone; 01a S50 a says bottom tab bar". Options: (A) keep the tab bar (8 items plus Sign out at 390 px); (B) Menu button and overlay, with 01a S50 a amended by the human; (C) a tab bar for 4 items plus a "More" item.
    - Restore the S50 a phone tab bar (`TabBar` still exists in `components/SideNav.tsx:68`) until the human answers. The laptop nav changes (groups, counts, foot), which match S50 a's side menu, may stay.
    - Mark AD-31's phone part as superseded by P-n, and set the T51–T56 rows that depend on the phone shell to WAITING only if they need it.

## Should-fix

- **R-3 (Should-fix, T50b)**: `apps/client/src/features/owner/Shell.tsx:104-114`.
  - **Problem:** the phone nav overlay reuses `.pos-overlay`, the dialog backdrop, but none of the dialog behaviour that 01a test 161 requires of the kit's `Dialog`:
    - Escape does not close it;
    - Tab is not trapped, so the page behind stays reachable;
    - focus does not return to the Menu button;
    - it has no `role="dialog"` or `aria-modal`.
    
    `components/Dialog.tsx` already implements all of this. The fix is moot if R-2 is resolved with option A.
  - **Failure scenario:** a keyboard or screen-reader user on a tablet at ≤ 760 px opens the menu. Focus stays on the Menu button behind the overlay, Tab walks the hidden page, and Escape does nothing. The overlay can only be closed by tapping the backdrop.
  - **Required fix:** if the overlay stays (R-2 option B), build it on the existing `Dialog` component, or give it the same Escape, focus-trap and focus-return behaviour. Add a test for each.

## Nits (non-blocking)

- N-1 (T50b): `apps/client/src/features/owner/Shell.test.tsx`. The build log says this test was written after the change (no TDD), and its names cite `[01b §8]` with no test number. The plan gave this Claude-only task no test step, but the hard rule still applies.
- N-2 (T50b): the plan's "Done when" (render like `Main.html` at 1440 and `StaffPhoneList.html` at 390) was not checked. The build log defers it to T59, but the status row says DONE without noting this.
- N-3 (T46): `apps/cloud/test/cli/link-owner-staff.int.test.ts` #99 b says "the CLI holds the tenant lock having verified Y". The hook fires at `apps/cloud/src/cli/link-owner-staff.ts:42`, before the qualification check at `:87`. The outcome is the same because the lock serialises the two writers, but the test does not prove "having verified".
- N-4 (T47): `docs/runbooks/owner-password-reset.md:31,65`. Support pastes caller-supplied text into SQL by hand (`'<email>'`, `'<name on the tile>'`), on a host whose `DATABASE_URL` can write. Use `psql -v` with `:'email'` and `BEGIN READ ONLY`.
- N-5 (T50b): the production code no longer uses `TabBar`; only `kit.test.tsx` does. It is dead code, unless R-2 restores it.

## Checked and fine

- **Spec patch (previous R-1):** v1.0.1 changes only the text of #97, with the change-log line "auto-patch AD-25". The README version cell and AD-25 are updated. No other spec text changed.
- **T43:**
  - #74 c runs (a) and (b) with the reset CLI in-process, on the same clock and on clocks 5 minutes ahead and behind. The reset's `afterOwnerRowLock` is wired to the same pause as the API's.
  - (a): the refresh's access token → `401 JWT_INVALID`, and its successor → `401 REFRESH_TOKEN_INVALID`.
  - (b): the refresh → `401 REFRESH_TOKEN_INVALID`, with 1 token row (none issued).
  - #74 d covers both orders. When the reset goes first, the login → `401 LOGIN_INVALID` with no token row and a counter of 0, so an increment would be caught.
  - #74 e alternates the start order over 50 runs and asserts change → 200, refresh ∈ {200, 401 `REFRESH_TOKEN_INVALID`}, and no `40P01`.
  - Waiting is proven with `pg_stat_activity` lock waiters, which is safe because `fileParallelism: false`.
- **T44:** #98's three cases each run 50 times. Login ‖ login: both 200 and the counter goes 3 → 0. Refresh ‖ refresh with `lock_notice_at` set: exactly one `lockout_notice`, and the notice is cleared. Login ‖ refresh: both 200. Status 200 catches a deadlock even when the 500 body hides the code. The status row records the check with the lock changed to `FOR SHARE`. No change under `src/`.
- **T46:**
  - #95: a re-link X → Y writes exactly one audit row (`actor_kind 'cli'`, old and new `staff_id`, printed `link:` line), and Y then gets `OWN_ADMIN_ACCESS`. A re-link from a row that qualifies nowhere to a no-PIN Cook is refused, so there is no vacuous pass.
  - The no-PIN, `manage-devices` denial, `access-hub-admin` denial and leaver cases are all refused through `expectRefused`, which also checks no audit row and no bump.
  - #99 a and b use real barriers and lock waiters, with the PATCH's `afterTenantLock` test hook. (a) lists all three branches. (b) gives `409 OWN_ADMIN_ACCESS` after the link.
- **T50b (apart from R-2 and R-3):**
  - The laptop nav order, groups and counts follow README §9. The Branches count comes from data the API gave (`allowed.length`), so it respects S50 f.
  - The foot shows `display_name` as S50 a requires, and AD-31's no-e-mail call is correct.
  - Every nav link and Sign out go through the discard guard.
  - AD-30 (label copy) is a correct Class B: §8 fixes no `perm.<key>` text, and no spec-pinned copy changed. "Count stock and switch items off" matches 01a §6.18's `manage-stock` gate on `SetItemAvailability`.
  - The Urdu to-do list shrank to 16 keys, and the i18n test enforces it.
- Scope: no migrations, events, API contracts or error codes touched; no test skipped or weakened; no file outside the tasks.


## 2026-10-28 batch review: fixes R-1, R-2, P-3/P-4 answers and tasks 51–55 (9564df8..20c28d1)

VERDICT: BLOCKERS

# 01b batch review: fixes R-1, R-2, P-3/P-4 answers and tasks 51–55 (9564df8..20c28d1)

Checked against: foundation §6; the 01b spec §3.7, §6.1–§6.12, §8 (views, error mapping, support number Q3), §9, B19, B23, review 2 N4; test #78; the plan's "Done when" for tasks 51–55; AD-29/AD-31 amendments and AD-32; P-3 and P-4 with their answers. I re-ran `pnpm vitest run apps/client/src/features/owner apps/client/src/app`: 27 files, 79 tests, all pass.

There are no Blockers. The verdict is BLOCKERS because of the Should-fix findings below; the first line allows only PASS (zero Blockers and zero Should-fix) or BLOCKERS.

## Should-fix

- **R-1 (Should-fix, T51 / T52)**: `apps/client/src/features/owner/staff/StaffForm.tsx:682`, `apps/client/src/features/owner/roles/RoleList.tsx:133`.
  - **Problem:** the D02 "Mark as left" dialog maps every error other than `CONFIG_STALE` through the generic `errorText`. For `OWN_ADMIN_ACCESS`, `apiErrorKey` returns `errors.OWN_ADMIN_ACCESS` and ignores `details.reason`. So `reason: 'owner_not_linked'` never gets its own §8 text ("Your owner login isn't linked to your staff profile yet … Call support to link it."). `StaffForm`'s main save and `RoleList` use `ownAdminText`; the leave dialog does not. Separately, `LAST_ADMIN_REQUIRED` in the leave dialog and in the role-archive blocked dialog (`RoleList.blockedFor`, falls through to `errorText`) shows the generic sentence with no branch names. §8 says: "`LAST_ADMIN_REQUIRED` → roles field or blocked dialog naming the branches".
  - **Failure scenario:**
    - The owner is not yet linked (`owner_users.staff_id` null). They mark Bilal, the only hub admin at Gulberg, as left. The server answers `409 OWN_ADMIN_ACCESS { reason: 'owner_not_linked' }`. The dialog says "You can't remove your own admin access", which is false (Bilal is not the owner) and hides the real fix, `link-owner-staff`.
    - The owner archives the "Manager" role and gets `LAST_ADMIN_REQUIRED { branch_ids: [B2] }`. The blocked dialog does not say which branch would lose its admin.
  - **Required fix:**
    - In `LeftDialog.confirm`, map `OWN_ADMIN_ACCESS` through `ownAdminText(error.details)`.
    - In `LeftDialog` and `RoleList.blockedFor`, show `LAST_ADMIN_REQUIRED` with the branch names from `details.branch_ids`, as `RoleEditor` already does (`roles.last_admin_body`).
    - Add `[01b §8]` tests for both codes in the leave dialog and the archive dialog.

- **R-2 (Should-fix, T55)**: `apps/client/src/app/support.ts:13`; `apps/client/src/i18n/ur.ts:153,161`.
  - **Problem:** `withSupport` adds the number with an English-only regex (`/Call support(?=\.| to | if )/`). For Urdu texts (`account.forgot`, `branches.behind_body`, and the error texts once they are translated) it never matches. Owner answer Q3 and §8: "set → the number is appended" applies to every support text, whatever the language. The tests cover only English.
  - **Failure scenario:** the build sets `VITE_SUPPORT_PHONE=0300 1234567` and the owner uses the app in Urdu. They forget the password and open `#/account/password`. The caption reads "پاس ورڈ بھول گئے؟ سپورٹ کو فون کریں۔" with no number, which is exactly the case Q3 was answered for.
  - **Required fix:** give each support text a `{support}` placeholder, or a with-phone variant key, in both `en.ts` and `ur.ts`. Fill it from `supportPhone()` instead of rewriting the English sentence. Add the Urdu case to `support.test.ts` and to the ChangePassword caption test (phone set and unset).

- **R-3 (Should-fix, T54 / AD-32)**: `apps/client/src/features/owner/branches/BranchesView.tsx:63-81`.
  - **Problem:** §8 / B19 say every branch shows "Hub checked in {time} ago" **and** "Up to date {time} ago", with the second shown as a warning when `hub_last_seen_at − hub_synced_at > hub_stale_after_ms`. AD-32 adds an "away" state (a display-only call, correctly Class B). But it is checked **first** and replaces both B19 lines. While a hub is away, the page no longer shows how far behind it is or whether the behind warning applies.
  - **Failure scenario:** the Johar Town hub stopped taking config two hours ago (behind) and then lost the internet five minutes ago (away). The owner sees only "Johar Town hub last checked 5 min ago". They assume it is a short outage and do not learn that its config has been stale for two hours. A staff change made since then is not at the branch.
  - **Required fix:** keep the away notice, but still render the "Up to date {time}" line, and its warning when B19's condition holds, for an away hub. Add a `[01b #78]` case where the hub is both away and behind.

- **R-4 (Should-fix, T47 / T50b: parked answers not applied)**: `docs/runbooks/owner-password-reset.md:19,36`, `docs/plans/01b-status.md` (T47, T50b rows), `apps/client/src/features/owner/Shell.tsx:95-100`.
  - **Problem:** 43df423 recorded the human's answers to P-3 (call back the owner's mobile number from the onboarding checklist) and P-4 (option B: Menu button and an overlay nav built on the kit `Dialog`; Change password and Sign out reachable on the phone). Nothing in this batch applies them:
    - The runbook still says "Identity check: PENDING owner decision (P-3) … still do not reset until P-3 is answered".
    - T47 and T50b are still PARKED.
    - The phone shell still has the tab bar with no Change password and no Sign out.
  - **Failure scenario:**
    - An owner calls support after a lock-out. The runbook forbids any reset, so support either refuses a legitimate owner or ignores the runbook, and the call-back check is never written down.
    - On a phone the owner cannot sign out or reach `#/account/password` from the nav, although T55 now ships that view.
  - **Required fix:**
    - Set T47 and T50b back to TODO (answered).
    - Add the P-3 call-back step to the runbook's identity section: call back on the number in the onboarding checklist before any temporary password or owner link; the AD-29 questions are a pre-check only.
    - Build the P-4 B phone nav on `Dialog` (Escape, focus trap, focus return, `role="dialog"`), with tests. Record it under "Design vs spec" in the build log, as the answer says.

## Nits (non-blocking)

- N-1 (T54): `apps/client/src/features/owner/branches/BranchesView.test.tsx:45`. `warned()` matches any `.pos-hub.is-warn`, so it cannot tell the B19 "behind" warning from the AD-32 "away" notice. The #78 threshold case passes only because the clock is frozen exactly at `seen = threshold`. Assert on the `branches.behind` text instead.
- N-2 (T55): `apps/client/src/features/owner/account/ChangePassword.tsx:143`. The support caption is hidden on the forced view (`!forced`). §8 puts the caption on `#/account/password` without that exception, and a forced owner whose temporary password expired is the person who most needs it.
- N-3 (T55): the "Done when" requires `pnpm --filter @pos/client build` with `VITE_SUPPORT_PHONE` set. The build log says it was not run, but the status row says DONE.
- N-4 (T52): the build log says the tests were written first but first run after the views. Red was never observed for the stated reason.
- N-5 (T51–T55): no view state was compared with the handoff screens at 1440 / 390. This is deferred to T59, but every "Done when" lists it.

## Checked and fine

- **Edit forms (B23, review 2 N4):**
  - Staff, role, idle-inline and stock-counting writes send the held `version` as `expected_version`.
  - The PIN dialog hands the response's version back to the form, so a PIN reset never makes the next save stale.
  - `CONFIG_STALE` disables Save and offers Reload. Reload remounts the editor from a fresh read, so nothing of the stale form is kept (the test asserts that).
- **Staff PATCH:** it sends only the changed fields, and each list whole. Leaving is `{ expected_version, is_active: false }`. `STAFF_LINKED_TO_OWNER` shows the §8 text.
- **PIN:** the PIN stays in component state only and is cleared after every request, success or failure. The phone hand-over drops the first PIN once the second is typed. The test checks that the DOM no longer holds the value.
- **Roles:**
  - "Approved by" is a chip multi-select of active roles, and the role itself can be picked.
  - "Where" comes from `PERMISSION_SCOPES`.
  - An approval grant with no approver is refused before sending.
  - Admin-guard snap-back works, and `OWN_ADMIN_ACCESS` uses `ownAdminText`.
- **Stock counting:** the PUT sends the whole active set, and a station with nobody is left out (AD-19). After a save, the held version is replaced with the response's.
- **Teams:** the tree is indented, shows "No PIN" from `has_pin`, each name links to `#/staff/:id`, and it is read-only.
- **Branches:**
  - The threshold comes from the response's `hub_stale_after_ms`; there is no `180000` in `apps/client/src`.
  - Settings check the ranges and stale > gap before sending, and send only the changed fields.
  - AD-32 is a valid Class B (display only, no wire change). Its placement is R-3.
- **Session:**
  - A 503 now goes to the cloud-unreachable state and probe; the probe treats 503 as still down.
  - `PASSWORD_CHANGE_REQUIRED` marks the stored user and redirects. Every view redirects while `must_change_password` is set, with no side nav.
  - The lockout notice is stored from login or refresh, shows `failed_count`, and is cleared on sign-out.
  - `JWT_INVALID` followed by `REFRESH_TOKEN_INVALID` lands on sign-in once.
- **R-1 / R-2 fixes (previous review):** P-3 and P-4 are parked with options, AD-29 and AD-31 are amended, and the S50 a tab bar is restored with a test.
- **Scope:**
  - No server code, migrations, events, API contracts or error codes changed. The `listBranches` client type gains `hub_stale_after_ms`, which the server already sends.
  - No test is skipped or weakened.
  - `App.tsx`, `form.ts` and `cloud-admin.ts` changes are needed by the views (Class A, logged).


## 2026-10-28 batch review: fixes R-1–R-4, P-3/P-4 applied, tasks 56, 57, 58 (919484d..d619dff)

VERDICT: BLOCKERS

# 01b batch review: fixes R-1–R-4, P-3/P-4 applied, tasks 56, 57, 58 (919484d..d619dff)

Checked against: foundation §6; 01b spec §3.8, R5, D-6, B20, §4.4 rows 9–13, §6.16, §7.5, §8, §10.9a #55, #71, #78, #96; 01a v1.3 §6.17, §6.17a, §6.18, §8.2 (the 01b-driven B20 paragraph) and S33; the plan's "Done when" for tasks 56–58; AD-32/AD-31 amendments and AD-33; P-3 and P-4 answers. I re-ran `pnpm vitest run apps/client/src/features/admin/stock apps/client/src/features/owner apps/client/src/app apps/client/src/i18n apps/cloud/test/role-names.test.ts apps/hub/test/auth/renamed-roles.int.test.ts apps/cloud/test/route-inventory.int.test.ts`: 36 files, 133 tests, all pass.

## Blockers

- **R-1 (Blocker, T56 / AD-33 is not Class B)**: `apps/client/src/features/admin/stock/StockApp.tsx:508-516`; `docs/reviews/01b-auto-decisions.md` (AD-33).
  - **Problem:** under `manage_stock_scope: 'my_stations'` with no business day open, the page replaces the whole stock view (rows, `StockTable`, `ActionBar`) with the `StockCounterNotStarted` warn screen. The approved specs say something narrower:
    - 01b §4.4 row 11 / 01a v1.3 §8.2: the page "shows only the rows the stock query returns".
    - 01b §4.4 row 13 / 01a v1.3 §8.2: under `my_stations` the page **hides Start day, Close day and the stale-day prompt**, and a `409 BUSINESS_DAY_NOT_OPEN` shows the sentence.
    - 01a §6.18 `SetItemAvailability` does **not** need an open day. Only §6.17 and §6.17a answer `409 BUSINESS_DAY_NOT_OPEN` (01a §9 table, S33).
  - AD-33 therefore removes behaviour that 01a §8.2 (another module's approved spec, as amended by 01b) grants. A `my_stations` counter can no longer turn an item Off or On while no day is open. AD-33 follows a design screen against the spec text. That is the same pattern as AD-31 / P-4 (design vs 01a S50 a), which the previous review ruled Class C. The build log's "Design vs spec" line lists only the missing names ("like Imran", stations). It does not record that the rows and toggles are hidden.
  - **Failure scenario:** 09:30, the manager has not arrived and no day is open. Usman (Drinks counter, `manage-stock` scope `my_stations`) finds the lassi machine broken and opens `/admin/stock` to mark Lassi Off. He sees only "The day hasn't been started. Ask someone who can start the day." and has no rows and no switch. The hub would have accepted `SetItemAvailability`, so cashiers keep selling Lassi until someone with `branch` scope arrives.
  - **Required fix (either):**
    - (a) Keep the rows under `my_stations` with no day open, with no Start day. Put the warn notice (title + spec sentence) above them, as a banner or callout. Count entry may stay disabled or answer the 409 sentence, but the availability switch must work. Add a `[01b §4.4 row 11]` test: with `my_stations` and no day, a row's Off switch sends `set-item-availability`.
    - (b) Park it as P-n (design hides the rows vs 01a §8.2 / §6.18), restore (a)'s behaviour until it is answered, and amend AD-33 to say so.

## Should-fix

None.

## Nits (non-blocking)

- N-1 (T56): `apps/client/src/i18n/en.ts` `admin_stock.counter.note` says "Starting and closing the day is for the manager." That is role-named copy (R5 spirit, not the #55 literal grep). After a tenant renames "Manager", the text names a role that no longer exists. Say "for someone who can start the day", matching the spec sentence.
- N-2 (T56): `stock-pages.test.tsx` outside_scope fixture sends `{ reason: 'outside_scope', required_scope: 'my_stations' }`. For item commands the hub sends `{ permission, reason: 'outside_scope', item_ids }` (01b §4.4 row 9); `required_scope` is only on day commands and is always `'branch'`. Use the real shape.
- N-3 (T56): with `my_stations` and no day, kept or typed counts (S55 callout, drafts) are hidden behind the warn screen with no hint that they are still held. This goes away with R-1 (a).
- N-4 (T57): #96 and the route inventory passed on the first run. The log says #96 was seen to fail by mutation. That is acceptable for regression guards, but the plan's Step 2 "FAIL for the stated reason" was not observed for the route inventory at all.
- N-5 (R-4 fix): on the phone, `onNavigate` and Sign out close the nav overlay before `leave()` runs the discard guard. If the owner cancels the discard prompt, the nav is gone and they must reopen it. This is cosmetic.

## Checked and fine

- **R-1 fix (leave and archive dialogs):**
  - `OWN_ADMIN_ACCESS` goes through `ownAdminText(details)`.
  - `LAST_ADMIN_REQUIRED` names the branches from `details.branch_ids` via `useBranchName`, with the generic text as detail.
  - Tests cover both codes in both dialogs. The leave test also asserts that the generic text is absent.
- **R-2 fix (support number):**
  - `{support}` placeholder in every support text in `en.ts` and `ur.ts`. `supportText` fills it from `support.on` in the text's own language and falls back to English when there is no Urdu.
  - Every `{support}` key is rendered only through `supportText`. There is no other `t()` path, `errorKey` is used only in `form.ts`, and grep finds no raw `{support}` leak.
  - Urdu set and unset cases are tested. `admin_stock.problem.unauthorized` ("Call support.") is an 01a hub-page key, outside Q3's owner views.
- **R-3 fix (away hub):** the away notice now sits above B19's line. For an away hub that is not behind, the line shows "Up to date {time}"; when it is also behind, it shows the behind warning. `pending` still wins. The #78 case covers away only and away plus behind, asserting on the text, not the class.
- **R-4 fix:**
  - The runbook has the P-3 call-back: checklist number only, stop on no answer, written in the ticket without the password. The AD-29 questions are a pre-check only.
  - Phone nav per P-4 B: a Menu button in the app bar, and the side nav inside the kit `Dialog` (`role="dialog"`, `aria-modal`, Escape, Tab trap, focus return to Menu, all tested). Change password and Sign out are in the foot, and an item click closes the overlay and navigates.
  - The tab bar is removed under the human's answer. T47 and T50b are DONE, and P-3 and P-4 are marked RESOLVED.
- **T56, other parts:**
  - `manage_stock_scope` is read from the stock query, with no client filtering.
  - Close day and the stale prompt are hidden under `my_stations` with a day open. A 409 on save or Add shows the spec sentence, has no Start day retry and keeps the typed value.
  - `403 outside_scope` shows its text and refreshes.
  - Branch-scope behaviour is unchanged: the fixture only gains `manage_stock_scope: 'branch'`, and the existing tests pass.
- **T57:**
  - #55 has the exact §10.9a scope: `apps/*/src` (`.ts`, `.tsx`, `.sql`) and `packages/*/src` (`.ts`, `.tsx`), test files excluded, the six names in single or double quotes, case-sensitive, and only the three allowed files.
  - The regex is shown to hit planted lines and each allowed file. The T51 client fixture hit was fixed by renaming the fixture roles (Class A, tests only).
  - #96 compares `permissionsOf` (every permission), `ttlFor`, `adminPermissions`, `hasAdmin`, `/queries/session` minus `role_names`, roster membership and TestNoop outcomes in all four grant classes across two hubs.
  - The route list matches §6.16's 14 routes exactly. All 14 are `tenantScope: 'jwt'` and present in `ROUTE_CASES`.
- **T58:** the Progress table lists tasks 0–58 with commits, and the build log has entries for 1–57. README status reads "Implemented, pending page flows and release drill". T59–T60 are WAITING for the human, per the plan's STOP. T61 stays PARKED (P-2).
- **Scope:** no server code, migration, event, upcaster, API contract or error code changed in this batch. No test is skipped or weakened. The test edits in T57 only rename fixture role names.

## 2026-10-28 hostile review: fix R-1 for T56 / AD-33 (da0233f only)

VERDICT: CLEAN

# 01b review: commit da0233f (fix R-1, T56, AD-33 amendment)

Checked against: 01b spec v1.0.1 §4.4 rows 11 and 13, D-6; 01a v1.3 §6.17, §6.17a, §6.18, §8.2, S33; review `01b-autoreview-latest.md` R-1 (required fix (a)) and N-1–N-5; AD-33 and its amendment. I re-ran `pnpm vitest run apps/client/src/features/admin/stock`: 5 files, 35 tests, all pass. `tsc --noEmit` (client) and eslint on `features/admin/stock` are clean. Code was read only.

## Blockers

None.

## Should-fix

None.

## Nits (non-blocking)

- N-6 (da0233f): under `my_stations` with no day open, a refused save or Add sets `message` to `notStarted()`, so the page shows two identical warn banners: the standing no-day banner (`StockApp.tsx:516`) and the 409 message banner. Skip the message when `counter && noDay` already shows it, or leave as is.
- N-7 (da0233f): the no-day tests use `business_day: null` only. `noDay` also covers a closed day (`business_day.closed_at !== null`, `business_day_started_at: null`, S33), which is the more common 09:30 case after last night's close. One extra remount with a closed day under `my_stations` would pin the banner, the rows and the absence of Start day there too.
- N-8 (da0233f): the handoff `docs/design/handoff/01b/README.md:190` and `screens/index.html:116` still list `StockCounterNotStarted` as a full-screen state. The handoff is input and is not edited here; the AD-33 amendment records the drop. The design inventory should say "superseded by the banner" so the next reader doesn't rebuild it.
- Carried, still open: N-1 (role-named "for the manager" in `admin_stock.counter.note`), N-2 (outside_scope fixture shape), N-4, N-5. N-3 is gone: the rows and action bar are no longer hidden, and with no open day there is no draft key, so no kept counts exist to hide.

## Checked and fine

- **R-1 fix (a), as required:**
  - The full-screen `pos-screen--warn` branch is removed. `main.pos-content`, `StockTable` and `ActionBar` render for every scope.
  - Under `my_stations` with no day, a warn `Banner` carries the spec sentence ("The day hasn't been started. Ask someone who can start the day."), which holds both the title and the 01b §4.4 row 13 sentence.
  - Start day is hidden for a counter in both places: the rows-level `StartDay` now has `!counter`. The `retry` `StartDay` cannot appear, because `blocked` is set only on the branch-scope path (`StockApp.tsx:303-304, 350-351`). Close day (`:497`) and the stale prompt (`:535`) keep their `!counter` guards.
  - The Selling switch works with no day. The new `[01b §4.4 row 11]` test taps I1's switch and asserts one `set-item-availability` with `{ item_id: 'I1', is_available: false }`. That matches 01a §6.18, which needs no open day.
  - Count save and Add with no day still go to the hub and come back with the 409 sentence, with counts kept (the existing #71 test). The review allowed either that or disabled entry.
- **Branch scope unchanged:** the same no-day answer without `my_stations` still shows `[data-start-day="rows"]`. The stale and Close day assertions are untouched. The diff is a re-indent of the old non-warn branch plus the two guards.
- **Tests:** the #71 page test gains a row assertion and no assertion is removed or weakened. The log says the new test failed first with no rows.
- **i18n:** `not_started_title` and `not_started_body` are removed from `en.ts` and `urdu-todo.md` (183 → 181). Neither key was in `ur.ts`, and grep finds no other use. `admin_stock.counter.not_started` stays.
- **AD-33 amendment:** Class A is right. The behaviour now follows the approved spec text, so there is no design call left to park. The amendment names the dropped layout and keys.
- **Commit:** one task, cites `[spec §4.4 rows 11, 13; 01a §6.18]`. Build log entry present. No server code, migration, API contract or error code touched.
