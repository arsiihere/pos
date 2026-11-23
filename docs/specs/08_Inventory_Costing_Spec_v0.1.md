# 08a — Inventory & Costing: inventory config — Module Spec v0.1 (DRAFT)

**v0.1 — DRAFT (2026-11-23), for hostile review in a fresh session (pipeline step 4).** First slice of module 08 (README R39). Written from `docs/stories/08-g0.md` and the owner rulings of 2026-11-23 on the repo conflicts C1–C12 (§3.1 I-rows). This file holds **slice 08a only**; 08b (recipes + cost engine), 08c (sale cost + comp / void outcome) and 08d (A-item daily sheet) follow as their own spec files, as 03a / 03b do (§12.3 OQ-1).

---

## §1. Header

| Field | Value |
|---|---|
| Module | 08a Inventory config: ingredients and packets as stock items with a `kind`, the inventory fields of every stock item, item units (purchase units and the paye piece weight), the price list ("menu cost": manual and market-rate prices with history), yield profiles. Cloud and owner app only |
| Version | **v0.1 — DRAFT** (2026-11-23) |
| Depends on | Foundation v1.15 (APPROVED); 00 Hub Platform & Access v1.12.3 (owner auth, tenant guard); 01a Restaurant Setup v2.7.5 (`config_audit`, `withIdempotency`, write script, C2 branch rule); 01c Menu Variants v1.1.4 (`stock_items`, `stock_item_branches`, `stock_draws`, versioned writes, snapshot `stock_items[]`) |
| Inherits | **Shared Standards from Foundation v1.15 §6**, unchanged. Carried conventions C1–C9 (README). 08a extends 01c's stock-item routes, so 01c's behaviour is the default where this spec is silent |
| Changes other specs | 01c → v1.2 (rows C-1 – C-8), 01a → v2.8 (rows A-1, A-2), README (R39, module map, Milestone A). 01b, 03a / engine, foundation: **no change in 08a** (§4.5 says why). Full list: §4.5 |
| Tier | T2 Production (foundation §1) |
| Milestone | A (pilot), by README R39. Slice order 08a → 08b → 08c → 08d |
| Inputs | `docs/stories/08-g0.md` §0, §1 (D3, D7, D8, D9), §2, §3.1–§3.6, §4; README R18, R26, R28, R29, R30, C1–C9; 01c V3–V5, V12, V13, §3.3, §4.6, §5.1, §5.4, §6.6–§6.9; owner rulings 2026-11-23 (C1–C12, §3.1); code `apps/cloud/src/modules/menu-variants/`, `apps/cloud/src/modules/config-sync/builder.ts`, `packages/events/src/admin/menu-variants.ts`, `apps/client/src/features/owner/stock-items/` |

### Stories covered

| Source (08-g0) | Item | How |
|---|---|---|
| §2 PILOT "Units & conversions (global + item-specific, versioned)" | Seed globals kg↔g, pao, maund, darjan; item-specific paye piece ≈ X g; versioned; on-hand never recomputed | Built-in units are constants (I3); item units are append-only versions (I4) |
| §2 PILOT "Item master" | raw / packet / produced; purchase unit ≠ stock unit; `must_weigh_on_receipt`, `shelf_life_days`, `cost_category`, `is_a_item` | `stock_items.kind` + inventory fields (I1, I2); the purchase unit is an item unit (I4) |
| §2 PILOT "PriceObserved (manual, market_rate)" | Price history only; every write with user + note | Price list rows, append-only, `config_audit` (I6, I7) |
| §2 PILOT "Yield profiles (manual test cut, versioned)" | One active profile per item; test AP / EP | `yield_profiles`, append-only; yield in basis points (I8) |
| §4 rules | Item create / edit = MGR+; every price change = an audited write with user + note; missing price → never 0 | Owner-app guards (I10); `config_audit` + `recorded_by` + `note`; no price row = no price (I7) |
| §7 drill 1 (paye yield test) | Record the test cut's AP / EP and the g per piece | Yield POST with `test_ap_qty` / `test_ep_qty`; item unit `piece` on raw paye |
| Roadmap I3, I17 (part) | Purchase / stock / recipe units; price history per ingredient | I4, I6 |

### In scope
- Cloud: `stock_items.kind` and the inventory fields; item units; price list; yield profiles; changed stock-item routes (01c §6.6–§6.9) and four new routes. Migration `0018_inventory_config.sql`.
- The snapshot builder lists only `kind = 'prepared'` stock items (01c §4.6 rule 4, defence in depth; I9).
- Pure functions in `@pos/domain` (`inventory/`): built-in units, unit resolution, price per stock unit, effective menu price, yield from a test cut. 08b–08d call them.
- Owner app: stock items list by kind, item form with the new fields, item page with Units, Menu cost and Yield sections.

