# 03b KDS + Pass — Module Spec

| | |
|---|---|
| Doc | Module spec, **v1.0.8 — APPROVED (owner rulings 2026-11-13 06:02 PKT, "Sab rec": 03b / 03c client gap sweep Q-44–Q-50, all Rec (a))**. v1.0.7 — APPROVED (owner ruling 2026-11-12, "sab rec" on the PR #84 review: Q-P22b). v1.0.6 — APPROVED (owner ruling 2026-11-12 11:00, "teeno Rec": Q-20 of the design brief). v1.0.5 — APPROVED (owner rulings 2026-11-12, "sab Rec": B2-3, P18-1). v1.0.4 — APPROVED (owner rulings 2026-11-11: B3-3 (a), B3-4 (a)). v1.0.3 — APPROVED (owner rulings 2026-11-11: B4-1, B2-2, B3-2, all (a)). v1.0.2 — APPROVED (owner, 2026-11-11; wording: 02b's bump is v1.0.6, AD-15; AD-9: 0012 also bumps `config_version`). v1.0.1 — APPROVED (owner, 2026-11-11, 16:23 PKT; gap-sweep rulings G-1, G-3, G-4, G-5, G-10, G-13, G-14, `docs/plans/03b-03c-gaps.md`). v1.0 — APPROVED (owner, 2026-11-11, 13:40 PKT; approved together with 03c v1.0). Content = v0.4.1, unchanged, plus v1.0.1's marked wording fix. v0.4.1 was v0.4 + the re-check's wording fixes (`docs/reviews/03b_v0.4_03c_v0.2_recheck.md`, APPROVE WITH WORDING FIXES; §12.8). Screen first (owner R-1–R-6, `docs/stories/03b-g1-decisions.md` §4); printing is **03c** (`03c_Printing_Spec_v0.2.md`). v0.3 closed G4 run 2 (§12.6); v0.4 closes the targeted check `docs/reviews/03b_v0.3_03c_v0.1_targeted_check.md` (verdict FIX) in §12.7. Re-check done (5 of 6 rows closed; M-3 is 03c's). |
| Was | `03b_KDS_Printing_Spec_v0.2.md` → `03b_KDS_Pass_Spec_v0.3.md` (history in git: `401ab58`, `3baab71`, `1c4f9ee`). |
| Depends on | Foundation **v1.11**, 00 **v1.8**, 01a **v2.3**, 01b **v1.7**, 01c **v1.1.2**, 01d **v1.2.1**, 02a **v1.1.4**, 02b **v1.0.3** (APPROVED 2026-11-10 on `module-02b`; + its code once merged), 03a **v1.2**. Target versions after approval: §4.5 (one bump per target, shared with 03c). |
| Read by | 03c Printing (presence, station view, device roles, Pass client), 05, 07. |
| Inherits | Shared Standards from Foundation v1.11 §6. Not redefined here. |
| Inputs | `03b-g0.md`; `03b-g1-decisions.md` (Q1–Q13, G1-1–G1-18, owner rulings R-1–R-6); run 1 and run 2 reviews; 03a v1.2 §4.3 To 03b; 02b v1.0.2 §4.3 To 03b, O14; 02a v1.1.4 §4.3 To 03b; 01d v1.2.1 D-2, N-2, A3, A12, A14; `01d-g0-decisions.md` K1–K13. |
| Rigor | T2 (CLAUDE.md). |

### Changelog

| Version | Date | Change |
|---|---|---|
| **v1.0.8** | 2026-11-13 | Owner rulings of the 03b / 03c client gap sweep ("Sab rec", 06:02 PKT; record `docs/plans/03b-client-gaps.md`, G3b-1, -4…-8, -16), marked "⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-nn)". **Q-44** §3.3, §3.7, §3.8, §6.17: `LanesSet` → every staff and station socket; `StationScreenSet` → the station sockets of its station; `BusinessDayOpened` / `BusinessDayClosed` → also station sockets (open: contradicts the 01a §4.5 audience table and test 73; owner ruling Q-62 pending, §6.17); `DeviceRoleSet` takes effect at the next sign-in / reconnect (0 statements). **Q-45** §3.4, §6.15: `point_view.stations[].screenless` from the screen-station map (memory). **Q-46** §3.4, §6.15, §6.16: `PointLine` and `point_lines` lines carry `group_id` and `serve_mode` (engine memory); the Pass computes Ready / HOLD itself. **Q-47** §3.4, §6.16: details re-sent on `TableMoved` / `TablesMerged` / `SeatingSplit` for the held lines of that seating's orders (≤ 2 + 1 statements per hook, `seating_orders` read). **Q-48** §3.8, §6.12: `kds-config` gains `points[]` and `name` on warnings (memory). **Q-49** §3.3, §3.4, §6.17: "exact" dropped (02b v1.0.11 H1 also sends the four kitchen-progress types to every staff socket and kiosk); KDS and Pass ignore an event whose `order_item_id` they do not hold. **Q-50** §4.2, §8: the client slot contract gains `registerLineAction` (ctx `{ station_id, has_printer, surface }`), async `run`, `subscribeFrames`, `notifySlots` (+ 03b-side `publishFrame`, `onSlotsChanged`). Also §8 names the KDS entry `/kds/` (Q-42, 00 v1.9.2 §8.2) and the admin page `/admin/kitchen-screens/` (Q-43). New tests 54, 55, 67, 68, 76; #74 reworded. No event schema, migration or error code change. Code: `docs/plans/03b-hub-gaps-plan.md` (HK1–HK6), `docs/plans/03b-client-plan.md`. |
| **v1.0.7** | 2026-11-12 | Owner ruling **Q-P22b** (a) ("sab rec", PR #84 review), marked "⚠️ Changed by v1.0.7 (owner 2026-11-12, Q-P22b)": §3.10, §6.15 — `station_notice { kind: 'output', has_printer }` also reaches the point's Pass tablets that hold the station's takeover view (same set as the `archived` notice); `point_view.takeovers[]` bodies carry `has_printer` (they are `kds_station` bodies) and the Pass updates it from the notice. Code: task P0.23. |
| **v1.0.6** | 2026-11-12 | Owner ruling **Q-20** ("teeno Rec", 11:00; `docs/design/inventory/03b-03c-design-brief.md` §7), marked "⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-20)": the `kds_station` catch-up body carries `has_printer: boolean` (output mode `both` / `printer` with an active printer, from 03c v1.0.6 `stationHasPrinter`), so the KDS shows its Reprint action only when true; statements 3 → 4; `station_notice` gains `kind: 'output'` with `has_printer` for changes. Q-14 and Q-18 are 03c-only (03c v1.0.6). Code: task P0.22. |
| **v1.0.5** | 2026-11-12 | Owner rulings ("sab Rec", 07:39), marked "⚠️ Changed by v1.0.5 (owner 2026-11-12, <id>)". **B2-3** §3.2, §3.3, §6.14: accepted — an undone `auto_done` line holds its station until a tapped Done (03a v1.2.2 as built); the KDS line view carries `done_undone: true` from the engine line so the KDS shows a clear "tap Done" cue (client text later). **P18-1** §4.5 row D-6 (01d v1.2.4): `always_on` reaches point-bound tablets only when the point is active. Code: task P0.21. |
| **v1.0.4** | 2026-11-11 | Owner rulings (a), marked "⚠️ Changed by v1.0.4 (owner 2026-11-11, <id>)". **B3-3** §6.16 `kds_lines` / `point_lines`: a line's details are sent once per id per socket set **and again whenever its live units change** (`ItemRemoved` / `ItemVoided` with `units`, `LineWeightSet`), so `LineDetail.options`' scaled quantities stay current (§4.4); the hook stays 2 statements per commit that adds or changes lines. **B3-4** §4.4, §4.5 rows T-3, O-2: a return line (02b `ReturnToKitchen`, fix and remake) copies the served line's plain options and its option children with no station (03a v1.2.3, 02b v1.0.8), so the remake ticket and KDS show them. Code: P0.16 (#47, B3-3), P0.20 (B3-4). |
| **v1.0.3** | 2026-11-11 | Owner rulings (all (a)), each marked "⚠️ Changed by v1.0.3 (owner 2026-11-11, <id>)". **B4-1** §7 Performance: the `pass` fold of every settling event type (`ItemServed`, `ItemReturned`, `OrderCancelled`, `ItemRemoved` with or without units, `ItemVoided`) and of `ReadyToServe`, `Handover` is 3 statements fixed per event, whether or not anything settles; every other fold ≤ 2; **R-3** §5 note, #30: a rebuild may set `settled_at` earlier than live for lines settled by partial units, and `settled_at` is only read with `IS NULL`. **B2-2** §3.2 UndoDone: at an `auto_done` station an undone line is never inferred Done again (03a v1.2.2, `ENGINE_STATE_VERSION` 4); it waits for a tapped Done. **B3-2** §4.4 `LineDetail.options`: option children with no station **and** plain `ItemAdded.options` (02b v1.0.7 `order_lines.options_json`), each `"name"` or `"<q> x name"`. Code: tasks P0.16 (options), P0.17 (auto_done undo). Further owner rulings (a), same day: **B2-1** §3.2 DoneItem step 5 — at a batch station Done marks every line of the load that step 3's rule admits (cooking, or fired added from stock / at an `auto_done` station; the load is one unit, 03a D14); **B4-3** §3.5 Handover step 2 — "active" = in the directory **and** an open staff session, §6.8 statements 4 → 5 (dine-in; 4 otherwise); **B1-1**, **B1-2** §4.5 rows D-4, D-5 (01d v1.2.3: `SendTestAlert` point id check, `always_on` reaches point-bound tablets); **P15-1** §4.5 row A-2 (01a v2.4.3: Ready window and KDS offline boxes in seconds). **B4-2** §3.5 Handover step 3, §6.8, test 24a: with no list, at most 40 done lines in line order, result `remaining`; a second call takes the rest. |
| **v1.0.2** | 2026-11-11 | v1.0.2 (2026-11-11, owner): wording — 02b's bump is v1.0.6 (AD-15); no behaviour change from that. Every place that named 03b's 02b bump as v1.0.4 now names v1.0.6, marked "⚠️ Changed by v1.0.2 (AD-15): was v1.0.4" (02b took v1.0.4 and v1.0.5 itself on `module-02b`). **AD-9 (owner 2026-11-11):** §4.5 A-1 — the cloud migration `0012_kds_settings.sql` also bumps `config_version` for every branch with a settings row, so hubs receive the new keys (01a v2.4.1 marker). |
| v0.1 | 2026-11-11 | First draft (KDS + Printing) from G0 + G1. |
| v0.1 (owner answers) | 2026-11-11 | OQ-1 printers USB + LAN; OQ-2 upstream rows as tasks 0a–0e. |
| v0.2 | 2026-11-11 | G4 run 1 closure (14 M · 23 m · 15 n). |
| **v1.0.1** | 2026-11-11 | Owner-approved gap-sweep rulings (`docs/plans/03b-03c-gaps.md`, all Rec (a)), each marked "⚠️ Changed by v1.0.1 (G-n)". **G-14** §6.21: alert step targets written as `{ kind: 'managers' }` (was the bare string `'managers'`); no behaviour change. **G-3** §3.5 step 2, §6.11, §11 task 15: receiver coverage through 02b's pure `orderCovered` (02b task P0.14) instead of `checkOrderScope`; no behaviour change. **G-4** §3.7, §11 task 10: the station session's own-station check is inline, `requireStationInScope` not used; no behaviour change (the spec's intent; calling the helper would have checked nothing). **G-13** §3.6 step 1, §6.20, test 43: `offline_since` starts at the first `kds_presence` pass, not at listen — behaviour change: the grace starts up to one tick (500 ms) after listen. **G-10** §6.17: audiences are additive — behaviour change: five line events and `StationCapacitySet` also reach sockets outside the listed set (already delivered by 02b / 03a). **G-1** §3.8, §4.1, §11 task 6: 03b registers 01d's `point` target resolver — behaviour change: `ready_to_serve`'s last step reaches the point's tablets (it had no resolver), and 01d's `SendTestAlert` to a point is raised instead of `422 points_not_available`. **G-5** §4.5 B-1, §11 task 0a: no migration (no CHECK on permission names exists); no behaviour change. |
| **v1.0** | 2026-11-11 | **APPROVED by the owner** (with 03c v1.0, so task 0d applies one bump per target for both). No content change from v0.4.1. |
| v0.4.1 | 2026-11-11 | Re-check wording fixes (§12.8): a dark station whose last KDS is revoked ends its takeover and closes its alert `obsolete` (N-2); lane mirror rule restated by append order (N-4); the "approved later" sentence replaced by an explicit fallback (N-5); the 02b v1.0.4 bump waits for `module-02b` (N-6); Cook `reprint-ticket` in task 0a and test 60 (N-7). |
| v0.4 | 2026-11-11 | **Targeted check closure (§12.7):** settle folds idempotent, `open_lines` counted, never below 0 (M-1); **dark only for a station with a paired screen**, screenless stations never alert (M-2); `LanesSet` kept for 03b's own lane changes, tie rule for foreign ones (m-1); takeover frames by the fires-tick `tx.onCommit` pattern (m-2); `GiveMeMore` open to `run-pass` (m-3); D-2 freezes `AlertDetailsBaseV2` (m-4); one bump per target shared with 03c, 02b dependency v1.0.3 (m-5); Cook gets `reprint-ticket` by default (m-6, for 03c's Pass reprint); task 0b split, 20 before 18 (m-8); client slots for 03c (m-10); `handoversDue` returns unsettled lines (m-11); catch-up note corrected (m-12); n-2, n-3, n-6, n-7, n-8, n-10. |
| v0.3 | 2026-11-11 | **Owner R-1–R-6:** screen first, printer optional; **split** — every printing rule, table, command, kind and test moves to **03c Printing v0.1**; a dark screen hands its station to the Pass tablet (§3.6). **Run 2 fixes kept in 03b:** M-3 alert details (01d row D-2, `AlertRaised` v3); m-3 lanes mirror every `StationCapacitySet`, no 03a file edit; m-4 receiver scope = 02b's `checkOrderScope`; m-5 Ready closes on its own lines; m-6 `closeMany` / `raiseMany`; m-7 settings in `engine_settings`, optional with hub defaults; m-8 config names; m-9 admin paths; m-10 hub-minted `handover_id`; m-11 task order; n-2, n-3, n-5, n-6, n-9, n-10, n-11. Closure §12.6. |

---

## §1. Header

### 1.1 Stories covered

- **E3 "Kitchen Display Screen"** (P1): AC1 (station view; all stations = the assembler view per point), AC2–AC3 restated by 03a's chef-screen contract, AC4 (Start / Done one tap, inline confirm only), AC5 (sound), AC6 (late colouring; the slip warning is 03a's), edge cases (two-tap, undo, archived station).
- E5 power: a dark screen does not stop its station (§3.6).
- README carried rows :170, :190, :199, :237, :240 #1–#4, #6–#8; 02b §4.3 To 03b ("write `Handover`"), O14; 01a §4.4 :405, :406, :433; 01d D-2, N-2, G1-12b, G1-21.4; OPEN-QUESTIONS 00 Q10.
- **Moved to 03c:** E3 "Ticket printing", E0 Orders AC4 (reprint), E0 Templates AC2, README :200, :211, :240 #5, 01a :398 (on paper; the KDS shows the note here), 02b's ticket and CANCELLED-slip rows, F §5.8 step 5, D24.

### 1.2 In scope

Station commands (`StartItem`, `DoneItem`, `UndoDone`, `GiveMeMore`); the station view on the KDS (wall screen, station session); the assembler view on the Pass tablet (staff session, `run-pass`); Ready to serve, Undo ready, Handover, Served card; **screen presence, the `kds_offline` alert and the Pass takeover of a dark station**; lanes (Off / On, labels); device roles (point binding, lane label); station screen settings (sound volume); the archived-station warning; "Day not started"; the hub admin "Kitchen screens" page.

### 1.3 Out of scope

Everything printed (03c); the engine (03a); `MarkServed`, release / boost / return (02b); headless point devices, button stations, pager, lane claims (01e); audio callouts (P3); per-zone walk times (K10); training mode (E13).

### 1.4 Decisions log

| # | Decision | Source |
|---|---|---|
| P3 | Every station runs on a screen; output to paper is 03c's optional accessory. | Q3, R-1 |
| P5 | KDS and Pass taps disabled while the hub is unreachable; 03b commands are not queueable. | Q5 A |
| P6 | Line display: identifier big, item × units, options, notes, mark reason; Now "cooking m:ss" / red "late +N"; Next "in m:ss"; no clock or promise times. | Q6 A |
| P7 | Chime on entering Now; strong sound for RETURN / boost / expedite; no late sound; volume from the hub admin only. | Q7 A |
| P8 | One permission **`run-pass`** (kitchen group, scope `branch`; defaults Owner, Manager, Cook). | Q8 A |
| P11 | Lanes: Off / On only. | Q11 A |
| P12 | "Coming up" count strip; lines never merged. | Q12 A |
| P15 | Upstream rows are tasks 0a–0e of 03b's plan (OQ-2), extended by R-4. | OQ-2, R-4 |
| P16 | **Screen first:** no 03b rule depends on a printer; 03c reads 03b, never the reverse. | R-1, R-2 |
| P17 | **Dark screen → Pass takeover + manager alert** (§3.6). | R-3 |
| D5 | Ready / Undo / Handover per **order per point**, on the order stream. | G1-9 |
| D6 | Re-target with a table-scoped dedupe key; one `closeMany` + one `raiseMany` per pass. | G1-11; run 1 M-7, run 2 m-6 |
| D7 | A line's point = `EngineLine.point_id`; Now and every "open line" read the engine. | run 1 M-8, M-14 |
| D9 | **Presence** is computed once, by 03b's `kds_presence` tick, and exported (`stationPresence()`) — 03c's paper fallback reads it. | R-2, R-3 |
| D10 | `station_lanes` mirrors **every** `StationCapacitySet`: exact from 03b's own `LanesSet`, by inverse with a tie rule for a foreign lane change, `custom` for a manager override; 03b never edits 03a code. (G1-7's `LanesSet` stays.) | run 2 m-3; check m-1 |
| D11 | **Screenless station** = no paired, unrevoked `kds` device. It is never dark: no alert, no takeover; its lines live on the Pass (§3.4). | check M-2 |
| D12 | 03c extends 03b's clients only through two **slots** 03b exposes (line tag, card action); 03c's code stays in its own folders. | check m-10 |

