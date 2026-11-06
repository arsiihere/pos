# 03a status board

Plan: `docs/plans/03a-plan.md` (53 tasks, batches 0–11). Spec: `docs/specs/03a_Timing_Engine_Spec_v1.0.md`, with foundation v1.9, 00 v1.7 (H-1, H-5, H-6), 01a v2.1 (A-1–A-20; §12.3 Q-v2.1-1 / Q-v2.1-2 answered 2026-11-03), 01b v1.5 (B-1–B-8). Branch `module-03a`.

> **Short Hinglish summary — padhein yahan se**
>
> **Batch 2 ke baad (2026-11-05):** placement core ban gaya — lines, hold-and-fire, target / promise, stage folds, `liveInterval`, re-plan passes, return lines. Gate green. Aapka AD-12 (queued deadline) laga diya; re-plan ab 700 lines par ~6 ms. AD-7 se AD-11 controller ke rulings hain (dekh lein). Batch 3 ke liye "go" ka intezaar hai.

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
| 6 | 2 | HIGH | DONE | `f8826e6`, `0315dc1`, `316e9b6` | #16, #18, #19, #43, RF 4 | |
| 7 | 2 | HIGH | DONE | `ace2270` | #17, #31, F #1, #2, #5–#7, #10, BF-2 | |
| 8c | 2 | HIGH | DONE | `be5afc1`, `788c05d` | #51, #96, #115, #116, F #4, #8 | runs before 8 |
| 8 | 2 | HIGH | DONE | `aa1cc99`, `091b939` | #20–#23, #89, #91, #98, RF 2 | |
| 8a | 2 | HIGH | DONE | `8b2d209` | #75, #80, #114 engine | |
| 8b | 3 | HIGH | DONE | `35ffd9d` | #49, #78, #81, #99, #101 engine, #111 engine, BF-6 | |
| 9 | 3 | HIGH | DONE | `d1635e0` | #24, #25, #90 | |
| 10 | 3 | HIGH | DONE | `5bbf64b`, `b127a44`, `c9ebfc2` | #26, #27 | |
| 11 | 3 | HIGH | DONE | `2aee7e5`, `169d155` | #28–#30 | |
| 13 | 3 | HIGH | DONE | `565dcd3`, `f61ad5d` | #44, F #3, #9, #14, #15 | |
| 12 | 4 | HIGH | DONE | `afb53ef`, `4b4eb7b` | #39, #41, #74 engine, #102, #117, #119, 01a #129, BF-12, BF-13 | |
| 12b | 4 | HIGH | DONE | `ea6056c`, `51ef84a` | #40, #42, #84, #87, #88, #104, #105, #109, #118, BF-1, BF-7, BF-8, BF-9 | **BF-9 parked** (`it.todo`), developer question |
| 14 | 4 | HIGH | DONE | `f75d453` | #32, #52, #62 engine, #110, #111 tick, F #12, #13, BF-5, RF 3 | |
| 14b | 4 | HIGH | DONE | `1eb33e7`, `9e893c9`, `9bcd50a` | #62 boundary clause, F D42, `[03a AD-20]` | added overnight: `ReservationsShifted` fold, exited orders kept while reserved |
| 15 | 4 | HIGH | DONE | `249f91d`, `663ca0a` | #35, #36, #92, #106, BF-3, BF-4, BF-10, BF-14 | |
| 15b | 4 | NORMAL | DONE | `4e5fd86`, `dc92693` | #37, #38, #77 engine | |
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
| AD-5 | 3, 13 | §3.3 declares `loads: Record<LoadId, Load>` ("F §4.7 BatchStationState semantics") but never defines `Load` | (a) provisional shape from F §4.7, confirmed in task 13; (b) fix now; (c) opaque until 13 | (a) — controller ruling: `Load { load_id, program_id, order_item_ids, fire_ms, fired_at }` **Final (task 13, proposed (implementer, overnight)):** `Load = { load_id, program_id, order_item_ids, fire_ms, booked }` — `booked` for AD-7 exact removal (member lines `booked: null`), `fired_at` dropped (a load leaves `loads` when it fires; members keep `fired_at` / `load_id`); a name collision falls back to a `:k` suffix (outside §3.3's form). | F §4.7 carries the semantics; v3 unreleased, key set editable until 13 | `packages/engine/src/state.ts`, `test/state.test.ts` |
| AD-6 | 4 (follow-up), 7–8a, 12, 20, 21 | A profile underflow or a stock invariant breach in a fold: §3.7 says no stock fold throws (clamp at 0, `report` gets the breach, §6.1a `applyEvent(state, event, report?)`); task 4's `removeInterval` throws | (a) always clamp + `report`; (b) always throw; (c) a strict flag | (c) — developer ruling 2026-11-05: `@pos/engine` gets a strict flag. Tests run strict: an underflow or a stock breach throws. The hub runs non-strict: the value clamps at 0 and the breach is appended to `state.diagnostics` (`{ kind, event_id?, station_id?, stock_item_id?, detail }`), which the host logs at `warn` after commit and clears; replay never throws on these. `diagnostics` is not part of snapshots / checkpoints and is outside the `ENGINE_STATE_VERSION` key-set fixture. Controller: `applyEvent(state, event, opts?: { strict?: boolean })`, default strict; `diagnostics` replaces the `report` callback (§6.1a, §7.2 breach `warn` built from it) | Tests catch bookkeeping bugs loudly; the restaurant never stops on one | `packages/engine/src/{profile,state,apply-event}.ts`; hub reducer call sites (now); stock folds (12); host log + clear (20); snapshot exclusion (21) |
| AD-7 | 6–8, 16 | Removing a line from the profile must use exactly the booked interval and units (developer follow-up), but §3.3 `EngineLine` has no field for them; recomputing `occupancy(units, cap, cook)` after a capacity change gives a different interval | (a) store the booking on the line; (b) recompute from the capacity at booking time (not stored either) | (a) — controller ruling 2026-11-05: `EngineLine.booked: { start, end, units } \| null`, set at every `addInterval` of the line, used and cleared by its removal; v3 key set updated (unreleased) | Only (a) makes the removal exact; one field | `packages/engine/src/state.ts`, `test/state.test.ts`, the placing and removing folds |
| AD-8 | 6 | §3.3 has no place for `OrderPlaced.lines[]` engine fields until each `ItemAdded` arrives; `EngineOrder` has one `target_land_ms` / `promise_ms` while `OrderPlaced` has them per group; a writer-bug `ItemAdded` (null `serve_mode` / cook time, missing station, unlisted id) has no rule | placeholder line vs a new pending field; order T/P from the first group vs the max; throw vs no-op | Controller rulings 2026-11-05: (a) the line enters `lines` at `OrderPlaced` as a placeholder filled by its `ItemAdded`; **reader rule:** a line of an order with `awaiting > 0` that is still a placeholder is not yet a line (never placed, never in `unfired`); (b) order T/P = max over its groups (`recorded_at` with no groups); (c) writer bugs: strict throws; non-strict records `invalid_event` — a listed bad line still decrements `awaiting` and is dropped, so the rest of the order plans; an unlisted one changes nothing. The §3.3 absent-order `OrderLinesAdded` throw stays in both modes **Developer condition 2026-11-06:** a dropped line is never silent — it is appended to `state.diagnostics` (AD-6); the host logs it at `warn` **and** raises a 01d `info` alert to managers (kind `engine_line_dropped`, values `{ order_id, order_item_id, reason }`, dedupe per `order_item_id`) — in task 22a's scope with its test. | No new state field; one bad line never stalls an order in the hub | `packages/engine/src/{plan,apply-event,state}.ts`, `test/lines.test.ts` |
| AD-9 | 8c | A pulled / early-fill line (`FireDispatched` before its planned `fire_ms`) packs from `max(fire_ms, t)` (§3.3), so it cannot start earlier than planned — the pull does nothing until then | (a) the fold sets `fire_ms = min(fire_ms, recorded_at)`; (b) pack from `fired_at` but sort by planned `fire_ms` | (a) — controller ruling 2026-11-05; the planned fire stays in the event's `due_at` | One field, one meaning (the line's fire); packing and order agree | `packages/engine/src/{apply-event,live}.ts`, `test/live.test.ts` |
| AD-10 | 8c | Stage folds the spec leaves unstated (§3.4 shows only the main transitions) | throw / diagnostic / no-op per case | Controller ruling 2026-11-05 (task 8c review): a stage event from the wrong stage (double Start from two tablets, Served twice, Undo after Served) is a silent no-op that returns `state` (§3.3 absent-id spirit; realistic duplicates, not writer bugs); Done is allowed from `added`; Undo with no `started_at` falls back to `done_at`; Removed / Voided allowed from `added`, `cooking`, `done` **Developer note 2026-11-06:** this fold-level ignore does not replace 03b's command-level `ITEM_WRONG_STAGE`; carried row To 03b (below). | Duplicates from real devices never fail a log | `packages/engine/src/apply-event.ts` |
| AD-11 | 8 | Void / remove `T' = min(T, loop)` for a group spread over several stations (§3.5.3 says "that station; the group's T may move earlier") | (a) pass 1 on that station, then the group's loop re-places its hidden lines on all their stations; (b) re-loop only that station's lines | (a) — controller ruling 2026-11-05: floor = pickup and the land of each sibling that cannot move; promise never moves; only the ended line's group is re-looped (other groups of the order are not) | Moving T earlier necessarily moves siblings on other stations; they only take free capacity | `packages/engine/src/{plan,replan}.ts`, `test/replan.test.ts` |
| AD-12 | 7, 8 | Two lines of one group on one station that cannot cook both at once are queued back to back (F §4.7 D36), but §3.2's `d = T − carry − cook − prep` ignores the queue: a later submit's pass 1 pushes the first line later and makes the second late (review of task 8, Critical), breaking §3.5.3 "at submit no line is late by construction" | (a) queued deadline; (b) keep the current slot as a fallback; (c) re-place same-station siblings as a chain; (d) spec bump first | (a) — **developer ruling 2026-11-05** (source checked 2026-11-06: the developer chose "Queued deadline" when asked during task 8; not an implementer ruling): each line's deadline is its own slot in the queue (`d = slot end − cook − prep`, slot end ≤ `T − carry`), stored in `deadline_ms` and used by re-plans, slack and slips; recomputed when the group's T moves | The most correct; one formula changes (§3.2), folded at task 29 | `packages/engine/src/{plan,replan,apply-event}.ts` |
| AD-13 | 8b | BF-6 says "abandon clock from `max(last_line_fold_at, latest planned land)`" while §10 test 111 says the order leaves "at `last_line_fold_at + order_abandon_ms`"; read literally they disagree for a fired, never-tapped line | (A) `max(fold, land) + order_abandon_ms`; (B) `max(fold + order_abandon_ms, land)` | (B) — controller ruling 2026-11-06: abandoned ⇔ no unfired line ∧ `t ≥ max(last_line_fold_at + order_abandon_ms, latest planned land)`; planned land over open lines = `(started_at ?? fire_ms) + prep + occupancy cook + carry` | Satisfies test 111 as written and BF-6's own test and aim (a long cook is never abandoned before it lands) | `packages/engine/src/lifecycle.ts` |
| AD-14 | 9 | §3.5.3 FIFO: "each new line is placed at `earliestFit(t)` in submit order; its target is that land time", but targets exist only per group; a sync group can span a FIFO station and another | (a) FIFO sync line placed like an immediate, its land a floor for the group's T; (b) each FIFO line its own group (contract change); (c) group T from non-FIFO lines only (FIFO line late at submit) | (a) — controller ruling 2026-11-06: listing order, `earliestFit(t)`, no hold, ignores `pickup_at_ms`; deadline = fire; group T ≥ every FIFO land (and ≥ pickup); padding 0 for FIFO stations; `replanEnded` never re-loops FIFO lines **Amended 2026-11-06 (task 11, proposed (implementer, overnight)):** with routing, each station's policy applies to the lines placed on it; a line whose allowed stations are all FIFO keeps this path; a mixed-option line may land on a FIFO station at its earliest fit (never held), placed after the batch's all-FIFO lines in `syncOrder` (not strict listing order); a re-plan never moves a line onto or off a FIFO station (§3.5.3). | No `OrderPlaced` shape change; nothing late at submit | `packages/engine/src/{plan,replan}.ts`, `test/policies.test.ts` |
| AD-15 | 10 | §3.5.6 is ambiguous: "EDF order on `d_Λ`, `latestFit(…, hi = d_Λ)`" read literally is not Lawler-optimal on one slot (a probe needs Λ = 1.2 M where 600 k suffices), though the spec says it is; also which lines are re-placed, the success test with capped lines, the 16-probe fallback and where `capped` lives | per question | Controller rulings 2026-11-06: (1) place backward — descending `d_Λ`, each at `latestFit(hi = d_Λ)`, keep off (execution order is then EDF on `d_Λ`; Lawler holds); (2) re-place the free hidden lines of the station's pass-1 set (pruned and void-held lines fixed); (3) success(Λ) = every line not at its cap fits; capped lines that do not fit go to `earliestFit` after the others; Λ = 0 probed first; (4) no Λ within 16 probes → the largest Λ probed, leftovers capped; `EngineLine.capped: boolean` **Amended 2026-11-06 (task 10 review):** (3) "if it still cannot fit" = after every uncapped line gives way — a capped line leaves the search only if it cannot fit by `d + max_late_ms` against the base with the uncapped lines removed (one extra pass over the capped lines, not a Λ probe); otherwise it is held at its cap. | Matches the spec's stated optimality; a line-level flag disappears with its line | `packages/engine/src/{overload,replan,state}.ts` |
| AD-16 | 10 | §3.5.6's `latestFit(hi = d_Λ)` also pushes lines that could be on time: one slot, A and B due 12:00, C due 12:30 → Λ = 10 min and C fires at 12:40 though 12:30 is free; in a rush Λ can reach hours (task 10 review, Important) | (a) forward compaction after the search; (b) try `hi = d` before `d_Λ`; (c) keep; (d) spec bump | (a) — **developer ruling 2026-11-06:** after the Λ search, walk the re-placed lines in execution order and move each one earlier, never later: its latest fit by its own deadline `d` if one exists, else the earliest fit no later than its current fire; the order the search chose is kept; `capped` is recomputed from the final placement | No line is ever later than the search put it; lines with room land on time; Λ and the one-slot optimality are unchanged | `packages/engine/src/overload.ts`, `test/overload.test.ts` |
| AD-17 | 11 | §3.5.5 routing leaves bookkeeping and edge cases unstated | per reading | **Proposed (implementer, overnight):** R1 a line's `station_id` is its current station and `alternates` the other allowed stations (swapped on a move); `routed_station_id` (= `ItemAdded.station_id`, the D25 home route) is the station never carry-filtered; R3 a hidden line re-routes only when it fits neither by `d − keep` nor by `d` on its own station, or the reserve shuts it out; R6 the reserve's home order types are read per line; R7 a placed line keeps its paused station, nothing moves onto one; R9 lines of different home stations sharing a station queue in home-id order; a re-routed line is fixed input on its target (takes only free capacity); reserve fallback: a new or placed line with no allowed station left books its own station at full capacity with a `reserve_fallback` diagnostic; a placed line that fits nowhere goes late at its earliest fit on the first allowed station. Spec-literal after review: the routed station is never carry-filtered, every alternate (a home one too) must pass carry; `checkOrderable` refuses `STATION_PAUSED` when the allowed set has no unpaused station. **For 02:** `OrderPlaced.lines[]` must copy `PlanResult.lines[]` `station_id`, `alternates`, `carry_ms` verbatim | Keeps the §3.5.5 filters exactly; planOrder = fold holds by construction | `packages/engine/src/{route,plan,replan,overload,state}.ts` |
| AD-18 | 13 | F §4.7 batch loads in the 03a profile model leave joins and overload unstated | per reading | **Proposed (implementer, overnight):** a load books the whole station once (F \"capacity = M items per load\", \"no overlap against any existing load\", F test 14); J1 joining needs the same copied cook time; J2 a joiner must be prepped by the load's start (`start − prep ≥ t`) and the load's fire becomes `min(fire, start − prep)`; J3 an immediate joins the earliest load only if it lands no later than a new load; J4 the pass-1 keep cushion applies to the freshness target; J5/J6 in the §3.5.6 search each formed load (and the late lines of one stored load) is one unit; J7 a unit's deadline = min over members of `d(m) + prep(m) − max prep`, the binding member gives weight / cap / tie-break (exact form would take the min over members' own `d_Λ` — revisit at task 18); L1 a partly started load packs as one interval; N1 a re-formed load keeps its old name | Keeps D14 / D49 batching in normal and overload re-plans | `packages/engine/src/{batch,plan,replan,live,apply-event,state}.ts` |
| AD-19 | 12 | §3.7 stock folds leave details unstated | per reading | **Proposed (implementer, overnight):** engine drafts are `StockReservedDraft` (event part only, no envelope); `reserveStock` reads each line's own `stock_draws` (`configStockUnits` unread); a `sold_out` line that does not fit is refused even when 0 < available < needed (**developer to confirm**: 02 greys out only at 0); a stock item not in `stockItems` reads available 0; a whole void keeps units and draws; over-reserving clamps and is a breach; a stock event naming a draw the line lacks is an AD-8 writer bug; frozen-or-fired = `fired_at` or `fire_ms ≤ t + freeze_ms`; `StockReserved` for an absent / dropped line is a no-op, release / consume for an absent line still move the entry; a partial void re-plans its group like a void (§3.5.3, AD-11); 01a #66 runs non-strict (a count below reserved not held by frozen / fired lines is a §3.7 breach); 12b: `stockEffects` also has an array form for one command (BF-8), a unit-changing `StockSet` consumes every holding line (Q14), hidden / frozen judged at the draft's `occurred_at`; **BF-9 / AD-2 not built** — see MORNING REPORT | Keeps §3.7 and AD-6 | `packages/engine/src/{stock,apply-event}.ts` |
| AD-20 | 14b | An exited order can be removed before its abandon / close release is written, so its reservation stays held for good (task 14 review); `ReservationsShifted` had no fold, so the hub would re-write the same shift every 500 ms | (a) keep an exited order while a line holds a reservation; (b) spec change | (a) — **Proposed (implementer, overnight):** the removal step skips an exited order while any line has `reserved_seq ≠ null`; every order-stream fold treats it as absent (`activeLine`), except `OrderLinesAdded`, which re-opens it as a present order (§3.3, test 78); stock folds still find its lines; `noOrderInEngine` gains §3.6.1's second clause. The `ReservationsShifted` fold moves each listed unfired line / load by `by_ms` (F §4.7 D42), deadline and T unchanged, no re-plan; fired / started / absent targets skipped; a line on another station or a load with two `by_ms` (`shift_conflict`) is an AD-8 writer bug | Keeps §3.3 "removal never changes a result", §3.6.1, §3.7 close row, test 62 | `packages/engine/src/{apply-event,lifecycle,tick}.ts` |
| AD-21 | 14, 15 | Tick and slip details the spec leaves open | per reading | **Proposed (implementer, overnight):** tick: one `FireDispatched` per (station, planned fire), one per load (whole); a firing load pulls in lines by placement's join rule at now; auto-fill fits against others' planned bookings; inferred start at the pass's now, followed by its `StockConsumed`; the cascade shifts only unfired bookings, due at the first ms of overlap; `nextDueAt` tests listed candidate instants (a window opening between them is found ≤ 500 ms later); Waada Guard auto-fill urgency = `deadline_ms − fire_ms ≤ keep` (alternative `d − now ≤ keep`). Slip: R1 an estimate already over the level counts from the order's `placed_at` (spec: "the fold's recorded_at") so per-key = full recompute; R2 crossing = level − prep − cook − carry + 1; R3 only sync groups slip; R4 a slip resolves on its own `order_ids` (spec: "every group of the key"); R5 BF-4 due = latest AD-13 exit; R6 promise in the slip item = group T + the order's padding; R7 overload lists every station, `capped` read on unfired lines, pressure floored in bp; R8 touched keys by input / output comparison | Keeps §3.6.1, §3.8; R1, R4 replace literal wording (fold at task 29) | `packages/engine/src/{tick,slip,pressure}.ts` |
| AD-22 | 15b | `ItemsReleased` / goes-with details | per reading | **Proposed (implementer, overnight):** only open sync lines take part (a line in both lists = released); each leaving line becomes immediate in its own group `order_id:<next_group_index>`, an emptied group is removed, order T / P stay; an expedite line is placed by one pass 1 with the expedite lines held at their old bookings, then moved to its earliest fit only if that lands earlier (never later, task 15b review); queued deadlines of a changed group recomputed at its old T; a released line's new group keeps the source T; `goesWith`: the most specific row wins (item over category, then target item over category), an exclude wins a tie; `planRelease` pre-ticks nothing — **the caller (task 22a's `apply` / 02) computes the D12 goes-with pre-ticks** from snapshot V3 `goes_with[]` + `ItemAdded.item_id` / `category_id` and passes them as `ticks.expedite` (goes-with is not in `EngineConfigApplied`, §3.11) | Keeps D11 / D12 and §3.8 | `packages/engine/src/{slip,apply-event,plan}.ts` |

