# 02b Ordering — Module Spec

| | |
|---|---|
| Doc | Module spec, **v1.0 — FINAL, awaiting the developer's approval** (2026-11-07; simplified by the owner, §12.14). Review trail: G2, G4 runs 1–3, targeted check, re-check (`docs/reviews/02b_v0.5.1_recheck.md`, verdict **APPROVE WITH WORDING FIXES**, R-1–R-4 applied here, §12.10). On approval the §4.5 rows are applied to their specs (§12.1); not yet built. |
| Depends on | Foundation **v1.10**, 00 Hub Platform & Access **v1.7**, 01a Restaurant Setup **v2.2**, 01b Staff & Roles **v1.6**, 01c Menu Variants **v1.1.1**, 01d Notifications & Requests **v1.2**, **02a Tables v1.0**, **03a Timing Engine v1.1** (and the engine lane's as-built code on `module-03a`, read at `d4ee16a`; engine and event files equal to `f7e04dc`) |
| Inherits | Shared Standards from Foundation v1.10 §6. Not redefined here. |
| Inputs | `docs/stories/02b-g0.md` (G0, owner answers §5.4), `docs/stories/02b-g1-decisions.md` (G1-1–G1-20), `docs/stories/02-g0.md` §5.4, `01d-g0-decisions.md` Z1–Z8, C1–C4, G0-6; 03a build carried rows (AD-17, AD-19, AD-29, AD-30). |
| Rigor | T2 (CLAUDE.md). |

### Changelog

| Version | Change |
|---|---|
| v0.1 | First draft from G0 + G1. |
| v0.2 | G2 fixes (`02b_v0.1_g2_completeness.md` #1–#14). |
| v1.0 (run 4 fixes, 21:20) | `docs/reviews/02b_v1.0_hostile_run4.md` B-1, M-1–M-6, m-1–m-10 (§12.16): `X-Queued-At` in 00's CORS preflight list; g/ml deal part partial remove / void refused while open; `paused_since` for the 4 h cap; zone counts to every staff screen; an empty zone sends the line to its station (`ZONE_STOCK_EMPTY` dropped); CANCELLED slip on partial removes; defaults match 01b; minors. |
| v1.0 (simplified check fixes, 21:10) | `docs/reviews/02b_v1.0_simplified_check.md` S-1–S-7 (§12.15): re-pause after a request with no socket; M5 save of the shifted clock; late cards grouped by the oldest order's current table; pending logout; `idle_ttl_ms` in H-1; tests. |
| v1.0 (simplified, 21:00) | Owner, 2026-11-07, "are we over-complicating?" (§12.14): **(1) H-1 replaced by one rule — the idle clock runs only while the device is connected.** A session never times out while its tablet cannot reach the hub (cap 4 h), so a queue replays as a normal live command; the device runs its own idle lock. Dropped: acceptance of ended sessions, `device_back_at`, `last_replay_at`, drain window, return detection, end-reason list, `QueuedCommandAccepted`, `QUEUED_COMMAND_EXPIRED`, the new index. An ended or unknown session → queue log with one-tap "Send again". **(2) Q-7 dropped — one late card per current table is a screen rule.** The engine and 03a's tick are unchanged (one `slip_warning` per original seating); the waiter's screen groups open slip warnings by current table into one card. |
| v1.0 (re-check 2 fixes, 20:55) | `docs/reviews/02b_v1.0_owner_recheck2.md` N-1–N-6 (§12.13): the non-food-return `OrderFoodCleared` is gated on "no live unserved food line" and `OrderFoodServed` also sets `has_food = 1` (N-1); Q-7 binding is one reconcile rule for every seating change (N-2); wording N-3–N-6. |
| v1.0 (owner re-check fixes, 20:40) | `docs/reviews/02b_v1.0_owner_recheck.md` B-1, M-1–M-7, m-1–m-5 (§12.12): explicit **ready-item flag** on the item (`is_ready_item`, A-1 / C-1, `order_lines.is_food`) instead of `cook_time_ms > 0`; table state ORDERED / FOOD_ON_TABLE chosen over food orders only, a drinks-only table shows ORDERED; `OrderFoodServed` on every serve of a food line; `OrderFoodCleared { food_served }`; Q-7 completed (engine `foldAlertClosed` for every key, tick due on seating changes, split stays with the oldest order's seating, tick mechanics); `manage-zone-stock` default only owner and manager; "return" of a device defined; To 04 permission-aware default. |
| v1.0 (owner Q5, 20:20) | **Q5 answered:** only **food lines** (items that need preparing) make a table "food on table"; ready items (zero preparation: water, drinks, packed items, zone raita) never do, wherever they come from. 02b tells 02a with `OrderFoodServed` / `OrderFoodCleared`; `OrderPlaced.has_food`; `OrderKitchenCleared` renamed `OrderFoodCleared`. Zone low / out alerts go to the holders of `manage-zone-stock` (the refill person, whatever their role) and to managers. Reheated items stay pre-cooked stock items. Needs the same re-check. |
| v1.0 (owner answers, 19:30) | Owner answers (§12.3): Q1 keep contact; Q3 (1) remade dish stays billed — confirmed; Q3 (3) **a joined table gets one late warning** (O18 reversed, 03a row Q-7 host-side); Q3 (4) voided comp reads as a voided comp — confirmed; Q4 (a) **a returning device is accepted at its first contact after any disconnect** (no 2-minute threshold); Q4 (b) residual accepted. Q3 (2) table state for ready items **open** (§12.3 Q5). Needs a re-check of this diff. |
| v1.0 | Re-check wording fixes R-1–R-4 and the §8 re-order note (§12.10): the queued residual bounded by `now − ended_at ≤ queue_auto_send_max_ms` (R-1); the drain window slides with accepted replays, and the remaining short-re-drop loss is written down (R-2); the gap is measured from the device's **previous** contact, with M46 / login step 0 and refused socket connects covered (R-3); "kitchen line" defined (R-4). |
| v0.5.1 | Targeted-check fixes N-1–N-7 (§12.9): **ruling N-1** — `device_back_at` re-stamped after every gap, drain window from the latest stamp; N-2 `OrderKitchenCleared` on "no live unserved kitchen line"; N-3 comp `note` in the raise; N-4 comp value sums every touched line; N-5 `view-customer-contact` default scopes; N-6 O16 wording; N-7 `available` minus earlier claims. |
| v0.5 | G4 run 3 fixes (`02b_v0.4_hostile_run3.md` #1–#27), closure §12.8: `deal_part` billed 0 (#1); stage 1 = engine stage `added` (#2); deal headers derived from parts (#3); capped cascades (#4); P-1d live kitchen-line count (#5); no second Return on a remade line (#6); **ruling (#7, #26): queued `idle_timeout` commands accepted up to the device's first contact after the session ended, within a drain window**; goes-with pre-ticks in `expedite` (#8); **ruling (#27): new permission `view-customer-contact`**; minors #9–#25. |
| v0.4 | G4 run 2 fixes (`02b_v0.3_hostile_run2.md` #1–#24), closure §12.7. Developer rulings as the owner's proxy on the owner-marked findings: **deal money follows 01c §3.4.8** (per-part ledger, #1); **remade units stay billable** (#2); **a zone serve counts as served only for an order with no kitchen line** (#3); **02a T21 kept, Q-7 dropped** (#6); **contact in its own event** (#9); **`mark-served` default `branch`, AD-32 kept** (#10); **a voided comp is reported as a voided comp** (#15). Also: every bill writes `OrdersBilled` (#4); lines out of the engine (#5); H-1 accepts only `idle_timeout` / `hub_restored` with no later session on the device (#7, #8); minors #11–#24. |
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
| O11 | **Queued auto-send** (owner Q8, 00 H-1, simplified 2026-11-07): only queueable command types; the session stays alive while its device is disconnected (idle clock paused, ≤ 4 h), so the queue replays as normal live commands. A command whose session has ended is never accepted; it goes to the queue log (§3.12). |
| O12 | **Token** for takeaway only; from 1 per business date per branch. |
| O13 | **Comps on submitted lines only**; comps and every PIN-capable action are online only. |
| O14 | **Estimated Served** is specified here and registered when 03b's `Handover` exists (no tick before that). |
| O15 | **Short stock** is refused (03a AD-19); the client caps the stepper. |
| O16 | **Served needs a fired line** (stages: fired-not-started, cooking, cooked); unfired lines are never served (F-1). A line of an order that has **left the engine** (abandon or exit) counts as fired for Served and as past stage 1 for Remove. **Remove** = stage 1 = engine stage `added` (fired or not, §3.5, F §4.2); a fired line's removal prints a CANCELLED slip (03b). |
| O17 | **Customer contact** (phone, name) is never on `OrderPlaced`: it travels in its own event `OrderContactSet`, whose audience is cashier kiosks and the placer's sessions; others see `has_phone` and fetch it on demand (`order-contact`, logged). It stays in the immutable event log and the cloud (§12.3 Q1 for the owner). |
| O18 | **One late card per current table** (owner, 2026-11-07; simplified the same day): the engine and 03a's `fires_alerts` tick stay as built — one `slip_warning` per original seating (02a T21, `table_key` never re-keyed). The **screen** groups the open `slip_warning`s whose seating now belongs to the same current table (02a `currentTableOf` on the alert's oldest order, `values.order_ids`; the table never comes from `table_key`, 02a :251) into **one card** ("T4 + T5 — 2 late"); each warning keeps its own buttons inside the card. A joined table may ring twice; it shows once. After a split each warning shows under its oldest order's current table. No engine or tick change (03a row Q-7 dropped). |
| O19 | **Deal money follows 01c §3.4.8** (run 2 #1): a `deal_part` line carries its own refundable amount and ledger; the deal line's billed amount is its total minus its parts' money out. |
| O20 | **Remade units stay billable** (run 2 #2): a remake frees nothing by itself; the manager comps or 04 voids the burnt dish if it should be free. Only the replacement line is free. |
| O21 | **A voided comp stays a comp** (run 2 #15): voiding a comped unit moves its share to `comp_voided_minor`, reported by 05 as a voided comp, never as a refund. |

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
| `dine_in` | the seating (02a) | `'dine_in:' + seating_id` (02a T21; never re-keyed, O18) | `requireLock` | — |
| `takeaway` | token | `'takeaway:' + order_id` | none | `token`, `customer_name?`, `phone?` |
| `parking` | car number | `'parking:' + car_number_norm` | none | `car_number`, `car_type`, `phone?` |

`car_number_norm` = upper-case, spaces and dashes removed; `car_number` stored as typed (2–12 of letters, digits, space, dash). `car_type` ∈ `sedan | mini | large` (required, S10). `phone`: 10–13 digits, stored digits only. `customer_name` ≤ 40. Two parking orders with the same plate share a `table_key` (the same car). `OrderPlaced.table_id` = the seating's primary table at submit (03a field); 02b keeps no copy of it.

### 3.2 Submit (`SubmitOrder`)

1. **Day:** `openDayStartMs(state)` null → `409 BUSINESS_DAY_NOT_OPEN` (O8). `business_date` from the open day.
2. **Type:** `dine_in` needs `{ table_id, seating_id }` (both required); `seatingOf(table_id)` ≠ given → `409 TABLE_SEATING_CHANGED`; `requireLock(tx, { table_id, seating_id }, { ...ctx, queued })` → its drafts (02a; P-1b: a queued submit never takes a free lock); **`queued` = the request carried a valid `X-Queued-At` on a queueable command (§3.12)**.
3. **Ids** (O3): an id repeated inside the payload → `400 VALIDATION_FAILED` (path `lines.N.order_item_id`, C6); an id already in `orders` / `order_lines` or live in `EngineState` → `409 ORDER_ITEM_ID_IN_USE { order_item_id }` or `{ order_id }`.
4. **Lines from config** (D25): item / variant / deal from `branchConfig()`; missing → `404 MENU_ITEM_NOT_FOUND` / `DEAL_NOT_FOUND`; manual Off → `409 ITEM_UNAVAILABLE`; outside its or its category's windows on hub time → `409 ITEM_OUT_OF_HOURS { item_id, opens_at_ms | null }` (S47); options through `checkOptionChoices` → `422 OPTION_CHOICE_INVALID { order_item_id, violations }`; a required group not satisfiable → `ITEM_UNAVAILABLE`.
5. **Zone-served** (O5, §3.10): a line marked `from_zone: true`, `line_kind 'item'`, no options, `dine_in`, the primary table's zone lists the item, and `on_hand − claimed ≥ quantity` (claims counted across the payload in line order, as `reserveStock` does) → zone-served, `served_from_zone_id` set. Any check failing → the line is a **normal kitchen line** (routed per step 6, `zone_served: false` in the result) — never a refusal, so a queued order with a zone item is not lost when the zone emptied meanwhile (run 4 M-4).
6. **Routing** (O4): each engine line's `station_id` = the zone route of the primary table's zone (dine-in only) else the branch route; `alternates`, points and carry from 01a A-9 / A-10 for the order type.
7. **Build** `ProposedOrder` (03a §4.2): `lines` = every line except zone-served ones (deal headers included; the engine skips them, 03a :245); `order: { order_type, table_id, table_key, follow_up, pickup_at_ms: null }`. `OrderPlaced.order_item_ids` = the same ids in the same order (03a `OrderPlaced` field; `ProposedOrder` has none).
8. **Engine:** `checkOrderable(state, proposed)` → `409 STATION_PAUSED { station_id }`; a line with `out_of_stock_behaviour 'sold_out'` and available < needed → `409 ITEM_SOLD_OUT { item_id, available }` (O15); `reserveStock(state, proposed, dayStartMs, stockItems, configStockUnits)` → `{ drafts, from_stock, refused }` (as built, `stock.ts:159-185`); a `refused` line's `available` for `ITEM_SOLD_OUT` = min over its draws of `saleUnitsAvailable(availableStock(…) − the draw's units claimed by earlier lines of the payload, quantity_per_sale_unit)` (as `reserveStock` counts them); `planOrder(state, proposed, now, from_stock)` → groups, lines (route fields copied verbatim into `OrderPlaced.lines[]`, AD-17).
9. **Token** (O12): takeaway → `1 + MAX(token)` over `orders` of the `business_date`.
10. **Append** in this order (03a :615): lock drafts → `OrderPlaced` → `ItemAdded` × n in `order_item_ids` order → zone-served `ItemAdded`s → `StockReserved` × n → `ItemServed { order_item_ids: zone-served ids, source: 'zone' }` (if any) → `OrderContactSet { order_id, customer_name, phone }` (if either was given, O17) → the drafts of `alerts.raise` for `zone_stock_low` / `zone_stock_out` (§3.10).
11. **Result** `{ order_id, token | null, groups: [{ group_id, promise_ms, order_item_ids }], lines: [{ order_item_id, eta_ms | null, from_stock, zone_served }] }` — `promise_ms` only, never `target_land_ms` (03a #9). The client compares with its last preview and shows "time updated" when a promise moved ≥ 60 s (03a Q4).

**Statements:** 1 seating + lock (02a) + 1 ids (orders ∪ order_lines) + 1 `follow_up` (02a `seating_orders` ⋈ 02b) + 1 zone counts + 1 token + 1 `item_availability` + append batch (+ 1 per raised alert, 01d's bound); engine in memory. p99 < 60 ms at 12 lines.

### 3.3 Rounds, `follow_up`, open and billed

- Every submit is a new order (O1). `follow_up` (dine-in only) = an order of the **current** seating (02a `seating_orders`, P-1c) has a **food line** served (02b's own `order_lines`). Takeaway / parking: `false`.
- **Food line** (owner Q5; used below and in §3.5): an engine line (`isEngineLine`: a station, not a `deal`, 03a `plan.ts:17`) that is not zone-served and whose item is **not a ready item**. **Ready item** is an explicit item setting (`is_ready_item`, default false; 01a A-1, copied on `ItemAdded`, 01c C-1, stored as `order_lines.is_food` = engine line ∧ not zone-served ∧ ¬`is_ready_item`), set by the owner on water, drinks, packed items. Zone-served lines are never food. A pre-cooked item served from stock (reheated karahi, cold paye) is food unless the owner marks it ready. `cook_time_ms` is not used for this (01a requires it ≥ 1).
- **Table state (P-1d, final, owner Q5):** a seating's **live orders** stay every order with `cancelled = 0` (SEATED test, bill request, cleaning, merge / split guards — unchanged). Only the ORDERED / FOOD_ON_TABLE choice looks at **food orders** (`OrderPlaced.has_food`, E-1): FOOD_ON_TABLE when the seating has a live food order and every live food order has `served_any = 1`; ORDERED otherwise — so a table with only drinks / zone items shows ORDERED (never green), and a drinks round after mains leaves it green. `served_any = 1` is set only by 02b's **`OrderFoodServed { order_id }`**, appended after **every** `ItemServed` that serves at least one food line (tap, the estimate tick, a return's replacement; a repeat 1 → 1 is harmless). `OrderFoodServed` also sets `has_food = 1` in 02a (a food line can reach an order that was cleared earlier). `OrderLinesAdded` (a return) still resets `served_any = 0` in 02a; when the returned line is **not** food (a water bottle sent back) **and the order has no live unserved food line**, 02b appends `OrderFoodCleared { food_served }` right after it; if a karahi of that order is still cooking, nothing is appended and the order waits for the karahi's `OrderFoodServed`. **`OrderFoodCleared { order_id, food_served: boolean }`** is appended when `RemoveItems`, `lineChangeDrafts` (04's voids) or a non-food return (gated as above) leave a live order with no live unserved food line; `food_served` (02b computes it from `order_lines`) → 02a sets `served_any = 1`, else `has_food = 0`.
- **Grouping** is always 02a's current `seating_orders` (read-only join, P-1c): `seating-orders`, `ordersOf`, `seatingTotals`, `follow_up`.
- **Billed:** every bill close writes `OrdersBilled { order_ids, bill_id }` (05, To 05; dine-in included — 05 reads `seating_orders` at close); the fold sets `billed_at` for every order type. Until 05 exists no order is billed.
- **Day close:** `BusinessDayClosed` sets `day_closed_at` on **every open order** (any earlier date included) that is cancelled, billed, or whose lines are all served, removed or voided. An order with a line still unserved stays open (billing is not a condition; 05 still bills it from `seating_orders`, run 4 m-3) and is shown under the next day with its **date beside its token** ("57 · 6 Nov", To 03b).

### 3.4 Units and the per-line money ledger

- **Units** of a line: `quantity` for `piece` lines; `1` for `g` / `ml` lines and while a weight is pending (= 03a :246); `quantity` for `deal` lines; a `deal_part` line's units per 01c :309 (piece part: part quantity × deal quantity; g / ml part: deal quantity); `option_child` lines follow their parent's units by `childQuantity`.
- **Refundable amount** (`refundable_minor`): `line_total_minor` for `item` and `option_child` lines; for a `deal_part` line, `allocated_price_minor` + its option charges (01c §3.4.8, :308–:311); `0` for a `deal` line (its money lives in its parts) and for return lines.
- **Unit states** (money): `live`, `live_comped`, `removed`, `voided`. A remade unit (`ItemReturned`) **stays live for money** (O20): it can still be comped or voided; `returned_units` is kept for the engine view only. `live_units = units − removed − voided`. An order with no live line is cancelled (§3.5).
- **Ledger.** `shares = allocateDealMinor(refundable_minor, [1 × units])`: every share is `q = floor(refundable / units)` except the last, `q + r` (01c, BigInt-safe). Units leave billing in order; the k-th unit to leave (k = `comped_units + removed_units + voided_units` before the action, returns not counted) takes `shares[k]`.
  - **Remove / void** take **uncomped** live units first. When they must take a comped unit, the unit leaves `comped_units` (and joins `removed_units` or `voided_units`) and its share leaves `comp_minor`: one unit's take-back = `comp_minor − q × (comped_units − 1)` (the remainder share, if a comp holds it, goes first; otherwise `q`), derived from the counters alone; on remove it moves to `removed_minor`; on void it moves to **`comp_voided_minor`** (O21), never to `refund_minor`.
  - **Comp** takes the next free shares.
  - Columns: `comp_minor`, `comp_voided_minor`, `removed_minor`, `refund_minor`. `billed_minor` of an `item` or `option_child` line = `refundable_minor − comp_minor − comp_voided_minor − removed_minor − refund_minor`. A **`deal_part` line's `billed_minor` = 0** (01c :303): its `refundable_minor` and counters only feed its deal line. A `deal` line's `billed_minor` = its `line_total_minor` − Σ over its parts of (`comp_minor + comp_voided_minor + removed_minor + refund_minor`) — the 01c rule "the deal total minus every refund already made on its parts".
  - Invariant per line: `comp_minor + comp_voided_minor + removed_minor + refund_minor ≤ refundable_minor` (CHECK); property test as 01c #119.
- **Deal headers:** a `deal` line is never in `EngineState` (03a `apply-event.ts:445-447`). Its stage and served state are **derived from its parts** (01c :306): at stage 1 when every part is; served when every live part is served; live while any part has a live unit. `MarkServed` never names a header; day close, `ready n / m` and "no live line" (§3.5) look at parts only.
- **Deal actions:** removing, voiding or comping `n` **deal** units applies `n` portions to every part (per-portion units, 01c :309) in the same transaction. Removing deal units is allowed only when **every part line it touches is at stage 1** (§3.5), else `ITEM_WRONG_STAGE`. **g/ml deal parts:** the engine counts a g/ml line as 1 unit (03a :244, `plan.ts:23-26`), so removing fewer than all live units of a deal with a g/ml part (or of a g/ml `deal_part` alone) while that part is open in the engine (stage before `served`) is refused `422 VALIDATION_FAILED { path: 'lines.N.units', reason: 'gml_deal_part_partial' }` — remove the whole deal and re-add (run 4 M-1). A single part's units can be voided by 04 (01c) and removed at stage 1 by 02b; a part alone is never comped (comp the deal unit).
- **Cascade to children:** a remove, void or comp of `n` parent units applies to each `option_child` the units `childQuantity` gives.
- **Cascades are capped** (01c :312): each part or child line gives `min(per-portion units × n, its live units)` for remove / void and `min(…, live − comped units)` for comp; the parent's **last** live unit takes every remaining part / child unit.
- **Cascades are events per line:** every cascaded line gets its own `ItemRemoved` / `ItemVoided` / `LineComped` with its own units and money; folds never cascade; a parent's `LineComped.value_minor` is its own share only (the command result may sum); inside the comp `apply` every `LineComped` carries the alert id (01d `checkAlertIds`).
- **Weights:** `SetLineWeight` on a line with any unit out of billing → `409 LINE_ALREADY_SETTLED`. The `LineWeightSet` fold sets `refundable_minor = line_total_minor` (a weighed line starts at 0).
- **`lineShares(line)`** (pure, exported): input `{ refundable_minor, units, comped_units, removed_units, voided_units, comp_minor }`; returns `next_share_minor(n)` (shares `k … k+n−1`) and `comped_take_back_minor(n)` (the take-back rule above applied `n` times). 04 uses it for every void (To 04).

### 3.5 Remove at stage 1 (`RemoveItems`) and `OrderCancelled`

- **Stage 1** (F §4.2): the `EngineState` line has `stage === 'added'` (fired or not, O16); any other stage (`cooking`, `done`, `served`, `returned`) — including a Done or Served line with no Start — is past stage 1. Past it → `409 ITEM_WRONG_STAGE { order_item_id, stage }` (the client offers 04's void). A line of an order no longer in the engine (abandon or exit, O16) → `ITEM_WRONG_STAGE { stage: 'out_of_engine' }`. A fired line's removal is printed as a CANCELLED slip by 03b (To 03b).
- **Zone-served line** (checked by the zone rule only, **before** any engine-stage check, so a zone-only round is undoable): removable within `zone_undo_ms` (branch setting, default 300 000) of its `ItemAdded` — a check of the command only; the fold always adds the units back to the zone count. Later → `ITEM_WRONG_STAGE` (manual Count, §8). F-1 lists this exception.
- Each entry `{ order_item_id, units? }`: keyed entries, a repeated `order_item_id` → `400 VALIDATION_FAILED` (C6); absent `units` = all live units; `units > live_units` → `422 VALIDATION_FAILED`; partial on `piece`, `deal` and `deal_part` lines (§3.4 units). A `deal_part` alone may be removed (its share per §3.4, O19).
- **Drafts:** per line `ItemRemoved { order_item_id, units }` (03a Q-4) + `stockEffects(ItemRemoved)` releasing **that share** (Q-4) → stale comp requests closed (§3.9, one `alerts.listOpen` for the order) → `OrderFoodCleared { order_id, food_served }` when the order keeps a live line but no live unserved food line (§3.3) → `OrderCancelled { order_id }` when no live line is left. A zone undo that lifts a count above its threshold closes `zone_stock_low` / `zone_stock_out` `done` (one `alerts.listOpen` for `zone:<id>`, only when a zone line is in the payload; run 4 m-6).
- **Export** `lineChangeDrafts(tx, order_id, changes: { order_item_id, units_out }[])` returns `OrderCancelled` (if the order is emptied), `OrderFoodCleared { food_served }` (§3.3; it computes `food_served` from the lines it already reads) and the stale comp-request closes; 2 statements (lines, `alerts.listOpen({ kind: 'comp', subject: order })`); 04 calls it in every void transaction (To 04).

### 3.6 Weighed lines (`SetLineWeight`)

A line with `requires_weighing` and `quantity null` is pending. `SetLineWeight { order_item_id, quantity }` (S59 steps of 50, 50–50 000) → `LineWeightSet { order_item_id, quantity, line_total_minor }`, total from the **`ItemAdded` copy** (01c M7). A correction is allowed until the bill closes, unless a unit left billing (`LINE_ALREADY_SETTLED`). Non-weighed → `409 LINE_NOT_WEIGHED`; billed → `409 ORDER_BILLED`.

### 3.7 Served (`MarkServed`) and the estimate

- `MarkServed { lines: [{ order_id, order_item_ids }] }`; no lock (D39). A line must be **fired** (in a dispatched load, or started, or done), or belong to an order that has left the engine (O16; no `stockEffects` for it); an unfired line → `409 ITEM_WRONG_STAGE { order_item_id, stage: 'added' }`, nothing written. Already served → skipped (`result.skipped`). Removed / voided → `ITEM_WRONG_STAGE`.
- One `ItemServed { order_item_ids, source: 'tap', served_at? }` per order, followed by `OrderFoodServed { order_id }` after every `ItemServed` that serves at least one food line (§3.3), (`served_at` = the accepted `queued_at` when the command was queued, §3.12; 03a v1.2 Q-6 additive, the engine and 02b use `min(served_at, recorded_at)` as for `ItemStarted`) + `stockEffects` drafted from folded state, array form across the whole command (03a AD-29 Q7).
- **Estimated Served** (G0-6): when 03b ships `Handover`, 02b registers tick `served_estimate` (`due` = 1 indexed statement for handovers older than `served_estimate_ms` with unserved lines; `intents` = `ItemServed { source: 'estimated' }` per order + `stockEffects` + `OrderFoodServed` when it serves a food line). Not registered before (O14).

### 3.8 Release, boost, return

- `ReleaseItems { order_ids, released, expedite }` (sets) → `planRelease` (03a §3.8; it fills `alert_id` per group from memory) → `ItemsReleased` per order; every distinct non-null `alert_id` `planRelease` returned is closed `done` with one `alerts.closeMany` (03a To 02 #7). D12's goes-with pre-ticks are the **client's**: the release sheet pre-ticks goes-with partners; a partner that is not done goes in **`expedite`** (`planRelease` keeps only done lines in `released`, `slip.ts:686-716`); `released` holds only ticked done lines. No extra read. On a joined table the card's "Send what's ready" sends one `ReleaseItems` with every order of the card, so each warning's `alert_id` is closed in that one `closeMany` (O18).
- `BoostOrder { order_id }` → `OrderBoosted`; not in the engine → `409 ORDER_NOT_IN_ENGINE`.
- `ReturnToKitchen { order_item_id, return_order_item_id, mode: 'fix' | 'remake' }` (03a §3.8a; whole served line; no note): served, its order in the engine, not zone-served, **not already remade** (`returned_units > 0` → `ITEM_WRONG_STAGE { stage: 'returned' }`; the client offers Return on the replacement line; if the replacement was removed or voided, the dish is ordered again as a new round — the engine never re-returns a `returned` line), no open return (`409 RETURN_ALREADY_OPEN`). Build a one-line `ProposedOrder` (`return_of`, `cook_ms_override` = the item's `adjust_time_ms` for `fix`, money 0, `line_kind 'item'`, links null, `options []`, `quantity` copied) and call `planOrder` for `groups` and `lines` → `OrderLinesAdded` + its `ItemAdded` (+ `ItemReturned` for `remake`). Return lines are never billed or comped. The remade line stays billable (O20); a pending comp request on it stays valid.

### 3.9 Comps (`CompLine`, kind `comp`)

- `CompLine { order_item_id, units, reason_code, note? }` on a submitted live line (O13), remade lines included (O20); not a return line, not a `deal_part` (comp the deal unit, §3.4), not zone-served pending undo → `409 COMP_NOT_ALLOWED { reason }`. `note` is required when `reason_code = 'other'` (E0 AC3: reason required) → else `422 VALIDATION_FAILED`. `units ≤ live_units − comped_units` else 422. Pending weight → `409 LINE_WEIGHT_PENDING`. Billed → `ORDER_BILLED`.
- `value_minor` (the request's `details.amount` and the command result) = Σ over **every line the comp touches** (the line, its option children, a deal's parts) of that line's next free shares; each `LineComped` carries only its own line's value (§3.4). A deal comp therefore shows the deal's value, never Rs 0.
- `defineCommand` with `approvable: true` (00 :470). Grant `allowed` → `LineComped { …, requester_staff_id: caller, alert_id: null, approver_staff_id: null }`. Grant `requires_approval` → `alerts.raise(ctx, { kind: 'comp', subject: { stream_type: 'order', stream_id: order_id }, target: { kind: 'answerers' }, values: { order_id, order_item_id, units, reason_code, note: note ?? null }, details: { item, quantity: units, amount: value_minor, reason }, display, dedupe_key: 'comp:' + order_item_id, requester_staff_id: caller, request: { approver_role_ids: ctx.permission.approver_role_ids } })`; result `{ alert_id, pending: true }`; `deduped: true` → `409 COMP_PENDING { alert_id }`.
- `apply` (approve): read-only re-check; returns `LineComped { …, note: alert.values.note, requester_staff_id: alert.requester_staff_id, alert_id, approver_staff_id: answer.answerer_staff_id }` with `value_minor` recomputed from the current ledger; reject → `[]`.
- **Stale requests:** every write that leaves `live_units − comped_units < requested units` — remove, void (through `lineChangeDrafts`), a direct `allowed` comp by someone else, order cancelled — closes the open `comp:<order_item_id>` request `obsolete` with a note in the same transaction (one `alerts.listOpen({ kind: 'comp', subject: { stream_type: 'order', stream_id: order_id } })` per order); 01d tells the requester. At bill close 05 closes the bill's open comp requests (To 05).
- Stock: a comped line was cooked and served — no stock event (owner A).

### 3.10 Zones: routing and stock

- **Config (01a row A-1):** `zone_item_routes (zone_id, item_id, station_id)`, `zone_stock_items (zone_id, item_id, threshold)` in snapshot V4 `floors[].zones[].routes[]` / `.stock_items[]`. Zones are **flat** (01a v2.2). A table without a zone: no zone routes, no zone stock.
- **Routing:** the primary table's zone route for the item, else the branch route. Dine-in only.
- **Counts:** projection `zone_stock (zone_id, item_id, on_hand)` changed by `ZoneStockAdded` (+), `ZoneStockSet` (=), zone-served `ItemAdded` (−), `ItemRemoved` of a zone-served line (+, always; the undo window is the command's check only). Voids (04) never change it.
- **Refill** `AddZoneStock { zone_id, item_id, quantity 1–500 }`: a zone item of that zone; for each of the item's day draws (`dayDraws`), `draw × quantity` leaves branch stock: short → `409 STOCK_INSUFFICIENT { stock_item_id, available }`; drafts `StockTransferredOut { stock_item_id, quantity, zone_id }` per draw (03a Q-5; 01a A-1 adds it to `STOCK_VERSION_EVENTS`, the stock-frame audience and the boot fold lists, so tiles update within 5 s) + `ZoneStockAdded { zone_id, item_id, quantity, transfers }`. Needs an open day.
- **Count** `SetZoneStock { zone_id, item_id, on_hand 0–5 000 }` → `ZoneStockSet { zone_id, item_id, on_hand, previous }` (`transfers` none; 08 counts zone-served draws beyond transferred quantities, To 08).
- **Alerts:** a count that moves from above `threshold` to ≤ it raises `zone_stock_low` (dedupe `zone_low:<zone_id>:<item_id>`; target `{ kind: 'permission', permission: 'manage-zone-stock' }` — the refill person, whatever their role, owner Q5 (b) — plus `managers` at step 0; 01d's `permission` target is branch-wide, so every refill holder of the branch is told); a count reaching 0 raises `zone_stock_out` (dedupe `zone_out:<zone_id>:<item_id>`), even if the low alert is open. A count back above the threshold closes both `done`.

### 3.11 Token and business day

`orders.business_date` = the open day's `business_date`. Token per §3.2 step 9; unique `(business_date, token)`. A day closed and reopened the same date continues the numbering.

### 3.12 Device command queue

- **Queueable command types (client and hub):** `SubmitOrder`, `MarkServed` (02b), `RequestBill`, `CleanTable` (02a, declared `queueable` by P-1f). `CallWaiter` is **not** queued (a call 2 h late is noise). Nothing else is ever queued.
- **Device:** written to the queue (tablet SQLite in 9b's app; kiosk / phone IndexedDB) **before** the first send, with `command_id`, `queued_at` = the device's estimate of **hub time** (device clock + the offset from the last `hub_time` frame, 01a §4.5), `session_token`, `staff_id`. Replay in `queued_at` order. **The queue is drained before a new login is offered on the device**: the login screen shows "2 orders waiting to send" and sends them first; a staff member can still log in after a failed drain; the old commands then wait in the queue log for "Send again" (see the hub rule). Removed on 2xx or 4xx; a 4xx goes to the **queue log**, except `426 CLIENT_UPGRADE_REQUIRED` (the command stays queued and is retried after the app update) and `403 DEVICE_REVOKED` (the queue is kept when the token is wiped, run 4 m-7) (what, when, why, "Discard", "Copy to a new order" — the copy mints new ids). "Order submitted" only after a 2xx (E5 AC4). Once a cart's command is queued, the cart is frozen; `ORDER_ITEM_ID_IN_USE { order_id }` for the device's own pending order means it was already accepted: refetch `seating-orders` and show it as sent.
- **Hub (00 row H-1, simplified by the owner 2026-11-07): the idle clock runs only while the device is connected.** The hub keeps in memory, per device, its open sockets (session or alert mode) and `paused_at`. When the device's last socket closes (including the hub terminating it after a missed pong, `PONG_MS` 30 s), `paused_at = now`; at boot every device starts paused at `HubStarted.hub_down_at` (00 §5.8, test 71; boot time on a first boot). At the device's next contact — any authenticated request or socket connect — **before** M46's idle check, its staff session's in-memory `last_activity_at` moves forward by `now − paused_at` and `paused_at` is cleared; **if the device still has no open socket after the shift, `paused_at = now` again** (an HTTP request that arrives before the socket, then a second drop, keeps the clock paused — S-1). The sweeper skips a paused device's session, and its 15 s save (M5) also writes the shifted `last_activity_at` of paused devices, so a hub crash mid-outage does not count the time before the crash as idle (S-2). So a session never times out while its tablet cannot reach the hub, and on reconnect the queue replays in that live session through the normal pipeline (M19 fast path, session, M39, permission read now). The shift is not activity (M59 unchanged: pongs and polls never count). **Cap:** the hub also keeps in memory **`paused_since`** — set when the device's last socket closes (at boot = `hub_down_at`) and cleared **only** when a socket of the device opens; S-1's re-pause and the M5 save move only `paused_at`. A session whose device has `now − paused_since` > `queue_auto_send_max_ms` (default 14 400 000, 4 h) is ended `idle_timeout` by the sweeper (run 4 M-2) — a tablet left off overnight does not keep yesterday's login. **Ended or unknown session** (`logout`, `replaced`, `taken_over`, `forced`, `credentials_changed`, `hub_restored`, the cap → `401 SESSION_EXPIRED`; a token unknown after a restored backup → `401 SESSION_INVALID`): never accepted; the command goes to the queue log with **"Send again"** (after the next login; same `command_id` and ids, sent as the person now logged in, named on the button — a command that was in fact committed gets its stored response (M19 replay, 2xx, `Idempotent-Replay`) and is shown as sent; `ORDER_ITEM_ID_IN_USE` only after the 7-day `processed_commands` prune, also shown as sent) and "Discard". **`X-Queued-At`:** a replay of a queueable command sends `X-Queued-At: <queued_at>`; the hub clamps it to `[started_at − 120 000, now]` and ignores it on other commands; it sets `OrderPlaced.sent_after_reconnect = true` (E-1) and `ItemServed.served_at = queued_at` (§3.7; 02b's fold uses `min(served_at, recorded_at)` like the engine, Q-6). **Shared tablets:** the device's own idle lock (§8) logs the person out after the idle TTL whether or not it is connected, so a paused hub session is not a way to use someone else's login. **Accepted residual:** a client that ignores its own lock can use a paused session after reconnect until it idles out — the same as holding a live token; bounded by the 4 h cap. No new column, index, event or error code.
- **Drafts in progress** stay on the device per (device, staff) and survive restarts.

### 3.13 Totals

`seatingTotals(db, seating_id)` = Σ `billed_minor` (§3.4; pending weight = 0, return lines 0) over the lines of the seating's live orders, joined through 02a's `seating_orders` (P-1c). 1 statement.

### 3.14 Permissions and scopes

| Command | Permission | Scope check (C8, last) |
|---|---|---|
| `SubmitOrder` | `take-order` | dine-in: subsumed by `requireLock` (holder, or `take-order-anywhere`) plus `my_floors` / `branch` on the table; takeaway / parking: none |
| `RemoveItems` | `take-order` | dine-in: as `SubmitOrder` on the current table; takeaway / parking: `own_tables` and `my_floors` = placed by the person, `branch` = any |
| `SetLineWeight` | `set-line-weight` (new, B-1) | `branch` |
| `MarkServed`, `ReleaseItems` | `mark-served` | dine-in: the current table (`own_tables` = holder, 01b :194; `my_floors`; `branch`); takeaway / parking: as `RemoveItems` |
| `BoostOrder` | `boost-order` | as `MarkServed` |
| `ReturnToKitchen` | `mark-item-returned` | as `MarkServed` |
| `CompLine` | `apply-comp` (approvable) | `branch` |
| `AddZoneStock`, `SetZoneStock` | `manage-zone-stock` (new, B-2) | `my_zones` (B-3) or `branch` |
| query `order-contact` | **`view-customer-contact`** (new, B-5) | as `MarkServed` |

B-4 adds `own_tables` to the scope sets of `take-order`, `boost-order`, `mark-item-returned` (01b `PERMISSION_SCOPES`) as an **option**. Defaults by `default_key` (README :185, R29 re-seed) keep **03a AD-32**: `mark-served` at `branch` for everyone who has it. Owner, manager: all, `branch`; cashier: keeps `take-order` (`branch`, 01b v1.6 :966) and adds `set-line-weight`, `apply-comp` (approval by manager); order_taker: `take-order` (`branch`, as 01b v1.6 :967), `mark-served`, `mark-item-returned`, `boost-order` (all `branch`), `apply-comp` (approval by manager); waiter: `mark-served` (`branch`); **`manage-zone-stock`: owner and manager only by default** — the restaurant grants it (scope `my_zones` or `branch`) to whoever refills, a floor manager or a dedicated person (owner Q5 (b)), so the low / out alerts reach only them and managers; `view-customer-contact`: owner, manager, cashier at `branch`; order_taker at `own_tables` (orders they placed and tables they hold); not waiter. A waiter never holds a seating, so no waiter default uses `own_tables`. All editable (config).

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
| 03a | as §2; `ItemServed.source` `'zone'` and `served_at?` (Q-6), `ItemRemoved.units` (Q-4), `StockTransferredOut` (Q-5) | §3.2–§3.10 |
| 04 | `ItemVoided { …, refund_minor }`; calls `lineChangeDrafts` | §3.4, §3.13 |
| 05 | `OrdersBilled { order_ids, bill_id }` on every bill close | §3.3 |
| 03b | `Handover` (estimate, when built) | §3.7 |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `seatingTotals(db, seating_id)` | `{ total_minor, order_count }` | 1 | 02a handover card, 05 |
| `lineChangeDrafts(tx, order_id, changes)` | `EventDraft[]` (`OrderCancelled`, `OrderFoodCleared`, comp-request closes) | 2 | 04 voids |
| `lineShares(line)` | input and outputs per §3.4 (pure) | 0 | 04, 05 |
| `orderLines(db, order_ids[])` | `Map<order_id, LineView[]>` (`order_item_id, line_kind, name, units, live_units, comped_units, removed_units, voided_units, returned_units, refundable_minor, comp_minor, comp_voided_minor, removed_minor, refund_minor, line_total_minor, billed_minor, served_at, served_source, zone_served`) | 1 | 03b, 04, 05 |
| `ordersOf(db, seating_id)` | `OrderView[]` | 1 | 05 |
| Events, projection, kinds, queries, catch-up | §6.19, §5, §6.12–6.13, §6.14–6.18 | — | all |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 03b | Print and show the takeaway `token` big on ticket and Ready card, with its **date** when it is from an earlier business date (§3.3); parking "PARKING LEB 1234 · SEDAN"; **`order_note` and `kitchen_note` verbatim on the ticket** (E0-ORD AC2); zone-served lines never print or show on KDS; no COMP marker on the kitchen ticket; RETURN marker (03a); a CANCELLED slip for **every** `ItemRemoved` on a fired line (O16) — a partial removal prints the units removed and left ("− 1 naan · 3 left"), a whole removal prints the line as cancelled; 03b test: partial removal of a fired line prints the delta (run 4 M-5); write `Handover` for the estimate. |
| 04 | `ItemVoided` carries `refund_minor` and `comp_voided_minor` computed with §3.4's ledger (`lineShares`; uncomped units first; a `deal_part` against its own refundable amount, a deal void per portion of every part — 01c §3.4.8; additive, R29); a partial void of a deal with a g/ml part, or of a g/ml part alone, is refused like §3.4's remove while that part is open in the engine (served parts are engine no-ops, `apply-event.ts:796`; run 4 M-1); every void calls `lineChangeDrafts`; voids never change zone counts; a remade dish is freed only by a comp or a void (O20); 03a §12.3 Q12 is 04's; **owner (2026-11-07): voiding a cooked line (stage 2–3) shows both choices, "Move to stock" pre-selected when the voider holds `move-item-to-stock` (else Wastage pre-selected and Move to stock disabled), and "Wastage"**, Move to stock follows F §4.2 (`ItemMovedToStock` + `StockAdded { reason: 'moved' }`), so the next order of any type takes it from stock (02b §3.2 step 8); for an item with no stock tracking the stock choice is shown disabled with "Stock not tracked for this item" |
| 05 | `OrdersBilled { order_ids, bill_id }` on **every** bill close (dine-in through `seating_orders` at close, takeaway, parking); bill lines from `orderLines` / `ordersOf`; `billed_minor` per line (deal line = total − parts' money out); a comped share shows at its value with a COMP label and is subtracted (owner A, C4); a voided comp (`comp_voided_minor`) reads as a voided comp on the Z report, never as a refund (O21); return lines never billed; refuse bill close while a weight is pending; close the bill's open `comp` requests at bill close and list the rest at day close (`alerts.listOpen`). |
| 08 | Zone-served lines' `stock_draws` left branch stock at refill (`StockTransferredOut`) up to the transferred quantity; count draws beyond it (zones stocked by Count). |

### 4.4 Shared types

`OrderType = 'dine_in' | 'takeaway' | 'parking'` (03a also has `delivery`; refused with `422 VALIDATION_FAILED` path `order_type` until P2). `CarType = 'sedan' | 'mini' | 'large'`. `CompReasonCode` = the branch's chip codes (01a A-1) or `'other'`.

### 4.5 Changes to other specs (R26) — **Proposed, applied on approval**

| Row | Spec → version | Change | Cost (R29) |
|---|---|---|---|
| F-1 | Foundation v1.10 → v1.11 | §4.4 CANCELLED = every line removed or voided; §4.2 remove = `take-order` + the lock (not "adder"), fired-not-started included (O16), zone-served lines removable within `zone_undo_ms`; Served guard: from any fired stage, never from unfired `added` (O16); §4.3 D39 list adds release, boost, return, comp, weight, zone stock; §5.9 step 4 → 02a `requireLock`; step 10 → 02b §3.2 step 11; step 11: KDS gets 03a station frames, not `ItemAdded` | text only |
| H-1 | 00 v1.7 → **v1.8** | Simplified (owner, 2026-11-07): **idle clock paused while the device is disconnected** — per-device in-memory open-socket count and `paused_at` (set when the last socket closes; at boot = `HubStarted.hub_down_at`); at the next contact, before M46's check, `last_activity_at += now − paused_at`; the sweeper skips paused devices; cap `queue_auto_send_max_ms` (paused longer → sweeper ends `idle_timeout`); header `X-Queued-At` on queueable commands (clamped to `[started_at − 120 000, now]`) **and added to 00 §7.5's CORS preflight allowed headers (M35, 00 test 120)** — the Capacitor tablet is cross-origin (run 4 B-1); `paused_since` for the cap (run 4 M-2); re-pause when still no socket after the shift (S-1); M5's 15 s save writes paused devices' shifted `last_activity_at` (S-2); login response carries `idle_ttl_ms` (if absent today, S-5); queueable list registered by modules (`defineCommand({ queueable: true })`). Ended sessions are never accepted (no change to M19, M39, M59) | 1 guard step, 1 sweeper condition, 1 header; tests; ships before 01e's 00 bump; README :16 |
| A-1 | 01a v2.2 → v2.3 | `zone_item_routes`, `zone_stock_items` (nested replace-lists on the zone route); snapshot **V4** gains `zones[].routes[]`, `zones[].stock_items[]` (V4 unbuilt: same release, R29); branch settings `queue_auto_send_max_ms` (14 400 000), `zone_undo_ms` (300 000), `slow_item_threshold_ms` (900 000, E2-SOLD AC2), `served_estimate_ms` (when 03b); comp reason chips list; a zone stock item must be `sale_unit 'piece'` and not `requires_weighing` (`422` on the zone route write, run 4 m-4); item field **`is_ready_item` boolean default false** (owner Q5, B-1) in V4; `StockTransferredOut` (03a Q-5) added to `STOCK_VERSION_EVENTS` (`sync/stock-version.ts`), the stock-frame audience (`ws/restaurant-audiences.ts`) and the boot fold lists | 2 tables, 1 migration, admin routes, V4 fields, 3 list entries |
| B-1–B-5 | 01b v1.6 → v1.7 | B-1 `set-line-weight` (group `orders`, `branch`); B-2 `manage-zone-stock` (group `orders`, `branch`, `my_zones`); B-3 scope `my_zones` = zones assigned to the person **or to their lead** (`reports_to`) (B-2 data; CHECK expand migration); B-4 `own_tables` added as an option to `take-order`, `boost-order`, `mark-item-returned`; `own_tables` (= holder, 01b :194, no assignee) and `my_floors` cover non-table orders with `placed_by` = the person; B-5 `view-customer-contact` (group `orders`, scopes `branch`, `my_floors`, `own_tables`; default owner, manager, cashier `branch`, order_taker `own_tables` — run 3 #27, N-5); defaults by `default_key` per §3.14, **03a AD-32 kept** (`mark-served` at `branch`) | 2 catalogue rows, 1 scope, migration, re-seed |
| C-1 | 01c v1.1.1 → v1.1.2 | `ItemAdded` + `served_from_zone_id: string \| null` and `is_ready_item: boolean` (copy, D25; a `deal_part` copies its part item's flag; a `deal` line `false`, never an engine line) (additive). 01c's deal money (§3.4.8, N1, M8, To 04) is **unchanged**: 02b's ledger adopts it (O19) | schema field |
| P-1–P-1f | 02a v1.0 → v1.1 | P-1: `tables` folds `LineWeightSet`, `LineComped` (activity only); P-1b: `requireLock(…, { queued: true })` never takes a free lock; P-1c: tables `seating_orders`, `seatings` listed read-only for joins; **P-1d (final, owner Q5):** `seating_orders` gains `has_food` (from `OrderPlaced.has_food`); live orders stay all non-cancelled orders; ORDERED / FOOD_ON_TABLE is chosen over live food orders only (no food order → ORDERED); `served_any` set only by 02b's `OrderFoodServed` (which also sets `has_food = 1`), reset by `OrderLinesAdded` as today; `OrderFoodCleared { food_served }` → `served_any = 1` if true, else `has_food = 0`; `ItemServed` no longer sets `served_any`; P-1e: 02a :250 "every edit calls `requireLock`" → only submit and remove (O9); **P-1f:** `RequestBill`, `CleanTable` declare `queueable: true`; `CallWaiter` is not queued (02a §8 offline text updated). T21 is kept (O18) | fold lines, 1 column, text |
| Q-3–Q-6, Q-8, Q-9 | 03a v1.1 → **v1.2** (one bump with the engine lane's as-built, G1-1) | **Q-3 (code change):** `foldItemAdded` returns state unchanged, with no diagnostic, for an `ItemAdded` with `served_from_zone_id` set (today `apply-event.ts:436` throws `line_not_listed`, logged at warn per raita); `foldOrderPlaced` with empty `order_item_ids` creates no `EngineOrder` (today `:325-344` does); the host's `logAbsentIds` (`engine-host/reducer.ts:92-118`) skips `ItemAdded` with `served_from_zone_id`, `ItemServed` with `source: 'zone'`, and `ItemRemoved` / `ItemVoided` naming a zone line or a `deal` header (the reducer keeps a set of such ids). **Q-4:** `ItemRemoved { order_item_id, units? }` (absent = whole line); fold through the partial-void unit path; `stockEffects(ItemRemoved)` releases the units' share (`stock.ts:465-477` share path) instead of `lineReleases(line)` (`:459-462`). **Q-5:** `StockTransferredOut { stock_item_id, quantity, zone_id }` folded as a negative `StockAdded` (clamped, breach logged), added to `ENGINE_REPLAY_EVENTS.stock` and `ReplayEventType` (test 94), else replay ≠ live. **Q-6:** `ItemServed` gains `source: 'zone'` (engine: no-op, lines not in the engine) and optional `served_at` (queued serves; `foldItemServed` uses `min(served_at, recorded_at)` as for `ItemStarted` — a fourth fold). **Q-8:** 03a :500 "the served line … is freed by 04 on `remake`" → "`remake` frees nothing; a comp or a void does (02b O20)". **Q-9:** `ItemVoided` schema gains `refund_minor`, `comp_voided_minor` (additive, owned by 03a's events folder; 04 fills them). No re-key and no slip-alert change: 02a T21 stands and one late card per current table is a screen rule (O18) | engine: 3 folds, 1 host filter, schema fields, tests; `ENGINE_STATE_VERSION` unchanged: D62 applies when `applyEvent`'s meaning changes for events already logged; every change here is a new event type or a field no logged event carries, so old logs fold the same |
| E-1 | 03a v1.2 (same bump) | `OrderPlaced` additive: `business_date`, `token`, `car_number`, `car_type`, `order_note`, `sent_after_reconnect`, `has_phone` (boolean, no value; run 3 #15), `has_food` (boolean: the order has a food line, owner Q5). **No contact fields** (O17: they travel in 02b's own `OrderContactSet`) | schema fields |

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
  customer_name   TEXT, phone TEXT,                      -- OrderContactSet (O17)
  order_note      TEXT,
  placed_by       TEXT NOT NULL,                         -- envelope actor_id
  placed_at       INTEGER NOT NULL,                      -- recorded_at
  follow_up       INTEGER NOT NULL CHECK (follow_up IN (0,1)),
  cancelled_at    INTEGER,
  billed_at       INTEGER,                               -- OrdersBilled (every bill, §3.3)
  day_closed_at   INTEGER,                               -- BusinessDayClosed: cancelled, billed or finished orders
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
  refundable_minor INTEGER NOT NULL DEFAULT 0,           -- §3.4: line total, or a deal part's allocated + options; 0 deal / return
  removed_units INTEGER NOT NULL DEFAULT 0, removed_minor INTEGER NOT NULL DEFAULT 0,
  voided_units  INTEGER NOT NULL DEFAULT 0, refund_minor  INTEGER NOT NULL DEFAULT 0,
  comped_units  INTEGER NOT NULL DEFAULT 0, comp_minor    INTEGER NOT NULL DEFAULT 0,
  comp_voided_minor INTEGER NOT NULL DEFAULT 0,          -- O21
  returned_units INTEGER NOT NULL DEFAULT 0,             -- engine view only; money-live (O20)
  return_of       TEXT,                                  -- return lines (money 0)
  served_from_zone_id TEXT,
  added_at        INTEGER NOT NULL,                      -- zone undo window
  served_at       INTEGER,
  served_source   TEXT CHECK (served_source IN ('tap','estimated','zone')),
  is_food         INTEGER NOT NULL CHECK (is_food IN (0,1)),   -- engine line, not zone-served, not ready item (§3.3)
  kitchen_note    TEXT,
  CHECK (removed_units + voided_units <= units),
  CHECK (comped_units <= units - removed_units - voided_units),
  CHECK (comp_minor + comp_voided_minor + removed_minor + refund_minor <= refundable_minor)
);
CREATE INDEX order_lines_order ON order_lines (order_id);                                  -- every per-order read

CREATE TABLE zone_stock (
  zone_id TEXT NOT NULL, item_id TEXT NOT NULL,
  on_hand INTEGER NOT NULL CHECK (on_hand >= 0),
  PRIMARY KEY (zone_id, item_id)
);
```

- **One projection `orders`** (with `reset`) writes these three tables and **reads only its own events**: `OrderPlaced`, `ItemAdded`, `OrderLinesAdded`, `ItemRemoved`, `ItemVoided`, `ItemReturned`, `ItemServed`, `LineWeightSet`, `LineComped`, `OrderContactSet`, `OrderCancelled`, `OrdersBilled`, `BusinessDayClosed` (with the order's own lines and `billed_at`), `ZoneStockAdded`, `ZoneStockSet`. No fold reads another projection (02a T19); every bill reaches 02b as `OrdersBilled` (§3.3). Replay identity holds in any registration order (test 28).
- Times are `recorded_at`. No session ids.

---

## §6. Commands, events and queries

**Common rules.** `POST /commands/:name`, `sessionKind: 'device'`, staff session, D32 idempotency, no PIN. Responses `200 { data: { command_id, event_ids, result } }`; only `result` is listed. Dine-in **`SubmitOrder` and `RemoveItems`** carry `seating_id` (required) and follow 02a's `TABLE_SEATING_CHANGED` rule; other commands name orders or lines (run 4 m-2). Scope last (C8). Edits resolve the table by `currentTableOf`. Statement counts exclude 01d's own bounds and the append.

### 6.1 `SubmitOrder` (queueable)

| | |
|---|---|
| Permission | `take-order` |
| Payload | `{ order_id, order_type, table_id?, seating_id?, takeaway?: { customer_name?, phone? }, parking?: { car_number, car_type, phone? }, order_note?: ≤ 200, lines: [{ order_item_id, item_id? \| deal_id?, variant_id?, quantity?: int, options?: [{ option_id, quantity, order_item_id? }], deal_choices?: [{ deal_part_id, item_id, order_item_id, options? }], kitchen_note?: ≤ 80, from_zone?: boolean }] (1–40) }` |
| Script | §3.2 |
| Result | §3.2 step 11 |
| Statements | §3.2 (7 + append) |
| Errors | `BUSINESS_DAY_NOT_OPEN`, `TABLE_SEATING_CHANGED`, `TABLE_ALREADY_LOCKED`, `TABLE_NEEDS_CLEANING`, `ORDER_ITEM_ID_IN_USE`, `MENU_ITEM_NOT_FOUND`, `DEAL_NOT_FOUND`, `ITEM_UNAVAILABLE`, `ITEM_OUT_OF_HOURS`, `OPTION_CHOICE_INVALID`, `STATION_PAUSED`, `ITEM_SOLD_OUT`, `PERMISSION_DENIED`, `VALIDATION_FAILED` |

### 6.2 `RemoveItems`

`{ order_id, seating_id? (required for dine-in), lines: [{ order_item_id, units? }] (1–40, unique) }`; `take-order`; dine-in: `requireLock`. §3.5. Result `{ removed: [{ order_item_id, units }], cancelled: boolean, comp_requests_closed: alert_id[] }`. Statements: 1 order + lines, 1 seating / lock (dine-in), 1 open comp requests (`alerts.listOpen` for the order), +1 zone alerts only when a zone line is in the payload (m-6). Errors: `ORDER_NOT_FOUND`, `ITEM_WRONG_STAGE`, `ORDER_BILLED`, lock errors, `VALIDATION_FAILED` (repeated entry, C6).

### 6.3 `SetLineWeight`

`{ order_item_id, quantity }`; `set-line-weight`. §3.6. Result `{ line_total_minor }`. Statements: 1. Errors: `ORDER_NOT_FOUND`, `LINE_NOT_WEIGHED`, `LINE_ALREADY_SETTLED`, `ORDER_BILLED`.

### 6.4 `MarkServed` (queueable)

`{ lines: [{ order_id, order_item_ids }] (1–20 orders) }`; `mark-served`; no lock. §3.7. Result `{ served: n, skipped: order_item_id[] }`. Statements: 2–3 (orders + lines; `currentTableOf` for dine-in scope; non-table scope from `placed_by`). Errors: `ORDER_NOT_FOUND`, `ITEM_WRONG_STAGE`.

### 6.5 `ReleaseItems`

`{ order_ids, released, expedite }` (sets, C1); `mark-served`. §3.8. Result `{ alerts_closed: n }`. Statements: 2–3 (orders + lines, `currentTableOf` for dine-in scope). Errors: `ORDER_NOT_IN_ENGINE`.

### 6.6 `BoostOrder`

`{ order_id }`; `boost-order`. Statements: 2–3 (order, scope). Errors: `ORDER_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`.

### 6.7 `ReturnToKitchen`

`{ order_item_id, return_order_item_id, mode }` (03a :500; device-minted id, O3); `mark-item-returned`. §3.8. Result `{ eta_ms, promise_ms }`. Statements: 2–3 (line, `return_order_item_id` id check, scope). Errors: `ORDER_NOT_IN_ENGINE`, `RETURN_ALREADY_OPEN`, `ITEM_WRONG_STAGE`, `ORDER_ITEM_ID_IN_USE`.

### 6.8 `CompLine`

`{ order_item_id, units, reason_code, note?: ≤ 120 }`; `apply-comp`, `approvable: true`; online only. §3.9. Result `{ comped: true, value_minor } | { alert_id, pending: true }`. Statements: 2 (line + children, open comp requests of the order) + 01d. Errors: `ORDER_NOT_FOUND`, `COMP_NOT_ALLOWED`, `COMP_PENDING`, `LINE_WEIGHT_PENDING`, `ORDER_BILLED`.

### 6.9 `AddZoneStock` / 6.10 `SetZoneStock`

§3.10. `manage-zone-stock`, scope `my_zones` on the zone. Results `{ on_hand }`. Statements: 2 (count, open low / out alerts via `alerts.listOpen` for subject `zone:<id>`) + 1 branch stock read on refill + 01d. Errors: `ZONE_NOT_FOUND`, `ZONE_ITEM_NOT_CONFIGURED`, `STOCK_INSUFFICIENT`, `BUSINESS_DAY_NOT_OPEN` (refill).

### 6.11 Tick `served_estimate`

Registered with 03b's `Handover` (O14, §3.7); text kept for then.

### 6.12 Kind `comp`

```typescript
defineAlertKind({
  kind: 'comp', family: 'action', subject: 'order',
  steps: APPROVAL_TIER_STEPS,
  closes_on: 'owner',                          // 02b closes stale ones 'obsolete' (§3.9); 05 at day close
  values_schema: z.object({ order_id: z.string().min(1), order_item_id: z.string().min(1),
                            units: z.number().int().min(1), reason_code: z.string().min(1),
                            note: z.string().max(120).nullable() }),   // E0 AC3: 'other' keeps its note
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
  family: 'info', subject: 'table',            // raised with { stream_type: 'table', stream_id: 'zone:' + zone_id }
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' },          // { kind: 'permission', permission: 'manage-zone-stock' }
                               { target: { kind: 'managers' }, set: 'recipient' }] }],  // Z7 + owner Q5 (b)
  closes_on: 'owner',                          // 02b closes 'done' when the count goes back above threshold
  values_schema: z.object({ zone_id: z.string().min(1), item_id: z.string().min(1),
                            on_hand: z.number().int().min(0), threshold: z.number().int().min(0) }),
  details_schema: null, lead_fallback: false, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.zone_stock_low.card', lock: 'alert.zone_stock_low.lock' },
  request: null,
});
```

### 6.14 `GET /queries/eta-preview`

Staff session; `countsAsActivity: false`. Query `{ draft }` = JSON of a `SubmitOrder` payload without ids (temp `key`s), ≤ 8 KB, Zod-parsed (over → `400 VALIDATION_FAILED`). Runs §3.2 steps 4–8 read-only, with `follow_up` read as in §3.3: `reserveStock` (pure, nothing appended) then `calculateETA(state, proposed, now, from_stock)`. Result `{ as_of_seq, groups: [{ promise_ms, keys }], lines: [{ key, eta_ms, from_stock, zone_served, refused?: { code, details } }] }`. Statements: 3 (availability, zone counts, `follow_up`). p99 < 40 ms at 12 lines.

### 6.15 `GET /queries/seating-orders`

`{ seating_id }` → the seating's orders (current, P-1c), by `placed_at`: `{ order_id, placed_by: { staff_id, name }, placed_at, follow_up, cancelled, billed, has_phone, lines: LineView + stage (from `EngineState`), groups: [{ promise_ms }] }`, `total_minor`. Statements: 2.

### 6.16 `GET /queries/open-orders`

`{ order_type?: 'takeaway' | 'parking' | 'all', abandoned?: boolean }` → open non-table orders (`orders_open`; token / car, `has_phone`, ready n / m, promise, "from <date>"), by promise; `abandoned: true` (managers) adds orders of any type with no kitchen tap for `order_abandon_ms` (03a). Statements: 2.

### 6.17 `GET /queries/zone-stock`

`{ zone_id? }` → `[{ zone_id, name, items: [{ item_id, name, on_hand, threshold }] }]` — holders of `take-order` see every zone's counts read-only; `manage-zone-stock` and its scope gate only `AddZoneStock` / `SetZoneStock` (run 4 M-3). Statements: 1.

### 6.18 `GET /queries/order-contact`

`{ order_id }`; `view-customer-contact` with the order's scope; `countsAsActivity: true` (a deliberate tap). → `{ customer_name, phone }`. Logged `info { order_id, staff_id }` (no values). Statements: 1.

**Catch-up part `orders`:** all open orders of the branch (one statement) and their lines (one statement); the builder runs per socket (`build(db, state, socket)`) and includes `customer_name` / `phone` only for cashier kiosks and the placer's sockets (O17); plus `zone_stock` (one statement).

### 6.19 Events (`schema_version` 1)

| Event | Stream | Payload | Fold |
|---|---|---|---|
| `OrderPlaced` | order | 03a §4.2 + E-1 (no contact fields; `has_phone`) | `orders` row |
| `OrderFoodServed` | order | `{ order_id }` (§3.3, after every `ItemServed` serving at least one food line) | — (02a folds it, P-1d) |
| `OrderFoodCleared` | order | `{ order_id, food_served: boolean }` (§3.3) | — (02a folds it, P-1d) |
| `OrderContactSet` | order | `{ order_id, customer_name \| null, phone \| null }` (O17) | contact columns |
| `ItemAdded` | order | 01c §4.3 + `served_from_zone_id` (C-1) | line; zone count − |
| `OrderLinesAdded` | order | 03a (returns only) | — |
| `ItemRemoved` | order | `{ order_item_id, units? }` (Q-4) | ledger §3.4; zone count + (zone line) |
| `ItemVoided` | order | 03a + `refund_minor`, `comp_voided_minor` (04, §3.4) | ledger |
| `ItemServed` | order | `{ order_item_ids, source: 'tap' \| 'estimated' \| 'zone', served_at? }` (Q-6) | `served_at` (= `served_at` ?? `recorded_at`), `served_source` |
| `ItemReturned` | order | 03a | `returned_units` (engine view; money unchanged, O20) |
| `ItemsReleased`, `OrderBoosted` | order | 03a | — |
| `OrderCancelled` | order | `{ order_id }` | `cancelled_at` |
| `OrdersBilled` | order (first order_id) | `{ order_ids, bill_id }` (05) | `billed_at` |
| `LineWeightSet` | order | `{ order_item_id, quantity, line_total_minor }` | line |
| `LineComped` | order | `{ order_item_id, units, value_minor, reason_code, note \| null, requester_staff_id, alert_id \| null, approver_staff_id \| null }` (children cascade as separate `LineComped`s in the same batch) | ledger |
| `ZoneStockAdded` | table / `'zone:' + zone_id` | `{ zone_id, item_id, quantity, transfers: [{ stock_item_id, quantity }] }` | + |
| `ZoneStockSet` | table / `'zone:' + zone_id` | `{ zone_id, item_id, on_hand, previous }` | = |
| `StockTransferredOut` | stock | 03a Q-5 | 03a's |

**Audiences** (no catch-all on `order`, 01d To 02). Each audience function resolves `socket.staffId` through `StaffDirectory.resolve` (in memory) when it needs a grant. `OrderPlaced` → staff sockets and cashier kiosks (carries no contact). `OrderContactSet` → cashier kiosks and the placer's sockets only (O17; 00's publisher sends one body per event, so the restriction is the audience, not field stripping). Zone events use stream id `'zone:' + zone_id`; 02a's fold and every `table`-stream reader select by event type, so zone ids never reach a table reader. Every other `order` event 02b's screens show — `ItemAdded`, `OrderLinesAdded`, `ItemRemoved`, `ItemVoided`, `ItemServed`, `ItemReturned`, `ItemsReleased`, `OrderBoosted`, `OrderCancelled`, `OrderFoodServed`, `OrderFoodCleared`, `OrdersBilled`, `LineWeightSet` → staff sockets and cashier kiosks (menu prices are not secret; one body per event, run 3 #14). `LineComped` → cashier kiosks and sockets whose staff hold `apply-comp`. `ZoneStock*` → staff sockets and cashier kiosks (counts are not secret; every order taker's tile shows them, run 4 M-3). KDS gets 03a / 03b station frames only.

**Size:** 10 commands + 3 kinds + 5 queries + 1 catch-up = **19** (the estimate tick is added with 03b).

---

## §7. Cross-cutting

| Item | Decision | Justification |
|---|---|---|
| Performance | `SubmitOrder` p99 < 60 ms (12 lines, peak engine); `eta-preview` < 40 ms; `seating-orders` < 30 ms | E2-ETA AC1 (≤ 1 s round trip on a cheap tablet) |
| Idempotency | D32; device ids; frozen cart | power cuts mid-rush (E5) |
| Races | single writer; ids, zone claims (per payload), token, stock, ledger inside `BEGIN IMMEDIATE`; CHECKs as a backstop | last Paye, last raita, double comp |
| Queue security | client- and hub-side queueable list; session idle clock paused only while the device is disconnected, cap 4 h; ended sessions never accepted (queue log, "Send again"); device idle lock on shared tablets; residual in §3.12 | shared tablets, hub restore, Wi-Fi drops (§3.12) |
| Logs | `order_id`, `command_type`, `order_type`, line count, `queued`; never names, phones, totals | privacy, disputes |
| Privacy | contact only in `OrderContactSet` (audience: kiosks, placer), the per-socket catch-up and `order-contact` (permission `view-customer-contact`, not waiters by default; logged); it remains in the immutable log and the cloud (§12.3 Q1) | customer phone numbers |
| Boot | `orders` replays from checkpoint (00 M48) | no state outside events |

---

## §8. Client contract (`apps/client`, 01d's `/staff/` entry, ui-kit only)

- **Ordering screen** (inventory 02-S05): category rail, search, tiles (Sold out / Not now · hours / "4 left" / clock "25 min" when `slow_item_threshold_ms` is passed / "Only 2 left" caps the stepper, O15); cart sorted by ETA (E2-ETA AC2) with each group's promise as a clock time; options sheet with defaults visible and linked-option availability; kitchen note ≤ 80, order note ≤ 200; Hold (device draft); Send (freezes the cart). Preview via `eta-preview` per change (debounce 250 ms), refetched on `BranchConfigApplied`, stock frames, `stations_live`; "time updated" when a promise moves ≥ 60 s.
- **Zone items:** tile shows the zone count ("Raita · 6 here"); a tap adds or increments one `from_zone` line; a result line with `zone_served: false` for a `from_zone` line → "Zone empty — sent to the counter / kitchen", once. Undo within `zone_undo_ms` from the table view; later, Count on the zone screen.
- **Types:** Dine-in (from the table map, 02a), Takeaway (name, phone optional → token big after Send), Parking (plate LTR mono, type icons, phone).
- **Table view (orders part):** rounds by time and person (E2-ADD AC4); stages in words; Mark served (fired lines only); Send what's ready; Boost; Return (fix / remake); Comp (units, reason chips) with the waiting card "Waiting for approval — Rs 450 comp" (01d AD-1); Remove (stage 1, units stepper); weight entry; "Call" on a parking order fetches `order-contact` (shown only with `view-customer-contact`); Return is offered on the replacement line once a line was remade. If a remade dish's replacement was removed and the guest wants it again, the new round bills it again: the screen asks "Comp it?" (the usual `CompLine`, approval per grant).
- **Open orders:** takeaway by token, parking by plate; ready n / m; "from <date>"; abandoned list for managers.
- **Zone stock screen:** my zones, counts, Refill (+n), Count (= n); low / out highlighted.
- **Queue:** "Reconnecting… 2 orders waiting to send" (B02); on reconnect the queue drains first, as the same person, with no new login; queue log ("Send again" as the person now logged in, "Discard", "Copy to a new order"); Day not started → "Start day" for `OpenBusinessDay` holders, "Ask the manager to start the day" for others.
- **Device idle lock** (00 H-1, simplified): the app runs its own idle timer of the session's idle TTL (`SessionStarted.idle_ttl_ms`, kept with the session at login; H-1 adds it to the login response if absent) on taps, connected or not, **comparing wall-clock time since the last tap on app resume / `visibilitychange` and before acting on any tap** (a sleeping WebView suspends timers, run 4 m-9). At expiry it shows the lock screen, drains the queue first, then sends `POST /auth/logout` (offline: a **pending logout** kept by the app, not a queue entry, sent before the next login) and offers login.
- **Late cards (O18):** open `slip_warning`s whose seatings now sit on one current table show as one card with each warning's lines; "Send what's ready" on the card sends one `ReleaseItems` for all its orders.
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
| `ZONE_ITEM_NOT_CONFIGURED` | 422 | `{ zone_id, item_id }` | refill / count of a non-zone item |
| `STOCK_INSUFFICIENT` | 409 | `{ stock_item_id, available }` | refill transfer short |
| `LINE_NOT_WEIGHED` | 409 | `{ order_item_id }` | weight on a non-weighed line |
| `LINE_WEIGHT_PENDING` | 409 | `{ order_item_id }` | comp on a pending weight |
| `LINE_ALREADY_SETTLED` | 409 | `{ order_item_id }` | weight change after a unit left billing |
| `COMP_NOT_ALLOWED` | 409 | `{ reason: 'not_live' \| 'return_line' \| 'deal_part' \| 'zone_line' }` | §3.9 |
| `COMP_PENDING` | 409 | `{ alert_id }` | an open comp request on the line |
| `ORDER_BILLED` | 409 | `{ order_id }` | edit after the bill closed |

Reused: `BUSINESS_DAY_NOT_OPEN`, `ORDER_NOT_IN_ENGINE`, `RETURN_ALREADY_OPEN`, `STATION_PAUSED`, `ITEM_WRONG_STAGE`, `MENU_ITEM_NOT_FOUND`, `DEAL_NOT_FOUND`, `ZONE_NOT_FOUND`, `TABLE_*` (02a), `SESSION_EXPIRED`, `PERMISSION_DENIED`, `VALIDATION_FAILED`.

---

## §10. Tests (`apps/hub/test/orders/*.test.ts`; client tests in `apps/client`)

| # | Area | Case |
|---|---|---|
| 1 | Submit | delivery → `422 VALIDATION_FAILED` path `order_type`; parking `car_number_norm`, two orders on one plate share a `table_key`; `TABLE_SEATING_CHANGED` / `TABLE_NEEDS_CLEANING` (m-10); dine-in happy path: batch order exactly 03a :615; `table_key = 'dine_in:' + seating_id`; result groups with `promise_ms`, no `target_land_ms`; statement count §3.2 |
| 2 | Submit | each `line_kind` copies 01c §4.3 exactly (deal allocation 229 315 / 12 508 / 78 177; batch program cook times, B1); `order_note`, `kitchen_note` on the events |
| 3 | Submit | config applied between preview and submit → lines use the config at submit (D25) |
| 4 | Submit | no open day → `BUSINESS_DAY_NOT_OPEN`; nothing appended |
| 5 | Submit | id repeated in payload → `400`; id live / in projection → `409 ORDER_ITEM_ID_IN_USE` before append |
| 6 | Submit | Off / out of hours (hub time) / unsatisfiable group / linked option unavailable → each code |
| 7 | Submit | `sold_out` 0 < available < needed → `ITEM_SOLD_OUT { available }`; `cook_fresh` → full cook time; `planOrder` gets `from_stock`; two lines of one `sold_out` item in a cart, 3 left → second refused with `available: 1` (N-7) |
| 8 | Submit | paused station → `STATION_PAUSED` |
| 9 | Race | two submits on the last Paye: one `from_stock`, the other full cook time; stock never negative |
| 10 | Rounds | round 2 is a new order; `follow_up` true only after a served **food** line (a served water bottle alone → false); earlier promise unchanged (E2-ADD AC1) |
| 11 | Zone | route of the table's zone wins over the branch route; takeaway ignores zone routes |
| 12 | Zone | zone-only raita round: no `EngineOrder` (Q-3), **no engine diagnostic logged**, `isOrderInEngine` false; `ItemServed { source: 'zone' }`; count − 1. **Mains served → zone-only raita round → table stays FOOD_ON_TABLE**; **mixed round** (raita + karahi) → ORDERED until the karahi is served (P-1d revised); round 3 not `follow_up` from a zone serve alone; **mixed round whose karahi is then removed → `OrderFoodCleared`, table not stranded** (P-1d); no "absent id" log for zone `ItemAdded` / `ItemServed`; **remake then remove the replacement → `OrderFoodCleared`, table FOOD_ON_TABLE** (N-2); a live no-station or ready line never blocks `OrderFoodCleared` (R-4, Q5); **owner Q5:** water + raita only → table ORDERED, never green; bill request accepted; `CleanTable` → `TABLE_HAS_OPEN_ORDERS`; drinks round after mains → stays green; karahi + water round → green only when the karahi is served (`OrderFoodServed`); bottle (`is_ready_item`) from the counter station served → no `OrderFoodServed`, table stays ORDERED while the karahi cooks; reheated karahi from stock served → `OrderFoodServed`; all food of a round removed → `OrderFoodCleared`; remake → serve replacement → FOOD_ON_TABLE (M-5); water `fix` return → `OrderFoodCleared { food_served: true }`, table unchanged; replay of `orders` and `tables` in either order → same state; **water served, then returned while the karahi cooks → no `OrderFoodCleared`, table ORDERED until the karahi's `OrderFoodServed` → green** (N-1); food reaching an order cleared earlier → `OrderFoodServed` sets `has_food = 1` |
| 13 | Zone | two raita lines of 4 with 6 left in one payload → first zone-served, second a kitchen line (`zone_served: false`), no 500, no 409; two submits on the last raita: one zone-served, the other a kitchen line; a queued replay with the zone emptied meanwhile → accepted, the zone line sent to its station (M-4) |
| 14 | Zone | refill with draws → `StockTransferredOut` per draw; short → `STOCK_INSUFFICIENT`; Count leaves branch stock; low alert at threshold, out alert at 0 while low is open; back above closes both |
| 15 | Zone | undo a zone raita within `zone_undo_ms` → count + 1, no absent-id log (Q-3); after → `ITEM_WRONG_STAGE`; `ReturnToKitchen` on it → `ITEM_WRONG_STAGE`; the fold adds back regardless of the setting (replay with a changed `zone_undo_ms` → same count); undo on a **zone-only round** works (zone rule before engine stage); undo lifting the count above threshold closes the low / out alerts (m-6) |
| 16 | Token | 1, 2, 3 per business date; served-but-unbilled order at day close leaves (m-3); reopen same date continues; dine-in / parking null; a carried token shows its date |
| 17 | Remove | 1 of 4 from-stock naan: `ItemRemoved { units: 1 }`, `StockReleased` = one share (Q-4), the 3 left consume at Start |
| 18 | Remove | remove every line → `OrderCancelled` in the batch; fired-not-started line removable (O16); started → `ITEM_WRONG_STAGE`; line of an order out of the engine → `ITEM_WRONG_STAGE { stage: 'out_of_engine' }`; one deal part's units → refund its allocated share; lock by another → `TABLE_ALREADY_LOCKED`; dine-in without `seating_id` → `400`; repeated entry → `400` (C6); **Done-from-added line → refused; served line with no Start → refused** (stage `added` only); deal remove with one part cooking → refused; every part removed → `OrderCancelled`; `ORDER_BILLED` on remove (m-10) |
| 19 | Ledger | **comp 2 then remove 2** of 2 naan → `comp_minor` 0, `removed_minor` 20 000, total ≥ 0; **remove 1 then void 2** (fixture `ItemVoided` from `lineShares`) → refunds = remaining shares, total 0; **comp then void** → `comp_voided_minor`, `refund_minor` 0 (O21); **remainder share comped then taken back** (3 units of 10 001: shares 3 333, 3 333, 3 335) → take-back 3 335 first; **comp then weight** on a g/ml line → `LINE_ALREADY_SETTLED`; take-back moves the unit from `comped_units` to `removed_units` / `voided_units` |
| 20 | Ledger | property test: 1 000 random sequences of comp / remove / void / remake / weight over piece, g, **deal and deal-part**, option-child lines → CHECKs hold, Σ billed = Σ line totals − Σ out money, never negative, and a deal's money equals 01c #119's generator through `lineShares` |
| 37 | Deal | family deal ×1 (320 000): 04 voids 1 of 4 naan parts → refund 12 508 / 4 share on the part line, deal billed 320 000 − that; then 04 voids the deal → refund = deal total − parts already refunded (01c :311); remove 1 of 2 deals at stage 1 → each part's per-portion units removed; **untouched family deal ×1 → `seatingTotals` 320 000, every part `billed_minor` 0**; cascade capped: remove 1 naan part unit, then the whole deal → 3 naan units removed, no 500; void 1 naan, then comp the deal → 3 naan comped; **deal ×2 with a 1 kg karahi (g) part at stage 1, remove 1 deal → `422 gml_deal_part_partial`, nothing appended; remove both → allowed** (M-1) |
| 39 | Cascade | option child capped: remove 1 of 3 child naans, then the karahi → 2 child units removed; every cascaded line has its own event; an approved comp's child `LineComped`s carry the alert id |
| 38 | Remake | remake a karahi → still billed; comp it → `LineComped` allowed (O20); 04 fixture void after remake → refund share; pending comp request survives the remake |
| 21 | Weight | pending → `LineWeightSet` from the copy; correction allowed; non-weighed → code; `ORDER_BILLED` on a weight (m-10); `billed_minor` = the weighed total (`refundable_minor` set by the fold) |
| 22 | Served | lines of 2 orders: one `ItemServed` per order, `stockEffects` array form, from-stock line with no Start consumes (AD-29 Q7); repeat → skipped; **unfired line → `ITEM_WRONG_STAGE`, nothing written**; **abandoned order** (out of the engine) → Served allowed, no `stockEffects`; queued serve → `served_at = queued_at` |
| 23 | Scope | takeaway served / removed / boosted by its placer with `own_tables` → allowed; by another order taker → `outside_scope`; `my_floors` same; `branch` any; **default waiter (`mark-served` `branch`, AD-32) serves a line of another person's table**; default order taker submits on a table outside any assigned floor → allowed; default cashier places a takeaway → allowed (M-6); `BoostOrder` happy path and `ORDER_NOT_IN_ENGINE` (m-10) |
| 24 | Release | every distinct `alert_id` from `planRelease` closed `done` via one `closeMany`; no extra read; a pre-ticked goes-with partner still cooking arrives in **`expedite`** and appears in `ItemsReleased.expedite`; merged party with two original seatings both late → **two** `slip_warning`s (engine and tick unchanged, O18); a card "Send what's ready" for both → one `ReleaseItems`, both alerts closed in one `closeMany`; no 03a code touched |
| 25 | Return | 03a #101, #103, #107, #114 command halves: `planOrder` groups present, money 0, `return_of`, `cook_ms_override` on fix, `ItemReturned` on remake, second → `RETURN_ALREADY_OPEN`, exited → `ORDER_NOT_IN_ENGINE`; **remake, serve the replacement, Return the original → `ITEM_WRONG_STAGE { stage: 'returned' }`; Return the replacement → accepted** |
| 26 | Comp | allowed → `LineComped` with the next shares and child cascade; approval → kind raised with `approver_role_ids`, approve → `LineComped { alert_id, approver_staff_id }`, reject → nothing; second → `COMP_PENDING`; `apply` read-only; registry passes `requires_approval` (`approvable`); `COMP_NOT_ALLOWED` reasons `return_line`, `deal_part`, `zone_line`; `LINE_WEIGHT_PENDING`; `ORDER_BILLED` (m-10) |
| 27 | Comp | pending comp on 2 of 3, then remove 2 → request closed `obsolete`, requester told, new comp allowed; a direct `allowed` comp by someone else also closes it; `reason_code 'other'` without note → 422; `LineComped.requester_staff_id` set on approved comps; statements: 1 `listOpen` per order (no per-line reads); approved `'other'` comp keeps its note (`values.note`); approval-path comp raises with `values.note` (N-3); deal comp's `details.amount` = the deal value (N-4) |
| 28 | Replay | live projection = replayed projection over a fixture day, with `orders` registered before and after `tables` (no cross-projection fold) |
| 29 | Grouping | merge T5 into T4: T5's order in T4's `seatingTotals`, `seating-orders`, `follow_up`; `OrdersBilled` for the merged bill sets `billed_at` on both |
| 30 | Day close | close with a cooking takeaway → still open, shown with its date; finished or billed ones leave; **billed dine-in order with an untapped line → leaves at day close**; replay identical; **carried order finished next day → leaves at the next close**; a deal with every part served counts as finished |
| 31 | Queue hub | **Wi-Fi drop of 15 min with a 5 min idle TTL** → the session is still active at reconnect and every queued order is accepted as a normal command in that name (`sent_after_reconnect`); the idle clock resumes with the time used before the drop (2 min used before → ends 3 min after reconnect if idle); a pong-timeout terminate pauses at the terminate; **hub restart of 60 s across the TTL** → paused from `hub_down_at`, accepted; paused longer than `queue_auto_send_max_ms` → the sweeper ends it `idle_timeout`, replay → 401, kept in the log; `logout` / `taken_over` / `forced` / `credentials_changed` / `hub_restored` / left staff → 401, kept in the log; revoked device → `403 DEVICE_REVOKED`, queue kept (m-7); replay from a `cors_origins` origin with `X-Queued-At` passes preflight (B-1); tablet off 5 h with the M5 save running → ended `idle_timeout` at 4 h; HTTP-only contacts every 10 min for 5 h → still ended at 4 h (M-2); unknown token after restore → `401 SESSION_INVALID`, kept; "Send again" after a new login → accepted as the new person, an already-committed order → the stored 2xx (M19 replay) shown as sent (m-8); the shift is not activity (a socket that stays connected and only pongs still idles out); `X-Queued-At` clamped to `[started_at − 2 min, now]`, ignored on a non-queueable command; free lock not taken (P-1b); **request before socket, then a second drop** → still paused, later replays accepted (S-1); **hub crash mid-outage** → time before the crash not counted (M5 save, S-2); an open alert-mode socket keeps the device unpaused (S-6) |
| 32 | Privacy | `OrderPlaced` carries no contact; a waiter's socket never receives `OrderContactSet` on the **push path** nor contact in the catch-up; the placer and the kiosk do; `order-contact` logs without values; `OrderPlaced.has_phone` on the push path; default waiter `order-contact` → 403 (`view-customer-contact`); default order taker sees contact only for orders they placed / tables they hold (N-5) |
| 33 | Queries | `eta-preview` appends nothing, uses `from_stock` and `follow_up` (round 2 preview = submit), `countsAsActivity: false`; statement counts of §6.2–§6.18 and catch-up asserted; a refill updates the stock tile within 5 s (A-1 lists); **an order taker without `manage-zone-stock` receives `ZoneStockAdded` and its tile updates; `zone-stock` answers them read-only** (M-3) |
| 34 | Perf | `SubmitOrder` p99 < 60 ms, `eta-preview` p99 < 40 ms at 12 lines on the peak fixture (E2-ETA AC1) |
| 35 | Client | queue: stored before first send; replay in `queued_at` order (E5 AC2); no "sent" before 2xx; 4xx in the log; frozen cart; own pending `ORDER_ITEM_ID_IN_USE` shown as sent; drafts survive reload; **device idle lock** fires offline after the TTL, drains first, then logs out; "Send again" names the person; late cards grouped by current table (O18): merge after both warnings were raised → one card; split → each warning under its oldest order's table (S-7); offline lock keeps a pending logout, not a queue entry (S-4); **TTL elapses while the app is suspended → the first tap after resume shows the lock, nothing sent as the old person** (m-9); a `426` keeps the command queued (m-7) |
| 36 | Client | stepper capped; zone-empty flip; slow chip from `slow_item_threshold_ms`; sold-out update from the stock frame within 5 s (E2-SOLD AC3); day-not-started per permission; cart sorted by ETA; table view rounds by time |

### Acceptance

| Story AC | Tests |
|---|---|
| E2-TBL AC9 (dine-in, takeaway, parking) | 1, 16 |
| E2-ADD AC1–AC4 | 10, 1, 36 |
| E2-ETA AC1–AC6 | 34, 36, 7, 33, 1 |
| E2-SOLD AC1–AC3 | 6, 7, 36 |
| E0-ORD AC1 — **partial** (device only; manager view §12.4); AC2 | 35, 2 (printing: 03b) |
| E0 comps AC3, AC4 (stage 1), AC5 | 26, 27, 18, 37, 38 |
| E5-DEV AC1–AC4 (incl. restore, AC3) | 31, 35 |
| Z3–Z5, Z7 | 11–15 |
| Owner Q4 token, Q6, Q7, Q8; 02b Q1–Q6 | 16, 26, 22–23, 31; 14, 26, 17, 4, 11, 23 |

---

## §11. Build order (one task per commit, TDD)

1. Errors §9 → `errors.ts`, F §6.2 append (no bump, R34).
2. Event schemas: E-1, C-1 additive fields; `OrderContactSet`, `OrderFoodServed`, `OrderFoodCleared`, `OrderCancelled`, `OrdersBilled`, `LineWeightSet`, `LineComped` (`packages/events/src/events/order/`); 03a-owned additions (Q-4 `ItemRemoved.units`, Q-6 `ItemServed`, Q-9 `ItemVoided`) land with 03a v1.2; `ZoneStockAdded`, `ZoneStockSet` (`…/table/`, stream id `zone:`).
3. Migration §5; projection `orders` with `reset` (tests 28, 29).
4. Ledger (`apps/hub/src/orders/ledger.ts`, pure; `lineShares`; deal parts per 01c) (19, 20, 37, 38).
5. `buildProposedOrder` + zone routing (pure) (2, 3, 6, 11).
6. `SubmitOrder` (1, 4, 5, 7, 8, 9, 10, 16).
7. Zone-served path in submit (12, 13) — needs 03a Q-3, Q-6, 02a P-1d (revised).
8. `eta-preview` (33).
9. `RemoveItems` + `lineChangeDrafts` (17, 18, 15) — needs 03a Q-4.
10. `SetLineWeight` (21).
11. `MarkServed` (22, 23).
12. `ReleaseItems`, `BoostOrder` (24).
13. `ReturnToKitchen` (25).
14. `CompLine` + kind `comp` (26, 27).
15. `AddZoneStock`, `SetZoneStock`, zone kinds (14) — needs 01a A-1, 03a Q-5.
16. Exports §4.2 (29).
17. Queries §6.15–6.18, catch-up, audiences (32, 33).
18. Hub paused idle clock and `X-Queued-At` (31) — needs 00 H-1, 02a P-1b, P-1f.
19. Client: queue and drafts (35).
20. Client: ordering screen, options sheet, preview (36).
21. Client: table view orders part, comp card, zone stock, open orders, contact.
22. Perf (34); acceptance pass; README rows closed.

---

## §12. Definition of Done, checklist, questions, deferred, reviews

### 12.1 Definition of Done

**Approval steps:** the developer approves v1.0; the §4.5 rows are applied in their own spec bumps (F v1.11, 00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 02a v1.1; 03a v1.2 together with the engine lane's as-built, G1-1); README index and carried rows updated in the same change. Then the plan (`docs/plans/02b-plan.md`). All §10 tests green under the gate; §4.5 rows approved and applied first (F v1.11, 00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 02a v1.1, 03a v1.2); every command cites its section; statement counts asserted; README index and carried rows updated.

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
| 18 | `order-contact` | view-customer-contact | 6.18 | 32 |
| 19 | catch-up `orders` | staff | 6.18 | 28, 32 |

### 12.3 Open questions

| # | Question | Default until answered |
|---|---|---|
| Q1 | (owner) A customer's phone and name are kept in the order history for ever and copied to the cloud (in `OrderContactSet`); staff with `view-customer-contact` (not waiters by default) can look one up, logged. OK, or should 02b keep only a masked number in history? | **Answered (owner, 2026-11-07): keep.** Full phone and name stay in history and the cloud. |
| Q4 | Wi-Fi queue rulings | **Answered and simplified (owner, 2026-11-07):** the login does not expire while the tablet is off the Wi-Fi (up to 4 h), so the queue goes out as soon as the Wi-Fi is back, with no wait; the tablet locks itself after the idle time; anything that still fails waits in the queue log for one tap "Send again". |
| Q3 | Proxy rulings of run 2 | **Answered (owner, 2026-11-07):** remade dish stays billed unless comped (O20) — yes; voided comp reads as a voided comp (O21) — yes; joined tables show **one** late card (O18, a screen rule since the simplification); table state for zone / ready items — open, Q5. |
| Q5 | Ready items and table state | **Answered (owner, 2026-11-07):** (a) water bottles and similar sit in the zone in winter, kept ready if someone asks — zone stock as built; a ready item not in the zone goes to its station / counter like any line; (b) zone refill is a permission (`manage-zone-stock`) given to whoever does it — manager, floor manager or a dedicated person — and the low / out alerts go to them; (c) items that are reheated from stock are pre-cooked stock items (food lines), not ready items. Table turns green only on food (§3.3). |
| Q2 | Can a comp be undone before the bill? | no; 05 handles a wrong comp at the bill |

### 12.4 Deferred until needed

Delivery and web types; later child additions ("one more naan" attached) with README :201's rule; reorder; kitchen-note edit after submit; manager view of held orders; sibling-zone transfer (Z6), day-end zone recount prompt (Z8), nested zones and floor routes; estimated Served (with 03b); hub-down manager alert (06 / 01e); customer tracking (P2).

### 12.5 Hostile self-review (v0.3, kept; v0.4 additions in §12.7)

- **Money:** one ledger for comp, remove and void; CHECKs and a property test; 04 bound to it (To 04).
- **Engine reality:** Q-3, Q-4 stated against the code on `module-03a` (`apply-event.ts`, `stock.ts`) with their cost; `planOrder` / `calculateETA` with `from_stock`.
- **Queue:** queueable list, paused idle clock with a cap, device idle lock and no ended-session acceptance close the shared-tablet path (§3.12).
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
| 11 | O17 contact only to kiosk and placer, `order-contact` query, §12.3 Q1 for the owner; test 32 — *built through `OrderContactSet`, §12.7 #9* |
| 12 | Day close only for finished orders (§3.3); test 30 |
| 13 | B-3 `my_zones` = person's or lead's zones |
| 14 | B-4 scope sets; non-table rule for `my_floors`; test 23 |
| 15 | No cross-projection fold; dine-in billed read at query time; test 28 |
| 16 | O18 / 03a Q-7 re-key on split and merge; `ReleaseItems` closes only resolved alerts; test 24 — *superseded by §12.7 #6 (T21 kept, Q-7 dropped)* |
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

### 12.7 G4 run 2 closure (`02b_v0.3_hostile_run2.md`)

| # | Fix |
|---|---|
| 1 | O19: deal money per 01c §3.4.8 — `refundable_minor` per line, part ledgers, deal billed = total − parts' money out, CHECK against `refundable_minor`, per-portion deal cascades; 01c unchanged (C-1 note); To 04; tests 20, 37 |
| 2 | O20: remade units stay money-live (comp / void allowed), `returned_units` engine view only; `LineView` counts; test 38 |
| 3 | P-1d revised: a zone serve sets `served_any` only for a zone-only order (`kitchen_lines` flag); `follow_up` reads 02b's `served_source`; test 12 |
| 4 | `OrdersBilled` on every bill (To 05); `billed_at` for all; day close stamps billed orders; test 30 |
| 5 | O16: lines of an order out of the engine count as fired for Served, past stage 1 for Remove; tests 18, 22 |
| 6 | Q-7 dropped; T21 kept (O18); `ReleaseItems` closes `planRelease`'s alert ids; test 24 |
| 7 | H-1 accepts `hub_restored`; `SESSION_INVALID` stays in the log; M39 re-applies the rule; M59 no touch; test 31 |
| 8 | H-1 accepts only `idle_timeout` / `hub_restored` and only with no later session on the device; queue drained before login; test 31 |
| 9 | O17: `OrderContactSet` with a restricted audience, no contact on `OrderPlaced` (E-1), per-socket catch-up; test 32 |
| 10 | Defaults keep AD-32 (`mark-served` `branch`); no waiter default uses `own_tables`; test 23 |
| 11 | Q-3 includes the host's `logAbsentIds` filter for zone lines; test 15 |
| 12 | Close every `alert_id` `planRelease` returns; goes-with pre-ticks are the client's |
| 13 | `alerts.listOpen` per order (no N+1); statement counts corrected; preview reads `follow_up` |
| 14 | Direct comp closes stale requests; bill close closes them (To 05); remake no longer orphans a request (O20) |
| 15 | O21 `comp_voided_minor`; To 05 Z report wording; test 19 |
| 16 | `lineShares` inputs and both derivations stated; remainder take-back test 19 |
| 17 | A-1 adds `StockTransferredOut` to the stock-version, frame and boot lists; test 33 |
| 18 | `own_tables` = holder only; dine-in scope subsumed by `requireLock`; P-1f |
| 19 | Zone undo fold always adds back; window in the command only; test 15 |
| 20 | `RemoveItems` entries cite C6 (repeat → 400); test 18 |
| 21 | Zone events and kinds on `table` with stream id `zone:<id>`; readers select by type |
| 22 | Queued serves keep `served_at = queued_at` (Q-6); `CallWaiter` not queued (P-1f) |
| 23 | Note required for `other`; `LineComped.requester_staff_id`; test 27 |
| 24 | A carried token shows its date (§3.3, To 03b); test 16 |

### 12.8 G4 run 3 closure (`02b_v0.4_hostile_run3.md`, verdict APPROVE WITH FIXES)

| # | Fix |
|---|---|
| 1 | `deal_part` `billed_minor` = 0; its ledger feeds only the deal line (§3.4); test 37 untouched-deal total |
| 2 | Stage 1 = engine `stage === 'added'` (§3.5); test 18 |
| 3 | Deal headers derived from parts; deal remove needs every touched part at stage 1; headers ignored by Served, day close, `ready n / m`, "no live line" (§3.4); tests 18, 30 |
| 4 | Cascades capped as 01c :312, last unit takes the rest (§3.4); tests 37, 39 |
| 5 | `OrderKitchenCleared` + P-1d (§3.3, §3.5); test 12 |
| 6 | Return refused on a remade line (§3.8); test 25 |
| 7 | **Ruling:** `queued_at ≤ device_back_at` (hub-stamped first contact) instead of `ended_at + 2 min`; drain window; H-1 cost; test 31 |
| 8 | Goes-with pre-ticks not done go in `expedite` (§3.8); test 24 |
| 9 | Q-3 host filter covers zone `ItemAdded` / `ItemServed` and deal headers; test 12 |
| 10 | Cascades as events per line; parent `value_minor` own share; `apply` drafts carry the alert id (§3.4); test 39 |
| 11 | Take-back moves the unit out of `comped_units` (§3.4); test 19 |
| 12 | `LineWeightSet` fold sets `refundable_minor` (§3.4); test 21 |
| 13 | Day close stamps every open order, any date (§3.3); test 30 |
| 14 | Audience list for every `order` event 02b shows; "no totals" clause dropped (§6.19) |
| 15 | `OrderPlaced.has_phone` (E-1); test 32 |
| 16 | `note` in the comp `values_schema` (§6.12); test 27 |
| 17 | Real `reserveStock` signature and `available` computation (§3.2 step 8) |
| 18 | `started_at >= ended_at`; index `staff_sessions_device_started` in H-1's cost; test 31 |
| 19 | Active-session `X-Queued-At` bound; 02b fold `min(served_at, recorded_at)`; cites Q-6; test 31 |
| 20 | §3.1 stale re-key text removed |
| 21 | Zone rule before engine stage for undo (§3.5); test 15 |
| 22 | 03a row Q-8 (remake frees nothing) |
| 23 | Statement counts for Release, Boost, zone stock corrected |
| 24 | Q-5 replay list + test 94; Q-6 `foldItemServed`; D62 reason stated |
| 25 | 03a row Q-9 `ItemVoided` fields; §11 step 2 |
| 26 | Closed by the drain window after `device_back_at` (§3.12, §7) |
| 27 | **Ruling:** permission `view-customer-contact` (B-5), not waiters by default; §12.3 Q1 updated; test 32 |

### 12.9 Targeted check closure (`02b_v0.5_targeted_check.md`)

| # | Fix |
|---|---|
| N-1 | **Ruling:** `device_back_at` re-stamped after every gap (≥ 120 s or `ended_at`); drain window and `queued_at` bound from the latest stamp; residual stated (§3.12, §7, H-1, §12.3 Q4); test 31 |
| N-2 | `OrderKitchenCleared` when no live **unserved** kitchen line remains and a served line exists (§3.3, §3.5); remade original stays non-returnable, re-order as a new round (§3.8); test 12 |
| N-3 | `note` in the comp raise `values`; `apply` copies it (§3.9); test 27 |
| N-4 | Comp `value_minor` / `details.amount` = Σ over every touched line (§3.9); test 27 |
| N-5 | `view-customer-contact` default scopes (§3.14, B-5); test 32 |
| N-6 | O16 says stage `added` |
| N-7 | `available` minus earlier lines' claims (§3.2 step 8); test 7 |

### 12.10 Re-check closure (`02b_v0.5.1_recheck.md`, APPROVE WITH WORDING FIXES)

| # | Fix |
|---|---|
| R-1 | `now − ended_at ≤ queue_auto_send_max_ms` added; residual bound stated truthfully (§3.12, H-1, §12.3 Q4); test 31 |
| R-2 | Drain window slides with accepted replays (`last_replay_at`); remaining short-re-drop and stuck-drain losses written in §3.12 and Q4; test 31 |
| R-3 | Gap measured from the device's previous contact before the guard records it (in-memory, else `devices.last_seen_at`); M46 / login step 0 stamp `ended_at`; refused socket connect records and stamps (§3.12, H-1); test 31 |
| R-4 | "Kitchen line" = engine line, not zone-served (§3.3); test 12 |
| obs. | §8: re-ordering a remade dish after its replacement was removed bills again; the screen offers Comp |

### 12.11 Owner answers on v1.0 (2026-11-07)

| Item | Change |
|---|---|
| Q1 | Contact kept in history and the cloud |
| Q3 (1), (4) | O20, O21 confirmed |
| Q3 (3) | O18 revised: one late warning per current table; 03a row Q-7 (host-side, `fires_alerts` tick); §3.8 joint-alert release rule; test 24 |
| Q4 (a) | Every reconnect stamps `device_back_at` (no 120 s minimum); remaining loss reduced to a stuck drain; test 31 |
| Q4 (b) | Residual accepted |
| Q3 (2) | Open as Q5 (ready items and table state) |
| To 04 | Voiding a cooked line defaults to Move to stock, Wastage shown beside it (owner) |
| Q5 | Food lines (cook time > 0, not zone-served) drive table state: `OrderPlaced.has_food`, `OrderFoodServed`, `OrderFoodCleared` (renamed from `OrderKitchenCleared`); P-1d final; zone alerts to `manage-zone-stock` holders + managers; test 12 |

### 12.12 Owner re-check closure (`02b_v1.0_owner_recheck.md`)

| # | Fix |
|---|---|
| B-1 | Explicit `is_ready_item` item flag (A-1, C-1), `order_lines.is_food`; food line no longer uses `cook_time_ms`; test 12 |
| M-1 | Q-7 engine part: `foldAlertClosed` for every matching key; D62 reason; test 24 |
| M-2 | Q-7 host: `seatings_changed` makes the tick due; re-attach and `obsolete` closes in one pass; test 24 |
| M-3 | A split key follows its oldest order's seating (O18); test 24 |
| M-4 | Live orders unchanged; only the ORDERED / FOOD_ON_TABLE choice uses food orders; drinks-only → ORDERED; test 12 |
| M-5 | `OrderFoodServed` after every serve of a food line; non-food return → `OrderFoodCleared`; test 12 |
| M-6 | `OrderFoodCleared { food_served }`; P-1d; test 12 |
| M-7 | `manage-zone-stock` default owner and manager only; refill person granted by the restaurant (option (a)) |
| m-1 | "Return" defined (pong gap > 30 s or socket close); remaining blip stated; H-1; test 31 |
| m-2 | Estimate tick appends `OrderFoodServed` |
| m-3 | Q-7 tick mechanics (a)–(d); §3.8 typo |
| m-4 | To 04 default depends on `move-item-to-stock`; punctuation |
| m-5 | Test 10 and §8 use food / station wording |

### 12.13 Re-check 2 closure (`02b_v1.0_owner_recheck2.md`)

| # | Fix |
|---|---|
| N-1 | Non-food return's `OrderFoodCleared` gated on no live unserved food line; `OrderFoodServed` sets `has_food = 1` (§3.3, P-1d); test 12 |
| N-2 | Q-7 one reconcile rule (target seating by oldest order, re-attach, raise, close empty alerts `obsolete`) for every seating change and boot; test 24 |
| N-3 | §3.7, §6.19 "every serve of a food line"; §3.5 payload with `food_served`; `lineChangeDrafts` computes it |
| N-4 | `is_food` definition in full; deal / deal_part flag copy (C-1) |
| N-5 | Q-7 done-close and held-out-of-due rules stated; boot reconcile |
| N-6 | Test 31 40 s drop wording |

### 12.14 Simplification (owner, 2026-11-07)

| Item | Change |
|---|---|
| H-1 | Replaced by the paused idle clock (§3.12, H-1 row, §7, §8 device idle lock, test 31, §11 step 18, Q4). Supersedes §12.6 #8–#9, §12.7 #7–#8, §12.8 #7, #18, #26, §12.9 N-1, §12.10 R-1–R-3, §12.11 Q4 (a), §12.12 m-1. Removed: `device_back_at`, `last_replay_at`, `queue_drain_window_ms`, index `staff_sessions_device_started`, `QueuedCommandAccepted`, `QUEUED_COMMAND_EXPIRED`. |
| Q-7 | Dropped; one late card per current table is a screen rule (O18, §3.8, §8, test 24). Supersedes §12.11 Q3 (3), §12.12 M-1–M-3, m-3, §12.13 N-2, N-5. 03a v1.2 carries Q-3–Q-6, Q-8, Q-9 only. |

### 12.15 Simplified check closure (`02b_v1.0_simplified_check.md`, APPROVE WITH WORDING FIXES)

| # | Fix |
|---|---|
| S-1 | Re-pause when the device still has no open socket after the shift (§3.12, H-1); test 31 |
| S-2 | M5 15 s save writes paused devices' shifted `last_activity_at` (§3.12, H-1); test 31 |
| S-3 | Late cards grouped by `currentTableOf` of the oldest order in `values.order_ids` (O18) |
| S-4 | Offline lock keeps a pending logout, not a queue entry (§8); test 35 |
| S-5 | `idle_ttl_ms` in the login response listed in H-1 |
| S-6, S-7 | Tests 31 and 35 extended |

### 12.16 G4 run 4 closure (`02b_v1.0_hostile_run4.md`, verdict FIX)

| # | Fix |
|---|---|
| B-1 | `X-Queued-At` added to 00 §7.5's preflight allowed headers through H-1; test 31 |
| M-1 | Partial remove / void of a deal with an open g/ml part refused `422 gml_deal_part_partial` (§3.4, To 04); test 37 |
| M-2 | `paused_since` (cleared only on socket open) drives the 4 h cap (§3.12, H-1); test 31 |
| M-3 | `ZoneStock*` to staff sockets and kiosks; `zone-stock` read-only for `take-order` holders (§6.17, §6.19); test 33 |
| M-4 | Empty zone → normal kitchen line, `ZONE_STOCK_EMPTY` removed (§3.2 step 5, §6.1, §8, §9); test 13 |
| M-5 | To 03b: CANCELLED slip with the delta on every fired-line removal |
| M-6 | Defaults: order taker `take-order` `branch`; cashier keeps `take-order` (§3.14); test 23 |
| m-1 | `queued` defined (§3.2 step 2) |
| m-2 | `seating_id` only on `SubmitOrder` / `RemoveItems` (§6 common rules) |
| m-3 | Day close: open only with an unserved line (§3.3); test 16 |
| m-4 | Zone stock items piece-only (A-1) |
| m-5 | `lineChangeDrafts` lists `OrderFoodCleared` (§4.2) |
| m-6 | Zone undo closes low / out alerts (§3.5, §6.2); test 15 |
| m-7 | Revoked → 403, queue kept; `426` stays queued (§3.12); tests 31, 35 |
| m-8 | "Send again" of a committed command → stored 2xx (§3.12); test 31 |
| m-9 | Device lock checks wall-clock on resume and before any tap (§8); test 35 |
| m-10 | Missing rule tests added to tests 1, 18, 21, 23, 26 |
