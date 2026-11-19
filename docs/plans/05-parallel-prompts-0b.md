# 05 — phase 0b upstream code lanes: what to open and what to paste

Plan: `docs/plans/05-plan.md` §1 (global rules), §2B.4 (upstream code rows P0.3b – P0.17b, lanes U0 – U3, merge order), "Gap sweep patches (P0.G …)". Gaps and owner rulings: `docs/plans/05-gaps.md` (R-1 … R-19). Spec: `docs/specs/05_Billing_Spec_v1.0.3.md` and the bumped targets on `module-05` (Foundation v1.14, 00 v1.12, 01a v2.6, 01b v1.10, 01d v1.3.4, 02a v1.1.8, 02b v1.0.16, 03a v1.2.6, 03c v1.0.11, 04 v1.0.7). Board: `docs/plans/05-status.md` (only the integrator edits it).

Every session is a **fresh claude.ai/code cloud session** on `arsiihere/pos` (Opus). The SessionStart hook starts Postgres on 5433 and runs `pnpm install`. Owner ruling 2026-11-19: **no agent cap** in 0b (W-4 lifted). The integrator runs the P0.19 rows, the README bump (P0.2k), the 05 base (tasks 5, 6, 7, P0.F, P0.18) and P0.Sb.

## Sessions

| Session | Lane | Tasks (plan §2B.4, in table order) |
|---|---|---|
| 1 | **U0** platform (00 / Foundation) | P0.3b, P0.3c, P0.4, P0.4b, P0.5 |
| 2 | **U1** 01a / 01b / 01d | P0.7 first, then P0.6, P0.8, P0.9b, P0.10 |
| 3 | **U2** 02a / 02b / 03a / 04 | P0.11, P0.12, P0.13, P0.13b, P0.14, P0.15 |
| 4 | **U3** 03c | P0.16, P0.17, P0.17b |

Cross-lane needs (plan §2B.4, PL-11): **P0.5** (U0) and **P0.6** (U1) need **P0.7** (U1) merged; **P0.10** (U1) needs **P0.17** (U3, `renderText` in `@pos/domain`) merged. Stack on the other lane's open branch if it is not merged yet (fetch `"+refs/heads/lane-05U*/*:refs/remotes/origin/lane-05U*/*"`).

---

## §1. Common rules for every 0b code lane (part of every prompt below)

