# 03a status board

Plan: `docs/plans/03a-plan.md` (53 tasks, batches 0–11). Spec: `docs/specs/03a_Timing_Engine_Spec_v1.0.md`, with foundation v1.9, 00 v1.7 (H-1, H-5, H-6), 01a v2.1 (A-1–A-20; §12.3 Q-v2.1-1 / Q-v2.1-2 answered 2026-11-03), 01b v1.5 (B-1–B-8). Branch `module-03a`.

> **Short Hinglish summary — padhein yahan se**
>
> **Batch 1 ke baad (2026-11-03):** events (order, station, stock), error codes, `EngineState` v3 aur occupancy profile ban gaye; gate green. AD-1–AD-4 aapke rulings hain; AD-5 (`Load` ka provisional shape) task 13 mein confirm hoga. Aapko abhi kuch decide nahi karna — batch 2 ke liye "go" ka intezaar hai.

## Rules for this board

- One batch entry per checkpoint (format below), committed alone: `docs(03a): checkpoint batch N`, then `git push origin module-03a`.
- Gate per batch: `pnpm -w typecheck && pnpm -w lint && pnpm -w test` (controller only, one run at a time). From task 18 on the `perf` project is part of `pnpm -w test`, and its numbers are copied into the §7.1 table at every checkpoint.
- **The gate (task 18):** no task of batch 6 or later starts until every §7.1 row below that task 18 measures is filled and green. A miss stops the build for a spec bump (03a §7.1, §12.5).
- Deviations are **proposed** `AD-n` rows here and in `docs/reviews/03a-auto-decisions.md`; folded into the spec only at task 29.

## §7.1 performance (gate: task 18; pilot box: task 28)

| Path | Target | Drill (Python, seed 7) | CI (task 18) | Pilot box (task 28) |
|---|---|---|---|---|
| Re-plan per submit p99 | ≤ 50 ms | 641.3 ms (pessimistic, not the gate) | — | — |
| Lines re-placed per station re-plan p50 / p99 / max | reported; CI bound set by P-11 | 60 / 650 / 685 | — | — |
| Re-placed-lines bound asserted (P-11) | `ceil(1.2 × p99 / 10) × 10` | — | — | — |
| Overload day (tandoor 125 %): probes / p99 | ≤ 16 / ≤ 50 ms | — | — | — |
| 20-line `StockAdded` at peak (BF-7) | inside 50 ms | — | — | — |
| Snapshot serialise (task 18) / full write (task 21) | ≤ 50 ms | — | — | — |
| Full-day replay from a checkpoint | ≤ 45 s | 284.7 s (Python) | — | — |
| 2-day replay (steps 2–3) | ≤ 80 s | — | — | — |
| Events replayed per day | ≈ R6 ± 20 % | 65 876 | — | — |
| Live = replayed (generated day) | equal | — | — | — |
| `fires` pass with work p99 | ≤ 20 ms | — | (test 62) | — |
| `fires_alerts` pass with work p99 | ≤ 20 ms | — | (tests 76, 93) | — |
| Crash restart ≤ 500 events (steps 2–3) | ≤ 2 s | — | (test 64) | — |
| `stations-live` | ≤ 5 ms, 0 statements | — | (test 66) | — |
| Boot steps 4–8 | ≈ 10 s budget | — | — | — |
| `events_branch_stream` build over a month | ≈ 1 s / month | — | — | — |

## Tasks