### Out of scope
- Recipes, cost engine, plate cost, coverage %, `require_recipe_for_menu`, `visibility_scope` / `ck_only` → **08b**.
- Any snapshot key for inventory data (items, units, prices, yields) → **08b** (first hub consumer). 08a changes nothing a hub receives.
- Sale cost, `OrderCosted`, comp kinds, theoretical usage → **08c**.
- `inventory` stream type (foundation bump), receiving, waste, counts, MWA ("today's cost"), daily sheet, hub permissions → **08d**.
- Suppliers, quotes, `supplier_id` on prices or yields, price-jump alerts, tenant-defined global units, retiring a unit → §12.4.

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Cloud config is relational and canonical; owner routes under `/v1/admin`, JWT + tenant guard; creating `POST`s through `withIdempotency`; `writeConfigAudit` insert-only | F §3.3, §6.4; 01a S7, S8, S26 |
| Tenant-level writes need an owner covering every branch (`403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`); branch-level writes need the branch in `allowed_branch_ids` (C2: foreign → `404 BRANCH_NOT_FOUND`) | 01a S8; C2 |
| Stock items: `stock_unit ∈ piece, g, ml`; name unique among active stock items (all kinds); versioned PATCH (`expected_version`, `409 CONFIG_STALE`); one version builder (`menu-variants/versions.ts`) | 01c V3, V13, §5.4 |
| Pre-cooked stock is engine-owned: `EngineState.stock` folds only the snapshot's `stock_items[]` (the rows with a `stock_item_branches` row); `stock_draws` reserve from them | 01c V4, V5, V12, §4.6; F §3.1 D50 |
| Money is integer minor units, quantities integers in the smallest unit; BigInt inside calculations; no floats or decimal strings | F §4.1 D47; 01a S44 |
| Snapshot schema 4, a schema change ships cloud + every hub together; additive optional keys only within a version | 01a S28, R29 |
| Lock order of 01c §6 (kinds 1–10, `stock_items` = 5, `branches` = 10 last) | 01c §6 |

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Reason | Overrides / changes |
|---|---|---|---|
| I1 | **Ingredients and packets are stock items with a `kind`** (owner ruling C2 (a), R28). `stock_items.kind ∈ prepared \| ingredient \| packet`, default `prepared`; every existing row becomes `prepared`. `prepared` = 01c's pre-cooked pool (PAYE-COOKED, karahi pot); `ingredient` = purchased raw item (beef, paye, ghee, onion); `packet` = coded CK output used at branches (TP-1, QM-1, PY-1). 08-g0's `produced` item is a `prepared` stock item (paye cooked at the branch, owner ruling on OQ3); `purchased_prepared` is not taken into the pilot (§12.4) | One table, one name space, R28 as approved; PAYE-COOKED already exists as a prepared row | 01c V3 ("the inventory module adds `kind`") — fulfilled |
| I2 | **Inventory fields on every stock item:** `code` (null or 1–16 of `A–Z 0–9 -`, unique among active), `must_weigh_on_receipt`, `track_piece_count`, `shelf_life_days` (null or 1–3 650), `cost_category ∈ food \| packaging \| cleaning \| beverage` (default `food`), `is_a_item`, `default_purchase_unit` (null or a unit name that resolves for the item, I4). `packet` ⇒ `stock_unit = 'g'` (08-g0 §0). `track_piece_count` ⇒ `stock_unit ∈ g, ml` | 08-g0 §3.2; packets are weighed in grams | 08-g0 `purchase_pack_qty` dropped: the pack size is an item unit ("1 peti = 12 kg", I4), so one place holds it |
| I3 | **Built-in units are constants, not data** (`@pos/domain` `BUILTIN_UNITS`): `kg` = 1 000 g, `pao` = 250 g, `maund` = 40 000 g, `l` = 1 000 ml, `darjan` = 12 piece. Names are case-insensitive and stored lowercase. They are physical or trade facts, the same for every tenant, so no seed, no table, no 00 CLI change. `tray` is **not** built in (24 or 30 by supplier): it is an item unit on Anday | 08-g0 §3.1 seed list; R18 covers settings that differ by restaurant, these do not | 08-g0 §3.1 "seed globals" as rows — replaced by constants; tenant-defined global units deferred (§12.4) |
| I4 | **Item units, append-only versions.** A row `stock_item_units { stock_item_id, unit_name, base_unit, factor_num, factor_den }` means "1 `unit_name` = `factor_num / factor_den` `base_unit`", where `base_unit` is the item's `stock_unit` at write time. A new row for the same `(stock_item_id, unit_name)` supersedes the older (latest `created_at`, then id); rows are never updated or deleted. `unit_name`: 1–20 chars, trimmed, lowercase, `[a-z0-9 ._-]`; not a built-in name; not the item's own `stock_unit`; `piece` allowed for a g / ml item (paye: 1 piece = 182.5 g → 365 / 2), `g` / `ml` allowed for a piece item. `factor_num` 1 … 1 000 000 000, `factor_den` 1 … 1 000 000, stored reduced by their gcd. **On-hand stock and stored prices are never recomputed** when a unit changes (08-g0 §3.1) | Exact ratios with integers (owner ruling C4 (a)); history survives a correction | 08-g0 `UnitConversionDefined` event → config rows (C7 (a): config is cloud-canonical) |
| I5 | **Resolving a unit for an item** (`resolveUnit(item, unitName, itemUnits)`), direct only, no chains: `unitName = item.stock_unit` → 1/1; else the item's latest item unit with that name **whose `base_unit` = the item's current `stock_unit`**; else a built-in whose base = the item's `stock_unit`; else not convertible. An item unit shadows a built-in only if the built-in's base differs (it cannot share a name, I4). A unit row whose `base_unit` is no longer the item's `stock_unit` (after a `stock_unit` change) is ignored, shown as "other unit" in history | One rule for every later slice (08b recipe save, 08d receipt); no chain ambiguity | — |
| I6 | **Price list ("menu cost").** Append-only rows `item_prices { stock_item_id, branch_id (null = every branch), kind ∈ manual \| market_rate, unit_name, price_minor, stock_qty_num, stock_qty_den, stock_unit, valid_from, valid_to, note, recorded_by }`. At write the server resolves `unit_name` (I5) and **freezes** the conversion (`stock_qty_num / stock_qty_den` stock units per 1 `unit_name`) and the item's `stock_unit`. `price_minor` 1 … 1 000 000 000 (0 is refused: a free item is not a price, D9). `valid_from` = server time of the write (no backdating; restatement is POST, §12.4). `manual`: `valid_to` null. `market_rate`: `valid_to = valid_from + 86 400 000` (a mandi rate holds for one day, 08-g0 §3.4). Price per stock unit = `price_minor × stock_qty_den / stock_qty_num` minor units, kept as a fraction, never rounded or stored | Owner ruling C7 (a): plate cost works in the owner app from day one; a frozen conversion keeps old prices meaningful when a unit is corrected | 08-g0 `PriceObserved` event (manual, market_rate) → config rows; `price_per_stock_unit NUMERIC(14,4)` → a fraction (C4 (a)) |
| I7 | **Effective menu price** (`effectiveMenuPrice(rows, branchId, nowMs, stockUnit)`, pure): candidates are rows with `stock_unit` = the item's current `stock_unit`, `valid_from ≤ now` and (`valid_to` null or `now < valid_to`). If any candidate has `branch_id = branchId`, choose among those; else among `branch_id` null. Within the chosen set the latest wins: `valid_from` desc, then `created_at` desc, then `price_id` desc. Kind does not rank: a newer market rate beats an older manual price and the reverse (08-g0 §3.5 step 2). No candidate → `null` (**no price**; 08b marks the cost `partial`, D9; never 0). `quote` is not a kind here (POST) | 08-g0 §3.5 step 2, D9 | — |
| I8 | **Yield profiles, append-only.** `yield_profiles { stock_item_id, yield_bp, source: 'manual_test', test_ap_qty, test_ep_qty, test_unit, note, recorded_by }`; `yield_bp` 1 … 50 000 (0.01 % … 500 %, D8 `0 < y ≤ 5`). Sent either as `yield_bp` or as both test quantities (in the item's `stock_unit`, 1 … 1 000 000 000), then `yield_bp = round_half_up(ep × 10 000 / ap)`, refused (`400`) outside 1 … 50 000. The active profile is the latest row (one per item in the pilot). **Ingredient only** (`422 wrong_kind`): a packet is already edible, a prepared item's yield is its batch recipe (08b) | Owner ruling C4 (a): `yield_bp`; drill 1 records the test cut | 08-g0 `yield` fraction → basis points |
| I9 | **Only `prepared` stock items reach the engine.** A `stock_item_branches` row (counted at a station) and a `stock_draws` row may point only at a `prepared` stock item (`422 wrong_kind`). Changing `kind` away from `prepared` is refused while the item has a `stock_item_branches` row or an active drawer (`409 CONFIG_IN_USE`). The builder also filters `kind = 'prepared'`. So `EngineState.stock`, the hub stock page and 02b's reservations never see an ingredient or packet, and **no engine or hub code changes** | Owner ruling C3 (a): the engine never sees inventory stock; an invariant at the write plus a builder filter is cheaper and safer than filters in engine code | 01c §6.4, §6.5, §6.8, §6.9, §4.6 rule 4 (§4.5 rows C-3 – C-6) |
| I10 | **Who may write.** Cloud routes are owner-app routes (00 owner users). Tenant-level writes (stock items, item units, yields, a price with `branch_id` null) need an owner covering every branch (01a S8). A price with a `branch_id` needs that branch allowed (C2). 08-g0's "MGR+" maps to this: a manager who should enter branch market rates gets an owner-app user scoped to that branch (§12.3 OQ-2). Hub permissions are 08d's | Reuses 00 / 01a guards; no new permission catalogue in 08a | — |
| I11 | **Inventory-only writes do not bump `config_version`.** Item units, prices, yields, and a stock-item PATCH that changes only fields absent from every snapshot (`kind`, I2 fields) write and audit but do not bump: no hub reads them in 08a, so a bump would make every hub refetch an identical snapshot. A stock-item PATCH that changes `name`, `stock_unit`, `carries_over` or `archived` bumps every branch as 01c §6.8 does. **08b changes this rule** when it adds the inventory snapshot key | Avoids pointless hub refetch; keeps the bump tied to snapshot content | 01a "every write ends with `bumpConfigVersion`" and 01c §6.8 (rows A-2, C-5) |
| I12 | **"Menu cost" vs "today's cost" (owner ruling C7).** Everything 08a stores and shows is **menu cost**: the configured price of I7. "Today's cost" is reserved for the hub's moving weighted average from receipts (08d) and is never shown in 08a. Owner-app labels: section **"Menu cost"**, help line "Price you set. Today's cost from deliveries is on the hub (coming)". Neither label is used for the other value anywhere in 08–08d | Two price sources must never be confused | — |
| I13 | **Versioned stock-item writes keep 01c V13**; the version input (01c §5.4) gains every I2 field and `kind`. Units, prices and yields are append-only and need no version: two concurrent writes both land and the latest wins by I4 / I7 / I8 | A lost update is impossible on an append | 01c §5.4 (row C-7) |

### 3.2 Kinds and fields

| Field | prepared | ingredient | packet |
|---|---|---|---|
| `stock_unit` | piece / g / ml | piece / g / ml | **g only** |
| Branch row (counted at a station), drawer of a menu item | yes (01c) | **no** (I9) | **no** (I9) |
| `carries_over` | 01c meaning | stored, unused (false) | stored, unused (false) |
| `code`, `must_weigh_on_receipt`, `shelf_life_days`, `cost_category`, `is_a_item`, `default_purchase_unit`, item units, prices | yes | yes | yes |
| `track_piece_count` | g / ml only | g / ml only | no (`400`) |
| Yield profile | no | **yes** | no |

`carries_over: true` on a non-prepared item → `400` (it has no meaning off the engine).

### 3.3 Validation rules (cloud, beyond 01c §3.3)

| Rule | Error |
|---|---|
| `kind ∈ prepared, ingredient, packet` | `400` |
| `code` null or `^[A-Z0-9-]{1,16}$` after trim + uppercase; unique among active stock items | `400` / `409 CONFIG_NAME_TAKEN { entity: 'stock_item_code' }` |
| `shelf_life_days` null or 1 … 3 650; `cost_category` in its list | `400` |
| Merged row: `kind = packet` ⇒ `stock_unit = 'g'` | `422 CONFIG_REFERENCE_INVALID { field: 'stock_unit', reason: 'packet_unit' }` |
| Merged row: `track_piece_count` ⇒ `stock_unit ∈ g, ml` and `kind ≠ packet`; `carries_over` ⇒ `kind = prepared` | `400` |
| Merged row: `default_purchase_unit` null or resolves for the item (I5) | `422 { field: 'default_purchase_unit', reason: 'not_convertible' }` |
| `kind` away from `prepared` while a `stock_item_branches` row or an active drawer exists | `409 CONFIG_IN_USE { used_by: { entity: 'stock_item_branch' \| 'menu_item', ids } }` (branch rows reported first) |
| Branch-row set or a draw onto a non-prepared item | `422 { field: 'stock_item_id' \| 'stock_draws.0.stock_item_id', reason: 'wrong_kind' }` |
| Item unit: name rules I4; num / den ranges | `400` |
| Item unit / price / yield on an archived item | `422 { field: 'stock_item_id', reason: 'archived' }` |
| Price `unit_name` not resolvable (I5) | `422 { field: 'unit_name', reason: 'not_convertible' }` |
| Price `branch_id` not allowed / unknown / foreign | `404 BRANCH_NOT_FOUND { branch_id }` (C2, inside the transaction) |
| Yield on a non-ingredient | `422 { field: 'stock_item_id', reason: 'wrong_kind' }` |
| Yield body: exactly one of `yield_bp` or (`test_ap_qty` and `test_ep_qty`); computed or sent value in 1 … 50 000 | `400` |
| `note` ≤ 200 chars, trimmed, empty → null | `400` |

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 00 | owner JWT, tenant guard, password guard |
| 01a | `withIdempotency`, `writeConfigAudit`, `assertTenantWide`, `coversEveryBranch`, `bumpEveryBranch`, the common write script, C2 `BRANCH_NOT_FOUND` |
| 01c | `stock_items` routes and service (`apps/cloud/src/modules/menu-variants/`), `versions.ts`, the builder's stock-items query, owner-app stock-items views |

### 4.2 Exposes (later slices rely only on these)

| Export | Shape | Used by |
|---|---|---|
| `@pos/domain` `inventory/units.ts` | `BUILTIN_UNITS: Readonly<Record<'kg'\|'pao'\|'maund'\|'l'\|'darjan', { base: Unit, num: number, den: number }>>`; `normaliseUnitName(s) → string`; `resolveUnit(item: { stock_unit }, unitName, itemUnits: ItemUnitRow[]) → { num: bigint, den: bigint } \| null` (I5); `toStockUnits(qty: bigint, conv) → { num, den }` | 08b recipe save, 08d receipt |
| `@pos/domain` `inventory/prices.ts` | `pricePerStockUnit(row) → { num: bigint, den: bigint }` (minor units per stock unit, I6); `effectiveMenuPrice(rows, branchId, nowMs, stockUnit) → PriceRow \| null` (I7) | 08b, 08c |
| `@pos/domain` `inventory/yield.ts` | `yieldBpFromTest(ap: number, ep: number) → number` (I8, half up); `activeYield(rows) → YieldRow \| null` | 08b |
| `@pos/events` `admin/inventory.ts` | `StockItemWire` (extended, §5.4), `ItemUnitWire`, `ItemPriceWire`, `YieldProfileWire`, request bodies of §6 | owner app, 08b |
| Invariant | A snapshot `stock_items[]` entry is always `kind = prepared` (I9) | 03a engine, 02b, hub stock page |
| `config_audit` entities | `stock_item_unit`, `item_price`, `yield_profile` (action `create`) | 06, 07 |

### 4.3 Requirements carried to later slices

| To | Requirement |
|---|---|
| 08b | Adds the inventory snapshot key (items by kind, current item units, effective-price inputs, active yields; `ck_only` filtering) and with it the bump rule for inventory writes (replaces I11). Recipe-line convertibility uses `resolveUnit`. Missing price (`effectiveMenuPrice` null) or yield → `partial`. Adds `visibility_scope` |
| 08c | Hub cost uses `effectiveMenuPrice` until 08d's MWA exists for the item |
| 08d | MWA = "today's cost" (I12); receipt units through `resolveUnit` and `default_purchase_unit`; `must_weigh_on_receipt`, `track_piece_count`, `is_a_item` read from the snapshot; hub permissions (01b bump); the `inventory` stream (foundation bump) |

### 4.4 Story → slice map (08-g0 §2 PILOT)

08a: units, item master, PriceObserved (manual, market_rate), yield profiles. 08b: recipes, cost engine, plate cost, `require_recipe_for_menu`. 08c: `SaleCompleted` cost snapshot (as `OrderCosted`), void / comp food outcome, theoretical food cost report. 08d: locations (implicit), A-item daily sheet. Deal cost range and suggested price: POST (owner ruling, R39).

### 4.5 Changes to other specs (R26)

Applied when 08a is approved, each target bumped with a changelog and "⚠️ Changed by 08a v1.0 (row X)" markers.

| Row | Target → version, section | Change | Why |
|---|---|---|---|
| C-1 | 01c → **v1.2** §3.1 V3 | `stock_items` gains `kind` (prepared / ingredient / packet) and the inventory fields (08a I1, I2); "(the inventory module adds `kind`)" fulfilled | I1, I2 |
| C-2 | 01c §3.3 | New rows from 08a §3.3 (kind, code, packet unit, piece count, purchase unit, kind change, wrong kind) | I2, I9 |
| C-3 | 01c §6.4, §6.5 | A draw's stock item must be `prepared`: `422 { field: 'stock_draws.0.stock_item_id', reason: 'wrong_kind' }`, checked with the existing reference check under the stock item's `FOR SHARE` lock (kind is read in the same statement); +0 statements | I9 |
| C-4 | 01c §6.9 | A set (`station_id` not null) needs `kind = prepared`: `422 { field: 'stock_item_id', reason: 'wrong_kind' }`, after the `archived` check; a remove is always allowed | I9 |
| C-5 | 01c §6.6, §6.7, §6.8 | As 08a §6.1–§6.3: list gains `kind?` and `branch_id?` query, new wire fields and `menu_cost`; POST and PATCH take the new fields; PATCH merged rules R4 (kind change in use), R5 (packet unit), R6 (purchase unit resolves); **bump only when `name`, `stock_unit`, `carries_over` or `archived` changes** (I11) | I2, I9, I11 |
| C-6 | 01c §4.6 rule 4 | The builder lists active stock items counted at this branch **and `kind = 'prepared'`** (I9); no schema or statement-count change | I9 |
| C-7 | 01c §5.4 | `StockItemWire` and its version input gain `kind`, `code`, `must_weigh_on_receipt`, `track_piece_count`, `shelf_life_days`, `cost_category`, `is_a_item`, `default_purchase_unit`. Every stored stock item's version string changes once at release: an open owner tab gets one `409 CONFIG_STALE` and reloads (accepted) | I13 |
| C-8 | 01c §8, §9 | Owner-app stock items: kind tabs, new form fields, item page (08a §8); §9 adds reasons `wrong_kind`, `packet_unit`, `not_convertible` and entity `stock_item_code` (08a §9) | I2, I9 |
| A-1 | 01a → **v2.8** §5.2 (`config_audit`) | Entity CHECK widens with `stock_item_unit`, `item_price`, `yield_profile` (in `0018_inventory_config.sql`, as 0014 did); actions unchanged | I4, I6, I8 |
| A-2 | 01a §2 / §3 write script | Named exception: 08a's inventory-only writes end without `bumpConfigVersion` (08a I11) until 08b | I11 |
| R-1 | README | **R39** (08 in Milestone A, slicing, fallback, C1–C12 rulings); module map row **08a**; Milestone A modules + "08a–08d" | owner 2026-11-23 |
| — | 01b | **No change in 08a.** 08a has only owner-app routes (00 / 01a guards). Hub permissions for receiving, waste, counts and closing the sheet come with 08d's 01b bump | I10 |
| — | 03a / `@pos/engine`, 02b, hub | **No change.** The engine's stock input is the snapshot `stock_items[]`, which can only hold `prepared` items (C-3, C-4, C-6). Test #20 and #21 pin it | I9 |
| — | Foundation | **No change in 08a.** The `inventory` stream type (owner ruling C3, bump approved) is written in 08d's spec | — |

---

## §5. Data model and migrations

### 5.1 Cloud — `0018_inventory_config.sql` (expand; one transaction)

```sql
-- 08a §5.1: inventory config. Expand only; no config_version bump (no snapshot content changes, I11).
ALTER TABLE stock_items
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'prepared' CHECK (kind IN ('prepared','ingredient','packet')),
  ADD COLUMN code TEXT CHECK (code ~ '^[A-Z0-9-]{1,16}$'),
  ADD COLUMN must_weigh_on_receipt BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN track_piece_count BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN shelf_life_days INT CHECK (shelf_life_days BETWEEN 1 AND 3650),
  ADD COLUMN cost_category TEXT NOT NULL DEFAULT 'food'
    CHECK (cost_category IN ('food','packaging','cleaning','beverage')),
  ADD COLUMN is_a_item BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN default_purchase_unit TEXT,                      -- resolved by the service (I5); no FK (built-ins are constants)
  ADD CONSTRAINT stock_items_packet_unit CHECK (kind <> 'packet' OR stock_unit = 'g'),
  ADD CONSTRAINT stock_items_piece_count CHECK (NOT track_piece_count OR (stock_unit IN ('g','ml') AND kind <> 'packet')),
  ADD CONSTRAINT stock_items_carries_over_kind CHECK (NOT carries_over OR kind = 'prepared');
CREATE UNIQUE INDEX stock_items_active_code ON stock_items (tenant_id, code)
  WHERE archived_at IS NULL AND code IS NOT NULL;                -- code unique among active (§3.3)
CREATE INDEX stock_items_kind ON stock_items (tenant_id, kind, lower(name)) WHERE archived_at IS NULL;  -- list by kind (§6.1)

CREATE TABLE stock_item_units (                                  -- I4: append-only
  tenant_id TEXT NOT NULL, unit_row_id TEXT NOT NULL,            -- ULID
  stock_item_id TEXT NOT NULL, unit_name TEXT NOT NULL CHECK (unit_name ~ '^[a-z0-9 ._-]{1,20}$'),
  base_unit TEXT NOT NULL CHECK (base_unit IN ('piece','g','ml')),
  factor_num BIGINT NOT NULL CHECK (factor_num BETWEEN 1 AND 1000000000),
  factor_den INT NOT NULL CHECK (factor_den BETWEEN 1 AND 1000000),
  note TEXT CHECK (length(note) <= 200), recorded_by TEXT NOT NULL, created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, unit_row_id),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES owner_users (tenant_id, user_id));
CREATE INDEX stock_item_units_item ON stock_item_units (tenant_id, stock_item_id, unit_name, created_at DESC);
                                                                 -- I5 latest per name; §6.4 history; price write resolve

CREATE TABLE item_prices (                                       -- I6: append-only
  tenant_id TEXT NOT NULL, price_id TEXT NOT NULL,               -- ULID
  stock_item_id TEXT NOT NULL, branch_id TEXT,                   -- null = every branch
  kind TEXT NOT NULL CHECK (kind IN ('manual','market_rate')),
  unit_name TEXT NOT NULL, price_minor BIGINT NOT NULL CHECK (price_minor BETWEEN 1 AND 1000000000),
  stock_qty_num BIGINT NOT NULL CHECK (stock_qty_num >= 1), stock_qty_den BIGINT NOT NULL CHECK (stock_qty_den >= 1),
  stock_unit TEXT NOT NULL CHECK (stock_unit IN ('piece','g','ml')),   -- frozen at write (I6)
  valid_from BIGINT NOT NULL, valid_to BIGINT, CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK ((kind = 'manual') = (valid_to IS NULL)),
  note TEXT CHECK (length(note) <= 200), recorded_by TEXT NOT NULL, created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, price_id),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES owner_users (tenant_id, user_id));
CREATE INDEX item_prices_item ON item_prices (tenant_id, stock_item_id, valid_from DESC, created_at DESC);
                                                                 -- §6.4 history page; §6.1 menu_cost candidates

CREATE TABLE yield_profiles (                                    -- I8: append-only
  tenant_id TEXT NOT NULL, yield_profile_id TEXT NOT NULL,       -- ULID
  stock_item_id TEXT NOT NULL,
  yield_bp INT NOT NULL CHECK (yield_bp BETWEEN 1 AND 50000),
  source TEXT NOT NULL DEFAULT 'manual_test' CHECK (source IN ('manual_test')),
  test_ap_qty BIGINT CHECK (test_ap_qty BETWEEN 1 AND 1000000000),
  test_ep_qty BIGINT CHECK (test_ep_qty BETWEEN 1 AND 1000000000),
  test_unit TEXT CHECK (test_unit IN ('piece','g','ml')),
  CHECK ((test_ap_qty IS NULL) = (test_ep_qty IS NULL) AND (test_ap_qty IS NULL) = (test_unit IS NULL)),
  note TEXT CHECK (length(note) <= 200), recorded_by TEXT NOT NULL, created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, yield_profile_id),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES owner_users (tenant_id, user_id));
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

Notes: the entity list above is 0014's list plus three (the build task re-reads the live CHECK from the test DB first, 01b D-5, and keeps every value). Append-only is enforced by the service (no update / delete statement exists for the three tables) and by test #30; a DB trigger like `config_audit`'s is not added (YAGNI: no second writer). `recorded_by` is the owner user id from the JWT. All existing stock items read as `prepared`, `food`, flags false: no behaviour change for 01c, the engine or any hub (test #22).

### 5.2 Hub

None. No hub migration, no event, no snapshot change.

### 5.3 Wire shapes (`packages/events/src/admin/inventory.ts`; versions in `apps/cloud/src/modules/menu-variants/versions.ts`)

- `StockItemWire` (01c) + `kind`, `code`, `must_weigh_on_receipt`, `track_piece_count`, `shelf_life_days`, `cost_category`, `is_a_item`, `default_purchase_unit`. Version input = 01c §5.4 keys + these eight (C-7).
- `ItemUnitWire { unit_row_id, unit_name, base_unit, factor_num, factor_den, is_current, note, recorded_by, recorded_by_name, created_at }`; `is_current` = latest for its name **and** `base_unit` = the item's `stock_unit` (I5).
- `ItemPriceWire { price_id, branch_id, kind, unit_name, price_minor, stock_qty_num, stock_qty_den, stock_unit, valid_from, valid_to, note, recorded_by, recorded_by_name, created_at }`.
- `MenuCostWire { branch_id: string | null, price_id, per_stock_unit: { num: string, den: string }, display_per: { unit: 'kg' | 'l' | 'piece', minor: number } }` — `num` / `den` as decimal strings (BigInt-safe on the wire); `display_per` = the price of 1 kg / 1 L / 1 piece rounded half up to the minor unit, **for display only**, never stored or reused in a calculation.
- `YieldProfileWire { yield_profile_id, yield_bp, source, test_ap_qty, test_ep_qty, test_unit, note, recorded_by, recorded_by_name, created_at }`.

---

## §6. Endpoints

Owner routes: JWT, tenant guard, password guard. Check order C4. Creating `POST`s run through `withIdempotency`. No cloud route emits an event. Shared failure cases not repeated: `400 VALIDATION_FAILED`, `401 JWT_INVALID`, `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`, `403 PASSWORD_CHANGE_REQUIRED`, `422 IDEMPOTENCY_KEY_MISMATCH`, `503 SERVICE_UNAVAILABLE`. Every route adds its case to `apps/cloud/test/helpers/route-cases.ts` (C7).

**Lock order:** 01c §6 kinds. The three new POSTs lock their stock item `FOR SHARE` (kind 5), so a concurrent PATCH (`FOR UPDATE`: archive, `stock_unit` or `kind` change) serialises with them; the C2 branch check is a plain read; no bump, so kind 10 is skipped (I11).

#### 6.0 Permission, audit and bump per route

| § | Route | Permission | `config_audit` | Bumps |
|---|---|---|---|---|
| 6.1 | `GET /v1/admin/stock-items` (changed) | owner | — | — |
| 6.2 | `POST /v1/admin/stock-items` (changed) | owner covering every branch | `stock_item` / `create` | every branch (a new item can be counted later; 01c kept) |
| 6.3 | `PATCH /v1/admin/stock-items/:id` (changed) | same | `stock_item` / `update`, `archive`, `restore` | every branch **only** if `name`, `stock_unit`, `carries_over` or `archived` changed (I11) |
| 6.4 | `GET /v1/admin/stock-items/:id/inventory` | owner | — | — |
| 6.5 | `POST /v1/admin/stock-items/:id/units` | owner covering every branch | `stock_item_unit` / `create` | none |
| 6.6 | `POST /v1/admin/stock-items/:id/prices` | `branch_id` null: owner covering every branch; else that branch allowed (C2) | `item_price` / `create` (`branch_id` set on the audit row when the price has one) | none |
| 6.7 | `POST /v1/admin/stock-items/:id/yields` | owner covering every branch | `yield_profile` / `create` | none |

01c §6.7's `POST` bump is kept as built (a create is rare and keeps 01c's tests); only PATCH changes.

### Batch 1 — stock items (changed 01c routes)

#### 6.1 `GET /v1/admin/stock-items` (changed, 01c §6.6)

| | |
|---|---|
| Query | `status?` (01c), `kind?` ∈ `prepared`, `ingredient`, `packet` (absent = all), `branch_id?` (for `menu_cost`; C2 `assertBranchAllowed` before any SQL) |
| Response | 01c's, each item + the I2 fields + `kind` + `menu_cost: MenuCostWire \| null` (I7 for `branch_id`, or `branch_id` null = the every-branch price only when the query has none). Order `lower(name)`, id (C3) |
| Queries | **5 fixed**: 01c's 4 + 1 price-candidate read for the listed ids (`stock_item_id = ANY`, `valid_from ≤ now`, not expired, `branch_id IS NULL OR branch_id = $branch`; `item_prices_item`); I7 runs in the service |

#### 6.2 `POST /v1/admin/stock-items` (changed, 01c §6.7) (Idempotency-Key)

Body 01c's + `kind?` (default `prepared`), `code?`, `must_weigh_on_receipt?`, `track_piece_count?`, `shelf_life_days?`, `cost_category?`, `is_a_item?`, `default_purchase_unit?`. Script 01c's; §3.3 rules on the body (a new item has no item units, so `default_purchase_unit` must be its `stock_unit` or a built-in with its base, else `422 not_convertible`). `201 { data: { stock_item } }`. Errors 01c's + `409 CONFIG_NAME_TAKEN { entity: 'stock_item_code' }`, `422` (`packet_unit`, `not_convertible`). Queries: 01c's (key, insert, audit, 3 bump); the code index answers the code clash at insert.

| Edge | Answer |
|---|---|
| `kind: 'packet'`, `stock_unit: 'piece'` | `422 { field: 'stock_unit', reason: 'packet_unit' }` |
| `track_piece_count: true`, `stock_unit: 'piece'` | `400` |
| `carries_over: true`, `kind: 'ingredient'` | `400` |
| `code: 'tp-1'` | stored `TP-1` |
| Code taken by an active item | `409 CONFIG_NAME_TAKEN { entity: 'stock_item_code' }`; taken only by an archived item → `201` |
| Retry with the same key | stored `201` replayed |
| Audit | one `stock_item` / `create`, new fields in `after` |

#### 6.3 `PATCH /v1/admin/stock-items/:stock_item_id` (changed, 01c §6.8)

| | |
|---|---|
| Body | 01c's (`expected_version` + any of `name`, `stock_unit`, `carries_over`, `archived`) + any I2 field + `kind` |
| Script | 01c's: validate → `BEGIN` → lock `FOR UPDATE` (`404 STOCK_ITEM_NOT_FOUND`) → version (`409 CONFIG_STALE`) → payload checks → no-op (`200`, no audit, no bump) → merged rules → write → audit → **bump only if a snapshot field changed (I11)** → `COMMIT` |
| Merged-row rules | 01c **R1** (unit rule on drawers), **R2** (archive with active drawer), **R3** (name) kept; **R4** `kind` changes away from `prepared` with a `stock_item_branches` row (any branch) or an active drawer → `409 CONFIG_IN_USE { used_by: { entity: 'stock_item_branch', ids: [branch_id…] } }` (branch rows first) or `{ entity: 'menu_item', ids }`; **R5** packet unit (`422 packet_unit`); **R6** `default_purchase_unit` resolves on the merged row (current item units read under the lock; `422 not_convertible`); **R7** piece count / carries-over vs kind and unit (`400`); **R8** code unique (index → `409`) |
| Precedence | `400` (R7) → `409` (R2, R4; one drawers read serves R1, R2, R4; one branch-rows read for R4) → `422` (R1, R5, R6) → R3, R8 at the write |
| Queries | 01c's + 1 branch-rows read (only when `kind` changes away from `prepared`) + 1 units read (only when `default_purchase_unit` or `stock_unit` is sent); bump statements only when I11 says so |

| Edge | Answer |
|---|---|
| Only `is_a_item` changes | `200`, one audit row, **no bump** (I11, test #9) |
| `name` and `is_a_item` change | `200`, one audit row, bump every branch |
| `kind: 'ingredient'` on PAYE-COOKED counted at Lake City | `409 CONFIG_IN_USE { used_by: { entity: 'stock_item_branch', ids: ['lake-city'] } }` |
| `kind: 'prepared'` on an ingredient | `200` (it may then get a branch row and drawers) |
| `stock_unit` g → piece on raw paye with units and prices | `200`; older unit rows and prices become "other unit" (I5, I6: ignored by `resolveUnit` / `effectiveMenuPrice`); the item has no menu cost until a price in the new unit is set |
| `default_purchase_unit: 'peti'` with no `peti` unit | `422 { field: 'default_purchase_unit', reason: 'not_convertible' }` |
| Stale tab | `409 CONFIG_STALE` (also on a no-op) |

### Batch 2 — inventory detail, units, prices, yields (new)

#### 6.4 `GET /v1/admin/stock-items/:stock_item_id/inventory`

| | |
|---|---|
| Query | `branch_id?` (C2 assert before SQL) for `menu_cost` |
| Response | `200 { data: { can_edit_tenant, stock_item: StockItemWire, builtin_units: [{ unit_name, base, num, den }] (the built-ins whose base = stock_unit), units: ItemUnitWire[] (every row, newest first), prices: ItemPriceWire[] (newest 100 by valid_from, created_at, for branch_id null and the JWT's allowed branches), menu_cost: MenuCostWire \| null, yields: YieldProfileWire[] (newest 20), active_yield: YieldProfileWire \| null } }` |
| Queries | **6 fixed**: coversEveryBranch, stock item, units, prices (LIMIT 100), yields (LIMIT 20), owner names for `recorded_by` (`= ANY`). `menu_cost` from the price rows read (I7 needs only unexpired candidates; an unexpired candidate is never older than one outside the newest 100 by `valid_from` unless more than 100 newer rows exist — then the item has newer candidates anyway) |
| Errors | `404 STOCK_ITEM_NOT_FOUND` (unknown, foreign), `404 BRANCH_NOT_FOUND` |

#### 6.5 `POST /v1/admin/stock-items/:stock_item_id/units` (Idempotency-Key)

| | |
|---|---|
| Body | `{ unit_name, factor_num, factor_den?: 1, note? }` — "1 `unit_name` = num / den of the item's stock unit". The client turns "1 peti = 12 kg" into `12000 / 1` and "1 piece = 182.5 g" into `1825 / 10` (the server reduces) |
| Script | validate (I4 name rules, ranges) → key → `BEGIN` → lock stock item `FOR SHARE` (`404 STOCK_ITEM_NOT_FOUND`) → active (`422 archived`) → name rules against the **locked** `stock_unit` (`400` when `unit_name` = the stock unit or a built-in) → reduce by gcd → insert (`base_unit` = stock unit) → audit → `COMMIT` |
| Response | `201 { data: { unit: ItemUnitWire } }` |
| Queries | fixed: key, lock, insert, audit (+ key store) |

| Edge | Answer |
|---|---|
| `unit_name: 'KG'` | `400` (built-in) |
| `unit_name: 'piece'` on Anday (`stock_unit: piece`) | `400` (its own stock unit) |
| `unit_name: 'piece'` on raw paye (g) | `201` |
| Second `peti` row with another factor | `201`; the new row is current, the old stays in history (I4) |
| Two tabs add `peti` at once | both `201`; the later `created_at` (then id) is current |
| Retry with the same key | stored `201` replayed |

#### 6.6 `POST /v1/admin/stock-items/:stock_item_id/prices` (Idempotency-Key)

| | |
|---|---|
| Body | `{ kind: 'manual' \| 'market_rate', branch_id: string \| null, unit_name, price_minor, note? }` |
| Script | validate → **auth**: `branch_id` null → `assertTenantWide` (`403 tenant_wide_write`); else the branch must be in `allowed_branch_ids` (C2, checked again inside the transaction) → key → `BEGIN` → branch read (C2 `404 BRANCH_NOT_FOUND`) → lock stock item `FOR SHARE` (`404`) → active (`422 archived`) → read the item's units for `unit_name` → `resolveUnit` with the locked `stock_unit` (`422 not_convertible`) → insert with the frozen conversion, `stock_unit`, `valid_from = now`, `valid_to` per I6 → audit → `COMMIT` |
| Response | `201 { data: { price: ItemPriceWire, menu_cost: MenuCostWire \| null } }` (`menu_cost` for the price's `branch_id`, I7, one more read) |
| Queries | fixed: key, branch read (when set), lock, units read, insert, candidates read, audit |

| Edge | Answer |
|---|---|
| Beef `manual`, every branch, `kg`, Rs 1,500 (`150000`) | `201`; per stock unit `150000 / 1000` = 150 minor per g; `display_per { unit: 'kg', minor: 150000 }` |
| Branch-scoped owner sets `branch_id: null` | `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` |
| Branch-scoped owner, own branch, `market_rate` | `201`; at that branch it beats the every-branch price until `valid_to` (I7) |
| `price_minor: 0` | `400` |
| `unit_name: 'peti'` with no `peti` unit | `422 { field: 'unit_name', reason: 'not_convertible' }` |
| Item archived meanwhile | `422 { field: 'stock_item_id', reason: 'archived' }` |
| `kind: 'quote'` | `400` (POST, §12.4) |

#### 6.7 `POST /v1/admin/stock-items/:stock_item_id/yields` (Idempotency-Key)

| | |
|---|---|
| Body | `{ yield_bp } \| { test_ap_qty, test_ep_qty }`, + `note?` (test quantities in the item's `stock_unit`) |
| Script | validate (one form only; computed `yield_bp` 1 … 50 000, I8) → key → `BEGIN` → lock stock item `FOR SHARE` (`404`) → active (`422 archived`) → `kind = ingredient` (`422 wrong_kind`) → insert (`test_unit` = locked `stock_unit`) → audit → `COMMIT` |
| Response | `201 { data: { yield: YieldProfileWire } }` |

| Edge | Answer |
|---|---|
| Raw beef test: AP 10 000 g, EP 7 120 g | `yield_bp` 7 120 |
| AP 1 000, EP 2 400 (chanay, soaked) | 24 000 |
| AP 1 000, EP 6 000 | `400` (> 50 000) |
| Both forms sent | `400` |
| On PAYE-COOKED (prepared) or TP-1 (packet) | `422 wrong_kind` |

---

## §7. Cross-cutting (this module only)

| Item | Decision |
|---|---|
| Logging | Writes log `{ route, tenant_id, stock_item_id, outcome }`; prices never logged with notes (notes may name suppliers) |
| Performance | Bounded data (tens of items, a few hundred price rows per item per year); no pagination beyond the LIMITs in §6.4 |
| Rate limits | 01a's owner-route limits; nothing new |
| Risks | (1) Owners confuse "menu cost" with real cost — I12 labels. (2) A wrong unit factor silently skews every later cost — the item page shows each unit as a sentence ("1 peti = 12 kg") and the last change with who and when. (3) Version strings change once at release (C-7) — one reload |

---

## §8. Client contract (owner app `apps/client`, entry `owner`)

1. **Stock items list** (`features/owner/stock-items/StockItemList.tsx`): tabs **Prepared · Ingredients · Packets** (the `kind` query); columns name, code, stock unit, A-item badge, **Menu cost** (`display_per`, e.g. "Rs 1,500 / kg", or "No price" in the warning style, never "Rs 0"); branch picker (existing `BranchPicker`) drives `branch_id`. Existing 01c behaviour stays on the Prepared tab (branch rows, drawers).
2. **Item form** (`StockItemForm.tsx`): kind (on create; on edit shows the R4 refusal text with the branches or items that block it), code, stock unit, the I2 fields; fields that do not apply to the kind are hidden (§3.2). Purchase unit is a pick-list of the units `resolveUnit` accepts.
3. **Item page** (new `StockItemInventory.tsx`), three sections:
   - **Units**: built-ins for the stock unit (read-only), the item's current units as sentences, "Add or change a unit" (name + "= N kg / g / L / ml / piece"; the client converts kg / L to g / ml and decimals to num / den), history under a disclosure; rows of another base unit shown greyed with "other unit".
   - **Menu cost** (I12 label and help line): current menu cost for the picked branch; "Set price" sheet with kind **Manual** / **Today's market rate** ("valid for 24 hours"), branch **All branches** / one branch (only those the owner may write), unit pick-list, amount, note; history list (newest first) with who / when / branch / kind.
   - **Yield** (ingredients only): active yield as a percentage with one decimal (`yield_bp / 100`); "Record a test" (AP and EP in kg / g) or "Set yield %"; history.
4. Errors use the existing `errors.*` texts; new reason texts for `wrong_kind`, `packet_unit`, `not_convertible`, and `CONFIG_NAME_TAKEN` with `stock_item_code`. Urdu strings go to the urdu-todo list as in 05.
5. Money and quantities format through the existing client formatters (Rs, kg / L). `display_per` is display only.

---

## §9. Error catalogue additions

No new error codes. New `details` values on existing codes:

| Code | New value | Condition |
|---|---|---|
| `422 CONFIG_REFERENCE_INVALID` | `reason: 'wrong_kind'` | branch row or draw onto a non-prepared item (I9); yield on a non-ingredient (I8) |
| `422 CONFIG_REFERENCE_INVALID` | `reason: 'packet_unit'`, `field: 'stock_unit'` | packet not in g (I2) |
| `422 CONFIG_REFERENCE_INVALID` | `reason: 'not_convertible'`, `field: 'unit_name' \| 'default_purchase_unit'` | unit does not resolve (I5) |
| `409 CONFIG_NAME_TAKEN` | `entity: 'stock_item_code'` | code clash (§3.3) |
| `409 CONFIG_IN_USE` | `used_by.entity: 'stock_item_branch'` (ids = branch ids) | kind change away from prepared while counted (R4) |

---

## §10. Tests

### 10.1 Pure functions (`packages/domain/src/inventory/*.test.ts`)

| # | Case |
|---|---|
| 1 | `BUILTIN_UNITS`: kg 1000/1 g, pao 250/1 g, maund 40000/1 g, l 1000/1 ml, darjan 12/1 piece; names case-insensitive |
| 2 | `resolveUnit`: stock unit → 1/1; built-in with matching base; built-in with other base → null; item unit wins only for its own name; latest row wins; a row whose `base_unit` ≠ current stock unit is ignored; no chains (an item unit `bori` = 2 maund is not accepted — units are written in the stock unit) |
| 3 | `pricePerStockUnit`: Rs 1,500 / kg → 150/1 per g; Rs 3,600 / peti (12 000 g) → 3/10 per g; Rs 400 / darjan (anday) → 100/3 per piece; exact (BigInt), no rounding |
| 4 | `effectiveMenuPrice`: branch-specific before every-branch; latest `valid_from`, then `created_at`, then id; market rate expired after 24 h falls back to the older manual; a newer manual beats an older unexpired market rate; rows in another stock unit ignored; none → null (never 0) |
| 5 | `yieldBpFromTest`: 10 000 / 7 120 → 7 120; 3 / 2 → 6 667 (half up from 6 666.67); 1 000 / 2 400 → 24 000; out of range throws |
| 6 | gcd reduction: 1825 / 10 → 365 / 2 |

### 10.2 Cloud — stock items (`apps/cloud/test/inventory/stock-items.int.test.ts`)

| # | Case |
|---|---|
| 7 | POST each kind; defaults (`prepared`, `food`, flags false); packet in piece → `422 packet_unit`; piece count on piece → `400`; carries_over on ingredient → `400` |
| 8 | Code: uppercased; active clash → `409 stock_item_code`; clash with archived only → `201` |
| 9 | PATCH only `is_a_item` → `200`, one audit row, `config_version` of every branch unchanged (I11) |
| 10 | PATCH `name` + `is_a_item` → bump every branch |
| 11 | PATCH `kind` away from prepared with a branch row → `409 { entity: 'stock_item_branch', ids }`; with only an active drawer → `409 { entity: 'menu_item', ids }`; with an archived drawer only → `200` |
| 12 | PATCH `default_purchase_unit: 'peti'` before / after a `peti` unit exists → `422 not_convertible` / `200` |
| 13 | PATCH stale → `409 CONFIG_STALE`; version-only body → `400` (C9); version string covers every new field (change `is_a_item` → new version) |
| 14 | GET list: `kind` filter; `branch_id` foreign → `404` before SQL; `menu_cost` per I7; 5 statements (pg counter) |
| 15 | Rule precedence: PATCH with `track_piece_count` on piece **and** a kind change in use → `400` first |

### 10.3 Cloud — 01c routes changed (`apps/cloud/test/menu-variants/*` additions)

| # | Case |
|---|---|
| 16 | Item POST / PATCH with a draw onto an ingredient → `422 { field: 'stock_draws.0.stock_item_id', reason: 'wrong_kind' }`; statement count unchanged |
| 17 | Stock-item branch PUT set on a packet → `422 { field: 'stock_item_id', reason: 'wrong_kind' }`; remove on any kind → `200` |
| 18 | Kind change and a branch PUT race (two transactions): one wins, the other `409 CONFIG_IN_USE` or `422 wrong_kind`; never a branch row on a non-prepared item (lock `FOR UPDATE` on the stock item serialises) |
| 19 | Kind change and an item draw write race: same guarantee (draw takes the stock item `FOR SHARE`) |

### 10.4 Snapshot and engine invariant

| # | Case |
|---|---|
| 20 | Builder: a raw-SQL row in `stock_item_branches` pointing at an ingredient (constraint bypass in the test) is **not** in the snapshot's `stock_items[]` (I9 defence) |
| 21 | Snapshot of a tenant with prepared, ingredient and packet items equals the pre-08a snapshot byte for byte when only prepared items are counted (no new keys, same hash) |
| 22 | Migration on a 01c-era database: every stock item `prepared`, `food`, flags false; no `config_version` change; 01c test suite passes unchanged |

### 10.5 Cloud — units, prices, yields (`apps/cloud/test/inventory/*.int.test.ts`)

| # | Case |
|---|---|
| 23 | Unit POST: built-in name `400`; own stock unit `400`; `piece` on a g item `201`; reduce 1825/10 → 365/2; archived item `422`; foreign item `404`; replay |
| 24 | Unit POST then PATCH `stock_unit` → old row `is_current: false`, shown in history |
| 25 | Price POST every-branch by a branch-scoped owner → `403 tenant_wide_write`; foreign branch → `404 BRANCH_NOT_FOUND`; branch price by its owner `201` |
| 26 | Price frozen conversion: set `peti` = 12 kg, price Rs 3,600 / peti, then change `peti` to 10 kg → the stored price keeps 12 000 / 1; `menu_cost` unchanged |
| 27 | Market rate `valid_to = valid_from + 86 400 000`; manual `valid_to` null (DB CHECK); `kind: 'quote'` `400`; `price_minor: 0` `400` |
| 28 | Yield POST: both forms `400`; neither `400`; on prepared / packet `422 wrong_kind`; AP/EP stored with `test_unit`; 6 000 % `400` |
| 29 | Detail GET: 6 statements; prices limited to allowed branches + every-branch; `recorded_by_name` joined; `active_yield` latest |
| 30 | Append-only: no route updates or deletes a unit, price or yield row (route inventory sweep + service has no such statement, grep test as 05's) |
| 31 | Audit: one row per POST with entity / action; price audit row carries `branch_id` |
| 32 | Cross-tenant sweep (C7) for routes 6.4–6.7 |

### 10.6 Client (`apps/client/src/features/owner/stock-items/*.test.tsx`)

| # | Case |
|---|---|
| 33 | Tabs by kind; Menu cost "Rs 1,500 / kg"; no price → "No price" (never "Rs 0") |
| 34 | Unit sentence input "1 peti = 12 kg" sends 12000/1; "1 piece = 182.5 g" sends 1825/10 |
| 35 | Price sheet: branch list only allowed branches; every-branch option hidden for a branch-scoped owner |
| 36 | Labels: the section is "Menu cost"; the string "Today's cost" appears only in the help line (I12) |
| 37 | Yield section hidden for prepared and packet items |

### 10.7 Acceptance

| Source | Check | Test |
|---|---|---|
| 08-g0 §3.1 seeds, item-specific paye g / piece | built-ins + item unit | 1, 2, 23 |
| §3.1 "on-hand never recomputed" | frozen conversion | 26 |
| §3.2 item master fields | kind + I2 | 7, 8, 12 |
| §3.4 price history, user + note | append-only + audit | 27, 30, 31 |
| §3.5 step 2 resolution | I7 | 4, 14 |
| §3.6 yield | I8 | 5, 28 |
| D9 missing price never 0 | null menu cost | 4, 33 |
| Owner C3: engine never sees inventory | I9 | 16–22 |
| §7 drill 1 (data entry part) | AP / EP test + piece unit | 23, 28 |

---

## §11. Build order

1. `0018_inventory_config.sql` + schema test (live CHECK names first, 01b D-5) — §5.1 — tests 22.
2. `@pos/domain/src/inventory/{units,prices,yield}.ts` + index exports — §3.1 I3–I8, §4.2 — tests 1–6.
3. Wires `packages/events/src/admin/inventory.ts`; `StockItemWire` + version input in `menu-variants/versions.ts` — §5.3, C-7 — test 13.
4. Stock-item POST / PATCH / list changes in `apps/cloud/src/modules/menu-variants/` (service, repository, routes) — §6.1–§6.3, I11 — tests 7–15.
5. 01c route guards: draw kind check, branch PUT kind check — C-3, C-4 — tests 16–19.
6. Builder filter `kind = 'prepared'` — C-6 — tests 20, 21.
7. New module `apps/cloud/src/modules/inventory/` (routes, service, repository): §6.4 detail — test 29.
8. §6.5 units — tests 23, 24.
9. §6.6 prices — tests 25–27.
10. §6.7 yields — test 28.
11. Audit + append-only + route cases — tests 30–32.
12. Owner app: list tabs and Menu cost column; form fields — §8.1, §8.2 — tests 33.
13. Owner app: item page (Units, Menu cost, Yield) — §8.3 — tests 34–37.
14. Spec bumps applied: 01c v1.2, 01a v2.8, README — §4.5.

About 14 tasks: inside the size budget (7 routes, 4 new).

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done
- Tests 1–37 green in the gate; no change to any hub, engine or 02b test.
- A 01c-era database migrates with no behaviour change (test 22) and no `config_version` bump.
- Owner app shows Menu cost with the I12 label everywhere; "No price" never reads as zero.
- 01c v1.2, 01a v2.8 and README carry the §4.5 rows with markers.

### 12.2 Endpoint checklist

| § | Route | Status codes |
|---|---|---|
| 6.1 | GET stock-items | 200, 401, 403, 404 (branch) |
| 6.2 | POST stock-items | 201, 400, 401, 403, 409, 422 |
| 6.3 | PATCH stock-items/:id | 200, 400, 401, 403, 404, 409, 422 |
| 6.4 | GET stock-items/:id/inventory | 200, 401, 403, 404 |
| 6.5 | POST …/units | 201, 400, 401, 403, 404, 422 |
| 6.6 | POST …/prices | 201, 400, 401, 403, 404, 422 |
| 6.7 | POST …/yields | 201, 400, 401, 403, 404, 422 |

### 12.3 Open questions

| # | Question | Default if not answered |
|---|---|---|
| OQ-1 | Spec files: one growing `08_Inventory_Costing_Spec` (08a now, 08b–08d appended) or one file per slice (`08b_…`, as 03a / 03b)? This file is named as the owner ruled (C12) and holds 08a | One file per slice from 08b; this file keeps its name |
| OQ-2 | Who enters branch market rates at Lake City? 08a needs an owner-app user scoped to the branch (I10); the manager has none today | Owner enters rates himself until 08d's hub screen exists |
| OQ-3 | Market rate valid 24 h from entry, or until the branch's day close? (24 h needs no hub data in the cloud) | 24 h |
| OQ-4 | `price_minor` 0 refused (D9). Any item the owner gets free (own produce)? | Refused |

### 12.4 Deferred until needed

| Item | Why not now |
|---|---|
| `quote` prices, `supplier_id` on prices and yields, supplier-scoped yield resolution | POST (08-g0 §5) |
| Price-jump owner alert (X %) | POST (08-g0 §3.4) |
| Backdated prices / restatement | POST (`SaleCostRestated`, 08-g0 §5) |
| Tenant-defined global units (e.g. a tenant-wide `bori`) | Every pack unit seen so far differs by item; item units cover them |
| Retiring an item unit | A corrected factor supersedes; no pilot case needs removal |
| `purchased_prepared` kind | No pilot item |
| `visibility_scope` | 08b (recipes) |
| Bulk "today's mandi rates" entry for several items | Five A-items; per-item entry first, measure |
