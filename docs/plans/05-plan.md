# 05 Billing — Implementation Plan (spec v1.0)

> **For agentic workers:** every task is TDD (failing test first, record the failure, then implement). One task = one branch = one PR into `module-05` = one commit after review (NORMAL tasks may share a PR, 2–3 consecutive small ones, one commit each, owner Q-41; HIGH tasks always have their own PR). Lanes run in **claude.ai/code cloud sessions**, the gate runs in **GitHub Actions** (`.github/workflows/gate.yml`). Process, tiers, reviewer rules, branch and sync recipes: `docs/plans/integrator-handbook.md` (followed exactly; it wins over nothing but the spec and CLAUDE.md). Board: `docs/plans/05-status.md` (created in P0.B from the skeleton in §9 below). Copy-paste prompts for the phase-0a lanes and the integrator: **`docs/plans/05-parallel-prompts.md`**. Same working model as `docs/plans/04-plan.md`.

**Goal:** build 05 v1.0 on the hub — bills, splits, discount, sticky service charge, tax from jurisdiction data, rounding adjustment, payments and change, close per split → invoice, reopen + credit, remove comp, buyer tax ID with its privacy rules, shifts / blind count / handover / petty cash / drawer, day-close guard + appender + carry-over, X / Z, the fiscal port, the `none` adapter, the fiscal outbox and worker, the PRA adapter (gated) — plus every §4.5 row in the other specs, then the clients once the design handoff exists.

**Spec:** `docs/specs/05_Billing_Spec_v1.0.md` (APPROVED 2026-11-18 16:33 PKT). Rulings: `docs/stories/05-g1-decisions.md` §1–§29 (§13: version numbers re-taken in phase 0b after `module-deeplinks` reaches `main`). Known gaps: spec §12.7 — do **not** build them (pro rata, per-rate rounding, other adapters, cross-tenant view, client formatters outside 05, weighed-line step, everything in §12.4). Reviews: `docs/reviews/05_*` (runs 1–18; §12.7 (f) lists what runs 16–18 did **not** model — those areas get the extra reviewer focus named in the lane tables).

