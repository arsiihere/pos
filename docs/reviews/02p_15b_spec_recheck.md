# 02p task 15b: spec re-check (03a v1.2 E-4 fixes, commit 9afb532)

Scope: `git show 9afb532 -- docs/specs/03a_Timing_Engine_Spec_v1.2.md`, against the first check `docs/reviews/02p_15b_spec_check.md` (S-1 to S-15) and the owner rulings of 2026-11-09. Line numbers are those of the file at 9afb532.

I also checked:
- `apps/hub/src/engine-host/replay.ts` :111–121 (`UNTRACKED_IDS_SQL`, `readUntrackedIds`).
- `apps/hub/src/db/migrations/0001_event_store.sql` and `0007_engine.sql` (the `events` table and its indexes).
- `packages/events/src/events/order/OrderLinesAdded.v1.ts`.

## Verdict: APPROVE WITH WORDING FIXES

Each of S-1 to S-15 is fixed as written, or as the rulings say where they differ. Every ruling is stated:
- **Header on every addition.** Used only when the engine does not hold the order, where "holds" means present after the removal step. Ignored otherwise. The field is optional (:458–459, :869, :914).
- **Creation.** It needs non-empty ids, a header and an order the engine does not hold. `placed_at` = `recorded_at`, the six fields come from the header and the groups from the event (:457–462).
- **Re-entry.** A new `EngineOrder` under the same `order_id`, with `next_group_index = 0` and group ids unique only within one `EngineOrder` (:463, :478; test 139).
- **Empty addition.** A no-op with no diagnostic, no alert and no `EngineOrder`; the order stays in the id set (:466).
- **Safety net.** It applies only to non-empty ids, no header and an order the engine does not hold. It raises `InvalidEvent('order_not_in_engine')` carrying `order_item_ids[0]` and the alert key `engine_line_dropped:<order_id>:<order_item_ids[0]>`. Strict throws; non-strict gives one diagnostic and skips the event. The batch's `ItemAdded` events are logged as absent ids unless the order is in the id set, and boot never stops. The catch-all "any other reason" is removed (:468–474).
- **One id-set rule, live and at boot.** A row with a header and non-empty ids removes the order id, a refused one too (:467, :802ff).
- **Day close** is unchanged (:476).

**Boot SQL.** I ran the §3.12 statement through better-sqlite3 13.0.3 against the migration schema:
- It is one valid statement.
- `EXPLAIN QUERY PLAN` gives `SEARCH events USING INDEX events_branch_stream (branch_id=? AND stream_type=? AND seq>?)`, with no `USE TEMP B-TREE`.
- The rows come back in `seq` order.
- On a test set, an `OrderLinesAdded` with an empty id list, a missing header or `order_header: null` is excluded; only the header row with non-empty ids is returned.
- It is the AD-E18 statement plus the `event_type` / `AS id` column, one `IN` entry, one `OR` arm and `ORDER BY seq`.
- `replay.ts` runs the AD-E18 form with `.pluck()`. Task 15b must switch that call to two-column rows (`.all()`, no `.pluck()`). That is an implementation note, not a spec defect.

**Tables.** Every changed table row has its table's column count (escaped `\|` excluded): changes rows :46–47, v0.5 row :205, §4.2 :869, §6.1a :1122, and tests 78, 130–139.

None of the findings below changes a rule. They are stale cross-references and test-coverage gaps.

## Findings

### R-1 MINOR: test 101 and v0.5 row 7 still state "an addition to an exited order is a new `OrderPlaced`" as current

Where:
- :1433, test 101: "fixture of 02 — an addition at minute 35 writes a new `OrderPlaced` with `follow_up: true`".
- :206, v0.5 row 7: "To 02: an addition to an exited order is a new order with `follow_up`".
- :447 (unmarked sentence): "and 02 writes a later addition for that table as a new order (§4.3 To 02 #1)".

Problem: To 02 #1 (:898) now says the choice is 02b's (task 18), and the accepted re-entry case (test 139) is an `OrderLinesAdded` with a header on an exited order. These three places still read as the binding rule, with no marker. Test 101 in particular is a fixture of 02 that task 18 may invert.

