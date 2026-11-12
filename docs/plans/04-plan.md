# 04 Voids + Audit — Implementation Plan (spec v1.0)

> **For agentic workers:** every task is TDD (failing test first, record the failure, then implement). One task = one branch = one PR into `module-04` = one commit after review. Lanes run in **claude.ai/code cloud sessions**, the gate runs in **GitHub Actions** (`.github/workflows/gate.yml`). Board: `docs/plans/04-status.md` (created in P0.1). Same working model as `docs/plans/03b-plan.md`.

**Goal:** build 04 v1.0 on the hub — `VoidItems` (direct and approval), kind `void_approval` (read-only `apply`, `onWithdraw`, `result_also_to`), dispositions with move-to-stock, the void lock (02b line guard, 02a merge guard), `pendingVoids` for 05, queries `void-preview` / `pending-voids` / `audit-log` / `audit-staff`, the events-only `audit` projection — plus every upstream row of 04 §4.5, then the clients once the design handoff exists.

**Spec:** `docs/specs/04_Voids_Audit_Spec_v1.0.md` (APPROVED 2026-11-12, with every §4.5 row). Rulings: `docs/stories/04-g1-decisions.md` §1–§10. Known gaps: spec §12.6 (do **not** build them). Reviews: `docs/reviews/04_*` (the final check built H-2 and T-3 in scratch worktrees — 2 239 hub tests green; read its "checked and OK" before P0.5 and U2).

**Starting point:** `main` after `spec-04` is merged (spec, this plan; `main` already has 03b / 03c, `79e907b`). `module-04` is cut from that `main` by the integrator in P0.1.

**What is different from 03b's plan (and why):**

| 03b did | 04 does | Why |
|---|---|---|
| Gap sweep found 14 G-rows after the spec | **Gap sweep still runs** (P0.0), but most names were already checked against code by 5 hostile runs + 6 checks | Cheap insurance; one owner pass if anything turns up |
| Phase 0 had no spike | **Spike test (P0.9) is a phase-0 gate**: no lane opens until it is green | 04 is the first module whose read-only `apply` builds engine + stock drafts (spec R-2) |
| Upstream rows mixed into lanes | **Upstream rows are their own lanes (U1–U4)**, marked Cross, done before the 04 core needs them | Each touches an owner-approved module; one lane per module keeps its reviewers focused |
| — | **Money and permission tests are a lane of their own (T1)** | Owner: voids are credibility-critical; tests written by a session that did not write the code |

---

## Global rules (every task)

