# 03a cloud lane status (C1–C9)

## Report: in progress (C2 onward), developer rulings received

The first stop, at C2, is resolved by the AD rows below.

| Task | State | Commit | Review |
|---|---|---|---|
| C5a (schema half of C5) | done, pushed | fdb0e6f | approved, 4 Minor parked |
| C1 | committed, NOT pushed | 9d8b930, dcca7a1 | SQL correct, 3 Important open, all need decisions |
| C2–C4, rest of C5, C6–C9 | not started | | |

Gate: not run in full (known red). Tests run with `vitest --dir apps/cloud` at dcca7a1: 214 failed, 2210 passed, 41 files failed.

### AD rows: developer rulings
| AD | Problem | Developer ruling | Files |
|---|---|---|---|
| CL-1 | C2, C4, C5, C7, C8, C9 need files outside the lane's first list | May edit them. Only this lane changes `aBranchConfig`; the engine lane appends new builders at the end of the file only | `packages/events/src/admin/restaurant.ts`, `admin/staff.ts`, `packages/events/testing/index.ts`, `apps/client/src/features/owner/**` |
| CL-2 | C6 hub half | This lane does it: `apps/hub/src/sync/**` EXCEPT `boot-steps.ts` (engine task 20), `apps/hub/src/projections/branch-config.ts`, expectation-only edits in tests using `aBranchConfig` (`apps/hub`, `packages/engine`). V3 flip = ONE separate commit, last of C6; the engine lane resolves engine-test conflicts at merge | as listed |
| CL-3 | New branches get no Pass point or settings row | Every branch-create path inserts "Pass" and `branch_engine_settings` in the same transaction. Folded into 01a's as-built at task 29 | `issue-registration-code.ts` and any other branch-create path |
| CL-4 | `'point'` in `config_audit_entity_check` is absent from §5.2a, §6.0 | Keep it in 0007. As-built at task 29 | `0007_engine_config.sql` |
| CL-5 | `version` column vs R30 | Check how R30 writes work and follow the existing pattern; come back only if it means changing the column | see below |
| CL-6 | Push policy, build | Red mid-batch pushes are fine (engine lane merges at its task 23). Push C1, the board and after every task. Build apps/client once here. Branch must be green at the end | — |

### Proposed AD rows
- C5a staging: V3 added next to V2, `SNAPSHOT_SCHEMA_VERSION` stays 2 until the flip (pin V2 to `z.literal(2)` or remove it then).

### Parked for later tasks
- C5a tests: accepted enum values and nullability coverage (Minor).
- C6: sort assertions moved here from C5; `alternate_station_id` maps to snapshot `station_id`.
- C2: test fixtures need `point_id` (`test/helpers/restaurant.ts`, 11 test files); capacity below `lane_units`/`reserve_units` must be a validation error, not a 500; default point if Pass is renamed or archived; duplicate `order_types` values.
- C3: `apps/cloud/src/lib/config-audit.ts:25` needs `'point'`.
- C1 test order dependency at `engine-config-migration.int.test.ts:112` (Minor).

### Notes
- `pos_test_cloud` did not exist; the controller created it. An implementer hand-reset 0007 in that database once. Any further edit to 0007 needs the same reset.
- 0007 is unmerged, so this lane still owns it.