**Starting point — two tracks (owner, 2026-11-18 16:48–16:55 PKT, §0):**
- **Phase 0a (start-now track)** starts as soon as `spec-05` (PR #219: spec, G0 / G1, this plan) is on `main` and the integrator has cut `module-05` from that `main` (P0.B). It holds **only 05's own work**: new files under 05's own paths, no edit to another module's spec or code, no version number taken.
- **Phase 0b** starts when `module-deeplinks` (and any other branch that claims a spec 05 bumps) is on `main`. It holds every §4.5 bump that touches another module's spec or code, the version-number re-take (P0.1), the gap sweep, the 05 base that needs those bumps, and the second half of the spike. **On 2026-11-18 `module-deeplinks` is not on `main`**: `module-deeplinks` @ `e38c45d` has open lane PRs (#254, #263 into it, #262 stacked; scanned 2026-11-18) and already holds 01d **v1.3.1 and v1.3.2**, 02a v1.1.7, 02b v1.0.15, 03a v1.2.5, 04 v1.0.6 — so 05's provisional 01d v1.3.1 is already taken and P0.1 renumbers it (no STOP, H5-1). ~~Cloud `0014` / `0015` are claimed by `lane-HD/h10` (PR #126 into `module-02-hub-gaps`); 05's provisional cloud `0016` / `0017` already skip them.~~ ⚠️ P0.G (G-13, R-6): the claims were phantom (`module-02-hub-gaps` is 0 ahead and 278 behind `main`; `main` ends at cloud 0013), so **05's cloud migrations take `0014` / `0015`** (were 0016 / 0017). PRs #121 / #126 renumber when they land.

**What is different from 04's plan (and why):**

| 04 did | 05 does | Why |
|---|---|---|
| One build phase | **Two plan phases in one spec: 05-1 then 05-2** (owner OQ-2 (b), README R38; spec §11 "Plan phases"); **one release** to `main` after 05-2 (Q-P3 (a)) | 65 tasks; every payment needs a money shift, the Z needs both halves |
| Phase 0 waited for every upstream branch | **Phase 0 split into 0a (05's own code, starts now) and 0b (bumps of other specs, after `module-deeplinks`)** | Owner 2026-11-18: independent work starts today; bumps wait to avoid version and file conflicts |
| Spike = spec task 1 | **Spike is a plan gate in two halves** (Q-P1 (a)): **P0.Sa** in 0a (money core + outbox + `none` / fake adapter + receipt `Doc`, no real close) and **P0.Sb** in 0b (the close over real events and 0023, end to end). No command lane opens until P0.Sb is green | 05 is the first module whose close writes money, an external outbox row and a print job in one transaction, on tables (0023) that cannot be edited after merge |
| Upstream rows as lanes U1–U4 | **Upstream rows are phase 0b** (spec §11 P0.1–P0.18), merged **in the spec's order**, each its own PR; implementation may run ahead in module lanes (U0–U3) | Owner: bumps in spec order |
| Money tests lane T1 | **Task 3 split**: 3a (pure property tests, 0a) by a fresh implementer who did not write task 2; 3b (command-level halves) in lane T after task 24 | Same credibility rule |
| One fiscal path (none) | **Fiscal lanes F and PRA**; PRA's full adapter is **gated on A13 + A14** and PRA's spec v1.2 (Appendix P §P.5); a mapping skeleton (30a) runs in 0a with every unsettled field a TODO + STOP | Authority answers change the adapter, never the core |

---

## 0. Decision log

| # | When | Who | Decision | Where it landed |
|---|---|---|---|---|
| D-1 | 2026-11-18 16:33 PKT | owner | Spec 05 v1.0 approved (G1 §29) | spec, README row 05 |
| D-2 (Q-P1) | 2026-11-18 16:48–16:55 PKT | owner | **Keep the spike gate** — (a). Now in two halves: P0.Sa (0a) and P0.Sb (0b) | §2A.4, §2B.6, PL-0, PL-19 |
| D-3 (Q-P2) | 2026-11-18 16:48–16:55 PKT | owner | **Settings / admin pages on existing page patterns without a 05 design handoff** — (a) | PL-12; tasks P0.5, P0.6, P0.10, P0.16, 31a |
| D-4 (Q-P3) | 2026-11-18 16:48–16:55 PKT | owner | **One release** `merge/05-to-main` after 05-2 (all Recs) — (a) | §5 Z3 |
| D-5 | 2026-11-18 16:48–16:55 PKT | owner | **Start-now track:** phase 0 split into **0a** (05's own work; starts when #219 is on `main` and `module-05` is cut) and **0b** (every §4.5 bump that touches another module's spec or code, plus the version-number re-take; waits until `module-deeplinks` is on `main`) | §2A, §2B |
| D-6 | 2026-11-18 16:48–16:55 PKT | owner | 0a lanes: **L-MONEY** (HIGH, Opus), **L-FISCAL** (HIGH, Opus), **L-PRINT+SETTINGS** (NORMAL, Sonnet), **L-PRA-SKELETON** (HIGH, Opus, optional; A13 / A14 / PRA v1.2 items stay TODO + STOP). Anything needing a bump (02b `tax_profile_id`, 02a `SeatingReopened`, 01d kinds, 03c QR / override, 04 guards, 01a settings wire) waits for 0b; the close transaction, reopen and day-close wiring come after 0b | §2A.2, §2A.3 |
| D-7 | 2026-11-18 16:48–16:55 PKT | owner | **More than 4 agents in parallel for now** (usage budget available); each lane keeps to its own files; file ownership stated per lane | §1 "Usage economy", §2A.3, board W-4 |
| D-8 | 2026-11-18 16:48–16:55 PKT | owner | Branches: `module-05` from `main`; lane branches per handbook naming (`lane-05M/…`); PRs into `module-05`; gate green before merge | §1 "Branches" |

Readings the plan writer took to apply D-5 – D-8 (each `proposed` on the board until the owner confirms): PL-13 – PL-20 in §10.

---

## 1. Global rules (every task)

- **Branches:** integration branch `module-05` (both phases). Task branch **`lane-05<L>/05-<task>`** (e.g. `lane-05M/05-2`, `lane-05F/05-28a`, `lane-05B2/05-17`, `lane-05P0/05-p0.11`; integrator tasks `lane-05I/05-<task>`; PL-20). Base = `origin/module-05`, or the lane's previous **unmerged** task branch (stacked; PR body says `Stacked on #<n>`). After a lower PR merges: `git rebase --onto origin/module-05 <old-base> <branch>` and `git push --force-with-lease` — **only on your own task branches**. Worktree per lane (handbook §3); shallow clone → explicit refspecs; **never `git stash`**; never push `main` or `module-05` directly.
- **PR (REST only, `gh api`):** title `<task>: <title> [05 §x]` (bump rows: `[05 §4.5 <row>]`); body: spec sections, tests added with their failing-first output line, statement counts asserted, Readings, `Needs: #…`, tier, review verdicts; ends with "🤖 Generated with [Claude Code](https://claude.com/claude-code)". Labels `lane:05-<L>` and `tier:HIGH` / `tier:NORMAL`. Rebase-merge only, by the integrator, with CI green.
- **Commit:** one per task after review: `feat(05): <title> [05 §x; §11 task N]`; bump-row code: `feat(<module>): <title> [05 §4.5 <row>]`; spec bumps: `docs(<module>): v<x> — 05 rows <…> [05 §4.5]`. Author `Arslan Ahmed Arif <arsiiahmi@gmail.com>` (`git -c user.name="Arslan Ahmed Arif" -c user.email=arsiiahmi@gmail.com commit`); trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Review fixes squashed in before the PR opens.
- **Tiers and reviewers (handbook §4–§6, owner Q-39 / Q-41 / Q-60):**

  | Tier | Areas in 05 | Implementer | Reviewers |
  |---|---|---|---|
  | **HIGH** | money (tax, discount, service charge, rounding line, splits, payments, change, refunds); close transaction and races; fiscal outbox / retry / worker; shifts / drawer / blind count / petty cash; day close + Z / X; fiscal adapter port and the PRA adapter; reopen + the tables bumps (`SeatingReopened`, S-9); buyer-ID privacy (hash omit, filler, redaction); approvals (01d kinds, holders right); print retry / retarget; migrations and projections | Opus | **2 fresh Opus**, independent; reviewer 2 focuses on money (BigInt, half-up points, Σ invariants), races (`BEGIN IMMEDIATE`, retransmit with the same `command_id`), privacy (no buyer ID / token / name / free text in an event, log, hash, response), statement counts |
  | **NORMAL** | settings shapes, permissions and seeds, print `Doc` builders, screens (except the payment pad), audit mappings, text / i18n, docs, spec bumps | Sonnet | 1 Sonnet |

  Reviewers return BLOCKER / MAJOR / MINOR with file:line. Fix rounds only for BLOCKER / MAJOR; at most 2; a MAJOR open after round 2 → **STOP** (board "STOPs / needs-ruling"). A re-check only mutation-verifies the MAJORs. Both HIGH reviewers asking for changes (or one approve, one change) → the second approval is a fresh re-check reviewer who mutation-verifies every MAJOR (AD-C18). **Money MINORs are fixed before merge**; other MINORs go to `docs/plans/05-cleanup.md` (file, line, finding, PR, who fixes; lanes list them in the PR body, the integrator copies them) and never block a merge. A NORMAL task that turns out to touch a HIGH area is re-tiered on the board (handbook §4).
- **Usage economy:** **phase 0a: no fixed agent cap** (owner D-7, "for now"; budget available) — every 0a lane runs at once with its own reviewers; the guard against conflicts is file ownership (§2A.3), not a cap. From phase 0b on, **at most 4 agents at once** (implementers + reviewers; the integrator session is the orchestrator and not counted) unless the owner re-rules on the board (W-4). Reviews of finished work take a free slot before a new implementation starts. Opus only for HIGH implement + review; Sonnet for NORMAL tasks, docs and small reviews. State lives on the board, not in chat (handbook §1).
- **Tests you run:** your own files (`TMPDIR=/dev/shm pnpm vitest run <files>`) and the typecheck of the package you touched while you work; **the full gate once before you open the PR** — `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` (CLAUDE.md); CI re-runs it on every PR into `module-05` (`postgres:16` on 5433 with the three test-only settings; SQLite on `/dev/shm`). P0.12 and task 6 also run the full hub suite (they refold `orders` / `audit` from seq 0 and change the migration list every migration test reads).
- **Tests:** names cite the spec: `it('[05 #17] …')`, bump rows `it('[05 row Q-3] …')`, the spike `it('[05 spike-0a] …')` / `it('[05 spike] …')`, Appendix P `it('[05 P-T1] …')`; a test written in two halves (§7) names its half: `it('[05 #69 outbox-row half] …')`. Real tables and real events, never a mock of another lane's code; fixtures `apps/hub/test/billing/fixtures.ts` (P0.F, built on `apps/hub/test/orders/fixtures.ts` and `apps/hub/test/voids/fixtures.ts`); statement counts with `statementCounter(db)` wherever the spec states one, at 1 and at 40 (#91); **no timing asserts** (03a AD-32); money in integers, BigInt where products can pass 2^53; random tests use a seeded PRNG in the test file (no new dependency; `packages/engine/test/sim/generate.ts` pattern) and print the seed on failure.
- **Files:** only the files of your task row (0a: the lane's ownership list, §2A.3). `apps/hub/src/billing/index.ts` is created in task 7; every later task adds **only its own registration lines** there (spec §11 H6-14). `packages/domain/src/billing/index.ts` (barrel, task 1) takes one `export *` line per lane module; additive one-line conflicts are resolved at rebase (02b precedent). A test that only pins a value an approved row changes (version, migration list, key list) may be edited by that row; list it under Readings. Anything else — a contract change, a spec–code mismatch, two specs disagreeing, a §12.7 (f) area behaving differently from the text → **STOP**: STOP block in the PR body, label `needs-ruling`, owner answers from the GitHub app; other lanes go on. Never a silent fix.
- **Privacy (B19, B22, B30, row H-4):** no buyer tax ID (any type), token, PIN, name, phone, note, `paid_to` or payment reference in an event, log line, alert, audit row, hash, `VALIDATION_FAILED.issues` or response; ids and counts only. **No token or secret in any file** — PRA fixtures use the literal `test-token`; the sandbox and production tokens are entered by the owner on the pilot hub's `/admin/fiscal/` page only. Before every commit: `git diff --cached | grep -nE '/home/|/Users/|Bearer [A-Za-z0-9]{12,}'` must be empty (handbook §9, W-5: the repo is public).
- **Never in the cloud or CI:** `pnpm test:perf`, printer / drawer / QR-scan / hardware checks, power-loss checks, the PRA sandbox call (no network in the gate). They are listed in §8 for the owner's machine or the pilot hardware.
- **Do not build** anything in spec §12.4 / §12.7 (a) or §1.3, and no `pro_rata` path (`MIXED_CLASS_RULES = ['higher_rate']`; the cloud `0014` CHECK (⚠️ P0.G G-13, R-6; was `0016`) and the snapshot parser refuse it).

---

## 2A. Phase 0a — 05's own work (start-now track)

### 2A.1 Gate before 0a (integrator)

| # | Check | Done when |
|---|---|---|
| G0.1 | `spec-05` merged into `main` (PR #219) | `gh api repos/arsiihere/pos/pulls/219 --jq .merged` is `true` and `git merge-base --is-ancestor origin/spec-05 origin/main` |

### 2A.2 Integrator tasks (sequential; P0.B and 1 before the lanes merge anything)

| # | Task | Spec | Files | Tests | Tier |
|---|---|---|---|---|---|
| P0.B | Cut `module-05` from `main`; ruleset as 04 W-1 (PR required, check `gate`, rebase merge, no force push); labels `needs-ruling`, `tier:HIGH`, `tier:NORMAL`, `lane:05-P0`, `lane:05-I`, `lane:05-U0…U3`, `lane:05-M`, `-T`, `-K`, `-S`, `-B1`, `-B2`, `-P`, `-F`, `-PRA`, `-A`, `-Z`, `-C1`, `-C2`; board `docs/plans/05-status.md` from §9; `docs/plans/05-cleanup.md` (empty, header as `03b-client-cleanup.md`) | — | `docs/plans/05-status.md`, `docs/plans/05-cleanup.md` | — | NORMAL |
| 1 | Shared types (§4.4 constants exactly; `MIXED_CLASS_RULES = ['higher_rate']`) + the barrel `packages/domain/src/billing/index.ts` (one line per module) + one line `export * from './billing/index.js'` in `packages/domain/src/index.ts`. *Moved from the 05 base into 0a (PL-16): every 0a lane imports it* | §4.4 | `packages/domain/src/billing/{types,index}.ts`, `packages/domain/src/billing/types.test.ts`, `packages/domain/src/index.ts` (one line) | constants exact | NORMAL |
| P0.Sa | **Spike, 0a half — GATE for the 0b base (PL-0, PL-19).** See §2A.4 | §3.5, §3.15, §3.16, B12, B20, B21 | `apps/hub/test/billing/spike-0a.int.test.ts` | `[05 spike-0a]` a, b, c | HIGH |

Lanes may start their first task while P0.B / task 1 are in review: a lane whose first task imports `types.ts` stacks on `lane-05I/05-1` (`Stacked on #<n>`) and rebases after it merges.

### 2A.3 Lanes (all at once; file ownership is exclusive)

"Needs" = PRs merged into `module-05` first (stacking allowed, §1). A lane edits **only** the files in its ownership list plus one `export *` line per module it adds in `packages/domain/src/billing/index.ts` (and, L-MONEY only, one line for `currency.ts` in `packages/domain/src/index.ts`; L-PRINT+SETTINGS only, one line per new admin module in `packages/events/src/index.ts`). **No 0a lane edits** `packages/domain/src/errors.ts`, `packages/domain/src/print.ts`, `packages/events/src/{envelope,config,registry}.ts`, any file under `apps/hub/src/{orders,tables,alerts,print,voids,commands,lib,db}/`, `apps/cloud/`, `apps/client/` or `docs/specs/` — those are 0b. A lane that finds it needs one → **STOP** (§1).

**L-MONEY — lane `M`, HIGH, Opus implementer, 2 Opus reviewers.** Owns: `packages/domain/src/currency.ts`, `packages/domain/src/currency.test.ts`, `packages/domain/src/billing/compute.ts`, `packages/domain/src/billing/compute.test.ts`, `packages/domain/src/billing/compute.fixtures.ts` (test-only jurisdiction / bill fixtures: Pakistan regression, multi-tax simple + compound, exponent-0 / -3 currencies), `packages/domain/src/billing/compute.property.test.ts`.

| # | Task | What | Spec | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|
| P0.3a | F-6 **code only**: `currencyExponent(code)` (ISO 4217 minor-unit table, unknown code throws / is refused). The Foundation v1.14 text is P0.2a (0b); `seed-tenant` (H-5) and the envelope (F-1) are P0.3b (0b) (PL-14) | F-6 | `packages/domain/src/currency.ts` (+ test) | **#14c** (exponent half: `PKR` = 2; exponent-0 / -2 / -3 fixtures) | — | HIGH |
| 2 | `computeSplit` / `computeBill` with **plain input types declared in `compute.ts`** (lines with `tax_profile_id`, the resolved tax profiles and rate rows by date, jurisdiction rules with `currency_exponent`, the bill's frozen rounding rule and price mode, payments by class and direction): tax lists per profile (simple / compound, ≤ 4), inclusive back-calculation, `apportionMinor` over `allocateCappedMinor`, whole-bill discount spread + R3 cap / discount lines, sticky service charge (inclusive on the pre-tax net), `higher_rate`, rounding adjustment (untaxed, in no class, the frozen rule; `all` / `cash`), dues per §3.5 (7) incl. H16-1, H17-1, run-18 Q-1 (**no due while balance ≤ 0**), refunds per payment type ("jitna liya utna wapas"), splits by item / amount / equal-N, the Pakistan regression fixture. No I/O, no event, no snapshot parser (the hub maps the snapshot in 0b) | §3.4–§3.8, B4–B10 | `packages/domain/src/billing/compute.ts`, `compute.test.ts`, `compute.fixtures.ts` | #10–#16, #11b, #13b, #20, #20b — the **compute halves** (§7: command clauses of #13b, #14, #15, #16 are extended in 17, 19, P0.9b, 13) | 1, P0.3a | HIGH |
| 3a | **Property tests** for compute in both price modes against an **independent model written in the test file** — implemented by a **fresh subagent that did not write task 2** and reads only the spec and `compute.ts`'s exported signatures (credibility rule, PL-15) | §3.5 (8) | `packages/domain/src/billing/compute.property.test.ts` | #10, #10d, #11c, #15e, **#20c**, #16b and #16c (compute halves), #23 (payments half) | 2 | HIGH |

**L-FISCAL — lane `F`, HIGH, Opus implementer, 2 Opus reviewers.** Owns: `packages/domain/src/billing/fiscal-snapshot.ts` (+ test), `apps/hub/src/billing/fiscal/port.ts`, `apps/hub/src/billing/fiscal/none.ts`, `apps/hub/src/billing/fiscal/outbox.ts`, `apps/hub/src/billing/fiscal/outbox-ddl.sql`, `apps/hub/src/billing/fiscal/worker.ts`, `apps/hub/test/billing/fiscal/fake-adapter.ts`, `apps/hub/test/billing/fiscal/outbox-db.ts`, `apps/hub/test/billing/fiscal/{port,outbox,worker}.test.ts`.

| # | Task | What | Spec | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|
| 5a | **Invoice jurisdiction snapshot types**: TS types for `InvoiceIssued.fiscal` (`adapter_key`, `pos_id`, `required`, `capabilities`, `credit_support`, `rounding`, `receipt` labels / QR template / `buyer_id_on_receipt`, `seller_registrations`, `payment_codes`) and the invoice fields the neutral submission reads; task 5's Zod schemas `satisfies` them in 0b (PL-16) | §6.12 step 6, §6.29, H9-6 | `packages/domain/src/billing/fiscal-snapshot.ts` (+ type test) | type tests (`expectTypeOf`), no free-text or buyer-ID field exists | 1 | HIGH |
| 6a | **Fiscal tables, staged**: `fiscal_outbox` (+ `fiscal_outbox_pending` index) and `fiscal_credentials` DDL **exactly as spec §5**, in a staged file the migration runner does not read (migration numbers must be sequential, `apps/hub/src/db/migrate.ts:97`, and 0021 / 0022 are 0b rows); task 6 copies it verbatim into the 05 migration and deletes it (PL-13). Test helper `outbox-db.ts` = `freshDb()` + `migrate()` + this DDL | §5 (fiscal rows), B20, B22 | `apps/hub/src/billing/fiscal/outbox-ddl.sql`, `apps/hub/test/billing/fiscal/outbox-db.ts` | schema test: columns, CHECK states, partial index, PK | — | HIGH |
| 28a | **Port contract** (`FiscalAdapter`, capabilities, `settingsSchema`, `credentialNames`, neutral `FiscalSubmission` / `FiscalAnswer`, `registerFiscalAdapter` / lookup) exactly as §3.15; **`none` adapter**; **test fake adapter** (configurable ordering, credit capability, credential names, scripted answers, records submissions); `outboxRowFor(snapshot, ord, original?)` (state `not_required` for adapter `none`, a non-fiscalized order type, an invoice before `switched_at`; `pending` otherwise; a credit follows its original's state, jurisdiction, adapter and `pos_id`) + `insertOutboxRow(db, row)` (`INSERT OR IGNORE`, the statement task 7's fold calls); `canCredit(originalSnapshot)` (adapter `capabilities.credit` **and** `credit_support = 'credit_invoice'`, both from the original's snapshot). The core never branches on the adapter key | §3.15, B20, H6-8, H9-6 | `…/fiscal/{port,none,outbox}.ts`, `apps/hub/test/billing/fiscal/{fake-adapter.ts,port.test.ts,outbox.test.ts}` | **#74**; #69, #78, **#78b** — the outbox-row / credit-rule halves (§7) | 5a, 6a | HIGH |
| 29a | **Worker skeleton** `startFiscalWorker(deps)` / `runOnce(deps)` over `fiscal_outbox`: one request in flight per hub; order per `pos_id` (`strict_per_pos_id` head blocks only its `pos_id`; `none` independent); credits wait behind their original and step aside; back-off 5 s → 30 s → 2 min → 5 min on a fake clock; `rejected` never resent; `in_flight_at` crash resend with the **same `idempotency_key = invoice_ref`**; credentials read from `fiscal_credentials` at send, a missing name → `pending` + `last_error: 'token_missing'` without holding another `pos_id`; `health()` at most every 60 s; short error codes only in `last_error`. **Seams for 0b:** `loadSubmission(row)` and `onAnswer(row, answer)` are injected deps (fakes in tests); 29b supplies the real ones (events, `invoice_buyers`). P0.18 (0b) only adds the boot call (PL-18); ⚠️ P0.G (G-21): it runs after task 7 and calls task 7's `startBillingWorkers(deps, log)` | §3.15, B20, B21 | `…/fiscal/worker.ts`, `apps/hub/test/billing/fiscal/worker.test.ts` | #70 (same-key half), **#71**, #72 (back-off half); captured logger: no token, no buyer field (#77 worker half) | 28a | HIGH |

**L-PRINT+SETTINGS — lane `P`, NORMAL, Sonnet implementer, 1 Sonnet reviewer** (re-tier HIGH if a task turns out to compute money rather than lay it out, handbook §4). Owns: `packages/domain/src/billing/docs.ts`, `packages/domain/src/billing/docs.test.ts`, `packages/events/src/admin/billing.ts` (+ test), `packages/events/src/admin/jurisdiction-seeds.ts` (+ test), `packages/events/src/admin/fiscal-adapters/{none,pra}.ts` (+ test), `apps/hub/src/billing/defaults.ts` (+ test).

| # | Task | What | Spec | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|
| 4a | **Pure `Doc` builders** over the existing 03c `Doc` / `DocBlock` (`packages/domain/src/print.ts`, read only): check bill (PROVISIONAL banner, no invoice / fiscal number / QR, default-class total, digital-rate line, rounded cash total), receipt (number, lines, discount, service charge, one tax row per (label, rate, class), the rounding line, total, payments, change, every seller registration with its label, header / footer per template, "FISCAL NUMBER PENDING" when fiscalized and unanswered, the fiscal number when known, drawer block on a cash payment), credit note (last 4 of a buyer ID only), X / Z report doc (names passed in, resolved from `staff_names` by the caller at render). Builders take **input types declared in `docs.ts`** (the invoice snapshot fields via 5a's types once merged). **Not in 4a:** the QR block (row P-3) and the `{ fill: 'buyer_id', ref, last4 }` block (row P-5) — both change 03c's `DocBlock` in 0b → task 4b | §3.16, B17, B21, B29, §6.26 (report fields) | `packages/domain/src/billing/docs.ts` (+ test) | #34, #59, #61 — the doc halves without QR / filler; #20 (the rounding line on the receipt) | 1, 2 (`computeSplit` output shape), 5a | NORMAL |
| P0.9a | **05-owned new files of rows A-1 / A-2** (no existing file edited; PL-14): the shared seed constant `jurisdiction-seeds.ts` (`none`, `PK` rule values exactly as A-1 (2); H11-5); the adapter settings schemas `fiscal-adapters/none.ts` and `fiscal-adapters/pra.ts` (`{}` only, `.strict()`, Appendix P.2); the Zod wire shapes `admin/billing.ts` (A-2: C6 keyed lists by `mode_id`, `code`, `category_id`, `pos_id`, `device_id`, `authority_codes` by `adapter_key`, `tax_registrations` by `code`; cash kind ⇒ cash class; ≥ 1 active cash mode; `https://` base URLs; `adapter_settings[key]` by that key's `settingsSchema`; bounds as A-1 (3)); `apps/hub/src/billing/defaults.ts` (built-in `PK` / `none` default rules from the seed constant, thresholds from the currency exponent). **Not in P0.9a:** cross-reference checks (`not_found`, `profile_missing`, `currency_mismatch`), the cloud module, `0014` (⚠️ P0.G G-13; was `0016`), routes, snapshot key in `config.ts` → P0.9b (0b) | A-1 (2), (3), (5) defaults; A-2; H11-5; P.2 | the files above | #14c (defaults half: exponent-0 / -3 thresholds 100 / 5 000 major units; `none` = no rounding); A-2 shape tests (each refinement accepts / refuses); seed constant has no `pro_rata` | 1, P0.3a | NORMAL |

**L-PRA-SKELETON — lane `PRA`, HIGH, Opus implementer, 2 Opus reviewers, optional** (opens when the owner or integrator has a free session; nothing waits for it). Owns: `apps/hub/src/billing/fiscal/pra.ts`, `apps/hub/test/billing/fiscal/pra.test.ts`, `apps/hub/test/billing/fiscal/fixtures/pra/`.

| # | Task | What | Spec | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|
| 30a | **PRA mapping skeleton** (owner D-6; PL-17): an unregistered `praAdapter` implementing the 28a port with only what Appendix P settles — `USIN` = idempotency key, `InvoiceType` 1 / 3 + `RefUSIN`, totals (`TotalSaleValue`, `TotalTaxCharged`, `Discount`, `TotalBillAmount` with the rounding adjustment inside it only), one item per line + the `Service charge` item, `PaymentMode` from `authority_code` (1 / 2, several codes → 5, missing → `rejected` `mode_unmapped`), `multi_tax_unsupported`, buyer fields by `tax_id.type`, a credit's original buyer and `pos_id`, Bearer header from `credentials.token`, answer classes of P.3 (2xx + number → ok, network / timeout / 5xx → retry, 4xx → rejected, duplicate per A10 default); fixtures recorded from `docs/stories/05-fiscal-research.md` with `test-token`. **Every field, value or answer shape that needs A13, A14 or PRA's "Technical Specification Software Fiscal Device v1.2" is a `// TODO(STOP: A13 | A14 | PRA v1.2)` with a failing-by-design `it.todo`, never a guess.** No network; no registration line (task 30 registers it) | Appendix P.1–P.3, P.7 | the files above | **P-T1**, **P-T2** — the clauses Appendix P fully defines (§7) | 28a | HIGH |

### 2A.4 Spike, 0a half (integrator, after 2, 4a, 6a, 28a, 29a, P0.9a merge)

**P0.Sa — GATE for the 0b base (tasks 5, 6, 7).** `apps/hub/test/billing/spike-0a.int.test.ts`, using only merged 0a code (no throwaway compute, no throwaway adapter): (a) jurisdiction `PK` (from `jurisdiction-seeds.ts` / `defaults.ts`): `computeSplit` on a one-tax dine-in split (the §6.31 table-7 shape) → an invoice-shaped object with a 5a snapshot → `outboxRowFor` → `insertOutboxRow` on `outbox-db.ts` gives `not_required`; `buildReceiptDoc` shows the rounding line and **no fiscal block**; (b) a test jurisdiction with the fake adapter (`strict_per_pos_id`, `credentialNames: ['token']`, a `fiscal_credentials` row): the row is `pending`, `runOnce` sends with `idempotency_key = invoice_ref` and the submission's totals equal `computeSplit`'s; `onAnswer` gets `ok`; a reprint `Doc` built with that fiscal number shows it, before it "FISCAL NUMBER PENDING"; (c) a failed insert inside a rolled-back SQLite transaction leaves no outbox row. **Any failure → STOP** and a spec / plan row; the 0b base does not start. The command lanes still wait for P0.Sb (§2B.6).

**Phase 0a done** when P0.B, 1, P0.3a, 2, 3a, 5a, 6a, 28a, 29a, 4a, P0.9a are merged, CI on `module-05` is green and P0.Sa is green (30a may still be open). The board's acceptance map is seeded with the 0a halves (§7).

---

## 2B. Phase 0b — numbers, bumps, upstream code, 05 base, spike (after `module-deeplinks` is on `main`)

### 2B.1 Gate before 0b (integrator)

| # | Check | Done when |
|---|---|---|
| G0.2 | `module-deeplinks` has reached `main` | `git log origin/main..origin/module-deeplinks` shows only merge commits whose trees `main` already has (handbook §7.1 check) |
| G0.3 | No other open branch / PR claims a target spec or migration number | `gh api 'repos/arsiihere/pos/pulls?state=open'` + `git ls-tree` of every `origin/*` ref under `docs/specs/`, `apps/hub/src/db/migrations/`, `apps/cloud/src/db/migrations/`; result written to the board |
| G0.4 | `main` synced into `module-05` (handbook §7.2) so 0b bases on `main`'s text | sync PR merged, CI green |

Until G0.2–G0.4 hold, phase 0b does not start; 0a goes on. The owner sees the state on the board.

### 2B.2 Integrator tasks (sequential)

| # | Task | Spec | Files | Tests | Tier |
|---|---|---|---|---|---|
| **P0.1** (spec task 0) | **Re-take the next free numbers** on `main` and every branch / open PR (G0.3 scan): F, 00, 01a, 01b, 01d, 02a, 02b, 03a, 03c, 04; hub migrations (provisional 0021–0023), cloud (0016–0017; ⚠️ P0.G G-13, R-6: now **0014–0015**, taken in P0.1b). Write **05 v1.0.1** (numbers only: changelog row, "⚠️ Changed in v1.0.1 (P0.1, H5-1)" markers in §4.5, §11, §12.7 (d), the Depends-on line; v1.0 kept) and README row 05 in the **same commit**. A pure renumber is **no STOP** (H5-1, §13). Expected: 01d → v1.3.3 or later (v1.3.1 / v1.3.2 taken on `module-deeplinks`); the others move only if `main` moved | §4.5 head, §11 P0.1, §12.7 (d); G1 §13 | `docs/specs/05_Billing_Spec_v1.0.1.md`, `docs/specs/README.md` | — (docs) | NORMAL |
| P0.G | **Gap sweep** (04 P0.0 pattern, read-only): every name, signature, export, table, column, helper and statement count the 0b and later tasks use, checked against `module-05` after G0.4 (file:line) — **including the merged 0a code** (compute input types vs the snapshot shape, 5a vs §6.29, 4a inputs vs 03c `DocBlock`, worker seams) — with extra weight on spec §12.7 (f); mismatches as G-rows with options + Rec in `docs/plans/05-gaps.md`; owner rules once; this plan patched; ruled text that changes a spec goes into the P0.2 bumps or a 05 v1.0.2 | all | `docs/plans/05-gaps.md`, this file | — | NORMAL |
| **P0.1b** | ⚠️ P0.G (R-1, R-2, R-4, R-6, R-8–R-12; `05-gaps.md`). **Write 05 v1.0.2** — only the owner rulings that change 05's own text (v1.0.1 kept; changelog row; "Changed in v1.0.2 (P0.G, R-n / G-n)" markers; README row 05 in the **same commit**): **R-1** §3.3 3a / §3.4 (an unresolved service-charge tax profile blocks close with `BILL_CLOSE_BLOCKED { reason: 'tax_unresolved' }`, `order_item_ids` holding the literal `'service_charge'` while the split's charge > 0); **R-2** §3.5 (2) note (frozen discount re-spread over the open `bill_discount_lines` on every read; ±1 minor unit after a sibling close accepted for v1.0); **R-4** §4.4 comment "⇔" → "⇒" (kind 'cash' ⇒ class 'cash' only); **R-6** cloud migrations **0014 / 0015**: every live occurrence of 0016 / 0017 in the spec (§4.5 rows A-1 / A-2 / B-2, §10 #14 / #15, §11 P0.8 / P0.9, §12.7 (d), plus §3.6 ("refused by the `0016` CHECK"), the §4.5 "Version numbers" paragraph (rewrite its claim sentence: `0014` / `0015` were phantom claims on stale `module-02-hub-gaps` PRs #121 / #126, R-6) and the §12.7 "Pro rata mixed-payment tax" row — found by grep); history rows stay; **R-8** §6.12 step 7 "when fiscalized (§3.15)" and the task-5 refine (`required: true` with adapter `none` refused); **R-9** §3.15 port block `payments[].authority_code: string \| null` (adapter answers `rejected` `mode_unmapped` on null); **R-10 / R-14** the built-in defaults sentence (A-1 (5)): minimal `discount_reasons` and `petty_categories` lists from the §4.4 examples; `invoice_prefix` = empty, receipt `header_lines` / `footer_lines` = empty, every other default per A-1 (3) (`max_discount_pct` 100, `open_bill_flag_minutes` 240, `stuck_after_ms` 1 800 000, variance and petty limits, receipt toggles per K-12); **R-13** (G-11) the A-2 / §6.28a config rule: with an adapter other than `none`, saving the fiscal settings without `default_pos_id` → `422 CONFIG_REFERENCE_INVALID { field: 'fiscal.default_pos_id' }`, so a fiscalized split always resolves a `pos_id` (device mapping, else default); no new §9 code; **R-11** §3.16 / B21 "FISCAL NUMBER NOT ISSUED" for a `rejected` invoice (builder takes the fiscal state pending / acked / rejected); **R-12 spec-text Recs**: G-3 a null seed `receipt_fiscal` → `receipt` with null `fiscal_number_label` and empty lists (the mapping is owned by P0.9b's mapper, the snapshot builder; task 5 only validates the non-null shape), `InvoiceIssued.service_charge` is nullable (null when no charge; G-27), G-9 §6.25 / §6.26: the Z `report` embeds `mode_name` (per takings row) and `category_name` (per petty row); staff stay ids only (H16-5), G-5 `tax_minor` = Σ invoice tax rows incl. service-charge taxes, G-6 §5 `invoices.doc_json` comment ("payments as in the event" is wrong; join by `payment_id`), G-7 `pos_id` nullable on the port, G-22 "the worker re-raises" → "the tick re-raises" (§6.27 text and test #73's "re-raised on the next worker pass" → "re-raised on the next tick"). **R-3** (A-1 (3) wire names `discount_reasons`, `petty_categories`, `receipt` + `show`, `rate_overrides`) is 01a v2.6 text → P0.2c, not here. **Needs P0.1; lane `lane-05I/05-p0.1b`, integrator, docs only. The P0.2 bumps wait for P0.1b** | §3.3 3a, §3.4, §3.5 (2), §4.4, §4.5, §11, §12.7 (d), §6.12 step 7, §3.15, §3.16 / B21, §5, A-1 (5); G1 §13 | `docs/specs/05_Billing_Spec_v1.0.2.md`, `docs/specs/README.md` (row 05) | — (docs); reviewer: the text equals the rulings and nothing else changed | NORMAL |

### 2B.3 Spec bumps (P0.2 — one PR per target, in §4.5 row order)

⚠️ P0.G: **the P0.2 bumps start after P0.1b** (05 v1.0.2 carries the cloud numbers 0014 / 0015 and the other rulings the bumps cite).

Each PR: re-read `main`'s current text of the target **and every version between the one 05 was written against (spec "Depends on" line) and `main`'s**; apply the rows to a **new version file** (old kept), changelog row, "⚠️ Changed by 05 (row X-n)" markers (R34), README row of that spec. **STOP rule:** if a section a row edits moved in a way the row did not foresee (a content clash, not a renumber), STOP for the owner (`needs-ruling`), and the code task of that row waits. A clash with code already merged in 0a (P0.3a, P0.9a) is the same STOP; the 0a file follows the bumped text in the row's 0b code task. Reviewer: 1 Sonnet, checks the text equals the row and nothing else changed.

| # | Target → version (provisional; P0.1 fixes it) | Rows | Written against |
|---|---|---|---|
| P0.2a | Foundation → v1.14 (+ §6.2 append F-5; CLAUDE.md source-of-truth line, owner merges, 04 P0.2 precedent) | F-1, F-2, F-3, F-4, F-5, F-6 | v1.13 |
| P0.2b | 00 Hub Platform → v1.12 | H-1, H-2, H-3, H-4, H-5 | v1.11 (DRAFT) |
| P0.2c | 01a → v2.6 | A-1, A-2, A-3, A-4, A-5 (A-6 dropped); ⚠️ P0.G (R-3): A-1 (3) wire names `discount_reasons`, `petty_categories`, `receipt` (container) + `show` (toggles), `rate_overrides` (code #276) | v2.5.1 |
| P0.2d | 01b → v1.10 | B-1, B-2 (B-3 dropped) | v1.9.1 |
| P0.2e | 01d → v1.3.1 → re-taken (≥ v1.3.3) | D-1 | v1.2.5 + `module-deeplinks`' v1.3 – v1.3.2 |
| P0.2f | 02a → v1.1.8 | T-1, T-2, T-3 | v1.1.6 + v1.1.7 |
| P0.2g | 02b → v1.0.16 | Q-7, Q-1, Q-2, Q-6, Q-5, Q-3, Q-4; ⚠️ P0.G (G-14, R-7): Q-1 / 0021 text also adds **`order_lines.unit_price_minor`** and **`LineView.unit_price_minor`**, folded from `ItemAdded` (price, extra price, allocated price per line kind, as 02b defines) — an upstream contract change, owner-approved | v1.0.14 + v1.0.15 |
| P0.2h | 03a → v1.2.6 | S-1 | v1.2.4 + v1.2.5 |
| P0.2i | 03c → v1.0.11 | P-1, P-2, P-3, P-5, P-4 | v1.0.10 |
| P0.2j | 04 → v1.0.7 | V-1, V-2, V-3 | v1.0.5 + v1.0.6 |
| P0.2k | README | R-1 (R37 amends R13 with marker; R38; milestone C text; module map row 05; carried rows To 05 marked landed per §4.6; new To 06 / To 07 rows from §4.3) | — |

### 2B.4 Upstream code rows (spec §11 P0.3–P0.18; merged in this order)

Each row needs its P0.2 bump merged first (spec-first). Implementation may run ahead in four module lanes — **U0** platform (00 / F), **U1** 01a / 01b / 01d, **U2** 02a / 02b / 03a / 04, **U3** 03c — but PRs merge in the order below, **except where "Needs" names a later row** (PL-11: P0.5 and P0.6 use permissions B-1 defines in P0.7, so P0.7 merges before them; P0.10 uses P0.17's `renderText`, so it merges after P0.17). "Needs" = merged first. ⚠️ P0.G: **P0.3c** (errors.ts, G-15) is added after P0.3b; **P0.18 moved** to after task 7 (§2B.5, G-21); the 0b follow-up rows on merged 0a code are P0.19a–d (§2B.4b).

| # | Lane | Task | Spec | Files (own) | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| P0.3b | U0 | F-1 `bill` stream type; H-5 `seed-tenant` currency check (uses P0.3a's `currencyExponent`). *P0.3's F-6 code moved to 0a as P0.3a* | F-1, H-5 | `packages/events/src/envelope.ts`, `apps/cloud/src/cli/seed-tenant.ts` | H-5: `PKX` refused, nothing written; `PKR` seeded; `bill` stream parses | P0.2a, P0.2b, P0.3a | HIGH |
| P0.3c | U0 | ⚠️ P0.G (G-15). **Append the 05 §9 error codes** to `packages/domain/src/errors.ts` (CLAUDE.md order: module spec → foundation §6.2, text F-5 in P0.2a → `errors.ts`; no 0a lane may edit it, §2A.3). Tasks 10 and every later command task import them | §9, F-5 | `packages/domain/src/errors.ts` (+ its test) | every §9 code exists as §9 defines it; the foundation §6.2 list and `errors.ts` agree | P0.2a, P0.1b | NORMAL |
| P0.4 | U0 | H-1 `sessionKind: 'both'` (one `command_id` space, same handler, permission from the session's staff) | H-1 | `apps/hub/src/commands/{registry,route}.ts` | #80 | P0.2b | NORMAL |
| P0.4b | U0 | **H-4 `hashOmit`** (dotted paths; omitted fields never hashed, stored, logged or echoed; `VALIDATION_FAILED` drops `input` / received values); the "no request body logged" test. *Plan addition PL-1* | H-4 | `apps/hub/src/lib/hash.ts`, `apps/hub/src/commands/{registry,route}.ts` + a logging test | `[05 row H-4]`: retransmit differing only in an omitted field = same command; captured logger sees no body on `/commands/*` and `/admin/commands/*`; issue paths name `tax_id.value`, never the value | P0.4 | HIGH |
| P0.5 | U0 | H-2 `/admin/fiscal/` entry + side-nav + home tile, shown by `manage-fiscal-settings` (page body is task 31a's) | H-2 | `apps/hub/src/admin/`, `apps/client/src/features/admin/fiscal/` (shell only); ⚠️ P0.G (G-17): `apps/hub/src/lib/client-dist.ts` (constant), `apps/hub/src/server.ts` (`registerClientDist`), the client `vite.config` entry, client `package.json` build, `admin-fiscal/index.html`, `apps/hub/src/auth/staff-directory.ts` (`adminPermissions()`, :421, returns only manage-devices and manage-staff), `apps/hub/src/admin/page.ts` (`MODULE_PAGES` is hard-coded to `manage-devices`; the page's `can()` returns true for an unknown key = fails open), the client-dist, ship-client and build-output tests | nav shown / hidden by the permission; ⚠️ P0.G (G-17): a staff without `manage-fiscal-settings` gets no nav entry and no tile (not fail-open); client-dist / ship-client / build-output tests cover `admin-fiscal` | P0.2b, P0.7 | NORMAL |
| P0.6 | U1 | A-3 guard list, A-4 appender list, A-5 `close-business-day` permission + `'both'` + Stock page text (`DAY_CLOSE_BLOCKED` reasons `shift_open` / `unbilled_orders` listed via `Message.items`) | A-3–A-5 | `apps/hub/src/commands/close-business-day.ts`, `apps/client/src/features/admin/stock/StockApp.tsx`; ⚠️ P0.G (G-18): `registerDayCloseGuard` today **replaces**; it **appends** (a list). The reset helper becomes `resetDayCloseGuards` as spec A-3 names it (a code rename; 04 tests calling `resetDayCloseGuard` follow, listed in the PR). A divergence from A-3's text is a **STOP** | #68, #79 (day-close half); 01a #196 kept; two guards, first wins; appender drafts before `withStockEffects(…[BusinessDayClosed])` | P0.4, P0.7 | HIGH |
| P0.7 | U1 | B-1 permissions (group `bills`, scopes, `ALLOWED_ONLY_PERMISSIONS`, approvable list, `checkGrants` refusal of `close-shift-for-others` without `manage-own-shift`); D-1 01d **holders right** `{ mode: 'holders', permission }` | B-1, D-1 | `packages/domain/src/permissions.ts`, `apps/hub/src/alerts/{kinds,targets,raise}.ts`, `apps/hub/src/alerts/commands/answer-request.ts`, cloud `staff-roles/service.ts`; ⚠️ P0.G (G-16, F D46): `packages/events/src/events/alert/AlertRaised.v5.ts` (`request.right_mode` gains `holders`; v4 exists; **identity upcaster** v4 → v5), `AlertRequestPart`, `mayAnswer`, `apps/hub/src/alerts/raise.ts`; ⚠️ P0.G (G-20): alert kinds and audit actions register **at module load** by a static import (the audit seal runs in `registerHubProjections`, `boot.ts:306-315`, before `registerBilling`) | **#53b** (written here; tasks 21 / 22 extend); holders matrix, never self; ⚠️ P0.G (G-16): v4 payload upcasts to v5, v5 `holders` shape parses | P0.2c, P0.2d, P0.2e | HIGH |
| P0.8 | U1 | B-2 default roles + cloud `0015_billing_defaults_backfill.sql` (⚠️ P0.G G-13, R-6; was 0017) (by `default_key`, active roles, approver rows, `directory_version` +1); ⚠️ P0.G (G-27): the backfill is **idempotent** (`apply-discount` already exists on Cashier) | B-2 | `apps/cloud/src/modules/staff-roles/default-roles.ts`, `apps/cloud/src/db/migrations/0015_*.sql` | #90; ⚠️ P0.G (G-27): running the backfill twice changes nothing | P0.7 | NORMAL |
| P0.9b | U1 | A-1 / A-2 rest (P0.9a's files exist): cloud `branch_billing_settings`, **jurisdiction catalog** tables seeded from `jurisdiction-seeds.ts` (+ the `PK-PB` rows; a cloud test asserts seeded rows equal the constant, H11-5), CHECK `mixed_class_rule = 'higher_rate'`, routes `GET` / `PUT …/billing` (cross-reference checks: `not_found`, `profile_missing`, `currency_mismatch` 422) and `GET /v1/admin/jurisdictions`, snapshot `billing` key with `jurisdiction` and `tax_profiles` in `config.ts`, the hub mapping snapshot → `compute.ts` inputs. ⚠️ P0.G (R-10, G-23): built-in defaults gain a minimal `discount_reasons` and `petty_categories` list from the §4.4 examples (05 v1.0.2 A-1 (5)); (R-14) built-in `invoice_prefix` = empty and receipt `header_lines` / `footer_lines` = empty; the rest takes its A-1 (3) value: `max_discount_pct` 100, `open_bill_flag_minutes` 240, `stuck_after_ms` 1 800 000, `variance_threshold_minor` 100 major units, `petty_cash_limit_minor` 5 000 major units, receipt show toggles per K-12; (R-13, G-11) the config check: adapter ≠ `none` and no `default_pos_id` → `422 CONFIG_REFERENCE_INVALID { field: 'fiscal.default_pos_id' }`, so a fiscalized split always resolves a `pos_id`. Mapper (G-23): synthesizes `none` rate rows for the right `integration_status` with a minimum `effective_from` (the seeds hold `none` and `PK` only, no `effective_from`), and renames `tax_class_id` → `tax_profile_id`. ⚠️ P0.G (G-3): a null seed `receipt_fiscal` maps to `receipt` with null `fiscal_number_label` and empty lists — owned here (the snapshot builder; task 5 validates only the non-null shape) | A-1, A-2 | `apps/cloud/src/modules/billing-settings/`, `apps/cloud/src/db/migrations/0014_billing_settings.sql` (⚠️ P0.G G-13, R-6; was 0016), `packages/events/src/config.ts`, `packages/events/src/admin/billing.ts` (extended), `apps/hub/src/billing/defaults.ts` (extended) | #14, #14b, #14c (cloud half); no `pro_rata` seed; currency mismatch 422; `profile_missing`; #14 / #15 settings clauses (override beats catalog; `0014` CHECK); ⚠️ P0.G (R-10, G-23, G-3): defaults lists and R-14 values present with no `billing` key (built-ins equal the A-1 (3) numbers), adapter ≠ `none` without `default_pos_id` refused (R-13), `none` rate rows synthesized, `tax_profile_id` mapped, null `receipt_fiscal` mapped | P0.3b, P0.2c, P0.9a | HIGH |
| P0.10 | U1 | A-1 (6) owner **Billing** page with receipt preview (`renderText` from P0.17) and the jurisdiction view | A-1 (6), §8.1 | `apps/client/src/features/owner/billing/` | form round-trip, 422 field mapping, preview text; ⚠️ P0.G (G-23): the page works with the built-in defaults when no `billing` key exists — lands in: P0.10 (the gaps doc names the task, not the line) | P0.9b, P0.17 | NORMAL (UI, Q-P2) |
| P0.11 | U2 | T-1 merge guard list (`MergeGuard` returns `{ code, details }`); T-3 `SeatingReopened`, `OrderPlaced` on `bill_closed = 1`, `requireLock(…, { allowBillClosed })` for live `SubmitOrder` only, `readOrder.seating_state`, `RemoveItems` skips the lock on CLOSED, audiences (+ `BillClosedEmpty` fold when `seating_id` non-null) | T-1, T-3 (1)–(7) | `apps/hub/src/tables/{contracts,merge-guard,lock,projection,audiences}.ts`, `apps/hub/src/tables/commands/{merge-tables,split-seating}.ts`, `packages/events/src/events/table/SeatingReopened.v1.ts`, client `features/staff/tables/map/map-store.ts`, `orders/table-view/refetch.ts`; ⚠️ P0.G (G-18): the `MergeGuard` shape in `apps/hub/src/tables/contracts.ts` (:58) and the callers in `apps/hub/src/voids/` (`voidMergeGuard` in `voids/contracts.ts`, `voids/guards.ts`) and 04's tests | #79 (merge half), **#37b, #37c, #37d, #37e, #37f, #37g, #37h** | P0.2f | HIGH |
| P0.12 | U2 | Q-1 `order_lines.tax_profile_id` + `0021_orders_billing.sql` (also `carried_over`, `bill_key` + index, `orders_token_day` replacing unique `orders_token`; deletes the `orders` checkpoint → refold); `LineView` / `ReadOrderLine` gain the field (same statements). ⚠️ P0.G (G-14, R-7): `0021` also adds **`order_lines.unit_price_minor`**, the projection folds it from `ItemAdded` (price, extra price, allocated price per line kind as 02b defines), `LineView.unit_price_minor` (and `ReadOrderLine`). **Runs the full hub suite once** | Q-1 (+ Q-5, Q-6 columns; G-14 column) | `apps/hub/src/orders/{projection,exports}.ts`, `apps/hub/src/db/migrations/0021_orders_billing.sql`, `apps/hub/test/db/alerts-migration.int.test.ts`, `apps/hub/test/db/order-line-{options,station,option-quantity}-migration.int.test.ts`, new `apps/hub/test/db/orders-billing-migration.int.test.ts` | #82; two `(date, 56)` tokens accepted; `orders_token` gone; ⚠️ P0.G (G-14): `unit_price_minor` folded per line kind (item, extra price, allocated deal price), present on `LineView`, rebuild = live | P0.2g | HIGH |
| P0.13 | U2 | Q-2 `OrdersUnbilled` (fold clears `billed_at` and `day_closed_at`; joins `ORDER_EVENT_TYPES` and client `ORDER_FRAMES`); Q-4 `LineCompRemoved` + `planCompRemoval`; Q-5 `OrdersCarriedOver` fold + `applyDayClosed` skip; Q-6 `adds_to_order_id` (root's token, own `table_key`, root's `bill_key`); 03a S-1 `OrderPlaced.adds_to_order_id` | Q-2, Q-4, Q-5, Q-6, S-1 | `packages/events/src/events/order/`, `apps/hub/src/orders/` (projection, build-submit, commands/submit-order), client order frame lists; ⚠️ P0.G (G-26): audiences for `OrdersUnbilled`, `LineCompRemoved`, `OrdersCarriedOver` (and `LineCompRemoved` checked against `LineComped`'s special per-server audience registration), and entries in **all three** client `ORDER_FRAMES` lists — `features/staff/orders/lists/OpenOrders.tsx` (:24), `features/staff/orders/table-view/refetch.ts` (:13), `features/staff/tables/map/map-store.ts` (:26) (the plan named two) | #83, **#83b**, #84; S-1 fixtures with / without the field | P0.12, P0.2h | HIGH |
| P0.13b | U2 | **Q-7 `registerOrderCancelledHook`** called by `changeDrafts` when it emits `OrderCancelled` (direct paths and 04's void `apply`), `alert_id` stamped. *Plan addition PL-1* | Q-7 | `apps/hub/src/orders/line-change.ts` (+ contracts type) | `[05 row Q-7]`: unregistered → no change; a stub hook's drafts appended with `alert_id` inside an `apply`, `null` outside; `checkAlertIds` passes | P0.13 | HIGH |
| P0.14 | U2 | Q-3 line guard list with `{ order_item_id, units_after, comped_after, base_after_minor, money_changes }` from every caller; V-1 `VoidItems` and `void-preview` ask it after `ORDER_BILLED` | Q-3, V-1 | `apps/hub/src/orders/line-guard.ts`, `orders/commands/{remove-items,comp-line,set-line-weight}.ts`, `apps/hub/src/voids/commands/void-items.ts`, `apps/hub/src/voids/queries/void-preview.ts`; ⚠️ P0.G (G-18): `apps/hub/src/voids/contracts.ts` (`VoidLineGuard`), `voids/guards.ts`, `voids/lanes/V2.ts`, 04's tests — the line guard today is `(db, order_id, touched_ids)` and changes to the Q-3 shape | #32 (guard-list half; task 17 extends), #79 (line half); 04 results unchanged; statement counts unchanged +0 when unregistered | P0.2g, P0.2j | HIGH |
| P0.15 | U2 | V-2 `walk_out`; V-3 audit actions + subject types `bill`, `shift`; `registerRequestAction` | V-2, V-3 | `packages/domain/src/{voids,audit}.ts`, `apps/hub/src/audit/` (registry seam only); ⚠️ P0.G (G-19): **`registerRequestAction` is new** (`REQUEST_ACTIONS` is a private const today); `AUDIT_ACTIONS` is a closed const → gains the new actions; `apps/hub/src/audit/queries.ts` (query validation); client `features/audit/labels.ts` (`ACTION_META: Record<AuditAction, …>`), `apps/client/src/i18n/{en,ur}.ts` (`audit.action.*` labels), `features/audit/strings.test.ts`; ⚠️ P0.G (G-20): registered at module load by a static import, before the seal in `registerHubProjections` | duplicate kind throws; after-seal throws; ⚠️ P0.G (G-19): new actions have a label in en and ur, query accepts them | P0.2j | NORMAL |
| P0.16 | U3 | P-1 bill routes (`bill_routes`, `SetBillRoute`, `BillRouteSet`, `billPrinterFor`, archive refused `CONFIG_IN_USE`) + `0022_bill_routes.sql` + Printers page "Bill printers" section | P-1 | `apps/hub/src/print/`, `apps/hub/src/db/migrations/0022_bill_routes.sql`, client admin printers, the four migration-list tests gain 0022 | #85 | P0.2i, P0.12 | NORMAL |
| P0.17 | U3 | P-2 `retargetDocumentJob` + `documentJobsStatus` (nothing prints twice; a job being sent → `409 PRINT_JOB_NOT_PENDING`); P-3 QR block (`GS ( k`); P-4 `renderText` → `@pos/domain/src/print-render.ts` | P-2, P-3, P-4 | `apps/hub/src/print/`, `packages/domain/src/{print,print-render}.ts`; ⚠️ P0.G (G-27): `renderText` moves to domain — client and test imports change | #60 (retarget half; task 27 extends), #86 | P0.16 | HIGH (print retry) |
| P0.17b | U3 | **P-5 `registerDocumentFiller`**: `{ fill, ref, last4 }` filled at send, never written back to `print_jobs.payload`; unknown kind / missing row prints `last4`; filler error logged with `job_id` only. *Plan addition PL-1* | P-5 | `apps/hub/src/print/worker.ts`, `apps/hub/src/print/render/` | `[05 row P-5]`: payload after send has the block, not the filled text; `renderText` prints `last4`; error log has no text | P0.17 | HIGH (privacy) |

### 2B.4b 0b follow-up rows on merged 0a code (⚠️ P0.G, integrator; after P0.1b, before the 05 base)

The rulings need small fixes in files the 0a lanes owned and merged. They are **0b integrator rows** (lane branch `lane-05I/05-p0.19<x>`), one PR each, own files only; the 0a lanes' ownership (§2A.3) ended with their merge. Reviewers per tier (§1).

| # | Task | Spec | Files | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|
| P0.19a | **`isFiscalized(snapshot)`** in `@pos/domain` = `required && adapter_key !== 'none'` (R-8, G-1), replacing the three different tests (`fiscal-snapshot.ts:35-36` `required` alone, `docs.ts:184` `required` alone, `outbox.ts:67` `required && adapter_key !== 'none'`); used by `outbox.ts` and `docs.ts` (and by every later task that asks "fiscalized": 5, 10, 17, 29a / 29b). Fixtures that build `required: true` with adapter `none` are fixed in the same row. The Zod refine is task 5's | §3.1, §3.15, §6.12 step 7 (05 v1.0.2) | `packages/domain/src/billing/fiscal-snapshot.ts` (+ `fiscal-snapshot.test.ts`), `apps/hub/src/billing/fiscal/outbox.ts` (+ `apps/hub/test/billing/fiscal/outbox.test.ts`, its `required: true` + adapter `none` case at :311), `packages/domain/src/billing/docs.ts` (+ `docs.test.ts`: the `snapshot({ required: true … })` cases at :381, :390, :427 build `required: true` with the default adapter `none` and move onto the test fake adapter, `apps/hub/test/billing/fiscal/fake-adapter.ts`; PRA is not registered before task 30). Grep found no such fixture in `fake-adapter.ts`, `port.test.ts` or `worker.test.ts` | `isFiscalized` truth table (required × adapter `none` / other); `outboxRowFor` is `pending` iff the receipt doc shows the fiscal block (same snapshot, both builders agree); existing 0a tests green | P0.1b | HIGH (fiscal) |
| P0.19b | **Port nullable fields** (R-9 G-4, G-7): `FiscalSubmission.invoice.payments[].authority_code: string \| null` (`port.ts:33`) and `pos_id: string \| null` (`port.ts:20`); the worker stops sending `row.pos_id ?? ''` (`worker.ts:281`); the fake adapter, `none` and (type-follow only) `pra.ts` compile; the adapter answers `rejected` (`mode_unmapped`) on a null `authority_code` (the fake adapter does it in the test; 30a's skeleton already maps "missing → `rejected` `mode_unmapped`" — re-checked here, owned by 30) | §3.15 (05 v1.0.2) | `apps/hub/src/billing/fiscal/{port,worker}.ts`, `apps/hub/test/billing/fiscal/{fake-adapter,port,worker}.test.ts` | `expectTypeOf` for both fields; fake adapter given a null `authority_code` → `rejected` `mode_unmapped`; worker passes `pos_id: null` as null (never `''`); captured logger: no token, no buyer field | P0.1b, P0.19a (same fiscal files) | HIGH (fiscal port) |
| P0.19c | **`spreadLineTaxes`** pure helper in `compute.ts` (G-8): per-line tax for §6.12 step 6 / J-2: weights = line net per §6.12 step 6 (J-2), `apportionMinor`; service-charge taxes are the invoice's `service_charge.taxes`, never in the lines; Σ per tax = the invoice row; pinned by a non-even fixture and a discount fixture. Any inclusive-mode or compound-base point the spec does not answer → **STOP** (§1), not the task's choice. If `exactAt` must change to separate service-charge taxes, existing `computeSplit` outputs and tests stay unchanged | §6.12 step 6, J-2 | `packages/domain/src/billing/compute.ts`, `compute.test.ts`, `compute.fixtures.ts` | Σ line taxes = invoice tax rows (exclusive and inclusive); non-even split; a bill discount; service-charge taxes | 2, 3a, P0.Sa | HIGH (money) |
| P0.19d | **`totals_default_digital`** in `computeBill`'s result (G-25), for the check bill's digital total (today `totals_default` is cash class only) | §3.16, B17 | `packages/domain/src/billing/compute.ts`, `compute.test.ts` | digital-class total equals `computeSplit` of the same lines at the digital rate; cash total unchanged | P0.19c (same file) | HIGH (money) |

### 2B.5 05 base (integrator, sequential, after P0.1b and P0.19a–d; P0.18 after task 7) — spec tasks 5, 6, 7 + fixtures (PL-4)

Shared files no lane may own; written once.

| # | Task | Spec | Files | Tests first | Tier |
|---|---|---|---|---|---|
| 5 | Events (Zod `.strict()`, `schema_version` 1, builders, fixtures; no free text — `has_note` / `has_paid_to` / `has_reference`; `ZReportIssued.report` staff ids only) on streams `bill`, `shift`, `hub`; `InvoiceIssued.fiscal` / invoice fields `satisfies` 5a's types. ⚠️ P0.G: (R-8, G-1) the `InvoiceIssued` schema **refuses `required: true` with adapter `none`** (uses P0.19a's `isFiscalized`); (G-3) the schema validates only the non-null `receipt` shape — the null seed `receipt_fiscal` → `receipt` mapping belongs to P0.9b's mapper (the snapshot builder); (G-27) `InvoiceIssued.service_charge` is nullable (null when no charge; 05 v1.0.2 says so); (G-9, 05 v1.0.2 §6.25 / §6.26) the Z `report` embeds `mode_name` (per takings row) and `category_name` (per petty row), staff stay ids only (H16-5) | §6.29 | `packages/events/src/events/{bill,shift,hub}/` | every event: fixture parses; an extra field refused; no staff or buyer name field exists | HIGH (privacy) |
| 6 | Migration (number from P0.1, provisional `0023_billing.sql`): §5 tables **with 6a's `outbox-ddl.sql` text verbatim** (the staged file is deleted, `outbox-db.ts` switches to `migrate()` alone — listed under Readings); deletes the `audit` checkpoint → refold, V-3; the four migration-list tests gain it. **Runs the full hub suite once** | §5, V-3 | `apps/hub/src/db/migrations/0023_billing.sql`, `apps/hub/src/billing/fiscal/outbox-ddl.sql` (deleted), `apps/hub/test/billing/fiscal/outbox-db.ts`, `apps/hub/test/db/alerts-migration.int.test.ts` + the three rewind tests | schema test (tables, indexes, CHECKs); `audit` rebuild = live with old `BillRequested` events | HIGH |
| 7 | Projection `billing` (outbox rows through 28a's `outboxRowFor` / `insertOutboxRow`, written by the fold in the close transaction) and **`apps/hub/src/billing/index.ts`** (`registerBilling(app, deps)`, one line in `server.ts` / `lib/boot.ts`) | §5, §6.30 | `apps/hub/src/billing/projections/billing.ts`, `apps/hub/src/billing/index.ts`; ⚠️ P0.G (G-20, G-21): the projection is added in **`registerHubProjections`** (`apps/hub/src/lib/boot.ts`, the seal at :306-315; also used by the test hub and the big fixture), not only in `registerBilling`; audit actions and alert kinds are already registered at module load (P0.15, P0.7); `index.ts` also exports **`startBillingWorkers(deps, log)`** (G-21): it returns a stop function and starts the fiscal worker only when `loadSubmission` and `onAnswer` are registered through `apps/hub/src/billing/index.ts` (29b's one registration line, H6-14); with none registered it starts nothing and fails nothing | **#88** (billing half; task 8 extends) | HIGH |
| **P0.18** (moved here, ⚠️ P0.G G-21) | H-3 fiscal worker boot hook after listen, beside the print worker, stop joined in `beat.stop` — calls task 7's `startBillingWorkers(deps, log)` (not `startFiscalWorker` directly; a worker started before task 6 (table missing) or 29b (real seams) would fail every pass; the function starts the fiscal worker only once 29b has registered `loadSubmission` and `onAnswer`); **no stub file** (PL-18). Needs: P0.2b, 29a, **7**. Lane U0 | H-3 | `apps/hub/src/lib/boot.ts` | boot starts / stops the workers after listen; with no seams registered nothing runs and nothing fails | HIGH (outbox) |
| P0.F | Fixtures `apps/hub/test/billing/fixtures.ts`: dine-in seating with two rounds, a deal ×2, an option child, a comped line, a pending-weight kg line, a return line, takeaway root + addition, parking plate on two days, a merged seating; jurisdictions `none`, `PK`, `PK-PB` and a test-only multi-tax / exponent-0 / exponent-3 jurisdiction (reusing `compute.fixtures.ts`); directories with Owner / Manager / Cashier / Order taker (B-2 defaults); a drawer device; sign-in and `answer` helpers over 01d | §10 | `apps/hub/test/billing/fixtures.ts` | fixtures self-test | NORMAL |

### 2B.6 Spike, 0b half — GATE for every command lane

**P0.Sb (PL-0, PL-19).** `apps/hub/test/billing/spike.int.test.ts` over real events, the real 05 migration, the real `billing` fold, the 0a money core, outbox, worker (29a with the real `onAnswer` sink of 29b or, if 29b is not merged yet, an in-test sink that appends the real `FiscalNumberAssigned` event) and `Doc` builders; only the close transaction itself is in-test (it becomes task 17's `CloseSplit`): (a) jurisdiction `PK`: close one split → one transaction holds `InvoiceIssued` + `OrdersBilled` + `BillClosed`, the fold writes the invoice and a `fiscal_outbox` row `not_required`, a receipt job is queued at the bill printer, the receipt has no fiscal block; (b) a test jurisdiction with the fake adapter: the row is `pending`, the worker sends with `idempotency_key = invoice_ref`, `FiscalNumberAssigned` is appended, a reprint shows the fiscal number; (c) a forced COMMIT failure → no invoice, no outbox row, no job; ⚠️ P0.G (G-10): in the real fold the **invoice and its outbox row commit or roll back together** (a throw in either insert rolls the other back; spike-0a (c) proves only the outbox rollback). **Any failure → STOP** and a §4.5 / spec row; no command lane opens. **Task 17's PR switches the spike to the real `CloseSplit` command and re-runs it green** (part of 17's DoD: "real `CloseSplit` end to end").

**Phase 0b done** when every row of §2B is merged, CI on `module-05` is green, and P0.Sb is green. The board's acceptance map (§9) is seeded with every §10 test → task (§7).

---

## 3. Phase 05-1 — bills, payments, close, reopen, fiscal (spec §11: hub tasks 1–20, 24, 27–31a; 8 and 15 from 05-2 first)

"Needs" = PRs merged first; **every task below also needs phase 0b done (P0.Sb green) and P0.3c (the §9 codes in `errors.ts`, ⚠️ P0.G G-15)**, and the 0a tasks it builds on are named. Files under `…/` = `apps/hub/src/billing/`.

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| **M** money core | 2, 3a | *Done in phase 0a (§2A.3)* | | | | | |
| **T** money tests (fresh session, wrote none of 2, 12, 16, 17, 24) | 3b | Command-level halves of task 3's tests: rounds added between split closes, voids and comps on other lines, item-split re-planning, `LINE_IN_CLOSED_SPLIT` residuals, shifts' expected cash moves; through real commands on `apps/hub/test/billing/fixtures.ts` (PL-15) | §3.5 (8) | `apps/hub/test/billing/money-properties.int.test.ts` | #10b, #10c, #10e, #10f; #16b, #16c (command halves); #23 (shifts half) | 2, 3a, 12, 13, 16, 17, 24 | HIGH |
| **K** kinds | 9 | The seven 05 kinds (§3.14) + `fiscal_outbox_stuck` (`managers`, `closes_on: 'owner'`, `expires_at_day_close: true`), holders right per kind; each kind's `apply` / `onWithdraw` calls an exported function in its command's file that throws `not built` until that task (seam, PL-5); `BILL_KINDS` | §3.14, D-1 | `…/kinds/` | #89 | P0.7, 5 | HIGH (approvals) |
| **S** shifts (05-2 slice built first) | 8 | Projection `shifts` (expected cash: tendered, change, outs, petty, advances; takings by mode) | §3.7, §3.11 | `…/projections/shifts.ts` | **#47**, #88 (shifts half) | 7 | HIGH |
| | 15 | `OpenShift` (float, drawer vs taken-by, one open shift per drawer), `shift` query (blind: no `expected_minor` before `ShiftCounted`) | §6.15, §6.16, B11, B23 | `…/commands/open-shift.ts`, `…/queries/shift.ts` | #45, #46 (open half; task 21 extends) | 8, 9 | HIGH |
| **B1** bill | 10 | Ensure-bill (`BillOpened` + `ChargeApplied { source: 'rule' }`, price mode and rounding rule frozen), `bill` query (projected = opened), `open-bills`. ⚠️ P0.G (G-14, G-15, G-1): compute lines take `unit_price_minor` from `LineView`; codes from `errors.ts` (P0.3c); fiscalized tests use `isFiscalized` | §6.1, §6.2, B1, B8 | `…/commands/ensure-bill.ts`, `…/queries/{bill,open-bills}.ts` | #1, #2, #3, #4, **#5b**, #91 | 2, 7, P0.3c | HIGH |
| | 12 | `SetSplits` (items / amount / equal / none; re-basing on a later round; new lines join the highest open split) | §6.5, §3.8, B15 | `…/commands/set-splits.ts` | #7, #8, #9 | 10 | HIGH |
| | 13 | `ApplyDiscount` (approvable, `discount` kind apply), `RemoveDiscount`; `BILL_PARTLY_PAID` after the first close | §6.6, §6.7, B7 | `…/commands/discount.ts` | #16 (command half), #17 | 12, 9 | HIGH |
| | 14 | `RemoveServiceCharge` (approvable), `ApplyServiceCharge` | §6.8, B8 | `…/commands/service-charge.ts` | #18, #19 | 10, 9 | HIGH |
| | 20 | `RemoveComp` on an unbilled line (approvable) → 02b `LineCompRemoved`; asks the line guard | §6.14, B27 | `…/commands/remove-comp.ts` | #41 | 10, 9, P0.13, P0.14 | HIGH |
| **B2** pay & close | 16 | `AddPayment` (dues, `in` capped by its due field, cash step, `PAYMENT_EXCEEDS_BALANCE` while balance ≤ 0, references to `payment_references`, shift by drawer / taker, `SHIFT_NOT_OPEN`, `PAYMENT_MODE_NOT_FISCAL`), `RemovePayment` | §6.9, §6.10, B10, B11 | `…/commands/payments.ts` | #21, #22, #23, #24, #25, **#25b**, #48, #49 | 12, 15 | HIGH |
| | 17 | **`CloseSplit`** — one `BEGIN IMMEDIATE` transaction: §3.3 rules 1–9 in order, gap-free invoice number, `InvoiceIssued` + `closed_split_units`, at the last split `OrdersBilled` + `BillClosed` once, outbox row, `invoice_buyers` insert, receipt job (last 4 + filler block); **switches P0.Sb to the real command**. ⚠️ P0.G: (R-1) an unresolved service-charge tax profile → `BILL_CLOSE_BLOCKED { reason: 'tax_unresolved', order_item_ids: ['service_charge'] }` while the charge > 0 (compute #284), never billed untaxed; (R-13, G-11) no command refusal and no new code: the fiscal-settings config rule (P0.9b) guarantees a fiscalized split resolves a `pos_id` (device mapping, else default), and `outboxRowFor`'s throw (`outbox.ts:68-69`) stays as a defensive invariant; (G-8) per-line tax from P0.19c's `spreadLineTaxes`; (G-14) invoice lines carry `unit_price_minor` from `LineView`; (G-1) `isFiscalized`; (G-27) `invoices.payment_class` may be `'mixed'` while compute returns cash or digital only — the close derives it; the `issued_at` (epoch ms) vs `switched_at` (`string \| null` on the wire) comparison is converted in one place | §6.12, §3.3, B12, B13, B15, B19–B21 | `…/commands/close-split.ts`, `apps/hub/test/billing/spike.int.test.ts` | #5, #6, #26–#36 (#26, #27, #28, #29, #30, #31, #32 (extended), #33, #34 (extended), #35, #36), **#74b**; #13b (close half), #69 (close-transaction half) | 16, 13, 14, 4b, P0.16, P0.17b, P0.19a, P0.19c | HIGH |
| | 18 | `WaiveBuyerId` (approvable) + buyer redaction everywhere (events, logs, alerts, audit, Z, hash, responses, print payload) | §6.11, B19, H-4, P-5 | `…/commands/waive-buyer-id.ts` | #42, **#42b**, #43 (CNIC and NTN) | 17, 9, P0.4b | HIGH (privacy) |
| | 19 | **`ReopenBill`** + kind `apply`: `BillReopened`, `InvoiceCredited` per sale invoice (credit series, outbox behind its original via 28a's `outboxRowFor`, `canCredit` from the original's snapshot), `OrdersUnbilled`, `SeatingReopened` for a full-edit dine-in reopen, corrections-only rules, `BillClosedEmpty` via the Q-7 hook, `BILL_REOPEN_NOT_SUPPORTED` | §6.13, §3.10, B14 | `…/commands/reopen-bill.ts` (+ its order-cancelled hook registration) | #37, #38, #39, #40, **#39b**, #44, **#44a, #44b, #44c, #44d, #44e, #44f, #44g, #44h, #44i, #44j, #44k, #44l**; #14 (credit-copies-rates half), #78, #78b (command halves) | 17, 9, P0.11, P0.13, P0.13b | HIGH |
| | 24 | 05's merge guard (`BILL_HAS_PAYMENTS` on merge and seating split) and line guard (`LINE_IN_CLOSED_SPLIT`, 1 statement) | §3.9, B15, T-1, Q-3 | `…/lanes/guards.ts` | #32 (extended), #56, #57 | 17, P0.11, P0.14 | HIGH (races) |
| **P** print docs | 4a | *Done in phase 0a (§2A.3)* | | | | | |
| | 4b | QR block (row P-3) in the receipt / reprint after `FiscalNumberAssigned`; the buyer placeholder `{ fill: 'buyer_id', ref, last4 }` (row P-5) in the receipt. ⚠️ P0.G: (R-11, G-2) the doc builder takes the **fiscal state** (pending / acked / rejected) and prints "FISCAL NUMBER NOT ISSUED" for a `rejected` invoice (receipt and reprint); (G-24) **inclusive mode**: a memo tax block so inclusive lines visibly add up, service-charge taxes from `spreadLineTaxes` (P0.19c) — not an issue for the exclusive pilot; (G-25) the check bill's digital total from `totals_default_digital` (P0.19d; `CheckBillDocInput.digital_total_minor`); (G-9) `ReceiptDocInput` takes `DocPayment[]` with a joined `mode_name`, `ReportDocInput` names embedded in the Z event, `tax_profile_id` prints raw, input types stay docs-local | §3.16, B19, B21, P-3, P-5 | `packages/domain/src/billing/docs.ts` | #34 (extended), #61 (QR half); ⚠️ P0.G: a `rejected` invoice reprint shows "FISCAL NUMBER NOT ISSUED" and never "PENDING"; inclusive memo block adds up; digital line from `totals_default_digital` | 4a, P0.17, P0.17b, P0.19a, P0.19c, P0.19d | NORMAL (privacy check by the reviewer) |
| | 11 | `PrintCheckBill` + live-only `BillRequested` fold → bill printer of the zone / floor | §6.3, §6.4, B17 | `…/commands/print-check-bill.ts`, `…/print/folds.ts` | #58, #59 (extended) | 4a, 10, P0.16 | NORMAL |
| | 27 | `PrintBillDocument` (receipt / credit note reprint rebuilds the full ID from `invoice_buyers` only for that customer's receipt), `RetargetBillPrint`; ⚠️ G-28 (R-27, 05 v1.0.5): `GET /queries/bill-printers` (`take-order`, any grant, as `RetargetBillPrint`; active printers `{ printer_id, name }` by name, 1 statement) | §6.22, §6.23, §6.23a, B18 | `…/commands/print-docs.ts`, `…/queries/bill-printers.ts` | #60, #61 (extended), #60b | 17, 4b, P0.17, P0.17b | HIGH (print retry, privacy) |
| **F** fiscal | 28a, 29a | *Done in phase 0a (§2A.3)* | | | | | |
| | 29b | Worker's real seams: `loadSubmission` from `InvoiceIssued` / `InvoiceCredited` + `invoice_buyers` (a credit reads its original's row) + `fiscal_credentials`; `onAnswer` writer tx appending `FiscalNumberAssigned` / `FiscalSubmitRejected` and moving the row (`acked` / `rejected`); crash between answer and commit → one `FiscalNumberAssigned`. ⚠️ P0.G: (G-6) payments per submission are joined from `PaymentAdded` / `bill_payments` **by `payment_id`, regardless of `removed_at`** (the invoice carries only `payment_ids`; `bill_payments.invoice_id` is cleared on reopen, so never by `invoice_id`); (G-5) `tax_minor` = Σ invoice tax rows incl. service-charge taxes; (G-7, G-4) `pos_id` and `authority_code` pass as null (P0.19b); (G-1) `isFiscalized` | §3.15, B20, B21 | `…/fiscal/worker.ts` | #70 (extended: one event in the log), #71 re-run end to end; ⚠️ P0.G: a removed payment still joins; a reopened bill's payments still join; `tax_minor` = Σ tax rows | 29a, 5, 7, P0.18, P0.19b | HIGH |
| | 31 | Stuck alert (dedupe, re-raise after day close), `fiscal-status`, `RetryFiscalNow`. ⚠️ P0.G: (G-22) the stuck alert is raised and re-raised by a **01d tick** (`registerTick`, the `kds/ticks.ts` pattern) registered from `status.ts` — the worker has no alert hook (`FiscalWorkerDeps` has none, `startFiscalWorker` returns only a stop); spec text "the tick re-raises" (05 v1.0.2); (G-12) `RetryFiscalNow` **does not await `runOnce`**: it sets `next_try_at = now` and the 1 s loop picks it up (no wake API) | §6.27, §6.28 | `…/fiscal/status.ts` | #73, #72 (`RetryFiscalNow` half), #77 (captured logger) | 29b, 9 | HIGH |
| | 31a | `SetFiscalToken` (admin, `manage-fiscal-settings`, write-only, `fiscal_credentials`, `FiscalTokenSet` ids only, `hashOmit: ['token']`) + the `/admin/fiscal/` page body (one write-only field per `pos_id` × credential name) | §6.28a, B22, H-2 | `…/fiscal/credentials.ts`, `apps/client/src/features/admin/fiscal/` | #81 | 28a, P0.4b, P0.5 | HIGH (secrets) |
| **PRA** (gated) | 30 | PRA adapter complete per Appendix P on top of 30a: every `TODO(STOP)` resolved from the answers, registration line, answer shapes from PRA spec v1.2, recorded fixtures. **STOP until A13 and A14 are answered and PRA's "Technical Specification Software Fiscal Device v1.2" is in the repo** (owner tasks O1, O2); any field the document leaves unclear is a STOP to the owner, never a guess. No network in the gate; sandbox = manual check M2. ⚠️ P0.G: (R-9, G-4) a null `authority_code` → `rejected` `mode_unmapped` (the adapter owns the mapping); (G-5) `TotalTaxCharged` from the submission's `tax_minor` (Σ invoice tax rows incl. service-charge taxes); (G-27) PRA is not registered before this task, so earlier tests must not expect it | Appendix P, §P.5 | `…/fiscal/pra.ts`, `apps/hub/test/billing/fiscal/fixtures/` | **P-T1**, **P-T2** (complete), #75, #76; #69–#78b re-run against this adapter | 30a, 29b, O1, O2 | HIGH |
| **A** audit | 32a | Audit maps of 05-1's events through `registerAuditAction` + the seven request actions (`registerRequestAction`); no buyer data in `detail_json` (PL-3, H6-14: ships with the 05 migration's checkpoint delete) | §6.30, V-3 | `…/audit-map.ts` (05-1 entries) | #87 (05-1 events) | 6, P0.15 | NORMAL |

**05-1 hub: 0a (1, 2, 3a, 4a, 5a, 6a, 28a, 29a, P0.3a, P0.9a, 30a, P0.Sa) + 0b base (5, 6, 7, P0.F, P0.Sb) + lanes (3b, 4b, 8, 9, 10–20, 24, 27, 29b, 31, 31a, 30, 32a).**

### 3.1 05-1 client (staff entry, ui-kit, R5) — BLOCKED on `docs/design/handoff/05/` (except 43a)

⚠️ P0.G (G-26): the client lanes use **all three** `ORDER_FRAMES` lists (`OpenOrders.tsx`, `table-view/refetch.ts`, `map/map-store.ts`) and the audiences P0.13 registers for `OrdersUnbilled`, `LineCompRemoved`, `OrdersCarriedOver`; a new frame type is added to every list or a test says why not.

| Lane | Task | What | Files | Spec / tests | Needs | Tier |
|---|---|---|---|---|---|---|
| **C1** | 34 | Cashier open-bills list (check-bill-printed status, open-bill flag) | `apps/client/src/features/billing/` | §8; client tests | 10, handoff | NORMAL |
| | 35 | Bill screen + **payment pad** + tendered / change, dues per type, refund dues, `expected_total_minor`; retry keeps the same `command_id` (handbook §10) | same | §8; #22 / #23 client halves | 16, 17, handoff | **HIGH** (money; re-tiered from "screens", handbook §4) |
| | 36 | Split editor | same | §8 | 12, handoff | NORMAL |
| | 37 | Discount / service charge / buyer sheets (buyer ID never stored in IndexedDB or logs; cleared after send) | same | §8, B19 | 13, 14, 18, handoff | NORMAL (privacy check by the reviewer) |
| | 38 | Print status + Print to; ⚠️ G-28 (R-27, 05 v1.0.5): the picker lists printers from `GET /queries/bill-printers` (§6.23a, built in 27) | same | §8, §6.23a, B18; #60b client half | 27, handoff | NORMAL |
| | 43a | i18n keys EN / UR for every §9 code and kind label of 05-1 (not blocked) | `apps/client/src/i18n/` | §9, §8 | 5, 9 | NORMAL |

---

## 4. Phase 05-2 — shifts, petty cash, drawer, day close, X / Z (spec §11: 21–23, 25, 26, 32, 33)

Opens when 05-1's hub tasks are merged and CI on `module-05` is green (05-1 checkpoint on the board).

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| **S** shifts | 21 | `CountShift` (counts **and closes**, frees the drawer; variance above threshold raises `shift_variance` sign-off), `CloseShift { skip_count }` (`skip-blind-count`, audited), `HandoverCount` | §6.17–§6.19, B23 | `…/commands/shift-close.ts` | #46 (extended), #50, #51, #52, **#50b**, **#50c**, #53b (extended) | 15, 9 | HIGH |
| | 22 | `RecordPettyCash` (advance / out / in, limit or `requires_approval` → `petty_cash` request), `SettlePettyAdvance` | §6.20, B24 | `…/commands/petty-cash.ts` | #53, #54, #53b (extended) | 15, 9 | HIGH |
| | 23 | `OpenCashDrawer` (no-sale, reason, audited; drawer kick job) | §6.21 | `…/commands/open-cash-drawer.ts` | #55 | 15, P0.16 | HIGH |
| **Z** day close + reports | 26a | Pure `buildReport` (Z = Σ sale − Σ credit; tax by tax code, profile, class; rounding its own line; voids by disposition; shifts float / expected / counted / variance / sign-off; brought / carried forward by mode); its result is assignable to 4a's report-doc input. *PL-2: before 25, whose appender calls it (§6.25)* | §6.26, B26 | `packages/domain/src/billing/report.ts` | **#66**, #67 | 8, 17, 19, 21, 22 | HIGH |
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
| Z1 | Acceptance map on the board: every story AC, §12.2 row and §10 test → green test name (both halves of every split test); §12.7 gaps listed "not built"; cleanup entries fixed or listed | all hub tasks | integrator |
| Z2 | Write `docs/plans/05-manual-checks.md` from §8 | Z1 | integrator (Sonnet) |
| Z3 | Sync `main` into `module-05` (handbook §7.2) if `main` moved; release branch `merge/05-to-main` (§7.1, both checks); PR into `main` with green CI; **owner merges**; then the full gate on a clean `origin/main` worktree (§12) and any `fix/…` PR. **One release after 05-2** (D-4) | Z1 | integrator, owner |
| Z4 | README row 05 Status → IMPLEMENTED on `main` with PRs, board, e2e doc (handbook §13) | Z3 | integrator |

---

## 6. Lane launch schedule

| Step | Open | When | Agents |
|---|---|---|---|
| **0a-0** | Integrator: P0.B, task 1 | G0.1 (#219 on `main`) | integrator + 1 Sonnet implementer + 1 Sonnet reviewer |
| **0a-1** | **L-MONEY** (P0.3a → 2 → 3a), **L-FISCAL** (5a, 6a → 28a → 29a), **L-PRINT+SETTINGS** (P0.9a, then 4a once 2 and 5a are merged or stacked), **L-PRA-SKELETON** (30a, once 28a is merged or stacked; optional) — all at once, prompts in `05-parallel-prompts.md` | P0.B done (stack on task 1 if it is not merged yet) | no cap (D-7): 4 implementers + their reviewers |
| **0a-2** | Integrator: **P0.Sa** | 2, 4a, 6a, 28a, 29a, P0.9a merged | integrator + 2 Opus reviewers |
| **0b-0** | G0.2–G0.4, P0.1, P0.G, **P0.1b** (05 v1.0.2), P0.2a–k (one Sonnet implementer + one Sonnet reviewer at a time; the bumps wait for P0.1b) | `module-deeplinks` on `main` (0a may still be running) | ≤ 4 from here (W-4) |
| 0b-1 | U0 and U2 (HIGH-heavy: one implementer each, reviews take the other two slots), then U1 and U3 as slots free; ⚠️ P0.G: P0.3c after P0.2a, integrator rows P0.19a–d after P0.1b (HIGH, one at a time) | each row's P0.2 bump merged | ≤ 4 |
| 0b-2 | 05 base 5 → 6 → 7 → **P0.18** (⚠️ P0.G G-21: after 7) → P0.F → **P0.Sb** (integrator + reviewers) | P0.3c, P0.19a–d merged, P0.Sa green | ≤ 4 |
| 3 | K (9), S (8), F (29b), P (4b) | P0.Sb green | ≤ 4 |
| 4 | B1 (10 → 12 → 13 → 14 → 20), S (15), P (11) | 7 merged (10); 8 merged (15); 10 merged (11) | ≤ 4 |
| 5 | B2 (16 → 17 → 18 → 19 → 24), F (31 → 31a), P (27), A (32a), C1 43a, then T (3b) | 12 + 15 (16); 17 (18, 19, 24, 27); 24 (3b) | ≤ 4 |
| 6 | PRA (30) | A13 + A14 answered, PRA spec v1.2 in the repo (O1, O2); 29b merged | ≤ 4 |
| 7 | 05-1 checkpoint → S (21, 22, 23), Z (26a → 25 → 26b), A (32b → 33) | 05-1 hub merged, CI green | ≤ 4 |
| 8 | C1 / C2 screens | `docs/design/handoff/05/` exists | ≤ 4 |
| 9 | Close-out | all of the above | — |

Critical path: G0.1 → P0.B → 1 → 2 → P0.Sa ‖ G0.2 → P0.1 → P0.1b → P0.2 → P0.3c / P0.11 / P0.12 / P0.13 / P0.14 / P0.19a–d → base 5 → 6 → 7 → P0.18 → P0.Sb → 10 → 12 → 13 → 16 → 17 → 19 → 26a → 25 → 26b → Z1 → Z3. 0a takes the money core, the fiscal core and the documents off the critical path: once G0.2 holds, only the bumps and the base stand between `module-deeplinks` and the command lanes.

**Batches:** each lane works in batches of about 5 tasks (B1, B2 are exactly 5); after a batch the integrator updates the board and runs a checkpoint: §12.2 rows of the batch, statement counts, the acceptance-map rows turning green.

---

## 7. Test coverage — closing check (spec §11, H18-2; repeated here before the first build batch)

Every §10 test is in at least one task; a test listed in several is **written in the first** and extended later; ranges cover only unlettered numbers, lettered tests are named. A test split by phase (0a half / later half, PL-16) is written in the 0a task and extended by the later one; both halves are on the acceptance map.

- **Unlettered 1–91:** 1–4 → 10; 5, 6 → 17; 7–9 → 12; 10–16 → 2 (10, 11, 15 also 3a; 13 extended in 17 (13b close half); 14 extended in P0.9b, 19; 15 extended in P0.9b; 16 extended in 13); 17 → 13; 18, 19 → 14; 20 → 2, 4a; 21–25 → 16 (23 first in 3a, extended in 3b); 26–36 → 17 (32 first in P0.14, 34 first in 4a, extended in 4b); 37–40 → 19; 41 → 20; 42, 43 → 18; 44 → 19; 45, 46 → 15 (46 extended in 21); 47 → 8; 48, 49 → 16; 50–52 → 21; 53, 54 → 22; 55 → 23; 56, 57 → 24; 58, 59 → 11 (59 first in 4a); 60 → P0.17, 27; 61 → 4a, 4b, 27; 62–65 → 25; 66, 67 → 26a (67 extended in 26b); 68 → P0.6; 69 → 28a, 17; 70 → 29a, 29b; 71 → 29a (re-run in 29b); 72 → 29a, 31; 73 → 31; 74 → 28a; 75, 76 → 30; 77 → 29a, 31; 78 → 28a, 19; 79 → P0.6, P0.11, P0.14; 80 → P0.4; 81 → 31a; 82 → P0.12; 83, 84 → P0.13; 85 → P0.16; 86 → P0.17; 87 → 32a, 32b; 88 → 7, 8; 89 → 9; 90 → P0.8; 91 → 10 (every query task asserts its own count).
- **Lettered:** 5b → 10; 10b, 10c, 10e, 10f → 3b; 10d → 3a; 11b → 2; 11c → 3a; 13b → 2, 17; 14b → P0.9b; 14c → P0.3a, P0.9a, P0.9b; 15e → 3a; 16b, 16c → 3a, 3b; 20b → 2; 20c → 3a; 25b → 16; 37b, 37c, 37d, 37e, 37f, 37g, 37h → P0.11; 39b → 19; 42b → 18; 44a, 44b, 44c, 44d, 44e, 44f, 44g, 44h, 44i, 44j, 44k, 44l → 19; 50b, 50c → 21; 53b → P0.7; 63b, 63c, 64b → 26b; 74b → 17; 78b → 28a, 19; 83b → P0.13; 91b → 33; P-T1, P-T2 → 30a, 30.
- **#15b** is struck in v0.8.1 (§26, `pro_rata` removed) — no test (PL-6).
- Row-level tests the plan adds for rows §11 does not list: `[05 row H-4]` (P0.4b), `[05 row Q-7]` (P0.13b), `[05 row P-5]` (P0.17b); plus `[05 spike-0a]` (P0.Sa) and `[05 spike]` (P0.Sb, re-run by 17). ⚠️ P0.G (2026-11-19) adds `[05 P0.G G-n]` row tests: P0.3c (codes = §9), P0.19a (`isFiscalized` table; outbox and docs agree), P0.19b (nullable `authority_code` / `pos_id`), P0.19c (`spreadLineTaxes` non-even + discount), P0.19d (`totals_default_digital`), P0.12 (`unit_price_minor` folded; under #82), P0.5 (nav not fail-open), P0.7 (AlertRaised v4 → v5 upcast), P0.15 (labels en / ur), P0.Sb (invoice and outbox atomic in the real fold); task 4b extends #34 / #61 ("NOT ISSUED", inclusive memo, digital line), task 5 (refine, null `receipt_fiscal`), 29b (join by `payment_id`), 31 (tick, `RetryFiscalNow`), 17 (null `pos_id` refused). No §10 test moves.

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

Plan: `05-plan.md`. Prompts: `05-parallel-prompts.md`. Gaps: `05-gaps.md`. Spec: `05_Billing_Spec_v1.0.md` (`v1.0.1` after P0.1, `v1.0.2` after P0.1b). Integration branch: `module-05`. Cleanup: `05-cleanup.md`.

> **Status (owner summary, Hinglish, newest first):**
> - <date>: …

## Gates
| Check | State |  (G0.1 spec-05 on main · G0.2 module-deeplinks on main · G0.3 claims scan with the numbers found · G0.4 main synced into module-05)

## Owner rulings on how the build runs
W-1…W-6 as `04-status.md`, for `module-05`; W-4: phase 0a no agent cap (owner 2026-11-18, D-7), ≤ 4 at once from phase 0b unless re-ruled; W-6: HIGH = 2 fresh Opus reviewers, money MINORs fixed before merge. Plan decision log D-1…D-8 (`05-plan.md` §0).

## Owner rulings on the spec during the build
| # | Ruling | When | Where it landed |

## Phase 0a (05's own work)
| Task | Lane | Tier | Needs | Branch | PR | Reviewers (R1 / R2 verdict) | State |   (P0.B, 1, P0.3a, 2, 3a, 5a, 6a, 28a, 29a, 4a, P0.9a, 30a (optional), P0.Sa)

## Phase 0b (bumps, base, spike)
| Task | Lane | Tier | Needs | PR | State |   (P0.1, P0.G, P0.1b, P0.2a–k, P0.3b, P0.3c … P0.18 incl. P0.4b / P0.9b / P0.13b / P0.17b, P0.19a–d, 5, 6, 7, P0.18, P0.F, P0.Sb)

## 05-1 lanes
| Lane | Task | Tier | Needs | PR | Reviewers (R1 / R2 verdict) | State |

## 05-2 lanes
| Lane | Task | Tier | Needs | PR | Reviewers | State |

## Client
| Lane | Task | Tier | Blocked on | PR | State |

## Owner tasks and manual checks
| # | Task | State |   (O1–O9, M1–M8)

## STOPs / needs-ruling
| # | Task | Finding | Options + Rec | State |   (PRA task 30 starts here as "waiting A13 / A14 / PRA spec v1.2"; 30a TODO(STOP) items listed here when its PR merges)

## Readings (AD rows; IR-n numbers continue from the last board, handbook §11)
| AD | Reading | Status (proposed / ruled) |   (PL-0 … PL-20 seeded from the plan)

## Acceptance map (Z1)
| §10 test | Task (half) | Test name | State |
```

---

## Gap sweep patches (P0.G, owner ruling 2026-11-19 — every Rec; `docs/plans/05-gaps.md`)

Lanes read `05-gaps.md` for exact names and file:line, and these rows as part of their task. Each patched row carries the marker "⚠️ P0.G (G-n)". "lands in:" = the gaps doc names the task but not the exact line; the row says where it was put.

| G-row / ruling | Rows patched | What changed in the plan |
|---|---|---|
| R-1 (Q-A a) | P0.1b | 05 v1.0.2 §3.3 3a / §3.4: `'service_charge'` id, `tax_unresolved` block (code #284 exists in `compute.ts`) |
| R-2 (Q-B a) | P0.1b | 05 v1.0.2 §3.5 (2) note (±1 minor unit after a sibling close) |
| R-3 (S-1 a) | P0.2c | A-1 (3) wire names in the 01a v2.6 row |
| R-4 (S-2 a) | P0.1b | §4.4 comment "⇔" → "⇒" |
| G-1 / R-8 | P0.1b, **P0.19a**, 5, 10, 17, 29b, 4b | one `isFiscalized`; task-5 refine; §6.12 step 7 "when fiscalized (§3.15)" |
| G-2 / R-11 | P0.1b, 4b | "FISCAL NUMBER NOT ISSUED"; builder takes the fiscal state |
| G-3 | P0.1b, 5, P0.9b | null `receipt_fiscal` → `receipt` with null label, empty lists; owned by P0.9b's mapper, task 5 validates only the non-null shape |
| G-4 / R-9 | P0.1b, **P0.19b**, 29b, 30 | `authority_code: string \| null`; adapter rejects `mode_unmapped` |
| G-5 | P0.1b, 29b, 30 | `tax_minor` = Σ invoice tax rows incl. service-charge taxes |
| G-6 | P0.1b, 29b | §5 `doc_json` comment; join by `payment_id`, regardless of `removed_at` |
| G-7 | P0.1b, **P0.19b**, 29b | `pos_id` nullable on the port; no `?? ''` |
| G-8 | **P0.19c**, 17, 4b | `spreadLineTaxes` (non-even fixture + discount); task 17 uses it. weights = line net (J-2); service-charge taxes stay in `service_charge.taxes`; an inclusive-mode or compound-base point the spec does not answer is a STOP |
| G-9 | P0.1b, 5, 4b | 05 v1.0.2 §6.25 / §6.26: Z `report` embeds `mode_name` (takings) and `category_name` (petty), staff ids only (H16-5); task 5 test narrowed to "no staff or buyer name field"; 4b: `DocPayment[]` with `mode_name`; types stay docs-local |
| G-10 | P0.Sb | invoice + outbox atomic in the real fold |
| G-11 / R-13 | P0.1b, P0.9b, 17 | config rule: adapter ≠ `none` needs `default_pos_id` (`CONFIG_REFERENCE_INVALID { field: 'fiscal.default_pos_id' }`); task 17 keeps `outboxRowFor`'s throw as an invariant, no command refusal code |
| G-12 | 31 | `RetryFiscalNow` sets `next_try_at = now`, no `runOnce` await, no wake API |
| G-13 / R-6 | header, P0.1 note, P0.1b, P0.8, P0.9a text, P0.9b, global rule | cloud 0016 / 0017 → **0014 / 0015** everywhere |
| G-14 / R-7 | P0.2g, P0.12, 10, 17 | `order_lines.unit_price_minor` + `LineView.unit_price_minor` (0021, folded from `ItemAdded`) |
| G-15 | **P0.3c**, §3 header, 10 | §9 codes appended to `errors.ts` after P0.2a, before task 10; every command task needs P0.3c |
| G-16 | P0.7 | `AlertRaised.v5` + identity upcaster, `AlertRequestPart`, `mayAnswer`, `raise.ts` |
| G-17 | P0.5 | file list (client-dist, server.ts, vite, package.json, `admin-fiscal/index.html`, tests); nav not fail-open |
| G-18 | P0.6, P0.11, P0.14 | guard files in `voids/` and `tables/contracts.ts`; `registerDayCloseGuard` list; reset name (lands in: P0.6) |
| G-19 | P0.15 | `registerRequestAction`, `AUDIT_ACTIONS`, client `labels.ts`, en / ur labels, audit query |
| G-20 | 7, P0.15, P0.7, P0.18 | module-load registration for actions / kinds; projection in `registerHubProjections` |
| G-21 | P0.18, 7, §2B.5, §6, PL-21 | P0.18 after task 7 via `startBillingWorkers(deps, log)` |
| G-22 | P0.1b, 31 | stuck alert by a 01d tick; spec "the tick re-raises" and test #73 reworded |
| G-23 / R-10 / R-14 | P0.1b, P0.9b, P0.10 | defaults lists (R-10); `invoice_prefix` / receipt header / footer empty, other defaults per A-1 (3) (R-14); `none` rate rows; `tax_class_id` → `tax_profile_id` |
| G-24 | 4b | inclusive-mode memo tax block |
| G-25 | **P0.19d**, 4b | `totals_default_digital` |
| G-26 | P0.13, §3.1 client note | three audiences; three `ORDER_FRAMES` lists |
| G-27 | 5, 17, P0.8, P0.17, 30 | `service_charge` nullable; `'mixed'` class, `switched_at` conversion; idempotent B-2 backfill; `renderText` imports; PRA not registered before 30 |
| R-12 | P0.1b | the spec-text Recs above go into 05 v1.0.2 |
| R-13 | P0.1b, P0.9b, 17 | see G-11 |
| R-14 | P0.1b, P0.9b | see G-23 |

R-5 is a board ruling about the integrator rebasing stopped lanes; it is not a P0.G ruling.

## 10. Plan readings (PL — copied to the board as AD rows, status `proposed` until the owner confirms)

| # | Reading | Why |
|---|---|---|
| PL-0 | Spike is a plan gate though spec and handbook name none — **ruled (D-2, Q-P1 (a))**; now two halves (PL-19) | owner requirement "spike first if called for"; 04 G1-8 precedent |
| PL-1 | §4.5 rows **H-4, Q-7, P-5** have code but no §11 phase-0 task → P0.4b, P0.13b, P0.17b, HIGH, before the tasks that use them (18, 19, 27) | DoD §12.1 (1): every §4.5 row applied with its test |
| PL-2 | Spec task 26 is split: **26a** `buildReport` before task 25 (whose appender calls it, §6.25), **26b** queries + print fold after 25 (its tests #63b, #63c, #64b need `CarryOverOrders`) | dependency inside §11; no behaviour change |
| PL-3 | Spec task 32 split into **32a** (05-1 maps, with the 05 migration) and **32b** (05-2 maps) | spec §11 H6-14 says so |
| PL-4 | Spec tasks 5, 6, 7 and the fixtures are integrator work in phase 0b (shared files); task 1 moved to 0a (PL-16) | 03b / 04 "phase 0 writes every shared file once" |
| PL-5 | Kinds (task 9) call an exported `apply` of each command's file, `not built` until that task | 04 P0.7 seam pattern; one owner per file |
| PL-6 | #15b is struck (v0.8.1 §26) and has no test | spec text |
| PL-7 | Letter ranges in §11 (#37b–#37f, #44a–#44l) are expanded to named tests | H18-2 "lettered tests are always named" |
| PL-8 | Agent cap: **phase 0a none** (D-7, "for now"); "≤ 4 agents" from 0b counts implementers + reviewers; the integrator is not counted | owner usage rule; correct on the board if meant otherwise |
| PL-9 | 01d v1.3.1 / v1.3.2 already exist on `module-deeplinks`; P0.1 re-takes 01d (and any number `main` moved) without a STOP | H5-1, G1 §13 |
| PL-10 | Task 35 (payment pad) is HIGH, not NORMAL "screens" | handbook §4: tier from what the diff can break (money, queue retry) |
| PL-11 | Phase-0b merge order follows §11 P0.3–P0.18 except P0.7 before P0.5 / P0.6 and P0.17 before P0.10 | P0.5 / P0.6 need B-1's `manage-fiscal-settings` / `close-business-day`; P0.10 needs `renderText` in `@pos/domain` |
| PL-12 | Settings / admin UI (P0.5 shell, P0.6 Stock text, P0.10 Billing page, P0.16 Bill printers section, 31a fiscal page) is built on the existing admin / owner page patterns without a 05 design handoff; staff screens 34–42 wait for it — **ruled (D-3, Q-P2 (a))** | owner |
| PL-13 | **Staged fiscal DDL (6a).** The hub runner refuses non-sequential migration numbers (`apps/hub/src/db/migrate.ts:97`) and 0021 / 0022 are 0b rows, so 0a cannot add the 05 migration. 6a writes §5's `fiscal_outbox` / `fiscal_credentials` DDL verbatim into `apps/hub/src/billing/fiscal/outbox-ddl.sql`, which no runner reads; L-FISCAL's tests apply it after `migrate()`; task 6 copies it verbatim into the 05 migration and deletes it. Nothing reaches a real hub database before task 6 | owner D-6 ("05's outbox table/migration, 05-owned") with the runner's rule; §5 unchanged |
| PL-14 | **0a code ahead of its text bump.** P0.3a (`currencyExponent`, row F-6) and P0.9a (new files of rows A-1 / A-2: seeds constant, adapter settings schemas, wire shapes, `defaults.ts`) are **new files no other module reads** and land on `module-05` before P0.2a / P0.2c write the Foundation / 01a text. Nothing reaches `main` before those bumps (one release, D-4). If a bump's re-read of `main` finds a clash, it is the normal P0.2 STOP and the 0a file follows the bumped text in P0.3b / P0.9b | owner D-6 puts currency exponent and the 05-owned settings shapes in 0a; CLAUDE.md spec-first is kept for everything `main` sees |
| PL-15 | **Task 3 split:** 3a (pure, 0a) by a fresh implementer subagent inside L-MONEY that did not write task 2 and reads only the spec and `compute.ts`'s exported signatures; 3b (command halves) in lane T by a session that wrote none of 2, 12, 16, 17, 24 | the 04 / plan credibility rule; owner put "the §10 property tests" in L-MONEY |
| PL-16 | **a / b splits by what needs 0b:** P0.3 → P0.3a / P0.3b; P0.9 → P0.9a / P0.9b; 3 → 3a / 3b; 4 → 4a (no QR / filler block: they change 03c's `DocBlock`, rows P-3 / P-5) / 4b; 5 → 5a (TS snapshot types) / 5; 6 → 6a / 6; 28 → 28a (its command halves of #69 / #78 / #78b extend in 17 / 19); 29 → 29a (seams `loadSubmission` / `onAnswer`) / 29b; 30 → 30a / 30. Task 1 moved to 0a. Every split keeps its §11 task number; no test changes scope | owner D-5 / D-6; traceability to §11 |
| PL-17 | **30a under Appendix P.5.** P.5 says task 30 does not start until A13 and PRA v1.2; the owner (D-6) allows a skeleton now. Read as: 30a is unregistered mapping code limited to what Appendix P settles, every other field a `TODO(STOP)`; task 30 (registration, the rest, complete P-T1 / P-T2) keeps the P.5 gate. If the owner wants the spec to say so, 05 v1.0.2 adds a marker at P.5 | owner D-6 vs spec P.5 — needs the owner's confirmation on the board |
| PL-18 | P0.18 no longer writes a stub `worker.ts`: 29a owns that file and exports `startFiscalWorker(deps)`; P0.18 edits only `lib/boot.ts` | one owner per file |
| PL-19 | **Spike halves:** P0.Sa (0a, §2A.4) gates the 0b base; P0.Sb (0b, §2B.6) gates every command lane; P0.Sb keeps only the close transaction in-test, and task 17 switches it to the real `CloseSplit` | owner D-2 + D-5 ("0b half: real `CloseSplit` end to end") |
| PL-20 | Lane branches `lane-05<L>/05-<task>` (owner D-8 example `lane-05M/…`), replacing `lane-<L>/05-<task>` | handbook §3 naming, owner D-8 |
| PL-21 | ⚠️ P0.G (G-21): **P0.18 runs after task 7** and calls task 7's `startBillingWorkers(deps, log)`; before task 6 / 29b the worker has no table or no real seams | `05-gaps.md` G-21, owner R-12 |
| PL-22 | ⚠️ P0.G: new rows **P0.1b** (05 v1.0.2), **P0.3c** (errors.ts, G-15), **P0.19a–d** (0b follow-ups on merged 0a files: `isFiscalized`, nullable port fields, `spreadLineTaxes`, `totals_default_digital`) | owner rulings R-1…R-12; CLAUDE.md spec-first order |

## 10a. Plan questions — answered

Q-P1 → (a) keep the spike gate (D-2); Q-P2 → (a) settings / admin pages on existing patterns (D-3); Q-P3 → (a) one release after 05-2 (D-4). Open for confirmation on the board: PL-13 – PL-20 (especially PL-14 and PL-17).

## 11. Definition of Done (per lane, on top of spec §12.1)

Every lane task is done when: (1) the failing-first test output is in the PR body; (2) its §10 / row tests pass in CI on `module-05`; (3) every command it adds has happy path, one test per error code, retransmit with the same `command_id`, every grant state; every query its fixed statement count at 1 and 40; (4) its reviewers' BLOCKER / MAJOR are closed (mutation-verified) and, for money, every MINOR is fixed; other MINORs are in `05-cleanup.md`; (5) no buyer ID, token, PIN, name, phone or free text in a log, event, hash or response (captured-logger tests where the task logs); (6) it registered only its own lines in `billing/index.ts` (0a: only its own `export *` lines in the barrels); (7) the board row says `merged` with the commit.

- **Phase 0a:** P0.B, 1, P0.3a, 2, 3a, 5a, 6a, 28a, 29a, 4a, P0.9a merged; no file outside the lane lists touched; P0.Sa green; 30a merged or still open with its TODO(STOP) list on the board.
- **Phase 0b:** every §4.5 row applied with marker, version and test; P0.1b, P0.3c, P0.19a–d merged (⚠️ P0.G); README R37 / R38 / row 05; the staged DDL gone into the 05 migration; P0.Sb green.
- **05-1:** rebuild of `billing`, `shifts` (open slice), `audit` from seq 0 equals live (#88, #87); a bill can be opened, split, discounted, paid, closed, reopened and credited under `PK` and the fake adapter; the outbox drains with the fake adapter; the spike runs on the real `CloseSplit`; PRA either merged (A13 / A14 answered) or on the board as a STOP with the branch planned on `PK`.
- **05-2:** day close refuses open shifts and unbilled orders, carries listed orders, issues the Z in the close transaction; Z identity property green (#66); every 05 event has an audience and an audit map (#91b, #87).
- **Module:** spec §12.1 1–6, handbook §13 close checklist, manual checks M1–M8 done on the pilot hardware or the branch on `PK`.

## 12. Self-review (writer, 2026-11-18; 0a / 0b update same day)

- **Coverage:** §11 P0.1–P0.18 → P0.1, P0.2a–k, P0.3a / P0.3b, P0.4–P0.8, P0.9a / P0.9b, P0.10–P0.18; hub 1–33 + 31a → 0a (1, 2, 3a, 4a, 5a, 6a, 28a, 29a, 30a), base (5, 6, 7), M (2, 3a), T (3b), P (4a, 4b, 11, 27), S (8, 15, 21–23), K (9), B1 (10, 12–14, 20), B2 (16–19, 24), Z (25, 26a / 26b), F (28a, 29a, 29b, 31, 31a), PRA (30a, 30), A (32a / 32b, 33); client 34–43 → C1, C2; close-out 44–46 → §5. §7 shows every §10 test in a task, split tests in both halves.
- **0a touches no other module:** every 0a file is new and under 05's paths (`packages/domain/src/billing/`, `packages/domain/src/currency.ts`, `packages/events/src/admin/{billing,jurisdiction-seeds}.ts`, `packages/events/src/admin/fiscal-adapters/`, `apps/hub/src/billing/`, `apps/hub/test/billing/`), plus one-line barrel exports; the forbidden list in §2A.3 names the rest.
- **No shared file in two lanes:** types and barrels are task 1's; `compute.ts` / `currency.ts` are L-MONEY's; `fiscal/{port,none,outbox,worker}.ts`, `outbox-ddl.sql`, `fiscal-snapshot.ts` are L-FISCAL's; `docs.ts`, the admin shapes, `defaults.ts` are L-PRINT+SETTINGS'; `pra.ts` is L-PRA's; events, the 05 migration, the `billing` projection, `index.ts` creation, fixtures are 0b base; `kinds/` is K only; `index.ts` lines are append-only per task.
- **HIGH everywhere money, close, outbox, shifts, day close, adapter, reopen / tables, buyer privacy, approvals and print retry move;** NORMAL only for settings shapes, seeds, docs builders, audit maps, text and screens (bar the pad).
- **Known gaps** (§12.7, §12.4, §1.3, `pro_rata`) excluded by a global rule.
- **P0.G patch (2026-11-19):** the gap sweep rows are patched into the rows above (marker "⚠️ P0.G (G-n)") and listed in "Gap sweep patches (P0.G …)"; new rows P0.1b, P0.3c, P0.19a–d; P0.18 moved after task 7; cloud migrations are 0014 / 0015.
