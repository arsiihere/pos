# 04 Voids + Audit — build board

Plan: `04-plan.md`. Gaps: `04-gaps.md` (ruled). Spec: `04_Voids_Audit_Spec_v1.0.2.md` (v1.0.1 landed in P0.2; v1.0.2 adds Q-12, Q-13 known gaps). Integration branch: `module-04`. Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-12 19:30: usage limit 16:40–19:30 PKT; lanes resumed. Saare upstream U (u1–u9) merged; a1 merged. V1 lane chal rahi (v5 #124 approved, v3 next). 20/37 done.
> - 2026-11-12 15:45: P0.9 spike GREEN (#102) → phase 0 complete. Lanes U1–U4, A1 khul gayi.
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
| P0.7 | #99 | merged `ee4d675` |
| P0.8 | #100 | merged `f499a33` |
| P0.9 | #102 | merged `01074ce`, GATE green |

## Upstream lanes (Cross)

| Lane | Task | Needs | PR | State |
|---|---|---|---|---|
| U1 | u1 | — | #104 | merged `3affdce` |
| U1 | u2 | — | #108 | merged `c1f5a40` |
| U1 | u3 | u1 | #114 | merged `7e41019` |
| U2 | u4 | — | #109 | merged `7c08aa6` |
| U2 | u5 | — | #117 | merged `cf19e98` |
| U3 | u6 | P0.6 | #105 | merged `ae69507` |
| U3 | u7 | — | #110 | merged `1302992` |
| U3 | u8 | P0.3 | #112 | merged `c78bc46` |
| U4 | u9 | P0.6 | #107 | merged `60035d5` |

## 04 lanes

| Lane | Task | Needs | PR | State |
|---|---|---|---|---|
| V1 | v3 | u1, u2, u4 | — | in progress (lane V1) |
| V1 | v4 | v3 | — | in progress (lane V1) |
| V1 | v5 | u1 | #124 | approved, merging |
| V1 | v6 | v4, v5, P0.4 | — | in progress (lane V1) |
| V1 | v7 | v6, u2, u7 | — | in progress (lane V1) |
| V2 | v8 | v6, u3, u8 | — | blocked on v6 |
| V2 | v9 | v8 | — | blocked on v6 |
| A1 | a1 | P0.3 | #106 | merged `489beb1` |
| A1 | a2 | a1, P0.5, P0.6 | #111 | in fix round |
| A1 | a3 | a2, u6 | — | not started (needs met) |
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
| 1 | 04 manual check: reject notice reaches the table holder (owner depth); an absent holder gets nothing; the holder card names no item (u7 review). | later, VU1 |

## AD rows (as-built decisions)

| # | Decision | Task | Approved |
|---|---|---|---|
| AD-1 | `apps/hub/src/projections/alerts.ts:204` still casts the `AlertRaised` payload as V3 (harmless; `details_json` keeps `disposition`); retype when a row touches it. | P0.4 | accepted (integrator) |
| AD-2 | The no-op `audit` projection writes its checkpoint at MAX(seq) with empty tables until a2. Only a hub booted on `module-04` between P0.7 and a2 would miss history, and none is real, because `module-04` reaches `main` only after a2. a2 adds `reset`. | P0.7 | accepted (integrator) |
| AD-3 | Reading: the 01d test `apps/hub/test/alerts/no-approver.int.test.ts` drops `VOID_KIND` in its second half (Cross edit; reviewer: legitimate, pins what this row changes). | P0.7 | accepted (integrator) |
| AD-4 | PR #90 was closed by mistake (opened on the old 03b branch `lane-P0/board`); 04 phase-0 branches are named `lane-P0/04-…`. | P0.1 | accepted (integrator) |
| AD-5 | Q-12: Manager named void approver by B-1 / backfill `0013` without an `approve-void` check — accepted gap, 04 v1.0.2 §12.6. | P0.6 | owner ruling 2026-11-12 15:05 |
| AD-6 | Q-13: station-less non-deal line rules stay defensive, tested on a synthetic `ItemAdded { station_id: null }` — accepted gap, 04 v1.0.2 §12.6. | P0.8 | owner ruling 2026-11-12 15:05 |
| AD-7 | 02b test #44 "1 statement" is the `lineChangeDrafts` count; `changeDrafts` with `keep` reads 0 (the caller passes the lines). Wording only, for the next 02b text bump. | u2 | accepted (integrator) |
| AD-8 | `staff_names.updated_at` = the last directory apply that saw the person ("last seen"). It is rewritten even when the name is unchanged. | u6 | accepted (integrator) |
| AD-9 | NIT follow-ups: `stock.ts:501` has an O(m²) set copy per move. No regression test of the ended set on a `StockAdded`/`StockSet` reserve inside a void array (a probe passed). Behaviour change: `StockAdded`/`StockSet` in an array with a void/remove skip ended lines. Correct by T-2 and unreachable today. | u4 | accepted (integrator) |
| AD-10 | When `result_also_to` throws on the PIN path, it records `RequestPinFailed { answer_failed }` and counts the PIN. An `apply` throw refused in `preRead` records nothing. Consequence of G-7 (the hook never runs in `preRead`). | u7 | accepted (integrator) |
| AD-11 | In the `boot-idset` "snapshot older than H" case, the void probe is now trivially quiet. NITs left. | u5 | accepted (integrator) |
| AD-12 | `resetLineGuard()` / `resetDayCloseGuard()` run right after `createTestHub()` in the 02b / 01a count tests, so v8's boot registration doesn't shift them. v8 must do the same for 02a merge-guard count tests. | u3, u8 | accepted (integrator) |
| AD-13 | Flaky pre-existing test `apps/cloud/test/…/leaving-race.int.test.ts` [01b B15] failed 2 of 5 runs during u9. Not caused by 04; watch it. | u9 | accepted (integrator) |

## Acceptance map (Z1)

Skeleton — filled at Z1: every story AC and §12.2 row → green test names; §12.6 gaps listed as "not built".

| Story / row | Tests | State |
|---|---|---|
