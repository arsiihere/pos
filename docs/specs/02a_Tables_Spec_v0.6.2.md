# 02a Tables — Module Spec

| | |
|---|---|
| Doc type | Module spec (Module mode, 12 sections, README checklist) |
| Version | **v0.6.2 — DRAFT, ready for owner approval** (developer, 2026-11-06). v0.6.2 = v0.6.1 + the text fixes of `docs/reviews/02a_v0.6.1_targeted_check.md` (APPROVE WITH NOTES: M-1, M-2 and two observations), no re-check needed (the review says so). Open for the owner: OQ4 (§12.3) and the R26 rows of §4.5. |
| Module | **02a Tables** — seatings, table state, table lock, holder and assignment, take-over, handover with acceptance, force move, move / merge / split, bill request, cleaning, call waiter, zones and `zoneOf`, the owner / team reads other modules use. **02b Ordering** (next spec) owns orders, Served, returns, comps, zone stock, takeaway token, the device command queue. |
| Depends on | Foundation **v1.9**; 00 **v1.7**; 01a **v2.1**; 01b **v1.5**; 01d **v1.1.1** (spec and as-built code `apps/hub/src/alerts/`); 03a **v1.0** |
| Read by | 02b, 03a, 01d (resolvers), 03b, 04, 05, 07 (R25) |
| Sources | `docs/stories/02-g0.md` (G0 + owner answers §5.4, 2026-11-06), `stories-refined.md` E2-TBL, E2-HAND (`01d-notifications-teams-refined.md`), `docs/design/inventory/02-ordering-tables.md`; reviews `02a_v0.2_g2_completeness.md`, `02a_v0.3_hostile_run1.md` |
| Inherits | Shared Standards from **Foundation v1.9 §6**. Not redefined here. |

### Changelog

| Version | Change |
|---|---|
| v0.6.2 | Text only (`02a_v0.6.1_targeted_check.md`): M-1 §3.8 names test 52 only; M-2 To 03a says `'dine_in:' + seating_id`; §12.2 row 6.10 says "either side"; test 55's log line is written live only, not on replay. |
| v0.6.1 | Targeted check (`02a_v0.6_targeted_check.md`): **N-1** the `dine_in` key keeps 03a's format, `'dine_in:' + seating_id` instead of `'dine_in:' + table_id` — new R26 row **Q-2** against 03a §3.2 (03a:241); the fold strips the prefix; **N-2** merge needs force when **any** table of either side is assigned to someone other than the caller (mirror absorb closed); N-3 §2 "re-acquires" holder-only; N-4 test 46; N-5 §3.8 sentence order. |
| v0.6 | G4 run 3 (`02a_v0.5_hostile_run3.md`) closed, see §12.8: `TableLockReleased` carries `alert_id` when the handover `apply` writes it (01d `checkAlertIds`); **a non-holder never takes a free lock in `requireLock`** and the old holder's banner offers "Keep as draft"; absorbing onto a table assigned to someone else needs force (T6 closed through the merge path); **the fold maps `dine_in` orders to their seating by `table_key`** (no new `OrderPlaced` field; other order types ignored); minors (tests 10 / 22, Q-1 tie = oldest order in 03a, merged-party slip groups, `details: {}`, stale `seating_id` on Open, call-waiter recipients, holder clause, To 03b Ready-to-serve on party changes, kinds registered at boot, `party_size` on the map). |
| v0.5 | G4 run 2 (`02a_v0.4_hostile_run2.md`) closed, see §12.7: **one projection `tables`** writes all four tables (no cross-projection read in catch-up); `requireLock` applies the holder rule; **a holder change releases the old holder's lock** (`holder_changed`); R23 rule compares the **caller** with the target table's assignee (hand over to that person, who then moves it); `table_key = seating_id` for `dine_in` (02b) with a Q-1 tie rule; empty-seating handover card; no live order → SEATED before BILL_REQUESTED; minors (D-1 gaps, step-target notation, `TABLE_OTHER_OWNER` → 403, call waiter skips the caller (D-3), counts, tick predicate, split lock guard, YAGNI leftovers). |
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

