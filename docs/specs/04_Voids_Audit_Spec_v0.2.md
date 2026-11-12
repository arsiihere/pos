# 04 Voids + Audit — Module Spec

| | |
|---|---|
| Module | 04 Voids + Audit (hub) |
| Version | **v0.2 — Draft, needs hostile review run 2** (developer, 2026-11-12) |
| Inherits | Shared Standards from **Foundation v1.11** §6 (envelope, errors, hub HTTP, WS, list cursor, naming, tests, migrations, folders); not redefined here |
| Depends on | Foundation v1.11; 00 Hub Platform v1.8; 01b v1.7; 01c v1.1.2; 01d v1.2.1; 02a v1.1.4; 02b v1.0.5; 03a v1.2; read-only: 03b v1.0.1, 03c v1.0.1 (their "Exposes" and §4.5 claims are taken as given) |
| Read by | 05 (pending voids, bill close), 06 (cloud audit view), 07 |
| Stories | `docs/stories/04-g0.md`, `docs/stories/04-g1-decisions.md` (G1 complete, owner 2026-11-11 19:31 PKT) |
| Reviews | `docs/reviews/04_v0.1_hostile_run1.md` (FIX: 2 BLOCKER, 9 MAJOR, 15 MINOR, 8 NIT) |
| Branch | `spec-04` from `origin/main` @ `45828a7` |

### Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-11 | First draft from G0 + G1 (owner rulings K-1–K-8, Q1–Q16). |
| **v0.2** | 2026-11-12 | Fixes every finding of hostile run 1 (H1-1–H1-34), each marked "⚠️ Changed by v0.2 (H1-n)". Owner answers to the review's questions (2026-11-12, all Rec): **OQ-A** `move-item-to-stock` is allowed-only (never approvable, row B-2); **OQ-B** a pending-weight line may be voided, refund 0; **OQ-C** a deal's cooked parts may go to pre-cooked stock while its unstarted parts are just released; **OQ-D** a `moved` void whose line is served meanwhile cannot be approved — withdraw and re-ask, with a clear message. Main changes: `apply` no longer re-checks its own lock (H1-1); one `withStockEffects` and one `lineChangeDrafts` per command (H1-2); working copy + no overlapping entries (H1-3); `COMP_PENDING` on the request path only (H1-4); pending amount split refund / comp-voided (H1-5); non-engine lines (H1-6); line guard on planned touched ids incl. comp approve (H1-7); audit fold reads events only, names at read (H1-8); foundation cursor (H1-9); per-line frozen dispositions (OQ-C, OQ-D). |

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
| V1 | **A void is past stage 1 only.** Past stage 1 = (a) an **engine line** at `cooking`, `done`, `served`, `returned`; (b) any line of an order that left the engine (`out_of_engine`); (c) a **line the engine never held** (no station, e.g. a cold drink) with `served_at` set; (d) an **option child** judged by its parent's stage (its own `served_at` when the parent is not an engine line); (e) a **deal** judged by its parts (at least one part past stage 1); (f) a zone-served line past its undo window. Otherwise `409 ITEM_WRONG_STAGE` (`added`, `zone_undo`) → the client offers 02b's Remove. Unbilled orders only. ⚠️ Changed by v0.2 (H1-6) | D10, F §4.2, owner Q2 |
| V2 | **One ledger.** Money comes from 02b's `planVoid` (uncomped units first, comped unit → `comp_voided_minor`, deal / child cascades with caps, 01c §3.4.8); 04 writes the resulting `ItemVoided` payloads and 02b's projection folds them. 04 keeps no money column. A comped unit's void does **not** change the bill (`comp_minor` → `comp_voided_minor`); only `refund_minor` lowers it. ⚠️ Changed by v0.2 (H1-5) | 02b §3.4, O19, O21; K-6 |
| V3 | **Dispositions** `moved` (to pre-cooked stock; next order takes it), `wastage`, `staff_meal`, `other`. The entry's disposition becomes a **per-line disposition** fixed when the void is asked (§3.3): a touched line still at `added` gets `null` (released, nothing cooked, OQ-C); with `moved`, a touched line that is engine-open at `cooking` / `done` **and** has a stock draw gets `moved`, any other touched line past stage 1 gets `wastage`; at least one line must get `moved`, else the entry is refused. `moved` also needs the caller's `move-item-to-stock` `allowed` (the permission is allowed-only, row B-2, OQ-A) and an open business day. ⚠️ Changed by v0.2 (OQ-A, OQ-C) | owner 2026-11-07, Q3, OQ-A, OQ-C |
| V4 | **`moved` = `ItemMovedToStock` then `ItemVoided`**, both inside one `withStockEffects` array (a partial `ItemVoided` shrinks the draws `moveDrafts` reads). `ItemMovedToStock` only for lines whose per-line disposition is `moved`. `move-item-to-stock` is a right to choose the disposition, never a way past `void-item`'s approval. ⚠️ Changed by v0.2 (H1-28) | K-3, 03a §3.7 |
| V5 | **Every approval-born event carries the request's `alert_id`** (01d `checkAlertIds` unchanged): `ItemMovedToStock`, `ItemVoided`, every `stockEffects` draft and `lineChangeDrafts`' `OrderCancelled` / `OrderFoodCleared`. The schemas gain an optional `alert_id` (rows T-1, Q-1). | K-1 |
| V6 | **`ItemVoided` carries the why**: `reason_code`, `note`, `disposition` (per line, nullable), `requester_staff_id`, `approver_staff_id` (null on a direct void), `alert_id` (null on a direct void) — the 02b `LineComped` pattern. The approver is `AnswerFacts.answerer_staff_id`, never `actor_id`. | K-2, 01d To 04 |
| V7 | **One request per entry** (the named line; its cascade travels with it). A whole-order cancel is one `VoidItems` with several entries → one request each, raised in one transaction. In the approval path **no two entries may touch the same line** (`400`), and no touched line may be in another open void request, so every line is in at most one request. ⚠️ Changed by v0.2 (H1-3) | owner Q5, Q6 |
| V8 | **A line in a pending void is locked**: every line in the request's `values.touched_ids` refuses another void, a comp (raise **and** approve), a remove and a weight (`409 VOID_PENDING`) until the request ends; 02b's guard is asked with the **planned** touched ids of the comp / remove, not just the named line. Served, Done and returns still work (OQ-D: a `moved` line served meanwhile makes the approve fail, §3.4). Symmetric on the **request path only**: a void request whose touched lines meet an open `comp` request's lines (named line plus its cascade) → `409 COMP_PENDING`. A direct void closes stale comp requests as 02b specifies (G1-1b). So `apply` never has a stale comp to close. ⚠️ Changed by v0.2 (H1-4, H1-7) | owner Q7, K-1, G1-1b |
| V9 | **No override.** A pending void ends by approve, reject or withdraw only; the bill stays blocked. Coverage is configuration (`approve-void` grants). | owner Q9 |
| V10 | **Withdraw = never asked.** `onWithdraw` returns `[]`; 01d records `RequestWithdrawn`; the lock lifts. | owner Q10 |
| V11 | **Reject** changes nothing on the bill; `apply` returns `[]`. The requester gets 01d's `request_result`; for dine-in the table's holder also gets one through 01d's `result_also_to` (row D-2), so no foreign `AlertRaised` is returned by `apply` (V5). | owner Q11, K-1 |
| V12 | **Fixed reason codes** `customer_changed_mind`, `wrong_order_taken`, `too_late`, `quality`, `other`. `note` (≤ 200) is required when `reason_code = 'other'`; `disposition_note` (≤ 200) is required when any entry's disposition is `other`. ⚠️ Changed by v0.2 (H1-29) | owner Q4 |
| V13 | **Customer's own wrong order** = a normal void (reason `wrong_order_taken` or `customer_changed_mind`) plus a new normal order. No third return mode. | owner Q12, 03a Q12 |
| V14 | **No table lock** for a void (D39 / 02b O9: only `SubmitOrder` and `RemoveItems` call `requireLock`). Scope `branch` (01b catalogue). | 02b O9 |
| V15 | **Approvable, not queueable** (02b O13 precedent). ⚠️ Changed by v0.2 (H1-32) | 02b O13 |
| V16 | **Audit log = a read model over the immutable event store.** Projection `audit` folds a **curated** action list (§3.6) and reads **only events** (its own tables, never another projection, the `alerts` table or the directory — 02a T19 / 02b §5 rule), so a rebuild from seq 0 equals live. Nothing edits the events (D52), so the log cannot be edited. Names are resolved **at read** from the hub directory (a leaver shows the id). The pure map `toAuditEntry` lives in `@pos/domain` so 06 builds the cloud copy from the same rules. ⚠️ Changed by v0.2 (H1-8, H1-26) | E6 audit AC1, owner Q14, K-8 revised |
| V17 | **Audit view on the hub, LAN only**, staff app, `view-audit-log`; Foundation §6 list cursor; CSV built in the browser from the same JSON query (no non-envelope endpoint, F §6.1). ⚠️ Changed by v0.2 (H1-9) | owner Q13 / K-8 revised, Q15 |
| V18 | **A pending-weight line may be voided; refund 0** (its `refundable_minor` is 0 until weighed, 02b §3.6). After the void, `SetLineWeight` on a line with no live units is refused (row Q-3), so a later weight can never make it billable. ⚠️ Changed by v0.2 (OQ-B, H1-15) | owner OQ-B, README :213 |

