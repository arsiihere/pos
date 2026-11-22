# Hostile review: STAB-6 (batch round queue) + STAB-7 (max delay → priority)

- **Branch:** `fix/stab-tablet-pairing` @ `0c71a40c`.
- **Specs reviewed (each diffed against its previous version):** `03a_Timing_Engine_Spec_v1.2.8.md` (BQ-1–BQ-6, §3.5.7 PR-1–PR-8, tests 143–161) vs v1.2.7; `02b_Ordering_Spec_v1.0.23.md` and `v1.0.24.md` vs v1.0.22; `01_Restaurant_Setup_Spec_v2.7.4.md` vs v2.7.3; `01c_Menu_Variants_Spec_v1.1.3.md` vs v1.1.2; `03b_KDS_Pass_Spec_v1.0.13.md` vs v1.0.12; `00_Foundation_Spec_v1.14.md` §4.7.
- **Context:** `docs/plans/stab-6-batch-rounds-proposal.md`, `stab-7-max-delay-proposal.md`, `stab-6-7-plan.md`, `stab-bugs.md`, `docs/stories/03a-g0.md` (D4, D15).
- **Code checked against:** `packages/engine/src/{slip,replan,apply-event}.ts`, `apps/hub/src/engine-host/fires-alerts-tick.ts`, `apps/hub/src/orders/expand-parts.ts`, `apps/cloud/src/modules/staff-roles/versions.ts`.
- **Line numbers:** `03a:N` = line of `03a_Timing_Engine_Spec_v1.2.8.md`; other specs are named the same way.

## Verdict: FIX

| Severity | Count |
|---|---|
| BLOCKER | 3 |
| MAJOR | 13 |
| MINOR | 15 |

STAB-6 (BQ) is sound in concept and the F-1 reading holds. STAB-7 (PR) has three problems that must be fixed before any code:

- The trigger cannot live where the spec puts it.
- Priority lines lose their "land together" target after the first re-plan.
- PR-4 breaks the freeze window, D17 and P4, which v1.2.8 leaves unchanged.

`OD` = needs an **owner decision** (behaviour); `TXT` = a pure spec-text fix.

---

## What was verified true (no finding)

| Claim | Evidence |
|---|---|
| F-1: "re-planned within slack" can read as "a waiting round is re-placed as one unit" | F §4.7 l.890 and the batch ETA (F l.693–727) define the join and new-load rules only; BQ-3 keeps "first batch with room, `startsAt > now`" and D49 programs |
| F §4.7 capacity row "items that no longer fit are moved to the earliest fitting time" | BQ-5 moves overflow to the next load with room, which is the earliest fit in queue order |
| Root cause of STAB-6 (the slide, the line-by-line re-form, J5–J7) | `replan.ts:535-610` `batchPass1` re-forms through `pass1Order`; `slip.ts:233` packs fired-not-started lines from `t` |
| New events and fields are additive | `ItemAdded.max_delay_ms?` optional at v1, no upcaster; `LinePrioritized` is a new v1 type; snapshot keys are optional (R29); no merged migration is touched (`0017` is new) |
| Test numbers do not collide | 03a 143–161 (v1.2.7 ended at 142); 02b 56–58; 03b 91–96; 01a 202–205; 01c 130 |
| The replay at the version bump is bounded | The day-close checkpoint holds no lines (03a:448), so after a closed day the v4 → v5 skip replays only that day |
| Each group can be prioritised at most once | `priority_at` is sticky and set once, so there is at most one `LinePrioritized` per group and no endless event cascade |

---

## BLOCKER

### B-1 The priority crossing cannot be kept "in `slip_due[key]` with the slip terms" — TXT

**Where:** 03a:648 (PR-3), 03a:733 (§3.8 note); code `slip.ts:334-349` `keyDue`, `slip.ts:616-637` `getAlertIntents`, `fires-alerts-tick.ts:220,247` (`skipped`).

