# 01c Menu: variants, modifiers, deals — Implementation Plan (spec v1.0.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build module 01c: variant groups, stock items shared by several sellables, stock draws, modifier groups (plain and linked options, per-branch offers and prices), deals with parts and choices, weighed items, snapshot schema 2, the hub stock commands / query / catch-up keyed by stock item, the `@pos/domain` order-line functions 02 will call, and the owner app views.

**Architecture:** Cloud config stays relational; every 01c write follows the §6 check order (C4) and the §6 lock-order table; new tables use `expected_version` (V13) built in one module (`menu-variants/versions.ts`); `menu_items` keeps last-write-wins and 01a's no-op-before-references order (T4 decision). The snapshot moves to schema 2 in one coordinated cut-over (task 21); until then the hub reads the V1 snapshot through a temporary V2 view that applies the §5.1 backfill rule in memory, so every task ends green. Stock events go to v2 with upcasters (D46); the engine is keyed by `stock_item_id` (V5).

**Tech Stack:** the existing stack (CLAUDE.md): Node 22, Fastify 5, PostgreSQL 16 (cloud), SQLite / better-sqlite3 (hub), React (client), Zod, Vitest. No new dependency.

**Spec:** `docs/specs/01c_Menu_Variants_Spec_v1.0.1.md` (cited "§x", "Vn", tests "#n"), with `docs/reviews/01c_hostile_G4.md` run 5 (T1–T4, carried in §12.7). Changed specs, already applied with "Changed by 01c v1.0" markers: `docs/specs/01_Restaurant_Setup_Spec_v2.0.md` ("01a §x", tests "01a #n"), `docs/specs/01b_Staff_Roles_Spec_v1.2.md` ("01b #n"), foundation `docs/specs/00_Foundation_Spec_v1.7.md` ("F §x"). **Read the cited spec section before each task**; the plan does not repeat the spec's tables or SQL.

**Starting point:** 00, 01a and 01b are built. Already done, no task: §11 step 20 (01a v2.0, 01b v1.2, README rows; commit `a490006`) and the F §6.2 append of the four 404 codes (commit `0d24760`). Reuse, do not recreate: cloud `withIdempotency`, `inTransaction` (`lib/idempotency.ts`), `writeConfigAudit`, `auditActionFor` (`lib/config-audit.ts`), `bumpConfigVersion`, `coversEveryBranch` (`lib/config-version.ts`), `TenantScopedRepository`, `TenantLevelRepository`, `nameTaken`, `unchangedRow`, `replaceWindows`, `assertReference`, `assertRoutes` (`modules/restaurant/service.ts`), `canonicalJson`, `sha256hex` (`@pos/domain/hash`), the 01b version style (`modules/staff-roles/versions.ts`); cloud test helpers `createTestCloud`, `restaurantFixture`, `seedMenu`, `pgCounter`, `scratchDatabaseAt`, `ROUTE_CASES`; hub `defineCommand`, `defineQuery`, `registerCatchUp`, `branchConfig()`, `stockScopeFilter`, `requireBranchScope`; hub test helpers `createTestHub`, `stub-config-cloud.ts`, `statementCounter`; `@pos/events/testing` builders; client `api/cloud-admin.ts`, `api/hub-admin.ts`, `i18n/{en,ur}.ts`, `features/owner/versions.ts`.

## Markers

| Marker | Meaning |
|---|---|
| **Shared** | Touches `packages/events`, `packages/engine` or `packages/domain`. Land these in order and rebase later branches on them; never run two Shared tasks in parallel. |
| **Seam** | Adds or removes temporary code that keeps the monorepo green across the schema-2 cut-over (P-2). Every seam is removed by a named later task. |
| **needs Docker Postgres** | The task's own command needs Postgres (`docker compose up -d postgres`, port 5433). Every `pnpm -w test` runs the cloud suite, so keep it running for every task. |
| **Manual** | Needs a person at a browser and a second hub build. Task 39 only. |

## Global Constraints

Every task implicitly includes these. Values copied from the spec.

- **Gate:** every task ends with `pnpm -w typecheck && pnpm -w lint && pnpm -w test` green. A batch ends with its checkpoint (below).
- **Dependencies:** none new in any `package.json` (§7).
- **Spec-first:** if code and spec disagree, stop and ask (CLAUDE.md). The spec gaps found while writing this plan are in "Spec gaps" at the end; the plan's choice for each is a Plan decision, to be confirmed by the developer before the task that needs it.
- **Determinism (F §6.7):** no `Date.now()`, `Math.random()`, `ulid()` in hub, cloud or package `src/`; injected `Clock`, `IdGen`.
- **Errors (F §6.2, §9):** only catalogue codes through `DomainError`. New: `VARIANT_GROUP_NOT_FOUND`, `STOCK_ITEM_NOT_FOUND`, `MODIFIER_GROUP_NOT_FOUND`, `DEAL_NOT_FOUND` (404). New `CONFIG_REFERENCE_INVALID.reason`: `category_mismatch`, `unit_mismatch`, `linked_item_not_piece`, `choices_unsatisfiable`, `defaults_exceed_max`, `too_many_groups`, `choice_unit_mismatch`, `weighed_item_in_deal`, `weighed_item_stock_draw`. `CONFIG_NAME_TAKEN.entity` adds `variant_group`, `variant`, `stock_item`, `modifier_group`, `modifier_option`, `deal`. `CONFIG_STALE.entity` adds `variant_group`, `stock_item`, `stock_item_branch`, `modifier_group`, `modifier_group_branch`, `deal`, `deal_branch`. `STOCK_NOT_TRACKED` is no longer returned.
- **Check order (§6, C4):** (1) `400` schema incl. C6 keyed duplicates, auth and `403 tenant_wide_write` first; (2) `404`; (3) `409 CONFIG_STALE` (versioned writes); (4) references on sent fields (C1); (5) no-op → `200`, no audit, no bump (S26); (6) merged-row rules; then write, audit, bump. **`menu_items` exception (V13, T4 decision):** (5) runs before (4); §6.5's rules R1–R10 run after the no-op in the §6.5 precedence.
- **Lock order (§6 table):** `modifier_groups` → `deals` → `variant_groups` → `menu_items` → `stock_items` → `categories` → `tax_classes` → `stations`, `batch_programs` → branch rows by `branch_id` → `branches` (bump, last). Ids ascending within a kind. Merged-row rules that read other entities are plain reads. §6.5 restart rule: at most 3 attempts, then `503 SERVICE_UNAVAILABLE`.
- **Versions (V13, §5.4):** built only in `apps/cloud/src/modules/menu-variants/versions.ts`; exactly the §5.4 keys; arrays sorted in JS; `Number()` on every `BIGINT`; `version = sha256hex(canonicalJson(input))`. Versioned: `variant_groups`, `stock_items`, `stock_item_branches`, `modifier_groups`, modifier group at a branch, `deals`, `deal_branches`. Not versioned: `menu_items`, `item_routes`, `categories` (S23).
- **Limits (§3.3):** variant group name 1–60; `variant_name` 1–30; stock item name 1–60; `stock_draws` 0–1; `quantity_per_sale_unit` 1 … 1 000 000; `low_stock_threshold` null or 0 … 1 000 000; modifier group name 1–40, `min_choices` 0–50, `max_choices` 1–50; options 1–50, option name 1–40, `max_quantity` 1–20 (default 1); prices 0 … 1 000 000 000; links 0–500; effective groups ≤ 20 per item (write-time only, never in the schema or builder, M5); deal name 1–60; parts 1–10; part quantity 1 … 1 000 000; choices 1–20; option branch rows 0–50; hub stock entries 1–200; `AddPrecookedStock.quantity` 1 … 1 000 000.
- **Fixed statement counts:** `GET /v1/admin/menu` 8; `GET /v1/admin/stock-items` 4; `GET /v1/admin/modifier-groups` 5; `GET /v1/admin/deals` 5; snapshot builder 01a's 7 + 9; hub stock query: `unchanged` 0, else 1 when the numbers are sent. No N+1 anywhere (CLAUDE.md).
- **Names:** case-insensitive uniqueness through `lower(name)` partial indexes, except option names: one SQL statement over `lower(name)` under the group lock (V14, m13), never an index.
- **Children (V14, V15):** options, parts, choices, links, windows are written whole inside their parent; omitted active option / part → archived (same ULID, restorable by id); one `config_audit` row on the parent.
- **Snapshot (§4.6):** arrays by `sort_order`, then id; stock items by `toLowerCase()` name then id in JS; not `.strict()`.
- **Route cases (C7, D54):** every task that adds a cloud route adds its `ROUTE_CASES` entry in `apps/cloud/test/helpers/route-cases.ts` in the same task (`cross-tenant.int.test.ts` requires the keys to equal the registered routes).
- **Tests:** `it('[01c #N] …')`, each N in exactly one test (Coverage table); supporting tests cite a section `it('[01c §6.5] …')`. Re-keyed tests keep their tag (`[01a §10 #N]`, `[01b #34]`). Cloud integration under `apps/cloud/test/menu-variants/`; hub under `apps/hub/test/`; units next to the source; client `apps/client/src/**/*.test.tsx`.
- **Commit:** one task per commit, only the task's files: `feat(01c): task N <title> [spec §x, Vn; tests #a, #b]`.
- **Batch checkpoint:** after a batch's last task, run the gate once more, append a summary (tasks, commits, tests closed, deviations as `AD-n`, open seams) to `docs/plans/01c-status.md`, and commit it alone: `docs(01c): checkpoint batch N`.

## Plan decisions

Choices the spec leaves to the plan, or that §11 cannot meet as written. P-1 to P-4 change §11's order; each is listed under "Spec gaps" for the developer.

