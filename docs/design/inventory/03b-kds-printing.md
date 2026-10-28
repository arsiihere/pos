# 03b — KDS + Printing: screen inventory

**No spec yet.** Sources: stories E3-KDS, E3-PRT, E3-RCPT, E0-HW AC1/2/4/5/6, E0-TPL (rendering), E0-ORD AC4 (reprint), E4-SLIP AC2–4 (on screens), E5-PWR AC7/8, E1-FLR AC6; foundation §4.7 (hold at pass, completion modes), §5.8 (print queue, REPRINT); README R8 (58/80 mm, USB/LAN), R12 (template rendering), R17 (QR via `qrSvg`), 03b carried (station-scoped StartItem/DoneItem, archived-station warning); spec 00 §8.4 (`kds.replaced`, `STATION_LOGOUT_NOT_ALLOWED`). Conventions in [00-index.md](00-index.md).

---

## 1. Who and where
| Who | Device | How often | Conditions |
|---|---|---|---|
| Cooks at a station (no PIN: **station session**, actor null, device id, 00 M30) | KDS wall screen or counter tablet (W), **dark theme**, 1920×1080 or 1280; read at 1–3 m | Tandoor: hundreds of naan per rush; karahi counter 60–80 karahis; degh a few loads | Heat, steam, greasy/wet hands, glare, noise; no hover; 72 px targets; no confirmations in normal use |
| Expo / pass (all-stations view) | W / T | constant | Sees hold at pass |
| Waiters (receive slip warnings) | T, P | several per rush | walking |
| Staff with `reprint-ticket` | T, K | a few per day | printer jam |
| Manager (printer alerts; station output config) | T, K, hub admin | rare; alert during rush | paper runs out at 13:30 |
| Cashier (bill/receipt prints) | K + counter printer | every bill | — |

Printers: thermal ESC/POS, 58 mm and 80 mm, USB and LAN (R8); one per station + counter. Cash drawer kicks on cash close (E0-HW AC2).

## 2. Jobs to be done
| # | Job | Story AC | Acceptance |
|---|---|---|---|
| J1 | As a cook, I need my station's queue sorted by when to start so that I always know what's next. | E3-KDS AC1, AC2 | sorted by latest-start; one station or all |
| J2 | As a cook, I need each ticket to show item, modifiers, note, table/type, target time and a countdown. | E3-KDS AC3 | parking shows car number |
| J3 | As a cook, I need big Start and Done buttons with no confirmation. | E3-KDS AC4, AC9 | per completion mode; Done before Start warns (two-tap) |
| J4 | As a cook, I need new, late, boosted, fire-now and hold-at-pass tickets to stand out. | E3-KDS AC5–7, AC10; E4-HF AC6 | sound + colour + word/icon; volume per station |
| J5 | As a batch cook, I need the current load, the next load and its countdown. | E3-KDS AC8 | per program |
| J6 | As a cook, I need tickets on paper when my screen dies. | E3-PRT AC1–3; E0-HW AC4, AC5 | auto-print fallback; persistent queue; order kept after restart |
| J7 | As staff with `reprint-ticket`, I need to reprint any ticket and have it logged. | E3-PRT AC4; E0-ORD AC4 | queued if printer offline |
| J8 | As a manager, I need to know a printer is out of paper. | E3-PRT edge | alert; job stays queued |
| J9 | As a waiter, I need one slip warning per table, dismissable, escalating to the manager if ignored. | E4-SLIP AC2–4 | "[Table X] [Item] is running N minutes late — let the customer know." |
| J10 | As a cashier, I need bills and receipts on the counter printer with logo, tax details, pending voids. | E3-RCPT AC1–4 | QR omitted in P1 (D20) |
| J11 | As a manager, I need to know an archived station still has open tickets. | E1-FLR AC6 (03b carried) | warn on that KDS and hub admin |
| J12 | As an admin, I need to set each station to screen, printer, or both. | E3-PRT AC1; E0-HW AC1 | printer address, width |

