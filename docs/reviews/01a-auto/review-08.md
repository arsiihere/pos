APPROVE

# 01a auto review — batch 08 (tasks 32–36)

Reviewer: independent, read-only. Commits: `65ff15e` (32), `c89db91` (33), `f8141fe` (34), `c52a21c` (35), `dc29dd8` (36).
Sources: plan `docs/plans/01a-plan.md:717-756`; spec `01_Restaurant_Setup_Spec_v1.0.md` S8 (l.102), S26 (l.120), S33 (l.127), S34 (l.128), S42 (l.136), §6.7 (l.607), §6.7a (l.611), §6.14 (l.650), §6.16 (l.664), §10 #39, #82, #86, #87, #105, #108, #117, #123, #153, #154.

## Verification run by the reviewer

- `pnpm test`: **106 test files passed (106), 403 tests passed (403)**, 113.8 s, exit 0. These match the batch report.
- `pnpm lint` (`eslint .`): no errors or warnings.

## Per task

**Task 32: route PUT (§6.16, S26).** `service.ts:929-975`. The item is locked `FOR UPDATE` (404 `MENU_ITEM_NOT_FOUND`), then the route row `FOR UPDATE` (`repository.ts:670-677`), then §3.3 checks through `assertRoutes` (station and programs `FOR SHARE`), then upsert or delete, one `item_route` audit row (`route_set` / `route_removed`, `after: null` on removal), and a bump of that branch only. This is the S8 order: target, references, branch last. The response is `200 { data: { route | null } }` (`schemas.ts` `ItemRouteResponse`). No `Idempotency-Key` is used, which is correct for a PUT. `assertBranchAllowed` gives `404 BRANCH_NOT_FOUND`, and the item lock goes through `TenantLevelRepository`, so the tenant is scoped by `tenant_id = $1`. The upsert inserts through `branches … WHERE branch_id = ANY($2)`, so a foreign branch cannot get a row (D54). Test #39 (`routes-put.int.test.ts:66`) checks the same state twice, one bump each, removal, and that the item drops out of the branch snapshot, plus the §6.14 error matrix with nothing written. Test #82 (`:120`) checks the exact audit rows. The `cross-tenant.int.test.ts` `ROUTE_CASES` entry and the foreign-item probe are added. Both tests would fail without the route (404 `ROUTE_NOT_FOUND`).

**Task 33: tenant-wide guard (S8 v1.0, D30).** `config-version.ts:26-39`. Three statements in the §6.14 order: the owner row (`owner_users`, read at write time, not the JWT), the branch lock `ORDER BY branch_id FOR UPDATE`, then the update. A missing branch, or no owner row, gives `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`. The error is thrown inside the transaction, so the key, the audit row and the write all roll back. All six tenant-wide callers pass `req.ownerUserId` (`service.ts:589, 636, 686, 740, 852, 914`). CLIs pass `null`. Tests:
- #117 (`tenant-wide.int.test.ts:83`): the owner row is limited by SQL while the token still lists A–C, so this would fail without the DB read.
- #153 (`:104`): a real `issueRegistrationCode` run, then the old token, then the row lacks D. It also checks `can_edit_tenant`.
- `[01a S8] the 403 writes nothing` (`:131`): includes a key retry after the fix, which gets a fresh `201` and is not a replay.
- The lib-level test is at `config-version.int.test.ts:97`.

The TDD order slip the author disclosed (stash and re-run) does not affect the committed result.

**Task 34: lock-order races (S8, §5.2).** The only production change is four test-hook call sites (`service.ts:401, 520, 823, 954`), typed in `server.ts:35-36`. Test #86 (`races.int.test.ts:104`) and #87 (`:141`) run both orders with a real `pg_stat_activity` lock-wait barrier. They check the exact 409 `CONFIG_IN_USE` / 422 `CONFIG_REFERENCE_INVALID` details, check for no active route on an archived station or program, and run two concurrent item creates that both get 201 and bump the branch twice. A deadlock would give 40P01 → 500 and fail the status assertions. The in-use checks take no row locks (`repository.ts` lock list), so the PUT's route `FOR UPDATE` cannot cross a station archive. `apps/cloud/vitest.config.ts:6` sets `fileParallelism: false`, so the database-wide lock-wait poll cannot be satisfied by another file.

