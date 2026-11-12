# 02a Tables — design brief (staff screens)

**For:** the designer, in a separate chat, with no repo access. This file is all you get, so everything is stated here.
**Covers:** every staff screen, sheet, dialog, card, banner and toast of module **02a Tables**: sign-in, the table map, the table sheet with its actions (open, lock, take over, hand over, force move, move, merge, split, ask for bill, clean, call waiter), the handover request cards, the lock banners and the offline rules.
**Not covered here:** what is inside an order (menu, cart, rounds, served, returns, comps). That is **02b Ordering**, with its own brief. This brief shows it only as a placeholder (§6).
**Sources:** spec 02a Tables v1.1.4 (APPROVED), spec 02b Ordering v1.0.5 where it touches tables, the built hub code (field names below are as built), the 02a status board rulings, the screen inventory (IDs like `02-S03` are kept), and the Pulse design system already used by the 01d alerts screens.
**Rule of precedence:** this brief wins on behaviour and copy. Your frames win on layout and look. If a state is missing, ask; do not invent behaviour. Open points are in §7.

Words used:

| Word | Meaning |
|---|---|
| **Seating** | One party at the restaurant, from "open the table" to "table cleaned". It has one **primary table** and 0..n **joined tables** ("T4 + T5"). It has an id (`seating_id`). |
| **Holder** | The person who opened the seating or took it over. Only one. Changes only by take-over, accepted handover or force move. |
| **Assignee** | The order taker the owner assigned to this table or its zone (setup data, never changed on the hub). May be nobody. |
| **Lock** | "Someone is typing an order on this table right now." Belongs to one person **on one device**. Only one lock per seating. Others can still serve, ask for the bill, clean. |
| **Lead** | The person someone reports to. A reporting line, not a role. It gives no permissions. |
| **T / K / P** | Tablet (1280 × 800 landscape, 800 × 1280 portrait), cashier Kiosk (1920 × 1080, mouse + touch + keyboard, no browser back), staff Phone (390 × 844, also 360 wide). |

---

## 1. Purpose and users

### 1.1 What this module is for

The table map is the home screen of every order taker. In one look it shows which tables are free, who is sitting where, who is taking an order where, whose table it is, and what the table needs next (order, food, bill, cleaning). From a table you open it to take an order, or you act on it: hand it to a colleague, move the party, join two tables, split a party, ask for the bill, call a waiter, mark it clean.

The hard rule behind everything (owner rule R23): **a party never lands on someone else without them knowing.** A table goes to another person only when that person accepts, or when a manager forces it (logged).

### 1.2 Who uses it

There are no role-named screens. Everyone uses **the same screens**; buttons appear, hide or show "needs approval" from the person's own permissions (owner rule R5). The roles below are the shipped defaults; a restaurant can change them.

| Default role | Relevant permissions (scope) | What they do on these screens |
|---|---|---|
| **Order taker** ("captain") | `take-order` (whole branch), `clean-table` | Opens tables, takes orders, hands over, moves / merges / splits **their own** tables, asks for the bill, calls a waiter, cleans. Often the **assignee** of a zone ("Ali has the family hall"). |
| **Waiter** (runner, refiller) | `clean-table`, `mark-served` (02b). **No `take-order`.** | Sees the map. Gets "call waiter" alerts. Cleans tables. Cannot open a table, ask for the bill, call a waiter or move anything. Reports to an order taker (his lead). |
| **Cashier** | `take-order` (branch), `clean-table` | Mostly takeaway / parking on the kiosk (02b), but can open tables, ask for a bill and clean. |
| **Manager / Owner** | everything, including `take-order-anywhere`, `force-release-table-lock` | Everything above, plus: open a table someone else holds, release someone's lock, force a table to another person, move / merge / split onto someone else's tables. |

Permission meanings (the client reads them from `GET /queries/session` → `permissions: { [permission]: { grant, scope? } }`):

| Permission | Means | Scopes |
|---|---|---|
| `take-order` | open tables and act on your own seatings | `branch` (all floors), `my_floors` (only tables on the floors you are on), `own_tables` (may open **any free table**; after that may act only on the seatings **you hold**: Ask for bill, Call waiter, Hand over, Move, Join, Split on a party someone else holds → refused "outside your tables"; can never take over) |
| `take-order-anywhere` | open / order on a seating **held by someone else** (when nobody has it locked) | `branch`, `my_floors` |
| `force-release-table-lock` | the "manager" permission: release a lock, force a table to someone, move / merge / split across owners, hand over a table you do not hold | `branch`, `my_floors` |
| `clean-table` | mark a table clean | `branch` |

Grant types: `allowed` (button shown and works), `requires_approval` (for these table permissions it counts as **not allowed**: no approval flow for tables in the pilot), `not_granted` / `denied` (button hidden).

### 1.3 Devices

| Device | Who | Notes |
|---|---|---|
| **T** tablet, Android app | order takers, managers | Main device. Landscape at a station, portrait in the hand. Shared tablets: several people sign in and out during the day. |
| **K** cashier kiosk, Windows, Chrome in kiosk mode | cashier | 1920 × 1080. Mouse, keyboard and touch. **No browser back: every screen needs its own back.** Gets the table map too. |
| **P** phone, the person's own, browser page | order takers, waiters, manager on the floor | 390 wide, one hand, walking. Only its owner signs in on it. Gets alerts only while the page is open. |
| Kitchen screens | — | Not in this brief. They never show the table map. |

### 1.4 A real shift (Saturday dinner, Arif Chatkhara, Gulberg)

7:30 PM. Ali (order taker, assigned the Family hall) signs in on Tablet 3 with his PIN. His map opens on the Family hall: 8 tables, two already seated. A family of 6 walks in; Ali taps free F4, the tile turns **Seated · Ali** with a padlock, and the menu opens (02b). He sends a first round of drinks and starters; F4 shows **Ordered**. Meanwhile Bilal, who works the Ground floor, seats a couple on F7 because the hall door is closer — F7 is Ali's zone, so the tile now shows **holder Bilal** and **assignee Ali**. Ali taps F7 and **Takes over**: no question asked, he is the assignee; Bilal's padlock disappears and his half-typed draft stays on his tablet with a banner "Ali now has this table. Keep as draft". At 8:15 the family on F4 grows to 9, so Ali **merges** free F5 into F4: both tiles now read "F4 + F5". The karahi lands; when every food order is served the tile turns **Eating** (02b decides that). A guest waves; Ali is busy, so he taps **Call waiter → Water** on F4: his two waiters (who report to him and are working) get a banner; his own tablet stays quiet. At 9:30 Ali's shift ends; he **hands over** F4+F5 to Sara. Sara's tablet rings "Table handover · F4 + F5 · from Ali — 3 orders · Rs 14,250"; she taps **Accept**; F4 now shows **Sara**. The family asks for the bill: Sara taps **Ask for bill**; the tile turns **Bill**. The cashier settles it (05 Billing); the tile turns **To clean**. A waiter wipes the table and taps **Clean**: F4 and F5 are **Free** again. Earlier, the Wi-Fi near the kitchen dropped for two minutes while Bilal tapped Clean on T2: his tablet queued it and sent it when the Wi-Fi came back. A manager also released a lock left by a waiter who went home with his tablet in his pocket.

---

## 2. Design system to reuse (Pulse, as built for 01d)

The staff screens use the **Pulse** look already shipped for the 01d alerts screens (Inbox, Requests, banners, answer sheet, sign-in). Reuse it; do not start a new style. The tables screen was already sketched in Pulse as the background of the 01d banner frames ("Puck+" floor plan + a 340 px side column); that sketch is the starting point, not a final.

### 2.1 Colour tokens (light theme; staff screens are light)

Brand (white-label; the only values a restaurant changes): `--brand-primary #F4A321` (saffron, main action), `--brand-on-primary #3A0E07`, `--brand-secondary #6E140E` (maroon: top bar, selection, "yours"), `--brand-on-secondary #FFF3E6`. Brand colours never replace status colours.

| Group | Tokens |
|---|---|
| Surfaces | `--bg #F8F1E7` (cream page), `--surface #FFFFFF` (cards), `--surface-2 #FBF6EF`, `--surface-3 #F1E7DA`, `--line #ECDFCF` |
| Ink | `--ink #2B130E`, `--ink-2 #5A3F36`, `--muted #7A6157` |
| Primary button | `--primary #F4A321`, `--on-primary #3A0E07` |
| Accent | `--accent #8E1F16`, `--on-accent #FFF4E6`, `--accent-bg #FBE7E3` |
| Top bar | `--chrome-bg #6E140E`, `--chrome-ink #FFF3E6`, `--chrome-muted #EBC3A6` |
| Table chip | `--ident-bg #F4A321`, `--ident-ink #3A0E07` |
| Semantic | `--ok #198754` (bg `#E3F3E9`, ink `#136A42`) · `--warn #D9660A` (`#FFEEDC`, `#9C4700`) · `--danger #C8262E` (`#FCE6E4`, `#A81D25`) · `--info #2563C9` (`#E8F0FC`, `#1D4F9F`) |
| Floor plan | `--floor-bg #FFFBF5`, `--floor-dot #EFE3D3`, `--wall #E0CDB8`, `--zone-bg #F6ECDF`, `--zone-ink #7A6157`, `--tb-bg #FFF`, `--tb-edge #E6D5C2`, `--clean-fill` = 135° stripes `#F6EEE4`/`#FCF7F1` 8 px |

**Table state colours.** The Pulse kit has these tokens (colour / ground / ink):

| Pulse token | Colour | Ground | Ink | Used for |
|---|---|---|---|---|
| `--s-free` | #B9A595 | #FBF6EF | #6E5549 | FREE |
| `--s-seated` | #2563C9 | #E8F0FC | #1D4F9F | SEATED |
| `--s-ordered` | #6D46D9 | #EFEAFC | #5534B6 | ORDERED |
| `--s-eating` | #198754 | #E3F3E9 | #136A42 | FOOD_ON_TABLE |
| `--s-bill` | #C8262E | #FCE6E4 | #A81D25 | BILL_REQUESTED |
| `--s-clean` | #9A8B80 | #F4EDE5 | #6E5549 | NEEDS_CLEANING |

⚠️ **Conflict, open (§7 Q1):** the 02a spec fixes a different palette: FREE green, SEATED blue, ORDERED amber, FOOD_ON_TABLE teal, BILL_REQUESTED purple, NEEDS_CLEANING grey. The spec wins unless the owner changes it, so get the answer before final frames; draft with **one token per state** so the answer is a token swap. Either way, colour never carries the meaning alone (§2.4).

### 2.2 Type

Fonts are bundled (no internet on the LAN): **Figtree** (UI text), **Bricolage Grotesque** (titles, big numbers: table numbers, totals, clock), **Geist Mono** (codes, PINs), **Noto Nastaliq Urdu** (Urdu, 400 and 700).

| Style | Font / size / line / weight |
|---|---|
| display | Bricolage 40/46 800 |
| title | Bricolage 28/34 800 |
| heading | Bricolage 22/28 750 |
| body-lg | Figtree 20/28 400 (kiosk, tablet) |
| body | Figtree 17/24 400 (phone) |
| label | Figtree 17/22 700 |
| caption | Figtree 15/20 500 (never below 15; nothing a cashier reads below 17) |
| ur-title / ur-body | Nastaliq 24/2.0 700 · 19/2.05 400 |

Sizes already used on staff screens: table number on a floor-plan table 26 px, on a grid tile 34 px; state word 13 px 700–750; status pill 14 px 650 at 30 px high; card title 20 px 750; dialog title 26 px 800; top-bar clock 18 px.

### 2.3 Space, radius, touch

- Spacing 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48. Gutters: phone 16, tablet and kiosk 24.
- Radius: 10 / 16 (buttons, inputs) / 20 (tiles, tables, banners) / 26 (cards, dialogs) / pill. Bottom sheets 28 px top corners with a grip.
- **Touch target minimum 56 × 56 px on every staff device**, 12 px between targets. Dialog action buttons 72 px high. Segmented options and pills 56. Phone tab bar 60.
- At 1280 and up the page never scrolls; only list regions scroll. Dialogs: max height = screen − 32 px, the body scrolls, the buttons always stay visible. Phones: never shrink the tablet layout; no horizontal scroll.
- Breakpoints: ≤ 760 px = phone; portrait ≥ 761 px = tablet portrait (dialogs become bottom sheets, nav gets its own row under the top bar); ≥ 1600 px = kiosk.
- No hover, no double-tap, no long-press-only, no swipe-only actions. One primary (saffron) button per layer.

