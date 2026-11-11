# 04 Voids + Audit — Module Spec

| | |
|---|---|
| Module | 04 Voids + Audit (hub) |
| Version | **v0.1 — Draft, needs hostile review** (developer, 2026-11-11) |
| Inherits | Shared Standards from **Foundation v1.11** §6 (envelope, errors, hub HTTP, WS, naming, tests, migrations, folders); not redefined here |
| Depends on | Foundation v1.11; 00 Hub Platform v1.8; 01b v1.7; 01c v1.1.2; 01d v1.2.1; 02a v1.1.4; 02b v1.0.5; 03a v1.2; read-only: 03b v1.0.1, 03c v1.0.1 (their "Exposes" and §4.5 claims are taken as given) |
| Read by | 05 (pending voids, bill close), 06 (cloud audit view), 07 |
| Stories | `docs/stories/04-g0.md`, `docs/stories/04-g1-decisions.md` (G1 complete, owner 2026-11-11 19:31 PKT) |
| Branch | `spec-04` from `origin/main` @ `45828a7` |

### Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-11 | First draft from G0 + G1 (owner rulings K-1–K-8, Q1–Q16). |

---

## §1. Header

### 1.1 Stories covered

- **E6 "Item lifecycle enforcement"** (P1): stages 2–4 for `void-item` / `move-item-to-stock`; every transition logged with actor, time, reason, item, order. Stage 1 (Remove) is 02b's.
- **E6 "Pending void on bill and table close"** (P1, D11): AC1 PENDING VOID and excluded from the total (shown by 05 from §4.2), AC2 approvers alerted (01d), AC3 table not closable while pending (05 refuses, 02a merge / split refuse), AC5 approved → off the bill, AC6 rejected → stays, requester and order taker told. **AC4 (timeout override) is not built** (owner Q9, §12.4).
- **E6 "Immutable audit log"** (P1): AC1–AC5 on the **hub** (LAN); the cloud / remote view is 06's (owner K-8 revised).
- **E0 "Refunds, cancellations, complimentary items"** AC4 (cancel a whole order = void every line, one request per line, owner Q5) and AC5 (permission + audit).
- **E-REQ / R22**: approvals answered on the approver's own device (01d `void_approval` kind).
- Carried rows README :199, :213, :225, :227, :239, :242; 02b §4.3 To 04; 03a §4.3 To 04, §12.3 Q12.

### 1.2 In scope

`VoidItems` (direct or approval); kind `void_approval` with read-only `apply` / `onWithdraw`; dispositions `moved` / `wastage` / `staff_meal` / `other`; the void lock on lines (02b guard) and the merge / split guard (02a); `pendingVoids` for 05; queries `void-preview`, `pending-voids`, `audit-log`; projection `audit_entries` and the pure audit map shared with 06; the staff-app Void sheet and Audit log screen.

### 1.3 Out of scope

Stage-1 removal (02b). Refunds after a bill closes (`apply-refund`, 05). The bill, PENDING VOID on the bill, bill-close refusal and the Z report (05, from §4.2). Override after N minutes (F §4.5 OVERRIDDEN; owner Q9, §12.4). Resell of a served item (D10 stage 5, off by default). A "VOID?" tag on the KDS (owner Q8). Owner-editable reason lists (owner Q4). Cloud / remote audit view and hub → cloud event sync (06). Owner config changes (cloud `config_audit`, 01a / 01b / 01c). Wastage / staff-meal reports (05 / 08 / 07 read `ItemVoided.disposition`).

### 1.4 Decisions log

| ID | Decision | Source |
|---|---|---|
| V1 | **A void is past stage 1 only.** A line whose engine stage is `added` (fired or not) is 02b's Remove → `409 ITEM_WRONG_STAGE { stage: 'added' }`. Past stage 1 = engine `cooking`, `done`, `served`, `returned`, or the order left the engine (`out_of_engine`), or a zone-served line past its undo window. Unbilled orders only. | D10, F §4.2, owner Q2 |
| V2 | **One ledger.** Money comes from 02b's `planVoid` (uncomped units first, comped unit → `comp_voided_minor`, deal / child cascades with caps, 01c §3.4.8); 04 writes the resulting `ItemVoided` payloads and 02b's projection folds them. 04 keeps no money column. | 02b §3.4, O19, O21; K-6 |
| V3 | **Dispositions** `moved` (to pre-cooked stock; next order takes it), `wastage`, `staff_meal`, `other` (+ note). `moved` only for an engine-open line at `cooking` / `done` with at least one stock draw, and only when the caller holds `move-item-to-stock` (`allowed`); otherwise the client shows it disabled with the reason. Served, returned, out-of-engine and zone lines: `wastage`, `staff_meal`, `other`. | owner 2026-11-07, Q3 |
| V4 | **`moved` = `ItemMovedToStock` then `ItemVoided`** in one transaction, in that order, each followed by its `stockEffects` (a partial `ItemVoided` shrinks the draws `moveDrafts` reads). `move-item-to-stock` is a right to choose the disposition, never a way past `void-item`'s approval. | K-3, 03a §3.7 |
| V5 | **Every approval-born event carries the request's `alert_id`** (01d `checkAlertIds` unchanged): `ItemMovedToStock`, `ItemVoided`, every `stockEffects` draft and `lineChangeDrafts`' `OrderCancelled` / `OrderFoodCleared`. The schemas gain an optional `alert_id` (rows T-1, Q-1). | K-1 |
| V6 | **`ItemVoided` carries the why**: `reason_code`, `note`, `disposition`, `requester_staff_id`, `approver_staff_id` (null on a direct void), `alert_id` (null on a direct void) — the 02b `LineComped` pattern. The approver is `AnswerFacts.answerer_staff_id`, never `actor_id`. | K-2, 01d To 04 |
| V7 | **One request per line** (the line named in an entry; its cascade travels with it). A whole-order cancel is one `VoidItems` with several entries → one request each, raised in one transaction. | owner Q5, Q6 |
| V8 | **A line in a pending void is locked**: every line the request's plan touches (`values.touched_ids`) refuses another void, a comp, a remove and a weight (`409 VOID_PENDING`) until the request ends; Served, Done and returns still work. Symmetric: a void request on a line with an open `comp` request → `409 COMP_PENDING` (02b's code). So `apply` never has a stale comp to close (G1-1b). | owner Q7, K-1 |
| V9 | **No override.** A pending void ends by approve, reject or withdraw only; the bill stays blocked. Coverage is configuration (`approve-void` grants). | owner Q9 |
| V10 | **Withdraw = never asked.** `onWithdraw` returns `[]`; 01d records `RequestWithdrawn`; the lock lifts. | owner Q10 |
| V11 | **Reject** changes nothing on the bill; `apply` returns `[]`. The requester gets 01d's `request_result`; for dine-in the table's holder also gets one through 01d's `result_also_to` (row D-2), so no foreign `AlertRaised` is returned by `apply` (V5). | owner Q11, K-1 |
| V12 | **Fixed reason codes** `customer_changed_mind`, `wrong_order_taken`, `too_late`, `quality`, `other` (`note` required for `other`, ≤ 200). | owner Q4 |
| V13 | **Customer's own wrong order** = a normal void (reason `wrong_order_taken` or `customer_changed_mind`) plus a new normal order. No third return mode. | owner Q12, 03a Q12 |
| V14 | **No table lock** for a void (D39 / 02b O9: only `SubmitOrder` and `RemoveItems` call `requireLock`). Scope `branch` (01b catalogue). | 02b O9 |
| V15 | **Online only** (PIN-capable, approvable); never queueable. | 02b O13 |
| V16 | **Audit log = a read model over the immutable event store.** `audit_entries` is a projection (rebuildable from seq 0) of a **curated** action list (§3.6); nothing edits the events (D52), so the log cannot be edited. The pure map `toAuditEntry` lives in `@pos/domain` so 06 builds the cloud copy from the same rules. | E6 audit AC1, owner Q14, K-8 revised |
| V17 | **Audit view on the hub, LAN only**, staff app, `view-audit-log`; CSV built in the browser from the same JSON query (no non-envelope endpoint, F §6.1). | owner Q13 / K-8 revised, Q15 |

