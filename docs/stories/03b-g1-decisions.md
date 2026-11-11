# 03b G1: decisions (running record)

| | |
|---|---|
| Status | **Working record of the G1 session (developer, 2026-11-11).** §1 holds the owner's answers to G0 (2026-11-11 12:04 PKT: "yes manzoor ha" — every recommendation of `03b-g0.md` §6 accepted). §2 rows are developer decisions unless marked. Rows marked *Proposed — needs approval* change README or an approved spec; they land only through 03b's §4.5 and the target's version bump (R26, R34). No approved spec file is edited here. |
| Inputs | `03b-g0.md` (§3 gaps, §6 questions, §7 developer decisions); `main` @ `67c84c6` code read on 2026-11-11: `packages/engine/src/view.ts` (`stationView`, `stationPlan`, `groupReadiness(state, order_id, now)`, `pullEarly`, `lateStartShift`), `packages/engine/src/pressure.ts` (`capacityForLanes`), `apps/hub/src/commands/set-station-capacity.ts` (`stationScoped` command shape), `apps/hub/src/ws/server.ts` (`WsHub.connectedSessions()`), `apps/hub/src/sync/branch-config-holder.ts` (`onBranchConfigApplied`), migration `0008_device_point_lane.sql` (H-5, H-6 columns); 00 v1.8 §4.2 (`registerProjection` without `reset` = forward-only, M40); no `print_jobs` table and no station command exists in code yet. |

## 1. Owner answers to G0 (2026-11-11, all recommendations)