## 3. Screen list
| ID | Name | Kind | Device |
|---|---|---|---|
| 03b-S01 | KDS — station queue (slot station) | screen (dark) | W |
| 03b-S02 | KDS — batch station (current load, next load, countdown) | screen (dark) | W |
| 03b-S03 | KDS — all stations / expo (pass) | screen (dark) | W, T |
| 03b-C01 | Ticket card (normal, new, late, boosted, fire now, cooking, done, hold at pass, cancelled/voided) | component | W |
| 03b-B01 | New ticket alert (sound + colour) | state | W |
| 03b-B02 | Late ticket (red + word) | state | W |
| 03b-B03 | Boosted ticket marker | state | W |
| 03b-B04 | HOLD AT PASS | state | W |
| 03b-B05 | FIRE NOW | state | W |
| 03b-B06 | Archived station warning | banner | W, hub admin |
| 03b-B07 | Screen offline → printing instead (on other screens / admin) | banner | admin, W |
| 03b-D01 | Done before Start warning | inline prompt (no modal) | W |
| 03b-S04 | This screen is open in another window (`kds.replaced`) | full-screen | W |
| 03b-S05 | Station settings on the KDS (volume, view one/all) | sheet | W |
| 03b-S06 | Printers and print queue (status, paper out, jobs waiting) | hub admin screen | T, K |
| 03b-S07 | Station output config (screen / printer / both, printer address, 58/80 mm, USB/LAN) | admin screen (home: Q1) | L / T |
| 03b-D02 | Reprint ticket (pick ticket → printer) | dialog | T, K |
| 03b-N01 | Slip warning notification (grouped per table) | notification card + list | T, P, K |
| 03b-N02 | Slip escalation to manager | notification | T, P |
| 03b-N03 | Printer offline / out of paper alert to manager | notification | T, P, K |
| 03b-P01 | Kitchen ticket — 80 mm | print | printer |
| 03b-P02 | Kitchen ticket — 58 mm | print | printer |
| 03b-P03 | REPRINT ticket (header) | print | printer |
| 03b-P04 | Cancelled after print (strikethrough reprint) | print | printer |
| 03b-P05 | Counter bill (renders 05 template) 80/58 mm | print | counter |
| 03b-P06 | Receipt (renders 05 template) 80/58 mm | print | counter |
| 03b-P07 | Template live preview renderer (used by 05-S14) | preview component | L |

**Count: 27.**

## 4. Per screen

### 03b-S01 KDS — station queue
- **Entry:** paired KDS boots → station session (`POST /auth/station`) → this view. **Exit:** none (always on); 03b-S05 settings; 03b-S04 if replaced.
- **Layout (1920 landscape):** header (station name "Tandoor", clock (hub), counts "8 waiting · 3 cooking", connection dot) → columns/rows of ticket cards (03b-C01) sorted by latest-start ascending; boosted on top → footer: done strip (last 5 Done, tap to undo? Q2).
- **Ticket (C01):** big identifier ("T7", "LEB 1234" for parking, "#42 takeaway"), item × qty ("Naan ×4"), variant/options, note (verbatim, highlighted), target time "13:27", countdown to start ("Start in 2:10" / "START NOW"), stage, buttons per completion mode:

| Mode | Buttons |
|---|---|
| two_tap | **Start** then **Done** |
| single_tap | **Done** (shown started when fired) |
| auto_done | **Start**; Done applied automatically at planned end; a late Done tap shows "Already done" |
- **Actions:** `StartItem`, `DoneItem` (`stationScoped`, actor null, device id; command_id). No confirmation. Busy: optimistic? (Q3 — must not show Done before ack unless queued safely).
- **States:** first load (catch-up `station_queue`); empty "Nothing to cook"; offline/hub restarting (00-F01 banner; tickets stay; taps queued with device `occurred_at`, E5-PWR AC6); clock alarm 03a-B01; archived station 03b-B06; `ITEM_WRONG_STAGE` (another screen already tapped) → card updates silently; voided item (04) → card struck "Cancelled" then removed; replaced → 03b-S04; `STATION_LOGOUT_NOT_ALLOWED` → no logout button.
- **Sample:** Tandoor 13:05: T3 Naan ×6 START NOW; LEB 1234 Roghni naan ×2 start in 1:30; T7 Naan ×4 "less crispy" start in 2:10 (boosted).
- **Edge:** multiple cooks at one station → taps logged under the station (no per-cook attribution in station sessions — conflicts with E3-KDS edge "each tap logged under the logged-in cook" → Q4); Done before Start (two-tap) → 03b-D01 inline "Tap Start first" (no modal).
- **Taps:** 1 per Start, 1 per Done.

### 03b-S02 KDS — batch station
Current load (program "Paye degh 240 min", items, started 05:00, ready 09:00 countdown), next load (items pulled in within freshness window, fire countdown "Fire in 4:00"), later items. Start/Done act on the whole load (Q5). Fired loads are closed (D34).

