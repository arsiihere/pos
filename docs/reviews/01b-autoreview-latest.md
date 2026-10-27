VERDICT: BLOCKERS

# 01b batch review: tasks 7, 8, 11, 35, 48 (2026-10-27)

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
