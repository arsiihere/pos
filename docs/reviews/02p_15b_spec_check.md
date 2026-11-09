# 02p task 15b: targeted spec check (03a v1.2 E-4, "drinks first, food later")

Scope: `git diff d40ffdb~1..HEAD -- docs/specs/03a_Timing_Engine_Spec_v1.2.md`. That covers the E-4 block in §3.3 (:456–472), the §3.12 note (:802), the §4.2 `OrderLinesAdded` row (:855), §4.3 To 02 item 11 (:900), the changes row (:46) and tests 131–138 (:1464–1471).

I checked it against `packages/engine/src/apply-event.ts` (`foldNamed` :1270, `listLines` :240–322, `foldOrderPlaced` :327–354, `foldOrderLinesAdded` :359–367, `foldItemAdded` :426), `packages/engine/src/state.ts` `EngineOrder` :97–115, `packages/events/src/events/order/OrderLinesAdded.v1.ts`, `apps/hub/src/engine-host/replay.ts` :112–125 and `reducer.ts` :109–196.

## Verdict: NOT YET

The text states all six owner rulings correctly: the header and its six fields, `placed_at` = `recorded_at`, no schema change and v3, the header on every addition and ignored when the engine holds the order, a new `EngineOrder` after an exit, leaving the id set through the one read, the safety net with a boot that completes, and day close unchanged.

Every `EngineOrder` field has a source:
- From the header: `order_type`, `table_key`, `table_id`, `follow_up`, `pickup_at_ms`, `placed_by`.
- From `recorded_at`: `placed_at` and `last_line_fold_at`.
- From the groups: `target_land_ms` and `promise_ms`.
- The rest start "as in `foldOrderPlaced`": `boosted`, `line_ids`, `awaiting`, `last_served_at`, `next_group_index` = 0 and `groups`.

The AD-8 reference is correct: §3.3 :476 counts "any refused `OrderPlaced` / `OrderLinesAdded`" as dropped.

It is not approvable yet for three reasons:
1. Five places in the current text still state the old throw as the rule.
2. To 02 #1 still says an addition to an order not in the engine becomes a new `OrderPlaced`.
3. An addition with no engine line on an order the engine does not hold has no rule. As written, the safety net would raise a false dropped-line alert for it.

All fixes are text only; no ruling changes.

## Findings

### S-1 MAJOR: the old "absent order throws" rule is still stated as current

Where:
- §3.3 Exit, :447: "when it is absent, the fold **throws** (a bug: …)" and "so `OrderLinesAdded` is written only for an order in the engine".
- §3.3 Absent ids, :450: "The one exception is `OrderLinesAdded` for an absent order, which throws (above)."
- §3.3 v1.0.1 writer bugs, :475: "The absent-order `OrderLinesAdded` throw stays in both modes."
- §4.2 row, :855: "The order must be in the engine (§3.3), so no order fields are needed" is left without a "Was".
- Test 78, :1385: "an `OrderLinesAdded` for an absent order throws (#2)".
- Summary row 6, :205: "(except `OrderLinesAdded`)".

Problem: only the E-4 block carries "Was: an absent order throws". A builder who reads :447, :450 or :475 or test 78 gets the opposite rule, and test 78 as written would fail against the 15b code.

Fix:
- After :447's "when it is absent, the fold **throws** (…)", add: "⚠️ Changed by owner ruling 2026-11-09 (E-4, 15b): when it is absent, an `OrderLinesAdded` with `order_header` creates the order, and one without is `InvalidEvent('order_not_in_engine')` (§3.3 E-4). Was: throws."
- :450: "The one exception is `OrderLinesAdded` for an absent order (§3.3 E-4: created from `order_header`, else `InvalidEvent('order_not_in_engine')`). Was: which throws."
- :475: "⚠️ E-4: an absent-order `OrderLinesAdded` without `order_header` is now an `InvalidEvent` (strict throws; non-strict: a diagnostic and the event skipped). Was: the throw stays in both modes."
- :855: prefix the old sentence with "Was:".
- Test 78: "an `OrderLinesAdded` for an absent order without `order_header` throws `InvalidEvent('order_not_in_engine')` when strict (E-4; was: throws)".
- :205: append "(E-4: an absent-order `OrderLinesAdded` creates the order from `order_header`, else `InvalidEvent`)".

### S-2 MAJOR: To 02 #1 contradicts the accepted "food after the earlier food left the engine" case

Where: §4.3 To 02 #1, :884, and §3.3 :447. Both say: "an addition to an **exited** order … write it as a **new order** (`OrderPlaced` …)" and "`OrderLinesAdded` is written only for an order in the engine (`isOrderInEngine`)". 02b v1.0.1 O1 (:52) also says "`OrderLinesAdded` only for `ReturnToKitchen`".