---

## §2. Existing architecture that must not change

- 00: `POST /commands/:name` (device) and `POST /admin/commands/:name` (admin) with `sessionKind` matching the route (`commands/route.ts:53-56, :69`), `GET /queries/:resource` and `GET /admin/queries/:resource` (`queries/registry.ts:89-92`); `stationScoped`; a station session on a non-`stationScoped` command → `403 PERMISSION_DENIED { session_kind: 'station' }` (`route.ts:344-351`); D32 idempotency; single writer (projections apply inside `append`, `engine-host/writer.ts`); `registerProjection` (`apply(tx, event, mode)`, applied per event in **registration order**, `projections/registry.ts:47-50`; catch-up per projection in that order, `:89-111`); `registerCatchUp` (`SocketCtx` has `kind`, `stationId`; admin sessions have no WebSocket); `registerEventAudience` (synchronous); `WsHub.connectedSessions()` / `alertSockets()` / `sendToSessions` / `sendToStaff`; `PONG_MS` 30 000; station sessions (M30); `StaffDirectory.resolve`, `floorsOf`; `ids`; `devices.point_id` / `devices.lane_label` (H-5, H-6).
- Foundation §4.2 stage guard.
- 01a: `branchConfig()` — stations (`name`, `point_id`, `completion_mode`, `capacity`, `lane_units`, archived), `points[]` (`name`), `floors[].tables[]` (`table_id`, `name`) (`packages/events/src/config.ts`); snapshot V4 `engine_settings` (`served_estimate_ms` nullable, `config.ts:313-319`); `openDayStartMs`; `BusinessDayOpened`; `onBranchConfigApplied` (hooks run inside the apply transaction; a throw fails the apply, `sync/branch-config-holder.ts:12, :39-41`); `hub_time`.
- 01b: `resolve` (scopes `branch`, `own_tables`, `my_floors`), `PERMISSION_CATALOGUE`, `default_key` grants (`apps/cloud/src/modules/staff-roles/default-roles.ts`).
- 01d: `defineAlertKind` (startup validation, `alerts/kinds.ts`), `alerts.raise` / `raiseMany` / `close` / `closeMany` / `tickCtx` (dedupe on an open `(kind, dedupe_key)`, `raise.ts:157-176`; data-dependent counts use the `…Many` forms, 01d :566), `registerTick` (`due(db, state, now)` read-only, engine reads allowed; `intents` re-read inside `writer.run`; `alerts/tick.ts`), `AlertDisplaySchema` (`table_code`, `point_code`, `requester_name`, `device_name`, `kind_label_key`), `AlertDetailsBase` (stripping object; widened by D-2), A3, P-1 (chip `T{table_code}` only for an all-digit value).
- 02a: `currentTableOf`, `tableOwners`.
- 02b (`module-02b`, after merge): projection `orders` (`order_lines`, `orders`), `scopedOrders(db, order_ids)` and `checkOrderScope` (`orders/commands/mark-served.ts:33-70`), `ORDER_NOT_FOUND`, `ITEM_WRONG_STAGE { stage: 'out_of_engine' }`, events `ItemRemoved { units? }`, `ItemVoided`, `ItemReturned`, `ItemServed`, `OrderCancelled`, `OrderBoosted`, `ItemsReleased`.
- 03a: `@pos/engine` `stationView`, `stationPlan`, `groupReadiness(state, order_id, now)`, `pullEarly(state, station_id, n, now)`, `lateStartShift`, `capacityForLanes`, `stockEffects`, `liveInterval`; `EngineLine` (`point_id`, `prep_ms`, `cook_ms`, `from_stock`, `stage`, `done_at`, `started_at`, `fired_at`, `return_of`, `load_id`, `mark`); `station_plan`; events `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `FireDispatched`, `ReservationsShifted`, `StationCapacitySet { reason: 'manager' | 'lane_off' | 'lane_on' }`, `StockConsumed`; `SetStationCapacity` as built, with exported `liveStation` and `requireStationInScope` (`commands/set-station-capacity.ts:67, :75`); `capacity_override` cleared at `BusinessDayOpened` (03a §3.10); the `fires` tick.

---

## §3. Domain rules

### 3.1 Words and identity

- **Line** = an engine line (03a §3.3).
- **Point of a line** = `EngineLine.point_id`; `null` → the point of the line's station. **Pass tablet** = a `tablet` device with `devices.point_id` set.
- **Identifier:** dine-in → the current tables' names (ids from `currentTableOf`, names from `floors[].tables[]`), primary first, each prefixed "T" only when the name is all digits (01d P-1): "T4 + T5", "Family 2"; takeaway → `#` + token, with the business date when from an earlier date ("#12 10 Nov"); parking → "PARKING LEB 1234 SEDAN".
- **Screen station** = a station with at least one paired, unrevoked `kds` device (`devices.station_id`; memory set built at boot with 1 statement, refreshed on pairing approval and `DeviceRevoked`). **Screenless station** = none (03c `printer` mode, 01e button stations).
- **Dark station** = a **screen station** with no connected screen (no station session socket with its `stationId`) for `kds_offline_ms` while it has lines in Now or Next (§3.6). A screenless station is never dark.

### 3.2 Station commands (`StartItem`, `DoneItem`, `UndoDone`, `GiveMeMore`)

Caller: a **station session** for a line of its own station, or a **staff session** holding `run-pass`. Station data come from the in-memory engine state (no SQL). Common step 1: `state.lines[id]` absent → `404 ORDER_NOT_FOUND { order_item_id, order_id: null }`; the line's order out of the engine → `409 ITEM_WRONG_STAGE { order_item_id, stage: 'out_of_engine' }`. Common step 2: station session and `line.station_id ≠ session.station_id` → `403 PERMISSION_DENIED`.

**`StartItem { order_item_id }`**
3. Stage `added` **and fired** → else `409 ITEM_WRONG_STAGE { order_item_id, stage }`; `single_tap` → `{ stage: 'cooking' }`.
4. Batch station: every fired `added` line of the same `load_id` (AD-18).
5. Drafts: `ItemStarted { order_item_id, started_at: now, source: 'tap' }`; `lateStartShift` → `ReservationsShifted`; `stockEffects` (array form).
6. Append. Result `{ started }`.

**`DoneItem { order_item_id, confirm?: boolean }`**
3. Stage `cooking` → ok; `added` and fired → ok only if `line.from_stock` or the station is `auto_done`; else `409 ITEM_WRONG_STAGE { stage: 'added' }` (client: inline "Tap Start first"); later stages → `ITEM_WRONG_STAGE`.
4. Only when `started_at` is set: `now − started_at < 0.5 × line.cook_ms` and `confirm ≠ true` → `422 ITEM_DONE_CONFIRM_REQUIRED { order_item_id, elapsed_ms, cook_ms }`, nothing written (every completion mode; inline second tap, never a modal).
5. Batch: every `cooking` (or from-stock fired `added`) line of the load. Drafts `ItemDone { …, source: 'tap' }` + `stockEffects`. ⚠️ Changed by v1.0.3 (owner 2026-11-11, B2-1): at a **batch** station, Done marks **every line of the load that step 3's rule admits** done — `cooking`, or fired `added` from stock / at an `auto_done` station — because the load is one unit (03a D14); lines that left the load (removed, voided, out of the engine) are skipped. Matches b8 as built (#19, reading 6).
6. Append. Result `{ done }`. A client that gets `ITEM_WRONG_STAGE { stage: 'done' }` right after its own Done shows no error.

**`UndoDone { order_item_id }`**
3. Stage `done` and `now − line.done_at ≤ UNDO_DONE_MS` (30 000, `@pos/domain`) → else `409 ITEM_UNDO_WINDOW_CLOSED { order_item_id }` (an inferred Done is undoable only within 30 s of its `done_at`). ⚠️ Changed by v1.0.3 (owner 2026-11-11, B2-2): at an `auto_done` station, after `ItemDoneUndone` the fires tick never infers Done again for that line (03a v1.2.2 §3.6.1 step 3: a per-line flag set by `ItemDoneUndone`'s fold, cleared by nothing); the line waits for a tapped `DoneItem`, so an inferred Done stays undone once undone. A line in a Handover → `409 ITEM_WRONG_STAGE { stage: 'handed_over' }` (1 statement).
4. Batch: every `done` line of the load inside the window.
5. Drafts `ItemDoneUndone` per line; if the line is in an **open Ready** (1 statement, `pass_ready_lines` ⋈ `pass_orders`): `ReadyToServeUndone { order_id, point_id, alert_id }` + `alerts.close(…, 'undone')`.
6. Append. Result `{ undone, ready_undone }`.

**`GiveMeMore { station_id, n?: 1–10 }`**: a station session for its own station only, or a `run-pass` staff session for any station (the Pass, a takeover); unknown / archived → `404 STATION_NOT_FOUND`; `pullEarly(state, station_id, n ?? 1, now)`; `null` → `{ pulled: null }`, nothing written; else the `FireDispatched { reason: 'pulled' }` draft (+ inferred `ItemStarted` at `single_tap`). Result `{ pulled }`.

All four: not queueable; station-session events carry `actor_id = null` and the KDS `device_id`.

### 3.3 Station view (KDS)

- **Now** = `stationView(state, station_id, now).now` (engine) + done lines inside `UNDO_DONE_MS` kept by the client; **Next** = `station_plan` lines with `frozen: true`; **Later: N** = `frozen: false`, counted. 03a's contract: append at the bottom, Done removes, nothing visible reorders; `mark` and `return` lines on top in red with their reason; `moved` keeps its row with a red tag and its new time.
- **Details:** catch-up part `kds_station` (§6.14) and frame `kds_lines` (§6.16), shape `LineDetail` (§4.4); an id without details shows a placeholder row in place. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-49): a line event whose `order_item_id` the KDS does not hold (not in its Now / Next / done-undo set) is ignored — it never creates a row (the hub may send such events wider, §6.17).
- **Time:** Now started → "cooking m:ss"; Now not started → "waiting m:ss" since `fired_at`; late (red "late +N min") when `now > planned_done_ms` (= `started_at + cook_ms`, else `fired_at + prep_ms + cook_ms`). Next → "in m:ss" to `fire_ms`. Clock corrected by `hub_time`.
- **Coming-up strip:** live units by item name over Now + Next, largest first, max 6; client-side.
- **Completion modes:** `two_tap` (from-stock: Done only), `single_tap`, `auto_done`. ⚠️ Changed by v1.0.5 (owner 2026-11-12, B2-3): accepted — at an `auto_done` station a line whose Done was undone stays `cooking` and **holds its station until a tapped Done** (03a v1.2.2 `done_undone`, as built); the KDS line view carries `done_undone: true` (copied from the engine line) and shows a clear "tap Done" cue on that row (client text later).
- **Config:** refetch on `BranchConfigApplied` (01a :433).
- **Day not started:** before `BusinessDayOpened`, "Day not started", no button (00 Q10). ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-44): `BusinessDayOpened` / `BusinessDayClosed` frames reach station sockets (§6.17; pending owner ruling Q-62 on the 01a §4.5 table — until then the KDS gets the day state at its next catch-up), so an open KDS leaves or enters "Day not started" live and sees the day-open lane reset without a reconnect.
- **Archived station:** open lines keep rendering under "Station archived — finish open tickets" (§3.10).
- 03c adds a `printed` tag on lines whose ticket printed (its own frame, §03c); the KDS renders it when present.