---

## §2. Existing architecture that must not change

- **Events** are INSERT-only with triggers (F §4.1, D52); every command goes through 00's registry (`defineCommand`, `approvable`, fixed processing order, `processed_commands`, D32).
- **01d** owns the request record, steps (`APPROVAL_TIER_STEPS`), answer rules (self, range, PIN, `in_person`), receipts and `request_result`; `apply` / `onWithdraw` run read-only in `preRead` and in `handle` (writes throw; a throw refuses the answer) and every returned draft must carry the request's `alert_id` (`alerts/commands/request-row.ts:107`, `answer-request.ts:108`). **Unchanged.**
- **02b** owns `order_lines` money and its fold of `ItemVoided { refund_minor, comp_voided_minor }` (`orders/projection.ts:293`), `planVoid`, `lineChangeDrafts` (reads the order's lines **before** the change, judges only the `changes` it is given — call it once per command), `seatingTotals` (no pending voids in it), comps (`comp:<order_item_id>` dedupe, `COMP_PENDING`).
- **03a** owns the `ItemVoided` / `ItemMovedToStock` / stock schemas, the engine folds (`foldItemEnded`, `partialVoid`: a void of any stage before served ends or shrinks the line; served lines are engine no-ops) and `stockEffects` (array form: bookkeeping is threaded **within one call** only).
- **Hub commands** own `withStockEffects` and `openDayStockCtx` (`commands/set-precooked-stock.ts`). ⚠️ Changed by v0.2 (H1-33)
- **02a** asks `checkMergeGuard` on merge and split (`MERGE_BLOCKED_BY_VOID`), unregistered → never blocked.
- **03b / 03c** drop voided lines from KDS / Pass and print a CANCELLED slip for a printed, not-done line (03c §3.3) — unchanged; 04 adds nothing to them.
- **01b** permissions `void-item` (approvable, scope `branch`), `move-item-to-stock` (`branch`), `approve-void` (`branch`, `my_team`), `view-audit-log` (`branch`) already exist (`packages/domain/src/permissions.ts`).
- **00** projections registry (`register`, optional `reset`; catch-up runs **each projection over the whole range in turn**), hub clock, directory in memory, Foundation §6 list cursor (`?cursor&limit`, default 50, max 200, `meta.next_cursor`).

---

## §3. Domain rules

### 3.1 Words

**Entry** = one `{ order_item_id, units?, disposition }` in `VoidItems`. **Named line** = the entry's line. **Touched lines** = the named line plus the cascade `planVoid` adds (option children of an `item`, parts of a `deal`), each with its own units. **Per-line disposition** = V3. **Void request** = an open `void_approval` alert. **Locked line** = a line in some open void request's `values.touched_ids`. **Comp lines** of an open comp request = its named line plus that line's option children / deal parts (the lines `planComp` can cascade into). ⚠️ Changed by v0.2 (H1-7, OQ-C)

### 3.2 Eligibility of an entry

Checked in payload order against a **working copy** of the order's lines (each earlier entry's plan applied to it, as 02b `RemoveItems`). ⚠️ Changed by v0.2 (H1-3)

1. The line belongs to the order → else `400 VALIDATION_FAILED { issues: [{ path: 'lines.N.order_item_id' }] }`.
2. Not a return line (`return_of` set; money 0) → else `409 VOID_NOT_ALLOWED { order_item_id, reason: 'return_line' }`.
3. *(removed in v0.2: a pending-weight line is voidable, V18)* ⚠️ Changed by v0.2 (OQ-B)
4. **Past stage 1** (V1) → else `409 ITEM_WRONG_STAGE { order_item_id, stage: 'added' | 'zone_undo' }`.
5. `units` (absent = all live units) `1 ≤ units ≤ live_units` (working copy) → else `400 { path: 'lines.N.units' }`. g/ml `item` / `option_child` lines whole only; a g/ml `deal_part` and a deal with a g/ml part go by deal portions, and a partial void of such a deal or part while that part is still open in the engine is refused exactly as 02b: `400 VALIDATION_FAILED { issues: [{ path: 'lines.N.units', message: 'gml_deal_part_partial' }] }` (a served g/ml part is not "open", so its partial is allowed). ⚠️ Changed by v0.2 (H1-14)
6. **Approval path only** (grant `requires_approval`): (a) no touched line is a touched line of an **earlier entry of this command** → else `400 { path: 'lines.N.order_item_id', message: 'overlaps_entry' }`; (b) no touched line is locked → else `409 VOID_PENDING { alert_id, order_item_id }`; (c) no touched line is a comp line of an open `comp` request → else `409 COMP_PENDING { alert_id }`. **Direct path:** (b) only — a direct void on a locked line is still `409 VOID_PENDING`; open comp requests are closed by `lineChangeDrafts` (G1-1b). ⚠️ Changed by v0.2 (H1-3, H1-4, H1-7)
7. **Disposition** (V3): `moved` → the per-line dispositions give at least one `moved` line → else `409 VOID_NOT_ALLOWED { order_item_id, reason: 'not_movable_stage' }` (no touched line at `cooking` / `done`) or `'stock_not_tracked'` (none with a draw); the open business day → else `'day_closed'`; the caller's `resolve('move-item-to-stock').grant === 'allowed'` → else `403 PERMISSION_DENIED { reason: 'move_not_granted' }`. `other` without `disposition_note` → `400`.

