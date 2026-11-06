# 02a Tables — Module Spec

| | |
|---|---|
| Doc type | Module spec (Module mode, 12 sections, README checklist) |
| Version | **v0.1 — DRAFT, first endpoint batch only** (developer, 2026-11-06). Stops after §6 batch 1 for human review (skill rule; README pipeline step 3). §6 batch 2 and §7–§12 are outlines until the review. |
| Module | **02a Tables** — seatings, table state, table lock, table holder and assignment, take-over, handover with acceptance, force move, move / merge / split, bill request, cleaning, call waiter, zones and `zoneOf`, `tableOwners`. **02b Ordering** (separate spec, next) owns orders, Served, returns, comps, zone stock, the device command queue. |
| Depends on | Foundation **v1.9**; 00 **v1.7**; 01a **v2.1**; 01b **v1.5**; 01c v1.1.1 (none read directly); 01d **v1.1.1**; 03a **v1.0** (§4.3 To 02 #2, #6; §3 #12) |
| Read by | 02b (lock, seating, holder), 03a (`tableOwners`), 01d (`table_team`, `zone_order_taker` resolvers), 03b (table names on tickets, current table of an order), 04 (merge guard, holder for rejected-void notice), 05 (seating = the bill's scope, `BillRequested`, `BillClosed` fold), 07 / R25 (holder and handover events) |
| Sources | `docs/stories/02-g0.md` (G0 + owner answers §5.4, 2026-11-06), `stories-refined.md` E2-TBL, E2-HAND (`01d-notifications-teams-refined.md`), `docs/design/inventory/02-ordering-tables.md`, `01d-g0-decisions.md` Z1–Z3, N10, `01d-g1-decisions.md` G1-11, G1-18 |
| Inherits | Shared Standards from **Foundation v1.9 §6** (envelope, errors, hub HTTP, WS, naming, tests, migrations, folders). Not redefined here. |

---

## §1. Header

### 1.1 Stories covered

| Story | ACs in 02a | Notes |
|---|---|---|
| E2-TBL (`stories-refined.md:441`) | AC1 (states; fixed palette, colours as config deferred), AC2–AC3 (lock with name, everywhere), AC4 (assignment, as narrowed by owner Q1/Q2), AC5 (force release), AC6a (keep-alive, D61), AC6b (move), AC7 (merge), AC8 (split = orders to another table) | AC9 (order types) is 02b's |
| E2-HAND (`01d-notifications-teams-refined.md:40`) | AC1–AC6 (request, accept, decline, escalation, force move, record) | Accept kind on 01d |
| E5-DEV | — | 02b |
| R23, R24, R25 (README) | handover needs acceptance; alerts to the table's team; holder and every move recorded | |

### 1.2 In scope

Seating lifecycle and table state; table lock (open, touch, release, force release, `table_locks` tick); holder (who took the order) vs assigned order taker (from setup); take-over by the assigned person; handover request with acceptance (01d accept kind); force move; move, merge, split (batch 2); bill request; cleaning; call waiter (batch 2); zones (data from 01a) and `zoneOf`; `tableOwners` (03a, 01d); table map query and pushes.

### 1.3 Out of scope

Orders, lines, Served, returns, comps, zone stock, takeaway token, device queue (**02b**). Bill, payments, `BillClosed` (**05**; 02a only folds it). Voids and the pending-void state (**04**; 02a only asks a registered guard, §4.1). Pass pick-up identity / wrong-team warning (**deferred**, owner 2026-11-06 round 2, §12.4). Reservations, waitlist (P2). Table canvas / positions (01a S9). Hub-side assignment screen (owner Q1: assignment is set at setup; changes during service only by take-over, handover, force move). Configurable table colours (§12.4).

### 1.4 Decisions log (developer, 2026-11-06)

| # | Decision | Prevents | Source |
|---|---|---|---|
| T1 | **02 is split into 02a Tables and 02b Ordering.** 02a is built first: 02b's submit checks 02a's lock and seating. | One spec of ~35 commands, above the README budget (~30). | README "Spec size budget"; 02-g0 §3 #18 |
| T2 | **A seating is one party at a table**, from `OpenTable` on a free table to `TableCleaned`. `seating_id` (ULID) groups the party's orders; 05 bills a seating; 03a's `follow_up` reads "current seating" from it. | "Current seating" undefined (03a To 02 #3); merged tables with one bill. | 02-g0 §3 #9 |
| T3 | **No separate Seated step.** `OpenTable` on a FREE table writes `TableOpened` (state SEATED) and `TableLocked` in one transaction. | A tap nobody makes in a rush. | inventory Q6; F §4.3 overridden in wording only (§4.5 F-1) |
| T4 | **Two people per table** (owner Q2, 2026-11-06): the **assigned order taker** (from setup, §3.6) and the **holder** (who opened the seating, or took it over). Waiters come from the assigned order taker's team; order-taker alerts go to the holder. No assignment → the holder's team. | Ali's waiters serving Ali's tables even while Bilal took the order; alerts reaching the person who took the order. | owner Q1, Q2 |
| T5 | **Take-over** (owner B): the table's assigned order taker pulls the seating to himself; no acceptance from the holder; always an event. | Ali waiting for Bilal to answer for Ali's own table. | owner B, 2026-11-06 |
| T6 | **Handover** to someone else needs the receiver's acceptance (R23) through a 01d `named` accept kind; **force move** by a holder of `force-release-table-lock` needs none (Q-H3). | Tables dumped on a busy colleague; a table stuck when the holder went home. | R23; 01d-notifications Q-H3, N10 |
| T7 | **The lock is a separate projection** (F §4.3) and stays per session (D51), kept alive by `TouchTableLock` (D61). Holder and lock are independent: a take-over or handover never touches the lock. | Losing a half-built order on the device when the holder changes. | F §4.3 |
| T8 | **`own_tables` scope = seatings whose holder is the person.** | 01b's "tables they open" breaks after a handover. | 02-g0 §3 #8; §4.5 B-3 |
| T9 | **Zones are 01a data** (a floor has 0..n zones; each table in at most one zone). A floor with no zones is one zone; `zoneOf(table)` returns `{ zone_id: null, floor_id }` then. | `zoneOf` with no data (01d G1-11d). | 02-g0 §3 #5; owner 2026-11-06 |
| T10 | **Assignment is 01b data in the staff directory**: per branch, the zones and tables a person is assigned to as order taker. At most one person per zone and per table at a branch; a table assignment wins over its zone's. | Two "assigned" people for one table. | owner Q1 |
| T11 | **Table events live on the `table` stream, `stream_id = table_id`.** An event touching two tables (move, merge, split) is written on the stream of the table that starts it and names both. | One fact, one event (F §6.6). | F §3.5 stream enum |
| T12 | **States are derived** in the `seatings` projection from 02a events plus three folds: `OrderPlaced` (02b) → ORDERED, `ItemServed` (02b writes, 03a schema) → FOOD_ON_TABLE, `BillClosed` (05) → NEEDS_CLEANING. | Writing a state event nobody can keep in sync. | F §4.3 |
| T13 | **Lock scope D39 unchanged:** the lock restricts creating and editing orders only. Bill request, cleaning, Served, call waiter, take-over, handover need only their permission. | A lock holder blocking checkout. | F §4.3 D39 |
| T14 | **Session-end lock release is the tick's**, from `staff_sessions.ended_at` (00 M4), never from a session projection callback. | A lock event written outside a registered tick or command (D44). | F §4.3 D51 (F-2 by 03a) |

---

## §2. Existing architecture that must not change

- **Foundation §4.3:** lock is a projection named `table_locks`; `TABLE_ALREADY_LOCKED` (409) with the locker's name; D39 lock scope; D51 auto-release (session end, `table_lock_ttl_ms`) with `TableLockReleased` written by **02's own tick** (F-2, 03a v1.0); D61 `TouchTableLock` with the 50 s no-write rule and the ≤ 1/min client rate; force release audited; a submit re-acquires a free lock (02b).
- **Foundation §5.7:** sessions per staff on a device; idle TTL per role (01b, Order taker 15 min, Waiter 5 min); `countsAsActivity` (00 M59): every command counts, polled queries never.
- **00 v1.7 §4.2:** `defineCommand`, `defineQuery`, `registerProjection`, `registerTick` (01d §3.5 one-tick rule), `registerCatchUp`, `registerEventAudience`, `StaffDirectory` (`resolve`, `floorsOf`, `leadOf`, `teamOf`), `clock.branchNow()`, `ids.next()`. Commands go through `POST /commands/:name` (F §6.3).
- **01a v2.1:** floors and tables (name, seats, sort order, archive) in snapshot schema 3; `branch_engine_settings.table_lock_ttl_ms` (60 000–3 600 000, default 600 000) is **02's** setting, carried in the snapshot's `engine_settings`; an open order on an **archived** table stays usable (01a §6.5).
- **01b v1.5:** permissions `take-order-anywhere` and `force-release-table-lock` (scopes `branch`, `my_floors`) exist for 02; `my_floors` facts from the staff form; `reports_to` gives teams; scope precedence `branch > my_floors = my_team = my_stations > own_tables`; C8 (scope checks run last, `outside_scope` with ids).
- **01d v1.1.1:** alert and request engine; `defineAlertKind` (§3.5); request `named` answer mode with `receiver_staff_id` (§3.3); step targets `requester_lead` and `from_value` (§3.4); `table_team` and `zone_order_taker` resolvers registered by 02 (§3.4.2; stubbed until then); `apply` / `onWithdraw` read-only, return drafts carrying `alert_id`, no `ids` / `secrets` (AD-91); handover constants 60 s remind / 2 min lead in `ALERT_CONSTANTS` (A14); PIN-bearing commands never queued (H-10).
- **03a v1.0:** `tableOwners(db, table_ids[])` in one statement (To 02 #6); slip target `{ kind: 'person', staff_id }` = 02's receiver; lock state is not `EngineState` (F-2).

---

## §3. Domain rules

### 3.1 Seating and table state

```
             OpenTable (FREE table)
  FREE ──────────────────────────────► SEATED ──OrderPlaced (02b)──► ORDERED
   ▲                                     │                              │ first ItemServed
   │ CleanTable                          │ CleanTable (no orders)       ▼
   │                                     ▼                        FOOD_ON_TABLE
   │                                   FREE                             │ RequestBill
   │                                                                    ▼
 NEEDS_CLEANING ◄──────── BillClosed (05) ─────────────────────── BILL_REQUESTED
                                                                        │ OrderPlaced (new round)
                                                                        └──► ORDERED / FOOD_ON_TABLE
   lock: overlay on SEATED … BILL_REQUESTED (§3.3)
```

- A table has at most one **open seating** (FREE = none). A merged table belongs to another table's seating (§3.8, batch 2).
- `RequestBill` is allowed from ORDERED or FOOD_ON_TABLE (and repeats are no-ops, §6 batch 2). A new round after the bill request moves the seating back (`ORDERED` if nothing of the new order is served yet, else stays FOOD_ON_TABLE) and clears `bill_requested_at`; 05 re-prints.
- `BillClosed` (05) → NEEDS_CLEANING; `CleanTable` → seating closed, table FREE.
- `CleanTable` from SEATED with no order → FREE (party left). From any other state before NEEDS_CLEANING → `409 TABLE_HAS_OPEN_ORDERS` (batch 2).
- FREE is shown green, SEATED blue, ORDERED amber, FOOD_ON_TABLE teal, BILL_REQUESTED purple, NEEDS_CLEANING grey, each **with an icon and a word** (never colour alone); configurable colours are §12.4.

### 3.2 Who may open a table (permission `take-order`, new, §4.5 B-1)

| Situation | Needs | Result |
|---|---|---|
| FREE table | `take-order` (scope `branch`, or `my_floors` containing the table's floor) | New seating, holder = caller, lock = caller's session |
| Open seating, unlocked, holder = caller | `take-order` | Lock |
| Open seating, unlocked, holder ≠ caller | `take-order` **and** `take-order-anywhere` (scope covering the floor) | Lock; **holder unchanged** (adding a round for someone else does not take the table) |
| Locked by another session | — | `409 TABLE_ALREADY_LOCKED { table_id, locked_by_staff_id, locked_by_name }` (force release, §3.3) |
| Locked by caller's own session | `take-order` | Success, no event (idempotent re-entry), lock activity refreshed only by D61 rules |
| Locked by the same staff on **another** session (other device) | — | `409 TABLE_ALREADY_LOCKED` naming the caller; the client offers "Release on the other device" through force release only if the caller holds `force-release-table-lock`, else "Close it on your other device" |
| Archived table or table not at this branch | — | `404 TABLE_NOT_FOUND` |
| Seating in NEEDS_CLEANING | — | `409 TABLE_NEEDS_CLEANING` (clean first) |

The owner case of Q2: table assigned to Ali, Ali away, Bilal opens it → Bilal is holder (row 1). Ali's waiters still get the table's waiter alerts (T4).

### 3.3 Lock

- Held by one **session** (`session_id`, with its `staff_id`, `device_id`). Created by `OpenTable` (or by 02b's submit re-acquire, F §4.3).
- Kept by `TouchTableLock` (D61) and by every 02a / 02b command of the holder that names the table (`last_activity_at`).
- Released by `ReleaseTableLock` (holder leaves the order screen), by `ForceReleaseTableLock` (audited, reason), or by the tick (§3.4).
- Release never discards the device's draft (BUILDING, F §4.4).

### 3.4 Lock tick `table_locks` (registered with `registerTick`, 01d §3.5)

- **In memory** (rebuilt from the `table_locks` table at boot, kept in step by the projection's after-commit hook): `Map<table_id, { session_id, last_activity_at }>` and a `sessionsEnded` flag.
- **`due(now)`** (pure, no statement): any lock with `last_activity_at + ttl ≤ now`, **or** `sessionsEnded` is set. `ttl` = `branchConfig().engine_settings.table_lock_ttl_ms`.
- **`sessionsEnded`** is set after commit of any transaction that wrote `SessionEnded` (00 `authGeneration` bump point, M39) and cleared when a pass runs.
- **`intents(tx, now)`**, its own transaction: (1) one read of locks joined to `staff_sessions` (`ended_at`); (2) for each lock whose session has ended → `TableLockReleased { reason: 'session_expired' }`; else if `now − last_activity_at > ttl` → `reason: 'lock_ttl'`. Fixed statements: 1 read + 1 batch append, whatever the number of locks.
- A table archived in config while locked keeps its lock until released (01a §6.5).

### 3.5 Holder

- Set at seating open (= opener). Changed only by `TakeOverTable`, an accepted handover, `ForceMoveTable` (and kept across move / merge / split, batch 2). Every change is one `TableHolderChanged` event (R25).
- **Waiter team of a seating** (T4) = the reports (01b `teamOf`, direct) of the **team lead**, where team lead = the table's assigned order taker (§3.6) if any and **active at the branch**, else the holder.
- **Alerts:** 03a slip warning, 04 rejected-void notice, handover results, call-waiter replies → the **holder** (`depth: 'owner'`); waiter-directed alerts (03b Ready to serve, Call waiter) → the waiter team (`depth: 'direct'`), see §4.2 `tableOwners` and §4.5 D-1.

### 3.6 Assignment (setup data, owner Q1)

- 01a: `zones` per floor; each table has `zone_id` (nullable). 01b: per staff and branch, `assigned_zone_ids[]`, `assigned_table_ids[]` (§4.5 A-1, B-2).
- **Assigned order taker of a table** = the staff whose `assigned_table_ids` contains it, else the staff whose `assigned_zone_ids` contains its zone, else none. The cloud refuses two people for one zone or one table at a branch (`422 CONFIG_REFERENCE_INVALID { reason: 'already_assigned', staff_id }`, 01b row B-2).
- Assignment shows on the tile ("Ali's table") and enables Ali's take-over. It is never changed on the hub.
- A staff member who is removed or loses `take-order` keeps nothing: `assigned_*` of a person without `take-order` is ignored on the hub (the tile shows no assignee).

### 3.7 Take-over (`TakeOverTable`)

- Caller is the table's assigned order taker (§3.6), holds `take-order`, and is not the holder → `TableHolderChanged { reason: 'take_over' }`. No acceptance (owner B).
- A pending handover request for that seating (§3.8) is withdrawn in the same transaction (01d `WithdrawRequest` path; its `onWithdraw` returns nothing).
- The lock is untouched (T7). If Bilal is still building, Ali sees "Bilal is adding an order" and can take the order once the lock is released.

### 3.8 Handover with acceptance (`RequestTableHandover`, accept kind `table_handover`)

- Sender = the holder (or a holder of `force-release-table-lock`, who may also use force move). Receiver: active at the branch, holds `take-order` (scope covering the floor), ≠ holder.
- One pending handover per seating (01d `dedupe_key = 'table_handover:' + seating_id`); a second → `409 TABLE_HANDOVER_PENDING { alert_id, to_staff_id }`.
- **Kind** (01d §3.5): `family: 'action'`, `subject: 'table'`, request `named` (receiver only, 01d §3.3), `needsPin: 'never'` (accept kinds, 01d A14), steps: 0 → receiver; 60 s → receiver again (remind); 120 s → `requester_lead` (the sender's lead, G0-1). `values_schema: { table_id, seating_id, from_staff_id }`; `details_schema`: table name, guests, orders count, running total from `lineTotalMinor` (no tax, no rounding; E2-HAND AC4; the full bill is 05's).
- **Accept** → `apply` (read-only, returns drafts with `alert_id`): if the seating is still open and its holder is still `from_staff_id` → `TableHolderChanged { reason: 'handover', alert_id }`; otherwise returns no event and 01d closes the request with the stale reason (the client shows "The table changed before you accepted").
- **Decline** → no event in 02a; 01d tells the sender (`request_result`). The table stays with the sender (R23).
- Sender withdraws through 01d's `WithdrawRequest`. Seating closed, holder changed (take-over, force move) or table moved → 02a withdraws it in the same transaction.

### 3.9 Force move (`ForceMoveTable`)

- `force-release-table-lock` with scope covering the floor; `to_staff_id` active at the branch with `take-order`; `reason` required (1–120 chars). → `TableHolderChanged { reason: 'force_move', note }`; pending handover withdrawn. Audited by the event itself (04's audit view reads it).

### 3.10 Move, merge, split, bill request, cleaning, call waiter — batch 2

Rules outlined in §6 batch 2; written after the batch-1 review.

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | `defineCommand`, `defineQuery`, `registerProjection`, `registerTick`, `registerCatchUp`, `registerEventAudience`, `StaffDirectory`, `staff_sessions`, `SessionEnded`, `clock`, `ids` | everything |
| 01a | snapshot `floors[]` with `tables[]`; **`zones[]`** and `tables[].zone_id` (new, A-1); `engine_settings.table_lock_ttl_ms` | map, `zoneOf`, tick |
| 01b | `resolve` (permission + scope), `floorsOf`, `teamOf`, `leadOf`; **`assigned_zone_ids` / `assigned_table_ids`** per branch (new, B-2) | §3.2, §3.5, §3.6 |
| 01d | `defineAlertKind`, `alerts.raise`, `WithdrawRequest`, resolver registration for `table_team` and `zone_order_taker` | §3.8, §4.2 |
| 02b | `OrderPlaced` (with `seating_id`, 02 field, R29), `ItemServed` | state folds (T12) |
| 05 | `BillClosed { seating_id }` | NEEDS_CLEANING |
| 04 | `registerMergeGuard((db, seating_ids) → { blocked: boolean, order_item_ids })` | merge blocked by a pending void (batch 2); **until 04 registers it, merge is never blocked** |

### 4.2 Exposes (later modules may rely only on these)

| Export | Shape | Used by |
|---|---|---|
| `tableOwners(db, table_ids[])` | `Map<table_id, { seating_id, holder_staff_id, team_lead_staff_id }>` for tables with an open seating; **one** SQL statement (03a To 02 #6); `team_lead_staff_id` per §3.5 | 03a (slip receiver = `holder_staff_id`), 01d `table_team` resolver, 03b, 04 |
| `zoneOf(table_id)` | `{ floor_id, zone_id \| null, zone_order_taker_staff_id \| null }` from the snapshot and directory; in memory, no statement | 01d `zone_order_taker` resolver, 02b zone stock |
| `seatingOf(db, table_id)` | `{ seating_id, state, holder_staff_id, table_ids[] } \| null`; one statement | 02b submit, 05 |
| `requireLock(tx, table_id, session_id)` | throws `TABLE_LOCK_NOT_HELD` / re-acquires a free lock (F §4.3) and refreshes `last_activity_at`; returns the `TableLocked` draft when it re-acquired | 02b `SubmitOrder` and edits |
| Events on `table` | `TableOpened`, `TableLocked`, `TableLockTouched`, `TableLockReleased`, `TableHolderChanged` (batch 1); `TableMoved`, `TablesMerged`, `SeatingSplit`, `BillRequested`, `TableCleaned`, alert kind `call_waiter` (batch 2) | 03b, 04, 05, 07 |
| Projections | `seatings`, `table_locks` (read-only for other modules) | 02b, 05 |
| Alert kinds | `table_handover` (batch 1), `call_waiter` (batch 2) | 01d |
| Catch-up part `tables`, query `GET /queries/table-map` (batch 2) | §6 batch 2 | clients |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 02b | Carry `seating_id` on `OrderPlaced` (02 field, R29) and call `requireLock` in `SubmitOrder`; non-table orders have no seating. |
| 03a | Slip receiver = `holder_staff_id` from `tableOwners`; `table_key` stays the order's original `table_id` after a move (batch 2); display maps it through 02a. |
| 03b | Show the **current** table of an order (`TableMoved`, `TablesMerged`); Ready to serve to the waiter team (`table_team`, `depth: 'direct'`). Pass pick-up identity is deferred (owner, §1.3). |
| 04 | Register `registerMergeGuard`; rejected-void notice to the holder (`depth: 'owner'`). |
| 05 | Bill per seating; write `BillClosed { seating_id }`; an order on an archived or moved table is billed with its seating. |
| 01e | Pager route reaches holder and team as 01d resolves them; nothing 02a-specific. |

### 4.4 Shared types

None in batch 1 (event payloads in §6.9 live in `@pos/events`, 02a's files).

### 4.5 Changes to other specs (R26) — **Proposed, needs approval**

| Row | Target | Change |
|---|---|---|
| F-1 | Foundation §4.3 | Wording: the diagram's "order taker opens table (fires `TableLocked`)" and the text's "serialises all `TableOpened` commands" become "serialises all `OpenTable` commands"; FREE → SEATED happens inside `OpenTable` (T3). |
| F-2 | Foundation §4.3 D51 | "5 min default for order takers" → "the role's idle TTL (01b; Order taker 15 min)" (R21). |
| A-1 | 01a | New `zones` (`zone_id`, `floor_id`, `name`, `sort_order`, `archived_at`; unique name per floor) and nullable `tables.zone_id` (same floor; archived zone → tables keep the id, shown without zone); cloud migration `0008_zones.sql`; CRUD under the Floors page (one form, no endpoint beyond `POST/PATCH /v1/admin/branches/:id/zones…`, written in the 01a bump); snapshot schema **4** (`zones[]`, `tables[].zone_id`), breaking before the pilot (R29); sync bound +1 statement (01b's bound row). |
| B-1 | 01b | Permissions `take-order` (group `orders`, scopes `branch`, `my_floors`; default Owner, Manager, Order taker, Cashier) and `clean-table` (group `orders`, scope `branch`; default Owner, Manager, Order taker, Waiter, Cashier), by `default_key` (B17); no backfill (R29 re-seed, as 01b B-2). |
| B-2 | 01b | Staff form "Assigned tables": per branch `assigned_zone_ids[]`, `assigned_table_ids[]`; uniqueness per zone and per table at a branch (§3.6); directory v3 additive fields; cloud migration `0009_assignments.sql`; `StaffDirectory.assignedOrderTaker(table_id)` (in memory). |
| B-3 | 01b §3.3 | `own_tables` = seatings whose holder (02a) is the person (T8); text at 01b:352 ("offered by no permission") corrected: `mark-served` offers it (B-2 of 03a). |
| D-1 | 01d §3.4.2 | `table_team` resolver: `depth: 'owner'` → `holder_staff_id`; `depth: 'direct'` → holder + reports of `team_lead_staff_id` (T4). Additive in the resolver contract (01d calls 02's function); the name `tableOwner` in 01d:721 reads `tableOwners` (batch). |
| D-2 | 01d §4.4 | "Served card" kind moves to 03b (it fires at Handover, 03b's). |
| R-1 | README | Module map: row 02 becomes 02a Tables (this spec, Draft) and 02b Ordering (not started); split recorded as a README decision; carried row "01a §6.5: an order on an archived table stays billable" added. |

---

## §5. Data model (hub SQLite; migration `apps/hub/src/db/migrations/0009_tables.sql`)

```sql
-- seatings: one row per party (T2). Index: by open table (open seating of a table).
CREATE TABLE seatings (
  seating_id        TEXT PRIMARY KEY,
  table_id          TEXT NOT NULL,              -- the table it was opened on (moves update it, batch 2)
  state             TEXT NOT NULL CHECK (state IN
                      ('SEATED','ORDERED','FOOD_ON_TABLE','BILL_REQUESTED','NEEDS_CLEANING','CLOSED')),
  holder_staff_id   TEXT NOT NULL,
  opened_at         INTEGER NOT NULL,           -- recorded_at of TableOpened (ms)
  bill_requested_at INTEGER,
  closed_at         INTEGER,
  merged_into_seating_id TEXT                   -- batch 2
);
CREATE UNIQUE INDEX seatings_open_table ON seatings (table_id) WHERE state <> 'CLOSED' AND merged_into_seating_id IS NULL;
  -- serves: open seating of a table (OpenTable, seatingOf, tableOwners); enforces T2 "one open seating"

-- seating_orders: order → seating (fold of OrderPlaced). Index: served-state fold by order_id.
CREATE TABLE seating_orders (
  order_id   TEXT PRIMARY KEY,
  seating_id TEXT NOT NULL,
  served_any INTEGER NOT NULL DEFAULT 0 CHECK (served_any IN (0,1))
);
CREATE INDEX seating_orders_seating ON seating_orders (seating_id);   -- serves: state of a seating, merge, split

-- table_locks: F §4.3 projection.
CREATE TABLE table_locks (
  table_id          TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL,
  staff_id          TEXT NOT NULL,
  device_id         TEXT NOT NULL,
  locked_at         INTEGER NOT NULL,
  last_activity_at  INTEGER NOT NULL,
  last_touch_written_at INTEGER NOT NULL        -- D61 50 s rule
);
CREATE INDEX table_locks_session ON table_locks (session_id);        -- serves: tick join to staff_sessions; release on session end
```

- Projections `seatings` and `table_locks` registered with `registerProjection` (with `reset`, replayable from `table` events plus the three folds of T12).
- No column on `events`; holder history is the `TableHolderChanged` events (R25), read by 07.
- Times are `recorded_at` (hub clock), never device `occurred_at` (F §3.5).

---

## §6. Commands, events and queries — batch 1 (STOP here for review)

All commands: `POST /commands/:name`, `sessionKind: 'device'`, staff session required, D32 idempotency (stored response on retransmit), PIN never involved. "Scope check last" per C8. `T` = the table from the snapshot (`404 TABLE_NOT_FOUND` if absent or archived).

### 6.1 `OpenTable`

| | |
|---|---|
| Permission | `take-order` (scope `branch` \| `my_floors`); `take-order-anywhere` too when §3.2 row 3 applies |
| Payload | `{ table_id: string, party_size?: int 1–50 \| null }` |
| Script | 1. load `T`; 2. read open seating of `T` and its lock (1 statement); 3. if lock held by this session → respond `{ seating_id, opened: false }`, no event; if held by another session → `409 TABLE_ALREADY_LOCKED`; 4. seating in NEEDS_CLEANING → `409 TABLE_NEEDS_CLEANING`; 5. no seating → drafts `TableOpened { table_id, seating_id: ids.next(), holder_staff_id: actor, party_size }` + `TableLocked`; 6. seating, holder ≠ actor → require `take-order-anywhere`; draft `TableLocked`; 7. scope check (floor of `T` in scope) last → `403 PERMISSION_DENIED { reason: 'outside_scope', table_ids: [T] }` |
| Response | `200 { data: { seating_id, opened: boolean, holder_staff_id } }` |
| Errors | `404 TABLE_NOT_FOUND`, `409 TABLE_ALREADY_LOCKED { table_id, locked_by_staff_id, locked_by_name }`, `409 TABLE_NEEDS_CLEANING`, `403 PERMISSION_DENIED` |
| Events | `TableOpened { table_id, seating_id, holder_staff_id, party_size }`; `TableLocked { table_id, seating_id, session_id, staff_id }` |
| Race | Two waiters on one free table: single writer; the second sees the first's lock at step 2 → `TABLE_ALREADY_LOCKED` (unique index is the backstop). |

### 6.2 `TouchTableLock` (F §4.3 D61, unchanged)

| | |
|---|---|
| Permission | `take-order` |
| Payload | `{ table_id }` |
| Script | 1. read lock; not this session → `409 TABLE_LOCK_NOT_HELD`; 2. `now − last_touch_written_at < 50 000` → `200 { touched: false }`, no event, **but** refresh nothing (no write); 3. draft `TableLockTouched { table_id, session_id }` (fold sets `last_activity_at` and `last_touch_written_at`) |
| Response | `200 { data: { touched: boolean } }` |
| Note | Counts as session activity (command). Step 2 commits nothing, so the stored D32 response is the only write. |

### 6.3 `ReleaseTableLock`

| | |
|---|---|
| Permission | `take-order` |
| Payload | `{ table_id }` |
| Script | 1. read lock; none or another session → `200 { released: false }` (leaving a screen is never an error); 2. draft `TableLockReleased { table_id, session_id, staff_id, reason: 'released' }` |
| Response | `200 { data: { released: boolean } }` |

### 6.4 `ForceReleaseTableLock`

| | |
|---|---|
| Permission | `force-release-table-lock` (scope `branch` \| `my_floors`) |
| Payload | `{ table_id, reason: string 1–120 }` |
| Script | 1. read lock; none → `200 { released: false }`; 2. draft `TableLockReleased { reason: 'force', by_staff_id, note: reason }`; 3. scope check last |
| Errors | `403 PERMISSION_DENIED` |
| Effect | The former holder's device gets the pushed event: banner "Ali released this table"; its draft stays (F §4.3). |

### 6.5 Tick `table_locks` (§3.4)

| | |
|---|---|
| Registration | `registerTick({ name: 'table_locks', due, intents })` |
| Events | `TableLockReleased { table_id, session_id, staff_id, reason: 'session_expired' \| 'lock_ttl' }`, `actor_id = null`, `device_id = 'hub'` |
| Statements per pass | 1 read + 1 append batch |
| Boot | Map rebuilt from `table_locks` (1 statement); `sessionsEnded = true` on boot (sessions may have ended while down). |

### 6.6 `TakeOverTable` (§3.7)

| | |
|---|---|
| Permission | `take-order` |
| Payload | `{ table_id }` |
| Script | 1. read open seating (none → `409 TABLE_NOT_OPEN`); 2. `assignedOrderTaker(T) ≠ actor` → `409 TABLE_NOT_ASSIGNED { assigned_staff_id \| null }`; 3. holder = actor → `200 { changed: false }`; 4. drafts `TableHolderChanged { seating_id, table_id, from_staff_id, to_staff_id: actor, reason: 'take_over', by_staff_id: actor }`; 5. pending `table_handover` alert for the seating → 01d withdraw in the same transaction |
| Response | `200 { data: { changed: boolean } }` |
| Errors | `409 TABLE_NOT_OPEN`, `409 TABLE_NOT_ASSIGNED` |

### 6.7 `RequestTableHandover` (§3.8)

| | |
|---|---|
| Permission | `take-order` (actor must be the holder; else `force-release-table-lock`) |
| Payload | `{ table_id, to_staff_id, note?: string ≤ 120 }` |
| Script | 1. open seating (`409 TABLE_NOT_OPEN`); 2. actor ≠ holder and lacks `force-release-table-lock` → `403 PERMISSION_DENIED { reason: 'not_holder' }`; 3. `to_staff_id` = holder, inactive, not at the branch, or without `take-order` covering the floor → `422 HANDOVER_TARGET_INVALID { reason: 'is_holder' \| 'inactive' \| 'no_permission' \| 'outside_scope' }`; 4. `alerts.raise(tx, { kind: 'table_handover', subject: table, receiver_staff_id: to_staff_id, values, details, dedupeKey })`; an open one → `409 TABLE_HANDOVER_PENDING { alert_id, to_staff_id }` |
| Response | `200 { data: { alert_id } }` — the sender's waiting card is 01d's (AD-1: 02 builds it with its first request kind) |
| Events | 01d's `AlertRaised` (no 02a event until accepted) |
| Accept | kind `apply` per §3.8 → `TableHolderChanged { reason: 'handover', alert_id }` |

### 6.8 `ForceMoveTable` (§3.9)

| | |
|---|---|
| Permission | `force-release-table-lock` (scope `branch` \| `my_floors`) |
| Payload | `{ table_id, to_staff_id, reason: string 1–120 }` |
| Script | 1. open seating (`409 TABLE_NOT_OPEN`); 2. target checks as §6.7 step 3; 3. draft `TableHolderChanged { reason: 'force_move', note }`; 4. withdraw pending handover; 5. scope check last |
| Errors | `409 TABLE_NOT_OPEN`, `422 HANDOVER_TARGET_INVALID`, `403 PERMISSION_DENIED` |

### 6.9 Batch-1 events (on `table`, `stream_id = table_id`, schema_version 1)

| Event | Payload | Fold |
|---|---|---|
| `TableOpened` | `{ table_id, seating_id, holder_staff_id, party_size: int \| null }` | insert seating SEATED |
| `TableLocked` | `{ table_id, seating_id, session_id, staff_id }` (device from envelope) | upsert `table_locks` |
| `TableLockTouched` | `{ table_id, session_id }` | `last_activity_at`, `last_touch_written_at` = `recorded_at` |
| `TableLockReleased` | `{ table_id, session_id, staff_id, reason: 'released' \| 'force' \| 'session_expired' \| 'lock_ttl', by_staff_id?: string, note?: string }` | delete lock row |
| `TableHolderChanged` | `{ table_id, seating_id, from_staff_id, to_staff_id, reason: 'take_over' \| 'handover' \| 'force_move', by_staff_id, alert_id?: string, note?: string }` | `seatings.holder_staff_id` |

Audiences: every staff socket of the branch (the table map shows locks and holders everywhere, E2-TBL AC3).

### 6.10 Batch-1 error codes (proposed for §9)

| Code | Status | `details` | When |
|---|---|---|---|
| `TABLE_NEEDS_CLEANING` | 409 | `{ table_id }` | opening a table whose seating waits for cleaning |
| `TABLE_NOT_OPEN` | 409 | `{ table_id }` | a seating command on a FREE table |
| `TABLE_NOT_ASSIGNED` | 409 | `{ table_id, assigned_staff_id: string \| null }` | take-over by someone not assigned |
| `TABLE_HANDOVER_PENDING` | 409 | `{ table_id, alert_id, to_staff_id }` | a second handover request for the seating |
| `HANDOVER_TARGET_INVALID` | 422 | `{ reason: 'is_holder' \| 'inactive' \| 'no_permission' \| 'outside_scope' }` | bad receiver |

Reused: `TABLE_ALREADY_LOCKED`, `TABLE_LOCK_NOT_HELD`, `TABLE_NOT_FOUND`, `PERMISSION_DENIED`, `VALIDATION_FAILED`.

---

### §6 batch 2 (outline, after review)

`MoveTable` (seating to a FREE table, reason; holder kept; `table_key` stays for 03a), `MergeTables` (seating B into A; "T4 + T5"; 04 guard), `SplitSeating` (chosen whole orders to a new seating on a FREE table), `RequestBill`, `CleanTable` (`TABLE_HAS_OPEN_ORDERS`), `CallWaiter` (kind `call_waiter` → waiter team), `GET /queries/table-map` (floors → zones → tables with state, holder, assignee, lock; fixed statements; `countsAsActivity: false`, M59), catch-up part `tables`, `tableOwners` / `zoneOf` / `seatingOf` / `requireLock` implementations, 01d resolver registration.

## §7–§12 (after review)

§7 cross-cutting (tick cost, boot, log fields), §8 client contract (table map, lock banner, handover waiting card, Requests (n) / Inbox (n) top bar AD-168, Urdu with Latin digits), §9 error catalogue (from §6.10 + batch 2), §10 tests (per command, races: double open, open vs force release, take-over vs accept, accept after close), §11 build order, §12 DoD, open questions, deferred (pass pick-up identity; configurable colours; reservations).

### Open questions for the reviewer (batch 1)

1. §3.2 row 5: same person, second device — refuse (proposed) or move the lock to the new device?
2. §3.5: assigned order taker not signed in today → his waiters still get Ready to serve (proposed, T4), or fall back to the holder's team?
3. §6.2 Touch: keep F §4.3 exactly (proposed), no change.
