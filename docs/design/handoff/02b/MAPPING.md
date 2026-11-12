# Module 02b · Ordering — mapping

Every screen in the brief (§3 screen list) → its frames (one per state). Behaviour, data and error codes: the brief. Components and CSS: `CHANGES.md` §3 and `PROMPT.md` step 2. 60 frames, all new.

| Screen | Name | Kind · devices | Frames (state) |
|---|---|---|---|
| **02-S04** | New order — choose type (takeaway / parking; dine-in comes from the map) | sheet · T K P | `NewOrder.dc.html` — New order — Takeaway or Parking (one primary on the map) (tablet) |
| **02-D03** | Takeaway details (name, phone — both optional) | sheet · T K P | `Takeaway.dc.html` — Takeaway details — name, phone; phone error inline (tablet) |
| **02-D02** | Parking details (plate, car type, phone) | sheet · T K P | `Parking.dc.html` — Parking details — plate big mono LTR, car type pictures (tablet)<br>`ParkingPhone.dc.html` — Parking at the car — runner’s phone (phone) |
| **02-S05** | Order screen (menu + cart + live times) | screen · T K | `Order.dc.html` — Order screen — live time per line, group promise, counter line, Send (tablet)<br>`OrderEmpty.dc.html` — Empty cart — Send off (tablet)<br>`OrderLoading.dc.html` — Menu loading — skeleton tiles (tablet)<br>`OrderKiosk.dc.html` — Cashier kiosk — takeaway, deal line open, wider cart (kiosk)<br>`OrderPortrait.dc.html` — Tablet portrait — menu full width, summary bar; cart opens as a sheet (tablet portrait)<br>`OrderUrdu.dc.html` — Order screen — Urdu RTL; prices, times, table names LTR (tablet) |
| **02-S10** | Order screen, phone (Menu / Cart tabs) | screen · P | `OrderPhoneMenu.dc.html` — Phone — Menu tab, zone count, sticky Send bar (phone)<br>`OrderPhoneCart.dc.html` — Phone — Cart tab, line open (phone) |
| **02b-C01** | Menu tile (all availability states) | component · T K P | `MenuTiles.dc.html` — Menu tile — every availability state, zone count (component) |
| **02b-C02** | Zone tile "Raita · 6 here" | component · T K P | `MenuTiles.dc.html` — Menu tile — every availability state, zone count (component) |
| **02-D04** | Item options sheet (variant, options, quantity, weight) | sheet · T K P | `Options.dc.html` — Item options — variant, defaults visible, linked option off with reason (tablet)<br>`OptionsUnmet.dc.html` — Required group not met — Add says what is missing (tablet)<br>`OptionsWeight.dc.html` — Weighed item — Enter weight now (50 g steps) (tablet)<br>`OptionsWeighLater.dc.html` — Weighed item — Weigh later (“Weight pending”) (tablet) |
| **02b-D30** | Deal sheet (parts and choices) | sheet · T K P | `Deal.dc.html` — Deal — parts, choices with extra price, sold-out choice off (tablet) |
| **02-D05** | Kitchen note (≤ 80) | sheet · T K P | `KitchenNote.dc.html` — Kitchen note ≤ 80 (order note ≤ 200 is the same sheet); no quick chips (Q2) (tablet) |
| **02-D06** | Order note (≤ 200) | sheet · T K P | `KitchenNote.dc.html` — Order note uses the same sheet, ≤ 200 chars |
| **02-B05** | Cart line problem (sold out / not now / off / station paused) | inline + banner · T K P | `OrderProblem.dc.html` — Line problem — “Only 2 left”: Set to 2 / Remove; Send waits (tablet) |
| **02-B04** | Times unavailable (preview failed / offline) | inline · T K P | `OrderOffline.dc.html` — Hub offline — times “—”, “set when sent”; Send queues (tablet) |
| **02-B03** | "Your unsent order is back" / kept as draft | banner · T K P | `OrderDraftBack.dc.html` — Draft restored after sign-in — info banner (tablet) |
| **02-B06** | Stock and slow chips ("4 left", clock "25 min") | chip · T K P | `MenuTiles.dc.html` — Menu tile — every availability state, zone count (component) |
| **02-B07** | Last unit taken / time updated (inside 02-D07 and on the line) | inline · T K P | `OrderProblem.dc.html` — Line problem — “Only 2 left”: Set to 2 / Remove; Send waits (tablet) |
| **02-D07** | Send: sending / sent / queued / time updated / zone empty / token | dialog / sheet · T K P | `Sending.dc.html` — Sending — no “sent” until the hub answers (tablet)<br>`Sent.dc.html` — Sent — final times, “Time updated: Karahi 8:29 PM” (tablet)<br>`SentToken.dc.html` — Takeaway sent — token 57, very big (kiosk)<br>`SentParking.dc.html` — Parking sent — plate big, car type (phone)<br>`SentQueued.dc.html` — Queued offline — “Not sent yet”, token after sending (kiosk)<br>`OpenOrdersQueued.dc.html` — Queued takeaway sent on reconnect — sticky “token 57” card (kiosk) |
| **02-S06** | Table view — orders part (rounds, lines, stages, actions) | screen part · T K P | `Stages.dc.html` — Line stage words and badges (Q4) (component)<br>`TableView.dc.html` — Table view — rounds by time, stages in words, line actions on the selected line (tablet)<br>`TableViewWaiter.dc.html` — Waiter — only Mark served (tablet)<br>`TableViewOffline.dc.html` — Offline — queued round “Waiting to send”, Mark served queues (tablet)<br>`TableViewPhone.dc.html` — Phone — rounds, selected line actions wrap (phone)<br>`TableViewUrdu.dc.html` — Table view — Urdu RTL (tablet) |
| **02b-S11** | Takeaway / parking order view | screen · T K P | `OrderView.dc.html` — Takeaway order view — token big, Ready 1/3, Served / Not served only (data gap Q19) (tablet) |
| **02-D08** | Mark served (pick lines) | sheet · T K P | `MarkServed.dc.html` — Mark served — ready lines pre-ticked (tablet) |
| **02b-D31** | Remove lines (stage 1, units) | sheet · T K P | `Remove.dc.html` — Remove — units stepper; cooking lines point to Void (04) (tablet) |
| **02b-D32** | Send back (fix / remake) and "Send it as a new item" | sheet / dialog · T K P | `SendBack.dc.html` — Send back — Fix or Remake, one tap (tablet)<br>`SendBackClosed.dc.html` — Closed (> 30 min) — “Send it as a new item” (tablet) |
| **02b-D33** | Comp (units, reason) | sheet · T K P | `Comp.dc.html` — Comp — units, reason chips; “Ask for approval” for order takers (tablet) |
| **02b-C03** | Comp waiting card (requester) + comp request card (approver) | card · T K P | `CompWaiting.dc.html` — Requester — “Waiting for approval — Rs 2,200 comp” + Withdraw on the line (tablet)<br>`CompRequests.dc.html` — Approver — comp cards in Requests; takeaway comp has no table code (Q21) (tablet)<br>`CompAnswer.dc.html` — Approver — answer sheet (01d), raw reason code mapped to “Quality”, then PIN (tablet) |
| **02b-D34** | Enter weight | sheet · T K P | `EnterWeight.dc.html` — Enter weight — cashier, number pad in kg, live total (kiosk) |
| **02b-D35** | Customer contact ("Call") | sheet · T K P | `Contact.dc.html` — Call — name and phone big, only with view-customer-contact (tablet) |
| **02b-D36** | Boost order | inline confirm · T K P | `Boost.dc.html` — Boost — confirm in place on the order (tablet) |
| **02b-C04** | Late-food card (grouped per current table) + "Send what's ready" sheet | card / sheet · T K P | `TableViewLate.dc.html` — Late card on top — “F4 + F5 — about 6 min late”, Send what’s ready (tablet)<br>`ReleaseSheet.dc.html` — Send what’s ready — ready lines and their partners to hurry (Q7) (tablet) |
| **02-S07** | Open orders (takeaway, parking; abandoned for managers) | screen · T K P | `OpenOrdersKiosk.dc.html` — Cashier kiosk home — open orders by promise, Ready highlighted, Takeaway / Parking (kiosk)<br>`OpenOrdersAbandoned.dc.html` — Managers only — Abandoned tab (any type) (tablet)<br>`OpenOrdersPhone.dc.html` — Phone — Orders tab, plates and tokens, Ready first (phone) |
| **02-S08** | Held orders (this screen's drafts) | screen / list · T K P | `Held.dc.html` — Held orders — this screen, this person; Resume / Discard (tablet) |
| **02b-S12** | Zone stock (my zones: counts, Refill, Count) | screen · T K P | `ZoneStock.dc.html` — Zone stock — counts, Low / Empty with icon + word, Refill + / Count = (tablet)<br>`ZoneRefill.dc.html` — Refill — stepper, new count preview (tablet) |
| **02b-C05** | Zone running low / empty alert card | card / banner · T K P | `ZoneAlert.dc.html` — “A zone item is running low” — generic until names are sent (Q8) (tablet) |
| **02-B02** | Reconnecting — n waiting to send (queue bar) | bar · T K P | `OrderOffline.dc.html` — Hub offline — times “—”, “set when sent”; Send queues (tablet) |
| **02-D14** | Queue log (not sent: Send again / Discard / Copy to a new order) | screen / sheet · T K P | `QueueLog.dc.html` — Queue log — Send again as Ali / Copy to a new order / Discard (tablet) |
| **02-B09** | Screen locked (idle) | full screen · T K P | `IdleLock.dc.html` — Screen locked (idle) — queue sent first, draft kept (tablet) |
| **02b-B11** | Day not started | inline / banner · T K P | `OrderDayNotStarted.dc.html` — Day not started — “Ask the manager” (tablet) |
| **02b-T01** | Toasts of this module | toast · T K P | `Toasts.dc.html` — Toasts of the ordering module (component) |

## Component sheets

- `MenuTiles.dc.html` — 02b-C01 · C02 · B06 · Menu tile — every availability state, zone count (component)
- `CartLines.dc.html` — 02b · Cart line — times, counter, time moved, deal, weight, problems (02-B05) (component)
- `Stages.dc.html` — 02-S06 · Line stage words and badges (Q4) (component)
- `Toasts.dc.html` — 02b-T01 · Toasts of the ordering module (component)
