# 03b KDS + Printing — Module Spec

| | |
|---|---|
| Doc | Module spec, **v0.1 — DRAFT (developer, 2026-11-11)**. Not reviewed. Next: hostile review in a fresh session → `docs/reviews/03b_v0.1_hostile_run1.md` (pipeline step 4). |
| Depends on | Foundation **v1.11**, 00 Hub Platform & Access **v1.8**, 01a Restaurant Setup **v2.3**, 01b Staff & Roles **v1.7**, 01c Menu Variants **v1.1.2**, 01d Notifications & Requests **v1.2.1**, 02a Tables **v1.1.4**, 02b Ordering **v1.0.2**, 03a Timing Engine **v1.2**. 02b's hub build runs on `module-02b`; 03b builds after it merges (README build order). |
| Inherits | Shared Standards from Foundation v1.11 §6. Not redefined here. |
| Inputs | `docs/stories/03b-g0.md` (ownership §1, carried rows §2, gaps §3, pilot cut §4, config §5, owner questions §6, developer decisions §7); `docs/stories/03b-g1-decisions.md` (owner answers Q1–Q13, G1-1–G1-18); 03a v1.2 §4.3 To 03b #1–#8; 02b v1.0.2 §4.3 To 03b, O14, O16; 02a v1.1.4 §4.3 To 03b, D-2; 01d v1.2.1 D-2, N-2, A12, A14; `01d-g0-decisions.md` K1–K13. |
| Rigor | T2 (CLAUDE.md). |

### Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-11 | First draft from G0 + G1 (owner accepted every G0 recommendation, 2026-11-11). Adds `DONE_CONFIRM_REQUIRED` and `PRINT_JOB_NOT_FOUND` to G1-18's error list (§9). |
| v0.1 (owner answers) | 2026-11-11 | Owner answered OQ-1 (generic thermal ESC/POS printers, USB **and** LAN; no model named) and OQ-2 ("bana do": the upstream rows and 02b's `served_estimate` registration are **approved cross-module tasks inside 03b's plan**, owner ruling for 03b only, overriding the README build-order note "a domain sprint does not edit another module's files" for exactly these rows). §4.3 To 02b, §4.5 F-2, §11 task 0 → 0a–0e, §12.3 updated. Not a version bump: the draft has not been reviewed. |

---

## §1. Header

### 1.1 Stories covered

