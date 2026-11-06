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
| CL-5 | `version` column vs R30 | Check how R30 writes work and follow the existing pattern; come back only if it means changing the column. **Outcome:** R30 `expected_version` is a content hash built per wire (`menu-variants/versions.ts`, `staff-roles`); 0006's tables have no `version` column. New wires follow the hash. 0007's `version` column stays as §5.2a states and no write compares it, so the column needs no change. Flag the unused column at task 29 | `points`, stations, branch settings wires |
| CL-6 | Push policy, build | Red mid-batch pushes are fine (engine lane merges at its task 23). Push C1, the board and after every task. Build apps/client once here. Branch must be green at the end | — |

### Proposed AD rows
- CL-7 (C2): POST with no `point_id` uses the active "Pass", else the active point with the lowest (`sort_order`, `point_id`), else `422 { field: 'point_id' }`.
- CL-8 (C2): merged row with `lane_units` / `reserve_units` above capacity, or amber ≥ red, or duplicate or non-subset order types: `400 VALIDATION_FAILED`, not a 500 from the CHECK.
- CL-9 (C2): carry-time `point_id` of another branch `422 { field: 'carry_times' }`; failing alternate `422 { field: 'alternates' }`; `station_type` to batch with alternates or named as one `409 CONFIG_IN_USE { used_by: station }`.
- CL-10 (C2): naming an archived station `422 alternates`; archiving a station an active one names `409 CONFIG_IN_USE`; restore has no check, so an active station can still name an archived one, and the C6 builder leaves those rows out of the snapshot.
- CL-11 (C2): station PATCH locks the target and named alternates in one `ORDER BY station_id FOR UPDATE` statement instead of S8's target-then-references `FOR SHARE`, because the literal order deadlocks when two stations name each other. No external change. As-built at task 29.
- CL-12 (C4): goes-with target checks use a plain read, not the §6 script's `FOR SHARE`: locking item targets deadlocks two items linking each other and inverts the lock kinds. No invariant lost because archive has no in-use check on links and the C6 builder drops inactive links (C6 must test it). As-built at task 29.
- CL-13 (C4): `goes_with` lists are last write wins as fields of `menu_items` / `categories` (S23); §5.2a's "new tables need `expected_version`" is not applied to `goes_with_links`. Item POST takes the knobs but no list. As-built at task 29.
- C5a staging: V3 added next to V2, `SNAPSHOT_SCHEMA_VERSION` stays 2 until the flip (pin V2 to `z.literal(2)` or remove it then).

### Parked for later tasks
- C5a tests: accepted enum values and nullability coverage (Minor).
- C6: sort assertions moved here from C5; `alternate_station_id` maps to snapshot `station_id`.
- C2: test fixtures need `point_id` (`test/helpers/restaurant.ts`, 11 test files); capacity below `lane_units`/`reserve_units` must be a validation error, not a 500; default point if Pass is renamed or archived; duplicate `order_types` values.
- C3: `apps/cloud/src/lib/config-audit.ts:25` needs `'point'`.
- C2/C3 test precision (Minor, reviewer): CL-7 "Pass first" clause untested (`stations-engine.int.test.ts:349`); clearing a nullable to null untested (`:161`); `issue-code.int.test.ts:68` does not prove rollback; another tenant's ids in body references untested; 100 ms race holds; point race test title (`points.int.test.ts:310`).
- Task 29 notes: §6.8 points lack `version`; §6.0 lacks §6.9a; `points_branch_name_active` is case-sensitive, stations use `lower(name)`; CL-11 alternate `FOR UPDATE` briefly blocks FK key-share writers.
- C8/C9 owner forms must drop archived targets and alternates before saving, or a resend gets `422`; a category archive path of ruling 7 is untested (`item-timing.int.test.ts:412`, Minor).
- C1 test order dependency at `engine-config-migration.int.test.ts:112` (Minor).

### Notes
- `pos_test_cloud` did not exist; the controller created it. An implementer hand-reset 0007 in that database once. Any further edit to 0007 needs the same reset.
- 0007 is unmerged, so this lane still owns it.