- **Branches:** integration branch `module-04`. Task branch `lane-<L>/<task>` (e.g. `lane-V1/v4`). Base = `origin/module-04`, or the lane's previous **unmerged** task branch (stacked; PR body says `Stacked on #<n>`). After a lower PR merges: `git rebase --onto origin/module-04 <old-base> <branch>` and `git push --force-with-lease` — **only on your own task branches**.
- **PR:** title `<task>: <title> [04 §x]`; body: spec sections, tests added (with their failing-first output line), statement counts asserted, readings, `Needs: #…`. Label `lane:<L>`. Rebase-merge only.
- **Commit:** one per task after review: `feat(04): <title> [04 §x; §11 step N]` (upstream rows: `feat(<module>): <title> [04 §4.5 <row>]`), author `Arslan Ahmed Arif <arsiiahmi@gmail.com>`. Review fixes squashed in before the PR is ready.
- **Review:** after the implementation, a **fresh reviewer subagent** (opus) reads the cited spec sections, the diff and these rules. **HIGH** tasks get a second fresh reviewer focused on money, K-1 (`alert_id` on every approval draft), races, statement counts. Fix rounds > 2 → STOP.
- **Tests you run:** your own files (`TMPDIR=/dev/shm pnpm vitest run <files>`) and the typecheck of the package you touched. **The full gate runs in CI.** Exception: P0.5 (H-2) runs the full hub suite once in the lane (it touches every projection's boot path; spec R-3).
- **Tests:** names cite the spec: `it('[04 #21] …')`; real tables and real events, never a mock of another lane's code; use `apps/hub/test/voids/fixtures.ts` (P0.8, built on `apps/hub/test/orders/fixtures.ts` and `apps/hub/test/kds/fixtures.ts`); statement counts with `statementCounter(db)` wherever the spec states one; engine fixtures in **strict mode** for 10f–10h; no timing asserts (03a AD-32).
- **Files:** only the files of your task row. A test that only pins a value an approved row changes may be edited by that row; list it under Readings. Anything else — a contract change, a spec–code mismatch, two specs disagreeing → **STOP**: STOP block in the PR body, label `needs-ruling`, owner answers from the GitHub app; other lanes go on.
- **Do not build** anything in spec §12.4 / §12.6 (override, KDS pending tag, cloud audit view, rejection reason, editable reasons, approver-side disposition change, resell, reports).
- **Events:** no new event types; new optional fields exactly as T-1 / Q-1 (H7-6 Zod). **Logs:** ids and counts only; notes ≤ 40 chars; never PINs, names or phones.

## Markers

| Marker | Meaning |
|---|---|
| **HIGH** | migration, projection, command with alerts / money / stock / races, kind `apply`. Two fresh reviewers. |
| **Shared** | `packages/domain`, `packages/events`, `packages/engine`. Phase 0 or the named lane only. |
| **Cross** | An owner-approved file of another module (00, 01a, 01b, 01d, 02a, 02b, 03a). Only the task that names it. |
| **UI** | Client. BLOCKED until `docs/design/handoff/04/` exists (except UA, an error text). |

---

## Phase 0 — contracts, shared files, spike (integrator, one session, sequential)

| # | Task | Spec | Files | Tests first | Marker |
|---|---|---|---|---|---|
| P0.0 | **Gap sweep** (before anything else): every name, signature, export, field, table, helper the tasks below use, checked against `main` (file:line); mismatches as G-rows with options + Rec in `docs/plans/04-gaps.md`; owner rules once; this plan patched (`docs(04): plan patch from gap sweep`) | all | `docs/plans/04-gaps.md` | — | — |
| P0.1 | Cut `module-04` from `main`; labels `needs-ruling`, `lane:U1…U4`, `lane:V1…V2`, `lane:A1`, `lane:T1`; board `docs/plans/04-status.md` (task table, AD rows, acceptance map skeleton) | — | `docs/plans/04-status.md` | — | — |
| P0.2 | **Spec task 0:** apply every §4.5 row as a spec bump at the **next free number after `main` and every open module branch** (today F v1.13, 00 v1.10, 01a v2.5, 01b v1.9, 01d v1.2.5, 02b v1.0.10, 03a v1.2.4) with changelog + "Changed by 04" markers; README R-1 (row 04, carried rows To 05 / To 06, :227); CLAUDE.md Foundation line if F moves. **Re-read** the intermediate versions first; any conflict → STOP (spec R-1) | 04 §4.5, §11 task 0 | `docs/specs/*`, `docs/specs/README.md`, `CLAUDE.md` | — (docs) | Cross |
| P0.3 | **Shared constants + errors:** `@pos/domain/src/voids.ts` (§4.4), `VOID_NOT_ALLOWED`, `DAY_CLOSE_BLOCKED` in `errors.ts` (+ F §6.2 list in P0.2); `VOID_PENDING` details | §4.4, §9 | `packages/domain/src/{voids,errors}.ts` | codes + HTTP; constants exact | Shared |
| P0.4 | **Event schemas** (needs P0.3's constants, G-22): T-1 optional fields (`ItemVoided`, `ItemMovedToStock`, `StockReleased`, `StockAdded` v2, `StockReserved`) with H7-6's exact Zod; Q-1 `alert_id` on `OrderCancelled` / `OrderFoodCleared` (`.strict()`); D-3: freeze `AlertDetailsBaseV3`, `AlertRaised` **v4** + identity upcaster, `disposition` in the widened base; `raise.ts` payload type V3 → V4 | §4.5 T-1, Q-1, D-3 | `packages/events/src/events/{order,stock,alert}/*`, `packages/events/src/alerts.ts`, `packages/events/src/index.ts`, `apps/hub/src/alerts/raise.ts` | #49 fixtures parse with `null` and absent; v3 → v4 upcast fixture; `details_json` keeps `disposition` | Shared, Cross |
| P0.5 | **H-2:** `applyAll` update-only checkpoints; `registerHubProjections(registry)` exported and used by `createDeps`; `createTestHub` registers through it and runs `catchUp` on the writer's branch id; big fixture derives `PROJECTIONS` from it **+ `access_reconcile`**; M48 test rewritten, #67 seeds a row first; #100 restated (all registered projections + `access_reconcile`, forced alarm, checkpoint = MAX(seq); G-4), big fixture via a recording stub registry (G-3). **Run the full hub suite once** (spec R-3) | §4.5 H-2 | `apps/hub/src/projections/registry.ts`, `apps/hub/src/lib/boot.ts`, `apps/hub/test/helpers/{test-hub,big-fixture}.ts`, `apps/hub/test/projections/registry.int.test.ts`, `apps/hub/test/boot/boot-budget.int.test.ts` | #55c-style: boot with a forced alarm after a projection migration → rows from seq 0; M48 restated; #67; #100 green | HIGH, Cross |
| P0.6 | **Migrations:** hub `0017_staff_names.sql` (table + seed from `staff` / `no_pin_staff`), `0018_audit.sql` (§5: `audit_entries` + 4 indexes, `audit_requests`, `audit_orders`); cloud `0013_void_defaults_backfill.sql` (B-1 steps 1–4, H3-9 CHECK rules). Numbers = next free at P0.6 (last today: hub `0016`, cloud `0012`) | §5; H-1; B-1 | `apps/hub/src/db/migrations/`, `apps/cloud/src/db/migrations/` | schema test (indexes, CHECKs); `staff_names` rows right after migrate (#51b); backfill idempotent, approver rows present, `directory_version` +1 once (#32 half) | HIGH |
| P0.7 | **Skeleton + contracts + wiring:** `voids/contracts.ts` (every export of §4.2 as a typed function that throws `not built` until its task; guards and hooks are **no-ops** until their task), `voids/index.ts` (`registerVoids(app, deps)`), `audit/index.ts` (`registerAudit(app, deps)`, projection registered inside `registerHubProjections` as a no-op fold until A1), one register file per lane (`voids/lanes/{V1,V2}.ts`, `audit/lanes/A1.ts`, empty); kind `void_approval` defined at module top level with a `not built` `apply` (raise refused until V2) | §4.2, §3.5, §6.6 | as listed + one line each in `apps/hub/src/server.ts` / `lib/boot.ts` | boot registers kind + projection without throwing; contracts throw `not built` | — |
| P0.8 | **Test fixtures** `apps/hub/test/voids/fixtures.ts`: an order with a cooking / done / served line, a stock-tracked karahi and a hidden waiting T4 line, a deal ×2 (karahi + naan parts), an item with an own-station option child, a served cold drink with a no-station option, a remake line, a pending-weight kg line, takeaway (token) and parking orders, a merged seating; directories with Cashier / Order taker (`void-item` requires approval by Manager) and Manager; sign-in helpers; `raiseVoid` / `answer` helpers over 01d | §10 | `apps/hub/test/voids/fixtures.ts` | fixtures self-test | — |
| P0.9 | **Spike (spec task 1) — GATE:** test 0 end to end (raise → approve → `ItemMovedToStock` + `StockAdded` 2 of 4 naan → `ItemVoided` folded by 02b → engine line shrunk → no `StockReleased` on the moved share → every draft carries `alert_id` → audit rows) with a throwaway in-test `apply`. **Any failure → STOP** and a §4.5 row; no lane opens | §10 #0; R-2 | `apps/hub/test/voids/spike.int.test.ts` | #0 | HIGH |

**Phase 0 done** when P0.0–P0.9 are merged and CI on `module-04` is green.

---

## Upstream lanes (Cross — one module each)

"Needs" = tasks whose PR must be **merged** first (phase 0 assumed).

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Marker |
|---|---|---|---|---|---|---|---|
| **U1** 02b orders | u1 | Q-2: export `readOrder(ctx, order_id)` + row type; row gains `token, car_number, car_type, business_date`, `table_ids` (aggregate `ORDER BY` inside, H10-2) | §4.5 Q-2 | `apps/hub/src/orders/{exports,commands/remove-items}.ts` | 1 statement; tie-merge order = `currentTableOf` | — | Cross |
| | u2 | Q-4: `lineChangeDrafts(…, { stale_comps: 'close' \| 'keep' })`; `changeDrafts` judges only comp requests on changed lines; `keep` skips the comp read; `LineChangeDrafts` type | §4.5 Q-4 | `apps/hub/src/orders/{line-change,contracts}.ts` | 02b: RemoveItems of an unrelated line leaves a stale comp open; `keep` returns no `AlertClosed`, 1 statement | — | HIGH, Cross |
| | u3 | Q-3: `registerLineGuard`; `CompLine` (every grant) + `applyComp`, `RemoveItems`, `SetLineWeight` ask it with **planned** touched ids, after their own 404 / 409, before scope | §4.5 Q-3 | `apps/hub/src/orders/line-guard.ts`, `orders/commands/{comp-line,remove-items,set-line-weight}.ts` (`applyComp` is in `comp-line.ts:210`, G-13); CompLine plans before scope (G-12) | unregistered → never blocks; registered stub blocks a cascade into a locked part; 1 statement | u1 | HIGH, Cross |
| **U2** 03a engine | u4 | T-2: `stockEffects` excludes **every line named by any `ItemVoided` / `ItemRemoved` cause anywhere in the array** + the moved line from `waitingReserve` | §4.5 T-2 | `packages/engine/src/stock.ts` | #10c–#10h (engine half, strict); #10e same-order K2 still reserved | — | HIGH, Shared |
| | u5 | T-3: remove `ItemRemoved` / `ItemVoided` from `LINE_EVENTS`, drop `QUIET_ON_UNTRACKED_LINE` + their order-quiet entries; restate #125, #133–#135 with an `ItemServed { source: 'tap' }` probe; R-3 test removed | §4.5 T-3 | `apps/hub/src/engine-host/reducer.ts`, `apps/hub/test/engine/{zone-filter,boot-idset}.int.test.ts` | station-less drink / abandoned-order void → no warn; `ItemStarted` unknown → warn; mutation: id-set removal off → #133–#135 red | — | Cross |
| **U3** 00 / 01d / 01a | u6 | H-1: directory apply upserts `staff_names` from the **input** lists (before skips), never deletes | §4.5 H-1 | `apps/hub/src/auth/apply-directory.ts` | a leaver keeps the name; a bad `pin_hash` staff still named | P0.6 | Cross |
| | u7 | D-2: `request.result_also_to`, reject-only extra `request_result` in the same `raiseMany`, outside `checkAlertIds`; requester-only target dropped; new bound asserted | §4.5 D-2 | `apps/hub/src/alerts/{kinds,commands/answer-request}.ts`, `apps/hub/test/alerts/*` | #23 (01d half); #31 bound | — | HIGH, Cross |
| | u8 | A-1: `registerDayCloseGuard` in `CloseBusinessDay` (after `not_open` / `opened_recently`, before append) | §4.5 A-1 | `apps/hub/src/commands/close-business-day.ts` | unregistered → closes; a stub guard → `409 DAY_CLOSE_BLOCKED` with its details | P0.3 | Cross |
| **U4** 01b cloud | u9 | B-1 defaults in `default-roles.ts` (new tenants via `seed-tenant`); B-2 `ALLOWED_ONLY_PERMISSIONS`, `checkGrants` → `422 CONFIG_REFERENCE_INVALID`; roles editor hides the option | §4.5 B-1, B-2 | `apps/cloud/src/modules/staff-roles/{default-roles,service}.ts`, `packages/domain/src/permissions.ts`, editor component + i18n | #32 seed half; 422 | P0.6 | Cross |

## 04 lanes

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Marker |
|---|---|---|---|---|---|---|---|
| **V1** void core | v3 | §3.2 checks (working copy, rules 1, 4–7, V1 incl. (d′), headers / not started §3.1) + per-line dispositions + `voidDrafts` (one `withStockEffects`, one `lineChangeDrafts`, payload order, `alert_id` stamping) — pure over read rows + state | §3.1–§3.3 | `apps/hub/src/voids/plan.ts` | #4–#6, #11, #11b, #13, #14b, #4b–#4f (plan half) | u1, u2, u4 | HIGH |
| | v4 | `VoidItems` direct path (3 statements + 2; D32; scope last) | §6.1 | `apps/hub/src/voids/commands/void-items.ts`, `voids/lanes/V1.ts` | #1–#19b | v3 | HIGH |
| | v5 | Identifier helper (03b `identifierText` copy with 40-char slice, `passIdentity` dine-in branch) | §3.5 | `apps/hub/src/voids/identifier.ts` | #20c | u1 | — |
| | v6 | Kind raise path: one request per entry in one `raiseMany`, values / details (`identifier`, `disposition`, `lines`) / display, `overlaps_entry`, `COMP_PENDING` (stale skipped) | §3.5, §6.1 step 7 | `apps/hub/src/voids/kind.ts` | #20, #20b, #28, #29, #29b | v4, v5, P0.4 | HIGH |
| | v7 | `apply` (no rule 6, frozen dispositions, OQ-F wastage, `keep` mode, K-1 assert) / `onWithdraw` / `result_also_to` | §3.4, §6.2 | `apps/hub/src/voids/kind.ts` | #21–#26c, #30–#30c, #31 | v6, u2, u7 | HIGH |
| **V2** guards & reads | v8 | Merge guard (moved orders only on split), line guard registration, day-close guard registration, `pendingVoids` (`blocked`) | §6.6, §4.2, A-1 | `apps/hub/src/voids/{guards,exports}.ts`, `voids/lanes/V2.ts` | #24b, #27, #33–#36 | v6, u3, u8 | HIGH |
| | v9 | `void-preview` (1–40 ids, 3 statements, `group`), `pending-voids` | §6.3, §6.4 | `apps/hub/src/voids/queries/*` | preview per id; statement counts; 403 | v8 | — |
| **A1** audit | a1 | `toAuditEntry`, `AUDIT_ACTIONS`, `registerAuditAction`, columns per action (requester as actor, `request_closed`, moved-row approver) | §3.6 | `packages/domain/src/audit.ts` | #50, #53, #56 | P0.3 | Shared |
| | a2 | Projection `audit` (events only: own `audit_requests` / `audit_orders`, no other table read) inside `registerHubProjections` | §5, §3.6 | `apps/hub/src/audit/projection.ts`, `audit/lanes/A1.ts` | #48, #54, #55, #55b, #55c | a1, P0.5, P0.6 | HIGH |
| | a3 | `audit-log` (cursor, `UNION ALL` merge, no temp sort, names from `staff_names`) + `audit-staff` | §6.5, §6.5b | `apps/hub/src/audit/queries.ts` | #51, #52, #60b (server half) | a2, u6 | — |
| **T1** money & permissions (fresh session, did not write V1) | t1 | Money tests 40–49 incl. the **500-sequence property test** against an independent unit-by-unit model | §10 #40–#49 | `apps/hub/test/voids/money.*.test.ts` | they are the tests | v4, v7 | HIGH |
| | t2 | Permission matrix 32 (every grant state, approver ranges, allowed-only move, defaults after seed + backfill) | §10 #32 | `apps/hub/test/voids/permissions.int.test.ts` | they are the tests | v7, u9 | HIGH |

**04 hub: 10 phase-0 tasks + 9 upstream + 12 lane tasks.**

## 04 client

| Lane | Tasks | Files | Spec |
|---|---|---|---|
| **UA** day-close text (not blocked) | `DAY_CLOSE_BLOCKED` message + list in `StockApp.tsx` `errorMessage`; chain-stops test | `apps/client/src/features/admin/stock/StockApp.tsx`, i18n | A-1 client; #24b client |
| **VU1** void sheet — BLOCKED on `docs/design/handoff/04/` | Void action, sheet (preview, units, disposition radios + disabled reasons, reason chips, notes, Ask / Void), Void all (Remove first, parents only, per-entry defaults, stop on Remove failure), PENDING VOID tag + total, error texts, requester `blocked` row | `apps/client/src/features/voids/` | §8; #57–#59 |
| **VU2** audit screen — BLOCKED | filters, staff picker from `audit-staff` ("left"), infinite scroll by cursor, CSV | `apps/client/src/features/audit/` | §8; #60, #60b |

Ask the designer now for: Void sheet (incl. Void all), PENDING VOID tag on order / bill views, Audit log screen.

## Close (integrator)

| # | Task | Needs |
|---|---|---|
| Z1 | Acceptance map in the board (every story AC and §12.2 row → green test names; §12.6 gaps listed as "not built") | all hub tasks |
| Z2 | Run `docs/plans/01d-manual-checks.md` rows 1b, 4, sounds, request screens with `void_approval` on a tablet (README :227); `docs/plans/04-manual-checks.md` (Cashier asks, Manager approves on own tablet, served-meanwhile message, day close blocked then closes) | Z1, VU1 |
| Z3 | PR `module-04` → `main` (owner merges) | Z1 (Z2 may follow the client) |

---

## Lane launch schedule (at most 5 lanes at once)

| Step | Open | When |
|---|---|---|
| 1 | U1, U2, U3, U4, A1 | phase 0 merged (spike green) |
| 2 | V1 | u1, u2, u4 merged |
| 3 | V2 | v6, u3, u8 merged (a slot frees when U2 / U4 end) |
| 4 | T1 | v4 and v7 merged |
| 5 | UA any time a slot is free; VU1, VU2 when the handoff lands | — |

Critical path: P0.0 → P0.9 (spike) → u1 / u2 / u4 → v3 → v4 → v6 → v7 → t1. Everything else runs beside it.

## Gap sweep patches (P0.0, owner ruling 2026-11-12 13:17 PKT — every Rec; `docs/plans/04-gaps.md`)

Lanes read part 1 of `04-gaps.md` for exact names, and these rows as part of their task:

| Task | G-row | What the task does |
|---|---|---|
| P0.2 | G-1, G-4, G-7, G-8, G-11, G-12, G-14, G-17, G-19, G-20, G-21, G-23 | Writes the ruled text into the target bumps, and bumps **04 → v1.0.1** (v1.0 kept, changelog, "Changed by v1.0.1 (G-n)" markers, README row). G-11 adds a marker to 01d's "Changes in v0.4" row 4. G-14 replaces "03b's `currentTableOf`" with 02a's. G-23 fixes the 02b §3.5 `ctx` text and the +1 statement counts. |
| P0.4 | G-22 | Runs after P0.3 and imports `VOID_REASON_CODES` and `VOID_DISPOSITIONS` from `@pos/domain`. |
| P0.5 | G-3, G-4, G-6 | The big fixture derives `PROJECTIONS` from a recording stub registry passed to `registerHubProjections`, in the same commit as update-only. #100 is restated. The admin-bootstrap CLI gets no code change and is named in H-2's invariant note. |
| P0.6 | G-1, G-20 | The `staff_names` seed uses `(SELECT COALESCE(MAX(recorded_at), 0) FROM events)`. The B-1 backfill touches only `archived_at IS NULL` grantee and manager roles. |
| u1 | G-14, G-16 | Exports `readOrder` from `orders/exports.ts` with `ReadOrderHead` / `ReadOrderLine`, and `table_ids: string[]` parsed from JSON. The file header notes the `ctx` / throw exception. First runs `select sqlite_version()` (≥ 3.44). |
| u2 | G-15 | Puts the `stale_comps` option on `changeDrafts` too (`keep` skips `staleCompCloses`), makes `freeOf` return `undefined` for ids not in `changes`, and widens `LineChangeDrafts`. |
| u3 | G-12, G-13 | Moves CompLine's `compDrafts` / `planComp` (pure) above `checkScope` and asks the guard with the plan's ids. `applyComp` plans, then asks (1 → 2 statements). Updates the statement comments. |
| u4 | G-17 | The array overload pre-scans every `ItemVoided` / `ItemRemoved` line into a `Set`. `waitingReserve(…, except: ReadonlySet<string>)`. The single draft uses `{ moved line }`. |
| u5 | G-18 | Swaps `unknownVoid` for `served(…, 'tap')`, drops the void / remove rows of the #125 control, and adds an `ItemStarted`-unknown warn row. |
| u7 | G-7, G-8, G-9 | Adds `result_also_to?(ctx: AlertApplyCtx)` on a `readOnlyTx`, called in `handle` on a reject only (never in `preRead`). Adds an internal `RaiseInput.drop_if_only?: staff_id`, and `target` / `dedupe_key` overrides on `requestResultInput`. Test: a fake approval kind with and without the hook (reject +2, approve / withdraw equal) plus a `raiseMany` spy. 04 #31 cites it. |
| u6 | G-2 | Upserts staff, then no-pin; the first id wins, as the cache does. Test beside "bad `pin_hash` still named". |
| u9 | G-19 | The allowed-only check runs first in `checkGrants`, before the approver check. |
| v5 | G-14 | "No current table" = `table_ids.length === 0` (`readOrder`'s `primary_table_id` is ignored for it). Test 20c adds a closed-seating fixture. |
| v6 | G-10 | `details_schema` = `AlertDetailsBase.pick(…).extend({ lines })`, with `lines` ≤ 10 and `state` as an enum (kind-local). |
| v3 / v4 / v7 | risks | `day_closed` is checked before `openDayStockCtx`, which throws a plain `Error`. `alert_id` is stamped on payloads **after** `withStockEffects`, which restamps envelopes. |
| a3 | G-5 | Copies the alerts-inbox cursor (base64url JSON + Zod) into `audit/queries.ts` with cursor `{ r: recorded_at, s: seq }`. `querySchema` declares `cursor` and `limit`. |
| UA | G-21 | Adds `items?: string[]` to `Message`, rendered in `Banner`. Test: a 409 on Close sends no Open. |

## Follow-up tasks (owner rulings 2026-11-12 20:21)

Owner "haan" on Q-14 (b), Q-15 (b), Q-16; spec text in **04 v1.0.3**, **02b v1.0.12**, **03c v1.0.8** (README rows). Global rules above apply (TDD, own files only, STOP on any spec–code mismatch).

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Marker |
|---|---|---|---|---|---|---|---|
| **U1** 02b orders | u10 | Q-14 (b): migration `0019_order_line_station.sql` (`ALTER TABLE order_lines ADD COLUMN station_id TEXT` + delete the `orders` checkpoint → refold from seq 0, safe by H-2); the `ItemAdded` fold writes `station_id` (`NULL` for a deal header); `readOrder`'s line row gains `station_id` (still 1 statement); the planner judges "engine line" as `station_id IS NOT NULL` and not a deal, dropping v3's "order out of engine → every non-deal line is a station line" proxy | 04 §3.1, §4.5 Q-14; 02b v1.0.12 §5, §4.2 | `apps/hub/src/db/migrations/0019_*.sql`, `apps/hub/src/orders/projection.ts`, `apps/hub/src/orders/exports.ts`, tests; also edits V1's `apps/hub/src/voids/plan.ts` (Cross) | 02b #51 (column, deal header `NULL`, refold with a forced boot-time `ClockAlarm`, `readOrder` 1 statement); 04 #4g; 1–19b unchanged | v3 | HIGH, Cross |
| **P** printing | p1 | Q-15 (b): the ticket fold queues the `cancel` job with `slip: 'moved'` for `ItemVoided { disposition: 'moved' }`; the renderer prints the MOVED TO STOCK slip (`print.slip.moved_to_stock`, en / ur) instead of CANCELLED; every other share still CANCELLED; suspect recovery keeps the payload; add the pilot manual-check row (moved line on the KDS) to `docs/plans/03c-manual-checks.md` | 03c v1.0.8 §3.3, §3.5, §11 task 28; 04 §3.3, §4.5 Q-15 | `apps/hub/src/print/**` as needed, i18n en / ur, tests | 03c #4b (golden bytes of `MOVED TO STOCK - FINISH & KEEP`), #25 (moved slip recovers as moved) | — (Q-17 ruled English, owner 2026-11-12 20:42) | Cross |
| **V1** void core | v6b | Q-16: a deal header line's `details.lines` state = the most advanced part state, `served > cooked > cooking > not_started` | 04 §3.5 | `apps/hub/src/voids/kind.ts`, tests | 04 #20d | v6 | — |

**module-04 → main merge (Z3)** — 02b has two sibling bumps (main's v1.0.11, module-04's v1.0.12):

| # | Task | Needs |
|---|---|---|
| Z3a | Write 02b v1.0.13 = main's v1.0.11 + v1.0.12 (tests 41–51; README keeps v1.0.11 and v1.0.12) | Z3 |

## Self-review (writer, 2026-11-12)

- **Coverage:** spec §11 rows 0, P0, P0b, P1–P6, 1–17 → P0.2 (0), u6 + P0.6 (P0 / H-1), P0.5 (P0b / H-2), P0.3 / P0.4 / u4 / u5 (P1), P0.4 (P2), P0.4 / u7 (P3), u1–u3 (P4), u9 + P0.6 (P5), u8 + UA (P6), P0.9 (1), P0.3 / v5 (2), v3 (3), v4 (4), v6 (5), v7 (6), v8 (7), v9 (8), t1 (9), t2 (10), a1 (11), a2 (12), a3 (13), VU1 (14), VU2 (15), Z2 (16), Z1 (17). Every §10 test 0–60b is named in a row.
- **No shared file in two lanes:** schemas, constants, errors, migrations, H-2 helpers, kind definition, contracts and fixtures are phase 0; each lane writes its own `lanes/<L>.ts`; `kind.ts` is V1 only (v6 then v7, same lane).
- **Credibility-critical paths get two reviewers + an independent test lane:** money (v3, v4, v7, t1), K-1 (v7), stock (u4), locks (u3, v8), boot (P0.5), audit fold (a2).
- **Known gaps** (spec §12.6) are excluded by a global rule, so no lane builds an override or a cloud view by accident.
