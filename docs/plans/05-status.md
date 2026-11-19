# 05 Billing — build board

Plan: `05-plan.md`. Prompts: `05-parallel-prompts.md`. Gaps: `05-gaps.md` (written in P0.G, phase 0b). Spec: `05_Billing_Spec_v1.0.md` (`v1.0.1` after P0.1). Integration branch: `module-05`. Cleanup: `05-cleanup.md`. Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-19: **G0.2 met** — `module-deeplinks` #274 se `main` par aa gayi (`main` @ `cec8591b`). G0.3 scan ho gaya: hub migrations 0021+ free, cloud 0014 / 0015 ko #121 / #126 (`module-02-hub-gaps`) claim karte hain → 05 cloud 0016–0017 (plan wala hi); 01d `main` par v1.3.3 tak, to agla v1.3.4. Phase 0b tayyar hai, owner ke "start 0b" ka intezar. 0a lanes ka abhi tak koi PR nahi aaya.
> - 2026-11-18: P0.B (#265) aur task 1 shared types (#266) merged → `module-05` @ `57336af`. 0a lanes M, F, P khol do (prompts §2, §3, §4); PRA (§5) tab jab 28a ka PR khule. Phase 0b abhi bhi ruki: `module-deeplinks` ke 29 commits `main` par nahi.
> - 2026-11-18: G0.1 met (#219 `main` par, `5d25a3a`). `module-05` cut ho gayi `main` @ `5d25a3a` se; ruleset `module branches (03b onward)` pehle se `module-*` cover karta hai (W-1 wala hi). Labels ban gaye. Ye board + cleanup file (P0.B). Task 1 (shared types) chal raha hai; uska PR khulte hi 0a lanes (M, F, P) khol do. Phase 0b `module-deeplinks` ke `main` par aane tak ruki hai.

## Gates

| Check | State |
|---|---|
| G0.1 spec-05 on `main` | **met** — PR #219 merged, `main` @ `5d25a3a` (merge commit; second parent = `spec-05` @ `ed2365a`); `git merge-base --is-ancestor origin/spec-05 origin/main` succeeds (2026-11-18) |
| G0.2 `module-deeplinks` on `main` | **met** — 2026-11-19: PR #274 merged (`main` @ `cec8591b`); `git log origin/main..origin/module-deeplinks` is empty (`module-deeplinks` @ `6b96c98f` is an ancestor of `main`) |
| G0.3 claims scan (numbers found) | **done** 2026-11-19 (see "G0.3 scan" below) — no branch or open PR claims a number 05 needs beyond what the plan already expects |
| G0.4 `main` synced into `module-05` | open — first 0b step, after the owner's "start 0b" |

## G0.3 scan (2026-11-19)

Scanned: all 319 `origin/*` heads (`git ls-tree` under `docs/specs/`, `apps/hub/src/db/migrations/`, `apps/cloud/src/db/migrations/`) and every open PR (#121, #126; nothing else open).

| Item | Highest taken (`main` @ `cec8591b`) | Claimed off `main` | Next free for P0.1 |
|---|---|---|---|
| Hub migrations | `0020_order_line_option_quantity` | none | **0021** (provisional 0021–0023 hold) |
| Cloud migrations | `0013_void_defaults_backfill` | `0014_comp_chips_no_other` (#121 `lane-HD/h9`, #126 `lane-HD/h10`), `0015_cashier_mark_served` (#126) — both PRs into `module-02-hub-gaps`, open, last updated 2026-11-12 | **0016** (provisional 0016–0017 hold) |
| F `00_Foundation` | v1.13 | none | after v1.13 |
| 00 `00_Hub_Platform_Access` | v1.11 | only older files on `module-00` (v1.1) / `module-01` (v1.2.1) | after v1.11 |
| `01_Restaurant_Setup` | v2.5.1 | only older v1.0.2 on `module-01` | after v2.5.1 |
| 01b | v1.9.1 | none | after v1.9.1 |
| 01d | **v1.3.3** (from `module-deeplinks`) | none | **v1.3.4** (plan expected "v1.3.3 or later") |
| 02a | v1.1.7 | none | after v1.1.7 |
| 02b | v1.0.15 | none | after v1.0.15 |
| 03a | v1.2.5 | none | after v1.2.5 |
| 03c | v1.0.10 | none | after v1.0.10 |
| 04 | v1.0.6 | none | after v1.0.6 |

P0.1 re-checks these at its own commit (patch vs minor is P0.1's call per spec §4.5 / §11).

## Owner rulings on how the build runs

Same as 04 (W-1–W-6, `04-status.md`), for `module-05`:

| # | Ruling |
|---|---|
| W-1 | `module-05`: PR required, check `gate` required, rebase merge only, no force push, no deletion. Enforced by the existing ruleset `module branches (03b onward)` (id 27021396, `refs/heads/module-*`) — no new ruleset needed (AD-21). |
| W-2 | The integrator merges green, reviewed PRs into `module-05`. Stacked: top PR merged, the lower ones closed with a comment. |
| W-3 | The integrator merges green docs / spec PRs (incl. into `main`). `module-05` → `main` is the owner's (merge commit); the integrator opens the PR. |
| W-4 | Phase 0a: no agent cap (owner 2026-11-18, D-7); from phase 0b at most 4 agents at once (implementers + reviewers; the integrator is not counted) unless the owner re-rules here. |
| W-5 | Repo public: never commit a secret or a machine path; the pre-commit diff check of handbook §9 / plan §1 "Privacy" prints nothing. |
| W-6 | HIGH tasks get two fresh Opus reviewers (reviewer 2 on money, races, privacy, statement counts). Fix rounds > 2 → STOP. Money MINORs are fixed before merge. |

Plan decision log D-1…D-8: `05-plan.md` §0.

## Owner rulings on the spec during the build

| # | Ruling | When | Where it landed |
|---|---|---|---|

## Phase 0a (05's own work)

| Task | Lane | Tier | Needs | Branch | PR | Reviewers (R1 / R2 verdict) | State |
|---|---|---|---|---|---|---|---|
| P0.B | I | NORMAL | G0.1 | `lane-05I/05-p0.b` | #265 | docs (integrator, W-3) | merged `d2075f2` |
| 1 | I | NORMAL | P0.B | `lane-05I/05-1` | #266 | R1 Sonnet APPROVE (2 MINOR → cleanup C-1, C-2) | merged `57336af` |
| P0.3a | M | HIGH | — | `lane-05M/05-p0.3a` | — | — | waiting lane |
| 2 | M | HIGH | 1, P0.3a | `lane-05M/05-2` | — | — | waiting lane |
| 3a | M | HIGH | 2 | `lane-05M/05-3a` | — | — | waiting lane |
| 5a | F | HIGH | 1 | `lane-05F/05-5a` | — | — | waiting lane |
| 6a | F | HIGH | — | `lane-05F/05-6a` | — | — | waiting lane |
| 28a | F | HIGH | 5a, 6a | `lane-05F/05-28a` | — | — | waiting lane |
| 29a | F | HIGH | 28a | `lane-05F/05-29a` | — | — | waiting lane |
| P0.9a | P | NORMAL | 1, P0.3a | `lane-05P/05-p0.9a` | — | — | waiting lane |
| 4a | P | NORMAL | 1, 2, 5a | `lane-05P/05-4a` | — | — | waiting lane |
| 30a (optional) | PRA | HIGH | 28a | `lane-05PRA/05-30a` | — | — | waiting lane (opens once 28a's PR is open) |
| P0.Sa | I | HIGH | 2, 4a, 6a, 28a, 29a, P0.9a | `lane-05I/05-p0.sa` | — | — | waiting |

## Phase 0b (bumps, base, spike)

Waits for G0.2–G0.4 (plan §2B.1). Rows in plan order (§2B.2–§2B.6).

| Task | Lane | Tier | Needs | PR | State |
|---|---|---|---|---|---|
| P0.1 | I | NORMAL | G0.2–G0.4 | — | waiting G0.2 |
| P0.G | I | NORMAL | P0.1 | — | waiting G0.2 |
| P0.2a – P0.2k | P0 | NORMAL | P0.1, P0.G | — | waiting G0.2 |
| P0.3b | U0 | HIGH | P0.2a, P0.2b, P0.3a | — | waiting G0.2 |
| P0.4 | U0 | NORMAL | P0.2b | — | waiting G0.2 |
| P0.4b | U0 | HIGH | P0.4 | — | waiting G0.2 |
| P0.5 | U0 | NORMAL | P0.2b, P0.7 | — | waiting G0.2 |
| P0.6 | U1 | HIGH | P0.4, P0.7 | — | waiting G0.2 |
| P0.7 | U1 | HIGH | P0.2c, P0.2d, P0.2e | — | waiting G0.2 |
| P0.8 | U1 | NORMAL | P0.7 | — | waiting G0.2 |
| P0.9b | U1 | HIGH | P0.3b, P0.2c, P0.9a | — | waiting G0.2 |
| P0.10 | U1 | NORMAL | P0.9b, P0.17 | — | waiting G0.2 |
| P0.11 | U2 | HIGH | P0.2f | — | waiting G0.2 |
| P0.12 | U2 | HIGH | P0.2g | — | waiting G0.2 |
| P0.13 | U2 | HIGH | P0.12, P0.2h | — | waiting G0.2 |
| P0.13b | U2 | HIGH | P0.13 | — | waiting G0.2 |
| P0.14 | U2 | HIGH | P0.2g, P0.2j | — | waiting G0.2 |
| P0.15 | U2 | NORMAL | P0.2j | — | waiting G0.2 |
| P0.16 – P0.18 (incl. P0.17b) | plan §2B.4 | plan §2B.4 | plan §2B.4 | — | waiting G0.2 |
| 5, 6, 7, P0.F | I | HIGH | P0.18, P0.Sa | — | waiting |
| P0.Sb | I | HIGH | 5, 6, 7, P0.F | — | waiting |

## 05-1 lanes

| Lane | Task | Tier | Needs | PR | Reviewers (R1 / R2 verdict) | State |
|---|---|---|---|---|---|---|

## 05-2 lanes

| Lane | Task | Tier | Needs | PR | Reviewers | State |
|---|---|---|---|---|---|---|

## Client

| Lane | Task | Tier | Blocked on | PR | State |
|---|---|---|---|---|---|

## Owner tasks and manual checks

| # | Task | State |
|---|---|---|
| O1 | Authority email to PRA with A1–A14 (A13 / A14 block task 30) | open |
| O2 | PRA "Technical Specification Software Fiscal Device v1.2" (or its field list) into `docs/stories/` | open |
| O3 | Register the POS ID(s) with PRA | open |
| O4 | Sandbox token → `/admin/fiscal/` on the pilot hub; run M2 | open |
| O5 | Production token → `/admin/fiscal/` on the pilot hub | open |
| O6 | Owner's / accountant's written OK: only the POS floor reports to PRA (R20) | open |
| O7 | Go-live decision (`PK-PB` or start on `PK`) | open |
| O8 | 01c data entry note (M-2): `is_default` off unless truly default | open |
| O9 | Design handoff `docs/design/handoff/05/` | open |
| M1 | `pnpm test:perf` 05 row on the pilot box (real disk, quiet machine) | open |
| M2 | PRA sandbox run | open |
| M3 | Receipt QR scan per printer model | open |
| M4 | Drawer kick on the kiosk printer | open |
| M5 | Full buyer ID only on that customer's receipt / reprints | open |
| M6 | 01d request screens with `discount` and `shift_variance` on two tablets | open |
| M7 | (recommended) power-loss during a close burst | open |
| M8 | Go-live checklist §8.2 signed off | open |

## STOPs / needs-ruling

| # | Task | Finding | Options + Rec | State |
|---|---|---|---|---|
| S-1 | 30 | PRA task 30 waits for A13 / A14 answers and PRA spec v1.2 in the repo (spec Appendix P.5; O1, O2) | — | waiting A13 / A14 / PRA spec v1.2 |

## Readings (AD rows; IR-n numbers continue from the last board, handbook §11)

AD-0 … AD-20 are the plan readings PL-0 … PL-20 (`05-plan.md` §10, text there). The integrator's own readings take IR-26 onward.

| AD | Reading | Status (proposed / ruled) |
|---|---|---|
| AD-0 | PL-0 — spike is a plan gate (two halves, PL-19) | ruled (D-2) |
| AD-1 | PL-1 — rows H-4, Q-7, P-5 get tasks P0.4b, P0.13b, P0.17b (HIGH) | proposed |
| AD-2 | PL-2 — task 26 split 26a / 26b | proposed |
| AD-3 | PL-3 — task 32 split 32a / 32b | proposed |
| AD-4 | PL-4 — tasks 5, 6, 7 + fixtures are integrator work in 0b; task 1 moved to 0a | proposed |
| AD-5 | PL-5 — kinds (task 9) call each command's exported `apply` | proposed |
| AD-6 | PL-6 — #15b struck, no test | proposed |
| AD-7 | PL-7 — letter ranges expanded to named tests | proposed |
| AD-8 | PL-8 — agent cap: none in 0a; ≤ 4 from 0b, integrator not counted | proposed |
| AD-9 | PL-9 — P0.1 re-takes 01d (v1.3.1 / v1.3.2 taken on `module-deeplinks`) without a STOP | proposed |
| AD-10 | PL-10 — task 35 (payment pad) is HIGH | proposed |
| AD-11 | PL-11 — 0b merge order: P0.7 before P0.5 / P0.6, P0.17 before P0.10 | proposed |
| AD-12 | PL-12 — settings / admin UI on existing page patterns without a 05 handoff | ruled (D-3) |
| AD-13 | PL-13 — staged fiscal DDL `outbox-ddl.sql` (6a), copied into the 05 migration by task 6 | proposed |
| AD-14 | PL-14 — 0a code ahead of its text bump (P0.3a, P0.9a) | proposed |
| AD-15 | PL-15 — task 3 split; 3a by a fresh implementer who did not write task 2 | proposed |
| AD-16 | PL-16 — a / b splits by what needs 0b | proposed |
| AD-17 | PL-17 — 30a skeleton under Appendix P.5 (TODO(STOP) for every unsettled field) | proposed |
| AD-18 | PL-18 — 29a owns `worker.ts`; P0.18 edits only `lib/boot.ts` | proposed |
| AD-19 | PL-19 — spike halves P0.Sa / P0.Sb | proposed |
| AD-20 | PL-20 — lane branches `lane-05<L>/05-<task>` | proposed |
| AD-21 (IR-26) | P0.B: no new ruleset for `module-05` — ruleset 27021396 already targets `refs/heads/module-*` with every W-1 rule. `module-05` was created by `git push origin 5d25a3a:refs/heads/module-05` (the REST `git/refs` POST is refused by the session proxy); same commit as `origin/main`, no content pushed | proposed |

## Acceptance map (Z1)

Seeded with the phase-0a halves (plan §7, §2A.3). Test names and states are filled as PRs merge.

| §10 test | Task (half) | Test name | State |
|---|---|---|---|
| §4.4 constants | 1 | `[05 §4.4] …` (16 tests, `packages/domain/src/billing/types.test.ts`) | green |
| #14c | P0.3a (exponent half) | | open |
| #10, #11, #11b, #12, #13, #20, #20b | 2 | | open |
| #13b | 2 (blocks half; close half in 17) | | open |
| #14 | 2 (rate-by-date half; P0.9b, 19 extend) | | open |
| #15 | 2 (compute half; P0.9b extends) | | open |
| #16 | 2 (spread + cap half; 13 extends) | | open |
| #10, #10d, #11c, #15e, #20c | 3a | | open |
| #16b, #16c | 3a (compute halves; 3b extends) | | open |
| #23 | 3a (payments half; 3b extends) | | open |
| 5a type tests | 5a | | open |
| 6a schema test | 6a | | open |
| #74 | 28a | | open |
| #69 | 28a (outbox-row half; 17 extends) | | open |
| #78, #78b | 28a (credit-rule halves; 19 extends) | | open |
| #70 | 29a (same-key half; 29b extends) | | open |
| #71 | 29a (re-run in 29b) | | open |
| #72 | 29a (back-off half; 31 extends) | | open |
| #77 | 29a (worker half; 31 extends) | | open |
| #34, #59, #61 | 4a (doc halves without QR / filler; 4b, 11, 17, 27 extend) | | open |
| #20 | 4a (rounding line on the receipt) | | open |
| #14c | P0.9a (defaults half) | | open |
| A-2 shape tests | P0.9a | | open |
| P-T1, P-T2 | 30a (settled clauses; 30 completes) | | open |
| spike-0a a, b, c | P0.Sa | `[05 spike-0a] …` | open |
