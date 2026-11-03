# 03a Timing Engine (package + hub host) — Spec v0.1.1 (DRAFT)

| | |
|---|---|
| Status | **v0.1.1 DRAFT** (2026-11-03): v0.1 + D28 return to kitchen (§3.8a; owner answers 2026-11-03), no other change. **v0.1 DRAFT** (2026-11-02). Not reviewed. **G2 does not run** until every `[owner — pending field visit]` marker (§3.13) is answered at the Lake City visit (`docs/stories/field-visit-03a-02-05.md` §A; lesson 1, field first). §4.5 is **Proposed — needs approval**. |
| Source | `docs/stories/03a-g0.md` (G0 + G1: D1–D28, §3 contradictions #1–#13, §5 spec changes, §6 / §6b drills, §7 open questions). Each rule below cites its D-id or `§3 #n` of that file. Rules this draft adds where 03a-g0 is silent are marked **P-n (proposed by this draft)** and listed in §12.3. |

## §1. Header

| | |
|---|---|
| Module | 03a Timing Engine — `@pos/engine` (pure package) and the hub engine host (R4) |
| Version | v0.1.1 |
| Depends on | Foundation v1.8 (v1.9 proposed, §4.5), 00 v1.6.1, 01a v2.0.1 (**v2.1 proposed, §4.5 — blocking**: points, carry times, alternates, knobs), 01b v1.4.1 (v1.5 proposed), 01c v1.1, 01d v1.1 |
| Inherits | Shared Standards from Foundation v1.8 (§6), not redefined |
| Stories | E4 "ETA calculation", "Hold-and-fire dispatch", "Slip warning" (P1); engine side of E3 (fire, hold at pass) and E1 stock AC4 (first submit wins); README carried rows "To 03a" (00 owner review; 01a S14/S15/§4.4; R6 sizing; 01c §4.4; 01d §4.3) |
| Learned cook times | E4 P2 — out of scope |

**In scope (D1: nothing on the G1 list is deferred, owner 2026-11-02):** `EngineState` v3; `applyEvent`, `buildEngineState`, `planOrder` / `calculateETA`, `getTickIntents`; slot and batch placement; hold-and-fire; the three station policies (Waada Guard, EDF, FIFO) and item knobs (D3–D6); routing across stations (D8–D10); re-plan on every submit (D13, D24, D25); freeze window and auto-fill (D15, D16); overrun cascade, hold at pass, inferred completion (D33, D42, D60); boost (D4); stock reserve, release, consume (01a, 01c carried rows); split send (`ItemsReleased`, D11, D12); live capacity and lanes (D37, §3 #5); station pause (D21); station pressure and the `station_overload` kind (D19, D20); the `slip_warning` named request kind (D11, §3 #7); return to kitchen as a new expedited line (D28, §3.8a). Hub host: the reducer, boot steps 2, 3 and 6, snapshots and the day-close checkpoint (D26), the replay filter and index (§3 #2), missed fires on the first tick (§3 #3), `registerTick('fires')`, the `onBranchConfigApplied` reaction, the commands `SetStationCapacity` and `SetStationPause`, the query `stations-live`; the CI performance test (D27).

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
| D1 | Nothing deferred; cascade, overrun, hold at pass, boost, live capacity, slip, settings all pilot; `two_tap` default | §1, §3.6 | 03a | `stations.completion_mode` |
| D2 | 03a = package + host; Ready to serve/Handover → 03b; lock release, estimated Served → 02 | §1, §4.3 | — | — |
| D3 | Policy per station (`waada_guard` default, `edf`, `fifo`); item knobs; order-type weights incl. `follow_up`; delivery targets the pickup time | §3.5 | 03a | `stations.policy`; `menu_items.{weight_pct, max_early_ms, max_carry_ms, max_late_ms}`; `branch_engine_settings.weight_*_pct` |
| D4 | Waada Guard: the promise never breaks; boost is the one promise-breaker | §3.5.4, §3.9 | 03a | — |
| D5 | Overload: weighted lateness shared evenly | §3.5.6 | 03a | `menu_items.max_late_ms` |
| D6 | `promise_padding_ms` on the promise only; `min_slack_keep_ms` | §3.5.1, §3.5.4 | 03a | `branch_engine_settings.promise_padding_*_ms`, `stations.promise_padding_ms`, `stations.min_slack_keep_ms` |
| D7 | `follow_up` flag set by 02; engine sees only its weight | §3.5.2 | 02 sets, 03a weighs | `branch_engine_settings.weight_follow_up_pct` |
| D8 | Route to the earliest arrival at the point; `min_gain_ms`; allowed stations per order type; `reserve_units` | §3.5.5 | 03a | `station_alternates`, `carry_times`, `stations.reserve_units`, `branch_engine_settings.min_gain_ms` |
| D9 | Ties → home station | §3.5.5 | 03a | `station_alternates.home_for_order_types` |
| D10 | Only hidden ("Later") lines may change station | §3.5.5 | 03a | — |
| D11 | Slip as a 01d `named` request to the table's owner; `send` → `ItemsReleased`; threshold from the engine target | §3.8 | 03a kind, 02 table-view path | `branch_engine_settings.{slip_threshold_ms, slip_escalate_ms}` |
| D12 | "Goes with" links pre-tick the Send card; ticked = `expedite` | §3.8 | 01a data, 03a rule, 02 UI | `goes_with_links` |
| D13 | Re-plan on every submit, no events for it, promise never moves | §3.5.3 | 03a | — |
| D14 | Tandoor is a slot station; batch = start and end together | §3.5 | 01a data | `stations.station_type` |
| D15 | Freeze window | §3.5.3 | 03a | `stations.freeze_ms` |
| D16 | Chef screen Now / Next / Later; auto-fill; Give me more; Undo 30 s | §3.6.2, §4.3 To 03b | 03a engine, 03b screen | `menu_items.max_early_ms` |
| D17 | Append at the bottom; never reorder what is visible; human-triggered jumps marked | §3.4, §4.3 To 03b | 03b | — |
| D18 | Start / Done per line | §3.2 | 03b | — |
| D19 | Engine shows and tells; never stops a station by itself | §3.10 | 03a | — |
| D20 | Pressure and `station_overload` | §3.10 | 03a | `stations.pressure_*` |
| D21 | Station pause, setting default off | §3.10 | 03a | `stations.pause_enabled` |
| D22 | Simulator before §10 tests; property tests on the same harness | §10.6 | 03a | — |
| D23 | Lake City: all stations adjacent; both layouts supported | §3.5.5, §3.13 | — | `carry_times` (0) |
| D24 | Occupancy profile is the station timeline | §3.3 | 03a | — |
| D25 | Pruned re-plan; p99 ≤ 50 ms per submit | §3.5.3, §7.1 | 03a | — |
| D26 | Crash restart ≤ 500 events; full replay from the day-close checkpoint only | §3.12 | 03a | — |
| D27 | Simulator day as the CI performance gate | §10.6 | 03a | — |
| D28 | Return to kitchen: fix or remake = a new line at the expedite weight; `fix` cooks for `adjust_time_ms` with no stock draw; `returns_boost` default off | §3.8a, §4.3 To 02 / 03b / 04 | 02 button, 04 bill, 03b marker, 03a line | `menu_items.adjust_time_ms`, `branch_engine_settings.returns_boost` |

### 3.2 Words, lines and units

- **Line** = one `ItemAdded` with `station_id` not null and `line_kind ≠ 'deal'` (01c §3.4.7: a `deal` line is never fired, reserved or planned; deal parts and option children are lines with their own `serve_mode`, 01c §4.4).
- **Units** of a line = `quantity` when `sale_unit = 'piece'`; `1` for a g / ml line; `1` while a weight is pending (`quantity` null, 01c V18: fired normally, cook time is the item's). Units count against station capacity: "T5 Roti ×4" holds 4 tandoor slots for one Start and one Done tap (D18). **P-1** `[owner — pending field visit A1: "how many things cook at once" per station]`.
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
  groups: Record<GroupId, { target_land_ms: number; line_ids: OrderItemId[] }>;
}

interface EngineLine {
  order_item_id: string; order_id: string; group_id: string; serve_mode: 'sync' | 'immediate';
  station_id: string; alternates: Array<{ station_id: string; carry_ms: number; home: boolean }>;
  point_id: string | null; carry_ms: number; units: number; prep_ms: number;
  cook_ms: number; full_cook_ms: number; from_stock: boolean; program_id: string | null;
  weight_pct: number; max_early_ms: number; max_late_ms: number | null;
  stage: 'added' | 'cooking' | 'done' | 'served' | 'removed' | 'voided';
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
- **Exit (§3 #11):** an order and its lines leave the state when every line is `served`, `voided` or `removed`, or at `BusinessDayClosed` (which also clears `slips`). 05's `BillClosed` becomes a third exit later (no requirement now). Reservations are released by the stock events of §3.7, never implicitly.

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
- **Hold at pass (F §4.7, D1):** a `done` sync line whose group has a line not yet `done` is shown HOLD by 03b from `groupReadiness` (§6.1).

### 3.5 Planning

#### 3.5.1 Target and promise at submit (D3, D6)

`planOrder(state, proposed, t)` (§6.1) runs inside 02's `SubmitOrder` transaction with the live state and `t = clock.branchNow()`:

1. **Orderable check:** any line routed only to a paused station → `409 STATION_PAUSED` (D21, §9). Stock first-submit-wins as §3.7.
2. **Immediate lines (D36):** each placed at `earliestFit` on its best station (§3.5.5) against the station's current profile; its target = its land time; tentatively added to the profile.
3. **Sync group:** the F §4.7 hold-and-fire full-pass loop (D16, D35, D36, D49), run against **the profile after pass 1 of §3.5.3** (older lines re-placed within their slack) plus the tentative immediate intervals; each sync line's station interval ends at `T − carry`. Delivery (D3): `T = max(pickup_at_ms, loop result)` when 02 sets a pickup time.
4. **Promise:** `P = T + padding`, `padding = stations[...]?.promise_padding_ms ?? settings.promise_padding_<order_type>_ms` (max over the group's stations) (D6; per-order-type shape, §12.3 Q3). FIFO and EDF stations use padding 0 for their lines (D3).
5. `T` and `P` (per group, and per immediate line) are **written into `OrderPlaced`** (§4.2). `applyEvent` never recomputes them, so replay and engine-version full replays keep every promise (**P-2**).

The submit response shows `P`; the engine works to `T`. Slack is measured from `T`, so padding is never consumed by other orders (D6).

#### 3.5.2 Weights (D3, D5, D7)

`w(L) = weight_pct(L) × (follow_up ? weight_follow_up_pct : weight_<order_type>_pct) / 100` (percent; 100 = 1.0). EDF stations use `w = 100` for every line (D3). `[owner — pending field visit A9 (who waits at the peak) and B18 (follow-up weight); proposed defaults: dine_in 100, takeaway 200, delivery 200, parking 200, follow_up 300 (03a-g0 §6 drill values)]`.

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
- **Triggers (D13):** the last listed `ItemAdded` of an `OrderPlaced` / `OrderLinesAdded` (stations the order uses); `ItemRemoved`, `ItemVoided`, `ItemMovedToStock` (that station; the group's `T` may move earlier, never later: `T' = min(T, loop result)`); `OrderBoosted` (§3.9); `StockReleased { reason: 'recount' | 'unit_changed' }` (the line switches to full cook time); `StationCapacitySet`, `EngineConfigApplied` changing capacity (whole station, frozen lines included as fixed); `ItemsReleased` (§3.8). **No event is written for a re-plan** (D13, D44): it is a pure function of `(state, event, recorded_at)`; R6's ≈ 45k events/day stand. `ReservationsShifted` stays tick-only (overrun, late start).
- **FIFO stations (D3):** no hold, no re-plan of older lines: each new line is placed at `earliestFit(t)` in submit order; its target is that land time.
- A re-plan that leaves a line late (only after a disturbance: capacity drop, overrun, boost, recount) goes to §3.5.6. **At submit no line is late by construction** (`T` is computed so it fits); a full kitchen shows as a later promise and a red pressure band (D20), not as lateness.

#### 3.5.4 Waada Guard under normal load (D4)

No line is placed past `d(L)` except by boost (§3.9) or overload (§3.5.6). Within slack, ties are broken by `w × waiting` (pass 1 order, auto-fill §3.6.2). The simulator (§10.6) compares the three policies on % promises kept, max late, mean wait by order type, cold time and utilisation (D22).

#### 3.5.5 Routing (D8, D9, D10, D23)

- A line may go to its routed (home) station or an **alternate** (01a v2.1 `station_alternates`, slot stations only — **P-3**) that allows the order type, whose `carry_ms(station → line's point) ≤ max_carry_ms(L)`, and that is not paused.
- **Immediate line:** arrival = land at the station + carry; choose the minimum arrival; if it beats the home station by less than `min_gain_ms`, use the home station (D9). The home station for an order type = the alternate whose `home_for_order_types` lists it, else the routed station.
- **Sync line:** at candidate `T`, it fits if it fits at any allowed station with interval ending at `T − carry`; preference: home, then lowest carry, then `station_id`. `T` advances by the smallest advance over all allowed stations.
- **Reserve (D8):** `reserve_units` of a station are usable only by its home order types; others see `effective capacity − reserve_units`. Default 0.
- **Re-routing (D10):** only hidden lines may change station in a re-plan; a frozen or fired line belongs to its station; on station Off the assembler reassigns those by hand (K8, 03b).
- Lake City (D23): every carry is 0, so routing reduces to "wherever it is ready first"; `[owner — pending field visit A4 (tandoor split) and A13 (carry times); proposed default: no alternates, carry 0]`.

#### 3.5.6 Overload — weighted lateness (D5)

When a re-plan leaves a late set: re-place **all** hidden lines of the station with extended deadlines `d_Λ(L) = d(L) + min(Λ × 100 / w(L), max_late_ms(L) ?? ∞)` (EDF order on `d_Λ`, `latestFit(…, hi = d_Λ)`, keep not applied), for the smallest `Λ` (multiples of `cascade_step_ms`, exponential then binary search, ≤ 16 probes) at which all fit. A weight-2 line carries half the lateness (D5). A line held at its `max_late_ms` cap is not shifted further; if it still cannot fit it is placed at `earliestFit` after the others (a reporting cap, never a refusal, D3) and the station raises `station_overload` (§3.10). Optimal for one slot (Lawler), heuristic for capacity > 1 — the simulator decides (D5, §12.3 Q1).

### 3.6 The fires tick (§3 #3, D44, D60, D42, D16)

#### 3.6.1 Intents of one pass (`getTickIntents(state, now)`, pure)

1. **Scheduled fires:** every unfired line (or batch load) with `fire_ms ≤ now` → `FireDispatched { reason: 'scheduled' }`, grouped per station and load. A batch load pulls in compatible unfired lines whose target lies within the station's freshness window, capped per line by `max_early_ms` (F §4.7 D14/D17; D3 "batch: caps freshness").
2. **Auto-fill (D16):** for each slot station with idle units now (after 1.), fire from frozen-then-hidden lines with `now ≥ d(L) − max_early_ms(L)` whose whole cook interval from `now` fits: Waada Guard — lines with slack ≤ keep first (EDF), then max `w × waiting`; EDF — by `d`; FIFO — not used (FIFO fires at once). `FireDispatched { reason: 'early_fill' }`.
3. **Inferred completion (F §4.7 D60):** `single_tap` → `ItemStarted { source: 'inferred' }` with each fire; `auto_done` → `ItemDone { source: 'inferred' }` at `started_at + prep + cook` unless tapped.
4. **Cascade (F §4.7 D42):** an overrunning COOKING line pushes later unstarted reservations → one `ReservationsShifted { cause: 'overrun' }` per station, quantised to `cascade_step_ms`.
5. **Slip candidates (§3.8):** per table key, `SlipWarned` + the `slip_warning` raise.
6. **Overload (§3.10):** `station_overload` raises and closes; slip alerts whose groups resolved are closed.

All intents of one pass are written in **one** transaction (D44), the fires tick's own (01d §3.5). `due(db, state, now)` is pure: `now ≥ state.next_due` (the minimum of the earliest unfired `fire_ms`, the earliest auto-fill eligibility, the earliest inferred Done, the earliest cascade step, the earliest slip time) or `now ≥ host.next_pressure_check` (every 15 s). An idle kitchen opens no transaction (01d §4.3 To 03a).

#### 3.6.2 Missed fires (§3 #3)

Boot writes nothing for missed fires. Step 6 (03a) computes a dry `getTickIntents(state, branchNow)` and hands the `FireDispatched` line count to step 8 as `missed_fires` (00 `HubStarted`, needs the additive 00 row H-1, §4.5). The first tick (≤ 500 ms after the server opens) dispatches them with `reason: 'missed'` for lines with `fire_ms` before the boot. Lines fired before the outage are not fired again (F §4.7 D44); their tickets are reprints (03b).

### 3.7 Stock (01a S14, S41, S44, S45; 01c §3.5, §4.4; carried rows)

- **Reserve at submit (F §5.9 step 5 as changed, §4.5 F-9):** `reserveStock(state, lines, dayStart)` per line, per draw: the line is served from stock only when **every** draw passes `canServeFromStock(availableStock(…), line quantity, quantity_per_sale_unit)` after the units already claimed in this command (01c §3.5.2); then one `StockReserved { stock_item_id, order_item_id, quantity }` per draw (`quantity` = draw quantity on the line). Otherwise: `cook_fresh` → full cook time; `sold_out` at available 0 → **refused** (02's code; first submit wins, E1 stock AC4; the [ASSUMPTION] of 01a S32, adopted). `OrderPlaced.lines[].from_stock` records the outcome.
- **Release (explicit events, P-4):** `StockReleased { stock_item_id, order_item_id, quantity, reason }` with `reason ∈ removed, voided, moved_to_stock, recount, unit_changed, day_closed`. The writer of the triggering event appends them, from one pure helper `stockEffects(state, draft)` (§6.1): 02 (`ItemRemoved`), 04 (`ItemVoided`, `ItemMovedToStock`), 01a's stock commands (`StockSet` with `on_hand < reserved`: release the `reserved − on_hand` most recently reserved units, whose lines re-plan at full cook time; S14 v0.6), `OpenBusinessDay` (a stock unit changed while `reserved > 0`, S44), and the day-close writer (`day_closed`, every remaining reservation). Explicit events keep the clients' stock part right (01a §4.4 clients fold stock frames with `applyEvent`).
- **Consume (P-5):** a from-stock line's units leave `on_hand` and `reserved` at **`ItemStarted`** (the portion is taken from the pot): `StockConsumed { stock_item_id, order_item_id, quantity }` appended with the start (03b's `StartItem`, the tick's inferred start). This is 01a's "hand-over step".
- `StockAdded` adds to `on_hand` (S45) and triggers no re-plan; `on_hand ≥ 0` and `reserved ≥ 0` always (a fold that would go below 0 throws: a bug, caught by tests).
- Stock stays branch-level; zone stock is 02's (03a-g0 §2).

### 3.8 Slip warning and split send (D11, D12, §3 #7, F §4.7 D44)

- **Estimated land time** per sync group: F §4.7 formulas (COOKING: started + prep + cook; ADDED past its fire: `now + prep + cook`; on schedule: the planned land). The group's estimate is its maximum.
- **Trigger:** `estimate > T + slip_threshold_ms` (D11: from the engine target, so the order taker hears before the padded promise is blown; the card shows minutes against the **promise**). `[owner — pending field visit A5, A8; proposed default slip_threshold_ms = 300 000]`.
- **One per table (§3 #7):** the orders of one table key are grouped in one `SlipWarned { table_key, order_ids, estimated_land_ms, target_land_ms, promise_ms, alert_id }` and one alert, dedupe key `slip:<table_key>`. **Re-raise (F §4.7 D44):** only when the estimate has grown by another `slip_threshold_ms` since `slips[key].last_estimate` **and** the previous alert is closed or answered.
- **The `slip_warning` kind** (03a registers, 01d §3.5): `family: 'action'`, `subject: 'order'` (the oldest order of the group), `request: { answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: 'never', apply }` with labels "Send what's ready" / "Wait" (01d: accept kinds use the kind's labels); no requester (tick-raised: `raised_device_id = 'hub'`, no in-person answer, no withdraw, no `request_result`, 01d AD-72); `receiver_staff_id` = the table's owner from 02's `tableOwners` (§4.1; **until 02 lands: the order's `placed_by`**), target `{ kind: 'person', staff_id: receiver }`. Steps: 0 → `[{ raised_target, answerer }]`; 1 (`escalation: true`, at `values.escalate_ms` = `slip_escalate_ms`) → `[{ raised_target, answerer }, { managers, informed }]` (E4-SLIP AC3). `closes_on: 'owner'`, `lead_fallback: false`, `expires_at_day_close: true`, `values_schema { table_key, order_ids, escalate_ms }`, `details_schema { minutes_late, lines: [{ name, quantity, state }] }` (01d §3.12).
- **`apply` on accept** (read-only, 01d §3.5): returns one `ItemsReleased { order_id, alert_id, released, expedite }` per order of the group with work: `released` = the group's `done` sync lines (go now, no hold); `expedite` = remaining lines **pre-ticked** by "goes with" links of what is released (D12; none configured → none). `decline` returns `[]`. Ticks are edited only from 02's table view (`ReleaseItems`, which uses `planRelease`, §6.1, and closes the alert), because `AnswerRequest` carries no ticks (**P-6**).
- **`applyEvent(ItemsReleased)`:** released lines leave their group; expedite lines become immediate (`mark: 'expedite'`, weight = `follow_up` weight, D12); unticked lines stay sync with each other at their old `T`; re-plan.
- **Closing:** the tick closes a slip alert `done` (via `alerts.closeMany`) when every line of its group is done or exited; close of a closed alert is a no-op (01d). `slips[key]` is dropped on `RequestAnswered` / `AlertClosed` for its `alert_id` (order stream, in the replay filter, §3.12) and at day close.
- Permission: none beyond being the named receiver (01d `named`); 02's table-view path uses the table's `mark-served` holder (D11).

### 3.8a Return to kitchen (D28; owner 2026-11-03)

A Served line may be sent back with **one of two choices**: `fix` (taste: "more spicy", "not cooked enough" — the same plate goes back) or `remake` (a kitchen fault — a new plate, on the house). Both are free in the pilot; no reason list and no charge config (added only if an owner asks, R18). The one rule that matters to the engine: **a return is a ticket.** A plate fixed off-ticket is invisible, holds a slot the engine does not know about, and makes every other ETA on that station wrong — the chef's own objection.

- 02's `ReturnToKitchen { order_item_id, mode }` (permission: the table's `mark-served` holder, D11) appends an `OrderLinesAdded` with **one new line** that copies the served line's D25 fields and sets `return_of: { order_item_id, mode }`, plus 04's `ItemReturned` when `mode = 'remake'` (§4.3 To 04). The engine folds the new line as any line: `serve_mode: 'immediate'`, `mark: 'return'`, weight = the `follow_up` weight (D7, D12), `from_stock: false`, **no stock draw** (no `StockReserved`), station = the served line's station (alternates allowed, D8).
- **`fix`:** `cook_ms = item.adjust_time_ms` (01a v2.1 A-11, default 180 000); the served line is unchanged (bill, stage). **`remake`:** `cook_ms` = the line's normal cook time; the served line goes `returned` (exit as `voided` for the engine, §3.3) when `ItemReturned` is folded.
- **Placement:** expedite = `earliestFit` within other lines' slack and `min_slack_keep_ms`, never past their deadlines (D4). With `branch_engine_settings.returns_boost = true` (default false) the new line is placed as a boost (§3.9) instead and may push others.
- **Chef screen:** the line shows at the top of Now / Next with a red RETURN marker, the mode and the old ticket's reference (`return_of.order_item_id`), D17; Start / Done as usual (D18), so the slot it uses is in the profile.
- **Served, readiness, alerts:** the new line is its own group (immediate); 03b's Ready to serve and the waiter alert follow as for any line; it never re-opens the old group's slip.
- Replay: nothing new — `OrderLinesAdded` and `ItemReturned` are already on the `order` stream list (§3.12).

### 3.9 Boost (D4; F §4.7 "Boost")

`OrderBoosted { order_id }` (02 writes, permission `boost-order`): the order's hidden and frozen lines are re-placed first at `earliestFit(t)` (as one group: new `T_b` = the hold-and-fire loop against fired lines only, marked `boost`); then pass 1 re-places the other lines; lines pushed past their deadline go through §3.5.6 and get slip warnings on the next tick. The boosted order's promise stays; its `T` becomes `T_b`. Boost is the only rule that may push another order past its target (D4). `[owner — pending field visit A10: who may boost, how often; proposed: `boost-order` default Owner, Manager]`.

### 3.10 Capacity, lanes, pause, pressure (D19–D21, D37, §3 #5)

- **Live capacity (D37):** `SetStationCapacity` (§6.3) sets `capacity_override`; the station re-plans (§3.5.3, frozen lines fixed) and slips follow on the next tick.
- **Lanes (§3 #5, K7/K8):** capacity is stoves (K7). A lane Off (03b) calls `SetStationCapacity` with `capacityForLanes(station, lanes_on)` = `lane_units = null` → unchanged; else `max(1, min(capacity, lanes_on × lane_units))`. `[owner — pending field visit A2: lane = stoves or chefs; proposed default lane_units = null (a chef leaving does not change capacity)]`.
- **Pause (D21):** a station with `pause_enabled` (01a v2.1, default false) may be paused live by `SetStationPause`; while paused new orders for it are refused `409 STATION_PAUSED`; open lines continue. `pause_enabled = false` → `409 STATION_PAUSE_DISABLED` (§12.3 Q10 reading).
- **Pressure (D20):** `pressure(S, now)` = booked unit-ms in `[now, now + pressure_window_ms)` ÷ (effective capacity × window), in basis points; green < `pressure_amber_bp` ≤ amber ≤ `pressure_red_bp` < red. Computed from the profile, never stored, so 07 can recompute it from the log (roadmap S4).
- **`station_overload` kind** (`info`, subject `station` / station_id, dedupe `station_overload:<station_id>`, step 0 → `managers` recipient, `closes_on: 'owner'`, `lead_fallback: false`, `expires_at_day_close: true`, `values { station_id, pressure_bp, waiting }`, card "Tandoor 125 % · 14 orders waiting"): raised by the tick when a station has been red for `pressure_alert_ms` (host memory `red_since`, reset on restart — accepted, P-7) or when a line reaches its `max_late_ms` cap (§3.5.6); closed `done` when the station is below amber at a check. Nothing stops a station by itself (D19).

### 3.11 Config reaction (`onBranchConfigApplied`, 01a carried row)

The hook computes `E(next)` = the engine-relevant part of the snapshot (per station: type, capacity, completion mode, policy, freeze, keep, padding, pressure fields, pause_enabled, lane_units, reserve_units, alternates, carry times, programs with cook times, archived; the branch engine settings) and, when `canonicalJson(E(next)) ≠ canonicalJson(state.config)`, appends one `EngineConfigApplied` in the same transaction. Every station is in the log, so replay never reads config (**P-8**). Effects in `applyEvent`:

| Change | Effect |
|---|---|
| `capacity` | re-plan the station (D37) |
| `station_type` (01a allows it only with no routes) | open lines keep their placement as fixed input; new lines follow the new type |
| program `cook_time_ms`, item knobs, padding | new orders only (open lines keep their D25 copies) |
| station archived | open lines complete normally (01a S22, 03b warns); no new lines can route there |
| policy, freeze, keep, pressure fields, alternates, carry | from the next re-plan / tick |

The hook accepts every valid config and never throws on data (S43); a new station appears with an empty profile.

### 3.12 Replay, snapshots, checkpoint, boot (D26, §3 #2, F §5.8)

- **Replay filter (§3 #2):** one statement per stream, each `WHERE branch_id = ? AND stream_type = ? AND seq > ? AND event_type IN (<list>) ORDER BY seq`, served by the new index `events_branch_stream (branch_id, stream_type, seq)`, merged by `seq` in memory (4 statements). Lists: `order` — `OrderPlaced`, `OrderLinesAdded`, `ItemAdded`, `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ItemServed`, `ItemRemoved`, `ItemVoided`, `ItemMovedToStock`, `ItemReturned`, `OrderBoosted`, `ItemsReleased`, `SlipWarned`, `RequestAnswered`, `AlertClosed`; `station` — `FireDispatched`, `ReservationsShifted`, `EngineConfigApplied`, `StationCapacitySet`, `StationPauseSet`; `stock` — `StockSet`, `StockAdded`, `StockReserved`, `StockReleased`, `StockConsumed`; `hub` — `BusinessDayOpened`, `BusinessDayClosed`. `audit` is never read (≈ 30k/day, R6).
- **Snapshots (F §5.8):** after a commit that crosses a multiple of 500 events, and on SIGTERM, the host writes `engine_snapshots` in its own small transaction after the swap (not an event); keeps the newest 3 of the current version and deletes older-version rows after a fresh one is written (D62).
- **Day-close checkpoint (D26, README "To 03a" row 1):** after the commit that applies `BusinessDayClosed`, the host writes `engine_checkpoints { checkpoint_schema: 1, last_seq, stock, stations: { capacity_override, paused }, config }` — a version-independent document (its own schema, upcast like an event, D46). At that point every order has exited (§3.3), so nothing else carries over.
- **Boot step 2:** latest snapshot with `engine_version = 3` → state; else the latest checkpoint → `fromCheckpoint`; else empty from seq 0 (a new hub). **Step 3:** replay since that seq (crash restart ≤ 500 events ≈ 2 s; a version bump replays one day, est. 40–50 s, D26). A version bump is shipped only in the maintenance hour (01a S39); a mid-rush boot still fits the 90 s budget. Steps 2–3 replace 01a's step-3 fold (`sync/boot-steps.ts`) and also compute `stock_version` (01a §6.19) from the same scan. **Step 6:** dry missed-fire count (§3.6.2).

### 3.13 Pending the field visit (Lake City, `field-visit-03a-02-05.md` §A)

Every row is a **proposed default, not a decision**. The engine code is the same whichever answer comes; the answers are config values or the defaults in 01a v2.1. G2 waits for all of them.

| # | Question | Parameter | Proposed default |
|---|---|---|---|
| A1 | Stations, slot or batch, how many at once | `stations[]`, `station_type`, `capacity`; units per line (P-1); `freeze_ms` | tandoor slot 30 (D14), karahi slot = stoves, paye / chanay degh batch, fryer batch; units = pieces; freeze tandoor 90 s, karahi 210 s, degh 0 (D15) |
| A2 | Lane = stoves or chefs (§3 #5) | `stations.lane_units` | null (lanes do not change capacity) |
| A3 | Degh, stock time, sold out, carry over | 01a/01c item and stock-item fields | as configured by the owner (no 03a rule changes) |
| A4 | Tandoor split dine-in / takeaway (D23) | `station_alternates` | none; one week each layout after go-live |
| A5, A8 | Send together or ready first; how late before telling; who tells | `slip_threshold_ms`; receiver | 300 000; the table's owner |
| A6 | Two chefs on one station | — (lane claim, 03b) | no engine effect |
| A7 | Who switches a stove off | `manage-stations` default roles | Owner, Manager |
| A9 | Who waits at the peak | `weight_<type>_pct` | dine_in 100, takeaway 200, delivery 200, parking 200 |
| B18 | Follow-up orders faster | `weight_follow_up_pct` | 300 |
| A10 | Boost who and how often | `boost-order` defaults | Owner, Manager |
| A11 | Will every chef tap | `completion_mode` | `two_tap` (§3 #10) |
| A12 | Where food is collected | `points`, `stations.point_id` | one point "Pass" for every station |
| A13 | Seconds station → pass (measure) | `carry_times` | 0 (D23) |
| A14 | Naan + roti per hour at peak | simulator input; tandoor capacity | rerun §10.6 with the count |
| A15 | How they find out the kitchen is behind | pressure fields | window 900 000, amber 8 000 bp, red 10 000 bp, alert after 300 000 |
| B21 | Which bread goes with what | `goes_with_links` | karahi / salan / paye → roti; pulao → raita; biryani → none |

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| Foundation | `PosEvent`, D44/D45 rules, stream types `order`, `station`, `stock`, `hub` |
| 00 | `writer.run`, `state.setReducer`, `registerBootStep('2' \| '3' \| '6')`, `BootContext.initialState` (+ `missedFires`, `eventsReplayed`, row H-1), `defineCommand`, `defineQuery`, `registerCatchUp`, `registerEventAudience`, `clock.branchNow`, `ids` |
| 01a | `branchConfig()` (schema 3 after v2.1), `onBranchConfigApplied`, `canonicalJson`, stock helpers (01c re-keyed), the stock commands (rows A-9, A-10) |
| 01b | `manage-stations` (row B-1), `boost-order`, `my_stations` scope via `StaffDirectory.stationsOf` |
| 01c | `ItemAdded` v1 (§4.3), `isStockTracked`, `dayDraws`, `canServeFromStock` |
| 01d | `defineAlertKind`, `alerts.raiseMany`, `alerts.closeMany`, `alerts.tickCtx`, `alerts.listOpen`, `registerTick` |
| 02 (when built) | `tableOwners(db, table_ids[]) → Map<table_id, staff_id>` (one statement); stub until then = `placed_by` |

### 4.2 Exposes (later modules may rely only on these)

**`@pos/engine`:** `ENGINE_STATE_VERSION = 3`; `EngineState` (§3.3, read-only for callers); `applyEvent`, `buildEngineState`, `fromCheckpoint`; `planOrder`, `calculateETA` (= preview, §6.1), `checkOrderable`, `reserveStock`, `stockEffects`, `getTickIntents`, `nextDueAt`, `stationView`, `groupReadiness`, `stationPressure`, `stationsLive`, `pullEarly`, `lateStartShift`, `planRelease`, `capacityForLanes`, `goesWith`; the 01a/01c stock helpers unchanged.

**Hub:** the `fires` tick; the kinds `slip_warning`, `station_overload`; commands `set-station-capacity`, `set-station-pause`; query `stations-live`; catch-up part `stations_live`; audiences for the station-stream events.

**Events (all `schema_version: 1`; `@pos/events/src/events/{order,station,stock}/`).** 03a defines the payload fields the engine reads; **the writing module implements them exactly and may add its own fields before the pilot (R29), never change these** (extends §3 #4, **P-9**).

| Event | Stream / id | Payload (engine fields) | Written by |
|---|---|---|---|
| `OrderPlaced` | order / order_id | `{ order_id, order_type, table_id \| null, table_key, follow_up, pickup_at_ms \| null, order_item_ids: string[], groups: [{ group_id, target_land_ms, promise_ms, order_item_ids }], lines: [{ order_item_id, station_id, alternates: [{ station_id, carry_ms, home }], point_id \| null, carry_ms, from_stock, weight_pct, max_early_ms, max_late_ms \| null }] }` — batch order: `OrderPlaced`, then `ItemAdded` in `order_item_ids` order, then `StockReserved`; the engine plans at the last listed `ItemAdded` | 02 `SubmitOrder` |
| `ItemAdded` | order / order_id | 01c §4.3, unchanged | 02 |
| `OrderLinesAdded` | order / order_id | as `OrderPlaced` minus the order fields: `{ order_id, order_item_ids, groups, lines }` (later additions, 01c §4.4 "Later additions"; **P-10**); `lines[]` also carry `return_of: { order_item_id, mode: 'fix' \| 'remake' } \| null` (D28, §3.8a) | 02 (`SubmitOrder` additions, `ReturnToKitchen`) |
| `ItemReturned` | order / order_id | `{ order_item_id, mode: 'remake', replacement_order_item_id }` — the served line exits the engine (§3.3); `fix` writes none (D28) | 04 (draft from 02's `ReturnToKitchen` through 04's helper; bill effect 04's) |
| `ItemStarted` | order / order_id | `{ order_item_id, started_at, source: 'tap' \| 'inferred' }` | 03b, fires tick |
| `ItemDone` | order / order_id | `{ order_item_id, done_at, source }` | 03b, fires tick |
| `ItemDoneUndone` | order / order_id | `{ order_item_id }` (≤ 30 s after Done, D16) | 03b |
| `ItemServed` | order / order_id | `{ order_item_ids, source: 'tap' \| 'estimated' }` (§3 #12) | 02 |
| `ItemRemoved` | order / order_id | `{ order_item_id }` (stage 1) | 02 |
| `ItemVoided` | order / order_id | `{ order_item_id, units }` | 04 |
| `ItemMovedToStock` | order / order_id | `{ order_item_id, units }` | 04 |
| `OrderBoosted` | order / order_id | `{ order_id }` | 02 |
| `ItemsReleased` | order / order_id | `{ order_id, alert_id \| null, released: string[], expedite: string[] }` | `slip_warning.apply`, 02 `ReleaseItems` |
| `SlipWarned` | order / oldest order_id | `{ table_key, order_ids, estimated_land_ms, target_land_ms, promise_ms, alert_id }` | fires tick |
| `FireDispatched` | station / station_id | `{ station_id, order_item_ids, load_id \| null, due_at, reason: 'scheduled' \| 'early_fill' \| 'pulled' \| 'missed' }` | fires tick; 03b `GiveMeMore` (`pulled`) |
| `ReservationsShifted` | station / station_id | F §4.7 `{ station_id, cause: 'overrun' \| 'late_start', shifts: [{ order_item_id, by_ms }] }` | fires tick; 03b `StartItem` (late start) |
| `EngineConfigApplied` | station / branch_id | `{ config_version, stations: [...§3.11], settings: {...} }` | 03a hook |
| `StationCapacitySet` | station / station_id | `{ station_id, capacity_override \| null, previous \| null, reason: 'manager' \| 'lane_off' \| 'lane_on' }` | 03a |
| `StationPauseSet` | station / station_id | `{ station_id, paused }` | 03a |
| `StockReserved` | stock / stock_item_id | `{ stock_item_id, order_item_id, quantity }` (01c V5) | 02 |
| `StockReleased` | stock / stock_item_id | `{ stock_item_id, order_item_id, quantity, reason }` (§3.7) | 02, 04, 01a, day close |
| `StockConsumed` | stock / stock_item_id | `{ stock_item_id, order_item_id, quantity }` (§3.7) | 03b, fires tick |

`TableLockReleased` and `TableLockTouched` are not engine events (02, §3 #8).

### 4.3 Requirements carried to other modules

**To 02 (Ordering + Tables):**
1. Implement `OrderPlaced` v1 and `ItemAdded` v1 **exactly** as §4.2 / 01c §4.3, in the batch order of §4.2, with `groups`, `lines`, `target_land_ms` and `promise_ms` from `planOrder(state, proposed, now)` in the **same** transaction and state; `checkOrderable` first (`409 STATION_PAUSED`); `reserveStock` for `StockReserved` and `lines[].from_stock`; a `sold_out` line at available 0 is refused with 02's code. `OrderLinesAdded` for any later addition to an open order.
2. **Own `TableLockReleased`** (F §4.3 D51): register your own `registerTick({ name: 'table_locks', … })`; the lock state lives in 02's projection, not `EngineState` (§3 #8, F-2).
3. **`follow_up` (D7):** set it on an order whose table already has a served order in the current seating; the engine only weighs it.
4. **Estimated Served (§3 #12, G0-6):** your own tick writes `ItemServed { source: 'estimated' }`; tapped Served writes `source: 'tap'`; the same writer appends `StockReleased` / nothing per `stockEffects`.
5. `ItemRemoved` (with `stockEffects`), `OrderBoosted` (`BoostOrder`, `boost-order`), delivery `pickup_at_ms`.
6. Expose `tableOwners(db, table_ids[])` (one statement) for the slip receiver (§3.8).
7. **Table view "Send what's ready" (D11, D12):** a `ReleaseItems { order_ids, released, expedite }` command (permission: the table's `mark-served` holder) that writes `ItemsReleased` from `planRelease` and closes the open `slip_warning` alert `done`.
9. **Return to kitchen (D28, §3.8a):** `ReturnToKitchen { order_item_id, mode: 'fix' | 'remake' }` on a `served` line (permission: the table's `mark-served` holder); writes `OrderLinesAdded` with one line copying the served line's D25 fields, `return_of` set, no stock draw, planned by `planOrder` as an immediate expedited line (or a boost when `returns_boost`); for `remake` also 04's `ItemReturned` in the same transaction. Two buttons, no reason, no charge in the pilot.
8. **Ordering screen (D20):** tiles show "about `wait_ms + prep + cook`" from `stations-live`, red band = "tell the customer"; refetch on `StationCapacitySet`, `StationPauseSet`, `EngineConfigApplied` frames and every 30 s while open. The ETA preview uses `calculateETA`; the response carries `as_of_seq`, and the submit result wins (§12.3 Q4). Customers and staff are shown `promise_ms`, never `target_land_ms`.

**To 03b (KDS + Printing):**
1. **Ready to serve and Handover** (events, commands, the assembler view, the Ready-to-serve kind with `point_id` and `window_ms`), decided 2026-11-02 (§3 #6); points come with 01a v2.1. Readiness from `groupReadiness`; READY = every sync line done (§3 #9); a release dedupe key uses the `ItemsReleased` event id.
2. **Chef screen contract (D16–D18):** Now / Next / "Later: N" from `stationView(state, station_id, now)`; new tickets append at the bottom; Done removes its line; never reorder what is visible; `mark` lines (`expedite`, `boost`, `pulled`) jump to the top in red with the reason ("T12 is eating").
3. Commands `StartItem` (`ItemStarted`; late start → `ReservationsShifted` from `lateStartShift`; from-stock → `StockConsumed`), `DoneItem` (`ItemDone`; sanity check: Done under 50 % of cook time asks to confirm), `UndoDone` (`ItemDoneUndone` ≤ 30 s, close reason `undone`), `GiveMeMore` (`FireDispatched { reason: 'pulled' }` from `pullEarly`, same `max_early_ms` limit), all per line (D18).
4. Lane Off / On calls `SetStationCapacity` with `capacityForLanes`; a claim never touches the engine.
5. Print a ticket per `FireDispatched` line; reprints after restart (F §5.8 step 5).
6. **Return tickets (D28):** a line with `mark: 'return'` shows at the top in red with "RETURN · fix | remake" and the old ticket's table and item (`return_of.order_item_id`); Start / Done as any line.

**To 04 (Voids + Audit):** `ItemVoided` and `ItemMovedToStock` with the engine fields of §4.2 (`units` voided, per-unit voids of 01c §3.4.8 included) and the `StockReleased` drafts from `stockEffects` in the same transaction. **Returned lines (D28):** define `ItemReturned { order_item_id, mode: 'remake', replacement_order_item_id }` (the served line's bill effect: free in the pilot, wastage, reason `kitchen_fault`; audit with who returned it) and the helper 02's `ReturnToKitchen` calls; a `fix` writes no 04 event. A returned line counts in the wastage report, never as a void.

**To 05 (Billing):** nothing new; the existing rows stand. (`BillClosed` may later become a third engine exit, §3 #11; not required.)

**To 07 (Owner View):** pressure history, overload events and promised-vs-actual are recomputed from the log (`stationPressure` is pure; `SlipWarned`, `FireDispatched.reason`, `ItemStarted` / `ItemDone` sources, K11 timestamps); no extra load-snapshot field (03a-g0 §2).

### 4.4 Stubbed until another module lands

| Stub | Until |
|---|---|
| Slip receiver = `placed_by` | 02 `tableOwners` |
| Points, carry, alternates, knobs at defaults (one point, carry 0, no alternates, weight 100, `max_early_ms` 60 000) | 01a v2.1 — **03a is blocked on it for routing** (03a-g0 §2) |
| `ItemsReleased` from the table view | 02 |
| Start / Done / Give me more | 03b (tests use event fixtures) |

### 4.5 Changes to other specs (R26, R34) — Proposed, needs approval

None of the target files is edited by this draft. On approval each target is bumped with a changelog and "Changed by 03a vX" markers.

#### Foundation v1.8 → v1.9

| Row | Section | Change |
|---|---|---|
| F-1 | §4.7 engine state | `stock: Record<StockItemId, StockEntry>` (§3 #1); `tableLocks` removed; shape = 03a §3.3 |
| F-2 | §4.7 `TickIntent`, §4.3 D51, §5.2 text | `TableLockReleased` leaves the engine; written by 02's own tick (§3 #8); `FireDispatched` gains `reason`; `SlipWarned` per table key |
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

#### 01a v2.0.1 → v2.1 (breaking before the pilot, R29)

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
| A-8 | `stations.pause_enabled` bool; `lane_units` null or 1–capacity; `reserve_units` 0–capacity | — | false; null; 0 | D21, §3 #5, D8 |
| A-9 | **`station_alternates`** `(station_id, alternate_station_id)` PK, `order_types` ⊆ {dine_in, takeaway, delivery, parking} non-empty, `home_for_order_types` ⊆ `order_types`; both slot, same branch, distinct | — | none | D8, D9, P-3 |
| A-10 | **`carry_times`** `(station_id, point_id)` PK, `carry_ms` 0–600 000 | missing row = 0 | — | D8, D23 |
| A-11 | `menu_items.weight_pct` 10–1000; `max_early_ms` 0–3 600 000; `max_carry_ms` null or 0–600 000; `max_late_ms` null or 0–7 200 000; `adjust_time_ms` 0–3 600 000 (cook time of a `fix` return) | — | 100; 60 000; null; null; 180 000 | D3, D28 |
| A-12 | **`branch_engine_settings`** (PK `branch_id`): `weight_dine_in_pct`, `weight_takeaway_pct`, `weight_delivery_pct`, `weight_parking_pct`, `weight_follow_up_pct` (10–1000); `promise_padding_dine_in_ms`, `…_takeaway_ms`, `…_delivery_ms`, `…_parking_ms` (0–1 800 000); `slip_threshold_ms` (60 000–1 800 000); `slip_escalate_ms` (30 000–1 800 000); `cascade_step_ms` (15 000–300 000); `min_gain_ms` (0–600 000); `table_lock_ttl_ms` (60 000–3 600 000, used by 02); `returns_boost` bool (a return is placed as a boost, D28) | — | 100, 200, 200, 200, 300; 180 000 ×4; 300 000; 120 000; 60 000; 60 000; 600 000; false | D3, D5, D6, D7, D8, D11, D42, D51, D28 |
| A-13 | **`goes_with_links`** `link_id` PK, `source_kind` / `target_kind` ∈ {category, item}, `source_id`, `target_id`, `excluded` bool (an item override that removes a category default); unique `(tenant_id, source_kind, source_id, target_kind, target_id)` | — | none (B21 list proposed) | D12 |

**Cloud endpoints (+4, 28 → 32, above the ~30 split line — §12.3 Q11):** `GET` / `PUT /v1/admin/branches/:branch_id/kitchen-layout` (points, station engine fields, alternates, carry times, engine settings in one versioned document; C1–C9, R30); `GET` / `PUT /v1/admin/goes-with` (the tenant's link set). `PATCH /v1/admin/menu-items/:id` accepts the five knobs (last write wins as 01a S23 / R30 named divergence). Owner app pages: "Kitchen layout" and the item form's "Timing" group (settings screen, D1).

**Snapshot schema 3 (`BranchConfigSnapshotSchemaV3`, `SNAPSHOT_SCHEMA_VERSION = 3`), breaking (R29):** adds `points[]` `{ point_id, name, sort_order, is_archived }`; `stations[]` gain `point_id, policy, freeze_ms, min_slack_keep_ms, promise_padding_ms, pressure_window_ms, pressure_amber_bp, pressure_red_bp, pressure_alert_ms, pause_enabled, lane_units, reserve_units, alternates: [{ station_id, order_types, home_for_order_types }], carry_times: [{ point_id, carry_ms }]`; `items[]` gain `weight_pct, max_early_ms, max_carry_ms, max_late_ms, adjust_time_ms`; top-level `engine_settings {…A-12, returns_boost}` and `goes_with: [{ source_kind, source_id, target_kind, target_id, excluded }]`; sorting as 01a §4.3. **Cost:** cloud and every hub released together (01a S28 b; a hub on v2 refuses a schema-3 body and polls again); the builder gains 5 statements, so `GET /v1/sync/config` `200` ≤ **31** with the directory and ≤ **27** config-only (was 26 / 22 at its bound, R32 c); 01c's builder and snapshot tests re-baselined; every fixture builder (`packages/events/testing`) moves to V3; 02 / 03b clients parse V3 only. No hub runs orders yet (R29), so no data migration on hubs.

**Hub (01a hub code):** A-14 the stock commands append `StockReleased` from `stockEffects` (recount below reserved, S14 v0.6; unit changed at `OpenBusinessDay`, S44; `day_closed` at `CloseBusinessDay`); A-15 boot step 3 fold replaced by 03a (carried row); A-16 §4.2 table: `ENGINE_STATE_VERSION = 3`, `EngineState` gains 03a's slices.

#### 01b v1.4.1 → v1.5

| Row | Change |
|---|---|
| B-1 | Permission `manage-stations` (group `kitchen`; scopes `branch`, `my_stations` — the person's stations through `stationsOf`, as `manage-stock`; default Owner, Manager `[owner — pending A7]`): live capacity, lane Off / On, station pause (03a-g0 §5) |
| B-2 | Permission `mark-served` (group `orders`; scopes `branch`, `own_tables`, `my_floors`; default Owner, Manager, Order taker, Waiter), defined here so one 01b bump carries both; 02 uses it (G0 P4) |
| B-3 | `default-roles.ts` and the roles editor catalogue gain both; directory statement count unchanged (rows, not statements) |

#### 00 v1.6.1 → v1.6.2 (additive patch)

| Row | Change |
|---|---|
| H-1 | `BootContext` gains optional `missedFires?: number` and `eventsReplayed?: number`, set by 03a's steps 6 and 3 and used by step 8 `HubStarted` (today `missed_fires: 0`, `apps/hub/src/lib/boot.ts:211`) |

#### 01d v1.1 → v1.1.1 (editorial, only this)

| Row | Change |
|---|---|
| N-1 | §3.3 rule 2 "no pilot request kind is tick-raised" → "03a's `slip_warning` is tick-raised (`named`, `needs_pin: 'never'`): no in-person answer, no requester, no withdraw, no `request_result` (AD-72); 03a closes it". `station_overload` is a plain `info` kind; the table dedupe key works under `(kind, dedupe_key)` as written. No rule change. |

#### README

R-1 module map row 03a: depends on 00 v1.6.x, 01a **v2.1**, 01b v1.5, 01c v1.1, 01d v1.1; blocked by the field visit and 01a v2.1. R-2 the five "To 03a" carried rows marked addressed (§12.4 map). R-3 carried rows "To 02", "To 03b", "To 04", "To 07" from §4.3. R-4 OQ4 closed (§3 #10). R-5 R6 unchanged (no re-plan events, D13).

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
  -- serves: boot step 2 "latest snapshot" and retention (keep 3)

-- D26 day-close checkpoint (version-independent document)
CREATE TABLE engine_checkpoints (
  checkpoint_id     TEXT    PRIMARY KEY,
  branch_id         TEXT    NOT NULL,
  taken_at          INTEGER NOT NULL,
  last_seq          INTEGER NOT NULL,     -- seq of the BusinessDayClosed it follows
  checkpoint_schema INTEGER NOT NULL,     -- 1
  body_json         TEXT    NOT NULL
);
CREATE INDEX eng_ckpt_branch ON engine_checkpoints (branch_id, last_seq DESC);
  -- serves: boot step 2 fallback; retention keeps 7 (one week of day closes)

-- §3 #2: replay by (stream_type, event_type) since a seq
CREATE INDEX events_branch_stream ON events (branch_id, stream_type, seq);
  -- serves: the four replay statements of §3.12
```

**YAGNI:** `engine_checkpoints` prevents a version-bump boot from replaying the whole history (a year ≈ 16 M events) against the 90 s budget (D26); the index prevents a full scan of `audit` (≈ 30k/day) on every boot (§3 #2). No projection tables: the engine state is in memory and rebuilt from events.

### 5.2 Cloud

01a v2.1's migration (§4.5). 03a adds nothing in the cloud.

### 5.3 Upcasters (D46)

None: every 03a event is new at v1. `StockReserved` / `StockReleased` v1 are first defined here (01c named them).

---

## §6. Endpoints, commands and events

Count against the size budget: 13 engine functions that later modules call (batch 1), 4 host pieces (batch 2), 2 commands and 1 query (batch 3) = **20** (budget 10–25).

### Batch 1 — `@pos/engine` (pure; no route)

| # | Function | Contract |
|---|---|---|
| 6.1a | `applyEvent(state, event)` / `buildEngineState(events)` / `fromCheckpoint(body)` | §3.3–§3.12; never mutates its input; unknown events return `state` itself; deterministic in `(state, event)` |
| 6.1b | `planOrder(state, proposed, now)` → `{ groups: [{ group_id, target_land_ms, promise_ms, order_item_ids }], lines: [{ order_item_id, station_id, alternates, point_id, carry_ms, from_stock, eta_ms }] }` | §3.5.1; throws `DomainError('STATION_PAUSED')`; same result for the same inputs |
| 6.1c | `calculateETA(state, proposed, now)` | `planOrder` without stock claims kept; preview only (F §4.7 signature kept) |
| 6.1d | `checkOrderable(state, proposed)` | D21 pause check |
| 6.1e | `reserveStock(state, proposed, dayStartMs)` → `{ drafts: StockReserved[], from_stock: Record<id, boolean>, refused: string[] }` | §3.7 |
| 6.1f | `stockEffects(state, draft)` → `EventDraft[]` | §3.7: the `StockReleased` / `StockConsumed` drafts a triggering draft needs |
| 6.1g | `getTickIntents(state, now)` / `nextDueAt(state)` | §3.6.1; pure; same result twice (F test 13) |
| 6.1h | `stationView(state, station_id, now)` → `{ now: Line[], next: Line[], later_count }` | D16, D17 (Now = fired, Next = frozen in fire order, Later = count) |
| 6.1i | `groupReadiness(state, order_id)` → per group `{ done, waiting, hold: boolean }` | §3.4, §3 #9 |
| 6.1j | `stationPressure(state, station_id, now)` / `stationsLive(state, now)` | §3.10; `stationsLive` = §6.5 body |
| 6.1k | `pullEarly(state, station_id, n, now)` → `FireDispatched` draft | D16 Give me more, same `max_early_ms` |
| 6.1l | `lateStartShift(state, order_item_id, started_at)` → `ReservationsShifted \| null` | F §4.7 D42 late start |
| 6.1m | `planRelease(state, order_ids, ticks?)` / `goesWith(lineA, lineB, links)` / `capacityForLanes(station, lanes_on)` | §3.8, D12, §3.10 |

### Batch 2 — hub host

**6.2 Tick `fires`** (`apps/hub/src/engine-host/fires-tick.ts`). `due(db, state, now)`: `now ≥ nextDueAt(state) \|\| now ≥ host.nextPressureCheck` — no statement. `intents(tx, state, now)`:
1. `intents = getTickIntents(state, now)` (pure).
2. Fire, start, done, shift, consume drafts from the intents; `StockConsumed` from `stockEffects`.
3. Slip: for each slip intent, build `SlipWarned` + one `raiseMany` input (kind `slip_warning`, receiver from `tableOwners` — **one** statement for all tables of the pass, or `placed_by` while stubbed).
4. Overload: pressure check when due (every 15 s): raise inputs for red stations past `pressure_alert_ms` and capped lines; close items for stations below amber; slip closes for resolved groups.
5. **One** `alerts.raiseMany(alerts.tickCtx(tx, now), inputs)` and **one** `alerts.closeMany(…)` (01d fixed statement count, test 35 (d)); `SlipWarned.alert_id` from the raise result.
6. Return all drafts — one transaction (D44). Post-commit: 03b's ticket printing and frames through its own `addAfterCommit`.

Statements per pass with work: ≤ 1 (`tableOwners`) + 01d's `raiseMany` and `closeMany` bounds; 0 otherwise. Target p99 ≤ 20 ms per pass with work on the pilot box (§7.1).

**6.3 Boot steps** (`apps/hub/src/engine-host/boot-steps.ts`, replacing 01a's step-3 registration). Step 2: snapshot / checkpoint load (§3.12, 2 statements). Step 3: four replay statements, merge, fold; `ctx.initialState`, `ctx.eventsReplayed`, `stock_version`. Step 6: `ctx.missedFires` from a dry `getTickIntents` (no write). Also the snapshot writer (`writer.addAfterCommit`: crossing a 500-event multiple; SIGTERM via `app.addHook('onClose')`) and the checkpoint writer (after a commit containing `BusinessDayClosed`). A failing step stops boot (00 §3.8).

**6.4 Kinds and hook.** `defineAlertKind` for `slip_warning` (§3.8) and `station_overload` (§3.10) at module load; `onBranchConfigApplied` (§3.11, 0 extra statements: reads `next` and the state). Audiences: `EngineConfigApplied`, `StationCapacitySet`, `StationPauseSet` → every staff and station socket; no audience on order-stream events (01d run 3 §4). Catch-up part `stations_live` (staff and station sockets; body = §6.5; 0 statements).

### Batch 3 — commands and query

#### 6.5 `GET /queries/stations-live`

Session: device, `session: 'required'`, `allowStation: true`, `countsAsActivity: false`. Query: `{ station_ids?: string[] (≤ 50) }`. **0 SQL statements** (in-memory state). Response `200`:

```json
{ "data": { "as_of_seq": 48211, "now_ms": 1793722800000, "stations": [
  { "station_id": "01JC…S3", "name": "Tandoor", "capacity": 30, "capacity_override": null,
    "effective_capacity": 30, "paused": false, "pause_enabled": false,
    "pressure_bp": 12500, "band": "red", "later_count": 14, "wait_ms": 1080000 } ] } }
```

`wait_ms` = time until one unit with the station's median routed cook time can start (§4.3 To 02 tile). Errors: `400 VALIDATION_FAILED`; unknown ids are left out (a read).

#### 6.6 `POST /commands/set-station-capacity` (`SetStationCapacity`)

Permission `manage-stations` (scope `my_stations` checked last, C8). Payload `{ station_id, capacity_override: int 1–999 | null, reason: 'manager' | 'lane_off' | 'lane_on' }`. Script (subset of 00 §3.7):
1. Schema → `400 VALIDATION_FAILED`.
2. `BEGIN IMMEDIATE`; idempotency re-check (D32).
3. Station in `state.stations` and not archived → else `404 STATION_NOT_FOUND`.
4. Scope → `403 PERMISSION_DENIED { reason: 'outside_scope' }`.
5. Same as current → no event, `200 { changed: false }`.
6. Append `StationCapacitySet`; reducer re-plans (D37); COMMIT; swap (D45).
7. `200 { data: { station_id, effective_capacity, pressure_bp, band, changed: true } }`.

Retransmit returns the stored response (D32). COMMIT failure leaves the live state untouched (D45, test 68). Slips for displaced orders are written by the next tick (≤ 500 ms).

#### 6.7 `POST /commands/set-station-pause` (`SetStationPause`)

Permission `manage-stations` (as 6.6). Payload `{ station_id, paused: boolean }`. Script: 1–4 as 6.6; `paused: true` and `pause_enabled = false` → `409 STATION_PAUSE_DISABLED { station_id }`; same as current → `200 { changed: false }`; append `StationPauseSet`; `200 { data: { station_id, paused, changed } }`. Unpausing is always allowed.

---

## §7. Cross-cutting (this module only)

### 7.1 Performance targets (D24–D27, R6)

| Path | Target | Measured by |
|---|---|---|
| Re-plan per submit (`planOrder` + the `applyEvent` re-plan), inside the writer lock | **p99 ≤ 50 ms** on the pilot box (00's 5 ms no-op budget stays for other commands) | §10.6 CI test + manual check on the pilot mini PC (as 01d #58) |
| Lines re-placed in one submit re-plan (D25 prune + freeze) | ≤ 250 on the generated day (D25 "order of 100–200"; set from the first CI run, spec first) | §10.6 |
| Overload pass (§3.5.6) | ≤ 16 probes; p99 ≤ 50 ms included | §10.6 overload day |
| Fires tick pass with work | p99 ≤ 20 ms; idle `due` no statement | test 62 |
| Crash restart (≤ 500 events) | ≤ 2 s for steps 2–3 | test 64 |
| Full replay from the day-close checkpoint (≈ 66k events) | ≤ 45 s (inside 90 s; D26 est. 40–50 s) | §10.6 |
| `stations-live` | 0 statements; ≤ 5 ms | test 66 |

A re-plan slower than 50 ms is logged at `warn` `{ event_type, station_id, lines, ms }` (no payload).

### 7.2 Logging

Tick errors as 01d (`{ tick: 'fires', err }`). Boot logs `{ step, snapshot_seq, checkpoint_seq, events_replayed, ms }`. No order contents in logs.

### 7.3 Folder placement (F §6.9)

`packages/engine/src/{state,profile,plan,replan,overload,route,tick,stock,slip,pressure,view,checkpoint}.ts`; `packages/engine/test/sim/` (harness, generated day); `packages/events/src/events/{order,station,stock}/`; `apps/hub/src/engine-host/{fires-tick,boot-steps,snapshots,kinds,config-hook}.ts`; `apps/hub/src/commands/{set-station-capacity,set-station-pause}.ts`; `apps/hub/src/queries/stations-live.ts`; migration `apps/hub/src/db/migrations/0007_engine.sql`.

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

Reused: `400 VALIDATION_FAILED`, `403 PERMISSION_DENIED { reason: 'outside_scope' }`, `404 STATION_NOT_FOUND`. Both new codes are appended to F §6.2 and `@pos/domain/src/errors.ts` (no foundation bump, R34).

---

## §10. Tests

Numbers 1–15 are F §4.7's required engine tests, kept and adapted to `EngineState` v3. Test names cite their numbers (F §6.7).

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
| 36 | Slip grouped per table key; re-raise only after +threshold and the previous alert closed (§3 #7, D44) |
| 37 | `ItemsReleased`: released leave the group; expedite immediate with follow-up weight; rest stay sync (D11, D12) |
| 38 | `goesWith`: category default, item add, item exclude; nothing configured → nothing pre-ticked (D12) |
| 39 | Stock: every draw must fit; `sold_out` at 0 refused; `cook_fresh` full cook time (01c §3.5.2, S32) |
| 40 | Recount below reserved releases the most recent units; those lines re-plan at full cook time (S14 v0.6) |
| 41 | `StockConsumed` at start moves units out of `on_hand` and `reserved`; never below 0 (P-5) |
| 42 | Unit changed at day open with `reserved > 0` → `unit_changed` releases (S44) |
| 43 | Weighed line with pending weight: 1 unit, item cook time, fired normally (V18) |
| 44 | Batch: program cook times from the line copies (B1); `max_early_ms` caps freshness per line (D3) |
| 45 | Capacity change re-plans with frozen lines fixed (D37) |
| 46 | `capacityForLanes`: null → unchanged; n → `lanes_on × n` capped (§3 #5) |
| 47 | Pause: `checkOrderable` refuses; open lines continue (D21) |
| 48 | Pressure bands from the profile; pure in `(state, now)` (D20) |
| 49 | Exit on all served / voided / removed and at day close (§3 #11) |
| 50 | READY = every sync line done; hold at pass for a done line with an undone sibling (§3 #9) |
| 51 | `ItemDoneUndone` returns the line to COOKING and its occupancy (D16) |
| 52 | Inferred start / done per `completion_mode` (D60) |
| 53 | `EngineConfigApplied`: capacity change re-plans; cook-time change affects new orders only; archived station lines complete (§3.11) |
| 54 | Station-type change keeps open lines as fixed input (§3.11) |
| 55 | Checkpoint round trip: `fromCheckpoint(checkpoint)` + one day = full replay from seq 0 (D26) |
| 56 | Snapshot fixture: state shape or `applyEvent` meaning changed without bumping `ENGINE_STATE_VERSION` fails (D62, F §6.7) |

### 10.2 Hub

| # | Case |
|---|---|
| 57 | Boot: snapshot v3 loaded; v2 snapshot skipped → checkpoint → one-day replay; no checkpoint → seq 0 |
| 58 | Replay reads only the four filtered streams; `audit` and other order-stream alerts are skipped; uses `events_branch_stream` (`EXPLAIN QUERY PLAN`) |
| 59 | Live state equals replayed state after a mixed day (property, 50 seeds) |
| 60 | Missed fires: step 6 writes nothing; `HubStarted.missed_fires` = dry count; first tick dispatches `reason: 'missed'`; fired-before-outage lines not re-fired (§3 #3, F test 13) |
| 61 | Snapshot every 500 events and on SIGTERM; keep 3; older versions deleted |
| 62 | Tick: idle pass opens no transaction and runs no statement; a pass with work is one transaction with ≤ 1 + 01d bounds statements |
| 63 | Tick isolation: a throw in `fires.intents` rolls back only the fires tick; 01d's tick still runs |
| 64 | Crash restart of 500 events ≤ 2 s (steps 2–3) |
| 65 | `slip_warning`: raised to the receiver (stub `placed_by`); step 1 escalates to managers at `escalate_ms`; accept → `ItemsReleased` with `alert_id`; decline → nothing; `apply` writes nothing (read-only view); answered by a non-receiver → `403 not_receiver` |
| 66 | `stations-live`: 0 statements; body matches `stationsLive` |
| 67 | `station_overload`: raised after red for `pressure_alert_ms`; deduped; closed below amber |
| 68 | `set-station-capacity`: happy; `400`; `404 STATION_NOT_FOUND`; `403 outside_scope`; no-op; retransmit (D32); COMMIT failure leaves the live state (D45) |
| 69 | `set-station-pause`: happy; `409 STATION_PAUSE_DISABLED`; unpause always; retransmit; COMMIT failure |
| 70 | `onBranchConfigApplied`: one `EngineConfigApplied` only when the engine part changed; never throws on any valid config (fuzz over the V3 builder) |

### 10.3 Concurrency and races

| # | Case |
|---|---|
| 71 | A submit and the fires tick in the same 500 ms: the tick's `intents` re-select inside its transaction; no double fire |
| 72 | Slip `accept` answered after the last line went Done: `ItemsReleased` with `released` only; tick close is a no-op |
| 73 | Capacity change between `due` and `intents`: intents computed on the new state |
| 74 | Two submits claiming the last stock unit: second gets full cook time (`cook_fresh`) or refusal (`sold_out`) (E1 stock AC4) |
| 75 | **Return to kitchen (D28, §3.8a):** `fix` on a served from-stock line → one new immediate line, `cook_ms = adjust_time_ms`, no `StockReserved`, `mark: 'return'`, placed within others' slack (no deadline crosses); `remake` → `ItemReturned` exits the served line and the new line uses the normal cook time; with `returns_boost` the new line displaces and the displaced order slips; a return on a line not `served` is refused by 02 (fixture) |

### 10.4 Acceptance (story AC → test)

| Story AC | Tests |
|---|---|
| E4 ETA AC1–AC3 (prep + wait + cook; slot / batch wait; stock time until 0) | F 1–4, 10, 15; 39 |
| E4 ETA AC4 (shared queues, no default priority) | 25, 28 — **changed by D3**: weights are config, default by order type (pending A9) |
| E4 ETA AC5 (recalc on every event) | 21, 45 — as bumped by D13 (§3 #13) |
| Hold-and-fire AC1–AC2a | F 2, 5–7; 17–19 |
| AC3 fire at latest start; AC6 (KDS countdown, 03b) | F 13; 60 |
| AC4 batch freshness | F 3, 9, 14; 44 |
| AC5 boost | 34 |
| AC7 nothing hard-coded | lint test (no item or station names in `packages/engine/src`) |
| Slip AC1 threshold | 35 |
| Slip AC2–AC3 (to the order taker; escalation) | 65 |
| Slip AC4 one per table | 36 |
| Slip AC5 tracking page | out of scope (E9, P2) |
| Overrun / cascade (D33, D42) | F 8, 11, 12 |
| Restart without re-fire (D24, D44) | F 13; 57, 59, 60 |

### 10.5 Statement counts

Every hub path in §6 asserts its count: tick idle 0; tick with work ≤ 1 + 01d bounds; boot step 2 = 2, step 3 = 4; commands = 00 pipeline + 0 reads (state in memory); `stations-live` 0.

### 10.6 Simulator and CI performance gate (D22, D27)

`packages/engine/test/sim/` ports `docs/stories/03a-sim/replay_cost.py` and `tandoor_sim.py` to TypeScript on the real engine:
- **Generated day** (seed 7): 2 000 orders, 65 % in a ~5 h dinner window (~260 orders/h at peak), 25 % lunch, 10 % uniform over 18 h; stations tandoor slot 60 × 180 s, karahi slot 50 × 1 200 s, BBQ slot 30 × 900 s, degh batch 1 000 × 60 s, tawa slot 8 × 300 s; lines per order as the drill's `MENU`; target = max cook + 300 s; Start/Done tapped on time.
- **Asserts (CI, Vitest `perf` project):** re-plan per submit p99 ≤ 50 ms; lines re-placed per submit ≤ 250; full-day replay from a checkpoint ≤ 45 s; events ≈ R6 (±20 %); live state = replayed state. An **overload day** (tandoor at 125 %) asserts the overload pass bound.
- **Policy report (not a gate):** % promises kept, max late, mean wait by order type, cold time, utilisation for FIFO / EDF / Waada Guard (D22); rerun with the field-visit rush counts (A14) before G2.

---

## §11. Build order

Each task is TDD (failing test first) and cites its sections. Batches of ~5; the simulator (task 18) is the gate before the hub tasks.

| # | Task | Files | Spec |
|---|---|---|---|
| 1 | Event schemas v1 (§4.2 table) and fixtures | `packages/events/src/events/{order,station,stock}/` | §4.2 |
| 2 | Error codes | `packages/domain/src/errors.ts` | §9 |
| 3 | `EngineState` v3, `ENGINE_STATE_VERSION = 3`, snapshot fixture test | `packages/engine/src/state.ts`, `version.ts` | §3.3; test 56 |
| 4 | Occupancy profile (`latestFit`, `earliestFit`, add, remove) | `profile.ts` | §3.3, D24 |
| 4a | Return lines: `return_of` fold, `fix` cook time, no draw, expedite / boost placement | `plan.ts`, `apply-event.ts` | §3.8a; test 75 |
| 5 | F tests 1–15 on v3 | `test/foundation.test.ts` | F §4.7 |
| 6 | Lines, units, cook time; plan trigger at last listed line | `apply-event.ts`, `plan.ts` | §3.2, §3.5.1; 16–19, 43 |
| 7 | Hold-and-fire against the profile; target and promise; delivery | `plan.ts` | §3.5.1; 17, 31 |
| 8 | Re-plan passes, keep, freeze, prune | `replan.ts` | §3.5.3; 20–23 |
| 9 | Policies FIFO / EDF; weights | `replan.ts` | §3.5.2–§3.5.4; 24, 25 |
| 10 | Overload Λ search, `max_late_ms` | `overload.ts` | §3.5.6; 26, 27 |
| 11 | Routing, reserve, re-route | `route.ts` | §3.5.5; 28–30 |
| 12 | Stock reserve / release / consume, `stockEffects` | `stock.ts` | §3.7; 39–42 |
| 13 | Batch loads with copied cook times | `plan.ts` | F §4.7; 44 |
| 14 | Tick intents: fires, auto-fill, inferred, cascade, `nextDueAt` | `tick.ts` | §3.6; 32, 52, F 8, 12, 13 |
| 15 | Slip and `ItemsReleased`, `goesWith`, `planRelease` | `slip.ts` | §3.8; 35–38 |
| 16 | Boost, capacity, lanes, pause, pressure, exit, READY, undo | `apply-event.ts`, `pressure.ts`, `view.ts` | §3.4, §3.9, §3.10; 34, 45–51 |
| 17 | `EngineConfigApplied` effects; checkpoint | `apply-event.ts`, `checkpoint.ts` | §3.11, §3.12; 53–55 |
| 18 | **Simulator + CI perf gate** (gate for tasks 19+) | `test/sim/` | §10.6 |
| 19 | Migration `0007_engine.sql` | hub migrations | §5.1 |
| 20 | Boot steps 2, 3, 6; replay filter; 00 H-1 fields | `engine-host/boot-steps.ts`, `lib/boot.ts` (H-1) | §3.12; 57, 58, 60, 64 |
| 21 | Snapshot and checkpoint writers | `engine-host/snapshots.ts` | §3.12; 61 |
| 22 | Fires tick | `engine-host/fires-tick.ts` | §6.2; 62, 63, 71, 73 |
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
4. Every §3.13 row answered from the field visit and the defaults updated (spec first).
5. README rows R-1–R-5 applied.

### 12.2 Endpoint checklist

| # | Item | Kind | Permission | Statements | Errors | Events |
|---|---|---|---|---|---|---|
| 6.2 | `fires` tick | tick | — | 0 idle; ≤ 1 + 01d | — | `FireDispatched`, `ItemStarted`, `ItemDone`, `ReservationsShifted`, `StockConsumed`, `SlipWarned`, alert events |
| 6.3 | boot steps 2, 3, 6 | boot | — | 2, 4, 0 | boot stops | — |
| 6.4 | kinds + config hook | registration | — | 0 | — | `EngineConfigApplied`, `ItemsReleased` (apply) |
| 6.5 | `GET /queries/stations-live` | query | session | 0 | 400 | — |
| 6.6 | `set-station-capacity` | command | `manage-stations` | pipeline | 400, 403, 404 | `StationCapacitySet` |
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
| Q9 | Size | 20 items (§6), ~50 plan tasks; plan in batches with the simulator as the gate; re-estimate milestone A after the plan |

Raised by this draft (P-n, proposed):

| # | Proposal | Why |
|---|---|---|
| P-1 | A piece line holds `quantity` units; g / ml and pending-weight lines hold 1 | capacity is in pieces at the tandoor (D14) — pending A1 |
| P-2 | Target and promise are carried in `OrderPlaced` | `recorded_at` is stamped after the handler's `now`; an engine-version replay must not move promises |
| P-3 | Alternates between slot stations only | batch programs are per station; the pilot need is the tandoor (D23) |
| P-4 | Stock releases are explicit events written by the trigger's writer via `stockEffects` | clients fold stock frames (01a §4.4); an implicit release would desync them |
| P-5 | Consume at `ItemStarted` | the portion leaves the pot at start; 01a left "the hand-over step" open |
| P-6 | Answer `accept` sends with default ticks; edited ticks only from 02's table view | `AnswerRequest` has no payload for ticks |
| P-7 | `red_since` lives in host memory; a restart restarts the 5 min | pressure is not an event (D13 spirit); restarts are rare |
| P-8 | `EngineConfigApplied` puts station config into the log | `BranchConfigApplied` carries only a hash; replay must not read config |
| P-9 | 03a defines the engine fields of every event it folds; the writer may add fields before the pilot | extends §3 #4 to 02 / 03b / 04 events (03a is built first) |
| P-10 | `OrderLinesAdded` for additions to an open order | 01c envisages later child lines; a re-plan needs a trigger |
| Q10 | D21 "setting, default off" read as `pause_enabled` (feature off by default) plus a live pause | alternative reading: no setting, `paused` defaults false — owner to choose |
| Q11 | 01a v2.1 goes to 32 endpoints (> ~30) | accept with a README note, or move engine config into its own spec (01f) |
| Q12 | D28: a customer's own wrong order ("I said mutton") — `remake` free, or a void + new charged line (04 approval)? `[owner — pending field visit 15a]` | proposed: 02 offers only fix / remake (both free); a charged replacement is a void (04) plus a normal order, no third mode |

### 12.4 Carried rows "To 03a" — where each is addressed

| README row | Addressed in |
|---|---|
| 00 owner review (drop closed orders; day-close checkpoint; size for 90 s) | §3.3 exit (§3 #11), §3.12 checkpoint (D26), §7.1 |
| 01a S14 / S15 / §4.4 (stock shape, `canServeFromStock`, unit change at day open, `StockSet` below reserved, `sold_out`, replace step 3, config reaction) | §2.4, §3.7, §3.11, §3.12, A-14–A-16 |
| R6 sizing (75k/day, 45k replayed) | §3.12 filter, §7.1, §10.6 |
| 01c §4.4 (deal parts, option children, `deal` never fired, reserve per draw, weighed lines, copied batch cook times) | §3.2, §3.7; tests 19, 39, 43, 44 |
| 01d §4.3 (filter + index, `registerTick`, `raiseMany(tickCtx)`, no catch-all audience; Ready-to-serve kind) | §3.12, §6.2, §6.4; Ready to serve moved to 03b (§3 #6) |

### 12.5 Deferred until needed

Learned cook times (E4 P2); the customer tracking page (E9); multi-station chains (P2+); alternates between batch stations; persisted pressure history (07 recomputes); a "load snapshot" field.

### 12.6 Hostile self-review (author, v0.1)

- **Races:** the tick re-selects inside its own transaction (01d race rule); the plan is computed on the same state in the submit's transaction; boosts and capacity changes re-plan in the reducer; tests 71–74.
- **Idempotency:** commands via `processed_commands`; the tick is idempotent by state (`fired_at`, `slips`); slip raises dedupe on `(kind, slip:<table_key>)`.
- **Determinism gaps found and fixed:** config read during replay (→ `EngineConfigApplied`, P-8); promise recomputed on replay (→ in `OrderPlaced`, P-2); freeze against a clock (→ `recorded_at`, D13); pressure timer (host memory, stated P-7).
- **Indexes / N+1:** replay index added; tick resolves all receivers with one `tableOwners` call and all alerts with one `raiseMany` / `closeMany`.
- **Contradictions with the foundation:** every override is a §4.5 F row (F-1–F-12).
- **Over-engineering check:** checkpoint table and index justified (§5.1); no re-plan events, no cache, no projection.
- **Open risk:** the 50 ms p99 is an estimate from a Python drill (03a-g0 §6b); the CI gate (task 18) runs before any hub work, so a miss changes the algorithm before the host is built.