Plan-time proposals (plan "Plan decisions" and "BF placement"), to become AD rows at the named checkpoint:

- P-5 `liveInterval(state, order_item_id, t)` (spec writes `liveInterval(line, t)`) — batch 2.
- Review Focus 1 → ruled as AD-4 (rounds), above.
- BF-9 → AD-2; BF-10 → AD-3 (ruled 2026-11-03, above).
- P-11 re-placed-lines bound rule — batch 5 (task 18).
- P-12 `@pos/engine/sim` test-only subpath export — batch 5.

## Carried rows (to README at task 29)

| To | Row | Source |
|---|---|---|
| 03b | The engine's fold ignores a stage event from the wrong stage (AD-10: duplicate taps never fail a log). That does **not** replace 03b's command-level check: `StartItem` / `DoneItem` / `UndoDone` / `MarkServed` still answer `409 ITEM_WRONG_STAGE` from the current stage before appending (foundation §4.2 stage guard). | AD-10, developer 2026-11-06 |

## Open items

1. Command halves of #101, #103, #107 (`409 RETURN_ALREADY_OPEN`), #114 → 02 (README "To 02" #1, #8).
2. No owner-app screen to assign `run_station` (01b v1.5 defines none); API only until specified — **carried to the UI module** (developer, 2026-11-03).
3. H-5 / H-6 write-time checks → 03b's pairing / binding UI (and 01e).
4. Task 28 needs the pilot mini PC (like 00 #79; developer, 2026-11-03).
5. 03a §12.3 Q12 (customer's own wrong order) still open; 02 / 04, not blocking.
6. **BF-9 / AD-2 (developer question, see the batch 4 entry):** not built; `it.todo('[03a BF-9]')`.
7. **Done or Served without a Start on a from-stock line (developer question):** no consume is written, so its units stay reserved until the abandon pass (up to `order_abandon_ms`, default 4 h) or the next close; the spec has no consume at Done.
8. **For 01a's next bump:** the §9 intro "the only allowed foundation edit" is stale (R34 lets a module append its §9 codes to F §6.2) — developer note 2026-11-05.

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

## Batch 2 — Placement core (2026-11-05)

- **Before task 6:** `cfaff6a` (autobuild spec lock matches every current version), `aba023e` (AD-6 recorded, open item 6), `6420934` (AD-6 code: strict flag, `state.diagnostics`, `removeInterval` underflow), `f9cf4a9` (AD-7).
- **Tasks:** 6, 7, 8c, 8, 8a.
- **Commits:** `f8826e6`, `0315dc1`, `316e9b6` (task 6 + 2 fix rounds), `ace2270` (task 7), `be5afc1`, `788c05d` (task 8c + AD-9 fix), `aa1cc99`, `091b939` (task 8 + review fix), `8b2d209` (task 8a); docs `2217837` (AD-8), `b29838f` (AD-9), `adfa6f0` (AD-11, AD-12).
- **Reviews:** a fresh opus reviewer per task (all HIGH), AD-6 reviewed as its own task. Results:
  - AD-6: Approved, 0 C / 0 I.
  - Task 6: Approved; one ruling-level Important (a bad `ItemAdded` stalled its order in non-strict mode) → fixed in round 2 with Minors (duplicate `ItemAdded`, null stock time, group ids); scoped re-review Approved. Round 1 was the controller's pre-review ruling (writer bugs → diagnostics).
  - Task 7: Approved, 0 C / 0 I; the fold re-running hold-and-fire at `recorded_at` confirmed against §3.5.1 / §3.5.3 (brute-force probe).
  - Task 8c: Approved, 0 C / 0 I (after the AD-9 pre-review fix).
  - Task 8: **Needs fixes** — Critical: a D36-queued group made late by an unrelated submit (spec gap in §3.2's deadline) → developer ruling AD-12 (queued deadline); Important: over-capacity deadline (AD-4) and re-plan cost (49 ms median on 700 hidden lines) → fixed in one round (5.7–7.3 ms median); re-review Approved.
  - Task 8a: Approved, 0 C / 0 I.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — green: 315 files passed (1 skipped), 2164 tests passed (1 skipped), 11 m 36 s.
- **Tests closed:** #16, #17, #18, #19, #20, #21, #22, #23, #31, #43, #51, #75, #80, #89, #91, #96 (live half), #98, #114 engine, #115 (live half), #116; F #1, #2, #4, #5, #6, #7, #8, #10; `[03a BF-2]`, Review Focus 1 (placement), 2, 4 (placement half); `[03a AD-4]`, `[03a AD-6]`, `[03a AD-9]`, `[03a AD-12]`.
- **Coverage split (controller):** #96 and #115's moved bookings after a late Start → `[03a #96 shift]` / `[03a #115 shift]` in task 16b (`lateStartShift`); #96's `getTickIntents` sameness → `[03a #96 tick]` in task 14.
- **AD rows (proposed):** AD-6 (developer), AD-7 (`booked` on the line), AD-8 (placeholder lines, order T / P, writer-bug `ItemAdded`), AD-9 (a fired line packs from its actual fire), AD-10 (stage-fold choices), AD-11 (void re-plan across stations), AD-12 (developer: queued deadline). **AD-6 and AD-12 change spec text** (§6.1a `report?` → `opts`; §3.7 "no stock fold throws" holds only non-strict; §3.2 deadline) — fold at task 29.
- **Carried to later tasks:** 8b — `last_line_fold_at` for `ItemReturned`, a return re-opening `last_served_at`, duplicate deal / no-station `ItemAdded` double-decrement, `listLines` ignoring ids not in `order_item_ids`, `FireDispatched` ignoring `payload.station_id` and naming a line of an order still awaiting, stream-id checks; 10 — the late-set stub's lateness; 11 — alternates use the unqueued `T_min − carry` in the pivot; 12 — `[03a #75]` `reserveStock` / `stockEffects` (incl. the `StockAdded` path) draft nothing for a return line, `StockReserved` for a dropped line is tolerated, strict / non-strict stock breach (AD-6); 14 — `[03a #96 tick]`; 16 / pull / boost — a return line keeps `mark 'return'` (its follow-up weight depends on it); 16b — `[03a #96 shift]`, `[03a #115 shift]`; 18 — remaining O(m²) array spreads in `holdAndFire` / `planNewLines`; 20 — log `diagnostics` at warn after commit and clear (hub restart tests compare a strict rebuild with live state); 21 — snapshots exclude `diagnostics`; 02 — `OrderPlaced.order_item_ids` listed in `proposed.lines` order.
- **Spec notes for task 29:** the D36 lower-bound gap is closed by AD-12; §3.7 / §6.1a / §3.2 wording per AD-6 / AD-12.
- **Open items:** 1–6 unchanged.

## Batch 3 — Lifecycle, policies, overload, routing, batch loads (2026-11-06)

- **Before batch 3:** `04d574f` (AD-8 developer condition → task 22a `engine_line_dropped`; AD-10 carried To 03b; AD-12 source checked = developer).
- **Tasks:** 8b, 9, 10, 11, 13.
- **Commits:** `35ffd9d` (8b), `d1635e0` (9), `5bbf64b`, `b127a44`, `c9ebfc2` (10 + 2 fix rounds), `2aee7e5`, `169d155` (11 + fix), `565dcd3`, `f61ad5d` (13 + fix); docs `55a6869` (AD-13), `35be27a` (AD-14), `52adc16` (AD-15), `94b1ca3` (AD-15 amended, AD-16).
- **Reviews:** a fresh opus reviewer per task (all HIGH).
  - 8b: Approved, 0 C / 0 I (after the AD-13 NEEDS_CONTEXT ruling).
  - 9: Approved, 0 C / 0 I (after the AD-14 NEEDS_CONTEXT ruling).
  - 10: Needs fixes — Important: backward `latestFit(hi = d_Λ)` pushes lines that could be on time → **developer ruling AD-16** (forward compaction), fix round 1; re-review Important: `capped` flagged a cap-0 on-time line → fix round 2 (lateness > 0); clean.
  - 11: Needs fixes — Important: a new line could land on a paused station (§3.10); three readings (R2, R4, R5) narrowed §3.5.5 rules → fix round 1 made them spec-literal (routed station never carry-filtered, reserve applies to the own station, FIFO-match filter dropped); re-review Approved.
  - 13: Needs fixes — Important: a joiner with more prep was refused (F step 3(a)); the overload search dropped batching → fix round 1 (prep-ready join, loads as units in the Λ search); re-review Approved.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — green: 320 files passed (1 skipped), 2243 tests passed (1 skipped), 12 m 18 s.
- **Tests closed:** #24, #25, #26, #27, #28, #29, #30, #44, #49, #78, #81 (ids, load names, snapshot + replay; split part → 15b), #90, #99, #101 engine, #111 engine; F #3, #9, #14, #15; `[03a BF-6]`, `[03a §3.5.6]`, `[03a AD-14]`, `[03a AD-16]`, Review Focus 4 (exit half).
- **AD rows:** AD-13 (abandon clock), AD-14 (FIFO line in a group; amended for routing), AD-15 (overload search readings; amended), AD-17, AD-18, AD-5 final — controller / **proposed (implementer, overnight)**; AD-16 — **developer ruling**.
- **Carried to later tasks:** 12 — AD-6 applies to the stock folds (strict throws, non-strict clamps + diagnostic; this overrides the plan's "no fold throws / `report`" wording), `[03a #75]` `reserveStock` drafts nothing for a return line, `StockReserved` for a dropped line tolerated; 14 — `[03a #96 tick]`, a partial `FireDispatched` / `ItemStarted` on an unfired load member over-books briefly, `packBatch` stale `load_id` on a COOKING member; 15b — drop `slips` / `slip_due` of removed orders, #81 split part; 16 — return line keeps `mark 'return'` (weight now from `return_of`), batch → slot config change with loads, capacity-drop version of the overload-load test, FIFO lines out of boost / capacity re-plans; 16b — pressure of a load with room, `[03a #96 shift]`, `[03a #115 shift]`; 18 — record the removal-scan cost, J7 unit weight (min over members' `d_Λ`), remaining O(m²) spreads, `tMin` max over a batch's groups; 20 / 22a — log diagnostics at warn and clear, dedupe `reserve_fallback`, `engine_line_dropped` alert; 24 — a FIFO → Waada Guard policy change keeps deadline = fire; 29 — spec notes (AD-6, AD-12 – AD-18 wording; follow-up weight from `return_of`); 02 — copy `PlanResult` route fields verbatim, `OrderPlaced.order_item_ids` in `proposed.lines` order, a batch line with no program → `InvalidEvent` mapping; 03b — `StartItem` / `pullEarly` on a batch station name the load; 01a / 02 — forbid two alternates both marked home. Known gaps: `live.ts` packs fired lines without the reserve.
- **Open items:** 1–6 unchanged.

## Batch 4 — Stock, tick, slip (2026-11-06)

- **Tasks:** 12, 12b, 14, 14b (added overnight), 15, 15b.
- **Commits:** `afb53ef`, `4b4eb7b` (12 + fix), `ea6056c`, `51ef84a` (12b + fix), `f75d453` (14), `1eb33e7`, `9e893c9`, `9bcd50a` (14b + 2 fixes), `249f91d`, `663ca0a` (15 + fix), `4e5fd86`, `dc92693` (15b + fix); docs `6e0a5e7` (AD-19 – AD-22).
- **Reviews:** a fresh opus reviewer per task.
  - 12: Needs fixes — Important: a partial void kept T (dropped §3.5.3 `T' = min`, AD-11) → round 1, a partial void re-plans its group like a void; Approved.
  - 12b: Needs fixes — Important: a `StockAdded` candidate filter §3.7 does not state → round 1 removed it (+ 3 Minors); Approved. BF-9 parked (below).
  - 14: Approved, 0 C / 0 I; found two plan-level gaps no task owned → task 14b.
  - 14b: Needs fixes — Important: a kept exited order was resurrected by a stage fold → round 1 (`activeLine` guard); re-review Important: `OrderLinesAdded` on a kept order threw, against §3.3 / test 78 (**caused by the controller's instruction in round 1**, and it could have stopped boot replay) → round 2, it re-opens; Approved.
  - 15: Needs fixes — Important: the slips drop at `BusinessDayClosed` had no test → round 1 (+ stronger oracle, abandon-time touch); Approved.
  - 15b: Needs fixes — Important: an expedited line could land 10+ min later than its sync slot (78 / 648 probe combinations) → round 1 (held at the old booking, moved only if earlier; probe now 0 / 648); Approved.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — green: 326 files passed (1 skipped), 2348 tests passed (1 skipped, 1 todo = `[03a BF-9]`), 10 m 11 s. **Power cut during the first run:** the process was killed mid-gate; `git fsck` clean, no uncommitted code, nothing stashed, no task in progress. The re-run failed at `ECONNREFUSED 127.0.0.1:5433` before any test (the `pos-pg-test` container did not survive the cut; typecheck and lint had passed); `docker start pos-pg-test` per `docs/manual-test-e2e.md`, then green. No code change.
- **Tests closed:** #32, #35, #36, #37, #38, #39, #40, #41, #42, #52, #62 engine, #74 engine, #75 (reserve half), #77 engine, #81 (split part), #84, #87, #88, #91 (slip half), #92, #96 tick, #102, #104, #105, #106, #109, #110, #111 tick, #117, #118, #119; 01a #129; F #12, #13; BF-1, BF-3, BF-4, BF-5, BF-7, BF-8, BF-10, BF-12, BF-13, BF-14; Review Focus 3. **Not closed: BF-9.**
- **AD rows:** AD-19, AD-20, AD-21, AD-22 — all **proposed (implementer, overnight)**.
- **Developer questions:**
  1. **BF-9 vs tests #42 / #118.** AD-2 (yours) says re-reserve held lines in the new unit after a unit-changing `StockSet`. Tests #42 and #118 say those lines are consumed before the `StockSet` (Q14) and "their later `ItemStarted` drafts no `StockConsumed`". Re-reserving would make that later Start consume, so building AD-2 changes behaviour the spec states; it also needs `item_id` and the sale quantity on `EngineLine`, a new-unit quantity in the `StockReserved` fold, and a meaning for "full-cook" on an already-consumed frozen line. **The code follows #42 / #118.** Not treated as stop condition 2 because the code and the spec agree; the conflict is between the ruling and the spec, and it is an isolated edge (a unit change at the open with from-stock lines carried over the close). A hidden full-cook line carried over such a unit change can also be reserved with its old-unit draw. Decide: rewrite #42 / #118 for AD-2, or take BF-9's other option (accepted cost).
  2. Done or Served without a Start on a from-stock line (open item 7): should it consume?
  3. AD-19: refuse a `sold_out` line when 0 < available < needed? 02 greys an item out only at 0, so a short line looks orderable and is then refused.
- **Carried to later tasks:** 16 / 16b — `lateStartShift` writes `ReservationsShifted` (`late_start`, the fold exists), `[03a #96 shift]`, `[03a #115 shift]`, reuse `pressureBp`, the bands and #48; 17 — #94 static set; 18 — add a 20-line `StockAdded` at peak (≈ 44 ms at 1 200 hidden lines on the dev box), record upkeep cost (+37 µs per event), memoise packing per (station, t) if re-plan p99 is tight; 20 — log diagnostics and clear; 22 — evaluate `noOrderInEngine` / `checkpoint_pending` after the pass's fold (test 111 "that pass"); 22a — `engine_line_dropped`, dedupe `reserve_fallback`, the D12 goes-with pre-ticks (AD-22); A14 / hub — use the array form of `stockEffects`; 03b — fire a whole load before a Start or pull on one of its lines; `GiveMeMore` on a `single_tap` line writes the inferred start; 29 — §3.7 "no fold throws" per AD-6, an A-row for S14 `StockSet` below reserved / 01a #66, §6.1f wording, Q14 prose, 03a line 340 "fired never moves".
- **Open items:** see Open items above (6, 7 new).