### 2.4 State = icon + word (+ colour)

Every state, everywhere, is **an icon and a word**, and colour comes third. A colour-blind waiter in bad light must read the map. Proposed words (English, short, fit a tile):

| State (`state` value) | Word | Icon idea |
|---|---|---|
| `FREE` | Free | empty chair / dashed outline |
| `SEATED` | Seated | person |
| `ORDERED` | Ordered | ticket |
| `FOOD_ON_TABLE` | Eating | plate |
| `BILL_REQUESTED` | Bill | receipt |
| `NEEDS_CLEANING` | To clean | broom / sparkle |
| lock overlay | padlock + locker's name | padlock |

Alert families (from 01d) also have shapes: action = blue outlined pill with a hand; info = neutral pill with "i".

### 2.5 English and Urdu

- Every string is a key with English and Urdu. Urdu: `lang="ur" dir="rtl"`, Nastaliq font, taller lines (1.8–2.05), no uppercase, no letter-spacing, pills grow to 28 px. **Never fix the height of a text box.**
- Only chevrons and back arrows mirror in RTL; nothing else.
- **Always LTR**, even inside Urdu: table names and codes ("T4", "F4 + F5"), amounts, quantities, times, durations' digits, PINs and the PIN pad, phone numbers, device names. **Latin digits in Urdu** (owner rule R20).
- **The floor plan / tile grid stays LTR** (left to right, as the room is laid out), even in Urdu.
- Staff names may be long and may be Urdu script. Design for "Muhammad Abdul Rehman Qureshi" (29 chars) and a 40-char worst case; truncate with an ellipsis only on tiles, never in dialogs.
- Every string in this brief marked **UR** needs an Urdu translation. A missing Urdu key falls back to English (and goes on the Urdu to-do list).

### 2.6 Numbers, money, time

- Money: integers in paisa on the wire (`total_minor`, `amount`). Show **"Rs 14,250"**: thousands grouped in threes with a comma (not lakh), paisa only when not zero ("Rs 12.50"). Key `alerts.amount` = "Rs {amount}".
- Time: **12-hour, "8:15 PM"**, hub time zone, Latin digits. (Owner sign-off on 12 h is still listed as open in 01d; design 12 h.)
- Durations: "32 min", "1 h 10 min", "0:42" (a live mm:ss countdown/count-up). Earlier business day: "from 1 Nov".
- Badges: hidden at 0, "99+" above 99.

### 2.7 Copy tone

Plain words, verb first, sentence case. Say what to do next, not what went wrong. Never show an error code or a server message. "You", never "we". No exclamation marks, no emoji. Staff words: "screen" not "device", "hub" not "server", "kitchen screen" not "KDS". Losing the hub is normal: stay calm, keep what is on screen.

### 2.8 Components that already exist (reuse, same names)

From the Pulse staff layer: top bar `.top` (80 px maroon) with brand block, `.live` pill ("Live" / "Hub offline"), clock, person chip `.me`; segmented `.seg` with counts; badges; floor plan `.fp` + table `.tb` (with `__n` number, `__w` word, `__t` time, `__who`, `__flag`, `__puck`, `.mine`, `.urgent`, `.round`); grid tile `.gt`; summary strip `.sum`; table chip `.tcode` (saffron, LTR); status pill `.st`; avatar `.av`; open card `.ac` and row card `.ar`; banners `.abns`/`.abn`; dialog / bottom sheet `.scrim`/`.dlg`; facts grid `.facts`; 72 px button pair `.acts`; sticky warning bar `.warnbar`; inline message `.msg`; read-only line `.ro`; pick list `.pick`/`.radio`; toast `.toast` (maroon, bottom end); skeleton `.sk`; empty state `.empty`; waiting ring `Ring` (fills over 4 min); PIN pad; staff name tiles. Icons: inline SVG, 24 grid, round stroke 1.9, `currentColor` (bell, hand, info, chevron, back, shield, tray, wifi, wifi-off, user, team, receipt, warn, clock, lock, sync, sign-out, tablet, cash, pin, send…). New icons you add follow the same grid.

Banner rules (01d, keep): banners stack at the top end, **at most 2**, newest on top, then a maroon pill "{n} more new · Open inbox". A banner may cover the side column but **never** the main action (New order, Send, Pay). Action banners hide after 6 s, info after 4 s. No close, no snooze. Portrait: full width under the bar; phone: under the phone top bar, Open on its own row. Layers: banner 20, toast 25, scrim 30. Sounds per family (action = bright double ding once; info = soft chime once) are already built; you do not design them.

### 2.9 Handoff format (same as 01d)

Please deliver: static HTML frames at device size, one file per screen state, named `<Screen><Variant>` (e.g. `TableMap`, `TableMapLoading`, `TableMapOffline`, `TableMapPortrait`, `TableMapKiosk`, `TableMapPhone`, `TableMapUrdu`), each with its PNG; a `MAPPING.md` + `mapping.json` (screen ID → frames → components); a `CHANGES.md` (your decisions, answers to §7, new string keys); the CSS you add on top of Pulse; and a string table (key, English, Urdu, max length, LTR flag). Frames: T 1280 × 800 and 800 × 1280, K 1920 × 1080, P 390 × 844; English and Urdu for every screen at least on T landscape and P.

---

## 3. Screens

**Screen IDs.** Inventory IDs are kept (`02-S03` etc.). New items get `02a-` IDs. Kinds: S screen, D dialog/sheet, C card, B banner/inline state, T toast.

**Screen list (27):**

| ID | Name | Kind | Devices |
|---|---|---|---|
| 02-S01 | Sign-in: name grid | screen | T K P |
| 02-S02 | Sign-in: PIN pad | screen step | T K P |
| 02-D01 | Someone is signed in here — sign them out? | dialog | T K |
| 02a-S00 | Pair this screen again (route only) | screen (from 00) | T K P |
| 02a-C10 | Top bar | component | T K P |
| 02-S03 | Table map (home) | screen | T K P |
| 02a-C01 | Table tile | component | T K P |
| 02-B01 | Table busy: "Ali is taking an order here" | sheet | T K P |
| 02-D12 | Release Ali's lock (force release) | dialog | T K P |
| 02-S06 | Table sheet (table part of the table view) | sheet / screen | T K P |
| 02a-D22 | Take over this table | dialog | T K P |
| 02a-D20 | Hand over to… (candidates) | sheet | T K P |
| 02a-D21 | Force move to… (manager) | sheet | T K P |
| 02-D09 | Move party to another table | sheet | T K (P subset) |
| 02-D10 | Join / merge tables | sheet | T K (P subset) |
| 02-D11 | Split the party | sheet | T K (P subset) |
| 02a-D23 | Call a waiter (chips) | sheet | T K P |
| 02a-D24 | Ask for the bill | inline confirm | T K P |
| 02-D13 | Mark clean | dialog | T K P |
| 02a-D25 | "Hand it over to Sara; she moves it" (other owner) | dialog | T K P |
| 02a-C02 | Handover request card (receiver) + its answer sheet | card / sheet | T K P |
| 02a-C03 | Handover waiting card (sender) | card | T K P |
| 02a-C04 | Handover result notice (sender) | card / banner | T K P |
| 02a-C05 | Call-waiter card (waiters) | card / banner | T K P |
| 02a-B10 | Lock banners: released / opened on another device / table taken by someone else | banner | T K P |
| 02-B02 | Hub offline bar and "Needs the hub" disabled state | bar / inline | T K P |
| 02a-T01 | Toasts of this module | toast | T K P |

Common data rule: **every action on a seated table sends the `seating_id` the screen is showing.** If the party changed in between (someone moved, cleaned, merged), the hub answers `409 TABLE_SEATING_CHANGED`; the screen then says "This table changed — refreshed" and reloads the tile. Design that toast once (02a-T01) and use it everywhere.

Common offline rule (spec §8 Offline): when the hub is not connected, **Open, Take over, Hand over, Force move, Force release, Move, Merge, Split and Call waiter are disabled** with the reason "Needs the hub". **Ask for bill and Clean still work: they are queued** on the device and sent when the hub is back. More in 02-B02.

---

### 3.1 02-S01 Sign-in: name grid

**Purpose:** pick who you are on a shared screen. **Entry:** app start; after pairing; after sign-out, idle sign-out, being signed out by someone else, or a forced sign-out. **Exit:** 02-S02 (PIN). On a phone the grid has one tile (the phone's owner), so it goes straight to the PIN. (A sign-in screen already exists from 01d; this brief only adds the 02a requirements. Keep its look.)

**Data:** `GET /queries/staff-roster` (no session needed; polled, not counted as activity) → `{ staff: [{ staff_id, display_name, locked_until: ms | null }], active_session: { staff_id, display_name } | null }`, sorted by `display_name`.

| Element | Field | Example |
|---|---|---|
| Brand block | branch name (page meta), device name | "Arif Chatkhara · Gulberg · Tablet 3" |
| Clock | hub time | "7:28 PM" |
| Hub status | socket state | "Live" / "Hub offline" |
| Name tiles | `display_name` | "Ali", "Bilal", "Sara", "Muhammad Abdul Rehman Qureshi" |
| Locked tile | `locked_until` | greyed, "Locked · 14 min" |
| Who's signed in | `active_session.display_name` | "Bilal is signed in" |
| Queue line (02b) | device queue count | "2 orders waiting to send" (02b owns; leave a slot under the grid) |

**States**

| State | What shows |
|---|---|
| Loading | skeleton name tiles |
| Normal | grid, about 20 names; search box when > 24 names |
| Empty | "No staff with a PIN for this branch yet. Ask the owner." (UR) |
| Locked person | tile greyed with "Locked · 14 min"; tap shows the same text |
| Long names | 2 lines on the tile, then ellipsis |
| Hub offline | last loaded names stay, top line "Hub offline — reconnecting" (UR); tapping a name still goes to PIN, which says it needs the hub |
| Device not paired / token wiped | goes to 02a-S00 |
| Urdu | grid flows RTL; names in their own script |

**Errors**

| Code | When | Show | Way out |
|---|---|---|---|
| `401 DEVICE_TOKEN_INVALID`, `403 DEVICE_REVOKED` | the screen's pairing was removed or replaced | wipe the stored pairing token, go to 02a-S00 | "Ask a manager to pair this screen" |
| `403 DEVICE_TYPE_NOT_ALLOWED` | e.g. a kitchen screen opened the staff page | "This screen can't sign in staff" | — |
| `503 SERVICE_UNAVAILABLE` | hub busy | retry once, then "Hub busy, try again" | Retry |

### 3.2 02-S02 Sign-in: PIN pad

Name + "Not you?" (back to grid) + PIN pad (4–6 digits, dots, LTR, keys 104 × 64) + Enter. Sends `POST /auth/pin { staff_id, pin }`.

| State / code | Show |
|---|---|
| Busy | keys locked, spinner on Enter |
| `PIN_INVALID` | pad shakes (0.4 s); "2 tries left" when ≤ 2 |
| `PIN_LOCKED_OUT`, `DEVICE_LOCKED_OUT`, `IP_LOCKED_OUT` | "Locked · 15 min" (time left from the error) |
| `409 DEVICE_SESSION_ACTIVE { display_name }` | open 02-D01 |
| Hub offline | pad disabled, "Needs the hub" — PINs are never stored or queued |
| Success | load permissions (`/queries/session`), open the live socket, go to the table map (or back to the screen and draft they were on before an idle sign-out) |

### 3.3 02-D01 Someone is signed in here

"Bilal is signed in on this screen. Sign him out?" (key `auth.takeover.confirm`, UR). Buttons: **Cancel** / **Sign Bilal out** (sends the PIN again with `takeover: true`). Bilal's unsent work stays on the screen (02b's queue rules). Not on phones (a phone has one owner).

### 3.4 02a-S00 Pair this screen again

Route only (the 00 pairing screens exist). On `401 DEVICE_TOKEN_INVALID` / `403 DEVICE_REVOKED` anywhere (sign-in or later), the app wipes its token and opens `/pair`: "This screen must be paired again. Ask a manager." (UR). Unsent work in the device queue is kept (02b).

### 3.5 02a-C10 Top bar (every signed-in staff screen)

Maroon bar, 80 px. Start: brand block (mark + "Arif Chatkhara" + "Gulberg · Tablet 3") and, on tablets, the alerts binding line from 01d ("Alerts: Ali — pauses at 9:05 PM" / "Alerts paused" / "Alerts: none"). Middle: the floor switcher of the table map (02-S03). End: **Live / Hub offline** pill, clock, **Requests (n)** (shield icon) and **Inbox (n)** (tray icon), each with a red badge, then the person chip (name, sign out).

