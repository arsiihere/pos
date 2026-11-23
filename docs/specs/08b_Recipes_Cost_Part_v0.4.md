# 08b — Inventory & Costing: recipes + cost engine — Module Spec part v0.4 (DRAFT)

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
| B11 | **Usage explosion** (pure, non-throwing). `explodeUsage(inputs, line: SaleLineUsage)` takes a sale line **with the recipe version ids recorded for it** (item and each option; ⚠️ v0.2 M-8) and returns `{ usage: Map<stock_item_id, Fraction /* stock units, as purchased */>, status }`: EP ingredient lines ÷ yield (AP = EP ÷ yield; unknown yield → that item is left out and `status = 'partial'`); `prepared` lines explode through their published batch recipe (÷ `batch_yield_qty`) — **always, no `stopAt`** (⚠️ v0.2 contract); `packet` lines never explode (they are stock); negative option lines capped per B7; **misc never applied** (B5); a version id not in the inputs (⚠️ v0.3 owner ruling OQ-5: more than 3 republishes back) → that part `partial`; a frozen unit ≠ the item's current one → that line `partial` (N-1 backstop); cycle / depth > 3 → that branch dropped, `partial`. `explodeStockItem(inputs, preparedStockItemId, qty: bigint)` explodes a quantity of a `prepared` item, **in that item's own stock unit** (pieces of PAYE-COOKED, plates of biryani), by the same rules: raw = qty × line ÷ `batch_yield_qty`; a prepared item with no published recipe in the inputs → `{ usage: empty Map, status: 'partial' }` (⚠️ v0.3 N-6) (contract text §4.2). Yields used are those in the inputs (the snapshot applied at the time 08c runs) | 08-g0 §3.9, §3.12 | 08-g0 "yields effective at sale time" → the applied snapshot's (pilot simplification, like C6; restatement POST) |
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
| A field that does not apply to the basis derived from the locked owner (B3; `base_qty` off `per_measure`, `batch_yield_qty` off `per_batch`); a negative qty off an option recipe | draft save, after the owner read (⚠️ v0.4 T-1) | `422 { field, reason: 'basis_mismatch' \| 'negative_not_option' }` (⚠️ v0.2 m-7) |
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
| `@pos/domain` `inventory/costing.ts` | `type Fraction = { num: bigint, den: bigint }`. `type CostInputs` = items, current units, price rows, active yields, recipe versions by id, `publishedByOwner: Map<'menu_item:<id>' \| 'modifier_option:<id>' \| 'stock_item:<id>', recipeVersionId>`, `dropped: number`; built by **`buildCostInputs(source: unknown /* the snapshot's inventory key */ \| CloudCostRows)`** — element-wise parse with `InventoryElementsLenient` (⚠️ v0.4 t-5), bad elements dropped and counted, unknown item fields ignored, each snapshot price row's `created_at` replaced by its per-item rank (⚠️ v0.4 t-1), archived recipes' versions kept by id but not in `publishedByOwner` (⚠️ v0.4 t-7) (⚠️ v0.3 N-4, N-6, n-1). `type CloudCostRows` = the five cost-context row sets of §6, as the cloud repository returns them (⚠️ v0.3 n-7). `recipeCost(inputs, recipeVersionId, branchId, nowMs, { top: boolean }) → { value: Fraction, status: 'costed' \| 'partial', unknown: string[] }`. **`stockItemUnitCost(inputs, stockItemId, branchId, nowMs) → { per_stock_unit: Fraction, source: 'menu' \| 'recipe' } \| null`** — B9 (a)–(c); `null` = unknown, never 0; `source: 'recipe'` for a prepared item costed through its batch recipe (⚠️ v0.3 N-6). `plateCost(inputs, line: SaleLineShape, branchId, nowMs) → { value: Fraction, status: 'costed' \| 'partial' \| 'no_recipe', known: boolean /* ⚠️ v0.4 t-6 */, recipe_version_ids: { item: string \| null, options: { option_id: string, recipe_version_id: string \| null }[] } }` (⚠️ v0.2 M-8). **`dealCost(parts: { value: Fraction, status: 'costed' \| 'partial' \| 'no_recipe', known: boolean }[]) → { value: Fraction, status, known }`** (B10 deal rule; ⚠️ v0.3 N-5; ⚠️ v0.4 t-6). `explodeUsage(inputs, line: SaleLineUsage) → { usage: Map<string, Fraction>, status: 'costed' \| 'partial' }` with `SaleLineUsage = SaleLineShape & { recipe_version_ids }` (the ids `plateCost` returned and 08c stored). **`explodeStockItem(inputs, preparedStockItemId: string, qty: bigint /* stock units of the prepared item */) → { usage: Map<string /* stock_item_id */, { num: bigint, den: bigint }>, status: 'costed' \| 'partial' }`** — through the item's published `per_batch` recipe, raw = qty × line ÷ `batch_yield_qty`, recursing through prepared sub-items, depth ≤ 3; a cycle or depth > 3 never throws: that branch is dropped and `status = 'partial'`; a prepared item with no published recipe → empty `usage`, `partial`; `qty` is a `bigint` (08d passes `1n`) (⚠️ v0.2 M-9, owner contract; ⚠️ v0.3 N-6). `SaleLineShape = { kind: 'item', item_id, quantity: bigint, sale_unit: 'piece' \| 'g' \| 'ml', deal_qty?: bigint, options: { option_id, quantity: bigint }[] }` — ⚠️ v0.3 N-5: **no deal arm**; a deal part is an item line; ⚠️ v0.4 t-3: `deal_qty` set on a deal-part line (the deal's quantity), used as the plain-option multiplier on a g / ml part. Quantities are bigints; the call to 01c `childQuantity(optionQty: number, parentQty: number, parentSaleUnit)` converts them with `Number()` at that boundary (both ≤ 10^6, 01c) (⚠️ v0.3 n-7). None of these throws | 08c (sale cost, `OrderCosted`, `theoreticalUsage`), 08d (**`explodeStockItem` only**, with `buildCostInputs`; ⚠️ v0.4 T-4: an A-item's menu cost comes from 08a's functions, not `stockItemUnitCost`), owner app (`stockItemUnitCost` for line costs) |
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
| P-3 | **08a part** I3, I4 name rule, §4.2, test **#1** | ⚠️ v0.3 owner ruling: `BUILTIN_UNITS` gains **`lb`** = 45 359 237 / 100 000 g and **`oz`** = 45 359 237 / 1 600 000 g (exact; built-ins are domain constants, not DB rows, so `stock_item_units`' `factor_den ≤ 10^6` does not bind them); I4: `lb` / `oz` cannot be an item unit on a g item (they resolve already) and may be on a piece item; test #1 adds both, in numbers (⚠️ v0.4 t-8 b): "Rs 1 000 per lb → per g = 1 000 × 100 000 / 45 359 237 minor"; ⚠️ v0.4 t-8 (a): an existing item unit named `lb` / `oz` (allowed before P-3) keeps resolving with the owner's own factor (I5 step 2: item unit before built-in) — no migration; no gallon | owner |
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
Body `{ owner_type, owner_id }`. Script: validate → `BEGIN` → key → tenant-wide → owner read `FOR SHARE` (kind 1 group for an option, 4, or 5) → B2 checks → `INSERT INTO recipes … ON CONFLICT (tenant_id, owner_type, owner_id) DO NOTHING RETURNING recipe_id` → **0 rows**: read the existing recipe's id and answer `409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids: [existing] } }` (the transaction is not aborted, so the read works; ⚠️ v0.3 n-2) → insert draft v1 (basis per B3; no lines) → audit (2 rows) → key response → prune → `COMMIT`. `201 { data: { recipe: RecipeSummaryWire, draft: RecipeVersionWire } }`. **8 statements**; ⚠️ v0.4 t-2: the conflict path **7** (key, tenant-wide, owner, insert 0 rows, existing-id read, stored `409` key response, prune — no draft insert, no audit).

