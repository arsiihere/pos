# 08b — Inventory & Costing: recipes + cost engine — Module Spec part v0.1 (DRAFT)

**v0.1 — DRAFT (2026-11-23), for hostile review in a fresh session.** This is the **08b part of module 08**. It is written as its own file only so that 08b and 08d can be drafted in parallel; **at approval it is folded into `08_Inventory_Costing_Spec` as that file's next version (owner OQ-1: one file for 08a–08d)**, and its §4.5 rows are applied then. Written from `docs/stories/08-g0.md` §3.7, §3.8, §3.11, D7–D10, README R39 (owner rulings C1–C12), 08a v1.0 §4.3 (row "08b"), and the 08a code as built on `module-08a` (2026-11-23 evening).

---

## §1. Header

| Field | Value |
|---|---|
| Module | 08b Recipes + cost engine: recipes as cloud config (draft → published versions → archive) for sellable menu items, plain modifier options and prepared / packet stock items; a pure cost engine and a usage explosion in `@pos/domain`; plate cost and recipe coverage in the owner app; the `require_recipe_for_menu` setting (warn); the snapshot's `inventory` key that 08a deferred, with the bump rule that replaces 08a I11 |
| Version | **v0.1 — DRAFT** (2026-11-23) |
| Depends on | Foundation v1.15; 00 v1.12.3; 01a v2.8 (S8, S26, S28, common write script); 01b v1.10.3 (B8); 01c v1.2 (menu items, modifier options, deals, stock items, lock order); **08a v1.0** (`stock_items.kind`, item units, prices, yields, `resolveUnit`, `effectiveMenuPrice`, `activeYield`, I12 labels) |
| Inherits | Shared Standards of Foundation v1.15 §6; carried conventions C1–C9; 08a's conventions (integers only, `BigInt(string)`, fractions, round once) |
| Changes other specs | 08a part of this file (I11 ends, §6.0 bump column, 01c C-5 / R2 archive rule), 01a → next (A-2 ends; builder and sync statement bounds; snapshot `inventory` key; audit entities / action), 01c → next (stock-item archive in use by a recipe line), foundation §6.2 (one error code). Full list §4.5 |
| Tier | T2 |
| Milestone | A (pilot), R39 slice 2 of 4 |
| Inputs | 08-g0 §2, §3.5, §3.7–§3.9, §3.11, D6–D10; R18, R28, R29, R39; 01a S8, S26, S28; 01c V2, V6–V11, V18, §6 lock order; 08a v1.0 §3.1, §4.2, §4.3; code `module-08a` (`packages/domain/src/inventory/*`, `apps/cloud/src/modules/inventory/*`, `0018_inventory_config.sql`), `apps/cloud/src/modules/config-sync/builder.ts`, `packages/events/src/config.ts`, `apps/cloud/src/lib/config-version.ts` |

### Stories covered

| Source | Item | How |
|---|---|---|
| 08-g0 §2 "Recipes: per_unit / per_kg / per_batch, variants, add-ons (incl. negative deltas), produced items, packet items as ingredients" | recipe owners, bases, lines | B1–B8 |
| §2 "Cost engine + plate cost" | pure engine, owner-app plate cost | B9–B12, §6.1, §6.2 |
| §2 "`require_recipe_for_menu` = warn" | setting + badge + coverage | B14, §6.7 |
| §3.7 validation | convertibility, removal add-on, cycles ≤ 3, kg_basis, EP-in-batch warning | B6, B7, §3.3 |
| §3.8 formulas | line / recipe / produced / per_kg cost, status | B9, B10 |
| D10 secret BOM | `ck_only` recipes never reach a branch snapshot | B13 |
| 08a §4.3 row 08b | snapshot `inventory` key, bump rule, `visibility_scope`, `partial` on missing price / yield | B15, B16 |
| §2 "deal cost range + suggested price" | — | **POST** (R39 (e)); §12.4 |

### In scope
- Cloud: `recipes`, `recipe_versions`, `recipe_lines`, `tenant_inventory_settings`; seven routes (§6); migration `0019_recipes.sql` (number = next free at build).
- `@pos/domain/src/inventory/costing.ts`: cost index, plate cost, usage explosion (pure).
- Snapshot schema 4 gains the optional `inventory` key (S28 c); builder +6 statements.
- Owner app: Recipes page (coverage list), recipe editor, plate cost with "Menu cost" labels, "No recipe" badge on menu items when the setting is `warn`.

