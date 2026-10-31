# 01a · Restaurant Setup — Brief

Sources used: spec `docs/specs/01_Restaurant_Setup_Spec_v2.0.md` (APPROVED; v1.3.1 is what is built), design hand-off `docs/design/handoff/01a/` (`01a-design.md`, frames in `frames/*.dc.html`, screenshots of the built pages in `screens/*.png`), inventory `docs/design/inventory/01a-setup.md`, open questions `docs/design/open-questions/01a-setup.md`, and the 01b hand-off frames that change 01a screens (`docs/design/handoff/01b/screens/StockCounter*.html`, `StockRosterCounts.html`, `BranchPickerNamed.html`). Frame names without a folder are in `docs/design/handoff/01a/frames/`; `.png` names are in `docs/design/handoff/01a/screens/`.

**Important:** spec v2.0 (approved 2026-10-29, with 01c Menu v1.0) changes the item form and the stock page in ways **no 01a frame shows yet** (see §6, items 1–2). This brief describes the existing designs and marks where v2.0 differs.

Sample data (mock, never hard-code): branches Gulberg (`…P0AB`), Johar Town (`…M6PQ`), DHA (not open yet); Chicken Karahi Rs 2,200/kg; Paye Rs 450 (sold out when gone, keeps overnight, 07:00–13:00); Naan Rs 30; Lassi Rs 250 a glass (300 ml, counted in L); Seekh Kebab pieces; stations Tandoor, Karahi counter, Degh (batch); owner `arif@arifchatkhara.pk`; manager Imran.

---

## 1. Module summary

**What it is for.** 01a is where the restaurant is described to the system: floors and tables per branch, kitchen stations and their batch recipes, and the shared menu (tax rates, categories with hours, items with price, cooking time, stock rules and the station that cooks them at each branch). It also has the one hub page used every day: the stock page, where a manager starts the business day, enters the morning counts of ready-made food, adds fresh batches, switches items off and closes the day.

**Who uses it, where, how often**

| Surface | Who (permission) | Device | How often |
|---|---|---|---|
| Owner app `/owner/` (cloud) | Owner (cloud email + password; tenant-wide edits need an owner covering every branch, `can_edit_tenant`) | Laptop 1440; owner phone 390 for a quick price change | Heavy once at setup (~100 items, 3 floors, 6 stations per branch); then a few edits a week (weekly) |
| Hub stock page `/admin/stock` | Staff with `access-hub-admin` + `manage-stock` (branch manager, shift lead, owner on site; scope `branch` or `my_stations`) | Counter tablet 1280, cashier kiosk 1280 (tablet layout centred), manager's phone 390 | Daily: morning count (~30 items), top-ups during rush, items off, close day at night |

**Rules that apply everywhere**
- **Owner app permissions.** Owner only (no staff PIN). Floors/tables/stations: any owner with that branch. Menu, tax rates, categories: only an owner who covers every branch; otherwise the menu opens read-only (01a-B01). A `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` shows the `errors.PERMISSION_DENIED` text.
- **Owner app has no offline mode.** Every read and write needs the internet. On a network failure or `503`: warn pulsing banner (01a-B04), values kept on the page, Save disabled until a read succeeds (probe 0.5 → 5 s). The app never re-sends a failed write by itself. `503` never sends the owner to sign-in.
- **Owner session.** JWT + refresh token in `sessionStorage` (cleared when the tab closes). `401 JWT_INVALID` → refresh once → sign-in page. `403 PASSWORD_CHANGE_REQUIRED` (01b) → forced change password page (01b-S09).
- **Stock page permissions.** Needs an admin session on a paired hub device (same sign-in as 00). Under `manage-stock` scope `my_stations` the page shows only the person's stations and hides Start day, Close day and the stale-day prompt (01b change).
- **Stock page hub down.** Reconnect banner; typed counts kept; Save waits for the hub. The page polls every 15 s (no WebSocket for admin sessions); a row being edited is never overwritten; polling does not keep an idle session alive.
- **Language.** English and Urdu (RTL), picked like module 00: `?lang=` → `localStorage pos-lang` → `navigator.language`. Prices, numbers, IDs, emails, times and units stay LTR. Branch names wrapped so an Urdu name never mirrors a line. Only two Urdu frames exist (menu and stock page).
- **Branch scoping.** Floors, tables and stations belong to one branch (branch select in their app bars). The menu is shared by every branch and needs no branch (each item has one row per branch for station, recipe and optional "Price here"). The stock page shows the hub's own branch only.
- **Changes reach the hubs** on the next hub poll, "within a minute".
- **One primary button per screen.** Busy button + "Still working…" banner after 3 s on every save.
- **Each creating POST** carries an `Idempotency-Key` generated when the form opens and kept for its retries.

**Links to other modules**

| From | To | Why |
|---|---|---|
| 01a-S01 Owner sign in | 01b-B01 lock notice, 01b-S09 forced password | After sign-in |
| 01a-S02 owner shell side nav | 01b-S01 Staff, S03 Roles, S10 Teams, S05 Stock counting, S06 Branches, S09 Change password; 01c Options/Deals; 05 Payments | Nav items added by later modules |
| 01a-S02 branch picker | 01b-S06 branch names (`GET /v1/admin/branches`) | Names instead of ID tails |
| 01a-S04 stations | 00-S08 Approve form station tiles; 03b KDS; 03a-S01 live capacity | Stations used there |
| 01a-S03 tables | 02-S03 table picker | Tables per floor |
| 01a-S07 item | 02-S05 order screen, 01c-S01… variants/modifiers/deals | Items, prices, windows, routes |
| 01a-S10 stock sign-in | 00-S07 (same roster + PIN pad), 00-F02 / 00-F06 | Shared sign-in |
| 01a-S10/S11 | 00-S20 Hub admin home ("Stock" item) | Stock page lives in the hub admin shell |
| 01a-S11 stock page | 01b-S05 Stock counting (who counts which station), 01b-S07 branch settings (`day_stale_after_hours`, `day_min_gap_hours`) | Scope and day guards |
| 01a-B10 menu status | "The owner can fix it in Restaurant setup" → owner app | Config problems |
| 01a-S11 Selling switch | 02-B05 "Sold out" on ordering screens (≤ 5 s) | Availability |

---

## 2. Screen list

| Screen ID | Name | Device | Who uses it | How often | Used during rush? | Existing frame file name(s) |
|---|---|---|---|---|---|---|
| 01a-S01 | Owner sign in | Laptop 1440 (phone 390) | Owner | Weekly | no | `OwnerLogin`, `OwnerLoginCloudDown`; `owner-login-en-1440.png`, `owner-login-ur-1440.png` |
| 01a-S02 | Branch picker + owner app shell | Laptop 1440, phone 390 | Owner | Weekly | no | `OwnerBranchPicker`; 01b `BranchPickerNamed.html`; `owner-branches-en-1440.png`, `owner-branches-ur-1440.png` |
| 01a-S03 | Floors and tables | Laptop 1440 | Owner | Once, then rare | no | `OwnerFloors`, `OwnerFloorsEmpty`, `OwnerFloorsArchived`, `OwnerTableDialog`; `owner-floors-en-1440.png`, `owner-floors-ur-1440.png`, `owner-floors-first-en-1440.png`, `owner-floors-first-ur-1440.png` |
| 01a-S04 | Kitchen stations and batch recipes | Laptop 1440 | Owner | Once, then rare | no | `OwnerStations`, `OwnerAddStation`, `OwnerAddRecipe`; `owner-stations-en-1440.png`, `owner-stations-ur-1440.png` |
| 01a-S05 | Menu (Items · Categories · Tax rates) | Laptop 1440, phone 390 | Owner | Weekly | yes (phone price change) | `OwnerMenu`, `OwnerMenuCategories`, `OwnerMenuTax`, `OwnerTaxDialog`, `OwnerMenuReadOnly`, `OwnerMenuNoMatch`, `OwnerMenuLoading`, `OwnerMenuFirstRun`, `OwnerMenuPhone`, `OwnerMenuUrdu`; `owner-menu-*.png` (en/ur, 1440/390, categories, tax, firstrun, nomatch, readonly) |
| 01a-S06 | Category form (dialog) | Laptop 1440 | Owner | Rare | no | `OwnerCategoryDialog` |
| 01a-S07 | Item form (new / edit) | Laptop 1440, phone 390 | Owner | Weekly | yes (phone price change) | `OwnerItem`, `OwnerItemNew`, `OwnerItemErrors`, `OwnerItemPartial`, `OwnerItemCloudDown`, `OwnerItemPhone`; `owner-item-en-1440.png`, `owner-item-ur-1440.png`, `owner-item-en-390.png`, `owner-item-ur-390.png` |
| 01a-C01 | Available hours field | Laptop 1440 | Owner | Rare | no | `OwnerCategoryDialog`, `OwnerItemErrors` |
| 01a-B01 | Read-only menu line | Laptop 1440 | Owner without every branch | Rare | no | `OwnerMenuReadOnly`; `owner-menu-readonly-*.png` |
| 01a-B02 | Unit-change warning | Laptop 1440 | Owner | Rare | no | `OwnerItem` (aside) |
| 01a-B03 | Partial save | Laptop 1440 | Owner | Rare | no | `OwnerItemPartial` |
| 01a-B04 | Cloud unreachable | Laptop 1440, phone 390 | Owner | Rare | yes | `OwnerLoginCloudDown`, `OwnerItemCloudDown` |
| 01a-D01 | Archive confirm / blocked | Popup 720 | Owner | Rare | no | `OwnerArchiveItem`, `OwnerArchiveCategory`, `OwnerArchiveFloor`, `OwnerArchiveStation` |
| 01a-D02 | Discard changes? | Popup 720 | Owner | Rare | no | `OwnerDiscard`; `owner-discard-en-1440.png`, `owner-discard-ur-1440.png` |
| 01a-S10 | Stock — PIN sign-in | Tablet 1280 (phone 390, kiosk) | Manager / stock counter | Daily | yes | `StockPin`, `StockPinError`, `StockPinNobody`, `StockPinOffline`; 01b `StockRosterCounts.html`; `stock-pin-*.png` |
| 01a-S11 | Stock page | Tablet 1280, phone 390, kiosk | Manager / stock counter | Daily, many times | yes | `Main`, `StockPhone`, `StockAddSheet`, `StockUrdu`, `StockFeedback`, `StockOffline`, `StockNoDay`, `StockStale`, `StockCloseDay`, `StockMenuProblem`, `StockNotSaved`, `StockOpenedRecently`, `StockNoMatch`, `StockConfirmAll`, `StockCountsKept`; 01b `StockCounter.html`, `StockCounterNotStarted.html`, `StockCounterOutside.html`; `stock-main-*.png`, `stock-add-sheet-*.png`, `stock-close-day-*.png`, `stock-menu-problem-*.png`, `stock-noday-*.png`, `stock-stale-*.png` |
| 01a-B10 | Menu status line + problem banner | Tablet 1280 | Manager | Daily (glance) | yes | `Main`, `StockMenuProblem` |
| 01a-B11 | Business day line | Tablet 1280 | Manager | Daily | yes | app bar of every stock frame, `StockStale` |
| 01a-D10 | Close day confirm | Tablet 1280 | Manager | Daily (night) | no | `StockCloseDay` |
| 01a-B12 | Stale-day prompt | Tablet 1280 | Manager | Rare | no | `StockStale` |
| 01a-B13 | Start day card / not-saved retry | Tablet 1280 | Manager | Daily (morning) | yes | `StockNoDay`, `StockNotSaved` |
| 01a-B14 | Low / out alert bar | Tablet 1280 | Manager | Daily | yes | `Main` |
| 01a-B15 | Row badges | Tablet 1280 | Manager | Daily | yes | `Main`, `StockStale`, `StockConfirmAll` |
| 01a-B16 | Reconnecting to the hub | Tablet 1280 | Manager | Rare | yes | `StockOffline` |
| 01a-B17 | Save result per row and in the action bar | Tablet 1280 | Manager | Daily | yes | `StockFeedback` |
| 01a-B18 | Day started less than N h ago | Tablet 1280 | Manager | Rare | no | `StockOpenedRecently` |