---

## §2. Existing architecture that must not change

- **Events** are INSERT-only with triggers (F §4.1, D52); every command goes through 00's registry (`defineCommand`, `approvable`, fixed processing order, `processed_commands`, D32).
- **01d** owns the request record, steps (`APPROVAL_TIER_STEPS`), answer rules (self, range, PIN, `in_person`), receipts and `request_result`; `apply` / `onWithdraw` run read-only in `preRead` and `prepare` (writes throw) and every returned draft must carry the request's `alert_id` (`alerts/commands/request-row.ts:107`). **Unchanged.**
- **02b** owns `order_lines` money and its fold of `ItemVoided { refund_minor, comp_voided_minor }` (`orders/projection.ts:293`), `planVoid`, `lineChangeDrafts`, `seatingTotals` (no pending voids in it), comps (`comp:<order_item_id>` dedupe, `COMP_PENDING`).
- **03a** owns the `ItemVoided` / `ItemMovedToStock` / stock schemas, the engine folds (`foldItemEnded`, `partialVoid`: a void of any stage before served ends or shrinks the line; served lines are engine no-ops), `stockEffects` (array form, `withStockEffects`, `openDayStockCtx`).
- **02a** asks `checkMergeGuard` on merge and split (`MERGE_BLOCKED_BY_VOID`), unregistered → never blocked.
- **03b / 03c** drop voided lines from KDS / Pass and print a CANCELLED slip for a printed, not-done line (03c §3.3) — unchanged; 04 adds nothing to them.
- **01b** permissions `void-item` (approvable, scope `branch`), `move-item-to-stock` (`branch`), `approve-void` (`branch`, `my_team`), `view-audit-log` (`branch`) already exist (`packages/domain/src/permissions.ts`).
- **00** projections registry (`register`, optional `reset`, catch-up runs each projection over the range), hub clock, directory in memory.

---

## §3. Domain rules

### 3.1 Words

**Entry** = one `{ order_item_id, units?, disposition }` in `VoidItems`. **Named line** = the entry's line. **Touched lines** = the named line plus the cascade `planVoid` adds (option children of an `item`, parts of a `deal`), each with its own units. **Void request** = an open `void_approval` alert. **Locked line** = a line in some open void request's `values.touched_ids`.

### 3.2 Eligibility of an entry (checked in payload order against a working copy, as 02b `RemoveItems` does)

1. The line belongs to the order → else `400 VALIDATION_FAILED { path: lines.N.order_item_id }`.
2. Not a return line (`return_of` set; money 0) → else `409 VOID_NOT_ALLOWED { order_item_id, reason: 'return_line' }`.
3. Weight not pending (`quantity` null) → else `409 LINE_WEIGHT_PENDING`.
4. **Past stage 1** (V1). For a `deal` line, judged on its parts: at least one part past stage 1; parts still at `added` are voided with it (their own `ItemVoided`, engine ends them). Otherwise `409 ITEM_WRONG_STAGE { order_item_id, stage: 'added' }`. A zone-served line inside its undo window → `409 ITEM_WRONG_STAGE { stage: 'zone_undo' }` (Remove it instead).
5. `units` (absent = all live units) `1 ≤ units ≤ live_units` → else `400 VALIDATION_FAILED { path: lines.N.units }`; g/ml lines whole only (`units` = 1); a partial void of a deal with an open g/ml part, or of an open g/ml `deal_part` alone → `400 VALIDATION_FAILED { reason: 'gml_deal_part_partial' }` (02b §3.4).
6. **Locks** (V8): no touched line is locked → else `409 VOID_PENDING { alert_id, order_item_id }`; no open `comp:<id>` request on a touched line → else `409 COMP_PENDING { alert_id }`.
7. **Disposition** (V3): `moved` needs every engine-open touched line at `cooking` / `done` and at least one touched line with a stock draw, an open business day (stock context), and the caller's `resolve('move-item-to-stock').grant === 'allowed'`. Failures → `409 VOID_NOT_ALLOWED { order_item_id, reason: 'not_movable_stage' | 'stock_not_tracked' | 'day_closed' }` or `403 PERMISSION_DENIED { reason: 'move_not_granted' }`. `other` without `note` → `400`.

Repeated `order_item_id` → `400` (C6). An entry whose line is already touched by an earlier entry's cascade is judged on what is left (working copy).

### 3.3 Effect drafts (`voidDrafts`, shared by the direct path and `apply`)

Per entry, in payload order, against the order's lines as read:

1. `plan = planVoid(named, children, units)` (02b) → one `ItemVoided` payload per touched line with `refund_minor`, `comp_voided_minor`.
2. If `moved`: one `ItemMovedToStock { order_item_id, units }` per touched line that is engine-open at `cooking` / `done` (lines without a draw add nothing in `stockEffects`).
3. The drafts, in this order: all `ItemMovedToStock` of the entry, then all its `ItemVoided` with `{ disposition, reason_code, note, requester_staff_id, approver_staff_id, alert_id }`; then `withStockEffects(ctx, drafts, moved ? openDayStockCtx(state) : undefined)` (array form; each cause followed by its releases / adds / waiting-line reserves, 03a §3.7).
4. After every entry: `lineChangeDrafts(ctx, order_id, changes)` (02b; `changes` = every touched line with its units out) → `OrderFoodCleared` / `OrderCancelled`; any stale-comp `AlertClosed` in a direct void is kept; in `apply` none can exist (V8) and one present → throw (bug).
5. **Approval path only:** set `payload.alert_id = request.alert_id` on **every** draft (V5).

