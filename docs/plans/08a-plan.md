# 08a Inventory config — Implementation Plan (spec v1.0)

> **For agentic workers:** every task is TDD (failing test first, record the failure line, then implement). One task = one branch = one PR into `module-08a` = one commit after review. Lanes run in separate Claude Code sessions; the integrator (owner) merges.

**Goal:** build 08a v1.0 in the **cloud and the owner app only**: stock item `kind` + `code`, `cost_category`, `is_a_item`; item units; the price list ("menu cost", market-rate validity entered by the owner); yield profiles; the `prepared`-only invariant on branch rows and draws (01c v1.2 R9b); the builder filter; the owner-app pages and the item form's draw picker. **No hub, engine, event or snapshot-schema change.**

**Spec:** `docs/specs/08_Inventory_Costing_Spec_v1.0.md` (APPROVED 2026-11-23), with 01c v1.2 (rows C-1 – C-10) and 01a v2.8 (A-1, A-2) already applied as spec text. Reviews `docs/reviews/08a_*`. Do **not** build anything in spec §12.4 (branch manual prices, quotes, suppliers, receiving fields, `visibility_scope`, alerts, restatement).

**Starting point:** `main` after the `spec/08a-inventory-config` branch is merged (spec, reviews, 01c v1.2, 01a v2.8, README, this plan). `module-08a` is cut from that `main` in P0.1.

**Size:** spec §11 = 11 tasks; this plan = 5 phase-0 tasks + 8 lane tasks + close. Cloud-only, so smaller than 04 / 05: **two code lanes + one test lane + one UI lane**, at most 3 at once.

---

## Global rules (every task)

- **Branches:** integration branch `module-08a`. Task branch `lane-<L>/<task>` (e.g. `lane-C/c1`). Base = `origin/module-08a`, or the lane's previous unmerged task branch (stacked; PR body says `Stacked on #…`).
- **PR:** title `<task>: <title> [08a §x]`; body: spec sections, tests added (with their failing-first output line), statement counts asserted, `Needs: #…`. Label `lane:<L>`. Rebase-merge by the integrator only.
- **Commit:** one per task after review: `feat(08a): <title> [08a §x; §11 step N]`; for an 01c / 01a file: `feat(01c): <title> [08a §4.5 C-n]`. End with the repo's Co-Authored-By line.
- **Review:** after the implementation, a **fresh reviewer subagent** reads the cited spec sections, the diff and these rules. **HIGH** tasks get a second fresh reviewer focused on the I9 invariant, lock order and statement counts.
- **Tests you run:** your own files (`TMPDIR=/dev/shm pnpm vitest run <files>`) plus `pnpm -w typecheck` for the packages you touched. The full gate runs in CI. Never `pnpm test:perf`.
- **Tests:** names cite the spec: `it('[08a #21] …')`; real tables, real routes, the pg counter for every statement count the spec states; never a mock of another lane's code. 01c's existing tests stay unchanged **except #35** (4 → 5 statements, C-5).
- **Files:** only the files of your task row. A spec–code mismatch, a missing helper or a contract change → stop, write a G-row in `docs/plans/08a-status.md`, ask the owner. Never edit a spec.
- **Money and quantities:** BIGINT columns read with `BigInt(string)`, never `Number()` (I6, m-12); wire values as decimal strings where §5.3 says so; no floats anywhere.
- **Logs:** ids and outcomes only; never notes (§7).

## Markers

| Marker | Meaning |
|---|---|
| **HIGH** | migration, a rule that guards the engine invariant (I9), a race, statement counts. Two fresh reviewers |
| **Shared** | `packages/domain`, `packages/events`. Phase 0 only |
| **Cross** | an 01c / 01a-owned file (`apps/cloud/src/modules/{menu-variants,restaurant,config-sync}/`, 01c tests, `ItemForm.tsx`). Only the task that names it |
| **UI** | owner app (`apps/client`). Uses existing kit components; no design hand-off needed (owner may ask for one) |

---

## Phase 0 — contracts, shared files (integrator, one session, sequential)

