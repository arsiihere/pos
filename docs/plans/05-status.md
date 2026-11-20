# 05 Billing — build board

Plan: `05-plan.md`. Prompts: `05-parallel-prompts.md`. Gaps: `05-gaps.md` (written in P0.G, phase 0b). Spec: `05_Billing_Spec_v1.0.25.md` on `module-05` @ `8066f3bc`; v1.0.26 (R-87, G-88) in review as #408. Rulings and gaps after P0.G: `05-gaps.md`. Integration branch: `module-05`. Cleanup: `05-cleanup.md`. Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-21: Abhi khula kaam: **33** (startup wiring check) review mein; **27b** `PrintReport` review mein (abhi PR nahi), uska spec 05 v1.0.26 (#408, R-87 / G-88) bhi review mein; frontend **41** (day close + carry-over) intezar mein; **task 30** (PRA adapter) gated — A13 / A14 aur PRA spec v1.2 chahiye (S-1, O1, O2). Uske baad module close-out: DoD review, E2E (task 44), phir `module-05` → `main` (Z3, merge owner ka call).
> - 2026-11-21: Server kai baar restart hua; har baar watchdog ne agents wapas chala diye.
> - 2026-11-20: **Phase 05-2 hub done** — 21 (#385), 22 (#384), 23 (#387), 25 (#405), 26a (#398), 26b (#401), 32b (#402) aur money tests 3b (#394) merged → `module-05` @ `8066f3bc`. Handover `at` fix (#396, R-81) bhi aa gaya.
> - 2026-11-20: Plan gap mila: §6.22 `PrintReport` define karta hai lekin kisi task ne nahi banaya (task 27 sirf `PrintBillDocument`). G-87 (05 v1.0.25, #407) → naya plan row **27b**.
> - 2026-11-20: Review policy badli (W-7): HIGH tier ko ab **ek** fresh Opus reviewer milta hai, mutation checks ke saath; MAJOR ya money fix ke baad ek chhota re-check. W-6 ke do reviewers ab nahi.
> - 2026-11-20: CI parallel jobs mein split ho gaya (#360, W-8). Doosra frontend session ab lane 05C1 chala raha hai: 43a (#363), 34 (#364), 36 (#365), 38 (#373, #379), 37 (#375, #393), 35 (#377), 43b (#388), 39 (#400), 40 (#404), 42 (#406) merged.
> - 2026-11-20: Phase 0b poora (G0.4 #287 … P0.Sb #346) aur 05-1 hub merged: 4b, 8, 9, 10–20, 24, 27, 29b, 31, 31a, 32a (PRs neeche tables mein). 05-1 mein sirf task 30 (gated) baaki. Spec 05 v1.0.8 → v1.0.25 merged (R-46 … R-86, G-42 … G-87, `05-gaps.md`).
> - 2026-11-19: Owner ne 4 rulings diye (sab Rec: Q-A a, Q-B a, S-1 a, S-2 a). P0.9a (#276), task 2 + 3a (#284), 4a (#279) merged → `module-05` @ `8284919e`. Ab 0a mein sirf P0.Sa (spike) baaki hai, woh chal raha hai; 30a optional. Phase 0b owner ke "start 0b" ka intezar.
> - 2026-11-19: P0.3a (#281) aur poora fiscal stack 6a, 5a, 28a, 29a (#283) merged → `module-05` @ `89843a2d`. Task 2 (#282) aur P0.9a (#276) needs-ruling par: 4 sawal (Q-A, Q-B, S-1, S-2) owner ke paas. 3a (#284) task 2 ke saath merge hoga; 4a (#279) task 2 ka intezar kar raha hai.
> - 2026-11-19: **G0.2 met** — `module-deeplinks` #274 se `main` par aa gayi (`main` @ `cec8591b`). G0.3 scan ho gaya: hub migrations 0021+ free, cloud 0014 / 0015 ko #121 / #126 (`module-02-hub-gaps`) claim karte hain → 05 cloud 0016–0017 (plan wala hi); 01d `main` par v1.3.3 tak, to agla v1.3.4. Phase 0b tayyar hai, owner ke "start 0b" ka intezar. 0a lanes ka abhi tak koi PR nahi aaya.
> - 2026-11-18: P0.B (#265) aur task 1 shared types (#266) merged → `module-05` @ `57336af`. 0a lanes M, F, P khol do (prompts §2, §3, §4); PRA (§5) tab jab 28a ka PR khule. Phase 0b abhi bhi ruki: `module-deeplinks` ke 29 commits `main` par nahi.
> - 2026-11-18: G0.1 met (#219 `main` par, `5d25a3a`). `module-05` cut ho gayi `main` @ `5d25a3a` se; ruleset `module branches (03b onward)` pehle se `module-*` cover karta hai (W-1 wala hi). Labels ban gaye. Ye board + cleanup file (P0.B). Task 1 (shared types) chal raha hai; uska PR khulte hi 0a lanes (M, F, P) khol do. Phase 0b `module-deeplinks` ke `main` par aane tak ruki hai.

## Gates

| Check | State |
|---|---|
| G0.1 spec-05 on `main` | **met** — PR #219 merged, `main` @ `5d25a3a` (merge commit; second parent = `spec-05` @ `ed2365a`); `git merge-base --is-ancestor origin/spec-05 origin/main` succeeds (2026-11-18) |
| G0.2 `module-deeplinks` on `main` | **met** — 2026-11-19: PR #274 merged (`main` @ `cec8591b`); `git log origin/main..origin/module-deeplinks` is empty (`module-deeplinks` @ `6b96c98f` is an ancestor of `main`) |
| G0.3 claims scan (numbers found) | **done** 2026-11-19 (see "G0.3 scan" below) — no branch or open PR claims a number 05 needs beyond what the plan already expects |
| G0.4 `main` synced into `module-05` | **met** — PR #287 merged (`2a3950ab`), 2026-11-19 |

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
| W-6 | ~~HIGH tasks get two fresh Opus reviewers (reviewer 2 on money, races, privacy, statement counts).~~ Superseded by W-7. Fix rounds > 2 → STOP. Money MINORs are fixed before merge. |
| W-7 | Review policy (owner, replaces W-6's two reviewers): a HIGH task gets **one** fresh Opus reviewer who runs mutation checks; after a MAJOR fix or any money fix, a short re-check. |
| W-8 | CI gate split into parallel jobs (#360, owner ruling 2026-11-20; CLAUDE.md "Cloud sessions and CI"). A PR still merges only with the gate green. |

Plan decision log D-1…D-8: `05-plan.md` §0.

## Owner rulings on the spec during the build

| # | Ruling | When | Where it landed |
|---|---|---|---|
| R-1 | S-2 / **Q-A (a)**: an unresolved service-charge tax profile blocks close with `BILL_CLOSE_BLOCKED { reason: 'tax_unresolved' }` whose `order_item_ids` holds the literal `'service_charge'` while the split's charge > 0; never billed untaxed | 2026-11-19 | code #284 (`compute.ts` `SERVICE_CHARGE_ID`); spec sentence → 05 v1.0.2 (after P0.1) |
| R-2 | S-3 / **Q-B (a)**: the frozen discount is re-spread over the open `bill_discount_lines` on every read; a ±1 minor-unit move after a sibling close is accepted for v1.0 (screen recomputes, `expected_total_minor` from that view). Holding closed parts at `share_minor` may come later without a contract change | 2026-11-19 | code #284; note in §3.5 (2) → 05 v1.0.2 |
| R-3 | S-4 / **S-1 (a)**: A-1 (3) wire names `discount_reasons`, `petty_categories`, `receipt` (container) + `show` (toggles), `rate_overrides` | 2026-11-19 | code #276 (`packages/events/src/admin/billing.ts`); text → 01a v2.6 (P0.2c) |
| R-4 | S-5 / **S-2 (a)**: kind 'cash' ⇒ class 'cash' only (A-2 as written); a cash-class mode of another kind is allowed but is not "the cash mode" | 2026-11-19 | code #276; §4.4 comment ("⇔") corrected → 05 v1.0.2 |
| R-5 | Integrator rebases stopped lanes' stacks (additive export-line conflicts only) | 2026-11-19 | #284, #279 (union of `packages/domain/src/billing/index.ts` lines) |

R-6 … R-86 and G-1 … G-87 are not copied here: `05-gaps.md` ("Owner rulings on P0.G", "Owner rulings after P0.G" and the summary table); R-46 … R-86 / G-42 … G-87 landed in 05 v1.0.8 (#345) … v1.0.25 (#407). R-87 / G-88 (`PrintReport`, task 27b) come with 05 v1.0.26, #408, in review.

## Phase 0a (05's own work)

| Task | Lane | Tier | Needs | Branch | PR | Reviewers (R1 / R2 verdict) | State |
|---|---|---|---|---|---|---|---|
| P0.B | I | NORMAL | G0.1 | `lane-05I/05-p0.b` | #265 | docs (integrator, W-3) | merged `d2075f2` |
| 1 | I | NORMAL | P0.B | `lane-05I/05-1` | #266 | R1 Sonnet APPROVE (2 MINOR → cleanup C-1, C-2) | merged `57336af` |
| P0.3a | M | HIGH | — | `lane-05M/05-p0.3a` | #281 | R1 Opus CHANGES (1 MAJOR, closed) / R2 Opus APPROVE; re-check Opus APPROVE | merged `81c381e1` |
| 2 | M | HIGH | 1, P0.3a | `lane-05M/05-2` | #282 (closed, in #284) | R1 Opus CHANGES (1 MAJOR, closed) / R2 Opus CHANGES (MINORs fixed); re-check Opus APPROVE | merged via #284 (ruled R-1, R-2) |
| 3a | M | HIGH | 2 | `lane-05M/05-3a` | #284 | R1 Opus APPROVE / R2 Opus APPROVE | merged `455fdde3` (with 2; rebased by integrator, R-5) |
| 5a | F | HIGH | 1 | `lane-05F/05-5a` | #277 (closed, in #283) | R1 / R2 Opus CHANGES (MAJORs closed); re-check Opus APPROVE | merged via #283 |
| 6a | F | HIGH | — | `lane-05F/05-6a` | #278 (closed, in #283) | R1 Opus CHANGES (2 MAJOR, closed) / R2 Opus APPROVE; re-check Opus APPROVE | merged via #283 |
| 28a | F | HIGH | 5a, 6a | `lane-05F/05-28a` | #280 (closed, in #283) | R1 Opus APPROVE / R2 Opus CHANGES (1 MAJOR, closed); re-check Opus APPROVE | merged via #283 |
| 29a | F | HIGH | 28a | `lane-05F/05-29a` | #283 | R1 / R2 Opus CHANGES (MAJORs closed); re-check Opus APPROVE | merged `89843a2d` (with 6a, 5a, 28a) |
| P0.9a | P | NORMAL | 1, P0.3a | `lane-05P/05-p0.9a` | #276 | R1 Sonnet APPROVE | merged `4d3796ad` (ruled R-3, R-4) |
| 4a | P | NORMAL | 1, 2, 5a | `lane-05P/05-4a` | #279 | R1 Sonnet APPROVE | merged `8284919e` (rebased by integrator, R-5) |
| 30a (optional) | PRA | HIGH | 28a | `lane-05PRA/05-30a` | — | — | not started (optional; task 30 gated, S-1) |
| P0.Sa | I | HIGH | 2, 4a, 6a, 28a, 29a, P0.9a | `lane-05I/05-p0.sa` | #289 | see PR | merged `daa9532c` |

## Phase 0b (bumps, base, spike)

Waits for G0.2–G0.4 (plan §2B.1). Rows in plan order (§2B.2–§2B.6).

| Task | Lane | Tier | Needs | PR | State |
|---|---|---|---|---|---|
| P0.1 | I | NORMAL | G0.2–G0.4 | #288 | merged `600b0b22` (05 v1.0.1) |
| P0.G | I | NORMAL | P0.1 | #290 | merged `10a8c921` (`05-gaps.md`) |
| P0.1b | I | docs | P0.G | #292 | merged `03e1c29f` (05 v1.0.2) |
| P0.1c | I | docs | P0.1b | #302 | merged `da4b44e4` (05 v1.0.3, R-17 – R-19) |
| P0.1d | I | docs | P0.1c | #305 | merged `306ae919` (05 v1.0.4, R-20, R-21) |
| P0.2a | P0 | NORMAL | P0.1, P0.G | #299 | merged `c1e47318` (Foundation v1.14) |
| P0.2b | P0 | NORMAL | P0.1, P0.G | #293 | merged `e89cb37c` (00 v1.12) |
| P0.2c | P0 | NORMAL | P0.1, P0.G | #300 | merged `8bde5def` (01a v2.6) |
| P0.2d | P0 | NORMAL | P0.1, P0.G | #294 | merged `e1782efd` (01b v1.10) |
| P0.2e | P0 | NORMAL | P0.1, P0.G | #295 | merged `e44cc2d4` (01d v1.3.4) |
| P0.2f | P0 | NORMAL | P0.1, P0.G | #296 | merged `f6e59e13` (02a v1.1.8) |
| P0.2g | P0 | NORMAL | P0.1, P0.G | #301 | merged `898c8fc4` (02b v1.0.16) |
| P0.2h | P0 | NORMAL | P0.1, P0.G | #291 | merged `428090af` (03a v1.2.6) |
| P0.2i | P0 | NORMAL | P0.1, P0.G | #297, #308 | merged `c0b8aa90` (03c v1.0.11), `74db9d8d` (03c v1.0.12, R-22) |
| P0.2j | P0 | NORMAL | P0.1, P0.G | #298 | merged `c7495351` (04 v1.0.7) |
| P0.2k | P0 | NORMAL | P0.1, P0.G | #306 | merged `be352e95` (README) |
| P0.3b | U0 | HIGH | P0.2a, P0.2b, P0.3a | #311 | merged `610a73cd` |
| P0.3c | U0 | NORMAL | P0.2a, P0.1b | #310 | merged `c42472c3` |
| P0.4 | U0 | NORMAL | P0.2b | #313 | merged `860c7962` |
| P0.4b | U0 | HIGH | P0.4 | #320 | merged `0bb1c78d` |
| P0.5 | U0 | NORMAL | P0.2b, P0.7 | #327 | merged `0828d53b` |
| P0.6 | U1 | HIGH | P0.4, P0.7 | #331 | merged `2ec3ca2e` |
| P0.7 | U1 | HIGH | P0.2c, P0.2d, P0.2e | #318 | merged `7100926c` |
| P0.8 | U1 | NORMAL | P0.7 | #337 | merged `6fcec353` |
| P0.9b | U1 | HIGH | P0.3b, P0.2c, P0.9a | #328 | merged `5b3e5444` |
| P0.10 | U1 | NORMAL | P0.9b, P0.17 | #341 | merged `ba641fbe` |
| P0.11 | U2 | HIGH | P0.2f | #312 | merged `6bc87c47` |
| P0.11c | U2 | HIGH | P0.11 | #334 | merged `15a6786d` |
| P0.11d | U2 | NORMAL | P0.11 | #330 | merged `5cea0ef2` |
| P0.12 | U2 | HIGH | P0.2g | #315 | merged `944689d4` |
| P0.13 | U2 | HIGH | P0.12, P0.2h | #323 | merged `67b5fe59` |
| P0.13b | U2 | HIGH | P0.13 | #326 | merged `85877b71` |
| P0.14 | U2 | HIGH | P0.2g, P0.2j | #322 | merged `d7e530e5` |
| P0.15 | U2 | NORMAL | P0.2j | #319 | merged `07b0b8f7` |
| P0.16 | U3 | NORMAL | P0.2i, P0.12 | #333 | merged `bfb866bb` |
| P0.17 | U3 | HIGH | P0.16 | #324 | merged `3becf21b` |
| P0.17b | U3 | HIGH | P0.17 | #335 | merged `4d454bcc` |
| P0.19a | I | HIGH | P0.1b | #304 | merged `7348dade` |
| P0.19b | I | HIGH | P0.1b, P0.19a | #307 | merged `5d7c8be2` |
| P0.19c | I | HIGH | 2, 3a, P0.Sa | #309 | merged `ebf14809` |
| P0.19d | I | HIGH | P0.19c | #314 | merged `8d59a66a` |
| 6 | I | HIGH | P0.1b, P0.19a–d (§2B.5 sequential) | #339 | merged `93d95dbc` (migration 0023) |
| 5 | I | HIGH | P0.1b, P0.19a–d (§2B.5 sequential) | #340 | merged `9d43332e` |
| P0.F | I | NORMAL | §2B.5 sequential | #342 | merged `46f6efdd` |
| 7 | I | HIGH | §2B.5 sequential | #343 | merged `e09050fc` |
| P0.18 | I | plan §2B.5 | 7 | #344 | merged `f3c359e7` |
| P0.Sb | I | HIGH | 5, 6, 7, P0.F | #346 | merged `0d964dc4` |

Other 0b-era PRs: 0b prompts #303, design brief #316 (05 §8, §9), spec bumps #317 (05 v1.0.5), #321, #325, #329, #332, #336, #338, #345, #347.

## 05-1 lanes

| Lane | Task | Tier | Needs | PR | Reviewers (R1 / R2 verdict) | State |
|---|---|---|---|---|---|---|
| T | 3b | HIGH | 2, 3a, 12, 13, 16, 17, 24 | #394 | see PR | merged `6c8b9227` (found the handover-`at` bug → R-81, fix #396 `93240e01`) |
| K | 9 | HIGH | P0.7, 5 | #348 | see PR | merged `6e904e59` (PL-5 seam, AD-5) |
| S | 8 | HIGH | 7 | #350 | see PR | merged `7de02ac8` |
| S | 15 | HIGH | 8, 9 | #355 | see PR | merged `a337d31c` |
| B1 | 10 | HIGH | 2, 7, P0.3c | #351 | see PR | merged `1c8fc85b` |
| B1 | 12 | HIGH | 10 | #357 | see PR | merged `3fc8564f` (+ migration 0024, #358 `6a15c3e6`, R-56) |
| B1 | 13 | HIGH | 12, 9 | #368 | see PR | merged `98b6730e` |
| B1 | 14 | HIGH | 10, 9 | #361 | see PR | merged `ca00ce7f` |
| B1 | 20 | HIGH | 10, 9, P0.13, P0.14 | #369 | see PR | merged `727ddfcc` |
| B2 | 16 | HIGH | 12, 15 | #367 | see PR | merged `7fc7b8b9` |
| B2 | 17 | HIGH | 16, 13, 14, 4b, P0.16, P0.17b, P0.19a, P0.19c | #371 | see PR | merged `32547107` |
| B2 | 18 | HIGH | 17, 9, P0.4b | #381 | see PR | merged `ab1f81c4` |
| B2 | 19 | HIGH | 17, 9, P0.11, P0.13, P0.13b | #395 | see PR | merged `3884365b` |
| B2 | 24 | HIGH | 17, P0.11, P0.14 | #390 | see PR | merged `eb1eb66d` |
| P | 4b | NORMAL | 4a, P0.17, P0.17b, P0.19a, P0.19c, P0.19d | #352 | see PR | merged `258438e5` |
| P | 11 | NORMAL | 4a, 10, P0.16 | #366 | see PR | merged `10922a8a` |
| P | 27 | HIGH | 17, 4b, P0.17, P0.17b | #374 | see PR | merged `773431ff` |
| P | 27b | HIGH | 26b, 25 | — (spec #408) | — | **in review** — new plan row (G-87, 05 v1.0.25); `PrintReport`, R-87 / G-88 in 05 v1.0.26 (#408) |
| F | 29b | HIGH | 29a, 5, 7, P0.18, P0.19b | #349 | see PR | merged `0420098a` |
| F | 31 | HIGH | 29b, 9 | #370 | see PR | merged `ae9f5943` |
| F | 31a | HIGH | 28a, P0.4b, P0.5 | #382 | see PR | merged `f58d107a` |
| PRA | 30 | HIGH | 30a, 29b, O1, O2 | — | — | **gated** (S-1: A13 / A14, PRA spec v1.2) |
| A | 32a | NORMAL | 6, P0.15 | #378 | see PR | merged `20cddc67` |

## 05-2 lanes

| Lane | Task | Tier | Needs | PR | Reviewers | State |
|---|---|---|---|---|---|---|
| S | 21 | HIGH | 15, 9 | #385 | see PR | merged `029caa96` (quote-style follow-up #392 `900ab450`) |
| S | 22 | HIGH | 15, 9 | #384 | see PR | merged `68fa169e` |
| S | 23 | HIGH | 15, P0.16 | #387 | see PR | merged `5e60d165` |
| Z | 26a | HIGH | 8, 17, 19, 21, 22 | #398 | see PR | merged `6bdeabba` |
| Z | 25 | HIGH | 26a, P0.6, P0.13 | #405 | see PR | merged `31305057` (migration 0025, R-85) |
| Z | 26b | HIGH | 25 | #401 | see PR | merged `fb8404fe` |
| A | 32b | NORMAL | 21–23, 25 | #402 | see PR | merged `a116af97` |
| A | 33 | HIGH | 32b | — | — | **in review** (G-86 readings in 05 v1.0.25) |

## Client

| Lane | Task | Tier | Blocked on | PR | State |
|---|---|---|---|---|---|
| C1 | 34 | NORMAL | 10, handoff | #364 | merged `78344e96` |
| C1 | 35 | HIGH | 16, 17, handoff | #377 | merged `23f488dc` |
| C1 | 36 | NORMAL | 12, handoff | #365 | merged `ef65149f` |
| C1 | 37 | NORMAL | 13, 14, 18, handoff | #375, #393 | merged `6f5f31c8` (discount / service charge), `5167561a` (buyer sheet) |
| C1 | 38 | NORMAL | 27, handoff | #373, #379 | merged `aea43d6a` (print status), `f0fd92dc` (Print to picker, reprints) |
| C1 | 43a | NORMAL | 5, 9 | #363 | merged `77afadd3` |
| C2 (run by the 05C1 session) | 39 | NORMAL | 21, handoff | #400 | merged `5217e9b9` |
| C2 (run by the 05C1 session) | 40 | NORMAL | 22, handoff | #404 | merged `fed7c630` |
| C2 (run by the 05C1 session) | 41 | NORMAL | 25, handoff | — | **waiting** |
| C2 (run by the 05C1 session) | 42 | NORMAL | 26b, 31, handoff | #406 | merged `5a0f9148` |
| C2 (run by the 05C1 session) | 43b | NORMAL | 5 | #388 | merged `0022ec14` |

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

## Cleanup still open (on top of `05-cleanup.md`)

| # | From | Finding → action | Who fixes |
|---|---|---|---|
| CL-1 | — | `ZReportIssued` audience: owner row still to add | integrator / Z |
| CL-2 | #344 (P0.18) | Follow-up: boot's catch block leaves heartbeat / sweeper / tick / print running if a later step throws (pre-existing) | follow-up PR |
| CL-3 | #349 (29b) | 29a's unconditional clear after `onAnswer` could overwrite `last_error` on an already-rejected row (cannot happen today: passes never overlap) | next change to `worker.ts` / Z |
| CL-4 | 3b (#394) | The bill view's split `plan` does not show later rounds; spec silent | Owner? |
| CL-5 | G-81 (R-82) | Commands set `occurred_at` from hub time, foundation v1.13 §4.1 says device clock; no code change now | waits on a later foundation bump |
| CL-6 | G-72 (extended by R-79, R-85) | Later 01a, 02a, 02b and 04 bumps: their statement counts are "plus the registered hooks' and guards' statements" | those modules' next bumps |
| CL-7 | G-68 (R-69) | 04 §5's audit subject list gains `hub`, `item` and `zone` | 04's next bump |

## STOPs / needs-ruling

| # | Task | Finding | Options + Rec | State |
|---|---|---|---|---|
| S-1 | 30 | PRA task 30 waits for A13 / A14 answers and PRA spec v1.2 in the repo (spec Appendix P.5; O1, O2) | — | waiting A13 / A14 / PRA spec v1.2 |
| S-2 | 2 (#282) | **Q-A** service charge whose tax profile does not resolve: §3.3 3a / §3.4 define `tax_unresolved` for lines only (`order_item_ids`); §3.3 3a "a config gap is never billed as untaxed". Code adds the literal id `'service_charge'` to the block while the charge > 0 | (a) keep, 05 v1.0.x adds one sentence that `order_item_ids` may hold `'service_charge'`; (b) new reason `service_charge_tax_unresolved` (contract value); (c) rely on A-2 and bill untaxed. **Rec (a)** | **ruled (a)** 2026-11-19 → R-1 |
| S-3 | 2 (#282) | **Q-B** frozen discount re-spread on every read: `bill_discount_lines` stores ids, not shares; ~2 % of cases a sibling close moves an open line's share ±1 minor (e.g. bases [504, 928, 412, 648], D 758, line 2 closed: [153, _, 126, 197] → [154, _, 125, 197]); with different rates the open split's tax can move 1 | (a) accept, note in §3.5 (2); (b) store shares at first close (contract change); (c) spread with closed parts held at `share_minor` (later, no contract change). **Rec (a)** | **ruled (a)** 2026-11-19 → R-2 |
| S-4 | P0.9a (#276) | **S-1** wire names A-1 (3) gives in prose only (spec line 790): discount reasons, petty categories, receipt template toggles, owner rate overrides | (a) `discount_reasons`, `petty_categories`, `receipt` + `show`, `rate_overrides`, written into 01a v2.6 by P0.2c; (b) other names. **Rec (a)** | **ruled (a)** 2026-11-19 → R-3 |
| S-5 | P0.9a (#276) | **S-2** §4.4 comment (line 751) kind 'cash' ⇔ class 'cash'; A-2 (line 791) only ⇒ | (a) ⇒ only; (b) ⇔. **Rec (a)** | **ruled (a)** 2026-11-19 → R-4 |

## Readings (AD rows; IR-n numbers continue from the last board, handbook §11)

AD-0 … AD-20 are the plan readings PL-0 … PL-20 (`05-plan.md` §10, text there). The integrator's own readings take IR-26 onward.

| AD | Reading | Status (proposed / ruled) |
|---|---|---|
| AD-0 | PL-0 — spike is a plan gate (two halves, PL-19) | ruled (D-2) |
| AD-1 | PL-1 — rows H-4, Q-7, P-5 get tasks P0.4b, P0.13b, P0.17b (HIGH) | proposed |
| AD-2 | PL-2 — task 26 split 26a / 26b | proposed |
| AD-3 | PL-3 — task 32 split 32a / 32b | proposed |
| AD-4 | PL-4 — tasks 5, 6, 7 + fixtures are integrator work in 0b; task 1 moved to 0a | proposed |
| AD-5 | PL-5 — kinds (task 9) reach each command's `apply` through the seam `kinds/seam.ts` `registerBillKindApply(kind, { apply })`: each command file registers at module top level (a module-level function, never a closure) and adds its import to `billing/index.ts`; an unregistered kind → `not built` (500 before any write, request stays open); `onWithdraw: () => []` (#348, integrator plan fix) | proposed (built #348) |
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
| AD-22 | #281 P0.3a: the table is ISO 4217 list one at amendment 180 (BGN withdrawn 2026-01-01; XCG, ZWG, SLE replace ANG, ZWL, SLL; CUC left out); an unknown code is refused, never mis-scaled | proposed |
| AD-23 | #277 5a: R-5a-1 … R-5a-5 (`fiscal.required` = this invoice is fiscalized; credit fields copied from the original; unstated nullability; line `name` kept; derived submission fields built by 29b) — text in the PR body | proposed |
| AD-24 | #278 6a: R-6a-1 … R-6a-3 (task 6 edits only `outbox-db.ts`; worker queries write literal `state = 'pending'` for the partial index; `INSERT OR IGNORE` swallows CHECK failures, so 28a validates first) | proposed |
| AD-25 | #280 28a: R-28a-1 … R-28a-9 (one `fiscal.required` flag; credit row from the original's row; `queued_at = issued_at`; fiscalized sale with null `pos_id` throws — task 17 must refuse at the command; `duplicate_no_number`; "secret" = `.meta({ secret })` on both JSON-Schema sides + credential-name collision; `canCredit` on the original's snapshot; own `none` settings schema until P0.9a) | proposed |
| AD-26 | #283 29a: R-29a-1 … R-29a-5 (strict order grouped by (`adapter_key`, `pos_id`); core short codes list; token-missing / load-failed rows re-checked without counting; 1 s loop, adapter owns timeouts — task 31's `RetryFiscalNow` must not await `runOnce`; 29b seam contract) | proposed |
| AD-27 | #276 P0.9a: R-1 … R-7 (table-free A-2 rules as `billingSettingsConfigIssue` → 422 `CONFIG_REFERENCE_INVALID`, shape stays Zod 400; cash mode = kind 'cash' (ruled R-4); adapter_settings ≤ 4 KB over the whole map; no invented bounds; `fiscal.switched_at` in the document, unknown keys stripped; `builtInBillingDefaults` takes the exponent from the caller; seed holds rule values only) | proposed |
| AD-28 | #282 / #284 task 2: RD-M1 … RD-M6 (`none` = no rounding, Rs 1 numbers under `PK`; `tax_unresolved` when either class lacks a rate; amount D capped at Σ bases before first close; amount plan uses `totals_default.total_minor`; per-line tax spreading is task 17's via `apportionMinor`; unknown `order_item_id` in an item plan ignored) | proposed |
| AD-29 | #284 3a: RD-M7 (shift halves of #15e / #23 and #10b / #10c are task 3b), RD-M8 (compound printed base incl. earlier full tax; rate row = latest `effective_from` ≤ business date; amount plan's last share re-based on the rounded default-class total) | proposed |
| AD-30 | #279 4a: R-1 … R-7 (`CheckBillDocInput` / `ReportDocInput` docs-local, hub maps `computeBill` Totals (task 12) and 26a's report onto them — **P0.G checks both shapes**; one "Total if paid by card" line; invoice number always prints; fiscal block only when `fiscal.required`; no buyer block until 4b; rounding line only when ≠ 0; "Closed by" label) | proposed |
| AD-21 (IR-26) | P0.B: no new ruleset for `module-05` — ruleset 27021396 already targets `refs/heads/module-*` with every W-1 rule. `module-05` was created by `git push origin 5d25a3a:refs/heads/module-05` (the REST `git/refs` POST is refused by the session proxy); same commit as `origin/main`, no content pushed | proposed |

## Acceptance map (Z1)

Seeded with the phase-0a halves (plan §7, §2A.3). Test names and states are filled as PRs merge.

| §10 test | Task (half) | Test name | State |
|---|---|---|---|
| §4.4 constants | 1 | `[05 §4.4] …` (16 tests, `packages/domain/src/billing/types.test.ts`) | green |
| #14c | P0.3a (exponent half) | `packages/domain/src/currency.test.ts` | green |
| #10, #11, #11b, #12, #13, #20, #20b | 2 | | open |
| #13b | 2 (blocks half; close half in 17) | | open |
| #14 | 2 (rate-by-date half; P0.9b, 19 extend) | | open |
| #15 | 2 (compute half; P0.9b extends) | | open |
| #16 | 2 (spread + cap half; 13 extends) | | open |
| #10, #10d, #11c, #15e, #20c | 3a | | open |
| #16b, #16c | 3a (compute halves; 3b extends) | | open |
| #23 | 3a (payments half; 3b extends) | | open |
| 5a type tests | 5a | `fiscal-snapshot.test.ts` | green |
| 6a schema test | 6a | `apps/hub/test/billing/fiscal/outbox.test.ts` | green |
| #74 | 28a | `port.test.ts` | green |
| #69 | 28a (outbox-row half; 17 extends) | `outbox.test.ts` | green (half) |
| #78, #78b | 28a (credit-rule halves; 19 extends) | `outbox.test.ts` | green (half) |
| #70 | 29a (same-key half; 29b extends) | `worker.test.ts` | green (half) |
| #71 | 29a (re-run in 29b) | `worker.test.ts` | green |
| #72 | 29a (back-off half; 31 extends) | `worker.test.ts` | green (half) |
| #77 | 29a (worker half; 31 extends) | `worker.test.ts` | green (half) |
| #34, #59, #61 | 4a (doc halves without QR / filler; 4b, 11, 17, 27 extend) | | open |
| #20 | 4a (rounding line on the receipt) | | open |
| #14c | P0.9a (defaults half) | | open |
| A-2 shape tests | P0.9a | | open |
| P-T1, P-T2 | 30a (settled clauses; 30 completes) | | open |
| spike-0a a, b, c | P0.Sa | `[05 spike-0a] …` | open |