**Problem:** `slip_due` is per **table key**, and it is computed in a way that rules out the priority term:

- `keyDue` returns `null` when `slip_threshold_ms` is null.
- While a slip alert is open it returns only `resolved_at` / the abandon time.
- It covers only sync groups of orders with `awaiting = 0`.
- `getAlertIntents` skips every key with an open alert, and the host drops `skipped` keys from `nextAlertDueAt`.

**Failure:** `slip_threshold_ms` = 3 min and the BBQ `max_delay_ms` = 5 min. The slip opens at +3. From then on `slip_due[key]` is the slip's resolve or abandon term, so the +5 priority crossing is never due, and no `LinePrioritized` is written for exactly the tables that are late. The same happens for any branch with slips turned off, and for a key the host skipped because it has no receiver. Test 153 covers none of these cases.

**Fix:** a separate pure `priority_due: Record<group_id, number>` with the same upkeep as `slip_due`. `next_alert_due_at` = the minimum of both maps. The priority term does not depend on the threshold, the open alert or the host `skipped` set. Extend test 153 with three cases: a slip already open, threshold null, a skipped key. Extend test 106 to the new map. List the new map in the v5 state fields (03a:386).

### B-2 Priority lines drop their sync target at the next re-plan, and PR-5 is measured from the old `T` — TXT (adds a state field)

**Where:** 03a:604 (pass 1: "each at `earliestFit(max(t, d(L) − max_early_ms(L)))`") vs 03a:650 (PR-4 slot: one hold-and-fire, "`T` unchanged") and 03a:653 (PR-5: "land together at their new hold-and-fire target").

**Problem:** the hold-and-fire target from PR-4 is stored nowhere. `T` is unchanged, and so is each line's `deadline_ms`, which derives from `T`. In a late group, `d(L) − max_early_ms` is already in the past, so every later pass 1 places each priority line on its own at `earliestFit(t)`.

**Failure:** take the owner's example (test 152). The group's karahi (12 min) and naan both become priority. The next submit runs pass 1, which fires the naan now while the karahi lands at +12. The naan waits about 10 min at the pass. That is the exact case PR-5 forbids. Test 155 passes without testing anything if `d` means the old deadline.

**Fix:**
- Add `EngineGroup.priority_land_ms` (set by the PR-4 hold-and-fire; moves only earlier at later re-plans) to the v5 state.
- Each priority line's working deadline = `priority_land_ms − carry − cook`, and its lower bound is computed from that deadline.
- Pass 1 re-places a priority group with one loop, not line by line.
- Test 155 states `d` relative to `priority_land_ms`, and a second re-plan must keep the group together.

### B-3 PR-4 moves frozen (visible) lines and loads: D15, D17 and P4 contradict it — OD

**Where:** 03a:649-651, 03a:773 (the boost path for priority); unchanged rules 03a:358 D15 ("exactly two exceptions, boost and a capacity change"), 03a:360 D17 ("never reorder what is visible; human-triggered jumps marked"), 03a:781 BQ-5 / P4 ("a frozen load keeps P4 … the chef may already be loading it"), 03b:141 ("the row keeps its place").

**Problem:** a tick-triggered event becomes a third freeze exception and an unmarked, non-human jump:
- **Slot stations:** PR-4 pushes other orders' frozen lines later.
- **Batch stations:** PR-4 joins a frozen load and sheds a member out of it.

**Failure:** the tandoor KDS shows Next = "Naan ×8 (T5 ×3, T6 ×5)", frozen, and the chef is loading dough. A `LinePrioritized` for T2 turns the round into T2 ×1, T5 ×3, T6 ×4. The 8 naan that come out no longer match the tickets. With the 5 min default this repeats all through a rush.

