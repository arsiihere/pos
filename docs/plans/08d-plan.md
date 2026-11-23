# 08d A-item daily sheet — Implementation Plan (spec 08 v1.2 Part D)

> **For agentic workers:** every task is TDD (failing test first, record the failure line, then implement). One task = one branch = one PR into `module-08d` = one commit after review. Lanes run in separate Claude Code sessions (or orchestrator subagents in worktrees); the owner merges into `main`.

**Goal:** build 08d v1.0 on the **hub, the cloud, the snapshot and the clients**: the `inventory` event stream (receipts, transfers, waste, counts, reversals, daily sheets), the pure MWA fold and sheet formulas in `@pos/domain`, the hub projection group, six commands and three queries, the cloud receiving fields + variance settings + permission backfill, the device Inventory screen, the close and the hub admin report. **The engine never reads the `inventory` stream (C3); no engine, reducer or 04 / 05 file changes.**

**Spec:** `docs/specs/08_Inventory_Costing_Spec_v1.2.md` **Part D** (APPROVED 2026-11-24), with Foundation v1.17 (F-1 – F-3), 01b v1.11 (B-1, B-2), 01c v1.4 (C-1), 01a v2.10 (A-1), 05a v1.0.6 (D-1), Part A P-1, Part B R-b. Reviews `docs/reviews/08d_*`. Do **not** build Part D §12.4 (default purchase unit, opening seed, engine level beside the count, raw transfers, lot codes, shelf life) or anything of 08c.

**Two build parts:**
- **08d-1** (Part D §11 steps 1–12): needs **08a and 08b built and merged into `main`** (`buildCostInputs`, `explodeStockItem`, snapshot `inventory` key, cloud `0019`). Everything except the close.
- **08d-2** (steps 13–15): needs **08c approved, built and merged into `main`** (`theoreticalUsage` exactly as Part D §4.1 / R-c). The close, the report, their screens. **Do not start 08d-2 before that** — not even on a stub branch.

**Starting point:** `main` after the 08d approval PR (this plan + specs) and the 08b build (`module-08b` → `main`) merge. `module-08d` is cut from that `main` in P0.1. Before 08d-2, `module-08d` is rebased onto the `main` that carries 08c.

**Size:** Part D §11 = 15 steps, 6 commands, 3 queries, 3 cloud changes, 37 tests (1–36, 2b). This plan = 7 phase-0 tasks + 15 lane tasks (11 in 08d-1, 5 in 08d-2 incl. the permissions sweep) + close. Lanes: **C** cloud (Cross 01a / 01b / 01c / 08b), **H** hub commands + queries, **T** races (fresh session), **U** clients. At most 4 at once.

---

## Global rules (every task)

- **Branches:** integration branch `module-08d`. Task branch `lane-<L>/<task>`. Base = `origin/module-08d`, or the lane's previous unmerged task branch (stacked; PR body says `Stacked on #…`).
- **PR:** title `<task>: <title> [08 D§x]`; body: spec sections (Part D §… / S-rows / F, B, C, A, D rows), tests added with their failing-first output line, statement counts asserted, `Needs: #…`. Label `lane:<L>`.
- **Commit:** one per task after review: `feat(08d): <title> [08 D§x; D§11 step N]`; for an 01a / 01b / 01c / 05a / 08b-owned file: `feat(<module>): <title> [08d §4.5 <row>]`. End with the repo's Co-Authored-By line.
- **Review:** after the implementation a **fresh reviewer subagent** reads the cited spec sections, the diff and these rules. **HIGH** tasks get a **second** fresh reviewer focused on: the fold (`stepItemCost` / `foldItemCost` in `(order_seq, seq)` order, live = recompute = rebuild), statement counts, `business_day_id` keys (never `business_date`), the engine untouched, one `divRound` per item per sum.
- **Tests you run:** your own files (`TMPDIR=/dev/shm pnpm vitest run <files>`) plus `pnpm -w typecheck` for the packages you touched. The full gate runs in CI. Never `pnpm test:perf`; no timing asserts (03a AD-32).
- **Tests:** names cite the spec: `it('[08d #14] …')`; real tables, real commands through the hub pipeline, the statement counter for every count the spec states; never a mock of another lane's code. The only stub allowed is 08c's `theoreticalUsage` where Part D §10 says "08c stub" (test 16).
- **Money and quantities:** µ-minor and `_minor` values as decimal strings on the wire and in `TEXT` columns, BigInt inside; quantities `INTEGER` ≤ 10⁹; no floats.
- **Engine untouched:** no file under `packages/engine/`, no reducer list, no 03a / 04 / 05 file. A diff there is a review failure.
- **Files:** only the files of your task row. A spec–code mismatch, a missing 08b / 08c export, a migration number taken, or a contract change → stop, G-row in `docs/plans/08d-status.md`, ask the owner. Never edit a spec.
- **Logs:** ids and counts only; never notes or supplier names (Part D §7).

