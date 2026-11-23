# 08d — Inventory & Costing: A-item daily sheet — Module Spec part v0.1 (DRAFT)

**v0.1 — DRAFT (2026-11-23), for hostile review in a fresh session.** This is the **08d part of module 08**. It is written in its own file only so that 08b (`spec/08b-recipes`) and 08d can be drafted in parallel; **at approval it is folded into `08_Inventory_Costing_Spec` as its next version (owner OQ-1, 2026-11-23: one file for 08a–08d)**, and this file is kept as history. Inputs: `docs/stories/08-g0.md` §3.3, §3.5, §3.12, §4, §7 drill 3; README **R39** (b) minimal scope, (c) paper fallback, (d) rulings C1–C12; 08a v1.0 (`08_Inventory_Costing_Spec_v1.0.md`) §4.3 row "08d". Decision rows are **S1 …**.

---

## §1. Header

| Field | Value |
|---|---|
| Module | 08d A-item daily sheet: on the branch hub, **one screen** to record quick receipts, branch transfers-in, user waste and the closing count (raw + cooked) of the **A-items** (`is_a_item`); a moving weighted average cost per A-item ("**today's cost**", 08a I12); `DailySheetClosed` with variance flags; a hub admin report |
| Version | **v0.1 — DRAFT** (2026-11-23) |
| Depends on | Foundation v1.15 (→ v1.16 by row F-1, F-2); 00 Hub Platform & Access v1.12.3 (command pipeline, sessions, queries); 01a Restaurant Setup v2.8 (business day S-rows, `branch_settings` → snapshot `engine_settings`, day close); 01b Staff and Roles v1.10.3 (→ v1.11 by B-1); 01c Menu Variants v1.2 (stock items, `prepared` stock, `StockSet`) (→ v1.3 by C-1); 05a Device Access & Screens v1.0.4 (→ v1.1 by D-1); 04 Voids v1.0.8 (`ItemVoided.disposition`, read only); **08a v1.0** (stock item `kind`, `is_a_item`, item units, `resolveUnit`, `effectiveMenuPrice`); **08b** (snapshot `inventory` key, batch recipes — not yet written; this part depends on its §4.2); **08c** (theoretical usage — not yet written; only §6 batch 3's variance numbers depend on it, S12) |
| Inherits | **Shared Standards from Foundation v1.15 §6**, unchanged. Carried conventions C1–C9 (README) |
| Changes other specs | Foundation → v1.16 (F-1, F-2); 01b → v1.11 (B-1); 01c → v1.3 (C-1); 01a → v2.9 (A-1); 05a → v1.1 (D-1); 08b, 08c requirements (§4.3). Full list §4.5 |
| Tier | T2 Production |
| Milestone | A (pilot), by R39 (a). **Fallback (R39 c): if 08d is not live by 2027-02-28, the manager runs the paper sheet (5 A-items, signed daily) until it ships; the pilot does not slip for 08d** |
| Build split | **08d-1** (receive, transfer-in, waste, counts, today's cost, the screen, the day view) needs 08a + 08b only. **08d-2** (`CloseDailySheet`, variance, report) needs 08c's `theoreticalUsage` for its numbers; it can ship before 08c with theoretical usage absent (S12) |

### Stories covered

| Source | Item | How |
|---|---|---|
| 08-g0 §3.12, D13 | A-item daily sheet: quick receive, transfers, waste, closing count raw + cooked, daily variance | §6 batches 1–3 |
| 08-g0 D3, §3.5 step 1, MWA formula | MWA driven only by stock receipts with qty + price | S6, S7 (`GoodsReceived` lines with `price_total_minor`) |
| 08-g0 D4 | One receiving event `GoodsReceived` with `mode`; pilot `quick_receive` only | S3 |
| 08-g0 D5 | One `CountRecorded` shape (pilot daily sheet now, POST sessions later) | S9 |
| 08-g0 §4 | "Not counted ≠ 0"; all A-items must be entered to close; weight + piece count on paye receipt; voided prepared food → waste, never unexplained | S9, S10, S4, S11 |
| 08-g0 §7 drill 3 | Daily sheet dry run on paper, one week | §1 fallback; §12.3 OQ-6 |
| R39 (b) | 5 A-items, one hub screen, MWA, `DailySheetClosed` + flags 3 % AND Rs 500, hub admin report; nothing from POST | whole part |

### In scope
- Hub: five commands (`ReceiveGoods`, `ReceiveTransfer`, `RecordWaste`, `RecordCount`, `CloseDailySheet`), five events on a new **`inventory`** stream type, four hub projections, three queries (screen day view, sheet list, sheet detail).
- Cloud: three `stock_items` columns 08a moved here (`must_weigh_on_receipt`, `track_piece_count`, `default_purchase_unit`) and two branch settings (variance thresholds), delivered to the hub (S15, S16).
- Client: the device screen **Inventory** (05a screen key `inventory`), the hub admin report page, owner-app fields.
- Permissions: four hub permission keys (S14).

### Out of scope
- Everything in 08-g0 §5 POST: suppliers, PO, full GRN (`supplier_delivery`, `cash_purchase`, `night_drop`, blind mode, landed cost), credit memos, cash advances, requisitions, store / kitchen split, transit, CK dispatch (`StockTransferDispatched`), count sessions, spot counts, 3-stage variance, vendor scores, restatement.
- `shelf_life_days`: no pilot reader (no expiry screen, no FIFO) → §12.4.
- Receipt photos (no hub media store) → §12.4.
- Cloud ingest and cloud reports (06 sync not built): every 08d report is on the hub.
- Non-A-items: the screen and commands accept only `is_a_item` stock items (S2).
- Theoretical usage itself (recipe explosion of sales, comps and void waste) → **08c** (S12).

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Hub is the authority for its events; envelope `{ event_id (ULID), tenant_id, branch_id, stream_type, stream_id, event_type, schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq }`; `stream_type` is a Zod enum with **no DB CHECK** (F v1.14 F-1 note) | F §4.1 (C1) |
| Commands run through `POST /commands/<name>` (device) or `/admin/commands/<name>` (admin), `defineCommand`, one writer transaction, `command_id` idempotency, permission resolved by the pipeline | F §6.3; 00 §3.5, §3.7 |
| The engine replays only its own stream types (F-8 / F-9: `(stream_type, event_type)` lists); hub projections register with `registerHubProjections` and keep checkpoints | F §5.8 step 3–4; 04 H-2 |
| Business day is explicit (`OpenBusinessDay` / `CloseBusinessDay`, `BusinessDayOpened.business_date`); no time cutoff (owner ruling C8) | 01a §6.18a/b |
| Pre-cooked stock (`prepared` stock items, `StockSet` / `StockAdded` / `StockReserved` / `StockConsumed`) is engine-owned and day-scoped; only `prepared` items reach it (08a I9) | F §3.1 D50; 01c V4–V5; 08a I9 |
| Money is integer minor units; quantities integers in the stock unit (`piece`, `g`, `ml`); BigInt inside calculations | F §4.1 D47; 01a S44; owner ruling C4 |
| Void waste is a fact on `ItemVoided.disposition = 'wastage'`; no second event for it (owner ruling C10) | 04 V3, V4; 08a §4.3 |
| Config reaches the hub only as the cloud snapshot; optional `engine_settings` keys carry hub defaults (03b A-1 pattern) | 01a S28, R29; `packages/events/src/config.ts` |
| Device shell screens are the 05a `SCREEN_KEYS`; a device profile lists the screens it offers | 05a §3.6 |

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Reason | Overrides / changes |
|---|---|---|---|
| S1 | **New stream type `inventory`** (owner ruling C3 (a), foundation bump approved). Stream ids: `grn:<grn_id>` (`GoodsReceived`), `xfer:<transfer_id>` (`StockTransferReceived`), `waste:<waste_id>` (`WasteRecorded`), `sheet:<business_date>` (`CountRecorded`, `DailySheetClosed`). The engine never replays it (not in any 03a reducer list); only 08d's hub projections read it | Engine replay and 03a perf untouched; one document per stream keeps the history readable | F §4.1 (row F-1), §3.1 D50 note (row F-2) |
| S2 | **A-items only.** Every 08d command line names a stock item that is in the snapshot's inventory items (08b), active, `is_a_item = true`, and of `kind ∈ ingredient, packet` (raw lines) — or, for a **cooked** count / waste entry, a `prepared` item that 08b lists as the **cooked form** of an A-item (S10). Else `404 STOCK_ITEM_NOT_FOUND` (unknown / archived) or `422 INVENTORY_ITEM_NOT_TRACKED` | R39 (b): 5 A-items; the screen stays one page | — |
| S3 | **`GoodsReceived` is the only receiving event** (08-g0 D4); `mode: 'quick_receive'` is the only mode in the pilot (the Zod enum has only this value now; POST modes are added by a later schema version). Lines enter a quantity in **any unit `resolveUnit` accepts for the item** (08a I5, with the snapshot's item units); the hub stores both the entered `{ unit_name, qty_num, qty_den }` and `qty_stock_units` = round half up of `qty_num × conv.num ÷ (qty_den × conv.den)`, ≥ 1, and freezes the conversion used (`conv_num`, `conv_den`) | One event as 08-g0 D4; integers (C4); the entered value stays auditable | 08-g0 §3.12 `qty, uom, qty_stock_unit` → integer form |
| S4 | **Receipt checks per item flag** (cloud fields, C-1): `must_weigh_on_receipt` ⇒ the entered unit resolves through a **weight** (`g`, a built-in on `g`, or an item unit with `base_unit = 'g'`), never `piece` (`422 { field: 'lines.N.unit_name', reason: 'weigh_required' }`); `track_piece_count` ⇒ `piece_count` (1 … 100 000) required on the line (`400`); else it is refused (`400`). Paye: kg **and** pieces (08-g0 §4) | 08-g0 §4 "Weight + piece count on paye receipt" | 08a §4.3 (fields moved here) |
| S5 | **Price on a receipt is optional.** `price_total_minor` (1 … 10 000 000 000) present ⇒ the line updates the MWA (S6) and **is** the price observation; no separate `PriceObserved{grn}` event (the line already carries item, qty, price, time, user) | 08-g0 D3 wanted a grn price trend: the line is that record; a second event would duplicate it (same reasoning as C10) | 08-g0 D3 "each costed receipt line also emits `PriceObserved{grn}`" → the line is the observation |
| S6 | **MWA ("today's cost")**, hub projection `inventory_item_cost (stock_item_id) → avg_micro, on_hand_basis, last_receipt_event_id`, in **micro-minor per stock unit** (1 µ-minor = 10⁻⁶ paisa; integer, round half up once per update). On a priced line: `landed = price_total_minor × 10⁶ ÷ qty_stock_units`; `new_avg = (on_hand × avg + qty × landed) ÷ (on_hand + qty)`; if `on_hand ≤ 0` or no `avg` yet: `new_avg = landed` (08-g0 §3.5). An unpriced line changes `on_hand` only. `on_hand` per **S7**. Cost of an item at a time = its `avg_micro` if one exists, else its **menu cost** (08a `effectiveMenuPrice`, snapshot inputs, 08b), else **none** (never 0) | Integers that do not grow (a fraction would); one rounding rule | 08-g0 MWA formula, integer form |
| S7 | **`on_hand` for the MWA — OPEN, owner decides (§12.3 OQ-1).** Options: **(a) count-anchored** — `on_hand` = the item's latest closing (or opening-seed) **raw** count + receipts + transfers-in − raw waste since that count; usage between counts is ignored. **(b) perpetual** — (a) minus theoretical usage since the count (08c), so on_hand falls during the day. **(c) last-price** — no average: today's cost = the latest priced receipt. **Rec (a)** for the pilot: A-items are counted every day, so (a)'s error is at most one day's usage, it needs no 08c and no recipe coverage, and it is exact right after each count. Note: the MWA is a **projection** and can be rebuilt from the events under another rule later; only values frozen into later events (`unit_cost_micro` on `WasteRecorded`, `DailySheetClosed`) keep the old rule — that part is not reversible | Pilot detects loss daily; (b) mixes recipe errors into cost | — |
| S8 | **Transfer-in, branch side only** (`StockTransferReceived`): the branch records what arrived (packets from the CK, or stock from another branch), `from_label` free text ≤ 40, optional `lot_code` ≤ 20, lines in stock units. Unit cost per line = the item's **menu cost at receipt** (08-g0 §3.5.4; 08a I7), frozen as `unit_cost_micro` (null when the item has no price); the line moves `on_hand` (S7) and counts as a priced receipt for the MWA when a cost exists. No dispatch side, no discrepancy (POST) | 06 sync not built: a CK dispatch cannot reach the branch hub | 08-g0 `StockTransferDispatched` → POST |
| S9 | **`CountRecorded`** (one shape, 08-g0 D5): per business date, per A-item, `kind ∈ opening_seed, closing`; raw part `raw_qty_stock_units` (integer ≥ 0, or **null = not counted**); cooked part `cooked: [{ prepared_stock_item_id, qty_stock_units }]` (S10); `is_estimated`; entered unit kept as in S3. A later `CountRecorded` for the same `(business_date, stock_item_id, kind)` **supersedes** the earlier (recount); the projection keeps the latest by `seq`. "Not counted" is the **absence** of a count or a null raw part; an explicit 0 is zero (08-g0 §4). `opening_seed` is allowed only while the item has no closed sheet yet (the first day) | 08-g0 D5, §4 | 08-g0 `session_id`, `spot` → POST |
| S10 | **Cooked counts and PAYE-COOKED.** A cooked entry names a `prepared` stock item that 08b's published `per_batch` recipe makes **from** the A-item (08b §4.2 `cookedFormsOf(itemId)`); raw-equivalent = `qty × (A-item AP qty in the batch) ÷ batch_yield_qty` through 08b's explosion, computed **at sheet close**, not stored on the count. The physical leftover counted here (pieces in the degh at close) is **the same thing** the engine's pre-cooked `StockSet` counts during service, but 08d **does not write `StockSet`** and does not read the engine level as a count: the engine's level is a running service figure (reservations, day-scoped, `carries_over`), the sheet needs a person's physical count at one moment. The screen shows the engine's current level beside the cooked field as a hint ("system: 14"). Owner OQ-2 | Two meanings, one pot: keep the engine out of inventory (C3) and keep the count physical | — |
| S11 | **Waste.** `WasteRecorded` is **user waste only** (C10): `stage ∈ raw, cooked` (cooked → a cooked form of S10, raw-equivalent at close), `reason ∈ spoiled, expired, dropped, burnt, quality_reject, other` (`other` needs a note), quantity as S3, `unit_cost_micro` = the item's cost at record (S6), frozen. Void waste is **not** recorded here: the sheet reads `ItemVoided` lines with `disposition = 'wastage'` through 08c's explosion (S12) and shows them as **void waste** beside user waste. 08d does not touch the engine's pre-cooked stock; dropping cooked pieces is still adjusted there by `SetPrecookedStock` as today (OQ-3) | C10; one source per fact | 08-g0 `void_after_prep, source: system` → read from 04 |
| S12 | **Variance needs 08c.** `CloseDailySheet` calls **08c's** `theoreticalUsage(db, { business_dates }) → { by_item: Map<stock_item_id, { sold_comped: Fraction, void_waste: Fraction }>, coverage_bp: number } \| null` (08c §4.2, required by row R-c). Until 08c ships it returns `null`: the sheet still closes, with `theoretical_usage`, `variance_*` null and `flag = 'unreliable'`, `unreliable_reasons ⊇ ['no_theoretical']`. So 08d-1 + the close can ship before 08c and the event shape does not change when 08c arrives | Owner: pilot does not slip for 08d; the event is complete from day one | — |
| S13 | **The sheet and its close** (`DailySheetClosed`, immutable): for each A-item — `opening` (previous closed sheet's `closing`, or `opening_seed`), `received`, `transfer_in`, `transfer_out` (always 0 in the pilot), `user_waste`, `void_waste` (08c), `closing` (raw + cooked equivalent), `actual_usage = opening + received + transfer_in − transfer_out − user_waste − closing` (void waste is part of actual usage: the food was used), `theoretical_usage = sold_comped + void_waste` (08c), `variance_qty = actual − theoretical`, `variance_bp = variance_qty × 10 000 ÷ theoretical` (null if theoretical = 0), `variance_value_minor = variance_qty × unit_cost ÷ 10⁶` (round half up), `unit_cost_micro` (S6 at close), `flag`. **Flag** (08-g0 §3.12): `over` / `under` iff `|variance_bp| > pct_bp` **and** `|variance_value_minor| > value_minor` (settings S16); `unreliable` iff coverage < 9 500 bp, **or** the chain is broken (the previous business date has no closed sheet: the period spans every day since the last closed sheet and the sheet shows it), **or** no theoretical (S12), **or** a quantity is estimated; else `ok`. All quantities integers in stock units (fractions from 08c rounded half up once, at close) | 08-g0 §3.12 formulas, integer form | — |
| S14 | **Closing rules.** Close needs a **closing** count for **every** A-item with a non-null raw part (08-g0 §4: "all A-items must be entered to close"; `409 INVENTORY_COUNT_MISSING { stock_item_ids }`). A correction is a new `DailySheetClosed` with `supersedes: <event_id>` of the current one for that date (needs `close-daily-sheet` and a note); the projection shows the latest. A sheet may be closed for the **open** business day, or for the **last closed** day while no newer day is open (staff count after day close) — the same rule for `RecordCount`. Receipts, transfers and waste need the **open** day (`409 BUSINESS_DAY_NOT_OPEN`, C8). Day close is **not** blocked by an unclosed sheet (fallback; no new day-close guard) | Counting happens at night; the pilot must not stop on a missing sheet | — |
| S15 | **Permissions** (01b bump, row B-1): `receive-stock` (`ReceiveGoods`, `ReceiveTransfer`), `record-waste` (`RecordWaste`), `count-inventory` (`RecordCount`), `close-daily-sheet` (`CloseDailySheet`, corrections, the report). Group `menu_stock`, scope `branch` only. Defaults: Owner, Manager all four; no other default role. The owner makes a "Store keeper" role with the first three (OQ4 of the analysis: store keeper fills, manager closes). `close-daily-sheet` is in `LISTED_ONLY_PERMISSIONS` (a sheet close is a sign-off, like `approve-void`) | Fill and close by different people, as on paper | 01b §4.2 (B-1) |
| S16 | **Settings** (R18, 01a bump row A-1): `inventory_variance_pct_bp` (default 300 = 3 %, 1 … 10 000) and `inventory_variance_value_minor` (default 50 000 = Rs 500, 0 … 100 000 000) in `branch_engine_settings` (audit entity `branch_settings`), delivered as optional `engine_settings` keys with hub defaults (03b A-1 pattern). The close freezes the values it used into the event | 08-g0 §3.12 "both configurable"; R18 | 01a §5 / snapshot `engine_settings` |
| S17 | **Item fields from 08a** (01c bump row C-1): `must_weigh_on_receipt`, `track_piece_count` (stock unit `g` / `ml`, not `packet`), `default_purchase_unit` (null or a unit `resolveUnit` accepts; checked at write, re-checked by the hub at use: a unit that no longer resolves is simply not preselected). Delivered by **extending 08b's snapshot `inventory` items** with these three fields (row R-b). `shelf_life_days` deferred | Their first reader is this screen | 08a §4.3 row "08d" |
| S18 | **Who sees what.** The screen lists the A-items with: today's cost (S6; label **"Today's cost"**, help "From deliveries; menu cost when there is none", 08a I12), menu cost (label **"Menu cost"**), today's received / transfer-in / waste, the count entered. "Today's cost" is never labelled "menu cost" or the reverse | 08a I12 (owner ruling C7) | — |

### 3.2 Command processing order (each command, a subset of F §6.3)

payload Zod (`400`) → session kind + permission (pipeline, `403`) → config present and the item checks of S2 (`404` / `422`) → business-day rule (S14, `409 BUSINESS_DAY_NOT_OPEN`) → command rules (`422` / `409`) → append (one writer transaction; projections applied live) → result. Idempotent retransmit by `command_id` returns the stored result (00 §3.5).

### 3.3 Validation rules

| Rule | Error |
|---|---|
| Line `stock_item_id` not in the snapshot's inventory items or archived | `404 STOCK_ITEM_NOT_FOUND { stock_item_id }` |
| Item not an A-item, or of a kind the line does not accept (S2) | `422 INVENTORY_ITEM_NOT_TRACKED { stock_item_id }` |
| Cooked entry's item not a cooked form of the A-item (S10) | `422 INVENTORY_ITEM_NOT_TRACKED { stock_item_id, reason: 'not_cooked_form' }` |
| Unit does not resolve for the item (08a I5) | `422 CONFIG_REFERENCE_INVALID { field: 'lines.N.unit_name', reason: 'not_convertible' }` |
| Weigh-required item entered in a non-weight unit (S4) | `422 CONFIG_REFERENCE_INVALID { field: 'lines.N.unit_name', reason: 'weigh_required' }` |
| `piece_count` missing on a `track_piece_count` item, or sent on another item | `400` |
| `qty_num` 1 … 10¹², `qty_den` 1 … 10⁶; resulting `qty_stock_units` ≥ 1 (count: ≥ 0) and ≤ 10¹² | `400` |
| `price_total_minor` 1 … 10¹⁰ | `400` |
| Lines per command: 1 … 20; one line per item per command (receive, count) | `400` |
| Waste `reason = 'other'` without `note`; `note` ≤ 200 | `400` |
| No open day (receive, transfer, waste); not the open or last closed day (count, close) | `409 BUSINESS_DAY_NOT_OPEN` |
| `opening_seed` for an item that already has a closed sheet | `409 INVENTORY_SEED_NOT_ALLOWED { stock_item_id }` |
| Close without a non-null closing raw count for every A-item | `409 INVENTORY_COUNT_MISSING { stock_item_ids }` |
| Close when the date already has a sheet and no `supersedes`, or `supersedes` is not the date's current sheet | `409 INVENTORY_SHEET_CLOSED { business_date, current_event_id }` |
| Correction without a note | `400` |

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 08a | `resolveUnit`, `normaliseUnitName`, `toStockUnits`, `effectiveMenuPrice`, `pricePerStockUnit` (`@pos/domain/inventory`) |
| 08b (row R-b) | snapshot `inventory` key: items (`stock_item_id`, `kind`, `stock_unit`, `is_a_item`, `code`, archived state + S17's three fields), current item units, menu-price inputs, published recipes; `cookedFormsOf(itemId)` and the batch explosion (§4.2 of 08b) |
| 08c (row R-c) | `theoreticalUsage(db, { business_dates }) → { by_item, coverage_bp } \| null` (S12) |
| 01a | open / last closed business day (hub stream), `branchConfig()`, `engine_settings` defaults pattern |
| 04 | `ItemVoided.disposition` — read by 08c, not by 08d directly |
| 01c | the engine's current pre-cooked level of a `prepared` item (`stockOf`, read-only, hint only, S10) |

### 4.2 Exposes

| Export | Shape | Used by |
|---|---|---|
| Events (`@pos/events`, stream `inventory`) | `GoodsReceived` v1, `StockTransferReceived` v1, `WasteRecorded` v1, `CountRecorded` v1, `DailySheetClosed` v1 (§5.3) | 06 (sync), 07 (owner view), POST receiving |
| Hub query `todaysCost(db, stockItemId) → { avg_micro: bigint, source: 'mwa' } \| { per_stock_unit: Fraction, source: 'menu' } \| null` | `apps/hub/src/inventory/cost.ts` | 08c (if it prefers today's cost; its own decision) |
| Projections `inventory_moves`, `inventory_counts`, `inventory_item_cost`, `daily_sheets` | §5.2 | 08d queries, 07 |

### 4.3 Requirements on other parts of module 08

| Row | To | Requirement |
|---|---|---|
| R-b | 08b | The snapshot `inventory` items carry `must_weigh_on_receipt`, `track_piece_count`, `default_purchase_unit` (S17) — either 08b includes them (if 08b is approved after 08d) or 08d adds them as additive optional fields to 08b's key. 08b exposes `cookedFormsOf(itemId)` and a batch explosion usable at sheet close (S10) |
| R-c | 08c | 08c exposes `theoreticalUsage(db, { business_dates })` with `sold_comped` (sales + comps, D12) and `void_waste` (`ItemVoided` `wastage`, C10) per A-item in stock units as fractions, plus `coverage_bp` by revenue; `null` before 08c ships (S12) |

### 4.4 Story → part

08d-1: S2–S11, S14 (receive / transfer / waste / count), S15–S18, screen, day view. 08d-2: S12, S13, S14 (close), report.

### 4.5 Changes to other specs (R26)

Applied when 08d is approved (as part of module 08's next version), each target bumped with a changelog and "⚠️ Changed by 08d (row X)" markers.

| Row | Target → version, section | Change | Why |
|---|---|---|---|
| F-1 | **Foundation → v1.16** §4.1 envelope + `packages/events/src/envelope.ts` | `stream_type` gains **`'inventory'`** (stream ids `grn:`, `xfer:`, `waste:`, `sheet:<business_date>`); Zod enum only, no DB CHECK (as F v1.14 F-1); not replayed by the engine (F-8 lists unchanged) | S1, owner ruling C3 |
| F-2 | Foundation §3.1 D50 | Note: "one stock projection" is the engine's **pre-cooked** stock; purchased inventory (`ingredient`, `packet`) is a separate hub projection on the `inventory` stream that the engine never reads | S1, 08a I9 |
| F-3 | Foundation §6.2 status map | 08d §9 codes appended (no bump on its own, R34) | §9 |
| B-1 | **01b → v1.11** §4.2 catalogue, `packages/domain/src/permissions.ts` | `receive-stock`, `record-waste`, `count-inventory`, `close-daily-sheet`: group `menu_stock`, scope `branch`; defaults Owner + Manager; `close-daily-sheet` in `LISTED_ONLY_PERMISSIONS`; client labels `perm.*` | S15 |
| C-1 | **01c → v1.3** §3.1 V3, §3.3, §5.4, §6.7, §6.8, §8 | `stock_items` gains `must_weigh_on_receipt`, `track_piece_count` (CHECK `NOT track_piece_count OR (stock_unit IN ('g','ml') AND kind <> 'packet')`), `default_purchase_unit` (service-resolved, `422 not_convertible`); in the version input and the owner form; inventory-only fields (no bump while 08a I11 holds; after 08b, they bump with the inventory key) | S17 |
| A-1 | **01a → v2.9** `branch_engine_settings`, snapshot `engine_settings` | Two optional keys `inventory_variance_pct_bp`, `inventory_variance_value_minor` with hub defaults 300 / 50 000; cloud columns + owner settings page | S16 |
| D-1 | **05a → v1.1** §3.6, `packages/domain/src/screens.ts` | `SCREEN_KEYS` gains **`inventory`**, offered on `tablet` and `phone` (not `kds`; not `cashier_kiosk` by default); the shell shows it to a person holding any of the four S15 permissions | S18 |
| — | 03a / `@pos/engine` | **No change**: the `inventory` stream is not in any reducer list; `prepared` stock untouched (S10) | S1 |
| — | 04, 05 | **No change** (04 read through 08c) | S11 |
| — | Close (`CloseBusinessDay`) | **No new guard** (S14) | fallback |

---

## §5. Data model and migrations

### 5.1 Cloud — `0019_inventory_receiving.sql` (expand)

```sql
-- 08d §5.1 (01c row C-1, 01a row A-1).
ALTER TABLE stock_items
  ADD COLUMN must_weigh_on_receipt BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN track_piece_count BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN default_purchase_unit TEXT,                         -- resolved by the service (08a I5)
  ADD CONSTRAINT stock_items_piece_count CHECK (NOT track_piece_count OR (stock_unit IN ('g','ml') AND kind <> 'packet'));
ALTER TABLE branch_engine_settings                               -- audit entity 'branch_settings' (0012 pattern)
  ADD COLUMN inventory_variance_pct_bp INT NOT NULL DEFAULT 300 CHECK (inventory_variance_pct_bp BETWEEN 1 AND 10000),
  ADD COLUMN inventory_variance_value_minor BIGINT NOT NULL DEFAULT 50000
    CHECK (inventory_variance_value_minor BETWEEN 0 AND 100000000);
```
(Branch settings live in `branch_engine_settings` (`0007` / `0012_kds_settings.sql` add columns the same way; audit entity `branch_settings`); the build task re-reads the live table first, 01b D-5.)

### 5.2 Hub — `0028_inventory.sql` (projections; rebuilt from the `inventory` stream)

```sql
CREATE TABLE inventory_moves (                    -- one row per receipt / transfer / waste line
  event_id TEXT NOT NULL, line_no INTEGER NOT NULL,
  business_date TEXT NOT NULL, stock_item_id TEXT NOT NULL,
  move TEXT NOT NULL CHECK (move IN ('received','transfer_in','waste_raw','waste_cooked')),
  qty_stock_units INTEGER NOT NULL,               -- cooked waste: in the cooked item's unit
  cooked_stock_item_id TEXT,                      -- waste_cooked only
  price_total_minor INTEGER, unit_cost_micro INTEGER,
  seq INTEGER NOT NULL,
  PRIMARY KEY (event_id, line_no));
CREATE INDEX inventory_moves_day ON inventory_moves (business_date, stock_item_id);   -- day view, sheet close
CREATE INDEX inventory_moves_item_seq ON inventory_moves (stock_item_id, seq);        -- S7 (a) since the anchor count

CREATE TABLE inventory_counts (                   -- latest count per (date, item, kind) (S9)
  business_date TEXT NOT NULL, stock_item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening_seed','closing')),
  raw_qty_stock_units INTEGER,                    -- NULL = not counted
  cooked_json TEXT NOT NULL,                      -- [{prepared_stock_item_id, qty_stock_units}]
  is_estimated INTEGER NOT NULL, event_id TEXT NOT NULL, seq INTEGER NOT NULL,
  PRIMARY KEY (business_date, stock_item_id, kind));
CREATE INDEX inventory_counts_item_seq ON inventory_counts (stock_item_id, seq);       -- S7 anchor lookup

CREATE TABLE inventory_item_cost (                -- S6
  stock_item_id TEXT PRIMARY KEY,
  avg_micro INTEGER,                              -- NULL = no priced receipt yet
  on_hand_stock_units INTEGER NOT NULL,           -- S7 (a)
  anchor_seq INTEGER, updated_seq INTEGER NOT NULL);

CREATE TABLE daily_sheets (                       -- latest DailySheetClosed per date (S14)
  business_date TEXT PRIMARY KEY, event_id TEXT NOT NULL, supersedes TEXT,
  flag_summary TEXT NOT NULL,                     -- worst flag of the items, for the report list
  payload_json TEXT NOT NULL, seq INTEGER NOT NULL);
```
All four register as hub projections (`eventTypes` per §5.3), with `reset` for rebuild. `INTEGER` holds BigInt-safe values ≤ 2⁶³; better-sqlite3 reads them with `safeIntegers` for the three cost / quantity columns.

### 5.3 Events (`packages/events/src/events/inventory/*.v1.ts`, stream `inventory`)

```jsonc
GoodsReceived v1 {            // stream_id "grn:<grn_id>"
  grn_id, business_date, mode: "quick_receive",
  supplier_name_freetext?,    // ≤ 60
  lines: [{ line_no, stock_item_id, unit_name, qty_num, qty_den, conv_num, conv_den,
            qty_stock_units, piece_count?, price_total_minor? }]
}
StockTransferReceived v1 {    // "xfer:<transfer_id>"
  transfer_id, business_date, from_label, lot_code?,
  lines: [{ line_no, stock_item_id, unit_name, qty_num, qty_den, conv_num, conv_den,
            qty_stock_units, unit_cost_micro? }]          // menu cost at receipt (S8), null when none
}
WasteRecorded v1 {            // "waste:<waste_id>"
  waste_id, business_date, stage: "raw" | "cooked",
  stock_item_id,              // the A-item
  cooked_stock_item_id?,      // stage cooked (S10)
  unit_name, qty_num, qty_den, conv_num, conv_den, qty_stock_units,
  reason: "spoiled" | "expired" | "dropped" | "burnt" | "quality_reject" | "other",
  note?, unit_cost_micro?     // cost at record (S6); raw only; cooked valued at close
}
CountRecorded v1 {            // "sheet:<business_date>"
  business_date, stock_item_id, kind: "opening_seed" | "closing",
  raw: { unit_name, qty_num, qty_den, conv_num, conv_den, qty_stock_units } | null,   // null = not counted
  cooked: [{ prepared_stock_item_id, qty_stock_units }],
  is_estimated
}
DailySheetClosed v1 {         // "sheet:<business_date>"
  business_date, period_dates: [..],          // > 1 date when the chain was broken (S13)
  supersedes?, note?,
  settings: { pct_bp, value_minor }, coverage_bp: number | null,
  items: [{ stock_item_id, opening, received, transfer_in, transfer_out, user_waste, void_waste,
            closing, cooked_equiv, actual_usage, theoretical_usage, variance_qty, variance_bp,
            variance_value_minor, unit_cost_micro, flag: "ok"|"over"|"under"|"unreliable",
            unreliable_reasons: ("coverage"|"chain_broken"|"no_theoretical"|"estimated")[] }]
}
```
Quantities are integers in the A-item's stock unit; `theoretical_usage`, `void_waste`, `variance_*`, `unit_cost_micro` may be null (S12). `actor_id` = the session's staff (who received / counted / closed). Micro-minor and quantity values above 2⁵³ are encoded as decimal strings in the Zod schema (`z.string().regex(/^-?\d+$/)`) — only `unit_cost_micro`; quantities stay `number` (≤ 10¹²).

---

## §6. Commands and queries

All commands: `sessionKind: 'both'` (device screen and hub admin, 00 v1.12 H-1), `command_id` idempotency, queueable **no** (an offline device does not queue inventory entries: counts depend on the moment). Shared failures not repeated: `400 VALIDATION_FAILED`, `401`, `403 PERMISSION_DENIED`, `403 DEVICE_ACCESS_DENIED` (05a), `409 BUSINESS_DAY_NOT_OPEN`, `404 STOCK_ITEM_NOT_FOUND`, `422 INVENTORY_ITEM_NOT_TRACKED`. Statement counts below are the writer transaction's statements after the pipeline's own (idempotency row, result row).

### Batch 1 — receiving and waste (08d-1)

#### 6.1 `ReceiveGoods` (permission `receive-stock`)

| | |
|---|---|
| Payload | `{ supplier_name_freetext?, lines: [{ stock_item_id, unit_name, qty_num, qty_den?: 1, piece_count?, price_total_minor? }] (1–20, one per item) }` |
| Script | §3.2: S2 per line → open day → S3 resolve (snapshot units) → S4 → append `GoodsReceived` (`grn_id` = new ULID) → projections: `inventory_moves` (1 insert per line), `inventory_item_cost` (1 read + 1 upsert per line, S6 / S7) |
| Result | `{ grn_id, lines: [{ stock_item_id, qty_stock_units, todays_cost: CostWire }] }` |
| Statements | 1 event insert + 3 per line |

| Edge | Answer |
|---|---|
| Paye 18.5 kg, 92 pieces, Rs 33,300 | `qty_stock_units` 18 500; `landed` = 3 330 000 × 10⁶ ÷ 18 500 = 180 000 000 µ-minor/g (Rs 1.80/g); MWA per S6 |
| Paye in `piece` | `422 weigh_required` |
| Paye without `piece_count` | `400` |
| Beef 12 kg, no price | `on_hand` + 12 000; `avg` unchanged |
| Item not an A-item | `422 INVENTORY_ITEM_NOT_TRACKED` |
| No open day | `409 BUSINESS_DAY_NOT_OPEN` |
| Retransmit (same `command_id`) | stored result, no second event |

#### 6.2 `ReceiveTransfer` (`receive-stock`)

Payload `{ from_label, lot_code?, lines: [{ stock_item_id, unit_name, qty_num, qty_den? }] }`. Script as 6.1 with S8 (menu cost at receipt from the snapshot; `null` when none). Result `{ transfer_id, lines }`. Statements as 6.1. Edge: TP-1 2 400 g, menu cost Rs 3.00/g → `unit_cost_micro` 300 000 000, MWA updated; a packet with no price → line stored, `on_hand` only.

#### 6.3 `RecordWaste` (`record-waste`)

Payload `{ stage, stock_item_id, cooked_stock_item_id?, unit_name, qty_num, qty_den?, reason, note? }`. Script: S2 (cooked: S10) → open day → S3 → append → `inventory_moves` (1), `inventory_item_cost` (raw: 1 read + 1 update). Result `{ waste_id, qty_stock_units, unit_cost_micro }`. Edges: `reason: 'other'` without note `400`; cooked PAYE-COOKED 6 pieces → stored in pieces, raw-equivalent at close; ghee raw 500 g → `on_hand` − 500.

### Batch 2 — counts and the day view (08d-1)

#### 6.4 `RecordCount` (`count-inventory`)

| | |
|---|---|
| Payload | `{ business_date, kind: 'opening_seed' \| 'closing', entries: [{ stock_item_id, raw: { unit_name, qty_num, qty_den? } \| null, cooked?: [{ prepared_stock_item_id, qty }], is_estimated?: false }] (1–20) }` |
| Script | S2 → S14 date rule (open or last closed day; `409`) → seed rule (`409 INVENTORY_SEED_NOT_ALLOWED`) → S10 cooked forms → S3 → one `CountRecorded` per entry → `inventory_counts` upsert (1 per entry); a closing raw count moves the S7 (a) anchor (`inventory_item_cost`: 1 update) |
| Result | `{ counts: [{ stock_item_id, kind, raw_qty_stock_units, superseded: boolean }] }` |
| Statements | 2–3 per entry |

Edges: raw `null` → stored "not counted"; raw `0` → zero; recount → `superseded: true` for the older; count on the open day before any receipt → fine.

#### 6.5 Query `GET /queries/inventory-day?business_date=` (any of the four permissions)

Response: `{ business_date, day_state: 'open' | 'closed', a_items: [{ stock_item_id, name, code, stock_unit, units: [...resolvable], default_purchase_unit, must_weigh_on_receipt, track_piece_count, cooked_forms: [{ stock_item_id, name, engine_level? }], todays_cost: CostWire | null, menu_cost: CostWire | null, received, transfer_in, user_waste_raw, user_waste_cooked: [...], count: { opening_seed?, closing? } }], sheet: { event_id, flag_summary } | null }`. Default date = open day, else last closed day. **Statements: 4 fixed** (moves of the day, counts of the day, item costs for the A-items, sheet row); items, units and menu cost from the in-memory snapshot (`branchConfig()`); engine level from the engine state (memory).

### Batch 3 — close and report (08d-2)

#### 6.6 `CloseDailySheet` (`close-daily-sheet`)

| | |
|---|---|
| Payload | `{ business_date, supersedes?: event_id, note? }` (note required with `supersedes`) |
| Script | S14 date rule → current sheet check (`409 INVENTORY_SHEET_CLOSED`) → every A-item has a non-null closing raw count (`409 INVENTORY_COUNT_MISSING`) → period dates (previous closed sheet; S13 chain) → read moves and counts of the period → `theoreticalUsage` (08c; null until 08c, S12) → cooked equivalents (08b explosion) → S13 per item, settings frozen (S16) → append `DailySheetClosed` → `daily_sheets` upsert |
| Result | `{ event_id, business_date, items: [...], flag_summary }` |
| Statements | fixed: 1 previous-sheet read, 1 moves read, 1 counts read, 1 costs read, 08c's fixed reads, 1 event insert, 1 upsert |

| Edge | Answer |
|---|---|
| Ghee closing count missing | `409 INVENTORY_COUNT_MISSING { stock_item_ids: ['ghee'] }` |
| Before 08c | closes; theoretical / variance null; every item `unreliable` with `no_theoretical` |
| Previous date not closed | `period_dates` = both dates; `chain_broken` |
| Beef variance −4 % and −Rs 620 | `under` (both thresholds exceeded) |
| Variance −4 % but −Rs 300 | `ok` |
| Second close without `supersedes` | `409 INVENTORY_SHEET_CLOSED` |
| Correction | new event with `supersedes`; report shows the latest, history lists both |

#### 6.7 Query `GET /admin/queries/daily-sheets?from=&to=` (`close-daily-sheet` or `view-reports`)

List of `{ business_date, flag_summary, closed_by, closed_at, superseded_count }` (max 62 days). **2 statements** (sheets, superseded counts).

#### 6.8 Query `GET /admin/queries/daily-sheets/:business_date`

The latest sheet's payload + its history (`supersedes` chain) + the day's moves. **3 statements**.

---

## §7. Cross-cutting

| Item | Decision |
|---|---|
| Logging | Command logs carry ids and counts only; notes and supplier names never logged |
| Offline | Commands need the hub (LAN); not queueable (§6); the screen shows a "hub unreachable" state |
| Performance | ≤ 20 lines per command; the day view reads one day; the close reads one period (usually one day). No index beyond §5.2 |
| Privacy | `supplier_name_freetext` is business data; no person data beyond `actor_id` |
| Risks | (1) Staff skip the count → the close refuses (S14) and the sheet stays open; the manager sees "not closed" in the report (drill 3 tells which step is skipped). (2) Cooked counts depend on 08b recipes: a wrong batch yield skews the paye line → visible as `unreliable` only through coverage; the owner checks drill 1 numbers first. (3) S7 (a) bias between counts — accepted for the pilot |

---

## §8. Client contract

1. **Device screen "Inventory"** (05a screen key `inventory`; `apps/client/src/features/inventory/`): one page, the A-items as rows, four actions per row or at the top: **Receive** (unit pick-list from `units`, preselected `default_purchase_unit`; kg + pieces for paye; optional total price; supplier free text), **Transfer in** (from, lot code, qty), **Waste** (raw / cooked, reason chips, note), **Count** (raw qty + cooked forms with the engine hint, "estimated" toggle; "not counted" is the default, never 0). Labels per S18. Only the actions the person's permissions allow are shown.
2. **Close** (same screen, `close-daily-sheet` holders): lists missing counts; on close shows the per-item table with flags; correction asks for a note.
3. **Hub admin report** (`apps/client/src/features/admin/inventory/`): date range list (flag summary), sheet detail (items, period, settings used, history).
4. **Owner app** (01c C-1, 01a A-1): stock item form gains "Weigh on receipt", "Count pieces on receipt", "Default purchase unit"; branch settings gain the two thresholds.
5. Errors use existing texts plus the §9 codes; Urdu strings go to the urdu-todo list.

---

## §9. Error catalogue additions

| Code | Status | `details` | Condition |
|---|---|---|---|
| `INVENTORY_ITEM_NOT_TRACKED` | 422 | `{ stock_item_id, reason?: 'not_a_item' \| 'wrong_kind' \| 'not_cooked_form' }` | S2, S10 |
| `INVENTORY_SEED_NOT_ALLOWED` | 409 | `{ stock_item_id }` | S9 |
| `INVENTORY_COUNT_MISSING` | 409 | `{ stock_item_ids: string[] }` | S14 |
| `INVENTORY_SHEET_CLOSED` | 409 | `{ business_date, current_event_id }` | S14 |

New reason `weigh_required` on `422 CONFIG_REFERENCE_INVALID` (S4). Appended to F §6.2 and `@pos/domain/src/errors.ts` (row F-3).

---

## §10. Tests

### 10.1 Pure (`packages/domain/src/inventory/mwa.test.ts`, `sheet.test.ts`)

| # | Case |
|---|---|
| 1 | MWA: first priced receipt → `landed`; second with on_hand → weighted; `on_hand ≤ 0` → `landed`; unpriced → avg unchanged; half-up rounding to µ-minor |
| 2 | S7 (a) on_hand: anchor = latest closing raw count; + receipts + transfers − raw waste since; no anchor → sum since start |
| 3 | Quantity conversion S3: 18.5 kg (185/10) → 18 500 g; 1.5 darjan → 18 pieces; 1/3 kg → 333 g (half up) |
| 4 | Sheet formulas S13: actual, theoretical, variance qty / bp / value; theoretical 0 → bp null |
| 5 | Flags: both thresholds needed for over / under; coverage < 9 500, chain broken, no theoretical, estimated → unreliable with reasons; a mix keeps all reasons |
| 6 | Chain: previous date closed → one date; gap → period of all dates since the last sheet |

### 10.2 Hub commands (`apps/hub/test/inventory/*.int.test.ts`)

| # | Case |
|---|---|
| 7 | `ReceiveGoods` happy path: event, moves, cost; statements 1 + 3 × lines |
| 8 | `ReceiveGoods` each error: not found, not tracked, not convertible, weigh required, piece count missing / not allowed, no open day, duplicate item line |
| 9 | `ReceiveGoods` retransmit → one event |
| 10 | `ReceiveTransfer`: menu cost frozen; no price → null cost, on_hand only |
| 11 | `RecordWaste`: raw moves cost on_hand; cooked needs a cooked form (`not_cooked_form` otherwise); `other` needs note |
| 12 | `RecordCount`: null vs 0; recount supersedes; seed allowed only before the first closed sheet; closing count moves the S7 anchor |
| 13 | `RecordCount` after `CloseBusinessDay` (no new day open) → accepted for the closed day; after the next `OpenBusinessDay` → `409` |
| 14 | Day view: 4 statements; defaults to open day; labels data present (today's cost vs menu cost sources); engine hint for PAYE-COOKED |
| 15 | `CloseDailySheet`: missing count → `409`; before 08c → closes with `no_theoretical`; with an 08c stub → flags as test 5; chain broken → period; settings frozen |
| 16 | `CloseDailySheet` second time → `409 INVENTORY_SHEET_CLOSED`; correction with `supersedes` + note → latest shown, history 2 |
| 17 | Permissions: each command refused without its key; store keeper role (first three) cannot close; `close-daily-sheet` refused on an `everyone` device (listed only) |
| 18 | Report queries: list 2 statements, detail 3 statements, 62-day cap |
| 19 | Engine untouched: a full day of 08d commands leaves `EngineState` byte-identical to a day without them; replay filter excludes `inventory` |
| 20 | Projection rebuild: `reset` + catch-up from events reproduces the four tables exactly |

### 10.3 Races (`apps/hub/test/inventory/races.int.test.ts`)

| # | Case |
|---|---|
| 21 | Two devices `RecordCount` the same item and date: both events land (single writer); the later `seq` wins in the projection |
| 22 | `CloseDailySheet` vs a late `RecordCount` on the same date: the writer serialises; the sheet uses the counts committed before it; the later count is visible as "after close" in the detail |
| 23 | `ReceiveGoods` vs `CloseBusinessDay`: the receipt commits on the open day or is refused `409`; never stored on a closed day |

### 10.4 Cloud (`apps/cloud/test/inventory/receiving-fields.int.test.ts`)

| # | Case |
|---|---|
| 24 | Stock item PATCH: piece count on a packet / piece item refused (CHECK + `400`); `default_purchase_unit` not resolvable → `422 not_convertible` |
| 25 | Branch settings: thresholds ranges; snapshot `engine_settings` carries them; hub default when absent |
| 26 | Migration on an 08a-era database: defaults false / null / 300 / 50 000, no behaviour change |

### 10.5 Client

| # | Case |
|---|---|
| 27 | Inventory screen: actions per permission; paye receive asks kg + pieces; "not counted" default; S18 labels |
| 28 | Close: missing counts listed; flags rendered; correction needs a note |
| 29 | Admin report list / detail |

### 10.6 Acceptance

| Source | Check | Test |
|---|---|---|
| 08-g0 §3.12 daily sheet | receive, transfer, waste, count, close | 7–16 |
| D3 MWA from receipts only | S6 | 1, 7, 10 |
| §4 not counted ≠ 0; all A-items to close | S9, S14 | 12, 15 |
| §4 weight + count on paye | S4 | 8 |
| §4 voided prepared food → waste | via 08c `void_waste` | 15 (08c stub) |
| R39 (b) thresholds 3 % AND Rs 500 | S13, S16 | 5, 15, 25 |
| C3 engine never sees inventory | S1 | 19 |
| R39 (c) fallback | close never blocks day close | 13, 23 |

---

## §11. Build order

**08d-1** (after 08a and 08b are merged):
1. Foundation F-1 (`envelope.ts` stream enum) + §9 codes in `errors.ts` — test (typecheck + schema).
2. Event schemas `packages/events/src/events/inventory/*.v1.ts` — §5.3.
3. Pure `packages/domain/src/inventory/{mwa,sheet}.ts` — tests 1–6.
4. 01b B-1 permissions + defaults (cloud seed) — test 17 (part).
5. 05a D-1 screen key — screens test.
6. Cloud `0019_inventory_receiving.sql` + 01c C-1 fields + 01a A-1 settings + snapshot exposure (with 08b's key) — tests 24–26.
7. Hub `0028_inventory.sql` + four projections (`apps/hub/src/projections/inventory-*.ts`) — test 20.
8. `apps/hub/src/inventory/{items,cost}.ts` (S2 checks, S6 / S7) — tests 7 (part), 14 (part).
9. Commands `receive-goods.ts`, `receive-transfer.ts`, `record-waste.ts` — tests 7–11, 23.
10. `record-count.ts` — tests 12, 13, 21.
11. Query `inventory-day` — test 14, 19.
12. Client Inventory screen (receive / transfer / waste / count) — test 27.

**08d-2:**
13. `close-daily-sheet.ts` with the `theoreticalUsage` port (null until 08c) — tests 15, 16, 22.
14. Report queries — test 18.
15. Client close + admin report — tests 28, 29.
16. When 08c lands: wire its `theoreticalUsage`; re-run 15 with real data.

16 tasks, 5 commands + 3 queries (8, plus 3 cloud changes): inside the size budget.

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done
- Tests 1–29 green; no engine test edited; test 19 proves the engine untouched.
- One week on the pilot hub with the paper sheet in parallel (drill 3): system and paper agree on every A-item's actual usage.
- Foundation v1.16, 01b v1.11, 01c v1.3, 01a v2.9, 05a v1.1 carry the §4.5 rows.

### 12.2 Endpoint checklist

| § | Command / query | Codes |
|---|---|---|
| 6.1 | ReceiveGoods | 200, 400, 403, 404, 409, 422 |
| 6.2 | ReceiveTransfer | 200, 400, 403, 404, 409, 422 |
| 6.3 | RecordWaste | 200, 400, 403, 404, 409, 422 |
| 6.4 | RecordCount | 200, 400, 403, 404, 409, 422 |
| 6.5 | inventory-day | 200, 400, 403 |
| 6.6 | CloseDailySheet | 200, 400, 403, 409 |
| 6.7 | daily-sheets list | 200, 400, 403 |
| 6.8 | daily-sheets detail | 200, 403, 404 |

### 12.3 Open questions

| # | Question | Default if not answered |
|---|---|---|
| OQ-1 | **MWA `on_hand` rule (S7): (a) count-anchored, (b) perpetual minus theoretical, (c) last price.** Irreversible part: costs frozen into `WasteRecorded` / `DailySheetClosed` | **(a)** |
| OQ-2 | Cooked paye counted separately on the sheet while the engine keeps its own pre-cooked level (S10) — OK, or should the sheet's cooked count also `StockSet` the engine? | Separate (engine hint only) |
| OQ-3 | Cooked waste on the sheet does not reduce the engine's pre-cooked level (kitchen still uses `SetPrecookedStock`) — OK? | OK |
| OQ-4 | Who closes: manager only (`close-daily-sheet` listed-only), store keeper fills (analysis OQ4) | As stated |
| OQ-5 | Final A-item list (analysis OQ2: paye, beef, ghee, anday, packets) — anything else (chanay, atta)? | The five |
| OQ-6 | Drill 3 (one paper week) before or in parallel with the first system week? | In parallel |
| OQ-7 | Hub migration number `0028` and cloud `0019` assume nothing else merges first; renumber at build if needed | Renumber at build |
| OQ-8 | As-built check: `module-08a` (2026-11-23) has the 08a domain functions as specified (`resolveUnit`, `effectiveMenuPrice`, `displayPer` added); 08b's snapshot key is not built yet — R-b cannot be verified until 08b is written | — |

### 12.4 Deferred until needed

| Item | Why not now |
|---|---|
| `shelf_life_days` | No pilot reader (no expiry / FIFO screen) |
| Receipt photos | No hub media store |
| `supplier_delivery`, `cash_purchase`, `night_drop`, blind receiving, landed cost, discrepancies | 08-g0 §5 POST |
| `StockTransferDispatched`, transfer discrepancy, CK lots | Needs 06 sync |
| `transfer_out` | No pilot case (value always 0) |
| Count sessions, spot counts, store / kitchen split | 08-g0 §5 POST |
| Non-A-item tracking | R39 (b) |
| Cloud copy of the sheet / owner-app report | Needs 06 sync; 07 |
| Variance × shift roster | POST |