**Fix (owner choice):**
- **(a) Recommended:** priority placement never moves a frozen line or load. A slot priority line takes the first fit after the freeze window. A batch priority line joins the first **hidden** load. D15, D17 and P4 stand.
- **(b)** Keep PR-4 as written. Then amend D15 (a third exception), D17 (an engine jump, marked) and P4, and change the story decisions D4 and D15 in `docs/stories/03a-g0.md` with the owner's sign-off.

---

## MAJOR

### M-1 STAB-7 adds a second promise-breaker; the "no foundation change" claim was checked for STAB-6 only — OD

**Where:** 03a:347 (the D4 row "boost is the one promise-breaker", unchanged); 03a:773 ("Was: boost the only such rule"); F §4.7 l.882–898 (the reservation lifecycle lists Boost as the only displacement row), F l.637 D44 (`fires_alerts` writes slips and alerts); `docs/stories/03a-g0.md` D4.

**Problem:** a `LinePrioritized` written by `fires_alerts` re-plans and can push other orders past `T`. That is a new lifecycle trigger and a new kind of event for the alerts tick. The F-1 reading does not cover it.

**Fix:** the owner rules on two things:
1. Is this a 03a override of story D4? If so, update the D4 row and the story.
2. Does F §4.7's reservation lifecycle need a "Priority (03a §3.5.7)" row (foundation bump to v1.15), or does the F-4 delegation ("the rules are 03a §3.5") cover it? Write the answer into the 03a changelog either way.

### M-2 The PR-4 batch shed walk contradicts test 156 and arrival order — TXT

**Where:** 03a:651 ("its latest non-priority member … goes, with BQ-5's walk, into the next load with room") vs test 156 (03a:1591: "whose latest moves to the third").

**Problem:** the BQ-5 walk skips full loads, so an older member can land behind younger ones.

**Failure:** R1 = [A..H] full, R2 = [I..P] full, R3 holds X. X becomes priority and joins R1. H walks past R2 (full) into R3, in the space X left. H now cooks after I..P, which arrived later.

**Fix:** state a cascade: each full load passes its latest non-priority member to the next load in the queue. That is what test 156 expects.

### M-3 "Join order" is not arrival order after a shed — TXT

**Where:** 03a:781 ("member (join, i.e. arrival) order"), 03a:651.

**Problem:** a member moved by BQ-5 or by a priority shed joins its new load last, although it arrived first.

**Failure:** H is shed into R2 and joins last. The next priority line sheds R2's "latest by join order", which is H again. The same old order is pushed back twice while younger members stay.

**Fix:** order members by arrival (`placed_at` of the order, then `order_item_id` / part index), not by join time. Add a test.

### M-4 A priority line cannot use idle time that a newer non-priority line can — OD

**Where:** 03a:523 (BQ-3: a new load may use an idle gap before a held load, Q2) vs 03a:651 ("No new load is formed ahead of the queue").

**Failure:** the tandoor is idle now. The only queued load is H, held for a pickup and firing at +17. Priority line X joins H and fires at +17. A naan ordered after X forms a load in the idle gap and fires now. The newer order cooks ahead of the priority line.

**Fix:** a priority line may form a new load in a gap before the queue head when that lands it earlier, as BQ-3 allows new lines to. Add a test.

### M-5 PR-4 batch compares a load's *end* with a fire bound — TXT

**Where:** 03a:651 ("whose end is ≥ its lower bound"); PR-5 (03a:653) makes the lower bound a fire time (`d − max_early_ms`).

**Failure:** naan with `max_early_ms` 2 min and lower bound +10. A load booked [+8, +11) has end ≥ +10, so the naan joins it and fires at +8, before PR-5 allows.

**Fix:** use "start (fire) ≥ lower bound", with the lower bound taken from B-2's target.

### M-6 BQ-5 ignores priority members, which the PR-5 note says it sheds last — TXT

**Where:** 03a:604 ("BQ-5 sheds non-priority members first") vs 03a:781 (BQ-5 keeps its "first members in join order").