---

## 3. Screens

### 01a-S01 · Owner sign in
- **Job:** the owner signs in to the setup app.
- **Entry points:** `/owner/` (`#/login`); any expired session (failed refresh).
- **Exits:** success → 01a-S02 (or `#/menu` with one branch). Lock notice after sign-in → 01b-B01 on the next screen. Must change password → 01b-S09 forced mode.
- **Information shown:**

| Item | Mark |
|---|---|
| Aside: POS mark; headline "Set up your restaurant once. Every branch follows."; line "Menu, prices, kitchen stations and tables. Changes reach each branch within a minute."; caption "Restaurant setup · owners only" | USEFUL |
| Heading "Sign in" + "Use the owner email you registered with." | MUST |

- **Actions:** **Sign in** (large, full width) — PRIMARY → `POST /v1/auth/login` (Enter submits); **Show** (password) — SECONDARY.
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Email (`email`) | type email, `autocomplete=username`, LTR | empty | required, trimmed | empty field marked before sending (text UNKNOWN) |
| Password (`password`) | password with Show button | empty | required | empty field marked before sending (text UNKNOWN) |

- **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | open | form | as above | `owner-login-en-1440.png` |
| Busy | tap Sign in | button busy | "Signing in…" | `OwnerLoginCloudDown` |
| Slow | busy > 3 s | slow banner | "Still working…" | none |
| Wrong email or password | `LOGIN_INVALID` (also an expired temporary password, and `LOGIN_LOCKED_OUT`/`IP_LOCKED_OUT`, which are reserved and answered as 401) | danger banner | "Email or password is wrong" / "Check both and try again." | `OwnerLogin` |
| Empty field | client check / `VALIDATION_FAILED` | field marked | UNKNOWN | none |
| Cloud down | network / 503 | warn banner; values kept; Sign in stays enabled | "Can't reach the restaurant cloud." / "Check the internet. What you typed is kept; tap Sign in again." | `OwnerLoginCloudDown` |
| Urdu RTL | Urdu | mirrored | UNKNOWN in frames (screenshot only) | `owner-login-ur-1440.png` |

- **Error codes:** `LOGIN_INVALID`, `VALIDATION_FAILED`, `SERVICE_UNAVAILABLE`.
- **Edge cases:** no "Forgot password" link (01b-S09 says "Call support"); the owner learns of a lock only from 01b-B01.
- **Data needed:** writes `email`, `password`; reads JWT, refresh token, `allowed_branch_ids`, `display_name`, `must_change_password`, `lockout_notice`.

### 01a-S02 · Branch picker + owner app shell
- **Job:** pick the branch to set up; reach Menu, Floors, Stations (and 01b pages).
- **Entry points:** after sign-in (`#/`); app bar branch select on Floors/Stations.
- **Exits:** **Continue with {branch}** → Floors and tables (UNKNOWN which page is the default after the picker); **Open the menu** → `#/menu` (no branch needed); **Sign out** → `POST /v1/auth/logout` → 01a-S01. One branch → picker skipped, `#/menu` opens.
- **Information shown:**

| Item | Mark |
|---|---|
| Title "Which branch are you setting up?" | MUST |
| "Floors, tables and kitchen stations belong to one branch. You can switch any time from the top of the page." | USEFUL |
| Branch tiles: name (from `GET /v1/admin/branches`; ID tail "…P0AB" in mono until it answers or if it fails) | MUST |
| Tile small line "2 floors · 3 stations" (frame) — not built (API has no counts) | RARE |
| 01b frame: DHA tile "Not open yet" | USEFUL |
| Note "Branch names show once they are set in Branch settings. Until then the end of each branch's ID shows." (removed once names exist) | RARE |
| Callout "Menu is the same for every branch" / "Items, categories, prices and tax need no branch." + link "Open the menu" | USEFUL |
| Shell: side nav brand "Arif Chatkhara / Restaurant setup"; items Menu (count) · Floors and tables · Kitchen stations (01b adds People: Staff · Roles · Teams · Stock counting; Branches: Branches and settings); foot owner email (as built: `display_name`) + Change password (01b) + Sign out | MUST |

- **Actions:** **Continue with {branch}** — PRIMARY; branch tile — SECONDARY; **Open the menu** — SECONDARY; **Sign out** — SECONDARY.
- **Inputs:** branch tile pick (default: none; UNKNOWN whether one is preselected).
- **Decisions:** which branch.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default (ID tails) | names not loaded | tiles show ID tail + note | as above | `OwnerBranchPicker`, `owner-branches-en-1440.png` |
| Named | `GET /v1/admin/branches` answered | names; note gone | "Gulberg" / "Johar Town" / "DHA" "Not open yet" / "Continue with Gulberg" | 01b `BranchPickerNamed.html` |
| One branch | one allowed branch | picker skipped | — | none |
| Choice kept | reload in same tab | branch restored from `sessionStorage` | — | none |
| Phone shell | width ≤ 760 | app bar **Menu** button opens the side menu as an overlay (v1.3.1; frames still show a bottom tab bar "Menu · Floors · Stations") | — | `OwnerMenuPhone` (outdated) |
| Cloud down | network | 01a-B04 | — | none |
| Urdu RTL | Urdu | mirrored | nav: "عارف چٹخارہ" · "ریسٹورنٹ سیٹ اپ" · "مینیو" · "فلور اور میزیں" · "کچن اسٹیشن" · "سائن آؤٹ" | `owner-branches-ur-1440.png`, `OwnerMenuUrdu` (nav) |

- **Error codes:** `BRANCH_NOT_FOUND`, `JWT_INVALID`.
- **Edge cases:** reload keeps the branch per tab; a branch name in Urdu must not flip the line.
- **Data needed:** `allowed_branch_ids`; `GET /v1/admin/branches` → `branch_id, name, status`.

### 01a-S03 · Floors and tables
- **Job:** create and arrange floors and their tables for one branch.
- **Entry points:** side nav "Floors and tables"; first-run checklist; branch picker.
- **Exits:** stays on the page; table tile → table dialog; Archive floor → 01a-D01; leaving with unsaved changes → 01a-D02.
- **Information shown:**

| Item | Mark |
|---|---|
| App bar: title "Floors and tables", "Branch" select (Gulberg / Johar Town) | MUST |
| Floor section head: name + "{n} tables · {n} seats" | MUST |
| Table tiles: name (mono) + "{n} seats" | MUST |
| Archived floor (Show archived on): sunken section, chip "Archived", "Archived {date} · {n} tables · waiters can't pick it" | RARE |
| "Saved" chip for 3 s near what changed | USEFUL |

- **Actions:**

| Action | Mark | Result |
|---|---|---|
| **Add floor** (app bar) | PRIMARY | add-floor dialog (as built) |
| **Add tables** tile → bulk row → **Add {n} tables** | SECONDARY | one POST per table; progress "Adding {i} of {n}…" |
| Table tile | SECONDARY | table dialog |
| **Rename** (floor) | SECONDARY | inline name + position, saved on blur |
| **Archive** (floor) | DESTRUCTIVE | 01a-D01 |
| **Restore** (archived floor) | RARE | PATCH `archived: false` |
| **Show archived** switch | RARE | shows archived floors |
| Table dialog: **Save table** (PRIMARY in dialog), **Cancel**, **Archive** (DESTRUCTIVE, immediate with "Archived · Undo" chip 8 s) | — | PATCH table |

- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Floor name (`name`) | text | empty ("Ground floor" sample) | 1–60, unique per branch | `CONFIG_NAME_TAKEN` → "{name} is already used at {branch}. Pick another name." |
| Floor position (`sort_order`) | integer | UNKNOWN | integer (may be negative) | field error (text UNKNOWN) |
| Bulk: From / To (first / last table name) | text, mono | empty ("F9" / "F12") | names checked against the branch before sending | stops on the first error and names it |
| Bulk: Seats each / Seats per table (optional) | number | empty; help "Leave empty if it varies." | 1–100 | UNKNOWN |
| Table name (dialog) | text, mono; help "What waiters tap. Short is best." | current | 1–60, unique per branch | "T7 is already used at Gulberg. Pick another name." |
| Seats (dialog) | number; help "Leave empty if it varies." | current | 1–100, optional | UNKNOWN |
| Floor (dialog) | select (Ground floor / Family hall) | current | — | — |
| Position (dialog) | integer; help "1 shows first on the floor." | current | integer | UNKNOWN |

- **Decisions:** floor names and order; table names and seats; move a table to another floor; archive.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | floors loaded | sections with tiles | as above | `OwnerFloors`, `owner-floors-en-1440.png` |
| Loading | fetching | skeleton (as `OwnerMenuLoading`) | — | none |
| First floor (empty) | no floors | one form: floor + bulk tables | "Add your first floor" / "Name the floor, then add its tables in one go. You can rename or add more later." / "Floor name" / "Seats per table (optional)" / "Leave empty if it varies." / "First table" / "Last table" / "Adds 12 tables: T1, T2 … T12, 4 seats each. Parking is not a table; it has its own order type." / button "Add floor and 12 tables" | `OwnerFloorsEmpty`, `owner-floors-first-en-1440.png` |
| Bulk add open | Add tables tile | inline row | "From" / "To" / "Seats each" / "Adds 4 tables: F9, F10, F11, F12" / "Cancel" / "Add 4 tables" | `OwnerFloors` |
| Adding | bulk loop | button progress | "Adding {i} of {n}…" | none |
| Saved | save succeeded | ok chip 3 s | "Saved" | `OwnerFloorsArchived` |
| Show archived | switch on | archived floor section | "Archived 3 Oct · 6 tables · waiters can't pick it" / "Archived" / "Restore" | `OwnerFloorsArchived` |
| Name taken | `CONFIG_NAME_TAKEN` | field error | "T7 is already used at Gulberg. Pick another name." | `OwnerFloorsArchived` |
| Table dialog | tile tapped | dialog | "Edit table T7" / "Table name" / "What waiters tap. Short is best." / "Seats" / "Leave empty if it varies." / "Floor" / "Position" / "1 shows first on the floor." / "Archive this table" / "Waiters can't pick it. An open order on it can still be billed." / "Archive" / "Cancel" / "Save table" | `OwnerTableDialog` |
| Table archived | Archive in dialog | undo chip 8 s | "Archived · Undo" | none |
| Floor blocked | `CONFIG_IN_USE` | 01a-D01 blocked | see 01a-D01 | `OwnerArchiveFloor` |
| Out of date | `IDEMPOTENCY_KEY_MISMATCH` | banner | "This page is out of date. Reload." | none |
| Removed meanwhile | `*_NOT_FOUND` | banner + refetch | "Someone removed this. The page is refreshed." | none |
| Bad reference / validation | `CONFIG_REFERENCE_INVALID`, `VALIDATION_FAILED` | field error | UNKNOWN text | none |
| No permission | `PERMISSION_DENIED` | read-only line | UNKNOWN text | none |
| Cloud down | network | 01a-B04 | see 01a-B04 | none |
| Urdu RTL | Urdu | mirrored | UNKNOWN in frames | `owner-floors-ur-1440.png`, `owner-floors-first-ur-1440.png` |

