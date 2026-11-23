# 08b Recipes + cost engine — Implementation Plan (spec 08 v1.1 Part B)

> **For agentic workers:** every task is TDD (failing test first, record the failure line, then implement). One task = one branch = one PR into `module-08b` = one commit after review. Lanes run in separate Claude Code sessions (or orchestrator subagents in worktrees); the owner merges into `main`.

**Goal:** build 08b v1.0 in the **cloud, the snapshot and the owner app**: recipes (drafts, immutable published versions, archive / restore, archived-draft publish), the pure cost engine in `@pos/domain` (`plateCost`, `explodeUsage`, `explodeStockItem`, `dealCost`, `buildCostInputs`), plate cost + coverage on the owner Recipes page, the optional snapshot `inventory` key, the bump rule that replaces 08a I11, the recipe in-use guards on 01c / 08a writes, `lb` / `oz` built-ins. **The hub stores the key but nothing on the hub reads it until 08c; no hub command, engine or event change.**

**Spec:** `docs/specs/08_Inventory_Costing_Spec_v1.1.md` **Part B** (APPROVED 2026-11-24), with Part A changes P-1 – P-3, 01a v2.9 (A-2′ – A-6), 01b v1.10.4 (B-x), 01c v1.3 (C-11 – C-16), foundation v1.16 §6.2 append (`RECIPE_NOT_FOUND`). Reviews `docs/reviews/08b_*`. Do **not** build Part B §12.4 (ck_only / CK, settings table, deal cost range, suggested price, restatement, quotes) or anything of 08c / 08d.

**Starting point:** `main` after the 08b approval PR merges (specs + this plan). `module-08b` is cut from that `main` in P0.1. 08a is on `main` (`50fb2f81`): its price POST and `selectPriceCandidates` exist (Part B §11 note).

**Size:** Part B §11 = 11 steps, 6 routes, 40 tests (1–38, 18b, 27b). This plan = 6 phase-0 tasks + 10 lane tasks + close. Lanes: **S** snapshot + bump (Cross 01a), **R** recipes module, **G** guards (Cross 01c / 08a), **T** races (fresh session), **U** owner app. At most 4 at once.

---

## Global rules (every task)

- **Branches:** integration branch `module-08b`. Task branch `lane-<L>/<task>`. Base = `origin/module-08b`, or the lane's previous unmerged task branch (stacked; PR body says `Stacked on #…`).
- **PR:** title `<task>: <title> [08 B§x]`; body: spec sections (Part B §… / Part A P-n / 01a A-n / 01c C-n), tests added with their failing-first output line, statement counts asserted, `Needs: #…`. Label `lane:<L>`.
- **Commit:** one per task after review: `feat(08b): <title> [08 B§x; B§11 step N]`; for an 01a / 01c / 08a-owned file: `feat(<module>): <title> [08b §4.5 <row>]`. End with the repo's Co-Authored-By line.
- **Review:** after the implementation a **fresh reviewer subagent** reads the cited spec sections, the diff and these rules. **HIGH** tasks get a **second** fresh reviewer focused on lock order (kinds 0 → 0.5 → 1 / 4 → 5 → 10), statement counts, hash stability and the never-throw rule of the engine.
- **Tests you run:** your own files (`TMPDIR=/dev/shm pnpm vitest run <files>`) plus `pnpm -w typecheck` for the packages you touched. The full gate runs in CI. Never `pnpm test:perf`.
- **Tests:** names cite the spec: `it('[08b #14] …')`; Part A tests changed by P-1 keep their number with the 08b marker (`[08a #28 ⚠️ 08b P-1]`); real tables, real routes, the pg counter for every count the spec states; never a mock of another lane's code.
- **Engine never throws** (Part B B9, B11): every pure function returns `partial` on cycles, depth > 3, unknown versions, unit or basis mismatches. A thrown error in `costing.ts` is a review failure.
- **Money and quantities:** BigInt fractions inside, round once (Part B B9); BIGINT columns as `BigInt(string)`; no floats.
- **Files:** only the files of your task row. A spec–code mismatch, a missing helper or a contract change → stop, G-row in `docs/plans/08b-status.md`, ask the owner. Never edit a spec.
- **Logs:** ids and outcomes only; `inventory_key_invalid` log line is the one new log (Part B §5.3 / OQ-7 default).

## Markers

