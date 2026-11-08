# 02b Ordering — Module Spec

| | |
|---|---|
| Doc | Module spec, **v0.3 — DRAFT** (developer as the owner's proxy, 2026-11-07). G2 (`docs/reviews/02b_v0.1_g2_completeness.md`) and G4 run 1 (`docs/reviews/02b_v0.2_hostile_run1.md`) fixed here (§12.6). Next: G4 run 2 in a fresh session. |
| Depends on | Foundation **v1.10**, 00 Hub Platform & Access **v1.7**, 01a Restaurant Setup **v2.2**, 01b Staff & Roles **v1.6**, 01c Menu Variants **v1.1.1**, 01d Notifications & Requests **v1.2**, **02a Tables v1.0**, **03a Timing Engine v1.1** (and the engine lane's as-built code on `module-03a`, read at `f7e04dc`) |
| Inherits | Shared Standards from Foundation v1.10 §6. Not redefined here. |
| Inputs | `docs/stories/02b-g0.md` (G0, owner answers §5.4), `docs/stories/02b-g1-decisions.md` (G1-1–G1-20), `docs/stories/02-g0.md` §5.4, `01d-g0-decisions.md` Z1–Z8, C1–C4, G0-6; 03a build carried rows (AD-17, AD-19, AD-29, AD-30). |
| Rigor | T2 (CLAUDE.md). |

### Changelog

| Version | Change |
|---|---|
| v0.1 | First draft from G0 + G1. |
| v0.2 | G2 fixes (`02b_v0.1_g2_completeness.md` #1–#14). |
| v0.3 | G4 run 1 fixes (`02b_v0.2_hostile_run1.md` #1–#32), closure table §12.6. Main changes: one per-line **money ledger** (§3.4, #1); Q-3 / Q-4 restated as costed engine code changes (#2, #4); zone serves marked `source: 'zone'` so they never count as eating (#3); zones are flat (#5); zone claims counted per payload (#6); stale comp requests closed (#7); H-1 written completely and limited to queueable commands made before the session ended (#8, #9); Served from fired lines only, remove at stage 1 per F §4.2 (#10); customer phone and name only to the cashier and the placer (#11); day close keeps unfinished orders (#12); `my_zones` from the person's or lead's zones (#13); scope sets fixed (#14); no cross-projection fold (#15); slips re-keyed on split / merge (#16); minors #17–#32. |

---

## §1. Header

### 1.1 Stories covered

E2 "Table management and order types" AC9 (dine-in, takeaway, parking; delivery and web deferred); E2 "Adding items to a running order" AC1–AC4; E2 "Per-item ETA preview" AC1–AC6; E2 "Sold out and slow items" AC1–AC3; E0 "Hold/park, notes, reorder, reprint" AC1 (device only, manager view deferred) and AC2; E0 "Refunds, cancellations, complimentary items" AC3, AC4 (stage 1), AC5; E5 "Device resilience during hub restart" AC1–AC4 and its "order in progress preserved" edge case; 01d-g0 Z3–Z5, Z7; C2–C3; G0-6 (Served by tap); owner (02-g0 §5.4, 02b-g0 §5.4) Q4 token, Q5, Q6, Q7, Q8, and 02b Q1–Q6.

### 1.2 In scope

Orders and lines (`SubmitOrder`, rounds, `follow_up`, ids), the `ItemAdded` copy and `ProposedOrder`, availability / windows / stock / pause / option checks, zone routing at submit, zone-served lines, stage-1 removal (whole or partial) and `OrderCancelled`, the per-line money ledger, weighed lines, Served by tap (estimated Served specified, registered with 03b), `ReleaseItems`, `BoostOrder`, `ReturnToKitchen`, comps (command, event, approval kind), zone stock (counts, refill as a transfer, set count, low / out alerts), takeaway token, parking fields, order notes, `seatingTotals`, the device command queue (hub acceptance rules and the client queue), the ordering screen, the orders part of the table view, open orders (incl. abandoned), held orders (device-local).

### 1.3 Out of scope

Delivery and web order types (P2 / P4, §12.4); later child additions to a submitted parent (§12.4); reorder (§12.4); editing a kitchen note after submit (§12.4); sibling-zone transfer (Z6), day-end zone recount prompt (Z8), nested zones (§12.4); tables, seatings, lock, handover, move / merge / split, bill request, cleaning (**02a**); engine math and its events' engine fields (**03a**); Start / Done, Ready to serve, Handover, KDS, tickets, the Served card (**03b**); voids at stage 2+, move-to-stock, remake billing, the customer's own wrong order (**04**); bills, payments, discounts, the comp's bill effect, Z report (**05**); hub-down manager alert (**06 / 01e**); customer tracking (P2).

### 1.4 Decisions log (developer, 2026-11-07)

| ID | Decision |
|---|---|
| O1 | **A round is a new order.** `OrderLinesAdded` only for `ReturnToKitchen` (D2, D7; 02b-g0 §3 #2). |
| O2 | **One line with quantity** (01c D-2); partial actions name `units`. |
| O3 | **Ids from the device** (03a AD-29 Q5): `order_id` and every `order_item_id` are ULIDs minted when the line enters the cart and kept for every retry. |
| O4 | **Zone routing resolved by 02b** (Z3): a dine-in line's starting station is the route of the seating's primary table's zone, else the branch route. Zones are flat (01a v2.2); nesting deferred. |
| O5 | **Zone-served lines** (Z4): a plain item line punched at a table whose zone holds it is taken from the zone count, not an engine line, served in the submit batch with `source: 'zone'`, never printed, never counted as "eating". |
| O6 | **Refill is a transfer** (owner Q1): a refill moves the item's day stock draws out of branch stock; a count never touches branch stock. |
| O7 | **Partial remove and partial comp** (owner Q2, Q3): both take `units`, through one per-line money ledger (§3.4). |
| O8 | **No day, no order** (owner Q4). |
| O9 | **Lock scope** (D39 extended): only `SubmitOrder` and `RemoveItems` call `requireLock`; 02a row P-1e records it. |
| O10 | **Non-table orders belong to the person who placed them** for `own_tables` and `my_floors` (owner Q6, B-4). |
| O11 | **Queued auto-send** (owner Q8, 00 H-1): only queueable command types, made before the session ended, of a session that ended normally, within `queue_auto_send_max_ms`. |
| O12 | **Token** for takeaway only; from 1 per business date per branch. |
| O13 | **Comps on submitted lines only**; comps and every PIN-capable action are online only. |
| O14 | **Estimated Served** is specified here and registered when 03b's `Handover` exists (no tick before that). |
| O15 | **Short stock** is refused (03a AD-19); the client caps the stepper. |
| O16 | **Served needs a fired line** (stages: fired-not-started, cooking, cooked); unfired lines are never served (F-1). **Remove** = stage 1 per F §4.2 (not started; fired or not); a fired line's removal prints a CANCELLED slip (03b). |
| O17 | **Customer contact** (phone, name) goes only to cashier kiosks and the placer's sessions; others see "has phone" and fetch it on demand (`order-contact`, logged). It stays in the immutable event log and the cloud (§12.3 Q1 for the owner). |
| O18 | **Slips follow the party**: when 02a moves orders to another seating (split, merge), the engine re-keys their `table_key` (03a row Q-7), so one slip group never holds two parties. |

---

## §2. Existing architecture that must not change

- 00: `POST /commands/:name`, device + staff session, D32 idempotency (`processed_commands`), single writer `BEGIN IMMEDIATE`, commit-then-swap (D45), projections with `reset`, ticks, catch-up, audiences, `StaffDirectory`, `clock`, `ids`, M19 replay fast path, pipeline order 00 §3.7. The envelope has no free-form field (F §4.1, `packages/events/src/envelope.ts`).
- Foundation §5.9 submit pipeline; §4.2 stages and guard; §4.3 lock (D39, D51, D61); §4.1 stream types (`order, table, station, stock, shift, audit, hub, staff`).
- 01a: `branchConfig()` (snapshot V4), `openDayStartMs(state)`, `BusinessDayOpened` / `BusinessDayClosed`, `BUSINESS_DAY_NOT_OPEN`, stock events, `item_availability`, `hub_time`.
- 01b: `resolve(staff, permission)`, `PERMISSION_SCOPES`, scopes `branch`, `my_floors`, `own_tables`, B-2 zone assignment (one order taker per zone), `reports_to`; C8.
- 01c: `ItemAdded` v1 (§4.3), `menu-lines.ts` (`orderLineTotalMinor`, `allocateDealMinor`, `checkOptionChoices`, `isGroupSatisfiable`, `isItemOrderable`, `childQuantity`, `optionChargeMinor`), engine stock helpers.
- 01d: `defineAlertKind`, `alerts.raise` / `raiseMany` / `close` / `closeMany` / `byDedupeKey` / `listOpen`, `registerTick`, `APPROVAL_TIER_STEPS`, read-only request `apply`, PIN commands never queued, target kinds §3.4.
- 02a: `seatingOf`, `currentTableOf`, `requireLock`, `zoneOf`, `holdersOfOrders`, projection `tables` (writes `seatings`, `seating_tables`, `seating_orders`, `table_locks`).
- 03a (as built on `module-03a`): `ProposedOrder`, `checkOrderable`, `reserveStock`, `planOrder(state, proposed, now, from_stock)`, `calculateETA(state, proposed, now, from_stock?)`, `stockEffects`, `planRelease`, `isOrderInEngine`, the `order` events' engine fields, `stations-live`, `slip_warning`.

---

## §3. Domain rules

### 3.1 Order types and identity

| Type | Identity | `table_key` | Lock | Extra fields |
|---|---|---|---|---|
| `dine_in` | the seating (02a) | `'dine_in:' + seating_id` (02a T21; re-keyed by the engine on split / merge, O18) | `requireLock` | — |
| `takeaway` | token | `'takeaway:' + order_id` | none | `token`, `customer_name?`, `phone?` |
| `parking` | car number | `'parking:' + car_number_norm` | none | `car_number`, `car_type`, `phone?` |

`car_number_norm` = upper-case, spaces and dashes removed; `car_number` stored as typed (2–12 of letters, digits, space, dash). `car_type` ∈ `sedan | mini | large` (required, S10). `phone`: 10–13 digits, stored digits only. `customer_name` ≤ 40. Two parking orders with the same plate share a `table_key` (the same car). `OrderPlaced.table_id` = the seating's primary table at submit (03a field); 02b keeps no copy of it.

### 3.2 Submit (`SubmitOrder`)

1. **Day:** `openDayStartMs(state)` null → `409 BUSINESS_DAY_NOT_OPEN` (O8). `business_date` from the open day.
2. **Type:** `dine_in` needs `{ table_id, seating_id }` (both required); `seatingOf(table_id)` ≠ given → `409 TABLE_SEATING_CHANGED`; `requireLock(tx, { table_id, seating_id }, { ...ctx, queued })` → its drafts (02a; P-1b: a queued submit never takes a free lock).
3. **Ids** (O3): an id repeated inside the payload → `400 VALIDATION_FAILED` (path `lines.N.order_item_id`, C6); an id already in `orders` / `order_lines` or live in `EngineState` → `409 ORDER_ITEM_ID_IN_USE { order_item_id }` or `{ order_id }`.
4. **Lines from config** (D25): item / variant / deal from `branchConfig()`; missing → `404 MENU_ITEM_NOT_FOUND` / `DEAL_NOT_FOUND`; manual Off → `409 ITEM_UNAVAILABLE`; outside its or its category's windows on hub time → `409 ITEM_OUT_OF_HOURS { item_id, opens_at_ms | null }` (S47); options through `checkOptionChoices` → `422 OPTION_CHOICE_INVALID { order_item_id, violations }`; a required group not satisfiable → `ITEM_UNAVAILABLE`.
5. **Zone-served** (O5, §3.10): a line marked `from_zone: true`, `line_kind 'item'`, no options, `dine_in`, the primary table's zone lists the item, and `on_hand − claimed ≥ quantity` (claims counted across the payload in line order, as `reserveStock` does) → zone-served, `served_from_zone_id` set. Any check failing → `409 ZONE_STOCK_EMPTY { zone_id | null, item_id, on_hand }` (the client sends it again as a kitchen line).
6. **Routing** (O4): each engine line's `station_id` = the zone route of the primary table's zone (dine-in only) else the branch route; `alternates`, points and carry from 01a A-9 / A-10 for the order type.
7. **Build** `ProposedOrder` (03a §4.2): `lines` = every line except zone-served ones (deal headers included; the engine skips them, 03a :245); `order: { order_type, table_id, table_key, follow_up, pickup_at_ms: null }`. `OrderPlaced.order_item_ids` = the same ids in the same order (03a `OrderPlaced` field; `ProposedOrder` has none).
8. **Engine:** `checkOrderable(state, proposed)` → `409 STATION_PAUSED { station_id }`; a line with `out_of_stock_behaviour 'sold_out'` and available < needed → `409 ITEM_SOLD_OUT { item_id, available }` (O15); `reserveStock(state, proposed)` → `StockReserved` drafts and `from_stock`; `planOrder(state, proposed, now, from_stock)` → groups, lines (route fields copied verbatim into `OrderPlaced.lines[]`, AD-17).
9. **Token** (O12): takeaway → `1 + MAX(token)` over `orders` of the `business_date`.
10. **Append** in this order (03a :615): lock drafts → `OrderPlaced` → `ItemAdded` × n in `order_item_ids` order → zone-served `ItemAdded`s → `StockReserved` × n → `ItemServed { order_item_ids: zone-served ids, source: 'zone' }` (if any) → the drafts of `alerts.raise` for `zone_stock_low` / `zone_stock_out` (§3.10) → `QueuedCommandAccepted` (00 H-1, when queued).
11. **Result** `{ order_id, token | null, groups: [{ group_id, promise_ms, order_item_ids }], lines: [{ order_item_id, eta_ms | null, from_stock, zone_served }] }` — `promise_ms` only, never `target_land_ms` (03a #9). The client compares with its last preview and shows "time updated" when a promise moved ≥ 60 s (03a Q4).

**Statements:** 1 seating + lock (02a) + 1 ids (orders ∪ order_lines) + 1 `follow_up` (02a `seating_orders` ⋈ 02b) + 1 zone counts + 1 token + 1 `item_availability` + append batch (+ 1 per raised alert, 01d's bound); engine in memory. p99 < 60 ms at 12 lines.

### 3.3 Rounds, `follow_up`, open and billed

- Every submit is a new order (O1). `follow_up` (dine-in only) = an order of the **current** seating (02a `seating_orders`, P-1c) has a line served with `source ≠ 'zone'` (02a's `served_any` ignores zone serves, P-1d). Takeaway / parking: `false`.
- **Grouping** is always 02a's current `seating_orders` (read-only join, P-1c): `seating-orders`, `ordersOf`, `seatingTotals`, `follow_up`.
- **Billed:** dine-in = the order's current seating has `bill_closed = 1` (02a `seatings`, read at query time, P-1c; no fold); takeaway / parking = `billed_at` from 05's `OrdersBilled { order_ids }` (To 05).
- **Day close:** `BusinessDayClosed` sets `day_closed_at` only on the day's orders that are cancelled, or whose lines are all served, removed or voided. An order still cooking stays open and is shown under the next day with "from <date>" (it keeps its token).

### 3.4 Units and the per-line money ledger

- **Units** of a line: `quantity` for `piece` lines; `1` for `g` / `ml` lines and while a weight is pending (= 03a :246); `quantity` for `deal` lines (money only; the engine never plans a deal line); `option_child` lines follow their parent's units by `childQuantity`.
- **Unit states.** Every unit is in exactly one state: `live`, `live_comped`, `removed`, `voided`, or `returned` (remake). `live_units = units − removed − voided − returned`; comped units are live (served and shown, owner A). An order with no live line is cancelled (§3.5).
- **Money ledger.** `shares = allocateDealMinor(line_total_minor, [1 × units])` (01c, BigInt-safe). Units leave billing in order; the k-th unit to leave billing (by comp, remove or void, counted together) takes `shares[k]`. Columns: `comp_minor`, `removed_minor`, `refund_minor`; `billed_minor = line_total_minor − comp_minor − removed_minor − refund_minor`.
  - **Remove / void** take **uncomped** live units first. When they must take a comped unit, that unit's share moves from `comp_minor` to `removed_minor` (or `refund_minor`), last comped first; no new share is taken.
  - **Comp** takes the next free shares.
  - Invariant: `comp_minor + removed_minor + refund_minor ≤ line_total_minor`, and = Σ of the shares of units out of billing (CHECK and property test).
- **Weights:** `SetLineWeight` on a line that has any unit out of billing → `409 LINE_ALREADY_SETTLED { order_item_id }`.
- **Cascade:** a remove, void or comp of `n` parent units applies to each `option_child` the share `childQuantity` gives, in the same transaction; a `deal` line's `n` units cascade to its parts' engine units (`ItemRemoved` per part with its proportional units; money stays on the deal line, parts are 0).
- **04** uses the same ledger for voids (To 04): the k-th leaving unit's refund = `shares[k]`, comped units taken last, `refund_minor` on `ItemVoided`. 01c N1 ("remaining refundable") equals this rule once removals and comps count as leaving units.

### 3.5 Remove at stage 1 (`RemoveItems`) and `OrderCancelled`

- **Stage 1** (F §4.2): not started (`started_at` null in `EngineState`), fired or not (O16). Past it → `409 ITEM_WRONG_STAGE { order_item_id, stage }` (the client offers 04's void). A fired line's removal is printed as a CANCELLED slip by 03b (To 03b).
- **Zone-served line:** removable within `zone_undo_ms` (branch setting, default 300 000) of its `ItemAdded`; the count goes back up (fold). Later → `ITEM_WRONG_STAGE` (manual Count, §8). F-1 lists this exception.
- Each entry `{ order_item_id, units? }` (unique, C1); absent = all live units; `units > live_units` → `422 VALIDATION_FAILED`; partial only on `piece` and `deal` lines.
- `deal_part` alone → `409 DEAL_PART_NOT_REMOVABLE` (remove deal units).
- **Drafts:** per line `ItemRemoved { order_item_id, units }` (03a Q-4) + `stockEffects(ItemRemoved)` releasing **that share** (Q-4) → stale comp requests closed (§3.9) → `OrderCancelled { order_id }` when no live line is left.
- **Export** `lineChangeDrafts(tx, order_id, changes: { order_item_id, units_out }[])` returns `OrderCancelled` (if the order is emptied) and the stale comp-request closes; 04 calls it in every void transaction (To 04).

### 3.6 Weighed lines (`SetLineWeight`)

A line with `requires_weighing` and `quantity null` is pending. `SetLineWeight { order_item_id, quantity }` (S59 steps of 50, 50–50 000) → `LineWeightSet { order_item_id, quantity, line_total_minor }`, total from the **`ItemAdded` copy** (01c M7). A correction is allowed until the bill closes, unless a unit left billing (`LINE_ALREADY_SETTLED`). Non-weighed → `409 LINE_NOT_WEIGHED`; billed → `409 ORDER_BILLED`.

### 3.7 Served (`MarkServed`) and the estimate

- `MarkServed { lines: [{ order_id, order_item_ids }] }`; no lock (D39). A line must be **fired** (in a dispatched load, or started, or done) (O16); an unfired line → `409 ITEM_WRONG_STAGE { order_item_id, stage: 'added' }`, nothing written. Already served → skipped (`result.skipped`). Removed / voided → `ITEM_WRONG_STAGE`.
- One `ItemServed { order_item_ids, source: 'tap' }` per order + `stockEffects` drafted from folded state, array form across the whole command (03a AD-29 Q7).
- **Estimated Served** (G0-6): when 03b ships `Handover`, 02b registers tick `served_estimate` (`due` = 1 indexed statement for handovers older than `served_estimate_ms` with unserved lines; `intents` = `ItemServed { source: 'estimated' }` per order + `stockEffects`). Not registered before (O14).

### 3.8 Release, boost, return

- `ReleaseItems { order_ids, released, expedite }` (sets) → `planRelease` (03a §3.8; it fills `alert_id` per group from memory) → `ItemsReleased` per order; the distinct `alert_id`s whose groups `planRelease` reports resolved are closed `done` with one `alerts.closeMany`. No extra read.
- `BoostOrder { order_id }` → `OrderBoosted`; not in the engine → `409 ORDER_NOT_IN_ENGINE`.
- `ReturnToKitchen { order_item_id, return_order_item_id, mode: 'fix' | 'remake' }` (03a §3.8a; whole served line; no note): served, its order in the engine, not zone-served (`ITEM_WRONG_STAGE`), no open return (`409 RETURN_ALREADY_OPEN`). Build a one-line `ProposedOrder` (`return_of`, `cook_ms_override` = the item's `adjust_time_ms` for `fix`, money 0, `line_kind 'item'`, links null, `options []`, `quantity` copied) and call `planOrder` for `groups` and `lines` → `OrderLinesAdded` + its `ItemAdded` (+ `ItemReturned` for `remake`). Return lines are never billed or comped.

### 3.9 Comps (`CompLine`, kind `comp`)

- `CompLine { order_item_id, units, reason_code, note? }` on a submitted live line (O13); not a return line, not a `deal_part`, not zone-served pending undo → `409 COMP_NOT_ALLOWED { reason }`. `units ≤ live_units − comped_units` else 422. Pending weight → `409 LINE_WEIGHT_PENDING`. Billed → `ORDER_BILLED`.
- `value_minor` = the next free shares (§3.4) plus the cascaded children's shares.
- `defineCommand` with `approvable: true` (00 :470). Grant `allowed` → `LineComped { …, alert_id: null, approver_staff_id: null }`. Grant `requires_approval` → `alerts.raise(ctx, { kind: 'comp', subject: { stream_type: 'order', stream_id: order_id }, target: { kind: 'answerers' }, values: { order_id, order_item_id, units, reason_code }, details: { item, quantity: units, amount: value_minor, reason }, display, dedupe_key: 'comp:' + order_item_id, requester_staff_id: caller, request: { approver_role_ids: ctx.permission.approver_role_ids } })`; result `{ alert_id, pending: true }`; `deduped: true` → `409 COMP_PENDING { alert_id }`.
- `apply` (approve): read-only re-check; returns `LineComped { …, alert_id, approver_staff_id: answer.answerer_staff_id }` with `value_minor` recomputed from the current ledger; reject → `[]`.
- **Stale requests:** every write that leaves `live_units − comped_units < requested units` (remove, void through `lineChangeDrafts`, order cancelled) closes the open `comp:<order_item_id>` request `obsolete` with a note in the same transaction (`byDedupeKey`, 1 statement); 01d tells the requester. 05 lists the rest at day close.
- Stock: a comped line was cooked and served — no stock event (owner A).

### 3.10 Zones: routing and stock

- **Config (01a row A-1):** `zone_item_routes (zone_id, item_id, station_id)`, `zone_stock_items (zone_id, item_id, threshold)` in snapshot V4 `floors[].zones[].routes[]` / `.stock_items[]`. Zones are **flat** (01a v2.2). A table without a zone: no zone routes, no zone stock.
- **Routing:** the primary table's zone route for the item, else the branch route. Dine-in only.
- **Counts:** projection `zone_stock (zone_id, item_id, on_hand)` changed by `ZoneStockAdded` (+), `ZoneStockSet` (=), zone-served `ItemAdded` (−), `ItemRemoved` of a zone-served line (+, within the undo window). Voids (04) never change it.
- **Refill** `AddZoneStock { zone_id, item_id, quantity 1–500 }`: a zone item of that zone; for each of the item's day draws (`dayDraws`), `draw × quantity` leaves branch stock: short → `409 STOCK_INSUFFICIENT { stock_item_id, available }`; drafts `StockTransferredOut { stock_item_id, quantity, zone_id }` per draw (03a Q-5) + `ZoneStockAdded { zone_id, item_id, quantity, transfers }`. Needs an open day.
- **Count** `SetZoneStock { zone_id, item_id, on_hand 0–5 000 }` → `ZoneStockSet { zone_id, item_id, on_hand, previous }` (`transfers` none; 08 counts zone-served draws beyond transferred quantities, To 08).
- **Alerts:** a count that moves from above `threshold` to ≤ it raises `zone_stock_low` (dedupe `zone_low:<zone_id>:<item_id>`); a count reaching 0 raises `zone_stock_out` (dedupe `zone_out:<zone_id>:<item_id>`), even if the low alert is open. A count back above the threshold closes both `done`.

### 3.11 Token and business day

`orders.business_date` = the open day's `business_date`. Token per §3.2 step 9; unique `(business_date, token)`. A day closed and reopened the same date continues the numbering.

### 3.12 Device command queue

- **Queueable command types (client and hub):** `SubmitOrder`, `MarkServed` (02b), `RequestBill`, `CleanTable`, `CallWaiter` (02a). Nothing else is ever queued.
- **Device:** written to the queue (tablet SQLite in 9b's app; kiosk / phone IndexedDB) **before** the first send, with `command_id`, `queued_at` = the device's estimate of **hub time** (device clock + the offset from the last `hub_time` frame, 01a §4.5), `session_token`, `staff_id`. Replay in `queued_at` order. Removed on 2xx or 4xx; a 4xx goes to the **queue log** (what, when, why, "Discard", "Copy to a new order" — the copy mints new ids). "Order submitted" only after a 2xx (E5 AC4). Once a cart's command is queued, the cart is frozen; `ORDER_ITEM_ID_IN_USE { order_id }` for the device's own pending order means it was already accepted: refetch `seating-orders` and show it as sent.
- **Hub (00 row H-1, complete):** a replay sends `X-Queued-At: <queued_at>`. At 00 §3.7's session step, a session that has **ended** is accepted only when all hold: same device; `end_reason ∈ ('logout', 'idle_timeout', 'replaced', 'taken_over')` (never `forced`, `credentials_changed`); the staff is active in the directory; the command type is queueable; `started_at − 120 000 ≤ queued_at ≤ ended_at + 120 000` (hub facts, 2 min skew allowance); `now − queued_at ≤ queue_auto_send_max_ms` (branch setting, default 14 400 000). Else `401 SESSION_EXPIRED` as today, except the age rule → `409 QUEUED_COMMAND_EXPIRED { queued_at }`. Permission is read now. `processed_commands` stores the ended session's id. The hub appends `QueuedCommandAccepted { command_id, command_type, staff_id, queued_at }` (stream `audit`, no session ids); `OrderPlaced.sent_after_reconnect = true` (E-1) marks the order.
- **Drafts in progress** stay on the device per (device, staff) and survive restarts.

### 3.13 Totals

`seatingTotals(db, seating_id)` = Σ `billed_minor` (§3.4; pending weight = 0, return lines 0) over the lines of the seating's live orders, joined through 02a's `seating_orders` (P-1c). 1 statement.

### 3.14 Permissions and scopes

| Command | Permission | Scope check (C8, last) |
|---|---|---|
| `SubmitOrder` | `take-order` | dine-in: the table (`own_tables` = holder / assignee, `my_floors`, `branch`); takeaway / parking: none |
| `RemoveItems` | `take-order` | dine-in: the current table; takeaway / parking: `own_tables` and `my_floors` = placed by the person, `branch` = any |
| `SetLineWeight` | `set-line-weight` (new, B-1) | `branch` |
| `MarkServed`, `ReleaseItems` | `mark-served` | as `RemoveItems` |
| `BoostOrder` | `boost-order` | as `RemoveItems` |
| `ReturnToKitchen` | `mark-item-returned` | as `RemoveItems` |
| `CompLine` | `apply-comp` (approvable) | `branch` |
| `AddZoneStock`, `SetZoneStock` | `manage-zone-stock` (new, B-2) | `my_zones` (B-3) or `branch` |
| query `order-contact` | `mark-served` | as `RemoveItems` |

B-4 adds `own_tables` to the scope sets of `take-order`, `boost-order`, `mark-item-returned` (01b `PERMISSION_SCOPES`). Defaults by `default_key` (README :185, R29 re-seed): owner, manager: all, `branch`; cashier: `set-line-weight`, `apply-comp` (approval by manager); order_taker: `take-order`, `mark-served`, `mark-item-returned`, `boost-order` (`own_tables`), `apply-comp` (approval by manager), `manage-zone-stock` (`my_zones`); waiter: `mark-served` (`own_tables`), `manage-zone-stock` (`my_zones`). All editable (config).

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | registry (`approvable`), writer, projections, catch-up, audiences, `StaffDirectory.resolve` (audiences), `staff_sessions`, `clock`, `ids`, M19 | everything |
| 01a | `branchConfig()` (V4 + A-1), `openDayStartMs`, `BusinessDayOpened` / `BusinessDayClosed`, `item_availability`, `hub_time`, settings `queue_auto_send_max_ms`, `zone_undo_ms`, `slow_item_threshold_ms` (A-1) | §3 |
| 01b | `resolve`, scopes incl. `my_zones` (B-3), `own_tables` / `my_floors` for placed orders (B-4) | §3.14 |
| 01c | `ItemAdded` v1 (+ `served_from_zone_id`, row C-1), `menu-lines.ts` | §3.2, §3.4–§3.6, §3.9 |
| 01d | `defineAlertKind`, `alerts.*`, `APPROVAL_TIER_STEPS` | §3.8–§3.10 |
| 02a | `seatingOf`, `currentTableOf`, `requireLock` (P-1b), `zoneOf`; tables `seating_orders`, `seatings` read-only in joins (P-1c) | §3.2, §3.3, §3.13 |
| 03a | as §2; `ItemServed.source` `'zone'` (Q-6), `ItemRemoved.units` (Q-4), `StockTransferredOut` (Q-5), re-key (Q-7) | §3.2–§3.10 |
| 04 | `ItemVoided { …, refund_minor }`; calls `lineChangeDrafts` | §3.4, §3.13 |
| 05 | `OrdersBilled { order_ids }` | §3.3 |
| 03b | `Handover` (estimate, when built) | §3.7 |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `seatingTotals(db, seating_id)` | `{ total_minor, order_count }` | 1 | 02a handover card, 05 |
| `lineChangeDrafts(tx, order_id, changes)` | `EventDraft[]` (`OrderCancelled`, comp-request closes) | 2 | 04 voids |
| `lineShares(line)` | `{ next_share_minor(n), comped_take_back_minor(n) }` (§3.4, pure) | 0 | 04, 05 |
| `orderLines(db, order_ids[])` | `Map<order_id, LineView[]>` (`order_item_id, name, units, live_units, comped_units, comp_minor, removed_minor, refund_minor, line_total_minor, billed_minor, served_at, zone_served`) | 1 | 03b, 04, 05 |
| `ordersOf(db, seating_id)` | `OrderView[]` | 1 | 05 |
| Events, projection, kinds, queries, catch-up | §6.19, §5, §6.12–6.13, §6.14–6.18 | — | all |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 03b | Print and show the takeaway `token` big on ticket and Ready card; parking "PARKING LEB 1234 · SEDAN"; **`order_note` and `kitchen_note` verbatim on the ticket** (E0-ORD AC2); zone-served lines never print or show on KDS; no COMP marker on the kitchen ticket; RETURN marker (03a); a CANCELLED slip when a fired line is removed (O16); write `Handover` for the estimate. |
| 04 | `ItemVoided` carries `refund_minor` computed with §3.4's ledger (`lineShares`, comped units last; additive, R29); every void calls `lineChangeDrafts`; voids never change zone counts; 03a §12.3 Q12 is 04's. |
| 05 | `OrdersBilled { order_ids }` when a bill of orders without a seating closes; bill lines from `orderLines` / `ordersOf`; `billed_minor` per line; a comped share shows at its value with a COMP label and is subtracted (owner A, C4); return lines never billed; refuse bill close while a weight is pending; list open `comp` requests at day close (`alerts.listOpen`). |
| 08 | Zone-served lines' `stock_draws` left branch stock at refill (`StockTransferredOut`) up to the transferred quantity; count draws beyond it (zones stocked by Count). |

### 4.4 Shared types

`OrderType = 'dine_in' | 'takeaway' | 'parking'` (03a also has `delivery`; refused with `422 VALIDATION_FAILED` path `order_type` until P2). `CarType = 'sedan' | 'mini' | 'large'`. `CompReasonCode` = the branch's chip codes (01a A-1) or `'other'`.

### 4.5 Changes to other specs (R26) — **Proposed, applied on approval**

| Row | Spec → version | Change | Cost (R29) |
|---|---|---|---|
| F-1 | Foundation v1.10 → v1.11 | §4.4 CANCELLED = every line removed or voided; §4.2 remove = `take-order` + the lock (not "adder"), fired-not-started included (O16), zone-served lines removable within `zone_undo_ms`; Served guard: from any fired stage, never from unfired `added` (O16); §4.3 D39 list adds release, boost, return, comp, weight, zone stock; §5.9 step 4 → 02a `requireLock`; step 10 → 02b §3.2 step 11; step 11: KDS gets 03a station frames, not `ItemAdded` | text only |
| H-1 | 00 v1.7 → **v1.8** | §3.7 session step: queued acceptance (§3.12, all conditions); header `X-Queued-At`; `processed_commands.session_id` = the ended session; event `QueuedCommandAccepted` (stream `audit`); code `QUEUED_COMMAND_EXPIRED`; queueable list registered by modules (`defineCommand({ queueable: true })`) | 1 pipeline branch + 1 event + tests; ships before 01e's 00 bump; README :16 |
| A-1 | 01a v2.2 → v2.3 | `zone_item_routes`, `zone_stock_items` (nested replace-lists on the zone route); snapshot **V4** gains `zones[].routes[]`, `zones[].stock_items[]` (V4 unbuilt: same release, R29); branch settings `queue_auto_send_max_ms` (14 400 000), `zone_undo_ms` (300 000), `slow_item_threshold_ms` (900 000, E2-SOLD AC2), `served_estimate_ms` (when 03b); comp reason chips list | 2 tables, 1 migration, admin routes, V4 fields |
| B-1–B-4 | 01b v1.6 → v1.7 | B-1 `set-line-weight` (group `orders`, `branch`); B-2 `manage-zone-stock` (group `orders`, `branch`, `my_zones`); B-3 scope `my_zones` = zones assigned to the person **or to their lead** (`reports_to`) (B-2 data; CHECK expand migration); B-4 `own_tables` added to `take-order`, `boost-order`, `mark-item-returned`; `own_tables` and `my_floors` cover non-table orders with `placed_by` = the person; defaults by `default_key` | 2 catalogue rows, 1 scope, migration, re-seed |
| C-1 | 01c v1.1.1 → v1.1.2 | `ItemAdded` + `served_from_zone_id: string \| null` (additive) | schema field |
| P-1–P-1e | 02a v1.0 → v1.1 | P-1: `tables` folds `LineWeightSet`, `LineComped` (activity only); P-1b: `requireLock(…, { queued: true })` never takes a free lock; P-1c: tables `seating_orders`, `seatings` listed read-only for joins; P-1d: `served_any` ignores `ItemServed.source = 'zone'`; P-1e: 02a :250 "every edit calls `requireLock`" → only submit and remove (O9) | fold lines + text |
| Q-3–Q-7 | 03a v1.1 → **v1.2** (one bump with the engine lane's as-built, G1-1) | **Q-3 (code change):** `foldItemAdded` returns state unchanged, with no diagnostic, for an `ItemAdded` with `served_from_zone_id` set (today `apply-event.ts:436` throws `line_not_listed`, logged at warn per raita); `foldOrderPlaced` with empty `order_item_ids` creates no `EngineOrder` (today `:325-344` does). **Q-4:** `ItemRemoved { order_item_id, units? }` (absent = whole line); fold through the partial-void unit path; `stockEffects(ItemRemoved)` releases the units' share (`stock.ts:465-477` share path) instead of `lineReleases(line)` (`:459-462`). **Q-5:** `StockTransferredOut { stock_item_id, quantity, zone_id }` folded as a negative `StockAdded` (clamped, breach logged). **Q-6:** `ItemServed.source` adds `'zone'` (engine: no-op, lines not in the engine). **Q-7:** the engine folds 02a's `SeatingSplit` / `TablesMerged` and re-keys the moved orders' `table_key` to `'dine_in:' + new seating_id`; replay reads those two `table` event types | engine: ~4 folds + tests; `ENGINE_STATE_VERSION` unchanged (no state shape change) |
| E-1 | 03a v1.2 (same bump) | `OrderPlaced` additive: `business_date`, `token`, `customer_name`, `phone`, `car_number`, `car_type`, `order_note`, `sent_after_reconnect` | schema fields |

### 4.6 Carried rows (README) and where they land

:162 → §3.12; :163 → §8; :175 → §8; :176 → §6.14–§6.18; :178, :179 → §8; :180, :181, 01a §4.4 → §3.1, §3.2, §8; :185 → §3.14; :200 → O2; :201 → §12.4; :202 → §3.6; :203, :204, 01c §4.4 → §3.2, §8; :214 → none on the hub; :218, :220 → §3.9, §6.12; :222 → §8; :230 → §3.2–§3.8, §6.14; :231 → §3.2, §3.5, §3.12, §4.2, §4.5 P-1.

---

## §5. Data model (hub SQLite)

Migration `apps/hub/src/db/migrations/NNNN_orders.sql`, next free number at build time.

```sql
CREATE TABLE orders (
  order_id        TEXT PRIMARY KEY,
  order_type      TEXT NOT NULL CHECK (order_type IN ('dine_in','takeaway','parking')),
  table_key       TEXT NOT NULL,
  business_date   TEXT NOT NULL,
  token           INTEGER,                               -- takeaway only
  car_number      TEXT, car_type TEXT CHECK (car_type IN ('sedan','mini','large')),
  customer_name   TEXT, phone TEXT, order_note TEXT,
  placed_by       TEXT NOT NULL,                         -- envelope actor_id
  placed_at       INTEGER NOT NULL,                      -- recorded_at
  follow_up       INTEGER NOT NULL CHECK (follow_up IN (0,1)),
  cancelled_at    INTEGER,
  billed_at       INTEGER,                               -- OrdersBilled (non-table only)
  day_closed_at   INTEGER,                               -- BusinessDayClosed, finished orders only
  sent_after_reconnect INTEGER NOT NULL DEFAULT 0 CHECK (sent_after_reconnect IN (0,1))
);
CREATE UNIQUE INDEX orders_token ON orders (business_date, token) WHERE token IS NOT NULL;   -- token MAX
CREATE INDEX orders_open ON orders (order_type, placed_at)
  WHERE billed_at IS NULL AND cancelled_at IS NULL AND day_closed_at IS NULL;              -- open-orders, catch-up

CREATE TABLE order_lines (
  order_item_id   TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL,
  parent_order_item_id TEXT,
  line_kind       TEXT NOT NULL CHECK (line_kind IN ('item','option_child','deal','deal_part')),
  item_id TEXT, deal_id TEXT, name TEXT NOT NULL,
  sale_unit       TEXT NOT NULL,
  quantity        INTEGER,                               -- NULL while weight pending
  units           INTEGER NOT NULL,                      -- §3.4
  line_total_minor INTEGER,                              -- copy; LineWeightSet
  removed_units INTEGER NOT NULL DEFAULT 0, removed_minor INTEGER NOT NULL DEFAULT 0,
  voided_units  INTEGER NOT NULL DEFAULT 0, refund_minor  INTEGER NOT NULL DEFAULT 0,
  comped_units  INTEGER NOT NULL DEFAULT 0, comp_minor    INTEGER NOT NULL DEFAULT 0,
  returned_units INTEGER NOT NULL DEFAULT 0,
  return_of       TEXT,                                  -- return lines (money 0)
  served_from_zone_id TEXT,
  added_at        INTEGER NOT NULL,                      -- zone undo window
  served_at       INTEGER,
  served_source   TEXT CHECK (served_source IN ('tap','estimated','zone')),
  kitchen_note    TEXT,
  CHECK (removed_units + voided_units + returned_units <= units),
  CHECK (comped_units <= units - removed_units - voided_units - returned_units),
  CHECK (comp_minor + removed_minor + refund_minor <= COALESCE(line_total_minor, 0))
);
CREATE INDEX order_lines_order ON order_lines (order_id);                                  -- every per-order read

CREATE TABLE zone_stock (
  zone_id TEXT NOT NULL, item_id TEXT NOT NULL,
  on_hand INTEGER NOT NULL CHECK (on_hand >= 0),
  PRIMARY KEY (zone_id, item_id)
);
```

- **One projection `orders`** (with `reset`) writes these three tables and **reads only its own events**: `OrderPlaced`, `ItemAdded`, `OrderLinesAdded`, `ItemRemoved`, `ItemVoided`, `ItemReturned`, `ItemServed`, `LineWeightSet`, `LineComped`, `OrderCancelled`, `OrdersBilled`, `BusinessDayClosed` (with the order's own lines), `ZoneStockAdded`, `ZoneStockSet`. No fold reads another projection (02a T19); dine-in billing is read at query time (§3.3). Replay identity holds in any registration order (test 28).
- Times are `recorded_at`. No session ids.

---

## §6. Commands, events and queries

**Common rules.** `POST /commands/:name`, `sessionKind: 'device'`, staff session, D32 idempotency, no PIN. Responses `200 { data: { command_id, event_ids, result } }`; only `result` is listed. Dine-in commands carry `seating_id` (required) and follow 02a's `TABLE_SEATING_CHANGED` rule. Scope last (C8). Edits resolve the table by `currentTableOf`. Statement counts exclude 01d's own bounds and the append.

### 6.1 `SubmitOrder` (queueable)

| | |
|---|---|
| Permission | `take-order` |
| Payload | `{ order_id, order_type, table_id?, seating_id?, takeaway?: { customer_name?, phone? }, parking?: { car_number, car_type, phone? }, order_note?: ≤ 200, lines: [{ order_item_id, item_id? \| deal_id?, variant_id?, quantity?: int, options?: [{ option_id, quantity, order_item_id? }], deal_choices?: [{ deal_part_id, item_id, order_item_id, options? }], kitchen_note?: ≤ 80, from_zone?: boolean }] (1–40) }` |
| Script | §3.2 |
| Result | §3.2 step 11 |
| Statements | §3.2 (7 + append) |
| Errors | `BUSINESS_DAY_NOT_OPEN`, `TABLE_SEATING_CHANGED`, `TABLE_ALREADY_LOCKED`, `TABLE_NEEDS_CLEANING`, `ORDER_ITEM_ID_IN_USE`, `MENU_ITEM_NOT_FOUND`, `DEAL_NOT_FOUND`, `ITEM_UNAVAILABLE`, `ITEM_OUT_OF_HOURS`, `OPTION_CHOICE_INVALID`, `ZONE_STOCK_EMPTY`, `STATION_PAUSED`, `ITEM_SOLD_OUT`, `QUEUED_COMMAND_EXPIRED`, `PERMISSION_DENIED`, `VALIDATION_FAILED` |

### 6.2 `RemoveItems`

`{ order_id, seating_id? (required for dine-in), lines: [{ order_item_id, units? }] (1–40, unique) }`; `take-order`; dine-in: `requireLock`. §3.5. Result `{ removed: [{ order_item_id, units }], cancelled: boolean, comp_requests_closed: alert_id[] }`. Statements: 1 order + lines, 1 seating / lock (dine-in), 1 open comp requests (`byDedupeKey` over the line keys). Errors: `ORDER_NOT_FOUND`, `ITEM_WRONG_STAGE`, `DEAL_PART_NOT_REMOVABLE`, `ORDER_BILLED`, lock errors.

### 6.3 `SetLineWeight`

`{ order_item_id, quantity }`; `set-line-weight`. §3.6. Result `{ line_total_minor }`. Statements: 1. Errors: `ORDER_NOT_FOUND`, `LINE_NOT_WEIGHED`, `LINE_ALREADY_SETTLED`, `ORDER_BILLED`.

### 6.4 `MarkServed` (queueable)

`{ lines: [{ order_id, order_item_ids }] (1–20 orders) }`; `mark-served`; no lock. §3.7. Result `{ served: n, skipped: order_item_id[] }`. Statements: 1 (orders + lines). Errors: `ORDER_NOT_FOUND`, `ITEM_WRONG_STAGE`.

### 6.5 `ReleaseItems`

`{ order_ids, released, expedite }` (sets, C1); `mark-served`. §3.8. Result `{ alerts_closed: n }`. Statements: 1 (orders for scope). Errors: `ORDER_NOT_IN_ENGINE`.

### 6.6 `BoostOrder`

`{ order_id }`; `boost-order`. Statements: 1. Errors: `ORDER_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`.

### 6.7 `ReturnToKitchen`

`{ order_item_id, return_order_item_id, mode }` (03a :500; device-minted id, O3); `mark-item-returned`. §3.8. Result `{ eta_ms, promise_ms }`. Statements: 1. Errors: `ORDER_NOT_IN_ENGINE`, `RETURN_ALREADY_OPEN`, `ITEM_WRONG_STAGE`, `ORDER_ITEM_ID_IN_USE`.

### 6.8 `CompLine`

`{ order_item_id, units, reason_code, note?: ≤ 120 }`; `apply-comp`, `approvable: true`; online only. §3.9. Result `{ comped: true, value_minor } | { alert_id, pending: true }`. Statements: 1 (line + children) + 01d. Errors: `ORDER_NOT_FOUND`, `COMP_NOT_ALLOWED`, `COMP_PENDING`, `LINE_WEIGHT_PENDING`, `ORDER_BILLED`.

### 6.9 `AddZoneStock` / 6.10 `SetZoneStock`

§3.10. `manage-zone-stock`, scope `my_zones` on the zone. Results `{ on_hand }`. Statements: 1 (count). Errors: `ZONE_NOT_FOUND`, `ZONE_ITEM_NOT_CONFIGURED`, `STOCK_INSUFFICIENT`, `BUSINESS_DAY_NOT_OPEN` (refill).

### 6.11 Tick `served_estimate`

Registered with 03b's `Handover` (O14, §3.7); text kept for then.

### 6.12 Kind `comp`

```typescript
defineAlertKind({
  kind: 'comp', family: 'action', subject: 'order',
  steps: APPROVAL_TIER_STEPS,
  closes_on: 'owner',                          // 02b closes stale ones 'obsolete' (§3.9); 05 at day close
  values_schema: z.object({ order_id: z.string().min(1), order_item_id: z.string().min(1),
                            units: z.number().int().min(1), reason_code: z.string().min(1) }),
  details_schema: AlertDetailsBase.pick({ item: true, quantity: true, amount: true, reason: true }),
  lead_fallback: false, expires_at_day_close: false, silent: false,
  labels: { card: 'alert.comp.card', lock: 'alert.comp.lock' },
  request: {
    answers: ['approve', 'reject'],
    right: { mode: 'approval', base_permission: 'apply-comp' },
    needs_pin: 'always',
    apply(ctx, answer),          // approve: re-check §3.9 → [LineComped { …, alert_id, approver_staff_id }]; reject → []
    onWithdraw: () => [],
  },
});
```

### 6.13 Kinds `zone_stock_low`, `zone_stock_out`

```typescript
defineAlertKind({
  kind: 'zone_stock_low',                      // 'zone_stock_out': same shape, card 'alert.zone_stock_out.card'
  family: 'info', subject: 'table',            // raised with { stream_type: 'table', stream_id: zone_id }
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],   // target { kind: 'managers' } (Z7)
  closes_on: 'owner',                          // 02b closes 'done' when the count goes back above threshold
  values_schema: z.object({ zone_id: z.string().min(1), item_id: z.string().min(1),
                            on_hand: z.number().int().min(0), threshold: z.number().int().min(0) }),
  details_schema: null, lead_fallback: false, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.zone_stock_low.card', lock: 'alert.zone_stock_low.lock' },
  request: null,
});
```

### 6.14 `GET /queries/eta-preview`

Staff session; `countsAsActivity: false`. Query `{ draft }` = JSON of a `SubmitOrder` payload without ids (temp `key`s), ≤ 8 KB, Zod-parsed (over → `400 VALIDATION_FAILED`). Runs §3.2 steps 4–8 read-only: `reserveStock` (pure, nothing appended) then `calculateETA(state, proposed, now, from_stock)`. Result `{ as_of_seq, groups: [{ promise_ms, keys }], lines: [{ key, eta_ms, from_stock, zone_served, refused?: { code, details } }] }`. Statements: 2 (availability, zone counts). p99 < 40 ms at 12 lines.

### 6.15 `GET /queries/seating-orders`

`{ seating_id }` → the seating's orders (current, P-1c), by `placed_at`: `{ order_id, placed_by: { staff_id, name }, placed_at, follow_up, cancelled, billed, has_phone, lines: LineView + stage (from `EngineState`), groups: [{ promise_ms }] }`, `total_minor`. Statements: 2.

### 6.16 `GET /queries/open-orders`

`{ order_type?: 'takeaway' | 'parking' | 'all', abandoned?: boolean }` → open non-table orders (`orders_open`; token / car, `has_phone`, ready n / m, promise, "from <date>"), by promise; `abandoned: true` (managers) adds orders of any type with no kitchen tap for `order_abandon_ms` (03a). Statements: 2.

### 6.17 `GET /queries/zone-stock`

`{ zone_id? }` → `[{ zone_id, name, items: [{ item_id, name, on_hand, threshold }] }]` in the caller's scope. Statements: 1.

### 6.18 `GET /queries/order-contact`

`{ order_id }`; `mark-served` with the order's scope; `countsAsActivity: true` (a deliberate tap). → `{ customer_name, phone }`. Logged `info { order_id, staff_id }` (no values). Statements: 1.

**Catch-up part `orders`:** all open orders of the branch (one statement) and their lines (one statement), contact fields stripped except for cashier kiosks and the placer's socket (O17), plus `zone_stock` (one statement).

### 6.19 Events (`schema_version` 1)

| Event | Stream | Payload | Fold |
|---|---|---|---|
| `OrderPlaced` | order | 03a §4.2 + E-1 | `orders` row |
| `ItemAdded` | order | 01c §4.3 + `served_from_zone_id` (C-1) | line; zone count − |
| `OrderLinesAdded` | order | 03a (returns only) | — |
| `ItemRemoved` | order | `{ order_item_id, units? }` (Q-4) | ledger §3.4; zone count + (zone line) |
| `ItemVoided` | order | 03a + `refund_minor` (04) | ledger |
| `ItemServed` | order | `{ order_item_ids, source: 'tap' \| 'estimated' \| 'zone' }` (Q-6) | `served_at`, `served_source` |
| `ItemReturned` | order | 03a | `returned_units` |
| `ItemsReleased`, `OrderBoosted` | order | 03a | — |
| `OrderCancelled` | order | `{ order_id }` | `cancelled_at` |
| `OrdersBilled` | order (first order_id) | `{ order_ids, bill_id }` (05) | `billed_at` |
| `LineWeightSet` | order | `{ order_item_id, quantity, line_total_minor }` | line |
| `LineComped` | order | `{ order_item_id, units, value_minor, reason_code, note \| null, alert_id \| null, approver_staff_id \| null }` (children cascade as separate `LineComped`s in the same batch) | ledger |
| `ZoneStockAdded` | table / zone_id | `{ zone_id, item_id, quantity, transfers: [{ stock_item_id, quantity }] }` | + |
| `ZoneStockSet` | table / zone_id | `{ zone_id, item_id, on_hand, previous }` | = |
| `StockTransferredOut` | stock | 03a Q-5 | 03a's |
| `QueuedCommandAccepted` | audit | 00 H-1 | — |

**Audiences** (no catch-all on `order`, 01d To 02). Each audience function resolves `socket.staffId` through `StaffDirectory.resolve` (in memory) when it needs a grant. `OrderPlaced` → staff sockets and cashier kiosks; `customer_name` and `phone` removed except for cashier kiosks and the placer's sockets (O17). `ItemAdded`, `ItemRemoved`, `ItemServed`, `OrderCancelled`, `LineWeightSet` → staff sockets and cashier kiosks (ids, names, quantities; no totals except to kiosks). `LineComped` → cashier kiosks and sockets whose staff hold `apply-comp`. `ZoneStock*` → sockets whose staff hold `manage-zone-stock`. KDS gets 03a / 03b station frames only.

**Size:** 10 commands + 3 kinds + 5 queries + 1 catch-up = **19** (the estimate tick is added with 03b).

---

## §7. Cross-cutting

| Item | Decision | Justification |
|---|---|---|
| Performance | `SubmitOrder` p99 < 60 ms (12 lines, peak engine); `eta-preview` < 40 ms; `seating-orders` < 30 ms | E2-ETA AC1 (≤ 1 s round trip on a cheap tablet) |
| Idempotency | D32; device ids; frozen cart | power cuts mid-rush (E5) |
| Races | single writer; ids, zone claims (per payload), token, stock, ledger inside `BEGIN IMMEDIATE`; CHECKs as a backstop | last Paye, last raita, double comp |
| Queue security | hub-side queueable list, `queued_at` bounded by the ended session, normal end reasons only | shared tablets (§3.12) |
| Logs | `order_id`, `command_type`, `order_type`, line count, `queued`; never names, phones, totals | privacy, disputes |
| Privacy | contact fields only to cashier kiosks, the placer, and `order-contact` (logged); they remain in the immutable log and the cloud (§12.3 Q1) | customer phone numbers |
| Boot | `orders` replays from checkpoint (00 M48) | no state outside events |

---

## §8. Client contract (`apps/client`, 01d's `/staff/` entry, ui-kit only)

- **Ordering screen** (inventory 02-S05): category rail, search, tiles (Sold out / Not now · hours / "4 left" / clock "25 min" when `slow_item_threshold_ms` is passed / "Only 2 left" caps the stepper, O15); cart sorted by ETA (E2-ETA AC2) with each group's promise as a clock time; options sheet with defaults visible and linked-option availability; kitchen note ≤ 80, order note ≤ 200; Hold (device draft); Send (freezes the cart). Preview via `eta-preview` per change (debounce 250 ms), refetched on `BranchConfigApplied`, stock frames, `stations_live`; "time updated" when a promise moves ≥ 60 s.
- **Zone items:** tile shows the zone count ("Raita · 6 here"); a tap adds or increments one `from_zone` line; `ZONE_STOCK_EMPTY` → the line becomes a kitchen line ("Zone empty — sent to kitchen"), once. Undo within `zone_undo_ms` from the table view; later, Count on the zone screen.
- **Types:** Dine-in (from the table map, 02a), Takeaway (name, phone optional → token big after Send), Parking (plate LTR mono, type icons, phone).
- **Table view (orders part):** rounds by time and person (E2-ADD AC4); stages in words; Mark served (fired lines only); Send what's ready; Boost; Return (fix / remake); Comp (units, reason chips) with the waiting card "Waiting for approval — Rs 450 comp" (01d AD-1); Remove (stage 1, units stepper); weight entry; "Call" on a parking order fetches `order-contact`.
- **Open orders:** takeaway by token, parking by plate; ready n / m; "from <date>"; abandoned list for managers.
- **Zone stock screen:** my zones, counts, Refill (+n), Count (= n); low / out highlighted.
- **Queue:** "Reconnecting… 2 orders waiting to send" (B02); queue log; Day not started → "Start day" for `OpenBusinessDay` holders, "Ask the manager to start the day" for others.
- **Rules:** buttons from effective permissions (R5); Urdu / English, Latin digits (R20); no service worker except the flagged kiosk; no secure-context APIs; ULIDs from `crypto.getRandomValues` (R14, R15); Capacitor LAN transport and token storage per 9b (README :163).

---

## §9. Error catalogue additions (Foundation §6.2, `@pos/domain/src/errors.ts`)

| Code | Status | `details` | When |
|---|---|---|---|
| `ORDER_NOT_FOUND` | 404 | `{ order_id }` | unknown order |
| `ORDER_ITEM_ID_IN_USE` | 409 | `{ order_item_id } \| { order_id }` | id already in use (O3) |
| `ITEM_UNAVAILABLE` | 409 | `{ item_id \| deal_id }` | manual Off, or a required group unsatisfiable |
| `ITEM_OUT_OF_HOURS` | 409 | `{ item_id, opens_at_ms \| null }` | outside a window (S47) |
| `ITEM_SOLD_OUT` | 409 | `{ item_id, available }` | `sold_out` line short of stock |
| `OPTION_CHOICE_INVALID` | 422 | `{ order_item_id, violations }` | `checkOptionChoices` |
| `ZONE_STOCK_EMPTY` | 409 | `{ zone_id \| null, item_id, on_hand }` | `from_zone` line not served by the zone |
| `ZONE_ITEM_NOT_CONFIGURED` | 422 | `{ zone_id, item_id }` | refill / count of a non-zone item |
| `STOCK_INSUFFICIENT` | 409 | `{ stock_item_id, available }` | refill transfer short |
| `DEAL_PART_NOT_REMOVABLE` | 409 | `{ order_item_id }` | remove a single deal part |
| `LINE_NOT_WEIGHED` | 409 | `{ order_item_id }` | weight on a non-weighed line |
| `LINE_WEIGHT_PENDING` | 409 | `{ order_item_id }` | comp on a pending weight |
| `LINE_ALREADY_SETTLED` | 409 | `{ order_item_id }` | weight change after a unit left billing |
| `COMP_NOT_ALLOWED` | 409 | `{ reason: 'not_live' \| 'return_line' \| 'deal_part' \| 'zone_line' }` | §3.9 |
| `COMP_PENDING` | 409 | `{ alert_id }` | an open comp request on the line |
| `ORDER_BILLED` | 409 | `{ order_id }` | edit after the bill closed |
| `QUEUED_COMMAND_EXPIRED` | 409 | `{ queued_at }` | defined by 00 v1.8 (H-1) |

Reused: `BUSINESS_DAY_NOT_OPEN`, `ORDER_NOT_IN_ENGINE`, `RETURN_ALREADY_OPEN`, `STATION_PAUSED`, `ITEM_WRONG_STAGE`, `MENU_ITEM_NOT_FOUND`, `DEAL_NOT_FOUND`, `ZONE_NOT_FOUND`, `TABLE_*` (02a), `SESSION_EXPIRED`, `PERMISSION_DENIED`, `VALIDATION_FAILED`.

---

## §10. Tests (`apps/hub/test/orders/*.test.ts`; client tests in `apps/client`)

| # | Area | Case |
|---|---|---|
| 1 | Submit | dine-in happy path: batch order exactly 03a :615; `table_key = 'dine_in:' + seating_id`; result groups with `promise_ms`, no `target_land_ms`; statement count §3.2 |
| 2 | Submit | each `line_kind` copies 01c §4.3 exactly (deal allocation 229 315 / 12 508 / 78 177; batch program cook times, B1); `order_note`, `kitchen_note` on the events |
| 3 | Submit | config applied between preview and submit → lines use the config at submit (D25) |
| 4 | Submit | no open day → `BUSINESS_DAY_NOT_OPEN`; nothing appended |
| 5 | Submit | id repeated in payload → `400`; id live / in projection → `409 ORDER_ITEM_ID_IN_USE` before append |
| 6 | Submit | Off / out of hours (hub time) / unsatisfiable group / linked option unavailable → each code |
| 7 | Submit | `sold_out` 0 < available < needed → `ITEM_SOLD_OUT { available }`; `cook_fresh` → full cook time; `planOrder` gets `from_stock` |
| 8 | Submit | paused station → `STATION_PAUSED` |
| 9 | Race | two submits on the last Paye: one `from_stock`, the other full cook time; stock never negative |
| 10 | Rounds | round 2 is a new order; `follow_up` true only after a non-zone served line; earlier promise unchanged (E2-ADD AC1) |
| 11 | Zone | route of the table's zone wins over the branch route; takeaway ignores zone routes |
| 12 | Zone | zone raita round: no `EngineOrder` (Q-3), **no engine diagnostic logged**, `isOrderInEngine` false; `ItemServed { source: 'zone' }`; table stays ORDERED / SEATED (P-1d); count − 1 |
| 13 | Zone | two raita lines of 4 with 6 left in one payload → first zone-served, second `ZONE_STOCK_EMPTY { on_hand: 2 }`, no 500; two submits on the last raita: one wins |
| 14 | Zone | refill with draws → `StockTransferredOut` per draw; short → `STOCK_INSUFFICIENT`; Count leaves branch stock; low alert at threshold, out alert at 0 while low is open; back above closes both |
| 15 | Zone | undo a zone raita within `zone_undo_ms` → count + 1; after → `ITEM_WRONG_STAGE`; `ReturnToKitchen` on it → `ITEM_WRONG_STAGE` |
| 16 | Token | 1, 2, 3 per business date; reopen same date continues; dine-in / parking null |
| 17 | Remove | 1 of 4 from-stock naan: `ItemRemoved { units: 1 }`, `StockReleased` = one share (Q-4), the 3 left consume at Start |
| 18 | Remove | remove every line → `OrderCancelled` in the batch; fired-not-started line removable (O16); started → `ITEM_WRONG_STAGE`; deal part alone → code; lock by another → `TABLE_ALREADY_LOCKED`; dine-in without `seating_id` → `400` |
| 19 | Ledger | **comp 2 then remove 2** of 2 naan → `comp_minor` 0, `removed_minor` 20 000, total ≥ 0; **remove 1 then void 2** (fixture `ItemVoided` with `lineShares`) → refunds = remaining shares, total 0; **comp then weight** on a g/ml line → `LINE_ALREADY_SETTLED` |
| 20 | Ledger | property test: 1 000 random sequences of comp / remove / void / weight over piece, g, deal, option-child lines → CHECKs hold, Σ billed = Σ line totals − Σ out shares, never negative (as 01c #119) |
| 21 | Weight | pending → `LineWeightSet` from the copy; correction allowed; non-weighed → code |
| 22 | Served | lines of 2 orders: one `ItemServed` per order, `stockEffects` array form, from-stock line with no Start consumes (AD-29 Q7); repeat → skipped; **unfired line → `ITEM_WRONG_STAGE`, nothing written** |
| 23 | Scope | takeaway served / removed / boosted by its placer with `own_tables` → allowed; by another order taker → `outside_scope`; `my_floors` same; `branch` any |
| 24 | Release | resolved alert closed `done` via `closeMany`; no extra read; another party's alert untouched after a split (Q-7) |
| 25 | Return | 03a #101, #103, #107, #114 command halves: `planOrder` groups present, money 0, `return_of`, `cook_ms_override` on fix, `ItemReturned` on remake, second → `RETURN_ALREADY_OPEN`, exited → `ORDER_NOT_IN_ENGINE` |
| 26 | Comp | allowed → `LineComped` with the next shares and child cascade; approval → kind raised with `approver_role_ids`, approve → `LineComped { alert_id, approver_staff_id }`, reject → nothing; second → `COMP_PENDING`; `apply` read-only; registry passes `requires_approval` (`approvable`) |
| 27 | Comp | pending comp on 2 of 3, then remove 2 → request closed `obsolete`, requester told, new comp allowed |
| 28 | Replay | live projection = replayed projection over a fixture day, with `orders` registered before and after `tables` (no cross-projection fold) |
| 29 | Grouping | merge T5 into T4: T5's order in T4's `seatingTotals`, `seating-orders`, `follow_up`; billed read from 02a `seatings` |
| 30 | Day close | close with a cooking takeaway → still on open-orders "from <date>"; finished ones leave; `OrdersBilled` sets `billed_at` |
| 31 | Queue hub | `X-Queued-At` replay of a `logout` / `idle_timeout` / `taken_over` session's submit → accepted in that name, `QueuedCommandAccepted`, `sent_after_reconnect`; `forced` / `credentials_changed` / left staff / revoked device → 401; `CompLine` with an ended token → 401; `queued_at` after `ended_at` + 2 min → 401; older than the limit → `QUEUED_COMMAND_EXPIRED`; free lock not taken (P-1b) |
| 32 | Privacy | a waiter's socket never receives `phone` / `customer_name` (push and catch-up); the placer and the kiosk do; `order-contact` logs without values |
| 33 | Queries | `eta-preview` appends nothing, uses `from_stock` (stock lines not long), `countsAsActivity: false`; statement counts of §6.14–6.18 and catch-up asserted |
| 34 | Perf | `SubmitOrder` p99 < 60 ms, `eta-preview` p99 < 40 ms at 12 lines on the peak fixture (E2-ETA AC1) |
| 35 | Client | queue: stored before first send; replay in `queued_at` order (E5 AC2); no "sent" before 2xx; 4xx in the log; frozen cart; own pending `ORDER_ITEM_ID_IN_USE` shown as sent; drafts survive reload |
| 36 | Client | stepper capped; zone-empty flip; slow chip from `slow_item_threshold_ms`; sold-out update from the stock frame within 5 s (E2-SOLD AC3); day-not-started per permission; cart sorted by ETA; table view rounds by time |

### Acceptance

| Story AC | Tests |
|---|---|
| E2-TBL AC9 (dine-in, takeaway, parking) | 1, 16 |
| E2-ADD AC1–AC4 | 10, 1, 36 |
| E2-ETA AC1–AC6 | 34, 36, 7, 33, 1 |
| E2-SOLD AC1–AC3 | 6, 7, 36 |
| E0-ORD AC1 — **partial** (device only; manager view §12.4); AC2 | 35, 2 (printing: 03b) |
| E0 comps AC3, AC4 (stage 1), AC5 | 26, 18, 27 |
| E5-DEV AC1–AC4 | 31, 35 |
| Z3–Z5, Z7 | 11–15 |
| Owner Q4 token, Q6, Q7, Q8; 02b Q1–Q6 | 16, 26, 22–23, 31; 14, 26, 17, 4, 11, 23 |

---

## §11. Build order (one task per commit, TDD)

1. Errors §9 → `errors.ts`, F §6.2 append (no bump, R34).
2. Event schemas: E-1, C-1 additive fields; `OrderCancelled`, `OrdersBilled`, `LineWeightSet`, `LineComped` (`packages/events/src/events/order/`); `ZoneStockAdded`, `ZoneStockSet` (`…/table/`).
3. Migration §5; projection `orders` with `reset` (tests 28, 29).
4. Ledger (`apps/hub/src/orders/ledger.ts`, pure; `lineShares`) (19, 20).
5. `buildProposedOrder` + zone routing (pure) (2, 3, 6, 11).
6. `SubmitOrder` (1, 4, 5, 7, 8, 9, 10, 16).
7. Zone-served path in submit (12, 13) — needs 03a Q-3, Q-6, 02a P-1d.
8. `eta-preview` (33).
9. `RemoveItems` + `lineChangeDrafts` (17, 18, 15) — needs 03a Q-4.
10. `SetLineWeight` (21).
11. `MarkServed` (22, 23).
12. `ReleaseItems`, `BoostOrder` (24) — Q-7 for the split case.
13. `ReturnToKitchen` (25).
14. `CompLine` + kind `comp` (26, 27).
15. `AddZoneStock`, `SetZoneStock`, zone kinds (14) — needs 01a A-1, 03a Q-5.
16. Exports §4.2 (29).
17. Queries §6.15–6.18, catch-up, audiences (32, 33).
18. Hub queued acceptance (31) — needs 00 H-1, 02a P-1b.
19. Client: queue and drafts (35).
20. Client: ordering screen, options sheet, preview (36).
21. Client: table view orders part, comp card, zone stock, open orders, contact.
22. Perf (34); acceptance pass; README rows closed.

---

## §12. Definition of Done, checklist, questions, deferred, reviews

### 12.1 Definition of Done

All §10 tests green under the gate; §4.5 rows approved and applied first (F v1.11, 00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 02a v1.1, 03a v1.2); every command cites its section; statement counts asserted; README index and carried rows updated.

### 12.2 Endpoint checklist

| # | Endpoint | Permission | Section | Tests |
|---|---|---|---|---|
| 1 | `submit-order` | take-order | 6.1 | 1–16 |
| 2 | `remove-items` | take-order | 6.2 | 15, 17, 18, 19 |
| 3 | `set-line-weight` | set-line-weight | 6.3 | 19, 21 |
| 4 | `mark-served` | mark-served | 6.4 | 22, 23 |
| 5 | `release-items` | mark-served | 6.5 | 24 |
| 6 | `boost-order` | boost-order | 6.6 | 23 |
| 7 | `return-to-kitchen` | mark-item-returned | 6.7 | 25 |
| 8 | `comp-line` | apply-comp | 6.8 | 26, 27 |
| 9 | `add-zone-stock` | manage-zone-stock | 6.9 | 14 |
| 10 | `set-zone-stock` | manage-zone-stock | 6.10 | 14 |
| 11 | kind `comp` | — | 6.12 | 26, 27 |
| 12 | kind `zone_stock_low` | — | 6.13 | 14 |
| 13 | kind `zone_stock_out` | — | 6.13 | 14 |
| 14 | `eta-preview` | staff | 6.14 | 33, 34 |
| 15 | `seating-orders` | staff | 6.15 | 29, 33 |
| 16 | `open-orders` | staff | 6.16 | 30, 33 |
| 17 | `zone-stock` | staff | 6.17 | 33 |
| 18 | `order-contact` | mark-served | 6.18 | 32 |
| 19 | catch-up `orders` | staff | 6.18 | 28, 32 |

### 12.3 Open questions

| # | Question | Default until answered |
|---|---|---|
| Q1 | (owner) A customer's phone and name are kept in the order history for ever and copied to the cloud. OK, or should 02b keep only a masked number in history? | kept (needed to call cars and to trace disputes) |
| Q2 | Can a comp be undone before the bill? | no; 05 handles a wrong comp at the bill |

### 12.4 Deferred until needed

Delivery and web types; later child additions ("one more naan" attached) with README :201's rule; reorder; kitchen-note edit after submit; manager view of held orders; sibling-zone transfer (Z6), day-end zone recount prompt (Z8), nested zones and floor routes; estimated Served (with 03b); hub-down manager alert (06 / 01e); customer tracking (P2).

### 12.5 Hostile self-review (v0.3)

- **Money:** one ledger for comp, remove and void; CHECKs and a property test; 04 bound to it (To 04).
- **Engine reality:** Q-3, Q-4 stated against the code on `module-03a` (`apply-event.ts`, `stock.ts`) with their cost; `planOrder` / `calculateETA` with `from_stock`.
- **Queue:** hub-side queueable list and `queued_at` bounds close the shared-tablet path; H-1 complete (pipeline step, stored session, audit event).
- **Replay:** the projection reads only its own events.
- **Known dependency risks:** §11 steps 7, 9, 12, 15, 18 wait on 03a v1.2, 01a v2.3, 00 v1.8, 02a v1.1; the Android queue needs 9b's app.
- **YAGNI:** no copies nobody reads, no `preview_seq`, no tick before 03b, no return note.

### 12.6 G4 run 1 closure (`02b_v0.2_hostile_run1.md`)

| # | Fix |
|---|---|
| 1 | §3.4 money ledger, CHECKs, `LINE_ALREADY_SETTLED`, `lineShares`, To 04; tests 19, 20 |
| 2 | Q-3 as a costed code change (`foldItemAdded`, `foldOrderPlaced`); test 12 |
| 3 | `ItemServed.source 'zone'` (Q-6), 02a P-1d, `follow_up` ignores zone serves; tests 10, 12 |
| 4 | Q-4 covers schema, fold and `stockEffects` share; test 17 |
| 5 | Zones flat (O4, §3.10); nesting deferred; old Q1 removed |
| 6 | Zone claims across the payload (§3.2 step 5); test 13 |
| 7 | Stale comp requests closed `obsolete` (§3.9); `expires_at_day_close: false`; test 27 |
| 8 | H-1 complete: `X-Queued-At`, hub-time `queued_at`, bounds, end reasons, stored session, `QueuedCommandAccepted`, `OrderPlaced.sent_after_reconnect`; test 31 |
| 9 | Hub-side queueable list; `queued_at ≤ ended_at` + 2 min; test 31 |
| 10 | O16: Served needs a fired line; remove = stage 1 per F incl. fired (CANCELLED slip, 03b); F-1 updated; tests 18, 22 |
| 11 | O17 contact only to kiosk and placer, `order-contact` query, §12.3 Q1 for the owner; test 32 |
| 12 | Day close only for finished orders (§3.3); test 30 |
| 13 | B-3 `my_zones` = person's or lead's zones |
| 14 | B-4 scope sets; non-table rule for `my_floors`; test 23 |
| 15 | No cross-projection fold; dine-in billed read at query time; test 28 |
| 16 | O18 / 03a Q-7 re-key on split and merge; `ReleaseItems` closes only resolved alerts; test 24 |
| 17 | Step 10 names the alert drafts, not an event |
| 18 | `planOrder(…, from_stock)`, preview with `reserveStock`; `corrected` on the client; `preview_seq` dropped |
| 19 | `ReturnToKitchen` calls `planOrder`; no note |
| 20 | `ReleaseItems` uses `planRelease`'s `alert_id` and `closeMany` |
| 21 | Statement counts per command, catch-up in fixed statements |
| 22 | `ORDER_NOT_FOUND` new; repeated payload id → 400 |
| 23 | Rows C-1, E-1 in 03a v1.2, F-1 step 11, 02a P-1e; §7 justification fixed |
| 24 | `approvable: true`; zone kinds written in full; `zone_stock_out` |
| 25 | Comp cascades to option children; deal units = quantity |
| 26 | Zone undo window; `ReturnToKitchen` refuses zone lines |
| 27 | `seating_id` required for dine-in edits |
| 28 | Audiences resolve grants through `StaffDirectory.resolve` |
| 29 | Frozen cart; own pending id shown as sent; Copy mints ids |
| 30 | Tests 34–36, To 03b notes, `slow_item_threshold_ms` (A-1), acceptance renumbered |
| 31 | Copies, `preview_seq`, stub tick removed |
| 32 | `transfers` per change; To 08 counts beyond transferred |