- **Error codes:** `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `CONFIG_REFERENCE_INVALID`, `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_MISMATCH`, `PERMISSION_DENIED`, `FLOOR_NOT_FOUND`, `TABLE_NOT_FOUND`, `BRANCH_NOT_FOUND`.
- **Edge cases:** parking spots are not tables; ~12–20 tables per floor; bulk add stops on the first error; no drag and drop (sort number); no 2-D canvas, table shape or position (dropped by the spec).
- **Data needed:** `GET /v1/admin/branches/:b/floors` (floors with tables: `name, sort_order, seats, archived_at, floor_id`); `POST/PATCH …/floors[/:id]`, `POST/PATCH …/tables[/:id]` (`name`, `sort_order`, `seats`, `floor_id`, `archived`).

### 01a-S04 · Kitchen stations and batch recipes
- **Job:** describe each kitchen station so cooking times are real.
- **Entry points:** side nav "Kitchen stations"; first-run checklist.
- **Exits:** stays; Add station / Add recipe dialogs; archive → 01a-D01; "Open these items" → menu (unfiltered as built).
- **Information shown:**

| Item | Mark |
|---|---|
| App bar "Kitchen stations" + Branch select | MUST |
| Station row: name + summary "Back left · cooks each order · 12 at a time · cook taps Start and Done" | MUST |
| Open station: "Used by {n} items: …" | USEFUL |
| Batch recipes list: name + "{n} min" | MUST (batch only) |

- **Actions:** **Add station** (app bar) — PRIMARY; **Edit** per station — SECONDARY; **Save station** (open station) — PRIMARY of that section; **Close** — SECONDARY; **Add recipe** — SECONDARY; recipe **Edit** — SECONDARY; recipe archive (immediate + Undo) — DESTRUCTIVE; station archive → 01a-D01 — DESTRUCTIVE (where the button sits is UNKNOWN in frames).
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Name (`name`) | text | empty | 1–60, unique per branch | `CONFIG_NAME_TAKEN` text UNKNOWN for stations |
| Where it is (optional) (`location_label`) | text | empty | 0–60 | — |
| How it cooks (`station_type`) | pick tiles: **One order at a time** ("Tandoor, karahi, grill") = slot / **In batches** ("Degh, fryer basket, a whole pot") = batch | UNKNOWN | locked while items use it | help "Can't change while items use this station."; refused change → blocked dialog |
| Batches / Pots at the same time (`capacity`) | number; help "Two baskets = 2." | UNKNOWN | 1–100 | UNKNOWN |
| A cooked batch/pot stays fresh for (`freshness_window_ms`) | minutes, batch only; help "After that it is not served from this batch. 0 = no limit." | UNKNOWN | 0–60, 2 dp | UNKNOWN |
| Cook marks it done by (`completion_mode`) | segmented: "Start + Done taps (most accurate)" / "One Done tap" / "Itself, when the time is up" | UNKNOWN | — | — |
| Recipe name (program `name`) | text | empty | 1–60, unique per station | UNKNOWN |
| Cooking time (`cook_time_ms`) | minutes; help "Up to 4 hours." | empty | 1 min – 4 h | UNKNOWN |

- **Decisions:** slot or batch; capacity; freshness; how the cook marks done.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | loaded | list, one station open for edit | as above | `OwnerStations`, `owner-stations-en-1440.png` |
| Add station dialog | Add station | dialog | "Add a kitchen station" / "A station is a place where food is cooked: a tandoor, a karahi counter, a degh, a fryer." / "Name" / "Where it is (optional)" / "How it cooks" / "Batches at the same time" / "Two baskets = 2." / "A cooked batch stays fresh for" / "After that it is not served from this batch. 0 = no limit." / "Cook marks it done by" / "Next: add a batch recipe (for example "Fries 6 min"), then pick this station on the menu items it cooks." / "Cancel" / "Add station" | `OwnerAddStation` |
| Add recipe dialog | Add recipe | dialog | "New batch recipe for {station}" / "One fixed cook for a whole pot. Items pick a recipe when they are cooked here." / "Recipe name" / "Cooking time" / "min" / "Up to 4 hours." / "Cancel" / "Add recipe" | `OwnerAddRecipe` |
| Type locked | routes exist | type control disabled + help | "Can't change while items use this station." | `OwnerStations` |
| In use | `CONFIG_IN_USE` on type change or archive | 01a-D01 blocked | see 01a-D01 | `OwnerArchiveStation` |
| Recipe archived | archive | undo chip | "Archived · Undo" | none |
| Saved / loading / name taken / out of date / removed / cloud down | as 01a-S03 | as 01a-S03 | as 01a-S03 | none |
| Recipe gone | `PROGRAM_NOT_FOUND` | banner + refetch | "Someone removed this. The page is refreshed." | none |
| Urdu RTL | Urdu | mirrored | UNKNOWN in frames | `owner-stations-ur-1440.png` |

- **Error codes:** `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `PROGRAM_NOT_FOUND`, `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_MISMATCH`, `PERMISSION_DENIED`, `BRANCH_NOT_FOUND`.
- **Edge cases:** one station open at a time; switching batch → slot archives its recipes; live capacity override is 03a, printers 03b (not here).
- **Data needed:** `GET /v1/admin/branches/:b/stations` (`station_type, capacity, freshness_window_ms, completion_mode, location_label, programs[] {name, cook_time_ms}`); `POST/PATCH …/stations[/:id]`, `…/programs[/:id]`.

### 01a-S05 · Menu (Items · Categories · Tax rates)
- **Job:** find any item fast and manage the shared menu, categories and tax rates.
- **Entry points:** side nav "Menu"; "Open the menu" on the picker; after sign-in with one branch.
- **Exits:** **New item** / **Edit** → 01a-S07; **New category** / category **Edit** → 01a-S06; **New tax rate** → inline add; tax **Edit** → tax dialog; **Archive** → 01a-D01.
- **Information shown:**

| Item | Mark |
|---|---|
| App bar "Menu" + info chip "Shared by every branch" | USEFUL |
| Tabs (segmented) "Items {n} · Categories {n} · Tax rates {n}" (as built: Items count only once every page is loaded; no category/tax item counts) | MUST |
| Items: name; sub line ("Counted in kg · cooked at Karahi counter", "Pre-cooked · keeps overnight", "Group: Chicken Biryani", "Made to order · Tandoor", "Counted in L · one glass is 300 ml") — as built: no sub line | USEFUL |
| Items: category | USEFUL |
| Items: price "Rs 2,200 / kg" (unit "/ plate", "/ piece", "/ glass") | MUST |
| Items: "{n} of {m} branches" (warn when partial) | USEFUL |
| Items: branch price chip "Johar Town Rs 2,300" (neutral chip as built) | USEFUL |
| Items: hours tag "07:00–13:00"; "Sold out when gone" | USEFUL |
| Categories: Order · Category · Hours ("07:00–13:00" / "All day") · Items | MUST |
| Categories help "Order sets where the category shows on the order screen. 1 shows first." | USEFUL |
| Tax: Tax rate · Rate · Items; fixed row "No tax" / "Default for new items" / "0 %" | MUST |

- **Actions:**

| Action | Mark | Result |
|---|---|---|
| **New item** / **New category** / **New tax rate** (per tab, app bar) | PRIMARY | 01a-S07 / 01a-S06 / inline add |
| Search "Find an item" | SECONDARY | `q`, 300 ms after typing, ≤ 60 chars |
| Category filter "All categories" | SECONDARY | `category_id` |
| Active / Archived segmented | RARE | `archived` |
| **Edit** (row) (read-only: **View**) | SECONDARY | 01a-S07 / S06 / tax dialog |
| **Archive** (category, tax rate rows) | DESTRUCTIVE | 01a-D01 (tax: disabled while items use it) |
| **Load more** | SECONDARY | next page (`next_cursor`), 50 a page |
| Inline tax add: **Add tax rate** / **Cancel** | PRIMARY of the inline form / SECONDARY | `POST /v1/admin/tax-classes` |
| Tax dialog: **Save tax rate**, **Cancel**, **Archive** | PRIMARY / SECONDARY / DESTRUCTIVE | `PATCH /v1/admin/tax-classes/:id` |

- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Search | text with search icon | empty | ≤ 60 chars | — |
| New tax rate name / Name | text; help "Staff see this on the bill." | empty | 1–60 (UNKNOWN exact), unique | UNKNOWN |
| Rate | number + "%"; help "Up to 2 decimals, e.g. 16 or 7.5." | empty | ≤ 2 decimals → `rate_bp` | UNKNOWN |

