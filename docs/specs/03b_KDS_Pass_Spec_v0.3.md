# 03b KDS + Printing — Module Spec

| | |
|---|---|
| Doc | Module spec, **v0.2 — DRAFT (developer, 2026-11-11)**. Fixes G4 run 1 (`docs/reviews/03b_v0.1_hostile_run1.md`, verdict FIX, 14 M · 23 m · 15 n); closure in §12.6. Next: hostile review run 2 in a fresh session → `docs/reviews/03b_v0.2_hostile_run2.md`. |
| Depends on | Foundation **v1.11**, 00 Hub Platform & Access **v1.8**, 01a Restaurant Setup **v2.3**, 01b Staff & Roles **v1.7**, 01c Menu Variants **v1.1.2**, 01d Notifications & Requests **v1.2.1**, 02a Tables **v1.1.4**, 02b Ordering **v1.0.2**, 03a Timing Engine **v1.2**. Target versions after 03b's approval: §4.5. 02b's hub build runs on `module-02b`; 03b builds after it merges (README build order). |
| Inherits | Shared Standards from Foundation v1.11 §6. Not redefined here. |
| Inputs | `docs/stories/03b-g0.md`; `docs/stories/03b-g1-decisions.md` (Q1–Q13, G1-1–G1-18); owner answers OQ-1, OQ-2 (2026-11-11); `docs/reviews/03b_v0.1_hostile_run1.md`; 03a v1.2 §4.3 To 03b #1–#8; 02b v1.0.2 §4.3 To 03b, O14, O16; 02a v1.1.4 §4.3 To 03b, D-2; 01d v1.2.1 D-2, N-2, A3, A12, A14; `01d-g0-decisions.md` K1–K13. Code on `main` @ `67c84c6` as cited inline. |
| Rigor | T2 (CLAUDE.md). |

### Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-11 | First draft from G0 + G1 (owner accepted every G0 recommendation). |
| v0.1 (owner answers) | 2026-11-11 | OQ-1: generic thermal ESC/POS printers, USB and LAN. OQ-2 ("bana do"): upstream rows and 02b's `served_estimate` registration are approved cross-module tasks inside 03b's plan (tasks 0a–0e), owner ruling for 03b only, overriding the README build-order note for exactly these rows. |
| **v0.2** | 2026-11-11 | **G4 run 1 closure (§12.6).** Majors: `printer_problem` kind made legal (M-1); print jobs written only in **live** mode, never on catch-up (M-2); the ticket fold is total, never throws (M-3); fallback dedupes on "has a kitchen job", deterministic job ids + unique index (M-4); `sent_at` set synchronously with render (M-5); **ack = flushed write**, status is advisory and only raises alerts; test prints bypass the FIFO (M-6); re-target uses a table-scoped dedupe key (M-7); Now / fallback / archived warning read the **engine** (M-8); Ready and Served card close when their lines are served or gone, by tick `pass_closures` (M-9); lanes reset at day open and go through `SetStationCapacity`'s checks, new 03a row T-1 (M-10); `served_estimate_ms` gets a range (A-1, B-2) (M-11); from-stock Done without Start (M-12); new kind `kds_offline` for a dark screen with no fallback printer (M-13); point membership = the engine line's `point_id` (M-14). Errors renamed / re-statused (§9). Minors and notes per §12.6. |

---

## §1. Header

### 1.1 Stories covered

- **E3 "Kitchen Display Screen"** (P1): AC1 (station view; all stations = the assembler view per point), AC2–AC3 restated by 03a's chef-screen contract, AC4 (Start / Done one tap, inline confirm only), AC5 (sound), AC6 (late colouring; the slip warning itself is 03a's), edge cases (two-tap, undo, archived station).
- **E3 "Ticket printing"** (P1): AC1 (per-station output), AC2 (screen offline → paper), AC3 (58 / 80 mm, LAN / USB), edges (printer down never blocks, Done cancels an unsent print, reprint after restart).
- E0 Orders AC4 (reprint); E0 Hardware printers; E5 power (print queue survives restart, D24); E0 Templates AC2 kitchen ticket — **fixed layout** in the pilot (G1-14).
- README carried rows :170, :190, :199, :200, :211, :237, :240 #1–#8; 02b §4.3 To 03b; 01a §4.4 :398, :405, :406, :433; 01d D-2, N-2, G1-12b, G1-21.4; OPEN-QUESTIONS 00 Q10.

### 1.2 In scope

Station commands (`StartItem`, `DoneItem`, `UndoDone`, `GiveMeMore`); the station view on the KDS (wall screen, station session) and the assembler view on the Pass tablet (staff session, `run-pass`); Ready to serve, Undo ready, Handover, the Served card; lanes (Off / On, labels); kitchen tickets, slips (CANCELLED, FIRST, REPRINT, COMING UP), manual reprint; the hub print queue, ESC/POS renderer, LAN and USB transports, paper fallback, printer-problem and screen-offline alerts; printer, station-output and device-role configuration on the hub admin; the print API for 05; the archived-station warning; "Day not started" on the KDS; screen presence on the hub admin.

### 1.3 Out of scope

The engine and everything it decides (03a); `MarkServed`, release / boost / return commands (02b); bill, receipt and Z report **content** and template (05, R12); headless point devices, button stations, pager (01e); lane **claims** (01e, Q11); Urdu-script printing (Q10); configurable kitchen ticket template; training mode (E13); audio callouts (P3); per-zone walk times (K10); customer QR (D20).

### 1.4 Decisions log (owner + developer, 2026-11-11)

| # | Decision | Source |
|---|---|---|
| P1 | One kitchen ticket per **order per station per fire**. | Q1 B |
| P2 | Tickets print at **fire**, never at submit. | Q2 A |
| P3 | Station output `screen` (default; paper only on fallback), `printer`, `both`; configured on the **hub admin**, never in the cloud. | Q3 |
| P4 | Paper fallback after `kds_offline_print_ms` with no screen of the station connected: Now as tickets + one COMING UP list; every new fire prints until a screen is back. | Q4 A |
| P5 | KDS and Pass taps disabled while the hub is unreachable; 03b commands are not queueable. | Q5 A |
| P6 | Line display: identifier big, item × units, options, notes, mark reason; Now "cooking m:ss" / red "late +N"; Next "in m:ss"; no clock or promise times. | Q6 A |
| P7 | Chime on entering Now; strong sound for RETURN / boost / expedite; no late sound; volume from the hub admin only. | Q7 A |
| P8 | One permission **`run-pass`** (kitchen group, scope `branch`; defaults Owner, Manager, Cook). | Q8 A, G1-6 |
| P9 | Extra slips: CANCELLED on removal (02b O16) and on void of a printed, not-done line; FIRST on boost / expedite of a printed, not-done line **at a `printer` station only**; no slip for Done. | Q9 |
| P10 | Paper is ASCII-mapped text in code page PC437. | Q10 A, G1-15 |
| P11 | Lanes: Off / On only. | Q11 A |
| P12 | "Coming up" count strip on the station view; lines never merged. | Q12 A |
| P13 | A KDS reprints its own station's tickets without PIN; staff screens with `reprint-ticket`. | Q13 A |
| P14 | Printers: generic thermal ESC/POS, USB or LAN; status and code page learned per printer, never assumed. | OQ-1 |
| P15 | Upstream rows (01b, 01a, 01d, 03a text, foundation / 00 text) and 02b's `served_estimate` registration are tasks 0a–0e of 03b's plan. *Supersedes G1-13 "never edited from a 03b branch".* | OQ-2 |
| D1 | **Tickets are a forward-only projection; it writes `print_jobs` only in `live` mode** (never on catch-up, first deploy or restore) and its fold is **total** (never throws). | G1-1; run 1 M-2, M-3 |
| D2 | Jobs store references; bytes are rendered at send. | G1-2 |
| D3 | Fallback and sending run in an async **print worker**, outside every writer transaction; never a 01d tick. | G1-3, G1-4 |
| D4 | **Ack = the whole document written and flushed.** Printer status (DLE EOT) is advisory: it feeds alerts and the admin page, never a resend. A write that fails before it completes is retried with a REPRINT header. No ESC/POS library. | G1-5; run 1 M-6 |
| D5 | Ready / Undo / Handover per **order per point**, on the order stream. | G1-9 |
| D6 | Re-target of open Ready alerts on party changes by 03b's tick, with a **table-scoped dedupe key**, without 02a code. | G1-11; run 1 M-7 |
| D7 | A line's point is the **engine line's `point_id`** (its home point, 03a); Now and every "open line" question read the engine, SQL only gives details. | run 1 M-8, M-14 |
| D8 | `printer_problem` is an `action` kind (a manager must fix paper / power / cable), not `info` as G0 §1 said. | run 1 M-1, n-15 |

---

## §2. Existing architecture that must not change

- 00: `POST /commands/:name` (`defineCommand`, `sessionKind` `'device'` or `'admin'` — the route kind must match, `commands/route.ts:69`; `stationScoped`; a station session on a non-`stationScoped` command gets `403 PERMISSION_DENIED { session_kind: 'station' }`, `route.ts:344`), D32 idempotency, `BEGIN IMMEDIATE` single writer (`engine-host/writer.ts`: projections apply inside `append`, inside the transaction), `registerProjection` (`apply(tx, event, mode: 'live' | 'catchup')`; no `reset` = forward-only, but **a projection with no checkpoint row replays from seq 0 in `catchup` mode**, `projections/registry.ts:70`), `registerCatchUp`, `registerEventAudience` (synchronous `(event, socket) => boolean`), `WsHub` (`connectedSessions()`, `sendToSessions`, `sendToStaff`; `PONG_MS` 30 000), station sessions (M30), `StaffDirectory.resolve`, `clock`, `ids`, `devices.point_id` / `devices.lane_label` (H-5, H-6, migration `0008`).
- Foundation §4.2 stage guard; §5.8 boot (step 5 resumes the print queue); D24; R8.
- 01a: `branchConfig()` (stations with `completion_mode`, `point_id`; points; tables with codes), `openDayStartMs`, `BusinessDayOpened`, `onBranchConfigApplied`, `hub_time`.
- 01b: `resolve(staff, permission)` (scopes `branch`, `own_tables`, `my_floors`), `PERMISSION_CATALOGUE` (group `kitchen`: `move-item-to-stock`, `mark-item-returned`, `reprint-ticket`), `default_key` grants (`apps/cloud/src/modules/staff-roles/default-roles.ts`).
- 01d: `defineAlertKind` (startup validation, `alerts/kinds.ts`: e.g. `expires_at_day_close: false` needs `closes_on: 'seen'`), `alerts.raise` (dedupe on an **open** alert with the same `(kind, dedupe_key)` in the database, `raise.ts:164`) / `raiseMany` / `close` / `closeMany` (return drafts) / `tickCtx`, `registerTick` (`due` + `intents`; `intents` re-read inside `writer.run`), `ALERT_CONSTANTS`, `AlertDisplaySchema` (`table_code`, `point_code`, `requester_name`, `device_name`, `kind_label_key`), A3 (hub-subject alerts on stream `hub` / `branch_id`).
- 02a: `currentTableOf(db, order_ids[])` (ids, 1 statement), `tableOwners`.
- 02b: projection `orders` (tables `orders`, `order_lines`), `ORDER_NOT_FOUND`, `ITEM_WRONG_STAGE { stage: 'out_of_engine' }` (02b §3.5), events `ItemRemoved { units? }`, `OrderBoosted`, `ItemsReleased`, `ItemServed`, `OrderCancelled`.
- 03a: `@pos/engine` `stationView`, `stationPlan`, `groupReadiness(state, order_id, now)`, `pullEarly(state, station_id, n, now)`, `lateStartShift`, `capacityForLanes`, `stockEffects`, `liveInterval`; `EngineLine` (`point_id`, `carry_ms`, `prep_ms`, `cook_ms`, `from_stock`, `stage`, `done_at`, `return_of: { order_item_id, mode }`, `load_id`, `mark`); `station_plan` part and frame; events `FireDispatched`, `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ReservationsShifted`, `StationCapacitySet`, `StockConsumed`; `SetStationCapacity` as built (`commands/set-station-capacity.ts`); `capacity_override` cleared by the `BusinessDayOpened` fold (03a §3.10); the `fires` tick (inferred Start / Done).