### 3.4 Assembler view (Pass tablet)

- Every open order with a live engine line whose point is this point; one card per order, oldest first, identifier big; per line: station name, item × units, stage (waiting / cooking / done / handed over). Served / removed / voided / returned lines drop off; the card drops off when none is left or the order leaves the engine.
- **Readiness:** `groupReadiness(state, order_id, now)` filtered to this point's lines: "Ready" (green) when no sync line here is `added` / `cooking`; HOLD AT PASS hint (amber) when a done line waits for a sibling — never a block (K4). ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-46): the hub sends no readiness field; each Pass line carries `group_id` and `serve_mode` (§6.15, §6.16) and **the Pass computes Ready / HOLD itself** with the same rule from the live stages it holds; an `ItemsReleased` event sets the `serve_mode` of its `released` and `expedite` lines to `'immediate'` (each leaves its group, as the engine does; the Pass does not track the new group ids until the next catch-up — an immediate line needs none).
- Buttons: Ready to serve, Hand over (receiver tiles), Undo (30 s), Start / Done for lines of **screenless** stations, Lane Off / On. A card has an action **slot** (D12): 03c fills it with Reprint where a station has a printer. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-45): "screenless" = `point_view.stations[].screenless` (§6.15); Start / Done and the "No screen" chip show only for those stations.
- **Takeover sections** (§3.6): one per dark station of this point.
- Data: catch-up `point_view` (§6.15), frame `point_lines` (§6.16), event frames (§6.17). ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-49): an event whose `order_item_id` is not a line the Pass holds is ignored (a Pass tablet is a staff socket and also gets the kitchen-progress events of other points, §6.17). ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-47): after a `TableMoved` / `TablesMerged` / `SeatingSplit` the card identifier follows the re-sent details (§6.16), e.g. "T4" → "T9" live.

### 3.5 Ready to serve, Handover, Served card

**Dedupe key:** `order_id + ':' + point_id + ':' + (table_id ?? '-')`.

**`MarkReadyToServe { order_id, point_id }`** (`run-pass`)
1. Point exists, not archived → else `404 POINT_NOT_FOUND`. Order in the engine → else `409 ORDER_NOT_IN_ENGINE`.
2. Ready lines = the order's live engine lines at this point, not served, not handed over (engine + 1 statement `handover_lines`). None → `409 ITEM_WRONG_STAGE { stage: 'served' }`.
3. Open Ready for `(order_id, point_id)` (1 statement) → `200 { already: true, alert_id }`.
4. Target: dine-in → `{ kind: 'table_team', table_id: <current primary table>, depth: 'direct' }`; takeaway / parking → `{ kind: 'person', staff_id: orders.placed_by }` (rescued by step 2 if that person has no route; accepted).
5. `alerts.raise(ctx, { kind: 'ready_to_serve', subject: { stream_type: 'order', stream_id: order_id }, target, values: { order_id, point_id, table_id: table_id ?? '', window_ms: ready_window_ms }, display: { table_code: <primary table name if all digits> | null, point_code: <point name>, kind_label_key: 'alert.ready_to_serve' }, details: { identifier: <§3.1 text> }, dedupe_key })` — `details.identifier` survives append by row **D-2** (`AlertDetailsBase` + `AlertRaised` v3), so the takeaway card shows its token.
6. Append `ReadyToServe { order_id, point_id, order_item_ids: <ready lines>, table_id | null, alert_id }`. Result `{ alert_id }`.

**`UndoReadyToServe { order_id, point_id }`** (`run-pass`): open Ready, `now − ready_at ≤ UNDO_DONE_MS`, no Handover since → `ReadyToServeUndone` + close `undone`; else `409 PASS_UNDO_WINDOW_CLOSED { order_id, point_id }`.

**`Handover { order_id, point_id, receiver_staff_id, order_item_ids? }`** (`run-pass`)
1. As `MarkReadyToServe` step 1.
2. **Receiver scope = 02b's `MarkServed` rule** (`module-02b orders/commands/mark-served.ts:51-70`, `checkOrderScope`) applied to the receiver's `resolve(receiver, 'mark-served')`: `branch` → covered; dine-in `own_tables` → the receiver holds the order's **open** seating (`scopedOrders`); dine-in `my_floors` → a table of the seating is on the receiver's floors (`currentTableOf` + `floorsOf`); takeaway / parking under `own_tables` / `my_floors` → `placed_by = receiver`. Receiver not active, no grant, or not covered → `422 PASS_RECEIVER_INVALID { receiver_staff_id }`. ⚠️ Changed by v1.0.3 (owner 2026-11-11, B4-3): **active** = the receiver is in the directory (`is_active`) **and** has an open staff session (signed in on some device; 1 statement on 00's `sessions`); either missing → `PASS_RECEIVER_INVALID`. Built in b15 (#35). A parity test per scope × order type pins it to 02b. ⚠️ Changed by v1.0.1 (G-3, owner 2026-11-11): the rule is 02b's pure `orderCovered(order, { staffId: receiver, resolution: resolve(receiver, 'mark-served') }, tables, floorsOf)` (0 statements; `checkOrderScope` wraps it, 02b task P0.14); 03b calls `orderCovered`, never `checkOrderScope` (bound to the calling session); not covered → `PASS_RECEIVER_INVALID`.
3. Lines = `order_item_ids` or every **done** line at this point not handed over; each must be at this point, `done`, not handed over, not served → else `409 ITEM_WRONG_STAGE { order_item_id, stage }`; empty → `ITEM_WRONG_STAGE`. ⚠️ Changed by v1.0.3 (owner 2026-11-11, B4-2): with **no** `order_item_ids`, take the **done, not-handed-over** lines at this point in line order (`added_at`, `order_item_id`), **at most 40** (the `Handover` event maximum, AD-12); the result gains `remaining: number` = done lines at this point still not handed over after this one (0 normally), and a second `Handover` takes the rest. A named list stays 1–40, validated as before.
4. `handover_id = ids.next()` (hub-minted; retries dedupe by D32 `command_id`).
5. No open Ready → also append `ReadyToServe { …, alert_id: null }` first.
6. Raise `served_card` to `{ kind: 'person', staff_id: receiver }`, dedupe `handover_id`, display `{ table_code, kind_label_key: 'alert.served_card' }`, details `{ identifier }`.
7. If no Ready line of the order at this point is left un-handed and unserved → close the open Ready `done`.
8. Append `Handover { handover_id, order_id, point_id, receiver_staff_id, order_item_ids, alert_id, ready_alert_closed }`. Result `{ handover_id, served_card_alert_id }`.

**Closing (tick `pass_closures`, §6.19):** an open **Ready** closes `done` when every line of **its own** `order_item_ids` (`pass_ready_lines`) is settled — served by any source (a waiter's own `MarkServed` with no Handover included), removed, voided, returned, or its order cancelled — or when the order has left the engine (memory check). Lines added to the order after the Ready do not keep it open. An open **Served card** closes `done` when its hand-over has no unsettled line (`handovers.open_lines = 0`).

**Settling** (projection `pass`, §5): `ItemServed`, `ItemReturned`, `OrderCancelled`, `ItemRemoved` with no `units` → settle the lines; `ItemRemoved { units }` / `ItemVoided { units }` → settle when the line's live units (`order_lines`, §5 note) reach 0. **Settling is idempotent:** it touches only rows with `settled_at IS NULL`, and `handovers.open_lines` is decremented by the number of `handover_lines` rows that statement actually changed — so a served line later returned or voided (settled twice by events) changes nothing the second time and never drives `open_lines` below 0. A fold that would still break the `CHECK` logs `kds.fold_skipped` and skips (total fold, R8).

**Re-target (tick `ready_retarget`, §6.18):** open Readies whose stored `table_id` is not the order's current primary table → one `alerts.closeMany(…, 'obsolete')` and one `alerts.raiseMany` (new table in the dedupe key) for the whole pass, then `ReadyRetargeted` per row. The new alert restarts its steps (accepted).

**Day close:** both kinds `expires_at_day_close: true`. The estimate (02b task 0e) keys on unsettled handed lines, not on the card (§4.2), so a card expired at day close does not stop the estimate.

### 3.6 Screen presence, `kds_offline`, Pass takeover (R-3)

**Tick `kds_presence`** (01d `registerTick`; `due` and the frame sends are memory only):
1. Presence: `connectedSessions()` filtered to `kind: 'station'`, grouped by `stationId` (00 row **H-9**: `ConnectedSession.stationId`, copied from `SocketCtx`) → connected stations. `offline_since[station]` in memory, initialised at the first `kds_presence` pass (⚠️ Changed by v1.0.1 (G-13, owner 2026-11-11): was "initialised at server listen (screens can only reconnect after listen)"; there is no listen hook, and the tick loop starts only after listen, `lib/boot.ts:236`, so the grace starts at most one tick later). The tick reaches `WsHub` through a per-db host bound at server build (the `engine-host/fires-tick.ts` `bindFiresTick` pattern), since `due(db, state, now)` gets no deps. Detection of a dead screen can take up to `PONG_MS` (30 s) plus `kds_offline_ms`; a socket alive with a dead display is not detected (accepted).
2. Only **screen stations** (§3.1) are watched. A screen station with lines in Now or Next (engine) whose `now − offline_since ≥ kds_offline_ms` becomes **dark**:
   - `intents`: `alerts.raise` kind `kds_offline` (dedupe `kds_offline:<station_id>`, details `{ station_name }`) to managers.
   - **Takeover start** by the fires-tick pattern (`engine-host/fires-tick.ts:200-225`): inside `intents`, `tx.onCommit` adds the station to the memory set `takeover_stations` and sends `station_takeover { station_id, active: true, view: <kds_station body> }` to the staff sockets whose device's point is the station's point — so nothing is sent if the raise rolls back. From then on 03b's audiences also deliver that station's line events to those sockets.
3. A dark station's screen connects → takeover **ends at once**; this transition writes nothing, so `due` sends `station_takeover { station_id, active: false }` and clears the set directly. The `kds_offline` alert closes `done` only after the screen has stayed connected for 60 s (one alert per outage; run 2 n-6).
4. A screen station with nothing in Now or Next never goes dark. A dark station whose Now / Next empties (every line done) **ends its takeover** (nothing to show) but keeps its alert until the screen is back 60 s or the day closes — the screen is still broken.
5. Screenless stations are never dark, never alert and never take over: their lines are already on the Pass (§3.4). A **dark station that becomes screenless** (its last `kds` device revoked, the natural manager action) → takeover ends as in step 3 and its `kds_offline` alert closes `obsolete` (next tick, via `intents`).
6. Export **`stationPresence()`** → `Map<station_id, { screenless: boolean, connected: boolean, offline_since: number | null, dark: boolean }>` (memory) — 03c's paper fallback reads it.

**On the Pass tablet:** a section "Tandoor screen offline" with that station's Now / Next (same rows as the KDS), Start / Done / Undo / Give me more under `run-pass`. If the point has no Pass tablet signed in, the alert is the only signal (and 03c's paper, if a printer is attached).

### 3.7 Lanes

- `lane_count` = `kds` devices of the station with a `lane_label`, not revoked (H-6), else 1.
- **`SetLaneState { station_id, lanes_on }`** (station session own station, or `run-pass` staff): `lanes_on` 1…`lane_count` → else `400 VALIDATION_FAILED`. Uses 03a's exported `liveStation` (engine numbers) and the same 4-line station-session cap check as `SetStationCapacity` (no 03a file edit). ⚠️ Changed by v1.0.1 (G-4, owner 2026-11-11): the station session's own-station check is inline (`station_id ≠ session.station_id` → `403 PERMISSION_DENIED`), next to the cap check; `requireStationInScope` is not called (it narrows only `manage-stations` `my_stations` and passes every station for a station session, whose `ctx.permission` is null). Was: "`requireStationInScope` is called only for a station session's own-station check; it reads the `my_stations` scope of `manage-stations` and is not used for `run-pass` (scope `branch`)." Appends, **in this order**, `StationCapacitySet { capacity_override: capacityForLanes(station, lanes_on, lane_count) (null when all on), previous, reason: 'lane_off' | 'lane_on' }` and then `LanesSet { station_id, lanes_on, lane_count }` (G1-7, exact). Same `lanes_on` as stored → no-op. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-44): `LanesSet` reaches every staff and every station socket (§6.17; counts are not secret, like `StationCapacitySet`), so the station's other lane screens and the Pass strip show the new `lanes_on` live. Row **T-1** records 03b as a second writer for lane reasons and `run-pass` as a second right for those reasons only.
- **Mirror (`station_lanes`, projection `kds_config`):** the fold sees one event at a time. **Every** lane-reason `StationCapacitySet` (03b's own, a KDS calling 03a's `SetStationCapacity` directly per 03a To 03b #4, 01e lane buttons) applies the inverse below; a following `LanesSet` in the same commit then sets `lanes_on` exactly (last write wins). Inverse: lane reasons → `lanes_on` = a `k` in 1…`lane_count` with `capacityForLanes(station, k, lane_count) = capacity_override` — `capacityForLanes` clamps, so several `k` can match: **ties → smallest `k` for `lane_off`, largest for `lane_on`**; no match → `custom`; `manager` → `custom`; null override → all on. `BusinessDayOpened` → all rows deleted. Station numbers from `branchConfig()` (memory; during a pending config apply the mirror may show `custom` until the next lane change — accepted). The fold is total.

### 3.8 Screen settings and device roles (admin session)

- **`SetStationScreen { station_id, sound_volume: 0–100 }`** → `StationScreenSet`; default 70 when no row. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-44): `StationScreenSet` reaches the station sockets of that station (§6.17), so its KDS uses the new volume on the next sound.
- **`SetDeviceRole { device_id, point_id?: string | null, lane_label?: string | null }`** → `DeviceRoleSet`; projection `device_roles` updates `devices.point_id` / `devices.lane_label` (H-6 rules: `lane_label` only on a `kds` device with a `station_id`, else `400 VALIDATION_FAILED`); unknown device → `404 DEVICE_NOT_FOUND`; unknown point → `404 POINT_NOT_FOUND`. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-44): `DeviceRoleSet` gets no audience; a device's new point / lane label **takes effect at its next sign-in or socket reconnect** (the next catch-up) — accepted.
- **Memory maps** `device_id → point_id` and `station_id → paired kds devices` (screen stations, §3.1): built at boot (1 statement), refreshed after `DeviceRoleSet`, pairing approval and `DeviceRevoked` commits.
- **`point` target resolver** (⚠️ Changed by v1.0.1 (G-1, owner 2026-11-11): 01d left it stubbed and no module registered it, so `ready_to_serve`'s last step could not resolve): 03b registers `registerTargetResolver('point', …)` — the unrevoked `tablet` devices with `devices.point_id` = the point and the staff signed in on them, 1 batch statement. 01d's `SendTestAlert` to a point then raises instead of `422 points_not_available` (01d test 17 follows).
- **Hub admin "Kitchen screens" page:** stations with their screens (connected / signed out / offline — signed-out Pass tablets from `alertSockets()`), lanes, sound volume; Pass tablets and their points; warnings (archived station with open lines; dark stations). ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-48): point names, the point picker and the archived-point / archived-station names come from `kds-config` itself (§6.12 `points[]`, warning `name`); the page has no other config read. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-43): the page is served at `/admin/kitchen-screens/` (00 v1.9.2 §8.2).

