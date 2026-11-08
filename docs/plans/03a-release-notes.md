# 03a Timing Engine — release notes (v1.0.1 as built, approved)

Spec: `docs/specs/03a_Timing_Engine_Spec_v1.0.1.md` (**APPROVED by the owner 2026-11-08**; v1.0 kept as history). Branch `module-03a`, code head `dbfcf4b`. **Full gate green at `dbfcf4b`** (3214 tests, 8 m 55 s, on RAM per the owner's test-environment rule). Final `pnpm test:perf` (real disk): every engine row passes. The three SQLite-COMMIT host rows (`fires`, `fires_alerts` with work, snapshot full write) fail on this laptop's ≈ 27 ms-per-fsync disk. A same-disk A/B shows the batch 8 code fails them the same way today, so it is the disk, not the code. **Deferred to task 28** (owner ruling 2026-11-08): the pilot box first shows < 2 ms per flush (`dd oflag=dsync`). Date 2026-11-08.

## What 03a v1.0.1 delivers

- **`@pos/engine`**, the pure timing engine. It plans every order against each station's occupancy profile (hold-and-fire, Waada Guard / EDF / FIFO, routing across stations, batch loads). It re-plans on every submit inside slack and never moves a promise. It also handles overload (shared weighted lateness), boost, live capacity and lanes, station pause, pressure, stock reserve / release / consume, split send, and return to kitchen. Replay rebuilds exactly the live state, which is checked over 50 seeds.
- **The hub engine host:**
  - the reducer;
  - boot steps 2, 3 and 6 (snapshot or checkpoint, then a filtered replay);
  - snapshots every 500 events and on SIGTERM, and the day-close checkpoint;
  - the `fires` tick (fires, auto-fill, inferred taps, the cascade) and the `fires_alerts` tick (slip warnings, station overload, dropped-line alerts);
  - the `station_plan` catch-up part and frame for the KDS;
  - the config hook (`EngineConfigApplied`);
  - the commands `set-station-capacity` and `set-station-pause`, and the query `stations-live`.
- **Alert kinds:** `slip_warning` (a "Send what's ready" / "Wait" request to the table's order taker, with an "≈ N min late" card), `station_overload`, and `engine_line_dropped` (a manager notice when a bad order line is dropped).
- **Built with it:** 01a v2.1 (points, carry times, alternates, timing knobs, engine settings), the 01b v1.5 permissions and `run_station`, the 00 v1.7 device columns, and 01d v1.1.2 (`AlertRaised` v2).

## Operational notes

1. **Upgrade every hub before anyone assigns `run_station`** (AD-34, developer ruling).
2. **`AlertRaised` is now v2** (01d v1.1.2, AD-36). Old v1 rows still read through an identity upcaster. The cloud has no event ingest yet, so any future cloud event sync **must parse `AlertRaised` v2 with the shared event registry** (`@pos/events`), not with its own schema.
3. **The performance gate is `pnpm test:perf`**, run on an idle machine (a clean measurement). It is not part of `pnpm -w test`, because timing asserts on a busy machine are noise (AD-32).
4. **The pilot-box checks are pending** (task 28): every §7.1 number so far is from the dev laptop (i7-4900MQ). Task 28 writes `docs/plans/03a-manual-checks.md`, and the developer runs it on the pilot mini PC. That covers re-plan p99, the fires and `fires_alerts` passes, snapshot write, crash restart, full-day and 2-day replay, boot steps 4–8, `stations-live`, the `events_branch_stream` index build over a seeded month, and a KDS smoke test. If any number misses its target, stop for a spec bump.
5. **Index build at release:** the `0007_engine.sql` migration builds `events_branch_stream` over the whole `events` table. On a hub that already holds a long log, ship it in the maintenance hour (≈ 1 s per month of history, to be measured in task 28).
6. **A capacity change re-plans twice** (the command folds its own event for the response). It gives the same result and costs only time (AD-34).
7. **A config catch-up that keeps failing no longer stops fires.** After 3 failed attempts, ordinary passes run again and the catch-up retries every 60 s. Watch for the `warn` line "config catch-up backed off; configStale still set" (AD-35 c).
8. **Every config apply writes one `EngineConfigApplied`**, including a price-only change (`config_version` is part of it). It re-plans nothing (AD-35 24-1).
9. **An answered slip warning stays answered for that table for the rest of the day** until 02p keys dine-in tables by seating (AD-37 (2)).

## Carried to other modules

**To 02 (Ordering + Tables):**
- **Binding:** the device mints `order_item_id`, and 02 refuses a reused live id before it appends (AD-29 Q5).
- `OrderPlaced.lines[]` copies the planner's `station_id`, `alternates` and `carry_ms` verbatim (AD-17).
- `MarkServed` appends `stockEffects`: a from-stock line with no Start consumes at Served (AD-29 Q7). The default `mark-served` scope is `branch`.
- The abandoned-order label reads "no tap on any line for N h" (BF-11).
- The command halves of tests #101, #103, #107 (`409 RETURN_ALREADY_OPEN`) and #114.

**To 02p:**
- **Task 0** (open item 10): carry the `fires_alerts` bound into 03a v1.2, next to the Q-1 reader pair: 2 `listOpen` + ≤ 1 `holdersOfOrders` + ≤ 1 `currentTableOf` + ≤ 1 line facts + 01d's bounds. Also carry 01d v1.1.2 into 01d v1.2.
- **U-7** (open item 11): add the test "a new seating on the same table gets fresh slip warnings after an earlier slip was answered" (Q-2 keys `dine_in` by `seating_id`).

**To 03b (KDS + Printing):**
- `StartItem`, `DoneItem`, `UndoDone` and `MarkServed` keep the command-level `409 ITEM_WRONG_STAGE`. The engine only ignores duplicates (AD-10).
- `DoneItem` appends `stockEffects`: a from-stock line with no Start consumes at Done (AD-29 Q7).
- Fire a whole load before a Start or pull on one of its lines. `GiveMeMore` on a `single_tap` line writes the inferred start.
- `pullEarly` can answer `null` inside the limit.
- The `station_plan` frame arrives before the same commit's event frames.
- H-5 / H-6 device write checks belong in the pairing / binding UI (with 01e).

**To the UI module:**
- There is no owner-app screen to assign `run_station` yet. Until there is one, assign it through the API.

**Still open, not blocking:**
- 03a §12.3 Q12 (a customer's own wrong order: free remake, or a void plus a charged line) belongs to 02 / 04.
- 01a's next bump: the §9 intro "the only allowed foundation edit" is stale.

## Known gaps (as built)

- `fires_alerts` has no statement assertion for a pass that closes and raises in one go, for an overload pass, or for the first pass after a day close.
- There is no hub-level statement test for a `fires` pass that writes Start, Done, `StockConsumed` and `ReservationsShifted` drafts.
- The new slip line-facts read is not timed at the peak (the simulator's orders have no `placed_by`).
- Task 27 Minor 3: there is no scoped live = replay compare right after the deferred checkpoint is written.
- DoD 2: the pilot-box measurements (task 28).
- BF-9 is parked (`it.todo`, text fixed in `d5ad7ac`; AD-2 superseded).
- Gaps 1, 2, 4 (with `placed_by` on the simulator's orders), 5 and 7 are carried to 02p batch 5 (engine lane).

## Owner rulings 2026-11-08

- Every reading that was proposed is **approved as built**: AD-5, AD-7, AD-8, AD-9, AD-10, AD-11, AD-13, AD-14, AD-15, AD-30, AD-31; AD-29 Q3, Q6, Q9; AD-37 (4)–(9); P-5, P-11, P-12. The slip `apply` read count (§12.2) is confirmed; A-19 is a named exception to D46.
- AD-38: five host readings, approved as built (v1.0.1 Changes row 39).
- The config catch-up back-off warn line is rate-limited: one when it starts, then at most one per 60 s (`72bbed8`).
- Fixed: the station commands' missing-permission tests (`5a44193`); the stale BF-9 todo text (`d5ad7ac`).
