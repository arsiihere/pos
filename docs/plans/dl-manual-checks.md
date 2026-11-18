# DL manual checks — notification deep links (dl-plan Z2; 01d v1.3 §3.13)

The owner runs these on the pilot hub, on real devices, after every DL build task is merged into `module-deeplinks` and Z1 is green. They check what the gate cannot: real screens, real scrolling, how the glow looks on the tablets, and the kiosk. Tests 69–97 already cover the logic.

Never run `pnpm test:perf`, printer, hardware or power-loss checks as part of this list. Sounds are unchanged (01d §8.3); `01d-manual-checks.md` Check 8 still applies.

## 0. Before you start

### 0.1 Build and deploy

As `01d-manual-checks.md` §0.2, at the release commit of `module-deeplinks`. Open a business day (`/admin/stock/`).

### 0.2 Devices

| Name here | Hardware | Opens |
|---|---|---|
| **TAB-L** | pilot tablet, **landscape**, Chrome | `http://<hub>/staff/`: the Manager |
| **TAB-P** | second tablet, **portrait**, Chrome | `http://<hub>/staff/`: the Cashier |
| **PHONE** | an Order taker's phone, Chrome | `http://<hub>/staff/`: the Order taker (the table holder) |
| **KIOSK** | the Windows cashier PC, Chrome / Edge kiosk mode | `http://<hub>/staff/` (lands on `#/` KioskHome) |
| **PASS** | a point tablet bound to the Pass | `http://<hub>/staff/` → `#/pass` |
| **LAPTOP** | dev laptop on the LAN | `http://<hub>/admin/` (zones, tables) |

### 0.3 People and setup

| Name here | Role |
|---|---|
| **MGR** | Manager (approves voids and comps; `manage-zone-stock`) |
| **CSH** | Cashier (`void-item` needs approval by Manager, B-1 defaults) |
| **OT** | Order taker, holder of tables T4 and T5 on floor **Ground**; T12 is on floor **Roof** |