| # | Decision | Where |
|---|---|---|
| P-1 | **Order.** §11 is followed except: (a) the snapshot-2 types (step 6) land before the engine re-key (step 5), because the re-keyed engine and the hub view are typed with them; (b) the hub and stock-page re-key (steps 14, 15 stock page) move before the builder (step 12), and the builder flip moves before modifier groups and deals (steps 10, 11, 18), so each feature batch ships its own builder rule with its snapshot tests; (c) route cases (step 13) go with each route (Global Constraints); step 13 keeps only the race tests; (d) weighed items (step 17) and D-3 (step 19) are split into the item, deal and builder tasks that own their code | Task list |
| P-2 | **Seams for a green cut-over.** (a) Task 7 renames the schema-1 exports to `BranchConfigV1`, `ConfigItemV1`, `isStockTrackedV1`, `aBranchConfigV1` and gives the schema-2 ones the final names; task 21 deletes the V1 names. (b) Task 8 adds `apps/hub/src/sync/config-v2-view.ts`: `branchConfigV2()` maps the held V1 snapshot to a schema-2 value by the §5.1 backfill rule (a tracked item becomes a stock item with the same id, counted at its route station, with one draw); hub stock code reads only `branchConfigV2()` from task 8 on; task 21 deletes the file and points callers at `branchConfig()`. (c) Task 19 adds the hub stock query's new parts next to the old fields; task 20 removes the old fields when the stock page moves | tasks 7, 8, 19, 20, 21 |
| P-3 | **Test placement (01b P-1).** A numbered test goes in the first task where every part of it can run. The code it covers may be test-driven earlier by section-cited tests. A number tagged in two files (01a #132, #133, #156: hub and client) goes to the task that re-keys its last file; earlier tasks only keep the other file green | Coverage table |
| P-4 | **Item-side rules tested before their writers exist.** §6.5 R4, R6, R10 (tasks 14–15) read `modifier_options` and `deal_part_choices`; their tests seed those rows with SQL through `apps/cloud/test/helpers/menu-variants.ts` (`seedModifierGroupRows`, `seedDealPartRows`), as test 127 already seeds rows bypassing the write rules | tasks 14, 15 |
| P-5 | **T3 (§12.7).** `checkOptionChoices` gains `parent: { quantity: number \| null; sale_unit: Unit }` as its 4th parameter. The other §4.2 parameter orders stay as written (no reorder: the spec text is the contract 02 reads) | task 4 |
| P-6 | **`dayDraws` needs the config stock units (gap G3).** `dayDraws(state, item, configStockUnits: Readonly<Record<string, Unit>>)`; the V20 fallback drops a draw whose frozen `stock_units[id]` differs from `configStockUnits[id]` | task 8 |
| P-7 | **Domain stays below events.** `@pos/events` depends on `@pos/domain`, so `menu-lines.ts` declares structural input types (`MenuLineItem`, `MenuLineGroup`, …); task 7 adds a type-level test that the schema-2 `ConfigItem` / `ConfigModifierGroup` / `ConfigDeal` are assignable to them | tasks 3, 4, 7 |
| P-8 | **T4 decision (§12.7).** `patchMenuItem` order: restart-safe locks → merge → no-op (row, windows and draws) → references on sent fields (C4 step 4) → 400 rules → `409` R4, R10, R6 → `422` (01a's `stock_time_exceeds_cook_time`, restore references and routes; then R1, R1a, R2, R3, R7 draw part, R8, R9) → write (R5 and 01a's name index). R3's slot is filled in task 23, R8's in task 30 | tasks 13–15, 23, 30 |
| P-9 | **T1 (§12.7).** §6.12 locks the stored active options' linked items `FOR SHARE` only when R6 runs on a restore without `options`; R6 checks `archived` before `linked_item_not_piece` (01a `assertReference` order); test 125 is written as explicit steps | task 25 |
| P-10 | **V16 station check (gap G7).** A `stock_item_branches` row blocks a station archive only when its stock item is active (as §6.8 R2 counts only active drawers) | task 17 |
| P-11 | **Deprecated item columns (§5.1).** Every item write sets `stock_unit = sale_unit`, `stock_per_sale_unit = 1`, `low_stock_threshold = null`, `carries_over = false`, `group_label = null`; nothing reads them after task 21; the V1 builder still reads them until then | tasks 12, 14 |
| P-12 | **01a #41** (two items sharing `group_label`) is retired in task 12, when `group_label` leaves the item body; #21 replaces it (task 22, §11 step 16). **01a #68** (engine log fixture) is re-keyed in task 8 though §4.5 does not list it (gap G5) | tasks 8, 12, 22 |

## Changes to today's code that the review flagged (read before the named task)

| Code today | Change | Task |
|---|---|---|
| `patchMenuItem` (`apps/cloud/src/modules/restaurant/service.ts:878–936`) locks the item first (`lockMenuItem`, :887) | **M3 / N2:** read the item unlocked → lock the stored and merged variant group(s) `FOR SHARE` in id order → `lockMenuItem` → compare the locked `variant_group_id` with the unlocked read → roll back and restart (≤ 3 attempts, then `503`). Applies on the no-group path too | 13 |
| `patchMenuItem` order: no-op (:897) → `assertUnits` 400 (:901) → `stock_time_exceeds_cook_time` 422 (:902) → category / tax class references (:906–911) → routes on restore (:913) → name index (:914) | **T4:** keep no-op first (P-8); `assertUnits` is deleted (the unit rule moves to the draw, R2); reorder the rest per P-8 | 13, 15 |
| `patchMenuItem` comment (:875–877) "Archiving needs no in-use check" | **V16 / R4:** archive is refused while an active option of an active group links the item or an active deal part offers it | 15 |
| `createMenuItem` (:819–871) runs `assertUnits` before the key; references category (6) → tax class (7) → stations / programs (8) | variant group `FOR SHARE` (3) and stock item `FOR SHARE` (5) before the category (§6.4, P3); `assertUnits` deleted; draw row inserted | 12 |
| `patchCategory` (:708), `patchTaxClass` (:609), `patchStation` (:399) check only `menu_items` / `item_routes` on archive | **V16:** + active variant groups / deals (category), active deals (tax class), active `stock_item_branches` rows (station) | 11, 29, 17 |
| `listMenu` (:762) is 6 statements; `selectMenuPage` (`repository.ts:807`) matches `group_label ILIKE` | 8 statements (+ variant groups, + page draws `= ANY`); `q` matches the item name or its group's name | 12 |
| `buildSnapshot` (`config-sync/builder.ts`) is 7 statements and parses with `BranchConfigSnapshotSchemaV1` | schema 2: + 9 statements across tasks 21, 27, 31 | 21, 27, 28, 31 |
| Migration constraint names (01b D-5), read from the test database on 2026-10-29: `availability_windows_check` = `CHECK ((item_id IS NULL) <> (category_id IS NULL))` (the one dropped by §5.1); `availability_windows_check1` = `start_ms <> end_ms` (untouched); `config_audit_entity_check`, `config_audit_action_check` (as 0005); `menu_items_check1` = the 01a S44 unit CHECK (kept; P-11 satisfies it) | §5.1's names match; task 1 re-reads them before writing the file | 1 |
| `packages/events/src/fixtures.test.ts` expects 22 versioned fixtures | 24 after task 6, 25 after task 8 | 6, 8 |
| Hub `stockItems()` (`commands/set-precooked-stock.ts`) throws `MENU_ITEM_NOT_FOUND` / `STOCK_NOT_TRACKED`; `requireItemsInScope` reports `item_ids` and scopes by the item's route station | `STOCK_ITEM_NOT_FOUND { stock_item_id }`; `requireStockItemsInScope` by `stock_item.station_id`, details `stock_item_ids`; `SetItemAvailability` keeps `requireItemsInScope` (B1) | 18 |
| `cross-tenant.int.test.ts:115` asserts `ROUTE_CASES` keys equal the registered routes | route cases go with each route, not in §11 step 13 | every route task |

## Review Focus

Inputs the spec implies but no numbered test covers. Each has a test in the named task.

1. **An item PATCH that re-sends its stored draw, or changes only its draw:** the same draw is a no-op (`200`, no audit, no bump); a draw-only change writes one audit row with the draw in `before` / `after` and bumps every branch (S26 must compare draws, not only the item row) → task 14.
2. **Archiving a category that an active variant group uses** (V16; test 56 covers only deals): `409 CONFIG_IN_USE { used_by: { entity: 'variant_group', ids } }`; with the group archived → `200` → task 11.
3. **Creating an item in an archived or foreign variant group** (§6.4 edge row, no numbered test): `422 { field: 'variant_group_id', reason: 'archived' }` / `'not_found'`, nothing written → task 12.
4. **Counting a stock item that nothing sold here draws from** (`has_tracked_drawers: false`): `SetPrecookedStock` on it → `200` with one `StockSet` v2; the row stays on the page marked "Not used by any dish here" → task 22.
5. **Archiving a station whose only `stock_item_branches` row belongs to an archived stock item** (P-10): `200`; with the stock item active → `409 CONFIG_IN_USE { used_by: { entity: 'stock_item' } }` → task 17.

---

## Interfaces (later tasks rely on these exact names)

**Domain — `packages/domain/src/menu-lines.ts` (tasks 3–4), browser-safe, exported from `@pos/domain`:**

```ts
type LineKind = 'item' | 'option_child' | 'deal' | 'deal_part';
type Position = 'line' | 'child';
type IsAvailable = (itemId: string, quantity: number) => boolean;
interface MenuLineOption { option_id: string; price_minor: number; max_quantity: number; is_default: boolean; linked_item_id: string | null }
interface MenuLineGroup { modifier_group_id: string; min_choices: number; max_choices: number; has_plain_options: boolean; options: MenuLineOption[] }
interface MenuLineItem { item_id: string; sale_unit: Unit; modifier_group_ids: string[] }
interface MenuLineDeal { deal_id: string; parts: Array<{ deal_part_id: string; quantity: number; choices: Array<{ item_id: string; extra_price_minor: number }> }> }
interface ChosenOption { modifier_group_id: string; option_id: string; quantity: number }
interface Violation { reason: 'not_effective' | 'quantity_out_of_range' | 'below_min' | 'above_max' | 'linked_in_child' | 'linked_not_orderable'; modifier_group_id: string; option_id: string | null }
type LineTotalInput =
  | { line_kind: 'item'; price_minor: number; quantity: number | null; sale_unit: Unit; option_charges_minor: number[] }
  | { line_kind: 'option_child'; price_minor: number; quantity: number; option_charges_minor: number[] }
  | { line_kind: 'deal'; price_minor: number; quantity: number; parts: Array<{ sale_unit: Unit; quantity: number; extra_price_minor: number; option_charges_minor: number[] }> }
  | { line_kind: 'deal_part' };
childQuantity(optionQty: number, parentQty: number, parentSaleUnit: Unit): number
optionChargeMinor(priceMinor: number, optionQty: number, parentQty: number, parentSaleUnit: Unit): number
allocateDealMinor(totalMinor: number, weightsMinor: readonly number[]): number[]
orderLineTotalMinor(line: LineTotalInput): number | null
checkOptionChoices(groups: readonly MenuLineGroup[], chosen: readonly ChosenOption[], position: Position, parent: { quantity: number | null; sale_unit: Unit }, groupsById: Readonly<Record<string, MenuLineGroup>>, itemsById: Readonly<Record<string, MenuLineItem>>, isAvailable: IsAvailable): Violation[]
isGroupSatisfiable(group: MenuLineGroup, position: Position, groupsById, itemsById, isAvailable): boolean
isItemOrderable(item: MenuLineItem, groupsById, itemsById, position: Position, quantity: number, isAvailable): boolean
isDealOrderable(deal: MenuLineDeal, dealQuantity: number, groupsById, itemsById, isAvailable, inWindows: boolean): boolean
```

**Events — `packages/events/src/config.ts` (task 7; `SNAPSHOT_SCHEMA_VERSION` becomes 2 in task 21):** `BranchConfigSnapshotSchemaV2`; types `BranchConfig`, `ConfigItem`, `ConfigStockItem`, `ConfigVariantGroup`, `ConfigModifierGroup`, `ConfigModifierOption`, `ConfigDeal`, `ConfigCategory`, `ConfigStation`; `isStockTracked(item: Pick<ConfigItem, 'stock_draws'>): boolean`. Until task 21: `BranchConfigSnapshotSchemaV1`, `BranchConfigV1`, `ConfigItemV1`, `isStockTrackedV1(config, item)`. Testing (`packages/events/testing`): `aBranchConfig()` (schema 2: Karahi pot `K1` in g at station Karahi, Half `I1` 500 g, Full `I3` 1 000 g, untracked `I2`), `aBranchConfigV1()` until task 21, `aStockSet`, `aStockAdded`, `aBusinessDayOpened` (v2 payloads).

**Events — stock (tasks 6, 8):** `StockSetV2`, `StockAddedV2`, `BusinessDayOpenedV2` (`events/stock/StockSet.v2.ts`, `events/stock/StockAdded.v2.ts`, `events/hub/BusinessDayOpened.v2.ts`), each with `upcastFromPrevious` per §5.3; payload types `StockSetPayloadV2`, `StockAddedPayloadV2`, `BusinessDayOpenedPayloadV2`.

**Events — admin wires:** `packages/events/src/admin/menu-variants.ts` (task 10): `CreateVariantGroupBody`, `PatchVariantGroupBody`, `VariantGroupWire`, `VariantGroupResponse`; `CreateStockItemBody`, `PatchStockItemBody`, `PutStockItemBranchBody`, `StockItemWire`, `StockItemListResponse`, `StockItemResponse`, `StockItemBranchResponse`; `CreateModifierGroupBody`, `PatchModifierGroupBody`, `PutModifierGroupBranchBody`, `ModifierGroupWire`, `ModifierGroupListResponse`, `ModifierGroupResponse`, `ModifierGroupBranchResponse`; `CreateDealBody`, `PatchDealBody`, `PutDealBranchBody`, `DealWire`, `DealListResponse`, `DealResponse`, `DealBranchResponse`; inferred `…Input` types. Every PATCH body refuses a body whose only key is `expected_version` (C9). `admin/restaurant.ts` item body and `MenuItem` wire change in task 12; `admin/hub.ts` stock payloads in task 18, stock query in tasks 19–20.

**Engine — `packages/engine` (tasks 6, 8, 9):**

```ts
interface DayDraws { sale_unit: Unit; stock_draws: Array<{ stock_item_id: string; quantity_per_sale_unit: number }> }
interface BusinessDay { business_date: string; opened_at: number; closed_at: number | null; stock_units: Record<string, Unit>; draws: Record<string, DayDraws> }
interface EngineState { stock: Record<string /* stock_item_id */, StockEntry>; business_day: BusinessDay | null }
stockOf(state, stockItemId: string): StockEntry
openDayStartMs(state): number | null
dayStockUnit(state, stockItem: Pick<ConfigStockItem, 'stock_item_id' | 'stock_unit'>): Unit
dayDraws(state, item: Pick<ConfigItem, 'item_id' | 'sale_unit' | 'stock_draws'>, configStockUnits: Readonly<Record<string, Unit>>): DayDraws
countIsValid(entry, businessDayStartMs, stockItem: { carries_over: boolean; stock_unit: Unit }): boolean
availableStock(state, stockItemId, businessDayStartMs, stockItem: ConfigStockItem): number
stockLevel(state, stockItemId, businessDayStartMs, stockItem: ConfigStockItem): 'not_counted' | 'out' | 'low' | 'ok'
saleUnitsAvailable(available, quantityPerSaleUnit), canServeFromStock(available, quantity, quantityPerSaleUnit)   // unchanged
ENGINE_STATE_VERSION = 2   // task 8; fixtures engine-state.v2.json, engine-log.v2.json
```

**Hub (task 8, Seam until task 21):** `apps/hub/src/sync/config-v2-view.ts`: `toConfigV2(v1: BranchConfigV1): BranchConfig` (memoised per object) and `branchConfigV2(): BranchConfig | null`. **Hub (task 18):** in `commands/set-precooked-stock.ts`: `uniqueStockItemIds`, `stockItemsOf(state, entries): ConfigStockItem[]`, `requireStockItemsInScope(ctx, stockItems)`, `stockItemScopeFilter(directory, staffId, resolution)`, `stockItemResult(state, stockItem, setAt)`; `requireItemsInScope` stays for `SetItemAvailability`.

**Cloud — `apps/cloud/src/modules/menu-variants/`:** `routes.ts` (`registerMenuVariantRoutes(app, deps)`), `service.ts`, `repository.ts`, `versions.ts` (task 10: `toVariantGroupWire`, `toStockItemWire`, `stockItemBranchVersion`, `toModifierGroupWire`, `modifierGroupBranchVersion`, `toDealWire`, `dealBranchVersion`, each returning the wire with `version`), `effective-set.ts` (task 23: `effectiveGroupIds(item: { item_id; category_id; variant_group_id }, links: LinkRow[], groups: Array<{ modifier_group_id; sort_order }>, activeTargets: ReadonlySet<string>): string[]`; `assertEffectiveSetLimit(items, links, groups, activeTargets, field)`). `apps/cloud/src/server.ts` `CloudTestHooks` gains `beforeItemLock?(attempt: number): Promise<void>` (task 13). Restaurant service gains `withItemRestart<T>(deps, run: (client: pg.PoolClient) => Promise<T>): Promise<T>` (task 13).

**Cloud test helper — `apps/cloud/test/helpers/menu-variants.ts` (task 11, grown by later tasks):** `createVariantGroup`, `createStockItem`, `putStockItemBranch`, `createModifierGroup`, `createDeal` (API), `seedModifierGroupRows`, `seedDealPartRows` (SQL, P-4), `snapshotOf(cloud, f, branchId)` (calls `buildSnapshot`).

---

## Coverage table (§10 → task)

126 live tests (1–128; 71, 72 retired). Checked by script: every live number appears in exactly one task below, and no retired number appears.

| Task | 01c tests | Re-keyed 01a / 01b tests |
|---|---|---|
| 1 | 27 | — |
| 3 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 87, 94, 95, 102, 103, 104 | — |
| 4 | 11, 12, 13, 14, 96, 97, 110, 122 | — |
| 5 | 117, 118, 119, 126 | — |
| 6 | 67 | — |
| 8 | 66, 108 | 01a #68, #133, #143, #145, #149 |
| 9 | 69 | 01a #66, #129, #148, #157 |
| 11 | 15, 16, 17, 18, 19, 20 | — |
| 12 | 22, 23, 26 | 01a #41 (retired → #21) |
| 13 | 101, 111, 120 | — |
| 14 | 24, 85, 123 | 01a #128 |
| 15 | 25, 83, 128 | — |
| 16 | 28, 29, 30, 35 | — |
| 17 | 31, 32, 33, 34 | — |
| 18 | 63, 64, 65, 68, 79 | 01a #59, #60, #61, #130, #134, #147 |
| 19 | 70, 114 | 01a #67, #72, #73, #89, #91, #93, #116, #131, #152, #158; 01b #34 |
| 20 | — | 01a #77, #132, #156, #166, #167, #171 |
| 21 | 57, 58, 60, 61, 93 | 01a #4 |
| 22 | 21, 80, 82, 84 | — |
| 23 | 38, 39, 40, 41 | — |
| 24 | 42, 43, 44, 45, 46, 47 | — |
| 25 | 48, 112, 116, 125 | — |
| 26 | 77, 90, 91 | — |
| 27 | 36, 37, 81, 100, 109, 113 | — |
| 28 | 59, 88, 89, 92, 106, 127 | — |
| 29 | 49, 50, 51, 56, 78 | — |
| 30 | 52, 53, 86, 105 | — |
| 31 | 54, 55, 62, 107 | 01a #140 |
| 32 | 73, 74, 75, 76 | — |
| 33 | 98, 99, 121 | — |
| 34 | 124 | — |
| 37 | 115 | — |

Totals: 01c 126 / 126 live (16 + 8 + 4 + 1 + 2 + 1 + 6 + 3 + 3 + 3 + 3 + 4 + 4 + 5 + 2 + 5 + 4 + 4 + 6 + 4 + 3 + 6 + 6 + 5 + 4 + 4 + 4 + 3 + 1 + 1 = 126). 01a: the 34 tests of §4.5 (4, 41, 59, 60, 61, 66, 67, 72, 73, 77, 89, 91, 93, 116, 128, 129, 130, 131, 132, 133, 134, 140, 143, 145, 147, 148, 149, 152, 156, 157, 158, 166, 167, 171) each once, plus #68 (P-12). 01b: #34 once.

**Moved from §11's step (P-1, P-3):** 21 (step 8 → task 22, needs the schema-2 builder); 36, 37, 59, 81, 88, 89, 92, 106, 127 (steps 10, 12, 18 → builder tasks 27–28); 54, 55 (step 11 → task 31); 84 (step 17 → task 22, its snapshot case); 85 (step 17 → task 14); 86 (step 17 → task 30); 83 (step 19 → task 15); 77, 78 (step 18/19 → tasks 26, 29); 80, 82 (step 19 → task 22); 120 (step 13 → task 13, it tests the restart rule itself); 125 (steps 8 and 10 → task 25, one task); 101 (§6.2 and §6.5 parts → task 13); 116 (POST and PATCH → task 25); 107 (three parts → task 31); 109 (PATCH, builder, R4 → task 27); 25 (option and deal-part cases → task 15, P-4); 01a #116, #131, #132 (step 5 → tasks 19–20: they are hub query tests); 01a #133, #143, #145, #149 (step 14 → task 8, where `BusinessDayOpened` v2 lands).

---

## Task list (→ spec §11 step)

| Batch (§11) | Task | Title | Marker |
|---|---|---|---|
| 1 (1–2) | 1 | Cloud migration `0006_menu_variants.sql`, backfill, audit types | needs Docker Postgres |
| | 2 | Domain error codes | Shared |
| 2 (3) | 3 | `menu-lines.ts`: quantities, charges, allocation, line totals | Shared |
| | 4 | `menu-lines.ts`: option checks and orderability (T3) | Shared |
| | 5 | Void-refund conformance tests (§3.4.8) | Shared |
| 3 (4–6) | 6 | `StockSet` v2, `StockAdded` v2, engine fold | Shared |
| | 7 | Snapshot schema 2 types (additive), V1 renames | Shared, Seam |
| | 8 | `BusinessDayOpened` v2, day state, `dayStockUnit` / `dayDraws`, hub V2 view | Shared, Seam |
| | 9 | Engine stock functions keyed by stock item | Shared |
| 4 (7–8) | 10 | Admin wire schemas and `versions.ts` | Shared |
| | 11 | Variant groups §6.1–§6.2; category in use | needs Docker Postgres |
| | 12 | Item wire, §6.4 POST, §6.3 menu read | Shared, needs Docker Postgres |
| | 13 | §6.5 lock order, restart rule, variant fields, rule precedence | needs Docker Postgres |
| | 14 | §6.5 stock draw and weighing rules | needs Docker Postgres |
| | 15 | §6.5 in-use rules R4, R10, R6 and test 128 (T4) | needs Docker Postgres |
| 5 (9) | 16 | Stock items §6.6–§6.8 | needs Docker Postgres |
| | 17 | Stock item branch PUT §6.9; station in use | needs Docker Postgres |
| 6 (14, 15 stock page) | 18 | Hub stock commands by stock item | Shared |
| | 19 | Hub stock query and catch-up by stock item (additive wire) | Shared, Seam |
| | 20 | Stock page per stock item; wire contraction | Shared, Seam |
| 7 (12) | 21 | Snapshot schema 2 cut-over: builder base, hub intake | Shared, Seam (removes), needs Docker Postgres |
| | 22 | Builder item contents; `has_tracked_drawers` | needs Docker Postgres |
| 8 (10, 18) | 23 | Modifier group POST §6.11; effective set and its limit | needs Docker Postgres |
| | 24 | Modifier group PATCH §6.12: options and links rewrite | needs Docker Postgres |
| | 25 | Modifier group PATCH merged rules R1–R6 (T1) | needs Docker Postgres |
| | 26 | Modifier group list §6.10 and branch PUT §6.12a | needs Docker Postgres |
| | 27 | Builder: modifier groups and effective sets | needs Docker Postgres |
| | 28 | Builder: options per branch and backstop | needs Docker Postgres |
| 9 (11, 17, 19) | 29 | Deal list §6.13, POST §6.14; category and tax class in use | needs Docker Postgres |
| | 30 | Deal PATCH §6.15; weighed items in deals | needs Docker Postgres |
| | 31 | Deal branch PUT §6.16; builder deals; statement bounds | needs Docker Postgres |
| 10 (13) | 32 | Races 73–76 | needs Docker Postgres |
| | 33 | Races 98, 99, 121 | needs Docker Postgres |
| 11 (15) | 34 | Owner item form: variant, stock, weighed; create-stock-item flow | |
| | 35 | Owner views: variant groups, stock items | |
| | 36 | Owner view: modifier groups with the per-branch tab | |
| | 37 | Owner view: deals; omitted-at-branch warnings | |
| 12 (16, DoD) | 38 | `seed-demo` 01c data | needs Docker Postgres |
| | 39 | Full suite, Definition of Done, manual checks | Manual |
| — | 40 | (optional, out of plan) 01a v2.0 prose rewrite | docs only |

---

## Batch 1 — Data and errors (§11 steps 1–2)

### Task 1: Cloud migration `0006_menu_variants.sql`, backfill, audit types — needs Docker Postgres

**Spec:** §5.1 (DDL and backfill verbatim), V2–V5, V10, V18, V19, 01b B2.

**Files:** Create `apps/cloud/src/db/migrations/0006_menu_variants.sql`, `apps/cloud/test/db/menu-variants-migration.int.test.ts`; Modify `apps/cloud/src/lib/config-audit.ts` (`AuditEntity` + `variant_group`, `stock_item`, `stock_item_branch`, `modifier_group`, `deal`, `deal_branch`; `AuditAction` + `branch_set`, `branch_removed`).

**Interfaces — Produces:** the §5.1 tables, indexes and constraints with the §5.1 names; `AuditEntity` / `AuditAction` members above.

- [ ] **Step 1: Read the real CHECK names (01b D-5).** `psql postgres://pos:pos@127.0.0.1:5433/pos_test -Atc "SELECT conrelid::regclass, conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid::regclass::text IN ('availability_windows','config_audit') AND contype = 'c' ORDER BY 1, 2"` → expect `availability_windows_check` = the one-target CHECK, `config_audit_entity_check`, `config_audit_action_check` (as recorded above). If any name differs, use the real name in the file and note it as `AD-1` in the checkpoint.
- [ ] **Step 2: Tests (write first)** in `menu-variants-migration.int.test.ts`: `[01c #27]` on `scratchDatabaseAt(5)` seeded with 01a items (a slot item with `stock_time_ms`, `stock_unit 'g'`, `stock_per_sale_unit 250`, `low_stock_threshold 1000`, routed at two branches; a batch item with `stock_program_id`; an untracked item; an archived tracked item), then migrate to latest: each active tracked item has a `stock_items` row with the same id, name, unit and `carries_over`, one `stock_item_branches` row per tracked route (route station, item threshold), one `stock_draws` row with factor 250; the untracked and the archived items get none. `[01c §5.1]` constraints: `menu_items_variant_pair` (group without name → `23514`), `menu_items_weighing_unit` (`requires_weighing` on `piece` → `23514`), `availability_windows_one_target` (item + deal → `23514`; deal only → OK), `modifier_option_branches` refuses `is_offered: true` with no override and `false` with one, `modifier_group_links` refuses `detach` on a category, `config_audit` accepts entity `deal_branch` and action `branch_set`.
- [ ] **Step 3:** `pnpm vitest run apps/cloud/test/db/menu-variants-migration.int.test.ts` → FAIL (no `0006`).
- [ ] **Step 4:** Write `0006_menu_variants.sql` from §5.1 (one transaction; the three backfill `INSERT … SELECT` statements, `item_routes` joined to `stations` for `station_type`); extend `AuditEntity` / `AuditAction`.
- [ ] **Step 5:** the test file → PASS; then the gate.
- **Done when:** listed tests pass; the gate is green; the existing `restaurant-schema.int.test.ts` and `staff-roles-migration.int.test.ts` still pass unchanged.
- [ ] **Commit:** `feat(01c): task 1 migration 0006 menu variants and backfill [spec §5.1, V2–V5, V18, V19; tests #27]`

### Task 2: Domain error codes — Shared

**Spec:** §9.

**Files:** Modify `packages/domain/src/errors.ts`, `packages/domain/src/errors.test.ts`.

- [ ] **Step 1: Test (write first):** `[01c §9]` the four codes exist with status 404, `httpStatus` maps them, and the catalogue matches F §6.2's 01c list (already appended, commit `0d24760`; do not edit the foundation).
- [ ] **Step 2:** `pnpm vitest run packages/domain/src/errors.test.ts` → FAIL.
- [ ] **Step 3:** Add `VARIANT_GROUP_NOT_FOUND`, `STOCK_ITEM_NOT_FOUND`, `MODIFIER_GROUP_NOT_FOUND`, `DEAL_NOT_FOUND` after `ROLE_NOT_FOUND`.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 2 error codes [spec §9]`

**Checkpoint batch 1.**

---

## Batch 2 — Domain order-line functions (§11 step 3) — Shared: `packages/domain`

All three tasks write `packages/domain/src/menu-lines.ts` and `menu-lines.test.ts` (task 5: `menu-lines.voids.test.ts`) and export through `packages/domain/src/index.ts`. Inputs are the structural types of Interfaces (P-7); no import from `@pos/events`.

### Task 3: `menu-lines.ts`: quantities, charges, allocation, line totals

**Spec:** §3.4.2–§3.4.4, V11 a and c, V18, §4.2 rows, B2, M9, m1.

**Files:** Create `packages/domain/src/menu-lines.ts`, `packages/domain/src/menu-lines.test.ts`; Modify `packages/domain/src/index.ts`.

**Interfaces — Produces:** `childQuantity`, `optionChargeMinor`, `allocateDealMinor`, `orderLineTotalMinor`, `LineTotalInput`.

- [ ] **Step 1: Tests (write first):** `[01c #1]`–`[01c #10]`, `[01c #87]`, `[01c #94]`, `[01c #95]`, `[01c #102]`, `[01c #103]`, `[01c #104]` with the exact values in §10.1 / §10.8a / §10.8b. #6's property test runs 1 000 cases and (per #104) draws totals 0 … 1 000 000 000 and weights up to `lineTotalMinor`'s largest result; #104 asserts the BigInt result `[47_960_821, 47_960_821]` and that a non-safe total throws.
- [ ] **Step 2:** `pnpm vitest run packages/domain/src/menu-lines.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement. `allocateDealMinor`: BigInt inside, floor for every weight but the last, remainder to the last, equal split only when every weight is 0 (remainder to the last), throw on a non-safe input or result (as `lineTotalMinor`). `orderLineTotalMinor`: `item` → `lineTotalMinor(price, qty, sale_unit)` + Σ charges, `null` when `quantity` is null; `option_child` → `lineTotalMinor(price, qty, 'piece')` + Σ; `deal` → price × qty + Σ part extras (piece part `extra × part qty × deal qty`, g/ml part `extra × deal qty`) + Σ part option charges; `deal_part` → 0.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; the module imports nothing outside `@pos/domain`.
- [ ] **Commit:** `feat(01c): task 3 menu-lines quantities, charges, allocation [spec §3.4.2–§3.4.4, V11, V18; tests #1–#10, #87, #94, #95, #102–#104]`

### Task 4: `menu-lines.ts`: option checks and orderability (T3)

**Spec:** §3.4.5, §3.4.6, V9, V11 d, §4.2 rows, M1, M2, N5, N6, P2, Q3, m16, §12.7 T3.

**Files:** Modify `packages/domain/src/menu-lines.ts`, `packages/domain/src/menu-lines.test.ts`.

**Interfaces — Produces:** `checkOptionChoices` (with `parent`, P-5), `isGroupSatisfiable`, `isItemOrderable`, `isDealOrderable`, `Violation`, `IsAvailable`, the `MenuLine*` types.

- [ ] **Step 1: Tests (write first):** `[01c #11]`, `[01c #12]`, `[01c #13]`, `[01c #14]`, `[01c #96]`, `[01c #97]`, `[01c #110]`, `[01c #122]` per §10. Plus `[01c §12.7 T3]`: a linked Naan option of quantity 3 on a `piece` parent of quantity 2 calls `isAvailable('Naan', 6)`; on a `g` parent of 1 250 calls `isAvailable('Naan', 3)`; with `parent.quantity: null` on a `g` parent → 3 (a g/ml parent does not need its quantity). `[01c §4.2 Q3]` a linked item absent from `itemsById` → not counted (`'line'`) and a `linked_not_orderable` violation.
- [ ] **Step 2:** `pnpm vitest run packages/domain/src/menu-lines.test.ts` → the new tests FAIL.
- [ ] **Step 3:** Implement per §3.4.6. `'child'` position: a group with `has_plain_options: false` is not offered and does not count; otherwise only its plain options count. `'line'`: a linked option counts toward Σ `max_quantity` only when `isItemOrderable(itemsById[linked], …, 'child', 1, …)`. The child quantity of a linked option is `childQuantity(optQty, parent.quantity ?? 1, parent.sale_unit)` (g/ml parent: `optQty`). Recursion stops at depth 1 (the child-position check never reads linked options).
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 4 option checks and orderability [spec §3.4.6, V9, V11 d, §12.7 T3; tests #11–#14, #96, #97, #110, #122]`

### Task 5: Void-refund conformance tests (§3.4.8)

**Spec:** §3.4.8, §4.4 04 row, N1, P4, Q4.

**Files:** Create `packages/domain/src/menu-lines.voids.test.ts` (test-only reference model: per-line refundable amount, unit count, units voided, refunded so far; the k-th unit gets share k of `allocateDealMinor(refundable, [1 × n])`, the last remaining unit the remainder; cascades refund only what is left; a partial `piece` parent void cascades `k × option_quantity` into children with `option_quantity` set, clamped). No `src` change unless a test finds a bug in `allocateDealMinor`.

- [ ] **Step 1: Tests (write first):** `[01c #117]`, `[01c #118]`, `[01c #126]` with §10.8c / §10.8d values; `[01c #119]` property test, 1 000 random deals and void sequences including later-added children with `option_quantity: null`, asserting the bounds after every step and equality once everything is voided.
- [ ] **Step 2:** `pnpm vitest run packages/domain/src/menu-lines.voids.test.ts` → FAIL first (write the model's void step as `throw` until the assertions are in place, then fill it; record in the checkpoint that the tests were watched failing).
- [ ] **Step 3:** Complete the model in the test file.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; #117 totals 320 000, #118 totals 400 000, #126 child totals equal each child's `line_total_minor`.
- [ ] **Commit:** `test(01c): task 5 void refund conformance [spec §3.4.8; tests #117–#119, #126]`

**Checkpoint batch 2.**

---

## Batch 3 — Events, snapshot types, engine (§11 steps 4–6) — Shared: `packages/events`, `packages/engine`

### Task 6: `StockSet` v2, `StockAdded` v2, engine fold — Shared

**Spec:** §4.2 events row, §5.3 rows 1–2, V5, D46.

**Files:** Create `packages/events/src/events/stock/StockSet.v2.ts`, `StockAdded.v2.ts`, `packages/events/fixtures/StockSet.v2.json`, `StockAdded.v2.json`; Modify `packages/events/fixtures/StockSet.latest.json`, `StockAdded.latest.json` (become v2; `.v1.json` untouched), `packages/events/src/index.ts`, `packages/events/src/fixtures.test.ts` (count 22 → 24; StockSet / StockAdded range tests on v2), `packages/events/testing/index.ts` (`aStockSet`, `aStockAdded` emit v2), `packages/engine/src/apply-event.ts` (fold `stock_item_id`), `apps/hub/src/commands/set-precooked-stock.ts`, `add-precooked-stock.ts` (append `schema_version: 2` with `stock_item_id: entry.item_id`; payload ids unchanged until task 18), `apps/hub/test/boot/engine-fold.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #67]` in `engine-fold.int.test.ts`: a log with a v1 `StockSet` (item id `I1`) then a v2 `StockSet` (`stock_item_id: 'I1'`) folds to one entry, latest wins. `[01c §5.3]` in `fixtures.test.ts`: `StockSet.v1.json` and `StockAdded.v1.json` upcast to their `.latest.json` (the existing loop), count 24.
- [ ] **Step 2:** `pnpm vitest run packages/events apps/hub/test/boot/engine-fold.int.test.ts` → FAIL.
- [ ] **Step 3:** Define the two v2 events with `upcastFromPrevious: (p) => ({ stock_item_id: p.item_id, … })`; `applyEvent` reads `stock_item_id`; the hub appends v2.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; no `.v1.json` file changed (`git diff --stat packages/events/fixtures/*.v1.json` empty).
- [ ] **Commit:** `feat(01c): task 6 StockSet and StockAdded v2 [spec §5.3, V5; tests #67]`

### Task 7: Snapshot schema 2 types (additive), V1 renames — Shared, Seam

**Spec:** §4.6 (shape and rules), V12, V2, V8 (no max on `modifier_group_ids`), M1 (`has_plain_options`), m5, V18; §4.2 `isStockTracked(item)`.

**Files:** Modify `packages/events/src/config.ts` (add `BranchConfigSnapshotSchemaV2` with `snapshot_schema_version: z.literal(2)`, the §4.6 arrays and item fields, not `.strict()`; rename the schema-1 types to `BranchConfigV1`, `ConfigItemV1`, `isStockTrackedV1`; the V2 types take the final names), `packages/events/src/config.test.ts`, `packages/events/testing/index.ts` (`aBranchConfig()` → schema 2, old one → `aBranchConfigV1()`), `packages/events/testing/builders.test.ts`, mechanical rename in every consumer of the V1 names (hub `sync/`, `projections/branch-config.ts`, `commands/`, `queries/stock.ts`, `ws/restaurant-catch-up.ts`, `packages/engine/src/*.ts`, hub and engine tests using `aBranchConfig()` → `aBranchConfigV1()`).

**Interfaces — Produces:** the Events config names of Interfaces; `SNAPSHOT_SCHEMA_VERSION` stays 1 until task 21.

- [ ] **Step 1: Tests (write first)** in `config.test.ts`: `[01c §4.6]` the §4.6 example (filled out to every key) parses; `modifier_group_ids` of 21 ids parses (M5); a missing `has_plain_options` fails; `group_label` is dropped (not `.strict()`); `isStockTracked({ stock_draws: [] })` false, one draw true. `[01c §4.2 P-7]` type-level: `ConfigItem` is assignable to `MenuLineItem`, `ConfigModifierGroup` to `MenuLineGroup`, `ConfigDeal` to `MenuLineDeal` (`expectTypeOf`). `builders.test.ts`: `aBranchConfig()` parses with V2; `aBranchConfigV1()` with V1.
- [ ] **Step 2:** `pnpm vitest run packages/events` → FAIL.
- [ ] **Step 3:** Implement and rename (a search-and-replace; no behaviour change outside `config.ts`).
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; `git grep -n "BranchConfig\b\|ConfigItem\b" apps packages` hits only schema-2 uses.
- [ ] **Commit:** `feat(01c): task 7 snapshot schema 2 types [spec §4.6, V12]`

### Task 8: `BusinessDayOpened` v2, day state, `dayStockUnit` / `dayDraws`, hub V2 view — Shared, Seam

**Spec:** §5.3 row 3, V20, §3.5.3, §4.2 engine row, D62, §6.20 (payload), m14; P-6.

**Files:** Create `packages/events/src/events/hub/BusinessDayOpened.v2.ts`, `packages/events/fixtures/BusinessDayOpened.v2.json`, `packages/engine/fixtures/engine-state.v2.json`, `engine-log.v2.json`, `apps/hub/src/sync/config-v2-view.ts`, `apps/hub/src/sync/config-v2-view.test.ts`; Modify `packages/events/fixtures/BusinessDayOpened.latest.json`, `packages/events/src/{index,fixtures.test}.ts` (count 25), `packages/events/testing/index.ts` (`aBusinessDayOpened` v2), `packages/engine/src/{state,stock,apply-event,version}.ts` (`ENGINE_STATE_VERSION = 2`; `dayUnits` removed), `packages/engine/src/{business-day,stock}.test.ts`, `apps/hub/src/commands/{open-business-day,set-precooked-stock,add-precooked-stock}.ts`, `apps/hub/src/queries/stock.ts`, `apps/hub/src/ws/restaurant-catch-up.ts` (every `dayUnits` call → `dayStockUnit` / `dayDraws` through `branchConfigV2()`), `apps/hub/test/commands/{business-day,business-day-restart}.int.test.ts`, `apps/hub/test/boot/engine-fold.int.test.ts`.

**Interfaces — Produces:** `BusinessDayOpenedV2`, `BusinessDay`, `DayDraws`, `dayStockUnit`, `dayDraws` (P-6 signature), `toConfigV2`, `branchConfigV2`.

- [ ] **Step 1: Tests (write first):** `[01c #66]` (fixtures loop: `BusinessDayOpened.v1.json` upcasts to its `.latest.json`; with #6's StockSet / StockAdded rows this completes #66); `[01c #108]` in `stock.test.ts` with §10.8b's case (`dayDraws(Quarter, { K1: 'g' })` uses the config draw mid-day; with config `{ K1: 'piece' }` → `stock_draws: []`; after the next open the frozen draw). Re-key: `[01a §10 #68]` folds `engine-log.v2.json` to `engine-state.v2.json` and `engine-log.v1.json` to the same v2 shape (`.v1.json` files stay); `[01a §10 #133]`, `[01a §10 #143]`, `[01a §10 #145]` assert the v2 payload `{ business_date, stock_units, draws }`; `[01a §10 #149]` asserts `dayStockUnit` / `dayDraws` instead of `dayUnits`. `[01c §5.1 P-2]` in `config-v2-view.test.ts`: `toConfigV2(aBranchConfigV1())` parses with V2, `I1` and `I3` become stock items with their own ids at station Karahi, `I3`'s draw is 250, `I2` has `stock_draws: []`, `variant_groups`, `modifier_groups`, `deals` are `[]`.
- [ ] **Step 2:** `pnpm vitest run packages/events packages/engine apps/hub/test/commands/business-day.int.test.ts apps/hub/test/commands/business-day-restart.int.test.ts apps/hub/src/sync/config-v2-view.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Upcaster per §5.3 row 3. `OpenBusinessDay` appends v2: `stock_units` for every stock item of `branchConfigV2()`, `draws` for every tracked item. `toConfigV2` applies exactly the §5.1 backfill rule (`isStockTrackedV1` decides), memoised on the V1 object.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; `git grep -n dayUnits` has no hits; `config-v2-view.ts` carries the comment `// Seam (01c plan P-2): removed by task 21`.
- [ ] **Commit:** `feat(01c): task 8 BusinessDayOpened v2 and day draws [spec §5.3, V20, §6.20; tests #66, #108; 01a #68, #133, #143, #145, #149]`

### Task 9: Engine stock functions keyed by stock item — Shared

**Spec:** V5, §4.2 engine row, §3.5.1–§3.5.2, 01a S14, S41, S44, S46 (re-keyed).

**Files:** Modify `packages/engine/src/stock.ts`, `packages/engine/src/stock.test.ts`, hub callers (`commands/set-precooked-stock.ts`, `add-precooked-stock.ts`, `queries/stock.ts`, `ws/restaurant-catch-up.ts`): pass the `ConfigStockItem` from `branchConfigV2()` (same id as the item through the view).

**Interfaces — Produces:** `stockOf`, `countIsValid`, `availableStock`, `stockLevel` with the stock-item signatures of Interfaces.

- [ ] **Step 1: Tests (write first):** `[01c #69]` (`canServeFromStock` Half 500 with 400 available → false; Full 1 000 with 1 000 → true, through `dayDraws` of `aBranchConfig()`). Re-key: `[01a §10 #66]`, `#129`, `#148`, `#157` call the stock-item signatures with `aBranchConfig().stock_items` (threshold and `carries_over` from the stock item; the threshold applies only while the day's frozen unit equals the stock item's unit).
- [ ] **Step 2:** `pnpm vitest run packages/engine` → FAIL.
- [ ] **Step 3:** Implement; engine no longer imports `ConfigItemV1`.
- [ ] **Step 4:** PASS; then the gate (hub tests still pass through the view).
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 9 engine keyed by stock item [spec V5, §4.2; tests #69; 01a #66, #129, #148, #157]`

**Checkpoint batch 3.** Open seams: V1 names (task 21), `config-v2-view.ts` (task 21).

---

## Batch 4 — Cloud wires, variant groups, items (§11 steps 7–8)

### Task 10: Admin wire schemas and `versions.ts` — Shared

**Spec:** §5.4 (version inputs, wires), §6.1–§6.16 bodies, §3.3 ranges, C6, C9, V13, V14, V19.

**Files:** Create `packages/events/src/admin/menu-variants.ts`, `packages/events/src/admin/menu-variants.test.ts`, `apps/cloud/src/modules/menu-variants/versions.ts`, `apps/cloud/src/modules/menu-variants/versions.test.ts`; Modify `packages/events/src/index.ts`.

**Interfaces — Produces:** the admin wire names and `versions.ts` functions of Interfaces.

- [ ] **Step 1: Tests (write first):** `[01c §6, C6]` keyed duplicates → issue path `options.1.option_id`, `links.1.target_id`, `parts.0.choices.1.item_id`, `stock_draws.1.stock_item_id`, `options.1.option_id` on the §6.12a body; `[01c C9]` each PATCH body with only `expected_version` fails; `[01c §6.11]` POST options with an `option_id` fail; `[01c §6.16]` `{ is_sold: false, price_minor_override: 1 }` fails; `[01c §5.4]` each version builder: exactly the §5.4 keys (snapshot of the hashed input), options by `sort_order` then id, links by kind then id, choices by `sort_order` then `item_id`, `BIGINT` strings hash like numbers, a "no row" branch input (`is_counted: false` / `is_sold: false`) has a stable version.
- [ ] **Step 2:** `pnpm vitest run packages/events/src/admin/menu-variants.test.ts apps/cloud/src/modules/menu-variants/versions.test.ts` → FAIL.
- [ ] **Step 3:** Implement (01b `staff-roles/versions.ts` style).
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 10 admin wires and versions [spec §5.4, V13, V14]`

### Task 11: Variant groups §6.1–§6.2; category in use — needs Docker Postgres

**Spec:** §6.1, §6.2 (R1, R2; R3 lands in task 23), §3.2.4, V2, V13, V15, V16 (category), C5, §6 lock order (3 → 4 members → 6 → 10).

**Files:** Create `apps/cloud/src/modules/menu-variants/{routes,service,repository}.ts`, `apps/cloud/test/menu-variants/variant-groups.int.test.ts`, `apps/cloud/test/helpers/menu-variants.ts`; Modify `apps/cloud/src/server.ts` (register routes), `apps/cloud/src/modules/restaurant/service.ts` (`patchCategory` V16), `apps/cloud/test/helpers/route-cases.ts` (2 routes; `BIds` + `variantGroupId`), `apps/cloud/test/cross-tenant.int.test.ts` (seed tenant B's variant group).

- [ ] **Step 1: Tests (write first):** `[01c #15]`–`[01c #20]`; Review Focus 2 `[01c V16]` archive a category used by an active variant group → `409 CONFIG_IN_USE { entity: 'category', used_by: { entity: 'variant_group', ids } }`, with the group archived → `200`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/variant-groups.int.test.ts apps/cloud/test/cross-tenant.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement. §6.2: lock the group `FOR UPDATE` → version → when `category_id` changes, lock every member (active and archived) `FOR UPDATE` in `item_id` order → category `FOR SHARE` → no-op → R1, R2 → `UPDATE menu_items … WHERE variant_group_id = $1 RETURNING *` → one multi-row audit insert (group + one `menu_item` / `update` per moved member, `branch_id` null) → bump every branch.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; both routes are in `ROUTE_CASES`.
- [ ] **Commit:** `feat(01c): task 11 variant groups [spec §6.1, §6.2, V2, V16; tests #15–#20]`

### Task 12: Item wire, §6.4 POST, §6.3 menu read — Shared, needs Docker Postgres

**Spec:** §6.4 (body, lock order 3 → 5 → 6 → 7 → 8 → 9, edge table), §6.3, V2, V4, V18 (POST checks), §5.1 deprecated columns (P-11), A11.

**Files:** Modify `packages/events/src/admin/restaurant.ts` (item body: + `variant_group_id`, `variant_name`, `stock_draws` (0–1), `requires_weighing`; − `group_label`, `stock_unit`, `stock_per_sale_unit`, `low_stock_threshold`, `carries_over`; `MenuItem` wire and `MenuResponse` per §6.3 with `variant_groups`), `apps/cloud/src/modules/restaurant/{service,repository}.ts` (`createMenuItem`, `listMenu`, `selectMenuPage`, `insertMenuItem`; draws repository functions `selectDrawsOf(itemIds)`, `insertDraws`), `apps/cloud/test/restaurant/{menu-items,menu-read}.int.test.ts`, `apps/cloud/test/menu-variants/items.int.test.ts` (create), client compile fixes only: `apps/client/src/features/owner/menu/{ItemForm,MenuView}.tsx` and their tests, `apps/client/src/features/owner/owner-pages.test.tsx` (remove the unit and `group_label` fields; the new sections are task 34).

- [ ] **Step 1: Tests (write first):** `[01c #22]`, `[01c #23]`, `[01c #26]` (8 statements by `pgCounter`); Review Focus 3 `[01c §6.4]` archived / foreign variant group → `422 archived` / `not_found`, nothing written; `[01c §6.4 V18]` `requires_weighing: true` with `sale_unit 'piece'` → `400`, with a draw → `422 weighed_item_stock_draw` (field `stock_draws`); `[01c §5.1 P-11]` the stored deprecated columns are `stock_unit = sale_unit`, `1`, `null`, `false`, `null`. Retire `[01a §10 #41]` (delete it; note "replaced by 01c #21, task 22" in the commit body). Fixture-only edits in `menu-items` / `menu-read` tests (01a #33–#37, #40, #88, #138, #139 keep their assertions).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/items.int.test.ts apps/cloud/test/restaurant` → FAIL.
- [ ] **Step 3:** Implement. Delete `assertUnits`; references `FOR SHARE` in the order variant group (3), stock item (5), category (6), tax class (7), stations / programs (8); then the §3.3 item rows; insert item, draw row, routes, windows; audit (draw inside `after`); bump. Menu read: `q` matches `m.name` or the group's `name`; page draws `= ANY($ids)`.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; `GET /v1/admin/menu` is 8 statements.
- [ ] **Commit:** `feat(01c): task 12 item wire, create and menu read [spec §6.3, §6.4, V2, V4, V18; tests #22, #23, #26; 01a #41 retired]`

### Task 13: §6.5 lock order, restart rule, variant fields, rule precedence — needs Docker Postgres

**Spec:** §6.5 (restart rule, R1, R1a, R5, "Rule precedence" with the v1.0 T4 sentence), §6 "§6.5 restart rule", M3, N2, M6, V13; §12.7 T4 (P-8); "Changes to today's code" rows 1–2.

**Files:** Modify `apps/cloud/src/modules/restaurant/service.ts` (`patchMenuItem` restructured; `withItemRestart`), `apps/cloud/src/modules/restaurant/repository.ts` (`readMenuItem` unlocked, `shareVariantGroups(ids)`), `apps/cloud/src/server.ts` (`CloudTestHooks.beforeItemLock`), `packages/events/src/admin/restaurant.ts` (PATCH body pair rule: `variant_group_id` and `variant_name` both null or neither → `400`); Create `apps/cloud/test/menu-variants/item-patch.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #101]` (both parts: an archived member moves with its group; restoring a member whose group is archived → `422 { field: 'variant_group_id', reason: 'archived' }`, nothing written); `[01c #111]`; `[01c #120]` a, b, c through `beforeItemLock` (c: the hook moves the item to another group on every attempt → `503 SERVICE_UNAVAILABLE` after 3, nothing written); `[01c §6.5]` leave a group `{ variant_group_id: null, variant_name: null }` → `200`; one of them null alone → `400`; variant name taken → `409 { entity: 'variant' }` (R5); `[01c §6.5 T4]` re-sending an unchanged archived category on an archived item → `200` no-op.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/item-patch.int.test.ts apps/cloud/test/restaurant/menu-patch.int.test.ts` → the new tests FAIL.
- [ ] **Step 3:** Implement P-8's order as one ordered list of rule functions in `patchMenuItem` (slots for R3 and R8 left as named no-ops with a `// task 23` / `// task 30` comment), and `withItemRestart`: run the transaction; on a group mismatch after the item lock throw an internal restart signal, roll back, retry; after attempt 3 throw `DomainError('SERVICE_UNAVAILABLE')`.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; no `40P01` in any run; an item lock is never followed by a group lock (code review of the lock calls).
- [ ] **Commit:** `feat(01c): task 13 item PATCH lock order, restart and variant rules [spec §6.5, M3, N2, §12.7 T4; tests #101, #111, #120]`

### Task 14: §6.5 stock draw and weighing rules — needs Docker Postgres

**Spec:** §6.5 R2, R7, R9, `stock_draws` replace (delete + insert), V4, V18, N8, S26; P-11.

**Files:** Modify `apps/cloud/src/modules/restaurant/{service,repository}.ts`, `apps/cloud/test/menu-variants/item-patch.int.test.ts`, `apps/cloud/test/restaurant/menu-patch.int.test.ts` (01a #128), `apps/cloud/test/helpers/menu-variants.ts` (`createStockItem` via SQL until task 16 adds the route; switch to the API in task 16).

- [ ] **Step 1: Tests (write first):** `[01c #24]`, `[01c #85]`, `[01c #123]`; `[01c §6.5 R7]` `sale_unit: 'piece'` alone onto a weighed `g` item → `400`; Review Focus 1 `[01c §6.5 S26]` re-sending the stored draw → `200`, no audit, no bump; a draw-only change → one audit row with the draw in `before` / `after`, every branch bumped. Re-key `[01a §10 #128]`: units now live on the draw: a `g` stock item with factor 250 on a `piece` item → PATCH response and menu read carry `stock_draws: [{ stock_item_id, quantity_per_sale_unit: 250 }]`; the 400s become the R2 `422 unit_mismatch` and the R7 `400`; a draw change is audited (the snapshot side is #21 / #58, task 22 / 21).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/item-patch.int.test.ts apps/cloud/test/restaurant/menu-patch.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement R2 (merged `sale_unit` vs the merged draw's stock item `stock_unit`, read under its `FOR SHARE`), R7 (400 part in the 400 slot, draw part in the 422 slot), R9 (restore only). The no-op compares the merged row, windows and draws.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 14 item PATCH draw and weighing rules [spec §6.5 R2, R7, R9, V4, V18; tests #24, #85, #123; 01a #128]`

### Task 15: §6.5 in-use rules R4, R10, R6 and test 128 (T4) — needs Docker Postgres

**Spec:** §6.5 R4, R6, R10, rule precedence, edge rows, V16, D-3, P1, Q2; §12.7 T4 (extra case); P-4, P-8.

**Files:** Modify `apps/cloud/src/modules/restaurant/{service,repository}.ts` (`linkingGroupIds(itemId)` over active options of active groups; `offeringDealIds(itemId)`; `dealsBrokenBySaleUnit(itemId, saleUnit)`: one statement over `deal_part_choices_item`), `apps/cloud/test/helpers/menu-variants.ts` (`seedModifierGroupRows`, `seedDealPartRows`); Create `apps/cloud/test/menu-variants/item-in-use.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #25]`, `[01c #83]`, `[01c #128]` (all §10.8e cases) plus the T4 case in #128: linked Naan with `stock_time_ms` set, PATCH `{ sale_unit: 'g', cook_time_ms: <stock_time_ms> - 1 }` → `409 CONFIG_IN_USE { used_by: { entity: 'modifier_group', ids: [Bread] } }`, nothing written. Rows seeded with SQL (P-4).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/item-in-use.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement R4 (archive), R10 (`sale_unit` away from `piece`, or `requires_weighing` on), R6 (`sale_unit` change that makes a part mix units) in the 409 slot, in the order R4, R10, R6.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 15 item in-use rules and precedence [spec §6.5 R4, R6, R10, V16, D-3, §12.7 T4; tests #25, #83, #128]`

**Checkpoint batch 4.**

---

## Batch 5 — Stock items (§11 step 9)

### Task 16: Stock items §6.6–§6.8 — needs Docker Postgres

**Spec:** §6.6, §6.7, §6.8 (R1–R3), V3, V4, V13, §6 lock order (5 → 10).

**Files:** Modify `apps/cloud/src/modules/menu-variants/{routes,service,repository}.ts`, `apps/cloud/test/helpers/{route-cases,menu-variants}.ts` (3 routes; `createStockItem` through the API), `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/menu-variants/stock-items.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #28]`, `[01c #29]`, `[01c #30]`, `[01c #35]` (4 statements by `pgCounter`); `[01c §6.8]` stale → `409 CONFIG_STALE { entity: 'stock_item' }`; body only `expected_version` → `400`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/stock-items.int.test.ts apps/cloud/test/cross-tenant.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement; R1 and R2 read the drawers without a lock (active items only).
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; the routes are in `ROUTE_CASES`.
- [ ] **Commit:** `feat(01c): task 16 stock items [spec §6.6–§6.8, V3; tests #28–#30, #35]`

### Task 17: Stock item branch PUT §6.9; station in use — needs Docker Postgres

**Spec:** §6.9 (script, edge table), V3, V16 (station), M4, P3 (5 → 8 → 9 → 10), C2; P-10.

**Files:** Modify `apps/cloud/src/modules/menu-variants/{routes,service,repository}.ts`, `apps/cloud/src/modules/restaurant/{service,repository}.ts` (`patchStation` archive: + `activeStockItemIdsAt(branchId, stationId)`), `apps/cloud/test/helpers/route-cases.ts`; Create `apps/cloud/test/menu-variants/stock-item-branches.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #31]`–`[01c #34]`; Review Focus 5 `[01c V16 P-10]` station archive with a row of an archived stock item only → `200`; `[01c §6.9]` a threshold with `station_id: null` → `400`; on a set, an archived stock item → `422 { field: 'stock_item_id', reason: 'archived' }`; stale → `409 { entity: 'stock_item_branch', id: stock_item_id }`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/stock-item-branches.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement the §6.9 script exactly (stock item `FOR UPDATE` → C2 branch read in the transaction → stored row read unlocked → version → payload checks with the station `FOR SHARE` → no-op → upsert / delete → audit `branch_set` / `branch_removed` with `branch_id` → bump that branch).
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 17 stock item branch rows and station in-use [spec §6.9, V16; tests #31–#34]`

**Checkpoint batch 5.**

---

## Batch 6 — Hub and stock page on stock items (§11 steps 14, 15 stock page) — runs on the task 8 view

### Task 18: Hub stock commands by stock item — Shared

**Spec:** §6.18, §6.19, §6.20, 01b B1 / B20 (`my_stations` by `stock_item.station_id`), C6, C8, S45, D-6.

**Files:** Modify `packages/events/src/admin/hub.ts` (`SetPrecookedStockPayload` / `AddPrecookedStockPayload` entries `{ stock_item_id, … }`; results `{ stock_items: [...] }`), `apps/hub/src/commands/{set-precooked-stock,add-precooked-stock,open-business-day}.ts`, `apps/hub/test/commands/{set-precooked-stock,add-precooked-stock,business-day-restart}.int.test.ts`, client send side only: `apps/client/src/features/admin/stock/{draft,AddSheet,StockTable}.ts(x)` and `apps/client/src/api/hub-admin.ts` (send `stock_item_id`, the row's id; read `stock_items` results).

**Interfaces — Produces:** the hub names of Interfaces (task 18 row).

- [ ] **Step 1: Tests (write first):** `[01c #63]`, `[01c #64]`, `[01c #65]` (`403 outside_scope { stock_item_ids }` after the 404 / 409 checks), `[01c #68]`, `[01c #79]`. Re-key `[01a §10 #59]`, `#60`, `#61`, `#130`, `#134`, `#147` to `stock_item_id` entries and `STOCK_ITEM_NOT_FOUND`.
- [ ] **Step 2:** `pnpm vitest run apps/hub/test/commands` → FAIL.
- [ ] **Step 3:** Implement. Lookup in `branchConfigV2().stock_items`; unit `dayStockUnit(state, stockItem)`; scope `requireStockItemsInScope`; `SetItemAvailability` unchanged (item route station).
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; `git grep -n STOCK_NOT_TRACKED apps/hub/src` has no hits.
- [ ] **Commit:** `feat(01c): task 18 hub stock commands by stock item [spec §6.18–§6.20, 01b B1; tests #63–#65, #68, #79; 01a #59–#61, #130, #134, #147]`

### Task 19: Hub stock query and catch-up by stock item (additive wire) — Shared, Seam

**Spec:** §6.21 (`stock_items_meta`, `stock`, `has_tracked_drawers`, `items_meta` / `items` with `stock_item_ids`), §4.2 catch-up row, A7, 01b B1, §5.3 (test 114); P-2 c.

**Files:** Modify `packages/events/src/admin/hub.ts` (`StockQueryResponse` + `stock_items_meta`, `stock`; the old unit and number fields kept, commented `// Seam: removed by task 20`), `apps/hub/src/queries/stock.ts`, `apps/hub/src/ws/restaurant-catch-up.ts` (`stock.items` keyed by `stock_item_id`), `apps/hub/test/queries/stock.int.test.ts`, `apps/hub/test/ws/restaurant-ws.int.test.ts`, `apps/hub/test/boot/engine-fold.int.test.ts`, `apps/hub/test/commands/stock-scope.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #70]` (one row per stock item with drawers; 1 statement when numbers are sent; no deal rows); `[01c #114]`. Re-key `[01a §10 #67]`, `#72`, `#73`, `#89`, `#91`, `#93`, `#116`, `#131`, `#152`, `#158` to stock items; `[01b #34]` per the 01b v1.2 B3 marker (`my_stations` lists only stock items counted at the person's stations, with their menu items under them; outside `stock_item_id` → `403`; `SetItemAvailability` still checks the item's route station).
- [ ] **Step 2:** `pnpm vitest run apps/hub/test/queries/stock.int.test.ts apps/hub/test/ws apps/hub/test/boot/engine-fold.int.test.ts apps/hub/test/commands/stock-scope.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement. `stock_items_meta` with the day's `stock_unit`, drawers with the day's `quantity_per_sale_unit` (`dayDraws`); `has_tracked_drawers` from drawers present; `meta_version` and the scope key over stock item ids.
- [ ] **Step 4:** PASS; then the gate (the client still reads the old fields).
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 19 hub stock query and catch-up by stock item [spec §6.21, A7; tests #70, #114; 01a #67, #72, #73, #89, #91, #93, #116, #131, #152, #158; 01b #34]`

### Task 20: Stock page per stock item; wire contraction — Shared, Seam

**Spec:** §8 "Stock page (hub)", §3.5.4, A14, §6.21 (`items_meta` without unit fields); P-2 c.

**Files:** Modify `apps/client/src/features/admin/stock/{StockApp,StockTable,AddSheet,StartDay,main}.tsx`, `{draft,badges}.ts`, their tests `{StockTable,BusinessDay,stock-pages}.test.tsx`, `draft.test.ts`, `apps/client/src/api/hub-admin.ts`, `apps/client/src/i18n/{en,ur}.ts` ("Not used by any dish here"), `packages/events/src/admin/hub.ts` (remove the seam fields), `apps/hub/src/queries/stock.ts`, `apps/hub/test/queries/stock.int.test.ts`.

- [ ] **Step 1: Tests (write first):** re-key `[01a §10 #77]`, `#132` (hub and client files), `#156` (hub and client files), `#166`, `#167`, `#171`: one row per stock item (count, add, level), its drawers listed under it with sale units available, availability toggles per menu item; `[01c §8]` a row with `has_tracked_drawers: false` shows "Not used by any dish here" and still allows a count. The client half of `[01a §10 #133]` in `BusinessDay.test.tsx` gets fixture edits only (P-3).
- [ ] **Step 2:** `pnpm vitest run apps/client/src/features/admin/stock apps/hub/test/queries/stock.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement; remove the seam fields from the wire and the hub.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; `git grep -n "Seam: removed by task 20"` has no hits.
- [ ] **Commit:** `feat(01c): task 20 stock page per stock item [spec §8, §3.5.4; 01a #77, #132, #156, #166, #167, #171]`

**Checkpoint batch 6.** Open seams: V1 names and `config-v2-view.ts` (task 21).

---

## Batch 7 — Snapshot schema 2 cut-over (§11 step 12, base)

### Task 21: Snapshot schema 2 cut-over: builder base, hub intake — Shared, Seam (removes), needs Docker Postgres

**Spec:** §6.17, §4.6 rules 1, 4, V12 (tracked rule), §3.2.1–§3.2.2, 01a S27, S28 b, d; B1 (programs[]); P-2 a, b.

**Files:** Modify `packages/events/src/config.ts` (`SNAPSHOT_SCHEMA_VERSION = 2`; delete `BranchConfigSnapshotSchemaV1`, `BranchConfigV1`, `ConfigItemV1`, `isStockTrackedV1`), `packages/events/testing/index.ts` (delete `aBranchConfigV1`), `packages/events/src/config.test.ts`, `apps/cloud/src/modules/config-sync/builder.ts` (+ 3 statements: variant groups with a routed member, stock items with this branch's rows, draws; `modifier_groups: []`, `deals: []`, items `modifier_group_ids: []` until tasks 27 and 31), `apps/hub/src/sync/config-poller.ts`, `apps/hub/src/projections/branch-config.ts` (parse V2), delete `apps/hub/src/sync/config-v2-view.ts` and its test (callers → `branchConfig()`), `apps/cloud/test/config-sync/{builder,sync-config,sync-gzip-e2e}.int.test.ts`, `apps/cloud/test/cli/set-branch-settings.int.test.ts`, `apps/hub/test/sync/{poller,poller-schema,poller-boot}.int.test.ts` and every hub test still on `aBranchConfigV1()` (fixture edits only).

- [ ] **Step 1: Tests (write first):** `[01c #57]`, `[01c #58]`, `[01c #60]`, `[01c #61]` (hub on schema 2 receiving a schema-1 body → `schema_unsupported`, last config kept), `[01c #93]`; re-key `[01a §10 #4]` (snapshot contents, schema 2; the builder fixture seeds stock items, branch rows and draws by SQL).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/config-sync apps/hub/test/sync` → FAIL.
- [ ] **Step 3:** Implement. Stock items sorted by `toLowerCase()` name, then id, in JS; an item's `stock_draws` only when the stock item is counted here and the route tracks (slot `stock_time_ms` not null, batch `stock_program_id` not null); `requires_weighing` copied. Remove the seam; every hub `branchConfigV2()` call becomes `branchConfig()`.
- [ ] **Step 4:** PASS; then the gate (01a #140's ≤ 13 still holds: 10 statements).
- **Done when:** the gate is green; `git grep -n "V1\b\|branchConfigV2\|config-v2-view" apps packages` finds no seam name; `isStockTracked` takes one argument everywhere.
- [ ] **Commit:** `feat(01c): task 21 snapshot schema 2 cut-over [spec §6.17, §4.6, V12, S28; tests #57, #58, #60, #61, #93; 01a #4]`

### Task 22: Builder item contents; `has_tracked_drawers` — needs Docker Postgres

**Spec:** §4.6 rules 1, 4, V2 (own fields per variant), V18, §6.21 F4, 01a §6.16 (route rules), E0-MENU AC4.

**Files:** Modify `apps/cloud/test/config-sync/builder.int.test.ts` or Create `apps/cloud/test/menu-variants/snapshot-items.int.test.ts`; `apps/hub/test/queries/stock.int.test.ts`; `src` only where a test finds a gap.

- [ ] **Step 1: Tests (write first):** `[01c #21]` (through the API: variant group, stock item, §6.9 rows, Half and Full with draws 500 / 1 000; Full routed to station Grill); `[01c #80]`; `[01c #84]` (the POST 400, PATCH 400 and the `201` with `requires_weighing: true` in the snapshot); `[01c #82]` on the hub; Review Focus 4 `[01c §6.21]` `SetPrecookedStock` on that stock item → `200`, one `StockSet` v2.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/snapshot-items.int.test.ts apps/hub/test/queries/stock.int.test.ts` → FAIL (watch each fail on its snapshot or `has_tracked_drawers` assertion; if one passes at once, record it in the checkpoint and show it failing with the relevant builder line reverted).
- [ ] **Step 3:** Implement any gap.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `test(01c): task 22 snapshot item contents and has_tracked_drawers [spec §4.6, V2, V18, F4; tests #21, #80, #82, #84]`

**Checkpoint batch 7.** No seam is open.

---

## Batch 8 — Modifier groups (§11 steps 10, 18)

### Task 23: Modifier group POST §6.11; effective set and its limit — needs Docker Postgres

**Spec:** §6.11 (script, edge table), V6, V8, §3.3 group rows, effective-set row, M5, m13, §6 lock order (3 → 4 → 6 → 10); §6.2 R3, §6.4, §6.5 R3 (the limit on item writes).

**Files:** Create `apps/cloud/src/modules/menu-variants/effective-set.ts`, `effective-set.test.ts`, `apps/cloud/test/menu-variants/modifier-groups-create.int.test.ts`; Modify `apps/cloud/src/modules/menu-variants/{routes,service,repository}.ts`, `apps/cloud/src/modules/restaurant/service.ts` (fill the R3 slot of `patchMenuItem`; the §6.4 check), `apps/cloud/test/helpers/{route-cases,menu-variants}.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #38]`, `[01c #39]`, `[01c #40]`, `[01c #41]` (both halves); `effective-set.test.ts` `[01c V8]`: most specific link wins (item > variant group > category), a lower-level attach re-adds, archived targets ignored, order by group `sort_order` then id.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/src/modules/menu-variants/effective-set.test.ts apps/cloud/test/menu-variants/modifier-groups-create.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement. References `FOR SHARE`: variant groups, then items (linked and target items in one `= ANY`, `item_id` order), then categories; option-name uniqueness in one `lower(name)` statement; insert group, options, links (multi-row); one audit row; bump every branch.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 23 modifier group create and effective set [spec §6.11, V8, §3.3; tests #38–#41]`

### Task 24: Modifier group PATCH §6.12: options and links rewrite — needs Docker Postgres

**Spec:** §6.12 (script, edge table), V14 (upsert options; links delete + insert), V13, V15, C1, C6, m15.

**Files:** Modify `apps/cloud/src/modules/menu-variants/{routes,service,repository}.ts`, `apps/cloud/test/helpers/route-cases.ts`; Create `apps/cloud/test/menu-variants/modifier-groups-patch.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #42]`–`[01c #47]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/modifier-groups-patch.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement: one multi-row `INSERT … ON CONFLICT (tenant_id, option_id) DO UPDATE` for sent options plus one `UPDATE … SET archived_at` for omitted active ones; sent ids must be options of this group (active or archived) else `422 not_found`; links re-checked only when added or changed.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 24 modifier group PATCH rewrite [spec §6.12, V14, V15; tests #42–#47]`

### Task 25: Modifier group PATCH merged rules R1–R6 (T1) — needs Docker Postgres

**Spec:** §6.12 R1–R6, Q1, m13, §12.7 T1 (P-9).

**Files:** Modify `apps/cloud/src/modules/menu-variants/{service,repository}.ts`, `apps/cloud/test/menu-variants/modifier-groups-patch.int.test.ts`, `apps/cloud/test/menu-variants/modifier-groups-create.int.test.ts` (#116's POST case).

- [ ] **Step 1: Tests (write first):** `[01c #48]`, `[01c #112]`, `[01c #116]` (POST and PATCH), `[01c #125]` as explicit steps (T1): (1) Naan `piece`, linked by active Bread → PATCH Naan `sale_unit: 'g'` → `409` modifier group; (2) `{ requires_weighing: true, sale_unit: 'g' }` → same `409`; (3) archive the option → `sale_unit: 'g'` `200`; (4) Naan back to `piece`, restore the option `200`; (5) archive Bread → Naan `g` → `200`; (6) PATCH Bread `{ archived: false }` → `422 { field: 'options.0.linked_item_id', reason: 'linked_item_not_piece' }`, Bread still archived; (7) Naan `requires_weighing: true` (still `g`) → restore → `422 linked_item_not_piece`; (8) Naan `requires_weighing: false`, `sale_unit: 'piece'`, then archived → restore → `422 archived`; (9) Naan archived **and** `g` → `422 archived` (archived checked first, T1); (10) Naan restored as an active `piece` item → restore Bread `200`. `[01c §12.7 T1]` a rename of an active group takes no `FOR SHARE` on linked items (statement log by `pgCounter` shows no linked-item lock).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/modifier-groups-patch.int.test.ts apps/cloud/test/menu-variants/modifier-groups-create.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement R1–R6 per P-9 (R5 through `assertEffectiveSetLimit` when `links` is sent).
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 25 modifier group merged rules [spec §6.12 R1–R6, §12.7 T1; tests #48, #112, #116, #125]`

### Task 26: Modifier group list §6.10 and branch PUT §6.12a — needs Docker Postgres

**Spec:** §6.10, §6.12a (script, edge table), V19, m4, AU-1, AU-3, AU-6.

**Files:** Modify `apps/cloud/src/modules/menu-variants/{routes,service,repository}.ts`, `apps/cloud/test/helpers/route-cases.ts` (2 routes); Create `apps/cloud/test/menu-variants/modifier-group-branches.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #77]` (5 statements for 1 and 30 groups), `[01c #90]`, `[01c #91]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/modifier-group-branches.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement; normalise away default entries; delete only rows of active options at the branch.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 26 modifier group list and branch PUT [spec §6.10, §6.12a, V19; tests #77, #90, #91]`

### Task 27: Builder: modifier groups and effective sets — needs Docker Postgres

**Spec:** §4.6 rules 3, 6, V8, V9 (`has_plain_options`), F1, M5, m5, m15.

**Files:** Modify `apps/cloud/src/modules/config-sync/builder.ts` (+ groups with options, links: 2 statements; `effectiveGroupIds` in memory); Create `apps/cloud/test/menu-variants/snapshot-modifiers.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #36]`, `[01c #37]`, `[01c #81]`, `[01c #100]`, `[01c #109]`, `[01c #113]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/snapshot-modifiers.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement (only referenced groups in `modifier_groups[]`; a required group left empty kept with `options: []`; an optional empty one dropped from both lists; no cap on `modifier_group_ids`).
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 27 snapshot modifier groups [spec §4.6 rules 3, 6, V8, F1; tests #36, #37, #81, #100, #109, #113]`

### Task 28: Builder: options per branch and backstop — needs Docker Postgres

**Spec:** §4.6 rule 2 (incl. the Q1 backstop), V19 (price order), V7, AU-4.

**Files:** Modify `apps/cloud/src/modules/config-sync/builder.ts` (+ this branch's option rows: 1 statement), `apps/cloud/test/menu-variants/snapshot-modifiers.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #59]`, `[01c #88]`, `[01c #89]`, `[01c #92]`, `[01c #106]`, `[01c #127]` (statement count unchanged against task 27 + 1).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/snapshot-modifiers.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement: drop `is_offered: false`, drop a linked option whose item is unrouted, archived, not `piece` or weighed; price = branch override, else option price, else the linked item's effective branch price.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 28 snapshot options per branch [spec §4.6 rule 2, V19; tests #59, #88, #89, #92, #106, #127]`

**Checkpoint batch 8.**

---

## Batch 9 — Deals (§11 steps 11, 17, 19)

### Task 29: Deal list §6.13, POST §6.14; category and tax class in use — needs Docker Postgres

**Spec:** §6.13, §6.14 (script, edge table), V10, V11, V18 (choice weighed), V16 (category, tax class), §6 lock order (4 → 6 → 7 → 10).

**Files:** Modify `apps/cloud/src/modules/menu-variants/{routes,service,repository}.ts` (windows through `availability_windows.deal_id`: `WindowTarget` gains `{ deal_id }` in `restaurant/repository.ts`), `apps/cloud/src/modules/restaurant/service.ts` (`patchCategory`, `patchTaxClass` + active deals), `apps/cloud/test/helpers/{route-cases,menu-variants}.ts` (2 routes); Create `apps/cloud/test/menu-variants/deals.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #49]`, `[01c #50]`, `[01c #51]`, `[01c #56]`, `[01c #78]` (5 statements for 1 and 20 deals); `[01c §6.14 V18]` a weighed choice → `422 weighed_item_in_deal` field `parts.0.choices.0.item_id`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/deals.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 29 deal list and create [spec §6.13, §6.14, V10, V16; tests #49–#51, #56, #78]`

### Task 30: Deal PATCH §6.15; weighed items in deals — needs Docker Postgres

**Spec:** §6.15 (R1–R5, notes), V14 (parts upsert; choices rewritten, FK order), m3; §6.5 R8 (P-8 slot).

**Files:** Modify `apps/cloud/src/modules/menu-variants/{routes,service,repository}.ts`, `apps/cloud/src/modules/restaurant/service.ts` (fill the R8 slot), `apps/cloud/test/helpers/route-cases.ts`, `apps/cloud/test/menu-variants/deals.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #52]`, `[01c #53]`, `[01c #86]` (deal side and item R8 side), `[01c #105]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/deals.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green.
- [ ] **Commit:** `feat(01c): task 30 deal PATCH and weighed items in deals [spec §6.15, §6.5 R8, V14, V18; tests #52, #53, #86, #105]`

### Task 31: Deal branch PUT §6.16; builder deals; statement bounds — needs Docker Postgres

**Spec:** §6.16, §4.6 rule 5, V11 c (reference choice per branch, AU-11), V11 e, m5, §6.17 (builder = 01a's 7 + 9), 01a §10 #140 (≤ 22).

**Files:** Modify `apps/cloud/src/modules/menu-variants/{routes,service,repository}.ts`, `apps/cloud/src/modules/config-sync/builder.ts` (+ deals with parts and choices, deal windows, deal branch rows: 3 statements), `apps/cloud/test/helpers/route-cases.ts`, `apps/cloud/test/config-sync/sync-gzip-e2e.int.test.ts`; Create `apps/cloud/test/menu-variants/snapshot-deals.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #54]`, `[01c #55]`, `[01c #62]` (fixed for 1 and 50 deals), `[01c #107]` (all three parts); re-key `[01a §10 #140]` to ≤ 22.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/menu-variants/snapshot-deals.int.test.ts apps/cloud/test/config-sync/sync-gzip-e2e.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement (§6.16 script with the deal `FOR UPDATE`; builder omits a deal with no branch row or a part with no routed choice, and unrouted choices).
- [ ] **Step 4:** PASS; then the gate.
- **Done when:** the gate is green; the builder is 16 statements.
- [ ] **Commit:** `feat(01c): task 31 deal branch PUT and snapshot deals [spec §6.16, §4.6 rule 5, V11; tests #54, #55, #62, #107; 01a #140]`

**Checkpoint batch 9.**

---

## Batch 10 — Races (§11 step 13; route cases already landed with their routes)

Barrier tests use the existing `afterTargetLock` / `afterReferenceLock` hooks (and `beforeItemLock`, task 13). A race test that passes at once must be shown failing with the lock it relies on removed (record it in the checkpoint), as in 01b.

### Task 32: Races 73–76 — needs Docker Postgres

**Files:** Create `apps/cloud/test/menu-variants/races-a.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #73]`, `[01c #74]`, `[01c #75]`, `[01c #76]`.
- [ ] **Step 2–4:** run; watch fail with the named lock removed; restore; PASS; the gate.
- **Done when:** the gate is green; no `40P01`.
- [ ] **Commit:** `test(01c): task 32 races version, archive, unit, deal PUT [spec §6 lock order; tests #73–#76]`

### Task 33: Races 98, 99, 121 — needs Docker Postgres

**Files:** Create `apps/cloud/test/menu-variants/races-b.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #98]`, `[01c #99]`, `[01c #121]`.
- [ ] **Step 2–4:** as task 32.
- **Done when:** the gate is green; no `40P01`.
- [ ] **Commit:** `test(01c): task 33 races lock order [spec §6 lock order, M3, M4, N3; tests #98, #99, #121]`

**Checkpoint batch 10.**

---

## Batch 11 — Owner app views (§11 step 15)

Component tests with the mocked API of `features/owner/test-api.ts`. Every view: `can_edit_tenant: false` → read-only (branch rows stay editable for allowed branches); `409 CONFIG_STALE` → "Changed elsewhere — reload", draft kept, no blind retry; `422` field paths map to the row as sent; "Removed" rows with **Restore**; new i18n keys in `en.ts` and `ur.ts`, including `errors.CONFIG_REFERENCE_INVALID.<reason>` for the nine new reasons (§8). Navigation entries in `features/owner/{App,Shell}.tsx`.

### Task 34: Owner item form: variant, stock, weighed; create-stock-item flow

**Spec:** §8 "Views" (item form), m7, N9, V18.

**Files:** Modify `apps/client/src/features/owner/menu/{ItemForm,MenuView}.tsx`, `ItemForm.test.tsx`, `apps/client/src/api/cloud-admin.ts` (stock item and variant group calls), `apps/client/src/i18n/{en,ur}.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #124]`; `[01c §8]` the Variant section sends `variant_group_id` / `variant_name`; the Stock section shows "uses per sale" in the stock item's unit through `parseQuantity` / `formatQuantity`; "Weighed when served" shows only for kg / L and hides the Stock section.
- [ ] **Step 2:** `pnpm vitest run apps/client/src/features/owner/menu` → FAIL.
- [ ] **Step 3:** Implement; the create flow keeps one `Idempotency-Key` for the POST across retries and re-reads §6.6 before any retry, sending only the calls still needed.
- [ ] **Step 4:** PASS; then the gate.
- [ ] **Commit:** `feat(01c): task 34 item form variant, stock, weighed [spec §8, m7, N9; tests #124]`

### Task 35: Owner views: variant groups, stock items

**Spec:** §8 (Variant groups; Stock items with "Counted here at station …, alert below …").

**Files:** Create `apps/client/src/features/owner/menu-variants/{VariantGroupsView,StockItemsView}.tsx` and tests; Modify `apps/client/src/api/cloud-admin.ts`, `features/owner/{App,Shell}.tsx`, `i18n/{en,ur}.ts`.

- [ ] **Step 1: Tests (write first):** `[01c §8]` list, create, rename, archive / restore with `expected_version`; a stale save shows the reload notice and keeps the draft; a per-branch row PUT sends that row's `version`; read-only for `can_edit_tenant: false`.
- [ ] **Steps 2–4:** fail; implement; PASS; the gate.
- [ ] **Commit:** `feat(01c): task 35 owner variant group and stock item views [spec §8]`

### Task 36: Owner view: modifier groups with the per-branch tab

**Spec:** §8 (options table, "Applies to" attach / opt-out, per-branch "Offered here / Price here", F1 warning).

**Files:** Create `apps/client/src/features/owner/menu-variants/ModifierGroupsView.tsx` and test; Modify `api/cloud-admin.ts`, `{App,Shell}.tsx`, `i18n/{en,ur}.ts`.

- [ ] **Step 1: Tests (write first):** `[01c §8]` options sent with ids for existing rows and none for new; omitted rows listed under "Removed" with Restore; the branch tab sends the whole difference list (§6.12a) with the branch version; a required group with no option offered at a branch shows the F1 warning.
- [ ] **Steps 2–4:** fail; implement; PASS; the gate.
- [ ] **Commit:** `feat(01c): task 36 owner modifier groups view [spec §8, V19, F1]`

### Task 37: Owner view: deals; omitted-at-branch warnings

**Spec:** §8 (Deals: parts with choices, "Sold here / Price here"; "Omitted at a branch", m11, N9).

**Files:** Create `apps/client/src/features/owner/menu-variants/{DealsView.tsx,omissions.ts}` and tests; Modify `ModifierGroupsView.tsx` (uses `omissions.ts`), `api/cloud-admin.ts`, `{App,Shell}.tsx`, `i18n/{en,ur}.ts`.

- [ ] **Step 1: Tests (write first):** `[01c #115]` (both pages; "Checking branches…" until the last menu page, `next_cursor: null`); `[01c §8]` deal parts and choices sent with `deal_part_id` for existing parts.
- [ ] **Steps 2–4:** fail; implement; PASS; the gate.
- [ ] **Commit:** `feat(01c): task 37 owner deals view and omission warnings [spec §8, m11, N9; tests #115]`

**Checkpoint batch 11.**

---

## Batch 12 — Seed, full suite, manual checks (§11 step 16, §12.1)

### Task 38: `seed-demo` 01c data — needs Docker Postgres

**Spec:** §7 "Seed", §11 step 16, §1 "Generic model" (seed examples only).

**Files:** Modify `apps/cloud/src/cli/seed-demo.ts`, its test under `apps/cloud/test/cli/`.

- [ ] **Step 1: Test (write first):** `[01c §7]` after `seed-demo`: variant group Chicken Karahi with Half and Full drawing 500 g / 1 000 g from one Karahi pot (g) counted at station Karahi at every seeded branch; Spice level (min 1, max 1, Normal default) attached to category Karahi; Bread (linked Naan, `piece`); Family karahi deal sold at every branch; each branch snapshot parses with `BranchConfigSnapshotSchemaV2`; running it twice is idempotent (as today).
- [ ] **Steps 2–4:** fail; implement through the service functions (not SQL); PASS; the gate.
- [ ] **Commit:** `feat(01c): task 38 seed-demo variants, pot, modifiers, deal [spec §7]`

### Task 39: Full suite, Definition of Done, manual checks — Manual

**Spec:** §12.1, §12.2, §10.9.

- [ ] **Step 1:** `docker compose down && docker compose up -d postgres`, then `pnpm -w typecheck && pnpm -w lint && pnpm -w test` from a clean checkout → green. Record the counts.
- [ ] **Step 2:** Coverage script: `grep -rhoE "\[01c #[0-9]+\]" apps packages | sort -u` gives 126 distinct numbers, 1–128 without 71 and 72; each appears in exactly one `it(` (`grep -rc`).
- [ ] **Step 3:** §12.2 endpoint checklist: every route answers per its row (auth, versioned, idempotency, audit), every route in `ROUTE_CASES`, every listed test green.
- [ ] **Step 4: Manual — stock page.** `seed-demo`, pair a hub, sign in at `/admin/stock`: the **Karahi pot appears once** with **Half and Full listed under it**; open the day; count 6 000 g → Half shows 12, Full 6; add 1 000 g → Half 14, Full 7; reload → same numbers; a `my_stations` counter of the Tandoor does not see the pot.
- [ ] **Step 5: Manual — schema-1 hub.** Build the hub from `main` (pre-01c, schema 1) and point it at the 01c cloud: the poll is refused as `schema_unsupported`, the danger banner shows on `/admin/stock` and in the config status, the last config is kept, and nothing crashes. Then the 01c hub applies the same snapshot.
- [ ] **Step 6:** Write the final checkpoint (results of steps 1–5, open `AD-n`, anything for the hostile build review, pipeline step 8) to `docs/plans/01c-status.md`.
- [ ] **Commit:** `docs(01c): task 39 definition of done and manual checks [spec §12.1]`

### Task 40 (optional, out of plan): 01a v2.0 prose rewrite

01a v2.0 records 01c's changes as "Changed by 01c v1.0" markers over the 01a v1.3.1 text (R26); a marker wins where it and the text differ. Folding the markers into rewritten 01a prose is a docs-only task, not needed for the build or for 02; do it only if the developer asks (spec-first: version bump, changelog, no behaviour change).

---

## Spec gaps found while reading the code (not fixed; for the developer)

| # | Gap | Plan's handling |
|---|---|---|
| G1 | **§11's order cannot end green per step.** Step 5 (engine re-key) and step 6 (schema 2) break the hub until step 14; the builder (step 12) must flip together with the hub's snapshot intake, because 01a #140 (`sync-gzip-e2e.int.test.ts`) runs the real hub poller against the cloud; and tests listed in steps 8, 10, 11 and 18 assert snapshot contents before step 12's builder exists (21, 36, 37, 54, 55, 59, 81, 84, 88, 89, 92, 106, 127) | P-1, P-2 (reorder; temporary V1 names and hub V2 view, both removed by task 21) |
| G2 | **§11 step 13 (route cases at the end) contradicts the code:** `cross-tenant.int.test.ts:115` requires `ROUTE_CASES` keys to equal the registered routes, so each route task must add its case | Global Constraints |
| G3 | **`dayDraws(state, item)` (§4.2) cannot apply the V20 m14 fallback**: it must compare a stock item's frozen `stock_unit` with its config `stock_unit`, which neither argument carries (the item's `stock_draws` hold only ids and factors) | P-6 (third parameter `configStockUnits`) |
| G4 | **§4.5's cost list misses files the change must touch:** hub `sync/config-poller.ts`, `projections/branch-config.ts` (both parse `BranchConfigSnapshotSchemaV1`); `packages/events/testing/index.ts` and `builders.test.ts` (`aBranchConfig`, `aBusinessDayOpened`, `aStockSet`); `packages/events/src/fixtures.test.ts` (fixed count 22); `apps/cloud/src/server.ts` (`CloudTestHooks` for test 120 c); cloud tests `config-sync/{builder,sync-config}.int.test.ts`, `cli/set-branch-settings.int.test.ts`, `restaurant/{menu-items,menu-read}.int.test.ts`, `helpers/restaurant.ts`; hub tests `sync/poller*.int.test.ts`; client `ItemForm.test.tsx`, `MenuView.test.tsx`, `owner-pages.test.tsx`, `features/owner/{App,Shell}.tsx` (navigation for the new views). It lists `features/owner/stock-counting/StockCountingView.tsx`, which has no item or unit field and no §8 change | files listed in the tasks; no task for `StockCountingView.tsx` (confirm) |
| G5 | **01a #68 is not in §4.5's 34-test list** but breaks: `business-day.test.ts` asserts `buildEngineState(engine-log.v1.json)` equals `engine-state.v1.json`, and the upcast `BusinessDayOpened` v2 changes the folded state's shape. Many other 01a tests (e.g. #1–#6, #33–#37, #40, #42–#48, #88, #105, #108, #114, #124, #126, #138, #139, #154) carry the removed fields in their fixtures and need fixture-only edits | P-12; fixture edits named in tasks 7, 12, 21 |
| G6 | **Several numbered tests span sections §11 puts in different steps:** 125 (steps 8 and 10), 101 (§6.2 and §6.5), 116 (POST and PATCH), 107 (modifier builder, deal builder, versions), 109 (PATCH, builder, R4), 25 (option and deal part), 84 (API and snapshot); and 01a #132, #133, #156 are tagged in both a hub and a client test file | P-3, P-4, Coverage table "Moved" |
| G7 | **V16 "a station used by an active `stock_item_branches` row"**: branch rows have no `archived_at`; whether the row of an archived stock item counts is not stated | P-10 (only rows of active stock items), Review Focus 5 |
| G8 | **No numbered test for V16's "category used by an active variant group"** (test 56 covers deals only), nor for §6.4's "archived / foreign variant group" edge row | Review Focus 2, 3 |
