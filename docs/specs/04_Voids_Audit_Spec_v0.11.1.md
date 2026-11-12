# 04 Voids + Audit — Module Spec

| | |
|---|---|
| Module | 04 Voids + Audit (hub) |
| Version | **v0.11.1 — Draft, APPROVE-READY (final check `docs/reviews/04_v0.11_final_check.md`); waiting for owner approval** (developer, 2026-11-12) |
| Inherits | Shared Standards from **Foundation v1.12** §6 (envelope, errors, hub HTTP, WS, list cursor, naming, tests, migrations, folders); not redefined here |
| Depends on | Foundation v1.12; 00 Hub Platform v1.9; 01a v2.4.3 (`CloseBusinessDay`, row A-1); 01b v1.8; 01c v1.1.2; 01d v1.2.4; 02a v1.1.4; 02b v1.0.9; 03a v1.2.3; read-only: 03b v1.0.5, 03c v1.0.5 (merged on `main`, PR #76; their "Exposes" are taken as given). The deltas since v0.8's base (02b v1.0.6–v1.0.9, 01d v1.2.2–v1.2.4, 03a v1.2.1–v1.2.3, 00 v1.9, F v1.12, 01a v2.4–v2.4.3, 01b v1.8) were read for conflicts with 04's rows: none, except 02b v1.0.9's B3-5 lesson (H8-1, row H-2) and main's `details.identifier` (H8-4) ⚠️ Changed by v0.9 (H8-2) |
| Read by | 05 (pending voids, bill close), 06 (cloud audit view), 07 |
| Stories | `docs/stories/04-g0.md`, `docs/stories/04-g1-decisions.md` (G1 complete, owner 2026-11-11 19:31 PKT) |
| Reviews | `docs/reviews/04_v0.1_hostile_run1.md` (FIX: 2 BLOCKER, 9 MAJOR, 15 MINOR, 8 NIT); `docs/reviews/04_v0.2_hostile_run2.md` (FIX: 0 BLOCKER, 7 MAJOR, 11 MINOR, 6 NIT; run 1 26 FIXED, 8 PARTLY); `docs/reviews/04_v0.3_hostile_run3.md` (FIX: 0 BLOCKER, 1 MAJOR, 6 MINOR, 7 NIT; 31 FIXED, 1 PARTLY); `docs/reviews/04_v0.4_targeted_check.md` (FIX: 0 BLOCKER, 1 MAJOR, 3 MINOR, 5 NIT; 10 FIXED, 3 PARTLY, 1 REGRESSED); `docs/reviews/04_v0.5_targeted_check.md` (FIX: 0 BLOCKER, 1 MAJOR, 2 MINOR, 3 NIT; 7 FIXED, 2 PARTLY); `docs/reviews/04_v0.6_hostile_run4.md` (full run 4, FIX: 0 BLOCKER, 3 MAJOR, 7 MINOR, 7 NIT; Part A 10 OK / 4 GAP, Part B 24 HOLDS / 2 BROKEN); `docs/reviews/04_v0.7_hostile_run5.md` (full run 5, FIX: 0 BLOCKER, 2 MAJOR, 6 MINOR, 6 NIT; Part A 11 OK / 4 GAP, Part B 28 HOLDS / 2 BROKEN) |
| Branch | `spec-04` from `origin/main` @ `45828a7`, `origin/main` @ `79e907b` merged in (03b merged) ⚠️ v0.9 (H8-2) |

### Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-11 | First draft from G0 + G1 (owner rulings K-1–K-8, Q1–Q16). |
| **v0.2** | 2026-11-12 | Fixes every finding of hostile run 1 (H1-1–H1-34), each marked "⚠️ Changed by v0.2 (H1-n)". Owner answers to the review's questions (2026-11-12, all Rec): **OQ-A** `move-item-to-stock` is allowed-only (never approvable, row B-2); **OQ-B** a pending-weight line may be voided, refund 0; **OQ-C** a deal's cooked parts may go to pre-cooked stock while its unstarted parts are just released; **OQ-D** a `moved` void whose line is served meanwhile cannot be approved — withdraw and re-ask, with a clear message. Main changes: `apply` no longer re-checks its own lock (H1-1); one `withStockEffects` and one `lineChangeDrafts` per command (H1-2); working copy + no overlapping entries (H1-3); `COMP_PENDING` on the request path only (H1-4); pending amount split refund / comp-voided (H1-5); non-engine lines (H1-6); line guard on planned touched ids incl. comp approve (H1-7); audit fold reads events only, names at read (H1-8); foundation cursor (H1-9); per-line frozen dispositions (OQ-C, OQ-D). |
| **v0.3** | 2026-11-12 | Fixes every finding of hostile run 2 (H2-1–H2-24) and the 8 PARTLY run-1 rows, each marked "⚠️ Changed by v0.3 (H2-n)". Owner answers (2026-11-12, both Rec): **OQ-E** the hub keeps a never-deleted `staff_names` list (row H-1, 00 v1.10) so leavers and no-PIN staff show their name; **OQ-F** a part stored `null` at raise that started cooking before the approve becomes `wastage` at approve. Main changes: 02b `lineChangeDrafts` judges only comp requests of changed lines (H2-1, row Q-4); `AlertDetailsBase.disposition` (H2-3, row D-3); backfill writes `role_permission_approvers` (H2-4, row B-1); `pending-voids.blocked` tells the requester (H2-5); moved portions never reserved by the same order (H2-6, row T-2 code); `values` carry the amounts (H2-8); test-46 invariant on the projection (H2-9); audit query de-duplicated and sort rules stated (H2-10, H2-11); reset by checkpoint delete (H2-12); 422 for B-2 (H2-13); item with a started child (H2-14). |
| **v0.4** | 2026-11-12 | Fixes hostile run 3 (H3-1–H3-14), each marked "⚠️ Changed by v0.4 (H3-n)". No owner question. Main changes: audit columns per action — the **requester is the actor** of an approved void / comp money row (H3-1); T-2 excludes only lines ending in the same `stockEffects` array, not the whole order (H3-2); "not started" defined per line kind, headers always `null` (H3-3); V1 precedence for option children and Void-all grouping from `void-preview` (H3-4); the weight half of Q-3 dropped — 02b already refuses with `LINE_ALREADY_SETTLED` (H3-5); staff + multi-action query shape and `action` de-dup (H3-6, closes H2-11); rule 6 (c) skips an already-stale comp request (H3-7). |
| **v0.5** | 2026-11-12 | Fixes the v0.4 targeted check (H4-1–H4-9), each marked "⚠️ Changed by v0.5 (H4-n)". No owner question. T-2 excludes every line the **whole array** ends (Σ units of all `ItemVoided` / `ItemRemoved` causes, wherever they sit), closing the H3-2 regression (H4-1); `audit_requests.answerer_staff_id` resolves the approver of a moved row without look-ahead (H4-2); **header** defined once, option-child "not started" mirrors V1 (d) (H4-3); audit query = plain `UNION ALL` + one outer `ORDER BY … LIMIT`, cursor in every branch (H4-4, H4-6); requester fallback (H4-5); `void-preview` takes several lines (H4-8); `day_closed` text (H4-9). |
| **v0.6** | 2026-11-12 | Fixes the v0.5 targeted check (H5-1–H5-6), each marked "⚠️ Changed by v0.6 (H5-n)". No owner question. T-2 excludes **every line any `ItemVoided` / `ItemRemoved` cause in the array names** (Σ ≥ 1), not only lines ended whole — a partly voided line keeps its pre-void draw in the scratch and would over-reserve (H5-1); header only when a touched child is an engine line, no-engine child "not started" exactly V1 (d) (H5-2); multi-id `void-preview` reports rules 2 / 4 per preview, Void all leaves return lines out and says so (H5-3); 10g is a pure engine test (H5-4); test 52 text (H5-6). |
| **v0.7** | 2026-11-12 | Fixes full hostile run 4 (H6-1–H6-17), each marked "⚠️ Changed by v0.7 (H6-n)". Owner answers (2026-11-12, both Rec): **Q-R1** a return (remake / fix) line can leave the order like any line — Remove at stage 1, void past it, refund 0 (rule 2 dropped, H6-1); **Q-DC** day close is **refused while any void request is open** (new 01a row A-1, `DAY_CLOSE_BLOCKED`), so no `moved` request survives into another day (H6-2). Also: `GET /queries/audit-staff` lists everyone in `staff_names` for the picker (H6-3); `request_closed` audit action from `AlertClosed` (H6-4); D-3 lands on 03b's widened base / next `AlertRaised` version (H6-5); `moved_partly` only for a real partial move (H6-6); split guard only on moved orders (H6-7); Void all per-entry defaults and stop-on-Remove-failure (H6-8); `staff_names` seeded by its migration (H6-9); tests (H6-10); NITs H6-11–H6-17. |
| **v0.8** | 2026-11-12 | Fixes full hostile run 5 (H7-1–H7-14), each marked "⚠️ Changed by v0.8 (H7-n)". No owner question. **Version numbers renumbered** after `module-03b`'s owner-approved bumps (H7-2): 01d **v1.2.5**, 02b **v1.0.10**, 03a **v1.2.4**, D-3 → `AlertRaised` **v4**; the K-4 rule now applies to every row at task 0. Void `apply` calls `lineChangeDrafts` in a mode that does not judge comp requests (H7-1); `request_closed` under the requester (H7-3); A-1 day-close refusal reaches the admin page with a usable list (H7-4); Q-DC leftovers removed (`day_closed` on approve / `blocked`, test 26, 01d / F texts) (H7-5); exact Zod per new field (H7-6); station-less lines are quiet in the engine host (03a row T-3, H7-7); takeaway token on the card (H7-8); NITs H7-9–H7-14. |
| **v0.9** | 2026-11-12 | Fixes the v0.8 targeted check (H8-1–H8-12), each marked "⚠️ Changed by v0.9 (H8-n)". No owner question. `spec-04` merged with `main` after 03b's merge; dependencies re-pointed to main's versions (H8-2). New 00 row **H-2**: `applyAll` only updates checkpoint rows, so a new / reset `audit` projection replays from seq 0 even after a boot-time `ClockAlarm` — the 02b B3-5 trap (H8-1). T-3 rewritten: `ItemVoided` / `ItemRemoved` never log an absent id, in the hub host (H8-3). Card identity via main's `details.identifier` / `identifierText`, `table_code` stays a table code (H8-4). Test 24b and A-1 client file (`StockApp.tsx`) (H8-5). D-1 by section, plus 01d's override / REJECTED / WITHDRAWN rows (H8-6). NITs H8-7–H8-12. |
| **v0.10** | 2026-11-12 | Fixes the v0.9 targeted check (H9-1–H9-7), each marked "⚠️ Changed by v0.10 (H9-n)". No owner question. H-2 now carries the 00 text it changes (M48, §5.8, boot step 4) and the test helpers it needs (`createTestHub` runs `catchUp`, the big fixture seeds every registered projection, M48 registry test rewritten), plus the setup-path invariant (H9-1, H9-7). T-3 removes `ItemRemoved` / `ItemVoided` from `LINE_EVENTS` and restates 03a rows #125, #133–#135 and R-3 with an `ItemDone` probe (H9-2). Card identifier: 04 builds an `Identifier` and its own `identifierText` copy (as 03c does), `readOrder` gains `table_ids`, `details_schema` picks `identifier` (H9-3). Build table repaired (H9-4); §2 / §12.5 name H-2 (H9-5); D-1 adds 01d's OVERRIDDEN row and decisions row 4 (H9-6). |
| **v0.11** | 2026-11-12 | Fixes the v0.10 targeted check (H10-1–H10-7, all MINOR / NIT), each marked "⚠️ Changed by v0.11 (H10-n)". No owner question. T-3 probes become `ItemServed { source: 'tap' }`, R-3's accepted warn is gone and its test removed / restated, the host's line ids are noted as unread (H10-1); `table_ids` orders inside the aggregate (H10-2); the identifier is a copy of **03b's** `identifierText` (40-char slice) and `passIdentity`'s dine-in branch with names and the no-seating fallback (H10-3); 00 test #67 seeds a row first (H10-4); one exported `registerHubProjections(registry)` used by `createDeps`, `createTestHub` and the big fixture, which also adds `access_reconcile` (H10-5); `createTestHub` catches up on the writer's branch id (H10-6); test 20b (H10-7). |
| **v0.11.1** | 2026-11-12 | Final check `docs/reviews/04_v0.11_final_check.md`: **APPROVE-READY** (12 FIXED, 0 BLOCKER / MAJOR / MINOR, 3 NIT; H-2 and T-3 built in scratch worktrees, full hub suite green). The 3 NITs fixed, marked "⚠️ Changed by v0.11.1 (H11-n)": the identifier equality test renumbered **20c** and §3.5 lists its seven fixtures (H11-1); "no current table" keyed as 03b's `currentTableOf` (H11-2); T-3's 03a list adds §3.3 host filter and row Q-3 (H11-3). |

---

## §1. Header

### 1.1 Stories covered

- **E6 "Item lifecycle enforcement"** (P1): stages 2–4 for `void-item` / `move-item-to-stock`; each void logged with actor, time, reason, item, order. Stage 1 (Remove) is 02b's.
- **E6 "Pending void on bill and table close"** (P1, D11): AC1 PENDING VOID and excluded from the total (shown by 05 from §4.2), AC2 approvers alerted (01d), AC3 table not closable while pending (05 refuses, 02a merge / split refuse), AC5 approved → off the bill, AC6 rejected → stays, requester and order taker told. **AC4 (timeout override) is not built** (owner Q9, §12.4).
- **E6 "Immutable audit log"** (P1): AC1, AC3–AC5 on the **hub** (LAN); AC2 **partly** (owner Q14 curated list, §10 acceptance); the cloud / remote view is 06's (owner K-8 revised).
- **E0 "Refunds, cancellations, complimentary items"** AC4 (cancel a whole order: Remove for stage-1 lines + void for the rest, one request per line, owner Q5) and AC5 (permission + audit).
- **E-REQ / R22**: approvals answered on the approver's own device (01d `void_approval` kind).
- Carried rows README :199, :213, :225, :227, :239, :242; 02b §4.3 To 04; 03a §4.3 To 04, §12.3 Q12.

### 1.2 In scope

`VoidItems` (direct or approval); kind `void_approval` with read-only `apply` / `onWithdraw`; dispositions `moved` / `wastage` / `staff_meal` / `other`; the void lock on lines (02b line guard) and the merge / split guard (02a); `pendingVoids` for 05; queries `void-preview`, `pending-voids`, `audit-log`; projection `audit` (tables `audit_entries`, `audit_requests`, `audit_orders`) and the pure audit map shared with 06; the staff-app Void sheet and Audit log screen.

### 1.3 Out of scope

Stage-1 removal (02b). Refunds after a bill closes (`apply-refund`, 05). The bill, PENDING VOID on the bill, bill-close refusal and the Z report (05, from §4.2). Override after N minutes (F §4.5 OVERRIDDEN; owner Q9, §12.4). Resell of a served item (D10 stage 5, off by default). A "VOID?" tag on the KDS (owner Q8). Owner-editable reason lists (owner Q4). Cloud / remote audit view and hub → cloud event sync (06). Owner config changes (cloud `config_audit`, 01a / 01b / 01c). Wastage / staff-meal reports (05 / 07 / 08 read `ItemVoided.disposition`). Rejection reasons (01d `RequestAnswered` carries none).

### 1.4 Decisions log

| ID | Decision | Source |
|---|---|---|
| V1 | **A void is past stage 1 only.** Past stage 1 = (a) an **engine line** at `cooking`, `done`, `served`, `returned`; (b) any line of an order that left the engine (`out_of_engine`); (c) a **line the engine never held** (no station, e.g. a cold drink) with `served_at` set; (d) an **option child with its own engine line** is judged by its own stage, as (a); an **option child with no engine line** by its parent's stage (its own `served_at` when the parent is not an engine line either); (d′) an **`item`** is past stage 1 when it **or any of its option children** is (its children at `added` get `null`, mirror of (e)); (e) a **deal** judged by its parts (at least one part past stage 1); (f) a zone-served line past its undo window. Otherwise `409 ITEM_WRONG_STAGE` (`added`, `zone_undo`) → the client offers 02b's Remove. Unbilled orders only. ⚠️ Changed by v0.2 (H1-6), v0.3 (H2-14), v0.4 (H3-4) | D10, F §4.2, owner Q2 |
| V2 | **One ledger.** Money comes from 02b's `planVoid` (uncomped units first, comped unit → `comp_voided_minor`, deal / child cascades with caps, 01c §3.4.8); 04 writes the resulting `ItemVoided` payloads and 02b's projection folds them. 04 keeps no money column. A comped unit's void does **not** change the bill (`comp_minor` → `comp_voided_minor`); only `refund_minor` lowers it. ⚠️ Changed by v0.2 (H1-5) | 02b §3.4, O19, O21; K-6 |
| V3 | **Dispositions** `moved` (to pre-cooked stock; next order takes it), `wastage`, `staff_meal`, `other`. The entry's disposition becomes a **per-line disposition** fixed when the void is asked (§3.3), using **not started** and **header** as defined in §3.1; **a header always gets `null`** (the food is on the parts / children; no double wastage) ⚠️ Changed by v0.4 (H3-3), v0.5 (H4-3). A touched line not started gets `null` (released, nothing cooked, OQ-C); with `moved`, a touched line that is engine-open at `cooking` / `done` **and** has a stock draw gets `moved`, any other touched line past stage 1 gets `wastage`; at least one line must get `moved`, else the entry is refused. `moved` also needs the caller's `move-item-to-stock` `allowed` (the permission is allowed-only, row B-2, OQ-A) and an open business day; a request never outlives its day, because day close is refused while one is open (row A-1, Q-DC) ⚠️ Changed by v0.7 (H6-2). **At approve** a non-header line stored `null` that is no longer not started (the kitchen started it while the void waited, owner Q8) is written as `wastage` (OQ-F); stored `moved` stays frozen (OQ-D, §3.4). ⚠️ Changed by v0.2 (OQ-A, OQ-C), v0.3 (OQ-F, H2-2) | owner 2026-11-07, Q3, OQ-A, OQ-C, OQ-F |
| V4 | **`moved` = `ItemMovedToStock` then `ItemVoided`**, both inside one `withStockEffects` array (a partial `ItemVoided` shrinks the draws `moveDrafts` reads). `ItemMovedToStock` only for lines whose per-line disposition is `moved`. `move-item-to-stock` is a right to choose the disposition, never a way past `void-item`'s approval. ⚠️ Changed by v0.2 (H1-28) | K-3, 03a §3.7 |
| V5 | **Every approval-born event carries the request's `alert_id`** (01d `checkAlertIds` unchanged): `ItemMovedToStock`, `ItemVoided`, every `stockEffects` draft and `lineChangeDrafts`' `OrderCancelled` / `OrderFoodCleared`. The schemas gain an optional `alert_id` (rows T-1, Q-1). | K-1 |
| V6 | **`ItemVoided` carries the why**: `reason_code`, `note`, `disposition` (per line, nullable), `requester_staff_id`, `approver_staff_id` (null on a direct void), `alert_id` (null on a direct void) — the 02b `LineComped` pattern. The approver is `AnswerFacts.answerer_staff_id`, never `actor_id`. | K-2, 01d To 04 |
| V7 | **One request per entry** (the named line; its cascade travels with it). A whole-order cancel is one `VoidItems` with several entries → one request each, raised in one transaction. In the approval path **no two entries may touch the same line** (`400`), and no touched line may be in another open void request, so every line is in at most one request. ⚠️ Changed by v0.2 (H1-3) | owner Q5, Q6 |
| V8 | **A line in a pending void is locked**: every line in the request's `values.touched_ids` refuses another void, a comp (raise **and** approve), a remove and a weight (`409 VOID_PENDING`) until the request ends; 02b's guard is asked with the **planned** touched ids of the comp / remove, not just the named line. Served, Done and returns still work (OQ-D: a `moved` line served meanwhile makes the approve fail, §3.4). Symmetric on the **request path only**: a void request whose touched lines meet an open `comp` request's lines (named line plus its cascade) → `409 COMP_PENDING`. A direct void closes stale comp requests as 02b specifies (G1-1b). With row Q-4 (02b `lineChangeDrafts` judges only comp requests on the lines it is given, and offers `{ stale_comps: 'keep' }`), `apply` never closes a comp: the void `apply` calls it with `stale_comps: 'keep'`, so an already-stale comp request on a touched line (let through by rule 6 (c), H3-7) stays open and is rejected later (its own approve is already refused by `applyComp`'s check) ⚠️ Changed by v0.8 (H7-1). ⚠️ Changed by v0.2 (H1-4, H1-7), v0.3 (H2-1) | owner Q7, K-1, G1-1b |
| V9 | **No override.** A pending void ends by approve, reject or withdraw only; the bill stays blocked. Coverage is configuration (`approve-void` grants). | owner Q9 |
| V10 | **Withdraw = never asked.** `onWithdraw` returns `[]`; 01d records `RequestWithdrawn`; the lock lifts. | owner Q10 |
| V11 | **Reject** changes nothing on the bill; `apply` returns `[]`. The requester gets 01d's `request_result`; for dine-in the table's holder also gets one through 01d's `result_also_to` (row D-2), so no foreign `AlertRaised` is returned by `apply` (V5). | owner Q11, K-1 |
| V12 | **Fixed reason codes** `customer_changed_mind`, `wrong_order_taken`, `too_late`, `quality`, `other`. `note` (≤ 200) is required when `reason_code = 'other'`; `disposition_note` (≤ 200) is required when any entry's disposition is `other`. ⚠️ Changed by v0.2 (H1-29) | owner Q4 |
| V13 | **Customer's own wrong order** = a normal void (reason `wrong_order_taken` or `customer_changed_mind`) plus a new normal order. No third return mode. | owner Q12, 03a Q12 |
| V14 | **No table lock** for a void (D39 / 02b O9: only `SubmitOrder` and `RemoveItems` call `requireLock`). Scope `branch` (01b catalogue). | 02b O9 |
| V15 | **Approvable, not queueable** (02b O13 precedent). ⚠️ Changed by v0.2 (H1-32) | 02b O13 |
| V16 | **Audit log = a read model over the immutable event store.** Projection `audit` folds a **curated** action list (§3.6) and reads **only events** (its own tables, never another projection, the `alerts` table or the directory — 02a T19 / 02b §5 rule), so a rebuild from seq 0 equals live. Nothing edits the events (D52), so the log cannot be edited. Names are resolved **at read** from the hub's never-deleted `staff_names` list (row H-1, owner OQ-E): leavers and no-PIN staff keep their last known name. The pure map `toAuditEntry` lives in `@pos/domain` so 06 builds the cloud copy from the same rules. ⚠️ Changed by v0.2 (H1-8, H1-26), v0.3 (OQ-E, H2-7) | E6 audit AC1, owner Q14, K-8 revised |
| V17 | **Audit view on the hub, LAN only**, staff app, `view-audit-log`; Foundation §6 list cursor; CSV built in the browser from the same JSON query (no non-envelope endpoint, F §6.1). ⚠️ Changed by v0.2 (H1-9) | owner Q13 / K-8 revised, Q15 |
| V18 | **A pending-weight line may be voided; refund 0** (its `refundable_minor` is 0 until weighed, 02b §3.6). After the void, `SetLineWeight` on it is already refused by 02b with `409 LINE_ALREADY_SETTLED` (a unit is out of billing, `set-line-weight.ts:53`), so a later weight can never make it billable. ⚠️ Changed by v0.2 (OQ-B, H1-15), v0.4 (H3-5) | owner OQ-B, README :213 |

