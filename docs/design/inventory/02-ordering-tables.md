# 02 — Ordering + Tables: screen inventory

**No spec yet.** Sources: stories E2 (all), E0-ORD AC1–3, E0-AVAIL AC2–3, E1-STOCK AC2–5, E10-CNT AC2–5, E5-DEV AC1/2/4 (device queue), E5-OFF AC1, E13-LANG; foundation §4.3 (table state machine, locks D5/D39/D51/D61), §4.4 (order state machine), §5.9 (submit lifecycle), §6.5 (catch-up); spec 00 §8.3 (login), §8.4, §8.5; README R5, R14, R15, R20 and every carried "02" requirement (mid-service safety, parking S10, kitchen note ≤ 80, units S44, windows S47, queued-command policy, pair resume N3, poll activity M59). Command names marked *(F)* come from the foundation; others are **proposed** for the 02 spec. Conventions in [00-index.md](00-index.md).

**R5 rule:** there is **one** order-taker view. Waiter, cashier, manager and owner use the same screens; actions appear, hide or show "needs approval" from `GET /queries/session` permissions. No screen is named for a role.

---

## 1. Who and where

| Who (permissions) | Device | How often | Conditions |
|---|---|---|---|
| Anyone who takes orders (placing orders — permission to be added by 02, Q1); scope may be own tables / a floor (01b) | Waiter tablet 1280 portrait/landscape (T); own phone 360–390 (P, BYOD) | 1 500–2 000 orders/day/branch; peak ≈ 200 orders per rush hour; a waiter takes an order every 1–3 min at peak | Walking, one hand, customer talking; noise; Wi-Fi drops near the kitchen |
| Counter staff taking takeaway/parking (same view) | Cashier kiosk 1920 (K, mouse + touch + keyboard, no browser back) | constant at lunch/dinner; parking orders taken by a runner at the car on a phone | Queue at the counter |
| `take-order-anywhere` | any | rare | opens a table locked by someone else |
| `force-release-table-lock` | any | a few per day | waiter went home with the table locked |
| Runner / waiter marking served, requesting bill, marking needs cleaning (D39: any holder of the permission, regardless of lock) | T, P | every order | — |
| Manager (manager view of held orders, E0-ORD AC1) | T, K | — | — |

Hub-only (LAN). Works without internet (E5-OFF AC1). Nothing works without the hub: the device keeps drafts and queues commands, and shows "Reconnecting" (E5-DEV). Rush at lunch 12:30–15:00 and dinner 19:30–23:30; breakfast 07:00–13:00 (paye).

## 2. Jobs to be done