| Edge | Answer |
|---|---|
| "Paye Half" (piece) | draft `per_unit` |
| "Chicken karahi by weight" (g) | draft `per_measure`, `base_qty 1000` (per kg) |
| "Lassi by volume" (ml) | draft `per_measure`, `base_qty 1000` (per litre) (⚠️ v0.3 owner ruling) |
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
| 8 | `explodeUsage` with per-line version ids: EP → AP by yield; prepared always exploded; packet never; unknown yield → `partial`; a version id absent from inputs → that part `partial` |
| 9 | Round once, half away from zero: +0.5 → 1, −0.5 → −1; summing rounded lines never used |
| 10 | **Never throws** (B-1): inputs with a cycle and with depth 4 → `recipeCost`, `plateCost`, `explodeUsage`, `explodeStockItem`, `stockItemUnitCost` return `partial` / `null`; ⚠️ v0.3 N-4: `buildCostInputs` on a key with one element of an unknown `kind` and one malformed price row → `dropped = 1`, the unknown-kind element kept as a string (⚠️ v0.4 t-5: `InventoryElementsLenient`) and treated unknown; every other line costed |
| 11 | `explodeStockItem`: 14n pieces PAYE-COOKED → 14/160 of each batch line in stock units; **6n plates BIRYANI-COOKED (`piece`, batch 40 plates) → 6/40 of rice, chicken, ghee** (⚠️ v0.3 owner ruling); through a prepared sub-item; depth 4 dropped, `partial`; a prepared item with no published recipe → empty usage, `partial` (N-6) |

### 10.2 Cloud routes (`apps/cloud/test/recipes/*.int.test.ts`)
| # | Case |
|---|---|
| 12 | §6.4 edges table; M-7 AP default with `no_yield_defaulted_ap`; frozen ghee quantity; range `422 qty_out_of_range`; ⚠️ v0.4 T-1 / t-4: 17 statements (16 for a stock-item owner); owner read `FOR SHARE` before the line stock items (statement log); `measure_unit` frozen from the locked owner; draft on an archived recipe `200`; stale `409` |
| 13 | §6.3 owner kinds and edges (packet `wrong_kind`; lassi `per_measure` ml; biryani `per_batch`); 8 statements; ⚠️ v0.4 t-2: conflict path **7** with `ids: [existing]` read after `ON CONFLICT DO NOTHING`, no audit; 2 audit rows on the normal path; replay |
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
| 36 | Publish ∥ §6.6 archive of the same recipe: serialised on `recipes`; result is either published-then-archived or `422 archived` |
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
