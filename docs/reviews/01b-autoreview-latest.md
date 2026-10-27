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
