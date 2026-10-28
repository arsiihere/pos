# 04 — Voids + Audit: screen inventory

**No spec yet.** Sources: stories E6-LIFE (five stages, D10/D18/D29), E6-PVOID (D11), E6-AUDIT, E0-REF AC4–5 (cancellation of an order), E2-TBL edge (merge blocked by pending void); foundation §4.2 (item lifecycle), §4.5 (void approval), §6.2 (`ITEM_WRONG_STAGE`, `VOID_PENDING`, `REASON_REQUIRED` example); spec 00 §3.6 (requires_approval, approver roles, `approvable` commands). Conventions in [00-index.md](00-index.md).

---

## 1. Who and where
| Who (permission) | Device | How often | Conditions |
|---|---|---|---|
| The person who added an item (remove at stage 1, no approval) | T, P, K | many per rush (customer changes mind) | must be 2 taps |
| `void-item` (stage 2), `move-item-to-stock` (2–3), `mark-item-returned` (4); each may be `requires_approval` from a role | T, K, P | 10–30 per day | customer waiting; reason required |
| `approve-void` (approvers) | manager's phone or tablet (P, T) | when pending; urgent | manager may be on the floor |
| Owner (resell flag; timeout override rule) | owner app or hub (Q1) | once | — |
| `view-audit-log` (owner, manager) | L, T, K | weekly; after an incident | read-only |

## 2. Jobs to be done
| # | Job | Story AC | Acceptance |
|---|---|---|---|
| J1 | As the person who added an item, I need to remove it before cooking starts with no approval. | E6-LIFE stage 1; D18 | removed from kitchen queue at once; reserved stock released |
| J2 | As staff with `void-item`, I need to void a cooking item with a reason so that it goes to ready stock or wastage. | E6-LIFE stage 2; D29 | reason required; stock not returned to pre-cooked pool |
| J3 | As staff with `move-item-to-stock`, I need to move a cooking or cooked item to ready stock so that another order can use it. | E6-LIFE stages 2–3 | item enters ready-stock pool |
| J4 | As staff with `mark-item-returned`, I need to mark a served item returned with a reason (wastage or staff meal). | E6-LIFE stage 4 | reason required |
| J5 | As the owner, I need to allow reselling a served item (off by default). | E6-LIFE stage 5 | owner-enabled flag |
| J6 | As staff whose void needs approval, I need the item shown as PENDING VOID and excluded from the bill. | E6-PVOID AC1 | bill shows label; total excludes it |
| J7 | As an approver, I need an urgent alert and a quick approve/reject with a reason. | E6-PVOID AC2, AC5, AC6 | reason logged; rejected → item back at full price, waiter notified |
| J8 | As a cashier, I need to know a table can't close while a void is pending, and when the override rule allows it. | E6-PVOID AC3, AC4 | timeout override off by default; after N min a manager may close; logged |
| J9 | As staff with permission, I need to cancel a whole order through the same lifecycle. | E0-REF AC4, AC5 | each item by its stage |
| J10 | As the owner, I need an append-only audit log filterable by date, staff and action, exportable to CSV. | E6-AUDIT AC1–5 | who, when (hub clock), action, target, reason, outcome |

## 3. Screen list
| ID | Name | Kind |
|---|---|---|
| 04-S01 | Item actions sheet (actions offered by stage and permission) | sheet from 02-S06 / 05-S03 |
| 04-D01 | Remove item (stage 1) | dialog |
| 04-D02 | Void item — reason + where it goes (ready stock / wastage) | dialog |
| 04-D03 | Move to ready stock | dialog |
| 04-D04 | Mark returned — reason + wastage / staff meal | dialog |
| 04-D05 | Resell a returned item (only when enabled) | dialog |
| 04-C01 | Reason picker (preset reasons + text) | component |
| 04-B01 | "Waiting for approval" line state (PENDING VOID) | inline state on 02-S06, 05-S03, 03b-P05 |
| 04-N01 | Urgent void approval alert (approvers) | notification |
| 04-S02 | Approvals list (pending voids on this branch) | screen |
| 04-D06 | Approve / reject a void (reason required) | dialog |
| 04-N02 | Void rejected / approved notice (to requester) | notification |
| 04-D07 | Close with pending void — override after N min | dialog (05-S10 / 05-S04) |
| 04-D08 | Cancel whole order (per-item outcome summary) | dialog |
| 04-S03 | Audit log (filters, list) | screen |
| 04-S04 | Audit entry detail | sheet |
| 04-D09 | Export audit log to CSV | dialog |
| 04-S05 | Ready stock (items moved to stock, available to reassign) | screen / panel — Q2 |
| 04-S06 | Void and return settings (resell flag, timeout override on/off + minutes, reasons list) | settings (home Q1) |