---

## §3. Domain rules

### 3.1 Words and identity

- **Line** = an engine line (03a §3.3). Zone-served lines and lines with no station never reach 03b.
- **Ticket** = the lines of **one order** fired at **one station** by **one** `FireDispatched` (P1). `ticket_id = fire_event_id + ':' + order_id`.
- **Job** = one row of `print_jobs`; **kind** ∈ `kitchen`, `reprint`, `cancel`, `first`, `coming_up`, `document`, `test`. Job ids are deterministic for jobs the projection writes (§3.6) and for fallback jobs (`ticket_id + ':kitchen'`, §3.8).
- **Has a kitchen job** (a ticket) = a `kitchen` job exists for it and is not cancelled — the test for "must still be printed" (fallback). **Printed** (a ticket) = a non-cancelled `kitchen` or `reprint` job with `sent_at` set — the test for slips and the `printed` tag.
- **Point of a line** = `EngineLine.point_id` (its home point; a line cooked at an alternate is carried there, 03a `carry_ms`); `null` → the point of the line's station. **Pass tablet** = a `tablet` device with `devices.point_id` set.
- **Identifier:** dine-in → `T` + the codes of the order's current tables (ids from `currentTableOf`, codes from `branchConfig().tables`), primary first: "T4 + T5"; takeaway → `#` + token, with the business date when from an earlier date ("#12 10 Nov"); parking → "PARKING LEB 1234 SEDAN".

### 3.2 Station commands (`StartItem`, `DoneItem`, `UndoDone`, `GiveMeMore`)