Seating lifecycle and table state; table lock; holder vs assigned order taker; take-over; handover with acceptance; force move; move, merge, split; bill request; cleaning; call waiter; zones and `zoneOf`; `tableOwners`, `holdersOfOrders`, `seatingOf`, `currentTableOf`, `requireLock`, the `table_team` / `zone_order_taker` resolvers; queries `table-map`, `handover-candidates`; catch-up part `tables`.

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
| T6 | **R23: a party never lands on someone else without them** (owner rule, README:123). A holder change to someone else needs acceptance (handover) or the force permission (`force-release-table-lock`, audited). A move, join or split onto a table **assigned to a person other than the caller** needs that person to act: the caller hands the seating over to them, and they move it; or a force holder does it. Absorbing a seating held by someone else likewise: hand over first, or force. | R23 bypassed by merge or move (G4-1 #14) without a dead end (G4-2 #4). | R23; E2-HAND AC1 |
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
| T19 | **One projection `tables`** writes `seatings`, `seating_tables`, `seating_orders` and `table_locks`, so every fold sees all four tables as of that event, live and in catch-up. | The activity fold reading another projection's final state during catch-up (`projections/registry.ts:89-112`; G4-2 #1). | G4-2 #1 |
| T20 | **A holder change releases a lock held by anyone else** in the same transaction (`TableLockReleased { reason: 'holder_changed' }`); the old holder's draft stays on his device. | Ali taking over and still waiting up to 15 min for Bilal's pocketed tablet (G4-2 #3). | T5 |
| T21 | **The `dine_in` table key names the seating:** 02b sets `OrderPlaced.table_key = 'dine_in:' + seating_id` — 03a's format `order_type + ':' + id` (03a:241) with the seating instead of the table (R26 row **Q-2**; no new field in 03a's v1 schema). A slip group never holds two parties and is stable across moves; a merged party may have one group per original seating (accepted). 02a's fold maps a `dine_in` order to its seating by stripping the `dine_in:` prefix (N-1). | Two parties in one `slip:<table_key>` alert after a move (G4-2 #5); a silently ignored order (G4-3 #4, N-1). | 03a:241, :476 |

---

## §2. Existing architecture that must not change

- **Foundation §4.3:** lock projection `table_locks`; `TABLE_ALREADY_LOCKED` with the locker's name; D39; D51 auto-release by **02's own tick** (F-2); D61 `TouchTableLock` (holder check → `TABLE_LOCK_NOT_HELD`; no `TableLockTouched` yet, or ≥ 50 s since the last → write; else success without writing); force release audited; a submit re-acquires a free lock (02b) — **for the holder only**; a non-holder's submit never takes a free lock (§4.2 `requireLock`, G4-3 #2; N-3).
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
- **State fold** (one function, run after every folded event of the seating): NEEDS_CLEANING if set by `BillClosed` (sticky); else **SEATED if there is no live order** (checked before the bill, G4-2 #7); else BILL_REQUESTED if `bill_requested_at` is set; else ORDERED if any live order has `served_any = 0`; else FOOD_ON_TABLE.
- `bill_requested_at` is cleared by `OrderPlaced`, by `OrderLinesAdded` (G4-1 #12; this includes a return-to-kitchen line, so 05 reprints an unchanged bill — accepted, G4-2 #13), by a merge that brings an order, and by `OrderCancelled` when no live order is left.
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
- **Activity refresh is a fold** (T7) of the one projection `tables` (T19): `last_activity_at = recorded_at` on each of these events whose envelope `actor_id = lock.staff_id AND device_id = lock.device_id` and whose seating (for `OrderPlaced` of `order_type = 'dine_in'` from its `table_key` (prefix `dine_in:` stripped, T21); for later order events through `seating_orders`, **as of that event** — same projection, same fold order) is the lock's: every 02a `table`-stream event of §6.19, and 02b's `OrderPlaced`, `OrderLinesAdded`, `ItemRemoved` and its edit event types (added to this list by row P-1 when 02b is approved). `requireLock` on a held lock writes nothing.
- Released by `ReleaseTableLock`, `ForceReleaseTableLock` (reason), the tick (§3.4), **a holder change when the lock is someone else's** (T20: `TakeOverTable`, `ForceMoveTable` and the handover `apply` append `TableLockReleased { reason: 'holder_changed' }` in the same transaction), and inside the folds of `TableCleaned` and `TablesMerged` (absorbed side). Moves with `TableMoved` and to the same staff's other device (T15).
- A release never discards the device's draft.

### 3.4 Lock tick `table_locks`

- `registerTick({ name: 'table_locks', due(db, state, now), intents(tx, state, now) })`.
- **Live staff session of (staff, device)** = a `staff_sessions` row with that `staff_id` and `device_id`, `kind IN ('staff','station')` (so SQLite proves the partial index `staff_sessions_active_device` applies; station rows have `staff_id` NULL and never match) and `ended_at IS NULL` (the sweeper owns expiry).
- **`due`**: one statement — `SELECT 1 FROM table_locks l WHERE NOT EXISTS (SELECT 1 FROM staff_sessions s WHERE s.device_id = l.device_id AND s.staff_id = l.staff_id AND s.kind IN ('staff','station') AND s.ended_at IS NULL) OR :now - l.last_activity_at > :ttl LIMIT 1`. The outer scan reads ≤ ~60 lock rows (no index needed); the inner lookup uses `staff_sessions_active_device` (asserted with `EXPLAIN QUERY PLAN` in test 8).
- **`intents`**: one read with the same predicate returning the rows; no live session → `TableLockReleased { reason: 'session_expired' }`; else `now − last_activity_at > ttl` → `reason: 'lock_ttl'`. **Same comparison (`>`) in both** (G4-1 #19). 1 read + 1 append per pass.
- `ttl` = `branchConfig().engine_settings.table_lock_ttl_ms`.
- A new sign-in by the same staff on the same device does **not** keep the lock: the old session's end releases it (`session_expired`); the draft stays on the device and the next submit re-acquires a free lock.

### 3.5 Holder, alerts and the waiter team

- Holder set at open; changed only by `TableHolderChanged` (take-over, accepted handover, force move); move, merge and split never change it (G4-3 #11).
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

- Caller = the seating's assignee, holds `take-order`, scope covers the floor (C8, last), ≠ holder; seating not NEEDS_CLEANING → `TableHolderChanged { reason: 'take_over' }`; a lock held by anyone else → `TableLockReleased { reason: 'holder_changed' }` (T20); the seating's pending handover is closed `obsolete` (§3.9).

### 3.8 Handover with acceptance (`RequestTableHandover`, kind `table_handover`)

- Sender = the holder, or a person holding `force-release-table-lock`. Receiver: holds `take-order` covering the floor, active, **working** (a live staff session), ≠ holder, **≠ the sender** (a manager taking a table uses `ForceMoveTable`, G4-1 #6).
- One pending handover per seating (dedupe key `table_handover:<seating_id>`; `deduped: true` → `409 TABLE_HANDOVER_PENDING`). Not on NEEDS_CLEANING.
- Kind: §6.15. Card: `display` carries the table names and the sender's name; `details` (AlertDetailsBase) `quantity` = live order count and `amount` = running total (`seatingTotals` from 02b, §4.1) — **both keys omitted, sent as `details: {}`, when the seating has no live order** (`quantity` is `min(1)` and `details_schema` is a `z.object`, so neither `quantity: 0` nor a missing `details` passes; G4-2 #6, G4-3 #8), and `amount` omitted until 02b is built.
- **Accept** → `apply(ctx & { alert }, answer)` reads the seating by `alert.values.seating_id` (1 statement). If it is open, not NEEDS_CLEANING, and its holder = `alert.values.from_staff_id`, `apply` returns `TableHolderChanged { table_id: <the seating's current primary>, reason: 'handover', alert_id, from_staff_id, to_staff_id: answer.answerer_staff_id, by_staff_id: answer.answerer_staff_id }`, plus `TableLockReleased { reason: 'holder_changed', alert_id }` when the lock is someone else's (T20). Otherwise it **throws `409 TABLE_HANDOVER_STALE`** and the request stays open. Separately, a build rule: **every draft `apply` returns carries `alert_id` = the alert's id**; a draft without it fails 01d's `checkAlertIds` with a plain `Error` (500), so test 52 asserts it (`alerts/commands/request-row.ts:107-113`; N-5). Because every holder change and every party change closes the handover in its own transaction (below), the only reachable stale case is **NEEDS_CLEANING** (bill paid before the answer); the other checks stay as defence (G4-2 #19).
- **Decline** → `apply` returns `[]`; 01d tells the sender.
- **Closing a pending handover** (`obsolete`, §3.9): take-over, force move, **every party change** (move, merge — either side —, split of the source), clean. One rule, so the card never shows a table the party has left (G4-2 #10).
- Day close does not close requests (01d:148); `CleanTable` does.

### 3.9 Closing a pending handover

`closeHandover(ctx, seating_id, note)` (internal): `alerts.byDedupeKey(db, 'table_handover', 'table_handover:' + seating_id)` (1 statement) → if found, `alerts.close(ctx, alert_id, 'obsolete', note)` drafts appended in the same transaction (`AlertClosed`, and 01d's result to the sender). Never `WithdrawRequest` (requester-only, G4-1 #4).

### 3.10 Move (`MoveTable`)

- A seating with **one** table moves to a FREE, non-archived table (`TABLE_MERGED` for a merged seating; split first). Holder, orders and the lock (if the caller's) move with it. Reason optional.
- **R23 (T6):** the caller is the holder with `take-order`. If the target table has an assignee and it is **not the caller**, the caller also needs `force-release-table-lock`; else `403 PERMISSION_DENIED { reason: 'other_owner', table_id, assigned_staff_id }` (client: "Hand it over to Sara; she moves it"). After the handover Sara is holder and the target's assignee, so her move passes (G4-2 #4). A target with no assignee, or the caller's own: free, on any floor — **pending owner confirmation, OQ4**.
- Lock held by another staff/device → `409 TABLE_ALREADY_LOCKED`.
- Slips keep their group: `table_key` = `'dine_in:' + seating_id` (T21, Q-2), and the receiver is the holder of the group's orders (`holdersOfOrders`, Q-1).

### 3.11 Merge (`MergeTables`)

- `{ into_table_id, into_seating_id, table_id, table_seating_id: string | null }`:
  - `table_id` FREE (non-archived) → **joins** the `into` seating.
  - `table_id` with seating `S2` → **absorbed**: orders move to `S`, tables join, `S2` closes `merged`, its lock ends.
- Guards: `seating_id`s as shown (T18); either side NEEDS_CLEANING → 409; a lock on either side by someone other than (caller, device) → `TABLE_ALREADY_LOCKED`; 04 `mergeGuard` → `MERGE_BLOCKED_BY_VOID`.
- **R23 (T6):** the caller must be `S`'s holder (or hold the force permission). The merge also needs `force-release-table-lock`, else `403 PERMISSION_DENIED { reason: 'other_owner', … }`, when **any table of either side** (`S`'s tables, `S2`'s tables, or the FREE joining table) has an assignee other than the caller, or `S2`'s holder ≠ the caller. One rule covers both directions: "open Sara's free T9, absorb T3 into it" (G4-3 #3) and "open Sara's free T9, absorb T9 into T3" (N-2) are both refused without force. `S`'s holder and assignee stay.
- Pending handovers of `S` and `S2` are closed `obsolete` (the party changed, G4-1 #21).
- `bill_requested_at` of `S` cleared when `S2` brings an order.

### 3.12 Split (`SplitSeating`)

- `{ from_table_id, seating_id, to_table_id, order_ids[] }`:
  - `order_ids` non-empty, `to_table_id` FREE or a joined table of `S` (not the primary) → a new seating on `to_table_id` with those **whole live orders**; holder = `S`'s holder.
  - `order_ids` empty and `to_table_id` a joined table → **detach**: the table leaves `S` and is FREE (no empty seating, G4-1 #22).
- `409 SPLIT_INVALID { reason: 'empty' | 'all_orders' | 'not_in_seating', order_ids? }` (409: it depends on the seating's current orders, G4-1 #24). 04 guard on the moved orders.
- **R23 (T6):** a new seating on a table whose assignee is someone other than the caller needs `force-release-table-lock`, else `403 PERMISSION_DENIED { reason: 'other_owner' }`. A lock on `S` held by another (staff, device) → `409 TABLE_ALREADY_LOCKED` (as Merge; G4-2 #18).
- The pending handover of `S` is closed `obsolete`. The lock stays on `S`.

### 3.13 Bill request, cleaning, call waiter

- **`RequestBill`** (`take-order`, no lock, D39): ORDERED / FOOD_ON_TABLE → `BillRequested`; BILL_REQUESTED → `result: { requested: false }`; SEATED → `409 TABLE_NO_ORDERS`; NEEDS_CLEANING → `409 TABLE_NEEDS_CLEANING`. Whether it alerts the cashier is 05's (OQ1, decided).
- **`CleanTable`** (`clean-table`, new): NEEDS_CLEANING → `TableCleaned { reason: 'cleaned' }`; SEATED → `reason: 'left_without_order'` (this includes "every order cancelled", G4-1 #10); else `409 TABLE_HAS_OPEN_ORDERS { order_count }`. The fold closes the seating, frees its tables, ends its lock; `CleanTable` closes the pending handover and the open `call_waiter` alert (`obsolete`).
- **`CallWaiter`** (`take-order`): kind `call_waiter` raised to `{ kind: 'table_team', table_id, depth: 'direct' }` (= `W ∪ {holder}`, **minus the caller**: kind flag `skip_requester: true`, 01d row D-3; G4-2 #12); the result carries `recipients: n` (count of step-0 recipients in the `AttemptSent` draft `raise` returns); at 0 the client shows "Nobody else is working" (G4-3 #10); one open per seating (dedupe `call_waiter:<seating_id>` → `result: { alert_id, repeated: true }`). **Closes after 5 minutes** (`closes_on: { after_ms: 300_000 }`) or at Clean; no "seen closes it" (01d's `seen` is single-recipient, AD-107; G4-1 #7). The sender sees the result only on the table map ("Call sent 1 min ago") — there is no "my sent alerts" view for non-request kinds (G4-1 #29).

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
| 02b | events `OrderPlaced` (its 03a v1 schema: a `dine_in` order names its seating through `table_key = 'dine_in:' + seating_id`, T21, Q-2; other order types are ignored by the fold), `OrderLinesAdded`, `ItemRemoved`, `OrderCancelled { order_id }`, 02b's edit events (activity, §3.3); `ItemServed` (03a schema, stream `order`/`order_id`); **`seatingTotals(db, seating_id) → { total_minor }`** (1 statement; until 02b exists, `amount` is left out) | folds, handover card |
| 05 | `BillClosed { seating_id }` = the seating's **last** open bill closed (row To 05) | NEEDS_CLEANING |
| 04 | `registerMergeGuard((db, { seating_ids, order_ids? }) → { blocked, order_item_ids })`; unregistered → never blocked | merge, split |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `tableOwners(db, table_ids[])` | **`Map<table_id, staff_id>`** = holder of the table's open seating (03a's type, unchanged; G4-1 #8) | 1 | 03a (as specified), 04 |
| `holdersOfOrders(db, order_ids[])` | `Map<order_id, staff_id>` = holder of the order's seating now (through `seating_orders`, after moves, merges, splits) | 1 | 03a slip receivers (R26 row Q-1) |
| `seatingOf(db, table_id)` | `{ seating_id, primary_table_id, table_ids[], state, holder_staff_id } \| null` | 1 | 02b, 05 |
| `currentTableOf(db, order_ids[])` | `Map<order_id, { seating_id, primary_table_id, table_ids[] }>` | 1 | 02b edits, 03b, 05 |
| `requireLock(tx, { table_id, seating_id }, ctx)` | throws `TABLE_SEATING_CHANGED` (no seating, or another), `TABLE_NEEDS_CLEANING`, `TABLE_ALREADY_LOCKED`. **Holder = actor:** held by (actor, device) → nothing; free → `[TableLocked]`; same actor other device → `[TableLocked { replaced_device_id }]`. **Holder ≠ actor:** needs `take-order-anywhere` (§3.15, else `403 PERMISSION_DENIED`); held by (actor, device) → nothing; **free → nothing, the lock is not taken** (an old holder's draft never re-locks someone else's table, G4-3 #2); held by another → `TABLE_ALREADY_LOCKED` | 1 | 02b submit and edits |
| `zoneOf(table_id)` | `{ floor_id, zone_id \| null, zone_order_taker_staff_id \| null }` | 0 | 01d resolver, 02b |
| Resolver `table_team` | `fn(tx, targets[])` for `{ kind: 'table_team', table_id, depth?: 'owner' \| 'direct' }` (missing depth normalised to `direct` before keying) → per target `{ staff_ids, device_ids: [], owner_staff_id }`: `owner` → `[holder]`; `direct` → `W ∪ {holder}` (§3.5); directory through `alertDirectoryOf(tx)` (`alerts/raise.ts:90`) | 1 (`UNION ALL` of open seatings of the targets and the branch's live staff sessions, `staff_sessions_active`) | 01d (D-1) |
| Resolver `zone_order_taker` | per target `{ staff_ids: [zone assignee] }` | 0 | 01d |
| Events, projections, kinds, queries, catch-up | §6.19, §5, §6.14–6.15, §6.17–6.18 | — | all |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 02b | For `dine_in`, `OrderPlaced.table_key = 'dine_in:' + seating_id` (T21, Q-2; no new field in 03a's v1 schema); submit and every order edit call `requireLock` with the seating the screen showed; edits resolve the table by `currentTableOf(order_id)`; write `OrderCancelled { order_id }` when no live line is left; expose `seatingTotals`; the device queue accepts `RequestBill`, `CleanTable`, `CallWaiter` with their `seating_id` and records a drop on `TABLE_SEATING_CHANGED`; no other 02a command is queued; 02b's approval adds its edit event types to 02a §3.3 through an 02a version bump (P-1). |
| 03a | Slip receivers for `dine_in` groups: the holder of the group's **oldest** order, from `holdersOfOrders(order_ids of the group)` (Q-1; matches 03a:479's oldest-order subject). The slip card's table label (`display.table_code`) comes from `currentTableOf(order_ids)`, never from `table_key` (`'dine_in:' + seating_id` since T21 / Q-2; G4-3 #7). |
| 03b | Show the current table (`currentTableOf`, "T4 + T5"); Ready to serve with `{ kind: 'table_team', table_id, depth: 'direct' }`; **on `TableMoved`, `TablesMerged`, `SeatingSplit` close and re-raise the seating's open Ready-to-serve alerts on its current primary table**, since 01d re-resolves a frozen `table_id` at every step (`alerts/targets.ts:222-235`; G4-3 #12). |
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
| Q-1 | **03a §3.8 / §6.2a** | `dine_in` slip receivers: the holder of the group's **oldest** order (`placed_at` in 03a's state), read with `holdersOfOrders(db, order_ids)` (1 statement) instead of `tableOwners` over `table_key`; the tie test is 03a's. Groups stay per `table_key` (`'dine_in:' + seating_id`, T21 and Q-2); the card's table label from `currentTableOf`. `tableOwners` stays as 03a specified. |
| Q-2 | **03a §3.2 (03a:241)** | **Table key for `dine_in`:** `'dine_in:' + seating_id` (the seating from 02a, supplied by 02b on `OrderPlaced`), instead of `'dine_in:' + table_id`. Other order types unchanged (`car_number`, `order_id`). Effect in 03a: none in code beyond the key's origin (03a groups and dedupes by whatever `table_key` 02 sends, 03a:476); 03a's tests that build `dine_in` keys from a table id use a seating id. Prevents an order the 02a fold cannot place (N-1) and two parties in one slip group (G4-2 #5). |
| A-1 | 01a | `zones` (`zone_id`, `branch_id`, `floor_id`, `name` 1–40, `sort_order`, `archived_at`; unique active name per floor), nullable `tables.zone_id` (same floor; archiving a zone nulls its tables' `zone_id` in the same transaction); cloud migration `NNNN_zones.sql`, **next free number at build time**; admin routes (C1–C9, `Idempotency-Key` on create); **snapshot schema 4**, breaking — **ships in the same release as 03a's V3, before the pilot (R29); fixtures move V3 → V4 once**; sync bound +1. |
| B-1 | 01b | `take-order` (group `orders`, scopes `branch`, `my_floors`; default Owner, Manager, Order taker, Cashier) and `clean-table` (group `orders`, `branch`; default Owner, Manager, Order taker, Waiter, Cashier), by `default_key`; R29 re-seed. |
| B-2 | 01b | Staff form "Assigned tables": `assigned_zone_ids[]`, `assigned_table_ids[]` per branch; one person per zone and per table (`422 CONFIG_REFERENCE_INVALID { reason: 'already_assigned', staff_id }`); directory v3 additive; `StaffDirectory.assignedOrderTaker(table_id)` (§3.6); cloud migration `NNNN_assignments.sql`, next free number at build time. |
| B-3 | 01b §3.3 | `own_tables` = seatings the person holds (T8); 01b:352 text corrected. |
| D-1 | **01d §3.4.2, §4.2 and `alerts/targets.ts`** | For `table_team`: (a) a missing `depth` is normalised to `direct`, then `targetKey` includes it (`table_team:<table_id>:<depth>`); (b) `resolveTarget` uses the resolver's `staff_ids` as the full recipient set for both depths and no longer adds `teamOf(owners)` (AD-51 reversed for this kind; `targets.ts:411-414`), **still applying the presence filter** (`targets.ts:414`); (c) the absent-owner marker and zone-order-taker fallback use the resolver's `owner_staff_id` (`targets.ts:361-370`); (d) **type change:** `ResolvedTarget` (`targets.ts:57-60`) and 01d §4.2's resolver type gain an optional `owner_staff_id`; (e) resolvers read the directory through `alertDirectoryOf(tx)`. Tests: one batch with `owner` + `direct` for one table → two lists; marker once per holder; missing depth = `direct`. 01d:721's `tableOwner` reads `tableOwners`. |
| D-2 | 01d §4.4 | "Served card" moves to 03b. |
| D-3 | 01d §3.5, `alerts/targets.ts:357` | New optional kind flag `skip_requester: boolean` (default false): when true, the requester is left out of **every** set of every step (today only `answerer` entries skip him). `call_waiter` sets it. Startup error: `skip_requester` on a request kind (requests already skip). |
| P-1 | **02a (this spec)** | When 02b is approved, its edit event types are added to §3.3's activity list and §5's consumed events by an 02a version bump, with replay identity re-proven (test 9). |
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
  close_reason      TEXT CHECK (close_reason IN ('cleaned','left_without_order','merged'))
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

- **One projection `tables`** (T19) writes `seatings`, `seating_tables`, `seating_orders` and `table_locks`, with `reset`; it consumes every §6.19 event, `OrderPlaced` (only `order_type = 'dine_in'`, seating = `table_key` without its `dine_in:` prefix, if that is an open seating; others ignored), `OrderLinesAdded`, `ItemRemoved`, `OrderCancelled`, 02b's edit events (P-1), `ItemServed` (by `stream_id` = `order_id`), `BillClosed`. **Only 02a writes these tables.**
- The tick reads `staff_sessions` (00's) read-only.
- Times are `recorded_at`.

---

## §6. Commands, events and queries

**Common rules.** `POST /commands/:name`, `sessionKind: 'device'`, staff session, D32 idempotency, no PIN. Responses are `200 { data: { command_id, event_ids, result } }` (00); only `result` is listed below. Every command on an open seating carries **`seating_id`** (the one shown); a different current seating → `409 TABLE_SEATING_CHANGED { table_id, seating_id }` (T18); a table with no seating, or another one, while a `seating_id` was given → `409 TABLE_SEATING_CHANGED` (so a queued command for a cleaned table is dropped, G4-2 #11); no seating and no `seating_id` given → `409 TABLE_NOT_OPEN`. Statement counts below exclude 01d's own bounds where named. Archived tables per §3.14. Second permissions per §3.15. Scope checks last (C8, `403 PERMISSION_DENIED { reason: 'outside_scope', table_ids }`).

### 6.1 `OpenTable`

| | |
|---|---|
| Permission | `take-order` (+ `take-order-anywhere` when holder ≠ caller) |
| Payload | `{ table_id, seating_id?: string, party_size?: int 1–50 }` |
| Script | 1. read seating and lock of the table (1 statement); 2. no seating: a `seating_id` was given → `409 TABLE_SEATING_CHANGED` (stale tile, G4-3 #9); archived → 404; else `TableOpened` + `TableLocked`; 3. seating: `seating_id` given and ≠ → 409 `TABLE_SEATING_CHANGED`; NEEDS_CLEANING → 409; holder ≠ caller → second permission; lock by (caller, device) → `result: { opened: false }`; lock by caller elsewhere → `TableLocked { replaced_device_id }`; lock by other staff → `TABLE_ALREADY_LOCKED`; no lock → `TableLocked`; 4. scope |
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
| Script | 1. seating checks (T18); NEEDS_CLEANING → 409; 2. seating's assignee ≠ caller → `403 PERMISSION_DENIED { reason: 'not_assigned', assigned_staff_id }` (G4-1 #24: config, not state); 3. holder = caller → `{ changed: false }`; 4. `TableHolderChanged { reason: 'take_over' }` (+ `TableLockReleased { holder_changed }`, T20); 5. `closeHandover`; 6. scope |
| Statements | 1 (seating + lock) + 1 `byDedupeKey` + `alerts.close` bound |

### 6.7 `RequestTableHandover`

| | |
|---|---|
| Permission | `take-order`; non-holder sender needs `force-release-table-lock` (§3.15) |
| Payload | `{ table_id, seating_id, to_staff_id, note?: ≤ 120 }` |
| Script | 1. seating checks; NEEDS_CLEANING → 409; 2. sender rule → `403 PERMISSION_DENIED { reason: 'not_holder' }`; 3. receiver: `to_staff_id` = holder → `422 HANDOVER_TARGET_INVALID { reason: 'is_holder' }`; = sender → `{ reason: 'is_requester' }`; no `take-order` covering the floor → `{ reason: 'no_permission' }` / `'outside_scope'`; inactive or no live session → `409 HANDOVER_TARGET_UNAVAILABLE { reason: 'inactive' \| 'not_working' }`; 4. `alerts.raise(ctx, { kind: 'table_handover', subject: { stream_type: 'table', stream_id: primary_table_id }, target: { kind: 'person', staff_id: to_staff_id }, values: { table_id, seating_id, from_staff_id: holder }, display, details, dedupe_key: 'table_handover:' + seating_id, requester_staff_id: caller, request: { receiver_staff_id: to_staff_id } })`; `deduped` → `409 TABLE_HANDOVER_PENDING { alert_id, to_staff_id }`; 5. scope |
| Result | `{ alert_id }` |
| Statements | 1 (seating + lock) + 1 (receiver's live session) + 1 `seatingTotals` + `alerts.raise` bound |

### 6.8 `ForceMoveTable`

`{ table_id, seating_id, to_staff_id, reason: 1–120 }`; `force-release-table-lock`. Seating checks; NEEDS_CLEANING → 409; `to_staff_id` = holder → `{ changed: false }`; receiver checks as 6.7 step 3 (minus `is_requester`: a manager may move a table to himself); `TableHolderChanged { reason: 'force_move', note }` (+ `TableLockReleased { holder_changed }`, T20); statements: 1 + 1 (receiver session) + 1 `byDedupeKey` + close bound; `closeHandover`; scope.

### 6.9 `MoveTable`

`{ from_table_id, seating_id, to_table_id, reason?: 1–120 }`; `take-order` (holder; else `force-release-table-lock`). Seating checks; > 1 table → `409 TABLE_MERGED`; `to` has a seating → `409 TABLE_NOT_FREE`; `to` archived → 404; R23 rule §3.10 → `403 PERMISSION_DENIED { reason: 'other_owner' }`; lock by other (staff, device) → `TABLE_ALREADY_LOCKED`; `TableMoved { seating_id, from_table_id, to_table_id, by_staff_id, note }` (fold: primary and `seating_tables` → `to`, lock re-keyed); scope both tables. Pending handover closed `obsolete` (§3.8). Statements: 2 (seating + lock; target) + 1 `byDedupeKey` + close bound. Result `{ primary_table_id }`.

### 6.10 `MergeTables`

`{ into_table_id, into_seating_id, table_id, table_seating_id: string | null }`; `take-order`. **Permission sentence (same in §12.2):** the caller is `S`'s holder; any table of either side assigned to someone other than the caller, or `S2` held by someone else, also needs `force-release-table-lock` (§3.11); a non-holder caller needs `force-release-table-lock` (§3.15). Checks per §3.11 (`TABLE_SEATING_CHANGED`; NEEDS_CLEANING; `TABLE_ALREADY_LOCKED`; `MERGE_BLOCKED_BY_VOID`; `403 other_owner`); `TablesMerged { into_seating_id, into_table_id, table_ids, absorbed_seating_id, order_ids, by_staff_id }`; pending handovers of `S` and `S2`: 2 `byDedupeKey` + one `alerts.closeMany`; scope all tables. Result `{ seating_id, table_ids }`. Statements: 3 reads + guard + 2 + `closeMany` bound.

### 6.11 `SplitSeating`

`{ from_table_id, seating_id, to_table_id, order_ids: string[] (set, C1, ≤ 50) }`; `take-order` (holder; else force; target assigned to someone other than the caller → force, §3.12). Checks per §3.12 incl. a lock on `S` by another (staff, device) → `TABLE_ALREADY_LOCKED`; `SeatingSplit { from_seating_id, new_seating_id: string | null, to_table_id, order_ids, by_staff_id }` (`null` = detach); `closeHandover(S)`; scope. Result `{ new_seating_id }`. Statements: 3 reads + guard + 1 `byDedupeKey` + close bound.

### 6.12 `RequestBill`

`{ table_id, seating_id }`; `take-order`. §3.13; `BillRequested { seating_id, table_id, by_staff_id }`; scope.

### 6.13 `CleanTable`

`{ table_id, seating_id }`; `clean-table`. §3.13; `TableCleaned { seating_id, table_ids, reason, by_staff_id }`; open `table_handover` and `call_waiter` of the seating: 2 `byDedupeKey` + one `alerts.closeMany` (`obsolete`). Statements: 1 + 2 + `closeMany` bound.

### 6.14 `CallWaiter` and kind `call_waiter`

`{ table_id, seating_id, chip?: 'water' | 'clear' | 'come' | 'other' }`; `take-order`. `alerts.raise(ctx, { kind: 'call_waiter', subject: { stream_type: 'table', stream_id: primary_table_id }, target: { kind: 'table_team', table_id, depth: 'direct' }, values: { table_id, seating_id, chip }, display, dedupe_key: 'call_waiter:' + seating_id, requester_staff_id: caller })`; `deduped` → `result: { alert_id, repeated: true }`; else `result: { alert_id, repeated: false, recipients: n }`.

```typescript
defineAlertKind({
  kind: 'call_waiter', family: 'action', subject: 'table',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
  closes_on: { after_ms: 300_000 },          // not 'seen' (single-recipient rule, AD-107; G4-1 #7)
  values_schema: z.object({ table_id: z.string().min(1), seating_id: z.string().min(1),
                            chip: z.enum(['water','clear','come','other']).optional() }),
  details_schema: null, lead_fallback: true, expires_at_day_close: true, silent: false,
  skip_requester: true,                       // D-3: the caller's own tablet does not ring
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
    { at: { ms: 120_000 }, to: [{ target: { kind: 'requester_lead' }, set: 'informed' }] },   // sender's lead (G0-1)
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

Staff session; `deviceTypes: ['tablet', 'phone', 'cashier_kiosk']`; `countsAsActivity: false`. Query `{ floor_id?: string }`. Result `{ as_of_seq, floors: [{ floor_id, name, zones: [{ zone_id | null, name | null, tables: [{ table_id, name, seats, archived, state, seating_id | null, party_size | null, primary_table_id | null, joined_table_names, holder: { staff_id, name } | null, assignee: { staff_id, name } | null, lock: { staff_id, name, mine: boolean } | null, opened_at | null, bill_requested_at | null, live_order_count }] }] }] }` — `mine` computed for the asking (staff, device); archived tables only while seated. Statements: **3 + 1** (open seatings with tables; locks; live order counts; `last_seq`).

### 6.18 `GET /queries/handover-candidates`

Staff session; `countsAsActivity: false`. Query `{ table_id }`. Result `{ staff: [{ staff_id, name, is_assignee, working, tables_held }] }` — `take-order` holders covering the floor, holder and caller excluded; working first. Statements: 2.

Catch-up part **`tables`**: the §6.17 builder for the socket's (staff, device).

### 6.19 Events (`table` stream, `schema_version` 1; **no session ids**, T7)

| Event | Stream | Payload | Fold |
|---|---|---|---|
| `TableOpened` | table | `{ table_id, seating_id, holder_staff_id, party_size: int \| null }` | seating SEATED, `seating_tables` |
| `TableLocked` | primary | `{ table_id, seating_id, staff_id, replaced_device_id?: string }` (device = envelope `device_id`) | upsert lock |
| `TableLockTouched` | primary | `{ table_id, seating_id }` | `last_touch_at`, activity |
| `TableLockReleased` | primary | `{ table_id, seating_id, staff_id, reason: 'released' \| 'force' \| 'session_expired' \| 'lock_ttl' \| 'holder_changed', by_staff_id?, note?, alert_id?: string }` (`alert_id` set when written by the handover `apply`, G4-3 #1) | delete lock |
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
- **Banners:** my lock released → "Your table was released (reason)"; `TableLocked { replaced_device_id = mine }` → "Opened on another device"; **`TableHolderChanged` away from me while my order screen is open → "Ali now has this table. Keep as draft", then Release; a Send button only when my effective permissions include `take-order-anywhere`, and that submit never takes the lock** (G4-1 #33, G4-3 #2). Drafts are never dropped.
- **Table sheet:** Take over (assignee), Hand over (candidates, working first), Force move (permission), Move, Merge, Split, Ask for bill, Clean, Call waiter (chips); `403 other_owner` → "Hand it over to Sara; she moves it" with the Hand over button preset to Sara (G4-2 #4). A handover card whose Accept returns `TABLE_HANDOVER_STALE` shows "Bill paid, waiting for cleaning" (G4-2 #19).
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
| `MERGE_BLOCKED_BY_VOID` | 409 | `{ order_item_ids }` | 04's guard |
| `SPLIT_INVALID` | 409 | `{ reason: 'empty' \| 'all_orders' \| 'not_in_seating', order_ids? }` | split against the seating's current orders |
| `TABLE_NO_ORDERS` | 409 | `{ table_id }` | bill request on SEATED |
| `TABLE_HAS_OPEN_ORDERS` | 409 | `{ table_id, order_count }` | clean before the bill closed |

Reused: `TABLE_NOT_FOUND` (404, `{ table_id }`, already in `errors.ts:32`), `TABLE_ALREADY_LOCKED`, `TABLE_LOCK_NOT_HELD`, `PERMISSION_DENIED` (reasons `outside_scope`, `not_holder`, `not_assigned`, `other_owner` with `{ table_id, assigned_staff_id \| null, holder_staff_id \| null }` — config and permission, not state, G4-2 #14), `VALIDATION_FAILED`.

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
| 9b | Lock refreshed by `OrderLinesAdded` on order O, later O split to S3; `reset` + replay → identical lock row (single projection, T19) |
| 10 | Take-over by the assignee → holder changes; the old holder's lock released `holder_changed`; the assignee's own lock kept; pending handover `AlertClosed 'obsolete'` and a result to its sender |
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
| 22 | Move → seating, orders, lock follow; **pending handover closed `obsolete`**; `holdersOfOrders` gives the moved party's holder after a new party opens the old table |
| 23 | Move merged → `TABLE_MERGED`; to busy → `TABLE_NOT_FREE`; to Sara's table by Bilal → 403 `other_owner`; Bilal hands over to Sara, Sara moves → passes; with force → passes |
| 24 | Merge FREE table → joins; "T4 + T5" |
| 25 | Merge absorbing own seating → orders move, absorbed CLOSED `merged`, its lock gone, both handovers closed |
| 26 | Merge absorbing another holder's seating without force → 403 `other_owner`; with force → merged |
| 27 | Merge blocked by the 04 guard stub; other side locked by another device → `TABLE_ALREADY_LOCKED` |
| 28 | Split orders to FREE → new seating, same holder; target assigned to someone other than the caller without force → 403 `other_owner`; lock on `S` by another device → `TABLE_ALREADY_LOCKED` |
| 29 | Detach a joined table with no orders → the table is FREE, no new seating |
| 30 | Split all / foreign orders → 409 `SPLIT_INVALID` |
| 31 | RequestBill; repeat → `requested: false`; new `OrderPlaced` and **`OrderLinesAdded`** after the bill → ORDERED, `bill_requested_at` cleared |
| 32 | `BillClosed` → NEEDS_CLEANING; Open / Merge / Handover / `requireLock` → 409 `TABLE_NEEDS_CLEANING`; Clean → FREE |
| 33 | Every order cancelled → SEATED; **bill requested, then every order cancelled → SEATED**; Clean → `left_without_order` |
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
| 46 | `requireLock` by a non-holder **without** `take-order-anywhere` → 403, free and held cases; old holder without the permission submitting after a take-over → 403 (with it: test 53) (N-4) |
| 47 | Take-over / accepted handover / force move while the old holder's tablet holds the lock → `TableLockReleased { holder_changed }`; the new holder opens at once |
| 48 | Handover on SEATED with no order → `alerts.raise` input has `details: {}`; raised, card without `quantity` / `amount` |
| 49 | Queued Clean for a seating already cleaned (table FREE) → `TABLE_SEATING_CHANGED` |
| 50 | CallWaiter by the holder → his own devices get nothing (D-3); the rest of `W` do |
| 50b | CallWaiter with `W = ∅` by the holder → `recipients: 0` |
| 51 | `holdersOfOrders` returns one holder per order after a split and a handover of one part (the tie rule is tested in 03a, Q-1) |
| 52 | Handover accept while the old holder's tablet holds the lock → `TableHolderChanged` and `TableLockReleased`, **both with `alert_id`**; no 500 (01d `checkAlertIds`) |
| 53 | After a take-over, Bilal with `take-order-anywhere` submits from his draft → order written, **no `TableLocked`**; Ali opens at once. Without the permission → 403 |
| 54 | Open Sara's FREE T9 by Bilal, then absorb T3 into it without force → 403 `other_owner` |
| 54b | Mirror: Bilal opens Sara's FREE T9, then absorbs T9 into his T3 without force → 403 `other_owner`; merging two of Bilal's own seatings on tables assigned to Bilal or nobody → passes without force (N-2) |
| 55 | A takeaway / delivery `OrderPlaced` leaves every table row unchanged; a `dine_in` one with `table_key = 'dine_in:' + S` joins seating S; a `dine_in` key naming no open seating is ignored and logged once (`{ order_id, table_key }`, live fold only — not during replay or `reset`) |
| 56 | `OpenTable { seating_id: S }` on a FREE table (S cleaned) → `TABLE_SEATING_CHANGED`; without `seating_id` → new seating |

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

1. Approved bumps first (not 02a tasks): 01a A-1, 01b B-1–B-3, 01d D-1 and D-3 (with their tests), 03a Q-1 and Q-2.
2. `@pos/events/src/tables/*` (§6.19); `@pos/domain` `TableState`, §9 codes.
3. Migration `NNNN_tables.sql` (§5).
4. Projection `tables` (T19) with the state fold (§3.1) and `reset` (tests 31–33, 38).
5. Lock part of `tables`: activity fold (§3.3; tests 9, 9b).
6. Reads: `tableOwners`, `holdersOfOrders`, `seatingOf`, `currentTableOf`, `zoneOf` (§4.2).
7. `waiterTeam` + resolver `table_team`, `zone_order_taker` (§3.5, §6.16; tests 18–21).
8. `requireLock` (§4.2; tests 32, 45).
9. `OpenTable` (tests 1–6, 39, 43).
10. Touch, Release, ForceRelease (tests 7, 41).
11. Tick (test 8).
12. `closeHandover` + kind `table_handover` + `RequestTableHandover` (tests 12–16, 52). **Kinds are defined at module top level and imported by the boot chain before projection replay** (01d `alerts/kinds.ts:183-186`), else a replayed open handover is an unknown kind (G4-3 #13).
13. `TakeOverTable`, `ForceMoveTable` (tests 10, 11, 17).
14. `MoveTable` (tests 22, 23, 42).
15. `MergeTables` + `registerMergeGuard` (tests 24–27).
16. `SplitSeating` (tests 28–30).
17. `RequestBill`, `CleanTable` (tests 31–34, 40, 44).
18. Kind `call_waiter` + `CallWaiter` (tests 35, 50, 50b; top-level definition as step 12).
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
| 6.9 | MoveTable | command | take-order (+ force for non-holder or a target assigned to someone else) | TableMoved, AlertClosed | 404, 409×5, 403 |
| 6.10 | MergeTables | command | take-order (holder of `S`; + force when any table of either side is assigned to someone else, `S2` is held by someone else, or the caller is not the holder) | TablesMerged, AlertClosed | 404, 409×5, 403 |
| 6.11 | SplitSeating | command | take-order (+ force for non-holder or a target assigned to someone else) | SeatingSplit, AlertClosed | 404, 409×6, 403 |
| 6.12 | RequestBill | command | take-order | BillRequested | 409×4, 403 |
| 6.13 | CleanTable | command | clean-table | TableCleaned, AlertClosed | 409×3 |
| 6.14 | CallWaiter | command | take-order | AlertRaised | 409×3 |
| 6.17 | table-map | query | session | — | — |
| 6.18 | handover-candidates | query | session | — | 404 |

### 12.3 Open questions

OQ1–OQ3 decided (developer, 2026-11-06): bill alert → 05; `clean-table` defaults; four fixed chips.

| # | Question for the owner (plain) | Decides | Proposed |
|---|---|---|---|
| **OQ4** | Bilal moves his own party from a ground-floor table to an upstairs table that **nobody is assigned to** (or that is his own). Is that fine without asking anyone? | Whether R23's "another floor" needs a request when no other person is involved | Yes: free; R23's request is needed only when another person is involved (T6) |

### 12.4 Deferred until needed

Pass pick-up identity (owner round 2); hub-side assignment screen (owner Q1); per-line moves (bill split is 05's); configurable colours and call chips; reservations (P2); moving a merged seating in one step; approval flow for the handler-checked second permissions (§3.15).

### 12.5 Hostile self-review (v0.4, kept; v0.5 additions in §12.7)

| Area | Finding | Handling |
|---|---|---|
| Race | Take-over and accept in one tick | Take-over closes the request first; a later accept gets 01d's `REQUEST_NOT_PENDING`. |
| Race | Queued command on the next party | `seating_id` on every seating command (T18, test 44). |
| Replay | Lock activity | Fold only (T7, test 9). |
| Contract | 03a `tableOwners` type | Kept; new `holdersOfOrders` + Q-1. |
| Contract | 01d `table_team` semantics | D-1 (a)–(c), test 21. |
| Owner rule | Holder in waiter alerts | `W ∪ {holder}` (T4). |
| Owner rule | R23 through merge / move | T6 (v0.5: caller vs target assignee, `403 other_owner`). |
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


### 12.7 G4 run 2 closure (`02a_v0.4_hostile_run2.md`)

| # | Fix in v0.5 | # | Fix in v0.5 |
|---|---|---|---|
| 1 | one projection `tables` (T19); test 9b | 11 | `seating_id` given + no / other seating → `TABLE_SEATING_CHANGED`; test 49 |
| 2 | `requireLock` holder rule; test 46 | 12 | D-3 `skip_requester`; test 50 |
| 3 | T20 `holder_changed` release; test 47 | 13 | return lines clear the bill request — accepted, stated (§3.1) |
| 4 | T6 compares the caller with the target's assignee; hand over then move; OQ4 for the floor case; test 23 | 14 | `TABLE_OTHER_OWNER` → `403 PERMISSION_DENIED other_owner` |
| 5 | T21 `table_key = seating_id` (02b), Q-1 tie rule; test 51 | 15 | statement counts per command; `closeMany` in Clean and Merge |
| 6 | card omits `quantity` / `amount` at 0; test 48 | 16 | `kind IN ('staff','station')`; ≤ 60 rows; re-sign-in claim corrected; EXPLAIN in test 8 |
| 7 | SEATED checked before BILL_REQUESTED; `OrderCancelled` clears; test 33 | 17 | row P-1 |
| 8 | D-1 (a)–(e) | 18 | one permission sentence; Split refuses a foreign lock; test 28 |
| 9 | `{ target: { kind: 'requester_lead' } }` | 19 | only NEEDS_CLEANING reachable; §8 text |
| 10 | every party change closes the handover; `apply` uses the current primary | 20 | `merged_into_seating_id` and `seatingOwners` dropped |

### 12.8 G4 run 3 closure (`02a_v0.5_hostile_run3.md`)

| # | Fix in v0.6 | # | Fix in v0.6 |
|---|---|---|---|
| 1 | `TableLockReleased.alert_id?`, set by `apply`; §3.8 rule; test 52 | 8 | `details: {}`; test 48 |
| 2 | `requireLock`: non-holder never takes a free lock; §8 "Keep as draft"; test 53 | 9 | §6.1 stale `seating_id` → `TABLE_SEATING_CHANGED`; `TABLE_NOT_OPEN` dropped from `requireLock`; test 56 |
| 3 | absorb into a foreign-assigned primary needs force; test 54 | 10 | `recipients: n`; test 50b |
| 4 | fold maps `dine_in` by `table_key`; others ignored; no new field; test 55 | 11 | holder clause deleted |
| 5 | tests 10, 22 rewritten | 12 | To 03b: close / re-raise Ready to serve on party changes |
| 6 | Q-1 tie = oldest order, in 03a; test 51 per-order map | 13 | §11: kinds at top level before replay |
| 7 | T21 merged-party groups accepted; label from `currentTableOf` | 14 | `party_size` returned on the table map |

### 12.9 Targeted check closure (`02a_v0.6_targeted_check.md`)

| # | Fix in v0.6.1 |
|---|---|
| N-1 | T21 key `'dine_in:' + seating_id`, R26 row Q-2 against 03a:241; fold strips the prefix; test 55 |
| N-2 | §3.11 / §6.10: any table of either side assigned to someone else → force; test 54b |
| N-3 | §2: re-acquire is holder-only |
| N-4 | test 46 rewritten (no `TABLE_LOCK_NOT_HELD`; consistent with 53) |
| N-5 | §3.8: the stale rule and the `alert_id` build rule are separate sentences; a missing `alert_id` is a 500, not a 409 |

### 12.10 v0.6.1 targeted check notes (`02a_v0.6.1_targeted_check.md`)

| # | Fix in v0.6.2 |
|---|---|
| M-1 | §3.8 cites test 52 only |
| M-2 | To 03a row: `'dine_in:' + seating_id` |
| Obs 1 | §12.2 row 6.10 "either side" |
| Obs 2 | test 55 logs live only |