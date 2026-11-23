# 08 — Inventory & Costing — Module Spec v1.1 (APPROVED)

**v1.1 — APPROVED (owner 2026-11-24 00:18 PKT, 08b).** One file for the module (owner OQ-1): **Part A = 08a** inventory config (v1.0.1, as built on main), **Part B = 08b** recipes + cost engine (v1.0, below). 08c and 08d are added here as later versions. Part A changes from 08b's §4.5 rows P-1 – P-3 carry "⚠️ Changed by 08b v1.0 (P-n)": the no-bump rule I11 is replaced by Part B's B16 (inventory writes bump), the 08a POST / PATCH statement counts and tests #9, #25, #28, #31, #35 follow, R4 refuses a `kind` change of a recipe owner, and `BUILTIN_UNITS` gains `lb` / `oz`.

# Part A — 08a Inventory config (v1.0.1, as built)


**v1.0.1 — as-built patch (2026-11-23), no behaviour change.** Records the build's AD-rows that differ from v1.0 text (`docs/plans/08a-status.md` Z1, AD-1 – AD-12, G-1). AD-10 and AD-11 owner-approved; G-1 owner ruling (→ AD-5). Markers "⚠️ v1.0.1 (AD-n)". One line per item:
- **AD-11** §7 Logging: no explicit write log line (no 01a / 01c config write logs one; the owner request logger exposes only `error`) → §12.4 deferred. Notes are still never logged.
- **AD-5 / G-1** test 23 and §12.1: the 01c suite passes unchanged **except #35** and the wire-shape expected values of **#28**, plus two non-numbered fixtures (`menu-variants/versions.test.ts` version input, client `owner/menu/ItemSections.test.tsx`), each marked "⚠️ 08a C-7 / C-5"; no logic or assertion change.
- **AD-8** §6.3 Queries: R4 adds one drawers read when R1 / R2 do not run (the precedence row's shared read); `code: null` skips R7's read (a null never clashes); R7 also runs on an archived merged row.
- **§5.3** `MenuCostWire.branch_id` = the branch of the chosen price row; `null` when the every-branch price won.
- **Audit `after`** of units, prices and yields = the wire without display fields (`recorded_by_name`, `is_current`) + `stock_item_id`.
- **AD-3** each new route adds its own `ROUTE_CASES` entry (§6); the C7 sweep and append-only tests stay one task.
- **AD-10** `AuditEntity` (`apps/cloud/src/lib/config-audit.ts`) mirrors A-1's three entities; **AD-6** the 05 billing-settings test pins `scratchDatabaseAt(18)`.
- **AD-12** test 26 skips its git comparison in CI's shallow checkout; the gate's hub + engine jobs are the evidence there; the git check runs locally.
- **AD-1** `CloudTestHooks` (`apps/cloud/src/server.ts`) gains the optional `afterStockItemLock?(route)` (test only). **AD-2** `STOCK_ITEM_COLUMNS` carries the four new columns. **AD-7** the price-candidate read exists twice (inventory repository, stock-items list): cleanup later.
- Follow-ups (not spec rules, board): the cross-tenant test's 404 list lacks the four 08a routes; the item page's route moves to `router.ts`.


**v1.0 — APPROVED (owner, 2026-11-23 19:58 PKT, "approve karo").** Reviews: hostile run 1 (`docs/reviews/08a_v0.1_hostile_run1.md`), targeted check (`08a_v0.2_targeted_check.md`), spot check (`08a_v0.3_spot_check.md`), final check (`08a_v0.5_final_check.md`: 6/6 ✓, checklist 27/27, "Ready for owner approval: YES", 2 NIT). The two NITs are folded here (markers "⚠️ v1.0 (Q-n)"): **Q-1** I11's reason no longer says market rates are daily (since OQ-3 a rate may hold up to 30 days); **Q-2** C-3 / I9 place the `kind` check right after the draw's own reference check, so its order against the other references of the step is the draw's `not_found` / `archived` order today. The §4.5 rows are applied in the same commit: **01c → v1.2** (C-1 – C-10), **01a → v2.8** (A-1, A-2), README (R-1). No other change from v0.5. **Next: plan** `docs/plans/08a-plan.md` (pipeline step 5).


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
| Version | **v1.0.1 — APPROVED, as built** (2026-11-23, AD-rows). **v1.0 — APPROVED** (owner 2026-11-23). v0.5 — DRAFT (spot check fixed). v0.4 — DRAFT (owner answers OQ-1 – OQ-4). v0.3 — DRAFT (targeted check fixed). v0.2 — DRAFT (run 1 fixed). v0.1 — DRAFT |
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
| I3 | **Built-in units are constants, not data** (`@pos/domain` `BUILTIN_UNITS`): `kg` = 1 000 g, `pao` = 250 g, `maund` = 40 000 g, `l` = 1 000 ml, `darjan` = 12 piece. Names case-insensitive, stored lowercase. They are physical or trade facts, the same for every tenant: no seed, no table, no 00 CLI change. `tray` is **not** built in (24 or 30 by supplier): it is an item unit on Anday | 08-g0 §3.1 seed list; R18 covers settings that differ by restaurant, these do not | 08-g0 §3.1 "seed globals" as rows → constants; tenant-defined global units deferred (§12.4) ⚠️ Changed by 08b v1.0 (P-3): `BUILTIN_UNITS` gains **`lb`** = 45 359 237 / 100 000 g and **`oz`** = 45 359 237 / 1 600 000 g (exact BigInt fractions; built-ins are domain constants, so `stock_item_units`' `factor_den ≤ 10^6` does not bind them); no gallon |
| I4 | **Item units, append-only versions.** A row `stock_item_units { stock_item_id, unit_name, base_unit, factor_num, factor_den }` means "1 `unit_name` = `factor_num / factor_den` `base_unit`", `base_unit` = the item's `stock_unit` at write time. A newer row for the same `(stock_item_id, unit_name)` supersedes the older (latest `created_at`, then id); rows are never updated or deleted. `unit_name`: 1–20 chars, trimmed, lowercase, `[a-z0-9 ._-]`; **not the item's own `stock_unit`**; **not a built-in whose base is the item's `stock_unit`** (that built-in already resolves). ⚠️ v0.2 M-4: a built-in name whose base differs **is** allowed — `l` on ghee stocked in g (1 l = 920 g), `kg` on a piece item bought by weight (1 kg = 5 / 7 piece); `piece` on a g / ml item (paye: 1 piece = 182.5 g → 365 / 2), `g` / `ml` on a piece item. `factor_num` 1 … 1 000 000 000, `factor_den` 1 … 1 000 000, stored reduced by their gcd. **On-hand stock and stored prices are never recomputed** when a unit changes (08-g0 §3.1) | Exact ratios with integers (owner ruling C4 (a)); per-litre ghee and per-kg pricing of piece items without paisa loss | 08-g0 `UnitConversionDefined` event → config rows (C7 (a): config is cloud-canonical) ⚠️ Changed by 08b v1.0 (P-3): `lb` / `oz` cannot be an item unit on a g item (they resolve already) and may be one on a piece item; an item unit already named `lb` / `oz` keeps resolving with its own factor (I5 step 2), no migration |
| I5 | **Resolving a unit for an item** (`resolveUnit(item, unitName, itemUnits)`), direct only, no chains, in this order (⚠️ v0.2 M-4): (1) `unitName = item.stock_unit` → 1/1; (2) the item's latest item unit with that name **whose `base_unit` = the item's current `stock_unit`**; (3) a built-in whose base = the item's `stock_unit`; else not convertible. Step 2 never collides with step 3 (I4 refuses that name). A unit row whose `base_unit` is not the item's current `stock_unit` is ignored and shown as "other unit" in history; ⚠️ v0.2 m-6: if the item's `stock_unit` later changes back, those rows (and prices in that unit, I7) count again — intended: they were right for that unit, and no row is ever rewritten | One rule for every later slice (08b recipe save, 08d receipt) | — |
| I6 | **Price list ("menu cost").** Append-only rows `item_prices { stock_item_id, branch_id, kind ∈ manual \| market_rate, unit_name, price_minor, stock_qty_num, stock_qty_den, stock_unit, created_at, valid_until_at, note, recorded_by }`. At write the server resolves `unit_name` (I5) and **freezes** the conversion (`stock_qty_num / stock_qty_den` stock units per 1 `unit_name`) and the item's `stock_unit`. `price_minor` 1 … 1 000 000 000 (0 refused: a free item is not a price, D9). A price takes effect at `created_at` (no backdating; restatement is POST, §12.4). `manual`: `valid_until_at` null, `branch_id` **must be null** (⚠️ v0.2 M-6: a branch manual price could never be removed; one pilot branch needs none). `market_rate`: the owner sets its validity when he enters it (⚠️ v0.4 OQ-3): `valid_for_hours` 1 … 720, default 24, `valid_until_at = created_at + valid_for_hours × 3 600 000` (08-g0 §3.4 said "today only"; the owner chose an entered validity); `branch_id` null (tenant mandi rate) or one branch. Price per stock unit = `price_minor × stock_qty_den / stock_qty_num` minor units, a fraction, never rounded or stored. ⚠️ v0.2 m-12: BIGINT columns reach the service as strings and are read with `BigInt(string)`, never `Number()` (01c §5.4's canonicalisation helper is not used for prices) | Owner ruling C7 (a): plate cost in the owner app from day one; a frozen conversion keeps old prices meaningful when a unit is corrected | 08-g0 `PriceObserved` event (manual, market_rate) → config rows; `price_per_stock_unit NUMERIC(14,4)` → a fraction (C4 (a)); ⚠️ v0.2 m-7: `valid_from` / `valid_to` → `created_at` / `valid_until_at` (F §6.6 `_at`) |
| I7 | **Effective menu price** (`effectiveMenuPrice(rows, branchId, nowMs, stockUnit)`, pure): candidates are rows with `stock_unit` = the item's current `stock_unit`, `created_at ≤ now` and (`valid_until_at` null or `now < valid_until_at`). If any candidate has `branch_id = branchId`, choose among those; else among `branch_id` null. Within the chosen set the latest wins: `created_at` desc, then `price_id` desc. Kind does not rank: a newer market rate beats an older manual price and the reverse (08-g0 §3.5 step 2). A branch market rate expires at its `valid_until_at` and the branch falls back to the every-branch set by itself. No candidate → `null` (**no price**; 08b marks the cost `partial`, D9; never 0) | 08-g0 §3.5 step 2, D9 | — |
| I8 | **Yield profiles, append-only.** `yield_profiles { stock_item_id, yield_bp, test_ap_qty, test_ep_qty, test_unit, note, recorded_by }`; `yield_bp` 1 … 50 000 (0.01 % … 500 %, D8 `0 < y ≤ 5`). Sent either as `yield_bp` or as both test quantities in the item's `stock_unit` (1 … 1 000 000 000), then `yield_bp = round_half_up(ep × 10 000 / ap)`, refused (`400`) outside 1 … 50 000. The active profile is the latest row. The source is always a manual test in the pilot (no column, ⚠️ v0.2 cut-4; 08-g0's `batch_avg` is POST and adds it). **Ingredient only** (`422 wrong_kind`): a packet is already edible, a prepared item's yield is its batch recipe (08b) | Owner ruling C4 (a): `yield_bp`; drill 1 records the test cut | 08-g0 `yield` fraction → basis points |
| I9 | **Only `prepared` stock items reach the engine.** A `stock_item_branches` row (counted at a station) may point only at a `prepared` stock item (`422 wrong_kind`, C-4). **Draw rule (⚠️ v0.3 N-3, the one statement C-3, C-9 and §3.3 use):** a **sent** draw (`stock_draws` in the body of any item POST or PATCH, active or archived item) must be `prepared`, checked in C4's reference step with the existing `FOR SHARE` read: `not_found`, then `archived` **only when the merged item is active** (01c's `requireActive`; an archived item may keep a draw onto an archived stock item until R9 at its restore), then `wrong_kind` (⚠️ v0.5 P-1); a **stored** draw is checked by R9b when the merged item is active and `stock_draws` is not sent (a restore, or an ordinary PATCH over raw-edited data), after R9 (`archived` first, then `wrong_kind`). Both answer `422 { field: 'stock_draws.0.stock_item_id', reason: 'wrong_kind' }` (⚠️ v0.2 M-1). Changing `kind` away from `prepared` is refused while the item has a `stock_item_branches` row or an active drawer (`409 CONFIG_IN_USE`); an archived drawer does not block it, and is then caught at its restore. The builder also filters `kind = 'prepared'`. So `EngineState.stock`, the hub stock page and 02b's reservations never see an ingredient or packet, and **no engine or hub code changes** | Owner ruling C3 (a): the engine never sees inventory stock; an invariant at the write plus a builder filter is cheaper and safer than filters in engine code | 01c §6.4, §6.5, §6.8, §6.9, §4.6 rule 4 (rows C-3 – C-6, C-9) |
| I10 | **Who may write** (⚠️ v0.2 M-5, cut-1). P1 has one owner covering every branch (01b B8), so **every 08a write is a tenant-level write**: `assertTenantWide` inside the transaction (S8's check, without the bump). A price's `branch_id` is the price's scope, not the writer's. 08-g0's "MGR+" is met by the owner alone in the pilot; managers enter nothing in the cloud. Hub permissions are 08d's | Reuses 00 / 01a guards; no user the pilot cannot have | — |
| I11 | **Inventory-only writes do not bump `config_version`.** Item units, prices, yields, and a stock-item PATCH that changes only fields absent from every snapshot (`kind`, `code`, `cost_category`, `is_a_item`) write and audit but do not bump: no hub reads them in 08a, so a bump would make every hub append `BranchConfigApplied` and refetch an identical snapshot, on every price, unit or yield entry (⚠️ v1.0 Q-1: was "(market rates are daily)"). A stock-item PATCH that changes `name`, `stock_unit`, `carries_over` or `archived` bumps every branch as 01c §6.8 does. ⚠️ v0.3 N-6: the tenant-wide check is unchanged: 01c's writes already run `assertTenantWide` as their first statement inside the transaction (after the idempotency key, on a POST; ⚠️ v0.5 P-5) and then `bumpEveryBranch` without a second read (`lib/config-version.ts`); a no-bump write keeps the first and drops the two bump statements; the three new POSTs do the same. **08b changes this rule** when it adds the inventory snapshot key | Avoids pointless hub refetch; keeps the bump tied to snapshot content | 01a S8, S26 and the §6 common write script; 01c §6.8 (rows A-2, C-5) ⚠️ Changed by 08b v1.0 (P-1): **replaced by Part B's B16** — item units, prices, yields and a stock-item PATCH of `kind` / `code` / `cost_category` / `is_a_item` now bump (every branch; a branch market rate bumps only that branch); A-2's exception in 01a is removed |
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
| `@pos/domain` `inventory/yield.ts` | `yieldBpFromTest(ap: number, ep: number) → number` (I8, half up); `activeYield(rows) → YieldRow \| null` | 08b ⚠️ Changed by 08b v1.0 (P-1): done in Part B (`inventory` key B15, bump rule B16; no `ck_only` in the pilot, owner ruling) |
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
| C-3 | 01c §6.4, §6.5 | The **sent** half of the I9 draw rule: on any item POST / PATCH that sends `stock_draws`, in C4's reference step after `not_found` and, for a merged-active item, `archived` (⚠️ v0.5 P-1), placed right after the draw's own `assertReference`, so its order against the step's other references (variant group, category, tax class) is the draw's existing order (⚠️ v1.0 Q-2): `422 { field: 'stock_draws.0.stock_item_id', reason: 'wrong_kind' }`, read in the existing `FOR SHARE` reference statement (`shareStockItem` returns `kind`); +0 statements | I9 |
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
  - `MenuCostWire { branch_id: string | null /* ⚠️ v1.0.1: branch of the chosen price row; null = the every-branch price won */, price_id, per_stock_unit: { num: string, den: string }, display_per: { unit: 'kg' | 'l' | 'piece', minor: string, below_one_minor: boolean } }` — BigInt-safe decimal strings. `display_per` = the price of 1 kg / 1 L / 1 piece rounded half up to the minor unit; ⚠️ v0.2 m-1: when the exact value is above 0 and rounds to 0, `minor` is `"1"` and `below_one_minor` is true (shown "< Rs 0.01"), so a real price never reads Rs 0. Display only, never stored or reused in a calculation.
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
| 6.3 | `PATCH /v1/admin/stock-items/:id` (changed) | same | `stock_item` / `update`, `archive`, `restore` | every branch **only** if `name`, `stock_unit`, `carries_over` or `archived` changed (I11) ⚠️ Changed by 08b v1.0 (P-1): every snapshot-visible change bumps, including `kind`, `code`, `cost_category`, `is_a_item` (they are in `inventory.items[]`) |
| 6.4 | `GET /v1/admin/stock-items/:id/inventory` | owner | — | — |
| 6.5 | `POST /v1/admin/stock-items/:id/units` | owner covering every branch (`assertTenantWide`) | `stock_item_unit` / `create` | none ⚠️ Changed by 08b v1.0 (P-1): bumps every branch |
| 6.6 | `POST /v1/admin/stock-items/:id/prices` | same | `item_price` / `create` (`branch_id` on the audit row = the price's) | none ⚠️ Changed by 08b v1.0 (P-1): bumps that branch only for a branch market rate, else every branch |
| 6.7 | `POST /v1/admin/stock-items/:id/yields` | same | `yield_profile` / `create` | none ⚠️ Changed by 08b v1.0 (P-1): bumps every branch |

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
| Merged-row rules | 01c **R1** (unit rule on drawers), **R2** (archive with active drawer), **R3** (name) kept; **R4** `kind` changes away from `prepared` with a `stock_item_branches` row (any branch) or an active drawer → `409 CONFIG_IN_USE { used_by: { entity: 'stock_item_branch', ids: [branch_id…] } }` (branch rows first) or `{ entity: 'menu_item', ids }`; **R5** packet unit (`422 packet_unit`); **R6** carries-over vs kind (`400`); **R7** code unique among active (one read, only when `code` is sent and differs; `409 stock_item_code`) ⚠️ Changed by 08b v1.0 (P-2): **R4** also refuses a `kind` change of a stock item that owns a non-archived recipe → `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }` (+1 read of `recipes`, only when `kind` changes) |
| Precedence | `400` (R6) → `409` (R2, R4; one drawers read serves R1, R2, R4; one branch-rows read for R4) → `422` (R1, R5) → R7 (`409` code) → R3 (`409` name, index at the write) |
| Queries | 01c's + 1 branch-rows read (only when `kind` changes away from `prepared`) + 1 drawers read for R4 when R1 / R2 do not run (⚠️ v1.0.1 AD-8) + 1 code read (R7, when `code` is sent non-null and differs; also on an archived merged row) − 2 bump statements when no snapshot field changed (I11) |

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
| Queries | **7 fixed** (⚠️ v0.2 m-2): key insert, tenant-wide, lock, insert, audit, key response, prune. ⚠️ Changed by 08b v1.0 (P-1): **9** (+2 bump statements) |

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
| Queries | **9 fixed** without `branch_id`, **10** with (key, tenant-wide, lock, [branch read], units read, insert, candidates, audit, key response, prune) ⚠️ Changed by 08b v1.0 (P-1): **11** without `branch_id` (+2, every branch), **11** with (+1, that branch) |

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
| Queries | **7 fixed**: key, tenant-wide, lock, insert, audit, key response, prune. ⚠️ Changed by 08b v1.0 (P-1): **9** (+2 bump statements) |

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
| Logging | ⚠️ v1.0.1 (AD-11): no write log line (as 01a / 01c config writes); deferred, §12.4. Notes are never logged (they may name suppliers) |
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
| 1 | `BUILTIN_UNITS`: kg 1000/1 g, pao 250/1 g, maund 40000/1 g, l 1000/1 ml, darjan 12/1 piece; names case-insensitive ⚠️ Changed by 08b v1.0 (P-3): plus `lb` 45359237/100000 g and `oz` 45359237/1600000 g; Rs 1 000 per lb → per g = 1 000 × 100 × 100 000 / 45 359 237 minor (exact) |
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
| 9 | PATCH only `is_a_item` → `200`, one audit row, every branch's `config_version` unchanged; statement count = the bump path's − 2 (I11, N-6) ⚠️ Changed by 08b v1.0 (P-1): now **bumps every branch** (the field is in `inventory.items[]`); count = the bump path's |
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
| 23 | 01c suite passes unchanged **except #35** (4 → 5 statements, C-5) and, ⚠️ v1.0.1 (AD-5), the wire-shape expected values of #28 plus the `versions.test.ts` and client `ItemSections.test.tsx` fixtures (C-7); no logic or assertion change |

### 10.4 Snapshot and engine invariant

| # | Case |
|---|---|
| 24 | Builder: a raw-SQL row in `stock_item_branches` pointing at an ingredient (constraint bypass in the test) is **not** in the snapshot's `stock_items[]` (I9 defence) |
| 25 | Snapshot of a tenant with prepared, ingredient and packet items, where only prepared items are counted, equals the pre-08a snapshot byte for byte (no new keys, same hash) ⚠️ Changed by 08b v1.0 (P-1): inverted — top-level keys gain `inventory`; builder count 23 → **28**; ingredient / packet items change `inventory.items[]` and bump (`inventory-filter.int.test.ts`) |
| 26 | No engine / hub / 02b test changes: the gate's hub and engine projects pass without edits (⚠️ v1.0.1 AD-12: the git comparison skips in CI's shallow checkout and runs locally) |
| 27 | Migration on a 01c-era database: every stock item `prepared`, `food`, not A-item; no `config_version` change |

### 10.5 Cloud — units, prices, yields (`apps/cloud/test/inventory/*.int.test.ts`)

| # | Case |
|---|---|
| 28 | Unit POST: `kg` on a g item `400`; own stock unit `400`; `piece` on a g item `201`; `l` on ghee (g) `201`; `kg` on a piece item `201`; reduce 1825/10 → 365/2; archived item `422`; foreign item `404`; replay; 7 statements ⚠️ Changed by 08b v1.0 (P-1): statements **9** |
| 29 | Unit POST then PATCH `stock_unit` → old row `is_current: false`, in history; ⚠️ v0.3 N-1: ghee `peti` row A (base g, 12 kg) → `stock_unit` piece → `peti` row B (base piece) → `stock_unit` g: row A `is_current: true`, row B false, and `resolveUnit(ghee, 'peti')` = 12 000 g |
| 30 | ⚠️ v0.2 M-3: detail GET with 101 expired market rates and 1 older manual → `menu_cost` = the manual; history shows 100 rows; 7 statements |
| 31 | Price POST: manual + `branch_id` `400`; `branch_id` unknown / foreign `422 { field: 'branch_id', reason: 'not_found' }`; market rate at a branch `201`; 9 / 10 statements ⚠️ Changed by 08b v1.0 (P-1): statements **11 / 11** |
| 32 | Price frozen conversion: `peti` = 12 kg, Rs 3,600 / peti, then `peti` = 10 kg → the stored price keeps 12 000 / 1; `menu_cost` unchanged |
| 33 | Market rate without `valid_for_hours` → `valid_until_at = created_at + 86 400 000`; with 72 → `+ 259 200 000`; `0`, `721`, or with `manual` → `400`; manual `valid_until_at` null (DB CHECKs, ⚠️ v0.4 OQ-3); `kind: 'quote'` `400`; `price_minor: 0` `400` |
| 34 | Append-only: no route updates or deletes a unit, price or yield row (route inventory + a grep test on the module for `UPDATE` / `DELETE` against the three tables, as 05's) |
| 35 | Yield POST: both forms `400`; neither `400`; on prepared / packet `422 wrong_kind`; AP / EP stored with `test_unit`; 6 000 % `400`; 7 statements ⚠️ Changed by 08b v1.0 (P-1): statements **9** |
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
- Tests 1–41 and 19b green in the gate; no hub, engine or 02b test edited; the 01c suite passes with only #35 changed (4 → 5) and the AD-5 wire-shape lines (⚠️ v1.0.1).
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
| ⚠️ v1.0.1 (AD-11) Write log line `{ route, tenant_id, stock_item_id, outcome }` | No config write logs one today; add with a shared logger for all owner writes |

---

# Part B — 08b Recipes + cost engine (v1.0)

**v1.0 — APPROVED (owner 2026-11-24 00:18 PKT, "8b approve").** Folded from `08b_Recipes_Cost_Part_v0.4.md` (kept as history with v0.1–v0.3) plus the final-check MINORs f-1 – f-4 and NITs n-1 – n-3 (`docs/reviews/08b_v0.4_final_check.md`, markers "⚠️ v1.0 (id)"). OQ-7 unanswered → its default stands (the builder logs `inventory_key_invalid` and still sends the key). Reviews: hostile run 1 (`08b_v0.1_hostile_run1.md`), run 2 (`08b_v0.2_hostile_run2.md`), targeted check (`08b_v0.3_targeted_check.md`), final check (`08b_v0.4_final_check.md`). **Inside Part B, "§n" means Part B's section; Part A (08a) is cited as "08a §n".** The §4.5 rows are applied with this version (Part A markers "⚠️ Changed by 08b v1.0 (P-n)"; other specs bumped, README).

**Part B draft history (v0.1 – v0.4):**

**v0.4 — DRAFT (2026-11-24), fixes the targeted check (run 3)** (`docs/reviews/08b_v0.3_targeted_check.md`: 0 BLOCKER, 4 MAJOR, 8 MINOR; run-2 rows left ✗ there: N-1, N-4, N-6, n-1, n-2). No owner ruling needed. Next: **a second targeted check on T-1 … T-4 and t-1 … t-8 only**, as the check asked. Markers "⚠️ v0.4 (id)". Still the 08b part of module 08 (module OQ-1: folded into `08_Inventory_Costing_Spec` at approval).

**Changes in v0.4, one line per id:**
- **T-1** the dead end is gone: an **archived** recipe accepts a draft save, and **publishing that draft runs every B6 check on the current owner and lines and, when they pass, publishes the version and un-archives the recipe in the same transaction** (one `recipe` / `restore` audit row in the same insert; +1 statement). A draft save derives `basis`, `measure_unit` and `batch_stock_unit` from the **locked owner row** (B3), so after a legal owner edit (karahi piece → g) the owner writes a new `per_measure` draft and publishes it. Restore of the **old** version stays refused when its checks fail; its `422` names the way forward ("save a new draft and publish"). Lock order unchanged (kind 0 first on publish). Counts: draft 17 / 16 (owner row read under lock), publish 17 / 16 / 16 / 15 + 1 on an archived recipe. Test 18b (karahi piece → g → new `per_measure` recipe publishes, recipe active again).
- **T-2** a `per_measure` version **freezes `measure_unit ∈ g, ml`** (the owner's `sale_unit` at draft save; CHECK `(basis = 'per_measure') = (measure_unit IS NOT NULL)`). Publish and restore refuse `measure_unit ≠` the owner's current `sale_unit` (`422 basis_mismatch`); the snapshot's `recipes[]` carries it; the engine treats a `per_measure` recipe on a line of another sale unit, or a `per_unit` recipe on a g / ml line (and the reverse), as unknown (`partial`) — the backstop for superseded versions. **No new 01c rule**: C-14 already refuses any `sale_unit` change (g ↔ ml included) while the owner has a non-archived recipe, and the archived path is now covered by these checks and the backstop (smallest change). B17 wording: "any `sale_unit` change". Tests 2, 18, 18b.
- **T-3** §4.3 08d row and §4.2 "Used by" state the rule both slices use: **"not configured" = the `inventory` key is absent, or `buildCostInputs` returns no items — never a whole-key `InventorySnapshotSchema.safeParse`; that schema is for the builder and tests.** 08d's own text is aligned by its author (08d S2 / §3.3 row "fails `InventorySnapshotSchema`", m-2, R-b (2)).
- **T-4** §4.3 08d row carries 08d **v0.3** R-b (3) verbatim; the `stockItemUnitCost` sentence is replaced (08d takes an A-item's menu cost from 08a `pricePerStockUnit(effectiveMenuPrice(…))`, 08d M-7); `stockItemUnitCost` stays exported for the owner app's line costs only. §4.3 08c row carries 08d v0.3 R-c's signature verbatim (input `count_seq_by_item`, output `sold_after_count`, `revenue_minor`).
- **t-1** `buildCostInputs` replaces each snapshot price row's `created_at` with its **rank** per item (0, 1, 2 … by `created_at`, then `price_id`): every rank is below any hub clock (all rows in effect) and 08a I7's order is kept exactly. No builder change. Test 27.
- **t-2** §6.3 conflict path = **7** (key, tenant-wide, owner, insert 0 rows, existing-id read, stored `409`, prune). Test 13.
- **t-3** `SaleLineShape` gains `deal_qty?: bigint`: on a g / ml deal-part line, a plain option's multiplier = `deal_qty` (01c B2 / `menu-lines.ts`), not 1. Test 6.
- **t-4** §6.4 script names the owner read: "owner row (`FOR SHARE`, kind 1 / 4) for a menu-item / option owner; the owner (if a stock item) + line stock items `FOR SHARE` (kind 5, one `= ANY`)", as §6.5.
- **t-5** `buildCostInputs` uses a separate **lenient element set** `InventoryElementsLenient` (same objects, enum-like fields `z.string()`); the typed `InventorySnapshotSchema` stays for the builder and tests. Test 10.
- **t-6** `plateCost` and `dealCost` return `known: boolean` (at least one line known); `CostWire.minor = null` when `!known` ("No cost yet · partial"). Tests 2, 6, 29.
- **t-7** (a) §4.3 08c row: "Σ `explodeUsage` over the lines 08c's rules count (sale, comp, and the void dispositions of 08c / 08d R-c)". (b) The snapshot's `recipes[]` now carries the versions of **archived** recipes too (published + ≤ 3 superseded, `recipe_archived: true`), so a line sold before an archive still explodes at that night's close; `publishedByOwner` skips archived recipes (no new sale gets a cost from them). Test 23.
- **t-8** P-3: existing item units named `lb` / `oz` keep resolving (08a I5 step 2: item unit before built-in), no migration; test #1 in numbers.


**v0.3 — DRAFT (2026-11-23), fixes hostile review run 2** (`docs/reviews/08b_v0.2_hostile_run2.md`: 0 BLOCKER, 7 MAJOR, 12 MINOR; the partly-✗ run-1 rows M-4, M-5, M-8, M-9, M-12, m-13, m-18, m-19) **and applies the owner rulings of 2026-11-23 23:15–23:45 PKT**. Rebased onto current `main` + 08a v1.0.1 (PR #476); cites Foundation v1.16, 00 v1.12.4, 01d v1.3.6, 05a v1.0.5, 08a v1.0.1. Next: **targeted check (run 3) on the changed rows only**, as run 2 asked. Markers "⚠️ v0.3 (id)". Still the **08b part of module 08**, folded into `08_Inventory_Costing_Spec` at approval (**module OQ-1**: one file for 08a–08d; ⚠️ v0.3 n-9 — not this file's §12.3 OQ-1).

**Owner rulings recorded (2026-11-23 23:15–23:45 PKT):**
- **OQ-4 → the misc allowance applies once, at the top recipe of the sale line only**, never compounded through sub-recipes or produced items (B5; was the v0.2 default).
- **OQ-5 → the snapshot keeps 3 superseded versions per recipe; a line costed with an older one explodes `partial`** (B11, B15 e; accepted).
- **Generality ("is 08 Arif-only?"):** (a) a **per-volume basis**: the weight basis is generalised into **`per_measure`** (base quantity in the owner's sale unit, g **or** ml; default 1 000 = per kg / per litre), so lassi or juice sold by volume costs like karahi sold by weight (B3); (b) **imperial built-in units** `lb` = 45 359 237 / 100 000 g and `oz` = 45 359 237 / 1 600 000 g join 08a's `BUILTIN_UNITS` (row P-3); no gallon.
- **Cooked items are counted in their own stock unit:** PAYE-COOKED in pieces, biryani / pulao in plates (`stock_unit = 'piece'`, one piece = one plate, `batch_yield_qty` = plates per deg); `explodeStockItem` takes that quantity unchanged (B11, test 11).

**Changes in v0.3, one line per id:**
- **N-1** restore runs **every** publish-time check, not only the graph: basis vs the owner's current `sale_unit` / kind, plain option, `prepared` owner, lines active, frozen line units = current, frozen batch unit = the owner's current (`422 { field: 'archived', reason }`) (§6.6, B6); `recipe_versions.batch_stock_unit` frozen with `batch_yield_qty`, and `stock_unit` added to the snapshot's `lines[]` and `recipes[]` (§5.1, §5.3); the engine treats a frozen unit ≠ the item's current `stock_unit` as unknown (`partial`) — the backstop for superseded versions (B9, B11); a **prepared owner's** `stock_unit` change is refused while it owns a non-archived recipe (B17, row C-11); tests 18, 22.
- **N-2** every `PATCH` with `archived: false` takes the publish lock (kind 0) **first**, before the recipe lock, whatever the row turns out to be; counts restore 10 (9 for a stock-item owner) / 5 / no-op 3 (§6.6); race tests 37, 38.
- **N-3** the builder has its **own time-free** `selectSnapshotPrices(db, branchId)` (the dominance window query); 08a's `selectPriceCandidates` (`inventory/repository.ts`, the as-built one of 08a AD-7's two copies) stays for the §6 cost context only (§4.1, §5.3, §11 step 3; m-13 corrected).
- **N-4** "strict" defined (B15 c): `InventorySnapshotSchema` objects are **not** `.strict()` (unknown fields stripped); the builder `safeParse`s its output, and a failure logs `inventory_key_invalid` (branch id, issue paths) and **sends the key as built** — the sync never `500`s for it; `buildCostInputs` parses **element by element** (a bad row is dropped and counted in `dropped`), enum-like fields as strings, an unknown value → that line / recipe unknown (`partial`), never "no costs at all"; test 27b.
- **N-5** `kind: 'deal'` dropped from `SaleLineShape`: 08c costs and explodes **each part line** (quantity = part qty × deal qty, 01c §3.4.2, already applied) and sums with the pure `dealCost(partResults)` (B10's deal status rule); test 6 reworded.
- **N-6** `stockItemUnitCost(inputs, stockItemId, branchId, nowMs)` exported (B9 (a)–(c); for ingredient / packet it equals 08a `pricePerStockUnit(effectiveMenuPrice(…))` on the snapshot inputs, so 08d may call either for an A-item); 08d's R-b (3) sentence copied verbatim into §4.3; `explodeStockItem` on a prepared item with no published recipe → `{ usage: empty, status: 'partial' }`; `qty` is a `bigint` (`1n`); `buildCostInputs` ignores unknown item fields.
- **N-7** §4.5 completed: P-1 names 08a test #25 (`inventory-filter.int.test.ts`: top-level keys gain `inventory`, builder 23 → 28, "ingredient / packet items now change `inventory.items[]` and bump", hash test inverted) and 08a tests 28 / 31 / 35 → 9 / 11 / 11 / 9 statements; **C-16** 01c §6 lock table gains kinds 0 and 0.5; A-4's gzip lines corrected (`:84`, `:149` directory ≤ 35 → 40; `:166` config-only ≤ 28 → 33); 01a S8 lists no lock kinds (no row).
- **n-1** snapshot `prices[]` carries `unit_name` and `stock_unit`; `buildCostInputs` sets every snapshot price row's `created_at` to 0 (in effect on any hub clock); a null `valid_until_at` is +∞ on both sides of the dominance rule. **n-2** recipe create: `INSERT … ON CONFLICT DO NOTHING RETURNING`; 0 rows → read the existing id (conflict path 9). **n-3** §6.1's stock-items read takes `kind = 'prepared' OR archived_at IS NULL` (archived prepared owners named; same statement). **n-4** `main_line_off` compares with the owner's `sale_unit`, read in the owner-names statement; edge row warns on makhan too. **n-5** depth = the longest `prepared` chain anywhere in the graph ≤ 3. **n-6** the B7 cap on a `per_measure` parent = direct AP qty × `q / base_qty`. **n-7** `childQuantity` takes numbers: quantities are converted at the boundary (`Number()` of a bigint ≤ 10^6); `CloudCostRows` defined (§4.2). **n-8** 08c / 08d memoise `CostInputs` per applied `snapshot_hash` (§4.3). **n-9** header names "module OQ-1". **n-10** `setting: 'warn'` dropped from §6.1's wire (the client hard-codes `warn`). **n-11** accepted and stated: a superseded version naming a since-archived stock item explodes that line `partial` (B15 e). **n-12** restore race tests 37, 38.

**v0.2 — DRAFT (2026-11-23), fixes hostile review run 1** (`docs/reviews/08b_v0.1_hostile_run1.md`: 1 BLOCKER, 14 MAJOR, 20 MINOR; resolution table at the end of that file) **and applies the owner rulings of 2026-11-23 22:13 PKT ("sab recs")**. Next: hostile review **run 2 (full)**, as the review asked. Markers "⚠️ v0.2 (id)". This is the **08b part of module 08**, a separate file only so 08b and 08d can be drafted in parallel; **at approval it is folded into `08_Inventory_Costing_Spec` as that file's next version (owner OQ-1: one file for 08a–08d)**, and its §4.5 rows are applied then.

**Owner rulings recorded (2026-11-23 22:13 PKT):**
- **R7 pilot cuts:** no `ck_only` / packet recipes and no `visibility_scope` (packets are costed at menu price at a branch; D10's secret BOM is POST, when a CK hub exists); no `is_garnish`, no `scale_with_parent`, no `served` `kg_basis`, no ±20 % refusal (a warning only), no `parents_missing_removals`, no settings table (`require_recipe_for_menu` is the constant `warn` in the pilot).
- **Cross-slice contract (same text in 08d):** **08c owns `theoreticalUsage`**, with full explosion and no `stopAt`. **08b exposes** `explodeStockItem` (stock-item explosion for 08d's cooked counts) and a per-line-version `explodeUsage` (B11, §4.2). `cookedFormsOf` / `stopAt` are removed.
- **Merge order:** 08b first, then 08d. 08b takes cloud migration `0019` and the next free versions of the specs it bumps (§4.5, numbers fixed at approval).

**Changes in v0.2, one line per id:**
- **B-1** one tenant-wide publish lock `pg_advisory_xact_lock(8020, hashtext(tenant_id))` = lock kind **0**, taken before the graph read by publish and restore (B6, §6 lock order); the engine never throws: a cycle or depth > 3 marks the branch `partial` (B9, B11); test 16 rewritten (`afterPublishLock`).
- **M-1** `0019_recipes.sql` ends with `UPDATE branches SET config_version = config_version + 1` (01a MD-3 / AD-9 pattern); row A-6; test 33.
- **M-2** the snapshot carries price rows chosen by a **time-free dominance rule** (B15 a): the body is a function of the stored rows only, so one `config_version` always builds one body and hash; the hub applies expiry on its clock; test 27 crosses an expiry.
- **M-3** the publish / restore graph check reads the **whole** published, non-archived graph of the tenant (one statement) and checks acyclicity and the longest nesting ≤ 3 over the whole graph after the change (B6); restore runs it under the B-1 lock (§6.6); tests 16, 18.
- **M-4** three owner-edit guards (01c §6.5 `sale_unit`, 01c §6.12 plain → linked, 08a R4 `kind` of a stock item owning a recipe → `409 CONFIG_IN_USE { used_by: { entity: 'recipe' } }`) and a builder backstop (only `prepared` stock-item owners in `recipes[]`); rows C-14, C-15, P-2; test 22. (c) "packet leaks a BOM" is gone with R7.
- **M-5** the hub snapshot schema takes `inventory: z.unknown().optional()`; the typed `InventorySnapshotSchema` is exported separately, used strictly by the cloud builder and lazily by 08c (a failed parse = no costs, never a rejected config) (B15 c); test 27.
- **M-6** an empty published recipe is allowed for a `modifier_option` owner (costs 0, `costed`) (B6); test 15.
- **M-7** the `qty_basis` default is derived at draft save from locked data: an `ingredient` line on a `per_unit` / `per_kg` recipe defaults to EP only when the item has an active yield, else AP with the warning `no_yield_defaulted_ap`; an explicit EP with no yield stays `partial` (D7, D9 kept) (B4); test 12.
- **M-8** `plateCost` returns the recipe version id of the item **and of each option**; `explodeUsage` takes those per-line ids; the snapshot keeps up to 3 superseded versions per recipe so a day's lines explode with the versions they were costed with (B11, B15 e); 08c stores them (§4.3).
- **M-9** `explodeStockItem` added to §4.2 (owner contract text); `items[]` carries active items only, and 08d is told so (§4.3).
- **M-10** gone with R7 (no `ck_only`).
- **M-11** `plateCost` is for the **whole sale line**; plain-option quantity via 01c `childQuantity(optionQty, parentQty, parentSaleUnit)`; `per_kg` quantity in the sale unit; a line through a `partial` sub-recipe is `partial`; a deal is `no_recipe` only when every part is (B10); tests 5, 6.
- **M-12** §4.5 complete: 01b row B-x (sync bound), full A-4 test list, 08a test #9 in P-1, C-13 (01c §9), C-14, C-15, P-2, A-6, F-1 + `errors.ts`, R-x (README).
- **M-13** one **cost context** (5 tenant-wide reads) reused by every cost response; exact counts per route (§6.1 = 9, §6.2 = 11, §6.3 = 8, §6.4 = 16, §6.5 = 17 / 16 / 15, §6.6 = 4 / 6 / 8).
- **M-14** lock order written (§6): 0 publish lock → 0.5 `recipes` → 1 the option's modifier group (`FOR SHARE`) → 4 menu item (`FOR SHARE`) → 5 owner + line stock items in one `= ANY` statement, id order → 10 `branches`; race tests 16, 34–36; hooks `afterPublishLock`, `afterRecipeLock` in `CloudTestHooks`.
- **m-1** array orders stated, sorted in JS by code point (§5.3). **m-2** builder sends the latest manual in the item's current `stock_unit`; the hub treats every row of an applied snapshot as already in effect (no `created_at ≤ now` check on the hub) (B15 a). **m-3** `minor: null` when no line is known ("No cost yet · partial"). **m-4** rounding half away from zero (negative option costs). **m-5** the B7 cap compares AP stock units after yield, per parent unit × parent quantity, direct lines only. **m-6** misc allowance applied only at the **top** recipe of a sale line, never on a batch recipe used as a line (owner OQ-4, default). **m-7** basis / negative checks → `422 { reason: 'basis_mismatch' | 'negative_not_option' }` after the recipe read. **m-8** entered qty `^-?\d{1,6}(\.\d{1,4})?$`; frozen `|stock_qty_num|` ≤ 10^15 after reduction, else `422 qty_out_of_range`. **m-9** one audit row per entity changed (multi-row insert). **m-10** archived recipes never block (B17); draft save / publish on an archived recipe → `422 { field: 'recipe_id', reason: 'archived' }`. **m-11** the `per_kg` main-line check is a warning, only when the line's stock unit equals the sale unit. **m-12** coverage defined (B14). **m-13** build starts after `module-08a` merges into `main`; builder, §6.1 and 08a share `selectPriceCandidates` (§11). **m-14** hooks in `apps/cloud/src/server.ts` `CloudTestHooks`. **m-15** the S48 gzip e2e fixture gains the inventory key (30 days of daily rates); test 25. **m-16** BIGINT values as strings throughout; `units[].base_unit` dropped. **m-17** accepted for the pilot: the menu badge reads §6.1 (9 statements). **m-18** a second recipe for an owner → `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids: [existing] } }`. **m-19** OQs renumbered; "V13". **m-20** lines aggregated with `json_agg` into the versions read: builder **+5**, not +6.
- **R7 cuts** (owner): removed B13, `visibility_scope`, §6.6 visibility, §6.7 settings route and table, `is_garnish`, `scale_with_parent`, `kg_basis` (per_kg is raw input by definition), `main_line` refusal, `parents_missing_removals`. 8 routes → 6.

**v0.1 — DRAFT (2026-11-23)**, kept as history.

---

## §1. Header

| Field | Value |
|---|---|
| Module | 08b Recipes + cost engine: recipes as cloud config (draft → published versions → archive) for sellable menu items (sold by piece, weight or volume), plain modifier options and `prepared` stock items; a pure, non-throwing cost engine and usage explosion in `@pos/domain`; plate cost and recipe coverage in the owner app (`require_recipe_for_menu` = `warn`, a constant); the snapshot's `inventory` key that 08a deferred, with the bump rule that replaces 08a I11 |
| Version | **v0.4 — DRAFT** (2026-11-24, targeted check fixed). v0.3 — DRAFT (run 2 fixed + owner rulings 23:15–23:45). v0.2 — DRAFT (run 1 fixed). v0.1 — DRAFT |
| Depends on | Foundation v1.16; 00 v1.12.4; 01d v1.3.6; 05a v1.0.5; 01a v2.8 (S8, S26, S27, S28, S48, MD-3, AD-9, common write script); 01b v1.10.3 (B8, §4.4 row 6); 01c v1.2 (V2, V6, V7, V10, V13, V14, §3.4 line rules, §6 lock order, §6.5, §6.8, §6.12); **08a v1.0.1** (`stock_items.kind`, item units, prices, yields, `BUILTIN_UNITS`, `resolveUnit`, `effectiveMenuPrice`, `activeYield`, `pricePerStockUnit`, I12 labels; as built, PR #476) |
| Inherits | Shared Standards of Foundation v1.16 §6; carried conventions C1–C9; 08a's conventions (integers only, `BigInt(string)`, fractions, round once) |
| Changes other specs | 08a part of this file (I11 ends, statement counts, R4, tests #9 / #25 / #28 / #31 / #35, imperial built-ins), 01a → next (A-2 ends; `inventory` key; builder / sync bounds; audit entities and action; release bump), 01b → next (sync bound), 01c → next (stock-item archive / unit in use; `sale_unit` and plain → linked guards; §6 lock table; §9), foundation §6.2 (one code), README. Full list §4.5 |
| Tier | T2 |
| Milestone | A (pilot), R39 slice 2 of 4 |
| Inputs | 08-g0 §2, §3.5, §3.7–§3.9, §3.11, D6–D9; R18, R28, R29, R39; owner rulings 2026-11-23 22:13 and 23:15–23:45 PKT; reviews run 1, run 2; 08d v0.3 (`spec/08d-daily-sheet` @ `821b733`, read only); targeted check run 3; code on `main` (08a merged, #476) |

### Stories covered

| Source | Item | How |
|---|---|---|
| 08-g0 §2 "Recipes: per_unit / per_kg / per_batch, variants, add-ons (incl. negative deltas), produced items, packet items as ingredients" | owners, bases, lines | B1–B8 (packet as **ingredient line** yes; packet as **owner** no, R7) |
| §2 "Cost engine + plate cost" | pure engine, plate cost | B9–B12 |
| §2 "`require_recipe_for_menu` = warn" | badge + coverage | B14 (constant `warn`, R7) |
| §3.7 validation | convertibility, removal add-on, cycles ≤ 3, EP-in-batch warning | B6, B7 |
| §3.8 formulas | line / recipe / produced / per-measure (kg or litre) cost, status | B9, B10 |
| 08a §4.3 row 08b | `inventory` key, bump rule, `partial` on missing price / yield | B15, B16 |
| D10 secret BOM | — | **POST** (R7; §12.4) |
| §2 "deal cost range + suggested price" | — | **POST** (R39 (e); §12.4) |

### In scope
- Cloud: `recipes`, `recipe_versions`, `recipe_lines`; six routes (§6); migration `0019_recipes.sql` with the release bump.
- `@pos/domain/src/inventory/costing.ts`: cost inputs, plate cost, `dealCost`, `stockItemUnitCost`, `explodeUsage`, `explodeStockItem` (pure, non-throwing).
- 08a's `BUILTIN_UNITS` gains `lb` and `oz` (owner ruling; row P-3).
- Snapshot schema 4 gains the optional `inventory` key (S28 c); builder **+5** statements.
- Owner app: Recipes page (coverage list), recipe editor, plate cost with "Menu cost" labels, "No recipe" badge on menu items.

### Out of scope
- Hub code that **uses** the `inventory` key (08c sale cost and `theoreticalUsage`; 08d daily sheet). The hub stores the body as today.
- Sale-time cost, `OrderCosted`, comps (08c). MWA, receiving, counts (08d).
- Packet recipes, `ck_only`, a CK hub; deal cost range, suggested price / MFC, restatement, quotes, batch-learned yields, prep instructions; a `require_recipe_for_menu` setting and `block` (§12.4).

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Config is cloud-canonical, delivered as a per-branch snapshot; within schema 4 the cloud may add **optional** keys; an older hub drops them (schema objects are not `.strict()`), and stores and hashes the raw body | 01a S28 (c); `packages/events/src/config.ts`; `apps/hub/src/sync/config-poller.ts` |
| The cloud answers `not_modified` when the hub's `config_version` equals the branch's; a body change without a version change never reaches a hub | `config-sync/service.ts`; 01a MD-3, AD-9 |
| Snapshot hash = `sha256(canonicalJson(raw))`: key order free, **array order matters**; builder arrays sorted in JS by code point, never collation | 01a S27, S28; `builder.ts` |
| Builder bound today **≤ 23**; sync config-only `200` ≤ 28, with directory ≤ 35 (01b §4.4 row 6); gzip e2e at the S48 design size; 08a test #25 pins the top-level keys, the 23 and an unchanged hash for ingredient / packet items | `builder.int.test.ts`, `sync-config.int.test.ts`, `sync-gzip-e2e.int.test.ts`, `inventory-filter.int.test.ts`; 01b v1.10.3 |
| Every config write: one transaction; `assertTenantWide` first (after the key on a creating POST); `bumpEveryBranch` = 2 statements; `bumpConfigVersion` for one branch = 1 | 01a S8; `lib/config-version.ts` |
| 08a as built: stock items with `kind`; item units; price rows; yields; `BUILTIN_UNITS`, `resolveUnit`, `effectiveMenuPrice`, `activeYield`, `pricePerStockUnit`, `displayPer`, `reduceFraction`; I12 labels; `CloudTestHooks.afterStockItemLock`; `selectPriceCandidates` (time-filtered, two copies, AD-7) | 08a v1.0.1; PR #476 |
| A variant is a full `menu_items` row; plain options carry a price; linked options become `option_child` lines with their own `item_id`; deal parts → choices → `item_id`; child quantity and option charge per 01c §3.4.2 / §3.4.3 | 01c V2, V6, V10, §3.4 |
| 01c lock order kinds 1–10 (modifier groups 1 … stock items 5 … `branches` 10), one global table for every write | 01c §6 |

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Reason | Overrides / changes |
|---|---|---|---|
| B1 | **Recipes are cloud config rows**, not hub events (C7 (a)). `recipes` (one per owner, ever) → `recipe_versions` (`draft` / `published` / `superseded`) → `recipe_lines`. Every write audited, one `config_audit` row per entity changed (⚠️ v0.2 m-9). 08-g0's `RecipeDraftSaved` / `RecipeVersionPublished` / `RecipeArchived` events become the routes of §6 | Owner edits in the owner app; branches receive published versions in the snapshot | 08-g0 §3.7 events → config rows |
| B2 | **Owners** (`owner_type`, `owner_id`): `menu_item` (any sellable row: plain item or variant — no D11 default variant, R39 (d)); `modifier_option` (**plain options only**: a linked option is costed through its linked item's recipe as its `option_child` line; `422 { reason: 'linked_option' }`); `stock_item` of kind **`prepared`** only (PAYE-COOKED, QEEMA-COOKED). `ingredient` and **`packet`** owners → `422 wrong_kind` (⚠️ v0.2 R7: packets are costed at menu price; their BOM is POST). **Deals own no recipe**: a deal line's cost is the sum of its part lines | 08-g0 §3.7 owner types mapped to the repo | 08-g0 `variant` / `addon_option` / `produced_item` |
| B3 | **Basis follows the owner**, derived at every draft save from the **locked owner row** (⚠️ v0.4 T-1), with `measure_unit` and `batch_stock_unit` frozen from it (⚠️ v0.4 T-2): `menu_item` with `sale_unit = 'piece'` → `per_unit`; with `sale_unit ∈ g, ml` → **`per_measure`** (⚠️ v0.3 owner ruling: the v0.2 `per_kg` generalised; `base_qty` in the owner's sale unit, g **or** ml, default 1 000 = per kg / per litre; ⚠️ v0.4 T-2: that unit is frozen on the version as `measure_unit`; the UI says "per kg" or "per litre" from the sale unit; **always raw-input basis**, D6 — ⚠️ v0.2 R7: no `kg_basis` field, `served` is POST). One basis for weight and volume is the smaller change: same arithmetic (`q / base_qty`), one code path, nothing built yet, and a lassi or juice by volume (`sale_unit: 'ml'`) costs like a karahi by weight; `modifier_option` → `per_unit` (per 1 option quantity per parent unit, B10); `stock_item` → `per_batch` (`batch_yield_qty` in the item's `stock_unit`, integer 1 … 1 000 000 000, required to publish). A "1 kg karahi" sold as a piece is `per_unit` with a 1 000 g raw-chicken AP line; a karahi sold by weight is `per_measure` (g); a lassi sold by the glass is `per_unit`, sold by volume `per_measure` (ml, e.g. milk 800 ml + yoghurt 200 g per 1 000 ml). A cooked item counted in plates (biryani, pulao) is a `prepared` stock item in `piece` (one piece = one plate), its batch yield in plates (⚠️ v0.3 owner ruling) | One rule per owner kind; a sale line's quantity always matches its recipe's basis | 08-g0 `basis` field → derived; `per_kg` → `per_measure`; `portion_qty`, `kg_basis` dropped |
| B4 | **Lines.** `stock_item_id` (any kind: `ingredient`, `packet`, `prepared`); quantity entered as a decimal string `^-?\d{1,6}(\.\d{1,4})?$` in a unit the item resolves (08a I5), stored as the entered fraction **and** the frozen stock-unit quantity (`stock_qty_num / stock_qty_den`, reduced, `|num|` ≤ 10^15 else `422 qty_out_of_range`, ⚠️ v0.2 m-8) with the item's `stock_unit` at save (as 08a I6 freezes a price's conversion). `qty_basis ∈ AP \| EP`: sent, or derived at draft save from the **locked** data (⚠️ v0.2 M-7): `per_batch` → AP (D7); `per_unit` / `per_measure` → for an `ingredient` line, EP **only when the item has an active yield**, else AP with the warning `no_yield_defaulted_ap`; for `packet` / `prepared` lines, AP (no yield applies). An explicit EP on an ingredient with no yield stays `partial` (D9: never yield 1). At most 60 lines; a stock item once per version. Negative quantities only in `modifier_option` recipes (removals); elsewhere `422 { field: 'lines.N.qty', reason: 'negative_not_option' }` (⚠️ v0.2 m-7) | D7 without double yield; pantry items (oil, salt, masala) without a yield profile are honestly AP; units validated at save (08-g0 §3.1) | — |
| B5 | **Misc allowance** `misc_allowance_bp` 0 … 5 000, default 500 (5 %, 08-g0 §3.7); applied to **cost only, never to usage**, and only at the **top** recipe of a sale line (the menu item's or the option's), never again when a `per_batch` recipe is costed as a line (⚠️ v0.2 m-6; ⚠️ v0.3 **owner ruling OQ-4**: once, at the top only). Example: Paye Half = (PAYE-COOKED piece Rs 200 + shorba Rs 20) × 1.05 = Rs 231, not Rs 241.50 | 08-g0 §3.7; no compounding through PAYE-COOKED | `misc_allowance_pct` → bp (C4) |
| B6 | **Validation at publish** (draft saves check shape, references, units only): ⚠️ v0.4 T-1: an **archived** recipe may be published — the checks below run on the current owner and lines and, when they pass, the recipe is un-archived in the same transaction (m-10's `422 archived` on publish is dropped); basis matches B3 for the owner's **current** `sale_unit` / kind, and a `per_measure` version's frozen `measure_unit` = the owner's current `sale_unit` (`422 basis_mismatch`, ⚠️ v0.4 T-2); the owner is still a plain option (`422 linked_option`) / a `prepared` stock item (`422 wrong_kind`); `per_batch` has `batch_yield_qty` (`422 batch_yield_missing`) and its frozen `batch_stock_unit` is the owner's current `stock_unit` (`422 { field: 'batch_yield_qty', reason: 'unit_changed' }`, ⚠️ v0.3 N-1); every line's stock item active (`422 archived`) and its frozen `stock_unit` still the item's `stock_unit` (`422 unit_changed`, re-save); at least one line, **except** for a `modifier_option` owner, whose empty recipe costs 0 and is `costed` ("Spicy", "Less oil") (⚠️ v0.2 M-6; else `422 empty`); **graph** (⚠️ v0.2 B-1, M-3): under the publish lock (lock kind 0), read the tenant's whole published, non-archived graph (one statement), apply the change (this version replaces the owner's published one), and refuse when the result has a **cycle** (`422 cycle`) or any chain of `prepared` recipes **anywhere in the graph** longer than **3** levels (`422 too_deep`; ⚠️ v0.3 n-5: also a prepared-only chain no menu item uses yet, so `explodeStockItem` on its top is never cut short), in either direction through this recipe. **Restore runs this whole list** (⚠️ v0.3 N-1, §6.6). **Warnings** (non-blocking, returned and shown): EP line inside `per_batch` (D7); `no_yield_defaulted_ap`; EP ingredient line with no active yield; line with no menu cost (cost `partial`); `per_measure` with no AP ingredient line whose stock quantity is within ±20 % of `base_qty`, checked only when that line's stock unit equals the owner's `sale_unit` (`main_line_off`; ⚠️ v0.2 R7 / m-11: warning, never a refusal; ⚠️ v0.3 n-4: the owner's `sale_unit` comes from the owner row) | 08-g0 §3.7; a serial graph check is the only way to keep "no cycle" true under concurrent publishes | 08-g0 §3.7 kg_basis rule → warning |
| B7 | **Removal options against many parents.** A modifier group attaches to categories, variant groups and items (01c V7), so "the item exists in the parent's recipe" cannot be kept true at publish. Rule: publish never refuses for it, and the engine **caps** a negative option line: removed AP stock quantity ≤ the parent recipe's own **direct** AP stock quantity of that stock item (after yield), per parent unit × parent quantity on a `per_unit` parent, and × `q / base_qty` on a `per_measure` parent (⚠️ v0.2 m-5; ⚠️ v0.3 n-6); never below 0. "No onion" on a dish without a direct onion line costs and uses nothing. ⚠️ v0.2 R7: the editor's parent-missing list (`parents_missing_removals`) is cut; the cap alone keeps removals safe | Many parents make a refusal impossible to keep true | 08-g0 §3.7 "removal add-on valid only if…" → cap |
| B8 | **Versions are immutable once published.** One draft and one published version per recipe at most. Saving replaces the draft (versioned, `expected_version`, 01c V13); publishing turns the draft into the published version and the old published into `superseded` (`published_at` = effective time, no backdating; restatement POST). A new draft is created by `PUT … /draft` with `expected_version: null` (the editor sends the published content) | 08-g0 §3.7 | — |
| B9 | **Cost engine** (`@pos/domain/src/inventory/costing.ts`, pure, BigInt fractions, **never throws**, ⚠️ v0.2 B-1). For a branch at time `now`: `cost_per_stock_unit(item)` = (a) `prepared` item with a published batch recipe in the inputs: that recipe's cost (no misc, B5) ÷ `batch_yield_qty`; (b) `ingredient`, `packet`, or `prepared` without a recipe: `pricePerStockUnit(effectiveMenuPrice(…))` (08a I7; packets by menu price, 08-g0 §3.5 step 4); (c) none → unknown. `line_cost = stock_qty × cost_per_stock_unit ÷ (qty_basis = EP and kind = ingredient ? yield_bp / 10 000 : 1)`; an EP ingredient line with no active yield → unknown (D9). **Frozen-unit backstop** (⚠️ v0.3 N-1): a line whose frozen `stock_unit` is not the item's current `stock_unit`, or a batch recipe whose frozen `batch_stock_unit` is not its owner's current `stock_unit`, is unknown (`partial`), never re-read in the new unit; ⚠️ v0.4 T-2: likewise a `per_measure` recipe costed for a line whose `sale_unit` ≠ its frozen `measure_unit`, and a `per_unit` recipe on a g / ml line or a `per_measure` recipe on a piece line — this covers superseded versions in the snapshot, which B17 does not guard. (a)–(c) are exported as `stockItemUnitCost` (⚠️ v0.3 N-6, §4.2; ⚠️ v0.4 T-4: used by the owner app's line costs; 08d does not use it); for an ingredient or packet it is exactly 08a `pricePerStockUnit(effectiveMenuPrice(…))` on the same inputs. A line whose sub-recipe is itself `partial` is `partial` (⚠️ v0.2 M-11). A cycle or a nesting deeper than 3 met in the inputs (possible only on raw-edited data or a broken snapshot) marks that line unknown — the engine returns `partial`, never throws. `recipe_cost = Σ line_cost × (10 000 + misc_bp) / 10 000` at the top recipe only (B5). A `per_measure` recipe's cost is for `base_qty`; a sale of `q` (sale unit, g or ml) costs `recipe_cost × q / base_qty`. **Status:** `costed` when every line is known; `partial` when at least one line is unknown (value = the known part, shown labelled; `minor: null` when no line is known, ⚠️ v0.2 m-3 — ⚠️ v0.4 t-6: the engine returns `known: boolean` so a known 0, e.g. an empty "Spicy" option, is told apart from "nothing known"); `no_recipe` when the owner has no published version. Rounded to minor units **once**, at the edge, **half away from zero** (⚠️ v0.2 m-4) | 08-g0 §3.8, D9 | 08-g0 `NUMERIC(14,4)` → fractions |
| B10 | **Plate cost of a sale line** (⚠️ v0.2 M-11) — `plateCost` is for the **whole item sale line**, quantities in the line's sale unit: item recipe cost × line quantity (`per_unit`) or × `q / base_qty` (`per_measure`); + each chosen **plain** option's recipe cost × `childQuantity(optionQty, parentQty, parentSaleUnit)` (01c §3.4.2: × parent quantity on a piece parent, once per line on a g / ml parent — ⚠️ v0.4 t-3: **× `deal_qty` on a g / ml deal-part line** (01c B2, `menu-lines.ts` deal-part rule: parent qty = deal qty with `'piece'`), passed as `SaleLineShape.deal_qty`; ⚠️ v0.2 R7: no `scale_with_parent`); linked options and deal parts are their own sale lines with their own item recipes. ⚠️ v0.3 N-5: **a deal is not a `SaleLineShape`**: 08c calls `plateCost` / `explodeUsage` **once per part line**, with that line's `quantity` = part quantity × deal quantity (01c §3.4.2) already applied, and combines the parts with the pure `dealCost(partResults) → { value, status, known }` (⚠️ v0.4 t-6: `known` = any part known): value = Σ parts; status `no_recipe` only when every part is `no_recipe`, else `partial` if any part is not `costed`, else `costed`. **Item line status:** `partial` if any part is `partial`, or a plain option has no recipe (adds 0, 08-g0 §3.11); `no_recipe` when the item has no recipe | 08-g0 §3.8, §3.9, §3.11; 01c §3.4 | — |
| B11 | **Usage explosion** (pure, non-throwing). `explodeUsage(inputs, line: SaleLineUsage)` takes a sale line **with the recipe version ids recorded for it** (item and each option; ⚠️ v0.2 M-8) and returns `{ usage: Map<stock_item_id, Fraction /* stock units, as purchased */>, status }`: EP ingredient lines ÷ yield (AP = EP ÷ yield; unknown yield → that item is left out and `status = 'partial'`); `prepared` lines explode through their published batch recipe (÷ `batch_yield_qty`) — **always, no `stopAt`** (⚠️ v0.2 contract); `packet` lines never explode (they are stock); negative option lines capped per B7; **misc never applied** (B5); a version id not in the inputs (⚠️ v0.3 owner ruling OQ-5: more than 3 republishes back) → that part `partial`; a frozen unit ≠ the item's current one → that line `partial` (N-1 backstop); ⚠️ v1.0 f-2: a recipe whose basis / `measure_unit` does not fit the line's `sale_unit` (B9's T-2 backstop: `per_measure` on a line of another sale unit, `per_unit` on a g / ml line and the reverse) → that part `partial`, nothing exploded from it; ⚠️ v1.0 n-2: a `prepared` **sub**-line explodes through its item's **current** published version (`publishedByOwner`), not a recorded id, so after that sub-recipe is archived the day's lines that use it explode `partial` — only the top recipe's recorded version survives an archive; cycle / depth > 3 → that branch dropped, `partial`. `explodeStockItem(inputs, preparedStockItemId, qty: bigint)` explodes a quantity of a `prepared` item, **in that item's own stock unit** (pieces of PAYE-COOKED, plates of biryani), by the same rules: raw = qty × line ÷ `batch_yield_qty`; a prepared item with no published recipe in the inputs → `{ usage: empty Map, status: 'partial' }` (⚠️ v0.3 N-6) (contract text §4.2). Yields used are those in the inputs (the snapshot applied at the time 08c runs) | 08-g0 §3.9, §3.12 | 08-g0 "yields effective at sale time" → the applied snapshot's (pilot simplification, like C6; restatement POST) |
| B12 | **Owner-app plate cost uses the branch the owner picks** (`branch_id` query) and `now`; labels per 08a I12: **"Menu cost"** / **"Plate cost (menu cost)"**, never "today's cost". With R7 the owner app and every hub use the same recipes (no `ck_only`), so one plate has one number (⚠️ v0.2 M-10) | Two price sources must never be confused | — |
| B13 | ~~`visibility_scope` / `ck_only`~~ — **cut** (⚠️ v0.2 R7). Packet BOMs (D10) are POST, with a CK hub | Pilot has no CK hub | — |
| B14 | **`require_recipe_for_menu` = `warn`, a constant in the pilot** (⚠️ v0.2 R7; no table, no route). A "No recipe" badge on every active sellable menu item without a non-archived published recipe (menu page, Recipes page), and **coverage by count** on the Recipes page: active menu items (each variant row counts; plain items count; options and stock items do not) with a non-archived published recipe ÷ active menu items (⚠️ v0.2 m-12). `off` and `block` are POST (§12.4). Coverage **by revenue** is 08c's (hub) | C9; the cloud has no sales | 08-g0 §3.11 `off \| warn \| block` → constant `warn` |
| B15 | **Snapshot `inventory` key** (optional, schema stays 4, S28 (c); 08a §4.3). Built per branch, **a function of the stored rows only** (⚠️ v0.2 M-2): (a) `prices[]`: per (stock item, scope ∈ {this branch, every branch}) the rows **not dominated** in the item's current `stock_unit` — a row R is dominated when a newer row (`created_at`, then id) of the same item and scope has `valid_until_at` ≥ R's, where a null `valid_until_at` counts as **+∞ on both sides** (⚠️ v0.3 n-1; the newer row would always win over R, 08a I7); so: the latest manual, and the newer market rates that expire after it (normally one); **no time filter** — built by the builder's own `selectSnapshotPrices(db, branchId)` (one window query), never by 08a's time-filtered `selectPriceCandidates` (⚠️ v0.3 N-3). The hub evaluates expiry on its own clock and treats every row of an applied snapshot as already in effect: ⚠️ v0.4 t-1: `buildCostInputs` replaces each snapshot price row's `created_at` with its **rank** within its item (0, 1, 2 … ordered by `created_at`, then `price_id` — 08a I7's own order), so every row is in effect on any hub clock and I7's tie order is kept exactly (v0.3's "set to 0" left only `price_id` to decide); (b) `items[]`: active stock items (`stock_item_id, kind, name, code, stock_unit, cost_category, is_a_item`; archived items not sent — 08d is told, §4.3); (c) **`inventory` is `z.unknown().optional()` in the hub snapshot schema**; the typed `InventorySnapshotSchema` (§5.3) is exported separately. ⚠️ v0.3 N-4, "strict" defined: its objects are **not** `.strict()` (unknown fields are stripped, so a later slice may add fields, as 08d does); the **builder** `safeParse`s its own output — a failure logs `inventory_key_invalid` (branch id, issue paths) and the key is **sent as built** (the sync never `500`s because of it; tests catch builder bugs); the **hub** (`buildCostInputs`) parses **element by element** with the **lenient element set** `InventoryElementsLenient` (⚠️ v0.4 t-5: the same objects with enum-like fields as `z.string()`; the typed schema's literal unions are for the builder and tests) — each `items` / `units` / `prices` / `yields` / `recipes` / `lines` element with its own `safeParse`, a failing element dropped and counted in `CostInputs.dropped`; enum-like fields (`kind`, `basis`, `owner_type`, `qty_basis`, units) are parsed as strings and an unknown value makes that line / recipe unknown (`partial`). One bad row never voids every cost, and never rejects a config (⚠️ v0.2 M-5). ⚠️ v0.4 T-3: every hub consumer (08c, 08d) decides "inventory not configured" by **the key being absent or `buildCostInputs` returning no items**, never by a whole-key `InventorySnapshotSchema.safeParse`; (d) `units[]` current item units (I5 step-2 set), `yields[]` active per ingredient; (e) `recipes[]`: for each recipe — ⚠️ v0.4 t-7 (b): **archived recipes included**, each version marked `recipe_archived` — whose owner is an active-or-archived `menu_item`, a plain `modifier_option`, or a **`prepared`** stock item (builder backstop, ⚠️ v0.2 M-4), the published version **and its up to 3 most recent superseded versions** (by `published_at`, then id; ⚠️ v0.3 owner ruling OQ-5) with their lines (`json_agg`, each line with its frozen `stock_unit`; each version with its `batch_stock_unit`, ⚠️ v0.3 N-1), so 08c can explode a day's lines with the versions they were costed with (⚠️ v0.2 M-8), also when the recipe was archived later that day (t-7 b); `publishedByOwner` skips archived recipes, so no new sale line is costed from one. Each version also carries its `measure_unit` (⚠️ v0.4 T-2). ⚠️ v0.3 n-11, accepted: a superseded version may name a stock item archived since (not in `items[]`); that line explodes `partial` — rare, and honest. **No cost values** in the snapshot. Builder **+5** statements (items, units, prices, yields, versions with lines) | Hub needs the inputs; hash stays a function of `config_version`; a key no hub reads cannot take down ordering config | 01a snapshot (rows A-3, A-4) |
| B16 | **Bump rule (replaces 08a I11).** A write bumps exactly the branches whose snapshot it changes: stock-item POST / PATCH of any `items[]` field → every branch; item unit POST → every branch; price POST → every branch if `branch_id` null, else that branch (1 statement); yield POST → every branch; recipe **publish**, **archive** and **restore** of a recipe that has a published version → every branch. **No bump:** recipe create (draft only), draft saves, archive / restore of a recipe with no published version. Market-rate **expiry** changes no body (B15 a). The **release** bumps every branch once (`0019`, ⚠️ v0.2 M-1, row A-6). 01a A-2 (08a) ends | The key now carries this data | 08a I11, §6.0, A-2 (rows P-1, A-2′) |
| B17 | **In use.** A stock item that is a line of a **non-archived** recipe's published or draft version cannot be archived, and its `stock_unit` cannot change while a non-archived published line freezes the old unit — `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }` (⚠️ v0.2 m-10: archived recipes never block). **Owner edits** that would silently corrupt a recipe are refused while the owner has a **non-archived** recipe (⚠️ v0.2 M-4): a menu item's `sale_unit` change (⚠️ v0.4 T-2: **any** change, g ↔ ml included — the basis or the frozen `measure_unit` would no longer fit), a plain option becoming linked (cost counted twice), a stock item's `kind` change (a prepared owner must stay prepared), and a **prepared owner's own `stock_unit` change** (its `batch_yield_qty` is in that unit; ⚠️ v0.3 N-1 b) → `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids: [recipe_id] } }`; the owner archives the recipe first. ⚠️ v0.3 N-1: while a recipe is archived nothing guards it, so **restore re-runs every publish check** (§6.6) — "archive, edit, restore" can no longer bring a stale recipe back. ⚠️ v0.4 T-1: and "archive, edit, **new draft, publish**" is the way forward: the archived recipe takes a draft (basis re-derived from the edited owner) and its publish un-archives it. A menu item, option or stock item that **owns** a recipe can still be archived (the recipe stays for old orders, 08c) and is listed as "owner archived" | No silent `partial` costs, frozen-unit drift or wrong basis | 01c §6.5, §6.8 R2, §6.12; 08a R4 (rows C-11, C-14, C-15, P-2) |

### 3.2 Owner kinds

| Owner | Basis | `batch_yield_qty` | Negative lines | Empty recipe |
|---|---|---|---|---|
| `menu_item`, sale unit piece | `per_unit` | — | no | refused |
| `menu_item`, sale unit g / ml | `per_measure` (`base_qty` in g or ml) | — | no | refused |
| `modifier_option` (plain) | `per_unit` | — | **yes** | **allowed** (costs 0) |
| `stock_item` `prepared` | `per_batch` | required, in the owner's `stock_unit` (pieces, plates as `piece`, g, ml), frozen as `batch_stock_unit` | no | refused |
| `stock_item` `ingredient` / `packet` | — (`422 wrong_kind`) | | | |

### 3.3 Validation rules

| Rule | When | Error |
|---|---|---|
| `owner_type` / `owner_id` exist in the tenant | create | `422 { field: 'owner_id', reason: 'not_found' }` |
| Linked option; ingredient or packet owner | create | `422 { field: 'owner_id', reason: 'linked_option' \| 'wrong_kind' }` |
| One recipe per owner (archived included) | create | `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids: [existing] } }` (⚠️ v0.2 m-18; ⚠️ v0.3 n-2: `ON CONFLICT DO NOTHING`, then the existing id is read) |
| Lines ≤ 60, each stock item once, qty matches the B4 pattern and ≠ 0; `misc_allowance_bp` 0 … 5 000; `base_qty` 1 … 1 000 000; `batch_yield_qty` 1 … 1 000 000 000 | draft save | `400` |
| A field that does not apply to the basis derived from the locked owner (B3; `base_qty` off `per_measure`, `batch_yield_qty` off `per_batch`), or a field that basis needs and lacks (`base_qty` on `per_measure`, ⚠️ v1.0 n-1); a negative qty off an option recipe | draft save, after the owner read (⚠️ v0.4 T-1) | `422 { field, reason: 'basis_mismatch' \| 'negative_not_option' }` (⚠️ v0.2 m-7) |
| Line stock item unknown / archived | draft save | `422 { field: 'lines.N.stock_item_id', reason: 'not_found' \| 'archived' }` |
| Line unit not resolvable (08a I5); frozen quantity out of range | draft save | `422 { field: 'lines.N.unit_name' \| 'lines.N.qty', reason: 'not_convertible' \| 'qty_out_of_range' }` |
| ~~Recipe archived~~ (⚠️ v0.4 T-1: removed — an archived recipe accepts a draft save, and its publish un-archives it after the B6 checks) | — | — |
| No draft to publish; stale `expected_version` | publish | `409 CONFIG_STALE` |
| B6 refusals | publish | `422 { field, reason: 'basis_mismatch' \| 'linked_option' \| 'wrong_kind' \| 'batch_yield_missing' \| 'archived' \| 'unit_changed' \| 'cycle' \| 'too_deep' \| 'empty' }` |
| Restore failing any B6 check (⚠️ v0.3 N-1) | PATCH restore | `422 { field: 'archived', reason: 'basis_mismatch' \| 'linked_option' \| 'wrong_kind' \| 'archived' \| 'unit_changed' \| 'cycle' \| 'too_deep', hint: 'new_draft' }` (⚠️ v0.4 T-1: the old version cannot come back; save a new draft and publish it) |
| B17: stock item archive / `stock_unit` change (as a line, or as a prepared owner); menu item `sale_unit` change; plain → linked option; stock item `kind` change | 01c / 08a writes | `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }` |

---

## §4. Contracts

### 4.1 Consumes
08a: `BUILTIN_UNITS` (+ `lb`, `oz`, row P-3), `resolveUnit`, `toStockUnits`, `reduceFraction`, `pricePerStockUnit`, `effectiveMenuPrice`, `activeYield`, `displayPer`; `selectPriceCandidates` from `apps/cloud/src/modules/inventory/repository.ts` (the as-built copy of 08a AD-7's two) — **for the §6 cost context only**; the builder has its own time-free `selectSnapshotPrices` (⚠️ v0.3 N-3, m-13 corrected); tables `stock_items`, `stock_item_units`, `item_prices`, `yield_profiles`. 01c: menu items, modifier options and groups, deals, `childQuantity`; versions builder. 01a: write script, audit, bump helpers, builder, `CloudTestHooks`.

### 4.2 Exposes

| Export | Shape | Used by |
|---|---|---|
| `@pos/domain` `inventory/costing.ts` | `type Fraction = { num: bigint, den: bigint }`. `type CostInputs` = items, current units, price rows, active yields, recipe versions by id, `publishedByOwner: Map<'menu_item:<id>' \| 'modifier_option:<id>' \| 'stock_item:<id>', recipeVersionId>`, `dropped: number`; built by **`buildCostInputs(source: unknown /* the snapshot's inventory key */ \| CloudCostRows)`** — element-wise parse with `InventoryElementsLenient` (⚠️ v0.4 t-5), bad elements dropped and counted, unknown item fields ignored, each snapshot price row's `created_at` replaced by its per-item rank (⚠️ v0.4 t-1), archived recipes' versions kept by id but not in `publishedByOwner` (⚠️ v0.4 t-7) (⚠️ v0.3 N-4, N-6, n-1). `type CloudCostRows` = the five cost-context row sets of §6, as the cloud repository returns them (⚠️ v0.3 n-7). `recipeCost(inputs, recipeVersionId, branchId, nowMs, { top: boolean }) → { value: Fraction, status: 'costed' \| 'partial', unknown: string[] }`. **`stockItemUnitCost(inputs, stockItemId, branchId, nowMs) → { per_stock_unit: Fraction, source: 'menu' \| 'recipe' } \| null`** — B9 (a)–(c); `null` = unknown, never 0; `source: 'recipe'` for a prepared item costed through its batch recipe (⚠️ v0.3 N-6). `plateCost(inputs, line: SaleLineShape, branchId, nowMs) → { value: Fraction, status: 'costed' \| 'partial' \| 'no_recipe', known: boolean /* ⚠️ v0.4 t-6 */, recipe_version_ids: { item: string \| null, options: { option_id: string, recipe_version_id: string \| null }[] } }` (⚠️ v0.2 M-8). **`dealCost(parts: { value: Fraction, status: 'costed' \| 'partial' \| 'no_recipe', known: boolean }[]) → { value: Fraction, status, known }`** (B10 deal rule; ⚠️ v0.3 N-5; ⚠️ v0.4 t-6). `explodeUsage(inputs, line: SaleLineUsage) → { usage: Map<string, Fraction>, status: 'costed' \| 'partial' }` with `SaleLineUsage = SaleLineShape & { recipe_version_ids }` (the ids `plateCost` returned and 08c stored). **`explodeStockItem(inputs, preparedStockItemId: string, qty: bigint) → { usage: Map<string /* stock_item_id */, { num: bigint, den: bigint }>, status: 'costed' \| 'partial' }`** — through the item's published `per_batch` recipe, raw = qty × line ÷ `batch_yield_qty`, recursing through prepared sub-items, depth ≤ 3; a cycle or depth > 3 never throws: that branch is dropped and `status = 'partial'`; a prepared item with no published recipe → empty `usage`, `partial`; `qty` is a `bigint` (08d passes `1n`) (⚠️ v0.2 M-9, owner contract; ⚠️ v0.3 N-6). `SaleLineShape = { kind: 'item', item_id, quantity: bigint, sale_unit: 'piece' \| 'g' \| 'ml', deal_qty?: bigint, options: { option_id, quantity: bigint }[] }` — ⚠️ v0.3 N-5: **no deal arm**; a deal part is an item line; ⚠️ v0.4 t-3: `deal_qty` set on a deal-part line (the deal's quantity), used as the plain-option multiplier on a g / ml part. Quantities are bigints; the call to 01c `childQuantity(optionQty: number, parentQty: number, parentSaleUnit)` converts them with `Number()` at that boundary (both ≤ 10^6, 01c) (⚠️ v0.3 n-7). None of these throws | 08c (sale cost, `OrderCosted`, `theoreticalUsage`), 08d (**`explodeStockItem` only**, with `buildCostInputs`; ⚠️ v0.4 T-4: an A-item's menu cost comes from 08a's functions, not `stockItemUnitCost`), owner app (`stockItemUnitCost` for line costs) |
| `@pos/events` | `InventorySnapshotSchema` (typed, §5.3, exported separately; objects not `.strict()`, ⚠️ v0.3 N-4); **`InventoryElementsLenient`** (⚠️ v0.4 t-5: one schema per element kind, enum-like fields `z.string()`); `BranchConfigSnapshotSchemaV4.inventory = z.unknown().optional()` (⚠️ v0.2 M-5); `admin/recipes.ts` wires and bodies | typed schema: **cloud builder (`safeParse` + log) and tests only** — never a hub consumer's "configured?" check (⚠️ v0.4 T-3); lenient set: `buildCostInputs`; wires: owner app |
| `config_audit` | entities `recipe`, `recipe_version`; action `publish` | 06, 07 |

### 4.3 Requirements carried to later slices (contract text identical in 08d where it names 08d)

| To | Requirement |
|---|---|
| 08c | **08c owns `theoreticalUsage`**, with full explosion (no `stopAt`): Σ `explodeUsage` over **the lines 08c's rules count (sale, comp, and the void dispositions of 08c / 08d R-c)** (⚠️ v0.4 t-7 a), each with the recipe version ids 08c stored for it; coverage by revenue and day attribution are 08c's rules. ⚠️ v0.4 T-4, 08d v0.3 §4.1 / R-c verbatim: **`theoreticalUsage(db, { business_day_id, count_seq_by_item: Map<string, number> }) → { items: Map<stock_item_id, { sold, comp, void_waste, staff_meal, sold_after_count /* each { num: bigint, den: bigint } in stock units */, status: 'costed' \| 'partial' }>, coverage_bp: number, revenue_minor: string }`**. ⚠️ v0.3 N-5: a deal is costed and exploded **per part line** (quantity = part qty × deal qty, `deal_qty` set, ⚠️ v0.4 t-3) and summed with `dealCost`. Sale-line cost = `plateCost` from the hub's `inventory` key at the **`config_version` applied at bill close** (owner ruling C6); 08c stores `recipe_version_ids` per line (item + options). A version id no longer in the applied snapshot (more than 3 republishes since) → that line `partial`; a version of a since-archived recipe is still in the snapshot (t-7 b). Build `CostInputs` with `buildCostInputs` (element-wise; a bad element = that line `partial`, never a rejected config, ⚠️ v0.3 N-4) and **memoise it per applied `snapshot_hash`** (one parse per apply, not per bill; ⚠️ v0.3 n-8). "Inventory not configured" = key absent or `buildCostInputs` returns no items (⚠️ v0.4 T-3). Hub stores no recipe projection unless 08c needs one |
| 08d | ⚠️ v0.4 T-4, 08d **v0.3** R-b (3) verbatim: **"08c owns `theoreticalUsage` (full explosion, no `stopAt`); 08d counts the prepared items the owner ticks as themselves and converts them with `explodeStockItem`; 08d adds two optional fields to `inventory.items[]`".** Also: cooked items are counted **in their own stock unit** (PAYE-COOKED pieces, biryani / pulao plates as `piece`) and `explodeStockItem(inputs, id, qty)` takes that quantity as a `bigint`; a prepared item with no published recipe returns empty usage, `partial`. **08d takes an A-item's menu cost from 08a `pricePerStockUnit(effectiveMenuPrice(…))` on `CostInputs`' price rows** (08d M-7); `stockItemUnitCost` returns the same value for ingredients and packets and is used by the owner app. ⚠️ v0.4 T-3: **"not configured" = the `inventory` key is absent, or `buildCostInputs` returns no items. Never a whole-key `InventorySnapshotSchema.safeParse`; that schema is for the builder and tests** (08d S2 / §3.3 / m-2 / R-b (2) align at 08d's next version: R-b (2) becomes "`InventorySnapshotSchema` is exported for tests"). `buildCostInputs` ignores unknown item fields, so 08d's fields need no 08b change; `is_a_item` is sent for every kind (08d decides which prepared items it counts). `inventory.items[]` holds **active** stock items only. MWA ("today's cost") is 08d's and is never mixed into `plateCost` (I12). Memoise `CostInputs` per applied `snapshot_hash` (n-8) |
| 08c / 08d | Coverage by revenue (R39 "unreliable below 95 %") is 08c's, returned with `theoreticalUsage` |

### 4.4 Story → slice map
08b: recipes (by piece, weight or volume, and batch), cost engine, plate cost, coverage by count, `require_recipe_for_menu` (constant `warn`), snapshot `inventory` key, explosion functions, imperial built-in units. 08c / 08d as 08a §4.4.

### 4.5 Changes to other specs (R26) — applied at approval; version numbers = next free at approval (08b merges before 08d)

| Row | Target → section | Change | Why |
|---|---|---|---|
| P-1 | **08a part of this file** I11, §4.3, §6.0 bump column, §6.3 PATCH, §6.5–§6.7 counts; 08a tests **#9, #25, #28, #31, #35** | I11 replaced by B16: unit POST 7 → **9**; price POST every-branch 9 → **11**, branch 10 → **11** (+1, one branch); yield POST 7 → **9** (08a tests #28, #31, #35); stock-item PATCH of `kind` / `code` / `cost_category` / `is_a_item` bumps every branch; test #9 ("no bump … = bump path − 2") becomes "bumps every branch"; **test #25** (`inventory-filter.int.test.ts` `:31`–`:52`, `:78`–`:85`, `:213`, `:250`): top-level keys gain `inventory`, builder count 23 → **28**, and "ingredient / packet items leave the snapshot byte for byte the same" is inverted to "they change `inventory.items[]` and bump" (⚠️ v0.2 M-12; ⚠️ v0.3 N-7) | B16 |
| P-2 | **08a part** R4 (stock-item PATCH merged rules) | `kind` change of a stock item that owns a non-archived recipe → `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }`, checked with R4's drawers read's statement (+1 read of `recipes` when `kind` changes) (⚠️ v0.2 M-4) | B17 |
| P-3 | **08a part** I3, I4 name rule, §4.2, test **#1** | ⚠️ v0.3 owner ruling: `BUILTIN_UNITS` gains **`lb`** = 45 359 237 / 100 000 g and **`oz`** = 45 359 237 / 1 600 000 g (exact; built-ins are domain constants, not DB rows, so `stock_item_units`' `factor_den ≤ 10^6` does not bind them); I4: `lb` / `oz` cannot be an item unit on a g item (they resolve already) and may be on a piece item; test #1 adds both, in numbers (⚠️ v0.4 t-8 b): "Rs 1 000 per lb → per g = 1 000 × 100 × 100 000 / 45 359 237 minor" (⚠️ v1.0 f-3: × 100 restored, as test 1); ⚠️ v0.4 t-8 (a): an existing item unit named `lb` / `oz` (allowed before P-3) keeps resolving with the owner's own factor (I5 step 2: item unit before built-in) — no migration; no gallon | owner |
| A-2′ | 01a → next, S8, S26, §6 write script | 08a's no-bump exception (A-2) removed; ⚠️ markers updated | B16 |
| A-3 | 01a §4 snapshot, S28 | Optional `inventory` key in schema 4, `z.unknown().optional()` on the hub schema; typed schema exported separately (§5.3) | B15 |
| A-4 | 01a builder / sync bounds (⚠️ v0.2 M-12 full list; ⚠️ v0.3 N-7 corrected) | builder `≤ 23` → **`≤ 28`** (`builder.int.test.ts:395`, `:384`; and 08a #25, row P-1); `snapshot-v4.int.test.ts` constants; config-only `200` ≤ 28 → **≤ 33** (`sync-config.int.test.ts:58`, `sync-gzip-e2e.int.test.ts:166`); with directory ≤ 35 → **≤ 40** (`sync-gzip-e2e.int.test.ts:84`, `:149`); gzip e2e fixture gains the key (m-15) | B15 |
| A-5 | 01a §5.2 `config_audit` | entities + `recipe`, `recipe_version`; action + `publish` | B1 |
| A-6 | 01a migrations (MD-3 / AD-9 pattern) | `0019_recipes.sql` ends with `UPDATE branches SET config_version = config_version + 1` (every branch; release delivery of the key) (⚠️ v0.2 M-1) | B16 |
| B-x | **01b** → next, §4.4 row 6 | sync `200` bound with the directory ≤ 35 → **≤ 40** (written by 01a v2.7 R-32) (⚠️ v0.2 M-12) | B15 |
| C-11 | 01c → next, §6.8 R2 | archive of a stock item used by a non-archived recipe's draft / published line, or `stock_unit` change while a non-archived published line freezes it **or while it owns a non-archived recipe** (⚠️ v0.3 N-1 b) → `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }`; +1 statement (one read of `recipe_lines` ∪ `recipes`) only when archiving or changing `stock_unit` | B17 |
| C-12 | 01c §8 (menu page) | "No recipe" badge from `GET /v1/admin/recipes` (client only) | B14 |
| C-13 | 01c §9 | `409 CONFIG_IN_USE` `used_by.entity: 'recipe'` (⚠️ v0.2 M-12) | B17 |
| C-14 | 01c §6.5 | `sale_unit` change of an item that owns a non-archived recipe → `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }`; +1 statement only when `sale_unit` changes (⚠️ v0.2 M-4) | B17 |
| C-15 | 01c §6.12 | a plain option that owns a non-archived recipe cannot gain a `linked_item_id` → same `409`; +1 statement only when an option becomes linked (⚠️ v0.2 M-4) | B17 |
| C-16 | 01c §6 global lock-order table (⚠️ v0.3 N-7) | rows **0** "tenant publish lock `pg_advisory_xact_lock(8020, hashtext(tenant_id))` (08b)" and **0.5** "`recipes` `FOR UPDATE` (08b)" before kind 1, with the note: no 01c write takes them; 01c writes read `recipes` / `recipe_lines` without a lock (B17). 01a S8 lists no lock kinds — no 01a row | §6 |
| F-1 | Foundation v1.16 §6.2 (append, no bump) and `@pos/domain/src/errors.ts` | `RECIPE_NOT_FOUND` (404) | §6 |
| R-x | README | module map row 08b; R39 slice status (08a R-1 pattern) | — |
| — | 03a / engine, 02b, hub commands | **No change.** The hub stores the body; nothing reads `inventory` until 08c | B15 |

---

## §5. Data model

### 5.1 Cloud — `0019_recipes.sql` (expand; ends with the release bump)

```sql
CREATE TABLE recipes (                                             -- B1: one per owner, ever
  tenant_id TEXT NOT NULL REFERENCES tenants, recipe_id TEXT NOT NULL,     -- ULID
  owner_type TEXT NOT NULL CHECK (owner_type IN ('menu_item','modifier_option','stock_item')),
  owner_id TEXT NOT NULL,                                          -- polymorphic: checked by the service (B2)
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, recipe_id),
  UNIQUE (tenant_id, owner_type, owner_id));                       -- §3.3 one per owner; B17 owner-edit reads

CREATE TABLE recipe_versions (                                     -- B8
  tenant_id TEXT NOT NULL, recipe_version_id TEXT NOT NULL,        -- ULID
  recipe_id TEXT NOT NULL, version_no INT NOT NULL CHECK (version_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft','published','superseded')),
  basis TEXT NOT NULL CHECK (basis IN ('per_unit','per_measure','per_batch')),   -- v0.3: per_kg → per_measure (g or ml)
  base_qty INT CHECK (base_qty BETWEEN 1 AND 1000000),
  batch_yield_qty BIGINT CHECK (batch_yield_qty BETWEEN 1 AND 1000000000),
  CHECK ((basis = 'per_measure') = (base_qty IS NOT NULL)),
  CHECK (basis = 'per_batch' OR batch_yield_qty IS NULL),
  CHECK (status = 'draft' OR basis <> 'per_batch' OR batch_yield_qty IS NOT NULL),
  batch_stock_unit TEXT CHECK (batch_stock_unit IN ('piece','g','ml')),   -- v0.3 N-1: owner's stock_unit frozen with batch_yield_qty
  CHECK ((batch_yield_qty IS NULL) = (batch_stock_unit IS NULL)),
  measure_unit TEXT CHECK (measure_unit IN ('g','ml')),                -- v0.4 T-2: owner's sale_unit frozen on a per_measure version
  CHECK ((basis = 'per_measure') = (measure_unit IS NOT NULL)),
  misc_allowance_bp INT NOT NULL DEFAULT 500 CHECK (misc_allowance_bp BETWEEN 0 AND 5000),
  created_by TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  published_by TEXT, published_at BIGINT,
  CHECK ((status = 'draft') = (published_at IS NULL)),
  PRIMARY KEY (tenant_id, recipe_version_id),
  UNIQUE (tenant_id, recipe_id, version_no),
  FOREIGN KEY (tenant_id, recipe_id) REFERENCES recipes,
  FOREIGN KEY (tenant_id, created_by) REFERENCES owner_users (tenant_id, user_id),
  FOREIGN KEY (tenant_id, published_by) REFERENCES owner_users (tenant_id, user_id));
CREATE UNIQUE INDEX recipe_versions_one_draft ON recipe_versions (tenant_id, recipe_id) WHERE status = 'draft';
CREATE UNIQUE INDEX recipe_versions_one_published ON recipe_versions (tenant_id, recipe_id) WHERE status = 'published';
CREATE INDEX recipe_versions_recent ON recipe_versions (tenant_id, recipe_id, published_at DESC, recipe_version_id DESC)
  WHERE status IN ('published','superseded');                      -- B15 (e) published + 3 superseded; §6.2 history

CREATE TABLE recipe_lines (                                        -- B4
  tenant_id TEXT NOT NULL, recipe_version_id TEXT NOT NULL, line_no INT NOT NULL CHECK (line_no BETWEEN 1 AND 60),
  stock_item_id TEXT NOT NULL,
  unit_name TEXT NOT NULL,                                         -- as entered; resolved by resolveUnit at save
  entered_num BIGINT NOT NULL CHECK (entered_num <> 0), entered_den BIGINT NOT NULL CHECK (entered_den >= 1),
  stock_qty_num BIGINT NOT NULL CHECK (stock_qty_num <> 0 AND abs(stock_qty_num) <= 1000000000000000),
  stock_qty_den BIGINT NOT NULL CHECK (stock_qty_den >= 1),
  stock_unit TEXT NOT NULL CHECK (stock_unit IN ('piece','g','ml')),   -- frozen at save (B4)
  CHECK (sign(entered_num) = sign(stock_qty_num)),
  qty_basis TEXT NOT NULL CHECK (qty_basis IN ('AP','EP')),
  PRIMARY KEY (tenant_id, recipe_version_id, line_no),
  UNIQUE (tenant_id, recipe_version_id, stock_item_id),
  FOREIGN KEY (tenant_id, recipe_version_id) REFERENCES recipe_versions,
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items);
CREATE INDEX recipe_lines_stock_item ON recipe_lines (tenant_id, stock_item_id);   -- B17 in-use read

-- config_audit entity / action CHECKs widen (row A-5): live lists re-read first (01b D-5).
-- ⚠️ v0.2 M-1 (row A-6): release delivery of the inventory key, as 0017 (01a MD-3) and 0012 (AD-9).
UPDATE branches SET config_version = config_version + 1;
```

Published content is append-only in the service: no statement updates `recipe_lines` of a non-draft version or a non-draft version's fields except `status` (published → superseded). Draft lines are replaced (delete + insert) inside the draft save.

### 5.2 Hub
No migration, no event, no projection. The snapshot body (with `inventory`) is stored and hashed as today.

### 5.3 Snapshot `inventory` key — `InventorySnapshotSchema` (`packages/events/src/config.ts`, exported; the V4 hub schema has `inventory: z.unknown().optional()`)

```ts
inventory?: {
  items: { stock_item_id: string; kind: 'prepared'|'ingredient'|'packet'; name: string; code: string|null;
           stock_unit: 'piece'|'g'|'ml'; cost_category: string; is_a_item: boolean }[];   // active only
  units: { stock_item_id: string; unit_name: string; factor_num: string; factor_den: string }[];   // m-16
  prices: { price_id: string; stock_item_id: string; branch_id: string|null; kind: 'manual'|'market_rate';
            unit_name: string; stock_unit: 'piece'|'g'|'ml';                // v0.3 n-1: PriceRow needs both
            price_minor: string; stock_qty_num: string; stock_qty_den: string;
            created_at: number; valid_until_at: number|null }[];          // B15 (a) non-dominated rows; buildCostInputs replaces created_at by its per-item rank (v0.4 t-1)
  yields: { stock_item_id: string; yield_bp: number }[];
  recipes: { recipe_version_id: string; status: 'published'|'superseded';
             owner_type: 'menu_item'|'modifier_option'|'stock_item'; owner_id: string;
             basis: 'per_unit'|'per_measure'|'per_batch'; base_qty: number|null; measure_unit: 'g'|'ml'|null;   // v0.4 T-2
             recipe_archived: boolean;                                                                      // v0.4 t-7 b
             batch_yield_qty: string|null; batch_stock_unit: 'piece'|'g'|'ml'|null;   // v0.3 N-1
             misc_allowance_bp: number; published_at: number;
             lines: { stock_item_id: string; stock_qty_num: string; stock_qty_den: string;
                      stock_unit: 'piece'|'g'|'ml'; qty_basis: 'AP'|'EP' }[] }[];  // v0.3 N-1: frozen unit
  // v0.3 N-4: no object is .strict(); v0.4 t-5: buildCostInputs parses with InventoryElementsLenient (enum-like fields as strings)
}
```

**Order (⚠️ v0.2 m-1), sorted in JS by code point:** `items` by `stock_item_id`; `units` by (`stock_item_id`, `unit_name`); `prices` by `price_id`; `yields` by `stock_item_id`; `recipes` by `recipe_version_id`; `lines` by `line_no`. **Builder: 5 statements** (items; units `DISTINCT ON (stock_item_id, unit_name)` over the current base; prices — **`selectSnapshotPrices(db, branchId)`**, the dominance rule as one window query with **no `now`** (⚠️ v0.3 N-3; not 08a's `selectPriceCandidates`); yields `DISTINCT ON`; versions with `json_agg(lines ORDER BY line_no)`, `ROW_NUMBER() ≤ 4` per recipe over published + superseded, owner filter of B15 (e), **archived recipes included** with `recipe_archived`, ⚠️ v0.4 t-7 b — same statement, so still 5). After building, `InventorySnapshotSchema.safeParse(key)`; failure → log `inventory_key_invalid` and send the key as built (B15 c, N-4).

### 5.4 Wires (`packages/events/src/admin/recipes.ts`)
`RecipeSummaryWire { recipe_id, owner_type, owner_id, owner_name, owner_archived, archived, has_draft, published: { recipe_version_id, version_no, published_at } | null, plate_cost: CostWire }`; `CostWire { status: 'costed'|'partial'|'no_recipe', minor: string | null, unknown_items: string[] }` (`minor` rounded once, half away from zero; `null` for `no_recipe` or when `known` is false, ⚠️ v0.4 t-6); `RecipeVersionWire { recipe_version_id, version_no, status, basis, base_qty, measure_unit /* v0.4 T-2 */, batch_yield_qty: string | null, batch_stock_unit, misc_allowance_bp, lines: RecipeLineWire[], cost: CostWire, warnings: { code, line_no? }[], created_by_name, published_by_name, published_at, version }` (`version` for `expected_version`, V13); `RecipeLineWire { line_no, stock_item_id, stock_item_name, kind, unit_name, qty: string, qty_basis, line_cost: CostWire }`; `CoverageWire { items_total, items_with_recipe, pct_bp }`.

---

## §6. Endpoints

Owner routes (JWT, tenant guard, password guard, C4 order). Every route is tenant-wide (`assertTenantWide` / `coversEveryBranch`; one owner covers every branch, 01b B8, 08a I10). `branch_id?` query for costs: C2 assert before SQL; absent = every-branch prices only. Shared failures as 08a §6. Every route in `route-cases.ts` (C7).

**Cost context (⚠️ v0.2 M-13)** = **5 tenant-wide reads**, run once per request and reused by every cost in the response: active stock items; current item units; price rows (08a's `selectPriceCandidates`, `inventory/repository.ts`, for `branch_id` and every branch — time-filtered, fine for a response at `now`; ⚠️ v0.3 N-3); active yields; every non-archived recipe's published version with lines (`json_agg`). The publish graph read **is** the fifth read. (The cost context stays non-archived: the owner app costs live recipes; only the snapshot carries archived recipes' versions, t-7 b.)

**Lock order (⚠️ v0.2 M-14, B-1)** for 08b writes:

| # | Kind | Taken by |
|---|---|---|
| 0 | tenant publish lock `pg_advisory_xact_lock(8020, hashtext(tenant_id))` (8020 = 08b's advisory namespace) | §6.5 publish; §6.6 **every `PATCH` with `archived: false`**, whatever the row turns out to be (⚠️ v0.3 N-2) — before any row lock and before the graph read |
| 0.5 | `recipes` (`FOR UPDATE`) | §6.4, §6.5, §6.6 target |
| 1 | the option's `modifier_groups` row (`FOR SHARE`) — an option owner is read under its group | §6.3, §6.4 (⚠️ v0.4 T-1), §6.5, §6.6 restore when the owner is a `modifier_option` |
| 4 | `menu_items` (`FOR SHARE`) | §6.3, §6.4 (⚠️ v0.4 T-1), §6.5, §6.6 restore when the owner is a `menu_item` |
| 5 | `stock_items` (`FOR SHARE`): the owner (if a stock item) **and** the line stock items in **one** `= ANY` statement, id order | §6.3, §6.4, §6.5, §6.6 restore |
| 10 | `branches` (bump) | §6.5, §6.6 when they bump |

This table is copied into 01c §6's global table as kinds 0 and 0.5 (row C-16, ⚠️ v0.3 N-7). No 01a / 01c / 08a write locks `recipes` or the advisory key (B17's checks read `recipes` / `recipe_lines` without a lock), so 08b's kinds 0 and 0.5 before 01c's kinds 1–10 create no cycle. A B17 owner-edit check (C-14, C-15, P-2) races a recipe create only through the owner row (create takes it `FOR SHARE`, the 01c / 08a write `FOR UPDATE`): one serialises behind the other, and the second sees the first's commit (READ COMMITTED read after its lock).

| § | Route | Audit | Bump |
|---|---|---|---|
| 6.1 | `GET /v1/admin/recipes` | — | — |
| 6.2 | `GET /v1/admin/recipes/:recipe_id` | — | — |
| 6.3 | `POST /v1/admin/recipes` (Idempotency-Key) | `recipe` / `create`, `recipe_version` / `create` (2 rows, one insert) | none |
| 6.4 | `PUT /v1/admin/recipes/:recipe_id/draft` | `recipe_version` / `create` or `update` | none |
| 6.5 | `POST /v1/admin/recipes/:recipe_id/publish` | `recipe_version` / `publish` (new) + `recipe_version` / `update` (superseded, when one existed) + `recipe` / `restore` (when the recipe was archived, ⚠️ v0.4 T-1) — one insert | every branch |
| 6.6 | `PATCH /v1/admin/recipes/:recipe_id` | `recipe` / `archive`, `restore` | every branch when the recipe has a published version |

#### 6.1 `GET /v1/admin/recipes` — Recipes page and coverage
Query `branch_id?`, `filter? ∈ all | missing | partial`. Response `{ can_edit_tenant, coverage: CoverageWire, rows: RecipeSummaryWire[] }` (⚠️ v0.3 n-10: no `setting` field; the client hard-codes `warn`): one row per **active** sellable menu item, active plain option and active `prepared` stock item (with or without recipe), plus archived owners that have a recipe. Order: owner kind (menu items, options, stock items), then `lower(name)`, id. **9 fixed statements:** coversEveryBranch, menu items, plain options, recipes (all, with draft / published flags) + cost context 5. The cost context's stock-items read takes `kind = 'prepared' OR archived_at IS NULL`, so it doubles as the prepared-owner list **including archived prepared owners** (⚠️ v0.3 n-3; same statement; cost uses only active rows).

#### 6.2 `GET /v1/admin/recipes/:recipe_id`
Response `{ can_edit_tenant, recipe: RecipeSummaryWire, draft: RecipeVersionWire | null, published: RecipeVersionWire | null, history: [{ recipe_version_id, version_no, status, published_at, published_by_name }] (≤ 50) }`. **11 fixed:** coversEveryBranch, recipe, owner row, versions (≤ 50), draft with lines (`json_agg`), owner names (`= ANY`) + cost context 5. Errors `404 RECIPE_NOT_FOUND`, `404 BRANCH_NOT_FOUND`.

#### 6.3 `POST /v1/admin/recipes` (Idempotency-Key)
Body `{ owner_type, owner_id }`. Script: validate → `BEGIN` → key → tenant-wide → owner read `FOR SHARE` (kind 1 group for an option, 4, or 5) → B2 checks → `INSERT INTO recipes … ON CONFLICT (tenant_id, owner_type, owner_id) DO NOTHING RETURNING recipe_id` → **0 rows**: read the existing recipe's id and answer `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids: [existing] } }` (the transaction is not aborted, so the read works; ⚠️ v0.3 n-2) → insert draft v1 (basis, `base_qty` 1 000 and `measure_unit` from the owner row read above, B3; no lines; ⚠️ v1.0 f-4) → audit (2 rows) → key response → prune → `COMMIT`. `201 { data: { recipe: RecipeSummaryWire, draft: RecipeVersionWire } }`. **8 statements**; ⚠️ v0.4 t-2: the conflict path **7** (key, tenant-wide, owner, insert 0 rows, existing-id read, stored `409` key response, prune — no draft insert, no audit).

| Edge | Answer |
|---|---|
| "Paye Half" (piece) | draft `per_unit` |
| "Chicken karahi by weight" (g) | draft `per_measure`, `base_qty 1000` (per kg), `measure_unit: 'g'` (⚠️ v1.0 f-4) |
| "Lassi by volume" (ml) | draft `per_measure`, `base_qty 1000` (per litre), `measure_unit: 'ml'` (⚠️ v0.3 owner ruling; v1.0 f-4) |
| "BIRYANI-COOKED" (prepared, `piece` = plate) | `per_batch`; `batch_yield_qty` = plates per deg (⚠️ v0.3 owner ruling) |
| PAYE-COOKED (prepared) | `per_batch`, `batch_yield_qty` null until set |
| TP-1 (packet) or raw beef (ingredient) | `422 wrong_kind` |
| Linked option "Extra naan" | `422 linked_option` |
| Second recipe for the same owner | `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids: [existing] } }` |
| Retry with the same key | stored `201` replayed |

#### 6.4 `PUT /v1/admin/recipes/:recipe_id/draft`
Body `{ expected_version: string | null, base_qty?, batch_yield_qty?, misc_allowance_bp?, lines: [{ stock_item_id, unit_name, qty, qty_basis? }] }` (`null` = no draft exists; creates version `max + 1`). Script: validate → `BEGIN` → tenant-wide → lock recipe `FOR UPDATE` (`404 RECIPE_NOT_FOUND`; ⚠️ v0.4 T-1: an **archived** recipe is accepted) → `afterRecipeLock` hook → draft read (`409 CONFIG_STALE`) → ⚠️ v0.4 t-4 / T-1: **owner row** `FOR SHARE` (kind 1 group for an option, kind 4 for a menu item) → the owner (if a stock item) + line stock items `FOR SHARE` (kind 5, one `= ANY`, id order; `not_found` / `archived`) → derive `basis`, `measure_unit`, `batch_stock_unit` from the locked owner (B3) → basis / negative checks (`422`, m-7) → their item units → their active yields (M-7 default) → `resolveUnit` per line on the locked `stock_unit`, freeze, range check → upsert draft version → delete draft lines → insert lines (one multi-row) → audit → `COMMIT`. `200 { data: { draft: RecipeVersionWire } }` with B6 warnings and the draft's cost. ⚠️ v0.4 T-1 / t-4: **17 statements** (**16** for a stock-item owner): 11 for the write (tenant-wide, lock, draft read, owner row — none for a stock-item owner, read with the line stock items —, stock items, units, yields, upsert, delete, insert, audit) + 6 for the response (owner names **joined with the owner row** — its `sale_unit` for `main_line_off`, ⚠️ v0.3 n-4 — + cost context 5). No bump. A `per_batch` draft freezes `batch_stock_unit` = the owner's `stock_unit` with `batch_yield_qty`; a `per_measure` draft freezes `measure_unit` = the owner's `sale_unit` (⚠️ v0.4 T-2); both from the **locked** owner row.

| Edge | Answer |
|---|---|
| "Tawa piece": beef 250 g (beef has a yield), TP-1 15 g, oil 20 ml, onion 30 g (no yield), makhan 10 g (no yield) | `200`; beef EP; onion, oil and makhan AP, each with `no_yield_defaulted_ap` (⚠️ v0.3 n-4: makhan too); TP-1 AP |
| Explicit EP on onion with no yield | `200`; warning; cost `partial` (D9) |
| Line `ghee 0.92 l` on ghee in g with `l` = 920 g | frozen 846.4 g = 4232 / 5 |
| Line `-30 g onion` on plain option "No onion" | `200` |
| Negative on a menu-item recipe | `422 negative_not_option` |
| `batch_yield_qty` on a `per_unit` recipe | `422 basis_mismatch` |
| Same stock item twice | `400` |
| Stale tab | `409 CONFIG_STALE` |
| ⚠️ v0.4 T-1: draft on an **archived** "Chicken karahi" whose `sale_unit` changed piece → g, with `base_qty: 1000` | `200`; basis `per_measure`, `measure_unit: 'g'` (derived from the locked owner) |
| Same, still sending a piece-only recipe without `base_qty` | `422 { field: 'base_qty', reason: 'basis_mismatch' }` (the derived basis needs it) |

#### 6.5 `POST /v1/admin/recipes/:recipe_id/publish`
Body `{ expected_version }`. Script: validate → `BEGIN` → tenant-wide → **publish lock (kind 0)** → `afterPublishLock` hook → lock recipe `FOR UPDATE` (⚠️ v0.4 T-1: an archived recipe is accepted; it is un-archived below when every check passes) → draft with lines (`409 CONFIG_STALE` when none / stale) → owner row `FOR SHARE` (kind 1 / 4; a stock-item owner is read in the next statement) → owner (if stock item) + line stock items `FOR SHARE` (kind 5, one statement) → **graph read** (cost-context read 5: every non-archived published version with lines) → B6 (basis and `measure_unit` vs current owner, yield, archived lines, frozen units, empty, cycle / depth over the whole graph with this version in place — the graph read covers non-archived recipes, and this recipe's own new version is placed in it whether the recipe was archived or not) → old published → `superseded` → draft → `published` (`published_at = now`) → ⚠️ v0.4 T-1: **when the recipe was archived: `UPDATE recipes SET archived_at = NULL`** → audit (1, 2 or 3 rows, one insert: + `recipe` / `restore`) → bump every branch (2) → `COMMIT`. `200 { data: { published: RecipeVersionWire } }`. **Statements (exact):** write = tenant-wide, publish lock, recipe lock, draft with lines, owner row (menu item, or the option's group; none for a stock-item owner, which is read with the line stock items), stock items, graph, supersede, publish, audit, bump 2 = **12** (**11** for a stock-item owner); response = owner names + stock items, units, prices, yields of the cost context (its versions read is the graph read) = **5**. Total **17**, **16** for a stock-item owner; −1 each when no published version existed (no supersede): **16 / 15**; ⚠️ v0.4 T-1: **+1** each when the recipe was archived (the un-archive update): **18 / 17 / 17 / 16**.

| Edge | Answer |
|---|---|
| PAYE-COOKED batch: 40 paye AP (kg via peti), ghee, onion, adrak-lehsan, 2 × PY-1 (packet, AP), yield 160 pieces | `200`; cost per piece = batch cost ÷ 160 (no misc on the batch when used as a line, B5) |
| PAYE-COOKED uses QEEMA-COOKED which uses PAYE-COOKED | `422 cycle` |
| Menu item → A → B → C → D (prepared) | `422 too_deep` |
| Publishing C (C → D) where M → A → B → C already exists | `422 too_deep` (the whole graph is checked, M-3) |
| Two tabs publish PAYE-COOKED (→ QEEMA) and QEEMA-COOKED (→ PAYE) at once | one `200`, the other waits on the publish lock and then `422 cycle` (test 16) |
| Option "Spicy" with no lines | `200`, costs 0, `costed` (M-6) |
| `per_measure` with no main AP line near `base_qty` | `200` with warning `main_line_off` (R7) |
| PAYE-COOKED's `stock_unit` changed (g ≠ frozen `batch_stock_unit` piece) | `422 { field: 'batch_yield_qty', reason: 'unit_changed' }` (⚠️ v0.3 N-1; normally refused earlier by C-11) |
| Line stock item's unit changed since the draft save | `422 unit_changed` |
| Publish twice with the same version | second `409 CONFIG_STALE` |
| ⚠️ v0.4 T-1: publish the new `per_measure` draft of the archived "Chicken karahi" (now g) | `200`; recipe active again; one `recipe` / `restore` audit row; bump every branch; the old per_unit version is `superseded` (it stays in the snapshot for old lines, B15 e) |
| ⚠️ v0.4 T-2: publish a `per_measure` draft frozen at `g` after the owner moved g → ml (archived path) | `422 basis_mismatch` — save the draft again (it re-derives `ml`) and publish |

#### 6.6 `PATCH /v1/admin/recipes/:recipe_id`
Body `{ expected_version, archived }` (recipe-level version, V13; R7: no `visibility_scope`).

- **`archived: true`** (archive): validate → `BEGIN` → tenant-wide → lock recipe `FOR UPDATE` (`404`) → version (`409 CONFIG_STALE`) → already archived: no-op `200`, no audit, no bump (**2**) → write → audit → bump 2 when it has a published version = **6** (4 without). Archiving never breaks the graph (it only removes nodes), so it takes no publish lock.
- **`archived: false`** (restore, ⚠️ v0.3 N-2): validate → `BEGIN` → tenant-wide → **publish lock (kind 0) first, always** — before the recipe lock, whatever the row turns out to be (the request cannot know whether it is a restore with a published version until it reads the row, and reading it under kind 0.5 first would invert 0 → 0.5) → `afterPublishLock` → lock recipe `FOR UPDATE` (`404`) → version (`409 CONFIG_STALE`) → already active: no-op `200` (**3**: tenant-wide, lock 0, recipe) → no published version: write → audit (**5**) → with a published version (⚠️ v0.3 N-1, **every** B6 check, not only the graph): graph read (the tenant's non-archived published graph **plus this recipe's published version with its lines**, one statement) → owner row `FOR SHARE` (kind 1 group for an option, 4 for a menu item; none for a stock-item owner) → owner (if stock item) + line stock items `FOR SHARE` (kind 5, one statement) → checks on the locked rows: basis vs the owner's current `sale_unit` / kind and a `per_measure` version's `measure_unit` vs the current `sale_unit` (`basis_mismatch`, ⚠️ v0.4 T-2), plain option (`linked_option`), `prepared` owner (`wrong_kind`), lines active (`archived`), frozen line `stock_unit` = current and `batch_stock_unit` = the owner's current (`unit_changed`), cycle / depth over the whole graph with the recipe back (`cycle` / `too_deep`) → `422 { field: 'archived', reason, hint: 'new_draft' }`, nothing written (⚠️ v0.4 T-1: the way forward is a new draft and a publish, §6.4 / §6.5) → write → audit → bump 2 = **10** (**9** for a stock-item owner).

An owner-archived recipe may be restored (the owner stays archived; its checks still run against the owner row). The graph read before the row locks is safe: kind 0 excludes every concurrent publish and restore, and every check that can change under a concurrent 01c / 08a write reads a row locked here.

| Edge | Answer |
|---|---|
| "Chicken karahi" (piece) recipe archived → item `sale_unit` → g → restore | `422 { field: 'archived', reason: 'basis_mismatch', hint: 'new_draft' }` (N-1 a); ⚠️ v0.4 T-1: then `PUT …/draft` (per_measure, g) `200` → publish `200`, recipe active again |
| ⚠️ v0.4 T-2: "Lassi" `per_measure` at g archived → `sale_unit` g → ml → restore | `422 basis_mismatch` (frozen `measure_unit` g ≠ ml) |
| Plain option "Spicy" archived → made linked → restore | `422 linked_option` |
| "Tawa piece" archived → ghee `stock_unit` ml → g → restore | `422 unit_changed` (N-1 c) |
| PAYE-COOKED archived → its `stock_unit` piece → g → restore | `422 unit_changed` (frozen `batch_stock_unit`) |
| Restore ∥ publish of the same recipe (two tabs) | serial on kind 0: one commits, the other sees it (`409 CONFIG_STALE` or the checks against the new state); never `40P01` (test 37) |
| Restore that closes a cycle ∥ a publish that closes it the other way | exactly one `422 cycle` (test 38) |

---

## §7. Cross-cutting
Logging as 08a AD-11 (no explicit write log). Performance: tens of menu items, a few hundred lines; the cost context is 5 reads; owner pages < 300 ms p95 locally. **Snapshot growth** (⚠️ v0.2 m-15): measured, not guessed — the S48 gzip e2e fixture (5 000 items) gains an inventory key with 200 stock items, 30 days of daily market rates (dominance keeps ~1–2 rows per item), 300 recipes × 4 versions; the test asserts the gzip size bound of S48 and the statement bound. Risks: (1) partial costs read as real — the `partial` badge and "unknown items" always show; (2) a wrong recipe quantity skews everything — the editor shows each line's cost and the plate cost live; (3) the no-yield AP default hides a forgotten test cut — the `no_yield_defaulted_ap` warning shows on each such line.

---

## §8. Client contract (owner app)
1. **Recipes page** (new `features/owner/recipes/RecipeList.tsx`): coverage line ("38 of 52 items have a recipe — 73 %"), filter All / Missing / Partial, rows grouped Menu items · Options · Prepared, each with **Plate cost (menu cost)** (`CostWire`: "Rs 412", "Rs 380 · partial", "No cost yet · partial", "No recipe"), branch picker.
2. **Recipe editor** (`RecipeEditor.tsx`): owner header, basis fields per §3.2 (batch yield "makes 160 piece" / "makes 40 plates"; `per_measure` shown as "per kg" or "per litre" from the sale unit, ⚠️ v0.3), misc allowance %, line table (stock item search across kinds, quantity + unit pick-list from `resolveUnit`-accepted units, AP / EP toggle showing the derived default), live line cost and plate cost, warnings, **Save draft** / **Publish** / history.
3. **Menu page badge** (01c item list): "No recipe" on every active item without a published recipe (data from §6.1, C-12; 9 statements accepted for the pilot, m-17).
4. Labels per 08a I12. Urdu strings to the urdu-todo list.
5. 01c / 08a forms show the B17 `409 { entity: 'recipe' }` text with a link to the recipe ("archive the recipe first").

---

## §9. Error catalogue additions
New code **`RECIPE_NOT_FOUND`** (404). New `details`: `422 CONFIG_REFERENCE_INVALID` reasons (also with `field: 'archived'` on restore, ⚠️ v0.3 N-1) `linked_option`, `basis_mismatch`, `negative_not_option`, `batch_yield_missing`, `unit_changed`, `cycle`, `too_deep`, `empty`, `qty_out_of_range`, and on restore `hint: 'new_draft'` (⚠️ v0.4 T-1) (and existing `not_found`, `archived`, `not_convertible`, `wrong_kind` on new fields); `409 CONFIG_IN_USE` `used_by.entity: 'recipe'`.

---

## §10. Tests

### 10.1 Pure (`packages/domain/src/inventory/costing.test.ts`)
| # | Case |
|---|---|
| 1 | Line cost: beef 250 g EP, Rs 1,500 / kg, yield 7 120 → exact fraction; AP line with no yield divides by 1; ⚠️ v0.4 t-8: a beef price of Rs 1 000 per `lb` (P-3) → per g = 1 000 × 100 × 100 000 / 45 359 237 minor (exact fraction); an existing item unit named `lb` keeps its own factor |
| 2 | Missing price → line unknown, `partial`, value = known lines; EP ingredient line with no yield → `partial` (never yield 1); EP on packet / prepared → no division; all lines unknown → `minor: null`; ⚠️ v0.3 N-1: a line whose frozen `stock_unit` ≠ the item's current one → unknown (never re-read in the new unit); a batch whose `batch_stock_unit` ≠ the owner's → `partial`; ⚠️ v0.4 T-2: a `per_measure` recipe frozen at `g` on an `ml` line → unknown, `partial`; a `per_unit` recipe on a g line → `partial`; ⚠️ v0.4 t-6: an empty "Spicy" option → `known: true`, value 0; every line unknown → `known: false`; `stockItemUnitCost`: ingredient = 08a `pricePerStockUnit(effectiveMenuPrice(…))` (`source: 'menu'`), prepared with recipe → `source: 'recipe'`, none → `null` |
| 3 | Misc 500 bp at the top recipe only (owner ruling OQ-4): Paye Half = (200 + 20) × 1.05 = Rs 231, not 241.50 (B5); `explodeUsage` never applies it |
| 4 | Produced item: PAYE-COOKED batch cost ÷ 160 pieces; "Paye Half" uses it; a `partial` batch makes Paye Half `partial`; packet costs by menu price |
| 5 | `per_measure`: karahi recipe for 1 000 g, sale 1 250 g → × 5/4; **lassi recipe for 1 000 ml, sale 300 ml → × 3/10** (⚠️ v0.3); option on a g / ml parent costs once per line; on a piece parent × parent qty (`childQuantity`, bigint → number at the boundary) |
| 6 | ⚠️ v0.3 N-5: `dealCost` over part results: one part `no_recipe` + others costed → `partial`; every part `no_recipe` → `no_recipe`; all costed → `costed`; a part line's quantity = part qty × deal qty (2 deals × part qty 2 → `plateCost` called with 4); ⚠️ v0.4 t-3: 2 family deals with a 1 000 g karahi part + plain "No onion" (−30 g) → the option counted × 2 (`deal_qty: 2n`); ⚠️ v0.4 t-6: every part unknown → `known: false` ("No cost yet"); plain option without recipe → +0, `partial`; `recipe_version_ids` returned for item and options |
| 7 | B7 cap in AP stock units after yield: "No onion" −30 g on a parent with 20 g direct onion → −20 g; on a parent with onion only inside QEEMA-COOKED → 0; per parent unit × parent qty; on a `per_measure` parent × `q / base_qty` (⚠️ v0.3 n-6) |
| 8 | `explodeUsage` with per-line version ids: EP → AP by yield; prepared always exploded; packet never; unknown yield → `partial`; a version id absent from inputs → that part `partial`; ⚠️ v1.0 f-2: a karahi line ordered in g whose recorded version is `per_measure` ml → `partial`, nothing exploded |
| 9 | Round once, half away from zero: +0.5 → 1, −0.5 → −1; summing rounded lines never used |
| 10 | **Never throws** (B-1): inputs with a cycle and with depth 4 → `recipeCost`, `plateCost`, `explodeUsage`, `explodeStockItem`, `stockItemUnitCost` return `partial` / `null`; ⚠️ v0.3 N-4: `buildCostInputs` on a key with one element of an unknown `kind` and one malformed price row → `dropped = 1`, the unknown-kind element kept as a string (⚠️ v0.4 t-5: `InventoryElementsLenient`) and treated unknown; every other line costed |
| 11 | `explodeStockItem`: 14n pieces PAYE-COOKED → 14/160 of each batch line in stock units; **6n plates BIRYANI-COOKED (`piece`, batch 40 plates) → 6/40 of rice, chicken, ghee** (⚠️ v0.3 owner ruling); through a prepared sub-item; depth 4 dropped, `partial`; a prepared item with no published recipe → empty usage, `partial` (N-6) |

### 10.2 Cloud routes (`apps/cloud/test/recipes/*.int.test.ts`)
| # | Case |
|---|---|
| 12 | §6.4 edges table; M-7 AP default with `no_yield_defaulted_ap`; frozen ghee quantity; range `422 qty_out_of_range`; ⚠️ v0.4 T-1 / t-4: 17 statements (16 for a stock-item owner); owner read `FOR SHARE` before the line stock items (statement log); `measure_unit` frozen from the locked owner; draft on an archived recipe `200`; stale `409` |
| 13 | §6.3 owner kinds and edges (packet `wrong_kind`; lassi `per_measure` ml with `measure_unit: 'ml'` asserted, ⚠️ v1.0 f-4; biryani `per_batch`); 8 statements; ⚠️ v0.4 t-2: conflict path **7** with `ids: [existing]` read after `ON CONFLICT DO NOTHING`, no audit; 2 audit rows on the normal path; replay |
| 14 | §6.5 publish: `superseded` / `published`; immutability (grep test: no UPDATE of non-draft lines, as 08a #34); 17 / 16 / 16 / 15 statements; ⚠️ v0.4 T-1: 18 / 17 / 17 / 16 on an archived recipe |
| 15 | §6.5 refusals (each reason; ⚠️ v0.4 T-1: an archived recipe is no longer refused; T-2: `measure_unit` ≠ current `sale_unit` → `basis_mismatch`); empty option recipe `200` `costed`; warnings (EP-in-batch, `no_yield_defaulted_ap`, no price, `main_line_off` only when units match) |
| 16 | **B-1 race:** two publishes forming a cycle, both started after `afterPublishLock` holds the first → exactly one `200`, the other `422 cycle`; the published graph is acyclic after both commit |
| 17 | §6.5 bump: every branch +1 |
| 18 | §6.6 archive (6 / 4; no-op 2); restore (⚠️ v0.3 N-1, N-2): kind 0 taken first on every `archived: false` (statement log order); no-op 3; without published 5; with published 10 / 9 (stock-item owner); each §6.6 edge row: `basis_mismatch` after a `sale_unit` change, `linked_option`, `unit_changed` (line and batch), `cycle` (M-3 scenario b); nothing written on a refusal; ⚠️ v0.4 T-1: the refusal carries `hint: 'new_draft'`; T-2: "Lassi" g → ml restore `422 basis_mismatch` |
| 18b | ⚠️ v0.4 T-1: **the way forward**: "Chicken karahi" (piece) with a published recipe → archive → `sale_unit` → g `200` → restore `422` → `PUT …/draft` (`expected_version` = the existing draft's, or `null`) with `base_qty: 1000` → `200` `per_measure`, `measure_unit: 'g'` → publish `200` → recipe active, the per_unit version `superseded`, one `recipe` / `restore` audit row, every branch bumped; a karahi line of 1 250 g is costed from the new version (× 5/4); the race publish-of-archived ∥ C-14 `sale_unit` change → one serialises on the menu item, never a published version whose `measure_unit` ≠ the committed `sale_unit` |
| 19 | §6.1 coverage by count (variants count, options / stock items do not, archived recipes do not); rows incl. an **archived prepared owner** named (n-3); no `setting` field (n-10); 9 statements; `branch_id` foreign `404` |
| 20 | §6.2 detail; 11 statements |
| 21 | Audit rows per route (one per entity); cross-tenant sweep (C7) |
| 22 | B17: C-11 stock-item archive / `stock_unit` with a non-archived line → `409`; **a prepared owner's own `stock_unit` change → `409`** (⚠️ v0.3 N-1 b); archived recipe → `200`; C-14 `sale_unit` change of an owner → `409`; C-15 plain → linked → `409`; P-2 `kind` change of a prepared owner → `409`; each `200` after the recipe is archived — and each such recipe's **restore** then `422` (test 18) |

### 10.3 Snapshot and bump (`apps/cloud/test/config-sync/inventory-key.int.test.ts`)
| # | Case |
|---|---|
| 23 | Key contents for Lake City: active items, current units, non-dominated prices with `unit_name` / `stock_unit` (latest manual; a newer market rate expiring later; a dominated older rate absent), active yields, published + ≤ 3 superseded versions of menu-item / option / prepared owners with `batch_stock_unit` and lines' `stock_unit`; drafts absent; a raw-SQL recipe owned by a packet absent (backstop); the builder's price read has no `now` parameter (N-3); ⚠️ v0.4 t-7 b: an archived recipe's published + superseded versions present with `recipe_archived: true`, and absent from `publishedByOwner` on the hub; ⚠️ v0.4 T-2: `measure_unit` on per_measure versions |
| 24 | Typed `InventorySnapshotSchema` parses every built key; it is not `.strict()` (an extra field on `items[]` parses); a builder output that fails the schema logs `inventory_key_invalid` and the sync still answers `200` with the key (N-4) |
| 25 | Builder ≤ 28; sync config-only ≤ 33, with directory ≤ 40 (01b row); S48 gzip e2e with the key within its size bound |
| 26 | B16: unit / yield / every-branch price POST bump every branch; branch market rate bumps one; draft save, create, archive of a never-published recipe bump none; stock-item PATCH of `is_a_item` bumps (08a #9 updated); 08a #28 / #31 / #35 counts 9 / 11 / 11 / 9; 08a #25 inverted (P-1) |
| 27 | **Hash stability (M-2):** two builds of one version, the second after a market rate's `valid_until_at` → equal hash. **Hub (M-5):** a body whose `inventory` fails the typed schema still applies (`branch_config` updated, no `schema_invalid`); a body without the key parses; **hub clock 10 min behind** the newest manual price's `created_at` → that price is used (n-1); ⚠️ v0.4 t-1: two price rows of one item whose `price_id` order differs from their `created_at` order → the hub picks the same row as 08a I7 on the cloud |
| 27b | ⚠️ v0.3 N-4: a key with one `items[]` row of `kind: 'semi_prepared'` and one malformed `recipes[]` element → every other sale line is costed from it on the hub (`buildCostInputs`, `dropped = 1`) |
| 28 | No hub projection reads the key (grep); engine / 02b suites unchanged |
| 33 | **Release (M-1):** after `0019` migrates, `GET /v1/sync/config` with the pre-migration version returns `200` with `inventory` |

### 10.4 Races (`apps/cloud/test/recipes/races.int.test.ts`, ⚠️ v0.2 M-14)
| # | Case |
|---|---|
| 34 | Draft save ∥ stock-item archive of a line item: `409 { entity: 'recipe' }` or `422 archived`, never both committed |
| 35 | Publish ∥ `stock_unit` change of a line item: `422 unit_changed` or `409 CONFIG_IN_USE`, never a published line with a stale frozen unit |
| 36 | Publish ∥ §6.6 archive of the same recipe: serialised on `recipes`; result is either published-then-archived, or archived-then-published (the recipe is active again, one `recipe` / `restore` audit row; ⚠️ v1.0 f-1); never a published version left on an archived recipe |
| 37 | ⚠️ v0.3 N-2, n-12: restore ∥ publish of the same recipe, both orders (`afterPublishLock` holds one) → serial on kind 0, never `40P01`; restore ∥ a C-14 `sale_unit` change of its owner → either the restore `422 basis_mismatch` or the owner edit `409 CONFIG_IN_USE`, never a restored recipe with a flipped basis |
| 38 | ⚠️ v0.3 N-2: restore of A (A → B) ∥ publish of B (B → A) → exactly one `422 cycle`; the graph is acyclic after both commit |

### 10.5 Client
| # | Case |
|---|---|
| 29 | Recipes page coverage text, filters; `partial` / "No cost yet · partial" (`known: false`, ⚠️ v0.4 t-6) / "No recipe" (never "Rs 0" for a missing cost); restore `422` with `hint: 'new_draft'` shows "Make a new recipe version" (T-1) |
| 30 | Editor: unit pick-list; AP / EP derived default shown; live cost; publish errors mapped |
| 31 | Menu badge "No recipe" |
| 32 | Labels: "Plate cost (menu cost)"; no "today's cost" string; B17 `409` text links the recipe |

### 10.6 Acceptance
| Source | Check | Test |
|---|---|---|
| 08-g0 §7 drill 2: Half paye, tawa piece, anda tikki, 1 kg karahi, paper vs system to Rs 1 | fixtures with the owner's paper figures; `plateCost` rounded = paper | 4, 5, 9 + `[08b drill 2]` (filled when the owner gives the figures, OQ-1) |
| §3.7 validation | B6 | 12, 15, 16, 18, 18b |
| §3.8 formulas | B9, B10 | 1–6 |
| D9 | partial, never 0 | 2, 29 |
| Owner contract | `explodeStockItem`, per-line versions | 8, 11 |

---

## §11. Build order
**Start after `module-08a` merges into `main`** (PR #476; ⚠️ v0.3 m-13: 08a's price POST and its `selectPriceCandidates` must exist — the cost context uses it; the builder does not).
1. Migration `0019_recipes.sql` + audit CHECKs (A-5) + release bump (A-6) — schema test, test 33.
2. `@pos/domain/src/inventory/costing.ts` (+ `dealCost`, `stockItemUnitCost`, element-wise `buildCostInputs`) and 08a's `BUILTIN_UNITS` `lb` / `oz` (P-3, 08a test #1) — tests 1–11.
3. Snapshot: `InventorySnapshotSchema` (not `.strict()`), V4 `inventory: z.unknown().optional()`, builder 5 reads with its **own time-free `selectSnapshotPrices`**, `safeParse` + `inventory_key_invalid` log, bounds (A-3, A-4, B-x), 08a #25 (P-1) — tests 23–25, 27, 27b, 28.
4. Bump rule on 08a routes and stock-item PATCH (P-1, A-2′; 08a #9, #28, #31, #35) — test 26.
5. Recipes module `apps/cloud/src/modules/recipes/`: §6.3, §6.4; hooks `afterRecipeLock`, `afterPublishLock` in `apps/cloud/src/server.ts` `CloudTestHooks` (⚠️ v0.2 m-14) — tests 12, 13.
6. §6.5 publish (lock 0, whole-graph check) — tests 14–17.
7. §6.6 (kind 0 first on restore; every B6 check) — tests 18, 18b, 37, 38.
8. §6.1, §6.2 (cost context) — tests 19, 20.
9. B17 guards: C-11 (incl. prepared owner's `stock_unit`), C-14, C-15, P-2 — test 22.
10. Audit + route cases + races — tests 21, 34–36.
11. Owner app: Recipes page, editor, badge, B17 texts — tests 29–32.

11 tasks, 6 routes: inside the size budget. Spec bumps at approval include C-16 (01c lock table).

---

## §12. DoD, checklist, open questions, deferred

### 12.1 Definition of Done
Tests 1–38, 18b and 27b green; hub, engine, 02b suites unchanged; drill 2 acceptance green with the owner's paper numbers; §4.5 rows applied at the fold into `08_Inventory_Costing_Spec`.

### 12.2 Endpoint checklist
| § | Route | Codes |
|---|---|---|
| 6.1 | GET recipes | 200, 400, 401, 403, 404 |
| 6.2 | GET recipes/:id | 200, 400, 401, 403, 404 |
| 6.3 | POST recipes | 201, 400, 401, 403, 409, 422 |
| 6.4 | PUT …/draft | 200, 400, 401, 403, 404, 409, 422 |
| 6.5 | POST …/publish | 200, 400, 401, 403, 404, 409, 422 |
| 6.6 | PATCH recipes/:id | 200, 400, 401, 403, 404, 409, 422 |

### 12.3 Open questions (owner) — renumbered (⚠️ v0.2 m-19; these are **08b's** OQs, not the module OQ-1 of the header, ⚠️ v0.3 n-9)

| # | Question | Default |
|---|---|---|
| OQ-1 | Drill 2 paper numbers (Half paye, tawa piece, anda tikki, 1 kg karahi): when? They become the acceptance test | Before build task 2 |
| OQ-2 | Snapshot shape: cost **inputs** (B15) rather than precomputed costs | Inputs (v0.1 default, review ✓) |
| OQ-3 | B16: every price / unit / yield write bumps (hub refetch). Fine for one pilot branch? | Yes |
| OQ-4 | B5: misc allowance only at the top recipe of a sale line | **Answered (owner 2026-11-23): top only, once** |
| OQ-5 | B11 / §4.3: 3 superseded versions kept; older → `partial` | **Answered (owner 2026-11-23): yes** |
| OQ-6 | As built in 08a: `displayPer`, `reduceFraction`, `selectPriceCandidates` exported (not in 08a §4.2); 08a v1.0.1 records AD-7 (two copies) but not these exports — record at the fold | Accept |
| OQ-7 | ⚠️ v0.3 N-4: a builder output failing `InventorySnapshotSchema` is **sent as built and logged** (the hub copes element-wise) rather than dropped from the body. OK, or drop the key for that branch until fixed? | Send + log |

### 12.4 Deferred until needed
Packet / CK recipes, `visibility_scope`, `ck_only`, a CK hub (D10, R7); `require_recipe_for_menu` as a setting, `off` and `block` (R7, C9); `kg_basis: 'served'`, `is_garnish`, `scale_with_parent`, parents-missing-removal lists (R7); deal cost range and suggested price / MFC (R39 (e)); gallon and other imperial volume units (owner: no gallon); `served`-basis per-measure recipes; restatement / backdated recipes (`SaleCostRestated`); batch-learned yields (`ProductionBatchRecorded`); prep instructions, plating photo, utensil, accompaniments; `derived_from_recipe_id`; coverage by revenue in the cloud (needs 06); per-supplier yields; a cheaper menu-badge read (m-17).
