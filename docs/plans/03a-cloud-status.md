# 03a cloud lane status (C1–C9)

## Report: STOPPED at C2, waiting on developer decisions

Stop rule hit: C2 onward needs files outside this lane's list, and two gaps need a spec decision.

| Task | State | Commit | Review |
|---|---|---|---|
| C5a (schema half of C5) | done, pushed | fdb0e6f | approved, 4 Minor parked |
| C1 | committed, NOT pushed | 9d8b930, dcca7a1 | SQL correct, 3 Important open, all need decisions |
| C2–C4, rest of C5, C6–C9 | not started | | |

Gate: not run in full (known red). Tests run with `vitest --dir apps/cloud` at dcca7a1: 214 failed, 2210 passed, 41 files failed.

### Decisions needed
1. Widen the file list: `packages/events/src/admin/restaurant.ts` (C2, C4), `admin/staff.ts` (C7), `packages/events/testing/index.ts` (C5), `apps/client/src/features/owner/**` (C8, C9).
2. C6 hub half: `apps/hub/src/sync/**`, `apps/hub/src/projections/branch-config.ts` are forbidden; flipping to V3 breaks apps/hub and packages/engine tests using `aBranchConfig`. Who does it?
3. New branches: `issue-registration-code.ts:78` creates no Pass point or `branch_engine_settings` row; the spec only covers the migration.
4. `'point'` in `config_audit_entity_check`: needed by S26, absent from §5.2a and §6.0.
5. `version` on new tables: §5.2a says integer column; check against how R30 writes compare it.

### Proposed AD rows
- C5a staging: V3 added next to V2, `SNAPSHOT_SCHEMA_VERSION` stays 2 until the flip (pin V2 to `z.literal(2)` or remove it then).
- `'point'` audit widening in unmerged 0007 (decision 4).

### Parked for later tasks
- C5a tests: accepted enum values and nullability coverage (Minor).
- C6: sort assertions moved here from C5; `alternate_station_id` maps to snapshot `station_id`.
- C2: test fixtures need `point_id` (`test/helpers/restaurant.ts`, 11 test files); capacity below `lane_units`/`reserve_units` must be a validation error, not a 500; default point if Pass is renamed or archived; duplicate `order_types` values.
- C3: `apps/cloud/src/lib/config-audit.ts:25` needs `'point'`.
- C1 test order dependency at `engine-config-migration.int.test.ts:112` (Minor).

### Notes
- `pos_test_cloud` did not exist; the controller created it. An implementer hand-reset 0007 in that database once. Any further edit to 0007 needs the same reset.
- 0007 is unmerged, so this lane still owns it.
