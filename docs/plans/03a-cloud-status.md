# 03a cloud lane status (C1–C9)

## End report: C1–C9 built, gate green

**Result:** all of C1–C9 are built, reviewed and pushed. Full gate at `822a3a2`, under the lock, exit 0: typecheck and lint clean, 2622 tests passed, 1 skipped, 1 todo. No commit after it touches code.

| Task | Commits | Review |
|---|---|---|
| C1 migration 0007 | 9d8b930, dcca7a1 | Clean; 3 Important closed by rulings CL-3, CL-4 and the C2 fixture repair |
| C2 station fields | 99fd486, 1c540fd | Approved |
| C3 points routes | 1cdf184, 8c951ff, 4227c85 | Approved |
| C4 knobs, goes-with | 93b713b, caf7c07 | Approved |
| C5 schema 3 (split: additive, then flip in C6) | fdb0e6f, 8a53778 | Approved |
| C6 builder, hub, V3 flip | ef3e780, 8a53778 (flip, last), 21996e8 | Approved |
| C7 branch settings | 7c43232, 2cc5c78, c29594a | 1 Important (stale version race) fixed and verified |
| C8 points page, station timing | 36ed5c8, 5c7d68d, 822a3a2 | 7 Important over 2 fix rounds, fixed and verified |
| C9 kitchen timing, item timing, goes-with | f861e27, 3d4b6a2 | 1 Critical (goes-with data loss), 3 Important, fixed and verified |

**Merge note for the engine lane:** the V3 flip is `8a53778`. Cloud migration 0008 is free for R1b. `apps/hub/src/sync/boot-steps.ts` and non-test files in `packages/engine` were not touched.

### Not done or not verified
- **No browser check.** C8 and C9 are covered by component tests only. To check by eye: Points page, Timing groups at phone width, RTL, the phone nav entry, Reload after a real `409`.
- **Urdu strings are unreviewed** implementer translations and need a native read.
- **No whole-branch review.** Reviews were per task or pair, as briefed.
- **C8's first commit had no RED run:** the implementer wrote code before tests. Both C8 fix rounds did run RED first, and the reviewer judged most of the original tests constrain behaviour.

### Needs a developer look
1. **Flaky test, outside this lane:** `apps/hub/test/alerts/inbox-catch-up.int.test.ts:493` checks that logs never contain `480000`, and a log's `responseTime` can (seen: `13.025480000000243`). It failed one gate at `5c7d68d`, then passed 3 of 3 alone and in the final gate. It will fail again at random.
2. **Older defect, not fixed:** `features/owner/menu/MenuView.tsx:385` shows `variant_group` and `deal` in-use answers as items.
4. **`set-branch-settings` CLI** audit rows hold 3 fields against the route's 19 (CL-17).
5. **Unused column:** 0007's `version` columns are never compared (CL-5).
6. **Task 29 as-built list:** CL-3, CL-4, CL-5, CL-11, CL-12, CL-13, CL-16, CL-17 and "Task 29 notes" below.

### Environment notes
- `pos_test_cloud` did not exist; the controller created it. An implementer hand-reset 0007 in it once.
- Two power cuts: `pos-pg-test` stayed down both times and the developer started it. The stash `a621fdc` ("partial before power cut 2") holds an abandoned C4 test, is no longer needed, and was left in place.
- One gate went red with 76 failures at `c29594a` because a reviewer ran tests in the same database at the same time. It was the controller's scheduling error, not code: the same failures did not return.

### AD rows: developer rulings
| AD | Problem | Developer ruling | Files |
|---|---|---|---|
| CL-1 | C2, C4, C5, C7, C8, C9 need files outside the lane's first list | May edit them. Only this lane changes `aBranchConfig`; the engine lane appends new builders at the end of the file only | `packages/events/src/admin/restaurant.ts`, `admin/staff.ts`, `packages/events/testing/index.ts`, `apps/client/src/features/owner/**` |
| CL-2 | C6 hub half | This lane does it: `apps/hub/src/sync/**` EXCEPT `boot-steps.ts` (engine task 20), `apps/hub/src/projections/branch-config.ts`, expectation-only edits in tests using `aBranchConfig` (`apps/hub`, `packages/engine`). V3 flip = ONE separate commit, last of C6; the engine lane resolves engine-test conflicts at merge | as listed |
| CL-3 | New branches get no Pass point or settings row | Every branch-create path inserts "Pass" and `branch_engine_settings` in the same transaction. Folded into 01a's as-built at task 29 | `issue-registration-code.ts` and any other branch-create path |
| CL-4 | `'point'` in `config_audit_entity_check` is absent from §5.2a, §6.0 | Keep it in 0007. As-built at task 29 | `0007_engine_config.sql` |
| CL-5 | `version` column vs R30 | Check how R30 writes work and follow the existing pattern; come back only if it means changing the column. **Outcome:** R30 `expected_version` is a content hash built per wire (`menu-variants/versions.ts`, `staff-roles`); 0006's tables have no `version` column. New wires follow the hash. 0007's `version` column stays as §5.2a states and no write compares it, so the column needs no change. Flag the unused column at task 29 | `points`, stations, branch settings wires |
| CL-6 | Push policy, build | Red mid-batch pushes are fine (engine lane merges at its task 23). Push C1, the board and after every task. Build apps/client once here. Branch must be green at the end | — |
| CL-14 | C7, C8, C9 need client files outside CL-1's list | Yes: this lane may edit `apps/client/src/api/**` and `apps/client/src/i18n/**` | as listed |