| Task | Batch | RISK | Status | Commit | Tests | Note |
|---|---|---|---|---|---|---|
| 0 | 0 | NORMAL | DONE | `6fdf085` | — | autobuild rules, deny list, F §6.2 / 01a §9 appends |
| 1 | 1 | NORMAL | DONE | `2b317b5` | #103, #114 fixture | |
| 1b | 1 | NORMAL | DONE | `5b005d7` | [03a §4.2] | |
| 2 | 1 | NORMAL | DONE | `0bde005` | [03a §9] | |
| 3 | 1 | NORMAL | DONE | `462eb21`, `8f112be` | #56 | perf project created (P-4) |
| 4 | 1 | HIGH | DONE | `f0eba66` | [03a §3.3 profile], RF 1 | |
| 6 | 2 | HIGH | TODO | | #16, #18, #19, #43, RF 4 | |
| 7 | 2 | HIGH | TODO | | #17, #31, F #1, #2, #5–#7, #10, BF-2 | |
| 8c | 2 | HIGH | TODO | | #51, #96, #115, #116, F #4, #8 | runs before 8 |
| 8 | 2 | HIGH | TODO | | #20–#23, #89, #91, #98, RF 2 | |
| 8a | 2 | HIGH | TODO | | #75, #80, #114 engine | |
| 8b | 3 | HIGH | TODO | | #49, #78, #81, #99, #101 engine, #111 engine, BF-6 | |
| 9 | 3 | HIGH | TODO | | #24, #25, #90 | |
| 10 | 3 | HIGH | TODO | | #26, #27 | |
| 11 | 3 | HIGH | TODO | | #28–#30 | |
| 13 | 3 | HIGH | TODO | | #44, F #3, #9, #14, #15 | |
| 12 | 4 | HIGH | TODO | | #39, #41, #74 engine, #102, #117, #119, 01a #129, BF-12, BF-13 | |
| 12b | 4 | HIGH | TODO | | #40, #42, #84, #87, #88, #104, #105, #109, #118, BF-1, BF-7, BF-8, BF-9 | |
| 14 | 4 | HIGH | TODO | | #32, #52, #62 engine, #110, #111 tick, F #12, #13, BF-5, RF 3 | |
| 15 | 4 | HIGH | TODO | | #35, #36, #92, #106, BF-3, BF-4, BF-10, BF-14 | |
| 15b | 4 | NORMAL | TODO | | #37, #38, #77 engine | |
| 16 | 5 | HIGH | TODO | | #34, #45, #97, #100, #107 engine, #108, F #11 | |
| 16b | 5 | NORMAL | TODO | | #33, #46–#48, #50 | |
| 17 | 5 | HIGH | TODO | | #53–#55, #94 | |
| 18a | 5 | NORMAL | TODO | | [03a §10.6 harness] | |
| 18 | 5 | HIGH | TODO | | §10.6 perf asserts | **GATE** |
| C1 | 6 | NORMAL | TODO | | [01a §5.2a] | cloud `0007_engine_config.sql` |
| C2 | 6 | NORMAL | TODO | | [01a §6.9 A-2–A-10] | |
| C3 | 6 | NORMAL | TODO | | [01a §6.9a], Q-v2.1-1, Q-v2.1-2 | |
| C4 | 6 | NORMAL | TODO | | [01a §6.13, §6.15] | |
| C5 | 6 | NORMAL | TODO | | [01a §4.3 V3] | |
| C6 | 7 | NORMAL | TODO | | [01b B-8], [01a §4.3 V3] | |
| C7 | 7 | NORMAL | TODO | | [01b B-6] | |
| C8 | 7 | NORMAL | TODO | | UI | |
| C9 | 7 | NORMAL | TODO | | UI | |
| 19 | 8 | NORMAL | TODO | | [03a §5.1] | hub `0007_engine.sql` |
| 20 | 8 | HIGH | TODO | | #57, #58, #64, #85, [00 H-1], RF 5 | |
| 21 | 8 | HIGH | TODO | | #61, #112 | |
| 22 | 8 | HIGH | TODO | | #60, #62 hub, #63, #71, #73, #79, #95, #111 hub | |
| 22a | 8 | HIGH | TODO | | #76, #82, #86, #93, #113, BF-4 hub | |
| 22b | 9 | NORMAL | TODO | | #83 | |
| 23 | 9 | NORMAL | TODO | | #65, #67, #72, #77 hub | |
| 24 | 9 | NORMAL | TODO | | #70 | |
| A14 | 9 | HIGH | TODO | | [01a §6.17, §6.17a, §6.18b A-14] | |
| R2 | 9 | NORMAL | TODO | | [00 H-5, H-6] | hub `0008_device_point_lane.sql` |
| R1 | 10 | NORMAL | TODO | | [01b B-1, B-2, B-3, B-5] | |
| R1b | 10 | NORMAL | TODO | | [01b B-4] | cloud `0008`, hub `0009_run_station.sql` |
| 25 | 10 | NORMAL | TODO | | #68 | |
| 25b | 10 | NORMAL | TODO | | #69 | |
| 26 | 10 | NORMAL | TODO | | #66 | |
| 27 | 11 | HIGH | TODO | | #59, #74 hub | |
| 28 | 11 | — | TODO | | manual | needs the pilot mini PC |
| 29 | 11 | — | TODO | | — | final review, as-built v1.1 draft |

## Deviations (AD-n, proposed)

