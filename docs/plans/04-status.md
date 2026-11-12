# 04 Voids + Audit — build board

Plan: `04-plan.md`. Gaps: `04-gaps.md` (ruled). Spec: `04_Voids_Audit_Spec_v1.0.2.md` (v1.0.1 landed in P0.2; v1.0.2 adds Q-12, Q-13 known gaps). Integration branch: `module-04`. Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-12: P0.2–P0.6 merged (#92, #94, #95, #96, #97); owner 'Dono rec' (15:05) — Q-12, Q-13 known gaps, 04 v1.0.2.
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
| P0.2 | #92 | merged `066cd7c` |
| P0.3 | #94 | merged `9418a70` |
| P0.4 | #95 | merged `21990d8` |
| P0.5 | #97 | merged `0d5f1cb` |
| P0.6 | #96 | merged `d45db7a` |
| P0.7 | #99 | in review |
| P0.8 | #100 | in fix round 1 |
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
| AD-1 | `apps/hub/src/projections/alerts.ts:204` still casts the `AlertRaised` payload as V3 (harmless; `details_json` keeps `disposition`); retype when a row touches it. | P0.4 | accepted (integrator) |
| AD-2 | The no-op `audit` projection writes its checkpoint at MAX(seq) with empty tables until a2. Only a hub booted on `module-04` between P0.7 and a2 would miss history, and none is real, because `module-04` reaches `main` only after a2. a2 adds `reset`. | P0.7 | accepted (integrator) |
| AD-3 | Reading: the 01d test `apps/hub/test/alerts/no-approver.int.test.ts` drops `VOID_KIND` in its second half (Cross edit; reviewer: legitimate, pins what this row changes). | P0.7 | accepted (integrator) |
| AD-4 | PR #90 was closed by mistake (opened on the old 03b branch `lane-P0/board`); 04 phase-0 branches are named `lane-P0/04-…`. | P0.1 | accepted (integrator) |
| AD-5 | Q-12: Manager named void approver by B-1 / backfill `0013` without an `approve-void` check — accepted gap, 04 v1.0.2 §12.6. | P0.6 | owner ruling 2026-11-12 15:05 |
| AD-6 | Q-13: station-less non-deal line rules stay defensive, tested on a synthetic `ItemAdded { station_id: null }` — accepted gap, 04 v1.0.2 §12.6. | P0.8 | owner ruling 2026-11-12 15:05 |

## Acceptance map (Z1)

Skeleton — filled at Z1: every story AC and §12.2 row → green test names; §12.6 gaps listed as "not built".

| Story / row | Tests | State |
|---|---|---|
