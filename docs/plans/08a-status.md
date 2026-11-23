# 08a Inventory config — build board

Plan: `08a-plan.md`. Spec: `docs/specs/08_Inventory_Costing_Spec_v1.0.md` (APPROVED 2026-11-23), with 01c v1.2 (C-1 – C-10) and 01a v2.8 (A-1, A-2). Integration branch: `module-08a`. Only the integrator (orchestrator session) edits this file.

> **Status (owner summary, newest first):**
> - 2026-11-23 (later): **merged** P0.1–P0.5 (#460, #463), c3 (#462), i1 (#464), c1 (#465). In review / fix round: c2 (#468), i2 (#469), i3 (#467); u1 (#466) reviewed, waits for the backend. t1 and i4 started on a local integration base (c2 + i2 + i3). Owner rulings: G-1 (minimal edits, AD-5), AD-6 (05 test pin 17 → 18), AD-10, AD-11 approved.
> - 2026-11-23: `module-08a` created at `main` @ `55756a09` (the `module-*` ruleset needs a green `gate` on the tip; the spec branch tip had none); the spec branch comes in through PR #457. P0.0 gap sweep done: **no spec–code contradiction**; four small scope / naming gaps recorded as AD-1 – AD-4 with the plan's Rec applied. Phase 0 running.

## Gates

| Check | State |
|---|---|
| `spec/08a-inventory-config` on `main` | **not merged** (2026-11-23) → `module-08a` = `main` @ `55756a09` + the spec branch via #457 |
| Cloud migration number | `0017_max_delay` is the last on `main`; no open PR or branch claims `0018` (#456, #121, #126 checked) → **0018** free |
| Labels | `lane:08a-0`, `lane:08a-C`, `lane:08a-I`, `lane:08a-T`, `lane:08a-U` |

## P0.0 gap sweep (2026-11-23, `main` @ `55756a09`)

| Name (plan / spec) | Found | Note |
|---|---|---|
| `assertTenantWide` | `apps/cloud/src/lib/config-version.ts:68` | ✓ |
| `coversEveryBranch` | `lib/config-version.ts:55` | ✓ |
| `bumpEveryBranch` | `lib/config-version.ts:76` | ✓ |
| `withIdempotency` | `apps/cloud/src/lib/idempotency.ts:43` | ✓ |
| `writeConfigAudit` | `apps/cloud/src/lib/config-audit.ts:56` | ✓ |
| `shareStockItem` | `apps/cloud/src/modules/restaurant/repository.ts:1183` | ✓ returns `{ stock_unit, archived_at }`; c2 adds `kind` (C-3) |
| `assertReference(…, requireActive)` | `restaurant/service.ts:1484` (POST), `:1685` (PATCH, `active`) | ✓ |
| R9 stored draw | `restaurant/service.ts:1821–1837` | ✓ R9b goes right after |
| `selectActiveDrawers` | `menu-variants/repository.ts:199` | ✓ |
| `patchStockItem` | `menu-variants/service.ts:365` | ✓ `assertTenantWide` first, then `lockStockItem` FOR UPDATE (`:374`) |
| `patchMenuItem` `beforeBump` | `restaurant/service.ts:1851`, hook at `:1941` | ✓ (`patchMenuItem` lives in `restaurant/`, not `menu-variants/`) |
| `putStockItemBranch` (§6.9) | `menu-variants/service.ts:429` | ✓ locks the stock item FOR UPDATE; c2 reads `kind` from that row |
| `testHooks` | `CloudTestHooks` in `apps/cloud/src/server.ts:39` | `afterStockItemLock` does not exist yet → **AD-1** |
| builder stock-items query | `apps/cloud/src/modules/config-sync/builder.ts:236` | ✓ c3 adds `AND s.kind = 'prepared'` |
| `StockItemWire` | `packages/events/src/admin/menu-variants.ts:102` | ✓ |
| version input | `menu-variants/versions.ts:131` `toStockItemWire` (`StockItemRow` at `:30`) | ✓ row is filled by `STOCK_ITEM_COLUMNS` in `menu-variants/repository.ts:119` → **AD-2** |
| `listStockItems` | cloud `menu-variants/service.ts:287`; client `apps/client/src/api/cloud-admin.ts:491` | ✓ |
| `assertBranchAllowed` (C2) | `restaurant/service.ts:177` | ✓ |
| route-cases helper | `apps/cloud/test/helpers/route-cases.ts` `ROUTE_CASES` | `route-inventory.int.test.ts:110` and `cross-tenant.int.test.ts:159` require a case for **every** registered route → **AD-3** |
| live `config_audit_entity_check` | last writer `0014_billing_settings.sql:102`; `0015`–`0017` do not touch it | ✓ equals spec §5.1's list minus the three new entities |
| `Unit` | `packages/domain/src/units.ts:4` | ✓ |
| migrations | directory scan (`apps/cloud/src/db/migrate.ts`) | ✓ |

## As-built decisions (AD) — small gaps, plan Rec applied

| # | Gap | Ruling applied | Task |
|---|---|---|---|
| AD-1 | `testHooks.afterStockItemLock` needs a member on `CloudTestHooks` (`apps/cloud/src/server.ts`), a file P0.5's row does not name | P0.5 adds the one optional member `afterStockItemLock?(route: string): Promise<void>` to `server.ts` (type only; no-op in production) | P0.5 |
| AD-2 | `toStockItemWire` reads its row from `STOCK_ITEM_COLUMNS` (`menu-variants/repository.ts:119`, c1's file); P0.4 cannot fill the four new wire fields without it | P0.4 adds `kind, code, cost_category, is_a_item` to `STOCK_ITEM_COLUMNS` and the record type (no new statement, no behaviour change); c1 owns everything else in that file | P0.4 |
| AD-3 | `ROUTE_CASES` must name every registered route or the gate's route-inventory / cross-tenant tests go red; the plan gives `route-cases.ts` to i4 only | Spec §6 ("every route adds its case"): **i1, i2, i3 each add their own route's `ROUTE_CASES` entry**; i4 keeps the C7 sweep assertions (test 36), the audit tests and the append-only test (34) | i1–i4 |
| AD-5 | **Owner ruling 2026-11-23 (G-1 below).** C-7 extends `StockItemWire` in place, so 01c tests that compare the whole wire exactly cannot stay unchanged (test 23 says "except #35") | Minimal edits, no logic or assertion change: 01c **#28** (`stock-items.int.test.ts`, expected created wire + the four defaults), **#35** (expected list rows + `menu_cost: null`; its 4 → 5 count stays c1's), `menu-variants/versions.test.ts` (version input = 01c v1.2's nine keys), client `owner/menu/ItemSections.test.tsx` fixture (+ four fields). Each line marked "⚠️ 08a C-7 / C-5". P0.4 also moves `StockItemListResponse` to `packages/events/src/admin/inventory.ts` (it gains `menu_cost`; the root export is unchanged) and lists `menu_cost: null` until c1 fills it | P0.4 |
| AD-6 | **Owner ruling 2026-11-23.** The 05 test `apps/cloud/test/billing-settings/billing-settings.int.test.ts` builds snapshots on `scratchDatabaseAt(17)` ("latest"); c3's builder now reads `stock_items.kind` (0018) | c3 bumps the pin to `scratchDatabaseAt(18)` (one line, marked ⚠️ 08a C-6), as every later migration did | c3 |
| AD-7 | i1 and c1 each have a price-candidate read (`inventory/repository.ts` `selectPriceCandidates`, `menu-variants` list) with the same SQL | Kept as two copies (separate lanes, Cross files); dedupe left for a later cleanup | i1, c1 |
| AD-8 | §6.3's "Queries" formula omits the drawers read R4 needs when R1 / R2 do not apply (the precedence row says "one drawers read serves R1, R2, R4"); `code: null` skips R7's read (a null never clashes) | Code follows the precedence row; R7 runs on an archived merged row too (spec-literal, reviewer fix); null skips the read (−1 statement). For the Z1 spec patch | c1 |
| AD-9 | u1 touches `apps/client/src/features/owner/App.tsx` (route of the new item page), `apps/client/src/i18n/{en,ur}.ts` (one draft Urdu string, needed by the i18n test), `docs/design/handoff/08a/urdu-todo.md` (the repo's urdu-todo convention), `owner/menu/ItemSections.test.tsx` (expected URL `?kind=prepared` + `menu_cost: null`) | Accepted: needed for the page, the strings and the C-10 picker; expected-value edits only | u1 |
| AD-10 | **Owner approved 2026-11-23.** `apps/cloud/src/lib/config-audit.ts` `AuditEntity` union lacks the three A-1 entities | i2 / i3 add `stock_item_unit`, `item_price`, `yield_profile` (type mirror of the 0018 CHECK) | i2, i3 |
| AD-11 | **Owner approved 2026-11-23.** §7 "Writes log `{ route, tenant_id, stock_item_id, outcome }`": no existing config write logs explicitly; the owner request logger exposes only `error` | No write log line in 08a; **as-built: spec 08a v1.0.1 moves the §7 logging line to §12.4 (deferred)** (owner edits the spec) | i2, i3 |
| AD-4 | Launch schedule: owner prompt (2026-11-23) runs c1, i1, u1, c3 together after phase 0, and i2 ∥ i3 after i1 (plan: c3 after c2; i2 → i3 in one session) | Owner's order applied; c3 needs only P0.2, i2 and i3 use separate test files and rebase on shared inventory-module files | — |

## Gaps needing an owner ruling (G)

| # | Gap | Options | Ruling |
|---|---|---|---|
| G-1 | Spec C-7 (wire extended in place) vs test 23 / DoD ("01c suite unchanged except #35"): 01c #28's exact `toEqual` on the created wire, `versions.test.ts`'s five-key version input and the client `ItemSections.test.tsx` fixture break | (a) minimal expected-value edits, spec patch at Z1; (b) separate 08a-only wire (needs a spec bump); (c) pause for a spec patch | **(a)**, owner 2026-11-23 → AD-5. Spec patch for Z1: test 23 / §12.1 "except #35 and the wire-shape lines of #28 (+ the two non-numbered fixtures)" |

## Tasks

| Task | What | Branch | PR | Tests | Merged | Notes |
|---|---|---|---|---|---|---|
| P0.0 | Gap sweep | — | — | — | 2026-11-23 | this board |
| P0.1 | `module-08a` + board | `lane-0/p0.1` | #457 (spec), #458 → landed via #460 | — | 2026-11-23 | |
| P0.2 | Migration 0018 | `lane-0/p0.2` | #459 → landed via #460 | 27 | 2026-11-23 | HIGH, 2 reviewers |
| P0.3 | Domain `inventory/` | `lane-0/p0.3` | #460 | 1–6 | 2026-11-23 | Shared |
| P0.4 | Wires + versions | `lane-0/p0.4` | #461 → landed via #463 | 12 | 2026-11-23 | Shared, Cross; AD-5 |
| P0.5 | Test hook + fixtures | `lane-0/p0.5` | #463 | — | 2026-11-23 | Cross |
| c1 | Stock-item routes | `lane-C/c1` | #465 | 7–11, 13, 14, 23 | 2026-11-23 | HIGH, 2 reviewers; AD-8 |
| c2 | 01c guards | `lane-C/c2` | #468 | 15, 16, 19 | | HIGH, fix round |
| c3 | Builder filter | `lane-C/c3` | #462 | 24, 25 | 2026-11-23 | HIGH, 2 reviewers; AD-6 |
| i1 | Inventory module + detail GET | `lane-I/i1` | #464 | 30 | 2026-11-23 | |
| i2 | Units + yields POSTs | `lane-I/i2` | #469 | 28, 29, 35 | | HIGH, fix round |
| i3 | Prices POST | `lane-I/i3` | #467 | 31–33 | | HIGH, fixes in; rebase on i2 |
| i4 | Audit, append-only, route cases | `lane-I/i4` | | 34, 36 | | |
| t1 | Races + invariant | `lane-T/t1` | | 17, 18, 19b, 20, 21, 22, 26 | | HIGH |
| u1 | Owner app | `lane-U/u1` | #466 | 37–41 | | UI, reviewed; waits for backend |

## Acceptance map (spec §10.7; filled at Z1)

| Test | Task | PR |
|---|---|---|
| 1–6 | P0.3 | |
| 7–11, 13, 14, 23 | c1 | |
| 12 | P0.4 (`apps/cloud/test/inventory/versions.int.test.ts` + `menu-variants/versions.test.ts`) | |
| 15, 16, 19 | c2 | |
| 17, 18, 19b, 20, 21, 22, 26 | t1 | |
| 24, 25 | c3 | |
| 27 | P0.2 | |
| 28, 29, 35 | i2 | |
| 30 | i1 | |
| 31–33 | i3 | |
| 34, 36 | i4 | |
| 37–41 | u1 | |