Repeated `order_item_id` → `400` (C6). On the direct path an entry whose line is already touched by an earlier entry's cascade is judged on what is left (working copy).

### 3.3 Effect drafts (`voidDrafts`, shared by the direct path and `apply`)

⚠️ Changed by v0.2 (H1-2, H1-3, H1-28, OQ-C) — one stock pass and one line-change pass per command.

1. For each entry in payload order, on the working copy: `plan = planVoid(named, children, units)` (02b) → one `ItemVoided` payload per touched line with `refund_minor`, `comp_voided_minor`; apply the plan to the working copy; give each touched line its per-line disposition (V3; in `apply` the dispositions stored in `values.line_dispositions` are used, never recomputed).
2. Collect the cause drafts in payload order: per entry, first one `ItemMovedToStock { order_item_id, units }` for each touched line whose disposition is `moved`, then the entry's `ItemVoided` drafts with `{ disposition: <per line>, reason_code, note, disposition_note, requester_staff_id, approver_staff_id, alert_id }`.
3. **One** `withStockEffects(ctx, allCauseDrafts, anyMoved ? openDayStockCtx(state) : undefined)` over the whole list (each cause followed by its releases / adds / waiting-line reserves; one bookkeeping pass, so two `moved` entries on one stock item never reserve the same waiting line twice).
4. **One** `lineChangeDrafts(ctx, order_id, allChanges)` (`allChanges` = every touched line of every entry with its total units out) → at most one `OrderCancelled` or one `OrderFoodCleared`; a direct void keeps any stale-comp `AlertClosed`; in `apply` none can exist (V8) and one present → throw (bug; test 30).
5. **Approval path only:** set `payload.alert_id = request.alert_id` on **every** draft (V5).

Zone counts never change (02b To 04). Stock: a `wastage` / `staff_meal` / `other` line past Start draws nothing back (the reservation was consumed at Start or Done, 03a P-5); a touched line still reserved (`added`, or a reserve not yet consumed) releases its share (`StockReleased { reason: 'voided' }`). A partial move of a `cooking` / `done` line must produce **no** `StockReleased` (spike 0 asserts `reserved = 0` there; else a 03a row, H1-25).

### 3.4 Request lifecycle (01d states)

```
VoidItems (grant requires_approval)
     │  per entry: alerts.raiseMany → AlertRaised(kind void_approval, dedupe 'void:<order_item_id>')
     ▼
 PENDING (01d open) ── touched lines locked (V8); pendingVoids lists it; merge / split blocked; 05 refuses bill close
     │
     ├─ approve (approve-void in range, PIN) ─► apply: re-read, §3.2 rules 1, 2, 4, 5, 7, voidDrafts + alert_id ─► APPROVED
     ├─ reject ─────────────────────────────► apply: [] ; request_result to requester (+ holder, D-2) ─► REJECTED
     └─ withdraw (requester) ───────────────► onWithdraw: [] ─► WITHDRAWN
   (no override, V9; at day close 05 lists open void requests and decides, 01d To 05)
```

⚠️ Changed by v0.2 (H1-1): `apply` does **not** re-run rule 6. Its own request is the lock on these lines; no other void request can hold them (V7 at raise) and no comp can touch them (02b line guard on raise and approve, Q-3), so rule 6 has nothing to find. Rule 7's grant check is not repeated (the requester's `move-item-to-stock` was checked at raise); its stage check runs on the frozen per-line dispositions: a line stored as `moved` that is no longer at `cooking` / `done` (served meanwhile, OQ-D) → `409 VOID_NOT_ALLOWED { reason: 'not_movable_stage', hint: 'withdraw_and_reask' }`. A failure of any re-check (billed meanwhile, units gone, day closed) throws its code; 01d refuses the answer before any PIN in `preRead` (rule 4 (b)); the request stays pending, and the requester withdraws and asks again (approver card and `request_result` texts say so, §8).

### 3.5 Kind `void_approval` (registered at the top level of `apps/hub/src/voids/`, imported before boot replays `alerts`)

`family: 'urgent'`, `silent: false`, `subject: 'order'`, `steps: APPROVAL_TIER_STEPS`, `closes_on: 'owner'`, `lead_fallback: false`, `expires_at_day_close: true` (no effect on requests; 02b `comp` precedent), `labels: { card: 'alert.void_approval.card', lock: 'alert.void_approval.lock', name: 'alert.void_approval.name' }` (01d To 04 keys), `request: { answers: ['approve','reject'], right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' }, needs_pin: 'always', apply, onWithdraw, result_also_to }`. ⚠️ Changed by v0.2 (H1-19)