## Markers

| Marker | Meaning |
|---|---|
| **HIGH** | migrations, backfill, release bump, projection group / rebuild, the fold, commands with statement counts, reversal recompute, the close, races. Two fresh reviewers |
| **Shared** | `packages/domain`, `packages/events`. Phase 0 only |
| **Cross** | an 01a / 01b / 01c / 05a / 08b-owned file (`apps/cloud/src/modules/{config-sync,menu-variants,restaurant,staff,inventory}/`, their tests, `apps/client/src/features/owner/{menu,settings}/`). Only the task that names it |
| **UI** | `apps/client`; existing kit components |

---

## Phase 0 — contracts, shared files (integrator, one session, sequential)

| # | Task | Spec | Files | Tests first | Marker |
|---|---|---|---|---|---|
| P0.0 | **Gap sweep** against `main` (file:line): 08b exports `buildCostInputs`, `CostInputs.dropped`, `explodeStockItem` signature (D§4.1); 08a `resolveUnit`, `normaliseUnitName`, `toStockUnits`, `effectiveMenuPrice`, `pricePerStockUnit`; `packages/events/src/envelope.ts` stream enum; hub pipeline `sessionKind`, `ctx.directory.resolve`, idempotency + result rows, projection-group registration / `reset` / catch-up, statement counter helper, `BusinessDayOpened` / `BusinessDayClosed` events; hub migrations (last number; D§5.2 says `0027`), cloud migrations (last number; 08b's `0019`); `0015_billing_defaults_backfill.sql`, `0017` release bump, live `branch_engine_settings`; 01b `ALLOWED_ONLY_PERMISSIONS`, `PERMISSION_CATALOGUE`, `BRANCH_ENGINE_SETTING_KEYS`; 05a `SCREEN_KEYS`, `LISTED_ONLY_PERMISSIONS`; `billing/` and `voids/` hub folder precedent. Mismatches → G-rows (options + Rec) in `docs/plans/08d-status.md`; owner rules before P0.2 | D§2, D§4.1, D§5 | board | — | — |
| P0.1 | Cut `module-08d` from `main`; status board `docs/plans/08d-status.md` (task table, G / AD rows, acceptance map from D§10.6, a "08d-2 gate" line: 08c approved / built / merged) | — | board | — | — |
| P0.2 | **Step 1:** F-1 `stream_type` `'inventory'` in `packages/events/src/envelope.ts` (Zod only, no DB CHECK); D§9 codes + reasons in `packages/domain/src/errors.ts` (F-3) | D§9, F-1, F-3 | those files + their tests | envelope schema test, errors map test | Shared |
| P0.3 | **Step 2:** event schemas `packages/events/src/events/inventory/*.v1.ts` (six, D§5.3), six fixtures `packages/events/fixtures/<EventType>.v1.json`, `TodaysCostWire` + command / query wires in `packages/events/src/inventory/wire.ts` | D§5.3, D§4.2 | those files | **33** | Shared |
| P0.4 | **Step 3:** pure `packages/domain/src/inventory/{mwa,sheet}.ts` (`divRound`, `ItemStep`, `stepItemCost`, `foldItemCost`, S13 formulas, flags, period) + exports | D§5.2 fold, S6, S7, S13 | those files + `mwa.test.ts`, `sheet.test.ts` | **1–7, 2b** | Shared, HIGH |
| P0.5 | **Step 4 (shared part):** five permissions in `packages/domain/src/permissions.ts` (B-1: group `menu_stock`, scope `branch`, all in `ALLOWED_ONLY_PERMISSIONS`, Owner + Manager defaults; `close-daily-sheet` in `LISTED_ONLY_PERMISSIONS`, D-1); `SCREEN_KEYS` gains `inventory` in `packages/domain/src/screens.ts` (D-1); `BranchEngineSettings` / `BRANCH_ENGINE_SETTING_KEYS` gain the two keys in `packages/events/src/admin/staff.ts` (B-2); snapshot V4 `engine_settings` optional keys + `inventory.items[]` optional `must_weigh_on_receipt`, `track_piece_count` in `packages/events/src/config.ts` (A-1, R-b; lenient, not `.strict()`) | B-1, B-2, D-1, A-1, R-b | those files + their unit tests | catalogue / screens / wire unit tests (unnumbered; test 19 is c3's) | Shared |
| P0.6 | **Fixtures:** `apps/hub/test/inventory/fixtures.ts` (branch, snapshot with `inventory` key: beef, ghee, paye (`must_weigh_on_receipt`, `track_piece_count`), anday, packet TP-1 with a menu price, PAYE-COOKED prepared ticked, biryani prepared unticked; roles Owner, Manager, Store keeper (four keys), Cashier; open / close business day helpers; `appendFixtureEvent` that appends a `DailySheetClosed` fixture through the projection group so 08d-1 tests can seed a sheet); `apps/cloud/test/inventory/fixtures.ts` (08b-era tenant + branch) | D§10 | fixtures | — | — |

**Phase 0 done** when P0.0–P0.6 are merged and CI on `module-08d` is green.

---

## Lanes — 08d-1 (after 08b built)

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Marker |
|---|---|---|---|---|---|---|---|
| C | cl1 | **Step 5a — cloud migration** `apps/cloud/src/db/migrations/0020_inventory_receiving.sql` exactly as D§5.1 (re-read `0015` and live `branch_engine_settings` first; one `wanted` arm; ends with the release bump) + schema test | D§5.1, B-1, A-1, C-1 | migration, `apps/cloud/test/inventory/migration.int.test.ts` | **31** | P0 | HIGH, Cross |
| C | cl2 | **Step 5b — cloud fields + settings + snapshot:** 01c stock-item PATCH / create take the two fields (CHECK → `400`, version input), `is_a_item` editable on `prepared`; 01b §6.10 settings wire with ranges; builder emits the two item fields and the two `engine_settings` keys, builder statement count unchanged | C-1, B-2, A-1, R-b | `apps/cloud/src/modules/{menu-variants,staff,restaurant,config-sync}/` (named lines only); `apps/cloud/test/inventory/receiving-fields.int.test.ts` | **29, 30, 32** | cl1 | HIGH, Cross |
| H | h1 | **Step 6 — hub migration** `apps/hub/src/db/migrations/0028_inventory.sql` (D§5.2, number rechecked) + projection group `apps/hub/src/inventory/projections/` (six tables, apply order, `day_seq` PK read, live apply through `stepItemCost`) | D§5.2 | migration, projections, `apps/hub/test/inventory/rebuild.int.test.ts` | **22** | P0 | HIGH |
| H | h2 | **Step 7 — items + cost:** `apps/hub/src/inventory/{items,cost}.ts` (S2 tracked sets from `buildCostInputs`, `not_configured` rule, day-set freeze helper, `todaysCost`, S19 large-quantity guard) | S2, S5, S8, S19, D§4.2 | those files + `items.test.ts`, `cost.test.ts` (unnumbered; numbered checks in h3 / h6) | unit tests | h1 | — |
| H | h3 | **Step 8 — moves:** commands `receive-goods`, `receive-transfer`, `record-waste` (`sessionKind: 'device'`, not queueable, statements as D§6.1–6.3) | D§6.1–6.3, S3, S4, S6, S8, S11 | `apps/hub/src/inventory/commands/{receive-goods,receive-transfer,record-waste}.ts`, registration line, `apps/hub/test/inventory/{receive,transfer,waste}.int.test.ts` | **8, 9, 10, 11** | h2 | HIGH |
| H | h4 | **Step 9 — counts:** `record-count` (day rule S14, day set into the first `CountRecorded`, re-anchor, sheeted-day manager rule; sheets seeded with `appendFixtureEvent`) | D§6.4, S9, S14, N-2 | `commands/record-count.ts`, registration line, `test/inventory/count.int.test.ts` | **12, 13** | h2 (∥ h3) | HIGH |
| H | h5 | **Step 10 — reversal:** `reverse-inventory-entry` (static permission, own-entry narrowing via `ctx.directory`, day rule, replacement on the original day with the original's `order_seq`, recompute per affected item) | D§6.5, S19, N-1, n-6 | `commands/reverse-inventory-entry.ts`, registration line, `test/inventory/reverse.int.test.ts` | **14** | h3, h4 | HIGH |
| H | h6 | **Step 11 — day view:** `GET /queries/inventory-day` (6 statements fixed, defaults, `no_longer_tracked`, `dropped`, `my_entries.reversible`) + engine-untouched proof | D§6.6, S1, S10 | `apps/hub/src/inventory/queries/inventory-day.ts`, route line, `test/inventory/{day-view,engine-untouched}.int.test.ts` | **15, 21** | h3, h4 (∥ h5) | — |
| T | t1 | **Races (08d-1), by a session that did not write H:** count ∥ count, receive ∥ `CloseBusinessDay`, reversal ∥ new receipt (final `avg` = `foldItemCost` in `(order_seq, seq)`); 5 runs green | D§10.3 | `apps/hub/test/inventory/races.int.test.ts` (08d-1 cases) | **23, 25, 28** | h3, h4, h5 | HIGH |
| U | u0 | **Owner app:** stock item form "Weigh on receipt" (g items only), "Count pieces on receipt", "Count daily" on `prepared` items; branch settings gain the two thresholds; urdu-todo | D§8.4, C-1, A-1 | `apps/client/src/features/owner/{menu,settings}/` (named fields only), `api/cloud-admin.ts`, i18n; component tests `[08d C-1 UI]` | component tests | P0.5 (stubs), then cl2 | UI, Cross |
| U | u1 | **Step 12 — Inventory screen:** `apps/client/src/features/inventory/` (receive / transfer / waste / count / undo + replacement form, local draft per (branch, `business_day_id`, staff), large-quantity confirm, "Start the day first", S18 labels, actions per permission; screen key `inventory`, works in the 05b staff tablet) | D§8.1, D-1, S18 | `apps/client/src/features/inventory/*` (new), screen registration line, i18n | **34** | P0.3 (stubs), then h3–h6 | UI |

### Lanes — 08d-2 (after 08c approved, built, merged into `main`; `module-08d` rebased)

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Marker |
|---|---|---|---|---|---|---|---|
| H | c1 | **Step 13 — close:** `close-daily-sheet` (first close + correction with `supersedes`, period ≤ 7 days, required / excluded, moves after count, `theoreticalUsage` with `count_seq_by_item`, cooked equivalents, frozen costs and settings, `sales_after_count`, `cooked_excluded`) | D§6.7, S12–S14, S20 | `commands/close-daily-sheet.ts`, registration line, `test/inventory/{close,correction,same-date}.int.test.ts` | **16, 17, 18** | 08c on `main`, h5 | HIGH |
| H | c2 | **Step 14 — report queries:** `GET /admin/queries/daily-sheets` (1 statement, 62-day cap) and `/:business_day_id` (3 statements, `404 INVENTORY_SHEET_NOT_FOUND`) | D§6.8, D§6.9 | `queries/daily-sheets.ts`, route lines, `test/inventory/report.int.test.ts` | **20** | c1 | — |
| H | c3 | **Permissions sweep:** every command refused without its key, own-entry vs `close-daily-sheet` via `ctx.directory`, `everyone` device refusals, store keeper cannot close, roles API `422` on `requires_approval` for the five | D§10.2 #19, B-1, D-1 | `apps/hub/test/inventory/permissions.int.test.ts`, one cloud roles-API case in `apps/cloud/test/inventory/permissions.int.test.ts` | **19** | c1 | — |
| T | t2 | **Races (08d-2), fresh session that did not write c1:** close ∥ late count, reversal ∥ close, two managers close D−1 and D | D§10.3 | `races.int.test.ts` (08d-2 cases) | **24, 26, 27** | c1 | HIGH |
| U | u2 | **Step 15 — close screen + admin report:** close on the Inventory screen (missing counts, after-count rows, cooked-leftover prompt, flags + reasons, `staff_meal` column, out-of-date re-close with note); `apps/client/src/features/admin/inventory/` list + detail labelled by `unit_cost_source` | D§8.2, D§8.3 | `features/inventory/close/*`, `features/admin/inventory/*`, i18n | **35, 36** | c1, c2 (stubs before) | UI |

**AD-1 (plan, not spec):** D§11 lists race 26 under step 10 and race 24 / 27 under step 13. Race 26 needs `CloseDailySheet`, so all three close races sit in t2 (08d-2). 08d-1 tests that need a sheet on a day (12, 13, 14) seed it with `appendFixtureEvent` (P0.6), not with the command.

### Lane launch schedule (at most 4 at once)

**08d-1**
1. After phase 0: **C (cl1)**, **H (h1)**, **U (u0 on stubs)**, **U (u1 on stubs)** in parallel.
2. cl1 merged → **cl2**. h1 merged → **h2**; h2 merged → **h3** and **h4** in parallel.
3. h3 + h4 merged → **h5** and **h6** in parallel. h3 + h4 + h5 merged → **T (t1)**.
4. u0 switches to real routes after cl2; u1 after h6 and merges last.
5. 08d-1 done = every 08d-1 row merged + CI green. **Stop and tell the owner**; 08d-2 waits for 08c.

**08d-2** (owner says 08c is on `main`)
1. Rebase `module-08d` onto `main`; P0.0-style check of 08c's `theoreticalUsage` against D§4.1 (mismatch → G-row, stop).
2. **c1** (+ **u2** on stubs). c1 merged → **c2**, **c3**, **T (t2)** in parallel. u2 switches after c2.

---

## Close (integrator)

| # | Task |
|---|---|
| Z1 | Board complete: every test 1–36 and 2b mapped to a merged PR (acceptance map D§10.6); G-rows ruled; as-built AD-rows listed for an 08 v1.2.1 patch |
| Z2 | Owner hand check: deferred to the module-08 end (owner, 2026-11-23); the list goes to the board: paye 18.5 kg + 92 pieces at dawn, Rs 1.80/g; a typo 18 500 kg refused then undone by the store keeper with a replacement; waste raw + cooked; nightly count with PAYE-COOKED in pieces; next-morning close of last night's day; beef `over` at 3 % AND Rs 500; `sales_after_count` text; a manager correction keeps Monday's cost; report list / detail; drill 3 week with paper in parallel (D§12.1) |
| Z3 | PR `module-08d` → `main` on the owner's word only, gate green (rebase onto `main` first if it moved; merge commits are allowed for the owner's merge). 08d-1 may go to `main` alone if the owner asks; then 08d-2 gets its own `module-08d` round |

---

## Orchestrator prompt (owner pastes into a fresh Claude Code web session)

```
Repo: arsiihere/pos. Tum 08d build ke ORCHESTRATOR ho. Pehle yeh parho: CLAUDE.md, docs/plans/08d-plan.md (POORA), docs/specs/08_Inventory_Costing_Spec_v1.2.md (Part D poora + Part A/B ke "Changed by 08d v1.0" markers), aur in ke "Changed by 08d v1.0" markers: 00_Foundation_Spec_v1.17.md, 01b_Staff_Roles_Spec_v1.11.md, 01c_Menu_Variants_Spec_v1.4.md, 01_Restaurant_Setup_Spec_v2.10.md, 05a_Device_Access_Screens_Spec_v1.0.6.md.

GOAL: 08d ko plan ke mutabiq build karo — Phase 0 → 08d-1 lanes C, H, T, U → STOP. 08d-2 (c1, c2, c3, t2, u2) SIRF tab jab main kahun ke 08c approve + build ho kar main par merge ho chuka hai. Us se pehle 08d-2 ka koi kaam shuru mat karna, stub par bhi nahi.

PRE-CHECK: main par 08b build merged hona chahiye (buildCostInputs, explodeStockItem, cloud 0019). Na ho to ruk kar batao.

SETUP:
- `module-08d` ko main se cut karo. main ko KABHI touch mat karna; module-08d → main ka PR mat banana, wo main kahunga.
- Ek clone; har parallel subagent apni git worktree mein (Agent tool, isolation "worktree"; denied ho to `git worktree add` se alag folder). Push/fetch ek waqt mein ek — git proxy 2 se zyada concurrent ops par 429; 429 aaye to 5s ruk kar ek dafa retry. Force-push allowed nahi ho to nayi branch naam se push karo.

PARALLELISM (dependencies ke andar maximum, ek waqt mein zyada se zyada 4 subagents):
1. Phase 0 (P0.0 → P0.6) tum khud sequential. P0.0 gap sweep: chhote naming/signature farq → plan ki Rec + AD-row in docs/plans/08d-status.md; spec–code CONTRADICTION (contract, table, event, migration number, statement count, 08b export ka signature) → RUK kar mujh se ruling.
2. Phase 0 merge hote hi EK SAATH: C1 (cl1), H1 (h1), U0 (u0 stubs par), U1 (u1 stubs par).
3. cl1 merge → C2 (cl2). h1 merge → H2 (h2). h2 merge → H3 (h3) aur H4 (h4) PARALLEL. h3 + h4 merge → H5 (h5) aur H6 (h6) PARALLEL.
4. h3 + h4 + h5 merge → T1 (t1) — NAYA subagent jis ne H ka code nahi likha. Race fail ho to fix mat kare; failing test + G-row, aur mujhe batao.
5. u0 cl2 ke baad, u1 h6 ke baad real routes se tests chala kar merge.
6. 08d-1 mukammal → board update + mujhe batao, aur RUK jao.
Har waqt jitne subagents ki dependencies poori hon (max 4), sab ek saath.

HAR TASK (har subagent ko plan ki "Global rules" aur apni task row prompt mein do):
- TDD: failing test pehle (failure line PR body mein). Test names `[08d #N]`. Statement counts counter se. Fold hamesha `(order_seq, seq)` order mein; live = recompute = rebuild. µ-minor strings, BigInt andar, floats nahi. Engine ki koi file nahi. Sirf task row ki files.
- Apne test files + touched packages ka typecheck: `TMPDIR=/dev/shm pnpm vitest run <files>` aur `pnpm -w typecheck`. Kabhi `pnpm test:perf` nahi, timing asserts nahi.
- Branch `lane-<L>/<task>`, PR into `module-08d`, commit message plan ke format mein, end mein repo ki Co-Authored-By line.
- Review: ek FRESH reviewer subagent; HIGH par DO fresh reviewers (fold order, statement counts, business_day_id keys, engine untouched, ek divRound). Findings fix karo, phir merge.
- MERGE PERMISSION (sirf module-08d): reviewers clear + CI gate green → task PR ko module-08d mein rebase-merge kar sakte ho. main mein kabhi nahi.

STATUS: docs/plans/08d-status.md har merge ke baad (sirf tum edit karoge). Har batch ke baad 3–5 line Roman Urdu/English update: kya merge hua, kya chal raha hai, koi ruling chahiye to kya.

STOP CONDITIONS (ruk kar pucho): spec–code contradiction; kisi approved spec ka contract/table/event/migration/statement count badalna; plan se bahar file; engine/04/05 file ko chhona; CI gate 2 koshishon ke baad bhi red; koi race test fail; 08b ya 08c ka export spec D§4.1 se mukhtalif; 08d-2 ka koi kaam 08c ke main par aane se pehle.

08d-2 (sirf mere kehne par): module-08d ko main par rebase, 08c ka theoreticalUsage D§4.1 se check (farq → G-row, ruk jao), phir c1 (+ u2 stubs) → c2, c3, T2 (t2, naya subagent) parallel → u2 real routes.

END: Z1 (acceptance map: tests 1–36 + 2b har ek merged PR se mapped; as-built list for 08 v1.2.1) aur Z2 ki hand-check list board mein likh kar ruk jao. Z3 mere kehne par.
```

## Lane prompts (single-lane sessions, if not using the orchestrator)

**Lane C:**
```
Repo arsiihere/pos. CLAUDE.md, docs/plans/08d-plan.md ("Global rules", rows cl1, cl2), spec 08 v1.2 Part D §5.1, §10.4, R-b + 01a v2.10 A-1, 01b v1.11 B-1/B-2, 01c v1.4 C-1 parho. Tasks cl1 → cl2 (stacked lane-C/…), TDD, PR into module-08d, do fresh reviewers. Migration D§5.1 bilkul waisi (0015 aur live branch_engine_settings pehle dobara parho; ek wanted arm; aakhir mein release bump). Builder statement count same rahe. Mismatch par RUK kar docs/plans/08d-status.md mein G-row.
```

**Lane H (08d-1):**
```
Repo arsiihere/pos. CLAUDE.md, docs/plans/08d-plan.md (rows h1–h6), spec 08 v1.2 Part D §3, §5.2, §5.3, §6.1–§6.6, §10.2 parho. Tasks h1 → h2 → (h3 ∥ h4) → (h5 ∥ h6), folder apps/hub/src/inventory/{commands,queries,projections}/ (billing/, voids/ jaisa). TDD, PR into module-08d. Statement counts D§6 ke mutabiq counter se; fold (order_seq, seq) order; replacement original ka order_seq leta hai; engine ki koi file nahi. Sheet chahiye to appendFixtureEvent. HIGH par do fresh reviewers. Mismatch par RUK kar G-row.
```

**Lane H (08d-2, only after 08c is on main):**
```
Repo arsiihere/pos. CLAUDE.md, docs/plans/08d-plan.md (rows c1–c3), spec 08 v1.2 Part D §6.7–§6.9, S12–S14, S20, §10.2 #16–#20 parho; 08c ka theoreticalUsage D§4.1 se milao (farq → G-row, ruk jao). Tasks c1 → (c2 ∥ c3). Test 16 mein 08c stub allowed hai (spec ke mutabiq). PR into module-08d, c1 par do fresh reviewers.
```

**Lane T (fresh session that did not write H):**
```
Repo arsiihere/pos. CLAUDE.md, docs/plans/08d-plan.md (rows t1, t2), spec 08 v1.2 Part D §10.3 parho; H ka code parho, badlo mat. t1 (08d-1): races 23, 25, 28. t2 (08d-2, c1 merge ke baad): 24, 26, 27. Har race dono orders mein, 5 dafa green, timing asserts nahi. Race fail ho to fix mat karo — failing test ke saath PR aur G-row.
```

**Lane U:**
```
Repo arsiihere/pos. CLAUDE.md, docs/plans/08d-plan.md (rows u0, u1, u2), spec 08 v1.2 Part D §8, S18 + 05a v1.0.6 D-1 + 01c v1.4 C-1 parho; client ke existing patterns aur kit components follow karo. u0 owner app fields + thresholds; u1 Inventory screen (test 34; count blank by default, "0" chip, kabhi 0 prefill nahi; local draft; sirf permission wale actions). u2 sirf 08d-2 mein (tests 35, 36). Pehle stubs par, backend merge ke baad real routes. Urdu strings urdu-todo mein. PR into module-08d.
```

---

## Self-review (writer, 2026-11-24)

- Every Part D §11 step maps to a task: 1 → P0.2, 2 → P0.3, 3 → P0.4, 4 → P0.5 (+ c3 for test 19), 5 → cl1 + cl2 (+ u0 for the owner-app half of D§8.4), 6 → h1, 7 → h2, 8 → h3, 9 → h4, 10 → h5 (+ t1), 11 → h6, 12 → u1, 13 → c1 (+ t2), 14 → c2, 15 → u2.
- Every test appears in exactly one task row: 1–7, 2b P0.4; 8–11 h3; 12, 13 h4; 14 h5; 15, 21 h6; 16–18 c1; 19 c3; 20 c2; 22 h1; 23, 25, 28 t1; 24, 26, 27 t2; 29, 30, 32 cl2; 31 cl1; 33 P0.3; 34 u1; 35, 36 u2. Unnumbered unit / component tests: P0.2, P0.5, h2, u0.
- Race tests sit in a lane that did not write the code under test; the close races moved to 08d-2 (AD-1).
- No engine, reducer, 03a, 04 or 05 file in any row; 01a / 01b / 01c / 05a / 08b files only in Shared or Cross rows that name them.
- 08d-2 cannot start before 08c is on `main` (schedule, orchestrator prompt, stop condition).
