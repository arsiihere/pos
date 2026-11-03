# 03a status board

Plan: `docs/plans/03a-plan.md` (53 tasks, batches 0–11). Spec: `docs/specs/03a_Timing_Engine_Spec_v1.0.md`, with foundation v1.9, 00 v1.7 (H-1, H-5, H-6), 01a v2.1 (A-1–A-20; §12.3 Q-v2.1-1 / Q-v2.1-2 answered 2026-11-03), 01b v1.5 (B-1–B-8). Branch `module-03a`.

> **Short Hinglish summary — padhein yahan se**
>
> *(controller fills this in at each checkpoint: kya bana, kya bacha, aapko kya decide karna hai)*

## Rules for this board

- One batch entry per checkpoint (format below), committed alone: `docs(03a): checkpoint batch N`, then `git push origin module-03a`.
- Gate per batch: `pnpm -w typecheck && pnpm -w lint && pnpm -w test` (controller only, one run at a time). From task 18 on the `perf` project is part of `pnpm -w test`, and its numbers are copied into the §7.1 table at every checkpoint.
- **The gate (task 18):** no task of batch 6 or later starts until every §7.1 row below that task 18 measures is filled and green. A miss stops the build for a spec bump (03a §7.1, §12.5).
- Deviations are **proposed** `AD-n` rows here and in `docs/reviews/03a-auto-decisions.md`; folded into the spec only at task 29.

## §7.1 performance (gate: task 18; pilot box: task 28)

| Path | Target | Drill (Python, seed 7) | CI (task 18) | Pilot box (task 28) |
|---|---|---|---|---|
| Re-plan per submit p99 | ≤ 50 ms | 641.3 ms (pessimistic, not the gate) | — | — |
| Lines re-placed per station re-plan p50 / p99 / max | reported; CI bound set by P-11 | 60 / 650 / 685 | — | — |
| Re-placed-lines bound asserted (P-11) | `ceil(1.2 × p99 / 10) × 10` | — | — | — |
| Overload day (tandoor 125 %): probes / p99 | ≤ 16 / ≤ 50 ms | — | — | — |
| 20-line `StockAdded` at peak (BF-7) | inside 50 ms | — | — | — |
| Snapshot serialise (task 18) / full write (task 21) | ≤ 50 ms | — | — | — |
| Full-day replay from a checkpoint | ≤ 45 s | 284.7 s (Python) | — | — |
| 2-day replay (steps 2–3) | ≤ 80 s | — | — | — |
| Events replayed per day | ≈ R6 ± 20 % | 65 876 | — | — |
| Live = replayed (generated day) | equal | — | — | — |
| `fires` pass with work p99 | ≤ 20 ms | — | (test 62) | — |
| `fires_alerts` pass with work p99 | ≤ 20 ms | — | (tests 76, 93) | — |
| Crash restart ≤ 500 events (steps 2–3) | ≤ 2 s | — | (test 64) | — |
| `stations-live` | ≤ 5 ms, 0 statements | — | (test 66) | — |
| Boot steps 4–8 | ≈ 10 s budget | — | — | — |
| `events_branch_stream` build over a month | ≈ 1 s / month | — | — | — |

## Tasks

