# 05 Billing — Implementation Plan (spec v1.0)

> **For agentic workers:** every task is TDD (failing test first, record the failure, then implement). One task = one branch = one PR into `module-05` = one commit after review (NORMAL tasks may share a PR, 2–3 consecutive small ones, one commit each, owner Q-41; HIGH tasks always have their own PR). Lanes run in **claude.ai/code cloud sessions**, the gate runs in **GitHub Actions** (`.github/workflows/gate.yml`). Process, tiers, reviewer rules, branch and sync recipes: `docs/plans/integrator-handbook.md` (followed exactly; it wins over nothing but the spec and CLAUDE.md). Board: `docs/plans/05-status.md` (created in P0.B from the skeleton in §9 below). Same working model as `docs/plans/04-plan.md`.

**Goal:** build 05 v1.0 on the hub — bills, splits, discount, sticky service charge, tax from jurisdiction data, rounding adjustment, payments and change, close per split → invoice, reopen + credit, remove comp, buyer tax ID with its privacy rules, shifts / blind count / handover / petty cash / drawer, day-close guard + appender + carry-over, X / Z, the fiscal port, the `none` adapter, the fiscal outbox and worker, the PRA adapter (gated) — plus every §4.5 row in the other specs, then the clients once the design handoff exists.

**Spec:** `docs/specs/05_Billing_Spec_v1.0.md` (APPROVED 2026-11-18 16:33 PKT). Rulings: `docs/stories/05-g1-decisions.md` §1–§29 (§13: version numbers re-taken in phase 0 after `module-deeplinks` reaches `main`). Known gaps: spec §12.7 — do **not** build them (pro rata, per-rate rounding, other adapters, cross-tenant view, client formatters outside 05, weighed-line step, everything in §12.4). Reviews: `docs/reviews/05_*` (runs 1–18; §12.7 (f) lists what runs 16–18 did **not** model — those areas get the extra reviewer focus named in the lane tables).

