# 03a cloud lane: whole-branch review

## Scope

- Diff: `git diff origin/module-03a...origin/module-03a-cloud`, 139 files.
- `origin/module-03a` = `0e637a0c2fad9e10f6d4cb0f4bec287ddd541463`; `origin/module-03a-cloud` = `d5f76b74599f1a52fc9b96f0cd4b183b620c8bc9`; merge base `93943c57e83cd5ec164368131d6337f9fd9914ad` (module-03a is 20 commits past it).
- Date: 2026-11-07.
- Authority: 01a v2.1, 01b v1.5, 03a v1.0 §3.10, §3.11, §4.5; rulings and proposed rows in `docs/plans/03a-cloud-status.md`.

**Read:** migration 0007; builder; `BranchConfigSnapshotSchemaV3`, `EngineConfigApplied`, `packages/events/testing`; poller and projection; the whole diff of restaurant service, repository, routes, versions, staff-roles, the admin schemas and the CLI; every non-test client file in the diff; the test diffs of pre-existing tests, scanned for removed assertions; the titles of the new test files, and the tests behind each claim below.

**Ran** (database `pos_test_cloud`, `/tmp/pos-perf.running` checked absent before each run, no full suite):

- A scratch file `apps/cloud/test/zz-review-scratch.int.test.ts`, **removed afterwards**; the tree is clean apart from this report. Its output went to `/tmp/rv/out.txt`. It left rows in `pos_test_cloud`; `restaurantFixture` truncates on its next use.
  1. Lock stress: up to 14 writes at once per round (three station PATCHes with lists and point moves, archive and type change, two point PATCHes including archive/restore, station POST with alternates and carry times, branch settings PATCH, rename, category and two item PATCHes with goes-with, route PUT), 150 rounds. No 5xx, no deadlock. Afterwards no active station sat at an archived point.
  2. The snapshot built after the stress, mapped to the §3.11 `E(next)` shape, parses with the strict `EngineConfigAppliedPayload`.
  3. Another tenant's ids in a station body: all 422.
  4. NUL characters in bodies: finding 4 below.
- `git merge-tree --write-tree origin/module-03a origin/module-03a-cloud`: **clean merge**, tree `f4d2b29`. Not compiled or tested as merged.

**Not run:** the full gate; any client or hub test; the merged tree.

## Verdict

**Approve for merge, after a full gate on `d5f76b7`.** I found no Critical and no Important finding. The server, snapshot and lock design held up under every attempt to break them. The findings are one product decision worth taking now (1), UX dead ends, and documentation and test gaps.

The gate is a real precondition: the only green gate is at `822a3a2`, and code has changed since (finding 3).

## Findings

### Critical

None.

### Important

None.

### Minor

**1. A saved goes-with link to an archived target is silently deleted by an unrelated edit of the list (CL-19 proposed row).**
`apps/client/src/features/owner/menu/GoesWith.tsx:46-62`, `menu/ItemForm.tsx:369-374, 687`, `menu/CategoryForm.tsx:43-49`, `apps/cloud/src/modules/restaurant/service.ts:1729`.
- **What:** the form leaves known-archived targets out of both its base and its value. The list goes only when it differs from that base, and then goes whole, so the archived row is gone from the database.
- **Scenario:** "Raita" links to a seasonal "Lassi". Lassi is archived for winter. The owner adds a link from Raita to "Naan" and saves. In spring Lassi is restored; the Raita link does not come back, and nothing told the owner. Without the edit, it would have (the builder only hides it, CL-12).
- **The same applies to alternates**, at `stations/Timing.tsx:157-158`, where the drop goes out with any save. That case is rare, because it needs the owner station archived first (service.ts `activeStationsNamingAlternate`).
- **Verified:** by reading; server half covered by `item-timing.int.test.ts:474`.
- **Fix, needs a developer ruling:** either accept it and say so in CL-19, or have `assertGoesWithTargets` check only targets not already in `beforeLinks`, so the client can resend archived rows unchanged. I lean to the second: it also removes the resend 422 that forced this client logic.

