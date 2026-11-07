# 03a Timing Engine — Implementation Plan (spec v1.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build module 03a: the pure `@pos/engine` v3 (state, occupancy profile, placement, re-plan, routing, overload, stock, tick and alert intents, views, checkpoint), the TypeScript simulator that gates the build, the 01a v2.1 cloud configuration it needs (points, station and item timing fields, branch engine settings, goes-with, snapshot schema 3), and the hub engine host (migration, boot steps 2 / 3 / 6, snapshots, checkpoint, the `fires` and `fires_alerts` ticks, kinds, config hook, two commands, one query, the `station_plan` part and frame), with the 00 v1.7 and 01b v1.5 rows they build on.

**Architecture:** Everything that decides time lives in `@pos/engine` as pure functions of `(state, event)` or `(state, now)`; the profile of each station is the timeline (D24) and every placement reads in-flight lines through one `liveInterval` (§3.3). The hub only folds events through `applyEvent`, writes tick intents as events in one transaction per tick (D44), and keeps a few in-memory host flags (§3.6, §3.10, §3.12). Replay = live because nothing reads a clock or config in a fold (P-2, P-8). The simulator (task 18) runs a generated R6 day on the real engine and is the gate for every task after it.

**Tech Stack:** the existing stack (CLAUDE.md): Node 22, Fastify 5, better-sqlite3 (hub), PostgreSQL 16 (cloud), React (owner app), Zod, Vitest. **No new dependency.**