| # | Task | Problem | Options | Choice | Why | Files |
|---|---|---|---|---|---|---|
| — | — | *(plan-time rows below are written to `docs/reviews/03a-auto-decisions.md` at the batch 1 checkpoint)* | | | | |
| AD-1 | C3 | Shape of `used_by` when archiving a point that active stations name | (a) 01a's floor shape `{ entity: 'station', ids }`; (b) a point-specific shape | (a) — developer ruling 2026-11-03 | Matches 01a v2.1 §6.9a Q-v2.1-2 and the floor → table precedent (§6.4); no new shape for the client | `apps/cloud/src/modules/restaurant/points.ts` (C3) |
| AD-2 | 12b | BF-9: held lines after a unit-changing `StockSet` | (a) re-reserve held lines in the new unit; (b) record the over-sell as an accepted cost | (a) — developer ruling 2026-11-03; a line whose count is not valid in the new unit goes full-cook (01a S41) | Keeps reserved ≤ on_hand in the new unit; S41 already defines the not-valid case | `packages/engine/src/stock.ts` (12b), extends #118 |
| AD-3 | 15, 29 | BF-10: "the order taker hears before the promise is blown" | (a) narrow the claim to Waada Guard (EDF / FIFO padding 0); (b) `level = min(T + slip_threshold_ms, P)` | (a) — developer ruling 2026-11-03; spec wording only, no code | Under EDF / FIFO the padding is 0 so the claim cannot hold; no behaviour change | as-built spec text (29); `[03a BF-10]` test in 15 |
| AD-4 | 4, 7 | Review Focus 1: a line whose `units` exceed the station's effective capacity (spec states no rule) | (a) occupy the whole capacity for one cook; (b) occupy the whole station for `ceil(units / capacity)` consecutive rounds | (b) — developer ruling 2026-11-03: the line holds all `capacity` for `cook_ms × ceil(units / capacity)`; a `warn { order_item_id, station_id, units, capacity }` is logged; tested | Real kitchens cook an over-size line in rounds; one cook would under-book the station | `packages/engine/src/profile.ts` (4), placement + warn (7; the warn is emitted outside the pure engine) |
| AD-5 | 3, 13 | §3.3 declares `loads: Record<LoadId, Load>` ("F §4.7 BatchStationState semantics") but never defines `Load` | (a) provisional shape from F §4.7, confirmed in task 13; (b) fix now; (c) opaque until 13 | (a) — controller ruling: `Load { load_id, program_id, order_item_ids, fire_ms, fired_at }` | F §4.7 carries the semantics; v3 unreleased, key set editable until 13 | `packages/engine/src/state.ts`, `test/state.test.ts` |
| AD-6 | 4 (follow-up), 7–8a, 12, 20, 21 | A profile underflow or a stock invariant breach in a fold: §3.7 says no stock fold throws (clamp at 0, `report` gets the breach, §6.1a `applyEvent(state, event, report?)`); task 4's `removeInterval` throws | (a) always clamp + `report`; (b) always throw; (c) a strict flag | (c) — developer ruling 2026-11-05: `@pos/engine` gets a strict flag. Tests run strict: an underflow or a stock breach throws. The hub runs non-strict: the value clamps at 0 and the breach is appended to `state.diagnostics` (`{ kind, event_id?, station_id?, stock_item_id?, detail }`), which the host logs at `warn` after commit and clears; replay never throws on these. `diagnostics` is not part of snapshots / checkpoints and is outside the `ENGINE_STATE_VERSION` key-set fixture. Controller: `applyEvent(state, event, opts?: { strict?: boolean })`, default strict; `diagnostics` replaces the `report` callback (§6.1a, §7.2 breach `warn` built from it) | Tests catch bookkeeping bugs loudly; the restaurant never stops on one | `packages/engine/src/{profile,state,apply-event}.ts`; hub reducer call sites (now); stock folds (12); host log + clear (20); snapshot exclusion (21) |
| AD-7 | 6–8, 16 | Removing a line from the profile must use exactly the booked interval and units (developer follow-up), but §3.3 `EngineLine` has no field for them; recomputing `occupancy(units, cap, cook)` after a capacity change gives a different interval | (a) store the booking on the line; (b) recompute from the capacity at booking time (not stored either) | (a) — controller ruling 2026-11-05: `EngineLine.booked: { start, end, units } \| null`, set at every `addInterval` of the line, used and cleared by its removal; v3 key set updated (unreleased) | Only (a) makes the removal exact; one field | `packages/engine/src/state.ts`, `test/state.test.ts`, the placing and removing folds |
| AD-8 | 6 | §3.3 has no place for `OrderPlaced.lines[]` engine fields until each `ItemAdded` arrives; `EngineOrder` has one `target_land_ms` / `promise_ms` while `OrderPlaced` has them per group; a writer-bug `ItemAdded` (null `serve_mode` / cook time, missing station, unlisted id) has no rule | placeholder line vs a new pending field; order T/P from the first group vs the max; throw vs no-op | Controller rulings 2026-11-05: (a) the line enters `lines` at `OrderPlaced` as a placeholder filled by its `ItemAdded`; **reader rule:** a line of an order with `awaiting > 0` that is still a placeholder is not yet a line (never placed, never in `unfired`); (b) order T/P = max over its groups (`recorded_at` with no groups); (c) writer bugs: strict throws; non-strict records `invalid_event` — a listed bad line still decrements `awaiting` and is dropped, so the rest of the order plans; an unlisted one changes nothing. The §3.3 absent-order `OrderLinesAdded` throw stays in both modes | No new state field; one bad line never stalls an order in the hub | `packages/engine/src/{plan,apply-event,state}.ts`, `test/lines.test.ts` |
| AD-9 | 8c | A pulled / early-fill line (`FireDispatched` before its planned `fire_ms`) packs from `max(fire_ms, t)` (§3.3), so it cannot start earlier than planned — the pull does nothing until then | (a) the fold sets `fire_ms = min(fire_ms, recorded_at)`; (b) pack from `fired_at` but sort by planned `fire_ms` | (a) — controller ruling 2026-11-05; the planned fire stays in the event's `due_at` | One field, one meaning (the line's fire); packing and order agree | `packages/engine/src/{apply-event,live}.ts`, `test/live.test.ts` |
| AD-11 | 8 | Void / remove `T' = min(T, loop)` for a group spread over several stations (§3.5.3 says "that station; the group's T may move earlier") | (a) pass 1 on that station, then the group's loop re-places its hidden lines on all their stations; (b) re-loop only that station's lines | (a) — controller ruling 2026-11-05: floor = pickup and the land of each sibling that cannot move; promise never moves; only the ended line's group is re-looped (other groups of the order are not) | Moving T earlier necessarily moves siblings on other stations; they only take free capacity | `packages/engine/src/{plan,replan}.ts`, `test/replan.test.ts` |
| AD-12 | 7, 8 | Two lines of one group on one station that cannot cook both at once are queued back to back (F §4.7 D36), but §3.2's `d = T − carry − cook − prep` ignores the queue: a later submit's pass 1 pushes the first line later and makes the second late (review of task 8, Critical), breaking §3.5.3 "at submit no line is late by construction" | (a) queued deadline; (b) keep the current slot as a fallback; (c) re-place same-station siblings as a chain; (d) spec bump first | (a) — **developer ruling 2026-11-05:** each line's deadline is its own slot in the queue (`d = slot end − cook − prep`, slot end ≤ `T − carry`), stored in `deadline_ms` and used by re-plans, slack and slips; recomputed when the group's T moves | The most correct; one formula changes (§3.2), folded at task 29 | `packages/engine/src/{plan,replan,apply-event}.ts` |