- **E3 "Kitchen Display Screen"** (P1): AC1 (station view; all stations = the assembler view per point, G0 §3 #2), AC2–AC3 restated by 03a's chef-screen contract (G0 §3 #1), AC4 (Start / Done one tap, inline confirm only), AC5 (sound), AC6 (late colouring; the slip warning itself is 03a's), edge cases (two-tap, undo, archived station).
- **E3 "Ticket printing"** (P1): AC1 (per-station output), AC2 (screen offline → paper), AC3 (58 / 80 mm, LAN / USB), edge cases (printer down never blocks, Done cancels an unsent print, reprint after restart).
- E0 Orders AC4 (reprint); E0 Hardware printers rows; E5 power AC (print queue survives restart, D24); E0 Templates AC2 kitchen ticket — **fixed layout** in the pilot (G1-14).
- README carried rows :170, :190, :199, :200, :211, :237, :240 #1–#8; 02b §4.3 To 03b; 01a §4.4 :398, :405, :406, :433; 01d D-2, N-2, G1-12b, G1-21.4; OPEN-QUESTIONS 00 Q10.

### 1.2 In scope

Station commands (`StartItem`, `DoneItem`, `UndoDone`, `GiveMeMore`); the station view on the KDS (wall screen, station session) and the assembler view on the Pass tablet (staff session, `run-pass`); Ready to serve, Undo ready, Handover, the Served card; lanes (Off / On, labels); kitchen tickets, slips (CANCELLED, FIRST, REPRINT, COMING UP), manual reprint; the hub print queue, ESC/POS renderer, LAN and USB transports, paper fallback, printer-problem alert; printer and station-output configuration on the hub admin; device roles (point binding, lane label); the print API for 05; the archived-station warning; "Day not started" on the KDS.

### 1.3 Out of scope

The engine and everything it decides (03a); `MarkServed`, the `served_estimate` tick, release / boost / return commands (02b); bill, receipt and Z report **content** and their template (05, R12); headless point devices, button stations, pager (01e); lane **claims** (01e, Q11); Urdu-script printing (Q10, §12.4); configurable kitchen ticket template (§12.4); training mode (E13); audio callouts (P3); per-zone walk times (K10); customer QR (D20).

### 1.4 Decisions log (owner + developer, 2026-11-11)

| # | Decision | Source |
|---|---|---|
| P1 | One kitchen ticket per **order per station per fire**. | Q1 B |
| P2 | Tickets print at **fire**, never at submit. | Q2 A |
| P3 | Station output `screen` (default; paper only on fallback), `printer`, `both`; configured on the **hub admin**, never in the cloud. | Q3 |
| P4 | Paper fallback after `kds_offline_print_ms` with no screen of the station connected: Now as tickets + one COMING UP list; every new fire prints until a screen is back. | Q4 A |
| P5 | KDS taps disabled while the hub is unreachable; no command queue on the KDS or the Pass tablet for 03b commands. | Q5 A |
| P6 | Line display: identifier big, item × units, options, notes, mark reason; Now "cooking m:ss" / red "late +N"; Next "in m:ss"; no clock or promise times. | Q6 A |
| P7 | Chime on entering Now; strong sound for RETURN / boost / expedite; no late sound; volume from the hub admin only. | Q7 A |
| P8 | One permission **`run-pass`** (kitchen group, scope `branch`; defaults Owner, Manager, Cook). | Q8 A, G1-6 |
| P9 | Extra slips: CANCELLED on removal (02b O16) and on void of a printed, not-done line; FIRST on boost / expedite of a printed, not-done line **at a `printer` station only**; no slip for Done. | Q9 |
| P10 | Paper is Latin text, code page PC437. | Q10 A, G1-15 |
| P11 | Lanes: Off / On only. | Q11 A |
| P12 | "Coming up" count strip on the station view; lines never merged. | Q12 A |
| P13 | A KDS reprints its own station's tickets without PIN; staff screens with `reprint-ticket`. | Q13 A |
| D1 | Tickets are a **forward-only** projection writing jobs in the event's transaction. | G1-1 |
| D2 | Jobs store references; bytes are rendered at send. | G1-2 |
| D3 | Fallback and sending run in an async **print worker**, outside every writer transaction; never a 01d tick. | G1-3, G1-4 |
| D4 | Ack = flushed write + clean DLE EOT status (or flushed write when the printer has no status). No ESC/POS library. | G1-5 |
| D5 | Ready / Undo / Handover per **order per point**, on the order stream. | G1-9 |
| D6 | Re-target of open Ready alerts on party changes by 03b's tick, without 02a code. | G1-11 |
| D7 | `served_estimate` registration stays 02b's (To 02b row). | G1-13 |

---

## §2. Existing architecture that must not change

- 00: `POST /commands/:name` (`defineCommand`, `stationScoped`, D32 idempotency, `BEGIN IMMEDIATE` single writer, commit-then-swap D45), `registerProjection` (`reset?` absent = forward-only, M40), `registerCatchUp`, `registerEventAudience`, `WsHub` (`connectedSessions()`, `sendToSessions`, `sendToStaff`), station sessions (M30: `actor_id = null`, KDS `device_id`, `STATION_LOGOUT_NOT_ALLOWED`), `StaffDirectory.resolve`, `clock`, `ids`, `devices.point_id` / `devices.lane_label` (H-5, H-6, migration `0008`).
- Foundation §4.2 stages and stage guard; §5.8 boot (step 5 resumes the print queue); D24 (duplicate ticket on restart acceptable, missing not); R8 (printers never block service).
- 01a: `branchConfig()` (stations with `completion_mode`, `point_id`; `points`), `BusinessDayOpened` / `BusinessDayClosed`, `onBranchConfigApplied`, `hub_time`.
- 01b: `resolve(staff, permission)`, `PERMISSION_CATALOGUE` (group `kitchen`: `move-item-to-stock`, `mark-item-returned`, `reprint-ticket`), `default_key` grants.
- 01d: `defineAlertKind`, `alerts.raise` / `raiseMany` / `close` / `closeMany` / `byDedupeKey` / `tickCtx`, `registerTick`, `ALERT_CONSTANTS`, target kinds (`person`, `table_team`, `point`, `managers`), close reasons incl. `undone`, `obsolete`.
- 02a: `currentTableOf(db, order_ids[])` (1 statement), `tableOwners`, the `table_team` resolver.
- 02b: projection `orders` (tables `orders`, `order_lines`), `orderLines(db, order_ids[])`, events `ItemRemoved { units? }`, `OrderBoosted`, `ItemsReleased`, `ItemServed`; `ORDER_NOT_FOUND`.
- 03a: `@pos/engine` `stationView`, `stationPlan`, `groupReadiness(state, order_id, now)`, `pullEarly(state, station_id, n, now)`, `lateStartShift`, `capacityForLanes`, `stockEffects`, `liveInterval`; `station_plan` catch-up part and frame; events `FireDispatched`, `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ReservationsShifted`, `StationCapacitySet`, `StockConsumed`; `SetStationCapacity` as built; the `fires` tick (inferred Start / Done for `single_tap` / `auto_done`); `UNDO_DONE_MS` = 30 000 (D16).

---

## §3. Domain rules

### 3.1 Words and identity

- **Line** = an engine line (03a §3.3: `ItemAdded` with a station, not a `deal` line, not zone-served). Zone-served lines and lines with no station never reach 03b.
- **Ticket** = the lines of **one order** fired at **one station** by **one** `FireDispatched` (P1). `ticket_id = fire_event_id + ':' + order_id` (deterministic, so the forward-only projection never needs a generator).
- **Job** = one row of `print_jobs`; **kind** ∈ `kitchen` (a ticket), `reprint` (a ticket again), `cancel` (CANCELLED slip), `first` (FIRST slip), `coming_up` (fallback list), `document` (05), `test`.
- **Printed** (a ticket) = it has a non-cancelled `kitchen` or `reprint` job with `sent_at` set.
- **Point** = 01a point; a station belongs to one point (01a A-2). The **Pass tablet** = a `tablet` device with `devices.point_id` set.
- **Identifier** (what the cook reads first): dine-in → `T` + the **current** table label from `currentTableOf` ("T4 + T5" when joined); takeaway → `#` + token, with the business date when it is from an earlier date ("#12 · 10 Nov"); parking → "PARKING LEB 1234 · SEDAN".

### 3.2 Station commands (`StartItem`, `DoneItem`, `UndoDone`, `GiveMeMore`)

Caller: a **station session** for a line of its own station, or a **staff session** holding `run-pass` (P8). Station data comes from the in-memory engine state (no SQL), as 03a's `SetStationCapacity`.

**`StartItem { order_item_id }`**
1. Line = `state.lines[order_item_id]`; absent, or its order not in the engine → `404 ORDER_NOT_FOUND { order_item_id }`.
2. Station session and `line.station_id ≠ session.station_id` → `403 PERMISSION_DENIED`.
3. Stage guard (03a AD-10): the line must be `added` **and fired** (`fired_at` set) → else `409 ITEM_WRONG_STAGE { order_item_id, stage }` (an unfired line reports `stage: 'added'`; to start early the cook uses Give me more). At a `single_tap` station the fire already wrote the inferred start → `ITEM_WRONG_STAGE { stage: 'cooking' }`.
4. Batch station: the targets are every fired, `added` line with the same `load_id` (AD-18: Start names the load); else the one line.
5. Drafts: `ItemStarted { order_item_id, started_at: now, source: 'tap' }` per target; `lateStartShift(state, id, now)` per target → `ReservationsShifted` when not null; `stockEffects(state, drafts)` (array form, from-stock → `StockConsumed`, 03a P-5).
6. Append. Result `{ started: order_item_id[] }`.

**`DoneItem { order_item_id, confirm?: boolean }`**
1–2. As `StartItem`.
3. Stage: `cooking` → ok; `added` and fired at a `two_tap` station → `409 ITEM_WRONG_STAGE { stage: 'added' }` (client: "Tap Start first", inline); `done` / `served` / removed / voided → `ITEM_WRONG_STAGE`.
4. Sanity (03a #3): `now − started_at < 0.5 × cook_ms` (the line's planned cook time, with a `fix` return's override) and `confirm ≠ true` → `409 DONE_CONFIRM_REQUIRED { order_item_id, elapsed_ms, cook_ms }`, nothing written. The client shows the inline second tap ("Tap again — only 2 min"), never a modal (G0 §3 #14).
5. Batch station: every `cooking` line of the load. Drafts `ItemDone { order_item_id, done_at: now, source: 'tap' }` + `stockEffects` (AD-29 Q7: a from-stock line with no Start consumes here).
6. Append. Result `{ done: order_item_id[] }`.

**`UndoDone { order_item_id }`**
1–2. As `StartItem`.
3. Stage must be `done`, with its `ItemDone` `recorded_at ≥ now − UNDO_DONE_MS` → else `409 UNDO_WINDOW_CLOSED { order_item_id }`; a line already in a Handover → `409 ITEM_WRONG_STAGE { stage: 'handed_over' }`.
4. Drafts `ItemDoneUndone { order_item_id }`. If the line's order has an **open Ready** at the line's point (`pass_orders.ready_alert_id` not null): add `ReadyToServeUndone { order_id, point_id, alert_id }` and `alerts.close(ctx, ready_alert_id, 'undone')` (01d G1-21.4) — the food went back, nobody should walk to the pass.
5. Append. Result `{ undone: true, ready_undone: boolean }`.

**`GiveMeMore { station_id, n?: 1–10 (default 1) }`**
1. Station session: `station_id` must be its own. Station unknown or archived → `404 STATION_NOT_FOUND`.
2. `pullEarly(state, station_id, n, now)` (same `max_early_ms` limit). `null` → `200 { pulled: null }`, nothing written (AD-24: a line that would overrun another booking is passed over; not an error).
3. Draft = the returned `FireDispatched { reason: 'pulled' }` (a load is fired whole, AD-18); at a `single_tap` station also `ItemStarted { source: 'inferred' }` per line (03a #7).
4. Append. Result `{ pulled: order_item_id[] }`.

All four: not queueable (P5); the station session's events carry `actor_id = null` and the KDS `device_id` (README :170); staff calls carry the person.

### 3.3 Station view (KDS wall screen)

- **Now** = fired lines of the station not `done` (plus `done` lines inside `UNDO_DONE_MS`, kept by the client); **Next** = `station_plan` lines with `frozen: true`; **Later: N** = `station_plan` lines with `frozen: false` (counted, never shown). 03a's contract holds: new lines append at the bottom, Done removes its line, nothing visible reorders; `mark` lines (`expedite`, `boost`, `pulled`) and `return` lines show at the **top** in red with their reason; a Next line with `mark: 'moved'` keeps its row with a red "moved" tag and its new time (03a #2, #6).
- **Line details** come from 03b (G1-16): catch-up part `kds_station` (§6.18) and frame `kds_lines` (§6.20) — `LineDetail` (§4.4). A line id the screen has no detail for yet shows a placeholder row in its place and fills in when `kds_lines` arrives (never reorders).
- **Time on a line (P6):** Now, started → "cooking m:ss" since `started_at`; Now, not started → "waiting m:ss" since `fired_at`; **late** (red, "late +N min") when `now > planned_done_ms`, where `planned_done_ms = started_at + cook_ms` once started, else `fired_at + prep_ms + cook_ms`. Next → "in m:ss" to `fire_ms`. The KDS clock is corrected by `hub_time` (01a). No clock time and no promise time on the KDS.
- **Coming-up strip (P12):** counts of live units by item name over Now (not done) + Next, largest first, max 6 names ("Naan 14 · Roghni 6 · Kulcha 3"); computed by the client from the details it holds.
- **Completion modes** (01a `completion_mode`): `two_tap` Start then Done; `single_tap` only Done (the fire wrote the start); `auto_done` the line leaves at its inferred Done unless tapped earlier.
- **Printed tag:** a Now line whose ticket is printed shows a small "printed" tag (`LineDetail.printed`), so after a fallback the cook knows paper is out for it.
- **Day not started (00 Q10, G1-17):** before `BusinessDayOpened` (01a `openDayStartMs` null) the KDS shows "Day not started"; no button.
- **Archived station (README :199):** the KDS of an archived station keeps rendering its open lines (S22) under a banner "Station archived — finish open tickets" (§3.13).

### 3.4 Assembler view (Pass tablet)

- Shows every **open order with a line on a station of this point** (`stations.point_id`), one card per order, oldest first, identifier big; per line: station short name, item × units, stage (waiting / cooking / done / handed over). Served, removed and voided lines drop off; the card drops off when none is left.
- **Readiness per point (G0 §3 #18):** `groupReadiness(state, order_id, now)` filtered to the point's stations: **"Ready"** (green) when no sync line of the order on this point is `added` or `cooking`; **HOLD AT PASS** hint (amber) when a done line waits for a sibling — a hint, never a block (K4). Immediate (`serve_mode ≠ 'sync'`) lines show their own green when done.
- Buttons per card: **Ready to serve** (§3.5), **Hand over** (receiver tiles, §3.5), **Undo** (30 s), and per screenless station's line **Start / Done** (§3.2, `run-pass`).
- **Lanes:** the Pass tablet shows each station of the point with lanes and its Lane Off / On toggles (§3.11).
- Data: catch-up part `point_view` (§6.19), frame `point_lines` (§6.20), line event frames (§6.21).

### 3.5 Ready to serve, Handover, Served card

**`MarkReadyToServe { order_id, point_id }`** (`run-pass`)
1. Point exists, not archived → else `404 POINT_NOT_FOUND`. Order in the engine (`isOrderInEngine`) → else `409 ORDER_NOT_IN_ENGINE`.
2. Point lines = the order's live lines on the point's stations, not served, not handed over. None → `409 ITEM_WRONG_STAGE { stage: 'served' }`.
3. Open Ready for `(order_id, point_id)` → `200 { already: true, alert_id }`, nothing written (01d A12 also dedupes the raise).
4. Target: dine-in → `{ kind: 'table_team', table_id: <current primary table, currentTableOf>, depth: 'direct' }` (02a §4.3 To 03b); takeaway / parking → `{ kind: 'person', staff_id: orders.placed_by }`.
5. `alerts.raise(ctx, { kind: 'ready_to_serve', subject: { stream_type: 'order', stream_id: order_id }, target, values: { order_id, point_id, table_id | '' , window_ms: ready_window_ms }, display: { identifier, point_name }, dedupe_key: order_id + ':' + point_id })`.
6. Append `ReadyToServe { order_id, point_id, order_item_ids, table_id | null, alert_id }`. Result `{ alert_id }`. Ready while lines still cook is allowed (K4 hint); the card says which are still cooking.

**`UndoReadyToServe { order_id, point_id }`** (`run-pass`): open Ready whose `ReadyToServe.recorded_at ≥ now − UNDO_DONE_MS` and no Handover since → `ReadyToServeUndone { order_id, point_id, alert_id }` + `alerts.close(…, 'undone')`; else `409 UNDO_WINDOW_CLOSED`.

**`Handover { handover_id, order_id, point_id, receiver_staff_id, order_item_ids? }`** (`run-pass`)
1. As `MarkReadyToServe` step 1.
2. Receiver: an active staff member of the branch holding `mark-served` (`StaffDirectory.resolve`) → else `409 HANDOVER_RECEIVER_INVALID { receiver_staff_id }`. The tiles the client offers come from `GET /queries/pass-receivers` (§6.16); the receiver taps nothing (K5).
3. Lines = `order_item_ids` or, if absent, every **done** point line not handed over. Each must be on this point, `done`, not handed over, not served → else `409 ITEM_WRONG_STAGE { order_item_id, stage }`. Empty → `ITEM_WRONG_STAGE`.
4. No open Ready → the command also appends `ReadyToServe { …, alert_id: null }` first (no alert is raised: the food is already in a waiter's hands).
5. Raise `served_card` (§6.24) to `{ kind: 'person', staff_id: receiver_staff_id }`, dedupe `handover_id`.
6. If after this hand-over no point line of the order is left un-handed → close the open Ready alert `done`.
7. Append `Handover { handover_id, order_id, point_id, receiver_staff_id, order_item_ids, alert_id: <served card>, ready_alert_closed: alert_id | null }`. Result `{ served_card_alert_id }`.
8. `handover_id` is client-made (ULID) so a retry is caught twice: D32 for the same command, and `409 VALIDATION_FAILED` on a reused id with other lines.

**Served card closure:** tick `served_cards` (§6.23) closes a card `done` once every live line of its hand-over is served (02b `MarkServed` or the 02b estimate) or removed / voided.

**Re-target (G1-11):** tick `ready_retarget` (§6.22): for each open Ready whose stored `table_id` is not the order's current primary table → `alerts.close(…, 'obsolete')`, raise again on the current table, append `ReadyRetargeted { order_id, point_id, table_id, alert_id, previous_alert_id }`. One transaction per tick run.

**Day close:** Ready and Served-card kinds have `expires_at_day_close: true`; 01d closes leftovers.

### 3.6 Kitchen tickets (P1, P2, D1)

Projection **`kitchen_tickets`** (forward-only, no `reset`), in the event's transaction:

- **`FireDispatched { station_id, order_item_ids }`**: group the ids by `order_items.order_id` (02b `order_lines`, 1 statement). Per order: insert `tickets (ticket_id, station_id, order_id, fire_event_id, fired_at = recorded_at, reason)` and one `ticket_lines` row per id (`units_at_fire` = live units). Then read the station's output (1 statement): mode `printer` or `both` → one `print_jobs` row per ticket (`kind 'kitchen'`, `station_id`, `ticket_id`, `payload { ticket_id }`). Mode `screen` → no job (the worker prints it on fallback, §3.8).
- **`ItemStarted`** → nothing; **`ItemDone`** / **`ItemServed`** → `ticket_lines.done_at = recorded_at`; **`ItemDoneUndone`** → `done_at = NULL`.
- **`ItemRemoved { order_item_id, units? }`** and **`ItemVoided { order_item_id, units }`** on a `ticket_lines` row with `done_at IS NULL`: if its ticket is **printed** → `print_jobs` `kind 'cancel'`, `payload { ticket_id, order_item_id, units_removed, units_left }` (02b O16; P9). Not printed → nothing (render-at-send drops the units, D2).
- **`OrderBoosted { order_id }`** / **`ItemsReleased { expedite }`**: for each printed ticket of the order (boost) or holding an expedited line (expedite) with a not-done line, **at a station with mode `printer`** → `kind 'first'`, `payload { ticket_id, reason: 'boost' | 'expedite' }` (P9 b). Lines not yet fired get their mark on their own ticket at fire.
- **`TicketReprinted { ticket_ids }`** → one `kind 'reprint'` job per ticket (§3.9).
- Statements per event: ≤ 3 (lines → orders, station output, printed check), none in a loop.

**Ticket layout (fixed, G1-14; 32 columns at 58 mm, 48 at 80 mm):**

```
TANDOOR                         1:22 PM
================================
            T4 + T5                      ← identifier, double width + height
DINE-IN · Bilal · #7F3K2Q                ← type · order taker (toggle) · last 6 of order id (toggle)
** RETURN · REMAKE **                    ← return lines (engine `return_of.mode`)
** FIRST — T12 is eating **              ← mark lines (expedite / boost reason)
--------------------------------
4 x Naan
3 x Naan · for Chicken Karahi — Full     ← child at another station (README :211)
1 x Chicken Karahi (Family Deal)         ← deal part shows the deal name
    + Extra butter                       ← option children with no station, under their line
    NOTE: less spicy                     ← kitchen_note verbatim (01a :398)
--------------------------------
ORDER NOTE: birthday, bring together     ← order_note verbatim (02b E0-ORD AC2)
```

No prices, no COMP marker, no zone-served lines (02b To 03b). Units = live units at render (`units − removed − voided`). The time is the fire time, 12-hour (01d AD-167). Toggles "show order taker", "show order id" are hub-admin config (default on).

### 3.7 Station output and printers (P3)

- **Printer** (hub admin, `SavePrinter`): name 1–40 (unique among active), `connection` `lan` (address `host:port`, host an IPv4 address in 10/8, 172.16/12 or 192.168/16, port 1–65535, default 9100) or `usb` (address `/dev/usb/lp0`…`lp9`), `paper_width_mm` 58 | 80. Archive is refused while a station output uses it (`409 CONFIG_IN_USE`).
- **Station output** (`SetStationOutput`): `mode` `screen` | `printer` | `both`, `printer_id` (the station's printer: used by `printer`, `both`, **and** by `screen` for fallback), `sound_volume` 0–100. `printer` / `both` without a printer → `409 STATION_NO_PRINTER`. No row = `screen`, no printer, volume 70; the hub admin page flags every `screen` station with no printer: "No paper fallback".
- **Device roles** (`SetDeviceRole`): bind a tablet to a point (`point_id`), or give a `kds` device a `lane_label` (H-6 rules: `kds` with a `station_id` only).
- Config lives on the hub (events on the `hub` stream; projection `print_config` with `reset`), never in the cloud snapshot: printers are LAN / USB hardware of this box.

### 3.8 Paper fallback (P4, D3)

Print worker, every 1 s:

1. **Who is on screen:** `connectedSessions()` (memory) filtered to `kind: 'station'`, mapped to stations through `devices.station_id` (1 statement, cached until a `DeviceRoleSet`, pairing or revoke).
2. Per station with mode `screen` and a printer: none connected → `offline_since` (memory; at worker start = boot time, so a booting hub waits for screens to reconnect). When `now − offline_since ≥ kds_offline_print_ms` and not in fallback → **enter fallback**: one `kitchen` job per **unprinted** ticket of the station that still has a not-done line (1 statement + 1 insert batch), oldest first, then one `coming_up` job `payload { station_id, at: now }` (rendered at send from `stationPlan`: Next lines "1:30 PM  2 x Naan  T7").
3. **In fallback:** each loop, `kitchen` jobs for the station's unprinted tickets created since fallback started (1 statement).
4. A station socket connects → **leave fallback** immediately; nothing is cancelled (paper already out stays useful); the screen shows `printed` tags.
5. `printer` / `both` stations are not affected (they print at fire anyway). A station with no printer cannot fall back; the hub admin warning (§3.7) is the mitigation.

Fallback state is memory only. After a hub restart the screens reconnect within the grace (`kds_offline_print_ms`), so no duplicate prints; a station still dark then falls back as above.

### 3.9 Slips and reprint (P9, P13)

- **CANCELLED** (`cancel`): "CANCELLED — T7 · − 1 x Naan · 3 left" or, whole line, "CANCELLED — T7 · 4 x Naan".
- **FIRST** (`first`): "FIRST — T12 · 2 x Roghni (boost)".
- **REPRINT header:** every `reprint` job and every job re-sent after a restart (F §5.8 step 5) starts with a `REPRINT` line.
- **`ReprintTicket { ticket_id? , order_id? }`** (exactly one): station session → only tickets of its own station; staff → `reprint-ticket` (scope `branch`). By `order_id` = every ticket of the order (staff only; a station session gets its station's tickets of that order). Writes `TicketReprinted { order_id, station_id | null, ticket_ids }` (the audit row, logged by device or person) → projection adds the `reprint` jobs. A ticket with nothing live → skipped, listed in `result.skipped`.

### 3.10 Rendering and ESC/POS (D4, P10)

- Document model (shared by tickets, slips and 05): `Doc = { width_cols?, blocks: Array<{ text, size?: 'normal' | 'double', bold?, align?: 'left' | 'center' | 'right' } | { rule: '-' | '=' } | { feed: n } | { cut: true } | { drawer: true }> }`. Text is wrapped to 32 / 48 columns; a word longer than the line is broken.
- Encoder (no library): `ESC @` init, `ESC a n` align, `ESC E n` bold, `GS ! n` size, `GS V 66 0` feed + partial cut, `ESC p 0 25 250` drawer kick, `DLE EOT 1` / `DLE EOT 4` status (Epson ESC/POS command reference, checked 2026-11-11). Code page PC437; a character outside it prints as `?`.
- Rendering reads, at send: the ticket's lines and `order_lines` / `orders` (1 statement), `currentTableOf` (1), the engine state (memory) for `return_of`, mark and station names. A `kitchen` / `reprint` / `first` job whose ticket has no live, not-done line renders **empty → the job is cancelled** (`cancelled_at`), not sent (E3-PRT edge "Done cancels the queued print"; a reprint ignores the not-done filter and prints every live line).

### 3.11 Lanes (P11)

- `lane_count` = `kds` devices of the station with a `lane_label`, not revoked (00 H-6), else 1.
- **`SetLaneState { station_id, lanes_on }`**: a station session for its own station, or `run-pass`. `lanes_on` 1…`lane_count` → else `400 VALIDATION_FAILED`. Appends 03a's `StationCapacitySet { capacity_override: capacityForLanes(station, lanes_on, lane_count) (null when lanes_on = lane_count), previous, reason: lanes_on < current ? 'lane_off' : 'lane_on' }` and 03b's `LanesSet { station_id, lanes_on, lane_count }` (G1-7). Same `lanes_on` → no-op.
- Lane labels: `SetDeviceRole` (§3.7). Claims: §12.4.

### 3.12 Permissions and scopes

| Action | Station session (KDS) | Staff session |
|---|---|---|
| `StartItem`, `DoneItem`, `UndoDone`, `GiveMeMore` | own station | `run-pass` (`branch`) |
| `SetLaneState` | own station | `run-pass` |
| `MarkReadyToServe`, `UndoReadyToServe`, `Handover` | — (`403 DEVICE_TYPE_NOT_ALLOWED`) | `run-pass` |
| `ReprintTicket` | own station's tickets | `reprint-ticket` (`branch`) |
| `SavePrinter`, `SetStationOutput`, `SetDeviceRole`, test print, cancel job, print queue / config queries | — | `manage-devices` (`branch`) |
| `GET /queries/pass-receivers` | — | `run-pass` |
| `GET /queries/order-tickets` | — | `reprint-ticket` |

New permission **`run-pass`** (group `kitchen`, scopes `branch`; default grant by `default_key`: `owner`, `manager`, `cook` allowed; others denied, editable) — §4.5 B-1. Scope is checked last (C8).

### 3.13 Config reactions

- **Archived station:** 03b registers an `onBranchConfigApplied(prev, next)` hook: for every station archived in `next` with not-done `ticket_lines` (1 statement), after commit send `station_notice { station_id, kind: 'archived', open_lines }` to that station's sockets and to staff sockets holding `manage-devices`; the hub admin print-config query lists it too. Tickets finish normally.
- **Station output / printer change:** pending jobs of a station follow its **current** printer at send (`print_jobs.station_id`, printer resolved at send); `document` and `test` jobs keep their own `printer_id`.

### 3.14 Print worker and failure rules (R8)

- **Never blocks service:** no command waits for paper; a print failure never fails or rolls back a command; the projection only inserts rows.
- **One FIFO per printer:** the oldest pending job (`acked_at IS NULL AND cancelled_at IS NULL`) of each printer is sent; the next waits for its ack (ticket order on paper = fire order). Different printers run in parallel.
- **Send:** render (§3.10) → LAN: TCP connect (3 s timeout), write, `DLE EOT 1` + `DLE EOT 4`, read status (2 s); USB: open the device file, write, read status if the driver returns it. `sent_at` is set before the write (so a crash mid-write re-sends with REPRINT, D24).
- **Ack** (D4): flushed write and a status with no offline / paper-end / cover-open / error bit; `printers.supports_status = 0` (learned at the test print) → flushed write is the ack.
- **Failure:** `attempts + 1`, `last_error`, retry after 2 s, 5 s, then every 10 s, **no limit** — a kitchen job drains itself when its lines are done (empty render → cancelled); `document` jobs wait or are cancelled by a manager (`POST /print/jobs/:job_id/cancel`).
- **Printer problem alert:** a printer whose head job has failed for ≥ `ALERT_CONSTANTS.printer_alert_ms` (30 000) → `alerts.raise` kind `printer_problem` (dedupe `printer_id`) in one `writer.run`; closed `done` at its next ack.
- **Restart (F §5.8 step 5):** before the worker starts, jobs with `sent_at` set and `acked_at` null get `is_reprint = 1, sent_at = NULL`; the worker then drains in `created_at` order.
- **Writes outside transactions:** the worker's `print_jobs` updates and fallback inserts are plain statements on the hub connection, never inside an open writer transaction (better-sqlite3 is synchronous; a statement never interleaves with a transaction) and never events (F §3: print queue is hub state, never synced).

### 3.15 Print API for 05 (G1-14)

- `printDocument(tx, printer_id, doc, meta?: { kind_label: string })` → inserts a `document` job in the caller's transaction (so a bill close and its receipt commit together); `printer_id` unknown or archived → `404 PRINTER_NOT_FOUND`.
- `kickDrawer(tx, printer_id)` → a `document` job `{ blocks: [{ drawer: true }] }`.
- 05 owns the receipt template, its variables and preview; the preview renders `Doc` with 03b's `renderText(doc, width)` (plain text at 32 / 48 columns).

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | `defineCommand` (`stationScoped`), writer, `registerProjection` (forward-only and with `reset`), `registerCatchUp`, `registerEventAudience`, `WsHub` (`connectedSessions`, `sendToSessions`, `sendToStaff`), `StaffDirectory.resolve`, `clock`, `ids`, `devices` (H-5, H-6) | §3, §6 |
| 01a | `branchConfig()` (stations: `point_id`, `completion_mode`, names, archived; points), `openDayStartMs`, `BusinessDayOpened`, `onBranchConfigApplied`, `hub_time`; settings `ready_window_ms`, `kds_offline_print_ms` (A-1) | §3.3, §3.5, §3.8, §3.13 |
| 01b | `resolve`, permissions `run-pass` (B-1), `reprint-ticket`, `manage-devices`, `mark-served` | §3.12 |
| 01d | `defineAlertKind`, `alerts.raise` / `close` / `closeMany` / `tickCtx`, `registerTick`, `ALERT_CONSTANTS` (D-1) | §3.5, §3.14 |
| 02a | `currentTableOf` | §3.1, §3.5, §3.10 |
| 02b | `order_lines`, `orders` (read-only, in joins), `orderLines`, `ItemRemoved`, `OrderBoosted`, `ItemsReleased`, `ItemServed` | §3.6, §3.10 |
| 03a | §2 list | §3.2–§3.11 |
| 04 | `ItemVoided { order_item_id, units }` | §3.6 |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `printDocument(tx, printer_id, doc, meta?)` | `{ job_id }` | 2 (printer, insert) | 05 |
| `kickDrawer(tx, printer_id)` | `{ job_id }` | 2 | 05 |
| `renderText(doc, width_cols)` | `string` (pure) | 0 | 05 template preview |
| `handoversDue(db, now, older_than_ms)` | `Array<{ handover_id, order_id, order_item_ids }>` — hand-overs with an unserved live line handed at or before `now − older_than_ms` | 1 | 02b `served_estimate` (To 02b) |
| `handedOverLines(db, order_ids[])` | `Map<order_item_id, { handover_id, receiver_staff_id, handed_at }>` | 1 | 02b screens, 04 |
| `Doc` type, `LineDetail` type | §4.4 | — | 05, clients |
| Events, kinds, catch-up parts, frames | §6 | — | 02b, 05, 07 |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 02b | Register tick `served_estimate` (02b §3.7, §6.11, O14) with `due` = `handoversDue(db, now, served_estimate_ms)` (1 statement) and `intents` = `ItemServed { source: 'estimated' }` per order + `stockEffects` + `OrderFoodServed` when it serves a food line. **Owner ruling 2026-11-11 (OQ-2): built by 03b's plan as task 0e, an approved cross-module task in 02b's files, after `module-02b` merges into main**; 02b's spec text (§6.11 "registered with 03b's `Handover`") already allows it, so no 02b version bump. Until then no estimate runs (O14). |
| 04 | Nothing new: 03b folds `ItemVoided` itself for CANCELLED slips (P9 a). 04's void screens may show `handedOverLines` ("handed to Bilal"). |
| 05 | Print bills, receipts and the Z report with `printDocument` / `kickDrawer` in the bill-close transaction; own the receipt template (R12) and its preview over `renderText`; choose the cashier's printer (05 config) from 03b's printer list; a receipt printer outage never blocks bill close (R8). |
| 01e | Button stations: a station with no screen uses mode `printer`, or `screen` with a printer for fallback; headless point devices and lane buttons bind through 03b's `DeviceRoleSet` columns (or 01e's own pairing writes the same H-5 / H-6 columns); lane **claims** (K7) are 01e's, on button devices. |
| 07 | Print and fallback history is not in the log (hub state); 07 reads `ReadyToServe`, `Handover`, `TicketReprinted` from events for pass timings and reprint counts. |

### 4.4 Shared types (`@pos/domain/src/kds.ts`, browser-safe)

```typescript
type Identifier =
  | { kind: 'table'; label: string }                    // "T4 + T5" (currentTableOf)
  | { kind: 'token'; token: number; date: string | null } // date only when from an earlier business date
  | { kind: 'parking'; car_number: string; car_type: 'sedan' | 'mini' | 'large' };

interface LineDetail {
  order_item_id: string; order_id: string; station_id: string;
  ticket_id: string | null;                // null while unfired (Next)
  identifier: Identifier; order_type: 'dine_in' | 'takeaway' | 'parking';
  item_name: string; units: number;        // live units
  line_kind: 'item' | 'option_child' | 'deal_part';
  for_parent: string | null;               // "Chicken Karahi — Full" when the parent is on another station
  deal_name: string | null;
  options: string[];                       // option children with no station
  kitchen_note: string | null; order_note: string | null;
  return_of: { mode: 'fix' | 'remake'; from: string } | null;
  cook_ms: number; prep_ms: number;        // as the engine plans the line (03a §3.4)
  printed: boolean;
}

type Doc = { width_cols?: 32 | 48; blocks: DocBlock[] };     // §3.10
```

### 4.5 Changes to other specs (R26) — *Proposed — needs approval*, applied with 03b's approval

| Row | Target | Change | Why |
|---|---|---|---|
| F-1 | Foundation §5.8 "Print queue schema" + step 5 text | Replace the `print_jobs` DDL with 03b §5's (kind, `station_id`, `ticket_id`, `order_id`, JSON `payload`, `cancelled_at`, `attempts`, `last_error`; `printer_url` and `branch_id` dropped: the printer is resolved at send, the hub is one branch). Step 5 reads "sent and not acked → `is_reprint = 1`, `sent_at = NULL`, re-send in `created_at` order with a REPRINT line"; acked = §3.14's rule. D24 unchanged. | G1-2, G1-5 |
| F-2 | Foundation OQ14 | Answered (owner, 2026-11-11): **generic thermal ESC/POS printers, USB and LAN** both supported; the model is chosen at install. LAN raw TCP 9100 is preferred in the kitchen (foundation OQ14 preference, no cable runs to the hub); USB through Linux `usblp` (`/dev/usb/lp0`…); a printer with both ports is configured on one. No ESC/POS library. Status support and code page are **detected per printer at its test print** (§3.14, §6.13), never assumed from a model. | §3.10, §3.14 |
| B-1 | 01b `PERMISSION_CATALOGUE`, CHECK, default grants | New `run-pass` (group `kitchen`, scope `branch`); defaults by `default_key`: `owner`, `manager`, `cook` allowed; CHECK-expand migration; seeded tenants re-seeded (R29). | P8 |
| A-1 | 01a branch settings (endpoint, snapshot `settings`) | `ready_window_ms` (60 000; 15 000–300 000) and `kds_offline_print_ms` (30 000; 10 000–300 000), additive keys as 02b's settings rows. | G1-10, P4 |
| H-1 | 00 §5.1 notes on H-5 / H-6 | "Written by 03b's `DeviceRoleSet` projection (and 01e's pairing when built)"; no code change in 00. | G1-8 |
| D-1 | 01d `ALERT_CONSTANTS` (A14) | Append `ready_to_serve_attempts: 2`, `printer_alert_ms: 30_000` (A14 already invites later kinds' constants). | §3.5, §3.14 |
| S-1 | `stories-refined.md` E3 (editorial) | AC1 "all stations" → "assembler view per point"; AC2–AC3 → 03a's Now / Next / Later contract; AC5 volume on the hub admin; E0-TPL AC2 kitchen ticket fixed in the pilot. | G0 §3 #1, #2, #9, #12 |

### 4.6 Carried rows (README) and where they land

| Row | Lands in |
|---|---|
| :170 station commands `stationScoped` | §3.2, tests 1–4 |
| :190 default grants by `default_key` | B-1, test 60 |
| :199 archived-station warning | §3.13, test 52 |
| :200 ESC/POS 58 / 80, USB / LAN; receipt template | §3.10, §3.15, tests 40–45 |
| :211 child / deal / option ticket layout | §3.6, test 30 |
| :237 02a current table, Ready target, re-target | §3.5, tests 22, 26 |
| :240 #1–#8 03a | §3.2–§3.5, §3.11; tests 1–20 |
| 02b To 03b | §3.1, §3.6, §3.9, §4.3 To 02b; tests 30–35 |
| 01a :398, :405, :406, :433 | §3.6, §3.13, §8 |
| 01d D-2, N-2, G1-12b, G1-21.4 | §3.5, §3.12, §6.24–6.26 |
| OPEN-QUESTIONS 00 Q10 | §3.3 |

---

## §5. Data model (hub SQLite)

Migration `apps/hub/src/db/migrations/NNNN_kds_print.sql`, next free number at build time.

```sql
-- print_config projection (with reset): PrinterSaved, StationOutputSet, LanesSet
CREATE TABLE printers (
  printer_id      TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  connection      TEXT NOT NULL CHECK (connection IN ('lan','usb')),
  address         TEXT NOT NULL,
  paper_width_mm  INTEGER NOT NULL CHECK (paper_width_mm IN (58,80)),
  supports_status INTEGER CHECK (supports_status IN (0,1)),   -- NULL until the first test print (worker, plain statement)
  archived_at     INTEGER,
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX printers_name_active ON printers (name) WHERE archived_at IS NULL;      -- CONFIG_NAME_TAKEN

CREATE TABLE station_outputs (
  station_id   TEXT PRIMARY KEY,
  mode         TEXT NOT NULL CHECK (mode IN ('screen','printer','both')),
  printer_id   TEXT,
  sound_volume INTEGER NOT NULL CHECK (sound_volume BETWEEN 0 AND 100),
  show_taker   INTEGER NOT NULL DEFAULT 1 CHECK (show_taker IN (0,1)),
  show_order_id INTEGER NOT NULL DEFAULT 1 CHECK (show_order_id IN (0,1)),
  CHECK (mode = 'screen' OR printer_id IS NOT NULL)
);
CREATE INDEX station_outputs_printer ON station_outputs (printer_id);                      -- CONFIG_IN_USE on archive

CREATE TABLE station_lanes (
  station_id TEXT PRIMARY KEY, lanes_on INTEGER NOT NULL, lane_count INTEGER NOT NULL,
  CHECK (lanes_on BETWEEN 1 AND lane_count)
);

-- kitchen_tickets projection (forward-only, M40): FireDispatched, ItemDone, ItemDoneUndone, ItemServed,
-- ItemRemoved, ItemVoided, OrderBoosted, ItemsReleased, TicketReprinted
CREATE TABLE tickets (
  ticket_id     TEXT PRIMARY KEY,                -- fire_event_id || ':' || order_id
  station_id    TEXT NOT NULL,
  order_id      TEXT NOT NULL,
  fire_event_id TEXT NOT NULL,
  fired_at      INTEGER NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('scheduled','early_fill','pulled'))
);
CREATE INDEX tickets_order ON tickets (order_id);                                           -- reprint by order, boost slips
CREATE INDEX tickets_station_fired ON tickets (station_id, fired_at);                       -- fallback, kds catch-up

CREATE TABLE ticket_lines (
  order_item_id TEXT PRIMARY KEY,                -- a line fires once (a return is a new line)
  ticket_id     TEXT NOT NULL,
  station_id    TEXT NOT NULL,
  units_at_fire INTEGER NOT NULL,
  done_at       INTEGER
);
CREATE INDEX ticket_lines_ticket ON ticket_lines (ticket_id);                               -- render, printed check
CREATE INDEX ticket_lines_open ON ticket_lines (station_id) WHERE done_at IS NULL;          -- Now, fallback, archived warning

CREATE TABLE print_jobs (                        -- F §5.8 (F-1); hub state, never synced
  job_id       TEXT PRIMARY KEY,                 -- ULID; projection jobs use event_id || ':' || n
  kind         TEXT NOT NULL CHECK (kind IN ('kitchen','reprint','cancel','first','coming_up','document','test')),
  printer_id   TEXT,                             -- document / test; NULL → station's current printer
  station_id   TEXT,
  ticket_id    TEXT,
  order_id     TEXT,
  payload      TEXT NOT NULL,                    -- JSON reference or Doc (§3.10)
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
  WHERE acked_at IS NULL AND cancelled_at IS NULL;                                          -- worker head per printer, boot step 5
CREATE INDEX print_jobs_ticket ON print_jobs (ticket_id) WHERE ticket_id IS NOT NULL;       -- printed check

-- pass projection (with reset): ReadyToServe, ReadyToServeUndone, Handover, ReadyRetargeted, AlertClosed
CREATE TABLE pass_orders (
  order_id        TEXT NOT NULL,
  point_id        TEXT NOT NULL,
  ready_at        INTEGER,
  ready_by        TEXT,                          -- staff_id
  ready_alert_id  TEXT,                          -- open Ready alert, NULL when closed
  ready_table_id  TEXT,
  PRIMARY KEY (order_id, point_id)
);
CREATE INDEX pass_orders_open ON pass_orders (ready_alert_id) WHERE ready_alert_id IS NOT NULL;   -- retarget tick, AlertClosed fold

CREATE TABLE handovers (
  handover_id          TEXT PRIMARY KEY,
  order_id             TEXT NOT NULL,
  point_id             TEXT NOT NULL,
  receiver_staff_id    TEXT NOT NULL,
  handed_at            INTEGER NOT NULL,
  served_card_alert_id TEXT,
  card_closed_at       INTEGER
);
CREATE INDEX handovers_handed ON handovers (handed_at);                                     -- handoversDue
CREATE INDEX handovers_open_card ON handovers (served_card_alert_id) WHERE card_closed_at IS NULL; -- served_cards tick, AlertClosed fold

CREATE TABLE handover_lines (
  order_item_id TEXT PRIMARY KEY,
  handover_id   TEXT NOT NULL
);
CREATE INDEX handover_lines_handover ON handover_lines (handover_id);
```

- Projections: `print_config` (reset), `kitchen_tickets` (forward-only), `pass` (reset), `device_roles` (forward-only; `DeviceRoleSet` → `UPDATE devices SET point_id, lane_label`, H-1). `pass` reads `AlertClosed` only to clear `ready_alert_id` / set `card_closed_at` by alert id (indexed).
- Times are `recorded_at`. No session ids in 03b tables.

---

## §6. Commands, events and queries

**Common rules.** `POST /commands/:name`, `sessionKind: 'device'`, D32 idempotency, no PIN, **not queueable** (P5). Responses `200 { data: { command_id, event_ids, result } }`; only `result` is listed. Statement counts exclude 01d's own bounds and the append; engine reads are memory.

### 6.1 `StartItem` — `{ order_item_id }`; station session or `run-pass`; §3.2. Result `{ started }`. Statements: 0. Errors: `ORDER_NOT_FOUND`, `ITEM_WRONG_STAGE`, `PERMISSION_DENIED`.
### 6.2 `DoneItem` — `{ order_item_id, confirm? }`; §3.2. Result `{ done }`. Statements: 0. Errors: as 6.1 + `DONE_CONFIRM_REQUIRED`.
### 6.3 `UndoDone` — `{ order_item_id }`; §3.2. Result `{ undone, ready_undone }`. Statements: 2 (handover line, pass order). Errors: as 6.1 + `UNDO_WINDOW_CLOSED`.
### 6.4 `GiveMeMore` — `{ station_id, n? }`; §3.2. Result `{ pulled: string[] | null }`. Statements: 0. Errors: `STATION_NOT_FOUND`, `PERMISSION_DENIED`.
### 6.5 `SetLaneState` — `{ station_id, lanes_on }`; §3.11. Result `{ lanes_on, lane_count, capacity }`. Statements: 2 (lane devices, station lanes). Errors: `STATION_NOT_FOUND`, `VALIDATION_FAILED`, `PERMISSION_DENIED`.
### 6.6 `MarkReadyToServe` — `{ order_id, point_id }`; `run-pass`; §3.5. Result `{ alert_id, already? }`. Statements: 4 (order, handover lines, pass order, `currentTableOf`). Errors: `POINT_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`, `ITEM_WRONG_STAGE`, `DEVICE_TYPE_NOT_ALLOWED`.
### 6.7 `UndoReadyToServe` — `{ order_id, point_id }`; `run-pass`; §3.5. Statements: 2. Errors: `UNDO_WINDOW_CLOSED`, `POINT_NOT_FOUND`.
### 6.8 `Handover` — `{ handover_id, order_id, point_id, receiver_staff_id, order_item_ids? (1–40) }`; `run-pass`; §3.5. Result `{ served_card_alert_id }`. Statements: 4 (order lines, handover lines, pass order, handover id). Errors: `POINT_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`, `ITEM_WRONG_STAGE`, `HANDOVER_RECEIVER_INVALID`, `VALIDATION_FAILED`.
### 6.9 `ReprintTicket` — `{ ticket_id? , order_id? }` (exactly one); §3.9. Result `{ ticket_ids, skipped }`. Statements: 2. Errors: `ORDER_NOT_FOUND`, `PERMISSION_DENIED`, `VALIDATION_FAILED`.
### 6.10 `SavePrinter` — `{ printer_id, name, connection, address, paper_width_mm, archived? }`; `manage-devices`; §3.7. Writes `PrinterSaved`. Statements: 2 (name, in use). Errors: `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `VALIDATION_FAILED`.
### 6.11 `SetStationOutput` — `{ station_id, mode, printer_id, sound_volume, show_taker?, show_order_id? }`; `manage-devices`; §3.7. Writes `StationOutputSet`. Statements: 1. Errors: `STATION_NOT_FOUND`, `PRINTER_NOT_FOUND`, `STATION_NO_PRINTER`.
### 6.12 `SetDeviceRole` — `{ device_id, point_id?: string | null, lane_label?: string | null }`; `manage-devices`; §3.7. Writes `DeviceRoleSet`. Statements: 1. Errors: `DEVICE_NOT_FOUND`, `POINT_NOT_FOUND`, `VALIDATION_FAILED` (H-6 rules).

### 6.13 `POST /print/test` — `{ printer_id }`; `manage-devices`; not through the writer. Inserts a `test` job (plain statement), waits ≤ 8 s for its outcome, sets `supports_status`. `200 { acked, supports_status, error | null }`. Errors: `PRINTER_NOT_FOUND`.
### 6.14 `POST /print/jobs/:job_id/cancel` — `manage-devices`; sets `cancelled_at` on a pending job. Errors: `PRINT_JOB_NOT_FOUND` (absent, acked or already cancelled).
### 6.15 `GET /queries/print-config` — `manage-devices`. `{ printers, station_outputs, devices: [{ device_id, name, device_type, station_id, point_id, lane_label }], warnings: [{ station_id, kind: 'no_fallback_printer' | 'archived_open_lines' }] }`. Statements: 4.
### 6.16 `GET /queries/pass-receivers?order_id` — `run-pass`. `{ receivers: [{ staff_id, name, table_team: boolean }] }`: staff with `mark-served` and an open session (memory), the table team (dine-in, `tableOwners`) first. Statements: 2.
### 6.17 `GET /queries/print-queue` — `manage-devices`. `{ printers: [{ printer_id, name, online, waiting, head_error }], jobs: [...pending, newest 100] }`. Statements: 2.
### 6.17a `GET /queries/order-tickets?order_id` — `reprint-ticket`. `{ tickets: [{ ticket_id, station_name, fired_at, printed }] }`. Statements: 1.
### 6.18 Catch-up part `kds_station` — station sockets, own station. `{ station_id, day_open, output: { mode, sound_volume, fallback }, lanes: { lanes_on, lane_count }, now: LineDetail[] (with stage, fired_at, started_at, mark), details: LineDetail[] (every unfired line of `station_plan` with `frozen: true`) }`. Statements: 4 (open ticket lines, order lines + orders for the ids, `currentTableOf`, output + lanes).
### 6.19 Catch-up part `point_view` — staff sockets on a device with `point_id`. `{ point_id, stations: [{ station_id, short_name, lanes }], orders: [{ order_id, identifier, placed_at, lines: [LineDetail & { stage, handed_over }], ready: { at, by } | null }] }`. Statements: 5.
### 6.20 Frames `kds_lines { station_id, lines: LineDetail[] }` and `point_lines { point_id, lines }` — after commit, details for ids the station's (point's) plan or Now gained in that commit, sent once per id per socket set (memory, like 03a's payload filter); 2 statements per commit that adds lines. `station_notice` — §3.13.
### 6.21 Event audiences — `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ItemRemoved`, `ItemVoided`, `ItemServed`, `OrderBoosted`, `ItemsReleased`, `FireDispatched`: station sockets of the line's station (engine state lookup) and point-bound staff sockets of its point; `ReadyToServe`, `ReadyToServeUndone`, `Handover`, `ReadyRetargeted`: point-bound staff sockets of that point; `LanesSet`: the station's sockets and its point.
### 6.22 Tick `ready_retarget` — `due`: open Ready rows (1 statement, `pass_orders_open`) + `currentTableOf` for their dine-in orders (1); due when any stored `ready_table_id` ≠ the current primary table. `intents`: per row `AlertClosed 'obsolete'` + `AlertRaised` (via `alerts.closeMany` / `raiseMany`) + `ReadyRetargeted`.
### 6.23 Tick `served_cards` — `due`: handovers with an open card and no unserved live line (1 statement over `handovers_open_card`, `handover_lines`, `order_lines`). `intents`: `alerts.closeMany(…, 'done')`.

### 6.24 Kinds

```typescript
defineAlertKind({
  kind: 'ready_to_serve', family: 'action', subject: 'order',
  steps: [
    { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
    { at: { value: 'window_ms', times: 1 }, to: [{ target: 'raised_target', set: 'recipient' }] },     // attempt 2 (A14)
    { at: { value: 'window_ms', times: 2 }, to: [{ target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' },
                                               { target: 'managers', set: 'recipient' }] },
  ],
  closes_on: 'owner',                          // Handover 'done', Undo 'undone', retarget 'obsolete', day close
  values_schema: z.object({ order_id: z.string().min(1), point_id: z.string().min(1),
                            table_id: z.string(), window_ms: z.number() }),
  details_schema: null, lead_fallback: false, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.ready_to_serve.card', lock: 'alert.ready_to_serve.lock' }, request: null,
});
defineAlertKind({
  kind: 'served_card', family: 'info', subject: 'order',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
  closes_on: 'owner',                          // served_cards tick
  values_schema: z.object({ handover_id: z.string().min(1), order_id: z.string().min(1) }),
  details_schema: null, lead_fallback: false, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.served_card.card', lock: 'alert.served_card.lock' }, request: null,
});
defineAlertKind({
  kind: 'printer_problem', family: 'action', subject: 'hub',  // stream_id 'printer:' + printer_id
  steps: [{ at: { ms: 0 }, to: [{ target: 'managers', set: 'recipient' }] }],
  closes_on: 'owner',                          // print worker at the next ack
  values_schema: z.object({ printer_id: z.string().min(1), waiting: z.number().int().min(1) }),
  details_schema: null, lead_fallback: true, expires_at_day_close: false, silent: false,
  labels: { card: 'alert.printer_problem.card', lock: 'alert.printer_problem.lock' }, request: null,
});
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

The engine's replay filter (F-8) lists none of these; they never change `EngineState`. Every `alert_id` passes 01d's `checkAlertIds`.

---

## §7. Cross-cutting

| Item | Rule | Why (YAGNI) |
|---|---|---|
| Print worker timer | 1 s loop, async, one in-flight send per printer | Network I/O must not run inside the 500 ms tick or a transaction (D3) |
| Timeouts | TCP connect 3 s, status read 2 s, test print 8 s | A dead printer must not stall other printers |
| Address validation | LAN private IPv4 only; USB `/dev/usb/lp[0-9]` | The hub must not be told to open sockets to the internet or arbitrary files |
| Logging | `print.sent`, `print.acked`, `print.failed { printer_id, attempts, error }`, `print.fallback.enter/leave { station_id }` | Install-day and rush diagnosis; no alert spam |
| Performance | Projection ≤ 3 statements per event; `kds_station` catch-up ≤ 4 statements; worker loop ≤ 3 statements when idle | ~200 orders / rush, ~10 devices (CLAUDE.md) |
| Retention | Acked / cancelled `print_jobs` older than 7 days deleted at 00's maintenance hour (M66); `tickets` / `ticket_lines` older than 7 days likewise | Hub disk; tickets are not history (events are) |
| Sync | None of 03b's hub tables sync; 03b's events sync as all events | F §3 |
| No new env var, no new dependency | — | — |

---

## §8. Client contract (`apps/client`, ui-kit only, 01a S35)

- **KDS entry** (`apps/client` entry `kds`, station session, served by the hub): station view §3.3; big touch targets, no modal; inline second tap for Done-early; "Tap Start first" inline; Undo for 30 s on the removed row; Give me more button; Lane Off / On on a lane KDS; sounds per P7 at `output.sound_volume` (no volume control on screen); "Reconnecting…" banner and all taps disabled while the socket is down (P5); "Day not started"; archived banner; `printed` tags; coming-up strip. English and Urdu UI strings (item names as typed).
- **Pass tablet** (01d's `/staff/` entry, a "Pass" screen shown on a device with `point_id`): §3.4 cards, Ready / Hand over / Undo, receiver tiles from `pass-receivers` (no PIN for the receiver), Start / Done for screenless stations, lanes. Staff session (PIN, idle TTL as 00). Offline → banner, taps disabled (P5).
- **Hub admin "Printers" page** (same session model as 01a's `/admin/stock`): printers (add, edit, archive, test print), station outputs (mode, printer, volume, toggles), device roles (point, lane label), print queue with cancel, warnings.
- **Reprint** on 02b's order screen for holders of `reprint-ticket`: picks tickets from `GET /queries/order-tickets?order_id` (§6.17a) → `ReprintTicket`.
- 12-hour times on every screen and on paper (01d AD-167).

---

## §9. Error catalogue additions (Foundation §6.2, `@pos/domain/src/errors.ts`)

| Code | HTTP | Details | When |
|---|---|---|---|
| `PRINTER_NOT_FOUND` | 404 | `{ printer_id }` | unknown or archived printer |
| `PRINT_JOB_NOT_FOUND` | 404 | `{ job_id }` | cancel of an absent, acked or cancelled job |
| `UNDO_WINDOW_CLOSED` | 409 | `{ order_item_id? , order_id?, point_id? }` | Undo Done / Undo ready after 30 s or after a hand-over |
| `DONE_CONFIRM_REQUIRED` | 409 | `{ order_item_id, elapsed_ms, cook_ms }` | Done under 50 % of cook time without `confirm` |
| `HANDOVER_RECEIVER_INVALID` | 409 | `{ receiver_staff_id }` | receiver unknown, inactive or without `mark-served` |
| `STATION_NO_PRINTER` | 409 | `{ station_id }` | `printer` / `both` mode without a printer |

Reused: `ITEM_WRONG_STAGE` (stage adds `'handed_over'`), `ORDER_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`, `STATION_NOT_FOUND`, `POINT_NOT_FOUND`, `DEVICE_NOT_FOUND`, `DEVICE_TYPE_NOT_ALLOWED`, `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `PERMISSION_DENIED`, `VALIDATION_FAILED`.

---

## §10. Tests (`apps/hub/test/kds/*.test.ts`, `apps/hub/test/print/*.test.ts`; client tests in `apps/client`)

Station commands
1. `StartItem` from a station session: `ItemStarted { source: 'tap' }`, `actor_id null`, KDS `device_id`; other station's line → `PERMISSION_DENIED`.
2. Unfired line → `ITEM_WRONG_STAGE { stage: 'added' }`; `single_tap` → `{ stage: 'cooking' }`; staff with `run-pass` succeeds, without → `PERMISSION_DENIED`.
3. Batch station: Start on one line starts the whole load; Done likewise.
4. Late start writes `ReservationsShifted`; from-stock start writes `StockConsumed`.
5. `DoneItem` at `two_tap` before Start → `ITEM_WRONG_STAGE`; under 50 % → `DONE_CONFIRM_REQUIRED`, nothing written; `confirm: true` → done.
6. From-stock Done with no Start consumes (AD-29 Q7).
7. `UndoDone` inside 30 s → `ItemDoneUndone`; at 30 001 ms → `UNDO_WINDOW_CLOSED`; handed-over line → `ITEM_WRONG_STAGE { stage: 'handed_over' }`.
8. `UndoDone` on a line under an open Ready → `ReadyToServeUndone` + alert closed `undone`.
9. `GiveMeMore`: pulls 1 line; `pullEarly` null → `{ pulled: null }`, no event; `single_tap` writes the inferred start; a load is pulled whole.
10. Two Done taps on one line (two KDS) → the second `ITEM_WRONG_STAGE` (single writer).
Lanes
11. `SetLaneState` 2 → 1 of 2: `StationCapacitySet { reason: 'lane_off' }` with `capacityForLanes` + `LanesSet`; same value → no-op; 3 of 2 → `VALIDATION_FAILED`.
12. `lane_count` counts labelled, unrevoked `kds` devices; none → 1.
Pass
20. `MarkReadyToServe` dine-in raises to `table_team direct` on the current primary table with `window_ms` from settings; second tap → `{ already: true }`, one alert.
21. Takeaway Ready targets `placed_by`.
22. `ready_retarget`: `TableMoved` → old alert `obsolete`, new on the new table, `ReadyRetargeted`.
23. `UndoReadyToServe` within 30 s closes `undone`; after → `UNDO_WINDOW_CLOSED`.
24. `Handover` without Ready writes `ReadyToServe { alert_id: null }` + `Handover`, raises `served_card` to the receiver; receiver without `mark-served` → `HANDOVER_RECEIVER_INVALID`.
25. Partial hand-over keeps the Ready open; the last one closes it `done`.
26. `served_cards` closes the card when every handed line is served (tap, estimate) or removed / voided.
27. `handoversDue` returns only hand-overs older than the cut-off with an unserved live line (1 statement).
28. Station session calling `Handover` → `DEVICE_TYPE_NOT_ALLOWED`.
Tickets and slips
30. Golden text, 32 and 48 columns: item, child at another station ("for Chicken Karahi — Full · T12"), deal part, option child without station, kitchen note, order note, token with earlier date, parking line, RETURN · REMAKE, FIRST mark; no prices, no COMP, no zone-served line.
31. One `FireDispatched` with lines of two orders → two tickets; `printer` mode → two `kitchen` jobs in the same transaction; `screen` mode → none.
32. **Partial removal of a fired, printed line prints "− 1 x Naan · 3 left"** (02b run 4 M-5); whole removal → whole-line CANCELLED; unprinted → no slip, the ticket renders without the units.
33. Void of a printed, not-done line → CANCELLED; of a done line → nothing.
34. Boost on a printed ticket at a `printer` station → FIRST; at `both` / `screen` → none.
35. Done before send → the job renders empty and is cancelled, not printed.
36. Projection rebuild (00 rebuild path) creates no job (forward-only).
37. `ReprintTicket` from a KDS: own station only, `TicketReprinted` with device; by order from staff with `reprint-ticket`; REPRINT header; current table printed.
Worker and printers
40. Fake TCP printer (port 9100): job sent, status clean → acked; status paper-end → not acked, retried.
41. Printer down: commands still succeed; retries 2 s, 5 s, 10 s; after 30 s `printer_problem` raised once; cleared at the next ack.
42. Two printers: one down does not delay the other; FIFO per printer.
43. Restart with `sent_at` set, `acked_at` null → re-sent with REPRINT and `is_reprint = 1`.
44. `supports_status = 0` → flushed write acks.
45. Encoder bytes: init, align, bold, double, cut, drawer, PC437 `?` replacement.
46. Station output changed to another printer → pending station jobs go to the new printer; `document` jobs stay.
Fallback
50. `screen` station, socket closed: no print before `kds_offline_print_ms`; at it: Now tickets + COMING UP; new fires print; reconnect stops; `printed` flags in catch-up.
51. Boot: no fallback during the grace when screens reconnect.
52. Archived station with open lines: `station_notice` to its sockets and admins; tickets still render.
Config
55. `SavePrinter` validation (private IPv4, USB path), `CONFIG_NAME_TAKEN`, archive in use → `CONFIG_IN_USE`.
56. `SetStationOutput` `printer` without printer → `STATION_NO_PRINTER`; DB CHECK backs it.
57. `SetDeviceRole`: lane label on a non-`kds` device → `VALIDATION_FAILED`; point binding updates `devices.point_id`.
58. `POST /print/test` sets `supports_status`; `POST /print/jobs/:id/cancel` on an acked job → `PRINT_JOB_NOT_FOUND`.
60. `run-pass` default grants by `default_key` after migration (B-1).
Catch-up and frames
65. `kds_station` ≤ 4 statements with 50 lines (statement counter); `point_view` ≤ 5.
66. `kds_lines` sent once per new id; a plan frame for a known id sends no detail.
Client
70. Station view: frame sequences keep order (append bottom, Done removes, marks top, `moved` tag); placeholder row filled by `kds_lines`.
71. Late colouring from `planned_done_ms` with a skewed device clock corrected by `hub_time`.
72. Offline banner disables taps.
73. Coming-up strip counts.
74. Pass card readiness: Ready, HOLD hint, immediate line green.

### Acceptance

| Story AC | Test |
|---|---|
| E3-KDS AC1 (station / all stations) | 65, 70, 74 |
| E3-KDS AC2–AC3 (as 03a contract) | 70, 71 |
| E3-KDS AC4 (one tap, no dialogs) | 1, 5, 70 |
| E3-KDS AC5 (sound, volume) | client test of P7 sounds, 56 |
| E3-KDS AC6 (late) | 71 |
| E3-KDS edge (two-tap, undo, archived) | 5, 7, 52 |
| E3-PRT AC1 (per-station output) | 31, 56 |
| E3-PRT AC2 (screen offline → paper) | 50, 51 |
| E3-PRT AC3 (58 / 80, LAN / USB) | 30, 40, 45 |
| E3-PRT edges (never blocks, Done cancels, restart reprint) | 41, 35, 43 |
| E0-ORD AC4 (reprint) | 37 |
| 02b To 03b | 30, 32 |

---

## §11. Build order (one task per commit, TDD)

| # | Task | Files | Spec |
|---|---|---|---|
| 0a | B-1: `run-pass` in `PERMISSION_CATALOGUE`, CHECK-expand migration, `default_key` grants, re-seed (R29) — approved cross-module task (OQ-2) | `packages/domain/src/permissions.ts`, `apps/hub` + `apps/cloud` migrations | §4.5 B-1 |
| 0b | A-1: settings `ready_window_ms`, `kds_offline_print_ms` on 01a's branch settings endpoint and snapshot `settings` (additive) | 01a settings files | §4.5 A-1 |
| 0c | D-1: `ready_to_serve_attempts`, `printer_alert_ms` in `ALERT_CONSTANTS` | `packages/domain/src/alert-constants.ts` | §4.5 D-1 |
| 0d | F-1, F-2, H-1, S-1: doc text in their targets with "Changed by 03b" markers (applied with 03b's approval, R34) | foundation, 00, `stories-refined.md` | §4.5 |
| 0e | To 02b: register tick `served_estimate` over `handoversDue` (after task 29; needs `module-02b` merged) | 02b's `apps/hub/src/orders/` tick file | §4.3 To 02b |
| 1 | Error codes | `packages/domain/src/errors.ts` | §9 |
| 2 | Shared types `kds.ts` (`LineDetail`, `Doc`, `Identifier`) | `packages/domain/src/kds.ts` | §4.4 |
| 3 | Event schemas (9) | `packages/events/src/events/{order,station,hub}/` | §6.25 |
| 4 | Migration | `apps/hub/src/db/migrations/NNNN_kds_print.sql` | §5 |
| 5 | Projection `print_config` | `apps/hub/src/print/config-projection.ts` | §3.7 |
| 6 | Projection `device_roles` | `apps/hub/src/kds/device-roles.ts` | §3.7, H-1 |
| 7 | Commands `SavePrinter`, `SetStationOutput`, `SetDeviceRole` | `apps/hub/src/print/commands/` | §6.10–6.12 |
| 8 | Commands `StartItem`, `DoneItem` | `apps/hub/src/kds/commands/` | §3.2 |
| 9 | `UndoDone`, `GiveMeMore` | same | §3.2 |
| 10 | `SetLaneState` | same | §3.11 |
| 11 | Projection `kitchen_tickets` (tickets, lines, at-fire jobs) | `apps/hub/src/print/tickets-projection.ts` | §3.6 |
| 12 | Slip rules (cancel, first) in the projection | same | §3.6, §3.9 |
| 13 | `ReprintTicket` + `TicketReprinted` | `apps/hub/src/print/commands/` | §3.9 |
| 14 | Doc model, `renderText`, ticket / slip / coming-up builders | `apps/hub/src/print/render/` | §3.6, §3.10 |
| 15 | ESC/POS encoder | `apps/hub/src/print/escpos.ts` | §3.10 |
| 16 | Transports LAN / USB + fake printer for tests | `apps/hub/src/print/transport/` | §3.14 |
| 17 | Print worker: FIFO per printer, ack, retry, empty-render cancel | `apps/hub/src/print/worker.ts` | §3.14 |
| 18 | Boot step 5 resume | `apps/hub/src/print/boot.ts` | §3.14 |
| 19 | Paper fallback | `apps/hub/src/print/fallback.ts` | §3.8 |
| 20 | Kind `printer_problem` + raise / close | `apps/hub/src/print/kinds.ts` | §6.24 |
| 21 | `printDocument`, `kickDrawer` | `apps/hub/src/print/api.ts` | §3.15 |
| 22 | `/print/test`, job cancel route | `apps/hub/src/print/routes.ts` | §6.13–6.14 |
| 23 | Queries print-config, print-queue, order-tickets | `apps/hub/src/queries/` | §6.15, §6.17, §6.17a |
| 24 | Projection `pass` | `apps/hub/src/kds/pass-projection.ts` | §5 |
| 25 | Kinds `ready_to_serve`, `served_card` | `apps/hub/src/kds/kinds.ts` | §6.24 |
| 26 | `MarkReadyToServe`, `UndoReadyToServe` | `apps/hub/src/kds/commands/` | §3.5 |
| 27 | `Handover` | same | §3.5 |
| 28 | Ticks `ready_retarget`, `served_cards` | `apps/hub/src/kds/ticks.ts` | §6.22–6.23 |
| 29 | `handoversDue`, `handedOverLines` | `apps/hub/src/kds/exports.ts` | §4.2 |
| 30 | `pass-receivers` query | `apps/hub/src/queries/` | §6.16 |
| 31 | Catch-up `kds_station`, frame `kds_lines` | `apps/hub/src/ws/kds-catch-up.ts` | §6.18, §6.20 |
| 32 | Catch-up `point_view`, frame `point_lines` | same | §6.19–6.20 |
| 33 | Event audiences | `apps/hub/src/ws/kds-audiences.ts` | §6.21 |
| 34 | Config hook (archived station) + `station_notice` | `apps/hub/src/kds/config-hook.ts` | §3.13 |
| 35 | Retention at the maintenance hour | `apps/hub/src/print/retention.ts` | §7 |
| 36–44 | KDS client: shell + session, station view, line row + timers, marks / moved / placeholders, Start / Done / Undo / Give me more, sounds, banners, coming-up strip, lane screen | `apps/client/src/features/kds/` | §3.3, §8 |
| 45–49 | Pass screen: cards, readiness, Ready / Undo, hand-over tiles, screenless Start / Done + lanes | `apps/client/src/features/pass/` | §3.4, §8 |
| 50–52 | Hub admin Printers page: printers + test, outputs + roles, queue | `apps/client/src/features/admin-printers/` | §8 |
| 53 | Reprint on the order screen | `apps/client/src/features/ordering/` (02b's, after merge) | §8 |
| 54 | Manual pilot checks: real printer (status, cut, PC437), USB, fallback by pulling a KDS cable, restart mid-print | `docs/plans/03b-manual-checks.md` | §3.8, §3.14 |

≈ 58 tasks (54 + upstream 0a–0e; G0 §8 budget ~60). Split watch-line unchanged: if review adds claims or raster printing, split **03c Pass** (tasks 24–33 hub, 45–49 client).

---

## §12. Definition of Done, checklist, questions, deferred, self-review

### 12.1 Definition of Done

Gate green (`TMPDIR=/dev/shm … typecheck, lint, test`); every §10 test passes; statement counts asserted (65, 27); §12.2 all ticked; §4.5 rows approved and applied in their targets; manual checks (task 54) done on the pilot printer(s); README 03b row → Implemented.

### 12.2 Endpoint checklist

| # | Endpoint / unit | Permission | Statements | Errors | Test |
|---|---|---|---|---|---|
| 1 | `StartItem` | station / `run-pass` | 0 | 3 | 1–4 |
| 2 | `DoneItem` | station / `run-pass` | 0 | 4 | 5, 6, 10 |
| 3 | `UndoDone` | station / `run-pass` | 2 | 4 | 7, 8 |
| 4 | `GiveMeMore` | station / `run-pass` | 0 | 2 | 9 |
| 5 | `SetLaneState` | station / `run-pass` | 2 | 3 | 11, 12 |
| 6 | `MarkReadyToServe` | `run-pass` | 4 | 4 | 20–22 |
| 7 | `UndoReadyToServe` | `run-pass` | 2 | 2 | 23 |
| 8 | `Handover` | `run-pass` | 4 | 5 | 24, 25, 28 |
| 9 | `ReprintTicket` | station / `reprint-ticket` | 2 | 3 | 37 |
| 10 | `SavePrinter` | `manage-devices` | 2 | 3 | 55 |
| 11 | `SetStationOutput` | `manage-devices` | 1 | 3 | 56 |
| 12 | `SetDeviceRole` | `manage-devices` | 1 | 3 | 57 |
| 13 | `POST /print/test` | `manage-devices` | 2 | 1 | 58 |
| 14 | `POST /print/jobs/:id/cancel` | `manage-devices` | 1 | 1 | 58 |
| 15 | `GET /queries/print-config` | `manage-devices` | 4 | — | 55 |
| 16 | `GET /queries/pass-receivers` | `run-pass` | 2 | — | 24 |
| 17 | `GET /queries/print-queue` | `manage-devices` | 2 | — | 42 |
| 18 | `GET /queries/order-tickets` | `reprint-ticket` | 1 | — | 37 |
| 19 | Catch-up `kds_station` + frame `kds_lines` | station | 4 / 2 | — | 65, 66 |
| 20 | Catch-up `point_view` + frame `point_lines` | point staff | 5 / 2 | — | 65 |
| 21 | Tick `ready_retarget` | — | 2 | — | 22 |
| 22 | Tick `served_cards` | — | 1 | — | 26 |
| 23 | Kinds ×3 | — | — | — | 20, 24, 41 |
| 24 | Projections ×4 | — | ≤ 3 / event | — | 31–36 |

### 12.3 Open questions

| # | Question | Owner of the answer |
|---|---|---|
| OQ-1 | ~~Printer model~~ **Answered (owner, 2026-11-11):** generic thermal printers that connect by wire (USB) and over the network (LAN); no model fixed. Spec handles both transports; status support and code page are detected per printer at its test print; manual checks (task 54) run on whatever printer is bought. | closed |
| OQ-2 | ~~Where upstream rows are built~~ **Answered (owner, 2026-11-11, "bana do"):** inside 03b's plan as approved cross-module tasks 0a–0e (§11). | closed |
| OQ-3 | `DONE_CONFIRM_REQUIRED` uses the planned cook time; a `fix` return uses its override (03a §3.8a). Confirm no confirm at `auto_done` stations (the tick writes Done there). Proposed: the check applies to taps at every mode. | Review |

### 12.4 Deferred until needed

Lane claims (K7, 01e button devices); Urdu-script raster printing (after OQ-1); configurable kitchen ticket template (E0-TPL AC2 beyond the two toggles); training-mode printing (E13); audio callouts (P3); per-zone walk times for `window_ms` (K10); a "screen offline" alert to managers (logs only today); printing on the cloud side (never).

### 12.5 Hostile self-review (v0.1)

| # | Finding | Fix in v0.1 |
|---|---|---|
| 1 | Race: two screens tap Done on one line. | Single writer + stage guard → the second gets `ITEM_WRONG_STAGE` (test 10). |
| 2 | Race: Handover and UndoDone on the same line. | Both in the writer; UndoDone checks `handover_lines` (§3.2), Handover checks stage `done` (§3.5). |
| 3 | A projection rebuild would reprint the day. | `kitchen_tickets` is forward-only (M40); test 36. |
| 4 | A job written outside the event transaction could be lost on a crash between them. | At-fire jobs are written by the projection inside the transaction (D1); only fallback jobs are written by the worker, and a crash there is covered by the next loop (the ticket is still unprinted). |
| 5 | Head-of-line blocking: a dead printer holds its queue forever. | Per-printer FIFO only; kitchen jobs drain as lines finish; manager can cancel documents; alert after 30 s. |
| 6 | Fallback flapping on a bad Wi-Fi KDS prints duplicates. | Enter after `kds_offline_print_ms` continuous absence; leave on connect; tickets print once (`printed` check). A flapping screen at worst prints new fires that also show on screen. |
| 7 | N+1 in catch-up and frames. | Fixed statement counts (§6.18–6.20), test 65. |
| 8 | SSRF-like misuse of printer addresses. | Private IPv4 / `lp` devices only (§7). |
| 9 | Contradiction risk with 02a (re-target) and 02b (estimate). | No 02a code touched (tick uses `currentTableOf`); 02b registration is a To 02b row. |
| 10 | Over-engineering check: no outbox (projection in-tx is enough), no library, no separate service, no cloud config, no cache layer. | — |
