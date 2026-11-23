# 08b Recipes + cost engine — build board

Plan: `08b-plan.md`. Spec: `docs/specs/08_Inventory_Costing_Spec_v1.1.md` **Part B** (APPROVED 2026-11-24), with Part A P-1 – P-3, 01a v2.9 (A-2′ – A-6), 01b v1.10.4 (B-x), 01c v1.3 (C-11 – C-16), foundation v1.16 §6.2 (F-1). Integration branch: `module-08b`. Only the integrator (orchestrator session) edits this file.

> **Status (owner summary, newest first):**
> - 2026-11-24: `module-08b` cut from `main` @ `325903dd` (PR #477 merged, gate green on that commit). P0.0 gap sweep done: **one spec–code contradiction (G-1, package graph) — owner ruled (a)**; the other gaps are small and recorded as AD-1 – AD-17 with the plan's Rec applied. Phase 0 (P0.1 – P0.5) built, one PR (AD-10).

## Gates

| Check | State |
|---|---|
| `spec/08b-approved` (#477) on `main` | **merged** → `module-08b` = `main` @ `325903dd` |
| Cloud migration number | `0018_inventory_config` last on `main` → **0019** |
| `module-*` ruleset | PR only, rebase merge, required check `gate`, no force push, no delete |
| Parallel cloud tests | every cloud test file truncates the shared `pos_test` DB (`restaurantFixture` → `truncateAll`), so each lane worktree runs with its own `DATABASE_URL=…/pos_test_<task>` (created by the integrator); CI is unaffected |
| Cloud session pnpm | the VM's global pnpm 10 self-switches and races under turbo ("Exec format error"); exact pnpm 12.15.0 installed to `/root/.pnpm12/bin`, put first on `PATH` for every session / subagent |
| Labels | `lane:08b-0`, `lane:08b-S`, `lane:08b-R`, `lane:08b-G`, `lane:08b-T`, `lane:08b-U` |

## P0.0 gap sweep (2026-11-24, `main` @ `325903dd`)

| Name (plan / spec) | Found | Note |
|---|---|---|
| `selectPriceCandidates` | `apps/cloud/src/modules/inventory/repository.ts:135` (as-built) and `menu-variants/repository.ts:253` (08a AD-7's second copy) | ✓ the cost context uses the `inventory/` one (B§4.1) |
| `effectiveMenuPrice`, `pricePerStockUnit`, `displayPer` | `packages/domain/src/inventory/prices.ts:32`, `:21`, `:55` | ✓ |
| `resolveUnit`, `toStockUnits`, `reduceFraction`, `BUILTIN_UNITS` | `packages/domain/src/inventory/conversions.ts:57`, `:73`, `:44`, `:13` | ✓ `reduceFraction` throws on a negative num → **AD-5**; P-3 changes the 08a detail wire → **AD-3** |
| `activeYield` | `packages/domain/src/inventory/yield.ts:22` | ✓ |
| `childQuantity` | `packages/domain/src/menu-lines.ts:32` | ✓ throws on non-safe / negative input → wrapped (never-throw) |
| `assertTenantWide`, `coversEveryBranch`, `bumpEveryBranch`, `bumpConfigVersion` | `apps/cloud/src/lib/config-version.ts:68`, `:55`, `:76`, `:13` | ✓ |
| `withIdempotency` | `apps/cloud/src/lib/idempotency.ts:43` | ✓ |
| `writeConfigAudit` | `apps/cloud/src/lib/config-audit.ts:59` | ✓ |
| `CloudTestHooks` | `apps/cloud/src/server.ts:40` | ✓ `afterStockItemLock` exists (08a); P0.5 adds `afterRecipeLock`, `afterPublishLock` |
| builder reads | `apps/cloud/src/modules/config-sync/builder.ts:105` (`buildSnapshotBody`) | config-sync has **no `repository.ts`** → **AD-1** |
| builder / sync bounds | `builder.int.test.ts:384`, `:395` (≤ 23); `sync-config.int.test.ts:58` (≤ 28); `sync-gzip-e2e.int.test.ts:84`, `:149` (≤ 35), `:166` (≤ 28) | ✓ as A-4 |
| `BranchConfigSnapshotSchemaV4` | `packages/events/src/config.ts:418` | ✓ |
| 01c `patchMenuItem` (§6.5) | `apps/cloud/src/modules/restaurant/service.ts:1865` | ✓ (in `restaurant/`, as the plan's g1 row says) |
| 01c `patchStockItem` (§6.8, + 08a R4) | `apps/cloud/src/modules/menu-variants/service.ts:452`; R4 `kindAway` at `:484` | ✓ s2 and g1 both edit it → **AD-11** |
| 01c §6.12 option patch | `patchModifierGroup`, `menu-variants/service.ts:777` | ✓ |
| owner-app menu page | `apps/client/src/features/owner/menu/MenuView.tsx` | ✓; B17 texts live in other forms → **AD-9** |
| `api/cloud-admin.ts`, i18n | `apps/client/src/api/cloud-admin.ts`; `apps/client/src/i18n/{en,ur}.ts` | ✓ |
| `route-cases.ts` | `apps/cloud/test/helpers/route-cases.ts`; `cross-tenant.int.test.ts:159` and `route-inventory.int.test.ts:110` need a case for **every** registered route | → **AD-2** |
| live `config_audit` CHECKs | entity: last writer `0018_inventory_config.sql:65`; action: last writer `0006_menu_variants.sql:144` | ✓ 0019 re-states both + the new values |
| migration tests | older migration tests pin `config_version` after the whole folder | → **AD-4** |
| `@pos/domain` deps | **no dependencies** (no zod); `@pos/events` depends on `@pos/domain` | → **G-1** |

## Gaps that need the owner (G)

| # | Gap | Options | Ruling |
|---|---|---|---|
| G-1 | **Package graph vs B§4.2 / B15 (c) / t-5.** The spec puts `buildCostInputs` in `@pos/domain` and has it parse "with `InventoryElementsLenient`", which it exports from `@pos/events`. `@pos/events` depends on `@pos/domain`, and `@pos/domain` has no dependencies (no zod), so the domain cannot import that schema | **(a) Rec, built:** `buildCostInputs` runs the same element checks by hand (no zod); `@pos/events` exports `InventoryElementsLenient` as zod schemas; a test (`packages/events/src/config-inventory.test.ts`, "[08b AD-12]") pins that both keep and drop exactly the same elements. No signature or behaviour changes. **(b)** `@pos/domain` gets a zod dependency and the lenient schemas live there, re-exported by `@pos/events`. **(c)** `buildCostInputs` takes the lenient set as a parameter (a signature change) | **(a)**, owner 2026-11-24 → AD-12. Spec patch for Z1 (08 v1.1.1): §4.2 / t-5 "`buildCostInputs` runs the lenient element checks itself; `InventoryElementsLenient` (`@pos/events`) is the same set as zod, pinned by a test" |

## As-built decisions (AD): small gaps, plan Rec applied

| # | Gap | Ruling applied | Task |
|---|---|---|---|
| AD-1 | `config-sync/` has no `repository.ts` (the plan's s1 row names one) | s1 **creates** `apps/cloud/src/modules/config-sync/repository.ts` for the 5 inventory reads incl. `selectSnapshotPrices` | s1 |
| AD-2 | `ROUTE_CASES` must name every registered route, or the gate's cross-tenant / route-inventory tests go red (08a AD-3) | r1–r4 each add **their own route's** `ROUTE_CASES` entry; r1 adds `recipeId` to `BIds` and seeds one tenant-B recipe in `cross-tenant.int.test.ts` (seed lines only); r5 keeps the C7 sweep assertions and the audit tests | r1–r5 |
| AD-3 | P-3 adds `lb` / `oz` to `BUILTIN_UNITS`, so the 08a detail wire's `builtin_units` for a g item gains them; `inventory/detail.int.test.ts:198` pins the list | P0.3 adds the two entries to that expected list (marked "⚠️ 08b v1.0 P-3 (AD-3)"); no logic change (08a G-1 / AD-5 precedent) | P0.3 |
| AD-4 | `0019`'s release bump (A-6) moves the `config_version` the older migration tests pin after running the whole folder | P0.2 updates the pinned values (engine-config, zones, kds-settings, part-times, max-delay, 08a #27 incl. its audit-CHECK lines), each marked "⚠️ 08b v1.0 A-6" / "A-5" (precedent: PT-1, MD-3 edits) | P0.2 |
| AD-5 | 08a `reduceFraction` refuses a negative numerator; removal lines are negative (B4, B7) and the engine must never throw | `costing.ts` keeps its own sign-aware fraction helpers; 08a's file unchanged | P0.3 |
| AD-6 | s1's builder reads the recipe tables, so a test that builds snapshots on a scratch DB at 18 (`billing-settings.int.test.ts:123`) must move to 19 (08a AD-6 precedent) | s1 may change that line (and any like it) to `scratchDatabaseAt(19)` with a marker | s1 |
| AD-7 | Test 33 says "returns `200` with `inventory`", but the key exists only after s1 | P0.2 asserts the bump and the `200` with a new snapshot; s1 adds the `inventory` presence assertion for test 33 in `inventory-key.int.test.ts` | P0.2, s1 |
| AD-8 | Snapshot tests that pin the whole body / top-level keys change when the builder always adds `inventory` | s1 makes minimal expected-value edits only (08a G-1 precedent), each marked "⚠️ 08b A-3", listed in its PR | s1 |
| AD-9 | B§8 item 5 (B17 `409 { entity: 'recipe' }` text with a link) lives in the 01c / 08a forms, not in `features/owner/menu/` | u1 may edit the error-mapping lines of `stock-items/StockItemForm.tsx`, `choice-groups/ChoiceGroupForm.tsx` and `menu/ItemForm.tsx` | u1 |
| AD-10 | Phase 0 = 6 tasks on the integrator's one branch | one PR into `module-08b` with **one commit per task** (rebase merge keeps them), one CI wait (08a #463 precedent); P0.2 and P0.3 (HIGH) get two fresh reviewers each | P0 |
| AD-11 | s2 (bump on the 08a stock-item PATCH) and g1 (C-11 / P-2 guards) both edit `menu-variants/service.ts` `patchStockItem` | the second to merge rebases; no logic overlap (bump vs refusal) | s2, g1 |
| AD-12 | **G-1 ruled (a)** (owner 2026-11-24) | `buildCostInputs` hand-checks; `InventoryElementsLenient` zod; pin test. The lenient set also refuses a zero in a dividing quantity (factor, price quantity, line quantity, batch yield) — the DB never stores one | P0.3, P0.4 |
| AD-13 | §4.2 `recipeCost` returns `{ value, status, unknown }`; the owner app needs `known` (t-6) for a single recipe's `CostWire` too | `recipeCost` also returns `known` (superset; an empty recipe is known, value 0) | P0.3 |
| AD-14 | `stockItemUnitCost` has no partial flag; a prepared item whose batch recipe is `partial` | returns `null` (unknown), never a partial value as if known | P0.3 |
| AD-15 | B6 names two warning codes (`no_yield_defaulted_ap`, `main_line_off`) and three unnamed warnings | codes `ep_in_batch`, `ep_no_yield`, `no_menu_cost` (`RecipeWarningCode`, `admin/recipes.ts`) | P0.4 |
| AD-16 | §6.1 lists owners **without** a recipe, but `RecipeSummaryWire.recipe_id` is not nullable; §6.6 needs a recipe-level `expected_version` that no wire carries | `recipe_id: string \| null`; `version: string \| null` (recipe-level, V13) on `RecipeSummaryWire` | P0.4 |
| AD-17 | §6.6 names no response body, and its counts (2 / 3 / 4 / 5 / 6 / 9 / 10) leave no room for the cost context | `PatchRecipeResponse = { data: { recipe: { recipe_id, archived, version } } }` | P0.4 |
| AD-18 | §4.2 says `CloudCostRows` = "the five cost-context row sets as the cloud repository returns them" but fixes no shape | `CloudCostRows = { source: 'cloud', items, units, prices, yields, recipes }` with **the snapshot key's element shapes** (BIGINT as strings; `created_at` / `valid_until_at` / `published_at` / `base_qty` as numbers; versions carry `status: 'published'` and `lines`); `source: 'cloud'` keeps the real `created_at` (rows are time-filtered for `now`; no t-1 rank). r4 / r1 map pg rows to it | P0.3, r1, r4 |
| AD-19 | `RECIPE_NOT_FOUND` (F-1) is in the P0.3 row; foundation v1.16 already carries the append marker | added to `packages/domain/src/errors.ts` in P0.3 (review fix) | P0.3 |

## Tasks

| Task | What | Branch | PR | Tests | Merged | Notes |
|---|---|---|---|---|---|---|
| P0.0 | Gap sweep | — | — | — | 2026-11-24 | G-1, AD-1 – AD-17 |
| P0.1 | `module-08b` + this board | `lane-0/p0` | | — | | |
| P0.2 | Migration `0019_recipes.sql` | `lane-0/p0` | | 33 (+ AD-4 edits) | | HIGH |
| P0.3 | Cost engine + `lb` / `oz` | `lane-0/p0` | | 1–11, 27 (t-1), 08a #1 | | Shared, HIGH; G-1 |
| P0.4 | Wires + schemas | `lane-0/p0` | | 24, 27 (M-5), 27b (schema level), AD-12 pin | | Shared |
| P0.5 | Hooks + fixtures | `lane-0/p0` | | fixture smoke | | Cross |
| s1 | Snapshot key | `lane-S/s1` | | 23–25, 27, 27b, 28, 33 (key), 08a #25 | | HIGH, Cross |
| s2 | Bump rule on 08a writes | `lane-S/s2` | | 26, 08a #9 #28 #31 #35 | | HIGH, Cross |
| r1 | Recipes module + create + draft | `lane-R/r1` | | 12, 13 | | HIGH |
| r2 | Publish | `lane-R/r2` | | 14–17 | | HIGH |
| r3 | Archive / restore | `lane-R/r3` | | 18, 18b, 37, 38 | | HIGH |
| r4 | Reads | `lane-R/r4` | | 19, 20 | | — |
| r5 | Audit + route cases | `lane-R/r5` | | 21 | | — |
| g1 | Recipe in-use guards | `lane-G/g1` | | 22 | | HIGH, Cross |
| t1 | Races (fresh session) | `lane-T/t1` | | 34, 35, 36 | | HIGH |
| u1 | Owner app | `lane-U/u1` | | 29–32 | | UI, Cross |

## Acceptance map (B§10.6; filled at Z1)

| Test | Task | PR |
|---|---|---|
| 1–11 | P0.3 | |
| 12, 13 | r1 | |
| 14–17 | r2 | |
| 18, 18b, 37, 38 | r3 | |
| 19, 20 | r4 | |
| 21 | r5 | |
| 22 | g1 | |
| 23–25, 27, 27b, 28 | s1 (+ P0.3 / P0.4 schema-level parts) | |
| 26 | s2 | |
| 29–32 | u1 | |
| 33 | P0.2 (+ s1, AD-7) | |
| 34–36 | t1 | |
| 08a #1 | P0.3 | |
| 08a #25 | s1 | |
| 08a #9, #28, #31, #35 | s2 | |
| drill 2 | — (owner's paper figures, OQ-1) | |
