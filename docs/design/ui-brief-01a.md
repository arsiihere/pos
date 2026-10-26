# UI design brief: module 01a screens

This brief is for a designer who will redesign the module 01a screens, both how they look and how they work. It describes every screen and dialog that exists today in `apps/client`, what each one does, every field and state, and where today's flow is awkward. It then lists the components we already have, the hard constraints, and the format a redesign must come back in so we can build it.

**Sources.** The code in `apps/client/src/**` (read on 2026-10-26, branch `module-01`, commit `2f1a1e4`), `packages/ui-kit/README.md`, spec `docs/specs/01_Restaurant_Setup_Spec_v1.0.2.md` §8 and the decisions it cites (S8, S21, S22, S24, S30, S32–S35, S37, S40, S41, S44–S48), and the owner decisions D5–D7 in `docs/reviews/01a-auto/decisions.md`. The spec is the source of truth. Where this brief says "today", it means the code; where it says "the spec says", the behaviour is fixed and a redesign cannot change it without a spec change. The module 00 screens (hub setup, pairing) have their own brief in `docs/design/ui-brief.md`.

**What the product is.** A restaurant POS. A small Linux box in the restaurant (the **hub**) runs the kitchen and the tills over the restaurant Wi-Fi, with no internet needed. The **cloud** holds the restaurant's setup (menu, floors, stations) and sends it to each branch's hub about once a minute. Module 01a has two surfaces:

| Surface | URL | Served by | Network | Who | Device | How often |
|---|---|---|---|---|---|---|
| **Owner app** ("Restaurant setup") | `/owner/#/…` | cloud | internet (HTTPS) | owner; a partner who owns some branches | owner's laptop, sometimes their phone | heavy at setup (once), then a few edits a week (prices, new item, hours) |
| **Stock page** (`/admin/stock`) | `http://<hub-ip>/admin/stock/` | hub | restaurant LAN only, plain HTTP | branch manager, shift lead, owner when on site | wall/counter tablet, the cashier kiosk (Chrome kiosk mode), the manager's phone | every day: morning count, top-ups during service, switching items off, closing the day |

**Design status (2026-10-26):** module 01a is designed and built (spec v1.1, S49–S56). For how its screens look and behave, use **`docs/design/handoff/01a/01a-design.md`** (per-screen trees, states, string keys; §0 lists what the build changed) with the frames in `docs/design/handoff/01a/frames/`. Build plan and notes: `docs/design/handoff/01a/PLAN.md`; open questions: `docs/design/open-questions/01a-setup.md`. The rest of this brief describes the screens as they were before the redesign (working, styled only with ui-kit classes on plain elements), kept for the history of what each screen *does*; where it disagrees with `01a-design.md`, `01a-design.md` wins.

**Example restaurant used throughout:** *Arif Chatkhara*, two branches (Gulberg and Johar Town). Menu: **Paye** (breakfast, sold by the plate, cooked overnight in a degh, sold out once gone), **Chicken Karahi** (counted in kg from the pot, sold by the kg), **Naan** (tandoor, pieces, made to order), **Lassi** (counted in litres from the jug, sold by the glass of 300 ml). Breakfast category hours 07:00–13:00.

---

## Contents

