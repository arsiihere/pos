# Module 02b — Ordering · design decisions (core set, 67 frames)

All frames are new, drawn from `brief/02b-brief.md` (spec 02b v1.0.5) after the hostile review (`brief/02-brief-review.md`). Sample: Ali, F4 + F5 (Family hall, 9 guests), Round 2 at 8:10 PM: Raita from the counter, Naan ×6, Seekh ×4, Chicken Karahi Full (+ extra naan ×2, "less spicy"). The cashier Sana works the kiosk (takeaway 57 for Usman); the runner takes parking LEB 1234 (Sedan).

## 0. Owner decisions (2026-11-11)

Pulse Chatkhara maroon as in 01d (no unslop). Pulse table palette. The look builds on `s_order` (photo menu, category rail, cart with live times) from the Pulse reference `PCOrder`.

## 1. UX review (clutter report)

| Brief | Frames | Why |
|---|---|---|
| "New takeaway" + "New parking" + "Open orders" buttons on the map | **One `New order` primary** → 02-S04 sheet with two 150 px picture buttons. The kiosk home keeps the two big buttons always visible (the cashier does nothing else). | One primary per layer. |
| Per-line action buttons on every table-view line | **Tap a line → its actions open under it** (same pattern as the cart's open line): Mark served (ok tone), Remove, Comp / Send back / Enter weight / Void… as allowed. | 40 lines × 4 buttons is noise. |
| Table view bottom "Add items" + 02a "Take order" | **One button in the header** ("Add items · Round 4"). | Same command. |
| Cart footer: total + ready ring + Order note + Hold + Send | Kept as in `PCOrder` (total 32 px, "All ready by 8:27 PM" ring, Order note · Hold, Send 64 px). | It already holds the minimum. |
| Line shows "Ready-made" badge for `from_stock` | Dropped. A ready-made line just has an earlier time. | The time already says it. |
| "Comp it?" auto prompt after Remake (Q6) | **Changed 2026-11-12 (owner): automatic, as spec §8 asks.** See §6. | The spec wants the prompt. |
| Kitchen-note quick chips (Q2) | None, typing only (≤ 80 with a counter). | Not defined in setup. |
| Takeaway order view showing stages | **Served / Not served only**, plus one info line naming the gap (Q19). | No data for stages. |
| Abandoned list as a separate screen | A 4th tab on Open orders, **managers only**. | Same list shape. |

## 2. Owner questions §7 — answers used in the frames

| # | Decision |
|---|---|
| Q1 "N left" | Only at `low` ("4 left"). `not_counted` → "Not counted today" (tile greyed). |
| Q2 Note chips | None. |
| Q3 Bill paid during Send | Hold / Discard only. |
| Q4 Stage words | **Later · Sent to kitchen · Cooking · Ready · Served · 8:28 PM · Sent back · Served · closed · Not tracked · From the counter · Served · No kitchen — serve when ready · Weight pending** (frame `Stages`), each with an icon and a tone. |
| Q5 Add items on takeaway/parking | Hidden. New order makes a new token/plate order. |
| Q6 Comp after Remake | **Automatic “Comp it?” prompt** (owner 2026-11-12, spec §8 E-7). See §6. |
| Q7 Release sheet | Partners shown pre-ticked as "hurry it" (`ReleaseSheet`). |
| Q8 Zone alert names | Generic "A zone item is running low" + tap to the zone screen. |
| Q9 Slow chip | Station wait + cook time, in minutes ("25 min" clock chip). |
| Q11 Held orders | Only the person who held them, on this screen. |
| Q12 Open orders on tablets | All orders. |
| Q13 Takeaway name on the ticket | Token only. |
| Q14 Money | "Rs 2,200", commas in threes. |
| Q15 Comp reasons | Late · Wrong item · Quality · Guest · Other (Other needs a note). |
| Q16 Waiter and the order screen | Hidden (no New order, no Add items). |
| Q17 Kitchen progress | Refresh on open + "Kitchen progress updated 8:15 PM · Refresh". |
| Q18 Plain options after Send | Not shown. Only linked options (child lines) and the kitchen note. |
| Q19 Takeaway view | Served / Not served (see §1). |
| Q20 Remove takes the lock | The client sends Release after a table-view remove. |
| Q21 Takeaway comp card | "Comp · Takeaway order". |
| Q22 My zones first | Floor order. |
| Q23 Counter takeaway served | Button drawn for whoever has `mark-served`; the owner decides the grant. |

## 3. Per screen

| Screen | Decision |
|---|---|
| 02-S05 order screen | Top bar: back "Tables" + identity chip ("F4 + F5 · Family hall · Round 2 · Your table · 9 guests") + Live, clock, Requests, Inbox, me. Category rail 200 px with photos ("Breakfast · Not now · 7 AM" greyed). Menu: search + a 2-column photo tile grid. Cart 400 px: **groups with their promise** ("From the counter · Now", "Food together · 8:27 PM"), lines sorted by time, each line with qty, name, options, kitchen note, price, clock time. The open line shows the stepper, Edit and Remove. Footer: ring "All ready by", total, Order note · Hold, **Send to kitchen**. |
| 02b-C01 tile | Photo or monogram, name, sub, price, one chip: "4 left" (warn box), "25 min" (warn clock), "Sold out" (danger x), "Not counted today", "Not now · 7–11 AM", "Not available". Off tiles are greyed with the price struck. In-cart count is a maroon badge. |
| 02b-C02 zone tile | A green "6 here" counter chip. At 0: grey "0 here · kitchen". |
| 02-B05 line problem | The line turns danger-tinted with a reason and its way out inline (Set to 2 · Remove / Remove / Edit). A cart message reads "1 item can't be sent — fix it first". Send is turned off and reads "Fix 1 item first". |
| 02-B04 / 02-B02 | Times show "—"; the ring says "Times will be set when sent". The shared offline bar sits under the top bar ("Send still works — it waits here"). |
| 02b-B11 | The cart footer becomes "The day hasn't started" + "Ask the manager…" (Start day for managers). |
| 02-B03 | Info banner "Your unsent order is back · Kept on this screen since 8:09 PM". |
| 02-D04 options | 760 px dialog. Variant as a segmented control with prices. Groups with a rule pill (green "Choose 1" when met, orange when missing). Option chips with "+Rs 40" and "×2". A linked option that is sold out is turned off with the reason. Then the qty + live price + time line, and Kitchen note · **Add to order**. Unmet: Add is off and reads "Choose 1 in Gravy". |
| Weighed item | Segmented **Enter weight now / Weigh later**. Now: big kg field + number pad + live total. Later: a read line on who weighs it. |
| 02b-D30 deal | One card per part ("1× Main", "4× Bread"…), choices as chips with extra price, sold-out choice off, rule pill per part. Add says what is missing. |
| 02-D07 send | Sending: ring + "Sending to the kitchen…". Sent: final times per line, the moved line highlighted, an info line "Time updated: Karahi 8:29 PM", Done. Takeaway: **token 132 px**. Parking: the plate in a real plate style (mono, black ring). Queued: "Not sent yet · Token after sending". Queued takeaway sent later: a sticky card with the token on the kiosk. |
| 02-S06 orders part | Rounds as cards ("Round 2 · 8:10 PM · Ali", "Food at 8:29 PM"). Lines show qty, name, children indented, stage pill, price. The selected line opens its actions. A queued round is dashed with "Waiting to send". Round 1 (all served) is collapsed. The total adds "+ 1 to weigh". The Refresh line sits at the bottom. |
| 02b-C04 late card | Warning card on top: "F4 + F5 — about 6 min late", line stage chips, **Wait** / **Send what's ready** (solid warning). Several warnings → `ReleaseSheet`. |
| 02-D08 / D31 / D32 / D33 | Checklists with ready lines pre-ticked. Remove has a units stepper and shows cooking lines as off with "Void…". Send back is two 130 px choices, Fix / Remake. Comp has units, reason chips and **Ask for approval** (with the grant) or **Comp**. |
| 02b-C03 comp | Requester: a brand-tinted waiting card on the line ("Waiting for approval — Rs 2,200 comp", ring, Withdraw). Approver: 01d Requests card + answer sheet (Item, Units, Amount, Reason → Reject / Approve → PIN). |
| 02b-D34 / D35 / D36 | Weight on the kiosk (big kg field + pad). Contact: name + 30 px phone, logged. Boost: confirm in place on the order view. |
| 02-S07 open orders | Rows: token tile (saffron) or plate tile, type + who + phone icon, Ready n/m pill, promise. Ready rows are green. "from 6 Nov" badge. Filter: All · Takeaway · Parking (+ Abandoned for managers). The kiosk home shows the list + two big new-order buttons + Tables + Held. |
| 02b-S11 order view | Same side panel as the table view: token 80 px chip, Ready 1/3, promise, Call · Boost · Mark served, lines with Served / Not served. |
| 02-S08 held | Rows with Resume / Discard, "Only Ali sees these". |
| 02b-S12 zone stock | Rows: name, "warn at n", big count, Low / Empty pill (icon + word), Refill + / Count =. |
| 02-D14 queue log | Rows with an icon, what, why, time, and the actions the brief allows ("Send again as Ali", "Copy to a new order", Discard). |
| 02-B09 idle | Full maroon screen: lock ring, "Signed out after 15 min idle", "Your order is kept. 1 waiting item was sent first.", Sign in. |

## 4. New string keys

| Key | English |
|---|---|
| `order.new` / `.takeaway` / `.parking` / `.dinein_hint` | New order / Takeaway / Parking / Dine-in starts from a table on the map. |
| `order.takeaway.sub` / `.name` / `.phone` / `.phone_err` / `.skip` / `.next` | Both optional. The token comes after Send. / Customer name / Phone / Enter 10 to 13 digits / Skip / Next |
| `order.parking.plate` / `.plate_hint` / `.type` / `.small` / `.sedan` / `.large` | Car plate / required · English letters / Car type / Small car / Sedan / Large |
| `order.round` / `.your_table` / `.guests` | Round {n} / Your table / {n} guests |
| `menu.search` / `.left` / `.slow` / `.sold_out` / `.not_counted` / `.not_now` / `.not_available` / `.here` / `.here_kitchen` | Search the menu / {n} left / {n} min / Sold out / Not counted today / Not now · {window} / Not available / {n} here / 0 here · kitchen |
| `cart.title` / `.items` / `.empty` / `.from_counter` / `.food_together` / `.now` / `.all_ready` / `.times_later` | Order / {n} items / Tap items to add them / From the counter / Food together / Now / All ready by / Times will be set when sent |
| `cart.note` / `.hold` / `.send` / `.fix_first` / `.cant_send` | Order note / Hold / Send to kitchen / Fix {n} item first / {n} item can't be sent — fix it first |
| `cart.prob.only_left` / `.station_paused` / `.set_to` | Only {n} left / Kitchen station paused / Set to {n} |
| `day.not_started` / `.ask_manager` / `.start` | The day hasn't started / Ask the manager to start the day. Your order is kept. / Start day |
| `draft.back` / `.kept_since` | Your unsent order is back / Kept on this screen since {time} |
| `opt.choose` / `.up_to` / `.choose_missing` / `.add` / `.kitchen_note` | Choose {n} / Up to {n} / Choose {n} in {group} / Add to order / Kitchen note |
| `weight.now` / `.later` / `.later_note` / `.after_weighing` | Enter weight now / Weigh later / Added with “Weight pending”. The cashier or a manager enters the weight before the bill. / Price after weighing |
| `send.sending` / `.sent` / `.time_updated` / `.token` / `.not_yet` / `.not_yet_sub` / `.done` / `.new_takeaway` / `.new_parking` | Sending to the kitchen… / Sent / Time updated: {item} {time} / Token / Not sent yet / It will send when the hub is back. Token after sending. / Done / New takeaway / New parking |
| `send.queued_sent` | Takeaway sent |
| `tv.orders` / `.food_at` / `.to_weigh` / `.progress` / `.refresh` | Orders / Food at {time} / + {n} to weigh / Kitchen progress updated {time} / Refresh |
| `stage.*` | see §2 Q4 |
| `late.title` / `.wait` / `.send_ready` | {table} — about {n} min late / Wait / Send what's ready |
| `served.title` / `.sub` / `.mark_n` | Mark served / Ready lines are ticked. Lines the kitchen hasn't got yet can't be served. / Mark {n} served |
| `remove.title` / `.sub` / `.of` / `.use_void` | Remove items / Only before the kitchen starts. Free, no approval. / Remove {n} of {m} · not cooking yet / Already cooking — use Void |
| `return.title` / `.sub` / `.fix` / `.fix_sub` / `.remake` / `.remake_sub` / `.closed` / `.new_item` | Send back {item}? / No reason, no charge. A remade dish stays on the bill unless comped. / Fix / Same plate · reheat, add salt / Remake / New plate · full cook time / This order is closed / Send it as a new item |
| `comp.title` / `.needs_manager` / `.units` / `.ask` / `.do` / `.waiting` / `.withdraw` | Give {item} free? / Needs a manager's approval · online only / Units / Ask for approval / Comp / Waiting for approval — {amount} comp / Withdraw |
| `comp.takeaway_card` | Comp · Takeaway order |
| `contact.title` / `.logged` | Customer contact / this look is logged |
| `boost.confirm` | Ask the kitchen to hurry order {id}? |
| `orders.open` / `.abandoned` / `.ready` / `.promise` / `.from_date` / `.no_tap` | Open orders / Abandoned / Ready {n}/{m} / promise / from {date} / No kitchen tap for {n} h |
| `orders.stage_gap` | Kitchen stages aren't sent for takeaway yet: lines show Served / Not served. |
| `held.title` / `.only_you` / `.resume` / `.discard` | Held on this screen / Only {name} sees these. They don't keep the table locked. / Resume / Discard |
| `zone.title` / `.warn_at` / `.low` / `.empty` / `.refill` / `.count` / `.refill_title` / `.alert_low` | Zone stock / warn at {n} / Low / Empty / Refill / Count / Add {item} to {zone} / A zone item is running low |
| `queue.title` / `.sub` / `.signed_out` / `.changed` / `.send_again_as` / `.copy` | Not sent / Things this screen tried to send and the hub refused. / Not sent: {name} was signed out / Not sent: the table had changed / Send again as {name} / Copy to a new order |
| `idle.title` / `.sub` | Signed out after {n} min idle / Your order is kept. {n} waiting item was sent first. |
| `alert.comp.card` / `.lock`, `alert.slip_warning.*`, `alert.zone_stock_low.*`, `alert.zone_stock_out.*` | Comp / {table} · Comp · {name}; and the late / zone texts above |
| Toasts | as in 02b-T01 (frame `Toasts`) |

## 5. Still open (owner / hub)

- Q19 takeaway lines view, Q17 kitchen progress push, Q18 plain options after Send, Q21 token/plate on comp alerts, Q8 zone alert names: all hub changes. The frames show the honest fallback.
- Q23: who marks a counter takeaway served (grant `mark-served` to the cashier?).
- **Next frame set**: Urdu for every remaining screen, phone sheets for D04/D30/D31–D35, kiosk table view, 40-line cart, `426`, the deal-part g/ml remove error, and the "Still sending…" state.

## 6. Follow-up (owner 2026-11-12)

**Automatic “Comp it?” (spec §8, E-7).**
- **When it appears:** right after the hub accepts a round that re-sends a dish the guest already had. There are two cases:
  1. **“Send it as a new item”** on a closed order (`409 ORDER_NOT_IN_ENGINE` from Return).
  2. Adding a remade dish again after its replacement was removed.
- **Where:** on the table view, after the Sent result closes. If the round was queued offline, the prompt waits until it is sent (comp is online only).
- **The dialog** (`CompItPrompt`): “Comp the new Chicken Karahi?”, one line saying it is on the bill unless comped, and the item with its price.
  - **No, keep on the bill** → nothing changes; toast “Kept on the bill · You can still comp it from the line.” (`CompItNo`).
  - **Yes, comp it** (primary) → the usual Comp (`CompLine`) opens with the item and units filled in (`CompItYes`). The reason is still required; the button reads “Pick a reason” until one is chosen. After that the usual flow runs: Ask for approval → `CompWaiting` for order takers, or Comp at once with the grant.
- **Before Send** (`CompItCart`): the order screen opens with the same item and options in the cart as a new round. An info line says the prompt will come, and the line has a “Sent again · asks to comp” badge.
- **Copy change:** `SendBackClosed` now says “After it is sent you’ll be asked to comp it.”

**Zone items (spec §8).**
- **Zone empty** (`SentZoneEmpty`): a line sent `from_zone` that comes back with `zone_served: false` is shown **once**, in the Sent result, as a warn message “Zone empty — Raita sent to the kitchen” (or “…to the counter”, by the station it was routed to). That line keeps its new time, highlighted.
- **Zone Undo** (`ZoneUndo`): on the table view, a zone-served line shows **Undo · m:ss** for `zone_undo_ms` (default 5 min) from its `ItemAdded`, with “Puts 2 back in the Family hall count”. Undo sends the usual remove of that line (the fold adds the units back).
- **After 5 min** (`ZoneUndoLate`): there is no Undo. The line says “Too late to undo here. Fix the count on the zone screen.” with a **Zone stock** button.

| Key | English |
|---|---|
| `compit.title` / `.body` / `.yes_hint` / `.no` / `.yes` | Comp the new {item}? / Sent again for a dish the guest already had. It’s on the bill unless you comp it. / Yes opens Comp with the item and units filled in. You pick the reason. / No, keep on the bill / Yes, comp it |
| `compit.kept` / `.kept_sub` | Kept on the bill / You can still comp it from the line. |
| `compit.cart_info` / `.badge` | {item} is in a new round for {table}. After Send you’ll be asked to comp it. / Sent again · asks to comp |
| `comp.pick_reason` | Pick a reason |
| `zone.empty_sent` | Zone empty — {item} sent to the {kitchen\|counter} |
| `zone.undo` / `.undo_hint` / `.too_late` | Undo · {m:ss} / Puts {n} back in the {zone} count / Too late to undo here. Fix the count on the zone screen. |
