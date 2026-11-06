# 02a Tables — Module Spec

| | |
|---|---|
| Doc type | Module spec (Module mode, 12 sections, README checklist) |
| Version | **v0.4 — DRAFT, G4 run 1 fixed, ready for G4 run 2** (developer, 2026-11-06). v0.4 = v0.3 + every finding of `docs/reviews/02a_v0.3_hostile_run1.md` (16 MAJOR, 17 MINOR) closed; §12.6 maps each finding to its fix. v0.3, v0.2, v0.1 kept as history. |
| Module | **02a Tables** — seatings, table state, table lock, holder and assignment, take-over, handover with acceptance, force move, move / merge / split, bill request, cleaning, call waiter, zones and `zoneOf`, the owner / team reads other modules use. **02b Ordering** (next spec) owns orders, Served, returns, comps, zone stock, takeaway token, the device command queue. |
| Depends on | Foundation **v1.9**; 00 **v1.7**; 01a **v2.1**; 01b **v1.5**; 01d **v1.1.1** (spec and as-built code `apps/hub/src/alerts/`); 03a **v1.0** |
| Read by | 02b, 03a, 01d (resolvers), 03b, 04, 05, 07 (R25) |
| Sources | `docs/stories/02-g0.md` (G0 + owner answers §5.4, 2026-11-06), `stories-refined.md` E2-TBL, E2-HAND (`01d-notifications-teams-refined.md`), `docs/design/inventory/02-ordering-tables.md`; reviews `02a_v0.2_g2_completeness.md`, `02a_v0.3_hostile_run1.md` |
| Inherits | Shared Standards from **Foundation v1.9 §6**. Not redefined here. |

### Changelog

| Version | Change |
|---|---|
| v0.4 | G4 run 1 (`02a_v0.3_hostile_run1.md`) closed, see §12.6. Main changes: **lock bound to (staff, device)**, not to a session id: events carry no session ids, every activity refresh is a fold (D44); `tableOwners` keeps 03a's `Map<table_id, staff_id>`; new `holdersOfOrders` for 03a's slips after a move (R26 row to 03a); `table_team` resolver keyed by depth and returning the holder too (owner Q2 as written); handover withdraw = `alerts.close(…, 'obsolete')`, stale accept = `apply` throws `TABLE_HANDOVER_STALE`; every seating command carries the `seating_id` it acted on (`TABLE_SEATING_CHANGED`); moving / merging across owners needs the force permission (R23); state edges (all cancelled → SEATED; `OrderLinesAdded` folded; submit refused on NEEDS_CLEANING; archived tables keep their seating). |
| v0.3 | G2 fixes. |
| v0.2 | Batch-1 review, §6 batch 2, §7–§12. |
| v0.1 | §1–§5, §6 batch 1. |

---

## §1. Header

### 1.1 Stories covered

| Story | ACs in 02a | Notes |
|---|---|---|
| E2-TBL (`stories-refined.md:441`) | AC1 states (fixed palette), AC2–AC3 lock with name everywhere, AC4 assignment (owner Q1/Q2), AC5 force release, AC6a keep-alive (D61), AC6b move with reason, AC7 merge, AC8 split | AC9 order types → 02b |
| E2-HAND (`01d-notifications-teams-refined.md:40`) | AC1–AC6 | accept kind on 01d |
| R23, R24, R25 (README) | handover and cross-owner moves need acceptance or the force permission; alerts to the table's team; holder and every move recorded | |

### 1.2 In scope

Seating lifecycle and table state; table lock; holder vs assigned order taker; take-over; handover with acceptance; force move; move, merge, split; bill request; cleaning; call waiter; zones and `zoneOf`; `tableOwners`, `seatingOwners`, `holdersOfOrders`, `seatingOf`, `currentTableOf`, `requireLock`, the `table_team` / `zone_order_taker` resolvers; queries `table-map`, `handover-candidates`; catch-up part `tables`.

### 1.3 Out of scope

Orders, lines, Served, returns, comps, zone stock, takeaway token, device queue (**02b**). Bill and `BillClosed` (**05**). Voids, pending-void state (**04**, through a guard). Pass pick-up identity (deferred, owner round 2). Reservations (P2). Table canvas (01a S9). Hub-side assignment screen (owner Q1). Configurable colours and call chips (§12.4).

### 1.4 Decisions log (developer, 2026-11-06)