- `values_schema`: `{ order_id, order_item_id, units, reason_code, note: string | null, disposition, disposition_note: string | null, touched_ids: string[] (1–40), line_dispositions: Record<order_item_id, VoidDisposition | null> }`. ⚠️ Changed by v0.2 (OQ-C, H1-29)
- `details_schema` (`AlertDetailsBase.pick`): `item` (name of the named line; a deal shows the deal name), `quantity` (units), `amount` (Σ `refund_minor` of the plan — what leaves the bill; minor units), `reason` (`reason_code[: note]`, ≤ 200), `lines` (`[{ name, quantity, state }]`, `state` = stage only: `not_started` / `cooking` / `cooked` / `served`; ≤ 10), `disposition` (label key of the entry's disposition, plus "partly to stock" when per-line dispositions differ) — the approver card of owner Q16. `display`: `{ kind_label_key: 'alert.void_approval.lock', table_code, requester_name }` (lock screen shows no money, 01d §3.12). ⚠️ Changed by v0.2 (H1-5, H1-19)
- `result_also_to(alert)` (row D-2): dine-in → `{ kind: 'table_team', table_id: currentTableOf(order), depth: 'owner' }` unless the holder is the requester; else `null`. 01d calls it only on a **reject**.

### 3.6 Audit log (projection `audit`, map `toAuditEntry`)

⚠️ Changed by v0.2 (H1-8, H1-26, H1-30, H1-31): events only.

`toAuditEntry(event, lookups) → AuditEntry | null` (pure, `@pos/domain/src/audit.ts`). `lookups` holds only what the projection itself folded from earlier events: `requestOf(alert_id) → { kind, requester_staff_id, order_id, table_code } | null` (table `audit_requests`, from `AlertRaised` with `request ≠ null`; `table_code` from its `display`) and `tableOf(order_id) → table_id | null` (table `audit_orders`, from `OrderPlaced.table_id`: the table the order was placed at). Names are **not** stored: `actor_staff_id` / `approver_staff_id` are; the query joins the hub `staff` table at read (a leaver no longer in the directory shows the id). So a rebuild from seq 0 equals live, row for row (test 55).

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
| `stock_set`, `stock_added`, `zone_stock_set` | `StockSet`, `StockAdded` (no `reason`; `moved` is covered by `item_moved_to_stock`), `ZoneStockSet` | stock item / zone, quantity |

Not mapped (owner Q14): sessions, presence, alert deliveries / seens, engine and tick events, `ItemStarted` / `ItemDone` / `ItemServed`, config applies, `OrderContactSet` (privacy, 02b O17), owner config changes (cloud). Later modules add actions with `registerAuditAction` (§4.2): 03c `TicketReprinted` when that event exists, 05 clock-in and bill override. A **new mapping of an event type that already has history** ships with a projection reset (full rebuild at the next boot), else old events stay unmapped.

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | `defineCommand` (`approvable`), registry, projections registry, `ctx.state`, `ctx.directory`, `ctx.clock`, query routes, list cursor | §6 |
| Hub commands (00) | `withStockEffects`, `openDayStockCtx` (`commands/set-precooked-stock.ts`) | §3.3 |
| 01b | `resolve` (caller's `move-item-to-stock`), permissions above, allowed-only rule (row B-2) | §3.2, §6 |
| 01d | `defineAlertKind`, `APPROVAL_TIER_STEPS`, `alerts.raiseMany`, `alerts.listOpen`, `AnswerFacts`, `AlertDetailsBase`, read-only `apply` contract; `result_also_to` (row D-2) | §3.4, §3.5 |
| 02a | `registerMergeGuard`, `currentTableOf`, `seating_orders` (read-only join in queries, never in a fold) | §3.5, §6.6 |
| 02b | `planVoid`, `readOrder` (row Q-2), `lineChangeDrafts`, `COMP_KIND`, `registerLineGuard` (row Q-3), error codes | §3.2, §3.3 |
| 03a | `ItemVoided`, `ItemMovedToStock` (+ fields, row T-1), `stockEffects` (through `withStockEffects`), `isOrderInEngine`, engine line stage and draws | §3.2, §3.3 |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `pendingVoids(db, order_ids[])` | `Map<order_id, Array<{ alert_id, order_item_id, units, touched_ids, refund_minor, comp_voided_minor, requester_staff_id, raised_at }>>` (open `void_approval` alerts; amounts from the request's plan) | 1 (`alerts_open_kind`) | 05 bill (PENDING VOID; subtract **`refund_minor` only**; refuse close while any), 02a guard, client |
| `VOID_KIND` | `'void_approval'` | — | 05 day close (`alerts.listOpen({ kind })`) |
| `toAuditEntry`, `AuditEntry`, `AUDIT_ACTIONS` | pure, browser-safe (`@pos/domain/src/audit.ts`) | 0 | 06 cloud audit, clients |
| `registerAuditAction(event_type, map)` | adds a mapped action (startup only; a duplicate event type → startup error) | 0 | 03c, 05, later modules |
| Events written, kind, queries, projection | §6 | — | all |

⚠️ Changed by v0.2 (H1-5, H1-34): `amount_minor` split into `refund_minor` / `comp_voided_minor`; `hasPendingVoid` dropped (05 uses `pendingVoids(...).size > 0`).

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 05 | Bill: lines in `pendingVoids` show **PENDING VOID** and the total excludes their **`refund_minor`** (a comped unit's `comp_voided_minor` does not change the bill; `seatingTotals` does not exclude them itself); **refuse bill close while `pendingVoids` is non-empty** for the bill's orders (D11 AC3); at day close list open `void_approval` requests and decide each (01d To 05); refund after close is `apply-refund`, never a void; Z report reads `ItemVoided.disposition` (wastage / staff meal / moved / null) and `comp_voided_minor` as a voided comp (02b O21). ⚠️ Changed by v0.2 (H1-5) |
| 06 | **Cloud / remote audit view** (owner K-8 revised): from synced events, build the cloud audit read model with the same `toAuditEntry` / `AUDIT_ACTIONS` (`@pos/domain`) and the same events-only lookups, owner page under `/v1/admin/` (C2 branch guard, C7 route case); names from the cloud directory at read. Whether 06's sync joins milestone A is 06's G0. |
| 07 | Voids, approvers and methods from the audit read model / events; wastage from `ItemVoided.disposition`. |
| 08 | Depletion reversal on void reads `ItemVoided` (with `disposition`); `moved` returned to stock already through `StockAdded { reason: 'moved' }`. |

### 4.4 Shared types (`@pos/domain/src/voids.ts`, browser-safe)

```typescript
export const VOID_REASON_CODES = ['customer_changed_mind', 'wrong_order_taken', 'too_late', 'quality', 'other'] as const;
export type VoidReasonCode = (typeof VOID_REASON_CODES)[number];
export const VOID_DISPOSITIONS = ['moved', 'wastage', 'staff_meal', 'other'] as const;
export type VoidDisposition = (typeof VOID_DISPOSITIONS)[number];
export type VoidBlock = 'return_line' | 'not_movable_stage' | 'stock_not_tracked' | 'day_closed' | 'move_not_granted';
```

### 4.5 Changes to other specs (R26) — *Proposed — needs approval*; each target bumps with changelog and "Changed by 04" markers (R34)

**Version numbers (owner K-4):** 04 does **not** change any number 03b v1.0.1 / 03c v1.0.1 claim for their task 0d (Foundation v1.12, 00 v1.9, 01a v2.4, 01b v1.8, 01d v1.2.2, 02b "v1.0.4", 03a v1.2.1). **Note for 03b's task 0d:** 02b v1.0.4 and v1.0.5 are already APPROVED on main (2026-11-10 / 11), so 03c's Q-1 cannot land as v1.0.4; 04 leaves **02b v1.0.6** free for it. 04 takes the next number after every claim:

| Row | Target → version | Change | Why |
|---|---|---|---|
| F-1 | Foundation → **v1.13** §4.2 | Note: a void past stage 1 has a per-line **disposition** (`moved` / `wastage` / `staff_meal` / `other`; `null` for a part never started); `moved` = `ItemMovedToStock` then `ItemVoided` in one transaction (04 V4); `move-item-to-stock` is the allowed-only right to choose `moved`, not a separate refund path. Diagram labels unchanged. | V3, V4 |
| F-2 | Foundation → **v1.13** §4.5 | OVERRIDDEN **not built** (owner Q9, 04 §12.4); a pending void ends by approve / reject / withdraw; the states table keeps the row marked "deferred". REJECTED: "the table's order taker is notified" via 01d `result_also_to` (D-2). PENDING is not in 02b `seatingTotals`; 05 subtracts `pendingVoids.refund_minor`. | V9, V11, H1-5 |
| F-3 | Foundation → **v1.13** §3.1 audit row | Hub: projection `audit`, an events-only read model of a curated action list (04 §3.6); cloud replica built by 06 from synced events with the same map. | V16, K-8 |
| F-4 | Foundation §6.2 (append, no bump) | `VOID_NOT_ALLOWED` (new). `VOID_PENDING` already exists (D11); 04 defines its details `{ alert_id, order_item_id }`. ⚠️ Changed by v0.2 (H1-13) | §9 |
| H-0 | 00 | **No change.** | — |
| B-1 | 01b → **v1.9** default roles | Cashier and Order taker: `void-item` **requires approval by Manager**, `move-item-to-stock` **allowed** (`branch`); Owner / Manager unchanged. Code: `apps/cloud/src/modules/staff-roles/default-roles.ts` (new tenants through `cli/seed-tenant.ts`) **plus** a cloud backfill migration `NNNN_void_defaults_backfill.sql` in the 0003 `manage_stock_backfill` pattern for existing tenants (roles found by `default_key`, `ON CONFLICT DO NOTHING`, approver = the tenant's `manager` role, bumps `directory_version` so hubs pull it). Pilot tenants are pre-live, so the backfill overrides no owner choice. ⚠️ Changed by v0.2 (H1-21) | owner Q1 / K-7; V3 |
| B-2 | 01b → **v1.9** catalogue + code (`packages/domain/src/permissions.ts`, cloud `checkGrants`) | `ALLOWED_ONLY_PERMISSIONS = ['move-item-to-stock']`: a grant of it with `requires_approval` → `400 CONFIG_REFERENCE_INVALID { field: 'grants.N.grant_type' }` in the roles API and editor (the option is not shown); the hub's `resolve` treats a stray `requires_approval` on it as not granted. ⚠️ Changed by v0.2 (OQ-A, H1-10) | owner OQ-A |
| D-1 | 01d → **v1.2.3** §4.3 To 04 (text) | Values `{ order_id, line_id }` → §3.5's `values_schema`; OVERRIDDEN not used (04 V9); the rejected-void notice goes through D-2, not a 04 kind. | K-5, V9, V11 |
| D-2 | 01d → **v1.2.3** §3.5 `defineAlertKind`, §3.3 rule 7 + code (`alerts/kinds.ts`, `commands/answer-request.ts`) | Optional `request.result_also_to(alert) → AlertTarget \| null`, called read-only in `prepare` **on a reject only**; 01d raises one more `request_result` to that target (dedupe `request_result:<alert_id>:also`) in the same `raiseMany` as its other answer raises, **outside** `checkAlertIds`. Target resolving only to the requester → not raised. **Statement bound on a reject: +1** (`currentTableOf` + holder in one read by the kind) **+1** `table_team` resolver in `raiseMany` when no other raise of that answer uses it; approve and withdraw +0. 01d's tests assert the new bound. ⚠️ Changed by v0.2 (H1-12) | V11 with K-1 strict |
| Q-1 | 02b → **v1.0.7** §6.19 + code (`OrderCancelled.v1.ts`, `OrderFoodCleared.v1.ts`) | Optional `alert_id: string` (both are `.strict()` today); folds ignore it; fixtures with and without parse. | V5 |
| Q-2 | 02b → **v1.0.7** §4.2 Exposes + code | `planVoid(parent, children, n)` (`orders/ledger.ts:194`) listed as built; **export** `readOrder(ctx, order_id)` (`orders/commands/remove-items.ts:74`, today module-private) to `orders/exports.ts` with its row type. ⚠️ Changed by v0.2 (H1-20) | K-6 |
| Q-3 | 02b → **v1.0.7** §3.4, §3.6, §3.9, §6.2, §6.3, §6.8, §6.12 + code | **Line guard:** `registerLineGuard((db, order_id, touched_ids) → { alert_id, order_item_id } \| null)` (`orders/line-guard.ts`, merge-guard pattern; unregistered → never blocked). `CompLine` (raise **and** `applyComp`), `RemoveItems` and `SetLineWeight` ask it with the **planned touched ids** (after `planComp` / `planRemove`; the line itself for a weight) after their own `404` / `409` checks and before scope (C8) → `409 VOID_PENDING { alert_id, order_item_id }`. 1 statement when registered. **`SetLineWeight` on a line with `live_units = 0`** → `409 ITEM_WRONG_STAGE { stage: 'voided' }` (V18). ⚠️ Changed by v0.2 (H1-7, OQ-B) | V8, V18 |
| Q-4 | 02b → **v1.0.7** §4.3 To 04 (text) | "a void calls `lineChangeDrafts` once per command; in an approval every returned draft carries the request's `alert_id`"; dispositions per 04 V3. | V5, H1-2 |
| T-1 | 03a → **v1.2.2** §4.2 + code (`ItemVoided.v1.ts`, `ItemMovedToStock.v1.ts`, `StockReleased.v1.ts`, `StockAdded.v2.ts`, `StockReserved.v1.ts`) | Additive optional fields, no payload version bump (R29): `ItemVoided` + `alert_id`, `requester_staff_id`, `approver_staff_id`, `reason_code`, `note`, `disposition_note`, `disposition` (enum §4.4, nullable); `ItemMovedToStock`, `StockReleased`, `StockAdded` v2, `StockReserved` + `alert_id`. These schemas are non-strict, so the fields **must be declared** or they are stripped. `stockEffects` never sets `alert_id` (the writer stamps it); folds ignore the new fields; fixture tests. | V5, V6 |
| T-2 | 03a → **v1.2.2** §3.7 move to stock, §4.3 To 04 (text) | `ItemMovedToStock` is written **before** the `ItemVoided` of the same units, in one `stockEffects` array; a partial move of a `cooking` / `done` line releases nothing (`reserved = 0`, pinned by 04 spike 0). | V4, H1-25 |
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

⚠️ Changed by v0.2 (H1-8, H1-23): no names in rows; two lookup tables the projection folds itself; indexes ordered `recorded_at DESC, seq DESC`.

```sql
-- 04 §3.6: read model of the curated audit actions; folded from events only; projection reset deletes all three tables.
CREATE TABLE audit_entries (
  seq               INTEGER PRIMARY KEY,          -- the event's seq (one row per mapped event)
  event_id          TEXT    NOT NULL UNIQUE,
  recorded_at       INTEGER NOT NULL,             -- event occurred_at, hub clock (E6 AC3)
  action            TEXT    NOT NULL,             -- AUDIT_ACTIONS
  actor_staff_id    TEXT,                         -- envelope actor_id (null for system / station events)
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
  table_code         TEXT
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
  3. `alerts.listOpen(db, { subject: order })` (1 statement) → open `void_approval` and `comp` requests of the order (rule 6).
  4. Resolve the grant (in memory). Each entry in payload order: §3.2 rules 1–7 against the working copy; `planVoid`; apply to the working copy; per-line dispositions.
  5. Scope `branch` (C8).
  6. Grant `allowed` → `voidDrafts` (§3.3, `alert_id: null`, `requester_staff_id` = caller, `approver_staff_id: null`) with one `withStockEffects` and one `lineChangeDrafts` (2 statements). Result `{ voided: [{ order_item_id, units, refund_minor, comp_voided_minor, disposition }], cancelled }`.
  7. Grant `requires_approval` → one raise input per entry (`kind: 'void_approval'`, `subject: order`, `target: { kind: 'answerers' }`, `dedupe_key: 'void:' + order_item_id`, `values`, `details`, `display`, `requester_staff_id: caller`, `request: { approver_role_ids }`) → **one** `alerts.raiseMany` (01d's statements). A deduped entry → `409 VOID_PENDING { alert_id, order_item_id }` (the whole command rolls back). Result `{ pending: [{ order_item_id, alert_id }] }`.
- **Idempotency:** `command_id` (D32); a retransmit returns the stored result.
- **Statements:** 2 + (direct: 2) or (request: 01d's `raiseMany` bound); engine state, directory, config in memory.
- **Audit:** `item_voided` / `item_moved_to_stock` / `void_requested` rows by fold.

### 6.2 Kind `void_approval` — `apply`, `onWithdraw` (§3.4, §3.5)

- `apply(ctx, answer)`: `reject` → `[]`. `approve` → `readOrder` (1 statement); §3.2 rules 1, 2, 4, 5 and the stage part of 7 on the current state with the request's values and frozen `line_dispositions` (not rule 6, §3.4); `voidDrafts` with `requester_staff_id = alert.requester_staff_id`, `approver_staff_id = answer.answerer_staff_id`, `alert_id` stamped on every draft; `lineChangeDrafts` output without `AlertClosed` (else throw). Read-only. ⚠️ Changed by v0.2 (H1-1)
- `onWithdraw` → `[]`.
- `result_also_to` (D-2) → table holder for a dine-in reject.
- **Statements in `apply`:** 1 read + 2 (`lineChangeDrafts`), inside 01d's answer bound; the plan of a single request equals its raise-time plan (no other request or comp could touch its lines), so `details.amount` = the applied refund (test 47).

### 6.3 `GET /queries/void-preview?order_id&order_item_id&units?`

`void-item` (any grant). Runs §3.2 without writing for one entry; `200 { data: { refund_minor, comp_voided_minor, touched: [{ order_item_id, name, units, stage, refund_minor, comp_voided_minor }], stage, dispositions: [{ disposition, enabled, block: VoidBlock | null, line_dispositions }], needs_approval, pending: { alert_id } | null, comp_pending: { alert_id } | null } }`. Errors as §3.2 rules 1, 2, 4, 5 (6–7 are reported in `pending` / `comp_pending` / `dispositions`, not as errors). 2 statements.

### 6.4 `GET /queries/pending-voids?order_ids=…` (1–40) or `?seating_id=`

`take-order` or `void-item` or `approve-void`. `200 { data: { orders: [{ order_id, voids: [{ alert_id, order_item_id, units, touched_ids, refund_minor, comp_voided_minor, requester_staff_id, raised_at }] }] } }` — `pendingVoids` (1 statement; `seating_id` resolves through `seating_orders` in the same statement).

### 6.5 `GET /queries/audit-log?from&to&staff_id?&action?&cursor?&limit?`

⚠️ Changed by v0.2 (H1-9, H1-23)

`view-audit-log` (scope `branch`). `from` / `to` Unix ms, `from < to`, `to − from ≤ 31 days`, else `400`; `action` comma list ⊆ `AUDIT_ACTIONS`; `staff_id` matches actor **or** approver; Foundation §6 cursor: `cursor` opaque (encodes the last `(recorded_at, seq)`), `limit` 1–200, default 50. Order `recorded_at DESC, seq DESC` (the index order, no temp sort).
`200 { data: { entries: [AuditEntryView] }, meta: { next_cursor: string | null } }`, `AuditEntryView` = the row plus `actor_name`, `approver_name` (hub `staff` table, LEFT JOIN at read; null for a leaver) and `table_name` (from the branch config in memory). **1 statement** (`UNION ALL` of the actor and approver scans when `staff_id` is given). CSV: the client pages through and builds the file (V17).

### 6.6 Registrations at startup (`apps/hub/src/voids/index.ts`, `apps/hub/src/audit/index.ts`)

- `registerMergeGuard((db, { seating_ids, order_ids? }) → { blocked, order_item_ids })`: open `void_approval` alerts whose subject order is in those seatings (via `seating_orders`) or `order_ids` → blocked with their `touched_ids` (1 statement).
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
         · StockReserved{waiting T4 karahi, A9} · ItemVoided{K1,1,refund 240000,moved,…,approver Imran, A9}
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
- **Cancel order** ("Void all"): one flow that sends `RemoveItems` for the stage-1 lines (02b, needs `take-order` and the table lock) and one `VoidItems` for every live line past stage 1 (one request each, V7); the sheet lists both groups. ⚠️ Changed by v0.2 (H1-18)
- **Pending tag:** lines in `pending-voids` show **PENDING VOID** and the screen's running total excludes their `refund_minor`. Refresh: after the screen's own `VoidItems` / `WithdrawRequest`, on 00 `event` frames of the open order's stream (`ItemVoided`, `OrderCancelled`), on 01d `alert` / `alert_closed` frames the device receives, and on screen focus. A third device that receives no frame may show a stale tag until focus; correctness does not depend on it (05 refuses bill close server-side, 02a refuses merge). ⚠️ Changed by v0.2 (H1-24)
- **Errors:** `VOID_PENDING` → "A void is already waiting on this item"; `COMP_PENDING` → "A comp is waiting on this item — decide it first"; `ITEM_WRONG_STAGE { stage: 'added' }` → "Not started — use Remove"; `ORDER_BILLED` → "Bill closed — refunds are at the counter"; `VOID_NOT_ALLOWED { reason: 'not_movable_stage', hint: 'withdraw_and_reask' }` on an approve → "Served meanwhile — ask the requester to withdraw and ask again as wastage" (approver), and the requester's pending row shows "Can't be approved as stock any more — withdraw and ask again" (OQ-D). ⚠️ Changed by v0.2 (H1-17)
- **Approver card** (01d screens): §3.5 `details` (owner Q16): stage per line and disposition shown separately.
- **Audit log screen** (`features/audit/`, `view-audit-log`): date range (default today), staff picker, action multi-select; newest first, infinite scroll by `meta.next_cursor`; row: time, who (name or id), action, target (table / item), reason, outcome, amount, approver + method ("in person", "on requester's device"); **Export CSV** pages through the same query (≤ 31 days) and saves in the browser.
- i18n keys only (D12), Latin digits (R20).

---

## §9. Error catalogue additions (Foundation §6.2, `@pos/domain/src/errors.ts`)

⚠️ Changed by v0.2 (H1-13)

| Code | Status | `details` | When |
|---|---|---|---|
| `VOID_NOT_ALLOWED` (**new**) | 409 | `{ order_item_id, reason: 'return_line' \| 'not_movable_stage' \| 'stock_not_tracked' \| 'day_closed', hint?: 'withdraw_and_reask' }` | §3.2 rules 2, 7; §3.4 approve re-check |
| `VOID_PENDING` (exists, D11; details defined here) | 409 | `{ alert_id, order_item_id }` | a touched line is in an open void request (void, comp raise / approve, remove, weight — the last three through 02b's line guard) |

Reused: `400 VALIDATION_FAILED` (`issues[].path` / `message`: `gml_deal_part_partial`, `overlaps_entry`, units, notes), `403 PERMISSION_DENIED` (`outside_scope`; new reason value **`move_not_granted`**), `404 ORDER_NOT_FOUND`, `409 ORDER_BILLED`, `409 ITEM_WRONG_STAGE` (stage values `added`, `zone_undo`; 02b adds `voided`, Q-3), `409 COMP_PENDING`; 01d's answer codes unchanged.

---

## §10. Tests (`apps/hub/test/voids/*.test.ts`, `apps/hub/test/audit/*.test.ts`, `packages/domain/src/audit.test.ts`; client tests in `apps/client`)

⚠️ Changed by v0.2 (H1-11 and the findings each test names).

**Spike (plan task 1, G1-8):** **0.** raise → approve → `ItemMovedToStock` + `StockAdded` (2 of 4 naan, `cooking`) → `ItemVoided` folded by 02b's ledger → engine line shrunk → **no `StockReleased`** for the moved share (H1-25) → every draft carries `alert_id` → audit rows; proves `stock_ctx` and engine state inside a read-only `apply`, that 01d's answer path folds engine events, and the lock check does not refuse its own request (H1-1).

**VoidItems, direct (`allowed`):** 1 happy path cooking line, wastage → refund, engine line ended. 2 served engine line → money only, engine no-op. 3 order out of engine (abandoned) → money only. 4 engine stage `added` → `ITEM_WRONG_STAGE { added }`. 4b **non-engine line** (drink, no station): served → voidable, money only, `moved` disabled; unserved → `ITEM_WRONG_STAGE { added }` (H1-6). 4c option child alone: judged by its parent's stage. 5 return line → `VOID_NOT_ALLOWED return_line`. 6 **pending-weight line** → voided, refund 0; a later `SetLineWeight` → `ITEM_WRONG_STAGE { voided }` (OQ-B, Q-3). 7 billed → `ORDER_BILLED`. 8 unknown order → 404; foreign line → 400 path. 9 repeated id → 400 (C6). 10 **moved partial** 2 of 4 naan: `ItemMovedToStock` before `ItemVoided`, `StockAdded` = 2 portions, waiting line reserved, engine units 2 (T-2). 10b **two `moved` entries** on lines of the same stock item with one waiting line → exactly **one** `StockReserved` (H1-2). 11 moved on a line with no draw → `stock_not_tracked`; on served → `not_movable_stage`; caller without `move-item-to-stock` → `403 move_not_granted`; day closed → `day_closed`. 11b **deal partly cooked** with `moved` → cooked part `moved`, unstarted part `null` + `StockReleased { voided }` (OQ-C). 12 a still-reserved line voided → `StockReleased { voided }` share. 13 zone line in undo window → `ITEM_WRONG_STAGE zone_undo`; after → money only, zone count unchanged. 14 **"Void all" of 3 lines** past stage 1 (last live lines) → exactly **one** `OrderCancelled`, no `OrderFoodCleared` (H1-2); food cleared case → exactly one `OrderFoodCleared`. 14b overlapping entries on the direct path `[deal D ×1, its part P ×1]` → working copy: P's share index taken once, refunds sum ≤ billed (H1-3). 15 `reason_code: other` without `note` → 400; `disposition: other` without `disposition_note` → 400. 16 retransmit → stored response, no second event (D32). 17 COMMIT failure → nothing written, engine state unchanged (D45). 18 scope `branch` last (C8): a 404 / 409 wins over scope. 19 **direct void on a line with an open comp request** → voided, the comp request closed `obsolete` (G1-1b, H1-4). 19b direct void on a locked line → `VOID_PENDING`.

**Approval:** 20 `requires_approval` → one `AlertRaised` per entry, values / details / display as §3.5 (incl. `labels`, `silent: false`), no `ItemVoided`. 21 **approve with the lock check live** → applied: drafts with `alert_id` on **every** draft (`checkAlertIds` passes), approver = answerer, requester = raiser (H1-1). 22 approve `in_person` → approver = named answerer, `actor_id` = requester device's session (01d). 23 reject → `[]`, line still billed, `request_result` to requester and **to the table holder** (D-2); takeaway → requester only; holder = requester → one result. 24 withdraw → `[]`, lock lifted, a new request allowed. 25 approve after the order was billed (fixture) → refused in `preRead` before PIN (spy: argon2 not called). 26 apply re-check fails (day closed) → refused, request stays pending. 26b **`moved` line served meanwhile** → approve refused `VOID_NOT_ALLOWED { not_movable_stage, hint: withdraw_and_reask }`; withdraw + re-ask as wastage → approved (OQ-D, H1-17). 27 locks: second void on a locked line (named or cascaded child) → `VOID_PENDING`; comp on it → `VOID_PENDING`; **comp on the deal whose part is locked** (cascade) → `VOID_PENDING`; **`applyComp` asks the guard too**: a fixture with an open comp request whose planned lines meet a void lock (a state 28 prevents in normal use) → the comp approve is refused `VOID_PENDING` (defence in depth, H1-7); remove of a locked deal's stage-1 part → `VOID_PENDING`; weight → `VOID_PENDING`. 28 void request on a line with an open comp → `COMP_PENDING`; **void request on a deal part while a comp request is open on the deal** → `COMP_PENDING` (H1-7). 29 three entries → three requests in one transaction; one deduped → whole command rolls back. 29b **overlapping entries on the approval path** → `400 overlaps_entry` (H1-3). 30 `apply` with a stray `AlertClosed` from `lineChangeDrafts` → throws (assert). 31 01d answer bound: approve / withdraw unchanged, reject = old bound + D-2's (H1-12).

**Permission matrix (G1-7, K-7, OQ-A):** 32 `void-item` not granted → 403; `allowed` → direct; `requires_approval` → request with the grant's approver roles; per-person **denied** → 403 over a role grant; two roles allowed + requires_approval → allowed (D19); approver `approve-void` `branch` → covers all; `my_team` → requester below in the tree only, else `out_of_range`; self → `self`; approver role removed after raise → `not_approver`; approver without `approve-void` → `not_approver`; **`move-item-to-stock` with `requires_approval` → refused by the roles API (B-2)**, and a stray one on the hub → `move_not_granted`; defaults after `seed-tenant` and after the backfill migration (B-1): Cashier / Order taker `void-item` requires_approval by Manager, `move-item-to-stock` allowed; backfill idempotent and bumps `directory_version` once.

**Guards and exports:** 33 merge with a pending void → `MERGE_BLOCKED_BY_VOID { order_item_ids }`; 34 split moving that order → blocked; after approve / reject / withdraw → allowed. 35 `pendingVoids` 1 statement for 40 orders; `refund_minor` / `comp_voided_minor` = the plan; 36 **bill with a pending void of a comped unit**: total minus `refund_minor` only equals the bill after approve (H1-5).

**Money (K-6, raised bar):** 40 deal ×1 (320 000): void 1 of 4 naan parts → part share, deal billed = total − part refund; then void the deal → refund = total − parts already refunded (01c :311). 41 g/ml part partial while open → 400 (02b shape); served g/ml part → allowed; g/ml item → whole only. 42 option child with `option_quantity` set → k × q child units; `null` child voided only with the last parent unit or alone. 43 comped units: void 3 of 4 with 2 comped → 2 uncomped to `refund_minor`, 1 to `comp_voided_minor`. 44 remainder share goes to the last unit. 45 a remade line voided → refunded share (O20). 46 **property test:** 500 random sequences of comp / remove / void / weight over random items, children and deals keep `money_out ≤ refundable` per line, the deal-billed rule, and **Σ billed before − after = Σ (comp `value_minor` + `removed_minor` + `refund_minor`)** over the sequence (a void of a comped unit only re-labels `comp_minor` → `comp_voided_minor`), never negative (H1-5). 47 **approve amount = raise amount** (`details.amount` = Σ applied `refund_minor`) (H1-27). 48 `orders` + `audit` projections rebuilt from seq 0 = live. 49 events with and without the new optional fields parse (T-1, Q-1 fixtures).

**Audit:** 50 each `AUDIT_ACTIONS` row maps from its event fixture (pure `toAuditEntry` with events-only lookups); unmapped → null. 51 names resolved at read; a leaver shows the id. 52 query filters: range, `staff_id` as actor or approver, action list, cursor (`meta.next_cursor`, default 50); 1 statement; no temp sort (`EXPLAIN QUERY PLAN`); `to − from > 31 d` → 400; no `view-audit-log` → 403. 53 `registerAuditAction` adds an action; a duplicate event type → startup error. 54 the `audit` fold reads no table but its own (spy on statements). 55 **rebuild = live after alert retention deleted the `alerts` rows and after a table move** (H1-8). 56 `OrderContactSet` never mapped.

**Client:** 57 sheet: moved pre-selected only when enabled; disabled reasons; partly-movable deal text; Ask vs Void button by grant. 58 PENDING VOID tag; total excludes `refund_minor` only. 59 "Void all": RemoveItems for stage-1 lines + one VoidItems for the rest. 60 audit screen filters + CSV export of 2 pages.

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
| 0 | Spec bumps with markers: F v1.13, 01b v1.9, 01d v1.2.3, 02b v1.0.7, 03a v1.2.2; README R-1 | `docs/specs/*`, `docs/specs/README.md` | §4.5 |
| P1 | T-1 schema fields + fixtures | `packages/events/src/events/{order,stock}/*` | T-1 |
| P2 | Q-1 `alert_id` on `OrderCancelled` / `OrderFoodCleared` | `packages/events/src/events/order/*` | Q-1 |
| P3 | D-2 `result_also_to` in 01d + bound tests | `apps/hub/src/alerts/kinds.ts`, `commands/answer-request.ts`, `apps/hub/test/alerts/*` | D-2 |
| P4 | Q-2 export `readOrder`; Q-3 line guard (Comp raise + approve, Remove, Weight on planned ids) + weight on voided line | `apps/hub/src/orders/{exports,line-guard}.ts`, `commands/{comp-line,remove-items,set-line-weight}.ts`, `comp-kind.ts` | Q-2, Q-3 |
| P5 | B-1 default grants + backfill migration; B-2 allowed-only rule | `apps/cloud/src/modules/staff-roles/{default-roles,service}.ts`, `apps/cloud/src/db/migrations/NNNN_void_defaults_backfill.sql`, `packages/domain/src/permissions.ts` | B-1, B-2 |
| 1 | **Spike** test 0 (stop and report on any failure) | `apps/hub/test/voids/spike.int.test.ts` | §10 #0 |
| 2 | Shared types + `VOID_NOT_ALLOWED` | `packages/domain/src/{voids,errors}.ts` | §4.4, §9 |
| 3 | §3.2 checks + per-line dispositions + `voidDrafts` (one stock pass, one line-change pass) | `apps/hub/src/voids/plan.ts` | §3.2, §3.3 |
| 4 | `VoidItems` direct path | `apps/hub/src/voids/commands/void-items.ts` | §6.1 |
| 5 | Kind `void_approval` + raise path | `apps/hub/src/voids/kind.ts` | §3.5, §6.1 step 7 |
| 6 | `apply` / `onWithdraw` / `result_also_to` | `apps/hub/src/voids/kind.ts` | §6.2 |
| 7 | Guards + `pendingVoids` | `apps/hub/src/voids/{guards,exports}.ts` | §6.6, §4.2 |
| 8 | `void-preview`, `pending-voids` queries | `apps/hub/src/voids/queries/*` | §6.3, §6.4 |
| 9 | Money tests 40–49 (property test) | `apps/hub/test/voids/money.*.test.ts` | §10 |
| 10 | Permission matrix 32 | `apps/hub/test/voids/permissions.int.test.ts` | §10 |
| 11 | `toAuditEntry`, `AUDIT_ACTIONS`, `registerAuditAction` | `packages/domain/src/audit.ts` | §3.6 |
| 12 | Migration + projection `audit` (events only) | `apps/hub/src/db/migrations/NNNN_audit.sql`, `apps/hub/src/audit/projection.ts`, `lib/boot.ts` | §5 |
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
| `VoidItems` | `void-item` (approvable) | 2 + (direct 2 \| raiseMany) | 400, 403, 404, `ORDER_BILLED`, `ITEM_WRONG_STAGE`, `VOID_PENDING`, `COMP_PENDING`, `VOID_NOT_ALLOWED` |
| `void_approval` apply / onWithdraw | 01d rules (`approve-void` range) | 3 in apply | as §3.4 (refuses the answer) |
| `GET /queries/void-preview` | `void-item` | 2 | 400, 404, `ORDER_BILLED`, `ITEM_WRONG_STAGE`, `VOID_NOT_ALLOWED return_line` |
| `GET /queries/pending-voids` | `take-order` \| `void-item` \| `approve-void` | 1 | 400 |
| `GET /queries/audit-log` | `view-audit-log` | 1 | 400, 403 |
| merge guard / line guard | — | 1 each | `MERGE_BLOCKED_BY_VOID` (02a), `VOID_PENDING` |
| projection `audit` | — | own tables only | — |

Size: 4 endpoints + 1 kind + 2 guards + 1 projection (≈ 8 items; README budget 10–25 for commands / endpoints, merge floor 5) — kept as its own module because it is a milestone-A row with its own stories and a distinct read model; ~23 build tasks.

### 12.3 Open questions

| # | Question | Status |
|---|---|---|
| OQ-1 | Names in the audit log | **Closed (v0.2, H1-8):** resolved at read from the hub directory; a leaver shows the id; rebuild = live. |
| OQ-2 | Default `move-item-to-stock` for Cashier and Order taker | **Closed:** granted (B-1); allowed-only (OQ-A, B-2). |
| OQ-3 | 01d `result_also_to` (D-2) | Proposed; part of the §4.5 approval. |
| OQ-4 | Audit range ≤ 31 days per query, page ≤ 200 (default 50), CSV ≤ 31 days | Proposed; part of the spec approval. |

Review owner questions OQ-A–OQ-D: answered 2026-11-12 (changelog v0.2).

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

### 12.5 Hostile self-review (v0.2)

- **Races:** dedupe index + in-transaction lock check over **touched** ids; comp ↔ void locks on planned cascades, comp approve included; approve vs withdraw by 01d; one stock pass per command (no double reserve).
- **Approve path:** own lock not re-checked (§3.4), frozen per-line dispositions, served-meanwhile refused with a hint.
- **Idempotency:** D32 on `VoidItems`; 01d answers keyed by `command_id`; folds idempotent by seq.
- **K-1 strict:** every approval draft stamped; the only foreign type (`AlertClosed` of a stale comp) is impossible by V8 and asserted (test 30); holder notice in 01d (D-2), outside `apply`.
- **N+1:** fixed statements; `lineChangeDrafts` once per command; `pendingVoids` / guards 1 each; audit query 1, index order, no temp sort.
- **Money:** one ledger (02b); bill effect is `refund_minor` only; property invariant corrected; approve amount = raise amount.
- **Audit:** events-only fold, rebuild = live after retention and table moves; names at read.
- **Engine / stock:** move-before-void in one array; partial move releases nothing (spike).
- **Privacy:** no money on lock screens; contact events never in audit; notes ≤ 200.
- **Over-engineering check:** no void table, no cache, no retention job, no override, no KDS tag, no new event type, `hasPendingVoid` dropped. `registerAuditAction` kept (03c / 05 add actions without editing 04). Two small lookup tables kept: without them the fold must read `alerts` (deleted by retention) and 02a (T19 bug).
- **Contradictions:** F §4.5 OVERRIDDEN and REJECTED text fixed by F-2 / D-1; 01d `line_id` by D-1; 02b Exposes and `readOrder` by Q-2; Foundation cursor used; `VOID_PENDING` reused; 03b / 03c version claims untouched (K-4).