| Element | Data | Notes |
|---|---|---|
| Requests (n) | number of requests this person can answer (01d `requests-to-answer`) | Shown only when n > 0. **Never on phones.** Handover requests (02a-C02) land here. |
| Inbox (n) | unseen alerts (01d inbox) | Call-waiter cards (02a-C05), handover results (02a-C04), slip warnings (02b/03b) land here |
| Live pill | socket state | "Live" (green dot) / "Hub offline" (grey, wifi-off) |
| Person chip | signed-in `display_name` | tap → sign out |

Portrait: the floor switcher moves to its own row under the bar. Phone: a phone top bar (title + Live dot) and a bottom tab bar (proposal: **Tables · Inbox · Me**; 01d's phone tab bar today is Inbox · Sign out — the designer extends it, §7 Q8).

### 3.6 02-S03 Table map (home)

**Purpose:** see every table of the branch at a glance; open one; act on one. **Entry:** after sign-in; Back from the table sheet or the order screen; the "Tables" tab on the phone. **Exit:** tap a tile → depending on the tile (below) the order screen (02b), the table sheet (02-S06) or the busy sheet (02-B01).

**Data**

- At socket connect: catch-up part `tables` (same shape as the query below, for this person and device).
- `GET /queries/table-map?floor_id=` (optional filter; polled reads do not count as activity, so the screen may refetch freely) →
  `{ as_of_seq, floors: [{ floor_id, name, archived, zones: [{ zone_id | null, name | null, tables: [Tile] }] }] }`.
- Order: floors by setup order; inside a floor the zones by setup order, then the tables with **no zone** (`zone_id: null`, `name: null`) last; tables by setup order. Empty groups are not sent.
- **Archived tables:** a table the owner archived while a party still sits there comes in one extra group at the end: `{ floor_id: '', name: null, archived: true, zones: [{ zone_id: null, name: null, tables }] }`. Each of its tiles has `name` = the table's id, `seats: null`, `archived: true`. The client supplies the label **"Archived tables"** (UR). A free archived table is never shown.

**Layout (T landscape 1280 × 800):** top bar with the floor switcher (`.seg`: "Ground floor 12 · Family hall 8 · Rooftop 6"; count = tables on that floor) → main area: the floor's tiles grouped by zone (zone name as a small heading; "No zone" group last, no heading needed) → side column (about 340 px) with: **Mine** filter, a state legend with counts, a short "Needs you" list (proposal: my tables that need something — bill requested, to clean, a call), and the 02b buttons **New takeaway / New parking / Open orders (n)** (02b owns them; leave the slot). Portrait: side column becomes a strip above the grid. Kiosk: same as landscape, wider grid (6 tiles a row). Phone: floor switcher as a scrolling chip row, tiles in a 2- or 3-column grid, filter chip "Mine" at the top, the 02b buttons in a bottom bar.

Floor plan vs grid: the 01d sketch drew a floor plan with table "pucks". **There are no table positions in the setup data** (tables have a name, seats, zone and sort order only), so the map is a **grid of tiles grouped by zone**. A floor-plan look can only be decorative; do not depend on positions.

**Actions on the map**

| Action | Who | What it calls | Result |
|---|---|---|---|
| Switch floor | everyone | (client filter; may refetch with `floor_id`) | tiles of that floor |
| **Mine** filter | everyone | client filter | only "my" tiles — see §7 Q2 for what "mine" means |
| Tap a FREE tile | `take-order` (scope covers the floor) | `POST /commands/open-table { table_id }` (optional `party_size`, §7 Q3) | opens a new seating, you hold it and its lock → **order screen (02b)** |
| Tap a FREE tile, no `take-order` | waiter | — | nothing to do on a free table: small toast "Free table" or no reaction (§7 Q4) |
| Tap a seated tile | anyone | — | opens the **table sheet** 02-S06 (from there "Take order" opens the order screen) |
| Tap a tile I hold, not locked by others | holder | `open-table { table_id, seating_id }` from the sheet's "Take order" | lock taken → order screen |
| Tap a tile locked by someone else | anyone | — | 02-B01 busy sheet (no call) |
| Tap a NEEDS_CLEANING tile | anyone | — | table sheet with **Clean** as its main action |

`open-table` results: `{ seating_id, primary_table_id, opened, holder_staff_id }`. `opened: false` = you already had the lock here; just go in. If your own lock was on your other tablet, it moves here and that tablet shows "Opened on another device" (02a-B10).

**Open / Take order errors** (`open-table`, from a free tile or the sheet's Take order):

| Code | When | Show (UR) | Way out |
|---|---|---|---|
| `409 TABLE_ALREADY_LOCKED { locked_by_name }` | someone is ordering there (or tapped first) | 02-B01 "Ali is taking an order here" | See the table / Release (manager) |
| `409 TABLE_SEATING_CHANGED` | the tile was stale: the party left / moved, or a new one sat (also a FREE tile carrying an old `seating_id`) | "This table changed — refreshed" | tile reloads; tap again |
| `409 TABLE_NEEDS_CLEANING` | bill paid meanwhile | "F4 is waiting for cleaning" | Clean |
| `404 TABLE_NOT_FOUND` | the free table was archived / removed from setup | "This table is no longer in use" | map refreshes |
| `403 PERMISSION_DENIED { reason: 'not_holder' }` | the party is held by someone else and you have no `take-order-anywhere` (e.g. it was taken over since) | "Bilal has this table" | See the table |
| `403 … { reason: 'outside_scope' }` | your `take-order` (`my_floors`) or `take-order-anywhere` scope does not cover this floor | "This table is outside your floors" | — |
| offline | — | "Needs the hub" | — |

**Errors common to every command in this brief** (design once, use everywhere):

| Code | When | Show | Way out |
|---|---|---|---|
| `401 SESSION_EXPIRED` / `SESSION_INVALID` | signed out meanwhile (idle, someone signed in over you, a manager signed you out, PIN changed, hub restored) | go to sign-in; any draft is kept | sign in again |
| `403 PERMISSION_DENIED { permission, grant }` (no `reason`) | your permissions changed mid-shift, or the grant is "needs approval" (counts as not allowed for tables) | "You can't do this now. Ask a manager." | permissions refresh; the button hides |
| `426 CLIENT_UPGRADE_REQUIRED` | app too old | blocking "Update the app" screen | update |
| `400 VALIDATION_FAILED` | a reason / note field empty or too long | inline under the field | fix |
| network error / 5xx on a non-queued command | answer lost | "Couldn't confirm — try again" (a retry is safe: same command id) | Try again |

**Live updates (WebSocket frames; each names the table by its primary table)**

| Frame | Changes on the map |
|---|---|
| `TableOpened { table_id, seating_id, holder_staff_id, party_size }` | tile → Seated, holder shown, time open starts |
| `TableLocked { table_id, seating_id, staff_id, replaced_device_id? }` | padlock + name appear (or "you" when `mine`) |
| `TableLockTouched` | nothing visible |
| `TableLockReleased { table_id, seating_id, staff_id, reason, by_staff_id?, note? }` | padlock goes; if it was **my** lock → 02a-B10 |
| `TableHolderChanged { table_id, seating_id, from_staff_id, to_staff_id, reason }` | holder name changes; if from me while I'm on its order → 02a-B10 |
| `TableMoved { seating_id, from_table_id, to_table_id }` | old tile → Free, new tile takes the party |
| `TablesMerged { into_seating_id, into_table_id, table_ids, absorbed_seating_id }` | all tiles of the party show "F4 + F5"; the absorbed party's tile joins |
| `SeatingSplit { from_seating_id, new_seating_id \| null, to_table_id }` | a new party appears on `to_table_id`, or a joined table becomes Free (detach) |
| `BillRequested { seating_id, table_id }` | tile → Bill |
| `TableCleaned { seating_id, table_ids, reason }` | every table of the party → Free |
| Order frames from 02b (`OrderPlaced`, `OrderCancelled`, `OrderFoodServed`, `OrderFoodCleared`, …) | state may move Seated ↔ Ordered ↔ Eating; the client recomputes or refetches the map |
| **Bill paid (05 `BillClosed`)** | ⚠️ **not sent live today** (no frame until module 05 registers one). The tile turns **To clean** only on the next map read or reconnect. So the map should refetch `table-map` every so often (proposal: 30 s while visible, and on any order frame) — §7 Q5. |

Easiest for the client: after any table or order frame, refetch `table-map` (cheap, not counted as activity). Design for the tile changing in place, no full-screen flicker.

**States of the map**

| State | What shows |
|---|---|
| Loading (first catch-up) | top bar + skeleton tiles in a grid |
| Normal | as above |
| No tables configured | empty state "No tables yet. Ask the owner to add floors and tables." (UR) |
| Floor with all tables free | normal, all dashed "Free" tiles |
| Mine filter, nothing mine | "You have no tables right now." + "Show all" (UR) |
| Long names / 40 tables on one floor | grid scrolls inside the main area; top bar and side column stay; tile names truncate at 2 lines |
| Merged party | every joined tile shows the joined label "F4 + F5" (field `joined_table_names` joined with " + ", primary first) |
| Archived group | trailing "Archived tables" group, tiles marked "archived" |
| Stale (socket dropped, data older than the last frame) | tiles stay, dimmed slightly, "Hub offline" pill, 02-B02 bar "Hub offline — showing the last known tables" |
| Offline | as stale; tapping a FREE tile shows "Needs the hub"; tapping a seated tile opens the table sheet with offline rules |
| Permission: waiter | same map; tapping a free tile does nothing to order; table sheet shows only what he can do |
| Permission: `my_floors` scope | other floors still visible (the map lists all, with no "can open" flag, and the session data does not list the person's floors); tiles look normal; tapping a free tile on another floor gives `403 outside_scope` → "This table is outside your floors" (UR). Greying them needs data the client does not have (§7 Q6) |
| Floor with no tables | the floor tab shows "0"; main area "No tables on this floor" (UR) |
| Floor filter | the "Archived tables" group is sent even when one floor is chosen; show it under every floor tab, or only under "All" (designer's choice) |
| Drinks-only party | stays **Ordered** forever (never Eating): only food turns a table Eating; drinks, water, counter items do not (02b rule) |
| Urdu | text RTL; **the tile grid order stays LTR**, table names LTR |
| Device | T landscape grid + side column; T portrait strip above; K wide; P 2–3 columns, bottom bar |

### 3.7 02a-C01 Table tile

One tile per table. A joined table has **its own tile** carrying the same party data as the primary.

| Element | Field (`Tile`) | Type | Example | Notes |
|---|---|---|---|---|
| Table name | `name` | string | "F4" | big, LTR, Bricolage. Archived: the id |
| Joined label | `joined_table_names` | string[] | ["F4","F5"] → "F4 + F5" | only when length > 1; primary first |
| State | `state` | `FREE`/`SEATED`/`ORDERED`/`FOOD_ON_TABLE`/`BILL_REQUESTED`/`NEEDS_CLEANING` | `ORDERED` | icon + word + colour (§2.4) |
| Seats | `seats` | number \| null | 6 | small, e.g. chair icon "6" |
| Party size | `party_size` | number \| null | 9 | only when set at open; "9 guests" (§7 Q3) |
| Holder | `holder { staff_id, name }` | object \| null | Ali | spec says **holder initials**: "AL" avatar; full name in the sheet |
| Assignee | `assignee { staff_id, name }` | object \| null | Sara | shown **only when ≠ holder** ("Sara's zone" or a second small avatar with a different style). On a FREE tile the assignee is the table's assigned person (can show as a quiet hint, §7 Q7) |
| Lock | `lock { staff_id, name, mine }` | object \| null | Ali, mine: false | padlock + "Ali" (or "You" when `mine`) |
| Time open | `opened_at` | ms \| null | 7:42 PM → "32 min" | counts up |
| Bill requested at | `bill_requested_at` | ms \| null | "Bill · 4 min" | optional detail on Bill tiles |
| Live orders | `live_order_count` | int | 3 | optional ("3 orders") |
| Archived | `archived` | boolean | true | "archived" mark |
| Call sent | client-local (from the call-waiter result) | — | "Call sent 1 min ago" | see 02a-D23 |
| Ids (not shown) | `table_id`, `seating_id`, `primary_table_id` | string | — | every action sends `seating_id`; actions on a joined tile act on the party (primary) |

Name fallbacks: `holder.name`, `assignee.name`, `lock.name` can be null (person removed from setup) → show "Someone". An archived tile's `name` is the raw table id (a code like `tbl_01H…`) → show "Archived table" + a short form; the same raw id can appear inside the joined label.
| 02b/03b/04 badges | — | — | "6 min late", "Void waiting" | placeholders, §6 |

**Tile states:** Free (dashed, quiet); Seated; Ordered; Eating; Bill; To clean (striped `--clean-fill`); each × {no lock, locked by me ("You", `.mine` outline in maroon), locked by someone (padlock + "Bilal")} × {holder = me, holder = someone, assignee ≠ holder} × {single, joined "F4 + F5"} × {archived}. Pressed state. Disabled (offline Free tile: dim + "Needs the hub" on tap). Long names. Urdu (word in Urdu, name LTR).

### 3.8 02-B01 Table busy: "Ali is taking an order here"

**When:** you tap a tile whose `lock` is someone else's, or `open-table` answers `409 TABLE_ALREADY_LOCKED { table_id, locked_by_staff_id, locked_by_name }` (two people tapped the same free table at the same moment — the first one wins).

**Content:** table chip "F4", padlock, **"Ali is taking an order here"** (UR; name from `locked_by_name`, or "Someone" when null). (No lock time is sent, so no "since …".) If the lock is **yours on another screen** (same name as you, `mine: false`): "You're ordering on F4 on another screen" + **Open here** (moves the lock here; that screen keeps its draft). Buttons:

| Button | Who | Does |
|---|---|---|
| **See the table** | everyone | opens the table sheet 02-S06 read-only for ordering (you can still ask for the bill, call a waiter, clean — those never need the lock) |
| **Release Ali's lock** | `force-release-table-lock` covering the floor | opens 02-D12 |
| Close | everyone | back to the map |

There is **no "Open anyway"**: even `take-order-anywhere` cannot type on a table someone has locked. Offline: the sheet shows, Release is disabled "Needs the hub".

### 3.9 02-D12 Release Ali's lock (force release)

"Release Ali's lock on F4? Anything he hasn't sent stays on his screen." (UR). Reason: **chips + free text, required, 1–120 chars** (`reason`). Chips are not defined in the spec — proposal: "Went home", "Tablet dead", "Left the table", "Other" (§7 Q9). Buttons **Cancel** / **Release** (danger tone).

Calls `POST /commands/force-release-table-lock { table_id, seating_id, reason }` → `{ released }`. `released: false` = it was already free → toast "Already free". Success → toast "Lock released"; the tile's padlock goes; Ali's tablet shows "Your table was released by Sana: Went home" (02a-B10).

| Error | Show |
|---|---|
| `409 TABLE_SEATING_CHANGED` | "This table changed — refreshed" |
| `403 PERMISSION_DENIED { reason: 'outside_scope' }` | "This table is outside your floors" |
| `400 VALIDATION_FAILED` | reason empty or too long → inline under the field |
| Offline | Release disabled, "Needs the hub" |

### 3.10 02-S06 Table sheet (the table part of the table view)

**Purpose:** everything you can do to a seated table, plus a read of who has it. **Entry:** tap a seated / to-clean tile; "See the table" from 02-B01; after an order is sent (02b returns here). **Exit:** Take order → order screen (02b); each action → its dialog; Close / Back → map. On T landscape and K: a right-side panel or centred sheet over the map (designer's choice); on T portrait and P: a bottom sheet or full screen.

The orders of the table (rounds, lines, served, returns, comps) sit **in the same view below the header**; that part is 02b's (placeholder, §6). This section is the **header and the table actions**.

**Header data** (from the tile, plus `GET /queries/handover-candidates` only when the hand-over sheet opens):

| Element | Field | Example |
|---|---|---|
| Table chip | `name` / joined label | "F4 + F5" |
| State | `state` | "Ordered" (icon + word) |
| Holder | `holder.name` | "Ali has this table" |
| Assignee (if ≠ holder) | `assignee.name` | "Sara's zone" |
| Lock | `lock` | "(padlock) Ali is ordering" / "You are ordering" / none |
| Time open | `opened_at` | "Open 32 min · since 7:42 PM" |
| Party | `party_size`, `seats` | "9 guests · 12 seats" |
| Orders | `live_order_count` | "3 orders" (detail is 02b's) |
| Call sent | client-local | "Call sent 1 min ago" |
| Handover pending | client-kept (see 02a-C03 data note) | "Waiting for Sara to accept" |
| Archived | `archived` | "This table is archived" |

**Actions** (each button shows only if the person's permissions allow it, R5; if shown but not possible now, it is disabled with the reason):

| Action | Shown to | Not possible when | Calls | Success |
|---|---|---|---|---|
| **Take order** (main, saffron) | holder with `take-order`; non-holder with `take-order-anywhere` (scope covers the floor) | locked by someone else (→ shows 02-B01 text); NEEDS_CLEANING; offline ("Needs the hub") | `open-table { table_id, seating_id }` | lock → order screen (02b) |
| **Take over** | the table's **assignee** (`assignee.staff_id` = me) when holder ≠ me; needs `take-order` scope `branch` or `my_floors` (`own_tables` can never take over) | NEEDS_CLEANING; offline | 02a-D22 → `take-over-table { table_id, seating_id }` | `{ changed }`; I become holder; the old holder's lock (if any) is released |
| **Hand over** | the holder; or anyone with `force-release-table-lock` (both also need `take-order`) | a handover is already waiting (show "Waiting for Sara" + Withdraw instead); NEEDS_CLEANING; offline | 02a-D20 → `request-table-handover` | `{ alert_id }` → 02a-C03 waiting card |
| **Force move** | `force-release-table-lock` | NEEDS_CLEANING; offline | 02a-D21 → `force-move-table` | `{ changed }`; holder changes now, no acceptance |
| **Move** | holder (or force holder) | party has more than one table ("Split first", `TABLE_MERGED`); NEEDS_CLEANING; offline | 02-D09 → `move-table` | `{ primary_table_id }` |
| **Join table** (merge) | holder (or force holder) | NEEDS_CLEANING; offline | 02-D10 → `merge-tables` | `{ seating_id, table_ids }` |
| **Split** | holder (or force holder) | NEEDS_CLEANING; offline; party has fewer than 2 live orders and no joined table (nothing to split) | 02-D11 → `split-seating` | `{ new_seating_id }` |
| **Ask for bill** | `take-order` | SEATED with no order ("No orders yet"); NEEDS_CLEANING; already asked (shows "Bill asked · 4 min" instead) | 02a-D24 → `request-bill { table_id, seating_id }` | `{ requested }`; tile → Bill. **Works offline (queued)** |
| **Call waiter** | `take-order` | NEEDS_CLEANING; offline ("Needs the hub") | 02a-D23 → `call-waiter` | toast + "Call sent" marker |
| **Clean** | `clean-table` | the table still has live orders and the bill is not paid (`TABLE_HAS_OPEN_ORDERS`) — show only on SEATED-with-no-order and NEEDS_CLEANING, see below | 02-D13 → `clean-table { table_id, seating_id }` | tiles → Free. **Works offline (queued)** |
| **Release my lock** | the lock is mine (on this device) | — | `release-table-lock { table_id, seating_id }` | `{ released }`; padlock goes. (Usually automatic when leaving the order screen.) |
| **Release Ali's lock** | `force-release-table-lock`, lock is someone else's | offline | 02-D12 | |

**Clean shows on:** NEEDS_CLEANING (main action, "Mark clean") and SEATED with no live order ("Left without ordering"). On other states it is hidden (or disabled "Bill not paid yet").

**Phone subset (spec: "P: subset"):** Take order, Take over, Hand over, Ask for bill, Call waiter, Clean, Release. Move / Join / Split / Force move on phone: proposal — under a "More" menu, or tablet only (§7 Q10).

**Permission variants of the sheet**

| Who | Sees |
|---|---|
| Holder (order taker) | Take order, Hand over, Move, Join, Split, Ask for bill, Call waiter, Clean (when allowed), Release my lock |
| Assignee, not holder | Take over (main), Ask for bill, Call waiter, Clean; Take order only if he has `take-order-anywhere` |
| Other order taker, not holder, not assignee (`take-order` scope `branch` / `my_floors` covering the floor) | Ask for bill, Call waiter, Clean; Hand over hidden (only the holder or a manager can) |
| Order taker with scope `own_tables`, not holder | only Clean (Ask for bill and Call waiter answer `403 outside_scope` on parties you don't hold — hide them) |
| Custom role with `force-release-table-lock` but **no `take-order`** | only Release lock and Force move (Hand over, Move, Join, Split all need `take-order` too — hide them) |
| Waiter (no `take-order`) | Clean only (plus the 02b serve actions below) |
| Manager | everything, incl. Force move, Release lock, Hand over a table he doesn't hold |
| Cashier | as order taker but usually not the holder |

**States**

| State | Shows |
|---|---|
| Normal seated | as above |
| Locked by me | "You are ordering" + Take order says "Back to the order" |
| Locked by someone | lock line; Take order disabled with "Ali is ordering" |
| NEEDS_CLEANING | "Bill paid · waiting for cleaning" (UR); only Clean (main) |
| BILL_REQUESTED | "Bill asked · 4 min"; Ask for bill replaced by that line |
| Handover pending (sender) | waiting line + Withdraw (02a-C03) |
| Archived | "Archived table" note; actions still work for the existing party |
| Offline | top `.msg`: "Hub offline. Ask for bill and Clean will be sent when it's back." (UR); other buttons disabled "Needs the hub" |
| Live change while open | if a frame changes this party (moved, merged, cleaned by someone), the sheet updates in place; if the party is gone, it closes with toast "This table changed" |
| Long holder name / 40-char | wraps in the header |
| Urdu | RTL, chips LTR |

### 3.11 02a-D22 Take over this table

"Take over F4 from Bilal? Bilal's unsent order stays on his screen." (UR). **Cancel** / **Take over**. Calls `POST /commands/take-over-table { table_id, seating_id }` → `{ changed }` (`false` = you already hold it; just close).

| Error | When | Show |
|---|---|---|
| `403 PERMISSION_DENIED { reason: 'not_assigned' }` | you are not this table's assignee (setup changed) | "Only Sara can take over this table" (name from `assigned_staff_id` via the map tile's assignee) |
| `403 … 'outside_scope'` | your scope is `own_tables` or the floor is not yours | "Your access can't take over tables. Ask a manager." |
| `409 TABLE_NEEDS_CLEANING` | bill paid meanwhile | "Bill paid, waiting for cleaning" |
| `409 TABLE_SEATING_CHANGED` | party changed | "This table changed — refreshed" |
| offline | — | disabled "Needs the hub" |

A pending handover of this table is closed automatically (its sender gets "closed" result).

### 3.12 02a-D20 Hand over to…

**Data:** `GET /queries/handover-candidates?table_id=` → `{ staff: [{ staff_id, name, is_assignee, working, tables_held }] }`: people with `take-order` covering this floor; **holder and caller left out**; **working first**, then by name. `working` = signed in somewhere now. `tables_held` = parties they hold now (a merged F4 + F5 counts 1).

**Layout:** sheet "Hand F4 + F5 to…" (UR) → list of people: avatar, name, "Assigned here" tag when `is_assignee`, "Working" (green dot) or "Not signed in" (greyed, not selectable), "Has 3 tables" → optional note field (≤ 120 chars; ⚠️ **the note is accepted but not shown to the receiver today**, so either hide the field or label it honestly — §7 Q11) → **Cancel** / **Send request** (primary, enabled when one working person is picked). Preset: when opened from 02a-D25 the person is preselected.

Calls `POST /commands/request-table-handover { table_id, seating_id, to_staff_id, note? }` → `{ alert_id }` → sheet closes, toast "Sent to Sara", the waiting card 02a-C03 appears.

| State | Shows |
|---|---|
| Loading | skeleton rows |
| Empty | "No one else can take tables on this floor right now." (UR) |
| All not working | list greyed, "Nobody else is signed in" |
| 40 people / long names | list scrolls, buttons stay |
| Offline | sheet can't open: "Needs the hub" |

| Error | When | Show | Way out |
|---|---|---|---|
| `409 TABLE_HANDOVER_PENDING { alert_id, to_staff_id }` | one is already waiting | "Already waiting for Sara" | show the waiting card (Withdraw there) |
| `409 HANDOVER_TARGET_UNAVAILABLE { reason: 'not_working' }` | the person signed out since the list loaded | "Sara isn't signed in now" | list refreshes, pick another |
| `409 … { reason: 'inactive' }` | person deactivated | "Sara can't take tables now" | refresh |
| `422 HANDOVER_TARGET_INVALID { reason: 'is_holder' \| 'is_requester' \| 'no_permission' \| 'outside_scope' }` | list was stale or setup changed | "Sara can't take this table" | refresh |
| `403 PERMISSION_DENIED { reason: 'not_holder' }` | you are no longer the holder (taken over meanwhile) | "Ali has this table now" | close sheet, refresh |
| `409 TABLE_NEEDS_CLEANING` / `TABLE_SEATING_CHANGED` | — | as usual | |
| `404 TABLE_NOT_FOUND` (from the candidates list query) | table gone from setup and not seated | "This table no longer exists" | back to map |
| `400 VALIDATION_FAILED` | note over 120 chars | inline | |

### 3.13 02a-D21 Force move to… (manager)

Same list as 02a-D20 (same query; for a manager moving a table **to himself**, he must also be selectable — the query excludes the caller, so add a "Me" row at the top, §7 Q12). Plus **reason, required, 1–120** (chips proposal: "Shift ended", "Went home", "Rebalance", "Other"). Copy: "Give F4 to Sara now? Sara is not asked. This is logged." (UR). **Cancel** / **Give table** (danger tone).

Calls `POST /commands/force-move-table { table_id, seating_id, to_staff_id, reason }` → `{ changed }` (`false`: that person already holds it). Errors: `422 HANDOVER_TARGET_INVALID { reason: 'is_holder' | 'no_permission' | 'outside_scope' }`, `409 HANDOVER_TARGET_UNAVAILABLE { reason: 'inactive' | 'not_working' }`, `409 TABLE_NEEDS_CLEANING`, `409 TABLE_SEATING_CHANGED`, `403 outside_scope`, `400` reason (copy as 02a-D20). A pending handover is closed `obsolete`. Old holder's lock released. The new holder and the old holder see 02a-B10 notices (proposal, from the holder-change frame).

### 3.14 02-D09 Move party to another table

**Purpose:** the party moves to a free table ("AC not working"). Holder, orders and lock go with it. **Only a single-table party moves**; a joined party must split first.

**Layout:** sheet "Move F4 to…" → grid of **free** tables (from the map data; same floor first, other floors under their names; archived never) → optional reason (chips + text, 1–120; proposal chips: "AC", "Bigger table", "Guest asked", "Other") → **Cancel** / **Move** (primary).

Calls `POST /commands/move-table { from_table_id, seating_id, to_table_id, reason? }` → `{ primary_table_id }`. Map updates on every screen. A pending handover of this party is closed (sender notified).

| Error | When | Show | Way out |
|---|---|---|---|
| `409 TABLE_MERGED { table_ids }` | party has joined tables | "F4 + F5 is joined. Split it first." | button "Split" → 02-D11 |
| `409 TABLE_NOT_FREE` | target got a party meanwhile | "F9 just got a party" | grid refreshes |
| `404 TABLE_NOT_FOUND` | target archived meanwhile | "F9 is no longer in use" | refresh |
| `403 { reason: 'other_owner', assigned_staff_id }` | target is assigned to someone other than you and you lack force | open **02a-D25** "Hand it over to Sara; she moves it" | Hand over preset to Sara |
| `403 { reason: 'not_holder' }` | you are not the holder | "Only Ali can move this table" | — |
| `409 TABLE_ALREADY_LOCKED { locked_by_name }` | someone is ordering on F4 — or **you are, on another screen** (any lock not on this screen blocks a move) | "Bilal is ordering on F4. Try when he's done." / "You're ordering on F4 on another screen. Close it there first." | — |
| `403 { reason: 'outside_scope' }` | target floor not yours | "That floor is outside your floors" | — |
| `400 VALIDATION_FAILED` | reason over 120 chars | inline | |
| `409 TABLE_NEEDS_CLEANING`, `TABLE_SEATING_CHANGED` | — | as usual | |
| offline | — | "Needs the hub" | |

Moving to a table **nobody is assigned to, or assigned to you**, on any floor, is free (decided OQ4). Suggest marking target tiles assigned to someone else with their name ("Sara's") so the person knows a hand-over will be needed.

### 3.15 02-D10 Join / merge tables

**Two cases, one sheet:** "Join F5 to F4" — pick a **free** table (it joins F4's party), or pick **another party's** table (that party is absorbed: its orders move into F4's party and its tables join; that party closes).

**Layout:** sheet "Join to F4" → two groups: "Free tables" and "Other parties" (each other party shows holder and state) → confirmation line: free → "F5 joins F4. They become F4 + F5." absorbed → "F7's party (2 orders) joins F4's party. One bill." → **Cancel** / **Join**.

Calls `POST /commands/merge-tables { into_table_id, into_seating_id, table_id, table_seating_id }` (`table_seating_id` = `null` for a free table; the picked party's `seating_id` otherwise) → `{ seating_id, table_ids }`. Pending handovers of both parties are closed.

| Error | When | Show |
|---|---|---|
| `403 { reason: 'other_owner' }` | any table of either side is assigned to someone other than you, or the other party is held by someone else, and you lack force | 02a-D25 (hand over first / ask a manager) |
| `409 TABLE_ALREADY_LOCKED { locked_by_name }` | someone is ordering on either side | "Bilal is ordering on F7. Try when he's done." |
| `409 MERGE_BLOCKED_BY_VOID { order_item_ids }` | a void is waiting for approval on one of the orders (04) | "A void is waiting on F7. Finish it first." |
| `409 TABLE_NEEDS_CLEANING` | either side's bill was paid | "F7's bill is paid. Clean it first." |
| `404 TABLE_NOT_FOUND` | free table archived | "F5 is no longer in use" |
| `409 TABLE_SEATING_CHANGED` | either side changed | refresh |
| `403 'outside_scope'` | a table outside your floors | "That table is outside your floors" |

After a join, if the bill had been asked on F4 and F7 brings a live order, the bill request is cleared (tile back to Ordered, the cashier reprints later). An all-cancelled party joining keeps the bill request.

### 3.16 02-D11 Split the party

**Two cases:** (a) **move whole orders** of the party to a free table (or to one of its own joined tables) → a new party there, same holder; (b) **detach** any joined table (not the primary) with no orders moving → it becomes free. (Orders belong to the party, not to a table, so "its own orders" does not exist.)

Orders move **whole** (no splitting a single order's lines; per-line split is the bill's job, module 05). The sheet lists the party's orders by round ("Round 1 · 7:45 PM · Ali · 6 items · Rs 3,400"; data from 02b's `seating-orders`), each with a checkbox.

**Layout:** sheet "Split F4 + F5" → step 1 pick target: free tables + this party's joined tables (not the primary) → step 2 tick the orders that go there (at least one, not all) — or, for a joined target, "No orders — just free F5" → summary "2 orders go to F9. 1 stays on F4." → **Cancel** / **Split**.

Calls `POST /commands/split-seating { from_table_id, seating_id, to_table_id, order_ids }` (≤ 50 ids; empty = detach) → `{ new_seating_id }` (`null` = detached). The lock stays on the original party. A pending handover is closed.

| Error | When | Show |
|---|---|---|
| `409 SPLIT_INVALID { reason: 'empty' }` | no order ticked and the target is a free table | "Tick at least one order" (inline; better prevent) |
| `… 'all_orders'` | every order ticked | "Leave at least one order on F4 — or use Move" |
| `… 'not_in_seating'` | an order left the party meanwhile | "The orders changed — refreshed" |
| `409 TABLE_NOT_FREE` | target got a party / is the primary | "F9 just got a party" |
| `403 'other_owner'` | new party on a table assigned to someone else | 02a-D25 |
| `409 TABLE_ALREADY_LOCKED` | someone is ordering on this party | "Bilal is ordering on F4" |
| `409 MERGE_BLOCKED_BY_VOID` | a void waits on a moved order | "A void is waiting on that order. Finish it first." |
| `404`, `409 TABLE_NEEDS_CLEANING`, `TABLE_SEATING_CHANGED`, `403 outside_scope` | as above | |

States: loading orders (skeleton), a party with 1 order and no joined table (Split hidden/disabled "Nothing to split"), 20 rounds (list scrolls), cancelled orders (not listed — only live orders move).

### 3.17 02a-D23 Call a waiter

**Purpose:** a guest needs something; the order taker can't go. Rings the table's waiters.

**Who gets it:** the waiter team of the table = the **assignee's** direct reports who are working now; if none, the **holder's** working direct reports; plus the **holder** — **minus the person who called** (their own screens stay quiet).

**Layout:** small sheet "Call a waiter to F4" → four big chips (one tap sends): **Water**, **Clear the table**, **Come to the table**, **Other** (values `water`, `clear`, `come`, `other`; UR for each). Also a plain "Call" with no chip is allowed (chip optional) — proposal: "Come to the table" is the default.

Calls `POST /commands/call-waiter { table_id, seating_id, chip? }` →
- `{ alert_id, repeated: false, recipients: n }`, n ≥ 1 → toast "Waiter called" and on the tile/sheet **"Call sent · just now"** → "Call sent 1 min ago" (the caller sees the call only here; there is no "my sent calls" list).
- `{ recipients: 0 }` → **"Nobody else is working — you can call again in 5 min"** (UR) — warning toast. ⚠️ The call still exists for 5 minutes even though nobody got it, so a second tap in those 5 minutes returns "repeated" and rings nobody, even if a waiter signed in meanwhile (§7 Q18). Suggest "Go yourself or ask a manager".
- `{ alert_id, repeated: true }` → "Already called" (one open call per party; it **closes by itself after 5 minutes**, or when the table is cleaned). The result carries no time: "· 2 min ago" can only be shown on the screen that sent the first call.

"Call sent" marker: kept by the client from the command result (time of send, `alert_id`) on the sending screen only; cleared after 5 min or on `TableCleaned` (the caller gets no close frame for this kind). **Not queued offline:** button disabled "Needs the hub" (a call two hours late is noise).

Errors: `409 TABLE_NEEDS_CLEANING` ("Table is waiting for cleaning"), `TABLE_SEATING_CHANGED`, `403 outside_scope`.

### 3.18 02a-D24 Ask for the bill

One action. Design choice: one tap with a short confirm in place ("Ask for the bill for F4?" → **Ask**), because a mistaken bill request is visible to the cashier. Calls `POST /commands/request-bill { table_id, seating_id }` → `{ requested }`. `true` → tile turns **Bill**, toast "Bill asked". `false` → "Bill already asked".

Whether the cashier gets an alert is module 05's (not here).

| Error | Show |
|---|---|
| `409 TABLE_NO_ORDERS` | "No orders on F4 yet" (better: hide/disable the button on SEATED) |
| `409 TABLE_NEEDS_CLEANING` | "Bill already paid" |
| `409 TABLE_SEATING_CHANGED` | "This table changed — refreshed" |
| `403 outside_scope` | "This table is outside your floors" |
| **Offline** | allowed: toast "Will ask for the bill when the hub is back" (UR); tile shows a small "waiting to send" mark (sync icon). If on replay the party changed → dropped, listed in the queue log (02-D14, 02b) |

A new round after the bill (guest orders one more naan) clears the bill request: the tile goes back to Ordered by itself (02b frame).

### 3.19 02-D13 Mark clean

"Mark F4 + F5 clean? The tables become free." (UR) → **Cancel** / **Mark clean** (primary). For a SEATED table with no order: "Guests left without ordering? F4 becomes free." **If someone holds the lock** (typing the first order) the hub still allows Clean (it never checks the lock), so warn: "Ali is taking an order here. Clean anyway? His order stays on his screen as a draft." → **Clean anyway** (danger) / Cancel. Calls `POST /commands/clean-table { table_id, seating_id }` → `{ reason: 'cleaned' | 'left_without_order' }`. Tiles → Free; any pending handover and open call of the party are closed.

| Error | When | Show |
|---|---|---|
| `409 TABLE_HAS_OPEN_ORDERS { order_count }` | the party still has orders and the bill isn't paid | "F4 still has 3 orders. The bill must be paid first." |
| `409 TABLE_SEATING_CHANGED` | someone cleaned it already / a new party sat | "Already cleaned" (refresh) |
| **Offline** | allowed: queued, toast "Will mark clean when the hub is back"; tile shows "waiting to send". On replay, if the table was cleaned meanwhile or a new party sat → **dropped**, shown in the queue log as "Clean F4 — not sent: the table had changed" (the new party is never touched) |

`clean-table` has no floor scope: anyone with it can clean any table.

### 3.20 02a-D25 "Hand it over to Sara; she moves it"

**When:** Move, Join or Split answers `403 PERMISSION_DENIED { reason: 'other_owner', table_id, assigned_staff_id, holder_staff_id }`: the move would land the party on a table assigned to someone else (or absorb someone else's party), and you don't have the manager permission.

**Content:** "F9 is Sara's table. Hand F4 over to Sara; she can move it." (UR; name from the target tile's assignee). Buttons: **Hand over to Sara** (opens 02a-D20 with Sara preselected) / **Cancel**.

Name rule: if `assigned_staff_id` is set **and is not me** → the "Hand over to {assignee}" form above. If it is null **or me** (a merge refused because the other party is held by someone else, `holder_staff_id`) → "F7 is Bilal's party. Ask Bilal to hand it over to you, or ask a manager." with **no** Hand over button (handing your party to yourself is meaningless). Phone (T, K in the plan; on P show the same text as a sheet).

### 3.21 02a-C02 Handover request card (receiver)

**Where:** the receiver's **Requests** list (top bar badge), an **action banner** when it arrives, and the answer sheet when tapped. Built on the 01d card (`.ac`) and answer sheet.

**Data (alert row):** `kind: 'table_handover'`, `family: 'action'`, `display { table_code: "F4 + F5", requester_name: "Ali", kind_label_key }`, `details { quantity: 3 (live orders), amount: 1425000 (running total, paisa) }` — `details` is `{}` (no quantity, no amount) when the party has no order yet; `answers: ['accept','decline']`, `needs_pin: 'never'`, `raised_at`, `step`.

| Element | Example |
|---|---|
| Family pill | Action (hand icon) |
| Title | table chip **F4 + F5** + "Table handover" (key `alert.table_handover.card`, UR — missing today, add) |
| From | "from **Ali** · 9:30 PM" |
| Details | "3 orders · Rs 14,250" (or "No orders yet") |
| Waiting ring | minutes since raised |
| Buttons | **Decline** (tone) / **Accept** (primary) — one tap, no PIN |

Table chip rule (01d P-1): when `table_code` is all digits show "T12"; otherwise show it as-is ("F4 + F5", "Patio 3"), never "TPatio 3".

**Steps (automatic):** at 0 s the receiver is asked; at 60 s the receiver is reminded (tag "Reminder"); at 120 s the **sender's lead** gets a read-only copy (tag "For your information", no buttons). Requests never expire, not even at day close.

**Answer flow:** Accept → `AnswerRequest { alert_id, decision: 'accept', method: 'session' }` → card shows "Accepted" briefly and leaves; the receiver is now the holder; the map tile shows the new holder. Decline → card leaves; the sender is told.

| Error / state | Show |
|---|---|
| `409 TABLE_HANDOVER_STALE` | the bill was paid before the answer → **"Bill paid, waiting for cleaning"** (UR); the card stays open (the request is not answered); it closes when the table is cleaned |
| `409 REQUEST_NOT_PENDING` | already closed (withdrawn, table moved, taken over) → toast "This request is already closed"; card leaves |
| Closed while looking at it (`alert_closed` frame, reason `obsolete` / `withdrawn`) | card greys, "Closed", leaves after 2.5 s |
| Offline | buttons disabled, "No connection to the hub" inside the sheet |
| Read-only (lead's copy) | no buttons, "For your information" |
| Phone | there is **no Requests screen on phones** (01d): the card shows in the phone Inbox and the banner. 01d has **no phone answer-sheet frame yet** (its answer sheet was drawn for T and K): **design a new phone answer sheet** (bottom sheet, 72 px Decline / Accept) |
| Accept in person | 01d allows an "answer here" on the **sender's** device: the receiver walks over, picks her name and types her PIN. Whether the sender's waiting card offers "Sara accepts here (PIN)" is open (§7 Q19) |
| Lock screen / kiosk device view (signed out) | lock text only: "F4 + F5 · Table handover · Ali" (key `alert.table_handover.lock`, UR) — no amount, no orders |

Handover **note:** not carried to this card today (§7 Q11).

### 3.22 02a-C03 Handover waiting card (sender)

**Where:** on the sender's table sheet header (02-S06) and as a row in a "Sent requests" strip on the map side column (phone: top of the Inbox tab). 01d leaves building this card to 02 / 04; there is no existing "my requests" screen.

**Data (gap):** 01d `GET /queries/my-requests` gives per request: `alert_id`, decision, `answerer_name` (only **after** an answer), `raised_at`, `waiting_ms`, `close_reason`, `lock` text, `ask_in_person`. It has **no receiver name and no table id**. So: the screen keeps the `alert_id` and the picked person's name from the Send; after a reload or on another screen, match the row by its lock text's table and show "Waiting for an answer" (no name) — §7 Q20.

**Content:** "Waiting for **Sara** — 0:42" (live count-up, UR) + waiting ring (fills over 4 min) + **Withdraw** (`WithdrawRequest { alert_id }`; only the sender). After 2 min (`ask_in_person`): "Waiting 2 min — ask Sara in person".

States: waiting; reminder sent (60 s); lead informed (120 s, "Your lead was told"); withdrawn (toast "Request withdrawn"); closed by a party change (moved, merged, split, cleaned, taken over, force moved → "Request closed: the table changed"); accepted / declined → 02a-C04. Withdraw offline: disabled "Needs the hub". Withdraw `409` (already answered) → shows the result instead.

### 3.23 02a-C04 Handover result notice (sender)

01d sends the sender a result notice (`request_result`, info family, closes when seen). Outcomes and copy (proposal; the generic 01d keys are "Request approved · T12" — for this kind say accepted/declined, §7 Q13):

| Outcome | Copy | Sound |
|---|---|---|
| accepted | "Sara accepted F4 + F5" | rising chime |
| declined | "Sara declined F4 + F5" — banner offers "Hand over to someone else" | falling tone |
| withdrawn | (sender did it) **no notice at all** — just the toast "Request withdrawn" |
| closed / obsolete | "Handover of F4 closed: the table changed" | |

The obsolete notice carries a machine note in `details.reason` ("moved to tbl_…", "merged: … into …", "take_over", "force_move"). **Never show it**; always use the plain sentence above.

### 3.24 02a-C05 Call-waiter card (waiters)

**Where:** each recipient's banner (action family, double ding) and Inbox row. Not a request: no answer buttons.

**Data:** `kind: 'call_waiter'`, `family: 'action'`, `display { table_code: "F4" }` (primary table name), no `details`. The chip value is in the alert values; whether the card can show "Water" depends on the client getting the chip (§7 Q14).

**Content:** table chip **F4** + "Call" (key `alert.call_waiter.card`, UR — missing today, add) + time "9:02 PM". ⚠️ The alert as built carries **no caller name** (its display has only the table), so "from Ali" cannot be shown, and the chip ("Water") may not be either (§7 Q14). Tapping opens the alert; there is nothing to answer. Closes by itself after 5 min, or when the table is cleaned (card greys "Closed"). Lock / kiosk view: "F4 · Call waiter" (`alert.call_waiter.lock`, UR). If the waiter has no screen of his own, 01d routes it to his lead "for Rashid" (lead fallback) — shown with the 01d "For {name}" tag.

### 3.25 02a-B10 Lock banners (on the order screen and the map)

These are **client banners from table frames**, shown to the person whose table changed. On the order screen: sticky until tapped. On the map: a 6 s banner (the "on the map" rows). **The draft is never lost.** Spec base copy: "Your table was released (reason)".

| Trigger (frame) | Where | Copy (UR) | Actions |
|---|---|---|---|
| `TableLockReleased { staff_id = me, reason: 'force' }` | order screen / map | "Your table F4 was released by Sana: Went home" (`by_staff_id` name + `note`; on a phone the name may be unknown → "by a manager") | OK. On the order screen: **Keep as draft** — sending later tries to take the lock again |
| `… 'lock_ttl'` | order screen / map | "Your table F4 was released after {n} min without activity. Your order is kept." — n = the **branch lock setting** (`table_lock_ttl_ms`, one value for the branch, 1–60 min), not the role's idle time | Keep as draft / Send |
| `… 'session_expired'` | after the next sign-in | "Your table F4 was released when you signed out. Your order is kept." (the person's session ended: idle, signed out, signed in again on this screen) | — |
| `… 'holder_changed'` (my lock, I'm **not** the old holder — e.g. a manager ordering with take-order-anywhere when the holder changed) | order screen | "F4 now belongs to Sara. Your order is kept as a draft." | Keep as draft; Send only with take-order-anywhere |
| `… 'released'` | — | my own release — no banner | |
| `TableLocked { replaced_device_id = this device }` | order screen | **"Opened on another device"** — "You opened F4 on your other screen. This order stays here as a draft." | OK |
| `TableHolderChanged { from_staff_id = me }` **while my order screen of that table is open** | order screen | **"Ali now has this table. Keep as draft"** (from `to_staff_id` name; reason take_over / handover / force_move) | **Keep as draft** (then the app releases its lock). **Send** shown only when I have `take-order-anywhere` (that send never takes the lock, and fails if someone else is ordering there) |
| `TableHolderChanged { from_staff_id = me }`, map open (proposal) | map | "F4 now belongs to Ali" (force move: "… by a manager: Shift ended") | OK |
| `TableHolderChanged { to_staff_id = me, reason: 'force_move' }` (proposal) | map / any | "A manager gave you F4: Shift ended" (the receiver is not asked, so tell her) | Open table |
| `TableCleaned` of a table **I am ordering on** (someone cleaned it, maybe a queued clean) | order screen | "F4 was cleared. Your order is kept." | Keep as draft (then 02b: discard or copy to a new order) |
| `TouchTableLock` answers `409 TABLE_LOCK_NOT_HELD` | order screen | as lock released ("Your table F4 was released") | Keep as draft |
| `TouchTableLock` / `ReleaseTableLock` answer `409 TABLE_SEATING_CHANGED` | order screen | "This table changed" (the party moved / was merged / cleaned) | Keep as draft |

The order screen sends a keep-alive (`touch-table-lock`) once a minute while open; it has no UI unless it fails. The app releases the lock when you leave the order screen (`release-table-lock`); both are **dropped offline**, never queued.

### 3.26 02-B02 Hub offline bar and "Needs the hub"

**Hub offline bar** (sticky `.warnbar` under the top bar, warning tone, wifi-off icon). **One bar for both modules, one copy:** "Reconnecting… {n} waiting to send" when the device queue has items, else "Reconnecting… showing the last known tables" (UR). The Live pill reads "Hub offline". The queue and its log (02-D14) are owned by 02b. On reconnect: bar goes, tiles refresh from catch-up, toast "Back online".

**Draft while offline:** a holder may still open the order screen for a table he already holds and has open (02b decides; a queued Send goes through without the lock). Opening a **free** table always needs the hub.

**"Needs the hub" disabled state:** buttons stay visible, dimmed, with a small wifi-off icon; tapping shows a short toast "Needs the hub" (UR). Applies to: Open (free tile), Take order, Take over, Hand over, Force move, Force release, Move, Join, Split, Call waiter, Withdraw.

**Queued (offline) actions:** Ask for bill, Clean. Toast "Will be sent when the hub is back"; the tile and sheet show a small "waiting to send" sync mark.

**Queue log rows for 02a** (the log is 02b's screen 02-D14; rows look like): "Clean F4 — not sent: the table had changed · 9:41 PM" with **Discard**; "Ask for bill F4 — not sent: the table had changed". Cause: replay answered `409 TABLE_SEATING_CHANGED`. A replay that answers `TABLE_HAS_OPEN_ORDERS`, `TABLE_NO_ORDERS` or `TABLE_NEEDS_CLEANING` also lands there with the plain reason (Discard). A replay refused because **the session had ended** (`401`) shows **Send again as {person now signed in}** (named on the button) and **Discard**. "Copy to a new order" never applies to Bill / Clean.

### 3.27 02a-T01 Toasts

Maroon toast, bottom end, ~3 s. All UR.

| Key idea | Text |
|---|---|
| seating changed | "This table changed — refreshed" |
| lock released | "Lock released" |
| already free | "Already free" |
| sent handover | "Sent to Sara" |
| waiter called | "Waiter called" |
| nobody working | "Nobody else is working" (warning tone, stays 6 s) |
| already called | "Already called · 2 min ago" |
| bill asked | "Bill asked" / "Bill already asked" |
| cleaned | "F4 is free" |
| queued | "Will be sent when the hub is back" |
| needs hub | "Needs the hub" |
| back online | "Back online" |
| moved | "Moved to F9" |
| joined | "F4 + F5" |
| split | "2 orders moved to F9" |

---

## 4. Cross-screen flows

**F1 Open a free table (happy).** Map → tap free F4 → `open-table { table_id }` → `TableOpened` + `TableLocked` → tile "Seated · You" + padlock → order screen (02b). Other screens: F4 shows "Seated · Ali" + padlock "Ali".

**F2 Two people tap the same free table.** Ali and Bilal tap F4 together → Ali wins → Bilal gets `409 TABLE_ALREADY_LOCKED { locked_by_name: 'Ali' }` → 02-B01 "Ali is taking an order here" → See the table / Close.

**F3 Open a table someone else holds (not locked).** Bilal holds F7 but isn't ordering. Sara (order taker, no extra permission) taps F7 → table sheet: no Take order (only Ask for bill, Call waiter, Clean). Manager taps F7 → Take order (he has `take-order-anywhere`) → `open-table { table_id, seating_id }` → manager takes the lock; **Bilal stays the holder**. If Bilal is ordering (locked) → 02-B01 for everyone; manager can Release Bilal's lock (02-D12) first.

**F4 Take over (assignee).** F7 is in Ali's zone, held by Bilal. Ali opens F7 → **Take over** → confirm → `take-over-table` → Ali is holder. If Bilal was typing an order on F7: Bilal's lock is released (`holder_changed`) and Bilal's order screen shows "Ali now has this table. Keep as draft" (Send only if Bilal has take-order-anywhere). Ali can open F7 at once.

**F5 Hand over / accept.** Ali (holder) → sheet → Hand over → list (working first) → Sara → Send → Ali sees "Waiting for Sara — 0:12" + Withdraw. Sara's tablet: banner + Requests (1) → card "F4 + F5 · Table handover · from Ali — 3 orders · Rs 14,250" → Accept → Sara is holder (map updates everywhere) → Ali gets "Sara accepted F4 + F5". If Ali was ordering on F4 at that moment, his lock is released and his screen shows the holder-change banner.

**F6 Hand over / decline.** … Sara taps Decline → Ali's waiting card turns to "Sara declined" → banner offers "Hand over to someone else" → 02a-D20.

**F7 Hand over / no answer.** 60 s: Sara reminded. 120 s: Ali's lead (read-only) told. Ali sees "Waiting 2 min — ask Sara in person". Ali can Withdraw any time. Day close does **not** close it.

**F8 Hand over / stale.** Ali hands F4 to Sara; before Sara answers, the cashier closes F4's bill → F4 is To clean. Sara taps Accept → `409 TABLE_HANDOVER_STALE` → "Bill paid, waiting for cleaning"; card stays. A waiter cleans F4 → the request closes (`obsolete`) → Sara's card greys "Closed"; Ali gets "Handover of F4 closed: the table changed".

**F9 Hand over / party changed.** Ali hands F4 to Sara, then moves F4 to F9 (or joins, splits, cleans; or a manager force-moves) → the request closes automatically → Sara's card closes; Ali gets "closed: the table changed". Only one handover per party at a time (`TABLE_HANDOVER_PENDING`).

**F10 Force move (manager).** Bilal went home holding F2. Manager → F2 sheet → Force move → picks Sara (or Me) + reason "Went home" → `force-move-table` → holder Sara at once, no question asked; logged with the reason; any pending handover closed; Bilal's lock released.

**F11 Force release (manager).** Waiter left with F3 locked on his tablet → others see "Bilal is taking an order here" → manager → Release Bilal's lock → reason → Released → others can open. Bilal's draft stays on his tablet; his banner says who released it and why.

**F12 Lock ends by itself.** Bilal's tablet sleeps with F3 open. After the branch's lock time (one branch setting, e.g. 15 min) without activity, or when his session ends (his role's idle time; that clock pauses while the tablet is off the Wi-Fi), the hub releases the lock (`lock_ttl` / `session_expired`) → tile padlock goes → Bilal's banner (when he looks) "Your table F3 was released… Your order is kept." His next Send takes the lock back if it is still free and he is still the holder.

**F13 Same person, other tablet.** Ali opens F4 on Tablet 3, then on Tablet 5 → lock moves to Tablet 5 → Tablet 3 shows "Opened on another device"; its draft stays there.

**F14 Move.** Holder → sheet → Move → free F9 (+ reason "AC") → `move-table` → F4 free, F9 seated with the same party, holder, orders, lock. F9 assigned to Sara and Ali lacks force → 02a-D25 → Hand over to Sara (preset) → Sara accepts → Sara moves it. F4 + F5 joined → "Split first".

**F15 Join a free table.** F4 sheet → Join table → free F5 → `merge-tables { …, table_seating_id: null }` → tiles "F4 + F5".

**F16 Absorb another party.** F4 sheet → Join table → F7 (Ali's other party) → "F7's party joins F4's party" → `merge-tables { …, table_seating_id: F7's }` → F7's orders join F4; tiles "F4 + F7". F7 held by Bilal → `other_owner` → 02a-D25 ("Ask Bilal to hand it over, or ask a manager"). A void waiting on F7 → "Finish it first".

**F17 Split.** F4 + F5 has 3 rounds. Holder → Split → target F5 (joined) → tick round 3 → `split-seating` → F5 becomes its own party with round 3, same holder; F4 keeps rounds 1–2. Detach: target F5, no orders → F5 free. Tick all → "Leave at least one order — or use Move".

**F18 Call waiter.** F4 sheet → Call waiter → Water → `call-waiter { chip: 'water' }` → recipients 2 → toast "Waiter called"; tile "Call sent · just now". Waiters Rashid and Imran get a banner "F4 · Call". Ali taps again within 5 min → "Already called". **recipients 0** (no waiter of Ali's or the assignee's team is signed in) → "Nobody else is working — you can call again in 5 min". Offline → "Needs the hub".

**F19 Ask for bill.** F4 (Ordered / Eating) → Ask for bill → tile Bill. On SEATED with no order → button hidden ("No orders yet"). Guest orders one more naan after → tile back to Ordered (bill request cleared, 02b).

**F20 Clean.** Bill paid (05) → tile To clean (on the next map refresh, §7 Q5) → waiter → Clean → tiles Free; handover and call of the party closed. Guests left without ordering (SEATED, no order) → Clean → "Left without ordering" → Free. Live orders and no paid bill → "F4 still has 3 orders…".

**F21 Offline then reconnect.** Wi-Fi drops → "Hub offline" bar; tiles frozen. Bilal taps Clean on T2 → queued, "waiting to send" mark. He taps Hand over → "Needs the hub". Wi-Fi back → catch-up refreshes tiles → queue sends Clean T2 (with `X-Queued-At`). If T2 had already been cleaned and a new party sat → `TABLE_SEATING_CHANGED` → dropped → queue log row "Clean T2 — not sent: the table had changed"; the new party is untouched. A queued replay never takes or moves a table lock.

**F22 Sign-in / pairing.** App start → name grid → PIN → map. Token revoked → wipe → pair screen. Someone signed in → 02-D01 → sign them out.

**F23 Archived table with a party.** Owner archives F8 while a party sits → F8 moves to the "Archived tables" group (name = id), marked archived; Ask for bill, Clean and Move-from still work; you can't open a new party there or move/join onto it (`404 TABLE_NOT_FOUND` → "This table is no longer in use").

---

## 5. Edge cases and limits

- One party per table; a party has one primary table and any number of joined tables.
- One lock per party; it belongs to one person on one device.
- Lock keep-alive once a minute; ends after the **branch lock time** (`table_lock_ttl_ms`, one branch setting, 1–60 min) without activity, or when the person's session ends (role idle time: order taker 15 min, waiter 5, manager 60; paused while the device is offline), or on a new sign-in of the same person on the same device.
- Clean never checks the lock: a table can be cleaned while someone types its first order (warn, 3.19).
- A call with 0 recipients still blocks another call on that party for 5 minutes.
- No branch config applied yet → locks end only by session end (never by time).
- Only the holder moves, joins, splits or hands over; a manager (`force-release-table-lock`) can do it for anyone.
- `requires_approval` grants on table permissions count as **not allowed** (no approval flow for tables).
- One pending handover per party; requests never expire, survive day close; closed by any party change or clean.
- Handover receiver must be signed in (working) and able to take orders on that floor; not the holder, not the sender.
- A manager force-moving may pick himself.
- Handover note: up to 120 chars, accepted, **not shown** to the receiver.
- Handover card amount: running total of the party's live orders; omitted (with quantity) when no orders.
- Move: single-table parties only; target free and in use; any floor (free if not assigned to someone else).
- Join: free table, or another party (absorbed); blocked by a pending void (04); clears the bill request if it brings a live order.
- Split: whole orders only, ≤ 50 orders per split, at least one, not all; detach = no orders to a joined table.
- Call waiter: one open per party, auto-closes after 5 min or on clean; never rings the caller; not queued offline.
- Ask for bill: needs at least one live order; repeat is harmless.
- Clean: only when bill paid (To clean) or no live order (left without ordering); no floor scope.
- Bill paid → To clean is not live today (no frame) — refetch.
- Reason fields (force release, force move, move) 1–120 chars.
- `party_size` 1–50, only at the first open; ignored later.
- 40 tables on a floor, ~80 per branch, ~60 open parties at peak; names up to 40 chars.
- Archived: no new party, no join onto it; existing party keeps working; shown in the "Archived tables" group.
- Every command carries the shown `seating_id`; mismatch → "This table changed".
- Phones: no Requests screen; alerts only while the page is open.
- Kiosk: no browser back; every sheet has its own Close/Back.

---

## 6. Not in this module — placeholders

| Owner | What appears on 02a screens | Placeholder to draw |
|---|---|---|
| **02b Ordering** | The order screen (menu, cart, ETA), the **orders part** of the table view (rounds, lines, stages, Mark served, Return, Comp, Remove, weight), takeaway / parking buttons and the open-orders list, the device queue bar and queue log, the device idle lock, held orders | Below the table sheet header: a block "Orders" (rounds as grey cards); side column / bottom bar buttons "New takeaway · New parking · Open orders (7)"; a queue chip "2 waiting to send" in the offline bar |
| **02b / 03a / 03b** | Late-food warning ("≈ 6 min late", slip warning) on a tile and as a card grouped per current table ("T4 + T5 — 2 late"); Ready-to-serve and Served cards for waiters (03b) | A small warning flag under the tile ("6 min late", clock icon); Inbox rows |
| **04 Voids** | A void waiting for approval on a table ("Void waiting" flag); the merge/split block | Tile flag "Void waiting"; the `MERGE_BLOCKED_BY_VOID` message |
| **05 Billing** | Bill screen, payment, "bill paid" (turns the table To clean), split bill, cashier's bill-requested alert | "Bill" state on the tile; a disabled "Open bill" button on the kiosk table sheet ("Billing comes later") |
| **01d Alerts** | Requests and Inbox screens, answer sheet, banner stack, sounds, lock-screen text | Reused as-is |
| **01a / 01b setup** | Floors, zones, tables, assignments, permissions (owner app) | — |

---

## 7. Open questions for the owner (the spec does not decide these for the UI)

| # | Question | Default the designer can use meanwhile |
|---|---|---|
| Q1 | **Table colours.** The 02a spec fixes FREE green, SEATED blue, ORDERED amber, FOOD teal, BILL purple, TO CLEAN grey. The Pulse kit ships FREE beige, SEATED blue, ORDERED purple, EATING green, BILL red, CLEAN grey. Which one? **Ask before drawing final frames** (the spec wins unless the owner changes it). | spec palette (the spec wins); keep one token per state so a swap is trivial |
| Q2 | **"Mine" filter** — tables I **hold**, or also tables **assigned** to me? | holder **or** assignee = me |
| Q3 | **Party size** at open: ask for it (optional number pad) or skip? The hub accepts 1–50 only at the first open. | not asked; tile shows seats only |
| Q4 | A person without `take-order` (waiter) taps a free table: nothing, or a toast? | toast "Free table" |
| Q5 | **Bill paid → To clean** is not sent live until module 05 adds it. Refetch the map every 30 s while visible? | yes, 30 s + on any order frame |
| Q6 | `my_floors` people: grey out free tables on other floors? **Data gap:** the session gives only the scope word, not the floor list, and tiles carry no "can open" flag — needs a hub addition. | show normally; handle the 403 "outside your floors" |
| Q7 | Show the **assignee** on free tiles (a quiet "Ali's zone" hint)? | yes, quiet |
| Q8 | **Phone bottom tabs**: Tables · Inbox · Me? | yes |
| Q9 | **Reason chips** for force release, force move and move — which words? | as proposed in 3.9, 3.13, 3.14 |
| Q10 | Move / Join / Split / Force move on **phones**: allowed under "More", or tablet only? | under "More" |
| Q11 | **Handover note**: the hub accepts it but the receiver never sees it. Hide the field until it is carried, or keep it? | hide the field |
| Q12 | **Force move to myself**: the candidate list leaves out the caller. Add a "Me" row (client-side)? | yes |
| Q13 | Sender's result copy for a handover: "accepted / declined" (kind-specific keys) instead of 01d's generic "approved / rejected"? | kind-specific |
| Q14 | **Call-waiter card content:** the alert's display has only the table (no caller name, no chip). Add "from Ali" and "Water" to it (hub + spec change)? | "F4 · Call" only |
| Q18 | **Call with 0 recipients** holds the 5-min dedupe, so a retry rings nobody even after a waiter signs in. Keep, or let a retry ring again (hub change)? | keep; copy says "call again in 5 min" |
| Q19 | **Accept in person:** offer "Sara accepts here (PIN)" on the sender's waiting card (01d in-person answer)? | not offered |
| Q20 | **Waiting card data:** `my-requests` has no receiver name or table id; add them (hub change), or live with "Waiting for an answer" after a reload? | client-kept name; fallback text |
| Q21 | **Force move notices** to the new and old holder (3.25 proposals) — wanted? (R23 says nobody gets a party without knowing.) | yes, as proposed |
| Q22 | **Clean while someone is ordering** (first order not sent): allow with a warning (as built), or block? | warn, allow |
| Q15 | Ask for bill: one tap, or a confirm? | inline confirm |
| Q16 | "Needs you" list in the side column — which items count (my Bill, To clean, my calls, late food)? | my tables with Bill, To clean, late |
| Q17 | Should an order taker see **other people's tables** dimmed, or all equal? | all equal; "Mine" filter for focus |

---

## 8. Coverage checklist

Every source item → where this brief covers it.

### 8.1 Spec §8 client contract

| §8 item | Covered in |
|---|---|
| Login from `staff-roster`; `401 DEVICE_TOKEN_INVALID` / `403 DEVICE_REVOKED` wipe → `/pair` (pair-page resume) | 3.1, 3.4, F22 |
| Table map: floor → zone tiles, icon + word, names, "T4 + T5", holder initials, assignee ≠ holder, padlock + name, time open | 3.6, 3.7 |
| Filter "Mine" | 3.6, Q2 |
| Every action sends the tile's `seating_id` | §3 common rule, 3.27 |
| Open: `TABLE_ALREADY_LOCKED` → "Ali is taking an order here", Force release with reason chips, draft stays | 3.8, 3.9, F2, F11 |
| Order screen: Touch once a minute, Release on leaving | 3.25 (keep-alive), 3.10 Release; order screen itself 02b |
| Banner: my lock released (reason) | 3.25 |
| Banner: `TableLocked { replaced_device_id = mine }` → "Opened on another device" | 3.25, F13 |
| Banner: holder changed away while order screen open → "Ali now has this table. Keep as draft", Release; Send only with `take-order-anywhere`, never takes the lock | 3.25, F4 |
| Drafts never dropped | 3.25, 3.9, F11, F12 |
| Table sheet: Take over, Hand over (working first), Force move, Move, Merge, Split, Ask for bill, Clean, Call waiter (chips) | 3.10–3.19 |
| `403 other_owner` → "Hand it over to Sara; she moves it", Hand over preset | 3.20, 3.14, F14 |
| Handover Accept → `TABLE_HANDOVER_STALE` → "Bill paid, waiting for cleaning" | 3.21, F8 |
| Handover waiting card "Waiting for Bilal — 0:42", Withdraw | 3.22, F5 |
| Top bar: Requests (n) + Inbox (n) | 3.5 |
| Offline: Open, Take over, Hand over, Force, Move, Merge, Split disabled "Needs the hub" | 3.26, 3.10 |
| Offline: Ask for bill, Clean queued with `seating_id` | 3.18, 3.19, 3.26, F21 |
| Offline: Call waiter not queued, "Needs the hub" | 3.17, 3.26 |
| Offline: `TABLE_SEATING_CHANGED` on replay → dropped, in the queue log | 3.19, 3.26, F21 |
| Offline: Touch and Release dropped | 3.25 |
| Rules: buttons from permissions (R5); Urdu / English, Latin digits (R20); no service worker / secure-context APIs (R14, R15) | 1.2, 2.5, 3.10 (R14/R15 are build rules, no screen) |
| Call waiter: "Call sent 1 min ago" on the map; "Nobody else is working" at 0 | 3.17, F18 |

### 8.2 Inventory IDs

| ID | Covered in |
|---|---|
| 02-S01 Name grid | 3.1 |
| 02-S02 PIN pad | 3.2 |
| 02-D01 Take over sign-in | 3.3 |
| 02-S03 Tables home | 3.6 |
| 02-S06 Table view (actions) | 3.10 (orders part → 02b, §6) |
| 02-D09 Move | 3.14 |
| 02-D10 Merge | 3.15 |
| 02-D11 Split | 3.16 |
| 02-D12 Force release | 3.9 |
| 02-D13 Clean | 3.19 |
| 02-B01 Table locked by Bilal | 3.8 |
| 02-B02 Reconnecting (table part) | 3.26 |
| 02-B03 Order kept on this device | 3.25 ("Keep as draft"); draft storage 02b |
| 02-B08 Lock lost while building | 3.25 |
| 02-S04, D02–D07, S05, S07–S10, D08, D14, B04–B07, B09 | 02b brief (§6) |

### 8.3 Client-visible error codes (02a §9, §12.2)

| Code (status, reason) | Covered in |
|---|---|
| `TABLE_ALREADY_LOCKED` 409 | 3.8, 3.14–3.16, F2 |
| `TABLE_LOCK_NOT_HELD` 409 | 3.25 |
| `TABLE_NEEDS_CLEANING` 409 | 3.10, 3.11, 3.12, 3.15, 3.17, 3.18 |
| `TABLE_NOT_OPEN` 409 | never thrown by the built hub (`seating_id` always sent); seating-changed toast covers it (3.27) |
| `TABLE_SEATING_CHANGED` 409 | §3 rule, 3.9–3.19, 3.26, F21 |
| `TABLE_HANDOVER_PENDING` 409 | 3.12 |
| `TABLE_HANDOVER_STALE` 409 | 3.21, F8 |
| `HANDOVER_TARGET_INVALID` 422 (`is_holder`, `is_requester`, `no_permission`, `outside_scope`) | 3.12, 3.13 |
| `HANDOVER_TARGET_UNAVAILABLE` 409 (`inactive`, `not_working`) | 3.12, 3.13 |
| `TABLE_NOT_FREE` 409 | 3.14, 3.16 |
| `TABLE_MERGED` 409 | 3.14, 3.10 |
| `MERGE_BLOCKED_BY_VOID` 409 | 3.15, 3.16 |
| `SPLIT_INVALID` 409 (`empty`, `all_orders`, `not_in_seating`) | 3.16 |
| `TABLE_NO_ORDERS` 409 | 3.18 |
| `TABLE_HAS_OPEN_ORDERS` 409 | 3.19 |
| `TABLE_NOT_FOUND` 404 | 3.12, 3.14, 3.15, F23 |
| `PERMISSION_DENIED` 403 `outside_scope` | 3.6, 3.9, 3.11, 3.14, 3.17, 3.18 |
| `PERMISSION_DENIED` 403 `not_holder` | 3.12, 3.14 |
| `PERMISSION_DENIED` 403 `not_assigned` | 3.11 |
| `PERMISSION_DENIED` 403 `other_owner` | 3.20, 3.14–3.16 |
| `VALIDATION_FAILED` 400 | 3.9 (reason field) |
| `REQUEST_NOT_PENDING` 409 (01d, on the handover card) | 3.21 |
| `DEVICE_TOKEN_INVALID` 401, `DEVICE_REVOKED` 403, `DEVICE_TYPE_NOT_ALLOWED` 403, `PIN_INVALID`, `PIN_LOCKED_OUT`, `DEVICE_LOCKED_OUT`, `DEVICE_SESSION_ACTIVE`, `SERVICE_UNAVAILABLE` | 3.1–3.4 |

Result flags shown: `opened: false` (3.6), `touched: false` (no UI), `released: false` (3.9), `changed: false` (3.11, 3.13), `requested: false` (3.18), `repeated: true` (3.17), `recipients: 0` (3.17).

### 8.4 "§8 flows" tests (planned client tests) and hub tests that touch §8

| Test | Covered in |
|---|---|
| `[02a §8 Login]` (login resume, staff-entry branch) | 3.1–3.4, F22 |
| `[02a §8 Table map]` (tiles, Mine, catch-up + frames) | 3.6, 3.7 |
| `[02a §8 Table sheet]` (sheet, dialogs, other_owner preset, force release) | 3.8–3.20 |
| `[02a §8 Banners]` (banners, handover cards, call-waiter state) | 3.21–3.25 |
| `[02a §8 Offline]` (offline rules, queued Bill / Clean) | 3.26, F21 |
| DoD "§8 flows pass on a tablet and a phone" | device variants in each section, §2.9 frames |
| Hub `call-waiter` test (§8 P-1f: not queued) | 3.17 |
| Hub `bill-clean` test "archived tables and the offline queue" (§8 P-1f) | 3.18, 3.19, F23 |
| Hub #44, #49 queued Clean with an old `seating_id` → dropped | 3.19, F21 |
| Hub #13 accept after bill closed → stale, then Clean closes it | F8 |
| Hub #48 handover with no order → card without quantity / amount | 3.21 |
| Hub #50, #50b caller not rung; recipients 0 | 3.17, F18 |
| Hub #53 Send from draft after take-over with take-order-anywhere, no lock | 3.25, F4 |

### 8.5 Owner rulings and AD rows that change what the user sees

| Ruling | Covered in |
|---|---|
| OQ4: moving to an unassigned (or own) table on any floor is free | 3.14 |
| T3: no separate "Seated" step — opening a free table seats and locks | 3.6, F1 |
| T15 / F-1: same person on another device takes the lock | 3.25, F13 |
| T20: a holder change releases the old holder's lock | 3.11, 3.25, F4 |
| v1.1.2: re-sign-in on the same device ends the lock | 3.25, §5 |
| v1.1.3 / AD-8 / AD-13: queued replays never take or move a lock | F21, 3.25 |
| AD-15: no branch config → no time-based lock release | §5 |
| AD-16: joining an all-cancelled party keeps the bill request | 3.15 |
| AD-18 / v1.1.4: handover note accepted, not shown | 3.12, Q11 |
| AD-20: Clean returns `{ reason }`; Bill `{ requested }`; call card `table_code` = primary name; i18n keys `alert.table_handover.*`, `alert.call_waiter.*` missing → add | 3.18, 3.19, 3.21, 3.24 |
| AD-22 / 02a-N2: `own_tables` scope can't take over | 1.2, 3.10, 3.11 |
| AD-23 / SG-4: archived tables pseudo-group, `archived: true`, "Archived tables" label from the client | 3.6, F23 |
| AD-24: candidates sorted working → name; `tables_held` counts parties | 3.12 |
| AD-25 / 02a-N3: bill paid not live until 05 | 3.6, Q5 |
| AD-26: kitchen screens get no table map | 1.3 |
| SG-1: a zone's tables belong to the zone's order taker | 1.2, 3.7 |
| P-1d (02b): drinks-only tables never turn Eating | 3.6 states ("Drinks-only party") |
| Hostile review fixes (lock TTL = branch setting; own_tables; Open errors; common errors; clean-while-locked; holder-change and force-move notices; waiting-card data gap; call card without caller; 0-recipient dedupe; phone answer sheet; result notice text) | 3.6, 3.10, 3.19, 3.21–3.25, §5, §7 Q18–Q22; `02-brief-review.md` |
| P-1f: Bill and Clean queueable, Call waiter not | 3.17–3.19, 3.26 |
| 01d P-1: table chip "T12" only for all-digit codes | 3.21 |
| 01d AD-168: two top-bar buttons Requests + Inbox | 3.5 |