### 03b-S03 All stations / expo
Columns per station or grouped by order; HOLD AT PASS items (03b-B04) per order until the last sync item is Done ("T7 · 2 of 3 ready · hold"); then "T7 ready to serve". Waiter-facing runner screen? (Q6).

### 03b-B01…B05 ticket states
| ID | Visual | Word | Sound |
|---|---|---|---|
| B01 New | accent edge + "New" | New | per-station volume (E3-KDS AC5) |
| B02 Late | danger tint | "Late 4 min" | none? (Q7) |
| B03 Boosted | thick border + bolt icon | "First" (never VIP) | — |
| B04 Hold at pass | warn tint | "HOLD AT PASS" | — |
| B05 Fire now | flashing (reduced-motion: static) | "FIRE NOW" | alert |
Never colour alone; readable at 3 m in dark theme.

### 03b-S04 Open in another window
"This screen is open in another window" (`kds.replaced`) + **Use this window** (calls `/auth/station` once).

### 03b-S05 KDS settings sheet
Volume (per station), view single/all (E3-KDS AC1) — who may change it on a no-PIN screen? (Q8).

### 03b-S06 Printers and queue (hub admin)
Rows: printer name, station(s), connection (LAN `tcp://192.168.0.120:9100` / USB serial, LTR), paper width, status (Ready / Offline / Out of paper — if detectable, Q9), jobs waiting, last printed. Actions: Test print, Retry now. Alert N03 when a printer goes offline.

### 03b-S07 Station output config
Per station: **Screen only / Printer only / Screen + printer** (E3-PRT AC1), printer pick, width 58/80, auto-print when screen offline (always on per AC2). Counter printer for bills/receipts. Cash drawer attached to which printer (Q10).

### 03b-D02 Reprint
From 02-S06 line/order or 03b-S06 job list: pick ticket(s) → printer → **Reprint** (`reprint-ticket`; "needs approval" possible; logged; queued if offline: "Will print when the printer is back").

### 03b-N01 Slip warning (waiter)
Card: "T7 Karahi is running 6 minutes late — let the customer know." (E4-SLIP AC2 text), grouped per table ("T7: Karahi, Seekh kebab"), **Customer informed** (acknowledge, command TBD). Lives in a notifications list (bell on 02-S03) + toast. Queued while the device is offline; delivered on reconnect. Same text for boost-caused slips (no reason). No browser notifications (insecure origin, ui-brief §3.1) — in-app only.

### 03b-N02 Escalation (manager)
"T7 slip not acknowledged by Bilal for 3 min" → manager taps → 02-S06.

### 03b-N03 Printer alert
"Tandoor printer is out of paper. 6 tickets waiting." → 03b-S06.

### 03b-P01 / P02 Kitchen ticket (80 / 58 mm)
Fields per E0-TPL AC2: station name; table / order type ("T7" / "PARKING LEB 1234 SEDAN" / "TAKEAWAY #42") in double size; item name + qty; modifiers; item notes (verbatim, inverted or boxed); order note; timestamp (hub, 13:05); order ID (short); target time. 58 mm: 32 chars/line; 80 mm: 48. Urdu item names: needs a raster font path on ESC/POS (Q11).
```
TANDOOR                     13:05
================================
T7                  Bilal
--------------------------------
4 x Naan
    > less crispy
2 x Roghni naan
--------------------------------
Ready by 13:27   #01JH...7Q2
```
**P03 REPRINT:** first line "*** REPRINT ***" (after restart: unconfirmed jobs, D24; manual reprint too). **P04:** Done tapped after print (screen + printer): strikethrough reprint "CANCELLED — done on screen" (E3-PRT edge; exact wording Q12).

### 03b-P05 / P06 Bill and receipt
Rendered from 05's template (R12): logo, name, address, NTN, bill no., table/type, staff, lines (PENDING VOID lines labelled and excluded), subtotal, service charge, tax by class, total; receipt adds payments with amounts and change due; footer; no QR in P1 (D20). See 05-P01/P02 for content.

## 5. Flows
1. **Normal ticket:** 02 Send → ticket appears on Tandoor KDS (B01 sound) and prints if configured → at latest-start FIRE NOW (B05) → cook Start → Done → item Ready; if sync siblings pending → B04 on expo → last Done → "ready to serve" → waiter marks served (02-D08).
2. **KDS dies mid-rush:** screen offline detected → B07 on admin, all pending + new tickets for Tandoor auto-print (P01) → replacement paired (00 F2) → screen returns; Done on screen cancels unprinted jobs.
3. **Printer out of paper:** jobs stay queued → N03 to manager → paper replaced → prints in order.
4. **Power cut:** hub back → print queue resumes; unconfirmed jobs → P03 REPRINT; KDS re-renders without refresh (catch-up); missed fires FIRE NOW.
5. **Slip:** engine `SlipWarned` → waiter N01 → Customer informed; ignored 3 min → N02 to manager.
6. **Reprint:** 02-S06 → More → Reprint → D02.

