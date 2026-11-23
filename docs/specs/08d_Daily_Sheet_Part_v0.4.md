# 08d — Inventory & Costing: A-item daily sheet — Module Spec part v0.4 (DRAFT)

**v0.4 — DRAFT (2026-11-24), fixes the targeted check** (`docs/reviews/08d_v0.3_targeted_check.md`: 0 BLOCKER, 4 MAJOR, 7 MINOR, 2 NIT; resolution table at the end of that file). Next: quick check of the changed lines only. Markers "⚠️ v0.4 (id)". One line per item:
- **N-1** every move carries an **ordering position `order_seq`** (its own `seq`; a reversal's replacement takes the **reversed event's** `order_seq`). The fold, the recompute reads, "moves after count" and `count_seq_by_item` all order by `(order_seq, seq)`; a replacement is always applied by recompute (`foldItemCost`), never as a tail step; affected items = reversed ∪ replacement items. Test 14 / 2b hold by construction (S7, S14, S19, §5.2, §6.5).
- **N-2** the day's required set is written into the day's **first `CountRecorded`** (`required_set`), so a rebuild reproduces it; `inventory_day_sets` is derived from that field only (S2, §5.3, §6.4, tests 22, 33).
- **N-3** 08b v0.4's text applied: **"Snapshot has no `inventory` key, or `buildCostInputs` returns no items"** → `409 INVENTORY_NOT_CONFIGURED`; never a whole-key `InventorySnapshotSchema.safeParse` (that schema is for tests). An item dropped by 08b's element parse is `404 STOCK_ITEM_NOT_FOUND` for that line only; the day view shows `dropped > 0` (S2, §3.2, §3.3, §4.1, R-b (2), §9, test 9).
- **N-4** contract text checked: 08b v0.4 §4.3 carries R-b (3) verbatim and the 08c row carries R-c's signature verbatim (`count_seq_by_item`, `sold_after_count`, per-item `status`, `revenue_minor`); 08d's §4.1 row unchanged, R-b gate met once 08b v0.4 is approved.
- **n-1** default: **a role that holds `receive-stock`, `record-waste` or `count-inventory` also holds `reverse-inventory-entry`** ("Undo own entries"): the roles editor ticks it with the first of the three (01b row B-1), the seed and the `0020` backfill grant it to every active role holding any of the three. Own entry only; others' entries still need `close-daily-sheet`. OQ-11 asks the owner to confirm. **n-2** one processing order (§6.5's) written into §3.2. **n-3** an item of the frozen set that is no longer tracked at close (unticked / archived) is **excluded** with reason `no_longer_tracked`, not required (S2, S14). **n-4** S14 / S20 wording aligned; a correction's required set = the superseded sheet's; `cost_from: 'now'` removed. **n-5** backfill writes `role_permissions` (`ON CONFLICT (tenant_id, role_id, permission)`). **n-6** fold step input `ItemStep`; §6.5 statements add 2 × replacement items for the guard. **n-7** header cites 08b v0.4; F-1 path `packages/events/src/envelope.ts`. **nit-1** risk (4) states `sold_after_count` is by placing `seq`. **nit-2** `ignored_ticked` reason `no_recipe`.


**v0.3 — DRAFT (2026-11-23), fixes hostile run 2** (`docs/reviews/08d_v0.2_hostile_run2.md`: 0 BLOCKER, 10 MAJOR, 19 MINOR; run-1 rows M-4, M-7 ✗; resolution table at the end of that file) **and applies the owner rulings of 2026-11-23 23:15–23:45 PKT**. Next: targeted check of the changed rows. Markers "⚠️ v0.3 (id)". One line per item:
- **Owner rulings O-8 – O-11 (23:15–23:45):** **O-8** the person who recorded an entry may reverse their own entry, a manager may reverse any entry (S19, S15); **O-9** cooked items counted = the `prepared` items the owner ticks (`is_a_item` on a prepared item), each counted in **its own stock unit** — PAYE-COOKED in pieces, biryani / pulao in plates (`piece`); pilot set PAYE-COOKED, biryani / pulao by tick (S2, S10); **O-10** a sheet correction keeps the original frozen unit costs and can change counts (S14, S20); **O-11** sales after the count → reason `sales_after_count` with the quantity, no counting block (S13).
- **M-1** reversal: static permission `reverse-inventory-entry` checked by the pipeline (§3.2 order: `403` before any read) + a handler rule "own entry, or the actor holds `close-daily-sheet`" through `ctx.directory` (no `checked-in-handler`, no 00 row). **M-2** reversal carries optional `replacement` lines recorded on the **original** day. **M-3** while a day holds the latest sheet, a manager may recount and reverse for it; the sheet is marked out of date; the correction re-closes with the **original** costs (O-10). **M-4** one pure step function `stepItemCost` (`packages/domain/src/inventory/mwa.ts`), folded in `seq` order by live apply, reversal recompute and rebuild. **M-5** cooked set explicit (O-9) and frozen per day at its first count. **M-6** cloud `0020` ends with the release bump. **M-7** menu cost through 08a `pricePerStockUnit(effectiveMenuPrice(…))`; `stockItemUnitCost` gone. **M-8** `theoreticalUsage` returns per-item `status`, `revenue_minor`, `sold_after_count`; period coverage revenue-weighted; voids without disposition excluded; late lines → risk. **M-9** bases: Foundation **v1.16** (main, 05b) → **v1.17** by F-1 / F-2; 00 v1.12.4; 01d v1.3.6; 05a v1.0.5; 08a v1.0.1; "F-8" → F §5.8. **M-10** `sales_after_count` (O-11).
- **m-1** `day_seq` read from the event store by PK. **m-2** a key that fails `InventorySnapshotSchema` = not configured. **m-3** packets have no MWA: source `menu` always. **m-4** `on_hand` from the fold state; the extra read gone. **m-5** guard against 5 × the largest receipt **or count**; cooked waste guarded by cooked counts. **m-6** counts refused `later_sheet`. **m-7** paye's MWA ≈ last delivery: accepted, stated. **m-8** one `divRound` per item per sum. **m-9** close inputs = the applied snapshot. **m-10** period capped at 7 business days. **m-11** `flag_summary` shape. **m-12** index on `business_date`. **m-13** detail permission. **m-14** screen hint on cooked waste vs voids. **m-15** "Start the day first". **m-16** two races added. **m-17** backfill statement written. **m-18** checklist codes. **m-19** `lot_code` cut, ingredient transfer refused, moves device-only.

**v0.2 — DRAFT (2026-11-23)**, run 1 + owner rulings O-1 – O-7. **v0.1 — DRAFT (2026-11-23)**. Both kept as history.

This is the **08d part of module 08**, in its own file only so 08b and 08d can be drafted in parallel; **at approval it is folded into `08_Inventory_Costing_Spec` as its next version (owner OQ-1: one file for 08a–08d)**. Inputs: `docs/stories/08-g0.md` §3.3, §3.5, §3.12, §4, §7 drill 3; README **R39** (b) minimal scope, (c) paper fallback, (d) rulings C1–C12; 08a **v1.0.1** §4.3 row "08d"; 08b **v0.4** (`spec/08b-recipes-v0.3`, `c759a91b`, read only; ⚠️ v0.4 n-7) — the cross-slice contract below is fixed. Decision rows are **S1 …**.

---

## §1. Header

