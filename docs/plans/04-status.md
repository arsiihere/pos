# 04 Voids + Audit — build board

Plan: `04-plan.md`. Gaps: `04-gaps.md` (ruled). Spec: `04_Voids_Audit_Spec_v1.0.md` (v1.0.1 lands in P0.2). Integration branch: `module-04`. Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-12: P0.1 — `module-04` cut from `main` @ ``3dee1b9``, labels `lane:U1–U4`, `lane:V1–V2`, `lane:A1`, `lane:T1` (`needs-ruling` already there), ye board.
> - 2026-11-12: gap sweep done (PR #89), 23 G-rows, owner "Your calls" (13:17) → har row Rec; plan patched.
> - 2026-11-12: spec 04 v1.0 APPROVED (11:58), plan ready.

## Owner rulings on how the build runs

Same as 03b (W-1–W-6, `03b-status.md`), for `module-04`:

| # | Ruling |
|---|---|
| W-1 | `module-04`: PR required, check `gate` required, rebase merge only, no force push. |
| W-2 | The integrator merges green, reviewed PRs into `module-04`. Stacked: top PR merged, the lower ones closed with a comment. |
| W-3 | The integrator merges green docs / spec PRs (incl. into `main`, e.g. the gap sweep). `module-04` → `main` is the owner's (merge commit); the integrator opens the PR. |
| W-4 | Lanes are background agents from the integrator session, ≤ 5–6 at once. |
| W-5 | Repo public: never commit a secret. |
| W-6 | HIGH tasks get two fresh reviewers (one on money, K-1 `alert_id`, races, statement counts). Fix rounds > 2 → STOP. |

## Phase 0

| Task | PR | State |
|---|---|---|
| P0.0 | #89 | merged `3dee1b9` (into `main`, W-3) |
| P0.1 | (board PR) | `module-04` cut `3dee1b9`, labels, board |
| P0.2 | — | not started (needs P0.1) |
| P0.3 | — | not started |
| P0.4 | — | not started (needs P0.3, G-22) |
| P0.5 | — | not started |
| P0.6 | — | not started |
| P0.7 | — | not started |
| P0.8 | — | not started |
| P0.9 | — | **GATE** — no lane opens until green |

## Upstream lanes (Cross)

| Lane | Task | Needs | PR | State |
|---|---|---|---|---|
| U1 | u1 | — | — | blocked (phase 0) |
| U1 | u2 | — | — | blocked (phase 0) |
| U1 | u3 | u1 | — | blocked |
| U2 | u4 | — | — | blocked (phase 0) |
| U2 | u5 | — | — | blocked (phase 0) |
| U3 | u6 | P0.6 | — | blocked (phase 0) |
| U3 | u7 | — | — | blocked (phase 0) |
| U3 | u8 | P0.3 | — | blocked (phase 0) |
| U4 | u9 | P0.6 | — | blocked (phase 0) |

## 04 lanes

| Lane | Task | Needs | PR | State |
|---|---|---|---|---|
| V1 | v3 | u1, u2, u4 | — | blocked |
| V1 | v4 | v3 | — | blocked |
| V1 | v5 | u1 | — | blocked |
| V1 | v6 | v4, v5, P0.4 | — | blocked |
| V1 | v7 | v6, u2, u7 | — | blocked |
| V2 | v8 | v6, u3, u8 | — | blocked |
| V2 | v9 | v8 | — | blocked |
| A1 | a1 | P0.3 | — | blocked (phase 0) |
| A1 | a2 | a1, P0.5, P0.6 | — | blocked |
| A1 | a3 | a2, u6 | — | blocked |
| T1 | t1 | v4, v7 | — | blocked |
| T1 | t2 | v7, u9 | — | blocked |

## Client

| Lane | State |
|---|---|
| UA | not started (free slot) |
| VU1 | BLOCKED — `docs/design/handoff/04/` |
| VU2 | BLOCKED — `docs/design/handoff/04/` |

## Close

| # | State |
|---|---|
| Z1 | not started |
| Z2 | not started |
| Z3 | not started |

## Owner — laptop / pilot list

| # | What | When |
|---|---|---|
| — | nothing yet | — |

## AD rows (as-built decisions)

| # | Decision | Task | Approved |
|---|---|---|---|

## Acceptance map (Z1)

Skeleton — filled at Z1: every story AC and §12.2 row → green test names; §12.6 gaps listed as "not built".

| Story / row | Tests | State |
|---|---|---|