**Count: 19.**

## 4. Per screen

### 04-S01 Item actions sheet
- **Entry:** tap a line on 02-S06 (or 05-S03 bill). **Shows** only actions valid for the item's **stage** and the user's **permission**:

| Stage (plain word) | Action | Permission | Approval |
|---|---|---|---|
| Waiting (ADDED, even if fired, D29) | Remove | adder only (others: Q3) | never |
| Cooking | Void · Move to ready stock | void-item · move-item-to-stock | if `requires_approval` |
| Ready (COOKED) | Move to ready stock | move-item-to-stock | if `requires_approval` |
| Served | Mark returned · Resell (if enabled) | mark-item-returned · owner flag | if `requires_approval` |
- A `requires_approval` grant shows the action with a "Needs approval" tag (R5). `not_granted`/`denied` → hidden.
- **Errors:** `ITEM_WRONG_STAGE` ("This item just started cooking. Choose again.") → sheet refreshes; `PERMISSION_DENIED`; `VOID_PENDING` (already pending); offline (queue? Q4).

### 04-D02 Void item
Fields: **Why** (04-C01, required, `reason`; presets e.g. Customer changed mind, Wrong item, Cooked wrong, Too late — owner-editable? Q5), **Where it goes** Ready stock / Wastage (required, D29). Buttons Cancel / **Void** (danger) or **Ask for approval** when approval needed. → `VoidItem` *(F)* with command_id. Result: removed from bill, or PENDING (04-B01) + 04-N01 to approvers.

### 04-D04 Mark returned
Why (required) + **Goes to** Wastage / Staff meal. → `ReturnItem` (event `ItemReturned`).

### 04-B01 Pending void line
Line struck through + "Waiting for approval · Imran asked 13:20"; excluded from total; bill print shows "PENDING VOID" (03b-P05). Table close and merge are blocked (`VOID_PENDING`).

### 04-N01 / 04-S02 / 04-D06 Approvals
- N01 urgent: "Void needs approval: T7 Chicken Karahi Full (Rs 2,200) — 'cooked wrong' — Bilal" → tap → D06. Delivered to every `approve-void` holder's open device (in-app; no browser push on HTTP).
- S02 list: pending voids with age ("4 min"), table, item, amount, requester, reason.
- D06: **Approve** / **Reject**, reason required for both ("reason required on every approve or reject" is in the P3 queue story; E6-PVOID AC5/AC6 log a reason) → `ApproveVoid` / `RejectVoid` (proposed). Approver can't approve own request? (Q6). Concurrent: two managers tap at once → second sees "Already approved by Imran".

### 04-D07 Close with pending void (override)
Only when the restaurant's rule is ON and N minutes passed with no approver action: "No one approved the void on T7 for 10 min. Close the bill anyway? This is logged." Permission: manager (which permission? Q7). → OVERRIDDEN.

### 04-D08 Cancel whole order
Summary per item by stage: "Naan ×4 — removed (not started); Karahi — void needs reason (cooking); Lassi ×2 — served: mark returned". One reason for all? (Q8). Order → CANCELLED when all items are voided.