| Marker | Meaning |
|---|---|
| **HIGH** | migration, lock order, publish graph, snapshot / hash / bounds, bump rule, races, the cost engine. Two fresh reviewers |
| **Shared** | `packages/domain`, `packages/events`. Phase 0 only |
| **Cross** | an 01a / 01c / 08a-owned file (`apps/cloud/src/modules/{config-sync,menu-variants,restaurant,inventory}/`, their tests, `apps/client/src/features/owner/menu/`). Only the task that names it |
| **UI** | owner app (`apps/client`); existing kit components |

---

## Phase 0 — contracts, shared files (integrator, one session, sequential)

| # | Task | Spec | Files | Tests first | Marker |
|---|---|---|---|---|---|
| P0.0 | **Gap sweep:** every name the tasks use, checked against `main` (file:line): `selectPriceCandidates`, `effectiveMenuPrice`, `pricePerStockUnit`, `resolveUnit`, `BUILTIN_UNITS`, `assertTenantWide`, `bumpEveryBranch` / branch bump helper, `withIdempotency`, `writeConfigAudit`, `CloudTestHooks`, builder reads + its test bounds, `BranchConfigSnapshotSchemaV4`, 01c `patchMenuItem` / `patchStockItem` / §6.12 option patch, owner-app menu page, `route-cases.ts`, live `config_audit` CHECKs. Mismatches → G-rows (options + Rec) in `docs/plans/08b-status.md`; owner rules before P0.2 | B§2, B§4.1 | board | — | — |
| P0.1 | Cut `module-08b` from `main`; status board `docs/plans/08b-status.md` (task table, G / AD rows, acceptance map from B§10.6) | — | board | — | — |
| P0.2 | **Migration** `apps/cloud/src/db/migrations/0019_recipes.sql` as B§5.1 (+ `config_audit` entity / action CHECKs A-5, re-read live first; ends with the release bump A-6) + schema test | B§5.1, A-5, A-6 | migration, schema test | **33** | HIGH |
| P0.3 | **Domain:** `packages/domain/src/inventory/costing.ts` (`plateCost`, `explodeUsage`, `explodeStockItem`, `dealCost`, `stockItemUnitCost`, element-wise `buildCostInputs`) + `BUILTIN_UNITS` `lb` / `oz` (P-3, 08a test #1) + exports; `RECIPE_NOT_FOUND` in `packages/domain/src/errors.ts` (F-1) | B§3.1 B3–B11, B§4.2, P-3, F-1 | those files + `costing.test.ts`, `conversions.test.ts` | **1–11**, 08a #1 | Shared, HIGH |
| P0.4 | **Wires + schemas:** `packages/events/src/admin/recipes.ts` (B§5.4); `InventorySnapshotSchema` + per-row lenient element schemas exported from `packages/events/src/config.ts` (not `.strict()`), V4 hub schema `inventory: z.unknown().optional()` | B§5.3, B§5.4, A-3 | those files | schema unit tests | Shared |
| P0.5 | **Test hooks + fixtures:** `CloudTestHooks.afterRecipeLock?`, `afterPublishLock?` in `apps/cloud/src/server.ts` (no-ops in production); `apps/cloud/test/recipes/fixtures.ts` (tenant + Lake City; beef / ghee / paye ingredients with prices and yields; PAYE-COOKED prepared; menu items Tawa piece (per_unit), Chicken karahi (g), Lassi (ml), Paye Half, a deal with two parts, a plain option and a removal option) | B§10.4, m-14 | `server.ts` (type only), fixtures | — | Cross |

**Phase 0 done** when P0.0–P0.5 are merged and CI on `module-08b` is green.

---

## Lanes

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Marker |
|---|---|---|---|---|---|---|---|
| S | s1 | **Snapshot key:** builder's 5 reads with its **own time-free `selectSnapshotPrices`** (never `selectPriceCandidates`), `created_at` rank per item (t-1), `safeParse` + `inventory_key_invalid` log (sync never `500`), bounds builder ≤ 28 / sync ≤ 33 / ≤ 40 (A-4, B-x), 08a #25 inverted (P-1), gzip fixture | B§5.3, B15, A-3, A-4, B-x, P-1 | `apps/cloud/src/modules/config-sync/{builder,repository}.ts`; `apps/cloud/test/config-sync/*` (bounds lines only), `test/config-sync/inventory-key.int.test.ts`, 08a `inventory-filter.int.test.ts` | **23–25, 27, 27b, 28**, 08a #25 | P0 | HIGH, Cross |
| S | s2 | **Bump rule on 08a writes:** item units, prices (branch market rate → that branch only), yields, stock-item PATCH of inventory fields bump; counts 9 / 11 / 11 / 9; 08a #9, #28, #31, #35 | B16, P-1, A-2′ | `apps/cloud/src/modules/{inventory,menu-variants}/service.ts`; those 08a tests (counts / bump lines only) | **26**, 08a #9 #28 #31 #35 | s1 | HIGH, Cross |
| R | r1 | **Recipes module + create + draft:** `apps/cloud/src/modules/recipes/` (routes, service, repository); §6.3 create (8 / conflict 7), §6.4 draft save incl. archived-recipe draft (17 / 16), `afterRecipeLock` | B§6.3, B§6.4, B2, B3, T-1 | new module; `test/recipes/{create,draft}.int.test.ts`; own `ROUTE_CASES` entries | **12, 13** | P0 | HIGH |
| R | r2 | **Publish:** kind 0 advisory lock first, whole-graph check (cycles, depth ≤ 3), every B6 check, archived-draft publish un-archives (18 / 17 / 17 / 16), bump | B§6.5, B6, B16, T-1 | recipes module; `test/recipes/publish.int.test.ts` | **14–17** | r1 | HIGH |
| R | r3 | **PATCH archive / restore:** kind 0 first on every `archived: false`, all B6 checks on restore, `hint: 'new_draft'`, counts 3 / 5 / 10 / 9 | B§6.6, N-1, N-2 | recipes module; `test/recipes/archive-restore.int.test.ts` | **18, 18b, 37, 38** | r2 | HIGH |
| R | r4 | **Reads:** §6.1 Recipes page + coverage (`plateCost` on the cost context with `selectPriceCandidates`), §6.2 detail | B§6.1, B§6.2, B14 | recipes module; `test/recipes/reads.int.test.ts` | **19, 20** | r1 (∥ r2) | — |
| R | r5 | **Audit + route cases:** audit rows per write, C7 cross-tenant sweep for the 6 routes | B§6.0, C7 | `apps/cloud/test/helpers/route-cases.ts`, `test/recipes/audit.int.test.ts` | **21** | r3, r4 | — |
| G | g1 | **Recipe in-use guards:** C-11 (stock item archive / `stock_unit`, incl. a prepared owner), C-14 (`sale_unit`), C-15 (option → linked), P-2 (08a R4 `kind`), `409 … entity: 'recipe'`, +1 statement only on those changes | B17, C-11, C-14, C-15, P-2, C-13 | `apps/cloud/src/modules/{menu-variants,restaurant}/service.ts` + repository reads; tests in `apps/cloud/test/recipes/guards.int.test.ts` | **22** | P0.2 | HIGH, Cross |
| T | t1 | **Races, by a session that did not write R / G:** publish ∥ publish (one `200`, one `422 cycle`), publish ∥ archive (f-1 wording), restore ∥ publish, guard ∥ publish; both orders each via `afterRecipeLock` / `afterPublishLock`; 5 runs green | B§10.4, B§6 lock order | `apps/cloud/test/recipes/races.int.test.ts` | **34, 35, 36** | r2, r3, g1 | HIGH |
| U | u1 | **Owner app:** Recipes page (coverage %, plate cost with I12 "Menu cost" label, `partial` reasons), editor (basis from the owner, lines with unit pick-list via `resolveUnit`, publish / archive / restore, `new_draft` hint), "No recipe" badge on the menu page (C-12), B17 refusal texts; urdu-todo | B§8, C-12 | `apps/client/src/features/owner/recipes/*` (new), `features/owner/menu/` (badge only), `api/cloud-admin.ts`, i18n | **29–32** | P0.4 (stubs), then r1–r4 | UI, Cross |

### Lane launch schedule (at most 4 at once)

1. After phase 0: **S (s1)**, **R (r1)**, **G (g1)**, **U (u1, on stubs)** in parallel.
2. s1 merged → **s2**. r1 merged → **r2** and **r4** in parallel; r2 merged → **r3**; r3 + r4 merged → **r5**.
3. r2 + r3 + g1 merged → **T (t1)**. u1 switches to the real routes after r4 and merges last.

---

## Close (integrator)

| # | Task |
|---|---|
| Z1 | Board complete: every test 1–38, 18b, 27b and the changed 08a tests mapped to a merged PR (acceptance map B§10.6); G-rows ruled; as-built AD-rows listed for an 08 v1.1.1 patch |
| Z2 | Owner hand check: deferred to the module-08 end (owner, 2026-11-23); the list goes to the board: Tawa piece plate cost vs paper (drill 2, Rs 1), Paye Half = Rs 231 (misc once), karahi per kg and lassi per litre, a cycle refused, restore refused with `new_draft` hint after a `sale_unit` change, "No recipe" badge, coverage %, a hub snapshot that gained `inventory` and kept applying |
| Z3 | PR `module-08b` → `main` on the owner's word only, gate green (rebase onto `main` first if it moved; merge commits are allowed for the owner's merge) |