| # | Task | Spec | Files | Tests first | Marker |
|---|---|---|---|---|---|
| P0.0 | **Gap sweep:** every name the tasks use, checked against `main` (file:line): `assertTenantWide`, `bumpEveryBranch`, `withIdempotency`, `shareStockItem`, `assertReference(…, requireActive)`, `selectActiveDrawers`, `patchStockItem`, `patchMenuItem` `beforeBump`, `testHooks`, builder stock-items query, `StockItemWire`, `listStockItems`, route-cases helper, live `config_audit_entity_check`. Mismatches → G-rows with options + Rec in `docs/plans/08a-status.md`; owner rules before P0.2 | §2, §4.1 | `docs/plans/08a-status.md` | — | — |
| P0.1 | Cut `module-08a` from `main`; status board `docs/plans/08a-status.md` (task table, G-rows, acceptance map from spec §10.7) | — | board | — | — |
| P0.2 | **Migration** `apps/cloud/src/db/migrations/0018_inventory_config.sql` exactly as §5.1 (re-read the live entity CHECK first, 01b D-5) + schema test | §5.1, A-1 | migration, `apps/cloud/test/schema.int.test.ts` (or `test/inventory/migration.int.test.ts`) | **27** | HIGH |
| P0.3 | **Domain:** `packages/domain/src/inventory/{conversions,prices,yield}.ts` + `index.ts` exports; `Unit` from `../units` | I3–I8, §4.2 | those files + tests | **1–6** | Shared |
| P0.4 | **Wires + versions:** `StockItemWire` extended in place (`packages/events/src/admin/menu-variants.ts`); new `packages/events/src/admin/inventory.ts` (`ItemUnitWire`, `ItemPriceWire`, `MenuCostWire`, `YieldProfileWire`, bodies of §6.2–§6.7); version input in `apps/cloud/src/modules/menu-variants/versions.ts` | §5.3, C-7 | those files | **12** (version covers the new fields) | Shared, Cross |
| P0.5 | **Test hook + fixtures:** `testHooks.afterStockItemLock` (called right after the stock-item lock in `patchStockItem` and, later, in the three new POSTs; a no-op in production); `apps/cloud/test/inventory/fixtures.ts` (tenant, Lake City branch, PAYE-COOKED prepared + counted, raw beef / ghee / paye ingredients, TP-1 packet, "Paye Half" menu item drawing PAYE-COOKED) | §10.3 (N-5, P-4) | `menu-variants/service.ts` (hook line only), fixtures | — | Cross |

**Phase 0 done** when P0.0–P0.5 are merged and CI on `module-08a` is green.

---

