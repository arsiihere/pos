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