**Starting point:** `main` after **both** (1) `spec-05` (PR #219: spec, G0 / G1, this plan) and (2) `module-deeplinks` (and any other branch that claims a spec 05 bumps) are merged. `module-05` is cut from that `main` in P0.B. **On 2026-11-18 neither is on `main`**: `module-deeplinks` @ `e38c45d` has 5 open lane PRs (#254, #259, #261, #262, #263) and already holds 01d **v1.3.1 and v1.3.2**, 02a v1.1.7, 02b v1.0.15, 03a v1.2.5, 04 v1.0.6 — so 05's provisional 01d v1.3.1 is already taken and P0.1 renumbers it (no STOP, H5-1). Cloud `0014` / `0015` are claimed by `lane-HD/h10` (PR #126 into `module-02-hub-gaps`); 05's provisional cloud `0016` / `0017` already skip them.

**What is different from 04's plan (and why):**

| 04 did | 05 does | Why |
|---|---|---|
| One build phase | **Two plan phases in one spec: 05-1 then 05-2** (owner OQ-2 (b), README R38; spec §11 "Plan phases") | 65 tasks; every payment needs a money shift, the Z needs both halves |
| Spike = spec task 1 | **Spike P0.S is a plan gate** (spec and handbook name none; 04 G1-8 precedent): close → `InvoiceIssued` → outbox → `none` adapter → receipt, plus a fake-adapter leg through the worker. No lane opens until it is green | 05 is the first module whose close writes money, an external outbox row and a print job in one transaction, on tables (0023) that cannot be edited after merge |
| Upstream rows as lanes U1–U4 | **Upstream rows are phase 0** (spec §11 P0.1–P0.18), merged **in the spec's order**, each its own PR; implementation may run ahead in up to four module lanes (U0–U3) | Owner: phase 0 first, in spec order |
| Money tests lane T1 | **Lane T** writes the compute property tests (task 3) in a session that did not write task 2 | Same credibility rule |
| One fiscal path (none) | **Fiscal lanes F and PRA**; PRA is **gated on A13 + A14** and PRA's spec v1.2 (Appendix P §P.5) | Authority answers change the adapter, never the core |

---

## 1. Global rules (every task)

- **Branches:** integration branch `module-05` (both phases). Task branch `lane-<L>/05-<task>` (e.g. `lane-B2/05-17`, `lane-P0/05-p0.11`; the `05-` keeps names apart from earlier modules' `lane-B1/…`). Base = `origin/module-05`, or the lane's previous **unmerged** task branch (stacked; PR body says `Stacked on #<n>`). After a lower PR merges: `git rebase --onto origin/module-05 <old-base> <branch>` and `git push --force-with-lease` — **only on your own task branches**. Worktree per lane (handbook §3); shallow clone → explicit refspecs; **never `git stash`**; never push `main` or `module-05` directly.
- **PR (REST only, `gh api`):** title `<task>: <title> [05 §x]` (bump rows: `[05 §4.5 <row>]`); body: spec sections, tests added with their failing-first output line, statement counts asserted, Readings, `Needs: #…`, tier. Labels `lane:05-<L>` and `tier:HIGH` / `tier:NORMAL`. Rebase-merge only.
- **Commit:** one per task after review: `feat(05): <title> [05 §x; §11 task N]`; bump-row code: `feat(<module>): <title> [05 §4.5 <row>]`; spec bumps: `docs(<module>): v<x> — 05 rows <…> [05 §4.5]`. Author `Arslan Ahmed Arif <arsiiahmi@gmail.com>`. Review fixes squashed in before the PR is ready.
- **Tiers and reviewers (handbook §4–§6, owner Q-39 / Q-41 / Q-60):**

  | Tier | Areas in 05 | Implementer | Reviewers |
  |---|---|---|---|
  | **HIGH** | money (tax, discount, service charge, rounding line, splits, payments, change, refunds); close transaction and races; fiscal outbox / retry / worker; shifts / drawer / blind count / petty cash; day close + Z / X; fiscal adapter port and the PRA adapter; reopen + the tables bumps (`SeatingReopened`, S-9); buyer-ID privacy (hash omit, filler, redaction); approvals (01d kinds, holders right); print retry / retarget; migrations and projections | Opus | **2 fresh Opus**, independent; reviewer 2 focuses on money (BigInt, half-up points, Σ invariants), races (`BEGIN IMMEDIATE`, retransmit with the same `command_id`), privacy (no buyer ID / token / name / free text in an event, log, hash, response), statement counts |
  | **NORMAL** | settings shapes, permissions and seeds, print `Doc` builders, screens (except the payment pad), audit mappings, text / i18n, docs, spec bumps | Sonnet | 1 Sonnet |

  Reviewers return BLOCKER / MAJOR / MINOR with file:line. Fix rounds only for BLOCKER / MAJOR; at most 2; a MAJOR open after round 2 → **STOP** (board "STOPs / needs-ruling"). A re-check only mutation-verifies the MAJORs. Both HIGH reviewers asking for changes (or one approve, one change) → the second approval is a fresh re-check reviewer who mutation-verifies every MAJOR (AD-C18). **Money MINORs are fixed before merge**; other MINORs go to `docs/plans/05-cleanup.md` (file, line, finding, PR, who fixes) and never block a merge. A NORMAL task that turns out to touch a HIGH area is re-tiered on the board (handbook §4).
- **Usage economy:** **at most 4 agents at once** (implementers + reviewers together; the integrator session is the orchestrator and not counted). Reviews of finished work take a free slot before a new implementation starts. Opus only for HIGH implement + review; Sonnet for NORMAL tasks, docs and small reviews. State lives on the board, not in chat (handbook §1).
- **Tests you run:** your own files (`TMPDIR=/dev/shm pnpm vitest run <files>`) and the typecheck of the package you touched. **The full gate runs in CI** on every PR into `module-05` (`postgres:16` on 5433 with the three test-only settings; SQLite on `/dev/shm`). Exception: P0.12 and task 6 run the full hub suite once in the lane (they refold `orders` / `audit` from seq 0 and change the migration list every migration test reads).
- **Tests:** names cite the spec: `it('[05 #17] …')`, bump rows `it('[05 row Q-3] …')`, the spike `it('[05 spike] …')`, Appendix P `it('[05 P-T1] …')`; real tables and real events, never a mock of another lane's code; fixtures `apps/hub/test/billing/fixtures.ts` (P0.F, built on `apps/hub/test/orders/fixtures.ts` and `apps/hub/test/voids/fixtures.ts`); statement counts with `statementCounter(db)` wherever the spec states one, at 1 and at 40 (#91); **no timing asserts** (03a AD-32); money in integers, BigInt where products can pass 2^53.
- **Files:** only the files of your task row. `apps/hub/src/billing/index.ts` is created in task 7; every later task adds **only its own registration lines** there (spec §11 H6-14); additive one-line conflicts are resolved at rebase (02b precedent). A test that only pins a value an approved row changes (version, migration list, key list) may be edited by that row; list it under Readings. Anything else — a contract change, a spec–code mismatch, two specs disagreeing, a §12.7 (f) area behaving differently from the text → **STOP**: STOP block in the PR body, label `needs-ruling`, owner answers from the GitHub app; other lanes go on. Never a silent fix.
- **Privacy (B19, B22, B30, row H-4):** no buyer tax ID (any type), token, PIN, name, phone, note, `paid_to` or payment reference in an event, log line, alert, audit row, hash, `VALIDATION_FAILED.issues` or response; ids and counts only. **No token or secret in any file** — PRA fixtures use the literal `test-token`; the sandbox and production tokens are entered by the owner on the pilot hub's `/admin/fiscal/` page only. Before every commit: `git diff --cached | grep -nE '/home/|/Users/|Bearer [A-Za-z0-9]{12,}'` must be empty (handbook §9, W-5: the repo is public).
- **Never in the cloud or CI:** `pnpm test:perf`, printer / drawer / QR-scan / hardware checks, power-loss checks, the PRA sandbox call (no network in the gate). They are listed in §8 for the owner's machine or the pilot hardware.
- **Do not build** anything in spec §12.4 / §12.7 (a) or §1.3, and no `pro_rata` path (`MIXED_CLASS_RULES = ['higher_rate']`; the `0016` CHECK and the snapshot parser refuse it).

---

## 2. Phase 0 — numbers, bumps, upstream code, 05 base, spike

### 2.1 Gate before phase 0 (integrator)

| # | Check | Done when |
|---|---|---|
| G0.1 | `spec-05` merged into `main` (PR #219) | `git merge-base --is-ancestor origin/spec-05 origin/main` |
| G0.2 | `module-deeplinks` has reached `main` | `git log origin/main..origin/module-deeplinks` shows only merge commits whose trees `main` already has (handbook §7.1 check) |
| G0.3 | No other open branch / PR claims a target spec or migration number | `gh api 'repos/arsiihere/pos/pulls?state=open'` + `git ls-tree` of every `origin/*` ref under `docs/specs/`, `apps/hub/src/db/migrations/`, `apps/cloud/src/db/migrations/`; result written to the board |

Until G0.1–G0.3 hold, phase 0 does not start (nothing else in this plan can). The owner sees the state on the board.

### 2.2 Integrator tasks (sequential)

| # | Task | Spec | Files | Tests | Tier |
|---|---|---|---|---|---|
| P0.B | Cut `module-05` from `main`; ruleset as 04 W-1 (PR required, check `gate`, rebase merge, no force push); labels `needs-ruling`, `tier:HIGH`, `tier:NORMAL`, `lane:05-P0`, `lane:05-U0…U3`, `lane:05-M`, `-T`, `-K`, `-S`, `-B1`, `-B2`, `-P`, `-F`, `-PRA`, `-A`, `-Z`, `-C1`, `-C2`; board `docs/plans/05-status.md` from §9; `docs/plans/05-cleanup.md` (empty, header as `03b-client-cleanup.md`) | — | `docs/plans/05-status.md`, `docs/plans/05-cleanup.md` | — | NORMAL |
| **P0.1** (spec task 0) | **Re-take the next free numbers** on `main` and every branch / open PR (G0.3 scan): F, 00, 01a, 01b, 01d, 02a, 02b, 03a, 03c, 04; hub migrations (provisional 0021–0023), cloud (0016–0017). Write **05 v1.0.1** (numbers only: changelog row, "⚠️ Changed in v1.0.1 (P0.1, H5-1)" markers in §4.5, §11, §12.7 (d), the Depends-on line; v1.0 kept) and README row 05 in the **same commit**. A pure renumber is **no STOP** (H5-1, §13). Expected today: 01d → v1.3.3 or later (v1.3.1 / v1.3.2 taken on `module-deeplinks`); the others move only if `main` moved | §4.5 head, §11 P0.1, §12.7 (d); G1 §13 | `docs/specs/05_Billing_Spec_v1.0.1.md`, `docs/specs/README.md` | — (docs) | NORMAL |
| P0.G | **Gap sweep** (04 P0.0 pattern, read-only): every name, signature, export, table, column, helper and statement count the tasks below use, checked against `main` (file:line), with extra weight on spec §12.7 (f) ("migrations, statement counts, version numbers — not checked"); mismatches as G-rows with options + Rec in `docs/plans/05-gaps.md`; owner rules once; this plan patched (`docs(05): plan patch from gap sweep`); ruled text that changes a spec goes into the P0.2 bumps or a 05 v1.0.2 | all | `docs/plans/05-gaps.md`, this file | — | NORMAL |

### 2.3 Spec bumps (P0.2 — one PR per target, in §4.5 row order)

Each PR: re-read `main`'s current text of the target **and every version between the one 05 was written against (spec "Depends on" line) and `main`'s**; apply the rows to a **new version file** (old kept), changelog row, "⚠️ Changed by 05 (row X-n)" markers (R34), README row of that spec. **STOP rule:** if a section a row edits moved in a way the row did not foresee (a content clash, not a renumber), STOP for the owner (`needs-ruling`), and the code task of that row waits. Reviewer: 1 Sonnet, checks the text equals the row and nothing else changed.

| # | Target → version (provisional; P0.1 fixes it) | Rows | Written against |
|---|---|---|---|
| P0.2a | Foundation → v1.14 (+ §6.2 append F-5; CLAUDE.md source-of-truth line, owner merges, 04 P0.2 precedent) | F-1, F-2, F-3, F-4, F-5, F-6 | v1.13 |
| P0.2b | 00 Hub Platform → v1.12 | H-1, H-2, H-3, H-4, H-5 | v1.11 (DRAFT) |
| P0.2c | 01a → v2.6 | A-1, A-2, A-3, A-4, A-5 (A-6 dropped) | v2.5.1 |
| P0.2d | 01b → v1.10 | B-1, B-2 (B-3 dropped) | v1.9.1 |
| P0.2e | 01d → v1.3.1 → re-taken (≥ v1.3.3) | D-1 | v1.2.5 + `module-deeplinks`' v1.3 – v1.3.2 |
| P0.2f | 02a → v1.1.8 | T-1, T-2, T-3 | v1.1.6 + v1.1.7 |
| P0.2g | 02b → v1.0.16 | Q-7, Q-1, Q-2, Q-6, Q-5, Q-3, Q-4 | v1.0.14 + v1.0.15 |
| P0.2h | 03a → v1.2.6 | S-1 | v1.2.4 + v1.2.5 |
| P0.2i | 03c → v1.0.11 | P-1, P-2, P-3, P-5, P-4 | v1.0.10 |
| P0.2j | 04 → v1.0.7 | V-1, V-2, V-3 | v1.0.5 + v1.0.6 |
| P0.2k | README | R-1 (R37 amends R13 with marker; R38; milestone C text; module map row 05; carried rows To 05 marked landed per §4.6; new To 06 / To 07 rows from §4.3) | — |

### 2.4 Upstream code rows (spec §11 P0.3–P0.18; merged in this order)

Each row needs its P0.2 bump merged first (spec-first). Implementation may run ahead in four module lanes — **U0** platform (00 / F), **U1** 01a / 01b / 01d, **U2** 02a / 02b / 03a / 04, **U3** 03c — but PRs merge in the order below, **except where "Needs" names a later row** (PL-11: P0.5 and P0.6 use permissions B-1 defines in P0.7, so P0.7 merges before them; P0.10 uses P0.17's `renderText`, so it merges after P0.17). "Needs" = merged first.

| # | Lane | Task | Spec | Files (own) | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| P0.3 | U0 | F-1 `bill` stream type; F-6 `currencyExponent` (ISO 4217 table, unknown code refused); H-5 `seed-tenant` currency check | F-1, F-6, H-5 | `packages/events/src/envelope.ts`, `packages/domain/src/currency.ts` (new), `apps/cloud/src/cli/seed-tenant.ts` | **#14c** (written here; P0.9 extends); H-5: `PKX` refused, nothing written; `PKR` seeded | P0.2a, P0.2b | HIGH |
| P0.4 | U0 | H-1 `sessionKind: 'both'` (one `command_id` space, same handler, permission from the session's staff) | H-1 | `apps/hub/src/commands/{registry,route}.ts` | #80 | P0.2b | NORMAL |
| P0.4b | U0 | **H-4 `hashOmit`** (dotted paths; omitted fields never hashed, stored, logged or echoed; `VALIDATION_FAILED` drops `input` / received values); the "no request body logged" test. *Plan addition PL-1: the row has code, §11 has no task for it* | H-4 | `apps/hub/src/lib/hash.ts`, `apps/hub/src/commands/{registry,route}.ts` + a logging test | `[05 row H-4]`: retransmit differing only in an omitted field = same command; captured logger sees no body on `/commands/*` and `/admin/commands/*`; issue paths name `tax_id.value`, never the value | P0.4 | HIGH |
| P0.5 | U0 | H-2 `/admin/fiscal/` entry + side-nav + home tile, shown by `manage-fiscal-settings` (page body is task 31a's) | H-2 | `apps/hub/src/admin/`, `apps/client/src/features/admin/fiscal/` (shell only) | nav shown / hidden by the permission | P0.2b, P0.7 | NORMAL |
| P0.6 | U1 | A-3 guard list, A-4 appender list, A-5 `close-business-day` permission + `'both'` + Stock page text (`DAY_CLOSE_BLOCKED` reasons `shift_open` / `unbilled_orders` listed via `Message.items`) | A-3–A-5 | `apps/hub/src/commands/close-business-day.ts`, `apps/client/src/features/admin/stock/StockApp.tsx` | #68, #79 (day-close half); 01a #196 kept; two guards, first wins; appender drafts before `withStockEffects(…[BusinessDayClosed])` | P0.4, P0.7 | HIGH |
| P0.7 | U1 | B-1 permissions (group `bills`, scopes, `ALLOWED_ONLY_PERMISSIONS`, approvable list, `checkGrants` refusal of `close-shift-for-others` without `manage-own-shift`); D-1 01d **holders right** `{ mode: 'holders', permission }` | B-1, D-1 | `packages/domain/src/permissions.ts`, `apps/hub/src/alerts/{kinds,targets,raise}.ts`, `apps/hub/src/alerts/commands/answer-request.ts`, cloud `staff-roles/service.ts` | **#53b** (written here; tasks 21 / 22 extend); holders matrix, never self | P0.2c, P0.2d, P0.2e | HIGH |
| P0.8 | U1 | B-2 default roles + cloud `0017_billing_defaults_backfill.sql` (by `default_key`, active roles, approver rows, `directory_version` +1) | B-2 | `apps/cloud/src/modules/staff-roles/default-roles.ts`, `apps/cloud/src/db/migrations/0017_*.sql` | #90 | P0.7 | NORMAL |
| P0.9 | U1 | A-1 / A-2 billing settings (`branch_billing_settings`), **jurisdiction catalog** (`none`, `PK`, `PK-PB` from the one shared constant `@pos/events/src/admin/jurisdiction-seeds.ts`, H11-5), CHECK `mixed_class_rule = 'higher_rate'`, routes `GET` / `PUT …/billing` and `GET /v1/admin/jurisdictions`, snapshot `billing` key with `jurisdiction` and `tax_profiles`; `apps/hub/src/billing/defaults.ts` (built-in `PK` / `none` rules) | A-1, A-2 | `apps/cloud/src/modules/billing-settings/`, `apps/cloud/src/db/migrations/0016_billing_settings.sql`, `packages/events/src/{config,admin/billing,admin/jurisdiction-seeds}.ts`, `packages/events/src/admin/fiscal-adapters/`, `apps/hub/src/billing/defaults.ts` | #14, #14b, #14c (extended); seeds = constant; no `pro_rata` seed; currency mismatch 422; `profile_missing` | P0.3, P0.2c | HIGH |
| P0.10 | U1 | A-1 (6) owner **Billing** page with receipt preview (`renderText` from P0.17) and the jurisdiction view | A-1 (6), §8.1 | `apps/client/src/features/owner/billing/` | form round-trip, 422 field mapping, preview text | P0.9, P0.17 | NORMAL (UI, Q-P2) |
| P0.11 | U2 | T-1 merge guard list (`MergeGuard` returns `{ code, details }`); T-3 `SeatingReopened`, `OrderPlaced` on `bill_closed = 1`, `requireLock(…, { allowBillClosed })` for live `SubmitOrder` only, `readOrder.seating_state`, `RemoveItems` skips the lock on CLOSED, audiences (+ `BillClosedEmpty` fold when `seating_id` non-null) | T-1, T-3 (1)–(7) | `apps/hub/src/tables/{contracts,merge-guard,lock,projection,audiences}.ts`, `apps/hub/src/tables/commands/{merge-tables,split-seating}.ts`, `packages/events/src/events/table/SeatingReopened.v1.ts`, client `features/staff/tables/map/map-store.ts`, `orders/table-view/refetch.ts` | #79 (merge half), **#37b, #37c, #37d, #37e, #37f, #37g, #37h** | P0.2f | HIGH |
| P0.12 | U2 | Q-1 `order_lines.tax_profile_id` + `0021_orders_billing.sql` (also `carried_over`, `bill_key` + index, `orders_token_day` replacing unique `orders_token`; deletes the `orders` checkpoint → refold); `LineView` / `ReadOrderLine` gain the field (same statements). **Runs the full hub suite once** | Q-1 (+ Q-5, Q-6 columns) | `apps/hub/src/orders/{projection,exports}.ts`, `apps/hub/src/db/migrations/0021_orders_billing.sql`, `apps/hub/test/db/alerts-migration.int.test.ts`, `apps/hub/test/db/order-line-{options,station,option-quantity}-migration.int.test.ts`, new `apps/hub/test/db/orders-billing-migration.int.test.ts` | #82; two `(date, 56)` tokens accepted; `orders_token` gone | P0.2g | HIGH |
| P0.13 | U2 | Q-2 `OrdersUnbilled` (fold clears `billed_at` and `day_closed_at`; joins `ORDER_EVENT_TYPES` and client `ORDER_FRAMES`); Q-4 `LineCompRemoved` + `planCompRemoval`; Q-5 `OrdersCarriedOver` fold + `applyDayClosed` skip; Q-6 `adds_to_order_id` (root's token, own `table_key`, root's `bill_key`); 03a S-1 `OrderPlaced.adds_to_order_id` | Q-2, Q-4, Q-5, Q-6, S-1 | `packages/events/src/events/order/`, `apps/hub/src/orders/` (projection, build-submit, commands/submit-order), client order frame lists | #83, **#83b**, #84; S-1 fixtures with / without the field | P0.12, P0.2h | HIGH |
| P0.13b | U2 | **Q-7 `registerOrderCancelledHook`** called by `changeDrafts` when it emits `OrderCancelled` (direct paths and 04's void `apply`), `alert_id` stamped. *Plan addition PL-1* | Q-7 | `apps/hub/src/orders/line-change.ts` (+ contracts type) | `[05 row Q-7]`: unregistered → no change; a stub hook's drafts appended with `alert_id` inside an `apply`, `null` outside; `checkAlertIds` passes | P0.13 | HIGH |
| P0.14 | U2 | Q-3 line guard list with `{ order_item_id, units_after, comped_after, base_after_minor, money_changes }` from every caller; V-1 `VoidItems` and `void-preview` ask it after `ORDER_BILLED` | Q-3, V-1 | `apps/hub/src/orders/line-guard.ts`, `orders/commands/{remove-items,comp-line,set-line-weight}.ts`, `apps/hub/src/voids/commands/void-items.ts`, `apps/hub/src/voids/queries/void-preview.ts` | #32 (guard-list half; task 17 extends), #79 (line half); 04 results unchanged; statement counts unchanged +0 when unregistered | P0.2g, P0.2j | HIGH |
| P0.15 | U2 | V-2 `walk_out`; V-3 audit actions + subject types `bill`, `shift`; `registerRequestAction` | V-2, V-3 | `packages/domain/src/{voids,audit}.ts`, `apps/hub/src/audit/` (registry seam only) | duplicate kind throws; after-seal throws | P0.2j | NORMAL |
| P0.16 | U3 | P-1 bill routes (`bill_routes`, `SetBillRoute`, `BillRouteSet`, `billPrinterFor`, archive refused `CONFIG_IN_USE`) + `0022_bill_routes.sql` + Printers page "Bill printers" section | P-1 | `apps/hub/src/print/`, `apps/hub/src/db/migrations/0022_bill_routes.sql`, client admin printers, the four migration-list tests gain 0022 | #85 | P0.2i, P0.12 | NORMAL |
| P0.17 | U3 | P-2 `retargetDocumentJob` + `documentJobsStatus` (nothing prints twice; a job being sent → `409 PRINT_JOB_NOT_PENDING`); P-3 QR block (`GS ( k`); P-4 `renderText` → `@pos/domain/src/print-render.ts` | P-2, P-3, P-4 | `apps/hub/src/print/`, `packages/domain/src/{print,print-render}.ts` | #60 (retarget half; task 27 extends), #86 | P0.16 | HIGH (print retry) |
| P0.17b | U3 | **P-5 `registerDocumentFiller`**: `{ fill, ref, last4 }` filled at send, never written back to `print_jobs.payload`; unknown kind / missing row prints `last4`; filler error logged with `job_id` only. *Plan addition PL-1* | P-5 | `apps/hub/src/print/worker.ts`, `apps/hub/src/print/render/` | `[05 row P-5]`: payload after send has the block, not the filled text; `renderText` prints `last4`; error log has no text | P0.17 | HIGH (privacy) |
| P0.18 | U0 | H-3 fiscal worker boot hook after listen, beside the print worker, stop joined in `beat.stop` (stub `startFiscalWorker(deps)`; task 29 fills it) | H-3 | `apps/hub/src/lib/boot.ts`, `apps/hub/src/billing/fiscal/worker.ts` (stub) | boot starts / stops the stub after listen | P0.2b | HIGH (outbox) |

### 2.5 05 base (integrator, sequential, after P0.18) — spec tasks 1, 5, 6, 7 + fixtures (PL-4)

Shared files no lane may own; written once.

| # | Task | Spec | Files | Tests first | Tier |
|---|---|---|---|---|---|
| 1 | Shared types (§4.4 constants exactly; `MIXED_CLASS_RULES = ['higher_rate']`) | §4.4 | `packages/domain/src/billing/types.ts` | constants exact | NORMAL |
| 5 | Events (Zod `.strict()`, `schema_version` 1, builders, fixtures; no free text — `has_note` / `has_paid_to` / `has_reference`; `ZReportIssued.report` staff ids only) on streams `bill`, `shift`, `hub` | §6.29 | `packages/events/src/events/{bill,shift,hub}/` | every event: fixture parses; an extra field refused; no name / ID field exists | HIGH (privacy) |
| 6 | Migration `0023_billing.sql` (§5 tables; deletes the `audit` checkpoint → refold, V-3); the four migration-list tests gain 0023. **Runs the full hub suite once** | §5, V-3 | `apps/hub/src/db/migrations/0023_billing.sql`, `apps/hub/test/db/alerts-migration.int.test.ts` + the three rewind tests | schema test (tables, indexes, CHECKs); `audit` rebuild = live with old `BillRequested` events | HIGH |
| 7 | Projection `billing` (+ outbox rows written by the fold in the close transaction) and **`apps/hub/src/billing/index.ts`** (`registerBilling(app, deps)`, one line in `server.ts` / `lib/boot.ts`) | §5, §6.30 | `apps/hub/src/billing/projections/billing.ts`, `apps/hub/src/billing/index.ts` | **#88** (billing half; task 8 extends) | HIGH |
| P0.F | Fixtures `apps/hub/test/billing/fixtures.ts`: dine-in seating with two rounds, a deal ×2, an option child, a comped line, a pending-weight kg line, a return line, takeaway root + addition, parking plate on two days, a merged seating; jurisdictions `none`, `PK`, `PK-PB` and a test-only multi-tax / exponent-0 / exponent-3 jurisdiction; directories with Owner / Manager / Cashier / Order taker (B-2 defaults); a drawer device; sign-in and `answer` helpers over 01d | §10 | `apps/hub/test/billing/fixtures.ts` | fixtures self-test | NORMAL |
| **P0.S** | **Spike — GATE (PL-0, Q-P1).** `apps/hub/test/billing/spike.int.test.ts` with throwaway in-test pieces (a one-tax close over real events, real 0023 tables, the real `billing` fold, the P0.18 worker stub driven by hand): (a) jurisdiction `PK`: close one split → one transaction holds `InvoiceIssued` + `OrdersBilled` + `BillClosed`, the fold writes the invoice and a `fiscal_outbox` row `not_required`, a receipt job is queued at the bill printer, the receipt has no fiscal block; (b) a test jurisdiction with a throwaway fake adapter: the row is `pending`, the worker sends with `idempotency_key = invoice_ref`, `FiscalNumberAssigned` is appended, a reprint shows the fiscal number; (c) a forced COMMIT failure → no invoice, no outbox row, no job. **Any failure → STOP** and a §4.5 / spec row; no lane opens | §3.3, §3.15, §3.16, B12, B20, B21 | `apps/hub/test/billing/spike.int.test.ts` | `[05 spike]` a, b, c | HIGH |

**Phase 0 done** when every row above is merged, CI on `module-05` is green, and the spike is green. The board's acceptance map (§9) is seeded with every §10 test → task (§7).

---

## 3. Phase 05-1 — bills, payments, close, reopen, fiscal (spec §11: hub tasks 1–20, 24, 27–31a; 8 and 15 from 05-2 first)

"Needs" = PRs merged first (phase 0 assumed). Files under `…/` = `apps/hub/src/billing/`.

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| **M** money core | 2 | `computeSplit` / `computeBill`: tax lists per profile (simple / compound, ≤ 4), inclusive back-calculation, `apportionMinor` over `allocateCappedMinor`, whole-bill discount spread + R3 cap / `bill_discount_lines`, sticky service charge (inclusive on the pre-tax net), `higher_rate`, rounding adjustment (untaxed, in no class; `all` / `cash`; dues per §3.5 (7) incl. H16-1, H17-1, run-18 Q-1), the Pakistan regression fixture | §3.4–§3.6, B4–B9 | `packages/domain/src/billing/compute.ts` | #10–#16, #11b, #13b, #20, #20b | 1 | HIGH |
| **T** money tests (fresh session, did not write M) | 3 | Property tests for compute in both price modes against an independent model (sales, refunds per type "jitna liya utna wapas", no-change reopen sweep) | §3.5 (8) | `packages/domain/src/billing/compute.property.test.ts` | #10, #11c, #15, #15e, **#20c**, #23, #10b, #10c, #10d, #10e, #10f, #16b, #16c | 2 | HIGH |
| **K** kinds | 9 | The seven 05 kinds (§3.14) + `fiscal_outbox_stuck` (`managers`, `closes_on: 'owner'`, `expires_at_day_close: true`), holders right per kind; each kind's `apply` / `onWithdraw` calls an exported function in its command's file that throws `not built` until that task (seam, PL-5); `BILL_KINDS` | §3.14, D-1 | `…/kinds/` | #89 | P0.7, 5 | HIGH (approvals) |
| **S** shifts (05-2 slice built first) | 8 | Projection `shifts` (expected cash: tendered, change, outs, petty, advances; takings by mode) | §3.7, §3.11 | `…/projections/shifts.ts` | **#47**, #88 (shifts half) | 7 | HIGH |
| | 15 | `OpenShift` (float, drawer vs taken-by, one open shift per drawer), `shift` query (blind: no `expected_minor` before `ShiftCounted`) | §6.15, §6.16, B11, B23 | `…/commands/open-shift.ts`, `…/queries/shift.ts` | #45, #46 (open half; task 21 extends) | 8, 9 | HIGH |
| **B1** bill | 10 | Ensure-bill (`BillOpened` + `ChargeApplied { source: 'rule' }`, price mode and rounding rule frozen), `bill` query (projected = opened), `open-bills` | §6.1, §6.2, B1, B8 | `…/commands/ensure-bill.ts`, `…/queries/{bill,open-bills}.ts` | #1, #2, #3, #4, **#5b**, #91 | 2, 7 | HIGH |
| | 12 | `SetSplits` (items / amount / equal / none; re-basing on a later round; new lines join the highest open split) | §6.5, §3.8, B15 | `…/commands/set-splits.ts` | #7, #8, #9 | 10 | HIGH |
| | 13 | `ApplyDiscount` (approvable, `discount` kind apply), `RemoveDiscount`; `BILL_PARTLY_PAID` after the first close | §6.6, §6.7, B7 | `…/commands/discount.ts` | #16, #17 | 12, 9 | HIGH |
| | 14 | `RemoveServiceCharge` (approvable), `ApplyServiceCharge` | §6.8, B8 | `…/commands/service-charge.ts` | #18, #19 | 10, 9 | HIGH |
| | 20 | `RemoveComp` on an unbilled line (approvable) → 02b `LineCompRemoved`; asks the line guard | §6.14, B27 | `…/commands/remove-comp.ts` | #41 | 10, 9, P0.13, P0.14 | HIGH |
| **B2** pay & close | 16 | `AddPayment` (dues, `in` capped by its due field, cash step, `PAYMENT_EXCEEDS_BALANCE` while balance ≤ 0, references to `payment_references`, shift by drawer / taker, `SHIFT_NOT_OPEN`, `PAYMENT_MODE_NOT_FISCAL`), `RemovePayment` | §6.9, §6.10, B10, B11 | `…/commands/payments.ts` | #21, #22, #23, #24, #25, **#25b**, #48, #49 | 12, 15 | HIGH |
| | 17 | **`CloseSplit`** — one `BEGIN IMMEDIATE` transaction: §3.3 rules 1–9 in order, gap-free invoice number, `InvoiceIssued` + `closed_split_units`, at the last split `OrdersBilled` + `BillClosed` once, outbox row, `invoice_buyers` insert, receipt job (last 4 + filler block) | §6.12, §3.3, B12, B13, B15, B19–B21 | `…/commands/close-split.ts` | #5, #6, #26–#36 (#26, #27, #28, #29, #30, #31, #32 (extended), #33, #34, #35, #36), **#74b** | 16, 13, 14, 4, P0.16, P0.17b | HIGH |
| | 18 | `WaiveBuyerId` (approvable) + buyer redaction everywhere (events, logs, alerts, audit, Z, hash, responses, print payload) | §6.11, B19, H-4, P-5 | `…/commands/waive-buyer-id.ts` | #42, **#42b**, #43 (CNIC and NTN) | 17, 9, P0.4b | HIGH (privacy) |
| | 19 | **`ReopenBill`** + kind `apply`: `BillReopened`, `InvoiceCredited` per sale invoice (credit series, outbox behind its original), `OrdersUnbilled`, `SeatingReopened` for a full-edit dine-in reopen, corrections-only rules, `BillClosedEmpty` via the Q-7 hook, `BILL_REOPEN_NOT_SUPPORTED` | §6.13, §3.10, B14 | `…/commands/reopen-bill.ts` (+ its order-cancelled hook registration) | #37, #38, #39, #40, **#39b**, #44, **#44a, #44b, #44c, #44d, #44e, #44f, #44g, #44h, #44i, #44j, #44k, #44l** | 17, 9, P0.11, P0.13, P0.13b | HIGH |
| | 24 | 05's merge guard (`BILL_HAS_PAYMENTS` on merge and seating split) and line guard (`LINE_IN_CLOSED_SPLIT`, 1 statement) | §3.9, B15, T-1, Q-3 | `…/lanes/guards.ts` | #32 (extended), #56, #57 | 17, P0.11, P0.14 | HIGH (races) |
| **P** print docs | 4 | Pure `Doc` builders: check bill (PROVISIONAL banner, rounded cash total), receipt (registrations, fiscal block per `receipt_fiscal`, `{ fill: 'buyer_id', ref, last4 }`), credit note (last 4), report doc (names from `staff_names` at render) | §3.16, B17, B29 | `packages/domain/src/billing/docs.ts` | #34 (doc half; task 17 extends), #59, #61 | 1, 2, P0.17 | NORMAL |
| | 11 | `PrintCheckBill` + live-only `BillRequested` fold → bill printer of the zone / floor | §6.3, §6.4, B17 | `…/commands/print-check-bill.ts`, `…/print/folds.ts` | #58, #59 (extended) | 4, 10, P0.16 | NORMAL |
| | 27 | `PrintBillDocument` (receipt / credit note reprint rebuilds the full ID from `invoice_buyers` only for that customer's receipt), `RetargetBillPrint` | §6.22, §6.23, B18 | `…/commands/print-docs.ts` | #60, #61 (extended) | 17, P0.17, P0.17b | HIGH (print retry, privacy) |
| **F** fiscal | 28 | Port contract (`FiscalAdapter`, capabilities, neutral submission / answer, `registerFiscalAdapter`), `none` adapter, registry, test fake adapter | §3.15, B20 | `…/fiscal/{port,none}.ts`, `apps/hub/test/billing/fiscal/fake-adapter.ts` | #69, #74, #78, **#78b** | 5, 7 | HIGH |
| | 29 | Fiscal worker: order per `pos_id` (`strict_per_pos_id`), credits behind originals, back-off, crash resend with the same key, health ≤ every 60 s, credentials read at send, `token_missing` | §3.15, B20, B21 | `…/fiscal/worker.ts` (replaces the P0.18 stub) | #70, #71, #72 | 28, P0.18, 17 | HIGH |
| | 31 | Stuck alert (dedupe, re-raise after day close), `fiscal-status`, `RetryFiscalNow` | §6.27, §6.28 | `…/fiscal/status.ts` | #73, #77 (captured logger) | 29, 9 | HIGH |
| | 31a | `SetFiscalToken` (admin, `manage-fiscal-settings`, write-only, `fiscal_credentials`, `FiscalTokenSet` ids only, `hashOmit: ['token']`) + the `/admin/fiscal/` page body (one write-only field per `pos_id` × credential name) | §6.28a, B22, H-2 | `…/fiscal/credentials.ts`, `apps/client/src/features/admin/fiscal/` | #81 | 28, P0.4b, P0.5 | HIGH (secrets) |
| **PRA** (gated) | 30 | PRA adapter per Appendix P (USIN, `InvoiceType` 1 / 3 + `RefUSIN`, totals with rounding only in `TotalBillAmount` until A14, items one per line + service charge item, `PaymentMode` from `authority_codes` incl. 5 mixed, buyer fields, answer mapping, `multi_tax_unsupported`, `mode_unmapped`) + recorded fixtures. **STOP until A13 and A14 are answered and PRA's "Technical Specification Software Fiscal Device v1.2" is in the repo** (owner tasks O1, O2); any field the document leaves unclear is a STOP to the owner, never a guess. No network in the gate; sandbox = manual check M2 | Appendix P, §P.5 | `…/fiscal/pra.ts`, `apps/hub/test/billing/fiscal/fixtures/` | **P-T1**, **P-T2**, #75, #76; #69–#78b re-run against this adapter | 29, O1, O2 | HIGH |
| **A** audit | 32a | Audit maps of 05-1's events through `registerAuditAction` + the seven request actions (`registerRequestAction`); no buyer data in `detail_json` (PL-3, H6-14: ships with 0023's checkpoint delete) | §6.30, V-3 | `…/audit-map.ts` (05-1 entries) | #87 (05-1 events) | 6, P0.15 | NORMAL |

**05-1 hub: 6 base (1, 5, 6, 7, P0.F, P0.S) + 24 lane tasks = 30.**

### 3.1 05-1 client (staff entry, ui-kit, R5) — BLOCKED on `docs/design/handoff/05/` (except 43a)

| Lane | Task | What | Files | Spec / tests | Needs | Tier |
|---|---|---|---|---|---|---|
| **C1** | 34 | Cashier open-bills list (check-bill-printed status, open-bill flag) | `apps/client/src/features/billing/` | §8; client tests | 10, handoff | NORMAL |
| | 35 | Bill screen + **payment pad** + tendered / change, dues per type, refund dues, `expected_total_minor`; retry keeps the same `command_id` (handbook §10) | same | §8; #22 / #23 client halves | 16, 17, handoff | **HIGH** (money; re-tiered from "screens", handbook §4) |
| | 36 | Split editor | same | §8 | 12, handoff | NORMAL |
| | 37 | Discount / service charge / buyer sheets (buyer ID never stored in IndexedDB or logs; cleared after send) | same | §8, B19 | 13, 14, 18, handoff | NORMAL (privacy check by the reviewer) |
| | 38 | Print status + Print to | same | §8, B18 | 27, handoff | NORMAL |
| | 43a | i18n keys EN / UR for every §9 code and kind label of 05-1 (not blocked) | `apps/client/src/i18n/` | §9, §8 | 5, 9 | NORMAL |

---

## 4. Phase 05-2 — shifts, petty cash, drawer, day close, X / Z (spec §11: 21–23, 25, 26, 32, 33)

Opens when 05-1's hub tasks are merged and CI on `module-05` is green (05-1 checkpoint on the board).

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| **S** shifts | 21 | `CountShift` (counts **and closes**, frees the drawer; variance above threshold raises `shift_variance` sign-off), `CloseShift { skip_count }` (`skip-blind-count`, audited), `HandoverCount` | §6.17–§6.19, B23 | `…/commands/shift-close.ts` | #46 (extended), #50, #51, #52, **#50b**, **#50c**, #53b (extended) | 15, 9 | HIGH |
| | 22 | `RecordPettyCash` (advance / out / in, limit or `requires_approval` → `petty_cash` request), `SettlePettyAdvance` | §6.20, B24 | `…/commands/petty-cash.ts` | #53, #54, #53b (extended) | 15, 9 | HIGH |
| | 23 | `OpenCashDrawer` (no-sale, reason, audited; drawer kick job) | §6.21 | `…/commands/open-cash-drawer.ts` | #55 | 15, P0.16 | HIGH |
| **Z** day close + reports | 26a | Pure `buildReport` (Z = Σ sale − Σ credit; tax by tax code, profile, class; rounding its own line; voids by disposition; shifts float / expected / counted / variance / sign-off; brought / carried forward by mode). *PL-2: before 25, whose appender calls it (§6.25)* | §6.26, B26 | `packages/domain/src/billing/report.ts` | **#66**, #67 | 8, 17, 19, 21, 22 | HIGH |
| | 25 | Day-close guard (open shifts, unbilled / uncancelled / not carried orders), appender (`AlertClosed obsolete` for 05 + 02b `comp` requests, Z number, `ZReportIssued`), `CarryOverOrders`; ≤ 10 added statements | §6.24, §6.25, B25 | `…/lanes/day-close.ts`, `…/commands/carry-over.ts` | #62, #63, #64, #65 | 26a, P0.6, P0.13 | HIGH |
| | 26b | X / Z queries (X ≤ 8 statements, Z list 1 with cursor), `ZReportIssued` live-only print fold at the `report` route | §6.26 | `…/queries/reports.ts`, `…/print/folds.ts` (Z entry) | **#63b**, **#63c**, **#64b**, #67 (extended) | 25 | HIGH |
| **A** audit + wiring | 32b | Audit maps of 05-2's events only (no second refold: no history before 05-2) | §6.30, H6-14 | `…/audit-map.ts` (05-2 entries) | #87 (extended to every 05 event) | 21–23, 25 | NORMAL |
| | 33 | Startup wiring check: every 05 event type has a registered audience and audit map; `take-order`-only socket gets no `PaymentAdded`; a cashier's socket gets no other person's `ShiftCounted` | §6.30, H16-6 | `apps/hub/src/billing/index.ts` (audience table), registration test | **#91b** | 32b | HIGH (blind count, money visibility) |

**05-2 hub: 8 lane tasks** (spec task 26 split into 26a / 26b, task 32 into 32a / 32b — PL-2, PL-3).

### 4.1 05-2 client — BLOCKED on `docs/design/handoff/05/` (except 43b)

| Lane | Task | What | Needs | Tier |
|---|---|---|---|---|
| **C2** | 39 | Shift open / count (blind: no expected shown before the count) / close / handover | 21, handoff | NORMAL |
| | 40 | Petty cash | 22, handoff | NORMAL |
| | 41 | Day close + carry-over (blocked list with `Message.items`) | 25, handoff | NORMAL |
| | 42 | X / Z + fiscal status line | 26b, 31, handoff | NORMAL |
| | 43b | i18n EN / UR for 05-2's codes and kind labels | 5 | NORMAL |

Ask the designer now for: open-bills list, bill screen + payment pad, split editor, discount / service-charge / buyer sheets, print status + Print to, shift screens, petty cash, day close + carry-over, X / Z (owner task O9).

---

## 5. Close-out (integrator + owner)

| # | Task | Needs | Who |
|---|---|---|---|
| 44 | E2E flows (webapp-testing, never CI): dine-in split + mixed payment; takeaway before food; reopen; day close with carry-over → `docs/reviews/05-e2e.md` | C1, C2 | integrator machine |
| 45 | `test:perf` row: 200-bill rush close (written and typechecked in the gate, **run only by the owner**, M1) | 17 | owner |
| 46 | Manual checks `docs/plans/05-manual-checks.md` (written by Z2 from §8) | Z2 | owner |
| Z1 | Acceptance map on the board: every story AC, §12.2 row and §10 test → green test name; §12.7 gaps listed "not built"; cleanup entries fixed or listed | all hub tasks | integrator |
| Z2 | Write `docs/plans/05-manual-checks.md` from §8 | Z1 | integrator (Sonnet) |
| Z3 | Sync `main` into `module-05` (handbook §7.2) if `main` moved; release branch `merge/05-to-main` (§7.1, both checks); PR into `main` with green CI; **owner merges**; then the full gate on a clean `origin/main` worktree (§12) and any `fix/…` PR | Z1 | integrator, owner |
| Z4 | README row 05 Status → IMPLEMENTED on `main` with PRs, board, e2e doc (handbook §13) | Z3 | integrator |

---

## 6. Lane launch schedule (≤ 4 agents at once)

| Step | Open | When |
|---|---|---|
| 0 | P0.B, P0.1, P0.G, P0.2a–k (one Sonnet implementer + one Sonnet reviewer at a time) | G0.1–G0.3 hold |
| 1 | U0 and U2 (HIGH-heavy: one implementer each, reviews take the other two slots), then U1 and U3 as slots free | each row's P0.2 bump merged |
| 2 | 05 base 1 → 5 → 6 → 7 → P0.F → **P0.S** (integrator + reviewers) | P0.18 merged |
| 3 | M (2), K (9), S (8), F (28) | spike green |
| 4 | T (3), B1 (10 → 12 → 13 → 14 → 20), S (15), P (4) | 2 merged (T, B1, P); 8 merged (15) |
| 5 | B2 (16 → 17 → 18 → 19 → 24), F (29 → 31 → 31a), P (11, 27), A (32a), C1 43a | 12 + 15 (16); 17 (18, 19, 24, 27, 29) |
| 6 | PRA (30) | A13 + A14 answered, PRA spec v1.2 in the repo (O1, O2); 29 merged |
| 7 | 05-1 checkpoint → S (21, 22, 23), Z (26a → 25 → 26b), A (32b → 33) | 05-1 hub merged, CI green |
| 8 | C1 / C2 screens | `docs/design/handoff/05/` exists |
| 9 | Close-out | all of the above |

Critical path: G0 → P0.1 → P0.2 → P0.11 / P0.12 / P0.13 / P0.14 → base 6 / 7 → P0.S → 2 → 10 → 12 → 13 → 16 → 17 → 19 → 26a → 25 → 26b → Z1 → Z3. Fiscal (28 → 29 → 31) and PRA run beside it.

**Batches:** each lane works in batches of about 5 tasks (B1, B2 are exactly 5); after a batch the integrator updates the board and runs a checkpoint: §12.2 rows of the batch, statement counts, the acceptance-map rows turning green.

---

## 7. Test coverage — closing check (spec §11, H18-2; repeated here before the first build batch)

Every §10 test is in at least one task; a test listed in several is **written in the first** and extended later; ranges cover only unlettered numbers, lettered tests are named.

- **Unlettered 1–91:** 1–4 → 10; 5, 6 → 17; 7–9 → 12; 10–16 → 2 (10, 11, 15 also 3; 16 also 13); 17 → 13; 18, 19 → 14; 20 → 2; 21–25 → 16 (23 first in 3); 26–36 → 17 (32 first in P0.14, 34 first in 4); 37–40 → 19; 41 → 20; 42, 43 → 18; 44 → 19; 45, 46 → 15 (46 extended in 21); 47 → 8; 48, 49 → 16; 50–52 → 21; 53, 54 → 22; 55 → 23; 56, 57 → 24; 58, 59 → 11 (59 first in 4); 60 → P0.17, 27; 61 → 4, 27; 62–65 → 25; 66, 67 → 26a (67 extended in 26b); 68 → P0.6; 69 → 28; 70–72 → 29; 73 → 31; 74 → 28; 75, 76 → 30; 77 → 31; 78 → 28; 79 → P0.6, P0.11, P0.14; 80 → P0.4; 81 → 31a; 82 → P0.12; 83, 84 → P0.13; 85 → P0.16; 86 → P0.17; 87 → 32a, 32b; 88 → 7, 8; 89 → 9; 90 → P0.8; 91 → 10 (every query task asserts its own count).
- **Lettered:** 5b → 10; 10b, 10c, 10d, 10e, 10f → 3; 11b → 2; 11c → 3; 13b → 2; 14b → P0.9; 14c → P0.3, P0.9; 15e → 3; 16b, 16c → 3; 20b → 2; 20c → 3; 25b → 16; 37b, 37c, 37d, 37e, 37f, 37g, 37h → P0.11; 39b → 19; 42b → 18; 44a, 44b, 44c, 44d, 44e, 44f, 44g, 44h, 44i, 44j, 44k, 44l → 19; 50b, 50c → 21; 53b → P0.7; 63b, 63c, 64b → 26b; 74b → 17; 78b → 28; 83b → P0.13; 91b → 33; P-T1, P-T2 → 30.
- **#15b** is struck in v0.8.1 (§26, `pro_rata` removed) — no test (PL-6).
- Row-level tests the plan adds for rows §11 does not list: `[05 row H-4]` (P0.4b), `[05 row Q-7]` (P0.13b), `[05 row P-5]` (P0.17b); plus `[05 spike]` (P0.S).

**Result: no §10 test is in no task.** Z1 re-runs this check against the green test names.

---

## 8. Manual checks and owner tasks (never in the cloud or CI)

### 8.1 Manual checks — owner machine / pilot hardware (→ `docs/plans/05-manual-checks.md`, Z2)

| # | Check | Where | Spec |
|---|---|---|---|
| M1 | `pnpm test:perf` 05 row: 200-bill rush close on the pilot box — real disk, alone on a quiet machine, never `TMPDIR=/dev/shm` | pilot hub | §11 #45, CLAUDE.md |
| M2 | **PRA sandbox run** with the owner's sandbox token (entered on `/admin/fiscal/`, `environment: 'sandbox'`): sale cash, card, mixed; credit; buyer above Rs 50,000; one forced timeout → retry; fiscal number and QR on the reprint | pilot hub, branch internet | §11 #46, G1-12, Appendix P |
| M3 | Receipt QR scan on each printer model (80 mm / 58 mm), size and placement (A3) | pilot printers | §11 #46, P-3 |
| M4 | Drawer kick on the kiosk printer (`OpenCashDrawer`, cash close) | cashier kiosk | §11 #46, §6.21 |
| M5 | Full buyer ID printed only on that customer's receipt and its reprints; credit note and check bill show the last 4 | pilot printer | B19, P-5 |
| M6 | 01d rows 1b, 4, sounds and the request screens with a `discount` and a `shift_variance` request on two tablets (as 04 Z2) | tablets | §3.14 |
| M7 | *(recommended, CLAUDE.md test-environment rule; not a §11 task)* power-loss during a close burst: after restart every committed invoice has its outbox row and no number gap | pilot hub | B13, B20 |
| M8 | Go-live checklist §8.2 signed off | owner | G1-16 |

### 8.2 Owner tasks — authority and pilot go-live (G1-16, §4.3 "Pilot checklist")

| # | Owner task | Unblocks |
|---|---|---|
| **O1** | **Authority email** to PRA (`eims@pra.punjab.gov.pk`, G1 §5) with **A1–A14** (A11 never assigned; spec §12.7 (b) lists each with the default built). **A13** (`PaymentMode` codes for wallet / QR / online; rounding and service charge as items or bill fields) and **A14** (rounding adjustment field vs inside `TotalBillAmount`) block task 30. Answers change data or the adapter, never the core | 30 |
| **O2** | Put PRA's "Technical Specification Software Fiscal Device v1.2" (or its field list) in the repo under `docs/stories/` | 30 |
| O3 | Register the POS ID(s) for the POS floor with PRA (A1 decides one per hub or per device) | go-live |
| O4 | Sandbox token → `/admin/fiscal/` on the pilot hub (never in the repo, chat, spec or cloud) and run M2 | M2 |
| O5 | Production token → `/admin/fiscal/` on the pilot hub, `environment: 'production'` | go-live |
| O6 | Owner's / accountant's written OK that only the POS floor reports to PRA while the rest stays on Mutfak (R20) | go-live |
| O7 | **Go-live decision:** O3–O6 and M2 done → branch jurisdiction `PK-PB`; any missing → the branch starts on **`PK`** and switches later by the billing setting (audited `config_audit`, `switched_at`), no code change | go-live |
| O8 | 01c data entry note (M-2): leave `is_default` off unless truly default | go-live |
| O9 | Design handoff `docs/design/handoff/05/` for the screens in §4.1 | C1, C2 |

---

## 9. Status board skeleton (P0.B copies it to `docs/plans/05-status.md`; only the integrator edits it)

```markdown
# 05 Billing — build board

Plan: `05-plan.md`. Gaps: `05-gaps.md`. Spec: `05_Billing_Spec_v1.0.1.md` (after P0.1). Integration branch: `module-05`. Cleanup: `05-cleanup.md`.

> **Status (owner summary, Hinglish, newest first):**
> - <date>: …

## Gate before phase 0
| Check | State |  (G0.1 spec-05 on main · G0.2 module-deeplinks on main · G0.3 claims scan with the numbers found)

## Owner rulings on how the build runs
W-1…W-6 as `04-status.md`, for `module-05`; W-4: ≤ 4 agents at once; W-6: HIGH = 2 fresh Opus reviewers, money MINORs fixed before merge.

## Owner rulings on the spec during the build
| # | Ruling | When | Where it landed |

## Phase 0
| Task | Lane | Tier | Needs | PR | State |   (P0.B, P0.1, P0.G, P0.2a–k, P0.3 … P0.18 incl. P0.4b / P0.13b / P0.17b, 1, 5, 6, 7, P0.F, P0.S)

## 05-1 lanes
| Lane | Task | Tier | Needs | PR | Reviewers (R1 / R2 verdict) | State |

## 05-2 lanes
| Lane | Task | Tier | Needs | PR | Reviewers | State |

## Client
| Lane | Task | Tier | Blocked on | PR | State |

## Owner tasks and manual checks
| # | Task | State |   (O1–O9, M1–M8)

## STOPs / needs-ruling
| # | Task | Finding | Options + Rec | State |   (PRA task 30 starts here as "waiting A13 / A14 / PRA spec v1.2")

## Readings (AD rows; IR-n numbers continue from the last board, handbook §11)
| AD | Reading | Status (proposed / ruled) |   (PL-0 … PL-9 seeded from the plan)

## Acceptance map (Z1)
| §10 test | Task | Test name | State |
```

---

## 10. Plan readings (PL — copied to the board as AD rows, status `proposed` until the owner confirms)

| # | Reading | Why |
|---|---|---|
| PL-0 | Spike P0.S is a plan gate though spec and handbook name none | owner requirement "spike first if called for"; 04 G1-8 precedent; Q-P1 |
| PL-1 | §4.5 rows **H-4, Q-7, P-5** have code but no §11 phase-0 task → P0.4b, P0.13b, P0.17b, HIGH, before the tasks that use them (18, 19, 27) | DoD §12.1 (1): every §4.5 row applied with its test |
| PL-2 | Spec task 26 is split: **26a** `buildReport` before task 25 (whose appender calls it, §6.25), **26b** queries + print fold after 25 (its tests #63b, #63c, #64b need `CarryOverOrders`) | dependency inside §11; no behaviour change |
| PL-3 | Spec task 32 split into **32a** (05-1 maps, with 0023) and **32b** (05-2 maps) | spec §11 H6-14 says so |
| PL-4 | Spec tasks 1, 5, 6, 7 and the fixtures are integrator work in phase 0 (shared files) | 03b / 04 "phase 0 writes every shared file once" |
| PL-5 | Kinds (task 9) call an exported `apply` of each command's file, `not built` until that task | 04 P0.7 seam pattern; one owner per file |
| PL-6 | #15b is struck (v0.8.1 §26) and has no test | spec text |
| PL-7 | Letter ranges in §11 (#37b–#37f, #44a–#44l) are expanded to named tests | H18-2 "lettered tests are always named" |
| PL-8 | "≤ 4 agents" counts implementers + reviewers; the integrator is not counted | owner usage rule; correct on the board if meant otherwise |
| PL-9 | 01d v1.3.1 / v1.3.2 already exist on `module-deeplinks`; P0.1 re-takes 01d (and any number `main` moved) without a STOP | H5-1, G1 §13 |
| PL-10 | Task 35 (payment pad) is HIGH, not NORMAL "screens" | handbook §4: tier from what the diff can break (money, queue retry) |
| PL-11 | Phase-0 merge order follows §11 P0.3–P0.18 except P0.7 before P0.5 / P0.6 and P0.17 before P0.10 | P0.5 / P0.6 need B-1's `manage-fiscal-settings` / `close-business-day`; P0.10 needs `renderText` in `@pos/domain` |
| PL-12 | Settings / admin UI in phase 0 (P0.5 shell, P0.6 Stock text, P0.10 Billing page, P0.16 Bill printers section, 31a fiscal page) is built on the existing admin / owner page patterns without a 05 design handoff; staff screens 34–42 wait for it | Q-P2 |

## 10a. Open questions for the owner (plan level; the spec needs none)

| # | Question | Options | Rec |
|---|---|---|---|
| Q-P1 | Keep the spike P0.S as a gate before any lane? | (a) keep (one HIGH task, ~1 session); (b) drop, lanes open after base task 7 | **(a)** — 0023's money tables and the close transaction cannot be edited after merge; a failing spike is a cheap STOP |
| Q-P2 | Settings / admin UI without a 05 design handoff (PL-12)? | (a) build on existing admin / owner patterns now; (b) block them on `docs/design/handoff/05/` too | **(a)** — they are forms on known patterns; the go-live needs the fiscal page and the Billing page before the staff screens |
| Q-P3 | Release 05-1 to `main` on its own? | (a) no — one `merge/05-to-main` after 05-2 (04 pattern); (b) a release after 05-1 | **(a)** — the pilot needs shifts, Z and day close to go live; one release, one main-side gate |

## 11. Definition of Done (per lane, on top of spec §12.1)

Every lane task is done when: (1) the failing-first test output is in the PR body; (2) its §10 / row tests pass in CI on `module-05`; (3) every command it adds has happy path, one test per error code, retransmit with the same `command_id`, every grant state; every query its fixed statement count at 1 and 40; (4) its reviewers' BLOCKER / MAJOR are closed (mutation-verified) and, for money, every MINOR is fixed; other MINORs are in `05-cleanup.md`; (5) no buyer ID, token, PIN, name, phone or free text in a log, event, hash or response (captured-logger tests where the task logs); (6) it registered only its own lines in `billing/index.ts`; (7) the board row says `merged` with the commit.

- **Phase 0:** every §4.5 row applied with marker, version and test; README R37 / R38 / row 05; spike green.
- **05-1:** rebuild of `billing`, `shifts` (open slice), `audit` from seq 0 equals live (#88, #87); a bill can be opened, split, discounted, paid, closed, reopened and credited under `PK` and the fake adapter; the outbox drains with the fake adapter; PRA either merged (A13 / A14 answered) or on the board as a STOP with the branch planned on `PK`.
- **05-2:** day close refuses open shifts and unbilled orders, carries listed orders, issues the Z in the close transaction; Z identity property green (#66); every 05 event has an audience and an audit map (#91b, #87).
- **Module:** spec §12.1 1–6, handbook §13 close checklist, manual checks M1–M8 done on the pilot hardware or the branch on `PK`.

## 12. Self-review (writer, 2026-11-18)

- **Coverage:** §11 P0.1–P0.18 → P0.1, P0.2a–k, P0.3–P0.18; hub 1–33 + 31a → base (1, 5, 6, 7), M (2), T (3), P (4, 11, 27), S (8, 15, 21–23), K (9), B1 (10, 12–14, 20), B2 (16–19, 24), Z (25, 26a / 26b), F (28, 29, 31, 31a), PRA (30), A (32a / 32b, 33); client 34–43 → C1, C2; close-out 44–46 → §5. §7 shows every §10 test in a task.
- **No shared file in two lanes:** types, events, 0023, the `billing` projection, `index.ts` creation, fixtures are phase 0; `kinds/` is K only; `compute.ts` is M only; `docs.ts` is P only; `index.ts` lines are append-only per task.
- **HIGH everywhere money, close, outbox, shifts, day close, adapter, reopen / tables, buyer privacy, approvals and print retry move;** NORMAL only for settings shapes, seeds, docs builders, audit maps, text and screens (bar the pad).
- **Known gaps** (§12.7, §12.4, §1.3, `pro_rata`) excluded by a global rule.