- **Decisions:** which item to change; tax rates.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Items (default) | loaded | list | as above | `OwnerMenu`, `owner-menu-en-1440.png` |
| Loading | fetching | skeleton rows under heads | — | `OwnerMenuLoading` |
| Categories tab | tab | categories list | "Order" / "Category" / "Hours" / "Items" / "Edit" / "Archive" | `OwnerMenuCategories`, `owner-menu-categories-en-1440.png` |
| Tax rates tab + inline add | tab / New tax rate | tax list + add row | "No tax" / "Default for new items" / "New tax rate name" / "Rate" / "Cancel" / "Add tax rate" | `OwnerMenuTax`, `owner-menu-tax-en-1440.png` |
| Tax dialog | Edit tax rate | dialog | "Edit tax rate" / "Name" / "Staff see this on the bill." / "Rate" / "Up to 2 decimals, e.g. 16 or 7.5." / "Used by 31 items" / "The new rate applies to every bill closed after you save, including tables that are open now." / "Archive this tax rate" / "Move its 31 items to another rate first." / "Archive" / "Cancel" / "Save tax rate" | `OwnerTaxDialog` |
| Read-only | `can_edit_tenant` false | 01a-B01 banner; no New buttons; Edit → View | see 01a-B01 | `OwnerMenuReadOnly` |
| First run (empty menu) | no categories/items | 5-step checklist | "Welcome, let's set up your restaurant" / "Five steps. You can come back to any of them later. Each branch gets the changes within a minute." / "Kitchen stations" "3 at Gulberg: Tandoor, Karahi counter, Degh" "Edit" / "Floors and tables" "2 floors, 20 tables" "Edit" / "Categories" "Groups on the order screen, like Breakfast, Karahi, Breads, Drinks." "Add categories" / "Tax rates (optional)" "Skip if you don't charge tax. "No tax" is the default." "Add" / "Menu items" "Needs at least one category." "Add items" | `OwnerMenuFirstRun`, `owner-menu-firstrun-en-1440.png` |
| No match | search with no result | empty block | "No items match "{q}"" / "Check the spelling, or look in Archived." / "Clear search" / "Show archived" | `OwnerMenuNoMatch`, `owner-menu-nomatch-en-1440.png` |
| In use | `CONFIG_IN_USE` | dialog listing the items | see 01a-D01 | none |
| Phone (rush price change) | width 390 | list rows "Naan" "Breads · 2 branches" "Rs 30" "Edit"; app bar "New" (bottom tab bar in frame superseded by Menu button, v1.3.1) | as frame | `OwnerMenuPhone`, `owner-menu-en-390.png` |
| Cloud down | network | 01a-B04 | — | none |
| Urdu RTL | Urdu | mirrored | see below | `OwnerMenuUrdu`, `owner-menu-ur-1440.png`, `owner-menu-ur-390.png` |

  Urdu copy (from `OwnerMenuUrdu`): "مینیو"; "سب برانچوں کا ایک" (shared by every branch); "نیا آئٹم"; tabs "آئٹم" · "کیٹیگری" · "ٹیکس"; search "آئٹم تلاش کریں"; heads "آئٹم" · "کیٹیگری" · "قیمت" · "کہاں بکتا ہے"; rows "چکن کڑاہی" / "کلو میں گنتی · کڑاہی کاؤنٹر" / "کڑاہی" / "/ کلو" / "2 میں سے 2 برانچ" / "ترمیم"; "پائے" / "پہلے سے پکے · رات بھر چلتے ہیں" / "ناشتہ" / "/ پلیٹ"; "نان" / "آرڈر پر · تندور" / "روٹیاں" / "/ عدد"; "لسی" / "لیٹر میں گنتی · ایک گلاس 300 ml" / "مشروبات" / "/ گلاس". Other states: no Urdu.