---

## §2. Existing architecture that must not change

- **Events** are INSERT-only with triggers (F §4.1, D52); every command goes through 00's registry (`defineCommand`, `approvable`, fixed processing order, `processed_commands`, D32).
- **01d** owns the request record, steps (`APPROVAL_TIER_STEPS`), answer rules (self, range, PIN, `in_person`), receipts and `request_result`; `apply` / `onWithdraw` run read-only in `preRead` and in `handle` (writes throw; a throw refuses the answer) and every returned draft must carry the request's `alert_id` (`alerts/commands/request-row.ts:107`, `answer-request.ts:108`). **Unchanged.**
- **02b** owns `order_lines` money and its fold of `ItemVoided { refund_minor, comp_voided_minor }` (`orders/projection.ts:293`), `planVoid`, `lineChangeDrafts` (reads the order's lines **before** the change — call it once per command; today it judges every open comp request of the order, after row Q-4 only those on changed lines), `seatingTotals` (no pending voids in it), comps (`comp:<order_item_id>` dedupe, `COMP_PENDING`).
- **03a** owns the `ItemVoided` / `ItemMovedToStock` / stock schemas, the engine folds (`foldItemEnded`, `partialVoid`: a void of any stage before served ends or shrinks the line; served lines are engine no-ops) and `stockEffects` (array form: bookkeeping is threaded **within one call** only).
- **Hub commands** own `withStockEffects` and `openDayStockCtx` (`commands/set-precooked-stock.ts`). ⚠️ Changed by v0.2 (H1-33)
- **02a** asks `checkMergeGuard` on merge and split (`MERGE_BLOCKED_BY_VOID`), unregistered → never blocked.
- **03b / 03c** drop voided lines from KDS / Pass and print a CANCELLED slip for a printed, not-done line (03c §3.3) — unchanged; 04 adds nothing to them.
- **01b** permissions `void-item` (approvable, scope `branch`), `move-item-to-stock` (`branch`), `approve-void` (`branch`, `my_team`), `view-audit-log` (`branch`) already exist (`packages/domain/src/permissions.ts`).
- **00** projections registry (`register`, optional `reset`; catch-up runs **each projection over the whole range in turn**; changed only by row H-2 ⚠️ v0.10 (H9-5)), hub clock, directory in memory, Foundation §6 list cursor (`?cursor&limit`, default 50, max 200, `meta.next_cursor`).

---

## §3. Domain rules

### 3.1 Words

**Entry** = one `{ order_item_id, units?, disposition }` in `VoidItems`. **Named line** = the entry's line. **Touched lines** = the named line plus the cascade `planVoid` adds (option children of an `item`, parts of a `deal`), each with its own units. **Per-line disposition** = V3. **Void request** = an open `void_approval` alert. **Locked line** = a line in some open void request's `values.touched_ids`. **Comp lines** of an open comp request = its named line plus that line's option children / deal parts (the lines `planComp` can cascade into). ⚠️ Changed by v0.2 (H1-7, OQ-C)

**Engine line** = `isEngineLine` (has a station, not a deal); a station line **absent** from the engine state (its order left the engine) counts as **started** (gets the chosen disposition; `moved` disabled) ⚠️ Changed by v0.8 (H7-12).

**Header** = a `deal` line, or an `item` line with no engine line of its own **whose touched option children include at least one engine line** (a container: the food is on that child). A lone item, and a non-engine item whose touched children are all non-engine (a served lassi with a "sugar-free" option), is never a header: it gets the chosen disposition like its children. **Not started** = an engine line at `added`; an option child with no engine line → its parent's "not started" when the parent is an engine line, else its **own** `served_at` null (exactly V1 (d)); any other non-engine line → `served_at` null. ⚠️ Changed by v0.5 (H4-3), v0.6 (H5-2)

### 3.2 Eligibility of an entry

Checked in payload order against a **working copy** of the order's lines (each earlier entry's plan applied to it, as 02b `RemoveItems`). ⚠️ Changed by v0.2 (H1-3)