### 04-S03 Audit log
- **Filters:** date range (hub dates, LTR), staff member, action type (item lifecycle, void/refund/comp/discount, roles and permissions, boost, day open/close/reopen, bill override, lock force-release, reprint, clock-in/out (P2), device pair/revoke, PIN lockouts, hub restarts) → list (newest first): time (hub clock), who (name), action (plain words), target (T7 · Chicken Karahi), reason, outcome. Paged (keyset).
- **Read-only**, no edit/delete anywhere (E6-AUDIT AC1). **Export** → 04-D09 CSV (file download; works on HTTP).
- **States:** loading, empty range, no permission (hidden), large range (paging), hub unreachable (00-F01).
- **Where:** hub admin (live branch data) — the cloud copy for multi-branch is 07 (Q9).
- **Sample:** "13:22 · Imran · Approved void · T7 Chicken Karahi Full · cooked wrong · approved"; "13:40 · Bilal · Boost · T7 · —"; "22:15 · Imran · Force-released lock · T3 · Bilal left".

## 5. Flows
1. **Remove before cooking (≤ 3 taps):** 02-S06 → tap Naan ×4 (Waiting) → 04-S01 Remove → 04-D01 → gone; stock released.
2. **Void cooking karahi needing approval:** 02-S06 → Karahi (Cooking) → Void (Needs approval) → 04-D02 reason + Wastage → Ask for approval → line 04-B01 → manager phone 04-N01 → 04-D06 Approve + reason → requester 04-N02 → bill total updates. Unhappy: reject → line back at full price, waiter notified; nobody acts, cashier tries to close → blocked → after N min 04-D07 (if ON).
3. **Merge blocked:** 02-D10 → `VOID_PENDING` → link to 04-S02.
4. **Cancel order:** 02-S06 More → Cancel order → 04-D08.
5. **Owner reviews the week:** 04-S03 filter "Void" + last 7 days → export CSV.

## 6. Data shown
Item stage, actor, timestamps, reasons, approval state (PENDING/APPROVED/REJECTED/OVERRIDDEN), approver role(s) from `approver_role_ids`; audit entries (actor id + name, hub time, action type, target id, reason, outcome).

## 7. Cross-module links
Needs 00 permissions with `requires_approval` and approver roles, 02 orders and lines, 03b KDS stage taps (Start/Done set stages 2/3), 03a reservation/stock release, 01b roles. Gives bill exclusions and close blocks to 05 (pending voids, comps/refunds use the same reason picker), void totals to 07, cancelled tickets to 03b.

## 8. Open questions (owner)
- **Q1** Where are the resell flag and the timeout-override rule set (owner app or hub)? Per branch or restaurant?
- **Q2** Ready stock: where do staff see items moved to stock and reassign them to another order (E6-LIFE stage 3)? Is it the same as pre-cooked stock on the stock page?
- **Q3** Can only the person who added an item remove it at stage 1, or also a manager?
- **Q4** Can a void be requested while the hub is unreachable (queued)?
- **Q5** Fixed reason list, owner-defined list, or free text only?
- **Q6** May an approver approve their own void request?
- **Q7** Which permission closes a table under the timeout override?
- **Q8** Cancel whole order: one reason for all items?
- **Q9** Audit log on the hub only (branch) or also in the owner's cloud view (all branches)?

## 9. Design status
Not designed.

## Story AC → screen IDs
| Story AC | Screens |
|---|---|
| E6-LIFE stage 1 remove | 04-S01, D01 |
| E6-LIFE stage 2 void | 04-D02 |
| E6-LIFE stage 2/3 move to stock | 04-D03, S05 |
| E6-LIFE stage 4 returned | 04-D04 |
| E6-LIFE stage 5 resell | 04-D05, S06 |
| E6-LIFE transitions logged | 04-S03 |
| E6-PVOID AC1 | 04-B01 |
| E6-PVOID AC2 | 04-N01 |
| E6-PVOID AC3 | 04-B01 (block), 05-S10 |
| E6-PVOID AC4 | 04-D07, S06 |
| E6-PVOID AC5, AC6 | 04-D06, N02 |
| E6-AUDIT AC1–5 | 04-S03, S04, D09 |
| E0-REF AC4 (cancel order) | 04-D08 |
| E0-REF AC5 (permissions + logged) | 04-S01, S03 |
| E2-TBL edge (merge blocked) | 02-D10 → 04-S02 |
| E10-CNT AC6 (stage 1 void returns stock) | 04-D01 (stock count updates on 02-B06) |
| E8-SPLIT edge (dispute after split) | 04-S01 from 05-S05 |

**ACs with no screen:** none. (Clock-in/out audit entries are P2.)