| Q | Answer | Lands in spec |
|---|---|---|
| Q1 | **B** — one slip per order per station per fire (lines of one order fired together at one station share a slip). | §3.6 |
| Q2 | **A** — the kitchen ticket prints at **fire**. | §3.6 |
| Q3 | Default **screen only + automatic paper fallback**; **printer only** for a station with no screen; **screen + printer** stays a mode; set on the **hub admin** (hub-local, never in the cloud). | §3.7, §5 |
| Q4 | **A** — after `kds_offline_print_ms` (config, 30 s) with no screen of that station connected, the station's Now prints (normal tickets) plus one "COMING UP" list of its Next; every new fire prints until a screen is back; printed lines then show a "printed" tag. | §3.8 |
| Q5 | **A** — KDS taps disabled while the hub is unreachable, "Reconnecting…" banner; no queue on the KDS. | §8 |
| Q6 | **A** — big identifier, item × qty, options, notes highlighted, mark reason; Now shows "cooking m:ss", red "late +N" past the planned Done; Next shows "in m:ss"; no clock or promise times. | §8 |
| Q7 | **A** — chime when a line enters Now; stronger sound for RETURN / boost / expedite; no late sound; volume only from the hub admin. | §8, §5 |
| Q8 | **A** — one new permission **`run-pass`** (group `kitchen`): Start / Done / Undo / Give me more for any station from a staff session, Ready to serve, Undo ready, Handover, Lane Off / On. Defaults Owner, Manager, Cook (allowed). | §3.12, §4.5 B-1 |
| Q9 | Extra slips: **(a)** void of a printed, not-done line → CANCELLED **yes**; **(b)** boost / expedite / pull of a printed, not-done line → "FIRST" slip **only on printer-only stations**; **(c)** Done after print → **no** slip. | §3.9 |
| Q10 | **A** — Latin text only on paper in the pilot; Urdu-script raster printing after the printer model is known (OQ14). | §3.10, §12.4 |
| Q11 | **A** — Lane Off / On only (Pass tablet, or the lane's own KDS); claims come with 01e button devices. | §3.11, §12.4 |
| Q12 | **A** — "coming up" count strip on the station view; lines never merged. | §8 |
| Q13 | **A** — a KDS reprints its own station's tickets with no PIN (logged by device); staff screens reprint with `reprint-ticket`. | §3.9, §6 |

## 2. Decisions

| # | Decision | Why / source |
|---|---|---|
| G1-1 | **Tickets are a forward-only projection.** 03b registers projection `kitchen_tickets` **without `reset`** (00 §4.2, M40) over `FireDispatched`, `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ItemRemoved`, `ItemVoided`, `ItemServed`, `OrderBoosted`, `ItemsReleased`. It writes `tickets`, `ticket_lines` and, for stations whose output prints at fire, `print_jobs` rows **in the same transaction as the event** — so a committed fire always has its job (D24: missing ticket not acceptable) and a rebuild never reprints history. | F §5.8 step 5; D24 |
| G1-2 | **A job stores a reference, not bytes.** `print_jobs.payload` is JSON (`{ ticket_id }`, a slip's facts, or 05's document); the bytes are rendered at **send** from current data at the printer's width. So a line removed or done before the job is sent drops out of it, a job left with nothing is cancelled, and a reprint shows the current table. *Proposed — needs approval* as F row F-1 (the foundation schema has `printer_url`, no kind, no payload). | G0 §3 #8; Q9 (c) |
| G1-3 | **Fallback is decided by the print worker, not by the projection.** Presence (`WsHub.connectedSessions()`, no statement) is runtime state, not event state; the forward-only projection only writes jobs whose need follows from config (`printer` / `both`). The worker (1 s timer, async network I/O, never inside a writer transaction) enters / leaves fallback per station and writes the fallback jobs itself. | Q4; 00 H-4 |
| G1-4 | **The print worker is not a 01d tick.** Ticks write events in one 500 ms loop and must not await network I/O. Printing writes only `print_jobs` (hub operational state, never events, never synced — F §3 table "Print queue … (none)") with plain statements on the hub connection between transactions. A printer problem raises 01d kind `printer_problem` through one `writer.run` (events). | 01d G1-16a scope; F §3 |
| G1-5 | **Ack rule.** A job is acked when the write is flushed **and** a status query (DLE EOT n=1, n=4) answers with no offline / paper-end / cover-open / error bit within 2 s; a printer that never answers status is marked `supports_status = 0` at its test print and its jobs ack on a flushed write. No third-party ESC/POS library: a ~100-line encoder covers init, align, bold, double size, cut, drawer kick and status (Epson ESC/POS reference, checked 2026-11-11). | G0 §3 #8; YAGNI |
| G1-6 | **`run-pass` scope `branch` only.** No device-binding check: the permission itself decides; waiters and order takers do not hold it by default. | Q8 |
| G1-7 | **`SetLaneState { station_id, lanes_on }`** is 03b's command: station session (own station) or `run-pass`. It writes 03a's `StationCapacitySet { reason: 'lane_off' \| 'lane_on' }` with `capacityForLanes(station, lanes_on, lane_count)` **and** 03b's `LanesSet { station_id, lanes_on, lane_count }` (station stream; the engine's replay filter skips it), so the screen can show "2 of 3 lanes on" without guessing from capacity. 03a's `SetStationCapacity` stays as built. | 03a To 03b #4 |
| G1-8 | **`SetDeviceRole { device_id, point_id?, lane_label? }`** (`manage-devices`) writes `DeviceRoleSet`; 03b's projection updates the 00 columns `devices.point_id` / `devices.lane_label` (H-5, H-6), with H-6's rules. *Proposed — needs approval* as 00 row H-1: 03b is the writer of those two columns; no 00 code change. | 03a To 03b #4, #1; 00 H-5, H-6 |
| G1-9 | **Ready to serve per order per point** (`ReadyToServe`, `ReadyToServeUndone` ≤ 30 s, `Handover`), all on the **order** stream (engine replay skips them). A Handover with no open Ready writes the Ready first in the same command. The Ready-to-serve alert's dedupe key is `order_id:point_id`; its `values` carry `point_id`, `table_id`, `window_ms`. | 03a To 03b #1; 01d K2–K5, A12 |
| G1-10 | **`ready_window_ms`** is a branch setting (01a settings endpoint, default 60 000, range 15 000–300 000). Per-zone walk times (K10) stay deferred. *Proposed — needs approval* as 01a row A-1. | G0 §3 #10 |
| G1-11 | **Re-target on party changes without touching 02a code:** 03b's tick `ready_retarget` finds open Ready-to-serve alerts whose `values.table_id` is no longer the order's current primary table (`currentTableOf`), and closes `obsolete` + re-raises on the current table in one transaction. | 02a §4.3 To 03b; README build-order note |
| G1-12 | **Served card** = `info` kind to `{ kind: 'person', staff_id: receiver }` raised by `Handover`; closed `done` by 03b's tick `served_cards` once every handed-over line is served (tap or estimate). | 01d D-2 |
| G1-13 | **`served_estimate` registration stays 02b's code.** 03b writes `Handover` and exposes `handoversDue(db, older_than_ms)`; the registration is a **To 02b** row, built in the next platform sprint (02p pattern) — never edited from a 03b branch. | G0 §3 #19; README build-order note |
| G1-14 | **Kitchen ticket layout fixed** (only "show order taker", "show order id" toggles, both default on); a configurable kitchen template is §12.4. Bill / receipt / Z documents are 05's; 03b exposes `printDocument(tx, printer_id, doc)` and `kickDrawer(tx, printer_id)` with a small document model (lines with size / bold / align, rule, cut). | G0 §3 #9; R12 |
| G1-15 | **Paper is Latin text** in code page PC437; any other character prints as `?` and the hub admin page warns when a menu name would lose characters. | Q10 |
| G1-16 | **KDS gets line details from 03b**, not by re-reading 02b events: catch-up part `kds_station` (Now with details, details for every Next id, lanes) and a frame `kds_lines` with details for ids the station's `station_plan` gained; line state changes travel as the existing event frames. | 03a §3.6.3 |
| G1-17 | **"Day not started"** on the KDS until `BusinessDayOpened`; no button. | G0 §3 #13 |
| G1-18 | Error codes: new `PRINTER_NOT_FOUND` (404), `UNDO_WINDOW_CLOSED` (409), `HANDOVER_RECEIVER_INVALID` (409), `STATION_NO_PRINTER` (409); reuse `ITEM_WRONG_STAGE`, `STATION_NOT_FOUND`, `POINT_NOT_FOUND`, `DEVICE_NOT_FOUND`, `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `ORDER_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`, `PERMISSION_DENIED`, `VALIDATION_FAILED`. | F §6.2 |

## 3. Next

Spec `docs/specs/03b_KDS_Printing_Spec_v0.1.md` (DRAFT) from these rows; then hostile review in a fresh chat (pipeline step 4).

## 4. Owner rulings after G4 run 2 (2026-11-11, 13:00–13:04 PKT)

| # | Ruling | Lands in |
|---|---|---|
| R-1 | **Screen first; the printer is an optional accessory.** Every station runs on a screen; a restaurant may attach a thermal printer to any station or none, and the system works fully either way. (Owner's pitch: a restaurant can save the thermal-printer expense.) | 03b v0.3 P16; 03c v0.1 |
| R-2 | **Split the module:** **03b KDS + Pass** (screens; built first) and **03c Printing** (print queue, tickets, slips, paper fallback, printer config, reprint, print API for 05; built after 03b). Both stay in milestone A (05 prints receipts through 03c). Replaces the earlier proposal to split "03c Pass". | README module map; 03b v0.3; 03c v0.1 |
| R-3 | **A dark station screen hands over to the Pass tablet:** after `kds_offline_ms` the station's Now / Next show on the Pass tablet(s) of its point in a "<station> screen offline" section with Start / Done, and managers get an alert; paper also prints if a printer is attached (03c). | 03b v0.3 §3.6 |
| R-4 | **OQ-2 list extended** with: 00 `apps/hub/src/ws/server.ts` (`ConnectedSession.stationId`), 01d `AlertDetailsBase` fields + `AlertRaised` v3 (03a AD-36 pattern), 00 `apps/hub/src/lib/boot.ts` (print queue resume, worker after listen; 03c). | 03b §4.5 H-9, D-2; 03c §4.5 H-11 |
| R-5 | **Suspect tickets reprint by themselves:** a job acked while the printer reported an error is marked suspect and re-queued as REPRINT when the printer reports clean (a duplicate is acceptable, a missing ticket is not, D24). | 03c v0.1 D4 |
| R-6 | **OQ-4:** Reprint lives on the Pass card (only where the station has a printer); reprint on 02b's order screens stays a 02b follow-up (no task 0f). | 03c v0.1 §3.9 |