## Lanes

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Marker |
|---|---|---|---|---|---|---|---|
| C | c1 | **Stock-item routes:** list (`kind?`, `branch_id?`, `menu_cost`, 5 statements), POST (new fields, code read), PATCH (R4–R7, precedence, **bump only on snapshot fields**, `afterStockItemLock`) | §6.1–§6.3, I2, I11, I13, C-5 | `apps/cloud/src/modules/menu-variants/{service,repository,routes}.ts`; `apps/cloud/test/inventory/stock-items.int.test.ts`; 01c `stock-items.int.test.ts` #35 (4 → 5 only) | **7–11, 13, 14, 23** | P0 | HIGH, Cross |
| C | c2 | **01c guards:** sent draw `wrong_kind` right after the draw's `assertReference` (C-3, Q-2); R9b stored draw on a merged-active item without `stock_draws` (C-9); branch PUT set `wrong_kind` (C-4) | I9, C-3, C-4, C-9 | `apps/cloud/src/modules/restaurant/{service,repository}.ts` (`shareStockItem` returns `kind`), `menu-variants/service.ts` (§6.9); tests in `apps/cloud/test/menu-variants/` | **15, 16, 19** | c1 | HIGH, Cross |
| C | c3 | **Builder filter** `kind = 'prepared'` | C-6 | `apps/cloud/src/modules/config-sync/builder.ts`; `apps/cloud/test/config-sync/` | **24, 25** | P0.2 | HIGH, Cross |
| I | i1 | **New module `apps/cloud/src/modules/inventory/`** (routes, service, repository) + detail GET (7 statements, separate candidate read) | §6.4 | new module; `apps/cloud/test/inventory/detail.int.test.ts` | **30** | P0 | — |
| I | i2 | **Units + yields POSTs** (key → tenant-wide → `FOR SHARE` → `afterStockItemLock` → rules on the locked row; 7 statements each) | §6.5, §6.7, I4, I8 | inventory module; `test/inventory/{units,yields}.int.test.ts` | **28, 29, 35** | i1 | HIGH |
| I | i3 | **Prices POST** (manual / market rate, `valid_for_hours` 1–720 default 24, `branch_id` only with market rate, C1 `branch_id` `not_found`, frozen conversion, 9 / 10 statements) | §6.6, I6, I7 | inventory module; `test/inventory/prices.int.test.ts` | **31–33** | i1 | HIGH |
| I | i4 | **Audit, append-only, route cases** (C7 sweep for 6.4–6.7; grep test: no UPDATE / DELETE on the three tables) | §6.0, I4, I6, I8, C7 | `apps/cloud/test/helpers/route-cases.ts`, `test/inventory/append-only.test.ts` | **34, 36** | i2, i3 | — |
| T | t1 | **Races + invariant, written by a session that did not write c1 / c2 / i2 / i3:** kind vs branch PUT, kind vs draw write, restore vs kind (19b orders A and B), price vs `stock_unit`, yield vs `kind → packet`, unit vs archive; no engine / hub test edited | §10.3, §10.4, I9 | `apps/cloud/test/inventory/races.int.test.ts` | **17, 18, 19b, 20, 21, 22, 26** | c2, i2, i3 | HIGH |
| U | u1 | **Owner app:** stock-items tabs + Menu cost column (`display_per`, `below_one_minor`, "No price"), form fields, item page (Units, Menu cost with **Valid for**, Yield), `api/cloud-admin.ts` (`listStockItems({ kind })` + new calls), `ItemForm.tsx` picker `kind=prepared`; I12 labels; urdu-todo | §8.1–§8.6, I12, C-8, C-10 | `apps/client/src/features/owner/stock-items/*` (+ new `StockItemInventory.tsx`), `apps/client/src/features/owner/menu/ItemForm.tsx` (picker only), `apps/client/src/api/cloud-admin.ts` | **37–41** | c1, i1–i3 (wires from P0.4 are enough to start with stubs) | UI, Cross |

### Lane launch schedule (at most 3 at once)

1. After phase 0: **C (c1)** and **I (i1)** in parallel.
2. c1 merged → **c2**, then **c3**. i1 merged → **i2** and **i3** (one session, sequential), then **i4**.
3. When c2 + i2 + i3 are merged → **T (t1)**. In parallel → **U (u1)**.

---

## Close (integrator)

| # | Task |
|---|---|
| Z1 | Board complete: every test 1–41 + 19b mapped to a merged PR (acceptance map §10.7); G-rows ruled; as-built notes (AD-rows) listed for a spec patch if any |
| Z2 | Hand check on the dev box (owner app): create beef / ghee / paye ingredients and TP-1; units "1 peti = 12 kg", "1 l = 0.92 kg", paye "1 piece = 182.5 g"; manual price Rs 1,500 / kg; a 3-day market rate; paye yield test (drill 1 numbers); try to count an ingredient at a station (refused); try an ingredient as a menu item's draw (not offered); hub snapshot unchanged |
| Z3 | PR `module-08a` → `main` on the owner's word only, gate green |

---

## Lane prompts (copy into a fresh Claude Code session)

**Phase 0 (integrator session):**
```
Repo arsiihere/pos. Pehle CLAUDE.md, docs/plans/08a-plan.md (poora) aur docs/specs/08_Inventory_Costing_Spec_v1.0.md parho.
Phase 0 karo: P0.0 → P0.5, is order mein, ek ek task. P0.0 ka gap sweep pehle; koi mismatch mile to docs/plans/08a-status.md mein G-row (options + Rec) likh kar RUK jao aur mujh se ruling lo.
Har task: TDD (failing test pehle), apni task branch, PR into module-08a, plan ke "Global rules". main ko touch mat karna, merge mat karna.
```