### Out of scope
- Any hub code that **uses** the `inventory` key (08c: sale cost; 08d: daily sheet). The hub only receives and stores it (it parses with the shared schema; no projection).
- Sale-time cost, `OrderCosted`, comps (08c). MWA, receiving, counts (08d).
- Deal cost range, suggested price / MFC, restatement, quotes, recipe yield tracking from batches, prep instructions / plating photos (§12.4).
- A CK hub. The pilot has none: `ck_only` recipes are kept in the cloud only and reach no hub.

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Config is cloud-canonical, delivered as a per-branch snapshot; the hub keeps its last good body; within schema 4 the cloud may add **optional** keys, which an older hub drops (schema objects are not `.strict()`) | 01a S28 (c); `packages/events/src/config.ts` header comment |
| Snapshot hash over the raw JSON; builder statement bound today **≤ 23** (`builder.int.test.ts`), config-only `200` = `V21_CONFIG_ONLY_200 + 2`, with directory `V21_WITH_DIRECTORY_200 + 3`, gzip e2e `≤ 35` | 01a S28, S48; tests named |
| Every config write: one transaction; tenant-wide `403` from `assertTenantWide` first (after the key on a creating POST); `bumpEveryBranch` = 2 statements; branch-scope `bumpConfigVersion` = 1 statement | 01a S8; `lib/config-version.ts` |
| 08a: stock items with `kind`; item units; price list rows; yields; `resolveUnit`, `effectiveMenuPrice`, `activeYield`, `pricePerStockUnit`, `displayPer` (as built), I12 labels | 08a v1.0 |
| A variant is a full `menu_items` row; plain options carry a price, linked options become `option_child` lines with their own `item_id`; deal parts → choices → `item_id` | 01c V2, V6, V10 |
| `menu_items.sale_unit ∈ piece, g, ml`; weighed items are g / ml | 01a, 01c V18 |

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Reason | Overrides / changes |
|---|---|---|---|
| B1 | **Recipes are cloud config rows**, not hub events (C7 (a): config is cloud-canonical). `recipes` (one per owner, ever) → `recipe_versions` (`draft` / `published` / `superseded`) → `recipe_lines`. Every write audited in `config_audit`. 08-g0's `RecipeDraftSaved` / `RecipeVersionPublished` / `RecipeArchived` events become the routes of §6 | Owner edits in the owner app; branches receive published versions in the snapshot | 08-g0 §3.7 events → config rows |
| B2 | **Owners** (`owner_type`, `owner_id`): `menu_item` (any sellable row: plain item or variant — no D11 default variant; R39 (d)); `modifier_option` (**plain options only**: a linked option is costed through its linked item's recipe as the `option_child` line it creates, `422 { reason: 'linked_option' }`); `stock_item` of kind `prepared` (a produced item: PAYE-COOKED, QEEMA-COOKED) or `packet` (CK recipe, B13). An `ingredient` cannot own a recipe (`422 wrong_kind`). **Deals own no recipe**: a deal line's cost is the sum of its part lines (`deal_part` lines carry the chosen `item_id`) | 08-g0 §3.7 owner types mapped to the repo (analysis gap row "recipe owner") | 08-g0 `variant` / `addon_option` / `produced_item` |
| B3 | **Basis follows the owner** (no free choice): `menu_item` with `sale_unit = 'piece'` → `per_unit`; with `sale_unit ∈ g, ml` → `per_kg` (base quantity in the sale unit, default 1 000, i.e. per kg / per litre); `modifier_option` → `per_unit` (per 1 option quantity); `stock_item` → `per_batch` (`batch_yield_qty` in the stock item's `stock_unit`, integer 1 … 1 000 000 000, required to publish). `per_kg` carries `kg_basis ∈ raw_input \| served` (D6). A "1 kg karahi" sold as a piece is `per_unit` with a 1 000 g raw-chicken AP line; a karahi sold by weight is `per_kg` | One rule per owner kind; a sale line's quantity always matches its recipe's basis (08c) | 08-g0 §3.7 `basis` field → derived; `portion_qty` dropped (informational only) |
| B4 | **Lines.** `stock_item_id` (any kind; `ingredient`, `packet`, `prepared`); quantity entered as a decimal in a unit the item resolves (08a I5, `resolveUnit`), stored as the entered fraction **and** the frozen stock-unit quantity (`stock_qty_num / stock_qty_den`, `stock_unit` at save, as 08a I6 freezes a price's conversion); `qty_basis ∈ AP \| EP`, default derived (D7: `per_batch` → AP, `per_unit` / `per_kg` → EP), overridable per line; `is_garnish`. At most 60 lines; a stock item at most once per version. **Negative quantities only in `modifier_option` recipes** (removals, "no onion") | D7 without double yield; units validated at save (08-g0 §3.1 "convertibility at recipe save, never at sale time") | — |
| B5 | **Misc allowance** `misc_allowance_bp` 0 … 5 000 (0 – 50 %), default 500 (5 %, 08-g0 §3.7); applied to **cost only, never to usage** | 08-g0 §3.7 | `misc_allowance_pct` → basis points (C4) |
| B6 | **Validation at publish** (draft saves check shape, references and units only): owner exists; basis matches B3; `per_batch` has `batch_yield_qty`; `per_kg` `raw_input` has an AP line whose stock quantity is within ±20 % of `base_qty` on an ingredient, `served` has a `prepared`-item line (08-g0 §3.7; refusals, §3.3); every line's stock item active and its frozen `stock_unit` still the item's `stock_unit` (else `422 { reason: 'unit_changed' }`, re-save the draft); negative lines only on options; **cycles**: the graph "recipe owner → prepared / packet stock items of its lines → their published recipes" has no cycle and depth ≤ 3 below a menu item (`422 { reason: 'cycle' \| 'too_deep' }`). Warnings (non-blocking, returned and shown): an EP line inside `per_batch` (D7); an EP ingredient line with no active yield; a line with no menu cost (cost will be `partial`) | 08-g0 §3.7 | — |
| B7 | **Removal options against many parents.** A modifier group attaches to categories, variant groups and items (01c V7), so "the item exists in the parent's recipe" (08-g0 §3.7) has many parents. Rule: publish never refuses for it; the editor **warns** with the attached parents whose published recipe lacks the stock item; and the engine **caps** a negative option line at the parent's own quantity of that stock item for that sale line (min(removed, present); never below 0). "No onion" on a dish without onion costs and uses nothing | Many parents make a publish-time refusal impossible to keep true as recipes change | 08-g0 §3.7 "removal add-on valid only if…" (refusal → warning + cap) |
| B8 | **Versions are immutable once published.** One draft and one published version per recipe at most. Saving edits the draft (whole replace, versioned with `expected_version`, 01c V13); publishing turns the draft into the published version and the old published into `superseded` (`published_at` = effective time, no backdating; restatement POST). A new draft starts from the published version (`PUT … /draft` with no draft yet copies the body sent; the editor sends the published content) | 08-g0 §3.7 "immutable once published", "backdating only via restatement" | — |
| B9 | **Cost engine** (`@pos/domain/src/inventory/costing.ts`, pure, BigInt fractions, **round once**). For one branch at time `now`: `cost_per_stock_unit(item)` = (a) `prepared` / `packet` item **with** a published visible batch recipe: that recipe's cost ÷ `batch_yield_qty` — but **`packet` items cost by their menu price at a branch** (08-g0 §3.5 step 4; the CK recipe is `ck_only` and never on a hub, B13); (b) otherwise `pricePerStockUnit(effectiveMenuPrice(…))` (08a I7); (c) none → unknown. `line_cost = stock_qty × cost_per_stock_unit ÷ (qty_basis = EP and kind = ingredient ? yield_bp / 10 000 : 1)`; an EP ingredient line with no active yield → unknown (**never assume yield 1**, D9). `recipe_cost = Σ line_cost × (10 000 + misc_bp) / 10 000`. A `per_kg` recipe's cost is for `base_qty`; a sale of `q` g costs `recipe_cost × q / base_qty`. **Status:** `costed` when every line is known; `partial` when at least one line is unknown (the value shown is the known part, labelled partial; never 0 for a missing line); `no_recipe` when the owner has no published version. Rounded to minor units half up **only** at the edge (wire, snapshot in 08c) | 08-g0 §3.8, D9; 08a I6 fractions | 08-g0 `NUMERIC(14,4)` → fractions |
| B10 | **Plate cost of a sale-line shape** (owner app now; 08c at sale): item recipe cost (B9, scaled for `per_kg`) + Σ chosen plain options' recipe costs × option quantity (an option with `scale_with_parent = true` on a `per_kg` parent scales by `q / base_qty`); linked options and deal parts are their own lines with their own item recipes; a deal line's cost = Σ its part lines. Status = worst of the parts (`no_recipe` > `partial` > `costed`; a plain option without a recipe adds 0 and makes the line `partial`, 08-g0 §3.11 "add-on without recipe never blocks (cost 0, partial)") | 08-g0 §3.8, §3.9, §3.11 | — |
| B11 | **Usage explosion** (`explodeUsage`, pure): a sale-line shape × quantity → `Map<stock_item_id, fraction of stock units>` **as purchased**: EP ingredient lines are divided by the yield (AP = EP ÷ yield; unknown yield → that item is reported in `unknown[]`, not guessed); `prepared` lines explode through their batch recipe (÷ `batch_yield_qty`) unless the caller passes them in `stopAt` (08d stops at PAYE-COOKED when it is counted cooked); `packet` lines never explode at a branch; negative option lines capped per B7; **misc allowance never applied** (B5); depth ≤ 3 | 08-g0 §3.9 "ingredient lines are not snapshotted; usage is exploded later", §3.12 theoretical usage | — |
| B12 | **Owner-app plate cost uses the branch the owner picks** (08a `branch_id` query) and `now`; labels per 08a I12: **"Menu cost"** / **"Plate cost (menu cost)"**, never "today's cost" | Two price sources must never be confused | — |
| B13 | **`visibility_scope ∈ all \| ck_only`** on the recipe (not the version). `packet` owner ⇒ `ck_only` (forced; `422` otherwise). `ck_only` recipes are excluded from every branch snapshot (D10) and their writes bump nothing (B16). The owner app shows them to the owner (tenant-wide reads). **Pilot: no CK hub** — packet recipes are optional documentation of the BOM in the cloud; branches cost packets by menu price | D10 (secret BOM never in branch SQLite) | 08-g0 D10 "CK-only stream" → not needed (analysis: config never replicates hub ↔ hub) |
| B14 | **`require_recipe_for_menu ∈ off \| warn`** (tenant setting, row `tenant_inventory_settings`, default **`warn`**, R18). `warn` = a "No recipe" badge on every active sellable item without a published recipe (menu page, Recipes page) and the coverage figure on the Recipes page. `off` hides both. **`block` is not offered in 08b**: its rule (what exactly is refused, and when) is not specified; the owner rules it with his father (C9) and it is added with that rule (§12.4). Coverage in the cloud is **by count** of active sellable items (`items_with_published_recipe / items_total`); coverage **by revenue** needs sales and is 08c / 08d's (hub) | C9; the cloud has no sales (06 sync not built) | 08-g0 §3.11 `off \| warn \| block` → `off \| warn` until block's rule exists |
| B15 | **Snapshot `inventory` key** (optional, schema 4 stays 4, S28 (c); 08a §4.3). Built per branch: `items[]` (every active stock item: `stock_item_id, kind, name, code, stock_unit, cost_category, is_a_item`), `units[]` (current item units, the I5 step-2 set), `prices[]` (the 08a I7 candidates for this branch at build time: per item the latest `manual` and every unexpired `market_rate` with `branch_id` null or this branch, with `valid_until_at` so a hub drops expired ones itself), `yields[]` (active per ingredient), `recipes[]` (published versions of non-archived, `visibility_scope = 'all'` recipes, with their lines' frozen stock quantities and `qty_basis`). **No cost values** are in the snapshot: the hub computes with B9 / B11 from these inputs at use (08c). Builder **+6 statements** | Hub needs the inputs, not the owner app's results; prices expire on the hub's clock | 01a snapshot (row A-3) |
| B16 | **Bump rule (replaces 08a I11).** A write bumps exactly the branches whose `inventory` key (or other snapshot content) it changes: stock-item POST / PATCH of any field in `items[]` → every branch; item unit POST → every branch; price POST → every branch if `branch_id` null, else that branch (1 statement); yield POST → every branch; recipe publish / archive / restore / visibility change of an `all` recipe → every branch. **No bump:** draft saves, `ck_only` recipe writes, recipe create (draft only), settings. 01a A-2's exception (08a) ends | The key now carries this data; a hub must download it | 08a I11, §6.0, A-2 (rows P-1, A-2′) |
| B17 | **In use.** A stock item that is a line of a **published** or **draft** version cannot be archived (`409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }`) and its `stock_unit` cannot change while a published line freezes the old unit — both `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }`; the owner edits those recipes first. A menu item, option or stock item that **owns** a recipe can be archived; the recipe stays (costs for old orders, 08c) and is listed as "owner archived" | Prevents silent `partial` costs and frozen-unit drift | 01c §6.8 R2 (row C-11) |

### 3.2 Owner kinds

| Owner | Basis | `batch_yield_qty` | Negative lines | `visibility_scope` | `scale_with_parent` |
|---|---|---|---|---|---|
| `menu_item`, sale unit piece | `per_unit` | — | no | `all` (`ck_only` allowed: a CK-only menu item has no branch anyway) | — |
| `menu_item`, sale unit g / ml | `per_kg` (`base_qty`, `kg_basis`) | — | no | same | — |
| `modifier_option` (plain) | `per_unit` | — | **yes** | `all` | yes (default false) |
| `stock_item` `prepared` | `per_batch` | required | no | `all` / `ck_only` | — |
| `stock_item` `packet` | `per_batch` | required | no | **`ck_only` forced** | — |

### 3.3 Validation rules

| Rule | When | Error |
|---|---|---|
| `owner_type` / `owner_id` exist in the tenant | create | `422 { field: 'owner_id', reason: 'not_found' }` |
| Linked option / ingredient owner | create | `422 { field: 'owner_id', reason: 'linked_option' \| 'wrong_kind' }` |
| One recipe per owner (archived included) | create | `409 CONFIG_NAME_TAKEN { entity: 'recipe_owner' }` |
| Packet owner with `visibility_scope: 'all'` | create, PATCH | `422 { field: 'visibility_scope', reason: 'packet_ck_only' }` |
| Lines ≤ 60, each stock item once, qty a decimal string `^-?\d{1,9}(\.\d{1,4})?$`, ≠ 0; `misc_allowance_bp` 0 … 5 000; `base_qty` 1 … 1 000 000; `batch_yield_qty` 1 … 1 000 000 000; fields that do not apply to the basis absent | draft save | `400` |
| Negative qty on a non-option recipe | draft save | `400` |
| Line stock item unknown / archived | draft save | `422 { field: 'lines.N.stock_item_id', reason: 'not_found' \| 'archived' }` |
| Line unit not resolvable for its item (08a I5) | draft save | `422 { field: 'lines.N.unit_name', reason: 'not_convertible' }` |
| No draft to publish; stale `expected_version` | publish | `409 CONFIG_STALE` |
| B6 refusals: basis vs owner, `batch_yield_qty` missing, `per_kg` main line rule, line stock item archived since, frozen unit ≠ current, cycle, depth > 3, empty recipe (0 lines) | publish | `422 { field, reason: 'basis_mismatch' \| 'batch_yield_missing' \| 'main_line' \| 'archived' \| 'unit_changed' \| 'cycle' \| 'too_deep' \| 'empty' }` |
| Archive a stock item used by a draft / published line; change its `stock_unit` while a published line freezes it | 01c PATCH | `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }` |
| Settings value | PUT | `400` (`block` refused, B14) |

---

## §4. Contracts

### 4.1 Consumes
08a: `resolveUnit`, `toStockUnits`, `reduceFraction`, `pricePerStockUnit`, `effectiveMenuPrice`, `activeYield`, `displayPer`; `stock_items` (with `kind`), `stock_item_units`, `item_prices`, `yield_profiles`. 01c: menu items, modifier options (plain / linked), group links (for B7 warnings), stock items, versions builder. 01a: write script, audit, bump helpers, builder.

### 4.2 Exposes

| Export | Shape | Used by |
|---|---|---|
| `@pos/domain` `inventory/costing.ts` | `type CostInputs = { items: Map<id, { kind, stock_unit }>, units, prices, yields, recipes: Map<recipeVersionId, RecipeVersion>, byOwner: Map<'menu_item:<id>' \| 'modifier_option:<id>' \| 'stock_item:<id>', recipeVersionId> }`; `buildCostInputs(snapshotInventory \| cloudRows) → CostInputs`; `stockItemUnitCost(inputs, stockItemId, branchId, nowMs) → { value: Fraction \| null, status }`; `recipeCost(inputs, recipeVersionId, branchId, nowMs) → { value: Fraction, status: 'costed' \| 'partial', unknown: string[] }`; `plateCost(inputs, shape: SaleLineShape, branchId, nowMs) → { value: Fraction, status: 'costed' \| 'partial' \| 'no_recipe', recipe_version_id: string \| null }`; `explodeUsage(inputs, shape, { stopAt?: Set<string> }) → { usage: Map<stockItemId, Fraction>, unknown: string[] }`; `SaleLineShape = { kind: 'item', item_id, quantity, sale_unit, options: [{ option_id, quantity }] } \| { kind: 'deal', parts: SaleLineShape[] }` | 08c (sale cost, `OrderCosted`), 08d (theoretical usage), owner app |
| `@pos/events` | `BranchConfigSnapshotSchemaV4` + optional `inventory` (§5.3); `admin/recipes.ts` wires and bodies | hub (store only), owner app |
| Snapshot `inventory` key | §5.3 | 08c, 08d |
| `config_audit` entities `recipe`, `recipe_version`, `inventory_settings`; action `publish` | | 06, 07 |

### 4.3 Requirements carried to later slices

| To | Requirement |
|---|---|
| 08c | Sale-line cost = `plateCost` from the hub's snapshot `inventory` at the **config_version applied at bill close** (owner ruling C6); `recipe_version_id` = `plateCost(…).recipe_version_id`; ingredient lines are not snapshotted (B11 later); hub stores no recipe projection unless 08c needs one (YAGNI) |
| 08d | Theoretical usage = Σ `explodeUsage` over the day's sale + comp lines, `stopAt` the counted cooked items; MWA ("today's cost") is 08d's and is never mixed into `plateCost` (I12) until 08d says so; 08d extends `inventory.items[]` with its receiving fields |
| 08c / 08d | Coverage **by revenue** (R39 "unreliable below 95 %") is computed on the hub from sales and `byOwner` |

### 4.4 Story → slice map
08b: recipes, cost engine, plate cost, coverage by count, `require_recipe_for_menu` (`off` / `warn`), snapshot `inventory` key. 08c / 08d as 08a §4.4.

### 4.5 Changes to other specs (R26) — applied at approval

| Row | Target → section | Change | Why |
|---|---|---|---|
| P-1 | **08a part of this file** I11, §4.3, §6.0 bump column, §6.5–§6.7 statement counts | I11 replaced by B16: unit and yield POSTs **+2** (bump every branch: 7 → 9 statements); price POST **+2** (`branch_id` null) or **+1** (branch) → 11 / 11; stock-item PATCH of `kind` / `code` / `cost_category` / `is_a_item` bumps every branch; A-2's exception ends | B16 |
| A-2′ | 01a → next, S8, S26, §6 write script | 08a's no-bump exception (A-2) removed; ⚠️ markers updated | B16 |
| A-3 | 01a §4 snapshot, S28 | Optional `inventory` key in schema 4 (§5.3), built per branch; hub stores it with the body | B15 |
| A-4 | 01a builder / sync bounds | builder `≤ 23` → **`≤ 29`**; config-only `200` and with-directory `200` **+6**; gzip e2e `≤ 35` → **`≤ 41`** (tests `builder.int.test.ts`, `snapshot-v4.int.test.ts`, `sync-gzip-e2e.int.test.ts`) | B15 |
| A-5 | 01a §5.2 `config_audit` | entities + `recipe`, `recipe_version`, `inventory_settings`; action + `publish` | B1, B14 |
| C-11 | 01c → next §6.8 R2 | archive of a stock item used by a draft / published recipe line → `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }`; `stock_unit` change while a published line freezes it → same; +1 statement (recipe-lines read) only when archiving or changing `stock_unit` | B17 |
| C-12 | 01c §8 (menu page) | "No recipe" badge from `GET /v1/admin/recipes` when the setting is `warn` (client only; no 01c route change) | B14 |
| F-1 | Foundation §6.2 (append, no bump) | `RECIPE_NOT_FOUND` (404) | §6 |
| — | 03a / engine, 02b, hub commands | **No change.** The hub parses the new key with the shared schema and stores it in the body; nothing reads it until 08c | B15 |
| — | 01b | No change (owner-app routes only, I10 of 08a) | — |

---

## §5. Data model

### 5.1 Cloud — `0019_recipes.sql` (number = next free at build; expand only)

```sql
CREATE TABLE recipes (                                             -- B1: one per owner, ever
  tenant_id TEXT NOT NULL REFERENCES tenants, recipe_id TEXT NOT NULL,     -- ULID
  owner_type TEXT NOT NULL CHECK (owner_type IN ('menu_item','modifier_option','stock_item')),
  owner_id TEXT NOT NULL,                                          -- polymorphic: checked by the service (B2)
  visibility_scope TEXT NOT NULL DEFAULT 'all' CHECK (visibility_scope IN ('all','ck_only')),
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, recipe_id),
  UNIQUE (tenant_id, owner_type, owner_id));                       -- §3.3 one recipe per owner; byOwner reads

CREATE TABLE recipe_versions (                                     -- B8
  tenant_id TEXT NOT NULL, recipe_version_id TEXT NOT NULL,        -- ULID
  recipe_id TEXT NOT NULL, version_no INT NOT NULL CHECK (version_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft','published','superseded')),
  basis TEXT NOT NULL CHECK (basis IN ('per_unit','per_kg','per_batch')),
  kg_basis TEXT CHECK (kg_basis IN ('raw_input','served')),
  base_qty INT CHECK (base_qty BETWEEN 1 AND 1000000),
  batch_yield_qty BIGINT CHECK (batch_yield_qty BETWEEN 1 AND 1000000000),
  CHECK ((basis = 'per_kg') = (kg_basis IS NOT NULL AND base_qty IS NOT NULL)),
  CHECK (basis = 'per_batch' OR batch_yield_qty IS NULL),
  CHECK (status = 'draft' OR basis <> 'per_batch' OR batch_yield_qty IS NOT NULL),
  misc_allowance_bp INT NOT NULL DEFAULT 500 CHECK (misc_allowance_bp BETWEEN 0 AND 5000),
  scale_with_parent BOOLEAN NOT NULL DEFAULT false,
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
                                                                   -- B8; the published read of §6.1 / builder

CREATE TABLE recipe_lines (                                        -- B4
  tenant_id TEXT NOT NULL, recipe_version_id TEXT NOT NULL, line_no INT NOT NULL CHECK (line_no BETWEEN 1 AND 60),
  stock_item_id TEXT NOT NULL,
  unit_name TEXT NOT NULL,                                         -- as entered; resolved by resolveUnit at save
  entered_num BIGINT NOT NULL CHECK (entered_num <> 0), entered_den BIGINT NOT NULL CHECK (entered_den >= 1),
  stock_qty_num BIGINT NOT NULL CHECK (stock_qty_num <> 0), stock_qty_den BIGINT NOT NULL CHECK (stock_qty_den >= 1),
  stock_unit TEXT NOT NULL CHECK (stock_unit IN ('piece','g','ml')),   -- frozen at save (B4)
  CHECK (sign(entered_num) = sign(stock_qty_num)),
  qty_basis TEXT NOT NULL CHECK (qty_basis IN ('AP','EP')),
  is_garnish BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, recipe_version_id, line_no),
  UNIQUE (tenant_id, recipe_version_id, stock_item_id),
  FOREIGN KEY (tenant_id, recipe_version_id) REFERENCES recipe_versions,
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items);
CREATE INDEX recipe_lines_stock_item ON recipe_lines (tenant_id, stock_item_id);   -- B17 in-use read

CREATE TABLE tenant_inventory_settings (                           -- B14 (R18: a row the owner page edits)
  tenant_id TEXT PRIMARY KEY REFERENCES tenants,
  require_recipe_for_menu TEXT NOT NULL DEFAULT 'warn' CHECK (require_recipe_for_menu IN ('off','warn')),
  updated_at BIGINT NOT NULL);
-- No row = defaults (warn). config_audit entity / action CHECKs widen (row A-5), live lists re-read first (01b D-5).
```

Append-only for **published** content is enforced by the service: no statement updates `recipe_lines` of a non-draft version or the fields of a non-draft version except `status` (published → superseded). Draft lines are replaced (delete + insert) inside the draft save.

### 5.2 Hub
No migration, no event. The snapshot body (with `inventory`) is stored as today.

### 5.3 Snapshot `inventory` key (`packages/events/src/config.ts`, optional on `BranchConfigSnapshotSchemaV4`)

```ts
inventory?: {
  items: { stock_item_id: string; kind: 'prepared'|'ingredient'|'packet'; name: string; code: string|null;
           stock_unit: 'piece'|'g'|'ml'; cost_category: string; is_a_item: boolean }[];
  units: { stock_item_id: string; unit_name: string; base_unit: Unit; factor_num: string; factor_den: number }[];
  prices: { price_id: string; stock_item_id: string; branch_id: string|null; kind: 'manual'|'market_rate';
            price_minor: number; stock_qty_num: string; stock_qty_den: string; stock_unit: Unit;
            created_at: number; valid_until_at: number|null }[];
  yields: { stock_item_id: string; yield_bp: number }[];
  recipes: { recipe_version_id: string; owner_type: 'menu_item'|'modifier_option'|'stock_item'; owner_id: string;
             basis: 'per_unit'|'per_kg'|'per_batch'; kg_basis: 'raw_input'|'served'|null; base_qty: number|null;
             batch_yield_qty: string|null; misc_allowance_bp: number; scale_with_parent: boolean;
             published_at: number;
             lines: { stock_item_id: string; stock_qty_num: string; stock_qty_den: string; qty_basis: 'AP'|'EP' }[] }[];
}
```
Order: every array sorted by its first id column (hash stability). Builder statements: items 1, units 1 (`DISTINCT ON (stock_item_id, unit_name)` over rows of the item's current base), prices 1, yields 1 (`DISTINCT ON`), recipe versions 1 (published, recipe not archived, `visibility_scope = 'all'`), lines 1 (`= ANY`) = **6**.

### 5.4 Wires (`packages/events/src/admin/recipes.ts`)
`RecipeSummaryWire { recipe_id, owner_type, owner_id, owner_name, owner_archived, visibility_scope, archived, has_draft, published: { recipe_version_id, version_no, published_at } | null, plate_cost: CostWire }`; `CostWire { status: 'costed'|'partial'|'no_recipe', minor: string | null, unknown_items: string[] }` (`minor` rounded half up once; null for `no_recipe`); `RecipeVersionWire { recipe_version_id, version_no, status, basis, kg_basis, base_qty, batch_yield_qty, misc_allowance_bp, scale_with_parent, lines: RecipeLineWire[], cost: CostWire, warnings: { code, line_no?, ids? }[], created_by_name, published_by_name, published_at, version }` (`version` for `expected_version`, C9 style); `RecipeLineWire { line_no, stock_item_id, stock_item_name, kind, unit_name, qty: string, qty_basis, is_garnish, line_cost: CostWire }`; `CoverageWire { items_total, items_with_recipe, pct_bp }`.

---

## §6. Endpoints

Owner routes (JWT, tenant guard, password guard, C4 order). Every route: tenant-wide owner (`assertTenantWide` / `coversEveryBranch`, 01b B8, 08a I10). `branch_id?` query for costs: C2 assert before SQL; absent = every-branch prices only. Shared failures as 08a §6. Every route in `route-cases.ts` (C7). **Cost context** = the 6 reads of §5.3 (stock items, units, price candidates for `branch_id`, yields, published versions, their lines), but tenant-wide for recipes: `ck_only` published versions included (owner view) — reused by §6.1, §6.2. **Lock order** for recipe writes: recipe → owner row → line stock items (01c kind 5) → branches (kind 10); the gap sweep checks where `recipes` sits among 01c §6's kinds (OQ-9).

| § | Route | Audit | Bump |
|---|---|---|---|
| 6.1 | `GET /v1/admin/recipes` | — | — |
| 6.2 | `GET /v1/admin/recipes/:recipe_id` | — | — |
| 6.3 | `POST /v1/admin/recipes` (Idempotency-Key) | `recipe` / `create` | none (draft) |
| 6.4 | `PUT /v1/admin/recipes/:recipe_id/draft` | `recipe_version` / `create` or `update` | none |
| 6.5 | `POST /v1/admin/recipes/:recipe_id/publish` | `recipe_version` / `publish` | every branch if `all`, none if `ck_only` |
| 6.6 | `PATCH /v1/admin/recipes/:recipe_id` | `recipe` / `archive`, `restore`, `update` | every branch if it had a published version and is or was `all` |
| 6.7 | `GET` + `PUT /v1/admin/inventory-settings` | `inventory_settings` / `update` | none |

#### 6.1 `GET /v1/admin/recipes` — Recipes page and coverage
Query `branch_id?`, `filter? ∈ all | missing | partial`. Response `{ can_edit_tenant, setting, coverage: CoverageWire, rows: RecipeSummaryWire[] }`: one row per **active** sellable menu item (with or without recipe), per active plain option, per active prepared / packet stock item, plus archived owners that have a recipe. Order: owner kind (menu items, options, stock items), then `lower(name)`, id. **10 fixed statements:** coversEveryBranch, menu items, plain options, recipes (all, with draft / published flags) + cost context 6.

#### 6.2 `GET /v1/admin/recipes/:recipe_id`
Response `{ can_edit_tenant, recipe: RecipeSummaryWire, draft: RecipeVersionWire | null, published: RecipeVersionWire | null, history: [{ recipe_version_id, version_no, status, published_at, published_by_name }] (≤ 50), parents_missing_removals: [{ owner_id, owner_name, stock_item_id }] (B7, options only) }`. **12 fixed:** coversEveryBranch, recipe, versions (≤ 50), draft lines, owner row, owner names, cost context 6. An option recipe adds 1 (group links of its group → parents) only when `owner_type = modifier_option` → 13. Errors `404 RECIPE_NOT_FOUND`, `404 BRANCH_NOT_FOUND`.

#### 6.3 `POST /v1/admin/recipes` (Idempotency-Key)
Body `{ owner_type, owner_id, visibility_scope? }`. Script: validate → `BEGIN` → key → tenant-wide → owner read `FOR SHARE` (its 01c lock kind) → B2 checks → insert recipe → insert draft v1 (basis per B3, defaults; no lines) → audit → key response → prune → `COMMIT`. `201 { data: { recipe: RecipeSummaryWire, draft: RecipeVersionWire } }`. **8 statements** (key, tenant-wide, owner, recipe, draft, audit, key response, prune).

| Edge | Answer |
|---|---|
| Owner "Paye Half" (piece) | draft `per_unit` |
| Owner "Chicken karahi by weight" (g) | draft `per_kg`, `base_qty 1000`, `kg_basis raw_input` |
| Owner PAYE-COOKED (prepared) | `per_batch`, `batch_yield_qty` null until set |
| Owner TP-1 (packet), no `visibility_scope` | `ck_only` set; `all` sent → `422 packet_ck_only` |
| Linked option "Extra naan" | `422 linked_option` |
| Raw beef (ingredient) | `422 wrong_kind` |
| Second recipe for the same owner | `409 CONFIG_NAME_TAKEN { entity: 'recipe_owner' }` |

#### 6.4 `PUT /v1/admin/recipes/:recipe_id/draft`
Body `{ expected_version: string | null, kg_basis?, base_qty?, batch_yield_qty?, misc_allowance_bp?, scale_with_parent?, lines: [{ stock_item_id, unit_name, qty, qty_basis?, is_garnish? }] }` (`null` = no draft exists; creates version `max + 1`). Script: validate → `BEGIN` → tenant-wide → lock recipe `FOR UPDATE` (`404 RECIPE_NOT_FOUND`) → draft read (version check `409 CONFIG_STALE`; draft exists while `null` sent → `409 CONFIG_STALE`) → stock items of the lines `FOR SHARE` (`= ANY`; `not_found` / `archived`) → item units of those items → `resolveUnit` per line on the locked `stock_unit` (`not_convertible`), freeze stock quantity → upsert draft version → delete draft lines → insert lines (one multi-row) → audit → `COMMIT`. `200 { data: { draft: RecipeVersionWire } }` with B6 warnings and the draft's cost. **14 statements:** 9 for the write (tenant-wide, lock, draft read, line stock items, their units, upsert version, delete lines, insert lines, audit) + 5 for the response (owner names, prices, yields, published versions, their lines). No bump.

| Edge | Answer |
|---|---|
| "Tawa piece": beef 250 g EP, TP-1 15 g, oil 20 ml, onion 30 g, makhan 10 g | `200`; qty_basis EP derived; warning `no_yield` if beef has no yield; cost `partial` until it does |
| Line `ghee 0.92 l` on ghee in g with `l` = 920 g | frozen 846.4 g = 4232 / 5 |
| Line `-30 g onion` on a plain option "No onion" | `200` |
| Negative on a menu-item recipe | `400` |
| Same stock item twice | `400` |
| Stale tab | `409 CONFIG_STALE` |

#### 6.5 `POST /v1/admin/recipes/:recipe_id/publish`
Body `{ expected_version }`. Script: validate → `BEGIN` → tenant-wide → lock recipe `FOR UPDATE` → draft + lines (`409 CONFIG_STALE` when none / stale) → owner row `FOR SHARE` → line stock items `FOR SHARE` → B6 refusals (graph: published versions of prepared / packet owners and their lines, 2 reads) → old published → `superseded` → draft → `published` (`published_at = now`) → audit → bump every branch when `visibility_scope = 'all'` → `COMMIT`. `200 { data: { published: RecipeVersionWire } }`. **13 statements** with `all` (tenant-wide, lock, draft, draft lines, owner, line stock items, graph versions, graph lines, supersede, publish, audit, bump 2); **11** for `ck_only`.

| Edge | Answer |
|---|---|
| PAYE-COOKED batch: 40 paye AP (kg via peti), ghee, onion, adrak-lehsan, 2 × PY-1, yield 160 pieces | `200`; unit cost per piece = batch cost ÷ 160 |
| Published PAYE-COOKED uses QEEMA-COOKED which uses PAYE-COOKED | `422 cycle` |
| Menu item → prepared A → prepared B → prepared C → prepared D | `422 too_deep` |
| `per_kg raw_input` without a ±20 % main AP line | `422 main_line` |
| Line stock item's unit changed since the draft save | `422 unit_changed` (re-save) |
| Publish twice with the same version | second `409 CONFIG_STALE` (no draft) |

#### 6.6 `PATCH /v1/admin/recipes/:recipe_id`
Body `{ expected_version, archived?, visibility_scope? }` (recipe-level version, V13). Packet → `all` refused (`422 packet_ck_only`). No-op `200`, no audit, no bump. **6 statements** (tenant-wide, lock, write, audit, bump 2) when it bumps, 4 when not.

#### 6.7 `GET` / `PUT /v1/admin/inventory-settings`
`GET` `{ require_recipe_for_menu }` (no row → `warn`), 1 statement. `PUT { require_recipe_for_menu: 'off' | 'warn' }`: tenant-wide, upsert, audit = **3**; no bump. `block` → `400` (B14).

---

## §7. Cross-cutting
Logging as 08a AD-11 (no explicit write log). Performance: tens of menu items, a few hundred lines; cost context ≤ 7 reads; owner pages < 300 ms p95 locally. Snapshot growth: ~5–20 KB for a pilot menu. Risks: (1) partial costs read as real — the `partial` badge and "unknown items" list always show; (2) a wrong recipe quantity skews everything — the editor shows each line's cost and the plate cost live; (3) B7 removals silently ignored — the editor lists parents that lack the removed item.

---

## §8. Client contract (owner app)
1. **Recipes page** (new `features/owner/recipes/RecipeList.tsx`): coverage line ("38 of 52 items have a recipe — 73 %"), filter All / Missing / Partial, rows grouped by Menu items · Options · Prepared & packets, each with **Plate cost (menu cost)** (`CostWire`: "Rs 412", "Rs 380 · partial", "No recipe"), branch picker.
2. **Recipe editor** (`RecipeEditor.tsx`): owner header, basis fields per §3.2 (batch yield "makes 160 piece"), misc allowance %, line table (stock item search across kinds, quantity + unit pick-list from `resolveUnit`-accepted units, AP / EP toggle with the derived default, garnish), live line cost and plate cost, warnings, **Save draft** / **Publish** / history; `ck_only` shown as "Central kitchen only — never sent to branches".
3. **Menu page badge** (01c item list): "No recipe" when the setting is `warn` (data from §6.1, C-12).
4. **Settings**: "Recipe required for menu items: Off / Warn".
5. Labels per 08a I12. Urdu strings to the urdu-todo list.

---

## §9. Error catalogue additions
New code **`RECIPE_NOT_FOUND`** (404). New `details`: `422 CONFIG_REFERENCE_INVALID` reasons `linked_option`, `packet_ck_only`, `basis_mismatch`, `batch_yield_missing`, `main_line`, `unit_changed`, `cycle`, `too_deep`, `empty` (and existing `not_found`, `archived`, `not_convertible`, `wrong_kind` on new fields); `409 CONFIG_NAME_TAKEN` entity `recipe_owner`; `409 CONFIG_IN_USE` `used_by.entity: 'recipe'`.

---

## §10. Tests

### 10.1 Pure (`packages/domain/src/inventory/costing.test.ts`)
| # | Case |
|---|---|
| 1 | Line cost: beef 250 g EP, Rs 1,500 / kg, yield 7 120 → 250 × 150 ÷ 0.712 exact fraction; AP line no yield |
| 2 | Missing price → line unknown, recipe `partial`, value = known lines only; missing yield on an EP ingredient line → `partial` (never yield 1); EP on packet / prepared → no yield division |
| 3 | Misc 500 bp applied to cost; `explodeUsage` never applies it |
| 4 | Produced item: PAYE-COOKED batch cost ÷ 160 pieces; "Paye Half" (1 piece + shorba) uses it; packet at branch costs by menu price even with a CK recipe present (B9) |
| 5 | `per_kg`: recipe for 1 000 g; sale 1 250 g → × 5/4; option with `scale_with_parent` scales, without does not |
| 6 | `plateCost` deal = Σ parts; plain option without recipe → +0 and `partial`; item without recipe → `no_recipe` |
| 7 | B7 cap: "No onion" −30 g on a parent with 20 g onion → −20 g; on a parent without onion → 0 (cost and usage) |
| 8 | `explodeUsage`: EP → AP by yield; prepared exploded unless in `stopAt`; packet not exploded; unknown yield listed in `unknown` |
| 9 | Round once: `CostWire.minor` half up from the exact fraction; summing rounded lines ≠ used |
| 10 | Depth 3 and cycle guard in `explodeUsage` / `recipeCost` (defensive: throws on a cycle in inputs) |

### 10.2 Cloud routes (`apps/cloud/test/recipes/*.int.test.ts`)
| # | Case |
|---|---|
| 11 | §6.3 owner kinds and edges table; 8 statements; replay |
| 12 | §6.4 edges table; frozen stock quantity (ghee 0.92 l); 14 statements; stale `409` |
| 13 | §6.4 line unit not convertible `422`; line stock item archived `422`; negative on menu item `400` |
| 14 | §6.5 publish: `superseded` / `published` statuses; immutability (no route changes a published line, grep test as 08a #34) |
| 15 | §6.5 B6 refusals (each reason); warnings returned for EP-in-batch, no-yield, no-price |
| 16 | §6.5 cycle and depth across published recipes; concurrent publish of two recipes that would form a cycle together: one wins, the other `422 cycle` (both lock their own recipe and read the other's published version — test hook `afterRecipeLock`; the later reader sees the committed one) |
| 17 | §6.5 bump: `all` → every branch +1; `ck_only` → none |
| 18 | §6.6 archive / restore / visibility; packet → `all` `422`; no-op |
| 19 | §6.1 coverage by count; rows for active owners + archived owners with recipes; 10 statements; `branch_id` foreign `404` |
| 20 | §6.2 detail; option parents missing removal; 12 / 13 statements |
| 21 | §6.7 settings default warn; `block` `400`; no bump |
| 22 | C-11: stock item archive with a draft / published line → `409 { entity: 'recipe' }`; `stock_unit` change with a published line → `409`; without → `200` |
| 23 | Audit rows per route; cross-tenant sweep (C7) |

### 10.3 Snapshot and bump (`apps/cloud/test/config-sync/inventory-key.int.test.ts`)
| # | Case |
|---|---|
| 24 | Key contents for Lake City: items all kinds, current units only, price candidates (latest manual + unexpired market rates, this branch or null), active yields, published `all` recipes; `ck_only` and archived recipes absent; draft absent |
| 25 | Builder ≤ 29; config-only / with-directory +6; gzip ≤ 41 (A-4) |
| 26 | B16: unit / yield / every-branch price POST bump every branch; branch market rate bumps one branch; draft save, settings, `ck_only` publish bump none; stock-item PATCH of `is_a_item` now bumps |
| 27 | Hash stable across two builds; the hub parses a body with the key and stores it; a body without the key (older cloud) still parses |
| 28 | Hub test: no hub projection reads the key (grep), engine / 02b suites unchanged |

### 10.4 Client
| # | Case |
|---|---|
| 29 | Recipes page coverage text, filters, `partial` / `No recipe` rendering (never "Rs 0" for a missing cost) |
| 30 | Editor: unit pick-list from resolvable units; AP / EP default by basis; live cost; publish errors mapped |
| 31 | Menu badge "No recipe" with `warn`, hidden with `off` |
| 32 | Labels: "Plate cost (menu cost)"; no "today's cost" string |

### 10.5 Acceptance
| Source | Check | Test |
|---|---|---|
| 08-g0 §7 drill 2: Half paye, tawa piece, anda tikki, 1 kg karahi on paper vs system to Rs 1 | fixtures with the paper numbers; `plateCost` rounded = paper | 4, 5, 9 + an acceptance test `[08b drill 2]` with the owner's paper figures (filled when he gives them, OQ-3) |
| §3.7 validation | B6 | 13, 15, 16 |
| §3.8 formulas | B9, B10 | 1–6 |
| D9 | partial, never 0 | 2, 29 |
| D10 | ck_only never in a branch snapshot | 24 |

---

## §11. Build order
1. Migration `0019_recipes.sql` + audit CHECKs (A-5) — tests schema.
2. `@pos/domain/src/inventory/costing.ts` — tests 1–10.
3. Snapshot schema `inventory` key + builder 6 reads + bounds (A-3, A-4) — tests 24, 25, 27, 28.
4. Bump rule on 08a routes and stock-item PATCH (P-1, A-2′) — test 26.
5. Recipes module `apps/cloud/src/modules/recipes/`: §6.3, §6.4 — tests 11–13.
6. §6.5 publish (B6, cycles, hook) — tests 14–17.
7. §6.6, §6.7 — tests 18, 21.
8. §6.1, §6.2 (cost context) — tests 19, 20.
9. C-11 stock-item in-use — test 22.
10. Audit + route cases — test 23.
11. Owner app: Recipes page, editor, badge, settings — tests 29–32.

11 tasks, 8 routes (7 rows, `GET` + `PUT` settings): inside the size budget.

---

## §12. DoD, checklist, open questions, deferred

### 12.1 Definition of Done
Tests 1–32 green; hub, engine, 02b suites unchanged except the shared schema parse; drill 2 acceptance test green with the owner's paper numbers; §4.5 rows applied at the fold into `08_Inventory_Costing_Spec`.

### 12.2 Endpoint checklist
| § | Route | Codes |
|---|---|---|
| 6.1 | GET recipes | 200, 400, 401, 403, 404 |
| 6.2 | GET recipes/:id | 200, 400, 401, 403, 404 |
| 6.3 | POST recipes | 201, 400, 401, 403, 409, 422 |
| 6.4 | PUT …/draft | 200, 400, 401, 403, 404, 409, 422 |
| 6.5 | POST …/publish | 200, 400, 401, 403, 404, 409, 422 |
| 6.6 | PATCH recipes/:id | 200, 400, 401, 403, 404, 409, 422 |
| 6.7 | GET / PUT inventory-settings | 200, 400, 401, 403 |

### 12.3 Open questions (owner)

| # | Question | Default |
|---|---|---|
| OQ-1 | **Snapshot shape (irreversible-ish):** send cost **inputs** (items, units, price candidates, yields, recipes) and compute on the hub (B15), or send precomputed costs per owner? Inputs let the hub honour market-rate expiry and 08d MWA later; precomputed is simpler but goes stale between bumps | Inputs (B15) |
| OQ-2 | **Bump on every price / unit / yield write (B16).** Every market rate entry makes the hub refetch the whole snapshot (~5–20 KB more). Fine for 1 pilot branch; OK? | Yes |
| OQ-3 | Drill 2 paper numbers (Half paye, tawa piece, anda tikki, 1 kg karahi): when can the owner give them? They become the acceptance test | Before 08b build task 2 |
| OQ-4 | B7: removal options capped per sale line instead of refused at publish — OK? | Yes |
| OQ-5 | B14: `block` left out until its rule is defined (what is refused: creating a menu item? making it available? selling it at the hub?). Confirm, and say which when father decides | Left out |
| OQ-6 | B6 `per_kg raw_input` main line within ±20 % of `base_qty` — is ±20 % right for karahi (bone-in raw weight vs base)? | ±20 % |
| OQ-7 | As built in 08a: `displayPer` and `reduceFraction` live in `@pos/domain` (spec 08a §4.2 listed them on the server / not at all). 08b uses them as exports; record as 08a as-built at the fold | Accept |
| OQ-9 | Lock order: where `recipes` (and the owner rows it locks `FOR SHARE`) sit among 01c §6's lock kinds; the gap sweep fixes the kind numbers before build task 5 | recipe → owner → stock items → branches |
| OQ-8 | Migration number: 08d drafts in parallel and may also add a cloud migration; the number is the next free one in merge order | Merge order |

### 12.4 Deferred until needed
Deal cost range and suggested price / MFC (POST, R39 (e)); `block` for `require_recipe_for_menu` (OQ-5); restatement / backdated recipes (`SaleCostRestated`); recipe yield learned from batches (`ProductionBatchRecorded`, POST); prep instructions, plating photo, serving utensil, accompaniments (08-g0 §3.7 optional fields); `derived_from_recipe_id`; coverage by revenue in the cloud (needs 06 sync); a CK hub and `ck_only` delivery to it; per-supplier yields.
