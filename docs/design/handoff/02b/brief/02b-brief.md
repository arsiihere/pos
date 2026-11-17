# 02b Ordering — design brief (staff screens)

**For:** the designer, in a separate chat, with no repo access. This file is all you get, so everything is stated here.
**Covers:** every staff screen, sheet, dialog, card, banner and toast of module **02b Ordering**: the order screen (menu, cart, live times), item options and deals, notes, takeaway and parking orders, sending, the orders part of the table view (rounds, stages, served, remove, return, comp, weight, boost, contact), late-food cards, open orders, held orders, zone stock, the device command queue and queue log, the device idle lock, and "day not started".
**Not covered here:** the table map and table actions (open, lock, hand over, move, merge, split, bill request, clean, call waiter). That is **02a Tables**, with its own brief. It appears here only as context and placeholders (§6).
**Sources:** spec 02b Ordering v1.0.5 (APPROVED), spec 02a Tables v1.1.4 where it touches orders, the upstream specs that show on these screens (menu 01c, timing 03a, alerts 01d, roles 01b, platform 00), the built hub code (field names below are as built), the 02b status board rulings, the screen inventory (IDs like `02-S05` are kept), and the Pulse design system already used by the 01d alerts screens.
**Rule of precedence:** this brief wins on behaviour and copy. Your frames win on layout and look. If a state is missing, ask; do not invent behaviour. Open points are in §7.

Words used:

| Word | Meaning |
|---|---|
| **Order** | One send to the kitchen. "Drinks first, food later" = two orders. Each send is a new order. |
| **Round** | How staff see an order on the table view: "Round 2 · 8:10 PM · Ali". |
| **Line** | One item in an order, with a quantity ("Naan × 4"). A deal is a line with **part lines** under it; a linked option ("extra naan" on a karahi) is a **child line**. |
| **Seating / party** | One group at a table (02a). A dine-in order belongs to the party, not the table, so it follows the party when it moves. |
| **Holder** | The person who has the party (02a). Only the holder (or someone with `take-order-anywhere`) adds orders or removes lines on it. |
| **Lock** | "Someone is typing an order on this table." The order screen holds it while open (02a). |
| **Promise** | The time we tell the guest: when a group of lines will be on the table. Shown as a clock time. |
| **Zone** | An area of a floor (e.g. "Family hall"). A zone can keep ready stock (raita, water bottles) on a counter; those lines are served from the zone, not the kitchen. |
| **Stage** | Where a line is: not sent yet / waiting in the kitchen / cooking / ready / served / sent back. |
| **Hub** | The small computer in the restaurant. Nothing is decided without it; the screen keeps drafts and queues sends when it is away. |
| **T / K / P** | Tablet (1280 × 800 landscape, 800 × 1280 portrait), cashier Kiosk (1920 × 1080, mouse + touch + keyboard, no browser back), staff Phone (390 × 844, also 360 wide). |

---

## 1. Purpose and users

### 1.1 What this module is for

