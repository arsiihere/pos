# 02a Tables — Module Spec

| | |
|---|---|
| Doc type | Module spec (Module mode, 12 sections, README checklist) |
| Version | **v0.3 — DRAFT, G2 fixed, ready for G4** (developer, 2026-11-06). v0.3 = v0.2 + the G2 completeness fixes (`docs/reviews/02a_v0.2_g2_completeness.md`, 6 MAJOR, 10 MINOR, all closed). v0.2 and v0.1 kept as history. Next: G4 hostile review in a fresh session (pipeline step 4). |
| Module | **02a Tables** — seatings, table state, table lock, holder and assignment, take-over, handover with acceptance, force move, move / merge / split, bill request, cleaning, call waiter, zones and `zoneOf`, `tableOwners`, `tableTeam`. **02b Ordering** (separate spec, next) owns orders, Served, returns, comps, zone stock, takeaway token, the device command queue. |
| Depends on | Foundation **v1.9**; 00 **v1.7**; 01a **v2.1**; 01b **v1.5**; 01d **v1.1.1**; 03a **v1.0** (§4.3 To 02 #2, #6) |
| Read by | 02b (lock, seating, holder), 03a (`tableOwners`), 01d (`table_team`, `zone_order_taker` resolvers), 03b (table names, current table of an order), 04 (merge / split guard, holder for notices), 05 (seating = bill scope, `BillRequested`, `BillClosed` fold), 07 / R25 (holder and move events) |
| Sources | `docs/stories/02-g0.md` (G0 + owner answers §5.4, 2026-11-06), `stories-refined.md` E2-TBL, E2-HAND (`01d-notifications-teams-refined.md`), `docs/design/inventory/02-ordering-tables.md`, `01d-g0-decisions.md` Z1–Z3, N10, `01d-g1-decisions.md` G1-11, G1-18 |
| Inherits | Shared Standards from **Foundation v1.9 §6** (envelope, errors, hub HTTP, WS, naming, tests, migrations, folders). Not redefined here. |

### Changelog

| Version | Change |
|---|---|
| v0.3 | G2 fixes (`02a_v0.2_g2_completeness.md`): #1 handover kind and `alerts.raise` in 01d's exact names; #2 `tableTeam` is the one-statement `table_team` resolver and D-1 reverses AD-51 for this kind; #3 `call_waiter` raised to `{ kind: 'table_team', table_id, depth: 'direct' }`; #4 lock tick `due` = one indexed statement, in-memory map and flag removed; #5 `ItemServed` folded by `stream_id`, cancellation from 02b's `OrderCancelled` (no cross-module writes); #6 new §4.6 carried rows after the split; #7–#16 minor (TABLE_NOT_FOUND new code, permission wording, KDS audience, merge clears bill request, queue row to 02b, no handover on NEEDS_CLEANING, tests 40–44, live-session index, §7, §12.5). |
| v0.2 | Review of batch 1 (developer, 2026-11-06): **R1** same staff on another device → the lock moves to the new session (`TableLocked.replaced_session_id`), no refusal (§3.2, §6.1); **R2** waiter team = reports with a live session of the assigned lead, else of the holder, else the holder alone — the resolver rule of §4.5 D-1, exposed as `tableTeam` (§3.5, §4.2), three tests (§10); **R3** `TouchTableLock` = F §4.3 D61 exactly; **R4** migration numbers are the next free ones at build time (§4.5 A-1, B-2, §5); **R5** snapshot V4 ships in the same release as 03a's V3 (§4.5 A-1). Data model reworked for merge: `seating_tables` replaces `merged_into_seating_id`. §6 batch 2, §7–§12 written. |
| v0.1 | First draft, §1–§5 and §6 batch 1. |

---

## §1. Header

### 1.1 Stories covered

| Story | ACs in 02a | Notes |
|---|---|---|
| E2-TBL (`stories-refined.md:441`) | AC1 (states; fixed palette), AC2–AC3 (lock with name, everywhere), AC4 (assignment, as narrowed by owner Q1/Q2), AC5 (force release), AC6a (keep-alive, D61), AC6b (move with reason), AC7 (merge), AC8 (split) | AC9 (order types) is 02b's |
| E2-HAND (`01d-notifications-teams-refined.md:40`) | AC1–AC6 (request, accept, decline, escalation, force move, record) | Accept kind on 01d |
| R23, R24, R25 (README) | handover needs acceptance; alerts to the table's team; holder and every move recorded | |

### 1.2 In scope

Seating lifecycle and table state; table lock (open, touch, release, force release, `table_locks` tick); holder vs assigned order taker; take-over; handover with acceptance; force move; move, merge, split; bill request; cleaning; call waiter; zones (data from 01a) and `zoneOf`; `tableOwners`, `tableTeam`, `seatingOf`, `requireLock`; table map query, handover candidates query, catch-up part, pushes.

### 1.3 Out of scope

Orders, lines, Served, returns, comps, zone stock, takeaway token, device queue (**02b**). Bill, payments, `BillClosed` (**05**; 02a only folds it). Voids and the pending-void state (**04**; 02a only asks a registered guard, §4.1). Pass pick-up identity / wrong-team warning (**deferred**, owner 2026-11-06 round 2). Reservations, waitlist (P2). Table canvas / positions (01a S9). Hub-side assignment screen (owner Q1). Configurable table colours (§12.4).

### 1.4 Decisions log (developer, 2026-11-06)

| # | Decision | Prevents | Source |
|---|---|---|---|
| T1 | **02 is split into 02a Tables and 02b Ordering.** 02a is built first: 02b's submit checks 02a's lock and seating. | One spec of ~35 commands, above the README budget (~30). | README "Spec size budget"; 02-g0 §3 #18 |
| T2 | **A seating is one party**, from `OpenTable` on a free table to `TableCleaned`. It holds one or more tables (merge). `seating_id` (ULID) groups the party's orders; 05 bills a seating; 03a's `follow_up` reads "current seating" from it. | "Current seating" undefined (03a To 02 #3); merged tables with one bill. | 02-g0 §3 #9 |
| T3 | **No separate Seated step.** `OpenTable` on a FREE table writes `TableOpened` (state SEATED) and `TableLocked` in one transaction. | A tap nobody makes in a rush. | inventory Q6; §4.5 F-1 |
| T4 | **Two people per table** (owner Q2): the **assigned order taker** (setup, §3.6) and the **holder** (who opened the seating or took it over). Waiters come from the assigned order taker's team; order-taker alerts go to the holder. | Ali's waiters serving Ali's tables even while Bilal took the order. | owner Q1, Q2 |
| T5 | **Take-over** (owner B): the table's assigned order taker pulls the seating to himself; no acceptance; always an event. | Ali waiting for Bilal to answer for Ali's own table. | owner B |
| T6 | **Handover** to someone else needs the receiver's acceptance (R23) through a 01d `named` accept kind; **force move** by a holder of `force-release-table-lock` needs none (Q-H3). | Tables dumped on a busy colleague; a table stuck when the holder went home. | R23; Q-H3, N10 |
| T7 | **The lock is a separate projection** (F §4.3), per session (D51), kept alive by `TouchTableLock` (D61, unchanged). Holder and lock are independent: take-over and handover never touch the lock. | Losing a half-built order on the device when the holder changes. | F §4.3 |
| T8 | **`own_tables` = seatings whose holder is the person.** | 01b's "tables they open" breaks after a handover. | 02-g0 §3 #8; §4.5 B-3 |
| T9 | **Zones are 01a data** (a floor has 0..n zones; each table in at most one zone of its floor). A table with no zone counts as its floor's implicit zone (`zone_id: null`). | `zoneOf` with no data (01d G1-11d). | 02-g0 §3 #5 |
| T10 | **Assignment is 01b data in the staff directory**: per branch, the zones and tables a person is assigned to as order taker; at most one person per zone and per table at a branch; a table assignment wins over its zone's. | Two "assigned" people for one table. | owner Q1 |
| T11 | **Table events live on the `table` stream, `stream_id` = the table the command names first** (the seating's primary table, or the moving / merging table as stated per event). Events touching two tables name both. | One fact, one event (F §6.6). | F §3.5 |
| T12 | **States are derived** in the `seatings` projection from 02a events plus three folds: `OrderPlaced` (02b) → ORDERED, `ItemServed` (02b writes, 03a schema) → FOOD_ON_TABLE, `BillClosed` (05) → NEEDS_CLEANING. | A state event nobody keeps in sync. | F §4.3 |
| T13 | **Lock scope D39 unchanged:** the lock restricts creating and editing orders only. Bill request, cleaning, call waiter, take-over, handover need only their permission. | A lock holder blocking checkout. | F §4.3 D39 |
| T14 | **Session-end lock release is the tick's**, from `staff_sessions.ended_at` (00 M4). | A lock event written outside a registered tick or command (D44). | F §4.3 D51 (F-2 by 03a) |
| T15 | **Same staff, new session = the lock moves** (review R1). The PIN proved the person; refusing would lock Ali out of his own table for the TTL when a tablet dies. | Ali stuck for 10 min after a dead tablet. | review 2026-11-06 |
| T16 | **Waiter team counts only people working now** (review R2): reports with a live staff session at the branch, assigned lead first, then holder, then the holder alone. | Ready to serve sent to waiters who are off today; nobody alerted. | review 2026-11-06 |
| T17 | **Moves, merges and splits move whole seatings and whole orders**, never single lines; per-line split is the bill's (05). | Engine line ids moving between orders (03a groups by order). | owner Q3; 02-g0 §4 |

---

## §2. Existing architecture that must not change

- **Foundation §4.3:** lock projection `table_locks`; `TABLE_ALREADY_LOCKED` (409) with the locker's name; D39 lock scope; D51 auto-release (session end, `table_lock_ttl_ms`) with `TableLockReleased` written by **02's own tick** (F-2); D61 `TouchTableLock` exactly as written (session check → `TABLE_LOCK_NOT_HELD`; < 50 s since the last `TableLockTouched` → success without writing; else write); force release audited; a submit re-acquires a free lock (02b).
- **Foundation §4.4:** BUILDING is device-local; a release never loses the draft.
- **Foundation §5.7:** sessions per staff on a device; idle TTL per role (01b; Order taker 15 min, Waiter 5 min); every command counts as activity, polled queries never (00 M59).
- **00 v1.7 §4.2:** `defineCommand`, `defineQuery`, `registerProjection`, `registerTick` (01d §3.5), `registerCatchUp`, `registerEventAudience`, `StaffDirectory` (`resolve`, `floorsOf`, `leadOf`, `teamOf`), `clock.branchNow()`, `ids.next()`; `staff_sessions` (`kind`, `staff_id`, `idle_ttl_ms`, `last_activity_at`, `ended_at`); `POST /commands/:name` (F §6.3).
- **01a v2.1:** floors and tables (name, seats, sort order, archive) in snapshot schema 3; `engine_settings.table_lock_ttl_ms` (60 000–3 600 000, default 600 000) is **02's** setting; an open order on an **archived** table stays usable (01a §6.5).
- **01b v1.5:** permissions `take-order-anywhere`, `force-release-table-lock` (scopes `branch`, `my_floors`); `my_floors` facts; `reports_to` teams; scope precedence `branch > my_floors = my_team = my_stations > own_tables`; C8 (scope checks last, `outside_scope` with ids).
- **01d v1.1.1:** `defineAlertKind` (§3.5); request `named` answer mode (§3.3); step targets `requester_lead`, `raised_target`, resolvers `table_team` and `zone_order_taker` registered by 02 (§3.4.2, stubbed until then); `apply` / `onWithdraw` read-only, return drafts with `alert_id`, no `ids` / `secrets` (AD-91); handover constants 60 s / 2 min (A14); PIN-bearing commands never queued (H-10); the requester's waiting card is built by the first module with a request kind (AD-1).
- **03a v1.0:** `tableOwners(db, table_ids[])` in one statement (To 02 #6); slip target = the holder; lock state is not `EngineState` (F-2); `table_key` = the order's `table_id` at placement.

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
                                                                        └──► ORDERED
   lock: overlay on SEATED … BILL_REQUESTED (§3.3)
```

- A table belongs to at most one **open seating** (FREE = none). A seating has one **primary table** and 0..n **joined tables** (merge, §3.10).
- State of a seating = the fold of its events (T12):
  - SEATED: no order yet.
  - ORDERED / FOOD_ON_TABLE: from `served_any` per non-cancelled order (§5): ORDERED if any order of the seating has `served_any = 0`, else FOOD_ON_TABLE.
  - BILL_REQUESTED: set by `BillRequested`; a later `OrderPlaced` clears it (`bill_requested_at = NULL`) and the state is recomputed; 05 reprints.
  - NEEDS_CLEANING: set by `BillClosed`; nothing but `CleanTable` changes it.
- A fully cancelled order (02b / 04) still counts for the seating until 02b marks it `cancelled` in `seating_orders` (02b row, §4.3).
- Tiles show each state with **an icon and a word** (never colour alone); fixed palette: FREE green, SEATED blue, ORDERED amber, FOOD_ON_TABLE teal, BILL_REQUESTED purple, NEEDS_CLEANING grey; lock = padlock with the locker's name.

### 3.2 Who may open a table (permission `take-order`, new, §4.5 B-1)

| Situation | Needs | Result |
|---|---|---|
| FREE table | `take-order` (scope `branch`, or `my_floors` with the table's floor) | New seating, holder = caller, lock = caller's session |
| Open seating, unlocked, holder = caller | `take-order` | Lock |
| Open seating, unlocked, holder ≠ caller | `take-order` **and** `take-order-anywhere` (scope covering the floor) | Lock; **holder unchanged** |
| Locked by the caller's own session | `take-order` | Success, no event |
| Locked by **the same staff** on another session (other device) | `take-order` (+ `take-order-anywhere` if not holder) | **Lock moves** (T15): `TableLocked { replaced_session_id }`; the old device gets the pushed event → banner "Opened on another device", keeps its draft; a later command from it gets `TABLE_LOCK_NOT_HELD` (or re-acquires on submit if the lock is free again, F §4.3) |
| Locked by another staff | — | `409 TABLE_ALREADY_LOCKED { table_id, locked_by_staff_id, locked_by_name }` |
| Table archived or not in the snapshot | — | `404 TABLE_NOT_FOUND` |
| Seating in NEEDS_CLEANING | — | `409 TABLE_NEEDS_CLEANING` |

Owner case Q2: table assigned to Ali, Ali away, Bilal opens it → Bilal is holder; Ali's working waiters get the waiter alerts (T4, T16).

A joined table (merge) opens its seating: opening T5 of "T4 + T5" locks the seating's **primary** table (one lock per seating, §3.3).

### 3.3 Lock

- One lock per **seating**, stored under the seating's primary table (`table_locks.table_id`). Held by one **session** (`session_id`, `staff_id`, `device_id`).
- Created by `OpenTable` or by 02b's submit re-acquire (`requireLock`, F §4.3).
- Kept by `TouchTableLock` (D61) and by every 02a / 02b command of that session naming the seating's table (`last_activity_at` = `recorded_at`).
- Released by `ReleaseTableLock`, `ForceReleaseTableLock` (reason, audited), the tick (§3.4), or as part of `TableCleaned` / `TablesMerged` (the event that ends or absorbs the seating also ends its lock; the fold deletes the row, stated on the event).
- Moves with the seating (`TableMoved`) and to the same staff's new session (T15).

### 3.4 Lock tick `table_locks` (`registerTick`, 01d §3.5)

- **`due(db, state, now)`** (01d `registerTick` signature): **one indexed statement** — `SELECT 1 FROM table_locks l LEFT JOIN staff_sessions s ON s.session_id = l.session_id WHERE s.ended_at IS NOT NULL OR s.session_id IS NULL OR l.last_activity_at + :ttl <= :now LIMIT 1` (served by `table_locks` PK scan, ≤ ~60 rows, and the `staff_sessions` PK). `ttl` = `branchConfig().engine_settings.table_lock_ttl_ms`. No in-memory map, no flag (G2 #4): 01d allows one indexed statement in `due`.
- **`intents(tx, state, now)`**: one read of locks left-joined to `staff_sessions`; each lock whose session has ended (or no longer exists) → `TableLockReleased { reason: 'session_expired' }`; else `now − last_activity_at > ttl` → `reason: 'lock_ttl'`. 1 read + 1 append batch per pass.
- A table archived while locked keeps its lock until released (01a §6.5).

### 3.5 Holder and waiter team

- Holder is set at seating open (the opener) and changes only through `TableHolderChanged` (take-over, accepted handover, force move). Move, merge, split keep it (§3.10–§3.12).
- **Alerts to the holder** (`depth: 'owner'`): 03a slip warning, 04 rejected-void notice, handover results, 02b order-taker notices.
- **Waiter team** (T16, the resolver rule of §4.5 D-1), for a table's seating at time `now`:
  1. `A` = the table's assigned order taker (§3.6). If `A` exists: `W` = `A`'s direct reports (01b `teamOf`, direct) **with a live staff session**. If `W` is not empty → team = `W`, `source: 'assigned'`.
  2. Else `W` = the holder's direct reports with a live staff session. Not empty → team = `W`, `source: 'holder'`.
  3. Else team = `[holder]`, `source: 'holder_only'`.
- **Live staff session** = a `staff_sessions` row with `kind = 'staff'`, `ended_at IS NULL` and `last_activity_at + idle_ttl_ms > now` (a session the sweeper has not ended yet but is past its TTL does not count). Read through `staff_sessions_staff_activity` (00 §5.1, v1.6; columns confirmed at build).
- Waiter-directed alerts (03b Ready to serve, `call_waiter`) go to the team (`depth: 'direct'`) only; the order taker who sent a `call_waiter` sees it as his own sent alert (01d requester view).

### 3.6 Assignment (setup data, owner Q1)

- 01a: `zones` per floor; each table has `zone_id` (nullable, same floor). 01b: per staff and branch, `assigned_zone_ids[]`, `assigned_table_ids[]` (§4.5 A-1, B-2).
- **Assigned order taker of a table** = the staff whose `assigned_table_ids` contains it, else whose `assigned_zone_ids` contains its zone, else none. The cloud refuses two people for one zone or one table at a branch (`422 CONFIG_REFERENCE_INVALID { reason: 'already_assigned', staff_id }`, row B-2).
- Only staff holding `take-order` at the branch count as assigned (the hub ignores `assigned_*` of anyone else; the tile then shows no assignee).
- Assignment shows on the tile ("Ali's table"), enables Ali's take-over, and sets the waiter team. It is never changed on the hub.

### 3.7 Take-over (`TakeOverTable`)

- Caller is the table's assigned order taker, holds `take-order`, is not the holder → `TableHolderChanged { reason: 'take_over' }`. No acceptance (owner B).
- A pending handover for the seating is withdrawn in the same transaction (§3.9).
- The lock is untouched (T7): if Bilal is still building, Ali sees "Bilal is adding an order".

### 3.8 Handover with acceptance (`RequestTableHandover`, kind `table_handover`)

- Sender = the holder (or a holder of `force-release-table-lock`). Receiver: holds `take-order` with scope covering the floor, active in the directory, has a live staff session, ≠ holder.
- One pending handover per seating (`dedupe_key = 'table_handover:' + seating_id`; `alerts.raise` returns `deduped: true` → 02a answers `409 TABLE_HANDOVER_PENDING`). A seating in NEEDS_CLEANING cannot be handed over (`409 TABLE_NEEDS_CLEANING`).
- Kind (01d §3.5): `family: 'action'`, `subject: 'table'`, request `named` (receiver only), `needs_pin: 'never'`, steps: 0 → receiver; 60 000 → receiver (remind); 120 000 → `requester_lead`. `values_schema: { table_id, seating_id, from_staff_id }`; `details_schema`: table name(s), party size, order count, running total from `lineTotalMinor` (no tax, no rounding; the full bill is 05's).
- **Accept** → `apply(ctx & { alert }, answer)` (read-only, 01d §3.5): seating still open, **not** NEEDS_CLEANING, and holder still `alert.values.from_staff_id` → `TableHolderChanged { reason: 'handover', alert_id, to_staff_id: alert.receiver_staff_id }`; else no event, the request closes stale ("The table changed before you accepted").
- **Decline** → no 02a event; the table stays (R23).
- Withdrawn by the sender (01d `WithdrawRequest`), or by 02a in the same transaction when the seating closes, is merged away, changes holder, or moves.

### 3.9 Withdrawing a pending handover

`withdrawHandover(tx, seating_id)` (internal): finds the open `table_handover` alert by its dedupe key (1 statement) and calls 01d's withdraw path, whose `onWithdraw` returns no draft. Used by §3.7, §3.10–§3.13.

### 3.10 Move (`MoveTable`)

- The whole seating (all its tables? no: only a seating with **one** table moves; a merged seating → `409 TABLE_MERGED`, split it first) goes to a FREE table of the branch; holder, orders, lock (if held by the caller) move with it; reason optional (1–120), E2-TBL AC6b.
- Allowed to the holder with `take-order`, or to `force-release-table-lock`. Locked by another session → `409 TABLE_ALREADY_LOCKED`.
- 03a keeps `table_key` = the original `table_id` (engine grouping is untouched); 03b and the table map show the current table through `currentTableOf(order)` (§4.2).

### 3.11 Merge (`MergeTables`)

- `MergeTables { into_table_id, table_id }`:
  - `table_id` FREE → it **joins** the seating of `into_table_id` (party grows); no orders move.
  - `table_id` with its own open seating → that seating is **absorbed**: its orders move to the `into` seating, its tables join, its lock ends, its pending handover is withdrawn, the absorbed seating closes with `merged_into`. The `into` holder stays holder.
- Guard: 04's `mergeGuard(db, [into, absorbed])` → `409 MERGE_BLOCKED_BY_VOID { order_item_ids }` (a pending void, E2-TBL AC7). Until 04 registers it, merge is never blocked.
- Either side in NEEDS_CLEANING → `409 TABLE_NEEDS_CLEANING`. Any table of either side locked by a session other than the caller's → `409 TABLE_ALREADY_LOCKED`.
- Allowed to the holder of `into` with `take-order` **and**, when absorbing, `take-order-anywhere` if he is not the absorbed seating's holder; or to `force-release-table-lock`.
- Tile: "T4 + T5" on every joined table (primary name first). State = recomputed over all orders.

### 3.12 Split (`SplitSeating`)

- `SplitSeating { from_table_id, to_table_id, order_ids[] }` moves **whole orders** (T17) of the seating to a new seating on `to_table_id`, where `to_table_id` is FREE, or a **joined** table of the same seating (it detaches: unmerge).
- `order_ids` may be empty only when detaching a joined table. All orders → `422 SPLIT_INVALID { reason: 'all_orders' }` (use Move). An order not in the seating → `422 SPLIT_INVALID { reason: 'not_in_seating', order_ids }`. 04 guard on the moved orders (`MERGE_BLOCKED_BY_VOID`).
- The new seating's holder = the old holder; state recomputed for both; the lock stays on the old seating.
- Allowed to the holder with `take-order`, or `force-release-table-lock`.

### 3.13 Bill request, cleaning, call waiter

- **`RequestBill`** (`take-order`, no lock, D39): ORDERED or FOOD_ON_TABLE → `BillRequested`; already BILL_REQUESTED → `200 { requested: false }`; SEATED → `409 TABLE_NO_ORDERS`; NEEDS_CLEANING → `409 TABLE_NEEDS_CLEANING`. 05 opens the bill from the event.
- **`CleanTable`** (`clean-table`, new): NEEDS_CLEANING → `TableCleaned { reason: 'cleaned' }`; SEATED with no order → `TableCleaned { reason: 'left_without_order' }`; otherwise `409 TABLE_HAS_OPEN_ORDERS { order_count }`. The event closes the seating, frees every table of it, ends its lock and withdraws a pending handover.
- **`CallWaiter`** (`take-order`): raises kind `call_waiter` for the seating to its waiter team (§3.5); one open call per seating (`dedupe_key = 'call_waiter:' + seating_id`): a repeat returns the open alert `{ alert_id, repeated: true }` and sends nothing new. Closes when any recipient marks it seen (`closes_on: 'seen'`), or at day close.

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | `defineCommand`, `defineQuery`, `registerProjection`, `registerTick`, `registerCatchUp`, `registerEventAudience`, `StaffDirectory`, `staff_sessions`, `SessionEnded`, `clock`, `ids` | everything |
| 01a | snapshot `floors[]` with `tables[]`; **`zones[]`**, `tables[].zone_id` (new, A-1); `engine_settings.table_lock_ttl_ms` | map, `zoneOf`, tick |
| 01b | `resolve`, `floorsOf`, `teamOf`; **`assigned_zone_ids`, `assigned_table_ids`** per branch (new, B-2) | §3.2, §3.5, §3.6 |
| 01d | `defineAlertKind`, `alerts.raise`, withdraw path, resolver registration (`table_team`, `zone_order_taker`) | §3.8, §3.13, §4.2 |
| 02b | `OrderPlaced` with `seating_id` (02 field, R29); `ItemServed` (stream `order` / `order_id`, 03a §4.2); **`OrderCancelled { order_id }`** (02b's event, written when every line of an order is removed or voided; 02-g0 §3 #12) | state folds (T12) |
| 05 | `BillClosed { seating_id }` | NEEDS_CLEANING |
| 04 | `registerMergeGuard((db, { seating_ids, order_ids? }) → { blocked: boolean, order_item_ids: string[] })` | merge, split; **unregistered → never blocked** |

### 4.2 Exposes (later modules may rely only on these)

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `tableOwners(db, table_ids[])` | `Map<table_id, { seating_id, primary_table_id, holder_staff_id, assigned_staff_id \| null }>` for tables with an open seating (joined tables included) | 1 | 03a (slip receiver = `holder_staff_id`), 04 |
| `tableTeam` = the 01d `table_team` resolver `fn(tx, targets[])` (01d §4.2 `registerTargetResolver`) | targets `{ kind: 'table_team', table_id, depth?: 'owner' \| 'direct' }` → `Map<targetKey(target), { staff_ids, device_ids: [] }>`: `owner` → `[holder]`; `direct` → §3.5 waiter team; `now` = `clock.branchNow()` | **1** (`UNION ALL` of: open seatings of the targets' tables; the branch's live staff sessions) | 01d (raised targets and step targets), 03b |
| `zoneOf(table_id)` | `{ floor_id, zone_id \| null, zone_order_taker_staff_id \| null }` (assigned order taker of the zone) | 0 (snapshot + directory in memory) | 01d `zone_order_taker`, 02b zone stock |
| `seatingOf(db, table_id)` | `{ seating_id, primary_table_id, table_ids[], state, holder_staff_id } \| null` | 1 | 02b, 05 |
| `currentTableOf(db, order_ids[])` | `Map<order_id, { seating_id, primary_table_id, table_ids[] }>` | 1 | 03b, 05 |
| `requireLock(tx, table_id, actor)` | ensures the actor's session holds the seating's lock: held → refresh activity; free → returns a `TableLocked` draft (re-acquire, F §4.3); same staff other session → `TableLocked { replaced_session_id }` (T15); other staff → throws `TABLE_ALREADY_LOCKED` | 1 | 02b `SubmitOrder` and order edits |
| Events on `table` | `TableOpened`, `TableLocked`, `TableLockTouched`, `TableLockReleased`, `TableHolderChanged`, `TableMoved`, `TablesMerged`, `SeatingSplit`, `BillRequested`, `TableCleaned` (§6.20) | — | 03b, 04, 05, 07 |
| Projections (read-only for others) | `seatings`, `seating_tables`, `seating_orders`, `table_locks` | — | 02b, 05 |
| Alert kinds | `table_handover`, `call_waiter` | — | 01d |
| Catch-up part `tables`; queries `table-map`, `handover-candidates` | §6.18, §6.19 | — | clients |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 02b | `OrderPlaced` carries `seating_id` (02 field, R29); `SubmitOrder` calls `requireLock`; non-table orders have no seating; 02b writes **`OrderCancelled { order_id }`** when an order has no live line left (02a folds it; 02b never writes 02a tables); 02b's device queue **accepts 02a's `RequestBill`, `CleanTable`, `CallWaiter`** (§8 offline); every other 02a command is never queued. |
| 03a | Slip receiver = `tableOwners(...).holder_staff_id` (03a To 02 #6, unchanged in shape except added fields). `table_key` stays the original `table_id` after a move or merge. |
| 03b | Ticket and KDS show the current table (`currentTableOf`) and "T4 + T5"; Ready to serve uses the `table_team` resolver (`depth: 'direct'`). |
| 04 | Register `registerMergeGuard`; rejected-void notice → the holder. |
| 05 | Bill per seating; write `BillClosed { seating_id }`; a bill covers the seating's orders after merges and splits (`seating_orders`); whether `BillRequested` alerts the cashier is 05's decision (OQ1). |

### 4.4 Shared types

Event payload schemas (§6.20) in `@pos/events/src/tables/*.ts` (02a's files); `TableState` enum in `@pos/domain`.

### 4.5 Changes to other specs (R26) — **Proposed, needs approval**

| Row | Target | Change |
|---|---|---|
| F-1 | Foundation §4.3 | Wording: "order taker opens table (fires `TableLocked`)" and "serialises all `TableOpened` commands" → "serialises all `OpenTable` commands"; FREE → SEATED happens inside `OpenTable` (T3); a lock moves to the same staff's new session (T15). |
| F-2 | Foundation §4.3 D51 | "5 min default for order takers" → "the role's idle TTL (01b; Order taker 15 min)" (R21). |
| F-3 | Foundation §6.2 | Append the §9 codes (no bump needed, CLAUDE.md). |
| A-1 | 01a | New `zones` (`zone_id`, `branch_id`, `floor_id`, `name` 1–40, `sort_order`, `archived_at`; unique active name per floor) and nullable `tables.zone_id` (same floor; archiving a zone sets its tables' `zone_id` to NULL in the same transaction); cloud migration `NNNN_zones.sql` with **the next free migration number at build time** (03a's build takes cloud 0007–0008); routes `POST /v1/admin/branches/:branch_id/zones`, `PATCH …/zones/:zone_id` (C1–C9; written in the 01a bump); **snapshot schema 4** (`zones[]`, `tables[].zone_id`), breaking: **ships in the same release as 03a's V3, before the pilot (R29); fixtures move V3 → V4 once**; sync bound +1 statement. |
| B-1 | 01b | Permissions `take-order` (group `orders`, scopes `branch`, `my_floors`; default Owner, Manager, Order taker, Cashier) and `clean-table` (group `orders`, scope `branch`; default Owner, Manager, Order taker, Waiter, Cashier), by `default_key` (B17); no backfill (R29 re-seed). |
| B-2 | 01b | Staff form "Assigned tables": per branch `assigned_zone_ids[]`, `assigned_table_ids[]`; at most one person per zone and per table (`422 CONFIG_REFERENCE_INVALID { reason: 'already_assigned', staff_id }`); directory v3 additive fields; `StaffDirectory.assignedOrderTaker(table_id)` (in memory, §3.6 rule); cloud migration `NNNN_assignments.sql`, **next free number at build time**. |
| B-3 | 01b §3.3 | `own_tables` = seatings whose 02a holder is the person (T8); the text at 01b:352 ("offered by no permission") corrected (`mark-served` offers it). |
| D-1 | 01d §3.4.2, §4.2 | `table_team` resolver = 02a `tableTeam` (one statement): `depth: 'owner'` → `[holder]`; `depth: 'direct'` (default) → the §3.5 waiter team (assigned lead's reports with a live session → holder's reports with a live session → the holder alone). **01d uses the resolver's `staff_ids` as the full set for `table_team` and no longer adds direct reports itself (AD-51 reversed for this kind)**, otherwise the holder's reports would be added on top (owner Q2). 01d:721's `tableOwner` reads `tableOwners` (batch). |
| D-2 | 01d §4.4 | "Served card" kind moves to 03b (fires at Handover). |
| R-1 | README | Module map: row 02 → 02a Tables (this spec) + 02b Ordering; split recorded as a README decision (T1); carried row "01a §6.5: an order on an archived table stays billable" added (02b, 05). |

---

### 4.6 Carried rows "To 02" after the split (README:160–228)

| README row | Owner | Where |
|---|---|---|
| :160 queued commands of an ended session (00 M19, MQ6) | 02b | owner Q8: sent automatically in the original staff's name (02-g0 §5.4) |
| :161 Capacitor LAN transport (MQ7) | 02b (with 9b) | — |
| :173 pair-page resume on non-KDS screens (00 N3) | **02a** | §8 "Login" |
| :174 polled queries never `countsAsActivity` (M59) | 02a + 02b | §6.18, §6.19 (`false`) |
| :176 client stack (one `apps/client`, ui-kit, closed deps, `ship-client.sh`) | 02a + 02b | §8 (02a's screens join 01d's `staff` entry) |
| :177 UI from effective permissions (R5), no service worker except kiosk, no secure-context APIs, ULIDs from `crypto.getRandomValues`, phone pairing note (R14, R15) | 02a + 02b | §8 |
| :178–179, 01a §4.4 rows, :198–202 (01c) | 02b | — |
| :183 default grants by `default_key` | **02a** | §4.5 B-1 |
| :184 Order taker ≠ Waiter grants | **02a** | §4.5 B-1 (`take-order` not on Waiter; `clean-table` on Waiter) |
| :190 handover with acceptance (R23) | **02a** | §3.8, §6.7, §6.15 |
| :212 one stale-save pattern | none | 02a has no versioned form (assignment is edited in 01b's staff form) |
| :216 01d To 02: `tableOwner` / `zoneOf`, handover kind, Call waiter, Served card, no catch-all `order` audience, comp tiers | **02a**: resolvers (§6.16), handover (§6.15), Call waiter (§6.14); Served card → 03b (D-2); `order` audience and comp → 02b | — |
| :218 comp approval kind | 02b (with 05) | — |
| :220 01d data gaps (test-alert lists, approver name, sender, brand block) | 02b / 01e | — |
| :228 03a To 02 #2 (lock tick), #6 (`tableOwners`) | **02a** | §6.5, §4.2 |
| :228 03a To 02 #1, #3–#5, #7–#9 | 02b (`follow_up` reads 02a's seating) | — |
| 01a v2.1 §6.5 archived table stays billable | 02a + 02b + 05 | §3.4, test 39; README row in §4.5 R-1 |


## §5. Data model (hub SQLite)

Migration `apps/hub/src/db/migrations/NNNN_tables.sql`, **the next free migration number at build time** (03a's build takes hub 0007–0009).

```sql
-- seatings: one row per party (T2).
CREATE TABLE seatings (
  seating_id        TEXT PRIMARY KEY,
  primary_table_id  TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN
                      ('SEATED','ORDERED','FOOD_ON_TABLE','BILL_REQUESTED','NEEDS_CLEANING','CLOSED')),
  holder_staff_id   TEXT NOT NULL,
  party_size        INTEGER,
  opened_at         INTEGER NOT NULL,           -- recorded_at of TableOpened
  bill_requested_at INTEGER,
  closed_at         INTEGER,
  close_reason      TEXT CHECK (close_reason IN ('cleaned','left_without_order','merged')),
  merged_into_seating_id TEXT
);
CREATE INDEX seatings_open ON seatings (state) WHERE state <> 'CLOSED';
  -- serves: table-map and catch-up (all open seatings)

-- seating_tables: which tables an OPEN seating holds (primary + joined). Row deleted when the seating closes.
CREATE TABLE seating_tables (
  table_id   TEXT PRIMARY KEY,                  -- one open seating per table (T2), enforced
  seating_id TEXT NOT NULL,
  joined_at  INTEGER NOT NULL
);
CREATE INDEX seating_tables_seating ON seating_tables (seating_id);  -- serves: tables of a seating (merge, split, close)

-- seating_orders: order → seating (fold of OrderPlaced, moved by merge / split).
CREATE TABLE seating_orders (
  order_id   TEXT PRIMARY KEY,
  seating_id TEXT NOT NULL,
  served_any INTEGER NOT NULL DEFAULT 0 CHECK (served_any IN (0,1)),
  cancelled  INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0,1))   -- fold of 02b's OrderCancelled
);
CREATE INDEX seating_orders_seating ON seating_orders (seating_id);  -- serves: seating state, merge, split, table-map counts

-- table_locks: F §4.3 projection; one lock per seating, keyed by its primary table.
CREATE TABLE table_locks (
  table_id              TEXT PRIMARY KEY,
  seating_id            TEXT NOT NULL,
  session_id            TEXT NOT NULL,
  staff_id              TEXT NOT NULL,
  device_id             TEXT NOT NULL,
  locked_at             INTEGER NOT NULL,
  last_activity_at      INTEGER NOT NULL,
  last_touch_written_at INTEGER NOT NULL      -- D61 50 s rule
);
CREATE INDEX table_locks_session ON table_locks (session_id);        -- serves: tick join to staff_sessions
```

- Projections `seatings` (writes `seatings`, `seating_tables`, `seating_orders`) and `table_locks`, both with `reset` (rebuilt from `table` events plus `OrderPlaced`, `ItemServed`, `OrderCancelled`, `BillClosed`). Only 02a writes these tables (G2 #5).
- `ItemServed` is on stream `order` / `order_id` (03a §4.2): the fold sets `served_any = 1` for `stream_id`, no lookup.
- No column on `events`; holder history = `TableHolderChanged` (R25), read by 07.
- Times are `recorded_at` (hub clock).

---

## §6. Commands, events and queries

All commands: `POST /commands/:name`, `sessionKind: 'device'`, staff session, D32 idempotency, no PIN. Scope checks run last (C8) and cover every table the command names (`403 PERMISSION_DENIED { reason: 'outside_scope', table_ids }`). `T` = a table from the snapshot (`404 TABLE_NOT_FOUND` if absent or archived). "Open seating" = via `seating_tables` (`409 TABLE_NOT_OPEN` if none).

### Batch 1 (reviewed 2026-11-06)

#### 6.1 `OpenTable`

| | |
|---|---|
| Permission | `take-order` (`branch` \| `my_floors`); `take-order-anywhere` when the seating's holder ≠ caller |
| Payload | `{ table_id, party_size?: int 1–50 \| null }` |
| Script | 1. load `T`; 2. read open seating of `T` and its lock (1 statement); 3. NEEDS_CLEANING → `409 TABLE_NEEDS_CLEANING`; 4. lock by this session → `200 { opened: false }`, no event; lock by another staff → `409 TABLE_ALREADY_LOCKED`; 5. no seating → `TableOpened { seating_id: ids.next(), holder_staff_id: actor }` + `TableLocked`; 6. seating, holder ≠ actor → require `take-order-anywhere`; 7. seating, no lock → `TableLocked`; lock by the same staff on another session → `TableLocked { replaced_session_id }` (T15); 8. scope check last |
| Response | `200 { data: { seating_id, primary_table_id, opened: boolean, holder_staff_id } }` |
| Errors | `404 TABLE_NOT_FOUND`, `409 TABLE_NEEDS_CLEANING`, `409 TABLE_ALREADY_LOCKED { table_id, locked_by_staff_id, locked_by_name }`, `403 PERMISSION_DENIED` |
| Race | Two staff on one free table: single writer; the second sees the first's seating and lock at step 2 → `TABLE_ALREADY_LOCKED`; `seating_tables` PK is the backstop. |

#### 6.2 `TouchTableLock` — Foundation §4.3 D61 exactly

| | |
|---|---|
| Permission | `take-order` |
| Payload | `{ table_id }` |
| Script | 1. lock of the seating not held by this session → `409 TABLE_LOCK_NOT_HELD`; 2. last `TableLockTouched` < 50 000 ms ago → `200 { touched: false }`, no event; 3. `TableLockTouched { table_id, session_id }` |
| Response | `200 { data: { touched: boolean } }` |

#### 6.3 `ReleaseTableLock`

| | |
|---|---|
| Permission | `take-order` |
| Payload | `{ table_id }` |
| Script | lock not held by this session → `200 { released: false }`; else `TableLockReleased { reason: 'released' }` |

#### 6.4 `ForceReleaseTableLock`

| | |
|---|---|
| Permission | `force-release-table-lock` (`branch` \| `my_floors`) |
| Payload | `{ table_id, reason: string 1–120 }` |
| Script | no lock → `200 { released: false }`; else `TableLockReleased { reason: 'force', by_staff_id, note }`; scope check last |

#### 6.5 Tick `table_locks` (§3.4)

`registerTick({ name: 'table_locks', due, intents })` (§3.4); `TableLockReleased { reason: 'session_expired' | 'lock_ttl' }`, `actor_id = null`, `device_id = 'hub'`; idle = 1 indexed statement, a pass = 1 read + 1 append; nothing at boot.

#### 6.6 `TakeOverTable` (§3.7)

| | |
|---|---|
| Permission | `take-order` |
| Payload | `{ table_id }` |
| Script | 1. open seating; 2. `assignedOrderTaker(T) ≠ actor` → `409 TABLE_NOT_ASSIGNED { assigned_staff_id \| null }`; 3. holder = actor → `200 { changed: false }`; 4. `TableHolderChanged { reason: 'take_over' }`; 5. `withdrawHandover` |
| Errors | `409 TABLE_NOT_OPEN`, `409 TABLE_NOT_ASSIGNED` |

#### 6.7 `RequestTableHandover` (§3.8)

| | |
|---|---|
| Permission | `permission: 'take-order'` (registry). In the handler: the caller is the holder, **or** also holds `force-release-table-lock` (scope covering the floor) — default grants give managers both (G2 #8) |
| Payload | `{ table_id, to_staff_id, note?: string ≤ 120 }` |
| Script | 1. open seating; NEEDS_CLEANING → `409 TABLE_NEEDS_CLEANING`; 2. actor ≠ holder without `force-release-table-lock` → `403 PERMISSION_DENIED { reason: 'not_holder' }`; 3. receiver checks → `422 HANDOVER_TARGET_INVALID { reason: 'is_holder' \| 'inactive' \| 'not_working' \| 'no_permission' \| 'outside_scope' }`; 4. `alerts.raise(ctx, { kind: 'table_handover', subject: { stream_type: 'table', stream_id: primary_table_id }, target: { kind: 'person', staff_id: to_staff_id }, values: { table_id, seating_id, from_staff_id: holder }, display, details, dedupe_key: 'table_handover:' + seating_id, requester_staff_id: actor, request: { receiver_staff_id: to_staff_id } })`; result `deduped: true` → `409 TABLE_HANDOVER_PENDING { alert_id, to_staff_id }` (01d §4.2) |
| Response | `200 { data: { alert_id } }`; the sender's waiting card is 02a's (01d AD-1) |
| Accept | `apply` → `TableHolderChanged { reason: 'handover', alert_id }` or stale (§3.8) |

#### 6.8 `ForceMoveTable` (T6; Q-H3)

| | |
|---|---|
| Permission | `force-release-table-lock` (`branch` \| `my_floors`) |
| Payload | `{ table_id, to_staff_id, reason: string 1–120 }` |
| Script | 1. open seating; 2. receiver checks (§6.7 step 3); 3. `TableHolderChanged { reason: 'force_move', note }`; 4. `withdrawHandover`; 5. scope check last |

### Batch 2

#### 6.9 `MoveTable` (§3.10)

| | |
|---|---|
| Permission | `permission: 'take-order'` (registry). In the handler: the caller is the holder, **or** also holds `force-release-table-lock` (scope covering the floor) — default grants give managers both (G2 #8) |
| Payload | `{ from_table_id, to_table_id, reason?: string 1–120 }` |
| Script | 1. open seating of `from` (`TABLE_NOT_OPEN`); 2. seating has > 1 table → `409 TABLE_MERGED { seating_id, table_ids }`; 3. `to` has a seating → `409 TABLE_NOT_FREE { table_id }`; 4. holder check; 5. lock held by another session → `409 TABLE_ALREADY_LOCKED`; 6. `TableMoved { seating_id, from_table_id, to_table_id, by_staff_id, note }` on `from`'s stream (fold: `seating_tables` row and `primary_table_id` → `to`; lock row re-keyed); 7. `withdrawHandover`; 8. scope check both tables |
| Response | `200 { data: { seating_id, primary_table_id } }` |
| Race | Move to T9 while another device opens T9: single writer; whichever commits first wins, the other gets `TABLE_NOT_FREE` / `TABLE_ALREADY_LOCKED`. |

#### 6.10 `MergeTables` (§3.11)

| | |
|---|---|
| Permission | `permission: 'take-order'` (registry). In the handler: holder of `S` (plus `take-order-anywhere` when absorbing a seating held by someone else), **or** `force-release-table-lock` (G2 #8) |
| Payload | `{ into_table_id, table_id }` (`table_id` ≠ `into_table_id`) |
| Script | 1. open seating `S` of `into`; 2. seating `S2` of `table_id` (may be none); `S2 = S` → `200 { merged: false }`; 3. NEEDS_CLEANING on either → `409 TABLE_NEEDS_CLEANING`; 4. permission rules; 5. any lock on `S2` or `S` by a session other than the caller's → `409 TABLE_ALREADY_LOCKED`; 6. `S2` exists → `mergeGuard(db, { seating_ids: [S, S2] })` blocked → `409 MERGE_BLOCKED_BY_VOID { order_item_ids }`; 7. `TablesMerged { into_seating_id: S, into_table_id, table_ids: [table_id, …S2's other tables], absorbed_seating_id: S2 \| null, order_ids: S2's orders, by_staff_id }` on `into`'s stream (fold: tables join `S`, orders re-pointed, `S2` CLOSED `merged`, `S2`'s lock row deleted, state of `S` recomputed, `bill_requested_at` of `S` cleared when `S2` brings any order (same as a new round, §3.1)); 8. `withdrawHandover(S2)`; 9. scope check all tables |
| Response | `200 { data: { seating_id: S, table_ids } }` |
| Statements | seatings + tables + orders of both: 3 reads; guard: 04's statement count (declared by 04) |

#### 6.11 `SplitSeating` (§3.12)

| | |
|---|---|
| Permission | `permission: 'take-order'` (registry). In the handler: the caller is the holder, **or** also holds `force-release-table-lock` (scope covering the floor) — default grants give managers both (G2 #8) |
| Payload | `{ from_table_id, to_table_id, order_ids: string[] (set, C1; ≤ 50) }` |
| Script | 1. open seating `S` of `from`; 2. `to` FREE, or a joined table of `S` that is not its primary → else `409 TABLE_NOT_FREE`; 3. `order_ids` checks → `422 SPLIT_INVALID { reason: 'empty' \| 'all_orders' \| 'not_in_seating', order_ids? }` (`empty` only when `to` is FREE); 4. holder check; 5. guard on the moved orders → `409 MERGE_BLOCKED_BY_VOID`; 6. `SeatingSplit { from_seating_id: S, new_seating_id: ids.next(), to_table_id, order_ids, by_staff_id }` on `from`'s stream (fold: new seating with holder = `S`'s holder, `to` leaves `S` if joined, orders re-pointed, both states recomputed); 7. scope check |
| Response | `200 { data: { new_seating_id } }` |

#### 6.12 `RequestBill` (§3.13)

| | |
|---|---|
| Permission | `take-order` (no lock, D39) |
| Payload | `{ table_id }` |
| Script | open seating; state → rule of §3.13; `BillRequested { seating_id, table_id, by_staff_id }`; scope check |
| Errors | `409 TABLE_NOT_OPEN`, `409 TABLE_NO_ORDERS`, `409 TABLE_NEEDS_CLEANING` |

#### 6.13 `CleanTable` (§3.13)

| | |
|---|---|
| Permission | `clean-table` (`branch`) |
| Payload | `{ table_id }` |
| Script | open seating (`TABLE_NOT_OPEN`); state rule; `TableCleaned { seating_id, table_ids, reason, by_staff_id }` (fold: seating CLOSED, `seating_tables` rows deleted, lock row deleted); `withdrawHandover` |
| Errors | `409 TABLE_NOT_OPEN`, `409 TABLE_HAS_OPEN_ORDERS { order_count }` |

#### 6.14 `CallWaiter` (§3.13)

| | |
|---|---|
| Permission | `take-order` |
| Payload | `{ table_id, chip?: 'water' \| 'clear' \| 'come' \| 'other' }` (labels i18n) |
| Script | open seating; `alerts.raise(ctx, { kind: 'call_waiter', subject: { stream_type: 'table', stream_id: primary_table_id }, target: { kind: 'table_team', table_id, depth: 'direct' }, values: { table_id, seating_id, chip }, display, dedupe_key: 'call_waiter:' + seating_id, requester_staff_id: actor })`; `deduped: true` → `200 { alert_id, repeated: true }` |
| Response | `200 { data: { alert_id, repeated: boolean } }` |
| Kind | `defineAlertKind({ kind: 'call_waiter', family: 'action', subject: 'table', steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }], closes_on: 'seen', values_schema: z.object({ table_id: z.string().min(1), seating_id: z.string().min(1), chip: z.enum(['water','clear','come','other']).optional() }), details_schema: null, lead_fallback: true, expires_at_day_close: true, silent: false, labels: { card: 'alert.call_waiter.card', lock: 'alert.call_waiter.lock' }, request: null })` (01d §3.5; G2 #3) |

#### 6.15 Kind `table_handover` (§3.8)

```typescript
defineAlertKind({
  kind: 'table_handover', family: 'action', subject: 'table',
  steps: [
    { at: { ms: 0 },       to: [{ target: 'raised_target',  set: 'answerer' }] },
    { at: { ms: 60_000 },  to: [{ target: 'raised_target',  set: 'answerer' }] },   // remind (A14)
    { at: { ms: 120_000 }, to: [{ target: 'requester_lead', set: 'informed' }] },   // sender's lead (G0-1)
  ],
  closes_on: 'owner',
  values_schema: z.object({ table_id: z.string().min(1), seating_id: z.string().min(1), from_staff_id: z.string().min(1) }),
  details_schema: HandoverDetailsSchema,      // table names, party size, order count, running total (lineTotalMinor)
  lead_fallback: false,                       // request kind (01d N5)
  expires_at_day_close: true, silent: false,
  labels: { card: 'alert.table_handover.card', lock: 'alert.table_handover.lock' },
  request: {
    answers: ['accept', 'decline'],
    right: { mode: 'named' },                 // only alert.receiver_staff_id may answer (01d §3.3)
    needs_pin: 'never',                       // accept kind (01d A14)
    apply(ctx, answer),                       // §3.8: decision 'accept' → TableHolderChanged or stale; 'decline' → []
    onWithdraw: () => [],
  },
});
```

Names are 01d v1.1.1 §3.5 (`:404-443`) exactly (G2 #1). The `set` values for a request kind follow 01d §3.4 (`answerer` / `informed`); the build checks them against 01d's startup errors.

#### 6.16 Resolvers (registered with 01d, §4.5 D-1)

`registerTargetResolver('table_team', tableTeam)` — one statement per call over all targets (G2 #2); `registerTargetResolver('zone_order_taker', fn)` — `fn(tx, targets[])` maps each `{ kind: 'zone_order_taker', table_id }` to `zoneOf(table_id).zone_order_taker_staff_id` from memory (0 statements).


#### 6.18 `GET /queries/table-map`

| | |
|---|---|
| Session | staff required; `deviceTypes: ['tablet', 'phone', 'cashier_kiosk']`; `countsAsActivity: false` (M59) |
| Query | `{ floor_id?: string }` |
| Response | `{ data: { as_of_seq, floors: [{ floor_id, name, zones: [{ zone_id \| null, name \| null, tables: [{ table_id, name, seats, state, seating_id \| null, primary_table_id \| null, joined_table_names: string[], holder: { staff_id, name } \| null, assigned: { staff_id, name } \| null, lock: { staff_id, name, mine: boolean } \| null, opened_at \| null, bill_requested_at \| null, open_order_count }] }] }] } }` — names from the directory in memory; tables ordered by 01a `sort_order` |
| Statements | 3 (open seatings with tables; locks; order counts grouped by seating) + `last_seq` read — fixed, whatever the table count |

#### 6.19 `GET /queries/handover-candidates`

| | |
|---|---|
| Session | staff required; `countsAsActivity: false` |
| Query | `{ table_id }` |
| Response | `{ data: { staff: [{ staff_id, name, is_assigned: boolean, working: boolean, tables_held: int }] } }` — staff holding `take-order` with scope covering the floor (directory, in memory), `working` = live session, `tables_held` = open seatings held; holder excluded; sorted working first, then assigned, then name |
| Statements | 2 (live sessions of the candidates; held counts) |

Catch-up part **`tables`** (`registerCatchUp`): same builder as §6.18 without `floor_id`; applies to staff sockets and cashier kiosks.

#### 6.20 Events (all on `table`, `schema_version` 1)

| Event | Stream | Payload | Fold |
|---|---|---|---|
| `TableOpened` | table | `{ table_id, seating_id, holder_staff_id, party_size: int \| null }` | seating SEATED; `seating_tables` row |
| `TableLocked` | primary table | `{ table_id, seating_id, session_id, staff_id, replaced_session_id?: string }` | upsert lock |
| `TableLockTouched` | primary table | `{ table_id, session_id }` | activity times |
| `TableLockReleased` | primary table | `{ table_id, seating_id, session_id, staff_id, reason: 'released' \| 'force' \| 'session_expired' \| 'lock_ttl', by_staff_id?, note? }` | delete lock |
| `TableHolderChanged` | primary table | `{ table_id, seating_id, from_staff_id, to_staff_id, reason: 'take_over' \| 'handover' \| 'force_move', by_staff_id, alert_id?, note? }` | holder |
| `TableMoved` | from table | `{ seating_id, from_table_id, to_table_id, by_staff_id, note? }` | primary, tables, lock key |
| `TablesMerged` | into table | `{ into_seating_id, into_table_id, table_ids, absorbed_seating_id: string \| null, order_ids, by_staff_id }` | join, absorb |
| `SeatingSplit` | from table | `{ from_seating_id, new_seating_id, to_table_id, order_ids, by_staff_id }` | new seating |
| `BillRequested` | primary table | `{ seating_id, table_id, by_staff_id }` | BILL_REQUESTED |
| `TableCleaned` | primary table | `{ seating_id, table_ids, reason: 'cleaned' \| 'left_without_order', by_staff_id }` | CLOSED, free, unlock |

**Audiences:** every event to every staff socket and cashier kiosk of the branch (E2-TBL AC3); not to KDS stations except `TableMoved`, `TablesMerged`, `SeatingSplit` (03b shows the current table).

**Endpoint count:** 14 commands (6.1–6.4, 6.6–6.14) + 1 tick + 2 kinds + 2 queries + 1 catch-up = **14 commands / 2 queries**, inside the budget.

---

## §7. Cross-cutting (this module only)

| Item | Decision | YAGNI justification |
|---|---|---|
| Tick cost | `due` = one indexed statement; a pass = 1 read + 1 append | 500 ms tick (00) with ~60 locks; 01d allows one indexed statement in `due` |
| Boot | projections replay from checkpoint (00 M48); tick map rebuilt in 1 statement | Lock state must survive a power cut (D24) |
| Performance | `table-map` p99 < 50 ms at 80 tables / 40 open seatings (fixed 3 statements); `OpenTable` p99 < 30 ms | Opening a table is the first tap of every order in a rush (~200 orders / rush) |
| Logs | `table_id`, `seating_id`, `command_type`, `reason` on every 02a command log line; no names, no totals | Debug a "who had the table" dispute without leaking money |
| Rate limits | none beyond D61 (touch) and the 01d dedupe of `call_waiter` / `table_handover` | Staff devices on the LAN, ≤ 10 per branch |
| Cache | none (snapshot and directory are already in memory) | — |
| Privacy | table events carry ids and staff ids only; the running total appears only in the handover details (receiver) | Totals are not for every screen |

---

## §8. Client contract (staff entry `apps/client`, `/staff/`, ui-kit only; 01d AD-1)

- **Table map** (`table-map`, then WS events; catch-up part `tables` on reconnect): tiles grouped floor → zone, each with state icon + word, table name, "T4 + T5", holder initials, assignee ("Ali's table") when ≠ holder, padlock + locker name, time since opened; own tables first filter ("Mine": holder = me).
- **Open:** tap → `OpenTable`; `TABLE_ALREADY_LOCKED` → sheet "Ali is taking an order here" with **Force release** (only with the permission, reason chips) — the draft is never dropped.
- **Order screen** (02b) sends `TouchTableLock` once a minute while open (D61); leaving sends `ReleaseTableLock`.
- **Banners:** `TableLockReleased` for my lock → "Your table was released (…reason)"; `TableLocked { replaced_session_id = mine }` → "Opened on another device"; both keep the draft.
- **Table sheet** (long-press): Take over (assigned person only), Hand over (candidates from `handover-candidates`; working first), Force move (permission), Move, Merge, Split (choose orders), Ask for bill, Clean, Call waiter (chips).
- **Handover waiting card** (sender, 01d AD-1): "Waiting for Bilal — 0:42", Withdraw; results as 01d `request_result`.
- **Top bar:** Requests (n) + Inbox (n) (01d AD-168).
- **Offline (hub unreachable):** OpenTable, Take over, Hand over, Force move/release, Move, Merge, Split are disabled with "Needs the hub" (they decide who may act); Ask for bill, Clean, Call waiter go to 02b's device queue (not PIN-bearing, H-10). Touch and Release are dropped.
- **Permissions:** buttons from the session's effective permissions only (R5); scope failures show the table names.
- **Text:** Urdu and English, Latin digits (R20).

---

## §9. Error catalogue additions (appended to Foundation §6.2 and `@pos/domain/src/errors.ts`)

| Code | Status | `details` | When |
|---|---|---|---|
| `TABLE_NOT_FOUND` | 404 | `{ table_id }` | table not in the snapshot, archived, or another branch's (G2 #7) |
| `TABLE_NEEDS_CLEANING` | 409 | `{ table_id }` | open, merge, bill on a seating waiting for cleaning |
| `TABLE_NOT_OPEN` | 409 | `{ table_id }` | a seating command on a FREE table |
| `TABLE_NOT_ASSIGNED` | 409 | `{ table_id, assigned_staff_id: string \| null }` | take-over by someone not assigned |
| `TABLE_HANDOVER_PENDING` | 409 | `{ table_id, alert_id, to_staff_id }` | second handover request |
| `HANDOVER_TARGET_INVALID` | 422 | `{ reason: 'is_holder' \| 'inactive' \| 'not_working' \| 'no_permission' \| 'outside_scope' }` | bad receiver |
| `TABLE_NOT_FREE` | 409 | `{ table_id }` | move / split target has a seating |
| `TABLE_MERGED` | 409 | `{ seating_id, table_ids }` | moving a merged seating |
| `MERGE_BLOCKED_BY_VOID` | 409 | `{ order_item_ids }` | 04's guard |
| `SPLIT_INVALID` | 422 | `{ reason: 'empty' \| 'all_orders' \| 'not_in_seating', order_ids?: string[] }` | bad split |
| `TABLE_NO_ORDERS` | 409 | `{ table_id }` | bill request on SEATED |
| `TABLE_HAS_OPEN_ORDERS` | 409 | `{ table_id, order_count }` | clean before the bill closed |

Reused: `TABLE_ALREADY_LOCKED` (409, `{ table_id, locked_by_staff_id, locked_by_name }`), `TABLE_LOCK_NOT_HELD` (409), `PERMISSION_DENIED` (403, adds reason `not_holder`), `VALIDATION_FAILED` (422).

---

## §10. Tests (Vitest, `apps/hub/test/tables/*.test.ts`; numbers cited in test names)

Every command: happy path, one test per error code, retransmit (D32), scope (C8). Listed here only where more is needed.

| # | Test |
|---|---|
| 1 | OpenTable on FREE → `TableOpened` + `TableLocked`, state SEATED, holder = caller |
| 2 | OpenTable twice by the same session → no new event |
| 3 | **Same staff, second device** → `TableLocked { replaced_session_id }`; old session's Touch → `TABLE_LOCK_NOT_HELD`; old device's draft submit re-acquires only if free (02b) |
| 4 | Other staff → `TABLE_ALREADY_LOCKED` with name |
| 5 | Holder ≠ caller without `take-order-anywhere` → 403; with it → lock, holder unchanged |
| 6 | Race: two OpenTable on one FREE table in one tick → one seating, one `TABLE_ALREADY_LOCKED` |
| 7 | Touch: < 50 s no write; ≥ 50 s writes; foreign session → 409 (D61 exactly) |
| 8 | Tick: lock TTL passes → `lock_ttl`; session ended → `session_expired`; idle → exactly one `due` statement, `writer.run` never called (spy) |
| 9 | Tick after reboot with a session ended while down → released |
| 10 | Take-over by assignee → holder changes, lock untouched, pending handover withdrawn |
| 11 | Take-over by non-assignee → `TABLE_NOT_ASSIGNED` |
| 12 | Handover: raise, accept → `TableHolderChanged { handover, alert_id }` |
| 13 | Handover accepted after a take-over → stale, no event |
| 14 | Handover decline → no event; table stays |
| 15 | Handover second request → `TABLE_HANDOVER_PENDING`; receiver without live session → `not_working` |
| 16 | Handover steps: remind at 60 s, sender's lead at 120 s (01d fake clock) |
| 17 | Force move → holder changes with note; pending handover withdrawn |
| 18 | **Waiter team fallback 1:** assigned Ali, Ali's reports working → Ali's working reports, `source: 'assigned'` |
| 19 | **Waiter team fallback 2:** Ali's reports all off (no live session, or past idle TTL) → holder's working reports, `source: 'holder'` |
| 20 | **Waiter team fallback 3:** nobody working → `[holder]`, `source: 'holder_only'` |
| 21 | `table_team` resolver for 40 targets = 1 statement; `tableOwners` = 1; 01d adds no reports on top (D-1) |
| 22 | Move to FREE → seating, lock and orders follow; 03a `table_key` unchanged |
| 23 | Move merged seating → `TABLE_MERGED`; to busy table → `TABLE_NOT_FREE` |
| 24 | Merge FREE table → joins, "T4 + T5" on both tiles |
| 25 | Merge two seatings → orders move, absorbed seating CLOSED `merged`, its lock gone, its handover withdrawn |
| 26 | Merge blocked by 04 guard stub → `MERGE_BLOCKED_BY_VOID`; no guard registered → never blocked |
| 27 | Merge with the other side locked by another session → `TABLE_ALREADY_LOCKED` |
| 28 | Split chosen orders to FREE → new seating, same holder; states recomputed |
| 29 | Split detaching a joined table with no orders → unmerge |
| 30 | Split all / foreign orders → `SPLIT_INVALID` |
| 31 | RequestBill states; repeat → `requested: false`; new round after bill → ORDERED, `bill_requested_at` cleared |
| 32 | BillClosed fold → NEEDS_CLEANING; Open → `TABLE_NEEDS_CLEANING`; Clean → FREE |
| 33 | Clean SEATED without orders → `left_without_order`; with open orders → `TABLE_HAS_OPEN_ORDERS` |
| 34 | CallWaiter → kind to the team; repeat → `repeated: true`, no second alert |
| 35 | table-map: 3 statements at 80 tables; `countsAsActivity` false; `mine` flag |
| 36 | handover-candidates: working first, holder excluded, scope respected |
| 37 | Projection reset + replay → identical `seatings`, `seating_tables`, `seating_orders`, `table_locks` |
| 38 | COMMIT failure during OpenTable → no seating, no lock, tick map unchanged (D45) |
| 39 | Archived table: open → 404; an open seating on it stays usable until cleaned (01a §6.5) |
| 40 | ForceReleaseTableLock: releases with note; the holder's device gets the banner; no lock → `released: false`; scope |
| 41 | A pending handover is withdrawn by Move, Merge (absorbed side), Clean (`RequestWithdrawn` in the same transaction) |
| 42 | `TableMoved` re-keys the lock; Touch on the new table works, on the old → `TABLE_LOCK_NOT_HELD` |
| 43 | OpenTable on a joined table locks the seating's primary table; a second open on the primary by the same session → no event |
| 44 | Handover on NEEDS_CLEANING → `TABLE_NEEDS_CLEANING`; `BillClosed` while a handover is pending → accept is stale |

### Acceptance (story AC → test)

| AC | Tests |
|---|---|
| E2-TBL AC1 states | 1, 31, 32, 33 |
| AC2–AC3 lock with name everywhere | 4, 6, 35 |
| AC4 assignment (owner Q1/Q2) | 5, 10, 18–20 |
| AC5 force release | 40 |
| AC6a keep-alive | 7, 8 |
| AC6b move with reason | 22, 23 |
| AC7 merge, blocked by pending void | 24–27 |
| AC8 split | 28–30 |
| E2-HAND AC1–AC6 | 12–17 |

---

## §11. Build order (one task per commit, TDD)

1. 01a A-1 and 01b B-1 / B-2 / B-3 bumps applied (separate approved bumps; not 02a tasks).
2. `@pos/events/src/tables/*` event schemas (§6.20) + `@pos/domain` `TableState`, error codes (§9).
3. Migration `NNNN_tables.sql` (§5).
4. Projection `seatings` (folds of §6.20 + `OrderPlaced`, `ItemServed`, `BillClosed` fixtures) with `reset` (test 37).
5. Projection `table_locks` (§5).
6. `tableOwners`, `seatingOf`, `currentTableOf`, `zoneOf`, `requireLock` (§4.2; tests 21).
7. `tableTeam` as the one-statement `table_team` resolver (§3.5, §6.16; tests 18–21).
8. `OpenTable` (§6.1; tests 1–6, 38, 39).
9. `TouchTableLock`, `ReleaseTableLock`, `ForceReleaseTableLock` (§6.2–6.4; test 7).
10. Tick `table_locks` (§6.5; tests 8, 9).
11. `TakeOverTable` (§6.6; tests 10, 11).
12. Kind `table_handover` + `RequestTableHandover` + `withdrawHandover` (§6.7, §6.15, §3.9; tests 12–16).
13. `ForceMoveTable` (§6.8; test 17).
14. `MoveTable` (§6.9; tests 22, 23).
15. `MergeTables` + `registerMergeGuard` (§6.10; tests 24–27).
16. `SplitSeating` (§6.11; tests 28–30).
17. `RequestBill`, `CleanTable` (§6.12, §6.13; tests 31–33).
18. Kind `call_waiter` + `CallWaiter` (§6.14; test 34).
19. 01d resolvers `table_team`, `zone_order_taker` (§6.16).
20. Queries `table-map`, `handover-candidates`, catch-up `tables`, audiences (§6.18–6.20; tests 35, 36).
21. Client: table map, table sheet, banners, waiting card, offline rules (§8) — Playwright flows (pipeline step 9).

Files: `apps/hub/src/tables/` (commands, projections, tick, kinds, queries), `apps/hub/test/tables/`, `packages/events/src/tables/`, `apps/client/src/staff/tables/`.

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done

All §10 tests pass; every command has happy, error-per-code, retransmit, scope tests; COMMIT-failure test (38); replay identity (37); statement counts asserted (21, 35); §4.5 rows approved and applied with markers (R26); README updated (R-1); client flows of §8 pass on a tablet and a phone.

### 12.2 Endpoint checklist

| # | Name | Kind | Permission | Events | Errors |
|---|---|---|---|---|---|
| 6.1 | OpenTable | command | take-order (+ anywhere) | TableOpened, TableLocked | 404, 409×2, 403 |
| 6.2 | TouchTableLock | command | take-order | TableLockTouched | 409 |
| 6.3 | ReleaseTableLock | command | take-order | TableLockReleased | — |
| 6.4 | ForceReleaseTableLock | command | force-release-table-lock | TableLockReleased | 403 |
| 6.5 | table_locks | tick | — | TableLockReleased | — |
| 6.6 | TakeOverTable | command | take-order | TableHolderChanged | 409×2 |
| 6.7 | RequestTableHandover | command | take-order (+ force for non-holder) | AlertRaised; TableHolderChanged on accept | 409×3, 422, 403 |
| 6.8 | ForceMoveTable | command | force-release-table-lock | TableHolderChanged | 409, 422, 403 |
| 6.9 | MoveTable | command | take-order (+ force for non-holder) | TableMoved | 409×4, 403 |
| 6.10 | MergeTables | command | take-order (+ anywhere / force) | TablesMerged | 409×4, 403 |
| 6.11 | SplitSeating | command | take-order (+ force for non-holder) | SeatingSplit | 409×3, 422, 403 |
| 6.12 | RequestBill | command | take-order | BillRequested | 409×3 |
| 6.13 | CleanTable | command | clean-table | TableCleaned | 409×2 |
| 6.14 | CallWaiter | command | take-order | AlertRaised | 409 |
| 6.18 | table-map | query | session | — | — |
| 6.19 | handover-candidates | query | session | — | 404 |

### 12.3 Open questions

| # | Question | **Decided** (developer, 2026-11-06) |
|---|---|---|
| OQ1 | Should Ask for bill also alert the cashier? | **05 decides** (it owns the bill queue); 02a only writes `BillRequested`. Carried to 05 (§4.3). |
| OQ2 | Cleaning by waiters who have no tablet (paper era): who taps Clean? | **`clean-table` default includes Cashier and Order taker**; anything else is config. |
| OQ3 | `call_waiter` chips list | **Fixed four in the pilot** (`water`, `clear`, `come`, `other`); configurable list later (§12.4). |

No open question left in 02a.

### 12.4 Deferred until needed

Pass pick-up identity and wrong-team warning (owner round 2); hub-side assignment screen (owner Q1); per-line move between seatings (bill split is 05's); configurable table colours; reservations / waitlist (P2); unmerge as its own command (split covers it); moving a merged seating in one step; configurable `call_waiter` chips (OQ3).

### 12.5 Hostile self-review (developer, 2026-11-06)

| Area | Finding | Handling |
|---|---|---|
| Race | Take-over and handover accept in the same tick | Single writer; `apply` checks holder = `from_staff_id` → stale (test 13). |
| Race | Merge while the absorbed table's holder is building on another device | Refused: lock by another session (test 27). |
| Race | Clean while a lock exists | `TableCleaned` ends the lock in its fold; the device gets the release banner. |
| Idempotency | Repeated Open / Release / Bill / CallWaiter | No-op responses, no event; D32 stores the first response. |
| N+1 | Team resolution per alert | `table_team` resolver batches all targets of a tick pass or raise in one statement (G2 #2). |
| Index | Open seating of a table | `seating_tables` PK; locks by session index for the tick. |
| Contradiction | 01d's `table_team` derives reports from one owner | §4.5 D-1. |
| Contradiction | Foundation "5 min" order-taker TTL | §4.5 F-2. |
| Ownership | 02b writing 02a's projection | Removed: 02a folds `OrderCancelled` (G2 #5). |
| Contradiction | 01d AD-51 adds reports to the resolver's owner | §4.5 D-1 reverses it for `table_team` (G2 #2). |
| Over-engineering | Unmerge command, seat numbers, hub assignment screen | Left out (§12.4). |
| Privacy | Totals on table events | Not carried (§7). |