### 3.9 Permissions and scopes

| Action | Station session | Staff session (device) | Admin session |
|---|---|---|---|
| `StartItem`, `DoneItem`, `UndoDone`, `GiveMeMore`, `SetLaneState` | own station | `run-pass` (`branch`) | — |
| `MarkReadyToServe`, `UndoReadyToServe`, `Handover`, `GET /queries/pass-receivers` | `403 PERMISSION_DENIED { session_kind: 'station' }` | `run-pass` | — |
| `SetStationScreen`, `SetDeviceRole`, `GET /admin/queries/kds-config` | — | — | `manage-devices` |

`run-pass` (group `kitchen`, scope `branch`; defaults by `default_key`: `owner`, `manager`, `cook`) — row B-1, which overrides M29 / B17's "Cook has no permissions". Scope last (C8).

### 3.10 Config reactions

- ⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-20): **`station_notice { station_id, kind: 'output', has_printer }`** — sent by 03c after a `StationOutputSet` / `PrinterSaved` changes a station's `has_printer` (03c v1.0.6 §3.8), to that station's sockets; the KDS shows or hides its Reprint action. ⚠️ Changed by v1.0.7 (owner 2026-11-12, Q-P22b): **also to the Pass tablets of the station's point while the station is in `takeover_stations`** — exactly like the `archived` notice below — and the Pass updates that takeover section's `has_printer` from it. `WsStationNotice.kind` becomes `'archived' | 'output'` (`open_lines` only for `archived`, `has_printer` only for `output`).
- **Archived station:** an `onBranchConfigApplied` hook (total: any unexpected shape → log and skip, never throw — a throw would fail the config apply) lists stations archived in `next` with lines in Now / Next (engine); after commit `station_notice { station_id, kind: 'archived', open_lines }` goes to that station's sockets and the Pass tablets of its point; the `kds-config` query lists it until the lines are gone.
- **`BranchConfigApplied`:** KDS and Pass refetch config.

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | §2; `ConnectedSession.stationId` (H-9) | §3, §6 |
| 01a | §2; `engine_settings` keys `ready_window_ms`, `kds_offline_ms`, `served_estimate_ms` (A-1) | §3.5, §3.6 |
| 01b | `resolve`, `floorsOf`; `run-pass` (B-1), `mark-served`, `manage-devices` | §3.5, §3.9 |
| 01d | §2; `AlertDetailsBase` fields `identifier`, `station_name` (D-2); `registerTargetResolver('point', …)` (⚠️ Changed by v1.0.1 (G-1, owner 2026-11-11): 03b registers the `point` resolver, §3.8) | §3.5, §3.6, §3.8 |
| 02a | `currentTableOf`, `tableOwners` | §3.1, §3.5 |
| 02b | `order_lines`, `orders` (read-only), `scopedOrders`, events | §3.5, §5 |
| 03a | §2; T-1 | §3.2–§3.7 |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `stationPresence()` | `Map<station_id, { screenless, connected, offline_since, dark }>` | 0 | 03c fallback, 07 |
| `buildLineDetails(db, state, order_item_ids)` | `Map<order_item_id, LineDetail>` | 2 (order lines + orders, `currentTableOf`) | 03c tickets and render |
| `pointOfLine(state, order_item_id)` | `string \| null` | 0 | 03c |
| `devicePoint(device_id)` | `string \| null` (memory map) | 0 | 03c audiences |
| `handoversDue(db, now, older_than_ms)` | `Array<{ handover_id, order_id, order_item_ids }>` — hand-overs with `open_lines > 0` handed at or before `now − older_than_ms`, `LIMIT 200`; `order_item_ids` = that hand-over's **unsettled** lines only (`handover_lines.settled_at IS NULL`) | 2 | 02b `served_estimate` (task 0e) |
| Client slots `registerLineTag(fn)`, `registerPassCardAction(fn)` (⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-50): plus `registerLineAction(fn)`, `subscribeFrames(fn)`, `notifySlots()`; actions' `run()` returns a promise, §8) | `apps/client/src/features/kds/slots.ts` (browser) | — | 03c (D12) |
| Types `LineDetail`, `Identifier`, `UNDO_DONE_MS` | §4.4 | — | 03c, clients |
| Events, kinds, catch-up parts, frames | §6 | — | 03c, 02b, 05, 07 |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 02b | Tick `served_estimate` (02b §3.7, §6.11, O14): `due` = `handoversDue(db, now, served_estimate_ms)` when the setting is not null; `intents` = `ItemServed { source: 'estimated' }` per order + `stockEffects` + `OrderFoodServed`. **Task 0e** (OQ-2), after `module-02b` merges and after tasks 0b-2 and 17. |
| 02b | Reprint on the order-taker / cashier screens: 02b follow-up (R-6); 03c puts Reprint on the Pass card. |
| 03c | Reads `stationPresence()`, `buildLineDetails`, `pointOfLine`, `devicePoint`; adds the `printed` tag and the Reprint action through 03b's client slots (D12) from its own folders. |
| 01e | Lane buttons / headless point devices write the H-5 / H-6 columns (through `DeviceRoleSet` or 01e's pairing); lane changes through `SetStationCapacity` stay mirrored (§3.7); claims (K7) are 01e's. |
| 07 | Pass timings from `ReadyToServe`, `Handover`; dark-station history from `kds_offline` alerts. |

### 4.4 Shared types (`@pos/domain/src/kds.ts`, browser-safe)

```typescript
export const UNDO_DONE_MS = 30_000;   // D16; Undo Done and Undo ready

export type Identifier =
  | { kind: 'table'; label: string }                         // "T4 + T5", "Family 2"
  | { kind: 'token'; token: number; date: string | null }
  | { kind: 'parking'; car_number: string; car_type: 'sedan' | 'mini' | 'large' };

export interface LineDetail {
  order_item_id: string; order_id: string; station_id: string; point_id: string;
  identifier: Identifier; order_type: 'dine_in' | 'takeaway' | 'parking';
  item_name: string; units: number;          // live units
  line_kind: 'item' | 'option_child' | 'deal_part';
  for_parent: string | null; deal_name: string | null;
  options: string[];                         // option children with no station + plain options (v1.0.3, B3-2); a return line's copied ones (v1.0.4, B3-4)
  kitchen_note: string | null; order_note: string | null;
  return_of: { order_item_id: string; mode: 'fix' | 'remake'; item_name: string; identifier: Identifier } | null;
  cook_ms: number; prep_ms: number; from_stock: boolean;
  placed_by_name: string | null;             // order taker (03c ticket toggle)
}
```

> ⚠️ Changed by v1.0.3 (owner 2026-11-11, B3-2): `options` (still `string[]`) = the line's **live option children with no station** and its **plain options** (`ItemAdded.options`, `{ name, quantity }`, read from 02b v1.0.7 `order_lines.options_json`), in that order; each entry is `"name"`, or `"<q> x name"` when the quantity is > 1, the quantity scaled to the line's live units the same way as `childQuantity` (01c `menu-lines.ts`). `buildLineDetails` keeps its 2 statements (the column is on the `order_lines` row it already reads). Built in task P0.16.

### 4.5 Changes to other specs (R26) — *Proposed — needs approval*; each target bumps with changelog and "Changed by 03b" markers (R34); applied by tasks 0a–0d

| Row | Target → version | Change | Why |
|---|---|---|---|
| H-9 | 00 → **v1.9** §4.2 `WsHub` + code (`apps/hub/src/ws/server.ts`, R-4) | `ConnectedSession.stationId: string \| null`, copied from `SocketCtx` (additive). | §3.6 |
| H-10 | 00 → **v1.9** §5.1 notes on H-5 / H-6 | Writers: 03b's `device_roles` projection (`DeviceRoleSet`) and 01e's pairing when built. | §3.8 |
| B-1 | 01b → **v1.8** | `run-pass` (group `kitchen`, scope `branch`); `default_key` grants `owner`, `manager`, `cook` (cloud `default-roles.ts`, hub seed); **Cook also gets `reprint-ticket` (`branch`) by default** (the Pass card reprint, 03c R-6); no migration (⚠️ Changed by v1.0.1 (G-5, owner 2026-11-11): was "CHECK-expand migration"; no CHECK on permission names exists, hub or cloud, and hub grants come only from directory sync); re-seed (R29); overrides M29 / B17 "Cook has no permissions". | P8; check m-6 |
| B-2 | 01b → **v1.8** owner settings wire | `served_estimate_ms` writable on the settings PATCH and returned on GET (`packages/events/src/admin/staff.ts`), range per A-1; plus the two new keys. | 02b O14 |
| A-1 | 01a → **v2.4** branch settings, snapshot V4 `engine_settings` | New **optional** keys with hub defaults (no snapshot version bump, R29): `ready_window_ms` (60 000; 15 000–300 000), `kds_offline_ms` (30 000; 10 000–300 000). `served_estimate_ms` gets its range (60 000–1 800 000; `null` = off); the cloud migration (after `module-02b`'s `0009_zones` column) sets **180 000 on existing branch rows** so the pilot runs with the estimate on. ⚠️ Changed by v1.0.2 (AD-9, owner 2026-11-11): the same migration bumps `config_version` for every branch with a settings row (no audit row), so a hub on the old version gets the new keys. | G1-10, R-3, O14 |
| D-2 | 01d → **v1.2.2** `AlertDetailsBase`, `AlertRaised` | **Freeze** today's base as `AlertDetailsBaseV2` and point `AlertRaised.v2` at it (so v2's shape never changes, F D46, as 03a AD-36 froze `AlertDetailsBaseV1`); widen `AlertDetailsBase` with optional `identifier`, `station_name`, `printer_name`, `problem` (each ≤ 40); `AlertRaised` **v3** over the widened base, identity upcaster v2 → v3, one fixture. Kinds use `AlertDetailsBase.pick(...)`. | run 2 M-3; check m-4 |
| T-1 | 03a → **v1.2.1** §3.10, §6.6, To 03b #4 (text only) | 03b's `SetLaneState` also writes `StationCapacitySet` (`lane_off` / `lane_on`) with `SetStationCapacity`'s checks; `run-pass` is a second right for those two reasons. | §3.7 |
| D-6 | 01d → **v1.2.4** §3.4 `always_on` (⚠️ Changed by v1.0.5 (owner 2026-11-12, P18-1)) | point-bound tablets join `always_on` only when their point is **active** (not archived) in `branchConfig().points`; a tablet bound to an archived point gets no always-on alerts | an archived Pass must not ring |
| T-3 | 03a → **v1.2.3** §3.8a, test 114 (⚠️ Changed by v1.0.4 (owner 2026-11-11, B3-4)) | the return line copies the served line's plain options (`ItemAdded.options`, every `price_minor` / `charge_minor` 0) **and** its live option children **with no station**, each as a plain option entry (`option_id`, the option's `modifier_group_id` from config, `name`, `quantity` = the child's `option_quantity`, money 0); option children **with a station** are their own lines and are not copied (was `options: []`); the engine ignores options | the remake ticket and KDS show "No onion" |
| O-2 | 02b → **v1.0.8** §3.8, §6.7 (⚠️ Changed by v1.0.4 (owner 2026-11-11, B3-4)) | `ReturnToKitchen` builds the return line's `options` as above; +1 statement (the served line's option children) | as T-3 |
| D-4 | 01d → **v1.2.3** §6.5 `SendTestAlert` (⚠️ Changed by v1.0.3 (owner 2026-11-11, B1-1)) | a `{ kind: 'point', point_id }` target is checked against `branchConfig().points` (active only) → else `404 POINT_NOT_FOUND { point_id }`, before the resolver | a point that does not exist must not raise to nobody |
| D-5 | 01d → **v1.2.3** §3.4 `always_on` (⚠️ Changed by v1.0.3 (owner 2026-11-11, B1-2)) | `always_on` also reaches unrevoked `tablet` devices bound to a point (`devices.point_id IS NOT NULL`), as 01d §3.4 foresaw once 01a points landed | Pass tablets get the always-on alerts |
| A-2 | 01a → **v2.4.3** §8.1 (⚠️ Changed by v1.0.3 (owner 2026-11-11, P15-1)) | owner page "Kitchen screens and the pass": **Ready window** and **KDS offline** are typed in **seconds** (15–300, 10–300); **Served estimate** stays minutes (1–30 or Off); client text only, the wire stays ms | 10 s cannot be typed in two-decimal minutes |
| T-2 | 03a → **v1.2.2** §3.3, §3.6.1 step 3 (⚠️ Changed by v1.0.3 (owner 2026-11-11, B2-2)) | `EngineLine.done_undone`, set by `ItemDoneUndone`'s fold, cleared by nothing; the `auto_done` inference skips flagged lines | §3.2 UndoDone: an undone inferred Done must stay undone |
| O-1 | 02b → **v1.0.7** §5 (⚠️ Changed by v1.0.3 (owner 2026-11-11, B3-2)) | `order_lines.options_json TEXT` (hub migration `0016_order_line_options.sql`), written by the `orders` fold of `ItemAdded`, filled by rebuild | §4.4 plain options on KDS and tickets |
| S-1 | `stories-refined.md` E3 (editorial) | AC1 → assembler view per point; AC2–AC3 → 03a contract; AC5 volume on the hub admin; screen-first note (R-1). | G0 §3, R-1 |