1. [Things that apply to every screen](#1-things-that-apply-to-every-screen)
2. [Owner app](#2-owner-app-owner)
   - 2.1 Sign in · 2.2 Branch picker and navigation · 2.3 Floors and tables · 2.4 Stations and programs · 2.5 Menu page (tax classes, categories, item list) · 2.6 Category form · 2.7 Item form (incl. units, threshold, keeps overnight, hours, routes) · 2.8 Available hours field
3. [Hub stock page](#3-hub-stock-page-adminstock)
   - 3.1 PIN sign-in · 3.2 Stock page layout · 3.3 Status line and problem banner · 3.4 Business day line and Close day dialog · 3.5 Stale-day prompt · 3.6 Start day · 3.7 Low/out alert bar · 3.8 Stock rows (count, add, availability, badges) · 3.9 Save counts
4. [Component inventory](#4-component-inventory-appsclientsrccomponents)
5. [Hard constraints](#5-hard-constraints)
6. [How a redesign must come back](#6-how-a-redesign-must-come-back)
7. [Appendix: error codes and today's texts](#7-appendix-error-codes-and-todays-texts)

---

## 1. Things that apply to every screen

### 1.1 Shell

- Each surface is one HTML page (`owner/index.html`, `admin-stock/index.html`) with `<html lang="en" dir="ltr" data-theme="light">` and a `<div id="root">`. The page `<title>` is "POS" on both.
- Views inside a surface are **hash routes** (`/owner/#/menu`). No router library; a small switch in `src/app/router.ts`. The stock page has only one route.
- Every screen today is wrapped in `<main class="pos-screen">`. **`.pos-screen` is the kit's full-screen-state primitive** (centred icon, title, body: "Hub is restarting"). It centres text and items, so the menu list and stock rows are centred too. The kit has **no page/list layout primitive** yet (no header bar, no table, no tabs, no switch, no badge/chip, no list row). A redesign that needs one proposes it as a kit addition (§5.2).
- **No element has the `.pos-root` class today.** The kit README says to wrap the page in `.pos-root`; without it the base font, base colour and the kit's focus ring rule (`:where(.pos-root) :focus-visible`) do not apply. A redesign should place `.pos-root` (we will do it in the build).

### 1.2 Strings and errors

- Every visible string is a key in `src/i18n/en.ts` (`owner.*`, `admin_stock.*`, `errors.<CODE>`, `common.*`, `pin.*`, `quantity.*`). English only until Urdu is added; the layout must be ready for Urdu (RTL).
- Server errors arrive as `{ error: { code, details } }`. The page shows the text for `errors.<CODE>`, **never** the server's message. A code with no text shows `errors.UNKNOWN` ("Something went wrong. Try again."). §7 lists which codes have no text today; several common ones do not.
- Error `details` (which field, which items use it) are **not used today**: every validation problem shows the same "Check the fields and try again."

### 1.3 Busy and slow

- A button that starts a call shows `is-busy` (spinner, stays where it is, disabled) through `BusyButton`. If the call is still running after **3 s**, a warn banner appears under the button: "Still working. This can take a few seconds." (`common.slow`).
- Not every action has a busy state today: see the per-screen notes (save-on-blur fields, archive buttons, stock Add, the Available/Off toggle).

### 1.4 Network loss

- **Owner app (cloud):** no offline mode (spec). On a network failure the page shows a danger banner "The cloud cannot be reached. Check the internet connection; what you typed is kept." (`errors.network`) and keeps the form.
- **Stock page (hub):** while the hub cannot be reached, an info banner "Reconnecting to the hub… What you typed is kept." (`admin_stock.reconnecting`) shows at the top; rows and typed values stay; the page keeps polling every 15 s. A command tried while offline shows a danger banner at the bottom: "The hub cannot be reached. Check the Wi-Fi; what you typed is kept." (`admin_stock.errors.network`).

### 1.5 Sign-out

- **Owner app:** tokens live in `sessionStorage` (cleared when the tab closes). On an expired token the app refreshes once silently; if that fails it goes to Sign in. There is **no Sign out button** and no "signed in as" line today.
- **Stock page:** the admin session expires when idle (the 15 s poll does not count as activity, by design). Any "signed out" answer sends the page back to the PIN sign-in. **Typed counts are lost** when that happens (see 3.8). There is no Sign out button and no "signed in as" line.

---

## 2. Owner app (`/owner/`)

### 2.1 Sign in — `#/login`

1. **Purpose:** the owner signs in to edit the restaurant's setup. **Who:** owner (or a partner owning some branches). **Device:** laptop browser, sometimes phone. **How often:** once per browser session (tokens die with the tab).
2. **Fields and controls**

   | Label (key) | Type | Validation | Required |
   |---|---|---|---|
   | Email (`owner.login.email`) | `type=email`, `autocomplete=username` | none on the page; trimmed before sending | yes (the server answers) |
   | Password (`owner.login.password`) | `type=password`, `autocomplete=current-password` | none on the page | yes |
   | **Sign in** (`owner.login.submit`) | primary `BusyButton`, submit | — | — |

   Title: "Sign in" (`owner.login.title`). Enter submits.
3. **States**

   | State | Today |
   |---|---|
   | Idle | the form |
   | Busy / slow | button spinner; slow banner after 3 s |
   | `LOGIN_INVALID` | danger banner "Email or password is wrong. Check them and try again." |
   | `LOGIN_LOCKED_OUT`, `IP_LOCKED_OUT` | "Too many tries. Wait a few minutes, then try again." (reserved codes; 00 M73 says not returned today) |
   | `VALIDATION_FAILED` (e.g. empty email) | "Check the fields and try again." |
   | network | "The cloud cannot be reached…" |
   | success | goes to `#/` (branch picker) |

4. **Flow:** type email → type password → Sign in (3 actions). **Awkward:** no product name or restaurant identity on the page; both fields empty submits to the server instead of saying "Enter your email"; no show-password toggle; no "forgot password" (not in scope: it is fine to leave it out, but don't design a dead link).
5. **Data:** answer is the owner user: `{ user_id, email, allowed_branch_ids: ["01JBQ3M7Z8K2X4V9N6T5R1P0AB", "01JBQ3N2C5D8F1G4H7J0K3M6PQ"] }`.

### 2.2 Branch picker and navigation — `#/`

1. **Purpose:** choose which branch's floors and stations to edit. **Who/device/how often:** owner, laptop, every session.
2. **Fields and controls**
   - Title "Choose a branch" (`owner.branches.title`).
   - One tile per branch (`.pos-staff__tile`, `aria-pressed` on the chosen one). **The tile text is the raw branch ID**, e.g. `01JBQ3M7Z8K2X4V9N6T5R1P0AB`, because branch names come only with 01b's `GET /v1/admin/branches` (spec S37). The design must allow for a name later; for now it must show the ID in a way that is at least comparable (mono, LTR, maybe last 4 characters emphasised).
   - After a tile is picked, a **nav row** appears under the tiles: four links styled as buttons: "Choose a branch", "Floors and tables", "Stations", "Menu" (`owner.branches.title`, `owner.nav.floors`, `owner.nav.stations`, `owner.nav.menu`). The same nav row sits at the top of every other owner view.
3. **States:** no loading (the list comes from the token); one branch → still one tile to tap; no empty state (an owner always has ≥ 1 branch).
4. **Flow today:** tap a branch tile → nothing visible happens except the tile highlights and the nav row appears → tap "Floors and tables". **Awkward:**
   - Picking a branch does not go anywhere; the nav appears below the fold on a phone.
   - The chosen branch lives in memory only. **Reloading the page on `#/floors` drops you back on the picker**, with no branch chosen and the nav gone.
   - No page says which branch you are editing. Floors and Stations are per branch; the Menu is shared by every branch (tenant-wide) but **you must pick a branch before you can reach the Menu**.
   - The nav has no current-page marker; the "Choose a branch" link is also the way "home".
   - No Sign out, no restaurant name.
5. **Data:** `allowed_branch_ids: string[]` (ULIDs, 26 characters).

### 2.3 Floors and tables — `#/floors`

1. **Purpose:** set the branch's floors (halls) and their tables, used later by waiters to pick a table. **Who:** owner. **Device:** laptop. **How often:** once at setup; rarely after (new table, renaming).
2. **Fields and controls**

   | Part | Label (key) | Type | Validation | Units / default | Required |
   |---|---|---|---|---|---|
   | Page | Title "Floors and tables" (`owner.floors.title`) | — | — | — | — |
   | Page | **Show archived** (`owner.common.show_archived`) | checkbox | — | off | — |
   | Floor card | Floor name (`owner.floors.floor_name`, as `aria-label` only) | text input, **saves on blur** | 1–60 chars after trim; unique among active floors of the branch, case-insensitive (409 `CONFIG_NAME_TAKEN`) | — | yes |
   | Floor card | Sort number (`owner.common.sort_order`, `aria-label` only) | mono text, `inputmode=numeric`, **saves on blur** | integer (may be negative) | lower first | yes |
   | Floor card | **Archive** / **Restore** (`owner.common.archive` / `restore`) | button, acts at once | archive refused while the floor has active tables (409 `CONFIG_IN_USE`) | — | — |
   | Table row | Table name (`owner.floors.table_name`, `aria-label` only) | text, saves on blur | 1–60; unique across the **whole branch** | — | yes |
   | Table row | seats text, e.g. "4 seats" | **read-only text** | — | — | — |
   | Table row | Sort number | as floor | | | |
   | Table row | Archive / Restore | button | | | |
   | Add table (inside each active floor card) | New table name (`owner.floors.new_table`) | text | 1–60 (server) | — | yes |
   | Add table | seats (`owner.floors.seats`, lowercase) | mono, numeric | whole number; 1–100 (server) | empty = unknown | no |
   | Add table | **Add table** (`owner.floors.add_table`) | secondary `BusyButton` | | | |
   | Add floor (bottom of page) | New floor name (`owner.floors.new_floor`) | text | 1–60 | | yes |
   | Add floor | **Add floor** (`owner.floors.add_floor`) | **primary** `BusyButton` | | | |

   The API can also change a table's **seats** and **move a table to another floor**; the page offers neither today.
3. **States**

   | State | Today |
   |---|---|
   | Loading | **nothing**: blank under the title until the list arrives |
   | Empty (no floors) | only the Add floor form; no explanation |
   | Saving a blur edit | **no indicator**; on success the list reloads |
   | Save refused | the field **silently reverts** and a danger banner appears **at the top of the page** (possibly off-screen) |
   | Add busy / slow | button spinner; slow banner after 3 s |
   | `CONFIG_NAME_TAKEN` | "That name is already used. Choose another name." |
   | `CONFIG_IN_USE` (archive a floor with tables) | "Still in use. Archive or move what uses it first." (does not say which tables) |
   | `CONFIG_REFERENCE_INVALID` (table on an archived floor) | "Something it points to is archived or missing. Choose another one." |
   | `VALIDATION_FAILED` / bad seats | "Check the fields and try again." |
   | `IDEMPOTENCY_KEY_MISMATCH` | "This form was already saved with other values. The list is reloaded; check it before adding again." |
   | `BRANCH_NOT_FOUND`, `FLOOR_NOT_FOUND`, `TABLE_NOT_FOUND` | no text → "Something went wrong. Try again." |
   | `PERMISSION_DENIED` | "Only an owner of every branch can change this." |
   | Archived rows | hidden unless Show archived; when shown they look the same as active ones except the button reads Restore (**no "Archived" label**) |
   | Network | "The cloud cannot be reached…" |

4. **Flow (set up Ground floor with 12 tables):** type "Ground floor" → Add floor → in the new card type "T1", "4" → Add table → repeat ×12 (≈ 36 actions). **Awkward:**
   - No bulk add ("T1–T12, 4 seats each"); one table at a time.
   - Rename and reorder save on blur with no save button and no "Saved" feedback; a busy owner does not know it saved, or that a refusal reverted it.
   - Ordering by typing sort numbers (the spec forbids drag: "sort number field, no drag"); numbers are visible as raw integers with no hint which way they sort.
   - Archive acts at once with no confirmation, and archived rows carry no label.
   - The page's one primary button is **Add floor**, at the very bottom of a long page.
   - Seats cannot be corrected after creating a table.
   - Labels exist only as `aria-label`; sighted users see unlabelled inputs in each row.
5. **Data**

   ```
   floors: [
     { floor_id: "01JC…A1", name: "Ground floor", sort_order: 0, archived_at: null,
       tables: [ { table_id: "01JC…B1", name: "T1", seats: 4, sort_order: 1, archived_at: null }, … T12 ] },
     { floor_id: "01JC…A2", name: "Family hall", sort_order: 1, archived_at: null,
       tables: [ { name: "F1", seats: 6 }, … F8 ] },
     { floor_id: "01JC…A3", name: "Rooftop", sort_order: 2, archived_at: 1729700000000, tables: [] }
   ]
   ```

### 2.4 Stations and programs — `#/stations`

1. **Purpose:** set the branch's kitchen stations (tandoor, karahi counter, degh) and, for batch stations, their programs (a fixed batch cook, e.g. "Paye degh 240 min"). The timing engine uses them to plan cook times. **Who:** owner (with the head cook). **Device:** laptop. **How often:** once at setup; rarely after.
2. **Fields and controls** — one card per station; every field in the card is edited in place and saves on blur (text) or on change (selects).

   | Part | Label (key) | Type | Validation | Units / default | Required |
   |---|---|---|---|---|---|
   | Page | Title "Stations"; Show archived checkbox | | | | |
   | Station | Station name (`owner.stations.station_name`) | text, blur-save | 1–60; unique per branch | | yes |
   | Station | Where it is (optional) (`owner.stations.location_label`) | text, blur-save | 0–60; empty = none | | no |
   | Station | Type (`owner.stations.type`): "Cooks each order (slot)" / "Cooks in batches (batch)" | select, **saves on change** | change refused while active routes use the station (409 `CONFIG_IN_USE`) | slot | yes |
   | Station | Capacity (`owner.stations.capacity`) | mono numeric, blur-save | whole 1–100 | orders at once (not said on page) | yes |
   | Station (batch only) | Freshness window (minutes) (`owner.stations.freshness_minutes`) | mono decimal, blur-save | minutes, up to 2 decimals; 0–60 min | 0 | no |
   | Station | Completion (`owner.stations.completion_mode`): "Two taps" / "One tap" / "Done automatically" | select, saves on change | | Two taps | yes |
   | Station | Archive / Restore | button, at once | archive refused while active routes use it | | |
   | Programs (batch only) | heading "Programs" | | | | |
   | Program row | Program name; Cook time (minutes) | blur-save | name 1–60, unique per station; cook 1 min–4 h | minutes | yes |
   | Program row | Archive / Restore | button | refused while active routes use it | | |
   | Add program (batch, active station) | New program name; Cook time (minutes); **Add program** (secondary) | form | | | name, cook |
   | Add station (bottom) | New station name; Where it is (optional); Type; Capacity; Freshness window (batch only); Completion; **Add station** (primary) | form | as above | slot, two taps | name, type, capacity |

3. **States:** as Floors (no loading, no empty text, silent blur saves, top-of-page error). Plus: changing Type or Completion saves the instant the select changes, with no confirmation. `CONFIG_IN_USE` on a type change says "Still in use. Archive or move what uses it first." without naming the items. `PROGRAM_NOT_FOUND` → "Something went wrong."
4. **Flow (add the tandoor):** type "Tandoor" → "Back left" → Type slot → Capacity "12" → Completion → Add station (6 actions). **Awkward:**
   - "Slot", "batch", "capacity", "freshness window", "completion", "program" are engine words. A cook does not know that capacity means "how many orders it can cook at once", that freshness means "how long a finished batch is still served", or what "Two taps" taps.
   - Every station's whole edit form is always open; ten stations = a wall of inputs.
   - The Type select is one mis-tap away from a refused or surprising change.
   - Minutes accept decimals ("1.5") but nothing says so.
5. **Data**

   ```
   stations: [
     { station_id: "01JD…S1", name: "Tandoor", location_label: "Back left", station_type: "slot",
       capacity: 12, freshness_window_ms: null, completion_mode: "two_tap", archived_at: null, programs: [] },
     { station_id: "01JD…S2", name: "Karahi counter", station_type: "slot", capacity: 4, completion_mode: "single_tap", … },
     { station_id: "01JD…S3", name: "Degh", station_type: "batch", capacity: 2,
       freshness_window_ms: 1800000 /* 30 min */, completion_mode: "two_tap",
       programs: [ { program_id: "01JD…P1", name: "Paye degh", cook_time_ms: 14400000 /* 240 min */, archived_at: null } ] }
   ]
   ```

### 2.5 Menu page — `#/menu` (tax classes, categories, item list)

1. **Purpose:** the restaurant's whole menu, shared by every branch: tax classes, categories, items. Opens the category and item forms. **Who:** owner. **Device:** laptop (phone for a quick price change). **How often:** setup once; then weekly.
2. **Fields and controls** (one long page, in this order)

   | Section | Controls (keys) | Notes |
   |---|---|---|
   | Title | "Menu" (`owner.menu.title`) | |
   | Read-only line | info banner `owner.menu.read_only`: "Read only: tax classes, categories and items are shared by every branch, so only an owner of every branch can change them." | only when `can_edit_tenant` is false (spec S8) |
   | **Tax classes** (heading styled as a field label) | each row: name, rate "16 %", "Archived" text if archived, **Archive/Restore** | **No rename and no rate change on the page** (the API allows both) |
   | Add tax class | New tax class name; Rate (%) (mono decimal, up to 2 decimals → basis points; 0–100 %); **Add tax class** (secondary) | |
   | **Categories** | each row: name, "Archived", **Edit** (opens 2.6), **Archive/Restore** | Archive refused while active items use it |
   | | **New category** button | opens 2.6 |
   | **Items** | **New item** button | opens 2.7 |
   | Filters | Search items (`type=search`, max 60, sent 300 ms after typing stops); Category (select: "All categories" + every category); Show (select: Active / Archived) | server-side, paged |
   | Item rows | name; group label if any; category name; price "Rs 2200"; **Edit**; **Archive/Restore** | 50 a page (cursor) |
   | | **Load more** (`BusyButton`) | while `next_cursor` is set |

   An open category or item form **replaces the whole page** (one primary button per screen); Save or Cancel returns to the list and reloads it.
3. **States**

   | State | Today |
   |---|---|
   | Loading | headings "Tax classes", "Categories", "Items" with nothing under them; no busy text |
   | Read-only (`can_edit_tenant` false) | the info line; every Add/Edit/Archive/New button is hidden; the list and filters still work |
   | `403 PERMISSION_DENIED` on a save anyway | "Only an owner of every branch can change this." |
   | Empty menu | empty lists, no guidance (e.g. "Add a category first") |
   | No search results | empty list, nothing said |
   | Archive refused (`CONFIG_IN_USE`) | top banner "Still in use. Archive or move what uses it first." |
   | Archive / Restore busy | **no indicator** |
   | Load more busy / slow | spinner; slow banner |
   | Network | top danger banner; list stays |

4. **Flow (change Naan's price from Rs 30 to Rs 35):** Menu → (scroll past tax classes and categories) → type "naan" in Search → wait → Edit → find Price among ~20 fields → type 35 → Save (≈ 6 actions, plus scrolling). **Awkward:**
   - The page mixes three different jobs in one scroll; the items, which are 95 % of the use, come last.
   - The item row shows no units, stock, hours, routes or archived state, so you can't see at a glance which items are sold where or have hours.
   - Prices show as "Rs 2200" (no thousands separator) and do not say per piece / per kg.
   - Archive acts at once with no confirmation; Edit and Archive sit side by side.
   - Tax classes cannot be renamed or re-rated here; a rate change today means archive + new class + edit every item.
   - "Show: Active / Archived" is a select for a two-way switch.
5. **Data**

   ```
   can_edit_tenant: true,
   tax_classes: [ { tax_class_id: "01JE…X1", name: "PRA card", rate_bp: 500, archived_at: null },
                  { tax_class_id: "01JE…X2", name: "PRA cash", rate_bp: 1600, archived_at: null } ],
   categories: [ { category_id: "01JE…C1", name: "Breakfast", sort_order: 0, archived_at: null,
                   availability_windows: [ { start_ms: 25200000, end_ms: 46800000 } ] /* 07:00–13:00 */ },
                 { category_id: "01JE…C2", name: "Karahi", sort_order: 1, availability_windows: [] },
                 { category_id: "01JE…C3", name: "Breads", … }, { category_id: "01JE…C4", name: "Drinks", … } ],
   items: [ …see 2.7… ], next_cursor: "eyJ…" | null
   ```

### 2.6 Category form (New category / Edit category)

1. **Purpose:** name a category, set its order and its hours. **Who/device:** owner, laptop. **How often:** setup; rare.
2. **Fields:** title "New category" / "Edit category"; **Category name** (text, 1–60, unique per restaurant); **Sort number** (mono numeric, integer, default 0); **Available hours** (see 2.8); **Save** (primary) and **Cancel**.
3. **States:** busy/slow on Save; `VALIDATION_FAILED` (bad sort number, or an hours row incomplete or invalid) "Check the fields and try again."; `CONFIG_NAME_TAKEN`; `IDEMPOTENCY_KEY_MISMATCH` closes the form and shows the reload message on the list; an edit with nothing changed just closes; `CATEGORY_NOT_FOUND` → "Something went wrong."
4. **Flow (Breakfast 07:00–13:00):** New category → "Breakfast" → Add hours → From 07:00 → To 13:00 → Save (6 actions). **Awkward:** Cancel discards without asking; the sort number has no context ("0" relative to what?).
5. **Data:** `{ name: "Breakfast", sort_order: 0, availability_windows: [ { start_ms: 25200000, end_ms: 46800000 } ] }`.

### 2.7 Item form (New item / Edit item)

1. **Purpose:** everything about one dish: name, price, tax, timing, stock and units, hours, and which kitchen station cooks it at each branch. **Who:** owner, laptop. **How often:** ~100 times at setup; then a few a week.
2. **Fields and controls** — one long column, in today's order:

   | # | Label (key) | Type | Validation (page / server) | Units / default | Required |
   |---|---|---|---|---|---|
   | 1 | Item name (`owner.item.name`) | text | 1–60; unique per restaurant among active items | | yes |
   | 2 | Group label (optional) (`owner.item.group_label`) | text | 0–60 | e.g. "Half" / "Full" grouping | no |
   | 3 | Description (optional) | text (single line) | | | no |
   | 4 | Category | select of active categories (+ the item's own if archived) | must be active | **first active category** | yes |
   | 5 | Tax (`owner.item.tax_class`) | select: **"No tax"** first, then "PRA card (5 %)", … | active class or none (S34) | **No tax** | yes (No tax is a value) |
   | 6 | Price (Rs) | mono decimal | rupees, commas dropped, ≤ 2 decimals; 0 – 10 000 000 Rs (server) | price of **one piece, one kg or one L** of "Sold by" (not said on the page) | yes |
   | 7 | Serving (`owner.item.serve_mode`): "Serve as soon as it is ready" / "Serve together with the rest of the order" | select | | as soon as ready | yes |
   | 8 | Cook time (minutes) | mono decimal | 1 min – 4 h, ≤ 2 decimals | minutes | yes |
   | 9 | Prep buffer (minutes) | mono decimal | 0–60 min | empty = 0 | no |
   | 10 | Time from pre-cooked stock (minutes, optional) | mono decimal | 0 … cook time (`CONFIG_REFERENCE_INVALID` `stock_time_exceeds_cook_time`) | empty = not stock-tracked by this item (slot stations) | no |
   | 11 | When pre-cooked stock runs out: "Cook fresh" / "Sold out" | select | | **Cook fresh** (S32, still an owner question) | yes |
   | 12 | Stock unit: "Pieces" / "Grams (shown as kg)" / "Millilitres (shown as L)" | select | | Pieces | yes |
   | 13 | Sold by | select: Pieces only when stock is Pieces; else Pieces or the stock unit | units differ ⇒ Sold by is Pieces | Pieces | yes |
   | 14 | Grams per piece / Millilitres per piece | mono decimal (whole number) | 1 – 1 000 000; **shown only when stock unit ≠ Sold by** | in grams / ml | yes when shown |
   | — | warn banner "Takes effect when the next business day starts; that day needs a new count of this item at every branch." | | shown when 12–14 differ from the saved values (S44) | | |
   | 15 | Low stock alert at (empty = none) | `QuantityInput` in the **stock unit** (pieces / kg / L, kg & L up to 3 decimals) | 0 – 1 000 000 smallest units | empty = no alert; **cleared automatically when the stock unit changes** | no |
   | 16 | Keeps overnight (`owner.item.carries_over`) | checkbox | | **off** (S41) | no |
   | 17 | Available hours | see 2.8 | | empty = always | no |
   | 18 | Kitchen route per branch (`owner.item.routes`) — one row per allowed branch | row: **raw branch ID**, Station select ("Not sold at this branch" + active stations of that branch); for a batch station also **Program** (active programs; first one preselected) and **Program for pre-cooked stock** ("None" + programs) | station active and of that branch; batch ⇒ program required; slot ⇒ no programs | Not sold at this branch | no |
   | — | **Save** (primary), **Cancel** | | | | |

   On save: a new item is one POST with its routes. An edit sends a PATCH with only the changed fields, then **one PUT per changed branch route, one after another**.
3. **States**

   | State | Today |
   |---|---|
   | Loading stations for the route rows | the Station selects show only "Not sold at this branch" until each branch's stations arrive; no busy text |
   | Saving / slow | Save spinner; slow banner |
   | Client checks fail (bad price, minutes, per-piece, an hours row) | "Check the fields and try again." — **does not say which field and does not mark it** |
   | `CONFIG_NAME_TAKEN` | "That name is already used…" |
   | `CONFIG_REFERENCE_INVALID` (archived category; program required; stock time > cook time; wrong station) | "Something it points to is archived or missing. Choose another one." — wrong advice for `stock_time_exceeds_cook_time` and `program_required` |
   | `IDEMPOTENCY_KEY_MISMATCH` | form closes; list shows the reload message |
   | **Edit: PATCH saved but a route PUT failed** | error banner, form stays open; part of the change is already saved and nothing says so |
   | `PERMISSION_DENIED` | "Only an owner of every branch can change this." |
   | `MENU_ITEM_NOT_FOUND`, `BRANCH_NOT_FOUND` | "Something went wrong." |
   | Read-only | the form cannot be opened (no Edit buttons) |
   | Network | "The cloud cannot be reached…"; the form keeps its values |

4. **Flow (new item Chicken Karahi, sold by kg, at both branches):** New item → name → category Karahi → tax → price 2200 → serving → cook 20 → prep → (skip stock time) → out of stock → Stock unit Grams → Sold by Grams → Low stock 1 → Keeps overnight off → (hours none) → Gulberg station Karahi counter → Johar Town station Karahi counter → Save (≈ 16 actions over a page about 4 screens tall). **Awkward:**
   - 18 settings in one flat column, in an order that mixes "what the customer sees" (name, price), "kitchen timing" (serving, cook, prep, stock time), "stock" (units, threshold, overnight, out-of-stock) and "where it's sold" (routes).
   - Engine words: "Prep buffer", "Time from pre-cooked stock", "Serving: together with the rest of the order", "Program for pre-cooked stock".
   - The stock settings (11, 12–16) matter only where the item is stock-tracked, but they are always shown with no explanation of when they apply.
   - "Price (Rs)" does not say per piece / per kg / per L, and changes meaning when Sold by changes.
   - Stock unit vs Sold by vs "Grams per piece" is the hardest idea on the page: a plate of karahi (Sold by Pieces) taken from a pot counted in grams (Stock unit Grams, 250 g per plate). Nothing explains it; an owner will pick Grams/Grams for a plate.
   - Changing the stock unit silently empties Low stock alert.
   - Routes show raw branch IDs; "Not sold at this branch" is hidden as the first option of a Station select.
   - No new item can be saved before a category exists, but the form opens with an empty Category select and only fails on Save.
   - Cancel discards everything without asking.
5. **Data** (one item as the API returns it)

   ```
   { item_id: "01JF…K1", name: "Chicken Karahi", group_label: null, description: null,
     category_id: "01JE…C2", tax_class_id: null, sort_order: 0,
     price_minor: 220000 /* Rs 2,200 per kg */, serve_mode: "immediate",
     prep_buffer_ms: 120000, cook_time_ms: 1200000, stock_time_ms: 300000,
     out_of_stock_behaviour: "cook_fresh",
     stock_unit: "g", sale_unit: "g", stock_per_sale_unit: 1,
     low_stock_threshold: 1000 /* 1 kg */, carries_over: false,
     availability_windows: [], archived_at: null,
     routes: [ { branch_id: "01JBQ3M7…AB", station_id: "01JD…S2", program_id: null, stock_program_id: null },
               { branch_id: "01JBQ3N2…PQ", station_id: "01JD…T2", program_id: null, stock_program_id: null } ] }

   Paye:  stock_unit "piece", sale_unit "piece", out_of_stock_behaviour "sold_out", carries_over true,
          category Breakfast (07:00–13:00), route Degh / program "Paye degh" / stock program "Paye degh",
          price_minor 45000 (Rs 450 a plate), low_stock_threshold 10
   Naan:  pieces, cook_fresh, carries_over false, route Tandoor, price_minor 3000, stock_time_ms null
   Lassi: stock_unit "ml", sale_unit "piece", stock_per_sale_unit 300 (one glass = 300 ml),
          low_stock_threshold 2000 (2 L), price_minor 25000 (Rs 250 a glass)
   ```

### 2.8 Available hours field (items and categories)

1. **Purpose:** limit when an item or category can be ordered (breakfast, lunch-only deals). Spec S47.
2. **Controls:** legend "Available hours"; with no rows, help text "Always available"; up to **4 rows** of **From** and **To** (`type=time`, 24 h, HH:MM, mono, LTR) and **Remove**; **Add hours** while fewer than 4.
   - Validation per row: both empty = incomplete (blocks Save, no message); not HH:MM → "Enter times as HH:MM."; From = To → "From and To must differ.". **To earlier than From wraps past midnight** (22:00–02:00 is valid) — not explained on the page.
   - An item is orderable only inside its own hours **and** its category's hours; the page does not say that the category's hours also apply.
3. **States:** per-row error text under the row; form-level "Check the fields…" on Save if any row is incomplete.
4. **Awkward:** an empty row added by mistake silently blocks Save; the midnight wrap and the category rule are invisible; the native time input looks different in every browser.
5. **Data:** `availability_windows: [ { start_ms: 25200000, end_ms: 46800000 } ]` (07:00–13:00, local hub time, milliseconds from midnight).

---

## 3. Hub stock page (`/admin/stock`)

### 3.1 PIN sign-in

1. **Purpose:** a manager signs in on a shared device to manage stock. **Who:** anyone whose role has `manage-stock` (manager, shift lead, owner). **Device:** wall/counter tablet, cashier kiosk, manager's phone, on the restaurant Wi-Fi. **How often:** several times a day (the session ends when idle).
2. **Controls**
   - Card with title "Sign in to manage stock" (`admin_stock.login.title`), line "Tap your name, then type your PIN." (`admin_stock.login.pick`).
   - **StaffTiles**: one tile per person who can open the page (names, e.g. "Imran", "Bilal", "Arif"). A locked person's tile is disabled and dashed, **with no text saying why or until when**.
   - **PinPad** appears **only after a name is tapped**: 6 dots, keys 1–9, Delete, 0, Enter. PIN is 4–6 digits (server). Digits are never shown.
3. **States**

   | State | Today |
   |---|---|
   | Loading roster | "Loading the staff list…" |
   | Nobody can open the page | info banner "No one on the staff list can open this page. Ask the owner." |
   | Signing in | keys disabled (`is-locked`); no spinner |
   | `PIN_INVALID` | pad shakes, dots turn red; banner "Wrong PIN. Try again." |
   | `PIN_LOCKED_OUT` | "Too many wrong PINs. Wait, then try again." (no time shown; `details.retry_after_ms` unused) |
   | `DEVICE_LOCKED_OUT` | "Too many wrong PINs on this screen. Wait, then try again." |
   | `DEVICE_TOKEN_INVALID`, `DEVICE_REVOKED` | "This screen must be paired again." |
   | `HUB_NOT_PROVISIONED` | "The hub is being set up." |
   | Hub unreachable (roster or login) | "The hub cannot be reached. Check the Wi-Fi; what you typed is kept." — on a roster failure the tiles are empty and there is **no retry button** |

4. **Flow:** tap name → 4 digits → Enter (6 taps). **Awkward:** pad appears below the tiles, so on a phone with many staff it is off-screen after the tap; "Enter" key vs submitting on the last digit; locked tiles give no reason; no retry after a failed roster load (reload the page).
5. **Data:** `staff: [ { staff_id: "01JG…M1", display_name: "Imran", locked_until: null }, { …"Bilal", locked_until: 1730000000000 } ]`.

### 3.2 Stock page layout (signed in)

Top to bottom, as rendered today, all in one centred column:

1. Title "Stock"
2. Status line (3.3) and, when set, the problem banner
3. Reconnecting banner (when the hub is unreachable)
4. Query error banner (the stock query was refused)
5. Business day line + **Close day** (3.4)
6. Low/out alert bar (3.7)
7. Stale-day prompt (3.5)
8. Start day card (3.6), when no day is open
9. Search + Category filter, then one card per item (3.8)
10. **Save counts** button (3.9)
11. Start day card again (retry place), after a refused save
12. Message banner (saved / nothing to save / errors)

The page re-reads the stock query and config status **every 15 s** while visible, and after each of its own commands. A refresh never overwrites a row being edited.

**Who / how often:** branch manager, at opening (count everything), during service (add a fresh batch, switch an item off), at closing (close the day). **Main job:** morning count.

**Morning count today (Gulberg, 30 stock-tracked items):** sign in (6 taps) → if yesterday is still open: **Close and start new day** (1) → for each item: tap On hand, type the count, or tap **Confirm** if yesterday's carries-over count is still right (30–60 taps + typing, scrolling through 30 tall cards) → scroll to the bottom → **Save counts** (1) → read "Counts saved." at the bottom. **Awkward:** the one Save is below every row; nothing shows which rows are still uncounted except a per-row badge; nothing shows how many rows you've touched; a session timeout mid-count loses everything typed.

### 3.3 Status line and problem banner

1. **Purpose:** tells the manager whether the hub has the latest menu from the cloud. Read on open and every 15 s (§6.21). No "Get changes now" button (S24).
2. **Text** (small help text, `pos-field__help`):
   - "Menu version 42 · checked 1 min ago" / "· checked just now"; "· offline" appended when the last poll was offline.
   - "No menu yet" instead of the version when the hub never got one.
   - "Waiting for hub confirmation" while the hub is not yet confirmed (`not_ready`).
   - **Problem banner** (danger, stays until it clears):
     - rejected: "Menu update refused (hash_mismatch). The hub is still using version 42." — **the reason is a raw machine word**: `malformed`, `hash_mismatch`, `schema_unsupported`, `schema_invalid`.
     - `apply_failed`: "Menu update could not be applied. The hub is still using version 42." (or "… The hub has no menu yet.")
     - unauthorized: "The hub's cloud key was refused. Call support."
3. **Awkward:** "Menu version 42" means nothing to a manager; what they need is "Menu up to date · checked 1 min ago" or "Menu changes from the owner are not arriving: call support". The raw reason is jargon. "Checked n min ago" uses the hub clock (correct) but does not tick between polls.
4. **Data:** `{ tenant_id, branch_id, config_version: 42, applied_at, last_poll: { outcome: "unchanged", at }, last_problem: null | { outcome: "rejected", reason: "hash_mismatch", at } }`. `tenant_id` / `branch_id` are read here and put on every command (D7); never shown.

### 3.4 Business day line and Close day dialog

1. **Purpose:** shows whether a business day is open; counts belong to a day (S33, S41). **Who:** manager; Close day at night.
2. **Controls and texts**
   - Day open: banner "Day open: Sat 24 Oct since 09:12 (15 h)" (`admin_stock.day.open`), tone **ok**, or **warn** once the day is older than `day_stale_after_hours` (default 16). Tone comes from the day's **age**, not its date (spec).
   - **Close day** (secondary `BusyButton`) next to it.
   - Day closed: info banner "Day closed at 01:10" (**no date**). No Close button.
   - No day ever opened: nothing here (Start day shows instead, 3.6).
   - **Close day dialog** (`.pos-scrim` + `.pos-dialog`): title "Close day"; body "Close the business day? Counts of items that do not keep overnight will read 0 until the next day is started" (text quoted by the spec); buttons **Cancel** and **Close day** (danger).
   - `opened_recently` answer (another tablet just opened the day): info message at the bottom "This day was started less than 4 h ago; nothing changed." (number from `day_min_gap_hours`).
3. **States:** busy on Close day; errors in the bottom message banner; offline as §1.4.
4. **Awkward:** "Day open … (15 h)" looks like data, not status; the dialog body is long and technical; closing is two taps but the result appears far from the button; the dialog does not trap focus or close on Escape.
5. **Data:** `business_day: { business_date: "2026-10-24", opened_at, closed_at: null }`, `day_stale: false`, `day_stale_after_hours: 16`, `day_min_gap_hours: 4`, `hub_time: { now_ms, utc_offset_ms: 18000000 /* PKT +05:00 */ }`.

### 3.5 Stale-day prompt

1. **Purpose:** in the morning, yesterday's day was never closed; offer to close it and start today's (S33). Shown above the rows while the hub says `day_stale` and the manager has not chosen Keep.
2. **Controls:** card with "Yesterday's day is still open since 09:12. Close it and start a new day?"; **Close and start new day** (`BusyButton`, sends Close then Open); **Keep this day open** (hides the prompt **until the page reloads**).
3. **States:** busy on both actions; if the close answers `opened_recently`, the info message from 3.4 and no new day; errors in the bottom banner.
4. **Awkward:** it always says "Yesterday's" even after two days; it shows a time with no day; it sits **below** the alert bar and the day line, so the day line already says the same thing in warn; neither button is the page's primary although it is the first thing to do in the morning.
5. **Data:** as 3.4 with `day_stale: true`.

### 3.6 Start day

1. **Purpose:** open the business day, so counts can be saved (S33). One tap, no confirmation.
2. **Two places:**
   - **rows** (above the stock rows whenever no day is open): card "No business day is open. Start the day, then enter the counts." + **Start day** (primary).
   - **retry** (under Save counts after a save or Add answered `409 BUSINESS_DAY_NOT_OPEN`, e.g. another device closed the day): card "The business day is not open, so this was not saved. Start the day to save it." + **Start day**. After the tap, the refused save or Add is re-sent with the **same** command ID and the typed values.
3. **States:** busy / slow; errors in the bottom banner.
4. **Awkward:** with no day open the rows are still fully editable, so a manager types 30 counts and only learns at Save; when both places show there are two Start day buttons.

### 3.7 Low/out alert bar

1. **Purpose:** what is running low or has run out (S46).
2. **Text:** one warn banner, one sentence: "Low: Chicken Karahi 0.9 kg, Lassi 1.5 L · Out: Paye, Seekh Kebab". Hidden when none. `out` counts every stock-tracked item at 0, including Cook fresh ones.
3. **Awkward:** one run-on sentence; not tappable (tapping "Paye" should take you to the Paye row); kg shown as "0.9 kg" (the spec's example reads "900 g"); with many items it wraps into a paragraph.
4. **Data:** from each row's `level` (`ok`, `low`, `out`, `not_counted`) and `available`.

### 3.8 Stock rows

1. **Purpose:** one row per menu item at this branch, in config order. Count stock, add a fresh batch, switch the item on or off.
2. **Controls per row** (a `.pos-card` each)

   | Part | Label (key) | Type | Validation | Units | Notes |
   |---|---|---|---|---|---|
   | Header | item name (bold) | text | | | group label not shown |
   | Header | **Available** / **Off** (`admin_stock.available`, `admin_stock.off`) | two buttons, `aria-pressed` | | | tapping the other one sends `SetItemAvailability` at once; **no busy state**, no confirmation; the change shows after the refresh |
   | Stock only | **On hand** (`admin_stock.on_hand`) | `QuantityInput` | pieces: whole; kg/L: up to 3 decimals; error "Check the number: whole pieces, or kg and L with up to 3 decimals." | pieces / kg / L in the item's stock unit; `inputmode` numeric or decimal | starts with the valid count, or **empty** when not valid (other unit, never counted) |
   | Stock only | **Confirm** | button | disabled when there is no valid count | | marks "this count is still right" so Save re-sends it |
   | Stock only | "Reserved 2", "Available 7" (`admin_stock.reserved`, `admin_stock.available_label`) | text | | kg/L with unit; **pieces as a bare number** | Available = 0 when the count is not valid |
   | Stock only | "Set at 11:05" | text | | hub time | when counted |
   | Stock only | "Sold out when 0" | text | | | only `sold_out` items |
   | Stock only | **Add** field + **Add** button (`admin_stock.add_label`, `admin_stock.add`) | `QuantityInput` + button | button disabled while empty or 0 | stock unit | sends `AddPrecookedStock` **at once** for that row (not on Save); **no busy, no success message** (the field just clears) |
   | Badges (each a full Banner) | "Not counted today" (warn) | | | | `level = not_counted`; never for a keeps-overnight item with a count in its unit |
   | | "Hours 07:00–13:00" (info) | | | hub clock, re-checked each minute | item or its category outside its hours; not shown for an Off item |
   | | "Off since Mon 24 Oct" (warn) | | | | Off since before today's day started (S30) |

   Above the rows: **Search items** (placeholder only, client-side) and **Category** select ("All categories" + category names).
3. **States**

   | State | Today |
   |---|---|
   | First load | nothing under the title until the first answer (no loading text) |
   | No items | "No items in the menu yet." |
   | No search match | empty, nothing said |
   | Non-stock item (e.g. Naan) | only name and Available/Off (+ hours/off badges) |
   | Refresh while typing | typed values stay |
   | Hub unreachable | reconnecting banner at top; values kept |
   | Query refused (403/409/500) | banner at top until a good answer |
   | Signed out (idle) | back to the PIN sign-in; **typed counts and adds are lost** |
   | Command errors | bottom message banner: `PERMISSION_DENIED` "You do not have permission for this. Ask a manager."; `STOCK_NOT_TRACKED`, `MENU_ITEM_NOT_FOUND`, `VALIDATION_FAILED`… (see §7) |
   | Out of hours | info badge on the row; still editable |
   | Business day not open | Start day card (3.6); rows still editable |

4. **Flow (a cook brings out 10 more seekh kebabs during lunch):** find the row (search "seekh") → tap Add field → "10" → Add (4 actions; good). **Awkward:**
   - Two quantity inputs per row (**On hand** and **Add**) side by side, with different commit rules (On hand waits for Save counts; Add sends now). Typing a batch into On hand **replaces** the count instead of adding.
   - "Available" is both the toggle label (can be ordered) and the stock number label (left to sell). Same word, two meanings, side by side.
   - "Confirm" is unclear: confirm what?
   - Each card is tall (header, a wrapping row of ~10 parts, then badges as full banners); 30 items is a long scroll on a tablet.
   - Pieces numbers have no unit ("Reserved 2"); kg numbers do.
   - Available/Off and Add give no feedback until the next refresh.
5. **Data** (one row is `items_meta[i]` + `items[i]`)

   ```
   items_meta: { item_id: "01JF…K1", name: "Chicken Karahi", group_label: null,
                 category_id: "01JE…C2", category_name: "Karahi", is_stock_tracked: true,
                 out_of_stock_behaviour: "cook_fresh", stock_unit: "g", sale_unit: "g",
                 stock_per_sale_unit: 1, low_stock_threshold: 1000, carries_over: false,
                 item_windows: [], category_windows: [] }
   items:      { item_id: "01JF…K1", on_hand: 4500, reserved: 1500, unit: "g", available: 3000,
                 level: "ok", set_at: 1729746300000 /* 11:05 */, is_available: true, unavailable_since: null }

   Paye  → meta: stock_unit "piece", sold_out, carries_over true, category_windows [07:00–13:00]
           item: on_hand 0, available 0, level "out", is_available true  → "Out: Paye", "Sold out when 0",
           and after 13:00 "Hours 07:00–13:00"
   Naan  → is_stock_tracked false → name + Available/Off only
   Lassi → stock_unit "ml": On hand "6.5" L, Reserved "0.6 L", Available "5.9 L"
   ```

### 3.9 Save counts

1. **Purpose:** send every row whose On hand was touched (edited, even back to the same number, or Confirmed) as one `SetPrecookedStock` command.
2. **Control:** **Save counts** (`BusyButton`, primary unless the Start day card is showing). A single button at the bottom of the page.
3. **States:** busy / slow; nothing touched → warn "Change or confirm a count first."; success → ok "Counts saved." (bottom) and refresh; `409 BUSINESS_DAY_NOT_OPEN` → retry Start day card (3.6); other errors → bottom banner; offline → "The hub cannot be reached…", values kept; a retry of the same entries reuses the same command ID (safe to tap again).
4. **Awkward:** below every row (long scroll), no count of touched rows ("Save 12 counts"), the result appears below the button where the manager may not look, and a cleared On hand is silently skipped.

---

## 4. Component inventory (`apps/client/src/components`)

Shared, data-in/callbacks-out, no API calls. 02's staff login and ordering screens will reuse PinPad, StaffTiles, BusyButton, Banner and QuantityInput, so a redesign of these is a redesign for every later screen.

| Component | Props | States | Kit classes | Used by |
|---|---|---|---|---|
| **Banner** | `tone: 'ok' \| 'warn' \| 'danger' \| 'info'`, `text: string`, `detail?: string` (second line, `<small>`) | four tones; `role="alert"` for danger, `status` otherwise; icon per tone (ok check, warn clock, danger alert triangle, info sync) | `pos-banner`, `pos-banner--{tone}`, `pos-icon` | every screen; stock row badges |
| **BusyButton** | `busy: boolean`, `onClick?`, `children`, `primary?` (default false), `type?: 'button' \| 'submit'` | idle; busy (`is-busy`, disabled, `aria-busy`); slow (after 3 s adds a warn Banner "Still working…" right after the button) | `pos-btn`, `pos-btn--primary`, `is-busy` | every save/add/sign-in/day action |
| **PinPad** | `onSubmit(pin)`, `disabled?`, `error?` | dots fill (max 6); `is-error` shake + red dots; `is-locked` (disabled keys); Delete removes last; Enter submits and clears; PIN never rendered; always LTR | `pos-pin`, `pos-pin__dots`, `pos-pin__dot`, `is-filled`, `pos-pin__keys`, `pos-pin__key`, `pos-pin__key--fn` | stock sign-in; 02 staff login |
| **StaffTiles** | `staff: { staff_id, display_name, locked? }[]`, `selectedId`, `onPick(id)` | selected (`aria-pressed`, accent underline); locked (`is-locked`, disabled, dashed). The kit supports a `<small>` second line on a tile (e.g. "Locked · 14 min"); **the component does not render one today** | `pos-staff`, `pos-staff__tile`, `is-locked` | stock sign-in; also reused (as markup, not the component) for the owner branch picker |
| **QuantityInput** | `unit: 'piece' \| 'g' \| 'ml'`, `value: number \| null` (smallest unit), `onChange(value \| null)` | shows pieces / kg / L text beside the input; `inputmode` numeric for pieces, decimal for kg/L; invalid → `pos-field--error`, `aria-invalid`, error text; empty → `null`; follows a new value/unit from the parent unless the typed text already means it | `pos-field`, `pos-row pos-ltr`, `pos-input pos-input--mono`, `pos-field__error` | stock On hand and Add; item form Low stock alert |

Screen-local pieces a redesign may turn into shared components (they live inside a feature file today):

| Piece | Where | What it does |
|---|---|---|
| `TextCommitField`, `SortField` | `owner/floors/FloorsView.tsx` | input that saves on blur, reverts on refusal |
| `CommitField<T>`, `Select<T>` | `owner/stations/StationsView.tsx` | labelled blur-save input; labelled select |
| `Select`, `TextField` | `owner/menu/ItemForm.tsx` | labelled select / input for forms |
| `WindowsField` | `owner/menu/WindowsField.tsx` | Available hours rows (2.8); `MAX_WINDOWS = 4` |
| `BranchPicker`, `Nav` | `owner/BranchPicker.tsx`, `owner/App.tsx` | 2.2 |
| `ConfigStatus`, `BusinessDayBar`, `StalePrompt`, `StartDay`, `AlertBar`, `StockTable`, `rowBadges` | `admin/stock/*` | 3.3–3.8 |

---

## 5. Hard constraints

### 5.1 Technology

- **React 19 + Vite 8**, TypeScript, function components. Dependencies are `react`, `react-dom` and our own `@pos/*` packages. **No new dependencies**: no component library, no icon font, no router, no date picker, no drag-and-drop, no state library, no animation library.
- **UI kit only** (`packages/ui-kit`: `tokens.css` + `components/bundle.css`). **No `style` prop, no other stylesheet, no CSS framework** (no Tailwind, no CSS modules, no CSS-in-JS). The pages are sent with `Content-Security-Policy: default-src 'self'`, which also blocks inline styles. Classes go on plain HTML elements.
- No `dangerouslySetInnerHTML` (an item name could carry a script; the owner's token is in `sessionStorage`).
- Icons are inline SVG from the kit README's icon table (24 px grid, 2 px stroke, `currentColor`, always next to a word).

### 5.2 If the kit is missing something

The kit today has: banner, button (primary, danger, lg, block), card, code/QR, dialog + scrim, field (label, help, error), input (+ mono), select, pin pad, staff tiles, full-screen state, stack, row, steps, icon, and type styles (`display`, `title`, `heading`, `body-lg`, `body`, `label`, `caption`, `value-mono`, `code-inline`, `code-display`, `ur-*`). It has **no** page header/app bar, nav/tabs, list or table row, switch/toggle, segmented control, badge/chip, checkbox style, toast, empty state, skeleton, sticky footer/action bar, or page-width layout.

A redesign that needs one of these **specifies it as a new kit class**: name (`pos-…` BEM like the rest), anatomy, every state, and token-only values (colours, spacing, radii, type from `tokens.json`; no new raw colours). We add it to the kit (a module 00 change, reviewed separately) and then use it. It must not be page-specific.

### 5.3 Hub is offline

- `/admin/stock` is served by the hub over **plain HTTP on the LAN, often with no internet**. Nothing loads from outside: **no CDN, no Google Fonts, no remote images, no maps**. Fonts (Atkinson Hyperlegible, Atkinson Hyperlegible Mono, Noto Nastaliq Urdu) are bundled from `packages/ui-kit/fonts`.
- No camera, clipboard, notifications, service worker or anything else that needs HTTPS.
- Losing the hub is normal (power cuts, Wi-Fi). Show a calm reconnecting state, keep what is on screen and what was typed, retry quietly. Never a blank page.
- The owner app is on the internet but has **no offline mode**: show the error, keep the form.

### 5.4 Language and direction

- **Every visible string is a key** in `src/i18n/` with English text; Urdu comes later. No text inside images or SVG.
- **RTL-ready:** the layout must mirror for Urdu (`dir="rtl"`). Use logical directions only (start/end, not left/right). Urdu (Nastaliq) needs about 2× line height and runs wider: **no fixed heights on anything that holds text**.
- **Latin digits** in both languages. These never mirror (wrap in `.pos-ltr` or a mono style): prices, quantities, PINs and the PIN pad, times, dates, branch IDs, version numbers.

### 5.5 Size, touch and use

- **Touch targets ≥ 56 px** (`--touch-min`), at least `space-3` apart. 72 px (`--touch-kitchen`) for anything used standing at a kitchen counter.
- **No hover-only, double-tap, long-press-only or swipe-only actions**; everything works by one tap and by keyboard (the kiosk has a keyboard, no browser back).
- **Kitchen use:** the stock page is used standing, in a hurry, sometimes with wet or greasy hands, at arm's length, under bright light. Body text ≥ 17 px (20 px on tablet/kiosk); nothing a manager must read is caption-sized.
- **Screens from 360 px phones to a 1920 px kiosk**, portrait and landscape tablets. No horizontal scrolling at 360 px. Owner app: laptop first, must work on a phone. Stock page: tablet and kiosk first, must work one-handed on a phone.
- Light theme on both surfaces. One primary button per screen. Status always with an icon **and** a word; `ok` is blue, not green.
- Motion: spinner, reconnect icon and PIN shake only; off under `prefers-reduced-motion`.

### 5.6 Behaviour that is fixed by the spec

A redesign may change layout, wording, grouping, order of steps and which controls are visible when; it may **not** change these without a spec change (tell us; we change the spec first):

- The API: fields, units stored (integers in smallest units, `_ms` times, paisa), error codes, which call each action makes. Floors/stations are per branch; tax classes, categories and items are per restaurant.
- Archive, never delete (S22). Ordering by sort number, no drag (§8.1).
- Prices typed in rupees with commas allowed; minutes typed (with up to 2 decimals); kg/L up to 3 decimals; HH:MM 24 h times; up to 4 hours rows.
- "No tax" is the default tax (S34). Cook fresh is the default out-of-stock behaviour (S32). Keeps overnight is off by default (S41).
- Read-only menu when `can_edit_tenant` is false, with one info line (S8).
- Stock page: Save counts sends touched rows as one command; Add sends one row at once (S45); Start day is one tap with no confirmation, Close day has a confirmation (S33); the stale prompt's two choices; a 15 s refresh with no manual "get changes" button (S24); all times from the hub clock, never the device's.
- Texts the spec quotes word for word (§8.2: the day line, the Close day confirmation, the stale prompt, the status line and problem banners, "Takes effect when the next business day starts…") are spec text. Better wording is welcome; mark it, and we route it through a spec bump.

---

## 6. How a redesign must come back

For **each screen and dialog** in §2 and §3 (and any new one), deliver:

### 6.1 Frames

- Phone 360 px and tablet/kiosk 1280 px (owner app: laptop 1440 px and phone 360 px). One frame in **Urdu RTL** for each screen (placeholder Urdu text is fine; it tests the mirroring and the line height).
- **Every state** listed in that screen's section: loading, empty, saving/slow (with the 3 s banner), each error, read-only, offline / hub unreachable, no business day, stale day, out of hours, signed out. A state you decide to drop: say why.
- The main flow as numbered steps with the tap count, next to today's count from this brief.

### 6.2 Component tree with kit class names

A nested list per screen, each node naming the HTML element, its kit classes, the string key it shows, and the existing component it maps to (or "new kit class" from §5.2). Example:

```
main.pos-root.pos-screen--page                          [new kit class: page layout]
  header.pos-appbar                                     [new kit class]
    h1.title            "Stock"                          admin_stock.title
    p.caption           status line                      → ConfigStatus
  Banner tone=danger    problem text                     → Banner (admin_stock.problem.*)
  section.pos-card      day line + Close day             → BusinessDayBar
    BusyButton          "Close day"                      admin_stock.day.close
  ul.pos-list                                            [new kit class: list row]
    li.pos-list__row    one item                         → StockTable row
      strong.label      item name                        (data)
      QuantityInput     On hand                          admin_stock.on_hand
      …
  footer.pos-actionbar                                   [new kit class: sticky action bar]
    BusyButton primary  "Save 12 counts"                 admin_stock.save_n (NEW)
```

Rules for the tree: only kit classes (existing or proposed in §5.2), no inline styles, no class invented per screen; each interactive node lists its states (disabled, busy, pressed, error); each number/time/ID node notes `.pos-ltr` or mono.

### 6.3 String table

One table for the whole redesign, `key → English`, in the shape of `src/i18n/en.ts`:

| Key | English | Status | Placeholders | Notes |
|---|---|---|---|---|
| `admin_stock.save` | Save counts | kept | — | |
| `admin_stock.save_n` | Save {count} counts | **new** | `{count}` | replaces `admin_stock.save` when ≥ 1 row touched |
| `admin_stock.problem.rejected` | Menu changes from the owner could not be used. | **changed** (spec text) | — | drops the raw reason |
| `owner.common.sort_order` | — | **removed** | | |

- Keep existing keys where the meaning is the same; new keys follow the same namespaces (`owner.*`, `admin_stock.*`, `common.*`, `errors.<CODE>`).
- Placeholders are `{name}` (filled by `fill()`); no string concatenation of sentence fragments (today's status line glues " · checked …" onto "Menu version …"; Urdu word order needs whole sentences).
- Give a text for **every** error code a screen can show (§7), including the ones that fall back to "Something went wrong" today.
- Mark every string the spec quotes (§5.6) as "spec text".

### 6.4 Mapping to existing components

A short table per screen: each part of the design → the existing component or helper it reuses (§4: `Banner`, `BusyButton`, `PinPad`, `StaffTiles`, `QuantityInput`, `WindowsField`, `parseRupees`, `parseMinutes`, `parseQuantity`/`formatQuantity`, `hubTimeText`/`hubDayText`), what changes in its props (e.g. "StaffTiles: add optional `note` per tile for 'Locked · 14 min'"), or "new". A changed shared component must keep working for 02's staff login.

### 6.5 Interaction notes

For anything that is not obvious from a frame: what happens on tap, on Enter, on blur, on refresh while typing, on a 409 or a network loss mid-action, and where focus goes after a dialog closes or a save finishes.

---

## 7. Appendix: error codes and today's texts

Texts from `src/i18n/en.ts`. "—" means no text today, so the page shows `errors.UNKNOWN` "Something went wrong. Try again."

### Owner app (cloud)

| Code | Can appear on | Today's text |
|---|---|---|
| `LOGIN_INVALID` | 2.1 | Email or password is wrong. Check them and try again. |
| `LOGIN_LOCKED_OUT`, `IP_LOCKED_OUT` | 2.1 (reserved) | Too many tries. Wait a few minutes, then try again. |
| `JWT_INVALID` | any | not shown: refresh once, then Sign in |
| `VALIDATION_FAILED` (and page checks) | every form | Check the fields and try again. |
| `CONFIG_NAME_TAKEN` | 2.3–2.7 | That name is already used. Choose another name. |
| `CONFIG_IN_USE` | archive, station type change | Still in use. Archive or move what uses it first. |
| `CONFIG_REFERENCE_INVALID` | tables, items, routes | Something it points to is archived or missing. Choose another one. |
| `IDEMPOTENCY_KEY_MISMATCH` | every Add/New | This form was already saved with other values. The list is reloaded; check it before adding again. |
| `PERMISSION_DENIED` (`tenant_wide_write`) | 2.5–2.7 | Only an owner of every branch can change this. |
| `BRANCH_NOT_FOUND`, `FLOOR_NOT_FOUND`, `TABLE_NOT_FOUND`, `PROGRAM_NOT_FOUND`, `TAX_CLASS_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `MENU_ITEM_NOT_FOUND` | edits of a row deleted/changed elsewhere, a stale tab | — |
| `INTERNAL_ERROR` | any | — |
| network | any | The cloud cannot be reached. Check the internet connection; what you typed is kept. |

### Stock page (hub)

| Code | Can appear on | Today's text |
|---|---|---|
| `PIN_INVALID` | 3.1 | Wrong PIN. Try again. |
| `PIN_LOCKED_OUT` | 3.1 | Too many wrong PINs. Wait, then try again. |
| `DEVICE_LOCKED_OUT` | 3.1 | Too many wrong PINs on this screen. Wait, then try again. |
| `DEVICE_TOKEN_INVALID`, `DEVICE_REVOKED` | 3.1, any | This screen must be paired again. |
| `DEVICE_TYPE_NOT_ALLOWED` | any | This kind of screen cannot do that. |
| `HUB_NOT_PROVISIONED` | any | The hub is being set up. |
| `ADMIN_SESSION_REQUIRED`, `SESSION_EXPIRED` | any | not shown: back to 3.1 (typed values lost) |
| `PERMISSION_DENIED` | 3.2–3.9 | You do not have permission for this. Ask a manager. |
| `BUSINESS_DAY_NOT_OPEN` | Save counts, Add | not shown as text: the retry Start day card, "The business day is not open, so this was not saved. Start the day to save it." |
| `STOCK_NOT_TRACKED` | Save counts, Add (menu changed under the page) | — |
| `MENU_ITEM_NOT_FOUND` | any row command (item removed from the branch) | — |
| `VALIDATION_FAILED` | any command | Check the fields and try again. |
| `IDEMPOTENCY_KEY_MISMATCH`, `INTERNAL_ERROR` | any command | — / — |
| network | any | The hub cannot be reached. Check the Wi-Fi; what you typed is kept. (and the Reconnecting banner) |
| command answers that are not errors | Close day: `opened_recently` | This day was started less than {hours} h ago; nothing changed. |
