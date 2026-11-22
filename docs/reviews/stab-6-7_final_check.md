# Final spec check: STAB-6 / STAB-7 before the build

- **Branch:** `fix/stab-tablet-pairing` @ `e656560e` (re-review fix commits `ff9689d6`, `33c20c1d`, `e656560e`).
- **Read:** `CLAUDE.md`; both reviews and their Resolution tables; the three diffs; 03a v1.2.9 against v1.2.8 (§3.3 BQ-4, §3.5.3, §3.5.7 PR-1 to PR-5, §3.6.1, §3.10 BQ-5, §6.2a step 7, tests 92, 153, 166 to 177); 01a v2.7.5, 01c v1.1.4, 01b v1.10.3 and 03b v1.0.14 against the versions before them; foundation v1.15 rows P-1 to P-4 and §6.2; 02b v1.0.24; README; `docs/plans/stab-6-7-plan.md`.
- **Code checked for buildability:** `packages/engine/src/slip.ts` (`groupCrossing`, `firedCrossing`, `exitTime`, `touchedKeys`) and `apps/hub/src/engine-host/fires-alerts-tick.ts` (`due`, `noteAlertFacts`, `skipped`).

## Verdict: READY WITH WORDING FIXES

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| MAJOR | 1 (a one-term text fix) |
| MINOR | 3 |
| Flag (owner) | 1 |

R-1 to R-4 and every minor are resolved, with one gap in R-1 (FC-1). The R-2 parking design is deterministic and safe on replay (below). The ranges, the `400` status and the README versions agree across specs. The plan cites the new versions, keeps the gate green task by task and covers every new or changed test. Per re-review m-9, the fixes below go into **new patch versions** (03a v1.2.10; the plan updated to match), not into v1.2.9 in place.

## Check 2: the R-2 design (answers)

