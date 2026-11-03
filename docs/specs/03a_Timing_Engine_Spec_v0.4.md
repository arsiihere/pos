# 03a Timing Engine (package + hub host) — Spec v0.4 (DRAFT)

| | |
|---|---|
| Status | **v0.4 — G2 applied, ready for G4** (2026-11-03): v0.3 + the G2 completeness check `docs/reviews/03a_v0.3_g2_completeness.md` (0 BLOCKER, 7 MAJOR, 21 MINOR; FIX THEN PASS) applied with the developer decisions of 2026-11-03 for the majors; the two pre-G2 items closed only in part (#37, #38) are closed. Every edit carries "Changed in v0.4 (G2 #n)"; a finding not applied as proposed is recorded in §12.3 with the reason. No `[owner]` marker added. §4.5 is still **Proposed — needs approval**. **v0.3 — ready for G2** (2026-11-03): v0.2.1 + the owner answers of 2026-11-03 (`03a-g0.md` §4 "Owner answers", both batches). Every `[owner — pending field visit]` marker and §3.13 are removed: by the owner's ruling these are **configuration, never spec numbers**; their proposed values survive only as config defaults in §4.5 (01a v2.1, 01b v1.5 rows), and the pilot values are entered at setup (01a pages). Marked "Changed in v0.3". **v0.2.1 DRAFT** (2026-11-03): v0.2 + three patches marked "Changed in v0.2.1": no transaction for freeze-entry frames (§3.6.3), the load id is a name (§3.3), Q10 and Q11 closed (§12.3, §4.5). **v0.2 DRAFT** (2026-11-03): v0.1.1 + the pre-G2 consistency check `docs/reviews/03a_v0.1.1_pre_g2.md` (#1–#38) applied with the developer decisions of 2026-11-03; every edit carries "Changed in v0.2 (pre-G2 #n)"; findings not applied are recorded in §12.3 with the reason. Still **not reviewed**; G2 then waited for the field visit (closed by v0.3). **v0.1.1 DRAFT** (2026-11-03): v0.1 + D28 return to kitchen (§3.8a; owner answers 2026-11-03), no other change. **v0.1 DRAFT** (2026-11-02). Not reviewed. G2 then did not run (closed by v0.3) until every `[owner — pending field visit]` marker (§3.13) is answered at the Lake City visit (`docs/stories/field-visit-03a-02-05.md` §A; lesson 1, field first). §4.5 is **Proposed — needs approval**. |
| Source | `docs/stories/03a-g0.md` (G0 + G1: D1–D28, §3 contradictions #1–#13, §5 spec changes, §6 / §6b drills, §7 open questions). Each rule below cites its D-id or `§3 #n` of that file. Rules this draft adds where 03a-g0 is silent are marked **P-n (proposed by this draft)** and listed in §12.3. |

### Changes in v0.4 (G2 completeness check, developer decisions 2026-11-03)

Source: `docs/reviews/03a_v0.3_g2_completeness.md`. Each edit is marked "Changed in v0.4 (G2 #n)".

| # | Change | Where |
|---|---|---|
| 1 (M1) | 00 rows H-5 `devices.point_id` and H-6 `devices.lane_label` (00 v1.7); a lane = a `kds` device with `station_id` and `lane_label`, not revoked; `capacityForLanes` takes `lane_count` as an input; pairing / binding UI → To 03b, To 01e | §3.10, §4.3, §4.5, §6.1m |
| 2 (M2) | Sync bound with the directory ≤ 32 (27 + 5), config-only ≤ 27; new 01b row B-8 owns it (R32 c) | §4.5 |
| 3 (M3) | Exit is a pure predicate `inEngine(order, t)` over the `recorded_at` of **listed** events only; `isOrderInEngine` exported; physical removal only in listed folds; static test: handled types = §3.12 lists | §3.3, §3.12, §4.2, §6.1a, §10 |
| 4 (M4) | `EngineState.next_alert_due_at` (pure); `fires_alerts.due = now ≥ next_alert_due_at` (or host overload / day-close / boot flags), no statement; `slips[key]` keeps `resolved_at` until its `AlertClosed` is folded; `SlipWarned` carries `alert_id` again; idle kitchen opens no transaction | §3.3, §3.6, §3.8, §3.12, §6.2a, §10 |
| 5 (M5) | Checkpoint body carries `business_day`; `last_seq` = max seq of the commit that folded `BusinessDayClosed` | §3.12, §5.1, test 55 |
| 6 (M6) | 00 H-1 adds `clock?` to `BootContext`; step 6 reads `ctx.initialState` and `ctx.clock` | §3.6.2, §4.5, §6.3 |
| 7 (M7) | `StockAdded` reserves for that stock item's unfired `from_stock = false` lines in deadline order (`reserveStock`), then re-plans their stations (foundation D23); 01a's carried row stands | §3.3, §3.7, §3.11, §6.1f, test 87 |
| 8–28 | Minors: stale tests 46, 61, 62; "pending A9 / A1"; counters; new tests 87–95; snapshot assert; override range; F-2; F §5.8 fresh snapshot; points `POST` idempotency; frame audience; one response shape; `unit_changed` dropped; catch-up pass; day-close flag at boot; `E(next)`; backfill; index build; `table_lock_ttl_ms`; self-review refreshed | as marked |
| Pre-G2 #37, #38 | Test 61 "keep 2"; snapshot write ≤ 50 ms asserted in §10.6 | §10.2, §10.6 |

### Changes in v0.3 (owner answers, 2026-11-03)

| # | Change | Where |
|---|---|---|
| 1 | Every field-visit marker and §3.13 removed; no station or item names and no restaurant numbers in §3; defaults kept only as config defaults in §4.5 ("pilot values entered at setup, 01a pages") | §3, §4.5 |
| 2 | A2 `capacityForLanes = lanes_on × lane_units`, `lane_units` default = capacity ÷ lane count | §3.10, §4.5 A-8 |
| 3 | A5 / A8 hold at pass is a hint on the assembler view, never a block (01d K4) | §3.4, §4.3 To 03b |
| 4 | Defaults: `two_tap` (A11), `boost-order` Owner, Manager (A10), `manage-stations` Manager (A7), one point "Pass" (A12), `goes_with_links` empty (B21), `returns_boost` **true** (Q15a: a return never queues) | §4.5 |
| 5 | Q12 stays open; A14 (pieces per hour at peak) is a simulator input only | §12.3, §10.6 |

### Changes in v0.2.1 (developer, 2026-11-03)

| # | Change | Where |
|---|---|---|
| 1 | A line entering Next is time passing, not an event: the `station_plan` frame for it is sent from the `fires` tick's `due` wrapper, outside any transaction; no empty `writer.run`; 01d's idle rule holds with no exception | §3.6.3, §6.2, §10 tests 83, 86 |
| 2 | The load id is a name, not membership | §3.3, §4.2 |
| 3 | Q10 closed (reading kept); Q11 closed: engine settings in 01b's branch settings endpoint, station engine fields, alternates and carry times in 01a's station resource, goes-with on the item and category PATCHes; 01a 28 → 30 endpoints | §12.3, §4.5 |

### Changes in v0.2 (pre-G2 consistency check, developer decisions 2026-11-03)

Source: `docs/reviews/03a_v0.1.1_pre_g2.md` (1 BLOCKER, 16 MAJOR, 21 MINOR). Each edit is marked "Changed in v0.2 (pre-G2 #n)" or "v0.2, pre-G2 #n".

| # | Change | Where |
|---|---|---|
| 1 | Second tick `fires_alerts` for slip and overload alerts; `fires` writes engine intents only; `SlipWarned` drops `alert_id` (join through `AlertRaised.values.table_key`); one-tick lag stated; defensive inputs; the engine no longer folds `RequestAnswered` / `AlertClosed` | §3.6, §3.8, §3.12, §6.2, §6.2a |
| 2 | Exit at `BusinessDayClosed` or 30 min after the last line is served (deterministic on `recorded_at`, no event); `409 ORDER_NOT_IN_ENGINE` (02's code, defined here) | §3.3, §3.8a, §9 |
| 3 | `stock_version` read with 2 statements at boot; three new stock events join `STOCK_VERSION_EVENTS` (A-17) | §3.12, §4.5 |
| 4 | Config catch-up in the first `fires` pass | §3.11, §6.2 |
| 5, 6 | `cook_ms_override` (`adjust_time_ms`) and `max_carry_ms` copied on the line | §3.3, §3.5.5, §3.8a, §4.2 |
| 7 | Deterministic group and load ids | §3.3, §3.5.1, §4.2 |
| 8, 9 | `ProposedOrder` and the `EngineConfigApplied` payload written out | §4.2, §3.11 |
| 11 | Open slip requests closed `obsolete` after day close | §3.8, §6.2a |
| 12 | `station_plan` catch-up part and frame for 03b (F-15) | §3.6.3, §4.3, §6.4 |
| 13 | Move to stock adds the portion (`StockAdded { reason: 'moved' }`, A-19, F-18) | §3.7, §4.2, §4.3 |
| 14 | To 05 row and README R-6 | §4.3, §4.5 |
| 15 | `ReturnToKitchen` permission `mark-item-returned` (F-13, B-5) | §3.8a, §4.3 |
| 16 | Responsibility kind `run_station` (B-4) | §4.1, §4.5, §6.6 |
| 17 | `SetStationCapacity` accepts the station's own KDS session for lane Off / On (00 M30, F-16) | §6.6, §4.3 To 03b |
| 18–38 | Minor: enum, weights, wording, signatures, C8 order, tests, task order, rows C-1, N-2, H-1, F-14, F-17, pointers, references, numbering, retention, snapshot timing | as marked |
| — | Not applied as proposed: #10, #21 (narrowed), #31 (narrowed), #37, #38, H-2, and the load-id choice — reasons in §12.3 | §12.3 |

## §1. Header

| | |
|---|---|
| Module | 03a Timing Engine — `@pos/engine` (pure package) and the hub engine host (R4) |
| Version | v0.4 |
| Depends on | Foundation v1.8 (v1.9 proposed, §4.5), 00 v1.6.1 (v1.6.2 and v1.7 rows proposed, §4.5; v0.4, G2 #1, #6), 01a v2.0.1 (**v2.1 proposed, §4.5 — blocking**: points, carry times, alternates, knobs), 01b v1.4.1 (v1.5 proposed), 01c v1.1, 01d v1.1 |
| Inherits | Shared Standards from Foundation v1.8 (§6), not redefined |
| Stories | E4 "ETA calculation", "Hold-and-fire dispatch", "Slip warning" (P1); engine side of E3 (fire, hold at pass) and E1 stock AC4 (first submit wins); README carried rows "To 03a" (00 owner review; 01a S14/S15/§4.4; R6 sizing; 01c §4.4; 01d §4.3) |
| Learned cook times | E4 P2 — out of scope |

**In scope (D1: nothing on the G1 list is deferred, owner 2026-11-02):** `EngineState` v3; `applyEvent`, `buildEngineState`, `planOrder` / `calculateETA`, `getTickIntents`; slot and batch placement; hold-and-fire; the three station policies (Waada Guard, EDF, FIFO) and item knobs (D3–D6); routing across stations (D8–D10); re-plan on every submit (D13, D24, D25); freeze window and auto-fill (D15, D16); overrun cascade, hold at pass, inferred completion (D33, D42, D60); boost (D4); stock reserve, release, consume (01a, 01c carried rows); split send (`ItemsReleased`, D11, D12); live capacity and lanes (D37, §3 #5); station pause (D21); station pressure and the `station_overload` kind (D19, D20); the `slip_warning` named request kind (D11, §3 #7); return to kitchen as a new expedited line (D28, §3.8a). Hub host: the reducer, boot steps 2, 3 and 6, snapshots and the day-close checkpoint (D26), the replay filter and index (§3 #2), missed fires on the first tick (§3 #3), `registerTick('fires')`, the `onBranchConfigApplied` reaction, the commands `SetStationCapacity` and `SetStationPause`, the query `stations-live`; the CI performance test (D27). *Changed in v0.2 (pre-G2 #1, #12):* the second tick `fires_alerts` and the `station_plan` catch-up part and frame.

*Changed in v0.3:* pilot values (stations, capacities, cook times, points, carry times, weights, thresholds) are configuration entered at setup in the 01a pages; this spec states shapes, rules and config defaults only.

**Out of scope:** every screen (02, 03b, 07). Ready to serve, Handover, the assembler view and the Ready-to-serve kind → **03b** (§3 #6, D2). `TableLockReleased` and the lock state → **02** (§3 #8). Estimated Served → **02** (§3 #12). The commands `SubmitOrder`, `BoostOrder`, `ReleaseItems`, `MarkServed`, `RemoveItem`, `ReturnToKitchen` → **02**; the returned line's bill effect and `ItemReturned` → **04**; `StartItem`, `DoneItem`, `UndoDone`, `GiveMeMore` → **03b**; voids and move-to-stock → **04**. These modules write events whose payloads 03a defines (§4.2). Lane claims (03b, 01e). Learned cook times (P2). The customer tracking page (E9, P2).

---

## §2. Existing architecture that must not change

1. **Pure engine, events only (F §4.7, D44, D45).** `@pos/engine` has no I/O, timers or clock. State changes only through `applyEvent`; tick work is written as events first; the live state is swapped only after COMMIT (`engine-host/writer.ts`). A replay of the log rebuilds exactly the live state; nothing reads a wall clock during `applyEvent` (every time is the event's `recorded_at`).
2. **One writer.** Every write goes through `writer.run` (`BEGIN IMMEDIATE`, better-sqlite3, synchronous). A command and a tick never interleave inside a transaction (01d §3.5 race rule).
3. **One reducer.** `state.setReducer(reducer)` takes one reducer (00 §4.2); 03a's `applyEvent` replaces 01a's and keeps its four cases unchanged (`StockSet`, `StockAdded`, `BusinessDayOpened`, `BusinessDayClosed`, 01a S14/S33, 01c V5/V20).
4. **Stock shape (01a S14, carried row).** `stock[stock_item_id] = { on_hand, reserved, set_at, unit }`, integers in the stock unit, both ≥ 0; `availableStock`, `countIsValid`, `canServeFromStock`, `dayDraws`, `dayStockUnit` keep their 01c v1.1 §4.2 signatures and meaning.
5. **Order line contract (01c §4.3).** `ItemAdded` v1 is unchanged; every field is a D25 copy from `branchConfig()` at order time. A config change never alters an open line.
6. **One tick loop (01d §3.5, §4.2).** 03a registers `{ name: 'fires', due, intents }`; `due` is read-only and cheap; `intents` runs in its own `writer.run`; a throw rolls back only this tick. 01d's `alerts` tick runs first.
7. **Alerts (01d §3.5, §4.2).** Kinds are defined with `defineAlertKind`; a tick raises through `alerts.raiseMany(alerts.tickCtx(tx, now), …)`; request `apply` only reads and returns drafts, each carrying `payload.alert_id`; no catch-all audience on the `order` stream.
8. **Boot ownership (00 §3.8).** Steps 2–3 and 6 are 03a's; 3a, 4, 7, 8 are 00's. `onBranchConfigApplied` hooks run inside the applying transaction and a throw fails the apply (01a S43).
9. **Event store (F §4.1).** Rows are immutable; `seq` is gap-free per branch; upcasting on read (D46).
10. **Command pipeline (00 §3.7, F §6.3).** `POST /commands/:name`, fixed processing order, `processed_commands` idempotency, envelope `{ data }` / `{ error }`.

---

## §3. Domain rules

### 3.1 Module decisions (index)

Every rule in §3.2–§3.12 cites one of these. "Owner module" and "config key" answer 03a-g0 §7 "self-check".

| ID | Rule (short) | Where | Owner module | Config key (01a v2.1 unless noted) |
|---|---|---|---|---|
| D1 | Nothing deferred; cascade, overrun, hold at pass, boost, live capacity, slip, settings all pilot; `two_tap` default | §1, §3.4 (v0.2, pre-G2 #34) | 03a | `stations.completion_mode` |
| D2 | 03a = package + host; Ready to serve/Handover → 03b; lock release, estimated Served → 02 | §1, §4.3 | — | — |
| D3 | Policy per station (`waada_guard` default, `edf`, `fifo`); item knobs; order-type weights incl. `follow_up`; delivery targets the pickup time | §3.5 | 03a | `stations.policy`; `menu_items.{weight_pct, max_early_ms, max_carry_ms, max_late_ms}`; `branch_engine_settings.weight_*_pct` |
| D4 | Waada Guard: the promise never breaks; boost is the one promise-breaker | §3.5.4, §3.9 | 03a | — |
| D5 | Overload: weighted lateness shared evenly | §3.5.6 | 03a | `menu_items.max_late_ms` |
| D6 | `promise_padding_ms` on the promise only; `min_slack_keep_ms` | §3.5.1, §3.5.4 | 03a | `branch_engine_settings.promise_padding_*_ms`, `stations.promise_padding_ms`, `stations.min_slack_keep_ms` |
| D7 | `follow_up` flag set by 02; engine sees only its weight | §3.5.2 | 02 sets, 03a weighs | `branch_engine_settings.weight_follow_up_pct` |
| D8 | Route to the earliest arrival at the point; `min_gain_ms`; allowed stations per order type; `reserve_units` | §3.5.5 | 03a | `station_alternates`, `carry_times`, `stations.reserve_units`, `branch_engine_settings.min_gain_ms` |
| D9 | Ties → home station | §3.5.5 | 03a | `station_alternates.home_for_order_types` |
| D10 | Only hidden ("Later") lines may change station | §3.5.5 | 03a | — |
| D11 | Slip as a 01d `named` request to the table's owner; `send` → `ItemsReleased`; threshold from the engine target | §3.8, §6.2a | 03a kind, 02 table-view path | `branch_engine_settings.{slip_threshold_ms, slip_escalate_ms}` |
| D12 | "Goes with" links pre-tick the Send card; ticked = `expedite` | §3.8 | 01a data, 03a rule, 02 UI | `goes_with_links` |
| D13 | Re-plan on every submit, no events for it, promise never moves | §3.5.3 | 03a | — |
| D14 | Slot station: each unit starts and finishes alone; batch station: a load starts and ends together (v0.3) | §3.6.1 (v0.2, pre-G2 #34) | 01a data | `stations.station_type` |
| D15 | Freeze window | §3.5.3 | 03a | `stations.freeze_ms` |
| D16 | Chef screen Now / Next / Later; auto-fill; Give me more; Undo 30 s | §3.6.1, §3.6.3, §4.3 To 03b (v0.2, pre-G2 #34) | 03a engine, 03b screen | `menu_items.max_early_ms` |
| D17 | Append at the bottom; never reorder what is visible; human-triggered jumps marked | §3.3, §3.6.3, §4.3 To 03b (v0.2, pre-G2 #34) | 03b | — |
| D18 | Start / Done per line | §3.2 | 03b | — |
| D19 | Engine shows and tells; never stops a station by itself | §3.10 | 03a | — |
| D20 | Pressure and `station_overload` | §3.10 | 03a | `stations.pressure_*` |
| D21 | Station pause, setting default off | §3.10 | 03a | `stations.pause_enabled` |
| D22 | Simulator before §10 tests; property tests on the same harness | §10.6 | 03a | — |
| D23 | Adjacent stations (carry 0) and spread-out kitchens are both served by the same routing (v0.3) | §3.5.5 | — | `carry_times` |
| D24 | Occupancy profile is the station timeline | §3.3 | 03a | — |
| D25 | Pruned re-plan; p99 ≤ 50 ms per submit | §3.5.3, §7.1 | 03a | — |
| D26 | Crash restart ≤ 500 events; full replay from the day-close checkpoint only | §3.12 | 03a | — |
| D27 | Simulator day as the CI performance gate | §10.6 | 03a | — |
| D28 | Return to kitchen: fix or remake = a new line at the expedite weight; `fix` cooks for `adjust_time_ms` with no stock draw; `returns_boost` (config; default in §4.5 A-12) | §3.8a, §4.3 To 02 / 03b / 04 | 02 button, 04 bill, 03b marker, 03a line | `menu_items.adjust_time_ms`, `branch_engine_settings.returns_boost` |

### 3.2 Words, lines and units

- **Line** = one `ItemAdded` with `station_id` not null and `line_kind ≠ 'deal'` (01c §3.4.7: a `deal` line is never fired, reserved or planned; deal parts and option children are lines with their own `serve_mode`, 01c §4.4).
- **Units** of a line = `quantity` when `sale_unit = 'piece'`; `1` for a g / ml line; `1` while a weight is pending (`quantity` null, 01c V18: fired normally, cook time is the item's). Units count against station capacity: a line of 4 pieces holds 4 units for one Start and one Done tap (D18). **P-1** (*Changed in v0.3:* confirmed as the shape; the capacity itself is configuration).
- **Cook time** of a line (01c B1): slot station → `stock_time_ms` when served from stock, else `cook_time_ms`; batch station → `stock_program_cook_time_ms` / `program_cook_time_ms` copied on the line, never from config.
- **Target** `T` = the engine's internal land time at the point; **promise** `P = T + padding` = what people see (D6). **Deadline** `d(L) = T − carry(L) − cook(L) − prep(L)` = the latest fire time that lands on target. **Slack** of a placed line = `d(L) − fire(L)`.
- **Group** = the sync lines of one order that land together (one `T`). Immediate lines are each their own group. `ItemsReleased` splits a group (§3.8).
- **Table key** = `order_type + ':' + (table_id | car_number | order_id)` (§3 #7): the slip dedupe key and grouping.

### 3.3 Engine state v3 (D24; replaces F §4.7 "Engine state shape", §4.5 F-1)

`ENGINE_STATE_VERSION = 3` (D62: bumped from 2).

```typescript
interface EngineState {
  stock: Record<StockItemId, StockEntry>;          // unchanged (01a S14, 01c V5)
  business_day: BusinessDay | null;                // unchanged (01a S33, 01c §3.5.3)
  config: EngineConfig | null;                     // last EngineConfigApplied (§3.11)
  stations: Record<StationId, StationRuntime>;
  orders: Record<OrderId, EngineOrder>;
  lines: Record<OrderItemId, EngineLine>;
  slips: Record<TableKey, SlipRecord>;             // §3.8
  next_alert_due_at: number | null;                // v0.4 (G2 #4): earliest t at which getAlertIntents(state, t) has a slip item; §3.8
}

interface SlipRecord {                             // v0.4 (G2 #4), written out
  order_ids: OrderId[]; last_estimate: number;     // from the last SlipWarned
  alert_id: string | null;                         // from SlipWarned.alert_id; null after its AlertClosed is folded
  resolved_at: number | null;                      // recorded_at of the fold that resolved every group of the key
}

interface StationRuntime {
  station_id: string; type: 'slot' | 'batch';
  capacity: number; capacity_override: number | null;  // effective = override ?? capacity (D37)
  paused: boolean;                                     // D21
  profile: { t: number[]; u: number[] };               // D24: sorted boundaries, units in use from t[i] to t[i+1]
  unfired: OrderItemId[];                              // sorted by (fire, order_item_id)
  loads: Record<LoadId, Load>;                         // batch only (F §4.7 BatchStationState semantics)
}

interface EngineOrder {
  order_id: string; order_type: 'dine_in' | 'takeaway' | 'delivery' | 'parking';
  table_key: string; table_id: string | null; follow_up: boolean;
  pickup_at_ms: number | null; placed_at: number; placed_by: string | null;
  target_land_ms: number; promise_ms: number;          // copied from OrderPlaced (§3.5.1)
  boosted: boolean; line_ids: OrderItemId[]; awaiting: number;  // lines listed but not yet seen
  last_served_at: number | null;                     // recorded_at of the ItemServed that left no line open (v0.2, pre-G2 #2)
  next_group_index: number;                          // group ids are `order_id + ':' + index` (v0.2, pre-G2 #7)
  groups: Record<GroupId, { target_land_ms: number; line_ids: OrderItemId[] }>;
}

interface EngineLine {
  order_item_id: string; order_id: string; group_id: string; serve_mode: 'sync' | 'immediate';
  station_id: string; alternates: Array<{ station_id: string; carry_ms: number; home: boolean }>;
  point_id: string | null; carry_ms: number; units: number; prep_ms: number;
  cook_ms: number; full_cook_ms: number; from_stock: boolean; program_id: string | null;
  stock_cook_ms: number | null;                        // v0.4 (G2 #7): the ItemAdded copy of the stock cook time (01c B1), null when none
  draws: Array<{ stock_item_id: string; quantity: number }>;  // v0.4 (G2 #7): dayDraws(state, item) × line units at the ItemAdded fold (01c V20, frozen per day, so replay-safe); [] for a return or an untracked item
  weight_pct: number; max_early_ms: number; max_late_ms: number | null; max_carry_ms: number | null;  // v0.2, pre-G2 #6
  stage: 'added' | 'cooking' | 'done' | 'served' | 'removed' | 'voided' | 'returned';      // v0.2, pre-G2 #18
  fire_ms: number | null; deadline_ms: number;         // planned fire, latest fire
  fired_at: number | null; started_at: number | null; done_at: number | null;
  mark: null | 'expedite' | 'boost' | 'pulled' | 'return';  // human-triggered jump (D17, D28)
  return_of: { order_item_id: string; mode: 'fix' | 'remake' } | null;  // D28
  load_id: string | null;
}
```

- **The profile is the timeline (D24).** Placing a line = scanning the profile for a window where `units_in_use + units ≤ effective capacity` over the whole cook interval `[fire + prep, fire + prep + cook)` (F §4.7 slot formula, "for every instant s" is the *definition* this implements). Insert/remove = adjust the running counts between two boundaries. `latestFit(lo, hi)` scans backward from `hi`; on a conflict segment `[a, b)` the next candidate is `a − prep − cook`; `earliestFit(lo)` scans forward; on a conflict the next candidate is `b − prep`. Integer ms, no step quantisation.
- **COOKING lines** occupy until `max(planned end, t)` where `t` is the event's `recorded_at` (in `applyEvent`) or `now` (in `getTickIntents`), F §4.7 D33.
- `applyEvent` copies only the stations it touches (copy-on-write per station; a profile is ≤ a few hundred boundaries).
- **Exit (§3 #11; Changed in v0.2, pre-G2 #2; Changed in v0.4, G2 #3):** an order and its lines leave the state at `BusinessDayClosed` (which also clears `slips`), or **30 minutes after its last line is served** (`ORDER_EXIT_AFTER_SERVED_MS = 1 800 000`, an engine constant in the pilot): once no line is open (every line `served`, `voided`, `removed` or `returned`), `last_served_at` is set from that event's `recorded_at`. The exit is a **pure predicate**, `inEngine(order, t) = order.last_served_at = null ∨ t < order.last_served_at + ORDER_EXIT_AFTER_SERVED_MS`, exported as `isOrderInEngine(state, order_id, t)` (false for an absent order, §6.1a). **Every reader uses the predicate, never the presence of the row:** `getTickIntents`, `getAlertIntents`, `nextDueAt`, the views, `stationsLive`, and 02's `ORDER_NOT_IN_ENGINE` check (`isOrderInEngine(state, order_id, now)` in the handler). **Physical removal** of an order whose predicate is false happens only inside the fold of an event type on the §3.12 replay lists, at that event's `recorded_at`, so live and replay fold the same events and remove at the same point; an event of any other type (an `audit` receipt, an `AlertSeen`) is not handled by `applyEvent` (returns `state` itself, §6.1a) and never removes anything. Removal never changes a result, because every reader already treats the order as gone. No event is written, so the rule is a pure function of the log (D13). **Fold order for `OrderLinesAdded`** (02's addition or a return): the removal step skips the event's own order; when that order is present, the new line clears `last_served_at` (re-opens it), even if the handler's `now` and the batch's `recorded_at` straddle the deadline by the append gap (§3.5.3); when it is absent, the fold **throws** (a bug: absence means it was removed at a listed event with `recorded_at ≥` the deadline, so 02's check at a later `now` refused it). A `ReturnToKitchen` on an order with `isOrderInEngine = false` is refused `409 ORDER_NOT_IN_ENGINE` (02, §9). 05's `BillClosed` becomes a third exit later (no requirement now). Reservations are released by the stock events of §3.7, never implicitly.
- **Deterministic ids (Changed in v0.2, pre-G2 #7):** the pure engine has no id generator. A group id is `order_id + ':' + index` (`OrderPlaced.groups[]` take 0…n−1; a split by `ItemsReleased` or a new group from `OrderLinesAdded` takes `next_group_index`). A batch load id is `station_id + ':' + the earliest order_item_id in the load`; it may change while the load is unfired (re-plan) and is fixed by `FireDispatched.load_id`. *Changed in v0.2.1:* the id is a **name, not membership**: it stays when that line is voided or removed before the fire. Tested by test 81.

### 3.4 Line states in the engine

```
 ItemAdded ─► ADDED (hidden "Later") ──fire ≤ t+freeze──► ADDED (frozen "Next") ──FireDispatched──► ADDED (fired "Now")
      │                                                                                      │ ItemStarted
      │ ItemRemoved / ItemVoided (any stage before served) → removed / voided                ▼
      │                                                                                   COOKING ──ItemDone──► DONE ──ItemServed──► SERVED
      │                                                                                      ▲                    │
      └─ ItemsReleased.expedite → immediate, mark 'expedite'                                 └──ItemDoneUndone────┘ (≤ 30 s, 03b)
 SERVED ──ReturnToKitchen (02)──► a NEW line, mark 'return', immediate, expedite weight (D28, §3.8a); the served line stays (fix) or is `returned` by 04 (remake)
```

- **Hidden** = unfired and `fire_ms > t + freeze_ms`: may move in time and station (D10, D13). **Frozen** = unfired and `fire_ms ≤ t + freeze_ms`, evaluated at the event's `recorded_at` (D13, D15): fixed input to every re-plan; nothing is inserted before it (D15). **Fired** never moves (D44) except by `ReservationsShifted` (cascade, F §4.7 D42) and is never fired twice.
- **Order READY (§3 #9)** = every sync line of the order is `done` (or later). "Ready to serve per point" is 03b's view state.
- **Hold at pass (F §4.7, D1):** a `done` sync line whose group has a line not yet `done` is shown HOLD by 03b from `groupReadiness` (§6.1). *Changed in v0.3 (owner, A5 / A8):* HOLD is a **hint on the assembler view, never a block** (01d K4): whatever is ready may be marked Ready to serve; the split send of §3.8 stays the digital path.

### 3.5 Planning

#### 3.5.1 Target and promise at submit (D3, D6)

`planOrder(state, proposed, t)` (§6.1; `ProposedOrder` in §4.2, v0.2 pre-G2 #8) runs inside 02's `SubmitOrder` transaction with the live state and `t = clock.branchNow()`:

1. **Orderable check:** any line routed only to a paused station → `409 STATION_PAUSED` (D21, §9). Stock first-submit-wins as §3.7.
2. **Immediate lines (D36):** each placed at `earliestFit` on its best station (§3.5.5) against the station's current profile; its target = its land time; tentatively added to the profile.
3. **Sync group:** the F §4.7 hold-and-fire full-pass loop (D16, D35, D36, D49), run against **the profile after pass 1 of §3.5.3** (older lines re-placed within their slack) plus the tentative immediate intervals; each sync line's station interval ends at `T − carry`. Delivery (D3): `T = max(pickup_at_ms, loop result)` when 02 sets a pickup time.
4. **Promise:** `P = T + padding`, `padding = stations[...]?.promise_padding_ms ?? settings.promise_padding_<order_type>_ms` (max over the group's stations) (D6; per-order-type shape, §12.3 Q3). FIFO and EDF stations use padding 0 for their lines (D3).
5. `T` and `P` (per group, and per immediate line) are **written into `OrderPlaced`** (§4.2), with group ids `order_id:0…n−1` (§3.3). `applyEvent` never recomputes them, so replay and engine-version full replays keep every promise (**P-2**).

The submit response shows `P`; the engine works to `T`. Slack is measured from `T`, so padding is never consumed by other orders (D6).

#### 3.5.2 Weights (D3, D5, D7)

`w(L) = weight_pct(L) × (follow_up ∨ L.mark ∈ {expedite, return} ? weight_follow_up_pct : weight_<order_type>_pct) / 100` (percent; 100 = 1.0; *Changed in v0.2, pre-G2 #19:* expedite and return lines take the follow-up weight, D12, D28). EDF stations use `w = 100` for every line (D3). The branch weights are read from `state.config` at each re-plan, so a weights change re-weighs **open** orders from the next re-plan; only the item's `weight_pct` is a D25 copy (*Changed in v0.2, pre-G2 #22*; test 90, v0.4 G2 #13). The weights are configuration (defaults in §4.5 A-12; *Changed in v0.3*).

#### 3.5.3 Re-plan (D13, D15, D24, D25)

A re-plan of station `S` at time `t` (the triggering event's `recorded_at`):

```
fixed  = lines on S that are fired, COOKING, frozen (fire ≤ t + freeze_ms), or done
         + lines of other triggering orders already placed in this event
pivot  = (submit only) min over the new lines on S of (t + their prep)        // D25 prune:
fixed += hidden lines on S whose interval ends ≤ pivot                         // a new line can only
                                                                               // delay lines at or after it
free_old = remaining hidden lines on S (older orders)
pass 1: for L in free_old ordered by (d(L) − keep, −w(L) × (t − placed_at), order_item_id):
          place L at latestFit(lo = max(t, d(L) − max_early_ms(L)), hi = d(L) − keep)   // keep cushion (D6)
          else latestFit(lo, hi = d(L))                                                  // its own keep, still on time
          else → late set (§3.5.6)
pass 2: (submit) place the new order's lines as §3.5.1 computed them
```

- `keep = min_slack_keep_ms` of the station (Waada Guard); `0` on EDF (D3). **The last `keep` of an older line is never given to a newer order (D6):** pass 1 runs before the new lines, so a newer order can only use capacity the older lines leave.
- **Triggers (D13):** the last listed `ItemAdded` of an `OrderPlaced` / `OrderLinesAdded` (stations the order uses); `ItemRemoved`, `ItemVoided`, `ItemMovedToStock` (that station; the group's `T` may move earlier, never later: `T' = min(T, loop result)`; the promise `P` never moves; tested by test 89, v0.4 G2 #13); `OrderBoosted` (§3.9); `StockReleased { reason: 'recount' }` (the line switches to full cook time; *v0.4, G2 #21:* `unit_changed` dropped, §3.7); *Changed in v0.4 (G2 #7):* `StockReserved` for an already placed line (written after a `StockAdded`, §3.7; the line switches to its stock cook time; its station re-plans at that fold, foundation D23 "stock update"); `StationCapacitySet`, `EngineConfigApplied` changing capacity (whole station, frozen lines included as fixed); `ItemsReleased` (§3.8). **No event is written for a re-plan** (D13, D44): it is a pure function of `(state, event, recorded_at)`; R6's ≈ 45k events/day stand. `ReservationsShifted` is written by the tick (overrun) or by 03b's Start command (late start, F §4.7 D42), never for a re-plan (*Changed in v0.2, pre-G2 #20*).
- **FIFO stations (D3):** no hold, no re-plan of older lines: each new line is placed at `earliestFit(t)` in submit order; its target is that land time.
- A re-plan that leaves a line late (only after a disturbance: capacity drop, overrun, boost, recount) goes to §3.5.6. **At submit no line is late by construction**, up to the gap between the handler's `t` and the batch's `recorded_at` (one stamp per append, `engine-host/append-events.ts:12`): a line that no longer fits by that gap is placed at its earliest fit and the next tick slips it (*Changed in v0.2, pre-G2 #21*; test 91, v0.4 G2 #13). A full kitchen shows as a later promise and a red pressure band (D20), not as lateness.

#### 3.5.4 Waada Guard under normal load (D4)

No line is placed past `d(L)` except by boost (§3.9) or overload (§3.5.6). Within slack, ties are broken by `w × waiting` (pass 1 order, auto-fill §3.6.1; v0.2, pre-G2 #35). The simulator (§10.6) compares the three policies on % promises kept, max late, mean wait by order type, cold time and utilisation (D22).

#### 3.5.5 Routing (D8, D9, D10, D23)

- A line may go to its routed (home) station or an **alternate** (01a v2.1 `station_alternates`, slot stations only — **P-3**) that allows the order type, whose `carry_ms(station → line's point) ≤ max_carry_ms(L)` (copied on the line, D25; *Changed in v0.2, pre-G2 #6*), and that is not paused.
- **Immediate line:** arrival = land at the station + carry; choose the minimum arrival; if it beats the home station by less than `min_gain_ms`, use the home station (D9). The home station for an order type = the alternate whose `home_for_order_types` lists it, else the routed station.
- **Sync line:** at candidate `T`, it fits if it fits at any allowed station with interval ending at `T − carry`; preference: home, then lowest carry, then `station_id`. `T` advances by the smallest advance over all allowed stations.
- **Reserve (D8):** `reserve_units` of a station are usable only by its home order types; others see `effective capacity − reserve_units`. Default 0.
- **Re-routing (D10):** only hidden lines may change station in a re-plan; a frozen or fired line belongs to its station; on station Off the assembler reassigns those by hand (K8, 03b).
- With every carry 0 and no alternates (the config defaults, §4.5 A-9, A-10), routing reduces to "the routed station"; with alternates and carry 0, to "wherever it is ready first" (D23; *Changed in v0.3*).

#### 3.5.6 Overload — weighted lateness (D5)

When a re-plan leaves a late set: re-place **all** hidden lines of the station with extended deadlines `d_Λ(L) = d(L) + min(Λ × 100 / w(L), max_late_ms(L) ?? ∞)` (EDF order on `d_Λ`, `latestFit(…, hi = d_Λ)`, keep not applied), for the smallest `Λ` (multiples of `cascade_step_ms`, exponential then binary search, ≤ 16 probes) at which all fit. A weight-2 line carries half the lateness (D5). A line held at its `max_late_ms` cap is not shifted further; if it still cannot fit it is placed at `earliestFit` after the others (a reporting cap, never a refusal, D3) and the station raises `station_overload` (§3.10). Optimal for one slot (Lawler), heuristic for capacity > 1 — the simulator decides (D5, §12.3 Q1).

### 3.6 The `fires` and `fires_alerts` ticks (§3 #3, D44, D60, D42, D16)

*Changed in v0.2 (pre-G2 #1):* two registered ticks. **`fires`** writes engine intents only (items 1–4 below and the config catch-up, §3.11); **`fires_alerts`**, registered right after it, raises and closes the `slip_warning` and `station_overload` alerts and writes `SlipWarned`, each in its own transaction (01d §3.5 isolation). A throw in `fires_alerts` (a bad raise input, a resolver error) rolls back only the alerts of that pass and never a fire; D44 holds per tick. **One-tick lag:** `fires_alerts` reads the state `fires` has just swapped in the same pass (01d `tickPass` reads `deps.state.get()` per tick, `alerts/tick.ts:380-383`), so a slip is normally raised in the pass that sees it; when `fires_alerts` fails or is skipped, its alerts follow one pass (500 ms) later, retried every pass. 01d's own `alerts` tick, first in the order, sends later steps from the next pass.

#### 3.6.1 Intents of one `fires` pass (`getTickIntents(state, now)`, pure)

1. **Scheduled fires:** every unfired line (or batch load) with `fire_ms ≤ now` → `FireDispatched { reason: 'scheduled' }`, grouped per station and load. A batch load pulls in compatible unfired lines whose target lies within the station's freshness window, capped per line by `max_early_ms` (F §4.7 D14/D17; D3 "batch: caps freshness").
2. **Auto-fill (D16):** for each slot station with idle units now (after 1.), fire from frozen-then-hidden lines with `now ≥ d(L) − max_early_ms(L)` whose whole cook interval from `now` fits: Waada Guard — lines with slack ≤ keep first (EDF), then max `w × waiting`; EDF — by `d`; FIFO — not used (FIFO fires at once). `FireDispatched { reason: 'early_fill' }`.
3. **Inferred completion (F §4.7 D60):** `single_tap` → `ItemStarted { source: 'inferred' }` with each fire; `auto_done` → `ItemDone { source: 'inferred' }` at `started_at + prep + cook` unless tapped.
4. **Cascade (F §4.7 D42):** an overrunning COOKING line pushes later unstarted reservations → one `ReservationsShifted { cause: 'overrun' }` per station, quantised to `cascade_step_ms`.
5. **Slip candidates and overload** are **not** `fires` intents (v0.2, pre-G2 #1): `getAlertIntents(state, now)` (pure, §6.1) returns them for `fires_alerts` (§3.8, §3.10, §6.2a).

All intents of one `fires` pass are written in **one** transaction (D44), the fires tick's own (01d §3.5). `fires.due(db, state, now)` is pure: `now ≥ nextDueAt(state)` (the minimum of the earliest unfired `fire_ms`, the earliest auto-fill eligibility, the earliest inferred Done, the earliest cascade step) or the host flag `configStale` (§3.11). *Changed in v0.4 (G2 #4):* `fires_alerts.due` is `now ≥ state.next_alert_due_at` (the slip part, a pure state field, §3.8), or the host overload check (§3.10, in memory), or the host flags `day_closed` (§6.2a) and `reconcile` (first pass after boot) — no statement and no `listOpen`. A raised slip or overload that persists unchanged is **not** due again, so an idle or steady kitchen opens no transaction (01d §4.3 To 03a; no 15 s timer, v0.2 pre-G2 #23).

#### 3.6.2 Missed fires (§3 #3)

Boot writes nothing for missed fires. Step 6 (03a) computes a dry `getTickIntents(ctx.initialState, ctx.clock.branchNow())` — the state replayed at step 3, unchanged before step 6, and the clock 00 creates at step 3a (*Changed in v0.4, G2 #6*) — and hands the `FireDispatched` line count to step 8 as `missed_fires` (00 `HubStarted`; both `BootContext` fields need the additive 00 row H-1, §4.5). The first tick (≤ 500 ms after the server opens) dispatches them with `reason: 'missed'` for lines with `fire_ms` before the boot. Lines fired before the outage are not fired again (F §4.7 D44); their tickets are reprints (03b).

#### 3.6.3 Station plan to the KDS (Changed in v0.2, pre-G2 #12)

Re-plans write no event (D13) and lines enter the freeze window with time, so the KDS cannot learn the plan from events, and `ItemAdded` carries no fire time (F §5.9 step 11 changed, §4.5 F-15). 03a gives 03b the plan directly:

- **Catch-up part `station_plan`** (staff and station sockets; for a station session only its own station): per station `{ station_id, as_of_seq, lines: [{ order_item_id, order_id, fire_ms, deadline_ms, mark, frozen }] }` for every unfired line, from `stationPlan(state, station_id, now)` (pure, §6.1), 0 statements.
- **Frame `station_plan`** (`WsServerMessage` union, F §6.5): the same body for one station, sent to the same audience as the catch-up part — the station sockets of **that** station and every staff socket (*Changed in v0.4, G2 #19*) — after commit (`writer.addAfterCommit`) for every station whose plan changed in that commit (the reducer marks touched stations), and when a line enters the freeze window. *Changed in v0.2.1:* entering Next is time passing, not an event, so it never opens a transaction. `firesDue(state, last_pass_ms, now)` (pure, §6.1) returns `{ intents_due: boolean, crossed: StationId[] }` — `crossed` = stations with an unfired line whose `fire_ms − freeze_ms` lies in `(last_pass_ms, now]`. The `fires` tick's registered `due` (01d `TickDef.due`, run by the loop outside any transaction, `alerts/tick.ts:380`) calls it, keeps `last_pass_ms = now` in host memory, and, when `crossed` is non-empty, sends the `station_plan` frame for those stations through `ws.sendToDevices` (00 H-4) — a send of already-committed state, like 01d's catch-up, not a write — then returns `intents_due`. When intents are also due, the frames for the same pass go out from the after-commit hook instead (one frame per station per pass). After a restart `last_pass_ms` starts at boot time, and the catch-up part covers the rest. 01d's "an idle kitchen opens no transaction" rule holds with no exception. One frame per changed station per commit.
- 03b's Now / Next / Later screen reads `station_plan` and the line events (§4.3 To 03b), never `latestStartAt`.

### 3.7 Stock (01a S14, S41, S44, S45; 01c §3.5, §4.4; carried rows)

- **Reserve at submit (F §5.9 step 5 as changed, §4.5 F-9):** `reserveStock(state, proposed, dayStartMs, stockItems, configStockUnits)` (*Changed in v0.2, pre-G2 #27:* the config stock items and units the built `availableStock` and `dayDraws` need, `packages/engine/src/stock.ts:27-72`) per line, per draw: the line is served from stock only when **every** draw passes `canServeFromStock(availableStock(…), line quantity, quantity_per_sale_unit)` after the units already claimed in this command (01c §3.5.2); then one `StockReserved { stock_item_id, order_item_id, quantity }` per draw (`quantity` = draw quantity on the line). Otherwise: `cook_fresh` → full cook time; `sold_out` at available 0 → **refused** (02's code; first submit wins, E1 stock AC4; the [ASSUMPTION] of 01a S32, adopted). `OrderPlaced.lines[].from_stock` records the outcome.
- **Release (explicit events, P-4):** `StockReleased { stock_item_id, order_item_id, quantity, reason }` with `reason ∈ removed, voided, moved, recount, day_closed`. The writer of the triggering event appends them, from one pure helper `stockEffects(state, draft)` (§6.1): 02 (`ItemRemoved`), 04 (`ItemVoided`, `ItemMovedToStock`), 01a's stock commands (`StockSet` with `on_hand < reserved`: release the `reserved − on_hand` most recently reserved units, whose lines re-plan at full cook time; S14 v0.6), and the day-close writer (`day_closed`, every remaining reservation, in the same commit as `BusinessDayClosed`): 01a's `CloseBusinessDay` now, 05's day close when it replaces it (§4.3 To 05, v0.2 pre-G2 #14). `stockEffects` for `ItemRemoved`, `ItemVoided` (per voided unit) and `BusinessDayClosed` are tested by test 88 (v0.4, G2 #13).
- *Changed in v0.4 (G2 #21):* **no `unit_changed` release.** A stock unit change takes effect at the next day open (01a S44), and every reservation is released `day_closed` in the commit that closes the day (above), so `reserved = 0` for every item at any `OpenBusinessDay`; the path is unreachable and is dropped (with its test and the To 05 clause). 01a's carried row "re-plan reservations of an item whose unit changed at a day open" is answered by this reason (§12.4).
- **Move to stock (Changed in v0.2, pre-G2 #13):** `ItemMovedToStock { order_item_id, units }` puts the cooked portion into ready stock: `stockEffects` returns `StockReleased { reason: 'moved' }` for the line's reservation (if any) and `StockAdded { stock_item_id, quantity, unit, reason: 'moved' }` for each of the line's draws (`quantity` = draw quantity × units ÷ line units); a line with no draw adds nothing. `StockAdded` gains the optional `reason` (additive, §4.5 A-19). Explicit events keep the clients' stock part right (01a §4.4 clients fold stock frames with `applyEvent`).
- **Consume (P-5):** a from-stock line's units leave `on_hand` and `reserved` at **`ItemStarted`** (the portion is taken from the pot): `StockConsumed { stock_item_id, order_item_id, quantity }` appended with the start (03b's `StartItem`, the tick's inferred start). This is 01a's "hand-over step".
- **`StockAdded` (Changed in v0.4, G2 #7 — v0.3 was wrong, 01a's carried row "triggers D23 (S45)" is right):** adds to `on_hand` (S45), then **reserves the new stock for waiting lines**: `stockEffects(state, StockAdded)` returns `StockReserved` drafts for that stock item's lines that are **unfired**, `from_stock = false`, have a draw on that item and a stock cook time (`draws`, `stock_cook_ms`, §3.3), in **deadline order** (`deadline_ms`, then `order_item_id`), each through the same rule as submit (`reserveStock`: the line is taken only when **every** one of its draws passes `canServeFromStock` after the units already claimed in this command, 01c §3.5.2), until the added stock no longer reaches the next line (a line that does not fit is skipped, the next is tried). The writer of the `StockAdded` (01a's `AddPrecookedStock`, 04's move to stock via `stockEffects`) appends them in the same transaction. The fold of each `StockReserved` for an already placed line sets `from_stock = true`, `cook_ms = stock_cook_ms`, and re-plans its station at that fold (foundation D23 "stock update", §3.5.3 triggers): the line may now fire later and land on target with a shorter cook. Fired, COOKING and return lines are never switched (the plate is already being cooked fresh). Test 87.
- `on_hand ≥ 0` and `reserved ≥ 0` always (a fold that would go below 0 throws: a bug, caught by tests).
- Stock stays branch-level; zone stock is 02's (03a-g0 §2).

### 3.8 Slip warning and split send (D11, D12, §3 #7, F §4.7 D44)

- **Estimated land time** per sync group: F §4.7 formulas (COOKING: started + prep + cook; ADDED past its fire: `now + prep + cook`; on schedule: the planned land). The group's estimate is its maximum.
- **Trigger:** `estimate > T + slip_threshold_ms` (D11: from the engine target, so the order taker hears before the padded promise is blown; the card shows minutes against the **promise**). `slip_threshold_ms` is configuration (default in §4.5 A-12; *Changed in v0.3*).
- **One per table (§3 #7):** the orders of one table key are grouped in one `SlipWarned { table_key, order_ids, alert_id, estimated_land_ms, target_land_ms, promise_ms }` and one alert, dedupe key `slip:<table_key>`, both written by **`fires_alerts`** in one transaction. *Changed in v0.4 (G2 #4):* `SlipWarned` carries `alert_id` again — the tick calls `raiseMany` first and builds each `SlipWarned` from the `alert_id` it returns, so the engine can match the alert's `AlertClosed` (v0.2's join through `AlertRaised.values.table_key` stays valid for readers). **Re-raise (F §4.7 D44):** only when the estimate has grown by another `slip_threshold_ms` since `slips[key].last_estimate` **and** `slips[key].alert_id = null` (the previous alert closed). Both are state, so no read decides it (01d dedupe still refuses a second open one).
- **Slip state (Changed in v0.4, G2 #4):** `applyEvent(SlipWarned)` sets `slips[key] = { order_ids, last_estimate: estimated_land_ms, alert_id, resolved_at: null }`. `applyEvent(AlertClosed)` (order stream, §3.12) whose `alert_id` equals some `slips[key].alert_id` sets it to `null`; any other `AlertClosed` returns `state` itself. When every group of the key is resolved (every line `done` or later, or exited) the resolving fold sets `resolved_at = recorded_at` if `alert_id ≠ null`, else drops `slips[key]`; the fold of that alert's `AlertClosed` then drops it. An unresolved slip whose alert is closed by someone else (02's `ReleaseItems` closes it `done`) keeps `slips[key]` with `alert_id = null`, so its `last_estimate` still gates the next raise.
- **`next_alert_due_at` (Changed in v0.4, G2 #4; pure, like `nextDueAt`):** recomputed by every fold that changes a line, a group or `slips` (O(open lines), ≤ 1 ms at design size, inside the §7.1 re-plan budget) as the minimum over the table keys of: (a) `resolved_at` for a resolved slip with `alert_id ≠ null` (close it `done`); (b) for an unresolved key with `alert_id = null`, the **crossing time** — the earliest `t` at which the key's estimate exceeds its level, `level = slips[key] ? last_estimate + slip_threshold_ms : T + slip_threshold_ms` (per group): per unstarted line `t = level − prep − cook` (its estimate is `max(planned land, t + prep + cook)`, non-decreasing in `t`), or the fold's `recorded_at` when its planned land already exceeds the level; a COOKING or done line contributes only when its fixed land already exceeds the level; `null` when no key has (a) or (b). A key with `alert_id ≠ null` and no resolution contributes nothing. `getAlertIntents` and `next_alert_due_at` use the same `slipCrossing` function, so whenever `next_alert_due_at` is finite, `getAlertIntents(state, next_alert_due_at)` has a slip item (property test 92).
- **The `slip_warning` kind** (03a registers, 01d §3.5): `family: 'action'`, `subject: 'order'` (the oldest order of the group), `request: { answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: 'never', apply }` with labels "Send what's ready" / "Wait" (01d: accept kinds use the kind's labels); no requester (tick-raised: `raised_device_id = 'hub'`, no in-person answer, no withdraw, no `request_result`, 01d AD-72); `receiver_staff_id` = the table's owner from 02's `tableOwners` (§4.1; **until 02 lands: the order's `placed_by`**), target `{ kind: 'person', staff_id: receiver }`. Steps: 0 → `[{ raised_target, answerer }]`; 1 (`escalation: true`, at `values.escalate_ms` = `slip_escalate_ms`) → `[{ raised_target, answerer }, { managers, informed }]` (E4-SLIP AC3). `closes_on: 'owner'`, `lead_fallback: false`, `expires_at_day_close: true`, `values_schema { table_key, order_ids, escalate_ms }`, `details_schema { minutes_late, lines: [{ name, quantity, state }] }` (01d §3.12).
- **`apply` on accept** (read-only, 01d §3.5): returns one `ItemsReleased { order_id, alert_id, released, expedite }` per order of the group with work: `released` = the group's `done` sync lines (go now, no hold); `expedite` = remaining lines **pre-ticked** by "goes with" links of what is released (D12; none configured → none). `decline` returns `[]`. Ticks are edited only from 02's table view (`ReleaseItems`, which uses `planRelease`, §6.1, and closes the alert), because `AnswerRequest` carries no ticks (**P-6**).
- **`applyEvent(ItemsReleased)`:** released lines leave their group; expedite lines become immediate (`mark: 'expedite'`, weight = `follow_up` weight, D12); unticked lines stay sync with each other at their old `T`; re-plan.
- **Closing (Changed in v0.2, pre-G2 #1, #11; Changed in v0.4, G2 #4):** `fires_alerts` closes a resolved slip's alert `done` (`alerts.closeMany` with `slips[key].alert_id` from the state; test 93), and closes **every** open `slip_warning` `obsolete` (note `day_closed`, ids from `listOpen`) in its first pass after `BusinessDayClosed`, because 01d's day-close expiry skips requests (`projections/alerts.ts:350-351`). Close of a closed alert is a no-op (01d). `slips[key]` is dropped at its `AlertClosed` (resolved), at resolution when no alert is open, and at `BusinessDayClosed`.
- **Defensive inputs (v0.2, pre-G2 #1):** an input whose receiver cannot be resolved (no table owner, receiver not in the hub directory) or whose values fail the kind's schema is skipped and logged once per key `{ tick: 'fires_alerts', kind, table_key, reason }`, never passed to `raiseMany`, and no `SlipWarned` is written for it; the order taker can still open the Send card from the table view (D11). *v0.4 (G2 #4):* a skipped key would stay due, so the host keeps a `skipped` set of table keys; while it is non-empty, `due` uses `nextAlertDueAt(state, skipped)` (the same minimum without those keys, pure, in memory) instead of the field. A key leaves `skipped` at the next commit that touches one of its orders, or at a restart, and is tried again (no transaction every pass for a key that cannot be raised).
- Permission: none beyond being the named receiver (01d `named`); 02's table-view path uses the table's `mark-served` holder (D11).

### 3.8a Return to kitchen (D28; owner 2026-11-03)

A Served line may be sent back with **one of two choices**: `fix` (taste: "more spicy", "not cooked enough" — the same plate goes back) or `remake` (a kitchen fault — a new plate, on the house). Both are free in the pilot; no reason list and no charge config (added only if an owner asks, R18). The one rule that matters to the engine: **a return is a ticket.** A plate fixed off-ticket is invisible, holds a slot the engine does not know about, and makes every other ETA on that station wrong — the chef's own objection.

- 02's `ReturnToKitchen { order_item_id, mode }` (permission **`mark-item-returned`**, foundation §4.2; default Owner, Manager, Order taker; §4.5 F-13, B-5; *Changed in v0.2, pre-G2 #15*; an order no longer in the engine → `409 ORDER_NOT_IN_ENGINE`, §3.3, pre-G2 #2) appends an `OrderLinesAdded` with **one new line** that copies the served line's D25 fields and sets `return_of: { order_item_id, mode }`, plus 04's `ItemReturned` when `mode = 'remake'` (§4.3 To 04). The engine folds the new line as any line: `serve_mode: 'immediate'`, `mark: 'return'`, weight = the `follow_up` weight (D7, D12), `from_stock: false`, **no stock draw** (no `StockReserved`), station = the served line's station (alternates allowed, D8).
- **`fix`:** the line's `cook_ms` = the item's `adjust_time_ms` (01a v2.1 A-11; config), **copied by 02 into the `OrderLinesAdded` line** (D25); `applyEvent` takes it from the event, never from config (*Changed in v0.2, pre-G2 #5*). The served line is unchanged (bill, stage). **`remake`:** `cook_ms` = the line's normal cook time; the served line goes `returned` (exit as `voided` for the engine, §3.3) when `ItemReturned` is folded.
- **Placement:** expedite = `earliestFit` within other lines' slack and `min_slack_keep_ms`, never past their deadlines (D4). With `branch_engine_settings.returns_boost = true` the new line is placed as a boost (§3.9) instead and may push others. *Changed in v0.3 (owner, Q15a: a returned plate never queues):* the default is **true** (§4.5 A-12); the setting stays.
- **Chef screen:** the line shows at the top of Now / Next with a red RETURN marker, the mode and the old ticket's reference (`return_of.order_item_id`), D17; Start / Done as usual (D18), so the slot it uses is in the profile.
- **Served, readiness, alerts:** the new line is its own group (immediate); 03b's Ready to serve and the waiter alert follow as for any line; it never re-opens the old group's slip.
- Replay: nothing new — `OrderLinesAdded` and `ItemReturned` are already on the `order` stream list (§3.12).

### 3.9 Boost (D4; F §4.7 "Boost")

`OrderBoosted { order_id }` (02 writes, permission `boost-order`): the order's hidden and frozen lines are re-placed first at `earliestFit(t)` (as one group: new `T_b` = the hold-and-fire loop against fired lines only, marked `boost`); then pass 1 re-places the other lines; lines pushed past their deadline go through §3.5.6 and get slip warnings on the next tick. The boosted order's promise stays; its `T` becomes `T_b`. Boost is the only rule that may push another order past its target (D4). Who may boost is the `boost-order` permission (defaults in §4.5 B-7; *Changed in v0.3*).

### 3.10 Capacity, lanes, pause, pressure (D19–D21, D37, §3 #5)

- **Live capacity (D37):** `SetStationCapacity` (§6.6; v0.2, pre-G2 #35) sets `capacity_override`; the station re-plans (§3.5.3, frozen lines fixed) and slips follow on the next tick.
- **Lanes (§3 #5, K7/K8; Changed in v0.3, owner A2: computed from config):** a lane Off / On (03b, from the assembler or lane tablet) calls `SetStationCapacity` with `capacityForLanes(station, lanes_on, lane_count) = max(1, min(capacity, lanes_on × lane_units))`, where `lane_units` = the station's configured value, or, when it is null, `floor(capacity ÷ lane_count)`. Integers only. *Changed in v0.4 (G2 #1):* **`lane_count` is an input** (an integer ≥ 1) passed by the caller; 03a never reads devices. A **lane** is a `kds` device with `station_id` and a non-null `lane_label` (00 row H-6, 01d D4), and `lane_count` = the number of such devices of the station that are not revoked, else 1; 03b's lane Off / On counts them from 00's device directory. Pairing a lane device, naming its lane and binding a tablet to a point are 03b's and 01e's (§4.3).
- **Pause (D21):** a station with `pause_enabled` (01a v2.1, default false) may be paused live by `SetStationPause`; while paused new orders for it are refused `409 STATION_PAUSED`; open lines continue. `pause_enabled = false` → `409 STATION_PAUSE_DISABLED` (§12.3 Q10 reading).
- **Pressure (D20):** `pressure(S, now)` = booked unit-ms in `[now, now + pressure_window_ms)` ÷ (effective capacity × window), in basis points; green < `pressure_amber_bp` ≤ amber ≤ `pressure_red_bp` < red. Computed from the profile, never stored, so 07 can recompute it from the log (roadmap S4).
- **`station_overload` kind** (`info`, subject `station` / station_id, dedupe `station_overload:<station_id>`, step 0 → `managers` recipient, `closes_on: 'owner'`, `lead_fallback: false`, `expires_at_day_close: true`, `values { station_id, pressure_bp, waiting }`, card "{station} {pressure} % · {waiting} orders waiting" (v0.3)): raised by **`fires_alerts`** (v0.2, pre-G2 #1) when a station has been red for `pressure_alert_ms` (host memory `red_since`, reset on restart — accepted, P-7) or when a line reaches its `max_late_ms` cap (§3.5.6); closed `done` when the station is below amber at a check. Nothing stops a station by itself (D19). *Changed in v0.4 (G2 #4):* the **overload check** runs in `fires_alerts.due`, in memory, no statement: per station it computes `stationPressure(state, s, now)` and the capped flag (pure), updates `red_since`, and is due only for a **change** against the host set `overload_open` (station ids with an open `station_overload`): a station red ≥ `pressure_alert_ms` or capped and not in the set (raise), or in the set and below amber (close `done`). `overload_open` is refreshed from the `listOpen` read of every pass with work, and the first pass after boot is forced due (`reconcile` flag) so a restart rebuilds it; a raised overload that persists is therefore never due again.

### 3.11 Config reaction (`onBranchConfigApplied`, 01a carried row)

The hook computes `E(next)` = **exactly the `EngineConfigAppliedV1` fields below**, built from the snapshot (*Changed in v0.4, G2 #24:* the list is the payload, so `name`, `point_id`, `freshness_window_ms` and `reference_cook_ms` are included) and, when `canonicalJson(E(next)) ≠ canonicalJson(state.config)`, appends one `EngineConfigApplied` in the same transaction. Every station is in the log, so replay never reads config (**P-8**). Effects in `applyEvent`:

| Change | Effect |
|---|---|
| `capacity` | re-plan the station (D37) |
| `station_type` (01a allows it only with no routes) | open lines keep their placement as fixed input; new lines follow the new type |
| program `cook_time_ms`, item knobs, padding | new orders only (open lines keep their D25 copies) |
| item `stock_time_ms` (*v0.4, G2 #7*) | new orders only; a `StockAdded` reservation (§3.7) switches an open line to its **copied** `stock_cook_ms`, never to the config value. The `StockAdded` reserve-and-re-plan itself is a stock trigger (foundation D23, §3.5.3), not a config effect |
| station archived | open lines complete normally (01a S22, 03b warns); no new lines can route there |
| policy, freeze, keep, pressure fields, alternates, carry | from the next re-plan / tick |

The hook accepts every valid config and never throws on data (S43); a new station appears with an empty profile.

**`EngineConfigApplied` v1 payload (Changed in v0.2, pre-G2 #9)** = `EngineConfig`, the only config input of replay (P-8):

```ts
EngineConfigAppliedV1 = {
  config_version: number,
  stations: Array<{
    station_id: string, name: string, station_type: 'slot' | 'batch', capacity: number,
    freshness_window_ms: number | null, completion_mode: 'two_tap' | 'single_tap' | 'auto_done',
    policy: 'waada_guard' | 'edf' | 'fifo', freeze_ms: number, min_slack_keep_ms: number,
    promise_padding_ms: number | null, pressure_window_ms: number, pressure_amber_bp: number,
    pressure_red_bp: number, pressure_alert_ms: number, pause_enabled: boolean,
    lane_units: number | null, reserve_units: number, point_id: string,
    alternates: Array<{ station_id: string, order_types: OrderType[], home_for_order_types: OrderType[] }>,
    carry_times: Array<{ point_id: string, carry_ms: number }>,
    programs: Array<{ program_id: string, name: string, cook_time_ms: number, is_archived: boolean }>,
    reference_cook_ms: number,   // v0.4 (G2 #24): median `cook_time_ms` over the station's active (not archived) routed items,
                                 // base items only (variants and from-stock times not counted); lower median for an even count; 0 when none (stations-live wait_ms)
    is_archived: boolean,
  }>,                             // sorted by station_id
  settings: { weight_dine_in_pct, weight_takeaway_pct, weight_delivery_pct, weight_parking_pct,
              weight_follow_up_pct, promise_padding_dine_in_ms, promise_padding_takeaway_ms,
              promise_padding_delivery_ms, promise_padding_parking_ms, slip_threshold_ms,
              slip_escalate_ms, cascade_step_ms, min_gain_ms, returns_boost },  // all numbers but returns_boost: boolean (01a A-12)
}
```

**Catch-up (Changed in v0.2, pre-G2 #4):** a hub whose config is already applied (03a shipped later, a restored hub) gets no apply and therefore no `EngineConfigApplied`. Boot step 6 sets the host flag `configStale = canonicalJson(E(branchConfig())) ≠ canonicalJson(state.config)`; the first `fires` pass then appends `EngineConfigApplied` and clears the flag. *Changed in v0.4 (G2 #22):* **the catch-up pass writes only the config**; its intents are not computed on the pre-config state, and follow in the next pass (≤ 500 ms; `nextDueAt` of the folded state). Every hook run also re-evaluates it. Test 79.

### 3.12 Replay, snapshots, checkpoint, boot (D26, §3 #2, F §5.8)

- **Replay filter (§3 #2):** one statement per stream, each `WHERE branch_id = ? AND stream_type = ? AND seq > ? AND event_type IN (<list>) ORDER BY seq`, served by the new index `events_branch_stream (branch_id, stream_type, seq)`, merged by `seq` in memory (4 statements). Lists: `order` — `OrderPlaced`, `OrderLinesAdded`, `ItemAdded`, `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ItemServed`, `ItemRemoved`, `ItemVoided`, `ItemMovedToStock`, `ItemReturned`, `OrderBoosted`, `ItemsReleased`, `SlipWarned`, `AlertClosed` (*v0.2, pre-G2 #1:* `RequestAnswered` removed; *Changed in v0.4, G2 #4:* `AlertClosed` is back, folded only when its `alert_id` is a `slips[key].alert_id`, §3.8 — a slip alert's subject is an order, so its close is on the `order` stream; ≈ one row per order-subject alert, well inside R6's 45k); `station` — `FireDispatched`, `ReservationsShifted`, `EngineConfigApplied`, `StationCapacitySet`, `StationPauseSet`; `stock` — `StockSet`, `StockAdded`, `StockReserved`, `StockReleased`, `StockConsumed`; `hub` — `BusinessDayOpened`, `BusinessDayClosed`. `audit` is never read (≈ 30k/day, R6). *Changed in v0.4 (G2 #3):* these lists are **exported as one constant** `ENGINE_REPLAY_EVENTS` (per stream) and are exactly the event types `applyEvent` handles; every other type returns `state` itself. A static test (test 94) asserts that the set of types with a case in `applyEvent` equals the union of the lists, so live (which folds every appended event) and replay (which reads only the lists) cannot diverge.
- **Snapshots (F §5.8):** after a commit that crosses a multiple of 500 events the host **schedules** the snapshot with `setImmediate`, outside the command's response path, and writes `engine_snapshots` in its own small transaction (not an event) from the state current at that moment; on SIGTERM it writes one synchronously before the database closes (*Changed in v0.2, pre-G2 #38*; measured in §10.6). It keeps the newest **2** of the current version (the second covers a torn or unreadable newest row) and deletes older-version rows after a fresh one is written (D62; *Changed in v0.2, pre-G2 #37*). *Changed in v0.4 (G2 #17):* the snapshot's `last_seq = writer.lastSeq()` and its state are read **in the same `setImmediate` callback** (no commit can run between them: the writer is synchronous on the one event loop). F §5.8's rule is kept: after a boot that loaded **no** snapshot of the current version (step 2 fell back to a checkpoint or seq 0), the host schedules one fresh snapshot as soon as startup completes, so a crash in the next 500 events does not repeat the long replay (test 61).
- **Day-close checkpoint (D26, README "To 03a" row 1; Changed in v0.4, G2 #5):** after the commit that applies `BusinessDayClosed`, the host writes (keeping the newest 2; v0.2, pre-G2 #37) `engine_checkpoints { checkpoint_schema: 1, last_seq, business_day, stock, stations: { capacity_override, paused }, config }` — a version-independent document (its own schema, upcast like an event, D46). `business_day` is the closed day (`closed_at` set), so a boot from the checkpoint between the close and the next open equals a full replay (stock page, day commands). **`last_seq` = the max seq of that commit** — the commit that folded `BusinessDayClosed`, including the `StockReleased { day_closed }` the day-close writer appends with it — never a seq inside the commit, so step 3 never folds a day-close release twice. At that point every order has exited (§3.3) and `slips` is empty, so nothing else carries over.
- **Boot step 2:** latest snapshot with `engine_version = 3` → state; else the latest checkpoint → `fromCheckpoint`; else empty from seq 0 (a new hub). *v0.4 (G2 #17):* each read takes `LIMIT 2` (still one statement each), so a torn or unparsable newest row falls back to the second without another statement. **Step 3:** replay since that seq (crash restart ≤ 500 events ≈ 2 s; a version bump replays one day, est. 40–50 s, D26). A version bump is shipped only in the maintenance hour (01a S39); a mid-rush boot still fits the 90 s budget. Steps 2–3 replace 01a's step-3 fold (`sync/boot-steps.ts`). *Changed in v0.2 (pre-G2 #3):* `stock_version` (01a §6.19) is the seq of the newest stock-page event over the **whole** log, which a replay from a snapshot cannot see, so step 3 reads it with **two** statements on the new index — `SELECT seq FROM events WHERE branch_id = ? AND stream_type = 'stock' AND event_type IN (<STOCK_VERSION_EVENTS on stock>) ORDER BY seq DESC LIMIT 1` and the same on `hub` for `BusinessDayOpened`, `BusinessDayClosed` — and takes the max. `STOCK_VERSION_EVENTS` gains `StockReserved`, `StockReleased`, `StockConsumed` (they change the stock page; §4.5 A-17). **Step 6:** dry missed-fire count (§3.6.2); `configStale` (§3.11); *v0.4 (G2 #23):* the host flag `day_closed = state.business_day?.closed_at ≠ null`, so a restart between a day close and the next `fires_alerts` pass still closes the open `slip_warning` requests `obsolete` (at most one extra transaction per boot at night); the `reconcile` flag (§3.10).

*Changed in v0.3:* §3.13 "Pending the field visit" is removed (owner ruling: configuration, not spec numbers). Its proposed values are the config defaults of §4.5.

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| Foundation | `PosEvent`, D44/D45 rules, stream types `order`, `station`, `stock`, `hub` |
| 00 | `writer.run`, `state.setReducer`, `registerBootStep('2' \| '3' \| '6')`, `BootContext.initialState` (+ `missedFires` and `clock`, row H-1; v0.4, G2 #6), `defineCommand`, `defineQuery`, `registerCatchUp`, `registerEventAudience`, `clock.branchNow`, `ids` |
| 01a | `branchConfig()` (schema 3 after v2.1), `onBranchConfigApplied`, `canonicalJson`, stock helpers (01c re-keyed), the stock commands (rows A-9, A-10) |
| 01b | `manage-stations` (row B-1), `boost-order`, `mark-item-returned` (B-5), `my_stations` scope via `StaffDirectory.stationsOf(staff, 'run_station')` (B-4; v0.2, pre-G2 #16) |
| 01c | `ItemAdded` v1 (§4.3), `isStockTracked`, `dayDraws`, `canServeFromStock` |
| 01d | `defineAlertKind`, `alerts.raiseMany`, `alerts.closeMany`, `alerts.tickCtx`, `alerts.listOpen`, `registerTick` (twice: `fires`, `fires_alerts`) |
| 02 (when built) | `tableOwners(db, table_ids[]) → Map<table_id, staff_id>` (one statement); stub until then = `placed_by` |

### 4.2 Exposes (later modules may rely only on these)

**`@pos/engine`:** `ENGINE_STATE_VERSION = 3`; `EngineState` (§3.3, read-only for callers); `applyEvent`, `buildEngineState`, `fromCheckpoint`, `ENGINE_REPLAY_EVENTS`, `isOrderInEngine` (v0.4, G2 #3); `planOrder`, `calculateETA` (= preview, §6.1), `checkOrderable`, `reserveStock`, `stockEffects`, `getTickIntents`, `getAlertIntents`, `nextDueAt`, `nextAlertDueAt` (v0.4, G2 #4), `stationView`, `stationPlan`, `groupReadiness`, `stationPressure`, `stationsLive`, `pullEarly`, `lateStartShift`, `planRelease`, `capacityForLanes`, `goesWith`; the 01a/01c stock helpers unchanged.

**Hub:** the `fires` and `fires_alerts` ticks; the kinds `slip_warning`, `station_overload`; commands `set-station-capacity`, `set-station-pause`; query `stations-live`; catch-up parts `stations_live` and `station_plan`, frame `station_plan` (§3.6.3); audiences for the station-stream events.

**`ProposedOrder` (Changed in v0.2, pre-G2 #8)** — the input of `planOrder`, `calculateETA`, `checkOrderable`, `reserveStock`, built by 02 from `branchConfig()`:

```ts
ProposedOrder = {
  order_id: string,
  order: { order_type: OrderType, table_id: string | null, table_key: string, follow_up: boolean, pickup_at_ms: number | null },
  lines: Array<ItemAddedV1 & {                  // the drafts 02 will append (01c §4.3)
    alternates: Array<{ station_id: string, carry_ms: number, home: boolean }>,  // allowed for this order type (D8)
    point_id: string | null, carry_ms: number,   // home station → point
    weight_pct: number, max_early_ms: number, max_late_ms: number | null, max_carry_ms: number | null,
    cook_ms_override: number | null,             // a `fix` return: the item's adjust_time_ms (D28)
    return_of: { order_item_id: string, mode: 'fix' | 'remake' } | null,
  }>,
}
```

**Events (all `schema_version: 1`; `@pos/events/src/events/{order,station,stock}/`).** 03a defines the payload fields the engine reads; **the writing module implements them exactly and may add its own fields before the pilot (R29), never change these** (extends §3 #4, **P-9**).

| Event | Stream / id | Payload (engine fields) | Written by |
|---|---|---|---|
| `OrderPlaced` | order / order_id | `{ order_id, order_type, table_id \| null, table_key, follow_up, pickup_at_ms \| null, order_item_ids: string[], groups: [{ group_id, target_land_ms, promise_ms, order_item_ids }], lines: [{ order_item_id, station_id, alternates: [{ station_id, carry_ms, home }], point_id \| null, carry_ms, from_stock, weight_pct, max_early_ms, max_late_ms \| null, max_carry_ms \| null }] }` (v0.2, pre-G2 #6). `lines[].station_id` is the engine's starting station (D8); `ItemAdded.station_id` stays the home route (D25), which 03b uses only as a label (v0.2, pre-G2 #28) — batch order: `OrderPlaced`, then `ItemAdded` in `order_item_ids` order, then `StockReserved`; the engine plans at the last listed `ItemAdded` | 02 `SubmitOrder` |
| `ItemAdded` | order / order_id | 01c §4.3, unchanged | 02 |
| `OrderLinesAdded` | order / order_id | as `OrderPlaced` minus the order fields: `{ order_id, order_item_ids, groups, lines }` (later additions, 01c §4.4 "Later additions"; **P-10**); `lines[]` also carry `return_of: { order_item_id, mode: 'fix' \| 'remake' } \| null` and `cook_ms_override: number \| null` (the `fix` cook time, D28, §3.8a; v0.2, pre-G2 #5). The order must be in the engine (§3.3), so no order fields are needed (pre-G2 #10, resolved by #2) | 02 (`SubmitOrder` additions, `ReturnToKitchen`) |
| `ItemReturned` | order / order_id | `{ order_item_id, mode: 'remake', replacement_order_item_id }` — the served line exits the engine (§3.3); `fix` writes none (D28) | 04 (draft from 02's `ReturnToKitchen` through 04's helper; bill effect 04's) |
| `ItemStarted` | order / order_id | `{ order_item_id, started_at, source: 'tap' \| 'inferred' }` | 03b, fires tick |
| `ItemDone` | order / order_id | `{ order_item_id, done_at, source }` | 03b, fires tick |
| `ItemDoneUndone` | order / order_id | `{ order_item_id }` (≤ 30 s after Done, D16) | 03b |
| `ItemServed` | order / order_id | `{ order_item_ids, source: 'tap' \| 'estimated' }` (§3 #12) | 02 |
| `ItemRemoved` | order / order_id | `{ order_item_id }` (stage 1) | 02 |
| `ItemVoided` | order / order_id | `{ order_item_id, units }` | 04 |
| `ItemMovedToStock` | order / order_id | `{ order_item_id, units }`; with it `stockEffects` gives `StockReleased { reason: 'moved' }` and `StockAdded { reason: 'moved' }` (§3.7, v0.2 pre-G2 #13) | 04 |
| `OrderBoosted` | order / order_id | `{ order_id }` | 02 |
| `ItemsReleased` | order / order_id | `{ order_id, alert_id \| null, released: string[], expedite: string[] }` | `slip_warning.apply`, 02 `ReleaseItems` |
| `SlipWarned` | order / oldest order_id | `{ table_key, order_ids, alert_id, estimated_land_ms, target_land_ms, promise_ms }` (*Changed in v0.4, G2 #4:* `alert_id` from `raiseMany`, so the engine matches the alert's `AlertClosed`; v0.2's join through `AlertRaised.values.table_key` still works) | `fires_alerts` tick |
| `FireDispatched` | station / station_id | `{ station_id, order_item_ids, load_id \| null (`station_id:earliest order_item_id`, §3.3; a name, not membership — it stays when that line is voided or removed before the fire, v0.2.1), due_at, reason: 'scheduled' \| 'early_fill' \| 'pulled' \| 'missed' }` | fires tick; 03b `GiveMeMore` (`pulled`) |
| `ReservationsShifted` | station / station_id | F §4.7 `{ station_id, cause: 'overrun' \| 'late_start', shifts: [{ order_item_id, by_ms }] }` | fires tick; 03b `StartItem` (late start) |
| `EngineConfigApplied` | station / branch_id | `{ config_version, stations: [...§3.11], settings: {...} }` | 03a hook |
| `StationCapacitySet` | station / station_id | `{ station_id, capacity_override \| null, previous \| null, reason: 'manager' \| 'lane_off' \| 'lane_on' }` | 03a |
| `StationPauseSet` | station / station_id | `{ station_id, paused }` | 03a |
| `StockReserved` | stock / stock_item_id | `{ stock_item_id, order_item_id, quantity }` (01c V5) | 02; the writer of a `StockAdded` via `stockEffects` (01a, 04; v0.4, G2 #7) |
| `StockReleased` | stock / stock_item_id | `{ stock_item_id, order_item_id, quantity, reason: 'removed' \| 'voided' \| 'moved' \| 'recount' \| 'day_closed' }` (§3.7; `reason` `moved` replaces `moved_to_stock`, v0.2; `unit_changed` dropped, v0.4 G2 #21) | 02, 04, 01a, day close (01a, later 05) |
| `StockAdded` v2 (01c) | stock / stock_item_id | gains optional `reason?: 'moved'` (additive; absent = a manual add, S45) (v0.2, pre-G2 #13, §4.5 A-19) | 01a stock commands, 04 via `stockEffects` |
| `StockConsumed` | stock / stock_item_id | `{ stock_item_id, order_item_id, quantity }` (§3.7) | 03b, fires tick |

`TableLockReleased` and `TableLockTouched` are not engine events (02, §3 #8). 01d's `AlertClosed` (01d §4.2, unchanged) is read by the engine for slip alerts only (§3.8; v0.4, G2 #4).

### 4.3 Requirements carried to other modules

**To 02 (Ordering + Tables):**
*(Items renumbered 7, 8, 9 in v0.2, pre-G2 #36.)*
1. Implement `OrderPlaced` v1 and `ItemAdded` v1 **exactly** as §4.2 / 01c §4.3, build `ProposedOrder` (§4.2) from `branchConfig()`, in the batch order of §4.2, with `groups`, `lines`, `target_land_ms` and `promise_ms` from `planOrder(state, proposed, now)` in the **same** transaction and state; `checkOrderable` first (`409 STATION_PAUSED`); `reserveStock` for `StockReserved` and `lines[].from_stock`; a `sold_out` line at available 0 is refused with 02's code. `OrderLinesAdded` for any later addition to an open order.
2. **Own `TableLockReleased`** (F §4.3 D51): register your own `registerTick({ name: 'table_locks', … })`; the lock state lives in 02's projection, not `EngineState` (§3 #8, F-2).
3. **`follow_up` (D7):** set it on an order whose table already has a served order in the current seating; the engine only weighs it.
4. **Estimated Served (§3 #12, G0-6):** your own tick writes `ItemServed { source: 'estimated' }`; tapped Served writes `source: 'tap'`; the same writer appends `StockReleased` / nothing per `stockEffects`.
5. `ItemRemoved` (with `stockEffects`), `OrderBoosted` (`BoostOrder`, `boost-order`), delivery `pickup_at_ms`.
6. Expose `tableOwners(db, table_ids[])` (one statement) for the slip receiver (§3.8).
7. **Table view "Send what's ready" (D11, D12):** a `ReleaseItems { order_ids, released, expedite }` command (permission: the table's `mark-served` holder) that writes `ItemsReleased` from `planRelease` and closes the open `slip_warning` alert `done`.
8. **Return to kitchen (D28, §3.8a):** `ReturnToKitchen { order_item_id, mode: 'fix' | 'remake' }` on a `served` line (permission `mark-item-returned`, v0.2 pre-G2 #15; refused `409 ORDER_NOT_IN_ENGINE` when `isOrderInEngine(state, order_id, now)` is false, §3.3, §9, pre-G2 #2, v0.4 G2 #3; batch order `OrderLinesAdded` then `ItemReturned`; copy `adjust_time_ms` into `cook_ms_override` for `fix`, pre-G2 #5); writes `OrderLinesAdded` with one line copying the served line's D25 fields, `return_of` set, no stock draw, planned by `planOrder` as an immediate expedited line (or a boost when `returns_boost`); for `remake` also 04's `ItemReturned` in the same transaction. Two buttons, no reason, no charge in the pilot.
9. **Ordering screen (D20):** tiles show "about `wait_ms + prep + cook`" from `stations-live`, red band = "tell the customer"; refetch on `StationCapacitySet`, `StationPauseSet`, `EngineConfigApplied` frames and every 30 s while open. The ETA preview uses `calculateETA`; the response carries `as_of_seq`, and the submit result wins (§12.3 Q4). Customers and staff are shown `promise_ms`, never `target_land_ms`.

**To 03b (KDS + Printing):**
1. **Ready to serve and Handover** (events, commands, the assembler view, the Ready-to-serve kind with `point_id` and `window_ms`), decided 2026-11-02 (§3 #6); HOLD at pass is a hint, never a block — whatever is ready may be marked Ready to serve (01d K4; v0.3); points come with 01a v2.1. *Changed in v0.4 (G2 #1):* the assembler view's point tablets use 00's `devices.point_id` (row H-5); **binding a tablet to a point** in the device screen is yours (with 01e for headless devices). Readiness from `groupReadiness`; READY = every sync line done (§3 #9); a release dedupe key uses the `ItemsReleased` event id.
2. **Chef screen contract (D16–D18):** Now / Next / "Later: N" from `stationView(state, station_id, now)` on the hub and the `station_plan` catch-up part and frame on the KDS (§3.6.3, v0.2 pre-G2 #12; never `latestStartAt`); new tickets append at the bottom; Done removes its line; never reorder what is visible; `mark` lines (`expedite`, `boost`, `pulled`) jump to the top in red with the reason ("T12 is eating").
3. Commands `StartItem` (`ItemStarted`; late start → `ReservationsShifted` from `lateStartShift`; from-stock → `StockConsumed`), `DoneItem` (`ItemDone`; sanity check: Done under 50 % of cook time asks to confirm), `UndoDone` (`ItemDoneUndone` ≤ 30 s, close reason `undone`), `GiveMeMore` (`FireDispatched { reason: 'pulled' }` from `pullEarly`, same `max_early_ms` limit), all per line (D18).
4. Lane Off / On calls `SetStationCapacity` with `capacityForLanes(station, lanes_on, lane_count)` from the KDS's **station session** for its own station (`reason: 'lane_off' | 'lane_on'`, §6.6, v0.2 pre-G2 #17); a claim never touches the engine. *Changed in v0.4 (G2 #1):* `lane_count` = the station's `kds` devices with a `lane_label`, not revoked (00 row H-6), counted by you from the device directory; setting a device's `lane_label` at pairing (and on the lane names screen, 01d G0-3) is yours.
5. Print a ticket per `FireDispatched` line; reprints after restart (F §5.8 step 5).
6. **Return tickets (D28):** a line with `mark: 'return'` shows at the top in red with "RETURN · fix | remake" and the old ticket's table and item (`return_of.order_item_id`); Start / Done as any line.

**To 04 (Voids + Audit):** `ItemVoided` and `ItemMovedToStock` with the engine fields of §4.2 (`units` voided, per-unit voids of 01c §3.4.8 included) and the `StockReleased` / `StockAdded { reason: 'moved' }` drafts from `stockEffects` in the same transaction (v0.2, pre-G2 #13). **Returned lines (D28):** define `ItemReturned { order_item_id, mode: 'remake', replacement_order_item_id }` (the served line's bill effect: free in the pilot, wastage, reason `kitchen_fault`; audit with who returned it) and the helper 02's `ReturnToKitchen` calls; a `fix` writes no 04 event. A returned line counts in the wastage report, never as a void.

**To 05 (Billing):** the existing rows stand, plus one (*Changed in v0.2, pre-G2 #14*): when 05's day open / close replaces 01a's `OpenBusinessDay` / `CloseBusinessDay` (01a §4.4 To 05), it appends `stockEffects` for `BusinessDayClosed` (`StockReleased { reason: 'day_closed' }` for every remaining reservation) in the same transaction (*v0.4, G2 #21:* no `unit_changed` release at the day open, §3.7), and keeps `BusinessDayClosed` as the event the day-close checkpoint follows, with the checkpoint's `last_seq` at the end of that commit (§3.12, v0.4 G2 #5). (`BillClosed` may later become a third engine exit, §3 #11; not required.)

**To 01e (Devices + pager bridge; Changed in v0.4, G2 #1):** the ESP32 / headless side of point and lane devices: a headless or button device bound to a point (`devices.point_id`, 00 row H-5) or paired as a lane (`kds` + `station_id` + `lane_label`, 00 row H-6, 01d D4); pairing and binding screens for them. 00 v1.7 is the bump 01e already owns (01d G1 §5); 03a's rows H-5, H-6 join it. 03a reads neither column.

**To 07 (Owner View):** pressure history, overload events and promised-vs-actual are recomputed from the log (`stationPressure` is pure; `SlipWarned`, `FireDispatched.reason`, `ItemStarted` / `ItemDone` sources, K11 timestamps); no extra load-snapshot field (03a-g0 §2).

### 4.4 Stubbed until another module lands

| Stub | Until |
|---|---|
| Slip receiver = `placed_by` | 02 `tableOwners` |
| Points, carry, alternates, knobs at defaults (one point, carry 0, no alternates, weight 100, `max_early_ms` 60 000) | 01a v2.1 — **03a is blocked on it for routing** (03a-g0 §2) |
| `lane_count` = 1 in tests (03a takes it as an input, §3.10) | 03b / 00 v1.7 H-6 (v0.4, G2 #1) |
| `ItemsReleased` from the table view | 02 |
| Start / Done / Give me more | 03b (tests use event fixtures) |

### 4.5 Changes to other specs (R26, R34) — Proposed, needs approval

None of the target files is edited by this draft. On approval each target is bumped with a changelog and "Changed by 03a vX" markers.

#### Foundation v1.8 → v1.9

| Row | Section | Change |
|---|---|---|
| F-1 | §4.7 engine state | `stock: Record<StockItemId, StockEntry>` (§3 #1); `tableLocks` removed; shape = 03a §3.3 |
| F-2 | §4.7 `TickIntent`, §4.3 D51, §5.2 text | `TableLockReleased` leaves the engine; written by 02's own tick (§3 #8); `FireDispatched` gains `reason`; `SlipWarned` per table key. *v0.4 (G2 #16):* the §5.2 sentence "writes one event per intent (`FireDispatched`, `ReservationsShifted`, `SlipWarned`, …) in a single transaction" becomes: the `fires` tick writes the engine intents in its own transaction; `SlipWarned` and the slip / overload alerts are written by the separate `fires_alerts` tick in its own transaction (03a §3.6); `FireDispatched { reason: 'pulled' }` is written by 03b's `GiveMeMore` command and `ReservationsShifted { cause: 'late_start' }` by 03b's `StartItem` (D16, D42), not by a tick |
| F-3 | §4.7 hold-and-fire step 3, reservation lifecycle, E4 AC1 note | "Fixed at submit. Recalculated only on void, boost, stock update, or capacity change" → re-plan on every submit within slack; the promise never moves; target and promise travel in `OrderPlaced` (D13, P-2) |
| F-4 | §4.7 new paragraphs | station policy, item knobs, weights, padding, keep, overload, routing, freeze, auto-fill (D3–D10, D15, D16) by reference to 03a §3.5 |
| F-5 | §4.7 slip formula | `estimated_land_time > target_land_time + slip_threshold_ms` (was `original_promise`, D11); one warning per table key (§3 #7) |
| F-6 | §4.7 | `ItemsReleased` (D11); station pressure (D20) |
| F-7 | §4.4 | READY = every sync item Done (§3 #9) |
| F-8 | §5.8 step 3 | filter by `(stream_type, event_type)` lists, index `events_branch_stream (branch_id, stream_type, seq)` (§3 #2) |
| F-9 | §5.8 steps 6, 8; §5.9 steps 5, 7 | missed fires on the first tick, dry count at step 6 (§3 #3); `StockReserved { stock_item_id, order_item_id, quantity }` per draw; `OrderPlaced` carries groups, lines, target, promise |
| F-10 | §5.8 snapshot schedule | day-close checkpoint `engine_checkpoints`; full replay from it (D26) |
| F-11 | §7 OQ4, §9 tap-rate test | closed: taps mandatory (owner rule), `two_tap` default, tap rate measured from events in the first two pilot weeks (§3 #10) |
| F-12 | §5.1 text | "`setInterval` for fire-schedule ticks" → "the hub tick (01d `registerTick`)" (§3 #13) |
| F-13 | §4.2 SERVED → returned | *v0.2, pre-G2 #15:* return to kitchen has two modes, `fix` (a new expedited ticket, the served line unchanged) and `remake` (a new ticket, the served line `returned` as wastage); no reason in the pilot (D28); permission `mark-item-returned`, default Owner, Manager, Order taker |
| F-14 | §4.2 transition events | *v0.2, pre-G2 #32:* events are keyed `order_item_id` (01c); `previous_stage`, `next_stage`, `reason` are fields of the writing module (02 / 03b / 04), not engine fields (P-9) |
| F-15 | §5.9 step 11 | *v0.2, pre-G2 #12:* the KDS learns fire times from 03a's `station_plan` catch-up part and frame (03a §3.6.3), not from `ItemAdded.latestStartAt` |
| F-16 | §4.7 "Live station capacity" | *v0.2, pre-G2 #17:* through `SetStationCapacity`: staff sessions with `manage-stations`, or the station's own KDS station session for lane Off / On (00 M30), not only the hub admin UI |
| F-17 | §4.7 required test 11 | *v0.2, pre-G2 #33:* the slip for B's order appears on the next `getAlertIntents`, not in the capacity event |
| F-18 | §4.2 move-to-stock | *v0.2, pre-G2 #13:* `ItemMovedToStock` adds the portion to ready stock: `StockAdded { reason: 'moved' }` per draw (none without a draw), plus the reservation's `StockReleased { reason: 'moved' }`; *v0.4 (G2 #7):* like any `StockAdded`, it then reserves for waiting lines (03a §3.7) |
| F-19 | §4.7 "Recalculated only on void, boost, stock update, or capacity change" (D23) | *v0.4 (G2 #7):* "stock update" = a `StockSet` below reserved (release, full cook time) or a `StockAdded` (reserve for that stock item's unfired fresh lines in deadline order, stock cook time), each followed by a re-plan of the lines' stations (03a §3.7) |

#### 01a v2.0.1 → v2.1 (breaking before the pilot, R29)

*Changed in v0.3:* the defaults below are config defaults only; **pilot values are entered at setup (01a pages)**. `stations.completion_mode` (existing 01a field) keeps the default `two_tap` (owner A11).

**Cloud migration** (next free number, e.g. `0007_engine_config.sql`), one transaction, every new table with `tenant_id`, `version` (R30 V13: writes need `expected_version`), `created_at`, `updated_at`; times are integer ms.

| Row | Table / column | Type, range | Default | Decision |
|---|---|---|---|---|
| A-1 | **`points`** `point_id` PK ULID, `branch_id` FK, `name` 1–40 (unique among active at the branch), `sort_order` int, `archived_at` | — | migration creates "Pass" per branch | 03a-g0 §2, A12 |
| A-2 | `stations.point_id` | FK points, NOT NULL after backfill | the branch's "Pass" | D8 |
| A-3 | `stations.policy` | `'waada_guard' \| 'edf' \| 'fifo'` | `waada_guard` | D3 |
| A-4 | `stations.freeze_ms` | 0–900 000 | 120 000 | D15 |
| A-5 | `stations.min_slack_keep_ms` | 0–600 000 | 60 000 | D6 |
| A-6 | `stations.promise_padding_ms` | null or 0–1 800 000 (null = branch value) | null | D6 |
| A-7 | `stations.pressure_window_ms`, `pressure_amber_bp`, `pressure_red_bp`, `pressure_alert_ms` | 300 000–3 600 000; 1–20 000 with amber < red; 60 000–3 600 000 | 900 000; 8 000; 10 000; 300 000 | D20 |
| A-8 | `stations.pause_enabled` bool; `lane_units` null or 1–capacity; `reserve_units` 0–capacity | — | false; null (= capacity ÷ lane count, §3.10; v0.3, owner A2); 0 | D21, §3 #5, D8 |
| A-9 | **`station_alternates`** `(station_id, alternate_station_id)` PK, `order_types` ⊆ {dine_in, takeaway, delivery, parking} non-empty, `home_for_order_types` ⊆ `order_types`; both slot, same branch, distinct | — | none | D8, D9, P-3 |
| A-10 | **`carry_times`** `(station_id, point_id)` PK, `carry_ms` 0–600 000 | missing row = 0 | — | D8, D23 |
| A-11 | `menu_items.weight_pct` 10–1000; `max_early_ms` 0–3 600 000; `max_carry_ms` null or 0–600 000; `max_late_ms` null or 0–7 200 000; `adjust_time_ms` 0–3 600 000 (cook time of a `fix` return) | — | 100; 60 000; null; null; 180 000 | D3, D28 |
| A-12 | **`branch_engine_settings`** (PK `branch_id`; *v0.2.1:* written and read through 01b's branch settings endpoint, row B-6; *v0.4 (G2 #27):* `table_lock_ttl_ms` is **02's** setting, not an engine field — it is not in `EngineConfigApplied` — and is placed here only so one 01a bump carries every timing setting, 03a-g0 §5): `weight_dine_in_pct`, `weight_takeaway_pct`, `weight_delivery_pct`, `weight_parking_pct`, `weight_follow_up_pct` (10–1000); `promise_padding_dine_in_ms`, `…_takeaway_ms`, `…_delivery_ms`, `…_parking_ms` (0–1 800 000); `slip_threshold_ms` (60 000–1 800 000); `slip_escalate_ms` (30 000–1 800 000); `cascade_step_ms` (15 000–300 000); `min_gain_ms` (0–600 000); `table_lock_ttl_ms` (60 000–3 600 000, used by 02); `returns_boost` bool (a return is placed as a boost, D28) | — | 100, 200, 200, 200, 300; 180 000 ×4; 300 000; 120 000; 60 000; 60 000; 600 000; **true** (v0.3, owner Q15a) | D3, D5, D6, D7, D8, D11, D42, D51, D28 |
| A-13 | **`goes_with_links`** `link_id` PK, `source_kind` / `target_kind` ∈ {category, item}, `source_id`, `target_id`, `excluded` bool (an item override that removes a category default); unique `(tenant_id, source_kind, source_id, target_kind, target_id)` | — | empty, filled in the owner app (v0.3, owner B21) | D12 |
| A-17 | 01a §6.19 `stock_version` | `STOCK_VERSION_EVENTS` gains `StockReserved`, `StockReleased`, `StockConsumed`; boot reads the version with 2 statements on `events_branch_stream` instead of the step-3 fold (v0.2, pre-G2 #3) | — | — | 01a S15 |
| A-18 | 01a §4.4 To 03a | "the hand-over step" = `StockConsumed` at `ItemStarted` (P-5; v0.2, review §4.5 list) | — | — | S14 |
| A-19 | `StockAdded` v2 (01c V5 schema, 01a S45 rule) | optional `reason?: 'moved'`, additive within v2; absent = a manual add (v0.2, pre-G2 #13) | — | absent | F-18 |

**Cloud endpoints (*Changed in v0.2.1*, Q11 closed: +2, 28 → 30, inside the split line):** `POST /v1/admin/branches/:branch_id/points` and `PATCH …/points/:point_id` (R30 `expected_version`), the only new routes; *Changed in v0.4 (G2 #18):* the `POST` requires `Idempotency-Key` (01a S7, F §6.4, M69), both routes add their case to `apps/cloud/test/helpers/route-cases.ts` (C7), and the A-1 name rule is the partial unique index `points_branch_name_active ON points (tenant_id, branch_id, name) WHERE archived_at IS NULL` (serves: the duplicate-name check of the `POST`, of a rename `PATCH` and of a restore, `409` as 01a's other named rows); points are listed in the existing `GET …/stations` response (01a §6.8, + 1 statement). **Folded into existing resources:** the station engine fields (A-2–A-8), `alternates` (A-9) and `carry_times` (A-10) are accepted by 01a's station `POST` / `PATCH` (§6.9) as fields and two nested replace-lists (C1, C6) and returned by its `GET`; `branch_engine_settings` (A-12) are fields of **01b's existing** `GET` / `PATCH /v1/admin/branches/:branch_id/settings` (01b §6.10, row B-6); `goes_with_links` (A-13) are a `goes_with` list on 01a's category `PATCH` (the default) and menu-item `PATCH` (adds and excludes), read in the existing menu read. `PATCH /v1/admin/menu-items/:id` accepts the five knobs (last write wins as 01a S23 / R30 named divergence). Owner app pages: the station form's "Timing" group, "Points", the branch settings page's "Kitchen timing" group, and the item form's "Timing" group (settings screen, D1).

**Snapshot schema 3 (`BranchConfigSnapshotSchemaV3`, `SNAPSHOT_SCHEMA_VERSION = 3`), breaking (R29):** adds `points[]` `{ point_id, name, sort_order, is_archived }`; `stations[]` gain `point_id, policy, freeze_ms, min_slack_keep_ms, promise_padding_ms, pressure_window_ms, pressure_amber_bp, pressure_red_bp, pressure_alert_ms, pause_enabled, lane_units, reserve_units, alternates: [{ station_id, order_types, home_for_order_types }], carry_times: [{ point_id, carry_ms }]`; `items[]` gain `weight_pct, max_early_ms, max_carry_ms, max_late_ms, adjust_time_ms`; top-level `engine_settings {…A-12, returns_boost}` and `goes_with: [{ source_kind, source_id, target_kind, target_id, excluded }]`; sorting as 01a §4.3. **Cost:** cloud and every hub released together (01a S28 b; a hub on v2 refuses a schema-3 body and polls again); the builder gains 5 statements (points, alternates, carry times, engine settings, goes-with), so `GET /v1/sync/config` `200` ≤ **32** with the directory and ≤ **27** config-only (*Changed in v0.4, G2 #2:* from 01b's current bounds 27 / 22, 01b v1.4.1 §4.4 row 6, B-5 of 01d v1.0; v0.3's "31" started from the stale 26). The bound is **01b's** (R32 b), so it is carried as 01b row **B-8**, not here; 01c's builder and snapshot tests re-baselined; every fixture builder (`packages/events/testing`) moves to V3; 02 / 03b clients parse V3 only. No hub runs orders yet (R29), so no data migration on hubs.

**Hub (01a hub code):** A-14 the stock commands append the drafts of `stockEffects` (`StockReleased` for a recount below reserved, S14 v0.6, and `day_closed` at `CloseBusinessDay`, in the commit of `BusinessDayClosed`; *v0.4:* `StockReserved` after `StockAdded` from `AddPrecookedStock`, G2 #7; no `unit_changed` at `OpenBusinessDay`, G2 #21); A-15 boot step 3 fold replaced by 03a (carried row); A-16 §4.2 table: `ENGINE_STATE_VERSION = 3`, `EngineState` gains 03a's slices.

#### 01b v1.4.1 → v1.5

| Row | Change |
|---|---|
| B-1 | Permission `manage-stations` (group `kitchen`; scopes `branch`, `my_stations` — the person's stations through `stationsOf`, as `manage-stock`; default **Manager** (v0.3, owner A7; Owner holds every permission, `default-roles.ts:28`)): live capacity, lane Off / On, station pause (03a-g0 §5) |
| B-2 | Permission `mark-served` (group `orders`; scopes `branch`, `own_tables`, `my_floors`; default Owner, Manager, Order taker, Waiter), defined here so one 01b bump carries both; 02 uses it (G0 P4). *v0.4 (G2 #25):* **no backfill migration** — `DEFAULT_ROLES` seeds new tenants only, and no tenant runs live before the pilot (R29); the dev and pilot tenants are re-seeded with the 01b v1.5 release (stated in its release note). This differs from 01a's `0003_manage_stock_backfill.sql` because that one covered a tenant set up for the pilot before 01a; if such a tenant exists when 01b v1.5 ships, the same backfill pattern applies. Manager gets `manage-stations` and `mark-served` from the existing rule (all but `manage-roles`) |
| B-3 | `default-roles.ts` and the roles editor catalogue gain both; directory statement count unchanged (rows, not statements) |
| B-4 | *v0.2, pre-G2 #16:* new responsibility kind **`run_station`** (01b §3.6; assignable per station like `count_stock`); `my_stations` for `manage-stations` resolves through `stationsOf(staff, 'run_station')`; `StaffDirectory.stationsOf`'s `responsibility` parameter widens to `'count_stock' \| 'run_station'` (`apps/hub/src/auth/staff-directory.ts:289`); the directory carries the new rows in the existing `responsibilities` table (no new statement) |
| B-5 | *v0.2, pre-G2 #15:* `mark-item-returned` (exists) default grants: Owner, Manager, **Order taker** (D28 return to kitchen); *v0.4 (G2 #25):* backfill as B-2 (none, R29) |
| B-6 | *Changed in v0.2.1 (Q11):* `GET` / `PATCH /v1/admin/branches/:branch_id/settings` (01b §6.10) gains the `branch_engine_settings` fields of 01a A-12 (same ranges and defaults; the row lives in 01a's table, written in the same transaction as the branch settings, C5 one audit row; `expected_version` as 01b B23). No new 01b endpoint |
| B-7 | *v0.3 (owner A10):* `boost-order` default Owner, Manager — no change: as built Owner holds every permission and Manager all but `manage-roles` (`default-roles.ts:28, 34`) (*v0.4, G2 #12:* rows in order) |
| B-8 | *New in v0.4 (G2 #2; R32 c):* §4.4 row 6 sync bound: `GET /v1/sync/config` `200` with the directory ≤ 27 → **≤ 32**; config-only ≤ 22 → **≤ 27**; directory-only ≤ 17 and `304` unchanged. Cause: 01a snapshot schema 3 adds 5 builder statements (points, alternates, carry times, engine settings, goes-with; 01a v2.1 row above). 01b's bound test is re-baselined with it |

#### 00 v1.6.1 → v1.6.2 (additive patch)

| Row | Change |
|---|---|
| H-1 | *Revised in v0.2 (pre-G2 #31); Changed in v0.4 (G2 #6):* `BootContext` (`apps/hub/src/lib/boot.ts:43-49`) gains two optional fields: `clock?: Clock`, set by 00 right after it creates the clock at step 3a (`boot.ts:138-144`), so steps after 3a (03a's step 6) read `ctx.clock.branchNow()` instead of the wall clock or `app` internals; and `missedFires?: number`, set by 03a's step 6 and used by step 8 `HubStarted.missed_fires` (today `0`, `boot.ts:211`). Step 6 reads the replayed state from `ctx.initialState` (unchanged between steps 3 and 6). `events_replayed` keeps its meaning (step-4 projection catch-up, `boot.ts:171-172`); the engine's replay count is logged, not added to the event |
| H-2 | *Not needed (v0.2):* the config catch-up (pre-G2 #4) runs in the first `fires` pass, so `BootContext` needs no writer |

#### 00 v1.6.1 → v1.7 (with 01e; Changed in v0.4, G2 #1)

00 v1.7 is the bump 01e owns (01d G1 §5, README "00 v1.7 stays free for 01e"); 03a's rows below join it. If 00 v1.6.2 (H-1) ships first, v1.7 applies on top of it. 03a reads neither column: `capacityForLanes` takes `lane_count` as an input (§3.10). Row names H-3 and H-4 are skipped (they are 00 v1.6's own rows).

| Row | Change |
|---|---|
| H-5 | **`devices.point_id`** `TEXT NULL`, a nullable FK to 01a's points (A-1). The hub holds points only in the applied config snapshot, so the FK is enforced at the write against `branchConfig().points` (active points of the branch), not by a SQL constraint; forward hub migration. A tablet bound to a point receives the point's alerts; several tablets may be bound to one point (01d G1-12a). Archiving a point leaves bound devices with a point that no longer routes (01d's point target resolves no one; 03b warns) |
| H-6 | **`devices.lane_label`** `TEXT NULL` (1–20 chars), same migration. A `kds` device with a `station_id` and a non-null `lane_label` **is a lane** of that station (01d D4); `lane_count(station) = count of such devices not revoked`, else 1. `lane_label` on a device of another kind, or without `station_id`, is refused at the write (`400 VALIDATION_FAILED`). The pairing / binding UI is 03b's, the headless (ESP32) side 01e's (§4.3) |

#### 01d v1.1 → v1.1.1 (editorial only)

| Row | Change |
|---|---|
| N-1 | §3.3 rule 2 "no pilot request kind is tick-raised" → "03a's `slip_warning` is tick-raised (`named`, `needs_pin: 'never'`): no in-person answer, no requester, no withdraw, no `request_result` (AD-72); 03a closes it". `station_overload` is a plain `info` kind; the table dedupe key works under `(kind, dedupe_key)` as written. No rule change. |
| N-2 | *v0.2, pre-G2 #30 (editorial):* §4.3 To 03a and the §4.4 stub row: the Ready-to-serve kind is 03b's (03a-g0 §3 #6); the slip target is `{ kind: 'person', staff_id: <receiver> }` with `receiver_staff_id` from 02's `tableOwners`, raised by 03a's `fires_alerts` tick, not `{ kind: 'table_team', depth: 'owner' }` |

#### README

R-1 module map row 03a: depends on 00 v1.6.x (v1.7 rows H-5, H-6 with 01e), 01a **v2.1**, 01b v1.5, 01c v1.1, 01d v1.1; blocked by 01a v2.1 (no longer by the field visit, v0.3). R-2 the five "To 03a" carried rows marked addressed (§12.4 map). R-3 carried rows "To 02", "To 03b", "To 04", "To 07" from §4.3, and *(v0.4, G2 #1)* "To 01e" (point and lane devices, 00 v1.7 H-5, H-6) with the "To 03b" binding sentences. R-4 OQ4 closed (§3 #10). R-5 R6 unchanged (no re-plan events, D13). R-6 (*v0.2, pre-G2 #14; Changed in v0.4, G2 #21*) carried row "To 05": 05's day close appends `stockEffects` (`day_closed`) in the commit of `BusinessDayClosed` and keeps it as the checkpoint trigger; no `unit_changed` at the day open.

#### 01c v1.1 → v1.1.1 (editorial; v0.2, pre-G2 #28, #29)

| Row | Change |
|---|---|
| C-1 | §4.3 heading: "02 owns the schema file" → "03a owns the `ItemAdded` schema file (03a-g0 §3 #4); 02 implements it exactly"; `station_id` = the home route (D25), the engine's station is `OrderPlaced.lines[].station_id` (03a D8) |

---

## §5. Data model and migrations

### 5.1 Hub — `apps/hub/src/db/migrations/0007_engine.sql` (forward-only, F §6.8)

```sql
-- F §5.8 snapshot table (D62), as specified there
CREATE TABLE engine_snapshots (
  snapshot_id    TEXT    PRIMARY KEY,
  branch_id      TEXT    NOT NULL,
  taken_at       INTEGER NOT NULL,
  last_seq       INTEGER NOT NULL,
  engine_version INTEGER NOT NULL,
  state_json     TEXT    NOT NULL
);
CREATE INDEX eng_snap_branch ON engine_snapshots (branch_id, taken_at DESC);
  -- serves: boot step 2 "latest snapshot" and retention (keep 2; v0.2, pre-G2 #37)

-- D26 day-close checkpoint (version-independent document)
CREATE TABLE engine_checkpoints (
  checkpoint_id     TEXT    PRIMARY KEY,
  branch_id         TEXT    NOT NULL,
  taken_at          INTEGER NOT NULL,
  last_seq          INTEGER NOT NULL,     -- max seq of the commit that folded BusinessDayClosed (v0.4, G2 #5)
  checkpoint_schema INTEGER NOT NULL,     -- 1
  body_json         TEXT    NOT NULL
);
CREATE INDEX eng_ckpt_branch ON engine_checkpoints (branch_id, last_seq DESC);
  -- serves: boot step 2 fallback; retention keeps 2 (v0.2, pre-G2 #37)

-- §3 #2: replay by (stream_type, event_type) since a seq
CREATE INDEX events_branch_stream ON events (branch_id, stream_type, seq);
  -- serves: the four replay statements and the two stock_version reads of §3.12 (v0.2, pre-G2 #3)
```

*Changed in v0.4 (G2 #26):* `events_branch_stream` is built by the migration over the whole `events` table, inside boot. Before the pilot every hub's log is small (no hub runs real orders, R29), so the build is seconds. A hub that already holds a long log when 03a ships builds it once, at the 03a release in the maintenance hour (01a S39), never mid-rush; at R6 volume one index over ≈ 75k rows/day is ≈ 1 s per month of history on the pilot box (measured once in task 28).

**YAGNI:** `engine_checkpoints` prevents a version-bump boot from replaying the whole history (a year ≈ 16 M events) against the 90 s budget (D26); the index prevents a full scan of `audit` (≈ 30k/day) on every boot (§3 #2). No projection tables: the engine state is in memory and rebuilt from events.

### 5.2 Cloud

01a v2.1's migration (§4.5). 03a adds nothing in the cloud.

### 5.3 Upcasters (D46)

None: every 03a event is new at v1. `StockReserved` / `StockReleased` v1 are first defined here (01c named them).

---

## §6. Endpoints, commands and events

Count against the size budget: 13 engine function rows that later modules call (batch 1; several names per row), 5 host pieces (batch 2: two ticks, boot, kinds and hook, the station plan), 2 commands and 1 query (batch 3) = **21** (budget 10–25). *Changed in v0.2 (pre-G2 #1, #12).*

### Batch 1 — `@pos/engine` (pure; no route)

| # | Function | Contract |
|---|---|---|
| 6.1a | `applyEvent(state, event)` / `buildEngineState(events)` / `fromCheckpoint(body)` / `isOrderInEngine(state, order_id, t)` / `ENGINE_REPLAY_EVENTS` | §3.3–§3.12; never mutates its input; deterministic in `(state, event)`. *Changed in v0.4 (G2 #3):* `applyEvent` handles **exactly** the types of `ENGINE_REPLAY_EVENTS` (test 94); any other type returns `state` itself and removes nothing; exited orders are removed only in handled folds (§3.3); `isOrderInEngine` is the exit predicate every reader uses |
| 6.1b | `planOrder(state, proposed, now)` → `{ groups: [{ group_id, target_land_ms, promise_ms, order_item_ids }], lines: [{ order_item_id, station_id, alternates, point_id, carry_ms, from_stock, eta_ms }] }` | §3.5.1; throws `DomainError('STATION_PAUSED')`; same result for the same inputs |
| 6.1c | `calculateETA(state, proposed, now)` | `planOrder` without stock claims kept; preview only (F §4.7 signature kept) |
| 6.1d | `checkOrderable(state, proposed)` | D21 pause check |
| 6.1e | `reserveStock(state, proposed, dayStartMs, stockItems, configStockUnits)` (v0.2, pre-G2 #27) → `{ drafts: StockReserved[], from_stock: Record<id, boolean>, refused: string[] }` | §3.7 |
| 6.1f | `stockEffects(state, draft, stock_ctx?)` → `EventDraft[]` | §3.7: the `StockReleased` / `StockConsumed` / `StockAdded` / `StockReserved` drafts a triggering draft needs. *v0.4 (G2 #7):* `stock_ctx = { dayStartMs, stockItems, configStockUnits }` (as `reserveStock`) is required for a `StockAdded` draft, whose result includes the `StockReserved` drafts for waiting lines |
| 6.1g | `getTickIntents(state, now)` / `nextDueAt(state)` / `firesDue(state, last_pass_ms, now)` (v0.2.1) / `getAlertIntents(state, now)` / `nextAlertDueAt(state, exclude?)` (v0.4) | §3.6.1; pure; same result twice (F test 13). `getAlertIntents` → `{ slips: [{ table_key, order_ids, estimate, target, promise }], resolved: [{ table_key, alert_id }], overload: [{ station_id, pressure_bp, waiting, capped }] }` for `fires_alerts` (v0.2, pre-G2 #1). *Changed in v0.4 (G2 #4):* a slip item appears only when its crossing time is reached and `slips[key].alert_id = null`; `resolved` lists keys with `resolved_at ≠ null` (closed `done`); `nextAlertDueAt(state)` = `state.next_alert_due_at`, and with `exclude` the same minimum without those keys (§3.8) |
| 6.1h | `stationView(state, station_id, now)` → `{ now: Line[], next: Line[], later_count }`; `stationPlan(state, station_id, now)` → the `station_plan` body (§3.6.3) | D16, D17 (Now = fired, Next = frozen in fire order, Later = count); v0.2, pre-G2 #12 |
| 6.1i | `groupReadiness(state, order_id)` → per group `{ done, waiting, hold: boolean }` | §3.4, §3 #9 |
| 6.1j | `stationPressure(state, station_id, now)` / `stationsLive(state, now)` | §3.10; `stationsLive` = §6.5 body |
| 6.1k | `pullEarly(state, station_id, n, now)` → `FireDispatched` draft | D16 Give me more, same `max_early_ms` |
| 6.1l | `lateStartShift(state, order_item_id, started_at)` → `ReservationsShifted \| null` | F §4.7 D42 late start |
| 6.1m | `planRelease(state, order_ids, ticks?)` / `goesWith(lineA, lineB, links)` / `capacityForLanes(station, lanes_on, lane_count)` (v0.4, G2 #1, #9: `lane_count` integer ≥ 1, an input) | §3.8, D12, §3.10 |

### Batch 2 — hub host

**6.2 Tick `fires`** (`apps/hub/src/engine-host/fires-tick.ts`; *Changed in v0.2, pre-G2 #1:* engine intents only). `due(db, state, now)`: `firesDue(…).intents_due || configStale`; sends the freeze-entry `station_plan` frames itself, outside any transaction (§3.6.3, v0.2.1) — no statement, no transaction. `intents(tx, state, now)`:
1. `configStale` → one `EngineConfigApplied` draft and **nothing else** in this pass (§3.11, pre-G2 #4; *Changed in v0.4, G2 #22:* intents follow next pass on the folded state); clear the flag after commit.
2. `intents = getTickIntents(state, now)` (pure).
3. Fire, start, done, shift, consume drafts from the intents; `StockConsumed` from `stockEffects`.
4. Return the drafts — one transaction (D44). Post-commit: the `station_plan` frames for touched stations, and for lines that entered Next in a pass that also had intents (§3.6.3); 03b's ticket printing through its own `addAfterCommit`.

Statements per pass with work: **0** reads (state in memory) plus the appends; a pass with only freeze entries: 0 statements, no transaction, frames only (v0.2.1). Target p99 ≤ 20 ms per pass with work on the pilot box (§7.1).

**6.2a Tick `fires_alerts`** (`apps/hub/src/engine-host/fires-alerts-tick.ts`; *new in v0.2, pre-G2 #1, #11; Changed in v0.4, G2 #4, #23*), registered right after `fires`. `due(db, state, now)`, in memory, **no statement**: `now ≥ nextAlertDueAt(state, skipped)` (§3.8), or the overload check finds a change against `overload_open` (§3.10), or the host flag `day_closed` (set after a commit that contains `BusinessDayClosed`, and at boot step 6 when `state.business_day?.closed_at ≠ null`), or the host flag `reconcile` (first pass after boot). A raised slip or overload that persists unchanged is never due again. `intents(tx, state, now)`:
1. `alerts.listOpen(tx.db, { kind: 'slip_warning' })` and `alerts.listOpen(tx.db, { kind: 'station_overload' })` — **2** statements; the second refreshes `overload_open` (and clears `reconcile`).
2. Slips: `getAlertIntents(state, now).slips` (each has `slips[key].alert_id = null` and its crossing reached) → `raiseMany` inputs (receiver from 02's `tableOwners` — **one** statement for every table of the pass, or `placed_by` while stubbed); inputs whose receiver is missing or whose values fail the schema are skipped, logged and added to `skipped` (§3.8).
3. Overload: raise inputs for stations red past `pressure_alert_ms` (host `red_since`, P-7) or capped and not in `overload_open`; close items for stations in it and below amber.
4. Closes: `resolved` slips `done` by their `alert_id` (state); with `day_closed`, every `slip_warning` from step 1 `obsolete` (§3.8, pre-G2 #11), then clear `day_closed`.
5. **One** `alerts.raiseMany(alerts.tickCtx(tx, now), inputs)` and **one** `alerts.closeMany(…)` (01d fixed statement count, test 35 (d)); then one `SlipWarned { …, alert_id }` draft per raised slip from the returned ids (§3.8).
6. Return the drafts — this tick's own transaction. A throw rolls back only this tick (01d isolation); fires are never affected. After commit the folds of `SlipWarned` and `AlertClosed` move `next_alert_due_at`, so the next pass is not due for the same keys.

Statements per pass with work: 2 (`listOpen`) + ≤ 1 (`tableOwners`) + 01d's `raiseMany` and `closeMany` bounds; 0 and no transaction when not due — including while a raised slip or overload persists unchanged (v0.4, G2 #4; test 93).

**6.3 Boot steps** (`apps/hub/src/engine-host/boot-steps.ts`, replacing 01a's step-3 registration). Step 2: snapshot / checkpoint load (§3.12, 2 statements). Step 3: four replay statements, merge, fold; `ctx.initialState`; two `stock_version` reads (§3.12, v0.2 pre-G2 #3). Step 6 (*Changed in v0.4, G2 #6, #23*): `ctx.missedFires` from a dry `getTickIntents(ctx.initialState, ctx.clock.branchNow())` (no write; `ctx.clock` from 00 row H-1); `configStale` (§3.11); the `day_closed` and `reconcile` flags of 6.2a. Also the snapshot writer (`writer.addAfterCommit` schedules it with `setImmediate` when a 500-event multiple is crossed, v0.2 pre-G2 #38; SIGTERM via `app.addHook('onClose')`, before the database closes) and the checkpoint writer (after a commit containing `BusinessDayClosed`; `last_seq` = that commit's last seq, body with `business_day`, v0.4 G2 #5), and the one fresh snapshot after a boot that loaded no current-version snapshot (F §5.8, v0.4 G2 #17). A failing step stops boot (00 §3.8).

**6.4 Kinds and hook.** `defineAlertKind` for `slip_warning` (§3.8) and `station_overload` (§3.10) at module load; `onBranchConfigApplied` (§3.11, 0 extra statements: reads `next` and the state). Audiences: `EngineConfigApplied`, `StationCapacitySet`, `StationPauseSet` → every staff and station socket; no audience on order-stream events (01d run 3 §4). Catch-up parts `stations_live` (staff and station sockets; body = §6.5; 0 statements) and `station_plan` (§3.6.3; 0 statements); frame `station_plan` (same audience as its catch-up part: that station's station sockets and every staff socket, v0.4 G2 #19) added to the `WsServerMessage` union (F §6.5; v0.2, pre-G2 #12).

### Batch 3 — commands and query

#### 6.5 `GET /queries/stations-live`

Session: device, `session: 'required'`, `allowStation: true`, `countsAsActivity: false`. Query: `{ station_ids?: string[] (≤ 50) }`. **0 SQL statements** (in-memory state). Response `200`:

```json
{ "data": { "as_of_seq": 48211, "now_ms": 1793722800000, "stations": [
  { "station_id": "01JC…S3", "name": "Tandoor", "capacity": 30, "capacity_override": null,
    "effective_capacity": 30, "paused": false, "pause_enabled": false,
    "pressure_bp": 12500, "band": "red", "later_count": 14, "wait_ms": 1080000 } ] } }
```

`wait_ms` = time until one unit with the station's `reference_cook_ms` (§3.11, defined in v0.4 G2 #24) can start (§4.3 To 02 tile). Errors: `400 VALIDATION_FAILED`; unknown ids are left out (a read).

#### 6.6 `POST /commands/set-station-capacity` (`SetStationCapacity`)

*Changed in v0.2 (pre-G2 #17):* `defineCommand({ sessionKind: 'device', stationScoped: true, permission: 'manage-stations', … })` — the 00 M30 pattern: a **station session** (KDS) may send it for **its own** `station_id` with `reason: 'lane_off' | 'lane_on'` only; its events carry `actor_id = null` and the KDS `device_id`. A **staff session** needs `manage-stations` (scope `my_stations` through `run_station`, B-4, checked last, C8). Payload `{ station_id, capacity_override: int 1–100 | null, reason: 'manager' | 'lane_off' | 'lane_on' }` (*Changed in v0.4, G2 #15:* 01a's station `capacity` range 1–100, 01a v2.0.1; was 1–999). Script (subset of 00 §3.7):
1. Schema → `400 VALIDATION_FAILED`.
2. `BEGIN IMMEDIATE`; idempotency re-check (D32).
3. Station in `state.stations` and not archived → else `404 STATION_NOT_FOUND`.
4. Station session: `station_id ≠ actor.stationId` or `reason = 'manager'` → `403 PERMISSION_DENIED { reason: 'outside_scope' }`. Staff session: scope → `403 PERMISSION_DENIED { reason: 'outside_scope' }`.
5. Same as current → no event, `200 { changed: false }`.
6. Append `StationCapacitySet`; reducer re-plans (D37); COMMIT; swap (D45).
7. `200 { data: { station_id, effective_capacity, pressure_bp, band, changed: true } }`.

*Changed in v0.4 (G2 #20):* step 5 answers with the **same shape**, `200 { data: { station_id, effective_capacity, pressure_bp, band, changed: false } }`, so a client reads one body (F §6.1 envelope).

Retransmit returns the stored response (D32). COMMIT failure leaves the live state untouched (D45, test 68). Slips for displaced orders are written by the next tick (≤ 500 ms).

#### 6.7 `POST /commands/set-station-pause` (`SetStationPause`)

Permission `manage-stations`, staff sessions only (`stationScoped: false`; a KDS does not pause its station). Payload `{ station_id, paused: boolean }`. Script: 1–3 as 6.6; `paused: true` and `pause_enabled = false` → `409 STATION_PAUSE_DISABLED { station_id }`; **then** the scope check → `403 outside_scope` (C8: scope last; *Changed in v0.2, pre-G2 #24*); same as current → `200 { data: { station_id, paused, changed: false } }` (one shape, v0.4 G2 #20); append `StationPauseSet`; `200 { data: { station_id, paused, changed: true } }`. Unpausing is always allowed.

---

## §7. Cross-cutting (this module only)

### 7.1 Performance targets (D24–D27, R6)

| Path | Target | Measured by |
|---|---|---|
| Re-plan per submit (`planOrder` + the `applyEvent` re-plan), inside the writer lock | **p99 ≤ 50 ms** on the pilot box (00's 5 ms no-op budget stays for other commands) | §10.6 CI test + manual check on the pilot mini PC (as 01d #58) |
| Lines re-placed in one submit re-plan (D25 prune + freeze) | ≤ 250 on the generated day (D25 "order of 100–200"; set from the first CI run, spec first) | §10.6 |
| Overload pass (§3.5.6) | ≤ 16 probes; p99 ≤ 50 ms included | §10.6 overload day |
| Fires tick pass with work | p99 ≤ 20 ms; idle `due` no statement | test 62 |
| `fires_alerts` pass with work (v0.2) | p99 ≤ 20 ms; not due → no statement and no transaction, also while a raised condition persists (v0.4, G2 #4) | tests 76, 93 |
| Snapshot write (v0.2, pre-G2 #38) | ≤ 50 ms at design size, off the response path | §10.6 |
| Crash restart (≤ 500 events) | ≤ 2 s for steps 2–3 | test 64 |
| Full replay from the day-close checkpoint (≈ 66k events) | ≤ 45 s (inside 90 s; D26 est. 40–50 s) | §10.6 |
| `stations-live` | 0 statements; ≤ 5 ms | test 66 |

A re-plan slower than 50 ms is logged at `warn` `{ event_type, station_id, lines, ms }` (no payload).

### 7.2 Logging

Tick errors as 01d (`{ tick: 'fires', err }`). Boot logs `{ step, snapshot_seq, checkpoint_seq, events_replayed, ms }`. No order contents in logs.

### 7.3 Folder placement (F §6.9)

`packages/engine/src/{state,profile,plan,replan,overload,route,tick,stock,slip,pressure,view,checkpoint}.ts`; `packages/engine/test/sim/` (harness, generated day); `packages/events/src/events/{order,station,stock}/`; `apps/hub/src/engine-host/{fires-tick,fires-alerts-tick,station-plan,boot-steps,snapshots,kinds,config-hook}.ts`; `apps/hub/src/commands/{set-station-capacity,set-station-pause}.ts`; `apps/hub/src/queries/stations-live.ts`; migration `apps/hub/src/db/migrations/0007_engine.sql`.

### 7.4 Not added (YAGNI)

No re-plan events (D13); no load snapshot field (K11/K12, 03a-g0 §2); no persisted pressure (pure); no projection table; no cache.

---

## §8. Client contract

03a has no screens. For clients of 02 / 03b / 07:
1. Show `promise_ms` to people; `target_land_ms` is internal (D6).
2. Station tiles and strips read the `stations_live` catch-up part and `GET /queries/stations-live`; refresh on the three station-stream frames and every 30 s while visible.
3. Bands: green / amber / red from `band`; red on an item tile = "tell the customer" (D20).
4. `slip_warning` cards follow 01d §8 (answer buttons from the kind's labels; minutes late against the promise).
5. i18n keys `alert.slip_warning.*`, `alert.station_overload.*`, `errors.STATION_PAUSED`, `errors.STATION_PAUSE_DISABLED`.

---

## §9. Error catalogue additions

| Code | Status | `details` | Returned when |
|---|---|---|---|
| `STATION_PAUSED` | 409 | `{ station_id }` | a submit (02) or addition routes a line only to a paused station (D21) |
| `STATION_PAUSE_DISABLED` | 409 | `{ station_id }` | `SetStationPause { paused: true }` on a station with `pause_enabled = false` |
| `ORDER_NOT_IN_ENGINE` | 409 | `{ order_id }` | **02's** `ReturnToKitchen` (and any `OrderLinesAdded` writer) for an order that has left the engine state (§3.3: day closed, or 30 min after its last line was served); defined here because the rule is 03a's (v0.2, pre-G2 #2) |

Reused: `400 VALIDATION_FAILED`, `403 PERMISSION_DENIED { reason: 'outside_scope' }`, `404 STATION_NOT_FOUND`. The three new codes are appended to F §6.2 and `@pos/domain/src/errors.ts` (no foundation bump, R34).

---

## §10. Tests

Numbers 1–15 are F §4.7's required engine tests, kept and adapted to `EngineState` v3; F test 11 asserts the slip on the next `getAlertIntents`, not in the capacity event (§4.5 F-17; v0.2, pre-G2 #33). Test names cite their numbers (F §6.7).

### 10.1 Engine — pure (`packages/engine/test/`)

| # | Case |
|---|---|
| 16 | Units: "Roti ×4" holds 4 slots; capacity 30 with 28 used → the line waits (P-1) |
| 17 | Target and promise: `P = T + padding`; FIFO / EDF stations padding 0 (D6, D3) |
| 18 | Promise travels in `OrderPlaced`; `applyEvent` stores it and never recomputes (P-2) |
| 19 | Plan at the last listed `ItemAdded`, not before; deal line never placed (01c §3.4.7) |
| 20 | Re-plan pass 1 keeps an older line's `keep`: a newer order cannot push it past `d − keep` (D6) |
| 21 | Re-plan moves an older hidden line within slack; frozen and fired lines do not move (D13, D15) |
| 22 | Freeze evaluated at `recorded_at`, never a clock (D13) |
| 23 | Prune: lines ending before the pivot are fixed input; result equals an unpruned re-plan on the fixture (D25) |
| 24 | FIFO: earliest fit in submit order, no hold (D3) |
| 25 | EDF = Waada Guard with weights 100, keep 0, padding 0 (D3) |
| 26 | Overload: weight-2 line carries half the lateness of a weight-1 line on one slot (D5) |
| 27 | `max_late_ms` cap: line not shifted past the cap; overload flagged (D3, D20) |
| 28 | Routing: earliest arrival wins; gain < `min_gain_ms` → home; carry adds; `max_carry_ms` filters (D8, D9) |
| 29 | Reserve units usable only by home order types (D8) |
| 30 | Re-route only hidden lines (D10) |
| 31 | Delivery: `T = max(pickup, ETA)` (D3) |
| 32 | Auto-fill fires from Next within `max_early_ms`; urgent (slack ≤ keep) first, then `w × waiting` (D16) |
| 33 | `pullEarly` respects `max_early_ms`; `reason: 'pulled'` (D16) |
| 34 | Boost: earliest fit; displaced lines late → slip intents; boosted promise unchanged (D4) |
| 35 | Slip threshold from the target, not the promise (D11) |
| 36 | Slip grouped per table key; re-raise only after +threshold and the previous alert closed (`slips[key].alert_id = null` after its `AlertClosed` fold; v0.4 G2 #4) (§3 #7, D44) |
| 37 | `ItemsReleased`: released leave the group; expedite immediate with follow-up weight; rest stay sync (D11, D12) |
| 38 | `goesWith`: category default, item add, item exclude; nothing configured → nothing pre-ticked (D12) |
| 39 | Stock: every draw must fit; `sold_out` at 0 refused; `cook_fresh` full cook time (01c §3.5.2, S32) |
| 40 | Recount below reserved releases the most recent units; those lines re-plan at full cook time (S14 v0.6) |
| 41 | `StockConsumed` at start moves units out of `on_hand` and `reserved`; never below 0 (P-5) |
| 42 | *Changed in v0.4 (G2 #21):* day close then day open with a unit change: every reservation was released `day_closed` in the close commit, `reserved = 0` at the open, and `stockEffects(BusinessDayOpened)` returns `[]` (no `unit_changed` path, S44) |
| 43 | Weighed line with pending weight: 1 unit, item cook time, fired normally (V18) |
| 44 | Batch: program cook times from the line copies (B1); `max_early_ms` caps freshness per line (D3) |
| 45 | Capacity change re-plans with frozen lines fixed (D37) |
| 46 | *Changed in v0.4 (G2 #9):* `capacityForLanes(station, lanes_on, lane_count)`: `lane_units` set → `max(1, min(capacity, lanes_on × lane_units))`; `lane_units` null → `lane_units = floor(capacity ÷ lane_count)`, same clamp; `lane_count = 1` → `lanes_on × capacity` clamped; integers only (§3 #5, §3.10) |
| 47 | Pause: `checkOrderable` refuses; open lines continue (D21) |
| 48 | Pressure bands from the profile; pure in `(state, now)` (D20) |
| 49 | Exit on all served / voided / removed and at day close (§3 #11); *v0.4 (G2 #13):* `isOrderInEngine` false from `last_served_at + 1 800 000`; a void or remove that leaves no open line starts the window |
| 50 | READY = every sync line done; hold at pass for a done line with an undone sibling (§3 #9) |
| 51 | `ItemDoneUndone` returns the line to COOKING and its occupancy (D16) |
| 52 | Inferred start / done per `completion_mode` (D60) |
| 53 | `EngineConfigApplied`: capacity change re-plans; cook-time change affects new orders only; archived station lines complete (§3.11) |
| 54 | Station-type change keeps open lines as fixed input (§3.11) |
| 55 | Checkpoint round trip: `fromCheckpoint(checkpoint)` + one day = full replay from seq 0 (D26). *Changed in v0.4 (G2 #5):* (a) a boot from the checkpoint **at night** (after the close, before the next open) equals a full replay, `business_day` included; (b) a checkpoint whose commit carries `BusinessDayClosed` and its `StockReleased { day_closed }` (in either order in the batch) boots cleanly: `last_seq` = the commit's last seq, the releases are not folded twice, `reserved` stays ≥ 0 |
| 56 | Snapshot fixture: state shape or `applyEvent` meaning changed without bumping `ENGINE_STATE_VERSION` fails (D62, F §6.7) |

### 10.2 Hub

| # | Case |
|---|---|
| 57 | Boot: snapshot v3 loaded; v2 snapshot skipped → checkpoint → one-day replay; no checkpoint → seq 0 |
| 58 | Replay reads only the four filtered streams; `audit` and other order-stream alerts are skipped; uses `events_branch_stream` (`EXPLAIN QUERY PLAN`) |
| 59 | Live state equals replayed state after a mixed day (property, 50 seeds) |
| 60 | Missed fires: step 6 writes nothing; `HubStarted.missed_fires` = dry count; first tick dispatches `reason: 'missed'`; fired-before-outage lines not re-fired (§3 #3, F test 13) |
| 61 | Snapshot every 500 events and on SIGTERM; **keep 2** (v0.4, pre-G2 #37 closed, G2 #8); older versions deleted; `last_seq` and state read in the same `setImmediate` callback; one fresh snapshot after a boot that loaded no current-version snapshot (F §5.8, G2 #17); step 2 reads `LIMIT 2` and falls back to the second row when the newest is torn; the day-close checkpoint writer keeps 2 (G2 #13) |
| 62 | Tick `fires`: idle pass opens no transaction and runs no statement; a pass with work is one transaction with **0 reads plus the appends** (v0.4, G2 #10) |
| 63 | Tick isolation: a throw in `fires.intents` rolls back only the fires tick; 01d's tick still runs |
| 64 | Crash restart of 500 events ≤ 2 s (steps 2–3) |
| 65 | `slip_warning`: raised to the receiver (stub `placed_by`); step 1 escalates to managers at `escalate_ms`; accept → `ItemsReleased` with `alert_id`; decline → nothing; `apply` writes nothing (read-only view); answered by a non-receiver → `403 not_receiver` |
| 66 | `stations-live`: 0 statements; body matches `stationsLive`; *v0.4 (G2 #13):* `station_ids` with 51 ids or a non-string → `400 VALIDATION_FAILED` (F §6.7, one test per code) |
| 67 | `station_overload`: raised after red for `pressure_alert_ms`; deduped; closed below amber; *v0.4 (G2 #4):* while it stays red after the raise, no pass is due; after a restart the `reconcile` pass rebuilds `overload_open` and a station below amber is closed `done` |
| 68 | `set-station-capacity`: happy; `400`; `404 STATION_NOT_FOUND`; `403 outside_scope`; no-op; retransmit (D32); COMMIT failure leaves the live state (D45); **station session** for its own station with `lane_off` → `200`, `actor_id` null, the KDS `device_id`; for another station or with `reason: 'manager'` → `403 outside_scope` (v0.2, pre-G2 #17) |
| 69 | `set-station-pause`: happy; `400`; `404 STATION_NOT_FOUND`; `409 STATION_PAUSE_DISABLED` before `403 outside_scope` (C8); `403 outside_scope`; a station session → `403`; unpause always; retransmit; COMMIT failure (v0.2, pre-G2 #24, #25) |
| 70 | `onBranchConfigApplied`: one `EngineConfigApplied` only when the engine part changed; never throws on any valid config (fuzz over the V3 builder) |

### 10.3 Concurrency and races

| # | Case |
|---|---|
| 71 | A submit and the fires tick in the same 500 ms: the tick's `intents` re-select inside its transaction; no double fire |
| 72 | Slip `accept` answered after the last line went Done: `ItemsReleased` with `released` only; tick close is a no-op |
| 73 | Capacity change between `due` and `intents`: intents computed on the new state |
| 74 | Two submits claiming the last stock unit: second gets full cook time (`cook_fresh`) or refusal (`sold_out`) (E1 stock AC4) |

### 10.3a Added in v0.2 (pre-G2)

| # | Case |
|---|---|
| 76 | `fires_alerts` isolation: a slip candidate with no resolvable receiver, and one whose values fail the schema, are skipped and logged; the same pass's fires commit; a throwing `raiseMany` rolls back only `fires_alerts`; the alert follows on a later pass (one-tick lag) (#1) |
| 77 | *Changed in v0.4 (G2 #4):* `SlipWarned.alert_id` equals the id `raiseMany` returned and `AlertRaised.values.table_key` equals its key; its `AlertClosed` sets `slips[key].alert_id = null`; an `AlertClosed` of another alert leaves the state identical; re-raise only with `alert_id = null` and +threshold (#1) |
| 78 | Exit: an order stays 30 min after its last line is served; *Changed in v0.4 (G2 #3):* every reader treats it as gone from `last_served_at + 1 800 000` (`isOrderInEngine`), physical removal happens at the next **listed** event; an unrelated `audit` event and an `AlertSeen` past the deadline change nothing, so live = replay; a return inside the window re-opens it (also when the handler's `now` is inside and the batch's `recorded_at` a few ms past); after it → `409 ORDER_NOT_IN_ENGINE` (fixture of 02); an `OrderLinesAdded` for an absent order throws (#2) |
| 79 | Config catch-up: a hub with an applied config and no `EngineConfigApplied` writes one in the first `fires` pass; nothing when equal (#4) |
| 80 | `fix` return: `cook_ms_override` from the event; a config change of `adjust_time_ms` after the event does not change a replay; `max_carry_ms` from the line drives re-routing (#5, #6) |
| 81 | Deterministic ids: group ids `order_id:0…`; a split takes `next_group_index`; a load id `station_id:<earliest order_item_id>` before firing and the `FireDispatched.load_id` after; the id stays when its naming line is voided before the fire (v0.2.1); snapshot + replay = full replay (#7) |
| 82 | Day close: every open `slip_warning` closed `obsolete` in the first `fires_alerts` pass after `BusinessDayClosed` (#11); *v0.4 (G2 #23):* also when the hub restarts between the close and that pass (boot step 6 sets `day_closed`) |
| 83 | `station_plan`: catch-up body per station; one frame per changed station after a commit; a frame when a line enters Next, **sent from `due` with no transaction and no statement** when nothing else is due (v0.2.1), and from the after-commit hook when intents are due, never twice in one pass; none for an unchanged station; a station session sees only its station (#12) |
| 84 | Move to stock: `stockEffects(ItemMovedToStock)` → `StockReleased { reason: 'moved' }` + `StockAdded { reason: 'moved' }` per draw; none without a draw; `StockAdded` without `reason` still parses (#13) |
| 85 | `stock_version` after a snapshot boot equals a full-scan value, including `ItemMadeUnavailable` and the new stock events (#3) |
| 86 | Idle: over 60 s of an idle kitchen in which lines enter Next, neither `fires` nor `fires_alerts` opens a transaction (01d idle rule, no exception; #23, v0.2.1); *v0.4 (G2 #4):* also over 60 s of a kitchen with one raised slip and one raised overload that persist unchanged |
| 75 | **Return to kitchen (D28, §3.8a):** `fix` on a served from-stock line → one new immediate line, `cook_ms = adjust_time_ms`, no `StockReserved`, `mark: 'return'`, placed within others' slack (no deadline crosses); `remake` → `ItemReturned` exits the served line and the new line uses the normal cook time; with `returns_boost` the new line displaces and the displaced order slips; a return on a line not `served` is refused by 02 (fixture) |

### 10.3b Added in v0.4 (G2)

| # | Case |
|---|---|
| 87 | **`StockAdded` reserves for waiting lines (G2 #7):** three unfired `from_stock = false` lines drawing on one stock item, deadlines d1 < d2 < d3, a fourth already fired, a return line; `StockAdded` covering two lines → `stockEffects` gives `StockReserved` for the d1 and d2 lines only (deadline order; a line whose draws do not all fit is skipped and the next tried); folding them sets `from_stock`, `cook_ms = stock_cook_ms` and re-plans the station (the lines fire later, land on the same `T`); the fired line and the return line are untouched; replay = live |
| 88 | `stockEffects` per trigger (G2 #13): `ItemRemoved` → `StockReleased { removed }` per draw of the line; `ItemVoided { units }` → `voided` for those units only (01c §3.4.8); `BusinessDayClosed` → `day_closed` for every remaining reservation, none for an item with `reserved = 0` |
| 89 | Void / remove moves `T` earlier, never later (G2 #13): a void that frees the critical line gives `T' < T`; a void that would need a later `T` keeps `T`; `promise_ms` unchanged in both (D6, story edge case "void of an item in-flight") |
| 90 | Weights change re-weighs open orders (G2 #13, pre-G2 #22): after an `EngineConfigApplied` that raises `weight_delivery_pct`, the next re-plan orders an open delivery line before a dine-in line it followed before; the line's `weight_pct` copy is unchanged |
| 91 | Submit gap (G2 #13, pre-G2 #21): a line that fits at the handler's `t` but not at the batch's `recorded_at` is placed at its earliest fit; the next `fires_alerts` pass slips it (via `next_alert_due_at`) |
| 92 | `next_alert_due_at` (G2 #4), property over 50 seeds: whenever finite, `getAlertIntents(state, next_alert_due_at)` has a slip or resolved item and `getAlertIntents(state, next_alert_due_at − 1)` has none for the same key; equal live and replayed; `null` on an idle state |
| 93 | `fires_alerts` with a raised slip (G2 #4): the slip persists unchanged for 60 s → no pass is due, no transaction; it grows by another `slip_threshold_ms` while its alert is open → still not due; its group resolves → the next pass closes the alert `done` and the fold of its `AlertClosed` drops `slips[key]`; a resolved slip whose alert was already closed by `ReleaseItems` is dropped at resolution; a key skipped for a missing receiver is not retried every pass |
| 94 | Static (G2 #3): the set of event types with a case in `applyEvent` equals the union of `ENGINE_REPLAY_EVENTS`; any other type returns the same object (`Object.is`) |
| 95 | Config catch-up pass (G2 #22): with `configStale` and due fires, the first pass writes only `EngineConfigApplied`; the fires follow in the next pass, computed on the folded state |

### 10.4 Acceptance (story AC → test)

| Story AC | Tests |
|---|---|
| E4 ETA AC1–AC3 (prep + wait + cook; slot / batch wait; stock time until 0) | F 1–4, 10, 15; 39 |
| E4 ETA AC4 (shared queues, no default priority) | 25, 28, 90 — **changed by D3**: weights are config, default by order type (§4.5 A-12; v0.4, G2 #11: A9 is answered, no field input pending) |
| E4 ETA AC5 (recalc on every event) | 21, 45 — as bumped by D13 (§3 #13) |
| Hold-and-fire AC1–AC2a | F 2, 5–7; 17–19 |
| AC3 fire at latest start; AC6 (KDS countdown, 03b) | F 13; 60 |
| AC4 batch freshness | F 3, 9, 14; 44 |
| AC5 boost | 34 |
| AC7 nothing hard-coded | lint test (no item or station names in `packages/engine/src`) |
| Slip AC1 threshold | 35 — **changed by D11**: measured from the engine target, not the original promise (F-5; v0.4, G2 #11) |
| Slip AC2 (to the order taker) | 65 |
| Slip AC3 (escalation; dismiss) | 65 — **changed by D11**: the card answers "Send what's ready" / "Wait"; "Wait" (decline) stands for "customer informed" (v0.4, G2 #11) |
| Slip AC4 one per table | 36 |
| Slip AC5 tracking page | out of scope (E9, P2) |
| Overrun / cascade (D33, D42) | F 8, 11, 12 |
| Restart without re-fire (D24, D44) | F 13; 57, 59, 60 |
| Stock update re-plans (foundation D23; 01a S45 carried row) | 40, 87 (v0.4, G2 #7) |

### 10.5 Statement counts

Every hub path in §6 asserts its count: `fires` idle 0 (freeze-entry frames included, no transaction, v0.2.1), with work 0 reads; `fires_alerts` idle 0 (and 0 while a raised condition persists, v0.4), with work 2 + ≤ 1 + 01d bounds; boot step 2 = 2 (each `LIMIT 2`, v0.4), step 3 = 4 + 2 (v0.2), step 6 = 0; commands = 00 pipeline + 0 reads (state in memory); `stations-live` 0.

### 10.6 Simulator and CI performance gate (D22, D27)

`packages/engine/test/sim/` ports `docs/stories/03a-sim/replay_cost.py` and `tandoor_sim.py` to TypeScript on the real engine:
- **Generated day** (seed 7): 2 000 orders, 65 % in a ~5 h dinner window (~260 orders/h at peak), 25 % lunch, 10 % uniform over 18 h; stations tandoor slot 60 × 180 s, karahi slot 50 × 1 200 s, BBQ slot 30 × 900 s, degh batch 100 × 60 s (*v0.4, G2 #15:* inside 01a's capacity range 1–100; was 1 000), tawa slot 8 × 300 s; lines per order as the drill's `MENU`; target = max cook + 300 s; Start/Done tapped on time.
- **Asserts (CI, Vitest `perf` project):** re-plan per submit p99 ≤ 50 ms; lines re-placed per submit ≤ 250; full-day replay from a checkpoint ≤ 45 s; **snapshot write at design size ≤ 50 ms** (v0.4, pre-G2 #38 closed, G2 #14); events ≈ R6 (±20 %); live state = replayed state. An **overload day** (tandoor at 125 %) asserts the overload pass bound.
- **Policy report (not a gate):** % promises kept, max late, mean wait by order type, cold time, utilisation for FIFO / EDF / Waada Guard (D22); *Changed in v0.3:* the peak pieces-per-hour count (field A14, still to count at the visit) is a **simulator input only**; it does not block the spec or G2.

---

## §11. Build order

Each task is TDD (failing test first) and cites its sections. Batches of ~5; the simulator (task 18) is the gate before the hub tasks.

| # | Task | Files | Spec |
|---|---|---|---|
| 1 | Event schemas v1 (§4.2 table) and fixtures | `packages/events/src/events/{order,station,stock}/` | §4.2 |
| 2 | Error codes | `packages/domain/src/errors.ts` | §9 |
| 3 | `EngineState` v3, `ENGINE_STATE_VERSION = 3`, snapshot fixture test | `packages/engine/src/state.ts`, `version.ts` | §3.3; test 56 |
| 4 | Occupancy profile (`latestFit`, `earliestFit`, add, remove) | `profile.ts` | §3.3, D24 |
| 5 | F tests 1–15 on v3 | `test/foundation.test.ts` | F §4.7 |
| 6 | Lines, units, cook time; plan trigger at last listed line | `apply-event.ts`, `plan.ts` | §3.2, §3.5.1; 16–19, 43 |
| 7 | Hold-and-fire against the profile; target and promise; delivery | `plan.ts` | §3.5.1; 17, 31 |
| 8 | Re-plan passes, keep, freeze, prune; `T' = min(T, …)`; submit gap | `replan.ts` | §3.5.3; 20–23, 89, 91 (v0.4) |
| 8a | Return lines: `return_of` fold, `cook_ms_override`, no draw, expedite / boost placement (moved after task 8 in v0.2, pre-G2 #26) | `plan.ts`, `apply-event.ts` | §3.8a; tests 75, 80 |
| 8b | Exit predicate `isOrderInEngine`, removal in listed folds only, `ENGINE_REPLAY_EVENTS`, deterministic ids (v0.2, pre-G2 #2, #7; v0.4, G2 #3) | `apply-event.ts`, `replay-events.ts` | §3.3, §3.12; tests 78, 81, 94 |
| 9 | Policies FIFO / EDF; weights | `replan.ts` | §3.5.2–§3.5.4; 24, 25, 90 |
| 10 | Overload Λ search, `max_late_ms` | `overload.ts` | §3.5.6; 26, 27 |
| 11 | Routing, reserve, re-route | `route.ts` | §3.5.5; 28–30 |
| 12 | Stock reserve / release / consume, `stockEffects`; `StockAdded` reserve-and-re-plan (v0.4, G2 #7) | `stock.ts` | §3.7; 39–42, 87, 88 |
| 13 | Batch loads with copied cook times | `plan.ts` | F §4.7; 44 |
| 14 | Tick intents: fires, auto-fill, inferred, cascade, `nextDueAt` | `tick.ts` | §3.6; 32, 52, F 8, 12, 13 |
| 15 | Slip and `ItemsReleased`, `goesWith`, `planRelease`; `SlipRecord`, `AlertClosed` fold, `next_alert_due_at` (v0.4, G2 #4) | `slip.ts` | §3.8; 35–38, 77, 92 |
| 16 | Boost, capacity, lanes, pause, pressure, exit, READY, undo | `apply-event.ts`, `pressure.ts`, `view.ts` | §3.4, §3.9, §3.10; 34, 45–51 |
| 17 | `EngineConfigApplied` effects; checkpoint | `apply-event.ts`, `checkpoint.ts` | §3.11, §3.12; 53–55 |
| 18 | **Simulator + CI perf gate** (gate for tasks 19+) | `test/sim/` | §10.6 |
| 19 | Migration `0007_engine.sql` | hub migrations | §5.1 |
| 20 | Boot steps 2, 3, 6; replay filter; 00 H-1 fields (`clock`, `missedFires`; v0.4, G2 #6) | `engine-host/boot-steps.ts`, `lib/boot.ts` (H-1) | §3.12; 57, 58, 60, 64 |
| 21 | Snapshot and checkpoint writers (checkpoint body and `last_seq`, fresh snapshot after boot; v0.4, G2 #5, #17) | `engine-host/snapshots.ts` | §3.12; 55, 61 |
| 22 | Fires tick, config catch-up | `engine-host/fires-tick.ts` | §6.2, §3.11; 62, 63, 71, 73, 79, 95 |
| 22a | `fires_alerts` tick (v0.2, pre-G2 #1, #11; due from `next_alert_due_at`, overload host set, flags, v0.4 G2 #4, #23) | `engine-host/fires-alerts-tick.ts` | §6.2a; 76, 77, 82, 86, 93 |
| 22b | `station_plan` catch-up and frame (v0.2, pre-G2 #12) | `engine-host/station-plan.ts`, `packages/events/src/ws.ts` | §3.6.3; 83 |
| 23 | Kinds `slip_warning`, `station_overload` | `engine-host/kinds.ts` | §3.8, §3.10; 65, 67, 72 |
| 24 | Config hook | `engine-host/config-hook.ts` | §3.11; 70 |
| 25 | Commands capacity and pause | `commands/` | §6.6, §6.7; 68, 69 |
| 26 | Query and catch-up `stations-live`; audiences | `queries/`, `ws/` | §6.5, §6.4; 66 |
| 27 | Property test live = replay; race 74 | `apps/hub/test/engine/` | §10.2, §10.3; 59, 74 |
| 28 | Pilot-box manual check (perf targets §7.1) | `docs/plans/03a-manual-checks.md` | §7.1 |

Tasks 1–18 need no other module; tasks 19–26 need 01a v2.1 for real config (defaults stubbed, §4.4). Estimate: 28 tasks here, expanded to ~50 plan tasks (within the 60 budget; 03a-g0 §7 "Size").

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done

1. Every test in §10 passes; the §10.6 gate is green in CI.
2. §7.1 targets measured on the pilot mini PC (task 28).
3. Every §4.5 row approved and applied with "Changed by 03a" markers.
4. Pilot values entered at setup in the 01a pages (configuration, not spec; v0.3).
5. README rows R-1–R-6 applied (v0.4, G2 #12).

### 12.2 Endpoint checklist

| # | Item | Kind | Permission | Statements | Errors | Events |
|---|---|---|---|---|---|---|
| 6.2 | `fires` tick | tick | — | 0 | — | `FireDispatched`, `ItemStarted`, `ItemDone`, `ReservationsShifted`, `StockConsumed`, `EngineConfigApplied` (catch-up) |
| 6.2a | `fires_alerts` tick (v0.2) | tick | — | 0 idle and while a raised condition persists (v0.4); 2 + ≤ 1 + 01d | — | `SlipWarned` (with `alert_id`, v0.4), alert events |
| 6.3 | boot steps 2, 3, 6 | boot | — | 2, 4, 0 | boot stops | — |
| 6.4 | kinds + config hook + `station_plan` (v0.2) | registration, frame | — | 0 | — | `EngineConfigApplied`, `ItemsReleased` (apply) |
| 6.5 | `GET /queries/stations-live` | query | session | 0 | 400 | — |
| 6.6 | `set-station-capacity` | command (staff or own-station session) | `manage-stations` / `stationScoped` | pipeline | 400, 403, 404 | `StationCapacitySet` |
| 6.7 | `set-station-pause` | command | `manage-stations` | pipeline | 400, 403, 404, 409 | `StationPauseSet` |

### 12.3 Open questions — each with a **proposed** answer (needs approval)

From 03a-g0 §7:

| # | Question | Proposed answer |
|---|---|---|
| Q1 | Weighted EDF rule for capacity > 1 (D5) | Minimise the maximum weighted lateness by the Λ search of §3.5.6 (Lawler-optimal for one slot); ties by `order_item_id`. The simulator compares it with "weighted slack" before G2 |
| Q2 | A request raised from the tick (D11) | Works inside 01d as written: `named`, `needs_pin: 'never'`, no requester (no withdraw, no `request_result`, AD-72), no in-person answer; only the editorial row N-1 |
| Q3 | `promise_padding_ms` per order type or per branch | Per order type in `branch_engine_settings`, with a nullable station override (A-6, A-12); the shape is fixed now (R18) |
| Q4 | ETA preview vs submit | The preview returns `as_of_seq`; the submit response is authoritative; 02 shows "time updated" when they differ by ≥ 60 s |
| Q5 | Self-check D1–D23: owner module and config key | Done in §3.1; none left without both (D2, D17–D19, D22 have no key by nature) |
| Q6 | `station_overload` as an `info` kind | Yes, plain `info`; no 01d bump |
| Q7 | `ItemsReleased` vs `SlipWarned` + an answer event | `ItemsReleased` (one fact; also written by 02's table view); 03b's Ready-to-serve dedupe uses its event id |
| Q8 | Exit rule before 05 | §3 #11 as decided; `BillClosed` later, optional |
| Q9 | Size | 21 items (§6; v0.4, G2 #12), ~50 plan tasks; plan in batches with the simulator as the gate; re-estimate milestone A after the plan |

Raised by this draft (P-n, proposed):

| # | Proposal | Why |
|---|---|---|
| P-1 | A piece line holds `quantity` units; g / ml and pending-weight lines hold 1 | capacity is counted in pieces at a piece station (D14); the capacity itself is configuration (v0.3; "pending A1" removed in v0.4, G2 #11) |
| P-2 | Target and promise are carried in `OrderPlaced` | `recorded_at` is stamped after the handler's `now`; an engine-version replay must not move promises |
| P-3 | Alternates between slot stations only | batch programs are per station; the pilot need is the tandoor (D23) |
| P-4 | Stock releases are explicit events written by the trigger's writer via `stockEffects` | clients fold stock frames (01a §4.4); an implicit release would desync them |
| P-5 | Consume at `ItemStarted` | the portion leaves the pot at start; 01a left "the hand-over step" open |
| P-6 | Answer `accept` sends with default ticks; edited ticks only from 02's table view | `AnswerRequest` has no payload for ticks |
| P-7 | `red_since` lives in host memory; a restart restarts the 5 min; *v0.4 (G2 #4):* so does `overload_open`, rebuilt by the forced first pass after boot | pressure is not an event (D13 spirit); restarts are rare |
| P-8 | `EngineConfigApplied` puts station config into the log | `BranchConfigApplied` carries only a hash; replay must not read config |
| P-9 | 03a defines the engine fields of every event it folds; the writer may add fields before the pilot | extends §3 #4 to 02 / 03b / 04 events (03a is built first) |
| P-10 | `OrderLinesAdded` for additions to an open order | 01c envisages later child lines; a re-plan needs a trigger |
| Q10 | **Closed in v0.2.1 (developer):** the reading is kept: the `pause_enabled` setting (default off) plus a live `SetStationPause` | — |
| Q11 | **Closed in v0.2.1 (developer):** engine settings in 01b's branch settings endpoint (B-6), station engine fields, alternates and carry times in 01a's station resource, goes-with on the category and item PATCHes; only the points `POST` / `PATCH` are new, so 01a lands at **30**, inside the line; no README R-7 needed | — |
| Q12 | D28: a customer's own wrong order ("I said mutton") — `remake` free, or a void + new charged line (04 approval)? **still open (v0.3)**: the owner's answer to Q15a covered returns, not the charge for a customer's own wrong order | proposed: 02 offers only fix / remake (both free); a charged replacement is a void (04) plus a normal order, no third mode |

**Pre-G2 findings recorded, not applied as written (v0.2):**

| # | Why not applied as proposed |
|---|---|
| #10 | Not needed: the 30-minute exit window (#2) keeps the order in the state while a return or addition can arrive, so `OrderLinesAdded` needs no order fields; an exited order is refused `ORDER_NOT_IN_ENGINE`. |
| #21 | Applied as the review's second option (the rule weakened and the next tick slips the line), not by passing `recorded_at` into the handler: the append stamps `recorded_at` after the handler (`engine-host/append-events.ts:12`), and exposing it is a 00 change for a gap of milliseconds. |
| #31 | Applied in its narrow form: only `missedFires`; no `engine_events_replayed` field (an additive `HubStarted` field would need a schema version, D46); the engine's replay count is logged. |
| #37 | Applied as "keep 2" rather than "keep 1", so a torn newest row still leaves a usable one. |
| #38 | Applied as "deferred with `setImmediate`" (not the next tick pass), so the snapshot never waits for a tick and never shares a transaction with one. |
| H-2 | Not added: the config catch-up (#4) runs in the first `fires` pass, so no boot write is needed. |
| #7 load id | Of the two options given, `station_id + ':' + earliest order_item_id` was chosen: it exists before the load fires (re-plans need it); the first-`FireDispatched` form exists only after firing. |

**G2 findings (`03a_v0.3_g2_completeness.md`) applied differently from the proposal, or recorded (v0.4).** Every other finding #1–#28 is fixed as proposed at the edit marked "Changed in v0.4 (G2 #n)".

| # | Applied as / why |
|---|---|
| G2 #1 | Developer decision: instead of only a carried row, §4.5 gains 00 v1.7 rows **H-5** (`devices.point_id`) and **H-6** (`devices.lane_label`, the lane definition), joining 01e's bump; the pairing / binding UI and the ESP32 side are carried rows To 03b and To 01e; `capacityForLanes` takes `lane_count` as an input. Gives 03b, 01d's point target and 01e one owner and one definition. |
| G2 #3 | Applied with the developer's form: the exit is a predicate over listed events only, plus the static test. The proposal's "`OrderLinesAdded` with `inEngine = false` at its `recorded_at` throws" is narrowed to **an absent order throws**: a present order whose window ends inside the ms gap between the handler's `now` and the batch's `recorded_at` (§3.5.3) is re-opened, because 02 accepted it at `now`; throwing there would fail a replay on a legitimate log. |
| G2 #4 | Developer decision instead of the proposed host `closed` set and `last_estimate` filter: `EngineState.next_alert_due_at` (pure) drives `due`; `slips[key]` keeps `resolved_at` until its `AlertClosed` is folded. To match that close, `SlipWarned` carries `alert_id` again (reverses that part of pre-G2 #1: the tick calls `raiseMany` first, so the id exists when the draft is built) and `AlertClosed` returns to the `order` replay list. Overload stays in host memory (`overload_open`, `red_since`, P-7) because pressure is not an event, checked in memory by `due`. |
| G2 #7 | Developer decision, the reverse of the proposal: the v0.3 text was wrong and 01a's carried row ("`StockAdded` … triggers D23") is right, so **no 01a row A-20** is added; `StockAdded` reserves for waiting fresh lines and re-plans (§3.7), and foundation row F-19 states what "stock update" means. |
| G2 #15 | Of the two options, the override range is lowered to 01a's `capacity` range (1–100) and the simulator's batch station to 100; no 01a cap change. |
| G2 #21 | Of the two options, `unit_changed` is **dropped** (no path reaches it: every reservation is released `day_closed` in the close commit and a unit change waits for the next open, 01a S44); test 42 now asserts the empty result. |
| G2 #25 | Recorded instead of a migration: no backfill, because no tenant runs live before the pilot (R29) and the dev / pilot tenants are re-seeded with the 01b v1.5 release; if a pilot tenant already exists then, 01a's `0003` backfill pattern applies (B-2). |
| G2 #26 | Recorded: the index build is sized and placed (release in the maintenance hour, §5.1), not moved out of the migration. |
| G2 #27 | Kept where it is, with the reason stated at A-12 (02's setting, placed so one 01a bump carries every timing setting, 03a-g0 §5). |

### 12.4 Carried rows "To 03a" — where each is addressed

| README row | Addressed in |
|---|---|
| 00 owner review (drop closed orders; day-close checkpoint; size for 90 s) | §3.3 exit (§3 #11), §3.12 checkpoint (D26), §7.1 |
| 01a S14 / S15 / §4.4 (stock shape, `canServeFromStock`, unit change at day open, `StockSet` below reserved, `StockAdded` triggers D23, `sold_out`, replace step 3, config reaction) | §2.4, §3.7, §3.11, §3.12, A-14–A-16. *v0.4:* `StockAdded` → reserve for waiting lines and re-plan (§3.7, test 87, G2 #7); unit change at day open → nothing to re-plan, every reservation is released `day_closed` the night before (§3.7, G2 #21) |
| R6 sizing (75k/day, 45k replayed) | §3.12 filter, §7.1, §10.6 |
| 01c §4.4 (deal parts, option children, `deal` never fired, reserve per draw, weighed lines, copied batch cook times) | §3.2, §3.7; tests 19, 39, 43, 44 |
| 01d §4.3 (filter + index, `registerTick`, `raiseMany(tickCtx)`, no catch-all audience; Ready-to-serve kind) | §3.12, §6.2, §6.4; Ready to serve moved to 03b (§3 #6) |

### 12.5 Deferred until needed

Learned cook times (E4 P2); the customer tracking page (E9); multi-station chains (P2+); alternates between batch stations; persisted pressure history (07 recomputes); a "load snapshot" field.

### 12.6 Hostile self-review (author, v0.1; refreshed in v0.4, G2 #28)

*Refreshed for v0.2–v0.4 (G2 #28), the G2 findings as input:*

- **Two ticks (v0.2):** `fires` and `fires_alerts` each own a transaction; a throw in one never rolls back the other (tests 63, 76). Hole found by G2 and fixed: `fires_alerts` was due every pass while a raised condition persisted (G2 #4) → `next_alert_due_at` and the overload host set; resolved slips were never closed `done` → `resolved_at` kept until `AlertClosed`. Remaining risk: `next_alert_due_at` must agree with `getAlertIntents` exactly, or a pass is due with nothing to write; one `slipCrossing` function feeds both and test 92 checks it.
- **Exit window (v0.2):** live ≠ replay hole (an unlisted event dropped the order live, G2 #3) → pure predicate, removal only in listed folds, static test 94. The ms gap at the window edge is resolved by presence, not by the predicate (§12.3 G2 #3).
- **Checkpoint:** the missing `business_day` and the mid-commit `last_seq` (G2 #5) would have failed a night boot or folded `day_closed` releases twice → body and `last_seq` fixed, test 55.
- **Station-plan frames (v0.2.1):** frames from `due` are a send of committed state, no transaction; audience stated (G2 #19); never twice per pass (test 83).
- **Stock:** `StockAdded` now writes `StockReserved` (G2 #7); the writer appends them in the same transaction from `stockEffects`, so clients folding stock frames stay right (P-4); a fold below 0 still throws.
- **Contracts with other specs:** 00 H-1 (`clock`), H-5, H-6; 01b B-8 (sync bound 32); foundation F-19; all in §4.5. The `AlertClosed` read is a read of an unchanged 01d event, not a 01d change.
- **Over-engineering check (v0.4):** `next_alert_due_at` is one number recomputed per fold, justified by 01d's idle rule (no transaction while nothing changes); `unit_changed` removed as unreachable (G2 #21); nothing else added.

*v0.1 review, kept:*

- **Races:** the tick re-selects inside its own transaction (01d race rule); the plan is computed on the same state in the submit's transaction; boosts and capacity changes re-plan in the reducer; tests 71–74.
- **Idempotency:** commands via `processed_commands`; the tick is idempotent by state (`fired_at`, `slips`); slip raises dedupe on `(kind, slip:<table_key>)`.
- **Determinism gaps found and fixed:** config read during replay (→ `EngineConfigApplied`, P-8); promise recomputed on replay (→ in `OrderPlaced`, P-2); freeze against a clock (→ `recorded_at`, D13); pressure timer (host memory, stated P-7).
- **Indexes / N+1:** replay index added; tick resolves all receivers with one `tableOwners` call and all alerts with one `raiseMany` / `closeMany`.
- **Contradictions with the foundation:** every override is a §4.5 F row (F-1–F-19; v0.4, G2 #12).
- **Over-engineering check:** checkpoint table and index justified (§5.1); no re-plan events, no cache, no projection.
- **Open risk:** the 50 ms p99 is an estimate from a Python drill (03a-g0 §6b); the CI gate (task 18) runs before any hub work, so a miss changes the algorithm before the host is built.