| # | Decision | Prevents | Source |
|---|---|---|---|
| T1 | **02 is split into 02a Tables and 02b Ordering**; 02a is built first. | One spec above the README budget (~30). | README size budget |
| T2 | **A seating is one party**, from `OpenTable` on a free table to `TableCleaned`; it holds one primary table and 0..n joined tables. 05 bills a seating; 03a's `follow_up` reads it. | "Current seating" undefined (03a To 02 #3). | 02-g0 §3 #9 |
| T3 | **No separate Seated step**: `OpenTable` on a FREE table opens the seating and the lock together. | A tap nobody makes in a rush. | inventory Q6 |
| T4 | **Two people per seating** (owner Q2): the **assigned order taker** (setup) and the **holder** (who opened it or took it over). Waiter alerts go to the assigned order taker's working waiters **and to the holder**; order-taker alerts go to the holder. | Ali's waiters serving Ali's tables while Bilal took the order, and Bilal still seeing them on his tablet. | owner Q2 ("Ali's waiters and Bilal's tab") |
| T5 | **Take-over** by the assigned order taker: no acceptance, always an event. | Ali waiting for Bilal. | owner B |
| T6 | **Holder changes to someone else need acceptance** (handover, R23) **or the force permission** (`force-release-table-lock`, audited): this covers force move, absorbing another holder's seating in a merge, and moving / splitting a party onto a table assigned to someone else (§3.10–§3.12). | R23 bypassed by merge or move. | R23 (README:123); E2-HAND AC1; G4-1 #14 |
| T7 | **The lock belongs to (staff, device)**, not to a session id: 00 allows one live staff session per device (`staff_sessions_active_device`, `0002_devices_sessions.sql:79`), and the envelope carries `actor_id` and `device_id` but no session (`packages/events/src/envelope.ts`). Every lock change and every activity refresh is the fold of an event (D44). | A projection write outside an event (G4-1 #3); session ids pushed to every socket (G4-1 #31). | F §4.3 D44, D51, D61 |
| T8 | **`own_tables` = seatings whose holder is the person.** | 01b's "tables they open" breaks after a handover. | 02-g0 §3 #8 |
| T9 | **Zones are 01a data**; a table without a zone counts as its floor's implicit zone. | `zoneOf` with no data. | 02-g0 §3 #5 |
| T10 | **Assignment is 01b data**, one person per zone and per table; a table's assignment wins over its zone's; **a seating's assignee = its primary table's assignee**, everywhere. | Two assignees for one merged party (G4-1 #20). | owner Q1 |
| T11 | **Table events live on the `table` stream** (stream = the table named per event, §6.19). | One fact, one event. | F §3.5 |
| T12 | **States are derived** from 02a events plus folds of `OrderPlaced`, `OrderLinesAdded`, `ItemServed`, `OrderCancelled` (02b) and `BillClosed` (05). | State events out of sync. | F §4.3 |
| T13 | **Lock scope D39 unchanged.** | A lock holder blocking checkout. | F §4.3 D39 |
| T14 | **The lock tick is 02a's** (F-2), `due` = one indexed statement. | — | 03a To 02 #2 |
| T15 | **Same staff on another device takes the lock over** (review R1). | Ali stuck for the TTL after a dead tablet. | review 2026-11-06 |
| T16 | **Waiter team counts only people working now** (review R2), with two fallbacks; the holder is always added (T4). | Alerts to waiters who are off. | review 2026-11-06 |
| T17 | **Moves, merges, splits move whole seatings and whole orders.** | Engine line ids moving between orders. | owner Q3 |
| T18 | **Every command on an open seating names the `seating_id` the screen showed**; a different current seating → `409 TABLE_SEATING_CHANGED`. | A queued or stale command hitting the next party (G4-1 #15). | owner Q8 (auto-send) |

---

## §2. Existing architecture that must not change

- **Foundation §4.3:** lock projection `table_locks`; `TABLE_ALREADY_LOCKED` with the locker's name; D39; D51 auto-release by **02's own tick** (F-2); D61 `TouchTableLock` (holder check → `TABLE_LOCK_NOT_HELD`; no `TableLockTouched` yet, or ≥ 50 s since the last → write; else success without writing); force release audited; a submit re-acquires a free lock (02b).
- **Foundation §4.4:** BUILDING is device-local; a release never loses the draft.
- **Foundation §5.7:** idle TTL per role (01b); commands count as activity, polled queries never (00 M59).
- **00 v1.7 §4.2:** `defineCommand` (one `permission` key; `'checked-in-handler'` only for `HANDLER_CHECKED_COMMANDS`), `defineQuery`, `registerProjection`, `registerTick` (01d §4.2), `registerCatchUp`, `registerEventAudience`, `StaffDirectory`, `clock`, `ids`; command response `{ data: { command_id, event_ids, result } }` (`commands/route.ts:150-153`); `staff_sessions` with `staff_sessions_active (branch_id) WHERE ended_at IS NULL` and `staff_sessions_active_device`; the sweeper owns session expiry (activity flushed every 15 s, `auth/session-sweeper.ts`).
- **01a v2.1:** floors, tables, snapshot V3 with `engine_settings.table_lock_ttl_ms` (02's setting); an order on an archived table stays usable (§6.5).
- **01b v1.5:** `take-order-anywhere`, `force-release-table-lock` (`branch`, `my_floors`); `reports_to`; C8.
- **01d v1.1.1 (code is the truth where it differs):** `defineAlertKind` (§3.5); `alerts.raise(ctx, input)` → `{ alert_id, events, deduped }`; `alerts.byDedupeKey(db, kind, key)`; `alerts.close(ctx, alert_id, reason, note?)` → drafts (`OWNER_CLOSE_REASONS`, incl. `obsolete`); request part `{ answers, right: { mode: 'named' }, needs_pin, apply(ctx & { alert }, answer), onWithdraw? }` — `apply` **throws `DomainError` to refuse**, and a refused answer leaves the request open (`alerts/commands/answer-request.ts`); `WithdrawRequest` is the requester's command only; `registerTargetResolver(kind, fn(tx, targets[]))`, one statement per call; card `details` = `AlertDetailsBase { item, quantity, amount, reason }` (`packages/events/src/alerts.ts:66-79`); requests never expire (01d:148).
- **03a v1.0:** `tableOwners(db, table_ids[]) → Map<table_id, staff_id>`, one statement (03a:577, :640); slips grouped per `table_key` (03a:476); lock state is not `EngineState`.

---

## §3. Domain rules

### 3.1 Seating and table state

```
             OpenTable (FREE table)
  FREE ──────────────────────────────► SEATED ──OrderPlaced──► ORDERED
   ▲                                  ▲   │                      │ every live order has a served line
   │ CleanTable                       │   │ CleanTable           ▼
   │                  all orders      │   ▼ (no live order)  FOOD_ON_TABLE ◄─┐
   │                  cancelled ──────┘  FREE                    │ RequestBill│ OrderLinesAdded /
   │                                                             ▼            │ OrderPlaced → ORDERED
 NEEDS_CLEANING ◄──────── BillClosed (05) ─────────────── BILL_REQUESTED ─────┘
```

- **Live order** = an order of the seating with `cancelled = 0`.
- **State fold** (one function, run after every folded event of the seating): NEEDS_CLEANING if set by `BillClosed` (sticky); else BILL_REQUESTED if `bill_requested_at` is set; else SEATED if there is no live order; else ORDERED if any live order has `served_any = 0`; else FOOD_ON_TABLE.
- `bill_requested_at` is cleared by `OrderPlaced`, by `OrderLinesAdded` (G4-1 #12), and by a merge that brings an order; 05 reprints.
- `OrderLinesAdded` also sets `served_any = 0` for its order.
- **NEEDS_CLEANING is final** for the seating: no order, merge, split, handover or bill request reaches it (`409 TABLE_NEEDS_CLEANING`); only `CleanTable`.
- Tiles: icon + word per state, fixed palette (FREE green, SEATED blue, ORDERED amber, FOOD_ON_TABLE teal, BILL_REQUESTED purple, NEEDS_CLEANING grey); padlock + locker name.

### 3.2 Opening a table (`OpenTable`, permission `take-order`, new, §4.5 B-1)

| Situation | Needs | Result |
|---|---|---|
| FREE table, not archived | `take-order` (`branch`, or `my_floors` with the floor) | New seating, holder = caller, lock = (caller, device) |
| FREE table, archived | — | `404 TABLE_NOT_FOUND` |
| Open seating, unlocked, holder = caller | `take-order` | Lock |
| Open seating, unlocked, holder ≠ caller | `take-order` + `take-order-anywhere` (scope covering the floor) | Lock; holder unchanged |
| Locked by the caller on this device | `take-order` | Success, no event |
| Locked by the caller on another device | as above | **Lock moves** (T15): `TableLocked { replaced_device_id }`; the old device shows "Opened on another device" and keeps its draft |
| Locked by another staff | — | `409 TABLE_ALREADY_LOCKED { table_id, locked_by_staff_id, locked_by_name }` |
| NEEDS_CLEANING | — | `409 TABLE_NEEDS_CLEANING` |

Opening a joined table opens its seating: the lock is stored under the seating's primary table. `OpenTable` on an open seating takes an optional `seating_id`; if given and different → `409 TABLE_SEATING_CHANGED`.

### 3.3 Lock

- One lock per seating, row keyed by the primary table: `(staff_id, device_id)`, `locked_at`, `last_activity_at`, `last_touch_at` (null until the first `TableLockTouched`, D61).
- **Activity refresh is a fold** (T7): `table_locks` sets `last_activity_at = recorded_at` on each of these events whose envelope `actor_id = lock.staff_id AND device_id = lock.device_id` and which names the seating: every 02a `table`-stream event of §6.19, and 02b's `OrderPlaced`, `OrderLinesAdded`, `ItemRemoved` and the 02b edit events 02b lists in its §5 (row To 02b). `requireLock` on a held lock writes nothing.
- Released by `ReleaseTableLock`, `ForceReleaseTableLock` (reason), the tick (§3.4), and inside the folds of `TableCleaned` and `TablesMerged` (absorbed side). Moves with `TableMoved` and to the same staff's other device (T15).
- A release never discards the device's draft.

### 3.4 Lock tick `table_locks`

- `registerTick({ name: 'table_locks', due(db, state, now), intents(tx, state, now) })`.
- **Live staff session of (staff, device)** = a `staff_sessions` row with `kind = 'staff'`, that `staff_id` and `device_id`, `ended_at IS NULL` (the sweeper owns expiry; served by `staff_sessions_active_device`).
- **`due`**: one statement — `SELECT 1 FROM table_locks l WHERE NOT EXISTS (SELECT 1 FROM staff_sessions s WHERE s.device_id = l.device_id AND s.staff_id = l.staff_id AND s.kind = 'staff' AND s.ended_at IS NULL) OR :now - l.last_activity_at > :ttl LIMIT 1`.
- **`intents`**: one read with the same predicate returning the rows; no live session → `TableLockReleased { reason: 'session_expired' }`; else `now − last_activity_at > ttl` → `reason: 'lock_ttl'`. **Same comparison (`>`) in both** (G4-1 #19). 1 read + 1 append per pass.
- `ttl` = `branchConfig().engine_settings.table_lock_ttl_ms`.
- The same staff signing in again on the same device keeps the lock (same person, same device; T15 spirit).

### 3.5 Holder, alerts and the waiter team

- Holder set at open; changed only by `TableHolderChanged` (take-over, accepted handover, force move, or a merge / move / split under the force permission that changes it — §3.10–§3.12 keep the holder otherwise).
- **Order-taker alerts** → the holder: 03a slip warning (by order, §4.2 `holdersOfOrders`), 04 rejected-void notice, handover results.
- **Waiter team** of a seating at `now`, with `A` = the seating's assignee (T10):
  1. `W` = `A`'s direct reports with a live staff session (`kind = 'staff'`, `ended_at IS NULL`), if `A` exists and `W` ≠ ∅;
  2. else `W` = the holder's direct reports with a live staff session, if ≠ ∅;
  3. else `W` = ∅.
  **Waiter alerts** (03b Ready to serve, `call_waiter`) go to **`W ∪ {holder}`** (T4, owner Q2).
- The rule is one internal function `waiterTeam(seating, liveStaffIds)`, unit-tested directly (G4-1 #17).

### 3.6 Assignment (setup data)

- 01a `zones`, `tables.zone_id`; 01b `assigned_zone_ids[]`, `assigned_table_ids[]` per staff and branch (§4.5 A-1, B-2).
- **Assignee of a table** = staff whose `assigned_table_ids` contains it, else whose `assigned_zone_ids` contains its zone, else none; only staff holding `take-order` at the branch count. **Assignee of a seating** = assignee of its primary table.
- Never changed on the hub.

### 3.7 Take-over (`TakeOverTable`)

- Caller = the seating's assignee, holds `take-order`, scope covers the floor (C8, last), ≠ holder; seating not NEEDS_CLEANING → `TableHolderChanged { reason: 'take_over' }`; the seating's pending handover is closed `obsolete` (§3.9). Lock untouched.

### 3.8 Handover with acceptance (`RequestTableHandover`, kind `table_handover`)

- Sender = the holder, or a person holding `force-release-table-lock`. Receiver: holds `take-order` covering the floor, active, **working** (a live staff session), ≠ holder, **≠ the sender** (a manager taking a table uses `ForceMoveTable`, G4-1 #6).
- One pending handover per seating (dedupe key `table_handover:<seating_id>`; `deduped: true` → `409 TABLE_HANDOVER_PENDING`). Not on NEEDS_CLEANING.
- Kind: §6.15. Card: `display` carries the table names and the sender's name; `details` (AlertDetailsBase) `quantity` = order count, `amount` = running total (`seatingTotals` from 02b, §4.1; absent until 02b is built) (G4-1 #16).
- **Accept** → `apply(ctx & { alert }, answer)` reads the seating by `alert.values.seating_id`: open, not NEEDS_CLEANING, holder = `alert.values.from_staff_id` → `TableHolderChanged { reason: 'handover', alert_id, from_staff_id, to_staff_id: answer.answerer_staff_id, by_staff_id: answer.answerer_staff_id }`; otherwise it **throws `409 TABLE_HANDOVER_STALE`** — the request stays open until 02a closes it (G4-1 #5).
- **Decline** → `apply` returns `[]`; 01d tells the sender.
- **Closing a pending handover** (`obsolete`, §3.9): take-over, force move, merge (either side), split (the source), clean. A move keeps it (it is keyed by seating).
- Day close does not close requests (01d:148); `CleanTable` does.

### 3.9 Closing a pending handover

`closeHandover(ctx, seating_id, note)` (internal): `alerts.byDedupeKey(db, 'table_handover', 'table_handover:' + seating_id)` (1 statement) → if found, `alerts.close(ctx, alert_id, 'obsolete', note)` drafts appended in the same transaction (`AlertClosed`, and 01d's result to the sender). Never `WithdrawRequest` (requester-only, G4-1 #4).

### 3.10 Move (`MoveTable`)

- A seating with **one** table moves to a FREE, non-archived table (`TABLE_MERGED` for a merged seating; split first). Holder, orders and the lock (if the caller's) move with it. Reason optional.
- **R23 (T6):** the caller is the holder with `take-order`. If the target table's assignee differs from the seating's assignee, or the target is on another floor, the caller also needs `force-release-table-lock`; else `409 TABLE_OTHER_OWNER { table_id, assigned_staff_id }` ("Hand it over first").
- Lock held by another staff/device → `409 TABLE_ALREADY_LOCKED`.
- 03a keeps the order's `table_key`; slips find their holder by order (`holdersOfOrders`, §4.2, R26 row Q-1).

### 3.11 Merge (`MergeTables`)

- `{ into_table_id, into_seating_id, table_id, table_seating_id: string | null }`:
  - `table_id` FREE (non-archived) → **joins** the `into` seating.
  - `table_id` with seating `S2` → **absorbed**: orders move to `S`, tables join, `S2` closes `merged`, its lock ends.
- Guards: `seating_id`s as shown (T18); either side NEEDS_CLEANING → 409; a lock on either side by someone other than (caller, device) → `TABLE_ALREADY_LOCKED`; 04 `mergeGuard` → `MERGE_BLOCKED_BY_VOID`.
- **R23 (T6):** absorbing `S2` whose holder ≠ the caller, or joining a table assigned to someone else than `S`'s assignee, needs `force-release-table-lock`; else `409 TABLE_OTHER_OWNER`. `S`'s holder and assignee stay.
- Pending handovers of `S` and `S2` are closed `obsolete` (the party changed, G4-1 #21).
- `bill_requested_at` of `S` cleared when `S2` brings an order.

### 3.12 Split (`SplitSeating`)

- `{ from_table_id, seating_id, to_table_id, order_ids[] }`:
  - `order_ids` non-empty, `to_table_id` FREE or a joined table of `S` (not the primary) → a new seating on `to_table_id` with those **whole live orders**; holder = `S`'s holder.
  - `order_ids` empty and `to_table_id` a joined table → **detach**: the table leaves `S` and is FREE (no empty seating, G4-1 #22).
- `409 SPLIT_INVALID { reason: 'empty' | 'all_orders' | 'not_in_seating', order_ids? }` (409: it depends on the seating's current orders, G4-1 #24). 04 guard on the moved orders.
- **R23 (T6):** a new seating on a table whose assignee differs from `S`'s needs `force-release-table-lock`, else `409 TABLE_OTHER_OWNER`.
- The pending handover of `S` is closed `obsolete`. The lock stays on `S`.

### 3.13 Bill request, cleaning, call waiter

- **`RequestBill`** (`take-order`, no lock, D39): ORDERED / FOOD_ON_TABLE → `BillRequested`; BILL_REQUESTED → `result: { requested: false }`; SEATED → `409 TABLE_NO_ORDERS`; NEEDS_CLEANING → `409 TABLE_NEEDS_CLEANING`. Whether it alerts the cashier is 05's (OQ1, decided).
- **`CleanTable`** (`clean-table`, new): NEEDS_CLEANING → `TableCleaned { reason: 'cleaned' }`; SEATED → `reason: 'left_without_order'` (this includes "every order cancelled", G4-1 #10); else `409 TABLE_HAS_OPEN_ORDERS { order_count }`. The fold closes the seating, frees its tables, ends its lock; `CleanTable` closes the pending handover and the open `call_waiter` alert (`obsolete`).
- **`CallWaiter`** (`take-order`): kind `call_waiter` raised to `{ kind: 'table_team', table_id, depth: 'direct' }` (= `W ∪ {holder}`); one open per seating (dedupe `call_waiter:<seating_id>` → `result: { alert_id, repeated: true }`). **Closes after 5 minutes** (`closes_on: { after_ms: 300_000 }`) or at Clean; no "seen closes it" (01d's `seen` is single-recipient, AD-107; G4-1 #7). The sender sees the result only on the table map ("Call sent 1 min ago") — there is no "my sent alerts" view for non-request kinds (G4-1 #29).

### 3.14 Archived tables (01a §6.5, G4-1 #13)

`404 TABLE_NOT_FOUND` for an archived table only where a **new** seating or join would land on it: `OpenTable` on a FREE archived table, a FREE `to_table_id` of Move / Split, a FREE `table_id` of Merge. Every command on an existing seating finds it through `seating_tables`, archived or not. The table map shows an archived table while it still has a seating (marked "archived").

### 3.15 Handler-checked second permissions (G4-1 #26)

Commands register `permission: 'take-order'` (or `clean-table`, `force-release-table-lock`). A second permission checked in the handler (`take-order-anywhere`, `force-release-table-lock`) passes only with an `allowed` grant whose scope covers every table named; a `requires_approval` grant counts as **denied** (no approval flow for these in the pilot). Scope checks run last (C8).

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | registry, writer, projections, tick, catch-up, audiences, `StaffDirectory`, `staff_sessions`, `clock`, `ids` | everything |
| 01a | snapshot `floors[]`, `tables[]`; **`zones[]`, `tables[].zone_id`** (A-1); `engine_settings.table_lock_ttl_ms` | map, zones, tick |
| 01b | `resolve`, `floorsOf`, `teamOf`; **`assignedOrderTaker(table_id)`** (B-2) | §3.2, §3.5, §3.6 |
| 01d | `defineAlertKind`, `alerts.raise`, `alerts.byDedupeKey`, `alerts.close`, `registerTargetResolver` | §3.8, §3.9, §3.13 |
| 02b | events `OrderPlaced` (with `seating_id`), `OrderLinesAdded`, `ItemRemoved`, `OrderCancelled { order_id }`, 02b's edit events (activity, §3.3); `ItemServed` (03a schema, stream `order`/`order_id`); **`seatingTotals(db, seating_id) → { total_minor }`** (1 statement; until 02b exists, `amount` is left out of the card) | folds, handover card |
| 05 | `BillClosed { seating_id }` = the seating's **last** open bill closed (row To 05) | NEEDS_CLEANING |
| 04 | `registerMergeGuard((db, { seating_ids, order_ids? }) → { blocked, order_item_ids })`; unregistered → never blocked | merge, split |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `tableOwners(db, table_ids[])` | **`Map<table_id, staff_id>`** = holder of the table's open seating (03a's type, unchanged; G4-1 #8) | 1 | 03a (as specified), 04 |
| `seatingOwners(db, table_ids[])` | `Map<table_id, { seating_id, primary_table_id, holder_staff_id, assignee_staff_id \| null }>` | 1 | 03b, 05, client queries |
| `holdersOfOrders(db, order_ids[])` | `Map<order_id, staff_id>` = holder of the order's seating now (through `seating_orders`, after moves, merges, splits) | 1 | 03a slip receivers (R26 row Q-1) |
| `seatingOf(db, table_id)` | `{ seating_id, primary_table_id, table_ids[], state, holder_staff_id } \| null` | 1 | 02b, 05 |
| `currentTableOf(db, order_ids[])` | `Map<order_id, { seating_id, primary_table_id, table_ids[] }>` | 1 | 02b edits, 03b, 05 |
| `requireLock(tx, { table_id, seating_id }, ctx)` | throws `TABLE_NOT_OPEN`, `TABLE_SEATING_CHANGED`, `TABLE_NEEDS_CLEANING` (G4-1 #11), `TABLE_ALREADY_LOCKED`; held by (actor, device) → nothing; free → `[TableLocked]` draft; same actor other device → `[TableLocked { replaced_device_id }]` | 1 | 02b submit and edits |
| `zoneOf(table_id)` | `{ floor_id, zone_id \| null, zone_order_taker_staff_id \| null }` | 0 | 01d resolver, 02b |
| Resolver `table_team` | `fn(tx, targets[])` for `{ kind: 'table_team', table_id, depth?: 'owner' \| 'direct' }` → per target `{ staff_ids, device_ids: [], owner_staff_id }`: `owner` → `[holder]`; `direct` → `W ∪ {holder}` (§3.5) | 1 (`UNION ALL` of open seatings of the targets and the branch's live staff sessions, `staff_sessions_active`) | 01d (D-1) |
| Resolver `zone_order_taker` | per target `{ staff_ids: [zone assignee] }` | 0 | 01d |
| Events, projections, kinds, queries, catch-up | §6.19, §5, §6.14–6.15, §6.17–6.18 | — | all |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 02b | `OrderPlaced` carries `seating_id`; submit and every order edit call `requireLock` with the seating the screen showed; edits resolve the table by `currentTableOf(order_id)`, never the order's stored `table_id`; write `OrderCancelled { order_id }` when no live line is left; list the edit event types that refresh lock activity (§3.3); expose `seatingTotals`; the device queue accepts `RequestBill`, `CleanTable`, `CallWaiter` **with their `seating_id`** and records a drop on `TABLE_SEATING_CHANGED`; no other 02a command is queued. |
| 03a | Slip receivers for `dine_in` groups by `holdersOfOrders(order_ids of the group)` instead of `tableOwners(table_key)` — R26 row Q-1. `table_key` stays the original table. |
| 03b | Show the current table (`currentTableOf`, "T4 + T5"); Ready to serve with `{ kind: 'table_team', table_id, depth: 'direct' }`. |
| 04 | Register `registerMergeGuard`; rejected-void notice with `depth: 'owner'`. |
| 05 | Bill per seating; write `BillClosed { seating_id }` only when the seating's **last** open bill closes (split bills, G4-1 #32); fold `TablesMerged` / `SeatingSplit` for bills already opened; reprint after `bill_requested_at` is cleared. |

### 4.4 Shared types

Event schemas in `@pos/events/src/tables/*.ts`; `TableState` in `@pos/domain`.

### 4.5 Changes to other specs (R26) — **Proposed, needs approval**

| Row | Target | Change |
|---|---|---|
| F-1 | Foundation §4.3 | "serialises all `OpenTable` commands"; FREE → SEATED inside `OpenTable` (T3); the lock belongs to (staff, device) and moves to the same staff's other device (T7, T15). |
| F-2 | Foundation §4.3 D51 | "the role's idle TTL (01b; Order taker 15 min)" instead of "5 min" (R21). |
| F-3 | Foundation §6.2 | Append the §9 codes. |
| Q-1 | **03a §3.8 / §6.2a** | `dine_in` slip receivers: `holdersOfOrders(db, order_ids)` over the group's orders (1 statement) instead of `tableOwners` over `table_key` (G4-1 #9). `tableOwners` stays as 03a specified. |
| A-1 | 01a | `zones` (`zone_id`, `branch_id`, `floor_id`, `name` 1–40, `sort_order`, `archived_at`; unique active name per floor), nullable `tables.zone_id` (same floor; archiving a zone nulls its tables' `zone_id` in the same transaction); cloud migration `NNNN_zones.sql`, **next free number at build time**; admin routes (C1–C9, `Idempotency-Key` on create); **snapshot schema 4**, breaking — **ships in the same release as 03a's V3, before the pilot (R29); fixtures move V3 → V4 once**; sync bound +1. |
| B-1 | 01b | `take-order` (group `orders`, scopes `branch`, `my_floors`; default Owner, Manager, Order taker, Cashier) and `clean-table` (group `orders`, `branch`; default Owner, Manager, Order taker, Waiter, Cashier), by `default_key`; R29 re-seed. |
| B-2 | 01b | Staff form "Assigned tables": `assigned_zone_ids[]`, `assigned_table_ids[]` per branch; one person per zone and per table (`422 CONFIG_REFERENCE_INVALID { reason: 'already_assigned', staff_id }`); directory v3 additive; `StaffDirectory.assignedOrderTaker(table_id)` (§3.6); cloud migration `NNNN_assignments.sql`, next free number at build time. |
| B-3 | 01b §3.3 | `own_tables` = seatings the person holds (T8); 01b:352 text corrected. |
| D-1 | **01d §3.4.2, §4.2 and `alerts/targets.ts`** | For `table_team`: (a) `targetKey` includes the depth (`table_team:<table_id>:<depth>`), so `owner` and `direct` targets for one table in one batch get different lists; (b) `resolveTarget` uses the resolver's `staff_ids` as the full recipient set for both depths and **no longer adds `teamOf(owners)`** (AD-51 reversed for this kind; `targets.ts:411-414`); (c) the absent-owner marker and the zone-order-taker fallback use the resolver's `owner_staff_id` (the holder), not every returned id (`targets.ts:361-370`). Tests: one batch with `owner` + `direct` for one table → two lists; marker once per holder. 01d:721's `tableOwner` reads `tableOwners`. |
| D-2 | 01d §4.4 | "Served card" moves to 03b. |
| R-1 | README | Module map: 02 → 02a (this spec) + 02b; split as a README decision; carried row "01a §6.5 archived table stays billable". |

### 4.6 Carried rows "To 02" after the split (README:160–228)

| README row | Owner | Where |
|---|---|---|
| :160 queued commands after session end (M19, MQ6) | 02b | owner Q8: auto-send in the original name; 02a's queued commands carry `seating_id` (T18) |
| :161 Capacitor LAN transport (MQ7) | 02b + 9b | — |
| :173 pair-page resume (00 N3) | **02a** | §8 Login |
| :174 polled queries not activity (M59) | 02a + 02b | §6.17, §6.18 |
| :176 client stack | 02a + 02b | §8 |
| :177 R5, R14, R15 client rules | 02a + 02b | §8 |
| :178–179, 01a §4.4 rows, :198–202 | 02b | — |
| :183 default grants by `default_key` | **02a** | B-1 |
| :184 Order taker ≠ Waiter | **02a** | B-1 |
| :190 handover with acceptance (R23) | **02a** | §3.8, §3.10–§3.12 |
| :212 stale-save pattern | none | no versioned form in 02a |
| :216 01d To 02 | **02a**: resolvers, handover, call waiter; Served card → 03b (D-2); `order` audience, comp → 02b | §4.2, §6.14–6.16 |
| :218 comp kind | 02b + 05 | — |
| :220 01d data gaps | 02b / 01e | — |
| :228 03a To 02 #2, #6 | **02a** | §3.4, §4.2 |
| :228 03a To 02 #1, #3–#5, #7–#9 | 02b | — |
| 01a §6.5 archived table | 02a + 02b + 05 | §3.14 |

---

## §5. Data model (hub SQLite)

Migration `apps/hub/src/db/migrations/NNNN_tables.sql`, **next free number at build time**.

```sql
CREATE TABLE seatings (
  seating_id        TEXT PRIMARY KEY,
  primary_table_id  TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN
                      ('SEATED','ORDERED','FOOD_ON_TABLE','BILL_REQUESTED','NEEDS_CLEANING','CLOSED')),
  holder_staff_id   TEXT NOT NULL,
  party_size        INTEGER,
  opened_at         INTEGER NOT NULL,
  bill_requested_at INTEGER,
  bill_closed       INTEGER NOT NULL DEFAULT 0 CHECK (bill_closed IN (0,1)),  -- sticky NEEDS_CLEANING
  closed_at         INTEGER,
  close_reason      TEXT CHECK (close_reason IN ('cleaned','left_without_order','merged')),
  merged_into_seating_id TEXT
);
CREATE INDEX seatings_open ON seatings (state) WHERE state <> 'CLOSED';         -- table-map, catch-up

CREATE TABLE seating_tables (                     -- tables of OPEN seatings only
  table_id   TEXT PRIMARY KEY,                    -- one open seating per table (T2)
  seating_id TEXT NOT NULL,
  joined_at  INTEGER NOT NULL
);
CREATE INDEX seating_tables_seating ON seating_tables (seating_id);           -- merge, split, close

CREATE TABLE seating_orders (
  order_id   TEXT PRIMARY KEY,
  seating_id TEXT NOT NULL,
  served_any INTEGER NOT NULL DEFAULT 0 CHECK (served_any IN (0,1)),
  cancelled  INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0,1))            -- fold of 02b's OrderCancelled
);
CREATE INDEX seating_orders_seating ON seating_orders (seating_id);           -- state, merge, split, counts, holdersOfOrders

CREATE TABLE table_locks (                        -- F §4.3; one per seating, keyed by its primary table
  table_id         TEXT PRIMARY KEY,
  seating_id       TEXT NOT NULL,
  staff_id         TEXT NOT NULL,
  device_id        TEXT NOT NULL,
  locked_at        INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  last_touch_at    INTEGER                        -- NULL until the first TableLockTouched (D61, G4-1 #27)
);
CREATE INDEX table_locks_seating ON table_locks (seating_id);                 -- activity fold by seating
```

- Projections `seatings` (writes `seatings`, `seating_tables`, `seating_orders`) and `table_locks`, both with `reset`; they consume: every §6.19 event; `OrderPlaced`, `OrderLinesAdded`, `ItemRemoved`, `OrderCancelled`, 02b's edit events, `ItemServed` (by `stream_id` = `order_id`), `BillClosed`. **Only 02a writes these tables.**
- The tick reads `staff_sessions` (00's) read-only.
- Times are `recorded_at`.

---

## §6. Commands, events and queries

**Common rules.** `POST /commands/:name`, `sessionKind: 'device'`, staff session, D32 idempotency, no PIN. Responses are `200 { data: { command_id, event_ids, result } }` (00); only `result` is listed below. Every command on an open seating carries **`seating_id`** (the one shown); a different current seating → `409 TABLE_SEATING_CHANGED { table_id, seating_id }` (T18); no seating → `409 TABLE_NOT_OPEN`. Archived tables per §3.14. Second permissions per §3.15. Scope checks last (C8, `403 PERMISSION_DENIED { reason: 'outside_scope', table_ids }`).

### 6.1 `OpenTable`

| | |
|---|---|
| Permission | `take-order` (+ `take-order-anywhere` when holder ≠ caller) |
| Payload | `{ table_id, seating_id?: string, party_size?: int 1–50 }` |
| Script | 1. read seating and lock of the table (1 statement); 2. no seating: archived → 404; else `TableOpened` + `TableLocked`; 3. seating: `seating_id` given and ≠ → 409 `TABLE_SEATING_CHANGED`; NEEDS_CLEANING → 409; holder ≠ caller → second permission; lock by (caller, device) → `result: { opened: false }`; lock by caller elsewhere → `TableLocked { replaced_device_id }`; lock by other staff → `TABLE_ALREADY_LOCKED`; no lock → `TableLocked`; 4. scope |
| Result | `{ seating_id, primary_table_id, opened: boolean, holder_staff_id }` |

### 6.2 `TouchTableLock` (D61)

`{ table_id, seating_id }`; `take-order`. Lock not (caller, device) → `409 TABLE_LOCK_NOT_HELD`; `last_touch_at` set and `now − last_touch_at < 50 000` → `result: { touched: false }`; else `TableLockTouched`.

### 6.3 `ReleaseTableLock`

`{ table_id, seating_id }`; `take-order`. Not (caller, device) → `result: { released: false }`; else `TableLockReleased { reason: 'released' }`.

### 6.4 `ForceReleaseTableLock`

`{ table_id, seating_id, reason: 1–120 }`; `force-release-table-lock`. No lock → `{ released: false }`; else `TableLockReleased { reason: 'force', by_staff_id, note }`; scope.

### 6.5 Tick `table_locks`

§3.4. `actor_id = null`, `device_id = 'hub'`.

### 6.6 `TakeOverTable`

| | |
|---|---|
| Permission | `take-order` |
| Payload | `{ table_id, seating_id }` |
| Script | 1. seating checks (T18); NEEDS_CLEANING → 409; 2. seating's assignee ≠ caller → `403 PERMISSION_DENIED { reason: 'not_assigned', assigned_staff_id }` (G4-1 #24: config, not state); 3. holder = caller → `{ changed: false }`; 4. `TableHolderChanged { reason: 'take_over' }`; 5. `closeHandover`; 6. scope |

### 6.7 `RequestTableHandover`

| | |
|---|---|
| Permission | `take-order`; non-holder sender needs `force-release-table-lock` (§3.15) |
| Payload | `{ table_id, seating_id, to_staff_id, note?: ≤ 120 }` |
| Script | 1. seating checks; NEEDS_CLEANING → 409; 2. sender rule → `403 PERMISSION_DENIED { reason: 'not_holder' }`; 3. receiver: `to_staff_id` = holder → `422 HANDOVER_TARGET_INVALID { reason: 'is_holder' }`; = sender → `{ reason: 'is_requester' }`; no `take-order` covering the floor → `{ reason: 'no_permission' }` / `'outside_scope'`; inactive or no live session → `409 HANDOVER_TARGET_UNAVAILABLE { reason: 'inactive' \| 'not_working' }`; 4. `alerts.raise(ctx, { kind: 'table_handover', subject: { stream_type: 'table', stream_id: primary_table_id }, target: { kind: 'person', staff_id: to_staff_id }, values: { table_id, seating_id, from_staff_id: holder }, display, details, dedupe_key: 'table_handover:' + seating_id, requester_staff_id: caller, request: { receiver_staff_id: to_staff_id } })`; `deduped` → `409 TABLE_HANDOVER_PENDING { alert_id, to_staff_id }`; 5. scope |
| Result | `{ alert_id }` |
| Statements | 1 (seating) + `seatingTotals` 1 + 01d's raise bound |

### 6.8 `ForceMoveTable`

`{ table_id, seating_id, to_staff_id, reason: 1–120 }`; `force-release-table-lock`. Seating checks; NEEDS_CLEANING → 409; `to_staff_id` = holder → `{ changed: false }`; receiver checks as 6.7 step 3 (minus `is_requester`: a manager may move a table to himself); `TableHolderChanged { reason: 'force_move', note }`; `closeHandover`; scope.

### 6.9 `MoveTable`

`{ from_table_id, seating_id, to_table_id, reason?: 1–120 }`; `take-order` (holder; else `force-release-table-lock`). Seating checks; > 1 table → `409 TABLE_MERGED`; `to` has a seating → `409 TABLE_NOT_FREE`; `to` archived → 404; R23 rule §3.10 → `409 TABLE_OTHER_OWNER`; lock by other (staff, device) → `TABLE_ALREADY_LOCKED`; `TableMoved { seating_id, from_table_id, to_table_id, by_staff_id, note }` (fold: primary and `seating_tables` → `to`, lock re-keyed); scope both tables. Pending handover kept. Result `{ primary_table_id }`.

### 6.10 `MergeTables`

`{ into_table_id, into_seating_id, table_id, table_seating_id: string | null }`; `take-order` (holder of `S`; absorbing another holder's seating or joining another assignee's table → `force-release-table-lock`, §3.11). Checks per §3.11 (`TABLE_SEATING_CHANGED` if either id differs; NEEDS_CLEANING; `TABLE_ALREADY_LOCKED`; `MERGE_BLOCKED_BY_VOID`; `TABLE_OTHER_OWNER`); `TablesMerged { into_seating_id, into_table_id, table_ids, absorbed_seating_id, order_ids, by_staff_id }`; `closeHandover(S)`, `closeHandover(S2)`; scope all tables. Result `{ seating_id, table_ids }`. Statements: 3 reads + guard.

### 6.11 `SplitSeating`

`{ from_table_id, seating_id, to_table_id, order_ids: string[] (set, C1, ≤ 50) }`; `take-order` (holder; else force; cross-assignee target → force, §3.12). Checks per §3.12; `SeatingSplit { from_seating_id, new_seating_id: string | null, to_table_id, order_ids, by_staff_id }` (`null` = detach); `closeHandover(S)`; scope. Result `{ new_seating_id }`.

### 6.12 `RequestBill`

`{ table_id, seating_id }`; `take-order`. §3.13; `BillRequested { seating_id, table_id, by_staff_id }`; scope.

### 6.13 `CleanTable`

`{ table_id, seating_id }`; `clean-table`. §3.13; `TableCleaned { seating_id, table_ids, reason, by_staff_id }`; `closeHandover`; close the open `call_waiter` (`byDedupeKey` + `close 'obsolete'`).

### 6.14 `CallWaiter` and kind `call_waiter`

`{ table_id, seating_id, chip?: 'water' | 'clear' | 'come' | 'other' }`; `take-order`. `alerts.raise(ctx, { kind: 'call_waiter', subject: { stream_type: 'table', stream_id: primary_table_id }, target: { kind: 'table_team', table_id, depth: 'direct' }, values: { table_id, seating_id, chip }, display, dedupe_key: 'call_waiter:' + seating_id, requester_staff_id: caller })`; `deduped` → `result: { alert_id, repeated: true }`.

```typescript
defineAlertKind({
  kind: 'call_waiter', family: 'action', subject: 'table',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
  closes_on: { after_ms: 300_000 },          // not 'seen' (single-recipient rule, AD-107; G4-1 #7)
  values_schema: z.object({ table_id: z.string().min(1), seating_id: z.string().min(1),
                            chip: z.enum(['water','clear','come','other']).optional() }),
  details_schema: null, lead_fallback: true, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.call_waiter.card', lock: 'alert.call_waiter.lock' },
  request: null,
});
```

### 6.15 Kind `table_handover`

```typescript
defineAlertKind({
  kind: 'table_handover', family: 'action', subject: 'table',
  steps: [
    { at: { ms: 0 },       to: [{ target: 'raised_target',  set: 'answerer' }] },
    { at: { ms: 60_000 },  to: [{ target: 'raised_target',  set: 'answerer' }] },   // remind (A14)
    { at: { ms: 120_000 }, to: [{ target: 'requester_lead', set: 'informed' }] },   // sender's lead (G0-1)
  ],
  closes_on: 'owner',                          // 02a closes it 'obsolete' (§3.9); requests never expire
  values_schema: z.object({ table_id: z.string().min(1), seating_id: z.string().min(1), from_staff_id: z.string().min(1) }),
  details_schema: AlertDetailsBase.pick({ quantity: true, amount: true }),   // order count, running total (G4-1 #16)
  lead_fallback: false,
  expires_at_day_close: true,                  // required field; no effect on a request kind (01d:148)
  silent: false,
  labels: { card: 'alert.table_handover.card', lock: 'alert.table_handover.lock' },
  request: {
    answers: ['accept', 'decline'],
    right: { mode: 'named' },
    needs_pin: 'never',
    apply(ctx, answer),                        // §3.8: accept → TableHolderChanged, or throw TABLE_HANDOVER_STALE; decline → []
    onWithdraw: () => [],
  },
});
```

### 6.16 Resolvers

`registerTargetResolver('table_team', tableTeam)` (§4.2; 1 statement); `registerTargetResolver('zone_order_taker', …)` (0 statements). Both batch-shaped; results keyed per D-1.

### 6.17 `GET /queries/table-map`

Staff session; `deviceTypes: ['tablet', 'phone', 'cashier_kiosk']`; `countsAsActivity: false`. Query `{ floor_id?: string }`. Result `{ as_of_seq, floors: [{ floor_id, name, zones: [{ zone_id | null, name | null, tables: [{ table_id, name, seats, archived, state, seating_id | null, primary_table_id | null, joined_table_names, holder: { staff_id, name } | null, assignee: { staff_id, name } | null, lock: { staff_id, name, mine: boolean } | null, opened_at | null, bill_requested_at | null, live_order_count }] }] }] }` — `mine` computed for the asking (staff, device); archived tables only while seated. Statements: **3 + 1** (open seatings with tables; locks; live order counts; `last_seq`).

### 6.18 `GET /queries/handover-candidates`

Staff session; `countsAsActivity: false`. Query `{ table_id }`. Result `{ staff: [{ staff_id, name, is_assignee, working, tables_held }] }` — `take-order` holders covering the floor, holder and caller excluded; working first. Statements: 2.

Catch-up part **`tables`**: the §6.17 builder for the socket's (staff, device).

### 6.19 Events (`table` stream, `schema_version` 1; **no session ids**, T7)

| Event | Stream | Payload | Fold |
|---|---|---|---|
| `TableOpened` | table | `{ table_id, seating_id, holder_staff_id, party_size: int \| null }` | seating SEATED, `seating_tables` |
| `TableLocked` | primary | `{ table_id, seating_id, staff_id, replaced_device_id?: string }` (device = envelope `device_id`) | upsert lock |
| `TableLockTouched` | primary | `{ table_id, seating_id }` | `last_touch_at`, activity |
| `TableLockReleased` | primary | `{ table_id, seating_id, staff_id, reason: 'released' \| 'force' \| 'session_expired' \| 'lock_ttl', by_staff_id?, note? }` | delete lock |
| `TableHolderChanged` | primary | `{ table_id, seating_id, from_staff_id, to_staff_id, reason: 'take_over' \| 'handover' \| 'force_move', by_staff_id, alert_id?, note? }` | holder |
| `TableMoved` | from table | `{ seating_id, from_table_id, to_table_id, by_staff_id, note? }` | primary, tables, lock key |
| `TablesMerged` | into table | `{ into_seating_id, into_table_id, table_ids, absorbed_seating_id: string \| null, order_ids, by_staff_id }` | join / absorb, absorbed lock deleted |
| `SeatingSplit` | from table | `{ from_seating_id, new_seating_id: string \| null, to_table_id, order_ids, by_staff_id }` | new seating or detach |
| `BillRequested` | primary | `{ seating_id, table_id, by_staff_id }` | `bill_requested_at` |
| `TableCleaned` | primary | `{ seating_id, table_ids, reason: 'cleaned' \| 'left_without_order', by_staff_id }` | CLOSED, tables freed, lock deleted |

**Audiences:** every event to staff sockets and cashier kiosks of the branch (ids only, no totals); `TableMoved`, `TablesMerged`, `SeatingSplit` also to KDS stations.

**Size:** 13 commands (6.1–6.4, 6.6–6.14) + 1 tick + 2 kinds + 2 queries + 1 catch-up.

---

## §7. Cross-cutting

| Item | Decision | Justification |
|---|---|---|
| Tick | idle = 1 indexed statement; pass = 1 read + 1 append | 500 ms loop, ~60 locks |
| Boot | projections replay from checkpoint (00 M48); nothing else | lock state is events only (T7) |
| Performance | `table-map` p99 < 50 ms at 80 tables / 40 seatings; `OpenTable` p99 < 30 ms | first tap of every order |
| Logs | `table_id`, `seating_id`, `command_type`, `reason`; no names, no totals | disputes without money leaks |
| Rate limits | none beyond D61 and the two dedupe keys | ≤ 10 devices per branch |
| Privacy | no session ids in events (T7); the running total only on the receiver's handover card | 00 keeps sessions per socket |

---

## §8. Client contract (`apps/client`, 01d's `/staff/` entry, ui-kit only)

- **Login** (README:173, 00 N3): the staff entry starts from `GET /queries/staff-roster`; `401 DEVICE_TOKEN_INVALID` / `403 DEVICE_REVOKED` wipe the stored token and go to `/pair`.
- **Table map:** floor → zone tiles (icon + word, names, "T4 + T5", holder initials, assignee when ≠ holder, padlock + name, time open); filter "Mine". Every action sends the tile's `seating_id`.
- **Open:** `TABLE_ALREADY_LOCKED` → "Ali is taking an order here", Force release (permission, reason chips); the draft stays.
- **Order screen** (02b): Touch once a minute (D61); Release on leaving.
- **Banners:** my lock released → "Your table was released (reason)"; `TableLocked { replaced_device_id = mine }` → "Opened on another device"; **`TableHolderChanged` away from me while my order screen is open → "Bilal now has this table: Send your order or keep it as a draft", then Release** (G4-1 #33). Drafts are never dropped.
- **Table sheet:** Take over (assignee), Hand over (candidates, working first), Force move (permission), Move, Merge, Split, Ask for bill, Clean, Call waiter (chips); `TABLE_OTHER_OWNER` → "Hand it over first" with the Hand over button.
- **Handover waiting card** (sender, 01d AD-1): "Waiting for Bilal — 0:42", Withdraw (01d `WithdrawRequest`, the sender is the requester).
- **Top bar:** Requests (n) + Inbox (n) (01d AD-168).
- **Offline:** Open, Take over, Hand over, Force, Move, Merge, Split disabled ("Needs the hub"); Ask for bill, Clean, Call waiter go to 02b's queue with their `seating_id`; `TABLE_SEATING_CHANGED` on replay → dropped, shown in the queue log. Touch and Release dropped.
- **Rules:** buttons from effective permissions (R5); Urdu / English, Latin digits (R20); no service worker except the flagged kiosk, no secure-context APIs, ULIDs from `crypto.getRandomValues` (R14, R15).

---

## §9. Error catalogue additions (Foundation §6.2, `@pos/domain/src/errors.ts`)

| Code | Status | `details` | When |
|---|---|---|---|
| `TABLE_NEEDS_CLEANING` | 409 | `{ table_id }` | any seating action on NEEDS_CLEANING except Clean |
| `TABLE_NOT_OPEN` | 409 | `{ table_id }` | seating command on a FREE table |
| `TABLE_SEATING_CHANGED` | 409 | `{ table_id, seating_id }` | the seating shown is no longer the current one (T18) |
| `TABLE_HANDOVER_PENDING` | 409 | `{ table_id, alert_id, to_staff_id }` | second handover |
| `TABLE_HANDOVER_STALE` | 409 | `{ table_id, seating_id }` | accept after the seating closed, waits for cleaning, or changed holder |
| `HANDOVER_TARGET_INVALID` | 422 | `{ reason: 'is_holder' \| 'is_requester' \| 'no_permission' \| 'outside_scope' }` | bad receiver (config / request shape) |
| `HANDOVER_TARGET_UNAVAILABLE` | 409 | `{ reason: 'inactive' \| 'not_working' }` | receiver not working now (state) |
| `TABLE_NOT_FREE` | 409 | `{ table_id }` | move / split target has a seating |
| `TABLE_MERGED` | 409 | `{ seating_id, table_ids }` | moving a merged seating |
| `TABLE_OTHER_OWNER` | 409 | `{ table_id, assigned_staff_id \| null, holder_staff_id \| null }` | cross-owner move / merge / split without the force permission (R23) |
| `MERGE_BLOCKED_BY_VOID` | 409 | `{ order_item_ids }` | 04's guard |
| `SPLIT_INVALID` | 409 | `{ reason: 'empty' \| 'all_orders' \| 'not_in_seating', order_ids? }` | split against the seating's current orders |
| `TABLE_NO_ORDERS` | 409 | `{ table_id }` | bill request on SEATED |
| `TABLE_HAS_OPEN_ORDERS` | 409 | `{ table_id, order_count }` | clean before the bill closed |

Reused: `TABLE_NOT_FOUND` (404, `{ table_id }`, already in `errors.ts:32`), `TABLE_ALREADY_LOCKED`, `TABLE_LOCK_NOT_HELD`, `PERMISSION_DENIED` (reasons `outside_scope`, `not_holder`, `not_assigned`), `VALIDATION_FAILED`.

---

## §10. Tests (`apps/hub/test/tables/*.test.ts`)

Every command: happy path, each error code, D32 retransmit, scope (C8), stale `seating_id`. Listed where more is needed.

| # | Test |
|---|---|
| 1 | Open FREE → `TableOpened` + `TableLocked` (device from envelope), SEATED |
| 2 | Open again on the same device → no event |
| 3 | Same staff, other device → `TableLocked { replaced_device_id }`; old device Touch → `TABLE_LOCK_NOT_HELD` |
| 4 | Other staff → `TABLE_ALREADY_LOCKED` with name |
| 5 | Holder ≠ caller: without `take-order-anywhere` → 403; with a `requires_approval` grant → 403 (§3.15); with `allowed` → lock, holder kept |
| 6 | Two opens on one FREE table → one seating |
| 7 | Touch: first touch within 50 s of the lock writes (`last_touch_at` null); then < 50 s no write (D61) |
| 8 | Tick: TTL → `lock_ttl`; session ended → `session_expired`; at exactly `ttl` neither `due` nor a write; idle → one statement, no `writer.run` |
| 9 | **Lock activity is a fold:** a 02b `OrderPlaced` by the lock's (staff, device) refreshes `last_activity_at`; the same event by another device does not; after `reset` + replay the lock row is identical and the tick does not release early |
| 10 | Take-over by the assignee → holder changes, lock kept, pending handover `AlertClosed 'obsolete'` and a result to its sender |
| 11 | Take-over by a non-assignee → 403 `not_assigned`; on NEEDS_CLEANING → 409; outside scope → 403 |
| 12 | Handover accept → `TableHolderChanged { handover }`, `to_staff_id` = answerer |
| 13 | Accept after `BillClosed` → 409 `TABLE_HANDOVER_STALE`, request still open; Clean then closes it `obsolete` |
| 14 | Decline → no 02a event |
| 15 | Second handover → `TABLE_HANDOVER_PENDING`; receiver not working → 409 `HANDOVER_TARGET_UNAVAILABLE`; receiver = sender → 422 `is_requester` |
| 16 | Steps at 60 s and 120 s (fake clock) |
| 17 | Force move → holder with note, handover closed; to the holder → `changed: false` |
| 18 | `waiterTeam`: assignee's working reports + holder |
| 19 | `waiterTeam`: assignee's reports all off → holder's working reports + holder |
| 20 | `waiterTeam`: nobody working → `[holder]` |
| 21 | Resolver: one batch with `owner` and `direct` targets for one table → `[holder]` and `W ∪ {holder}`; 1 statement for 40 targets; `owner_staff_id` = holder (D-1) |
| 22 | Move → seating, orders, lock follow; handover kept; `holdersOfOrders` gives the moved party's holder after a new party opens the old table |
| 23 | Move merged → `TABLE_MERGED`; to busy → `TABLE_NOT_FREE`; to another assignee's table without force → `TABLE_OTHER_OWNER`; with force → moved |
| 24 | Merge FREE table → joins; "T4 + T5" |
| 25 | Merge absorbing own seating → orders move, absorbed CLOSED `merged`, its lock gone, both handovers closed |
| 26 | Merge absorbing another holder's seating without force → `TABLE_OTHER_OWNER`; with force → merged |
| 27 | Merge blocked by the 04 guard stub; other side locked by another device → `TABLE_ALREADY_LOCKED` |
| 28 | Split orders to FREE → new seating, same holder; cross-assignee target without force → `TABLE_OTHER_OWNER` |
| 29 | Detach a joined table with no orders → the table is FREE, no new seating |
| 30 | Split all / foreign orders → 409 `SPLIT_INVALID` |
| 31 | RequestBill; repeat → `requested: false`; new `OrderPlaced` and **`OrderLinesAdded`** after the bill → ORDERED, `bill_requested_at` cleared |
| 32 | `BillClosed` → NEEDS_CLEANING; Open / Merge / Handover / `requireLock` → 409 `TABLE_NEEDS_CLEANING`; Clean → FREE |
| 33 | Every order cancelled → SEATED; Clean → `left_without_order` |
| 34 | Clean with live orders → `TABLE_HAS_OPEN_ORDERS` |
| 35 | CallWaiter → to `W ∪ {holder}`; repeat → `repeated: true`; closes after 5 min; Clean closes it `obsolete` |
| 36 | table-map: 3 + 1 statements at 80 tables; `mine` per device; archived table shown while seated |
| 37 | handover-candidates: working first; holder and caller excluded |
| 38 | Projection reset + replay → identical tables (incl. activity) |
| 39 | COMMIT failure during OpenTable → no seating, no lock |
| 40 | Archived seated table: Bill, Clean, Move-from work; Open on a FREE archived table → 404 |
| 41 | ForceReleaseTableLock: note, banner event, no lock → `released: false` |
| 42 | `TableMoved` re-keys the lock; Touch on the new table works |
| 43 | Open on a joined table locks the primary |
| 44 | **Queued Clean with an old `seating_id`** after a new party sat → `TABLE_SEATING_CHANGED`, the new seating untouched |
| 45 | `requireLock` with a moved order's old table → `TABLE_SEATING_CHANGED`; through `currentTableOf` → passes |

### Acceptance

| AC | Tests |
|---|---|
| E2-TBL AC1 | 1, 31–34 |
| AC2–AC3 | 4, 6, 36 |
| AC4 | 5, 10, 11, 18–21 |
| AC5 | 41 |
| AC6a | 7, 8, 9 |
| AC6b | 22, 23 |
| AC7 | 24–27 |
| AC8 | 28–30 |
| E2-HAND AC1–AC6 | 12–17, 23, 26 |

---

## §11. Build order (one task per commit, TDD)

1. Approved bumps first (not 02a tasks): 01a A-1, 01b B-1–B-3, 01d D-1 (with its tests), 03a Q-1.
2. `@pos/events/src/tables/*` (§6.19); `@pos/domain` `TableState`, §9 codes.
3. Migration `NNNN_tables.sql` (§5).
4. Projection `seatings` with the state fold (§3.1) and `reset` (tests 31–33, 38).
5. Projection `table_locks` with the activity fold (§3.3; test 9).
6. Reads: `tableOwners`, `seatingOwners`, `holdersOfOrders`, `seatingOf`, `currentTableOf`, `zoneOf` (§4.2).
7. `waiterTeam` + resolver `table_team`, `zone_order_taker` (§3.5, §6.16; tests 18–21).
8. `requireLock` (§4.2; tests 32, 45).
9. `OpenTable` (tests 1–6, 39, 43).
10. Touch, Release, ForceRelease (tests 7, 41).
11. Tick (test 8).
12. `closeHandover` + kind `table_handover` + `RequestTableHandover` (tests 12–16).
13. `TakeOverTable`, `ForceMoveTable` (tests 10, 11, 17).
14. `MoveTable` (tests 22, 23, 42).
15. `MergeTables` + `registerMergeGuard` (tests 24–27).
16. `SplitSeating` (tests 28–30).
17. `RequestBill`, `CleanTable` (tests 31–34, 40, 44).
18. Kind `call_waiter` + `CallWaiter` (test 35).
19. Queries, catch-up, audiences (tests 36, 37).
20. Client (§8), Playwright flows.

Files: `apps/hub/src/tables/`, `apps/hub/test/tables/`, `packages/events/src/tables/`, `apps/client/src/staff/tables/`.

---

## §12. Definition of Done, checklist, questions, deferred, reviews

### 12.1 Definition of Done

All §10 tests pass; per-command happy / error / retransmit / scope / stale-seating tests; replay identity (38, 9); statement counts (8, 21, 36); §4.5 rows approved and applied with markers (R26); README updated (R-1); §8 flows pass on a tablet and a phone.

### 12.2 Endpoint checklist

| # | Name | Kind | Permission | Events | Errors |
|---|---|---|---|---|---|
| 6.1 | OpenTable | command | take-order (+ anywhere) | TableOpened, TableLocked | 404, 409×3, 403 |
| 6.2 | TouchTableLock | command | take-order | TableLockTouched | 409×2 |
| 6.3 | ReleaseTableLock | command | take-order | TableLockReleased | 409 |
| 6.4 | ForceReleaseTableLock | command | force-release-table-lock | TableLockReleased | 409, 403 |
| 6.5 | table_locks | tick | — | TableLockReleased | — |
| 6.6 | TakeOverTable | command | take-order | TableHolderChanged, AlertClosed | 409×3, 403 |
| 6.7 | RequestTableHandover | command | take-order (+ force) | AlertRaised; TableHolderChanged on accept | 409×5, 422, 403 |
| 6.8 | ForceMoveTable | command | force-release-table-lock | TableHolderChanged, AlertClosed | 409×4, 422, 403 |
| 6.9 | MoveTable | command | take-order (+ force) | TableMoved | 404, 409×6, 403 |
| 6.10 | MergeTables | command | take-order (+ anywhere / force) | TablesMerged, AlertClosed | 404, 409×6, 403 |
| 6.11 | SplitSeating | command | take-order (+ force) | SeatingSplit, AlertClosed | 404, 409×6, 403 |
| 6.12 | RequestBill | command | take-order | BillRequested | 409×4, 403 |
| 6.13 | CleanTable | command | clean-table | TableCleaned, AlertClosed | 409×3 |
| 6.14 | CallWaiter | command | take-order | AlertRaised | 409×3 |
| 6.17 | table-map | query | session | — | — |
| 6.18 | handover-candidates | query | session | — | 404 |

### 12.3 Open questions

None. OQ1–OQ3 decided (developer, 2026-11-06): bill alert → 05; `clean-table` defaults; four fixed chips. **For the developer to confirm** (not owner questions): T6's reading of R23 for merge and cross-assignee moves (force permission or hand over first).

### 12.4 Deferred until needed

Pass pick-up identity (owner round 2); hub-side assignment screen (owner Q1); per-line moves (bill split is 05's); configurable colours and call chips; reservations (P2); moving a merged seating in one step; approval flow for the handler-checked second permissions (§3.15).

### 12.5 Hostile self-review (v0.4)

| Area | Finding | Handling |
|---|---|---|
| Race | Take-over and accept in one tick | Take-over closes the request first; a later accept gets 01d's `REQUEST_NOT_PENDING`. |
| Race | Queued command on the next party | `seating_id` on every seating command (T18, test 44). |
| Replay | Lock activity | Fold only (T7, test 9). |
| Contract | 03a `tableOwners` type | Kept; new `holdersOfOrders` + Q-1. |
| Contract | 01d `table_team` semantics | D-1 (a)–(c), test 21. |
| Owner rule | Holder in waiter alerts | `W ∪ {holder}` (T4). |
| Owner rule | R23 through merge / move | T6, `TABLE_OTHER_OWNER`. |
| Over-engineering | `source` field, empty detach seating, in-memory tick map | Removed. |

### 12.6 G4 run 1 closure (`02a_v0.3_hostile_run1.md`)

| # | Fix in v0.4 | # | Fix in v0.4 |
|---|---|---|---|
| 1 | D-1 (a)–(c), resolver `owner_staff_id`, test 21 | 18 | live = `ended_at IS NULL`, `staff_sessions_active(_device)` |
| 2 | `direct` = `W ∪ {holder}` (owner Q2 as written) | 19 | `>` in `due` and `intents`, test 8 |
| 3 | lock = (staff, device), activity fold, test 9 | 20 | seating's assignee = primary's (T10) |
| 4 | `closeHandover` = `byDedupeKey` + `close 'obsolete'` | 21 | `apply` by `seating_id`; move keeps; merge / split close |
| 5 | `apply` throws `TABLE_HANDOVER_STALE`; tests 13 | 22 | empty detach frees the table |
| 6 | `is_requester`; test 15 | 23 | `TABLE_NOT_FOUND` reused |
| 7 | `closes_on: { after_ms: 300_000 }`, Clean closes | 24 | `HANDOVER_TARGET_UNAVAILABLE` 409; `SPLIT_INVALID` 409; `not_assigned` 403 |
| 8 | `tableOwners` unchanged; `seatingOwners` | 25 | `result` notation (§6 common rules) |
| 9 | `holdersOfOrders` + R26 Q-1 | 26 | §3.15; Take-over scope + NEEDS_CLEANING; ForceMove to holder |
| 10 | no live order → SEATED; test 33 | 27 | `last_touch_at` nullable; test 7 |
| 11 | `requireLock` refusals; `currentTableOf` for edits; test 45 | 28 | stale text refreshed (13 commands, 3 + 1, no §6.17) |
| 12 | `OrderLinesAdded` folded; test 31 | 29 | sender-view claim dropped |
| 13 | §3.14; test 40 | 30 | `expires_at_day_close` noted; `to_staff_id` from `answer` |
| 14 | T6, `TABLE_OTHER_OWNER`; tests 23, 26, 28 | 31 | no session ids in events (T7) |
| 15 | T18 `TABLE_SEATING_CHANGED`; test 44 | 32 | To 05: last bill; merge / split folds |
| 16 | card via `AlertDetailsBase` (`quantity`, `amount`); `seatingTotals` from 02b | 33 | §8 banner on holder change |
| 17 | `source` dropped; `waiterTeam` unit-tested | | |