**2. A refused station restore or add gives a message with no way forward.**
`stations/StationsView.tsx:426-428`, `stations/StationDialogs.tsx:82-87`, `apps/client/src/i18n/en.ts:550, 534`, `service.ts:623`.
- **Restore:** a station and then its point are archived (both allowed). Restore on the station answers 422 `{ field: 'point_id', reason: 'archived' }`, shown as "This was archived. Pick another one." There is no picker on an archived row, and the text does not say that "this" is the point.
- **Add:** with every point archived, Add station answers `reason: 'no_active_point'`. No `errors.reference.no_active_point` exists, so the generic "Choose another one" shows, in a dialog with no point field (CL-18).
- **Verified:** server by `stations-engine.int.test.ts:339, 349`; client by reading.
- **Fix:** two specific strings naming the Points page.

**3. The status board is out of date and no gate covers HEAD.**
`docs/plans/03a-cloud-status.md:5, 22, 28, 29`.
- It says "No commit after it touches code", "No browser check", and lists the inbox flake and `MenuView.tsx:385` as open. All four are now false: `9078fb3`, `985f169`, `226bf7c`, `49d2229`, `65dbb4e`, `b7cfeef`, `42f40fa`, `6ed3d21` came after `822a3a2`. `65dbb4e` alone fails `tsc` by its own report.
- `progress.md` shows no gate since. The report of the browser task lists `edge.py` as not rerun on the final build.
- **Fix:** run the gate on `d5f76b7`, then refresh the board.

**4. A NUL character in a body passes Zod and answers 500.**
`packages/events/src/admin/restaurant.ts` (`PointName`, `CarryTime.point_id`).
- **Proved:** `POST …/points { name: 'a\u0000b' }` → 500; `PATCH …/stations/:id { carry_times: [{ point_id: 'x\u0000' }] }` → 500. Also `POST …/floors { name: 'a\u0000b' }` → 500, so this is an older class the new routes inherit, not something this lane introduced.
- It is not a CHECK or FK failure, and only an owner's own crafted request reaches it.
- **Fix:** later, at the shared string helpers, for all admin bodies; not for this merge.

**5. The Task 29 as-built list misses behaviour the spec does not state, and CL-13 and CL-5 under-describe the version rule (proposed rows).**
`docs/plans/03a-cloud-status.md:32`; 01a §5.2a line 629; `packages/events/src/admin/restaurant.ts:119, 145`.
- **Missing from the list:** CL-7, CL-8, CL-9, CL-10, CL-15, CL-18, CL-19. These are API contract (`422` fields and reasons, `409 used_by station`) or carried requirements. CL-15 in particular tells consumers to tolerate goes-with ids absent from `items[]`, and no spec tells 02 or 03b so.
- **Version rule:** §5.2a says every new table's writes need `expected_version`. CL-13 excepts only `goes_with_links`, but `station_alternates` and `carry_times` are equally last-write-wins: the station wire has no `version`, although CL-5 lists "stations" among the wires that follow the hash.
- **Scenario:** two tabs have one station open; each edits its alternates; the second save silently replaces the first's list. CLAUDE.md asks to stop and ask where code and spec differ.
- **Fix:** extend CL-13 to the station lists, or rule otherwise, and add the rows to the list. No code unless the ruling asks for a station version.

**6. Same raw-log flake pattern survives next to the one fixed.**
`apps/hub/test/alerts/personal-notices.int.test.ts:188, 297`, `apps/hub/test/ws/alert-mode.int.test.ts:347`, and a lesser version at `apps/hub/test/sync/poller.int.test.ts:213` (`'918273645'`).
- `9078fb3` fixed `inbox-catch-up`, but these still run a raw `not.toContain('480000')` over logs that can hold a float `responseTime`.
- They will fail a gate at random. `progress.md` records the first two; the status board does not, so it could be lost.
- **Verified:** by reading; the failure itself was seen once at `5c7d68d` in the sibling test.
- **Fix:** move `leaksInLogs` to a shared helper and use it in all three. The files are outside this lane, so this needs the developer's permission.

**7. Whole-menu read on every open of an edit form (CL-19 proposed row).**
`menu/GoesWith.tsx:23-42`, `menu-pages.ts:25-31`.
- Each item or category Edit reads every active and archived page, one 8-statement read per 200 items. A 5 000-item menu (the size S48 is built for) costs at least 25 requests and about 200 statements per click. The read also runs for a read-only owner, whose picker cannot change anything.
- Harmless at pilot size.
- **Verified:** by reading.
- **Fix:** not now. Note the limit in CL-19; the later fix is a small read by the ids in the stored list.

