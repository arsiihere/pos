# 08d — Inventory & Costing: A-item daily sheet — Module Spec part v0.2 (DRAFT)

**v0.2 — DRAFT (2026-11-23), fixes hostile run 1** (`docs/reviews/08d_v0.1_hostile_run1.md`: 3 BLOCKER, 12 MAJOR, 21 MINOR; resolution table at the end of that file) **and applies the owner rulings of 2026-11-23 22:13 PKT ("sab recs")**. Next: hostile run 2 (full). Markers "⚠️ v0.2 (id)". One line per item:
- **Owner rulings O-1 – O-7:** O-1 sheets per **business day** (`business_day_id`); O-2 close only a **closed** day, next morning allowed, closes in order; O-3 `ReverseInventoryEntry` + large-quantity confirm; O-4 `staff_meal` voids are usage, shown as their own column; O-5 no `opening_seed` (first sheet = baseline); O-6 paye in the degh at the night count = the cooked item, a discarded leftover = cooked waste before close; O-7 YAGNI cuts (engine hint, `opening_seed`, `default_purchase_unit`, branch-to-branch transfer cost, the null-before-08c close path; 08d-2 ships after 08c).
- **Cross-slice contract (orchestrator, identical text in 08b v0.2):** 08c owns `theoreticalUsage` (full explosion, no `stopAt`); 08b exposes `explodeStockItem`; merge order 08b → 08d (cloud migration after 08b's, spec versions next free after 08b's bumps). Rows R-b, R-c.
- **B-1** every day reference keyed by `business_day_id` (S1, S9, S13, S14, §5). **B-2** cooked items are their own count / waste entries; raw equivalents through 08b `explodeStockItem` (S10). **B-3** close only a closed day; moves after the count shown and confirmed (S14).
- **M-1** cooked blank ≠ 0, required to close. **M-2** explicit 0 counts. **M-3** baseline (O-5). **M-4** reversal + `confirm_large` (O-3, S19). **M-5** flag sign, theoretical 0, no cost, two fields. **M-6** four keys allowed-only + backfill migration. **M-7** §4.5 rows 01b §6.10, 08b items, 05a, 08a I12 / OQ-2, README; versions "next free". **M-8** R-c rules (O-4). **M-9** MWA anchor by business day. **M-10** engine hint cut. **M-11** per-command error + retransmit tests; `INVENTORY_SHEET_NOT_FOUND`. **M-12** `unit_cost_source` on every frozen cost.
- **m-1** `INVENTORY_DAY_NOT_ALLOWED`. **m-2** S8 event shape. **m-3** transfer cost only for packets. **m-4** one waste valuation rule. **m-5** one BigInt division, half away from zero. **m-6** bounds ≤ 10⁹; µ-minor and derived `_minor` as decimal strings. **m-7** weigh only on `g` items. **m-8** A-item set definition. **m-9** `TodaysCostWire`. **m-10** screen offering text. **m-11** fixtures, `mode` upcaster. **m-12** folders. **m-13** local draft. **m-14** refetch rule. **m-15** projections rebuild together. **m-16** `INVENTORY_NOT_CONFIGURED`. **m-17** `piece_count` shown. **m-18** `engine_settings` pattern stated. **m-19** O-6. **m-20** batched reads. **m-21** "counted by".

**v0.1 — DRAFT (2026-11-23)**, kept as history.

This is the **08d part of module 08**, in its own file only so 08b and 08d can be drafted in parallel; **at approval it is folded into `08_Inventory_Costing_Spec` as its next version (owner OQ-1: one file for 08a–08d)**. Inputs: `docs/stories/08-g0.md` §3.3, §3.5, §3.12, §4, §7 drill 3; README **R39** (b) minimal scope, (c) paper fallback, (d) rulings C1–C12; 08a v1.0 §4.3 row "08d"; 08b v0.2 (`spec/08b-recipes`, read only). Decision rows are **S1 …**.

---

## §1. Header