**Spec:** `docs/specs/03a_Timing_Engine_Spec_v1.0.md` (cited "§x", tests "#n", foundation tests "F #n", build-time fixes "BF-n", §11 task numbers kept as this plan's task ids). With the bumps it made: foundation `docs/specs/00_Foundation_Spec_v1.9.md` ("F §x"), `docs/specs/00_Hub_Platform_Access_Spec_v1.7.md` ("00 §x", rows H-1, H-5, H-6), `docs/specs/01_Restaurant_Setup_Spec_v2.1.md` ("01a §x", rows A-1–A-20, §12.3 Q-v2.1-1 / Q-v2.1-2 answered 2026-11-03), `docs/specs/01b_Staff_Roles_Spec_v1.5.md` ("01b §x", rows B-1–B-8), `docs/specs/01c_Menu_Variants_Spec_v1.1.1.md` (`ItemAdded` v1, §4.3), `docs/specs/01d_Notifications_Requests_Spec_v1.1.1.md`. Simulator sources: `docs/stories/03a-sim/replay_cost.py`, `tandoor_sim.py`. **Read the cited section before each task**; this plan carries decisions, not the spec's text.

**Starting point:** 00, 01a (v2.0.1), 01b (v1.4.1), 01c (v1.1), 01d (v1.1) built. Branch `module-03a` (head `76402ad`). `@pos/engine` today has only the stock slice (`state.ts`, `stock.ts`, `apply-event.ts`, `version.ts` = 2; colocated `*.test.ts`; fixtures `packages/engine/fixtures/engine-{state,log}.v{1,2}.json`). No `order/` or `station/` event folder exists; `ItemAdded` has no schema file yet (01c C-1: 03a owns it). Hub boot step 3 is 01a's fold (`apps/hub/src/sync/boot-steps.ts`); the reducer is set at `apps/hub/src/lib/boot.ts:297`. Hub migrations end at `0006_alerts.sql`, cloud at `0006_menu_variants.sql`. The 03a error codes are **not yet** in F §6.2 nor in `packages/domain/src/errors.ts`.

## Markers

| Marker | Meaning |
|---|---|
| **RISK: HIGH** | Full per-task review by a fresh **opus** reviewer subagent against the cited spec sections, the task's tests and the Global Constraints, before the next task starts. The reviewer reads the diff, runs the task's test files, and checks the task's invariants line (in the task). Lesson 4 tiers: the profile / placement / re-plan core, replay / snapshot / checkpoint cut-over, stock reserve / release / consume, and both ticks (their pure halves included). |
| **RISK: NORMAL** | Paired review: two NORMAL tasks of one batch reviewed together by one fresh opus reviewer (or alone when the batch has one). |
| **Shared** | Touches `packages/domain`, `packages/events` or `packages/engine`. Land in order; never two Shared tasks in parallel. |
| **01a** / **01b** / **00** | Implements a row of that spec's bump (A-n, B-n, H-n). Changes another module's code: only the rows named. |
| **UI** | Client only (`apps/client`); implementer may be sonnet, reviewer opus. |
| **needs Docker Postgres** | The task's own command needs the cloud test database (port 5433). |
| **GATE** | Task 18. No task after it starts until its §7.1 numbers are measured, green and recorded in `docs/plans/03a-status.md`. |
| **Manual** | Needs a person and the pilot mini PC. |

## Global Constraints

Every task implicitly includes these. Values copied from the spec.

- **Agents:** implementers and reviewers run on **opus**; **UI** implementers may run on sonnet. No subagent spawns subagents.
- **Gate (per batch):** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` (test files type-checked, R31). Only the controller runs it, one run at a time. Implementers run only their task's files (`pnpm vitest run <file> …`, `pnpm --filter <pkg> typecheck typecheck:tests`). From task 18 on, `pnpm -w test` includes the `perf` project (P-4); its numbers are copied into the status board at every batch checkpoint.
- **TDD:** failing test first, run and record the failure, then implement. Names: `it('[03a #N] …')` for a §10 test (each N in exactly one task, Coverage table; a test split across layers is tagged `[03a #N engine]` / `[03a #N hub]` or `[03a #N fixture]`); `it('[03a F #N] …')` for foundation §4.7 tests 1–15; section-cited support tests `it('[03a §3.7] …')`, `[03a BF-n]`, `[01a §6.9a]`, `[01b B-4]`, `[00 H-5]`, `[01a #129]`.
- **"Done when"** in every task: its tests green, its package typecheck green, its invariants checked by the reviewer.
- **Commit:** one task per commit, only the task's files: `feat(03a): task N <title> [spec §x; tests #a, #b]`; 01a rows `feat(01a): task CN <title> [01a v2.1 §x; 03a §4.5 A-n]`; 01b rows `feat(01b): task RN … [01b v1.5 B-n; 03a §4.5]`; 00 rows `feat(00): task R2 … [00 v1.7 H-5, H-6; 03a §4.5]`. Review fixes are their own commits (`fix(03a): task N review …`).
- **Batch checkpoint:** after a batch's last task and reviews, the controller runs the gate, appends the batch entry to `docs/plans/03a-status.md` (tasks, commits, reviews, gate counts, tests closed, AD rows, open items, and from task 18 the §7.1 table), commits it alone (`docs(03a): checkpoint batch N`) and runs `git push origin module-03a`. Never push `main`.
- **Spec-first:** code and spec disagree → stop and ask (CLAUDE.md). A deviation found while building is a **proposed** `AD-n` row in `docs/reviews/03a-auto-decisions.md` (`AD-n | task | problem | options | choice | why | files`) and in the checkpoint; folded into the spec only at the as-built review (task 29). No silent change of an event payload, error code, API shape or merged migration.
- **Purity (§2.1, F §6.7):** `packages/engine/src` imports nothing from `node:*`, has no `Date.now()`, `performance.now()`, `Math.random()`, `ulid()`, timers or I/O; every time is the event's `recorded_at` or the caller's `t` / `now`; no function mutates its input (tests freeze inputs with `Object.freeze` deep helper). Hub code uses `clock.branchNow()` and `ids.next()`.
- **No hard-coded names (§10.4 AC7):** no item, station or role names in `packages/engine/src` (the existing `lint.test.ts` is extended).
- **Engine constants (in their owning file):** `ENGINE_STATE_VERSION = 3`; `ORDER_EXIT_AFTER_SERVED_MS = 1_800_000`; overload `≤ 16` probes; snapshot every **500** events, keep **2** per kind; checkpoint `checkpoint_schema: 1`, keep 2; tick pass 500 ms (01d's loop).
- **Config defaults** (01a v2.1 §5.2a; used by fixtures, the §4.4 stubs and the simulator): `policy 'waada_guard'`, `freeze_ms 120_000`, `min_slack_keep_ms 60_000`, `promise_padding_ms null`, pressure `900_000 / 8_000 / 10_000 / 300_000`, `pause_enabled false`, `lane_units null`, `reserve_units 0`, carry 0, no alternates; items `weight_pct 100`, `max_early_ms 60_000`, `max_carry_ms null`, `max_late_ms null`, `adjust_time_ms 180_000`; branch weights `100 / 200 / 200 / 200`, follow-up `300`; padding `180_000` ×4; `slip_threshold_ms 120_000`; `slip_escalate_ms 120_000`; `cascade_step_ms 60_000`; `min_gain_ms 60_000`; `table_lock_ttl_ms 600_000` (02's, not in `EngineConfigApplied`); `returns_boost true`; `order_abandon_ms 14_400_000`.
- **Errors (§9, F §6.2):** only catalogue codes via `DomainError`. New: `STATION_PAUSED` 409 `{ station_id }`, `STATION_PAUSE_DISABLED` 409 `{ station_id }`, `ORDER_NOT_IN_ENGINE` 409 `{ order_id }`, `RETURN_ALREADY_OPEN` 409 `{ order_item_id, return_order_item_id }`, and 01a's `POINT_NOT_FOUND` 404 (Q-v2.1-1). Reused: `400 VALIDATION_FAILED`, `403 PERMISSION_DENIED { reason: 'outside_scope' }`, `404 STATION_NOT_FOUND`, `409 CONFIG_IN_USE`, `409 CONFIG_NAME_TAKEN`, `422 CONFIG_REFERENCE_INVALID`.
- **Events:** every 03a event `schema_version: 1`, payloads exactly §4.2 (engine fields; writers may add fields later, never change these, P-9). `StockAdded` v2 gains optional `reason?: 'moved'` (A-19). No upcaster (§5.3).
- **Statement bounds (§10.5, asserted in every hub task):** `fires` idle 0 (no transaction, freeze-entry frames included), with work 0 reads + appends; `fires_alerts` idle 0 (also while a raised condition persists), with work 2 + ≤ 1 + 01d's `raiseMany` / `closeMany` bounds; boot step 2 = 2, step 3 = 4 replay + 2 `stock_version`, step 6 = 0; `stations-live` 0; hook 0 extra; catch-up parts 0; `GET /v1/sync/config` `200` ≤ **32** with the directory, ≤ **27** config-only (B-8).
- **Performance (§7.1):** re-plan per submit p99 ≤ **50 ms**; overload ≤ 16 probes inside it; `fires` / `fires_alerts` pass with work p99 ≤ **20 ms**; snapshot write ≤ **50 ms**; crash restart (≤ 500 events) ≤ **2 s**; full-day replay from a checkpoint ≤ **45 s**; 2-day replay ≤ **80 s**; `stations-live` ≤ **5 ms**. A re-plan slower than 50 ms is logged `warn { event_type, station_id, lines, ms }` (P-7).
- **Logging (§7.2):** tick errors `{ tick, err }`; stock breach `warn { event_id, stock_item_id, on_hand, reserved }` (+ `replay: true` at boot); boot `{ step, snapshot_seq, checkpoint_seq, events_replayed, ms }`; absent-id fold `{ event_type, order_id, order_item_id }` once; no order contents in logs.
- **Migrations:** merged migrations never edited. This plan adds hub `0007_engine.sql` (03a, task 19), `0008_device_point_lane.sql` (00 H-5/H-6, task R2), `0009_run_station.sql` (01b B-4, task R1b); cloud `0007_engine_config.sql` (01a, task C1), `0008_run_station.sql` (01b B-4, task R1b). An unmerged one may change only with an AD row.
- **Stubs (§4.4):** `tableOwners` → the order's `placed_by`; `lane_count = 1` in tests; Start / Done / Give me more / `ItemsReleased` from the table view / `SubmitOrder` exist **only as test fakes** under `apps/hub/test/engine/fakes.ts` (a fake `SubmitOrder` that calls `checkOrderable`, `reserveStock`, `planOrder` and appends the §4.2 batch). Nothing of 02, 03b, 04, 05 is built.
- **Wiring:** each hub task registers what it builds through `apps/hub/src/engine-host/index.ts` `registerEngineHost(app, deps)` (P-6), called once from `buildHubServer`; boot steps through `registerEngineBootSteps()` called from `main.ts` in place of `registerRestaurantBootSteps`' step 3.

## Plan decisions

| # | Decision | Where |
|---|---|---|
| P-1 | **Task ids = §11 numbers.** A §11 task split in two keeps its number plus a letter not used by §11 (`8c`, `12b`, `15b`, `16b`, `18a`, `25b`, `1b`); cloud 01a tasks are `C1`–`C9`; 01b / 00 row tasks `R1`, `R1b`, `R2`; one 01a hub task `A14`; the as-built review is `29`. §12.6's "Task" column (BF placement) therefore reads unchanged | Task list |
| P-2 | **§11 task 5 is dissolved.** F tests 1–15 live in `packages/engine/test/foundation.test.ts`, each written by the task that builds its behaviour (Coverage table). Writing all 15 first would leave a task whose tests cannot pass for 12 tasks | Coverage |
| P-3 | **Test placement (01c P-3, 01d P-2).** A §10 test goes in the first task where every part it needs runs. Tests whose subject is another module's command (#101, #103, #107's `409`, #114) are written here as **fixture halves**: the `@pos/events/testing` builders 02 will use emit the §3.8a / To 02 shape, and the engine folds it; the command halves stay in "To 02" #1, #8 (README carried rows) and are listed as open items | Coverage |
| P-4 | **Engine test layout and the `perf` project.** New engine tests go in `packages/engine/test/` (§7.3, §10.1); the existing colocated `src/*.test.ts` stay. `packages/engine/tsconfig.test.json` `include` gains `"test"`. Root `vitest.config.ts` `projects` gains `{ test: { name: 'perf', root: './packages/engine', include: ['test/sim/**/*.perf.test.ts'], testTimeout: 600_000 } }`; the engine project excludes `test/sim/**/*.perf.test.ts`. `pnpm -w test` runs every project, so the CI gate includes `perf` (§10.6). Implementers run `pnpm vitest run --project perf` only in tasks 18 and later. *Amended in task 18:* the `perf` project also sets `maxWorkers: 1`, `fileParallelism: false` and `sequence: { groupOrder: 1 }`: its wall-clock numbers come from one file at a time, after every other project | tasks 3, 18 |
| P-5 | **`liveInterval` signature.** §3.3 writes `liveInterval(line, t)`; the per-station packing of fired-not-started lines needs the station, so the export is `liveInterval(state, order_item_id, t): Interval \| null`. Same meaning; proposed AD row at batch 2 | task 8c |
| P-6 | **Host layout** (§7.3 list plus three files it does not name): `apps/hub/src/engine-host/{index,host-flags,reducer,replay}.ts` beside the listed `{fires-tick,fires-alerts-tick,station-plan,boot-steps,snapshots,kinds,config-hook}.ts`. `host-flags.ts` holds `configStale`, `checkpoint_pending`, `day_closed`, `reconcile`, `skipped`, `overload_open`, `red_since`, `last_pass_ms` (all in memory, reset at boot) | tasks 20–26 |
| P-7 | **Touched stations without an API change.** `applyEvent` copies only the stations it touches (§3.3), so the host finds them by reference: `touchedStations(prev, next) = ids where prev.stations[id] !== next.stations[id]`. It feeds the `station_plan` frames (§3.6.3) and the re-plan `warn` (§7.1: `lines` = unfired lines of those stations, `ms` = the fold's time) | tasks 20, 22b |
| P-8 | **Checkpoint body helper.** `toCheckpoint(state, last_seq): EngineCheckpointV1` lives next to `fromCheckpoint` in `checkpoint.ts`; it is used only by 03a's host (not a §4.2 contract) | task 17 |
| P-9 | **01b / 00 rows before the tasks that need them** (the brief's order lists them last): H-1 lands in task 20 (§11 names it there); B-1–B-5 (permissions, `run_station`) land in batch 10 right before the commands; H-5 / H-6 have no 03a reader and land in batch 9. B-6 (settings endpoint fields) and B-8 (sync bound) land with the 01a cloud tasks C7 and C6 that make them true | Task list |
| P-10 | **Spec text the build owes, done in task 0 before the deny list locks the files:** append to F §6.2's 404 / 409 rows the four 03a codes (§9) and `POINT_NOT_FOUND`; append `POINT_NOT_FOUND` to 01a §9 (each "no bump, R34"). BF-11's stale-text items (§12.3 rows, To 02 label, §9 abandon wording) go to the as-built spec (task 29), not into v1.0 | tasks 0, 29 |
| P-11 | **Re-placed-lines CI bound (§7.1 row 2, DoD 6).** Task 18 measures p50 / p99 / max of lines re-placed per station re-plan on the generated day; the bound asserted from then on is `ceil(1.2 × measured p99 / 10) × 10`, written into this plan's "Simulator bounds" section and the status board in task 18's commit. The 50 ms p99 stays the real gate; a miss stops the build for a spec bump (§7.1, §12.5) | task 18 |
| P-12 | **Simulator reuse in hub tests.** `packages/engine/package.json` `exports` gains `"./sim": "./test/sim/index.ts"`; only test files import it (the engine `lint.test.ts` asserts no `src` file does). Tasks 21 and 27 build design-size states and mixed days from it | tasks 18a, 21, 27 |

## Changes to today's code (read before the named task)

| Code today | Change | Task |
|---|---|---|
| `packages/engine/src/version.ts` `ENGINE_STATE_VERSION = 2`; `state.ts` stock + `business_day` only | `= 3`; `EngineState` v3 (§3.3) with `config`, `stations`, `orders`, `lines`, `slips`, `next_alert_due_at`, `slip_due`; `initialEngineState()` returns them empty / null | 3 |
| `apply-event.ts:31` throws `StockAdded unit mismatch` | no throw: entry unchanged, one breach to `report` (BF-13, A-20); `stock.test.ts:91` and 01a #129 re-baselined | 12 |
| `applyEvent(state, event)` | `applyEvent(state, event, report?)`; a case per type of `ENGINE_REPLAY_EVENTS`, nothing else | 3 → 17 |
| `apps/hub/src/sync/boot-steps.ts` step 3 fold over `stock` + two `hub` types, `stock_version` from the same scan | removed; 03a's steps 2 / 3 / 6 in `engine-host/boot-steps.ts`; `stock_version` from 2 statements on `events_branch_stream` (A-15, A-17) | 20 |
| `lib/boot.ts` `BootContext { config, db, app?, initialState? }`; step 8 `HubStarted.missed_fires: 0` | gains `clock?: Clock` (set after step 3a) and `missedFires?: number` (H-1); step 8 uses `ctx.missedFires ?? 0` | 20 |
| `lib/boot.ts:297` `state.setReducer(applyEvent)` | `state.setReducer(engineReducer)` from `engine-host/reducer.ts` (breach logger, absent-id log, touched stations, slow re-plan warn) | 20 |
| `sync/stock-version.ts` `STOCK_VERSION_EVENTS` | gains `StockReserved`, `StockReleased`, `StockConsumed` (A-17) | 20 |
| `commands/set-precooked-stock.ts`, `add-precooked-stock.ts`, `close-business-day.ts` | append `stockEffects` drafts (A-14) | A14 |
| `@pos/events/src/config.ts` snapshot schema 2 | schema 3 only (`BranchConfigSnapshotSchemaV3`, `SNAPSHOT_SCHEMA_VERSION = 3`); hub refuses other versions (01a S28 b) | C5 |
| `StaffDirectory.stationsOf(staff, 'count_stock')` (`auth/staff-directory.ts:289`) | parameter `'count_stock' \| 'run_station'` (B-4) | R1b |

## Review Focus

Inputs the spec implies but no §10 test exercises. Each has a test in the named task.

1. **A line whose units exceed the station's effective capacity** ("Roti × 4" on a tawa of capacity 3, or after a lane Off to 1): `latestFit` / `earliestFit` terminate (no infinite scan), the line is placed when nothing else occupies the station (it occupies the whole capacity), the order gets a finite `T` and promise, and the case is a proposed AD row (the spec states no rule) → task 4 (profile), task 7 (planOrder).
2. **Ties on `recorded_at` and `fire_ms`**: one append batch stamps every event with one `recorded_at`, and two lines on different stations share a `fire_ms`: `getTickIntents` orders by `(station_id, fire_ms, order_item_id)`, live = replay over 50 seeds with forced equal stamps → task 8.
3. **`now` earlier than the last folded `recorded_at`** (an NTP step back, 00 `ClockAlarm`): `getTickIntents(state, now)` and `liveInterval` with `now < fired_at` or `now < started_at` do not throw, yield no negative interval, and never fire a fired line again → task 14.
4. **An order with no plannable line** (every line a `deal` line or `station_id` null): `awaiting` reaches 0, nothing is placed, `planOrder` returns empty `groups` and `lines`, no throw, and the order exits by the served rule → task 6.
5. **A snapshot or checkpoint the build cannot read** (an `engine_snapshots` row with `engine_version = 4` from a rolled-back release; a checkpoint with `checkpoint_schema = 2`; a truncated `state_json`): step 2 skips it with one log line and falls back (second row, checkpoint, seq 0), boot completes → task 20.

---

## Interfaces (later tasks rely on these exact names)

**Domain — `packages/domain` (task 2):** `ERRORS` gains `STATION_PAUSED: { status: 409 }`, `STATION_PAUSE_DISABLED: { status: 409 }`, `ORDER_NOT_IN_ENGINE: { status: 409 }`, `RETURN_ALREADY_OPEN: { status: 409 }`, `POINT_NOT_FOUND: { status: 404 }`. Task R1: `PERMISSIONS` / `PERMISSION_CATALOGUE` gain `manage-stations` (group `kitchen`, scopes `branch`, `my_stations`) and `mark-served` (group `orders`, scopes `branch`, `own_tables`, `my_floors`); `RESPONSIBILITIES = ['count_stock', 'run_station'] as const` (task R1b).

**Events — `packages/events` (tasks 1, 1b):**
- `src/events/order/*.v1.ts`: `OrderPlaced`, `OrderLinesAdded`, `ItemAdded` (01c §4.3 exactly), `ItemReturned`, `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ItemServed`, `ItemRemoved`, `ItemVoided`, `ItemMovedToStock`, `OrderBoosted`, `ItemsReleased`, `SlipWarned`. `src/events/station/*.v1.ts`: `FireDispatched`, `ReservationsShifted`, `EngineConfigApplied`, `StationCapacitySet`, `StationPauseSet`. `src/events/stock/`: `StockReserved.v1.ts`, `StockReleased.v1.ts`, `StockConsumed.v1.ts`; `StockAdded.v2.ts` gains `reason?: 'moved'`. Payload types `<Name>Payload`; `EngineConfig = EngineConfigAppliedPayload` (§3.11 list exactly, stations sorted by `station_id`).
- `src/ws.ts`: server frame `{ type: 'station_plan', station_id, as_of_seq, lines: [{ order_item_id, order_id, fire_ms, deadline_ms, mark, frozen }] }`.
- `@pos/events/testing`: `anOrderPlaced(o?)`, `anItemAdded(o?)`, `anOrderLinesAdded(o?)`, `aReturnLinesAdded(served, mode)` (§3.8a shape: zero money, `line_kind 'item'`, links null, `options []`), `anItemStarted(o?)`, `anItemDone(o?)`, `aFireDispatched(o?)`, `anEngineConfigApplied(o?)` (config defaults above), `aStockReserved(o?)`, `aStockReleased(o?)`, `aStockConsumed(o?)`, `anOrderBatch(spec)` (the §4.2 batch order: `OrderPlaced`, `ItemAdded` × n in `order_item_ids` order, `StockReserved`, one `recorded_at`).

**Engine — `packages/engine/src` (tasks 3–18):**

```ts
// version.ts / state.ts (task 3)
export const ENGINE_STATE_VERSION = 3;
export interface EngineState { /* §3.3 exactly */ }  // + StationRuntime, EngineOrder, EngineLine, SlipRecord
export type Interval = { start: number; end: number };
export type BreachReport = (b: { event_id: string; stock_item_id: string; on_hand: number; reserved: number }) => void;
export function initialEngineState(): EngineState;
// replay-events.ts (task 3; static check #94 in task 17)
export const ENGINE_REPLAY_EVENTS: { order: readonly string[]; station: readonly string[]; stock: readonly string[]; hub: readonly string[] };
// apply-event.ts
export function applyEvent(state: EngineState, event: PosEvent, report?: BreachReport): EngineState;
export function buildEngineState(events: Iterable<PosEvent>, report?: BreachReport): EngineState;
// profile.ts (task 4) — immutable; integer ms; cap = effective capacity for this line
export type Profile = { t: number[]; u: number[] };
export function addInterval(p: Profile, iv: Interval, units: number): Profile;
export function removeInterval(p: Profile, iv: Interval, units: number): Profile;
export function latestFit(p: Profile, lo: number, hi: number, prep: number, cook: number, units: number, cap: number): number | null; // fire time
export function earliestFit(p: Profile, lo: number, prep: number, cook: number, units: number, cap: number): number;           // fire time
export function bookedUnitMs(p: Profile, from: number, to: number): number;
// lifecycle.ts (task 8b)
export const ORDER_EXIT_AFTER_SERVED_MS = 1_800_000;
export function isOrderInEngine(state: EngineState, order_id: string, t: number): boolean;
export function noOrderInEngine(state: EngineState, t: number): boolean;
// live.ts (task 8c)
export function liveInterval(state: EngineState, order_item_id: string, t: number): Interval | null;  // P-5
// plan.ts / replan.ts (tasks 6–8, 9, 10, 11, 13)
export type ProposedOrder = { /* §4.2 exactly */ };
export interface PlanResult { groups: Array<{ group_id: string; target_land_ms: number; promise_ms: number; order_item_ids: string[] }>;
  lines: Array<{ order_item_id: string; station_id: string; alternates: Array<{ station_id: string; carry_ms: number; home: boolean }>; point_id: string | null; carry_ms: number; from_stock: boolean; eta_ms: number }> }
export function checkOrderable(state: EngineState, proposed: ProposedOrder): void;                       // throws DomainError('STATION_PAUSED')
export function planOrder(state: EngineState, proposed: ProposedOrder, now: number, from_stock: Readonly<Record<string, boolean>>): PlanResult;  // BF-2
export function calculateETA(state: EngineState, proposed: ProposedOrder, now: number, from_stock?: Readonly<Record<string, boolean>>): PlanResult;
// stock.ts (tasks 12, 12b) — existing helpers keep their 01c v1.1 §4.2 signatures
export type StockCtx = { dayStartMs: number; stockItems: ReadonlyArray<ConfigStockItem>; configStockUnits: Readonly<Record<string, Unit>> };
export function reserveStock(state: EngineState, proposed: ProposedOrder, dayStartMs: number, stockItems: StockCtx['stockItems'], configStockUnits: StockCtx['configStockUnits']):
  { drafts: EventDraft<'StockReserved'>[]; from_stock: Record<string, boolean>; refused: string[] };
export function stockEffects(state: EngineState, draft: EventDraft, stock_ctx?: StockCtx): EventDraft[];
// tick.ts (task 14)
export function getTickIntents(state: EngineState, now: number): EventDraft[];   // order: FireDispatched, ItemStarted{inferred}, ItemDone{inferred}, ReservationsShifted, StockReleased{abandoned}
export function nextDueAt(state: EngineState, t: number): number | null;          // BF-5
export function firesDue(state: EngineState, last_pass_ms: number, now: number): { intents_due: boolean; crossed: string[] };
// slip.ts (tasks 15, 15b)
export interface AlertIntents { slips: Array<{ table_key: string; order_ids: string[]; estimate: number; target: number; promise: number }>;
  resolved: Array<{ table_key: string; alert_id: string }>; overload: Array<{ station_id: string; pressure_bp: number; waiting: number; capped: boolean }> }
export function getAlertIntents(state: EngineState, now: number): AlertIntents;
export function nextAlertDueAt(state: EngineState, exclude?: ReadonlySet<string>): number | null;
export function planRelease(state: EngineState, order_ids: string[], ticks?: { released?: string[]; expedite?: string[] }): EventDraft<'ItemsReleased'>[];
export function goesWith(lineA: GoesWithLine, lineB: GoesWithLine, links: ReadonlyArray<GoesWithLink>): boolean;
// pressure.ts / view.ts (task 16b)
export function stationPressure(state: EngineState, station_id: string, now: number): number;          // basis points
export function stationsLive(state: EngineState, now: number, station_ids?: string[]): StationsLiveBody; // §6.5 body minus as_of_seq
export function stationView(state: EngineState, station_id: string, now: number): { now: ViewLine[]; next: ViewLine[]; later_count: number };
export function stationPlan(state: EngineState, station_id: string, now: number): StationPlanBody;      // §3.6.3 minus as_of_seq
export function groupReadiness(state: EngineState, order_id: string): Array<{ group_id: string; done: string[]; waiting: string[]; hold: boolean }>;
export function pullEarly(state: EngineState, station_id: string, n: number, now: number): EventDraft<'FireDispatched'> | null;
export function lateStartShift(state: EngineState, order_item_id: string, started_at: number): EventDraft<'ReservationsShifted'> | null;
export function capacityForLanes(station: { capacity: number; lane_units: number | null }, lanes_on: number, lane_count: number): number;
// checkpoint.ts (task 17)
export type EngineCheckpointV1 = { checkpoint_schema: 1; last_seq: number; business_day: BusinessDay | null; stock: EngineState['stock'];
  stations: Record<string, { capacity_override: number | null; paused: boolean }>; config: EngineConfig | null };
export function toCheckpoint(state: EngineState, last_seq: number): EngineCheckpointV1;   // P-8
export function fromCheckpoint(body: EngineCheckpointV1): EngineState;
```

`EventDraft<T>` is 00's draft type (`{ stream_type, stream_id, event_type, payload }`); engine drafts never carry ids or times.

**Simulator — `packages/engine/test/sim/` (tasks 18a, 18):** `generateDay(seed: number, o?: { overload?: boolean }): SimDay` (§10.6 generator); `runDay(day, o: { policy?: 'waada_guard' | 'edf' | 'fifo'; prune?: boolean }): SimResult` with `{ events: PosEvent[]; replanMs: number[]; replacedLines: number[]; overloadProbes: number[]; liveState: EngineState }`; `policyReport(result): PolicyReport`; `twoDayLog(seed)`.

**Hub — `apps/hub/src/engine-host/` (tasks 19–27):**

```ts
// index.ts
export function registerEngineHost(app: FastifyInstance, deps: HubDeps): void;
// boot-steps.ts
export function registerEngineBootSteps(): void;                 // steps '2', '3', '6'
export function replayEngine(db, branchId, fromSeq, base: EngineState, report: BreachReport): { state: EngineState; replayed: number }; // 4 statements
export function readStockVersion(db, branchId): number;          // 2 statements
// reducer.ts
export function engineReducer(state: EngineState, event: PosEvent): EngineState;
export function touchedStations(prev: EngineState, next: EngineState): string[];   // P-7
// snapshots.ts
export function scheduleSnapshot(deps): void; export function writeSnapshotSync(deps): void;
export function writeCheckpoint(deps, last_seq: number): void;   // body from toCheckpoint; keep 2
// fires-tick.ts / fires-alerts-tick.ts
export const firesTick: TickDef; export const firesAlertsTick: TickDef;
// station-plan.ts
export const stationPlanCatchUp: CatchUpPart; export function sendStationPlans(deps, station_ids: string[]): void;
// kinds.ts
export const slipWarningKind: AlertKind; export const stationOverloadKind: AlertKind;
// config-hook.ts
export function engineConfigOf(snapshot: BranchConfigSnapshotV3): EngineConfig;   // E(next), §3.11
```

**Cloud 01a v2.1 (tasks C1–C9):** points service `apps/cloud/src/modules/restaurant/points.ts` (route file beside 01a's stations routes; follow the existing module layout), snapshot builder statements `selectPoints`, `selectStationAlternates`, `selectCarryTimes`, `selectEngineSettings`, `selectGoesWith`.

---

## Coverage table (§10 → task)

Tests 16–119 and F 1–15 (119 numbers), plus 01a #129. Each number is in exactly one task, except the split tests named.

| Task | 03a tests |
|---|---|
| 1 | 103 fixture, 114 fixture |
| 3 | 56 |
| 6 | 16, 18, 19, 43 |
| 7 | 17, 31; F 1, 2, 5, 6, 7, 10 |
| 8c | 51, 96, 115, 116; F 4, 8 |
| 8 | 20, 21, 22, 23, 89, 91, 98 |
| 8a | 75, 80, 114 engine |
| 8b | 49, 78, 81, 99, 101 engine, 111 engine |
| 9 | 24, 25, 90 |
| 10 | 26, 27 |
| 11 | 28, 29, 30 |
| 13 | 44; F 3, 9, 14, 15 |
| 12 | 39, 41, 74 engine, 102, 117, 119; 01a #129 |
| 12b | 40, 42, 84, 87, 88, 104, 105, 109, 118 |
| 14 | 32, 52, 62 engine, 110, 111 tick; F 12, 13 |
| 15 | 35, 36, 92, 106 |
| 15b | 37, 38, 77 engine |
| 16 | 34, 45, 97, 100, 107 engine, 108; F 11 |
| 16b | 33, 46, 47, 48, 50 |
| 17 | 53, 54, 55, 94 |
| 18 | §10.6 asserts (perf), the policy report |
| 20 | 57, 58, 64, 85 |
| 21 | 61, 112 |
| 22 | 60, 62 hub, 63, 71, 73, 79, 95, 111 hub |
| 22a | 76, 82, 86, 93, 113 |
| 22b | 83 |
| 23 | 65, 67, 72, 77 hub |
| 24 | 70 |
| 25 | 68 |
| 25b | 69 |
| 26 | 66 |
| 27 | 59, 74 hub |

**Fixture halves (P-3):** #101 (02's new-order-on-exit rule), #103 (return money), #107's `409 RETURN_ALREADY_OPEN`, #114 (return line structure) have their command halves in 02 (To 02 #1, #8). **Test 64 / §7.1** are also re-measured on the pilot box in task 28.

## BF-1–BF-14 placement

| BF | Task | Test |
|---|---|---|
| BF-1 `program_id` / `stock_program_id` immutable, current = `from_stock ? stock_program_id : program_id` | 12b (with 13's loads) | `[03a BF-1]`, extends #87 |
| BF-2 `planOrder` / `calculateETA` take the `from_stock` map | 7 | `[03a BF-2]` |
| BF-3 slip crossing includes carry (`t = level − prep − cook − carry`) | 15 | extends #92 (carry > 0 seed) |
| BF-4 abandon time resolves a slip key; `fires_alerts` closes it | 15 (engine), 22a (close) | extends #111 (open slip case) |
| BF-5 `nextDueAt(state, t)`; overrun item only while it overlaps a later unstarted reservation | 14 | extends #62 (overrun, empty queue) |
| BF-6 abandon clock from `max(last_line_fold_at, latest planned land)` | 8b | `[03a BF-6]` |
| BF-7 the `StockAdded` flip re-places only the flipped line within its own slack (O(1)) | 12b; measured in 18 (20-line `StockAdded` at peak) | `[03a BF-7]` |
| BF-8 `stockEffects` threads earlier drafts of one command; a `StockSet` raising `available` runs the waiting-line reserve | 12b | `[03a BF-8]` |
| BF-9 after a unit-changing `StockSet`, re-reserve held lines in the new unit (`reserveStock` with the day's draws) | 12b | extends #118 |
| BF-10 "hears before the promise" narrowed to Waada Guard with the branch padding (the first option; EDF / FIFO case recorded) | 15 (test), 29 (text) | `[03a BF-10]` |
| BF-11 stale text | 2 (code only), 12b (#42, #88 first clauses as rewritten), 8b (#99 first clause), 29 (spec text, P-10) | — |
| BF-12 partial void: the `ItemVoided` fold lowers `units` and `draws[].quantity`; `StockReleased` only `reserved` | 12 | extends #117 (two-draw and no-draw variants) |
| BF-13 A-20: no throw on `StockAdded` unit mismatch | 12 | 01a #129, `stock.test.ts:91` re-baselined |
| BF-14 fired-not-started crossing via the packing helper; recompute on station-set folds | 15 (with BF-3) | extends #92 (≥ 2 fired-not-started, capacity 1) |

BF-9 and BF-10 each name two options; the plan takes the first stated option of each (BF-9 "re-reserve the held lines in the new unit"; BF-10 "narrow the claim to Waada Guard stations with the branch padding", no code change) and records both as proposed AD rows at batch 4. If the developer prefers the other ("accepted cost" / "`level = min(T + slip_threshold_ms, P)`"), only the owning test changes.

---

## Task list

| Batch | Task | Title | RISK | Markers |
|---|---|---|---|---|
| 0 | 0 | Autobuild rules, settings, F §6.2 / 01a §9 appends | NORMAL | — |
| 1 | 1 | Order-stream event schemas and builders | NORMAL | Shared |
| 1 | 1b | Station and stock event schemas, `station_plan` frame | NORMAL | Shared |
| 1 | 2 | Error codes | NORMAL | Shared |
| 1 | 3 | `EngineState` v3, version 3, snapshot fixture, config fold | NORMAL | Shared |
| 1 | 4 | Occupancy profile | HIGH | Shared |
| 2 | 6 | Lines, units, cook time; plan at `awaiting = 0` | HIGH | Shared |
| 2 | 7 | Hold-and-fire, target and promise, delivery (BF-2) | HIGH | Shared |
| 2 | 8c | Stage folds, `liveInterval`, fired packing | HIGH | Shared |
| 2 | 8 | Re-plan passes, keep, freeze, prune pivot, `T' = min`, one per batch | HIGH | Shared |
| 2 | 8a | Return lines | HIGH | Shared |
| 3 | 8b | Exit, abandon, removal, deterministic ids (BF-6) | HIGH | Shared |
| 3 | 9 | Policies FIFO / EDF, weights | HIGH | Shared |
| 3 | 10 | Overload Λ search | HIGH | Shared |
| 3 | 11 | Routing, reserve, re-route | HIGH | Shared |
| 3 | 13 | Batch loads | HIGH | Shared |
| 4 | 12 | Stock reserve / release / consume folds (BF-12, BF-13) | HIGH | Shared |
| 4 | 12b | `stockEffects` per cause, `StockAdded` reserve-and-re-plan (BF-1, 7, 8, 9) | HIGH | Shared |
| 4 | 14 | Tick intents, `nextDueAt`, `firesDue` (BF-5) | HIGH | Shared |
| 4 | 15 | Slip estimate, crossing, `slip_due`, `getAlertIntents` (BF-3, 4, 10, 14) | HIGH | Shared |
| 4 | 15b | `ItemsReleased`, `goesWith`, `planRelease`, slip close folds | NORMAL | Shared |
| 5 | 16 | Boost, capacity change, D15 exceptions, day-open reset | HIGH | Shared |
| 5 | 16b | Pause, pressure, lanes, READY, views, `pullEarly`, `lateStartShift` | NORMAL | Shared |
| 5 | 17 | `EngineConfigApplied` effects; checkpoint; static fold set (#94) | HIGH | Shared |
| 5 | 18a | Simulator harness (generated day, runner, policy report) | NORMAL | Shared |
| 5 | 18 | **Simulator perf gate**, bounds recorded | HIGH | Shared, GATE |
| 6 | C1 | Cloud migration `0007_engine_config.sql` | NORMAL | 01a, needs Docker Postgres |
| 6 | C2 | Station routes: engine fields, alternates, carry times | NORMAL | 01a, needs Docker Postgres |
| 6 | C3 | Points routes (Q-v2.1-1, Q-v2.1-2) | NORMAL | 01a, needs Docker Postgres |
| 6 | C4 | Item knobs, goes-with on category and item | NORMAL | 01a, needs Docker Postgres |
| 6 | C5 | Snapshot schema 3 and fixtures to V3 | NORMAL | 01a, Shared |
| 7 | C6 | Snapshot builder V3, hub apply V3, sync bound (B-8) | NORMAL | 01a, 01b, needs Docker Postgres |
| 7 | C7 | Branch settings endpoint engine fields (B-6) | NORMAL | 01b, needs Docker Postgres |
| 7 | C8 | Owner app: Points page, station "Timing" group | NORMAL | 01a, UI |
| 7 | C9 | Owner app: "Kitchen timing", item "Timing" and goes-with | NORMAL | 01a, UI |
| 8 | 19 | Hub migration `0007_engine.sql` | NORMAL | — |
| 8 | 20 | Boot steps 2, 3, 6; reducer; H-1; A-15, A-17 | HIGH | 00 (H-1), 01a |
| 8 | 21 | Snapshot and checkpoint writers | HIGH | — |
| 8 | 22 | `fires` tick, config catch-up | HIGH | — |
| 8 | 22a | `fires_alerts` tick | HIGH | — |
| 9 | 22b | `station_plan` catch-up and frame | NORMAL | — |
| 9 | 23 | Kinds `slip_warning`, `station_overload` | NORMAL | — |
| 9 | 24 | Config hook | NORMAL | — |
| 9 | A14 | 01a stock commands append `stockEffects` | HIGH | 01a |
| 9 | R2 | Devices `point_id`, `lane_label` | NORMAL | 00 (H-5, H-6) |
| 10 | R1 | Permissions `manage-stations`, `mark-served`, defaults | NORMAL | 01b (B-1, B-2, B-3, B-5) |
| 10 | R1b | Responsibility `run_station` | NORMAL | 01b (B-4), needs Docker Postgres |
| 10 | 25 | `set-station-capacity` | NORMAL | — |
| 10 | 25b | `set-station-pause` | NORMAL | — |
| 10 | 26 | `stations-live` query, catch-up, audiences | NORMAL | — |
| 11 | 27 | Property live = replay; race 74 | HIGH | — |
| 11 | 28 | Pilot-box manual checks | — | Manual |
| 11 | 29 | Final review and as-built spec | — | — |

**53 tasks** (0–29 with letters, C1–C9, A14, R1, R1b, R2). Inside the spec's ≤ ~60 budget (§11, 03a-g0 §7 "Size"); no split needed. HIGH: 4, 6, 7, 8, 8c, 8a, 8b, 9, 10, 11, 13, 12, 12b, 14, 15, 16, 17, 18, 20, 21, 22, 22a, A14, 27 (24 tasks).

---

## Batch 0 — Setup

### Task 0: Autobuild rules, settings, spec appends — RISK: NORMAL

**Spec:** README R34, CLAUDE.md "Source of truth", §9, 01a §12.3 (P-10).

**Files:** Modify `tools/autobuild/prompts/_rules.md`, `.claude/settings.json`, `docs/specs/00_Foundation_Spec_v1.9.md` (§6.2 table only), `docs/specs/01_Restaurant_Setup_Spec_v2.1.md` (§9 only).

- [ ] **Step 1:** F §6.2: append `03a §9: STATION_PAUSED, STATION_PAUSE_DISABLED, ORDER_NOT_IN_ENGINE, RETURN_ALREADY_OPEN` to the 409 row's examples and `01a §9: POINT_NOT_FOUND` to the 404 row (text "appended, no bump, R34"). 01a §9: one row `POINT_NOT_FOUND | 404 | { point_id } | §6.9a path names a point not in the branch (Q-v2.1-1)`.
- [ ] **Step 2:** `_rules.md` source 1 → `docs/specs/00_Foundation_Spec_v1.9.md §6`. `.claude/settings.json` deny gains `Edit(…)` and `Write(…)` for `00_Foundation_Spec_v1.9.md`, `00_Hub_Platform_Access_Spec_v1.7.md`, `01_Restaurant_Setup_Spec_v2.1.md`, `01b_Staff_Roles_Spec_v1.5.md`, `01c_Menu_Variants_Spec_v1.1.1.md`, `01d_Notifications_Requests_Spec_v1.1.1.md`, `03a_Timing_Engine_Spec_v1.0.md` (existing entries kept). The allow line `Bash(git push origin module-03a)` is already there.
- [ ] **Step 3:** `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"` → no error; `grep -c "STATION_PAUSED" docs/specs/00_Foundation_Spec_v1.9.md` ≥ 1.
- **Done when:** the four files changed as above; no gate (no code).
- [ ] **Commit:** `chore(03a): task 0 autobuild rules, settings, F §6.2 and 01a §9 code appends [README R34; spec §9; 01a v2.1 §12.3]`

---

## Batch 1 — Events, errors, state, profile (§11 tasks 1–4)

### Task 1: Order-stream event schemas and builders — RISK: NORMAL — Shared

**Spec:** §4.2 (order rows), 01c v1.1.1 §4.3 (`ItemAdded` v1, C-1), §3.8a (return line), §3.3 (`placed_by` = `actor_id`, `placed_at` = `recorded_at`).

**Files:** Create `packages/events/src/events/order/{OrderPlaced,OrderLinesAdded,ItemAdded,ItemReturned,ItemStarted,ItemDone,ItemDoneUndone,ItemServed,ItemRemoved,ItemVoided,ItemMovedToStock,OrderBoosted,ItemsReleased,SlipWarned}.v1.ts`; modify `packages/events/src/registry.ts`, `packages/events/src/index.ts`, `packages/events/testing/index.ts`; test `packages/events/src/events/order/order-events.test.ts`, `packages/events/testing/builders.test.ts`.

- [ ] **Step 1: Tests:** `[03a §4.2]` each schema parses its §4.2 example and refuses: a missing engine field, an extra unknown `source`, `ItemServed.order_item_ids` empty, `ItemVoided.units` 0, `OrderPlaced.groups[].group_id` not `order_id:<n>`; `ItemAdded` round-trips every 01c §4.3 field (`line_kind` incl. `deal`, `option_quantity`, `stock_draws`, the batch cook-time copies); `[03a #103 fixture]` and `[03a #114 fixture]`: `aReturnLinesAdded(served, 'fix' | 'remake')` emits `price_minor 0`, `line_total_minor 0`, `tax_class_id null`, option charges 0, `line_kind 'item'`, every parent / deal / option link null, `options []`, `quantity` copied, `cook_ms_override` = `adjust_time_ms` for `fix` only, plus `ItemReturned` for `remake`; `anOrderBatch` stamps one `recorded_at`.
- [ ] **Step 2:** FAIL → **Step 3:** schemas (Zod, `schema_version: 1`), registry entries, builders → **Step 4:** PASS; `pnpm --filter @pos/events typecheck typecheck:tests`.
- **Done when:** 14 order events registered; the builders exist with the names in Interfaces.
- [ ] **Commit:** `feat(03a): task 1 order-stream event schemas and builders [spec §4.2, §3.8a; 01c §4.3; tests #103, #114 fixture]`

### Task 1b: Station and stock event schemas, `station_plan` frame — RISK: NORMAL — Shared

**Spec:** §4.2 (station, stock rows), §3.11 (`EngineConfigAppliedV1`), §3.6.3 (frame), A-19.

**Files:** Create `packages/events/src/events/station/{FireDispatched,ReservationsShifted,EngineConfigApplied,StationCapacitySet,StationPauseSet}.v1.ts`, `packages/events/src/events/stock/{StockReserved,StockReleased,StockConsumed}.v1.ts`; modify `stock/StockAdded.v2.ts`, `src/ws.ts`, `src/registry.ts`, `testing/index.ts`; tests `src/events/station/station-events.test.ts`, `src/events/stock/stock-events.test.ts`, `src/ws.test.ts`.

- [ ] **Step 1: Tests:** `[03a §4.2]` each schema parses its example; `FireDispatched.reason ∈ scheduled | early_fill | pulled` (`missed` refused); `StockReleased.reason ∈ removed | voided | moved | recount | day_closed | abandoned` (`unit_changed`, `moved_to_stock` refused); `EngineConfigApplied` refuses stations not sorted by `station_id` and any key outside §3.11 (`.strict()`), and accepts `reference_cook_ms 0`; `StationCapacitySet.capacity_override` 1–100 or null; `[03a §4.2 A-19]` `StockAdded` v2 with and without `reason: 'moved'` parses; `[03a §3.6.3]` the `station_plan` frame is in `WsServerMessage`.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- **Done when:** 8 new events and the frame registered; `StockAdded` v2 still parses every existing fixture.
- [ ] **Commit:** `feat(03a): task 1b station and stock event schemas, station_plan frame [spec §4.2, §3.6.3, §3.11; 01a A-19]`

### Task 2: Error codes — RISK: NORMAL — Shared

**Spec:** §9, 01a §12.3 Q-v2.1-1, BF-11 (code part).

**Files:** Modify `packages/domain/src/errors.ts`; test `packages/domain/src/errors.test.ts`.

- [ ] **Step 1: Test:** `[03a §9]` the five codes exist with statuses 409 ×4 and 404 (`POINT_NOT_FOUND`); `new DomainError('ORDER_NOT_IN_ENGINE', { order_id })` serialises to the F §6.1 envelope.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 2 error codes [spec §9; 01a v2.1 §12.3 Q-v2.1-1]`

### Task 3: `EngineState` v3, version 3, snapshot fixture, config fold — RISK: NORMAL — Shared

**Spec:** §3.3 (shape), §3.11 (`EngineConfigApplied` stores `config`, creates a `StationRuntime` per station with an empty profile), §6.1a, D62, F §6.7; P-4.

**Files:** Modify `packages/engine/src/{state,version,apply-event,index}.ts`, `packages/engine/tsconfig.test.json` (`include` + `"test"`), `packages/engine/vitest.config.ts` (exclude `test/sim/**/*.perf.test.ts`), root `vitest.config.ts` (`perf` project, P-4); create `packages/engine/src/replay-events.ts`, `packages/engine/fixtures/engine-state.v3.json`, `packages/engine/fixtures/engine-log.v3.json`; test `packages/engine/test/state.test.ts`.

- [ ] **Step 1: Tests:** `[03a #56]` `buildEngineState(engine-log.v3.json)` deep-equals `engine-state.v3.json` (the log: an `EngineConfigApplied` with two stations, a `BusinessDayOpened`, a `StockSet`); the test fails when a key is added to `EngineState` without bumping `ENGINE_STATE_VERSION` (key-set snapshot of every nested interface); the v2 fixtures still load through the existing tests. `[03a §3.11]` the config fold keeps `capacity_override` / `paused` of an existing station and sets `type` / `capacity` from the payload.
- [ ] **Step 2:** FAIL → **Step 3:** shape exactly §3.3; `ENGINE_REPLAY_EVENTS` with the §3.12 lists (folds for the not-yet-built types return `state` until their tasks) → **Step 4:** PASS; existing `stock.test.ts`, `business-day.test.ts` green.
- **Done when:** `ENGINE_STATE_VERSION = 3`; the perf project exists (no tests yet).
- [ ] **Commit:** `feat(03a): task 3 EngineState v3, version 3, snapshot fixture, config fold [spec §3.3, §3.11, §6.1a; test #56]`

### Task 4: Occupancy profile — RISK: HIGH — Shared

**Spec:** §3.3 "The profile is the timeline (D24)" (scan rules, next candidate `a − prep − cook` backward, `b − prep` forward, integer ms), D24, F §4.7 slot formula.

**Files:** Create `packages/engine/src/profile.ts`; test `packages/engine/test/profile.test.ts`.

**Invariants (reviewer):** inputs never mutated; boundaries strictly increasing, no zero-length segment, `u ≥ 0`; add then remove = the original profile (structural equality); a fit's whole `[fire + prep, fire + prep + cook)` has `u + units ≤ cap`.

- [ ] **Step 1: Tests:** `[03a §3.3 profile]` add / remove merge equal neighbours; `latestFit` returns the latest fire in `[lo, hi]` whose interval fits, `null` when none; `earliestFit` the earliest ≥ `lo`; prep shifts the interval, not the fire bound; a conflict segment `[a, b)` jumps to `a − prep − cook` / `b − prep`; `bookedUnitMs`; a property over 200 random profiles: the fit agrees with a brute-force scan over every integer ms of a small range. **Review Focus 1:** `units > cap` → `earliestFit` returns the first instant at which the station is empty for the whole cook (it treats the line as needing all `cap`), `latestFit` returns the latest such instant or `null`; both terminate (step count bounded by boundaries) — proposed AD row "units > capacity occupy the whole station".
- [ ] **Step 2:** FAIL → **Step 3:** binary search for the segment, linear walk across boundaries → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 4 occupancy profile [spec §3.3, D24; Review Focus 1]`

---

## Batch 2 — Placement core (§11 tasks 6, 7, 8, 8a; order 6, 7, 8c, 8, 8a)

### Task 6: Lines, units, cook time; plan at `awaiting = 0` — RISK: HIGH — Shared

**Spec:** §3.2, §3.3 (`EngineOrder`, `EngineLine`; `placed_by`, `placed_at`), §3.5.1 "When the fold plans", §4.2 `OrderPlaced` / `ItemAdded` / `OrderLinesAdded` batch order, 01c §3.4.7, V18.

**Files:** Create `packages/engine/src/plan.ts`; modify `apply-event.ts`; tests `packages/engine/test/lines.test.ts`.

**Invariants:** a `deal` line or `station_id = null` line never enters `lines`; the order plans exactly once per batch, at the `ItemAdded` that makes `awaiting` 0; `T`, `P` and groups come from `OrderPlaced`, never recomputed.

- [ ] **Step 1: Tests:** `[03a #16]` "Roti ×4" holds 4 units; capacity 30 with 28 used → the line waits (its fire is after the blocking interval); `[03a #18]` replay of `OrderPlaced` with `target_land_ms` / `promise_ms` stores them unchanged even with a different config folded; `[03a #19]` no line is placed before the last listed `ItemAdded`; a `deal` line is never placed; `[03a #43]` pending weight → 1 unit, item cook time; `[03a §3.3 placed_by]` `placed_by = actor_id`, `placed_at = recorded_at` (the rest of #110 in task 14); g / ml line = 1 unit; from-stock slot line uses `stock_time_ms`. **Review Focus 4:** an order whose every line is a `deal` line or has `station_id` null → `awaiting` reaches 0, no placement, no throw; it exits by the served rule (asserted in 8b).
- [ ] **Step 2:** FAIL → **Step 3:** folds for `OrderPlaced`, `ItemAdded`, `OrderLinesAdded` (presence rules of §3.3 left to 8b) → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 6 lines, units, cook time, plan at the last listed line [spec §3.2, §3.5.1; tests #16, #18, #19, #43; Review Focus 4]`

### Task 7: Hold-and-fire, target and promise, delivery — RISK: HIGH — Shared

**Spec:** §3.5.1 steps 1, 3–6, §3.2 (deadline, slack), F §4.7 hold-and-fire (D16, D35, D36, D49), D3 (delivery, padding 0 on FIFO / EDF), D6, BF-2, §6.1b–d.

**Files:** Modify `plan.ts`; tests `packages/engine/test/plan.test.ts`, `packages/engine/test/foundation.test.ts` (created).

**Invariants:** `planOrder(state, proposed, now, from_stock)` and the fold at `awaiting = 0` give the same placement for the same `(state, now)`; `calculateETA` never changes stock claims; no line ends past `T − carry`; `P = T + max padding over the group's stations`.

- [ ] **Step 1: Tests:** `[03a #17]` `P = T + padding` (station override ?? branch per order type, max over the group's stations); FIFO / EDF lines padding 0; `[03a #31]` delivery `T = max(pickup_at_ms, loop result)`; `[03a F #1, #2, #5, #6, #7, #10]` as F §4.7 (relative to `T = 1_761_000_000_000`); `[03a BF-2]` `planOrder` with `from_stock { L: true }` uses `stock_time_ms`, with `false` the full cook; `calculateETA` without the map uses `ItemAdded.from_stock`-less defaults = fresh; `checkOrderable` on a line whose only station is paused (state built with `paused: true`; the `StationPauseSet` fold lands in 16b) → `DomainError('STATION_PAUSED', { station_id })`. **Review Focus 1:** a 4-unit line on a capacity-3 station gets a finite `T` and promise.
- [ ] **Step 2:** FAIL → **Step 3:** steps 3–6 against the current profile (pass 1 arrives in task 8) → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 7 hold-and-fire, target and promise, delivery [spec §3.5.1, D3, D6; BF-2; tests #17, #31, F #1, #2, #5–#7, #10]`

### Task 8c: Stage folds, `liveInterval`, fired packing — RISK: HIGH — Shared

**Spec:** §3.3 "In-flight lines" (packed Start `s ≥ max(fire, t)`, interval `[s + prep, s + prep + cook)`, COOKING `[started + prep, max(started + prep + cook, t))`, `started = min(started_at, recorded_at)`), §3.4 stages, F-20, D16 (undo), D33, D42; P-5. Runs before task 8 (task 8's tests need the stage folds).

**Files:** Create `packages/engine/src/live.ts`; modify `plan.ts`, `apply-event.ts`; tests `packages/engine/test/live.test.ts`, `foundation.test.ts`.

**Invariants:** every placement path (`planOrder`, `calculateETA`, later the fold re-plan and the tick) reads in-flight lines only through `liveInterval`; two fired-not-started lines on capacity 1 never share a window; an unstarted line occupies nothing before `t + prep`.

- [ ] **Step 1: Tests:** folds `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ItemServed`, `ItemRemoved`, `ItemVoided` (stage only; stock in 12), `FireDispatched` (sets `fired_at`, `load_id`); `[03a #51]` undo returns the line to COOKING and its occupancy; `[03a F #4, #8]`; `[03a #96]` (tawa capacity 1, padding 3 min; prep 0 and prep > 0 variants); `[03a #115]`, `[03a #116]` (incl. the outage fixture: 20 fired-not-started lines) with prep > 0 cases.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 8c stage folds, liveInterval, fired packing [spec §3.3, §3.4, F-20; tests #51, #96, #115, #116, F #4, #8]`

### Task 8: Re-plan passes, keep, freeze, prune pivot, `T' = min`, one per batch — RISK: HIGH — Shared

**Spec:** §3.5.3 (fixed set, pivot `earliestPossible` with `lo_L`, `d_min`, `T_min`; pass 1 order `(d − keep, −w × (t − placed_at), order_item_id)`, `latestFit` with keep then without, late set → §3.5.6 stub), §3.5.1 "one sequence" (pass 1 → immediate → sync), §3.4 hidden / frozen at `recorded_at`, D13, D15, D25, G4-1 #12.

**Files:** Create `packages/engine/src/replan.ts`; modify `plan.ts`, `apply-event.ts`; test `packages/engine/test/replan.test.ts`.

**Invariants:** a re-plan writes no event; frozen (`fire ≤ t + freeze_ms`), fired, COOKING and done lines never move here; no station booked over effective capacity at any instant; one re-plan per station per batch; the promise never moves; a void / remove re-plan gives `T' = min(T, loop)`; pruned `T ≤` unpruned `T`.

- [ ] **Step 1: Tests:** `[03a #20]` a newer order cannot push an older line past `d − keep`; `[03a #21]` an older hidden line moves within slack, frozen and fired lines do not; `[03a #22]` freeze evaluated at the event's `recorded_at` (the fold has no clock); `[03a #23]` on the fixture and as a property over 50 seeds: pruned keeps on time every line unpruned keeps, same or earlier `T`, no extra late line, no over-booking; `[03a #89]` void / remove: `T' < T` when the critical line is freed, `T` kept when the loop would give later, `promise_ms` unchanged; `[03a #91]` a line that fits at the handler's `t` but not at the batch `recorded_at` is placed at its earliest fit (its slip half is the `[03a §3.8]` test in task 15); `[03a #98]` capacity 1, early Done frees `[12:01, 12:08)`, older A and new immediate N → A first, N after; never 2 units; `planOrder` = the fold. A late set goes to a stub that places at `earliestFit` (task 10 replaces it). **Review Focus 2:** forced equal `recorded_at` for a whole batch and equal `fire_ms` across stations, 50 seeds: fold order and placement are stable (live = rebuild).
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS; tasks 6, 7, 8c tests still green.
- [ ] **Commit:** `feat(03a): task 8 re-plan passes, keep, freeze, prune pivot, one sequence [spec §3.5.1, §3.5.3, §3.4; tests #20–#23, #89, #91, #98; Review Focus 2]`

### Task 8a: Return lines — RISK: HIGH — Shared

**Spec:** §3.8a (immediate, `mark: 'return'`, follow-up weight, no draw, `cook_ms_override`, `remake` → `ItemReturned` exits the served line as `voided` for the engine), §3.5.2, §4.2 `OrderLinesAdded`; placement "expedite within others' slack and keep" (the `returns_boost` path is task 16).

**Files:** Modify `plan.ts`, `apply-event.ts`; test `packages/engine/test/returns.test.ts`.

- [ ] **Step 1: Tests:** `[03a #75]` `fix` on a served from-stock line → one new immediate line, `cook_ms = adjust_time_ms` from the event, no `StockReserved` drafted by `reserveStock` for it, `mark 'return'`, placed without any other line crossing its deadline; `remake` → `ItemReturned` makes the served line `returned`; `[03a #80]` a later config change of `adjust_time_ms` does not change a replay; `max_carry_ms` from the line drives re-routing (routing stub = home station until task 11, asserted again there); `[03a #114 engine]` a return line from `aReturnLinesAdded` folds with `draws []`, its own group, never re-opening the old group.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 8a return lines [spec §3.8a; tests #75, #80, #114 engine]`

---

## Batch 3 — Lifecycle, policies, overload, routing, batch (§11 tasks 8b, 9, 10, 11, 13)

### Task 8b: Exit, abandon, removal, deterministic ids — RISK: HIGH — Shared

**Spec:** §3.3 Exit (served rule, abandon, `last_line_fold_at` list, removal only in listed folds, `OrderLinesAdded` fold order and throw), "Absent ids", "Deterministic ids", §3.12 lists, §6.1a, BF-6, BF-11 (#99 first clause).

**Files:** Create `packages/engine/src/lifecycle.ts`; modify `apply-event.ts`; test `packages/engine/test/lifecycle.test.ts`.

**Invariants:** every reader uses `isOrderInEngine`, never row presence; an event type outside `ENGINE_REPLAY_EVENTS` returns `state` itself (`Object.is`) and removes nothing; only `OrderLinesAdded` on an absent order throws.

- [ ] **Step 1: Tests:** `[03a #49]`, `[03a #78]` (an `audit` event or `AlertSeen` does not remove; the next listed event does), `[03a #81]`, `[03a #99]` (a close with one COOKING order, one served order, one unfired-only order → only the served one exits; Done and Served of the others are absent-id no-ops after their exit), `[03a #101 engine]` `isOrderInEngine` false at minute 35 and `OrderLinesAdded` for an absent order throws, for a present order past the window it re-opens; `[03a #111 engine]` a fired never-tapped line: at `last_line_fold_at + order_abandon_ms` the predicate is false and the line occupies nothing; `[03a BF-6]` a 5 h legitimate cook planned to land after `last_line_fold_at + order_abandon_ms` is not abandoned before its planned land. Review Focus 4 order exits.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 8b exit, abandon, removal, deterministic ids [spec §3.3, §3.12, §6.1a; BF-6; tests #49, #78, #81, #99, #101 engine, #111 engine]`

### Task 9: Policies FIFO / EDF, weights — RISK: HIGH — Shared

**Spec:** §3.5.2 (weight formula, branch weights from `state.config` at each re-plan, item `weight_pct` a copy), §3.5.3 FIFO / EDF bullets, §3.5.4, D3.

**Files:** Modify `replan.ts`, `plan.ts`; test `packages/engine/test/policies.test.ts`.

- [ ] **Step 1: Tests:** `[03a #24]` FIFO: earliest fit in submit order, no hold, target = land; `[03a #25]` EDF = Waada Guard with `w = 100`, keep 0, padding 0 (same placement on a fixture); `[03a #90]` after an `EngineConfigApplied` raising `weight_delivery_pct`, the next re-plan orders an open delivery line before a dine-in it followed; the line's `weight_pct` copy unchanged.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 9 policies FIFO and EDF, weights [spec §3.5.2–§3.5.4; tests #24, #25, #90]`

### Task 10: Overload Λ search — RISK: HIGH — Shared

**Spec:** §3.5.6 (`d_Λ = d + min(Λ × 100 / w, max_late_ms ?? ∞)`, EDF on `d_Λ`, keep off, Λ multiples of `cascade_step_ms`, exponential then binary, ≤ 16 probes, capped line at `earliestFit` after the others + `capped` flag), D5.

**Files:** Create `packages/engine/src/overload.ts`; modify `replan.ts` (replace the task-8 stub); test `packages/engine/test/overload.test.ts`.

- [ ] **Step 1: Tests:** `[03a #26]` one slot: a weight-2 line carries half the lateness of a weight-1 line; `[03a #27]` a line at its `max_late_ms` cap is not shifted further and is reported capped (the flag `getAlertIntents` reads in 15); `[03a §3.5.6]` probe count ≤ 16 on a 125 % fixture; no over-booking.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 10 overload Λ search [spec §3.5.6, D5; tests #26, #27]`

### Task 11: Routing, reserve, re-route — RISK: HIGH — Shared

**Spec:** §3.5.5 (alternates slot-only, order type, `max_carry_ms`, not paused; immediate: min arrival, `min_gain_ms` → home; sync: fit at any allowed station ending at `T − carry`, preference home → lowest carry → `station_id`; `reserve_units`; only hidden lines change station), D8–D10, D23, P-3.

**Files:** Create `packages/engine/src/route.ts`; modify `plan.ts`, `replan.ts`; test `packages/engine/test/route.test.ts`.

- [ ] **Step 1: Tests:** `[03a #28]` earliest arrival wins; gain < `min_gain_ms` → home; carry adds; `max_carry_ms` filters (re-asserts #80's routing part); `[03a #29]` reserve units usable only by home order types; `[03a #30]` only hidden lines re-route; `[03a §3.5.5]` with carry 0 and no alternates the result equals task 7's (defaults reduce to the routed station).
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 11 routing, reserve, re-route [spec §3.5.5; tests #28–#30]`

### Task 13: Batch loads — RISK: HIGH — Shared

**Spec:** F §4.7 batch (D14, D17, D34, D35, D49), §3.2 batch cook time from the line copies, §3.3 load id (`station_id:earliest order_item_id`, a name), §3.6.1 item 1 (freshness window, `max_early_ms` cap), BF-1 (program derivation used by loads).

**Files:** Modify `plan.ts`, `replan.ts`, `apply-event.ts`; test `packages/engine/test/batch.test.ts`, `foundation.test.ts`.

- [ ] **Step 1: Tests:** `[03a #44]` program cook times from `ItemAdded` copies, never config; `max_early_ms` caps freshness per line; `[03a F #3, #9, #14, #15]`; a fired load is closed to joiners; loads never mix programs; the current program of a line is `from_stock ? stock_program_id : program_id` (BF-1 helper `currentProgram(line)`, used here).
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 13 batch loads with copied cook times [spec F §4.7, §3.2, §3.3; tests #44, F #3, #9, #14, #15]`

---

## Batch 4 — Stock, tick, slip (§11 tasks 12, 14, 15)

### Task 12: Stock reserve / release / consume folds — RISK: HIGH — Shared

**Spec:** §3.7 (reserve at submit, every draw, `sold_out` refused at available 0, `cook_fresh`; `StockReleased` fold bookkeeping only; consume at `ItemStarted` with clamps; per-draw `reserved`; partial-void share; no fold throws; `report`), §6.1e, P-4, P-5, BF-12, BF-13, A-20, 01a S14.

**Files:** Modify `packages/engine/src/{stock,apply-event}.ts`, `packages/engine/src/stock.test.ts` (line 91 re-baselined); test `packages/engine/test/stock-folds.test.ts`.

**Invariants:** `on_hand ≥ 0`, `reserved ≥ 0`, each `draws[].reserved ∈ [0, quantity]`; `reserved_seq = null` iff every draw's `reserved` is 0; no stock fold throws; the result never depends on `report`; every valid fixture reports no breach.

- [ ] **Step 1: Tests:** `[03a #39]` every draw must fit after claims in this command; `sold_out` at 0 refused; `cook_fresh` full cook; `[03a #41]` consume at start moves units out of both, clamps past `on_hand` with one breach and commits; `[03a #74 engine]` two `reserveStock` calls in sequence on the folded state: the second gets `cook_fresh` or `refused`; `[03a #102]` `draws` = `ItemAdded.stock_draws`, live = replay with a changed config between; `[03a #117]` + BF-12 variants (two-draw "Platter × 2", no-draw partial void); `[03a #119]`; `[01a #129]` re-baselined (A-20 wording); `[03a BF-13]` `StockAdded` unit mismatch → entry unchanged, one breach.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 12 stock reserve, release and consume folds [spec §3.7, P-4, P-5; BF-12, BF-13; 01a A-20; tests #39, #41, #74 engine, #102, #117, #119, 01a #129]`

### Task 12b: `stockEffects` per cause, `StockAdded` reserve-and-re-plan — RISK: HIGH — Shared

**Spec:** §3.7 per-cause table, Q14 consume before a unit-changing `StockSet`, move to stock (fold own drafts in order), `StockAdded` candidates / order / reach / flip fold, §3.5.3 stock triggers (flip re-plans, recount / close re-plan at their own event), §6.1f, BF-1, BF-7, BF-8, BF-9, BF-11 (#42, #88 first clauses).

**Files:** Modify `stock.ts`, `apply-event.ts`, `replan.ts`; test `packages/engine/test/stock-effects.test.ts`.

**Invariants:** a release covers every draw of the line together; recount / close release hidden lines only; a frozen line is never a `StockAdded` candidate; drafts come in §4.2 batch order (releases before `StockSet` / `BusinessDayClosed`; release, adds, reserves for move-to-stock); a submit's own `StockReserved` never re-plans.

- [ ] **Step 1: Tests:** `[03a #40]`, `[03a #42]`, `[03a #84]`, `[03a #87]` (+ BF-1: after a flip and a later whole release the line returns to its `program_id`), `[03a #88]`, `[03a #104]` (3 draws, one re-plan per station at `awaiting = 0`, also for `OrderLinesAdded`), `[03a #105]`, `[03a #109]`, `[03a #118]` (+ BF-9: the held lines are re-reserved in the new unit after the `StockSet`); `[03a BF-7]` a flip re-places only the flipped line (assert other lines' `fire_ms` unchanged and the count of re-placed lines = 1); `[03a BF-8]` two `AddPrecookedStock` entries in one command: the second's reserve sees the first's claims; a `StockSet` raising `available` runs the waiting-line reserve.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 12b stockEffects per cause, StockAdded reserve and re-plan [spec §3.7, §3.5.3, §6.1f; BF-1, BF-7, BF-8, BF-9; tests #40, #42, #84, #87, #88, #104, #105, #109, #118]`

### Task 14: Tick intents, `nextDueAt`, `firesDue` — RISK: HIGH — Shared

**Spec:** §3.6.1 items 1–4a, `nextDueAt` terms (earliest unfired fire, auto-fill eligibility, inferred Done, cascade step, overrun boundary, abandon with a live reservation), §3.6.3 `firesDue`, D16 auto-fill, D60, D42, D44, BF-5.

**Files:** Create `packages/engine/src/tick.ts`; test `packages/engine/test/tick.test.ts`, `foundation.test.ts`.

**Invariants:** pure and idempotent by state (same result twice, F #13); never fires a fired line; whenever `nextDueAt(state, t)` is finite, `getTickIntents(state, nextDueAt)` is non-empty; `crossed` = stations with an unfired line whose `fire_ms − freeze_ms ∈ (last_pass_ms, now]`.

- [ ] **Step 1: Tests:** `[03a #32]` auto-fill from Next within `max_early_ms`, urgent first then `w × waiting`; `[03a #52]` `single_tap` inferred start, `auto_done` inferred done; `[03a #110]` `placed_by` / `placed_at` (task 6's fold), an `ItemStarted` with `started_at` after `recorded_at` folded at `recorded_at`, and `FireDispatched.due_at` = the planned fire; `[03a #62 engine]` property over 50 seeds (+ BF-5 overrun-with-empty-queue: no overrun term when no later unstarted reservation overlaps); `[03a #111 tick]` the abandon pass returns `StockReleased { abandoned }` per draw of a line with a live reservation, from `stockEffects`; `[03a F #12, #13]`; `firesDue` crossed set. **Review Focus 3:** `now` before `fired_at` / `started_at` → no throw, no negative interval, no second fire.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 14 tick intents, nextDueAt, firesDue [spec §3.6.1, §3.6.3; BF-5; tests #32, #52, #62 engine, #110, #111 tick, F #12, #13; Review Focus 3]`

### Task 15: Slip estimate, crossing, `slip_due`, `getAlertIntents` — RISK: HIGH — Shared

**Spec:** §3.8 estimate (with carry, packed Start), trigger, one per table key, re-raise rule, `slip_due` per key recomputed only by folds that touch slips or a group (touched keys only), one `slipCrossing` for both readers, `getAlertIntents` shape §6.1g, overload items from §3.10 (pressure and capped flag), BF-3, BF-4, BF-10, BF-14.

**Files:** Create `packages/engine/src/slip.ts`; modify `apply-event.ts`; test `packages/engine/test/slip.test.ts`.

**Invariants:** a fold that touches no slip or group leaves `slip_due` and `next_alert_due_at` identical (`Object.is`); per-key recompute = full recompute; `getAlertIntents(state, next_alert_due_at)` has an item for that key, `next_alert_due_at − 1` has none.

- [ ] **Step 1: Tests:** `[03a #35]` threshold from the target; `[03a #36]` grouped per table key; re-raise only after `+threshold` and `alert_id = null`; `[03a #92]` property over 50 seeds, with BF-3 (carry > 0 seed) and BF-14 (≥ 2 fired-not-started lines on capacity 1; a Start of the first recomputes the second's key); `[03a #106]`; `[03a BF-10]` with the default padding (180 000) above the default threshold (120 000) a Waada Guard order's slip is raised before its promise; on an EDF / FIFO station (padding 0) it is raised after `P` — the claim is narrowed to Waada Guard stations with the branch padding (AD row; spec text in task 29); `[03a BF-4]` when every order of a key is abandoned, `slip_due = last_line_fold_at + order_abandon_ms` and `resolved` lists the key; `[03a §3.8]` the slip half of #91 (the late line has `next_alert_due_at` at its crossing).
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 15 slip estimate, crossing, slip_due, getAlertIntents [spec §3.8; BF-3, BF-4, BF-10, BF-14; tests #35, #36, #92, #106]`

### Task 15b: `ItemsReleased`, `goesWith`, `planRelease`, slip close folds — RISK: NORMAL — Shared

**Spec:** §3.8 (`apply` draft content, `applyEvent(ItemsReleased)`, `SlipWarned` / `AlertClosed` folds, `resolved_at`, Undo clears it, drop at `BusinessDayClosed`), D11, D12, §6.1m.

**Files:** Modify `slip.ts`, `apply-event.ts`; test `packages/engine/test/release.test.ts`.

- [ ] **Step 1: Tests:** `[03a #37]` released lines leave the group; expedite become immediate with the follow-up weight; the rest stay sync at their old `T`; one re-plan; `[03a #38]` category default, item add, item exclude; nothing configured → nothing pre-ticked; `[03a #77 engine]` `SlipWarned.alert_id` stored; its `AlertClosed` sets `alert_id = null`; another alert's `AlertClosed` → `Object.is` same state; an `ItemDoneUndone` that un-resolves a key clears `resolved_at`.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 15b ItemsReleased, goesWith, planRelease, slip close folds [spec §3.8, D11, D12; tests #37, #38, #77 engine]`

---

## Batch 5 — Disturbances, views, config, the simulator gate (§11 tasks 16, 17, 18)

### Task 16: Boost, capacity change, D15 exceptions, day-open reset — RISK: HIGH — Shared

**Spec:** §3.9, §3.4 D15 exceptions (frozen first at `earliestFit(current fire)`, `mark 'moved'`, late set → §3.5.6), §3.10 live capacity (override ≤ 100 staff, reset at `BusinessDayOpened`, reset re-plans), §3.8a `returns_boost` (return line only), F §4.7 test 11 as F-17.

**Files:** Modify `replan.ts`, `apply-event.ts`; test `packages/engine/test/disturbances.test.ts`, `foundation.test.ts`.

**Invariants:** no booking ever exceeds capacity at any instant (property over 50 seeds); fired and COOKING lines never move; boost changes only the boosted order's `T`, never its promise.

- [ ] **Step 1: Tests:** `[03a #34]`, `[03a #45]`, `[03a #97]`, `[03a #100]`, `[03a #107 engine]` (with `returns_boost` only the return line is boosted; `order.boosted` false; other lines and `T` unchanged), `[03a #108]`, `[03a F #11]` (slip on the next `getAlertIntents`).
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 16 boost, capacity change, D15 exceptions, day-open reset [spec §3.4, §3.9, §3.10, §3.8a; tests #34, #45, #97, #100, #107 engine, #108, F #11]`

### Task 16b: Pause, pressure, lanes, READY, views, `pullEarly`, `lateStartShift` — RISK: NORMAL — Shared

**Spec:** §3.10 (pause, pressure bp and bands, `capacityForLanes`), §3.4 READY / hold at pass, §6.1h–l, §3.6.3 `stationPlan` body, §6.5 `stationsLive` body (`wait_ms` from `reference_cook_ms`), D16, D42.

**Files:** Create `packages/engine/src/{pressure,view}.ts`; modify `apply-event.ts` (`StationPauseSet` fold); test `packages/engine/test/views.test.ts`.

- [ ] **Step 1: Tests:** `[03a #33]` `pullEarly` respects `max_early_ms`, `reason 'pulled'`; `[03a #46]` the four `capacityForLanes` cases incl. never below 1; `[03a #47]` pause refuses via `checkOrderable`, open lines continue; `[03a #48]` bands from the profile, pure in `(state, now)`; `[03a #50]`; `[03a §6.1h]` `stationView` Now = fired, Next = frozen in fire order, Later = count; `stationPlan` lists every unfired line with `frozen`; `lateStartShift` shifts later lines only by `started − s`; `stationsLive` matches the §6.5 example shape (minus `as_of_seq`).
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 16b pause, pressure, lanes, READY, views [spec §3.4, §3.10, §6.1h–§6.1m; tests #33, #46–#48, #50]`

### Task 17: `EngineConfigApplied` effects; checkpoint — RISK: HIGH — Shared

**Spec:** §3.11 effects table, §3.12 checkpoint body and `fromCheckpoint`, D26, P-8.

**Files:** Create `packages/engine/src/checkpoint.ts`; modify `apply-event.ts`, `replay-events.ts`; tests `packages/engine/test/config-checkpoint.test.ts`, `packages/engine/test/replay-events.test.ts`.

- [ ] **Step 1: Tests:** `[03a #53]` capacity change re-plans (frozen too); cook-time change affects new orders only; an archived station's lines complete; `[03a #54]` station-type change keeps open lines as fixed input; `[03a #55]` (a) night boot from `fromCheckpoint(toCheckpoint(state, seq))` + the rest of the log = full replay from 0, `business_day` included; (b) a day boot likewise; the body has exactly the §3.12 keys and no order; `[03a #94]` static, in the last task that adds a fold: the case set of `applyEvent` = the union of `ENGINE_REPLAY_EVENTS` (type-level exhaustive switch plus a runtime check over every registered event type); any other type returns the same object (`Object.is`).
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 17 EngineConfigApplied effects, checkpoint, static fold set [spec §3.11, §3.12, D26; tests #53–#55, #94]`

### Task 18a: Simulator harness — RISK: NORMAL — Shared

**Spec:** §10.6 generated day (seed 7; 2 000 orders; 65 % dinner `gauss(13 h, 9 000 s)`, 25 % lunch `gauss(6 h, 3 600 s)`, 10 % uniform over 18 h; stations tandoor slot 60 × 180 s, karahi slot 50 × 1 200 s, BBQ slot 30 × 900 s, degh batch 100 × 60 s, tawa slot 8 × 300 s; lines per order as the drill's `MENU` = tandoor 3.0, karahi 0.6, BBQ 0.4, degh 0.5, tawa 0.3; target = max cook + 300 s; Start / Done on time), the policy report (D22), `docs/stories/03a-sim/*.py`.

**Files:** Create `packages/engine/test/sim/{generate,run,report,index}.ts`, `packages/engine/test/sim/harness.test.ts` (engine project, a 200-order day); modify `packages/engine/package.json` (`./sim` export, P-12), `packages/engine/src/lint.test.ts`.

- [ ] **Step 1: Tests:** `[03a §10.6 harness]` seed 7 → the same event list twice (deterministic seeded PRNG in test code only); a 200-order day ends with live state = `buildEngineState(events)` (deep equal); `policyReport` gives % promises kept, max late, mean wait by order type, cold time, utilisation for FIFO / EDF / Waada Guard; no breach reported.
- [ ] **Step 2:** FAIL → **Step 3:** port the drill's generator and Start / Done driver to TypeScript on the real engine (`planOrder` → the §4.2 batch → `applyEvent`; `getTickIntents` every 500 ms of simulated time) → **Step 4:** PASS.
- [ ] **Commit:** `test(03a): task 18a simulator harness [spec §10.6, D22]`

### Task 18: Simulator perf gate — RISK: HIGH — Shared — GATE

**Spec:** §10.6 asserts, §7.1, §12.1 DoD 6, BF-7 measurement, P-11.

**Files:** Create `packages/engine/test/sim/day.perf.test.ts`, `packages/engine/test/sim/overload.perf.test.ts`; modify this plan ("Simulator bounds" section) and `docs/plans/03a-status.md` (§7.1 table).

**Invariants:** the asserted numbers are the spec's (§7.1); the only number the plan sets is the re-placed-lines bound (P-11); a miss of the 50 ms p99 is never "fixed" by loosening a bound.

- [ ] **Step 1: Tests (perf project):** `[03a §10.6]` re-plan per submit (`planOrder` + the fold re-plan) p99 ≤ 50 ms; full-day replay from a checkpoint ≤ 45 s; 2-day replay (`twoDayLog`) ≤ 80 s; snapshot serialisation at design size (`JSON.stringify` of the peak state, its size recorded) ≤ 50 ms — the full write (serialise + insert in its own transaction) is asserted ≤ 50 ms in task 21 on the same state (P-12); events ≈ R6 (±20 %; the drill: ≈ 65.9k fires and dones replayed); live = replayed; overload day (tandoor 125 %) probes ≤ 16 and p99 ≤ 50 ms; BF-7: a 20-line `StockAdded` at peak inside the 50 ms; re-placed lines per station re-plan **reported** (p50 / p99 / max).
- [ ] **Step 2:** run once; record every number in `03a-status.md` §7.1 (with the drill's Python numbers beside them).
- [ ] **Step 3:** set the re-placed-lines bound by P-11, write it into "Simulator bounds" below and into the test as an assert; run again green.
- [ ] **Step 4 (stop rule):** if any spec bound misses, **stop the build**, record it in the status board's open items and ask the developer for a spec bump (§7.1, §12.5); do not start batch 6.
- **Done when:** the perf project is green in `pnpm -w test` and the numbers are committed.
- [ ] **Commit:** `test(03a): task 18 simulator perf gate, bounds recorded [spec §10.6, §7.1, §12.1 DoD 6; BF-7]`

**Simulator bounds** (task 18, normal peak day, AD-27): re-placed lines per station re-plan — p50 23, p99 223, max 240; P-11 gives p99 ≤ 270, **computed, not yet asserted** (adding it needs a perf run). Old day, before AD-27: 414 / 1 841 / 1 894.

---

## Batch 6 — 01a v2.1 cloud (A-1–A-13)

The cloud tasks follow 01a's existing patterns (C1 route cases, C6 nested replace-lists, R30 `expected_version`, `Idempotency-Key` on POST, audit rows, `bumpEveryBranch` / branch bumps). Tests are `apps/cloud/test/**/*.int.test.ts` beside 01a's.

### Task C1: Cloud migration `0007_engine_config.sql` — RISK: NORMAL — 01a — needs Docker Postgres

**Spec:** 01a v2.1 §5.2a (A-1–A-13), partial index `points_branch_name_active`.

**Files:** Create `apps/cloud/src/db/migrations/0007_engine_config.sql`; test `apps/cloud/test/db/engine-config-migration.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §5.2a]` migrate a `0006` database with two branches and stations: every A-row table / column exists with its range CHECKs and defaults; each branch has one "Pass" point and every station's `point_id` is it, then NOT NULL; `points_branch_name_active` refuses a second active "Pass", allows one archived; `station_alternates` refuses `home_for_order_types ⊄ order_types` and an empty `order_types`; `branch_engine_settings` defaults equal Global Constraints; every new table has `tenant_id`, `version`, `created_at`, `updated_at`.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS; existing migration tests green.
- [ ] **Commit:** `feat(01a): task C1 cloud migration 0007_engine_config [01a v2.1 §5.2a; 03a §4.5 A-1–A-13]`

### Task C2: Station routes — engine fields, alternates, carry times — RISK: NORMAL — 01a — needs Docker Postgres

**Spec:** 01a §6.8, §6.9 (A-2–A-10 markers), C1, C6; `point_id` must be an active point (`422 CONFIG_REFERENCE_INVALID { field: 'point_id' }`); alternates both slot, same branch, distinct.

**Files:** Modify 01a's station service / repository / routes and `packages/events/src/admin/restaurant.ts` wire types; test `apps/cloud/test/restaurant/stations-engine.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §6.9 A-2–A-10]` POST with defaults returns every engine field; PATCH each field at both range ends and one past (`400`); `alternates` and `carry_times` replace-lists (empty clears); a batch alternate, another branch's station, self → `422`; archived point → `422 { field: 'point_id' }`; GET lists `points` and the fields; statement count of GET (+1 for points).
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(01a): task C2 station engine fields, alternates, carry times [01a v2.1 §6.8, §6.9; 03a §4.5 A-2–A-10]`

### Task C3: Points routes — RISK: NORMAL — 01a — needs Docker Postgres

**Spec:** 01a §6.9a; §12.3 Q-v2.1-1 (`404 POINT_NOT_FOUND`), Q-v2.1-2 (`409 CONFIG_IN_USE { entity: 'point', id, used_by: { entity: 'station', ids } }`); route cases (C7), `Idempotency-Key`, R30.

**Files:** Create the points route / service files in 01a's restaurant module; modify `apps/cloud/test/helpers/route-cases.ts`, `apps/cloud/test/cross-tenant.int.test.ts` (route list); test `apps/cloud/test/restaurant/points.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §6.9a]` POST `{ name, sort_order? }` → `201`, branch bumped; missing `Idempotency-Key` → `400`; retransmit → same `201`; duplicate active name → `409 CONFIG_NAME_TAKEN`; PATCH rename / sort / archive / restore with `expected_version` (stale → `409` as R30); `[01a §12.3 Q-v2.1-1]` unknown `point_id` (and another tenant's) → `404 POINT_NOT_FOUND`; `[01a §12.3 Q-v2.1-2]` archive with an active station naming it → `409 CONFIG_IN_USE { entity: 'point', id, used_by: { entity: 'station', ids } }`, with only archived stations → `200`; restore re-checks the name.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS; route-inventory test green (28 → 30 cloud routes, 01a §6.24).
- [ ] **Commit:** `feat(01a): task C3 points routes [01a v2.1 §6.9a, §12.3 Q-v2.1-1, Q-v2.1-2; 03a §4.5 A-1]`

### Task C4: Item knobs, goes-with on category and item — RISK: NORMAL — 01a — needs Docker Postgres

**Spec:** 01a §6.13, §6.15 (A-11, A-13 markers), §6.11 menu read.

**Files:** Modify 01a's menu-item and category services / wire types; test `apps/cloud/test/restaurant/item-timing.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §6.15 A-11]` PATCH each knob at range ends and past (`400`); defaults on create; last write wins (no `expected_version`, S23); `[01a §6.13 A-13]` category `goes_with` replace-list; item adds and `excluded` overrides; unique row; the menu read returns them; a link to another tenant's item → `422`.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(01a): task C4 item knobs and goes-with links [01a v2.1 §6.11, §6.13, §6.15; 03a §4.5 A-11, A-13]`

### Task C5: Snapshot schema 3 and fixtures to V3 — RISK: NORMAL — 01a — Shared

**Spec:** 01a §4.3 (schema 3 marker), 03a §4.5 "Snapshot schema 3"; sorting as 01a §4.3; R29.

**Files:** Modify `packages/events/src/config.ts`, `packages/events/testing/index.ts` (every config fixture builder to V3), `packages/events/src/config.test.ts`; expectation-only edits where fixtures are consumed (AD row if outside the list).

- [ ] **Step 1: Tests:** `[01a §4.3 V3]` `BranchConfigSnapshotSchemaV3` parses a full fixture; refuses `snapshot_schema_version` 2; `points`, `stations[].alternates`, `carry_times`, `goes_with` sorted; `engine_settings` has every A-12 key incl. `returns_boost`, `order_abandon_ms`, `table_lock_ttl_ms`.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS; `pnpm -w typecheck` (fixtures move everywhere).
- [ ] **Commit:** `feat(01a): task C5 snapshot schema 3 and fixtures to V3 [01a v2.1 §4.3; 03a §4.5]`

---

## Batch 7 — 01a v2.1 cloud (cont.), owner app

### Task C6: Snapshot builder V3, hub apply V3, sync bound — RISK: NORMAL — 01a, 01b (B-8) — needs Docker Postgres

**Spec:** 01a §4.3, §6.1, S28 b (hub on v2 refuses schema 3 and polls again; this build's hub parses V3 only), 01b v1.5 B-8 (≤ 32 / ≤ 27; directory-only ≤ 17, `304` unchanged).

**Files:** Modify the cloud snapshot builder (5 statements: `selectPoints`, `selectStationAlternates`, `selectCarryTimes`, `selectEngineSettings`, `selectGoesWith`), `apps/hub/src/sync/branch-config-holder.ts`, the hub config views that read V2; tests: re-baseline the sync bound test and 01c's builder / snapshot tests; `apps/hub/test/sync/config-v3.int.test.ts`.

- [ ] **Step 1: Tests:** `[01b B-8]` `GET /v1/sync/config` `200` with the directory ≤ 32 statements, config-only ≤ 27, directory-only ≤ 17, `304` unchanged; `[01a §4.3 V3]` the built body parses as V3 and is stable (hash equal across two builds); hub applies V3, refuses V2 (logs, polls again).
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(01a): task C6 snapshot builder V3, hub apply V3, sync bound [01a v2.1 §4.3, §6.1; 01b v1.5 B-8; 03a §4.5]`

### Task C7: Branch settings endpoint engine fields — RISK: NORMAL — 01b (B-6) — needs Docker Postgres

**Spec:** 01b v1.5 §6.10 (B-6), 01a A-12 ranges and defaults; one transaction with the branch settings, one audit row, `expected_version` (B23).

**Files:** Modify 01b's branch settings service / wire; test `apps/cloud/test/staff-roles/branch-settings-engine.int.test.ts`.

- [ ] **Step 1: Tests:** `[01b B-6]` GET returns every engine setting with defaults; PATCH each at range ends and past (`400`); one audit row; stale version → `409 CONFIG_STALE`; the branch's config is bumped.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(01b): task C7 branch settings engine fields [01b v1.5 B-6; 01a v2.1 A-12; 03a §4.5]`

### Task C8: Owner app — Points page, station "Timing" group — RISK: NORMAL — 01a — UI

**Spec:** 01a §8.1 (03a D1, A-1–A-10 marker); 01a S50 dialogs and shell; i18n keys as 01a §8.3.

**Files:** `apps/client/src/features/owner/points/*`, `apps/client/src/features/owner/stations/*` (Timing group, alternates and carry-time lists), shell menu entry; tests beside them.

- [ ] **Step 1: Tests:** Points list / create / rename / archive with the `409 CONFIG_IN_USE` message naming the stations; station form shows every A-2–A-8 field with its default and range errors from the server; alternates editor offers only slot stations of the branch; carry-time list per point.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(01a): task C8 owner app points page and station timing [01a v2.1 §8.1; 03a §4.5 A-1–A-10]`

### Task C9: Owner app — "Kitchen timing", item "Timing", goes-with — RISK: NORMAL — 01a — UI

**Spec:** 01a §8.1 (A-11–A-13), 01b v1.5 B-6.

**Files:** `apps/client/src/features/owner/branches/*` (Kitchen timing group), `apps/client/src/features/owner/menu/*` (item Timing group, goes-with picker, category default); tests beside them.

- [ ] **Step 1: Tests:** Kitchen timing shows every A-12 field with defaults, saves with `expected_version`, shows a stale-version message; item Timing group edits the five knobs; goes-with picker adds category / item targets and item excludes; minutes shown, ms sent (`minutes.ts`).
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(01a): task C9 owner app kitchen timing, item timing, goes-with [01a v2.1 §8.1; 01b v1.5 B-6; 03a §4.5 A-11–A-13]`

---

## Batch 8 — Hub host core (§11 tasks 19–22a)

### Task 19: Hub migration `0007_engine.sql` — RISK: NORMAL

**Spec:** §5.1 (SQL verbatim).

**Files:** Create `apps/hub/src/db/migrations/0007_engine.sql`; test `apps/hub/test/db/engine-migration.int.test.ts`.

- [ ] **Step 1: Tests:** `[03a §5.1]` migrate a `0006` database: both tables and three indexes exist with the §5.1 names (`sqlite_master`); `EXPLAIN QUERY PLAN` of the §3.12 replay statement uses `events_branch_stream`.
- [ ] **Step 2:** FAIL → **Step 3:** SQL byte-identical to §5.1 → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 19 hub migration 0007_engine [spec §5.1]`

### Task 20: Boot steps 2, 3, 6; reducer; H-1; A-15, A-17 — RISK: HIGH — 00 (H-1), 01a (A-15, A-17)

**Spec:** §3.12 (step 2 `LIMIT 2` reads, step 3 four filtered statements merged by `seq`, two `stock_version` reads, step 6 flags), §3.6.2, §6.3, §7.2 boot log, 00 v1.7 H-1, 01a A-15, A-17; P-6, P-7.

**Files:** Create `apps/hub/src/engine-host/{boot-steps,reducer,replay,host-flags,index}.ts`; modify `apps/hub/src/lib/boot.ts` (H-1 fields, step 8 `missed_fires`, reducer), `apps/hub/src/sync/boot-steps.ts` (drop the step-3 fold), `apps/hub/src/sync/stock-version.ts`, `apps/hub/src/main.ts`; tests `apps/hub/test/engine/boot.int.test.ts`.

**Invariants:** step 2 = 2 statements, step 3 = 4 + 2, step 6 = 0; `audit` never read; a boot never writes an event; the live reducer and the replay use the same `applyEvent` with the breach logger.

- [ ] **Step 1: Tests:** `[03a #57]` snapshot v3 loaded; a v2 snapshot skipped → checkpoint → one-day replay; no checkpoint → seq 0; `[03a #58]` only the four lists are read; an `audit` row and a non-slip order-stream alert are skipped; `EXPLAIN QUERY PLAN` uses the index; `[03a #64]` crash restart of 500 events ≤ 2 s (steps 2–3); `[03a #85]` `stock_version` after a snapshot boot equals a full-scan value incl. `ItemMadeUnavailable` and the three new stock events; `[00 H-1]` `ctx.clock` set after 3a, step 6 reads it; `[03a §7.2]` a replayed breach is logged with `replay: true`; absent-id fold logged once; slow fold `warn` (P-7, with a fake 60 ms fold). **Review Focus 5:** `engine_version 4` row, `checkpoint_schema 2` row, truncated `state_json` → each skipped with one log line, the fallback used, boot completes.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS; every 01a boot test green with the new step 3.
- [ ] **Commit:** `feat(03a): task 20 boot steps 2, 3, 6, engine reducer [spec §3.12, §3.6.2, §6.3; 00 v1.7 H-1; 01a A-15, A-17; tests #57, #58, #64, #85; Review Focus 5]`

### Task 21: Snapshot and checkpoint writers — RISK: HIGH

**Spec:** §3.12 snapshots (`setImmediate` after a commit crossing a 500 multiple; `last_seq` and state in the same callback; keep 2; delete older versions after a fresh one; SIGTERM sync write; fresh snapshot after a boot that loaded none), checkpoint (only when `noOrderInEngine`; at the close commit or deferred via `checkpoint_pending`; `last_seq` = the close commit's max seq; cleared by a `BusinessDayOpened` commit; keep 2).

**Files:** Create `apps/hub/src/engine-host/snapshots.ts`; modify `host-flags.ts`, `index.ts`; test `apps/hub/test/engine/snapshots.int.test.ts`.

**Invariants:** a snapshot never shares a transaction with a command or tick; the checkpoint's `last_seq` is never a seq inside a commit; at most one checkpoint per business day.

- [ ] **Step 1: Tests:** `[03a #61]` (+ `[03a §7.1 snapshot]` the write of `runDay(generateDay(7))`'s peak state ≤ 50 ms, via `@pos/engine/sim`, P-12); `[03a #112]` (served at 23:20, written at 23:50 after a pass with no listed event, while the order is still in `state.orders`); `[03a §3.12 checkpoint]` the close commit with `StockReleased { day_closed }` → `last_seq` = the `BusinessDayClosed` commit's max seq; a `BusinessDayOpened` before the deferred write clears the flag and the previous checkpoint stands.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 21 snapshot and checkpoint writers [spec §3.12; tests #61, #112]`

### Task 22: `fires` tick, config catch-up — RISK: HIGH

**Spec:** §6.2 (due = `firesDue(…).intents_due || configStale`; freeze-entry frames from `due` with no transaction; checkpoint scheduling; intents steps 1–4), §3.11 catch-up (config only in that pass), §3.6.2 missed fires, §3.6.1 item 4a, D44, F §5.8 step 8.

**Files:** Create `apps/hub/src/engine-host/fires-tick.ts`; modify `index.ts`, `boot-steps.ts` (step 6 `configStale`, `missedFires`); tests `apps/hub/test/engine/fires-tick.int.test.ts`, `apps/hub/test/engine/fakes.ts` (fake `SubmitOrder`, Start / Done drafts).

**Invariants:** idle pass: no statement, no transaction; a pass with work: one transaction, 0 reads + appends; the catch-up pass writes only `EngineConfigApplied`; a throw rolls back only this tick.

- [ ] **Step 1: Tests:** `[03a #60]` step 6 writes nothing; `HubStarted.missed_fires` = the dry count; the first tick dispatches them `reason: 'scheduled'` with `due_at < hub_up_at`; lines fired before the outage are not re-fired; `[03a #62 hub]` statement and transaction counts; pass p99 ≤ 20 ms on the fixture; `[03a #63]`; `[03a #71]` a fake submit and the tick in the same 500 ms: no double fire; `[03a #73]` a `StationCapacitySet` appended between `due` and `intents` → intents computed on the new state; `[03a #79]`; `[03a #95]`; `[03a #111 hub]` the abandon pass writes `StockReleased { abandoned }`.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 22 fires tick and config catch-up [spec §6.2, §3.11, §3.6.2; tests #60, #62 hub, #63, #71, #73, #79, #95, #111 hub]`

### Task 22a: `fires_alerts` tick — RISK: HIGH

**Spec:** §6.2a steps 1–6 (2 `listOpen`, slips with receiver per §3.8 and the stub, overload with `red_since` / `overload_open`, closes, `closeMany` before `raiseMany`, `SlipWarned` from returned ids, none for `deduped`), §3.8 defensive inputs and `skipped`, §3.10 overload check in `due`, flags `day_closed` / `reconcile`, BF-4 (close).

**Files:** Create `apps/hub/src/engine-host/fires-alerts-tick.ts`; modify `index.ts`, `host-flags.ts`; test `apps/hub/test/engine/fires-alerts-tick.int.test.ts` (kinds stubbed as 01d test fakes until task 23).

**Invariants:** not due → no statement, no transaction, also while a raised slip or overload persists; a throw rolls back only this tick; with work: 2 + ≤ 1 + 01d bounds.

- **AD-8 condition (developer, 2026-11-06):** every `invalid_event` diagnostic that dropped a line (AD-8 c) raises a 01d `info` alert to managers: kind `engine_line_dropped`, `values { order_id, order_item_id, reason }`, dedupe `engine_line_dropped:<order_item_id>`; the host also logs it at `warn` (task 20). The kind is defined with this task's fakes and registered with the others in task 23.
- [ ] **Step 1: Tests:** `[03a AD-8]` a dropped line raises one `engine_line_dropped` alert to managers with its values, and a second fold of the same line does not raise a second; `[03a #76]`, `[03a #82]`, `[03a #86]` (60 s idle with Next entries; 60 s with one raised slip and one raised overload unchanged), `[03a #93]`, `[03a #113]`; `[03a BF-4 hub]` an abandoned key's alert is closed `done`.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 22a fires_alerts tick [spec §6.2a, §3.8, §3.10; BF-4; tests #76, #82, #86, #93, #113]`

---

## Batch 9 — Station plan, kinds, hook, stock commands, devices (§11 tasks 22b–24)

### Task 22b: `station_plan` catch-up and frame — RISK: NORMAL

**Spec:** §3.6.3 (body, audience: that station's station sockets and every staff socket; one frame per changed station per commit; freeze-entry frames from `due`), §6.4, 00 H-4 `sendToDevices`, P-7.

**Files:** Create `apps/hub/src/engine-host/station-plan.ts`; modify `index.ts`, `fires-tick.ts`; test `apps/hub/test/engine/station-plan.int.test.ts`.

- [ ] **Step 1: Tests:** `[03a #83]` (catch-up body per station; a station session gets only its own; one frame per changed station after a commit; a freeze-entry frame from `due` with no transaction and no statement; never twice per pass); catch-up 0 statements.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 22b station_plan catch-up and frame [spec §3.6.3, §6.4; test #83]`

### Task 23: Kinds `slip_warning`, `station_overload` — RISK: NORMAL

**Spec:** §3.8 kind (family `action`, subject order, `named`, `needs_pin: 'never'`, labels, steps 0 / 1 at `escalate_ms`, `closes_on: 'owner'`, schemas), `apply` on accept / decline, §3.10 kind (`info`, dedupe `station_overload:<station_id>`, managers, card text), 01d N-1, Q2, Q6.

**Files:** Create `apps/hub/src/engine-host/kinds.ts`; modify `index.ts`, `fires-alerts-tick.ts` (real kinds); test `apps/hub/test/engine/kinds.int.test.ts`.

- [ ] **Step 1: Tests:** `[03a #65]` raised to the receiver (stub `placed_by`; takeaway / delivery / parking `placed_by`); step 1 escalates to managers; accept → `ItemsReleased` with `alert_id`; decline → nothing; `apply` writes nothing; a non-receiver → `403 not_receiver`; `[03a #67]`; `[03a #72]` accept after the last line went Done → `released` only, the tick close is a no-op; `[03a #77 hub]` `SlipWarned.alert_id` = the `raiseMany` id and `AlertRaised.values.table_key` = its key.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 23 kinds slip_warning and station_overload [spec §3.8, §3.10, §6.4; tests #65, #67, #72, #77 hub]`

### Task 24: Config hook — RISK: NORMAL

**Spec:** §3.11 (`E(next)` = exactly the `EngineConfigAppliedV1` fields from the V3 snapshot; `reference_cook_ms` median rule; append only when `canonicalJson` differs; never throws on valid config; re-evaluates `configStale`), 01a S43.

**Files:** Create `apps/hub/src/engine-host/config-hook.ts`; modify `index.ts`; test `apps/hub/test/engine/config-hook.int.test.ts`.

- [ ] **Step 1: Tests:** `[03a #70]` one `EngineConfigApplied` only when the engine part changed (a price change → none); never throws over a fuzz of 200 V3 builder configs; `reference_cook_ms` lower median, base items only, archived excluded, 0 when none; 0 extra statements.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 24 config hook [spec §3.11; test #70]`

### Task A14: 01a stock commands append `stockEffects` — RISK: HIGH — 01a (A-14)

**Spec:** 01a §6.17, §6.17a, §6.18b (A-14 markers), 03a §3.7 batch order, §4.2.

**Files:** Modify `apps/hub/src/commands/{set-precooked-stock,add-precooked-stock,close-business-day}.ts`; extend their existing test files.

**Invariants:** releases before `StockSet` / `BusinessDayClosed`; `StockConsumed` before a unit-changing `StockSet`; `StockReserved` after each `StockAdded`; all in the command's own transaction; the existing statement counts change only by appends.

- [ ] **Step 1: Tests:** `[01a §6.17 A-14]` a count below reserved appends `StockReleased { recount }` for hidden lines, newest `reserved_seq` first, before the `StockSet`; a unit-changing count with held reservations appends `StockConsumed` first (BF-9 re-reserve after); `[01a §6.17a A-14]` `StockReserved` drafts after each `StockAdded` (two entries in one command thread claims, BF-8); `[01a §6.18b A-14]` `StockReleased { day_closed }` before `BusinessDayClosed`, hidden lines and exited lines only.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(01a): task A14 stock commands append stockEffects [01a v2.1 §6.17, §6.17a, §6.18b; 03a §3.7, §4.5 A-14]`

### Task R2: Devices `point_id`, `lane_label` — RISK: NORMAL — 00 (H-5, H-6)

**Spec:** 00 v1.7 §5.1 (H-5, H-6 SQL).

**Files:** Create `apps/hub/src/db/migrations/0008_device_point_lane.sql`; test `apps/hub/test/db/device-point-lane-migration.int.test.ts`.

- [ ] **Step 1: Tests:** `[00 H-5, H-6]` both nullable columns exist after migrating a `0007` database; existing devices keep NULL.
- [ ] **Step 2:** FAIL → **Step 3:** SQL as 00 §5.1 → **Step 4:** PASS.
- **Not here:** the write-time checks (active point; `lane_label` only on a `kds` device with `station_id`) belong to the write path, which 03b's pairing / binding UI builds (00 H-5, H-6 text; open item).
- [ ] **Commit:** `feat(00): task R2 devices point_id and lane_label [00 v1.7 H-5, H-6; 03a §4.5]`

---

## Batch 10 — 01b rows, commands, query (§11 tasks 25, 26)

### Task R1: Permissions `manage-stations`, `mark-served`, defaults — RISK: NORMAL — 01b (B-1, B-2, B-3, B-5)

**Spec:** 01b v1.5 §1.10 B-1, B-2, B-3, B-5; §3.3 scopes; default roles table (Manager all but `manage-roles`; Order taker `mark-served`, `mark-item-returned`; Waiter `mark-served`); no backfill (R29).

**Files:** Modify `packages/domain/src/permissions.ts` (+ test), `default-roles.ts` (+ test), the roles editor catalogue if it is not derived from `PERMISSION_CATALOGUE` (else no client change).

- [ ] **Step 1: Tests:** `[01b B-1, B-2]` both permissions in `PERMISSIONS` and the catalogue with their groups and scopes; `[01b B-5]` `mark-item-returned` defaults Owner, Manager, Order taker; `[01b B-3]` the roles editor lists both; directory statement count unchanged.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(01b): task R1 permissions manage-stations and mark-served [01b v1.5 B-1, B-2, B-3, B-5; 03a §4.5]`

### Task R1b: Responsibility `run_station` — RISK: NORMAL — 01b (B-4) — needs Docker Postgres

**Spec:** 01b v1.5 B-4 (§3.6, §4.2, §5.1, §5.2, §5.3): kind assignable per station like `count_stock`; `stationsOf(staff, 'count_stock' | 'run_station')`; `my_stations` for `manage-stations` through `run_station`; the CHECK widened by a forward migration on each side.

**Files:** Create `apps/cloud/src/db/migrations/0008_run_station.sql`, `apps/hub/src/db/migrations/0009_run_station.sql` (SQLite table rebuild of `responsibilities` with the widened CHECK, rows copied); modify `packages/events/src/directory.ts`, `packages/events/src/admin/staff.ts`, cloud staff-roles repository / service / versions, `apps/hub/src/auth/staff-directory.ts`; tests beside them.

- [ ] **Step 1: Tests:** `[01b B-4]` cloud: a `run_station` responsibility is created, listed, versioned and synced; hub: the directory carries it with no new statement; `stationsOf(staff, 'run_station')` returns the stations; both migrations keep every existing row; `count_stock` behaviour unchanged.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- **Not here:** an owner-app screen to assign `run_station` — 01b v1.5 defines none (open item).
- [ ] **Commit:** `feat(01b): task R1b responsibility run_station [01b v1.5 B-4; 03a §4.5]`

### Task 25: `set-station-capacity` — RISK: NORMAL

**Spec:** §6.6 (station session own station, `lane_off` / `lane_on` only, `≤ capacity`; staff `manage-stations` with `my_stations` scope last, C8; steps 1–7; no-op shape `changed: false`), D32, D45, §3.10.

**Files:** Create `apps/hub/src/commands/set-station-capacity.ts`; modify the command registry; test `apps/hub/test/engine/set-station-capacity.int.test.ts`.

- [ ] **Step 1: Tests:** `[03a #68]` every case in the §10.2 row (happy; `400`; `404 STATION_NOT_FOUND`; `403 outside_scope`; no-op same shape; retransmit; COMMIT failure leaves live state; station session own station with `lane_off` → `200`, `actor_id null`, KDS `device_id`; `reason 'manager'` from a station session → `403`; override > `capacity` from a station session → `400 { field: 'capacity_override' }`; staff up to 100).
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 25 set-station-capacity [spec §6.6; test #68]`

### Task 25b: `set-station-pause` — RISK: NORMAL

**Spec:** §6.7 (staff only; `409 STATION_PAUSE_DISABLED` before `403 outside_scope`; unpause always allowed; same response shape).

**Files:** Create `apps/hub/src/commands/set-station-pause.ts`; test `apps/hub/test/engine/set-station-pause.int.test.ts`.

- [ ] **Step 1: Tests:** `[03a #69]` every case in the §10.2 row.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 25b set-station-pause [spec §6.7; test #69]`

### Task 26: `stations-live` query, catch-up, audiences — RISK: NORMAL

**Spec:** §6.5 (device session, `allowStation: true`, `countsAsActivity: false`, `station_ids ≤ 50`, 0 statements, `as_of_seq`, unknown ids left out), §6.4 audiences (`EngineConfigApplied`, `StationCapacitySet`, `StationPauseSet` → every staff and station socket; none on the order stream), catch-up part `stations_live`.

**Files:** Create `apps/hub/src/queries/stations-live.ts`; modify the query registry, `engine-host/index.ts`; test `apps/hub/test/engine/stations-live.int.test.ts`.

- [ ] **Step 1: Tests:** `[03a #66]` 0 statements; body = `stationsLive` + `as_of_seq`; 51 ids or a non-string → `400 VALIDATION_FAILED`; ≤ 5 ms; `[03a §6.4]` the three station events reach staff and station sockets; an order-stream event reaches no catch-all audience; catch-up part 0 statements.
- [ ] **Step 2:** FAIL → **Step 3** → **Step 4:** PASS.
- [ ] **Commit:** `feat(03a): task 26 stations-live query, catch-up part, audiences [spec §6.4, §6.5; test #66]`

---

## Batch 11 — Property, manual checks, as-built (§11 tasks 27, 28; §12)

### Task 27: Property live = replay; race 74 — RISK: HIGH

**Spec:** §10.2 #59, §10.3 #74, §2.1.

**Files:** Test `apps/hub/test/engine/live-replay.property.int.test.ts`, `apps/hub/test/engine/races.int.test.ts`.

- [ ] **Step 1: Tests:** `[03a #59]` 50 seeds of a mixed day (from `@pos/engine/sim`, P-12) through the hub (fake submits, ticks, Start / Done fakes, a recount, a capacity change, a boost, a return, a close and open): live state deep-equals a fresh boot's replayed state, also from a snapshot and from the checkpoint; no breach logged; `[03a #74 hub]` two concurrent fake submits claiming the last unit: the second gets `cook_fresh` or `refused`.
- [ ] **Step 2:** run → fix any divergence as a `fix(03a)` commit in the owning task's files (AD row if it changes behaviour).
- [ ] **Commit:** `test(03a): task 27 live equals replay property, race 74 [spec §10.2, §10.3; tests #59, #74 hub]`

### Task 28: Pilot-box manual checks — Manual

**Spec:** §7.1, §12.1 DoD 2, §5.1 index build note.

- [ ] **Step 1:** Write `docs/plans/03a-manual-checks.md`: on the pilot mini PC, run the perf project and test 64 (`POS_PILOT_HW=1`), record re-plan p99, fires / fires_alerts pass p99, snapshot write, crash restart, full-day and 2-day replay (steps 2–3 and the whole boot, the ≈ 10 s for steps 4–8), `stations-live`; the `events_branch_stream` build time over a seeded month; a real KDS / admin smoke of capacity, pause and the `station_plan` frame.
- [ ] **Step 2:** The developer runs it; results recorded there. Open until the hardware is available (not a merge blocker, like 01d #58), unless a number misses: then stop (§7.1).
- [ ] **Commit:** `docs(03a): task 28 pilot-box manual checks [spec §7.1, §12.1]`

### Task 29: Final review and as-built spec

**Spec:** §12.1 DoD, §12.2, §12.6, CLAUDE.md pipeline step 8, P-10.

- [ ] **Step 1:** Controller: the gate on a clean checkout (fresh `pnpm install`, Postgres up); coverage script — every `[03a #N]` for N in 16–119 and `[03a F #N]` for 1–15 appears exactly as the Coverage table says (split tags counted once per half); `grep -rn "Date.now\|Math.random\|performance.now" packages/engine/src` empty.
- [ ] **Step 2:** Fresh opus reviewer on `main..module-03a` against the spec, this plan, the A / B / H rows and every AD row: §12.2 checklist, each BF with its test, each HIGH task's invariants. Findings fixed one commit each.
- [ ] **Step 3:** As-built spec `docs/specs/03a_Timing_Engine_Spec_v1.1.md` (draft for the developer): AD rows, P-5, the Review Focus 1 rule, BF-9 / BF-10 options taken, BF-11 text (§12.3 rows, To 02 label "no tap on any line for N h", §9 `ORDER_NOT_IN_ENGINE` abandon wording), the re-placed-lines bound; the A / B / H as-built notes for 01a, 01b, 00 if any AD touched them; README module map row. Developer approval before merge.
- [ ] **Step 4:** Stop for the developer: merge `module-03a` to `main` only after the as-built spec is approved and task 28 is recorded or explicitly deferred.
- [ ] **Commit:** `docs(03a): v1.0 → v1.1 as built, AD rows, BF-1–BF-14 [spec §12]`

---

## Open items this plan could not place (developer)

1. **Command halves of #101, #103, #107 (`409 RETURN_ALREADY_OPEN`), #114** are 02's commands; 03a writes the fixture and engine halves (P-3). Carried in README "To 02" #1, #8.
2. **`run_station` assignment screen:** 01b v1.5 adds the kind but no owner-app screen; until one is specified, `my_stations` scope for `manage-stations` can be set only through the API. Manager's default `branch` scope covers the pilot.
3. **Device write checks for H-5 / H-6** (active point, `lane_label` only on a `kds` with `station_id`): no write path exists in 03a; they land with 03b's pairing / binding UI (and 01e's headless side).
4. **Task 28** needs the pilot mini PC; open after merge unless a §7.1 number misses.
5. **Q12** (a customer's own wrong order: free remake vs void + new charged line) is still open in 03a §12.3; it is 02's / 04's and blocks no 03a task.

## Self-review notes

- Spec coverage: §6 rows 6.1a–6.1m → tasks 3–17; 6.2 → 22; 6.2a → 22a; 6.3 → 20, 21; 6.4 → 22b, 23, 24, 26; 6.5 → 26; 6.6 → 25; 6.7 → 25b. §5.1 → 19. §4.5: F-rows are spec text (applied) plus the §6.2 appends (task 0); A-1–A-13 → C1–C9; A-14 → A14; A-15, A-17 → 20; A-16 → 3; A-18 text; A-19 → 1b; A-20 → 12; B-1–B-5 → R1, R1b; B-6 → C7; B-7 none; B-8 → C6; H-1 → 20; H-5, H-6 → R2. §12.1 DoD 1 → 29, 2 → 28, 3 applied, 4 configuration (pages in C8, C9), 5 applied, 6 → 18.
- Every §10 test 16–119 and F 1–15 is in the Coverage table; BF-1–BF-14 each have a task and a test.
- Names checked across tasks: `liveInterval(state, order_item_id, t)`, `nextDueAt(state, t)`, `planOrder(…, from_stock)`, `toCheckpoint` / `fromCheckpoint`, `touchedStations`, `registerEngineHost`, `registerEngineBootSteps`.
