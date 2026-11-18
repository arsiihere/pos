# 05 — phase 0a: what to open and what to paste

Plan: `docs/plans/05-plan.md` §0 (decision log), §1 (global rules), §2A (phase 0a: lanes, file ownership, spike P0.Sa). Board: `docs/plans/05-status.md` (only the integrator edits it). Every session here is a **fresh claude.ai/code cloud session** on `arsiihere/pos`; the repo's SessionStart hook (`tools/cloud/session-start.sh`) starts Postgres on 5433 and runs `pnpm install`.

**Hand-off by PRs, not tags:** every lane pushes its own task branch `lane-05<L>/05-<task>` and opens a PR into `module-05` through `gh api` REST. The integrator merges green, reviewed PRs (rebase merge) and keeps the board. A lane that needs a ruling puts a STOP block in its PR body and the label `needs-ruling`; the owner answers in the GitHub app.

## Sessions

| When | Sessions open | What runs |
|---|---|---|
| G0.1 holds (#219 merged into `main`) | **1** | Integrator: P0.B, task 1 (§6) |
| P0.B done | **+3 (or +4)** | L-MONEY (§2), L-FISCAL (§3), L-PRINT+SETTINGS (§4); L-PRA-SKELETON (§5) optional, once 28a is merged or stackable |
| 2, 4a, 6a, 28a, 29a, P0.9a merged | integrator | P0.Sa (spike, 0a half) |
| `module-deeplinks` on `main` | integrator | phase 0b (`05-plan.md` §2B; prompts for 0b lanes are written then) |

Owner rule D-7: phase 0a has **no agent cap** — every lane runs at once with its own reviewer subagents. File ownership (plan §2A.3) is what keeps lanes from colliding.

---

## §1. Common lane rules (part of every lane prompt below)

```text
COMMON RULES FOR EVERY 05 PHASE-0a LANE (read fully before any code)

Repo arsiihere/pos, this checkout. GitHub only through `gh api` REST (never `gh pr create`, never GraphQL). Never `git stash`. Never push `main` or `module-05`; push only your own branch `lane-05<L>/05-<task>`; `git push --force-with-lease` only on your own task branches after a rebase. Never merge a PR yourself (the integrator does).

Read first: CLAUDE.md; docs/plans/integrator-handbook.md; docs/plans/05-plan.md §0, §1, §2A (your lane's ownership list and task rows), §7 (which test halves are yours), §10 (PL-13 – PL-20); docs/plans/05-status.md if it exists; then only the spec sections your task cites in docs/specs/05_Billing_Spec_v1.0.md. Do not read the whole spec.

Files: edit ONLY the files in your lane's ownership list (plan §2A.3), plus one `export *` line per module you add in packages/domain/src/billing/index.ts (and the one extra barrel line the plan names for your lane). Never edit packages/domain/src/errors.ts, packages/domain/src/print.ts, packages/events/src/{envelope,config,registry}.ts, anything under apps/hub/src/{orders,tables,alerts,print,voids,commands,lib,db}/, apps/cloud/, apps/client/ or docs/specs/. Needing one of them = STOP.

Build only what the spec and your task row ask. No new dependency (random tests use a seeded PRNG in the test file, as packages/engine/test/sim/generate.ts does; print the seed on failure). No pro_rata path; nothing from spec §12.4 / §12.7 (a) / §1.3.

TDD, one task at a time, in the order of your task list:
1. Branch: base = origin/module-05, or your previous unmerged task branch (stacked; the PR body says "Stacked on #<n>"). `git checkout -B lane-05<L>/05-<task> <base>`.
2. Write the failing test first. Test names cite the spec: it('[05 #20b] …'); a split test names its half, e.g. it('[05 #69 outbox-row half] …'). Run it and keep the failing output line for the PR body.
3. Implement until your tests pass: `TMPDIR=/dev/shm pnpm vitest run <your test files>` and the typecheck of the package you touched (`pnpm --filter <package> typecheck`, and `typecheck:tests` where it exists).
4. Before opening the PR run the full gate once, exactly:
   TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"
   Never run `pnpm test:perf`, printer / drawer / hardware checks, power-loss checks or any network call to an authority in this cloud session. Never stop or restart the test Postgres.
5. Money: integers only (minor units), BigInt wherever a product can pass 2^53; half-up only at the points the spec names. Privacy: no buyer tax ID, token, PIN, name, phone, note, paid_to or payment reference in any event, log, hash, error detail or fixture (PRA fixtures use the literal `test-token`).

Review (before the PR is opened; fixes squashed into the one task commit):
- HIGH task: two fresh Opus reviewer subagents, independent, each given the task row, the cited spec sections and `git diff origin/module-05...HEAD` (or the stacked base). Reviewer 2 focuses on money (BigInt, half-up points, Σ invariants), ordering / races, privacy, statement counts.
- NORMAL task: one fresh Sonnet reviewer subagent.
- Reviewers return BLOCKER / MAJOR / MINOR with file:line; "looks fine" is not a review. Fix rounds only for BLOCKER / MAJOR, at most 2; a re-check mutation-verifies each fixed MAJOR (break the line, see the test fail, restore). Both HIGH reviewers asking for changes (or one approve, one change) → the second approval is a fresh re-check reviewer who mutation-verifies every MAJOR. Money MINORs are fixed before the PR; other MINORs go in the PR body under "Cleanup candidates" (the integrator copies them to docs/plans/05-cleanup.md). A MAJOR still open after round 2 → STOP.

Commit (one per task, after review):
- Check first: `git diff --cached | grep -nE '/home/|/Users/|Bearer [A-Za-z0-9]{12,}'` must print nothing.
- `git -c user.name="Arslan Ahmed Arif" -c user.email=arsiiahmi@gmail.com commit` with message `feat(05): <title> [05 §x; §11 task N]` — it cites the spec sections — and the body ending with the line
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  (plus the Claude-Session line your session gives you, if it gives one).

Pull request (REST):
- `git push -u origin lane-05<L>/05-<task>`
- Write the body to a file under /tmp: spec sections; tests added with their failing-first output line; statement counts asserted (if any); Readings; "Needs: #…" / "Stacked on #…"; tier; review verdicts (R1 / R2, findings and how each MAJOR was closed); Cleanup candidates; any STOP block. The body ends with the line
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
- `gh api repos/arsiihere/pos/pulls -X POST -f title="<task>: <title> [05 §x]" -f head="lane-05<L>/05-<task>" -f base="module-05" -F body=@/tmp/pr-05-<task>.md`
- `gh api repos/arsiihere/pos/issues/<number>/labels -X POST -f "labels[]=lane:05-<L>" -f "labels[]=tier:<HIGH|NORMAL>"`
- Watch CI: `gh api "repos/arsiihere/pos/commits/<sha>/check-runs" --jq '.check_runs[]|.name+" "+.status+" "+(.conclusion//"")'`. A red gate is yours to fix (new commit squashed in, force-with-lease on your branch).
- Then go on with your next task (stacked if the previous PR is not merged). After a lower PR merges: `git fetch --depth 50 origin +refs/heads/module-05:refs/remotes/origin/module-05 && git rebase --onto origin/module-05 <old-base> <branch> && git push --force-with-lease`.

STOP rules (never a silent fix, never a guess):
- Spec and code disagree; two specs disagree; a name, signature, table or helper the task needs is not where the plan says; a file outside your ownership list must change; a contract, error code, migration or folder structure would change; a bound or behaviour the spec does not state → STOP.
- How: finish every clause that does not depend on it; put a STOP block in the PR body (what, spec section and code file:line, options, your recommendation), add the label `needs-ruling` (`gh api repos/arsiihere/pos/issues/<number>/labels -X POST -f "labels[]=needs-ruling"`), print the STOP block, and stop that task. Ask the owner; do not use an interactive question menu. Go on with your other tasks only if they do not depend on it. When the owner answers on the PR, finish and remove the label.

When every task of your lane has a PR open (or merged): print "LANE 05<L> DONE" with the PR numbers, readings for the board and review leftovers, and stop.
```

---

## §2. L-MONEY — lane `M` (HIGH, Opus)

Paste into a fresh session (Opus):

```text
You are lane 05M (L-MONEY) of the 05 Billing phase-0a build. Tier HIGH: you implement with Opus; reviewers are two fresh Opus subagents.

Setup:
  git fetch --depth 50 origin +refs/heads/module-05:refs/remotes/origin/module-05 +refs/heads/main:refs/remotes/origin/main
  git fetch --depth 50 origin "+refs/heads/lane-05I/*:refs/remotes/origin/lane-05I/*"   # task 1, if it is not merged yet
  git checkout -B lane-05M/05-p0.3a origin/module-05
  pnpm install --frozen-lockfile   # only if the SessionStart hook did not run it
Then read docs/plans/05-parallel-prompts.md §1 (common rules) — they are part of this prompt — and follow them exactly.

Your files (exclusive; nothing else): packages/domain/src/currency.ts, packages/domain/src/currency.test.ts, packages/domain/src/billing/compute.ts, packages/domain/src/billing/compute.test.ts, packages/domain/src/billing/compute.fixtures.ts, packages/domain/src/billing/compute.property.test.ts; plus one line `export * from './currency.js'` in packages/domain/src/index.ts and one line `export * from './compute.js'` in packages/domain/src/billing/index.ts.

Tasks, in order (plan §2A.3 L-MONEY):

1. P0.3a — F-6 code only [05 §4.5 F-6; §11 P0.3]: `currencyExponent(code)` from an ISO 4217 minor-unit table (PKR 2; test fixtures for exponent 0 and 3); an unknown code is refused (throws a typed error; no §9 code is added). Tests first: #14c exponent half. Do NOT touch envelope.ts or seed-tenant.ts (those are P0.3b in phase 0b). Branch lane-05M/05-p0.3a. Commit `feat(05): currencyExponent ISO 4217 table [05 §4.5 F-6; §11 P0.3a]`.

2. Task 2 — computeSplit / computeBill [05 §3.4–§3.8, B4–B10; §11 task 2]. Branch lane-05M/05-2 (base origin/module-05 once task 1 and P0.3a are merged, else stacked). Read §3.4, §3.5 (all rules, especially (2) discount spread, (5) higher_rate, (6) exact total G, (7) rounding adjustment, dues and refunds incl. H16-1, H17-1 and run-18 Q-1 "no due while balance ≤ 0"), §3.6, §3.7, §3.8, §4.4, §6.31 (worked example), and the v0.6.2 fixtures the Pakistan regression needs (docs/specs/05_Billing_Spec_v0.6.2.md, the compute fixtures and §3.6 examples only).
   - Declare plain input types in compute.ts: lines (order_item_id, units, unit_price_minor, base_minor, tax_profile_id | null, deal / option parent info as §3.4 needs), resolved tax profiles (taxes: seq, tax_code, label, compound, rate rows by payment_class / integration_status / effective_from / rate_bp / ref), the business date, jurisdiction rules (prices_include_tax, rounding { step_minor | null, mode, applies_to }, mixed_class_rule 'higher_rate', currency_exponent), the bill's frozen discount / discount lines, service charge (rate_bp, source, removed, its tax profile), splits (items / amount / equal-N with shares), payments (class, direction, amount_minor). No snapshot parser, no event, no I/O — the hub maps the snapshot onto these types in phase 0b.
   - Build: tax lists per profile (simple / compound, ≤ 4, half-up at each named point only), inclusive back-calculation once per profile, `apportionMinor` over `allocateCappedMinor` (largest remainder, never above a cap; the existing `allocateDealMinor` in packages/domain/src/menu-lines.ts stays untouched), whole-bill discount spread with the R3 cap, sticky service charge (inclusive on the pre-tax net), higher_rate, the rounding adjustment (untaxed, in no payment class, by the frozen rule, `all` / `cash`), dues (cash_due, card_due, …) and refund dues per payment type ("jitna liya utna wapas"), item / amount / equal-N splits (equal remainder to the last split), `blocks` with `tax_unresolved` for a taxed line whose profile has no tax list or no rate row in force.
   - Tests first (compute halves; plan §7): #10, #11, #11b, #12, #13, #13b (blocks half), #14 (rate-by-date half), #15 (compute half: higher_rate cases, all-card 5 %, cash refund on a card bill gives no due), #16 (spread + cap half), #20 (step 100 / 500 / 1 000, nearest / down / up), #20b (every named case), the Pakistan regression fixture byte-identical under PK-PB and none, #14c compute half (none = no rounding for exponent 0 / 2 / 3).
   - Commit `feat(05): computeSplit / computeBill [05 §3.4–§3.8, B4–B10; §11 task 2]`.

3. Task 3a — property tests [05 §3.5 (8); §11 task 3]. Branch lane-05M/05-3a, stacked on task 2 if it is not merged. Credibility rule (plan PL-15): YOU do not write these tests. Spawn a fresh Opus implementer subagent that did not see task 2's implementation; give it only the spec sections (§3.4–§3.8, §10 tests below) and compute.ts's exported type and function signatures (not the bodies). It writes compute.property.test.ts with an independent model inside the test file and seeded random bills (both price modes; 1–40 lines; 1–3 profiles of 1–3 taxes, simple / compound; discounts; service charge; item / amount / equal splits; both classes): #10, #10d, #11c, #15e, #20c (all three setups, 30 000 bills each, two seeds — keep the gate fast: if the run is slow, report it, never shrink the count silently), #16b and #16c (compute halves), #23 (payments half: Σ in − Σ out = split total; change ≤ Σ cash tendered). A disagreement between the model and compute is a finding: fix compute only if the spec is clear, else STOP. Then the two Opus reviewers as usual. Commit `test(05): compute property tests [05 §3.5 (8); §11 task 3a]`.

Not yours (later halves, plan §7): command clauses of #13b, #14, #15, #16 and task 3b (#10b, #10c, #10e, #10f).
```

---

## §3. L-FISCAL — lane `F` (HIGH, Opus)

Paste into a fresh session (Opus):

```text
You are lane 05F (L-FISCAL) of the 05 Billing phase-0a build. Tier HIGH: you implement with Opus; reviewers are two fresh Opus subagents.

Setup:
  git fetch --depth 50 origin +refs/heads/module-05:refs/remotes/origin/module-05 +refs/heads/main:refs/remotes/origin/main
  git fetch --depth 50 origin "+refs/heads/lane-05I/*:refs/remotes/origin/lane-05I/*"   # task 1, if it is not merged yet
  git checkout -B lane-05F/05-5a origin/module-05
  pnpm install --frozen-lockfile   # only if the SessionStart hook did not run it
Then read docs/plans/05-parallel-prompts.md §1 (common rules) — they are part of this prompt — and follow them exactly.

Your files (exclusive; nothing else): packages/domain/src/billing/fiscal-snapshot.ts (+ its test), apps/hub/src/billing/fiscal/port.ts, apps/hub/src/billing/fiscal/none.ts, apps/hub/src/billing/fiscal/outbox.ts, apps/hub/src/billing/fiscal/outbox-ddl.sql, apps/hub/src/billing/fiscal/worker.ts, apps/hub/test/billing/fiscal/fake-adapter.ts, apps/hub/test/billing/fiscal/outbox-db.ts, apps/hub/test/billing/fiscal/{port,outbox,worker}.test.ts; plus one line `export * from './fiscal-snapshot.js'` in packages/domain/src/billing/index.ts. You do NOT create apps/hub/src/billing/index.ts, any migration, any event schema, or anything in apps/hub/src/lib/boot.ts (all phase 0b).

Read: spec §3.15 (whole), §5 (the fiscal_outbox and fiscal_credentials DDL and the "not a projection" paragraph), §6.12 step 6 (the `fiscal` snapshot and invoice fields), §6.29 (InvoiceIssued / InvoiceCredited / FiscalNumberAssigned / FiscalSubmitRejected payloads), §10.7 tests #69–#78b, B20–B22; apps/hub/src/db/migrate.ts (the sequential-number rule) and apps/hub/test/helpers/{db,log-capture}.ts.

Tasks, in order (plan §2A.3 L-FISCAL):

1. Task 5a — invoice jurisdiction snapshot types [05 §6.12 step 6, §6.29, H9-6; §11 task 5]. TS types only (packages/domain has no Zod): the invoice `fiscal` snapshot (adapter_key, pos_id, required, capabilities, credit_support, rounding, receipt { fiscal_number_label, tax_reg_labels, show_qr, qr_url_template, buyer_id_on_receipt }, seller_registrations, payment_codes) and the invoice fields the neutral submission reads. Type tests with expectTypeOf; no free-text or buyer-ID field exists. Commit `feat(05): invoice fiscal snapshot types [05 §6.12, §6.29; §11 task 5a]`. (Task 5's Zod schemas `satisfies` these in phase 0b.)

2. Task 6a — staged fiscal DDL [05 §5, B20, B22; §11 task 6; plan PL-13]. Branch lane-05F/05-6a (independent of 5a). outbox-ddl.sql = the spec §5 text of `fiscal_outbox` (+ the `fiscal_outbox_pending` partial index) and `fiscal_credentials`, verbatim. It is NOT a migration (the runner needs sequential numbers and 0021 / 0022 are phase-0b rows); task 6 copies it into the 05 migration and deletes it. outbox-db.ts = freshDb() + migrate() + this DDL. Tests first: schema test (columns, CHECK states, partial index, primary key). Commit `feat(05): staged fiscal outbox and credentials DDL [05 §5; §11 task 6a]`.

3. Task 28a — port contract, none adapter, fake adapter, outbox rows [05 §3.15, B20, H6-8, H9-6; §11 task 28]. Branch lane-05F/05-28a (stacked on 5a and 6a if not merged). port.ts: FiscalAdapter, capabilities, settingsSchema, credentialNames, FiscalSubmission, FiscalAnswer exactly as §3.15 (copy the types; any difference you think is needed = STOP), registerFiscalAdapter + lookup (duplicate key throws). none.ts: the `none` adapter. fake-adapter.ts (test-only): configurable ordering, credit capability, credentialNames, scripted answers per call, records every submission. outbox.ts: `outboxRowFor(snapshot, ord, original?)` (not_required for adapter none, a non-fiscalized order type, an invoice before switched_at; pending otherwise; a credit follows its original's state, jurisdiction, adapter and pos_id), `insertOutboxRow(db, row)` (INSERT OR IGNORE; the statement task 7's fold will call), `canCredit(originalSnapshot)` (capabilities.credit AND credit_support = 'credit_invoice', both from the original's snapshot). The core never branches on the adapter key. Tests first: #74 (each answer outcome ok / retry / rejected / duplicate with and without a number → §3.15's row transition), #69 outbox-row half, #78 and #78b credit-rule halves. Commit `feat(05): fiscal port, none adapter, outbox rows [05 §3.15; §11 task 28a]`.

4. Task 29a — worker skeleton [05 §3.15, B20, B21; §11 task 29]. Branch lane-05F/05-29a (stacked on 28a if not merged). worker.ts exports `startFiscalWorker(deps)` (returns a stop function) and `runOnce(deps)`. deps: db, adapter lookup, clock, logger, `loadSubmission(row)` and `onAnswer(row, answer)` (injected seams; phase 0b's task 29b supplies the real ones from events and invoice_buyers — plan PL-16, PL-18). Rules: one request in flight per hub; strict_per_pos_id → a pos_id's oldest pending row by ord, its back-off holds only that pos_id; ordering none → independent; a credit waits for its original's answer and steps aside; back-off 5 s, 30 s, 2 min, then 5 min (fake clock); rejected is never resent; a row with in_flight_at set after a crash is resent with the same idempotency_key = invoice_ref; credentials (every credentialNames entry) read from fiscal_credentials at send, a missing one → row stays pending, last_error 'token_missing', never holds another pos_id; health() at most every 60 s while rows wait; last_error holds short codes only. Tests first: #70 same-key half (fault injection between answer and onAnswer commit → restart resends the same key), #71 (whole), #72 back-off half, #77 worker half (captured logger: no token, no buyer field, no request body). No timing asserts (fake clock only). Commit `feat(05): fiscal worker skeleton [05 §3.15, B20, B21; §11 task 29a]`.

Not yours: FiscalNumberAssigned / FiscalSubmitRejected appends and the submission built from events (29b), the boot hook (P0.18), RetryFiscalNow and the stuck alert (31), SetFiscalToken (31a), the PRA adapter (30a / 30).
```

---

## §4. L-PRINT+SETTINGS — lane `P` (NORMAL, Sonnet)

Paste into a fresh session (Sonnet):

```text
You are lane 05P (L-PRINT+SETTINGS) of the 05 Billing phase-0a build. Tier NORMAL: you implement with Sonnet; the reviewer is one fresh Sonnet subagent. If a task turns out to compute money (not lay out numbers it is given), stop, say so in the PR body and ask the integrator to re-tier it HIGH (handbook §4).

Setup:
  git fetch --depth 50 origin +refs/heads/module-05:refs/remotes/origin/module-05 +refs/heads/main:refs/remotes/origin/main
  git fetch --depth 50 origin "+refs/heads/lane-05I/*:refs/remotes/origin/lane-05I/*" "+refs/heads/lane-05M/*:refs/remotes/origin/lane-05M/*" "+refs/heads/lane-05F/*:refs/remotes/origin/lane-05F/*"
  git checkout -B lane-05P/05-p0.9a origin/module-05
  pnpm install --frozen-lockfile   # only if the SessionStart hook did not run it
Then read docs/plans/05-parallel-prompts.md §1 (common rules) — they are part of this prompt — and follow them exactly.

Your files (exclusive; nothing else): packages/domain/src/billing/docs.ts, packages/domain/src/billing/docs.test.ts, packages/events/src/admin/billing.ts (+ test), packages/events/src/admin/jurisdiction-seeds.ts (+ test), packages/events/src/admin/fiscal-adapters/none.ts and pra.ts (+ test), apps/hub/src/billing/defaults.ts (+ test); plus one `export *` line per new module in packages/domain/src/billing/index.ts and in packages/events/src/index.ts. packages/domain/src/print.ts (the 03c Doc / DocBlock) is READ ONLY for you.

Tasks, in order (plan §2A.3 L-PRINT+SETTINGS):

1. Task P0.9a — 05-owned new files of rows A-1 / A-2 [05 §4.5 A-1 (2), (3), (5), A-2, H11-5; Appendix P.2; §11 P0.9; plan PL-14]. Branch lane-05P/05-p0.9a (needs task 1 and P0.3a; stack on them if not merged). Read §4.5 rows A-1 and A-2 in full and §4.4.
   - jurisdiction-seeds.ts: one exported constant with the `none` and `PK` rule values exactly as A-1 (2) (none: exclusive, step null = no rounding, nearest, all, higher_rate, buyer threshold null, no fiscal fields, catch-up null, credit_invoice; PK: the same but step 100, adapter none, PKR). No pro_rata anywhere.
   - fiscal-adapters/none.ts and fiscal-adapters/pra.ts: each exports its settingsSchema (Zod, `.strict()`; PRA accepts `{}` only, Appendix P.2; never a secret field).
   - admin/billing.ts: the Zod wire shapes of A-2 for the A-1 (3) document: C6 keyed lists (mode_id, code, category_id, pos_id, device_id, authority_codes by adapter_key, tax_registrations by code); kind 'cash' ⇒ payment_class 'cash'; at least one active cash mode; base_urls keyed by adapter_key, https:// only; adapter_settings[key] parsed by that key's settingsSchema (field `fiscal.adapter_settings.<key>`, reason 'invalid'); the bounds of A-1 (3) (rounding_step_minor 1 … 10^(exponent + 4) as a refinement that takes the exponent, service_charge_bp 0–3 000, header / footer ≤ 6 lines ≤ 48 chars, invoice_prefix ≤ 6, registration number ≤ 30, authority code 1–20, adapter_settings ≤ 4 KB).
   - apps/hub/src/billing/defaults.ts: the built-in default rules (PK for a PKR tenant, none otherwise) taken from the seed constant; one cash mode; no service charge; variance / petty thresholds 100 / 5 000 major units scaled by currencyExponent (Pakistan 10 000 / 500 000 minor).
   - NOT here (phase 0b, P0.9b): cross-reference checks (not_found, profile_missing, currency_mismatch), the cloud module, 0016, routes, the snapshot `billing` key in config.ts.
   - Tests first: #14c defaults half (exponent-0 / -3 thresholds; none = no rounding); one accept and one refuse test per A-2 refinement; the seed constant has no pro_rata. Commit `feat(05): billing settings shapes, jurisdiction seeds, defaults [05 §4.5 A-1, A-2; §11 P0.9a]`.

2. Task 4a — pure Doc builders [05 §3.16, B17, B21, B29, §6.26; §11 task 4]. Branch lane-05P/05-4a (needs task 2 for the computeSplit output shape and task 5a for the invoice snapshot types; stack on lane-05M/05-2 and lane-05F/05-5a if they are not merged, and rebase as they merge). Builders over the existing 03c Doc / DocBlock blocks only: buildCheckBillDoc (PROVISIONAL banner; no invoice number, fiscal number or QR; default-class total; digital-rate line; rounded cash total), buildReceiptDoc (number, lines, discount, service charge, one tax row per (label, rate, class), the rounding line, total, payments, change, every seller registration on its own line with its label, header / footer per template and show toggles, "FISCAL NUMBER PENDING" when fiscalized and unanswered, the fiscal number when known, drawer block when a cash in / out payment exists), buildCreditNoteDoc (last 4 of a buyer ID only), buildReportDoc for X / Z (staff names passed in; the caller resolves them from staff_names at render). Input types are declared in docs.ts (snapshot fields via 5a's types). NOT in 4a: the QR block (row P-3) and the { fill: 'buyer_id', ref, last4 } placeholder (row P-5) — they change 03c's DocBlock in phase 0b (task 4b). Tests first: #34, #59, #61 doc halves without QR / filler; #20 rounding line on the receipt; 32 and 48 column widths. Commit `feat(05): check bill, receipt, credit note and report docs [05 §3.16, B29; §11 task 4a]`.
```

---

## §5. L-PRA-SKELETON — lane `PRA` (HIGH, Opus, optional)

Paste into a fresh session (Opus) once 28a's PR exists:

```text
You are lane 05PRA (L-PRA-SKELETON) of the 05 Billing phase-0a build. Optional lane. Tier HIGH: you implement with Opus; reviewers are two fresh Opus subagents.

Setup:
  git fetch --depth 50 origin +refs/heads/module-05:refs/remotes/origin/module-05 "+refs/heads/lane-05F/*:refs/remotes/origin/lane-05F/*"
  git checkout -B lane-05PRA/05-30a origin/module-05     # or stacked on origin/lane-05F/05-28a if task 28a is not merged yet ("Stacked on #<n>")
  pnpm install --frozen-lockfile   # only if the SessionStart hook did not run it
Then read docs/plans/05-parallel-prompts.md §1 (common rules) — they are part of this prompt — and follow them exactly.

Your files (exclusive; nothing else): apps/hub/src/billing/fiscal/pra.ts, apps/hub/test/billing/fiscal/pra.test.ts, apps/hub/test/billing/fiscal/fixtures/pra/. You import port.ts (28a) and packages/events/src/admin/fiscal-adapters/pra.ts (P0.9a; if it is not merged yet, import nothing for settings and leave a TODO naming it). You do NOT register the adapter anywhere (task 30 does).

Read: spec Appendix P (all of P.1–P.7), §3.15 (port, submission, answer), §6.12 step 6; docs/stories/05-fiscal-research.md (field shapes found by the research); docs/stories/05-g1-decisions.md §5 (authority questions).

Task 30a — PRA mapping skeleton [05 Appendix P.1–P.3, P.7; §11 task 30; plan PL-17]. Spec Appendix P.5 gates the full adapter (task 30) on A13 and PRA's "Technical Specification Software Fiscal Device v1.2"; the owner (2026-11-18, plan D-6) allows this skeleton now, limited to what Appendix P settles:
- `praAdapter` implementing FiscalAdapter: key 'PRA', capabilities { ordering: 'strict_per_pos_id', credit: true }, credentialNames ['token'], settingsSchema from fiscal-adapters/pra.ts.
- Request mapping: USIN = idempotency_key; InvoiceType 1 for submitSale, 3 for submitCredit with RefUSIN = original.invoice_ref; POS ID = the submission's pos_id (a credit: its original's); seller NTN from seller.tax_registrations code 'NTN'; TotalSaleValue, TotalTaxCharged (= invoice.tax_minor), Discount, TotalBillAmount (the rounding adjustment inside TotalBillAmount only); one item per line (its single taxes[0] gives rate and tax; Σ item tax = TotalTaxCharged) + one 'Service charge' item with its own tax; a line with more than one tax → answer rejected 'multi_tax_unsupported'; PaymentMode from each payment's authority_code (1 cash, 2 card; more than one code → 5 mixed only when every payment has a code; a missing code → rejected 'mode_unmapped'); buyer name and tax_id in the CNIC or NTN field by type, a credit sends its original's buyer, a waived bill sends them empty; Bearer header from credentials.token; transport URL from config.base_url else the Appendix P.2 sandbox / production defaults — but the HTTP call itself goes through an injected `post(url, headers, body)` so tests never touch the network.
- Answer mapping (P.3): 2xx with a PRA invoice number → ok { fiscal_number, qr_payload }; network error, timeout, 5xx → retry ('timeout', 'http_503', …); 4xx or a validation answer → rejected (short code, http_status); a re-sent USIN PRA already holds → duplicate with the number when returned, else rejected (A10 default).
- Every field, value or answer shape that needs A13, A14 or PRA spec v1.2 — the exact JSON key names beyond the ones Appendix P names, date-time format, the answer's exact shape, wallet / QR / online codes, rounding or service charge as items vs bill fields — is a `// TODO(STOP: A13 | A14 | PRA v1.2): <what is unknown>` with an `it.todo('[05 P-T1 STOP: …] …')`, never a guess. List every TODO(STOP) in the PR body under "STOPs for task 30" and add the label needs-ruling.
- Fixtures under fixtures/pra/: recorded from the research shapes with the literal token `test-token`; no real token, NTN, CNIC or name of a real person.
- Tests first: P-T1 and P-T2 for the clauses above (cash / card / mixed → 1 / 2 / 5; credit InvoiceType 3 + RefUSIN with the original's buyer and POS ID; buyer fields above the threshold; Σ item tax = TotalTaxCharged; the service-charge item; multi_tax_unsupported; mode_unmapped; 5xx / timeout → retry; 4xx → rejected; duplicate per A10 default; the Bearer header from credentials); no network.
Commit `feat(05): PRA adapter mapping skeleton [05 Appendix P; §11 task 30a]`.
```

---

## §6. Integrator — cut `module-05`, task 1, board, merges, P0.Sa

Paste into a fresh session (Opus; it spawns Sonnet subagents for NORMAL work):

```text
You are the 05 Billing INTEGRATOR for phase 0a. You orchestrate; you do not count toward any agent cap. State lives on the board docs/plans/05-status.md, not in chat.

Read: CLAUDE.md; docs/plans/integrator-handbook.md; docs/plans/05-plan.md (§0, §1, §2A, §6, §9, §10); docs/plans/05-parallel-prompts.md (all); docs/plans/04-status.md (W-1–W-6 wording). GitHub only through `gh api` REST. Never `git stash`. Never push `main`; never push `module-05` directly (everything goes in by PR). Never run `pnpm test:perf`, hardware or power-loss checks. Commits: `git -c user.name="Arslan Ahmed Arif" -c user.email=arsiiahmi@gmail.com commit`, message citing spec / plan sections, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (plus your session's Claude-Session line if given). PR bodies end with "🤖 Generated with [Claude Code](https://claude.com/claude-code)".

Step 0 — gate G0.1:
  git fetch --depth 50 origin +refs/heads/main:refs/remotes/origin/main +refs/heads/spec-05:refs/remotes/origin/spec-05
  gh api repos/arsiihere/pos/pulls/219 --jq .merged        # must be true
  git merge-base --is-ancestor origin/spec-05 origin/main  # must succeed
If either fails: say "G0.1 not met — PR #219 is not on main", and STOP.

Step 1 — P0.B (plan §2A.2):
- Create module-05 at origin/main: gh api repos/arsiihere/pos/git/refs -X POST -f ref=refs/heads/module-05 -f sha=$(git rev-parse origin/main)
- Ruleset as 04 W-1: list `gh api repos/arsiihere/pos/rulesets`, read the one covering module-04 (`gh api repos/arsiihere/pos/rulesets/<id>`), and create the same for refs/heads/module-05 (PR required, required check `gate`, rebase merge only, no force push, no deletion) with `gh api repos/arsiihere/pos/rulesets -X POST --input /tmp/ruleset-05.json`. If the API refuses, write it on the board as an owner task and go on.
- Labels (skip ones that exist): needs-ruling, tier:HIGH, tier:NORMAL, lane:05-P0, lane:05-I, lane:05-U0, lane:05-U1, lane:05-U2, lane:05-U3, lane:05-M, lane:05-T, lane:05-K, lane:05-S, lane:05-B1, lane:05-B2, lane:05-P, lane:05-F, lane:05-PRA, lane:05-A, lane:05-Z, lane:05-C1, lane:05-C2 — `gh api repos/arsiihere/pos/labels -X POST -f name=<label> -f color=<hex>`.
- Branch lane-05I/05-p0.b from origin/module-05: docs/plans/05-status.md from the plan §9 skeleton (gates filled: G0.1 met with the commit; G0.2 / G0.3 / G0.4 open; Phase 0a table seeded with every 0a task, lane, tier, needs, branch name; Readings PL-0 … PL-20, PL-0 / PL-12 "ruled (D-2 / D-3)", the rest "proposed"; owner summary line in Hinglish), and docs/plans/05-cleanup.md (empty, header as docs/plans/03b-client-cleanup.md). Commit `docs(05): board and cleanup file [05-plan §2A.2 P0.B, §9]`, push, PR into module-05 (labels lane:05-I, tier:NORMAL). Merge it yourself when CI is green (W-3): gh api repos/arsiihere/pos/pulls/<n>/merge -X PUT -f merge_method=rebase

Step 2 — task 1 (plan §2A.2), NORMAL: branch lane-05I/05-1 from origin/module-05. A fresh Sonnet implementer subagent writes packages/domain/src/billing/types.ts with the spec §4.4 constants exactly (MIXED_CLASS_RULES = ['higher_rate']), types.test.ts (constants exact), the barrel packages/domain/src/billing/index.ts (`export * from './types.js'`), and one line `export * from './billing/index.js'` in packages/domain/src/index.ts; TDD; gate `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`; one fresh Sonnet reviewer. Commit `feat(05): shared billing types [05 §4.4; §11 task 1]`, PR into module-05, merge when CI is green.
As soon as task 1's PR is open, tell the owner: "0a lanes ready — paste 05-parallel-prompts.md §2, §3, §4 (and §5 when 28a's PR is open) into fresh sessions." Lanes stack on lane-05I/05-1 until it merges.

Step 3 — the merge loop (repeat until phase 0a is done; check every ~10 minutes or when the owner asks):
- `gh api "repos/arsiihere/pos/pulls?state=open&base=module-05&per_page=50"` and, for stacked PRs, base = lane-05*.
- A PR merges when: CI `gate` is green on its head; its body has the review verdicts (HIGH: two Opus approvals, or a fresh re-check approval after changes; NORMAL: one Sonnet approval); no `needs-ruling` label; it touches only its lane's files (check `gh api repos/arsiihere/pos/pulls/<n>/files --jq '.[].filename'` against plan §2A.3 — a file outside the list → do not merge, comment, add needs-ruling); its "Needs" are merged. Rebase-merge it. After a lower stacked PR merges, comment on the upper one asking its lane to rebase onto module-05 (the lane does it).
- Additive conflicts in packages/domain/src/billing/index.ts, packages/domain/src/index.ts or packages/events/src/index.ts (export lines only) are resolved by the lane at rebase, keeping every line; any other conflict → needs-ruling and tell the owner.
- Copy each PR's "Cleanup candidates" into docs/plans/05-cleanup.md; copy STOP blocks into the board's "STOPs / needs-ruling" and tell the owner at once (quote the block); record readings as AD rows.
- Update the board after each merge (task state, PR, commit, reviewer verdicts) in a small docs PR `docs(05): board — <tasks> [05-plan §2A]` that you merge when green.

Step 4 — P0.Sa (plan §2A.4), HIGH: when 2, 4a, 6a, 28a, 29a and P0.9a are merged, branch lane-05I/05-p0.sa from origin/module-05; a fresh Opus implementer subagent writes apps/hub/test/billing/spike-0a.int.test.ts using only merged 0a code (cases a, b, c of §2A.4; test names `[05 spike-0a] …`); gate; two fresh Opus reviewers; commit `test(05): spike, phase 0a half [05 §3.5, §3.15, §3.16; 05-plan §2A.4 P0.Sa]`; PR; merge when green. Any failure that is not a bug in the test → STOP: board row + tell the owner; the 0b base does not start.
When P0.Sa is merged and every 0a row except 30a is merged: board "Phase 0a done", owner summary line, tell the owner.

Step 5 — watch for phase 0b (plan §2B.1): on each loop run `git fetch --depth 50 origin +refs/heads/module-deeplinks:refs/remotes/origin/module-deeplinks` and the G0.2 check (`git log origin/main..origin/module-deeplinks` shows only merge commits whose trees main already has). When G0.2 holds: write it on the board, run the G0.3 scan, tell the owner "G0.2 met — phase 0b can start (plan §2B: G0.4 sync, P0.1, P0.G, P0.2a–k …)", and STOP until the owner says "start 0b". Phase 0b runs at ≤ 4 agents (W-4) unless the owner re-rules.

STOP and ask the owner (quote the facts, give options and a Rec) on: a spec–code mismatch, two specs disagreeing, a lane touching another module's spec or code, a contract / error code / migration change, any red gate you cannot attribute to one PR.
```

---

## §7. Copy-paste sheet

Every block: open a new claude.ai/code session on `arsiihere/pos` (Opus unless it says Sonnet) and paste the prompt from the section named.

| Order | Session | Model | Paste |
|---|---|---|---|
| 1 | Integrator | Opus | §6 |
| 2 | L-MONEY | Opus | §2 |
| 2 | L-FISCAL | Opus | §3 |
| 2 | L-PRINT+SETTINGS | Sonnet | §4 |
| 3 (optional) | L-PRA-SKELETON | Opus | §5, once 28a's PR is open |

Order 2 opens when the integrator says "0a lanes ready". If anything STOPs: the integrator quotes the STOP block; answer on the PR in the GitHub app (the lane goes on) and tell the integrator (it records the ruling on the board).
