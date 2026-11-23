# 08b — Inventory & Costing: recipes + cost engine — Module Spec part v0.2 (DRAFT)

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
| Module | 08b Recipes + cost engine: recipes as cloud config (draft → published versions → archive) for sellable menu items, plain modifier options and `prepared` stock items; a pure, non-throwing cost engine and usage explosion in `@pos/domain`; plate cost and recipe coverage in the owner app (`require_recipe_for_menu` = `warn`, a constant); the snapshot's `inventory` key that 08a deferred, with the bump rule that replaces 08a I11 |
| Version | **v0.2 — DRAFT** (2026-11-23, run 1 fixed + owner rulings). v0.1 — DRAFT |
| Depends on | Foundation v1.15; 00 v1.12.3; 01a v2.8 (S8, S26, S27, S28, S48, MD-3, AD-9, common write script); 01b v1.10.3 (B8, §4.4 row 6); 01c v1.2 (V2, V6, V7, V10, V13, V14, §3.4 line rules, §6 lock order, §6.5, §6.8, §6.12); **08a v1.0** (`stock_items.kind`, item units, prices, yields, `resolveUnit`, `effectiveMenuPrice`, `activeYield`, I12 labels; as built on `module-08a`) |
| Inherits | Shared Standards of Foundation v1.15 §6; carried conventions C1–C9; 08a's conventions (integers only, `BigInt(string)`, fractions, round once) |
| Changes other specs | 08a part of this file (I11 ends, statement counts, R4, test #9), 01a → next (A-2 ends; `inventory` key; builder / sync bounds; audit entities and action; release bump), 01b → next (sync bound), 01c → next (stock-item archive / unit in use; `sale_unit` and plain → linked guards; §9), foundation §6.2 (one code), README. Full list §4.5 |
| Tier | T2 |
| Milestone | A (pilot), R39 slice 2 of 4 |
| Inputs | 08-g0 §2, §3.5, §3.7–§3.9, §3.11, D6–D9; R18, R28, R29, R39; owner rulings 2026-11-23 22:13 PKT; review run 1; code `module-08a` |

### Stories covered

| Source | Item | How |
|---|---|---|
| 08-g0 §2 "Recipes: per_unit / per_kg / per_batch, variants, add-ons (incl. negative deltas), produced items, packet items as ingredients" | owners, bases, lines | B1–B8 (packet as **ingredient line** yes; packet as **owner** no, R7) |
| §2 "Cost engine + plate cost" | pure engine, plate cost | B9–B12 |
| §2 "`require_recipe_for_menu` = warn" | badge + coverage | B14 (constant `warn`, R7) |
| §3.7 validation | convertibility, removal add-on, cycles ≤ 3, EP-in-batch warning | B6, B7 |
| §3.8 formulas | line / recipe / produced / per_kg cost, status | B9, B10 |
| 08a §4.3 row 08b | `inventory` key, bump rule, `partial` on missing price / yield | B15, B16 |
| D10 secret BOM | — | **POST** (R7; §12.4) |
| §2 "deal cost range + suggested price" | — | **POST** (R39 (e); §12.4) |

### In scope
- Cloud: `recipes`, `recipe_versions`, `recipe_lines`; six routes (§6); migration `0019_recipes.sql` with the release bump.
- `@pos/domain/src/inventory/costing.ts`: cost inputs, plate cost, `explodeUsage`, `explodeStockItem` (pure, non-throwing).
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
| Builder bound today **≤ 23**; sync config-only `200` ≤ 28, with directory ≤ 35 (01b §4.4 row 6); gzip e2e at the S48 design size | `builder.int.test.ts`, `sync-config.int.test.ts`, `sync-gzip-e2e.int.test.ts`; 01b v1.10.3 |
| Every config write: one transaction; `assertTenantWide` first (after the key on a creating POST); `bumpEveryBranch` = 2 statements; `bumpConfigVersion` for one branch = 1 | 01a S8; `lib/config-version.ts` |
| 08a as built: stock items with `kind`; item units; price rows; yields; `resolveUnit`, `effectiveMenuPrice`, `activeYield`, `pricePerStockUnit`, `displayPer`, `reduceFraction`; I12 labels; `CloudTestHooks.afterStockItemLock` | 08a v1.0; `module-08a` |
| A variant is a full `menu_items` row; plain options carry a price; linked options become `option_child` lines with their own `item_id`; deal parts → choices → `item_id`; child quantity and option charge per 01c §3.4.2 / §3.4.3 | 01c V2, V6, V10, §3.4 |
| 01c lock order kinds 1–10 (modifier groups 1 … stock items 5 … `branches` 10) | 01c §6 |

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Reason | Overrides / changes |
|---|---|---|---|
| B1 | **Recipes are cloud config rows**, not hub events (C7 (a)). `recipes` (one per owner, ever) → `recipe_versions` (`draft` / `published` / `superseded`) → `recipe_lines`. Every write audited, one `config_audit` row per entity changed (⚠️ v0.2 m-9). 08-g0's `RecipeDraftSaved` / `RecipeVersionPublished` / `RecipeArchived` events become the routes of §6 | Owner edits in the owner app; branches receive published versions in the snapshot | 08-g0 §3.7 events → config rows |
| B2 | **Owners** (`owner_type`, `owner_id`): `menu_item` (any sellable row: plain item or variant — no D11 default variant, R39 (d)); `modifier_option` (**plain options only**: a linked option is costed through its linked item's recipe as its `option_child` line; `422 { reason: 'linked_option' }`); `stock_item` of kind **`prepared`** only (PAYE-COOKED, QEEMA-COOKED). `ingredient` and **`packet`** owners → `422 wrong_kind` (⚠️ v0.2 R7: packets are costed at menu price; their BOM is POST). **Deals own no recipe**: a deal line's cost is the sum of its part lines | 08-g0 §3.7 owner types mapped to the repo | 08-g0 `variant` / `addon_option` / `produced_item` |
| B3 | **Basis follows the owner**: `menu_item` with `sale_unit = 'piece'` → `per_unit`; with `sale_unit ∈ g, ml` → `per_kg` (`base_qty` in the sale unit, default 1 000 = per kg / per litre; **always raw-input basis**, D6 — ⚠️ v0.2 R7: no `kg_basis` field, `served` is POST); `modifier_option` → `per_unit` (per 1 option quantity per parent unit, B10); `stock_item` → `per_batch` (`batch_yield_qty` in the item's `stock_unit`, integer 1 … 1 000 000 000, required to publish). A "1 kg karahi" sold as a piece is `per_unit` with a 1 000 g raw-chicken AP line; a karahi sold by weight is `per_kg` | One rule per owner kind; a sale line's quantity always matches its recipe's basis | 08-g0 `basis` field → derived; `portion_qty`, `kg_basis` dropped |
| B4 | **Lines.** `stock_item_id` (any kind: `ingredient`, `packet`, `prepared`); quantity entered as a decimal string `^-?\d{1,6}(\.\d{1,4})?$` in a unit the item resolves (08a I5), stored as the entered fraction **and** the frozen stock-unit quantity (`stock_qty_num / stock_qty_den`, reduced, `|num|` ≤ 10^15 else `422 qty_out_of_range`, ⚠️ v0.2 m-8) with the item's `stock_unit` at save (as 08a I6 freezes a price's conversion). `qty_basis ∈ AP \| EP`: sent, or derived at draft save from the **locked** data (⚠️ v0.2 M-7): `per_batch` → AP (D7); `per_unit` / `per_kg` → for an `ingredient` line, EP **only when the item has an active yield**, else AP with the warning `no_yield_defaulted_ap`; for `packet` / `prepared` lines, AP (no yield applies). An explicit EP on an ingredient with no yield stays `partial` (D9: never yield 1). At most 60 lines; a stock item once per version. Negative quantities only in `modifier_option` recipes (removals); elsewhere `422 { field: 'lines.N.qty', reason: 'negative_not_option' }` (⚠️ v0.2 m-7) | D7 without double yield; pantry items (oil, salt, masala) without a yield profile are honestly AP; units validated at save (08-g0 §3.1) | — |
| B5 | **Misc allowance** `misc_allowance_bp` 0 … 5 000, default 500 (5 %, 08-g0 §3.7); applied to **cost only, never to usage**, and only at the **top** recipe of a sale line (the menu item's or the option's), never again when a `per_batch` recipe is costed as a line (⚠️ v0.2 m-6, owner OQ-4 default) | 08-g0 §3.7; no compounding through PAYE-COOKED | `misc_allowance_pct` → bp (C4) |
| B6 | **Validation at publish** (draft saves check shape, references, units only): recipe not archived (`422 { field: 'recipe_id', reason: 'archived' }`, m-10); basis matches B3 for the owner's **current** `sale_unit` / kind (`422 basis_mismatch`); `per_batch` has `batch_yield_qty` (`422 batch_yield_missing`); every line's stock item active (`422 archived`) and its frozen `stock_unit` still the item's `stock_unit` (`422 unit_changed`, re-save); at least one line, **except** for a `modifier_option` owner, whose empty recipe costs 0 and is `costed` ("Spicy", "Less oil") (⚠️ v0.2 M-6; else `422 empty`); **graph** (⚠️ v0.2 B-1, M-3): under the publish lock (lock kind 0), read the tenant's whole published, non-archived graph (one statement), apply the change (this version replaces the owner's published one), and refuse when the result has a **cycle** (`422 cycle`) or any nesting chain deeper than **3** prepared levels below a menu item or option (`422 too_deep`), in either direction through this recipe. **Warnings** (non-blocking, returned and shown): EP line inside `per_batch` (D7); `no_yield_defaulted_ap`; EP ingredient line with no active yield; line with no menu cost (cost `partial`); `per_kg` with no AP ingredient line whose stock quantity is within ±20 % of `base_qty`, checked only when that line's stock unit equals the sale unit (`main_line_off`; ⚠️ v0.2 R7 / m-11: warning, never a refusal) | 08-g0 §3.7; a serial graph check is the only way to keep "no cycle" true under concurrent publishes | 08-g0 §3.7 kg_basis rule → warning |
| B7 | **Removal options against many parents.** A modifier group attaches to categories, variant groups and items (01c V7), so "the item exists in the parent's recipe" cannot be kept true at publish. Rule: publish never refuses for it, and the engine **caps** a negative option line: removed AP stock quantity ≤ the parent recipe's own **direct** AP stock quantity of that stock item (after yield), per parent unit × parent quantity (⚠️ v0.2 m-5); never below 0. "No onion" on a dish without a direct onion line costs and uses nothing. ⚠️ v0.2 R7: the editor's parent-missing list (`parents_missing_removals`) is cut; the cap alone keeps removals safe | Many parents make a refusal impossible to keep true | 08-g0 §3.7 "removal add-on valid only if…" → cap |
| B8 | **Versions are immutable once published.** One draft and one published version per recipe at most. Saving replaces the draft (versioned, `expected_version`, 01c V13); publishing turns the draft into the published version and the old published into `superseded` (`published_at` = effective time, no backdating; restatement POST). A new draft is created by `PUT … /draft` with `expected_version: null` (the editor sends the published content) | 08-g0 §3.7 | — |
| B9 | **Cost engine** (`@pos/domain/src/inventory/costing.ts`, pure, BigInt fractions, **never throws**, ⚠️ v0.2 B-1). For a branch at time `now`: `cost_per_stock_unit(item)` = (a) `prepared` item with a published batch recipe in the inputs: that recipe's cost (no misc, B5) ÷ `batch_yield_qty`; (b) `ingredient`, `packet`, or `prepared` without a recipe: `pricePerStockUnit(effectiveMenuPrice(…))` (08a I7; packets by menu price, 08-g0 §3.5 step 4); (c) none → unknown. `line_cost = stock_qty × cost_per_stock_unit ÷ (qty_basis = EP and kind = ingredient ? yield_bp / 10 000 : 1)`; an EP ingredient line with no active yield → unknown (D9). A line whose sub-recipe is itself `partial` is `partial` (⚠️ v0.2 M-11). A cycle or a nesting deeper than 3 met in the inputs (possible only on raw-edited data or a broken snapshot) marks that line unknown — the engine returns `partial`, never throws. `recipe_cost = Σ line_cost × (10 000 + misc_bp) / 10 000` at the top recipe only (B5). A `per_kg` recipe's cost is for `base_qty`; a sale of `q` (sale unit) costs `recipe_cost × q / base_qty`. **Status:** `costed` when every line is known; `partial` when at least one line is unknown (value = the known part, shown labelled; `minor: null` when no line is known, ⚠️ v0.2 m-3); `no_recipe` when the owner has no published version. Rounded to minor units **once**, at the edge, **half away from zero** (⚠️ v0.2 m-4) | 08-g0 §3.8, D9 | 08-g0 `NUMERIC(14,4)` → fractions |
| B10 | **Plate cost of a sale line** (⚠️ v0.2 M-11) — `plateCost` is for the **whole sale line**, quantities in the line's sale unit: item recipe cost × line quantity (`per_unit`) or × `q / base_qty` (`per_kg`); + each chosen **plain** option's recipe cost × `childQuantity(optionQty, parentQty, parentSaleUnit)` (01c §3.4.2: × parent quantity on a piece parent, once per line on a g / ml parent; ⚠️ v0.2 R7: no `scale_with_parent`); linked options and deal parts are their own sale lines with their own item recipes; a deal line's cost = Σ its part lines (part quantity × deal quantity, 01c §3.4.2). **Status:** `partial` if any part is `partial`, or a plain option has no recipe (adds 0, 08-g0 §3.11); `no_recipe` when the item has no recipe; a **deal** is `no_recipe` only when every part is `no_recipe`, else `partial` or `costed` | 08-g0 §3.8, §3.9, §3.11; 01c §3.4 | — |
| B11 | **Usage explosion** (pure, non-throwing). `explodeUsage(inputs, line: SaleLineUsage)` takes a sale line **with the recipe version ids recorded for it** (item and each option; ⚠️ v0.2 M-8) and returns `{ usage: Map<stock_item_id, Fraction /* stock units, as purchased */>, status }`: EP ingredient lines ÷ yield (AP = EP ÷ yield; unknown yield → that item is left out and `status = 'partial'`); `prepared` lines explode through their published batch recipe (÷ `batch_yield_qty`) — **always, no `stopAt`** (⚠️ v0.2 contract); `packet` lines never explode (they are stock); negative option lines capped per B7; **misc never applied** (B5); a version id not in the inputs → that part `partial`; cycle / depth > 3 → that branch dropped, `partial`. `explodeStockItem(inputs, preparedStockItemId, qty)` explodes a quantity of a `prepared` item (08d's cooked counts and waste) by the same rules (contract text §4.2). Yields used are those in the inputs (the snapshot applied at the time 08c runs) | 08-g0 §3.9, §3.12 | 08-g0 "yields effective at sale time" → the applied snapshot's (pilot simplification, like C6; restatement POST) |
| B12 | **Owner-app plate cost uses the branch the owner picks** (`branch_id` query) and `now`; labels per 08a I12: **"Menu cost"** / **"Plate cost (menu cost)"**, never "today's cost". With R7 the owner app and every hub use the same recipes (no `ck_only`), so one plate has one number (⚠️ v0.2 M-10) | Two price sources must never be confused | — |
| B13 | ~~`visibility_scope` / `ck_only`~~ — **cut** (⚠️ v0.2 R7). Packet BOMs (D10) are POST, with a CK hub | Pilot has no CK hub | — |
| B14 | **`require_recipe_for_menu` = `warn`, a constant in the pilot** (⚠️ v0.2 R7; no table, no route). A "No recipe" badge on every active sellable menu item without a non-archived published recipe (menu page, Recipes page), and **coverage by count** on the Recipes page: active menu items (each variant row counts; plain items count; options and stock items do not) with a non-archived published recipe ÷ active menu items (⚠️ v0.2 m-12). `off` and `block` are POST (§12.4). Coverage **by revenue** is 08c's (hub) | C9; the cloud has no sales | 08-g0 §3.11 `off \| warn \| block` → constant `warn` |
| B15 | **Snapshot `inventory` key** (optional, schema stays 4, S28 (c); 08a §4.3). Built per branch, **a function of the stored rows only** (⚠️ v0.2 M-2): (a) `prices[]`: per (stock item, scope ∈ {this branch, every branch}) the rows **not dominated** in the item's current `stock_unit` — a row R is dominated when a newer row (`created_at`, then id) of the same item and scope has `valid_until_at` null or ≥ R's (it would always win over R, 08a I7); so: the latest manual, and the newer market rates that expire after it (normally one); no time filter. The hub evaluates expiry on its own clock and treats every row of an applied snapshot as already in effect (no `created_at ≤ now` on the hub, ⚠️ v0.2 m-2); (b) `items[]`: active stock items (`stock_item_id, kind, name, code, stock_unit, cost_category, is_a_item`; archived items not sent — 08d is told, §4.3); (c) **`inventory` is `z.unknown().optional()` in the hub snapshot schema**; the typed `InventorySnapshotSchema` (§5.3) is exported separately — the cloud builder parses its output strictly before sending; 08c parses lazily at use, and a failed parse means "no costs" (`no_recipe` / `partial`), never a rejected config (⚠️ v0.2 M-5); (d) `units[]` current item units (I5 step-2 set), `yields[]` active per ingredient; (e) `recipes[]`: for each non-archived recipe whose owner is an active-or-archived `menu_item`, a plain `modifier_option`, or a **`prepared`** stock item (builder backstop, ⚠️ v0.2 M-4), the published version **and its up to 3 most recent superseded versions** (by `published_at`, then id) with their lines (`json_agg`), so 08c can explode a day's lines with the versions they were costed with (⚠️ v0.2 M-8). **No cost values** in the snapshot. Builder **+5** statements (items, units, prices, yields, versions with lines) | Hub needs the inputs; hash stays a function of `config_version`; a key no hub reads cannot take down ordering config | 01a snapshot (rows A-3, A-4) |
| B16 | **Bump rule (replaces 08a I11).** A write bumps exactly the branches whose snapshot it changes: stock-item POST / PATCH of any `items[]` field → every branch; item unit POST → every branch; price POST → every branch if `branch_id` null, else that branch (1 statement); yield POST → every branch; recipe **publish**, **archive** and **restore** of a recipe that has a published version → every branch. **No bump:** recipe create (draft only), draft saves, archive / restore of a recipe with no published version. Market-rate **expiry** changes no body (B15 a). The **release** bumps every branch once (`0019`, ⚠️ v0.2 M-1, row A-6). 01a A-2 (08a) ends | The key now carries this data | 08a I11, §6.0, A-2 (rows P-1, A-2′) |
| B17 | **In use.** A stock item that is a line of a **non-archived** recipe's published or draft version cannot be archived, and its `stock_unit` cannot change while a non-archived published line freezes the old unit — `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }` (⚠️ v0.2 m-10: archived recipes never block). **Owner edits** that would silently corrupt a recipe are refused while the owner has a **non-archived** recipe (⚠️ v0.2 M-4): a menu item's `sale_unit` change (piece ↔ g / ml: the basis would flip), a plain option becoming linked (cost counted twice), a stock item's `kind` change (a prepared owner must stay prepared) → `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids: [recipe_id] } }`; the owner archives the recipe first. A menu item, option or stock item that **owns** a recipe can still be archived (the recipe stays for old orders, 08c) and is listed as "owner archived" | No silent `partial` costs, frozen-unit drift or wrong basis | 01c §6.5, §6.8 R2, §6.12; 08a R4 (rows C-11, C-14, C-15, P-2) |

### 3.2 Owner kinds

| Owner | Basis | `batch_yield_qty` | Negative lines | Empty recipe |
|---|---|---|---|---|
| `menu_item`, sale unit piece | `per_unit` | — | no | refused |
| `menu_item`, sale unit g / ml | `per_kg` (`base_qty`) | — | no | refused |
| `modifier_option` (plain) | `per_unit` | — | **yes** | **allowed** (costs 0) |
| `stock_item` `prepared` | `per_batch` | required | no | refused |
| `stock_item` `ingredient` / `packet` | — (`422 wrong_kind`) | | | |

### 3.3 Validation rules

| Rule | When | Error |
|---|---|---|
| `owner_type` / `owner_id` exist in the tenant | create | `422 { field: 'owner_id', reason: 'not_found' }` |
| Linked option; ingredient or packet owner | create | `422 { field: 'owner_id', reason: 'linked_option' \| 'wrong_kind' }` |
| One recipe per owner (archived included) | create | `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids: [existing] } }` (⚠️ v0.2 m-18) |
| Lines ≤ 60, each stock item once, qty matches the B4 pattern and ≠ 0; `misc_allowance_bp` 0 … 5 000; `base_qty` 1 … 1 000 000; `batch_yield_qty` 1 … 1 000 000 000 | draft save | `400` |
| A field that does not apply to the recipe's basis (`base_qty` off `per_kg`, `batch_yield_qty` off `per_batch`); a negative qty off an option recipe | draft save, after the recipe read | `422 { field, reason: 'basis_mismatch' \| 'negative_not_option' }` (⚠️ v0.2 m-7) |
| Line stock item unknown / archived | draft save | `422 { field: 'lines.N.stock_item_id', reason: 'not_found' \| 'archived' }` |
| Line unit not resolvable (08a I5); frozen quantity out of range | draft save | `422 { field: 'lines.N.unit_name' \| 'lines.N.qty', reason: 'not_convertible' \| 'qty_out_of_range' }` |
| Recipe archived | draft save, publish | `422 { field: 'recipe_id', reason: 'archived' }` |
| No draft to publish; stale `expected_version` | publish | `409 CONFIG_STALE` |
| B6 refusals | publish | `422 { field, reason: 'basis_mismatch' \| 'batch_yield_missing' \| 'archived' \| 'unit_changed' \| 'cycle' \| 'too_deep' \| 'empty' }` |
| Restore that would form a cycle / too deep a chain | PATCH restore | `422 { field: 'archived', reason: 'cycle' \| 'too_deep' }` |
| B17: stock item archive / `stock_unit` change; menu item `sale_unit` change; plain → linked option; stock item `kind` change | 01c / 08a writes | `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }` |

---

## §4. Contracts

### 4.1 Consumes
08a: `resolveUnit`, `toStockUnits`, `reduceFraction`, `pricePerStockUnit`, `effectiveMenuPrice`, `activeYield`, `displayPer`, `selectPriceCandidates` (as built; shared with the builder, ⚠️ v0.2 m-13); tables `stock_items`, `stock_item_units`, `item_prices`, `yield_profiles`. 01c: menu items, modifier options and groups, deals, `childQuantity`; versions builder. 01a: write script, audit, bump helpers, builder, `CloudTestHooks`.

### 4.2 Exposes

| Export | Shape | Used by |
|---|---|---|
| `@pos/domain` `inventory/costing.ts` | `type CostInputs` (built by `buildCostInputs(inventory: InventorySnapshot \| CloudCostRows)`): items, current units, price rows, active yields, recipe versions by id, `publishedByOwner: Map<'menu_item:<id>' \| 'modifier_option:<id>' \| 'stock_item:<id>', recipeVersionId>`. `type Fraction = { num: bigint, den: bigint }`. `recipeCost(inputs, recipeVersionId, branchId, nowMs, { top: boolean }) → { value: Fraction, status: 'costed' \| 'partial', unknown: string[] }`. `plateCost(inputs, line: SaleLineShape, branchId, nowMs) → { value: Fraction, status: 'costed' \| 'partial' \| 'no_recipe', recipe_version_ids: { item: string \| null, options: { option_id: string, recipe_version_id: string \| null }[] } }` (⚠️ v0.2 M-8). `explodeUsage(inputs, line: SaleLineUsage) → { usage: Map<string, Fraction>, status: 'costed' \| 'partial' }` with `SaleLineUsage = SaleLineShape & { recipe_version_ids }` (the ids `plateCost` returned and 08c stored). **`explodeStockItem(inputs, preparedStockItemId: string, qty: bigint /* stock units of the prepared item */) → { usage: Map<string /* stock_item_id */, { num: bigint, den: bigint }>, status: 'costed' \| 'partial' }`** — through the item's published `per_batch` recipe, raw = qty × line ÷ `batch_yield_qty`, recursing through prepared sub-items, depth ≤ 3; a cycle or depth > 3 never throws: that branch is dropped and `status = 'partial'` (⚠️ v0.2 M-9, owner contract). `SaleLineShape = { kind: 'item', item_id, quantity: bigint, sale_unit, options: { option_id, quantity: bigint }[] } \| { kind: 'deal', quantity: bigint, parts: SaleLineShape[] }`. None of these throws | 08c (sale cost, `OrderCosted`, `theoreticalUsage`), 08d (cooked counts through `explodeStockItem`), owner app |
| `@pos/events` | `InventorySnapshotSchema` (typed, §5.3, exported separately); `BranchConfigSnapshotSchemaV4.inventory = z.unknown().optional()` (⚠️ v0.2 M-5); `admin/recipes.ts` wires and bodies | cloud builder (strict), 08c (lazy), owner app |
| `config_audit` | entities `recipe`, `recipe_version`; action `publish` | 06, 07 |

### 4.3 Requirements carried to later slices (contract text identical in 08d where it names 08d)

| To | Requirement |
|---|---|
| 08c | **08c owns `theoreticalUsage`**, with full explosion (no `stopAt`): Σ `explodeUsage` over the business day's sale and comp lines, each with the recipe version ids 08c stored for it; voided lines, coverage by revenue and day attribution are 08c's rules. Sale-line cost = `plateCost` from the hub's `inventory` key at the **`config_version` applied at bill close** (owner ruling C6); 08c stores `recipe_version_ids` per line (item + options). A version id no longer in the applied snapshot (more than 3 republishes since) → that line `partial`. Parse `inventory` lazily (`InventorySnapshotSchema.safeParse`); a failure = `no_recipe` / `partial`, never a rejected config. Hub stores no recipe projection unless 08c needs one |
| 08d | Cooked counts and cooked waste convert to raw stock through **`explodeStockItem`**; 08d does **not** compute theoretical usage (08c does). `inventory.items[]` holds **active** stock items only. 08d extends `items[]` with its receiving fields (its own row; statement count unchanged). MWA ("today's cost") is 08d's and is never mixed into `plateCost` (I12) |
| 08c / 08d | Coverage by revenue (R39 "unreliable below 95 %") is 08c's, returned with `theoreticalUsage` |

### 4.4 Story → slice map
08b: recipes, cost engine, plate cost, coverage by count, `require_recipe_for_menu` (constant `warn`), snapshot `inventory` key, explosion functions. 08c / 08d as 08a §4.4.

### 4.5 Changes to other specs (R26) — applied at approval; version numbers = next free at approval (08b merges before 08d)

| Row | Target → section | Change | Why |
|---|---|---|---|
| P-1 | **08a part of this file** I11, §4.3, §6.0 bump column, §6.3 PATCH, §6.5–§6.7 counts; 08a test **#9** | I11 replaced by B16: unit and yield POSTs **+2** (7 → 9); price POST **+2** every-branch / **+1** branch (as built + 2 / + 1); stock-item PATCH of `kind` / `code` / `cost_category` / `is_a_item` bumps every branch; test #9 ("no bump … = bump path − 2") becomes "bumps every branch" (⚠️ v0.2 M-12) | B16 |
| P-2 | **08a part** R4 (stock-item PATCH merged rules) | `kind` change of a stock item that owns a non-archived recipe → `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }`, checked with R4's drawers read's statement (+1 read of `recipes` when `kind` changes) (⚠️ v0.2 M-4) | B17 |
| A-2′ | 01a → next, S8, S26, §6 write script | 08a's no-bump exception (A-2) removed; ⚠️ markers updated | B16 |
| A-3 | 01a §4 snapshot, S28 | Optional `inventory` key in schema 4, `z.unknown().optional()` on the hub schema; typed schema exported separately (§5.3) | B15 |
| A-4 | 01a builder / sync bounds (⚠️ v0.2 M-12 full list) | builder `≤ 23` → **`≤ 28`** (`builder.int.test.ts:395`, `:384`); `snapshot-v4.int.test.ts`; config-only `200` ≤ 28 → **≤ 33** (`sync-config.int.test.ts:58`); with directory ≤ 35 → **≤ 40** (`sync-gzip-e2e.int.test.ts:149`, `:166`); gzip e2e fixture gains the key (m-15) | B15 |
| A-5 | 01a §5.2 `config_audit` | entities + `recipe`, `recipe_version`; action + `publish` | B1 |
| A-6 | 01a migrations (MD-3 / AD-9 pattern) | `0019_recipes.sql` ends with `UPDATE branches SET config_version = config_version + 1` (every branch; release delivery of the key) (⚠️ v0.2 M-1) | B16 |
| B-x | **01b** → next, §4.4 row 6 | sync `200` bound with the directory ≤ 35 → **≤ 40** (written by 01a v2.7 R-32) (⚠️ v0.2 M-12) | B15 |
| C-11 | 01c → next, §6.8 R2 | archive of a stock item used by a non-archived recipe's draft / published line, or `stock_unit` change while a non-archived published line freezes it → `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }`; +1 statement (recipe-lines read) only when archiving or changing `stock_unit` | B17 |
| C-12 | 01c §8 (menu page) | "No recipe" badge from `GET /v1/admin/recipes` (client only) | B14 |
| C-13 | 01c §9 | `409 CONFIG_IN_USE` `used_by.entity: 'recipe'` (⚠️ v0.2 M-12) | B17 |
| C-14 | 01c §6.5 | `sale_unit` change of an item that owns a non-archived recipe → `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }`; +1 statement only when `sale_unit` changes (⚠️ v0.2 M-4) | B17 |
| C-15 | 01c §6.12 | a plain option that owns a non-archived recipe cannot gain a `linked_item_id` → same `409`; +1 statement only when an option becomes linked (⚠️ v0.2 M-4) | B17 |
| F-1 | Foundation §6.2 (append, no bump) and `@pos/domain/src/errors.ts` | `RECIPE_NOT_FOUND` (404) | §6 |
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
  basis TEXT NOT NULL CHECK (basis IN ('per_unit','per_kg','per_batch')),
  base_qty INT CHECK (base_qty BETWEEN 1 AND 1000000),
  batch_yield_qty BIGINT CHECK (batch_yield_qty BETWEEN 1 AND 1000000000),
  CHECK ((basis = 'per_kg') = (base_qty IS NOT NULL)),
  CHECK (basis = 'per_batch' OR batch_yield_qty IS NULL),
  CHECK (status = 'draft' OR basis <> 'per_batch' OR batch_yield_qty IS NOT NULL),
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
            price_minor: string; stock_qty_num: string; stock_qty_den: string;
            created_at: number; valid_until_at: number|null }[];          // B15 (a) non-dominated rows
  yields: { stock_item_id: string; yield_bp: number }[];
  recipes: { recipe_version_id: string; status: 'published'|'superseded';
             owner_type: 'menu_item'|'modifier_option'|'stock_item'; owner_id: string;
             basis: 'per_unit'|'per_kg'|'per_batch'; base_qty: number|null; batch_yield_qty: string|null;
             misc_allowance_bp: number; published_at: number;
             lines: { stock_item_id: string; stock_qty_num: string; stock_qty_den: string; qty_basis: 'AP'|'EP' }[] }[];
}
```

**Order (⚠️ v0.2 m-1), sorted in JS by code point:** `items` by `stock_item_id`; `units` by (`stock_item_id`, `unit_name`); `prices` by `price_id`; `yields` by `stock_item_id`; `recipes` by `recipe_version_id`; `lines` by `line_no`. **Builder: 5 statements** (items; units `DISTINCT ON (stock_item_id, unit_name)` over the current base; prices — the dominance rule as one window query; yields `DISTINCT ON`; versions with `json_agg(lines ORDER BY line_no)`, `ROW_NUMBER() ≤ 4` per recipe over published + superseded, owner filter of B15 (e)).

### 5.4 Wires (`packages/events/src/admin/recipes.ts`)
`RecipeSummaryWire { recipe_id, owner_type, owner_id, owner_name, owner_archived, archived, has_draft, published: { recipe_version_id, version_no, published_at } | null, plate_cost: CostWire }`; `CostWire { status: 'costed'|'partial'|'no_recipe', minor: string | null, unknown_items: string[] }` (`minor` rounded once, half away from zero; `null` for `no_recipe` or when no line is known); `RecipeVersionWire { recipe_version_id, version_no, status, basis, base_qty, batch_yield_qty: string | null, misc_allowance_bp, lines: RecipeLineWire[], cost: CostWire, warnings: { code, line_no? }[], created_by_name, published_by_name, published_at, version }` (`version` for `expected_version`, V13); `RecipeLineWire { line_no, stock_item_id, stock_item_name, kind, unit_name, qty: string, qty_basis, line_cost: CostWire }`; `CoverageWire { items_total, items_with_recipe, pct_bp }`.

---

## §6. Endpoints

Owner routes (JWT, tenant guard, password guard, C4 order). Every route is tenant-wide (`assertTenantWide` / `coversEveryBranch`; one owner covers every branch, 01b B8, 08a I10). `branch_id?` query for costs: C2 assert before SQL; absent = every-branch prices only. Shared failures as 08a §6. Every route in `route-cases.ts` (C7).

**Cost context (⚠️ v0.2 M-13)** = **5 tenant-wide reads**, run once per request and reused by every cost in the response: active stock items; current item units; price rows (`selectPriceCandidates` for `branch_id` and every branch); active yields; every non-archived recipe's published version with lines (`json_agg`). The publish graph read **is** the fifth read.

**Lock order (⚠️ v0.2 M-14, B-1)** for 08b writes:

| # | Kind | Taken by |
|---|---|---|
| 0 | tenant publish lock `pg_advisory_xact_lock(8020, hashtext(tenant_id))` (8020 = 08b's advisory namespace) | §6.5 publish, §6.6 restore of a recipe with a published version — before any row lock and before the graph read |
| 0.5 | `recipes` (`FOR UPDATE`) | §6.4, §6.5, §6.6 target |
| 1 | the option's `modifier_groups` row (`FOR SHARE`) — an option owner is read under its group | §6.3, §6.5 when the owner is a `modifier_option` |
| 4 | `menu_items` (`FOR SHARE`) | §6.3, §6.5 when the owner is a `menu_item` |
| 5 | `stock_items` (`FOR SHARE`): the owner (if a stock item) **and** the line stock items in **one** `= ANY` statement, id order | §6.3, §6.4, §6.5 |
| 10 | `branches` (bump) | §6.5, §6.6 when they bump |

No 01a / 01c / 08a write locks `recipes` or the advisory key (B17's checks read `recipes` / `recipe_lines` without a lock), so 08b's kinds 0 and 0.5 before 01c's kinds 1–10 create no cycle. A B17 owner-edit check (C-14, C-15, P-2) races a recipe create only through the owner row (create takes it `FOR SHARE`, the 01c / 08a write `FOR UPDATE`): one serialises behind the other, and the second sees the first's commit (READ COMMITTED read after its lock).

| § | Route | Audit | Bump |
|---|---|---|---|
| 6.1 | `GET /v1/admin/recipes` | — | — |
| 6.2 | `GET /v1/admin/recipes/:recipe_id` | — | — |
| 6.3 | `POST /v1/admin/recipes` (Idempotency-Key) | `recipe` / `create`, `recipe_version` / `create` (2 rows, one insert) | none |
| 6.4 | `PUT /v1/admin/recipes/:recipe_id/draft` | `recipe_version` / `create` or `update` | none |
| 6.5 | `POST /v1/admin/recipes/:recipe_id/publish` | `recipe_version` / `publish` (new) + `recipe_version` / `update` (superseded, when one existed) | every branch |
| 6.6 | `PATCH /v1/admin/recipes/:recipe_id` | `recipe` / `archive`, `restore` | every branch when the recipe has a published version |

#### 6.1 `GET /v1/admin/recipes` — Recipes page and coverage
Query `branch_id?`, `filter? ∈ all | missing | partial`. Response `{ can_edit_tenant, setting: 'warn', coverage: CoverageWire, rows: RecipeSummaryWire[] }`: one row per **active** sellable menu item, active plain option and active `prepared` stock item (with or without recipe), plus archived owners that have a recipe. Order: owner kind (menu items, options, stock items), then `lower(name)`, id. **9 fixed statements:** coversEveryBranch, menu items, plain options, recipes (all, with draft / published flags) + cost context 5 (active stock items doubles as the prepared-owner list).

#### 6.2 `GET /v1/admin/recipes/:recipe_id`
Response `{ can_edit_tenant, recipe: RecipeSummaryWire, draft: RecipeVersionWire | null, published: RecipeVersionWire | null, history: [{ recipe_version_id, version_no, status, published_at, published_by_name }] (≤ 50) }`. **11 fixed:** coversEveryBranch, recipe, owner row, versions (≤ 50), draft with lines (`json_agg`), owner names (`= ANY`) + cost context 5. Errors `404 RECIPE_NOT_FOUND`, `404 BRANCH_NOT_FOUND`.

#### 6.3 `POST /v1/admin/recipes` (Idempotency-Key)
Body `{ owner_type, owner_id }`. Script: validate → `BEGIN` → key → tenant-wide → owner read `FOR SHARE` (kind 1 group for an option, 4, or 5) → B2 checks → existing recipe for owner (`409 CONFIG_IN_USE`) is answered by the unique index at insert → insert recipe → insert draft v1 (basis per B3; no lines) → audit (2 rows) → key response → prune → `COMMIT`. `201 { data: { recipe: RecipeSummaryWire, draft: RecipeVersionWire } }`. **8 statements.**

| Edge | Answer |
|---|---|
| "Paye Half" (piece) | draft `per_unit` |
| "Chicken karahi by weight" (g) | draft `per_kg`, `base_qty 1000` |
| PAYE-COOKED (prepared) | `per_batch`, `batch_yield_qty` null until set |
| TP-1 (packet) or raw beef (ingredient) | `422 wrong_kind` |
| Linked option "Extra naan" | `422 linked_option` |
| Second recipe for the same owner | `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids: [existing] } }` |
| Retry with the same key | stored `201` replayed |

#### 6.4 `PUT /v1/admin/recipes/:recipe_id/draft`
Body `{ expected_version: string | null, base_qty?, batch_yield_qty?, misc_allowance_bp?, lines: [{ stock_item_id, unit_name, qty, qty_basis? }] }` (`null` = no draft exists; creates version `max + 1`). Script: validate → `BEGIN` → tenant-wide → lock recipe `FOR UPDATE` (`404 RECIPE_NOT_FOUND`; archived → `422 archived`) → `afterRecipeLock` hook → draft read (`409 CONFIG_STALE`) → basis / negative checks (`422`, m-7) → line stock items `FOR SHARE` (`= ANY`, kind 5; `not_found` / `archived`) → their item units → their active yields (M-7 default) → `resolveUnit` per line on the locked `stock_unit`, freeze, range check → upsert draft version → delete draft lines → insert lines (one multi-row) → audit → `COMMIT`. `200 { data: { draft: RecipeVersionWire } }` with B6 warnings and the draft's cost. **16 statements:** 10 for the write (tenant-wide, lock, draft read, line stock items, units, yields, upsert, delete, insert, audit) + 6 for the response (owner names + cost context 5). No bump.

| Edge | Answer |
|---|---|
| "Tawa piece": beef 250 g (beef has a yield), TP-1 15 g, oil 20 ml, onion 30 g (no yield), makhan 10 g | `200`; beef EP, onion / oil / makhan AP with `no_yield_defaulted_ap` on onion and oil (ingredients without yield); TP-1 AP |
| Explicit EP on onion with no yield | `200`; warning; cost `partial` (D9) |
| Line `ghee 0.92 l` on ghee in g with `l` = 920 g | frozen 846.4 g = 4232 / 5 |
| Line `-30 g onion` on plain option "No onion" | `200` |
| Negative on a menu-item recipe | `422 negative_not_option` |
| `batch_yield_qty` on a `per_unit` recipe | `422 basis_mismatch` |
| Same stock item twice | `400` |
| Stale tab | `409 CONFIG_STALE` |

#### 6.5 `POST /v1/admin/recipes/:recipe_id/publish`
Body `{ expected_version }`. Script: validate → `BEGIN` → tenant-wide → **publish lock (kind 0)** → `afterPublishLock` hook → lock recipe `FOR UPDATE` (archived → `422`) → draft with lines (`409 CONFIG_STALE` when none / stale) → owner row `FOR SHARE` (kind 1 / 4; a stock-item owner is read in the next statement) → owner (if stock item) + line stock items `FOR SHARE` (kind 5, one statement) → **graph read** (cost-context read 5: every non-archived published version with lines) → B6 (basis vs current owner, yield, archived lines, frozen units, empty, cycle / depth over the whole graph with this version in place) → old published → `superseded` → draft → `published` (`published_at = now`) → audit (1 or 2 rows, one insert) → bump every branch (2) → `COMMIT`. `200 { data: { published: RecipeVersionWire } }`. **Statements (exact):** write = tenant-wide, publish lock, recipe lock, draft with lines, owner row (menu item, or the option's group; none for a stock-item owner, which is read with the line stock items), stock items, graph, supersede, publish, audit, bump 2 = **12** (**11** for a stock-item owner); response = owner names + stock items, units, prices, yields of the cost context (its versions read is the graph read) = **5**. Total **17**, **16** for a stock-item owner; −1 each when no published version existed (no supersede): **16 / 15**.

| Edge | Answer |
|---|---|
| PAYE-COOKED batch: 40 paye AP (kg via peti), ghee, onion, adrak-lehsan, 2 × PY-1 (packet, AP), yield 160 pieces | `200`; cost per piece = batch cost ÷ 160 (no misc on the batch when used as a line, B5) |
| PAYE-COOKED uses QEEMA-COOKED which uses PAYE-COOKED | `422 cycle` |
| Menu item → A → B → C → D (prepared) | `422 too_deep` |
| Publishing C (C → D) where M → A → B → C already exists | `422 too_deep` (the whole graph is checked, M-3) |
| Two tabs publish PAYE-COOKED (→ QEEMA) and QEEMA-COOKED (→ PAYE) at once | one `200`, the other waits on the publish lock and then `422 cycle` (test 16) |
| Option "Spicy" with no lines | `200`, costs 0, `costed` (M-6) |
| `per_kg` with no main AP line near `base_qty` | `200` with warning `main_line_off` (R7) |
| Line stock item's unit changed since the draft save | `422 unit_changed` |
| Publish twice with the same version | second `409 CONFIG_STALE` |

#### 6.6 `PATCH /v1/admin/recipes/:recipe_id`
Body `{ expected_version, archived }` (recipe-level version, V13; R7: no `visibility_scope`). No-op `200`, no audit, no bump. **Archive:** tenant-wide, lock recipe, write, audit, bump 2 when it had a published version = **6** (4 without). Archiving never breaks the graph (it only removes nodes). **Restore** of a recipe with a published version: tenant-wide, **publish lock (kind 0)**, lock recipe, graph read, cycle / depth check with the recipe back in place (`422 { field: 'archived', reason: 'cycle' \| 'too_deep' }`, M-3), write, audit, bump 2 = **8**; without a published version = 4. Owner-archived recipes may be restored (the owner stays archived).

---

## §7. Cross-cutting
Logging as 08a AD-11 (no explicit write log). Performance: tens of menu items, a few hundred lines; the cost context is 5 reads; owner pages < 300 ms p95 locally. **Snapshot growth** (⚠️ v0.2 m-15): measured, not guessed — the S48 gzip e2e fixture (5 000 items) gains an inventory key with 200 stock items, 30 days of daily market rates (dominance keeps ~1–2 rows per item), 300 recipes × 4 versions; the test asserts the gzip size bound of S48 and the statement bound. Risks: (1) partial costs read as real — the `partial` badge and "unknown items" always show; (2) a wrong recipe quantity skews everything — the editor shows each line's cost and the plate cost live; (3) the no-yield AP default hides a forgotten test cut — the `no_yield_defaulted_ap` warning shows on each such line.

---

## §8. Client contract (owner app)
1. **Recipes page** (new `features/owner/recipes/RecipeList.tsx`): coverage line ("38 of 52 items have a recipe — 73 %"), filter All / Missing / Partial, rows grouped Menu items · Options · Prepared, each with **Plate cost (menu cost)** (`CostWire`: "Rs 412", "Rs 380 · partial", "No cost yet · partial", "No recipe"), branch picker.
2. **Recipe editor** (`RecipeEditor.tsx`): owner header, basis fields per §3.2 (batch yield "makes 160 piece"), misc allowance %, line table (stock item search across kinds, quantity + unit pick-list from `resolveUnit`-accepted units, AP / EP toggle showing the derived default), live line cost and plate cost, warnings, **Save draft** / **Publish** / history.
3. **Menu page badge** (01c item list): "No recipe" on every active item without a published recipe (data from §6.1, C-12; 9 statements accepted for the pilot, m-17).
4. Labels per 08a I12. Urdu strings to the urdu-todo list.
5. 01c / 08a forms show the B17 `409 { entity: 'recipe' }` text with a link to the recipe ("archive the recipe first").

---

## §9. Error catalogue additions
New code **`RECIPE_NOT_FOUND`** (404). New `details`: `422 CONFIG_REFERENCE_INVALID` reasons `linked_option`, `basis_mismatch`, `negative_not_option`, `batch_yield_missing`, `unit_changed`, `cycle`, `too_deep`, `empty`, `qty_out_of_range` (and existing `not_found`, `archived`, `not_convertible`, `wrong_kind` on new fields); `409 CONFIG_IN_USE` `used_by.entity: 'recipe'`.

---

## §10. Tests

### 10.1 Pure (`packages/domain/src/inventory/costing.test.ts`)
| # | Case |
|---|---|
| 1 | Line cost: beef 250 g EP, Rs 1,500 / kg, yield 7 120 → exact fraction; AP line with no yield divides by 1 |
| 2 | Missing price → line unknown, `partial`, value = known lines; EP ingredient line with no yield → `partial` (never yield 1); EP on packet / prepared → no division; all lines unknown → `minor: null` |
| 3 | Misc 500 bp at the top recipe only: Paye Half over PAYE-COOKED applies it once (B5); `explodeUsage` never applies it |
| 4 | Produced item: PAYE-COOKED batch cost ÷ 160 pieces; "Paye Half" uses it; a `partial` batch makes Paye Half `partial`; packet costs by menu price |
| 5 | `per_kg`: recipe for 1 000 g; sale 1 250 g → × 5/4; option on a g parent costs once per line; on a piece parent × parent qty (`childQuantity`) |
| 6 | `plateCost` deal = Σ parts; one part `no_recipe` + others costed → deal `partial`; every part `no_recipe` → `no_recipe`; plain option without recipe → +0, `partial`; `recipe_version_ids` returned for item and options |
| 7 | B7 cap in AP stock units after yield: "No onion" −30 g on a parent with 20 g direct onion → −20 g; on a parent with onion only inside QEEMA-COOKED → 0; per parent unit × parent qty |
| 8 | `explodeUsage` with per-line version ids: EP → AP by yield; prepared always exploded; packet never; unknown yield → `partial`; a version id absent from inputs → that part `partial` |
| 9 | Round once, half away from zero: +0.5 → 1, −0.5 → −1; summing rounded lines never used |
| 10 | **Never throws** (B-1): inputs with a cycle and with depth 4 → `recipeCost`, `plateCost`, `explodeUsage`, `explodeStockItem` return `partial` |
| 11 | `explodeStockItem`: 14 pieces PAYE-COOKED → 14/160 of each batch line in stock units; through a prepared sub-item; depth 4 dropped, `partial` |

### 10.2 Cloud routes (`apps/cloud/test/recipes/*.int.test.ts`)
| # | Case |
|---|---|
| 12 | §6.4 edges table; M-7 AP default with `no_yield_defaulted_ap`; frozen ghee quantity; range `422 qty_out_of_range`; 16 statements; stale `409` |
| 13 | §6.3 owner kinds and edges (packet `wrong_kind`); 8 statements; 2 audit rows; replay |
| 14 | §6.5 publish: `superseded` / `published`; immutability (grep test: no UPDATE of non-draft lines, as 08a #34); 17 / 16 / 15 statements |
| 15 | §6.5 refusals (each reason incl. archived recipe); empty option recipe `200` `costed`; warnings (EP-in-batch, `no_yield_defaulted_ap`, no price, `main_line_off` only when units match) |
| 16 | **B-1 race:** two publishes forming a cycle, both started after `afterPublishLock` holds the first → exactly one `200`, the other `422 cycle`; the published graph is acyclic after both commit |
| 17 | §6.5 bump: every branch +1 |
| 18 | §6.6 archive (6 / 4); restore with published under the publish lock (8): restore that closes a cycle → `422 { field: 'archived', reason: 'cycle' }` (M-3 scenario b); no-op |
| 19 | §6.1 coverage by count (variants count, options / stock items do not, archived recipes do not); rows; 9 statements; `branch_id` foreign `404` |
| 20 | §6.2 detail; 11 statements |
| 21 | Audit rows per route (one per entity); cross-tenant sweep (C7) |
| 22 | B17: C-11 stock-item archive / `stock_unit` with a non-archived line → `409`; archived recipe → `200`; C-14 `sale_unit` change of an owner → `409`; C-15 plain → linked → `409`; P-2 `kind` change of a prepared owner → `409`; each `200` after the recipe is archived |

### 10.3 Snapshot and bump (`apps/cloud/test/config-sync/inventory-key.int.test.ts`)
| # | Case |
|---|---|
| 23 | Key contents for Lake City: active items, current units, non-dominated prices (latest manual; a newer market rate expiring later; a dominated older rate absent), active yields, published + ≤ 3 superseded versions of menu-item / option / prepared owners; drafts absent; a raw-SQL recipe owned by a packet absent (backstop) |
| 24 | Typed `InventorySnapshotSchema` parses every built key (strict, builder side) |
| 25 | Builder ≤ 28; sync config-only ≤ 33, with directory ≤ 40 (01b row); S48 gzip e2e with the key within its size bound |
| 26 | B16: unit / yield / every-branch price POST bump every branch; branch market rate bumps one; draft save, create, archive of a never-published recipe bump none; stock-item PATCH of `is_a_item` bumps (08a #9 updated) |
| 27 | **Hash stability (M-2):** two builds of one version, the second after a market rate's `valid_until_at` → equal hash. **Hub (M-5):** a body whose `inventory` fails the typed schema still applies (`branch_config` updated, no `schema_invalid`); a body without the key parses |
| 28 | No hub projection reads the key (grep); engine / 02b suites unchanged |
| 33 | **Release (M-1):** after `0019` migrates, `GET /v1/sync/config` with the pre-migration version returns `200` with `inventory` |

### 10.4 Races (`apps/cloud/test/recipes/races.int.test.ts`, ⚠️ v0.2 M-14)
| # | Case |
|---|---|
| 34 | Draft save ∥ stock-item archive of a line item: `409 { entity: 'recipe' }` or `422 archived`, never both committed |
| 35 | Publish ∥ `stock_unit` change of a line item: `422 unit_changed` or `409 CONFIG_IN_USE`, never a published line with a stale frozen unit |
| 36 | Publish ∥ §6.6 archive of the same recipe: serialised on `recipes`; result is either published-then-archived or `422 archived` |

### 10.5 Client
| # | Case |
|---|---|
| 29 | Recipes page coverage text, filters; `partial` / "No cost yet · partial" / "No recipe" (never "Rs 0" for a missing cost) |
| 30 | Editor: unit pick-list; AP / EP derived default shown; live cost; publish errors mapped |
| 31 | Menu badge "No recipe" |
| 32 | Labels: "Plate cost (menu cost)"; no "today's cost" string; B17 `409` text links the recipe |

### 10.6 Acceptance
| Source | Check | Test |
|---|---|---|
| 08-g0 §7 drill 2: Half paye, tawa piece, anda tikki, 1 kg karahi, paper vs system to Rs 1 | fixtures with the owner's paper figures; `plateCost` rounded = paper | 4, 5, 9 + `[08b drill 2]` (filled when the owner gives the figures, OQ-1) |
| §3.7 validation | B6 | 12, 15, 16, 18 |
| §3.8 formulas | B9, B10 | 1–6 |
| D9 | partial, never 0 | 2, 29 |
| Owner contract | `explodeStockItem`, per-line versions | 8, 11 |

---

## §11. Build order
**Start after `module-08a` merges into `main`** (⚠️ v0.2 m-13: 08a's price POST and `selectPriceCandidates` must exist).
1. Migration `0019_recipes.sql` + audit CHECKs (A-5) + release bump (A-6) — schema test, test 33.
2. `@pos/domain/src/inventory/costing.ts` — tests 1–11.
3. Snapshot: `InventorySnapshotSchema`, V4 `inventory: z.unknown().optional()`, builder 5 reads reusing `selectPriceCandidates`, bounds (A-3, A-4, B-x) — tests 23–25, 27, 28.
4. Bump rule on 08a routes and stock-item PATCH (P-1, A-2′) — test 26.
5. Recipes module `apps/cloud/src/modules/recipes/`: §6.3, §6.4; hooks `afterRecipeLock`, `afterPublishLock` in `apps/cloud/src/server.ts` `CloudTestHooks` (⚠️ v0.2 m-14) — tests 12, 13.
6. §6.5 publish (lock 0, whole-graph check) — tests 14–17.
7. §6.6 — test 18.
8. §6.1, §6.2 (cost context) — tests 19, 20.
9. B17 guards: C-11, C-14, C-15, P-2 — test 22.
10. Audit + route cases + races — tests 21, 34–36.
11. Owner app: Recipes page, editor, badge, B17 texts — tests 29–32.

11 tasks, 6 routes: inside the size budget.

---

## §12. DoD, checklist, open questions, deferred

### 12.1 Definition of Done
Tests 1–36 green; hub, engine, 02b suites unchanged; drill 2 acceptance green with the owner's paper numbers; §4.5 rows applied at the fold into `08_Inventory_Costing_Spec`.

### 12.2 Endpoint checklist
| § | Route | Codes |
|---|---|---|
| 6.1 | GET recipes | 200, 400, 401, 403, 404 |
| 6.2 | GET recipes/:id | 200, 400, 401, 403, 404 |
| 6.3 | POST recipes | 201, 400, 401, 403, 409, 422 |
| 6.4 | PUT …/draft | 200, 400, 401, 403, 404, 409, 422 |
| 6.5 | POST …/publish | 200, 400, 401, 403, 404, 409, 422 |
| 6.6 | PATCH recipes/:id | 200, 400, 401, 403, 404, 409, 422 |

### 12.3 Open questions (owner) — renumbered (⚠️ v0.2 m-19)

| # | Question | Default |
|---|---|---|
| OQ-1 | Drill 2 paper numbers (Half paye, tawa piece, anda tikki, 1 kg karahi): when? They become the acceptance test | Before build task 2 |
| OQ-2 | Snapshot shape: cost **inputs** (B15) rather than precomputed costs | Inputs (v0.1 default, review ✓) |
| OQ-3 | B16: every price / unit / yield write bumps (hub refetch). Fine for one pilot branch? | Yes |
| OQ-4 | B5: misc allowance only at the top recipe of a sale line (not again on a batch used as a line) — or compound per level? | Top only |
| OQ-5 | B11 / §4.3: a day's usage uses the versions stored per line, kept in the snapshot up to 3 republishes back; beyond that the line is `partial` — OK? | Yes |
| OQ-6 | As built in 08a: `displayPer`, `reduceFraction`, `selectPriceCandidates` exported (not in 08a §4.2); record as 08a as-built at the fold | Accept |

### 12.4 Deferred until needed
Packet / CK recipes, `visibility_scope`, `ck_only`, a CK hub (D10, R7); `require_recipe_for_menu` as a setting, `off` and `block` (R7, C9); `kg_basis: 'served'`, `is_garnish`, `scale_with_parent`, parents-missing-removal lists (R7); deal cost range and suggested price / MFC (R39 (e)); restatement / backdated recipes (`SaleCostRestated`); batch-learned yields (`ProductionBatchRecorded`); prep instructions, plating photo, utensil, accompaniments; `derived_from_recipe_id`; coverage by revenue in the cloud (needs 06); per-supplier yields; a cheaper menu-badge read (m-17).