Caller: a **station session** for a line of its own station, or a **staff session** holding `run-pass` (P8). Station data come from the in-memory engine state (no SQL), as `SetStationCapacity`. Common step 1: `state.lines[id]` absent → `404 ORDER_NOT_FOUND { order_item_id }` (02b's meaning: no such order or line); the line's order out of the engine → `409 ITEM_WRONG_STAGE { order_item_id, stage: 'out_of_engine' }` (as 02b §3.5). Common step 2: station session and `line.station_id ≠ session.station_id` → `403 PERMISSION_DENIED`.

**`StartItem { order_item_id }`**
3. Stage guard: `added` **and fired** → else `409 ITEM_WRONG_STAGE { order_item_id, stage }` (unfired reports `'added'`; to start early the cook uses Give me more). `single_tap` station: the fire wrote the start → `{ stage: 'cooking' }`.
4. Batch station: targets = every fired `added` line with the same `load_id` (AD-18); else the one line.
5. Drafts: `ItemStarted { order_item_id, started_at: now, source: 'tap' }` per target; `lateStartShift` → `ReservationsShifted` when not null; `stockEffects` (array form; from-stock → `StockConsumed`).
6. Append. Result `{ started }`.

**`DoneItem { order_item_id, confirm?: boolean }`**
3. Stage: `cooking` → ok; `added` and fired → ok **only if `line.from_stock`** (a portion from the warmer has no Start; 03a AD-29 Q7) or the station is `auto_done`; otherwise `409 ITEM_WRONG_STAGE { stage: 'added' }` (client: inline "Tap Start first"); `done` / `served` / `removed` / `voided` / `returned` → `ITEM_WRONG_STAGE`.
4. Sanity (03a #3): only when `started_at` is set: `now − started_at < 0.5 × line.cook_ms` (with a `fix` return's override) and `confirm ≠ true` → `422 ITEM_DONE_CONFIRM_REQUIRED { order_item_id, elapsed_ms, cook_ms }`, nothing written. Applies to taps at every completion mode. The client shows the inline second tap, never a modal.
5. Batch station: every `cooking` (or, from stock, fired `added`) line of the load. Drafts `ItemDone { order_item_id, done_at: now, source: 'tap' }` + `stockEffects` (a from-stock line with no Start consumes here).
6. Append. Result `{ done }`. A client that gets `ITEM_WRONG_STAGE { stage: 'done' }` right after its own Done treats it as success (another screen won).

**`UndoDone { order_item_id }`**
3. Stage `done` and `now − line.done_at ≤ UNDO_DONE_MS` (30 000, new constant in `@pos/domain`, D16) → else `409 ITEM_UNDO_WINDOW_CLOSED { order_item_id }`. An inferred Done (`auto_done`) carries its planned end as `done_at`, so it is undoable only within 30 s of that end. A line in a Handover → `409 ITEM_WRONG_STAGE { stage: 'handed_over' }` (1 statement, `handover_lines`).
4. Batch station: every `done` line of the load inside the window (same rule as Done).
5. Drafts `ItemDoneUndone` per line. If the order has an **open Ready** at the line's point (`pass_orders.ready_alert_id` not null, 1 statement): add `ReadyToServeUndone { order_id, point_id, alert_id }` and `alerts.close(ctx, ready_alert_id, 'undone')` (01d G1-21.4).
6. Append. Result `{ undone, ready_undone }`.

**`GiveMeMore { station_id, n?: 1–10 (default 1) }`**
1. Station session: own station only. Unknown or archived station → `404 STATION_NOT_FOUND`.
2. `pullEarly(state, station_id, n, now)`; `null` → `200 { pulled: null }`, nothing written (AD-24).
3. Draft = the returned `FireDispatched { reason: 'pulled' }` (a load whole); `single_tap` → also `ItemStarted { source: 'inferred' }` per line.
4. Append. Result `{ pulled }`.

All four: not queueable (P5); station-session events carry `actor_id = null` and the KDS `device_id` (README :170).

### 3.3 Station view (KDS wall screen)

- **Now** = `stationView(state, station_id, now).now` (engine, 0 statements) — fired, not done, still live; plus done lines inside `UNDO_DONE_MS`, kept by the client. **Next** = `station_plan` lines with `frozen: true`; **Later: N** = `frozen: false`, counted. 03a's contract holds: new lines append at the bottom, Done removes its line, nothing visible reorders; `mark` lines (`expedite`, `boost`, `pulled`) and `return` lines show at the top in red with their reason; a Next line with `mark: 'moved'` keeps its row with a red "moved" tag and its new time.
- **Line details** from 03b: catch-up part `kds_station` (§6.18) and frame `kds_lines` (§6.20), shape `LineDetail` (§4.4). An id with no detail yet shows a placeholder row in place, filled when `kds_lines` arrives (never reorders).
- **Time (P6):** Now, started → "cooking m:ss" since `started_at`; Now, not started → "waiting m:ss" since `fired_at`; **late** (red, "late +N min") when `now > planned_done_ms` = `started_at + cook_ms` once started, else `fired_at + prep_ms + cook_ms`. Next → "in m:ss" to `fire_ms`. Device clock corrected by `hub_time`. No clock or promise time.
- **Coming-up strip (P12):** live units by item name over Now + Next, largest first, max 6 names; client-computed.
- **Completion modes:** `two_tap` Start then Done (from-stock lines: Done only); `single_tap` only Done; `auto_done` the line leaves at its inferred Done unless tapped.
- **Printed tag:** `LineDetail.printed`.
- **Config:** the KDS (and the Pass screen) refetch config on `BranchConfigApplied` (01a :433, S47 pattern), so renamed items, stations and completion modes show without reload.
- **Day not started (00 Q10):** before `BusinessDayOpened` the KDS shows "Day not started"; no button.
- **Archived station:** open lines keep rendering (S22) under a banner "Station archived — finish open tickets" (§3.13).

### 3.4 Assembler view (Pass tablet)

- Shows every **open order with a live engine line whose point (§3.1) is this point**, one card per order, oldest first, identifier big; per line: station short name, item × units, stage (waiting / cooking / done / handed over). Served, removed, voided and returned lines drop off; the card drops off when none is left or the order leaves the engine.
- **Readiness per point:** `groupReadiness(state, order_id, now)` filtered to this point's lines: **"Ready"** (green) when no sync line of the order at this point is `added` or `cooking`; **HOLD AT PASS** hint (amber) when a done line waits for a sibling — a hint, never a block (K4). Immediate lines show their own green when done.
- Buttons per card: Ready to serve, Hand over (receiver tiles), Undo (30 s), and Start / Done for lines of screenless stations (`run-pass`). Lanes: each station of the point with lanes and its Lane Off / On toggles (§3.11).
- Data: catch-up part `point_view` (§6.19), frame `point_lines` (§6.20), event frames (§6.21).

### 3.5 Ready to serve, Handover, Served card

**Dedupe key** for every Ready alert: `order_id + ':' + point_id + ':' + (table_id ?? '-')` (D6).

**`MarkReadyToServe { order_id, point_id }`** (`run-pass`)
1. Point exists, not archived → else `404 POINT_NOT_FOUND`. Order in the engine → else `409 ORDER_NOT_IN_ENGINE`.
2. Point lines = the order's live engine lines whose point is `point_id`, not served, not handed over (engine + 1 statement `handover_lines`). None → `409 ITEM_WRONG_STAGE { stage: 'served' }`.
3. Open Ready for `(order_id, point_id)` (1 statement, `pass_orders`) → `200 { already: true, alert_id }`, nothing written.
4. Target: dine-in → `{ kind: 'table_team', table_id: <current primary table>, depth: 'direct' }` (02a §4.3 To 03b); takeaway / parking → `{ kind: 'person', staff_id: orders.placed_by }` (a cashier at a fixed POS with no route is rescued by step 2, accepted).
5. `alerts.raise(ctx, { kind: 'ready_to_serve', subject: { stream_type: 'order', stream_id: order_id }, target, values: { order_id, point_id, table_id: table_id ?? '', window_ms: ready_window_ms }, display: { table_code: <primary table code> | null, point_code: <point name>, kind_label_key: 'alert.ready_to_serve' }, details: { identifier: <§3.1 text> }, dedupe_key })`.
6. Append `ReadyToServe { order_id, point_id, order_item_ids, table_id | null, alert_id }`. Result `{ alert_id }`. Ready while lines still cook is allowed (K4); the card says which still cook.

**`UndoReadyToServe { order_id, point_id }`** (`run-pass`): open Ready, `now − ready_at ≤ UNDO_DONE_MS`, no Handover since → `ReadyToServeUndone { order_id, point_id, alert_id }` + `alerts.close(…, 'undone')`; else `409 PASS_UNDO_WINDOW_CLOSED { order_id, point_id }`.

**`Handover { handover_id, order_id, point_id, receiver_staff_id, order_item_ids? }`** (`run-pass`)
1. As `MarkReadyToServe` step 1.
2. Receiver: active staff of the branch whose `resolve(receiver, 'mark-served')` **covers this order** — scope `branch`; `own_tables` → the order's current table is theirs (`tableOwners`); `my_floors` → its floor is theirs; takeaway / parking need `branch` (as 02b `MarkServed` scopes). Else `422 PASS_RECEIVER_INVALID { receiver_staff_id }`. Tiles come from `GET /queries/pass-receivers` (§6.16); the receiver taps nothing (K5).
3. Lines = `order_item_ids` or, if absent, every **done** point line not handed over. Each must be at this point, `done`, not handed over, not served → else `409 ITEM_WRONG_STAGE { order_item_id, stage }`. Empty → `ITEM_WRONG_STAGE`.
4. No open Ready → also append `ReadyToServe { …, alert_id: null }` first (no alert: the food is already in hand).
5. Raise `served_card` to `{ kind: 'person', staff_id: receiver_staff_id }`, dedupe `handover_id`, display `{ table_code, kind_label_key: 'alert.served_card' }`.
6. If no point line of the order is left un-handed → close the open Ready `done`.
7. Append `Handover { handover_id, order_id, point_id, receiver_staff_id, order_item_ids, alert_id, ready_alert_closed }`. Result `{ served_card_alert_id }`.
8. `handover_id` is client-made (ULID): D32 catches the same command; an existing `handover_id` with other lines → `422 IDEMPOTENCY_KEY_MISMATCH`.

**Closing Ready and Served cards (tick `pass_closures`, §6.23):**
- An open **Ready** closes `done` when none of its point lines is left live and unserved — served by any source (Handover then `MarkServed`, a waiter's own `MarkServed` with no Handover, the estimate), removed, voided, returned, or the order left the engine / was cancelled. So a waiter who takes the plate and taps Served on their phone silences it before step 1.
- An open **Served card** closes `done` when every line of its hand-over is served or gone.
- Both checks read the engine (memory) for line state; the tick's `due` is one statement each for the open rows.

**Re-target (tick `ready_retarget`, §6.22):** an open Ready whose stored `table_id` is not the order's current primary table → `alerts.close(…, 'obsolete')`, raise again with the new table in the dedupe key (so the raise never dedupes onto the alert being closed), append `ReadyRetargeted { order_id, point_id, table_id, alert_id, previous_alert_id }`. The new alert starts its steps again (a party that moves twice delays escalation by up to 2 × window; accepted).

**Day close:** both kinds `expires_at_day_close: true`.

### 3.6 Kitchen tickets (P1, P2, D1)

Projection **`kitchen_tickets`** (forward-only, no `reset`). Folds in **both** modes write `tickets` and `ticket_lines`; **`print_jobs` rows are written only when `mode === 'live'`** — a projection with no checkpoint (first deploy onto a hub with history, a restore) replays from seq 0 in `catchup` and must not queue history (00 registry). The fold is **total**: a missing `order_lines` row, unknown station, unparsable config row or any unexpected shape → skip that ticket or slip, log `print.fold_skipped { event_id, reason }`, never throw — a throw would roll back the fire or the command (R8).

*Read of another projection (02b T19 exception, recorded):* the fold reads `order_lines.order_id` for the fired ids (`FireDispatched` carries no order id). It is safe: `order_lines.order_id` never changes after `ItemAdded`; in `live` mode 02b's `orders` projection applied the `ItemAdded` in an earlier commit; in `catchup` 02b's projection is registered first and the row exists before 03b's job reaches the fire. The fold also reads `station_outputs` (its own module's table).

- **`FireDispatched { station_id, order_item_ids }`**: group the ids by `order_lines.order_id` (1 read). Per order: one `tickets` row (`ticket_id`, `station_id`, `order_id`, `fire_event_id`, `fired_at = recorded_at`, `reason`) and one `ticket_lines` row per id — one multi-row insert per table. Live, and the station's output (1 read) is `printer` or `both` → one `kitchen` job per ticket, `job_id = ticket_id + ':kitchen'`, `INSERT OR IGNORE`.
- **`ItemDone`** / **`ItemServed`** → `ticket_lines.done_at = recorded_at`; **`ItemDoneUndone`** → `done_at = NULL`. (`done_at` serves only the slip decisions below; "open" lines elsewhere come from the engine, D7.)
- **`ItemRemoved { order_item_id, units? }`** / **`ItemVoided { order_item_id, units }`** on a `ticket_lines` row with `done_at IS NULL`, ticket **printed** (1 read) → `cancel` job `{ ticket_id, order_item_id, units_removed, units_left }` (02b O16; P9). Not printed → nothing (render-at-send drops the units).
- **`OrderBoosted`** / **`ItemsReleased { expedite }`**: per printed ticket of the order (boost) or holding an expedited line (expedite) with a not-done line, **at a `printer` station** → `first` job `{ ticket_id, reason }`.
- **`TicketReprinted { ticket_ids }`** → one `reprint` job per ticket.
- Job ids for slips and reprints: `event_id + ':' + kind + ':' + n` (deterministic, `INSERT OR IGNORE`). The `ItemsReleased` dedupe (03a #1) is met: one job per event id.
- Cost per event: ≤ 3 reads + one multi-row insert per table.

**Ticket layout (fixed, G1-14; 32 columns at 58 mm, 48 at 80 mm; ASCII-mapped, §3.10):**

```
TANDOOR                        1:22 PM
================================
           T4 + T5                      <- identifier, double width + height
DINE-IN  Bilal  #7F3K2Q                 <- type, order taker (toggle), last 6 of order id (toggle)
** RETURN - REMAKE - was T7 Chicken Karahi **
** FIRST - T12 is eating **
--------------------------------
4 x Naan
3 x Naan - for Chicken Karahi Full
1 x Chicken Karahi (Family Deal)
    + Extra butter
    NOTE: less spicy
--------------------------------
ORDER NOTE: birthday, bring together
```

No prices, no COMP marker, no zone-served lines. Units = live units at render. Time = fire time, 12-hour (01d AD-167). Toggles "show order taker", "show order id" per station on the hub admin (default on).

### 3.7 Station output, printers, device roles (P3)

- **Printer** (`SavePrinter`, admin session): name 1–40 (unique among active), `connection` `lan` (`host:port`, host an IPv4 in 10/8, 172.16/12 or 192.168/16, port 1–65535, default 9100; the kitchen's preferred link, F-2) or `usb` (a device path matching `/dev/usb/lp[0-9]` or a stable udev symlink `/dev/pos-printer-[a-z0-9-]{1,30}` — install doc: a udev rule by USB serial so two printers never swap `lp0` / `lp1`, and the hub service user in group `lp`), `paper_width_mm` 58 | 80. Archive refused while a station output uses it (`409 CONFIG_IN_USE`).
- **Station output** (`SetStationOutput`, admin session): `mode` `screen` | `printer` | `both`, `printer_id` (used by `printer`, `both` and by `screen` for fallback), `sound_volume` 0–100, toggles. `printer` / `both` without a printer → `400 VALIDATION_FAILED { field: 'printer_id' }` (DB CHECK backs it). No row = `screen`, no printer, volume 70.
- **Device roles** (`SetDeviceRole`, admin session): bind a tablet to a point (`point_id`), or give a `kds` device a `lane_label` (H-6 rules).
- **Hub admin warnings** (`print-config` query): a `screen` station with no printer ("No paper fallback — a dark screen raises an alert, nothing prints"); a menu or station name that loses characters in PC437 (G1-15); an archived station with open lines.
- **Presence on the hub admin:** each station's connected screens and each Pass tablet's connection (memory, from the worker's presence map) — for install day and power-cut recovery.
- Config is hub-local (events on stream `hub` / `branch_id`; projection `print_config` with `reset`); worker-learned facts live in `printer_runtime`, outside the projection (§5).

### 3.8 Paper fallback (P4, D3)

Print worker, every 1 s, after the HTTP / WS server listens (screens can only reconnect then):

1. **Presence:** `connectedSessions()` (memory) with `stationId` (00 row H-2; 0 statements) → stations with a connected screen.
2. Per station with mode `screen`: none connected → `offline_since` (memory; initialised at server listen). Detection of a dead screen can take up to `PONG_MS` (30 s) before the socket drops, plus `kds_offline_print_ms`. A socket that is alive with a dead display is not detected (accepted).
3. `now − offline_since ≥ kds_offline_print_ms`:
   - **With a printer → enter fallback:** for each ticket of the station holding a line in `stationView(state, station_id, now).now` (engine) and with **no kitchen job** → insert `kitchen` job `ticket_id + ':kitchen'` (`INSERT OR IGNORE`; unique index), oldest first; then one `coming_up` job (`station_id + ':coming_up:' + offline_since`, `INSERT OR IGNORE`), rendered at send from `stationPlan` (Next lines "1:30 PM  2 x Naan  T7").
   - **Without a printer → raise `kds_offline`** (§6.24) once (dedupe `station_id`), when the station has lines in Now or Next.
4. **In fallback**, each loop: the same insert for tickets fired since the last loop (1 statement; `INSERT OR IGNORE` makes repeats harmless while a job waits to be sent).
5. A station socket connects → leave fallback; close `kds_offline` `done`; nothing printed is cancelled; the screen shows `printed` tags.
6. `printer` / `both` stations are not affected. Fallback state is memory only; after a restart the screens reconnect within the grace and nothing doubles (jobs already queued keep their ids).

### 3.9 Slips and reprint (P9, P13)

- **CANCELLED** (`cancel`): "CANCELLED  T7  - 1 x Naan  3 left" or, whole line, "CANCELLED  T7  4 x Naan".
- **FIRST** (`first`): "FIRST  T12  2 x Roghni (boost)".
- **REPRINT header:** every `reprint` job and every job re-sent after a restart or after a write that failed part-way (`is_reprint = 1`).
- **Stale slips:** a `cancel` or `first` job renders empty (→ cancelled, `last_error 'stale'`) when its line is done, served or gone; a `coming_up` job older than 10 min at send is cancelled `stale`; a `reprint` job whose ticket has no live line renders empty. So a printer back after hours prints only live tickets.
- **`ReprintTicket { ticket_id? , order_id? }`** (exactly one): station session → its own station's tickets; staff → `reprint-ticket` (scope `branch`). By `order_id` = every ticket of the order (a station session gets its station's). Writes `TicketReprinted { order_id, station_id | null, ticket_ids }` (audit) → projection adds `reprint` jobs (live). A ticket with nothing live → `result.skipped`.

### 3.10 Rendering and ESC/POS (D4, P10)

- `Doc = { width_cols?: 32 | 48, blocks: Array<{ text, size?: 'normal' | 'double', bold?, align?: 'left' | 'center' | 'right' } | { rule: '-' | '=' } | { feed: n } | { cut: true } | { drawer: true }> }`. Text wraps to 32 / 48 columns; long words break.
- **Character mapping before encoding:** `—` `–` `−` → `-`; `×` → `x`; `·` → `' '`; curly quotes → straight; then PC437; anything else → `?`. Golden tests compare bytes.
- Encoder (no library): `ESC @`, `ESC a n`, `ESC E n`, `GS ! n`, `GS V 66 0`, `ESC p 0 25 250`, `DLE EOT 1` / `DLE EOT 4` (Epson ESC/POS command reference, checked 2026-11-11).
- Render reads at send: the ticket's lines with `order_lines` / `orders` (1 statement), `currentTableOf` (1) + config table codes, the engine (memory) for `return_of`, mark and names; **a reprint of an order no longer in the engine** falls back to `order_lines` (return id, names) and config station names. A `kitchen` / `first` / `cancel` job with nothing live and not done renders empty → cancelled, not sent; a `reprint` prints every live line, done or not.

### 3.11 Lanes (P11)

- `lane_count` = `kds` devices of the station with a `lane_label`, not revoked (H-6), else 1.
- **`SetLaneState { station_id, lanes_on }`**: station session for its own station, or `run-pass`. `lanes_on` 1…`lane_count` → else `400 VALIDATION_FAILED`. Computes `capacity_override = capacityForLanes(station, lanes_on, lane_count)` (null when all on) and runs **the same checks as `SetStationCapacity`** through one shared helper extracted from `set-station-capacity.ts` (station-session cap ≤ configured capacity; scope last), then appends 03a's `StationCapacitySet { …, reason: 'lane_off' | 'lane_on' }` and 03b's `LanesSet { station_id, lanes_on, lane_count }`. 03a row **T-1** records 03b as a second writer of `StationCapacitySet` for lane reasons and `run-pass` as a second right for those two reasons only (§4.5).
- `station_lanes` follows the engine: `BusinessDayOpened` deletes every row (03a clears `capacity_override` at day open, so all lanes are on); `StationCapacitySet { reason: 'manager' }` deletes that station's row (the screen shows "capacity set by manager"). Same `lanes_on` as stored → no-op.
- Labels: `SetDeviceRole`. Claims: §12.4.

### 3.12 Permissions and scopes

| Action | Station session (KDS) | Staff session (device) | Admin session |
|---|---|---|---|
| `StartItem`, `DoneItem`, `UndoDone`, `GiveMeMore`, `SetLaneState` | own station | `run-pass` (`branch`) | — |
| `MarkReadyToServe`, `UndoReadyToServe`, `Handover` | `403 PERMISSION_DENIED { session_kind: 'station' }` | `run-pass` | — |
| `ReprintTicket` | own station's tickets | `reprint-ticket` (`branch`) | — |
| `GET /queries/pass-receivers` | — | `run-pass` | — |
| `GET /queries/order-tickets` | — | `reprint-ticket` | — |
| `SavePrinter`, `SetStationOutput`, `SetDeviceRole`, `POST /print/test`, `POST /print/jobs/:id/cancel`, `GET /queries/print-config`, `GET /queries/print-queue` | — | — | `manage-devices` |

New permission **`run-pass`** (group `kitchen`, scope `branch`; default grant by `default_key`: `owner`, `manager`, `cook` allowed) — B-1, which also overrides 00 M29 / 01b B17's note that Cook has no permissions. Scope is checked last (C8).

### 3.13 Config reactions

- **Archived station:** `onBranchConfigApplied(prev, next)` hook: for each station archived in `next` with lines in `stationView(…).now` or `station_plan` (engine, 0 statements), after commit send `station_notice { station_id, kind: 'archived', open_lines }` to its station sockets and to admin sessions; the `print-config` warning lists it until the lines are gone.
- **Station output / printer change:** pending jobs of a station follow its current printer at send; `document` / `test` keep their own `printer_id`.

### 3.14 Print worker and failure rules (R8, D4)

- **Never blocks service:** no command waits for paper; the projection only inserts rows, live only, and never throws (D1).
- **One FIFO per printer:** the oldest pending job (`acked_at IS NULL AND cancelled_at IS NULL`) of each printer; the next waits for its ack. Printers run in parallel. **`test` jobs bypass the FIFO** (sent at once, on their own connection).
- **Send (synchronous head):** render the bytes and set `sent_at = now` **in the same synchronous step** (no `await` between them), so a removal committed after the render sees the ticket as printed and queues its CANCELLED slip (02b O16). Then connect (LAN 3 s timeout; USB open), write, wait for drain.
- **Ack (D4):** the whole document written and flushed → `acked_at`. Then, if the printer answers `DLE EOT 1` / `4` within 2 s, store the status in `printer_runtime`; offline / paper-end / cover-open / error bits raise `printer_problem` — the ticket is **not** resent (it may be on paper). A printer that never answers is simply "status unknown".
- **Failure before a full write** (connect refused, timeout, reset mid-write): `attempts + 1`, `last_error`, `is_reprint = 1` if any byte was written, `sent_at = NULL`; retry after 2 s, 5 s, then every 10 s, no limit. Kitchen and slip jobs drain themselves when their lines finish (empty render, §3.9); `document` jobs wait or are cancelled by a manager.
- **`printer_problem`** (§6.24): raised when the head job has failed for ≥ `ALERT_CONSTANTS.printer_alert_ms` (30 000) or a status bit is set; one `writer.run`; closed `done` at the next clean ack, `obsolete` on `PrinterSaved { archived: true }` or when the printer has no pending job and a clean status.
- **Restart (F §5.8 step 5):** before the worker starts, jobs with `sent_at` set and `acked_at` null → `is_reprint = 1, sent_at = NULL`; the worker drains in `created_at` order.
- **Writes outside transactions:** the worker's `print_jobs` / `printer_runtime` writes are plain statements on the hub connection between transactions (better-sqlite3 is synchronous and `writer.run` has no `await`), never events, never synced (F §3).

### 3.15 Print API for 05

- `printDocument(tx, printer_id, doc, meta?: { kind_label: string })` → a `document` job in the caller's transaction (bill and receipt commit together); unknown or archived printer → `404 PRINTER_NOT_FOUND`. A drawer kick is `printDocument(tx, id, { blocks: [{ drawer: true }] })`.
- 05 owns the receipt template and preview; the preview uses `renderText(doc, width)`.

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | §2 list; `ConnectedSession.stationId` (H-2) | §3, §6 |
| 01a | `branchConfig()` (stations, points, tables), `openDayStartMs`, `BusinessDayOpened`, `onBranchConfigApplied`, `hub_time`; settings `ready_window_ms`, `kds_offline_print_ms` (A-1) | §3.3, §3.5, §3.8, §3.13 |
| 01b | `resolve`; `run-pass` (B-1), `reprint-ticket`, `manage-devices`, `mark-served` | §3.5, §3.12 |
| 01d | §2 list; `ALERT_CONSTANTS.printer_alert_ms` (D-1) | §3.5, §3.8, §3.14 |
| 02a | `currentTableOf`, `tableOwners` | §3.1, §3.5 |
| 02b | `order_lines`, `orders` (read-only), events | §3.6, §3.10 |
| 03a | §2 list; T-1 | §3.2–§3.11 |
| 04 | `ItemVoided { order_item_id, units }` | §3.6 |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `printDocument(tx, printer_id, doc, meta?)` | `{ job_id }` | 2 | 05 |
| `renderText(doc, width_cols)` | `string` (pure) | 0 | 05 preview |
| `handoversDue(db, now, older_than_ms)` | `Array<{ handover_id, order_id, order_item_ids }>` — open-card hand-overs handed at or before `now − older_than_ms` with an unserved live line; `LIMIT 200` | 1 | 02b `served_estimate` (task 0e) |
| `Doc`, `LineDetail` types | §4.4 | — | 05, clients |
| Events, kinds, catch-up parts, frames | §6 | — | 02b, 05, 07 |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 02b | Tick `served_estimate` (02b §3.7, §6.11, O14): `due` = `handoversDue(db, now, served_estimate_ms)` when the setting is not null; `intents` = `ItemServed { source: 'estimated' }` per order + `stockEffects` + `OrderFoodServed` for food lines. **Task 0e of 03b's plan (OQ-2)**, after `module-02b` merges and after tasks 0b and 29. `served_estimate_ms = null` → the tick is not due. |
| 02b | Reprint on the order-taker / cashier screens (P13) is 02b client code: **OQ-4** (owner) — add it to the OQ-2 list as task 0f, or leave it a 02b follow-up. |
| 04 | Nothing new: 03b folds `ItemVoided` itself. |
| 05 | Print bills, receipts and the Z report with `printDocument` in the bill-close transaction; own the template (R12) and preview over `renderText`; pick the cashier's printer from 03b's list; a receipt printer outage never blocks bill close (R8). |
| 01e | Button stations: mode `printer`, or `screen` with a fallback printer; headless point devices and lane buttons write the H-5 / H-6 columns (through 03b's `DeviceRoleSet` or 01e's pairing); lane claims (K7) are 01e's. |
| 07 | Pass timings and reprint counts from `ReadyToServe`, `Handover`, `TicketReprinted`; print history is hub state, not events. |

### 4.4 Shared types (`@pos/domain/src/kds.ts`, browser-safe)

```typescript
export const UNDO_DONE_MS = 30_000;   // D16; also Undo ready

type Identifier =
  | { kind: 'table'; label: string }                         // "T4 + T5"
  | { kind: 'token'; token: number; date: string | null }
  | { kind: 'parking'; car_number: string; car_type: 'sedan' | 'mini' | 'large' };

interface LineDetail {
  order_item_id: string; order_id: string; station_id: string; point_id: string;
  ticket_id: string | null;                 // null while unfired (Next)
  identifier: Identifier; order_type: 'dine_in' | 'takeaway' | 'parking';
  item_name: string; units: number;         // live units
  line_kind: 'item' | 'option_child' | 'deal_part';
  for_parent: string | null; deal_name: string | null;
  options: string[];                        // option children with no station
  kitchen_note: string | null; order_note: string | null;
  return_of: { order_item_id: string; mode: 'fix' | 'remake'; item_name: string; identifier: Identifier } | null;
  cook_ms: number; prep_ms: number; from_stock: boolean;
  printed: boolean;
}

type Doc = { width_cols?: 32 | 48; blocks: DocBlock[] };   // §3.10
```

### 4.5 Changes to other specs (R26) — *Proposed — needs approval*; each target gets its version bump, changelog and "Changed by 03b" markers (R34), applied by task 0d / 0a–0c

| Row | Target → version | Change | Why |
|---|---|---|---|
| F-1 | Foundation → **v1.12** §5.8 | `print_jobs` DDL replaced by 03b §5's; step 5 text: "sent and not acked → `is_reprint = 1`, `sent_at = NULL`, re-send in `created_at` order"; ack = flushed write (03b D4). D24 unchanged. | G1-2, D4 |
| F-2 | Foundation → **v1.12** OQ14 | Answered: generic thermal ESC/POS, USB and LAN; LAN preferred in the kitchen; USB via `usblp` with a udev symlink; status and code page learned per printer; no library. | P14 |
| H-1 | 00 → **v1.9** §5.1 H-5 / H-6 notes | Writers: 03b's `DeviceRoleSet` projection (and 01e's pairing when built). | G1-8 |
| H-2 | 00 → **v1.9** §4.2 `WsHub` | `ConnectedSession` gains `stationId: string \| null` (from the socket context; additive, H-4 shape). | run 1 m-10 |
| B-1 | 01b → **v1.8** | `run-pass` (group `kitchen`, scope `branch`); defaults by `default_key` `owner`, `manager`, `cook` (cloud `default-roles.ts`, hub seed); CHECK-expand migration; re-seed (R29); **overrides M29 / B17's "Cook has no permissions"**. | P8; m-19 |
| B-2 | 01b → **v1.8** settings wire | `served_estimate_ms` becomes writable on the owner settings PATCH and returned on GET (`packages/events/src/admin/staff.ts`), range per A-1. | M-11 |
| A-1 | 01a → **v2.4** branch settings + snapshot `settings` | `ready_window_ms` (60 000; 15 000–300 000), `kds_offline_print_ms` (30 000; 10 000–300 000), `served_estimate_ms` (180 000; 60 000–1 800 000; `null` = no estimate). Additive keys. | G1-10, P4, M-11 |
| D-1 | 01d → **v1.2.2** `ALERT_CONSTANTS` | Append `printer_alert_ms: 30_000`. | §3.14 |
| T-1 | 03a → **v1.2.1** §3.10, §6.6, To 03b #4 | 03b's `SetLaneState` also writes `StationCapacitySet` (`lane_off` / `lane_on`) through the shared check helper; `run-pass` is a second right for those two reasons only. | M-10 |
| S-1 | `stories-refined.md` E3 (editorial) | AC1 → assembler view per point; AC2–AC3 → 03a contract; AC5 volume on the hub admin; E0-TPL AC2 kitchen ticket fixed in the pilot. | G0 §3 |

### 4.6 Carried rows (README) and where they land

| Row | Lands in |
|---|---|
| :170 station commands `stationScoped` | §3.2; tests 1–4 |
| :190 default grants by `default_key` | B-1; test 60 |
| :199 archived-station warning | §3.13; test 52 |
| :200 ESC/POS 58 / 80, USB / LAN; receipt template | §3.10, §3.15; tests 40–47 |
| :211 child / deal / option layout | §3.6; test 30 |
| :237 02a current table, Ready target, re-target | §3.1, §3.5; tests 20–22 |
| :240 #1–#8 03a | §3.2–§3.5, §3.11; tests 1–29 |
| 02b To 03b | §3.1, §3.6, §3.9, §4.3; tests 30–35 |
| 01a :398, :405, :406, :433 | §3.6, §3.3, §3.13, §8 |
| 01d D-2, N-2, G1-12b, G1-21.4 | §3.5, §3.12, §6.24 |
| OPEN-QUESTIONS 00 Q10 | §3.3 |

---

## §5. Data model (hub SQLite)

Migration `apps/hub/src/db/migrations/NNNN_kds_print.sql`, next free number at build time.

```sql
-- print_config projection (with reset): PrinterSaved, StationOutputSet, LanesSet,
--   BusinessDayOpened (clears station_lanes), StationCapacitySet reason 'manager' (deletes that row)
CREATE TABLE printers (
  printer_id     TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  connection     TEXT NOT NULL CHECK (connection IN ('lan','usb')),
  address        TEXT NOT NULL,
  paper_width_mm INTEGER NOT NULL CHECK (paper_width_mm IN (58,80)),
  archived_at    INTEGER,
  updated_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX printers_name_active ON printers (name) WHERE archived_at IS NULL;      -- CONFIG_NAME_TAKEN

CREATE TABLE station_outputs (
  station_id    TEXT PRIMARY KEY,
  mode          TEXT NOT NULL CHECK (mode IN ('screen','printer','both')),
  printer_id    TEXT,
  sound_volume  INTEGER NOT NULL CHECK (sound_volume BETWEEN 0 AND 100),
  show_taker    INTEGER NOT NULL DEFAULT 1 CHECK (show_taker IN (0,1)),
  show_order_id INTEGER NOT NULL DEFAULT 1 CHECK (show_order_id IN (0,1)),
  CHECK (mode = 'screen' OR printer_id IS NOT NULL)
);
CREATE INDEX station_outputs_printer ON station_outputs (printer_id);                      -- CONFIG_IN_USE

CREATE TABLE station_lanes (
  station_id TEXT PRIMARY KEY, lanes_on INTEGER NOT NULL, lane_count INTEGER NOT NULL,
  CHECK (lanes_on BETWEEN 1 AND lane_count)
);

-- worker-owned (plain statements, survives print_config rebuilds)
CREATE TABLE printer_runtime (
  printer_id      TEXT PRIMARY KEY,
  last_ack_at     INTEGER,
  last_error      TEXT,
  last_status     TEXT,                          -- JSON of the decoded DLE EOT bits, NULL = unknown
  problem_alert_id TEXT                          -- open printer_problem alert
);

-- kitchen_tickets projection (forward-only; jobs only in 'live' mode): FireDispatched, ItemDone,
--   ItemDoneUndone, ItemServed, ItemRemoved, ItemVoided, OrderBoosted, ItemsReleased, TicketReprinted
CREATE TABLE tickets (
  ticket_id     TEXT PRIMARY KEY,                -- fire_event_id || ':' || order_id
  station_id    TEXT NOT NULL,
  order_id      TEXT NOT NULL,
  fire_event_id TEXT NOT NULL,
  fired_at      INTEGER NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('scheduled','early_fill','pulled'))
);
CREATE INDEX tickets_order ON tickets (order_id);                                           -- reprint by order, boost slips
CREATE INDEX tickets_station_fired ON tickets (station_id, fired_at);                       -- fallback "fired since"

CREATE TABLE ticket_lines (
  order_item_id TEXT PRIMARY KEY,
  ticket_id     TEXT NOT NULL,
  station_id    TEXT NOT NULL,
  done_at       INTEGER                          -- slip decisions only (§3.6)
);
CREATE INDEX ticket_lines_ticket ON ticket_lines (ticket_id);                               -- render, catch-up details

CREATE TABLE print_jobs (                        -- F §5.8 (F-1); hub state, never synced
  job_id       TEXT PRIMARY KEY,                 -- deterministic for projection / fallback jobs (§3.6, §3.8); ULID otherwise
  kind         TEXT NOT NULL CHECK (kind IN ('kitchen','reprint','cancel','first','coming_up','document','test')),
  printer_id   TEXT,                             -- document / test; NULL → station's current printer
  station_id   TEXT,
  ticket_id    TEXT,
  order_id     TEXT,
  payload      TEXT NOT NULL,                    -- JSON reference or Doc
  created_at   INTEGER NOT NULL,
  sent_at      INTEGER,
  acked_at     INTEGER,
  cancelled_at INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  is_reprint   INTEGER NOT NULL DEFAULT 0 CHECK (is_reprint IN (0,1)),
  CHECK (printer_id IS NOT NULL OR station_id IS NOT NULL)
);
CREATE INDEX print_jobs_pending ON print_jobs (created_at)
  WHERE acked_at IS NULL AND cancelled_at IS NULL;                                          -- worker heads, boot step 5
CREATE INDEX print_jobs_ticket ON print_jobs (ticket_id) WHERE ticket_id IS NOT NULL;       -- printed / has-kitchen-job checks
CREATE UNIQUE INDEX print_jobs_one_kitchen ON print_jobs (ticket_id) WHERE kind = 'kitchen'; -- at-fire vs fallback never double

-- pass projection (with reset): ReadyToServe, ReadyToServeUndone, Handover, ReadyRetargeted, AlertClosed
CREATE TABLE pass_orders (
  order_id       TEXT NOT NULL,
  point_id       TEXT NOT NULL,
  ready_at       INTEGER,
  ready_by       TEXT,
  ready_alert_id TEXT,                           -- open Ready alert, NULL when closed
  ready_table_id TEXT,
  PRIMARY KEY (order_id, point_id)
);
CREATE INDEX pass_orders_open ON pass_orders (ready_alert_id) WHERE ready_alert_id IS NOT NULL;   -- ticks, AlertClosed fold

CREATE TABLE handovers (
  handover_id          TEXT PRIMARY KEY,
  order_id             TEXT NOT NULL,
  point_id             TEXT NOT NULL,
  receiver_staff_id    TEXT NOT NULL,
  handed_at            INTEGER NOT NULL,
  served_card_alert_id TEXT,
  card_closed_at       INTEGER
);
CREATE INDEX handovers_open ON handovers (handed_at) WHERE card_closed_at IS NULL;          -- handoversDue, pass_closures
CREATE INDEX handovers_card ON handovers (served_card_alert_id) WHERE served_card_alert_id IS NOT NULL; -- AlertClosed fold

CREATE TABLE handover_lines (
  order_item_id TEXT PRIMARY KEY,
  handover_id   TEXT NOT NULL
);
CREATE INDEX handover_lines_handover ON handover_lines (handover_id);
```

- Projections: `print_config` (reset), `kitchen_tickets` (forward-only, live-only jobs), `pass` (reset), `device_roles` (forward-only; `DeviceRoleSet` → `UPDATE devices SET point_id, lane_label`, H-1; after commit refreshes 03b's memory map `device_id → point_id`, also rebuilt at boot with 1 statement).
- Times are `recorded_at`. No session ids in 03b tables.

---

## §6. Commands, events and queries

**Common rules.** `POST /commands/:name`, D32 idempotency, no PIN, **not queueable** (P5). `sessionKind: 'device'` (station or staff session) for §6.1–6.9; `sessionKind: 'admin'` for §6.10–6.12. Responses `200 { data: { command_id, event_ids, result } }`; only `result` is listed. Statement counts exclude 01d's own bounds and the append; engine reads are memory.

### 6.1 `StartItem` — `{ order_item_id }`; station / `run-pass`; §3.2. Result `{ started }`. Statements 0. Errors `ORDER_NOT_FOUND`, `ITEM_WRONG_STAGE`, `PERMISSION_DENIED`.
### 6.2 `DoneItem` — `{ order_item_id, confirm? }`; §3.2. Result `{ done }`. Statements 0. Errors as 6.1 + `ITEM_DONE_CONFIRM_REQUIRED`.
### 6.3 `UndoDone` — `{ order_item_id }`; §3.2. Result `{ undone, ready_undone }`. Statements 2. Errors as 6.1 + `ITEM_UNDO_WINDOW_CLOSED`.
### 6.4 `GiveMeMore` — `{ station_id, n? }`; §3.2. Result `{ pulled }`. Statements 0. Errors `STATION_NOT_FOUND`, `PERMISSION_DENIED`.
### 6.5 `SetLaneState` — `{ station_id, lanes_on }`; §3.11. Result `{ lanes_on, lane_count, capacity }`. Statements 2 (lane devices, `station_lanes`). Errors `STATION_NOT_FOUND`, `VALIDATION_FAILED`, `PERMISSION_DENIED`.
### 6.6 `MarkReadyToServe` — `{ order_id, point_id }`; `run-pass`; §3.5. Result `{ alert_id, already? }`. Statements 4 (`handover_lines`, `pass_orders`, `orders`, `currentTableOf`). Errors `POINT_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`, `ITEM_WRONG_STAGE`, `PERMISSION_DENIED`.
### 6.7 `UndoReadyToServe` — `{ order_id, point_id }`; `run-pass`. Statements 2. Errors `PASS_UNDO_WINDOW_CLOSED`, `POINT_NOT_FOUND`, `PERMISSION_DENIED`.
### 6.8 `Handover` — `{ handover_id, order_id, point_id, receiver_staff_id, order_item_ids? (1–40) }`; `run-pass`. Result `{ served_card_alert_id }`. Statements 5 (`handovers` id, `handover_lines`, `pass_orders`, `currentTableOf`, `tableOwners` when the receiver's scope is `own_tables`). Errors `POINT_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`, `ITEM_WRONG_STAGE`, `PASS_RECEIVER_INVALID`, `IDEMPOTENCY_KEY_MISMATCH`, `PERMISSION_DENIED`.
### 6.9 `ReprintTicket` — `{ ticket_id? , order_id? }` (exactly one); §3.9. Result `{ ticket_ids, skipped }`. Statements 2. Errors `ORDER_NOT_FOUND`, `PERMISSION_DENIED`, `VALIDATION_FAILED`.
### 6.10 `SavePrinter` — admin; `{ printer_id, name, connection, address, paper_width_mm, archived? }`; writes `PrinterSaved`. Statements 2. Errors `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `VALIDATION_FAILED`.
### 6.11 `SetStationOutput` — admin; `{ station_id, mode, printer_id, sound_volume, show_taker?, show_order_id? }`; writes `StationOutputSet`. Statements 1. Errors `STATION_NOT_FOUND`, `PRINTER_NOT_FOUND`, `VALIDATION_FAILED`.
### 6.12 `SetDeviceRole` — admin; `{ device_id, point_id?: string | null, lane_label?: string | null }`; writes `DeviceRoleSet`. Statements 1. Errors `DEVICE_NOT_FOUND`, `POINT_NOT_FOUND`, `VALIDATION_FAILED`.
### 6.13 `POST /print/test` — admin, `manage-devices`; `{ printer_id }`. Sends a test page **outside the FIFO** on its own connection, waits ≤ 8 s. `200 { printed, status: object | null, error | null }`; updates `printer_runtime`. Errors `PRINTER_NOT_FOUND`.
### 6.14 `POST /print/jobs/:job_id/cancel` — admin, `manage-devices`. Sets `cancelled_at`. Errors `404 PRINT_JOB_NOT_FOUND` (absent), `409 PRINT_JOB_NOT_PENDING` (acked or cancelled).
### 6.15 `GET /queries/print-config` — admin. `{ printers, station_outputs, devices: [{ device_id, name, device_type, station_id, point_id, lane_label, connected }], warnings: [{ station_id?, item_id?, kind: 'no_fallback_printer' | 'archived_open_lines' | 'lossy_name' }] }`. Statements 4 (+ config and presence from memory).
### 6.16 `GET /queries/pass-receivers?order_id` — `run-pass`. `{ receivers: [{ staff_id, name, table_team }] }`: staff with an open session whose `mark-served` covers the order (§3.5 step 2), table team first. Statements 2.
### 6.17 `GET /queries/print-queue` — admin. `{ printers: [{ printer_id, name, status, waiting, head_error, last_ack_at }], jobs: [...pending, newest 100] }`. Statements 2.
### 6.17a `GET /queries/order-tickets?order_id` — `reprint-ticket`. `{ tickets: [{ ticket_id, station_name, fired_at, printed }] }`. Statements 1.
### 6.18 Catch-up part `kds_station` — station sockets, own station. `{ station_id, day_open, output: { mode, sound_volume, fallback }, lanes: { lanes_on, lane_count, by_manager }, now: Array<LineDetail & { stage, fired_at, started_at, mark }>, details: LineDetail[] (every `station_plan` line with `frozen: true`) }`. Now ids from `stationView` (memory). Statements 4: (1) `ticket_lines` ⋈ `print_jobs_ticket` for the ids (ticket id, printed), (2) `order_lines` + `orders` for the ids and their option children / parents, (3) `currentTableOf`, (4) `station_outputs` + `station_lanes`.
### 6.19 Catch-up part `point_view` — staff sockets on a device whose memory-map `point_id` is set. `{ point_id, stations: [{ station_id, short_name, lanes }], orders: [{ order_id, identifier, placed_at, lines: [LineDetail & { stage, handed_over }], ready: { at, by } | null }] }`. Line set from the engine (point of each line). Statements 5 (as 6.18 + `handover_lines` / `pass_orders`).
### 6.20 Frames — `kds_lines { station_id, lines }` / `point_lines { point_id, lines }`: after commit, details for ids the station's Now or `station_plan` (the point's lines) gained in that commit, sent once per id per socket set (memory filter, like 03a's payload filter); 2 statements per commit that adds lines. 03b registers its after-commit sender so that `kds_lines` goes **before** the commit's `station_plan` frame where the host orders hooks; the placeholder rule (§3.3) covers any other order. `station_notice` — §3.13.
### 6.21 Event audiences — `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ItemRemoved`, `ItemVoided`, `ItemServed`, `OrderBoosted`, `ItemsReleased`, `FireDispatched`: station sockets of the line's station (engine lookup) and staff sockets whose device's point (memory map, 0 statements) is the line's point; `ReadyToServe`, `ReadyToServeUndone`, `Handover`, `ReadyRetargeted`: staff sockets of that point; `LanesSet`: the station's sockets and its point's.
### 6.22 Tick `ready_retarget` — `due`: open Ready rows of dine-in orders (1 statement, `pass_orders_open`) + `currentTableOf` (1); due when a stored `ready_table_id` ≠ the current primary table. `intents`: re-reads the same two inside `writer.run` (an alert closed meanwhile is skipped), then per row `alerts.close('obsolete')` + `alerts.raise` (new dedupe key) + `ReadyRetargeted`. Statements: 2 + 2.
### 6.23 Tick `pass_closures` — `due`: open Ready rows (1, `pass_orders_open`) and open-card hand-overs with their lines (1, `handovers_open` ⋈ `handover_lines`), line state from the engine; due when §3.5's closing rule holds for any. `intents`: same two reads inside `writer.run`, then `alerts.closeMany(…, 'done')`. Statements: 2 + 2.

### 6.24 Kinds (registered at module top level, imported before boot step 4)

```typescript
defineAlertKind({
  kind: 'ready_to_serve', family: 'action', subject: 'order',
  steps: [
    { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
    { at: { value: 'window_ms', times: 1 }, to: [{ target: 'raised_target', set: 'recipient' }] },
    { at: { value: 'window_ms', times: 2 }, escalation: true,
      to: [{ target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' },
           { target: 'managers', set: 'recipient' }] },
  ],
  closes_on: 'owner',                          // Handover / pass_closures 'done', Undo 'undone', retarget 'obsolete'
  values_schema: z.object({ order_id: z.string().min(1), point_id: z.string().min(1),
                            table_id: z.string(), window_ms: z.number() }),
  details_schema: z.object({ identifier: z.string() }),   // over AlertDetailsBase (01d §3.12)
  lead_fallback: false, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.ready_to_serve.card', lock: 'alert.ready_to_serve.lock' }, request: null,
});
defineAlertKind({
  kind: 'served_card', family: 'info', subject: 'order',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
  closes_on: 'owner',                          // pass_closures
  values_schema: z.object({ handover_id: z.string().min(1), order_id: z.string().min(1) }),
  details_schema: null, lead_fallback: false, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.served_card.card', lock: 'alert.served_card.lock' }, request: null,
});
defineAlertKind({
  kind: 'printer_problem', family: 'action', subject: 'hub',   // { stream_type: 'hub', stream_id: branch_id } (01d A3)
  steps: [{ at: { ms: 0 }, to: [{ target: 'managers', set: 'recipient' }] }],
  closes_on: 'owner',                          // worker: 'done' at a clean ack, 'obsolete' on archive / nothing pending
  values_schema: z.object({ printer_id: z.string().min(1), waiting: z.number().int().min(0) }),
  details_schema: z.object({ printer_name: z.string(), problem: z.string() }),
  lead_fallback: true, expires_at_day_close: true, silent: false,   // a still-broken printer re-raises after 30 s
  labels: { card: 'alert.printer_problem.card', lock: 'alert.printer_problem.lock' }, request: null,
});                                            // dedupe_key 'printer_problem:' + printer_id
defineAlertKind({
  kind: 'kds_offline', family: 'action', subject: 'hub',
  steps: [{ at: { ms: 0 }, to: [{ target: 'managers', set: 'recipient' }] }],
  closes_on: 'owner',                          // worker: 'done' when a screen of the station connects
  values_schema: z.object({ station_id: z.string().min(1) }),
  details_schema: z.object({ station_name: z.string() }),
  lead_fallback: true, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.kds_offline.card', lock: 'alert.kds_offline.lock' }, request: null,
});                                            // dedupe_key 'kds_offline:' + station_id
```

### 6.25 Events (`schema_version` 1; `@pos/events/src/events/{order,station,hub}/`)

| Event | Stream / id | Payload | Written by |
|---|---|---|---|
| `ReadyToServe` | order / order_id | `{ order_id, point_id, order_item_ids, table_id \| null, alert_id \| null }` | `MarkReadyToServe`, `Handover` |
| `ReadyToServeUndone` | order / order_id | `{ order_id, point_id, alert_id \| null }` | `UndoReadyToServe`, `UndoDone` |
| `Handover` | order / order_id | `{ handover_id, order_id, point_id, receiver_staff_id, order_item_ids, alert_id, ready_alert_closed: string \| null }` | `Handover` |
| `ReadyRetargeted` | order / order_id | `{ order_id, point_id, table_id, alert_id, previous_alert_id }` | tick `ready_retarget` |
| `TicketReprinted` | order / order_id | `{ order_id, station_id \| null, ticket_ids }` | `ReprintTicket` |
| `LanesSet` | station / station_id | `{ station_id, lanes_on, lane_count }` | `SetLaneState` |
| `PrinterSaved` | hub / branch_id | `{ printer_id, name, connection, address, paper_width_mm, archived }` | `SavePrinter` |
| `StationOutputSet` | hub / branch_id | `{ station_id, mode, printer_id \| null, sound_volume, show_taker, show_order_id }` | `SetStationOutput` |
| `DeviceRoleSet` | hub / branch_id | `{ device_id, point_id \| null, lane_label \| null }` | `SetDeviceRole` |

The engine's replay filter (F-8) lists none of these. WS frame schemas `kds_lines`, `point_lines`, `station_notice` join the `WsServerMessage` union (`packages/events/src/ws.ts`).

---

## §7. Cross-cutting

| Item | Rule | Why (YAGNI) |
|---|---|---|
| Print worker | 1 s loop, async, one in-flight send per printer, starts after server listen | Network I/O outside the tick and every transaction (D3) |
| Timeouts | TCP connect 3 s, status 2 s, test 8 s | A dead printer never stalls others |
| Address validation | LAN private IPv4; USB `lp` device or `/dev/pos-printer-*` symlink | No sockets to the internet, no arbitrary files |
| Logging | `print.sent`, `print.acked`, `print.failed { printer_id, attempts, error }`, `print.fold_skipped`, `print.fallback.enter/leave { station_id }` | Install-day and rush diagnosis |
| Performance | Projection ≤ 3 reads + multi-row inserts per event; catch-ups ≤ 4 / 5 statements; worker loop ≤ 3 statements idle | ~200 orders / rush, ~10 devices |
| Retention | Acked / cancelled `print_jobs`, `tickets`, `ticket_lines` older than 7 days deleted at 00's maintenance hour (M66) | Hub disk; events are the history |
| Sync | 03b hub tables never sync; events sync as all events | F §3 |
| No new env var, no new dependency | — | — |

---

## §8. Client contract (`apps/client`, ui-kit only, 01a S35)

- **KDS entry** (`apps/client` entry `kds`, station session): station view §3.3; big targets, no modal; inline Done-early second tap and "Tap Start first"; Undo for 30 s on the removed row; Give me more; Lane Off / On on a lane KDS; sounds per P7 at `output.sound_volume`; "Reconnecting…" banner and taps disabled while the socket is down (P5); "Day not started"; archived banner; `printed` tags; coming-up strip; refetch config on `BranchConfigApplied`. English and Urdu UI strings.
- **Pass screen** (01d's `/staff/` entry, on a device with a point): §3.4 cards, Ready / Hand over / Undo, receiver tiles from `pass-receivers`, Start / Done for screenless stations, lanes; offline banner, taps disabled.
- **Hub admin "Printers" page** (`apps/client/src/features/admin/printers/`, admin session as `features/admin/stock`): printers (add, edit, archive, test print), station outputs, device roles, presence, print queue with cancel, warnings.
- **Reprint** on the order-taker / cashier screens: OQ-4.
- 12-hour times everywhere, on paper too.

---

## §9. Error catalogue additions (Foundation §6.2, `@pos/domain/src/errors.ts`)

| Code | HTTP | Details | When |
|---|---|---|---|
| `PRINTER_NOT_FOUND` | 404 | `{ printer_id }` | unknown or archived printer |
| `PRINT_JOB_NOT_FOUND` | 404 | `{ job_id }` | cancel of an unknown job |
| `PRINT_JOB_NOT_PENDING` | 409 | `{ job_id, state: 'acked' \| 'cancelled' }` | cancel of a finished job |
| `ITEM_UNDO_WINDOW_CLOSED` | 409 | `{ order_item_id }` | Undo Done after 30 s |
| `PASS_UNDO_WINDOW_CLOSED` | 409 | `{ order_id, point_id }` | Undo ready after 30 s or after a hand-over |
| `ITEM_DONE_CONFIRM_REQUIRED` | 422 | `{ order_item_id, elapsed_ms, cook_ms }` | Done under 50 % of cook time without `confirm` |
| `PASS_RECEIVER_INVALID` | 422 | `{ receiver_staff_id }` | receiver unknown, inactive, or `mark-served` not covering the order |

Reused: `ITEM_WRONG_STAGE` (stages add `'handed_over'`, `'out_of_engine'` as 02b), `ORDER_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`, `STATION_NOT_FOUND`, `POINT_NOT_FOUND`, `DEVICE_NOT_FOUND`, `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `IDEMPOTENCY_KEY_MISMATCH`, `PERMISSION_DENIED`, `VALIDATION_FAILED`.

---

## §10. Tests (`apps/hub/test/kds/*.test.ts`, `apps/hub/test/print/*.test.ts`; client tests in `apps/client`)

Station commands
1. `StartItem` from a station session: `ItemStarted { source: 'tap' }`, `actor_id null`, KDS `device_id`; other station's line → `PERMISSION_DENIED`.
2. Unfired line → `ITEM_WRONG_STAGE { stage: 'added' }`; `single_tap` → `'cooking'`; exited order → `'out_of_engine'`; unknown id → `ORDER_NOT_FOUND`; staff with / without `run-pass`.
3. Batch: Start / Done / Undo on one line act on the whole load.
4. Late start → `ReservationsShifted`; from-stock start → `StockConsumed`.
5. `two_tap` Done before Start on a cooked line → `ITEM_WRONG_STAGE`; under 50 % → `ITEM_DONE_CONFIRM_REQUIRED`, nothing written; `confirm` → done.
6. **From-stock line at `two_tap`: Done with no Start succeeds, consumes, no 50 % check.**
7. `UndoDone` at 30 000 ms ok, 30 001 → `ITEM_UNDO_WINDOW_CLOSED`; handed-over → `'handed_over'`; inferred Done undoable only within 30 s of its `done_at`.
8. `UndoDone` under an open Ready → `ReadyToServeUndone` + alert `undone`.
9. `GiveMeMore`: pulls; `null` → `{ pulled: null }`, no event; `single_tap` inferred start; load whole.
10. Two Done taps on one line → second `ITEM_WRONG_STAGE { stage: 'done' }`.
Lanes
11. `SetLaneState` 2 → 1 of 2: `StationCapacitySet { reason: 'lane_off' }` + `LanesSet`; station-session cap check shared with `SetStationCapacity`; same value no-op; 3 of 2 → `VALIDATION_FAILED`.
12. `lane_count` from labelled, unrevoked `kds` devices; none → 1.
13. **Lane Off at night → `BusinessDayOpened` → `station_lanes` empty, screen shows all lanes on, Lane On accepted next time it is offered.** Manager `SetStationCapacity` → row deleted, "set by manager".
Pass
20. `MarkReadyToServe` dine-in → `table_team direct` on the current primary table, `window_ms` from settings, display `{ table_code, point_code, kind_label_key }` validates; second tap `{ already: true }`.
21. Takeaway → `placed_by`.
22. **Re-target: `TableMoved` → old alert `obsolete` and a new open alert with a different id on the new table; `ReadyRetargeted` names both.** Move back to the first table → a third, open alert.
23. `UndoReadyToServe` ≤ 30 s → `undone`; later → `PASS_UNDO_WINDOW_CLOSED`.
24. `Handover` without Ready → `ReadyToServe { alert_id: null }` + `Handover` + `served_card`; receiver without `mark-served` or with `own_tables` not covering the table → `PASS_RECEIVER_INVALID`; reused `handover_id` with other lines → `IDEMPOTENCY_KEY_MISMATCH`.
25. Partial hand-over keeps the Ready open; the last closes it `done`.
26. **Ready → waiter's own `MarkServed` (no Handover) → `pass_closures` closes the Ready `done` before step 1;** Ready → last point line removed / voided / order cancelled → closed `done`.
27. Served card closes when every handed line is served (tap, estimate) or gone; `handoversDue` 1 statement, bounded, ignores closed cards.
28. Station session calling `Handover` → `PERMISSION_DENIED { session_kind: 'station' }`.
29. **Point membership:** a line cooked at an alternate station on another point shows on its **home** point's Pass, is in that point's Ready, and its Ready step 2 targets the home point.
Tickets and slips
30. Golden **bytes**, 32 and 48 columns: item, child at another station, deal part, option child, kitchen note, order note, token with earlier date, parking, RETURN with old item and table, FIRST; no prices, no COMP, no zone-served line; `—` `×` `−` mapped.
31. One `FireDispatched` with two orders → two tickets; `printer` mode → two `kitchen` jobs in the same transaction; `screen` → none.
32. Partial removal of a printed line prints "- 1 x Naan  3 left" (02b run 4 M-5); whole removal → whole-line CANCELLED; unprinted → no slip, the ticket renders without the units.
33. Void of a printed, not-done line → CANCELLED; done line → nothing.
34. Boost on a printed ticket at a `printer` station → FIRST; at `both` / `screen` → none.
35. Done before send → empty render → cancelled.
36. **Hub with 500 historical fires / removals / boosts and no `kitchen_tickets` checkpoint → boot → tickets folded, 0 `print_jobs`; same after a USB restore.**
37. **Total fold: a corrupt `station_outputs` row or a fire with an id missing from `order_lines` → the `FireDispatched` still commits, `print.fold_skipped` logged.**
38. `ReprintTicket` from a KDS (own station only, `TicketReprinted` by device); by order from staff; REPRINT header; current table; reprint of an order no longer in the engine prints from `order_lines`.
Worker and printers
40. Fake TCP printer: job written and flushed → acked; status read after.
41. Printer down: commands still succeed; retries 2 s, 5 s, 10 s; `printer_problem` after 30 s once (dedupe), closed at the next clean ack, `obsolete` on archive.
42. Two printers: one down never delays the other; FIFO per printer.
43. Restart with `sent_at` set, `acked_at` null → resent once with REPRINT.
44. **Printer with no status answer prints each ticket once (never resent); cover-open status after a full write → printed once + `printer_problem`.**
45. Encoder bytes: init, align, bold, double, cut, drawer, PC437 + mapping.
46. Station output changed → pending station jobs go to the new printer; `document` stays.
47. **Render vs removal race: fake printer with a 2 s connect; removal committed after render → the ticket counts as printed and a CANCELLED slip is queued.** Partial write then reset → retry carries REPRINT.
48. **Test print while the head job is stuck → sent at once on its own connection.**
49. Stale slips: a `cancel` / `first` for a done line and a `coming_up` older than 10 min are cancelled `stale` when the printer returns.
Fallback
50. `screen` station, socket closed: nothing before `kds_offline_print_ms`; then Now tickets (from the engine) + COMING UP; new fires print; reconnect stops; `printed` flags.
51. **Slow printer (5 s per job) during 10 s of fallback → one `kitchen` job per ticket.** At-fire job and fallback job for the same ticket never both exist (unique index).
52. Archived station with open lines: `station_notice`; warning clears when its lines are gone; tickets still render.
53. Boot: grace starts at server listen; screens reconnecting inside it → no fallback, no duplicates.
54. **`screen` station without printer, screen dark, lines in Now → `kds_offline` to managers once; closes on reconnect.**
Config
55. `SavePrinter` validation (private IPv4, `lp` / symlink path), `CONFIG_NAME_TAKEN`, archive in use → `CONFIG_IN_USE`; admin session required (device session → `ROUTE_NOT_FOUND`).
56. `SetStationOutput` `printer` without printer → `VALIDATION_FAILED`; DB CHECK backs it.
57. `SetDeviceRole`: lane label on a non-`kds` device → `VALIDATION_FAILED`; point binding updates `devices.point_id` and the memory map.
58. `/print/test` updates `printer_runtime`; cancel → `PRINT_JOB_NOT_FOUND` / `PRINT_JOB_NOT_PENDING`; a `print_config` rebuild keeps `printer_runtime`.
59. Kinds register at boot without throwing (all four) — imported before step 4.
60. `run-pass` default grants by `default_key` (hub and cloud) after migration (B-1).
Catch-up and frames
65. `kds_station` ≤ 4 statements with 50 lines incl. `printed`; `point_view` ≤ 5; Now matches `stationView` after removals, voids, move-to-stock and an abandoned order.
66. `kds_lines` once per new id; a plan frame for a known id sends no detail.
Client
70. Station view: append bottom, Done removes, marks top, `moved` tag, placeholders filled.
71. Late colouring from `planned_done_ms`, clock corrected by `hub_time`.
72. Offline banner disables taps; a `'done'` loser after own Done shows no error.
73. Coming-up strip counts.
74. Pass readiness: Ready, HOLD hint, immediate line green.
75. Config refetch on `BranchConfigApplied` renames an item on screen.

### Acceptance

| Story AC | Test |
|---|---|
| E3-KDS AC1 | 65, 70, 74 |
| E3-KDS AC2–AC3 | 70, 71 |
| E3-KDS AC4 | 1, 5, 6, 70 |
| E3-KDS AC5 | client sound test, 56 |
| E3-KDS AC6 | 71 |
| E3-KDS edges | 5, 7, 52 |
| E3-PRT AC1 | 31, 56 |
| E3-PRT AC2 | 50, 51, 53, 54 |
| E3-PRT AC3 | 30, 40, 45 |
| E3-PRT edges | 41, 35, 43, 44 |
| E0-ORD AC4 | 38 |
| 02b To 03b | 30, 32, 47 |

---

## §11. Build order (one task per commit, TDD)

| # | Task | Files | Spec |
|---|---|---|---|
| 0a | B-1 `run-pass`: catalogue, CHECK migration, `default_key` grants (cloud + hub seed), re-seed (R29) | `packages/domain/src/permissions.ts`, `apps/cloud/src/modules/staff-roles/default-roles.ts`, hub + cloud migrations | §4.5 B-1 |
| 0b | A-1 + B-2 settings: `ready_window_ms`, `kds_offline_print_ms`, `served_estimate_ms` (endpoint, PATCH wire, snapshot `settings`) | 01a settings files, `packages/events/src/admin/staff.ts` | §4.5 A-1, B-2 |
| 0c | D-1 `printer_alert_ms` | `packages/domain/src/alert-constants.ts` | §4.5 D-1 |
| 0d | Version bumps with markers: Foundation v1.12 (F-1, F-2), 00 v1.9 (H-1, H-2 + `ConnectedSession.stationId` code), 01a v2.4, 01b v1.8, 01d v1.2.2, 03a v1.2.1 (T-1); README rows; S-1 | `docs/specs/*`, `apps/hub/src/ws/server.ts`, `docs/stories/stories-refined.md` | §4.5 |
| 1 | Error codes | `packages/domain/src/errors.ts` | §9 |
| 2 | `kds.ts`: `UNDO_DONE_MS`, `LineDetail`, `Doc`, `Identifier` | `packages/domain/src/kds.ts` | §4.4 |
| 3 | Event schemas (9) + WS frames (`kds_lines`, `point_lines`, `station_notice`) | `packages/events/src/events/{order,station,hub}/`, `packages/events/src/ws.ts` | §6.25 |
| 4 | Migration | `apps/hub/src/db/migrations/NNNN_kds_print.sql` | §5 |
| 5 | Projection `print_config` (incl. lane resets) | `apps/hub/src/print/config-projection.ts` | §3.7, §3.11 |
| 6 | Projection `device_roles` + memory point map | `apps/hub/src/kds/device-roles.ts` | §3.7 |
| 7 | `SavePrinter`, `SetStationOutput`, `SetDeviceRole` (admin) | `apps/hub/src/print/commands/` | §6.10–6.12 |
| 8 | `StartItem`, `DoneItem` | `apps/hub/src/kds/commands/` | §3.2 |
| 9 | `UndoDone`, `GiveMeMore` | same | §3.2 |
| 10 | Shared capacity-check helper (extract from `set-station-capacity.ts`, no behaviour change) + `SetLaneState` | `apps/hub/src/commands/`, `apps/hub/src/kds/commands/` | §3.11, T-1 |
| 11 | Projection `kitchen_tickets`: tickets, lines, **live-only** at-fire jobs, total fold, catch-up test (36, 37) | `apps/hub/src/print/tickets-projection.ts` | §3.6 |
| 12 | Slip rules (cancel, first) | same | §3.6, §3.9 |
| 13 | `ReprintTicket` + `TicketReprinted` | `apps/hub/src/print/commands/` | §3.9 |
| 14 | Doc model, character mapping, `renderText`, ticket / slip / coming-up builders | `apps/hub/src/print/render/` | §3.6, §3.10 |
| 15 | ESC/POS encoder | `apps/hub/src/print/escpos.ts` | §3.10 |
| 16 | Transports LAN / USB + fake printer | `apps/hub/src/print/transport/` | §3.14 |
| 17 | Print worker: FIFO, synchronous render + `sent_at`, ack rule, retry, stale / empty cancel, `printer_runtime` | `apps/hub/src/print/worker.ts` | §3.14 |
| 18 | Boot step 5 resume; worker start after listen | `apps/hub/src/print/boot.ts` | §3.14 |
| 19 | Paper fallback + `kds_offline` raise / close | `apps/hub/src/print/fallback.ts` | §3.8 |
| 20 | Kinds `printer_problem`, `kds_offline` (module top level) + raise / close | `apps/hub/src/print/kinds.ts` | §6.24 |
| 21 | `printDocument` | `apps/hub/src/print/api.ts` | §3.15 |
| 22 | `/print/test` (FIFO bypass), job cancel | `apps/hub/src/print/routes.ts` | §6.13–6.14 |
| 23 | Queries print-config (warnings, presence), print-queue, order-tickets | `apps/hub/src/queries/` | §6.15, §6.17, §6.17a |
| 24 | Projection `pass` | `apps/hub/src/kds/pass-projection.ts` | §5 |
| 25 | Kinds `ready_to_serve`, `served_card` (module top level) | `apps/hub/src/kds/kinds.ts` | §6.24 |
| 26 | `MarkReadyToServe`, `UndoReadyToServe` | `apps/hub/src/kds/commands/` | §3.5 |
| 27 | `Handover` (receiver scope) | same | §3.5 |
| 28 | Ticks `ready_retarget`, `pass_closures` | `apps/hub/src/kds/ticks.ts` | §6.22–6.23 |
| 29 | `handoversDue` | `apps/hub/src/kds/exports.ts` | §4.2 |
| 30 | `pass-receivers` query | `apps/hub/src/queries/` | §6.16 |
| 31 | Catch-up `kds_station`, frame `kds_lines` | `apps/hub/src/ws/kds-catch-up.ts` | §6.18, §6.20 |
| 32 | Catch-up `point_view`, frame `point_lines` | same | §6.19–6.20 |
| 33 | Event audiences | `apps/hub/src/ws/kds-audiences.ts` | §6.21 |
| 34 | Config hook (archived station) + `station_notice` | `apps/hub/src/kds/config-hook.ts` | §3.13 |
| 35 | Retention | `apps/hub/src/print/retention.ts` | §7 |
| 0e | **To 02b:** tick `served_estimate` over `handoversDue` (needs 0b, 29, `module-02b` merged) | 02b's `apps/hub/src/orders/` tick file | §4.3 |
| 36–44 | KDS client: shell + session, station view, line row + timers, marks / moved / placeholders, Start / Done / Undo / Give me more, sounds, banners + config refetch, coming-up strip, lane screen | `apps/client/src/features/kds/` | §3.3, §8 |
| 45–49 | Pass screen: cards, readiness, Ready / Undo, hand-over tiles, screenless Start / Done + lanes | `apps/client/src/features/pass/` | §3.4, §8 |
| 50–52 | Hub admin Printers page: printers + test, outputs + roles + presence, queue | `apps/client/src/features/admin/printers/` | §8 |
| 53 | Manual pilot checks: real printers (USB and LAN), status, cut, PC437, udev symlink, fallback by pulling a KDS cable, restart mid-print | `docs/plans/03b-manual-checks.md` | §3.8, §3.14 |
| (0f) | Reprint on 02b's screens — only if OQ-4 approves it | `apps/client/src/features/ordering/` | §4.3 |

≈ 59 tasks (53 + 0a–0e + 0f if approved): at the ~60 line. **Split decision for the plan:** if 0f is approved or run 2 adds scope, split **03c Pass** (tasks 24–33 hub, 45–49 client) from **03b KDS + Printing**.

---

## §12. Definition of Done, checklist, questions, deferred, reviews

### 12.1 Definition of Done

Gate green (`TMPDIR=/dev/shm … typecheck, lint, test`); every §10 test passes; statement counts asserted (65, 27); §12.2 ticked; §4.5 bumps approved and applied; manual checks (task 53) on the pilot printers; README 03b row → Implemented.

### 12.2 Endpoint checklist

| # | Endpoint / unit | Session · permission | Statements | Test |
|---|---|---|---|---|
| 1 | `StartItem` | station / `run-pass` | 0 | 1–4 |
| 2 | `DoneItem` | station / `run-pass` | 0 | 5, 6, 10 |
| 3 | `UndoDone` | station / `run-pass` | 2 | 7, 8 |
| 4 | `GiveMeMore` | station / `run-pass` | 0 | 9 |
| 5 | `SetLaneState` | station / `run-pass` | 2 | 11–13 |
| 6 | `MarkReadyToServe` | `run-pass` | 4 | 20, 21 |
| 7 | `UndoReadyToServe` | `run-pass` | 2 | 23 |
| 8 | `Handover` | `run-pass` | 5 | 24, 25, 28 |
| 9 | `ReprintTicket` | station / `reprint-ticket` | 2 | 38 |
| 10 | `SavePrinter` | admin · `manage-devices` | 2 | 55 |
| 11 | `SetStationOutput` | admin · `manage-devices` | 1 | 56 |
| 12 | `SetDeviceRole` | admin · `manage-devices` | 1 | 57 |
| 13 | `POST /print/test` | admin · `manage-devices` | 2 | 48, 58 |
| 14 | `POST /print/jobs/:id/cancel` | admin · `manage-devices` | 1 | 58 |
| 15 | `GET /queries/print-config` | admin · `manage-devices` | 4 | 55 |
| 16 | `GET /queries/pass-receivers` | `run-pass` | 2 | 24 |
| 17 | `GET /queries/print-queue` | admin · `manage-devices` | 2 | 42 |
| 18 | `GET /queries/order-tickets` | `reprint-ticket` | 1 | 38 |
| 19 | `kds_station` + `kds_lines` | station | 4 / 2 | 65, 66 |
| 20 | `point_view` + `point_lines` | point staff | 5 / 2 | 65 |
| 21 | Tick `ready_retarget` | — | 2 + 2 | 22 |
| 22 | Tick `pass_closures` | — | 2 + 2 | 26, 27 |
| 23 | Kinds ×4 | — | — | 59 |
| 24 | Projections ×4 | — | ≤ 3 reads / event | 31–37 |

### 12.3 Open questions

| # | Question | Owner of the answer |
|---|---|---|
| OQ-1 | ~~Printer model~~ **Answered (owner, 2026-11-11):** generic thermal, USB and LAN; status and code page learned per printer. | closed |
| OQ-2 | ~~Where upstream rows are built~~ **Answered (owner, 2026-11-11, "bana do"):** tasks 0a–0e of 03b's plan. | closed |
| OQ-3 | ~~Done confirm at `auto_done`~~ **Closed (v0.2):** the 50 % check applies to taps at every mode, and only when the line has a Start (§3.2). | closed |
| OQ-4 | Reprint on the order-taker / cashier screens is 02b client code. Add it as cross-module task 0f (like OQ-2), or leave it a 02b follow-up (pilot staff then reprint from the KDS only)? **Rec: 0f** — Q13 promised it and it is one button + one query. | Owner |

### 12.4 Deferred until needed

Lane claims (K7, 01e); Urdu-script raster printing; configurable kitchen ticket template; training-mode printing (E13); audio callouts (P3); per-zone walk times (K10); detecting a KDS whose socket is alive but whose display is dead; printing from the cloud (never).

### 12.5 Hostile self-review (v0.1, kept)

v0.1's table is superseded by §12.6; the v0.1 answers that run 1 found wrong are rows M-2 (rebuild safety), M-3 (no-block claim), M-4 (fallback flapping) and M-6 (dead-printer handling).

### 12.6 G4 run 1 closure (`03b_v0.1_hostile_run1.md`, verdict FIX)

| Finding | Resolution |
|---|---|
| M-1 kind throws at boot; bad subject | Fixed: `printer_problem` `expires_at_day_close: true`, subject `hub` / `branch_id`, dedupe `printer_problem:<id>`; stays `action` with reason (D8); test 59 registers all kinds. |
| M-2 catch-up replays print history | Fixed: jobs only in `live` mode (D1, §3.6); test 36 rewritten (historical log, restore). |
| M-3 fold throw blocks fires | Fixed: total fold, `print.fold_skipped` (§3.6); T19 exception recorded with its safety argument; test 37. |
| M-4 fallback duplicate flood | Fixed: "has a kitchen job" test, deterministic `ticket_id:kitchen`, unique index, `INSERT OR IGNORE` (§3.1, §3.8, §5); test 51. |
| M-5 render vs `sent_at` gap | Fixed: render and `sent_at` in one synchronous step (§3.14); test 47. |
| M-6 endless resend / FIFO-stuck test print | Fixed: ack = flushed write, status advisory → alert only (D4); `test` bypasses FIFO; tests 44, 48. |
| M-7 re-target loses the alert | Fixed: table-scoped dedupe key (D6, §3.5); test 22 asserts a new open alert. |
| M-8 SQL "open" lines diverge from engine | Fixed: Now, fallback, archived warning read the engine (D7); `ticket_lines_open` dropped; test 65. |
| M-9 Ready never closes without Handover | Fixed: tick `pass_closures` (§3.5, §6.23); test 26. |
| M-10 lanes desync, second writer, permission widening | Fixed: day-open / manager resets, shared check helper, 03a row T-1 (§3.11, §4.5); test 13. |
| M-11 `served_estimate_ms` not writable | Fixed: A-1 range + B-2 wire; task 0b; null = no estimate. |
| M-12 from-stock Done refused | Fixed: §3.2 DoneItem step 3–4; test 6. |
| M-13 silent loss on screen-only, no printer | Fixed: kind `kds_offline` + admin warning text; detection latency stated (§3.8). |
| M-14 point from station, not engine | Fixed: point = `EngineLine.point_id` (§3.1, D7); test 29. |
| m-1 `DEVICE_TYPE_NOT_ALLOWED` never produced | Fixed: `PERMISSION_DENIED { session_kind: 'station' }` (§3.12); test 28. |
| m-2 `UNDO_DONE_MS` missing; window source | Fixed: constant in `kds.ts` (task 2); window from `line.done_at`; inferred Done rule stated. |
| m-3 admin commands on device route | Fixed: `sessionKind: 'admin'` for §6.10–6.12 and admin routes / queries. |
| m-4 display schema | Fixed: `{ table_code, point_code, kind_label_key }`, identifier in `details`. |
| m-5 error names / statuses | Fixed: §9 (`PASS_RECEIVER_INVALID` 422, `ITEM_DONE_CONFIRM_REQUIRED` 422, `ITEM_UNDO_WINDOW_CLOSED`, `PASS_UNDO_WINDOW_CLOSED`, `PRINT_JOB_NOT_PENDING`, `STATION_NO_PRINTER` → `VALIDATION_FAILED`, reused `handover_id` → `IDEMPOTENCY_KEY_MISMATCH`). |
| m-6 exited order error | Fixed: `ITEM_WRONG_STAGE { stage: 'out_of_engine' }` as 02b. |
| m-7 `return_of` shape, old item / table | Fixed: `LineDetail.return_of` and ticket line "was T7 Chicken Karahi". |
| m-8 PC437 loses `—` `−` `×` | Fixed: mapping (§3.10), byte golden tests, lossy-name warning. |
| m-9 `usblp` renumbering | Fixed: udev symlink path + install notes (§3.7); manual check. |
| m-10 `ConnectedSession` lacks `stationId` | Fixed: 00 row H-2 (task 0d). |
| m-11 point per socket | Fixed: memory map `device_id → point_id` from `device_roles` (§5, §6.21). |
| m-12 `printed` not counted | Fixed: joined in statement 1 of `kds_station`. |
| m-13 `handoversDue` scans the day | Fixed: partial index on open cards, `LIMIT 200`. |
| m-14 stale slips | Fixed: stale / empty rules (§3.9); test 49. |
| m-15 `supports_status` wiped by rebuild | Fixed: `printer_runtime` table outside the projection. |
| m-16 problem alert never closes | Fixed: `obsolete` on archive / nothing pending (§3.14). |
| m-17 target version bumps | Fixed: §4.5 lists target versions; task 0d bumps them. |
| m-18 task list gaps | Fixed: `default-roles.ts` in 0a, WS frame task 3, `UNDO_DONE_MS` task 2, admin path, kinds at module top level; 0e moved last; task 53 (02b client) → OQ-4 / 0f. |
| m-19 Cook "no permissions" override | Fixed: stated in B-1. |
| m-20 config refetch | Fixed: §3.3, §8; test 75. |
| m-21 receiver scope | Fixed: scope check (§3.5 step 2). |
| m-22 tick `intents` re-reads | Fixed: §6.22–6.23 with counts. |
| m-23 "no loop" claim | Fixed: "≤ 3 reads + multi-row inserts". |
| n-1 CLAUDE.md names v1.9 | Owner's file; flagged in the reply. |
| n-2 `checkAlertIds` misapplied | Fixed: sentence dropped. |
| n-3 unused constant; escalation flag | Fixed: constant dropped from D-1; step 2 `escalation: true`. |
| n-4 retarget restarts steps | Accepted, stated (§3.5). |
| n-5 grace start | Fixed: at server listen (§3.8). |
| n-6 partial-write REPRINT | Fixed: `is_reprint = 1` when any byte was written (§3.14). |
| n-7 Undo on a load | Fixed: undoes the load (§3.2). |
| n-8 reprint of exited order | Fixed: falls back to `order_lines` / config (§3.10); test 38. |
| n-9 frame order | Fixed: stated (§6.20). |
| n-10 rename `Handover` | **Rejected:** 02b §3.7, 03a To 03b #1 and 01d K5 name the event `Handover`; renaming would need text changes in three approved specs. The error code avoids the clash (`PASS_RECEIVER_INVALID`). |
| n-11 `order_items` typo | Fixed. |
| n-12 `units_at_fire` unused | Fixed: dropped. |
| n-13 `handedOverLines`, `kickDrawer` YAGNI | Fixed: both dropped; drawer = a `Doc` block. |
| n-14 takeaway target | Accepted as is, stated (§3.5 step 4). |
| n-15 silent supersessions | Fixed: D8 and P15 note them. |
| Review "pilot" note: presence on hub admin | Added (§3.7, §6.15). |