**One bump per target, shared with 03c (check m-5):** 03b and 03c are meant to be approved together; task 0d then applies **both** specs' rows in one bump each: 00 **v1.9** = H-9, H-10 (03b) + H-11 (03c); 01d **v1.2.2** = D-2 (03b) + D-3 `printer_alert_ms` (03c); Foundation **v1.12** = F-1, F-2 (03c); 02b **v1.0.6** (⚠️ Changed by v1.0.2 (AD-15): was v1.0.4) = Q-1 (03c; v1.0.3–v1.0.5 are already taken); 01a v2.4, 01b v1.8, 03a v1.2.1 as above. **If 03c is not approved with 03b,** task 0d applies 03b's rows only and 03c gets its own bump task (its 0a) back, taking the next free version of each target. **02b v1.0.6 waits for `module-02b` to merge** (v1.0.3 lives only there): that part of task 0d runs with 0b-2.

### 4.6 Carried rows (README) and where they land

| Row | Lands in |
|---|---|
| :170 station commands `stationScoped` | §3.2; tests 1–4 |
| :190 default grants by `default_key` | B-1; test 60 |
| :199 archived-station warning | §3.10; test 52 |
| :237 02a current table, Ready target, re-target, Served card | §3.1, §3.5; tests 20–27 |
| :240 #1–#4, #6–#8 03a | §3.2–§3.7; tests 1–29 |
| :240 #5 (ticket per fire) | **03c** |
| :200, :211 | **03c** |
| 02b To 03b "write `Handover`", O14 | §3.5, §4.3; tests 24, 27 |
| 02b To 03b ticket rows | **03c** |
| 01a :405, :406, :433 | §3.3, §3.10, §8 |
| 01d D-2, N-2, G1-12b, G1-21.4 | §3.5, §3.9, §6.20 |
| OPEN-QUESTIONS 00 Q10 | §3.3 |

---

## §5. Data model (hub SQLite)

Migration `apps/hub/src/db/migrations/NNNN_kds_pass.sql`.

```sql
-- kds_config projection (with reset): StationScreenSet, StationCapacitySet, BusinessDayOpened
CREATE TABLE kds_station_settings (
  station_id   TEXT PRIMARY KEY,
  sound_volume INTEGER NOT NULL CHECK (sound_volume BETWEEN 0 AND 100)
);
CREATE TABLE station_lanes (
  station_id TEXT PRIMARY KEY,
  lanes_on   INTEGER,                            -- NULL = custom (manager, or no k matches)
  lane_count INTEGER NOT NULL
);

-- pass projection (with reset): ReadyToServe, ReadyToServeUndone, Handover, ReadyRetargeted, AlertClosed,
--   ItemServed, ItemReturned, ItemRemoved, ItemVoided, OrderCancelled
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

CREATE TABLE pass_ready_lines (
  order_item_id TEXT NOT NULL,
  order_id      TEXT NOT NULL,
  point_id      TEXT NOT NULL,
  settled_at    INTEGER,
  PRIMARY KEY (order_id, point_id, order_item_id)
);
CREATE INDEX pass_ready_lines_item ON pass_ready_lines (order_item_id) WHERE settled_at IS NULL;  -- settle folds, UndoDone

CREATE TABLE handovers (
  handover_id          TEXT PRIMARY KEY,
  order_id             TEXT NOT NULL,
  point_id             TEXT NOT NULL,
  receiver_staff_id    TEXT NOT NULL,
  handed_at            INTEGER NOT NULL,
  open_lines           INTEGER NOT NULL CHECK (open_lines >= 0),   -- decremented by rows actually settled (§3.5)
  served_card_alert_id TEXT,
  card_closed_at       INTEGER
);
CREATE INDEX handovers_unsettled ON handovers (handed_at) WHERE open_lines > 0;              -- handoversDue (02b estimate)
CREATE INDEX handovers_card_open ON handovers (served_card_alert_id)
  WHERE served_card_alert_id IS NOT NULL AND card_closed_at IS NULL;                         -- pass_closures, AlertClosed fold

CREATE TABLE handover_lines (
  order_item_id TEXT PRIMARY KEY,
  handover_id   TEXT NOT NULL,
  settled_at    INTEGER
);
CREATE INDEX handover_lines_handover ON handover_lines (handover_id);                       -- handoversDue lines
```

- Projections: `kds_config` (reset), `pass` (reset), `device_roles` (forward-only; `DeviceRoleSet` → `UPDATE devices`; refreshes the memory map after commit).
- **Order of registration:** 03b's projections register **after** 02b's `orders` (registration lines next to `registerOrdersProjection` in `lib/boot.ts`; a boot test asserts the order). The `pass` fold reads `order_lines` live units for partial removals / voids (02b T19 exception). **Live:** 02b's fold of the same event ran first, so the units are that event's. **Catch-up:** registry runs each projection over the whole range in turn (`projections/registry.ts:89-111`), so `pass` reads `order_lines` at the **tip** — a partial removal may settle a line earlier than it did live; because settling is idempotent (§3.5), the end state equals the live one (rebuild test 30). ⚠️ Changed by v1.0.3 (owner 2026-11-11, R-3): a rebuild may set `settled_at` **earlier** than live for lines settled by partial units; `settled_at` is only ever read with `IS NULL` (indexes, ticks, `handoversDue`), never by value, so that difference is invisible. Every 03b fold is total (never throws).
- Times are `recorded_at`. No session ids.

---

## §6. Commands, events and queries

**Common rules.** D32 idempotency, no PIN, not queueable. Device commands at `POST /commands/:name` (`sessionKind: 'device'`), admin commands at `POST /admin/commands/:name` (`sessionKind: 'admin'`); queries at `GET /queries/:resource` / `GET /admin/queries/:resource`. Responses `200 { data: { command_id, event_ids, result } }`. Statement counts exclude 01d's own bounds and the append; engine reads are memory.

### 6.1 `StartItem` — `{ order_item_id }`; station / `run-pass`. Result `{ started }`. Statements 0. Errors `ORDER_NOT_FOUND`, `ITEM_WRONG_STAGE`, `PERMISSION_DENIED`.
### 6.2 `DoneItem` — `{ order_item_id, confirm? }`. Result `{ done }`. Statements 0. Errors as 6.1 + `ITEM_DONE_CONFIRM_REQUIRED`.
### 6.3 `UndoDone` — `{ order_item_id }`. Result `{ undone, ready_undone }`. Statements 2. Errors as 6.1 + `ITEM_UNDO_WINDOW_CLOSED`.
### 6.4 `GiveMeMore` — `{ station_id, n? }`. Result `{ pulled }`. Statements 0. Errors `STATION_NOT_FOUND`, `PERMISSION_DENIED`.
### 6.5 `SetLaneState` — `{ station_id, lanes_on }`. Result `{ lanes_on, lane_count, capacity }`. Statements 1 (lane devices). Errors `STATION_NOT_FOUND`, `VALIDATION_FAILED`, `PERMISSION_DENIED`. Writes `StationCapacitySet` + `LanesSet`.
### 6.6 `MarkReadyToServe` — `{ order_id, point_id }`; `run-pass`. Result `{ alert_id, already? }`. Statements 4 (`handover_lines`, `pass_orders`, `orders`, `currentTableOf`). Errors `POINT_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`, `ITEM_WRONG_STAGE`, `PERMISSION_DENIED`.
### 6.7 `UndoReadyToServe` — `{ order_id, point_id }`; `run-pass`. Statements 2. Errors `PASS_UNDO_WINDOW_CLOSED`, `POINT_NOT_FOUND`, `PERMISSION_DENIED`.
### 6.8 `Handover` — `{ order_id, point_id, receiver_staff_id, order_item_ids? (1–40) }`; `run-pass`. Result `{ handover_id, served_card_alert_id, remaining }` (⚠️ Changed by v1.0.3 (owner 2026-11-11, B4-2): `remaining` = done lines at this point not handed over after this call; with no list at most 40 are taken, §3.5 step 3). Statements 5 for a dine-in order, 4 otherwise (`handover_lines`, `pass_ready_lines` + `pass_orders`, `scopedOrders`, the receiver's open session, `currentTableOf` for a dine-in order — identifier and `table_code`, and the `my_floors` check). ⚠️ Changed by v1.0.3 (owner 2026-11-11, B4-3): was "Statements 4" (+ the open-session read). Errors `POINT_NOT_FOUND`, `ORDER_NOT_IN_ENGINE`, `ITEM_WRONG_STAGE`, `PASS_RECEIVER_INVALID`, `PERMISSION_DENIED`.
### 6.9 `SetStationScreen` — admin; `{ station_id, sound_volume }`; writes `StationScreenSet`. Statements 0. Errors `STATION_NOT_FOUND`, `VALIDATION_FAILED`.
### 6.10 `SetDeviceRole` — admin; `{ device_id, point_id?, lane_label? }`; writes `DeviceRoleSet`. Statements 1. Errors `DEVICE_NOT_FOUND`, `POINT_NOT_FOUND`, `VALIDATION_FAILED`.
### 6.11 `GET /queries/pass-receivers?order_id` — `run-pass`. `{ receivers: [{ staff_id, name, table_team }] }`: staff with an open session whose `mark-served` covers the order (§3.5 step 2), table team first. Statements 3. ⚠️ Changed by v1.0.1 (G-3, owner 2026-11-11): coverage per candidate by `orderCovered` over one `scopedOrders` and one shared `currentTableOf` (no read per candidate); `run-pass` is checked inside the query handler (queries have no permission field).
### 6.12 `GET /admin/queries/kds-config` — `manage-devices`. `{ stations: [{ station_id, name, point_id, sound_volume, lanes, screens: [{ device_id, name, lane_label, state: 'connected' \| 'signed_out' \| 'offline' }], dark }], pass_tablets: [{ device_id, name, point_id, state }], warnings: [{ station_id, kind: 'archived_open_lines' \| 'dark' }] }`. Statements 3 (devices, settings, lanes) + memory. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-48): the body also carries **`points: [{ point_id, name, is_archived }]`** (every point of the branch config, archived ones included, so the page can name and flag them) and each warning carries **`name`** (the station's name, also for an archived station that `stations[]` leaves out); both from `branchConfig()` (memory), statements unchanged (3).
### 6.13 Catch-up parts are listed in 6.14–6.15; frames in 6.16.
### 6.14 Catch-up part `kds_station` — station sockets, own station. `{ station_id, day_open, sound_volume, has_printer, lanes: { lanes_on, lane_count }, now: Array<LineDetail & { stage, fired_at, started_at, mark, done_undone }>, (⚠️ Changed by v1.0.5 (owner 2026-11-12, B2-3): `done_undone: boolean` from the engine line, §3.3) details: LineDetail[] (frozen `station_plan` lines) }`. Statements 4 (`buildLineDetails` 2, settings + lanes 1; + 1 `stationHasPrinter`, 03c v1.0.6) — ⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-20): `has_printer: boolean` = output mode `both` / `printer` with an active printer; the KDS shows its Reprint action only when true; was "Statements 3".
### 6.15 Catch-up part `point_view` — staff sockets on a device with a point. `{ point_id, stations: [{ station_id, name, lanes, dark }], orders: [{ order_id, identifier, placed_at, lines: [LineDetail & { stage, handed_over }], ready: { at, by } \| null }], takeovers: [<kds_station body per dark station of the point>] }` (⚠️ Changed by v1.0.7 (owner 2026-11-12, Q-P22b): each takeover body carries `has_printer` like the station's own `kds_station` body, kept current by `station_notice { kind: 'output' }` to the point's Pass tablets, §3.10). Statements 4 (+1 per takeover station's details, bounded by the point's stations). ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-45, Q-46): **`stations[]` entries gain `screenless: boolean`** (true when the station has no paired, unrevoked `kds` device — the §3.8 screen-station map, memory; refreshed at the next catch-up), and **each `orders[].lines[]` entry gains `group_id: string` and `serve_mode: 'sync' | 'immediate'`** from the engine line (memory), so the Pass computes readiness itself (§3.4). Statements unchanged.
### 6.16 Frames — `kds_lines { station_id, lines }`, `point_lines { point_id, lines }` (details for ids gained in a commit; once per id per socket set; ⚠️ Changed by v1.0.4 (owner 2026-11-11, B3-3): **and again** for an id whose live units changed in the commit (`ItemRemoved` / `ItemVoided` with `units`, `LineWeightSet`), so `LineDetail.options`' scaled quantities (§4.4) stay current — the changed ids join the same `buildLineDetails` call; 2 statements per commit that adds **or changes** lines (unchanged budget); sent before the commit's `station_plan` where the host orders hooks, else covered by placeholders); `station_takeover { station_id, active, view? }` (§3.6); `station_notice` (§3.10). ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-46): `point_lines` lines carry `group_id` and `serve_mode` like `point_view` lines (§6.15). ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-47): **also re-sent on a table change** — in a commit that holds `TableMoved`, `TablesMerged` or `SeatingSplit`, the details of every line the socket set already holds whose order belongs to a seating named by the event (`seating_id`; `into_seating_id` and `absorbed_seating_id`; `from_seating_id` and `new_seating_id`) are sent again in `kds_lines` / `point_lines`, so identifiers ("T4" → "T9", "T4 + T5") follow without a reconnect. The ids join the same `buildLineDetails` call (2 statements); the orders of the named seatings come from at most **+1 statement** on `seating_orders` by `seating_id` (`seating_orders(order_id PK, seating_id)`, index `seating_orders_seating`, hub migration `0012_tables.sql`; `TablesMerged.order_ids` / `SeatingSplit.order_ids` are in the payloads, but the seating-wide set still needs the read), only in a commit that holds one of the three events. Budget **≤ 2 + 1 per hook** (the KDS hook and the Pass hook each run their own `buildLineDetails`); a commit without a table event keeps the B3-3 budget.
### 6.17 Event audiences — line events (`ItemStarted`, `ItemDone`, `ItemDoneUndone`, `ItemRemoved`, `ItemVoided`, `ItemServed`, `OrderBoosted`, `ItemsReleased`, `FireDispatched`, `StationCapacitySet`): station sockets of the line's station; staff sockets whose `devicePoint` is the line's point; staff sockets of the station's point while the station is in `takeover_stations`. `ReadyToServe`, `ReadyToServeUndone`, `Handover`, `ReadyRetargeted`: staff sockets of that point. All memory, 0 statements. ⚠️ Changed by v1.0.1 (G-10, owner 2026-11-11): audiences are additive (`ws/audience.ts`, any registered audience admits a socket), so 03b adds sockets and never narrows: `ItemRemoved`, `ItemVoided`, `ItemServed`, `OrderBoosted`, `ItemsReleased` already reach every staff socket and cashier kiosk (02b §6.19) and `StationCapacitySet` every socket (03a §6.4) — accepted. ~~The sets above are exact for `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `FireDispatched` and 03b's events.~~ ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-49): the sets above are **03b's minimum**, not exact: 02b v1.0.11 H1 (§6.19, test 45) also sends `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `FireDispatched` to every staff socket and cashier kiosk — accepted like G-10; the comment in `apps/hub/src/ws/kds-audiences.ts` says the same. The KDS and the Pass ignore an event whose `order_item_id` they do not hold (§3.3, §3.4). The Pass events (`ReadyToServe`, `ReadyToServeUndone`, `Handover`, `ReadyRetargeted`) stay exactly the point's staff sockets. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-44): **config frames** — `LanesSet` → every staff and every station socket; `StationScreenSet` → the station sockets whose station is the payload's `station_id`; `BusinessDayOpened` / `BusinessDayClosed` → also every station socket, through a second, additive registration in 03b's `ws/kds-audiences.ts` (01a's staff audience in `ws/restaurant-audiences.ts` unchanged; G-10: audiences are OR-ed). This contradicts the **01a v2.4.4 §4.5 audience table** (row `BusinessDayOpened`, `BusinessDayClosed`: `station` socket = no) and **01a test 73** ("not to station sockets") for these two types: a contract change in 01a, not a G-10 case. 01a is not bumped here; **this row is open until the owner rules Q-62** (= `docs/OPEN-QUESTIONS.md` §10 03-Q1; Rec (a): no 01a bump now, the markers go into the next 01a bump), and the hub task that builds it (HK1) adds the station audience for these two types and edits test 73 only after that ruling; `DeviceRoleSet` → none (§3.8). All memory, 0 statements.
### 6.18 Tick `ready_retarget` — `due`: open dine-in Ready rows (1, `pass_orders_open`) + `currentTableOf` (1); due when a stored `ready_table_id` ≠ the current primary table. `intents`: the same two reads inside `writer.run`, then **one** `alerts.closeMany('obsolete')` + **one** `alerts.raiseMany` + `ReadyRetargeted` per row. Statements 2 + 2 + 01d's fixed bounds.
### 6.19 Tick `pass_closures` — `due`: open Readies whose ready lines are all settled or whose order left the engine (1, `pass_orders_open` ⋈ `pass_ready_lines` + memory) and open cards with `open_lines = 0` (1, `handovers_card_open`). `intents`: same reads inside `writer.run`, one `alerts.closeMany(…, 'done')`. Statements 2 + 2.
### 6.20 Tick `kds_presence` — §3.6. `due`: memory only (presence of screen stations, engine Now / Next, open `kds_offline` state from 1 statement on 01d's open alerts by kind, cached per tick). `intents`: `alerts.raiseMany` / `closeMany` for stations crossing the thresholds; takeover **start** frames in `tx.onCommit`. Takeover **end** (no write) is sent from `due` directly. Same split as `engine-host/fires-tick.ts:200-225`. ⚠️ Changed by v1.0.1 (G-13, owner 2026-11-11): `due` and the frames reach the sockets through the per-db host bound at server build (§3.6 step 1).

