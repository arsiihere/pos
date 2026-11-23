# 08a — Inventory & Costing: inventory config — Module Spec v0.5 (DRAFT)

**v0.5 — DRAFT (2026-11-23), fixes the spot check** (`docs/reviews/08a_v0.3_spot_check.md` on v0.3: 7 ✓, 2 ✗ (N-3, N-4); new 0 BLOCKER, 0 MAJOR, 4 MINOR, 2 NIT, P-1 – P-6). Text and tests only; no rule, route, table or count changes. Markers "⚠️ v0.5 (P-n)":
- **P-1** I9 / C-3: a sent draw is checked `not_found`, then `archived` **only when the merged item is active** (01c's `requireActive`, `restaurant/service.ts` reference step), then `wrong_kind`; a POST is always active.
- **P-2** §9 `wrong_kind` row restated by the I9 draw rule.
- **P-3** test 15 (a): archived item PATCH sending a draw onto an ingredient → `wrong_kind`; test 15 (b): ordinary PATCH of an active item over a raw-edited wrong-kind stored draw → `wrong_kind`, nothing written.
- **P-4** test 19b: order A = PATCH holds at `afterStockItemLock`, restore → `422 wrong_kind`; order B = restore holds at `patchMenuItem`'s existing `beforeBump`, PATCH → `409 CONFIG_IN_USE`. The unnamed hook is dropped.
- **P-5** I11 / A-2: "first statement inside the transaction (after the idempotency key, on a POST)"; §11 step 4 wording.
- **P-6** §5.1 FK comments separated.


**v0.4 — DRAFT (2026-11-23), owner answers to §12.3 OQ-1 – OQ-4** (owner, 2026-11-23 19:42 PKT). Markers "⚠️ v0.4 (OQ-n)". One line per item:
- **OQ-1** one file for the whole module: 08b, 08c and 08d are added to **this** file as later versions (each slice its own part, 12 sections, after this one), not as separate `08b_…` files.
- **OQ-2** the owner enters market rates from the owner app until 08d's hub screen (as the v0.3 default).
- **OQ-3** **the owner sets a market rate's validity when he enters it**: body `valid_for_hours` 1 … 720 (30 days), default 24; `valid_until_at = created_at + valid_for_hours × 3 600 000`. Replaces the fixed 24 h (I6, §5.1 CHECK, §6.6, §8.3, tests 4, 33, 40). Manual prices stay open-ended.
- **OQ-4** `price_minor` 0 stays refused (as v0.3).


**v0.3 — DRAFT (2026-11-23), fixes the targeted check** (`docs/reviews/08a_v0.2_targeted_check.md`: 22 ✓, 2 ✗ (m-4, m-6), new findings 0 BLOCKER, 0 MAJOR, 9 MINOR N-1 – N-9). Next: spot check of N-1 – N-9, then owner approval. Each change carries "⚠️ v0.3 (N-n)". One line per item:
- **N-1** §5.3 `is_current` = latest row among those with its name **and** `base_unit` = the item's `stock_unit` (the I5 step 2 set); test 29 adds the g → piece → g case.
- **N-2** `recorded_by` FKs restored (the audit insert's actor FK takes the `owner_users` key-share lock anyway, so dropping them saved nothing); the lock paragraph names that lock. Run 1 m-4 is closed by naming the locks, not by avoiding them.
- **N-3** I9 is the one statement of the draw rule; §3.3, C-3 and C-9 point to it: a **sent** draw is checked on every item POST / PATCH in C4's reference step (`not_found` / `archived`, then `wrong_kind`); a **stored** draw is checked by R9b when the merged item is active and `stock_draws` is not sent, after R9.
- **N-4** test 19b: restore vs kind PATCH as two transactions.
- **N-5** race tests use a test-only hook `afterStockItemLock`, called on the PATCH and on the three POSTs right after their stock-item lock (`beforeBump` does not run on a no-bump PATCH); test 21 moves to §11 step 8.
- **N-6** §6.3: `assertTenantWide` is 01c's first statement inside the transaction on every path (as built, `menu-variants/service.ts` `patchStockItem`); I11 only drops the two bump statements. I11, A-2 and §6.3 Queries reworded (the v0.2 "+1 tenant-wide read when no bump" was wrong).
- **N-7** a `stock_items_active_code` violation maps to `409 CONFIG_NAME_TAKEN { entity: 'stock_item_code' }` (constraint-name map, as the name index); on a restore or two concurrent POSTs either `409` may answer; test 8 adds the restore case.
- **N-8** test 3 values in minor units: 30/1 per g, 10 000/3 per piece.
- **N-9** v0.2 changelog: M-4 tests are 2, 28.

**v0.2 — DRAFT (2026-11-23), fixes hostile review run 1** (`docs/reviews/08a_v0.1_hostile_run1.md`: 0 BLOCKER, 8 MAJOR, 16 MINOR; resolution table at the end of that file). Next: a **targeted check** of the rows below, not a full run 2. Each change carries "⚠️ v0.2 (M-n / m-n / cut-n)". One line per item:
- **M-1** C-9 (new): 01c §6.5 checks the **merged** draw's stock item is `prepared` on every PATCH whose merged item is active (restore included); test 19.
- **M-2** C-10 (new), §8.6: the menu item form's draw picker asks `kind=prepared`; test 37.
- **M-3** §6.4 runs the §6.1 candidate read for `menu_cost` (7 statements); test 30.
- **M-4** I4 / I5: an item unit may carry a built-in's name when that built-in's base is not the item's stock unit (`l` on ghee in g, `kg` on a piece item); item units resolve before built-ins; tests 2, 28 (⚠️ v0.3 N-9: was "2, 24").
- **M-5** I10: P1 has one owner covering every branch (01b B8 / M8); every 08a write is tenant-wide; `branch_id` on a price is the price's scope, not the writer's.
- **M-6** I6: `branch_id` only with `kind = 'market_rate'` (it expires by itself); branch manual prices → §12.4.
- **M-7** §4.5: rows C-9, C-10; C-5 names 01c test #35 (4 → 5 statements); A-2 targets 01a S8, S26 and the §6 common write script; test 23 / DoD say "except #35".
- **M-8** §10.3 tests 20–22: the three POSTs against the PATCH they serialise with.
- **m-1** `display_per.minor` a decimal string; an exact value above 0 never shows as Rs 0 (`below_one_minor`). **m-2** scripts "validate → `BEGIN` → key → tenant-wide read → …" with exact statement counts. **m-3** a body `branch_id` is a C1 reference (`422 not_found`), not C2. **m-4** the `branches` key-share lock named (⚠️ v0.3 N-2: the `recorded_by` FKs are back; the `owner_users` lock is named instead). **m-5** paye edge row rewritten. **m-6** unit / price rows of an old stock unit come back if the unit changes back — stated as intended (I5). **m-7** one time column: `created_at` + `valid_until_at`. **m-8** moot (the two booleans move to 08d). **m-9** `stock_items_kind` index dropped. **m-10** `StockItemWire` extended in place in `admin/menu-variants.ts`. **m-11** `inventory/conversions.ts`, `Unit` imported from `../units`. **m-12** BIGINT columns → `BigInt(string)`, never `Number()`. **m-13** code clash read before the write: code `409` before name `409`. **m-14** `400` on §6.1, §6.4. **m-15** yield test quantities in the item's stock unit. **m-16** README marker text aligned at approval.
- **Pilot cuts adopted** (review "Over-engineering" 1–4): cut-1 no branch-scoped writer path; cut-2 = M-6; cut-3 `shelf_life_days`, `default_purchase_unit`, `must_weigh_on_receipt`, `track_piece_count` move to **08d** with their consumer (R6, R7's piece rule, two CHECKs, tests gone); cut-4 no `stock_items_kind` index, no single-value `yield_profiles.source`, one time column. 14 → 11 build tasks.

**v0.1 — DRAFT (2026-11-23)**, kept as history.

This file holds **slice 08a**; 08b (recipes + cost engine), 08c (sale cost + comp / void outcome) and 08d (A-item daily sheet) are added to this same file as later versions (⚠️ v0.4 OQ-1).

---

## §1. Header

| Field | Value |
|---|---|
| Module | 08a Inventory config: ingredients and packets as stock items with a `kind`, three inventory fields, item units (purchase units, the paye piece weight, per-litre ghee), the price list ("menu cost": manual and market-rate prices with history), yield profiles. Cloud and owner app only |
| Version | **v0.5 — DRAFT** (2026-11-23, spot check fixed). v0.4 — DRAFT (owner answers OQ-1 – OQ-4). v0.3 — DRAFT (targeted check fixed). v0.2 — DRAFT (run 1 fixed). v0.1 — DRAFT |
| Depends on | Foundation v1.15 (APPROVED); 00 Hub Platform & Access v1.12.3 (owner auth, tenant guard); 01a Restaurant Setup v2.7.5 (`config_audit`, `withIdempotency`, S7, S8, S26, common write script, C1 / C2); 01b Staff and Roles v1.10.3 (B8: one owner per tenant in P1); 01c Menu Variants v1.1.4 (`stock_items`, `stock_item_branches`, `stock_draws`, versioned writes, snapshot `stock_items[]`) |
| Inherits | **Shared Standards from Foundation v1.15 §6**, unchanged. Carried conventions C1–C9 (README). 08a extends 01c's stock-item routes, so 01c's behaviour is the default where this spec is silent |
| Changes other specs | 01c → v1.2 (rows C-1 – C-10), 01a → v2.8 (rows A-1, A-2), README (R39, module map, Milestone A). 01b, 03a / engine, foundation: **no change in 08a** (§4.5 says why). Full list: §4.5 |
| Tier | T2 Production (foundation §1) |
| Milestone | A (pilot), by README R39. Slice order 08a → 08b → 08c → 08d |
| Inputs | `docs/stories/08-g0.md` §0, §1 (D3, D7, D8, D9), §2, §3.1–§3.6, §4; README R18, R26, R28, R29, R30, R39, C1–C9; 01b B8, M8; 01c V3–V5, V13, §3.3, §4.6, §5.4, §6 lock order, §6.4–§6.9, §8; review run 1; code `apps/cloud/src/modules/menu-variants/`, `apps/cloud/src/modules/restaurant/` (item writes), `apps/cloud/src/modules/config-sync/builder.ts`, `apps/cloud/src/lib/config-version.ts`, `packages/events/src/admin/menu-variants.ts`, `packages/domain/src/units.ts`, `apps/client/src/features/owner/{stock-items,menu}/` |

### Stories covered

| Source (08-g0) | Item | How |
|---|---|---|
| §2 PILOT "Units & conversions (global + item-specific, versioned)" | Seed globals kg↔g, pao, maund, darjan; item-specific paye piece ≈ X g; versioned; on-hand never recomputed | Built-in units are constants (I3); item units are append-only versions (I4) |
| §2 PILOT "Item master" | raw / packet / produced; `cost_category`, `is_a_item`, code | `stock_items.kind` + three fields (I1, I2). The receiving fields (`must_weigh_on_receipt`, `track_piece_count`, `shelf_life_days`, purchase unit) come with 08d, their first reader (⚠️ v0.2 cut-3) |
| §2 PILOT "PriceObserved (manual, market_rate)" | Price history only; every write with user + note | Price list rows, append-only, `config_audit` (I6, I7) |
| §2 PILOT "Yield profiles (manual test cut, versioned)" | One active profile per item; test AP / EP | `yield_profiles`, append-only; yield in basis points (I8) |
| §4 rules | Item create / edit = MGR+; every price change audited with user + note; missing price → never 0 | Owner-app writes (I10); `config_audit` + `recorded_by` + `note`; no price row = no price (I7) |
| §7 drill 1 (paye yield test) | Record the test cut's AP / EP and the g per piece | Yield POST with `test_ap_qty` / `test_ep_qty`; item unit `piece` on raw paye |
| Roadmap I3, I17 (part) | Purchase / stock / recipe units; price history per ingredient | I4, I6 |

### In scope
- Cloud: `stock_items.kind`, `code`, `cost_category`, `is_a_item`; item units; price list; yield profiles; changed 01c stock-item routes (§6.6–§6.9), a changed 01c item-write rule (C-9), four new routes. Migration `0018_inventory_config.sql`.
- The snapshot builder lists only `kind = 'prepared'` stock items (01c §4.6 rule 4, defence in depth; I9).
- Pure functions in `@pos/domain` (`inventory/`): built-in units, unit resolution, price per stock unit, effective menu price, yield from a test cut. 08b–08d call them.
- Owner app: stock items list by kind, item form with the new fields, item page with Units, Menu cost and Yield sections; the menu item form's draw picker lists prepared items only.

### Out of scope
- Recipes, cost engine, plate cost, coverage %, `require_recipe_for_menu`, `visibility_scope` / `ck_only` → **08b**.
- Any snapshot key for inventory data (items, units, prices, yields) → **08b** (first hub consumer). 08a changes nothing a hub receives.
- Sale cost, `OrderCosted`, comp kinds, theoretical usage → **08c**.
- `inventory` stream type (foundation bump), receiving and its item fields (`must_weigh_on_receipt`, `track_piece_count`, `shelf_life_days`, `default_purchase_unit`), waste, counts, MWA ("today's cost"), daily sheet, hub permissions → **08d** (⚠️ v0.2 cut-3).
- Branch-specific manual prices, a second (branch-scoped) owner user, suppliers, quotes, `supplier_id` on prices or yields, price-jump alerts, tenant-defined global units, retiring a unit → §12.4.

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Cloud config is relational and canonical; owner routes under `/v1/admin`, JWT + tenant guard; creating `POST`s through `withIdempotency` with the key inserted first inside the transaction (S7); `writeConfigAudit` insert-only | F §3.3, §6.4; 01a S7, S8, S26 |
| Tenant-level writes need an owner covering every branch: `coversEveryBranch` reads the owner row inside the write's transaction (`403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`, S8, `lib/config-version.ts`) | 01a S8 |
| **P1 has one owner per tenant, covering every branch**; a second owner login is deferred | 01b B8, M8 |
| Stock items: `stock_unit ∈ piece, g, ml`; name unique among active stock items (all kinds); versioned PATCH (`expected_version`, `409 CONFIG_STALE`); one version builder (`menu-variants/versions.ts`) | 01c V3, V13, §5.4 |
| Pre-cooked stock is engine-owned: `EngineState.stock` folds only the snapshot's `stock_items[]` (rows with a `stock_item_branches` row); `stock_draws` reserve from them; the builder drops a draw onto an uncounted stock item | 01c V4, V5, V12, §4.6; F §3.1 D50 |
| Money is integer minor units, quantities integers in the smallest unit; BigInt inside calculations; no floats or decimal strings in storage | F §4.1 D47; 01a S44 |
| Snapshot schema 4; additive optional keys only within a version | 01a S28, R29 |
| Lock order of 01c §6 (kinds 1–10, `stock_items` = 5, `branches` = 10 last) | 01c §6 |

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Reason | Overrides / changes |
|---|---|---|---|
| I1 | **Ingredients and packets are stock items with a `kind`** (owner ruling C2 (a), R28). `stock_items.kind ∈ prepared \| ingredient \| packet`, default `prepared`; every existing row becomes `prepared`. `prepared` = 01c's pre-cooked pool (PAYE-COOKED, karahi pot); `ingredient` = purchased raw item (beef, paye, ghee, onion); `packet` = coded CK output used at branches (TP-1, QM-1, PY-1). 08-g0's `produced` item is a `prepared` stock item (paye cooked at the branch, owner ruling on OQ3); `purchased_prepared` is not in the pilot (§12.4) | One table, one name space, R28 as approved; PAYE-COOKED already exists as a prepared row | 01c V3 ("the inventory module adds `kind`") — fulfilled |
| I2 | **Three inventory fields on every stock item:** `code` (null or 1–16 of `A–Z 0–9 -` after trim + uppercase, unique among active), `cost_category ∈ food \| packaging \| cleaning \| beverage` (default `food`), `is_a_item` (default false). `packet` ⇒ `stock_unit = 'g'` (08-g0 §0). `carries_over` ⇒ `kind = prepared` (it has no meaning off the engine). ⚠️ v0.2 cut-3: `must_weigh_on_receipt`, `track_piece_count`, `shelf_life_days`, `default_purchase_unit` are 08d's | 08-g0 §3.2; 08b / 08c / 08d lists read these three; the others have no reader before 08d | 08-g0 `purchase_pack_qty` dropped: the pack size is an item unit ("1 peti = 12 kg", I4) |
| I3 | **Built-in units are constants, not data** (`@pos/domain` `BUILTIN_UNITS`): `kg` = 1 000 g, `pao` = 250 g, `maund` = 40 000 g, `l` = 1 000 ml, `darjan` = 12 piece. Names case-insensitive, stored lowercase. They are physical or trade facts, the same for every tenant: no seed, no table, no 00 CLI change. `tray` is **not** built in (24 or 30 by supplier): it is an item unit on Anday | 08-g0 §3.1 seed list; R18 covers settings that differ by restaurant, these do not | 08-g0 §3.1 "seed globals" as rows → constants; tenant-defined global units deferred (§12.4) |
| I4 | **Item units, append-only versions.** A row `stock_item_units { stock_item_id, unit_name, base_unit, factor_num, factor_den }` means "1 `unit_name` = `factor_num / factor_den` `base_unit`", `base_unit` = the item's `stock_unit` at write time. A newer row for the same `(stock_item_id, unit_name)` supersedes the older (latest `created_at`, then id); rows are never updated or deleted. `unit_name`: 1–20 chars, trimmed, lowercase, `[a-z0-9 ._-]`; **not the item's own `stock_unit`**; **not a built-in whose base is the item's `stock_unit`** (that built-in already resolves). ⚠️ v0.2 M-4: a built-in name whose base differs **is** allowed — `l` on ghee stocked in g (1 l = 920 g), `kg` on a piece item bought by weight (1 kg = 5 / 7 piece); `piece` on a g / ml item (paye: 1 piece = 182.5 g → 365 / 2), `g` / `ml` on a piece item. `factor_num` 1 … 1 000 000 000, `factor_den` 1 … 1 000 000, stored reduced by their gcd. **On-hand stock and stored prices are never recomputed** when a unit changes (08-g0 §3.1) | Exact ratios with integers (owner ruling C4 (a)); per-litre ghee and per-kg pricing of piece items without paisa loss | 08-g0 `UnitConversionDefined` event → config rows (C7 (a): config is cloud-canonical) |
| I5 | **Resolving a unit for an item** (`resolveUnit(item, unitName, itemUnits)`), direct only, no chains, in this order (⚠️ v0.2 M-4): (1) `unitName = item.stock_unit` → 1/1; (2) the item's latest item unit with that name **whose `base_unit` = the item's current `stock_unit`**; (3) a built-in whose base = the item's `stock_unit`; else not convertible. Step 2 never collides with step 3 (I4 refuses that name). A unit row whose `base_unit` is not the item's current `stock_unit` is ignored and shown as "other unit" in history; ⚠️ v0.2 m-6: if the item's `stock_unit` later changes back, those rows (and prices in that unit, I7) count again — intended: they were right for that unit, and no row is ever rewritten | One rule for every later slice (08b recipe save, 08d receipt) | — |
| I6 | **Price list ("menu cost").** Append-only rows `item_prices { stock_item_id, branch_id, kind ∈ manual \| market_rate, unit_name, price_minor, stock_qty_num, stock_qty_den, stock_unit, created_at, valid_until_at, note, recorded_by }`. At write the server resolves `unit_name` (I5) and **freezes** the conversion (`stock_qty_num / stock_qty_den` stock units per 1 `unit_name`) and the item's `stock_unit`. `price_minor` 1 … 1 000 000 000 (0 refused: a free item is not a price, D9). A price takes effect at `created_at` (no backdating; restatement is POST, §12.4). `manual`: `valid_until_at` null, `branch_id` **must be null** (⚠️ v0.2 M-6: a branch manual price could never be removed; one pilot branch needs none). `market_rate`: the owner sets its validity when he enters it (⚠️ v0.4 OQ-3): `valid_for_hours` 1 … 720, default 24, `valid_until_at = created_at + valid_for_hours × 3 600 000` (08-g0 §3.4 said "today only"; the owner chose an entered validity); `branch_id` null (tenant mandi rate) or one branch. Price per stock unit = `price_minor × stock_qty_den / stock_qty_num` minor units, a fraction, never rounded or stored. ⚠️ v0.2 m-12: BIGINT columns reach the service as strings and are read with `BigInt(string)`, never `Number()` (01c §5.4's canonicalisation helper is not used for prices) | Owner ruling C7 (a): plate cost in the owner app from day one; a frozen conversion keeps old prices meaningful when a unit is corrected | 08-g0 `PriceObserved` event (manual, market_rate) → config rows; `price_per_stock_unit NUMERIC(14,4)` → a fraction (C4 (a)); ⚠️ v0.2 m-7: `valid_from` / `valid_to` → `created_at` / `valid_until_at` (F §6.6 `_at`) |
| I7 | **Effective menu price** (`effectiveMenuPrice(rows, branchId, nowMs, stockUnit)`, pure): candidates are rows with `stock_unit` = the item's current `stock_unit`, `created_at ≤ now` and (`valid_until_at` null or `now < valid_until_at`). If any candidate has `branch_id = branchId`, choose among those; else among `branch_id` null. Within the chosen set the latest wins: `created_at` desc, then `price_id` desc. Kind does not rank: a newer market rate beats an older manual price and the reverse (08-g0 §3.5 step 2). A branch market rate expires at its `valid_until_at` and the branch falls back to the every-branch set by itself. No candidate → `null` (**no price**; 08b marks the cost `partial`, D9; never 0) | 08-g0 §3.5 step 2, D9 | — |
| I8 | **Yield profiles, append-only.** `yield_profiles { stock_item_id, yield_bp, test_ap_qty, test_ep_qty, test_unit, note, recorded_by }`; `yield_bp` 1 … 50 000 (0.01 % … 500 %, D8 `0 < y ≤ 5`). Sent either as `yield_bp` or as both test quantities in the item's `stock_unit` (1 … 1 000 000 000), then `yield_bp = round_half_up(ep × 10 000 / ap)`, refused (`400`) outside 1 … 50 000. The active profile is the latest row. The source is always a manual test in the pilot (no column, ⚠️ v0.2 cut-4; 08-g0's `batch_avg` is POST and adds it). **Ingredient only** (`422 wrong_kind`): a packet is already edible, a prepared item's yield is its batch recipe (08b) | Owner ruling C4 (a): `yield_bp`; drill 1 records the test cut | 08-g0 `yield` fraction → basis points |
| I9 | **Only `prepared` stock items reach the engine.** A `stock_item_branches` row (counted at a station) may point only at a `prepared` stock item (`422 wrong_kind`, C-4). **Draw rule (⚠️ v0.3 N-3, the one statement C-3, C-9 and §3.3 use):** a **sent** draw (`stock_draws` in the body of any item POST or PATCH, active or archived item) must be `prepared`, checked in C4's reference step with the existing `FOR SHARE` read: `not_found`, then `archived` **only when the merged item is active** (01c's `requireActive`; an archived item may keep a draw onto an archived stock item until R9 at its restore), then `wrong_kind` (⚠️ v0.5 P-1); a **stored** draw is checked by R9b when the merged item is active and `stock_draws` is not sent (a restore, or an ordinary PATCH over raw-edited data), after R9 (`archived` first, then `wrong_kind`). Both answer `422 { field: 'stock_draws.0.stock_item_id', reason: 'wrong_kind' }` (⚠️ v0.2 M-1). Changing `kind` away from `prepared` is refused while the item has a `stock_item_branches` row or an active drawer (`409 CONFIG_IN_USE`); an archived drawer does not block it, and is then caught at its restore. The builder also filters `kind = 'prepared'`. So `EngineState.stock`, the hub stock page and 02b's reservations never see an ingredient or packet, and **no engine or hub code changes** | Owner ruling C3 (a): the engine never sees inventory stock; an invariant at the write plus a builder filter is cheaper and safer than filters in engine code | 01c §6.4, §6.5, §6.8, §6.9, §4.6 rule 4 (rows C-3 – C-6, C-9) |
| I10 | **Who may write** (⚠️ v0.2 M-5, cut-1). P1 has one owner covering every branch (01b B8), so **every 08a write is a tenant-level write**: `assertTenantWide` inside the transaction (S8's check, without the bump). A price's `branch_id` is the price's scope, not the writer's. 08-g0's "MGR+" is met by the owner alone in the pilot; managers enter nothing in the cloud. Hub permissions are 08d's | Reuses 00 / 01a guards; no user the pilot cannot have | — |
| I11 | **Inventory-only writes do not bump `config_version`.** Item units, prices, yields, and a stock-item PATCH that changes only fields absent from every snapshot (`kind`, `code`, `cost_category`, `is_a_item`) write and audit but do not bump: no hub reads them in 08a, so a bump would make every hub append `BranchConfigApplied` and refetch an identical snapshot (market rates are daily). A stock-item PATCH that changes `name`, `stock_unit`, `carries_over` or `archived` bumps every branch as 01c §6.8 does. ⚠️ v0.3 N-6: the tenant-wide check is unchanged: 01c's writes already run `assertTenantWide` as their first statement inside the transaction (after the idempotency key, on a POST; ⚠️ v0.5 P-5) and then `bumpEveryBranch` without a second read (`lib/config-version.ts`); a no-bump write keeps the first and drops the two bump statements; the three new POSTs do the same. **08b changes this rule** when it adds the inventory snapshot key | Avoids pointless hub refetch; keeps the bump tied to snapshot content | 01a S8, S26 and the §6 common write script; 01c §6.8 (rows A-2, C-5) |
| I12 | **"Menu cost" vs "today's cost" (owner ruling C7).** Everything 08a stores and shows is **menu cost**: the configured price of I7. "Today's cost" is reserved for the hub's moving weighted average from receipts (08d) and is never shown in 08a. Owner-app labels: section **"Menu cost"**, help line "Price you set. Today's cost from deliveries is on the hub (coming)". Neither label is used for the other value anywhere in 08a–08d | Two price sources must never be confused | — |
| I13 | **Versioned stock-item writes keep 01c V13**; the version input (01c §5.4) gains `kind`, `code`, `cost_category`, `is_a_item`. Units, prices and yields are append-only and need no version: two concurrent writes both land and the latest wins by I4 / I7 / I8 | A lost update is impossible on an append | 01c §5.4 (row C-7) |
| I14 | **Names** (⚠️ v0.2 m-8). `is_a_item` follows F §6.6; `carries_over` keeps 01c's name | — | — |

### 3.2 Kinds and fields

| Field | prepared | ingredient | packet |
|---|---|---|---|
| `stock_unit` | piece / g / ml | piece / g / ml | **g only** |
| Branch row (counted at a station), drawer of an active menu item | yes (01c) | **no** (I9) | **no** (I9) |
| `carries_over` | 01c meaning | false only (`400`) | false only (`400`) |
| `code`, `cost_category`, `is_a_item`, item units, prices | yes | yes | yes |
| Yield profile | no | **yes** | no |

### 3.3 Validation rules (cloud, beyond 01c §3.3)

| Rule | Error |
|---|---|
| `kind ∈ prepared, ingredient, packet` | `400` |
| `code` null or `^[A-Z0-9-]{1,16}$` after trim + uppercase; unique among active stock items (one read before the write when `code` is sent, ⚠️ v0.2 m-13; the `stock_items_active_code` index is the backstop and maps to the same `409` by constraint name, as the name index does, ⚠️ v0.3 N-7: on a restore or two concurrent POSTs, where only the indexes answer, either `409` may come first) | `400` / `409 CONFIG_NAME_TAKEN { entity: 'stock_item_code' }` |
| `cost_category` in its list | `400` |
| Merged row: `kind = packet` ⇒ `stock_unit = 'g'` | `422 CONFIG_REFERENCE_INVALID { field: 'stock_unit', reason: 'packet_unit' }` |
| Merged row: `carries_over` ⇒ `kind = prepared` | `400` |
| `kind` away from `prepared` while a `stock_item_branches` row or an active drawer exists | `409 CONFIG_IN_USE { used_by: { entity: 'stock_item_branch' \| 'menu_item', ids } }` (branch rows reported first) |
| Branch-row set onto a non-prepared item | `422 { field: 'stock_item_id', reason: 'wrong_kind' }` |
| Item draw onto a non-prepared item, by the I9 draw rule (sent: any item; stored: merged-active item) | `422 { field: 'stock_draws.0.stock_item_id', reason: 'wrong_kind' }` |
| Item unit: name rules I4; num / den ranges | `400` |
| Item unit / price / yield on an archived item | `422 { field: 'stock_item_id', reason: 'archived' }` |
| Price `unit_name` not resolvable (I5) | `422 { field: 'unit_name', reason: 'not_convertible' }` |
| Price `kind = 'manual'` with `branch_id` not null | `400` (⚠️ v0.2 M-6) |
| Price `valid_for_hours`: market rate only, 1 … 720, default 24 | `400` (⚠️ v0.4 OQ-3) |
| Price `branch_id` unknown or another tenant's (a body reference, C1; ⚠️ v0.2 m-3) | `422 { field: 'branch_id', reason: 'not_found' }` |
| Yield on a non-ingredient | `422 { field: 'stock_item_id', reason: 'wrong_kind' }` |
| Yield body: exactly one of `yield_bp` or (`test_ap_qty` and `test_ep_qty`); computed or sent value in 1 … 50 000 | `400` |
| `note` ≤ 200 chars, trimmed, empty → null | `400` |

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 00 | owner JWT, tenant guard, password guard |
| 01a | `withIdempotency`, `writeConfigAudit`, `assertTenantWide`, `coversEveryBranch`, `bumpEveryBranch`, the common write script |
| 01c | `stock_items` routes and service (`apps/cloud/src/modules/menu-variants/`), item draw checks (`apps/cloud/src/modules/restaurant/`), `versions.ts`, the builder's stock-items query, owner-app stock-items and item-form views |

### 4.2 Exposes (later slices rely only on these)

| Export | Shape | Used by |
|---|---|---|
| `@pos/domain` `inventory/conversions.ts` (⚠️ v0.2 m-11; `Unit` from `../units`) | `BUILTIN_UNITS: Readonly<Record<'kg'\|'pao'\|'maund'\|'l'\|'darjan', { base: Unit, num: bigint, den: bigint }>>`; `normaliseUnitName(s) → string`; `resolveUnit(item: { stock_unit: Unit }, unitName, itemUnits: ItemUnitRow[]) → { num: bigint, den: bigint } \| null` (I5); `toStockUnits(qty: bigint, conv) → { num: bigint, den: bigint }` | 08b recipe save, 08d receipt |
| `@pos/domain` `inventory/prices.ts` | `pricePerStockUnit(row) → { num: bigint, den: bigint }` (minor units per stock unit, I6; row values as `bigint`); `effectiveMenuPrice(rows, branchId, nowMs, stockUnit) → PriceRow \| null` (I7) | 08b, 08c |
| `@pos/domain` `inventory/yield.ts` | `yieldBpFromTest(ap: number, ep: number) → number` (I8, half up); `activeYield(rows) → YieldRow \| null` | 08b |
| `@pos/events` | `StockItemWire` extended **in place** in `admin/menu-variants.ts` (⚠️ v0.2 m-10); new `ItemUnitWire`, `ItemPriceWire`, `MenuCostWire`, `YieldProfileWire` and the §6 bodies in `admin/inventory.ts` | owner app, 08b |
| Invariant | A snapshot `stock_items[]` entry is always `kind = prepared`; an active menu item's draw points only at a prepared stock item (I9) | 03a engine, 02b, hub stock page, 08b |
| `config_audit` entities | `stock_item_unit`, `item_price`, `yield_profile` (action `create`) | 06, 07 |

### 4.3 Requirements carried to later slices

| To | Requirement |
|---|---|
| 08b | Adds the inventory snapshot key (items by kind, current item units, effective-price inputs, active yields; `ck_only` filtering) and with it the bump rule for inventory writes (replaces I11). Recipe-line convertibility uses `resolveUnit`. Missing price (`effectiveMenuPrice` null) or yield → `partial`. Adds `visibility_scope` |
| 08c | Hub cost uses `effectiveMenuPrice` until 08d's MWA exists for the item |
| 08d | Adds `must_weigh_on_receipt`, `track_piece_count`, `shelf_life_days` (if still wanted), `default_purchase_unit` (with its `resolveUnit` rule) to `stock_items`; MWA = "today's cost" (I12); hub permissions (01b bump); the `inventory` stream (foundation bump) |

### 4.4 Story → slice map (08-g0 §2 PILOT)

08a: units, item master (kind, code, cost category, A-item), PriceObserved (manual, market_rate), yield profiles. 08b: recipes, cost engine, plate cost, `require_recipe_for_menu`. 08c: `SaleCompleted` cost snapshot (as `OrderCosted`), void / comp food outcome, theoretical food cost report. 08d: receiving fields, locations (implicit), A-item daily sheet. Deal cost range and suggested price: POST (R39).

### 4.5 Changes to other specs (R26)

Applied when 08a is approved, each target bumped with a changelog and "⚠️ Changed by 08a v1.0 (row X)" markers.

| Row | Target → version, section | Change | Why |
|---|---|---|---|
| C-1 | 01c → **v1.2** §3.1 V3 | `stock_items` gains `kind` (prepared / ingredient / packet), `code`, `cost_category`, `is_a_item` (08a I1, I2); "(the inventory module adds `kind`)" fulfilled | I1, I2 |
| C-2 | 01c §3.3 | New rows from 08a §3.3 (kind, code, packet unit, carries-over vs kind, kind change, wrong kind) | I2, I9 |
| C-3 | 01c §6.4, §6.5 | The **sent** half of the I9 draw rule: on any item POST / PATCH that sends `stock_draws`, in C4's reference step after `not_found` and, for a merged-active item, `archived` (⚠️ v0.5 P-1): `422 { field: 'stock_draws.0.stock_item_id', reason: 'wrong_kind' }`, read in the existing `FOR SHARE` reference statement (`shareStockItem` returns `kind`); +0 statements | I9 |
| C-4 | 01c §6.9 | A set (`station_id` not null) needs `kind = prepared`: `422 { field: 'stock_item_id', reason: 'wrong_kind' }`, after the `archived` check; a remove is always allowed | I9 |
| C-5 | 01c §6.6, §6.7, §6.8; 01c test **#35** | As 08a §6.1–§6.3: list gains `kind?` and `branch_id?` query, the new wire fields and `menu_cost`, **5 statements (01c test #35: 4 → 5)**; POST and PATCH take the new fields; PATCH merged rules R4 (kind change in use), R5 (packet unit), R6 (carries-over vs kind), R7 (code read); **bump only when `name`, `stock_unit`, `carries_over` or `archived` changes** (I11) | I2, I9, I11 |
| C-6 | 01c §4.6 rule 4 | The builder lists active stock items counted at this branch **and `kind = 'prepared'`** (I9); no schema or statement-count change | I9 |
| C-7 | 01c §5.4 | `StockItemWire` (in place) and its version input gain `kind`, `code`, `cost_category`, `is_a_item`. Every stored stock item's version string changes once at release: an open owner tab gets one `409 CONFIG_STALE` and reloads (accepted) | I13 |
| C-8 | 01c §8, §9 | Owner-app stock items: kind tabs, new form fields, item page (08a §8.1–§8.5); §9 adds reasons `wrong_kind`, `packet_unit`, `not_convertible` and entity `stock_item_code` (08a §9) | I2, I9 |
| C-9 ⚠️ v0.2 M-1 | 01c §6.5 (next to **R9**) | **R9b** (the **stored** half of the I9 draw rule, ⚠️ v0.3 N-3): on an item PATCH whose merged row is active, has a draw, and does **not** send `stock_draws` (a restore, or an ordinary PATCH over raw-edited data), the stored draw's stock item, read under its existing `FOR SHARE` lock, must be `prepared`, else `422 { field: 'stock_draws.0.stock_item_id', reason: 'wrong_kind' }`, nothing written; after R9 (`archived` first, then `wrong_kind`); +0 statements. A sent draw is C-3's | I9 |
| C-10 ⚠️ v0.2 M-2 | 01c §8 (item form) | The menu item form's draw picker calls `GET /v1/admin/stock-items?kind=prepared` (`ItemForm.tsx` `listStockItems`); the archived fallback read for a stored draw keeps `kind=prepared`; a stored draw onto a non-prepared item (impossible after C-9, possible only on raw-edited data) shows its name with the `wrong_kind` text | I9 |
| A-1 | 01a → **v2.8** §5.2 (`config_audit`) | Entity CHECK widens with `stock_item_unit`, `item_price`, `yield_profile` (in `0018_inventory_config.sql`, as 0014 did); actions unchanged | I4, I6, I8 |
| A-2 ⚠️ v0.2 M-7 (d), v0.3 N-6 | 01a §3.1 **S8**, **S26**, §6 common write script | Named exception: 08a's inventory-only writes (I11) end without `bumpConfigVersion`. Their tenant-wide `403` comes from `assertTenantWide` as the first statement inside the transaction (after the idempotency key, on a POST; ⚠️ v0.5 P-5), as 01c's writes already do (S8's check without the bump's locking read); S26's "before `bumpConfigVersion`" no-op rule reads "before the write" for them. Until 08b | I10, I11 |
| R-1 | README | **R39** (08 in Milestone A, slicing, fallback, C1–C12 rulings); module map row **08a**; Milestone A modules + "08a–08d". Markers already carry "⚠️ Changed by 08a v0.1, R39" (R39 is in force as an owner ruling); aligned to "08a v1.0" at approval (⚠️ v0.2 m-16) | owner 2026-11-23 |
| — | 01b | **No change in 08a.** One owner covers every branch (B8); 08a has only owner-app routes (00 / 01a guards). Hub permissions come with 08d's 01b bump | I10 |
| — | 03a / `@pos/engine`, 02b, hub | **No change.** The engine's stock input is the snapshot `stock_items[]`, which can only hold `prepared` items (C-3, C-4, C-6, C-9). Tests #25, #26 pin it | I9 |
| — | Foundation | **No change in 08a.** The `inventory` stream type (owner ruling C3, bump approved) is written in 08d's spec | — |

---

## §5. Data model and migrations

### 5.1 Cloud — `0018_inventory_config.sql` (expand; one transaction)

```sql
-- 08a §5.1: inventory config. Expand only; no config_version bump (no snapshot content changes, I11).
ALTER TABLE stock_items
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'prepared' CHECK (kind IN ('prepared','ingredient','packet')),
  ADD COLUMN code TEXT CHECK (code ~ '^[A-Z0-9-]{1,16}$'),
  ADD COLUMN cost_category TEXT NOT NULL DEFAULT 'food'
    CHECK (cost_category IN ('food','packaging','cleaning','beverage')),
  ADD COLUMN is_a_item BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT stock_items_packet_unit CHECK (kind <> 'packet' OR stock_unit = 'g'),
  ADD CONSTRAINT stock_items_carries_over_kind CHECK (NOT carries_over OR kind = 'prepared');
CREATE UNIQUE INDEX stock_items_active_code ON stock_items (tenant_id, code)
  WHERE archived_at IS NULL AND code IS NOT NULL;                -- §3.3 code read before the write; backstop

CREATE TABLE stock_item_units (                                  -- I4: append-only
  tenant_id TEXT NOT NULL, unit_row_id TEXT NOT NULL,            -- ULID
  stock_item_id TEXT NOT NULL, unit_name TEXT NOT NULL CHECK (unit_name ~ '^[a-z0-9 ._-]{1,20}$'),
  base_unit TEXT NOT NULL CHECK (base_unit IN ('piece','g','ml')),
  CHECK (unit_name <> base_unit),
  factor_num BIGINT NOT NULL CHECK (factor_num BETWEEN 1 AND 1000000000),
  factor_den INT NOT NULL CHECK (factor_den BETWEEN 1 AND 1000000),
  note TEXT CHECK (length(note) <= 200),
  recorded_by TEXT NOT NULL, created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, unit_row_id),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES owner_users (tenant_id, user_id));   -- v0.3 N-2
CREATE INDEX stock_item_units_item ON stock_item_units (tenant_id, stock_item_id, unit_name, created_at DESC);
                                                                 -- I5 latest per name; §6.4 history; §6.6 resolve

CREATE TABLE item_prices (                                       -- I6: append-only
  tenant_id TEXT NOT NULL, price_id TEXT NOT NULL,               -- ULID
  stock_item_id TEXT NOT NULL, branch_id TEXT,                   -- null = every branch
  kind TEXT NOT NULL CHECK (kind IN ('manual','market_rate')),
  CHECK (kind = 'market_rate' OR branch_id IS NULL),             -- M-6: no branch manual price
  unit_name TEXT NOT NULL, price_minor BIGINT NOT NULL CHECK (price_minor BETWEEN 1 AND 1000000000),
  stock_qty_num BIGINT NOT NULL CHECK (stock_qty_num >= 1), stock_qty_den BIGINT NOT NULL CHECK (stock_qty_den >= 1),
  stock_unit TEXT NOT NULL CHECK (stock_unit IN ('piece','g','ml')),   -- frozen at write (I6)
  created_at BIGINT NOT NULL,                                    -- the price takes effect here (I6)
  valid_until_at BIGINT,
  CHECK ((kind = 'manual') = (valid_until_at IS NULL)),
  CHECK (valid_until_at IS NULL OR (valid_until_at > created_at AND valid_until_at <= created_at + 2592000000)),  -- v0.4 OQ-3: 1 h … 30 days
  note TEXT CHECK (length(note) <= 200),
  recorded_by TEXT NOT NULL,
  PRIMARY KEY (tenant_id, price_id),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches,     -- key-share lock on branches at insert (§6 lock order)
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES owner_users (tenant_id, user_id));   -- v0.3 N-2
CREATE INDEX item_prices_item ON item_prices (tenant_id, stock_item_id, created_at DESC);
                                                                 -- §6.1 / §6.4 / §6.6 candidates; §6.4 history page

CREATE TABLE yield_profiles (                                    -- I8: append-only
  tenant_id TEXT NOT NULL, yield_profile_id TEXT NOT NULL,       -- ULID
  stock_item_id TEXT NOT NULL,
  yield_bp INT NOT NULL CHECK (yield_bp BETWEEN 1 AND 50000),
  test_ap_qty BIGINT CHECK (test_ap_qty BETWEEN 1 AND 1000000000),
  test_ep_qty BIGINT CHECK (test_ep_qty BETWEEN 1 AND 1000000000),
  test_unit TEXT CHECK (test_unit IN ('piece','g','ml')),
  CHECK ((test_ap_qty IS NULL) = (test_ep_qty IS NULL) AND (test_ap_qty IS NULL) = (test_unit IS NULL)),
  note TEXT CHECK (length(note) <= 200),
  recorded_by TEXT NOT NULL, created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, yield_profile_id),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES owner_users (tenant_id, user_id));   -- v0.3 N-2
CREATE INDEX yield_profiles_item ON yield_profiles (tenant_id, stock_item_id, created_at DESC);  -- active + history

-- 01a §5.2 config_audit (08a row A-1): entities widen; actions unchanged.
ALTER TABLE config_audit DROP CONSTRAINT config_audit_entity_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_entity_check CHECK (entity IN (
  'floor','table','station','batch_program','tax_class','category','menu_item','item_route','branch_settings',
  'staff','role','responsibility','branch','owner_user',
  'variant_group','stock_item','stock_item_branch','modifier_group','deal','deal_branch',
  'point','zone','billing_settings',
  'stock_item_unit','item_price','yield_profile'));
```

Notes: the entity list is `0014_billing_settings.sql`'s (the last writer; `0015`–`0017` do not touch it) plus three; the build task re-reads the live CHECK from the test DB first (01b D-5). Append-only is enforced by the service (no update / delete statement exists for the three tables) and by test #34; no DB trigger (YAGNI: one writer). `recorded_by` is the owner user id from the verified JWT, with a FK to `owner_users` (⚠️ v0.3 N-2: v0.2 dropped it to avoid a key-share lock, but the same transaction's `config_audit` insert takes that lock through its actor FK (`0002_restaurant_setup.sql:25`), so the drop saved nothing; the FK is kept for integrity). Every existing stock item reads as `prepared`, `food`, not an A-item: no behaviour change for 01c, the engine or any hub (test #27).

### 5.2 Hub

None. No hub migration, no event, no snapshot change.

### 5.3 Wire shapes

- `StockItemWire` (01c, `packages/events/src/admin/menu-variants.ts`, extended in place) + `kind`, `code`, `cost_category`, `is_a_item`. Version input (`apps/cloud/src/modules/menu-variants/versions.ts`) = 01c §5.4 keys + these four (C-7).
- In `packages/events/src/admin/inventory.ts`:
  - `ItemUnitWire { unit_row_id, unit_name, base_unit, factor_num: string, factor_den: number, is_current, note, recorded_by, recorded_by_name, created_at }`; `is_current` = the latest row (`created_at`, then id) **among the rows with its name and `base_unit` = the item's current `stock_unit`** — the I5 step 2 set, so the Units section and `resolveUnit` always agree (⚠️ v0.3 N-1).
  - `ItemPriceWire { price_id, branch_id, kind, unit_name, price_minor: number, stock_qty_num: string, stock_qty_den: string, stock_unit, created_at, valid_until_at, note, recorded_by, recorded_by_name }`.
  - `MenuCostWire { branch_id: string | null, price_id, per_stock_unit: { num: string, den: string }, display_per: { unit: 'kg' | 'l' | 'piece', minor: string, below_one_minor: boolean } }` — BigInt-safe decimal strings. `display_per` = the price of 1 kg / 1 L / 1 piece rounded half up to the minor unit; ⚠️ v0.2 m-1: when the exact value is above 0 and rounds to 0, `minor` is `"1"` and `below_one_minor` is true (shown "< Rs 0.01"), so a real price never reads Rs 0. Display only, never stored or reused in a calculation.
  - `YieldProfileWire { yield_profile_id, yield_bp, test_ap_qty: string | null, test_ep_qty: string | null, test_unit, note, recorded_by, recorded_by_name, created_at }`.
  - `recorded_by_name` = the owner user's `display_name`.

---

## §6. Endpoints

Owner routes: JWT, tenant guard, password guard. Check order C4. Creating `POST`s run through `withIdempotency` (S7: the key insert is the first statement inside the transaction; the response store and the prune are the last two). No cloud route emits an event. Shared failure cases not repeated: `400 VALIDATION_FAILED`, `401 JWT_INVALID`, `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`, `403 PASSWORD_CHANGE_REQUIRED`, `422 IDEMPOTENCY_KEY_MISMATCH`, `503 SERVICE_UNAVAILABLE`. Every route adds its case to `apps/cloud/test/helpers/route-cases.ts` (C7).

**Lock order:** 01c §6 kinds. The three new POSTs lock their stock item `FOR SHARE` (kind 5), so a concurrent stock-item PATCH (`FOR UPDATE`: archive, `stock_unit` or `kind` change) serialises with them, and every rule they check reads the **locked** row. ⚠️ v0.2 m-4: a price insert with a `branch_id` takes the FK's `FOR KEY SHARE` on that `branches` row after kind 5; it waits behind a tenant-wide bump's `FOR UPDATE` on `branches` (S8), with no cycle (both orders are 5 → 10). ⚠️ v0.3 N-2: every insert of these routes, and its `config_audit` row, takes `FOR KEY SHARE` on the actor's `owner_users` row through their FKs, as every 01a / 01c write already does; it conflicts only with a key update or delete of that owner row (none in P1). No bump, so the bump's own kind-10 step is skipped (I11).

#### 6.0 Permission, audit and bump per route

| § | Route | Permission | `config_audit` | Bumps |
|---|---|---|---|---|
| 6.1 | `GET /v1/admin/stock-items` (changed) | owner | — | — |
| 6.2 | `POST /v1/admin/stock-items` (changed) | owner covering every branch | `stock_item` / `create` | every branch (01c §6.7 kept) |
| 6.3 | `PATCH /v1/admin/stock-items/:id` (changed) | same | `stock_item` / `update`, `archive`, `restore` | every branch **only** if `name`, `stock_unit`, `carries_over` or `archived` changed (I11) |
| 6.4 | `GET /v1/admin/stock-items/:id/inventory` | owner | — | — |
| 6.5 | `POST /v1/admin/stock-items/:id/units` | owner covering every branch (`assertTenantWide`) | `stock_item_unit` / `create` | none |
| 6.6 | `POST /v1/admin/stock-items/:id/prices` | same | `item_price` / `create` (`branch_id` on the audit row = the price's) | none |
| 6.7 | `POST /v1/admin/stock-items/:id/yields` | same | `yield_profile` / `create` | none |

### Batch 1 — stock items (changed 01c routes)

#### 6.1 `GET /v1/admin/stock-items` (changed, 01c §6.6)

| | |
|---|---|
| Query | `status?` (01c), `kind?` ∈ `prepared`, `ingredient`, `packet` (absent = all), `branch_id?` (for `menu_cost`; C2 `assertBranchAllowed` before any SQL) |
| Response | 01c's, each item + `kind`, `code`, `cost_category`, `is_a_item`, `menu_cost: MenuCostWire \| null` (I7 for `branch_id`; without it the every-branch set only). Order `lower(name)`, id (C3) |
| Queries | **5 fixed**: 01c's 4 + 1 candidate read for the listed ids (`stock_item_id = ANY`, `created_at ≤ now`, `valid_until_at IS NULL OR valid_until_at > now`, `branch_id IS NULL OR branch_id = $branch`; `item_prices_item`); I7 runs in the service. 01c test #35 changes 4 → 5 (C-5) |
| Errors | `400` (bad `kind`, `status`), `404 BRANCH_NOT_FOUND` |

#### 6.2 `POST /v1/admin/stock-items` (changed, 01c §6.7) (Idempotency-Key)

Body 01c's + `kind?` (default `prepared`), `code?`, `cost_category?`, `is_a_item?`. Script 01c's, plus the §3.3 rules on the body and, when `code` is sent, one code read before the insert. `201 { data: { stock_item } }`. Errors 01c's + `409 CONFIG_NAME_TAKEN { entity: 'stock_item_code' }`, `422 packet_unit`. Queries: 01c's 8 (key, tenant-wide, insert, audit, 2 bump, key response, prune) + 1 code read when `code` is sent.

| Edge | Answer |
|---|---|
| `kind: 'packet'`, `stock_unit: 'piece'` | `422 { field: 'stock_unit', reason: 'packet_unit' }` |
| `carries_over: true`, `kind: 'ingredient'` | `400` |
| `code: 'tp-1'` | stored `TP-1` |
| Code taken by an active item | `409 CONFIG_NAME_TAKEN { entity: 'stock_item_code' }`; taken only by an archived item → `201` |
| Name **and** code taken | `409 { entity: 'stock_item_code' }` (the code read runs before the insert; m-13) |
| Retry with the same key | stored `201` replayed |
| Audit | one `stock_item` / `create`, new fields in `after` |

#### 6.3 `PATCH /v1/admin/stock-items/:stock_item_id` (changed, 01c §6.8)

| | |
|---|---|
| Body | 01c's (`expected_version` + any of `name`, `stock_unit`, `carries_over`, `archived`) + any of `kind`, `code`, `cost_category`, `is_a_item` |
| Script | 01c's (as built): validate → `BEGIN` → `assertTenantWide` (`403`, every path) → lock `FOR UPDATE` (`404 STOCK_ITEM_NOT_FOUND`) → version (`409 CONFIG_STALE`) → payload checks → no-op (`200`, no audit, no bump) → merged rules → write → audit → **bump every branch only if `name`, `stock_unit`, `carries_over` or `archived` changed (I11)** → `COMMIT` (⚠️ v0.3 N-6) |
| Merged-row rules | 01c **R1** (unit rule on drawers), **R2** (archive with active drawer), **R3** (name) kept; **R4** `kind` changes away from `prepared` with a `stock_item_branches` row (any branch) or an active drawer → `409 CONFIG_IN_USE { used_by: { entity: 'stock_item_branch', ids: [branch_id…] } }` (branch rows first) or `{ entity: 'menu_item', ids }`; **R5** packet unit (`422 packet_unit`); **R6** carries-over vs kind (`400`); **R7** code unique among active (one read, only when `code` is sent and differs; `409 stock_item_code`) |
| Precedence | `400` (R6) → `409` (R2, R4; one drawers read serves R1, R2, R4; one branch-rows read for R4) → `422` (R1, R5) → R7 (`409` code) → R3 (`409` name, index at the write) |
| Queries | 01c's + 1 branch-rows read (only when `kind` changes away from `prepared`) + 1 code read (R7, when it applies) − 2 bump statements when no snapshot field changed (I11) |

| Edge | Answer |
|---|---|
| Only `is_a_item` changes | `200`, one audit row, **no bump** (I11, test 9) |
| `name` and `is_a_item` change | `200`, one audit row, bump every branch |
| `kind: 'ingredient'` on PAYE-COOKED counted at Lake City | `409 CONFIG_IN_USE { used_by: { entity: 'stock_item_branch', ids: ['lake-city'] } }` |
| `kind: 'ingredient'` on a prepared item whose only drawer is archived | `200`; restoring that drawer later answers `422 wrong_kind` (C-9) |
| `kind: 'prepared'` on an ingredient | `200` (it may then get a branch row and drawers) |
| `kind: 'packet'` on an ingredient in piece | `422 packet_unit` (send `stock_unit: 'g'` in the same PATCH) |
| ⚠️ v0.2 m-5: `stock_unit` g → piece on raw paye (ingredient, with a `piece` unit and g prices) | `200`; the g rows become "other unit" (I5) and the item has no menu cost until a price in the new unit is set; its `piece` item unit is now the stock unit's own name and is ignored by `resolveUnit` step 2 (base g ≠ piece). Changing back to g restores both (I5, m-6) |
| Stale tab | `409 CONFIG_STALE` (also on a no-op) |

### Batch 2 — inventory detail, units, prices, yields (new)

#### 6.4 `GET /v1/admin/stock-items/:stock_item_id/inventory`

| | |
|---|---|
| Query | `branch_id?` (C2 assert before SQL) for `menu_cost` |
| Response | `200 { data: { can_edit_tenant, stock_item: StockItemWire, builtin_units: [{ unit_name, base, num, den }] (the built-ins whose base = stock_unit), units: ItemUnitWire[] (every row, newest first), prices: ItemPriceWire[] (newest 100 by created_at, id; every branch's), menu_cost: MenuCostWire \| null, yields: YieldProfileWire[] (newest 20), active_yield: YieldProfileWire \| null } }` |
| Queries | **7 fixed** (⚠️ v0.2 M-3): coversEveryBranch, stock item, units, price history (LIMIT 100), **price candidates** (the §6.1 read for this one item, so `menu_cost` never depends on the history LIMIT), yields (LIMIT 20), owner names for `recorded_by` (`= ANY`) |
| Errors | `400` (bad query), `404 STOCK_ITEM_NOT_FOUND` (unknown, foreign), `404 BRANCH_NOT_FOUND` |

#### 6.5 `POST /v1/admin/stock-items/:stock_item_id/units` (Idempotency-Key)

| | |
|---|---|
| Body | `{ unit_name, factor_num, factor_den?: 1, note? }` — "1 `unit_name` = num / den of the item's stock unit". The client turns "1 peti = 12 kg" into `12000 / 1`, "1 piece = 182.5 g" into `1825 / 10`, "1 l = 0.92 kg" into `920 / 1` (the server reduces) |
| Script | validate (name pattern, ranges) → `BEGIN` → key → tenant-wide read (`403`) → lock stock item `FOR SHARE` (`404 STOCK_ITEM_NOT_FOUND`) → active (`422 archived`) → I4 name rules against the **locked** `stock_unit` (`400`) → reduce by gcd → insert (`base_unit` = locked stock unit) → audit → key response → prune → `COMMIT` |
| Response | `201 { data: { unit: ItemUnitWire } }` |
| Queries | **7 fixed** (⚠️ v0.2 m-2): key insert, tenant-wide, lock, insert, audit, key response, prune |

| Edge | Answer |
|---|---|
| `unit_name: 'KG'` on beef (g) | `400` (built-in on the item's own base) |
| `unit_name: 'l'` on ghee (g), 920 / 1 | `201`; `resolveUnit(ghee, 'l')` = 920 g (⚠️ v0.2 M-4) |
| `unit_name: 'kg'` on murgi (piece), 5 / 7 | `201` |
| `unit_name: 'piece'` on Anday (`stock_unit: piece`) | `400` (its own stock unit) |
| `unit_name: 'piece'` on raw paye (g) | `201` |
| Second `peti` row with another factor | `201`; the new row is current, the old stays in history (I4) |
| Two tabs add `peti` at once | both `201`; the later `created_at` (then id) is current |
| Retry with the same key | stored `201` replayed |

#### 6.6 `POST /v1/admin/stock-items/:stock_item_id/prices` (Idempotency-Key)

| | |
|---|---|
| Body | `{ kind: 'manual' \| 'market_rate', branch_id?: string \| null (default null; non-null only with market_rate), valid_for_hours?: int 1 … 720 (market_rate only, default 24; with manual → `400`, ⚠️ v0.4 OQ-3), unit_name, price_minor, note? }` |
| Script | validate (`400` for manual + `branch_id`) → `BEGIN` → key → tenant-wide read (`403`) → lock stock item `FOR SHARE` (`404`) → active (`422 archived`) → when `branch_id` is set: branch read (`422 { field: 'branch_id', reason: 'not_found' }`, C1) → read the item's units for `unit_name` → `resolveUnit` with the locked `stock_unit` (`422 not_convertible`) → insert with the frozen conversion, `stock_unit`, `created_at = now`, `valid_until_at = now + valid_for_hours × 3 600 000` for a market rate (I6) → candidates read (I7 for the price's `branch_id`) → audit → key response → prune → `COMMIT` |
| Response | `201 { data: { price: ItemPriceWire, menu_cost: MenuCostWire \| null } }` |
| Queries | **9 fixed** without `branch_id`, **10** with (key, tenant-wide, lock, [branch read], units read, insert, candidates, audit, key response, prune) |

| Edge | Answer |
|---|---|
| Beef `manual`, `kg`, Rs 1,500 (`150000`) | `201`; per stock unit `150000 / 1000` = 150 minor per g; `display_per { unit: 'kg', minor: '150000' }` |
| Ghee `manual`, `l` (920 g), Rs 2,300 | `201`; per g = 230000 / 920 = 250 minor |
| `manual` with `branch_id` | `400` (⚠️ v0.2 M-6) |
| `market_rate` at Lake City, no `valid_for_hours` | `201`; at Lake City it beats every-branch prices for 24 h, then the branch falls back (I7) |
| `market_rate`, `valid_for_hours: 72` | `201`; valid 3 days (⚠️ v0.4 OQ-3) |
| `valid_for_hours: 0`, `721`, or sent with `manual` | `400` |
| `branch_id` unknown or another tenant's | `422 { field: 'branch_id', reason: 'not_found' }` |
| `price_minor: 0` | `400` |
| `unit_name: 'peti'` with no `peti` unit | `422 { field: 'unit_name', reason: 'not_convertible' }` |
| Item archived meanwhile | `422 { field: 'stock_item_id', reason: 'archived' }` |
| `kind: 'quote'` | `400` (POST, §12.4) |

#### 6.7 `POST /v1/admin/stock-items/:stock_item_id/yields` (Idempotency-Key)

| | |
|---|---|
| Body | `{ yield_bp } \| { test_ap_qty, test_ep_qty }`, + `note?` (test quantities in the item's `stock_unit`) |
| Script | validate (one form only; computed `yield_bp` 1 … 50 000, I8) → `BEGIN` → key → tenant-wide read (`403`) → lock stock item `FOR SHARE` (`404`) → active (`422 archived`) → `kind = ingredient` (`422 wrong_kind`) → insert (`test_unit` = locked `stock_unit`) → audit → key response → prune → `COMMIT` |
| Response | `201 { data: { yield: YieldProfileWire } }` |
| Queries | **7 fixed**: key, tenant-wide, lock, insert, audit, key response, prune |

| Edge | Answer |
|---|---|
| Raw beef test: AP 10 000 g, EP 7 120 g | `yield_bp` 7 120 |
| AP 1 000, EP 2 400 (chanay, soaked) | 24 000 |
| AP 1 000, EP 6 000 | `400` (> 50 000) |
| Both forms sent, or neither | `400` |
| On PAYE-COOKED (prepared) or TP-1 (packet) | `422 wrong_kind` |

---

## §7. Cross-cutting (this module only)

| Item | Decision |
|---|---|
| Logging | Writes log `{ route, tenant_id, stock_item_id, outcome }`; notes are never logged (they may name suppliers) |
| Performance | Bounded data (tens of items, a few hundred price rows per item per year); no pagination beyond the LIMITs in §6.4 |
| Rate limits | 01a's owner-route limits; nothing new |
| Risks | (1) Owners confuse "menu cost" with real cost — I12 labels. (2) A wrong unit factor silently skews every later cost — the item page shows each unit as a sentence ("1 peti = 12 kg") with who and when. (3) Version strings change once at release (C-7) — one reload. (4) The owner is the only writer (I10): he enters every mandi rate until 08d's hub screen exists (§12.3 OQ-2) |

---

## §8. Client contract (owner app `apps/client`, entry `owner`)

1. **Stock items list** (`features/owner/stock-items/StockItemList.tsx`): tabs **Prepared · Ingredients · Packets** (the `kind` query); columns name, code, stock unit, A-item badge, **Menu cost** (`display_per`, e.g. "Rs 1,500 / kg"; "< Rs 0.01 / piece" when `below_one_minor`; "No price" in the warning style, never "Rs 0"); the existing `BranchPicker` drives `branch_id`. 01c's branch rows and drawers stay on the Prepared tab.
2. **Item form** (`StockItemForm.tsx`): kind (on create; on edit, a refusal shows R4's text with the branches or items that block it), code, stock unit, cost category, A-item; `carries_over` only on Prepared.
3. **Item page** (new `StockItemInventory.tsx`), three sections:
   - **Units**: built-ins for the stock unit (read-only), the item's current units as sentences, "Add or change a unit" (name + "= N kg / g / L / ml / piece"; the client converts kg / L to g / ml and decimals to num / den, so "1 l = 0.92 kg" sends 920 / 1), history under a disclosure; rows of another base unit greyed with "other unit".
   - **Menu cost** (I12 label and help line): current menu cost for the picked branch; "Set price" sheet with kind **Manual** (every branch) / **Today's market rate** (every branch or one branch; **Valid for**: 1 day (default) / 2 days / 1 week / custom hours up to 30 days, ⚠️ v0.4 OQ-3), unit pick-list (the units `resolveUnit` accepts), amount, note; history list (newest first) with who / when / branch / kind.
   - **Yield** (ingredients only): active yield as a percentage with one decimal (`yield_bp / 100`); "Record a test" (AP and EP in the item's stock unit, entered as kg / g, L / ml or pieces; ⚠️ v0.2 m-15) or "Set yield %"; history.
4. Errors use the existing `errors.*` texts; new reason texts for `wrong_kind`, `packet_unit`, `not_convertible`, `branch_id` `not_found`, and `CONFIG_NAME_TAKEN` with `stock_item_code`. Urdu strings go to the urdu-todo list as in 05.
5. Money and quantities format through the existing client formatters (Rs, kg / L). `display_per` is display only.
6. ⚠️ v0.2 M-2 (C-10): **menu item form** (`features/owner/menu/ItemForm.tsx`): the stock-draw picker calls `listStockItems({ kind: 'prepared' })` and its archived fallback `{ status: 'archived', kind: 'prepared' }`; `api/cloud-admin.ts` `listStockItems` gains the optional `kind`.

---

## §9. Error catalogue additions

No new error codes. New `details` values on existing codes:

| Code | New value | Condition |
|---|---|---|
| `422 CONFIG_REFERENCE_INVALID` | `reason: 'wrong_kind'` | a branch row (C-4), or an item draw by the I9 draw rule (sent: any item; stored: merged-active item; C-3, C-9), onto a non-prepared item; a yield on a non-ingredient (I8) (⚠️ v0.5 P-2) |
| `422 CONFIG_REFERENCE_INVALID` | `reason: 'packet_unit'`, `field: 'stock_unit'` | packet not in g (I2) |
| `422 CONFIG_REFERENCE_INVALID` | `reason: 'not_convertible'`, `field: 'unit_name'` | unit does not resolve (I5) |
| `422 CONFIG_REFERENCE_INVALID` | `field: 'branch_id'`, `reason: 'not_found'` (existing reason, new field) | a price's branch unknown or foreign (C1) |
| `409 CONFIG_NAME_TAKEN` | `entity: 'stock_item_code'` | code clash (§3.3) |
| `409 CONFIG_IN_USE` | `used_by.entity: 'stock_item_branch'` (ids = branch ids) | kind change away from prepared while counted (R4) |

---

## §10. Tests

### 10.1 Pure functions (`packages/domain/src/inventory/*.test.ts`)

| # | Case |
|---|---|
| 1 | `BUILTIN_UNITS`: kg 1000/1 g, pao 250/1 g, maund 40000/1 g, l 1000/1 ml, darjan 12/1 piece; names case-insensitive |
| 2 | `resolveUnit`: stock unit → 1/1; item unit before built-in; built-in with matching base; built-in with other base and no item unit → null; `l` item unit on a g item → its factor (M-4); `kg` item unit on a piece item → its factor; latest row wins; a row whose `base_unit` ≠ current stock unit ignored, and counted again after the unit changes back (m-6); no chains |
| 3 | `pricePerStockUnit` with **string** BIGINT inputs converted by `BigInt()` (m-12): Rs 1,500 / kg → 150/1 per g; Rs 3,600 / peti (12 000 g) → 360 000 / 12 000 = 30/1 per g; Rs 400 / darjan → 40 000 / 12 = 10 000/3 per piece (⚠️ v0.3 N-8: v0.1–v0.2 had rupee values); Rs 2,300 / l of ghee (920 g) → 250/1; exact |
| 4 | `effectiveMenuPrice`: branch market rate before every-branch; latest `created_at`, then id; a market rate expired at its `valid_until_at` (24 h default, or the entered validity) falls back to the older manual; a newer manual beats an older unexpired market rate; a branch market rate expires and the branch falls back to the every-branch price; rows in another stock unit ignored; none → null (never 0) |
| 5 | `yieldBpFromTest`: 10 000 / 7 120 → 7 120; 3 / 2 → 6 667; 1 000 / 2 400 → 24 000; out of range throws |
| 6 | gcd reduction: 1825 / 10 → 365 / 2; `display_per`: Rs 3 per peti of 1 000 pieces → `minor '1'`, `below_one_minor: true` (m-1); 1e9 per unit of 1/1e6 g per kg stays exact as a string |

### 10.2 Cloud — stock items (`apps/cloud/test/inventory/stock-items.int.test.ts`)

| # | Case |
|---|---|
| 7 | POST each kind; defaults (`prepared`, `food`, not A-item); packet in piece → `422 packet_unit`; carries_over on ingredient → `400`; 8 statements, 9 with `code` |
| 8 | Code: uppercased; active clash → `409 stock_item_code`; archived-only clash → `201`; name **and** code taken → `409 stock_item_code` (m-13); ⚠️ v0.3 N-7: restoring an item whose code another active item now holds → `409 stock_item_code` (index map), nothing written |
| 9 | PATCH only `is_a_item` → `200`, one audit row, every branch's `config_version` unchanged; statement count = the bump path's − 2 (I11, N-6) |
| 10 | PATCH `name` + `is_a_item` → bump every branch |
| 11 | PATCH `kind` away from prepared with a branch row → `409 { entity: 'stock_item_branch', ids }`; with only an active drawer → `409 { entity: 'menu_item', ids }`; with an archived drawer only → `200` |
| 12 | PATCH stale → `409 CONFIG_STALE`; version-only body → `400` (C9); the version string covers every new field |
| 13 | GET list: `kind` filter; bad `kind` → `400`; foreign `branch_id` → `404` before SQL; `menu_cost` per I7; 5 statements |
| 14 | Rule precedence: PATCH with `carries_over: true` on an ingredient **and** a kind change in use → `400` first |

### 10.3 Cloud — 01c routes changed and races (`apps/cloud/test/menu-variants/*` additions, `apps/cloud/test/inventory/races.int.test.ts`)

| # | Case |
|---|---|
| 15 | Item POST / PATCH with a sent draw onto an ingredient → `422 { field: 'stock_draws.0.stock_item_id', reason: 'wrong_kind' }`; statement counts unchanged (C-3). ⚠️ v0.5 P-3: (a) an **archived** item's PATCH sending a draw onto an ingredient → `422 wrong_kind`; onto an archived ingredient → `422 wrong_kind` (no `archived` check on an archived item); (b) an **active** item whose stored draw points at an ingredient (raw SQL setup, as test 24) → PATCH `name` only → `422 wrong_kind`, nothing written (R9b) |
| 16 | Stock-item branch PUT set on a packet → `422 { field: 'stock_item_id', reason: 'wrong_kind' }`; remove on any kind → `200` (C-4) |
| 17 | Kind change and a branch PUT race (two transactions): one wins, the other `409 CONFIG_IN_USE` or `422 wrong_kind`; never a branch row on a non-prepared item |
| 18 | Kind change and an item draw write race: same guarantee (draw takes the stock item `FOR SHARE`; `kind` read in that statement) |
| 19 | ⚠️ v0.2 M-1: archived "Paye Half" draws from PAYE-COOKED (no branch row) → PATCH PAYE-COOKED `kind: 'ingredient'` `200` → restore "Paye Half" → `422 { field: 'stock_draws.0.stock_item_id', reason: 'wrong_kind' }`, nothing written; archived stock item + ingredient → `archived` reported first (R9 before R9b) |
| 19b | ⚠️ v0.3 N-4, v0.5 P-4: restore of the archived drawer vs `kind: 'ingredient'` PATCH on its stock item, as two transactions. **Order A:** the stock-item PATCH holds at `afterStockItemLock`; the restore runs, waits on the stock item's `FOR SHARE`, then reads `kind = ingredient` → `422 wrong_kind`. **Order B:** the restore holds at `patchMenuItem`'s existing `beforeBump` (after all rules, `FOR SHARE` held); the PATCH waits, then its drawers read sees an active drawer → `409 CONFIG_IN_USE { used_by: { entity: 'menu_item' } }`. Never an active item drawing from an ingredient; a build that reads `kind` outside the `FOR SHARE` statement fails order A |
| 20 | ⚠️ v0.2 M-8: price POST vs `stock_unit` PATCH (⚠️ v0.3 N-5: test-only hook `afterStockItemLock`, called by the PATCH and by the three POSTs right after their stock-item lock, holds either side open; `beforeBump` does not run on a no-bump PATCH), both orders: either the price lands in the old unit and the PATCH then commits (the price is "other unit"), or the PATCH commits first and the POST answers `422 not_convertible` / stores in the new unit; never a price whose frozen `stock_unit` differs from the item's `stock_unit` at the POST's lock |
| 21 | ⚠️ v0.2 M-8: yield POST vs `kind` PATCH to `packet` (a no-bump PATCH; hook `afterStockItemLock`, both orders): one wins; a yield row never exists on an item that was a packet when the yield was inserted (`422 wrong_kind` when the PATCH wins) |
| 22 | ⚠️ v0.2 M-8: unit POST vs archive PATCH (hook `afterStockItemLock`, both orders): one wins; no unit row inserted after the archive committed (`422 archived` when the PATCH wins) |
| 23 | 01c suite passes unchanged **except #35** (4 → 5 statements, C-5) |

### 10.4 Snapshot and engine invariant

| # | Case |
|---|---|
| 24 | Builder: a raw-SQL row in `stock_item_branches` pointing at an ingredient (constraint bypass in the test) is **not** in the snapshot's `stock_items[]` (I9 defence) |
| 25 | Snapshot of a tenant with prepared, ingredient and packet items, where only prepared items are counted, equals the pre-08a snapshot byte for byte (no new keys, same hash) |
| 26 | No engine / hub / 02b test changes: the gate's hub and engine projects pass without edits |
| 27 | Migration on a 01c-era database: every stock item `prepared`, `food`, not A-item; no `config_version` change |

### 10.5 Cloud — units, prices, yields (`apps/cloud/test/inventory/*.int.test.ts`)

| # | Case |
|---|---|
| 28 | Unit POST: `kg` on a g item `400`; own stock unit `400`; `piece` on a g item `201`; `l` on ghee (g) `201`; `kg` on a piece item `201`; reduce 1825/10 → 365/2; archived item `422`; foreign item `404`; replay; 7 statements |
| 29 | Unit POST then PATCH `stock_unit` → old row `is_current: false`, in history; ⚠️ v0.3 N-1: ghee `peti` row A (base g, 12 kg) → `stock_unit` piece → `peti` row B (base piece) → `stock_unit` g: row A `is_current: true`, row B false, and `resolveUnit(ghee, 'peti')` = 12 000 g |
| 30 | ⚠️ v0.2 M-3: detail GET with 101 expired market rates and 1 older manual → `menu_cost` = the manual; history shows 100 rows; 7 statements |
| 31 | Price POST: manual + `branch_id` `400`; `branch_id` unknown / foreign `422 { field: 'branch_id', reason: 'not_found' }`; market rate at a branch `201`; 9 / 10 statements |
| 32 | Price frozen conversion: `peti` = 12 kg, Rs 3,600 / peti, then `peti` = 10 kg → the stored price keeps 12 000 / 1; `menu_cost` unchanged |
| 33 | Market rate without `valid_for_hours` → `valid_until_at = created_at + 86 400 000`; with 72 → `+ 259 200 000`; `0`, `721`, or with `manual` → `400`; manual `valid_until_at` null (DB CHECKs, ⚠️ v0.4 OQ-3); `kind: 'quote'` `400`; `price_minor: 0` `400` |
| 34 | Append-only: no route updates or deletes a unit, price or yield row (route inventory + a grep test on the module for `UPDATE` / `DELETE` against the three tables, as 05's) |
| 35 | Yield POST: both forms `400`; neither `400`; on prepared / packet `422 wrong_kind`; AP / EP stored with `test_unit`; 6 000 % `400`; 7 statements |
| 36 | Audit: one row per POST with entity / action; the price audit row carries the price's `branch_id`. Cross-tenant sweep (C7) for routes 6.4–6.7 |

### 10.6 Client

| # | Case |
|---|---|
| 37 | ⚠️ v0.2 M-2: menu `ItemForm` draw picker lists prepared stock items only (`ItemForm.test.tsx`) |
| 38 | Stock items: tabs by kind; Menu cost "Rs 1,500 / kg"; "< Rs 0.01 / piece"; no price → "No price" (never "Rs 0") |
| 39 | Unit sentence input: "1 peti = 12 kg" → 12000/1; "1 piece = 182.5 g" → 1825/10; "1 l = 0.92 kg" → 920/1 |
| 40 | Price sheet: Manual has no branch or validity choice; Today's market rate offers every branch or one branch and a **Valid for** choice (default 1 day) that sends `valid_for_hours` |
| 41 | Labels: the section is "Menu cost"; "Today's cost" appears only in the help line (I12); Yield section hidden for prepared and packet items |

### 10.7 Acceptance

| Source | Check | Test |
|---|---|---|
| 08-g0 §3.1 seeds, item-specific paye g / piece | built-ins + item unit | 1, 2, 28 |
| §3.1 "on-hand never recomputed" | frozen conversion | 32 |
| §3.2 item master fields (08a part) | kind + I2 | 7, 8 |
| §3.4 price history, user + note | append-only + audit | 33, 34, 36 |
| §3.5 step 2 resolution | I7 | 4, 13, 30 |
| §3.6 yield | I8 | 5, 35 |
| D9 missing price never 0 | null menu cost; `below_one_minor` | 4, 6, 38 |
| Owner C3: engine never sees inventory | I9 | 15–19, 19b, 24–26 |
| §7 drill 1 (data entry part) | AP / EP test + piece unit | 28, 35 |

---

## §11. Build order

1. `0018_inventory_config.sql` + schema test (live CHECK names first, 01b D-5) — §5.1 — test 27.
2. `@pos/domain/src/inventory/{conversions,prices,yield}.ts` + index exports — §3.1 I3–I8, §4.2 — tests 1–6.
3. Wires: `StockItemWire` in place + version input (`menu-variants/versions.ts`); `admin/inventory.ts` — §5.3, C-7 — test 12.
4. Stock-item POST / PATCH / list in `apps/cloud/src/modules/menu-variants/` (I11 no-bump path, R4–R7; ⚠️ v0.5 P-5) — §6.1–§6.3 — tests 7–14, 23.
5. 01c guards: sent draw (C-3), branch PUT (C-4), stored-draw R9b (C-9) in `apps/cloud/src/modules/{restaurant,menu-variants}/`; test hook `afterStockItemLock` — tests 15–19, 19b.
6. Builder filter `kind = 'prepared'` — C-6 — tests 24–26.
7. New module `apps/cloud/src/modules/inventory/`: §6.4 detail — test 30.
8. §6.5 units, §6.7 yields — tests 21, 22, 28, 29, 35 (⚠️ v0.3 N-5: test 21 moved here).
9. §6.6 prices — tests 20, 31–33.
10. Audit, append-only and route cases — tests 34, 36.
11. Owner app: list tabs and Menu cost, form fields, item page, `ItemForm` picker — §8 — tests 37–41.

Then the §4.5 bumps (01c v1.2, 01a v2.8, README markers) at approval. 11 tasks, 7 routes (4 new): inside the size budget.

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done
- Tests 1–41 and 19b green in the gate; no hub, engine or 02b test edited; the 01c suite passes with only #35 changed (4 → 5).
- A 01c-era database migrates with no behaviour change (test 27) and no `config_version` bump.
- Owner app shows Menu cost with the I12 label everywhere; a real price never reads Rs 0 and "No price" never reads as zero.
- 01c v1.2, 01a v2.8 and README carry the §4.5 rows with markers.

### 12.2 Endpoint checklist

| § | Route | Status codes |
|---|---|---|
| 6.1 | GET stock-items | 200, 400, 401, 403, 404 (branch) |
| 6.2 | POST stock-items | 201, 400, 401, 403, 409, 422 |
| 6.3 | PATCH stock-items/:id | 200, 400, 401, 403, 404, 409, 422 |
| 6.4 | GET stock-items/:id/inventory | 200, 400, 401, 403, 404 |
| 6.5 | POST …/units | 201, 400, 401, 403, 404, 422 |
| 6.6 | POST …/prices | 201, 400, 401, 403, 404, 422 |
| 6.7 | POST …/yields | 201, 400, 401, 403, 404, 422 |

### 12.3 Open questions

| # | Question | Default if not answered |
|---|---|---|
| OQ-1 | Spec files: one file or one per slice | **Answered (owner, 2026-11-23): one file**; 08b–08d are added here as later versions |
| OQ-2 | Who enters market rates at Lake City until 08d's hub screen? | **Answered: the owner**, from the owner app (I10) |
| OQ-3 | Market rate validity | **Answered: entered by the owner with the rate** (`valid_for_hours`, default 24, ≤ 30 days; I6) |
| OQ-4 | `price_minor` 0 | **Answered: refused** (D9) |

### 12.4 Deferred until needed

| Item | Why not now |
|---|---|
| Branch-specific **manual** prices (with an "inherit" row to undo them) | One pilot branch; a branch manual price could never be removed in an append-only list (run 1 M-6) |
| A second, branch-scoped owner user who enters branch prices | 01b B8 / M8 defer multi-owner |
| `must_weigh_on_receipt`, `track_piece_count`, `shelf_life_days`, `default_purchase_unit` | 08d, with their first reader (run 1 cut 3) |
| `quote` prices, `supplier_id` on prices and yields, supplier-scoped yield resolution, a yield `source` column | POST (08-g0 §5) |
| Price-jump owner alert (X %) | POST (08-g0 §3.4) |
| Backdated prices / restatement | POST (`SaleCostRestated`, 08-g0 §5) |
| Tenant-defined global units (e.g. a tenant-wide `bori`) | Every pack unit seen so far differs by item; item units cover them |
| Retiring an item unit | A corrected factor supersedes; no pilot case needs removal |
| `purchased_prepared` kind | No pilot item |
| `visibility_scope` | 08b (recipes) |
| Bulk "today's mandi rates" entry for several items | Five A-items; per-item entry first, measure |
