CHANGES NEEDED

# 01a auto review: batch 05 (tasks 17–21)

Reviewer: an independent session. I read the plan sections for tasks 17–21, spec v1.0 §3.3, §4.3, §6 intro, §6.0–6.4 and §10 (#1–6, #16–19, #23, #80, #83, #85, #114), and `git show` for `803a621`, `2e15f6e`, `35c9760`, `f5bf426` and `d5b2dd3`.

## Verification (run in this session)

- `pnpm test`: **92 files, 342 tests, all passed** (71.3 s). This matches the batch report.
- `pnpm lint` (`eslint .`): clean, no output.
- Files changed: each commit touches only its task's Files list. The one exception is `eslint.config.js` in task 17, which owner decision D2 allows and the commit message records. No `package.json` or lockfile changes, so no new dependencies.
- Determinism: no `Date.now`, `Math.random`, `ulid()` or `randomUUID` in the new `src/` code. Ids come from `deps.ids` and times from `deps.clock.branchNow()`.

## What checks out (evidence)

- **Task 17.** `CloudTestHooks` and `CloudDeps.testHooks` are in `apps/cloud/src/server.ts:31-46`, and `createTestCloud` passes them through (`test/helpers/test-cloud.ts:49`). `pgCounter` wraps `client.query` once per pooled client on `acquire`, and it skips `BEGIN`/`COMMIT`/`ROLLBACK`, including `BEGIN ISOLATION LEVEL …` (`pg-counter.ts:3,10-19`). Its test covers `pool.query`, connected clients, transaction control and `reset()`. `ROUTE_CASES` is keyed `"METHOD /url"`, and the test asserts that the keys equal the jwt/branch-key route inventory (`cross-tenant.int.test.ts:95`). A tenant B `config_audit` row and its `audit_id` are in `bIds` (R26).
- **Task 18.**
  - The path branch is checked against `tenant.branchIds` before any SQL, giving `404 BRANCH_NOT_FOUND` with no details (`service.ts:39-41`).
  - The floor insert is `INSERT … SELECT FROM branches` through `TenantScopedRepository` (`repository.ts:44-56`).
  - A `23505` on `floors_active_name` becomes `409 CONFIG_NAME_TAKEN { entity, name }` (`service.ts:166-176`).
  - Names are trimmed by Zod and limited to 1–60 characters (`schemas.ts:4`).
  - Audit then bump run in the `withIdempotency` transaction. `after` is the response's floor and the actor is the JWT `sub` (`routes.ts:57-70`, `service.ts:84-100`).
  - The list uses 2 statements, asserted with `pgCounter` from `handlerStart` (#16).
  - #17, #23, #80, Review Focus 1 and the S8 bump test each exist once and test the stated case.
- **Task 19.** The PATCH order is `FOR UPDATE` lock → merged row → in-use check on active tables → write → audit (`auditActionFor` gives update, archive or restore) → `beforeBump` → bump (`service.ts:115-152`). `CONFIG_IN_USE { entity:'floor', id, used_by:{ entity:'table', ids } }` matches §6.4. Restore reuses the active-name index, so uniqueness is checked. #18 and #19 (including another branch's floor) and both §6.4 tests exist. #83 covers a replay (one audit row), a 409 (no audit row, no key) and a forced `beforeBump` failure on both POST and PATCH (no row, no write, no key).
- **Task 20.** Exactly 7 statements, asserted equal for 10 and 300 items (#5). Floors, tables, categories and items are active rows only. Stations, programs and tax classes keep archived rows with `is_archived` (S22). Item routes come only from this branch. Windows are ordered by `start_ms, end_ms, window_id` (`builder.ts:92`), and the S47 test seeds ids in the opposite order. `price_minor` gets `Number()`, the result goes through `BranchConfigSnapshotSchemaV1.parse` with no coercion, and the builder returns `JSON.parse(JSON.stringify(...))` as the wire object (S27). #4 checks the whole object for branch A, plus branch B's isolation. #85 checks hub-style hash parity, and its BIGINT-string clause also fails at the builder if the `Number()` is removed.
- **Task 21.**
  - Everything after the guard runs in `inTransaction(..., { isolation: 'REPEATABLE READ', readOnly: true })`, statement (1) included (`config-sync/service.ts:27-66`).
  - The 304 path is exactly 1 statement (#1, `body === ''`).
  - `snapshot_hash = sha256hex(canonicalJson(wire))`, and the response sends `wire`.
  - The response schema's `snapshot` is `z.record(z.string(), z.unknown())` (`packages/events/src/config.ts:117-127`).
  - The query is `z.coerce` int ≥ 0, with a 400 test.
  - #2 includes the "ahead" version, #3 compares against `loadDirectory`, and #6 covers unknown and revoked keys.
  - The new route is added to `ROUTE_CASES`.
- **Security.** No new log calls. Request logs redact `authorization` (seen in the test output). The directory (PIN hashes) goes only into the branch-key response body, as in module 00. Batch 05 has no client code.

## Blocker

None.

## Should-fix

1. **`apps/cloud/src/modules/config-sync/builder.ts:86-93`: the window statement reads the branch-level table `item_routes` through `TenantLevelRepository` with `branch_id = $2`, which breaks D54 and the plan's Cloud SQL rule.** That rule lists the tenant-level tables a `TenantLevelRepository` may touch, and `item_routes` is not one of them. The subquery is filtered only by `tenant_id` and the raw branch id passed in. The other six statements also require `branch_id = ANY($2)` (the caller's allowed branches).
   - **Failure scenario:** a later caller passes a branch id that is not in `tenant.branchIds`, for example an owner-side preview or the gzip and hub-poll work in tasks 22 and 39 that reuses `buildSnapshot`. The scoped statements then return nothing, but this statement still returns item windows for that branch's routed items. The result is a snapshot whose content does not come from one consistently scoped view. The D54 guard (`TenantScopedRepository`'s `$1`/`$2` check) is also bypassed for a branch table, and the cross-tenant tests will not catch it. Today the branch-key guard always supplies `branchIds = [branchId]`, so there is no live leak.
   - **Fix:** run it through `scoped.query` with the full predicate, keeping the same statement count and ordering:
     ```sql
     SELECT w.item_id, w.category_id, w.start_ms, w.end_ms FROM availability_windows w
      WHERE w.tenant_id = $1
        AND (w.category_id IS NOT NULL
             OR w.item_id IN (SELECT item_id FROM item_routes
                               WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3))
      ORDER BY w.start_ms, w.end_ms, w.window_id
     ```
     Pass `[branchId]`. #4, #5 and the S47 test stay green, and #5 still counts 7.

## Nit

1. **`apps/cloud/test/config-sync/sync-config.int.test.ts:120`:** `sha256hex(canonicalJson(JSON.parse(JSON.stringify(wire))))` equals `sha256hex(canonicalJson(wire))` by construction, so this line tests nothing. Also, the "optional field undefined on one item" case is shown on a hand-made object, not a cloud snapshot. **Fix:** drop the tautology. Leave a comment that the "hub applies it" clause lands with tasks 39–40 under a `[01a §10 #114 hub part]`-style name, so #114 still has one owner.
2. **`apps/cloud/src/modules/config-sync/builder.ts:64` (station order):** §4.3 names only tax classes and programs as "by name, then id". `stations` has no `sort_order`, and the builder sorts stations by name. Hash parity is unaffected, but this is a spec gap the code decided alone. **Fix:** record the rule in `docs/reviews/01a-auto/parked.md` (or as an owner decision) so the spec's next version states it, and keep the code as it is until then.
3. **`apps/cloud/src/modules/restaurant/service.ts:122-152`:** a PATCH that changes nothing, such as `{ archived: true }` on an archived floor or the same name, still writes an `update` audit row with `before == after` and bumps `config_version`. Every hub then refetches a snapshot that has not changed. The spec doesn't forbid this. **Fix (optional):** if the merged row equals `before`, return `{ floor: before }` without the write, audit or bump. Alternatively, record the current behaviour as intended in the build log.
4. **`apps/cloud/test/cross-tenant.int.test.ts:98`:** the loop asserts only `< 500` and that no tenant B id appears. For the branch-path owner routes it would also pass if the request failed with a `400` before the guard. **Fix:** for routes whose path contains `:branch_id`, also assert `404` with `error.code === 'BRANCH_NOT_FOUND'`.
5. **`apps/cloud/test/helpers/pg-counter.ts:10`:** each `pgCounter(pool)` call adds an `acquire` listener that is never removed, and a second counter on the same pool wraps `client.query` again. This is harmless today, with one counter per pool per file, but it is a trap for later tasks. **Fix:** return a `dispose()` that removes the listener, or keep one counter per pool in a `WeakMap`.