Seat T4, T5 and T12 with a few items each. Make one takeaway order (token #12). A zone with a stock-tracked drink at its threshold.

### 0.4 What "glow" looks like

A soft amber (brand) halo with a thin dark edge (light edge in the dark theme), once, for about 2 s, then gone. With reduced motion: a still ring for about 2 s. It must not look like the "late" colour that stays on.

---

## Check 1 — Call waiter opens the table (landscape and portrait)

1. On PHONE (OT), at T5, send **Call waiter** to the table team.
2. On TAB-L (MGR, Tables screen on floor **Roof**), tap the banner's **Open**.
   - **Expected:** the map switches to floor **Ground**, T5's sheet opens as the side panel, T5's tile is in view beside the panel and glows once. The banner goes. The Inbox row shows as seen.
3. Repeat step 1. On TAB-P (portrait), tap the Inbox card.
   - **Expected:** T5's sheet opens as a bottom sheet and its **header** glows (the tile is covered).
4. Tap the same Inbox card again.
   - **Expected:** it navigates and glows again. (No visible difference for seen; the hub log shows one `MarkAlertsSeen` for the alert.)

## Check 2 — Void approval: line glows, then the answer sheet (DL Q-1)

1. On TAB-P (CSH), in T4's sheet, ask to void 1 unit of a line.
2. On TAB-L (MGR), from another screen (`#/orders`), tap the urgent banner's **Open**.
   - **Expected:** T4's sheet opens, the round with the line is open, the line scrolls to the centre and glows; then `AnswerSheet` (Approve / Reject + PIN) opens on top, with the glow visible behind the scrim.
3. Approve with MGR's PIN.
   - **Expected:** as today (line shows the void). On TAB-P the requester's result notice arrives.
4. On TAB-P, tap that result.
   - **Expected:** if units remain, the line glows and then the notice card opens on top. If the full line was voided, the notice card opens over the current screen with no "no longer open" message (DL Q-3).

## Check 3 — Served round unfolds (DL Q-2)

1. In T12, mark every line of one round served (the round folds to "Served · n items").
2. On TAB-P (CSH), ask a comp on a line of that round. On TAB-L (MGR), tap the comp request in the Inbox.
   - **Expected:** T12 opens on floor **Roof**, the folded round opens by itself, the served line glows, then `AnswerSheet` opens on top.
3. Close the sheet and fold the round by hand.
   - **Expected:** it folds again normally.

## Check 4 — "This item is no longer open."

1. Raise a `call_waiter` at T4, then bill and clean T4 (guests leave). On TAB-L, tap the old call in the Inbox.
   - **Expected:** a toast "This item is no longer open." for about 4 s; the screen does not change; the row shows as seen.
2. Seat a new party at T4, then tap the same old call again.
   - **Expected:** still "This item is no longer open." (the new party is not the old call).

## Check 5 — Notices keep their facts (DL Q-3)

1. On TAB-P (CSH), ask a void; on TAB-L (MGR), **Reject** it with a note "wrong item".
2. On TAB-P, tap the rejected result.
   - **Expected:** the line glows, then the notice card opens on top with "Rejected" and the note "wrong item".
3. On TAB-P, use **Approve here** for another void request with MGR's PIN. Later, sign MGR in on TAB-L and tap the "answered at another tablet" notice.
   - **Expected:** the line glows, then the notice card with the device name, the time and **"Not you?"**.

## Check 6 — Zone stock banner lands on the row

1. Sell the zone's drink below its threshold.
2. On TAB-L (MGR), tap the zone banner's **Open**.
   - **Expected:** `#/zones` opens, the drink's row scrolls into view and glows. (Before v1.3 it only opened the page.)

## Check 7 — Merge: the call follows the surviving table (M1)

1. On PHONE, at T5, send **Call waiter**. Then on TAB-L merge T5 into T4.
2. On TAB-L, tap the call.
   - **Expected:** the merged table's sheet (T4 + T5) opens and its primary tile T4 glows. No "no longer open".

## Check 8 — Slip warning: dine-in LateCard, takeaway answer sheet (M3)

1. Let a dine-in table's slip warning fire (03a). On PHONE (OT), tap it.
   - **Expected:** the table sheet opens and the **LateCard** glows ("Send what's ready" / "Wait" answer there); no separate answer sheet.
2. Let the takeaway #12 slip warning fire. Tap it.
   - **Expected:** `#/orders/<id>` opens, the order block glows, then `AnswerSheet` (Send what's ready / Wait) opens on top; the answer works.

## Check 9 — Phone tabs

1. On PHONE, tap a dine-in notification (call waiter or comp).
   - **Expected:** the **Tables** tab is marked; the line or sheet header glows in the bottom sheet.
2. Tap the zone banner (if OT has the zone) or a takeaway notification.
   - **Expected:** the **Orders** tab is marked.

## Check 10 — A dialog blocks the banner; drafts are kept (M5)

1. On TAB-P, open the **Send** dialog on T4's order screen. Raise a `call_waiter` at T5 from PHONE.
2. On TAB-P, tap the banner's **Open**.
   - **Expected:** the Send dialog stays; the call's detail card opens over it (no navigation).
3. Close everything. Start a new cart on T12's order screen (do not send). Tap a notification from the Inbox.
   - **Expected:** it navigates. Then `#/held` lists the T12 draft and reopens it with every item. T12's lock is not released by the tap.

## Check 11 — Kiosk: Back chip and lock-only rows (DL-K1)

1. On KIOSK (signed in as CSH), on `#/` KioskHome, open the Inbox and tap a linked notification (e.g. the result of a void CSH asked on takeaway #12).
   - **Expected:** the place opens and glows; a **Back** chip shows in the top bar.
2. Tap **Back**.
   - **Expected:** KioskHome again; the chip is gone.
3. With a void escalated to the kiosk (lock-only row), tap it.
   - **Expected:** it navigates and glows; **no** answer sheet opens (the kiosk cannot answer).
4. Sign out on KIOSK.
   - **Expected:** the lock panel shows; nothing on it can be tapped.

## Check 12 — Pass tablet glows in place

1. On PASS (signed in), wait for a `ready_to_serve` escalation for an order on the Pass. Tap it.
   - **Expected:** its Pass card glows in place; the screen does not change; no sheet.
2. Sign out on PASS.
   - **Expected:** the lock panel only; nothing tappable.

## Check 13 — Reduced motion

1. On TAB-P, turn on Android **Remove animations** (Settings → Accessibility). Reload `/staff/`.
2. Tap any linked notification.
   - **Expected:** no smooth scroll and no fading halo: a still amber ring with a thin edge for about 2 s, then gone.

## Check 14 — Offline

1. On TAB-L, unplug the hub's network (or stop Wi-Fi on TAB-L) so the header shows no connection.
2. Tap a call-waiter row.
   - **Expected:** "No connection to the hub"; the screen does not change.
3. Tap a void request row (MGR).
   - **Expected:** `AnswerSheet` still opens over the current screen; its PIN pad is disabled ("No connection to the hub").
4. Reconnect.

## Check 15 — Kinds with no place keep today's tap (DL Q-0a)

1. Unplug a printer (a `printer_problem`) and send a test alert to TAB-L.
2. Tap each.
   - **Expected:** the detail card opens over the current screen as before v1.3; no navigation; no glow.

## Check 16 — Urdu text and the look in both themes

1. Switch TAB-P to Urdu. Trigger check 4 step 1 and check 11 step 1.
   - **Expected:** the toast reads "یہ آئٹم اب کھلا نہیں ہے۔" and the kiosk chip shows the Urdu "Back". Mark any wrong wording in `docs/design/handoff/01d/urdu-todo.md`.
2. Switch to the dark theme and repeat check 1 step 2.
   - **Expected:** the glow has a light edge and is clearly different from the late (amber) status colour, which stays on, while the glow goes after about 2 s.

---

## Results

| Check | Device(s) | Result | Notes |
|---|---|---|---|
| 1 | TAB-L, TAB-P | | |
| 2 | TAB-L, TAB-P | | |
| 3 | TAB-L, TAB-P | | |
| 4 | TAB-L | | |
| 5 | TAB-L, TAB-P | | |
| 6 | TAB-L | | |
| 7 | TAB-L, PHONE | | |
| 8 | PHONE | | |
| 9 | PHONE | | |
| 10 | TAB-P | | |
| 11 | KIOSK | | |
| 12 | PASS | | |
| 13 | TAB-P | | |
| 14 | TAB-L | | |
| 15 | TAB-L | | |
| 16 | TAB-P | | |