1. The line belongs to the order → else `400 VALIDATION_FAILED { issues: [{ path: 'lines.N.order_item_id' }] }`.
2. *(removed in v0.7: a return line — remake / fix replacement, money 0 — is voidable like any line past stage 1, refund 0; at stage 1 it is 02b's Remove; owner Q-R1)* ⚠️ Changed by v0.7 (H6-1)
3. *(removed in v0.2: a pending-weight line is voidable, V18)* ⚠️ Changed by v0.2 (OQ-B)
4. **Past stage 1** (V1) → else `409 ITEM_WRONG_STAGE { order_item_id, stage: 'added' | 'zone_undo' }`.
5. `units` (absent = all live units) `1 ≤ units ≤ live_units` (working copy) → else `400 { path: 'lines.N.units' }`. g/ml `item` / `option_child` lines whole only; a g/ml `deal_part` and a deal with a g/ml part go by deal portions, and a partial void of such a deal or part while that part is still open in the engine is refused exactly as 02b: `400 VALIDATION_FAILED { issues: [{ path: 'lines.N.units', message: 'gml_deal_part_partial' }] }` (a served g/ml part is not "open", so its partial is allowed). ⚠️ Changed by v0.2 (H1-14)
6. **Approval path only** (grant `requires_approval`): (a) no touched line is a touched line of an **earlier entry of this command** → else `400 { path: 'lines.N.order_item_id', message: 'overlaps_entry' }`; (b) no touched line is locked → else `409 VOID_PENDING { alert_id, order_item_id }`; (c) no touched line is a comp line of an open `comp` request that still fits (`live_units − comped_units ≥` its units, from the lines already read; 0 statements) → else `409 COMP_PENDING { alert_id }`; an already-stale comp request (H2-1 case) does not block. ⚠️ Changed by v0.4 (H3-7) **Direct path:** (b) only — a direct void on a locked line is still `409 VOID_PENDING`; open comp requests are closed by `lineChangeDrafts` (G1-1b). ⚠️ Changed by v0.2 (H1-3, H1-4, H1-7)
7. **Disposition** (V3): `moved` → the per-line dispositions give at least one `moved` line → else `409 VOID_NOT_ALLOWED { order_item_id, reason: 'not_movable_stage' }` (no touched line at `cooking` / `done`) or `'stock_not_tracked'` (none with a draw); the open business day → else `'day_closed'`; the caller's `resolve('move-item-to-stock').grant === 'allowed'` → else `403 PERMISSION_DENIED { reason: 'move_not_granted' }`. `other` without `disposition_note` → `400`.

Repeated `order_item_id` → `400` (C6). On the direct path an entry whose line is already touched by an earlier entry's cascade is judged on what is left (working copy).

### 3.3 Effect drafts (`voidDrafts`, shared by the direct path and `apply`)

⚠️ Changed by v0.2 (H1-2, H1-3, H1-28, OQ-C) — one stock pass and one line-change pass per command.

1. For each entry in payload order, on the working copy: `plan = planVoid(named, children, units)` (02b) → one `ItemVoided` payload per touched line with `refund_minor`, `comp_voided_minor`; apply the plan to the working copy; give each touched line its per-line disposition (V3; in `apply` the dispositions stored in `values.line_dispositions` are used: `moved` and the past-stage-1 ones as stored, a stored `null` on a non-header line → `wastage` when that line is no longer not started (OQ-F, H3-3), else `null`; headers stay `null`). ⚠️ Changed by v0.3 (H2-2)
2. Collect the cause drafts in payload order: per entry, first one `ItemMovedToStock { order_item_id, units }` for each touched line whose disposition is `moved`, then the entry's `ItemVoided` drafts with `{ disposition: <per line>, reason_code, note, disposition_note, requester_staff_id, approver_staff_id, alert_id }`.
3. **One** `withStockEffects(ctx, allCauseDrafts, anyMoved ? openDayStockCtx(state) : undefined)` over the whole list (each cause followed by its releases / adds / waiting-line reserves; one bookkeeping pass, so two `moved` entries on one stock item never reserve the same waiting line twice).
4. **One** `lineChangeDrafts(ctx, order_id, allChanges)` (`allChanges` = every touched line of every entry with its total units out) → at most one `OrderCancelled` or one `OrderFoodCleared`; it judges only comp requests on lines in `allChanges` (row Q-4); a direct void keeps any stale-comp `AlertClosed` it returns; in `apply` it is called with `{ stale_comps: 'keep' }` (Q-4, V8), so none can exist and one present → throw (K-1 assert; tests 30, 30b, 30c) ⚠️ Changed by v0.8 (H7-1). ⚠️ Changed by v0.3 (H2-1)
5. **Approval path only:** set `payload.alert_id = request.alert_id` on **every** draft (V5).

Zone counts never change (02b To 04). Stock: a `wastage` / `staff_meal` / `other` line past Start draws nothing back (the reservation was consumed at Start or Done, 03a P-5); a touched line still reserved (`added`, or a reserve not yet consumed) releases its share (`StockReleased { reason: 'voided' }`). A partial move of a `cooking` / `done` line must produce **no** `StockReleased` (spike 0 asserts `reserved = 0` there; else a 03a row, H1-25).

### 3.4 Request lifecycle (01d states)

```
VoidItems (grant requires_approval)
     │  per entry: alerts.raiseMany → AlertRaised(kind void_approval, dedupe 'void:<order_item_id>')
     ▼
 PENDING (01d open) ── touched lines locked (V8); pendingVoids lists it; merge / split blocked; 05 refuses bill close
     │
     ├─ approve (approve-void in range, PIN) ─► apply: re-read, §3.2 rules 1, 4, 5, 7, voidDrafts + alert_id ─► APPROVED
     ├─ reject ─────────────────────────────► apply: [] ; request_result to requester (+ holder, D-2) ─► REJECTED
     └─ withdraw (requester) ───────────────► onWithdraw: [] ─► WITHDRAWN
   (no override, V9; day close is refused while any request is open — A-1, Q-DC) ⚠️ v0.8 (H7-5)
```

⚠️ Changed by v0.2 (H1-1): `apply` does **not** re-run rule 6. Its own request is the lock on these lines; no other void request can hold them (V7 at raise) and no comp can touch them (02b line guard on raise and approve, Q-3), so rule 6 has nothing to find. Rule 7's grant check is not repeated (the requester's `move-item-to-stock` was checked at raise); its stage check runs on the frozen per-line dispositions: a line stored as `moved` that is no longer at `cooking` / `done` (served meanwhile — by a waiter or by the hub's served-estimate tick — OQ-D) ⚠️ v0.9 (H8-12) → `409 VOID_NOT_ALLOWED { reason: 'not_movable_stage', hint: 'withdraw_and_reask' }`; a refused answer writes nothing, so the requester learns it from `pending-voids.blocked` (§6.4, H2-5). A stored `null` line that started meanwhile is not a refusal: it is written `wastage` (OQ-F). A failure of any re-check (billed meanwhile, a stored `moved` line no longer movable) throws its code (`day_closed` cannot happen at approve: the day cannot close while the request is open, A-1); 01d refuses the answer before any PIN in `preRead` (rule 4 (b)); the request stays pending, and the requester withdraws and asks again (the approver's error says so for every refusal; the requester's `blocked` row covers `not_movable_stage` (OQ-D), from engine state in memory, §6.4). ⚠️ Changed by v0.3 (H2-5, OQ-F), v0.4 (H3-8), v0.8 (H7-5)

### 3.5 Kind `void_approval` (registered at the top level of `apps/hub/src/voids/`, imported before boot replays `alerts`)

`family: 'urgent'`, `silent: false`, `subject: 'order'`, `steps: APPROVAL_TIER_STEPS`, `closes_on: 'owner'`, `lead_fallback: false`, `expires_at_day_close: true` (no effect on requests; 02b `comp` precedent), `labels: { card: 'alert.void_approval.card', lock: 'alert.void_approval.lock' }` (01d `AlertLabels`; `alert.void_approval.name` is a client text key, §8) ⚠️ Changed by v0.3 (H2-17), `request: { answers: ['approve','reject'], right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' }, needs_pin: 'always', apply, onWithdraw, result_also_to }`. ⚠️ Changed by v0.2 (H1-19)

- `values_schema`: `{ order_id, order_item_id, units, reason_code, note: string | null, disposition, disposition_note: string | null, touched_ids: string[] (1–40), line_dispositions: Record<order_item_id, VoidDisposition | null>, refund_minor: int ≥ 0, comp_voided_minor: int ≥ 0 }` (the raise-time plan; `pendingVoids` reads them from `values_json` in its 1 statement). ⚠️ Changed by v0.2 (OQ-C, H1-29), v0.3 (H2-8)
- `details_schema` (`AlertDetailsBase.pick`, including **`identifier`** ⚠️ v0.10 (H9-3)): `item` (name of the named line; a deal shows the deal name), `quantity` (units), `amount` (Σ `refund_minor` of the plan — what leaves the bill; minor units), `reason` (`reason_code[: note]`, sliced to 200 as CompLine does), `lines` (`[{ name, quantity, state }]`, `state` = stage only: `not_started` / `cooking` / `cooked` / `served`; ≤ 10), `disposition` (one label key ≤ 60: `void.disposition.<moved|wastage|staff_meal|other>`, or `void.disposition.moved_partly` only when the chosen disposition is `moved` and at least one **non-header** touched line is not `moved` ⚠️ Changed by v0.4 (H3-14), v0.7 (H6-6); a new optional `AlertDetailsBase` field, row D-3, else the schema strips it) — the approver card of owner Q16. `display`: `{ kind_label_key: 'alert.void_approval.lock', table_code, requester_name }` with `table_code` as `CompLine` sets it (dine-in table code, else `null`); **which order** is shown by `details.identifier` (≤ 40, on main's `AlertDetailsBase`, as at raise) on the signed-in card (owner Q16 "table / token"). 04 builds an `Identifier` (`@pos/domain` kds) as 03b's `passIdentity` does — token with date vs `ctx.state.business_day`, parking car number + type, dine-in `tableLabel` of the current tables (primary first) — and formats it with **its own copy of 03b's `identifierText`** (`kds/commands/ready.ts:125`, **including its 40-char slice** — 03c's copy has none and would fail `AlertDetailsBase.identifier.max(40)`) and of `passIdentity`'s dine-in branch: table ids → names via `branchConfig().floors[].tables` (the id when unknown), `tableLabel`, primary first; **no current table** (`table_ids` = `[]`, as 03b's `currentTableOf`, which joins open seatings only) → the engine's table at submit (`ctx.state.orders[order_id]?.table_id`); primary first only when `table_ids` is non-empty ⚠️ v0.11.1 (H11-2) (`apps/hub/src/voids/identifier.ts`) ⚠️ v0.11 (H10-3); 03b's helpers are not in its Exposes, so B-0 still edits nothing in 03b; test 20c asserts 04's output equals 03b's for seven fixtures (`#12`, `#12 10 Nov`, `PARKING LEB 1234 SEDAN`, `T4 + T5`, a tie merge, a > 40-char label, no current table) ⚠️ v0.11.1 (H11-1). A dine-in label goes stale after a later move / merge; fine for a short-lived request ⚠️ Changed by v0.8 (H7-8), v0.9 (H8-4), v0.10 (H9-3, H9-7) (lock screen shows no money, 01d §3.12). ⚠️ Changed by v0.2 (H1-5, H1-19), v0.3 (H2-3, H2-19)
- `result_also_to(alert)` (row D-2): dine-in → `{ kind: 'table_team', table_id: currentTableOf(order).primary_table_id, depth: 'owner' }` (1 statement); no current seating, takeaway or parking → `null`. ⚠️ Changed by v0.4 (H3-11) A target that resolves only to the requester is dropped by 01d (D-2). 01d calls it only on a **reject**. ⚠️ Changed by v0.3 (H2-18)

### 3.6 Audit log (projection `audit`, map `toAuditEntry`)

⚠️ Changed by v0.2 (H1-8, H1-26, H1-30, H1-31): events only.

`toAuditEntry(event, lookups) → AuditEntry | null` (pure, `@pos/domain/src/audit.ts`). `lookups` holds only what the projection itself folded from earlier events: `requestOf(alert_id) → { kind, requester_staff_id, order_id, table_code } | null` (table `audit_requests`, from `AlertRaised` with `request ≠ null`; `table_code` from its `display`) and `tableOf(order_id) → table_id | null` (table `audit_orders`, from `OrderPlaced.table_id`: the table the order was placed at). Names are **not** stored in the fold: `actor_staff_id` / `approver_staff_id` are; the query joins `staff_names` at read (row H-1: upserted on every directory apply from `staff` and `no_pin_staff`, never deleted; OQ-E). ⚠️ Changed by v0.3 (H2-7) So a rebuild from seq 0 equals live, row for row (test 55).

**Columns per action** ⚠️ Changed by v0.4 (H3-1): `actor_staff_id` is **the person who did the act**, not always the envelope actor. In an approve, every draft's envelope actor is the answering session (the approver), so: `item_voided`, `line_comped` → `actor_staff_id` = payload `requester_staff_id` (else, on old events without it, the envelope actor ⚠️ Changed by v0.5 (H4-5)), `approver_staff_id` = payload `approver_staff_id` (null on a direct act, where the envelope actor is the requester anyway); `item_moved_to_stock` with `alert_id` → actor = `audit_requests.requester_staff_id`, approver = `audit_requests.answerer_staff_id` (set when the fold saw the `RequestAnswered`, which precedes the drafts in the same command; no look-ahead ⚠️ Changed by v0.5 (H4-2)); without `alert_id` → envelope actor, approver null; `void_requested` / `comp_requested` → actor = `requester_staff_id`; `*_answered` → actor = `audit_requests.requester_staff_id`, `approver_staff_id` = `answerer_staff_id`, `method` = answer method; `request_withdrawn` → actor = requester; `request_pin_failed` → actor = the named answerer; `request_closed` → actor = `audit_requests.requester_staff_id`, approver = `by_staff_id` (H8-8); every other action → actor = envelope `actor_id`, approver null. The envelope actor is always kept in `detail_json.envelope_actor_id`. 01d rule 5 refuses self-approval, so actor ≠ approver on every approved row.

| Action | From event | Fields shown |
|---|---|---|
| `void_requested` | `AlertRaised` kind `void_approval` | requester, item × units, amount, reason, disposition |
| `void_answered` / `comp_answered` / `request_answered` | `RequestAnswered` (kind from `audit_requests`) | decision, answerer, **method**, `on_requester_device` |
| `request_withdrawn` | `RequestWithdrawn` | requester |
| `request_pin_failed` | `RequestPinFailed` | named answerer, device, outcome |
| `item_voided` | `ItemVoided` | units, refund, comp-voided, disposition, reason, requester, approver |
| `item_moved_to_stock` | `ItemMovedToStock` | units |
| `item_removed` | `ItemRemoved` | units |
| `comp_requested` / `line_comped` | `AlertRaised` kind `comp` / `LineComped` | units, value, reason, approver |
| `item_returned` | `ItemReturned`; `OrderLinesAdded` with `return_of.mode = 'fix'` | mode |
| `line_weight_set` | `LineWeightSet` | quantity, total |
| `order_boosted`, `order_cancelled` | `OrderBoosted`, `OrderCancelled` | — |
| `day_opened`, `day_closed` | `BusinessDayOpened`, `BusinessDayClosed` | — |
| `table_lock_force_released` | `TableLockReleased { reason: 'force' }` | table |
| `table_holder_changed` | `TableHolderChanged` | reason (`take_over` / `handover` / `force_move`), from → to |
| `pin_locked_out`, `device_pin_locked_out`, `pin_lockout_cleared` | `StaffPinLockedOut`, `DevicePinLockedOut`, `PinLockoutCleared` | staff / device |
| `device_paired`, `device_revoked`, `pairing_token_generated` | `DevicePaired`, `DeviceRevoked`, `DevicePairingTokenGenerated` | device |
| `station_paused`, `station_capacity_set` | `StationPauseSet`, `StationCapacitySet` | station, value, reason |
| `item_availability_set` | `ItemMadeAvailable`, `ItemMadeUnavailable` | item |
| `request_closed` ⚠️ v0.7 (H6-4) | `AlertClosed` whose `alert_id` is in `audit_requests` (others → null) | actor = `audit_requests.requester_staff_id`; `approver_staff_id` = `by_staff_id` (the closer; null for a tick close); outcome = close reason (`obsolete`, …); envelope actor in `detail_json`; kind from `audit_requests` ⚠️ v0.8 (H7-3) |
| `stock_set`, `stock_added`, `zone_stock_set`, `zone_stock_added`, `stock_transferred_out` ⚠️ v0.7 (H6-16) | `StockSet`, `StockAdded` (no `reason`; `moved` is covered by `item_moved_to_stock`), `ZoneStockSet`, `ZoneStockAdded`, `StockTransferredOut` | stock item / zone, quantity |

