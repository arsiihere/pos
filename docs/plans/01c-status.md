# 01c status board

Plan: `docs/plans/01c-plan.md`. Spec: `docs/specs/01c_Menu_Variants_Spec_v1.0.1.md`.

## Deviations (AD-n)

| # | Deviation | Kind | Goes to |
|---|---|---|---|
| AD-1 | §4.2 `dayDraws` gains `configStockUnits` (plan P-6, gap G3): `dayDraws(state, item, configStockUnits: Readonly<Record<string, Unit>>)`, needed for the V20 m14 fallback | signature | spec, at the as-built review |
| AD-2 | Task 8 adds an exported hub helper `dayStockUnitOf(state, v2Config, item)` in `apps/hub/src/commands/set-precooked-stock.ts`, not in the plan's Interfaces, shared by the four callers that replaced `dayUnits`; it reads the config passed in (from `branchConfigV2()` at the call sites the plan lists) and equals `dayStockUnit(state, { stock_item_id: item.item_id, stock_unit: item.stock_unit })` under the view. Seam item: task 18 keeps it, task 19 removes its uses in `queries/stock.ts` and `ws/restaurant-catch-up.ts`, task 21 removes it | signature / file-list, no behaviour change | plan only (removed before the as-built review) |
| AD-3 | Task 9 adds two more hub helpers not in the plan's Interfaces: exported `viewStockItem(config, itemId): ConfigStockItem` in `commands/set-precooked-stock.ts` (used by `add-precooked-stock.ts` and `ws/restaurant-catch-up.ts`; its `STOCK_NOT_TRACKED` throw cannot fire under the view) and private `untrackedStandIn(item)` in `queries/stock.ts` (a `ConfigStockItem` built from an untracked V1 item's fields, so untracked rows keep today's numbers); `stockResult` now takes a `ConfigStockItem`. Seam items: task 18 replaces `viewStockItem`'s call sites and both `STOCK_NOT_TRACKED` throws with `stockItemsOf` and renames `stockResult` to `stockItemResult` (no second builder); tasks 19–20 delete `untrackedStandIn` | signature / file-list, no behaviour change | plan only (removed before the as-built review) |
| AD-4 | Task 9a (developer-added): test files are type-checked in the gate — per package `tsconfig.test.json` (module ESNext, moduleResolution Bundler, tests only; `src` keeps NodeNext) and `typecheck:tests`; `pnpm -w typecheck` runs both (README R31). `@types/node` 22.19.1 added as a devDependency to engine, events and client; a local `qrcode` declaration in the hub; every test type error fixed without casts | repo convention, no behaviour change | README R31 (done); plan Global Constraints "Gate" at the as-built review |
| AD-5 | Task 10: `SortOrder`, `Description`, `PriceMinor` and `AvailabilityWindows` are exported from `packages/events/src/admin/restaurant.ts` (outside task 10's file list) and imported by `admin/menu-variants.ts`, instead of copies | file-list, no behaviour change | plan only |
| AD-6 | Task 10 (developer decision): the deal branch entries in the §6.13 list and the §6.16 PUT response carry `is_sold` (§5.4 hashes it; with every allowed branch listed for the no-row version, a null override cannot tell "sold at base price" from "not sold"). Stock-item branch entries carry a nullable `station_id` for "no row" (§6.9's own encoding) | API addition | spec §6.13 / §6.16, at the as-built review |
| AD-7 | Task 11 (developer decision, spec gap): a variant group PATCH that restores the group re-checks the merged category; an archived category → `422 CONFIG_REFERENCE_INVALID { field: 'category_id', reason: 'archived' }`, nothing written (otherwise archive group → archive category → restore group leaves an active group in an archived category, against V16). The check runs with the references (C4 step 4), so a restore whose category is archived and whose name collides answers 422 before 409 | behaviour added where §6.2 is silent | spec §6.2, at the as-built review |
| AD-8 | Task 11 (developer decision, spec gap): the variant group wire's `member_ids` lists every member, archived included (§3.2 rule 4); task 12's menu read uses the same rule | API detail where the spec is silent | spec §6.1 / §6.3, at the as-built review |
| AD-9 | Task 12: error `field` values the spec does not name, on the item POST: `category_mismatch` → `category_id`; equal units with a factor other than 1 → `unit_mismatch` on `stock_draws.0.stock_item_id`; a variant group without `variant_name` (or the reverse) → `400` on the missing field | error detail where the spec is silent | spec §6.4, at the as-built review |
| AD-10 | Task 14's file list gains `packages/events/src/admin/restaurant.ts`: `PatchMenuItemBody` needs `stock_draws` and `requires_weighing` (and drops the deprecated unit fields) for R2, R7, R9; the plan's task 14 list omits it | file-list | plan only |
| AD-11 | Q-3 (developer decision): item rules R4, R6 and R8 count only active parts of active deals (`deals.archived_at IS NULL` joined in the in-use reads). Condition: a deal restore (§6.15 PATCH that makes the merged deal active) re-checks every active choice item on the merged parts, even when `parts` is not sent: active (else `422 { field: 'parts.N.choices.M.item_id', reason: 'archived' }`), R2 (one `sale_unit` per part), R5 (not weighed); in task 30's plan entry with its test | behaviour where the spec is silent | spec §6.5 and §6.15, at the as-built review |

## Notes

- **57P01 flake (scratch-database helper race):** one `terminating connection due to administrator command` error from `apps/cloud/test/helpers/scratch-db.ts` in task 1's first full run (pool `end` racing `DROP DATABASE … WITH (FORCE)`); not reproduced. If it appears again: stop and report, do not rerun.
- **Test runs:** from batch 2 only the controller runs the full gate; subagents run focused `vitest` commands only, never overlapping another run, and use no `pgrep`/`sleep` wait loops.

## Tasks

| Task | Status | Commit | Tests | Note |
|---|---|---|---|---|
| 1 | DONE | `15eb7d5` | #27, [01c §5.1] | Constraint names read from the test DB match §5.1 (no deviation). Expectation-only edits to `staff-roles-migration.int.test.ts` and `migrate-ahead.int.test.ts` (hard-coded applied-migration list → includes 0006; fake future migration → 0007) |
| 2 | DONE | `5c91601` | [01c §9] | The four 404 codes; F §6.2 already carried them (`0d24760`). Re-reviewed on opus in batch 2: clean |
| 3 | DONE | `a558c89` | #1–#10, #87, #94, #95, #102–#104 | `menu-lines.ts` quantities, charges, allocation, line totals |
| 4 | DONE | `b985c58`, `288e1b9` | #11–#14, #96, #97, #110, #122, [01c §12.7 T3] | One fix round: chosen quantities are summed per option before the range and stock checks (an option entered twice was checked per entry) |
| 5 | DONE | `fbb9a6c` | #117–#119, #126 | Test-only reference refund model; no `src` change |
| 5a | DONE | `d6f59ba` | #8, #119 (hardened), #126 (clamp sub-case), [01c §3.4.6, V18] | Developer-added: #8 and #119 now fail under a broken `allocateDealMinor` / void model (shown once, then restored); a piece parent with `quantity: null` throws in `checkOptionChoices` (g/ml may be null); `linkedOrderable` → `isChildOrderable` |
| 6 | DONE | `300cad3` | #67, [01c §5.3] | Four test files outside the list changed expectations only (stored payload key `item_id` → `stock_item_id`; the writer stores the upcast payload). #67 inserts its v1 row by SQL because the writer upcasts on append |
| 7 | DONE | `c415a17`, `b353f8b` | [01c §4.6], [01c §4.2 P-7] | One fix round: test files are not typechecked by the gate, so the P-7 assignability check also lives as a type-only assertion at the end of `packages/events/src/config.ts` (one scoped `eslint-disable-next-line no-unused-vars`). `options` 0–50 per §4.6 F1 |
| 8 | DONE | `1d5056f` | #66, #108, [01c §5.1 P-2]; re-keyed 01a #68, #133, #143, #145, #149 | Seam `apps/hub/src/sync/config-v2-view.ts` (comment on line 1). AD-2. Catch-up `business_day` now carries `stock_units` / `draws` (the engine `BusinessDay` of §4.2) |
| 9 | DONE | `eff6b0c` | #69; re-keyed 01a #66, #129, #148, #157 | AD-3. Engine no longer imports `ConfigItemV1` |
| 9a | DONE | `5dc55d5`, `b4aea7b`, fix round | — | Developer-added. AD-4, README R31. Test type errors fixed in every package; no `src` behaviour change (hub `qr.ts` / `issue-admin-bootstrap.ts` lose their `@ts-expect-error` now that `src/types/qrcode.d.ts` declares the module). Fix round 1: cloud fixture tokens kept without `cv` through a test-only signer (`test/helpers/legacy-token.ts`, [01b #91]). Fix round 2: turbo `typecheck:tests` has `"cache": false` (cloud's test typecheck reads hub files turbo does not hash); `typecheck` stays cached |
| 9a follow-up | DONE | `818de6b` | — | turbo `globalDependencies: ["tsconfig.base.json"]` (editing it busts every cached typecheck) |
| 10 | DONE | `78dca24`, `66e778f`, `da47fed`, `6e230f9` | [01c §6, C6], [01c C9], [01c §6.11], [01c §6.16], [01c §5.4] | AD-5, AD-6 (developer: keep `is_sold`). 01b #104's builder allowlist gains `menu-variants/versions.ts` (expectation only). Single-choice-extra rule moved out of the deal PATCH schema (developer); task 30 checks it as §6.15 R3 |
| 11 | DONE | `1ae8ca1`, `c8b6445` | #15–#20, [01c V16], [01c §6 C4], [01c §6.2 AD-7] | Tenant-wide 403 moved first (spec §6 C4) via `assertTenantWide` + `bumpEveryBranch`; AD-7, AD-8 (developer) |
| 12 | DONE | `477edbf`, `1a996ad` | #22, #23, #26, [01c §6.4], [01c §6.4 V18], [01c §5.1 P-11], [01c §6 C4]; 01a #41 retired | 403 first on item create; one `VariantGroupWire`; AD-9. `GET /v1/admin/menu` 8 statements; POST 11 (plain) / 14 (group + draw), +1 in task 23 |
| 13 | DONE | `91c482f` | #101, #111, #120, [01c §6.5], [01c §6.5 T4] | Developer checks passed: no group lock after the item lock on any path (the implicit FK `FOR KEY SHARE` only touches an already-held group); restart 3 then `503`; P-8 order; 403 first |
| 14 | DONE | `698b134` | #24, #85, #123, [01c §6.5 R7], [01c §6.5 S26]; re-keyed 01a #128 | AD-10. Stock item lock (kind 5) top of rule 1; `assertUnits` deleted; 01a #81 back to `toEqual` |
| 15 | DONE | `d6c6581` | #25, #83, #128 | R4, R10, R6 in the 409 slot; open question Q-3 (archived deals' parts) |

## Checkpoints

### Batch 1 (§11 steps 1–2) — 2026-10-29

- Tasks 1–2 done; both reviews clean (minors only, not looped).
- Gate: `pnpm -w typecheck && pnpm -w lint && pnpm -w test` → 219 files, 919 tests passing.
- Tests closed: 01c #27. Re-keyed: none.
- AD added: AD-1 (recorded on the developer's instruction; applies from task 8).
- Open seams: none.
- Watch: one non-reproducible Postgres `57P01` teardown error from the scratch-db helper in task 1's first full run, and 17 cloud failures in task 2's first full run caused by two test runs overlapping on the shared Postgres; both reran green.

### Batch 2 (§11 step 3) — 2026-10-29

- Tasks 3–5 done; task 2 re-reviewed on opus first (clean). All subagents on opus from this batch.
- Reviews: task 3 clean; task 4 one Important finding fixed in one round; task 5 clean. Minor findings deferred to the final whole-branch review (listed in the build ledger).
- Gate (controller only, after each task): last run 221 files, 955 tests passing; no 57P01.
- Tests closed: 01c #1–#14, #87, #94–#97, #102–#104, #110, #117–#119, #122, #126 (28). Re-keyed: none.
- AD added: none (AD-1 still applies from task 8).
- Open seams: none.

### Batch 3 (§11 steps 4–6) — 2026-10-29

- Task 5a (developer-added) and tasks 6–9 done. Reviews: 5a, 6, 8, 9 clean; 7 one Important finding (P-7 check not compiled) fixed in one round.
- Gate (controller only, after each task): last run on `eff6b0c` 222 files, 975 tests passing. Task 7's first run had one timeout in the untouched cloud `login.int.test.ts` #109 (5 s limit, load average ~4.5; 6 s alone); the rerun was green. No 57P01.
- Tests closed: 01c #66, #67, #69, #108 (4), plus #8 / #119 hardened and the #126 clamp sub-case. Re-keyed: 01a #66, #68, #129, #133, #143, #145, #148, #149, #157.
- AD added: AD-2, AD-3 (hub seam helpers, no behaviour change). AD-1 applied in task 8.
- Seam check after task 8: `config-v2-view.ts` carries `// Seam (01c plan P-2): removed by task 21`; it is imported only by `commands/{add-precooked-stock,open-business-day,set-precooked-stock}.ts`, `queries/stock.ts`, `ws/restaurant-catch-up.ts`, its own test and `test/commands/business-day-restart.int.test.ts`, all in task 8's file list. Task 9 added no importer.
- Open seams: V1 names (`BranchConfigV1`, `ConfigItemV1`, `isStockTrackedV1`, `aBranchConfigV1`; task 21); `config-v2-view.ts` (task 21); AD-2 `dayStockUnitOf` (tasks 19, 21); AD-3 `viewStockItem`, `stockResult` (task 18), `untrackedStandIn` (tasks 19–20).
- Watch: the gate does not typecheck `*.test.ts` (every package tsconfig excludes them), so type-only test failures cannot show as red.

### Batch 4 (§11 steps 7–8) — 2026-10-29

- Tasks 10–15 done (and the 9a follow-up). Reviews: 13, 14, 15 clean; 10 three fix rounds (01b #104 allowlist, reuse of 01a schemas, single-choice rule placement); 11 and 12 one round each (tenant-wide 403 first, spec §6 C4).
- Gate (controller only, after each task): last run on `d6c6581` 228 files, 1026 tests passing; typecheck includes tests (AD-4). No 57P01, no 40P01.
- Tests closed: 01c #15–#20, #22–#26, #83, #85, #101, #111, #120, #123, #128 (19). Re-keyed: 01a #128. Retired: 01a #41 (replaced by 01c #21, task 22).
- AD added: AD-5 … AD-10 (AD-6, AD-7, AD-8 developer decisions).
- Task 13 developer checks: no item lock is followed by a group lock on any path; restart capped at 3 then `503`, nothing written; P-8 order (no-op before references, R1–R10 after), 403 first.
- Open seams: unchanged from batch 3 (V1 names, `config-v2-view.ts`, AD-2/AD-3 helpers).
- Open question Q-3 (developer): R4/R6 (and R8 from task 30) count active parts of archived deals.
- Follow-ups after the checkpoint (developer, Q-3): AD-11. Task 15 follow-up commit joins active deals in R4/R6 reads. Task 30's plan entry gains: §6.15 R3 in the service with the stale-version test (Q-2); deal restore re-checks choice items (AD-11 condition) with its test; R8 joins active deals; the #128 R10-before-R8 control.