| Field | Value |
|---|---|
| Module | 08d A-item daily sheet: on the branch hub, **one screen** to record quick receipts, transfers-in, user waste and the closing count of the **A-items** and of the **tracked cooked items** made from them; a moving weighted average cost per A-item ("**today's cost**", 08a I12); `DailySheetClosed` per business day with variance flags; a hub admin report |
| Version | **v0.2 — DRAFT** (2026-11-23, run 1 + owner rulings). v0.1 — DRAFT |
| Depends on | Foundation v1.15 (→ next by F-1, F-2); 00 v1.12.3 (command pipeline, sessions, queries); 01a v2.8 (business day S33, S55, day close); 01b v1.10.3 (permissions, §6.10 settings wire); 01c v1.2 (stock items, `prepared` stock); 05a v1.0.4 (screens, listed-only); 04 v1.0.8 (`ItemVoided.disposition`, read through 08c); **08a v1.0** (`kind`, `is_a_item`, item units, `resolveUnit`, `effectiveMenuPrice`); **08b v0.2** (snapshot `inventory` key, `CostInputs`, `explodeStockItem`; row R-b); **08c** (`theoreticalUsage`; row R-c; 08d-2 only) |
| Inherits | **Shared Standards from Foundation v1.15 §6**, unchanged. Carried conventions C1–C9 |
| Changes other specs | Foundation (F-1, F-2, F-3), 01b (B-1, B-2), 01c (C-1), 01a (A-1), 05a (D-1), 08a (P-1), 08b requirement (R-b), 08c requirement (R-c), README (R-1). Versions: **the next free number of each target at approval, after 08b's bumps** (merge order 08b → 08d). Full list §4.5 |
| Tier | T2 Production |
| Milestone | A (pilot), by R39 (a). **Fallback (R39 c): if 08d is not live by 2027-02-28, the manager runs the paper sheet (5 A-items, signed daily) until it ships; the pilot does not slip for 08d** |
| Build split | ⚠️ v0.2 O-7: **08d-1** (receive, transfer-in, waste, counts, reversal, today's cost, the screen, the day view) needs 08a + 08b. **08d-2** (`CloseDailySheet`, variance, report) ships **after 08c** (no close path without theoretical usage) |

### Stories covered

| Source | Item | How |
|---|---|---|
| 08-g0 §3.12, D13 | A-item daily sheet: quick receive, transfers, waste, closing count raw + cooked, daily variance | §6 batches 1–3 |
| 08-g0 D3, §3.5 step 1, MWA formula | MWA driven only by stock receipts with qty + price | S5, S6, S7 |
| 08-g0 D4 | One receiving event `GoodsReceived` with `mode`; pilot `quick_receive` only | S3 |
| 08-g0 D5 | One `CountRecorded` shape | S9 |
| 08-g0 §4 | "Not counted ≠ 0"; all A-items must be entered to close; weight + piece count on paye receipt; voided prepared food → waste, never unexplained | S9, S10, S4, S12 |
| 08-g0 D12, owner O-4 | Comps and staff meals are usage, never theft | S12, S13 |
| 08-g0 §7 drill 3 | Paper dry run, one week | §1 fallback; §12.3 OQ-6 |
| R39 (b) | 5 A-items, one hub screen, MWA, `DailySheetClosed` + flags 3 % AND Rs 500, hub admin report; nothing from POST | whole part |

### In scope
- Hub: six commands (`ReceiveGoods`, `ReceiveTransfer`, `RecordWaste`, `RecordCount`, `ReverseInventoryEntry`, `CloseDailySheet`), six events on a new **`inventory`** stream type, four hub projections, three queries (screen day view, sheet list, sheet detail).
- Cloud: two `stock_items` columns 08a moved here (`must_weigh_on_receipt`, `track_piece_count`), two branch settings (variance thresholds), the permission backfill; delivered to the hub (S15–S17).
- Client: the device screen **Inventory** (05a screen key `inventory`), the hub admin report page, owner-app fields.

### Out of scope
- Everything in 08-g0 §5 POST (suppliers, PO, full GRN modes, blind receiving, landed cost, credit memos, cash advances, requisitions, store / kitchen split, transit, CK dispatch, count sessions, spot counts, 3-stage variance, vendor scores, restatement).
- ⚠️ v0.2 O-7: `default_purchase_unit` (the screen remembers the last unit per item on the device), `opening_seed`, the engine level beside the cooked count, cost of a transfer of raw stock from another branch → §12.4. `shelf_life_days`, receipt photos → §12.4.
- Market-rate entry on the hub: the owner keeps entering market rates in the owner app (08a I10, OQ-2); the hub screen records receipts.
- Cloud ingest and cloud reports (06 sync not built): every 08d report is on the hub.
- Theoretical usage itself → **08c** (R-c).

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Hub is the authority for its events; envelope `{ event_id (ULID), tenant_id, branch_id, stream_type, stream_id, event_type, schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq }`; `stream_type` is a Zod enum with **no DB CHECK** | F §4.1 (C1) |
| Commands run through `POST /commands/<name>` (device) or `/admin/commands/<name>`, `defineCommand`, one writer transaction, `command_id` idempotency, permission resolved by the pipeline | F §6.3; 00 §3.5, §3.7 |
| The engine replays only its own `(stream_type, event_type)` lists; hub projections register with `registerHubProjections` and keep checkpoints | F §5.8; 04 H-2 |
| ⚠️ v0.2 B-1: **the business day is an action, `business_date` only a label.** Two business days may share one `business_date` (01a test 143: open → close → open on one date); a day's identity is its `BusinessDayOpened.event_id`, as `PresenceSet.business_day_id` already uses (`apps/hub/src/alerts/commands/set-presence.ts`) | 01a S33, S55 |
| Pre-cooked stock (`StockSet` / `StockAdded` / `StockReserved` / `StockConsumed`) is engine-owned and day-scoped; only `prepared` items reach it (08a I9) | F §3.1 D50; 01c V4–V5; 08a I9 |
| Money is integer minor units; quantities integers in the stock unit; BigInt inside calculations | F §4.1 D47; 01a S44; C4 |
| Void waste is a fact on `ItemVoided.disposition`; no second event for it (C10) | 04 V3, V4 |
| Config reaches the hub only as the cloud snapshot; optional `engine_settings` keys carry hub defaults (03b A-1 pattern) | 01a S28, R29 |
| Permissions not in `ALLOWED_ONLY_PERMISSIONS` may be granted `requires_approval`; default grants reach running tenants only by a migration selecting `roles.default_key` | 01b §3.3; README row 199; `0013_void_defaults_backfill.sql` |

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Reason | Overrides / changes |
|---|---|---|---|
| S1 | **New stream type `inventory`** (C3 (a), foundation bump approved). Stream ids: `grn:<grn_id>` (`GoodsReceived`), `xfer:<transfer_id>` (`StockTransferReceived`), `waste:<waste_id>` (`WasteRecorded`), ⚠️ v0.2 B-1 `sheet:<business_day_id>` (`CountRecorded`, `DailySheetClosed`); `InventoryEntryReversed` is appended to the **reversed event's** stream. Every 08d payload carries `business_day_id` (the day it belongs to) **and** `business_date` (its label, C1). The engine never replays the stream | Engine replay untouched; one document per stream | F §4.1 (F-1), §3.1 D50 note (F-2) |
| S2 | **Tracked items.** ⚠️ v0.2 m-8, B-2: the **A-item set** = snapshot inventory items with `is_a_item = true` **and** `kind ∈ ingredient, packet` (an `is_a_item` flag on a `prepared` item is ignored by 08d; the owner form hides it, C-1). The **tracked cooked items** = `prepared` stock items whose published batch recipe, exploded with 08b `explodeStockItem(inputs, id, 1)`, uses ≥ 1 A-item (PAYE-COOKED uses paye and ghee). Raw lines (receive, transfer, raw waste, raw count) name an A-item; cooked lines (cooked waste, cooked count) name a tracked cooked item. Else `404 STOCK_ITEM_NOT_FOUND` (unknown / archived) or `422 INVENTORY_ITEM_NOT_TRACKED { stock_item_id, reason: 'not_a_item' \| 'not_cooked_item' }`. ⚠️ v0.2 m-16: a snapshot without the `inventory` key (cloud or hub older than 08b) → every 08d command and query `409 INVENTORY_NOT_CONFIGURED`; the screen shows "Inventory not set up" | R39 (b): 5 A-items; one pot is counted once, not under each of its inputs | — |
| S3 | **`GoodsReceived` is the only receiving event** (08-g0 D4); `mode: 'quick_receive'` is the only value of the v1 enum. A later mode is a **v2** with an identity upcaster (D46, ⚠️ v0.2 m-11). Lines enter a quantity in any unit `resolveUnit` accepts for the item (08a I5, snapshot units); the event stores the entered `{ unit_name, qty_num, qty_den }`, the conversion used (`conv_num`, `conv_den`) and `qty_stock_units` = `divRound(qty_num × conv_num, qty_den × conv_den)` (S6 helper), ≥ 1 for receipts / transfers / waste, ≥ 0 for counts | One event as 08-g0 D4; integers (C4); the entered value stays auditable | 08-g0 §3.12 → integer form |
| S4 | **Receipt checks per item flag** (cloud fields, C-1): `must_weigh_on_receipt` ⇒ the entered unit resolves through `g` (the item's own `g`, a built-in on `g`, an item unit with `base_unit = 'g'`), never `piece` (`422 CONFIG_REFERENCE_INVALID { field: 'lines.N.unit_name', reason: 'weigh_required' }`); ⚠️ v0.2 m-7: allowed only on items with `stock_unit = 'g'` (cloud CHECK + `400`). `track_piece_count` ⇒ `piece_count` 1 … 100 000 required on the line (`400`), refused on other items (`400`). Paye: kg **and** pieces (08-g0 §4). ⚠️ v0.2 m-17: `piece_count` is shown in the day view and the sheet detail ("18.5 kg · 92 pcs", drill 1's input) | 08-g0 §4 | 08a §4.3 (fields moved here) |
| S5 | **Price on a receipt is optional.** `price_total_minor` (1 … 10¹⁰) present ⇒ the line updates the MWA (S6) and **is** the price observation; no separate `PriceObserved{grn}` event | 08-g0 D3's grn trend is the line itself (C10 reasoning) | 08-g0 D3 → the line is the observation |
| S6 | **MWA ("today's cost")**, projection `inventory_item_cost (stock_item_id) → avg_micro, on_hand_stock_units`, in **micro-minor per stock unit** (1 µ-minor = 10⁻⁶ paisa; integer). ⚠️ v0.2 m-5: one helper `divRound(n, d)` (BigInt, half away from zero, also for negatives) and **one division per update**: on a priced line `new_avg = divRound(on_hand × avg + price_total_minor × 10⁶, on_hand + qty)`; if `on_hand ≤ 0` or no `avg` yet: `new_avg = divRound(price_total_minor × 10⁶, qty)` (08-g0 §3.5). An unpriced line changes `on_hand` only. **Cost of an A-item at a moment** (`todaysCost`) = its `avg_micro` with source `'mwa'`, else its menu cost (08a `effectiveMenuPrice` on snapshot inputs, via 08b `stockItemUnitCost`) converted to µ-minor with source `'menu'`, else **none** (`null`, never 0) | Integers that do not grow; one rounding | 08-g0 MWA formula, integer form |
| S7 | **`on_hand` for the MWA: (a) count-anchored** (owner OQ-1 default, kept; the review agrees). ⚠️ v0.2 M-9: the **anchor** is the item's latest **non-null raw closing count ordered by business day** (`day_seq` = the `seq` of that day's `BusinessDayOpened`), and `on_hand = anchor + Σ moves of later business days + Σ moves of the anchor day recorded after the anchor count (by `seq`)`; no anchor → Σ of all moves. A null count never anchors. A count entered late (next morning, a recount) re-anchors correctly because the order is by day, not by `seq`. The MWA is a projection and can be rebuilt under another rule; values frozen into later events (`unit_cost_micro`) keep the rule of their time | Pilot counts A-items daily; no 08c dependency | — |
| S8 | **Transfer-in, branch side only** (`StockTransferReceived`): `from_label` ≤ 40, optional `lot_code` ≤ 20, lines as S3 (⚠️ v0.2 m-2: `{ unit_name, qty_num, qty_den }` with frozen conversion, like `GoodsReceived`). ⚠️ v0.2 m-3 / O-7: for a **`packet`** line the unit cost = its menu cost at receipt (08-g0 §3.5.4), frozen as `unit_cost_micro` with `unit_cost_source: 'menu'` (null / null when it has no price), and it counts as a priced receipt for the MWA; an **`ingredient`** line (raw stock from another branch) moves `on_hand` only, cost null. No dispatch side, no discrepancy (POST) | 06 sync not built; one pilot branch | 08-g0 `StockTransferDispatched` → POST |
| S9 | **`CountRecorded`** (one shape, 08-g0 D5), ⚠️ v0.2 B-2: one count per `(business_day_id, stock_item_id)` where the item is an **A-item (raw count)** or a **tracked cooked item (cooked count)**; `kind: 'closing'` only (⚠️ O-5: no `opening_seed`). `qty_stock_units` integer **0 … 10⁹** (⚠️ M-2: an explicit 0 is entered and is zero) or **null = not counted**; `is_estimated`; entered unit kept as S3. A later `CountRecorded` for the same `(business_day_id, stock_item_id)` **supersedes** the earlier (recount, by `seq`). "Not counted" = no count or a null count; the screen's field starts blank, never 0, and offers a "0" chip (M-1). ⚠️ m-21: the row shows "counted by X at 22:10" | 08-g0 D5, §4 | 08-g0 `session_id`, `spot`, `opening_seed` → POST / removed |
| S10 | **Cooked items, counted and wasted as themselves** (⚠️ v0.2 B-2, M-10, O-6). A cooked count / waste names the tracked cooked item (PAYE-COOKED) in **its** stock unit (pieces), once, never under an A-item. **Paye still in the degh at the night count is counted as PAYE-COOKED** (pieces in the degh), and a leftover that will be thrown away is a **cooked waste entry before the close** (the Close screen prompts for it, O-6). At close, a cooked quantity's raw equivalent per A-item = `explodeStockItem(inputs, cooked_id, qty).usage[a_item]` (08b; EP → AP by yield, nested prepared items, depth ≤ 3, never throws); a `partial` explosion adds the reason `cooked_partial` (S13). 08d does **not** write or read the engine's `StockSet`; no engine level is shown beside the count (a count that copies the system figure catches nothing, M-10) | One pot, one number; physical counts stay blind | — |
| S11 | **Waste.** `WasteRecorded` is **user waste only** (C10): `stage ∈ raw, cooked` (raw → an A-item, cooked → a tracked cooked item, S2), `reason ∈ spoiled, expired, dropped, burnt, quality_reject, other` (`other` needs a note), quantity as S3. ⚠️ v0.2 m-4: **one valuation rule** — raw waste freezes `unit_cost_micro` + `unit_cost_source` at record (S6); cooked waste freezes none (`null` / `null`) and is valued at close through its raw equivalents (S10). Void waste is read by 08c from `ItemVoided` (R-c). The engine's pre-cooked level is not touched (kitchen keeps `SetPrecookedStock`, OQ-3) | C10; one source per fact | 08-g0 `void_after_prep, source: system` → 04 via 08c |
| S12 | **Theoretical usage comes from 08c** (⚠️ v0.2 M-8, cross-slice contract): `CloseDailySheet` calls `theoreticalUsage(db, { business_day_id })` **once per business day of the sheet's period** (S13) and sums. Per stock item it returns `{ sold, comp, void_waste, staff_meal }` (fractions of stock units, full explosion, no `stopAt`) and `coverage_bp`. Rules (R-c): sold + comp lines; voided lines excluded except `wastage` (→ `void_waste`) and `staff_meal` (→ `staff_meal`, ⚠️ O-4: usage, shown as its own column); `moved` excluded; `other` as `wastage`; attribution = the `business_day_id` the line was placed in (carried-over orders stay with their placing day); coverage by revenue computed by 08c. `theoretical_usage = sold + comp + void_waste + staff_meal`. ⚠️ O-7: there is **no close before 08c** | D12; one owner of the explosion | 08b v0.1's `stopAt` model → removed (08b v0.2) |
| S13 | **The sheet** (`DailySheetClosed`, immutable), per item (A-items only; cooked counts enter as raw equivalents). ⚠️ v0.2 B-3 / O-2: the **period** = the business days after the item's previous closed sheet up to this day (normally one; more when a closed day was skipped, then `chain_broken`). `opening` = the previous sheet's `closing` (⚠️ O-5: none → **baseline**: `opening`, `actual_usage`, variance null, reason `baseline`); `received`, `transfer_in`, `user_waste` (raw + raw equivalent of cooked waste); `closing` = raw count + raw equivalent of the cooked counts; `actual_usage = opening + received + transfer_in − user_waste − closing`; `sold`, `comp`, `void_waste`, `staff_meal`, `theoretical_usage` (S12, rounded with `divRound` once, at close); `variance_qty = actual_usage − theoretical_usage`; `variance_bp = divRound(variance_qty × 10 000, theoretical_usage)` (null when theoretical = 0); `unit_cost_micro` + `unit_cost_source` = `todaysCost` at close; `variance_value_minor = divRound(variance_qty × unit_cost_micro, 10⁶)` (null without a cost). **Flags** (⚠️ v0.2 M-5), two fields: `variance_flag` from the thresholds alone — `over` ⇔ `variance_qty > 0`, `under` ⇔ `< 0`, and only when `|variance_bp| > pct_bp` (**theoretical 0 with `variance_qty ≠ 0` passes the pct test**) **and** `|variance_value_minor| > value_minor`, else `ok`; `null` when actual or the value is null; `unreliable_reasons[]` ⊆ `baseline`, `chain_broken`, `coverage` (`coverage_bp < 9 500`), `estimated` (any count of the item or its cooked items `is_estimated`), `no_cost`, `cooked_partial`, `moves_after_count` (S14). `flag` (list view) = `unreliable` if any reason, else `variance_flag`; the detail always shows `variance_flag` beside the reasons | 08-g0 §3.12 formulas, integer form; a real `over` is never hidden | — |
| S14 | **Day and close rules** (⚠️ v0.2 B-3, O-2, m-1). Moves (receive, transfer, waste) need the **open** day and belong to it (`409 BUSINESS_DAY_NOT_OPEN`, C8). Counts are allowed for the open day or for a **closed day without a sheet** (default: the open day, else the latest such day). `CloseDailySheet` is allowed only for a **closed** business day (after `BusinessDayClosed`) that has **no sheet**, provided **no later day has a sheet** (closes stay in order; a newer open day does not block — the manager may close last night's sheet next morning); else `409 INVENTORY_DAY_NOT_ALLOWED { business_day_id, reason: 'not_closed' \| 'has_sheet' \| 'later_sheet' \| 'unknown' }`. Close needs a **non-null** count for **every A-item and every tracked cooked item** (M-1; `409 INVENTORY_COUNT_MISSING { stock_item_ids }`). A move of an item recorded on that day **after** its count (by `seq`) is listed on the Close screen as "after count — recount?"; the close needs a recount or `confirm_moves_after_count: true`, and the confirmed items carry reason `moves_after_count`. A correction is a new `DailySheetClosed` with `supersedes` = the day's current sheet (note required; allowed while no later day has a sheet). Day close is **not** blocked by an unclosed sheet (fallback) | Counting happens at night; sheets must be closable next morning; no sale or move falls between two sheets | — |
| S15 | **Permissions** (01b row B-1): `receive-stock` (`ReceiveGoods`, `ReceiveTransfer`), `record-waste` (`RecordWaste`), `count-inventory` (`RecordCount`), `close-daily-sheet` (`CloseDailySheet`, corrections, the report). `ReverseInventoryEntry` needs the permission of the reversed command (S19). Group `menu_stock`, scope `branch`. ⚠️ v0.2 M-6: all four are **`ALLOWED_ONLY_PERMISSIONS`** (no approval flow exists for them; the roles API answers `422` on `requires_approval`, as 04 B-2). Defaults Owner + Manager all four, reaching the running pilot tenant through an idempotent cloud **backfill migration by `default_key`** (0013 pattern, `directory_version` bump). The owner makes a "Store keeper" role with the first three (OQ-4). `close-daily-sheet` is **listed-only** (05a row D-1, a sign-off like `approve-void`) | Fill and close by different people, as on paper | 01b §3.3, §4.2 (B-1); 05a §3.3 (D-1) |
| S16 | **Settings** (R18, 01a row A-1, 01b row B-2): `inventory_variance_pct_bp` (default 300, 1 … 10 000) and `inventory_variance_value_minor` (default 50 000, 0 … 100 000 000) in `branch_engine_settings`, delivered as optional snapshot `engine_settings` keys with hub defaults. ⚠️ v0.2 m-18: the engine never reads them; `engine_settings` is the branch-settings delivery channel (03b A-1 pattern), not engine input. The close freezes the values used | 08-g0 §3.12 "configurable" | 01a §5 / snapshot `engine_settings`; 01b §6.10 wire |
| S17 | **Item fields from 08a** (01c row C-1): `must_weigh_on_receipt` (`stock_unit = 'g'` only), `track_piece_count` (`stock_unit ∈ g, ml`, not `packet`). Delivered by **08d's own row on 08b's snapshot `inventory.items[]`** (two optional fields; schema + builder; builder statement count unchanged, R-b). `default_purchase_unit`, `shelf_life_days` → §12.4 | Their first reader is this screen | 08a §4.3 row "08d" |
| S18 | **Labels** (08a I12, C7). The screen shows per A-item: **"Today's cost"** (`todaysCost`; when its source is `'menu'` the value is labelled **"Menu cost"** instead — never "today's cost"), today's received / transfer-in / waste, the count. Every frozen cost carries `unit_cost_source` (⚠️ v0.2 M-12); the report labels each value by it ("Rs 620 at today's cost" / "at menu cost") | 08a I12 | 08a I12 help line (row P-1) |
| S19 | **Corrections of moves** (⚠️ v0.2 M-4, O-3). `ReverseInventoryEntry { event_id, note }` → `InventoryEntryReversed { reversed_event_id, reversed_event_type, business_day_id, business_date, note }` on the reversed event's stream. Allowed for `GoodsReceived`, `StockTransferReceived`, `WasteRecorded` only (counts are recounted, sheets superseded); only while the event's business day has **no sheet** (`409 INVENTORY_DAY_NOT_ALLOWED { reason: 'has_sheet' }`); once (`409 INVENTORY_ENTRY_REVERSED`); permission of the original command; note 1 … 200 (`400`). Projections treat the reversed event's lines as absent; `inventory_item_cost` of each affected item is **recomputed** by folding that item's remaining moves and counts in order (statements in §6.5). Costs already frozen into later `WasteRecorded` rows of that day are **not** rewritten (risk, §7). **Large-quantity guard:** a receive / transfer / waste line whose `qty_stock_units` exceeds 5 × the item's largest receipt line so far needs `confirm_large: true`, else `422 INVENTORY_LARGE_QUANTITY { stock_item_id, qty_stock_units, max_seen }`; an item with no receipt yet has no guard | A typo of kg for g must not ruin the MWA for weeks | — |

### 3.2 Command processing order (each command, a subset of F §6.3)

payload Zod (`400`) → session kind + permission (pipeline, `403`) → inventory key present (`409 INVENTORY_NOT_CONFIGURED`) → item checks S2 (`404` / `422`) → day rule S14 (`409`) → command rules (`422` / `409`) → append (one writer transaction; projections applied live) → result. Idempotent retransmit by `command_id` returns the stored result (00 §3.5).

### 3.3 Validation rules

| Rule | Error |
|---|---|
| Snapshot has no `inventory` key | `409 INVENTORY_NOT_CONFIGURED` |
| Line `stock_item_id` not in the snapshot's inventory items, or archived | `404 STOCK_ITEM_NOT_FOUND { stock_item_id }` |
| Raw line not an A-item; cooked line not a tracked cooked item (S2) | `422 INVENTORY_ITEM_NOT_TRACKED { stock_item_id, reason }` |
| Unit does not resolve for the item (08a I5) | `422 CONFIG_REFERENCE_INVALID { field: 'lines.N.unit_name', reason: 'not_convertible' }` |
| Weigh-required item entered in a non-weight unit (S4) | `422 CONFIG_REFERENCE_INVALID { field: 'lines.N.unit_name', reason: 'weigh_required' }` |
| `piece_count` missing on a `track_piece_count` item, or sent on another item | `400` |
| ⚠️ v0.2 m-6: `qty_num` 1 … 10⁹ (counts: 0 … 10⁹), `qty_den` 1 … 10⁶; `qty_stock_units` ≥ 1 (counts ≥ 0) and ≤ 10⁹ | `400` |
| `price_total_minor` 1 … 10¹⁰ | `400` |
| Lines per command: 1 … 20; one line per item per command | `400` |
| Line above 5 × the item's largest receipt line without `confirm_large` (S19) | `422 INVENTORY_LARGE_QUANTITY { stock_item_id, qty_stock_units, max_seen }` |
| Waste `reason = 'other'` without `note`; any `note` ≤ 200; reversal / correction note 1 … 200 | `400` |
| Move with no open day | `409 BUSINESS_DAY_NOT_OPEN` |
| Count / close / reversal day not allowed (S14, S19) | `409 INVENTORY_DAY_NOT_ALLOWED { business_day_id, reason }` |
| Close without a non-null count for every A-item and tracked cooked item | `409 INVENTORY_COUNT_MISSING { stock_item_ids }` |
| Close with moves after a count and neither recount nor `confirm_moves_after_count` | `409 INVENTORY_MOVES_AFTER_COUNT { stock_item_ids }` |
| Correction whose `supersedes` is not the day's current sheet | `409 INVENTORY_SHEET_CLOSED { business_day_id, current_event_id }` |
| Reversal of an unknown event or a type not in S19 | `404 INVENTORY_ENTRY_NOT_FOUND { event_id }` |
| Second reversal of one event | `409 INVENTORY_ENTRY_REVERSED { event_id }` |

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 08a | `resolveUnit`, `normaliseUnitName`, `toStockUnits`, `effectiveMenuPrice`, `pricePerStockUnit` (`@pos/domain/inventory`) |
| 08b (row R-b) | snapshot `inventory` key (items with 08d's two fields, current item units, price candidates, yields, published recipes); `buildCostInputs`, `stockItemUnitCost`, **`explodeStockItem(inputs, preparedStockItemId, qty: bigint) → { usage: Map<stock_item_id, { num: bigint, den: bigint }>, status: 'costed' \| 'partial' }`** (depth ≤ 3, never throws) |
| 08c (row R-c) | `theoreticalUsage(db, { business_day_id }) → { items: Map<stock_item_id, { sold, comp, void_waste, staff_meal }> /* each { num: bigint, den: bigint } in stock units */, coverage_bp: number }` |
| 01a | open / closed business days (`BusinessDayOpened` event ids and `seq`, `BusinessDayClosed`), `branchConfig()`, `engine_settings` defaults pattern |
| 04 | `ItemVoided.disposition` — through 08c only |

### 4.2 Exposes

| Export | Shape | Used by |
|---|---|---|
| Events (`@pos/events`, stream `inventory`) | `GoodsReceived` v1, `StockTransferReceived` v1, `WasteRecorded` v1, `CountRecorded` v1, `InventoryEntryReversed` v1, `DailySheetClosed` v1 (§5.3), one fixture each (`packages/events/fixtures/<EventType>.v1.json`, D46) | 06, 07, POST receiving |
| `todaysCost(db, inputs, stockItemId) → { unit_cost_micro: bigint, source: 'mwa' \| 'menu' } \| null` | `apps/hub/src/inventory/cost.ts` | 08c (its own choice), 08d screen |
| `TodaysCostWire { unit_cost_micro: string, source: 'mwa' \| 'menu', display_per: { unit: 'kg' \| 'l' \| 'piece', minor: string } }` (⚠️ v0.2 m-9) | `packages/events/src/inventory/wire.ts` | client |
| Projections `inventory_moves`, `inventory_counts`, `inventory_item_cost`, `daily_sheets` | §5.2 | 08d queries, 07 |

### 4.3 Requirements on other parts of module 08

| Row | To | Requirement |
|---|---|---|
| R-b | 08b | (1) Exposes `explodeStockItem` as in §4.1 (replaces v0.1's `cookedFormsOf`, which does not exist). (2) `buildCostInputs` accepts the snapshot key with 08d's two optional item fields present (unknown fields ignored). (3) 08b's §4.3 row "08d" reads: "08c owns `theoreticalUsage` (full explosion, no `stopAt`); 08d counts cooked items as themselves and converts them with `explodeStockItem`; 08d adds two optional fields to `inventory.items[]`". **08d cannot be approved until 08b's approved text carries this row** |
| R-c | 08c | Exposes `theoreticalUsage(db, { business_day_id })` exactly as §4.1, with the S12 rules (sold, comp; `wastage` → `void_waste`; `staff_meal` → `staff_meal`; `moved` excluded; `other` as `wastage`; attribution by placing `business_day_id`; carried-over orders stay with their placing day; `coverage_bp` by revenue in the same call) and a fixed statement count per call |

### 4.4 Story → part

08d-1: S2–S11, S14 (moves and counts), S15–S19, screen, day view. 08d-2 (after 08c): S12, S13, S14 (close), report.

### 4.5 Changes to other specs (R26)

Applied when 08d is approved (folded into module 08's next version), each target bumped to **its next free version at that time, after 08b's bumps**, with a changelog and "⚠️ Changed by 08d (row X)" markers.

| Row | Target, section | Change | Why |
|---|---|---|---|
| F-1 | **Foundation** §4.1 envelope + `packages/events/src/envelope.ts` | `stream_type` gains **`'inventory'`** (stream ids `grn:`, `xfer:`, `waste:`, `sheet:<business_day_id>`); Zod enum only, no DB CHECK; not replayed by the engine (F-8 lists unchanged) | S1, C3 |
| F-2 | Foundation §3.1 D50 | Note: "one stock projection" is the engine's **pre-cooked** stock; purchased inventory (`ingredient`, `packet`) is a separate hub projection on the `inventory` stream the engine never reads | S1, 08a I9 |
| F-3 | Foundation §6.2 status map | 08d §9 codes appended (no bump on its own, R34) | §9 |
| B-1 | **01b** §3.3, §4.2 catalogue, `packages/domain/src/permissions.ts` | `receive-stock`, `record-waste`, `count-inventory`, `close-daily-sheet`: group `menu_stock`, scope `branch`; all four in `ALLOWED_ONLY_PERMISSIONS` (roles API `422` on `requires_approval`); defaults Owner + Manager in the seed **and** the cloud backfill migration (§5.1) by `default_key` (active roles, `directory_version` bump); client labels `perm.*` | S15 |
| B-2 | 01b §6.10, `packages/events/src/admin/staff.ts` `BranchEngineSettings` / `BRANCH_ENGINE_SETTING_KEYS` | The owner settings wire takes `inventory_variance_pct_bp`, `inventory_variance_value_minor` (as 01b v1.10.2 did for `max_delay_default_ms`) | S16 |
| C-1 | **01c** §3.1 V3, §3.3, §5.4, §6.7, §6.8, §8 | `stock_items` gains `must_weigh_on_receipt` (CHECK `NOT must_weigh_on_receipt OR stock_unit = 'g'`) and `track_piece_count` (CHECK `NOT track_piece_count OR (stock_unit IN ('g','ml') AND kind <> 'packet')`); both in the version input and the owner form; they are `inventory.items[]` fields, so they bump by 08b's rule; the owner form hides `is_a_item` on `prepared` items (S2) | S4, S17 |
| A-1 | **01a** `branch_engine_settings`, snapshot `engine_settings` | Two optional keys with hub defaults 300 / 50 000; cloud columns; owner settings page | S16 |
| D-1 | **05a** §3.3, §3.6, `packages/domain/src/{screens,permissions}.ts` | `SCREEN_KEYS` gains **`inventory`**, offered on every staff device type (⚠️ v0.2 m-10: `screensOffered` offers every key; **no existing profile gets it automatically — the manager adds it in Devices**), shown to a person holding any S15 permission (05a §3.6's "hidden when the person holds none" line); `close-daily-sheet` added to `LISTED_ONLY_PERMISSIONS` | S15, S18 |
| P-1 | **08a** (module 08 file) I12, §12.3 OQ-2 | I12's owner-app help line becomes "Today's cost from deliveries is on the hub's Inventory screen"; OQ-2: the owner keeps entering market rates in the owner app (the hub screen records receipts, not market rates) | S18 |
| R-b | 08b (module 08 file) | §4.3 above | S2, S10, S17 |
| R-1 | README | Module map row 08d (status, depends on 08b, 08c for 08d-2) | — |
| — | 03a / `@pos/engine` | **No change**: the `inventory` stream is in no reducer list; pre-cooked stock untouched | S1, S10 |
| — | 04, 05 | **No change** (04 read through 08c) | S12 |
| — | `CloseBusinessDay` | **No new guard** (S14) | fallback |

---

## §5. Data model and migrations

### 5.1 Cloud — `00NN_inventory_receiving.sql` (NN = next free after 08b's migration; 0020 if 08b takes 0019)

```sql
-- 08d §5.1 (01c row C-1, 01a row A-1, 01b row B-1). Expand only.
ALTER TABLE stock_items
  ADD COLUMN must_weigh_on_receipt BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN track_piece_count BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT stock_items_weigh_unit CHECK (NOT must_weigh_on_receipt OR stock_unit = 'g'),
  ADD CONSTRAINT stock_items_piece_count CHECK (NOT track_piece_count OR (stock_unit IN ('g','ml') AND kind <> 'packet'));
ALTER TABLE branch_engine_settings                               -- audit entity 'branch_settings' (0012 pattern)
  ADD COLUMN inventory_variance_pct_bp INT NOT NULL DEFAULT 300 CHECK (inventory_variance_pct_bp BETWEEN 1 AND 10000),
  ADD COLUMN inventory_variance_value_minor BIGINT NOT NULL DEFAULT 50000
    CHECK (inventory_variance_value_minor BETWEEN 0 AND 100000000);
-- 01b row B-1 backfill (0013 / 0015 pattern): the four keys to every active role with default_key owner / manager,
-- ON CONFLICT DO NOTHING, then directory_version + 1 for each affected tenant. Idempotent (re-run = no change).
```
The build task re-reads the live `branch_engine_settings` and the `0013_void_defaults_backfill.sql` statement shape first (01b D-5) and copies its grant-table names.

### 5.2 Hub — `00NN_inventory.sql` (next free hub number at build; projections rebuilt from the `inventory` stream)

```sql
CREATE TABLE inventory_moves (                    -- one row per receipt / transfer / waste line
  event_id TEXT NOT NULL, line_no INTEGER NOT NULL,
  business_day_id TEXT NOT NULL, day_seq INTEGER NOT NULL,    -- day_seq = seq of BusinessDayOpened (S7 order)
  stock_item_id TEXT NOT NULL,                    -- the A-item (raw) or the cooked item (waste_cooked)
  move TEXT NOT NULL CHECK (move IN ('received','transfer_in','waste_raw','waste_cooked')),
  qty_stock_units INTEGER NOT NULL, piece_count INTEGER,
  price_total_minor INTEGER, unit_cost_micro TEXT, unit_cost_source TEXT,
  reversed INTEGER NOT NULL DEFAULT 0,            -- S19
  seq INTEGER NOT NULL,
  PRIMARY KEY (event_id, line_no));
CREATE INDEX inventory_moves_day ON inventory_moves (business_day_id, stock_item_id);  -- day view, close
CREATE INDEX inventory_moves_item_day ON inventory_moves (stock_item_id, day_seq, seq); -- S7 on_hand, S19 recompute, guard max

CREATE TABLE inventory_counts (                   -- latest count per (day, item) (S9)
  business_day_id TEXT NOT NULL, day_seq INTEGER NOT NULL, stock_item_id TEXT NOT NULL,
  qty_stock_units INTEGER,                        -- NULL = not counted
  is_estimated INTEGER NOT NULL, counted_by TEXT NOT NULL, counted_at INTEGER NOT NULL,
  event_id TEXT NOT NULL, seq INTEGER NOT NULL,
  PRIMARY KEY (business_day_id, stock_item_id));
CREATE INDEX inventory_counts_item_day ON inventory_counts (stock_item_id, day_seq);      -- S7 anchor

CREATE TABLE inventory_item_cost (                -- S6 / S7
  stock_item_id TEXT PRIMARY KEY,
  avg_micro TEXT,                                 -- decimal string; NULL = no priced receipt yet
  on_hand_stock_units INTEGER NOT NULL,
  max_receipt_line INTEGER,                       -- S19 guard
  updated_seq INTEGER NOT NULL);

CREATE TABLE daily_sheets (                       -- current DailySheetClosed per business day (S14)
  business_day_id TEXT PRIMARY KEY, day_seq INTEGER NOT NULL, business_date TEXT NOT NULL,
  event_id TEXT NOT NULL, supersedes TEXT, flag_summary TEXT NOT NULL,
  closed_by TEXT NOT NULL, closed_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL, seq INTEGER NOT NULL);
CREATE INDEX daily_sheets_day ON daily_sheets (day_seq);                                   -- order rule, list, previous sheet
```
⚠️ v0.2 m-15: the four tables are **one projection group**: they register together, apply each event in the order moves → counts → item cost → sheets, and rebuild together (one `reset`, one catch-up); `inventory_item_cost` reads the two tables before it in the same apply. ⚠️ m-6: µ-minor values and every `_minor` derived from them are stored as decimal strings (`TEXT`); quantities stay `INTEGER` (≤ 10⁹).

### 5.3 Events (`packages/events/src/events/inventory/*.v1.ts`, stream `inventory`)

Every payload carries `business_day_id` and `business_date` (S1). µ-minor values and `variance_value_minor` are decimal strings (`z.string().regex(/^-?\d+$/)`); quantities are `number` (≤ 10⁹).

```jsonc
GoodsReceived v1 {            // stream_id "grn:<grn_id>"
  grn_id, business_day_id, business_date, mode: "quick_receive",
  supplier_name_freetext?,    // ≤ 60
  lines: [{ line_no, stock_item_id, unit_name, qty_num, qty_den, conv_num, conv_den,
            qty_stock_units, piece_count?, price_total_minor?, confirm_large? }]
}
StockTransferReceived v1 {    // "xfer:<transfer_id>"
  transfer_id, business_day_id, business_date, from_label, lot_code?,
  lines: [{ line_no, stock_item_id, unit_name, qty_num, qty_den, conv_num, conv_den,
            qty_stock_units, unit_cost_micro: string | null, unit_cost_source: "menu" | null, confirm_large? }]
}
WasteRecorded v1 {            // "waste:<waste_id>"
  waste_id, business_day_id, business_date, stage: "raw" | "cooked",
  stock_item_id,              // A-item (raw) or tracked cooked item (cooked)
  unit_name, qty_num, qty_den, conv_num, conv_den, qty_stock_units,
  reason: "spoiled" | "expired" | "dropped" | "burnt" | "quality_reject" | "other", note?,
  unit_cost_micro: string | null, unit_cost_source: "mwa" | "menu" | null,   // raw only (S11)
  confirm_large?
}
CountRecorded v1 {            // "sheet:<business_day_id>"
  business_day_id, business_date, stock_item_id, kind: "closing",
  entered: { unit_name, qty_num, qty_den, conv_num, conv_den } | null,
  qty_stock_units: number | null,             // null = not counted
  is_estimated
}
InventoryEntryReversed v1 {   // the reversed event's stream
  reversed_event_id, reversed_event_type: "GoodsReceived" | "StockTransferReceived" | "WasteRecorded",
  business_day_id, business_date, note
}
DailySheetClosed v1 {         // "sheet:<business_day_id>"
  business_day_id, business_date, period_business_day_ids: [..],   // > 1 when a closed day was skipped
  supersedes?, note?, confirm_moves_after_count?,
  settings: { pct_bp, value_minor }, coverage_bp,
  items: [{ stock_item_id, opening, received, transfer_in, user_waste, closing, closing_raw, closing_cooked_equiv,
            actual_usage, sold, comp, void_waste, staff_meal, theoretical_usage,
            variance_qty, variance_bp, variance_value_minor, unit_cost_micro, unit_cost_source,
            variance_flag: "ok" | "over" | "under" | null, flag: "ok" | "over" | "under" | "unreliable",
            unreliable_reasons: ("baseline" | "chain_broken" | "coverage" | "estimated" | "no_cost"
                                 | "cooked_partial" | "moves_after_count")[] }]
}
```
`opening`, `actual_usage`, `variance_*`, `unit_cost_*` may be null (S13). `actor_id` = the session's staff.

---

## §6. Commands and queries

All commands: `sessionKind: 'both'` (device screen and hub admin), `command_id` idempotency, queueable **no** (counts depend on the moment; ⚠️ v0.2 m-13: the screen keeps typed, unsent values in `localStorage` per (branch, `business_day_id`, staff) as 01a S55 does for stock counts, so an idle sign-out loses nothing). ⚠️ m-14: **no WS message**; the screen refetches `inventory-day` after each own command and on focus. Shared failures not repeated: `400 VALIDATION_FAILED`, `401`, `403 PERMISSION_DENIED`, `403 DEVICE_ACCESS_DENIED` (05a), `409 INVENTORY_NOT_CONFIGURED`, `404 STOCK_ITEM_NOT_FOUND`, `422 INVENTORY_ITEM_NOT_TRACKED`. Statement counts are the writer transaction's statements after the pipeline's own (idempotency row, result row).

### Batch 1 — receiving and waste (08d-1)

#### 6.1 `ReceiveGoods` (permission `receive-stock`)

| | |
|---|---|
| Payload | `{ supplier_name_freetext?, lines: [{ stock_item_id, unit_name, qty_num, qty_den?: 1, piece_count?, price_total_minor?, confirm_large? }] (1–20, one per item) }` |
| Script | §3.2: S2 per line → open day (id + `day_seq`, 1 read) → S3 resolve → S4 → **1 read** of the lines' `inventory_item_cost` rows (`IN`, ⚠️ m-20) → **1 read** of the lines' on-hand inputs (anchor counts + later moves, grouped by item, `IN`) → S19 guard → append `GoodsReceived` → per line: 1 move insert, 1 cost upsert |
| Result | `{ grn_id, lines: [{ stock_item_id, qty_stock_units, todays_cost: TodaysCostWire \| null }] }` |
| Statements | 3 + 1 event + 2 × lines |

| Edge | Answer |
|---|---|
| Paye 18.5 kg (185/10), 92 pieces, Rs 33,300 | `qty_stock_units` 18 500; first receipt `avg` = divRound(3 330 000 × 10⁶, 18 500) = 180 000 000 µ-minor/g (Rs 1.80/g) |
| Paye in `piece` | `422 weigh_required` |
| Paye without `piece_count` | `400` |
| Beef 12 kg, no price | `on_hand` + 12 000; `avg` unchanged |
| Beef 18 500 kg (largest receipt so far 20 kg) without `confirm_large` | `422 INVENTORY_LARGE_QUANTITY { max_seen: 20000 }` |
| Item not an A-item | `422 INVENTORY_ITEM_NOT_TRACKED { reason: 'not_a_item' }` |
| No open day | `409 BUSINESS_DAY_NOT_OPEN` |
| Retransmit | stored result, no second event |

#### 6.2 `ReceiveTransfer` (`receive-stock`)

Payload `{ from_label, lot_code?, lines: [{ stock_item_id, unit_name, qty_num, qty_den?, confirm_large? }] }`. Script as 6.1 with S8 (packet: menu cost from snapshot inputs, frozen with source `'menu'`; ingredient: cost null). Result `{ transfer_id, lines }`. Statements as 6.1. Edges: TP-1 2 400 g, menu cost Rs 3.00/g → `unit_cost_micro` "300000000", source `menu`, MWA updated; a packet with no price → stored, `on_hand` only; raw beef from another branch → `on_hand` only, cost null.

#### 6.3 `RecordWaste` (`record-waste`)

Payload `{ stage, stock_item_id, unit_name, qty_num, qty_den?, reason, note?, confirm_large? }`. Script: S2 (raw → A-item, cooked → tracked cooked item) → open day → S3 → raw: cost read + on-hand read (2) → S19 guard → append → 1 move insert; raw: 1 cost upsert. Result `{ waste_id, qty_stock_units, unit_cost: TodaysCostWire \| null }`. Statements: raw 1 + 2 + 1 event + 2; cooked 1 + 1 event + 1 (+1 guard read). Edges: `reason: 'other'` without note `400`; PAYE-COOKED 6 pieces cooked → stored in pieces, no cost frozen, valued at close; ghee raw 500 g → `on_hand` − 500, cost frozen with its source.

### Batch 2 — counts, reversal, day view (08d-1)

#### 6.4 `RecordCount` (`count-inventory`)

| | |
|---|---|
| Payload | `{ business_day_id?, entries: [{ stock_item_id, qty: { unit_name, qty_num, qty_den? } \| null, is_estimated?: false }] (1–20) }` |
| Script | S2 (A-item or tracked cooked item) → day rule S14 (default open day, else latest closed day without sheet; `409 INVENTORY_DAY_NOT_ALLOWED`; 2 reads: day row, sheet existence) → S3 (`qty_num` 0 allowed) → one `CountRecorded` per entry → `inventory_counts` upsert per entry → for raw A-item counts: on-hand re-anchor (1 grouped read + 1 upsert per item, S7) |
| Result | `{ business_day_id, counts: [{ stock_item_id, qty_stock_units, superseded: boolean }] }` |
| Statements | 2 + per entry (1 event + 1 upsert) + raw: 1 grouped read + 1 upsert per raw item |

Edges: `qty: null` → stored "not counted"; `qty_num: 0` → zero (M-2); recount → `superseded: true`; count for last night's closed day after this morning's open → accepted (no sheet yet); count for a day with a sheet → `409 INVENTORY_DAY_NOT_ALLOWED { reason: 'has_sheet' }`; PAYE-COOKED 14 pieces (paye in the degh, O-6) → cooked count.

#### 6.5 `ReverseInventoryEntry` (permission of the reversed command)

| | |
|---|---|
| Payload | `{ event_id, note }` |
| Script | read the event (1; `404 INVENTORY_ENTRY_NOT_FOUND` for an unknown id or another type) → permission of its command (`403`) → its day has no sheet (1 read; `409 INVENTORY_DAY_NOT_ALLOWED { reason: 'has_sheet' }`) → not reversed yet (from `inventory_moves.reversed`, same read as the event's lines; `409 INVENTORY_ENTRY_REVERSED`) → append `InventoryEntryReversed` → mark its lines `reversed` (1) → per affected item: recompute `inventory_item_cost` (1 read of the item's moves + counts ordered by `day_seq, seq`, 1 upsert) |
| Result | `{ reversed_event_id, items: [{ stock_item_id, todays_cost }] }` |
| Statements | 4 + 1 event + 2 × affected items (≤ 20). The recompute read grows with the item's history (~1 000 rows per item per year in the pilot); accepted, stated |

Edges: reverse an 18 500 kg receipt → `on_hand` and `avg` as if it never happened; reverse a waste of yesterday after yesterday's sheet closed → `409 has_sheet`; reverse twice → `409 INVENTORY_ENTRY_REVERSED`; a cashier without `receive-stock` reversing a receipt → `403`.

#### 6.6 Query `GET /queries/inventory-day?business_day_id=` (any S15 permission)

Response: `{ business_day_id, business_date, day_state: 'open' | 'closed', has_sheet, a_items: [{ stock_item_id, name, code, stock_unit, units: [...resolvable], must_weigh_on_receipt, track_piece_count, todays_cost: TodaysCostWire | null, received, received_pieces, transfer_in, user_waste_raw, count: { qty_stock_units, is_estimated, counted_by_name, counted_at } | null, moves_after_count: boolean }], cooked_items: [{ stock_item_id, name, stock_unit, user_waste, count: {…} | null, moves_after_count }], sheet: { event_id, flag_summary } | null }`. Default day = open day, else latest closed day without sheet. **Statements: 5 fixed** (day row, moves of the day, counts of the day, item costs for the A-items, sheet row); items, units, menu cost and tracked cooked items from the in-memory snapshot (`branchConfig()`, 08b `CostInputs`).

### Batch 3 — close and report (08d-2, after 08c)

#### 6.7 `CloseDailySheet` (`close-daily-sheet`)

| | |
|---|---|
| Payload | `{ business_day_id, supersedes?: event_id, note?, confirm_moves_after_count?: boolean }` (note required with `supersedes`) |
| Script | day rule S14 (day row, current sheet, later-sheet check: 2 reads; `409 INVENTORY_DAY_NOT_ALLOWED` / `INVENTORY_SHEET_CLOSED`) → period: previous sheet (1 read) and the business days after it up to this one (1 read) → counts of the day (1 read): every A-item and tracked cooked item non-null (`409 INVENTORY_COUNT_MISSING`) → moves of the period (1 read) → moves after count without recount or confirm (`409 INVENTORY_MOVES_AFTER_COUNT`) → `theoreticalUsage` per period day (08c, its fixed count × days) → cooked raw equivalents (`explodeStockItem`, memory) → item costs (1 read) → S13 per item, settings frozen → append `DailySheetClosed` → `daily_sheets` upsert (1) |
| Result | `{ event_id, business_day_id, items: [...], flag_summary }` |
| Statements | 7 reads + 08c's per day + 1 event + 1 upsert |

| Edge | Answer |
|---|---|
| Day still open | `409 INVENTORY_DAY_NOT_ALLOWED { reason: 'not_closed' }` |
| Yesterday's day, closed, no sheet, today already open | closes (O-2) |
| D−2 when D−1 already has a sheet | `409 { reason: 'later_sheet' }` |
| PAYE-COOKED count missing | `409 INVENTORY_COUNT_MISSING { stock_item_ids: ['paye-cooked'] }` |
| A ghee receipt recorded after ghee's count | `409 INVENTORY_MOVES_AFTER_COUNT` → recount, or confirm → reason `moves_after_count` |
| First sheet of an item | baseline: closing stored, opening / usage / variance null, reason `baseline` |
| Skipped closed day | `period_business_day_ids` = both days; `chain_broken` |
| Beef +4 % and +Rs 620 | `variance_flag` `over`, flag `over` |
| Beef −4 % but −Rs 300 | `ok` |
| Beef 5 kg gone, no beef sold (theoretical 0) | pct passes; value test decides → `over` |
| No cost for an item | value null, `variance_flag` null, reason `no_cost` |
| Coverage 9 200 bp and beef `over` | flag `unreliable`; detail shows `variance_flag: over` beside `coverage` |
| Second close without `supersedes` | `409 INVENTORY_DAY_NOT_ALLOWED { reason: 'has_sheet' }` |
| Correction | new event with `supersedes` + note; report shows the latest, history lists both |
| Retransmit | stored result |

#### 6.8 Query `GET /admin/queries/daily-sheets?from=&to=` (`close-daily-sheet` or `view-reports`)

`from` / `to` are business dates (labels); the list holds one row per business day: `{ business_day_id, business_date, flag_summary, closed_by, closed_at }` (max 62 days). **1 statement** (⚠️ O-7: `superseded_count` cut; the detail shows history).

#### 6.9 Query `GET /admin/queries/daily-sheets/:business_day_id`

The current sheet's payload + its history (`supersedes` chain) + the period's moves (with `piece_count`, reversed lines marked) + counts with "counted by". **3 statements.** Unknown id or no sheet → `404 INVENTORY_SHEET_NOT_FOUND { business_day_id }` (⚠️ M-11).

---

## §7. Cross-cutting

| Item | Decision |
|---|---|
| Logging | Command logs carry ids and counts only; notes and supplier names never logged |
| Offline | Commands need the hub (LAN); not queueable; local draft (§6); "hub unreachable" state |
| Performance | ≤ 20 lines per command; the day view reads one day; the close reads one period; the reversal recompute reads one item's history (§6.5) |
| Folders (⚠️ v0.2 m-12) | `apps/hub/src/inventory/{commands,queries,projections}/` + `cost.ts`, following the `billing/` and `voids/` precedent (F §6.9 module folders) |
| Privacy | `supplier_name_freetext` is business data; no person data beyond `actor_id` and `counted_by` |
| Risks | (1) Staff skip a count → the close refuses (S14); drill 3 shows which step. (2) A wrong batch yield skews the cooked equivalent → `cooked_partial` only when a yield is missing; drill 1 numbers first. (3) S7 (a) bias between counts — accepted. (4) A count taken before the last orders of the day: those sales are in the day's theoretical but the food was still on the shelf at the count → a false `under`; staff count after service (drill 3 checks it; §12.3 OQ-9). (5) A reversed receipt does not rewrite costs already frozen into that day's raw waste (S19) |

---

## §8. Client contract

1. **Device screen "Inventory"** (05a screen key `inventory`; `apps/client/src/features/inventory/`): one page; A-items as rows, tracked cooked items below; actions **Receive** (unit pick-list from `units`, the last unit used preselected from the device; kg + pieces for paye; optional total price; supplier free text), **Transfer in**, **Waste** (raw / cooked, reason chips, note), **Count** (blank by default with a "0" chip, never 0; "estimated" toggle; "counted by X at hh:mm"), **Undo entry** (reversal, note required). A "large quantity — sure?" confirm on `422 INVENTORY_LARGE_QUANTITY`. Labels per S18. No engine level shown. Only the actions the person's permissions allow are shown.
2. **Close** (same screen, `close-daily-sheet` holders; days that are closed and have no sheet): lists missing counts (raw and cooked), "after count — recount?" rows, a prompt for a discarded cooked leftover as cooked waste (O-6); on close, the per-item table with `variance_flag`, reasons and the separate `staff_meal` column; correction asks for a note.
3. **Hub admin report** (`apps/client/src/features/admin/inventory/`): list by business day (label + flag summary), sheet detail (items, period, settings used, history, moves with pieces and reversals). Every value labelled by `unit_cost_source`.
4. **Owner app** (01c C-1, 01a A-1): stock item form gains "Weigh on receipt" (g items only) and "Count pieces on receipt"; `is_a_item` hidden on `prepared` items; branch settings gain the two thresholds.
5. Errors use existing texts plus the §9 codes; Urdu strings go to the urdu-todo list.

---

## §9. Error catalogue additions

| Code | Status | `details` | Condition |
|---|---|---|---|
| `INVENTORY_NOT_CONFIGURED` | 409 | `{}` | S2 (no `inventory` key) |
| `INVENTORY_ITEM_NOT_TRACKED` | 422 | `{ stock_item_id, reason: 'not_a_item' \| 'not_cooked_item' }` | S2 |
| `INVENTORY_LARGE_QUANTITY` | 422 | `{ stock_item_id, qty_stock_units, max_seen }` | S19 |
| `INVENTORY_DAY_NOT_ALLOWED` | 409 | `{ business_day_id, reason: 'not_closed' \| 'has_sheet' \| 'later_sheet' \| 'unknown' }` | S14, S19 |
| `INVENTORY_COUNT_MISSING` | 409 | `{ stock_item_ids: string[] }` | S14 |
| `INVENTORY_MOVES_AFTER_COUNT` | 409 | `{ stock_item_ids: string[] }` | S14 |
| `INVENTORY_SHEET_CLOSED` | 409 | `{ business_day_id, current_event_id }` | S14 correction |
| `INVENTORY_SHEET_NOT_FOUND` | 404 | `{ business_day_id }` | §6.9 |
| `INVENTORY_ENTRY_NOT_FOUND` | 404 | `{ event_id }` | S19 |
| `INVENTORY_ENTRY_REVERSED` | 409 | `{ event_id }` | S19 |

New reason `weigh_required` on `422 CONFIG_REFERENCE_INVALID` (S4). `BUSINESS_DAY_NOT_OPEN` keeps its meaning (moves only, m-1). Appended to F §6.2 and `@pos/domain/src/errors.ts` (row F-3).

---

## §10. Tests

### 10.1 Pure (`packages/domain/src/inventory/{mwa,sheet}.test.ts`)

| # | Case |
|---|---|
| 1 | MWA: first priced receipt; weighted second; `on_hand ≤ 0` → landed; unpriced → avg unchanged; **one** `divRound` per update; max values (qty 10⁹, price 10¹⁰) stay exact as strings |
| 2 | S7 on_hand: anchor = latest non-null raw count **by business day**; later days' moves added; anchor day's moves after the count added; null count never anchors; late count (next morning) and recount re-anchor; no anchor → all moves |
| 3 | S3 conversion: 18.5 kg (185/10) → 18 500 g; 1.5 darjan → 18 pieces; 1/3 kg → 333 g; count 0 → 0 |
| 4 | `divRound`: 2.5 → 3, −2.5 → −3, −2.4 → −2 |
| 5 | Sheet formulas S13: actual, theoretical (sold + comp + void_waste + staff_meal), variance qty / bp / value; baseline; cooked equivalents through a stub `explodeStockItem` (paye + ghee from one PAYE-COOKED count) |
| 6 | Flags: sign (`over` > 0, `under` < 0); both thresholds; theoretical 0 with a loss → pct passes; no cost → `no_cost`, `variance_flag` null; every reason; `flag` = `unreliable` when any reason, detail keeps `variance_flag` |
| 7 | Period: previous sheet → one day; skipped closed day → two days, `chain_broken` |

### 10.2 Hub commands (`apps/hub/test/inventory/*.int.test.ts`) — every §3.3 error a command can return, and a retransmit, per command (F §6.7)

| # | Case |
|---|---|
| 8 | `ReceiveGoods` happy path: event (with `business_day_id` + label), moves, cost; statements 3 + 1 + 2 × lines |
| 9 | `ReceiveGoods` each error: not configured, not found, not tracked, not convertible, weigh required, piece count missing / not allowed, large quantity (and accepted with `confirm_large`), no open day, duplicate item line; retransmit → one event |
| 10 | `ReceiveTransfer`: packet menu cost frozen with source `menu`; packet without price → null; ingredient → on_hand only; each error; retransmit |
| 11 | `RecordWaste`: raw freezes cost + source; cooked freezes none; cooked on an A-item → `not_cooked_item`; raw on PAYE-COOKED → `not_a_item`; `other` needs note; each error; retransmit |
| 12 | `RecordCount`: null vs 0; recount supersedes; raw A-item and cooked item counts; closing raw count re-anchors S7; each error (`has_sheet`, `unknown` day); retransmit |
| 13 | `RecordCount` for last night's closed day after this morning's open → accepted; two days with **one `business_date`** (open → close → open) → two separate count sets (B-1) |
| 14 | `ReverseInventoryEntry`: receipt reversed → on_hand and avg recomputed exactly as without it; waste reversed; count / sheet ids → `404`; day with sheet → `409 has_sheet`; second time → `409 INVENTORY_ENTRY_REVERSED`; wrong permission → `403`; retransmit; statement count |
| 15 | Day view: 5 statements; default day rules; `todays_cost` source labels; `moves_after_count`; counted by; `piece_count`; no engine read |
| 16 | `CloseDailySheet` (08c stub): day open → `not_closed`; yesterday after today's open → closes; D−2 after D−1 sheet → `later_sheet`; missing raw or cooked count → `409`; moves after count → `409`, confirm → reason; baseline; chain broken; settings frozen; `staff_meal` column; each error; retransmit |
| 17 | Correction with `supersedes` + note → latest shown, history 2; wrong `supersedes` → `409 INVENTORY_SHEET_CLOSED` |
| 18 | Two business days with one `business_date` → two sheets, two stream ids (B-1) |
| 19 | Permissions: each command refused without its key; reversal uses the original's key; store keeper (first three) cannot close; `close-daily-sheet` refused on an `everyone` device; roles API refuses `requires_approval` for the four (01b) |
| 20 | Report queries: list 1 statement, detail 3 statements, 62-day cap, `404 INVENTORY_SHEET_NOT_FOUND` |
| 21 | Engine untouched: a full day of 08d commands leaves `EngineState` byte-identical; replay filter excludes `inventory` |
| 22 | Projection group rebuild: one `reset` + catch-up reproduces the four tables exactly, including reversed lines and late counts |

### 10.3 Races (`apps/hub/test/inventory/races.int.test.ts`)

| # | Case |
|---|---|
| 23 | Two devices count the same item and day: both events land (single writer); the later `seq` wins; "counted by" shows the later |
| 24 | `CloseDailySheet` vs a late `RecordCount` on the same day: the writer serialises; the later count after the sheet → `409 has_sheet` |
| 25 | `ReceiveGoods` vs `CloseBusinessDay`: the receipt commits on the open day or is refused `409 BUSINESS_DAY_NOT_OPEN`; never on a closed day |
| 26 | `ReverseInventoryEntry` vs `CloseDailySheet` for that day: one wins; never a reversal of a sheeted day's entry |

### 10.4 Cloud (`apps/cloud/test/inventory/receiving-fields.int.test.ts`)

| # | Case |
|---|---|
| 27 | Stock item PATCH: weigh on a non-`g` item refused (CHECK + `400`); piece count on a packet / piece item refused; both in the version input |
| 28 | Branch settings via the 01b §6.10 wire: ranges; snapshot `engine_settings` carries them; hub default when absent |
| 29 | Migration on an 08b-era database: defaults false / 300 / 50 000, no behaviour change; backfill grants the four keys to Owner + Manager by `default_key`, bumps `directory_version`, and a re-run changes nothing |
| 30 | Snapshot `inventory.items[]` carries the two fields; builder statement count unchanged (R-b) |

### 10.5 Events and client

| # | Case |
|---|---|
| 31 | One fixture per event v1 parses; `GoodsReceived.mode` enum is v1-only (m-11) |
| 32 | Inventory screen: actions per permission; paye receive asks kg + pieces; count blank by default with a "0" chip; local draft survives a sign-out; S18 labels; no engine level |
| 33 | Close: missing raw and cooked counts listed; moves-after-count rows; cooked-leftover prompt; flags and reasons; `staff_meal` column; correction needs a note |
| 34 | Admin report list / detail; values labelled by `unit_cost_source` |

### 10.6 Acceptance

| Source | Check | Test |
|---|---|---|
| 08-g0 §3.12 daily sheet | receive, transfer, waste, count, close | 8–17 |
| D3 MWA from receipts only | S6, S7 | 1, 2, 8, 10 |
| §4 not counted ≠ 0; all A-items (and cooked items) to close | S9, S14 | 12, 16 |
| §4 weight + count on paye | S4 | 9 |
| §4 voided prepared food → waste; D12 staff meals = usage | via 08c | 16 (stub) |
| R39 (b) thresholds 3 % AND Rs 500 | S13, S16 | 6, 16, 28 |
| C3 engine never sees inventory | S1, S10 | 21 |
| R39 (c) fallback | close never blocks day close; next-morning close | 13, 16, 25 |
| O-3 typo correction | S19 | 14 |

---

## §11. Build order

**08d-1** (after 08a and 08b are merged):
1. Foundation F-1 (`envelope.ts` stream enum) + §9 codes in `errors.ts` — typecheck + schema test.
2. Event schemas `packages/events/src/events/inventory/*.v1.ts` + six fixtures + `TodaysCostWire` — test 31.
3. Pure `packages/domain/src/inventory/{mwa,sheet}.ts` (`divRound`, S6, S7, S13) — tests 1–7.
4. 01b B-1 permissions (allowed-only, defaults) + B-2 settings wire; 05a D-1 screen key + listed-only — tests 19 (part), screens test.
5. Cloud migration (fields, settings, backfill) + 01c C-1 + 01a A-1 + snapshot fields on 08b's `inventory.items[]` — tests 27–30.
6. Hub migration + projection group (`apps/hub/src/inventory/projections/`) — test 22.
7. `apps/hub/src/inventory/{items,cost}.ts` (S2 sets, `todaysCost`, S19 guard) — tests 8 (part), 15 (part).
8. Commands `receive-goods`, `receive-transfer`, `record-waste` — tests 8–11, 25.
9. `record-count` — tests 12, 13, 23.
10. `reverse-inventory-entry` — tests 14, 26.
11. Query `inventory-day` — tests 15, 21.
12. Client Inventory screen (receive / transfer / waste / count / undo) — test 32.

**08d-2** (after 08c is merged):
13. `close-daily-sheet` with 08c's `theoreticalUsage` — tests 16, 17, 18, 24.
14. Report queries — test 20.
15. Client close + admin report — tests 33, 34.

15 tasks, 6 commands + 3 queries (9, plus 3 cloud changes): inside the size budget.

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done
- Tests 1–34 green; no engine test edited; test 21 proves the engine untouched.
- One week on the pilot hub with the paper sheet in parallel (drill 3): system and paper agree on every A-item's actual usage.
- Every §4.5 row applied with markers; 08b's text carries R-b; 08c's carries R-c.

### 12.2 Endpoint checklist

| § | Command / query | Codes |
|---|---|---|
| 6.1 | ReceiveGoods | 200, 400, 403, 404, 409, 422 |
| 6.2 | ReceiveTransfer | 200, 400, 403, 404, 409, 422 |
| 6.3 | RecordWaste | 200, 400, 403, 404, 409, 422 |
| 6.4 | RecordCount | 200, 400, 403, 404, 409, 422 |
| 6.5 | ReverseInventoryEntry | 200, 400, 403, 404, 409 |
| 6.6 | inventory-day | 200, 400, 403, 409 |
| 6.7 | CloseDailySheet | 200, 400, 403, 409 |
| 6.8 | daily-sheets list | 200, 400, 403, 409 |
| 6.9 | daily-sheets detail | 200, 403, 404, 409 |

### 12.3 Open questions

| # | Question | Answer / default |
|---|---|---|
| OQ-1 | MWA `on_hand` rule (S7) | **(a) count-anchored**, by business day (default kept; review agrees) |
| OQ-2 | Cooked paye counted on the sheet, engine keeps its own level (S10) | Separate; **no engine hint** (owner O-7) |
| OQ-3 | Cooked waste on the sheet does not reduce the engine's pre-cooked level | OK (kitchen uses `SetPrecookedStock`) |
| OQ-4 | Who closes: manager only (`close-daily-sheet` listed-only); store keeper fills | As stated |
| OQ-5 | Final A-item list (paye, beef, ghee, anday, packets) — chanay, atta? | The five |
| OQ-6 | Drill 3 (one paper week) before or in parallel with the first system week? | In parallel |
| OQ-7 | Migration numbers: cloud next free after 08b, hub next free at build | Renumber at build |
| OQ-8 | **Answered (owner 2026-11-23 22:13):** O-1 business day; O-2 close a closed day, next morning allowed; O-3 reversal + large confirm; O-4 `staff_meal` = usage, own column; O-5 no `opening_seed`; O-6 degh paye = cooked item, discarded leftover = cooked waste before close | Applied |
| OQ-9 | New: should the close also warn when orders were placed **after** an item's count (risk 4, §7)? Needs one more read of order events | No (staff count after service; drill 3 checks) |

### 12.4 Deferred until needed

| Item | Why not now |
|---|---|
| `default_purchase_unit` | O-7: the device remembers the last unit |
| `opening_seed` | O-5: first sheet is a baseline |
| Engine level beside the cooked count | O-7 / M-10: defeats a blind count |
| Cost of raw stock transferred from another branch | O-7: one pilot branch |
| `shelf_life_days` | No pilot reader |
| Receipt photos | No hub media store |
| `supplier_delivery`, `cash_purchase`, `night_drop`, blind receiving, landed cost, discrepancies | 08-g0 §5 POST |
| `StockTransferDispatched`, transfer discrepancy, CK lots, `transfer_out` | Needs 06 sync; no pilot case |
| Count sessions, spot counts, store / kitchen split | POST |
| Non-A-item tracking | R39 (b) |
| Cloud copy of the sheet / owner-app report | Needs 06 sync; 07 |
| Variance × shift roster | POST |