Problem: under #1, 02 never writes an `OrderLinesAdded` on an order that left the engine. Nor does it write one on a ready-items-only order, where `isOrderInEngine` is false. Yet the E-4 block (:472) and item 11 (:900) name both as the cases the header serves. #1 still binds 02 as unchanged text.

Fix: add to To 02 #1 (and point to it from :447):

> ⚠️ Changed by owner ruling 2026-11-09 (E-4, 15b): choosing between `OrderLinesAdded` and a new `OrderPlaced` for an addition is 02b's rule (02b v1.0.2, 02p task 18). The engine accepts an `OrderLinesAdded` with `order_header` on an order it does not hold (§3.3 E-4), so "written only for an order in the engine" is no longer an engine invariant.

Item 11 should then say that task 18 also reconciles 02b O1 and To 02 #1 with this.

### S-3 MAJOR: an addition with no engine line on an order the engine does not hold has no rule

Where: §3.3 (a) :457 says "with at least one engine line". (b) :465 says "or any other reason the order is unknown".

Problem: take an `OrderLinesAdded` whose `order_item_ids = []` (zone or ready items only, as Q-3's empty `OrderPlaced`) on an order the engine does not hold, for example drinks first and more drinks later:
- (a) does not apply.
- (b)'s catch-all makes it `InvalidEvent`, which raises a false `engine_line_dropped` alert.
- The id-set rule (:464, :802) would also remove the order from the set when the row carries a header.

Fix: add a bullet (a′) to §3.3:

> An `OrderLinesAdded` with `order_item_ids = []` on an order the engine does not hold returns `state` itself, with no diagnostic, no alert and no `EngineOrder`, header or not, as Q-3's empty `OrderPlaced`. The order stays in the id set.

Reword (b): "An `OrderLinesAdded` with non-empty `order_item_ids` and no `order_header`, on an order the engine does not hold, is `InvalidEvent('order_not_in_engine')`." Drop "or any other reason the order is unknown". Key both on `order_item_ids.length` (as `foldOrderPlaced` :331), not on "engine line". Add a test clause to 135 for the empty case.

### S-4 MINOR: the live rule and the boot rule for leaving the id set differ

Where: §3.3 :464 (live: "when the commit that creates it is folded") vs §3.12 :802 (boot: every `OrderLinesAdded` row that carries `order_header`).

Problem: 02b sends the header on every addition, so the two rules differ on two cases:
- an empty addition (S-3);
- a header addition that the engine refuses non-strict (for example `group_id_invalid`).

In both cases the live set keeps the id and the boot set drops it, so the noise differs before and after a restart.

Fix: use one criterion in both places: "a committed `OrderLinesAdded` with `order_header` and non-empty `order_item_ids` removes its order id (a refused one too: its lines are already alerted as dropped)". The SQL arm becomes `OR (event_type = 'OrderLinesAdded' AND json_extract(payload, '$.order_header') IS NOT NULL AND json_array_length(payload, '$.order_item_ids') > 0)`.

### S-5 MINOR: "ordered by `seq`" is stated, but the statement has no `ORDER BY`

Where: §3.12 :802, against the AD-E18 statement at :793–797 (also `replay.ts` :114–117), which has no `ORDER BY`.

Problem: adds and removes are now applied in order, so the order of the rows matters. SQLite guarantees no order without `ORDER BY`. The note describes the change in prose and never writes out the resulting statement.

Fix: write the full statement in the note:

```sql
SELECT event_type, CASE event_type WHEN 'ItemAdded' THEN json_extract(payload, '$.order_item_id') ELSE json_extract(payload, '$.order_id') END AS id FROM events
WHERE branch_id = ? AND stream_type = 'order' AND seq > ? AND event_type IN ('ItemAdded', 'OrderPlaced', 'OrderLinesAdded')
  AND ((event_type = 'ItemAdded' AND (json_extract(payload, '$.served_from_zone_id') IS NOT NULL OR json_extract(payload, '$.line_kind') = 'deal'))
    OR (event_type = 'OrderPlaced' AND json_array_length(payload, '$.order_item_ids') = 0)
    OR (event_type = 'OrderLinesAdded' AND json_extract(payload, '$.order_header') IS NOT NULL AND json_array_length(payload, '$.order_item_ids') > 0))
ORDER BY seq
```

Then state "`ORDER BY seq` is the index order (`events_branch_stream`), so there is no sort step; test 130 `EXPLAIN QUERY PLAN` shows no temp B-tree".

### S-6 MINOR: no test for "food after the earlier food left the engine"

Where: §10.3f :1464–1471. Tests 131–138 cover live, replay, restart, a torn newer checkpoint, the safety net, day close, the header ignored and the schema, but not this owner-accepted case.

Fix: add test 139:

> 15b re-entry: an order served and removed from the engine; then an `OrderLinesAdded` with `order_header` and one new line → a new `EngineOrder` with the same `order_id`, `placed_at` = its `recorded_at`, `next_group_index` from 0 (group `order_id:0`), only the new line in `line_ids`, the old line ids not in `state.lines`; replay = live.

Update the "Tests 120–138" row (:47) to match.

### S-7 MINOR: group ids restart at `order_id:0` and repeat within one order's life

Where: §3.3 :461 ("the other fields start as in `foldOrderPlaced`" gives `next_group_index` = 0) and §3.3 :480 (deterministic ids). `planOrder` agrees (`plan.ts:1209`: `next_group_index ?? 0` for an order the engine does not hold).

Problem: in the re-entry case, `order_id:0` names a second group of the same order. Neither the text nor 02b says that a group id is unique only within one `EngineOrder`'s life.

Fix: add to (a): "`next_group_index = 0`: the group ids restart at `order_id:0` (`planOrder` proposes them the same way), so a group id is unique only within one `EngineOrder`. 02b and 03b must not key per-order history on `group_id`." Cover it in S-6's test.

### S-8 MINOR: the `InvalidEvent`'s `order_item_id` and the batch alert key are not defined

Where: §3.3 (b) :465–467 and the §4.2 hub alert row :831 (refused batch key `engine_line_dropped:<order_id>:<first offending order_item_id>`).

Problem: the `InvalidEvent` constructor (`invalid-event.ts:6–9`) needs an `order_item_id`, and the batch dedupe key is built from it. Nor does the text say what happens to that batch's `ItemAdded` events.

Fix: add to (b): "carrying `order_item_ids[0]` (as `checkStream`); one batch fact, key `engine_line_dropped:<order_id>:<order_item_ids[0]>`. Its `ItemAdded` events are then absent-order no-ops (`foldItemAdded` :434), logged as absent ids unless the order is in the id set."

### S-9 MINOR: the restart tests miss the replay-hook removal path

Where: tests 133 and 134, :1466–1467.

Problem: test 133 adds the food after the restart (the live path). Test 134 removes the id through the id-set read. No test covers the food `OrderLinesAdded` landing after the snapshot or checkpoint seq and before the restart, so that the step-3 replay hook removes the id.

Fix: add a clause to 133: "food `OrderLinesAdded` after C, then restart: the replay hook removes the id, and a later `ItemVoided` on an unknown line of that order **is** logged".

### S-10 WORDING: "the step-3 replay hook does the same for rows after H"

Where: §3.3 :464.

Problem: the replay covers seq > the step-2 base (snapshot or checkpoint), not seq > H. H is the bound of the id-set read.

Fix: "The step-3 replay hook does the same for the replayed `OrderLinesAdded`; the read and the replay both apply in `seq` order, so the result is one ordered pass."

### S-11 WORDING: "does not hold" is not defined

Where: §3.3 :457, :463 and :465.

Problem: §3.3 :447 says every reader uses `isOrderInEngine`, never presence. The fold here is keyed on presence (`state.orders[order_id]`, after the removal step skipped this order). A present order that is past its window or kept by AD-20 re-opens, and its header is ignored.

Fix: add "(holds = present in `state.orders` after the removal step, which skips this order, :447; not `isOrderInEngine`)".

### S-12 WORDING: no D62 reason given for keeping `ENGINE_STATE_VERSION` 3

Where: §3.3 :462 and test 132.

Problem: E-4 changes what `applyEvent` does with a headerless `OrderLinesAdded` on an absent order, which is an existing event shape. The reason v3 still holds is not given.

Fix: add "Before E-4 such an event threw a plain `Error`: live the command rolled back and nothing was appended, and in the log it would stop boot. So no booted log holds one, and old logs fold the same (D62; v3 stays)."

### S-13 WORDING: `placed_by` nullability and source

Where: §3.3 :458 lists the six header fields without the `| null` types. §4.3 item 11 (:900) says "`placed_by` = the order's original placer".

Fix: in §3.3 use §4.2's types (`table_id | null`, `pickup_at_ms | null`, `placed_by | null`). In item 11 write "`placed_by` = the envelope `actor_id` of the order's `OrderPlaced` (as `EngineOrder.placed_by`, §4.2)".

### S-14 WORDING: the test citation and the changes row

Where:
- §3.3 :462 cites "(test 94, D62)" for "`buildEngineState` must equal the live fold". Test 94 (:1407) is the static event-type set test.
- The changes row E-4 (:46) lists §3.3, §3.12, §4.2, §10.3f.

Fix:
- At :462 cite the replay-equals-live identity (D13 / D62, test 132) and keep test 94 only for "no new event type".
- Add §4.3 (To 02 #1 and item 11) to the changes row, and the §3.3 Exit and Absent-ids places once S-1 is applied.

### S-15 WORDING: the boot-completes clause in test 135

Where: test 135, :1468, "with the state = the same log without it".

Fix: "with the state equal to a fold of the same log without it, diagnostics aside (its `ItemAdded` events are absent-order no-ops)".