```text
COMMON RULES FOR EVERY 05 PHASE-0b CODE LANE (read fully before any code)

Repo arsiihere/pos, this checkout. GitHub only through `gh api` REST (never `gh pr create`, never GraphQL). Never `git stash`. Never push `main` or `module-05`; push only your own branches `lane-05<L>/05-<task>`; `git push --force-with-lease` only on your own task branches. Never merge a PR yourself (the integrator does).

Cloud env: before any pnpm / turbo / vitest command run `export npm_config_manage_package_manager_versions=false` (turbo otherwise fails with "Exec format error", AD-C19). If `pnpm install` is needed, run it once WITHOUT that variable (pnpm switches itself to the repo's version), then export it. If `pg_isready -p 5433` fails, `service postgresql start` (never stop or restart it).

Read first: CLAUDE.md; docs/plans/05-plan.md §1, §2B.4 (your lane's rows IN FULL — the "Files (own)", "Tests first", "Needs" columns are your contract), the "Gap sweep patches (P0.G …)" section; docs/plans/05-gaps.md (every G-row and ruling that names one of your tasks); then only the spec sections your row cites — 05 text in docs/specs/05_Billing_Spec_v1.0.3.md, target-module text in the bumped spec version (marked "⚠️ Changed by 05 (row X-n)"). Do not read whole specs.

Spec-first: your row implements the bumped spec text exactly. If the bumped text and the code, or two specs, disagree → STOP (below). Never edit docs/specs/.

Files: edit ONLY your row's "Files (own)" list (+ its tests). Another lane's file or a file no row lists → STOP. Build only what the row and spec say; no new dependency.

TDD, one task at a time, in your lane's order:
1. Branch: base = origin/module-05, or your previous unmerged task branch (stacked; the PR body says "Stacked on #<n>"). `git checkout -B lane-05<L>/05-<task> <base>`.
2. Failing test first; test names cite the spec, e.g. it('[05 H-5] PKX is refused, nothing written'). Keep the failing output line for the PR body.
3. Implement; `TMPDIR=/dev/shm pnpm vitest run <your test files>` and the touched package's typecheck (`typecheck:tests` too where it exists). Statement counts the row or spec states are asserted with the repo's statement counter (as earlier modules do).
4. Full gate once before the PR, exactly: TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test". Never `pnpm test:perf`, hardware, power-loss or authority network calls.
5. Migrations: only the numbers the row names (hub 0021 02b, 0022 03c, 0023 05; cloud 0014 billing settings, 0015 defaults backfill). Never edit a merged migration.
6. Privacy: no buyer tax ID, token, PIN, name, phone, note, paid_to or payment reference in any event, log, hash, error detail or fixture.

Review (before the PR; fixes squashed into the one task commit):
- HIGH row: two fresh Opus reviewer subagents, independent, each given the row, the cited spec sections and the diff. Reviewer 2 focuses on races / ordering, privacy, statement counts, contracts with other modules.
- NORMAL row: one fresh Sonnet reviewer subagent.
- Findings BLOCKER / MAJOR / MINOR with file:line. Fix rounds only for BLOCKER / MAJOR, at most 2; when reviewers asked for changes, the second approval is a fresh re-check reviewer who mutation-verifies every fixed MAJOR. A MAJOR open after round 2 → STOP. MINORs go in the PR body under "Cleanup candidates".

Commit (one per task): run the privacy grep of handbook §9 / plan §1 "Privacy" on `git diff --cached` (machine paths, Bearer tokens) — it must print nothing; `git -c user.name="Arslan Ahmed Arif" -c user.email=arsiiahmi@gmail.com commit` with `feat(<module>): <title> [<spec> §x; 05 row X-n; 05-plan §2B.4 <task>]`, body ending with
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
(plus your session's Claude-Session line if it gives one).

Pull request (REST):
- `git push -u origin lane-05<L>/05-<task>`
- Body file under /tmp: spec sections; tests added + failing-first line; statement counts; Readings; "Needs: #…" / "Stacked on #…"; tier; review verdicts and how each MAJOR closed; Cleanup candidates; any STOP block. Last line: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- `gh api repos/arsiihere/pos/pulls -X POST -f title="<task>: <title> [<spec> §x]" -f head="lane-05<L>/05-<task>" -f base="module-05" -F body=@/tmp/pr-05-<task>.md`
- `gh api repos/arsiihere/pos/issues/<n>/labels -X POST -f "labels[]=lane:05-<L>" -f "labels[]=tier:<HIGH|NORMAL>"`
- Watch CI (`gh api "repos/arsiihere/pos/commits/<sha>/check-runs"`); a red gate on your PR is yours to fix.
- Go on with your next task (stacked if the previous PR is not merged). After a lower PR merges: fetch module-05, `git rebase --onto origin/module-05 <old-base> <branch>`, push --force-with-lease. Additive conflicts in barrel / registry export lines: keep every line. Any other conflict → STOP.

STOP rules (never a silent fix, never a guess): spec and code disagree; two specs disagree; a name / signature / table the row needs is not where the plan says; a file outside your list must change; a contract, error code, migration or folder structure the row does not state would change; a bound or behaviour the spec does not state → STOP. Finish every clause that does not depend on it; put a STOP block in the PR body (what, spec § and code file:line, options, your Rec), add the label `needs-ruling`, print the STOP block, and continue only with tasks that do not depend on it. The owner answers on the PR (or through the integrator).

When every task of your lane has a PR open or merged: print "LANE 05<L> DONE" with the PR numbers, readings and cleanup candidates, and stop.
```

