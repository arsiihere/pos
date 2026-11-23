# 08b Recipes + cost engine — build board

Plan: `08b-plan.md`. Spec: `docs/specs/08_Inventory_Costing_Spec_v1.1.md` **Part B** (APPROVED 2026-11-24), with Part A P-1 – P-3, 01a v2.9 (A-2′ – A-6), 01b v1.10.4 (B-x), 01c v1.3 (C-11 – C-16), foundation v1.16 §6.2 (F-1). Integration branch: `module-08b`. Only the integrator (orchestrator session) edits this file.

> **Status (owner summary, newest first):**
> - 2026-11-24 (later): **merged** s1 #482, g1 #480, r1 #481 (each: fresh reviewers — two on HIGH — findings fixed, gate green; r1 gate try 1 red on 01b #104's hash-builder list → AD-22). r1 review found a real race (option owner read `FOR SHARE OF g` returned a stale option row) → fixed with `FOR SHARE OF g, o` + race test. Running: s2, r2 ∥ r4; u1 built on stubs, waits for the R routes.
> - 2026-11-24: **Phase 0 merged** (#479 → `module-08b` @ `263c157`; gate green on try 2 — try 1 red on a collation-dependent `ORDER BY name` in the fixture test, fixed with `COLLATE "C"`). Every finding of the 4 fresh reviewers fixed (2 MAJOR: `RECIPE_NOT_FOUND` missing; B7 cap per option instead of per stock item per sale line). Lanes s1, r1, g1, u1 running in parallel.
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
| AD-20 | The builder has no logger for `inventory_key_invalid` | `syncConfig` takes an optional `log`; the sync route passes `request.log` (`config-sync/service.ts`, `routes.ts`) | s1 |
| AD-21 | A-4's file list misses two 01c tests that pin the builder at 23 (`menu-variants/snapshot-deals`, `snapshot-modifiers`) | 23 → 28 with the "⚠️ 08b A-4" marker | s1 |
| AD-22 | 01b #104 (`staff-roles/versions.int.test.ts`) lists every `sha256hex(canonicalJson(` builder | + `modules/recipes/versions.ts` (the recipes module's V13 builder), marked | r1 |
| AD-23 | P-2's recipes read: built first on "kind away from prepared" only | **spec-literal (orchestrator ruling):** one `recipes` read on **any** `kind` change; 08a #9 4 → 5 | g1 |
| AD-24 | §6.3 / §6.4 option owner read under `FOR SHARE OF g` returns the option row as of statement start (READ COMMITTED re-fetches locked tables only) | `FOR SHARE OF g, o` (one statement, counts unchanged) + race test (create ∥ option link → 422 `linked_option`) | r1 |
| AD-25 | r1 review: an empty menu-item / stock-item version costed "Rs 0" (engine: empty = known) | the cloud's `CostWire` maps an empty **non-option** version to `partial`, `minor: null` (D9); an empty option stays `costed "0"` (t-6) | r1 |
| AD-26 | r1 rulings: (a) the stored `409` body sent by a module-local helper (`lib/idempotency.ts` unchanged); (b) `no_yield_defaulted_ap` derived from data (any AP ingredient line without an active yield outside `per_batch`; reads cannot tell a default); (c) `main_line_off` checked only on AP ingredient lines whose stock unit = the owner's `sale_unit`; (d) `branch_id?` query on the draft PUT (C2 first); (e) create on an archived owner allowed (§3.3 checks existence); a draft on an archived recipe whose owner changed kind / link is saved (publish refuses, spec letter); `created_by` keeps the draft's creator; `CONFIG_STALE` details name the draft version | as listed | r1 |
| AD-27 | g1: the 409 error `entity` / `id` follow the route's resource (`stock_item`, `menu_item`, `modifier_group`); only `used_by` is fixed by the spec | as built | g1 |
| AD-28 | u1 (pending review): browser live cost for ingredient / packet lines from 08a's inventory reads, prepared lines "Shown after Save draft"; Restore on archived list rows; `docs/design/handoff/08b/urdu-todo.md` (08a convention); "makes N piece" for plates (spec wording note for Z1) | as built, reviewed with u1 | u1 |
| AD-29 | Test 26's "recipe create, draft save, archive of a never-published recipe bump none" needs the recipe routes, absent from s2's base | **r3** adds those three no-bump cases (as `[08b #26]`) next to its archive tests; r1's create / draft counts already carry no bump statement | s2, r3 |

## Tasks

| Task | What | Branch | PR | Tests | Merged | Notes |
|---|---|---|---|---|---|---|
| P0.0 | Gap sweep | — | — | — | 2026-11-24 | G-1, AD-1 – AD-17 |
| P0.1 | `module-08b` + this board | `lane-0/p0` | #479 | — | 2026-11-24 | |
| P0.2 | Migration `0019_recipes.sql` | `lane-0/p0` | #479 | 33 (+ AD-4 edits) | 2026-11-24 | HIGH; 2 reviewers |
| P0.3 | Cost engine + `lb` / `oz` | `lane-0/p0` | #479 | 1–11, 27 (t-1), 08a #1 | 2026-11-24 | Shared, HIGH; 2 reviewers; G-1 |
| P0.4 | Wires + schemas | `lane-0/p0` | #479 | 24, 27 (M-5), 27b (schema level), AD-12 pin | 2026-11-24 | Shared |
| P0.5 | Hooks + fixtures | `lane-0/p0` | #479 | fixture smoke | 2026-11-24 | Cross |
| s1 | Snapshot key | `lane-S/s1` | #482 | 23–25, 27, 27b, 28, 33 (key), 08a #25 | 2026-11-24 | HIGH, Cross |
| s2 | Bump rule on 08a writes | `lane-S/s2` | | 26, 08a #9 #28 #31 #35 | | HIGH, Cross |
| r1 | Recipes module + create + draft | `lane-R/r1` | #481 | 12, 13 | 2026-11-24 | HIGH |
| r2 | Publish | `lane-R/r2` | | 14–17 | | HIGH |
| r3 | Archive / restore | `lane-R/r3` | | 18, 18b, 37, 38 | | HIGH |
| r4 | Reads | `lane-R/r4` | | 19, 20 | | — |
| r5 | Audit + route cases | `lane-R/r5` | | 21 | | — |
| g1 | Recipe in-use guards | `lane-G/g1` | #480 | 22 | 2026-11-24 | HIGH, Cross |
| t1 | Races (fresh session) | `lane-T/t1` | | 34, 35, 36 | | HIGH |
| u1 | Owner app | `lane-U/u1` | | 29–32 | | UI, Cross |

## Acceptance map (B§10.6; filled at Z1)

| Test | Task | PR |
|---|---|---|
| 1–11 | P0.3 | #479 |
| 12, 13 | r1 | #481 |
| 14–17 | r2 | |
| 18, 18b, 37, 38 | r3 | |
| 19, 20 | r4 | |
| 21 | r5 | |
| 22 | g1 | #480 |
| 23–25, 27, 27b, 28 | s1 (+ P0.3 / P0.4 schema-level parts) | #482 (+ #479) |
| 26 | s2 | |
| 29–32 | u1 | |
| 33 | P0.2 (+ s1, AD-7) | #479 + #482 |
| 34–36 | t1 | |
| 08a #1 | P0.3 | #479 |
| 08a #25 | s1 | #482 |
| 08a #9, #28, #31, #35 | s2 | |
| drill 2 | — (owner's paper figures, OQ-1) | |
