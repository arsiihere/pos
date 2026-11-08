# 03a Timing Engine (package + hub host) — Spec v1.0.1 (DRAFT — as built, awaiting owner approval)

| | |
|---|---|
| Status | **v1.0.1 DRAFT — as built, awaiting owner approval before merge** (2026-11-08, task 29 step 3): v1.0 + what the `module-03a` branch built (code head `1d098b8`, final gate green: 3209 tests). It folds every AD row AD-1–AD-37 of `docs/reviews/03a-auto-decisions.md` and the board `docs/plans/03a-status.md`, the plan-time rows P-5, P-11, P-12, Review Focus 1, BF-1–BF-14, and the 01d v1.1.2 note. Each fold is marked "⚠️ Changed in v1.0.1 (AD-n, status)" with its status exactly as on the board: developer ruling, owner ruling, accepted, or **proposed (not yet ruled)**. Proposed rows describe the code as built; they are not rulings until the owner approves this draft. The owner's rulings on this draft (2026-11-08) are listed below the changes table. The changes are listed in "Changes in v1.0.1" below. **v1.0 is kept as history** (`03a_Timing_Engine_Spec_v1.0.md`, locked). The version is v1.0.1 (not v1.1): 02p task 0 later writes 03a v1.2 on top of it. **v1.0 APPROVED** (developer, as the owner's proxy, 2026-11-03) after G2 (`docs/reviews/03a_v0.3_g2_completeness.md`), G4 runs 1–3 (`03a_v0.4_hostile_run1.md`, `03a_v0.5.1_hostile_run2.md`, `03a_v0.6.1_hostile_run3.md`) and the targeted checks (`03a_v0.6.2_targeted_check.md`, `03a_v0.6.3_final_check.md`, verdict APPROVE). v1.0 = v0.6.3 + BF-14 (final check N2-1, §12.6) + the approval: §4.5 is approved and applied by version bump (R26). The specs bumped are foundation v1.9, 00 v1.7, 01b v1.5, 01d v1.1.1, 01c v1.1.1, README and 01a v2.1. The version history is in the table below. **v0.6.3 — awaiting final check** (2026-11-03): v0.6.2 + the targeted check `docs/reviews/03a_v0.6.2_targeted_check.md` (0 BLOCKER, 1 MAJOR, 2 MINOR; NOT YET): N-1 is fixed in the text, marked "Changed in v0.6.3 (targeted check N-1)" — a fired-not-started line's prep begins at the Start tap, so its packed interval is `[max(fire, t) + prep, +cook)`; N-2 and N-3 are build-time fixes BF-12 and BF-13 (§12.6). A final check of this diff precedes approval. §4.5 is still **Proposed — needs approval**. **v0.6.2 — G4 run 3 applied** (2026-11-03): v0.6.1 + the G4 hostile review run 3 `docs/reviews/03a_v0.6.1_hostile_run3.md` (0 BLOCKER, 3 MAJOR, 12 MINOR; FIX THEN APPROVE) applied with the developer decisions of 2026-11-03: the three majors and the regression minor G4-3 #4 are fixed in the text, marked "Changed in v0.6.2 (G4-3 #n)"; the remaining minors are build-time fixes BF-1–BF-11 (§12.6), each naming the §11 task that carries it. The approval follows a targeted check of this diff (no run 4). §4.5 is still **Proposed — needs approval**. **v0.6.1** (2026-11-03): v0.6 + one developer patch marked "Changed in v0.6.1": the `StockAdded` re-plan (G4-1 #7 / G2 #7 M7, 01a carried row, foundation D23 trigger) is restored. **v0.6** (2026-11-03): v0.5.1 + the G4 hostile review run 2 `docs/reviews/03a_v0.5.1_hostile_run2.md` (0 BLOCKER, 5 MAJOR, 18 MINOR; FIX THEN APPROVE) applied with the developer decisions of 2026-11-03. Every edit carries "Changed in v0.6 (G4-2 #n)"; what was applied differently from the review's proposal, or recorded, is in §12.3 ("G4 run 2"). G4 run 3 (the last) has not run. §4.5 is still **Proposed — needs approval**. **v0.5.1 DRAFT** (2026-11-03): v0.5 + three developer patches marked "Changed in v0.5.1": Q13 closed — a day close never exits an order with an unserved line (§3.3); the day close releases the reservations of unfired lines only (§3.7); incremental insertion recorded as a design option under D13 (§12.5, cited by §7.1). G4 run 2 has not run. §4.5 is still **Proposed — needs approval**. **v0.5 — G4 run 1 applied** (2026-11-03): v0.4 + the G4 hostile review run 1 `docs/reviews/03a_v0.4_hostile_run1.md` (0 BLOCKER, 11 MAJOR, 15 MINOR; FIX THEN APPROVE) applied with the developer decisions of 2026-11-03. Every edit carries "Changed in v0.5 (G4-1 #n)"; what was recorded instead of applied as proposed is in §12.3 ("G4 run 1"). The prune drill was re-run with the new pivot (§10.6). G4 run 2 has not run. §4.5 is still **Proposed — needs approval**. **v0.4 — G2 applied, ready for G4** (2026-11-03): v0.3 + the G2 completeness check `docs/reviews/03a_v0.3_g2_completeness.md` (0 BLOCKER, 7 MAJOR, 21 MINOR; FIX THEN PASS) applied with the developer decisions of 2026-11-03 for the majors; the two pre-G2 items closed only in part (#37, #38) are closed. Every edit carries "Changed in v0.4 (G2 #n)"; a finding not applied as proposed is recorded in §12.3 with the reason. No `[owner]` marker added. §4.5 is still **Proposed — needs approval**. **v0.3 — ready for G2** (2026-11-03): v0.2.1 + the owner answers of 2026-11-03 (`03a-g0.md` §4 "Owner answers", both batches). Every `[owner — pending field visit]` marker and §3.13 are removed: by the owner's ruling these are **configuration, never spec numbers**; their proposed values survive only as config defaults in §4.5 (01a v2.1, 01b v1.5 rows), and the pilot values are entered at setup (01a pages). Marked "Changed in v0.3". **v0.2.1 DRAFT** (2026-11-03): v0.2 + three patches marked "Changed in v0.2.1": no transaction for freeze-entry frames (§3.6.3), the load id is a name (§3.3), Q10 and Q11 closed (§12.3, §4.5). **v0.2 DRAFT** (2026-11-03): v0.1.1 + the pre-G2 consistency check `docs/reviews/03a_v0.1.1_pre_g2.md` (#1–#38) applied with the developer decisions of 2026-11-03; every edit carries "Changed in v0.2 (pre-G2 #n)"; findings not applied are recorded in §12.3 with the reason. Still **not reviewed**; G2 then waited for the field visit (closed by v0.3). **v0.1.1 DRAFT** (2026-11-03): v0.1 + D28 return to kitchen (§3.8a; owner answers 2026-11-03), no other change. **v0.1 DRAFT** (2026-11-02). Not reviewed. G2 then did not run (closed by v0.3) until every `[owner — pending field visit]` marker (§3.13) is answered at the Lake City visit (`docs/stories/field-visit-03a-02-05.md` §A; lesson 1, field first). §4.5 is **Proposed — needs approval**. |
| Source | `docs/stories/03a-g0.md` (G0 + G1: D1–D28, §3 contradictions #1–#13, §5 spec changes, §6 / §6b drills, §7 open questions). Each rule below cites its D-id or `§3 #n` of that file. Rules this draft adds where 03a-g0 is silent are marked **P-n (proposed by this draft)** and listed in §12.3. |

### Version history

| Version | Date | What | Review of this version |
|---|---|---|---|
| v0.1 | 2026-11-02 | First draft from `docs/stories/03a-g0.md` (G0 + G1, D1–D27) | — (G2 waited for the field visit) |
| v0.1.1 | 2026-11-03 | + D28 return to kitchen (§3.8a) | `03a_v0.1.1_pre_g2.md` (pre-G2 consistency check: 1 BLOCKER, 16 MAJOR, 21 MINOR) |
| v0.2 | 2026-11-03 | Pre-G2 check applied | — |
| v0.2.1 | 2026-11-03 | Three developer patches; Q10, Q11 closed | — |
| v0.3 | 2026-11-03 | Owner answers; pilot values become configuration | `03a_v0.3_g2_completeness.md` (G2: 0 BLOCKER, 7 MAJOR, 21 MINOR; FIX THEN PASS) |
| v0.4 | 2026-11-03 | G2 applied | `03a_v0.4_hostile_run1.md` (G4 run 1: 0 BLOCKER, 11 MAJOR, 15 MINOR; FIX THEN APPROVE) |
| v0.5 | 2026-11-03 | G4 run 1 applied | — |
| v0.5.1 | 2026-11-03 | Three developer patches (Q13 closed) | `03a_v0.5.1_hostile_run2.md` (G4 run 2: 0 BLOCKER, 5 MAJOR, 18 MINOR; FIX THEN APPROVE) |
| v0.6 | 2026-11-03 | G4 run 2 applied | — |
| v0.6.1 | 2026-11-03 | `StockAdded` re-plan restored | `03a_v0.6.1_hostile_run3.md` (G4 run 3: 0 BLOCKER, 3 MAJOR, 12 MINOR; FIX THEN APPROVE) |
| v0.6.2 | 2026-11-03 | G4 run 3 applied; BF-1–BF-11 | `03a_v0.6.2_targeted_check.md` (targeted check: 0 BLOCKER, 1 MAJOR, 2 MINOR; NOT YET) |
| v0.6.3 | 2026-11-03 | N-1 fixed; BF-12, BF-13 | `03a_v0.6.3_final_check.md` (final check: N-1 CLOSED, 1 MINOR; APPROVE) |
| **v1.0** | 2026-11-03 | **APPROVED.** BF-14; §4.5 applied by version bump | — |
| **v1.0.1** | 2026-11-08 | **DRAFT, as built, awaiting owner approval.** AD-1–AD-37, P-5, P-11, P-12, BF-1–BF-14 folded; 01d v1.1.2 note | task 29 final review (`main..module-03a`) |

### Changes in v1.0.1 (as built, draft for the owner, 2026-11-08)

v1.0.1 makes the spec match the code on branch `module-03a` (task 29 step 3). **It is a draft: the owner approves it before `module-03a` is merged.** Sources: `docs/reviews/03a-auto-decisions.md`, `docs/plans/03a-status.md` (AD rows, open items 1–11, the §7.1 table, the MORNING REPORTs, the carried rows), `docs/plans/03a-plan.md` (P-1–P-12, Review Focus, BF placement).

**Status of each row, exactly as on the board:**
- **developer ruling** or **owner ruling**: decided.
- **accepted**: an implementer's or controller's reading that the developer or owner accepted (AD-17–AD-26 on 2026-11-07; AD-33 in full; the AD-35 readings after the controller's check).
- **proposed (not yet ruled)**: a controller's or implementer's reading that is built but not ruled. Approving this draft rules it. The final review listed these as still proposed: AD-5 (with its final `Load` shape), AD-7, AD-8 (the controller rulings; its developer condition is ruled), AD-9, AD-10 (the controller ruling; its developer note is ruled), AD-11, AD-13, AD-14 (with its task-11 amendment), AD-15 (with its amendment), AD-30, AD-31, AD-29 Q3, Q6 and Q9 ("developer to confirm"; AD-24 S1 is the same question as Q9), AD-37 readings (4)–(9), and the plan rows P-5, P-11 and P-12.

In the body each fold carries a marker "⚠️ Changed in v1.0.1 (AD-n, status): … Was: …" (inside tables: *⚠️ Changed in v1.0.1 (…):*). No error code, endpoint or migration is added. One event changes version: 01d's `AlertRaised` goes to v2 (01d v1.1.2, AD-36).

| # | Change | AD rows (status) | Sections |
|---|---|---|---|
| 1 | **Queued deadline:** a line's deadline is its own slot in a D36 queue, `d = slot end − cook − prep` with slot end ≤ `T − carry`, stored in `deadline_ms`; recomputed when the group's `T` moves | AD-12 (developer ruling) | §3.2, §3.5.3 |
| 2 | **Strict flag and diagnostics:** `applyEvent(state, event, opts?: { strict? })`; tests run strict (a profile underflow or stock breach throws), the hub runs non-strict (clamp at 0, append to `state.diagnostics`, host logs at `warn` after commit and clears); `diagnostics` replaces `report?` and is outside snapshots, checkpoints and the version key-set fixture | AD-6 (developer ruling) | §3.3, §3.7, §6.1a, §7.2 |
| 3 | **State fields as built (v3, never released before):** `Load = { load_id, program_id, order_item_ids, fire_ms, booked }`; `EngineLine.booked`, `EngineLine.capped`, rounds kept on a member line that leaves a stored load | AD-5 final shape (proposed (not yet ruled)); AD-7 (proposed (not yet ruled)); AD-15 (proposed (not yet ruled)); AD-30 P4 (proposed (not yet ruled)) | §3.3 |
| 4 | **`liveInterval(state, order_item_id, t)`** (the spec wrote `liveInterval(line, t)`; the packing needs the station). Same meaning | P-5 (proposed (not yet ruled)) | §3.3, §4.2, §6.1a |
| 5 | **A line whose units exceed the effective capacity** holds the whole station for `cook_ms × ceil(units / capacity)` (rounds), with a host `warn`; the slip estimate and `auto_done` count the rounds | Review Focus 1 → AD-4 (developer ruling); AD-29 Q11 P4 (developer ruling) | §3.3 |
| 6 | **Writer-bug lines and dropped lines:** placeholder lines from `OrderPlaced`; order `T` / `P` = max over its groups; a writer-bug `ItemAdded` throws strict, is dropped non-strict with an `invalid_event` diagnostic; a dropped line is never silent (`engine_line_dropped` info alert to managers); a reused live `order_item_id` is rejected and the device mints the id | AD-8 controller rulings (proposed (not yet ruled)), its developer condition (developer ruling); AD-29 Q5 (developer ruling); AD-30 Q5 (proposed (not yet ruled)); AD-33 (22a) (accepted); AD-37 (7) (proposed (not yet ruled)) | §3.3, §4.2, §4.3 To 02, §6.2a, §6.4 |
| 7 | **A pulled or early-fill line fires at its pull:** the fold sets `fire_ms = min(fire_ms, recorded_at)` | AD-9 (proposed (not yet ruled)) | §3.3 |
| 8 | **Stage events from the wrong stage are silent no-ops** in the fold; 03b keeps `409 ITEM_WRONG_STAGE` | AD-10 controller ruling (proposed (not yet ruled)), developer note (developer ruling) | §3.4, §4.3 To 03b |
| 9 | **Void / remove across stations:** the ended line's group is re-looped on all its stations | AD-11 (proposed (not yet ruled)) | §3.5.3 |
| 10 | **Abandon clock:** abandoned ⇔ no unfired line ∧ `t ≥ max(last_line_fold_at + order_abandon_ms, latest planned land)` (BF-6) | AD-13 (proposed (not yet ruled)) | §3.3, test 111 |
| 11 | **FIFO line in a sync group**, and per-station policy with routing | AD-14 and its task-11 amendment (proposed (not yet ruled)) | §3.5.3 |
| 12 | **Overload search as built:** backward placement on `d_Λ`, re-placed set, success and fallback, `capped`; then forward compaction | AD-15 and its amendment (proposed (not yet ruled)); AD-16 (developer ruling) | §3.5.6 |
| 13 | **Routing bookkeeping** (R1–R9, reserve fallback, `checkOrderable` on an all-paused allowed set); 02 copies `PlanResult` route fields verbatim | AD-17 (accepted) | §3.5.5, §4.3 To 02 |
| 14 | **Batch loads in the profile** (one whole-station load at a time; J1–J7, L1, N1); a load-id collision takes a `:k` suffix | AD-18 (accepted); AD-5 (proposed (not yet ruled)) | §3.3 |
| 15 | **Stock fold readings;** a `sold_out` line is refused when 0 < available < needed; a from-stock line with no Start consumes at Done or Served | AD-19 (accepted); AD-29 Q7, Q8 (developer rulings); AD-30 Q7 (proposed (not yet ruled)) | §3.7, §4.3 To 03b |
| 16 | **An exited order is kept while a line holds a reservation;** `ReservationsShifted` fold (F §4.7 D42) | AD-20 (accepted) | §3.3, §3.6.1 |
| 17 | **Tick and slip readings;** slip R1 (an estimate already over the level counts from `placed_at`) and R4 (a slip resolves on its own `order_ids`) replace literal wording | AD-21 (accepted) | §3.6.1, §3.8 |
| 18 | **`ItemsReleased` and goes-with:** the caller computes the D12 pre-ticks; the slip `apply` makes 1 read when goes-with links exist, else 0 | AD-22 (accepted); AD-37 (6) (proposed (not yet ruled)); §12.2 count confirmed by the owner (2026-11-08) | §3.8, §6.4, §12.2 |
| 19 | **Boost and capacity readings;** B3, P8, P9, P4 fixed in task 18d | AD-23 (accepted); AD-29 Q11 (developer ruling); AD-30 B3, P8 (proposed (not yet ruled)) | §3.8a, §3.9, §3.10 |
| 20 | **Views, pull, late start:** `groupReadiness(state, order_id, now)`; `pullEarly` may return `null` inside the limit; no `cascade_step_ms` rounding on a late Start | AD-24 (accepted); AD-29 Q12 (developer ruling); AD-29 Q9 = AD-24 S1 (proposed (not yet ruled), developer to confirm) | §3.3, §4.3 To 03b, §6.1i, §6.1k |
| 21 | **Config effects;** §2 #5 reconciled with §3.11 (alternates and carry of hidden lines from the next re-plan) | AD-25 (accepted); AD-29 Q10 (developer ruling) | §2, §3.11 |
| 22 | **One `EngineConfigApplied` on every forward config apply** (`config_version` is in E()); it re-plans nothing; test 70 wording | AD-35 24-1 (accepted, developer); 24-2, 24-3, 24-5 (accepted) | §3.11, test 70 |
| 23 | **Config catch-up back-off:** after 3 non-committing attempts ordinary fires passes run while `configStale` stays set, retry every 60 s, one warn line per pass | AD-35 (c) / 24-4 (owner ruling) | §3.11, §6.2 |
| 24 | **`station_plan` frames:** sent with `ws.sendToSessions` (00 H-1 wins); payload filter per station; test 83 = "no frame when nothing visible changed" | AD-35 (a), (b) (owner rulings); 22b-2, 22b-3, 22b-5 (accepted) | §3.6.3, §6.2, §6.4, test 83 |
| 25 | **`AlertClosed` folded only on the order stream** | AD-31 (proposed (not yet ruled)) | §3.8, §3.12 |
| 26 | **Batch fold `applyEvents(state, events[])`:** replay in chunks of 500, the live writer one call per transaction; no state-shape change | AD-28 (developer ruling); AD-29 Q3 (proposed (not yet ruled), developer to confirm) | §3.12, §6.1a |
| 27 | **Host readings, batch 8:** SIGTERM by `process.once`; catch-up in the fires transaction; dropped-line meaning and keys; closes before `raiseMany`; a capped station below amber stays open; deduped and resolved keys join `skipped`; dropped-line facts re-queued at boot; SIGTERM flush | AD-33 (accepted) | §3.10, §3.12, §6.2, §6.2a, §6.3 |
| 28 | **Host rulings after the hub2 merge:** stock frames to every staff socket; `mark-served` default scope `'branch'`; the perf project runs only via `pnpm test:perf` | AD-32 (developer rulings) | §4.3 To 02, §6.4, §10.6 |
| 29 | **Host rulings after the hub3 merge:** the capacity command folds its own event for the response, so a capacity change re-plans twice (accepted); exact statement count for `SetStationCapacity`; snapshot timing in `test:perf`; 01b §3.6 applies within each responsibility kind; "upgrade every hub before anyone assigns `run_station`" (release note) | AD-34 (developer rulings; (6) confirmed as an owner ruling 2026-11-08) | §3.12, §4.5 B-4, §6.6 |
| 30 | **Slip card details:** 01d v1.1.2 widens `AlertDetailsBase` (`minutes_late`, `lines`); `AlertRaised` v2 with an identity upcaster; `minutes_late` against the **engine target**; card "≈ N min late" (en, ur) | AD-36 (accepted by the owner); AD-37 (3) (owner ruling); AD-37 (4), (5), (9) (proposed (not yet ruled)) | §3.8, §5.3, §8 |
| 31 | **`fires_alerts` bound:** 2 (`listOpen`) + ≤ 1 (`tableOwners`) + ≤ 1 line facts + 01d's bounds; the facts read has no `branch_id` predicate | AD-37 (1) (owner ruling); AD-37 (8) (proposed (not yet ruled)) | §6.2a, §10.5, §12.2 |
| 32 | **An answered slip closes its key for that seating;** a new party is a new key once 02p Q-2 keys `dine_in` by `seating_id` (02p U-7) | AD-37 (2) (owner ruling) | §3.8, §3.12 |
| 33 | **Simulator days and §7.1 numbers:** AD-27's normal peak day and overload day; 38.3k events per day against the old "≈ 66k"; utilisation floor on the 10-minute window; report-only seeds 8 and 11; dev-laptop numbers only (pilot box open, task 28); re-placed-lines bound 270; §7.1 upkeep row worded as built; `@pos/engine/sim` test-only export | AD-26 (accepted); AD-27 (developer ruling); AD-29 Q1, Q2, Q4 (developer rulings); AD-32 (4) (developer ruling); P-11 (proposed (not yet ruled)); P-12 (proposed (not yet ruled)) | §7.1, §7.3, §10.6, §12.1 |
| 34 | **BF-1–BF-14 as built:** each with its task and test; BF-9 parked (`it.todo`), AD-2 superseded; BF-10 per AD-3; BF-11's stale text fixed here (§9 abandon exit, To 02 #1 label, §12.3 rows, tests 42 and 88) | AD-2 (superseded by AD-29); AD-3 (developer ruling); AD-29 Q6 (proposed (not yet ruled), developer to confirm) | §3.8, §4.3 To 02, §9, §10.1, §12.3, §12.6 |
| 35 | **AD-1:** 01a's `used_by` floor shape for archiving a point named by stations. No 03a text change (01a v2.1 §6.9a) | AD-1 (developer ruling) | — |
| 36 | **Carried rows** from the board: To 02 (device mints `order_item_id`, refuse a reused id before append, copy route fields), To 03b (`ITEM_WRONG_STAGE`; `DoneItem` / `MarkServed` append `stockEffects`; whole-load fire; `pullEarly` `null`; frame order), To 02p (open items 10, 11) | AD-10, AD-17, AD-29 Q5, Q7, Q12, AD-35 22b-5, AD-37 (1), (2) (as above) | §4.3 |
| 37 | **`StockAdded` v2 `reason` is a named exception to D46** (no code change; the D46 wording is a candidate for 02p's foundation v1.11) | owner ruling 2026-11-08; AD-36 | §4.5 A-19 |

**Gaps recorded as built** (known, not closed by this build):
1. `fires_alerts` has no statement assertion for a pass that closes and raises in one go, for an overload pass, or for the first pass after a day close (the `obsolete` closes).
2. No hub-level statement test for the drafts of a `fires` pass that writes Start, Done, `StockConsumed` and `ReservationsShifted`.
3. No test for `set-station-capacity` / `set-station-pause` from a staff session that lacks `manage-stations`.
4. The line-facts read of AD-37 (1) is not timed in the peak perf run (the simulator's orders have no `placed_by`).
5. Task 27 review Minor 3: no scoped live = replay compare right after the deferred checkpoint is written.
6. DoD 2: the §7.1 targets are not measured on the pilot mini PC yet (task 28). Every number below is from the dev laptop.
7. AD-35 open test gaps: the `StockReleased` test does not pin `stations.S1` as unchanged; no test for a hook commit during the catch-up back-off (the `catchUps.delete` branch).
8. `it.todo('[03a BF-9]')` still names the AD-2 re-reserve in its text (stale; open item 6).

**Owner rulings on this draft (2026-11-08):**
- §12.2 row 6.4: the slip `apply`'s 1 read is **confirmed** (it follows AD-37 ruling (1)).
- §4.5 A-19: `StockAdded` stays additive within v2 as a **named exception** to foundation §4.1 D46; no code change. The D46 wording is a candidate for the next foundation bump (02p carries foundation v1.11): "additive optional fields may stay in the same version when every reader parses them; `AlertRaised` went to v2 because the strict card check rejects unknown fields". The foundation is not edited now.
- §6.2: the text follows the code (the catch-up pass writes only `EngineConfigApplied`, inside the `fires` tick's own transaction).
- BF-11 / test 99: "no change" confirmed.
- AD-34 (6): confirmed as an **owner ruling**: one person may hold `count_stock` and `run_station` for the same station.

**Still noted (no ruling needed):** §3.8 Trigger: AD-3 narrows the "hears before the promise" claim, and AD-37 (3) measures `minutes_late` against the target; with the defaults the card often says 0 at the raise (AD-37 question 3). The ruling stands.

### Changes in v1.0 (approval, developer as the owner's proxy, 2026-11-03)

| # | Change | Where |
|---|---|---|
| 1 | Status APPROVED; this version history | header |
| 2 | BF-14 (final check N2-1): the `slip_due` crossing ignores packed fired lines ahead, and nothing recomputes it when one of them starts. Carried by task 15 | §12.6 |
| 3 | §4.5 approved and applied by version bump (R26): foundation v1.8 → v1.9 (F-1–F-20), 00 v1.6.1 → v1.7 (H-1, H-5, H-6 in one bump; the planned v1.6.2 is not made, and 01e takes the next 00 bump), 01b v1.4.1 → v1.5 (B-1–B-8), 01d v1.1 → v1.1.1 (N-1, N-2), 01c v1.1 → v1.1.1 (C-1), README (R-1–R-6), 01a v2.0.1 → v2.1 (A-1–A-20, including the BF-13 A-20 target 01a test 129). The §1 "Depends on" row names the bumped versions. | §1, §4.5 |
| 4 | The §12.3 proposed answers are approved as written | §12.3 |

### Changes in v0.6.3 (targeted check of v0.6.2, developer, 2026-11-03)

Source: `docs/reviews/03a_v0.6.2_targeted_check.md`. Each edit is marked "Changed in v0.6.3 (targeted check N-1)".

| # | Change | Where |
|---|---|---|
| N-1 (M) | A fired-not-started line's prep begins at the Start tap and is off-station, so the line cannot occupy the station before `max(fire, t) + prep`. Its sliding interval is `[s + prep, s + prep + cook)`, where `s` is its **packed Start**: the earliest instant ≥ `max(fire, t)` at which that interval fits, packed per station in `(fire_ms, order_item_id)` order as in v0.6.2. The ADDED-past-fire estimate is `s + prep + cook + carry`, which is F §4.7's `now + prep + cook + carry` when no line is ahead. The late-start shift is by how far the Start came after `s`. `liveInterval`'s contract updated. Test 115 gains the review's prep > 0 fixture (a Start made on time never breaks a later order's promise). Tests 96 and 116 each gain a prep > 0 variant | §3.3, §3.8, §4.5 F-20, tests 96, 115, 116, §12.3 |
| N-2, N-3 | Build-time fixes BF-12 (partial-void `units` fold) and BF-13 (A-20 code change: the `StockAdded` unit throw removed; 01a test 129 and `stock.test.ts` re-baselined), both in task 12 | §12.6 |

### Changes in v0.6.2 (G4 hostile review run 3, developer decisions 2026-11-03)

Source: `docs/reviews/03a_v0.6.1_hostile_run3.md`. Each edit is marked "Changed in v0.6.2 (G4-3 #n)" (the review's numbers).

| # | Change | Where |
|---|---|---|
| 1 (M) | Fired-not-started lines are **packed per station** in `(fire_ms, order_item_id)` order against capacity: each one's start is the earliest instant ≥ `max(fire + prep, now)` at which its units fit beside the COOKING lines' live intervals and the fired lines packed before it. `liveInterval` becomes capacity-aware and stays the one helper of all four functions; the ADDED-past-fire estimate uses the packed start; F-20 and the S:263 claim re-worded; tests 115, 116 | §3.3, §3.8, §4.5 F-20, §6.1a, tests 96, 115, 116 |
| 2 (M) | Reservations are kept **per draw** (`draws[].reserved`). A partial void releases only the voided units' share of each draw; `from_stock`, `cook_ms`, the program and `reserved_seq` change only when the last reserved unit leaves the line. Q14 consumes every draw of a held line on every stock item. A `StockSet` to 0 after a partial void folds cleanly; tests 117, 118 | §3.3, §3.7, tests 42, 88, 117, 118 |
| 3 (M) | `StockConsumed` clamps `on_hand` at 0. **No stock fold ever throws:** a breach of a stock invariant is reported to the host, which logs `{ event_id, stock_item_id, on_hand, reserved }`, and the fold continues with clamped values; 01a S14's throwing `StockAdded` unit check becomes a logged no-op (row A-20); test 119 | §3.7, §4.5 A-20, §6.1a, §7.2, tests 40, 41, 119 |
| 4 | Regression of G4-1 #14 fixed: `StockAdded` reserves only **hidden** slot lines (and batch lines in a hidden load), never a frozen line | §3.7, §4.5 F-19, test 87 |
| 15 (part) | H1 title and header version | §1 |
| 5–15 | Remaining minors → build-time fixes BF-1–BF-11 with their tasks | §12.6 |

### Changes in v0.6.1 (developer, 2026-11-03)

| # | Change | Where |
|---|---|---|
| 1 | `StockAdded` re-plan restored (G2 #7 / M7, 01a carried row "`StockAdded` triggers D23", F-19). The `StockAdded` handler appends `StockReserved` drafts from `reserveStock` for that stock item's **unfired full-cook** lines in deadline order (slot lines, and batch lines not in a frozen or fired load), as far as the added stock reaches. `applyEvent(StockReserved)` re-plans a line's station **only** when the fold flips that line's `from_stock` from false to true. A submit batch's `StockReserved` events match `OrderPlaced.lines[].from_stock = true`, so they never re-plan. The switched line takes its stock cook time and `stock_program_id`. Reverses v0.6's G4-2 #4 consequence (a) only; the rest of G4-2 #4 stands | §3.5.1, §3.5.3, §3.7, §3.11, §4.2, §4.5 F-19, test 87, test 104, §12.3, §12.4 |

### Changes in v0.6 (G4 hostile review run 2, developer decisions 2026-11-03)

Source: `docs/reviews/03a_v0.5.1_hostile_run2.md`. Each edit is marked "Changed in v0.6 (G4-2 #n)" (the review's numbers).

| # | Change | Where |
|---|---|---|
| 1 (M) | A fired line that has not started occupies a **sliding** interval `[max(fire + prep, now), +cook)` until `ItemStarted` fixes it; one helper `liveInterval(line, now)` in `applyEvent`, `planOrder`, `calculateETA`, `getTickIntents`; test 96 rewritten to the review's example | §3.3, §3.5, §3.9, §4.2, §4.5 F-20, §12.3, §12.6, test 96 |
| 2 (M) | Third exit, **abandon**: an order with no unfired line and no fold on any of its lines for `order_abandon_ms` (new setting, default 14 400 000, 1–24 h) leaves the engine by the pure predicate; its reservations are released `abandoned` by the `fires` tick; To 02 / To 05: abandoned orders shown to the manager, the bill is 05's; the checkpoint "≤ 2 days" restated | §3.3, §3.6.1, §3.7, §3.12, §4.2, §4.3, §4.5 A-12, tests 49, 111 |
| 3 | Deferred checkpoint: the pure predicate `noOrderInEngine(state, now)` over `state.orders`, never physical emptiness | §3.6.1, §3.12, §6.2, §6.3, test 112 |
| 4 (M) | No batch marker: the order plans at the `ItemAdded` that brings `awaiting` to 0; **stock folds never re-plan**; a `StockAdded` reservation keeps the line's fresh plan (the stock-cook switch is withdrawn); recount and day close re-plan at their own event, appended after the releases | §3.5.1, §3.5.3, §3.7, §4.2, §4.5 F-19, A-14, tests 55, 87, 104 |
| 5 (M) | Release rules per cause: recount and close release **hidden** lines only, newest `reserved_seq` first, every draw of a line together; a released line goes full-cook and back to its `program_id`; frozen and fired lines never release; `on_hand < reserved` only by frozen / fired units; **Q14 closed** | §3.7, §6.1f, §12.3, tests 40, 42, 88 |
| 6 (M) | Full re-placement is **the** algorithm (50 ms p99 gate); incremental insertion moved to deferred ("needs a version bump if adopted") | §7.1, §10.6, §12.5 |
| 7–23 | Minors: test 23 (`T_pruned ≤ T_unpruned`); pivot `lo` as fire times; `nextDueAt` during an overrun = the next `cascade_step_ms` boundary (+ property test); stale text (test 49, To 05, §3.7, §12.4, header); close releases hidden lines only; Q14; day-open override reset = capacity change; slips only for displaced orders **past the threshold**, defaults `slip_threshold_ms` 120 000 / padding 180 000 (D11); §3.5.6 covers frozen lines in the exception folds; frozen lines at `earliestFit(current fire)`; `dine_in` receiver falls back to `placed_by`; return-line structure; `closeMany` before `raiseMany`; `slip_due` on a threshold change and its bound; `+ carry` in estimates; 2-day replay gate ≤ 80 s; pass 1 stations | as marked |

### Changes in v0.5.1 (developer, 2026-11-03)

Each edit is marked "Changed in v0.5.1".

| # | Change | Where |
|---|---|---|
| 1 | Q13 closed: `BusinessDayClosed` never exits an order that has **any unserved line** (unfired included); such an order exits by the normal rule only (30 min after its last line is served). Checkpoint rule unchanged (written when the state holds no order) | §3.3, §12.3, §12.6, test 99 |
| 2 | The day close releases `day_closed` the reservations of **unfired** lines only; a fired from-stock line keeps its reservation, so its `StockConsumed` at Start stays right (a COOKING line consumed its own at Start); the `on_hand` drift note is dropped; new Q14 (a stock unit change at the next open while such a reservation is held) | §3.7, §4.5 A-14, §12.3, tests 42, 88, 99 |
| 3 | Incremental insertion recorded under D13 as a design option, chosen in the plan only if task 18 measures full re-placement above the 50 ms p99 gate | §12.5, §7.1 |

### Changes in v0.5 (G4 hostile review run 1, developer decisions 2026-11-03)

Source: `docs/reviews/03a_v0.4_hostile_run1.md`. Each edit is marked "Changed in v0.5 (G4-1 #n)".

| # | Change | Where |
|---|---|---|
| 1 (M) | Prune pivot = the new lines' earliest possible start against the fixed lines; the "≤ 250 re-placed lines" claim is deleted; the bound is measured by the drill (D27) and set in the plan; drill re-run with the new pivot | §3.5.3, §7.1, §10.6, `docs/stories/03a-sim/replay_cost.py` |
| 2 (M) | A fired-not-started line occupies `[fire + prep, max(planned_end, now))` like a COOKING line (D33 extended); `applyEvent`, `planOrder`, `calculateETA` and `getTickIntents` use the same live end | §3.3, §3.8, §4.5 F-20 |
| 3 (M) | Placement at submit is one sequence: pass 1 (older lines within slack) → the new immediate lines (tentatively) → the sync loop | §3.5.1, §3.5.3 |
| 4 (M) | Boost: fired lines fixed; frozen lines **may** be re-placed (named exception to D15, red marker); every displaced order gets a slip on the next `fires_alerts` pass | §3.4, §3.9 |
| 5 (M) | Capacity change (`SetStationCapacity`, lane Off / On, config): the same exception; D15 has exactly these two exceptions | §3.4, §3.5.3, §3.10, §3.11 |
| 6 (M) | `BusinessDayClosed` does not exit an order that still has a fired, COOKING or done-unserved line; the day-close checkpoint is written only when the state holds no order (else at the first `fires` pass that finds it empty, once per business day; else the previous checkpoint stands, replay ≤ 2 days); folds of an absent order or line are a logged no-op (except `OrderLinesAdded`) | §3.3, §3.6, §3.7, §3.12, §6.2, §6.3 |
| 7 (M) | To 02: an addition to an exited order is a new order with `follow_up`; `ReturnToKitchen` on an exited order → `409 ORDER_NOT_IN_ENGINE`, the screen says the order is closed | §3.3, §3.8a, §4.3, §9 |
| 8 (M) | Slip receiver: `dine_in` → `tableOwners`; `takeaway`, `delivery`, `parking` → `placed_by` (also after 02 lands) | §3.8, §4.1, §4.4, §6.2a |
| 9 (M) | `EngineLine.draws` from `ItemAdded.stock_draws` only; never `dayDraws` or config in a fold | §3.3 |
| 10 (M) | A batch line's programs are fixed at submit (D25); the `StockAdded` re-plan covers slot lines and batch lines not yet in a fixed load; a line in a frozen or fired load keeps its program | §3.3, §3.7 |
| 11 (M) | The return line carries `price_minor 0`, `line_total_minor 0`, `tax_class_id null`; To 05: a line with `return_of` is never billed; the served line stays billed on `fix` and is freed by 04 on `remake` | §3.8a, §4.3 |
| 12–26 | Minors: one re-plan per batch per station (at the last listed event); `stockEffects(ItemMovedToStock)` folds its own drafts; frozen lines not switched to stock; `next_alert_due_at` per key, recomputed only by folds that touch slips or groups; `FireDispatched.reason 'missed'` dropped (07 derives it); `ItemDoneUndone` clears `resolved_at`; return boost scope; duplicate open return refused (`RETURN_ALREADY_OPEN`); capacity override clamp and day-open reset; recount by `reserved_seq`; `placed_by` / `placed_at` source; 02 writes `ItemReturned` itself; `due_at`, `started_at`; README "Blocked by"; self-review refreshed | as marked |

### Changes in v0.4 (G2 completeness check, developer decisions 2026-11-03)

Source: `docs/reviews/03a_v0.3_g2_completeness.md`. Each edit is marked "Changed in v0.4 (G2 #n)".

| # | Change | Where |
|---|---|---|
| 1 (M1) | 00 rows H-5 `devices.point_id` and H-6 `devices.lane_label` (00 v1.7); a lane = a `kds` device with `station_id` and `lane_label`, not revoked; `capacityForLanes` takes `lane_count` as an input; pairing / binding UI → To 03b, To 01e | §3.10, §4.3, §4.5, §6.1m |
| 2 (M2) | Sync bound with the directory ≤ 32 (27 + 5), config-only ≤ 27; new 01b row B-8 owns it (R32 c) | §4.5 |
| 3 (M3) | Exit is a pure predicate `inEngine(order, t)` over the `recorded_at` of **listed** events only; `isOrderInEngine` exported; physical removal only in listed folds; static test: handled types = §3.12 lists | §3.3, §3.12, §4.2, §6.1a, §10 |
| 4 (M4) | `EngineState.next_alert_due_at` (pure); `fires_alerts.due = now ≥ next_alert_due_at` (or host overload / day-close / boot flags), no statement; `slips[key]` keeps `resolved_at` until its `AlertClosed` is folded; `SlipWarned` carries `alert_id` again; idle kitchen opens no transaction | §3.3, §3.6, §3.8, §3.12, §6.2a, §10 |
| 5 (M5) | Checkpoint body carries `business_day`; `last_seq` = max seq of the commit that folded `BusinessDayClosed` | §3.12, §5.1, test 55 |
| 6 (M6) | 00 H-1 adds `clock?` to `BootContext`; step 6 reads `ctx.initialState` and `ctx.clock` | §3.6.2, §4.5, §6.3 |
| 7 (M7) | `StockAdded` reserves for that stock item's unfired `from_stock = false` lines in deadline order (`reserveStock`), then re-plans their stations (foundation D23); 01a's carried row stands | §3.3, §3.7, §3.11, §6.1f, test 87 |
| 8–28 | Minors: stale tests 46, 61, 62; "pending A9 / A1"; counters; new tests 87–95; snapshot assert; override range; F-2; F §5.8 fresh snapshot; points `POST` idempotency; frame audience; one response shape; `unit_changed` dropped; catch-up pass; day-close flag at boot; `E(next)`; backfill; index build; `table_lock_ttl_ms`; self-review refreshed | as marked |
| Pre-G2 #37, #38 | Test 61 "keep 2"; snapshot write ≤ 50 ms asserted in §10.6 | §10.2, §10.6 |

### Changes in v0.3 (owner answers, 2026-11-03)

| # | Change | Where |
|---|---|---|
| 1 | Every field-visit marker and §3.13 removed; no station or item names and no restaurant numbers in §3; defaults kept only as config defaults in §4.5 ("pilot values entered at setup, 01a pages") | §3, §4.5 |
| 2 | A2 `capacityForLanes = lanes_on × lane_units`, `lane_units` default = capacity ÷ lane count | §3.10, §4.5 A-8 |
| 3 | A5 / A8 hold at pass is a hint on the assembler view, never a block (01d K4) | §3.4, §4.3 To 03b |
| 4 | Defaults: `two_tap` (A11), `boost-order` Owner, Manager (A10), `manage-stations` Manager (A7), one point "Pass" (A12), `goes_with_links` empty (B21), `returns_boost` **true** (Q15a: a return never queues) | §4.5 |
| 5 | Q12 stays open; A14 (pieces per hour at peak) is a simulator input only | §12.3, §10.6 |

### Changes in v0.2.1 (developer, 2026-11-03)

| # | Change | Where |
|---|---|---|
| 1 | A line entering Next is time passing, not an event: the `station_plan` frame for it is sent from the `fires` tick's `due` wrapper, outside any transaction; no empty `writer.run`; 01d's idle rule holds with no exception | §3.6.3, §6.2, §10 tests 83, 86 |
| 2 | The load id is a name, not membership | §3.3, §4.2 |
| 3 | Q10 closed (reading kept); Q11 closed: engine settings in 01b's branch settings endpoint, station engine fields, alternates and carry times in 01a's station resource, goes-with on the item and category PATCHes; 01a 28 → 30 endpoints | §12.3, §4.5 |

### Changes in v0.2 (pre-G2 consistency check, developer decisions 2026-11-03)

Source: `docs/reviews/03a_v0.1.1_pre_g2.md` (1 BLOCKER, 16 MAJOR, 21 MINOR). Each edit is marked "Changed in v0.2 (pre-G2 #n)" or "v0.2, pre-G2 #n".

| # | Change | Where |
|---|---|---|
| 1 | Second tick `fires_alerts` for slip and overload alerts; `fires` writes engine intents only; `SlipWarned` drops `alert_id` (join through `AlertRaised.values.table_key`); one-tick lag stated; defensive inputs; the engine no longer folds `RequestAnswered` / `AlertClosed` | §3.6, §3.8, §3.12, §6.2, §6.2a |
| 2 | Exit at `BusinessDayClosed` or 30 min after the last line is served (deterministic on `recorded_at`, no event); `409 ORDER_NOT_IN_ENGINE` (02's code, defined here) | §3.3, §3.8a, §9 |
| 3 | `stock_version` read with 2 statements at boot; three new stock events join `STOCK_VERSION_EVENTS` (A-17) | §3.12, §4.5 |
| 4 | Config catch-up in the first `fires` pass | §3.11, §6.2 |
| 5, 6 | `cook_ms_override` (`adjust_time_ms`) and `max_carry_ms` copied on the line | §3.3, §3.5.5, §3.8a, §4.2 |
| 7 | Deterministic group and load ids | §3.3, §3.5.1, §4.2 |
| 8, 9 | `ProposedOrder` and the `EngineConfigApplied` payload written out | §4.2, §3.11 |
| 11 | Open slip requests closed `obsolete` after day close | §3.8, §6.2a |
| 12 | `station_plan` catch-up part and frame for 03b (F-15) | §3.6.3, §4.3, §6.4 |
| 13 | Move to stock adds the portion (`StockAdded { reason: 'moved' }`, A-19, F-18) | §3.7, §4.2, §4.3 |
| 14 | To 05 row and README R-6 | §4.3, §4.5 |
| 15 | `ReturnToKitchen` permission `mark-item-returned` (F-13, B-5) | §3.8a, §4.3 |
| 16 | Responsibility kind `run_station` (B-4) | §4.1, §4.5, §6.6 |
| 17 | `SetStationCapacity` accepts the station's own KDS session for lane Off / On (00 M30, F-16) | §6.6, §4.3 To 03b |
| 18–38 | Minor: enum, weights, wording, signatures, C8 order, tests, task order, rows C-1, N-2, H-1, F-14, F-17, pointers, references, numbering, retention, snapshot timing | as marked |
| — | Not applied as proposed: #10, #21 (narrowed), #31 (narrowed), #37, #38, H-2, and the load-id choice — reasons in §12.3 | §12.3 |

## §1. Header

| | |
|---|---|
| Module | 03a Timing Engine — `@pos/engine` (pure package) and the hub engine host (R4) |
| Version | ⚠️ **v1.0.1 DRAFT (as built, 2026-11-08), awaiting owner approval before merge**; v1.0 kept as history (`03a_Timing_Engine_Spec_v1.0.md`). Was: v1.0 APPROVED (*Changed in v1.0:* approval; *Changed in v0.6.3:* targeted check N-1; *Changed in v0.6.2, G4-3 #15:* the H1 title now matches; *Changed in v0.6, G4-2 #10:* was left at v0.5 in v0.5.1) |
| Depends on | *⚠️ Changed in v1.0.1 (AD-36, owner):* 01d **v1.1.2** (widened `AlertDetailsBase`, `AlertRaised` v2); 01a v2.1 is built (cloud tasks C1–C9, hub task A14). Was: 01d v1.1.1. *Changed in v1.0 (§4.5 applied):* Foundation v1.9, 00 v1.7, 01a **v2.1** (points, carry times, alternates, knobs; not yet built, so the 03a build implements it), 01b v1.5, 01c v1.1.1, 01d v1.1.1. Was: foundation v1.8 (v1.9 proposed), 00 v1.6.1 (v1.6.2 and v1.7 rows proposed; v0.4, G2 #1, #6), 01a v2.0.1 (v2.1 proposed, blocking), 01b v1.4.1 (v1.5 proposed), 01c v1.1, 01d v1.1 |
| Inherits | Shared Standards from Foundation v1.9 (§6; unchanged from v1.8 by 03a), not redefined |
| Stories | E4 "ETA calculation", "Hold-and-fire dispatch", "Slip warning" (P1); engine side of E3 (fire, hold at pass) and E1 stock AC4 (first submit wins); README carried rows "To 03a" (00 owner review; 01a S14/S15/§4.4; R6 sizing; 01c §4.4; 01d §4.3) |
| Learned cook times | E4 P2 — out of scope |

**In scope (D1: nothing on the G1 list is deferred, owner 2026-11-02):** `EngineState` v3; `applyEvent`, `buildEngineState`, `planOrder` / `calculateETA`, `getTickIntents`; slot and batch placement; hold-and-fire; the three station policies (Waada Guard, EDF, FIFO) and item knobs (D3–D6); routing across stations (D8–D10); re-plan on every submit (D13, D24, D25); freeze window and auto-fill (D15, D16); overrun cascade, hold at pass, inferred completion (D33, D42, D60); boost (D4); stock reserve, release, consume (01a, 01c carried rows); split send (`ItemsReleased`, D11, D12); live capacity and lanes (D37, §3 #5); station pause (D21); station pressure and the `station_overload` kind (D19, D20); the `slip_warning` named request kind (D11, §3 #7); return to kitchen as a new expedited line (D28, §3.8a). Hub host: the reducer, boot steps 2, 3 and 6, snapshots and the day-close checkpoint (D26), the replay filter and index (§3 #2), missed fires on the first tick (§3 #3), `registerTick('fires')`, the `onBranchConfigApplied` reaction, the commands `SetStationCapacity` and `SetStationPause`, the query `stations-live`; the CI performance test (D27). *Changed in v0.2 (pre-G2 #1, #12):* the second tick `fires_alerts` and the `station_plan` catch-up part and frame.

*Changed in v0.3:* pilot values (stations, capacities, cook times, points, carry times, weights, thresholds) are configuration entered at setup in the 01a pages; this spec states shapes, rules and config defaults only.

**Out of scope:** every screen (02, 03b, 07). Ready to serve, Handover, the assembler view and the Ready-to-serve kind → **03b** (§3 #6, D2). `TableLockReleased` and the lock state → **02** (§3 #8). Estimated Served → **02** (§3 #12). The commands `SubmitOrder`, `BoostOrder`, `ReleaseItems`, `MarkServed`, `RemoveItem`, `ReturnToKitchen` → **02**; the returned line's bill effect and `ItemReturned` → **04**; `StartItem`, `DoneItem`, `UndoDone`, `GiveMeMore` → **03b**; voids and move-to-stock → **04**. These modules write events whose payloads 03a defines (§4.2). Lane claims (03b, 01e). Learned cook times (P2). The customer tracking page (E9, P2).

---

## §2. Existing architecture that must not change

1. **Pure engine, events only (F §4.7, D44, D45).** `@pos/engine` has no I/O, timers or clock. State changes only through `applyEvent`; tick work is written as events first; the live state is swapped only after COMMIT (`engine-host/writer.ts`). A replay of the log rebuilds exactly the live state; nothing reads a wall clock during `applyEvent` (every time is the event's `recorded_at`).
2. **One writer.** Every write goes through `writer.run` (`BEGIN IMMEDIATE`, better-sqlite3, synchronous). A command and a tick never interleave inside a transaction (01d §3.5 race rule).
3. **One reducer.** `state.setReducer(reducer)` takes one reducer (00 §4.2); 03a's `applyEvent` replaces 01a's and keeps its four cases unchanged (`StockSet`, `StockAdded`, `BusinessDayOpened`, `BusinessDayClosed`, 01a S14/S33, 01c V5/V20).
4. **Stock shape (01a S14, carried row).** `stock[stock_item_id] = { on_hand, reserved, set_at, unit }`, integers in the stock unit, both ≥ 0; `availableStock`, `countIsValid`, `canServeFromStock`, `dayDraws`, `dayStockUnit` keep their 01c v1.1 §4.2 signatures and meaning.
5. **Order line contract (01c §4.3).** `ItemAdded` v1 is unchanged; every field is a D25 copy from `branchConfig()` at order time. A config change never alters an open line.

   > ⚠️ **Changed in v1.0.1 (AD-25, accepted; AD-29 Q10, developer ruling):** a config change never alters an open line's **`ItemAdded` copies** (D25: cook times, programs, item knobs, draws, money). It may change the engine's **planning inputs** of a hidden line as §3.11 lists: the route fields (`alternates`, `carry_ms`) of hidden lines are rewritten from `state.config` in the `EngineConfigApplied` fold, so a re-plan uses them from then on; policy, freeze, keep and pressure take effect from the next re-plan or tick. Frozen, fired and FIFO lines keep their copies. Built per §3.11. Was: "A config change never alters an open line."
6. **One tick loop (01d §3.5, §4.2).** 03a registers `{ name: 'fires', due, intents }`; `due` is read-only and cheap; `intents` runs in its own `writer.run`; a throw rolls back only this tick. 01d's `alerts` tick runs first.
7. **Alerts (01d §3.5, §4.2).** Kinds are defined with `defineAlertKind`; a tick raises through `alerts.raiseMany(alerts.tickCtx(tx, now), …)`; request `apply` only reads and returns drafts, each carrying `payload.alert_id`; no catch-all audience on the `order` stream.
8. **Boot ownership (00 §3.8).** Steps 2–3 and 6 are 03a's; 3a, 4, 7, 8 are 00's. `onBranchConfigApplied` hooks run inside the applying transaction and a throw fails the apply (01a S43).
9. **Event store (F §4.1).** Rows are immutable; `seq` is gap-free per branch; upcasting on read (D46).
10. **Command pipeline (00 §3.7, F §6.3).** `POST /commands/:name`, fixed processing order, `processed_commands` idempotency, envelope `{ data }` / `{ error }`.

---

## §3. Domain rules

### 3.1 Module decisions (index)

Every rule in §3.2–§3.12 cites one of these. "Owner module" and "config key" answer 03a-g0 §7 "self-check".

| ID | Rule (short) | Where | Owner module | Config key (01a v2.1 unless noted) |
|---|---|---|---|---|
| D1 | Nothing deferred; cascade, overrun, hold at pass, boost, live capacity, slip, settings all pilot; `two_tap` default | §1, §3.4 (v0.2, pre-G2 #34) | 03a | `stations.completion_mode` |
| D2 | 03a = package + host; Ready to serve/Handover → 03b; lock release, estimated Served → 02 | §1, §4.3 | — | — |
| D3 | Policy per station (`waada_guard` default, `edf`, `fifo`); item knobs; order-type weights incl. `follow_up`; delivery targets the pickup time | §3.5 | 03a | `stations.policy`; `menu_items.{weight_pct, max_early_ms, max_carry_ms, max_late_ms}`; `branch_engine_settings.weight_*_pct` |
| D4 | Waada Guard: the promise never breaks; boost is the one promise-breaker | §3.5.4, §3.9 | 03a | — |
| D5 | Overload: weighted lateness shared evenly | §3.5.6 | 03a | `menu_items.max_late_ms` |
| D6 | `promise_padding_ms` on the promise only; `min_slack_keep_ms` | §3.5.1, §3.5.4 | 03a | `branch_engine_settings.promise_padding_*_ms`, `stations.promise_padding_ms`, `stations.min_slack_keep_ms` |
| D7 | `follow_up` flag set by 02; engine sees only its weight | §3.5.2 | 02 sets, 03a weighs | `branch_engine_settings.weight_follow_up_pct` |
| D8 | Route to the earliest arrival at the point; `min_gain_ms`; allowed stations per order type; `reserve_units` | §3.5.5 | 03a | `station_alternates`, `carry_times`, `stations.reserve_units`, `branch_engine_settings.min_gain_ms` |
| D9 | Ties → home station | §3.5.5 | 03a | `station_alternates.home_for_order_types` |
| D10 | Only hidden ("Later") lines may change station | §3.5.5 | 03a | — |
| D11 | Slip as a 01d `named` request to the table's owner; `send` → `ItemsReleased`; threshold from the engine target | §3.8, §6.2a | 03a kind, 02 table-view path | `branch_engine_settings.{slip_threshold_ms, slip_escalate_ms}` |
| D12 | "Goes with" links pre-tick the Send card; ticked = `expedite` | §3.8 | 01a data, 03a rule, 02 UI | `goes_with_links` |
| D13 | Re-plan on every submit, no events for it, promise never moves | §3.5.3 | 03a | — |
| D14 | Slot station: each unit starts and finishes alone; batch station: a load starts and ends together (v0.3) | §3.6.1 (v0.2, pre-G2 #34) | 01a data | `stations.station_type` |
| D15 | Freeze window; *v0.5 (G4-1 #4, #5):* exactly two exceptions, boost and a capacity change; *v0.6 (G4-2 #13):* a `BusinessDayOpened` that resets an override is a capacity change | §3.4, §3.5.3 | 03a | `stations.freeze_ms` |
| D16 | Chef screen Now / Next / Later; auto-fill; Give me more; Undo 30 s | §3.6.1, §3.6.3, §4.3 To 03b (v0.2, pre-G2 #34) | 03a engine, 03b screen | `menu_items.max_early_ms` |
| D17 | Append at the bottom; never reorder what is visible; human-triggered jumps marked | §3.3, §3.6.3, §4.3 To 03b (v0.2, pre-G2 #34) | 03b | — |
| D18 | Start / Done per line | §3.2 | 03b | — |
| D19 | Engine shows and tells; never stops a station by itself | §3.10 | 03a | — |
| D20 | Pressure and `station_overload` | §3.10 | 03a | `stations.pressure_*` |
| D21 | Station pause, setting default off | §3.10 | 03a | `stations.pause_enabled` |
| D22 | Simulator before §10 tests; property tests on the same harness | §10.6 | 03a | — |
| D23 | Adjacent stations (carry 0) and spread-out kitchens are both served by the same routing (v0.3) | §3.5.5 | — | `carry_times` |
| D24 | Occupancy profile is the station timeline | §3.3 | 03a | — |
| D25 | Pruned re-plan; p99 ≤ 50 ms per submit | §3.5.3, §7.1 | 03a | — |
| D26 | Crash restart ≤ 500 events; full replay from the day-close checkpoint only | §3.12 | 03a | — |
| D27 | Simulator day as the CI performance gate | §10.6 | 03a | — |
| D28 | Return to kitchen: fix or remake = a new line at the expedite weight; `fix` cooks for `adjust_time_ms` with no stock draw; `returns_boost` (config; default in §4.5 A-12) | §3.8a, §4.3 To 02 / 03b / 04 | 02 button, 04 bill, 03b marker, 03a line | `menu_items.adjust_time_ms`, `branch_engine_settings.returns_boost` |

### 3.2 Words, lines and units

- **Line** = one `ItemAdded` with `station_id` not null and `line_kind ≠ 'deal'` (01c §3.4.7: a `deal` line is never fired, reserved or planned; deal parts and option children are lines with their own `serve_mode`, 01c §4.4).
- **Units** of a line = `quantity` when `sale_unit = 'piece'`; `1` for a g / ml line; `1` while a weight is pending (`quantity` null, 01c V18: fired normally, cook time is the item's). Units count against station capacity: a line of 4 pieces holds 4 units for one Start and one Done tap (D18). **P-1** (*Changed in v0.3:* confirmed as the shape; the capacity itself is configuration).
- **Cook time** of a line (01c B1): slot station → `stock_time_ms` when served from stock, else `cook_time_ms`; batch station → `stock_program_cook_time_ms` / `program_cook_time_ms` copied on the line, never from config.
- **Target** `T` = the engine's internal land time at the point; **promise** `P = T + padding` = what people see (D6). **Deadline** `d(L) = T − carry(L) − cook(L) − prep(L)` = the latest fire time that lands on target. **Slack** of a placed line = `d(L) − fire(L)`.
  > ⚠️ **Changed in v1.0.1 (AD-12, developer ruling):** lines of one group that queue on one station (F §4.7 D36) each get their own slot: **`d(L) = slot end − cook(L) − prep(L)`**, with the slot end ≤ `T − carry(L)` (the queue's last slot ends at `T − carry`). It is stored in `EngineLine.deadline_ms`, used by re-plans, slack and slips, and recomputed when the group's `T` moves. A later submit can then no longer make an on-time group late (§3.5.3 "at submit no line is late by construction"). Was: `d(L) = T − carry(L) − cook(L) − prep(L)` for every line.
- **Group** = the sync lines of one order that land together (one `T`). Immediate lines are each their own group. `ItemsReleased` splits a group (§3.8).
- **Table key** = `order_type + ':' + (table_id | car_number | order_id)` (§3 #7): the slip dedupe key and grouping.

### 3.3 Engine state v3 (D24; replaces F §4.7 "Engine state shape", §4.5 F-1)

`ENGINE_STATE_VERSION = 3` (D62: bumped from 2).

```typescript
interface EngineState {
  stock: Record<StockItemId, StockEntry>;          // unchanged (01a S14, 01c V5)
  business_day: BusinessDay | null;                // unchanged (01a S33, 01c §3.5.3)
  config: EngineConfig | null;                     // last EngineConfigApplied (§3.11)
  stations: Record<StationId, StationRuntime>;
  orders: Record<OrderId, EngineOrder>;
  lines: Record<OrderItemId, EngineLine>;
  slips: Record<TableKey, SlipRecord>;             // §3.8
  next_alert_due_at: number | null;                // v0.4 (G2 #4): earliest t at which getAlertIntents(state, t) has a slip item; §3.8
  slip_due: Record<TableKey, number>;              // v0.5 (G4-1 #15): per-key crossing / close time; next_alert_due_at = its minimum
}

interface SlipRecord {                             // v0.4 (G2 #4), written out
  order_ids: OrderId[]; last_estimate: number;     // from the last SlipWarned
  alert_id: string | null;                         // from SlipWarned.alert_id; null after its AlertClosed is folded
  resolved_at: number | null;                      // recorded_at of the fold that resolved every group of the key
}

interface StationRuntime {
  station_id: string; type: 'slot' | 'batch';
  capacity: number; capacity_override: number | null;  // effective = override ?? capacity (D37)
  paused: boolean;                                     // D21
  profile: { t: number[]; u: number[] };               // D24: sorted boundaries, units in use from t[i] to t[i+1]
  unfired: OrderItemId[];                              // sorted by (fire, order_item_id)
  loads: Record<LoadId, Load>;                         // batch only (F §4.7 BatchStationState semantics)
}

interface EngineOrder {
  order_id: string; order_type: 'dine_in' | 'takeaway' | 'delivery' | 'parking';
  table_key: string; table_id: string | null; follow_up: boolean;
  pickup_at_ms: number | null; placed_at: number; placed_by: string | null;
  target_land_ms: number; promise_ms: number;          // copied from OrderPlaced (§3.5.1)
  boosted: boolean; line_ids: OrderItemId[]; awaiting: number;  // lines listed but not yet seen
  last_served_at: number | null;                     // recorded_at of the ItemServed that left no line open (v0.2, pre-G2 #2)
  last_line_fold_at: number;                         // v0.6 (G4-2 #2): recorded_at of the latest fold that names the order or one of its lines (abandon exit, §3.3)
  next_group_index: number;                          // group ids are `order_id + ':' + index` (v0.2, pre-G2 #7)
  groups: Record<GroupId, { target_land_ms: number; line_ids: OrderItemId[] }>;
}

interface EngineLine {
  order_item_id: string; order_id: string; group_id: string; serve_mode: 'sync' | 'immediate';
  station_id: string; alternates: Array<{ station_id: string; carry_ms: number; home: boolean }>;
  point_id: string | null; carry_ms: number; units: number; prep_ms: number;
  cook_ms: number; full_cook_ms: number; from_stock: boolean; program_id: string | null;
  stock_cook_ms: number | null;                        // v0.4 (G2 #7): the ItemAdded copy of the stock cook time (01c B1), null when none
  stock_program_id: string | null;                     // v0.5 (G4-1 #10): ItemAdded.stock_program_id (D25 copy); batch only
  draws: Array<{ stock_item_id: string; quantity: number; reserved: number }>;  // v0.5 (G4-1 #9): ItemAdded.stock_draws as copied (01c §4.3, whole line, D25); [] for a return; never dayDraws or config in a fold. v0.6.2 (G4-3 #2): `quantity` = the draw of the line's current units; `reserved` = the units of it still reserved (0 … quantity)
  reserved_seq: number | null;                         // v0.5 (G4-1 #21): seq of the line's latest StockReserved; v0.6.2 (G4-3 #2): null only when every draws[].reserved is 0
  weight_pct: number; max_early_ms: number; max_late_ms: number | null; max_carry_ms: number | null;  // v0.2, pre-G2 #6
  stage: 'added' | 'cooking' | 'done' | 'served' | 'removed' | 'voided' | 'returned';      // v0.2, pre-G2 #18
  fire_ms: number | null; deadline_ms: number;         // planned fire, latest fire
  fired_at: number | null; started_at: number | null; done_at: number | null;
  mark: null | 'expedite' | 'boost' | 'pulled' | 'return' | 'moved';  // human-triggered jump (D17, D28); 'moved' = a frozen line re-placed by a boost or a capacity change (v0.5, G4-1 #4, #5)
  return_of: { order_item_id: string; mode: 'fix' | 'remake' } | null;  // D28
  load_id: string | null;
}
```

> ⚠️ **Changed in v1.0.1 (state fields as built; v3 was never released, so its key set stayed editable; `ENGINE_STATE_VERSION` stays 3, D62):**
> - **`Load`** (AD-5, final shape, **proposed (not yet ruled)**): `Load = { load_id, program_id, order_item_ids, fire_ms, booked }`. `booked` serves AD-7's exact removal; its member lines have `booked: null`. There is no `fired_at`: a load leaves `loads` when it fires, and its members keep `fired_at` and `load_id`. Was: "`loads: Record<LoadId, Load>` (F §4.7 BatchStationState semantics)", with `Load` not defined.
> - **`EngineLine.booked: { start, end, units } | null`** (AD-7, **proposed (not yet ruled)**): set at every `addInterval` of the line, used and cleared by its removal, so a removal after a capacity change takes off exactly what was booked.
> - **`EngineLine.capped: boolean`** (AD-15, **proposed (not yet ruled)**): the line is held at its `max_late_ms` cap (§3.5.6).
> - **Rounds on a member line** (`rounds`, `occupiedCook`; AD-29 Q11 P4, developer ruling; the storage reading AD-30 P4, **proposed (not yet ruled)**): stored when a member leaves its stored load; a capacity change after the fire, a void before it, or a partial void after it leaves them, so the station can stay booked up to one cook longer than the remaining units need.
> - **`EngineState.diagnostics`** (AD-6, developer ruling): `{ kind, event_id?, station_id?, stock_item_id?, detail }[]`, appended by non-strict folds, logged and cleared by the host after commit; not part of snapshots, checkpoints or the version key-set fixture.

- **The profile is the timeline (D24).** Placing a line = scanning the profile for a window where `units_in_use + units ≤ effective capacity` over the whole cook interval `[fire + prep, fire + prep + cook)` (F §4.7 slot formula, "for every instant s" is the *definition* this implements). Insert/remove = adjust the running counts between two boundaries. `latestFit(lo, hi)` scans backward from `hi`; on a conflict segment `[a, b)` the next candidate is `a − prep − cook`; `earliestFit(lo)` scans forward; on a conflict the next candidate is `b − prep`. Integer ms, no step quantisation.
  > ⚠️ **Changed in v1.0.1 (Review Focus 1 → AD-4, developer ruling; AD-29 Q11 P4, developer ruling):** a line whose `units` exceed the station's effective capacity (for example "Roti × 4" on a tawa of capacity 3, or after a lane Off) holds **all** of the capacity for `cook_ms × ceil(units / capacity)` consecutive rounds (`occupancy(units, cap, cook)` in `profile.ts`; both fits use it, both terminate). The host logs `warn { order_item_id, station_id, units, capacity }` (outside the pure engine). An over-size load keeps its rounds when it is frozen; its slip estimate and `auto_done` count the rounds (task 18d). Was: no rule.
- **In-flight lines (live interval; Changed in v0.5, G4-1 #2; Changed in v0.6, G4-2 #1):** one helper `liveInterval(line, t)` gives the occupancy of every in-flight line and serves all four functions: `applyEvent` (`t` = the event's `recorded_at`), `planOrder` and `calculateETA` (`t` = the handler's `now`), `getTickIntents` (`t` = `now`). *Changed in v0.6.3 (targeted check N-1):* for a fired-not-started line, `liveInterval(line, t)` never begins before `max(fire_ms, t) + prep_ms`, because prep begins at the Start tap and is off-station. A line not started at `t` cannot occupy the station before `t + prep`.
  - **Fired, not started (Changed in v0.6.2, G4-3 #1): packed per station.** The station's fired-not-started lines (a batch station: its fired-not-started loads, each as one unit of placement) are taken in `(fire_ms, order_item_id)` order, and each gets `[s + prep, s + prep + cook)` with **`s`, its packed Start, = the earliest instant ≥ `max(fire, t)` at which `[s + prep, s + prep + cook)` fits within effective capacity beside the COOKING lines' live intervals and the fired lines packed before it**, that is, `s + prep = max(max(fire, t) + prep, the end that frees enough capacity among the earlier packed lines and the COOKING lines)`. *Changed in v0.6.3 (targeted check N-1):* v0.6.2 had `[s, s + cook)` with `s ≥ max(fire + prep, t)`, which left out prep for a line not yet started. A Start at `t` occupies `[t + prep, …)` (F §4.7 D33, D42), so the v0.6.2 packing booked the station up to prep too early, and a Start made on time could push a later line past its promise (test 115). A fired line therefore never shares a unit another fired line still needs: two fired lines on a capacity-1 station run one after the other, not on the same window. The packing slides with `t` until `ItemStarted` fixes each line (§4.5 F-20). It reads only those lines, so it costs O(fired lines × their boundaries) per read; hidden and frozen lines are placed against the packed result, never packed themselves (v0.6, G4-2 #1, sliding; v0.6.2, capacity-aware).
  - **COOKING:** `[started + prep, max(started + prep + cook, t))` (F §4.7 D33; `started` = `min(started_at, recorded_at)`, §4.2).
  - **Every other placed line:** its planned interval.

  The profile stores planned intervals, and `liveInterval` lays the in-flight lines over it at each read, so a submit never books capacity that an unstarted line still needs; an overrunning COOKING line's unknown extension stays the F §4.7 D33 rule, covered by the cascade and the slip. *Changed in v0.6.2 (G4-3 #1):* because the fired lines are packed, the late-start shift at `ItemStarted` (F §4.7 D42) moves a line placed at `t` only by how far the Start came after its packed Start `s` (*v0.6.3, targeted check N-1:* `s`, not `s − prep`; at most `started − t` for the first fired line, and the same delay passed down the packed queue; a Start at `s` moves nothing), never by a whole cook (tests 96, 115, 116). A line of an order that is out of the engine (exit predicate below) occupies nothing.

  > ⚠️ **Changed in v1.0.1:**
  > - **Signature** (P-5, **proposed (not yet ruled)**): the export is `liveInterval(state, order_item_id, t): Interval | null`, because the per-station packing needs the station's other lines. Same meaning. Was: `liveInterval(line, t)`.
  > - **A pulled or early-fill line** (AD-9, **proposed (not yet ruled)**): the `FireDispatched` fold sets `fire_ms = min(fire_ms, recorded_at)`, so packing and fire order use the actual fire; the planned fire stays in the event's `due_at`. Was: the packed Start `≥ max(fire_ms, t)` with the planned `fire_ms`, so a pull could not start a line before its plan.
  > - **Late Start** (AD-24 S1 = AD-29 Q9, **proposed (not yet ruled), developer to confirm**): the late-start shift is **not** rounded to `cascade_step_ms`; it is exactly how far the Start came after its packed Start, as written here and in F-20. F §4.7's pseudocode and failure table quantise it, so the approved texts disagree; the code follows this section. The shift runs F's loop over all reservations (S2); "Start at s" uses `s` as of the moved line's placement (S3).
- `applyEvent` copies only the stations it touches (copy-on-write per station; a profile is ≤ a few hundred boundaries).
- **Exit (§3 #11; Changed in v0.2, pre-G2 #2; Changed in v0.4, G2 #3):** an order and its lines leave the state at `BusinessDayClosed` (which also clears `slips`) — *Changed in v0.5 (G4-1 #6); Changed in v0.5.1 (Q13):* **except an order that has any unserved line** — unfired (hidden or frozen), fired, COOKING or done-unserved — which stays and exits **only by the normal rule** below (30 minutes after its last line is served); a close answered while the kitchen is busy (01a S33 stale-day prompt) never drops a plate on the fire nor an order that 02 still holds open. Only an order whose lines are all served / voided / removed / returned exits at the close — or **30 minutes after its last line is served** (`ORDER_EXIT_AFTER_SERVED_MS = 1 800 000`, an engine constant in the pilot): once no line is open (every line `served`, `voided`, `removed` or `returned`), `last_served_at` is set from that event's `recorded_at`. The exit is a **pure predicate**, `inEngine(order, t) = served_ok ∧ ¬abandoned`, with `served_ok = order.last_served_at = null ∨ t < order.last_served_at + ORDER_EXIT_AFTER_SERVED_MS` and, *Changed in v0.6 (G4-2 #2):*

  **`abandoned = the order has no unfired line ∧ t ≥ order.last_line_fold_at + order_abandon_ms`**

  > ⚠️ **Changed in v1.0.1 (AD-13, proposed (not yet ruled); BF-6):** **`abandoned = the order has no unfired line ∧ t ≥ max(order.last_line_fold_at + order_abandon_ms, the order's latest planned land)`**, where the planned land over its open lines is `(started_at ?? fire_ms) + prep + occupancy cook + carry`. A long legitimate cook is never abandoned before it lands (BF-6), and a fired, never-tapped line leaves at `last_line_fold_at + order_abandon_ms` (test 111). BF-6's literal "clock from `max(last_line_fold_at, latest planned land)`" + abandon was not taken: it disagrees with test 111. Was: the formula above.

  `order_abandon_ms` comes from `state.config.settings` (A-12: default 14 400 000, range 3 600 000–86 400 000). `last_line_fold_at` is the `recorded_at` of the latest fold of one of these events: `OrderPlaced`, `OrderLinesAdded`, `ItemAdded`, `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ItemServed`, `ItemRemoved`, `ItemVoided`, `ItemMovedToStock`, `ItemReturned`, `OrderBoosted`, `ItemsReleased`, or a `FireDispatched` that lists one of the order's lines. Tick-written slips, alert closes, shifts and stock events do not refresh it, so a ghost line cannot keep itself alive.

  An unfired line keeps the order in the engine, because the tick will fire it and its `FireDispatched` refreshes the clock. A delivery held for a pickup hours ahead is therefore never abandoned. A ticket nobody ever taps (a table that walked out) leaves the engine `order_abandon_ms` after its last tap. From then on it holds no capacity (its sliding interval goes with it), it no longer blocks the checkpoint (§3.12), and 02 writes a later addition for that table as a new order (§4.3 To 02 #1). The predicate is exported as `isOrderInEngine(state, order_id, t)` (false for an absent order, §6.1a). **Every reader uses the predicate, never the presence of the row:** `getTickIntents`, `getAlertIntents`, `nextDueAt`, the views, `stationsLive`, and 02's `ORDER_NOT_IN_ENGINE` check (`isOrderInEngine(state, order_id, now)` in the handler). **Physical removal** of an order whose predicate is false happens only inside the fold of an event type on the §3.12 replay lists, at that event's `recorded_at`, so live and replay fold the same events and remove at the same point; an event of any other type (an `audit` receipt, an `AlertSeen`) is not handled by `applyEvent` (returns `state` itself, §6.1a) and never removes anything. Removal never changes a result, because every reader already treats the order as gone. No event is written, so the rule is a pure function of the log (D13). **Fold order for `OrderLinesAdded`** (02's addition or a return): the removal step skips the event's own order; when that order is present, the new line clears `last_served_at` (re-opens it), even if the handler's `now` and the batch's `recorded_at` straddle the deadline by the append gap (§3.5.3); when it is absent, the fold **throws** (a bug: absence means it was removed at a listed event with `recorded_at ≥` the deadline, so 02's check at a later `now` refused it). A `ReturnToKitchen` on an order with `isOrderInEngine = false` is refused `409 ORDER_NOT_IN_ENGINE` (02, §9); *Changed in v0.5 (G4-1 #7):* an **addition** to such an order is never refused — 02 writes it as a **new order** (`OrderPlaced`, same table and bill, `follow_up: true`, §4.3 To 02 #1), so `OrderLinesAdded` is written only for an order in the engine. 05's `BillClosed` becomes a third exit later (no requirement now). Reservations are released by the stock events of §3.7, never implicitly. *v0.6 (G4-2 #2):* an abandoned order's reservations are released by the `fires` tick (`StockReleased { reason: 'abandoned' }`, §3.6.1, §3.7).

  > ⚠️ **Changed in v1.0.1 (AD-20, accepted):** the removal step **skips an exited order while any of its lines has `reserved_seq ≠ null`**, so its reservation can still be released. Every order-stream fold treats such a kept order as absent (`activeLine`), except `OrderLinesAdded`, which re-opens it as a present order (test 78); stock folds still find its lines. `noOrderInEngine` gains §3.6.1's second clause (no exited line holds a live reservation). Was: an exited order could be removed at a listed fold before its abandon or close release was written, leaving its reservation held for good.
- **Absent ids (Changed in v0.5, G4-1 #6):** a fold of an order-stream event whose order or line is not in the state (an `ItemDone`, `ItemServed`, `ItemsReleased` or `ItemStarted` that arrives after its order exited) is a **no-op that returns `state` itself** and is logged once `{ event_type, order_id, order_item_id }` by the host; it never throws, so the writing command (03b's Done, 02's Served, a late slip answer) commits its own events normally. The one exception is `OrderLinesAdded` for an absent order, which throws (above). Test 99.
- ⚠️ **Changed in v1.0.1 — lines from the batch, writer bugs, reused ids:**
  - **Placeholder lines** (AD-8, controller ruling, **proposed (not yet ruled)**): a line enters `lines` at `OrderPlaced` (or `OrderLinesAdded`) as a placeholder, filled by its `ItemAdded`. Reader rule: a placeholder of an order with `awaiting > 0` is not yet a line (never placed, never in `unfired`). The order's `target_land_ms` / `promise_ms` = the max over its groups (`recorded_at` when it has no group).
  - **Writer-bug `ItemAdded`** (AD-8, **proposed (not yet ruled)**): null `serve_mode` or cook time, a missing station, an unlisted id. Strict: throws. Non-strict: an `invalid_event` diagnostic; a **listed** bad line still decrements `awaiting` and is dropped, so the rest of the order plans; an **unlisted** one changes nothing. The absent-order `OrderLinesAdded` throw stays in both modes.
  - **A dropped line is never silent** (AD-8 developer condition, developer ruling; AD-33 (22a), accepted): the drop goes to `state.diagnostics`, the host logs it at `warn`, and `fires_alerts` raises an `engine_line_dropped` `info` alert to managers (values `{ order_id, order_item_id, reason }`, §6.2a, §6.4). "Dropped" = an `ItemAdded` dropped for any reason except `line_not_listed`, an `ItemAdded` refused with `stream_id_mismatch` (its placeholder stalls the order), or any refused `OrderPlaced` / `OrderLinesAdded`.
  - **A reused live `order_item_id` is rejected** (AD-29 Q5, developer ruling): `listLines` refuses it (strict throws; non-strict `invalid_event`, nothing written). **The device mints `order_item_id`** (To 02). Readings (AD-30 Q5, **proposed (not yet ruled)**): "reused" covers every id in `order_item_ids`, an id listed twice in `lines[]` or across groups; an id whose order has left the state is free again; a `StockReserved` on a line past `added` is a writer bug; a fresh or fired line at `added` cannot be told from a legal flip (a known limit, pinned, closed by the To 02 row).
  - Was: no rule for any of these.
- **Deterministic ids (Changed in v0.2, pre-G2 #7):** the pure engine has no id generator. A group id is `order_id + ':' + index` (`OrderPlaced.groups[]` take 0…n−1; a split by `ItemsReleased` or a new group from `OrderLinesAdded` takes `next_group_index`). A batch load id is `station_id + ':' + the earliest order_item_id in the load`; it may change while the load is unfired (re-plan) and is fixed by `FireDispatched.load_id`. *Changed in v0.2.1:* the id is a **name, not membership**: it stays when that line is voided or removed before the fire. Tested by test 81.
  > ⚠️ **Changed in v1.0.1 (AD-5, proposed (not yet ruled)):** when a new load's name would collide with a load that already has it, the name takes a `:k` suffix (outside this section's form). Was: no rule.
- ⚠️ **Changed in v1.0.1 — batch loads in the profile (AD-18, accepted):** a load books the **whole station** once (F "capacity = M items per load", "no overlap against any existing load", F test 14), one load at a time. J1 a joiner needs the same copied cook time. J2 a joiner must be prepped by the load's start (`start − prep ≥ t`), and the load's fire becomes `min(fire, start − prep)`. J3 an immediate line joins the earliest load only if it lands no later than in a new load. J4 the pass-1 keep cushion applies to the freshness target. J5 / J6 in the §3.5.6 search each formed load (and the late lines of one stored load) is one unit. J7 a unit's deadline = the min over its members of `d(m) + prep(m) − max prep`; the binding member gives weight, cap and tie-break (the exact form would take the min over the members' own `d_Λ`). L1 a partly started load packs as one interval. N1 a re-formed load keeps its old name. Was: "F §4.7 BatchStationState semantics" only.

### 3.4 Line states in the engine

```
 ItemAdded ─► ADDED (hidden "Later") ──fire ≤ t+freeze──► ADDED (frozen "Next") ──FireDispatched──► ADDED (fired "Now")
      │                                                                                      │ ItemStarted
      │ ItemRemoved / ItemVoided (any stage before served) → removed / voided                ▼
      │                                                                                   COOKING ──ItemDone──► DONE ──ItemServed──► SERVED
      │                                                                                      ▲                    │
      └─ ItemsReleased.expedite → immediate, mark 'expedite'                                 └──ItemDoneUndone────┘ (≤ 30 s, 03b)
 SERVED ──ReturnToKitchen (02)──► a NEW line, mark 'return', immediate, expedite weight (D28, §3.8a); the served line stays (fix) or is `returned` by 04 (remake)
```

- **Hidden** = unfired and `fire_ms > t + freeze_ms`: may move in time and station (D10, D13). **Frozen** = unfired and `fire_ms ≤ t + freeze_ms`, evaluated at the event's `recorded_at` (D13, D15): fixed input to every re-plan; nothing is inserted before it (D15). *Changed in v0.5 (G4-1 #4, #5):* D15 has **exactly two exceptions**, both human-triggered: an `OrderBoosted` (§3.9) and a **capacity change** (`StationCapacitySet`, lane Off / On, an `EngineConfigApplied` that changes `capacity`, *v0.6 (G4-2 #13):* a `BusinessDayOpened` that resets a `capacity_override`; §3.10, §3.11). In those two folds frozen lines are re-placed with the hidden ones; fired and COOKING lines stay fixed. *Changed in v0.6 (G4-2 #16, #15, #14):*
  - Each frozen line is placed first, at `earliestFit(its current fire_ms)`, so it moves only later and only as far as needed; pass 1 then places the hidden lines.
  - A frozen line that still does not fit joins the late set, and §3.5.6 re-places it with the hidden lines.
  - A frozen line whose `fire_ms` changed gets the red marker `mark: 'moved'` (§3.3, §4.3 To 03b #2).
  - Every displaced order whose estimate passes `T + slip_threshold_ms` gets a slip on the next `fires_alerts` pass (§3.8); a smaller push raises none. **Fired** never moves (D44) except by `ReservationsShifted` (cascade, F §4.7 D42) and is never fired twice.
- **Order READY (§3 #9)** = every sync line of the order is `done` (or later). "Ready to serve per point" is 03b's view state.
- **Hold at pass (F §4.7, D1):** a `done` sync line whose group has a line not yet `done` is shown HOLD by 03b from `groupReadiness` (§6.1). *Changed in v0.3 (owner, A5 / A8):* HOLD is a **hint on the assembler view, never a block** (01d K4): whatever is ready may be marked Ready to serve; the split send of §3.8 stays the digital path.
- ⚠️ **Changed in v1.0.1 (AD-10, controller ruling, proposed (not yet ruled); developer note, developer ruling):** a stage event from the wrong stage (a double Start from two tablets, Served twice, Undo after Served) is a **silent no-op** in the fold that returns `state` (the absent-id spirit of §3.3: real duplicates, not writer bugs). Done is allowed from `added`; an Undo with no `started_at` falls back to `done_at`; Removed and Voided are allowed from `added`, `cooking` and `done`. This does **not** replace 03b's command-level `409 ITEM_WRONG_STAGE` (carried To 03b, §4.3). Was: only the main transitions shown above.

### 3.5 Planning

#### 3.5.1 Target and promise at submit (D3, D6)

`planOrder(state, proposed, t)` (§6.1; `ProposedOrder` in §4.2, v0.2 pre-G2 #8) runs inside 02's `SubmitOrder` transaction with the live state and `t = clock.branchNow()`:

1. **Orderable check:** any line routed only to a paused station → `409 STATION_PAUSED` (D21, §9). Stock first-submit-wins as §3.7.

*Changed in v0.5 (G4-1 #3):* steps 2–4 are **one sequence**, the same in `planOrder` and in the fold that re-plans at the last listed `ItemAdded` (§3.5.3), so both reach the same placement:

2. **Pass 1** of §3.5.3 on every station a line of the order may use (its home station and its allowed alternates, §3.5.5; *v0.6, G4-2 #23*): older hidden lines are re-placed within their slack (keep first, D6), against the fixed lines with their live intervals (§3.3).
3. **Immediate lines (D36),** tentatively: each placed at `earliestFit` on its best station (§3.5.5) against **the profile after pass 1**; its target = its land time; its interval is added to the profile.
4. **Sync group:** the F §4.7 hold-and-fire full-pass loop (D16, D35, D36, D49), run against the profile after steps 2–3; each sync line's station interval ends at `T − carry`. Delivery (D3): `T = max(pickup_at_ms, loop result)` when 02 sets a pickup time.

Because pass 1 runs before the new lines are placed, a newer order still takes only capacity the older lines leave (D6), and no new line is placed on an interval pass 1 then takes back (test 98).

**When the fold plans (Changed in v0.6, G4-2 #4; no marker field):** `EngineOrder.awaiting` starts at `OrderPlaced.order_item_ids.length` (for an addition, at `OrderLinesAdded.order_item_ids.length`, added to what is still awaited). Each folded `ItemAdded` of that list decrements it. The fold runs steps 2–4 at the `ItemAdded` that brings `awaiting` to 0, and at no other event of the batch. The order's `StockReserved` events follow in the batch. *Changed in v0.6.1:* they match `OrderPlaced.lines[].from_stock = true`, so their folds flip nothing and never re-plan; only a `StockReserved` that flips a line's `from_stock` from false to true re-plans (a `StockAdded` reservation, §3.7). The count is in the first event of the batch, so the end of the batch is known without a marker, live and in replay (test 104).
5. **Promise:** `P = T + padding`, `padding = stations[...]?.promise_padding_ms ?? settings.promise_padding_<order_type>_ms` (max over the group's stations) (D6; per-order-type shape, §12.3 Q3). FIFO and EDF stations use padding 0 for their lines (D3).
6. `T` and `P` (per group, and per immediate line) are **written into `OrderPlaced`** (§4.2), with group ids `order_id:0…n−1` (§3.3). `applyEvent` never recomputes them, so replay and engine-version full replays keep every promise (**P-2**).

The submit response shows `P`; the engine works to `T`. Slack is measured from `T`, so padding is never consumed by other orders (D6).

#### 3.5.2 Weights (D3, D5, D7)

`w(L) = weight_pct(L) × (follow_up ∨ L.mark ∈ {expedite, return} ? weight_follow_up_pct : weight_<order_type>_pct) / 100` (percent; 100 = 1.0; *Changed in v0.2, pre-G2 #19:* expedite and return lines take the follow-up weight, D12, D28). EDF stations use `w = 100` for every line (D3). The branch weights are read from `state.config` at each re-plan, so a weights change re-weighs **open** orders from the next re-plan; only the item's `weight_pct` is a D25 copy (*Changed in v0.2, pre-G2 #22*; test 90, v0.4 G2 #13). The weights are configuration (defaults in §4.5 A-12; *Changed in v0.3*).

#### 3.5.3 Re-plan (D13, D15, D24, D25)

A re-plan of station `S` at time `t` (the triggering event's `recorded_at`):

```
fixed  = lines on S that are fired, COOKING (live interval, §3.3; v0.6), frozen (fire ≤ t + freeze_ms), or done
         + lines of other triggering orders already placed in this event
         − frozen lines, in a boost or a capacity-change fold only (D15 exceptions, §3.4; v0.5)
pivot  = (submit only; v0.5, G4-1 #1) min over the new lines L on S of earliestPossible(L):
           earliestFit(lo_L) against the fixed profile, where
           lo_L = t                                            for an immediate line (fire times; v0.6, G4-2 #8),
           lo_L = max(t, d_min(L) − max_early_ms(L))           for a sync line,
           d_min(L) = T_min − carry_L − cook_L − prep_L,  T_min = t + max over the order's sync lines of (prep + cook + carry)
fixed += hidden older lines on S whose interval ends ≤ pivot   // D25 prune: no new line can start before
                                                               // pivot, so these never compete with it
free_old = remaining hidden lines on S (older orders)
pass 1: for L in free_old ordered by (d(L) − keep, −w(L) × (t − placed_at), order_item_id):
          place L at latestFit(lo = max(t, d(L) − max_early_ms(L)), hi = d(L) − keep)   // keep cushion (D6)
          else latestFit(lo, hi = d(L))                                                  // its own keep, still on time
          else → late set (§3.5.6)
pass 2: (submit) the new order's immediate lines, then its sync loop, as §3.5.1 steps 3–4
```

*Changed in v0.5 (G4-1 #1):* `earliestPossible(L)` is a lower bound on where `L` can start (a sync line is never placed before `d − max_early_ms`, and `d ≥ d_min` because `T ≥ T_min`), so a pruned line never overlaps a new line's interval. *Changed in v0.6 (G4-2 #7, #8):* the pruned result is **not** identical to the unpruned one. Unpruned, pass 1 may move a pruned older line later (at most within its `max_early_ms` window) into the new order's window, so `T_pruned ≤ T_unpruned`, and test 23 asserts exactly that. `lo_L`, `earliestFit` and the pivot are **fire times**. "Interval ends ≤ pivot" compares an older line's interval end with the new line's earliest fire, which is at or before that line's interval start `fire + prep`. v0.4's pivot `t + prep` lay before every hidden line's end and fixed nothing (G4-1 #1). The number of lines re-placed per submit is **measured by the drill** (D27, §10.6) and its CI bound is set in the plan from the TypeScript simulator's first run, not asserted in this spec.

- `keep = min_slack_keep_ms` of the station (Waada Guard); `0` on EDF (D3). **The last `keep` of an older line is never given to a newer order (D6):** pass 1 runs before the new lines, so a newer order can only use capacity the older lines leave.
- **Triggers (D13):** *Changed in v0.5 (G4-1 #12):* **one re-plan per station per batch**, run at the batch's trigger event and *v0.6 (G4-2 #4):* the trigger is the `ItemAdded` that brings `awaiting` to 0 (§3.5.1), or the `StockSet` / `BusinessDayClosed` that follows its releases. *Changed in v0.6.1:* the one exception to "once per batch" is the `StockAdded` path, which re-plans once per flipped line (a `StockReserved` that flips `from_stock`), bounded by the lines the added stock reaches. The triggers are: the last listed `ItemAdded` of an `OrderPlaced` / `OrderLinesAdded` (stations the order uses); `ItemRemoved`, `ItemVoided`, `ItemMovedToStock` (that station; the group's `T` may move earlier, never later: `T' = min(T, loop result)`; the promise `P` never moves; tested by test 89, v0.4 G2 #13); `OrderBoosted` (§3.9); *Changed in v0.6 (G4-2 #4); Changed in v0.6.1:* a `StockReleased` fold changes stock bookkeeping only. A `StockReserved` fold re-plans the line's station **only when it flips that line's `from_stock` from false to true**, which happens only for a reservation written after a `StockAdded` (§3.7, foundation D23 "stock update"). A submit's own `StockReserved` events re-plan nothing (§3.5.1). A recount re-plans at its own `StockSet` (every station with an unfired line drawing on that stock item), and a day close at its own `BusinessDayClosed` (every station with an unfired line). The writer appends each of these **after** its `StockReleased` drafts (§4.2 batch order), so one re-plan per station follows all the releases of the batch (*v0.4, G2 #21:* `unit_changed` dropped, §3.7); `StationCapacitySet`, `EngineConfigApplied` changing capacity, *v0.6 (G4-2 #13):* `BusinessDayOpened` when it clears a `capacity_override` (whole station; *Changed in v0.5, G4-1 #5:* frozen lines re-placed with the hidden ones, D15 exception, §3.4); `ItemsReleased` (§3.8). **No event is written for a re-plan** (D13, D44): it is a pure function of `(state, event, recorded_at)`; R6's ≈ 45k events/day stand. `ReservationsShifted` is written by the tick (overrun) or by 03b's Start command (late start, F §4.7 D42), never for a re-plan (*Changed in v0.2, pre-G2 #20*).
  > ⚠️ **Changed in v1.0.1 (AD-11, proposed (not yet ruled)):** for a void or remove, `T' = min(T, loop result)` is computed for the ended line's **group across all its stations**: pass 1 on that station, then the group's loop re-places its hidden lines on every station they use. The floor is the pickup time and the land of each sibling that cannot move; the promise never moves; only the ended line's group is re-looped (other groups of the order are not). Siblings on other stations take only free capacity. A partial void re-plans its group the same way (AD-19). Was: "(that station; the group's `T` may move earlier, never later …)".
- **FIFO stations (D3):** no hold, no re-plan of older lines: each new line is placed at `earliestFit(t)` in submit order; its target is that land time.
  > ⚠️ **Changed in v1.0.1 (AD-14 and its task-11 amendment, proposed (not yet ruled)):** targets exist per group, so a FIFO sync line is placed like an immediate line (listing order, `earliestFit(t)`, no hold, `pickup_at_ms` ignored), and its land is a **floor** for the group's `T` (`T` ≥ every FIFO land and ≥ the pickup). Its deadline = its fire; padding 0 on FIFO stations; `replanEnded` never re-loops FIFO lines. With routing, each station's policy applies to the lines placed on it: a line whose allowed stations are all FIFO keeps this path; a mixed-option line may land on a FIFO station at its earliest fit (never held), placed after the batch's all-FIFO lines in `syncOrder` (not strict listing order); a re-plan never moves a line onto or off a FIFO station. Was: "its target is that land time".
- A re-plan that leaves a line late (only after a disturbance: capacity drop, overrun, boost, recount) goes to §3.5.6. **At submit no line is late by construction**, up to the gap between the handler's `t` and the batch's `recorded_at` (one stamp per append, `engine-host/append-events.ts:12`): a line that no longer fits by that gap is placed at its earliest fit and the next tick slips it (*Changed in v0.2, pre-G2 #21*; test 91, v0.4 G2 #13). A full kitchen shows as a later promise and a red pressure band (D20), not as lateness.

#### 3.5.4 Waada Guard under normal load (D4)

No line is placed past `d(L)` except by boost (§3.9) or overload (§3.5.6). Within slack, ties are broken by `w × waiting` (pass 1 order, auto-fill §3.6.1; v0.2, pre-G2 #35). The simulator (§10.6) compares the three policies on % promises kept, max late, mean wait by order type, cold time and utilisation (D22).

#### 3.5.5 Routing (D8, D9, D10, D23)

- A line may go to its routed (home) station or an **alternate** (01a v2.1 `station_alternates`, slot stations only — **P-3**) that allows the order type, whose `carry_ms(station → line's point) ≤ max_carry_ms(L)` (copied on the line, D25; *Changed in v0.2, pre-G2 #6*), and that is not paused.
- **Immediate line:** arrival = land at the station + carry; choose the minimum arrival; if it beats the home station by less than `min_gain_ms`, use the home station (D9). The home station for an order type = the alternate whose `home_for_order_types` lists it, else the routed station.
- **Sync line:** at candidate `T`, it fits if it fits at any allowed station with interval ending at `T − carry`; preference: home, then lowest carry, then `station_id`. `T` advances by the smallest advance over all allowed stations.
- **Reserve (D8):** `reserve_units` of a station are usable only by its home order types; others see `effective capacity − reserve_units`. Default 0.
- **Re-routing (D10):** only hidden lines may change station in a re-plan; a frozen or fired line belongs to its station; on station Off the assembler reassigns those by hand (K8, 03b).
- With every carry 0 and no alternates (the config defaults, §4.5 A-9, A-10), routing reduces to "the routed station"; with alternates and carry 0, to "wherever it is ready first" (D23; *Changed in v0.3*).
- ⚠️ **Changed in v1.0.1 (AD-17, accepted):** bookkeeping as built. R1 a line's `station_id` is its current station and `alternates` the other allowed stations (swapped on a move); `routed_station_id` (= `ItemAdded.station_id`, the D25 home route) is never carry-filtered, while every alternate (a home one too) must pass carry. R3 a hidden line re-routes only when it fits neither by `d − keep` nor by `d` on its own station, or the reserve shuts it out. R6 the reserve's home order types are read per line. R7 a placed line keeps its paused station; nothing moves onto one. R9 lines of different home stations sharing a station queue in home-id order. A re-routed line is fixed input on its target (it takes only free capacity). Reserve fallback: a new or placed line with no allowed station left books its own station at full capacity with a `reserve_fallback` diagnostic (deduped by the host); a placed line that fits nowhere goes late at its earliest fit on the first allowed station. `checkOrderable` refuses `STATION_PAUSED` when the allowed set has no unpaused station. **For 02:** `OrderPlaced.lines[]` copies `PlanResult.lines[]` `station_id`, `alternates` and `carry_ms` verbatim. Was: no bookkeeping rule.

#### 3.5.6 Overload — weighted lateness (D5)

When a re-plan leaves a late set: re-place **all** hidden lines of the station with extended deadlines `d_Λ(L) = d(L) + min(Λ × 100 / w(L), max_late_ms(L) ?? ∞)` (EDF order on `d_Λ`, `latestFit(…, hi = d_Λ)`, keep not applied), for the smallest `Λ` (multiples of `cascade_step_ms`, exponential then binary search, ≤ 16 probes) at which all fit. A weight-2 line carries half the lateness (D5). A line held at its `max_late_ms` cap is not shifted further; if it still cannot fit it is placed at `earliestFit` after the others (a reporting cap, never a refusal, D3) and the station raises `station_overload` (§3.10). Optimal for one slot (Lawler), heuristic for capacity > 1 — the simulator decides (D5, §12.3 Q1).

> ⚠️ **Changed in v1.0.1 — the search as built:**
> - **Readings** (AD-15 and its amendment, **proposed (not yet ruled)**): (1) lines are placed **backward**: descending `d_Λ`, each at `latestFit(hi = d_Λ)`, keep off, so the execution order is EDF on `d_Λ` and Lawler's one-slot optimality holds (read literally, the forward form is not optimal). (2) The re-placed set is the free hidden lines of the station's pass-1 set; pruned and void-held lines stay fixed. (3) Success at Λ = every line not at its cap fits. A capped line leaves the search only if it cannot fit by `d + max_late_ms` against the base with every uncapped line removed (one extra pass, not a Λ probe); otherwise it is held at its cap; capped lines that do not fit go to `earliestFit` after the others. Λ = 0 is probed first. (4) No Λ within 16 probes → the largest Λ probed, leftovers capped. The flag is `EngineLine.capped` (§3.3).
> - **Forward compaction** (AD-16, developer ruling): after the search, the re-placed lines are walked in execution order and each moves **earlier, never later**: to its latest fit by its own deadline `d` if one exists, else to the earliest fit no later than its current fire. The order the search chose is kept, and `capped` is recomputed from the final placement (lateness > 0). Without it, `latestFit(hi = d_Λ)` pushed lines that could be on time (one slot: C due 12:30 fired at 12:40).
> - Was: "EDF order on `d_Λ`, `latestFit(…, hi = d_Λ)`, keep not applied", with the re-placed set, the success test, the fallback and the flag unstated.

### 3.6 The `fires` and `fires_alerts` ticks (§3 #3, D44, D60, D42, D16)

*Changed in v0.2 (pre-G2 #1):* two registered ticks. **`fires`** writes engine intents only (items 1–4 below and the config catch-up, §3.11); **`fires_alerts`**, registered right after it, raises and closes the `slip_warning` and `station_overload` alerts and writes `SlipWarned`, each in its own transaction (01d §3.5 isolation). A throw in `fires_alerts` (a bad raise input, a resolver error) rolls back only the alerts of that pass and never a fire; D44 holds per tick. **One-tick lag:** `fires_alerts` reads the state `fires` has just swapped in the same pass (01d `tickPass` reads `deps.state.get()` per tick, `alerts/tick.ts:380-383`), so a slip is normally raised in the pass that sees it; when `fires_alerts` fails or is skipped, its alerts follow one pass (500 ms) later, retried every pass. 01d's own `alerts` tick, first in the order, sends later steps from the next pass.

#### 3.6.1 Intents of one `fires` pass (`getTickIntents(state, now)`, pure)

1. **Scheduled fires:** every unfired line (or batch load) with `fire_ms ≤ now` → `FireDispatched { reason: 'scheduled' }`, grouped per station and load. A batch load pulls in compatible unfired lines whose target lies within the station's freshness window, capped per line by `max_early_ms` (F §4.7 D14/D17; D3 "batch: caps freshness").
2. **Auto-fill (D16):** for each slot station with idle units now (after 1.), fire from frozen-then-hidden lines with `now ≥ d(L) − max_early_ms(L)` whose whole cook interval from `now` fits: Waada Guard — lines with slack ≤ keep first (EDF), then max `w × waiting`; EDF — by `d`; FIFO — not used (FIFO fires at once). `FireDispatched { reason: 'early_fill' }`.
3. **Inferred completion (F §4.7 D60):** `single_tap` → `ItemStarted { source: 'inferred' }` with each fire; `auto_done` → `ItemDone { source: 'inferred' }` at `started_at + prep + cook` unless tapped.
4. **Cascade (F §4.7 D42):** an overrunning COOKING line pushes later unstarted reservations → one `ReservationsShifted { cause: 'overrun' }` per station, quantised to `cascade_step_ms`.
4a. **Abandoned reservations (v0.6, G4-2 #2):** for every line of an abandoned order (§3.3) that still has a live reservation (`reserved_seq ≠ null`), `StockReleased { reason: 'abandoned' }` per draw, from `stockEffects`, so `reserved` never keeps units for a ticket nobody cooks.
5. **Slip candidates and overload** are **not** `fires` intents (v0.2, pre-G2 #1): `getAlertIntents(state, now)` (pure, §6.1) returns them for `fires_alerts` (§3.8, §3.10, §6.2a).

> ⚠️ **Changed in v1.0.1 (AD-21 tick readings, accepted; AD-20, accepted):** one `FireDispatched` per (station, planned fire), and one per load (whole). A firing load pulls in lines by placement's join rule at `now`. Auto-fill fits against the others' planned bookings; the Waada Guard urgency is `deadline_ms − fire_ms ≤ keep`. An inferred start is at the pass's `now`, followed by its `StockConsumed`. The cascade shifts only unfired bookings, due at the first ms of overlap. `nextDueAt` tests listed candidate instants, so a window that opens between them is found ≤ 500 ms later. **`ReservationsShifted` fold** (F §4.7 D42): each listed unfired line or load moves by `by_ms`; deadline and `T` unchanged; no re-plan; fired, started or absent targets are skipped; a line on another station, or a load with two `by_ms` (`shift_conflict`), is an AD-8 writer bug. Without that fold the hub re-wrote the same shift every 500 ms. Was: these readings unstated.

All intents of one `fires` pass are written in **one** transaction (D44), the fires tick's own (01d §3.5). `fires.due(db, state, now)` is pure: `now ≥ nextDueAt(state)` (the minimum of the earliest unfired `fire_ms`, the earliest auto-fill eligibility, the earliest inferred Done, the earliest cascade step, and — *Changed in v0.6 (G4-2 #9)* — during an overrun the next `cascade_step_ms` boundary of the overrunning line, never its planned end, which yields no intent; *v0.6 (G4-2 #2):* also the earliest `last_line_fold_at + order_abandon_ms` of an order with a live reservation and no unfired line; property: `getTickIntents(state, nextDueAt(state))` is non-empty, test 62) or the host flag `configStale` (§3.11). *Changed in v0.5 (G4-1 #6):* `due` also handles the host flag `checkpoint_pending` (§3.12): when it is set and `noOrderInEngine(state, now)` holds (pure: no order of `state.orders` passes `isOrderInEngine` at `now`, and no line of an exited order holds a live reservation; *v0.6, G4-2 #3*), `due` schedules the deferred day-close checkpoint (`setImmediate`, like a snapshot; not a transaction of this tick) and clears the flag — no statement in `due` itself. *Changed in v0.4 (G2 #4):* `fires_alerts.due` is `now ≥ state.next_alert_due_at` (the slip part, a pure state field, §3.8), or the host overload check (§3.10, in memory), or the host flags `day_closed` (§6.2a) and `reconcile` (first pass after boot) — no statement and no `listOpen`. A raised slip or overload that persists unchanged is **not** due again, so an idle or steady kitchen opens no transaction (01d §4.3 To 03a; no 15 s timer, v0.2 pre-G2 #23).

#### 3.6.2 Missed fires (§3 #3)

Boot writes nothing for missed fires. Step 6 (03a) computes a dry `getTickIntents(ctx.initialState, ctx.clock.branchNow())` — the state replayed at step 3, unchanged before step 6, and the clock 00 creates at step 3a (*Changed in v0.4, G2 #6*) — and hands the `FireDispatched` line count to step 8 as `missed_fires` (00 `HubStarted`; both `BootContext` fields need the additive 00 row H-1, §4.5). The first tick (≤ 500 ms after the server opens) dispatches them as ordinary `reason: 'scheduled'` fires. *Changed in v0.5 (G4-1 #16):* the `'missed'` reason is **dropped** — a pure `getTickIntents(state, now)` cannot know the boot time; 07 derives "missed" as `FireDispatched.due_at < HubStarted.hub_up_at ≤ recorded_at` (§4.3 To 07). Lines fired before the outage are not fired again (F §4.7 D44); their tickets are reprints (03b).

#### 3.6.3 Station plan to the KDS (Changed in v0.2, pre-G2 #12)

Re-plans write no event (D13) and lines enter the freeze window with time, so the KDS cannot learn the plan from events, and `ItemAdded` carries no fire time (F §5.9 step 11 changed, §4.5 F-15). 03a gives 03b the plan directly:

- **Catch-up part `station_plan`** (staff and station sockets; for a station session only its own station): per station `{ station_id, as_of_seq, lines: [{ order_item_id, order_id, fire_ms, deadline_ms, mark, frozen }] }` for every unfired line, from `stationPlan(state, station_id, now)` (pure, §6.1), 0 statements.
- **Frame `station_plan`** (`WsServerMessage` union, F §6.5): the same body for one station, sent to the same audience as the catch-up part — the station sockets of **that** station and every staff socket (*Changed in v0.4, G2 #19*) — after commit (`writer.addAfterCommit`) for every station whose plan changed in that commit (the reducer marks touched stations), and when a line enters the freeze window. *Changed in v0.2.1:* entering Next is time passing, not an event, so it never opens a transaction. `firesDue(state, last_pass_ms, now)` (pure, §6.1) returns `{ intents_due: boolean, crossed: StationId[] }` — `crossed` = stations with an unfired line whose `fire_ms − freeze_ms` lies in `(last_pass_ms, now]`. The `fires` tick's registered `due` (01d `TickDef.due`, run by the loop outside any transaction, `alerts/tick.ts:380`) calls it, keeps `last_pass_ms = now` in host memory, and, when `crossed` is non-empty, sends the `station_plan` frame for those stations through `ws.sendToDevices` (00 H-4) — a send of already-committed state, like 01d's catch-up, not a write — then returns `intents_due`. When intents are also due, the frames for the same pass go out from the after-commit hook instead (one frame per station per pass). After a restart `last_pass_ms` starts at boot time, and the catch-up part covers the rest. 01d's "an idle kitchen opens no transaction" rule holds with no exception. One frame per changed station per commit.

  > ⚠️ **Changed in v1.0.1 (AD-35 (a) and (b), owner rulings 2026-11-07; 22b-2, 22b-3, 22b-5, accepted):**
  > - **Sender (a):** both the freeze-entry frames and the after-commit frames are sent with **`ws.sendToSessions`** (00 AD-74), to the audience above (tested). `sendToDevices` also reaches a device's alert-mode socket, which 00 H-1 / F-6 limits to alert frames, so **00 H-1 wins**: an alert-only connection never gets plan frames. Was: "through `ws.sendToDevices` (00 H-4)".
  > - **Payload filter (b):** a station's `station_plan` frame is sent only when its payload `{ station_id, lines }` (`as_of_seq` left out) **differs from the last one sent to that station**. This covers a line-only change: an expedite on a frozen line still sends a frame; a Start tap on a fired line sends none. Was: "for every station whose plan changed in that commit (the reducer marks touched stations)".
  > - **22b-2:** a socket's station is noted when its catch-up part is built (`connectedSessions()` has no `stationId`); 0 statements.
  > - **22b-3:** the catch-up part is an array of bodies, one per station in `state.stations` sorted by id, archived included; a station socket whose station is unknown gets its own empty body.
  > - **22b-5:** the frame goes out in the after-commit hook **before** that commit's event frames (`writer.addAfterCommit` order). For 03b.
- 03b's Now / Next / Later screen reads `station_plan` and the line events (§4.3 To 03b), never `latestStartAt`.

### 3.7 Stock (01a S14, S41, S44, S45; 01c §3.5, §4.4; carried rows)

- **Reserve at submit (F §5.9 step 5 as changed, §4.5 F-9):** `reserveStock(state, proposed, dayStartMs, stockItems, configStockUnits)` (*Changed in v0.2, pre-G2 #27:* the config stock items and units the built `availableStock` and `dayDraws` need, `packages/engine/src/stock.ts:27-72`) per line, per draw: the line is served from stock only when **every** draw passes `canServeFromStock(availableStock(…), line quantity, quantity_per_sale_unit)` after the units already claimed in this command (01c §3.5.2); then one `StockReserved { stock_item_id, order_item_id, quantity }` per draw (`quantity` = draw quantity on the line). Otherwise: `cook_fresh` → full cook time; `sold_out` at available 0 → **refused** (02's code; first submit wins, E1 stock AC4; the [ASSUMPTION] of 01a S32, adopted). `OrderPlaced.lines[].from_stock` records the outcome.
  > ⚠️ **Changed in v1.0.1 (AD-19, accepted; AD-29 Q8, developer ruling):** a `sold_out` line whose draws do not all fit is refused **also when 0 < available < needed** (02 greys an item out only at 0, so a short line looks orderable and is then refused; ruling: stands). Other readings as built: engine drafts are `StockReservedDraft` (the event part, no envelope); `reserveStock` reads each line's own `stock_draws` (`configStockUnits` unread); a stock item not in `stockItems` reads available 0; a whole void keeps units and draws; over-reserving clamps and is a breach; a stock event naming a draw the line lacks is an AD-8 writer bug; "frozen or fired" = `fired_at` or `fire_ms ≤ t + freeze_ms`; a `StockReserved` for an absent or dropped line is a no-op, while a release or consume for an absent line still moves the entry; a partial void re-plans its group like a void (§3.5.3, AD-11); `stockEffects` also has an array form for one command (BF-8); a unit-changing `StockSet` consumes every holding line (Q14), hidden / frozen judged at the draft's `occurred_at`. Was: "`sold_out` at available 0 → refused".
- **Release (explicit events, P-4; Changed in v0.6, G4-2 #5, #11, #12, rules per cause):** `StockReleased { stock_item_id, order_item_id, quantity, reason }` with `reason ∈ removed, voided, moved, recount, day_closed, abandoned`. The writer of the triggering event appends them from one pure helper, `stockEffects(state, draft)` (§6.1). **A release always covers every draw of the line together:** one `StockReleased` per draw, on every stock item, because a line is from stock whole or not at all (01c §3.5.2). *Changed in v0.6.2 (G4-3 #2):* a release covers either **the whole line** (every draw's remaining `reserved`) or, for a per-unit void, **the voided units' share of every draw**: `share = draw.quantity × voided units ÷ line units` (an exact integer: a piece line's draw is `units × quantity_per_sale_unit`, 01c §3.5.2; a g / ml line has 1 unit, so its void is whole). A share leaves the line's remaining units **from stock**: the fold lowers `draws[].quantity` and `draws[].reserved` by the share and the line's `units` by the voided units, and keeps `from_stock`, `cook_ms`, the program and `reserved_seq`. Only when **the last reserved unit leaves the line** (every `draws[].reserved` = 0 by release) does the fold set `from_stock = false`, `cook_ms = full_cook_ms`, the fresh program and `reserved_seq = null`.

  | Cause (writer) | Lines released | Batch order |
  |---|---|---|
  | `ItemRemoved` (02), `ItemVoided` (04, per voided unit), `ItemMovedToStock` (04) | the line itself, at any stage before its Start; *v0.6.2 (G4-3 #2):* a partial `ItemVoided` releases only the voided units' share of each draw | the cause, then its releases (the cause's fold re-plans) |
  | `StockSet` with `on_hand < reserved` (01a; S14 v0.6) | **hidden** lines only, newest `reserved_seq` first, as whole lines, until `reserved ≤ on_hand` or no hidden reserved line is left | the releases, then the `StockSet` (its fold re-plans) |
  | `BusinessDayClosed` (01a's `CloseBusinessDay` now, 05's day close later, §4.3 To 05) | **hidden** lines of orders kept over the close (§3.3), plus every line of an order already out of the engine that still holds a reservation | the releases, then `BusinessDayClosed` (its fold re-plans) |
  | abandon (the `fires` tick, §3.6.1) | every line of an abandoned order that still holds a reservation | tick intents |

  **A recount or a close never releases a frozen or fired line.** A frozen line is on the chef's Next list with its stock cook (D17, G4-1 #14), and a fired line's portion is being taken from the pot. Both consume at Start. So `on_hand < reserved` after a `StockSet` is allowed **only by the units reserved for frozen or fired lines**. *Changed in v0.6.2 (G4-3 #3):* any other excess is an invariant breach: the fold **does not throw**; it reports the breach (below) and folds the count as given.

  The `StockReleased` fold changes stock bookkeeping only: `reserved −= quantity`, and on the line the draw's `reserved −= quantity`; when that leaves no reserved unit on the line, `from_stock = false` and `cook_ms = full_cook_ms`, and for a batch line `program_id` also goes back to its `ItemAdded.program_id` copy (D25, D49; how the fresh program is kept is BF-1). A whole release of a batch line happens only to a hidden line, which is never in a frozen or fired load; a partial void keeps the line's program, so a frozen program-Q load never gains a program-P line (v0.6.2, G4-3 #2 (c)). The fold never re-plans (§3.5.3 triggers). `stockEffects` for every cause is tested by tests 40, 88, 109 and 111.
- *Changed in v0.4 (G2 #21); Changed in v0.6 (G4-2 #10, #12):* **no `unit_changed` release.** A stock unit change takes effect at the next day open (01a S44). A close releases hidden lines only, so at an open `reserved` may still hold the units of **frozen or fired lines of orders kept over the close**. **Q14 closed (v0.6):** when a `StockSet` changes the entry's `unit` while `reserved > 0`, `stockEffects(StockSet)` adds one `StockConsumed` per held reservation, appended **before** the `StockSet`; the plates on Next or on the fire are counted as taken. *Changed in v0.6.2 (G4-3 #2 (ii)):* "per held reservation" means **every draw of each line that holds a reservation on the changing item, on every stock item** (as a release does), so a multi-draw line never keeps a reservation on another item that its Start would no longer consume (test 118). The entry therefore enters the new unit with `reserved = 0`, and no old-unit quantity is ever subtracted from a new-unit count (test 42). 01a's carried row "re-plan reservations of an item whose unit changed at a day open" is answered by this rule (§12.4).
- **Move to stock (Changed in v0.2, pre-G2 #13):** `ItemMovedToStock { order_item_id, units }` puts the cooked portion into ready stock: `stockEffects` returns `StockReleased { reason: 'moved' }` for the line's reservation (if any) and `StockAdded { stock_item_id, quantity, unit, reason: 'moved' }` for each of the line's draws (`quantity` = draw quantity × units ÷ line units); a line with no draw adds nothing. *Changed in v0.5 (G4-1 #13):* `stockEffects(state, ItemMovedToStock, stock_ctx)` requires `stock_ctx` (as for `StockAdded`, §6.1f) and **folds its own drafts in order** (the release, then each `StockAdded`) before it computes the waiting-line reserve of §3.7 "`StockAdded`", so the portion it adds is visible to that reserve; its result is release + adds + `StockReserved` drafts, appended in that order. `StockAdded` gains the optional `reason` (additive, §4.5 A-19). Explicit events keep the clients' stock part right (01a §4.4 clients fold stock frames with `applyEvent`).
- **Consume (P-5):** a from-stock line's units leave `on_hand` and `reserved` at **`ItemStarted`** (the portion is taken from the pot): `StockConsumed { stock_item_id, order_item_id, quantity }` appended with the start (03b's `StartItem`, the tick's inferred start), one per draw with `reserved > 0`, `quantity` = that draw's `reserved` (*v0.6.2, G4-3 #2*). This is 01a's "hand-over step". *Changed in v0.6.2 (G4-3 #3):* the fold sets `on_hand = max(0, on_hand − quantity)`, `reserved = max(0, reserved − quantity)` and the draw's `reserved` to 0 (then `reserved_seq = null` when no draw holds any; `from_stock` stays true: the plate was taken from the pot). A clamp is a breach report (below): after a recount below reserved (allowed above), the pot was already known to be short, so the Start commits and the chef cooks. *Changed in v0.5 (G4-1 #6):* `StockConsumed` is drafted only for a **live** reservation (`reserved_seq ≠ null`). *Changed in v0.5.1:* a fired from-stock line carried over a day close keeps its reservation (above), so its start consumes normally; the guard covers a line whose reservation was released before its Start, or consumed by a unit-changing `StockSet` (Q14, v0.6).
  > ⚠️ **Changed in v1.0.1 (AD-29 Q7, developer ruling; AD-30 Q7, proposed (not yet ruled)):** a from-stock line that reaches **Done (or Served) with no Start** consumes there: `stockEffects` of the `ItemDone` / `ItemServed` draft gives its `StockConsumed`. Readings: an Undo after a consume at Done does not reverse it; at Served, "no Start" means `started_at` null at any open stage; a Done or Served on an AD-20 kept line still consumes. 03b's `DoneItem` and 02's `MarkServed` append these drafts (carried To 03b, To 02). Was: consume at `ItemStarted` only, so such a line kept its units reserved up to `order_abandon_ms`.
- **`StockAdded` (Changed in v0.4, G2 #7; Changed in v0.6, G4-2 #4; Changed in v0.6.1, restored):** adds to `on_hand` (S45), then **reserves the new stock for waiting lines and re-plans them** (01a carried row "`StockAdded` triggers D23", foundation D23 "stock update", F-19).
  - **Who writes the reservations:** the `StockAdded` handler (01a's `AddPrecookedStock` on the hub; 04's move to stock through `stockEffects`). In the same transaction, after the `StockAdded`, it appends the `StockReserved` drafts that `stockEffects(state, StockAdded, stock_ctx)` builds with `reserveStock`.
  - **Candidates:** that stock item's **hidden full-cook** lines (`from_stock = false`, a draw on that item in `draws` and a stock cook time `stock_cook_ms`, §3.3). *Changed in v0.6.2 (G4-3 #4; restores G4-1 #14):* these are **hidden slot** lines (`fire_ms > now + freeze_ms`), and **batch** lines in a hidden load (its load is re-formed by the re-plan, G4-1 #10). A **frozen** line is never a candidate: it is on the chef's Next list with its fresh cook, and the re-plan keeps its `fire_ms`, so a switch would land it early and cold. Fired, COOKING and return lines are never candidates (a return line has no draw).
  - **Order and reach:** candidates are taken in **deadline order** (`deadline_ms`, then `order_item_id`), each through the same rule as submit (`reserveStock`: the line is taken only when **every** one of its draws passes `canServeFromStock` after the units already claimed in this command, 01c §3.5.2). They are taken as far as the added stock reaches; a line that does not fit is skipped and the next is tried.
  - **The fold:** `applyEvent(StockReserved)` adds the quantity to `reserved` and sets the line's `reserved_seq`. When the fold **flips the line's `from_stock` from false to true**, it also switches the line to its stock cook time (`cook_ms = stock_cook_ms`) and, on a batch line, to its copied `stock_program_id` (D25, D49: the re-plan places it in a load of that program), and re-plans the line's station (§3.5.3). The line may now fire later and still land on its `T`. A fold that flips nothing (a submit's own reservation, whose line `OrderPlaced` already marked `from_stock = true`) re-plans nothing.

  Test 87.
- `on_hand ≥ 0` and `reserved ≥ 0` always. *Changed in v0.6.2 (G4-3 #3):* **no stock fold ever throws.** A fold that would take `on_hand` or `reserved` (or a draw's `reserved`) below 0 clamps it at 0; a `StockSet` excess not held by frozen or fired lines is folded as counted; a `StockAdded` whose `unit` differs from the entry's leaves the entry unchanged (01a S14 changed, §4.5 A-20). Each case is an **invariant breach**: `applyEvent(state, event, report?)` calls the optional `report({ event_id, stock_item_id, on_hand, reserved })` with the values **before** the fold, and the result never depends on `report`, so the fold stays pure and live = replay. The host passes a reporter that logs it at `warn` (§7.2). A stock breach therefore never fails 03b's Start, the `fires` tick (a `single_tap` station's inferred starts) or a recount; tests catch real bugs by asserting that a fixture logs no breach (test 119).
  > ⚠️ **Changed in v1.0.1 (AD-6, developer ruling):** "no stock fold ever throws" holds in the hub, which runs **non-strict**: the value clamps at 0 and the breach is appended to `state.diagnostics`, which the host logs at `warn` after commit and clears; boot replay never throws on these. Tests run **strict** (`applyEvent(state, event, { strict: true })`, the default): a stock breach or a profile underflow throws, so a bookkeeping bug fails loudly. `opts` replaces `report?`; the result never depends on the mode except that strict throws. Was: "`applyEvent(state, event, report?)` calls the optional `report(…)`".
- Stock stays branch-level; zone stock is 02's (03a-g0 §2).

### 3.8 Slip warning and split send (D11, D12, §3 #7, F §4.7 D44)

- **Estimated land time** per sync group: F §4.7 formulas (*Changed in v0.6 (G4-2 #21):* each includes `carry_ms`, because `T` is the land time at the point. COOKING: `started + prep + cook + carry`; ADDED past its fire: `s + prep + cook + carry`, with `s` its **packed Start** (§3.3; *Changed in v0.6.3 (targeted check N-1):* prep is added as for a COOKING line, because `s` is the Start, not the station start. With no line ahead, `s` = `now` and this is F §4.7's `now + prep + cook + carry`. v0.6.2's `s + cook + carry` with `s ≥ max(fire + prep, now)` left out prep and could come late by up to prep. *v0.6.2, G4-3 #1:* never `now + prep` alone, which ignored the fired lines ahead of it); on schedule: the planned land at the point. After a boost or a capacity change that re-placed the line, it is the **new** planned land, so a displaced line slips on the next pass once it is past the threshold; v0.5, G4-1 #4, #5; v0.6, G4-2 #14). The group's estimate is its maximum.
- **Trigger:** `estimate > T + slip_threshold_ms` (D11: from the engine target, so the order taker hears before the padded promise is blown; the card shows minutes against the **promise**). `slip_threshold_ms` is configuration (default in §4.5 A-12; *Changed in v0.3*). *Changed in v0.6 (G4-2 #14):* the default `slip_threshold_ms` of 120 000 is below the default padding of 180 000, so with the defaults the order taker hears before the promise is blown (D11).
  > ⚠️ **Changed in v1.0.1 (AD-3 / BF-10, developer ruling):** the claim "the order taker hears before the promise is blown" holds **on Waada Guard stations with the branch padding** only. EDF and FIFO stations use padding 0 (D3), so there the slip is raised after `P` (`[03a BF-10]` test). Spec wording only; the trigger is unchanged. Was: the claim stated for every station.
  >
  > ⚠️ **Changed in v1.0.1 (AD-37 (3), owner ruling 2026-11-08):** the card's minutes are measured against the **engine target**, not the promise: **`minutes_late = max(0, ceil((predicted arrival − engine target) / 60 000))`**, from the engine's current plan (the slip item's `estimate` and `target`). The card reads **"≈ N min late"** (en and ur). With the defaults (threshold 120 000 below padding 180 000) the card can say 0 or a small number at the raise; that is the owner's choice. Was: "the card shows minutes against the **promise**".
- **One per table (§3 #7):** the orders of one table key are grouped in one `SlipWarned { table_key, order_ids, alert_id, estimated_land_ms, target_land_ms, promise_ms }` and one alert, dedupe key `slip:<table_key>`, both written by **`fires_alerts`** in one transaction. *Changed in v0.4 (G2 #4):* `SlipWarned` carries `alert_id` again — the tick calls `raiseMany` first and builds each `SlipWarned` from the `alert_id` it returns, so the engine can match the alert's `AlertClosed` (v0.2's join through `AlertRaised.values.table_key` stays valid for readers). **Re-raise (F §4.7 D44):** only when the estimate has grown by another `slip_threshold_ms` since `slips[key].last_estimate` **and** `slips[key].alert_id = null` (the previous alert closed). Both are state, so no read decides it (01d dedupe still refuses a second open one).
- **Slip state (Changed in v0.4, G2 #4):** `applyEvent(SlipWarned)` sets `slips[key] = { order_ids, last_estimate: estimated_land_ms, alert_id, resolved_at: null }`. `applyEvent(AlertClosed)` (order stream, §3.12) whose `alert_id` equals some `slips[key].alert_id` sets it to `null`; any other `AlertClosed` returns `state` itself. When every group of the key is resolved (every line `done` or later, or exited) the resolving fold sets `resolved_at = recorded_at` if `alert_id ≠ null`, else drops `slips[key]`; the fold of that alert's `AlertClosed` then drops it. *Changed in v0.5 (G4-1 #17):* an `ItemDoneUndone` that makes a resolved key unresolved again **clears `resolved_at`** (the alert stays open; no close `done` follows for a plate back on the fire); if the alert was already closed, `slips[key]` was dropped and the normal crossing rule raises again. An unresolved slip whose alert is closed by someone else (02's `ReleaseItems` closes it `done`) keeps `slips[key]` with `alert_id = null`, so its `last_estimate` still gates the next raise.
  > ⚠️ **Changed in v1.0.1:**
  > - **`AlertClosed` on the order stream only** (AD-31, **proposed (not yet ruled)**): `applyEvent(AlertClosed)` acts only when `stream_type = 'order'`. Replay reads `AlertClosed` only on the order stream (§3.12), and a `slip_warning` alert's subject is the order stream, where 01d writes its close. Folding a close on another stream live ran the §3.3 removal step at an event replay never reads. Was: "`applyEvent(AlertClosed)` (order stream, §3.12) whose `alert_id` equals …", which the code first folded on every stream.
  > - **An answered slip closes its key for that seating** (AD-37 (2), owner ruling 2026-11-08, no change now): 01d closes an answered request through `RequestAnswered`, which the engine does not fold, so after a "Send what's ready" or "Wait" the key keeps `alert_id ≠ null` and §3.8's re-raise does not fire again for that key. Within one seating one answer is enough. 02p Q-2 keys `dine_in` by `seating_id`, so a **new party at the same table is a new key** and gets fresh slips (02p U-7 test; open item 11). Until 02p lands, a `dine_in` key is `dine_in:<table_id>`, so the silence lasts for the rest of the day. The code and test 72 follow this text.
  > - **Slip readings** (AD-21, accepted): R1 an estimate already over the level counts from the order's `placed_at` (replaces "the fold's `recorded_at`"), so a per-key recompute equals a full recompute. R2 crossing = `level − prep − cook − carry + 1`. R3 only sync groups slip. R4 a slip resolves on its **own `order_ids`** (replaces "every group of the key"). R5 BF-4's due = the latest AD-13 exit. R6 the promise in the slip item = the group's `T` + the order's padding. R7 overload lists every station; `capped` is read on unfired lines; pressure floored in bp. R8 touched keys by input / output comparison.
- **`next_alert_due_at` (Changed in v0.4, G2 #4; pure, like `nextDueAt`):** *Changed in v0.5 (G4-1 #15):* kept **per key** in `slip_due[key]` and recomputed **only by folds that touch `slips` or a group** (a `SlipWarned`, a slip's `AlertClosed`, a fold that changes a group's `T`, its line set, a stage, or a planned land of one of its lines — re-plans included), and only for the table keys of the orders that fold touched; `next_alert_due_at = min(slip_due)` (*v0.6, G4-2 #20:* O(lines of the touched keys) per fold, plus O(open keys) for the minimum, so a full-day replay adds no per-event scan of open lines; an `EngineConfigApplied` that changes `slip_threshold_ms` recomputes every key). Each `slip_due[key]` is the earliest of: (a) `resolved_at` for a resolved slip with `alert_id ≠ null` (close it `done`); (b) for an unresolved key with `alert_id = null`, the **crossing time** — the earliest `t` at which the key's estimate exceeds its level, `level = slips[key] ? last_estimate + slip_threshold_ms : T + slip_threshold_ms` (per group): per unstarted line `t = level − prep − cook` (its estimate is `max(planned land, t + prep + cook)`, non-decreasing in `t`), or the fold's `recorded_at` when its planned land already exceeds the level; a COOKING or done line contributes only when its fixed land already exceeds the level; `null` when no key has (a) or (b). A key with `alert_id ≠ null` and no resolution contributes nothing. `getAlertIntents` and `next_alert_due_at` use the same `slipCrossing` function, so whenever `next_alert_due_at` is finite, `getAlertIntents(state, next_alert_due_at)` has a slip item (property test 92).
- **The `slip_warning` kind** (03a registers, 01d §3.5): `family: 'action'`, `subject: 'order'` (the oldest order of the group), `request: { answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: 'never', apply }` with labels "Send what's ready" / "Wait" (01d: accept kinds use the kind's labels); no requester (tick-raised: `raised_device_id = 'hub'`, no in-person answer, no withdraw, no `request_result`, 01d AD-72); `receiver_staff_id` (*Changed in v0.5, G4-1 #8*) = for a **`dine_in`** order, the table's owner from 02's `tableOwners` (§4.1; until 02 lands: the order's `placed_by`); for a **`takeaway`, `delivery` or `parking`** order, the order's **`placed_by`** (also after 02 lands — these orders have no table); a group mixing types uses its oldest order's rule; *v0.6 (G4-2 #17):* a `dine_in` table for which `tableOwners` returns no owner falls back to the order's `placed_by`; `placed_by = null` → the defensive skip below, target `{ kind: 'person', staff_id: receiver }`. Steps: 0 → `[{ raised_target, answerer }]`; 1 (`escalation: true`, at `values.escalate_ms` = `slip_escalate_ms`) → `[{ raised_target, answerer }, { managers, informed }]` (E4-SLIP AC3). `closes_on: 'owner'`, `lead_fallback: false`, `expires_at_day_close: true`, `values_schema { table_key, order_ids, escalate_ms }`, `details_schema { minutes_late, lines: [{ name, quantity, state }] }` (01d §3.12).
  > ⚠️ **Changed by 01d v1.1.2 (AD-36):** `minutes_late` and `lines` are now in 01d §3.12 `AlertDetailsBase` (01d row D-1: optional `minutes_late: int ≥ 0`, optional `lines: [{ name, quantity ≥ 1, state }]`); `slip_warning` picks and requires both. `AlertRaised` is **v2** (01d row D-2), with an identity upcaster from v1 and one fixture per version (foundation §4.1 D46, §6.7). `details` stay on the signed-in card only, never in lock text, alert-mode or device frames, or logs (01d §7). Was: these fields were not in 01d's base, so the v1 payload stripped them and the strict card refused them.
  >
  > ⚠️ **Changed in v1.0.1 (AD-37 (4), (5), proposed (not yet ruled)):** `lines` = the slip orders' sync lines in `added`, `cooking` or `done`; `state` = the engine stage; `quantity` = `EngineLine.units`; `name` from the line-facts read (§6.2a), and an empty `ItemAdded.name` falls back to the `order_item_id`. Details that fail the schema are skipped and logged `details_invalid` (defensive; unreachable after the task 23 fix). `minutes_late` per AD-37 (3) above.
- **`apply` on accept** (read-only, 01d §3.5): returns one `ItemsReleased { order_id, alert_id, released, expedite }` per order of the group with work: `released` = the group's `done` sync lines (go now, no hold); `expedite` = remaining lines **pre-ticked** by "goes with" links of what is released (D12; none configured → none). `decline` returns `[]`. Ticks are edited only from 02's table view (`ReleaseItems`, which uses `planRelease`, §6.1, and closes the alert), because `AnswerRequest` carries no ticks (**P-6**).
  > ⚠️ **Changed in v1.0.1 (AD-22, accepted; AD-37 (6), proposed (not yet ruled)):** `planRelease` pre-ticks nothing. **The caller** (the `slip_warning` `apply` here, 02's `ReleaseItems`) computes the D12 goes-with pre-ticks from the snapshot V3 `goes_with[]` and `ItemAdded.item_id` / `category_id`, and passes them as `ticks.expedite`; goes-with is not in `EngineConfigApplied` (§3.11). So the `apply` makes **1 read** (the slip orders' `ItemAdded` rows: `item_id`, `category_id`) when goes-with links exist and the slip has both a released and an open line, **else 0**. Released and candidate lines are taken across every order of the slip. `goesWith`: the most specific row wins (item over category, then target item over category); an exclude wins a tie. Was: "`apply` (read-only) … `expedite` = remaining lines pre-ticked", with no read stated (§6.4 said 0 statements).
- **`applyEvent(ItemsReleased)`:** released lines leave their group; expedite lines become immediate (`mark: 'expedite'`, weight = `follow_up` weight, D12); unticked lines stay sync with each other at their old `T`; re-plan.
  > ⚠️ **Changed in v1.0.1 (AD-22, accepted):** only open sync lines take part; a line in both lists counts as released. Each leaving line becomes immediate in its own group `order_id:<next_group_index>`; an emptied group is removed; the order's `T` / `P` stay; a released line's new group keeps the source `T`. An expedite line is placed by one pass 1 with the expedite lines held at their old bookings, then moved to its earliest fit **only if that lands earlier** (never later). Queued deadlines of a changed group are recomputed at its old `T`. Was: unstated.
- **Closing (Changed in v0.2, pre-G2 #1, #11; Changed in v0.4, G2 #4):** `fires_alerts` closes a resolved slip's alert `done` (`alerts.closeMany` with `slips[key].alert_id` from the state; test 93), and closes **every** open `slip_warning` `obsolete` (note `day_closed`, ids from `listOpen`) in its first pass after `BusinessDayClosed`, because 01d's day-close expiry skips requests (`projections/alerts.ts:350-351`). *Changed in v0.6 (G4-2 #19):* in that pass `closeMany` runs **before** `raiseMany` (§6.2a step 5). A fresh slip for an order carried over the close is therefore a new alert, not a dedupe onto the alert being closed. A `raiseMany` result with `deduped: true` writes no `SlipWarned`. *v0.5 (G4-1 #6):* an order carried over the close (§3.3) whose group is still late has no `slips` entry after the close, so the normal crossing rule raises a fresh slip for it in a later pass — the warning is true, the plate is still late. Close of a closed alert is a no-op (01d). `slips[key]` is dropped at its `AlertClosed` (resolved), at resolution when no alert is open, and at `BusinessDayClosed`.
- **Defensive inputs (v0.2, pre-G2 #1):** an input whose receiver cannot be resolved (no table owner and no `placed_by`, receiver not in the hub directory) or whose values fail the kind's schema is skipped and logged once per key `{ tick: 'fires_alerts', kind, table_key, reason }`, never passed to `raiseMany`, and no `SlipWarned` is written for it; the order taker can still open the Send card from the table view (D11). *v0.4 (G2 #4):* a skipped key would stay due, so the host keeps a `skipped` set of table keys; while it is non-empty, `due` uses `nextAlertDueAt(state, skipped)` (the same minimum without those keys, pure, in memory) instead of the field. A key leaves `skipped` at the next commit that touches one of its orders, or at a restart, and is tried again (no transaction every pass for a key that cannot be raised).
  > ⚠️ **Changed in v1.0.1 (AD-33 (22a), accepted):** a slip key that `raiseMany` answers `deduped`, and a resolved key with no open alert, also join `skipped`; an unregistered kind is logged and skipped, never thrown. Known cost (M2): the tick's own event on a skipped key gives one extra retry and a second log line. Was: only an unresolvable receiver or failing values joined `skipped`.
- Permission: none beyond being the named receiver (01d `named`); 02's table-view path uses the table's `mark-served` holder (D11).

### 3.8a Return to kitchen (D28; owner 2026-11-03)

A Served line may be sent back with **one of two choices**: `fix` (taste: "more spicy", "not cooked enough" — the same plate goes back) or `remake` (a kitchen fault — a new plate, on the house). Both are free in the pilot; no reason list and no charge config (added only if an owner asks, R18). The one rule that matters to the engine: **a return is a ticket.** A plate fixed off-ticket is invisible, holds a slot the engine does not know about, and makes every other ETA on that station wrong — the chef's own objection.

- 02's `ReturnToKitchen { order_item_id, mode }` (permission **`mark-item-returned`**, foundation §4.2; default Owner, Manager, Order taker; §4.5 F-13, B-5; *Changed in v0.2, pre-G2 #15*; an order no longer in the engine → `409 ORDER_NOT_IN_ENGINE`, §3.3, pre-G2 #2) appends an `OrderLinesAdded` with **one new line** that copies the served line's D25 fields and sets `return_of: { order_item_id, mode }`, plus `ItemReturned` when `mode = 'remake'` (*Changed in v0.5, G4-1 #23:* **02 writes `ItemReturned` itself** from the schema in §4.2, owned by 03a's event folder; no 04 helper; 04 reads it for the bill and wastage, §4.3 To 04). *Changed in v0.5 (G4-1 #11):* the return line's `ItemAdded` copies the served line's D25 fields **except money**: `price_minor = 0`, `line_total_minor = 0`, `tax_class_id = null`, every option `charge_minor = 0` (and `extra_price_minor`, `allocated_price_minor` 0 or null as their kind allows), so a return is never billed (§4.3 To 05); the served line stays billed on `fix` and is freed by 04 on `remake`. 03a does no money arithmetic. *Changed in v0.6 (G4-2 #18):* the return line is a plain line: `line_kind: 'item'`; `parent_order_item_id`, `deal_id`, `deal_part_id`, `option_id` and `option_quantity` all null; `options: []`. It never joins a deal, a parent line or 04's per-unit void rules. It copies the served line's `quantity`: a return is of the **whole line** (§12.3 G4-2 #18). *Changed in v0.5 (G4-1 #7):* on an order with `isOrderInEngine = false` the command is refused `409 ORDER_NOT_IN_ENGINE` and 02's screen says the order is closed (no other reading). *Changed in v0.5 (G4-1 #19):* a return on a served line that already has a return line not yet `served` (any line with `return_of.order_item_id` = it) is refused `409 RETURN_ALREADY_OPEN` (§9), so two taps never cook two tickets. The engine folds the new line as any line: `serve_mode: 'immediate'`, `mark: 'return'`, weight = the `follow_up` weight (D7, D12), `from_stock: false`, **no stock draw** (no `StockReserved`), station = the served line's station (alternates allowed, D8).
- **`fix`:** the line's `cook_ms` = the item's `adjust_time_ms` (01a v2.1 A-11; config), **copied by 02 into the `OrderLinesAdded` line** (D25); `applyEvent` takes it from the event, never from config (*Changed in v0.2, pre-G2 #5*). The served line is unchanged (bill, stage). **`remake`:** `cook_ms` = the line's normal cook time; the served line goes `returned` (exit as `voided` for the engine, §3.3) when `ItemReturned` is folded.
- **Placement:** expedite = `earliestFit` within other lines' slack and `min_slack_keep_ms`, never past their deadlines (D4). With `branch_engine_settings.returns_boost = true` the new line is placed as a boost (§3.9) instead and may push others. *Changed in v0.5 (G4-1 #18):* the boost applies to **the return line only** — its `mark` stays `'return'`, `order.boosted` and the order's other lines and `T` are untouched; the `boost-order` permission does not apply (a return needs only `mark-item-returned`; owner Q15a accepted that an Order taker's return jumps the queue, §12.3). *Changed in v0.3 (owner, Q15a: a returned plate never queues):* the default is **true** (§4.5 A-12); the setting stays.
  > ⚠️ **Changed in v1.0.1 (AD-29 Q11 P8, developer ruling; AD-30 P8, proposed (not yet ruled)):** a return line **never queues, on every policy**, FIFO included (task 18d): FIFO alternates are offered to a boosted return. Reading for the owner: with `returns_boost = false` (the owner's explicit setting) a return can wait on every policy, **developer to confirm**. Was: a return on a FIFO station was an ordinary immediate line (AD-23 P8).
- **Chef screen:** the line shows at the top of Now / Next with a red RETURN marker, the mode and the old ticket's reference (`return_of.order_item_id`), D17; Start / Done as usual (D18), so the slot it uses is in the profile.
- **Served, readiness, alerts:** the new line is its own group (immediate); 03b's Ready to serve and the waiter alert follow as for any line; it never re-opens the old group's slip.
- Replay: nothing new — `OrderLinesAdded` and `ItemReturned` are already on the `order` stream list (§3.12).

### 3.9 Boost (D4; F §4.7 "Boost")

`OrderBoosted { order_id }` (02 writes, permission `boost-order`): *Changed in v0.5 (G4-1 #4):* the order's hidden and frozen lines are re-placed first at `earliestFit(t)` (as one group: new `T_b` = the hold-and-fire loop against the **fixed** lines — fired and COOKING lines with their live intervals, §3.3 — marked `boost`); then **every other unfired line of the station, frozen ones included** (the D15 exception, §3.4), is re-placed by pass 1 (*v0.6, G4-2 #16:* frozen lines first, each at `earliestFit(its current fire_ms)`, so it moves only later and only as far as the boost forces it; one whose `fire_ms` changed gets `mark: 'moved'`). Lines pushed past their deadline, frozen ones included (*v0.6, G4-2 #15*), go through §3.5.6. **Every displaced order whose estimate passes `T + slip_threshold_ms` gets a slip on the next `fires_alerts` pass** (its estimate is its new planned land, §3.8; *v0.6, G4-2 #14*). No booking ever exceeds capacity (test 97). The boosted order's promise stays; its `T` becomes `T_b`. Boost is the only rule that may push another order past its target (D4). Who may boost is the `boost-order` permission (defaults in §4.5 B-7; *Changed in v0.3*).

> ⚠️ **Changed in v1.0.1 (AD-23, accepted; AD-29 Q11, developer ruling; AD-30 B3, proposed (not yet ruled)):** B1 the order's sync lines across its groups get one hold-and-fire; its immediate lines their own earliest fit. B2 fired, COOKING and FIFO siblings floor `T_b`. **B3 a boost keeps the pickup floor** (task 18d; was: no pickup floor, so a boosted delivery could land long before pickup); reading: an immediate line of a boosted pickup order keeps its earliest fit, as at submit. B4 a boost leaves FIFO lines in place. B5 boosted batch lines join only boosted loads. B6 when nothing is movable, the fold only sets `boosted`. Marks: `moved` / `boost` overwrite every mark except `return`, and **P9 a moved or boosted expedite line keeps its follow-up weight** (task 18d). Was: these cases unstated.

### 3.10 Capacity, lanes, pause, pressure (D19–D21, D37, §3 #5)

- **Live capacity (D37):** `SetStationCapacity` (§6.6; v0.2, pre-G2 #35) sets `capacity_override`; the station re-plans (§3.5.3). *Changed in v0.5 (G4-1 #5):* **frozen lines are re-placed with the hidden ones** (the D15 exception, as for a boost; fired and COOKING lines stay fixed; moved frozen lines get `mark: 'moved'`), so after a lane Off no frozen line is booked over the new capacity, and every displaced order whose estimate passes `T + slip_threshold_ms` gets a slip on the next `fires_alerts` pass (test 100; v0.6, G4-2 #14). The same holds for a lane On and for an `EngineConfigApplied` that changes `capacity` (§3.11). *Changed in v0.5 (G4-1 #20):* a station session's `capacity_override` must be `≤ capacity` (the configured value; `400 VALIDATION_FAILED` otherwise, §6.6); a staff session with `manage-stations` may set up to 100 (an extra cook on a busy night). `capacity_override` and `paused` are **cleared by the `BusinessDayOpened` fold** (a new day starts at the configured capacity, unpaused; deterministic, no event), so a lane left Off at night does not halve the next lunch. *Changed in v0.6 (G4-2 #13):* when the reset changes a station's effective capacity, the `BusinessDayOpened` fold re-plans that station as a capacity change (frozen lines re-placed, the D15 exception, §3.4). A night override of 40 that is reset to 30 mid-service therefore never leaves 40 units booked.
  > ⚠️ **Changed in v1.0.1 (AD-23 P1–P7, accepted):** P1 a line is late when its fire changed and is past its deadline. P2 an overdue frozen line stays if it fits, else restarts from `t`. P3 FIFO lines are pushed later on a capacity change only as needed. P4 an over-size frozen load stays whole, in AD-4 rounds. P5 a pushed frozen line keeps its deadline, `T` and promise. P7 capacity events re-plan even when the effective capacity is unchanged. The command that writes `StationCapacitySet` re-plans twice (§6.6, AD-34 (4)).
- **Lanes (§3 #5, K7/K8; Changed in v0.3, owner A2: computed from config):** a lane Off / On (03b, from the assembler or lane tablet) calls `SetStationCapacity` with `capacityForLanes(station, lanes_on, lane_count) = max(1, min(capacity, lanes_on × lane_units))`, where `lane_units` = the station's configured value, or, when it is null, `max(1, floor(capacity ÷ lane_count))` (*v0.5, G4-1 #20:* never 0). Integers only. *Changed in v0.4 (G2 #1):* **`lane_count` is an input** (an integer ≥ 1) passed by the caller; 03a never reads devices. A **lane** is a `kds` device with `station_id` and a non-null `lane_label` (00 row H-6, 01d D4), and `lane_count` = the number of such devices of the station that are not revoked, else 1; 03b's lane Off / On counts them from 00's device directory. Pairing a lane device, naming its lane and binding a tablet to a point are 03b's and 01e's (§4.3).
- **Pause (D21):** a station with `pause_enabled` (01a v2.1, default false) may be paused live by `SetStationPause`; while paused new orders for it are refused `409 STATION_PAUSED`; open lines continue. `pause_enabled = false` → `409 STATION_PAUSE_DISABLED` (§12.3 Q10 reading).
- **Pressure (D20):** `pressure(S, now)` = booked unit-ms in `[now, now + pressure_window_ms)` ÷ (effective capacity × window), in basis points; green < `pressure_amber_bp` ≤ amber ≤ `pressure_red_bp` < red. Computed from the profile, never stored, so 07 can recompute it from the log (roadmap S4).
- **`station_overload` kind** (`info`, subject `station` / station_id, dedupe `station_overload:<station_id>`, step 0 → `managers` recipient, `closes_on: 'owner'`, `lead_fallback: false`, `expires_at_day_close: true`, `values { station_id, pressure_bp, waiting }`, card "{station} {pressure} % · {waiting} orders waiting" (v0.3)): raised by **`fires_alerts`** (v0.2, pre-G2 #1) when a station has been red for `pressure_alert_ms` (host memory `red_since`, reset on restart — accepted, P-7) or when a line reaches its `max_late_ms` cap (§3.5.6); closed `done` when the station is below amber at a check. Nothing stops a station by itself (D19). *Changed in v0.4 (G2 #4):* the **overload check** runs in `fires_alerts.due`, in memory, no statement: per station it computes `stationPressure(state, s, now)` and the capped flag (pure), updates `red_since`, and is due only for a **change** against the host set `overload_open` (station ids with an open `station_overload`): a station red ≥ `pressure_alert_ms` or capped and not in the set (raise), or in the set and below amber (close `done`). `overload_open` is refreshed from the `listOpen` read of every pass with work, and the first pass after boot is forced due (`reconcile` flag) so a restart rebuilds it; a raised overload that persists is therefore never due again.
  > ⚠️ **Changed in v1.0.1 (AD-33 (4), accepted):** **a station that is capped is not closed when it is below amber**; its `station_overload` stays open while a line is held at its cap. Read literally, "closed `done` when below amber" and "capped and not open → raise" would close and re-raise it on every pass, against "never due again" (§6.2a). It closes when it is below amber **and** no longer capped. Two more readings: an open overload of a station deleted from the config closes `done` (it has no thresholds left), even if it may still be red; a station in `overload_skipped` is retried only after a restart (M4). Was: "closed `done` when the station is below amber at a check".

### 3.11 Config reaction (`onBranchConfigApplied`, 01a carried row)

The hook computes `E(next)` = **exactly the `EngineConfigAppliedV1` fields below**, built from the snapshot (*Changed in v0.4, G2 #24:* the list is the payload, so `name`, `point_id`, `freshness_window_ms` and `reference_cook_ms` are included) and, when `canonicalJson(E(next)) ≠ canonicalJson(state.config)`, appends one `EngineConfigApplied` in the same transaction. Every station is in the log, so replay never reads config (**P-8**). Effects in `applyEvent`:

| Change | Effect |
|---|---|
| `capacity` | re-plan the station (D37); *v0.5 (G4-1 #5):* frozen lines re-placed too (D15 exception, §3.10) |
| `station_type` (01a allows it only with no routes) | open lines keep their placement as fixed input; new lines follow the new type |
| program `cook_time_ms`, item knobs, padding | new orders only (open lines keep their D25 copies) |
| item `stock_time_ms` (*v0.4, G2 #7*; *Changed in v0.6.1*) | new orders only; a `StockAdded` reservation (§3.7) switches an open line to its **copied** `stock_cook_ms` (and a batch line to its copied `stock_program_id`), never to the config value. The `StockAdded` reserve-and-re-plan itself is a stock trigger (foundation D23, §3.5.3), not a config effect |
| station archived | open lines complete normally (01a S22, 03b warns); no new lines can route there |
| policy, freeze, keep, pressure fields, alternates, carry | from the next re-plan / tick. *⚠️ Changed in v1.0.1 (AD-25, accepted):* the route fields (`alternates`, `carry_ms`) of **hidden** lines are written in the config fold from `state.config` (`reachHiddenRoutes`); FIFO lines keep their copies; a hidden line on a removed alternate stays until a re-plan moves it; a line frozen at the config keeps its old route copies (it could route back onto a removed alternate later; rare, not closed). §2 #5 is reconciled in place. Was: "from the next re-plan / tick" only |

The hook accepts every valid config and never throws on data (S43); a new station appears with an empty profile.

> ⚠️ **Changed in v1.0.1:**
> - **Every forward config apply writes one `EngineConfigApplied`** (AD-35 24-1, accepted by the developer, 2026-11-07): `config_version` is one of the `EngineConfigAppliedV1` fields, so it is inside E() and the comparison, and a price-only apply also writes one. Its fold **re-plans nothing and frames nothing** (reviewed). Excluding the version would make boot step 6 see "stale" after every price change. Test 70's "only when the engine part changed" reads "only when E() changed, `config_version` included" (§10.2).
> - **`reference_cook_ms`** (24-2, accepted): the snapshot's items with `variant_group_id === null`; `stock_time_ms` is not read; the lower median; clamped at 0. **A repeated `station_id`** keeps its first row (24-3, accepted). Task 24 also changed 01a's sync tests to expect the new `EngineConfigApplied`; 01a §4.2 / S40 N2 allow the hook's append, so no 01a contract change (24-5, accepted).
> - **Config effects as built** (AD-25, accepted): a station-type change keeps open lines as fixed input (`placedUnderOldType`), with §3.5.3's exception: a capacity fold re-places them by shape (`oldType`, `blockShape`), moving only later. Type and capacity in one event behave as two changes. A capacity rise does not widen a stored block, but firing does (rare; it surfaces as a slip). An archived only-station falls back to itself (D3). A recount does not release a fixed line. The deferred checkpoint's `slips` / `slip_due` can differ from a full replay until the `AlertClosed` of a slip open at the cut (transient, narrow).

**`EngineConfigApplied` v1 payload (Changed in v0.2, pre-G2 #9)** = `EngineConfig`, the only config input of replay (P-8):

```ts
EngineConfigAppliedV1 = {
  config_version: number,
  stations: Array<{
    station_id: string, name: string, station_type: 'slot' | 'batch', capacity: number,
    freshness_window_ms: number | null, completion_mode: 'two_tap' | 'single_tap' | 'auto_done',
    policy: 'waada_guard' | 'edf' | 'fifo', freeze_ms: number, min_slack_keep_ms: number,
    promise_padding_ms: number | null, pressure_window_ms: number, pressure_amber_bp: number,
    pressure_red_bp: number, pressure_alert_ms: number, pause_enabled: boolean,
    lane_units: number | null, reserve_units: number, point_id: string,
    alternates: Array<{ station_id: string, order_types: OrderType[], home_for_order_types: OrderType[] }>,
    carry_times: Array<{ point_id: string, carry_ms: number }>,
    programs: Array<{ program_id: string, name: string, cook_time_ms: number, is_archived: boolean }>,
    reference_cook_ms: number,   // v0.4 (G2 #24): median `cook_time_ms` over the station's active (not archived) routed items,
                                 // base items only (variants and from-stock times not counted); lower median for an even count; 0 when none (stations-live wait_ms)
    is_archived: boolean,
  }>,                             // sorted by station_id
  settings: { weight_dine_in_pct, weight_takeaway_pct, weight_delivery_pct, weight_parking_pct,
              weight_follow_up_pct, promise_padding_dine_in_ms, promise_padding_takeaway_ms,
              promise_padding_delivery_ms, promise_padding_parking_ms, slip_threshold_ms,
              slip_escalate_ms, cascade_step_ms, min_gain_ms, returns_boost, order_abandon_ms },  // v0.6 (G4-2 #2): order_abandon_ms  // all numbers but returns_boost: boolean (01a A-12)
}
```

**Catch-up (Changed in v0.2, pre-G2 #4):** a hub whose config is already applied (03a shipped later, a restored hub) gets no apply and therefore no `EngineConfigApplied`. Boot step 6 sets the host flag `configStale = canonicalJson(E(branchConfig())) ≠ canonicalJson(state.config)`; the first `fires` pass then appends `EngineConfigApplied` and clears the flag. *Changed in v0.4 (G2 #22):* **the catch-up pass writes only the config**; its intents are not computed on the pre-config state, and follow in the next pass (≤ 500 ms; `nextDueAt` of the folded state). Every hook run also re-evaluates it. Test 79.

> ⚠️ **Changed in v1.0.1 (AD-35 (c) / reading 24-4, owner ruling 2026-11-07; AD-33 (22), accepted):** the catch-up is a pass of the `fires` tick, in that tick's own transaction, and it writes only the config, as above (its due pass leaves `last_pass_ms` as it is, so the next pass still sees that interval's freeze entries). **Back-off:** after **3** catch-up attempts that did not commit (E() or the append throws), ordinary `fires` passes run again while `configStale` **stays set**, and their intents are computed on the pre-config state; the catch-up is retried **once per 60 s**. Each pass in the back-off logs **one `warn` line** with the failure count, the config version in use and the one wanted (built from memory, 0 statements). **No new alert kind.** Each failed retry also logs two error lines (the tick loop's `tick failed` and the back-off line), about two a minute. So fires never stop because a catch-up fails. Was: "the catch-up pass writes only the config; its intents are not computed on the pre-config state", read literally blocking fires for as long as the catch-up fails.

### 3.12 Replay, snapshots, checkpoint, boot (D26, §3 #2, F §5.8)

- **Replay filter (§3 #2):** one statement per stream, each `WHERE branch_id = ? AND stream_type = ? AND seq > ? AND event_type IN (<list>) ORDER BY seq`, served by the new index `events_branch_stream (branch_id, stream_type, seq)`, merged by `seq` in memory (4 statements). Lists: `order` — `OrderPlaced`, `OrderLinesAdded`, `ItemAdded`, `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ItemServed`, `ItemRemoved`, `ItemVoided`, `ItemMovedToStock`, `ItemReturned`, `OrderBoosted`, `ItemsReleased`, `SlipWarned`, `AlertClosed` (*v0.2, pre-G2 #1:* `RequestAnswered` removed; *Changed in v0.4, G2 #4:* `AlertClosed` is back, folded only when its `alert_id` is a `slips[key].alert_id`, §3.8 — a slip alert's subject is an order, so its close is on the `order` stream; ≈ one row per order-subject alert, well inside R6's 45k); `station` — `FireDispatched`, `ReservationsShifted`, `EngineConfigApplied`, `StationCapacitySet`, `StationPauseSet`; `stock` — `StockSet`, `StockAdded`, `StockReserved`, `StockReleased`, `StockConsumed`; `hub` — `BusinessDayOpened`, `BusinessDayClosed`. `audit` is never read (≈ 30k/day, R6). *Changed in v0.4 (G2 #3):* these lists are **exported as one constant** `ENGINE_REPLAY_EVENTS` (per stream) and are exactly the event types `applyEvent` handles; every other type returns `state` itself. A static test (test 94) asserts that the set of types with a case in `applyEvent` equals the union of the lists, so live (which folds every appended event) and replay (which reads only the lists) cannot diverge.
  > ⚠️ **Changed in v1.0.1:**
  > - **Batch fold** (AD-28, developer ruling): `applyEvents(state, events[], opts?)` in `@pos/engine` copies the state once per call, folds the events into that private copy and returns the new state; pure at the boundary; no state-shape change. Replay folds in **chunks of 500**; the live writer folds one transaction's events with one call. `applyEvents(s, es)` deep-equals the per-event fold for the generated day (same value and text). Reading (AD-29 Q3, **proposed (not yet ruled), developer to confirm**): about 8–9 % of folds still copy `lines` (removal and re-plan); no in-place delete. Was: one `applyEvent` per event.
  > - **`AlertClosed`** is folded only on the `order` stream, live as in replay (AD-31, **proposed (not yet ruled)**, §3.8).
  > - **The list is unchanged by AD-37 (2)** (owner ruling): `RequestAnswered` stays off it; an answered slip closes its key for that seating (§3.8). Test 94 is unchanged.
- **Snapshots (F §5.8):** after a commit that crosses a multiple of 500 events the host **schedules** the snapshot with `setImmediate`, outside the command's response path, and writes `engine_snapshots` in its own small transaction (not an event) from the state current at that moment; on SIGTERM it writes one synchronously before the database closes (*Changed in v0.2, pre-G2 #38*; measured in §10.6). It keeps the newest **2** of the current version (the second covers a torn or unreadable newest row) and deletes older-version rows after a fresh one is written (D62; *Changed in v0.2, pre-G2 #37*). *Changed in v0.4 (G2 #17):* the snapshot's `last_seq = writer.lastSeq()` and its state are read **in the same `setImmediate` callback** (no commit can run between them: the writer is synchronous on the one event loop). F §5.8's rule is kept: after a boot that loaded **no** snapshot of the current version (step 2 fell back to a checkpoint or seq 0), the host schedules one fresh snapshot as soon as startup completes, so a crash in the next 500 events does not repeat the long replay (test 61).
  > ⚠️ **Changed in v1.0.1 (AD-33 (21) and (22a), accepted; AD-34 (5), developer ruling):** SIGTERM is caught with **`process.once('SIGTERM')`**, which flushes and checkpoints and then closes, because the snapshot needs the writer still open, which a Fastify `onClose` hook does not guarantee (§6.3). Before that snapshot, a non-empty dropped-line queue (AD-8) is flushed by one `fires_alerts` pass; if the flush throws, the snapshot is still written and the drop stays only in the error log (narrow, logged). A stop without SIGTERM writes no shutdown snapshot, and boot re-queues the drop (step 6 below). The snapshot timing check runs in `pnpm test:perf` (`snapshots.perf.test.ts`), not in the normal gate (it hit 60–91 ms under load). Was: "on SIGTERM it writes one synchronously before the database closes" (`app.addHook('onClose')` in §6.3).
- **Day-close checkpoint (D26, README "To 03a" row 1; Changed in v0.4, G2 #5; Changed in v0.5, G4-1 #6):** the checkpoint is written **only when no order is in the engine** (*v0.6, G4-2 #3:* the pure predicate `noOrderInEngine(state, now)`, §3.6.1, never the physical emptiness of `state.orders`, which lingers until a listed fold). After the commit that applies `BusinessDayClosed`: if `noOrderInEngine(state, recorded_at)` holds, the host writes it at once (below); if orders remain (carried over the close, §3.3), the host sets `checkpoint_pending` and the `fires` tick's `due` schedules it at the **first pass at which `noOrderInEngine(state, now)` holds** (§3.6.1), with `last_seq = writer.lastSeq()` read in the same `setImmediate` callback as the state — at most once per business day. A `BusinessDayOpened` fold-commit clears `checkpoint_pending`, and the previous checkpoint then stands.

  *Changed in v0.6 (G4-2 #2, #3), the bound restated.* Every order now leaves the engine within `ORDER_EXIT_AFTER_SERVED_MS` of its last serve, or within `order_abandon_ms` of its last line fold (§3.3). The deferred checkpoint is therefore written the same night whenever the next open comes later than that, which with the default is 4 h after the day's last tap — the case of a pilot that closes at night and opens the next morning. Only a close followed by an open less than `order_abandon_ms` later (a stale-day Close + Open mid-service, 01a S33) keeps the previous checkpoint, and the next normal night writes a new one. So a version-bump boot replays **≤ 2 days**, unless two closes in a row are each followed that quickly by an open (recorded, §12.3 G4-2 #2). That case needs a version bump, which ships only in the maintenance hour (01a S39). The 2-day estimate is ≈ 2 × the one-day 40–50 s, gated by §7.1's 2-day row (D26's "full replay from the day-close checkpoint only"). A crash restart still replays ≤ 500 events from a snapshot. Boot step 6 sets `checkpoint_pending` when `state.business_day?.closed_at ≠ null` and the newest checkpoint step 2 read has `taken_at < closed_at` (0 statements). When it is written, the host writes (keeping the newest 2; v0.2, pre-G2 #37) `engine_checkpoints { checkpoint_schema: 1, last_seq, business_day, stock, stations: { capacity_override, paused }, config }` — a version-independent document (its own schema, upcast like an event, D46). `business_day` is the closed day (`closed_at` set), so a boot from the checkpoint between the close and the next open equals a full replay (stock page, day commands). **`last_seq` = the max seq of that commit** — the commit that folded `BusinessDayClosed`, including the `StockReleased { day_closed }` the day-close writer appends with it — never a seq inside the commit, so step 3 never folds a day-close release twice; for a deferred checkpoint, `writer.lastSeq()` at the moment it is written (every commit is whole, so never a seq inside one). At that point no order is in the engine and no exited line holds a reservation (§3.6.1), so nothing else carries over. The body is built from the stock, station and config parts only; orders that are still physically present but exited by the predicate are not part of it (v0.6, G4-2 #3).
- **Boot step 2:** latest snapshot with `engine_version = 3` → state; else the latest checkpoint → `fromCheckpoint`; else empty from seq 0 (a new hub). *v0.4 (G2 #17):* each read takes `LIMIT 2` (still one statement each), so a torn or unparsable newest row falls back to the second without another statement. **Step 3:** replay since that seq (crash restart ≤ 500 events ≈ 2 s; a version bump replays one day, est. 40–50 s, D26). A version bump is shipped only in the maintenance hour (01a S39); a mid-rush boot still fits the 90 s budget. Steps 2–3 replace 01a's step-3 fold (`sync/boot-steps.ts`). *Changed in v0.2 (pre-G2 #3):* `stock_version` (01a §6.19) is the seq of the newest stock-page event over the **whole** log, which a replay from a snapshot cannot see, so step 3 reads it with **two** statements on the new index — `SELECT seq FROM events WHERE branch_id = ? AND stream_type = 'stock' AND event_type IN (<STOCK_VERSION_EVENTS on stock>) ORDER BY seq DESC LIMIT 1` and the same on `hub` for `BusinessDayOpened`, `BusinessDayClosed` — and takes the max. `STOCK_VERSION_EVENTS` gains `StockReserved`, `StockReleased`, `StockConsumed` (they change the stock page; §4.5 A-17). **Step 6:** dry missed-fire count (§3.6.2); `configStale` (§3.11); `checkpoint_pending` (above; v0.5, G4-1 #6); *v0.4 (G2 #23):* the host flag `day_closed = state.business_day?.closed_at ≠ null`, so a restart between a day close and the next `fires_alerts` pass still closes the open `slip_warning` requests `obsolete` (at most one extra transaction per boot at night); the `reconcile` flag (§3.10).
  > ⚠️ **Changed in v1.0.1 (AD-33 (22a) (8), accepted):** step 6 also **re-queues the dropped-line facts** (AD-8) from the step-3 replay diagnostics (0 statements), so a restart never loses an `engine_line_dropped` alert. A drop whose alert managers already closed inside the replay window is raised again: noisy, not silent. Was: not stated.

*Changed in v0.3:* §3.13 "Pending the field visit" is removed (owner ruling: configuration, not spec numbers). Its proposed values are the config defaults of §4.5.

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| Foundation | `PosEvent`, D44/D45 rules, stream types `order`, `station`, `stock`, `hub` |
| 00 | `writer.run`, `state.setReducer`, `registerBootStep('2' \| '3' \| '6')`, `BootContext.initialState` (+ `missedFires` and `clock`, row H-1; v0.4, G2 #6), `defineCommand`, `defineQuery`, `registerCatchUp`, `registerEventAudience`, `clock.branchNow`, `ids` |
| 01a | `branchConfig()` (schema 3 after v2.1), `onBranchConfigApplied`, `canonicalJson`, stock helpers (01c re-keyed), the stock commands (rows A-9, A-10) |
| 01b | `manage-stations` (row B-1), `boost-order`, `mark-item-returned` (B-5), `my_stations` scope via `StaffDirectory.stationsOf(staff, 'run_station')` (B-4; v0.2, pre-G2 #16) |
| 01c | `ItemAdded` v1 (§4.3), `isStockTracked`, `dayDraws`, `canServeFromStock` |
| 01d | `defineAlertKind`, `alerts.raiseMany`, `alerts.closeMany`, `alerts.tickCtx`, `alerts.listOpen`, `registerTick` (twice: `fires`, `fires_alerts`) |
| 02 (when built) | `tableOwners(db, table_ids[]) → Map<table_id, staff_id>` (one statement), for `dine_in` slips only; stub until then = `placed_by`; takeaway / delivery / parking always use `placed_by` (v0.5, G4-1 #8) |

### 4.2 Exposes (later modules may rely only on these)

**`@pos/engine`:** `ENGINE_STATE_VERSION = 3`; `EngineState` (§3.3, read-only for callers); `applyEvent`, `buildEngineState`, `fromCheckpoint`, `ENGINE_REPLAY_EVENTS`, `isOrderInEngine` (v0.4, G2 #3), `noOrderInEngine`, `liveInterval` (v0.6, G4-2 #1, #3); `planOrder`, `calculateETA` (= preview, §6.1), `checkOrderable`, `reserveStock`, `stockEffects`, `getTickIntents`, `getAlertIntents`, `nextDueAt`, `nextAlertDueAt` (v0.4, G2 #4), `stationView`, `stationPlan`, `groupReadiness`, `stationPressure`, `stationsLive`, `pullEarly`, `lateStartShift`, `planRelease`, `capacityForLanes`, `goesWith`; the 01a/01c stock helpers unchanged.

**Hub:** the `fires` and `fires_alerts` ticks; the kinds `slip_warning`, `station_overload`; commands `set-station-capacity`, `set-station-pause`; query `stations-live`; catch-up parts `stations_live` and `station_plan`, frame `station_plan` (§3.6.3); audiences for the station-stream events.

> ⚠️ **Changed in v1.0.1:**
> - **`@pos/engine`** also exports `applyEvents` (AD-28, developer ruling); `applyEvent` / `applyEvents` take `opts?: { strict?: boolean }` (AD-6); `liveInterval(state, order_item_id, t)` (P-5, proposed (not yet ruled)); `groupReadiness(state, order_id, now)` (AD-24 G1, accepted).
> - **`@pos/engine/sim`** (P-12, **proposed (not yet ruled)**): a test-only subpath export (`./test/sim/index.ts`) of the simulator; only test files import it (the engine `lint.test.ts` asserts no `src` file does). Not a contract for other modules.
> - **Hub:** a third kind, **`engine_line_dropped`** (AD-8 developer condition, developer ruling; AD-37 (7), proposed (not yet ruled)): `info`, to managers, values `{ order_id, order_item_id, reason }`, subject the order stream, dedupe `engine_line_dropped:<order_id>:<order_item_id>` (one per id; a refused batch uses the same per-line key), `closes_on: 'owner'`, no lead fallback, expires at day close.

**`ProposedOrder` (Changed in v0.2, pre-G2 #8)** — the input of `planOrder`, `calculateETA`, `checkOrderable`, `reserveStock`, built by 02 from `branchConfig()`:

```ts
ProposedOrder = {
  order_id: string,
  order: { order_type: OrderType, table_id: string | null, table_key: string, follow_up: boolean, pickup_at_ms: number | null },
  lines: Array<ItemAddedV1 & {                  // the drafts 02 will append (01c §4.3)
    alternates: Array<{ station_id: string, carry_ms: number, home: boolean }>,  // allowed for this order type (D8)
    point_id: string | null, carry_ms: number,   // home station → point
    weight_pct: number, max_early_ms: number, max_late_ms: number | null, max_carry_ms: number | null,
    cook_ms_override: number | null,             // a `fix` return: the item's adjust_time_ms (D28)
    return_of: { order_item_id: string, mode: 'fix' | 'remake' } | null,
  }>,
}
```

**Events (all `schema_version: 1`; `@pos/events/src/events/{order,station,stock}/`).** 03a defines the payload fields the engine reads; **the writing module implements them exactly and may add its own fields before the pilot (R29), never change these** (extends §3 #4, **P-9**).

| Event | Stream / id | Payload (engine fields) | Written by |
|---|---|---|---|
| `OrderPlaced` | order / order_id | `{ order_id, order_type, table_id \| null, table_key, follow_up, pickup_at_ms \| null, order_item_ids: string[], groups: [{ group_id, target_land_ms, promise_ms, order_item_ids }], lines: [{ order_item_id, station_id, alternates: [{ station_id, carry_ms, home }], point_id \| null, carry_ms, from_stock, weight_pct, max_early_ms, max_late_ms \| null, max_carry_ms \| null }] }` (v0.2, pre-G2 #6). `lines[].station_id` is the engine's starting station (D8); `ItemAdded.station_id` stays the home route (D25), which 03b uses only as a label (v0.2, pre-G2 #28) — batch order: `OrderPlaced`, then `ItemAdded` in `order_item_ids` order, then `StockReserved`; the engine plans at the `ItemAdded` that completes the list (`awaiting` = 0, §3.5.1; v0.6, G4-2 #4). *v0.5 (G4-1 #22):* `EngineOrder.placed_by` = the event's envelope `actor_id`, `placed_at` = its `recorded_at` (no payload field) | 02 `SubmitOrder` |
| `ItemAdded` | order / order_id | 01c §4.3, unchanged | 02 |
| `OrderLinesAdded` | order / order_id | as `OrderPlaced` minus the order fields: `{ order_id, order_item_ids, groups, lines }` (later additions, 01c §4.4 "Later additions"; **P-10**); `lines[]` also carry `return_of: { order_item_id, mode: 'fix' \| 'remake' } \| null` and `cook_ms_override: number \| null` (the `fix` cook time, D28, §3.8a; v0.2, pre-G2 #5). The order must be in the engine (§3.3), so no order fields are needed (pre-G2 #10, resolved by #2) | 02 (`SubmitOrder` additions, `ReturnToKitchen`) |
| `ItemReturned` | order / order_id | `{ order_item_id, mode: 'remake', replacement_order_item_id }` — the served line exits the engine (§3.3); `fix` writes none (D28) | **02** `ReturnToKitchen`, from this schema (*v0.5, G4-1 #23:* no 04 helper; 03a owns the schema file in `packages/events/src/events/order/`); 04 reads it for the bill effect and wastage |
| `ItemStarted` | order / order_id | `{ order_item_id, started_at, source: 'tap' \| 'inferred' }`; *v0.5 (G4-1 #24):* the engine uses `min(started_at, recorded_at)` (a tap queued offline keeps its real time, never a future one); `ItemDone.done_at` likewise | 03b, fires tick |
| `ItemDone` | order / order_id | `{ order_item_id, done_at, source }` | 03b, fires tick |
| `ItemDoneUndone` | order / order_id | `{ order_item_id }` (≤ 30 s after Done, D16) | 03b |
| `ItemServed` | order / order_id | `{ order_item_ids, source: 'tap' \| 'estimated' }` (§3 #12) | 02 |
| `ItemRemoved` | order / order_id | `{ order_item_id }` (stage 1) | 02 |
| `ItemVoided` | order / order_id | `{ order_item_id, units }` | 04 |
| `ItemMovedToStock` | order / order_id | `{ order_item_id, units }`; with it `stockEffects` gives `StockReleased { reason: 'moved' }` and `StockAdded { reason: 'moved' }` (§3.7, v0.2 pre-G2 #13) | 04 |
| `OrderBoosted` | order / order_id | `{ order_id }` | 02 |
| `ItemsReleased` | order / order_id | `{ order_id, alert_id \| null, released: string[], expedite: string[] }` | `slip_warning.apply`, 02 `ReleaseItems` |
| `SlipWarned` | order / oldest order_id | `{ table_key, order_ids, alert_id, estimated_land_ms, target_land_ms, promise_ms }` (*Changed in v0.4, G2 #4:* `alert_id` from `raiseMany`, so the engine matches the alert's `AlertClosed`; v0.2's join through `AlertRaised.values.table_key` still works) | `fires_alerts` tick |
| `FireDispatched` | station / station_id | `{ station_id, order_item_ids, load_id \| null (`station_id:earliest order_item_id`, §3.3; a name, not membership — it stays when that line is voided or removed before the fire, v0.2.1), due_at, reason: 'scheduled' \| 'early_fill' \| 'pulled' }` — *v0.5:* `due_at` = the line's (load's) planned `fire_ms` at dispatch (G4-1 #24); `'missed'` dropped, 07 derives it from `due_at` vs `HubStarted` (G4-1 #16) | fires tick; 03b `GiveMeMore` (`pulled`) |
| `ReservationsShifted` | station / station_id | F §4.7 `{ station_id, cause: 'overrun' \| 'late_start', shifts: [{ order_item_id, by_ms }] }` | fires tick; 03b `StartItem` (late start) |
| `EngineConfigApplied` | station / branch_id | `{ config_version, stations: [...§3.11], settings: {...} }` | 03a hook |
| `StationCapacitySet` | station / station_id | `{ station_id, capacity_override \| null, previous \| null, reason: 'manager' \| 'lane_off' \| 'lane_on' }` | 03a |
| `StationPauseSet` | station / station_id | `{ station_id, paused }` | 03a |
| `StockReserved` | stock / stock_item_id | `{ stock_item_id, order_item_id, quantity }` (01c V5). *Changed in v0.6.1:* the fold re-plans the line's station only when it flips the line's `from_stock` from false to true (a `StockAdded` reservation); a submit's own `StockReserved` events match `OrderPlaced.lines[].from_stock = true` and never re-plan (§3.5.3, §3.7) | 02; the writer of a `StockAdded` via `stockEffects` (01a, 04; v0.4, G2 #7) |
| `StockReleased` | stock / stock_item_id | `{ stock_item_id, order_item_id, quantity, reason: 'removed' \| 'voided' \| 'moved' \| 'recount' \| 'day_closed' \| 'abandoned' }` (§3.7; *v0.6, G4-2 #2, #4:* `abandoned` is written by the `fires` tick; the `recount` and `day_closed` releases precede their `StockSet` / `BusinessDayClosed` in the batch; `reason` `moved` replaces `moved_to_stock`, v0.2; `unit_changed` dropped, v0.4 G2 #21) | 02, 04, 01a, day close (01a, later 05), fires tick (`abandoned`, v0.6) |
| `StockAdded` v2 (01c) | stock / stock_item_id | gains optional `reason?: 'moved'` (additive; absent = a manual add, S45) (v0.2, pre-G2 #13, §4.5 A-19) | 01a stock commands, 04 via `stockEffects` |
| `StockConsumed` | stock / stock_item_id | `{ stock_item_id, order_item_id, quantity }` (§3.7) | 03b, fires tick; 01a before a unit-changing `StockSet` (Q14, v0.6) |

`TableLockReleased` and `TableLockTouched` are not engine events (02, §3 #8). 01d's `AlertClosed` (01d §4.2, unchanged) is read by the engine for slip alerts only (§3.8; v0.4, G2 #4).

### 4.3 Requirements carried to other modules

**To 02 (Ordering + Tables):**
*(Items renumbered 7, 8, 9 in v0.2, pre-G2 #36.)*
1. Implement `OrderPlaced` v1 and `ItemAdded` v1 **exactly** as §4.2 / 01c §4.3, build `ProposedOrder` (§4.2) from `branchConfig()`, in the batch order of §4.2, with `groups`, `lines`, `target_land_ms` and `promise_ms` from `planOrder(state, proposed, now)` in the **same** transaction and state; `checkOrderable` first (`409 STATION_PAUSED`); `reserveStock` for `StockReserved` and `lines[].from_stock`; a `sold_out` line at available 0 is refused with 02's code. `OrderLinesAdded` for a later addition to an order **in the engine** (`isOrderInEngine(state, order_id, now)`); *Changed in v0.5 (G4-1 #7):* an addition to an **exited** order (a dessert 35 min after the mains were served) is **never refused**: write it as a **new order** (`OrderPlaced` on the same table and bill, `follow_up: true`); there is no other reading of "open order". *Changed in v0.6 (G4-2 #2):* an order with `isOrderInEngine = false` while 02's projection still shows unserved lines is **abandoned** (no tap on any line for `order_abandon_ms`). 02 shows it on the manager's open-orders view as "abandoned — no kitchen tap for N h". Its bill is 05's (To 05). *⚠️ Changed in v1.0.1 (BF-11):* the label reads **"abandoned — no tap on any line for N h"** (a Served tap counts too). Was: "abandoned — no kitchen tap for N h".
2. **Own `TableLockReleased`** (F §4.3 D51): register your own `registerTick({ name: 'table_locks', … })`; the lock state lives in 02's projection, not `EngineState` (§3 #8, F-2).
3. **`follow_up` (D7):** set it on an order whose table already has a served order in the current seating; the engine only weighs it.
4. **Estimated Served (§3 #12, G0-6):** your own tick writes `ItemServed { source: 'estimated' }`; tapped Served writes `source: 'tap'`; the same writer appends `StockReleased` / nothing per `stockEffects`.
5. `ItemRemoved` (with `stockEffects`), `OrderBoosted` (`BoostOrder`, `boost-order`), delivery `pickup_at_ms`.
6. Expose `tableOwners(db, table_ids[])` (one statement) for the slip receiver of `dine_in` orders (§3.8); takeaway / delivery / parking slips go to `placed_by` (v0.5, G4-1 #8).
7. **Table view "Send what's ready" (D11, D12):** a `ReleaseItems { order_ids, released, expedite }` command (permission: the table's `mark-served` holder) that writes `ItemsReleased` from `planRelease` and closes the open `slip_warning` alert `done`.
8. **Return to kitchen (D28, §3.8a):** `ReturnToKitchen { order_item_id, mode: 'fix' | 'remake' }` on a `served` line (permission `mark-item-returned`, v0.2 pre-G2 #15; refused `409 ORDER_NOT_IN_ENGINE` when `isOrderInEngine(state, order_id, now)` is false and the screen says "This order is closed" (§3.3, §9, pre-G2 #2, v0.4 G2 #3, v0.5 G4-1 #7); refused `409 RETURN_ALREADY_OPEN` when the served line already has an unserved return line (v0.5, G4-1 #19); batch order `OrderLinesAdded` then `ItemReturned`; copy `adjust_time_ms` into `cook_ms_override` for `fix`, pre-G2 #5); writes `OrderLinesAdded` with one line copying the served line's D25 fields, `return_of` set, no stock draw, planned by `planOrder` as an immediate expedited line (or a boost when `returns_boost`); for `remake` also `ItemReturned` (§4.2 schema), **written by 02 itself** in the same transaction (v0.5, G4-1 #23). *Changed in v0.5 (G4-1 #11):* the return line's `ItemAdded` has `price_minor = 0`, `line_total_minor = 0`, `tax_class_id = null` and every option `charge_minor = 0` (§3.8a); 02's `ItemAdded` tests assert it. Two buttons, no reason, no charge in the pilot.
9. **Ordering screen (D20):** tiles show "about `wait_ms + prep + cook`" from `stations-live`, red band = "tell the customer"; refetch on `StationCapacitySet`, `StationPauseSet`, `EngineConfigApplied` frames and every 30 s while open. The ETA preview uses `calculateETA`; the response carries `as_of_seq`, and the submit result wins (§12.3 Q4). Customers and staff are shown `promise_ms`, never `target_land_ms`.
10. ⚠️ **Added in v1.0.1 (carried rows from the build):**
    - **Binding (AD-29 Q5, developer ruling):** the device mints `order_item_id`; 02 refuses a reused live id **before append**. The engine refuses it too, but a refused batch's `StockReserved` carries no `order_id`, so on a fresh or fired line at `added` the fold cannot tell it from a legal flip (a known limit, pinned in task 18e).
    - **Route fields (AD-17, accepted):** `OrderPlaced.lines[]` copies `PlanResult.lines[]` `station_id`, `alternates` and `carry_ms` verbatim; `OrderPlaced.order_item_ids` are listed in `proposed.lines` order.
    - **`MarkServed` (AD-29 Q7, developer ruling):** append `stockEffects` of the `ItemServed` draft: a from-stock line with no Start consumes at Served. Draft from the folded state, or use the array form for several causes in one command (two single-form calls from one state would double-draft).
    - **`mark-served` default scope** is `'branch'` (AD-32 (2), developer ruling).

**To 02p (from the owner's AD-37 rulings, 2026-11-08):**
1. **Task 0 (open item 10):** carry the §6.2a bound into 03a v1.2 next to the Q-1 reader pair: `fires_alerts` with work = 2 (`listOpen`) + ≤ 1 `holdersOfOrders` + ≤ 1 `currentTableOf` + ≤ 1 line facts + 01d's bounds. Also carry 01d v1.1.2 into 01d v1.2.
2. **U-7 (open item 11):** a test "a new seating on the same table gets fresh slip warnings after an earlier slip was answered" (02p Q-2 keys `dine_in` by `seating_id`). Within the same seating, one answer closes it (§3.8).

**To 03b (KDS + Printing):**
1. **Ready to serve and Handover** (events, commands, the assembler view, the Ready-to-serve kind with `point_id` and `window_ms`), decided 2026-11-02 (§3 #6); HOLD at pass is a hint, never a block — whatever is ready may be marked Ready to serve (01d K4; v0.3); points come with 01a v2.1. *Changed in v0.4 (G2 #1):* the assembler view's point tablets use 00's `devices.point_id` (row H-5); **binding a tablet to a point** in the device screen is yours (with 01e for headless devices). Readiness from `groupReadiness`; READY = every sync line done (§3 #9); a release dedupe key uses the `ItemsReleased` event id.
2. **Chef screen contract (D16–D18):** Now / Next / "Later: N" from `stationView(state, station_id, now)` on the hub and the `station_plan` catch-up part and frame on the KDS (§3.6.3, v0.2 pre-G2 #12; never `latestStartAt`); new tickets append at the bottom; Done removes its line; never reorder what is visible; `mark` lines (`expedite`, `boost`, `pulled`) jump to the top in red with the reason ("T12 is eating"). *v0.5 (G4-1 #4, #5):* a Next line with `mark: 'moved'` (re-placed by a boost or a capacity change, the two D15 exceptions) keeps its row but shows a red "moved" marker with its new time; nothing else in Next moves.
3. Commands `StartItem` (`ItemStarted`; late start → `ReservationsShifted` from `lateStartShift`; from-stock → `StockConsumed`), `DoneItem` (`ItemDone`; sanity check: Done under 50 % of cook time asks to confirm), `UndoDone` (`ItemDoneUndone` ≤ 30 s, close reason `undone`), `GiveMeMore` (`FireDispatched { reason: 'pulled' }` from `pullEarly`, same `max_early_ms` limit), all per line (D18).
4. Lane Off / On calls `SetStationCapacity` with `capacityForLanes(station, lanes_on, lane_count)` from the KDS's **station session** for its own station (`reason: 'lane_off' | 'lane_on'`, §6.6, v0.2 pre-G2 #17); a claim never touches the engine. *Changed in v0.4 (G2 #1):* `lane_count` = the station's `kds` devices with a `lane_label`, not revoked (00 row H-6), counted by you from the device directory; setting a device's `lane_label` at pairing (and on the lane names screen, 01d G0-3) is yours.
5. Print a ticket per `FireDispatched` line; reprints after restart (F §5.8 step 5).
6. **Return tickets (D28):** a line with `mark: 'return'` shows at the top in red with "RETURN · fix | remake" and the old ticket's table and item (`return_of.order_item_id`); Start / Done as any line.
7. ⚠️ **Added in v1.0.1 (carried rows from the build):**
   - **Stage guard (AD-10, developer note):** the engine's fold ignores a stage event from the wrong stage. That does **not** replace your command-level check: `StartItem`, `DoneItem`, `UndoDone` and `MarkServed` still answer `409 ITEM_WRONG_STAGE` from the current stage before appending (foundation §4.2 stage guard).
   - **`DoneItem` (AD-29 Q7, developer ruling):** append `stockEffects` too; a from-stock line with no Start consumes at Done. Draft from the folded state, or use the array form.
   - **Loads (AD-18; tasks 13, 14):** fire a whole load before a Start or a pull on one of its lines; `StartItem` and `pullEarly` on a batch station name the load. `GiveMeMore` on a `single_tap` line writes the inferred start.
   - **`pullEarly` may answer `null` inside the `max_early_ms` limit** (AD-24 E2; AD-29 Q12, developer ruling): a line that would overrun another booking is passed over. Handle it.
   - **Marks (AD-24 V2, E4):** marked lines stay in fire order in the engine's views; the jump to the top is the screen's; `pulled` overwrites any mark but `return`.
   - **Frame order (AD-35 22b-5):** the `station_plan` frame goes out before the same commit's event frames.

**To 04 (Voids + Audit):** `ItemVoided` and `ItemMovedToStock` with the engine fields of §4.2 (`units` voided, per-unit voids of 01c §3.4.8 included) and the `StockReleased` / `StockAdded { reason: 'moved' }` drafts from `stockEffects` in the same transaction (v0.2, pre-G2 #13). **Returned lines (D28):** define `ItemReturned { order_item_id, mode: 'remake', replacement_order_item_id }` — *Changed in v0.5 (G4-1 #23):* the schema is 03a's (§4.2) and **02 writes it**; 04 **reads** it: the served line's bill effect (free in the pilot, wastage, reason `kitchen_fault`; audit with who returned it). A `fix` writes no `ItemReturned` and the served line stays billed. A returned line counts in the wastage report, never as a void.

**To 05 (Billing):** the existing rows stand, plus one (*Changed in v0.2, pre-G2 #14*): when 05's day open / close replaces 01a's `OpenBusinessDay` / `CloseBusinessDay` (01a §4.4 To 05), it appends `stockEffects` for `BusinessDayClosed` (*v0.6, G4-2 #10:* `StockReleased { reason: 'day_closed' }` for the hidden lines kept over the close and for exited lines still holding a reservation, §3.7, never for frozen or fired lines) in the same transaction, **before** `BusinessDayClosed` (§3.5.3, G4-2 #4) (*v0.4, G2 #21:* no `unit_changed` release at the day open, §3.7), and keeps `BusinessDayClosed` as the event the day-close checkpoint follows, with the checkpoint's `last_seq` at the end of that commit (§3.12, v0.4 G2 #5). (`BillClosed` may later become a third engine exit, §3 #11; not required.) *Changed in v0.5 (G4-1 #11):* **a line with `return_of` set is never billed** (its `ItemAdded` already carries 0, §3.8a; 05 must not re-price it); on `fix` the served line stays billed, on `remake` 04 frees it (`ItemReturned`). *v0.5 (G4-1 #6):* `BusinessDayClosed` no longer means "every order left the engine": the checkpoint may follow later (§3.12); 05's close keeps the same contract. *v0.6 (G4-2 #2):* an abandoned order (§3.3, To 02 #1) leaves the engine with unserved lines. Whether those lines are billed, voided or written off is 05's decision (with 04 for a void); the engine never changes them.

**To 01e (Devices + pager bridge; Changed in v0.4, G2 #1):** the ESP32 / headless side of point and lane devices: a headless or button device bound to a point (`devices.point_id`, 00 row H-5) or paired as a lane (`kds` + `station_id` + `lane_label`, 00 row H-6, 01d D4); pairing and binding screens for them. 00 v1.7 is the bump 01e already owns (01d G1 §5); 03a's rows H-5, H-6 join it. 03a reads neither column.

**To 07 (Owner View):** pressure history, overload events and promised-vs-actual are recomputed from the log (`stationPressure` is pure; `SlipWarned`, `FireDispatched.reason`, `ItemStarted` / `ItemDone` sources, K11 timestamps); *v0.5 (G4-1 #16):* a "missed" fire = a `FireDispatched` whose `due_at` is before the `HubStarted.hub_up_at` that precedes it (no `'missed'` reason); no extra load-snapshot field (03a-g0 §2).

### 4.4 Stubbed until another module lands

| Stub | Until |
|---|---|
| Slip receiver of a `dine_in` order = `placed_by` (other order types use `placed_by` for good, v0.5 G4-1 #8) | 02 `tableOwners` |
| Points, carry, alternates, knobs at defaults (one point, carry 0, no alternates, weight 100, `max_early_ms` 60 000) | 01a v2.1 — **03a is blocked on it for routing** (03a-g0 §2) |
| `lane_count` = 1 in tests (03a takes it as an input, §3.10) | 03b / 00 v1.7 H-6 (v0.4, G2 #1) |
| `ItemsReleased` from the table view | 02 |
| Start / Done / Give me more | 03b (tests use event fixtures) |

### 4.5 Changes to other specs (R26, R34) — Approved with v1.0 and applied by version bump (R26)

*Changed in v1.0:* approved on 2026-11-03 (developer, as the owner's proxy). Each target is bumped with a changelog and "⚠️ Changed by 03a v1.0 (row)" markers: foundation **v1.9**, 00 **v1.7** (H-1 joins H-5 and H-6, so there is no 00 v1.6.2), 01b **v1.5**, 01d **v1.1.1**, 01c **v1.1.1**, README, and 01a **v2.1**. The rows below are kept as written at approval. Was: "Proposed, needs approval. None of the target files is edited by this draft."

#### Foundation v1.8 → v1.9

| Row | Section | Change |
|---|---|---|
| F-1 | §4.7 engine state | `stock: Record<StockItemId, StockEntry>` (§3 #1); `tableLocks` removed; shape = 03a §3.3 |
| F-2 | §4.7 `TickIntent`, §4.3 D51, §5.2 text | `TableLockReleased` leaves the engine; written by 02's own tick (§3 #8); `FireDispatched` gains `reason`; `SlipWarned` per table key. *v0.4 (G2 #16):* the §5.2 sentence "writes one event per intent (`FireDispatched`, `ReservationsShifted`, `SlipWarned`, …) in a single transaction" becomes: the `fires` tick writes the engine intents in its own transaction; `SlipWarned` and the slip / overload alerts are written by the separate `fires_alerts` tick in its own transaction (03a §3.6); `FireDispatched { reason: 'pulled' }` is written by 03b's `GiveMeMore` command and `ReservationsShifted { cause: 'late_start' }` by 03b's `StartItem` (D16, D42), not by a tick |
| F-3 | §4.7 hold-and-fire step 3, reservation lifecycle, E4 AC1 note | "Fixed at submit. Recalculated only on void, boost, stock update, or capacity change" → re-plan on every submit within slack; the promise never moves; target and promise travel in `OrderPlaced` (D13, P-2) |
| F-4 | §4.7 new paragraphs | station policy, item knobs, weights, padding, keep, overload, routing, freeze, auto-fill (D3–D10, D15, D16) by reference to 03a §3.5 |
| F-5 | §4.7 slip formula | `estimated_land_time > target_land_time + slip_threshold_ms` (was `original_promise`, D11); one warning per table key (§3 #7) |
| F-6 | §4.7 | `ItemsReleased` (D11); station pressure (D20) |
| F-7 | §4.4 | READY = every sync item Done (§3 #9) |
| F-8 | §5.8 step 3 | filter by `(stream_type, event_type)` lists, index `events_branch_stream (branch_id, stream_type, seq)` (§3 #2) |
| F-9 | §5.8 steps 6, 8; §5.9 steps 5, 7 | missed fires on the first tick, dry count at step 6 (§3 #3), dispatched as ordinary fires (*v0.5, G4-1 #16:* no `'missed'` reason; derived from `due_at` vs `HubStarted`); `StockReserved { stock_item_id, order_item_id, quantity }` per draw; `OrderPlaced` carries groups, lines, target, promise |
| F-10 | §5.8 snapshot schedule | day-close checkpoint `engine_checkpoints`; full replay from it (D26); *v0.5 (G4-1 #6):* written only when no order is in the engine (*v0.6:* a pure predicate; orders also exit `order_abandon_ms` after their last tap) — at the close, else at the first `fires` pass at which none is, else the previous one stands (replay ≤ 2 days, version bump only) |
| F-11 | §7 OQ4, §9 tap-rate test | closed: taps mandatory (owner rule), `two_tap` default, tap rate measured from events in the first two pilot weeks (§3 #10) |
| F-12 | §5.1 text | "`setInterval` for fire-schedule ticks" → "the hub tick (01d `registerTick`)" (§3 #13) |
| F-13 | §4.2 SERVED → returned | *v0.2, pre-G2 #15:* return to kitchen has two modes, `fix` (a new expedited ticket, the served line unchanged) and `remake` (a new ticket, the served line `returned` as wastage); no reason in the pilot (D28); permission `mark-item-returned`, default Owner, Manager, Order taker |
| F-14 | §4.2 transition events | *v0.2, pre-G2 #32:* events are keyed `order_item_id` (01c); `previous_stage`, `next_stage`, `reason` are fields of the writing module (02 / 03b / 04), not engine fields (P-9) |
| F-15 | §5.9 step 11 | *v0.2, pre-G2 #12:* the KDS learns fire times from 03a's `station_plan` catch-up part and frame (03a §3.6.3), not from `ItemAdded.latestStartAt` |
| F-16 | §4.7 "Live station capacity" | *v0.2, pre-G2 #17:* through `SetStationCapacity`: staff sessions with `manage-stations`, or the station's own KDS station session for lane Off / On (00 M30), not only the hub admin UI |
| F-17 | §4.7 required test 11 | *v0.2, pre-G2 #33:* the slip for B's order appears on the next `getAlertIntents`, not in the capacity event |
| F-18 | §4.2 move-to-stock | *v0.2, pre-G2 #13:* `ItemMovedToStock` adds the portion to ready stock: `StockAdded { reason: 'moved' }` per draw (none without a draw), plus the reservation's `StockReleased { reason: 'moved' }`; *v0.4 (G2 #7):* like any `StockAdded`, it then reserves for waiting lines (03a §3.7) |
| F-19 | §4.7 "Recalculated only on void, boost, stock update, or capacity change" (D23) | *v0.4 (G2 #7):* "stock update" = a `StockSet` below reserved (release, full cook time) with the lines' stations re-planned at the `StockSet`; or a `StockAdded`, which reserves for that stock item's hidden full-cook lines in deadline order (hidden slot lines, and batch lines in a hidden load; *v0.6.2, G4-3 #4:* never a frozen line), switches each reserved line to its stock cook time / `stock_program_id`, and re-plans its station (*Changed in v0.6.1:* restored, 03a §3.7) |
| F-20 | §4.7 "Overrun handling (D33)" | *New in v0.5 (G4-1 #2); Changed in v0.6 (G4-2 #1); Changed in v0.6.2 (G4-3 #1):* the **fired but not yet started** items of a station are packed in fire order against capacity: each occupies `[s + prep, s + prep + cook)` with `s`, its packed Start, the earliest instant ≥ `max(fire, now)` at which that interval fits beside the COOKING items and the fired items packed before it, until its Start (*Changed in v0.6.3 (targeted check N-1):* prep begins at the Start tap, so an item not started at `now` occupies nothing before `now + prep`); a COOKING item keeps `live_endsAt = max(planned_endsAt, now)`; every placement (submit `planOrder`, preview, re-plan, tick) uses the same `liveInterval`; the ADDED-past-fire estimate is `s + prep + cook + carry` with the packed Start `s`; the late-start shift (D42) then moves a later item only by how far the Start came after its packed Start |

#### 01a v2.0.1 → v2.1 (breaking before the pilot, R29)

*Changed in v0.3:* the defaults below are config defaults only; **pilot values are entered at setup (01a pages)**. `stations.completion_mode` (existing 01a field) keeps the default `two_tap` (owner A11).

**Cloud migration** (next free number, e.g. `0007_engine_config.sql`), one transaction, every new table with `tenant_id`, `version` (R30 V13: writes need `expected_version`), `created_at`, `updated_at`; times are integer ms.

| Row | Table / column | Type, range | Default | Decision |
|---|---|---|---|---|
| A-1 | **`points`** `point_id` PK ULID, `branch_id` FK, `name` 1–40 (unique among active at the branch), `sort_order` int, `archived_at` | — | migration creates "Pass" per branch | 03a-g0 §2, A12 |
| A-2 | `stations.point_id` | FK points, NOT NULL after backfill | the branch's "Pass" | D8 |
| A-3 | `stations.policy` | `'waada_guard' \| 'edf' \| 'fifo'` | `waada_guard` | D3 |
| A-4 | `stations.freeze_ms` | 0–900 000 | 120 000 | D15 |
| A-5 | `stations.min_slack_keep_ms` | 0–600 000 | 60 000 | D6 |
| A-6 | `stations.promise_padding_ms` | null or 0–1 800 000 (null = branch value) | null | D6 |
| A-7 | `stations.pressure_window_ms`, `pressure_amber_bp`, `pressure_red_bp`, `pressure_alert_ms` | 300 000–3 600 000; 1–20 000 with amber < red; 60 000–3 600 000 | 900 000; 8 000; 10 000; 300 000 | D20 |
| A-8 | `stations.pause_enabled` bool; `lane_units` null or 1–capacity; `reserve_units` 0–capacity | — | false; null (= capacity ÷ lane count, §3.10; v0.3, owner A2); 0 | D21, §3 #5, D8 |
| A-9 | **`station_alternates`** `(station_id, alternate_station_id)` PK, `order_types` ⊆ {dine_in, takeaway, delivery, parking} non-empty, `home_for_order_types` ⊆ `order_types`; both slot, same branch, distinct | — | none | D8, D9, P-3 |
| A-10 | **`carry_times`** `(station_id, point_id)` PK, `carry_ms` 0–600 000 | missing row = 0 | — | D8, D23 |
| A-11 | `menu_items.weight_pct` 10–1000; `max_early_ms` 0–3 600 000; `max_carry_ms` null or 0–600 000; `max_late_ms` null or 0–7 200 000; `adjust_time_ms` 0–3 600 000 (cook time of a `fix` return) | — | 100; 60 000; null; null; 180 000 | D3, D28 |
| A-12 | **`branch_engine_settings`** (PK `branch_id`; *v0.2.1:* written and read through 01b's branch settings endpoint, row B-6; *v0.4 (G2 #27):* `table_lock_ttl_ms` is **02's** setting, not an engine field — it is not in `EngineConfigApplied` — and is placed here only so one 01a bump carries every timing setting, 03a-g0 §5): `weight_dine_in_pct`, `weight_takeaway_pct`, `weight_delivery_pct`, `weight_parking_pct`, `weight_follow_up_pct` (10–1000); `promise_padding_dine_in_ms`, `…_takeaway_ms`, `…_delivery_ms`, `…_parking_ms` (0–1 800 000); `slip_threshold_ms` (60 000–1 800 000); `slip_escalate_ms` (30 000–1 800 000); `cascade_step_ms` (15 000–300 000); `min_gain_ms` (0–600 000); `table_lock_ttl_ms` (60 000–3 600 000, used by 02); `returns_boost` bool (a return is placed as a boost, D28); *v0.6 (G4-2 #2):* `order_abandon_ms` (3 600 000–86 400 000; an order with no tap on any line for this long leaves the engine, §3.3) | — | 100, 200, 200, 200, 300; 180 000 ×4; **120 000** (*v0.6, G4-2 #14:* below the padding, so the order taker hears before the promise is blown, D11; was 300 000); 120 000; 60 000; 60 000; 600 000; **true** (v0.3, owner Q15a); 14 400 000 | D3, D5, D6, D7, D8, D11, D42, D51, D28, §3.3 |
| A-13 | **`goes_with_links`** `link_id` PK, `source_kind` / `target_kind` ∈ {category, item}, `source_id`, `target_id`, `excluded` bool (an item override that removes a category default); unique `(tenant_id, source_kind, source_id, target_kind, target_id)` | — | empty, filled in the owner app (v0.3, owner B21) | D12 |
| A-17 | 01a §6.19 `stock_version` | `STOCK_VERSION_EVENTS` gains `StockReserved`, `StockReleased`, `StockConsumed`; boot reads the version with 2 statements on `events_branch_stream` instead of the step-3 fold (v0.2, pre-G2 #3) | — | — | 01a S15 |
| A-18 | 01a §4.4 To 03a | "the hand-over step" = `StockConsumed` at `ItemStarted` (P-5; v0.2, review §4.5 list) | — | — | S14 |
| A-20 | 01a S14 fold rules | *New in v0.6.2 (G4-3 #3):* "a `StockAdded` whose `unit` differs from the entry's `unit` throws" → the fold leaves the entry unchanged and reports an invariant breach, which the hub logs (03a §3.7); no stock fold throws. The command still never appends such an event (S45), so the case stays a bug signal, now one that cannot fail an unrelated transaction | — | — | S14, S45 |
| A-19 | `StockAdded` v2 (01c V5 schema, 01a S45 rule) | optional `reason?: 'moved'`, additive within v2; absent = a manual add (v0.2, pre-G2 #13). *⚠️ Changed in v1.0.1 (owner ruling 2026-11-08; AD-36):* built as written: `StockAdded` stays at v2 with the optional field and no upcaster. This is a **named exception** to foundation §4.1 D46's version rule ("when a payload shape changes, the new version gets a new Zod schema and an upcaster"): every reader of `StockAdded` parses the optional `reason`. `AlertRaised` went to v2 (AD-36) because 01d's strict card check rejects unknown fields. The D46 wording is a candidate for the next foundation bump (02p, foundation v1.11); the foundation is not edited now. Was: "additive within v2" with no reference to D46 | — | absent | F-18 |

**Cloud endpoints (*Changed in v0.2.1*, Q11 closed: +2, 28 → 30, inside the split line):** `POST /v1/admin/branches/:branch_id/points` and `PATCH …/points/:point_id` (R30 `expected_version`), the only new routes; *Changed in v0.4 (G2 #18):* the `POST` requires `Idempotency-Key` (01a S7, F §6.4, M69), both routes add their case to `apps/cloud/test/helpers/route-cases.ts` (C7), and the A-1 name rule is the partial unique index `points_branch_name_active ON points (tenant_id, branch_id, name) WHERE archived_at IS NULL` (serves: the duplicate-name check of the `POST`, of a rename `PATCH` and of a restore, `409` as 01a's other named rows); points are listed in the existing `GET …/stations` response (01a §6.8, + 1 statement). **Folded into existing resources:** the station engine fields (A-2–A-8), `alternates` (A-9) and `carry_times` (A-10) are accepted by 01a's station `POST` / `PATCH` (§6.9) as fields and two nested replace-lists (C1, C6) and returned by its `GET`; `branch_engine_settings` (A-12) are fields of **01b's existing** `GET` / `PATCH /v1/admin/branches/:branch_id/settings` (01b §6.10, row B-6); `goes_with_links` (A-13) are a `goes_with` list on 01a's category `PATCH` (the default) and menu-item `PATCH` (adds and excludes), read in the existing menu read. `PATCH /v1/admin/menu-items/:id` accepts the five knobs (last write wins as 01a S23 / R30 named divergence). Owner app pages: the station form's "Timing" group, "Points", the branch settings page's "Kitchen timing" group, and the item form's "Timing" group (settings screen, D1).

**Snapshot schema 3 (`BranchConfigSnapshotSchemaV3`, `SNAPSHOT_SCHEMA_VERSION = 3`), breaking (R29):** adds `points[]` `{ point_id, name, sort_order, is_archived }`; `stations[]` gain `point_id, policy, freeze_ms, min_slack_keep_ms, promise_padding_ms, pressure_window_ms, pressure_amber_bp, pressure_red_bp, pressure_alert_ms, pause_enabled, lane_units, reserve_units, alternates: [{ station_id, order_types, home_for_order_types }], carry_times: [{ point_id, carry_ms }]`; `items[]` gain `weight_pct, max_early_ms, max_carry_ms, max_late_ms, adjust_time_ms`; top-level `engine_settings {…A-12, returns_boost}` and `goes_with: [{ source_kind, source_id, target_kind, target_id, excluded }]`; sorting as 01a §4.3. **Cost:** cloud and every hub released together (01a S28 b; a hub on v2 refuses a schema-3 body and polls again); the builder gains 5 statements (points, alternates, carry times, engine settings, goes-with), so `GET /v1/sync/config` `200` ≤ **32** with the directory and ≤ **27** config-only (*Changed in v0.4, G2 #2:* from 01b's current bounds 27 / 22, 01b v1.4.1 §4.4 row 6, B-5 of 01d v1.0; v0.3's "31" started from the stale 26). The bound is **01b's** (R32 b), so it is carried as 01b row **B-8**, not here; 01c's builder and snapshot tests re-baselined; every fixture builder (`packages/events/testing`) moves to V3; 02 / 03b clients parse V3 only. No hub runs orders yet (R29), so no data migration on hubs.

**Hub (01a hub code):** A-14 the stock commands append the drafts of `stockEffects` (`StockReleased` for a recount below reserved, S14 v0.6, appended **before** the `StockSet`, and `day_closed` at `CloseBusinessDay`, in the commit of `BusinessDayClosed` and **before** it — *v0.6 (G4-2 #4, #5):* hidden lines only, plus exited lines still holding a reservation; `StockConsumed` before a unit-changing `StockSet` (Q14); *v0.4:* `StockReserved` after `StockAdded` from `AddPrecookedStock`, G2 #7; no `unit_changed` at `OpenBusinessDay`, G2 #21); A-15 boot step 3 fold replaced by 03a (carried row); A-16 §4.2 table: `ENGINE_STATE_VERSION = 3`, `EngineState` gains 03a's slices.

#### 01b v1.4.1 → v1.5

| Row | Change |
|---|---|
| B-1 | Permission `manage-stations` (group `kitchen`; scopes `branch`, `my_stations` — the person's stations through `stationsOf`, as `manage-stock`; default **Manager** (v0.3, owner A7; Owner holds every permission, `default-roles.ts:28`)): live capacity, lane Off / On, station pause (03a-g0 §5) |
| B-2 | Permission `mark-served` (group `orders`; scopes `branch`, `own_tables`, `my_floors`; default Owner, Manager, Order taker, Waiter), defined here so one 01b bump carries both; 02 uses it (G0 P4). *v0.4 (G2 #25):* **no backfill migration** — `DEFAULT_ROLES` seeds new tenants only, and no tenant runs live before the pilot (R29); the dev and pilot tenants are re-seeded with the 01b v1.5 release (stated in its release note). This differs from 01a's `0003_manage_stock_backfill.sql` because that one covered a tenant set up for the pilot before 01a; if such a tenant exists when 01b v1.5 ships, the same backfill pattern applies. Manager gets `manage-stations` and `mark-served` from the existing rule (all but `manage-roles`) |
| B-3 | `default-roles.ts` and the roles editor catalogue gain both; directory statement count unchanged (rows, not statements) |
| B-4 | *v0.2, pre-G2 #16:* new responsibility kind **`run_station`** (01b §3.6; assignable per station like `count_stock`); `my_stations` for `manage-stations` resolves through `stationsOf(staff, 'run_station')`; `StaffDirectory.stationsOf`'s `responsibility` parameter widens to `'count_stock' \| 'run_station'` (`apps/hub/src/auth/staff-directory.ts:289`); the directory carries the new rows in the existing `responsibilities` table (no new statement). *⚠️ Changed in v1.0.1 (AD-34 (6), developer ruling, confirmed as an owner ruling 2026-11-08):* 01b §3.6 "no two entries for one station" applies **within each responsibility kind** (a person may hold `count_stock` and `run_station` for the same station). **Release note:** upgrade every hub before anyone assigns `run_station` |
| B-5 | *v0.2, pre-G2 #15:* `mark-item-returned` (exists) default grants: Owner, Manager, **Order taker** (D28 return to kitchen); *v0.4 (G2 #25):* backfill as B-2 (none, R29) |
| B-6 | *Changed in v0.2.1 (Q11):* `GET` / `PATCH /v1/admin/branches/:branch_id/settings` (01b §6.10) gains the `branch_engine_settings` fields of 01a A-12 (same ranges and defaults; the row lives in 01a's table, written in the same transaction as the branch settings, C5 one audit row; `expected_version` as 01b B23). No new 01b endpoint |
| B-7 | *v0.3 (owner A10):* `boost-order` default Owner, Manager — no change: as built Owner holds every permission and Manager all but `manage-roles` (`default-roles.ts:28, 34`) (*v0.4, G2 #12:* rows in order) |
| B-8 | *New in v0.4 (G2 #2; R32 c):* §4.4 row 6 sync bound: `GET /v1/sync/config` `200` with the directory ≤ 27 → **≤ 32**; config-only ≤ 22 → **≤ 27**; directory-only ≤ 17 and `304` unchanged. Cause: 01a snapshot schema 3 adds 5 builder statements (points, alternates, carry times, engine settings, goes-with; 01a v2.1 row above). 01b's bound test is re-baselined with it |

#### 00 v1.6.1 → v1.6.2 (additive patch) — *applied in 00 v1.7 with H-5, H-6 (v1.0)*

| Row | Change |
|---|---|
| H-1 | *Revised in v0.2 (pre-G2 #31); Changed in v0.4 (G2 #6):* `BootContext` (`apps/hub/src/lib/boot.ts:43-49`) gains two optional fields: `clock?: Clock`, set by 00 right after it creates the clock at step 3a (`boot.ts:138-144`), so steps after 3a (03a's step 6) read `ctx.clock.branchNow()` instead of the wall clock or `app` internals; and `missedFires?: number`, set by 03a's step 6 and used by step 8 `HubStarted.missed_fires` (today `0`, `boot.ts:211`). Step 6 reads the replayed state from `ctx.initialState` (unchanged between steps 3 and 6). `events_replayed` keeps its meaning (step-4 projection catch-up, `boot.ts:171-172`); the engine's replay count is logged, not added to the event |
| H-2 | *Not needed (v0.2):* the config catch-up (pre-G2 #4) runs in the first `fires` pass, so `BootContext` needs no writer |

#### 00 v1.6.1 → v1.7 (with 01e; Changed in v0.4, G2 #1)

00 v1.7 is the bump 01e owns (01d G1 §5, README "00 v1.7 stays free for 01e"); 03a's rows below join it. If 00 v1.6.2 (H-1) ships first, v1.7 applies on top of it. 03a reads neither column: `capacityForLanes` takes `lane_count` as an input (§3.10). Row names H-3 and H-4 are skipped (they are 00 v1.6's own rows).

| Row | Change |
|---|---|
| H-5 | **`devices.point_id`** `TEXT NULL`, a nullable FK to 01a's points (A-1). The hub holds points only in the applied config snapshot, so the FK is enforced at the write against `branchConfig().points` (active points of the branch), not by a SQL constraint; forward hub migration. A tablet bound to a point receives the point's alerts; several tablets may be bound to one point (01d G1-12a). Archiving a point leaves bound devices with a point that no longer routes (01d's point target resolves no one; 03b warns) |
| H-6 | **`devices.lane_label`** `TEXT NULL` (1–20 chars), same migration. A `kds` device with a `station_id` and a non-null `lane_label` **is a lane** of that station (01d D4); `lane_count(station) = count of such devices not revoked`, else 1. `lane_label` on a device of another kind, or without `station_id`, is refused at the write (`400 VALIDATION_FAILED`). The pairing / binding UI is 03b's, the headless (ESP32) side 01e's (§4.3) |

#### 01d v1.1 → v1.1.1 (editorial only)

| Row | Change |
|---|---|
| N-1 | §3.3 rule 2 "no pilot request kind is tick-raised" → "03a's `slip_warning` is tick-raised (`named`, `needs_pin: 'never'`): no in-person answer, no requester, no withdraw, no `request_result` (AD-72); 03a closes it". `station_overload` is a plain `info` kind; the table dedupe key works under `(kind, dedupe_key)` as written. No rule change. |
| N-2 | *v0.2, pre-G2 #30 (editorial):* §4.3 To 03a and the §4.4 stub row: the Ready-to-serve kind is 03b's (03a-g0 §3 #6); the slip target is `{ kind: 'person', staff_id: <receiver> }` with `receiver_staff_id` from 02's `tableOwners`, raised by 03a's `fires_alerts` tick, not `{ kind: 'table_team', depth: 'owner' }` |

#### README

R-1 module map row 03a: depends on 00 v1.6.x (v1.7 rows H-5, H-6 with 01e), 01a **v2.1**, 01b v1.5, 01c v1.1, 01d v1.1; blocked by 01a v2.1 (no longer by the field visit, v0.3); *v0.5 (G4-1 #25):* the module map's "Blocked by" column becomes "01a v2.1" (OQ4 is closed, R-4, F-11). R-2 the five "To 03a" carried rows marked addressed (§12.4 map). R-3 carried rows "To 02", "To 03b", "To 04", "To 05" (*v0.5, G4-1 #11:* a `return_of` line is never billed), "To 07" from §4.3, and *(v0.4, G2 #1)* "To 01e" (point and lane devices, 00 v1.7 H-5, H-6) with the "To 03b" binding sentences. R-4 OQ4 closed (§3 #10). R-5 R6 unchanged (no re-plan events, D13). R-6 (*v0.2, pre-G2 #14; Changed in v0.4, G2 #21*) carried row "To 05": 05's day close appends `stockEffects` (`day_closed`; *v0.6:* hidden lines only, before `BusinessDayClosed`) in the commit of `BusinessDayClosed` and keeps it as the checkpoint trigger (*v0.5, G4-1 #6:* the checkpoint may be deferred while orders are still cooking); no `unit_changed` at the day open.

#### 01c v1.1 → v1.1.1 (editorial; v0.2, pre-G2 #28, #29)

| Row | Change |
|---|---|
| C-1 | §4.3 heading: "02 owns the schema file" → "03a owns the `ItemAdded` schema file (03a-g0 §3 #4); 02 implements it exactly"; `station_id` = the home route (D25), the engine's station is `OrderPlaced.lines[].station_id` (03a D8) |

---

## §5. Data model and migrations

### 5.1 Hub — `apps/hub/src/db/migrations/0007_engine.sql` (forward-only, F §6.8)

```sql
-- F §5.8 snapshot table (D62), as specified there
CREATE TABLE engine_snapshots (
  snapshot_id    TEXT    PRIMARY KEY,
  branch_id      TEXT    NOT NULL,
  taken_at       INTEGER NOT NULL,
  last_seq       INTEGER NOT NULL,
  engine_version INTEGER NOT NULL,
  state_json     TEXT    NOT NULL
);
CREATE INDEX eng_snap_branch ON engine_snapshots (branch_id, taken_at DESC);
  -- serves: boot step 2 "latest snapshot" and retention (keep 2; v0.2, pre-G2 #37)

-- D26 day-close checkpoint (version-independent document)
CREATE TABLE engine_checkpoints (
  checkpoint_id     TEXT    PRIMARY KEY,
  branch_id         TEXT    NOT NULL,
  taken_at          INTEGER NOT NULL,
  last_seq          INTEGER NOT NULL,     -- max seq of the commit that folded BusinessDayClosed (v0.4, G2 #5)
  checkpoint_schema INTEGER NOT NULL,     -- 1
  body_json         TEXT    NOT NULL
);
CREATE INDEX eng_ckpt_branch ON engine_checkpoints (branch_id, last_seq DESC);
  -- serves: boot step 2 fallback; retention keeps 2 (v0.2, pre-G2 #37)

-- §3 #2: replay by (stream_type, event_type) since a seq
CREATE INDEX events_branch_stream ON events (branch_id, stream_type, seq);
  -- serves: the four replay statements and the two stock_version reads of §3.12 (v0.2, pre-G2 #3)
```

*Changed in v0.4 (G2 #26):* `events_branch_stream` is built by the migration over the whole `events` table, inside boot. Before the pilot every hub's log is small (no hub runs real orders, R29), so the build is seconds. A hub that already holds a long log when 03a ships builds it once, at the 03a release in the maintenance hour (01a S39), never mid-rush; at R6 volume one index over ≈ 75k rows/day is ≈ 1 s per month of history on the pilot box (measured once in task 28).

**YAGNI:** `engine_checkpoints` prevents a version-bump boot from replaying the whole history (a year ≈ 16 M events) against the 90 s budget (D26); the index prevents a full scan of `audit` (≈ 30k/day) on every boot (§3 #2). No projection tables: the engine state is in memory and rebuilt from events.

### 5.2 Cloud

01a v2.1's migration (§4.5). 03a adds nothing in the cloud.

### 5.3 Upcasters (D46)

None: every 03a event is new at v1. `StockReserved` / `StockReleased` v1 are first defined here (01c named them).

> ⚠️ **Changed in v1.0.1 (AD-36, accepted by the owner 2026-11-07; AD-37 (9), proposed (not yet ruled)):** 03a still adds no upcaster of its own. 01d's **`AlertRaised` goes to v2** (01d v1.1.2 row D-2) for the slip card's `details`; its v1 → v2 upcaster is the identity (a v1 payload has neither new field), with one fixture per version, and the writer writes v2. The cloud has no event ingest yet: **the module that builds cloud event sync must parse `AlertRaised` v2 through the shared registry.** Was: "None".

---

## §6. Endpoints, commands and events

Count against the size budget: 13 engine function rows that later modules call (batch 1; several names per row), 5 host pieces (batch 2: two ticks, boot, kinds and hook, the station plan), 2 commands and 1 query (batch 3) = **21** (budget 10–25). *Changed in v0.2 (pre-G2 #1, #12).*

### Batch 1 — `@pos/engine` (pure; no route)

| # | Function | Contract |
|---|---|---|
| 6.1a | `applyEvent(state, event, report?)` (*v0.6.2, G4-3 #3:* `report` receives stock invariant breaches; the result never depends on it) / `buildEngineState(events, report?)` / `fromCheckpoint(body)` / `isOrderInEngine(state, order_id, t)` / `noOrderInEngine(state, t)` (v0.6) / `ENGINE_REPLAY_EVENTS` | §3.3–§3.12; never mutates its input; deterministic in `(state, event)`. *Changed in v0.4 (G2 #3):* `applyEvent` handles **exactly** the types of `ENGINE_REPLAY_EVENTS` (test 94); any other type returns `state` itself and removes nothing; exited orders are removed only in handled folds (§3.3); `isOrderInEngine` is the exit predicate every reader uses (*v0.6:* including the abandon rule, G4-2 #2). *v0.5 (G4-1 #6, #7):* `isOrderInEngine(state, order_id, t)` is the contract 02 reads (the signature keeps `t`, §12.3); a handled order-stream event whose order or line is absent returns `state` itself (logged by the host), except `OrderLinesAdded` (throws). *⚠️ Changed in v1.0.1 (AD-6, developer ruling; AD-28, developer ruling; P-5, proposed (not yet ruled)):* the signatures are `applyEvent(state, event, opts?: { strict?: boolean })` (default strict; `state.diagnostics` replaces `report`), `applyEvents(state, events[], opts?)` (one copy per call; replay chunks of 500) and `buildEngineState(events, opts?)`; `liveInterval(state, order_item_id, t)` is exported. Was: `applyEvent(state, event, report?)`, `buildEngineState(events, report?)` |
| 6.1b | `planOrder(state, proposed, now)` → `{ groups: [{ group_id, target_land_ms, promise_ms, order_item_ids }], lines: [{ order_item_id, station_id, alternates, point_id, carry_ms, from_stock, eta_ms }] }` | §3.5.1; throws `DomainError('STATION_PAUSED')`; same result for the same inputs; *v0.5 (G4-1 #2, #3):* uses `liveInterval` of in-flight lines at `now` (v0.6, G4-2 #1) and the sequence pass 1 → immediate → sync |
| 6.1c | `calculateETA(state, proposed, now)` | `planOrder` without stock claims kept; preview only (F §4.7 signature kept) |
| 6.1d | `checkOrderable(state, proposed)` | D21 pause check |
| 6.1e | `reserveStock(state, proposed, dayStartMs, stockItems, configStockUnits)` (v0.2, pre-G2 #27) → `{ drafts: StockReserved[], from_stock: Record<id, boolean>, refused: string[] }` | §3.7 |
| 6.1f | `stockEffects(state, draft, stock_ctx?)` → `EventDraft[]` | §3.7: the `StockReleased` / `StockConsumed` / `StockAdded` / `StockReserved` drafts a triggering draft needs. *v0.4 (G2 #7):* `stock_ctx = { dayStartMs, stockItems, configStockUnits }` (as `reserveStock`) is required for a `StockAdded` draft, whose result includes the `StockReserved` drafts for waiting lines; *v0.5 (G4-1 #13):* also for an `ItemMovedToStock` draft, whose own release and adds are folded before the reserve; *v0.6 (G4-2 #5):* for a `StockSet` draft, the hidden-line releases and, on a unit change with `reserved > 0`, the `StockConsumed` drafts, all appended **before** the `StockSet` |
| 6.1g | `getTickIntents(state, now)` / `nextDueAt(state)` / `firesDue(state, last_pass_ms, now)` (v0.2.1) / `getAlertIntents(state, now)` / `nextAlertDueAt(state, exclude?)` (v0.4) | §3.6.1; pure; same result twice (F test 13). `getAlertIntents` → `{ slips: [{ table_key, order_ids, estimate, target, promise }], resolved: [{ table_key, alert_id }], overload: [{ station_id, pressure_bp, waiting, capped }] }` for `fires_alerts` (v0.2, pre-G2 #1). *Changed in v0.4 (G2 #4):* a slip item appears only when its crossing time is reached and `slips[key].alert_id = null`; `resolved` lists keys with `resolved_at ≠ null` (closed `done`); `nextAlertDueAt(state)` = `state.next_alert_due_at`, and with `exclude` the same minimum without those keys (§3.8) |
| 6.1h | `stationView(state, station_id, now)` → `{ now: Line[], next: Line[], later_count }`; `stationPlan(state, station_id, now)` → the `station_plan` body (§3.6.3) | D16, D17 (Now = fired, Next = frozen in fire order, Later = count); v0.2, pre-G2 #12. *⚠️ Changed in v1.0.1 (AD-24 V1, V2, SL1, accepted):* Now includes COOKING lines until Done; marked lines stay in fire order (the jump to the top is 03b's); archived stations are left out of `stationsLive`; `station_plan.fire_ms` is `number` (not nullable) |
| 6.1i | `groupReadiness(state, order_id)` → per group `{ done, waiting, hold: boolean }` | §3.4, §3 #9. *⚠️ Changed in v1.0.1 (AD-24 G1, G2, accepted):* `groupReadiness(state, order_id, now)` with a **required** `now` (the exit predicate needs it); a served line counts as done. Was: two arguments |
| 6.1j | `stationPressure(state, station_id, now)` / `stationsLive(state, now)` | §3.10; `stationsLive` = §6.5 body |
| 6.1k | `pullEarly(state, station_id, n, now)` → `FireDispatched` draft | D16 Give me more, same `max_early_ms`. *⚠️ Changed in v1.0.1 (AD-24 E1–E4, accepted; AD-29 Q12, developer ruling):* limited by `max_early_ms` only; a line that would overrun another booking is passed over, so the result is **`FireDispatched` draft \| `null`**, and `null` can come inside the limit (03b handles it); one draft, one `due_at`; `pulled` overwrites any mark but `return`. Was: always a draft |
| 6.1l | `lateStartShift(state, order_item_id, started_at)` → `ReservationsShifted \| null` | F §4.7 D42 late start |
| 6.1m | `planRelease(state, order_ids, ticks?)` / `goesWith(lineA, lineB, links)` / `capacityForLanes(station, lanes_on, lane_count)` (v0.4, G2 #1, #9: `lane_count` integer ≥ 1, an input; v0.5, G4-1 #20: `lane_units` never below 1) | §3.8, D12, §3.10 |

### Batch 2 — hub host

**6.2 Tick `fires`** (`apps/hub/src/engine-host/fires-tick.ts`; *Changed in v0.2, pre-G2 #1:* engine intents only). `due(db, state, now)`: `firesDue(…).intents_due || configStale`; sends the freeze-entry `station_plan` frames itself, outside any transaction (§3.6.3, v0.2.1); *v0.5 (G4-1 #6):* with `checkpoint_pending` set and `noOrderInEngine(state, now)` (v0.6, G4-2 #3), schedules the deferred day-close checkpoint (`setImmediate`, §3.12) and clears the flag — no statement, no transaction in `due`. `intents(tx, state, now)`:
1. `configStale` → one `EngineConfigApplied` draft and **nothing else** in this pass (§3.11, pre-G2 #4; *Changed in v0.4, G2 #22:* intents follow next pass on the folded state); clear the flag after commit.
2. `intents = getTickIntents(state, now)` (pure).
3. Fire, start, done, shift, consume drafts from the intents; `StockConsumed` from `stockEffects`; *v0.6 (G4-2 #2):* `StockReleased { reason: 'abandoned' }` for the reservations of abandoned lines.
4. Return the drafts — one transaction (D44). Post-commit: the `station_plan` frames for touched stations, and for lines that entered Next in a pass that also had intents (§3.6.3); 03b's ticket printing through its own `addAfterCommit`.

Statements per pass with work: **0** reads (state in memory) plus the appends; a pass with only freeze entries: 0 statements, no transaction, frames only (v0.2.1). Target p99 ≤ 20 ms per pass with work on the pilot box (§7.1).

> ⚠️ **Changed in v1.0.1 (AD-35 (c) / reading 24-4, owner ruling 2026-11-07; AD-33 (22), accepted; AD-35 (a), owner ruling):**
> - **`due`:** `firesDue(…).intents_due || (configStale && !backedOff)`, where `backedOff` holds after **3** catch-up attempts that did not commit and is lifted for one retry every **60 s**. While backed off with `configStale` still set, `due` is the ordinary fires rule. The freeze-entry frames are sent with `ws.sendToSessions` (§3.6.3). Was: "`firesDue(…).intents_due || configStale`".
> - **Step 1:** `configStale` (and not backed off) → one `EngineConfigApplied` draft and nothing else, in this tick's own transaction (re-selected inside it: a hook that applied the config meanwhile leaves nothing to write); clear the flag after commit. If it does not commit, the attempt counts toward the back-off. Once backed off, ordinary passes (steps 2–4) run on the folded state as it is (the pre-config state) while `configStale` stays set, and each such pass logs **one `warn` line** with the failure count, the config version in use and the one wanted (from memory, 0 statements). **No new alert kind.** Was: "`configStale` → one `EngineConfigApplied` draft and **nothing else** in this pass … intents follow next pass on the folded state".
> - The statement counts above are unchanged.

**6.2a Tick `fires_alerts`** (`apps/hub/src/engine-host/fires-alerts-tick.ts`; *new in v0.2, pre-G2 #1, #11; Changed in v0.4, G2 #4, #23*), registered right after `fires`. `due(db, state, now)`, in memory, **no statement**: `now ≥ nextAlertDueAt(state, skipped)` (§3.8), or the overload check finds a change against `overload_open` (§3.10), or the host flag `day_closed` (set after a commit that contains `BusinessDayClosed`, and at boot step 6 when `state.business_day?.closed_at ≠ null`), or the host flag `reconcile` (first pass after boot). A raised slip or overload that persists unchanged is never due again. `intents(tx, state, now)`:
1. `alerts.listOpen(tx.db, { kind: 'slip_warning' })` and `alerts.listOpen(tx.db, { kind: 'station_overload' })` — **2** statements; the second refreshes `overload_open` (and clears `reconcile`).
2. Slips: `getAlertIntents(state, now).slips` (each has `slips[key].alert_id = null` and its crossing reached) → `raiseMany` inputs (receiver per §3.8, *v0.5 G4-1 #8:* `dine_in` from 02's `tableOwners` — **one** statement for every table of the pass, or `placed_by` while stubbed; takeaway / delivery / parking from `placed_by`, no statement); inputs whose receiver is missing or whose values fail the schema are skipped, logged and added to `skipped` (§3.8).
3. Overload: raise inputs for stations red past `pressure_alert_ms` (host `red_since`, P-7) or capped and not in `overload_open`; close items for stations in it and below amber.
4. Closes: `resolved` slips `done` by their `alert_id` (state); with `day_closed`, every `slip_warning` from step 1 `obsolete` (§3.8, pre-G2 #11), then clear `day_closed`.
5. **One** `alerts.closeMany(…)`, then **one** `alerts.raiseMany(alerts.tickCtx(tx, now), inputs)` (*v0.6, G4-2 #19:* close first; 01d fixed statement count, test 35 (d)); then one `SlipWarned { …, alert_id }` draft per raised slip from the returned ids, none for a `deduped: true` result (§3.8).
6. Return the drafts — this tick's own transaction. A throw rolls back only this tick (01d isolation); fires are never affected. After commit the folds of `SlipWarned` and `AlertClosed` move `next_alert_due_at`, so the next pass is not due for the same keys.

Statements per pass with work: 2 (`listOpen`) + ≤ 1 (`tableOwners`) + 01d's `raiseMany` and `closeMany` bounds; 0 and no transaction when not due — including while a raised slip or overload persists unchanged (v0.4, G2 #4; test 93).

> ⚠️ **Changed in v1.0.1 (AD-37 (1), owner ruling 2026-11-08; AD-37 (8), proposed (not yet ruled)):** statements per pass with work = **2 (`listOpen`) + ≤ 1 (`tableOwners`) + ≤ 1 line facts + 01d's `raiseMany` and `closeMany` bounds**. The slip card's `details` need each line's `name`, which the engine state does not hold (no line names, `item_id` or `category_id` go into `EngineState`; no §3.3 or snapshot change). So a pass that raises a slip reads the slip orders' `ItemAdded` rows **once** for every slip of the pass (`stream_type = 'order' AND event_type = 'ItemAdded' AND stream_id IN (…)`, served by `events_stream`). **The facts read has no `branch_id` predicate** (one branch per hub). Today the bound is met numerically only because `tableOwners` is stubbed (0 statements); once 02 lands, a pass with a `dine_in` slip costs 2 + 1 + 1 + 01d. 02p task 0 carries this into 03a v1.2 with its reader pair (§4.3 To 02p). Was: "2 (`listOpen`) + ≤ 1 (`tableOwners`) + 01d's … bounds".
>
> ⚠️ **Changed in v1.0.1 (AD-33 (22a), accepted; AD-8 developer condition):** step 2 also raises the queued `engine_line_dropped` alerts (§4.2), one per dropped id, keyed `engine_line_dropped:<order_id>:<order_item_id>` (a refused batch: one key per listed id); the queue is re-filled at boot (§3.12 step 6) and flushed on SIGTERM. Step 5's closes are appended before `raiseMany`, so a slip carried over the day close is a new alert (as written).

**6.3 Boot steps** (`apps/hub/src/engine-host/boot-steps.ts`, replacing 01a's step-3 registration). Step 2: snapshot / checkpoint load (§3.12, 2 statements). Step 3: four replay statements, merge, fold; `ctx.initialState`; two `stock_version` reads (§3.12, v0.2 pre-G2 #3). Step 6 (*Changed in v0.4, G2 #6, #23*): `ctx.missedFires` from a dry `getTickIntents(ctx.initialState, ctx.clock.branchNow())` (no write; `ctx.clock` from 00 row H-1); `configStale` (§3.11); the `day_closed` and `reconcile` flags of 6.2a. Also the snapshot writer (`writer.addAfterCommit` schedules it with `setImmediate` when a 500-event multiple is crossed, v0.2 pre-G2 #38; SIGTERM via `app.addHook('onClose')`, before the database closes; *⚠️ Changed in v1.0.1 (AD-33 (21), accepted):* SIGTERM via `process.once('SIGTERM')`, which flushes the dropped-line queue, writes the snapshot while the writer is open, then closes; was: `app.addHook('onClose')`) and the checkpoint writer (after a commit containing `BusinessDayClosed` when `noOrderInEngine(state, recorded_at)` holds, v0.6; `last_seq` = that commit's last seq, body with `business_day`, v0.4 G2 #5; *v0.5, G4-1 #6:* otherwise `checkpoint_pending`, written when the `fires` tick's `due` first finds `noOrderInEngine(state, now)` (v0.6, G4-2 #3), cleared by a `BusinessDayOpened` commit, set at step 6 from the step-2 checkpoint's `taken_at`), and the one fresh snapshot after a boot that loaded no current-version snapshot (F §5.8, v0.4 G2 #17). A failing step stops boot (00 §3.8).

**6.4 Kinds and hook.** `defineAlertKind` for `slip_warning` (§3.8) and `station_overload` (§3.10) at module load; `onBranchConfigApplied` (§3.11, 0 extra statements: reads `next` and the state). Audiences: `EngineConfigApplied`, `StationCapacitySet`, `StationPauseSet` → every staff and station socket; no audience on order-stream events (01d run 3 §4). Catch-up parts `stations_live` (staff and station sockets; body = §6.5; 0 statements) and `station_plan` (§3.6.3; 0 statements); frame `station_plan` (same audience as its catch-up part: that station's station sockets and every staff socket, v0.4 G2 #19) added to the `WsServerMessage` union (F §6.5; v0.2, pre-G2 #12).

> ⚠️ **Changed in v1.0.1:**
> - **Kinds** (task 23): `slip_warning`, `station_overload` and `engine_line_dropped` (§4.2; AD-8 developer condition, developer ruling; AD-37 (7), proposed (not yet ruled)). They are registered in `engine-host/kinds.ts`; the test fakes moved there.
> - **Slip `apply` statements** (AD-22, accepted; as built, per AD-22; the §12.2 count **confirmed by the owner 2026-11-08**, following AD-37 (1)): the `slip_warning` accept `apply` makes **1 read** (the slip orders' `ItemAdded`: `item_id`, `category_id`) when goes-with links exist and the slip has a released and an open line, **else 0** (§3.8). `decline` reads nothing. Was: "0 extra statements" for this row (§12.2 row 6.4: 0).
> - **Stock frames** (AD-32 (1), developer ruling): `StockReserved`, `StockReleased` and `StockConsumed` frames go to every staff socket of the branch.
> - **Plan frames** (AD-35 (a), owner ruling): sent with `ws.sendToSessions`, with the payload filter of §3.6.3.
> - **Registration** (AD-34 (1), developer ruling): commands 25 / 25b stay registered in `server.ts`; the station-stream audiences live in `ws/engine-audiences.ts`. No contract change.

### Batch 3 — commands and query

#### 6.5 `GET /queries/stations-live`

Session: device, `session: 'required'`, `allowStation: true`, `countsAsActivity: false`. Query: `{ station_ids?: string[] (≤ 50) }`. **0 SQL statements** (in-memory state). Response `200`:

```json
{ "data": { "as_of_seq": 48211, "now_ms": 1793722800000, "stations": [
  { "station_id": "01JC…S3", "name": "Tandoor", "capacity": 30, "capacity_override": null,
    "effective_capacity": 30, "paused": false, "pause_enabled": false,
    "pressure_bp": 12500, "band": "red", "later_count": 14, "wait_ms": 1080000 } ] } }
```

`wait_ms` = time until one unit with the station's `reference_cook_ms` (§3.11, defined in v0.4 G2 #24) can start (§4.3 To 02 tile). Errors: `400 VALIDATION_FAILED`; unknown ids are left out (a read).

#### 6.6 `POST /commands/set-station-capacity` (`SetStationCapacity`)

*Changed in v0.2 (pre-G2 #17):* `defineCommand({ sessionKind: 'device', stationScoped: true, permission: 'manage-stations', … })` — the 00 M30 pattern: a **station session** (KDS) may send it for **its own** `station_id` with `reason: 'lane_off' | 'lane_on'` only; its events carry `actor_id = null` and the KDS `device_id`. A **staff session** needs `manage-stations` (scope `my_stations` through `run_station`, B-4, checked last, C8). Payload `{ station_id, capacity_override: int 1–100 | null, reason: 'manager' | 'lane_off' | 'lane_on' }` (*Changed in v0.4, G2 #15:* 01a's station `capacity` range 1–100, 01a v2.0.1; was 1–999). Script (subset of 00 §3.7):
1. Schema → `400 VALIDATION_FAILED`.
2. `BEGIN IMMEDIATE`; idempotency re-check (D32).
3. Station in `state.stations` and not archived → else `404 STATION_NOT_FOUND`.
4. Station session: `station_id ≠ actor.stationId` or `reason = 'manager'` → `403 PERMISSION_DENIED { reason: 'outside_scope' }`; *v0.5 (G4-1 #20):* then `capacity_override > station.capacity` (the configured value) → `400 VALIDATION_FAILED { field: 'capacity_override' }`. Staff session: scope → `403 PERMISSION_DENIED { reason: 'outside_scope' }`.
5. Same as current → no event, `200 { changed: false }`.
6. Append `StationCapacitySet`; reducer re-plans (D37); COMMIT; swap (D45).
7. `200 { data: { station_id, effective_capacity, pressure_bp, band, changed: true } }`.

*Changed in v0.4 (G2 #20):* step 5 answers with the **same shape**, `200 { data: { station_id, effective_capacity, pressure_bp, band, changed: false } }`, so a client reads one body (F §6.1 envelope).

Retransmit returns the stored response (D32). COMMIT failure leaves the live state untouched (D45, test 68). Slips for displaced orders are written by the next tick (≤ 500 ms).

> ⚠️ **Changed in v1.0.1 (AD-34 (2)–(4), developer rulings):** to answer step 7's `effective_capacity`, `pressure_bp` and `band`, the handler folds its own appended `StationCapacitySet` with `applyEvents(ctx.state, appended, { strict: false })`; the writer's reducer then folds the same event again. So **a capacity change re-plans twice** (same result; accepted, a cost only). `appendEvents` returns early when there is nothing to append (no `MAX(seq)` read, the step-5 no-op), and the statement test asserts an exact count. Was: step 6 "reducer re-plans (D37)", once.

#### 6.7 `POST /commands/set-station-pause` (`SetStationPause`)

Permission `manage-stations`, staff sessions only (`stationScoped: false`; a KDS does not pause its station). Payload `{ station_id, paused: boolean }`. Script: 1–3 as 6.6; `paused: true` and `pause_enabled = false` → `409 STATION_PAUSE_DISABLED { station_id }`; **then** the scope check → `403 outside_scope` (C8: scope last; *Changed in v0.2, pre-G2 #24*); same as current → `200 { data: { station_id, paused, changed: false } }` (one shape, v0.4 G2 #20); append `StationPauseSet`; `200 { data: { station_id, paused, changed: true } }`. Unpausing is always allowed.

---

## §7. Cross-cutting (this module only)

### 7.1 Performance targets (D24–D27, R6)

| Path | Target | Measured by |
|---|---|---|
| Re-plan per submit (`planOrder` + the `applyEvent` re-plan), inside the writer lock | **p99 ≤ 50 ms** on the pilot box, for full re-placement (*v0.6, G4-2 #6:* the algorithm of §3.5.3) (00's 5 ms no-op budget stays for other commands) | §10.6 CI test + manual check on the pilot mini PC (as 01d #58) |
| Lines re-placed in one submit re-plan (D25 prune + freeze) | *Changed in v0.5 (G4-1 #1):* **no bound asserted here.** It is measured by the drill (D27; the Python figure is in §10.6), and the CI bound is set in the plan from the TypeScript simulator's first run. The bound that gates is the 50 ms p99 above. *Changed in v0.6 (G4-2 #6):* full re-placement (§3.5.3) is **the** algorithm, and the 50 ms p99 gates it; the plan cannot change it. If task 18 misses the gate, the build stops and the spec is bumped first (incremental insertion is deferred, §12.5). *⚠️ Changed in v1.0.1 (P-11, proposed (not yet ruled)):* the plan's rule is `ceil(1.2 × measured p99 / 10) × 10`; task 18 measured p50 23 / p99 223 / max 240 on the normal peak day, so the CI bound is **≤ 270**, asserted in the perf project since task 18f (`6e92e59`) | §10.6 drill, plan |
| Overload pass (§3.5.6) | ≤ 16 probes; p99 ≤ 50 ms included | §10.6 overload day |
| Fires tick pass with work | p99 ≤ 20 ms; idle `due` no statement | test 62 |
| `fires_alerts` pass with work (v0.2) | p99 ≤ 20 ms; not due → no statement and no transaction, also while a raised condition persists (v0.4, G2 #4) | tests 76, 93 |
| Snapshot write (v0.2, pre-G2 #38) | ≤ 50 ms at design size, off the response path | §10.6 |
| Crash restart (≤ 500 events) | ≤ 2 s for steps 2–3 | test 64 |
| Full replay from the day-close checkpoint (≈ 66k events) | ≤ 45 s (inside 90 s; D26 est. 40–50 s). *⚠️ Changed in v1.0.1 (AD-26, accepted; AD-27, developer ruling):* measured on AD-27's normal peak day at **38 303 events** (−14.9 % on R6's ≈ 45k replayed events, inside R6 ± 20 %), not ≈ 66k: the drill's 65.9k counted 2 events per line. Fold cost grows with state size, so the 11.5 s is not scaled linearly to 66k. Was: "≈ 66k events" | §10.6 |
| Replay of 2 days (a deferred checkpoint that was never written, §3.12; version bump in the maintenance hour only; v0.5, G4-1 #6) | ≤ 80 s for steps 2–3 (*v0.6, G4-2 #22:* the 90 s boot budget minus ≈ 10 s for steps 4–8, measured in task 28) | §10.6 (2-day fixture) |
| `slip_due` / `next_alert_due_at` upkeep (v0.5, G4-1 #15) | O(lines of the touched keys) + O(open keys) per fold (v0.6, G4-2 #20); inside the re-plan budget; no per-event scan in replay. *⚠️ Changed in v1.0.1 (AD-26, accepted; AD-29 Q4, developer ruling: word it here, no index):* **as built this bound is not fully met**: a fold that changes an in-flight line still passes over all lines once (BF-14 (b); `EngineState` v3 has no index, and an index is a spec-first §3.3 change), and `ordersByKey` is O(open orders). The replay and re-plan targets pass without it (below) | §10.6 replay time |
| `stations-live` | 0 statements; ≤ 5 ms | test 66 |

A re-plan slower than 50 ms is logged at `warn` `{ event_type, station_id, lines, ms }` (no payload).

> ⚠️ **Changed in v1.0.1 — as built, measured (AD-27, AD-29 Q1, AD-32 (4), developer rulings; P-11, proposed (not yet ruled)).** Every number below is from the **dev laptop** (i7-4900MQ), never the pilot box: **the pilot-box column is still open** (task 28, DoD 2). The perf project runs **only via `pnpm test:perf`** inside a clean measurement (AD-32 (4)), not in `pnpm -w test`. Engine rows: the one official run on AD-27's **normal peak day**, seed 7, head `91cc555`, 2026-11-07, other lanes idle, engine only. Host rows (fires, `fires_alerts`, `stations-live`, BF-7 again): the batch 8 clean run, head `3eee52b`.
>
> | Path | Target | CI (dev laptop) | Pilot box (task 28) |
> |---|---|---|---|
> | Re-plan per submit p99 | ≤ 50 ms | **pass 10.6 ms** (p50 3.5, max 20.6; n 2 000); overload day p99 8.9; batch 8 clean run 9.5 | open |
> | Lines re-placed per station re-plan p50 / p99 / max | reported; P-11 bound | 23 / 223 / 240 (n 5 401); overload day 39 / 360 / 385 | open |
> | Re-placed-lines bound asserted (P-11) | `ceil(1.2 × p99 / 10) × 10` | 270, asserted since task 18f (`6e92e59`) | — |
> | Overload day (tandoor 125 % for one hour): probes / p99 | ≤ 16 / ≤ 50 ms | **pass** max 7 probes (355 searches) / **pass** 8.9 ms (max 55.6) | open |
> | 20-line `StockAdded` at peak (BF-7) | inside 50 ms | **pass** max 39.8 ms (p50 37.1; n 21); batch 8 clean run max 38.7 ms | open |
> | Snapshot serialise / full write | ≤ 50 ms | **pass** max 4.8 ms (0.90 MB, 1 126 lines at peak) / full write **pass** in the batch 8 clean run (`snapshots.perf.test.ts`, every sample ≤ 50 ms) | open |
> | Full-day replay from a checkpoint | ≤ 45 s | **pass** 11.5 s (38 303 events, 0.30 ms per event) | open |
> | 2-day replay (steps 2–3) | ≤ 80 s | **pass** 26.0 s (76 457 events; engine fold only, no SQLite read) | open |
> | Events replayed per day | ≈ R6 ± 20 % | pass: 38 304 (−14.9 % on R6's 45k, AD-26) | — |
> | Live = replayed (generated day) | equal | pass: end state and 76 mid-day digests equal; `applyEvents` = per-event fold | — |
> | `fires` pass with work p99 | ≤ 20 ms | **pass** 11.2 ms (p50 9.4; 31 passes; hub write + COMMIT; 475 unfired, 4 drafts / pass) | open |
> | `fires_alerts` pass with work p99 | ≤ 20 ms | **pass** 10.6 ms (p50 7.3; 31 raise passes, 10 drafts each); idle `due` p99 2.2 ms (0 statements) | open |
> | Crash restart ≤ 500 events (steps 2–3) | ≤ 2 s | test 64 (hub) | open |
> | `stations-live` | ≤ 5 ms, 0 statements | **pass** max 2.5 ms (p50 0.5; 98 in flight at the peak); 0 statements (test 66) | open |
> | Boot steps 4–8 | ≈ 10 s budget | — | open |
> | `events_branch_stream` build over a month | ≈ 1 s / month | — | open |
>
> What these numbers do not say: one seed (report-only runs on seeds 8 and 11, AD-29 Q2); a day with one 125 % hour, not sustained overload; the `fires_alerts` line-facts read (AD-37 (1)) is not timed at the peak, because the simulator's orders have no `placed_by`.

### 7.2 Logging

Tick errors as 01d (`{ tick: 'fires', err }`). *Changed in v0.6.2 (G4-3 #3):* a stock invariant breach (§3.7) is logged at `warn` as `{ event_id, stock_item_id, on_hand, reserved }` (values before the fold) by the reporter the host passes to `applyEvent`, both live and at boot replay (a replayed breach is logged again, with `replay: true`); it never throws and never rolls back a transaction. Boot logs `{ step, snapshot_seq, checkpoint_seq, events_replayed, ms }`. No order contents in logs.

> ⚠️ **Changed in v1.0.1 (AD-6, developer ruling; AD-33, accepted; AD-35 (c), owner ruling; AD-37 (5), proposed (not yet ruled)):** the breach `warn` is built from `state.diagnostics` (AD-6), which the host logs after commit and clears, live and at boot (`replay: true`); the same path logs `invalid_event`, `reserve_fallback` (deduped) and dropped lines (AD-8). Also logged: the AD-4 over-size `warn`; the catch-up back-off `warn` per pass (§6.2); a slip whose `details` fail the schema, `details_invalid`. The slip card's `details` (line names) are never logged (01d §7). Was: "by the reporter the host passes to `applyEvent`".

### 7.3 Folder placement (F §6.9)

`packages/engine/src/{state,profile,plan,replan,overload,route,tick,stock,slip,pressure,view,checkpoint}.ts`; `packages/engine/test/sim/` (harness, generated day); `packages/events/src/events/{order,station,stock}/`; `apps/hub/src/engine-host/{fires-tick,fires-alerts-tick,station-plan,boot-steps,snapshots,kinds,config-hook}.ts`; `apps/hub/src/commands/{set-station-capacity,set-station-pause}.ts`; `apps/hub/src/queries/stations-live.ts`; migration `apps/hub/src/db/migrations/0007_engine.sql`.

> ⚠️ **Changed in v1.0.1 (as built; plan P-6, approved with the plan; AD-34 (1), developer ruling; P-12, proposed (not yet ruled)):** the host also has `apps/hub/src/engine-host/{index,host-flags,reducer,replay}.ts` (P-6: `registerEngineHost`, the in-memory flags, the reducer, the replay filter); the station-stream audiences are in `apps/hub/src/ws/engine-audiences.ts`; commands 25 / 25b are registered in `server.ts`. `packages/engine/test/sim/index.ts` is exported as `@pos/engine/sim` for tests only. Was: the list above.

### 7.4 Not added (YAGNI)

No re-plan events (D13); no load snapshot field (K11/K12, 03a-g0 §2); no persisted pressure (pure); no projection table; no cache.

---

## §8. Client contract

03a has no screens. For clients of 02 / 03b / 07:
1. Show `promise_ms` to people; `target_land_ms` is internal (D6).
2. Station tiles and strips read the `stations_live` catch-up part and `GET /queries/stations-live`; refresh on the three station-stream frames and every 30 s while visible.
3. Bands: green / amber / red from `band`; red on an item tile = "tell the customer" (D20).
4. `slip_warning` cards follow 01d §8 (answer buttons from the kind's labels; minutes late against the promise).
   > ⚠️ **Changed in v1.0.1 (AD-37 (3), owner ruling 2026-11-08):** minutes late against the **engine target** (`minutes_late`, §3.8); the card text is **"≈ N min late"** (`alerts.minutes_late`, en and ur; the Urdu string still needs native review, 01d urdu-todo). The card shows `details.lines` (name, quantity, state) on the signed-in card only (01d v1.1.2). Was: "minutes late against the promise".
5. i18n keys `alert.slip_warning.*`, `alert.station_overload.*`, `errors.STATION_PAUSED`, `errors.STATION_PAUSE_DISABLED`.

---

## §9. Error catalogue additions

| Code | Status | `details` | Returned when |
|---|---|---|---|
| `STATION_PAUSED` | 409 | `{ station_id }` | a submit (02) or addition routes a line only to a paused station (D21) |
| `STATION_PAUSE_DISABLED` | 409 | `{ station_id }` | `SetStationPause { paused: true }` on a station with `pause_enabled = false` |
| `ORDER_NOT_IN_ENGINE` | 409 | `{ order_id }` | **02's** `ReturnToKitchen` for an order that has left the engine state (§3.3: exited at a day close, or 30 min after its last line was served; *⚠️ Changed in v1.0.1 (BF-11):* **or abandoned**, with no tap on any line for `order_abandon_ms` (§3.3 abandon exit); was: the two exits only); defined here because the rule is 03a's (v0.2, pre-G2 #2). *Changed in v0.5 (G4-1 #7):* **only** `ReturnToKitchen`; an addition to an exited order is a new order, never this code; 02's screen says "This order is closed" |
| `RETURN_ALREADY_OPEN` | 409 | `{ order_item_id, return_order_item_id }` | *New in v0.5 (G4-1 #19):* 02's `ReturnToKitchen` on a served line that already has a return line (`return_of.order_item_id` = it) not yet `served` |

Reused: `400 VALIDATION_FAILED`, `403 PERMISSION_DENIED { reason: 'outside_scope' }`, `404 STATION_NOT_FOUND`. The four new codes (v0.5: + `RETURN_ALREADY_OPEN`) are appended to F §6.2 and `@pos/domain/src/errors.ts` (no foundation bump, R34).

---

## §10. Tests

Numbers 1–15 are F §4.7's required engine tests, kept and adapted to `EngineState` v3; F test 11 asserts the slip on the next `getAlertIntents`, not in the capacity event (§4.5 F-17; v0.2, pre-G2 #33). Test names cite their numbers (F §6.7).

### 10.1 Engine — pure (`packages/engine/test/`)

| # | Case |
|---|---|
| 16 | Units: "Roti ×4" holds 4 slots; capacity 30 with 28 used → the line waits (P-1) |
| 17 | Target and promise: `P = T + padding`; FIFO / EDF stations padding 0 (D6, D3) |
| 18 | Promise travels in `OrderPlaced`; `applyEvent` stores it and never recomputes (P-2) |
| 19 | Plan at the last listed `ItemAdded`, not before; deal line never placed (01c §3.4.7) |
| 20 | Re-plan pass 1 keeps an older line's `keep`: a newer order cannot push it past `d − keep` (D6) |
| 21 | Re-plan moves an older hidden line within slack; frozen and fired lines do not move (D13, D15) |
| 22 | Freeze evaluated at `recorded_at`, never a clock (D13) |
| 23 | Prune: lines ending before the pivot are fixed input (D25). *Changed in v0.5 (G4-1 #1):* the pivot is `earliestPossible` (§3.5.3). On the fixture, and as a property over 50 seeds, the pruned re-plan keeps on time every line the unpruned one keeps on time, gives every new order `T_pruned ≤ T_unpruned` (*v0.6, G4-2 #7:* not equality), and never exceeds capacity; the pivot is computed from fire times (G4-2 #8) |
| 24 | FIFO: earliest fit in submit order, no hold (D3) |
| 25 | EDF = Waada Guard with weights 100, keep 0, padding 0 (D3) |
| 26 | Overload: weight-2 line carries half the lateness of a weight-1 line on one slot (D5) |
| 27 | `max_late_ms` cap: line not shifted past the cap; overload flagged (D3, D20) |
| 28 | Routing: earliest arrival wins; gain < `min_gain_ms` → home; carry adds; `max_carry_ms` filters (D8, D9) |
| 29 | Reserve units usable only by home order types (D8) |
| 30 | Re-route only hidden lines (D10) |
| 31 | Delivery: `T = max(pickup, ETA)` (D3) |
| 32 | Auto-fill fires from Next within `max_early_ms`; urgent (slack ≤ keep) first, then `w × waiting` (D16) |
| 33 | `pullEarly` respects `max_early_ms`; `reason: 'pulled'` (D16) |
| 34 | Boost: earliest fit; displaced lines late → slip intents; boosted promise unchanged (D4) |
| 35 | Slip threshold from the target, not the promise (D11) |
| 36 | Slip grouped per table key; re-raise only after +threshold and the previous alert closed (`slips[key].alert_id = null` after its `AlertClosed` fold; v0.4 G2 #4) (§3 #7, D44) |
| 37 | `ItemsReleased`: released leave the group; expedite immediate with follow-up weight; rest stay sync (D11, D12) |
| 38 | `goesWith`: category default, item add, item exclude; nothing configured → nothing pre-ticked (D12) |
| 39 | Stock: every draw must fit; `sold_out` at 0 refused; `cook_fresh` full cook time (01c §3.5.2, S32) |
| 40 | Recount below reserved releases the most recent units; those lines re-plan at full cook time (S14 v0.6). *v0.6 (G4-2 #5):* hidden lines only, with every draw of a released line on every stock item; a frozen and a fired reserved line are kept, and the `StockSet` leaves `on_hand < reserved` by exactly their units; any other excess is folded as counted and reported as a breach, never thrown (*v0.6.2, G4-3 #3*); a released batch line returns to its `program_id`; the re-plan runs once, at the `StockSet`, after the releases |
| 41 | `StockConsumed` at start moves units out of `on_hand` and `reserved`; never below 0 (P-5); *v0.6.2 (G4-3 #3):* a consume past `on_hand` clamps at 0, reports one breach and commits |
| 42 | *⚠️ Changed in v1.0.1 (BF-11; built in task 12b):* the first clause reads "with no from-stock line carried over the close (every reservation is a hidden line's), every reservation was released `day_closed` …"; the close releases hidden lines only since v0.6. Was the text below. *Changed in v0.4 (G2 #21):* day close then day open with a unit change: every reservation was released `day_closed` in the close commit, `reserved = 0` at the open, and `stockEffects(BusinessDayOpened)` returns `[]` (no `unit_changed` path, S44); *v0.5.1:* with no fired from-stock line carried over the close; *v0.6 (Q14 closed):* with a fired and a frozen from-stock line carried over the close, a unit-changing `StockSet` at the open is preceded by their `StockConsumed`, the entry enters the new unit with `reserved = 0`, and their later `ItemStarted` drafts no `StockConsumed` |
| 43 | Weighed line with pending weight: 1 unit, item cook time, fired normally (V18) |
| 44 | Batch: program cook times from the line copies (B1); `max_early_ms` caps freshness per line (D3) |
| 45 | Capacity change re-plans the station (D37). *Changed in v0.5 (G4-1 #5):* frozen lines are re-placed too (the D15 exception), moved ones are marked `moved`, fired and COOKING lines stay fixed, and nothing is booked over the new capacity |
| 46 | *Changed in v0.4 (G2 #9):* `capacityForLanes(station, lanes_on, lane_count)`: `lane_units` set → `max(1, min(capacity, lanes_on × lane_units))`; `lane_units` null → `lane_units = floor(capacity ÷ lane_count)`, same clamp; `lane_count = 1` → `lanes_on × capacity` clamped; integers only (§3 #5, §3.10) |
| 47 | Pause: `checkOrderable` refuses; open lines continue (D21) |
| 48 | Pressure bands from the profile; pure in `(state, now)` (D20) |
| 49 | Exit on all served / voided / removed and at day close (§3 #11); *v0.4 (G2 #13):* `isOrderInEngine` false from `last_served_at + 1 800 000`; a void or remove that leaves no open line starts the window; *v0.5 (G4-1 #6); Changed in v0.6 (G4-2 #10, Q13):* at `BusinessDayClosed`, an order with any unserved line (unfired included) stays and exits later, by the 30-min rule or the abandon rule; an order whose lines are all served / voided / removed / returned exits |
| 50 | READY = every sync line done; hold at pass for a done line with an undone sibling (§3 #9) |
| 51 | `ItemDoneUndone` returns the line to COOKING and its occupancy (D16) |
| 52 | Inferred start / done per `completion_mode` (D60) |
| 53 | `EngineConfigApplied`: capacity change re-plans; cook-time change affects new orders only; archived station lines complete (§3.11) |
| 54 | Station-type change keeps open lines as fixed input (§3.11) |
| 55 | Checkpoint round trip: `fromCheckpoint(checkpoint)` + one day = full replay from seq 0 (D26). *Changed in v0.4 (G2 #5):* (a) a boot from the checkpoint **at night** (after the close, before the next open) equals a full replay, `business_day` included; (b) a checkpoint whose commit carries `BusinessDayClosed` and its `StockReleased { day_closed }` (*v0.6, G4-2 #4:* the releases first, then `BusinessDayClosed`) boots cleanly: `last_seq` = the commit's last seq, the releases are not folded twice, `reserved` stays ≥ 0 |
| 56 | Snapshot fixture: state shape or `applyEvent` meaning changed without bumping `ENGINE_STATE_VERSION` fails (D62, F §6.7) |

### 10.2 Hub

| # | Case |
|---|---|
| 57 | Boot: snapshot v3 loaded; v2 snapshot skipped → checkpoint → one-day replay; no checkpoint → seq 0 |
| 58 | Replay reads only the four filtered streams; `audit` and other order-stream alerts are skipped; uses `events_branch_stream` (`EXPLAIN QUERY PLAN`) |
| 59 | Live state equals replayed state after a mixed day (property, 50 seeds) |
| 60 | Missed fires: step 6 writes nothing; `HubStarted.missed_fires` = dry count; first tick dispatches them with `reason: 'scheduled'` and `due_at` before `HubStarted.hub_up_at` (v0.5, G4-1 #16: no `'missed'` reason); fired-before-outage lines not re-fired (§3 #3, F test 13) |
| 61 | Snapshot every 500 events and on SIGTERM; **keep 2** (v0.4, pre-G2 #37 closed, G2 #8); older versions deleted; `last_seq` and state read in the same `setImmediate` callback; one fresh snapshot after a boot that loaded no current-version snapshot (F §5.8, G2 #17); step 2 reads `LIMIT 2` and falls back to the second row when the newest is torn; the day-close checkpoint writer keeps 2 (G2 #13) |
| 62 | Tick `fires`: idle pass opens no transaction and runs no statement; a pass with work is one transaction with **0 reads plus the appends** (v0.4, G2 #10); *v0.6 (G4-2 #9):* property over 50 seeds, `getTickIntents(state, nextDueAt(state))` is non-empty; during an overrun `fires` is due only at each `cascade_step_ms` boundary |
| 63 | Tick isolation: a throw in `fires.intents` rolls back only the fires tick; 01d's tick still runs |
| 64 | Crash restart of 500 events ≤ 2 s (steps 2–3) |
| 65 | `slip_warning`: raised to the receiver (stub `placed_by`); step 1 escalates to managers at `escalate_ms`; accept → `ItemsReleased` with `alert_id`; decline → nothing; `apply` writes nothing (read-only view); answered by a non-receiver → `403 not_receiver`; *v0.5 (G4-1 #8):* a `dine_in` slip goes to the `tableOwners` owner, a `delivery` (and a `takeaway`, a `parking`) slip to `placed_by`, also with 02's `tableOwners` present; `placed_by = null` → skipped and logged |
| 66 | `stations-live`: 0 statements; body matches `stationsLive`; *v0.4 (G2 #13):* `station_ids` with 51 ids or a non-string → `400 VALIDATION_FAILED` (F §6.7, one test per code) |
| 67 | `station_overload`: raised after red for `pressure_alert_ms`; deduped; closed below amber; *v0.4 (G2 #4):* while it stays red after the raise, no pass is due; after a restart the `reconcile` pass rebuilds `overload_open` and a station below amber is closed `done` |
| 68 | `set-station-capacity`: happy; `400`; `404 STATION_NOT_FOUND`; `403 outside_scope`; no-op; retransmit (D32); COMMIT failure leaves the live state (D45); **station session** for its own station with `lane_off` → `200`, `actor_id` null, the KDS `device_id`; for another station or with `reason: 'manager'` → `403 outside_scope` (v0.2, pre-G2 #17) |
| 69 | `set-station-pause`: happy; `400`; `404 STATION_NOT_FOUND`; `409 STATION_PAUSE_DISABLED` before `403 outside_scope` (C8); `403 outside_scope`; a station session → `403`; unpause always; retransmit; COMMIT failure (v0.2, pre-G2 #24, #25) |
| 70 | `onBranchConfigApplied`: one `EngineConfigApplied` only when the engine part changed; never throws on any valid config (fuzz over the V3 builder). *⚠️ Changed in v1.0.1 (AD-35 24-1, accepted; owner):* "the engine part" = E() **including `config_version`**, so every forward config apply writes one `EngineConfigApplied`, a price-only one too; its fold re-plans nothing and frames nothing. "A price change → none" holds only at an equal `config_version`. Was: "only when the engine part changed" |

### 10.3 Concurrency and races

| # | Case |
|---|---|
| 71 | A submit and the fires tick in the same 500 ms: the tick's `intents` re-select inside its transaction; no double fire |
| 72 | Slip `accept` answered after the last line went Done: `ItemsReleased` with `released` only; tick close is a no-op |
| 73 | Capacity change between `due` and `intents`: intents computed on the new state |
| 74 | Two submits claiming the last stock unit: second gets full cook time (`cook_fresh`) or refusal (`sold_out`) (E1 stock AC4) |

### 10.3a Added in v0.2 (pre-G2)

| # | Case |
|---|---|
| 76 | `fires_alerts` isolation: a slip candidate with no resolvable receiver, and one whose values fail the schema, are skipped and logged; the same pass's fires commit; a throwing `raiseMany` rolls back only `fires_alerts`; the alert follows on a later pass (one-tick lag) (#1) |
| 77 | *Changed in v0.4 (G2 #4):* `SlipWarned.alert_id` equals the id `raiseMany` returned and `AlertRaised.values.table_key` equals its key; its `AlertClosed` sets `slips[key].alert_id = null`; an `AlertClosed` of another alert leaves the state identical; re-raise only with `alert_id = null` and +threshold (#1) |
| 78 | Exit: an order stays 30 min after its last line is served; *Changed in v0.4 (G2 #3):* every reader treats it as gone from `last_served_at + 1 800 000` (`isOrderInEngine`), physical removal happens at the next **listed** event; an unrelated `audit` event and an `AlertSeen` past the deadline change nothing, so live = replay; a return inside the window re-opens it (also when the handler's `now` is inside and the batch's `recorded_at` a few ms past); after it → `409 ORDER_NOT_IN_ENGINE` (fixture of 02); an `OrderLinesAdded` for an absent order throws (#2) |
| 79 | Config catch-up: a hub with an applied config and no `EngineConfigApplied` writes one in the first `fires` pass; nothing when equal (#4) |
| 80 | `fix` return: `cook_ms_override` from the event; a config change of `adjust_time_ms` after the event does not change a replay; `max_carry_ms` from the line drives re-routing (#5, #6) |
| 81 | Deterministic ids: group ids `order_id:0…`; a split takes `next_group_index`; a load id `station_id:<earliest order_item_id>` before firing and the `FireDispatched.load_id` after; the id stays when its naming line is voided before the fire (v0.2.1); snapshot + replay = full replay (#7) |
| 82 | Day close: every open `slip_warning` closed `obsolete` in the first `fires_alerts` pass after `BusinessDayClosed` (#11); *v0.4 (G2 #23):* also when the hub restarts between the close and that pass (boot step 6 sets `day_closed`) |
| 83 | `station_plan`: catch-up body per station; one frame per changed station after a commit; a frame when a line enters Next, **sent from `due` with no transaction and no statement** when nothing else is due (v0.2.1), and from the after-commit hook when intents are due, never twice in one pass; none for an unchanged station; a station session sees only its station (#12). *⚠️ Changed in v1.0.1 (AD-35 (b), owner ruling):* "none for an unchanged station" means **no frame when nothing visible changed**: a frame only when `{ station_id, lines }` differs from the last one sent to that station (an expedite on a frozen line frames; a Start on a fired line does not); sent with `sendToSessions`, never to an alert-mode socket (AD-35 (a)). Was: "none for an unchanged station" |
| 84 | Move to stock: `stockEffects(ItemMovedToStock)` → `StockReleased { reason: 'moved' }` + `StockAdded { reason: 'moved' }` per draw; none without a draw; `StockAdded` without `reason` still parses (#13) |
| 85 | `stock_version` after a snapshot boot equals a full-scan value, including `ItemMadeUnavailable` and the new stock events (#3) |
| 86 | Idle: over 60 s of an idle kitchen in which lines enter Next, neither `fires` nor `fires_alerts` opens a transaction (01d idle rule, no exception; #23, v0.2.1); *v0.4 (G2 #4):* also over 60 s of a kitchen with one raised slip and one raised overload that persist unchanged |
| 75 | **Return to kitchen (D28, §3.8a):** `fix` on a served from-stock line → one new immediate line, `cook_ms = adjust_time_ms`, no `StockReserved`, `mark: 'return'`, placed within others' slack (no deadline crosses); `remake` → `ItemReturned` exits the served line and the new line uses the normal cook time; with `returns_boost` the new line displaces and the displaced order slips; a return on a line not `served` is refused by 02 (fixture) |

### 10.3b Added in v0.4 (G2)

| # | Case |
|---|---|
| 87 | **`StockAdded` reserves for waiting lines (G2 #7; restored in v0.6.1):** three unfired `from_stock = false` lines drawing on one stock item, deadlines d1 < d2 < d3, a fourth already fired, a return line; `StockAdded` covering two lines → `stockEffects` gives `StockReserved` for the d1 and d2 lines only (deadline order; a line whose draws do not all fit is skipped and the next tried); folding them sets `from_stock`, `cook_ms = stock_cook_ms` and re-plans the station (the lines fire later, land on the same `T`); the fired line and the return line are untouched; replay = live. *v0.6.1:* a batch line in a hidden load switches to its copied `stock_program_id` and lands in a load of that program; a batch line in a frozen or fired load is not a candidate; *v0.6.2 (G4-3 #4):* a **frozen** slot line with the earliest deadline is skipped and the next hidden line is reserved |
| 88 | `stockEffects` per trigger (G2 #13): `ItemRemoved` → `StockReleased { removed }` per draw of the line; `ItemVoided { units }` → `voided` for those units only (01c §3.4.8); `BusinessDayClosed` → `day_closed` for every remaining reservation, none for an item with `reserved = 0` (*⚠️ Changed in v1.0.1 (BF-11; built in task 12b):* "every remaining reservation" = of hidden lines of kept orders and of exited lines still reserved, as the next clause says); *v0.5.1; Changed in v0.6 (G4-2 #5, #11):* for **hidden** lines of kept orders only (plus exited lines still reserved). A frozen and a fired-not-started from-stock line keep their reservations, and their later `ItemStarted` drafts `StockConsumed`. The releases precede `BusinessDayClosed`, and the stations re-plan once, at it. An abandoned order → `StockReleased { abandoned }` from the tick |
| 89 | Void / remove moves `T` earlier, never later (G2 #13): a void that frees the critical line gives `T' < T`; a void that would need a later `T` keeps `T`; `promise_ms` unchanged in both (D6, story edge case "void of an item in-flight") |
| 90 | Weights change re-weighs open orders (G2 #13, pre-G2 #22): after an `EngineConfigApplied` that raises `weight_delivery_pct`, the next re-plan orders an open delivery line before a dine-in line it followed before; the line's `weight_pct` copy is unchanged |
| 91 | Submit gap (G2 #13, pre-G2 #21): a line that fits at the handler's `t` but not at the batch's `recorded_at` is placed at its earliest fit; the next `fires_alerts` pass slips it (via `next_alert_due_at`) |
| 92 | `next_alert_due_at` (G2 #4), property over 50 seeds: whenever finite, `getAlertIntents(state, next_alert_due_at)` has a slip or resolved item and `getAlertIntents(state, next_alert_due_at − 1)` has none for the same key; equal live and replayed; `null` on an idle state |
| 93 | `fires_alerts` with a raised slip (G2 #4): the slip persists unchanged for 60 s → no pass is due, no transaction; it grows by another `slip_threshold_ms` while its alert is open → still not due; its group resolves → the next pass closes the alert `done` and the fold of its `AlertClosed` drops `slips[key]`; a resolved slip whose alert was already closed by `ReleaseItems` is dropped at resolution; a key skipped for a missing receiver is not retried every pass; *v0.5 (G4-1 #17):* Done then `ItemDoneUndone` before the close pass leaves the alert open (`resolved_at` cleared, no `done` close) |
| 94 | Static (G2 #3): the set of event types with a case in `applyEvent` equals the union of `ENGINE_REPLAY_EVENTS`; any other type returns the same object (`Object.is`) |
| 95 | Config catch-up pass (G2 #22): with `configStale` and due fires, the first pass writes only `EngineConfigApplied`; the fires follow in the next pass, computed on the folded state |

### 10.3c Added in v0.5 (G4 run 1)

| # | Case |
|---|---|
| 96 | **Fired, not started (G4-1 #2; rewritten in v0.6, G4-2 #1):** tawa capacity 1, padding 3 min. A is fired at 12:00 with a 5 min cook and is not started. At 12:06, `liveInterval(A, 12:06) = [12:06, 12:11)`, so B (5 min) is placed on `[12:11, 12:16)` with `T` = 12:16 and promise 12:19, which is ≥ 12:11 + cook. A starts at 12:08, so A occupies `[12:08, 12:13)`; the late-start shift moves B to at most `[12:13, 12:18)`, and B's promise holds. No instant has 2 units. `planOrder`, `calculateETA`, the fold and `getTickIntents` give the same intervals at the same `t`; *v0.6.2 (G4-3 #1):* one fired line only — the multi-line cases are tests 115 and 116. *Changed in v0.6.3 (targeted check N-1):* **prep > 0 variant:** A has prep 4 min. At 12:06, A's packed Start is 12:06 and `liveInterval(A, 12:06) = [12:10, 12:15)`. B is placed on `[12:15, 12:20)`, with `T` = 12:20 and promise 12:23, and A's estimate is 12:15. A starts at 12:06 → COOKING `[12:10, 12:15)`, and B does not move. A starts at 12:08 → `[12:12, 12:17)`, B moves to `[12:17, 12:22)`, and B's promise holds |
| 97 | **Boost in the freeze (G4-1 #4):** tandoor capacity 2, two other orders frozen at `t + 30 s`; a boost → no instant over capacity; the moved frozen lines are `mark: 'moved'`; every displaced order pushed beyond `slip_threshold_ms` has a slip on the next `getAlertIntents`, and one pushed less has none (v0.6, G4-2 #14); a frozen line moves only later from its current fire (G4-2 #16); fired lines unchanged |
| 98 | **Placement sequence (G4-1 #3):** capacity 1; an early Done frees `[12:01, 12:08)`; older line A (latest fire 12:03) and a new immediate line N → pass 1 places A first and N lands after it; never 2 units on the station; `planOrder` = the fold |
| 99 | **Day close while cooking (G4-1 #6):** a close with one COOKING order, one served order and one order with only unfired lines → the COOKING order stays (its Done and Served commit, and it exits 30 min after the served); the served order exits; *v0.5.1 (Q13):* the unfired-only order **stays**, its lines lose their reservations (`day_closed`, re-planned at full cook time), are fired by later `fires` passes, and the order exits 30 min after its last serve; no checkpoint at the close; the first `fires` pass at which `noOrderInEngine(state, now)` holds writes it once (v0.6, G4-2 #3) (`last_seq` = `writer.lastSeq()`); a `BusinessDayOpened` before that clears the pending flag (the previous checkpoint stands); an `ItemDone` for an absent line is a logged no-op |
| 100 | **Lane Off in the freeze (G4-1 #5):** capacity 30 → 15 with 30 units frozen in the next 2 min → frozen lines re-placed within 15, moved ones marked, slips on the next pass for displaced orders past the threshold; a frozen line that cannot fit goes through §3.5.6 (v0.6, G4-2 #14, #15); lane On and an `EngineConfigApplied` capacity change behave the same; a station session asking `> capacity` → `400 VALIDATION_FAILED` |
| 101 | **Addition after the window (G4-1 #7):** fixture of 02 — an addition at minute 35 writes a new `OrderPlaced` with `follow_up: true`; `ReturnToKitchen` at minute 35 → `409 ORDER_NOT_IN_ENGINE` |
| 102 | **Draws from the event (G4-1 #9):** `EngineLine.draws` equals `ItemAdded.stock_draws`; for an item added to the menu after the day opened, live = replay with a changed config between them |
| 103 | **Return money (G4-1 #11):** fixture of 02 — the return line's `ItemAdded` has `price_minor 0`, `line_total_minor 0`, `tax_class_id null`, option charges 0, for `fix` and `remake` |
| 104 | **One re-plan per batch (G4-1 #12; Changed in v0.6, G4-2 #4):** a from-stock submit with 3 draws re-plans each station once, at the `ItemAdded` that brings `awaiting` to 0 (also for an `OrderLinesAdded` list); its own `StockReserved` events re-plan nothing. A `StockAdded` that reserves for 20 waiting lines re-plans once per flipped line (*v0.6.1*), and a `StockReserved` that flips nothing re-plans nothing. A recount that releases 5 lines re-plans each station once, at the `StockSet`. The same holds with the batch split across two `tx.append` calls. Replay = live |
| 105 | **Move to stock reserves (G4-1 #13):** `ItemMovedToStock` of one portion with one waiting fresh line → release, add, then `StockReserved` for the waiting line in one result |
| 106 | **`slip_due` upkeep (G4-1 #15):** a fold that touches no slip or group leaves `slip_due` and `next_alert_due_at` identical (`Object.is`); per-key recompute equals a full recompute (property, 50 seeds) |
| 107 | **Return rules (G4-1 #18, #19):** with `returns_boost` only the return line is boosted (`order.boosted` false, the order's other lines and `T` unchanged); a second `fix` on the same served line while the first is unserved → `409 RETURN_ALREADY_OPEN` |
| 108 | **Day-open reset (G4-1 #20):** `capacity_override` and `paused` set at night are null / false after `BusinessDayOpened`; *v0.6 (G4-2 #13):* a reset from 40 to 30 with lines booked re-plans the station and books no instant over 30; `capacityForLanes` with `lane_units` null and `lane_count > capacity` gives ≥ 1 per lane on |
| 109 | **Recount by `reserved_seq` (G4-1 #21):** three from-stock lines; a `StockSet` 1 below reserved releases the newest line whole |
| 110 | **Times (G4-1 #22, #24):** `placed_by` = `actor_id`, `placed_at` = `recorded_at`; an `ItemStarted` with `started_at` after `recorded_at` is folded at `recorded_at`; `FireDispatched.due_at` = the planned fire |

### 10.3d Added in v0.6 (G4 run 2)

| # | Case |
|---|---|
| 111 | *⚠️ Changed in v1.0.1 (AD-13, proposed (not yet ruled)):* the clock is `max(last_line_fold_at + order_abandon_ms, latest planned land)` (§3.3); with a fired, never-tapped line of normal length that is `last_line_fold_at + order_abandon_ms`, as below; `[03a BF-6]` adds a 5 h cook that is not abandoned before its planned land. **Abandon (G4-2 #2):** a fired line is never tapped. At `last_line_fold_at + order_abandon_ms`, `isOrderInEngine` turns false and the line stops occupying (the next submit sees the unit free). That pass releases its reservation `abandoned` and writes the checkpoint pending since the close; two closes later the profile is empty. An order with an unfired line (delivery pickup 6 h ahead) is never abandoned. A `FireDispatched` and an `ItemStarted` each refresh the clock; a `SlipWarned` does not. Live = replay |
| 112 | **Deferred checkpoint predicate (G4-2 #3):** the order kept over the close is served at 23:20. At 23:50, after one pass with no listed event, `noOrderInEngine` holds and the checkpoint is written, although the order is still in `state.orders` |
| 113 | **Slip details (G4-2 #17, #19, #20, #21):** a `dine_in` table with no owner → the slip goes to `placed_by`. In the first pass after a close, with a carried late order, the old alert is closed `obsolete` and a new one is raised (`closeMany` first); a deduped result writes no `SlipWarned`. An `EngineConfigApplied` lowering `slip_threshold_ms` moves `next_alert_due_at` (test 92 holds). With a carry of 2 min, the estimate includes it |
| 114 | **Return line structure (G4-2 #18):** a return of a `deal_part` line and of an `option_child` line → `line_kind: 'item'`, every parent / deal / option link null, `options: []`, `quantity` copied (fixture of 02) |

### 10.3e Added in v0.6.2 (G4 run 3)

| # | Case |
|---|---|
| 115 | **Two fired lines, capacity 1 (G4-3 #1; the review's fixture):** tawa capacity 1, 5 min cooks, padding 3 min. A (order 1) planned `[12:00, 12:05)` is fired at 12:00 and not started; B (order 2) planned `[12:05, 12:10)` is fired by the tick at 12:05 and not started. At 12:06: packed `liveInterval(A) = [12:06, 12:11)`, `liveInterval(B) = [12:11, 12:16)`; N (5 min, immediate) is placed on `[12:16, 12:21)`, `T` = 12:21, `P` = 12:24; B's estimate is 12:16. A is started at 12:07: the late-start cascade moves B to `[12:12, 12:17)` and N to `[12:17, 12:22)`, ≤ `P`. No instant of the packed profile has 2 units; `planOrder`, `calculateETA`, the fold and `getTickIntents` give the same intervals at the same `t`. *Changed in v0.6.3 (targeted check N-1):* **prep > 0 case (the check's fixture): a Start made on time never breaks a later order's promise.** Tawa capacity 1, `prep_ms` 240 000 for A, padding 180 000. A (cook 5 min) is fired at 12:00 (planned cook `[12:04, 12:09)`) and not started. At 12:06, N (prep 0, cook 5 min, immediate) is submitted. A's packed Start is 12:06 and `liveInterval(A, 12:06) = [12:10, 12:15)`, so N is placed on `[12:15, 12:20)` with `T` = 12:20 and `P` = 12:23, and A's estimate is 12:15. When A is started at 12:06, it becomes COOKING `[12:10, 12:15)` and N does not move. When A is started at 12:07, A is `[12:11, 12:16)` and N moves to `[12:16, 12:21)`, ≤ `P`. Regression assert: the v0.6.2 bound would place N on `[12:11, 12:16)` with `P` 12:19, and a Start at 12:06 would then move N to `[12:15, 12:20)`, past `P` |
| 116 | **Four fired lines, capacity 2 (G4-3 #1):** A, C, E, G (5 min) all fired and not started at `t` → packed A, C on `[t, t + 5)` and E, G on `[t + 5, t + 10)`; a new 5 min line is placed at `[t + 10, t + 15)`. With one COOKING line on `[t − 2, t + 3)`: A on `[t, t + 5)`, C on `[t + 3, t + 8)`, E on `[t + 5, t + 10)`, G on `[t + 8, t + 13)`. An outage fixture (every missed fire dispatched at once) packs the same way. *Changed in v0.6.3 (targeted check N-1):* **prep > 0 variant:** the same four lines with prep 2 min each, fired and not started at `t` → packed Starts `t` for A and C (on `[t + 2, t + 7)`) and `t + 5` for E and G (on `[t + 7, t + 12)`). A new line with prep 0 and a 5 min cook is placed at `[t + 12, t + 17)` |
| 117 | **Partial void (G4-3 #2; the review's fixture):** "Seekh kebab × 3" served from stock, draw 3, `reserved` 3. 04 voids 1 unit → one `StockReleased` of 1; `reserved` 2; the line has 2 units, `draws[0] = { quantity: 2, reserved: 2 }`, `from_stock` true, stock cook time, `reserved_seq` unchanged. Its Start → `StockConsumed` of 2, `reserved` 0, `reserved_seq` null. The pot is then counted 0: the `StockSet` folds with no breach reported. Variants: voiding the last units releases the rest and sets `from_stock` false with the full cook time; a partial void of a batch line in a frozen program-Q load keeps program Q and the load unchanged |
| 118 | **Q14 on a multi-draw line (G4-3 #2 (ii)):** line L draws 1 of X and 1 of Y, frozen over a close. At the open a `StockSet` changes X's unit → `StockConsumed` for L's X **and** Y draws before the `StockSet`; `reserved` of X and Y both 0; L's later `ItemStarted` drafts no `StockConsumed`; no breach reported |
| 119 | **Recount below frozen reservations (G4-3 #3; the review's fixture):** kebab `on_hand` 4, `reserved` 4, four from-stock lines frozen on Next. The manager counts 2 → the `StockSet` is allowed (`on_hand` 2 < `reserved` 4, all held by frozen lines; no breach). The four Starts all commit: `on_hand` 0 after the second, the third and fourth clamp and each report one breach `{ event_id, stock_item_id, on_hand: 0, reserved }`; at the end `on_hand` 0, `reserved` 0. `single_tap` variant: the `fires` pass with the inferred starts commits, and the next pass fires other stations' lines. A unit-changing `StockSet` in the 2-of-4 state folds its `StockConsumed` drafts without throwing. A `StockAdded` with a mismatched unit leaves the entry unchanged and reports a breach (A-20). Replay = live, with the same breaches reported |

### 10.4 Acceptance (story AC → test)

| Story AC | Tests |
|---|---|
| E4 ETA AC1–AC3 (prep + wait + cook; slot / batch wait; stock time until 0) | F 1–4, 10, 15; 39 |
| E4 ETA AC4 (shared queues, no default priority) | 25, 28, 90 — **changed by D3**: weights are config, default by order type (§4.5 A-12; v0.4, G2 #11: A9 is answered, no field input pending) |
| E4 ETA AC5 (recalc on every event) | 21, 45 — as bumped by D13 (§3 #13) |
| Hold-and-fire AC1–AC2a | F 2, 5–7; 17–19; 96, 98 (v0.5); 115, 116 (v0.6.2) |
| AC3 fire at latest start; AC6 (KDS countdown, 03b) | F 13; 60 |
| AC4 batch freshness | F 3, 9, 14; 44 |
| AC5 boost | 34 |
| AC7 nothing hard-coded | lint test (no item or station names in `packages/engine/src`) |
| Slip AC1 threshold | 35 — **changed by D11**: measured from the engine target, not the original promise (F-5; v0.4, G2 #11) |
| Slip AC2 (to the order taker) | 65 |
| Slip AC3 (escalation; dismiss) | 65 — **changed by D11**: the card answers "Send what's ready" / "Wait"; "Wait" (decline) stands for "customer informed" (v0.4, G2 #11) |
| Slip AC4 one per table | 36 |
| Slip AC5 tracking page | out of scope (E9, P2) |
| Overrun / cascade (D33, D42) | F 8, 11, 12 |
| Restart without re-fire (D24, D44) | F 13; 57, 59, 60; 99 (day close while cooking, v0.5) |
| Stock update re-plans (foundation D23; 01a S45 carried row) | 40, 87 (v0.4, G2 #7), 104, 105 (v0.5) |
| AC5 boost — no other order breaks silently (D4; v0.5, G4-1 #4) | 34, 97 |
| Slip AC2 (to the order taker), non-table orders (v0.5, G4-1 #8) | 65 |

### 10.5 Statement counts

Every hub path in §6 asserts its count: `fires` idle 0 (freeze-entry frames included, no transaction, v0.2.1), with work 0 reads; `fires_alerts` idle 0 (and 0 while a raised condition persists, v0.4), with work 2 + ≤ 1 + 01d bounds; boot step 2 = 2 (each `LIMIT 2`, v0.4), step 3 = 4 + 2 (v0.2), step 6 = 0 (`checkpoint_pending` from the step-2 row, v0.5); the deferred checkpoint = its own small write transaction, 0 statements in `due` (v0.5, G4-1 #6); `fires_alerts` `tableOwners` only for `dine_in` keys (v0.5, G4-1 #8); commands = 00 pipeline + 0 reads (state in memory); `stations-live` 0.

> ⚠️ **Changed in v1.0.1 (AD-37 (1), owner ruling; AD-37 (8), proposed (not yet ruled); AD-22, accepted; AD-34 (3), developer ruling):** `fires_alerts` with work = **2 (`listOpen`) + ≤ 1 (`tableOwners`) + ≤ 1 line facts + 01d bounds**; the facts read has no `branch_id` predicate. The slip `apply` = 1 read when goes-with links exist and it has a released and an open line, else 0 (the §12.2 count confirmed by the owner 2026-11-08). `SetStationCapacity` asserts an exact count. Gaps as built: no statement assertion for a `fires_alerts` pass that closes and raises, an overload pass, or the first pass after a day close; no hub-level statement test for a `fires` pass with Start / Done / Consumed / Shifted drafts (§1 "Gaps recorded as built"). Was: "with work 2 + ≤ 1 + 01d bounds".

### 10.6 Simulator and CI performance gate (D22, D27)

`packages/engine/test/sim/` ports `docs/stories/03a-sim/replay_cost.py` and `tandoor_sim.py` to TypeScript on the real engine:
- ⚠️ **Changed in v1.0.1 (AD-27, developer ruling 2026-11-07; AD-26, accepted; AD-29 Q1, Q2, developer rulings):** the day below is about 300 % overload at peak (karahi / BBQ / tawa 261 / 218 / 250 %, 5 300 waiting lines), not a day a kitchen runs. The harness therefore generates **two days**:
  - a **normal peak day**: R6 volume (≈ 45k replayed events ± 20 %), peak utilisation 90–100 %, reached by **lowering demand**, never by raising a capacity above 01a's limits; **every §7.1 target is asserted on it**. As built: degh 4, tandoor 30; every order carries `pickup_at_ms = at + max cook + 300 s`; order mix 55 / 33 / 12 with 60 tables (`tandoor_sim.py`); degh freshness window 60 s; 38 304 events.
  - an **overload day**: the same day with demand at **125 % for one rush hour**, then back to normal; only the overload targets (≤ 16 probes, ≤ 50 ms p99) are asserted on it.
  - The 90 % utilisation floor is measured on the **10-minute window** (`peak_window_pct`), not the clock hour (AD-29 Q1); nobody "fixes" a miss by moving the day's start. **Report-only** runs on seeds 8 and 11 (AD-29 Q2).
  - The perf project runs **only via `pnpm test:perf`** in a clean measurement (AD-32 (4)), never in `pnpm -w test`; its numbers go into the status board. Lines re-placed per station re-plan are asserted ≤ **270** (P-11, proposed (not yet ruled)). The simulator is shared with hub tests through the test-only `@pos/engine/sim` export (P-12, proposed (not yet ruled)).
  - Measured numbers: §7.1 (dev laptop; pilot box open, task 28).
  - Was: the generated day below, and "Asserts (CI, Vitest `perf` project)" in `pnpm -w test`.
- **Generated day** (seed 7): 2 000 orders, 65 % in a ~5 h dinner window (~260 orders/h at peak), 25 % lunch, 10 % uniform over 18 h; stations tandoor slot 60 × 180 s, karahi slot 50 × 1 200 s, BBQ slot 30 × 900 s, degh batch 100 × 60 s (*v0.4, G2 #15:* inside 01a's capacity range 1–100; was 1 000), tawa slot 8 × 300 s; lines per order as the drill's `MENU`; target = max cook + 300 s; Start/Done tapped on time.
- **Asserts (CI, Vitest `perf` project):** re-plan per submit p99 ≤ 50 ms; *v0.5 (G4-1 #1):* lines re-placed per submit are **reported, not asserted** (the CI bound is set in the plan from the first TypeScript run, spec first); full-day replay from a checkpoint ≤ 45 s; a 2-day replay ≤ 80 s (v0.5, G4-1 #6; v0.6, G4-2 #22); **snapshot write at design size ≤ 50 ms** (v0.4, pre-G2 #38 closed, G2 #14); events ≈ R6 (±20 %); live state = replayed state. An **overload day** (tandoor at 125 %) asserts the overload pass bound.
- **Drill result (v0.5, G4-1 #1; `docs/stories/03a-sim/replay_cost.py`, seed 7, 2026-11-03).** The drill was run with the v0.5 pivot (`earliest_possible`, `MAX_EARLY = 60 s`, freeze `KEEP = 60 s`) and with `--no-prune`. Same generated day both times: 2 000 orders, 14 412 lines, ≈ 65.9k events.

  | | no prune | v0.5 pivot |
  |---|---|---|
  | lines re-placed per station re-plan, p50 / p99 / max | 140 / 675 / 702 | **60 / 650 / 685** |
  | Python re-plan per submit, p50 / p99 | 56.6 / 610.5 ms | 60.8 / 641.3 ms |
  | full-day run (Python) | 271.8 s | 284.7 s |
  | events (fires and dones replayed) | 65 860 | 65 876 |

  The pivot cuts the median re-placed count by more than half but leaves the peak. At peak most hidden lines are naan held for karahi orders, and a tandoor-only order's earliest start is a few minutes out, so those lines still end after the pivot. The 16-event difference shows that pruned ≠ unpruned to the line (§12.3, test 23). The Python times are a pessimistic bound (the drill's docstring) and are not the 50 ms gate. Task 18 measures that gate on the TypeScript engine, and the plan sets the re-placed-lines bound from that run (§7.1). A miss stops the build for a spec bump (v0.6, G4-2 #6).
- **Policy report (not a gate):** % promises kept, max late, mean wait by order type, cold time, utilisation for FIFO / EDF / Waada Guard (D22); *Changed in v0.3:* the peak pieces-per-hour count (field A14, still to count at the visit) is a **simulator input only**; it does not block the spec or G2.

---

## §11. Build order

Each task is TDD (failing test first) and cites its sections. Batches of ~5; the simulator (task 18) is the gate before the hub tasks.

| # | Task | Files | Spec |
|---|---|---|---|
| 1 | Event schemas v1 (§4.2 table) and fixtures | `packages/events/src/events/{order,station,stock}/` | §4.2 |
| 2 | Error codes | `packages/domain/src/errors.ts` | §9 |
| 3 | `EngineState` v3, `ENGINE_STATE_VERSION = 3`, snapshot fixture test | `packages/engine/src/state.ts`, `version.ts` | §3.3; test 56 |
| 4 | Occupancy profile (`latestFit`, `earliestFit`, add, remove) | `profile.ts` | §3.3, D24 |
| 5 | F tests 1–15 on v3 | `test/foundation.test.ts` | F §4.7 |
| 6 | Lines, units, cook time; plan trigger at last listed line | `apply-event.ts`, `plan.ts` | §3.2, §3.5.1; 16–19, 43 |
| 7 | Hold-and-fire against the profile; target and promise; delivery | `plan.ts` | §3.5.1; 17, 31 |
| 8 | Re-plan passes, keep, freeze, prune; `T' = min(T, …)`; submit gap; *v0.5:* `earliestPossible` pivot, sequence pass 1 → immediate → sync, `liveEnd` for fired and COOKING lines, one re-plan per station per batch (G4-1 #1, #2, #3, #12); *v0.6:* `liveInterval` (sliding for fired-not-started), plan at `awaiting` = 0, fire-time pivot (G4-2 #1, #4, #8); *v0.6.2:* fired lines packed per station (G4-3 #1) | `replan.ts`, `profile.ts` | §3.3, §3.5.1, §3.5.3; 20–23, 89, 91, 96, 98, 104, 115, 116 |
| 8a | Return lines: `return_of` fold, `cook_ms_override`, no draw, expedite / boost placement (moved after task 8 in v0.2, pre-G2 #26) | `plan.ts`, `apply-event.ts` | §3.8a; tests 75, 80, 114 |
| 8b | Exit predicate `isOrderInEngine` (*v0.6:* abandon rule, `last_line_fold_at`, `noOrderInEngine`, G4-2 #2, #3), removal in listed folds only, `ENGINE_REPLAY_EVENTS`, deterministic ids (v0.2, pre-G2 #2, #7; v0.4, G2 #3) | `apply-event.ts`, `replay-events.ts` | §3.3, §3.12; tests 78, 81, 94, 111 |
| 9 | Policies FIFO / EDF; weights | `replan.ts` | §3.5.2–§3.5.4; 24, 25, 90 |
| 10 | Overload Λ search, `max_late_ms` | `overload.ts` | §3.5.6; 26, 27 |
| 11 | Routing, reserve, re-route | `route.ts` | §3.5.5; 28–30 |
| 12 | Stock reserve / release / consume, `stockEffects`; `StockAdded` reserve-and-re-plan (v0.4, G2 #7); *v0.5:* draws from `ItemAdded`, hidden lines only, batch program rule, move-to-stock folds its own drafts, recount by `reserved_seq`, consume only a live reservation (G4-1 #9, #10, #13, #14, #21, #6); *v0.6:* release rules per cause, stock folds never re-plan (*v0.6.1:* except a `StockReserved` that flips `from_stock`, the restored `StockAdded` re-plan), Q14 consume, `abandoned` release (G4-2 #2, #4, #5); *v0.6.2:* per-draw `reserved`, partial-void share, Q14 on every draw, consume clamp, no throwing stock fold with the breach reporter, hidden-only `StockAdded` candidates (G4-3 #2, #3, #4) | `stock.ts`, `apply-event.ts` | §3.7, §7.2; 39–42, 87, 88, 102, 104, 105, 109, 117–119 |
| 13 | Batch loads with copied cook times | `plan.ts` | F §4.7; 44 |
| 14 | Tick intents: fires, auto-fill, inferred, cascade, `nextDueAt` | `tick.ts` | §3.6; 32, 52, F 8, 12, 13 |
| 15 | Slip and `ItemsReleased`, `goesWith`, `planRelease`; `SlipRecord`, `AlertClosed` fold, `next_alert_due_at` (v0.4, G2 #4); *v0.5:* `slip_due` per key, Undo clears `resolved_at` (G4-1 #15, #17); *v0.6:* carry in estimates, threshold recompute, receiver fallback (G4-2 #17, #20, #21) | `slip.ts` | §3.8; 35–38, 77, 92, 93, 106, 113 |
| 16 | Boost, capacity, lanes, pause, pressure, exit, READY, undo; *v0.5:* D15 exceptions with `mark: 'moved'`, day-close exit rule, absent-id no-op, day-open reset, return boost scope (G4-1 #4, #5, #6, #18, #20); *v0.6:* frozen lines at `earliestFit(current fire)`, §3.5.6 with frozen lines, day-open reset re-plan (G4-2 #13, #15, #16) | `apply-event.ts`, `pressure.ts`, `view.ts` | §3.3, §3.4, §3.9, §3.10; 34, 45–51, 97, 99, 100, 107, 108 |
| 17 | `EngineConfigApplied` effects; checkpoint | `apply-event.ts`, `checkpoint.ts` | §3.11, §3.12; 53–55 |
| 18 | **Simulator + CI perf gate** (gate for tasks 19+) | `test/sim/` | §10.6 |
| 19 | Migration `0007_engine.sql` | hub migrations | §5.1 |
| 20 | Boot steps 2, 3, 6; replay filter; 00 H-1 fields (`clock`, `missedFires`; v0.4, G2 #6) | `engine-host/boot-steps.ts`, `lib/boot.ts` (H-1) | §3.12; 57, 58, 60, 64 |
| 21 | Snapshot and checkpoint writers (checkpoint body and `last_seq`, fresh snapshot after boot; v0.4, G2 #5, #17; *v0.5:* deferred checkpoint, `checkpoint_pending`, G4-1 #6) | `engine-host/snapshots.ts` | §3.12; 55, 61, 99, 112 |
| 22 | Fires tick, config catch-up | `engine-host/fires-tick.ts` | §6.2, §3.11; 62, 63, 71, 73, 79, 95 |
| 22a | `fires_alerts` tick (v0.2, pre-G2 #1, #11; due from `next_alert_due_at`, overload host set, flags, v0.4 G2 #4, #23) | `engine-host/fires-alerts-tick.ts` | §6.2a; 76, 77, 82, 86, 93 |
| 22b | `station_plan` catch-up and frame (v0.2, pre-G2 #12) | `engine-host/station-plan.ts`, `packages/events/src/ws.ts` | §3.6.3; 83 |
| 23 | Kinds `slip_warning`, `station_overload` | `engine-host/kinds.ts` | §3.8, §3.10; 65, 67, 72 |
| 24 | Config hook | `engine-host/config-hook.ts` | §3.11; 70 |
| 25 | Commands capacity and pause | `commands/` | §6.6, §6.7; 68, 69 |
| 26 | Query and catch-up `stations-live`; audiences | `queries/`, `ws/` | §6.5, §6.4; 66 |
| 27 | Property test live = replay; race 74 | `apps/hub/test/engine/` | §10.2, §10.3; 59, 74 |
| 28 | Pilot-box manual check (perf targets §7.1) | `docs/plans/03a-manual-checks.md` | §7.1 |

Tasks 1–18 need no other module; tasks 19–26 need 01a v2.1 for real config (defaults stubbed, §4.4). Estimate: 28 tasks here, expanded to ~50 plan tasks (within the 60 budget; 03a-g0 §7 "Size").

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done

1. Every test in §10 passes; the §10.6 gate is green in CI.
2. §7.1 targets measured on the pilot mini PC (task 28).
3. Every §4.5 row approved and applied with "Changed by 03a" markers.
4. Pilot values entered at setup in the 01a pages (configuration, not spec; v0.3).
5. README rows R-1–R-6 applied (v0.4, G2 #12; R-1 "Blocked by" and R-3 "To 05" as changed in v0.5).
6. *v0.5 (G4-1 #1):* the drill's re-placed-lines number (§10.6) is re-measured by the TypeScript simulator, and the plan sets its CI bound before task 18 closes.

> ⚠️ **Changed in v1.0.1 (status as built):** DoD 1 met (final gate at `1d098b8`: 360 files, 3209 tests passed, 1 skipped, 1 todo `[03a BF-9]`; the §10.6 gate is the clean `pnpm test:perf` run). **DoD 2 open** (task 28, the pilot mini PC; not a merge blocker unless a number misses). DoD 3 and 5 applied with v1.0. DoD 4 is configuration. DoD 6 met: p99 223 → bound 270 (P-11, proposed (not yet ruled)).

### 12.2 Endpoint checklist

| # | Item | Kind | Permission | Statements | Errors | Events |
|---|---|---|---|---|---|---|
| 6.2 | `fires` tick | tick | — | 0 | — | `FireDispatched`, `ItemStarted`, `ItemDone`, `ReservationsShifted`, `StockConsumed`, `EngineConfigApplied` (catch-up), `StockReleased { abandoned }` (v0.6) |
| 6.2a | `fires_alerts` tick (v0.2) | tick | — | 0 idle and while a raised condition persists (v0.4); 2 + ≤ 1 + 01d. *⚠️ Changed in v1.0.1 (AD-37 (1), owner ruling):* 2 + ≤ 1 (`tableOwners`) + ≤ 1 line facts + 01d; was: 2 + ≤ 1 + 01d | — | `SlipWarned` (with `alert_id`, v0.4), alert events; *v1.0.1:* `engine_line_dropped` alerts (AD-8) |
| 6.3 | boot steps 2, 3, 6 | boot | — | 2, 4, 0. *⚠️ Changed in v1.0.1:* 2, **4 + 2**, 0 (step 3 = the four replay statements + the two `stock_version` reads, as §3.12, §10.5 and the test); was: 2, 4, 0 | boot stops | — |
| 6.4 | kinds + config hook + `station_plan` (v0.2) | registration, frame | — | 0. *⚠️ Changed in v1.0.1 (as built, per AD-22 (accepted); count **confirmed by the owner 2026-11-08**, following AD-37 (1)):* the slip accept `apply` = 1 read (the slip orders' `ItemAdded`: `item_id`, `category_id`) when goes-with links exist, else 0; everything else 0; was: 0 | — | `EngineConfigApplied`, `ItemsReleased` (apply) |
| 6.5 | `GET /queries/stations-live` | query | session | 0 | 400 | — |
| 6.6 | `set-station-capacity` | command (staff or own-station session) | `manage-stations` / `stationScoped` | pipeline | 400, 403, 404 | `StationCapacitySet` |
| 6.7 | `set-station-pause` | command | `manage-stations` | pipeline | 400, 403, 404, 409 | `StationPauseSet` |

### 12.3 Open questions — each with a **proposed** answer (*approved as written with v1.0*)

From 03a-g0 §7:

| # | Question | Proposed answer |
|---|---|---|
| Q1 | Weighted EDF rule for capacity > 1 (D5) | Minimise the maximum weighted lateness by the Λ search of §3.5.6 (Lawler-optimal for one slot); ties by `order_item_id`. The simulator compares it with "weighted slack" before G2 |
| Q2 | A request raised from the tick (D11) | Works inside 01d as written: `named`, `needs_pin: 'never'`, no requester (no withdraw, no `request_result`, AD-72), no in-person answer; only the editorial row N-1 |
| Q3 | `promise_padding_ms` per order type or per branch | Per order type in `branch_engine_settings`, with a nullable station override (A-6, A-12); the shape is fixed now (R18) |
| Q4 | ETA preview vs submit | The preview returns `as_of_seq`; the submit response is authoritative; 02 shows "time updated" when they differ by ≥ 60 s |
| Q5 | Self-check D1–D23: owner module and config key | Done in §3.1; none left without both (D2, D17–D19, D22 have no key by nature) |
| Q6 | `station_overload` as an `info` kind | Yes, plain `info`; no 01d bump |
| Q7 | `ItemsReleased` vs `SlipWarned` + an answer event | `ItemsReleased` (one fact; also written by 02's table view); 03b's Ready-to-serve dedupe uses its event id |
| Q8 | Exit rule before 05 | §3 #11 as decided; `BillClosed` later, optional |
| Q9 | Size | 21 items (§6; v0.4, G2 #12), ~50 plan tasks; plan in batches with the simulator as the gate; re-estimate milestone A after the plan |

Raised by this draft (P-n, proposed):

| # | Proposal | Why |
|---|---|---|
| P-1 | A piece line holds `quantity` units; g / ml and pending-weight lines hold 1 | capacity is counted in pieces at a piece station (D14); the capacity itself is configuration (v0.3; "pending A1" removed in v0.4, G2 #11) |
| P-2 | Target and promise are carried in `OrderPlaced` | `recorded_at` is stamped after the handler's `now`; an engine-version replay must not move promises |
| P-3 | Alternates between slot stations only | batch programs are per station; the pilot need is the tandoor (D23) |
| P-4 | Stock releases are explicit events written by the trigger's writer via `stockEffects` | clients fold stock frames (01a §4.4); an implicit release would desync them |
| P-5 | Consume at `ItemStarted` | the portion leaves the pot at start; 01a left "the hand-over step" open |
| P-6 | Answer `accept` sends with default ticks; edited ticks only from 02's table view | `AnswerRequest` has no payload for ticks |
| P-7 | `red_since` lives in host memory; a restart restarts the 5 min; *v0.4 (G2 #4):* so does `overload_open`, rebuilt by the forced first pass after boot | pressure is not an event (D13 spirit); restarts are rare |
| P-8 | `EngineConfigApplied` puts station config into the log | `BranchConfigApplied` carries only a hash; replay must not read config |
| P-9 | 03a defines the engine fields of every event it folds; the writer may add fields before the pilot | extends §3 #4 to 02 / 03b / 04 events (03a is built first) |
| P-10 | `OrderLinesAdded` for additions to an open order | 01c envisages later child lines; a re-plan needs a trigger |
| Q10 | **Closed in v0.2.1 (developer):** the reading is kept: the `pause_enabled` setting (default off) plus a live `SetStationPause` | — |
| Q11 | **Closed in v0.2.1 (developer):** engine settings in 01b's branch settings endpoint (B-6), station engine fields, alternates and carry times in 01a's station resource, goes-with on the category and item PATCHes; only the points `POST` / `PATCH` are new, so 01a lands at **30**, inside the line; no README R-7 needed | — |
| Q12 | D28: a customer's own wrong order ("I said mutton") — `remake` free, or a void + new charged line (04 approval)? **still open (v0.3)**: the owner's answer to Q15a covered returns, not the charge for a customer's own wrong order | proposed: 02 offers only fix / remake (both free); a charged replacement is a void (04) plus a normal order, no third mode |

**Pre-G2 findings recorded, not applied as written (v0.2):**

| # | Why not applied as proposed |
|---|---|
| #10 | Not needed: the 30-minute exit window (#2) keeps the order in the state while a return or addition can arrive, so `OrderLinesAdded` needs no order fields; an exited order is refused `ORDER_NOT_IN_ENGINE`. |
| #21 | Applied as the review's second option (the rule weakened and the next tick slips the line), not by passing `recorded_at` into the handler: the append stamps `recorded_at` after the handler (`engine-host/append-events.ts:12`), and exposing it is a 00 change for a gap of milliseconds. |
| #31 | Applied in its narrow form: only `missedFires`; no `engine_events_replayed` field (an additive `HubStarted` field would need a schema version, D46); the engine's replay count is logged. |
| #37 | Applied as "keep 2" rather than "keep 1", so a torn newest row still leaves a usable one. |
| #38 | Applied as "deferred with `setImmediate`" (not the next tick pass), so the snapshot never waits for a tick and never shares a transaction with one. |
| H-2 | Not added: the config catch-up (#4) runs in the first `fires` pass, so no boot write is needed. |
| #7 load id | Of the two options given, `station_id + ':' + earliest order_item_id` was chosen: it exists before the load fires (re-plans need it); the first-`FireDispatched` form exists only after firing. |

**G2 findings (`03a_v0.3_g2_completeness.md`) applied differently from the proposal, or recorded (v0.4).** Every other finding #1–#28 is fixed as proposed at the edit marked "Changed in v0.4 (G2 #n)".

| # | Applied as / why |
|---|---|
| G2 #1 | Developer decision: instead of only a carried row, §4.5 gains 00 v1.7 rows **H-5** (`devices.point_id`) and **H-6** (`devices.lane_label`, the lane definition), joining 01e's bump; the pairing / binding UI and the ESP32 side are carried rows To 03b and To 01e; `capacityForLanes` takes `lane_count` as an input. Gives 03b, 01d's point target and 01e one owner and one definition. |
| G2 #3 | Applied with the developer's form: the exit is a predicate over listed events only, plus the static test. The proposal's "`OrderLinesAdded` with `inEngine = false` at its `recorded_at` throws" is narrowed to **an absent order throws**: a present order whose window ends inside the ms gap between the handler's `now` and the batch's `recorded_at` (§3.5.3) is re-opened, because 02 accepted it at `now`; throwing there would fail a replay on a legitimate log. |
| G2 #4 | Developer decision instead of the proposed host `closed` set and `last_estimate` filter: `EngineState.next_alert_due_at` (pure) drives `due`; `slips[key]` keeps `resolved_at` until its `AlertClosed` is folded. To match that close, `SlipWarned` carries `alert_id` again (reverses that part of pre-G2 #1: the tick calls `raiseMany` first, so the id exists when the draft is built) and `AlertClosed` returns to the `order` replay list. Overload stays in host memory (`overload_open`, `red_since`, P-7) because pressure is not an event, checked in memory by `due`. |
| G2 #7 | Developer decision, the reverse of the proposal: the v0.3 text was wrong and 01a's carried row ("`StockAdded` … triggers D23") is right, so **no 01a row A-20** is added; `StockAdded` reserves for waiting fresh lines and re-plans (§3.7), and foundation row F-19 states what "stock update" means. |
| G2 #15 | Of the two options, the override range is lowered to 01a's `capacity` range (1–100) and the simulator's batch station to 100; no 01a cap change. |
| G2 #21 | Of the two options, `unit_changed` is **dropped** (no path reaches it: every reservation is released `day_closed` in the close commit and a unit change waits for the next open, 01a S44); test 42 now asserts the empty result. *⚠️ Changed in v1.0.1 (BF-11):* since v0.6 the close releases **hidden** lines only; a reservation held at the open belongs to a frozen or fired line and is consumed before a unit-changing `StockSet` (Q14, §3.7). `unit_changed` stays dropped; was: "every reservation is released `day_closed` in the close commit" |
| G2 #25 | Recorded instead of a migration: no backfill, because no tenant runs live before the pilot (R29) and the dev / pilot tenants are re-seeded with the 01b v1.5 release; if a pilot tenant already exists then, 01a's `0003` backfill pattern applies (B-2). |
| G2 #26 | Recorded: the index build is sized and placed (release in the maintenance hour, §5.1), not moved out of the migration. |
| G2 #27 | Kept where it is, with the reason stated at A-12 (02's setting, placed so one 01a bump carries every timing setting, 03a-g0 §5). |

**G4 run 1 findings (`03a_v0.4_hostile_run1.md`) applied differently from the review's proposal, or recorded (v0.5).** Every other finding #1–#26 is fixed at the edit marked "Changed in v0.5 (G4-1 #n)".

| # | Applied as / why |
|---|---|
| G4-1 #1 | Developer decision. The pivot is the new lines' earliest possible start against the fixed lines (§3.5.3), and the "≤ 250" claim is deleted. **Drill result (§10.6):** this pivot halves the typical re-plan but hardly cuts the worst case. Lines re-placed per station re-plan went from p50 140 / p99 675 / max 702 without the prune to p50 60 / p99 650 / max 685 with it, and the Python re-plan p99 did not improve (≈ 610 → 640 ms; the pivot search costs about what it saves). The reason: a tandoor-only order is held only `300 s` past its cook, so its earliest possible start is a few minutes from `now`, while most of the ~700 held naan end later. The prune pays off only for orders whose own lines are held far ahead. The gate that stays is the 50 ms p99, and the plan sets the re-placed-lines bound from the TypeScript run. Also recorded: pruned ≠ unpruned to the line (older lines before the pivot keep their places instead of moving later). Test 23 therefore asserts what matters (same `T` / `P`, no extra late line, no over-booking), not equality. *⚠️ Changed in v1.0.1 (BF-11):* test 23 asserts `T_pruned ≤ T_unpruned` (v0.6, G4-2 #7), not "same `T` / `P`"; was: "same `T` / `P`" |
| G4-1 #2 | Developer decision, not the review's form. A fired-not-started line occupies `[fire + prep, max(planned_end, now))` (its start does not move to `now`), so until its Start tap the profile under-books it by the start delay (up to `now − fire`). The late-start shift (D42) still corrects that at Start. Accepted: the case that broke promises (B placed into A's whole interval after A's planned end) is closed. *Withdrawn in v0.6 (G4-2 #1):* the under-booking was the whole cook, not the start delay, and the case was not closed; it is replaced by the sliding interval (§3.3). |
| G4-1 #6 | Developer decision (option a, no 01a guard). Recorded consequences: (1) *closed in v0.5.1 (Q13):* an order with any unserved line, unfired included, no longer exits at the close. (2) *dropped in v0.5.1:* the close releases unfired lines only, so a carried fired from-stock line consumes at Start and nothing drifts. (3) The 2-day replay is gated at ≤ 90 s (§7.1; ≤ 80 s since v0.6, G4-2 #22); it needs a version bump, so it happens only in the maintenance hour. |
| G4-1 #7 | Applied. The developer text names `isOrderInEngine(state, order_id)`; the exported signature keeps `t` (`isOrderInEngine(state, order_id, t)`), because the exit is a pure time predicate (G2 #3) and 02 passes its handler `now`. Not a change of meaning. |
| G4-1 #10 | Applied with one reading stated: "a line in a load" = a member of a **frozen or fired** load. A hidden load is re-formed by every re-plan, so its lines are "not yet in a load" for this rule. *Withdrawn in v0.6 (G4-2 #4):* `StockAdded` no longer switches a line's program or cook time, and batch lines are not candidates. *⚠️ Changed in v1.0.1 (BF-11):* **restored in v0.6.1**: a `StockAdded` reservation switches a hidden line to its copied stock cook time and, for a batch line in a hidden load, to its `stock_program_id` (§3.7); the reading of "a line in a load" stands; was: "Withdrawn in v0.6" as the last word |
| G4-1 #18 | Recorded: a return needs only `mark-item-returned`, so an Order taker can jump a returned line ahead of other orders without `boost-order`. Accepted as the cost of owner Q15a ("a returned plate never queues"). 07 can audit it from `return_of` lines. |
| G4-1 #20 | Of the review's options: a station session is clamped to `≤ capacity`; a staff session may set up to 100 (an extra cook). Overrides **and pause** reset at `BusinessDayOpened` (the review asked only to state a rule; reset was chosen so a night setting never silently halves the next lunch). |
| G4-1 #26 | §12.6 refreshed (below). |
| — | `ENGINE_STATE_VERSION` stays 3 although v0.5 adds `slip_due`, `stock_program_id`, `reserved_seq` and `mark: 'moved'`: v3 is not built yet, so no snapshot of it exists (D62 bumps only a built shape). |

**G4 run 2 findings (`03a_v0.5.1_hostile_run2.md`) applied differently from the review's proposal, or recorded (v0.6).** Every other finding #1–#23 is fixed as proposed at the edit marked "Changed in v0.6 (G4-2 #n)".

| # | Applied as / why |
|---|---|
| G4-2 #1 | Developer form of the review's fix: a sliding interval `[max(fire + prep, now), +cook)` that `ItemStarted` fixes, from one helper `liveInterval`. Recorded: a Start that comes after the last placement still shifts later lines by `started − t`, the time nobody could know at placement, never by a whole cook; the slip covers it. The v0.5 claim "under-books by the start delay" was wrong. |
| G4-2 #2 | Developer decision instead of the review's options (i) and (ii): a third exit, **abandon**, by pure predicate after `order_abandon_ms` without a fold on any line (branch setting; default 4 h, range 1–24 h). Readings stated: (a) an order with an unfired line is never abandoned, because the tick fires it and that refreshes the clock, so a delivery held for a pickup hours ahead stays. (b) Only folds that name the order or a line refresh the clock (list in §3.3), not tick-written slips, alert closes, shifts or stock events, so a ghost line cannot keep itself alive. (c) An abandoned line's reservation is released by an explicit `StockReleased { reason: 'abandoned' }` from the `fires` tick (P-4: releases are events), a new reason value. The checkpoint body is not extended. Recorded: a version-bump boot replays more than 2 days only if two closes in a row are each followed by an open within `order_abandon_ms` (mid-service stale-day closes); version bumps ship in the maintenance hour. |
| G4-2 #4 | Developer decision, no marker. The order plan uses the existing `awaiting` count (the list is in the first event of the batch), and **stock folds never re-plan** (*v0.6.1:* except a `StockReserved` that flips `from_stock`, see (a)). Consequences: (a) *Reversed in v0.6.1 (developer):* v0.6 withdrew the `StockAdded` switch to the stock cook time; v0.6.1 restores it. A `StockReserved` fold re-plans exactly when it flips a line's `from_stock` from false to true, which the fold can see from the state, so it needs no batch marker either. Accepted cost: one re-plan per flipped line, bounded by the lines the added stock reaches (01a carried row, D23). (b) A recount or a day close re-plans at its own event, which the writer appends after its releases (§4.2 batch order), so one re-plan per station follows the releases with no payload field. |
| G4-2 #5 | Developer decision (the per-cause table, §3.7). One reading stated: "fired and frozen lines never release" and "`on_hand < reserved` only by the units of fired lines" are read together as **frozen or fired** lines, because a frozen line is never released either and its units must be allowed too. Q14 is closed by consuming before a unit change (§3.7): the review's proposal, moved from the close to the `StockSet`. |
| G4-2 #6 | Applied: full re-placement is the algorithm; incremental insertion is deferred (§12.5). |
| G4-2 #11 | Superseded by G4-2 #5's table (hidden lines only at the close). |
| G4-2 #14 | Applied with the developer's defaults: `slip_threshold_ms` 120 000 (was 300 000) and padding 180 000 (unchanged), reason at A-12. No cross-field validation is added (configuration). |
| G4-2 #18 | The structure is applied. The review's optional `units` on `ReturnToKitchen` is **not** added: in the pilot a return is of the whole line (R18: added only if an owner asks). |
| G4-2 #22 | Gate set at ≤ 80 s for steps 2–3, leaving ≈ 10 s for steps 4–8 (measured in task 28). |
| — | `ENGINE_STATE_VERSION` stays 3 with `last_line_fold_at` added (v3 is not built; D62). |

**G4 run 3 findings (`03a_v0.6.1_hostile_run3.md`) applied differently from the review's proposal, or recorded (v0.6.2).** #1, #2 and #4 are fixed as proposed; the H1 part of #15 is fixed; #5–#14 and the rest of #15 are BF-1–BF-11 (§12.6).

**Targeted check findings (`03a_v0.6.2_targeted_check.md`) applied differently from the check's proposal, or recorded (v0.6.3).** N-1 is fixed in the developer form: `s` is defined as the packed **Start** (≥ `max(fire, t)`), so the interval is `[s + prep, s + prep + cook)` and the estimate is `s + prep + cook + carry`. The check wrote the same bound with `s` as the station start (`≥ max(fire + prep, t + prep)`, estimate `s + cook + carry`). The two forms give the same intervals and estimates. N-2 and N-3 are BF-12 and BF-13 (§12.6).

| # | Applied as / why |
|---|---|
| G4-3 #2 | Applied with one state change the review implied: `EngineLine.draws[]` gains `reserved` (the units of that draw still reserved), so a partial void, a partial consume and a whole release are each exact per draw; `reserved_seq` becomes null only when every draw's `reserved` is 0. `ENGINE_STATE_VERSION` stays 3 (not built; D62). |
| G4-3 #3 | Developer decision, wider than the review's clamp: **no stock fold ever throws** (consume and release clamp at 0; a `StockSet` excess and a `StockAdded` unit mismatch are folded / ignored), and every breach is reported through `applyEvent`'s optional `report` and logged by the host. The cost: a real bookkeeping bug no longer fails its transaction, so tests assert "no breach reported" on every valid fixture, and the `warn` log is the field signal. 01a S14's throw becomes row A-20. The review's alternative (release frozen lines on a recount) is not taken: frozen lines stay on Next (D17). |

**Raised by v0.5 (Q13, closed in v0.5.1) and v0.5.1 (Q14, closed in v0.6):**

| # | Question | Proposed answer |
|---|---|---|
| Q13 | G4-1 #6 as decided lets an order whose lines are **all unfired** exit at `BusinessDayClosed`. With the stale-day prompt answered at lunch, an order submitted a minute earlier is then never fired, while 02 still shows it open. Should unfired lines also keep an order in the engine? | **Closed in v0.5.1 (developer):** yes — `BusinessDayClosed` never exits an order with any unserved line (unfired included); such an order exits by the normal rule only (§3.3). The checkpoint rule is unchanged (§3.12). |
| Q14 | *Raised by v0.5.1:* the close keeps the reservation of a fired-not-started from-stock line (§3.7). If the next `OpenBusinessDay` changes that stock item's unit (01a S44) while the reservation is held, its `StockConsumed` at Start is in the old unit. | **Closed in v0.6 (G4-2 #5, #12):** a recount or a close releases hidden lines only, so a reservation held at an open belongs to a frozen or fired line. A unit-changing `StockSet` is preceded by `StockConsumed` for every held reservation, so the entry enters the new unit with `reserved = 0` (§3.7, test 42). |

### 12.4 Carried rows "To 03a" — where each is addressed

| README row | Addressed in |
|---|---|
| 00 owner review (drop closed orders; day-close checkpoint; size for 90 s) | §3.3 exit (§3 #11), §3.12 checkpoint (D26), §7.1 |
| 01a S14 / S15 / §4.4 (stock shape, `canServeFromStock`, unit change at day open, `StockSet` below reserved, `StockAdded` triggers D23, `sold_out`, replace step 3, config reaction) | §2.4, §3.7, §3.11, §3.12, A-14–A-16. *v0.4:* `StockAdded` → reserve for waiting lines and re-plan (*restored in v0.6.1*) (§3.7, test 87, G2 #7); unit change at day open → nothing to re-plan; *v0.6:* hidden reservations are released `day_closed` the night before, and frozen or fired ones are consumed before a unit-changing `StockSet` (§3.7, G2 #21, Q14) |
| R6 sizing (75k/day, 45k replayed) | §3.12 filter, §7.1, §10.6 |
| 01c §4.4 (deal parts, option children, `deal` never fired, reserve per draw, weighed lines, copied batch cook times) | §3.2, §3.7; tests 19, 39, 43, 44 |
| 01d §4.3 (filter + index, `registerTick`, `raiseMany(tickCtx)`, no catch-all audience; Ready-to-serve kind) | §3.12, §6.2, §6.4; Ready to serve moved to 03b (§3 #6) |

### 12.5 Deferred until needed

Learned cook times (E4 P2); the customer tracking page (E9); multi-station chains (P2+); alternates between batch stations; persisted pressure history (07 recomputes); a "load snapshot" field.

- **Incremental insertion (deferred; Changed in v0.6, G4-2 #6).** At submit, place each new line at its latest fit within slack against the current profile, and move older lines only on a conflict, and then only the minimal set that resolves it. This changes where older lines land and which order wins: pass 1's re-ordering by `(d − keep, w × waiting)` would go, and test 90 would not hold. It therefore **needs a version bump of this spec if adopted**, with new rules and tests 20, 21, 23, 90 and 98 rewritten. It is not chosen in the plan.

### 12.6 Hostile self-review (author, v0.1; refreshed in v0.4, G2 #28)

*Refreshed for v0.6.3 (targeted check):* the packed start left out prep for an unstarted line (N-1). Prep 0, the 01a default, hid this from every fixture, so each placement test now has a prep > 0 case (96, 115, 116).

*Refreshed for v0.6.2 (G4-3), the G4 run 3 findings as input:*

- **Placement:** sliding fired lines ignored each other's capacity (G4-3 #1), so one late Start could break a later promise; they are now packed per station in fire order. Residual risk: the packing cost per read is O(fired lines), small unless an outage fires a whole queue at once (test 116's outage fixture).
- **Stock:** a partial void leaked reservations and a short recount underflowed at Start (G4-3 #2, #3). Reservations are per draw, consume clamps, and no stock fold throws; a breach is logged, never fatal. Residual risk: a real bookkeeping bug now shows only as a `warn` log, so every valid fixture asserts "no breach".
- **Over-engineering check (v0.6.2):** one field (`draws[].reserved`) and one optional fold argument (`report`); nothing else added.

**Build-time fixes (v0.6.2; G4 run 3 minors not applied in the text; v0.6.3 adds BF-12 and BF-13, the targeted check's N-2 and N-3; v1.0 adds BF-14, the final check's N2-1).** Each is done inside the named §11 task, with its test, before that task closes; none changes a contract outside 03a without the spec edit it names.

| BF | Review id | Fix | Task |
|---|---|---|---|
| BF-1 | G4-3 #5 | The fresh program is not lost after a flip: keep `program_id` and `stock_program_id` immutable and derive the current program as `from_stock ? stock_program_id : program_id` (or add `full_program_id`); state which a from-stock submit line carries | 12 (with 13) |
| BF-2 | G4-3 #6 | `planOrder` / `calculateETA` take `reserveStock`'s `from_stock` map (02 calls `reserveStock` first, To 02 #1); §6.1b / §6.1c signatures updated | 7 |
| BF-3 | G4-3 #7 | Slip crossing time includes carry: `t = level − prep − cook − carry`; a carry > 0 seed in test 92 | 15 |
| BF-4 | G4-3 #8 | The abandon time resolves a slip key (`slip_due` = `last_line_fold_at + order_abandon_ms` when every order of the key is abandoned; `fires_alerts` closes the alert); test-111 case with an open slip; checkpoint body then equals live | 15 (with 8b) |
| BF-5 | G4-3 #9 | The overrun item of `nextDueAt` exists only while the live end overlaps a later unstarted reservation; `nextDueAt(state, t)` takes `t` and applies `isOrderInEngine`; overrun-with-empty-queue case in test 62 | 14 |
| BF-6 | G4-3 #10 | Abandon clock from `max(last_line_fold_at, the order's latest planned land)`, so a long legitimate cook is never abandoned mid-cook | 8b |
| BF-7 | G4-3 #11 | The `StockAdded` flip re-places only the flipped line within its own slack (O(1)), or a §7.1 row and a §10.6 measurement for a 20-line `StockAdded` at peak | 12 (measured in 18) |
| BF-8 | G4-3 #12 | `stockEffects` threads the claims of earlier drafts of the same command (several `AddPrecookedStock` entries); state whether a `StockSet` that raises `available` runs the waiting-line reserve | 12 |
| BF-9 | G4-3 #13 | After a unit-changing `StockSet`, re-reserve the held lines in the new unit (`reserveStock` with the day's draws), or record the over-sell as an accepted cost in §12.3 | 12 |
| BF-10 | G4-3 #14 | Narrow the S:426 "hears before the promise" claim to Waada Guard stations with the branch padding, or apply `level = min(T + slip_threshold_ms, P)`; record the EDF / FIFO case | 15 |
| BF-11 | G4-3 #15 (rest) | Stale text: §12.3 rows G4-1 #1 ("same `T` / `P`"), G4-1 #10 ("withdrawn", restored in v0.6.1) and G2 #21; the first clauses of tests 42, 88 and 99; §9 `ORDER_NOT_IN_ENGINE` adds the abandon exit; To 02 #1 label "no tap on any line for N h" | 2 (§9), 12 (tests 42, 88), 16 (test 99), spec edit at approval (§12.3 rows, To 02) |
| BF-12 | Targeted check N-2 | The partial-void `units` belong to the cause's fold. The `ItemVoided { units }` fold runs first ("the cause, then its releases"). It lowers the line's `units` and every `draws[].quantity` by the voided share, and it sets stage `voided` only when no unit is left. The `StockReleased` fold changes only `reserved` (the stock entry's and the draw's). This also covers a partial void of a line with no draw. Test 117 gains a two-draw variant ("Platter × 2" drawing 2 X and 2 Y, 1 unit voided → `units` 1) and a no-draw partial-void variant | 12 |
| BF-13 | Targeted check N-3 | The A-20 code change. Remove the throw at `packages/engine/src/apply-event.ts:31` (`StockAdded unit mismatch`): the fold leaves the entry unchanged and reports one breach. Re-baseline 01a §10 test 129 and `packages/engine/src/stock.test.ts:91` to assert that the entry is unchanged and one breach is reported. A-20's targets gain 01a test 129 (spec edit at approval) | 12 (the task that touches `apply-event.ts` for stock) |
| BF-14 | Final check N2-1 | The `slip_due` crossing (§3.8) ignores the fired-not-started lines packed ahead (of other orders), and nothing recomputes it when one of them starts, so a slip can warn late by the queued work ahead. (a) For a fired-not-started line, the crossing is the instant at which `s(t) + prep + cook + carry` passes the level, computed by the same packing helper as `liveInterval`. (b) A fold that changes a station's fired-not-started set or its COOKING lines (`FireDispatched`, `ItemStarted`, `ItemDone`, `ItemVoided`, `ItemRemoved`) also recomputes the keys of that station's fired-not-started lines. (c) Test 92 is seeded with two or more fired-not-started lines on a capacity-1 station | 15 (with BF-3) |

> ⚠️ **Changed in v1.0.1 — BF-1–BF-14 as built** (each in its plan task, with its test; plan "BF-1–BF-14 placement"):
>
> | BF | Status as built | Task | Test |
> |---|---|---|---|
> | BF-1 | Done: `program_id` / `stock_program_id` immutable, current = `from_stock ? stock_program_id : program_id` (`currentProgram`) | 12b (with 13) | `[03a BF-1]`, extends #87 |
> | BF-2 | Done: `planOrder` / `calculateETA` take the `from_stock` map | 7 | `[03a BF-2]` |
> | BF-3 | Done: crossing `t = level − prep − cook − carry` (AD-21 R2 adds `+ 1`) | 15 | extends #92 |
> | BF-4 | Done: the abandon time resolves a slip key; `fires_alerts` closes it `done` (the latest AD-13 exit, AD-21 R5) | 15, 22a | extends #111; `[03a BF-4 hub]` |
> | BF-5 | Done: `nextDueAt(state, t)`; the overrun item only while it overlaps a later unstarted reservation | 14 | extends #62 |
> | BF-6 | Done per **AD-13** (proposed (not yet ruled)): `max(last_line_fold_at + order_abandon_ms, latest planned land)` | 8b | `[03a BF-6]` |
> | BF-7 | Done: the flip re-places only the flipped line; measured 39.8 ms at peak (§7.1) | 12b, 18 | `[03a BF-7]` |
> | BF-8 | Done: `stockEffects` threads earlier drafts (array form); a `StockSet` raising `available` runs the waiting-line reserve | 12b | `[03a BF-8]` |
> | BF-9 | **Parked**: AD-2 (re-reserve) is superseded by AD-29; per AD-29 Q6 (**proposed (not yet ruled), developer to confirm**) BF-9 stays parked and the code follows tests #42 / #118 (held lines are consumed before the `StockSet`, not re-reserved). `it.todo('[03a BF-9]')` stays (its text still names the AD-2 re-reserve: stale) | 12b | `it.todo` |
> | BF-10 | Done as **AD-3** (developer ruling): the claim is narrowed to Waada Guard with the branch padding (§3.8); no code | 15 (test), 29 (text) | `[03a BF-10]` |
> | BF-11 | Done: code part in tasks 2, 8b, 12b; text part here: §9 abandon exit, To 02 #1 label, §12.3 rows G4-1 #1, G4-1 #10, G2 #21, first clauses of tests 42 and 88. Test 99's first clause already reads per Q13 (v0.5.1), so no change there | 2, 8b, 12b, 29 | — |
> | BF-12 | Done: the `ItemVoided { units }` fold lowers `units` and `draws[].quantity`; `StockReleased` only `reserved` | 12 | extends #117 |
> | BF-13 | Done: no throw on a `StockAdded` unit mismatch (A-20); 01a #129 and `stock.test.ts:91` re-baselined | 12 | 01a #129 |
> | BF-14 | Done: fired-not-started crossing via the packing helper; recompute on station-set folds | 15 | extends #92 |
>
> Was: the BF list above with no status.

*Refreshed for v0.6 (G4-2), the G4 run 2 findings as input:*

- **Placement:** the v0.5 live end under-booked an unstarted line by its whole cook (G4-2 #1); it is now a sliding interval. Residual risk: a Start later than the last placement still shifts later lines by that gap, and the slip covers it.
- **Lifecycle:** after Q13 an untapped ticket never left (G4-2 #2), so there is now an abandon exit. The checkpoint predicate is pure (G4-2 #3). Every exit is now bounded: 30 min after the last serve, or `order_abandon_ms` after the last tap.
- **Stock:** stock folds never re-plan (G4-2 #4), except a `StockReserved` that flips `from_stock` (the `StockAdded` re-plan, restored in v0.6.1). Releases follow one per-cause table: whole lines, never frozen or fired (G4-2 #5). Q14 is closed.
- **Process:** full re-placement is fixed; changing it needs a spec bump (G4-2 #6).
- **Over-engineering check (v0.6):** one state field (`last_line_fold_at`), one setting (`order_abandon_ms`) and one release reason (`abandoned`) were added; the `StockAdded` cook switch and its batch rule were removed (*restored in v0.6.1*). Nothing else was added.

*Refreshed for v0.5 (G4-1 #26), the G4 run 1 findings as input:*

- **Placement:** three holes would have over-booked a station or broken a promise without a boost. Immediate lines were placed before pass 1, a fired-not-started line looked free, and a boost or capacity drop collided with frozen lines. Fixed by one sequence (§3.5.1), `liveEnd` (§3.3) and the two named D15 exceptions (§3.4). Remaining risk: the fired-not-started under-booking by the start delay (§12.3 G4-1 #2). *(v0.6: wrong; it was the whole cook, fixed by G4-2 #1.)*
- **Prune:** v0.4's pivot fixed nothing. The new pivot is correct but barely cuts the worst case (§10.6), so the 50 ms p99 is the real gate. The risk moves to task 18, where a miss changes the algorithm before any host code exists.
- **Day close:** a close no longer drops plates on the fire; the checkpoint is deferred while orders remain. *v0.5.1:* Q13 closed (no order with an unserved line exits at a close); the close releases unfired reservations only, so carried fired lines consume at Start; Q14 open.
- **Contracts:** 02's additions after the window, the return price, the receiver for non-table orders and `ItemReturned` written by 02 are now stated. 03a still touches no money arithmetic.
- **Replay:** draws come from the event, never config; `slip_due` keeps the alert upkeep per key, so replay adds no per-event scan.
- **Over-engineering check (v0.5):** two state fields were added (`slip_due`, `reserved_seq`), each tied to a finding (G4-1 #15, #21), plus one host flag (`checkpoint_pending`, G4-1 #6). `'missed'` was removed. Nothing else was added.

*Refreshed for v0.2–v0.4 (G2 #28), the G2 findings as input:*

- **Two ticks (v0.2):** `fires` and `fires_alerts` each own a transaction; a throw in one never rolls back the other (tests 63, 76). Hole found by G2 and fixed: `fires_alerts` was due every pass while a raised condition persisted (G2 #4) → `next_alert_due_at` and the overload host set; resolved slips were never closed `done` → `resolved_at` kept until `AlertClosed`. Remaining risk: `next_alert_due_at` must agree with `getAlertIntents` exactly, or a pass is due with nothing to write; one `slipCrossing` function feeds both and test 92 checks it.
- **Exit window (v0.2):** live ≠ replay hole (an unlisted event dropped the order live, G2 #3) → pure predicate, removal only in listed folds, static test 94. The ms gap at the window edge is resolved by presence, not by the predicate (§12.3 G2 #3).
- **Checkpoint:** the missing `business_day` and the mid-commit `last_seq` (G2 #5) would have failed a night boot or folded `day_closed` releases twice → body and `last_seq` fixed, test 55.
- **Station-plan frames (v0.2.1):** frames from `due` are a send of committed state, no transaction; audience stated (G2 #19); never twice per pass (test 83).
- **Stock:** `StockAdded` now writes `StockReserved` (G2 #7); the writer appends them in the same transaction from `stockEffects`, so clients folding stock frames stay right (P-4); a fold below 0 still throws.
- **Contracts with other specs:** 00 H-1 (`clock`), H-5, H-6; 01b B-8 (sync bound 32); foundation F-19; all in §4.5. The `AlertClosed` read is a read of an unchanged 01d event, not a 01d change.
- **Over-engineering check (v0.4):** `next_alert_due_at` is one number recomputed per fold, justified by 01d's idle rule (no transaction while nothing changes); `unit_changed` removed as unreachable (G2 #21); nothing else added.

*v0.1 review, kept:*

- **Races:** the tick re-selects inside its own transaction (01d race rule); the plan is computed on the same state in the submit's transaction; boosts and capacity changes re-plan in the reducer; tests 71–74.
- **Idempotency:** commands via `processed_commands`; the tick is idempotent by state (`fired_at`, `slips`); slip raises dedupe on `(kind, slip:<table_key>)`.
- **Determinism gaps found and fixed:** config read during replay (→ `EngineConfigApplied`, P-8); promise recomputed on replay (→ in `OrderPlaced`, P-2); freeze against a clock (→ `recorded_at`, D13); pressure timer (host memory, stated P-7).
- **Indexes / N+1:** replay index added; tick resolves all receivers with one `tableOwners` call and all alerts with one `raiseMany` / `closeMany`.
- **Contradictions with the foundation:** every override is a §4.5 F row (F-1–F-20; v0.4, G2 #12; F-20 v0.5).
- **Over-engineering check:** checkpoint table and index justified (§5.1); no re-plan events, no cache, no projection.
- **Open risk:** the 50 ms p99 is an estimate from a Python drill (03a-g0 §6b); the CI gate (task 18) runs before any hub work, so a miss changes the algorithm before the host is built.