---

## §2. Lane U0 — platform (00 / Foundation)

Paste into a fresh session (Opus):

```text
You are lane 05U0 (platform: 00 Hub Platform / Foundation) of the 05 Billing phase-0b build.

Setup:
  git fetch --depth 50 origin +refs/heads/module-05:refs/remotes/origin/module-05
  git checkout -B lane-05U0/05-p0.3b origin/module-05
Then read docs/plans/05-parallel-prompts-0b.md §1 (common rules) — they are part of this prompt — and follow them exactly.

Your tasks, in this order — each is the plan §2B.4 row of that id, read IN FULL (files, tests, needs, tier):
1. P0.3b — F-1 `bill` stream type; H-5 `seed-tenant --currency` check using `currencyExponent` (HIGH).
2. P0.3c — append the 05 §9 error codes (05 v1.0.3 §9; Foundation v1.14 §6.2 lists the same 31) to packages/domain/src/errors.ts (+ its test) (NORMAL).
3. P0.4 — H-1 `sessionKind: 'both'` (00 v1.12 §3.7, §4.2).
4. P0.4b — H-4 `hashOmit` (00 v1.12 §3.7, §4.2, §7.2) (HIGH).
5. P0.5 — H-2 `/admin/fiscal/` entry + nav + home tile (00 v1.12 §8.2; plan G-17 file list). NEEDS P0.7 (lane U1, `manage-fiscal-settings`) merged first: build it, open the PR stacked on U1's P0.7 branch if that is not merged, and say so.
```

---

## §3. Lane U1 — 01a / 01b / 01d

Paste into a fresh session (Opus):

```text
You are lane 05U1 (01a Restaurant Setup, 01b Staff Roles, 01d Notifications) of the 05 Billing phase-0b build.

Setup:
  git fetch --depth 50 origin +refs/heads/module-05:refs/remotes/origin/module-05
  git checkout -B lane-05U1/05-p0.7 origin/module-05
Then read docs/plans/05-parallel-prompts-0b.md §1 (common rules) — they are part of this prompt — and follow them exactly.

Your tasks, in this order — each is the plan §2B.4 row of that id, read IN FULL:
1. P0.7 first (P0.5 in lane U0 and your P0.6 need it) — 01b B-1 permissions + 01d D-1 (`holders` right mode, the 05 kinds; G-16: AlertRaised v5 + identity upcaster per Foundation D46, module-load registration, G-20). Specs: 01b v1.10, 01d v1.3.4. Open point from the 01d bump: whether `holders` kinds get the G1-9d shortcut — the spec does not say → do not add it; note it as a Reading.
2. P0.6 — 01a A-3 day-close guard list, A-4 appender list, A-5 `close-business-day` (01a v2.6 §6.18b; G-18: `resetDayCloseGuards` per A-3, 04 tests that call the old name follow).
3. P0.8 — 01b B-2 default roles + cloud `0015_billing_defaults_backfill.sql` (01b v1.10 §5.1b, §6.15; idempotent, G-27).
4. P0.9b — 01a A-1 / A-2 rest: cloud `0014_billing_settings.sql`, catalog + `branch_billing_settings`, `GET`/`PUT …/billing`, `GET /v1/admin/jurisdictions`, the snapshot `billing` key and mapper (01a v2.6 §4.3, §5.2b, §6.25, §6.26; 05 v1.0.3 A-1 / A-2; rulings R-3, R-10, R-13, R-14, R-15, G-3, G-23; uses P0.9a's merged files in packages/events/src/admin/ and apps/hub/src/billing/defaults.ts). Open points the 01a bump left: where `fiscal_category` is stored on cloud `tax_classes`, and the permission / §12.2 rows of the two new routes — if the row and specs do not settle them → STOP, do not invent.
5. P0.10 — 01a A-1 (6) owner Billing page with receipt preview. NEEDS P0.17 (lane U3, `renderText` in @pos/domain) merged: build it last; stack on U3's branch if needed.
```

