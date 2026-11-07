# 03a hub3 lane status (R2, R1b, 25, 25b, 26)

Plan: `docs/plans/03a-plan.md`. Branch `module-03a-hub3`, cut from `origin/module-03a` at `52d5b31` (includes the hub2 merge `9c7a75d`). Decisions and AD rows of the engine lane stay in `docs/plans/03a-status.md`.

## Merge of `origin/module-03a` (tasks 22 and later), 2026-11-07

**Merge commit `f40fbc3`.** The only conflict was in `apps/hub/test/commands/business-day.int.test.ts`. Both sides had independently left the day-close checkpoint out of the A-14 statement count. The resolution keeps hub3's per-table host-write count, which does not depend on how many statements a checkpoint write takes, with the engine lane's comment facts. The file alone: 11/11 pass.

**Gate at `f40fbc3`, under the lock: green except one timing assert, which is reported, not counted as red.** Typecheck and lint pass. 3084 tests passed, 1 skipped, 1 todo, and 1 failed: `[03a §7.1 snapshot] … ≤ 50 ms` (`snapshots.int.test.ts`) at 90.9 ms. A rerun of the file alone gave 16/17, with the same assert at 60.0 ms, while the engine lane's `tsc` runs in `~/pos` held the load average at 8.9. It is the same wall-clock assert as at `760a0d9`. It passed 14/14 alone on a quieter machine. **Engine lane:** this assert still lives in a hub int file outside `pnpm test:perf` (AD-32).

## End report: R2, R1b, 25, 25b, 26 done; gate green

**Result:** all five tasks are built, reviewed and pushed on `module-03a-hub3`. No Critical or Important finding is open.

**Gate at `760a0d9`, under `/tmp/pos-gate.lock`:** typecheck and lint pass. 3068 tests passed, 1 skipped, 1 todo, and **1 failed on a timing assert only**: `[03a §7.1 snapshot] serialise + insert ≤ 50 ms` in `apps/hub/test/engine/snapshots.int.test.ts:453` measured 60.7 ms (load average 3–5, a 15-minute full run). This is the engine lane's task 21 test. Rerun of that file alone, under the lock: **14/14 pass**. Per the developer's rule (timing asserts on a loaded laptop are noise, AD-32), this is reported, not counted as red. **Engine lane:** that wall-clock assert is still in a hub int file, not in `pnpm test:perf`.

**Inherited red fixed here:** `business-day.int.test.ts` `[01a §6.18b A-14]` statement count failed (25 vs 27) since task 21 (`9ebf943`). A close with no order now writes the checkpoint in the host's after-commit hook, inside the counted window. `760a0d9` makes the test subtract the host's `engine_checkpoints` / `engine_snapshots` writes; the assertion is still `plain + 2`. **Engine lane:** the same file is on `module-03a`, so expect this as a merge overlap.

| Task | Status | Commits | Review |
|---|---|---|---|
| R2 | DONE | `d60a092` | Approved, 0 Critical, 0 Important |
| R1b | DONE | `aa7bdc7` | Approved, 0 Critical, 0 Important (paired with R2) |
| 25 | DONE | `9553c56` | Approved, 0 Critical, 0 Important |
| 25b | DONE | `bd26c70`, `f11d64a` | 1 Important (an avoidable `MAX(seq)` read; a weak statement test) fixed in round 1, re-review verified |
| 26 | DONE | `6fedad2` | Approved, 0 Critical, 0 Important |
| gate fix | DONE | `760a0d9` | inherited A-14 test, test-only |

## Controller rulings

- **Task 26 wiring:** the audiences of `EngineConfigApplied`, `StationCapacitySet`, `StationPauseSet` and the `stations_live` catch-up part are registered in a new `apps/hub/src/ws/engine-audiences.ts` (the 01a pattern of `ws/restaurant-audiences.ts` and `ws/restaurant-catch-up.ts`), called from `server.ts`, not in `engine-host/index.ts` (owned by the engine lane). §6.4 names no file. Cost if wrong: move about 10 lines into `registerEngineHost` at the merge.

- **25 / 25b registration:** both commands are registered in `server.ts` (`buildHubServer`), like `SetPrecookedStock` and `SetItemAvailability`, not through `registerEngineHost`. Cost if wrong: two lines to move.
- **25 / 25b response:** the §6.6 / §6.7 bodies travel as `data.result` in the foundation envelope `{ data: { command_id, event_ids, result } }`.
- **26 timing:** the hub test's ≤ 5 ms is a sanity bound (median of 60 calls: 0.011 ms, p99 0.091 ms). The official §7.1 `stations-live` number stays in the engine perf project (AD-32).

## Open items

- **For the engine lane (engine-host, not editable here):** `appendEvents` runs `SELECT MAX(seq)` even for an empty list. `SetStationCapacity` appends inside `handle` to answer with the post-fold `pressure_bp` and `band`, so the route's later `tx.append([])` costs one read beyond the §10.5 "00 pipeline + 0 reads". This is pinned as `+1` in its test. The same applies to `SetPrecookedStock`, `SetItemAvailability` and `AddPrecookedStock`. Fix: an early return on an empty list, then tighten the test to equality.
- **Double fold per capacity change** (the handler for the response, the writer for the commit), as in `SetPrecookedStock`. It needs an engine-host change to accept a pre-folded state. Note it for the §7.1 measurements.
- **01b §3.6 AD-19, as-built (task 29):** the cloud rule against two entries for one station now applies per (station, kind), so `count_stock` and `run_station` can both be set on one station.
- **Release note:** upgrade hubs before anyone assigns `run_station`. An older hub rejects the whole sync envelope (config included) once one `run_station` row exists. Group this with the B-8 schema-3 note.
- **As-built (task 29):** `stations-live` takes repeated keys (`station_ids=A&station_ids=B`; a comma list is not split). It is the first array query on the hub. An empty `station_ids=` returns an empty list.
- **Still open from 01b:** no owner-app screen assigns `run_station`.
- **Minors (deferred):** 25: no test for the station-session 403-before-400 order; extra details on the 403 body; the shared helpers live in `set-station-capacity.ts`. 25b: the station-session 403 is the framework's `{ permission, session_kind }`. R1b: two unasserted `PUT /pin` setup calls (`responsibilities.int.test.ts:390`). R2/R1b: `copyUpTo` is repeated in the migration tests. 26: a 50 ms sleep in the WS test.