## 6. Data shown
Station queue (catch-up `station_queue`: items with latest_start_at, target_land_time, stage, order identity, options, note, boosted, hold_at_pass, batch load), WS events (`ItemAdded`, `FireDispatched`, `ItemStarted`, `ItemDone`, `ItemVoided`…), print jobs (`print_jobs`: printer_url, created_at, sent_at, acked_at, is_reprint), slip events, config (stations, completion_mode, printers).

## 7. Cross-module links
Needs 00 station sessions/pairing (station picker), 01a stations and completion modes, 01c options on tickets, 02 orders (plate for parking, notes), 03a fires/queues/slips/hold at pass, 04 voids (cancel tickets), 05 bill/receipt template content (R12). Gives KDS taps (stage 2/3) to 04 lifecycle and 03a; print infrastructure to 05 (bill, receipt, Z report).

## 8. Open questions (owner)
- **Q1** Where is station output (screen/printer/both, printer addresses) configured: owner app (cloud, part of station) or hub admin (printers are local hardware)?
- **Q2** Can a cook undo a mistaken Done? (No command for it in the foundation.)
- **Q3** Should the KDS show Start/Done instantly (before the hub answers) and queue taps when the hub is down?
- **Q4** KDS uses station sessions (no person). The story says "each tap logged under the logged-in cook". Do cooks log in on the KDS?
- **Q5** Batch station: Start/Done per load or per item?
- **Q6** Is there a runner/expo screen in P1, or does the waiter see "ready" on 02-S06 only?
- **Q7** Should late tickets also make a sound?
- **Q8** Who can change KDS volume and view on a screen without a PIN?
- **Q9** Which printer models (OQ2/OQ14)? Can they report "out of paper"?
- **Q10** Which printer drives the cash drawer?
- **Q11** Urdu item names on thermal tickets (post-P1) need raster printing — plan now?
- **Q12** Exact text for the cancelled-after-print slip.
- **Q13** Station screen offline detection: how long before tickets auto-print (seconds)?

## 9. Design status
Not designed. ui-brief.md §2 lists KDS queue, `kds.replaced`, slip warnings, ticket and receipt layouts as "coming next". Kit dark theme exists (pair screen).

## Story AC → screen IDs
| Story AC | Screens |
|---|---|
| E3-KDS AC1 | 03b-S01, S03, S05 |
| E3-KDS AC2, AC3 | 03b-S01, C01 |
| E3-KDS AC4, AC9 | 03b-C01 |
| E3-KDS AC5 | 03b-B01, S05 |
| E3-KDS AC6 | 03b-B02, N01 |
| E3-KDS AC7 | 03b-B03 |
| E3-KDS AC8 | 03b-S02 |
| E3-KDS AC10 | 03b-B04, S03 |
| E3-KDS edges | 03b-D01, C01 (auto_done "Already done"), B07 |
| E3-PRT AC1 | 03b-S07 |
| E3-PRT AC2, AC3 | 03b-B07, P01–P03 |
| E3-PRT AC4 | 03b-D02 |
| E3-PRT edges | 03b-N03, S06, P04 |
| E3-RCPT AC1–4 | 03b-P05, P06 (content 05-P01/P02) |
| E0-HW AC1 | 03b-S07 |
| E0-HW AC2 (drawer kick) | no screen (05 cash close triggers it) |
| E0-HW AC4, AC5 | 03b-B07, S06 |
| E0-HW AC6 (kiosk mode) | no screen (installation) |
| E0-TPL AC2 (kitchen ticket fields) | 03b-P01, P02 |
| E0-TPL AC3 (live preview) | 03b-P07 (used by 05-S14) |
| E0-TPL AC4 (next job only) | no screen (rule) |
| E0-ORD AC4 (reprint, logged) | 03b-D02 |
| E4-SLIP AC2–4 + edges | 03b-N01, N02 |
| E5-PWR AC7 | 03b-P03 |
| E5-PWR AC8 | 03b-S01 (catch-up) |
| E1-FLR AC6 | 03b-B06 |

**ACs with no screen:** E0-HW AC2, AC6 and E0-TPL AC4 — rules/installation, no screen needed.