Zone counts never change (02b To 04). Stock draws: none on a `wastage` / `staff_meal` / `other` void past Start (the reservation was consumed at Start or Done, 03a P-5); a void of a still-reserved line releases its share (`StockReleased { reason: 'voided' }`).

### 3.4 Request lifecycle (01d states)

```
VoidItems (grant requires_approval)
     │  per entry: alerts.raiseMany → AlertRaised(kind void_approval, dedupe 'void:<order_item_id>')
     ▼
 PENDING (01d open) ── lines locked (V8); pendingVoids lists it; merge / split blocked; 05 refuses bill close
     │
     ├─ approve (answerer: approve-void in range, PIN) ─► apply: re-read, §3.2 again, voidDrafts + alert_id ─► APPROVED
     ├─ reject ─────────────────────────────────────────► apply: [] ; request_result to requester (+ holder, D-2) ─► REJECTED
     └─ withdraw (requester) ───────────────────────────► onWithdraw: [] ─► WITHDRAWN
   (no override, V9; at day close 05 lists open void requests and decides, 01d To 05)
```

`apply` re-runs §3.2 on the current state (1 read). A failure (billed meanwhile, `moved` no longer possible, units gone) throws its code; 01d refuses the answer before any PIN in `preRead` (rule 4 (b)); the request stays pending and the requester may withdraw.

### 3.5 Kind `void_approval` (registered at the top level of `apps/hub/src/voids/`, imported before boot replays `alerts`)

`family: 'urgent'`, `subject: 'order'`, `steps: APPROVAL_TIER_STEPS`, `closes_on: 'owner'`, `lead_fallback: false`, `expires_at_day_close: true` (no effect on requests; 02b `comp` precedent), `request: { answers: ['approve','reject'], right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' }, needs_pin: 'always', apply, onWithdraw, result_also_to }`.

- `values_schema`: `{ order_id, order_item_id, units, disposition, reason_code, note: string | null, touched_ids: string[] (1–40) }`.
- `details_schema` (`AlertDetailsBase.pick`): `item` (name × units of the named line; a deal shows the deal name), `quantity`, `amount` (Σ `refund_minor + comp_voided_minor` of the plan, minor units), `reason` (`reason_code[: note]`, ≤ 200), `lines` (`[{ name, quantity, state }]`, `state` = `cooking` / `cooked` / `served` / `disposition label`, ≤ 10) — the approver card of owner Q16; `display`: `{ kind_label_key: 'alert.void_approval.lock', table_code, requester_name }` (lock screen shows no money, 01d §3.12).
- `result_also_to(alert)` (row D-2): dine-in → `{ kind: 'table_team', table_id: currentTableOf(order), depth: 'owner' }` when the holder is not the requester; else `null`. 01d raises the extra `request_result` only for a `reject`.

### 3.6 Audit log (projection `audit_entries`, map `toAuditEntry`)

`toAuditEntry(event, ctx) → AuditEntry | null` (pure, `@pos/domain/src/audit.ts`; `ctx` gives names and table codes). One row per mapped event; unmapped events → `null`.

| Action | From event | Fields shown |
|---|---|---|
| `void_requested` | `AlertRaised` kind `void_approval` | requester, item × units, amount, reason, disposition |
| `void_answered` / `comp_answered` / `request_answered` | `RequestAnswered` (kinds `void_approval`, `comp`, `table_handover`, others as `request_answered`) | decision, answerer, **method**, `on_requester_device` |
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
| `ticket_reprinted` | `TicketReprinted` (03c, when its schema exists) | station |
| `pin_locked_out`, `device_pin_locked_out`, `pin_lockout_cleared` | `StaffPinLockedOut`, `DevicePinLockedOut`, `PinLockoutCleared` | staff / device |
| `device_paired`, `device_revoked`, `pairing_token_generated` | `DevicePaired`, `DeviceRevoked`, `DevicePairingTokenGenerated` | device |
| `station_paused`, `station_capacity_set` | `StationPauseSet`, `StationCapacitySet` | station, value, reason |
| `item_availability_set` | `ItemMadeAvailable`, `ItemMadeUnavailable` | item |
| `stock_set`, `stock_added`, `zone_stock_set` | `StockSet`, `StockAdded` (no `reason`; `moved` is covered by `item_moved_to_stock`), `ZoneStockSet` | stock item / zone, quantity |

Not mapped (owner Q14): sessions, presence, alert deliveries / seens, engine and tick events, config applies, `OrderContactSet` (privacy, 02b O17), owner config changes (cloud). Later modules add their actions through `registerAuditAction` (§4.2), e.g. 05 clock-in, bill override.