Not mapped (owner Q14): sessions, presence, alert deliveries / seens, engine and tick events, `ItemStarted` / `ItemDone` / `ItemServed`, config applies, `OrderContactSet` (privacy, 02b O17), owner config changes (cloud). Later modules add actions with `registerAuditAction` (§4.2): 03c `TicketReprinted` when that event exists, 05 clock-in and bill override. A **new mapping of an event type that already has history** ships with a hub migration that deletes the `projection_checkpoints` row `audit` (the registry resets a projection only when it has no checkpoint, `projections/registry.ts:70`), so the next boot resets and replays it. **This needs row H-2** (00): today `applyAll` re-creates a missing checkpoint on any live append (a `ClockAlarm` at boot step 3a, before catch-up), which skips the replay — the trap 02b v1.0.9 hit (B3-5). With H-2 a checkpoint row is written only by `catchUp`, so both 04's **first boot** (no `audit` row yet) and a deleted row replay from seq 0 ⚠️ Changed by v0.9 (H8-1). ⚠️ Changed by v0.3 (H2-12)

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | `defineCommand` (`approvable`), registry, projections registry, `ctx.state`, `ctx.directory`, `ctx.clock`, query routes, list cursor, `staff_names` (row H-1) | §6 |
| Hub commands (00) | `withStockEffects`, `openDayStockCtx` (`commands/set-precooked-stock.ts`) | §3.3 |
| 01b | `resolve` (caller's `move-item-to-stock`), permissions above, allowed-only rule (row B-2) | §3.2, §6 |
| 01d | `defineAlertKind`, `APPROVAL_TIER_STEPS`, `alerts.raiseMany`, `alerts.listOpen`, `AnswerFacts`, `AlertDetailsBase`, read-only `apply` contract; `result_also_to` (row D-2) | §3.4, §3.5 |
| 02a | `registerMergeGuard`, `currentTableOf`, `seating_orders` (read-only join in queries, never in a fold) | §3.5, §6.6 |
| 02b | `planVoid`, `readOrder` (row Q-2), `lineChangeDrafts`, `COMP_KIND`, `registerLineGuard` (row Q-3), error codes | §3.2, §3.3 |
| 03a | `ItemVoided`, `ItemMovedToStock` (+ fields, row T-1), `stockEffects` (through `withStockEffects`), `isOrderInEngine`, engine line stage and draws | §3.2, §3.3 |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `pendingVoids(db, order_ids[], state?)` | `Map<order_id, Array<{ alert_id, order_item_id, units, touched_ids, refund_minor, comp_voided_minor, requester_staff_id, raised_at, blocked: 'not_movable_stage' \| null }>>` (open `void_approval` alerts; amounts from `values`; `blocked` from engine state in memory against stored `moved` lines, 0 statements; omitted `state` → `null`) ⚠️ Changed by v0.3 (H2-5, H2-8) | 1 (`alerts_open_kind`) | 05 bill (PENDING VOID; subtract **`refund_minor` only**; refuse close while any), 02a guard, client |
| `VOID_KIND` | `'void_approval'` | — | 05 day close (`alerts.listOpen({ kind })`) |
| `toAuditEntry`, `AuditEntry`, `AUDIT_ACTIONS` | pure, browser-safe (`@pos/domain/src/audit.ts`) | 0 | 06 cloud audit, clients |
| `registerAuditAction(event_type, map)` | adds a mapped action (startup only; a duplicate event type → startup error) | 0 | 03c, 05, later modules |
| Events written, kind, queries, projection | §6 | — | all |

⚠️ Changed by v0.2 (H1-5, H1-34): `amount_minor` split into `refund_minor` / `comp_voided_minor`; `hasPendingVoid` dropped (05 uses `pendingVoids(...).size > 0`).

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 05 | Bill: lines in `pendingVoids` show **PENDING VOID** and the total excludes their **`refund_minor`** (a comped unit's `comp_voided_minor` does not change the bill; `seatingTotals` does not exclude them itself); **refuse bill close while `pendingVoids` is non-empty** for the bill's orders (D11 AC3); **day close is refused while any `void_approval` request is open** (`409 DAY_CLOSE_BLOCKED`, row A-1, owner Q-DC): 05's own day close, when it replaces 01a's `CloseBusinessDay` (01a S33), keeps this guard ⚠️ Changed by v0.7 (H6-2); refund after close is `apply-refund`, never a void; Z report reads `ItemVoided.disposition` (wastage / staff meal / moved / null) and `comp_voided_minor` as a voided comp (02b O21). A line with `live_units = 0` (e.g. a voided pending-weight line, `quantity` NULL for ever) is never a pending-weight line for bill close or the Z report. ⚠️ Changed by v0.2 (H1-5), v0.3 (H2-15) |
| 06 | **Cloud / remote audit view** (owner K-8 revised): from synced events, build the cloud audit read model with the same `toAuditEntry` / `AUDIT_ACTIONS` (`@pos/domain`) and the same events-only lookups, owner page under `/v1/admin/` (C2 branch guard, C7 route case); names from the cloud directory at read. A hub restore carries the hub's `staff_names` (or refills it from the cloud staff list, leavers included). Whether 06's sync joins milestone A is 06's G0. ⚠️ Changed by v0.4 (H3-10) |
| 07 | Voids, approvers and methods from the audit read model / events; wastage from `ItemVoided.disposition`. |
| 08 | Depletion reversal on void reads `ItemVoided` (with `disposition`); `moved` returned to stock already through `StockAdded { reason: 'moved' }`. |

### 4.4 Shared types (`@pos/domain/src/voids.ts`, browser-safe)

```typescript
export const VOID_REASON_CODES = ['customer_changed_mind', 'wrong_order_taken', 'too_late', 'quality', 'other'] as const;
export type VoidReasonCode = (typeof VOID_REASON_CODES)[number];
export const VOID_DISPOSITIONS = ['moved', 'wastage', 'staff_meal', 'other'] as const;
export type VoidDisposition = (typeof VOID_DISPOSITIONS)[number];
export type VoidBlock = 'not_movable_stage' | 'stock_not_tracked' | 'day_closed' | 'move_not_granted'; // v0.7 (H6-1): no 'return_line'
```

### 4.5 Changes to other specs (R26) — *Proposed — needs approval*; each target bumps with changelog and "Changed by 04" markers (R34)

**Version numbers (owner K-4):** 04 does **not** change any number 03b v1.0.1 / 03c v1.0.1 claim for their task 0d (Foundation v1.12, 00 v1.9, 01a v2.4, 01b v1.8, 01d v1.2.2, 02b "v1.0.4", 03a v1.2.1). **Note for 03b's task 0d:** 02b v1.0.4 and v1.0.5 are already APPROVED on main (2026-11-10 / 11), so 03c's Q-1 cannot land as v1.0.4; 04 left **02b v1.0.6** free for it (03b has since taken v1.0.6–v1.0.9 on `module-03b`, see the rule below). **Rule for every row (owner K-4, H7-2):** at 04's task 0, each target takes the next free number after **both** `main` and `module-03b` (and any other open module branch), re-checked then; the numbers below are the next free ones on 2026-11-12. As found on `origin/module-03b` @ `35717a1`, **now merged into `main` (`79e907b`, PR #76)** ⚠️ v0.9 (H8-2): Foundation v1.12, 00 v1.9, 01a v2.4–v2.4.3, 01b v1.8, **01d v1.2.2–v1.2.4**, **02b v1.0.6–v1.0.9**, **03a v1.2.1–v1.2.3** are taken (owner-approved), and `AlertRaised` **v3** ships there. Task 0 also **re-reads every intermediate version** (02b v1.0.6–v1.0.9, 01d v1.2.2–v1.2.4, 03a v1.2.1–v1.2.3) against 04's rows; any conflict → STOP and ask, never silently diverge ⚠️ Changed by v0.8 (H7-2). **01e** (README row 00) also claims the next 00 bump; whichever of 03b / 01e lands second takes v1.10, so 04's H-1 takes the next free 00 number **at its task 0** (v1.10 if free, else v1.11); 01e's unnumbered 01b bump (`pager_ids`) likewise: 04's B-1 / B-2 take the next free 01b number (v1.9 if free) ⚠️ Changed by v0.8 (H7-11). 04's D-3 builds on 03b's shipped `AlertRaised` v3 and its task P3 runs after 03b's task 0d. ⚠️ Changed by v0.7 (H6-5, H6-11):

| Row | Target → version | Change | Why |
|---|---|---|---|
| F-1 | Foundation → **v1.13** §4.2 | Note: a void past stage 1 has a per-line **disposition** (`moved` / `wastage` / `staff_meal` / `other`; `null` for a part never started); `moved` = `ItemMovedToStock` then `ItemVoided` in one transaction (04 V4); `move-item-to-stock` is the allowed-only right to choose `moved`, not a separate refund path. Diagram labels unchanged. | V3, V4 |
| F-2 | Foundation → **v1.13** §4.5 | OVERRIDDEN **not built** (owner Q9, 04 §12.4); a pending void ends by approve / reject / withdraw; the states table keeps the row marked "deferred". REJECTED: "the table's order taker is notified" via 01d `result_also_to` (D-2). PENDING is not in 02b `seatingTotals`; 05 subtracts `pendingVoids.refund_minor`. **§4.5 / §4.6:** day close is refused while a void is PENDING (04 Q-DC, A-1) ⚠️ Changed by v0.8 (H7-5). | V9, V11, H1-5, Q-DC |
| F-3 | Foundation → **v1.13** §3.1 audit row | Hub: projection `audit`, an events-only read model of a curated action list (04 §3.6); cloud replica built by 06 from synced events with the same map. | V16, K-8 |
| F-4 | Foundation §6.2 (append, no bump) | `VOID_NOT_ALLOWED` (new), `DAY_CLOSE_BLOCKED` (new) ⚠️ v0.8 (H7-4). `VOID_PENDING` already exists (D11); 04 defines its details `{ alert_id, order_item_id }`. ⚠️ Changed by v0.2 (H1-13) | §9 |
| A-1 | 01a → **v2.5** §6.18b `CloseBusinessDay` + code (`apps/hub/src/commands/close-business-day.ts`) | Day-close guard: `registerDayCloseGuard((db, state) → { code, details } \| null)` (merge-guard pattern; unregistered → never blocks), asked after the `not_open` / `opened_recently` checks and before the append. 04 registers: any open `void_approval` (1 statement, `alerts_open_kind`) → `409 DAY_CLOSE_BLOCKED { reason: 'void_pending', voids: [{ alert_id, identifier, item, requester_name }], count }` (≤ 40 listed, `count` = all open, same statement via `COUNT(*) OVER ()`, from `display` / `details`) ⚠️ v0.9 (H8-4, H8-11). A 409 is new for this command (its other refusals are `200 { changed: false, reason }`): chosen because a pending void is a real block, not a no-op. **Client (01a admin `/admin/stock`, `apps/client/src/features/admin/stock/StockApp.tsx` `closeDay` / `closeAndStart` and its `errorMessage` mapping):** on this 409 show "`count` void requests are still open — answer them first" with the list; the Close → Open chain **already stops** on a refused close (`if (!answer.ok) … return false`) — a test keeps it so; i18n keys; client test in 01a's admin tests ⚠️ v0.9 (H8-5). So no `moved` request can outlive its business day ⚠️ Changed by v0.8 (H7-4). (01a v2.4 is 03b's claim; 04 takes v2.5.) ⚠️ Changed by v0.7 (H6-2) | owner Q-DC |
| H-2 | 00 → **v1.10** (with H-1) M48, §5.8, boot step 4 + code (`apps/hub/src/projections/registry.ts` `applyAll`) + test helpers | `applyAll` (every live append) **only updates** existing `projection_checkpoints` rows (`UPDATE … WHERE branch_id = ? AND projection = ?`), never inserts; a projection's first row is written only by `catchUp`, which already inserts for every registered projection on each boot. So a new projection, and one whose row a migration deleted, replays from seq 0 even when boot step 3a appends a `ClockAlarm` before catch-up (02b v1.0.9 B3-5). **00 text restated** ⚠️ v0.10 (H9-1): M48 "every committed transaction advances every registered projection's **existing** checkpoint; `catchUp` writes a projection's first row"; §5.8 and boot step 4 the same. **Invariant** (H9-7): a projection without `reset` must be idempotent, or must not fold events written before boot step 4 (setup `provision.ts`, step 3a), because on a new install the first boot replays them. **Projection registration (same task, H10-5):** export one `registerHubProjections(registry)` (today's six `register*` calls of `createDeps`, later 04's `audit`) from `apps/hub/src/lib/boot.ts` (or a sibling `lib/projections.ts`), used by `createDeps`, `createTestHub` and the big fixture, so a new projection is added in one place. **Test helpers (same task):** `apps/hub/test/helpers/test-hub.ts` registers through it and runs `projections.catchUp(fx.db, config.provisioned?.branch_id ?? 'branch-unset')` (the writer's branch id, H10-6) once after migrations (rows for every projection, as a booted hub has), so the statement-count tests (`set-station-capacity`, `receipts`, `fires-tick`) keep "one statement per projection"; `apps/hub/test/helpers/big-fixture.ts` `PROJECTIONS` = the names `registerHubProjections` registers **plus `access_reconcile`** (registered outside `createDeps`, after step 3a; without its row step 4 replays it and throws `unknown event type TestNooped`) — derived, not listed; cache key follows (H10-5), keeping 00 test #100 under budget; `apps/hub/test/projections/registry.int.test.ts` M48 test → "an existing row is advanced; a missing row is not created; the next `catchUp` replays it from 0"; **test #67** seeds the row with a `catchUp` before its first `applyAll`, as a booted hub has (00 row #67's text unchanged) (H10-4); 00 test list adds #100 with all registered projections and a forced alarm. 03b's forward-only projections keep their rows; 02b's B3-5 backfill unchanged. Real hubs: no behaviour change. ⚠️ Changed by v0.9 (H8-1), v0.10 (H9-1, H9-7) | 04 V16, §3.6 |
| H-1 | 00 → **v1.10** §5 directory apply + code (`apps/hub/src/auth/apply-directory.ts`, hub migration `NNNN_staff_names.sql`) | Table `staff_names(staff_id PRIMARY KEY, display_name NOT NULL, updated_at)`: every directory apply upserts every person in the **input** staff and `no_pin_staff` lists (before any skip, so a skipped bad `pin_hash` still has a name) in the same transaction; rows are **never deleted** (a leaver keeps the last known name). Read by 04's audit query (and later 05 / 07). Not used for sign-in. **The migration seeds it** from the current `staff` and `no_pin_staff` rows (`INSERT … SELECT staff_id, display_name, <now>`), because a directory apply runs only when `directory_version` moves ⚠️ Changed by v0.7 (H6-9). Not built from events: a replaced or restored hub refills it on the first directory apply (active staff); leavers' names then come from 06's restore (To 06). ⚠️ Changed by v0.3 (OQ-E, H2-7), v0.4 (H3-10) | owner OQ-E |
| B-1 | 01b → **v1.9** default roles | Cashier and Order taker: `void-item` **requires approval by Manager**, `move-item-to-stock` **allowed** (`branch`); Owner / Manager unchanged. Code: `apps/cloud/src/modules/staff-roles/default-roles.ts` (new tenants through `cli/seed-tenant.ts`, which already writes `role_permission_approvers`) **plus** one cloud migration `NNNN_void_defaults_backfill.sql` for existing tenants that (1) inserts the `role_permissions` rows for roles found by **`default_key`** (`cashier`, `order_taker`), with `scope 'branch'`; the dual-written `approver_role_id` = the tenant's `default_key = 'manager'` role on the `void-item` (`requires_approval`) rows only and `NULL` on `move-item-to-stock` (`allowed`) — the cloud CHECK `(grant_type = 'requires_approval') = (approver_role_id IS NOT NULL)` (`0001_platform.sql:41`) ⚠️ Changed by v0.4 (H3-9), `ON CONFLICT DO NOTHING RETURNING`; (2) inserts `role_permission_approvers` for exactly the returned `void-item` rows (approver = that manager role); (3) turns any existing `move-item-to-stock requires_approval` grant into `allowed` with `approver_role_id = NULL` in the **same** `UPDATE` and deletes its `role_permission_approvers` rows (B-2); (4) bumps `directory_version` once per tenant that changed. Pilot tenants are pre-live, so it overrides no owner choice. ⚠️ Changed by v0.2 (H1-21), v0.3 (H2-4, H2-13) | owner Q1 / K-7; V3 |
| B-2 | 01b → **v1.9** catalogue + code (`packages/domain/src/permissions.ts`, cloud `checkGrants`) | `ALLOWED_ONLY_PERMISSIONS = ['move-item-to-stock']`: a grant of it with `requires_approval` → `422 CONFIG_REFERENCE_INVALID { field: 'grants.N.grant_type' }` (Foundation §6.2 status) in the roles API and editor (the option is not shown); on the hub, 04 rule 7 accepts only `allowed`, so a stray `requires_approval` reads as not granted; `resolve` is unchanged ⚠️ v0.8 (H7-13). ⚠️ Changed by v0.2 (OQ-A, H1-10), v0.3 (H2-13) | owner OQ-A |
| D-1 | 01d → **v1.2.5** §4.3 To 04 (text) | Values `{ order_id, line_id }` → §3.5's `values_schema`; OVERRIDDEN not used (04 V9); the rejected-void notice goes through D-2, not a 04 kind. **Also** (by section, on 01d v1.2.4): §3.3 "Requests no one can answer" and §4.3 To 05 — "void requests are **not** closed at day close; 04's guard refuses the close while one is open (04 A-1)"; the state diagram's `overridden` branch — "(not used by 04, V9)"; the REJECTED row — "04's `apply` returns `[]` (the item stays billed); the holder notice is 01d's `result_also_to` (D-2)"; the WITHDRAWN row — "as if never asked (04 V10, owner Q10)"; the states-table OVERRIDDEN row — "not built (04 V9, owner Q9)"; decisions row 4 ("e.g. 05 at day close … close them") — "void requests block the close instead (04 A-1)" ⚠️ v0.10 (H9-6) ⚠️ Changed by v0.8 (H7-5), v0.9 (H8-6). | K-5, V9, V11, Q-DC |
| D-2 | 01d → **v1.2.5** §3.5 `defineAlertKind`, §3.3 rule 7 + code (`alerts/kinds.ts`, `commands/answer-request.ts`) | Optional `request.result_also_to(alert) → AlertTarget \| null`, called read-only in `prepare` **on a reject only**; 01d raises one more `request_result` to that target (dedupe `request_result:<alert_id>:also`) in the same `raiseMany` as its other answer raises, **outside** `checkAlertIds`. Target resolving only to the requester → not raised. **Statement bound on a reject: +1** (the kind's `currentTableOf`) **+1** `table_team` resolver in `raiseMany` when no other raise of that answer uses it; approve and withdraw +0. 01d's tests assert the new bound. ⚠️ Changed by v0.2 (H1-12), v0.3 (H2-18) | V11 with K-1 strict |
| D-3 | 01d → **v1.2.5** `packages/events/src/alerts.ts`, `events/alert/AlertRaised.v3.ts` (re-point at `AlertDetailsBaseV3`), new `events/alert/AlertRaised.v4.ts`, `packages/events/src/index.ts` (export v4), `apps/hub/src/alerts/raise.ts` (payload type V3 → V4) + card ⚠️ v0.9 (H8-9) | Optional `disposition: string` (an i18n label key, ≤ 60) joins the details base over 03b's shipped V3 base: **freeze** today's base as `AlertDetailsBaseV3`, point `AlertRaised.v3` at it, add `AlertRaised` **v4** over the widened base with an identity upcaster (F D46) — a shipped version's shape never changes. The signed-in approver card renders it on its own line. ⚠️ Changed by v0.3 (H2-3), v0.7 (H6-5), v0.8 (H7-2) | owner Q16 |
| Q-1 | 02b → **v1.0.10** §6.19 + code (`OrderCancelled.v1.ts`, `OrderFoodCleared.v1.ts`) | Optional `alert_id: string` (both are `.strict()` today); folds ignore it; fixtures with and without parse. | V5 |
| Q-2 | 02b → **v1.0.10** §4.2 Exposes + code | `planVoid(parent, children, n)` (`orders/ledger.ts:194`) listed as built; **export** `readOrder(ctx, order_id)` (`orders/commands/remove-items.ts:74`, today module-private) to `orders/exports.ts` with its row type, and its row gains `o.token, o.car_number, o.car_type, o.business_date` and `(SELECT json_group_array(st.table_id ORDER BY st.joined_at, st.table_id) FROM seating_tables st WHERE st.seating_id = so.seating_id) AS table_ids` (order **inside** the aggregate, SQLite ≥ 3.44, bundled 3.53.4 — `currentTableOf`'s order) ⚠️ v0.11 (H10-2) (0 extra statements) for the identifier ⚠️ v0.10 (H9-3) ⚠️ Changed by v0.2 (H1-20), v0.8 (H7-8) | K-6, Q16 |
| Q-3 | 02b → **v1.0.10** §3.4, §3.6, §3.9, §6.2, §6.3, §6.8, §6.12 + code | **Line guard:** `registerLineGuard((db, order_id, touched_ids) → { alert_id, order_item_id } \| null)` (`orders/line-guard.ts`, merge-guard pattern; unregistered → never blocked). `CompLine` (every grant) and `applyComp`, `RemoveItems` and `SetLineWeight` ask it with the **planned touched ids** (after `planComp` / `planRemove`; the line itself for a weight) after their own `404` / `409` checks and before scope (C8) → `409 VOID_PENDING { alert_id, order_item_id }`. 1 statement when registered. (The v0.2 "weight on a voided line" half is dropped: 02b already refuses it with `LINE_ALREADY_SETTLED`, V18.) ⚠️ Changed by v0.2 (H1-7, OQ-B), v0.3 (H2-20), v0.4 (H3-5) | V8 |
| Q-4 | 02b → **v1.0.10** §3.5, §3.9, §4.3 To 04 + code (`orders/line-change.ts` `changeDrafts`) | (0) **Mode** `lineChangeDrafts(ctx, order_id, changes, { stale_comps: 'close' \| 'keep' } = 'close')`: `keep` judges no comp request at all and skips the comp `listOpen` read (used only by 04's void `apply`, where a foreign `AlertClosed` would break K-1); the `LineChangeDrafts` type in `orders/contracts.ts` gains the option (H8-7) ⚠️ Changed by v0.8 (H7-1). (1) Text: "a void calls `lineChangeDrafts` once per command; in an approval every returned draft carries the request's `alert_id`"; dispositions per 04 V3. (2) **Code:** `changeDrafts` judges only open comp requests whose `order_item_id` is a line in `changes` (`freeOf` returns `undefined` for any other line, as `CompLine`'s own `staleCompCloses` call already does). An already-stale comp request elsewhere on the order then stays open until its own line changes or it is answered (01d refuses the answer if it no longer fits). Applies to `RemoveItems` too; 02b test for both. ⚠️ Changed by v0.3 (H2-1) | V5, V8, H1-2 |
| T-1 | 03a → **v1.2.4** §4.2 + code (`ItemVoided.v1.ts`, `ItemMovedToStock.v1.ts`, `StockReleased.v1.ts`, `StockAdded.v2.ts`, `StockReserved.v1.ts`) | Additive optional fields, no payload version bump (R29), exact Zod ⚠️ v0.8 (H7-6): `ItemVoided` + `alert_id`, `approver_staff_id`, `note`, `disposition_note`: `z.string().nullable().optional()`; `requester_staff_id`: `z.string().optional()`; `reason_code`: `z.enum(VOID_REASON_CODES).optional()`; `disposition`: `z.enum(VOID_DISPOSITIONS).nullable().optional()`. `ItemMovedToStock`, `StockReleased`, `StockAdded` v2, `StockReserved` + `alert_id: z.string().optional()` (a direct void writes it **absent**). Fixture test 49 with `null` values and with the fields absent. These schemas are non-strict, so the fields **must be declared** or they are stripped. `stockEffects` never sets `alert_id` (the writer stamps it); folds ignore the new fields; fixture tests. | V5, V6 |
| T-2 | 03a → **v1.2.4** §3.7 move to stock, §4.3 To 04 (text) | `ItemMovedToStock` is written **before** the `ItemVoided` of the same units, in one `stockEffects` array; a partial move of a `cooking` / `done` line releases nothing (`reserved = 0`, pinned by 04 spike 0). **Code (`packages/engine/src/stock.ts` `waitingReserve`):** the moved portion is never reserved by a line that **the array ends**: before its loop, `stockEffects` collects **every line named by any `ItemVoided` / `ItemRemoved` cause anywhere in the array** (earlier or later than the move, whole or partial; an `ItemRemoved` without `units` counts) and excludes them all, together with the moved line. A partly voided line is excluded too: the scratch `book` never shrinks its draw, so it would claim its pre-void quantity and the fold would breach (`foldStockReserved` past the draw); it waits for the next `StockAdded` / `StockSet` like any other line ⚠️ Changed by v0.6 (H5-1, H5-5). (The scratch `book` folds stock events only, so a line ended by an **earlier** cause still looks like a hidden candidate; v0.4's "later cause" missed it ⚠️ Changed by v0.5 (H4-1).) No new field: the array holds every cause. A line of the same order that stays live (a waiting second-round karahi) may take the portion. ⚠️ Changed by v0.3 (H2-6), v0.4 (H3-2), v0.5 (H4-1), v0.6 (H5-1) | V4, H1-25, H2-6, H3-2, H4-1, H5-1 |
| T-3 | 03a → **v1.2.4** Q-v1.2-2 answer + hub host code (`apps/hub/src/engine-host/reducer.ts` `logAbsentIds`) | 03a v1.2 left "04 decides" whether `engine fold: absent id` warns on voids are noise. **Decision: `ItemVoided` and `ItemRemoved` never log an absent line id** — their writers (02b `RemoveItems`, 04 `VoidItems` / `apply`) check the id against `order_lines` in the same transaction, so an absent id there is a station-less line, a header or an order out of the engine, never a fault. Every other line event keeps the warn (an absent `ItemMovedToStock` stays a warn: `moved` needs an engine-open line). **Edit:** remove `ItemRemoved` / `ItemVoided` from `LINE_EVENTS` (`reducer.ts:151`); drop `QUIET_ON_UNTRACKED_LINE` (now unused) and their `QUIET_ON_UNTRACKED_ORDER` entries; no untracked-set or boot-SQL change. Trade-off: an engine-state drift on a voided / removed line is silent; `ItemStarted` / `ItemDone` / `ItemServed` still catch drift. **03a v1.2.4 restates** test rows #125 (control), #133, #134, #135 with an **`ItemServed { source: 'tap' }` probe on an unknown line of that order** (order-level quiet still applies to it, so the warn proves the order left the set); the R-3 note → "after 04 T-3 no line event reads the set's line ids, so R-3's accepted warn is gone; the boot read and the line ids stay (test 130 unchanged) and are read by nothing"; the R-3 test (`boot-idset.int.test.ts:209`) is **removed**; 03a §3.3 host filter and row Q-3 → "`ItemRemoved` / `ItemVoided` never log an absent id (04 T-3); the filter's line ids are kept but read by nothing" ⚠️ v0.11.1 (H11-3); #125's four shapes stay (now trivially quiet). Tests `apps/hub/test/engine/{zone-filter,boot-idset}.int.test.ts` follow ⚠️ v0.10 (H9-2), v0.11 (H10-1). Host tests: station-less drink voided in an in-engine order, line of an abandoned order voided → no warn; `ItemStarted` on an unknown id → warn. ⚠️ Changed by v0.8 (H7-7), v0.9 (H8-3) | V1 (b), (c) |
| B-0 | 03b, 03c | **No change.** Voided lines leave KDS / Pass and CANCELLED slips print as both specs already say; nothing shows while a void is pending (owner Q8). 03c adds `ticket_reprinted` through `registerAuditAction` when it ships `TicketReprinted`. | — |
| R-1 | README (on approval) | Module map row 04 at the approved version; carried rows **To 05** and **To 06** from §4.3; carried row :227 marked landed by 04 plan task (manual checks). | §4.3 |

### 4.6 Carried rows (README) and where they land

| Row | Lands in |
|---|---|
| :199 R22 | §3.4, §3.5; tests 20–31 |
| :213 01c §3.4.8 | V2, V18, §3.3; tests 40–49 |
| :225 01d v1.0 | §3.4, §3.5 (read-only `apply`, `alert_id`, approver from the answer, billed refused in `preRead`, `onWithdraw`); OVERRIDDEN → V9 / F-2; rejected notice → V11 / D-2 |
| :227 01d manual checks | plan task (`docs/plans/01d-manual-checks.md` rows 1b, 4, sounds, request screens) |
| :239 02a | §6.6 merge guard; tests 33–34 |
| :242 03a | §3.3; tests 10–14 |
| 02b To 04 | V2, V3, §3.2 rule 5, §3.3; tests 1–19, 40–49 |
| 03a Q12 / 02b G1-18 | V13 |

---

## §5. Data model (hub SQLite)

Migration `apps/hub/src/db/migrations/NNNN_audit.sql` (next free number at build time, after 03b / 03c's).

No void table: pending state lives in 01d's `alerts` (`values_json`, `alerts_open_kind`), money in 02b's `order_lines` (V2).

⚠️ Changed by v0.2 (H1-8, H1-23), v0.3 (H2-21): no names in rows; two lookup tables the projection folds itself; indexes ordered `recorded_at DESC, seq DESC`; `recorded_at` is the envelope's.

```sql
-- 04 §3.6: read model of the curated audit actions; folded from events only; projection reset deletes all three tables.
-- Names: staff_names (00 row H-1), joined at read; never part of the fold.
CREATE TABLE audit_entries (
  seq               INTEGER PRIMARY KEY,          -- the event's seq (one row per mapped event)
  event_id          TEXT    NOT NULL UNIQUE,
  recorded_at       INTEGER NOT NULL,             -- envelope recorded_at, hub clock (E6 AC3); same order as seq
  action            TEXT    NOT NULL,             -- AUDIT_ACTIONS
  actor_staff_id    TEXT,                         -- the person who did it (§3.6 columns per action; requester on approved voids / comps)
  approver_staff_id TEXT,
  method            TEXT CHECK (method IN ('session','pin','in_person')),
  device_id         TEXT    NOT NULL,
  subject_type      TEXT    NOT NULL,             -- order / table / staff / device / station / stock / day
  subject_id        TEXT    NOT NULL,
  order_id          TEXT,
  table_code        TEXT,                         -- request rows: AlertRaised.display.table_code
  table_id          TEXT,                         -- order rows: the table the order was placed at (audit_orders)
  reason            TEXT,                         -- reason_code[: note], ≤ 200
  outcome           TEXT,                         -- approved / rejected / withdrawn / disposition / mode
  amount_minor      INTEGER,                      -- refund, comp value, … (D47)
  detail_json       TEXT    NOT NULL              -- the rest, small (≤ 2 KB)
);
-- GET /queries/audit-log: newest first in a time range …
CREATE INDEX audit_entries_time   ON audit_entries (recorded_at DESC, seq DESC);
-- … by staff member (as actor or approver; two index scans in one UNION ALL statement)
CREATE INDEX audit_entries_actor  ON audit_entries (actor_staff_id, recorded_at DESC, seq DESC);
CREATE INDEX audit_entries_appr   ON audit_entries (approver_staff_id, recorded_at DESC, seq DESC) WHERE approver_staff_id IS NOT NULL;
-- … by action type
CREATE INDEX audit_entries_action ON audit_entries (action, recorded_at DESC, seq DESC);

-- lookups folded by the same projection (never deleted by alert retention)
CREATE TABLE audit_requests (
  alert_id           TEXT PRIMARY KEY,            -- AlertRaised with request ≠ null
  kind               TEXT NOT NULL,
  requester_staff_id TEXT,
  order_id           TEXT,                        -- subject when subject_stream_type = 'order'
  table_code         TEXT,
  answerer_staff_id  TEXT                         -- set by the fold on RequestAnswered (v0.5, H4-2)
);
CREATE TABLE audit_orders (
  order_id TEXT PRIMARY KEY,                      -- OrderPlaced
  table_id TEXT                                   -- null for takeaway / parking
);
```

Size: R6 ≈ 2 000 orders / day → mapped rows ≈ 1–3 % of ~75 000 events ≈ 1 000–2 500 rows / day, plus 2 000 `audit_orders` and a few hundred `audit_requests` rows / day; kept forever like the events (no retention job; YAGNI until a size problem is measured).

Projection `audit` folds only events, so its registration order does not matter (test 54 asserts it reads no other projection's table).

---

## §6. Commands, events and queries

### 6.1 `VoidItems` (`POST /commands/VoidItems`, not queueable)

- **Permission:** `void-item`, `approvable: true`, session `device` (staff). Scope `branch` (C8, last).
- **Payload:**
  ```json
  { "order_id": "01JDQ…", "reason_code": "customer_changed_mind", "note": null, "disposition_note": null,
    "lines": [ { "order_item_id": "01JDQ…K1", "units": 1, "disposition": "moved" } ] }
  ```
  `lines` 1–40, keyed (C6); `units` int ≥ 1 optional; `disposition` ∈ §4.4; `reason_code` ∈ §4.4; `note` ≤ 200 (required for `reason_code: other`); `disposition_note` ≤ 200 (required when any disposition is `other`).
- **Processing script:** ⚠️ Changed by v0.2 (H1-2, H1-3)
  1. Zod (`400`).
  2. `readOrder(ctx, order_id)` (02b, 1 statement) → `404 ORDER_NOT_FOUND`; `billed_at` set → `409 ORDER_BILLED`.
  3. `alerts.listOpen(db, { kind: 'void_approval', subject: order })` and `alerts.listOpen(db, { kind: 'comp', subject: order })` (2 statements, both on `alerts_open_kind`) → open void and comp requests of the order (rule 6). ⚠️ Changed by v0.7 (H6-12)
  4. Resolve the grant (in memory). Each entry in payload order: §3.2 rules 1–7 against the working copy; `planVoid`; apply to the working copy; per-line dispositions.
  5. Scope `branch` (C8).
  6. Grant `allowed` → `voidDrafts` (§3.3, `alert_id: null`, `requester_staff_id` = caller, `approver_staff_id: null`) with one `withStockEffects` and one `lineChangeDrafts` (2 statements). Result `{ voided: [{ order_item_id, units, refund_minor, comp_voided_minor, disposition }], cancelled }`.
  7. Grant `requires_approval` → one raise input per entry (`kind: 'void_approval'`, `subject: order`, `target: { kind: 'answerers' }`, `dedupe_key: 'void:' + order_item_id`, `values`, `details`, `display`, `requester_staff_id: caller`, `request: { approver_role_ids }`) → **one** `alerts.raiseMany` (01d's statements). A deduped entry → `409 VOID_PENDING { alert_id, order_item_id }` (the whole command rolls back). Result `{ pending: [{ order_item_id, alert_id }] }`.
- **Idempotency:** `command_id` (D32); a retransmit returns the stored result.
- **Statements:** 3 + (direct: 2) or (request: 01d's `raiseMany` bound); engine state, directory, config in memory.
- **Audit:** `item_voided` / `item_moved_to_stock` / `void_requested` rows by fold.

### 6.2 Kind `void_approval` — `apply`, `onWithdraw` (§3.4, §3.5)

- `apply(ctx, answer)`: `reject` → `[]`. `approve` → `readOrder` (1 statement); §3.2 rules 1, 4, 5 and the stage part of 7 on the current state with the request's values and frozen `line_dispositions` (not rule 6, §3.4); `voidDrafts` with `requester_staff_id = alert.requester_staff_id`, `approver_staff_id = answer.answerer_staff_id`, `alert_id` stamped on every draft; `lineChangeDrafts` output without `AlertClosed` (else throw). Read-only. ⚠️ Changed by v0.2 (H1-1)
- `onWithdraw` → `[]`.
- `result_also_to` (D-2) → table holder for a dine-in reject.
- **Statements in `apply`:** 1 read + 1 (`lineChangeDrafts` in `keep` mode reads the order's lines and skips the comp `listOpen`, H8-7), inside 01d's answer bound; the plan of a single request equals its raise-time plan (no other request or comp could touch its lines), so `details.amount` = the applied refund (test 47).

### 6.3 `GET /queries/void-preview?order_id&order_item_ids&units?`

`void-item` (any grant). `order_item_ids` 1–40 (comma list, de-duplicated; `units` only with a single id). Runs §3.2 without writing, each id as its own entry against the order as read (no working copy across ids); `200 { data: { previews: [ … one per id … ] } }`, each `{ order_item_id, group: 'remove' | 'void', refund_minor, comp_voided_minor, touched: [{ order_item_id, name, units, stage, refund_minor, comp_voided_minor }], stage, dispositions: [{ disposition, enabled, block: VoidBlock | null, line_dispositions }], needs_approval, pending: { alert_id } | null, comp_pending: { alert_id } | null }` (`group: 'remove'` when V1 says the line is still at stage 1; then the other fields are empty). Only malformed input, an unknown order (`404`), a billed order (`409 ORDER_BILLED`) and a foreign id (rule 1, `400`) fail the call; rule 4 is `group` (a return line at stage 1 → `remove`, past it → `void`), rule 5 (`units`, single-id only) a `400`, 6–7 in `pending` / `comp_pending` / `dispositions`. **3 statements** (`readOrder` + the two `listOpen` reads by kind) for any number of ids ⚠️ Changed by v0.8 (H7-9). ⚠️ Changed by v0.6 (H5-3), v0.7 (H6-1) ⚠️ Changed by v0.5 (H4-8)

### 6.4 `GET /queries/pending-voids?order_ids=…` (1–40) or `?seating_id=`

`take-order` or `void-item` or `approve-void`. `200 { data: { orders: [{ order_id, voids: [{ alert_id, order_item_id, units, touched_ids, refund_minor, comp_voided_minor, requester_staff_id, raised_at, blocked }] }] } }` — `pendingVoids` with the engine state (1 statement; `seating_id` resolves through `seating_orders` in the same statement). `blocked: 'not_movable_stage' | null` = a stored `moved` line is no longer at `cooking` / `done` (OQ-D), so an approve would be refused. ⚠️ Changed by v0.3 (H2-5), v0.8 (H7-5), v0.4 (H3-8)

### 6.5 `GET /queries/audit-log?from&to&staff_id?&action?&cursor?&limit?`

⚠️ Changed by v0.2 (H1-9, H1-23)

`view-audit-log` (scope `branch`). `from` / `to` Unix ms, `from < to`, `to − from ≤ 31 days`, else `400`; `action` comma list ⊆ `AUDIT_ACTIONS`; `staff_id` matches actor **or** approver; Foundation §6 cursor: `cursor` opaque (encodes the last `(recorded_at, seq)`), `limit` 1–200, default 50. Order `recorded_at DESC, seq DESC` (the index order, no temp sort).
`200 { data: { entries: [AuditEntryView] }, meta: { next_cursor: string | null } }`, `AuditEntryView` = the row plus `actor_name`, `approver_name` (`staff_names`, LEFT JOIN at read; OQ-E) and `table_name` (branch config in memory; an archived table falls back to the stored `table_code`, then the id, as `comp-line.ts` `tableCode`). **1 statement.** With `staff_id`: `UNION ALL` of the actor scan and the approver scan `AND actor_staff_id IS NOT approver_staff_id` (an approve on one's own tablet is one row, and the cursor key stays unique). With `action`: one branch per listed action (each on `audit_entries_action`); `action` values de-duplicated in Zod (a repeat → `400`, C6 style). With `staff_id` **and** k actions: 2k branches (actor × action, approver × action). The statement is a **plain `UNION ALL` of the branches** with **one** outer `ORDER BY recorded_at DESC, seq DESC LIMIT :limit + 1`; every branch's `WHERE` carries the range, its staff / action predicate and the cursor predicate `(recorded_at, seq) < (:r, :s)` (row-value form keeps the index range). SQLite plans it as `MERGE (UNION ALL)` over the ordered index scans and stops at the limit: **no temp sort in any shape** (checked with `EXPLAIN QUERY PLAN`; per-branch sub-selects would add one temp B-tree per branch, so they are not used). ⚠️ Changed by v0.4 (H3-6), v0.5 (H4-4, H4-6) CSV: the client pages through and builds the file (V17). ⚠️ Changed by v0.3 (H2-10, H2-11, H2-22)

### 6.5b `GET /queries/audit-staff` ⚠️ Changed by v0.7 (H6-3)

`view-audit-log` (scope `branch`). `200 { data: { staff: [{ staff_id, display_name, in_directory }] } }` — `SELECT staff_id, display_name FROM staff_names ORDER BY display_name` (**1 statement**; a few hundred rows, no cursor; its small temp sort is accepted — §6.5's "no temp sort" rule is for the audit log only); `in_directory` from the hub directory in memory (0 statements). The picker for §6.5's `staff_id`. ⚠️ Changed by v0.8 (H7-10)

### 6.6 Registrations at startup (`apps/hub/src/voids/index.ts`, `apps/hub/src/audit/index.ts`)

- `registerMergeGuard((db, { seating_ids, order_ids? }) → { blocked, order_item_ids })`: open `void_approval` alerts whose subject order is in `order_ids` when given (split: only the orders that move, 02a §3.12), else in those seatings (merge, via `seating_orders`) → blocked with their `touched_ids` (1 statement). ⚠️ Changed by v0.7 (H6-7)
- `registerLineGuard((db, order_id, touched_ids) → …)` (row Q-3): open `void_approval` of the order whose `touched_ids` meet the given ids (1 statement).
- Projection `audit` (§5) folding `AUDIT_ACTIONS`' event types plus `AlertRaised` (all request kinds, for `audit_requests`) and `OrderPlaced` (for `audit_orders`).

### 6.7 Events written (no new event type)

| Event | Writer here | Fields 04 fills |
|---|---|---|
| `ItemVoided` (03a schema + T-1) | `VoidItems`, `apply` | `order_item_id`, `units`, `refund_minor`, `comp_voided_minor`, `disposition` (per line), `reason_code`, `note`, `disposition_note`, `requester_staff_id`, `approver_staff_id`, `alert_id` |
| `ItemMovedToStock` (+ T-1) | same, per line with disposition `moved` | `order_item_id`, `units`, `alert_id` |
| `StockReleased` / `StockAdded` / `StockReserved` (+ T-1) | `stockEffects` drafts | `alert_id` (approval path) |
| `OrderCancelled` / `OrderFoodCleared` (+ Q-1) | `lineChangeDrafts` drafts | `alert_id` (approval path) |
| `AlertRaised` (01d) | `raiseMany` | kind `void_approval` |

### 6.8 Example — Table 12, karahi cooked, order taker asks, manager approves

```
Hamza  VoidItems { order_id: O7, reason_code: customer_changed_mind,
                   lines: [{ order_item_id: K1 (Mutton Karahi ×1, done), disposition: moved }] }
       → grant requires_approval → AlertRaised void_approval A9
         { touched_ids: [K1], line_dispositions: { K1: moved }, details.amount 240000 }
       → 200 { pending: [{ order_item_id: K1, alert_id: A9 }] }
Imran  AnswerRequest A9 approve (PIN, own tablet)
       → RequestAnswered · ItemMovedToStock{K1,1,A9} · StockAdded{karahi,1,moved,A9}
         · StockReserved{hidden (not yet fired) T4 karahi, A9}   -- a T4 line already on the KDS keeps cooking (03a rule) ⚠️ v0.7 (H6-17) · ItemVoided{K1,1,refund 240000,moved,…,approver Imran, A9}
         · (OrderFoodCleared{O7,A9}) · request_result → Hamza · approval_receipt → Imran
```

Deal variant (OQ-C): deal D (karahi part P1 `done`, naan part P2 `added`), `moved` → `line_dispositions { D: null, P1: moved, P2: null }`: `ItemMovedToStock{P1}`, `ItemVoided{D}`, `ItemVoided{P1, moved}`, `ItemVoided{P2, null}` with P2's `StockReleased { voided }`.

---

## §7. Cross-cutting

- **Concurrency:** single writer (F §4.1). Two voids on the same named line race to `alerts_open_dedupe`; overlapping cascades are caught by rule 6 (b) in the same transaction; the second gets `VOID_PENDING`. A comp raised or approved after a void's raise is refused by the line guard on its planned touched ids (Q-3). Approve vs withdraw: 01d first-commit-wins.
- **Logging:** void commands log `{ command, order_id, lines: n, path: direct | request }`, never notes in full (≤ 40 chars) and never PINs (00 §7.2).
- **Privacy:** the lock-screen text has no money (01d §3.12); `details` only on signed-in cards. The audit view needs `view-audit-log`; `OrderContactSet` never in it.
- **No retention job** for the audit tables (§5 size).
- Nothing else (no cache, no rate limit beyond 00's): YAGNI.

---

## §8. Client contract (`apps/client`, staff entry, ui-kit only; R5 permission-derived)

- **Void action** on a line past stage 1 in the order / bill views, shown when the session holds `void-item` (any grant). Stage-1 lines keep 02b's Remove.
- **Void sheet:** opens with `void-preview`; units stepper (piece lines and deal portions; g/ml items fixed 1); disposition radios from `dispositions` — `moved` pre-selected when enabled, else `wastage`; disabled rows show their reason ("Stock not tracked for this item", "Not cooking or cooked", "You can't move to stock", "Business day closed"); a partly movable deal shows "Cooked parts to stock, the rest released"; reason chips (V12) + note box for Other; amount shown (`refund_minor`); button "Void" (`allowed`) or "Ask for approval" (`needs_approval`). A locked line shows "Void pending · Withdraw" for the requester (01d `WithdrawRequest`), "Void pending" for others; a `comp_pending` line on the approval path shows "A comp is waiting on this item — decide it first".
- **Cancel order** ("Void all"): the two groups come from **one** `void-preview` call with every live parent line (`group` per line; V1, incl. (d′): an item at `added` with a started child goes to the void group), never from a line's own stage ⚠️ Changed by v0.4 (H3-4), v0.5 (H4-8). One flow that sends **first** `RemoveItems` for the stage-1 lines (02b, needs `take-order` and the table lock), **then** one `VoidItems` with **parents only** (items and deals; an option child or deal part only when its parent is not in the void) for every live line past stage 1 (one request each, V7); the sheet lists both groups. **Return lines** (remake / fix) go into the group their preview gives, like any line (Q-R1), so Void all cancels the whole order ⚠️ Changed by v0.6 (H5-3), v0.7 (H6-1). **Per-entry disposition default** from that entry's own preview: `moved` when its `moved` is enabled, else `wastage`; one group-level "Waste all" override plus per-line change. A **failed `RemoveItems`** (`TABLE_ALREADY_LOCKED`, `TABLE_SEATING_CHANGED`, no `take-order`) stops the flow: show the error, reload `void-preview`, nothing is voided ⚠️ Changed by v0.7 (H6-8). If the second command fails (e.g. `COMP_PENDING`) the removals stay; the sheet reloads `void-preview` and shows what is left with a retry. ⚠️ Changed by v0.2 (H1-18), v0.3 (H2-6, H2-16), v0.4 (H3-14)
- **Pending tag:** lines in `pending-voids` show **PENDING VOID** and the screen's running total excludes their `refund_minor`. Refresh: after the screen's own `VoidItems` / `WithdrawRequest`, on 00 `event` frames of the open order's stream (`ItemVoided`, `OrderCancelled`), on 01d `alert` / `alert_closed` frames the device receives, and on screen focus. A third device that receives no frame may show a stale tag until focus; correctness does not depend on it (05 refuses bill close server-side, 02a refuses merge). ⚠️ Changed by v0.2 (H1-24)
- **Errors:** `VOID_PENDING` → "A void is already waiting on this item"; `COMP_PENDING` → "A comp is waiting on this item — decide it first"; `ITEM_WRONG_STAGE { stage: 'added' }` → "Not started — use Remove"; `ORDER_BILLED` → "Bill closed — refunds are at the counter"; `VOID_NOT_ALLOWED { reason: 'not_movable_stage', hint: 'withdraw_and_reask' }` on an approve → "Served meanwhile — ask the requester to withdraw and ask again as wastage; if they are not here, reject it and void it yourself (or anyone with `void-item` allowed)" (approver) ⚠️ Changed by v0.7 (H6-15), and the requester's pending row shows "Can't be approved as stock any more — withdraw and ask again" when `pending-voids` returns `blocked: 'not_movable_stage'` (refreshed on `ItemServed` / `event` frames of the order, including hub-written `ItemServed { source: 'estimated' }`, OQ-D, H8-12). ⚠️ Changed by v0.2 (H1-17), v0.3 (H2-5), v0.5 (H4-9)
- **Approver card** (01d screens): §3.5 `details` (owner Q16): stage per line and disposition (D-3) shown separately. Client text keys include `alert.void_approval.name` (the kind's name in lists, 01d To 04). ⚠️ Changed by v0.3 (H2-3, H2-17)
- **Audit log screen** (`features/audit/`, `view-audit-log`): date range (default today), staff picker **from `GET /queries/audit-staff`** (everyone in `staff_names`, leavers included; a person not in the current directory is marked "left") ⚠️ Changed by v0.7 (H6-3), action multi-select; newest first, infinite scroll by `meta.next_cursor`; row: time, who (name or id), action, target (table / item), reason, outcome, amount, approver + method ("in person", "on requester's device"); **Export CSV** pages through the same query (≤ 31 days) and saves in the browser.
- i18n keys only (D12), Latin digits (R20).

---

## §9. Error catalogue additions (Foundation §6.2, `@pos/domain/src/errors.ts`)

⚠️ Changed by v0.2 (H1-13)

| Code | Status | `details` | When |
|---|---|---|---|
| `VOID_NOT_ALLOWED` (**new**) | 409 | `{ order_item_id, reason: 'not_movable_stage' \| 'stock_not_tracked' \| 'day_closed', hint?: 'withdraw_and_reask' }` | §3.2 rule 7; §3.4 approve re-check |
| `DAY_CLOSE_BLOCKED` (**new**) | 409 | `{ reason: 'void_pending', voids: [{ alert_id, identifier, item, requester_name }], count }` (≤ 40 listed) ⚠️ v0.8 (H7-4) | `CloseBusinessDay` while any `void_approval` request is open (row A-1) ⚠️ Changed by v0.7 (H6-2) |
| `VOID_PENDING` (exists, D11; details defined here) | 409 | `{ alert_id, order_item_id }` | a touched line is in an open void request (void, comp raise / approve, remove, weight — the last three through 02b's line guard) |

Reused: `400 VALIDATION_FAILED` (`issues[].path` / `message`: `gml_deal_part_partial`, `overlaps_entry`, units, notes), `403 PERMISSION_DENIED` (`outside_scope`; new reason value **`move_not_granted`**), `404 ORDER_NOT_FOUND`, `409 ORDER_BILLED`, `409 ITEM_WRONG_STAGE` (stage values `added`, `zone_undo`), `409 LINE_ALREADY_SETTLED` (02b, weight on a voided line, V18), `409 COMP_PENDING`; 01d's answer codes unchanged.

---

## §10. Tests (`apps/hub/test/voids/*.test.ts`, `apps/hub/test/audit/*.test.ts`, `packages/domain/src/audit.test.ts`; client tests in `apps/client`)

⚠️ Changed by v0.2 (H1-11 and the findings each test names).

**Spike (plan task 1, G1-8):** **0.** raise → approve → `ItemMovedToStock` + `StockAdded` (2 of 4 naan, `cooking`) → `ItemVoided` folded by 02b's ledger → engine line shrunk → **no `StockReleased`** for the moved share (H1-25) → every draft carries `alert_id` → audit rows; proves `stock_ctx` and engine state inside a read-only `apply`, that 01d's answer path folds engine events, and the lock check does not refuse its own request (H1-1).

**VoidItems, direct (`allowed`):** 1 happy path cooking line, wastage → refund, engine line ended. 2 served engine line → money only, engine no-op. 3 order out of engine (abandoned) → money only. 4 engine stage `added` → `ITEM_WRONG_STAGE { added }`. 4b **non-engine line** (drink, no station): served → voidable, money only, `moved` disabled, wastage void writes `ItemVoided{drink, wastage}` (not a header, H4-3); unserved → `ITEM_WRONG_STAGE { added }` (H1-6). 4c option child alone: (i) with its own engine line at `cooking` under an item at `added` → voidable by its own stage; (ii) with no engine line → judged by its parent (H3-4). 4e no-engine option child of a **served** item voided alone with `staff_meal` → `ItemVoided{child, staff_meal}` (H4-3). 4f served non-engine drink + its non-engine option child, `wastage` → **both** `wastage` (not a header, H5-2). 4d **item at `added` with its option child `cooking`** → voidable, item and child `ItemVoided`, child disposition as chosen, item `null` (H2-14). 5 **return line** (remake) past stage 1 → voided, refund 0, engine line ended, audit `item_voided`; at stage 1 → `ITEM_WRONG_STAGE { added }` (Remove) (Q-R1, H6-1). 6 **pending-weight line** → voided, refund 0; a later `SetLineWeight` → `409 LINE_ALREADY_SETTLED` (02b, OQ-B, H3-5). 7 billed → `ORDER_BILLED`. 8 unknown order → 404; foreign line → 400 path. 9 repeated id → 400 (C6). 10 **moved partial** 2 of 4 naan: `ItemMovedToStock` before `ItemVoided`, `StockAdded` = 2 portions, waiting line reserved, engine units 2 (T-2). 10b **two `moved` entries** on lines of the same stock item with one waiting line → exactly **one** `StockReserved` (H1-2). 10c **OQ-C deal whose unstarted part P2 is on the same stock item** as the moved part, plus a waiting T4 line → the moved portion is reserved for **T4**, never for P2 (H2-6, T-2). 10d Void all on two karahi lines of one order (one moved) + waiting T4 → T4 reserved (H2-6). 10e **same order, second-round karahi K2 waiting and not voided**, K1 voided `moved` → K2 reserved (H3-2). 10f entries `[deal D with karahi part P1 at added, karahi K1 done moved]` **in that order**, with and without a waiting T4 → never `StockReserved{P1}`; T4 reserved when present (H4-1). 10g **pure `stockEffects` test** with a hand-built array (not reachable through `VoidItems`, rule 4): one at-`added` line named by two partial causes plus a moved line → that line never reserved (H4-1, H5-4). 10h `[deal D ×2 units 1 with karahi part P at added waiting, K1 ×2 done moved]` (and the reverse order), waiting T4 present → never `StockReserved{P}`, T4 reserved, no `stock_breach` (H5-1). 10f–10h run the engine fixture in strict mode so a `stock_reserved_past_added` or breach throw fails the test. 11 moved on a line with no draw → `stock_not_tracked`; on served → `not_movable_stage`; caller without `move-item-to-stock` → `403 move_not_granted`; day closed → `day_closed`. 11b **deal partly cooked** with `moved` → cooked part `moved`, unstarted part `null` + `StockReleased { voided }` (OQ-C). 12 a still-reserved line voided → `StockReleased { voided }` share. 13 zone line in undo window → `ITEM_WRONG_STAGE zone_undo`; after → money only, zone count unchanged. 14 **"Void all" of 3 lines** past stage 1 (last live lines) → exactly **one** `OrderCancelled`, no `OrderFoodCleared` (H1-2); food cleared case → exactly one `OrderFoodCleared`. 14b overlapping entries on the direct path `[deal D ×1, its part P ×1]` → working copy: P's share index taken once, refunds sum ≤ billed (H1-3). 15 `reason_code: other` without `note` → 400; `disposition: other` without `disposition_note` → 400. 16 retransmit → stored response, no second event (D32). 17 COMMIT failure → nothing written, engine state unchanged (D45). 18 scope `branch` last (C8): a 404 / 409 wins over scope. 19 **direct void on a line with an open comp request** → voided, the comp request closed `obsolete` (G1-1b, H1-4). 19b direct void on a locked line → `VOID_PENDING`.

**Approval:** 20 `requires_approval` → one `AlertRaised` per entry (takeaway → `details.identifier = '#<token>'`, `display.table_code` null; parking → `PARKING …`; dine-in merged T4 + T5 → `T4 + T5`; a three-table merge with a `joined_at` tie → 03b's order; a label > 40 chars → `details.identifier` is 40 chars and the request is raised (H7-8, H8-4, H9-3, H10-2, H10-3); 20c 04's identifier = 03b's `passIdentity` / `identifierText` for `#12`, `#12 10 Nov`, `PARKING LEB 1234 SEDAN`, `T4 + T5`, the tie merge, the long label and a dine-in order with no current table (H10-7, H11-1); deal `wastage` → `details.disposition = void.disposition.wastage`; OQ-C deal `moved` → `moved_partly`, H6-6), values / details / display as §3.5 (incl. `labels { card, lock }`, `silent: false`, `values.refund_minor` / `comp_voided_minor`; stored `details_json` keeps `disposition`, D-3; a 200-char note → `reason` sliced to 200), no `ItemVoided`. 20b **`void-item requires_approval` + `move-item-to-stock allowed` + `moved`** → a request, nothing applied (V4, H2-24). 21 **approve with the lock check live** → applied: drafts with `alert_id` on **every** draft (`checkAlertIds` passes), approver = answerer, requester = raiser (H1-1). 22 approve `in_person` → approver = named answerer, `actor_id` = requester device's session (01d). 23 reject → `[]`, line still billed, `request_result` to requester and **to the table holder** (D-2); takeaway → requester only; holder = requester → one result. 24 withdraw → `[]`, lock lifted, a new request **with a different disposition** (moved → wastage) allowed and approved (H6-10). 24b `CloseBusinessDay` with an open void request → `409 DAY_CLOSE_BLOCKED { reason: 'void_pending', voids: [{ alert_id, identifier, item, requester_name }], count }` (41 open → 40 listed, `count` 41) (H8-5, H8-11); after approve / reject / withdraw → closes (Q-DC, H6-2). 25 approve after the order was billed (fixture) → refused in `preRead` before PIN (spy: argon2 not called). 26 *(removed in v0.8: `day_closed` is unreachable at approve, A-1; the reachable re-checks are 25 billed and 26b not movable)* (H7-5). 26b **`moved` line served meanwhile** → `pending-voids` shows `blocked: 'not_movable_stage'`; approve refused `VOID_NOT_ALLOWED { not_movable_stage, hint: withdraw_and_reask }`; withdraw + re-ask as wastage → approved (OQ-D, H1-17, H2-5). 26c **deal part P2 at `added` at raise, started before the approve** → approved, `ItemVoided{P2, wastage}` and `ItemVoided{D, null}` (header never wastage) (OQ-F, H2-2, H3-3); also on a **partial** deal portion (1 of 2) (H6-10). 27 locks: second void on a locked line (named or cascaded child) → `VOID_PENDING`; comp on it → `VOID_PENDING`; **comp on the deal whose part is locked** (cascade) → `VOID_PENDING`; **`applyComp` asks the guard too**: a fixture with an open comp request whose planned lines meet a void lock (a state 28 prevents in normal use) → the comp approve is refused `VOID_PENDING` (defence in depth, H1-7); remove of a locked deal's stage-1 part → `VOID_PENDING`; weight → `VOID_PENDING`. 28 void request on a line with an open comp → `COMP_PENDING`; **void request on a deal part while a comp request is open on the deal** → `COMP_PENDING` (H1-7). 29 three entries → three requests in one transaction; one deduped → whole command rolls back. 29b **overlapping entries on the approval path** → `400 overlaps_entry` (H1-3). 30 `apply` with a stray `AlertClosed` from an **injected `lineChangeDrafts` stub** (in `keep` mode the real one returns none) → throws (assert) (H8-7). 30b **already-stale comp request elsewhere on the order** (comp on item I approved while child C's own comp request is open) → a void request on another line approves, **no `AlertClosed`** (Q-4, H2-1); 02b's own test: RemoveItems of an unrelated line leaves C's request open. 30c with the same fixture, a void **request** on I (touching C) → not blocked by C's stale comp request (H3-7), **and its approve succeeds**: approved, no `AlertClosed`, C's comp request still open; C's comp approve then refused by `applyComp`'s check (H7-1). 31 01d answer bound: approve / withdraw unchanged, reject = old bound + D-2's (H1-12).

**Permission matrix (G1-7, K-7, OQ-A):** 32 `void-item` not granted → 403; `allowed` → direct; `requires_approval` → request with the grant's approver roles; per-person **denied** → 403 over a role grant; two roles allowed + requires_approval → allowed (D19); approver `approve-void` `branch` → covers all; `my_team` → requester below in the tree only, else `out_of_range`; self → `self`; approver role removed after raise → `not_approver`; approver without `approve-void` → `not_approver`; **`move-item-to-stock` with `requires_approval` → refused by the roles API (B-2)**, and a stray one on the hub → `move_not_granted`; defaults after `seed-tenant` and after the backfill migration (B-1): Cashier / Order taker `void-item` requires_approval by Manager, `move-item-to-stock` allowed; **the hub directory after the backfill lists Manager in `approver_role_ids`** (`role_permission_approvers` row present) and a Cashier void raises a request the Manager can approve; a stray `move-item-to-stock requires_approval` became `allowed`; roles API refuses it with **422**; backfill idempotent and bumps `directory_version` once (H2-4, H2-13).

**Guards and exports:** 33 merge with a pending void → `MERGE_BLOCKED_BY_VOID { order_item_ids }`; 34 split moving that order → blocked; 34b split moving an order **without** a pending void while another order of the seating has one → allowed (H6-7); after approve / reject / withdraw → allowed. 35 `pendingVoids` 1 statement for 40 orders; `refund_minor` / `comp_voided_minor` = the plan; 36 **bill with a pending void of a comped unit**: total minus `refund_minor` only equals the bill after approve (H1-5).

**Money (K-6, raised bar):** 40 deal ×1 (320 000): void 1 of 4 naan parts → part share, deal billed = total − part refund; then void the deal → refund = total − parts already refunded (01c :311). 41 g/ml part partial while open → 400 (02b shape); served g/ml part → allowed; g/ml item → whole only. 42 option child with `option_quantity` set → k × q child units; `null` child voided only with the last parent unit or alone. 43 comped units: void 3 of 4 with 2 comped → 2 uncomped to `refund_minor`, 1 to `comp_voided_minor`. 44 remainder share goes to the last unit. 45 a remade line voided → refunded share (O20). 46 **property test:** 500 random sequences of comp / remove / void / weight over random items, children and deals; after **every step**, read the projection and assert per line `moneyOut ≤ refundable`, `billed ≥ 0`, the deal-billed rule, **`billed` never rises except on a `LineWeightSet`**, `moneyOut` never decreases; and compare Σ billed per order with an **independent unit-by-unit model** (each unit's share tracked as live / comped / removed / voided in the test, not via 02b's ledger) (H1-5, H2-9, H3-12). 47 **approve amount = raise amount** (`details.amount` = Σ applied `refund_minor`) (H1-27). 48 `orders` + `audit` projections rebuilt from seq 0 = live. 49 events with and without the new optional fields parse (T-1, Q-1 fixtures).

**Audit:** 50 each `AUDIT_ACTIONS` row maps from its event fixture (`request_closed`: actor = requester, approver = closer, H7-3) (pure `toAuditEntry` with events-only lookups); unmapped → null; an approved `item_moved_to_stock` row has actor = requester and approver = answerer (H4-2); an `ItemVoided` fixture without `requester_staff_id` → actor = envelope actor (H4-5). 51 names resolved at read from `staff_names`; 51b rows present right after the H-1 migration, before any directory apply (H6-9); a leaver and a no-PIN staff member show their last known name (OQ-E, H2-7). 52 query filters: range, `staff_id` as actor or approver — **an approved void appears once under the requester's filter (as actor) and once under the approver's (as approver)** (H3-1); a **rejected** and a **withdrawn** void and a request closed `obsolete` (`request_closed`) also appear under the requester (H6-4, H6-10); approve on own tablet → **one** row; `staff_id` + 3 actions → 6 branches; `EXPLAIN QUERY PLAN` shows `MERGE (UNION ALL)` and **no `USE TEMP B-TREE`** for time-only, single staff, single action and staff + 3 actions; the cursor predicate is in every branch (H4-4, H4-6); repeated `action` → 400 (H3-6); action list (one branch per action), cursor (`meta.next_cursor`, default 50); 1 statement; archived table falls back to `table_code` / id; `to − from > 31 d` → 400; no `view-audit-log` → 403. 53 `registerAuditAction` adds an action; a duplicate event type → startup error. 54 the `audit` fold reads no table but its own (spy on statements). 55 **rebuild = live after alert retention deleted the `alerts` rows and after a table move** (H1-8). 55b adding a mapping for an old event type with the checkpoint-delete migration → old events appear after the next boot (H2-12), **also with a forced boot-time `ClockAlarm`** (H-2, H8-1). 55c first boot after the 04 migration with a forced clock alarm → `audit` holds rows from seq 0 (H8-1). 56 `OrderContactSet` never mapped.

**Client:** 57 sheet: moved pre-selected only when enabled; disabled reasons; partly-movable deal text; Ask vs Void button by grant. 58 PENDING VOID tag; total excludes `refund_minor` only. 59 "Void all": `RemoveItems` for stage-1 lines **first** (a stage-1 remake among them → order cancelled; a failed Remove → nothing voided; per-entry defaults: served drink `wastage`, done karahi `moved`) (H6-1, H6-8), then one `VoidItems` with parents only (H2-16); an item at `added` with a `cooking` child is in the void group, not Remove (H3-4); a live remake line goes to its preview's group and the order is cancelled (H5-3 superseded by Q-R1, H6-1). 60 audit screen filters + CSV export of 2 pages. 60b a removed staff member is in `audit-staff`, marked "left", and filters (H6-3).

### Acceptance

⚠️ Changed by v0.2 (H1-18, H1-22)

| Story AC | Test |
|---|---|
| E6 lifecycle — stage 2 void with reason, ready stock or wastage | 1, 10, 11, 11b, 15 |
| E6 lifecycle — stage 3 move to stock, reassigned to another order | 10, 10b |
| E6 lifecycle — served → void money / wastage (O20) | 2, 4b, 45 |
| E6 lifecycle — "every transition logged" | **partial by owner Q14**: voids, removes, comps, returns, weights logged (50); Start / Done / Served are not audit rows (they stay in the event store) |
| D11 AC1 pending excluded from total | 35, 36, 58 (05 bill) |
| D11 AC2 approvers alerted | 20 (01d delivery) |
| D11 AC3 table not closable while pending | 33, 34 (05 refuses on `pendingVoids`) |
| D11 AC4 timeout override | **not built** (owner Q9) |
| D11 AC5 approved off the bill, reason logged | 21, 50 |
| D11 AC6 rejected stays, waiter / order taker told | 23; **rejection reason not built** (01d `RequestAnswered` has none) |
| E6 audit AC1 append-only | 48, 55 (events-only read model of immutable events) |
| E6 audit AC2 actions | 50; **partial by owner Q14** (refund, discount, bill override, clock-in → 05 via `registerAuditAction`; role / permission change → cloud `config_audit`) |
| E6 audit AC3 fields | 50, 51 (name at read) |
| E6 audit AC4 viewable + filters | 52, 60 |
| E6 audit AC5 CSV | 60 |
| E0 refunds AC4 cancel whole order | 14, 29, 59 (Remove + void) |
| R22 own device | 21, 22 |
| K-7 permission-based | 32 |

---

## §11. Build order (one task per commit, TDD; platform rows first — README build-order note)

| # | Task | Files | Spec |
|---|---|---|---|
| 0 | Spec bumps with markers, each at the next free number after `main` **and** `module-03b` (§4.5 rule, H7-2): today F v1.13, 00 v1.10, 01a v2.5, 01b v1.9, 01d v1.2.5, 02b v1.0.10, 03a v1.2.4; re-read the intermediate versions first; README R-1 | `docs/specs/*`, `docs/specs/README.md` | §4.5 |
| P0 | H-1 `staff_names` (migration seeds it + directory apply upsert) | `apps/hub/src/db/migrations/NNNN_staff_names.sql`, `apps/hub/src/auth/apply-directory.ts` | H-1 |
| P0b | H-2 `applyAll` update-only checkpoints, 00 text, `registerHubProjections`, test helpers, boot test with a clock alarm | `apps/hub/src/projections/registry.ts`, `apps/hub/src/lib/boot.ts`, `apps/hub/test/helpers/{test-hub,big-fixture}.ts`, `apps/hub/test/projections/registry.int.test.ts`, `apps/hub/test/boot/boot-budget.int.test.ts` | H-2 |
| P1 | `@pos/domain/src/voids.ts` (§4.4 constants, H8-10); T-1 schema fields + fixtures; T-2 `waitingReserve` same-array exclusion (H3-2 / H4-1); T-3 quiet absent ids | `packages/domain/src/voids.ts`, `packages/events/src/events/{order,stock}/*`, `packages/engine/src/stock.ts`, `apps/hub/src/engine-host/reducer.ts`, `apps/hub/test/engine/{zone-filter,boot-idset}.int.test.ts` | T-1, T-2, T-3 |
| P2 | Q-1 `alert_id` on `OrderCancelled` / `OrderFoodCleared` | `packages/events/src/events/order/*` | Q-1 |
| P3 | D-2 `result_also_to` + D-3 `AlertDetailsBase.disposition` (`AlertRaised` v4) in 01d + bound tests | `packages/events/src/alerts.ts`, `packages/events/src/events/alert/AlertRaised.{v3,v4}.ts`, `packages/events/src/index.ts`, `apps/hub/src/alerts/{kinds,raise}.ts`, `commands/answer-request.ts`, `apps/hub/test/alerts/*` | D-2, D-3 |
| P4 | Q-2 export `readOrder`; Q-3 line guard (Comp every grant + `applyComp`, Remove, Weight on planned ids); Q-4 `changeDrafts` judges changed lines only | `apps/hub/src/orders/{exports,line-guard,line-change,contracts}.ts`, `commands/{comp-line,remove-items,set-line-weight}.ts`, `comp-kind.ts` | Q-2, Q-3, Q-4 |
| P5 | B-1 default grants + backfill migration; B-2 allowed-only rule | `apps/cloud/src/modules/staff-roles/{default-roles,service}.ts`, `apps/cloud/src/db/migrations/NNNN_void_defaults_backfill.sql`, `packages/domain/src/permissions.ts` | B-1, B-2 |
| P6 | A-1 day-close guard in 01a `CloseBusinessDay` + admin page handling | `apps/hub/src/commands/close-business-day.ts`, `apps/client/src/features/admin/stock/StockApp.tsx` (+ `errorMessage`, i18n), `apps/hub/test/*` | A-1 |
| 1 | **Spike** test 0 (stop and report on any failure) | `apps/hub/test/voids/spike.int.test.ts` | §10 #0 |
| 2 | `VOID_NOT_ALLOWED`, `DAY_CLOSE_BLOCKED` (errors.ts + F §6.2); identifier helper | `packages/domain/src/errors.ts`, `apps/hub/src/voids/identifier.ts` | §9, §3.5 |
| 3 | §3.2 checks + per-line dispositions + `voidDrafts` (one stock pass, one line-change pass) | `apps/hub/src/voids/plan.ts` | §3.2, §3.3 |
| 4 | `VoidItems` direct path | `apps/hub/src/voids/commands/void-items.ts` | §6.1 |
| 5 | Kind `void_approval` + raise path | `apps/hub/src/voids/kind.ts` | §3.5, §6.1 step 7 |
| 6 | `apply` / `onWithdraw` / `result_also_to` | `apps/hub/src/voids/kind.ts` | §6.2 |
| 7 | Guards + `pendingVoids` | `apps/hub/src/voids/{guards,exports}.ts` | §6.6, §4.2 |
| 8 | `void-preview`, `pending-voids` queries | `apps/hub/src/voids/queries/*` | §6.3, §6.4 |
| 9 | Money tests 40–49 (property test) | `apps/hub/test/voids/money.*.test.ts` | §10 |
| 10 | Permission matrix 32 | `apps/hub/test/voids/permissions.int.test.ts` | §10 |
| 11 | `toAuditEntry`, `AUDIT_ACTIONS`, `registerAuditAction` | `packages/domain/src/audit.ts` | §3.6 |
| 12 | Migration + projection `audit` (events only; needs P0b / H-2) — added inside `registerHubProjections` | `apps/hub/src/db/migrations/NNNN_audit.sql`, `apps/hub/src/audit/projection.ts`, `apps/hub/src/lib/boot.ts` (`registerHubProjections`) | §5 |
| 13 | `audit-log` query (cursor, names at read) | `apps/hub/src/audit/queries.ts` | §6.5 |
| 14 | Client Void sheet, Void all (Remove + void), pending tag | `apps/client/src/features/voids/*` | §8 |
| 15 | Client Audit screen + CSV | `apps/client/src/features/audit/*` | §8 |
| 16 | 01d manual checks with `void_approval` (README :227) | `docs/plans/01d-manual-checks.md` | §4.6 |
| 17 | Acceptance map + DoD | `docs/plans/04-status.md` | §10, §12 |

---

## §12. Definition of Done, checklist, questions, deferred

### 12.1 Definition of Done

Every §10 test green in the gate (`TMPDIR=/dev/shm …`); spike 0 green before task 2; §4.5 bumps approved and applied; statement counts asserted; acceptance table ticked in `docs/plans/04-status.md`; 01d manual checks (README :227) run on a tablet; no new dependency.

### 12.2 Endpoint checklist

| Item | Permission | Statements | Errors |
|---|---|---|---|
| `VoidItems` | `void-item` (approvable) | 3 + (direct 2 \| raiseMany) | 400, 403, 404, `ORDER_BILLED`, `ITEM_WRONG_STAGE`, `VOID_PENDING`, `COMP_PENDING`, `VOID_NOT_ALLOWED` |
| `void_approval` apply / onWithdraw | 01d rules (`approve-void` range) | 2 in apply | as §3.4 (refuses the answer) |
| `GET /queries/void-preview` (1–40 ids) | `void-item` | 3 | 400, 403, 404, `ORDER_BILLED` |
| `GET /queries/pending-voids` | `take-order` \| `void-item` \| `approve-void` | 1 | 400, 403 |
| `GET /queries/audit-staff` | `view-audit-log` | 1 | 403 |
| `GET /queries/audit-log` | `view-audit-log` | 1 | 400, 403 |
| merge guard / line guard | — | 1 each | `MERGE_BLOCKED_BY_VOID` (02a), `VOID_PENDING` |
| projection `audit` | — | own tables only | — |

Size: 4 endpoints + 1 kind + 2 guards + 1 projection (≈ 8 items; README budget 10–25 for commands / endpoints, merge floor 5) — kept as its own module because it is a milestone-A row with its own stories and a distinct read model; 26 build tasks (0, P0, P0b, P1–P6, 1–17).

### 12.3 Open questions

| # | Question | Status |
|---|---|---|
| OQ-1 | Names in the audit log | **Closed (v0.3, owner OQ-E):** resolved at read from the never-deleted `staff_names` list (row H-1); rebuild = live. |
| OQ-2 | Default `move-item-to-stock` for Cashier and Order taker | **Closed:** granted (B-1); allowed-only (OQ-A, B-2). |
| OQ-3 | 01d `result_also_to` (D-2) | Proposed; part of the §4.5 approval. |
| OQ-4 | Audit range ≤ 31 days per query, page ≤ 200 (default 50), CSV ≤ 31 days | Proposed; part of the spec approval. |

Review owner questions OQ-A–OQ-D: answered 2026-11-12 (changelog v0.2); OQ-E, OQ-F: answered 2026-11-12 (changelog v0.3). OQ-1 is now closed by OQ-E (names from `staff_names`).

**Note (H2-23):** H1-27 / test 47 ("approve amount = raise amount") supersedes G1-6 (3) ("approve recomputes; a comp in between changes the amount"): under V8 nothing can change a request's lines between raise and approve except stage, so the plan never revives G1-6 (3).

### 12.4 Deferred until needed

- Override after N minutes (F §4.5 OVERRIDDEN) — owner Q9; revisit after the pilot.
- "VOID?" tag on KDS / Pass while pending — owner Q8.
- Owner-editable void reasons — owner Q4 (R18 when the pilot asks).
- Approver choosing a different disposition at approve — owner OQ-D.
- Rejection reasons — not in 01d.
- Cloud / remote audit view — **06** (§4.3).
- Resell a served item (D10 stage 5).
- Wastage / staff-meal reports — 05 / 07 / 08 read `disposition`.
- Audit table retention — none until size is measured.

### 12.5 Hostile self-review (v0.11)

- **Races:** dedupe index + in-transaction lock check over **touched** ids; comp ↔ void locks on planned cascades, comp approve included; approve vs withdraw by 01d; one stock pass per command (no double reserve).
- **Approve path:** own lock not re-checked (§3.4), frozen per-line dispositions, served-meanwhile refused with a hint.
- **Idempotency:** D32 on `VoidItems`; 01d answers keyed by `command_id`; folds idempotent by seq.
- **K-1 strict:** every approval draft stamped; the only foreign type (`AlertClosed` of a stale comp) is impossible by V8 and asserted (test 30); holder notice in 01d (D-2), outside `apply`.
- **N+1:** fixed statements; `lineChangeDrafts` once per command; `pendingVoids` / guards 1 each; audit query 1, index order, no temp sort.
- **Money:** one ledger (02b); bill effect is `refund_minor` only; property invariant corrected; approve amount = raise amount.
- **Audit:** events-only fold, rebuild = live after retention and table moves; names at read from `staff_names`; query de-duplicated, sort rules stated; reset by checkpoint delete.
- **Targeted check v0.10:** probes that actually prove the order left the set; aggregate ordering; 03b's slicing identifier; #67 and `access_reconcile` covered; one registration function.
- **Targeted check v0.9:** H-2 carries its 00 text and test helpers; T-3 edits `LINE_EVENTS` and restates 03a rows; identifier buildable and not stripped.
- **Targeted check v0.8:** merged with main; checkpoint trap closed (H-2); quiet absent ids decided in the right file; card identity per main's convention.
- **Run 5 (full):** void apply never judges comps (`keep` mode); renumbered after module-03b; day-close refusal usable by the admin; Q-DC leftovers gone; nullable fields exact; quiet host for station-less lines; takeaway token.
- **Run 4 (full):** return lines leave like any line; day close refused with an open void; leavers in the picker; `request_closed` rows; D-3 on 03b's base; split guard on moved orders only.
- **Targeted check v0.5:** every named line excluded from a moved portion (no over-reserve); container-only headers; per-preview return-line block.
- **Targeted check v0.4:** whole-array exclusion (earlier and partial causes); approver of moved rows from `audit_requests`; header defined once; plain `UNION ALL` merge with no temp sort.
- **Run 3:** requester is the actor of approved money rows; exact same-command exclusion for moved portions; headers never wastage; option-child precedence; bounded multi-branch query.
- **Run 2:** foreign comp closes impossible in `apply` (Q-4); stale `null` parts → wastage (OQ-F); backfill writes approvers; requester sees `blocked`; same-order exclusion for moved portions.
- **Engine / stock:** move-before-void in one array; partial move releases nothing (spike).
- **Privacy:** no money on lock screens; contact events never in audit; notes ≤ 200.
- **Over-engineering check:** `staff_names` kept (owner OQ-E; 3 columns, no fold); no void table, no cache, no retention job, no override, no KDS tag, no new event type, `hasPendingVoid` dropped. `registerAuditAction` kept (03c / 05 add actions without editing 04). Two small lookup tables kept: without them the fold must read `alerts` (deleted by retention) and 02a (T19 bug).
- **Contradictions:** 00 gains two rows (H-1, H-2) — §4.5 no longer says "00 no change" ⚠️ v0.10 (H9-5); F §4.5 OVERRIDDEN and REJECTED text fixed by F-2 / D-1; 01d `line_id` by D-1; 02b Exposes and `readOrder` by Q-2; Foundation cursor used; `VOID_PENDING` reused; 03b / 03c version claims untouched (K-4).