**Lane C:**
```
Repo arsiihere/pos. Pehle CLAUDE.md, docs/plans/08a-plan.md ("Global rules", "Lanes" ki C rows) aur spec docs/specs/08_Inventory_Costing_Spec_v1.0.md (§3.1 I2, I9, I11, I13; §4.5 C-3–C-9; §6.1–§6.3, §6.9) + docs/specs/01c_Menu_Variants_Spec_v1.2.md ke "Changed by 08a v1.0" markers parho.
Lane C ke tasks c1 → c2 → c3 karo (stacked branches lane-C/c1 …), har ek TDD, PR into module-08a. HIGH tasks: implementation ke baad do fresh reviewer subagents (I9 invariant, lock order, statement counts).
Sirf task row ki files. 01c ke tests sirf #35 (4 → 5) badlega. Spec–code mismatch par RUK kar docs/plans/08a-status.md mein G-row.
```

**Lane I:**
```
Repo arsiihere/pos. Pehle CLAUDE.md, docs/plans/08a-plan.md ("Global rules", "Lanes" ki I rows) aur spec docs/specs/08_Inventory_Costing_Spec_v1.0.md (§3.1 I3–I8, I10–I12; §5; §6.0, §6.4–§6.7; §9) parho.
Lane I ke tasks i1 → i2 → i3 → i4 karo (naya module apps/cloud/src/modules/inventory/), har ek TDD, PR into module-08a. Statement counts pg counter se assert karo (7 / 7 / 9–10 / 7). BigInt(string) rule. HIGH tasks par do fresh reviewers.
Spec–code mismatch par RUK kar docs/plans/08a-status.md mein G-row.
```

**Lane T (fresh session that did not write lanes C / I):**
```
Repo arsiihere/pos. Pehle CLAUDE.md, docs/plans/08a-plan.md (row t1) aur spec docs/specs/08_Inventory_Costing_Spec_v1.0.md §3.1 I9, §6 lock order, §10.3 (tests 17, 18, 19b, 20–22), §10.4 (26) parho. Code lanes C aur I ka code parho lekin badlo mat.
Task t1: race tests do transactions se (testHooks.afterStockItemLock aur patchMenuItem ka beforeBump), dono orders har race ke. Engine/hub ka koi test edit nahi. Agar koi race fail ho to fix mat karo — failing test ke saath PR kholo aur docs/plans/08a-status.md mein G-row likho.
```

**Lane U:**
```
Repo arsiihere/pos. Pehle CLAUDE.md, docs/plans/08a-plan.md (row u1), spec docs/specs/08_Inventory_Costing_Spec_v1.0.md §8, I12, §5.3 aur 01c v1.2 §8 marker parho. Existing kit components aur apps/client/src/features/owner/stock-items/ ka pattern follow karo.
Task u1: tabs, Menu cost column, form fields, item page (Units / Menu cost with "Valid for" / Yield), ItemForm picker kind=prepared. Labels exactly I12 ke ("Menu cost"; "Today's cost" sirf help line mein). "No price" kabhi "Rs 0" nahi. Urdu strings urdu-todo list mein. Tests 37–41. PR into module-08a.
```

---

## Self-review (writer, 2026-11-23)

- Every spec §11 step maps to a task: 1 → P0.2, 2 → P0.3, 3 → P0.4, 4 → c1, 5 → c2 (+ hook in P0.5), 6 → c3, 7 → i1, 8 → i2, 9 → i3, 10 → i4, 11 → u1.
- Every test 1–41 and 19b appears in exactly one task row: 1–6 P0.3; 7–11, 13, 14, 23 c1; 12 P0.4; 15, 16, 19 c2; 17, 18, 19b, 20–22, 26 t1; 24, 25 c3; 27 P0.2; 28, 29, 35 i2; 30 i1; 31–33 i3; 34, 36 i4; 37–41 u1.
- Race tests sit in a lane that did not write the code under test (as 04's T1).
- No hub, engine or event file in any row; 01c files only in Cross rows that name them.
