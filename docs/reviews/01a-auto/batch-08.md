# 01a auto batch 08

Plan: `docs/plans/01a-plan.md`, spec `docs/specs/01_Restaurant_Setup_Spec_v1.0.md`. I read the decisions file (D1–D3). No D3 change was needed this batch: every file touched is in its task's Files list.

## Tasks committed since the last batch report (`c3f5884`)

The only commit between `c3f5884` and this session is `320bcee` (review 07, docs). The list below is every `feat(01a): task` commit after the batch 07 report.

| Task | Commit | Progress commit | Tests added |
|---|---|---|---|
| 32 Cloud route PUT | `65ff15e` | `097f8f5` | `#39`, `#82` |
| 33 Cloud tenant-wide write guard from the database | `c89db91` | `1b6e9cf` | `#117`, `#153`, `[01a S8]` the 403 writes nothing, `[01a S8]` tenant scope reads the owner row (lib level) |
| 34 Cloud lock-order races | `f8141fe` | `5dbaa79` | `#86`, `#87` |
| 35 Cloud CLI `set-branch-settings` | `c52a21c` | `4906ff4` | `#105`, `#108`, `#154`, `[01a §6.7]` setBranchSettings returns the merged settings |
| 36 Cloud CLI `restore-bump` | `dc29dd8` | `9f15996` | `#123` (cloud part) |

Each task's new tests failed first, for the reason the task gives:
- Task 32: the route is missing (`404 ROUTE_NOT_FOUND`), and the `ROUTE_CASES` key list is one short.
- Task 33: the tenant-wide writes still return `201` / `200`, and the bump resolves instead of rejecting.
- Task 34: the lock hook is never reached. The test fails after 2 s instead of hanging.
- Tasks 35 and 36: the CLI module is missing.

After that, `pnpm test`, `pnpm lint` and `pnpm typecheck` were green before each commit. `ROUTE_CASES` gains `PUT /v1/admin/menu-items/:item_id/routes/:branch_id`.

## Test count

- Before: 101 files, 390 tests (end of batch 07).
- After: 106 files, 403 tests, all passing. `races.int.test.ts` passed in 3 separate runs.

## Rulings and anything odd (for the reviewer)

1. **TDD order slip in task 33.** I edited `config-version.ts` before writing the tests. To still see the tests fail for the right reason, I stashed only that file (`git stash push <file>`), ran the new tests (4 failed, as expected), then restored it with `git stash pop`. No reset or rebase. The committed result is the same as test-first, but the order was not.
2. **Route PUT lock order (task 32).** The order is: item `FOR UPDATE` (`404 MENU_ITEM_NOT_FOUND`), then the route row `FOR UPDATE`, then the station and programs `FOR SHARE`, then the branch row (S8). Item PATCH also locks the item first, so the two serialise without deadlock. #86 / #87 (task 34) confirm the station and program sides.
3. **Route PUT details the spec leaves open (task 32):**
   - Error fields are `station_id`, `program_id` and `stock_program_id`, without the `routes.<i>.` prefix that the POST body uses. `assertRoutes` now takes a path-prefix function.
   - `{ station_id: null, program_id: … }` is a `400`.
   - A PUT on an archived item is allowed; the item's restore re-checks its routes.
   - `{ station_id: null }` when there is no route still writes a `route_removed` row (before null, after null) and bumps. So every PUT is one audited write and one bump, which matches "one bump each" in #39.
4. **#82 covers some behaviour built in earlier tasks.** The category archive / restore rows (task 26) and the batch → slot program archive rows (task 24) already worked. In this task's test run, those parts passed and only the route parts failed.
5. **Tenant-wide guard (task 33).**
   - A tenant bump is now 3 statements, as §6.14 counts: the owner row, the branch lock, then the update.
   - The coverage check runs after the branch lock and before the update. A `403` rolls back the write, the audit row and the idempotency key.
   - An `ownerUserId` with no `owner_users` row is refused.
   - The batch 07 limitation (item 5) still stands: an item restore re-checks only the routes in the JWT's branches.
6. **#153 setup.** The test issues branch D's code with `ulidGen` / `cryptoSecrets`. The fixture's `testIdGen` / `testSecrets` restart at the same values, so a second `issueRegistrationCode` hit `registration_codes_pkey`.
7. **Race hooks (task 34).** There are four call sites:
   - `afterTargetLock` in station PATCH and program PATCH;
   - `afterReferenceLock` in item POST and route PUT.

   No other write calls them. The lock order already held, so no production change beyond the hooks.
8. **CLIs (tasks 35, 36).** Each CLI exports `run…(argv, deps) → exit code` alongside the plan's `setBranchSettings` / `restoreBump`. Tests check exit 1 without a child process, and `main()` passes the code to `process.exit`.
   - Options are strict pairs. Any other option, including `--business-day-start`, is a usage error.
   - Integers must be whole numbers (`1.5` is refused).
   - Ranges and stale > gap are checked on the merged values before the UPDATE. The DB CHECK stays as a backstop.
   - `set-branch-settings` writes the audit row and bumps through a small `TenantSql` adapter over the `SystemContext` transaction.
   - `restore-bump` reads the old branch versions `FOR UPDATE` after the tenant row lock, so it can print them.
9. **#123 lint clause.** The `restore-bump` test also lints a snippet with ESLint's `lintText`: importing `SystemContext` from `apps/cloud/src/modules/x.ts` gives the M56 error. It imports `eslint` from the root devDependencies, as `packages/engine/src/lint.test.ts` does. The hub part of #123 (forward-only apply) is task 39.

No STOP. `.auto/DONE` is not written (tasks 37–72 remain). Next task: 37 (hub migration 0004 and projections).