**Failure:** capacity drops 8 → 4 on the load [A ×4, P (priority) ×2]. BQ-5 keeps A and sheds P.

**Fix:** BQ-5 keeps priority members first (in `priority_at` order), then by arrival. Extend test 149.

### M-7 `max_delay_ms = 0` makes every such line priority at once, and `≥` / `>` disagree — OD

**Where:** 03a:648 (`delay ≥ max_delay_ms`); 01a MD-1 range `0–7 200 000`; code `slip.ts:266` uses a strict `>`.

**Failure:** an item set to 0 has delay = estimate − `T` = 0 when it is on time. So it is "at its limit" at the first `fires_alerts` pass after submit, every time. It then pushes other orders and moves frozen lines (B-3).

**Fix:** the owner decides what 0 means ("never later than `T`" → trigger on `>`) or sets the minimum to 60 000. Use one comparison everywhere and add a boundary test.

### M-8 `?? 300000` turns an explicit "no limit" (`null`) into 5 min — TXT

**Where:** 01a:493 ("the hub reads … `?? 300000`"), 02b v1.0.24:133 ("`engine_settings.max_delay_default_ms ?? 300000` (which may be `null`)"); contradicted by 02b test 58 and 01a test 204.

**Failure:** the owner sets the branch default to "No limit", and the snapshot sends `null`. `null ?? 300000` gives 300 000, so every line is still prioritised at 5 min. The same pattern in plan task 3 invites this bug.

**Fix:** write "absent (`undefined`) → 300 000; `null` is kept" and test both cases.

### M-9 The 01b owner-settings wire changes without a 01b row (self-made decision 4) — TXT

**Where:** 01a MD-2. `BranchEngineSettings` and `BRANCH_ENGINE_SETTING_KEYS` (`@pos/events`, used by `apps/cloud/src/modules/staff-roles/versions.ts:43,123`) are 01b v1.9.1's wire contract.

**Problem:** CLAUDE.md says no API contract changes "without asking". 01b's own text and tests (the versions / audit diff of settings) are not updated, so the build edits a contract that no 01b section describes.

**Fix:** a 01b v1.9.2 patch row ("Changed by 01a v2.7.4 MD-2") naming the wire field and its 01b test. Plan task 4 then cites it.

### M-10 Starvation of "no limit" lines, and priority inflation in a rush — OD

**Where:** 03a §3.5.7 as a whole; 01a MD-2 default 5 min.

**Problems:**
- At about 200 orders per rush, most groups will cross 5 min. Priority order then becomes crossing order, and the order-type weights (dine-in vs delivery) stop mattering exactly when they matter most.
- A line with `max_delay_ms = null` on a busy slot station goes behind **every** priority line with no bound. That is the "pushed back without end" that STAB-7 is meant to remove.
- Priority lines themselves can still be pushed without bound by boosts, overruns and capacity drops, so "not more than that" is not a guarantee.

**Fix:** the owner either accepts this and the spec documents it, or picks a bound (for example, a no-limit line becomes priority at its `max_late_ms`). Add a simulator scenario (D27) with the default turned on to measure the share of priority lines, and re-run `test:perf`.

### M-11 Group-wide priority includes lines that cannot help — OD

**Where:** 03a:648 (PR-3: "every line of the group not yet started").

**Failure:** the group's karahi is COOKING and overruns by 6 min. Its raita and naan are waiting and on time, but they become priority, take first place on their stations and push other tables. The group still lands at the karahi's end, so nothing is gained.

**Fix (owner):** trigger only when a line that is not fixed (unfired) drives the late estimate, or skip the group when the line setting its estimate is COOKING or fired.

### M-12 The pull-in order at a fire is not fixed under BQ — TXT

**Where:** 03a:664 §3.6.1 item 1 (the pull-in is chosen by target within the freshness window); BQ-4 (c) allows the pull-in but names no order.