Fix:
- Test 101: append "(⚠️ Changed by owner ruling 2026-11-09 (E-4, 15b): which of `OrderPlaced` and `OrderLinesAdded` with `order_header` 02b writes is 02b v1.0.2's rule, To 02 #1, task 18; the engine accepts both, test 139)".
- Row 7: append "(⚠️ E-4, 2026-11-09: 02b's choice, To 02 #1)".
- :447: after "as a new order (§4.3 To 02 #1)" insert "(⚠️ E-4, 2026-11-09: or an `OrderLinesAdded` with `order_header`, 02b's choice, To 02 #1)".

### R-2 MINOR: the "group id unique only within one `EngineOrder`" rule is not in the §4.3 hand-offs

Where: the rule is stated only in §3.3 (a), :463. §4.3 To 02 item 11 (:914) and To 03b (:920ff) do not mention it.

Problem: the ruling binds 02b and 03b. Their builders read §4.3, the "requirements carried to other modules", not §3.3.

Fix:
- Item 11: append "Group ids restart at `order_id:0` for a re-created `EngineOrder` (§3.3 E-4), so 02b must not key per-order history on `group_id`."
- To 03b: add one item: "⚠️ Added by owner ruling 2026-11-09 (E-4, 15b): a `group_id` is unique only within one `EngineOrder`; an order re-created after an exit reuses `order_id:0…` (§3.3 E-4, test 139). Do not key per-order history on `group_id`."

### R-3 MINOR: tests 131–139 miss three rules

1. **"Holds" means present, not `isOrderInEngine`** (:458). Test 137 covers only an order the engine holds that is in its window. Neither of the two cases that tell presence from the predicate is tested:
   - an order past its window but not yet removed;
   - an AD-20-kept order.
2. **"A refused one too" removes the id** (:467). No test covers a header row with non-empty ids that is refused in non-strict mode (for example `group_id_invalid`) and so leaves the set.
3. **The empty addition stays in the set at boot** (:466). The SQL arm `json_array_length(...) > 0` keeps it in the set. Test 135's empty clause does not say whether it checks this live or after a restart.

Fix:
- Test 137: append "; also for an order still present but past its window (`isOrderInEngine` false, not yet removed) and for an AD-20-kept order: the addition re-opens the present order, no new `EngineOrder`, the header ignored".
- Test 135: append "; a non-strict refused `OrderLinesAdded` with `order_header` and non-empty `order_item_ids` (`group_id_invalid`) removes the order id from the id set, live and after a restart"; and in the empty clause write "stays in the id set, live and after a restart (the boot read does not return it)".

### R-4 WORDING: "optional" does not say "never null", but the boot SQL tests `IS NOT NULL`

Where: :459 and :869 ("optional `order_header`"). §3.12 tests `json_extract(payload, '$.order_header') IS NOT NULL`.

Problem: if task 15b's Zod field were `.nullish()`, a logged `order_header: null` would be excluded by the SQL. The fold could then read it as a header or as no header, so the live and boot rules could diverge. As written, "optional" with Zod's `.optional()` refuses `null`, so the two agree. The spec should pin that.

Fix: at :459 write "an **optional** (absent, never `null`) `order_header`", and the same at :869.

### R-5 WORDING: the Absent-ids and §6.1a shorthand says "created from `order_header`" without "non-empty"

Where: :450 and :1122: "created from `order_header`; an empty addition returns `state` itself; else `InvalidEvent`".

Problem: the clause order reads as though any header creates the order. The empty addition with a header is covered only by the next clause.

Fix: "with `order_header` and non-empty `order_item_ids`: created from the header; empty `order_item_ids`: `state` itself; else `InvalidEvent('order_not_in_engine')`".

### R-6 WORDING: the changes row (:46) does not list §6.1a or the v0.5 row 6

Where: :46, "Sections" column.

Fix: add "§6.1a (row 6.1a)" and "v0.5 changes row 6" to the list.