| Field | Value |
|---|---|
| Module | 08d A-item daily sheet: on the branch hub, **one screen** to record quick receipts, transfers-in, user waste and the closing count of the **A-items** and of the **cooked items the owner ticks**; a moving weighted average cost per raw A-item ("**today's cost**", 08a I12); `DailySheetClosed` per business day with variance flags; a hub admin report |
| Version | **v0.3 — DRAFT** (2026-11-23, run 2 + owner rulings O-8 – O-11). v0.2, v0.1 — DRAFT |
| Depends on | ⚠️ v0.3 M-9: **Foundation v1.16** (→ v1.17 by F-1, F-2); **00 v1.12.4** (command pipeline, sessions, queries, `ctx.directory`); 01a v2.8 (business day S33, S55, day close); 01b v1.10.3 (permissions, §6.10 settings wire); 01c v1.2 (stock items, `prepared` stock); 01d v1.3.6; **05a v1.0.5** (screens, listed-only; the 05b staff tablet loads the same `/staff/` page, so the `inventory` key works there too); 04 v1.0.8 (`ItemVoided.disposition`, read through 08c); **08a v1.0.1** (`kind`, `is_a_item`, item units, `resolveUnit`, `effectiveMenuPrice`, `pricePerStockUnit`); **08b** (snapshot `inventory` key, `CostInputs`, `explodeStockItem`; row R-b); **08c** (`theoreticalUsage`; row R-c; 08d-2 only) |
| Inherits | **Shared Standards from Foundation v1.16 §6**, unchanged. Carried conventions C1–C9 |
| Changes other specs | Foundation (F-1, F-2, F-3), 01b (B-1, B-2), 01c (C-1), 01a (A-1), 05a (D-1), 08a (P-1), 08b requirement (R-b), 08c requirement (R-c), README (R-1). Versions: **the next free number of each target at approval, after 08b's bumps** (merge order 08b → 08d); Foundation **v1.17**. Full list §4.5 |
| Tier | T2 Production |
| Milestone | A (pilot), by R39 (a). **Fallback (R39 c): if 08d is not live by 2027-02-28, the manager runs the paper sheet (5 A-items, signed daily) until it ships; the pilot does not slip for 08d** |
| Build split | **08d-1** (receive, transfer-in, waste, counts, reversal, today's cost, the screen, the day view) needs 08a + 08b. **08d-2** (`CloseDailySheet`, variance, report) ships **after 08c** (no close path without theoretical usage) |

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
| Owner O-8 – O-11 | Own-entry reversal, ticked cooked items in their own unit, corrections keep costs, sales after count flagged | S10, S13, S14, S19, S20 |

### In scope
- Hub: six commands (`ReceiveGoods`, `ReceiveTransfer`, `RecordWaste`, `RecordCount`, `ReverseInventoryEntry`, `CloseDailySheet`), six events on a new **`inventory`** stream type, one projection group (six tables), three queries (screen day view, sheet list, sheet detail).
- Cloud: two `stock_items` columns 08a moved here (`must_weigh_on_receipt`, `track_piece_count`), two branch settings (variance thresholds), the permission backfill, the release bump; delivered to the hub (S15–S17).
- Client: the device screen **Inventory** (05a screen key `inventory`), the hub admin report page, owner-app fields.

### Out of scope
- Everything in 08-g0 §5 POST (suppliers, PO, full GRN modes, blind receiving, landed cost, credit memos, cash advances, requisitions, store / kitchen split, transit, CK dispatch and lots, count sessions, spot counts, 3-stage variance, vendor scores, restatement).
- `default_purchase_unit` (the screen remembers the last unit per item on the device), `opening_seed`, the engine level beside the cooked count, transfer of raw stock from another branch (⚠️ v0.3 m-19: refused), `lot_code` (⚠️ v0.3 m-19), `shelf_life_days`, receipt photos → §12.4.
- Market-rate entry on the hub: the owner keeps entering market rates in the owner app (08a I10, OQ-2); the hub screen records receipts.
- Cloud ingest and cloud reports (06 sync not built): every 08d report is on the hub.
- Theoretical usage itself → **08c** (R-c).

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Hub is the authority for its events; envelope `{ event_id (ULID), tenant_id, branch_id, stream_type, stream_id, event_type, schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq }`; `stream_type` is a Zod enum with **no DB CHECK** | F §4.1 (C1) |
| Commands run through `POST /commands/<name>` (device) or `/admin/commands/<name>`, `defineCommand`, one writer transaction, `command_id` idempotency; **the pipeline resolves a static `CommandDef.permission` before the handler runs**; `'checked-in-handler'` is reserved for `HANDLER_CHECKED_COMMANDS` (`apps/hub/src/commands/registry.ts:36`, 00 §3.7 H-3); a handler reads further grants through `ctx.directory` (the session view, 05a §3.3a rules applied) | F §6.3; 00 v1.12.4 §3.5, §3.7 |
| The engine replays only its own `(stream_type, event_type)` lists (F §5.8); hub projections register with `registerHubProjections` and keep checkpoints | F §5.8; 04 H-2 |
| **The business day is an action, `business_date` only a label.** Two business days may share one `business_date` (01a test 143); a day's identity is its `BusinessDayOpened.event_id`, as `PresenceSet.business_day_id` already uses | 01a S33, S55 |
| Pre-cooked stock (`StockSet` / `StockAdded` / `StockReserved` / `StockConsumed`) is engine-owned and day-scoped; only `prepared` items reach it (08a I9) | F §3.1 D50; 01c V4–V5; 08a I9 |
| Money is integer minor units; quantities integers in the stock unit; BigInt inside calculations | F §4.1 D47; 01a S44; C4 |
| Void waste is a fact on `ItemVoided.disposition`; no second event for it (C10) | 04 V3, V4 |
| Config reaches the hub only as the cloud snapshot; optional `engine_settings` keys carry hub defaults (03b A-1 pattern); a snapshot body change needs a `config_version` bump to reach hubs (`0017` / AD-9 release pattern) | 01a S28, R29, MD-3 |
| Permissions not in `ALLOWED_ONLY_PERMISSIONS` may be granted `requires_approval`; default grants reach running tenants only by a migration selecting `roles.default_key` (`0015_billing_defaults_backfill.sql` pattern) | 01b §3.3; README row 199 |

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Reason | Overrides / changes |
|---|---|---|---|
| S1 | **New stream type `inventory`** (C3 (a), foundation bump approved). Stream ids: `grn:<grn_id>` (`GoodsReceived`), `xfer:<transfer_id>` (`StockTransferReceived`), `waste:<waste_id>` (`WasteRecorded`), `sheet:<business_day_id>` (`CountRecorded`, `DailySheetClosed`); `InventoryEntryReversed` is appended to the **reversed event's** stream. Every 08d payload carries `business_day_id` (the day it belongs to) **and** `business_date` (its label, C1). The engine never replays the stream | Engine replay untouched; one document per stream | F §4.1 (F-1), §3.1 D50 note (F-2) |
| S2 | **Tracked items.** The **A-item set** = snapshot inventory items with `is_a_item = true` **and** `kind ∈ ingredient, packet`. ⚠️ v0.3 M-5 / O-9: the **tracked cooked items** = `prepared` stock items **the owner ticks** (`is_a_item = true` on a `prepared` item; owner form label "Count daily") whose published batch recipe, exploded with 08b `explodeStockItem(inputs, id, 1n)`, uses ≥ 1 A-item; a ticked prepared item whose explosion uses none is ignored and listed in the day view as "uses no A-item". Each is counted in **its own stock unit** (PAYE-COOKED in pieces; biryani / pulao in plates, stock unit `piece`). Raw lines (receive, transfer, raw waste, raw count) name an A-item; cooked lines (cooked waste, cooked count) name a tracked cooked item. Else `404 STOCK_ITEM_NOT_FOUND` (unknown / archived) or `422 INVENTORY_ITEM_NOT_TRACKED { stock_item_id, reason: 'not_a_item' \| 'not_cooked_item' \| 'not_packet' }`. ⚠️ v0.4 N-3 (08b v0.4 text): **"Snapshot has no `inventory` key, or `buildCostInputs` returns no items"** → every 08d command and query `409 INVENTORY_NOT_CONFIGURED`; the screen shows "Inventory not set up". Never a whole-key `InventorySnapshotSchema.safeParse` (that schema is for the builder and tests). An item dropped by 08b's element-wise parse is simply absent: a line naming it answers `404 STOCK_ITEM_NOT_FOUND` for that line, and the day view shows `dropped > 0` as "Some inventory settings could not be read". ⚠️ v0.3 M-5: the **required set of a day** (A-items + tracked cooked items) is **frozen at the day's first `CountRecorded`**; ⚠️ v0.4 N-2: the command computes it when the day has none and writes it **into that event** (`required_set`), and `inventory_day_sets` is derived from that field only, so a rebuild reproduces it; an item ticked later that day is not required that day; `DailySheetClosed` stores the set. ⚠️ v0.4 n-3: an item of the frozen set that is **no longer tracked at close** (unticked, archived, or dropped by the parse) is not required: the sheet lists it under `excluded` with reason `no_longer_tracked` | R39 (b): the owner chooses what is counted; one pot counted once, in its own unit; a recipe publish never adds a nightly count by itself | — |
| S3 | **`GoodsReceived` is the only receiving event** (08-g0 D4); `mode: 'quick_receive'` is the only value of the v1 enum; a later mode is a **v2** with an identity upcaster (D46). Lines enter a quantity in any unit `resolveUnit` accepts for the item (08a I5, snapshot units); the event stores the entered `{ unit_name, qty_num, qty_den }`, the conversion used (`conv_num`, `conv_den`) and `qty_stock_units` = `divRound(qty_num × conv_num, qty_den × conv_den)` (S6 helper), ≥ 1 for receipts / transfers / waste, ≥ 0 for counts | One event as 08-g0 D4; integers (C4); the entered value stays auditable | 08-g0 §3.12 → integer form |
| S4 | **Receipt checks per item flag** (cloud fields, C-1): `must_weigh_on_receipt` ⇒ the entered unit resolves through `g` (the item's own `g`, a built-in on `g`, an item unit with `base_unit = 'g'`), never `piece` (`422 CONFIG_REFERENCE_INVALID { field: 'lines.N.unit_name', reason: 'weigh_required' }`); allowed only on items with `stock_unit = 'g'` (cloud CHECK + `400`). `track_piece_count` ⇒ `piece_count` 1 … 100 000 required on the line (`400`), refused on other items (`400`). Paye: kg **and** pieces (08-g0 §4); `piece_count` is shown in the day view and the sheet detail ("18.5 kg · 92 pcs", drill 1's input) | 08-g0 §4 | 08a §4.3 (fields moved here) |
| S5 | **Price on a receipt is optional.** `price_total_minor` (1 … 10¹⁰) present ⇒ the line updates the MWA (S6) and **is** the price observation; no separate `PriceObserved{grn}` event | 08-g0 D3's grn trend is the line itself (C10 reasoning) | 08-g0 D3 → the line is the observation |
| S6 | **MWA ("today's cost") of an `ingredient` A-item**, in **micro-minor per stock unit** (1 µ-minor = 10⁻⁶ paisa; integer). One helper `divRound(n, d)` (BigInt, half away from zero, also for negatives) and **one division per update**: on a priced line `new_avg = divRound(on_hand × avg + price_total_minor × 10⁶, on_hand + qty)`; if `on_hand ≤ 0` or no `avg` yet: `new_avg = divRound(price_total_minor × 10⁶, qty)` (08-g0 §3.5). An unpriced line changes `on_hand` only. ⚠️ v0.3 m-3: **packets have no MWA** (their only cost is the menu price frozen on a transfer, S8). ⚠️ v0.3 M-7: **cost of an A-item at a moment** (`todaysCost`) = for an `ingredient`, its `avg_micro` with source `'mwa'` when it has one; otherwise (and always for a `packet`) its **menu cost** = 08a `pricePerStockUnit(effectiveMenuPrice(rows, branch_id, now, stock_unit))` on the snapshot's price rows (`CostInputs`, 08b; every row of an applied snapshot is in effect on the hub, 08b m-2), converted `divRound(num × 10⁶, den)`, source `'menu'`; else **none** (`null`, never 0) | Integers that do not grow; one rounding; no forward reference | 08-g0 MWA formula, integer form |
| S7 | **`on_hand` for the MWA: (a) count-anchored** (owner OQ-1 default). The **anchor** is the item's latest **non-null raw closing count ordered by business day** (`day_seq`, S1 / m-1), and `on_hand = anchor + Σ moves of later business days + Σ moves of the anchor day ordered after the anchor count (by `order_seq`, ⚠️ v0.4 N-1)`; no anchor → Σ of all moves. A null count never anchors. ⚠️ v0.3 M-4: the rule is evaluated by **one pure step function** `stepItemCost(state, event) → state` (`packages/domain/src/inventory/mwa.ts`) over the item's events **in `(order_seq, seq)` order** (⚠️ v0.4 N-1: a move's `order_seq` is its own `seq`, a replacement's is the reversed event's `order_seq`; a count's is its own `seq`), with "counts" meaning the counts **seen so far** (§5.2 fold state); live apply = one step; the reversal recompute (S19) and a projection rebuild = `foldItemCost(events) = events.reduce(stepItemCost, init)` over the same events in the same order, reversed events skipped — so all three give identical `avg_micro`, `on_hand` and `max_seen`. ⚠️ v0.3 m-7: paye sits in the degh at night, so its raw count is ≈ 0 and its MWA ≈ the last delivery's price — accepted (paye's "today's cost" reads as "last paye price"). The MWA is a projection and can be rebuilt under another rule; values frozen into later events (`unit_cost_micro`) keep the rule of their time | Pilot counts A-items daily; no 08c dependency; one fold, three callers | — |
| S8 | **Transfer-in, branch side only, packets only** (`StockTransferReceived`): `from_label` ≤ 40 (CK name), lines as S3 (`{ unit_name, qty_num, qty_den }` with frozen conversion). Unit cost = the packet's menu cost at receipt (08-g0 §3.5.4, S6), frozen as `unit_cost_micro` with `unit_cost_source: 'menu'` (null / null when it has no price). ⚠️ v0.3 m-19: an `ingredient` line → `422 INVENTORY_ITEM_NOT_TRACKED { reason: 'not_packet' }`; `lot_code` cut (CK lots are POST). No dispatch side, no discrepancy (POST) | 06 sync not built; one pilot branch | 08-g0 `StockTransferDispatched` → POST |
| S9 | **`CountRecorded`** (one shape, 08-g0 D5): one count per `(business_day_id, stock_item_id)` where the item is an **A-item (raw count)** or a **tracked cooked item (cooked count)**; `kind: 'closing'` only. `qty_stock_units` integer **0 … 10⁹** (an explicit 0 is entered and is zero) or **null = not counted**; `is_estimated`; entered unit kept as S3. A later `CountRecorded` for the same `(business_day_id, stock_item_id)` **supersedes** the earlier (recount, by `seq`). "Not counted" = no count or a null count; the screen's field starts blank, never 0, and offers a "0" chip. The row shows "counted by X at 22:10" | 08-g0 D5, §4 | 08-g0 `session_id`, `spot`, `opening_seed` → POST / removed |
| S10 | **Cooked items, counted and wasted as themselves** (O-6, ⚠️ v0.3 O-9). A cooked count / waste names the tracked cooked item in **its** stock unit (PAYE-COOKED pieces, biryani plates), once, never under an A-item. Paye still in the degh at the night count is counted as PAYE-COOKED; a leftover that will be thrown away is a **cooked waste entry before the close** (the Close screen prompts for it). **Cooked and raw keep their own costs** (a cooked item's cost is its batch recipe's, 08b); the conversion below is **only** for the A-items' quantity variance: at close a cooked quantity's raw equivalent per A-item = `explodeStockItem(inputs, cooked_id, qty).usage[a_item]` (08b; EP → AP by yield, nested prepared items, depth ≤ 3, never throws); a `partial` explosion adds reason `cooked_partial` (S13). ⚠️ v0.3 m-9: the inputs are the snapshot **applied at the close** (a republish overnight moves last night's equivalents — accepted, stated). 08d does **not** write or read the engine's `StockSet`; no engine level is shown | One pot, one number, in the unit staff see; physical counts stay blind | — |
| S11 | **Waste.** `WasteRecorded` is **user waste only** (C10): `stage ∈ raw, cooked` (raw → an A-item, cooked → a tracked cooked item), `reason ∈ spoiled, expired, dropped, burnt, quality_reject, other` (`other` needs a note), quantity as S3. One valuation rule: raw waste freezes `unit_cost_micro` + `unit_cost_source` at record (S6); cooked waste freezes none and is valued at close through its raw equivalents (S10). Void waste is read by 08c from `ItemVoided` (R-c). ⚠️ v0.3 m-14: the cooked-waste form says "Voided plates are counted automatically — do not enter them here" (a voided plate also entered as cooked waste counts twice, §7). The engine's pre-cooked level is not touched (OQ-3) | C10; one source per fact | 08-g0 `void_after_prep, source: system` → 04 via 08c |
| S12 | **Theoretical usage comes from 08c** (cross-slice contract, R-c): `CloseDailySheet` calls `theoreticalUsage(db, { business_day_id, count_seq_by_item })` **once per business day of the period** (S13). ⚠️ v0.3 M-8: per stock item it returns `{ sold, comp, void_waste, staff_meal, sold_after_count, status: 'costed' \| 'partial' }` (fractions of stock units, full explosion, no `stopAt`), plus `coverage_bp` and `revenue_minor` for the day. Rules: sold + comp lines; voided lines excluded except `wastage` (→ `void_waste`) and `staff_meal` (→ `staff_meal`, usage, its own column); `moved` excluded; `other` as `wastage`; **voids without a disposition (voided before preparation) excluded**; attribution = the `business_day_id` the line was placed in (carried-over orders stay with their placing day); coverage by revenue computed by 08c; `status = 'partial'` when any of the item's exploded lines was partial (e.g. an EP line with no yield); `sold_after_count` = the part of `sold + comp` from lines with `seq` greater than `count_seq_by_item[item]` (O-11). `theoretical_usage = sold + comp + void_waste + staff_meal`. Period: per-item fractions summed; **period coverage = `divRound(Σ coverage_bp × revenue_minor, Σ revenue_minor)`** (a day with 0 revenue counts as 10 000 bp, weight 0). There is no close before 08c | D12; one owner of the explosion; a missing yield never hides | 08b v0.1's `stopAt` model → removed |
| S13 | **The sheet** (`DailySheetClosed`, immutable), per A-item (cooked counts enter as raw equivalents). The **period** = the business days after the item's previous closed sheet up to this day (normally one; more when a closed day was skipped, then `chain_broken`; ⚠️ v0.3 m-10: **at most 7** business days — a longer gap closes as `baseline`). `opening` = the previous sheet's `closing` (none → **baseline**: `opening`, `actual_usage`, variance null, reason `baseline`); `received`, `transfer_in`, `user_waste` (raw + raw equivalent of cooked waste); `closing` = raw count + raw equivalent of the cooked counts; `actual_usage = opening + received + transfer_in − user_waste − closing`; `sold`, `comp`, `void_waste`, `staff_meal`, `theoretical_usage` (S12); ⚠️ v0.3 m-8: every fraction sum (theoretical, cooked equivalents of counts and of waste) is rounded **once per item** with `divRound`, at close; `variance_qty = actual_usage − theoretical_usage`; `variance_bp = divRound(variance_qty × 10 000, theoretical_usage)` (null when theoretical = 0); `unit_cost_micro` + `unit_cost_source` = `todaysCost` at the **first** close of the day (S20); `variance_value_minor = divRound(variance_qty × unit_cost_micro, 10⁶)` (null without a cost). **Flags**, two fields: `variance_flag` — `over` ⇔ `variance_qty > 0`, `under` ⇔ `< 0`, only when `|variance_bp| > pct_bp` (theoretical 0 with `variance_qty ≠ 0` passes the pct test) **and** `|variance_value_minor| > value_minor`, else `ok`; `null` when actual or the value is null. `unreliable_reasons[]` ⊆ `baseline`, `chain_broken`, `coverage` (`coverage_bp < 9 500`), `estimated` (any count of the item or its cooked items `is_estimated`), `no_cost`, `cooked_partial`, `usage_partial` (⚠️ v0.3 M-8: 08c `status = 'partial'`), `moves_after_count` (S14), `sales_after_count` (⚠️ v0.3 O-11: `sold_after_count > 0`; the item row carries `sold_after_count_qty` and the Close screen says "≈ 1 200 g paye sold after the count — recount after service next time"). `flag` (list view) = `unreliable` if any reason, else `variance_flag`; the detail always shows `variance_flag` beside the reasons | 08-g0 §3.12 formulas, integer form; a real `over` is never hidden; late sales never pass silently | — |
| S14 | **Day and close rules.** Moves (receive, transfer, waste) need the **open** day and belong to it (`409 BUSINESS_DAY_NOT_OPEN`, C8; ⚠️ v0.3 m-15: the screen says "Start the day first"), except a reversal's `replacement` (S19). Counts are allowed for the open day or a **closed day without a sheet**, provided no later day has a sheet (⚠️ v0.3 m-6: else `later_sheet`); ⚠️ v0.3 M-3: and for the day holding the **latest** sheet (no later day has a sheet) by a holder of `close-daily-sheet` — the day is then **out of date** (S20). `CloseDailySheet` is allowed only for a **closed** business day (after `BusinessDayClosed`) that has **no sheet**, or, with `supersedes`, for any day holding the **latest** sheet (⚠️ v0.4 n-4), provided **no later day has a sheet**; else `409 INVENTORY_DAY_NOT_ALLOWED { business_day_id, reason: 'not_closed' \| 'has_sheet' \| 'later_sheet' \| 'unknown' }`. Close needs a **non-null** count for every item of the day's **required set** that is still tracked (S2, ⚠️ v0.4 n-3; `409 INVENTORY_COUNT_MISSING { stock_item_ids }`). A move of an item on that day ordered **after** its count (by `order_seq`, ⚠️ v0.4 N-1; a replacement keeps its original's place, so a fixed typo is never "after count") is listed on the Close screen as "after count — recount?"; the close needs a recount or `confirm_moves_after_count: true`, and the confirmed items carry reason `moves_after_count`. Day close is **not** blocked by an unclosed sheet (fallback) | Counting happens at night; sheets closable next morning; no sale or move falls between two sheets; a wrong count is fixable | — |
| S15 | **Permissions** (01b row B-1): `receive-stock` (`ReceiveGoods`, `ReceiveTransfer`), `record-waste` (`RecordWaste`), `count-inventory` (`RecordCount`), `close-daily-sheet` (`CloseDailySheet`, corrections, recount / reversal on a sheeted day, the report), ⚠️ v0.3 M-1 / O-8 **`reverse-inventory-entry`** (`ReverseInventoryEntry`; the handler then narrows it, S19). Group `menu_stock`, scope `branch`. All five are **`ALLOWED_ONLY_PERMISSIONS`** (no approval flow exists for them; the roles API answers `422` on `requires_approval`, as 04 B-2). Defaults: Owner + Manager all five, reaching the running pilot tenant through an idempotent cloud **backfill migration by `default_key`** (§5.1, 0015 pattern). ⚠️ v0.4 n-1: **`reverse-inventory-entry` goes with the recording keys**: the roles editor shows it as "Undo own entries" under `receive-stock` / `record-waste` / `count-inventory` and ticks it together with the first of them (the owner may untick it); the `0020` backfill also grants it to every active role that already holds any of the three. No default role other than Owner / Manager records 08d entries, so the owner makes a "Store keeper" role with the four keys (OQ-4, OQ-11). `close-daily-sheet` is **listed-only** (05a row D-1): a manager's undo of someone else's entry, a recount after the sheet and a close need a listed device | Fill and close by different people, as on paper; the recorder fixes his own typo (O-8) | 01b §3.3, §4.2 (B-1); 05a §3.3 (D-1) |
| S16 | **Settings** (R18, 01a row A-1, 01b row B-2): `inventory_variance_pct_bp` (default 300, 1 … 10 000) and `inventory_variance_value_minor` (default 50 000, 0 … 100 000 000) in `branch_engine_settings`, delivered as optional snapshot `engine_settings` keys with hub defaults. The engine never reads them; `engine_settings` is the branch-settings delivery channel (03b A-1 pattern). The close freezes the values used | 08-g0 §3.12 "configurable" | 01a §5 / snapshot `engine_settings`; 01b §6.10 wire |
| S17 | **Item fields from 08a** (01c row C-1): `must_weigh_on_receipt` (`stock_unit = 'g'` only), `track_piece_count` (`stock_unit ∈ g, ml`, not `packet`). Delivered by **08d's own row on 08b's snapshot `inventory.items[]`** (two optional fields; schema + builder; builder statement count unchanged, R-b); `inventory.items[]` holds active items only (08b §4.3). ⚠️ v0.3 M-6: the cloud migration ends with the **release bump** (§5.1) | Their first reader is this screen | 08a §4.3 row "08d" |
| S18 | **Labels** (08a I12, C7). The screen shows per A-item: **"Today's cost"** (`todaysCost`; when its source is `'menu'` — always for packets — the value is labelled **"Menu cost"**, never "today's cost"), today's received / transfer-in / waste, the count. Every frozen cost carries `unit_cost_source`; the report labels each value by it ("Rs 620 at today's cost" / "at menu cost") | 08a I12 | 08a I12 help line (row P-1) |
| S19 | **Reversal of moves** (⚠️ v0.3 M-1, M-2, O-8). `ReverseInventoryEntry { event_id, note, replacement? }` → `InventoryEntryReversed { reversed_event_id, reversed_event_type, business_day_id, business_date, note }` on the reversed event's stream, plus, when `replacement` is sent, **one new event of the reversed event's type** (same shape as its command's lines / fields, S2–S4 checks, guard) carrying the **reversed event's** `business_day_id` / `business_date`. Allowed for `GoodsReceived`, `StockTransferReceived`, `WasteRecorded` only (counts are recounted); once (`409 INVENTORY_ENTRY_REVERSED`); note 1 … 200 (`400`). **Who** (O-8): the pipeline checks `reverse-inventory-entry`; the handler then allows it when `actor_id` = the reversed event's `actor_id` (**own entry**), **or** the actor holds `close-daily-sheet` through `ctx.directory.resolve` (05a session rules: listed device), else `403 PERMISSION_DENIED { reason: 'not_own_entry' }`. **When:** the event's day has no sheet; or (M-3) it holds the latest sheet and the actor holds `close-daily-sheet` (the day becomes out of date, S20); else `409 INVENTORY_DAY_NOT_ALLOWED { reason: 'has_sheet' \| 'later_sheet' }`. Projections treat the reversed event's lines as absent; ⚠️ v0.4 N-1: the replacement's lines take the reversed event's **`order_seq`** (read from its `inventory_moves` rows, so a rebuild derives the same value from the events); `inventory_item_cost` of each **affected item (reversed ∪ replacement items)** is **recomputed** by `foldItemCost` over that item's steps in `(order_seq, seq)` order (S7, §6.5) — a replacement is never applied as a tail `stepItemCost`. Costs already frozen into later `WasteRecorded` rows are **not** rewritten (§7). **Large-quantity guard** (⚠️ v0.3 m-5): a receive / transfer / raw-waste / raw-count line whose `qty_stock_units` exceeds 5 × the item's `max_seen` (largest receipt line **or** count so far; cooked waste and cooked counts against the cooked item's largest count) needs `confirm_large: true`, else `422 INVENTORY_LARGE_QUANTITY { stock_item_id, qty_stock_units, max_seen }`; an item with nothing seen yet has no guard; `max_seen` comes from the fold, so a reversed 18 500 kg no longer counts | A typo of kg for g must not ruin the MWA or two sheets; the recorder fixes it at once | — |
| S20 | ⚠️ v0.3 M-3 / O-10: **Sheet corrections.** A day holding the latest sheet becomes **out of date** when a recount or a reversal lands on it after its sheet (`daily_sheets.out_of_date = 1`); the day view and the report show "Sheet out of date — close again". The correction is `CloseDailySheet { business_day_id, supersedes: <current sheet>, note }` (note required; `supersedes` must be the day's current sheet, else `409 INVENTORY_SHEET_CLOSED`); it recomputes quantities from the current counts and moves and **re-uses the superseded sheet's `unit_cost_micro` / `unit_cost_source` per item**; ⚠️ v0.4 n-4: its **required set is the superseded sheet's `required`** (so every item has a superseded cost; `cost_from: 'now'` is removed); settings and period are the superseded sheet's. A correction of a sheet that is not out of date is allowed too (late 08c lines, §7) | A wrong count found after closing is fixable; a correction never re-prices the day | — |

### 3.2 Command processing order (each command, a subset of F §6.3)

payload Zod (`400`) → session kind + **static** permission (pipeline, `403`) → inventory configured (key present and `buildCostInputs` returns items, ⚠️ v0.4 N-3; `409 INVENTORY_NOT_CONFIGURED`) → item checks S2 (`404` / `422`) → day rule S14 (`409`) → command rules (`422` / `409`). ⚠️ v0.4 n-2, **`ReverseInventoryEntry`** (§6.5's order, the only one): event lookup (`404 INVENTORY_ENTRY_NOT_FOUND`, `409 INVENTORY_ENTRY_REVERSED`) → handler narrowing (own entry, else `close-daily-sheet`; `403 not_own_entry`) → day rule S19 (`409`) → replacement checks S2–S4 and guard (`404` / `422`) → append (one writer transaction; projections applied live) → result. Idempotent retransmit by `command_id` returns the stored result (00 §3.5). ⚠️ v0.3 M-1: no event id is read before the static permission check.

### 3.3 Validation rules

| Rule | Error |
|---|---|
| Snapshot has no `inventory` key, or `buildCostInputs` returns no items (⚠️ v0.4 N-3) | `409 INVENTORY_NOT_CONFIGURED` |
| Line `stock_item_id` not in the snapshot's inventory items, or archived | `404 STOCK_ITEM_NOT_FOUND { stock_item_id }` |
| Raw line not an A-item; cooked line not a tracked cooked item; transfer line not a packet (S2, S8) | `422 INVENTORY_ITEM_NOT_TRACKED { stock_item_id, reason }` |
| Unit does not resolve for the item (08a I5) | `422 CONFIG_REFERENCE_INVALID { field: 'lines.N.unit_name', reason: 'not_convertible' }` |
| Weigh-required item entered in a non-weight unit (S4) | `422 CONFIG_REFERENCE_INVALID { field: 'lines.N.unit_name', reason: 'weigh_required' }` |
| `piece_count` missing on a `track_piece_count` item, or sent on another item | `400` |
| `qty_num` 1 … 10⁹ (counts: 0 … 10⁹), `qty_den` 1 … 10⁶; `qty_stock_units` ≥ 1 (counts ≥ 0) and ≤ 10⁹ | `400` |
| `price_total_minor` 1 … 10¹⁰ | `400` |
| Lines per command: 1 … 20; one line per item per command | `400` |
| Line above 5 × the item's `max_seen` without `confirm_large` (S19) | `422 INVENTORY_LARGE_QUANTITY { stock_item_id, qty_stock_units, max_seen }` |
| Waste `reason = 'other'` without `note`; any `note` ≤ 200; reversal / correction note 1 … 200 | `400` |
| Move with no open day | `409 BUSINESS_DAY_NOT_OPEN` |
| Count / close / reversal day not allowed (S14, S19) | `409 INVENTORY_DAY_NOT_ALLOWED { business_day_id, reason }` |
| Reversal of someone else's entry without `close-daily-sheet` (S19) | `403 PERMISSION_DENIED { reason: 'not_own_entry' }` |
| Close without a non-null count for every item of the day's required set | `409 INVENTORY_COUNT_MISSING { stock_item_ids }` |
| Close with moves after a count and neither recount nor `confirm_moves_after_count` | `409 INVENTORY_MOVES_AFTER_COUNT { stock_item_ids }` |
| Correction whose `supersedes` is not the day's current sheet | `409 INVENTORY_SHEET_CLOSED { business_day_id, current_event_id }` |
| Reversal of an unknown event or a type not in S19 | `404 INVENTORY_ENTRY_NOT_FOUND { event_id }` |
| Second reversal of one event | `409 INVENTORY_ENTRY_REVERSED { event_id }` |
| `replacement` of the wrong shape for the reversed type | `400` |

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 08a v1.0.1 | `resolveUnit`, `normaliseUnitName`, `toStockUnits`, `effectiveMenuPrice`, `pricePerStockUnit` (`@pos/domain/inventory`) |
| 08b (row R-b) | snapshot `inventory` key (items with 08d's two fields, current item units, price candidates, yields, published recipes); **`buildCostInputs`** (element-wise parse; `CostInputs.dropped`; ⚠️ v0.4 N-3: 08d never parses the whole key); **`explodeStockItem(inputs, preparedStockItemId: string, qty: bigint) → { usage: Map<string /* stock_item_id */, { num: bigint, den: bigint }>, status: 'costed' \| 'partial' }`** (depth ≤ 3, never throws). ⚠️ v0.3 M-7: no other 08b function |
| 08c (row R-c) | `theoreticalUsage(db, { business_day_id, count_seq_by_item: Map<string, number> }) → { items: Map<stock_item_id, { sold, comp, void_waste, staff_meal, sold_after_count /* each { num: bigint, den: bigint } in stock units */, status: 'costed' \| 'partial' }>, coverage_bp: number, revenue_minor: string }` |
| 00 | pipeline (static permission), `ctx.directory.resolve(staffId, permission)` (S19) |
| 01a | open / closed business days (`BusinessDayOpened` event ids and `seq`, `BusinessDayClosed`), `branchConfig()`, `engine_settings` defaults pattern |
| 04 | `ItemVoided.disposition` — through 08c only |

### 4.2 Exposes

| Export | Shape | Used by |
|---|---|---|
| Events (`@pos/events`, stream `inventory`) | `GoodsReceived` v1, `StockTransferReceived` v1, `WasteRecorded` v1, `CountRecorded` v1, `InventoryEntryReversed` v1, `DailySheetClosed` v1 (§5.3), one fixture each (`packages/events/fixtures/<EventType>.v1.json`, D46) | 06, 07, POST receiving |
| `stepItemCost`, `foldItemCost`, `divRound` (`packages/domain/src/inventory/mwa.ts`, pure) | §5.2 fold state | 08d projections and commands |
| `todaysCost(db, inputs, stockItemId) → { unit_cost_micro: bigint, source: 'mwa' \| 'menu' } \| null` | `apps/hub/src/inventory/cost.ts` | 08c (its own choice), 08d screen |
| `TodaysCostWire { unit_cost_micro: string, source: 'mwa' \| 'menu', display_per: { unit: 'kg' \| 'l' \| 'piece', minor: string } }` | `packages/events/src/inventory/wire.ts` | client |
| Projections `inventory_moves`, `inventory_count_history`, `inventory_counts`, `inventory_day_sets`, `inventory_item_cost`, `daily_sheets` | §5.2 | 08d queries, 07 |

### 4.3 Requirements on other parts of module 08

| Row | To | Requirement |
|---|---|---|
| R-b | 08b | (1) Exposes `explodeStockItem` exactly as §4.1. (2) ⚠️ v0.4 N-3 (08b v0.4 text): "`buildCostInputs` accepts the snapshot key with 08d's two optional item fields present (unknown fields ignored); `InventorySnapshotSchema` is exported for tests." (3) 08b's §4.3 row "08d" reads: "08c owns `theoreticalUsage` (full explosion, no `stopAt`); 08d counts the prepared items the owner ticks as themselves and converts them with `explodeStockItem`; 08d adds two optional fields to `inventory.items[]`". **08d cannot be approved until 08b's approved text carries this row** (⚠️ v0.4 N-4: 08b v0.4 §4.3 carries it verbatim, and its 08c row carries R-c's signature verbatim) |
| R-c | 08c | Exposes `theoreticalUsage(db, { business_day_id, count_seq_by_item })` exactly as §4.1, with the S12 rules (sold, comp; `wastage` → `void_waste`; `staff_meal` → `staff_meal`; `moved` excluded; `other` as `wastage`; voids without disposition excluded; attribution by placing `business_day_id`; carried-over orders stay with their placing day; per-item `status`; `sold_after_count` by line `seq`; `coverage_bp` and `revenue_minor` by revenue in the same call) and a fixed statement count per call |

### 4.4 Story → part

08d-1: S2–S11, S14 (moves and counts), S15–S19, screen, day view. 08d-2 (after 08c): S12, S13, S14 (close), S20, report.

### 4.5 Changes to other specs (R26)

Applied when 08d is approved (folded into module 08's next version), each target bumped to **its next free version at that time, after 08b's bumps**, with a changelog and "⚠️ Changed by 08d (row X)" markers. ⚠️ v0.3 M-9: bases are main's — Foundation v1.16, 00 v1.12.4, 01d v1.3.6, 05a v1.0.5, 08a v1.0.1.

| Row | Target, section | Change | Why |
|---|---|---|---|
| F-1 | **Foundation v1.16 → v1.17** §4.1 envelope + `packages/events/src/envelope.ts` (⚠️ v0.4 n-7) | `stream_type` gains **`'inventory'`** (stream ids `grn:`, `xfer:`, `waste:`, `sheet:<business_day_id>`); Zod enum only, no DB CHECK; not replayed by the engine (F §5.8's replay lists unchanged) | S1, C3 |
| F-2 | Foundation v1.17 §3.1 D50 | Note: "one stock projection" is the engine's **pre-cooked** stock; purchased inventory (`ingredient`, `packet`) is a separate hub projection on the `inventory` stream the engine never reads | S1, 08a I9 |
| F-3 | Foundation §6.2 status map | 08d §9 codes appended (no bump on its own, R34) | §9 |
| B-1 | **01b** §3.3, §4.2 catalogue, `packages/domain/src/permissions.ts` ⚠️ v0.4 n-1: the roles editor shows `reverse-inventory-entry` as "Undo own entries" directly under the three recording keys in `menu_stock` and ticks it together with the first of them (the owner may untick it); the `0020` backfill grants it to every active role holding one of the three | `receive-stock`, `record-waste`, `count-inventory`, `close-daily-sheet`, **`reverse-inventory-entry`**: group `menu_stock`, scope `branch`; all five in `ALLOWED_ONLY_PERMISSIONS` (roles API `422` on `requires_approval`); defaults Owner + Manager in the seed (Manager = all but `MANAGER_EXCLUDED`, so the seed grants them already) **and** the cloud backfill migration (§5.1) by `default_key`; client labels `perm.*` | S15 |
| B-2 | 01b §6.10, `packages/events/src/admin/staff.ts` `BranchEngineSettings` / `BRANCH_ENGINE_SETTING_KEYS` | The owner settings wire takes `inventory_variance_pct_bp`, `inventory_variance_value_minor` (as 01b v1.10.2 did for `max_delay_default_ms`) | S16 |
| C-1 | **01c** §3.1 V3, §3.3, §5.4, §6.7, §6.8, §8 | `stock_items` gains `must_weigh_on_receipt` (CHECK `NOT must_weigh_on_receipt OR stock_unit = 'g'`) and `track_piece_count` (CHECK `NOT track_piece_count OR (stock_unit IN ('g','ml') AND kind <> 'packet')`); both in the version input and the owner form; they are `inventory.items[]` fields, so they bump by 08b's rule. ⚠️ v0.3 M-5: the owner form **shows** `is_a_item` on `prepared` items, labelled "Count daily" (S2) | S4, S17, S2 |
| A-1 | **01a** `branch_engine_settings`, snapshot `engine_settings` | Two optional keys with hub defaults 300 / 50 000; cloud columns; owner settings page. ⚠️ v0.3 M-6: the migration ends with the release bump (0017 pattern, MD-3) | S16, S17 |
| D-1 | **05a v1.0.5** §3.3, §3.6, `packages/domain/src/{screens,permissions}.ts` | `SCREEN_KEYS` gains **`inventory`**, offered on every staff device type (`screensOffered` offers every key; **no existing profile gets it automatically — the manager adds it in Devices**), shown to a person holding any S15 permission (05a §3.6's "hidden when the person holds none" line); works in the 05b staff tablet (same `/staff/` page); `close-daily-sheet` added to `LISTED_ONLY_PERMISSIONS` | S15, S18 |
| P-1 | **08a** (module 08 file) I12, §12.3 OQ-2 | I12's owner-app help line becomes "Today's cost from deliveries is on the hub's Inventory screen"; OQ-2: the owner keeps entering market rates in the owner app (the hub screen records receipts, not market rates) | S18 |
| R-b | 08b (module 08 file) | §4.3 above | S2, S10, S17 |
| R-1 | README | Module map row 08d (status, depends on 08b, 08c for 08d-2) | — |
| — | 00 | ⚠️ v0.3 M-1: **no change**: `ReverseInventoryEntry` has a static permission; the own-entry rule is a handler narrowing through `ctx.directory` | S19 |
| — | 03a / `@pos/engine` | **No change**: the `inventory` stream is in no reducer list; pre-cooked stock untouched | S1, S10 |
| — | 04, 05 | **No change** (04 read through 08c) | S12 |
| — | `CloseBusinessDay` | **No new guard** (S14) | fallback |

---

## §5. Data model and migrations

### 5.1 Cloud — `0020_inventory_receiving.sql` (after 08b's `0019`; recheck at build)

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
-- ⚠️ v0.3 m-17: 01b row B-1 backfill, 0015 pattern (by default_key, active roles, ON CONFLICT DO NOTHING,
-- directory_version + 1 once per tenant that changed; a second run changes nothing).
WITH defaults (default_key, permission, grant_type, scope) AS (
  VALUES
    ('owner',   'receive-stock',           'allowed', 'branch'),
    ('owner',   'record-waste',            'allowed', 'branch'),
    ('owner',   'count-inventory',         'allowed', 'branch'),
    ('owner',   'close-daily-sheet',       'allowed', 'branch'),
    ('owner',   'reverse-inventory-entry', 'allowed', 'branch'),
    ('manager', 'receive-stock',           'allowed', 'branch'),
    ('manager', 'record-waste',            'allowed', 'branch'),
    ('manager', 'count-inventory',         'allowed', 'branch'),
    ('manager', 'close-daily-sheet',       'allowed', 'branch'),
    ('manager', 'reverse-inventory-entry', 'allowed', 'branch')
), wanted AS (
  SELECT r.tenant_id, r.role_id, d.permission, d.grant_type, d.scope
    FROM defaults d JOIN roles r ON r.default_key = d.default_key AND r.archived_at IS NULL
  UNION
  -- ⚠️ v0.4 n-1: "Undo own entries" goes with the recording keys on every active role that has one of them
  SELECT DISTINCT rp.tenant_id, rp.role_id, 'reverse-inventory-entry', 'allowed', rp.scope
    FROM role_permissions rp JOIN roles r ON r.tenant_id = rp.tenant_id AND r.role_id = rp.role_id AND r.archived_at IS NULL
   WHERE rp.permission IN ('receive-stock', 'record-waste', 'count-inventory') AND rp.grant_type = 'allowed'
), granted AS (
  -- ⚠️ v0.4 n-5: table and conflict target as 0015_billing_defaults_backfill.sql; approver_role_id NULL for 'allowed' (0001 CHECK)
  INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope)
  SELECT tenant_id, role_id, permission, grant_type, NULL, scope FROM wanted
  ON CONFLICT (tenant_id, role_id, permission) DO NOTHING
  RETURNING tenant_id
)
UPDATE tenants SET directory_version = directory_version + 1
WHERE tenant_id IN (SELECT DISTINCT tenant_id FROM granted);
-- ⚠️ v0.3 M-6: release delivery (0017 pattern, MD-3 / AD-9): the builder now emits two item fields and two
-- engine_settings keys, so every branch's body changes; bump once so hubs fetch it.
UPDATE branches SET config_version = config_version + 1;
```
The build task re-reads `0015_billing_defaults_backfill.sql` (⚠️ v0.4 n-5: `role_permissions`, conflict target, `RETURNING` shape — as written above; the second `wanted` arm reads the recording keys this migration's first arm may also insert, which is fine: the `UNION` dedupes and `ON CONFLICT` skips) and the live `branch_engine_settings` first (01b D-5) and copies them exactly.

### 5.2 Hub — `0028_inventory.sql` (next free hub number; main has `0027`; recheck at build)

```sql
CREATE TABLE inventory_moves (                    -- one row per receipt / transfer / waste line
  event_id TEXT NOT NULL, line_no INTEGER NOT NULL,
  business_day_id TEXT NOT NULL, day_seq INTEGER NOT NULL,
  stock_item_id TEXT NOT NULL,                    -- the A-item (raw) or the cooked item (waste_cooked)
  move TEXT NOT NULL CHECK (move IN ('received','transfer_in','waste_raw','waste_cooked')),
  qty_stock_units INTEGER NOT NULL, piece_count INTEGER,
  price_total_minor INTEGER, unit_cost_micro TEXT, unit_cost_source TEXT,
  actor_id TEXT NOT NULL,                         -- S19 own-entry rule
  reversed INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  order_seq INTEGER NOT NULL,                     -- ⚠️ v0.4 N-1: own seq, or the reversed event's order_seq for a replacement
  PRIMARY KEY (event_id, line_no));
CREATE INDEX inventory_moves_day ON inventory_moves (business_day_id, stock_item_id);  -- day view, close
CREATE INDEX inventory_moves_item_order ON inventory_moves (stock_item_id, order_seq, seq);  -- ⚠️ v0.4 N-1: recompute in fold order

CREATE TABLE inventory_count_history (            -- ⚠️ v0.3 M-4: every CountRecorded line, for the fold
  event_id TEXT PRIMARY KEY, business_day_id TEXT NOT NULL, day_seq INTEGER NOT NULL,
  stock_item_id TEXT NOT NULL, qty_stock_units INTEGER, seq INTEGER NOT NULL);
CREATE INDEX inventory_count_history_item_seq ON inventory_count_history (stock_item_id, seq);   -- a count's order_seq = its seq

CREATE TABLE inventory_counts (                   -- latest count per (day, item) (S9)
  business_day_id TEXT NOT NULL, day_seq INTEGER NOT NULL, stock_item_id TEXT NOT NULL,
  qty_stock_units INTEGER,                        -- NULL = not counted
  is_estimated INTEGER NOT NULL, counted_by TEXT NOT NULL, counted_at INTEGER NOT NULL,
  event_id TEXT NOT NULL, seq INTEGER NOT NULL,
  PRIMARY KEY (business_day_id, stock_item_id));

CREATE TABLE inventory_day_sets (                 -- ⚠️ v0.3 M-5 / v0.4 N-2: derived from the day's first CountRecorded.required_set only
  business_day_id TEXT PRIMARY KEY, a_item_ids TEXT NOT NULL, cooked_item_ids TEXT NOT NULL,  -- JSON arrays
  frozen_seq INTEGER NOT NULL);

CREATE TABLE inventory_item_cost (                -- S6 / S7 / S19
  stock_item_id TEXT PRIMARY KEY,
  fold_state TEXT NOT NULL,                       -- JSON of stepItemCost's state (below)
  avg_micro TEXT,                                 -- = fold_state.avg_micro; NULL = no priced receipt (or a packet)
  on_hand_stock_units INTEGER NOT NULL,           -- = derived from fold_state (⚠️ v0.3 m-4)
  max_seen INTEGER,                               -- S19 guard
  updated_seq INTEGER NOT NULL);

CREATE TABLE daily_sheets (                       -- current DailySheetClosed per business day (S14, S20)
  business_day_id TEXT PRIMARY KEY, day_seq INTEGER NOT NULL, business_date TEXT NOT NULL,
  event_id TEXT NOT NULL, supersedes TEXT,
  flag_summary TEXT NOT NULL,                     -- ⚠️ v0.3 m-11: JSON { over, under, unreliable, ok } (counts)
  out_of_date INTEGER NOT NULL DEFAULT 0,         -- ⚠️ v0.3 M-3 / S20
  closed_by TEXT NOT NULL, closed_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL, seq INTEGER NOT NULL);
CREATE INDEX daily_sheets_day ON daily_sheets (day_seq);                 -- order rule, previous sheet
CREATE INDEX daily_sheets_date ON daily_sheets (business_date);          -- ⚠️ v0.3 m-12: list by label
```

**Fold state** (⚠️ v0.3 M-4, `packages/domain/src/inventory/mwa.ts`): `{ avg_micro: string | null, anchor: { day_seq, order_seq, qty } | null, pending: [{ day_seq, order_seq, qty_signed }] /* moves not before the anchor */, max_seen: number | null }`; `on_hand = (anchor?.qty ?? 0) + Σ pending where (day_seq > anchor.day_seq) or (day_seq = anchor.day_seq and order_seq > anchor.order_seq)` (⚠️ v0.4 N-1). ⚠️ v0.4 n-6: the step input is **`ItemStep = { kind: 'move' | 'raw_count' | 'cooked_count' | 'cooked_waste', order_seq, seq, day_seq, qty_signed | qty, price_total_minor? }`** — one line of one item, built from `inventory_moves` / `inventory_count_history` rows (live: from the event's lines); steps are applied in `(order_seq, seq)` order. `stepItemCost(state, step)`: a move adds to `pending` (and, if priced, updates `avg_micro` with S6 using the current `on_hand`); a non-null raw count with `day_seq ≥ anchor.day_seq` re-anchors and prunes `pending` older than the new anchor; a cooked count / cooked waste only updates the cooked item's own `max_seen`; a reversed event is skipped by the caller. `pending` holds only moves since the last count (days between counts).

**Projection group** (one group, registered, applied and rebuilt together; one `reset`, one catch-up). Apply order per event: moves / count history / counts / day set → item cost → sheets. ⚠️ v0.3 m-1: `day_seq` = `events.seq WHERE event_id = payload.business_day_id` (event store PK read, immutable; 1 per event). µ-minor values and every `_minor` derived from them are stored as decimal strings (`TEXT`); quantities stay `INTEGER` (≤ 10⁹).

### 5.3 Events (`packages/events/src/events/inventory/*.v1.ts`, stream `inventory`)

Every payload carries `business_day_id` and `business_date` (S1). µ-minor values and `_minor` values are decimal strings (`z.string().regex(/^-?\d+$/)`); quantities are `number` (≤ 10⁹).

```jsonc
GoodsReceived v1 {            // stream_id "grn:<grn_id>"
  grn_id, business_day_id, business_date, mode: "quick_receive",
  supplier_name_freetext?,    // ≤ 60
  replaces_event_id?,         // ⚠️ v0.3 M-2: set when written as a reversal's replacement
  lines: [{ line_no, stock_item_id, unit_name, qty_num, qty_den, conv_num, conv_den,
            qty_stock_units, piece_count?, price_total_minor?, confirm_large? }]
}
StockTransferReceived v1 {    // "xfer:<transfer_id>"; packets only (S8)
  transfer_id, business_day_id, business_date, from_label, replaces_event_id?,
  lines: [{ line_no, stock_item_id, unit_name, qty_num, qty_den, conv_num, conv_den,
            qty_stock_units, unit_cost_micro: string | null, unit_cost_source: "menu" | null, confirm_large? }]
}
WasteRecorded v1 {            // "waste:<waste_id>"
  waste_id, business_day_id, business_date, stage: "raw" | "cooked", replaces_event_id?,
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
  is_estimated, confirm_large?,
  required_set?: { a_item_ids: [..], cooked_item_ids: [..] }   // ⚠️ v0.4 N-2: only on the day's first CountRecorded
}
InventoryEntryReversed v1 {   // the reversed event's stream
  reversed_event_id, reversed_event_type: "GoodsReceived" | "StockTransferReceived" | "WasteRecorded",
  business_day_id, business_date, note,
  replacement_event_id?       // ⚠️ v0.3 M-2
}
DailySheetClosed v1 {         // "sheet:<business_day_id>"
  business_day_id, business_date, period_business_day_ids: [..],   // ≤ 7 (m-10)
  supersedes?, note?, confirm_moves_after_count?,
  required: { a_item_ids: [..], cooked_item_ids: [..] },            // ⚠️ v0.3 M-5: the day's frozen set (a correction: the superseded sheet's, v0.4 n-4)
  excluded?: [{ stock_item_id, reason: "no_longer_tracked" }],     // ⚠️ v0.4 n-3
  settings: { pct_bp, value_minor }, coverage_bp,
  items: [{ stock_item_id, opening, received, transfer_in, user_waste, closing, closing_raw, closing_cooked_equiv,
            actual_usage, sold, comp, void_waste, staff_meal, theoretical_usage, sold_after_count_qty,
            variance_qty, variance_bp, variance_value_minor, unit_cost_micro, unit_cost_source,
            cost_from: "close" | "superseded",                       // ⚠️ v0.3 O-10 (S20); v0.4 n-4: "now" removed
            variance_flag: "ok" | "over" | "under" | null, flag: "ok" | "over" | "under" | "unreliable",
            unreliable_reasons: ("baseline" | "chain_broken" | "coverage" | "estimated" | "no_cost"
                                 | "cooked_partial" | "usage_partial" | "moves_after_count"
                                 | "sales_after_count")[] }]
}
```
`opening`, `actual_usage`, `variance_*`, `unit_cost_*` may be null (S13). `actor_id` = the session's staff.

---

## §6. Commands and queries

Moves (`ReceiveGoods`, `ReceiveTransfer`, `RecordWaste`) and `RecordCount`: ⚠️ v0.3 m-19 `sessionKind: 'device'` (the Inventory screen). `ReverseInventoryEntry`, `CloseDailySheet`: `'both'` (screen and hub admin). All: `command_id` idempotency; queueable **no** (counts depend on the moment; the screen keeps typed, unsent values in `localStorage` per (branch, `business_day_id`, staff) as 01a S55 does for stock counts). **No WS message**; the screen refetches `inventory-day` after each own command and on focus. Shared failures not repeated: `400 VALIDATION_FAILED`, `401`, `403 PERMISSION_DENIED`, `403 DEVICE_ACCESS_DENIED` (05a), `409 INVENTORY_NOT_CONFIGURED`, `404 STOCK_ITEM_NOT_FOUND`, `422 INVENTORY_ITEM_NOT_TRACKED`. Statement counts are the writer transaction's statements after the pipeline's own (idempotency row, result row); every projection apply adds its own (1 `day_seq` read + its upserts), counted below.

### Batch 1 — receiving and waste (08d-1)

#### 6.1 `ReceiveGoods` (permission `receive-stock`)

| | |
|---|---|
| Payload | `{ supplier_name_freetext?, lines: [{ stock_item_id, unit_name, qty_num, qty_den?: 1, piece_count?, price_total_minor?, confirm_large? }] (1–20, one per item) }` |
| Script | §3.2: S2 per line → open day (id + `day_seq`, 1 read) → S3 resolve → S4 → **1 read** of the lines' `inventory_item_cost` rows (`IN`; fold state holds `on_hand`, `max_seen`; ⚠️ v0.3 m-4: no second read) → S19 guard → append `GoodsReceived` → apply: 1 `day_seq` read, per line 1 move insert + 1 cost upsert (`stepItemCost`) |
| Result | `{ grn_id, lines: [{ stock_item_id, qty_stock_units, todays_cost: TodaysCostWire \| null }] }` |
| Statements | 2 + 1 event + 1 + 2 × lines |

| Edge | Answer |
|---|---|
| Paye 18.5 kg (185/10), 92 pieces, Rs 33,300 | `qty_stock_units` 18 500; first receipt `avg` = divRound(3 330 000 × 10⁶, 18 500) = 180 000 000 µ-minor/g (Rs 1.80/g) |
| Paye in `piece` | `422 weigh_required` |
| Paye without `piece_count` | `400` |
| Beef 12 kg, no price | `on_hand` + 12 000; `avg` unchanged |
| Beef 18 500 kg (`max_seen` 20 kg) without `confirm_large` | `422 INVENTORY_LARGE_QUANTITY { max_seen: 20000 }` |
| Item not an A-item | `422 INVENTORY_ITEM_NOT_TRACKED { reason: 'not_a_item' }` |
| No open day | `409 BUSINESS_DAY_NOT_OPEN` ("Start the day first") |
| Retransmit | stored result, no second event |

#### 6.2 `ReceiveTransfer` (`receive-stock`)

Payload `{ from_label, lines: [{ stock_item_id, unit_name, qty_num, qty_den?, confirm_large? }] }`. Script as 6.1 with S8 (packets only; menu cost from snapshot inputs, frozen with source `'menu'`; no MWA update). Result `{ transfer_id, lines }`. Statements as 6.1. Edges: TP-1 2 400 g, menu cost Rs 3.00/g → `unit_cost_micro` "300000000", source `menu`; a packet with no price → stored, cost null; beef → `422 INVENTORY_ITEM_NOT_TRACKED { reason: 'not_packet' }`.

#### 6.3 `RecordWaste` (`record-waste`)

Payload `{ stage, stock_item_id, unit_name, qty_num, qty_den?, reason, note?, confirm_large? }`. Script: S2 (raw → A-item, cooked → tracked cooked item) → open day (1) → S3 → cost row read (1; raw: cost + guard; cooked: the cooked item's `max_seen`) → S19 guard → append → apply: 1 `day_seq` read, 1 move insert, 1 cost upsert. Result `{ waste_id, qty_stock_units, unit_cost: TodaysCostWire \| null }`. **Statements: 2 + 1 event + 3** (raw and cooked alike; ⚠️ v0.3 m-5). Edges: `reason: 'other'` without note `400`; PAYE-COOKED 6 pieces cooked → stored in pieces, no cost frozen, valued at close; ghee raw 500 g → `on_hand` − 500, cost frozen with its source; biryani 3 plates cooked → stored in plates (if ticked).

### Batch 2 — counts, reversal, day view (08d-1)

#### 6.4 `RecordCount` (`count-inventory`; on a sheeted day also `close-daily-sheet`, S14)

| | |
|---|---|
| Payload | `{ business_day_id?, entries: [{ stock_item_id, qty: { unit_name, qty_num, qty_den? } \| null, is_estimated?: false, confirm_large? }] (1–20) }` |
| Script | S2 (A-item or tracked cooked item) → day rule S14 (default open day, else latest closed day without sheet; 2 reads: day row, sheets of this and later days; `409 INVENTORY_DAY_NOT_ALLOWED`; on the latest sheeted day: `ctx.directory.resolve(actor, 'close-daily-sheet')` else `409 { reason: 'has_sheet' }`) → S3 (`qty_num` 0 allowed) → cost rows read (1, guard and fold) → S19 guard → one `CountRecorded` per entry → apply: 1 `day_seq` read; per entry: 1 history insert + 1 `inventory_counts` upsert; ⚠️ v0.4 N-2: the **command** reads the day's set (1 read of `inventory_day_sets`); when absent it computes it from the snapshot and writes it into this first `CountRecorded` as `required_set`; the apply stores it with 1 `INSERT OR IGNORE` from the event field; raw A-item entries: 1 cost upsert each (re-anchor, `stepItemCost`); on a sheeted day: 1 `daily_sheets` update (`out_of_date = 1`) |
| Result | `{ business_day_id, counts: [{ stock_item_id, qty_stock_units, superseded: boolean }], sheet_out_of_date: boolean }` |
| Statements | 3 + 1 day-set read (⚠️ v0.4 N-2) + per entry (1 event + 2) + 1 + 1 + raw entries × 1 (+ 1 on a sheeted day) |

Edges: `qty: null` → stored "not counted"; `qty_num: 0` → zero; recount → `superseded: true`; count for last night's closed day after this morning's open → accepted (no sheet yet); count for a day with a sheet by a store keeper → `409 has_sheet`, by a manager on the latest sheeted day → accepted, `sheet_out_of_date: true`; count for D−2 when D−1 has a sheet → `409 later_sheet`; PAYE-COOKED 14 pieces (degh) → cooked count; beef 185 000 g when `max_seen` 20 000 → `422 INVENTORY_LARGE_QUANTITY`.

#### 6.5 `ReverseInventoryEntry` (permission `reverse-inventory-entry`; handler narrowing S19)

| | |
|---|---|
| Payload | `{ event_id, note, replacement?: <the reversed command's payload without command fields: GoodsReceived lines + supplier, transfer lines + from_label, or the waste fields> }` |
| Script | pipeline: static permission (`403` before any read) → read the event's lines from `inventory_moves` (1; `404 INVENTORY_ENTRY_NOT_FOUND` for an unknown id or another type; `reversed` → `409 INVENTORY_ENTRY_REVERSED`) → own-entry rule (`actor_id` match, else `ctx.directory.resolve(actor, 'close-daily-sheet')`; `403 not_own_entry`) → day rule (sheets of that and later days, 1 read; `409 has_sheet` / `later_sheet`; a sheeted latest day only for a `close-daily-sheet` holder) → `replacement`: S2–S4, guard against the fold **without** the reversed lines (⚠️ v0.4 n-6: 1 moves read + 1 count-history read per replacement item, before append) → append `InventoryEntryReversed` (+ the replacement event, on the original's `business_day_id`) → apply: mark lines `reversed` (1); replacement moves with **`order_seq` = the reversed lines' `order_seq`** (⚠️ v0.4 N-1; 1 + lines); per affected item (**reversed ∪ replacement items**): recompute (1 moves read + 1 count-history read in `(order_seq, seq)` order, `foldItemCost`, 1 upsert) — never a tail step; on a sheeted day: 1 `daily_sheets` update |
| Result | `{ reversed_event_id, replacement_event_id?, items: [{ stock_item_id, todays_cost }], sheet_out_of_date: boolean }` |
| Statements | 3 + 2 × replacement items (guard, ⚠️ v0.4 n-6) + 1 or 2 events + 1 + (1 + replacement lines) + 3 × affected items (≤ 20) (+ 1 on a sheeted day). The two recompute reads grow with one item's history (~1 000 rows per item per year in the pilot); accepted, stated |

Edges: store keeper reverses **his own** 18 500 kg receipt this morning with `replacement` 18.5 kg → yesterday's `received` = 18 500 g, today unaffected, `avg` as if the typo never happened (M-2); store keeper reverses **someone else's** receipt → `403 not_own_entry`; manager reverses it → accepted; a waste of a sheeted day by the store keeper → `409 has_sheet`, by the manager on the latest sheet → accepted, sheet out of date; reverse twice → `409 INVENTORY_ENTRY_REVERSED`; a cashier without `reverse-inventory-entry` → `403` (no read); `replacement` of another type's shape → `400`.

#### 6.6 Query `GET /queries/inventory-day?business_day_id=` (any S15 permission)

Response: `{ business_day_id, business_date, day_state: 'open' | 'closed', sheet: { event_id, flag_summary, out_of_date } | null, required_frozen: boolean, a_items: [{ stock_item_id, name, code, stock_unit, units: [...resolvable], must_weigh_on_receipt, track_piece_count, todays_cost: TodaysCostWire | null, received, received_pieces, transfer_in, user_waste_raw, count: { qty_stock_units, is_estimated, counted_by_name, counted_at } | null, moves_after_count: boolean }], cooked_items: [{ stock_item_id, name, stock_unit, user_waste, count: {…} | null, moves_after_count }], ignored_ticked: [{ stock_item_id, name, reason: 'uses_no_a_item' | 'no_recipe' }] /* ⚠️ v0.4 nit-2: 'no_recipe' = `explodeStockItem` partial with empty usage */, dropped: number /* ⚠️ v0.4 N-3: CostInputs.dropped; > 0 → "Some inventory settings could not be read" */, my_entries: [{ event_id, type, summary, reversible: boolean }] }`. Default day = open day, else latest closed day without sheet. **Statements: 6 fixed** (day row, moves of the day, counts of the day, day set, item costs for the listed items, sheet row); items, units, menu cost and tracked cooked items from the in-memory snapshot (`branchConfig()`, 08b `CostInputs`); `reversible` from the S19 rules without a read.

### Batch 3 — close and report (08d-2, after 08c)

#### 6.7 `CloseDailySheet` (`close-daily-sheet`)

| | |
|---|---|
| Payload | `{ business_day_id, supersedes?: event_id, note?, confirm_moves_after_count?: boolean }` (note required with `supersedes`) |
| Script | day rule S14 (day row, current and later sheets: 2 reads; `409 INVENTORY_DAY_NOT_ALLOWED` / `INVENTORY_SHEET_CLOSED`) → period: previous sheet (1 read) and the business days after it up to this one, ≤ 7 (1 read) → required set (1 read; a day with no count yet takes the current snapshot's set, carried in `DailySheetClosed.required`; a correction takes the superseded sheet's, ⚠️ v0.4 n-4) → ⚠️ v0.4 n-3: items of the set no longer tracked → `excluded` (`no_longer_tracked`) → counts of the day (1 read): every remaining required item non-null (`409 INVENTORY_COUNT_MISSING`) → moves of the period (1 read) → moves ordered after their item's count by `order_seq` (⚠️ v0.4 N-1; a replacement keeps its original's place) without recount or confirm (`409 INVENTORY_MOVES_AFTER_COUNT`) → `theoreticalUsage` per period day with `count_seq_by_item` (per A-item: the earliest `seq` among its raw count and the counts of the cooked items whose explosion uses it) (08c, its fixed count × days) → cooked raw equivalents (`explodeStockItem`, memory) → costs: first close → item cost rows (1 read, `todaysCost`); correction → the superseded sheet's payload (same read as the current sheet) → S13 per item, settings frozen (correction: the superseded sheet's) → append `DailySheetClosed` → apply: 1 `day_seq` read, 1 `daily_sheets` upsert (`out_of_date = 0`) |
| Result | `{ event_id, business_day_id, items: [...], flag_summary }` |
| Statements | 8 reads + 08c's per day + 1 event + 2 |

| Edge | Answer |
|---|---|
| Day still open | `409 INVENTORY_DAY_NOT_ALLOWED { reason: 'not_closed' }` |
| Yesterday's day, closed, no sheet, today already open | closes |
| D−2 when D−1 already has a sheet | `409 { reason: 'later_sheet' }` |
| PAYE-COOKED count missing | `409 INVENTORY_COUNT_MISSING { stock_item_ids: ['paye-cooked'] }` |
| Biryani ticked at 15:00, after the day's first count at 14:00 | not required that day (set frozen at 14:00) |
| A ghee receipt recorded after ghee's count | `409 INVENTORY_MOVES_AFTER_COUNT` → recount, or confirm → reason `moves_after_count` |
| Paye counted at 22:00, 4 plates of Paye Half sold until 23:30 | reason `sales_after_count`, `sold_after_count_qty` = their paye; flag `unreliable`; detail keeps `variance_flag` (O-11) |
| Beef's yield archived (EP lines partial) | 08c `status: 'partial'` → reason `usage_partial` |
| First sheet of an item | baseline |
| Skipped closed day | `period_business_day_ids` = both days; `chain_broken`; a gap of 8 days → baseline |
| Beef +4 % and +Rs 620 | `variance_flag` `over`, flag `over` |
| Beef −4 % but −Rs 300 | `ok` |
| Beef 5 kg gone, no beef sold (theoretical 0) | pct passes; value test decides → `over` |
| No cost for an item | value null, `variance_flag` null, reason `no_cost` |
| Coverage 9 200 bp and beef `over` | flag `unreliable`; detail shows `variance_flag: over` beside `coverage` |
| Second close without `supersedes` | `409 INVENTORY_DAY_NOT_ALLOWED { reason: 'has_sheet' }` |
| Manager recounts beef after the sheet, then corrects | new sheet with the new closing, **Monday's Rs 1,500/kg** kept (`cost_from: 'superseded'`), history 2 (O-10) |
| Retransmit | stored result |

#### 6.8 Query `GET /admin/queries/daily-sheets?from=&to=` (`close-daily-sheet` or `view-reports`)

`from` / `to` are business dates (labels); one row per business day: `{ business_day_id, business_date, flag_summary: { over, under, unreliable, ok }, out_of_date, closed_by, closed_at }` (max 62 days). **1 statement** (`daily_sheets_date`).

#### 6.9 Query `GET /admin/queries/daily-sheets/:business_day_id` (⚠️ v0.3 m-13: same permission as §6.8)

The current sheet's payload + its history (`supersedes` chain) + the period's moves (with `piece_count`, reversed lines and replacements marked) + counts with "counted by". **3 statements.** Unknown id or no sheet → `404 INVENTORY_SHEET_NOT_FOUND { business_day_id }`.

---

## §7. Cross-cutting

| Item | Decision |
|---|---|
| Logging | Command logs carry ids and counts only; notes and supplier names never logged |
| Offline | Commands need the hub (LAN); not queueable; local draft (§6); "hub unreachable" state |
| Performance | ≤ 20 lines per command; the day view reads one day; the close reads one period (≤ 7 days); the reversal recompute reads one item's history (§6.5) |
| Folders | `apps/hub/src/inventory/{commands,queries,projections}/` + `cost.ts`, following the `billing/` and `voids/` precedent (F v1.16 §6 module folders) |
| Privacy | `supplier_name_freetext` is business data; no person data beyond `actor_id` and `counted_by` |
| Risks | (1) Staff skip a count → the close refuses (S14); drill 3 shows which step. (2) A wrong batch yield skews the cooked equivalent → `cooked_partial` only when a yield is missing; drill 1 numbers first. (3) S7 (a) bias between counts, and paye's MWA ≈ last price (m-7) — accepted. (4) Sales after the count → reason `sales_after_count` with the quantity (O-11); staff should count after service. ⚠️ v0.4 nit-1: measured by the sale line's `seq` (placing time): a plate ordered before the count and taken from the degh after it is not flagged — accepted. (5) A reversed receipt does not rewrite costs already frozen into that day's raw waste (S19). (6) ⚠️ v0.3 m-14: a voided plate also entered as cooked waste counts twice → a false `under`; the form hint (S11). (7) ⚠️ v0.3 M-8: a sale line that reaches the hub after the day's sheet (offline replay) changes that day's theoretical after the sheet; the report shows the sheet as closed, the manager may re-close (S20) |

---

## §8. Client contract

1. **Device screen "Inventory"** (05a screen key `inventory`; `apps/client/src/features/inventory/`; works in the 05b staff tablet): one page; A-items as rows, tracked cooked items below (in their own unit: "PAYE-COOKED — pieces", "Biryani — plates"); "uses no A-item" note for an ignored tick; actions **Receive** (unit pick-list from `units`, the last unit used preselected from the device; kg + pieces for paye; optional total price; supplier free text), **Transfer in** (packets), **Waste** (raw / cooked, reason chips, note; cooked hint "Voided plates are counted automatically"), **Count** (blank by default with a "0" chip, never 0; "estimated" toggle; "counted by X at hh:mm"), **Undo entry** (on the person's own entries; a manager sees it on every entry; note required; optional "enter the correct amount" form that becomes the replacement). A "large quantity — sure?" confirm on `422 INVENTORY_LARGE_QUANTITY`. "Start the day first" on `409 BUSINESS_DAY_NOT_OPEN`. Labels per S18. No engine level shown. Only the actions the person's permissions allow are shown.
2. **Close** (same screen, `close-daily-sheet` holders; days that are closed and have no sheet, or are out of date): lists missing counts (raw and cooked), "after count — recount?" rows, a prompt for a discarded cooked leftover as cooked waste; on close, the per-item table with `variance_flag`, reasons (`sales_after_count` with "≈ 1 200 g paye sold after the count"), the separate `staff_meal` column; "Sheet out of date — close again" with a note.
3. **Hub admin report** (`apps/client/src/features/admin/inventory/`): list by business day (label + flag summary + out-of-date mark), sheet detail (items, period, settings used, required set, history, moves with pieces, reversals and replacements). Every value labelled by `unit_cost_source`; corrected sheets say "costs from the first close".
4. **Owner app** (01c C-1, 01a A-1): stock item form gains "Weigh on receipt" (g items only) and "Count pieces on receipt"; on `prepared` items `is_a_item` is shown as **"Count daily"** (⚠️ v0.3 M-5); branch settings gain the two thresholds.
5. Errors use existing texts plus the §9 codes; Urdu strings go to the urdu-todo list.

---

## §9. Error catalogue additions

| Code | Status | `details` | Condition |
|---|---|---|---|
| `INVENTORY_NOT_CONFIGURED` | 409 | `{}` | S2 (no key, or `buildCostInputs` returns no items; ⚠️ v0.4 N-3) |
| `INVENTORY_ITEM_NOT_TRACKED` | 422 | `{ stock_item_id, reason: 'not_a_item' \| 'not_cooked_item' \| 'not_packet' }` | S2, S8 |
| `INVENTORY_LARGE_QUANTITY` | 422 | `{ stock_item_id, qty_stock_units, max_seen }` | S19 |
| `INVENTORY_DAY_NOT_ALLOWED` | 409 | `{ business_day_id, reason: 'not_closed' \| 'has_sheet' \| 'later_sheet' \| 'unknown' }` | S14, S19 |
| `INVENTORY_COUNT_MISSING` | 409 | `{ stock_item_ids: string[] }` | S14 |
| `INVENTORY_MOVES_AFTER_COUNT` | 409 | `{ stock_item_ids: string[] }` | S14 |
| `INVENTORY_SHEET_CLOSED` | 409 | `{ business_day_id, current_event_id }` | S20 |
| `INVENTORY_SHEET_NOT_FOUND` | 404 | `{ business_day_id }` | §6.9 |
| `INVENTORY_ENTRY_NOT_FOUND` | 404 | `{ event_id }` | S19 |
| `INVENTORY_ENTRY_REVERSED` | 409 | `{ event_id }` | S19 |

New reason `weigh_required` on `422 CONFIG_REFERENCE_INVALID` (S4); new reason `not_own_entry` on `403 PERMISSION_DENIED` (S19). `BUSINESS_DAY_NOT_OPEN` keeps its meaning (moves only). Appended to F §6.2 and `@pos/domain/src/errors.ts` (row F-3).

---

## §10. Tests

### 10.1 Pure (`packages/domain/src/inventory/{mwa,sheet}.test.ts`)

| # | Case |
|---|---|
| 1 | MWA: first priced receipt; weighted second; `on_hand ≤ 0` → landed; unpriced → avg unchanged; **one** `divRound` per update; max values (qty 10⁹, price 10¹⁰) stay exact as strings; packets never get an `avg` (m-3) |
| 2 | S7 via `stepItemCost`: anchor = latest non-null raw count **by business day**; later days' moves added; anchor day's moves after the count added; null count never anchors; late count (next morning) and recount re-anchor; no anchor → all moves; `pending` pruned on re-anchor |
| 2b | ⚠️ v0.3 M-4: one history with a late count, a recount, a reversed receipt and a replacement: `foldItemCost` over it = live steps (without the reversed event, replayed) = a rebuild — equal `avg_micro`, `on_hand`, `max_seen`; ⚠️ v0.4 N-1: a **priced replacement on day D written after D's count** gives the same `avg_micro`, `on_hand`, `max_seen` as the history without the typo (the replacement sits at the original's `order_seq`) |
| 3 | S3 conversion: 18.5 kg (185/10) → 18 500 g; 1.5 darjan → 18 pieces; 1/3 kg → 333 g; count 0 → 0 |
| 4 | `divRound`: 2.5 → 3, −2.5 → −3, −2.4 → −2 |
| 5 | Sheet formulas S13: actual, theoretical (sold + comp + void_waste + staff_meal), variance qty / bp / value; baseline; cooked equivalents through a stub `explodeStockItem` (paye + ghee from one PAYE-COOKED count; rice + ghee from biryani plates); one `divRound` per item |
| 6 | Flags: sign; both thresholds; theoretical 0 with a loss → pct passes; no cost → `no_cost`, `variance_flag` null; every reason incl. `usage_partial`, `sales_after_count`; `flag` = `unreliable` when any reason, detail keeps `variance_flag` |
| 7 | Period: previous sheet → one day; skipped closed day → two days, `chain_broken`; 8 days → baseline (m-10); period coverage revenue-weighted, 0-revenue day weight 0 |

### 10.2 Hub commands (`apps/hub/test/inventory/*.int.test.ts`) — every §3.3 error a command can return, and a retransmit, per command (F §6.7)

| # | Case |
|---|---|
| 8 | `ReceiveGoods` happy path: event (with `business_day_id` + label), moves, cost; statements 2 + 1 + 1 + 2 × lines |
| 9 | `ReceiveGoods` each error: not configured (no key; `buildCostInputs` returns no items — ⚠️ v0.4 N-3); **one malformed price row in the key → the other items still receive, the dropped item's line `404`, day view `dropped: 1`**; not found, not tracked, not convertible, weigh required, piece count missing / not allowed, large quantity (and accepted with `confirm_large`), no open day, duplicate item line; retransmit → one event |
| 10 | `ReceiveTransfer`: packet menu cost frozen with source `menu`, no MWA; packet without price → null; ingredient → `not_packet`; each error; retransmit |
| 11 | `RecordWaste`: raw freezes cost + source; cooked freezes none; cooked guard vs the cooked item's largest count; cooked on an A-item → `not_cooked_item`; raw on PAYE-COOKED → `not_a_item`; `other` needs note; statements 2 + 1 + 3; each error; retransmit |
| 12 | `RecordCount`: null vs 0; recount supersedes; raw A-item and cooked item counts (pieces; plates); closing raw count re-anchors S7; day set frozen at the first count; count guard; each error (`has_sheet` for a store keeper, `later_sheet`, `unknown` day); retransmit |
| 13 | `RecordCount` for last night's closed day after this morning's open → accepted; two days with **one `business_date`** → two separate count sets; manager recount on the latest sheeted day → `out_of_date` |
| 14 | `ReverseInventoryEntry`: own receipt reversed with replacement on yesterday after today's open → yesterday's `received` = 18 500 g, today unaffected, `avg` / `on_hand` / `max_seen` equal a history without the typo (M-2, M-4; ⚠️ v0.4 N-1: holds by construction, the replacement takes the original's `order_seq`), and yesterday's close shows **no** "after count" row; ⚠️ v0.4 n-2: a store keeper reversing someone else's entry on a sheeted day → `403 not_own_entry` (narrowing before the day rule); someone else's entry by a store keeper → `403 not_own_entry`, by a manager → accepted; waste reversed; count / sheet ids → `404`; day with sheet → `409 has_sheet` (store keeper) / out of date (manager, latest sheet); second time → `409 INVENTORY_ENTRY_REVERSED`; without `reverse-inventory-entry` → `403` before any read; replacement of the wrong shape → `400`; retransmit; statement count |
| 15 | Day view: 6 statements; default day rules; `todays_cost` source labels; `moves_after_count`; counted by; `piece_count`; `ignored_ticked`; `my_entries.reversible`; no engine read |
| 16 | `CloseDailySheet` (08c stub): day open → `not_closed`; yesterday after today's open → closes; D−2 after D−1 sheet → `later_sheet`; missing raw or cooked count → `409`; item ticked after the first count not required; moves after count → `409`, confirm → reason; `sales_after_count` with quantity from the stub's `sold_after_count`; `usage_partial`; baseline; chain broken; settings and required set frozen; `staff_meal` column; each error; retransmit |
| 17 | Correction: manager recount after the sheet → out of date → close with `supersedes` + note → new closing, **original** `unit_cost_micro` (`cost_from: 'superseded'`), history 2; wrong `supersedes` → `409 INVENTORY_SHEET_CLOSED` (O-10, M-3) |
| 18 | Two business days with one `business_date` → two sheets, two stream ids |
| 19 | Permissions: each command refused without its key; reversal: own entry with `reverse-inventory-entry` only, another's entry needs `close-daily-sheet` through `ctx.directory` (an `everyone` device refuses it); store keeper (four keys) cannot close; `close-daily-sheet` refused on an `everyone` device; roles API refuses `requires_approval` for the five (01b) |
| 20 | Report queries: list 1 statement, detail 3 statements, 62-day cap, `404 INVENTORY_SHEET_NOT_FOUND`, detail permission as list |
| 21 | Engine untouched: a full day of 08d commands leaves `EngineState` byte-identical; replay filter excludes `inventory` |
| 22 | Projection group rebuild: one `reset` + catch-up reproduces the six tables exactly, including reversed lines, replacements (`order_seq`), late counts and day sets (same fold as live, test 2b); ⚠️ v0.4 N-2: rebuild **after a tick change** keeps each past day's old required set (from `required_set`) |

### 10.3 Races (`apps/hub/test/inventory/races.int.test.ts`)

| # | Case |
|---|---|
| 23 | Two devices count the same item and day: both events land (single writer); the later `seq` wins; "counted by" shows the later |
| 24 | `CloseDailySheet` vs a late `RecordCount` by a store keeper on the same day: the writer serialises; the count after the sheet → `409 has_sheet` |
| 25 | `ReceiveGoods` vs `CloseBusinessDay`: the receipt commits on the open day or is refused `409 BUSINESS_DAY_NOT_OPEN`; never on a closed day |
| 26 | `ReverseInventoryEntry` vs `CloseDailySheet` for that day: one wins; a reversal after the sheet by a store keeper → `409 has_sheet` |
| 27 | ⚠️ v0.3 m-16: two managers close D−1 and D at once: serialised; if D closes first, D−1 → `409 later_sheet` |
| 28 | ⚠️ v0.3 m-16: reversal of a receipt vs a new receipt of the same item: serialised; final `avg` = `foldItemCost` of the committed history in `seq` order |

### 10.4 Cloud (`apps/cloud/test/inventory/receiving-fields.int.test.ts`)

| # | Case |
|---|---|
| 29 | Stock item PATCH: weigh on a non-`g` item refused (CHECK + `400`); piece count on a packet / piece item refused; both in the version input; `is_a_item` editable on a `prepared` item ("Count daily") |
| 30 | Branch settings via the 01b §6.10 wire: ranges; snapshot `engine_settings` carries them; hub default when absent |
| 31 | Migration on an 08b-era database: defaults false / 300 / 50 000; backfill grants the five keys to Owner + Manager by `default_key`, bumps `directory_version` once per changed tenant; **every branch's `config_version` + 1 once** (M-6); a re-run of the backfill changes nothing |
| 32 | Snapshot `inventory.items[]` carries the two fields; builder statement count unchanged (R-b); after the migration a hub receives the new body (not `not_modified`) |

### 10.5 Events and client

| # | Case |
|---|---|
| 33 | One fixture per event v1 parses; `GoodsReceived.mode` enum is v1-only; `replaces_event_id` / `replacement_event_id` round-trip; ⚠️ v0.4 N-2 / n-3: `CountRecorded.required_set` and `DailySheetClosed.excluded` round-trip |
| 34 | Inventory screen: actions per permission; Undo on own entries (store keeper) and on all (manager); replacement form; paye receive asks kg + pieces; count blank by default with a "0" chip; cooked items in their own unit; local draft survives a sign-out; S18 labels; "Start the day first"; no engine level |
| 35 | Close: missing raw and cooked counts listed; moves-after-count rows; `sales_after_count` text; cooked-leftover prompt; flags and reasons; `staff_meal` column; out-of-date re-close needs a note |
| 36 | Admin report list / detail; values labelled by `unit_cost_source`; corrected sheets say "costs from the first close" |

### 10.6 Acceptance

| Source | Check | Test |
|---|---|---|
| 08-g0 §3.12 daily sheet | receive, transfer, waste, count, close | 8–17 |
| D3 MWA from receipts only | S6, S7 | 1, 2, 2b, 8 |
| §4 not counted ≠ 0; all A-items (and ticked cooked items) to close | S9, S14 | 12, 16 |
| §4 weight + count on paye | S4 | 9 |
| §4 voided prepared food → waste; D12 staff meals = usage | via 08c | 16 (stub) |
| R39 (b) thresholds 3 % AND Rs 500 | S13, S16 | 6, 16, 30 |
| C3 engine never sees inventory | S1, S10 | 21 |
| R39 (c) fallback | close never blocks day close; next-morning close | 13, 16, 25 |
| O-3 / O-8 typo correction, own entry | S19 | 14, 19 |
| O-9 ticked cooked items in their own unit | S2, S10 | 12, 16 |
| O-10 correction keeps costs | S20 | 17 |
| O-11 sales after count | S13 | 16, 35 |

---

## §11. Build order

**08d-1** (after 08a and 08b are merged):
1. Foundation F-1 (`envelope.ts` stream enum) + §9 codes in `errors.ts` — typecheck + schema test.
2. Event schemas `packages/events/src/events/inventory/*.v1.ts` + six fixtures + `TodaysCostWire` — test 33.
3. Pure `packages/domain/src/inventory/{mwa,sheet}.ts` (`divRound`, `stepItemCost`, `foldItemCost`, S13) — tests 1–7, 2b.
4. 01b B-1 permissions (five, allowed-only, defaults) + B-2 settings wire; 05a D-1 screen key + listed-only — tests 19 (part), screens test.
5. Cloud migration (fields, settings, backfill, release bump) + 01c C-1 + 01a A-1 + snapshot fields on 08b's `inventory.items[]` — tests 29–32.
6. Hub migration + projection group (`apps/hub/src/inventory/projections/`) — test 22.
7. `apps/hub/src/inventory/{items,cost}.ts` (S2 sets, day-set freeze, `todaysCost`, S19 guard) — tests 8 (part), 15 (part).
8. Commands `receive-goods`, `receive-transfer`, `record-waste` — tests 8–11, 25.
9. `record-count` — tests 12, 13, 23.
10. `reverse-inventory-entry` (own-entry rule, replacement, recompute) — tests 14, 26, 28.
11. Query `inventory-day` — tests 15, 21.
12. Client Inventory screen (receive / transfer / waste / count / undo) — test 34.

**08d-2** (after 08c is merged):
13. `close-daily-sheet` (first close + correction) with 08c's `theoreticalUsage` — tests 16, 17, 18, 24, 27.
14. Report queries — test 20.
15. Client close + admin report — tests 35, 36.

15 tasks, 6 commands + 3 queries (plus 3 cloud changes): inside the size budget.

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done
- Tests 1–36 and 2b green; no engine test edited; test 21 proves the engine untouched.
- One week on the pilot hub with the paper sheet in parallel (drill 3): system and paper agree on every A-item's actual usage.
- Every §4.5 row applied with markers; 08b's text carries R-b; 08c's carries R-c.

### 12.2 Endpoint checklist

| § | Command / query | Codes |
|---|---|---|
| 6.1 | ReceiveGoods | 200, 400, 403, 404, 409, 422 |
| 6.2 | ReceiveTransfer | 200, 400, 403, 404, 409, 422 |
| 6.3 | RecordWaste | 200, 400, 403, 404, 409, 422 |
| 6.4 | RecordCount | 200, 400, 403, 404, 409, 422 |
| 6.5 | ReverseInventoryEntry | 200, 400, 403, 404, 409, 422 (⚠️ v0.3 m-18: replacement checks) |
| 6.6 | inventory-day | 200, 400, 403, 409 |
| 6.7 | CloseDailySheet | 200, 400, 403, 409 |
| 6.8 | daily-sheets list | 200, 400, 403, 409 |
| 6.9 | daily-sheets detail | 200, 403, 404, 409 |

### 12.3 Open questions

| # | Question | Answer / default |
|---|---|---|
| OQ-1 | MWA `on_hand` rule (S7) | **(a) count-anchored**, by business day, one fold (v0.3) |
| OQ-2 | Cooked items counted on the sheet, engine keeps its own level (S10) | Separate; no engine hint (O-7) |
| OQ-3 | Cooked waste on the sheet does not reduce the engine's pre-cooked level | OK (kitchen uses `SetPrecookedStock`) |
| OQ-4 | Who fills, who closes | Store keeper fills and undoes his own entries; manager closes, undoes any entry, corrects after the sheet (O-8). No default store-keeper role exists: the owner creates it (⚠️ v0.4 n-1, OQ-11) |
| OQ-5 | Final A-item list (paye, beef, ghee, anday, packets) — chanay, atta? | The five |
| OQ-6 | Drill 3 (one paper week) before or in parallel with the first system week? | In parallel |
| OQ-7 | Migration numbers: cloud `0020` after 08b's `0019`, hub `0028` (main has `0027`) | Recheck at build |
| OQ-8 | **Answered (owner 2026-11-23 22:13):** O-1 – O-7 | Applied (v0.2) |
| OQ-9 | **Answered (owner 2026-11-23 23:15–23:45):** O-8 own-entry reversal; O-9 ticked cooked items in their own unit (PAYE-COOKED; biryani / pulao by tick); O-10 corrections keep the original costs; O-11 `sales_after_count` flag with the quantity | Applied (v0.3) |
| OQ-10 | New: should biryani / pulao be ticked for the pilot? Ticking makes their plates a required nightly count; unticked, the ghee in a leftover biryani reads as used (small) | Not ticked (PAYE-COOKED only) until drill 3 shows the count is quick |
| OQ-11 | ⚠️ v0.4 n-1, new: who receives the dawn paye delivery? Whoever records entries should be able to undo **their own** — confirm the rule "a role with `receive-stock`, `record-waste` or `count-inventory` also gets `reverse-inventory-entry` (Undo own entries), ticked together, untickable" | That rule; the owner creates a "Store keeper" role with the four keys; if Cook / Cashier receives deliveries, their role gets `receive-stock` and the Undo key comes with it |

### 12.4 Deferred until needed

| Item | Why not now |
|---|---|
| `default_purchase_unit` | O-7: the device remembers the last unit |
| `opening_seed` | O-5: first sheet is a baseline |
| Engine level beside the cooked count | O-7: defeats a blind count |
| Transfer of raw stock from another branch; `lot_code` | O-7 / m-19: one pilot branch; CK lots are POST |
| `shelf_life_days` | No pilot reader |
| Receipt photos | No hub media store |
| `supplier_delivery`, `cash_purchase`, `night_drop`, blind receiving, landed cost, discrepancies | 08-g0 §5 POST |
| `StockTransferDispatched`, transfer discrepancy, `transfer_out` | Needs 06 sync; no pilot case |
| Count sessions, spot counts, store / kitchen split | POST |
| Non-A-item tracking | R39 (b) |
| Re-pricing a corrected sheet at today's cost | O-10: corrections keep the first close's costs |
| Cloud copy of the sheet / owner-app report | Needs 06 sync; 07 |
| Variance × shift roster | POST |
