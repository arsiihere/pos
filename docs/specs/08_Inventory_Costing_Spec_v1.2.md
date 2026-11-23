# 08 — Inventory & Costing — Module Spec v1.2 (APPROVED)

**v1.2 — APPROVED (owner 2026-11-24 00:23 PKT, 08d).** Adds **Part D = 08d** A-item daily sheet (v1.0, at the end of this file) to Parts A and B. Reviews of 08d: `docs/reviews/08d_v0.1_hostile_run1.md`, `08d_v0.2_hostile_run2.md`, `08d_v0.3_targeted_check.md`, `08d_v0.4_final_check.md` (YES). Part D's §4.5 rows applied with it: **Foundation v1.16 → v1.17** (F-1 `inventory` stream type, F-2 D50 note, F-3 §6.2 codes), **01b v1.10.4 → v1.11** (B-1 five permissions, B-2 settings wire), **01c v1.3 → v1.4** (C-1 receiving fields, "Count daily"), **01a v2.9 → v2.10** (A-1 variance settings + release bump), **05a v1.0.5 → v1.0.6** (D-1 screen key `inventory`, listed-only), README (R-1). Part A changes (row P-1) and Part B changes (row R-b) carry "⚠️ Changed by 08d v1.0 (row)". Build: 08d-1 after 08b is built; 08d-2 after 08c (`docs/plans/08d-plan.md`). 08c is added here as a later version.

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
| I12 | **"Menu cost" vs "today's cost" (owner ruling C7).** Everything 08a stores and shows is **menu cost**: the configured price of I7. "Today's cost" is reserved for the hub's moving weighted average from receipts (08d) and is never shown in 08a. Owner-app labels: section **"Menu cost"**, help line "Price you set. Today's cost from deliveries is on the hub's Inventory screen" (⚠️ Changed by 08d v1.0 (P-1): was "… on the hub (coming)"). Neither label is used for the other value anywhere in 08a–08d | Two price sources must never be confused | — |
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
| OQ-2 | Who enters market rates at Lake City until 08d's hub screen? | **Answered: the owner**, from the owner app (I10). ⚠️ Changed by 08d v1.0 (P-1): the owner keeps entering market rates in the owner app after 08d too — the hub screen records receipts, not market rates |
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
           stock_unit: 'piece'|'g'|'ml'; cost_category: string; is_a_item: boolean;
           must_weigh_on_receipt?: boolean; track_piece_count?: boolean }[];   // active only; ⚠️ Changed by 08d v1.0 (R-b, Part D S17 / 01c C-1): two optional fields, emitted by the builder, read by 08d (buildCostInputs ignores them)
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

---

# Part D — 08d A-item daily sheet (v1.0)