| Task | Batch | RISK | Status | Commit | Tests | Note |
|---|---|---|---|---|---|---|
| 0 | 0 | NORMAL | TODO | | — | autobuild rules, deny list, F §6.2 / 01a §9 appends |
| 1 | 1 | NORMAL | TODO | | #103, #114 fixture | |
| 1b | 1 | NORMAL | TODO | | [03a §4.2] | |
| 2 | 1 | NORMAL | TODO | | [03a §9] | |
| 3 | 1 | NORMAL | TODO | | #56 | perf project created (P-4) |
| 4 | 1 | HIGH | TODO | | [03a §3.3 profile], RF 1 | |
| 6 | 2 | HIGH | TODO | | #16, #18, #19, #43, RF 4 | |
| 7 | 2 | HIGH | TODO | | #17, #31, F #1, #2, #5–#7, #10, BF-2 | |
| 8c | 2 | HIGH | TODO | | #51, #96, #115, #116, F #4, #8 | runs before 8 |
| 8 | 2 | HIGH | TODO | | #20–#23, #89, #91, #98, RF 2 | |
| 8a | 2 | HIGH | TODO | | #75, #80, #114 engine | |
| 8b | 3 | HIGH | TODO | | #49, #78, #81, #99, #101 engine, #111 engine, BF-6 | |
| 9 | 3 | HIGH | TODO | | #24, #25, #90 | |
| 10 | 3 | HIGH | TODO | | #26, #27 | |
| 11 | 3 | HIGH | TODO | | #28–#30 | |
| 13 | 3 | HIGH | TODO | | #44, F #3, #9, #14, #15 | |
| 12 | 4 | HIGH | TODO | | #39, #41, #74 engine, #102, #117, #119, 01a #129, BF-12, BF-13 | |
| 12b | 4 | HIGH | TODO | | #40, #42, #84, #87, #88, #104, #105, #109, #118, BF-1, BF-7, BF-8, BF-9 | |
| 14 | 4 | HIGH | TODO | | #32, #52, #62 engine, #110, #111 tick, F #12, #13, BF-5, RF 3 | |
| 15 | 4 | HIGH | TODO | | #35, #36, #92, #106, BF-3, BF-4, BF-10, BF-14 | |
| 15b | 4 | NORMAL | TODO | | #37, #38, #77 engine | |
| 16 | 5 | HIGH | TODO | | #34, #45, #97, #100, #107 engine, #108, F #11 | |
| 16b | 5 | NORMAL | TODO | | #33, #46–#48, #50 | |
| 17 | 5 | HIGH | TODO | | #53–#55, #94 | |
| 18a | 5 | NORMAL | TODO | | [03a §10.6 harness] | |
| 18 | 5 | HIGH | TODO | | §10.6 perf asserts | **GATE** |
| C1 | 6 | NORMAL | TODO | | [01a §5.2a] | cloud `0007_engine_config.sql` |
| C2 | 6 | NORMAL | TODO | | [01a §6.9 A-2–A-10] | |
| C3 | 6 | NORMAL | TODO | | [01a §6.9a], Q-v2.1-1, Q-v2.1-2 | |
| C4 | 6 | NORMAL | TODO | | [01a §6.13, §6.15] | |
| C5 | 6 | NORMAL | TODO | | [01a §4.3 V3] | |
| C6 | 7 | NORMAL | TODO | | [01b B-8], [01a §4.3 V3] | |
| C7 | 7 | NORMAL | TODO | | [01b B-6] | |
| C8 | 7 | NORMAL | TODO | | UI | |
| C9 | 7 | NORMAL | TODO | | UI | |
| 19 | 8 | NORMAL | TODO | | [03a §5.1] | hub `0007_engine.sql` |
| 20 | 8 | HIGH | TODO | | #57, #58, #64, #85, [00 H-1], RF 5 | |
| 21 | 8 | HIGH | TODO | | #61, #112 | |
| 22 | 8 | HIGH | TODO | | #60, #62 hub, #63, #71, #73, #79, #95, #111 hub | |
| 22a | 8 | HIGH | TODO | | #76, #82, #86, #93, #113, BF-4 hub | |
| 22b | 9 | NORMAL | TODO | | #83 | |
| 23 | 9 | NORMAL | TODO | | #65, #67, #72, #77 hub | |
| 24 | 9 | NORMAL | TODO | | #70 | |
| A14 | 9 | HIGH | TODO | | [01a §6.17, §6.17a, §6.18b A-14] | |
| R2 | 9 | NORMAL | TODO | | [00 H-5, H-6] | hub `0008_device_point_lane.sql` |
| R1 | 10 | NORMAL | TODO | | [01b B-1, B-2, B-3, B-5] | |
| R1b | 10 | NORMAL | TODO | | [01b B-4] | cloud `0008`, hub `0009_run_station.sql` |
| 25 | 10 | NORMAL | TODO | | #68 | |
| 25b | 10 | NORMAL | TODO | | #69 | |
| 26 | 10 | NORMAL | TODO | | #66 | |
| 27 | 11 | HIGH | TODO | | #59, #74 hub | |
| 28 | 11 | — | TODO | | manual | needs the pilot mini PC |
| 29 | 11 | — | TODO | | — | final review, as-built v1.1 draft |

## Deviations (AD-n, proposed)

| # | Task | Problem | Options | Choice | Why | Files |
|---|---|---|---|---|---|---|
| — | — | *(plan-time rows below are written to `docs/reviews/03a-auto-decisions.md` at the batch 1 checkpoint)* | | | | |

Plan-time proposals (plan "Plan decisions" and "BF placement"), to become AD rows at the named checkpoint:

- P-5 `liveInterval(state, order_item_id, t)` (spec writes `liveInterval(line, t)`) — batch 2.
- Review Focus 1: a line whose units exceed effective capacity occupies the whole station — batch 1.
- BF-9 option "re-reserve in the new unit"; BF-10 option "narrow the claim" — batch 4.
- P-11 re-placed-lines bound rule — batch 5 (task 18).
- P-12 `@pos/engine/sim` test-only subpath export — batch 5.

## Open items

1. Command halves of #101, #103, #107 (`409 RETURN_ALREADY_OPEN`), #114 → 02 (README "To 02" #1, #8).
2. No owner-app screen to assign `run_station` (01b v1.5 defines none); API only until specified.
3. H-5 / H-6 write-time checks → 03b's pairing / binding UI (and 01e).
4. Task 28 needs the pilot mini PC.
5. 03a §12.3 Q12 (customer's own wrong order) still open; 02 / 04, not blocking.

## Batch entries

*(one per checkpoint, newest last)*

```
## Batch N — <title> (<date>)

- **Tasks:** …
- **Commits:** `<sha>` (task), …
- **Reviews:** HIGH tasks: full opus review each; NORMAL: paired. Findings and fix commits.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — <files>, <tests>, <wall time>; perf project numbers (from task 18) copied into §7.1 above.
- **Tests closed:** …
- **AD rows (proposed):** …
- **Carried to later tasks:** …
- **Open items:** …
```