- **Error codes:** `CONFIG_IN_USE`, `CONFIG_NAME_TAKEN`, `PERMISSION_DENIED` (`tenant_wide_write`), `TAX_CLASS_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `MENU_ITEM_NOT_FOUND`.
- **Edge cases:** 100–5 000 items (50 a page + Load more); Naan 30 → 35 on a phone in ≤ 5 taps; "No tax" row cannot be edited; tax Archive disabled while items use it; rate change applies to bills closed after saving, including open tables.
- **Data needed:** `GET /v1/admin/menu?q&category_id&archived&cursor` → tax classes (`name, rate_bp`), categories (`name, sort_order, availability_windows`), items (`name, group_label, category_id, price_minor, sale_unit, stock_unit, out_of_stock_behaviour, availability_windows, routes[] {branch_id, station_id, price_minor_override}`), `next_cursor`, `can_edit_tenant`.

### 01a-S06 · Category form (dialog)
- **Job:** create or edit a category and its ordering hours.
- **Entry points:** **New category** / **Edit** on the Categories tab.
- **Exits:** Save → Categories tab; Cancel with changes → 01a-D02.
- **Information shown:** title "Edit category" (new: UNKNOWN title) (MUST); note "Every item in {category} follows these hours. An item can narrow them further, never widen them." (USEFUL).
- **Actions:** **Save category** — PRIMARY → `POST /v1/admin/categories` (Idempotency-Key) / `PATCH`; **Cancel** — SECONDARY.
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Category name (`name`) | text | empty | 1–60, unique | UNKNOWN text for `CONFIG_NAME_TAKEN` |
| Position (`sort_order`) | integer; help "1 shows first when ordering." | 0 (inventory) | integer | UNKNOWN |
| When can it be ordered? | 01a-C01 (All day / Only at set hours) | All day | see 01a-C01 | see 01a-C01 |

- **Decisions:** hours for the whole category.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Edit with hours | Edit | dialog with 3 hour rows | "Edit category" / "Category name" / "Position" / "1 shows first when ordering." / "When can it be ordered?" / "All day" / "Only at set hours" / "Add hours (1 more allowed)" / "Cancel" / "Save category" | `OwnerCategoryDialog` |
| Hour errors | see 01a-C01 | — | — | `OwnerCategoryDialog` |
| Busy / cloud down / name taken | save | as other owner forms | UNKNOWN text for name taken | none |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** `CONFIG_NAME_TAKEN`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `CATEGORY_NOT_FOUND`.
- **Edge cases:** a category with active items cannot be archived (as built: blocked dialog lists them).
- **Data needed:** `name`, `sort_order`, `availability_windows`.

### 01a-S07 · Item form (new / edit)
- **Job:** add or change one menu item: what customers see, price, where and how it is cooked, ready-made stock and hours.
- **Entry points:** **New item** / **Edit** on 01a-S05; phone: tap Edit on a row (price-first page).
- **Exits:** Add item / Save item → 01a-S05; Cancel / Back "Menu" / nav item with changes → 01a-D02; Archive item → 01a-D01.
- **Information shown:**

| Item | Mark |
|---|---|
| App bar: back "Menu", title "New item" / "Edit item" | MUST |
| Section help "For food cooked in advance and counted each morning." (Ready-made stock) | USEFUL |
| Conversion line "One plate takes 400 g from the pot. 10 kg counted = 25 plates." / "Sold by kg and counted in kg: no conversion needed. Half kg sells as 0.5." | USEFUL |
| Hours help "The category's hours also apply. {category} has none." / "…Breakfast: 07:00–13:00." | USEFUL |
| Aside "How staff will see it": name, price ("Rs 2,200 / kg"), "Sold at both branches · Karahi counter" / "Sold at Gulberg only", "Counted in kg, 400 g a plate", "Warns below 3 kg", "Available all day" | USEFUL |
| Archive block "Archive this item" / "It disappears from ordering. Past orders keep it." | RARE |

- **Actions:** **Add item** / **Save item** — PRIMARY; **Cancel** — SECONDARY; **Archive item** — DESTRUCTIVE; phone **Save price** — PRIMARY; phone **Edit** (Kitchen, Hours rows) — SECONDARY; B03 **Save {branch} again** — SECONDARY.
- **Inputs** (UI label → field; frames' words; see §6 item 3 for spec-quoted labels):

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Item name (`name`) | text | empty | 1–60, unique | `CONFIG_NAME_TAKEN` → name field error (text UNKNOWN) |
| Category (`category_id`) | select | first active category; none → Save disabled | required | "Add a category first" |
| Group with other sizes (optional) (`group_label`); help "Half and Full show side by side when ordering." | text | empty | 0–60 | — |
| Short description (optional) (`description`) | text | empty | — | — |
| Sold by (`sale_unit`) | segmented "Piece or plate" / "Weight (kg)" / "Volume (L)" | Piece or plate | kg/L forces counting in that unit | — |
| Price (`price_minor`) | "Rs" affix + "per {unit}" | empty | rupees, commas allowed, ≤ 2 decimals, 0–10 000 000 | UNKNOWN text |
| Tax (`tax_class_id`) | select | "No tax" (null) | — | — |
| Branches and kitchen — per branch row: Price here (`price_minor_override`) | "Rs" affix; placeholder "Same: {price}"; disabled with "Not sold here" | empty (= main price) | same as price | UNKNOWN |
| per branch: Cooked at (`station_id`) | select, "Not sold here" first | Not sold here | — | `wrong_branch` → "This station belongs to another branch."; `archived` → "This {station/category} was archived. Pick another." |
| per branch: Recipe (`program_id`) | select (batch only) or text "Cooks each order · no recipe needed" | "Choose a recipe" | required for batch | "Choose a batch recipe." |
| Cooking time (`cook_time_ms`) | minutes | empty | 1 min – 4 h | UNKNOWN |
| Extra time to plate (`prep_buffer_ms`) | minutes | empty | 0–60 min | UNKNOWN |
| Serve (`serve_mode`) | segmented "When ready" / "With the table" | When ready (`immediate`) | — | — |
| Kept ready (switch) | switch | off | turning off clears stock time and pre-cooked recipe | — |
| Counted in (`stock_unit`) | segmented "Plates" / "kg from the pot" / "Litres" | Plates | — | — |
| One plate takes (`stock_per_sale_unit`) | number + g (only when units differ) | empty | 1–1 000 000 | UNKNOWN |
| Serve from stock in (`stock_time_ms`) | minutes | empty | ≤ cooking time | "Must be shorter than the cooking time ({n} min)." |
| Warn when below (`low_stock_threshold`) | number in the stock unit | empty (none); cleared on unit change | — | — |
| When it runs out (`out_of_stock_behaviour`) | segmented "Cook more" / "Sold out" | Cook more (`cook_fresh`) | — | — |
| Leftovers can be sold the next day (`carries_over`) | switch | off | — | — |
| Hours (`availability_windows`) | 01a-C01 | All day | see 01a-C01 | see 01a-C01 |

- **Decisions:** price and tax; which branches sell it and which station cooks it there; per-branch price; whether it is cooked in advance and counted; what happens when it runs out; hours.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Edit (with B02) | Edit an item whose units changed | full form + aside + B02 warn | see 01a-B02 | `OwnerItem`, `owner-item-en-1440.png` |
| New (by kg) | New item | empty form, "Add item" | "New item" / "Add item" / "Sold by kg and counted in kg: no conversion needed. Half kg sells as 0.5." | `OwnerItemNew` |
| Routes loading | edit opened | skeleton in Kitchen section | — | none |
| Busy / slow | save | button busy; banner after 3 s | "Still working…" | none |
| Client errors | check before save | danger banner with links + fields marked | "2 things to fix before saving" / "Kitchen: choose a batch recipe" · "Ready-made stock: serving time" / "Choose a batch recipe." / "Must be shorter than the cooking time (20 min)." / "Can be ordered 07:00–11:00 (item and category overlap)" | `OwnerItemErrors` |
| Name taken | `CONFIG_NAME_TAKEN` | name field error | UNKNOWN text | none |
| Reference invalid | `CONFIG_REFERENCE_INVALID` by `reason` | field error | `program_required` "Choose a batch recipe."; `stock_time_exceeds_cook_time` "Must be shorter than the cooking time ({n} min)."; `archived` "This {station/category} was archived. Pick another."; `wrong_branch` "This station belongs to another branch." | none |
| Partial save | a route PUT failed after the item saved | 01a-B03 | see 01a-B03 | `OwnerItemPartial` |
| Cloud down | network | 01a-B04; values kept; Save disabled | see 01a-B04 | `OwnerItemCloudDown` |
| Read-only | `can_edit_tenant` false | opened as View (no save) | — | none |
| Phone quick price | owner phone | price-first page | "Naan" / "Price" / "Rs" "per piece" / "Was Rs 30. Open orders keep the old price." / "Tax" "No tax" / "On sale at both branches" (as built: text "On sale at {n} of {m} branches", no switch) / "Kitchen" "Tandoor · 4 min · both branches" "Edit" / "Hours" "All day" "Edit" / "Each branch gets the new price within a minute." / "Save price" | `OwnerItemPhone`, `owner-item-en-390.png` |
| Urdu RTL | Urdu | mirrored | UNKNOWN in frames | `owner-item-ur-1440.png`, `owner-item-ur-390.png` |

- **Error codes:** `CONFIG_NAME_TAKEN`, `CONFIG_REFERENCE_INVALID`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `MENU_ITEM_NOT_FOUND`, `IDEMPOTENCY_KEY_MISMATCH`, `PASSWORD_CHANGE_REQUIRED`.
- **Edge cases:** new Chicken Karahi ≈ 12 taps; open orders keep the old price; plate of karahi from a pot (g, sold by piece, 250 g/400 g a plate) needs the conversion line; edit saves = PATCH changed fields, then one route PUT per changed branch in sequence; **spec v2.0 removes the unit fields and adds Variant, Stock draw and "Weighed when served" — not designed here** (§6).
- **Data needed:** item fields above; routes per branch (`station_id`, `program_id`, `price_minor_override`); stations and programs per branch; categories; tax classes; branch names.

### 01a-C01 · Available hours field
- **Job:** limit when a category or item can be ordered.
- **Entry points:** inside 01a-S06 and 01a-S07.
- **Exits:** n/a (field).
- **Information shown:** segmented "All day" / "Only at set hours" (MUST); rows From / To / Remove (MUST); chips for past-midnight and overlap (USEFUL).
- **Actions:** **Remove** row (SECONDARY); **Add hours ({n} more allowed)** (SECONDARY).
- **Inputs:** From, To — `type=time`, mono, LTR, HH:MM 24 h; up to 4 rows; default none (All day).
- **Decisions:** all day or set hours.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| All day | default | no rows | "All day" | `OwnerItem` |
| Set hours | Only at set hours | rows + Add hours | "Add hours (1 more allowed)" | `OwnerCategoryDialog` |
| Past midnight | To < From | info chip | "22:00–02:00 runs past midnight" | `OwnerCategoryDialog` |
| Same time | From = To | error | "From and To must be different." | `OwnerCategoryDialog` |
| Bad format | not HH:MM | error | "Enter times as HH:MM" | none |
| Item + category overlap | item inside category hours | chip | "Can be ordered 07:00–11:00 (item and category overlap)" | `OwnerItemErrors` |
| Four rows | 4 windows | Add hours hidden (UNKNOWN exact) | — | none |

- **Error codes:** `VALIDATION_FAILED`. **Edge cases:** days of the week not supported; hub local time. **Data needed:** `availability_windows: [{start_ms, end_ms}]` (ms from midnight).

### 01a-B01 · Read-only menu line
- **Job:** explain why the menu cannot be changed.
- **Entry points:** 01a-S05 when `can_edit_tenant` is false.
- **Exits:** none.
- **Information shown:** info banner "You can see the menu but not change it." / "Only an owner of every branch can change the shared menu. Ask {owner}." (frame: "Ask Arif.") (MUST).
- **Actions:** none. **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Shown | `can_edit_tenant` false | banner; New buttons hidden; Edit → View | as above | `OwnerMenuReadOnly`, `owner-menu-readonly-en-1440.png` |
| Urdu RTL | Urdu | UNKNOWN in frames | — | `owner-menu-readonly-ur-1440.png` |

- **Error codes:** `PERMISSION_DENIED` (`tenant_wide_write`). **Edge cases:** P1 has one owner covering every branch, so this rarely shows. **Data needed:** `can_edit_tenant`.

### 01a-B02 · Unit-change warning
- **Job:** warn that changing how an item is counted takes effect at the next business day.
- **Entry points:** 01a-S07 aside when Sold by / Counted in / One plate takes change.
- **Exits:** none.
- **Information shown:** warn banner "Counting changes from tomorrow" / "Each branch counts this item again when its next day starts." (MUST). Spec-quoted alternative: "Takes effect when the next business day starts; that day needs a new count of this item at every branch" (Q9).
- **Actions:** none. **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Shown | unit fields changed | warn banner in aside | as above | `OwnerItem` |

- **Error codes:** none. **Edge cases:** warn-below is cleared on a unit change. **Data needed:** original vs edited unit fields.

### 01a-B03 · Partial save
- **Job:** say the item saved but one branch's route did not, and retry only that branch.
- **Entry points:** 01a-S07 save where a route PUT fails.
- **Exits:** **Save {branch} again** re-sends only the failed route PUTs.
- **Information shown:** warn banner "Item saved. One branch was not." / "{branch}: {reason}. Pick another station or Not sold here, then save again." (frame: "Johar Town: Degh isn't set up there. …") (MUST); failing route row marked "Degh isn't set up at Johar Town." (MUST).
- **Actions:** **Save {branch} again** — SECONDARY (Save item remains PRIMARY).
- **Inputs:** the failing branch row.
- **Decisions:** pick another station or Not sold here.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Shown | route PUT error | banner + row error | as above | `OwnerItemPartial` |

- **Error codes:** `CONFIG_REFERENCE_INVALID` (route). **Edge cases:** several failing branches — copy is singular ("One branch was not"); UNKNOWN plural text. **Data needed:** failed route list.

### 01a-B04 · Cloud unreachable
- **Job:** keep the owner's work on screen while the cloud cannot be reached.
- **Entry points:** any owner request fails (network or 503).
- **Exits:** clears when a read succeeds (probe 0.5 → 5 s).
- **Information shown:** warn pulsing banner "Can't reach the restaurant cloud — retrying…" / "Your changes stay on this page. Save works again when the internet is back." (MUST). Sign-in variant: "Can't reach the restaurant cloud." / "Check the internet. What you typed is kept; tap Sign in again."
- **Actions:** none (Save disabled). **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| On a form | failed save | banner; values kept; Save disabled | as above | `OwnerItemCloudDown` |
| On sign-in | failed login | banner; Sign in enabled | sign-in variant | `OwnerLoginCloudDown` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** `SERVICE_UNAVAILABLE`, network. **Edge cases:** nothing is re-sent automatically. **Data needed:** none.

### 01a-D01 · Archive confirm / blocked
- **Job:** confirm archiving something that changes what waiters can sell, or explain why it cannot be archived yet.
- **Entry points:** Archive on an item, category, station, tax rate or floor. Tables and batch recipes archive at once with an 8 s "Archived · Undo" chip (no dialog).
- **Exits:** Cancel/Close → back; Archive → back with the row archived; "Open these items" → menu.
- **Information shown:** title + body (MUST); list of blocking things as chips (MUST when blocked).
- **Actions:** confirm: **Cancel** (SECONDARY), **Archive {name}** (DESTRUCTIVE, names the thing). Blocked: **Close** (SECONDARY) + way forward (**Open these items** / **Archive all {n} tables, then the floor**) (PRIMARY of dialog).
- **Inputs:** none. **Decisions:** archive or not.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Item | Archive item | confirm | "Archive Paye?" / "It disappears from ordering at both branches within a minute. Past orders and reports keep it. You can restore it from Archived." / "Cancel" / "Archive Paye" | `OwnerArchiveItem` |
| Category with items | Archive category | confirm (frame) — as built: blocked, lists the active items | "Archive Breakfast?" / "Its 9 items stop showing on the order screen too. Their stock counts and history stay." / "Paye, Halwa Puri, Chanay and 6 more" / "Cancel" / "Archive Breakfast" | `OwnerArchiveCategory` |
| Floor blocked | `CONFIG_IN_USE` (tables) | blocked, table chips | "Ground floor can't be archived yet" / "It still has 12 tables in use. Move them to another floor or archive them first." / T1 … T12 / "Close" / "Archive all 12 tables, then the floor" | `OwnerArchiveFloor` |
| Station blocked | `CONFIG_IN_USE` (items) | blocked, item chips | "Degh can't be archived yet" / "3 items are cooked here. Move them to another station or mark them Not sold here at Gulberg first." / "Paye" "Chicken Biryani · Half" "Chicken Biryani · Full" / "Close" / "Open these items" | `OwnerArchiveStation` |
| Tax rate | Archive tax rate | confirm — UNKNOWN copy (button disabled while items use it) | — | none |
| Undo chip | table / recipe archived | chip 8 s | "Archived · Undo" | none |

- **Error codes:** `CONFIG_IN_USE` (`details.used_by.ids`).
- **Edge cases:** many blocking items → "and {n} more".
- **Data needed:** `used_by { entity, ids }`, names.

### 01a-D02 · Discard changes?
- **Job:** stop the owner losing unsaved edits.
- **Entry points:** Cancel, Back or a nav item on a changed form (S03 inline forms, S04, S06, S07).
- **Exits:** Keep editing → form; Discard changes → where they were going.
- **Information shown:** "Discard your changes to {name}?" / "You changed {fields}. They are not saved yet." (frame: "You changed the price and the cooking time.") (MUST).
- **Actions:** **Keep editing** — PRIMARY; **Discard changes** — DESTRUCTIVE (outlined).
- **Inputs:** none. **Decisions:** keep or discard.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Shown | leave dirty form | dialog | as above | `OwnerDiscard`, `owner-discard-en-1440.png` |
| Urdu RTL | Urdu | mirrored | UNKNOWN in frames | `owner-discard-ur-1440.png` |

- **Error codes:** none. **Edge cases:** field labels are listed by name. **Data needed:** dirty field labels.

### 01a-S10 · Stock — PIN sign-in
- **Job:** a manager or stock counter signs in on the shared tablet so stock changes are theirs.
- **Entry points:** `/admin/stock` with no admin session; after idle sign-out; after Sign out.
- **Exits:** success → 01a-S11. Device removed → 00-F02. Hub not set up → 00-F06.
- **Information shown:** app bar "Stock"; heading "Sign in to count stock" (MUST); "Who's signing in?" / "Tap your name." (MUST); name tiles with role ("Imran" "Manager", "Arif Ahmed" "Owner", "Usman" "Head cook"), locked tile "Locked · 12 min" (MUST); 01b: "Counts stock" under people with the stock job (USEFUL); "PIN for {name}" + PIN pad (MUST); help "Forgot your PIN?" / "The owner can reset it in Restaurant setup." (RARE).
- **Actions:** name tile (SECONDARY); keys + Delete (SECONDARY); **Sign in** (PRIMARY) → `POST /admin/auth`; **Retry now** (offline, PRIMARY).
- **Inputs:** PIN 4–6 digits, masked.
- **Decisions:** who signs in.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | roster loaded | tiles + PIN | as above | `StockPin`, `stock-pin-en-1280.png` |
| Loading | fetching | skeleton tiles | — | none |
| Wrong PIN + locked tile | `PIN_INVALID` (tries left ≤ 2) | error under pad; forgot help | "Wrong PIN" / "2 tries left, then locked for 15 minutes." / "Forgot your PIN?" / "The owner can reset it in Restaurant setup." | `StockPinError` |
| Locked | `PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT` | keys locked; minutes from `retry_after_ms` (rounded up) | "Locked · {min} min" (other texts as 00-S03/S07) | `StockPinError` |
| Nobody can count | empty roster | empty block | "No one here can count stock" / "The owner gives the stock job to a person in Staff and roles. Then their name shows here." | `StockPinNobody`, `stock-pin-nobody-en-1280.png` |
| Hub unreachable | network | warn + Retry | "Can't reach the hub — retrying…" / "The names appear when the hub answers." / "Retry now" | `StockPinOffline`, `stock-pin-offline-en-1280.png` |
| "Counts stock" label (01b, not built — task T62) | roster `responsibilities` contains `count_stock` | role line becomes "Counts stock" | "Who is counting?" / "Counts stock" / "People with the stock-counting job show "Counts stock". People without a PIN never appear here." | 01b `StockRosterCounts.html` |
| Device removed / not set up | `DEVICE_REVOKED` / `HUB_NOT_PROVISIONED` | 00-F02 / 00-F06 | see 00 | none |
| Urdu RTL | Urdu | mirrored | UNKNOWN in frames | `stock-pin-ur-1280.png`, `stock-pin-nobody-ur-1280.png`, `stock-pin-offline-ur-1280.png` |

- **Error codes:** `PIN_INVALID`, `PIN_LOCKED_OUT`, `DEVICE_LOCKED_OUT`, `DEVICE_REVOKED`, `DEVICE_TOKEN_INVALID`, `HUB_NOT_PROVISIONED`, `SERVICE_UNAVAILABLE`.
- **Edge cases:** the roster is not filtered by `manage-stock` as built (Q11) — someone without it signs in and then sees a permission text (UNKNOWN text); 6 taps.
- **Data needed:** `GET /admin/login-roster` (`staff_id, display_name, role_names, locked_until`, `responsibilities`); `POST /admin/auth`; session keys shared with 00.

### 01a-S11 · Stock page
- **Job:** start the day, enter this morning's ready-made counts, add fresh batches, switch items on/off, see what is low, close the day.
- **Entry points:** after 01a-S10; 00-S20 "Stock".
- **Exits:** Sign out (asks if unsaved counts) → 01a-S10; Close day → 01a-D10; Add (phone) → add sheet.
- **Information shown (regions, in order):** app bar → B10 status / problem → B16 reconnect → B12 stale / B13 start-day → B14 low/out → filters + search → list → sticky action bar.

| Item | Mark |
|---|---|
| App bar: "Stock", day chip (B11, e.g. "Day open since 09:12"), menu chip (B10 "Menu up to date" / "Menu version 42 · checked 1 min ago"), signed-in name "Imran", **Sign out**, **Close day** | MUST (name, day chip); USEFUL (menu chip) |
| Filter segmented: "To count {n}" · "Low or out {n}" · "Off {n}" · "All {n}" (default as built: All) | USEFUL |
| Search "Find an item"; category filter (as built) | USEFUL |
| Column heads: Item · Count now · Left to sell · Fresh batch · Selling | USEFUL |
| Row: item name; sub line "{category} · counted in kg" / "· plates" / "· pieces" / "· keeps overnight" / "· 07:00–13:00" | MUST |
| Row badges (B15) | MUST |
| Count now input + unit (kg / plates / pcs / L); "Still right" confirm (as built) | MUST |
| Left to sell number + unit; "{n} on orders" | MUST |
| Fresh batch **Add** | MUST |
| Selling switch On / Off | MUST |
| Action bar: "{n} of {m} counted" + "Counts are saved together. Fresh batches save at once." + **Save {n} counts** | MUST |

- **Actions:**

| Action | Mark | Result |
|---|---|---|
| **Save {n} counts** (sticky bar) | PRIMARY | `SetPrecookedStock { entries[{item_id, on_hand}] }` for touched rows (200 per command) |
| **Still right** (per row) | SECONDARY | marks the shown count as confirmed |
| **All {n} are still right** (callout) | SECONDARY | one `SetPrecookedStock` with carried-over rows' shown values |
| **Add** (per row; inline on tablet, sheet on phone) | SECONDARY | `AddPrecookedStock { item_id, quantity }` sent at once |
| Selling switch | SECONDARY | `SetItemAvailability { item_id, is_available }` |
| **Start day** | PRIMARY when no day is open | `OpenBusinessDay {}` (no confirm) |
| **Close day** (app bar) | DESTRUCTIVE | 01a-D10 → `CloseBusinessDay {}` |
| **Close it and start today** / **Keep it open** | SECONDARY | Close then Open / hide prompt |
| **Start day and save** | PRIMARY in retry card | Open, then re-send the save with the same `command_id` |
| Filters, search, **Clear search** | SECONDARY | client-side |
| Low/out chips | SECONDARY | jump to the row |
| **Sign out** | SECONDARY | `POST /admin/auth/logout`; with unsaved counts asks Save / Keep on this tablet / Discard |
| **Discard** (kept counts) | DESTRUCTIVE | drop kept counts |

- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Count now (`on_hand`) | number, mono, LTR; `inputmode=decimal` (kg/L) or `numeric` (pieces) | last count / "–" when not counted | pieces whole; kg/L up to 3 dp; shown kg/L, sent g/ml | `VALIDATION_FAILED` text UNKNOWN |
| Add quantity (sheet) "How many are ready?" | number + unit; quick chips +5 / +10 / +20 / +50 (phone) | empty | > 0 (UNKNOWN exact) | UNKNOWN |
| Search | text | empty | — | — |

- **Decisions:** what each pot/tray holds now; whether to switch an item off; when to start or close the day.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Morning count (default) | day open, rows loaded | full page | "Day open since 09:12" / "Menu up to date" / "To count 18" "Low or out 2" "Off 1" "All 30" / "Low: Chicken Karahi 900 g" "Out: Paye" / rows / "12 of 30 counted" / "Counts are saved together. Fresh batches save at once." / "Save 12 counts" | `Main.dc.html`, `stock-main-en-1280.png` |
| No day open | `business_day` null or closed | B13 card + Start day; counting locked; toggles work | see 01a-B13 | `StockNoDay`, `stock-noday-en-1280.png` |
| Yesterday still open | `day_stale` | B12 card | see 01a-B12 | `StockStale`, `stock-stale-en-1280.png` |
| Confirm all carried-over | carried-over counts exist | callout + rows "Counted last night 23:40" | "8 counts from last night" / "If the pots still hold the same, confirm them all at once. Change any that are different first." / "All 8 are still right" | `StockConfirmAll` |
| Saved / added / switch failed | command results | B17 per row + bar | see 01a-B17 | `StockFeedback` |
| Nothing to save | Save with no touched row | B17 info | "Change or confirm a count first." | none |
| Hub unreachable | network | B16; typed counts kept | see 01a-B16 | `StockOffline` |
| Menu update refused | `last_problem` set | B10 danger | see 01a-B10 | `StockMenuProblem`, `stock-menu-problem-en-1280.png` |
| Not saved, day not open | `BUSINESS_DAY_NOT_OPEN` | B13 retry card; bar "Start the day first" | see 01a-B13 | `StockNotSaved` |
| Opened recently | `opened_recently` | B18 | see 01a-B18 | `StockOpenedRecently` |
| No match / item gone | search empty; `STOCK_NOT_TRACKED`; `MENU_ITEM_NOT_FOUND` | info banner + empty block | "Chicken Tikka is no longer counted. The list is refreshed." / "No item matches "{q}"" / "Only items counted each morning and items you can switch off are here." / "Clear search"; "This item was removed from the menu." | `StockNoMatch` |
| Counts kept after idle sign-out | same person signs in again, same day | banner + rows "Not saved yet" + bar | "Your 7 unsaved counts from 09:31 are back." / "You were signed out for being idle. Check them, then save." / "Not saved yet" / "7 counts not saved" / "Kept on this tablet" / "Discard" / "Save 7 counts" | `StockCountsKept` |
| Add sheet (phone) | Add on phone | bottom sheet | "Add a fresh batch" / "Seekh Kebab · 4 pcs left now" / "How many are ready?" / "+5" "+10" "+20" "+50" / "After adding: 14 pcs left to sell" / "Add 10 pieces" / "Cancel" | `StockAddSheet`, `stock-add-sheet-en-390.png` |
| Phone | width 390 | stacked rows "3 kg left · 1.5 kg on orders"; filters "To count · Low · All" | "Day open · 09:12" / "Same as last night · 12 plates" / "12 of 30 counted" / "Save 12 counts" | `StockPhone`, `stock-main-en-390.png` |
| My stations (01b) | scope `my_stations`, day open | chip "Your stations: …"; note; no Start/Close day | "Your stations: Degh, Karahi counter, BBQ grill" / "You see the items of your stations only. Starting and closing the day is for the manager." / "2 of 9 counted" | 01b `StockCounter.html` |
| My stations, day not started | scope `my_stations`, no day | warn banner above rows (spec: rows and Selling stay usable; frame shows no rows) | spec: "The day hasn't been started. Ask someone who can start the day." / frame: "Day not started" / "The day hasn't been started" / "Ask someone who can start the day, like Imran. Your stations' items show here once it is open." | 01b `StockCounterNotStarted.html` |
| Outside my stations | `403 PERMISSION_DENIED { reason: 'outside_scope' }` | banner + refresh | "You can only change items for your stations." / "Lassi is counted at Drinks counter. The list is refreshed." / "OK" | 01b `StockCounterOutside.html` |
| No permission | `PERMISSION_DENIED` (no `manage-stock`) | UNKNOWN text | — | none |
| Urdu RTL (phone) | Urdu | mirrored | "اسٹاک" / "دن کھلا ہے · 09:12" / "گننا باقی 18" / "کم 2" / "سب" / "چکن کڑاہی" / "3 کلو باقی" / "کلو" / "شامل کریں" / "سیخ کباب" / "آج نہیں گنا" / "عدد" / "30 میں سے 12" / "12 گنتیاں محفوظ کریں" | `StockUrdu`, `stock-main-ur-390.png`, `stock-main-ur-1280.png` |

- **Error codes:** `BUSINESS_DAY_NOT_OPEN`, `STOCK_NOT_TRACKED` (not returned under v2.0), `MENU_ITEM_NOT_FOUND`, `PERMISSION_DENIED` (`outside_scope`), `VALIDATION_FAILED`, `SESSION_EXPIRED`.
- **Edge cases:** ~30 counted items (design for up to 200+ rows, saves split at 200); a row being edited is never overwritten by the poll; another device closes the day → next save gets 409 → retry card; out-of-hours items still editable (badge); kept counts keyed by branch + day `opened_at` + staff and never overwrite a newer count; **spec v2.0: one row per stock item with the menu items that draw from it listed under it; availability stays per menu item — not designed** (§6).
- **Data needed:** `GET /admin/queries/stock` (`meta_version`, `stock_version`, `hub_time`, `business_day {business_date, opened_at, closed_at}`, `day_stale`, `day_stale_after_hours`, `day_min_gap_hours`, `manage_stock_scope`, `items_meta[] {item_id, name, group_label, category_name, is_stock_tracked, out_of_stock_behaviour, stock_unit, sale_unit, stock_per_sale_unit, low_stock_threshold, carries_over, item_windows, category_windows}`, `items[] {item_id, on_hand, reserved, unit, available, level, set_at, is_available, unavailable_since}`); `GET /admin/queries/config-status` (`tenant_id, branch_id, config_version, last_poll, last_problem`); commands above with `command_id`.

### 01a-B10 · Menu status line + problem banner
- **Job:** show whether the hub has the owner's latest menu.
- **Entry points:** 01a-S11 (read on open and every 15 s).
- **Exits:** none.
- **Information shown:** status chip (USEFUL); danger banner when a problem exists (MUST).
- **Actions:** none (no "Get changes now" button). **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Up to date | poll applied/unchanged | chip | design: "Menu up to date"; spec/as built: "Menu version {v} · checked {ago}" | `Main` |
| Offline poll | last poll offline | chip suffix | "Menu version {v} · checked {ago} · offline" | none |
| Waiting | `not_ready` | chip | "Waiting for hub confirmation" | none |
| No menu yet | no config | chip | "No menu yet" | none |
| Refused | `last_problem.outcome = rejected` | danger banner + warn chip | "Menu update refused ({reason}). The hub is still using version {v}." / "Selling goes on with version {v}. The owner can fix it in Restaurant setup." (frame reason "a kitchen station is missing") | `StockMenuProblem` |
| Could not apply | reason `apply_failed` | danger banner | "Menu update could not be applied" | none |
| Key refused | `unauthorized` | danger banner | "The hub's cloud key was refused. Call support." | none |

- **Error codes:** none (poll outcomes). **Edge cases:** reason text per `malformed`, `hash_mismatch`, `schema_unsupported`, `schema_invalid` is UNKNOWN. **Data needed:** `config_version`, `last_poll {outcome, at}`, `last_problem {outcome, reason, at}`.

### 01a-B11 · Business day line
- **Job:** show whether a business day is open, since when.
- **Entry points:** app bar of 01a-S11.
- **Exits:** none.
- **Information shown:** chip (MUST).
- **Actions:** **Close day** next to it while a day is open (DESTRUCTIVE, see S11).
- **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Open | day open | ok chip | design: "Day open since 09:12"; spec text: "Day open: Sat 24 Oct since 09:12 (15 h)" | `Main` |
| Open long | age > `day_stale_after_hours` | warn chip | "Day open for 26 h" | `StockStale` |
| Closed / none | no open day | chip | design: "No day open · last closed Sun 25 Oct, 01:10"; spec: "Day closed at 01:10" | `StockNoDay` |
| My stations, not started (01b) | scope `my_stations`, no day | chip | "Day not started" | 01b `StockCounterNotStarted.html` |

- **Error codes:** none. **Edge cases:** style follows the day's age, not its date; times are hub time. **Data needed:** `business_day`, `day_stale`, `hub_time`.

### 01a-D10 · Close day confirm
- **Job:** confirm closing the business day.
- **Entry points:** **Close day** on 01a-S11.
- **Exits:** Cancel → page; Close day → page with no day open.
- **Information shown:** title "Close today's business day?" (MUST); "Leftovers of items that don't keep overnight will count as 0 tomorrow." (MUST); summary "Day started Sat 24 Oct, 09:12" / "Keep overnight Paye, Biryani" / "Switched off Daal Mash" (USEFUL). Spec-quoted text: "Close the business day? Counts of items that do not keep overnight will read 0 until the next day is started" (Q9).
- **Actions:** **Cancel** (SECONDARY); **Close day** (DESTRUCTIVE, danger) → `CloseBusinessDay {}`.
- **Inputs:** none. **Decisions:** close now or not.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Shown | Close day | dialog | as above | `StockCloseDay`, `stock-close-day-en-1280.png` |
| Too soon | `opened_recently` | 01a-B18 | — | `StockOpenedRecently` |
| Urdu RTL | Urdu | mirrored | UNKNOWN in frames | `stock-close-day-ur-1280.png` |

- **Error codes:** `PERMISSION_DENIED` (`outside_scope`, `required_scope: 'branch'`). **Edge cases:** hidden for `my_stations`. **Data needed:** `opened_at`, items with `carries_over`, items switched off.

### 01a-B12 · Stale-day prompt
- **Job:** ask to close yesterday's still-open day before this morning's counts.
- **Entry points:** 01a-S11 when `day_stale` is true.
- **Exits:** **Close it and start today** → Close then Open; **Keep it open** → prompt hidden until reload.
- **Information shown:** card "The day from Sat 24 Oct, 09:12 is still open" / "Nobody closed it last night. Close it and start today, so this morning's counts belong to today." (MUST); row badge "Counted yesterday" (USEFUL). Spec text: "Yesterday's day is still open since {time}. Close it and start a new day?"
- **Actions:** **Close it and start today** — PRIMARY; **Keep it open** — SECONDARY.
- **Inputs:** none. **Decisions:** close and restart, or keep.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Shown | `day_stale` | card above rows | as above | `StockStale` |
| Hidden for counters | `my_stations` | not shown | — | none |
| Urdu RTL | Urdu | UNKNOWN in frames | — | `stock-stale-ur-1280.png` |

- **Error codes:** `PERMISSION_DENIED` (`outside_scope`). **Edge cases:** threshold `day_stale_after_hours` (default 16, branch setting). **Data needed:** `day_stale`, `opened_at`.

### 01a-B13 · Start day card / not-saved retry
- **Job:** make starting the day one tap, and recover a save refused because no day was open.
- **Entry points:** 01a-S11 with no day open; a save/Add answered `409 BUSINESS_DAY_NOT_OPEN`.
- **Exits:** Start day → counting opens; Start day and save → re-sends the pending save with the same `command_id`.
- **Information shown:** card title + body (MUST); rows show yesterday's last counts (USEFUL).
- **Actions:** **Start day** / **Start day and save** — PRIMARY.
- **Inputs:** none. **Decisions:** start the day.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| No day open | no open day | large card + Start day; counting locked | "Start today's business day" / "Counts belong to a day. Start it, then count what's ready." / "Start day" / "Yesterday's last counts. You can switch items on or off now; counting opens after the day starts." | `StockNoDay` |
| Not saved | `BUSINESS_DAY_NOT_OPEN` on save | retry card; counts kept; bar | "These counts were not saved" / "The business day is not open, so this was not saved. Start the day to save it. Your 12 counts are kept." / "Start day and save" / "12 counts waiting" / "Start the day first" | `StockNotSaved` |
| My stations | `my_stations` | no Start day; banner instead | "The day hasn't been started. Ask someone who can start the day." | 01b `StockCounterNotStarted.html` |

- **Error codes:** `BUSINESS_DAY_NOT_OPEN`. **Edge cases:** same `command_id` on retry. **Data needed:** pending command.

### 01a-B14 · Low / out alert bar
- **Job:** show at a glance what is low or out.
- **Entry points:** 01a-S11 when any row's `level` is low or out.
- **Exits:** tap a chip → jump to the row.
- **Information shown:** "Low: {item} {qty}" chips (warn) and "Out: {item}" chips (danger) (MUST).
- **Actions:** chip tap — SECONDARY.
- **Inputs:** none. **Decisions:** tell the kitchen.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Shown | low/out rows | bar | "Low: Chicken Karahi 900 g" · "Out: Paye" (inventory: "Low: Chicken Karahi 900 g, Lassi 1.5 L · Out: Paye, Seekh Kebab") | `Main` |
| Hidden | none low/out | no bar | — | `StockFeedback` |

- **Error codes:** none. **Edge cases:** many low items — wrapping/overflow UNKNOWN. **Data needed:** `level`, `available`, unit.

### 01a-B15 · Row badges
- **Job:** flag rows that need attention.
- **Entry points:** rows on 01a-S11.
- **Exits:** none.
- **Information shown:** badges (MUST): "Low" (warn); "Out · sold out for today"; "Not counted today" (warn; never for a `carries_over` item with a count); "Same as last night"; "Counted last night {time}"; "Counted yesterday"; "Off since {Mon 26 Oct}" (warn); hours "07:00–13:00" / "Hours 07:00–13:00" (info); "Sold out when 0"; "keeps overnight"; "Not saved yet"; 01b station name chip ("Degh").
- **Actions:** none. **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Badges shown | per row data | chips in name block | as above | `Main`, `StockStale`, `StockConfirmAll`, `StockCountsKept` |

- **Error codes:** none. **Edge cases:** hours re-evaluated every minute from `hub_time`. **Data needed:** `level`, windows, `unavailable_since`, `set_at`, `carries_over`, `out_of_stock_behaviour`.

### 01a-B16 · Reconnecting to the hub
- **Job:** keep the counter typing while the hub is unreachable.
- **Entry points:** 01a-S10/S11 fetch failure.
- **Exits:** clears when the hub answers.
- **Information shown:** warn banner "Reconnecting to the hub…" / "Usually a Wi-Fi drop or the hub restarting. Keep counting; nothing you typed is lost." (MUST); bar "{n} counts waiting" / "Tap Save once the hub is back." (MUST); Left to sell shows "–".
- **Actions:** **Save {n} counts** stays visible (UNKNOWN whether enabled).
- **Inputs:** counts stay editable. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Shown | network | banner; values kept; menu chip hidden | as above | `StockOffline` |

- **Error codes:** network. **Edge cases:** none. **Data needed:** typed values.

### 01a-B17 · Save result
- **Job:** confirm what was saved, added or failed.
- **Entry points:** after Save, Add, or a Selling switch.
- **Exits:** none.
- **Information shown:** per-row chips and action bar line (MUST).
- **Actions:** none (retry by repeating the action). **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Counts saved | save ok | bar | "{n} counts saved at {time}" / "Every item is counted for today." | `StockFeedback` |
| Batch added | Add ok | row chip | "Added 10 pcs" | `StockFeedback` |
| Adding | Add in flight | row busy | "Adding…" | `StockFeedback` |
| Switch failed | `SetItemAvailability` error | row error | "Couldn't switch off. Try again." | `StockFeedback` |
| Nothing to save | no touched row | info | "Change or confirm a count first." | none |
| Error | other command error | error text (UNKNOWN per code) | — | none |

- **Error codes:** any stock command error. **Edge cases:** none. **Data needed:** command results, `set_at`.

### 01a-B18 · Day started less than N h ago
- **Job:** explain that a second start/close within the guard did nothing.
- **Entry points:** Start day / Close it and start today answered `opened_recently`.
- **Exits:** none.
- **Information shown:** info banner "This day was started less than {n} h ago; nothing changed." / "Someone started it at {time}. Keep counting." (MUST).
- **Actions:** none. **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Shown | `opened_recently` | info banner | as above (frame: 4 h, 09:12) | `StockOpenedRecently` |

- **Error codes:** none. **Edge cases:** `{n}` = `day_min_gap_hours` (default 4). **Data needed:** `day_min_gap_hours`, `opened_at`.

---

## 4. Flows

**F1 First-time setup (owner, laptop)**
1. 01a-S01 sign in → (01b-B01 if a lock happened; 01b-S09 forced if a temp password) → 01a-S02 pick Gulberg.
2. 01a-S03 first floor: "Ground floor", T1…T12, 4 seats → Add floor and 12 tables ("Adding 4 of 12…"). Repeat with Add floor / Add tables for Family hall.
   - Failure: name taken → field error, loop stops; cloud down → B04, values kept.
3. 01a-S04 Add station Tandoor (one order at a time), Karahi counter, Degh (in batches) → Add recipe "Paye degh 240 min".
4. 01a-S05 first-run checklist → Categories → 01a-S06 Breakfast 07:00–13:00 (C01).
5. Tax rates → inline add (optional).
6. 01a-S07 × ~100 items → Add item.
   - Failure: client errors banner; `CONFIG_REFERENCE_INVALID`; partial save B03 → Save {branch} again; cloud down B04.
7. Hub picks up the menu within ~1 min (01a-B10 shows the new version on the stock page).

**F2 Morning count (manager, counter tablet, 06:45)**
1. 01a-S10 → tap Imran → PIN → Sign in.
   - Failure: wrong PIN (tries left); locked; hub down → Retry now; nobody can count.
2. 01a-S11 → B12 "Close it and start today" (if yesterday still open) or B13 **Start day**.
   - Failure: B18 opened recently ("nothing changed").
3. Confirm carried-over counts (**All 8 are still right**) → type changed counts (Paye 40 plates, Karahi 6 kg, Lassi 8 L, Seekh 60) → **Save {n} counts** → B17 "30 counts saved at 09:41".
   - Failure: hub down → B16, counts kept; day closed elsewhere → B13 retry "Start day and save"; idle sign-out → sign in again → "Your 7 unsaved counts … are back."

**F3 Lunch top-up**
1. 01a-S11 search "seekh" → **Add** (tablet inline / phone sheet "+10") → "Added 10 pcs".
   - Failure: day closed meanwhile → B13 retry card.

**F4 Item runs out**
1. 01a-S11 row Selling → Off → ordering screens show sold out within 5 s; later back On.
   - Failure: "Couldn't switch off. Try again."

**F5 Night close (01:00)**
1. 01a-S11 **Close day** → 01a-D10 → **Close day** → no day open.
   - Failure: `my_stations` counter has no Close day.

**F6 Price change on the phone mid-service (owner)**
1. 01a-S01 → 01a-S05 phone → search "naan" → Edit → 01a-S07 phone → price 35 → **Save price** → each branch within a minute; open orders keep the old price.
   - Failure: cloud down → B04; read-only owner → View only.

**F7 Station-limited counter (01b)**
1. 01a-S10 (Usman, "Counts stock") → 01a-S11 with "Your stations: …", no Start/Close day.
   - Day not started → banner "The day hasn't been started. Ask someone who can start the day."
   - Change outside stations → "You can only change items for your stations." + refresh.

---

## 5. Components used

| Component | Screens |
|---|---|
| Owner app shell (side nav with brand, items + counts, foot with name/email, Change password, Sign out; phone Menu button + overlay) | 01a-S02…S07, 01b pages |
| App bar (title, branch select, chips, actions) | 01a-S03, S04, S05, S07, S10, S11 |
| Pick tiles | 01a-S02 (branches), 01a-S04 (How it cooks) |
| Table tiles + "Add tables" tile | 01a-S03 |
| Inline bulk-add row with preview line and progress | 01a-S03 |
| Segmented control | 01a-S05 tabs, Active/Archived; S07 Sold by, Serve, Counted in, When it runs out; S04 completion mode; C01 All day/set hours; S11 filters |
| Switch | 01a-S03 Show archived; S07 Kept ready, Leftovers; S11 Selling |
| List rows (name + sub line + side group with price/chips/buttons) | 01a-S05, S04, S11 |
| Chips (ok Saved, warn, danger, info, neutral price chip, undo chip "Archived · Undo") | 01a-S03, S05, S07, S11, B14, B15 |
| Banner (danger / warn pulse / info / ok) | 01a-S01, B01, B02, B03, B04, B10, B16, B18, S11 |
| Dialog (form dialog, confirm dialog, blocked dialog with chips) | 01a-S03 table/floor, S04 add station/recipe, S05 tax, S06, D01, D02, D10 |
| Field with affix (Rs / per unit / min / %) | 01a-S05, S07, S04 |
| Hours rows (C01) | 01a-S06, S07 |
| Explain box (conversion line) | 01a-S07 |
| Aside summary card ("How staff will see it") | 01a-S07 |
| Error summary banner with anchor links ("{n} things to fix") | 01a-S07 |
| Empty state / first-run checklist | 01a-S03, S05, S10, S11 |
| Skeleton rows | 01a-S05, S03, S07 |
| Staff name tiles + PIN pad (shared with 00 and 02) | 01a-S10 |
| Count input with unit + "Still right" | 01a-S11 |
| Sticky action bar ("{n} of {m} counted" + Save) | 01a-S11 |
| Bottom sheet with quick chips (+5/+10/+20/+50) | 01a-S11 phone |
| Callout cards (start day, stale day, confirm all, not saved) | 01a-B12, B13, S11 |
| Global states 00-F01…F08 | 01a-S10, S11 |

---

## 6. Open questions

1. **Spec v2.0 item form (01c A14) is not designed.** v2.0 says the item form "takes a variant group, a stock draw and `requires_weighing` and has no unit fields"; the Sold by / Counted in / One plate takes / Kept ready / Warn when below fields in every 01a frame are replaced. New owner views (Variant groups, Stock items, Modifier groups, Deals) are 01c's. The redesigned item form is UNKNOWN until 01c frames exist.
2. **Spec v2.0 stock page (01c A13/A14) is not designed.** One row per **stock item**, with the menu items drawing from it listed under it; availability On/Off stays per menu item; `STOCK_NOT_TRACKED` is no longer returned. Row layout UNKNOWN.
3. **Spec-quoted labels vs design words (Q9, open).** Spec: "Stock unit", "Low stock alert at", "Keeps overnight", "Cook fresh", "Available hours", "Grams per piece", "Takes effect when the next business day starts; that day needs a new count of this item at every branch", "Close the business day? Counts of items that do not keep overnight will read 0 until the next day is started", "Yesterday's day is still open since {time}. Close it and start a new day?", "Day open: Sat 24 Oct since 09:12 (15 h)". Design: "Counted in", "Warn when below", "Leftovers can be sold the next day", "Cook more", "Hours", "One plate takes", "Counting changes from tomorrow", "Close today's business day?", "The day from … is still open", "Day open since 09:12". The build uses the spec words. Which ship?
4. **Counts the API cannot give (Q10, open):** item counts per category and tax rate, the Items tab total before the last page, floor/station counts on branch tiles ("2 floors · 3 stations"), and a station filter for "Open these items". Frames show them; the build leaves them out.
5. **Stock sign-in roster filter (Q11, open):** frames assume only `manage-stock` people; as built every hub admin shows. 01b adds the "Counts stock" label (not built, task T62). Heading differs between frames: "Who's signing in?" (01a) vs "Who is counting?" (01b).
6. **My-stations "day not started" (01b):** the frame shows no rows and names "like Imran"; spec v1.1 AD-33 says rows and the Selling switch stay usable and the stock query carries no names of starters or stations. The frame's "Lassi is counted at Drinks counter" also needs a station name the query does not carry.
7. **Menu chip:** design "Menu up to date" vs spec/as built "Menu version 42 · checked 1 min ago". Reason text for each `rejected` reason (`malformed`, `hash_mismatch`, `schema_unsupported`, `schema_invalid`) is UNKNOWN.
8. **Category archive:** frame `OwnerArchiveCategory` confirms archiving a category with 9 items; spec §6.13 and the build block it (lists the items). Which behaviour is wanted?
9. **Phone shell:** frames show a bottom tab bar (Menu · Floors · Stations); spec v1.3.1 replaced it with a Menu button + overlay side menu. No frame for the overlay.
10. **Item form section name:** "Kitchen" (older frames) vs "Branches and kitchen" with Price here (OwnerItem, as built).
11. **Phone item page "On sale at both branches":** frame shows a switch; as built shows text "On sale at {n} of {m} branches" with no switch.
12. **Default page after the branch picker** ("Continue with {branch}") and whether a tile is preselected: UNKNOWN.
13. **Missing copy:** empty-field errors on sign-in; `CONFIG_NAME_TAKEN` for stations, categories, items, tax rates; price/number validation messages; read-only text for floors/stations (`PERMISSION_DENIED`); stock page `PERMISSION_DENIED` without `manage-stock`; tax-rate archive confirm; plural partial save; add-quantity validation; new-category dialog title.
14. **Stock filter default:** design shows "To count" first; as built default is All.
15. **Urdu.** Only `OwnerMenuUrdu` and `StockUrdu` frames hold Urdu (29 of 471 keys); screenshots exist in Urdu for other pages but their text is from the build, not a design. The rest is in `docs/design/handoff/01a/urdu-todo.md` (Q12).
16. **Kiosk 1920 stock layout:** no frame (tablet layout centred at 1280).
17. **Image upload, 2-D floor plan, table shape/position, days of the week** are story ACs dropped by the spec — not to be designed.

---

## 7. Clutter report

| Screen | Problem (from the marks above) | What could move behind "More" or a second tap |
|---|---|---|
| 01a-S07 Item form | ~20 inputs in 5 sections plus an aside; Ready-made stock (6 fields) and Branches and kitchen are needed only for some items; archive block is RARE | Collapse Ready-made stock behind its "Kept ready" switch (already conditional) and Hours behind "All day"; move Archive item into a "More" menu in the app bar; keep the aside as a collapsible summary |
| 01a-S11 Stock page (tablet) | App bar holds title, day chip, menu chip, name, Sign out and Close day; each row has 5 columns + badges; filters + search + category filter | Move the menu chip into a status icon that opens B10; move Close day into a "More" menu (it is used once a day at night); keep Count, Left to sell, Add, Selling per row and move "{n} on orders" into the Left to sell tooltip |
| 01a-S05 Menu | Three tabs, three filters (search, category, Active/Archived) and per-row notes, branches, branch price chips, hours tags | Move Active/Archived into a "Show archived" option in More; show branch price chips and hours only on hover or in the row detail |
| 01a-S04 Stations | Open station shows 6 fields + recipe list at once | Keep the summary line; open the edit fields only on Edit (already so); move "Used by {n} items" into a tooltip |
| 01a-S03 Floors | Every floor section has Rename and Archive buttons next to the title | Move Rename and Archive into a per-floor "More" menu; keep Add tables visible |
| 01a-S02 Branch picker | Picker + menu callout + ID note, with a single primary | ID note disappears once names exist; callout could become a small link |
| 01a-S10 Stock sign-in | "Forgot your PIN?" help (RARE) next to the pad | Show only after a wrong PIN (already so in `StockPinError`) |