**Name at the time:** `actor_name` / `approver_name` are resolved from the hub directory **when the row is folded** (live = at the time). A rebuild re-resolves with the directory of the rebuild; a leaver no longer in the directory shows the id (OQ-1).

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | `defineCommand` (`approvable`), registry, projections registry, `ctx.state`, `ctx.directory`, `ctx.clock`, query routes | §6 |
| 01b | `resolve` (caller's `move-item-to-stock`), permissions above | §3.2, §6 |
| 01d | `defineAlertKind`, `APPROVAL_TIER_STEPS`, `alerts.raiseMany`, `alerts.listOpen`, `AnswerFacts`, `AlertDetailsBase`, read-only `apply` contract; `result_also_to` (row D-2) | §3.4, §3.5 |
| 02a | `registerMergeGuard`, `currentTableOf`, `tableOwners`, `seating_orders` (read-only join) | §3.5, §6.6 |
| 02b | `planVoid` (row Q-2), `lineChangeDrafts`, `orderLines`, order / line READ shape (as `RemoveItems`), `COMP_KIND`, `registerLineGuard` (row Q-3), `ORDER_BILLED`, `ORDER_NOT_FOUND`, `LINE_WEIGHT_PENDING`, `COMP_PENDING` | §3.2, §3.3 |
| 03a | `ItemVoided`, `ItemMovedToStock` (+ fields, row T-1), `stockEffects` via `withStockEffects`, `openDayStockCtx`, `isOrderInEngine`, engine line stage and draws | §3.2, §3.3 |
| 03c | `TicketReprinted` (audit map only, when present) | §3.6 |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `pendingVoids(db, order_ids[])` | `Map<order_id, Array<{ alert_id, order_item_id, units, touched_ids, amount_minor, requester_staff_id, raised_at }>>` (open `void_approval` alerts) | 1 (`alerts_open_kind`) | 05 bill (PENDING VOID, excluded from total; refuse close while any), 02a guard, client |
| `hasPendingVoid(db, order_ids[])` | `boolean` | 1 | 05 |
| `VOID_KIND` | `'void_approval'` | — | 05 day close (`alerts.listOpen({ kind })`) |
| `toAuditEntry`, `AuditEntry`, `AUDIT_ACTIONS` | pure, browser-safe (`@pos/domain/src/audit.ts`) | 0 | 06 cloud audit, clients |
| `registerAuditAction(event_type, map)` | adds a mapped action (startup only) | 0 | 05, later modules |
| Events written, kind, queries, projection | §6 | — | all |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 05 | Bill: lines in `pendingVoids` show **PENDING VOID** and are **excluded from the total** (`seatingTotals` does not exclude them); **refuse bill close while `hasPendingVoid`** for the bill's orders (D11 AC3); at day close list open `void_approval` requests and decide each (01d To 05, existing row); refund after close is `apply-refund`, never a void; Z report reads `ItemVoided.disposition` (wastage / staff meal / moved) and `comp_voided_minor` as a voided comp (02b O21). |
| 06 | **Cloud / remote audit view** (owner K-8 revised): from synced events, build the cloud `audit_entries` with the same `toAuditEntry` / `AUDIT_ACTIONS` (`@pos/domain`), owner page under `/v1/admin/` (C2 branch guard, C7 route case); names from the cloud directory. Whether 06's sync joins milestone A is 06's G0. |
| 07 | Voids, approvers and methods from `audit_entries` / events; wastage from `ItemVoided.disposition`. |
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
| F-1 | Foundation → **v1.13** §4.2 | Note: a void past stage 1 has a **disposition** (`moved` / `wastage` / `staff_meal` / `other`); `moved` = `ItemMovedToStock` then `ItemVoided` in one transaction (04 V4); `move-item-to-stock` is the right to choose `moved`, not a separate refund path. Diagram labels unchanged. | V3, V4 |
| F-2 | Foundation → **v1.13** §4.5 | OVERRIDDEN **not built** (owner Q9, 04 §12.4); a pending void ends by approve / reject / withdraw; the states table keeps the row marked "deferred". REJECTED: "the table's order taker is notified" via 01d `result_also_to` (D-2). PENDING is not in 02b `seatingTotals`; 05 subtracts `pendingVoids`. | V9, V11 |
| F-3 | Foundation → **v1.13** §3.1 audit row | Hub: `audit_entries` read model of a curated action list over the immutable events (04 §3.6); cloud replica built by 06 from synced events with the same map. | V16, K-8 |
| F-4 | Foundation §6.2 (append, no bump) | `VOID_PENDING`, `VOID_NOT_ALLOWED` (§9). | §9 |
| H-0 | 00 | **No change.** | — |
| B-1 | 01b → **v1.9** default roles (`apps/cloud/src/modules/staff-roles/default-roles.ts`, hub seed) | Cashier and Order taker: `void-item` **requires approval by Manager**, `move-item-to-stock` allowed (`branch`); Owner / Manager unchanged (all allowed). Re-seed (R29). No migration. | owner Q1 / K-7; V3 (OQ-2) |
| D-1 | 01d → **v1.2.3** §4.3 To 04 (text) | Values `{ order_id, line_id }` → §3.5's `values_schema` (`order_item_id`, `units`, `disposition`, `reason_code`, `note`, `touched_ids`); OVERRIDDEN not used (04 V9); the rejected-void notice goes through D-2, not a 04 kind. | K-5, V9, V11 |
| D-2 | 01d → **v1.2.3** §3.5 `defineAlertKind`, §3.3 rule 7 + code (`alerts/kinds.ts`, `commands/answer-request.ts`) | Optional `request.result_also_to(alert) → AlertTarget \| null`, called read-only in `prepare`; on a **reject**, 01d raises one more `request_result` to that target (dedupe `request_result:<alert_id>:also`) in its own `raiseMany` with the other answer raises (statement bound +0: same `raiseMany`), **outside** `checkAlertIds`. Self (target resolves only to the requester) → not raised. Tested in 01d's test file. | V11 with K-1 strict |
| Q-1 | 02b → **v1.0.7** §6.19 + code (`OrderCancelled.v1.ts`, `OrderFoodCleared.v1.ts`) | Optional `alert_id: string` (both are `.strict()` today); folds ignore it; fixtures with and without parse. | V5 |
| Q-2 | 02b → **v1.0.7** §4.2 Exposes (as built) | `planVoid(parent, children, n)` (`orders/ledger.ts:194`) listed with its shape; `RemoveItems`' order READ shape named as the shared read 04 reuses. | K-6 |
| Q-3 | 02b → **v1.0.7** §3.4, §3.6, §3.9, §6.2, §6.3, §6.8 + code | **Line guard:** `registerLineGuard((db, order_id, order_item_ids) → { alert_id, order_item_id } \| null)` (`orders/line-guard.ts`, merge-guard pattern; unregistered → never blocked). `CompLine`, `RemoveItems`, `SetLineWeight` ask it after their own `404` / `409` checks and before scope (C8) → `409 VOID_PENDING { alert_id, order_item_id }` (04's code). 1 statement when registered. | V8 |
| Q-4 | 02b → **v1.0.7** §4.3 To 04 (text) | "every void calls `lineChangeDrafts`; in an approval every returned draft carries the request's `alert_id`"; dispositions per 04 V3. | V5 |
| T-1 | 03a → **v1.2.2** §4.2 + code (`ItemVoided.v1.ts`, `ItemMovedToStock.v1.ts`, `StockReleased.v1.ts`, `StockAdded.v2.ts`, `StockReserved.v1.ts`) | Additive optional fields, no payload version bump (R29): `ItemVoided` + `alert_id`, `requester_staff_id`, `approver_staff_id`, `reason_code`, `note`, `disposition` (enum §4.4); `ItemMovedToStock`, `StockReleased`, `StockAdded` v2, `StockReserved` + `alert_id`. `stockEffects` never sets `alert_id` (the writer stamps it); folds ignore the new fields; fixture tests. | V5, V6 |
| T-2 | 03a → **v1.2.2** §3.7 move to stock, §4.3 To 04 (text) | `ItemMovedToStock` is written **before** the `ItemVoided` of the same units; an engine test (04 #10) pins the order on a partial move. | V4 |
| B-0 | 03b, 03c | **No change.** Voided lines leave KDS / Pass and CANCELLED slips print as both specs already say; nothing shows while a void is pending (owner Q8). | — |
| R-1 | README (on approval) | Module map row 04 at the approved version; carried rows **To 05** and **To 06** from §4.3; carried row :227 marked landed by 04 plan task (manual checks). | §4.3 |

### 4.6 Carried rows (README) and where they land

| Row | Lands in |
|---|---|
| :199 R22 | §3.4, §3.5; tests 20–31 |
| :213 01c §3.4.8 | V2, §3.3; tests 40–49 |
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

```sql
-- 04 §3.6: read model of the curated audit actions; rebuildable from the events (projection reset deletes all rows).
CREATE TABLE audit_entries (
  seq               INTEGER PRIMARY KEY,          -- the event's seq (one row per mapped event)
  event_id          TEXT    NOT NULL UNIQUE,
  recorded_at       INTEGER NOT NULL,             -- hub clock (E6 AC3)
  action            TEXT    NOT NULL,             -- AUDIT_ACTIONS
  actor_staff_id    TEXT,                         -- envelope actor_id (null for system / station events)
  actor_name        TEXT,                         -- directory name at fold time (§3.6)
  approver_staff_id TEXT,
  approver_name     TEXT,
  method            TEXT CHECK (method IN ('session','pin','in_person')),
  device_id         TEXT    NOT NULL,
  subject_type      TEXT    NOT NULL,             -- order / table / staff / device / station / stock / day
  subject_id        TEXT    NOT NULL,
  order_id          TEXT,
  table_code        TEXT,                         -- 02a current table at fold time (dine-in)
  reason            TEXT,                         -- reason_code[: note], ≤ 200
  outcome           TEXT,                         -- approved / rejected / withdrawn / disposition / mode
  amount_minor      INTEGER,                      -- refund + comp_voided, comp value, … (D47)
  detail_json       TEXT    NOT NULL              -- the rest, small (≤ 2 KB)
);
-- GET /queries/audit-log: newest first within a time range …
CREATE INDEX audit_entries_time   ON audit_entries (recorded_at, seq);
-- … filtered by staff member (as actor or approver)
CREATE INDEX audit_entries_actor  ON audit_entries (actor_staff_id, recorded_at, seq);
CREATE INDEX audit_entries_appr   ON audit_entries (approver_staff_id, recorded_at, seq) WHERE approver_staff_id IS NOT NULL;
-- … filtered by action type
CREATE INDEX audit_entries_action ON audit_entries (action, recorded_at, seq);
```

Size: R6 ≈ 2 000 orders / day → mapped rows ≈ 1–3 % of ~75 000 events ≈ 1 000–2 500 rows / day; kept forever like the events (no retention job; YAGNI until a size problem is measured).

Projection `audit` registers **after** 02b's `orders` and 02a's `tables` (it reads `seating_orders` for `table_code`); boot test asserts the order.

---

## §6. Commands, events and queries

### 6.1 `VoidItems` (`POST /commands/VoidItems`, not queueable)

- **Permission:** `void-item`, `approvable: true`, session `device` (staff). Scope `branch` (C8, last).
- **Payload:**
  ```json
  { "order_id": "01JDQ…", "reason_code": "customer_changed_mind", "note": null,
    "lines": [ { "order_item_id": "01JDQ…K1", "units": 1, "disposition": "moved" } ] }
  ```
  `lines` 1–40, keyed (C6); `units` int ≥ 1 optional; `disposition` ∈ §4.4; `reason_code` ∈ §4.4; `note` ≤ 200, required when `reason_code` or any `disposition` is `other`.
- **Processing script:**
  1. Zod (`400`).
  2. Read the order + lines (1 statement, 02b's READ shape) → `404 ORDER_NOT_FOUND`; `billed_at` set → `409 ORDER_BILLED`.
  3. `alerts.listOpen(db, { subject: order })` (1 statement) → open `void_approval` and `comp` requests of the order (locks, V8).
  4. Each entry in payload order: §3.2 rules 1–7 against the working copy; `planVoid`; collect touched lines.
  5. Scope `branch` (C8).
  6. Grant `allowed` → `voidDrafts` (§3.3, `alert_id: null`, `requester_staff_id` = caller, `approver_staff_id: null`) + `lineChangeDrafts` (2 statements). Result `{ voided: [{ order_item_id, units, refund_minor, comp_voided_minor, disposition }], cancelled }`.
  7. Grant `requires_approval` → one raise input per entry (`kind: 'void_approval'`, `subject: order`, `target: { kind: 'answerers' }`, `dedupe_key: 'void:' + order_item_id`, `values`, `details`, `display`, `requester_staff_id: caller`, `request: { approver_role_ids }`) → `alerts.raiseMany` (01d's statements). A deduped entry → `409 VOID_PENDING { alert_id, order_item_id }` (the whole command rolls back). Result `{ pending: [{ order_item_id, alert_id }] }`.
- **Idempotency:** `command_id` (D32); a retransmit returns the stored result.
- **Statements:** 2 (+2 direct path, + 01d's `raiseMany` bound); engine state, directory, config in memory.
- **Audit:** `item_voided` / `item_moved_to_stock` / `void_requested` rows by fold.

### 6.2 Kind `void_approval` — `apply`, `onWithdraw` (§3.4, §3.5)

- `apply(ctx, answer)`: `reject` → `[]`. `approve` → re-read (1 statement) and §3.2 on the current state with the request's values (the requester's `move-item-to-stock` was checked at raise; not re-checked); `voidDrafts` with `requester_staff_id = alert.requester_staff_id`, `approver_staff_id = answer.answerer_staff_id`, `alert_id` stamped on every draft (§3.3 step 5); `lineChangeDrafts` output without `AlertClosed` (else throw). Read-only (01d view).
- `onWithdraw` → `[]`.
- `result_also_to` (D-2) → table holder for a dine-in reject.
- **Statements in `apply`:** 1 read + 2 (`lineChangeDrafts`), inside 01d's answer bound.

### 6.3 `GET /queries/void-preview?order_id&order_item_id&units?`

`void-item` (any grant). Runs §3.2 without writing for one entry; `200 { data: { amount_minor, touched: [{ order_item_id, name, units, refund_minor, comp_voided_minor }], stage, dispositions: [{ disposition, enabled, block: VoidBlock | null }], needs_approval, pending: { alert_id } | null } }`. Errors as §3.2 rules 1–5 (6–7 are reported in `dispositions` / `pending`, not as errors). 2 statements.

### 6.4 `GET /queries/pending-voids?order_ids=…` (1–40) or `?seating_id=`

`take-order` or `void-item` or `approve-void`. `200 { data: { orders: [{ order_id, voids: [{ alert_id, order_item_id, units, touched_ids, amount_minor, requester_staff_id, raised_at }] }] } }` — `pendingVoids` (1 statement; `seating_id` resolves through `seating_orders` in the same statement). Order screens fetch it after their own `VoidItems` and on any order / alert frame for the open order.

### 6.5 `GET /queries/audit-log?from&to&staff_id?&action?&before_seq?&limit?`

`view-audit-log` (scope `branch`). `from` / `to` Unix ms, `to − from ≤ 31 days` and `from < to` else `400`; `action` comma list ⊆ `AUDIT_ACTIONS`; `staff_id` matches actor **or** approver; `limit` 1–200 (default 100); newest first by `seq`, cursor `before_seq`.
`200 { data: { entries: [AuditEntryView], next_before_seq: number | null } }`. **1 statement** (`audit_entries_time` / `_actor` + `_appr` union / `_action`). CSV: the client pages through and builds the file (V17).

### 6.6 Registrations at startup (`apps/hub/src/voids/index.ts`)

- `registerMergeGuard((db, { seating_ids, order_ids? }) → { blocked, order_item_ids })`: open `void_approval` alerts whose subject order is in those seatings (via `seating_orders`) or `order_ids` → blocked with their `touched_ids` (1 statement).
- `registerLineGuard((db, order_id, ids) → …)` (row Q-3): open `void_approval` of the order whose `touched_ids` meet `ids` (1 statement).
- Projection `audit` (§5) folding `AUDIT_ACTIONS`' event types.

### 6.7 Events written (no new event type)

| Event | Writer here | Fields 04 fills |
|---|---|---|
| `ItemVoided` (03a schema + T-1) | `VoidItems`, `apply` | `order_item_id`, `units`, `refund_minor`, `comp_voided_minor`, `disposition`, `reason_code`, `note`, `requester_staff_id`, `approver_staff_id`, `alert_id` |
| `ItemMovedToStock` (+ T-1) | same, disposition `moved` | `order_item_id`, `units`, `alert_id` |
| `StockReleased` / `StockAdded` / `StockReserved` (+ T-1) | `stockEffects` drafts | `alert_id` (approval path) |
| `OrderCancelled` / `OrderFoodCleared` (+ Q-1) | `lineChangeDrafts` drafts | `alert_id` (approval path) |
| `AlertRaised` (01d) | `raiseMany` | kind `void_approval` |

### 6.8 Example — Table 12, karahi cooked, order taker asks, manager approves

```
Hamza  VoidItems { order_id: O7, reason_code: customer_changed_mind,
                   lines: [{ order_item_id: K1 (Mutton Karahi ×1, done), disposition: moved }] }
       → grant requires_approval → AlertRaised void_approval A9 { touched_ids: [K1], amount 240000 }
       → 200 { pending: [{ order_item_id: K1, alert_id: A9 }] }
Imran  AnswerRequest A9 approve (PIN, own tablet)
       → RequestAnswered · ItemMovedToStock{K1,1,alert_id A9} · StockAdded{karahi,1,moved,A9}
         · StockReserved{waiting T4 karahi, A9} · ItemVoided{K1,1,refund 240000,moved,…,approver Imran, A9}
         · (OrderFoodCleared{O7,A9}) · request_result → Hamza · approval_receipt → Imran
```

---

## §7. Cross-cutting

- **Concurrency:** single writer (F §4.1). Two voids on the same line race to `alerts_open_dedupe` / the in-transaction lock check; the second gets `VOID_PENDING`. A comp raised between a void's raise and approve is refused by the line guard (Q-3). Approve vs withdraw: 01d first-commit-wins.
- **Logging:** void commands log `{ command, order_id, lines: n, path: direct | request }`, never notes in full (≤ 40 chars) and never PINs (00 §7.2).
- **Privacy:** the lock-screen text has no money (01d §3.12); `details` only on signed-in cards. The audit view needs `view-audit-log`; `OrderContactSet` never in it.
- **No retention job** for `audit_entries` (§5 size).
- Nothing else (no cache, no rate limit beyond 00's): YAGNI.

---

## §8. Client contract (`apps/client`, staff entry, ui-kit only; R5 permission-derived)

- **Void action** on a line past stage 1 in the order / bill views, shown when the session holds `void-item` (any grant). Stage-1 lines keep 02b's Remove.
- **Void sheet:** opens with `void-preview`; units stepper (piece lines; g/ml fixed 1); disposition radios from `dispositions` — `moved` pre-selected when enabled, else `wastage`; disabled rows show their reason ("Stock not tracked for this item", "Already served", "You can't move to stock"); reason chips (V12) + note box for Other; amount shown; button "Void" (`allowed`) or "Ask for approval" (`needs_approval`). A locked line shows "Void pending · Withdraw" for the requester (01d `WithdrawRequest`), "Void pending" for others.
- **Cancel order:** "Void all" selects every live line past stage 1 into one `VoidItems` (one request each, V7).
- **Pending tag:** lines in `pending-voids` show **PENDING VOID** and are excluded from the screen's running total (the same rule 05 applies to the bill).
- **Errors:** `VOID_PENDING` → "A void is already waiting on this item"; `COMP_PENDING` → "A comp is waiting on this item — decide it first"; `ITEM_WRONG_STAGE { stage: 'added' }` → "Not started — use Remove"; `ORDER_BILLED` → "Bill closed — refunds are at the counter".
- **Approver card** (01d screens): §3.5 `details` (owner Q16).
- **Audit log screen** (`features/audit/`, `view-audit-log`): date range (default today), staff picker, action multi-select; newest first, infinite scroll by `before_seq`; row: time, who, action, target (table / item), reason, outcome, amount, approver + method ("in person", "on requester's device"); **Export CSV** pages through the same query (≤ 31 days) and saves in the browser.
- i18n keys only (D12), Latin digits (R20).

---

## §9. Error catalogue additions (Foundation §6.2, `@pos/domain/src/errors.ts`)

| Code | Status | `details` | When |
|---|---|---|---|
| `VOID_PENDING` | 409 | `{ alert_id, order_item_id }` | a touched line is in an open void request (void, comp, remove, weight — the last three through 02b's line guard) |
| `VOID_NOT_ALLOWED` | 409 | `{ order_item_id, reason: 'return_line' \| 'not_movable_stage' \| 'stock_not_tracked' \| 'day_closed' }` | §3.2 rules 2, 7 |

Reused: `400 VALIDATION_FAILED` (`gml_deal_part_partial`, units, note), `403 PERMISSION_DENIED` (`outside_scope`; new reason value **`move_not_granted`**), `404 ORDER_NOT_FOUND`, `409 ORDER_BILLED`, `409 ITEM_WRONG_STAGE` (stage values `added`, `zone_undo`), `409 LINE_WEIGHT_PENDING`, `409 COMP_PENDING`; 01d's answer codes unchanged.

---

## §10. Tests (`apps/hub/test/voids/*.test.ts`, `apps/hub/test/audit/*.test.ts`, `packages/domain/src/audit.test.ts`; client tests in `apps/client`)

**Spike (plan task 1, G1-8):** **0.** raise → approve → `ItemMovedToStock` + `StockAdded` (2 of 4 naan) → `ItemVoided` folded by 02b's ledger → engine line shrunk → every draft carries `alert_id` → `audit_entries` rows; proves `stock_ctx` and engine state inside a read-only `apply` and that 01d's answer path folds engine events.

**VoidItems, direct (`allowed`):** 1 happy path cooking line, wastage → refund, engine line ended, KDS / pass settle unaffected. 2 served line → money only, engine no-op. 3 order out of engine (abandoned) → money only. 4 stage `added` → `ITEM_WRONG_STAGE { added }`. 5 return line → `VOID_NOT_ALLOWED return_line`. 6 pending weight → `LINE_WEIGHT_PENDING`. 7 billed → `ORDER_BILLED`. 8 unknown order → 404; foreign line → 400 path. 9 repeated id → 400 (C6). 10 **moved partial** 2 of 4 naan: `ItemMovedToStock` before `ItemVoided`, `StockAdded` = 2 portions, waiting line reserved, engine units 2 (T-2). 11 moved on a line with no draw → `stock_not_tracked`; on served → `not_movable_stage`; caller without `move-item-to-stock` → `403 move_not_granted`; day closed → `day_closed`. 12 a still-reserved line voided → `StockReleased { voided }` share. 13 zone line in undo window → `ITEM_WRONG_STAGE zone_undo`; after → money only, zone count unchanged. 14 last live line → `OrderCancelled`; food cleared → `OrderFoodCleared`. 15 `other` without note → 400. 16 retransmit → stored response, no second event (D32). 17 COMMIT failure → nothing written, engine state unchanged (D45). 18 scope `branch` last (C8): a 404 / 409 wins over scope. 19 stale comp request closed on a direct void (02b §3.9).

**Approval:** 20 `requires_approval` → one `AlertRaised` per entry, values / details / display as §3.5, no `ItemVoided`. 21 approve → drafts with `alert_id` on **every** draft (`checkAlertIds` passes), approver = answerer, requester = raiser. 22 approve `in_person` → approver = named answerer, `actor_id` = requester device's session (01d). 23 reject → `[]`, line still billed, `request_result` to requester and **to the table holder** (D-2); takeaway → requester only; holder = requester → one result. 24 withdraw → `[]`, lock lifted, a new request allowed. 25 approve after the order was billed (fixture) → refused in `preRead` before PIN (spy: argon2 not called). 26 apply re-check fails (`moved` no longer possible: day closed) → refused, request stays pending. 27 second void on a locked line (named or cascaded child) → `VOID_PENDING`; comp on it → `VOID_PENDING` (02b guard, Q-3); remove of a locked deal's stage-1 part → `VOID_PENDING`; weight → `VOID_PENDING`. 28 void on a line with an open comp → `COMP_PENDING`. 29 three entries → three requests in one transaction; one deduped → whole command rolls back. 30 `apply` with a stray `AlertClosed` from `lineChangeDrafts` → throws (assert). 31 01d answer bound unchanged (statement count).

**Permission matrix (G1-7, K-7):** 32 `void-item` not granted → 403; `allowed` → direct; `requires_approval` → request with the grant's approver roles; per-person **denied** → 403 over a role grant; two roles allowed + requires_approval → allowed (D19); approver `approve-void` `branch` → covers all; `my_team` → requester below in the tree only, else `out_of_range`; self → `self`; approver role removed after raise → `not_approver`; approver without `approve-void` → `not_approver`; defaults after re-seed (B-1): Cashier / Order taker `void-item` requires_approval by Manager, `move-item-to-stock` allowed.

**Guards and exports:** 33 merge with a pending void → `MERGE_BLOCKED_BY_VOID { order_item_ids }`; 34 split moving that order → blocked; after approve / reject / withdraw → allowed. 35 `pendingVoids` 1 statement for 40 orders; amounts = details. 36 `hasPendingVoid`.

**Money (K-6, raised bar):** 40 deal ×1 (320 000): void 1 of 4 naan parts → part share, deal billed = total − part refund; then void the deal → refund = total − parts already refunded (01c :311). 41 g/ml part partial while open → 400; served g/ml part → allowed. 42 option child with `option_quantity` set → k × q child units; `null` child voided only with the last parent unit or alone. 43 comped units: void 3 of 4 with 2 comped → 2 uncomped to `refund_minor`, 1 to `comp_voided_minor`. 44 remainder share goes to the last unit. 45 a remade line voided → refunded share (O20). 46 **property test:** 500 random sequences of comp / remove / void / weight over random items, children and deals keep `money_out ≤ refundable` per line, the deal-billed rule, Σ billed before − after = Σ (refund + comp_voided + removed) of the sequence, never negative. 47 approve recomputes from the current ledger after a comp on **another** line of the order. 48 `orders` + `audit` projections rebuilt from seq 0 = live. 49 events with and without the new optional fields parse (T-1, Q-1 fixtures).

**Audit:** 50 each `AUDIT_ACTIONS` row maps from its event fixture (pure `toAuditEntry`); unmapped → null. 51 names at fold time; leaver shows id. 52 query filters: range, `staff_id` as actor or approver, action list, cursor; 1 statement; `to − from > 31 d` → 400; no `view-audit-log` → 403. 53 `registerAuditAction` adds an action; a duplicate event type → startup error. 54 projection registers after `orders` / `tables` (boot test). 55 rebuild equals live (with 48). 56 `OrderContactSet` never mapped.

**Client:** 57 sheet: moved pre-selected only when enabled; disabled reasons; Ask vs Void button by grant. 58 PENDING VOID tag and total excluded. 59 Void all → one command, N lines. 60 audit screen filters + CSV export of 2 pages.

### Acceptance

| Story AC | Test |
|---|---|
| E6 lifecycle — stage 2 void with reason, ready stock or wastage | 1, 10, 11, 15 |
| E6 lifecycle — stage 3 move to stock, reassigned to another order | 10 |
| E6 lifecycle — served → void money / wastage (O20) | 2, 45 |
| E6 lifecycle — every transition logged with actor, time, reason, item, order | 50, 52 |
| D11 AC1 pending excluded from total | 35, 58 (05 bill) |
| D11 AC2 approvers alerted | 20 (01d delivery) |
| D11 AC3 table not closable while pending | 33, 34, 36 (05 refuses) |
| D11 AC5 approved off the bill, reason logged | 21, 50 |
| D11 AC6 rejected stays, waiter / order taker told | 23 |
| E6 audit AC1 append-only | 48, 55 (read model of immutable events) |
| E6 audit AC2 actions | 50 |
| E6 audit AC3 fields | 50, 51 |
| E6 audit AC4 viewable + filters | 52, 60 |
| E6 audit AC5 CSV | 60 |
| E0 refunds AC4 cancel whole order | 29, 59 |
| R22 own device | 21, 22 |
| K-7 permission-based | 32 |

---

## §11. Build order (one task per commit, TDD; platform rows first — README build-order note)

| # | Task | Files | Spec |
|---|---|---|---|
| 0 | Spec bumps with markers: F v1.13, 01b v1.9, 01d v1.2.3, 02b v1.0.7, 03a v1.2.2; README R-1 | `docs/specs/*`, `docs/specs/README.md` | §4.5 |
| P1 | T-1 schema fields + fixtures | `packages/events/src/events/{order,stock}/*` | T-1 |
| P2 | Q-1 `alert_id` on `OrderCancelled` / `OrderFoodCleared` | `packages/events/src/events/order/*` | Q-1 |
| P3 | D-2 `result_also_to` in 01d | `apps/hub/src/alerts/kinds.ts`, `commands/answer-request.ts`, `apps/hub/test/alerts/*` | D-2 |
| P4 | Q-3 line guard in 02b (Comp / Remove / Weight) | `apps/hub/src/orders/line-guard.ts`, `commands/{comp-line,remove-items,set-line-weight}.ts` | Q-3 |
| P5 | B-1 default grants + seed test | `apps/cloud/src/modules/staff-roles/default-roles.ts`, hub seed | B-1 |
| 1 | **Spike** test 0 (stop and report on any failure) | `apps/hub/test/voids/spike.int.test.ts` | §10 #0 |
| 2 | Shared types + errors | `packages/domain/src/{voids,errors}.ts` | §4.4, §9 |
| 3 | `voidDrafts` + §3.2 checks (pure over read rows + state) | `apps/hub/src/voids/plan.ts` | §3.2, §3.3 |
| 4 | `VoidItems` direct path | `apps/hub/src/voids/commands/void-items.ts` | §6.1 |
| 5 | Kind `void_approval` + raise path | `apps/hub/src/voids/kind.ts` | §3.5, §6.1 step 7 |
| 6 | `apply` / `onWithdraw` | `apps/hub/src/voids/kind.ts` | §6.2 |
| 7 | Guards + `pendingVoids` / `hasPendingVoid` | `apps/hub/src/voids/{guards,exports}.ts` | §6.6, §4.2 |
| 8 | `void-preview`, `pending-voids` queries | `apps/hub/src/voids/queries/*` | §6.3, §6.4 |
| 9 | Money tests 40–49 (property test) | `apps/hub/test/voids/money.*.test.ts` | §10 |
| 10 | Permission matrix 32 | `apps/hub/test/voids/permissions.int.test.ts` | §10 |
| 11 | `toAuditEntry`, `AUDIT_ACTIONS`, `registerAuditAction` | `packages/domain/src/audit.ts` | §3.6 |
| 12 | Migration + projection `audit` + boot order | `apps/hub/src/db/migrations/NNNN_audit.sql`, `apps/hub/src/audit/projection.ts`, `lib/boot.ts` | §5 |
| 13 | `audit-log` query | `apps/hub/src/audit/queries.ts` | §6.5 |
| 14 | Client Void sheet, Void all, pending tag | `apps/client/src/features/voids/*` | §8 |
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
| `VoidItems` | `void-item` (approvable) | 2 (+2 direct, + raiseMany) | 400, 403, 404, `ORDER_BILLED`, `ITEM_WRONG_STAGE`, `LINE_WEIGHT_PENDING`, `VOID_PENDING`, `COMP_PENDING`, `VOID_NOT_ALLOWED` |
| `void_approval` apply / onWithdraw | 01d rules (`approve-void` range) | 3 in apply | as §3.2 (refuses the answer) |
| `GET /queries/void-preview` | `void-item` | 2 | 400, 404, `ORDER_BILLED`, `ITEM_WRONG_STAGE`, `LINE_WEIGHT_PENDING`, `VOID_NOT_ALLOWED return_line` |
| `GET /queries/pending-voids` | `take-order` \| `void-item` \| `approve-void` | 1 | 400 |
| `GET /queries/audit-log` | `view-audit-log` | 1 | 400, 403 |
| merge guard / line guard | — | 1 each | `MERGE_BLOCKED_BY_VOID` (02a), `VOID_PENDING` |
| projection `audit` | — | 1 + fold reads | — |

Size: 4 endpoints + 1 kind + 2 guards + 1 projection (≈ 8 items; README budget 10–25 for commands / endpoints, merge floor 5) — kept as its own module because it is a milestone-A row with its own stories and a distinct read model; ~23 build tasks.

### 12.3 Open questions

| # | Question | Proposed |
|---|---|---|
| OQ-1 | Names in `audit_entries` after a rebuild come from the directory of the rebuild (leavers show the id). Acceptable for the pilot? | yes; 06 / 07 can carry names in synced directory history if needed |
| OQ-2 | Default `move-item-to-stock` for Cashier and Order taker (B-1) — without it their voids can never choose "pre-cooked stock" (V3). | grant it (developer proposal; the right adds no money path, V4) |
| OQ-3 | D-2 (01d `result_also_to`) is a small 01d change needed so the reject notice reaches the table holder **and** K-1 stays strict. | approve D-2 |
| OQ-4 | Audit range ≤ 31 days per query, page ≤ 200, CSV ≤ 31 days. | yes |

### 12.4 Deferred until needed

- Override after N minutes (F §4.5 OVERRIDDEN) — owner Q9; revisit after the pilot.
- "VOID?" tag on KDS / Pass while pending — owner Q8.
- Owner-editable void reasons — owner Q4 (R18 when the pilot asks).
- Cloud / remote audit view — **06** (§4.3).
- Resell a served item (D10 stage 5).
- Wastage / staff-meal reports — 05 / 07 / 08 read `disposition`.
- `audit_entries` retention — none until size is measured.

### 12.5 Hostile self-review (v0.1)

- **Races:** dedupe index + in-transaction lock check; comp ↔ void symmetric locks; approve vs withdraw by 01d. Remaining: none found.
- **Idempotency:** D32 on `VoidItems`; 01d answers keyed by `command_id`; folds idempotent by seq.
- **K-1 strict:** every approval draft stamped; the only foreign event type (`AlertClosed` of a stale comp) is made impossible by V8 and asserted (test 30); the holder notice moved into 01d (D-2), outside `apply`.
- **N+1:** fixed statements per endpoint; `pendingVoids` / guards 1 each; audit query 1.
- **Money:** one ledger (02b); property test; recompute on approve.
- **Engine:** order of `ItemMovedToStock` vs `ItemVoided` pinned (T-2); served voids engine no-ops by design.
- **Privacy:** no money on lock screens; contact events never in audit; notes ≤ 200.
- **Over-engineering check:** no void table, no cache, no retention job, no override, no KDS tag, no new event type. `registerAuditAction` kept: 05 needs it for clock-in / bill override (E6 audit AC2), else 04 would edit for 05.
- **Contradictions:** F §4.5 OVERRIDDEN and REJECTED notice text fixed by F-2 / D-1; 01d `line_id` by D-1; 02b Exposes by Q-2; 03b / 03c version claims untouched (K-4).