- **Deterministic and safe on replay: yes.** `priority_due` is computed from the state alone, from `placed_at` (R-3, test 177). `LinePrioritized` is a fact that a tick writes. Its fold reads only the state and `recorded_at` (`priority_at`, `priority_delay_ms = delay(g, recorded_at)`, `T_p` with `F(g, t)` at the fold's `t`). Replay folds the written events and never calls `getAlertIntents`, so it produces the same `LinePrioritized` effects. `priority_parked` changes only *when* an event is written, not what a fold does with it, the same way tick phase does today. Snapshot + replay = full replay is unaffected.
- **Idle kitchen: no transaction**, provided `due` evaluates condition 3 in memory (see FC-2). A restart clears the map, and the reconcile pass is due anyway.
- **Parked forever: no.** A `null` `recheck_at` is exact on a constant state, so the next change needs a fold: a Done or Start (as in test 168 (b) and (c)), a re-plan, or a restart. One gap can delay a group past its true recheck time (FC-3). It is bounded by the next commit, but it is not exact.

## MAJOR

### FC-1 The onset key lets a newer order with a jump in its estimate overtake an older priority group, so the PR-4 bound is false (03a v1.2.9 §3.5.7 PR-4 "The priority order" and its bound; tests 167, 174)

- **Problem:** `onset = priority_at − priority_delay_ms` is the moment lateness began only while `E_w` rises with slope 1. A hidden line whose planned land a re-plan pushes far out has a constant estimate. Its stored delay is the whole jump, so its onset falls *before its order existed*.
- **Failure:** A (T 12:00) slides from 12:00 and is prioritised at 12:05:00.1, so its onset is 12:00. B is placed at 12:20 (T 12:40). At 12:21 a capacity drop moves B's hidden land to 13:10. `priority_due` = `placed_at` ≤ now, so B is drafted with a 30 min delay and an onset of 11:51. B ranks ahead of A and pushes A's `priority_land_ms` later. That breaks "never again by a newer one" and "such groups exist when it is prioritised". Each later order with a big enough jump can do the same. Test 174's property ("overtaken only by an earlier onset") still passes, because it is true by definition of the key.
- **Fix:** `onset(g) = max(priority_at − priority_delay_ms, arrival(g))`, where `arrival(g)` = the `arrived_at` of g's first listed line (already in v5, so ENGINE_STATE_VERSION stays 5). The bound then holds: only groups listed before A's onset can rank ahead of A, and that set is finite and known when A is prioritised. Add a case to 167 (the example above: A stays first) and to 174 ("a group listed after A's onset never overtakes A").
- **Owner decision?** No. This is the owner's "first come, first served", made exact.

## MINOR

| # | Where | Problem | Failure scenario | Fix | Owner? |
|---|---|---|---|---|---|
| FC-2 | 03a v1.2.9 §3.5.7 PR-3 "Host", §6.2a step 7; plan task 23 | The un-park rule ("a commit whose folds touch g or the in-flight lines of a station that holds a line of g") needs the engine's internal `touchedKeys` set. That set is per table key, not per group, and it is not exported. The host sees only `noteAlertFacts(state, appended)`. No engine task exports it. Separately, after an un-park, `due` reads `priority_due[g] ≤ now` and a pass runs (step 1 opens its transaction, 2 `listOpen`) even when condition 3 still fails | The builder invents an export in task 23 outside the spec, or misses an un-park case. In a busy kitchen, each commit that touches a parked group costs one empty pass with a transaction | Un-park every parked group at **any** commit (a superset is safe, because parking is only a scheduling hint). Have `due` evaluate condition 3 in memory for every group with `priority_due ≤ now` (`due` already calls `getAlertIntents(state, now)` every pass for the overload check) and park the failures there, so no pass opens without a draft. Update test 153 (4) and the hub part of 168 | no |
| FC-3 | 03a v1.2.9 §3.5.7 PR-3 "The search" | The text says a fired-not-started packed end is "non-decreasing" and then that it "may step down" when an order ahead exits. An abandon exit (`exitTime`, AD-13) happens by time alone, with no commit, so the knee-and-up-step walk does not see the drop in `F` | A group is parked with a `recheck_at` that is too late, or `null`, after an abandoned order ahead frees the tandoor. It waits until the next commit that touches it, or a restart | Add as breakpoints of the walk the exit instants (`exitAt`) of orders with in-flight lines on the stations of g's fired lines. This becomes moot if FC-2's "`due` evaluates condition 3 every pass" is adopted | no |
| FC-4 | Foundation v1.15 P-2 ("the configuration 01a v2.7.4"), P-1/P-2 "bounded"; 01c v1.1.4 §4.3 code comment (old "60 000–7 200 000" line kept above the new one) | The pointers name superseded versions. "Bounded" is true only with FC-1 fixed. Not wrong today, because the v1.2.9 / v2.7.5 rows say the pointers name the rule's first version | A reader of the foundation opens 01a v2.7.4 and sees the 120 min range | No foundation bump now. Refresh the pointers at the next foundation version. Optionally mark the old 01c comment line "was (v1.1.3)" | no |

## Flag (raised for the owner, not decided)

| # | Where | Point |
|---|---|---|
| FL-1 | 01a v2.7.5 MD-2′, §5.2a; 01b v1.10.3 §6.10; 01c v1.1.4 §4.3; 03a v1.2.9 PR-1 | The owner's F-1 answer named only the **item** range. The writer also capped the **branch default** at 30 min, because 02b copies the default onto the same `ItemAdded.max_delay_ms`, and one schema range cannot tell an item value from a default. A 45 min default would also be later than "No limit". To keep the default at 1 to 120 min instead, 01c would need a second field or a wider schema, and the "No limit is the most lenient" rule would not hold for the default. **Owner decision?** Yes: confirm the 30 min cap on the default |

## Check 3 and 4 (no finding)

- **Ranges:** 60 000 to 1 800 000 for the item and the default in the 01a CHECKs, API and form (1 to 30 minutes), the 01b `PATCH`, the 01c Zod schema and 03a PR-1. Tests 01a 202 to 205, 01b 115, 01c 130 and 03a 166 pin both ends. No stale range is left without a marker. 02b v1.0.24 carries no range.
- **Status code:** `400 VALIDATION_FAILED { field }` everywhere: 01a MD-4 and §6.15, including the `true` + number combination by `superRefine`, 01b §6.10 and test 115. This matches foundation v1.15 §6.2.
- **README:** rows F (v1.15), 01a (v2.7.5), 01b (v1.10.3), 01c (v1.1.4), 03a (v1.2.9), 02b (v1.0.24) and 03b (v1.0.14), with the earlier versions linked. The three commits added new files only, so no approved version was edited in place (m-9).
- **Foundation v1.15:** P-1 to P-4 still read true ("with a waiting line causing it", the `fires_alerts` writer, priority first in a re-plan), subject to FC-1 for "bounded".
- **Plan:** every task cites the new versions (tasks 34 and 35, the gate and the owner checks, cite none, which is fine). Re-review m-7 is applied: #148's priority part and #155 are in task 17, and the `next_alert_due_at` part of #92 is in task 23. Tests 174 to 177 are in tasks 18, 17, 16 and 14. #172 is in `test:perf` only. Each event lands on the replay list with its fold (task 16), and the writer comes after the fold (task 23). The gate stays green task by task. Missing: only FC-2's un-park mechanism (task 23).

## Resolution (2026-11-23)

The owner answered every recommendation on 2026-11-23 ("all recommendation") and flag FL-1 with "haa!" (yes). The fixes are a new patch version, **03a v1.2.10** (v1.2.9 kept unchanged as approved history, re-review m-9), marked "⚠️ Changed by v1.2.10 (owner 2026-11-23, …, FC-n)" with the v1.2.9 text kept.

| # | Answer | Where |
|---|---|---|
| FC-1 | Fixed as recommended: `onset(g) = max(priority_at − priority_delay_ms, arrival(g))`, `arrival(g)` = the `arrived_at` of g's first listed line (already v5); the PR-4 bound restated; test 167 gains the jump case (A stays first), test 174 asserts "a group listed after A's onset never overtakes A" with `arrival` read from the state and capacity drops in the harness, so it fails without the rule | 03a v1.2.10 §3.5.7 PR-4, §3.5.3 note; tests 167, 174 |
| FC-2 | Fixed as recommended: any commit un-parks every parked group; `due` evaluates condition 3 in memory for every group with `priority_due ≤ now` (not parked, or parked with `recheck_at ≤ now`) and parks the failures there; no empty pass | 03a v1.2.10 §3.5.7 PR-3 "Host", §6.2a step 7; tests 153 (4), 168 hub part; plan task 23 |
| FC-3 | Fixed as recommended (kept although FC-2 is adopted, because an abandon exit needs no commit and `due` would only see it at the old `recheck_at`): the `recheck_at` walk also breaks at the exit instants (`exitAt`) of orders with in-flight lines on the stations of g's fired lines | 03a v1.2.10 §3.5.7 PR-3 "The search"; test 168 (d); plan task 14 |
| FC-4 | No bump now, as recommended: foundation v1.15 P-2's pointer to 01a v2.7.4 is refreshed at the next foundation version; the 01c v1.1.4 §4.3 comment keeps its v1.1.3 line (already labelled "post-review (M-7, M-10)", followed by the v1.1.4 line) and is refreshed at the next 01c version, since no 01c rule text must change | — |
| FL-1 | Owner: **yes** ("haa!"): the branch default `max_delay_default_ms` is capped at 60 000–1 800 000 (1–30 min) like the item value. No rule text changes; recorded as a note in 01a v2.7.5 and 01b v1.10.3 and in `docs/plans/stab-bugs.md` | 01a v2.7.5 MD-2′, 01b v1.10.3 §6.10 (notes) |