### §12.4 note (developer ruling)
Add-station dialog: Timing stays on the Edit form only, because the pilot has one point, "Pass". No code. A new station takes the server defaults (CL-18).

### Proposed AD rows
- CL-7 (C2): POST with no `point_id` uses the active "Pass", else the active point with the lowest (`sort_order`, `point_id`), else `422 { field: 'point_id' }`.
- CL-8 (C2): merged row with `lane_units` / `reserve_units` above capacity, or amber ≥ red, or duplicate or non-subset order types: `400 VALIDATION_FAILED`, not a 500 from the CHECK.
- CL-9 (C2): carry-time `point_id` of another branch `422 { field: 'carry_times' }`; failing alternate `422 { field: 'alternates' }`; `station_type` to batch with alternates or named as one `409 CONFIG_IN_USE { used_by: station }`.
- CL-10 (C2): naming an archived station `422 alternates`; archiving a station an active one names `409 CONFIG_IN_USE`; restore has no check, so an active station can still name an archived one, and the C6 builder leaves those rows out of the snapshot.
- CL-11 (C2): station PATCH locks the target and named alternates in one `ORDER BY station_id FOR UPDATE` statement instead of S8's target-then-references `FOR SHARE`, because the literal order deadlocks when two stations name each other. No external change. As-built at task 29.
- CL-12 (C4): goes-with target checks use a plain read, not the §6 script's `FOR SHARE`: locking item targets deadlocks two items linking each other and inverts the lock kinds. No invariant lost because archive has no in-use check on links and the C6 builder drops inactive links (C6 must test it). As-built at task 29.
- CL-13 (C4): `goes_with` lists are last write wins as fields of `menu_items` / `categories` (S23); §5.2a's "new tables need `expected_version`" is not applied to `goes_with_links`. Item POST takes the knobs but no list. As-built at task 29.
- CL-15 (C6): the snapshot drops alternates with an archived station at either end; goes_with drops only archived ends, so a link to an active item not routed at this branch stays, and consumers must tolerate that id; carry times naming an archived point stay, because the point stays in `points[]`.
- CL-16 (C7): `expected_version` is new and required on branch settings PATCH, built per B-6 and B23 because the endpoint had no version. 01b §5.3, §9 and `BranchWire` need as-built rows at task 29. A version-only body is `400` per §6.10's "at least one", unlike staff and role PATCH.
- CL-17 (C7): branch settings and rename lock in one statement and read in a second, because a joined `FOR UPDATE OF b` kept a stale `e` under READ COMMITTED. Write 7 statements, no-op 3. `set-branch-settings` CLI audit rows hold 3 fields against the route's 19 (task 29).
- CL-18 (C8): station Timing group on the Edit form only; new stations take server defaults. Pressure amber and red are typed as percent and sent as basis points. `/points` is matched in `App.tsx` because `src/app/router.ts` was outside the list.
- CL-19 (C9): owner forms read the whole menu (at least 2 reads) on open; until it loads, or if it fails, the goes-with picker is off and `goes_with` is never sent; only targets known to be archived are dropped; unknown targets are kept as removable rows.
- C5a staging: V3 added next to V2, `SNAPSHOT_SCHEMA_VERSION` stays 2 until the flip (pin V2 to `z.literal(2)` or remove it then).

### Parked for later tasks
- C5a tests: accepted enum values and nullability coverage (Minor).
- C6: sort assertions moved here from C5; `alternate_station_id` maps to snapshot `station_id`.
- C2: test fixtures need `point_id` (`test/helpers/restaurant.ts`, 11 test files); capacity below `lane_units`/`reserve_units` must be a validation error, not a 500; default point if Pass is renamed or archived; duplicate `order_types` values.
- C3: `apps/cloud/src/lib/config-audit.ts:25` needs `'point'`.
- C2/C3 test precision (Minor, reviewer): CL-7 "Pass first" clause untested (`stations-engine.int.test.ts:349`); clearing a nullable to null untested (`:161`); `issue-code.int.test.ts:68` does not prove rollback; another tenant's ids in body references untested; 100 ms race holds; point race test title (`points.int.test.ts:310`).
- Task 29 notes: §6.8 points lack `version`; §6.0 lacks §6.9a; `points_branch_name_active` is case-sensitive, stations use `lower(name)`; CL-11 alternate `FOR UPDATE` briefly blocks FK key-share writers.
- C8/C9 owner forms must drop archived targets and alternates before saving, or a resend gets `422`; a category archive path of ruling 7 is untested (`item-timing.int.test.ts:412`, Minor).
- OPEN (older than 03a): `features/owner/menu/MenuView.tsx:385` passes every `used_by` to `itemNames`, so `variant_group` and `deal` in-use answers read as items (`service.ts:924,1040,1046`). Same defect class as C8's fix; not touched here.
- C8/C9 Minor (reviewer): a re-added alternate row shows its old refusal until the next Save (`Timing.tsx:375`); stale comments at `BlockedDialog.tsx:14`, `StationsView.tsx:60`; untested failed `listStockItems` and second refused save.
- C1 test order dependency at `engine-config-migration.int.test.ts:112` (Minor).

### Notes
- `pos_test_cloud` did not exist; the controller created it. An implementer hand-reset 0007 in that database once. Any further edit to 0007 needs the same reset.
- 0007 is unmerged, so this lane still owns it.