| # | Job | Story AC | Acceptance |
|---|---|---|---|
| J1 | As staff, I need to log in on a shared device with my name and PIN so that every order is mine. | E0-PIN; 00 §8.3 | name grid (locked greyed + time left) → PIN → takeover dialog when someone else is logged in |
| J2 | As an order taker, I need to see every table's state at a glance so that I go where I'm needed. | E2-TBL AC1 | free, seated, ordered, food on table, bill requested, needs cleaning; colours configurable; never colour alone |
| J3 | As an order taker, I need to open a table and know nobody else can change its order so that orders don't collide. | E2-TBL AC2, AC3; D5, D39 | lock shown on every device with the holder's name; others blocked from create/edit only |
| J4 | As an order taker, I need the lock to stay while I build a long order. | E2-TBL AC6a; D61 | refresh ≤ 1/min while the screen is open |
| J5 | As an order taker, I need to tap items and see a live ETA per item so that I give an honest time. | E2-ETA AC1–6; E2-ADD AC2 | ETA within 1 s per item; sorted earliest→latest; clock time ("10:47 PM"), never truncated; preview only (no stock reserved) |
| J6 | As an order taker, I need to see sold-out, slow, out-of-hours and "4 left" items so that I don't promise what we can't deliver. | E2-SOLD AC1–3; E0-AVAIL AC2–3; E1-STOCK AC2, AC5; E10-CNT AC2–4; S47 | greyed "Sold out", clock icon + full cook time for slow, "4 left", ≤ 5 s update |
| J7 | As an order taker, I need to choose variants, extras and quantities (kg for karahi) so that the kitchen gets it right. | 01c; S44 | integer in sale unit; kg/L shown with 3 dp |
| J8 | As an order taker, I need item notes and an order note so that the kitchen reads "less spicy". | E0-ORD AC2; README kitchen note ≤ 80 | note printed verbatim, shown on KDS, no price effect |
| J9 | As an order taker, I need to submit and see the locked ETAs only when the hub confirms so that I never promise an unsent order. | E2-ETA AC6; E5-DEV AC4; E2-ADD AC3 | "Order sent" only after ack; fires immediately |
| J10 | As an order taker, I need to add items to a running table as a new sub-order so that the table keeps ordering. | E2-ADD AC1–4 | each addition own ETA; grouped by submission time on the table view |
| J11 | As an order taker, I need takeaway, parking (car plate) and other order types so that every customer is tracked. | E2-TBL AC9; S10 | counter number; car number main ID, car type sedan/mini/large with icons, optional phone, no table |
| J12 | As an order taker, I need to hold (park) an order without sending it so that the customer can decide. | E0-ORD AC1 | held orders visible to the same device and the manager view |
| J13 | As an order taker, I need to reorder a previous order so that regulars are quick. | E0-ORD AC3 | items pre-filled; unavailable items shown; ETA fresh at submit |
| J14 | As staff, I need to mark items served, request the bill and mark a table for cleaning, even if someone else holds the lock. | E2-TBL AC1 (D31), AC3 (D39); edge needs cleaning | first served item ⇒ food on table; needs cleaning blocks seating until cleared |
| J15 | As staff with permission, I need to move, merge and split tables so that seating changes don't break orders. | E2-TBL AC6b, AC7, AC8; edge pending void | move with reason; merge keeps items and ETAs; split → two independent bills; merge blocked by pending void |
| J16 | As a manager, I need to force-release a table lock so that a stuck table can be served. | E2-TBL AC5; edge crash | logged; auto-release after session end or 10 min TTL |
| J17 | As an order taker, I need my order to survive a hub restart or Wi-Fi drop so that I never lose it. | E5-DEV AC1, AC2, AC4, edges; README queued-command policy | draft kept; queue resent in order; Reconnecting shown; after session end: re-send as original staff or discard |
| J18 | As an order taker, I need to know immediately if the last paye went to another order so that I correct the promise. | E1-STOCK AC4; D7 | corrected ETA with full cook time shown at submit |
| J19 | As any staff, I need large labelled icons and text keys so that the screen works in Urdu later. | E13-LANG AC1–4; R20 | icon + word; Latin digits in Urdu |

## 3. Screen list