---

## §4. Lane U2 — 02a / 02b / 03a / 04

Paste into a fresh session (Opus):

```text
You are lane 05U2 (02a Tables, 02b Ordering, 03a Timing Engine, 04 Voids & Audit) of the 05 Billing phase-0b build.

Setup:
  git fetch --depth 50 origin +refs/heads/module-05:refs/remotes/origin/module-05
  git checkout -B lane-05U2/05-p0.11 origin/module-05
Then read docs/plans/05-parallel-prompts-0b.md §1 (common rules) — they are part of this prompt — and follow them exactly.

Your tasks, in this order — each is the plan §2B.4 row of that id, read IN FULL:
1. P0.11 — 02a T-1 merge / split guard list (`{ code, details } | null`, first non-null), T-2, T-3 `SeatingReopened` (02a v1.1.8; G-18 guard files).
2. P0.12 — 02b Q-1 `order_lines.tax_profile_id` + `unit_price_minor` (R-7 / R-17: round_half_up(line_total_minor ÷ units), NULL while a weight is pending, deal_part 0, folded in ItemAdded and LineWeightSet) + hub migration `0021_orders_billing.sql` (02b v1.0.16 §5).
3. P0.13 — 02b Q-2 `OrdersUnbilled`, Q-5 `OrdersCarriedOver`, Q-6 takeaway `adds_to_order_id` / `bill_key` / `orders_token_day`; 03a S-1 `OrderPlaced.adds_to_order_id` (03a v1.2.6); audiences and all three client ORDER_FRAMES lists (G-26).
4. P0.13b — 02b Q-7 `registerOrderCancelledHook` (HIGH).
5. P0.14 — 02b Q-3 line guard list `touched: [{ order_item_id, units_after, comped_after, base_after_minor, money_changes }]`, called once per command (R-16: 05's check answers the whole list in 1 statement); 04 V-1 (04 v1.0.7 §3.2, §6.1 step 4b, §6.3) (HIGH).
6. P0.15 — 04 V-2 `walk_out`, V-3 audit actions + subject types `bill` / `shift`, `registerRequestAction` (G-19: client labels / i18n / audit query validation in the row's file list; G-20 registration before the seal).
```

---

## §5. Lane U3 — 03c Printing

Paste into a fresh session (Opus):

```text
You are lane 05U3 (03c Printing) of the 05 Billing phase-0b build.

Setup:
  git fetch --depth 50 origin +refs/heads/module-05:refs/remotes/origin/module-05
  git checkout -B lane-05U3/05-p0.16 origin/module-05
Then read docs/plans/05-parallel-prompts-0b.md §1 (common rules) — they are part of this prompt — and follow them exactly.

Your tasks, in this order — each is the plan §2B.4 row of that id, read IN FULL:
1. P0.16 — 03c P-1 bill routes: hub migration `0022_bill_routes.sql`, `SetBillRoute` / `BillRouteSet`, `billPrinterFor` (device → zone → floor → default, 1 statement), Printers page section (03c v1.0.11 §3.2, §5, §6.13). Open points the 03c bump left: the `report` scope's place in the chain and `ref_id` for `report` / `default` — if the row and specs do not settle them → STOP, do not invent; table keys / indexes the spec does not state → STOP too.
2. P0.17 — 03c P-2 `retargetDocumentJob` + `documentJobsStatus`; P-4 `renderText` moves to `packages/domain/src/print-render.ts` (browser-safe), hub / client / test imports follow (G-27). P0.10 in lane U1 waits for this one — open its PR as early as you can.
3. P0.17b — 03c P-5 `registerDocumentFiller` (`{ fill, ref, last4 }` filled at send, never written back, unknown kind prints last4, filler error logged with job_id only) (HIGH); P-3 QR block if the row lists it.
```