### 6.21 Kinds (registered at module top level, imported before boot step 4)

```typescript
defineAlertKind({
  kind: 'ready_to_serve', family: 'action', subject: 'order',
  steps: [
    { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
    { at: { value: 'window_ms', times: 1 }, to: [{ target: 'raised_target', set: 'recipient' }] },
    { at: { value: 'window_ms', times: 2 }, escalation: true,
      to: [{ target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' },
           { target: { kind: 'managers' }, set: 'recipient' }] },   // ⚠️ Changed by v1.0.1 (G-14, owner 2026-11-11): was `target: 'managers'`
  ],
  closes_on: 'owner',
  values_schema: z.object({ order_id: z.string().min(1), point_id: z.string().min(1),
                            table_id: z.string(), window_ms: z.number() }),
  details_schema: AlertDetailsBase.pick({ identifier: true }),          // D-2
  lead_fallback: false, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.ready_to_serve.card', lock: 'alert.ready_to_serve.lock' }, request: null,
});
defineAlertKind({
  kind: 'served_card', family: 'info', subject: 'order',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
  closes_on: 'owner',
  values_schema: z.object({ handover_id: z.string().min(1), order_id: z.string().min(1) }),
  details_schema: AlertDetailsBase.pick({ identifier: true }),
  lead_fallback: false, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.served_card.card', lock: 'alert.served_card.lock' }, request: null,
});
defineAlertKind({
  kind: 'kds_offline', family: 'action', subject: 'hub',            // { stream_type: 'hub', stream_id: branch_id } (01d A3)
  steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }],   // ⚠️ Changed by v1.0.1 (G-14, owner 2026-11-11): was `target: 'managers'`
  closes_on: 'owner',                                               // kds_presence: 'done' after 60 s back
  values_schema: z.object({ station_id: z.string().min(1) }),
  details_schema: AlertDetailsBase.pick({ station_name: true }),
  lead_fallback: true, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.kds_offline.card', lock: 'alert.kds_offline.lock' }, request: null,
});                                                                 // dedupe_key 'kds_offline:' + station_id
```

### 6.22 Events (`schema_version` 1; `@pos/events/src/events/{order,hub}/`)

| Event | Stream / id | Payload | Written by |
|---|---|---|---|
| `ReadyToServe` | order / order_id | `{ order_id, point_id, order_item_ids, table_id \| null, alert_id \| null }` | `MarkReadyToServe`, `Handover` |
| `ReadyToServeUndone` | order / order_id | `{ order_id, point_id, alert_id \| null }` | `UndoReadyToServe`, `UndoDone` |
| `Handover` | order / order_id | `{ handover_id, order_id, point_id, receiver_staff_id, order_item_ids, alert_id, ready_alert_closed: string \| null }` | `Handover` |
| `ReadyRetargeted` | order / order_id | `{ order_id, point_id, table_id, alert_id, previous_alert_id }` | tick `ready_retarget` |
| `LanesSet` | station / station_id | `{ station_id, lanes_on, lane_count }` | `SetLaneState` (G1-7) |
| `StationScreenSet` | hub / branch_id | `{ station_id, sound_volume }` | `SetStationScreen` |
| `DeviceRoleSet` | hub / branch_id | `{ device_id, point_id \| null, lane_label \| null }` | `SetDeviceRole` |

The engine's replay filter lists none of these. WS frames `kds_lines`, `point_lines`, `station_takeover`, `station_notice` join `WsServerMessage` (`packages/events/src/ws.ts`). The name `Handover` stays (03a To 03b #1, 02b §3.7, 01d K5; run 1 n-10).

---

## §7. Cross-cutting

| Item | Rule | Why (YAGNI) |
|---|---|---|
| Presence | One tick, memory only, frames outside transactions | Takeover and 03c fallback share one truth (D9) |
| Logging | `kds.takeover.start/end { station_id }`, `kds.fold_skipped` | Install day, power-cut recovery |
| Performance | Catch-ups ≤ 3 / 4 statements; folds: the `pass` fold of every settling event type (`ItemServed`, `ItemReturned`, `OrderCancelled`, `ItemRemoved` with or without `units`, `ItemVoided`) and of `ReadyToServe`, `Handover`: **3 fixed per event, whether or not anything settles**; every other fold ≤ 2 (⚠️ Changed by v1.0.3 (owner 2026-11-11, B4-1): was "folds ≤ 2 statements per event"; matches b13's statement-count test); ticks 2 + 2 | ~200 orders / rush, ~10 devices |
| No new env var, no new dependency, no new table outside §5 | — | — |

---

## §8. Client contract (`apps/client`, ui-kit only)

- **Slots (D12):** `apps/client/src/features/kds/slots.ts` exports `registerLineTag(fn: (line) => Tag | null)` (KDS rows and Pass lines) and `registerPassCardAction(fn: (order) => Action | null)`; 03b renders whatever is registered. 03c registers its `printed` tag and Reprint action from its own folder. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-50): the contract grows in the 03b client's wave 0 (one file) by: **`registerLineAction(fn: (line: LineDetail, ctx: { station_id: string; has_printer: boolean; surface: 'kds' | 'takeover' }) => Action | null)`** — a per-row action on KDS rows and on Pass takeover rows (03c's Reprint, 03c v1.0.9 §3.5); **`Action.run(): Promise<{ toast?: string } | void>`** for every action (03b shows the returned toast, e.g. "Reprinting 2 tickets"); **`subscribeFrames(fn: (frame: WsServerMessage) => void): () => void`**, fed by the KDS and Pass live buses (catch-up parts and frames), so 03c can read `kds_printed`, `printed_lines` and `station_notice` without owning a socket; **`notifySlots(): void`**, which makes 03b re-render its slot output (the slot functions stay synchronous and pull-only). 03b-side plumbing of the same file (not called by 03c): **`publishFrame(frame: WsServerMessage): void`** (the KDS and Pass live buses feed `subscribeFrames` through it) and **`onSlotsChanged(fn: () => void): () => void`** (03b's screens listen for `notifySlots`). `ctx.has_printer` comes from `kds_station.has_printer` (KDS) or the takeover body (Pass), kept current by `station_notice { kind: 'output' }` (§3.10).
- **KDS entry** (`apps/client` entry `kds`, station session; ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-42): served by the hub at **`/kds/`** with the same page meta as `/staff/` (`pos-tenant-id`, `pos-branch-id`, hub clock); the pair page sends a paired `kds` device there and **`/kds/` itself calls `POST /auth/station`** with the stored device token, so one page owns the station session (00 v1.9.2 §8.2, M53)): §3.3; big targets, no modal; inline Done-early and "Tap Start first"; Undo 30 s; Give me more; Lane Off / On on a lane KDS; sounds per P7 at `sound_volume`; "Reconnecting…" banner and taps disabled while the socket is down; "Day not started"; archived banner; coming-up strip; config refetch. 03c's `printed` tag arrives through the line-tag slot.
- **Pass screen** (01d's `/staff/` entry on a device with a point): §3.4 cards, Ready / Hand over / Undo, receiver tiles, Start / Done for stations without a screen, lanes, **takeover sections** (§3.6); offline banner, taps disabled.
- **Hub admin "Kitchen screens"** (`apps/client/src/features/admin/kitchen-screens/`, admin session): §3.8. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-43): its own client entry served at **`/admin/kitchen-screens/`** (group `admin-page`, as `/admin/stock/`); reached from 00's hub admin side-nav item and home tile, and from a Devices row's "Use as Pass tablet" link `/admin/kitchen-screens/#bind=<device_id>` (00 v1.9.2 §8.2).
- 12-hour times everywhere (01d AD-167).

---

## §9. Error catalogue additions (Foundation §6.2, `@pos/domain/src/errors.ts`)

| Code | HTTP | Details | When |
|---|---|---|---|
| `ITEM_UNDO_WINDOW_CLOSED` | 409 | `{ order_item_id }` | Undo Done after 30 s |
| `PASS_UNDO_WINDOW_CLOSED` | 409 | `{ order_id, point_id }` | Undo ready after 30 s or after a hand-over |
| `ITEM_DONE_CONFIRM_REQUIRED` | 422 | `{ order_item_id, elapsed_ms, cook_ms }` | Done under 50 % of cook time without `confirm` |
| `PASS_RECEIVER_INVALID` | 422 | `{ receiver_staff_id }` | receiver inactive, without `mark-served`, or not covering the order |

