APPROVE

# 01a auto review: batch 04 (tasks 14–16)

Reviewer: independent, fresh session. Commits reviewed: `0a633c4` (task 14), `161df82` (task 15), `e372f85` (task 16), against `docs/plans/01a-plan.md` tasks 14–16, spec v1.0 §5.2, S7, S8, S26, S32–S34, S44–S47, §10 #8–#14, #84, #122, and decisions D1–D3.

## Verification run

- `pnpm test` (working tree, which still holds task 17's uncommitted files): **89 files, 320 tests, all passed** (57.7 s). One green run; I did not see the flaky failure mentioned in the batch report.
- `pnpm lint`: **1 error**. It is `apps/cloud/test/helpers/restaurant.ts:3` (M56 `no-restricted-imports`), an **uncommitted task 17 file**, and it is outside this batch. D2 already resolves it.
- `eslint` on every file this batch committed: clean. `tsc --noEmit` in `apps/cloud`: clean.
- I did not re-run the committed tree without the task 17 files. The batch report's 88 files / 319 tests is consistent with the 89 / 320 above minus `pg-counter.int.test.ts`.

## What was checked

- **Task 14, migration:** `0002_restaurant_setup.sql` is byte-identical to spec §5.2 lines 387–540 (`sed -n '387,540p' … | diff -` gave no output). It has no `business_day_start_ms` and no `config_epoch`, and it includes `branches_day_settings`, `menu_items_name_order` and `availability_windows`.
  - `restaurant-schema.int.test.ts:70` (#84) covers the trigger on both UPDATE and DELETE. Its `pg_index` query checks every new table, including the primary keys, and `:93` requires all 11 tables to have at least one index.
  - The §5.2, S44, S47 and S33 cases are at `:99`, `:113`, `:121` and `:141`. Each pairs the rejection with a positive control: a null tax class, g/piece/250, a wrapping window, and the defaults.
  - The D1 edit to `schema.int.test.ts` matches D1 exactly and is recorded in the commit message.
- **Task 15, idempotency:**
  - The key check runs inside `withIdempotency` (`idempotency.ts:55`), with the `headers.idempotency-key` issue path in the same shape as `error-handler.ts:18`.
  - The hash is `canonicalJson({method, path, body})` over the filled path (`:60`). The key insert is the first statement in the transaction (`:71`), and the response is stored before COMMIT (`:91`).
  - On replay or mismatch the transaction rolls back (`:88`, `:104`), and the 422 is returned with `{ idempotency_key }`.
  - The prune runs after COMMIT as its own statement, using the exact S7 SQL (`:110`). Its failure is logged at `error` and swallowed (`:115`). `sendIdempotent` sends `{ data }` plus `Idempotent-Replay: true` (`:123`).
  - Tests #9–#14 and #122 each appear exactly once, and each would fail without the code.
  - #12 forces real overlap: it waits until `pg_stat_activity` shows the first request idle in its transaction and the second blocked on a lock.
  - #14 checks the 100-row cap and the exact 24 h boundary (`'edge'`), and leaves the other tenant's rows untouched. #122 proves the prune runs after COMMIT (the hook sees the committed floor and the 3 old keys) and that a failed prune still returns 201 with one level-50 log line.
  - The `testHooks` field on `ctx` and the `INSERT … SELECT FROM tenants` form are reasonable rulings. The plan's text needs the hook, and `TenantLevelRepository` requires `tenant_id = $1`.
- **Task 16, version bump and audit:**
  - Branch scope is a single `UPDATE … RETURNING`. Tenant scope locks the branch rows with `SELECT … ORDER BY branch_id FOR UPDATE` before the `UPDATE` (`config-version.ts:24`), which is S8's lock order.
  - Neither module imports `SystemContext` or the db client. The owner-row check (403 `tenant_wide_write`) is correctly left for task 33.
  - `writeConfigAudit` takes `audit_id` from `ids.next()` and `at` from `clock.branchNow()`, and stores `null` user for the CLI actor.
  - The tests cover #8 (10 concurrent bumps, +10, with contiguous returned versions), the tenant scope (tenant B unchanged), both actor kinds, and `auditActionFor`.
- **Foundation §6 standards:**
  - Envelopes and catalogue codes are respected: `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_MISMATCH`, `CONFIG_NAME_TAKEN`.
  - SQL uses snake_case and `*_at` values in ms.
  - No `Date.now()`, `Math.random()` or `ulid()` appears in `src`.
  - Every query in `src` goes through `TenantLevelRepository` (`tenant_id = $1`).
- **Scope:**
  - The batch changed only the task files plus `docs/plans/01a-plan.md` progress and `docs/reviews/build-log.md`.
  - No `package.json`, lockfile or `eslint.config.js` changed, so there are no new dependencies.
  - `truncateAll` is dynamic (`pg_tables`), so the new tables are cleaned between tests.
- **Security:**
  - All SQL is tenant-scoped, and idempotency rows are keyed `(tenant_id, idempotency_key)`, so a key cannot replay across tenants.
  - The prune log carries only the error. No snapshot, PIN hash or secret is logged.
  - This batch has no client code.

## Blocker

None.

## Should-fix

None.

## Nit

1. **`apps/cloud/src/lib/idempotency.ts:85`, `stored[0]!`:** the code assumes that a conflicting INSERT always finds a row on the follow-up SELECT.
   - **Failure scenario:** a client reuses a key more than 24 h old that has not been pruned yet. The INSERT conflicts and does nothing. A concurrent create for the same tenant then prunes that row before the SELECT runs, so `row` is `undefined` and the request ends in `500 INTERNAL_ERROR`. The same thing happens if the `tenants` row is missing, because the `INSERT … SELECT FROM tenants` then returns 0 rows.
   - **Fix:** when `stored.length === 0`, retry the INSERT once in the same transaction. If it still finds nothing, throw an explicit invariant error rather than a `TypeError`.
2. **`apps/cloud/src/lib/config-version.ts:17-22`:** the branch-scope bump returns `[]` silently when no row matches.
   - **Failure scenario:** a later route passes a branch id that is not the tenant's, or one already rejected on another path. The config write then commits with no version bump, and the hub never downloads it.
   - **Fix:** throw `DomainError('BRANCH_NOT_FOUND', { branch_id })` (or an invariant error) when `rows.length === 0` in branch scope.
3. **`apps/cloud/src/lib/config-audit.ts:29-32`:** `INSERT … SELECT FROM tenants` writes 0 rows without any error if the tenant row is absent, so the audit is silently skipped. S26 says every write inserts one row.
   - **Fix:** add `RETURNING audit_id` and throw if the result length is not 1.
4. **`apps/cloud/src/lib/idempotency.ts:118` and `:38`:** `client.release()` never passes the error.
   - **Failure scenario:** if `ROLLBACK` itself fails (for example, the connection dropped), the broken client goes back to the pool and the next request fails on it.
   - **Fix:** track the rollback failure and call `client.release(err)` in that case, in both `withIdempotency` and `inTransaction`.
5. **`apps/cloud/test/lib/idempotency.int.test.ts:210`, #122 "two concurrent creates both commit (no deadlock)":** the two injected requests are not forced to hold their key rows at the same time, so the test would likely still pass if the prune were moved back inside the transaction.
   - **Fix:** gate both `fn` calls on a shared barrier, as the `fnGate` in #12 does, so that both transactions are open when old keys exist before either commits.