**Task 35: `set-branch-settings` (§6.7, S33, S34, S26).** `cli/set-branch-settings.ts:19-55`. It runs `SystemContext` `sys.tx`, then the branch row `FOR UPDATE`, merges, checks ranges (1…72 and 0…24, whole numbers) and stale > gap on the merged values, updates, writes a `branch_settings` / `update` audit row with `actor_kind 'cli'`, and bumps branch scope only. Options are strict, and `--business-day-start` is a usage error (`:66-72`). Tests #105, #108, #154 and the merge test match §10. Each refused case asserts that nothing was written (`everything()`). The package script is added as planned.

**Task 36: `restore-bump` (§6.7a, S42).** `cli/restore-bump.ts:11-46`. It locks the tenant row (unknown tenant → exit 1), reads the old branch versions `FOR UPDATE`, then runs both `GREATEST(… + 1, $now)` updates with `RETURNING`. It writes no audit row and prints old → new. Test #123 (cloud part) covers ≥ now and > old, other tenants untouched, no audit row, a second run (+1) and a later clock (→ new now), unknown tenant or bad usage leaving nothing written, and the M56 lint check through `ESLint.lintText`. `eslint` comes from the root devDependencies, as `packages/engine/src/lint.test.ts` does, so no new dependency is added.

**Scope and security.** Each commit touches only its task's Files list (`git show --stat`). No dependency is added. No secrets, PIN hashes or keys are logged or printed: the CLIs print only ids, settings and version numbers. No client code is in this batch. Tenant scoping is as described above. The CLIs use `SystemContext` only under `src/cli/`, as M56 requires.

## Blocker

None.

## Should-fix

None.

## Nit

1. **`apps/cloud/src/modules/restaurant/service.ts:955`: `route =await upsertItemRoute(…)`** is missing a space, from task 34's edit. Lint does not catch it because there is no formatter in `pnpm lint`. Fix: `route = await …`.
2. **`service.ts:956-972`: `PUT { station_id: null }` with no existing route** still writes a `route_removed` audit row with `before: null, after: null` and bumps the branch, so every hub re-downloads an unchanged snapshot, and the audit trail records a removal of nothing. The spec does not settle this (§6.16, S26), and the author ruled on it (batch item 3). Fix, if the owner prefers: return `{ route: null }` with no audit row and no bump when `before === null`, and say so in the spec's next version, since #39's "one bump each" covers only set-PUTs.
3. **`apps/cloud/src/lib/config-version.ts:28-36`: the owner row is read before the branch lock**, without a lock. If `issue-registration-code` commits a new branch D, and appends D to the owner row, between those two statements, `locked` includes D and `allowed` does not. The tenant-wide write then gets a false `403 tenant_wide_write`. The failure is safe and very rare. Fix: either note it in a comment, or swap the first two statements (lock the branches first, then read the owner row), so the owner read sees any branch the lock saw. Both keep S8's three statements.
4. **`apps/cloud/src/cli/set-branch-settings.ts:66-75`: a repeated option is last-wins.** `--branch A … --branch B` silently changes B. Fix: throw `duplicate option ${name}` when `values.has(name)`.
5. **`apps/cloud/test/restaurant/races.int.test.ts:50-61`: the barrier counts any lock waiter in the database**, not request 2's backend. It is safe today because files run serially, but it would turn into a false pass if `fileParallelism` were enabled. Fix: also filter on `query ILIKE '%FOR SHARE%'`, or note the dependency on `fileParallelism: false` in a comment.