Take an order fast and honestly: tap items, see **a real time for each item** before sending (the kitchen's actual load, not a guess), know what is sold out or slow before promising it, send it to the kitchen, and then follow the table's food: what is cooking, what is ready, mark it served, send a dish back, give one free, remove a line before the kitchen starts. Also takeaway (with a token number) and parking (orders taken at a car, by plate). It must keep working when the Wi-Fi drops: nothing typed is ever lost.

### 1.2 Who uses it

There are no role-named screens. Everyone uses **the same screens**; buttons appear, hide or show "needs approval" from the person's own permissions (owner rule R5). The roles below are the shipped defaults; a restaurant can change them.

| Default role | Relevant permissions | What they do here |
|---|---|---|
| **Order taker** ("captain") | `take-order` (branch), `mark-served`, `mark-item-returned`, `boost-order` (branch), `view-customer-contact` (own tables / own orders), `apply-comp` (**needs a manager's approval**) | Takes dine-in orders on their tables, adds rounds, removes lines at stage 1, marks served, sends dishes back, asks for comps, boosts, sees the phone of their own orders |
| **Waiter** (runner) | `mark-served` (branch). **No `take-order`.** | Marks food served on any table; sees rounds and stages; nothing else |
| **Cashier** | `take-order` (branch), `set-line-weight`, `view-customer-contact` (branch), `apply-comp` (**needs approval**) | Takeaway and parking at the counter on the kiosk; enters weights of weighed items; sees contacts. **No `mark-served`** by default |
| **Manager / Owner** | everything, including `apply-comp` without approval, `manage-zone-stock`, approving comps, the abandoned-orders list, starting the day (`manage-stock`) | All of the above, plus approve comps on their own device with their PIN |
| **Refill person** (any role the restaurant chooses) | `manage-zone-stock` (scope: my zones, or branch) | Refills and counts the zone counters (raita, water); gets "running low" alerts |

Permission scopes: `branch` (anything), `my_floors` (tables on my floors; for takeaway/parking: orders I placed), `own_tables` (parties I hold; for takeaway/parking: orders I placed), `my_zones` (zones assigned to me or my lead). Grants: `allowed`; `requires_approval` (only for comps: the button shows "needs approval" and asks a manager); `not_granted`/`denied` (hidden). The client reads them from `GET /queries/session` → `permissions: { [p]: { grant, scope?, approver_role_ids? } }`.

### 1.3 Devices

| Device | Who | Notes |
|---|---|---|
| **T** tablet (Android app) | order takers, managers | Main ordering device. Shared: people sign in and out. Has its own offline queue (SQLite). |
| **K** cashier kiosk (Windows, Chrome kiosk) | cashier | 1920 × 1080; mouse, keyboard, touch; **no browser back**. Takeaway and parking all day. |
| **P** phone (own phone, browser page) | runner taking a parking order at the car, order takers, waiters | 390 wide, one hand. Menu and cart as two tabs. Offline queue in the browser (IndexedDB). Alerts only while the page is open. |
| Kitchen screens, printers | — | 03b/03c (not here). Kitchen tickets print the token big, the plate big, notes verbatim. |

### 1.4 A real shift (Saturday dinner, Arif Chatkhara, Gulberg)

7:45 PM. Ali opens F4 for a family of 6 (02a). The order screen opens with the menu on the left and an empty cart on the right. He taps **Drinks → Lassi (sweet) × 3, Mint Margarita × 2, Water bottle × 1** and **Raita** — the raita tile says "Raita · 6 here": it is served from the Family hall counter, no kitchen. Each line shows a time ("7:49 PM"). He taps **Send**: "Sending to the kitchen…" then "Sent". The table turns **Ordered** — drinks alone never turn a table green. Ten minutes later the family decides: **Chicken Karahi — Full** (the options sheet asks Half / Full; he adds "less spicy" as a kitchen note), **Seekh kebab × 6** (tile says "4 left" — the stepper stops at 4, he adds 4 and tells the guest), **Naan × 6**, and a **Family Deal** where the guest picks Roghni naan (+Rs 30) instead of plain. The cart sorts by time: naan 8:12, seekh 8:20, karahi 8:27. The karahi's time is honest because the karahi station has 9 karahis queued. Send → the promise moves by 2 minutes; the screen shows "Time updated: karahi 8:29 PM". At 8:28 a waiter taps **Mark served** on the karahi: the table turns **Eating**. The guest says the karahi is cold: Ali taps the line → **Send back → Fix** (reheat, same plate). At 9:20 the father wants **one more naan**: a new round, sent in 3 taps. At 9:40 a guest says the remade dish from 40 minutes ago was wrong: **Send back** says "This order is closed (served more than 30 min ago)" and offers **Send it as a new item** → the order screen opens with that dish in the cart → Send → "Comp it?" → Ali asks for a comp; his tablet shows "Waiting for approval — Rs 2,200 comp" while the manager's phone rings; the manager approves with her PIN. Meanwhile at the counter, the cashier punches a **takeaway** (name "Usman", phone optional) and shouts **"57"** — the big token on screen. Outside, a runner takes a **parking** order on his phone at a white Corolla: plate **LEB 1234**, Sedan. The Wi-Fi near the kitchen drops; his phone says "Reconnecting… 1 order waiting to send" and sends it the moment the Wi-Fi is back, in his name.

---

## 2. Design system to reuse (Pulse, as built for 01d)

The staff screens use the **Pulse** look already shipped for the 01d alerts screens (Inbox, Requests, banners, answer sheet, sign-in). Reuse it; do not start a new style. The kit already contains ordering patterns (menu tile `.mi`, category rail `.cats/.cat`, cart `.cart` with lines `.ln` and stepper `.step`, `.total`, `.eta`, `.ident`).

### 2.1 Colour tokens (light theme)

Brand (white-label): `--brand-primary #F4A321` (saffron, main action: Send), `--brand-on-primary #3A0E07`, `--brand-secondary #6E140E` (maroon: top bar, selection), `--brand-on-secondary #FFF3E6`. Brand colours never replace status colours.

| Group | Tokens |
|---|---|
| Surfaces | `--bg #F8F1E7` (cream page), `--surface #FFFFFF`, `--surface-2 #FBF6EF`, `--surface-3 #F1E7DA`, `--line #ECDFCF` |
| Ink | `--ink #2B130E`, `--ink-2 #5A3F36`, `--muted #7A6157` |
| Primary | `--primary #F4A321`, `--on-primary #3A0E07`, shadow `0 10px 24px rgb(176 92 0/.28), inset 0 -3px 0 rgb(122 50 0/.22)` |
| Accent | `--accent #8E1F16`, `--on-accent #FFF4E6`, `--accent-bg #FBE7E3` |
| Top bar | `--chrome-bg #6E140E`, `--chrome-ink #FFF3E6`, `--chrome-muted #EBC3A6`, category rail `--rail-bg #5A100B`, `--rail-ink #EBC3A6`, `--rail-on #F4A321` |
| Order identity chip | `--ident-bg #F4A321`, `--ident-ink #3A0E07` |
| Semantic | `--ok #198754` (bg `#E3F3E9`, ink `#136A42`) · `--warn #D9660A` (`#FFEEDC`, `#9C4700`) · `--danger #C8262E` (`#FCE6E4`, `#A81D25`) · `--info #2563C9` (`#E8F0FC`, `#1D4F9F`) |
| Menu and cart | `--photo-bg #3B1E14`, `--photo-none-bg #F6ECDF`, `--photo-none-ink #8E1F16`, `--plate #FFF8EE`, `--cart-bg #FFF`, `--line-open #FFF4E3` (a line being edited) |
| Table states (for the header chip) | Pulse kit: Free `#B9A595`, Seated `#2563C9`, Ordered `#6D46D9`, Eating `#198754`, Bill `#C8262E`, To clean `#9A8B80`. ⚠️ The 02a spec fixes a different palette (Free green, Seated blue, Ordered amber, Eating teal, Bill purple, To clean grey) and the spec wins unless the owner changes it — open with the owner; use one token per state |

### 2.2 Type

Bundled fonts (no internet): **Figtree** (UI), **Bricolage Grotesque** (titles, big numbers: totals, times, token), **Geist Mono** (plates, codes, PINs), **Noto Nastaliq Urdu**.

| Style | Font / size / line / weight |
|---|---|
| display | Bricolage 40/46 800 (the **takeaway token** can go bigger: 72–96) |
| title | Bricolage 28/34 800 |
| heading | Bricolage 22/28 750 |
| body-lg / body | Figtree 20/28 (T, K) · 17/24 (P) |
| label | Figtree 17/22 700 |
| caption | Figtree 15/20 500 (minimum) |
| code-inline | Geist Mono 28/36 650 +.06em (plate number) |
| ur-title / ur-body | Nastaliq 24/2.0 · 19/2.05 |

Sizes already in the kit: menu tile name 16 px 700 display, price 16 px 700; cart head 22 px 750; line quantity 18 px 800; cart total 32 px 800; card title 20 px; dialog title 26 px.

### 2.3 Space, radius, touch

- Spacing 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48; gutters phone 16, tablet/kiosk 24.
- Radius 10 / 16 (buttons, inputs) / 20 (tiles) / 26 (cards, dialogs) / pill; bottom sheets 28 px top with a grip.
- **Touch minimum 56 × 56 px on every staff device**, 12 px apart; stepper buttons 56 × 56; category items 64; dialog buttons 72 high; phone tab bar 60.
- At 1280 and up the page never scrolls; only lists scroll (menu grid, cart). Dialogs max height = screen − 32; body scrolls, buttons stay. Phones: menu and cart as two tabs, a sticky Send; no horizontal scroll.
- Breakpoints: ≤ 760 px phone; portrait ≥ 761 px tablet portrait (cart becomes a bottom sheet, dialogs become sheets); ≥ 1600 px kiosk.
- No hover, no double-tap, no long-press-only, no swipe-only actions. One primary (saffron) button per layer.

### 2.4 State = icon + word (+ colour)

Every state is an icon and a word; colour is third. This covers tile availability (Sold out, Not now, "4 left", slow), line stages, queue states ("Waiting to send", "Not sent"), alert families (action = hand icon, info = "i").

### 2.5 English and Urdu

- Every string is a key with English + Urdu. Urdu: `lang="ur" dir="rtl"`, Nastaliq, taller lines, no uppercase or letter-spacing, pills grow. **Never fix the height of a text box.**
- Only chevrons and back arrows mirror.
- **Always LTR** even in Urdu: prices, quantities, weights, times, the token, **car plates** (mono), phone numbers, table names ("F4 + F5"), PINs. **Latin digits in Urdu** (R20).
- **Menu item names are in one language** (the setup has only one name per item; no Urdu menu names exist). They may be typed in Urdu script by the owner. Notes typed by staff may be Urdu: note fields use `dir="auto"`.
- Design for long names: "Chicken Karahi — Full (Desi Murgh, Makhan wala)" (≈ 45 chars) and Urdu script names.
- Every string marked **UR** needs Urdu.

### 2.6 Numbers, money, time, units

- Money: integers in paisa on the wire (`*_minor`). Show **"Rs 2,200"**: thousands with commas in threes, paisa only when not zero ("Rs 12.50"). The cart total is a preview; the bill is module 05's.
- Weights and volumes: stored as whole grams / millilitres, shown in **kg / L with up to 3 decimals** ("1.25 kg", "0.5 L"). Weighed entry steps of **50 g / 50 ml**, range 50 g–50 kg. Priced lines: "Chicken Karahi 1.25 kg × Rs 2,200 = Rs 2,750".
- Time: **12-hour clock, "8:27 PM"**, hub time, Latin digits. **Promises and ETAs are always a clock time, never "in 12 min", never "~"**, never truncated. Durations elsewhere: "32 min", "≈ 6 min late". Earlier business day: "from 6 Nov".
- Token: a whole number from 1 each business day ("57"); from an earlier day shown with its date ("57 · 6 Nov").

### 2.7 Copy tone

Plain words, verb first, sentence case. Say what to do next. Never show error codes or server text. "You", not "we". No exclamation marks, no emoji. Staff words: "kitchen screen", "hub", "screen". Losing the hub is normal: calm, keep everything on screen.

### 2.8 Components that already exist (reuse)

Top bar `.top` (80 px maroon: brand block "Arif Chatkhara · Gulberg · Tablet 3", Live / Hub offline pill, clock, **Requests (n)** shield and **Inbox (n)** tray buttons with red badges, person chip); segmented `.seg`; pills `.pill`; search `.search`; menu tile `.mi` (`.photo`, `.tag`, `.qty`, `.off`, `.picked`); category rail `.cats/.cat`; cart `.cart` (`__head`, `__foot`) with lines `.ln` (`__q` qty, `__m` main, `__s` sub, `__p` price, `__ctrl`) and stepper `.step`; `.total`; `.eta` (`.late`); identity chip `.ident`/`.tcode`; status pill `.st`; cards `.card`, `.ac` (open alert card), `.ar` (row card); banners `.abns/.abn` (max 2, newest on top, then "{n} more new · Open inbox"; never cover Send or Pay; action hides after 6 s, info after 4 s); dialog / bottom sheet `.scrim/.dlg`; facts grid; 72 px button pair `.acts`; sticky warning bar `.warnbar`; inline message `.msg`; pick list `.pick/.radio`; toast `.toast` (maroon, bottom end); skeleton `.sk`; empty state `.empty`; waiting ring (fills over 4 min); PIN pad; staff name tiles. Icons: inline SVG, 24 grid, round stroke 1.9 (send, clock, warn, sync, wifi-off, receipt, cash, lock, bell, hand, info, chevron, back…).

Alert answer sheet (01d): centred 600 px dialog on landscape and kiosk, bottom sheet on portrait and phone; head with table chip, family pill, kind title, "from … · time", "waiting 2 min"; facts grid (Amount 30 px); 72 px buttons Reject | Approve; money kinds always ask the approver's PIN; offline → buttons and pad off with "No connection to the hub".

### 2.9 Anatomy of the reused components (so you can draw them without the kit files)

| Component | Anatomy |
|---|---|
| Top bar | 80 px, maroon `#6E140E`. Start: 44 px saffron mark with initials + restaurant name (17 px 700) over "branch · screen name" (13 px). Middle: title or segmented control. End: Live pill (green dot + "Live" / grey wifi-off + "Hub offline"), clock 18 px, two 56 px icon buttons (shield = Requests, tray = Inbox) each with a red count badge top-end, person chip (avatar + name, tap = sign out) |
| Category rail | vertical list on the start side, 84 × 76 items (icon + word), dark maroon `#5A100B`, selected item saffron with dark text |
| Menu tile | white card, radius 20, soft shadow; optional photo on top (or a tinted panel with initials); name 16 px 700 (2 lines); price 16 px 700 LTR at the bottom; a count badge top-end when in the cart; chips row under the name; disabled = 50 % ink, grey panel, the reason word on it |
| Cart | white column, header "Order · F4" 22 px; lines: big quantity (18 px 800) at start, name + sub lines (options, note) in the middle, price and time at the end; a 56 px stepper on the selected line; footer: total 32 px 800, Hold (secondary) and Send (saffron, full width, 64 px) |
| Status pill | 30 px high, 14 px 650, icon + word, tinted ground of its tone |
| Alert card (open) | radius 20, light ground; start: 56 px waiting ring with minutes inside; body: family pill + tags, title = saffron table chip (LTR) + kind 20 px, "from Ali · 9:41 PM", one details line; end: amount 22 px and a tinted Answer button. New = white with a 2 px coloured outline and a red dot |
| Alert row | min 72 px: 52 px tinted icon tile, pill, title, one sub line, time, chevron |
| Answer sheet | 600 px centred dialog (landscape/kiosk) or bottom sheet (portrait/phone, 28 px corners, grip): head with a 72 × 64 table chip, family pill, kind 26 px, "from … · time", red "waiting 2 min"; 2 × 2 facts (Amount 30 px); 72 px buttons Reject (tinted) / Approve (saffron, wider); then the PIN pad (keys 104 × 64, dots, LTR) |
| Banner | white card radius 26 with a 2 px coloured inner outline, 470 px wide at the top end under the bar; waiting ring, family pill, table chip + kind, "from …", one details line, tinted Open button |
| Warning bar | full width under the top bar, warning ground `#FFEEDC`, icon + one sentence + optional link |
| Toast | maroon pill-card bottom end, light text, ~3 s |
| Empty state | a green ring icon + title 22 px + one line |
| Skeleton | grey rounded blocks shaped like the content, gentle shimmer (off under reduced motion) |

### 2.10 Handoff format (same as 01d)

Static HTML frames at device size, one file per state, named `<Screen><Variant>` (e.g. `Order`, `OrderEmpty`, `OrderOffline`, `OrderPortrait`, `OrderPhoneMenu`, `OrderPhoneCart`, `OrderKiosk`, `OrderUrdu`), each with a PNG; `MAPPING.md` + `mapping.json` (screen ID → frames → components); `CHANGES.md` (decisions, answers to §7, new string keys); added CSS on top of Pulse; a string table (key, English, Urdu, max length, LTR flag). Frames: T 1280 × 800 and 800 × 1280, K 1920 × 1080, P 390 × 844; English and Urdu for every screen at least on T landscape and P.

---

## 3. Screens

**IDs.** Inventory IDs kept (`02-S05`…); new items `02b-`. Kinds: S screen, D dialog/sheet, C card, B banner/inline, T toast.

**Screen list (37):**

| ID | Name | Kind | Devices |
|---|---|---|---|
| 02-S04 | New order — choose type (takeaway / parking; dine-in comes from the map) | sheet | T K P |
| 02-D03 | Takeaway details (name, phone — both optional) | sheet | T K P |
| 02-D02 | Parking details (plate, car type, phone) | sheet | T K P |
| 02-S05 | Order screen (menu + cart + live times) | screen | T K |
| 02-S10 | Order screen, phone (Menu / Cart tabs) | screen | P |
| 02b-C01 | Menu tile (all availability states) | component | T K P |
| 02b-C02 | Zone tile "Raita · 6 here" | component | T K P |
| 02-D04 | Item options sheet (variant, options, quantity, weight) | sheet | T K P |
| 02b-D30 | Deal sheet (parts and choices) | sheet | T K P |
| 02-D05 | Kitchen note (≤ 80) | sheet | T K P |
| 02-D06 | Order note (≤ 200) | sheet | T K P |
| 02-B05 | Cart line problem (sold out / not now / off / station paused) | inline + banner | T K P |
| 02-B04 | Times unavailable (preview failed / offline) | inline | T K P |
| 02-B03 | "Your unsent order is back" / kept as draft | banner | T K P |
| 02-B06 | Stock and slow chips ("4 left", clock "25 min") | chip | T K P |
| 02-B07 | Last unit taken / time updated (inside 02-D07 and on the line) | inline | T K P |
| 02-D07 | Send: sending / sent / queued / time updated / zone empty / token | dialog / sheet | T K P |
| 02-S06 | Table view — orders part (rounds, lines, stages, actions) | screen part | T K P |
| 02b-S11 | Takeaway / parking order view | screen | T K P |
| 02-D08 | Mark served (pick lines) | sheet | T K P |
| 02b-D31 | Remove lines (stage 1, units) | sheet | T K P |
| 02b-D32 | Send back (fix / remake) and "Send it as a new item" | sheet / dialog | T K P |
| 02b-D33 | Comp (units, reason) | sheet | T K P |
| 02b-C03 | Comp waiting card (requester) + comp request card (approver) | card | T K P |
| 02b-D34 | Enter weight | sheet | T K P |
| 02b-D35 | Customer contact ("Call") | sheet | T K P |
| 02b-D36 | Boost order | inline confirm | T K P |
| 02b-C04 | Late-food card (grouped per current table) + "Send what's ready" sheet | card / sheet | T K P |
| 02-S07 | Open orders (takeaway, parking; abandoned for managers) | screen | T K P |
| 02-S08 | Held orders (this screen's drafts) | screen / list | T K P |
| 02b-S12 | Zone stock (my zones: counts, Refill, Count) | screen | T K P |
| 02b-C05 | Zone running low / empty alert card | card / banner | T K P |
| 02-B02 | Reconnecting — n waiting to send (queue bar) | bar | T K P |
| 02-D14 | Queue log (not sent: Send again / Discard / Copy to a new order) | screen / sheet | T K P |
| 02-B09 | Screen locked (idle) | full screen | T K P |
| 02b-B11 | Day not started | inline / banner | T K P |
| 02b-T01 | Toasts of this module | toast | T K P |

---

### 3.1 02-S04 New order — choose type

**Entry:** "New takeaway" / "New parking" buttons on the table map side column (T, K) or bottom bar (P), and from Open orders. Dine-in orders start by tapping a table on the map (02a), never here. **Shown to:** `take-order` holders. Waiters don't see the buttons.

Two big buttons, icon + word: **Takeaway** (bag), **Parking** (car). Delivery and web are not in this release — do not show them. Kiosk: the two buttons can sit permanently on the cashier home. Exit: 02-D03 or 02-D02.

### 3.2 02-D03 Takeaway details

| Field | Rule | Wire | Example |
|---|---|---|---|
| Customer name | optional, 1–40 chars, `dir="auto"` | `takeaway.customer_name` | "Usman" |
| Phone | optional, 10–13 digits (spaces, dashes, leading + allowed; stored as digits), LTR, numeric keypad | `takeaway.phone` | "0300 1234567" |

Buttons: **Skip** (no details) / **Next** → order screen with identity "Takeaway". The **token number is given by the hub when the order is sent** (1, 2, 3… per business day), not typed. Errors: invalid phone → inline "Enter 10 to 13 digits" (UR); empty strings are not sent (leave the field blank instead).

### 3.3 02-D02 Parking details

| Field | Rule | Wire | Example |
|---|---|---|---|
| Car plate | **required**, 2–12 of **English** letters (A–Z), digits, space, dash; shown upper-case, **mono, big, LTR**; force a Latin keyboard (an Urdu keyboard would be refused) | `parking.car_number` | "LEB 1234", "LEA-19-7788" |
| Car type | **required**, three picture buttons: **Sedan**, **Small car**, **Large (SUV / van)** | `parking.car_type`: `sedan` / `mini` / `large` | Sedan |
| Phone | optional, 10–13 digits | `parking.phone` | "0321 7654321" |

Two orders on the same plate (the same car orders again) are grouped as the same car by the kitchen. Next → order screen with identity "Parking · LEB 1234 · Sedan". Car colour and parking bay are **not** collected. Errors: plate empty/invalid → inline; type not chosen → Next disabled.

### 3.4 02-S05 Order screen (tablet and kiosk)

**Purpose:** build an order with live times, then send it. **Entry:** tap a free or own table on the map (02a opens the table and takes its lock); "Take order" / "Add items" from the table view; 02-D03 / 02-D02; resume a held order; "Send it as a new item" (02b-D32). **Exit:** Send → table view (dine-in) or the order view / token (takeaway, parking); Hold → back to the map (draft kept); Back → map (draft kept, lock released).

**Layout (T landscape 1280 × 800, K 1920 × 1080):**
- **Header:** order identity chip ("F4 + F5 · Family hall" / "Takeaway · Usman" / "Parking · LEB 1234 · Sedan"), holder line ("Ali's table"), lock status (no UI when fine; 02a banners when not), round number ("Round 3" for dine-in when earlier orders exist), Back.
- **Left:** category rail (from the menu setup: "Breakfast · Karahi · BBQ · Breads · Drinks · Deals") + search box.
- **Centre:** menu tiles grid (02b-C01, 02b-C02).
- **Right:** cart (≈ 380 px): lines sorted by **time, earliest first**, each with quantity, name, options / deal choices summary, kitchen note, price, **time**; group promise headers; order note; total; **Hold** (secondary) and **Send** (primary saffron, big).
- T portrait: cart as a bottom sheet with a summary bar ("5 items · Rs 3,400 · Send"). Kiosk: same as landscape, larger grid, keyboard works in search and notes.

**Menu data:** the branch menu snapshot (`GET /queries/branch-config`, refetched on the `BranchConfigApplied` frame): categories, items (`name`, `price_minor`, `sale_unit` piece/g/ml, `requires_weighing`, time windows, `out_of_stock_behaviour` cook_fresh/sold_out, option groups), variant groups, deals, zones with their stock items. Live: availability (`unavailable_item_ids` from catch-up + `ItemMadeUnavailable/Available` frames), stock (catch-up `stock` + stock frames), station load (`stations_live`).

**Live time preview:** after every cart change (wait 250 ms after the last change), the screen asks `GET /queries/eta-preview?draft=<cart as JSON>` (not counted as activity; draft ≤ 8 KB — very long Urdu notes count) →
`{ as_of_seq, groups: [{ promise_ms, keys }], lines: [{ key, eta_ms | null, from_stock, zone_served, refused?: { code, details } }] }`.
Each cart line gets its `eta_ms` as a clock time; lines grouped by `groups` show the group's **promise** ("Food together at 8:27 PM"). `from_stock: true` = ready-made (shorter time). `zone_served: true` = from the zone counter (no kitchen time; show "From the counter"). `refused` = this line would be refused now (02-B05). The preview is **also refetched** on: a menu change (`BranchConfigApplied`), any stock frame, any station-load update (`stations_live`). The preview reserves nothing; the times are final only after Send.

**Cart line**

| Element | Source | Example |
|---|---|---|
| Quantity | stepper (piece lines), or weight (g/ml lines) | "× 4", "1.25 kg" |
| Name | item name (a variant's own name) / deal name | "Chicken Karahi — Full" |
| Options / choices | chosen options with extra price | "+ Extra naan × 2 (Rs 80) · Less oil" |
| Kitchen note | ≤ 80 | "less spicy" (note icon) |
| Price | line total preview | "Rs 2,200" (g/ml: "1.25 kg × Rs 2,200 = Rs 2,750"); weighed items: "Price after weighing" |
| Time | `eta_ms` | "8:27 PM" |
| Badges | from_stock, zone, refused | "Ready-made", "From the counter", "Sold out" |
| Remove | trash icon (draft only; free, no approval) | |

**Actions**

| Action | Who | Does |
|---|---|---|
| Tap a tile | `take-order` | plain item → adds 1 (or +1 if already in the cart); item with options / a variant group / a deal / a g/ml item → opens 02-D04 / 02b-D30 |
| Tap a disabled tile | anyone | shows **why** ("Sold out", "Available 7:00 AM–1:00 PM", "Not available today", "Kitchen paused") — never silent |
| Stepper + / − | | quantity; capped by stock (02b-C01 "Only 2 left") |
| Tap a cart line | | edit (reopens its sheet), note, remove |
| Order note | | 02-D06 |
| **Hold** | | saves the cart on this screen as a held order (02-S08); goes back to the map; releases the table lock |
| **Send** | `take-order` | freezes the cart, writes it into the device queue, then sends `POST /commands/submit-order` → 02-D07 |
| Back | | keeps the draft on this screen (per person), releases the lock |
| Keep-alive | | `touch-table-lock` once a minute while open (dine-in; no UI) |

**States**

| State | Shows |
|---|---|
| Loading (menu not yet loaded) | rail + skeleton tiles; cart empty |
| Empty cart | cart: "Tap items to add them" (UR); Send disabled |
| Normal | as above |
| 40 lines (max per order) | cart scrolls; at 40: "40 items is the most for one order. Send these and start a new round." (UR) |
| Long names, Urdu notes | wrap to 2 lines; notes wrap |
| Preview loading | each line's time shows a small spinner, old time kept dimmed |
| Preview failed / offline | 02-B04: times show "—" and "Times will be set when sent" |
| Time moved | when a preview changes a line's time, briefly highlight it |
| Item problem | 02-B05 on the line |
| Day not started | 02b-B11 instead of the cart footer; Send disabled |
| Lock lost / holder changed | 02a's banners appear on top: "Your table was released (reason). Your order is kept." / "Ali now has this table. Keep as draft" (Send only with `take-order-anywhere`; even then Send fails with "Bilal is ordering on F4" if someone else holds the lock, and "outside your floors" if that permission's scope doesn't cover the floor) |
| Permission: no `take-order` (waiter) | proposal: the order screen is not reachable (no Take order / New takeaway buttons). The inventory suggested a read-only menu "You can't take orders on this device" instead — §7 Q16 |
| Offline, holder with the table already open | ordering continues; Send queues (a queued send goes through without the lock). Opening a **free** table needs the hub (02a) |
| Config changed mid-order | prices and items in the cart follow the new menu (the hub uses the menu at send time); a line whose item disappeared shows 02-B05 "No longer on the menu" |
| Draft restored (after a restart / sign-in) | banner "Your unsent order is back" (UR) |
| Frozen (Send pressed, waiting) | cart greyed, "Sending…", no edits |
| Urdu | RTL layout (rail on the right), prices/times LTR; tiles' order follows the menu order |

### 3.5 02-S10 Order screen, phone

Same content in two tabs: **Menu** (category chips scrolling at the top, search, 2-column tiles) and **Cart (n)** (lines, notes, total). A **sticky bottom bar** on both tabs: "5 items · Rs 3,400 · **Send**". Options and deal sheets are full-height bottom sheets. Identity chip in the phone top bar. Everything else as 3.4.

### 3.6 02b-C01 Menu tile

| Element | Example | Rule |
|---|---|---|
| Photo or initials | (optional) | `--photo-none-bg` when none |
| Name | "Chicken Karahi" (variant group: one tile, members inside) | 2 lines max |
| Price | "Rs 450"; per kg "Rs 2,200 / kg"; variant group "from Rs 1,200" | LTR |
| In-cart count | "× 2" badge | `.qty` |
| Chips (below) | | |

**Availability states (each icon + word):**

| State | When | Tile | Tap |
|---|---|---|---|
| Available | normal | normal | adds |
| **"4 left"** | the item's stock level is **low** (the stock data gives each counted item a `level`: `ok`, `low` — at or under the item's own low-stock threshold set by the owner —, `out`, `not_counted`) | normal + chip "4 left" (pieces left) | adds; stepper capped at 4 for `sold_out` items |
| **Slow** (clock + "25 min") | the item's expected time passes the branch's slow threshold (setting, default 15 min) | normal + clock chip with the minutes | adds; tells the guest |
| **Sold out** | a `sold_out` item at level `out`; a `sold_out` item **not counted yet today** (no stock count at day start reads as sold out); or a deal whose part has no orderable choice | greyed, "Sold out" (not counted: "Not counted today") | shows the reason — cannot add |
| **Not now · 7:00 AM–1:00 PM** | outside its (or its category's) time windows, hub time (up to 4 windows each; show the next one, or "Not again today") | greyed, "Not now" + the next window | shows "Available 7:00 AM–1:00 PM · 7:00 PM–11:00 PM" |
| **Off** (made unavailable by staff) | manual Off | greyed, "Not available" | shows "Not available today" |
| Required option impossible | a required option group whose linked items are all unavailable | greyed, "Not available" | shows reason |
| Station paused | the item's station is paused with no alternate | normal tile (the hub refuses on send / preview marks it) | — |

`cook_fresh` items at 0 stock are **not** sold out: they are cooked fresh, so they show the slow clock instead (full cook time). A `sold_out` item is refused even when 0 < left < wanted (the stepper prevents it). Sold-out and availability updates arrive within 5 s (stock / availability frames). **Time windows send no frame when they open or close**: the screen re-checks the windows itself every minute (hub time).

### 3.7 02b-C02 Zone tile "Raita · 6 here"

When the table's zone keeps an item on its counter (dine-in only), its tile shows the zone count: **"Raita · 6 here"** (from `zone-stock` / catch-up `zone_stock` + `ZoneStockAdded`/`ZoneStockSet` frames). A tap adds or increments one **from-the-counter** line (`from_zone: true`; no options; plain item only). In the cart: "From the counter", no kitchen time. After Send, if the counter ran out meanwhile, the hub silently makes it a kitchen line; the result says `zone_served: false` → show **once**: "Counter empty — Raita sent to the kitchen" (UR). It is never refused. On takeaway and parking the zone count is not used (normal tile). At 0 here: the tile shows "0 here" and taps make kitchen lines.

### 3.8 02-D04 Item options sheet

**Opens for:** variant groups, items with option groups, g/ml items. **Layout:** item name + base price → **variant** (segmented, e.g. Half / Full; required one-of) → **option groups** in order: group name + rule ("Choose 1", "Up to 3", "Optional"), options as chips with price ("Extra naan +Rs 40", "Raita +Rs 80"), per-option quantity up to its `max_quantity`; **defaults are preselected and visible** (a group with a default is always shown) → quantity stepper (piece) **or** weight entry (g/ml: number pad in kg/L, steps 50 g, "1.25 kg") → kitchen note shortcut → live line price and time → **Add** (disabled until every required group is met: "Choose 1 more in Gravy").

Rules: linked options (an option that is another menu item, e.g. "extra naan") are **disabled with the reason** when that item is unavailable ("Naan sold out"). Option charges: piece items pay option price × option qty × item qty; g/ml items pay option price × option qty once. A required group that can't be met makes the whole item unavailable (tile greyed). Weighed items (`requires_weighing`, e.g. fish weighed at the counter): two choices — **Enter weight now** (number pad, 50 g steps; line price shown) or **Weigh later** (line placed with "Weight pending"; someone with the weight permission enters it later, 02b-D34). Price shows "Rs 2,200 / kg". Design both states.

States: normal, required unmet, option disabled (linked item unavailable), long option lists (scroll), Urdu.

Error from send: `422 OPTION_CHOICE_INVALID { order_item_id, violations }` → line flagged "Check the options" → reopen this sheet with the bad group highlighted.

### 3.9 02b-D30 Deal sheet

**Layout:** deal name + price → each **part** in order ("Main · 1", "Bread · 4", "Drink · 4"): a fixed part shows its item; a part with choices shows a pick list with extra prices ("Plain naan · Roghni naan +Rs 30 · Garlic naan +Rs 50"); the part's item may have its plain options (e.g. spice level) → deal quantity → kitchen note (copied to every kitchen part) → total preview → **Add** (disabled until every part with choices is picked). Unavailable choices are disabled with the reason; a part with no orderable choice → the deal tile is Sold out. A weighed item is never a deal choice.

In the cart: one line "Family Deal × 1 · Rs 3,200" with the parts listed under it. Error: `404 DEAL_NOT_FOUND`, `409 ITEM_OUT_OF_HOURS { deal_id, opens_at_ms }` (02-B05).

### 3.10 02-D05 Kitchen note / 02-D06 Order note

Kitchen note per line: text, **≤ 80**, counter "34/80", `dir="auto"`, printed and shown to the kitchen verbatim, no price effect. Quick chips are not defined (§7 Q2). Order note: text, **≤ 200**, counter, for the whole order. Both optional. Notes cannot be edited after Send.

### 3.11 02-B05 Cart line problem

Shown on a cart line when the preview marks it `refused`, or after a Send that the hub refused. Line gets a warning tone + icon + reason + a way out:

| Code | When | Line text (UR) | Way out |
|---|---|---|---|
| `ITEM_SOLD_OUT { item_id, available }` | stock ran out / fewer than wanted | "Only 2 left" / "Sold out" | the item is the line → **Set to 2** / **Remove**; the item is a **deal choice** → **Change choice**; a **linked option's** item → **Edit options** |
| `ITEM_OUT_OF_HOURS { item_id \| deal_id, opens_at_ms \| null }` | window ended | "Not now · from 7:00 AM" (`opens_at_ms` null → "Not again today") | Remove |
| `ITEM_UNAVAILABLE { item_id }` | made unavailable / a required option impossible | "Not available now" | Remove |
| `STATION_PAUSED { station_id }` | its kitchen station is paused | "Kitchen station paused" | Remove / wait |
| `MENU_ITEM_NOT_FOUND`, `DEAL_NOT_FOUND` | no longer on the menu | "No longer on the menu" | Remove |
| `OPTION_CHOICE_INVALID` | options no longer valid | "Check the options" | Edit |

Mapping: a Send refusal names **only the first** refused line, so after a refusal re-run the preview (which marks every line) to show all problems at once. `STATION_PAUSED { station_id }` names a station, not a line — use the preview's per-line `refused` to find the lines. The hub refuses the **whole** order if any line is refused, so Send stays disabled (or Send shows "Fix 1 item first") until problem lines are fixed or removed. A banner on the cart summarises: "1 item can't be sent — fix it first" (UR). The last unit taken by another order between preview and Send → the Send fails with `ITEM_SOLD_OUT` → same line state ("The last Paye just went to another order").

### 3.12 02-B04 Times unavailable

When the preview call fails or the hub is offline: each line's time shows "—"; under the cart: "Times will be set when the order is sent" (UR). Ordering continues; the draft is kept.

### 3.13 02-D07 Send

**Flow:** Send → cart frozen → command written to the device queue → `POST /commands/submit-order { order_id, order_type, table_id?, seating_id?, takeaway?, parking?, order_note?, lines: [...] }` (ids are minted on the device when a line enters the cart and kept for every retry) → result `{ order_id, token | null, groups: [{ group_id, promise_ms, order_item_ids }], lines: [{ order_item_id, eta_ms | null, from_stock, zone_served }] }`.

**States**

| State | Shows |
|---|---|
| **Sending** | "Sending to the kitchen…" (UR); no "sent" until the hub answers |
| **Sent (dine-in)** | list of lines with their final times; group promises "Food together at 8:27 PM"; auto-close to the table view after ~2 s or **Done** |
| **Sent (takeaway)** | **the token, very big: "57"** + "Takeaway · Usman" + promise; **Done** / **New takeaway** |
| **Sent (parking)** | "Parking · **LEB 1234** · Sedan" big + promise; Done / New parking |
| **Time updated** | a promise moved ≥ 60 s from the last preview: "Time updated: Karahi 8:29 PM" (highlight that line). Includes the "last unit went to another order — full cook time" case (`from_stock` false now) |
| **Counter empty** | a from-the-counter line came back `zone_served: false`: "Counter empty — Raita sent to the kitchen" (once) |
| **Queued (offline)** | "Not sent yet — will send when the hub is back" (UR); dialog closes; the order shows "Waiting to send" on the table view / open orders; the token is **unknown** until sent ("Token after sending") |
| **Queued order sent (on reconnect)** | takeaway: a sticky card "Takeaway sent · token **57**" (UR) until tapped, so the cashier can call it; parking / dine-in: toast "Order for LEB 1234 sent"; open-orders row and table view update |
| **Still sending** (timeout, 5xx, network error) | "Still sending… will retry" (UR); the order stays queued and is retried with the same ids (never doubled) |
| **Already sent** | `409 ORDER_ITEM_ID_IN_USE { order_id }` for this screen's own pending order = it was already accepted (lost answer) → refetch and show as Sent |

**Errors** (cart unfreezes, draft kept, lines marked where possible)

| Code | When | Show | Way out |
|---|---|---|---|
| line codes (3.11) | | line problems | fix, resend |
| `409 BUSINESS_DAY_NOT_OPEN` | no day open | 02b-B11 | Start day / ask manager |
| `409 TABLE_SEATING_CHANGED` | the party moved / was cleaned / merged while ordering | "This table changed. Your order is kept." | back to the map; re-open the table (the draft follows the person) |
| `409 TABLE_ALREADY_LOCKED { locked_by_name }` | someone else took the table's lock (after yours ended) | "Bilal has F4 open now. Your order is kept here." | Hold; try later; or ask (02a) |
| `409 TABLE_NEEDS_CLEANING` | bill paid meanwhile | "F4's bill is paid. Your order is kept." | send as takeaway? no — Hold / discard (§7 Q3) |
| `403 PERMISSION_DENIED { reason: 'not_holder' }` | the table is no longer yours and you lack take-order-anywhere | "Ali has this table now. Your order is kept." | Hold / hand it to Ali verbally |
| `403 PERMISSION_DENIED { permission, grant }` | your permissions changed mid-shift | "You can't take orders now. Ask a manager." | Hold |
| `403 … outside_scope` | | "This table is outside your floors" | — |
| `400 VALIDATION_FAILED` | bad field (phone, plate, repeated id) | inline on the field | fix |
| `401 SESSION_EXPIRED` / `SESSION_INVALID` | signed out meanwhile | sign-in screen; the order waits in the queue log (02-D14) | Send again after sign-in |
| `426 CLIENT_UPGRADE_REQUIRED` | app too old | "Update the app" screen; the order **stays queued** and is sent after the update | — |

Taps: dine-in order of 5 items ≈ 12 taps (table, 5 items, one option ×2, Send). Takeaway of 3 ≤ 8. Parking ≤ 18 (plate typing).

### 3.14 02-S06 Table view — orders part

**Where:** the table view opened from a seated table (02a's header and table actions on top; this part below). **Entry:** tap a seated table; after Send. **Data:** `GET /queries/seating-orders?seating_id=` (not activity) →
`{ orders: [{ order_id, placed_by: { staff_id, name | null }, placed_at, follow_up, cancelled, billed, has_phone, promise_ms | null, lines: [Line + { stage, fired }] }], total_minor }`, orders by time. Refetch on any order frame for this party (`ItemAdded`, `ItemServed`, `ItemRemoved`, `ItemVoided`, `ItemReturned`, `ItemsReleased`, `OrderBoosted`, `OrderCancelled`, `LineWeightSet`, `LineComped` (only reaches kiosks and comp holders), `OrdersBilled`) and on the 02a party frames (move / merge / split).

⚠️ **Kitchen progress is not pushed to ordering screens.** The kitchen's "started / done / un-done" events go only to kitchen and pass screens, so **Cooking → Ready → (back to Cooking)** changes appear on this view only when it is refetched (on open, on the frames above, on pull-to-refresh). Show a quiet "Updated 8:31 PM" line with a **Refresh** button (§7 Q17).

Line fields used: `order_item_id`, `parent_order_item_id` (indent children and deal parts under their parent), `line_kind` (`item` / `option_child` / `deal` / `deal_part`), `name`, `sale_unit`, `quantity` (null = weight pending), `units`, `live_units`, `comped_units`, `removed_units`, `voided_units`, `returned_units`, `line_total_minor`, `billed_minor`, `return_of` (this line is a replacement for another), `zone_served`, `added_at` (with the branch's `zone_undo_ms`, the counter-undo window), `served_at`, `served_source` (tap / estimated / zone), `is_food`, `kitchen_note`, `stage`, `fired`. `placed_by.name` null → "Someone".

**Not shown after Send (data gap, §7 Q18):** plain options (spice level, "No onion" — only options that are other menu items come back, as child lines) and the order note are not in this data. Show only linked options and deal parts here. A g/ml line counts as 1 unit, so its remove/comp stepper is hidden (whole line only). A weight-pending line counts **0** in `total_minor`: show the total as "Rs 14,250 + 1 item to weigh".

**Layout:** one block per **round**: header "Round 2 · 8:10 PM · **Ali**" + promise "Food at 8:27 PM" (`promise_ms`, while the kitchen still has the order) → its lines: quantity, name, options/children indented, deal parts indented under the deal, note, **stage word + icon**, served time, badges (Comped, Removed, Sent back, Replacement, From the counter, Weight pending) → per-line action buttons (by permission). Bottom: total "Rs 14,250" (`total_minor`), **Add items** (opens the order screen as a new round), **Mark served**, **Send what's ready** (when a late card exists).

**Stage words** (proposal, §7 Q4; icon + word):

| `stage` / flags | Word | Notes |
|---|---|---|
| `added`, `fired: false` | **Later** | the kitchen will start it later (timed to land together) |
| `added`, `fired: true` | **Sent to kitchen** | |
| `cooking` | **Cooking** | |
| `done` | **Ready** | at the pass |
| `served` / `served_at` set | **Served · 8:28 PM** | |
| `returned` | **Sent back** | its replacement line shows "Replacement · Cooking" |
| `out_of_engine`, served | **Served** + note "closed" | order left the kitchen's list (served > 30 min ago, abandoned, day closed): Send back is replaced by **Send it as a new item** |
| `out_of_engine`, not served | **Not tracked** (still servable) | an abandoned order's unserved line can still be marked served |
| `null` + `zone_served` | **From the counter · Served** | |
| `null`, not a deal, not counter (a no-station line: something with no kitchen station, e.g. a packed item) | **No kitchen** — "Serve when ready" | can be marked served and removed while unserved |
| `null` (deal header) | derived: "Served" when all parts served, else the parts' stages | |
| removed / voided units | struck through "Removed" / "Voided" | removed = before cooking (here); voided = module 04 |
| cancelled order | whole round struck "Cancelled" | every line removed |
| comped units | "Comped × 1" badge (value visible to comp holders and kiosks) | |
| weight pending | "Weight pending" + Enter weight | |

**Line actions**

| Action | Shown when | Who (permission, scope) | Opens / calls |
|---|---|---|---|
| **Mark served** | line is fired (any stage from Sent to kitchen on), not served, not removed; or its order left the kitchen; or a no-station line | `mark-served` (default: order takers, waiters, managers; branch) — no lock needed | 02-D08 / `mark-served` |
| **Remove** | stage `added` (fired or not); a counter line within 5 min of adding | `take-order` + the party lock (holder; or `take-order-anywhere`) | 02b-D31 |
| **Send back** | served line, not a counter line, not already sent back, order still in the kitchen's list (stage not `out_of_engine`) | `mark-item-returned` | 02b-D32 |
| **Send it as a new item** | served line whose stage is `out_of_engine` (served > 30 min ago) | `take-order` + holder (or `take-order-anywhere`) | order screen with the item in the cart (02b-D32) |
| **Comp** | live, sent line; not a replacement line; not a deal part (comp the deal); not a counter line **inside its 5-min undo window** (after it, counter lines can be comped); weight not pending | `apply-comp` (allowed → direct; requires_approval → "Comp · needs approval") | 02b-D33 |
| **Enter weight** | weighed line with weight pending, or correction before the bill | `set-line-weight` (default cashier, manager) | 02b-D34 |
| **Boost** (order level) | order still in the kitchen | `boost-order` | 02b-D36 |
| Void (cooked lines) | past stage 1 | module 04 | placeholder "Void…" (§6) |

Remove past stage 1 → the button is replaced by "Void…" (module 04). Send back on a sent-back line → offered on its **replacement** line instead.

**States**

| State | Shows |
|---|---|
| Loading | skeleton rounds |
| No orders (Seated) | "No orders yet" + **Take order** (02a) |
| Normal | rounds |
| 20 rounds / 40 lines per round | list scrolls; rounds collapsible (newest open) |
| Order waiting to send (queued) | a round "Waiting to send · 8:10 PM" (sync icon), its lines in grey, no actions |
| Late food | a 02b-C04 card at the top |
| Read-only for ordering | not the holder: no Remove / Add items (unless take-order-anywhere); Mark served / Send back / Comp still available by permission (those never need the lock) |
| Waiter | only Mark served |
| Offline | actions disabled "Needs the hub" except **Mark served** (queued: "Will be sent when the hub is back") and **Add items** for the holder (its Send queues); "Last updated 8:31 PM" marker |
| Billed order | "Billed" tag; no Remove, Comp, Weight |
| Urdu | RTL; quantities, prices, times LTR |

### 3.15 02b-S11 Takeaway / parking order view

One non-table order. Header: **token big "57"** (with "· 6 Nov" when from an earlier day) or **plate "LEB 1234" mono + car type icon**; customer name (placer and cashier only); "Call" when `has_phone` and the person has `view-customer-contact` (02b-D35); promise (`promise_ms` from open-orders); "Ready 2/3".

⚠️ **Data gap (§7 Q19):** there is no per-order query for non-table orders. The catch-up `orders` part + order frames give the lines and their money and served state, but **no kitchen stage, no `fired` flag and no per-order promise**; `open-orders` gives only `ready { n, m }` and `promise_ms`. Until the hub adds a lines view, this screen shows: each line with **Served / Not served** (no Cooking/Ready words), the order's Ready n/m and promise; **Mark served** on every live unserved line (an unfired line is refused → "Not sent to the kitchen yet"); **Remove** offered on unserved lines (a started line is refused → "Already cooking — use Void"); Send back / Comp by the same rules but resolved by the hub's answer. Scope for takeaway/parking: `own_tables` / `my_floors` = orders I placed. **Add items** is not defined for these orders (§7 Q5); hide it until the owner answers.

### 3.16 02-D08 Mark served

Checklist of the party's (or order's) servable lines (fired, not served), grouped by round, ready lines pre-ticked → **Mark served** → `POST /commands/mark-served { lines: [{ order_id, order_item_ids }] }` (≤ 20 orders per call) → `{ served, skipped }`. One-tap "Served" on a single line is also fine. When a party's food is all served the table turns **Eating** (only food counts; water and drinks never turn it green; ready items like bottles don't either).

| Code | Show |
|---|---|
| `409 ITEM_WRONG_STAGE { stage: 'added' }` | "Not sent to the kitchen yet" (can't serve an unfired line) |
| `… 'removed' / 'voided'` | "That item was removed" — refresh |
| `skipped` non-empty | "Already served" (quiet) |
| `404 ORDER_NOT_FOUND` | refresh |
| `403 outside_scope` | "Not your table" |
| `400` deal header | prevented by the UI: serve the parts |
| Offline | **queued**: toast "Will mark served when the hub is back"; the served time recorded is when you tapped |

### 3.17 02b-D31 Remove lines

For lines still at stage 1 (not cooking yet). **Who:** `take-order` and the party's lock rules: the holder (or `take-order-anywhere`); a free lock is taken by the holder when he removes (and is not released afterwards — others see the table locked until it times out, §7 Q20). Sheet: tick lines; per line a **units stepper** ("Remove 1 of 4 naan"); deal: units of the deal (every part follows); children follow the parent. → **Remove** → `POST /commands/remove-items { order_id, seating_id (dine-in), lines: [{ order_item_id, units? }] }` → `{ removed, cancelled, comp_requests_closed }`. If nothing live is left, the round shows **Cancelled**. A fired line's removal prints a CANCELLED slip in the kitchen (03b). A pending comp on a removed unit closes (its requester is told). A counter line can be removed only within 5 minutes of adding ("Undo"); later → "Count it on the zone screen".

| Code | Show | Way out |
|---|---|---|
| `409 ITEM_WRONG_STAGE { stage }` (`cooking`, `done`, `served`, `out_of_engine`; a counter line past 5 min → `served`) | "Karahi is already cooking — use Void" | Void… (04) |
| `400 … gml_deal_part_partial` | "Remove the whole deal and add it again" — a deal with a **part sold by weight (g/ml, e.g. 1 kg karahi)** can't be partly removed while that part is still with the kitchen, **including before it starts** | remove all |
| `400` units > live | prevented by the stepper | |
| `409 TABLE_ALREADY_LOCKED { locked_by_name }` | "Bilal is ordering on F4. Try when he's done." | |
| `403 not_holder` | "Only Ali can remove items here" | |
| `409 TABLE_SEATING_CHANGED`, `TABLE_NEEDS_CLEANING` | as usual | |
| `409 ORDER_BILLED` | "Already billed" | |
| `404 ORDER_NOT_FOUND`, `403 outside_scope` | | |
| Offline | disabled "Needs the hub" | |

### 3.18 02b-D32 Send back (fix / remake) and "Send it as a new item"

Sheet on a served line: "Send back Chicken Karahi?" → two big choices (no reason, no charge): **Fix** — same plate, short time ("reheat, add salt") / **Remake** — a new plate, full cook time. → `POST /commands/return-to-kitchen { order_item_id, return_order_item_id (minted on the device), mode }` → `{ eta_ms, promise_ms }` → toast "Sent back · ready at 8:41 PM"; a **Replacement** line appears under it. The remade dish **stays on the bill** unless comped (offer "Comp it?" after a remake, §7 Q6). Send back on a sent-back dish → done on its replacement line.

| Code | When | Show | Way out |
|---|---|---|---|
| `409 ORDER_NOT_IN_ENGINE` | the order was served **more than 30 min ago** (or abandoned / day closed) | **"This order is closed (served more than 30 min ago)."** (UR) | **Send it as a new item**: opens the order screen for this party with the same item and options in the cart as a **new round** → Send → then **"Comp it?"** (02b-D33, approval per grant). Nothing else is written. |
| `409 RETURN_ALREADY_OPEN` | already being fixed / remade | "Already sent back" | |
| `409 ITEM_WRONG_STAGE { stage: 'added' \| 'cooking' \| 'done' }` | not served yet | "Not served yet" | — |
| `409 ITEM_WRONG_STAGE { stage: 'returned' }` | already remade | "Send back the replacement instead" | jump to it |
| `… 'zone_served'` | a counter item | "Counter items can't be sent back" | Remove within 5 min / new item |
| `… 'not_engine_line'` | a deal header or a line the kitchen doesn't hold | "Send back the deal's items one by one" | |
| `… 'removed' / 'voided'` | | "That item was removed" | |
| `409 STATION_PAUSED` | its kitchen station is paused | "Kitchen station paused — try later" | |
| `404 MENU_ITEM_NOT_FOUND` (fix) | item left the menu | "Not on the menu any more — use Remake or a new item" | |
| `404 ORDER_NOT_FOUND`, `409 ORDER_ITEM_ID_IN_USE`, `403 outside_scope` | | refresh | |
| Offline | | disabled "Needs the hub" | |

If a remade dish's replacement was removed and the guest wants it again, the new round bills it again: the screen asks "Comp it?" after sending. A send-back (and any new round) **clears the table's bill request** (the tile goes back to Ordered; the cashier reprints). "Send it as a new item" needs `take-order` and the holder rule (or `take-order-anywhere`); for takeaway / parking it has no defined path yet (§7 Q5). Since the table view already knows a line's stage is `out_of_engine`, show **Send it as a new item** directly on such lines; the 409 path above is only for the race when the 30 min pass while the sheet is open.

### 3.19 02b-D33 Comp (free item)

Sheet on a line: "Give Chicken Karahi free?" → **units** stepper (≤ live − already comped; a deal: deal units; hidden for g/ml lines) → **reason** chips (the branch's list from setup, 1–10 chips of ≤ 30 chars; defaults **Late, Wrong item, Quality, Guest, Other**; **Other** needs a note ≤ 120) → value preview "Rs 2,200" → button **Comp** (allowed) or **Ask for approval** (requires approval; label "needs a manager"). **Online only** (comps and every PIN action are never queued).

→ `POST /commands/comp-line { order_item_id, units, reason_code, note? }` →
- `{ comped: true, value_minor }` → line badge "Comped × 1 · Rs 2,200"; toast "Comped".
- `{ alert_id, pending: true }` → **comp waiting card** 02b-C03 on the line and in the requester's area.

| Code | Show |
|---|---|
| `409 COMP_PENDING { alert_id }` | "A comp is already waiting for approval" → shows its card |
| `409 COMP_NOT_ALLOWED { reason }` — `not_live` / `return_line` / `deal_part` / `zone_line` | "Nothing left to comp" / "Replacements are already free" / "Comp the whole deal" / "Counter item — undo it instead (comp after 5 min)" |
| `409 LINE_WEIGHT_PENDING` | "Enter the weight first" |
| `409 ORDER_BILLED` | "Already billed — ask the cashier" |
| `400` reason Other without note / units too many | inline |
| `403 outside_scope`, `404 ORDER_NOT_FOUND` | |
| Offline | disabled "Needs the hub" |

A comp cannot be undone before the bill (the cashier handles a wrong comp at the bill).

### 3.20 02b-C03 Comp waiting card and comp request card

**Requester's waiting card** (01d requester card pattern, data from 01d `my-requests`; the comp's item and amount are kept by the screen from the command): "**Waiting for approval — Rs 2,200 comp**" (UR) + item "Chicken Karahi × 1 · Quality" + waiting ring + **Withdraw**; after 2 min: "Waiting 2 min — ask in person" (01d copy); when nobody who can approve is reachable: "No approver reachable — ask in person". **Approve here** (in-person): on the requester's own device a manager picks herself from the name tiles and enters her PIN (only on this device; elsewhere → "In person only on the requester's device"). Results: approved → line "Comped" + rising chime; rejected → "Comp rejected by Sana" + falling tone; closed obsolete (the line was removed / voided / comped by someone else / order cancelled) → 01d shows a generic "Closed"; proposal "Comp request closed: the item changed". Comp requests are closed at bill close by 05. When no one can approve at all, 01d shows its banner "No one can approve requests right now" on always-on screens and to managers.

**Approver's request card** (in Requests on T/K, Inbox + banner on P): kind `comp`, action family; title table chip "F4" + "Comp" — for **takeaway / parking** the alert carries **no table code** (and no token or plate): show the kind alone "Comp · Takeaway order" (§7 Q21); "from **Ali** · 9:41 PM"; details: item, units, amount, reason — the reason arrives as the **raw reason code** (+ ": note" for Other), so map codes to the chip labels ("quality" → "Quality"); waiting ring; steps (01d approval tiers): 45 s repeat (adds always-on screens), 2 min escalation (adds **informed** managers, read-only). Answer sheet: facts (Item, Units, Amount, Reason) → **Reject** / **Approve** → **PIN always** → done. Errors (01d): already answered → "Already approved by Sana"; "Not your team — a manager can approve" (`out_of_range`); PIN wrong → shake, "2 tries left"; locked → time left; offline → pad disabled, "No connection to the hub". Lock-screen text: "F4 · Comp · Ali" (no amount).

Keys missing today: `alert.comp.card`, `alert.comp.lock` (add, UR).

### 3.21 02b-D34 Enter weight

For weighed items (karahi by kg, fish). Sheet: item + price per kg → number pad in kg (or g), steps of 50 g, 50 g–50 kg → live total "1.25 kg × Rs 2,200 = Rs 2,750" → **Save** → `POST /commands/set-line-weight { order_item_id, quantity (grams) }` → `{ line_total_minor }`. Correction allowed until the bill closes. **Who:** `set-line-weight` (cashier, manager by default) — order takers see "Weight pending" only.

| Code | Show |
|---|---|
| `409 LINE_ALREADY_SETTLED` | "Part of this item is already comped or removed — the weight can't change" |
| `409 LINE_NOT_WEIGHED` | (prevented) "This item isn't weighed" |
| `409 ORDER_BILLED` | "Already billed" |
| `404 ORDER_NOT_FOUND`, `403 outside_scope` | |
| Offline | disabled |

A bill can't close while a weight is pending (05).

### 3.22 02b-D35 Customer contact ("Call")

On a parking (or takeaway) order with `has_phone`, shown only to people with `view-customer-contact` covering the order (default: managers, cashiers; order takers for orders they placed / tables they hold; **not waiters**). Tap **Call** → `GET /queries/order-contact?order_id=` (logged; counts as activity) → `{ customer_name, phone }` → sheet with the name and the phone number big, LTR ("0300 1234567"). The placer and the kiosk may already have it (no fetch needed). `403` → button hidden; `404` → "Order not found".

### 3.23 02b-D36 Boost order

Order-level action: "Hurry this order" → **Boost** → `POST /commands/boost-order { order_id }` → toast "Kitchen told to hurry". `409 ORDER_NOT_IN_ENGINE` → "This order is closed"; `404 ORDER_NOT_FOUND` → refresh; `403 outside_scope` → "Not your table". `boost-order` permission (order takers, managers). Offline: disabled.

### 3.24 02b-C04 Late-food card and "Send what's ready"

**What:** the kitchen engine warns when a group of food will land late (03a `slip_warning`, action family, to the party's holder). **Screen rule (owner O18):** warnings of parties that now sit on the **same current table** (after a merge) show as **one card** per table: "**F4 + F5 — 2 late**", each warning inside with its own lines and buttons. After a split, each warning shows under its oldest order's current table. (The client maps a warning to a table through its orders' party and the table map.)

**Card content:** table chip + "≈ 6 min late" (`details.minutes_late`; can read 0 at first) + the lines (`details.lines: [{ name, quantity, state }]` — `state` is the raw kitchen stage `added` / `cooking` / `done` → map to "Waiting" / "Cooking" / "Ready"; `name` may fall back to a line code → show "Item") + **Send what's ready** (primary) / **Wait**. Where: top of the table view, Inbox, a banner; later it escalates to managers (read-only for them). Takeaway / parking warnings go to the person who placed the order, with no table chip.

**Two ways to answer (both built):**
- **One warning on the card:** Send what's ready = the request's **Accept** (one tap; the hub ticks the ready lines and hurries their goes-with partners itself); Wait = **Decline** (silences the warning for that party).
- **Several warnings on one card (joined table), or the person wants to choose:** a small sheet listing ready lines pre-ticked and their "goes with" partners still cooking (pre-ticked to **hurry**) → **Send** → one `POST /commands/release-items { order_ids, released, expedite }` for every order of the card → `{ alerts_closed }` → the card closes.
The detailed release-sheet design is open (§7 Q7). Errors: `409 ORDER_NOT_IN_ENGINE` ("Order closed"), `403 outside_scope`, `409 REQUEST_NOT_PENDING` ("Already answered"). Needs `mark-served`. Keys `alert.slip_warning.*` missing today (add, UR).

### 3.25 02-S07 Open orders

**Purpose:** all takeaway and parking orders not yet billed. **Entry:** "Open orders (n)" on the map side column / bottom bar; kiosk home. **Data:** `GET /queries/open-orders?order_type=takeaway|parking|all` →
`{ orders: [{ order_id, order_type, table_key, token | null, car_number | null, car_type | null, has_phone, placed_at, business_date, from_date | null, ready: { n, m }, promise_ms | null, abandoned }] }`, sorted by promise (none last). Live: refetch on order frames.

**Layout:** filter segmented **All · Takeaway · Parking** (counts) → cards/rows: takeaway "**57**" (big) or parking "**LEB 1234** · Sedan" (mono, car icon) + promise "8:12 PM" + "Ready 2/3" (ready lines / live lines; deal headers not counted) + "from 6 Nov" when `from_date` is set + phone icon when `has_phone` → tap → 02b-S11. Ready-all orders highlighted ("Ready" — runner takes it to the car). **Managers** (branch-scope `force-release-table-lock`) get a tab **Abandoned**: `?abandoned=true` adds orders of any type (dine-in too) with no kitchen tap for a long time ("abandoned — no tap for 2 h"); orders with nothing for the kitchen are never in it.

States: loading (skeleton), empty ("No open takeaway or parking orders" UR), 60 orders (scrolls), queued order ("Waiting to send", token "—"), offline (frozen + bar + "Last updated"), Urdu. Error: `403 PERMISSION_DENIED { reason: 'managers_only' }` on Abandoned → tab hidden for others. Tapping an **abandoned dine-in** order opens its table view (02-S06), not 02b-S11. "Ready 2/3" also goes stale between refreshes (kitchen progress is not pushed; see 3.14).

### 3.26 02-S08 Held orders

Orders built and **held** on this screen (never sent; device-local, per person). List: identity (table / takeaway / parking), held at, items count, total → **Resume** (opens the order screen; a dine-in resume re-opens the table through 02a) / **Discard** (confirm). A held order does **not** keep the table locked. Only this screen sees them (the manager's view of all held orders is not in this release). Drafts survive a restart and a sign-out (per person and screen). Empty: "No held orders". Counter on the map: "Held (2)".

### 3.27 02b-S12 Zone stock

**Who:** everyone can **see** counts; only `manage-zone-stock` holders (scope my zones / branch) can change them (default managers; the restaurant grants the refill person). **Entry:** menu / "Zone stock" button for holders; from the zone alert card. **Data:** `GET /queries/zone-stock?zone_id=` → `[{ zone_id, name, items: [{ item_id, name, on_hand, threshold }] }]`; live by `ZoneStockAdded` / `ZoneStockSet` frames.

**Layout:** zones in floor order (the query does not say which zones are "mine", so "My zones first" needs data the client doesn't have — §7 Q22; buttons work only where the scope allows, else `403` "Not your zone") → per zone: rows "Raita · **6** · warn at 4" with **low** (≤ threshold, warning tone + icon "Low") and **empty** (0, danger + "Empty") highlighted → per row **Refill +** and **Count =**.

| Action | Sheet | Calls | Result |
|---|---|---|---|
| **Refill** (+n) | "Add Raita to Family hall" stepper 1–500 | `add-zone-stock { zone_id, item_id, quantity }` | `{ on_hand }`; moves stock from the store (if tracked) |
| **Count** (= n) | "How many Raita are there now?" number 0–5,000 | `set-zone-stock { zone_id, item_id, on_hand }` | `{ on_hand }`; does not touch the store |

| Code | Show |
|---|---|
| `409 STOCK_INSUFFICIENT { stock_item_id, available }` | "Not enough Yogurt in the store: 1.2 kg left" — `available` is in the **store item's** unit (kg, L, pieces); name and unit come from the menu setup's stock items |
| `409 BUSINESS_DAY_NOT_OPEN` (refill) | 02b-B11 |
| `422 ZONE_ITEM_NOT_CONFIGURED` | "This item isn't kept in this zone" |
| `404 ZONE_NOT_FOUND` | "Zone no longer exists" |
| `403 … outside_scope { zone_ids }` / no permission | buttons hidden; "Not your zone" |
| Offline | read-only, buttons disabled |

States: loading, no zones with stock ("No zone keeps stock"), long lists, Urdu.

### 3.28 02b-C05 Zone running low / empty card

Info family (soft chime, banner 4 s), to refill people and managers. Kinds `zone_stock_low` ("running low") and `zone_stock_out` ("empty"). Closes by itself when refilled (empty closes when the count is above 0; low when above the threshold). ⚠️ The alert as built carries **no zone or item name in what the card shows** (only the kind label), so the card can only say "A zone item is running low" unless that is added (§7 Q8). Tap → zone stock screen. Keys `alert.zone_stock_low.*`, `alert.zone_stock_out.*` missing today (add, UR).

### 3.29 02-B02 Reconnecting — n waiting to send

Sticky warning bar under the top bar (wifi-off icon). **One bar shared with 02a, one copy:** "**Reconnecting… 2 waiting to send**" (UR; count of queued items: orders, served marks, bill requests, cleans), or "Reconnecting… showing the last known tables" when the queue is empty. Queued items show a "Waiting to send" mark where they live (round on the table view, row in open orders, tile mark for 02a's bill/clean). On reconnect the queue drains **first**, in the order the taps happened, as the same person, without a new sign-in; the bar shows "Sending 2…" then "All sent" (toast), or "1 not sent — see the queue log" (link to 02-D14). "Order sent" appears only after the hub accepts it.

**What can be queued:** Send order, Mark served (02b), Ask for bill, Clean (02a). Nothing else (comps, removes, returns, weights, zone stock, boosts, handovers, calls → "Needs the hub"). For those **non-queued** actions a lost answer (timeout, 5xx) shows "Couldn't confirm — try again"; trying again is safe (same command id, never doubled).

### 3.30 02-D14 Queue log

Items that were tried and not accepted. Each row: what ("Order · F4 · 5 items", "Takeaway · 3 items", "Clean F4"), when (queued time), why (plain reason), buttons:

| Why (code) | Text | Buttons |
|---|---|---|
| session ended (`401 SESSION_EXPIRED` — signed out, taken over, idle too long offline > 4 h, PIN changed, hub restored) or unknown (`401 SESSION_INVALID`) | "Not sent: Bilal was signed out" | **Send again as {current person}** (named on the button), **Discard** |
| party changed (`409 TABLE_SEATING_CHANGED`) | "Not sent: the table had changed" | orders: **Copy to a new order** (new ids, opens the cart), **Discard**; served marks, bill requests, cleans: **Discard** only |
| any other 4xx (sold out, day not open, no permission…) | the plain reason | orders: **Copy to a new order**, **Discard**; others: **Discard** |
| `426 CLIENT_UPGRADE_REQUIRED` | not in the log: **stays queued**, sent after the app update | — |
| `403 DEVICE_REVOKED`, `401 DEVICE_TOKEN_INVALID` | screen must be paired again ("Ask a manager to pair this screen"); **the queue is kept** | — |
| 5xx / network | not in the log: stays queued, retried | — |

"Send again" of something the hub had in fact accepted shows it as sent. **Before a new sign-in is offered**, the sign-in screen shows "2 orders waiting to send" and sends them first; if that fails, the person can still sign in and the items wait here. States: empty ("Nothing waiting"), many rows, Urdu.

### 3.31 02-B09 Screen locked (idle)

The app runs its own idle timer (the person's idle time from sign-in: order taker 15 min, waiter 5, manager 60), connected or not; it checks the clock when the app comes back to the front and before acting on any tap. At expiry: full-screen lock "Signed out after 15 min idle. Your order is kept." (UR) → it **sends the queue first**, then signs out (offline: a pending sign-out kept and sent before the next sign-in) → sign-in screen. Nothing is ever sent as the old person after the lock shows. Drafts stay (per person).

### 3.32 02b-B11 Day not started

When no business day is open (`409 BUSINESS_DAY_NOT_OPEN` on send or preview, or known from catch-up): cart footer / send dialog shows "**The day hasn't started**" (UR) with **Start day** for people with `manage-stock` (branch) (opens the setup's start-day page, module 01a) or "**Ask the manager to start the day**" for others. The draft is kept.

### 3.33 02b-T01 Toasts

All UR: "Sent", "Not sent yet — will send when the hub is back", "Time updated", "Counter empty — sent to the kitchen", "Served", "Will mark served when the hub is back", "Removed", "Sent back · ready at 8:41 PM", "Comped", "Comp asked — waiting for approval", "Comp withdrawn", "Weight saved", "Kitchen told to hurry", "Refilled · 12 now", "Count saved", "All sent", "1 not sent — see the queue log", "This order is closed", "Needs the hub", "Already served".

---

## 4. Cross-screen flows

**F1 Dine-in, first round (happy).** Map → free F4 (02a opens + locks) → order screen → tap items (times appear within a second) → Send → "Sending…" → "Sent" with times → table view; table Ordered.

**F2 Drinks first, food later (a new round).** Round 1 drinks + raita → Send → table **Ordered** (drinks never turn it green). 10 min later: table view → **Add items** → order screen "Round 2" → karahi, naan → Send → a second round with its own promise. When the karahi and naan are served → **Eating**. A later drinks round leaves it Eating.

**F3 One more naan after the meal.** Table Eating (or Bill asked) → Add items → Naan × 1 → Send → round 3; its time is short. If the bill had been asked, the bill request clears (table back to Ordered; cashier reprints).

**F4 Sold out mid-order.** Seekh shows "4 left"; guest wants 6 → stepper stops at 4 ("Only 4 left"). While Ali types, another order takes the last 2 → preview marks the line "Only 2 left" → **Set to 2** / Remove. If it happens between preview and Send → Send refused `ITEM_SOLD_OUT { available: 2 }` → same line state, cart unfrozen. A `cook_fresh` item at 0 is not sold out: it shows the slow clock and a later time ("The last Paye went to another order — new time 8:40 PM").

**F5 Deal with choices.** Tap Family Deal → deal sheet → Bread: Roghni naan (+Rs 30); Drink: pick → Add → cart shows parts → Send. A choice sold out → disabled with reason; all choices of a part out → deal Sold out.

**F6 Modifiers.** Karahi → options sheet → Full (variant) → "Gravy: Choose 1" (default "Regular" preselected) → Extra naan × 2 (+Rs 40 each; disabled if naan is out) → Add disabled until required groups are met.

**F7 Weighed item.** Fish by kg (weighed) → options sheet: **Enter weight now** (fish weighed at the counter: 1.25 kg → Rs 2,750) **or Weigh later** → added with "Weight pending" (price per kg shown) → Send → kitchen weighs → cashier opens the table view → Enter weight 1.25 kg → line Rs 2,750. Karahi priced by g but not weighed → weight entered in the options sheet at order time (50 g steps).

**F8 Takeaway token.** Kiosk → New takeaway → name "Usman" (optional) → items → Send → **"57"** huge → Done. Open orders shows "57 · Ready 0/3 · 8:12 PM". Queued offline → "Token after sending". Day closed with 57 still cooking → next day shows "57 · 6 Nov".

**F9 Parking at the car.** Phone → New parking → "LEB 1234", Sedan, phone → Menu tab → items → Cart tab → Send → Open orders "LEB 1234 · Sedan". Ready 3/3 → highlighted → runner marks served at the car. Manager taps Call → phone shown (logged).

**F10 Counter (zone) items.** F4 in the Family hall: "Raita · 6 here" → tap ×2 → "From the counter" lines → Send → served immediately from the counter, count 4. Counter empty meanwhile → "Counter empty — Raita sent to the kitchen". Wrong raita → Remove within 5 min (count back); later → "Count it on the zone screen".

**F11 Removal at stage 1.** Round sent, karahi still "Later" / "Sent to kitchen" (not cooking) → Remove → 1 of 1 → Removed (kitchen gets a CANCELLED slip if it had been sent to a station). Naan 1 of 4 → stepper. Karahi already cooking → "Use Void" (04). Everything in the round removed → round Cancelled.

**F12 Send back within 30 min.** Karahi served 8:28 → guest complains 8:35 → Send back → Fix → replacement line "Cooking · 8:41 PM" → served → table stays Eating. Remake → full time; the remade dish stays billed → "Comp it?" (optional).

**F13 Send back after 30 min.** 9:10 → Send back → `409 ORDER_NOT_IN_ENGINE` → "This order is closed (served more than 30 min ago)" → **Send it as a new item** → order screen with the dish in the cart (new round) → Send → "Comp it?" → Comp (approval) → F14.

**F14 Comp waiting for approval.** Order taker → Comp → 1 unit, "Cold food" → Ask for approval → line "Waiting for approval — Rs 2,200 comp" + Withdraw. Manager's phone/tablet: banner + Requests → card → Approve → PIN → done. Ali: "Comped" (rising chime). No manager reachable → "No approver reachable — ask in person" → manager comes to Ali's tablet → **Approve here** → picks herself → PIN. Line removed meanwhile → request closes "the item changed".

**F15 Late food on a joined table.** F4 + F5 merged; both original parties' groups run late → **one** card "F4 + F5 — 2 late" → Send what's ready → one release for both → both warnings close.

**F16 Offline then reconnect.** Wi-Fi drops while building → times "—", draft kept → Send → queued ("Not sent yet") → bar "Reconnecting… 1 order waiting to send" → Wi-Fi back → sent in the same person's name (no sign-in) → real times; promise moved ≥ 60 s → "Time updated". Also queued meanwhile: Mark served (time = the tap), Ask for bill, Clean.

**F17 Offline too long / signed out.** Tablet off the Wi-Fi > 4 h, or signed out meanwhile → replay refused → queue log "Not sent: Bilal was signed out" → after sign-in "Send again as Sara" / Discard. Table changed meanwhile → "Not sent: the table had changed" → Copy to a new order / Discard. Sold out meanwhile → log with reason → Copy to a new order.

**F18 Idle lock on a shared tablet.** Ali leaves the tablet; 15 min later the lock shows → queue sent first → signed out → Sara signs in → Ali's draft stays under Ali (not visible to Sara).

**F19 Table taken away while ordering.** Ali types on F7; Sara (assignee) takes over → banner "Sara now has this table. Keep as draft" → Keep as draft (Hold). With take-order-anywhere → Send still works and never takes the lock — unless Sara (or anyone) is ordering on F7 at that moment: then "Sara is ordering on F7. Try when she's done."

**F20 Day not started.** First order of the morning → Send → "The day hasn't started" → manager: Start day → back → Send.

---

## 5. Edge cases and limits

- 1–40 lines per order; one quantity per line; partial actions name units.
- Kitchen note ≤ 80; order note ≤ 200; comp note ≤ 120; customer name ≤ 40; phone 10–13 digits; plate 2–12 (letters, digits, space, dash).
- Weights 50 g–50 kg in 50 g steps (same for ml); shown kg/L with up to 3 decimals.
- Preview draft ≤ 8 KB (long Urdu notes count more).
- Times are clock times from the hub; preview reserves nothing; the send result wins; "Time updated" at ≥ 60 s change.
- Sold-out items refused even when a few are left but fewer than wanted; stepper caps it.
- Counter items: dine-in only, plain items only, never refused (fall back to the kitchen), undo within 5 min (branch setting).
- Table turns Eating only on food: drinks, water, counter items and ready items (bottles) never.
- A round is always a new order; notes can't be edited after Send; no reorder; no delivery/web; no adding a child line to a sent parent.
- Remove only at stage 1 (before cooking); a deal with a g/ml part: whole deal only while that part is with the kitchen (even before it starts).
- Send back: served lines, inside 30 min after the order's last serve; one open return per line; never on counter lines; remade dish stays billed.
- Comp: online only; one pending per line; reason required ("Other" needs a note); never undone before the bill; a deal is comped as a whole; replacements never; counter lines only after their 5-min undo window.
- Weight: only `set-line-weight` holders; no change after a unit was comped/removed; bill can't close while pending.
- Mark served: only fired lines (or a no-station line, or an order out of the kitchen's list); ≤ 20 orders per tap; queueable.
- Queue: only Send, Mark served, Ask for bill, Clean; drained before sign-in; session kept while offline up to 4 h; ended sessions never accepted.
- Token: takeaway only, from 1 per business day, continues if the day is reopened; carried orders show their date.
- Parking: same plate = same car.
- Contact: only with `view-customer-contact`; fetched on demand, logged.
- Abandoned list: managers only; orders with nothing for the kitchen never.
- Zone refill 1–500; count 0–5,000; needs an open day for refill.

---

## 6. Not in this module — placeholders

| Owner | What appears on 02b screens | Placeholder |
|---|---|---|
| **02a Tables** | Table map (home), opening a table, the lock and its banners ("Ali now has this table. Keep as draft", "Opened on another device", "Your lock ended"), the table view header and actions (hand over, move, merge, split, ask for bill, clean, call waiter), sign-in and pairing | The order screen header shows the table chip and holder; the table view's top part is a grey "Table" block with action buttons |
| **03a Timing** | The time numbers, slow threshold, the late warning itself | Data only |
| **03b KDS / Pass** | Kitchen screens, tickets, Ready to serve and Served cards for waiters, hand-over at the pass, estimated served, CANCELLED slips | Inbox rows "Ready to serve · F4"; nothing to design here |
| **04 Voids** | Void of a cooking / cooked line (after stage 1), "Move to stock" vs "Wastage", void approvals | A "Void…" button where Remove is no longer allowed; tile flag "Void waiting" |
| **05 Billing** | Bill, payment, discounts, the comp's line on the bill, bill paid, split bill, Z report | "Billed" tag on rounds; total on the table view is a preview |
| **01d Alerts** | Requests and Inbox screens, answer sheet with PIN, banners, sounds | Reused |
| **01a Setup** | Menu, zones, stock items, Start day page | "Start day" link |

---

## 7. Open questions for the owner

| # | Question | Default meanwhile |
|---|---|---|
| Q1 | ~~"N left" threshold~~ — answered by setup: each item has its own low-stock threshold (the chip shows at level `low`). Remaining: show the count also at `ok` level? | only at `low` |
| Q2 | **Kitchen-note quick chips** ("Less spicy", "No onion", "Well done"): fixed list, owner-defined, or none? | none (typing only) |
| Q3 | Send refused because the bill was paid meanwhile (`TABLE_NEEDS_CLEANING`): offer anything besides Hold / Discard? | Hold / Discard |
| Q4 | **Stage words** (Later / Sent to kitchen / Cooking / Ready / Served / Sent back / Closed) — OK? | as proposed |
| Q5 | **Add items on a takeaway / parking order:** a new order with the same token / plate, or a fresh token? (The spec has no rule.) | hide "Add items" on takeaway / parking until answered (a new order is made from New takeaway / New parking) |
| Q6 | After a **Remake**, prompt "Comp it?" automatically? | no auto prompt; Comp button visible |
| Q7 | **Release sheet ("Send what's ready")**: show goes-with partners as "hurry" ticks, or hide them? | show, pre-ticked |
| Q8 | **Zone alert card names:** the alert shows no zone or item name today. Add them to the alert (hub change), or keep the generic text? | generic text + tap to the zone screen |
| Q9 | **Slow chip number:** the tile has no per-item preview; the likely source is the station's live wait (`stations_live.wait_ms`) plus the item's cook time. Confirm the formula. | station wait + cook time, in minutes |
| Q11 | **Held orders**: may another person on the same screen see / resume them? (Spec: per device and staff.) | no |
| Q12 | Open orders on the **tablet** for order takers: show all, or only orders I placed? (`open-orders` has no placer field; the catch-up orders have `placed_by`, so a "mine" filter is possible client-side.) | all |
| Q13 | Takeaway **name**: show on the kitchen ticket / Ready card? (privacy) | token only |
| Q14 | Money format confirmation: "Rs 2,200" (commas in threes, not lakh). | yes |
| Q15 | Comp **reason chips**: the setup default is Late, Wrong item, Quality, Guest, Other (1–10, ≤ 30 chars, per branch) — keep? | yes |
| Q16 | A person **without `take-order`** (waiter): hide the order screen entirely, or show a read-only menu "You can't take orders on this device"? | hide |
| Q17 | **Kitchen progress on ordering screens:** Cooking / Ready changes are not pushed to staff screens. Add a staff-socket audience (03b / 02b change), or refresh on open + a Refresh button? | refresh + button |
| Q18 | **Plain options and the order note after Send** are not in the table-view data (only linked options come back). Add them to `seating-orders` (hub change)? | not shown |
| Q19 | **Takeaway / parking order view** has no per-order lines query (no stage, no fired flag). Add one, or extend `open-orders`? | Served / Not served only (3.15) |
| Q20 | **Remove takes the free lock** for the holder and nothing releases it (others see the table locked until timeout). Release it after a table-view remove (client sends Release), or leave? | client sends Release after the remove |
| Q21 | **Comp request card for takeaway / parking** has no table code, token or plate. Add the token / plate to the alert display (hub change)? | "Comp · Takeaway order" |
| Q22 | **Zone stock "my zones first":** the query does not mark the person's zones. Add it? | floor order |
| Q23 | **Who marks a counter takeaway served?** The cashier has no `mark-served` by default. Grant it, or does the runner do it? | ask; design the button for whoever has it |

---

## 8. Coverage checklist

### 8.1 Spec §8 client contract

| §8 item | Covered in |
|---|---|
| Ordering screen (inventory 02-S05): category rail, search, tiles | 3.4, 3.6 |
| Tiles: Sold out / Not now · hours / "4 left" / slow clock "25 min" when `slow_item_threshold_ms` passed / "Only 2 left" caps the stepper | 3.6, Q1, Q9, F4 |
| Cart sorted by ETA, each group's promise as a clock time | 3.4, 2.6 |
| Options sheet with defaults visible and linked-option availability | 3.8, F6 |
| Kitchen note ≤ 80, order note ≤ 200 | 3.10 |
| Hold (device draft) | 3.4, 3.26 |
| Send freezes the cart | 3.4, 3.13 |
| Preview via `eta-preview` per change, debounce 250 ms; refetched on `BranchConfigApplied`, stock frames, `stations_live` | 3.4 |
| "Time updated" when a promise moves ≥ 60 s | 3.13, F16 |
| Zone items: tile shows the zone count ("Raita · 6 here"); tap adds/increments one `from_zone` line | 3.7 |
| `zone_served: false` → "Zone empty — sent to the counter / kitchen", once | 3.7, 3.13 |
| Undo within `zone_undo_ms` from the table view; later Count on the zone screen | 3.17, 3.27, F10 |
| Types: Dine-in from the map; Takeaway (name, phone optional → token big after Send); Parking (plate LTR mono, type icons, phone) | 3.1–3.3, 3.13, F8, F9 |
| Table view: rounds by time and person | 3.14 |
| Stages in words | 3.14, Q4 |
| Mark served (fired lines only) | 3.14, 3.16 |
| Send what's ready | 3.24 |
| Boost | 3.23 |
| Return (fix / remake) | 3.18 |
| Comp (units, reason chips) with waiting card "Waiting for approval — Rs 450 comp" | 3.19, 3.20, F14 |
| Remove (stage 1, units stepper) | 3.17, F11 |
| Weight entry | 3.21, F7 |
| "Call" on a parking order fetches `order-contact` (only with `view-customer-contact`) | 3.22, F9 |
| Return offered on the replacement line once a line was remade | 3.14, 3.18 |
| Replacement removed, guest wants it again → new round bills it → "Comp it?" | 3.18 |
| `409 ORDER_NOT_IN_ENGINE` from Return → "order is closed (served more than 30 min ago)" → "Send it as a new item" → new round + "Comp it?" | 3.18, F13 |
| Open orders: takeaway by token, parking by plate; ready n / m; "from <date>"; abandoned list for managers | 3.25 |
| Zone stock screen: my zones, counts, Refill (+n), Count (= n); low / out highlighted | 3.27 |
| Queue: "Reconnecting… 2 orders waiting to send" | 3.29 |
| On reconnect the queue drains first, as the same person, no new login | 3.29, F16 |
| Queue log: "Send again" as the person now logged in, "Discard", "Copy to a new order" | 3.30, F17 |
| Day not started → "Start day" for holders, "Ask the manager to start the day" for others | 3.32, F20 |
| Device idle lock: own idle timer, wall-clock check on resume and before any tap, lock screen, drain first, logout, pending logout offline | 3.31, F18 |
| Late cards (O18): one card per current table, each warning's lines, one `ReleaseItems` for all | 3.24, F15 |
| Rules: buttons from permissions (R5); Urdu / English, Latin digits (R20) | 1.2, 2.5, 3.14 |
| R14 / R15 (no service worker, no secure-context APIs, ULIDs from getRandomValues, Capacitor transport) | build rules with no screen — nothing to design |

### 8.2 Inventory IDs

| ID | Covered in |
|---|---|
| 02-S04 Order type | 3.1 (delivery / web not shown) |
| 02-D02 Parking | 3.3 |
| 02-D03 Takeaway | 3.2 (token from the hub, not typed) |
| 02-S05 Order screen | 3.4 |
| 02-D04 Item options | 3.8 (+ deal 3.9) |
| 02-D05 Item note | 3.10 |
| 02-D06 Order note | 3.10 |
| 02-D07 Submit | 3.13 |
| 02-S06 Table view (orders part) | 3.14 |
| 02-D08 Mark served | 3.16 |
| 02-S07 Open orders | 3.25 |
| 02-S08 Held orders | 3.26 |
| 02-S09 Reorder | **not in this release** (deferred by the spec) — no screen |
| 02-D14 Unsent orders from an ended session | 3.30 |
| 02-B02 Reconnecting | 3.29 |
| 02-B03 Order kept on this device | screen list 02-B03; 3.4 (draft restored), 3.26, 3.31 |
| 02-B04 ETA unavailable | 3.12 |
| 02-B05 Item unavailable in cart | 3.11 |
| 02-B06 Stock / slow chips | screen list 02-B06; 3.6 |
| 02-B07 Last unit taken — ETA corrected | screen list 02-B07; 3.11, 3.13, F4 |
| 02-B09 Logged out idle | 3.31 |
| 02-S10 Phone order screen | 3.5 |
| 02-S01–S03, D01, D09–D13, B01, B08 | 02a brief (§6) |

### 8.3 Client-visible error codes (02b §9, reused, per command)

| Code | Covered in |
|---|---|
| `ORDER_NOT_FOUND` 404 (`order_id` / `order_item_id`) | 3.16–3.23 |
| `ORDER_ITEM_ID_IN_USE` 409 | 3.13 (own pending = sent), 3.18 |
| `ITEM_UNAVAILABLE` 409 | 3.11 |
| `ITEM_OUT_OF_HOURS` 409 (item / deal) | 3.11, 3.9 |
| `ITEM_SOLD_OUT` 409 | 3.11, F4 |
| `OPTION_CHOICE_INVALID` 422 | 3.8, 3.11 |
| `ZONE_ITEM_NOT_CONFIGURED` 422 | 3.27 |
| `STOCK_INSUFFICIENT` 409 | 3.27 |
| `LINE_NOT_WEIGHED` 409 | 3.21 |
| `LINE_WEIGHT_PENDING` 409 | 3.19 |
| `LINE_ALREADY_SETTLED` 409 | 3.21 |
| `COMP_NOT_ALLOWED` 409 (`not_live`, `return_line`, `deal_part`, `zone_line`) | 3.19 |
| `COMP_PENDING` 409 | 3.19 |
| `ORDER_BILLED` 409 | 3.17, 3.19, 3.21 |
| `BUSINESS_DAY_NOT_OPEN` 409 | 3.32, 3.13, 3.27 |
| `ORDER_NOT_IN_ENGINE` 409 | 3.18, 3.23, 3.24, F13 |
| `RETURN_ALREADY_OPEN` 409 | 3.18 |
| `STATION_PAUSED` 409 | 3.11, 3.18 |
| `ITEM_WRONG_STAGE` 409 (`added`, `cooking`, `done`, `served`, `returned`, `out_of_engine`, `zone_served`, `not_engine_line`, `removed`, `voided`) | 3.16, 3.17, 3.18 |
| `REQUEST_NOT_PENDING` on the late card | 3.24 |
| `DEVICE_TOKEN_INVALID` 401 (queue kept) | 3.30 |
| `MENU_ITEM_NOT_FOUND`, `DEAL_NOT_FOUND` 404 | 3.11, 3.18 |
| `ZONE_NOT_FOUND` 404 | 3.27 |
| `TABLE_SEATING_CHANGED`, `TABLE_ALREADY_LOCKED`, `TABLE_NEEDS_CLEANING` (02a) | 3.13, 3.17, 3.30 |
| `SESSION_EXPIRED`, `SESSION_INVALID` 401 | 3.13, 3.30 |
| `PERMISSION_DENIED` 403 (`not_holder`, `outside_scope`, `managers_only`, grant) | 3.13, 3.17, 3.25, 3.27 |
| `VALIDATION_FAILED` 400 (incl. `gml_deal_part_partial`, units, notes, phone, plate) | 3.2, 3.3, 3.17, 3.19 |
| `CLIENT_UPGRADE_REQUIRED` 426, `DEVICE_REVOKED` 403 (queue kept) | 3.13, 3.30 |
| 01d answer errors on the comp card (`REQUEST_NOT_PENDING`, `PIN_INVALID`, `PIN_LOCKED_OUT`, `REQUEST_PIN_REQUIRED`) | 3.20 |

### 8.4 Client tests (§10 #35, #36) and hub tests that change the screen

| Test clause | Covered in |
|---|---|
| #35 queue stored before first send; replay in tap order; no "sent" before 2xx | 3.13, 3.29 |
| #35 4xx in the log; frozen cart; own pending `ORDER_ITEM_ID_IN_USE` shown as sent | 3.13, 3.30 |
| #35 drafts survive reload | 3.4, 3.26 |
| #35 device idle lock offline, drains first, logs out; pending logout not a queue entry | 3.31 |
| #35 "Send again" names the person | 3.30 |
| #35 late cards grouped by current table; merge → one card; split → each under its oldest order's table | 3.24, F15 |
| #35 TTL elapsed while suspended → first tap shows the lock, nothing sent as the old person | 3.31 |
| #35 `426` keeps the command queued | 3.13, 3.30 |
| #36 stepper capped | 3.6, F4 |
| #36 zone-empty flip | 3.7 |
| #36 slow chip from `slow_item_threshold_ms` | 3.6 |
| #36 sold-out update from the stock frame within 5 s | 3.6 |
| #36 day-not-started per permission | 3.32 |
| #36 cart sorted by ETA | 3.4 |
| #36 table view rounds by time | 3.14 |
| Hub #10 round 2 is a new order; earlier promise unchanged | F2 |
| Hub #12 table state on food only (drinks never green) | 3.16, F2, F10 |
| Hub #13 zone line falls back to the kitchen, never refused (also queued) | 3.7 |
| Hub #16 token per day, carried token shows its date | 3.13, 3.25, F8 |
| Hub #18 remove stages and `ITEM_WRONG_STAGE` | 3.17 |
| Hub #22 unfired line not servable; queued serve keeps the tap time | 3.16 |
| Hub #25 remake, then Return the original → `returned`; Return the replacement | 3.18 |
| Hub #27 pending comp closed when its units are removed; requester told | 3.20 |
| Hub #31 Wi-Fi drop: queue accepted in the same name; ended session → log; revoked → queue kept | 3.29, 3.30, F16, F17 |
| Hub #32 waiters never see contact; placer and kiosk do | 3.22 |

### 8.5 Owner rulings and AD rows that change what the user sees

| Ruling | Covered in |
|---|---|
| O1 / E-4: every later round is a new order | F2, F3 |
| O5 / M-4: counter items never refused; fall back to the kitchen | 3.7 |
| O13: comps online only | 3.19 |
| O15: short stock refused; stepper capped | 3.6, 3.11 |
| O16: served needs a fired line; remove = stage 1 | 3.14, 3.16, 3.17 |
| O17: contact only on demand, logged | 3.22 (keeping it in history is a data rule, no screen) |
| O18: one late card per current table | 3.24 |
| O20: remade dish stays billed unless comped | 3.18 |
| Q5 (owner): table turns green on food only; ready items never | 3.16, F2 |
| E-7: after 30 min → "Send it as a new item" + comp | 3.18, F13 |
| Q4 (owner) / H-1: session kept while offline (≤ 4 h); queue replays as normal | 3.29, F16 |
| AD-7: token is a whole number | 2.6, 3.13 |
| AD-11: zone empty closes above 0, low above the threshold | 3.28 |
| AD-17: validation is 400 | 3.17, 3.19 |
| AD-18: variant = its own item | 3.8 |
| AD-19: deal outside its hours | 3.9, 3.11 |
| AD-20: deal kitchen note to every part | 3.9 |
| AD-26: preview draft size (Urdu notes) | 3.4, §5 |
| AD-27: return lines can't be weighed | 3.21 (`LINE_NOT_WEIGHED` row) |
| Hostile review fixes (S11 data gap, stages not pushed, plain options gap, weight at order time, counter comp after undo, stock level, Send it as a new item on closed lines, g/ml deal rule, token after replay, still-sending state, anywhere + lock, two late-card answer paths, one shared offline bar, component anatomy, comp card variants) | 2.9, 3.4–3.30, §7 Q16–Q23; `02-brief-review.md` |
| AD-29: deal header can't be served; no-station line can | 3.14, 3.16 |
| AD-31: return to a paused station refused | 3.18 |
| AD-32: fix with the item gone from the menu | 3.18 |
| AD-34 / AD-35: stages `zone_served`, `not_engine_line` | 3.18 |
| AD-37: one promise per order on the table view | 3.14 |
| AD-39 R1 / R2 / R12: abandoned list managers only, any type, never kitchen-less orders | 3.25 |
| AD-39 R3: ready n / m counting | 3.25 |
| AD-39 R4: promise null sorts last | 3.25 |
| AD-39 R5 / AD-41: "from <date>" | 3.25 |
| AD-39 R8: `fired` per line enables Mark served | 3.14 |
| AD-39 R11: unknown zone → 404 | 3.27 |
| AD-43 / v1.0.5: submit on a held table needs holder or take-order-anywhere (no extra floor check) | 3.13, F19 |
| 02a P-1b / v1.1.3: queued send never takes or moves a lock | F16, F19 |
| 01b defaults: waiter has no `take-order`; cashier no `mark-served`; order taker comps need approval; zone stock owner/manager only | 1.2, 3.14 |