---

## Orchestrator prompt (owner pastes into a fresh Claude Code web session)

```
Repo: arsiihere/pos. Tum 08b build ke ORCHESTRATOR ho. Pehle yeh parho: CLAUDE.md, docs/plans/08b-plan.md (POORA), docs/specs/08_Inventory_Costing_Spec_v1.1.md (Part B poora + Part A ke "Changed by 08b v1.0" markers), docs/specs/01_Restaurant_Setup_Spec_v2.9.md, 01c_Menu_Variants_Spec_v1.3.md, 01b_Staff_Roles_Spec_v1.10.4.md ke "Changed by 08b v1.0" markers.

GOAL: 08b ko plan ke mutabiq poora build karo — Phase 0 → lanes S, R, G, T, U → close Z1 — full speed, maximum parallel.

SETUP:
- `module-08b` ko main se cut karo (08b approval PR merge ho chuka ho). main ko KABHI touch mat karna; module-08b → main ka PR mat banana, wo main kahunga.
- Ek clone; har parallel subagent apni git worktree mein (Agent tool, isolation "worktree"; agar denied ho to `git worktree add` se alag folder). Push/fetch ek waqt mein ek — git proxy 2 se zyada concurrent ops par 429; 429 aaye to 5s ruk kar ek dafa retry. Force-push allowed nahi ho to nayi branch naam se push karo.

PARALLELISM (dependencies ke andar maximum):
1. Phase 0 (P0.0 → P0.5) tum khud sequential. P0.0 gap sweep: chhote naming/signature farq → plan ki Rec apply + AD-row in docs/plans/08b-status.md; spec–code CONTRADICTION (contract, table, event, lock order, count) → RUK kar mujh se ruling.
2. Phase 0 merge hote hi EK SAATH: Subagent S1 (s1), R1 (r1), G1 (g1), U1 (u1 stubs par).
3. s1 merge → S2 (s2). r1 merge → R2 (r2) aur R4 (r4) PARALLEL. r2 merge → R3 (r3). r3 + r4 merge → R5 (r5).
4. r2 + r3 + g1 merge → T1 (t1) — NAYA subagent jis ne R/G ka code nahi likha. Race fail ho to fix mat kare; failing test + G-row, aur mujhe batao.
5. U1 backend merge hone par real routes se tests chala kar aakhir mein merge.
Har waqt jitne subagents ki dependencies poori hon, sab ek saath.

HAR TASK (har subagent ko plan ki "Global rules" aur apni task row prompt mein do):
- TDD: failing test pehle (failure line PR body mein). Test names `[08b #N]`. Statement counts pg counter se. Engine kabhi throw na kare. BigInt fractions. Sirf task row ki files.
- Apne test files + touched packages ka typecheck: `TMPDIR=/dev/shm pnpm vitest run <files>` aur `pnpm -w typecheck`. Kabhi `pnpm test:perf` nahi.
- Branch `lane-<L>/<task>`, PR into `module-08b`, commit message plan ke format mein, end mein repo ki Co-Authored-By line.
- Review: ek FRESH reviewer subagent; HIGH par DO fresh reviewers (lock order 0 → 0.5 → 1/4 → 5 → 10, counts, hash stability, never-throw). Findings fix karo, phir merge.
- MERGE PERMISSION (sirf module-08b): reviewers clear + CI gate green → task PR ko module-08b mein rebase-merge kar sakte ho. main mein kabhi nahi.

STATUS: docs/plans/08b-status.md har merge ke baad (sirf tum edit karoge). Har batch ke baad 3–5 line Roman Urdu/English update: kya merge hua, kya chal raha hai, koi ruling chahiye to kya.

STOP CONDITIONS (ruk kar pucho): spec–code contradiction; kisi approved spec ka contract/table/event/lock order badalna; plan se bahar file; CI gate 2 koshishon ke baad bhi red; koi race test (t1) fail.

END: Z1 (acceptance map: tests 1–38, 18b, 27b + changed 08a tests har ek merged PR se mapped; as-built list for 08 v1.1.1) aur Z2 ki hand-check list board mein likh kar ruk jao. Z3 mere kehne par.
```

## Lane prompts (single-lane sessions, if not using the orchestrator)

**Lane S:**
```
Repo arsiihere/pos. CLAUDE.md, docs/plans/08b-plan.md ("Global rules", rows s1, s2), spec 08 v1.1 Part B §5.3, B15, B16 + Part A P-1, 01a v2.9 A-2′–A-6, 01b v1.10.4 B-x parho. Tasks s1 → s2 (stacked lane-S/…), TDD, PR into module-08b, HIGH par do fresh reviewers. Builder apni time-free selectSnapshotPrices use kare, kabhi selectPriceCandidates nahi. Spec–code mismatch par RUK kar docs/plans/08b-status.md mein G-row.
```

**Lane R:**
```
Repo arsiihere/pos. CLAUDE.md, docs/plans/08b-plan.md (rows r1–r5), spec 08 v1.1 Part B §3, §4.2, §5.1, §5.4, §6 (lock order), §10.2 parho. Tasks r1 → (r2 ∥ r4) → r3 → r5, naya module apps/cloud/src/modules/recipes/, TDD, PR into module-08b. Counts pg counter se (create 8/7, draft 17/16, publish 18/17/17/16, restore 3/5/10/9). Kind 0 advisory lock hamesha pehle. HIGH par do fresh reviewers. Mismatch par RUK kar G-row.
```

**Lane G:**
```
Repo arsiihere/pos. CLAUDE.md, docs/plans/08b-plan.md (row g1), spec 08 v1.1 Part B B17 + Part A P-2, 01c v1.3 C-11–C-16 parho. Task g1: recipe in-use guards on 01c / 08a writes, +1 statement only on the guarded change, recipes ko bina lock parho (C-16). TDD, PR into module-08b, do fresh reviewers. Mismatch par RUK kar G-row.
```

**Lane T (fresh session that did not write R / G):**
```
Repo arsiihere/pos. CLAUDE.md, docs/plans/08b-plan.md (row t1), spec 08 v1.1 Part B §6 lock order, §10.4 parho; R aur G ka code parho, badlo mat. Task t1: races 34–36 do transactions se (afterRecipeLock / afterPublishLock), har race ke dono orders, 5 dafa green. Race fail ho to fix mat karo — failing test ke saath PR aur G-row.
```

**Lane U:**
```
Repo arsiihere/pos. CLAUDE.md, docs/plans/08b-plan.md (row u1), spec 08 v1.1 Part B §8, Part A I12, 01c v1.3 C-12 parho; owner app ke existing patterns follow karo. Task u1: Recipes page, editor, "No recipe" badge, B17 texts; labels I12 ke mutabiq ("Menu cost"); "No price" kabhi "Rs 0" nahi. Tests 29–32. Pehle stubs par, backend merge ke baad real routes. PR into module-08b.
```

---

## Self-review (writer, 2026-11-24)

- Every Part B §11 step maps to a task: 1 → P0.2, 2 → P0.3, 3 → P0.4 + s1, 4 → s2, 5 → r1 (+ hooks P0.5), 6 → r2, 7 → r3, 8 → r4, 9 → g1, 10 → r5 + t1, 11 → u1.
- Every test appears in exactly one task row: 1–11 P0.3; 12, 13 r1; 14–17 r2; 18, 18b, 37, 38 r3; 19, 20 r4; 21 r5; 22 g1; 23–25, 27, 27b, 28 s1; 26 s2; 29–32 u1; 33 P0.2; 34–36 t1. Changed 08a tests: #1 P0.3; #25 s1; #9, #28, #31, #35 s2.
- Race tests sit in a lane that did not write the code under test.
- No hub command, engine or event file in any row; the hub only stores the new key (01a S28 unchanged apart from A-3). 01a / 01c / 08a files only in Cross rows that name them.