| ID | Name | Kind | Devices |
|---|---|---|---|
| 02-S01 | Staff login — name grid | screen | T, K, P (P: only the owner's tile) |
| 02-S02 | Staff login — PIN pad | screen step | T, K, P |
| 02-D01 | Someone else is logged in here — take over? | dialog | T, K |
| 02-S03 | Tables (floor tabs + table tiles) — home | screen | T, K, P |
| 02-S04 | New order — choose type (dine-in / takeaway / parking / delivery / web) | sheet | T, K, P |
| 02-D02 | Parking order details (car number, car type, phone) | sheet | T, K, P |
| 02-D03 | Takeaway details (counter number, optional name/phone) | sheet | T, K, P |
| 02-S05 | Order screen (menu + cart with live ETAs) | screen | T, K, P (P: menu and cart as two tabs) |
| 02-D04 | Item options (variant, extras, quantity, kg) | sheet | T, K, P |
| 02-D05 | Item note (≤ 80) | sheet | T, K, P |
| 02-D06 | Order note | sheet | T, K, P |
| 02-D07 | Submit — sending / sent / corrected ETAs | dialog / full-sheet | T, K, P |
| 02-S06 | Table view (running order: sub-orders, items, stages, ETAs, actions) | screen | T, K, P |
| 02-D08 | Mark served (pick items) | sheet | T, K, P |
| 02-D09 | Move table (pick free table + reason) | sheet | T, K |
| 02-D10 | Merge tables (pick second table) | sheet | T, K |
| 02-D11 | Split table (assign items to two new numbers) | screen-sheet | T, K |
| 02-D12 | Release someone's lock (force-release) confirm | dialog | T, K, P |
| 02-D13 | Mark needs cleaning / mark clean | dialog | T, K, P |
| 02-S07 | Open orders without a table (takeaway, parking, delivery) | screen / tab | K, T, P |
| 02-S08 | Held orders | screen / tab | T, K |
| 02-S09 | Reorder — pick a previous order | sheet | T, K |
| 02-D14 | Unsent orders from an ended session (send as … / discard) | dialog | T, K, P |
| 02-B01 | Table locked by Bilal | banner/tile badge | all |
| 02-B02 | Reconnecting — N orders waiting to send | banner | all |
| 02-B03 | Order kept on this device (draft) | banner | all |
| 02-B04 | ETA preview unavailable (hub unreachable while building) | inline | all |
| 02-B05 | Item became unavailable / sold out / out of hours while in the cart | inline + banner | all |
| 02-B06 | Stock count chip ("4 left") and slow chip (clock + "25 min") | chip | all |
| 02-B07 | Last unit taken by another order — ETA corrected | banner in 02-D07 | all |
| 02-B08 | Lock lost (released by TTL / manager) while building | banner | all |
| 02-B09 | You were logged out (idle) — order kept | full-screen → 02-S01 | all |
| 02-S10 | Phone layout of 02-S05 (menu / cart tabs, sticky submit) | screen variant | P |

**Count: 33.** Slip warnings shown on these screens are 03b-N01; void/remove actions on the table view are 04-S01; bill request hands over to 05-S03.

## 4. Per screen

### 02-S01 Staff login — name grid
- **Purpose:** pick who you are. **Entry:** device start, after pairing (00-S15), after logout/idle/takeover/forced logout. **Exit:** 02-S02.
- **Layout:** restaurant + branch name, clock (hub time) → hub status line → grid of name tiles (search box when > 24 names, Q2) → footer: device name.
- **Data:** `GET /queries/staff-roster` → `{ staff: [{ staff_id, display_name, locked_until }], active_session }` (poll not counted as activity, M59). On a phone: only the owner's tile → skip to S02.
- **States:** loading; empty ("No staff for this branch yet. Ask the owner."); locked tile "Locked · 14 min"; `401 DEVICE_TOKEN_INVALID` / `403 DEVICE_REVOKED` → wipe token, back to pairing (README N3) → 00-F02; `DEVICE_TYPE_NOT_ALLOWED`; hub unreachable 00-F01 with tiles from last load (Q3); 00-F03/F04/F06.
- **Sample:** Bilal, Imran, Sana, Ali, Usman, Zainab… (~20 per branch).
- **Steps:** 1 tap.

### 02-S02 PIN pad
- Name + "Not you?" → PinPad (reuse `PinPad`, 6 dots, LTR) → `POST /auth/pin { staff_id, pin }`.
- **States:** busy (keys locked); `PIN_INVALID` shake + "2 tries left" (≤ 2); `PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT` "Locked · 15 min"; `409 DEVICE_SESSION_ACTIVE` → 02-D01; `SERVICE_UNAVAILABLE` retry once then 00-F05; success → `GET /queries/session` → open `/ws` (auth frame) → 02-S03 (or back to the screen they were on, with the draft, after an idle logout).
- **Steps:** 4–6 digits + Enter (auto-submit on 6? Q4).

### 02-D01 Take over
"Bilal is logged in — log him out?" (`auth.takeover.confirm`). **Cancel** / **Log Bilal out** → retry `POST /auth/pin` with `takeover: true` (any staff with a correct PIN, R11). Bilal's unsent drafts stay on the device under his name (02-D14). **05 open question:** an open cash shift on the kiosk (05-D11).

### 02-S03 Tables (home)
- **Purpose:** see every table; open one; start a non-table order. **Entry:** login; back from any order. **Exit:** 02-S05 (free/own table), 02-S06 (running table), 02-S04, 02-S07, 02-S08.
- **Layout:** top bar (branch, logged-in name, hub/sync status dot, notifications bell → 03b-N01 list, Log out) → floor tabs (Ground floor, Family hall, Rooftop) with counts → table tiles grid (sort order from 01a) → bottom bar: **New takeaway**, **New parking**, **Open orders (7)**, **Held (2)**.
- **Tile content:** table name (big, LTR "T7"), state word + icon + colour (configurable colours, E2-TBL AC1), lock holder name ("Bilal"), seats, time since ordered ("32 min"), slip badge (03b), pending void badge (04), bill requested icon. Never colour alone.

| State | Colour default (story) | Word | Icon |
|---|---|---|---|
| FREE | white | Free | — |
| SEATED | blue | Seated | person |
| ORDERED | yellow | Ordered | ticket |
| FOOD_ON_TABLE | green | Eating | plate |
| BILL_REQUESTED | orange | Bill | receipt |
| NEEDS_CLEANING | grey | Clean | broom |
| + LOCKED overlay | border | "Bilal" | lock |
- Note: kit `ok` is blue and red–green is avoided; story colours conflict with the kit's status palette (Q5).
- **Actions:** tap free table → open (`OpenTable` → `TableLocked` *(F: TableOpened/TableLocked)*), seat customer (SEATED; Q6: separate step?), tap own/unlocked running table → 02-S06; tap table locked by someone else → 02-B01 (with `take-order-anywhere`: open anyway; with `force-release-table-lock`: 02-D12).
- **Data:** WS `catch_up.state.tables` (order-taker part, defined by 02) + events `TableLocked`, `TableLockReleased`, `OrderPlaced`, `ItemServed`, `BillRequested`?, table state events.
- **States:** loading catch-up (skeleton tiles); no floors ("Ask the owner to add tables"); scope filter (only my floor/tables when 01b scopes apply, others dimmed or hidden — Q3 in 01b); offline (tiles frozen, last update time, 02-B02); `TABLE_ALREADY_LOCKED` on open ("Bilal opened this table a moment ago").
- **Sample:** Ground floor T1–T12: T3 Ordered · Bilal · 18 min; T5 Eating; T7 Bill; T9 Clean; F2 Seated · Ali.
- **Edge:** two waiters tap the same free table at once → first wins, second gets `TABLE_ALREADY_LOCKED` with name; table merged (shows "T4 + T5"); hub down → no lock can be taken (P1: hub is the lock authority; D15 is P4).

### 02-S04 New order — type
Large buttons with icon + word: **Dine-in (table)**, **Takeaway (counter number)**, **Parking (car)**, **Delivery** (P2 story — Q7), **Web** (P4 — Q7). Order types share the same kitchen queue (E4-ETA AC4): no priority badge.

### 02-D02 Parking details (S10)
| Label | Type | Validation | Default | Req | API (proposed) | LTR |
|---|---|---|---|---|---|---|
| Car number | text, uppercase, mono, big | 2–12 chars, letters/digits/dash/space | — | yes | `car_number` | yes ("LEB 1234", "LEA-19-7788") |
| Car type | 3 picture buttons: Sedan / Small car (mini) / Large (SUV, van) | one | none | yes? (Q8) | `car_type: sedan \| mini \| large` | — |
| Phone (optional) | tel, numeric | 10–13 digits, `03xx` | — | no | `phone` | yes ("0300 1234567") |
- **Not in spec:** car **colour** and **parking spot** (asked in the brief) → Q8. The car number is shown **like a table number** everywhere (KDS, tickets, open orders).
- **Steps:** type plate (≈ 8 keys) + 1 type + Next = ~10.

### 02-D03 Takeaway details
Counter number (auto next number? typed? — Q9), optional name, optional phone (feeds P2 customer list). LTR number.

### 02-S05 Order screen
- **Purpose:** build an order with live ETAs. **Entry:** opened table, new takeaway/parking, reorder, held order resume. **Exit:** 02-D07 (submit), 02-S08 (hold), back (draft kept).
- **Layout (tablet landscape / kiosk):** header (order identity: "T7 · Ground floor" / "Parking LEB 1234 · Sedan" / "Takeaway #42"; holder name; lock status) → left: category rail (Breakfast, Karahi, BBQ, Breads, Drinks, Deals) + search → centre: item tiles → right: cart (lines with qty, options, note, price, **ETA per line**, sorted earliest→latest) → cart footer: total (preview, `lineTotalMinor`), order note, **Hold**, primary **Send to kitchen**. Portrait tablet: cart as bottom sheet. Phone: 02-S10.
- **Item tile:** name (+ variant hint), price ("Rs 450", "Rs 2,200 / kg"), chips 02-B06: "4 left" (stock), clock "25 min" (slow: stock 0 and full cook time > threshold), **Sold out** greyed (can't add), **Not now · 07:00–13:00** (out of hours, can't add), deal parts unavailable → Sold out. Tapping a disabled tile shows the reason (E0-AVAIL AC3) — never silent.
- **Cart line fields:** quantity (integer pieces; kg/L via 02-D04 with 3 dp; stored integer g/ml, S44), variant/options summary, note (≤ 80), line price, ETA ("12:47", absolute clock, hub time). Remove line (draft only, no approval — not yet sent).
- **ETA preview:** live, ≤ 1 s after each add (E2-ETA AC1). Source: preview query or local `@pos/engine` over WS state (Q10). Shown as clock time; "~" not allowed; very long queue still a full clock time ("10:47 PM").
- **Actions:** add item (tap; options → 02-D04), +/−, note (02-D05), order note (02-D06), Hold (`HoldOrder`? — Q11), Send (`SubmitOrder` *(F)* with `command_id`, enqueued in IndexedDB / SQLite first), Touch lock every ≤ 60 s while open (`TouchTableLock` *(F)*, no UI), Reorder (02-S09).
- **States:** catch-up loading; empty cart ("Tap items to add them"); offline while building (02-B04: ETAs shown as "—, will be set when sent", draft kept 02-B03); item changed while in cart (02-B05: "Paye sold out — remove it or keep and send? It will be refused" — must remove or the submit fails: Q12); lock lost (02-B08); permission missing to place orders (read-only menu, "You can't take orders on this device"); config applied mid-order (prices in the cart follow the new config until submit? Q13 — the hub copies config at submit time, D25).
- **Concurrent edit:** another waiter can't edit while locked; someone with `take-order-anywhere` opens the same table → both build independent sub-orders (D2) — show "Imran is also adding to T7".
- **Sample cart (T7, 13:05):** Chicken Karahi Full 1 kg Rs 2,200 · ETA 13:27 · "less spicy"; Naan ×4 Rs 120 · ETA 13:15; Lassi glass ×2 Rs 500 · ETA 13:08 (immediate); Seekh kebab ×6 Rs 900 · ETA 13:22 (BBQ, "4 left" → slow after 4).
- **Steps target:** new dine-in order of 5 items in **≤ 12 taps** (table 1 + items 5 + one option 2 + send 1 + confirm 0–1, plus 2 spare). Takeaway of 3 items ≤ 8. Parking ≤ 18 (plate typing).

### 02-D04 Item options
Variant (segmented: Half / Full), modifier groups (chips with price, min/max enforced: "Choose 1", "Up to 3"), quantity stepper or kg pad (`QuantityInput` style, LTR, "1.5 kg"), live line price and ETA. **Add** disabled until required groups are met. Weighted: price per kg shown; line total half-up (S44, owner Q13 in 01a).

### 02-D05 / 02-D06 Notes
Item note: text ≤ 80 with counter "34/80", quick chips (Less spicy, No onion, Well done — Q14: owner-defined?), printed verbatim. Order note: text (length Q14). Urdu input: RTL text inside an LTR layout cell — mark field `dir="auto"`.

### 02-D07 Submit
- **Sending:** "Sending to the kitchen…" (no "sent" until the hub answers, E5-DEV AC4). **Sent:** list of lines with locked ETAs + target land time for "together" items ("Food together at 13:27") → auto-close to 02-S06 after 2 s or **Done**. **Corrected:** 02-B07 "The last Paye went to another order. Paye now 13:40 (full cook time)." **Queued (offline):** "Not sent yet — will send when the hub is back" (02-B02), stays in the device queue; order shows "Waiting to send" on the table view.
- **Errors:** `TABLE_ALREADY_LOCKED` (someone took the table after a lock release: "Imran has T7 now. Your order is kept here." → Q15 what next); item unavailable/out of hours/sold out (codes TBD in 02) → back to cart with lines marked; `PERMISSION_DENIED`; `SESSION_EXPIRED` → 02-B09 (order kept); `VALIDATION_FAILED`.
- **Idempotency:** `command_id` ULID generated at Send, kept for every retry (D32); a retry after a lost answer returns the stored response (`Idempotent-Replay`).

### 02-S06 Table view (running order)
- **Purpose:** everything on one table. **Entry:** tap a running table; after submit. **Exit:** 02-S05 (Add items), 05-S03 (bill), 02-D08…D13, 04-S01.
- **Layout:** header (T7 · state · holder · seated time) → sub-orders grouped by submission time ("13:05 · Bilal", "13:40 · Bilal — added") each with lines: name, options, note, qty, stage (Waiting / Cooking / Ready / Served — plain words for ADDED/COOKING/COOKED/SERVED), ETA, "Hold at pass" (03b), slip badge "Running 6 min late" (03b), pending void "Waiting for approval" (04) → action bar: **Add items**, **Mark served**, **Ask for bill**, **More** (Move, Merge, Split, Boost (03a-D01), Reprint (03b-D02), Release lock, Needs cleaning).
- **Data:** WS events per order (`OrderPlaced`, `ItemAdded`, `ItemStarted`, `ItemDone`, `ItemServed`, `SlipWarned`, void events).
- **States:** read-only for someone not holding the lock (can still serve, ask bill, clean — D39); cancelled order (all items voided) shown struck through; order waiting to send (from queue) marked "Not sent yet".
- **Sample:** T7 — 13:05 Karahi Full (Cooking · 13:27), Naan ×4 (Ready · hold at pass), Lassi ×2 (Served); 13:40 Raita ×1 (Waiting · 13:48).

### 02-D08 Mark served
Checklist of Ready/Cooking items → **Mark served** (`MarkItemServed` *(F event ItemServed)*); first served item → table FOOD_ON_TABLE (D31). No lock needed (D39). Steps: 2–3.

### 02-D09 Move table
Pick a free table (grid of free tiles) + reason (chips + text, required — E2-TBL AC6b "logged with reason") → `MoveOrder`/`MoveTable` (proposed). Error: target taken meanwhile.

### 02-D10 Merge tables
Pick the second running table → "T4 and T5 become T4" (Q16 naming) → keeps items and ETAs. Blocked by pending void: "Resolve the void waiting on T5 first" (`VOID_PENDING`).

### 02-D11 Split table
Two columns "T7-A" / "T7-B" (new numbers — Q16), drag-free: tap an item to move it across (qty splitter for ×4 naan) → **Split** → two independent bills (05). Relationship to 05 split bill (E8-SPLIT) → Q17.

### 02-D12 Release lock
"Release Bilal's lock on T7? Anything he hasn't sent stays on his device." Permission `force-release-table-lock`; logged (`TableLockReleased reason: forced`).

### 02-D13 Needs cleaning / clean
After payment the table becomes NEEDS_CLEANING (F §4.3) automatically; staff mark **Clean** → FREE. A "needs cleaning" table blocks seating until cleared "by a manager or cleaner" (story) — permission TBD (Q18).

### 02-S07 Open orders without a table
List/cards: "Parking LEB 1234 · Sedan · 0300 1234567 · ETA 13:20 · Ready 2/3", "Takeaway #42 · ETA 13:12". Filters by type. Tap → 02-S06 equivalent. Sorted by ETA. Ready orders highlighted (runner takes to car).

### 02-S08 Held orders
Held on this device + (manager view) all devices: name, table/type, held by, held since, items. **Resume** → 02-S05; **Discard**. Held order does not lock the table? (Q11).

### 02-S09 Reorder
Previous orders of this table today / this phone number / this car (Q19 scope) → pick → cart pre-filled; unavailable items shown struck with reason (E0-ORD edge) → staff remove or proceed with the rest.

### 02-D14 Unsent orders from an ended session (README carried, 00 M19)
On login after a session ended with queued, never-processed commands: "2 orders from Bilal were not sent (T7 13:05, Parking LEB 1234)." Options per README policy: **Send as Bilal** (requires Bilal's PIN re-login? — the requirement says "re-sent after re-login as the original staff") or **Discard** (logged?). Q20 decides the exact rule.

### 02-B01 … B09
| ID | Text | Trigger |
|---|---|---|
| B01 | "Bilal has this table" (+ **Open anyway** if `take-order-anywhere`, **Release** if `force-release-table-lock`) | `TABLE_ALREADY_LOCKED` / tile lock |
| B02 | "Reconnecting… 2 orders waiting to send" | WS drop, queued commands |
| B03 | "Order kept on this device" | draft saved (IndexedDB / SQLite) |
| B04 | "Times will be set when the hub is back" | no ETA preview |
| B05 | "Paye is sold out now" / "Breakfast ended at 13:00" / "Deal not available: lassi jug sold out" | availability/stock/time-window event |
| B06 | "4 left" · clock "25 min" | stock projection |
| B07 | "Last Paye went to another order — new time 13:40" | submit result with corrected ETA (D7) |
| B08 | "Your lock on T7 ended (no activity for 10 min). Send to take it back." | `TableLockReleased` for own lock (D51) |
| B09 | "You were logged out after 5 min idle. Your order is kept." | `SESSION_EXPIRED` |

## 5. Flows (step → screen)

**F1 Dine-in, 5 items (target ≤ 12 taps)** 1 02-S03 tap T7 (lock) → 2 02-S05 Karahi → 3 02-D04 Full + Add → 4 Naan ×4 (+++) → 5 Lassi ×2 → 6 Seekh ×6 → 7 Send → 8 02-D07 Sent → 9 02-S06. Unhappy: T7 taken in between (B01); Seekh "4 left" → ETA slower for 2 (B06); hub drops at Send → queued (B02), "Not sent yet" on S06, auto-send on reconnect, then real ETAs; last unit race (B07).

**F2 Add items to a running table** 02-S03 T7 → 02-S06 → Add items → 02-S05 (new sub-order, own ETA, D2) → Send → S06 shows both groups sorted by time.

**F3 Takeaway** 02-S03 New takeaway → 02-D03 #42 → 02-S05 → Send → 02-S07 card; ticket prints (03b-P01) with "Takeaway #42".

**F4 Parking order at the car (runner on phone)** 02-S03 New parking → 02-D02 "LEB 1234", Sedan, 0300 1234567 → 02-S10 menu tab → items → cart tab → Send → 02-S07. Kitchen ticket shows the plate big (03b-P01). When Ready, the runner sees it highlighted in 02-S07 → Mark served at the car.

**F5 Delivery** — Q7 (story P2: address, zone, charge, rider; E2-TBL AC9 lists it as an opening order type).

**F6 Kitchen note** 02-S05 line → note → "less spicy, no coriander" (≤ 80) → Send → KDS ticket and print show it verbatim.

**F7 Move / merge** 02-S06 More → Move → 02-D09 T9 + reason "AC not working" → table map updates on all devices. Merge: More → Merge → 02-D10 T5 → blocked if T5 has a pending void (04).

**F8 Order while the hub is offline (phone)** 02-S05 building → hub restarts (power cut) → B04 + B03 → Send → B02 queued (command in IndexedDB) → hub back ≤ 90 s → queue replays in order (E5-DEV AC2) → 02-D07 Sent with ETAs (missed fires handled by 03a). Unhappy: session expired during the outage → 02-B09 → login → 02-D14.

**F9 Power cut mid-order on a tablet (app restart)** draft restored on reopen (B03); `session_token` was memory only → 02-S01 login → draft returns.

**F10 Two waiters on one table** Bilal holds T7; Ali taps T7 → B01; Ali has no take-anywhere → can still Mark served / Ask for bill (D39) via 02-S06 read-only.

**F11 Stuck lock** Bilal's tablet dies → lock auto-releases at session end (5 min) or 10 min TTL; manager does 02-D12 earlier.

**F12 Hold and resume** 02-S05 → Hold → 02-S08 → later Resume → Send.

**F13 Reorder** 02-S09 → choose → cart → remove "Paye (sold out)" → Send.

## 6. Data shown
| Entity | Fields (units) | Source |
|---|---|---|
| Table | name, floor, seats, state, lock holder (name, session), opened_at, merged_with | branch config (01a) + WS catch-up + table events |
| Order / sub-order | order_id, type (dine_in, takeaway, parking, delivery, web), table / counter no. / car {number, type, phone}, placed_at, placed_by, lines | WS catch-up `open_orders` + `OrderPlaced` |
| Order line | item name, variant/options/deal parts, qty (integer in sale unit; shown pieces/kg/L), price_minor, line total (`lineTotalMinor`), note ≤ 80, stage, ETA (hub ms → clock), serve mode, hold at pass, slip | copied at submit (D25, README mid-service safety) |
| Menu for ordering | categories, items, prices, units, windows, routes, availability, stock left (`saleUnitsAvailable`), slow flag | `GET /queries/branch-config` (01a §6.23) + WS stock/availability events |
| ETA preview | per line ready time, order target land time | engine (03a `calculateETA`) |
| Session | staff name, permissions, idle TTL | `GET /queries/session` |
| Device queue | pending commands, created_at, staff | local IndexedDB (browser) / SQLite (Capacitor) |

## 7. Cross-module links
- **Needs:** 00 login/session/WS/queue replay; 01a tables (tiles per floor, no positions), menu, units, windows (hub time), stock/availability; 01b staff, scopes, permissions, idle TTL; 01c variants/modifiers/deals on the line; 03a `calculateETA` and engine host (built before or alongside 02).
- **Gives:** `OrderPlaced` lines to 03a (plan), 03b (KDS tickets, prints — plate for parking, notes), 04 (item lifecycle actions start from 02-S06), 05 (bill from the order: lines, types for tax by bill type), 06 (events to sync), 07 (sales by order type).

## 8. Open questions (owner)
- **Q1** Is there a "take orders" permission, or can anyone logged in take orders?
- **Q2** How many staff per branch log in on one tablet? Search on the name grid?
- **Q3** If the hub is unreachable at the login screen, show last-known names (stale) or a reconnecting screen?
- **Q4** Submit the PIN automatically at 4 digits? (PINs are 4–6 digits, so no — but confirm an Enter key is fine.)
- **Q5** Table colours: the story says white/blue/yellow/green/orange/grey; the UI kit avoids red–green status and reserves `ok` = blue. Which palette, and are colours owner-configurable in P1 (E2-TBL AC1)?
- **Q6** Is "Seated" a separate step (seat customers, then order later), or does opening a table seat it?
- **Q7** Delivery and web are listed in E2-TBL AC9 but the delivery story is P2 and web is P4. Show them in P1?
- **Q8** Parking: is car type required? Do you need car **colour** and **parking spot/bay number** (asked in the design brief, not in S10)?
- **Q9** Takeaway counter number: auto-increment per day, or typed from a token?
- **Q10** ETA preview: computed by the hub per tap (needs a preview query) or on the device from the WS state? Affects the "≤ 1 s" target on cheap phones.
- **Q11** Does a held order keep the table locked? Can another device resume it?
- **Q12** An item in the cart becomes sold out: remove it automatically, or let the waiter decide before Send?
- **Q13** A menu price changes while an order is being built: does the cart show the new price before Send?
- **Q14** Are quick note chips owner-defined? Max length of an order note?
- **Q15** After `TABLE_ALREADY_LOCKED` on submit (lock lost), what can the waiter do with the kept order?
- **Q16** Names after merge and split (T4+T5? T7-A/T7-B?).
- **Q17** Split table (02) vs split bill (05): one feature or two?
- **Q18** Who may mark a table clean? Is it a permission?
- **Q19** Reorder from where: this table today, by phone number, by car number?
- **Q20** Queued orders from an ended session: re-send only after the same person logs in again, or let the next person send them under the original name, or discard? Is a discard logged?
- **Q21** Guests at a table call the waiter for "the bill" — is "Ask for bill" also on the cashier kiosk?

## 9. Design status
Not designed. ui-brief.md §2 lists 02 screens as "provisional" (login, table map, order screen, running order, order types, device status). Shared components to reuse from 01a: `PinPad`, `StaffTiles`, `BusyButton`, `Banner`, `QuantityInput` (any redesign of them must keep 02 working).

## Story AC → screen IDs
| Story AC | Screens |
|---|---|
| E2-TBL AC1 (states, colours, D31) | 02-S03, 02-D08 |
| E2-TBL AC2 (lock event, name on all devices) | 02-S03, 02-B01 |
| E2-TBL AC3 (lock scope, take anywhere) | 02-B01, 02-S06 (D39 actions) |
| E2-TBL AC4 (assigned to floors/tables) | 02-S03 (scope filter); assignment in 01b |
| E2-TBL AC5 (force-release, logged) | 02-D12 |
| E2-TBL AC6a (keep lock alive) | 02-S05 (no UI), 02-B08 |
| E2-TBL AC6b (move with reason) | 02-D09 |
| E2-TBL AC7 (merge) | 02-D10 |
| E2-TBL AC8 (split) | 02-D11 |
| E2-TBL AC9 (order types) | 02-S04, D02, D03 (delivery/web Q7) |
| E2-TBL edges (merge + pending void, crash, needs cleaning) | 02-D10, 02-D12/B08, 02-D13 |
| E2-ADD AC1–4 | 02-S06, 02-S05, 02-D07 |
| E2-ETA AC1–6 + edges | 02-S05, 02-D07, 02-S06 |
| E2-SOLD AC1–3 | 02-S05, 02-B05, 02-B06 |
| E0-ORD AC1 (hold, manager view) | 02-S08 |
| E0-ORD AC2 (order and item notes) | 02-D05, 02-D06 |
| E0-ORD AC3 (reorder) + edge | 02-S09 |
| E0-ORD AC4 (reprint) | 03b-D02 |
| E0-AVAIL AC2, AC3 | 02-S05, 02-B05 |
| E1-STOCK AC2 (order-taker count), AC4 (race), AC5 (slow) | 02-B06, 02-B07, 02-S05 |
| E10-CNT AC2, AC3, AC5 | 02-B06, 02-B07 |
| E10-CNT AC4 (web/QR ordering) | **no screen** (web ordering P4, QR P2) |
| E5-DEV AC1, AC2, AC4 + edges | 02-B02, 02-B03, 02-D07, 02-D14 |
| E5-DEV edge (outage exceeds window → manager alerted) | 06-B03 |
| E5-OFF AC1 (ordering offline) | no special screen (works on the hub) |
| E13-LANG AC1–4 | all (icon + word rule) |
| E0-PIN edge (shared device) | 02-D01 |
| E4-ETA edge (submit during hub restart) | 02-D07 queued |

**ACs with no screen:** E10-CNT AC4 (web/QR ordering, out of P1). E2-TBL AC9 delivery/web are listed but blocked by Q7.
