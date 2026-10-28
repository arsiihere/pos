# 01a auto build: batch 04

Plan `docs/plans/01a-plan.md`, spec `docs/specs/01_Restaurant_Setup_Spec_v1.0.md`. Decision D1 (`decisions.md`) applied to task 14.

## Tasks committed since the batch 03 report

| Task | Commit | Result |
|---|---|---|
| 14 Cloud migration `0002_restaurant_setup.sql` | `0a633c4` | done (progress `45bad9c`) |
| 15 Cloud `withIdempotency` | `161df82` | done (progress `de57b55`) |
| 16 Cloud `bumpConfigVersion` and `writeConfigAudit` | `e372f85` | done (progress `45d08ba`) |
| 17 Cloud test infrastructure | not committed | STOP: needs `eslint.config.js` (see below and `.auto/STOP`) |

## Test count

- Before (committed tree at the batch 03 report): 85 files, 303 tests.
- After (committed tree): 88 files, 319 tests, all passing.
- With the uncommitted task 17 files: 89 files, 320 tests, all passing; `pnpm lint` has 1 error (below).

## Notes per task

- **14:** I kept the untracked files from batch 03 after checking them: the migration is still spec §5.2 lines 387–540 byte for byte (`cmp`). Under D1, `apps/cloud/test/schema.int.test.ts` `[00 §5.2]` now checks each 0001 table with `toContain`, and the `idempotency_keys` absent clause is gone. The test name and tag are unchanged, and the commit message says so.
- **15:** Tests `#9`–`#14` and `#122`. In `#12` the two requests really overlap: the first waits inside `fn` until `pg_stat_activity` shows the second backend waiting on a lock. Rulings for the reviewer:
  - `ctx` gains an optional `testHooks?: { beforePrune?() }`. The plan's text calls `testHooks?.beforePrune?.()`, but its interface gives `ctx` no way to carry the hook.
  - The key insert is written `INSERT … SELECT … FROM tenants WHERE tenant_id = $1`. A plain `VALUES` insert fails `TenantLevelRepository`'s `tenant_id = $1` check, and the plan says to query through that repository.
  - `route` stores `METHOD path`.
  - The stored body is the `data` payload, and `sendIdempotent` wraps it as `{ data }`.
- **16:** Tests `#8` (10 concurrent bumps → +10), `S8` tenant scope (3 branches, tenant B untouched), `S26` audit rows (owner and cli), and `auditActionFor`. The audit insert uses the same `INSERT … SELECT FROM tenants` form. `coversEveryBranch` is left for task 27, as the plan says.

## Anything odd

- **Task 17 blocker.** The plan has `test/helpers/restaurant.ts` call `seedTenant` and `issueRegistrationCode`, and both need a `SystemContext`. Lint rule M56 allows that import only in `apps/cloud/src/cli/**` and `**/*.test.ts`, so the helper fails `pnpm lint`. Recommended decision: let task 17 add `apps/cloud/test/helpers/**/*.ts` to the `**/*.test.ts` override block in `eslint.config.js`. All task 17 files are left in the working tree: new `pg-counter.ts`, `pg-counter.int.test.ts` and `restaurant.ts`; modified `test-cloud.ts`, `src/server.ts` and `cross-tenant.int.test.ts`.
- **Flaky suite run.** One `pnpm test` run during task 14 had 1 failure, and I didn't capture its name. The next five full runs were all green. Batch 02 saw the same thing at task 12. It may be a timing-sensitive hub test under load (older logs name `#63`).
- `.claude/settings.local.json.bak` (untracked) is still untouched.