**8. A non-number in a timing box is neither marked nor dirty.**
`stations/Timing.tsx:135-140`, `stations/StationsView.tsx:156-165`.
- `timingPatch` returns null for the whole group, so Save shows only the generic banner with no box marked, against the file header's "a refused value shows … under its field". `changed` also stays empty, so leaving the form discards the typed text with no prompt.
- **Verified:** by reading.
- **Fix:** per-box parse errors, as `enginePatch` already returns (`KitchenTiming.tsx`).

**9. Client range tables repeat the Zod ranges with nothing tying them together.**
`menu/timing.ts:14-20`, `branches/KitchenTiming.tsx:20-44, 56-59`.
- All values match `restaurant.ts`, `staff.ts` and 0007 today (compared by hand). No test fails if one moves, and the headers say "the ranges are the cloud's", though these refuse before the cloud does.
- `valueOf` also repeats `minutesOrStored`, with the same result for now.
- **Fix:** one client test that checks each table's bounds against the schemas; call `minutesOrStored` from `valueOf`.

**10. Test precision still open from the parked list.**
- `stations-engine.int.test.ts:349-357`: Pass has `sort_order` 0, the lowest, so the test passes with `name = 'Pass' DESC` removed from `shareDefaultPoint`. Give Pass a higher sort first.
- Another tenant's ids in a station body have no test. The behaviour is right (probe 3); the test should be kept.

**11. A branch-specific permission goes to `module-03a` with the merge.**
`.claude/settings.json:34` allows `git push origin module-03a-cloud`. It is harmless but pointless after the merge. Drop it before merging; the developer owns this file.

## Checked and found sound

- **Snapshot V3:** builder, schema, fixtures and the `EngineConfigApplied` field names agree; `aBranchConfig` is tied to `anEngineConfigApplied` by a test. Every value the database can hold parses, since the CHECKs are narrower than the schema's plain ints: archived rows, an archived point, a station with no programs, 0 values, null knobs, a carry time at an archived point. Sort orders are total and in byte order, so the hash is stable.
- **Upgrade path:** a hub holding a schema 2 row asks with `config_version` 0 and applies V3 at the same version, even though 0007 does not bump (`config-v3.int.test.ts`).
- **Branch creation:** `INSERT INTO branches` exists in one place, `issue-registration-code.ts`, and it inserts Pass and the settings row; `seed-demo` and the fixtures go through it. The missing-row throw therefore cannot stop a branch's sync.
- **0007 against the writers:** I traced every CHECK and FK to a Zod rule or a locked read: ranges equal, merged lane / reserve / amber-red checked first, and references read under lock before the write, on rows that are never deleted. Only NUL (finding 4) reaches a 500. The backfill matches what later code assumes. `migrate-ahead` and `staff-roles-migration` read the folder, so 0008 breaks neither.
- **Locks:** station PATCH (stations in one ordered statement, then points FOR SHARE, then the branch), point PATCH (point, plain read, branch), station POST (points, stations, both FOR SHARE) and branch settings (branch only) form no cycle. Stress run clean, as above.
- **Audit, bump, no-op:** each write has one audit row and one bump in the same order. Branch-scoped writes bump one branch, tenant-level writes every branch. Anything that changes the snapshot's goes-with or alternates bumps. The no-op rules hold for lists sent in another order.
- **Bounds:** ≤ 32, ≤ 27, ≤ 17, 304, §6.8 at 3, §6.11 at 8 and the builder at exactly 21 are pinned by tests; the new reads add no statement per row.
- **Tenancy and permissions:** every new route calls `assertBranchAllowed` and is in `route-cases.ts`. Every body reference is filtered by tenant and, where relevant, branch; FKs carry `branch_id`.
- **Client against server:** URLs, bodies, `issues` paths, `used_by` shapes and `expected_version` handling match. Stale saves keep the draft and offer Reload.
- **Spec coverage:** A-1–A-13, B-6, B-8 and every §4.3 field are implemented, each with tests.
- **Test health:** no assertion weakened in the flip (removed lines are the V2-to-V3 renames, or bounds raised to B-8); the config schema suite grew from 17 to 33 tests. The race tests I read (`points.int.test.ts:291, 310`, `stations-engine.int.test.ts:456`) have the same result if the pause is too short, so they can pass without racing but do not flake. Cloud tests run with `fileParallelism: false`.
- **Merge:** clean by `merge-tree`, and `boot-steps.ts` is untouched.