Reused: `ITEM_WRONG_STAGE` (stages add `'handed_over'`; `'out_of_engine'` as 02b), `ORDER_NOT_FOUND` (`{ order_item_id, order_id: null }`), `ORDER_NOT_IN_ENGINE`, `STATION_NOT_FOUND`, `POINT_NOT_FOUND`, `DEVICE_NOT_FOUND`, `PERMISSION_DENIED`, `VALIDATION_FAILED`. Printing codes are 03c's.

---

## §10. Tests (`apps/hub/test/kds/*.test.ts`, `apps/hub/test/pass/*.test.ts`; client tests in `apps/client`)

Station commands
1. `StartItem` station session: `ItemStarted { source: 'tap' }`, `actor_id null`, KDS `device_id`; other station → `PERMISSION_DENIED`.
2. Unfired → `'added'`; `single_tap` → `'cooking'`; exited order → `'out_of_engine'`; unknown → `ORDER_NOT_FOUND { order_id: null }`; staff with / without `run-pass`.
3. Batch: Start / Done / Undo act on the whole load.
4. Late start → `ReservationsShifted`; from-stock start → `StockConsumed`.
5. `two_tap` Done before Start on a cooked line → `ITEM_WRONG_STAGE`; under 50 % → `ITEM_DONE_CONFIRM_REQUIRED`, nothing written; `confirm` → done.
6. From-stock line: Done with no Start succeeds, consumes, no 50 % check.
7. `UndoDone` 30 000 ok / 30 001 → `ITEM_UNDO_WINDOW_CLOSED`; handed-over → `'handed_over'`; inferred Done within 30 s of `done_at` only.
8. `UndoDone` of a Ready line → `ReadyToServeUndone` + alert `undone`.
9. `GiveMeMore`: pulls; `null` → no event; inferred start at `single_tap`; load whole.
10. Two Done taps → second `ITEM_WRONG_STAGE { stage: 'done' }`.
Lanes
11. `SetLaneState` 2 → 1 of 2: `StationCapacitySet { reason: 'lane_off' }` with `capacityForLanes`; station-session cap check; no-op on same value; 3 of 2 → `VALIDATION_FAILED`.
12. `lane_count` from labelled, unrevoked `kds` devices; none → 1.
13. Mirror: `SetLaneState` appends `StationCapacitySet` then `LanesSet` (order asserted); lane Off at night → `BusinessDayOpened` → all on; `SetLaneState(1)` at capacity 4, `lane_units` 4, 2 lanes (clamped: k = 1 and k = 2 both give 4) → `LanesSet` stores 1 exactly, the next Lane On is accepted; a KDS calling 03a's `SetStationCapacity { reason: 'lane_off' }` directly on the same station → tie → smallest k; manager override → `custom`.
Pass
20. `MarkReadyToServe` dine-in → `table_team direct` on the current primary table, `window_ms` from settings; **the stored alert row and the card frame carry `details.identifier`** (D-2); second tap `{ already: true }`.
21. Takeaway → `placed_by`; card shows "#12".
22. Re-target: `TableMoved` → old alert `obsolete`, a new open alert id on the new table; move back to the first table → a third, open alert; a merge moving 3 Readies uses one `closeMany` + one `raiseMany`.
23. `UndoReadyToServe` ≤ 30 s → `undone`; later → `PASS_UNDO_WINDOW_CLOSED`.
24. `Handover` without Ready → `ReadyToServe { alert_id: null }` + `Handover` (hub-minted id) + `served_card` to the receiver; a **partial** hand-over keeps the Ready open, the last one closes it `done`.
24a. ⚠️ Changed by v1.0.3 (owner 2026-11-11, B4-2): 45 done lines at a point, `Handover` with no list → 40 handed over (the first 40 by `added_at`, `order_item_id`), `remaining: 5`; a second call → 5, `remaining: 0`; a named list of 41 → 400 as before.
25. **Receiver parity with 02b `MarkServed`:** for each scope (`branch`, `own_tables`, `my_floors`) × order type (dine-in, takeaway, parking): `Handover` accepts the receiver iff 02b's `checkOrderScope` would let that receiver mark the order served; else `PASS_RECEIVER_INVALID`.
26. Ready → waiter's own `MarkServed` (no Handover) → `pass_closures` closes `done` before step 1; Ready → **a new round at the same point** → `MarkServed` of the ready lines → closed `done` (new lines do not hold it); last ready line removed / voided / order cancelled → closed; order left the engine → closed.
27. Served card closes at `open_lines = 0`; `handoversDue` (2 statements, `LIMIT 200`) returns only hand-overs with unsettled lines older than the cut-off, and **only their unsettled `order_item_ids`**, also after the card expired at day close.
28. Station session calling `Handover` → `PERMISSION_DENIED { session_kind: 'station' }`.
29. Point membership: a line cooked at an alternate on another point shows on its home point's Pass and Ready.
30. **Settling idempotent:** hand over → serve → 02b remake return → the return command **succeeds**, `open_lines` stays 0; hand over → serve → void → same; `ItemRemoved { units }` to 0 then a whole-line event → no change; a `pass` rebuild from seq 0 equals the live tables (⚠️ Changed by v1.0.3 (owner 2026-11-11, R-3): except `settled_at` values of lines settled by partial units, which may be earlier on rebuild; compared as `IS NULL`).
Presence and takeover
40. Screen station, screen closed, lines in Now: nothing before `kds_offline_ms`; then `kds_offline` to managers once (details `station_name` survives append) and, **after the commit**, `station_takeover { active: true, view }` to the point's Pass sockets (an `intents` failure sends no frame); its line events reach the Pass; Start and Give me more from the Pass under `run-pass` work.
41. Screen reconnects → takeover ends at once; alert closes `done` after 60 s connected; a blip of 10 s off and on twice → one alert.
42. A dark station whose last `kds` device is revoked → takeover ends, alert closes `obsolete`. Idle screen station never goes dark; a dark station whose lines all finish ends its takeover, keeps its alert. **Screenless station** (no paired `kds` device) with lines in Now for 10 min → no alert, no takeover frame, `stationPresence().screenless = true`.
43. Grace starts at the first `kds_presence` pass (⚠️ Changed by v1.0.1 (G-13, owner 2026-11-11): was "at server listen"); screens reconnecting inside it → no alert, no takeover.
44. `stationPresence()` matches the tick's view (03c contract).
Config
50. `SetStationScreen`, `SetDeviceRole` via `/admin/commands/` only (device route → `ROUTE_NOT_FOUND`); lane label on a non-`kds` device → `VALIDATION_FAILED`; memory map refreshed on `DeviceRoleSet`, pairing, revoke.
51. `kds-config` presence states incl. `signed_out` Pass tablets (alert mode).
52. Archived station with open lines: `station_notice` to its sockets and its Pass; its tickets / lines still render; warning clears when the lines are gone; hook never throws on an odd config.
53. Kinds register at boot without throwing (all three); projections register after 02b's `orders` (boot assertion).
54. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-44): `SetLaneState` → its `LanesSet` frame reaches a second lane KDS of the station, a KDS of another station and a point-less staff tablet; `SetStationScreen` → `StationScreenSet` reaches that station's KDS only (not another station's, not a staff socket); `BusinessDayOpened` / `BusinessDayClosed` reach a station socket and still every staff socket (this clause and the 01a test 73 edit only after owner ruling Q-62, §6.17); `DeviceRoleSet` reaches no socket; 0 statements.
55. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-48): `kds-config` lists `points` with `name` and `is_archived` (an archived point included); an `archived_open_lines` warning for an archived station carries that station's `name`; a `dark` warning carries the name too; statements still 3.
60. `run-pass` and Cook `reprint-ticket` default grants by `default_key` (hub + cloud) after migration (B-1).
Catch-up and frames
65. `kds_station` ≤ 3 statements with 50 lines; `point_view` ≤ 4 (+1 per takeover); Now matches `stationView` after removals, voids, move-to-stock and an abandoned order.
66. `kds_lines` once per new id.
67. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-45, Q-46): `point_view.stations[]` marks a station without a paired `kds` device `screenless: true` and one with a screen `false`; every `point_view` line and every `point_lines` line carries `group_id` and `serve_mode` equal to the engine line (a return line and a released line `'immediate'`, others `'sync'`); `point_view` statements unchanged (4, +1 per takeover).
68. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-47): a dine-in order with lines on a KDS and a Pass → `TableMoved` T4 → T9: one `kds_lines` and one `point_lines` frame re-send those lines with identifier "T9"; `TablesMerged` absorbing the seating → "T9 + T10"; `SeatingSplit` moving an order to a new seating → its lines re-sent with the new table; lines of other seatings are not re-sent; a commit without a table event sends nothing extra; statements ≤ 2 + 1 per hook (KDS and Pass each), only in a commit with a table event.
Client
70. Station view order rules, `moved` tag, placeholders.
71. Late colouring with a skewed clock corrected by `hub_time`.
72. Offline banner disables taps; `'done'` loser shows no error.
73. Coming-up strip.
74. Pass readiness: Ready, HOLD hint, immediate line green; takeover section renders and taps. (⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-46): readiness computed in the client from `group_id` / `serve_mode` and the live stages; an `ItemsReleased` turns its lines green alone.)
75. Config refetch on `BranchConfigApplied`.
76. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-49): the KDS store and the Pass store ignore `ItemStarted` / `ItemDone` / `ItemDoneUndone` / `FireDispatched` (and any line event) whose `order_item_id` they do not hold: no row, no card, no error.

### Acceptance

| Story AC | Test |
|---|---|
| E3-KDS AC1 | 65, 70, 74 (⚠️ Changed by v1.0.8 (owner 2026-11-13): + 67, 68, 76) |
| E3-KDS AC10 HOLD AT PASS (⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-46)) | 67, 74 |
| E3-KDS AC2–AC3 | 70, 71 |
| E3-KDS AC4 | 1, 5, 6, 70 |
| E3-KDS AC5 | client sound test, 50 (⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-44): + 54) |
| E3-KDS AC6 | 71 |
| E3-KDS edges | 5, 7, 52 |
| E5 dark screen | 40–43 |
| 02b O14 (estimate input) | 27 |

---

## §11. Build order (one task per commit, TDD)

| # | Task | Files | Spec |
|---|---|---|---|
| 0a | B-1 `run-pass` + Cook `reprint-ticket` default | `packages/domain/src/permissions.ts`, `apps/cloud/src/modules/staff-roles/default-roles.ts` (⚠️ Changed by v1.0.1 (G-5, owner 2026-11-11): was "hub + cloud migrations") | §4.5 B-1 |
| 0c | D-2: freeze `AlertDetailsBaseV2`, widen the base, `AlertRaised` v3 + upcaster + fixture; D-3 `printer_alert_ms` (03c) | `packages/events/src/alerts.ts`, `packages/events/src/events/alert/`, `packages/domain/src/alert-constants.ts` | §4.5 D-2 |
| 0b-1 | A-1 hub side: `ready_window_ms`, `kds_offline_ms` optional in the snapshot `engine_settings` schema + hub defaults | `packages/events/src/config.ts`, hub settings reader | §4.5 A-1 |
| 0d | Spec bumps with markers, **one per target, carrying 03c's rows too** (§4.5 note): 00 v1.9 (H-9, H-10, H-11), 01a v2.4, 01b v1.8, 01d v1.2.2 (D-2, D-3), 03a v1.2.1 (T-1), Foundation v1.12 (F-1, F-2), 02b v1.0.6 (⚠️ Changed by v1.0.2 (AD-15): was v1.0.4) (Q-1, **only after `module-02b` merges**, with 0b-2); README; S-1 | `docs/specs/*`, `docs/stories/stories-refined.md` | §4.5 |
| 0g | H-9 code: `ConnectedSession.stationId` | `apps/hub/src/ws/server.ts` | §4.5 H-9 |
| 1 | Error codes | `packages/domain/src/errors.ts` | §9 |
| 2 | `kds.ts` (`UNDO_DONE_MS`, `LineDetail`, `Identifier`) | `packages/domain/src/kds.ts` | §4.4 |
| 3 | Event schemas (6) + WS frames (4) | `packages/events/src/events/{order,hub}/`, `packages/events/src/ws.ts` | §6.22 |
| 4 | Migration | `apps/hub/src/db/migrations/NNNN_kds_pass.sql` | §5 |
| 5 | Projection `kds_config` (sound, lane mirror, day-open reset) | `apps/hub/src/kds/config-projection.ts` | §3.7, §3.8 |
| 6 | Projection `device_roles` + memory map + `point` target resolver (⚠️ Changed by v1.0.1 (G-1, owner 2026-11-11)) | `apps/hub/src/kds/device-roles.ts` | §3.8 |
| 7 | `SetStationScreen`, `SetDeviceRole` (admin) | `apps/hub/src/kds/commands/` | §6.9–6.10 |
| 8 | `StartItem`, `DoneItem` | `apps/hub/src/kds/commands/` | §3.2 |
| 9a | `UndoDone` (line part), `GiveMeMore` | same | §3.2 |
| 10 | `SetLaneState` (imports `liveStation`; ⚠️ Changed by v1.0.1 (G-4, owner 2026-11-11): was "`liveStation`, `requireStationInScope`") | same | §3.7 |
| 11 | `buildLineDetails`, `pointOfLine`, identifier rules | `apps/hub/src/kds/details.ts` | §3.1, §4.2 |
| 12 | Kinds `ready_to_serve`, `served_card`, `kds_offline` (module top level) | `apps/hub/src/kds/kinds.ts` | §6.21 |
| 13 | Projection `pass` (idempotent settling, registration after 02b) | `apps/hub/src/kds/pass-projection.ts`, registration line in `apps/hub/src/lib/boot.ts` | §3.5, §5 |
| 14 | `MarkReadyToServe`, `UndoReadyToServe` | `apps/hub/src/kds/commands/` | §3.5 |
| 15 | `Handover` (02b scope parity; ⚠️ Changed by v1.0.1 (G-3, owner 2026-11-11): through `orderCovered`, after 02b task P0.14) | same | §3.5 |
| 9b | `UndoDone` Ready part | same | §3.2 |
| 16 | Ticks `ready_retarget`, `pass_closures` | `apps/hub/src/kds/ticks.ts` | §6.18–6.19 |
| 17 | `handoversDue` | `apps/hub/src/kds/exports.ts` | §4.2 |
| 18 | Catch-up `kds_station` (body builder reused by takeover), frame `kds_lines` | `apps/hub/src/ws/kds-catch-up.ts` | §6.14, §6.16 |
| 19 | `pass-receivers`, `kds-config` queries | `apps/hub/src/queries/` | §6.11–6.12 |
| 20 | Tick `kds_presence`, screen-station map, `stationPresence()`, takeover frames (`tx.onCommit` / `due`) | `apps/hub/src/kds/presence.ts` | §3.6 |
| 21 | Catch-up `point_view`, frames `point_lines`, `station_takeover` | same | §6.15–6.16 |
| 22 | Event audiences (incl. takeover set) | `apps/hub/src/ws/kds-audiences.ts` | §6.17 |
| 23 | Config hook (archived) + `station_notice` | `apps/hub/src/kds/config-hook.ts` | §3.10 |
| 0b-2 | A-1 cloud + B-2 wire: settings endpoint / PATCH for the three keys, `served_estimate_ms` range and the 180 000 migration on existing rows (needs `module-02b` merged: cloud column) | 01a / 01b settings files, `packages/events/src/admin/staff.ts`, cloud migration | §4.5 A-1, B-2 |
| 0e | **To 02b:** tick `served_estimate` over `handoversDue` (after 0b-2, 17) | 02b's `apps/hub/src/orders/` tick file | §4.3 |
| 24–32 | KDS client: shell + session, **slots** (D12), station view, line row + timers, marks / moved / placeholders, Start / Done / Undo / Give me more, sounds, banners + config refetch, coming-up strip, lane screen | `apps/client/src/features/kds/` | §3.3, §8 |
| 33–38 | Pass screen: cards, readiness, Ready / Undo, hand-over tiles, screenless Start / Done + lanes, takeover sections | `apps/client/src/features/pass/` | §3.4, §3.6, §8 |
| 39–40 | Hub admin Kitchen screens: stations + sound + lanes, devices + roles + presence | `apps/client/src/features/admin/kitchen-screens/` | §3.8 |
| 41 | Manual pilot checks: pull a KDS cable mid-rush → Pass takeover + alert; reconnect; lanes at day open | `docs/plans/03b-manual-checks.md` | §3.6, §3.7 |

⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-42–Q-58): the v1.0.8 hub changes are tasks **HK1–HK6** (`docs/plans/03b-hub-gaps-plan.md`, branch `module-03b-hub-gaps`); client rows 24–40 are planned in `docs/plans/03b-client-plan.md` (wave 0 after 02's wave 0 is on `main`, Q-58; lanes K / P / A).

≈ 49 tasks (incl. 0a–0g, 0b split). Well under the ~60 split line; 03c is its own module (≈ 28 tasks).

---

## §12. Definition of Done, checklist, questions, deferred, reviews

### 12.1 Definition of Done

Gate green (`TMPDIR=/dev/shm … typecheck, lint, test`); every §10 test passes; statement counts asserted (65, 27); §12.2 ticked; §4.5 bumps approved and applied; manual checks (task 41); README 03b row → Implemented.

### 12.2 Endpoint checklist

| # | Endpoint / unit | Session · permission | Statements | Test |
|---|---|---|---|---|
| 1 | `StartItem` | station / `run-pass` | 0 | 1–4 |
| 2 | `DoneItem` | station / `run-pass` | 0 | 5, 6, 10 |
| 3 | `UndoDone` | station / `run-pass` | 2 | 7, 8 |
| 4 | `GiveMeMore` | station / `run-pass` | 0 | 9 |
| 5 | `SetLaneState` | station / `run-pass` | 1 | 11–13 |
| 6 | `MarkReadyToServe` | `run-pass` | 4 | 20, 21 |
| 7 | `UndoReadyToServe` | `run-pass` | 2 | 23 |
| 8 | `Handover` | `run-pass` | 4 | 24, 25, 28 |
| 9 | `SetStationScreen` | admin · `manage-devices` | 0 | 50 |
| 10 | `SetDeviceRole` | admin · `manage-devices` | 1 | 50 |
| 11 | `GET /queries/pass-receivers` | `run-pass` | 3 | 25 |
| 12 | `GET /admin/queries/kds-config` | admin · `manage-devices` | 3 | 51, 55 (⚠️ Changed by v1.0.8, Q-48) |
| 13 | `kds_station` + `kds_lines` | station | 3 / 2 (⚠️ Changed by v1.0.8, Q-47: ≤ 2 + 1 per hook (KDS), only in a commit with a table event) | 65, 66, 68 |
| 14 | `point_view` + `point_lines` + `station_takeover` | point staff | 4 / 2 (⚠️ Changed by v1.0.8, Q-47: ≤ 2 + 1 per hook (Pass), only in a commit with a table event) | 40, 65, 67, 68 (⚠️ Changed by v1.0.8, Q-45–Q-47) |
| 20 | Config-frame audiences (⚠️ Changed by v1.0.8, Q-44) | station / staff sockets | 0 | 54 |
| 15 | Tick `ready_retarget` | — | 2 + 2 | 22 |
| 16 | Tick `pass_closures` | — | 2 + 2 | 26, 27 |
| 17 | Tick `kds_presence` | — | 1 (cached) | 40–43 |
| 18 | Kinds ×3 | — | — | 53 |
| 19 | Projections ×3 | — | ≤ 2 / event | 13, 26, 50 |

### 12.3 Open questions

| # | Question | Owner of the answer |
|---|---|---|
| OQ-1 | ~~Printer model~~ answered; now 03c's. | closed |
| OQ-2 | ~~Upstream rows~~ answered (tasks 0a–0e, extended by R-4 with 0g and 0c's v3). | closed |
| OQ-3 | ~~Done confirm at `auto_done`~~ closed (v0.2). | closed |
| OQ-4 | ~~Reprint on 02b screens~~ answered R-6: 02b follow-up; Pass card reprint in 03c. | closed |

No open owner question in 03b v0.3.

### 12.4 Deferred until needed

Lane claims (K7, 01e); audio callouts (P3); per-zone walk times (K10); detecting a KDS whose socket is alive but whose display is dead; a second backup screen per station other than the Pass (R-3 uses the Pass only).

### 12.5 Run 1 closure

v0.2 §12.6 (git `3baab71`) closed every run 1 row; run 2 checked it (37 closed, 11 partly). Rows about printing now live in 03c v0.1 §12.

### 12.6 Run 2 closure (`03b_v0.2_hostile_run2.md`, verdict FIX) — 03b part

| Finding | Resolution |
|---|---|
| M-1 printer write timeout / USB thread pool | **→ 03c** (§3.14 there). |
| M-2 ack into a printer in error | **→ 03c** (owner R-5: suspect jobs reprint). |
| M-3 alert `details` stripped | Fixed: row D-2 (`AlertDetailsBase` fields, `AlertRaised` v3, task 0c); kinds use `pick`; tests 20, 21, 40 read the stored row and card frame. `printer_problem` in 03c uses the same row. |
| m-1 unknown status never clean | → 03c. |
| m-2 cancelled kitchen job / skipped fold | → 03c. |
| m-3 lanes mirror, 03a / 00 file edits | Fixed: mirror folds every `StationCapacitySet` (§3.7); imports exported helpers, no 03a edit; `ws/server.ts` change is task 0g, approved by R-4. |
| m-4 receiver scope | Fixed: 02b's `checkOrderScope` rules via `scopedOrders` (§3.5 step 2); parity test 25. |
| m-5 Ready held by later lines | Fixed: `pass_ready_lines`, closes on its own lines (§3.5); test 26. |
| m-6 loop raises | Fixed: one `closeMany` + one `raiseMany` (§6.18); test 22. |
| m-7 settings key / version / column / default | Fixed: `engine_settings`, optional keys with hub defaults (no snapshot bump), 0b after the 02b merge, 180 000 on existing rows (A-1). |
| m-8 config names | Fixed: `floors[].tables[].name`, `points[].name`, `stations[].name`, P-1 "T" rule (§3.1). |
| m-9 admin paths, admin WS | Fixed: `/admin/commands`, `/admin/queries`; `station_notice` to station sockets and the Pass only. Print routes → 03c. |
| m-10 `IDEMPOTENCY_KEY_MISMATCH` reuse | Fixed: hub-minted `handover_id`, step and error dropped. |
| m-11 task order / files | Fixed: kinds (12) before ticks and presence; Undo split 9a / 9b; 0b, 0e last; `lib/boot.ts` is 03c's (H-11). |
| m-12 no reprint for printer stations | → 03c (Reprint on the Pass card, R-6). |
| m-13 FIFO waits for status | → 03c. |
| m-14 CANCELLED "every removal" row | → 03c (02b v1.0.3 row). |
| m-15 slip units source, registration order | Registration order stated and tested here (§5, test 53); slip payload → 03c. |
| n-1 CLAUDE.md v1.9 | Owner's file (still open). |
| n-2 `ORDER_NOT_FOUND` details | Fixed: `{ order_item_id, order_id: null }`. |
| n-3 row ids collide with 00's | Fixed: H-9, H-10 (03c: H-11). |
| n-4 pull in P9 | → 03c. |
| n-5 signed-out Pass tablets | Fixed: `alertSockets()` → `signed_out` (§3.8). |
| n-6 `kds_offline` flapping | Fixed: close after 60 s connected (§3.6); test 41. |
| n-7 partial-write slip note | → 03c. |
| n-8 fallback step 4 | → 03c. |
| n-9 estimate stops after card expiry | Fixed: `handoversDue` on `open_lines`, not card state; test 27. |
| n-10 memory map refresh | Fixed: on `DeviceRoleSet`, pairing, `DeviceRevoked`. |
| n-11 config hook total | Fixed (§3.10). |
| n-12 retention / per-station cost | → 03c (printing tables). |
| Run 1 "partly" rows M-9, M-10, M-11, m-3, m-4, m-21, m-22 | Closed by m-5, m-3, m-7, m-9, m-8, m-4, m-6 above. Printing "partly" rows (M-3, M-6, m-18 part) → 03c. |

### 12.7 Targeted check closure (`03b_v0.3_03c_v0.1_targeted_check.md`, verdict FIX) — 03b part

| Finding | Resolution |
|---|---|
| M-1 settle fold double-decrement throws | Fixed: idempotent settling, `open_lines` decremented by rows changed, total fold (§3.5, §5); test 30 incl. rebuild. |
| M-2 screenless stations "dark" all day | Fixed: dark only for screen stations (paired `kds` device), D11, `screenless` in `stationPresence()` (§3.1, §3.6); test 42. |
| M-3 suspect window | → 03c v0.2. |
| m-1 lane inverse not unique; `LanesSet` dropped | Fixed: `LanesSet` kept for `SetLaneState` (G1-7), tie rule for foreign changes (§3.7, D10); test 13 clamped case. |
| m-2 takeover frame timing contradiction | Fixed: fires-tick pattern — start in `tx.onCommit`, end from `due` (§3.6, §6.20); test 40. |
| m-3 `GiveMeMore` scope | Fixed: `run-pass` staff for any station (§3.2); test 40. |
| m-4 v3 widens v2 too | Fixed: freeze `AlertDetailsBaseV2` (D-2). |
| m-5 version collisions | Fixed: one bump per target carrying both specs' rows; 02b dependency v1.0.3, Q-1 → v1.0.6 (⚠️ Changed by v1.0.2 (AD-15): was v1.0.4) (§4.5 note, task 0d). |
| m-6 Cook cannot reprint; Pass lacks printer flag | Fixed here: Cook default `reprint-ticket` (B-1); printer flag → 03c `order-tickets.has_printer`. |
| m-7 timing asserts | → 03c v0.2. |
| m-8 task order | Fixed: 0b-1 before 14, 0b-2 after the merge; `kds_station` builder (18) before presence (20); §4.3 "after 0b-2 and 17". |
| m-9 skip at `screen` station with a printer | → 03c v0.2. |
| m-10 03c editing 03b's client folders | Fixed: client slots (D12, §8); 03c registers from its own folder. |
| m-11 `handoversDue` line set | Fixed: unsettled lines only (§4.2); test 27. |
| m-12 catch-up claim | Fixed: live vs tip stated, idempotency makes them equal (§5); test 30. |
| n-1 CLAUDE.md v1.9 | Owner's file (still open). |
| n-2 closure reference | Fixed (header). |
| n-3 03c task count | Fixed (≈ 28). |
| n-4, n-5, n-9 | → 03c v0.2. |
| n-6 lost tests / lines | 03b part fixed: partial hand-over (24), move back → third alert (22), archived tickets still render (52); 03c part → 03c v0.2. |
| n-7 `currentTableOf` for dine-in | Fixed (§6.8). |
| n-8 `requireStationInScope` under `run-pass` | Fixed: station sessions only (§3.7). |
| n-10 dark station turning idle | Fixed: takeover ends, alert stays (§3.6 step 4); test 42. |

### 12.8 Re-check closure (`03b_v0.4_03c_v0.2_recheck.md`, APPROVE WITH WORDING FIXES) — 03b part

| Finding | Resolution |
|---|---|
| N-2 revoked KDS of a dark station | Fixed: takeover ends, alert `obsolete` (§3.6 step 5); test 42. |
| N-4 "same commit" not foldable | Fixed: append order + last write wins (§3.7); test 13 asserts the order. |
| N-5 "approved later" contradiction | Fixed: explicit fallback (§4.5 note). |
| N-6 02b v1.0.4 before the merge | Fixed: that bump (v1.0.6, ⚠️ Changed by v1.0.2 (AD-15)) runs with 0b-2 (§4.5 note, task 0d). |
| N-7 Cook grant untested here | Fixed: task 0a title, test 60. |
| N-1, N-3, N-8 | 03c v0.2.1 §12.6. |

