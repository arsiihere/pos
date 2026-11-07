# 02b Ordering — Module Spec

| | |
|---|---|
| Doc | Module spec, **v0.1 — DRAFT** (developer as the owner's proxy, 2026-11-07). Next: G2 completeness, then hostile runs in fresh sessions (`docs/reviews/02b_*`). |
| Depends on | Foundation **v1.10**, 00 Hub Platform & Access **v1.7**, 01a Restaurant Setup **v2.2**, 01b Staff & Roles **v1.6**, 01c Menu Variants **v1.1.1**, 01d Notifications & Requests **v1.2**, **02a Tables v1.0**, **03a Timing Engine v1.1** |
| Inherits | Shared Standards from Foundation v1.10 §6 (envelopes, codes, ids, time, money, events, logging, migrations, tests). Not redefined here. |
| Inputs | `docs/stories/02b-g0.md` (G0, owner answers §5.4), `docs/stories/02b-g1-decisions.md` (G1-1–G1-20), `docs/stories/02-g0.md` §5.4 (owner's cut), `01d-g0-decisions.md` Z1–Z8, C1–C4, G0-4, G0-6; 03a build branches' carried rows (AD-17, AD-19, AD-29, AD-30). |
| Rigor | T2 (CLAUDE.md). |

### Changelog

| Version | Change |
|---|---|
| v0.1 | First draft from G0 + G1. |

---

## §1. Header

### 1.1 Stories covered

E2 "Table management and order types" AC9 (dine-in, takeaway, parking; delivery and web deferred), E2 "Adding items to a running order" AC1–AC4, E2 "Per-item ETA preview" AC1–AC6, E2 "Sold out and slow items" AC1–AC3, E0 "Hold/park, notes, reorder, reprint" AC1–AC2 (hold, notes), E0 "Refunds, cancellations, complimentary items" AC3 (comps) and AC4 for stage 1, E5 "Device resilience during hub restart" AC1–AC4 and its edge case "order in progress preserved", 01d-g0 Z3–Z5, Z7 (zone routing, zone stock, refill, threshold), C2–C3 (comps), G0-6 (Served by tap), owner 02-g0 §5.4 Q4 (token), Q5, Q6, Q7, Q8.

### 1.2 In scope

Orders and lines (`SubmitOrder`, rounds, `follow_up`, ids), the `ItemAdded` copy and `ProposedOrder`, availability / windows / stock / pause / option checks, zone routing at submit, zone-served lines, stage-1 removal (whole or partial) and `OrderCancelled`, weighed lines, Served by tap (estimated Served specified, stubbed until 03b), `ReleaseItems`, `BoostOrder`, `ReturnToKitchen`, comps (command, event, approval kind), zone stock (counts, refill as a transfer, set count, low / out alert), takeaway token, parking fields, order notes, `seatingTotals`, the device command queue (hub acceptance rules and the client queue), the ordering screen, the orders part of the table view, open orders (incl. abandoned), held orders (device-local).

### 1.3 Out of scope

Delivery and web order types (P2 / P4, §12.4); later child additions to a submitted parent (§12.4); reorder (§12.4); editing a kitchen note after submit (§12.4); sibling-zone transfer (Z6) and the day-end zone recount prompt (Z8) (§12.4); tables, seatings, lock, handover, move / merge / split, bill request, cleaning (**02a**); engine math and its events' engine fields (**03a**); Start / Done, Ready to serve, Handover, KDS, tickets, the Served card (**03b**); voids at stage 2+, move-to-stock, remake billing, the customer's own wrong order (**04**); bills, payments, discounts, the comp's bill effect, Z report (**05**); hub-down manager alert (**06 / 01e**); customer tracking (P2).

### 1.4 Decisions log (developer, 2026-11-07)

| ID | Decision |
|---|---|
| O1 | **A round is a new order.** Every `SubmitOrder` makes a new order; `OrderLinesAdded` is written only by `ReturnToKitchen` (D2, D7; 02b-g1 §3 #2, 03a :645 allows it). |
| O2 | **One line with quantity** (01c D-2): a line of n pieces is one order item; partial actions name `units`. |
| O3 | **Ids from the device** (03a AD-29 Q5, G1-2): `order_id` and every `order_item_id` are ULIDs minted on the device when the line is put in the cart and kept for every retry; the hub refuses a reused live id before append. |
| O4 | **Zone routing resolved by 02b** (Z3, G1-3): a line's starting `station_id` is the most specific zone route of the seating's primary table (leaf zone → parent zone → floor), else the branch route; 03a plans what it is given. |
| O5 | **Zone-served lines** (Z4, G1-6): a plain item line punched at a table whose zone holds that item with count > 0 is taken from the zone: it is not an engine line, it is served in the submit batch, it never prints. |
| O6 | **Refill is a transfer** (owner Q1, G1-11): refilling a zone moves the item's day stock draws out of branch stock when the item has any; a set count never touches branch stock. *Refines G1-11:* the source is the item's own draws (01c `dayDraws`), so no `source_stock_item_id` column is needed. |
| O7 | **Partial remove and partial comp** (owner Q2, Q3; G1-12, G1-13): both take `units`; removal reuses 03a's partial-void fold (03a row Q-4); comps are `LineComped` events folded by 02b and read by 05. |
| O8 | **No day, no order** (owner Q4, G1-14): `SubmitOrder` needs an open business day. |
| O9 | **Lock scope** (D39 extended, 02b-g0 §3 #14): only `SubmitOrder` and `RemoveItems` call `requireLock`. Served, release, boost, return, comp, weight, zone stock never need the lock. |
| O10 | **Non-table orders belong to the person who placed them** for `own_tables` (owner Q6, G1-15, 01b row B-4). |
| O11 | **Queued auto-send** (owner Q8, G1-7, 00 row H-1): a never-processed queued command of an ended session is accepted in the original name, marked, within `queue_auto_send_max_ms`; a queued submit never takes a free lock (02a P-1b). |
| O12 | **Token** (owner Q4 / C): takeaway orders only; from 1 at each `BusinessDayOpened`, per branch; parking keeps the car number, dine-in the table. |
| O13 | **Comps apply to submitted lines only** (cart first, then comp); comps and every PIN-capable action are online-only. |
| O14 | **Estimated Served is stubbed** until 03b's Handover exists (G0-6, 02b-g0 §3 #6); Served is a tap meanwhile (owner Q7). |
| O15 | **Short stock** (03a AD-19, AD-29 Q8): a line needing more than the available stock is refused; the client caps the stepper and shows "Only n left". |

---

## §2. Existing architecture that must not change

- 00: `POST /commands/:name`, device + staff session, D32 idempotency (`command_id`, `processed_commands`), single writer `BEGIN IMMEDIATE`, commit-then-swap (D45), projections with `reset`, ticks, catch-up parts, audiences, `StaffDirectory`, `clock`, `ids`. M19 replay fast path.
- Foundation §5.9: submit pipeline order; §4.2 item stages; §4.3 lock (D39, D51, D61).
- 01a: `branchConfig()` (snapshot V4: floors, zones, tables, stations, alternates, points, items, windows, stock items, programs), `openDayStartMs(state)`, `BUSINESS_DAY_NOT_OPEN`, stock commands, `item_availability`.
- 01b: `resolve(staff, permission) → { granted, scope, requires_approval, approver_role_ids }`, scopes `branch`, `my_floors`, `own_tables`; C8 (scope last).
- 01c: `ItemAdded` v1 exactly (§4.3), `@pos/domain` `menu-lines.ts` helpers (`orderLineTotalMinor`, `allocateDealMinor`, `checkOptionChoices`, `isGroupSatisfiable`, `isItemOrderable`, `childQuantity`, `optionChargeMinor`), `@pos/engine` stock helpers (`availableStock`, `canServeFromStock`, `saleUnitsAvailable`, `dayDraws`).
- 01d: `defineAlertKind`, `alerts.raise`, `alerts.byDedupeKey`, `alerts.close`, `APPROVAL_TIER_STEPS`, request read-only `apply` contract, PIN commands never queued.
- 02a: `seatingOf`, `currentTableOf`, `requireLock`, `zoneOf`, `holdersOfOrders`, the `tables` projection (folds 02b's `OrderPlaced`, `OrderLinesAdded`, `ItemRemoved`, `OrderCancelled`, `ItemServed`, and after P-1 `LineWeightSet`, `LineComped`).
- 03a: `ProposedOrder`, `checkOrderable`, `reserveStock`, `planOrder`, `calculateETA`, `stockEffects`, `planRelease`, `isOrderInEngine`, the `order` events' engine fields (§4.2), `stations-live`, `slip_warning`.

---

## §3. Domain rules

### 3.1 Order types and identity

| Type | Identity | `table_id` | `table_key` | Lock | Extra fields |
|---|---|---|---|---|---|
| `dine_in` | the seating (02a) | seating's primary table at submit | `'dine_in:' + seating_id` (02a T21) | `requireLock` | — |
| `takeaway` | token | null | `'takeaway:' + order_id` | none | `token`, `customer_name?`, `phone?` |
| `parking` | car number | null | `'parking:' + car_number_norm` | none | `car_number`, `car_type`, `phone?` |

`car_number_norm` = upper-case, spaces and dashes removed ("LEB-1234" → "LEB1234"); `car_number` is stored as typed (2–12 of letters, digits, space, dash). `car_type` ∈ `sedan | mini | large` (required, S10). `phone`: 10–13 digits, stored digits only. `customer_name` ≤ 40. Two parking orders with the same plate share a `table_key`, so 03a groups their slips (the same car).

### 3.2 Submit (`SubmitOrder`)

1. **Day:** `openDayStartMs(state)` null → `409 BUSINESS_DAY_NOT_OPEN` (O8).
2. **Type:** `dine_in` needs `{ table_id, seating_id }`; `seatingOf(table_id)` ≠ given → `409 TABLE_SEATING_CHANGED` (02a T18); `requireLock(tx, { table_id, seating_id }, { ...ctx, queued })` → its drafts (02a §4.2; with P-1b a queued submit never takes a free lock).
3. **Ids** (O3): every `order_id` / `order_item_id` must be new: not in `orders` / `order_lines`, not live in `EngineState`, not repeated in the payload → `409 ORDER_ITEM_ID_IN_USE { order_item_id }` (or `{ order_id }` field on the same code).
4. **Lines from config** (D25): for each requested line, the item / variant / deal from `branchConfig()`; missing or archived → `404 MENU_ITEM_NOT_FOUND` / `DEAL_NOT_FOUND`; manual Off → `409 ITEM_UNAVAILABLE { item_id }`; outside its or its category's windows on hub time → `409 ITEM_OUT_OF_HOURS { item_id, opens_at_ms | null }` (S47); options through `checkOptionChoices` → `422 OPTION_CHOICE_INVALID { order_item_id, violations }`; a required group not satisfiable → `ITEM_UNAVAILABLE`.
5. **Zone-served** (O5, §3.10): a line is zone-served when the payload marks it `from_zone: true`, it is `line_kind 'item'` with no options, the order is `dine_in`, the table's zone (or a parent zone) lists the item, and that zone's `on_hand ≥ quantity`; a `from_zone` line that fails any check → `409 ZONE_STOCK_EMPTY { zone_id, item_id, on_hand }` (the client then sends it as a normal line). Zone-served lines get `served_from_zone_id`.
6. **Routing** (O4): for each engine line, `station_id` = zone route (§3.10) else the branch route; `alternates`, points and carry from 01a A-9 / A-10 for the order type.
7. **Build** `ProposedOrder` (03a §4.2) from the **engine lines only** (not zone-served lines, not `deal` header lines without a station — 01c's rule), `follow_up` per §3.3, `pickup_at_ms: null`.
8. **Engine checks:** `checkOrderable(state, proposed)` → `409 STATION_PAUSED { station_id }`; stock: a line with `out_of_stock_behaviour 'sold_out'` and available < needed → `409 ITEM_SOLD_OUT { item_id, available }` (O15, AD-19); `reserveStock` → `StockReserved` drafts + `from_stock`; `planOrder(state, proposed, now)` → groups, lines, target, promise.
9. **Token** (O12): takeaway → `token = 1 + MAX(token)` over `orders` of the current business date (1 statement).
10. **Append** in this order (03a batch order, 03a :615): lock drafts (if any) → `OrderPlaced` → `ItemAdded` × n in `order_item_ids` order, then zone-served `ItemAdded`s → `StockReserved` × n → `ItemServed { order_item_ids: zone-served ids, source: 'tap' }` (if any) → `ZoneStockLow` (if a zone count crosses its threshold, §3.10).
11. **Result** `{ order_id, token | null, groups: [{ group_id, promise_ms, order_item_ids }], lines: [{ order_item_id, eta_ms | null, from_stock, zone_served }], corrected: boolean }` — `promise_ms` per group only, never `target_land_ms` (03a #9, 02b-g0 §3 #5); `corrected` = a line's ETA differs from the client's last preview by > 60 s (the client shows B07).

Statements (warm): 1 seating + lock (02a) + 1 ids + 1 zone counts + 1 token + engine (in memory) + append. Target p99 < 60 ms with 12 lines.

### 3.3 Rounds and `follow_up`

- Every submit is a new order (O1). `follow_up` = the seating already has an order with a served line (`seating_orders.served_any` through 02a) — for `dine_in` only; other types `false`.
- An order exits the engine on 03a's rules; 02b keeps it in `orders` until 05's bill closes it (`billed_at` set by fold of `BillClosed`, 02a T-row; until 05 exists, open orders show until day close).

### 3.4 Live units

For a line: `units` = 03a's line units (the line's `quantity` for `piece`; 1 for `g` / `ml` and for `deal` lines). `live_units = units − removed_units − voided_units − returned_units(remake)`. Comped units are live (they are served and shown, owner A). A line with `live_units = 0` is not live. An order with no live line is cancelled (§3.5).

### 3.5 Remove at stage 1 (`RemoveItems`) and `OrderCancelled`

- Stage 1 = not started and not fired (03a: line in the engine, `started_at` null, not in a dispatched load). A line past stage 1 → `409 ITEM_WRONG_STAGE { order_item_id, stage }` (the client offers 04's void).
- Each entry `{ order_item_id, units? }`; `units` absent = all live units; `units > live_units` → `422 VALIDATION_FAILED`. Partial units only on `piece` lines (O7).
- Children: removing a parent's units removes its `option_child` lines' proportional share (01c `childQuantity`); a `deal` line removes all its parts; removing a `deal_part` alone → `409 DEAL_PART_NOT_REMOVABLE` (the deal is sold whole; void the deal).
- Units removed take **uncomped** units first, then comped ones (the comp shrinks to fit).
- Drafts: `ItemRemoved { order_item_id, units }` (03a row Q-4; absent `units` in old readers = whole line) + `stockEffects` (release the share) per line; when the order has no live line left → `OrderCancelled { order_id }` (02a :250). Zone-served lines are served, so never stage 1.
- `orderEmptiedDrafts(tx, order_id, removed: { order_item_id, units }[])` is exported for 04's voids (G1-16).

### 3.6 Weighed lines (`SetLineWeight`)

A line copied with `requires_weighing` and `quantity null` is pending. `SetLineWeight { order_item_id, quantity }` with `quantity` an integer in S59 steps (50 g / 50 ml), 50–50 000 → `LineWeightSet { order_item_id, quantity, line_total_minor }` with `line_total_minor = orderLineTotalMinor(copy with quantity)` from the **`ItemAdded` copy** (01c M7). Already set → allowed again until the bill is closed (a correction; each event logged). Not pending-capable → `409 LINE_NOT_WEIGHED`.

### 3.7 Served (`MarkServed`) and the estimate

- `MarkServed { order_ids_lines: [{ order_id, order_item_ids }] }`; no lock (D39). Lines already served → skipped (idempotent per line, `result.skipped`). A line not yet Done is allowed (a runner may serve straight from the pass; foundation D31 sets FOOD_ON_TABLE on served).
- One `ItemServed { order_item_ids, source: 'tap' }` per order + `stockEffects` drafted from **folded state**, array form across the whole command (03a AD-29 Q7: a from-stock line with no Start consumes here).
- **Estimated Served** (03a #4, G0-6): tick `served_estimate` writes `ItemServed { source: 'estimated' }` for lines whose 03b Handover is older than `served_estimate_ms`. **Stub until 03b** (O14): registered with `nextDueAt → null`; its test is `it.todo('[02b O14]')`.

### 3.8 Release, boost, return

- `ReleaseItems { order_ids, released: order_item_id[], expedite: order_item_id[] }` → `planRelease` (03a §3.8) → `ItemsReleased { …, alert_id }` per order with the open `slip_warning` alert of the order's `table_key` (`alerts.byDedupeKey`), and `alerts.close(…, 'done')` for it. No open alert → `alert_id: null`.
- `BoostOrder { order_id }` → `OrderBoosted` (03a §3.8). Order not in the engine → `409 ORDER_NOT_IN_ENGINE`.
- `ReturnToKitchen { order_item_id, mode: 'fix' | 'remake', units?, note? }` (03a §3.8a): the line must be served and its order in the engine (`ORDER_NOT_IN_ENGINE`); an open return of it → `409 RETURN_ALREADY_OPEN`. Draft `OrderLinesAdded` with one return line (money 0, `line_kind 'item'`, links null, `options []`, `return_of`, `cook_ms_override` = the item's `adjust_time_ms` for `fix`) + its `ItemAdded`, + `ItemReturned` for `remake`. Return lines are never billed (To 05) and never comped.

### 3.9 Comps (`CompLine`, kind `comp`)

- `CompLine { order_item_id, units, reason_code, note? }` on a **submitted** live line (O13), not a return line, not a `deal_part` (comp the deal) → `409 COMP_NOT_ALLOWED { reason }`. `units ≤ live_units − comped_units` else 422.
- `value_minor` = the units' share of the line total: `piece` lines `allocateDealMinor(line_total_minor, per-unit weights)` taking shares in comp order (01c §3.4.8, as voids); `g` / `ml` and `deal` lines whole only. A line with a pending weight → `409 LINE_WEIGHT_PENDING`.
- Permission `apply-comp` (01b, group `bills`): grant `allowed` → `LineComped { …, alert_id: null, approver_staff_id: null }`; grant `requires_approval` → `alerts.raise` kind `comp` with `values { order_id, order_item_id, units, reason_code }`, `details { item, quantity, amount, reason }`; result `{ alert_id, pending: true }`. A second comp request on the same line while one is open → `409 COMP_PENDING { alert_id }`.
- Kind `comp` `apply` (approve) re-checks live units and returns `LineComped { …, alert_id, approver_staff_id: answer.answerer_staff_id }` (read-only contract); reject → `[]`. The requester's waiting card is 01d's (AD-1).
- Stock: a comped line was cooked and served — stock drawn as usual (owner A); no stock event.

### 3.10 Zones: routing and stock

- **Config (01a row A-1):** `zone_item_routes (zone_id, item_id, station_id)` and `zone_stock_items (zone_id, item_id, threshold)` in snapshot V4 `floors[].zones[].routes[]` / `.stock_items[]`. A table without a zone uses its floor's implicit zone: no routes, no stock.
- **Routing:** walk from the table's leaf zone up its parents (01a zones nest, Z1); the first route for the item wins; none → branch route. Only for `dine_in`; takeaway / parking keep 01a's order-type homes.
- **Counts:** projection `zone_stock (zone_id, item_id, on_hand)`, changed by `ZoneStockAdded` (+), `ZoneStockSet` (=), and zone-served `ItemAdded` (− quantity, read from `served_from_zone_id`). Never negative (submit checks inside the transaction).
- **Refill** `AddZoneStock { zone_id, item_id, quantity 1–500 }`: the item must be a zone item of that zone; when the item has day stock draws (`dayDraws`), each draw × quantity moves out of branch stock: `available < needed` → `409 STOCK_INSUFFICIENT { stock_item_id, available }`; drafts `StockTransferredOut { stock_item_id, quantity, zone_id }` per draw (03a row Q-5) + `ZoneStockAdded { zone_id, item_id, quantity, transfers }`.
- **Count** `SetZoneStock { zone_id, item_id, on_hand 0–5 000 }` → `ZoneStockSet { zone_id, item_id, on_hand, previous }`; branch stock untouched (O6).
- **Low / out:** after any change, a count that moves from above its `threshold` to ≤ it raises kind `zone_stock_low` (dedupe `zone_stock:` + zone_id + `:` + item_id); a count back above the threshold closes it `done`.

### 3.11 Token and business day

`orders.business_date` = the open day's date (01a `BusinessDayOpened.business_date`). Token per §3.2 step 9; unique `(business_date, token)` (index). A day closed and reopened the same date continues the numbering (MAX over the date).

### 3.12 Device command queue (client + hub)

- **Queued commands:** `SubmitOrder` and `MarkServed` (02b), `RequestBill`, `CleanTable`, `CallWaiter` (02a). Never queued: PIN-capable commands, `CompLine`, `RemoveItems`, `ReturnToKitchen`, `ReleaseItems`, `BoostOrder`, zone stock, 02a's seating commands (02a §8).
- **Device:** a command is written to the queue (tablet SQLite in 9b's app; kiosk / phone IndexedDB) **before** the first send, with `command_id`, `queued_at` (device clock, shown only), `session_token`, `staff_id`; replay in `queued_at` order; removed on a 2xx or a 4xx (4xx kept in the **queue log**: what, when, why, "Discard" / "Copy to a new order"); "Order submitted" only after the hub's 2xx (E5 AC4).
- **Hub (00 row H-1):** a replay sends `X-Queued: 1`; an ended (not revoked, not unknown) session of the same device whose staff is still active is accepted in that staff's name, permission read now; envelope `meta.sent_after_reconnect = true`; older than `queue_auto_send_max_ms` (branch setting, default 14 400 000) against hub time → `409 QUEUED_COMMAND_EXPIRED { queued_at }`.
- **Drafts in progress** (not sent) stay on the device (B03), per (device, staff), and survive restarts.

### 3.13 Totals (`seatingTotals`)

`total_minor` of a seating = Σ over its live orders' lines of `line_total_minor` (pending weight = 0) − Σ `comp_minor` − Σ `refund_minor` (04's voids, G1-16) − removed share (stored as `removed_minor` at removal). Return lines are 0. One statement over `order_lines` joined to `seating_orders` (02a) by `order_id`.

### 3.14 Permissions and scopes

| Command | Permission | Scope check (C8, last) |
|---|---|---|
| `SubmitOrder` | `take-order` (+ `take-order-anywhere` inside `requireLock`) | dine-in: the table (`own_tables` = holder / assignee, `my_floors`, `branch`); others: none |
| `RemoveItems` | `take-order` | as `SubmitOrder`, on the order's current table |
| `SetLineWeight` | **`set-line-weight`** (new, B-1) | `branch` |
| `MarkServed`, `ReleaseItems` | `mark-served` | dine-in: current table; takeaway / parking: `own_tables` covers orders the person placed (O10, B-4) |
| `BoostOrder` | `boost-order` | as `MarkServed` |
| `ReturnToKitchen` | `mark-item-returned` | as `MarkServed` |
| `CompLine` | `apply-comp` (approval per grant) | `branch` |
| `AddZoneStock`, `SetZoneStock` | **`manage-zone-stock`** (new, B-2) | **`my_zones`** (new scope, B-3) or `branch` |

Defaults by `default_key` (README :185, R29 re-seed): owner, manager: all; cashier: `set-line-weight`, `apply-comp` (approval by manager); order_taker: `take-order`, `mark-served`, `mark-item-returned`, `boost-order`, `apply-comp` (approval by manager), `manage-zone-stock` (`my_zones`); waiter: `mark-served`, `manage-zone-stock` (`my_zones`). All editable (config).

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | registry, writer, projections, ticks, catch-up, audiences, `StaffDirectory`, `staff_sessions`, `clock`, `ids`, M19 | everything |
| 01a | `branchConfig()` (V4 incl. A-1 zone routes / zone items), `openDayStartMs`, `BusinessDayOpened`, `item_availability`, stock commands' events | §3.2, §3.10, §3.11 |
| 01b | `resolve`, scopes incl. `my_zones` (B-3) and `own_tables` for placed orders (B-4) | §3.14 |
| 01c | `ItemAdded` v1, `menu-lines.ts`, stock helpers | §3.2, §3.5, §3.6, §3.9 |
| 01d | `defineAlertKind`, `alerts.raise`, `alerts.byDedupeKey`, `alerts.close`, `APPROVAL_TIER_STEPS` | §3.8, §3.9, §3.10 |
| 02a | `seatingOf`, `currentTableOf`, `requireLock` (with P-1b `queued`), `zoneOf`, `seating_orders` (read for `follow_up`, totals) | §3.2, §3.3, §3.13 |
| 03a | `ProposedOrder`, `checkOrderable`, `reserveStock`, `planOrder`, `calculateETA`, `stockEffects`, `planRelease`, `isOrderInEngine`, `EngineState` lines (stage), events' engine fields, `stations-live` | §3.2–§3.8 |
| 04 | `ItemVoided { …, refund_minor }` (To 04) | §3.4, §3.13 |
| 05 | `BillClosed` (02a's contract) | §3.3 |
| 03b | `Handover` event (for the estimate, when built) | §3.7 |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `seatingTotals(db, seating_id)` | `{ total_minor, order_count }` | 1 | 02a handover card, 05 |
| `orderEmptiedDrafts(tx, order_id, removed)` | `EventDraft<'OrderCancelled'>[]` (0 or 1) | 1 | 04 voids |
| `orderLines(db, order_ids[])` | `Map<order_id, LineView[]>` (`order_item_id, name, units, live_units, comped_units, comp_minor, line_total_minor, removed_minor, refund_minor, served_at, zone_served`) | 1 | 03b ticket / cards, 04, 05 |
| `ordersOf(db, seating_id)` | `OrderView[]` | 1 | 05 bill per seating |
| Events, projections, kinds, queries, catch-up | §6.18, §5, §6.12–6.13, §6.14–6.17 | — | all |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 03b | Print and show the takeaway `token` big on the ticket and the Ready card; parking "PARKING LEB 1234 · SEDAN"; zone-served lines (`served_from_zone_id` set) never print and never appear on KDS; a COMP marker is not printed on the kitchen ticket (kitchen cooks as usual); return lines carry the RETURN marker (03a); write a `Handover` event 02b's estimate can anchor on. |
| 04 | `ItemVoided` carries `refund_minor` (01c per-unit rule; additive, R29); every void transaction calls `orderEmptiedDrafts`; voided units take uncomped units first; 03a §12.3 Q12 (customer's own wrong order) is 04's. |
| 05 | Bill lines from `orderLines` / `ordersOf`; a comped share shows at its value with a COMP label and is subtracted (owner A, 01d-g0 C4); return lines never billed; refuse bill close while a weight is pending; list open `comp` requests at day close (`alerts.listOpen`); write `BillClosed` per 02a. |
| 08 | `ItemAdded.stock_draws` of a zone-served line were already moved by `StockTransferredOut` at refill: do not count them again. |

### 4.4 Shared types

`OrderType = 'dine_in' | 'takeaway' | 'parking'` (03a's type also has `delivery`; 02b refuses it, `422 VALIDATION_FAILED` path `order_type`, until P2). `CarType = 'sedan' | 'mini' | 'large'`. `CompReasonCode` = the branch's chip codes (config, §5.2 of 02b-g0) or `'other'`.

### 4.5 Changes to other specs (R26) — **Proposed, applied on approval**

| Row | Spec → version | Change |
|---|---|---|
| F-1 | Foundation v1.10 → v1.11 | §4.4 CANCELLED = every line removed (02b) or voided (04); §4.2 "remove (adder)" → "remove (`take-order` + the lock)"; §4.3 D39 list adds release, boost, return, comp, weight, zone stock; §5.9 step 4 → 02a `requireLock`; step 10 `result` → 02b §3.2 step 11 (groups with `promise_ms`). |
| H-1 | 00 v1.7 → **v1.8** | Queued auto-send (§3.12): `X-Queued: 1`, ended same-device session accepted, `meta.sent_after_reconnect`, `QUEUED_COMMAND_EXPIRED`, setting `queue_auto_send_max_ms`. Ships before 01e's 00 bump (G1-7); README :16 updated. |
| A-1 | 01a v2.2 → v2.3 | `zone_item_routes`, `zone_stock_items` (nested replace-lists on the zone route), snapshot **V4** gains `zones[].routes[]`, `zones[].stock_items[]` (V4 is unbuilt: same release, R29); branch setting `queue_auto_send_max_ms`; comp reason chips list. |
| B-1–B-4 | 01b v1.6 → v1.7 | B-1 `set-line-weight` (group `orders`, scopes `branch`); B-2 `manage-zone-stock` (group `orders`); B-3 scope `my_zones` (zones the person is assigned, 01b assignment data; CHECK expand migration); B-4 `own_tables` also covers non-table orders with `placed_by` = the person; defaults by `default_key` (§3.14). |
| P-1, P-1b | 02a v1.0 → v1.1 | P-1: the `tables` projection and activity fold also read `LineWeightSet`, `LineComped` (activity only when actor = lock holder; no state change). P-1b: `requireLock(…, { queued: true })` never takes a free lock. |
| Q-3–Q-5 | 03a v1.1 → **v1.2** (with the engine lane's as-built, G1-1) | Q-3: an `ItemAdded` outside its order's `order_item_ids` is ignored by the engine fold (as built, task 8b); an `OrderPlaced` with empty `order_item_ids` is never an engine order. Q-4: `ItemRemoved.units?` folded by the partial-void path. Q-5: `StockTransferredOut { stock_item_id, quantity, zone_id }` folded as a negative `StockAdded` (clamped, breach logged). |
| E-1 | 02b ← R29 additive fields on 03a / 01c schemas | `OrderPlaced` + `token`, `business_date`, `customer_name`, `phone`, `car_number`, `car_type`, `order_note`; `ItemAdded` + `served_from_zone_id`. Engine ignores them. |

### 4.6 Carried rows (README) and where they land

As 02b-g0 §2 (33 rows); each cited at its section: :162 → §3.12; :163 → §8; :175 → §8; :176 → §6.14–6.17; :178, :179 → §8; :180, :181, 01a §4.4 → §3.1, §3.2, §8; :185 → §3.14; :200 → O2; :201 → §12.4; :202 → §3.6; :203, :204, 01c §4.4 → §3.2, §8; :214 → none on the hub; :218, :220 → §3.9, §6.12; :222 → §8; :230 → §3.2–§3.8, §6.14; :231 → §3.2, §3.5, §3.12, §4.2, §4.5 P-1.

---

## §5. Data model (hub SQLite)

Migration `apps/hub/src/db/migrations/NNNN_orders.sql`, next free number at build time.

```sql
CREATE TABLE orders (
  order_id        TEXT PRIMARY KEY,
  order_type      TEXT NOT NULL CHECK (order_type IN ('dine_in','takeaway','parking')),
  table_key       TEXT NOT NULL,
  seating_id      TEXT,                                  -- dine_in only (from table_key)
  table_id        TEXT,                                  -- primary table at submit (copy)
  business_date   TEXT NOT NULL,
  token           INTEGER,                               -- takeaway only
  car_number      TEXT, car_type TEXT CHECK (car_type IN ('sedan','mini','large')),
  customer_name   TEXT, phone TEXT, order_note TEXT,
  placed_by       TEXT NOT NULL,                         -- envelope actor_id
  placed_at       INTEGER NOT NULL,                      -- recorded_at
  follow_up       INTEGER NOT NULL CHECK (follow_up IN (0,1)),
  cancelled_at    INTEGER,
  billed_at       INTEGER,
  sent_after_reconnect INTEGER NOT NULL DEFAULT 0 CHECK (sent_after_reconnect IN (0,1))
);
CREATE UNIQUE INDEX orders_token ON orders (business_date, token) WHERE token IS NOT NULL;   -- token MAX, uniqueness
CREATE INDEX orders_open ON orders (order_type, placed_at) WHERE billed_at IS NULL AND cancelled_at IS NULL;  -- open-orders
CREATE INDEX orders_seating ON orders (seating_id) WHERE seating_id IS NOT NULL;            -- seating-orders, totals

CREATE TABLE order_lines (
  order_item_id   TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL,
  parent_order_item_id TEXT,
  line_kind       TEXT NOT NULL CHECK (line_kind IN ('item','option_child','deal','deal_part')),
  item_id TEXT, deal_id TEXT, name TEXT NOT NULL,
  sale_unit       TEXT NOT NULL,
  quantity        INTEGER,                               -- NULL while weight pending
  units           INTEGER NOT NULL,                      -- §3.4
  line_total_minor INTEGER,                              -- copy; set by LineWeightSet
  removed_units INTEGER NOT NULL DEFAULT 0, removed_minor INTEGER NOT NULL DEFAULT 0,
  voided_units  INTEGER NOT NULL DEFAULT 0, refund_minor  INTEGER NOT NULL DEFAULT 0,
  comped_units  INTEGER NOT NULL DEFAULT 0, comp_minor    INTEGER NOT NULL DEFAULT 0,
  returned_units INTEGER NOT NULL DEFAULT 0,
  return_of       TEXT,                                  -- return lines (money 0)
  served_from_zone_id TEXT,
  served_at       INTEGER,
  kitchen_note    TEXT,
  CHECK (removed_units + voided_units + returned_units <= units),
  CHECK (comped_units <= units)
);
CREATE INDEX order_lines_order ON order_lines (order_id);                                  -- every per-order read

CREATE TABLE zone_stock (
  zone_id TEXT NOT NULL, item_id TEXT NOT NULL,
  on_hand INTEGER NOT NULL CHECK (on_hand >= 0),
  PRIMARY KEY (zone_id, item_id)
);
```

- **One projection `orders`** (with `reset`) writes all three tables; it folds `OrderPlaced`, `ItemAdded`, `OrderLinesAdded`, `ItemRemoved`, `ItemVoided`, `ItemReturned`, `ItemServed`, `LineWeightSet`, `LineComped`, `OrderCancelled`, `BillClosed` (via 02a's `seating_orders`, or 05's per-order bill when it exists), `ZoneStockAdded`, `ZoneStockSet`. **Only 02b writes these tables.** Engine state is read, never copied here (stage comes from `EngineState`).
- Times are `recorded_at`. No session ids (02a T7).

---

## §6. Commands, events and queries

**Common rules.** `POST /commands/:name`, `sessionKind: 'device'`, staff session, D32 idempotency, no PIN (comp approval PINs are 01d's answer path). Responses `200 { data: { command_id, event_ids, result } }`; only `result` listed. Dine-in commands carry `seating_id` (the one shown) and follow 02a's `TABLE_SEATING_CHANGED` rule (02a §6 common rules). Scope checks last (C8). Edits on an order resolve the table by `currentTableOf`.

### 6.1 `SubmitOrder`

| | |
|---|---|
| Permission | `take-order` (§3.14) |
| Payload | `{ order_id, order_type, table_id?, seating_id?, takeaway?: { customer_name?, phone? }, parking?: { car_number, car_type, phone? }, order_note?: string ≤ 200, lines: [{ order_item_id, item_id? \| deal_id?, variant_id?, quantity?: int, options?: [{ option_id, quantity }], deal_choices?: [{ deal_part_id, item_id, options? }], kitchen_note?: ≤ 80, from_zone?: boolean }] (1–40), preview_seq?: int }` — child and deal-part `order_item_id`s minted by the device too, in `options[].order_item_id` / `deal_choices[].order_item_id` |
| Script | §3.2 steps 1–11 |
| Result | §3.2 step 11 |
| Errors | `BUSINESS_DAY_NOT_OPEN`, `TABLE_SEATING_CHANGED`, `TABLE_ALREADY_LOCKED`, `TABLE_NEEDS_CLEANING`, `ORDER_ITEM_ID_IN_USE`, `MENU_ITEM_NOT_FOUND`, `DEAL_NOT_FOUND`, `ITEM_UNAVAILABLE`, `ITEM_OUT_OF_HOURS`, `OPTION_CHOICE_INVALID`, `ZONE_STOCK_EMPTY`, `STATION_PAUSED`, `ITEM_SOLD_OUT`, `QUEUED_COMMAND_EXPIRED`, `PERMISSION_DENIED`, `VALIDATION_FAILED` |

### 6.2 `RemoveItems`

`{ order_id, seating_id?, lines: [{ order_item_id, units? }] (1–40, unique) }`; `take-order`; dine-in: `requireLock` on the current table (§3.5, O9). Result `{ removed: [{ order_item_id, units }], cancelled: boolean }`. Errors: `ORDER_NOT_FOUND`, `ITEM_WRONG_STAGE`, `DEAL_PART_NOT_REMOVABLE`, lock errors.

### 6.3 `SetLineWeight`

`{ order_item_id, quantity }`; `set-line-weight`. §3.6. Result `{ line_total_minor }`. Errors: `LINE_NOT_WEIGHED`, `ORDER_BILLED`.

### 6.4 `MarkServed`

`{ lines: [{ order_id, order_item_ids }] (1–20 orders) }`; `mark-served`; no lock. §3.7. Result `{ served: n, skipped: order_item_id[] }`. Errors: `ORDER_NOT_FOUND`, `ITEM_WRONG_STAGE` (removed / voided line).

### 6.5 `ReleaseItems`

`{ order_ids, released, expedite }` (sets, C1); `mark-served`. §3.8. Result `{ alert_closed: boolean }`. Errors: `ORDER_NOT_IN_ENGINE`.

### 6.6 `BoostOrder`

`{ order_id }`; `boost-order`. §3.8. Errors: `ORDER_NOT_IN_ENGINE`.

### 6.7 `ReturnToKitchen`

`{ order_item_id, return_order_item_id, mode, units?, note?: ≤ 80 }` (`return_order_item_id` minted by the device, O3); `mark-item-returned`. §3.8. Result `{ eta_ms, promise_ms }`. Errors: `ORDER_NOT_IN_ENGINE`, `RETURN_ALREADY_OPEN`, `ITEM_WRONG_STAGE` (not served).

### 6.8 `CompLine`

`{ order_item_id, units, reason_code, note?: ≤ 120 }`; `apply-comp`; online only. §3.9. Result `{ comped: true, value_minor } | { alert_id, pending: true }`. Errors: `COMP_NOT_ALLOWED`, `COMP_PENDING`, `LINE_WEIGHT_PENDING`, `ORDER_BILLED`.

### 6.9 `AddZoneStock` / 6.10 `SetZoneStock`

§3.10. `manage-zone-stock`, scope `my_zones` on the zone. Results `{ on_hand }`. Errors: `ZONE_NOT_FOUND`, `ZONE_ITEM_NOT_CONFIGURED { zone_id, item_id }`, `STOCK_INSUFFICIENT`, `BUSINESS_DAY_NOT_OPEN` (refill only: branch stock needs a day).

### 6.11 Tick `served_estimate` (stub, O14)

Registered; `nextDueAt → null` until 03b's `Handover` exists. Specified: due lines = Handover older than `served_estimate_ms`, not served; one `ItemServed { source: 'estimated' }` per order + `stockEffects`.

### 6.12 Kind `comp`

```typescript
defineAlertKind({
  kind: 'comp', family: 'action', subject: 'order',
  steps: APPROVAL_TIER_STEPS,
  closes_on: 'owner',
  values_schema: z.object({ order_id: z.string().min(1), order_item_id: z.string().min(1),
                            units: z.number().int().min(1), reason_code: z.string().min(1) }),
  details_schema: AlertDetailsBase.pick({ item: true, quantity: true, amount: true, reason: true }),
  lead_fallback: false, expires_at_day_close: true, silent: false,
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

### 6.13 Kind `zone_stock_low`

`family: 'info'`, `subject: 'zone'`, target `{ kind: 'permission_holders', permission: 'manage-zone-stock', zone_id }` (01d resolver; 02a's `zone_order_taker` plus managers), `closes_on: 'owner'` (closed `done` by a refill above threshold), `values { zone_id, item_id, on_hand, threshold }`, `expires_at_day_close: true`, no request.

### 6.14 `GET /queries/eta-preview`

Staff session; `countsAsActivity: false`. Query = a `SubmitOrder` payload minus ids (lines with temp keys). Runs §3.2 steps 4–8 read-only with `calculateETA`; result `{ as_of_seq, groups: [{ promise_ms, keys }], lines: [{ key, eta_ms, from_stock, zone_served, refused?: { code, details } }] }`. No writes, no stock reserved (E2-ETA AC5). p99 < 40 ms at 12 lines.

### 6.15 `GET /queries/seating-orders`

`{ seating_id }` → orders of the seating (sorted by `placed_at`), each `{ order_id, placed_by: { staff_id, name }, placed_at, follow_up, cancelled, lines: LineView + stage (from `EngineState`), groups: [{ promise_ms }] }`, `total_minor`. Statements: 2 (orders, lines) + engine in memory.

### 6.16 `GET /queries/open-orders`

`{ order_type?: 'takeaway' | 'parking' | 'all', abandoned?: boolean }` → open non-table orders (token / car, phone, ready n / m, promise), sorted by promise; `abandoned: true` lists orders of any type with no kitchen tap for `order_abandon_ms` (03a) — manager view. Statements: 2.

### 6.17 `GET /queries/zone-stock`

`{ zone_id? }` → `[{ zone_id, name, items: [{ item_id, name, on_hand, threshold }] }]` for zones in the caller's scope. Statements: 1.

**Catch-up part `orders`:** open orders of the branch with lines (the §6.15 builder for all open seatings + §6.16), and `zone_stock`.

### 6.18 Events (`schema_version` 1)

| Event | Stream | Payload | Fold |
|---|---|---|---|
| `OrderPlaced` | order | 03a §4.2 + E-1 fields | `orders` row |
| `ItemAdded` | order | 01c §4.3 + `served_from_zone_id` | `order_lines` row; zone count − |
| `OrderLinesAdded` | order | 03a §4.2 (returns only) | nothing (lines come as `ItemAdded`) |
| `ItemRemoved` | order | `{ order_item_id, units? }` (Q-4) | `removed_units`, `removed_minor` |
| `ItemServed` | order | 03a | `served_at` |
| `ItemReturned` | order | 03a | `returned_units` |
| `ItemsReleased`, `OrderBoosted` | order | 03a | none |
| `OrderCancelled` | order | `{ order_id }` | `cancelled_at` |
| `LineWeightSet` | order | `{ order_item_id, quantity, line_total_minor }` | line |
| `LineComped` | order | `{ order_item_id, units, value_minor, reason_code, note \| null, alert_id \| null, approver_staff_id \| null }` | `comped_units`, `comp_minor` |
| `ZoneStockAdded` | zone / zone_id | `{ zone_id, item_id, quantity, transfers: [{ stock_item_id, quantity }] }` | + |
| `ZoneStockSet` | zone / zone_id | `{ zone_id, item_id, on_hand, previous }` | = |
| `StockTransferredOut` | stock | 03a Q-5 | 03a's |

**Audiences** (01d To 02: no catch-all on the `order` stream): `OrderPlaced`, `ItemAdded`, `ItemRemoved`, `ItemServed`, `OrderCancelled`, `LineWeightSet` → staff sockets and cashier kiosks of the branch; `LineComped` → cashier kiosks and sessions holding `apply-comp` (amounts); `ZoneStock*` → sessions holding `manage-zone-stock` and the table map; KDS gets order events through 03a / 03b's station frames, not here.

**Size:** 10 commands + 1 tick + 2 kinds + 4 queries + 1 catch-up = **18**.

---

## §7. Cross-cutting

| Item | Decision | Justification |
|---|---|---|
| Performance | `SubmitOrder` p99 < 60 ms (12 lines, peak engine); `eta-preview` p99 < 40 ms; `seating-orders` < 30 ms | E2-ETA AC1 (≤ 1 s with network on a cheap tablet) |
| Idempotency | D32 on every command; device ids make a resend after a lost answer safe | power cuts mid-rush (E5) |
| Races | single writer; ids, zone counts, token, stock all checked inside `BEGIN IMMEDIATE` | two order takers on the last Paye / last raita |
| Logs | `order_id`, `command_type`, `order_type`, line count, `queued`; never names, phones, totals | privacy, disputes |
| Privacy | phone and customer name only in `orders`, the order's own audiences and 05; not in logs | R14 |
| Rate limits | none beyond 00 | ≤ 10 devices / branch |
| Boot | `orders` projection replays from checkpoint (00 M48) | no state outside events |

---

## §8. Client contract (`apps/client`, 01d's `/staff/` entry, ui-kit only)

- **Ordering screen** (inventory 02-S05): category rail, search, tiles with chips (Sold out / Not now · hours / "4 left" / clock "25 min" slow / "Only 2 left" caps the stepper, O15); cart lines sorted by ETA with each group's promise; options sheet with defaults visible and linked-option availability (01c rows); kitchen note ≤ 80, order note ≤ 200; Hold (device draft); Send. ETA preview through `eta-preview` per change (debounced 250 ms), refetched on `BranchConfigApplied`, stock frames, `stations_live` changes; on `as_of_seq` older than the socket's last seq, refetch.
- **Zone items:** a tile of a zone item shows the zone count ("Raita · 6 here"); tapping adds a `from_zone` line; `ZONE_STOCK_EMPTY` → the line flips to a normal kitchen line with a note "Zone empty — sent to kitchen", once.
- **Types:** Dine-in (from the table map, 02a), Takeaway (name, phone optional → token shown big after Send), Parking (plate LTR mono, type icons, phone).
- **Table view (orders part):** rounds by time and person; stages in words; Mark served (checklist), Send what's ready (on a slip), Boost, Return (fix / remake), Comp (units, reason chips) with the waiting card "Waiting for Manager — Rs 450 comp" (01d AD-1, approver name when 01d's field lands), Remove (stage 1 only, units stepper), weight entry for pending lines.
- **Open orders:** takeaway by token, parking by plate; ready n / m; abandoned list for managers.
- **Zone stock screen:** my zones (scope), counts, Refill (+n), Count (= n); low highlighted.
- **Queue:** "Reconnecting… 2 orders waiting to send" (B02); queue log with refused items and their reason; Day not started → "Start day" for `OpenBusinessDay` holders, "Ask the manager to start the day" for others.
- **Rules:** buttons from effective permissions (R5); Urdu / English with Latin digits (R20); no service worker except the flagged kiosk; no secure-context APIs; ULIDs from `crypto.getRandomValues` (R14, R15); Capacitor LAN transport per 9b (`androidScheme: 'http'`, cleartext to private ranges, README :163); token storage per 9b.

---

## §9. Error catalogue additions (Foundation §6.2, `@pos/domain/src/errors.ts`)

| Code | Status | `details` | When |
|---|---|---|---|
| `ORDER_ITEM_ID_IN_USE` | 409 | `{ order_item_id } \| { order_id }` | reused or repeated id (O3) |
| `ITEM_UNAVAILABLE` | 409 | `{ item_id \| deal_id }` | manual Off, or a required group unsatisfiable |
| `ITEM_OUT_OF_HOURS` | 409 | `{ item_id, opens_at_ms \| null }` | outside a window (S47) |
| `ITEM_SOLD_OUT` | 409 | `{ item_id, available }` | `sold_out` line short of stock (O15) |
| `OPTION_CHOICE_INVALID` | 422 | `{ order_item_id, violations }` | `checkOptionChoices` |
| `ZONE_STOCK_EMPTY` | 409 | `{ zone_id, item_id, on_hand }` | `from_zone` line not served by the zone |
| `ZONE_ITEM_NOT_CONFIGURED` | 422 | `{ zone_id, item_id }` | refill / count of a non-zone item |
| `STOCK_INSUFFICIENT` | 409 | `{ stock_item_id, available }` | refill transfer short |
| `DEAL_PART_NOT_REMOVABLE` | 409 | `{ order_item_id }` | remove a single deal part |
| `LINE_NOT_WEIGHED` | 409 | `{ order_item_id }` | weight on a non-weighed line |
| `LINE_WEIGHT_PENDING` | 409 | `{ order_item_id }` | comp on a pending weight |
| `COMP_NOT_ALLOWED` | 409 | `{ reason: 'not_live' \| 'return_line' \| 'deal_part' \| 'not_submitted' }` | §3.9 |
| `COMP_PENDING` | 409 | `{ alert_id }` | second comp request on a line |
| `ORDER_BILLED` | 409 | `{ order_id }` | edit after the bill closed |
| `QUEUED_COMMAND_EXPIRED` | 409 | `{ queued_at }` | §3.12 (defined by 00 v1.8, H-1) |

Reused: `BUSINESS_DAY_NOT_OPEN`, `ORDER_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`, `RETURN_ALREADY_OPEN`, `STATION_PAUSED`, `ITEM_WRONG_STAGE`, `MENU_ITEM_NOT_FOUND`, `DEAL_NOT_FOUND`, `ZONE_NOT_FOUND`, `TABLE_*` (02a), `PERMISSION_DENIED`, `VALIDATION_FAILED`.

---

## §10. Tests (`apps/hub/test/orders/*.test.ts`, client tests in `apps/client`)

| # | Area | Case |
|---|---|---|
| 1 | Submit | dine-in happy path: batch order exactly 03a :615 (lock → `OrderPlaced` → `ItemAdded`s in `order_item_ids` order → `StockReserved`); `table_key = 'dine_in:' + seating_id`; result has groups with `promise_ms`, no `target_land_ms` |
| 2 | Submit | each `line_kind` copies 01c §4.3 exactly (item, option_child with `option_quantity`, deal, deal_part allocation 229 315 / 12 508 / 78 177); batch program cook times copied (B1) |
| 3 | Submit | config applied between preview and submit: lines use the config at submit (D25) |
| 4 | Submit | no open day → `BUSINESS_DAY_NOT_OPEN`; nothing appended |
| 5 | Submit | reused `order_item_id` (live, in projection, repeated) → `ORDER_ITEM_ID_IN_USE` before append (03a AD-29 Q5) |
| 6 | Submit | Off / out of hours / unsatisfiable group / linked option unavailable → each code; windows on hub time |
| 7 | Submit | `sold_out` item with 0 < available < needed → `ITEM_SOLD_OUT { available }`; `cook_fresh` item → accepted, full cook time, `corrected` |
| 8 | Submit | paused station → `STATION_PAUSED` |
| 9 | Race | two submits for the last Paye: one `from_stock`, the other full cook time; stock never negative |
| 10 | Rounds | second round: new order; `follow_up` true only after a served line in the seating; earlier promise unchanged |
| 11 | Zone | route: leaf zone route wins over floor and branch; takeaway ignores zone routes |
| 12 | Zone | `from_zone` raita at a zone table: no engine line (empty `order_item_ids` order never planned, Q-3), `ItemServed` in the batch, zone count − 1, low alert at threshold |
| 13 | Zone | `from_zone` when empty → `ZONE_STOCK_EMPTY`; two submits on the last raita: one wins |
| 14 | Zone | refill with draws: `StockTransferredOut` per draw, branch available drops; short → `STOCK_INSUFFICIENT`; set count leaves branch stock |
| 15 | Token | takeaway tokens 1, 2, 3 per business date; reopen same date continues; dine-in / parking null |
| 16 | Remove | partial remove 4 → 3 naan: `ItemRemoved { units: 1 }`, stock released share, engine units 3 (Q-4); comped units shrink last |
| 17 | Remove | removing every line → `OrderCancelled` in the same batch; 02a fold sees it |
| 18 | Remove | started line → `ITEM_WRONG_STAGE`; deal part alone → `DEAL_PART_NOT_REMOVABLE`; lock held by another → `TABLE_ALREADY_LOCKED` |
| 19 | Weight | pending line: `LineWeightSet` total from the copy, not current price; correction allowed; non-weighed → code |
| 20 | Served | tap serves lines across 2 orders: one `ItemServed` per order, `stockEffects` array form, from-stock line with no Start consumes (AD-29 Q7); repeat → skipped |
| 21 | Served | no lock needed; takeaway by its placer with `own_tables` → allowed; another order taker → `outside_scope` |
| 22 | Release | `ReleaseItems` closes the slip alert `done`, `ItemsReleased.alert_id` set; no alert → null |
| 23 | Return | 03a #101, #103, #107, #114 command halves: money 0, `return_of`, `cook_ms_override` on fix, `ItemReturned` on remake, second → `RETURN_ALREADY_OPEN`, exited order → `ORDER_NOT_IN_ENGINE` |
| 24 | Comp | allowed grant: `LineComped` value per 01c per-unit split; approval grant: kind `comp` raised, approve → `LineComped { alert_id, approver_staff_id }`, reject → nothing; second request → `COMP_PENDING`; `apply` read-only (a write throws) |
| 25 | Totals | `seatingTotals` 1 statement: lines − comps − removed − refunds (fixture `ItemVoided { refund_minor }`), pending weight 0 |
| 26 | Queue | `X-Queued` replay of an ended session's submit: accepted, actor = original staff, `sent_after_reconnect`; older than the limit → `QUEUED_COMMAND_EXPIRED`; revoked device / left staff → refused; queued submit on a free lock does not take it (P-1b) |
| 27 | Queries | `eta-preview` writes nothing, reserves nothing, `countsAsActivity: false` (README :176); statement counts per §6 |
| 28 | Replay | live projection = replayed projection over a fixture day |
| 29 | Client | queue: command stored before first send; no "sent" before 2xx; 4xx kept in the log; drafts survive reload |
| 30 | Client | stepper capped at available; zone-empty flip; day-not-started banner per permission |

### Acceptance

| Story AC | Tests |
|---|---|
| E2-TBL AC9 (dine-in, takeaway, parking) | 1, 15 |
| E2-ADD AC1–AC4 | 10, 1 |
| E2-ETA AC1–AC6 | 27, 1, 7, 9 |
| E2-SOLD AC1–AC3 | 6, 7, 30 |
| E0-ORD AC1–AC2 (hold, notes) | 29, 2 |
| E0 comps AC3, AC5 | 24 |
| E5-DEV AC1–AC4 | 26, 29 |
| Z3–Z5, Z7 | 11–14 |
| Owner Q4 (token), Q6, Q7, Q8 | 15, 24, 20–21, 26 |

---

## §11. Build order (one task per commit, TDD)

1. Errors §9 → `errors.ts`, F §6.2 append (no bump, R34).
2. Event schemas: E-1 additive fields; `OrderCancelled`, `LineWeightSet`, `LineComped`, `ZoneStockAdded`, `ZoneStockSet` (`packages/events/src/events/{order,zone}/`).
3. Migration §5; projection `orders` with `reset` (test 28).
4. `buildProposedOrder` + zone routing (§3.2 steps 4–7, §3.10) — pure, in `apps/hub/src/orders/proposed.ts` (tests 2, 3, 6, 11).
5. `SubmitOrder` (tests 1, 4, 5, 7, 8, 9, 10, 15).
6. Zone-served path in submit (tests 12, 13) — needs 03a Q-3.
7. `eta-preview` (test 27).
8. `RemoveItems` + `orderEmptiedDrafts` (16–18) — needs 03a Q-4.
9. `SetLineWeight` (19).
10. `MarkServed` (20, 21); tick `served_estimate` stub.
11. `ReleaseItems`, `BoostOrder` (22).
12. `ReturnToKitchen` (23).
13. `CompLine` + kind `comp` (24).
14. `AddZoneStock`, `SetZoneStock`, kind `zone_stock_low` (14) — needs 01a A-1, 03a Q-5.
15. Exports §4.2; `seatingTotals` (25).
16. Queries §6.15–6.17, catch-up `orders`, audiences.
17. Queued acceptance on the hub (26) — needs 00 H-1, 02a P-1b.
18. Client: queue (IndexedDB; SQLite in 9b's app), drafts (29).
19. Client: ordering screen, options sheet, preview (30).
20. Client: table view orders part, comp waiting card, zone stock screen, open orders.
21. Acceptance pass; README rows closed.

---

## §12. Definition of Done, checklist, questions, deferred

### 12.1 Definition of Done

All §10 tests green under the gate; §4.5 rows approved and applied in their specs first (F v1.11, 00 v1.8, 01a v2.3, 01b v1.7, 02a v1.1, 03a v1.2); every command cites its section; statement counts asserted; README index and carried rows updated; no approved spec diverged from.

### 12.2 Endpoint checklist

| # | Endpoint | Permission | Section | Tests |
|---|---|---|---|---|
| 1 | `submit-order` | take-order | 6.1 | 1–15 |
| 2 | `remove-items` | take-order | 6.2 | 16–18 |
| 3 | `set-line-weight` | set-line-weight | 6.3 | 19 |
| 4 | `mark-served` | mark-served | 6.4 | 20, 21 |
| 5 | `release-items` | mark-served | 6.5 | 22 |
| 6 | `boost-order` | boost-order | 6.6 | 22 |
| 7 | `return-to-kitchen` | mark-item-returned | 6.7 | 23 |
| 8 | `comp-line` | apply-comp | 6.8 | 24 |
| 9 | `add-zone-stock` | manage-zone-stock | 6.9 | 14 |
| 10 | `set-zone-stock` | manage-zone-stock | 6.10 | 14 |
| 11 | tick `served_estimate` | — | 6.11 | todo |
| 12 | kind `comp` | — | 6.12 | 24 |
| 13 | kind `zone_stock_low` | — | 6.13 | 12, 14 |
| 14 | `eta-preview` | staff | 6.14 | 27 |
| 15 | `seating-orders` | staff | 6.15 | 27 |
| 16 | `open-orders` | staff | 6.16 | 27 |
| 17 | `zone-stock` | staff | 6.17 | 27 |
| 18 | catch-up `orders` | staff | 6.17 | 28 |

### 12.3 Open questions

| # | Question | Default until answered |
|---|---|---|
| Q1 | (G2) Parent zone routing: should a floor-level route apply to tables with no zone? | yes (floor = implicit zone's parent) |
| Q2 | (G2) Can a comp be undone before the bill? | no; 05 handles a wrong comp at the bill |
| Q3 | (G2) `units` for `g` / `ml` lines in 03a: confirm 1 (whole line) | 1 |
| Q4 | (G2) `zone_stock_low` target: does 01d have a permission-holders resolver scoped to a zone, or does 02b register one? | 02b registers `zone_stock_keepers` (1 statement) |

### 12.4 Deferred until needed

Delivery and web types; later child additions ("one more naan" attached), with README :201's `max_quantity` rule; reorder; kitchen-note edit after submit; manager view of held orders; sibling-zone transfer (Z6) and day-end zone recount prompt (Z8); estimated Served (live once 03b ships); hub-down manager alert (06 / 01e); customer tracking (P2).

### 12.5 Hostile self-review (v0.1)

- **Races:** last stock unit, last zone unit, token, ids — all inside the single writer (§7). Comp approval vs removal of the same units: `apply` re-checks live units (§3.9).
- **Idempotency:** D32 + device ids; a queued replay of an already-processed command hits M19 first.
- **Contradictions checked:** 03a :615 batch order (§3.2 step 10); 02a :240 `requireLock` (with P-1b); 01c :413 weight event; 01d :737 comp kind contract; F §5.9 step 10 (row F-1).
- **Known dependency risks:** steps 6, 8, 14, 17 of §11 need 03a v1.2, 01a v2.3, 00 v1.8, 02a v1.1 first; the Android queue needs 9b's app (tablet model OQ2).
- **YAGNI:** no outbox, no cache, no new library; zone stock is a projection plus two commands; the estimate tick is a stub.