**v1.0 — APPROVED (owner 2026-11-24 00:23 PKT, "8d approve!").** Reviews: hostile run 1 (`docs/reviews/08d_v0.1_hostile_run1.md`), run 2 (`08d_v0.2_hostile_run2.md`), targeted check (`08d_v0.3_targeted_check.md`), final check (`08d_v0.4_final_check.md`: 13/13 ✓, "Ready for owner approval: YES", 0 BLOCKER, 0 MAJOR, 6 MINOR, 4 NIT). Owner defaults confirmed with the approval: **OQ-10** the pilot counts only PAYE-COOKED among cooked items; **OQ-11** "Undo own entries" is ticked together with the recording keys (the owner may untick it). The final check's MINORs and NITs are folded here with markers "⚠️ v1.0 (id)": **n-a** test 28 order `(order_seq, seq)`; **n-b** test 9 split (bad item element vs bad price row); **n-c** the dead second `wanted` arm of `0020` dropped (no role holds the new recording keys before 0020; custom roles get the Undo key from the roles editor); **n-d** OQ-11 wording; **n-e** new unreliable reason **`cooked_excluded`**; **n-f** a correction's required set = superseded `required` minus its `excluded`; **nit-a** header version; **nit-b** 08b's own words quoted; **nit-c** day view lists `no_longer_tracked`; **nit-d** S13 line on the day after an exclusion. The part history below (v0.4 … v0.1) is kept as in `docs/specs/08d_Daily_Sheet_Part_v0.4.md`.

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
| Version | **v1.0 — APPROVED** (owner 2026-11-24, in module 08 v1.2). ⚠️ v1.0 (nit-a): v0.4 — DRAFT (2026-11-24, targeted check), v0.3 — DRAFT (run 2 + O-8 – O-11), v0.2, v0.1 — DRAFT |
| Depends on | ⚠️ v0.3 M-9: **Foundation v1.16** (→ v1.17 by F-1, F-2); **00 v1.12.4** (command pipeline, sessions, queries, `ctx.directory`); 01a v2.8 (business day S33, S55, day close); 01b v1.10.3 (permissions, §6.10 settings wire); 01c v1.2 (stock items, `prepared` stock); 01d v1.3.6; **05a v1.0.5** (screens, listed-only; the 05b staff tablet loads the same `/staff/` page, so the `inventory` key works there too); 04 v1.0.8 (`ItemVoided.disposition`, read through 08c); **08a v1.0.1** (`kind`, `is_a_item`, item units, `resolveUnit`, `effectiveMenuPrice`, `pricePerStockUnit`); **08b** (snapshot `inventory` key, `CostInputs`, `explodeStockItem`; row R-b); **08c** (`theoreticalUsage`; row R-c; 08d-2 only) |
| Inherits | **Shared Standards from Foundation v1.16 §6**, unchanged. Carried conventions C1–C9 |
| Changes other specs | Foundation (F-1, F-2, F-3), 01b (B-1, B-2), 01c (C-1), 01a (A-1), 05a (D-1), 08a (P-1), 08b requirement (R-b), 08c requirement (R-c), README (R-1). Versions (applied, ⚠️ v1.0): Foundation v1.17, 01b v1.11, 01c v1.4, 01a v2.10, 05a v1.0.6 (after 08b's 01a v2.9, 01b v1.10.4, 01c v1.3). Full list §4.5 |
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
| S2 | **Tracked items.** The **A-item set** = snapshot inventory items with `is_a_item = true` **and** `kind ∈ ingredient, packet`. ⚠️ v0.3 M-5 / O-9: the **tracked cooked items** = `prepared` stock items **the owner ticks** (`is_a_item = true` on a `prepared` item; owner form label "Count daily") whose published batch recipe, exploded with 08b `explodeStockItem(inputs, id, 1n)`, uses ≥ 1 A-item; a ticked prepared item whose explosion uses none is ignored and listed in the day view as "uses no A-item". Each is counted in **its own stock unit** (PAYE-COOKED in pieces; biryani / pulao in plates, stock unit `piece`). Raw lines (receive, transfer, raw waste, raw count) name an A-item; cooked lines (cooked waste, cooked count) name a tracked cooked item. Else `404 STOCK_ITEM_NOT_FOUND` (unknown / archived) or `422 INVENTORY_ITEM_NOT_TRACKED { stock_item_id, reason: 'not_a_item' \| 'not_cooked_item' \| 'not_packet' }`. ⚠️ v0.4 N-3 (08b v0.4 text): **"the `inventory` key is absent, or `buildCostInputs` returns no items" (⚠️ v1.0 nit-b: 08b's words)** → every 08d command and query `409 INVENTORY_NOT_CONFIGURED`; the screen shows "Inventory not set up". Never a whole-key `InventorySnapshotSchema.safeParse` (that schema is for the builder and tests). An item dropped by 08b's element-wise parse is simply absent: a line naming it answers `404 STOCK_ITEM_NOT_FOUND` for that line, and the day view shows `dropped > 0` as "Some inventory settings could not be read". ⚠️ v0.3 M-5: the **required set of a day** (A-items + tracked cooked items) is **frozen at the day's first `CountRecorded`**; ⚠️ v0.4 N-2: the command computes it when the day has none and writes it **into that event** (`required_set`), and `inventory_day_sets` is derived from that field only, so a rebuild reproduces it; an item ticked later that day is not required that day; `DailySheetClosed` stores the set. ⚠️ v0.4 n-3: an item of the frozen set that is **no longer tracked at close** (unticked, archived, or dropped by the parse) is not required: the sheet lists it under `excluded` with reason `no_longer_tracked` | R39 (b): the owner chooses what is counted; one pot counted once, in its own unit; a recipe publish never adds a nightly count by itself | — |
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
| S13 | **The sheet** (`DailySheetClosed`, immutable), per A-item (cooked counts enter as raw equivalents). The **period** = the business days after the item's previous closed sheet up to this day (normally one; more when a closed day was skipped, then `chain_broken`; ⚠️ v0.3 m-10: **at most 7** business days — a longer gap closes as `baseline`). `opening` = the previous sheet's `closing` (none → **baseline**: `opening`, `actual_usage`, variance null, reason `baseline`); `received`, `transfer_in`, `user_waste` (raw + raw equivalent of cooked waste); `closing` = raw count + raw equivalent of the cooked counts; `actual_usage = opening + received + transfer_in − user_waste − closing`; `sold`, `comp`, `void_waste`, `staff_meal`, `theoretical_usage` (S12); ⚠️ v0.3 m-8: every fraction sum (theoretical, cooked equivalents of counts and of waste) is rounded **once per item** with `divRound`, at close; `variance_qty = actual_usage − theoretical_usage`; `variance_bp = divRound(variance_qty × 10 000, theoretical_usage)` (null when theoretical = 0); `unit_cost_micro` + `unit_cost_source` = `todaysCost` at the **first** close of the day (S20); `variance_value_minor = divRound(variance_qty × unit_cost_micro, 10⁶)` (null without a cost). **Flags**, two fields: `variance_flag` — `over` ⇔ `variance_qty > 0`, `under` ⇔ `< 0`, only when `|variance_bp| > pct_bp` (theoretical 0 with `variance_qty ≠ 0` passes the pct test) **and** `|variance_value_minor| > value_minor`, else `ok`; `null` when actual or the value is null. `unreliable_reasons[]` ⊆ `baseline`, `chain_broken`, `coverage` (`coverage_bp < 9 500`), `estimated` (any count of the item or its cooked items `is_estimated`), `no_cost`, `cooked_partial`, `usage_partial` (⚠️ v0.3 M-8: 08c `status = 'partial'`), `moves_after_count` (S14), `sales_after_count` (⚠️ v0.3 O-11: `sold_after_count > 0`; the item row carries `sold_after_count_qty` and the Close screen says "≈ 1 200 g paye sold after the count — recount after service next time"). `flag` (list view) = `unreliable` if any reason, else `variance_flag`; the detail always shows `variance_flag` beside the reasons | 08-g0 §3.12 formulas, integer form; a real `over` is never hidden; late sales never pass silently | — ⚠️ v1.0 n-e: when a **cooked** item of the day's set is excluded at close (`no_longer_tracked`), every A-item its explosion uses gets reason **`cooked_excluded`** (flag `unreliable`), because that item's raw equivalent is missing from their `closing`. ⚠️ v1.0 nit-d: the day after an exclusion, the item's opening looks back to its last sheet (period > 1 → `chain_broken`; > 7 → `baseline`) |
| S14 | **Day and close rules.** Moves (receive, transfer, waste) need the **open** day and belong to it (`409 BUSINESS_DAY_NOT_OPEN`, C8; ⚠️ v0.3 m-15: the screen says "Start the day first"), except a reversal's `replacement` (S19). Counts are allowed for the open day or a **closed day without a sheet**, provided no later day has a sheet (⚠️ v0.3 m-6: else `later_sheet`); ⚠️ v0.3 M-3: and for the day holding the **latest** sheet (no later day has a sheet) by a holder of `close-daily-sheet` — the day is then **out of date** (S20). `CloseDailySheet` is allowed only for a **closed** business day (after `BusinessDayClosed`) that has **no sheet**, or, with `supersedes`, for any day holding the **latest** sheet (⚠️ v0.4 n-4), provided **no later day has a sheet**; else `409 INVENTORY_DAY_NOT_ALLOWED { business_day_id, reason: 'not_closed' \| 'has_sheet' \| 'later_sheet' \| 'unknown' }`. Close needs a **non-null** count for every item of the day's **required set** that is still tracked (S2, ⚠️ v0.4 n-3; `409 INVENTORY_COUNT_MISSING { stock_item_ids }`). A move of an item on that day ordered **after** its count (by `order_seq`, ⚠️ v0.4 N-1; a replacement keeps its original's place, so a fixed typo is never "after count") is listed on the Close screen as "after count — recount?"; the close needs a recount or `confirm_moves_after_count: true`, and the confirmed items carry reason `moves_after_count`. Day close is **not** blocked by an unclosed sheet (fallback) | Counting happens at night; sheets closable next morning; no sale or move falls between two sheets; a wrong count is fixable | — |
| S15 | **Permissions** (01b row B-1): `receive-stock` (`ReceiveGoods`, `ReceiveTransfer`), `record-waste` (`RecordWaste`), `count-inventory` (`RecordCount`), `close-daily-sheet` (`CloseDailySheet`, corrections, recount / reversal on a sheeted day, the report), ⚠️ v0.3 M-1 / O-8 **`reverse-inventory-entry`** (`ReverseInventoryEntry`; the handler then narrows it, S19). Group `menu_stock`, scope `branch`. All five are **`ALLOWED_ONLY_PERMISSIONS`** (no approval flow exists for them; the roles API answers `422` on `requires_approval`, as 04 B-2). Defaults: Owner + Manager all five, reaching the running pilot tenant through an idempotent cloud **backfill migration by `default_key`** (§5.1, 0015 pattern). ⚠️ v0.4 n-1: **`reverse-inventory-entry` goes with the recording keys**: the roles editor shows it as "Undo own entries" under `receive-stock` / `record-waste` / `count-inventory` and ticks it together with the first of them (the owner may untick it); the `0020` backfill also grants it to every active role that already holds any of the three. No default role other than Owner / Manager records 08d entries, so the owner makes a "Store keeper" role with the four keys (OQ-4, OQ-11). `close-daily-sheet` is **listed-only** (05a row D-1): a manager's undo of someone else's entry, a recount after the sheet and a close need a listed device | Fill and close by different people, as on paper; the recorder fixes his own typo (O-8) | 01b §3.3, §4.2 (B-1); 05a §3.3 (D-1) ⚠️ v1.0 n-c: the `0020` backfill grants the Undo key to Owner + Manager only (no role holds the recording keys before 0020); custom roles get it from the roles editor, ticked with the first recording key |
| S16 | **Settings** (R18, 01a row A-1, 01b row B-2): `inventory_variance_pct_bp` (default 300, 1 … 10 000) and `inventory_variance_value_minor` (default 50 000, 0 … 100 000 000) in `branch_engine_settings`, delivered as optional snapshot `engine_settings` keys with hub defaults. The engine never reads them; `engine_settings` is the branch-settings delivery channel (03b A-1 pattern). The close freezes the values used | 08-g0 §3.12 "configurable" | 01a §5 / snapshot `engine_settings`; 01b §6.10 wire |
| S17 | **Item fields from 08a** (01c row C-1): `must_weigh_on_receipt` (`stock_unit = 'g'` only), `track_piece_count` (`stock_unit ∈ g, ml`, not `packet`). Delivered by **08d's own row on 08b's snapshot `inventory.items[]`** (two optional fields; schema + builder; builder statement count unchanged, R-b); `inventory.items[]` holds active items only (08b §4.3). ⚠️ v0.3 M-6: the cloud migration ends with the **release bump** (§5.1) | Their first reader is this screen | 08a §4.3 row "08d" |
| S18 | **Labels** (08a I12, C7). The screen shows per A-item: **"Today's cost"** (`todaysCost`; when its source is `'menu'` — always for packets — the value is labelled **"Menu cost"**, never "today's cost"), today's received / transfer-in / waste, the count. Every frozen cost carries `unit_cost_source`; the report labels each value by it ("Rs 620 at today's cost" / "at menu cost") | 08a I12 | 08a I12 help line (row P-1) |
| S19 | **Reversal of moves** (⚠️ v0.3 M-1, M-2, O-8). `ReverseInventoryEntry { event_id, note, replacement? }` → `InventoryEntryReversed { reversed_event_id, reversed_event_type, business_day_id, business_date, note }` on the reversed event's stream, plus, when `replacement` is sent, **one new event of the reversed event's type** (same shape as its command's lines / fields, S2–S4 checks, guard) carrying the **reversed event's** `business_day_id` / `business_date`. Allowed for `GoodsReceived`, `StockTransferReceived`, `WasteRecorded` only (counts are recounted); once (`409 INVENTORY_ENTRY_REVERSED`); note 1 … 200 (`400`). **Who** (O-8): the pipeline checks `reverse-inventory-entry`; the handler then allows it when `actor_id` = the reversed event's `actor_id` (**own entry**), **or** the actor holds `close-daily-sheet` through `ctx.directory.resolve` (05a session rules: listed device), else `403 PERMISSION_DENIED { reason: 'not_own_entry' }`. **When:** the event's day has no sheet; or (M-3) it holds the latest sheet and the actor holds `close-daily-sheet` (the day becomes out of date, S20); else `409 INVENTORY_DAY_NOT_ALLOWED { reason: 'has_sheet' \| 'later_sheet' }`. Projections treat the reversed event's lines as absent; ⚠️ v0.4 N-1: the replacement's lines take the reversed event's **`order_seq`** (read from its `inventory_moves` rows, so a rebuild derives the same value from the events); `inventory_item_cost` of each **affected item (reversed ∪ replacement items)** is **recomputed** by `foldItemCost` over that item's steps in `(order_seq, seq)` order (S7, §6.5) — a replacement is never applied as a tail `stepItemCost`. Costs already frozen into later `WasteRecorded` rows are **not** rewritten (§7). **Large-quantity guard** (⚠️ v0.3 m-5): a receive / transfer / raw-waste / raw-count line whose `qty_stock_units` exceeds 5 × the item's `max_seen` (largest receipt line **or** count so far; cooked waste and cooked counts against the cooked item's largest count) needs `confirm_large: true`, else `422 INVENTORY_LARGE_QUANTITY { stock_item_id, qty_stock_units, max_seen }`; an item with nothing seen yet has no guard; `max_seen` comes from the fold, so a reversed 18 500 kg no longer counts | A typo of kg for g must not ruin the MWA or two sheets; the recorder fixes it at once | — |
| S20 | ⚠️ v0.3 M-3 / O-10: **Sheet corrections.** A day holding the latest sheet becomes **out of date** when a recount or a reversal lands on it after its sheet (`daily_sheets.out_of_date = 1`); the day view and the report show "Sheet out of date — close again". The correction is `CloseDailySheet { business_day_id, supersedes: <current sheet>, note }` (note required; `supersedes` must be the day's current sheet, else `409 INVENTORY_SHEET_CLOSED`); it recomputes quantities from the current counts and moves and **re-uses the superseded sheet's `unit_cost_micro` / `unit_cost_source` per item**; ⚠️ v0.4 n-4: its **required set is the superseded sheet's `required` minus its `excluded`** (⚠️ v1.0 n-f: = the items on the superseded sheet, so every item has a superseded cost; items still untracked go to `excluded` again; `cost_from: 'now'` is removed); settings and period are the superseded sheet's. A correction of a sheet that is not out of date is allowed too (late 08c lines, §7) | A wrong count found after closing is fixable; a correction never re-prices the day | — |

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
| R-b | 08b | (1) Exposes `explodeStockItem` exactly as §4.1. (2) ⚠️ v0.4 N-3: `buildCostInputs` accepts the snapshot key with 08d's two optional item fields present (unknown fields ignored); 08b's words: "`InventorySnapshotSchema` is exported for tests" (⚠️ v1.0 nit-b) (3) 08b's §4.3 row "08d" reads: "08c owns `theoreticalUsage` (full explosion, no `stopAt`); 08d counts the prepared items the owner ticks as themselves and converts them with `explodeStockItem`; 08d adds two optional fields to `inventory.items[]`". **08d cannot be approved until 08b's approved text carries this row** (⚠️ v0.4 N-4: 08b v0.4 §4.3 carries it verbatim, and its 08c row carries R-c's signature verbatim) |
| R-c | 08c | Exposes `theoreticalUsage(db, { business_day_id, count_seq_by_item })` exactly as §4.1, with the S12 rules (sold, comp; `wastage` → `void_waste`; `staff_meal` → `staff_meal`; `moved` excluded; `other` as `wastage`; voids without disposition excluded; attribution by placing `business_day_id`; carried-over orders stay with their placing day; per-item `status`; `sold_after_count` by line `seq`; `coverage_bp` and `revenue_minor` by revenue in the same call) and a fixed statement count per call |

### 4.4 Story → part

08d-1: S2–S11, S14 (moves and counts), S15–S19, screen, day view. 08d-2 (after 08c): S12, S13, S14 (close), S20, report.

### 4.5 Changes to other specs (R26)

**Applied with module 08 v1.2 (owner 2026-11-24):** Foundation **v1.17** (F-1 – F-3), 01b **v1.11** (B-1, B-2), 01c **v1.4** (C-1), 01a **v2.10** (A-1), 05a **v1.0.6** (D-1), Parts A and B of this file (P-1, R-b), README (R-1), each with a changelog and "⚠️ Changed by 08d v1.0 (row X)" markers. ⚠️ v0.3 M-9: bases are main's — Foundation v1.16, 00 v1.12.4, 01d v1.3.6, 05a v1.0.5, 08a v1.0.1.

| Row | Target, section | Change | Why |
|---|---|---|---|
| F-1 | **Foundation v1.16 → v1.17** §4.1 envelope + `packages/events/src/envelope.ts` (⚠️ v0.4 n-7) | `stream_type` gains **`'inventory'`** (stream ids `grn:`, `xfer:`, `waste:`, `sheet:<business_day_id>`); Zod enum only, no DB CHECK; not replayed by the engine (F §5.8's replay lists unchanged) | S1, C3 |
| F-2 | Foundation v1.17 §3.1 D50 | Note: "one stock projection" is the engine's **pre-cooked** stock; purchased inventory (`ingredient`, `packet`) is a separate hub projection on the `inventory` stream the engine never reads | S1, 08a I9 |
| F-3 | Foundation §6.2 status map | 08d §9 codes appended (no bump on its own, R34) | §9 |
| B-1 | **01b** §3.3, §4.2 catalogue, `packages/domain/src/permissions.ts` ⚠️ v0.4 n-1: the roles editor shows `reverse-inventory-entry` as "Undo own entries" directly under the three recording keys in `menu_stock` and ticks it together with the first of them (the owner may untick it); ⚠️ v1.0 n-c: the `0020` backfill grants it to Owner + Manager by `default_key` only (no role holds the recording keys before 0020; custom roles get it from the editor) | `receive-stock`, `record-waste`, `count-inventory`, `close-daily-sheet`, **`reverse-inventory-entry`**: group `menu_stock`, scope `branch`; all five in `ALLOWED_ONLY_PERMISSIONS` (roles API `422` on `requires_approval`); defaults Owner + Manager in the seed (Manager = all but `MANAGER_EXCLUDED`, so the seed grants them already) **and** the cloud backfill migration (§5.1) by `default_key`; client labels `perm.*` | S15 |
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
  -- ⚠️ v1.0 n-c: no second arm. The three recording keys are new in this release, so no role holds them
  -- before 0020, and a WITH's sub-statements share one snapshot (an arm cannot see `granted`'s rows).
  -- Custom roles get "Undo own entries" from the roles editor, ticked with the first recording key (S15).
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
The build task re-reads `0015_billing_defaults_backfill.sql` (⚠️ v0.4 n-5: `role_permissions`, conflict target, `RETURNING` shape — as written above; ⚠️ v1.0 n-c: one `wanted` arm only — Owner + Manager by `default_key`) and the live `branch_engine_settings` first (01b D-5) and copies them exactly.

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
            unreliable_reasons: ("baseline" | "chain_broken" | "coverage" | "estimated" | "no_cost" | "cooked_excluded" /* ⚠️ v1.0 n-e */
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

Response: `{ business_day_id, business_date, day_state: 'open' | 'closed', sheet: { event_id, flag_summary, out_of_date } | null, required_frozen: boolean, no_longer_tracked: string[] /* ⚠️ v1.0 nit-c: frozen-set items no longer tracked; same read */, a_items: [{ stock_item_id, name, code, stock_unit, units: [...resolvable], must_weigh_on_receipt, track_piece_count, todays_cost: TodaysCostWire | null, received, received_pieces, transfer_in, user_waste_raw, count: { qty_stock_units, is_estimated, counted_by_name, counted_at } | null, moves_after_count: boolean }], cooked_items: [{ stock_item_id, name, stock_unit, user_waste, count: {…} | null, moves_after_count }], ignored_ticked: [{ stock_item_id, name, reason: 'uses_no_a_item' | 'no_recipe' }] /* ⚠️ v0.4 nit-2: 'no_recipe' = `explodeStockItem` partial with empty usage */, dropped: number /* ⚠️ v0.4 N-3: CostInputs.dropped; > 0 → "Some inventory settings could not be read" */, my_entries: [{ event_id, type, summary, reversible: boolean }] }`. Default day = open day, else latest closed day without sheet. **Statements: 6 fixed** (day row, moves of the day, counts of the day, day set, item costs for the listed items, sheet row); items, units, menu cost and tracked cooked items from the in-memory snapshot (`branchConfig()`, 08b `CostInputs`); `reversible` from the S19 rules without a read.

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
| 9 | `ReceiveGoods` each error: not configured (no key; `buildCostInputs` returns no items — ⚠️ v0.4 N-3); ⚠️ v1.0 n-b: **one malformed `items[]` element → that item's line `404`, the other items receive, day view `dropped: 1`**; **one malformed `prices[]` element → every item receives, that item's menu cost from its other rows or `null`, `dropped: 1`**; not found, not tracked, not convertible, weigh required, piece count missing / not allowed, large quantity (and accepted with `confirm_large`), no open day, duplicate item line; retransmit → one event |
| 10 | `ReceiveTransfer`: packet menu cost frozen with source `menu`, no MWA; packet without price → null; ingredient → `not_packet`; each error; retransmit |
| 11 | `RecordWaste`: raw freezes cost + source; cooked freezes none; cooked guard vs the cooked item's largest count; cooked on an A-item → `not_cooked_item`; raw on PAYE-COOKED → `not_a_item`; `other` needs note; statements 2 + 1 + 3; each error; retransmit |
| 12 | `RecordCount`: null vs 0; recount supersedes; raw A-item and cooked item counts (pieces; plates); closing raw count re-anchors S7; day set frozen at the first count; count guard; each error (`has_sheet` for a store keeper, `later_sheet`, `unknown` day); retransmit |
| 13 | `RecordCount` for last night's closed day after this morning's open → accepted; two days with **one `business_date`** → two separate count sets; manager recount on the latest sheeted day → `out_of_date` |
| 14 | `ReverseInventoryEntry`: own receipt reversed with replacement on yesterday after today's open → yesterday's `received` = 18 500 g, today unaffected, `avg` / `on_hand` / `max_seen` equal a history without the typo (M-2, M-4; ⚠️ v0.4 N-1: holds by construction, the replacement takes the original's `order_seq`), and yesterday's close shows **no** "after count" row; ⚠️ v0.4 n-2: a store keeper reversing someone else's entry on a sheeted day → `403 not_own_entry` (narrowing before the day rule); someone else's entry by a store keeper → `403 not_own_entry`, by a manager → accepted; waste reversed; count / sheet ids → `404`; day with sheet → `409 has_sheet` (store keeper) / out of date (manager, latest sheet); second time → `409 INVENTORY_ENTRY_REVERSED`; without `reverse-inventory-entry` → `403` before any read; replacement of the wrong shape → `400`; retransmit; statement count |
| 15 | Day view: 6 statements; default day rules; `todays_cost` source labels; `moves_after_count`; counted by; `piece_count`; `ignored_ticked`; `my_entries.reversible`; no engine read |
| 16 | `CloseDailySheet` (08c stub): day open → `not_closed`; yesterday after today's open → closes; D−2 after D−1 sheet → `later_sheet`; missing raw or cooked count → `409`; item ticked after the first count not required; moves after count → `409`, confirm → reason; `sales_after_count` with quantity from the stub's `sold_after_count`; `usage_partial`; baseline; chain broken; settings and required set frozen; `staff_meal` column; each error; retransmit; ⚠️ v1.0 n-e: an unticked A-item closes without its count and is listed in `excluded` (`no_longer_tracked`); an unticked PAYE-COOKED → paye carries `cooked_excluded`, flag `unreliable`; n-f: a correction after re-ticking an excluded item does not require it |
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
| 28 | ⚠️ v0.3 m-16: reversal of a receipt vs a new receipt of the same item: serialised; final `avg` = `foldItemCost` of the committed history in `(order_seq, seq)` order (⚠️ v1.0 n-a) |

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
| OQ-11 | ⚠️ v0.4 n-1, new: who receives the dawn paye delivery? Whoever records entries should be able to undo **their own** — confirm the rule "a role with `receive-stock`, `record-waste` or `count-inventory` also gets `reverse-inventory-entry` (Undo own entries), ticked together; the owner may untick it" (⚠️ v1.0 n-d) | **Answered with the approval (owner 2026-11-24): that rule.** The owner creates a "Store keeper" role with the four keys; if Cook / Cashier receives deliveries, their role gets `receive-stock` and the Undo key comes with it |

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