Plan-time proposals (plan "Plan decisions" and "BF placement"), to become AD rows at the named checkpoint:

- P-5 `liveInterval(state, order_item_id, t)` (spec writes `liveInterval(line, t)`) — batch 2.
- Review Focus 1 → ruled as AD-4 (rounds), above.
- BF-9 → AD-2; BF-10 → AD-3 (ruled 2026-11-03, above).
- P-11 re-placed-lines bound rule — batch 5 (task 18).
- P-12 `@pos/engine/sim` test-only subpath export — batch 5.

## Open items

1. Command halves of #101, #103, #107 (`409 RETURN_ALREADY_OPEN`), #114 → 02 (README "To 02" #1, #8).
2. No owner-app screen to assign `run_station` (01b v1.5 defines none); API only until specified — **carried to the UI module** (developer, 2026-11-03).
3. H-5 / H-6 write-time checks → 03b's pairing / binding UI (and 01e).
4. Task 28 needs the pilot mini PC (like 00 #79; developer, 2026-11-03).
5. 03a §12.3 Q12 (customer's own wrong order) still open; 02 / 04, not blocking.
6. **For 01a's next bump:** the §9 intro "the only allowed foundation edit" is stale (R34 lets a module append its §9 codes to F §6.2) — developer note 2026-11-05.

## Batch entries

*(one per checkpoint, newest last)*

```
## Batch N — <title> (<date>)

- **Tasks:** …
- **Commits:** `<sha>` (task), …
- **Reviews:** HIGH tasks: full opus review each; NORMAL: paired. Findings and fix commits.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — <files>, <tests>, <wall time>; perf project numbers (from task 18) copied into §7.1 above.
- **Tests closed:** …
- **AD rows (proposed):** …
- **Carried to later tasks:** …
- **Open items:** …
```

## Batch 0 — Setup (2026-11-03)

- **Tasks:** 0.
- **Commits:** `07cf818` (AD-1–AD-4 developer rulings, open items 2 and 4), `6fdf085` (task 0).
- **Reviews:** task 0 alone, one fresh opus reviewer: spec ✅, Approved, 0 Critical / 0 Important; 3 Minor (F §6.2 note has no ⚠️ prefix; 01a §9 `POINT_NOT_FOUND` row sits after the 409 / 422 rows; `_rules.md:8` glob `{{MOD}}_*_Spec_v1.*.md` misses v2.x module specs). No fix round.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — green: 304 files passed (1 skipped), 2014 tests passed (1 skipped), 10 m 14 s.
- **Tests closed:** — (no code).
- **AD rows (proposed):** AD-1 (`used_by` floor shape), AD-2 (BF-9 re-reserve, S41 full-cook), AD-3 (BF-10 wording only), AD-4 (units > capacity → `ceil(units / capacity)` rounds + warn).
- **Carried to later tasks:** —
- **Open items:** `_rules.md:8` glob; 01a §9 intro "the only allowed foundation edit" wording is stale (pre-existing; spec text, for task 29 / developer).

## Batch 1 — Events, errors, state, profile (2026-11-03)

- **Tasks:** 1, 1b, 2, 3, 4.
- **Commits:** `2b317b5` (task 1), `5b005d7` (task 1b), `0bde005` (task 2), `462eb21` (task 3), `8f112be` (task 3 review fix), `f0eba66` (task 4).
- **Reviews:** one fresh opus reviewer per task (task 4 HIGH: full opus review with its invariants; NORMAL tasks reviewed one per reviewer, not paired). All five: spec ✅, Approved, 0 Critical / 0 Important. One fix round: task 3 (Minor 1, nested inline types added to the v3 key-set guard, `8f112be`; test-only, re-checked by the controller). Minors noted, not fixed: task 1 fixture polish (return line's engine station when the served line used an alternate; `seq` collisions in `aReturnLinesAdded`; `anOrderBatch` override order); task 1b `Id` strictness frame vs events, `station_plan.fire_ms` nullable; task 2 envelope test builds the envelope itself; task 3 payload cast in `apply-event.ts`, a station missing from a later `EngineConfigApplied` keeps its runtime (reading); task 4 `removeInterval` throws below 0 (kept: loud beats silent corruption), preconditions documented not guarded.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — green: 309 files passed (1 skipped), 2075 tests passed (1 skipped), 12 m 26 s. The `perf` project has no file yet (`--project perf` alone exits 1 until task 18; `pnpm -w test` passes).
- **Tests closed:** #56, #103 fixture, #114 fixture; `[03a §4.2]`, `[03a §4.2 A-19]`, `[03a §3.6.3]`, `[03a §9]`, `[03a §3.11]`, `[03a §3.3 profile]` incl. AD-4.
- **AD rows (proposed):** AD-1–AD-4 (developer rulings, before batch 1), AD-5 (`Load` provisional, controller ruling at task 3). Written to `docs/reviews/03a-auto-decisions.md`.
- **Carried to later tasks:** 7 — emit the AD-4 `warn` (outside the pure engine); 7 / 8 / 16 — store the booked `{ interval, units }` on the line and remove exactly that (a capacity change must not recompute `occupancy` for a removal); 8a — the return-line fold takes `serve_mode 'immediate'` / no draws from `return_of`, and the engine station from the served line; 13 — confirm `Load` (AD-5); 16b — decide whether `station_plan.fire_ms` narrows to `number`; 20 — snapshot load checks the profile is canonical; a later client task — `errors.STATION_PAUSED` / `STATION_PAUSE_DISABLED` keys (03a §8 item 5).
- **Open items:** unchanged (1–5 above); item 2 carried to the UI module, item 4 needs the pilot mini PC.