**Failure:** R1 fires with 2 free spots. By target, it can pull a part from R3 ahead of R2's older members.

**Fix:** pull in queue order, then by arrival. Add a test that extends 148 with a pull-in.

### M-13 The plan breaks the gate mid-way and misses tasks — TXT (plan)

**Where:** `docs/plans/stab-6-7-plan.md`.

**Gate breaks:**
- Task 13 adds `EngineLine` fields while the version is still 4. The v4 key-set test (test 56) is red until task 31, unless someone edits the v4 fixture, which is forbidden.
- Task 16 adds an `applyEvent` case before task 21 adds the replay list, so test 94 is red for tasks 16–20.
- Task 15 writes `LinePrioritized` before its fold exists, so live and replay differ.

**Missing tasks:** B-1 (the due map), B-2 (the target field), M-9 (the 01b row), the test 106 upkeep for the priority fold (it moves other keys' lines, like a boost), and the simulator scenario.

**Fix:**
- Bump the version and its fixtures in task 13.
- Fold task 21 into task 16.
- Put task 15 after task 16.
- Add the missing tasks.

---

## MINOR

| # | Where | Problem | Fix |
|---|---|---|---|
| m-1 | 03a:989 To 02 #12 vs changelog Q5; 02b test 45 | "a deal whose part cooks on a batch station likewise [split]" reads against Q5 "deal parts on a batch station are not split now" (Q5 means a part of quantity > 1 inside one deal) | Reword Q5 as "a deal part of quantity > 1"; state that an unsplit multi-unit line (even ≤ capacity: a ×4 cannot use 3 free spots, so a later ×1 takes them) is outside the arrival-order guarantee |
| m-2 | Test 143, BQ-3, BQ-5 | Arrival order holds only for immediate split lines with no capacity change: sync lines go by target, and BQ-5 sheds older units behind younger ones (Q4) | State the scope in BQ-1 and in test 143; exempt these cases in property test #59 |
| m-3 | 03a:647-648 | For an immediate group "level = `T` + min over waiting lines" is undefined (each line has its own estimate); the `T` of a group made by `ItemsReleased` (AD-22) or `OrderLinesAdded` is not stated | Define a per-line crossing for immediate groups; name the `T` of split and new groups |
| m-4 | 03a:648-649 | `LinePrioritized.at_ms` and `recorded_at` are both timestamps; the fold uses `recorded_at` | Say `at_ms` = the draft's `now`, for display only; the fold never reads it or `delay_ms` |
| m-5 | §3.6, PR-3 | The order of `SlipWarned` and `LinePrioritized` in one `fires_alerts` transaction is not fixed, and the slip's `estimated_land_ms` is computed before the priority re-plan | Fix the order (`LinePrioritized` last) and state that the slip shows the estimate before priority |
| m-6 | Test 106 | The PR-4 fold moves other orders (like a boost), so their keys' slip and priority due must be refreshed | Add `LinePrioritized` to test 106's fold set |
| m-7 | 03b:141 vs 03a:656 | The chip says "at least 1" but the engine gives `max(0, …)`; a sticky priority on a line that is now on time shows "Priority · 1 min late" | Owner wording: show "Priority" alone when `minutes_late = 0` |
| m-8 | 03b:429 vs 03b test 93 (03b:612) | The Pass says `load_id` is `null` "before a fire", but members of a stored unfired load carry `load_id` and test 93 uses frozen L2's id; "counts the row's loads on screen" is ambiguous (a lone row in round 3 is tagged "this round") | Align with the engine field; count rounds station-wide in fire order |
| m-9 | 03a:348, :350, :355 (D5, D7, D12) | On a batch station, weights, follow-up, the "Send what's ready" expedite and `returns_boost = false` returns now do nothing (Q3); the decision rows are unmarked | Mark the rows; tell 02 and 03b that expedite has no effect on a batch line |
| m-10 | 03a:941 (§4.2 `ItemAdded` row; decision 7) | The consumer table leaves out `max_delay_ms` (it lists `served_from_zone_id`) | Add the pointer |
| m-11 | 01a:1061 MD-4 | `max_delay_ms: null` with `unlimited` already `true`, and `max_delay_unlimited: false` alone, are undefined; values that are not whole minutes pass the API | State both cases; keep any ms value or require a multiple of 60 000 |
| m-12 | 03a changelog row 8 | "The batch tests that pinned the re-form … are replaced" does not say which tests (`packages/engine/test/batch.test.ts`) | Name them, so the builder does not delete the wrong ones |
| m-13 | Plan Q14, task 34; `apply-event.ts:600-608` | Replaying a **mid-day** v4 log under BQ rebuilds different hidden loads; an old `FireDispatched` fires the union of its ids and the new load's members; `ReservationsShifted` names may not match (`shift_conflict`) | Precondition: install only after `BusinessDayClosed` and its checkpoint; task 34 checks it |
| m-14 | 03a:781 BQ-5 | "a new load placed directly after it": "it" can mean the over-capacity load or the next load (test 149 reads the next load) | Say which |
| m-15 | §3.5.7 | Not stated: priority on a paused station (D21), on stock (degh) lines, on a station whose type changed (§3.11) | One sentence each; add a paused-station test |

---

## The spec writer's 7 self-made decisions

| # | Decision | Ruling |
|---|---|---|
| 1 | Extra `max_delay_unlimited` column + CHECK + 422 | Accept. Clearer than a sentinel value. Close m-11 |
| 2 | Range 0–7 200 000 ms; snapshot defaults | Accept the range; fix M-7 (what 0 means) and M-8 (null vs absent) |
| 3 | 02b split into v1.0.23 + v1.0.24 | Accept |
| 4 | 01b wire change described inside 01a | Reject. Needs a 01b row (M-9) |
| 5 | Return lines copy the served line's max delay | Accept (D25). With `returns_boost` on by default, returns are boosted anyway |
| 6 | 03b round tags, chip minutes from the frame, grouped row = largest n | Accept the largest-n rule; fix m-7 and m-8 |
| 7 | 03a §4.2 `ItemAdded` row without `max_delay_ms` | Reject. Add the pointer (m-10) |

---

## Resolution (2026-11-23)

Owner decision 2026-11-23, verbatim: **"sab recommendations"** (every recommendation accepted). Where the review offered a choice (`OD`), the owner's answer is given. The specs were approved and not yet built, so 03a v1.2.8, 02b v1.0.23 / v1.0.24, 01a v2.7.4, 01c v1.1.3 and 03b v1.0.13 are fixed **in place**, each with a changelog line "post-review fixes 2026-11-23". Two new versions are written: foundation **v1.15** and 01b **v1.10.2**. "03a" below means `03a_Timing_Engine_Spec_v1.2.8.md`. Re-review next, in a fresh session.

| Finding | Owner decision | Fixed where |
|---|---|---|
| B-1 | Spec fix as proposed | 03a §3.3 (`EngineState.priority_due`), §3.5.7 PR-3 (separate per-group map, `slip_due`'s upkeep, independent of the threshold, the open alert and `skipped`; `next_alert_due_at` = the minimum of both maps), §3.8, §6.2a step 7; tests 92 and 106 extended, 153 (+3 cases: slip open, threshold `null`, skipped key) |
| B-2 | Spec fix as proposed | 03a §3.3 (`groups[].priority_land_ms`), §3.5.3 note, §3.5.7 PR-4 (one loop per group, working deadline `d_p`), PR-5; test 155 rewritten (`d_p`, a second re-plan keeps the group together) |
| B-3 | **(a)**: priority never touches frozen lines or frozen / visible loads; it reorders only waiting (hidden) lines and loads; D15, D17, P4 unchanged | 03a §3.5.3 note, §3.5.7 PR-4 ("What it never touches"), PR-7, §3.9 note, To 03b #10; 03b v1.0.13 §3.3; tests 157 extended, 162 new |
| M-1 | Foundation bump **v1.15** (priority = a second, bounded displacement beside boost), APPROVED owner 2026-11-23 | `00_Foundation_Spec_v1.15.md` ("Changes in v1.15" rows P-1–P-4; §4.7 lifecycle row "Priority", station-policy paragraph, D44 tick paragraph, hold-and-fire step 3, each "⚠️ Changed by v1.15 (owner 2026-11-23, STAB-7 review M-1)" with the old text kept); README row F; 03a D4 row and "Changes in v1.2.8" foundation sentence. The story file `docs/stories/03a-g0.md` D4 is not edited (the spec wins) |
| M-2 | Spec fix as proposed | 03a §3.5.7 PR-4 (cascade shed), §3.10 BQ-5 (the same cascade for a capacity drop); test 156 rewritten |
| M-3 | Spec fix as proposed | 03a §3.3 (`EngineLine.arrived_at`; BQ-1 arrival key `(arrived_at, order_id, index in line_ids)`), §3.5.7 PR-4, §3.10 BQ-5; test 163 |
| M-4 | A priority line may use idle time before a held pickup round, ahead of non-priority lines | 03a §3.5.7 PR-4 batch option (b); test 164 |
| M-5 | Spec fix as proposed | 03a §3.5.7 PR-4 (the load's fire ≥ the fire bound); test 165 |
| M-6 | Spec fix as proposed | 03a §3.10 BQ-5 (priority members kept first, then arrival), §3.5.3 note; test 149 extended |
| M-7 | Minimum **60 000 ms**; 0 refused with `422 VALIDATION_FAILED` on the field; one comparison: strict **`>`** | 03a §3.5.7 PR-1, PR-3; 01a v2.7.4 MD-1, MD-2, MD-4, §5.2a, §6.15, tests 202–205; 01c v1.1.3 §4.3 (`min(60000).max(7200000)`), test 130; 01b v1.10.2 §6.10, test 115; 03a test 166 |
| M-8 | Spec fix as proposed | 01a v2.7.4 MD-5 and §4.3 (a missing key → 300 000, an explicit `null` kept), test 204; 02b v1.0.24 §3.2 step 4b, test 58; 03a To 02 #13; plan task 3 |
| M-9 | 01b version bump | `01b_Staff_Roles_Spec_v1.10.2.md` (header, §6.10 marker, test 115, endpoint table); 01a v2.7.4 MD-2 cites it; README row 01b; plan task 4 |
| M-10 | Among priority groups the **larger delay first** (ties: arrival, then `order_item_id`); "no limit" = a far cap of **30 min** (`MAX_DELAY_NO_LIMIT_MS = 1 800 000`); branch default stays 5 min | 03a §3.3 (`groups[].priority_delay_ms`), §3.5.7 PR-1, PR-4, §3.6.1 item 2, §4.2 exports, §10.6 (max-delay simulator scenario, report only); tests 167, 172; 01a v2.7.4 MD-6 ("No limit (priority after 30 min)"); 01c, 02b notes |
| M-11 | A group becomes priority only when a waiting line causes its delay; a cooking or fired driver prioritises nothing | 03a §3.5.7 PR-2 (`E_w`, `F`), PR-3 condition 3; test 168 |
| M-12 | Spec fix as proposed | 03a §3.6.1 item 1 (priority members, then queue order, then arrival); test 148 extended |
| M-13 | Plan reordered, tasks added | `docs/plans/stab-6-7-plan.md`: task 0 (specs, F v1.15, 01b v1.10.2), task 5 (v5 bump with every field first), task 16 (fold + replay list together), task 23 (writer after the fold, with the due term), tasks 14 (B-1), 16 (B-2), 4 and 26 (M-9), 22 (simulator), #106 upkeep in tasks 14 and 16 |
| m-1 | Spec fix as proposed | 03a header and changelog Q5, §3.3 BQ-1 scope, To 02 #12; 02b v1.0.23 / v1.0.24 headers and changelog rows; plan release notes |
| m-2 | Spec fix as proposed | 03a §3.3 BQ-1 scope; test 143 (property part with the exemptions) |
| m-3 | Spec fix as proposed | 03a §3.5.7 PR-2 (immediate groups per line; `T` of a released group and of an addition's group); test 171 |
| m-4 | Spec fix as proposed | 03a §3.5.7 PR-3, §4.2 `LinePrioritized` row; test 154 extended |
| m-5 | Spec fix as proposed | 03a §3.5.7 PR-3, §3.8, §6.2a step 7 (`LinePrioritized` last; slip shows the pre-priority estimate); test 173 |
| m-6 | Spec fix as proposed | 03a test 106 extended (`LinePrioritized` in the fold set) |
| m-7 | "Priority" alone when `minutes_late = 0` | 03a §3.5.7 PR-8, To 03b #10; 03b v1.0.13 §3.3, test 94; 03a test 161 extended |
| m-8 | Spec fix as proposed | 03a To 03b #9; 03b v1.0.13 §3.3 (station-wide round count), §6.15 (`load_id` before a fire), test 93 |
| m-9 | Spec fix as proposed | 03a §3.1 D5, D7, D12, D28 marked; To 02 #14, To 03b #11 (new); 03b v1.0.13 §3.3 |
| m-10 | Spec fix as proposed (decision 7) | 03a §4.2 `ItemAdded` row |
| m-11 | Spec fix as proposed | 01a v2.7.4 MD-4 and §6.15 (every combination; any whole ms value in range kept), test 203 |
| m-12 | Spec fix as proposed | 03a "Changes in v1.2.8" row 8 (the four tests by file and title); plan task 7 |
| m-13 | Spec fix as proposed | 03a §11 note (install only after `BusinessDayClosed` and its checkpoint); plan release notes, tasks 33 and 35 |
| m-14 | Spec fix as proposed | 03a §3.10 BQ-5 (cascade; a new load after the last queued load of the program); test 149 |
| m-15 | Spec fix as proposed | 03a §3.5.7 PR-9 (paused station, stock lines, type change); test 170 |
| Decision 1 | Accepted (review) | m-11 closed (above) |
| Decision 2 | Range accepted with M-7's minimum; M-8 fixed | above |
| Decision 3 | Accepted (review) | — |
| Decision 4 | Rejected (review): needs a 01b row | 01b v1.10.2 (M-9) |
| Decision 5 | Accepted (review) | — |
| Decision 6 | Accepted (review), with m-7 and m-8 | above |
| Decision 7 | Rejected (review): add the pointer | 03a §4.2 (m-10) |

**Readings the fixes had to choose (for the re-review):**
- **B-3, slot station:** a priority line may still take **free** capacity inside the freeze window (it then shows as a new row at the bottom of Next, as a new order's line may, D17 "append"); it never moves, joins or sheds a frozen line or load. The review's text said "first fit after the freeze window"; the owner's wording was "never touches frozen lines … what the cook already sees never changes", which this keeps.
- **BQ-5 uses the M-2 cascade too**, so a capacity drop can no longer put an older unit behind younger ones by skipping a full load (test 149 changed).
- **M-10 "larger delay first"** is read as the delay **at the fold** (`priority_delay_ms`), so priority groups do not swap places at every re-plan.
- **M-11 drive test:** `F(g)` uses the fixed lands at the group's latest fold; a fired-not-started line that slides later between folds is seen at the next fold of the group.
- **Open for the owner:** an explicit item max delay above 30 min (allowed up to 120 min) is later than "No limit" (30 min). The owner app labels "No limit (priority after 30 min)"; the owner may want to cap the item range at 30 min.
