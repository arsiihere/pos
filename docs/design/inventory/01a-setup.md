# 01a — Restaurant Setup: screen inventory

Spec: `docs/specs/01_Restaurant_Setup_Spec_v1.0.2.md` §8 (implemented, pending manual run). Code: `apps/client/src/features/owner/**` (owner app, cloud) and `apps/client/src/features/admin/stock/**` (hub stock page). The detailed current-state brief is `docs/design/ui-brief-01a.md` (field tables, today's texts, "awkward" notes); this file is the inventory and points into it as **[brief §x]**. Conventions in [00-index.md](00-index.md).

---

## 1. Who and where

| Surface | Who (permission) | Device | Network | How often | Conditions |
|---|---|---|---|---|---|
| Owner app `/owner/` (cloud) | Owner user (cloud account, not a staff PIN); tenant-wide edits (menu, tax, categories) need an owner who covers **every** branch (`can_edit_tenant`, S8) | Laptop 1440 (L); phone 360 for a quick price change (OP) | Internet (HTTPS); **no offline mode** | Heavy once at setup (~100 items, 3 floors, 6 stations per branch); then a few edits a week | Calm, seated; but price changes may be done on a phone mid-service |
| Hub stock page `/admin/stock` | Staff with `access-hub-admin` + `manage-stock` (branch manager, shift lead, owner on site) | Counter tablet (T), cashier kiosk (K), manager's phone (P) | Hub LAN only, plain HTTP | Every day: morning count (~30 stock-tracked items), top-ups during rush, items Off, close day at night | Standing, hurried, wet hands, bright light; lunch and dinner rush |

Arif Chatkhara: Gulberg and Johar Town branches (3rd branch later), ~100 items; stock-tracked: Paye (plates, degh overnight, sold out when gone), Chicken Karahi (kg from the pot), Lassi (L from the jug, sold by 300 ml glass), Seekh kebab (pieces). Breakfast 07:00–13:00.

## 2. Jobs to be done

| # | Job | Story AC | Acceptance |
|---|---|---|---|
| J1 | As the owner, I need to sign in to the setup app so that I can edit my restaurant. | 00 §6.22 | email + password; JWT in tab; refresh once on expiry |
| J2 | As the owner, I need to pick which branch I'm editing so that floors and stations go to the right place. | 01a §8.1 (S37) | tiles of allowed branches (IDs until 01b names them) |
| J3 | As the owner, I need to create floors and tables (name, seats, order) so that waiters can pick a table. | E1-FLR AC1, AC2, AC5 | floor name 1–60 unique per branch; table unique per branch; seats 1–100; sort number, no drag; archive/restore; no 2-D positions (tiles per floor, README 02 carried) |
| J4 | As the owner, I need to set up kitchen stations and their batch programs so that ETAs are real. | E1-FLR AC3, AC4, AC5; E3-KDS AC9 (completion mode) | slot/batch, capacity 1–100, freshness 0–60 min (batch), completion two-tap/one-tap/auto; programs name + cook 1 min–4 h |
| J5 | As the owner, I need to manage tax classes so that bills carry the right tax. | E0-MENU AC8 | name + rate (%, 2 dp → bp); "No tax" default on items (S34) |
| J6 | As the owner, I need categories with hours so that breakfast is only sold 07:00–13:00. | E0-MENU AC1; E0-AVAIL AC4 | name unique, sort number, up to 4 windows HH:MM (wrap past midnight) |
| J7 | As the owner, I need to add and edit items with price, tax, timing, stock units, hours and per-branch route so that orders reach the right station at the right price. | E0-MENU AC2, AC3, AC7; E1-ROUTE AC1, AC2, AC4, AC5; E0-AVAIL AC4 | see 01a-S07 fields; archived items vanish from ordering but stay in history |
| J8 | As the owner, I need to find an item fast in a 100–5 000 item menu so that I can change its price. | 01a S48 | search (300 ms), category filter, Active/Archived, 50 a page |
| J9 | As a manager, I need to sign in on a shared tablet with my PIN so that stock changes are mine. | 01a §8.2; E0-PIN | name tiles + PIN pad |
| J10 | As a manager, I need to start the business day so that counts belong to today. | 01a S33 | one tap, no confirmation |
| J11 | As a manager, I need to enter this morning's pre-cooked counts (and confirm carried-over ones) so that early orders get the fast time. | E1-STOCK AC1, AC6; E10-CNT AC1 | one Save for every touched row; pieces whole, kg/L 3 dp |
| J12 | As a manager, I need to add a fresh batch during service so that the count goes up without recounting. | E1-STOCK AC1 (update any time); S45 | Add per row, sent at once |
| J13 | As a manager, I need to switch an item Off/On instantly so that waiters stop selling it. | E0-AVAIL AC1, AC5 | reflected on ordering screens ≤ 5 s; Off carries over (S30) |
| J14 | As a manager, I need to see what is low or out so that I can tell the kitchen. | S46; E10-CNT AC1, AC3 | low = available ≤ threshold in its unit; out = 0 |
| J15 | As a manager, I need to close the day at night (or close yesterday's stale day in the morning) so that today's counts start fresh. | S33 | confirmation; 4 h double-tap guard; stale prompt |
| J16 | As a manager, I need to know whether the hub has the owner's latest menu so that I trust what waiters see. | 01a §6.21 | status line + problem banner, 15 s refresh |

## 3. Screen list

| ID | Name | Kind | Surface | Exists |
|---|---|---|---|---|
| 01a-S01 | Owner sign in | screen | owner `#/login` | yes |
| 01a-S02 | Branch picker + navigation shell | screen + nav | owner `#/` | yes |
| 01a-S03 | Floors and tables | screen | owner `#/floors` | yes |
| 01a-S04 | Stations and programs | screen | owner `#/stations` | yes |
| 01a-S05 | Menu — item list (with tax classes and categories sections) | screen | owner `#/menu` | yes |
| 01a-S06 | Category form (new / edit) | screen (replaces list) | owner | yes |
| 01a-S07 | Item form (new / edit) | screen (replaces list) | owner | yes |
| 01a-C01 | Available hours field | field component | in S06, S07 | yes |
| 01a-B01 | Read-only menu line | banner | S05 | yes |
| 01a-B02 | Unit-change warning ("Takes effect when the next business day starts…") | banner | S07 | yes |
| 01a-B03 | Partial save (item saved, a route failed) | banner | S07 | **no** (today: generic error) |
| 01a-B04 | Cloud unreachable | banner | every owner screen | yes |
| 01a-D01 | Archive confirm (floor, table, station, program, tax class, category, item) | dialog | S03–S05 | **no** (today: acts at once) — design choice, not spec |
| 01a-D02 | Discard changes? (Cancel on a dirty form) | dialog | S06, S07 | **no** — design choice |
| 01a-S10 | Stock — PIN sign-in | screen | hub `/admin/stock` | yes |
| 01a-S11 | Stock page (rows, filters, action bar) | screen | hub | yes |
| 01a-B10 | Menu status line + problem banner | banner | S11 | yes |
| 01a-B11 | Business day line (open / stale / closed) | banner | S11 | yes |
| 01a-D10 | Close day confirm | dialog | S11 | yes |
| 01a-B12 | Stale-day prompt | inline card | S11 | yes |
| 01a-B13 | Start day card (rows place and retry place) | inline card | S11 | yes |
| 01a-B14 | Low / out alert bar | banner | S11 | yes |
| 01a-B15 | Row badges: Not counted today, Hours, Off since, Sold out when 0 | inline badges | S11 rows | yes |
| 01a-B16 | Reconnecting to the hub | banner | S10, S11 | yes |
| 01a-B17 | Save result (saved / nothing to save / error) | banner or toast | S11 | yes |
| 01a-B18 | "Day started less than 4 h ago; nothing changed" | info message | S11 | yes |

**Count: 26.**

## 4. Per screen

### 01a-S01 Owner sign in [brief §2.1]
- **Purpose:** owner signs in. **Entry:** `/owner/`, any expired session. **Exit:** 01a-S02.
- **Fields:** Email (`email`, type email, trimmed, req); Password (`password`, req). LTR: email.
- **Action:** **Sign in** → `POST /v1/auth/login` (allowlisted), busy + 3 s slow; Enter submits.
- **States:** `LOGIN_INVALID` "Email or password is wrong…"; `LOGIN_LOCKED_OUT`/`IP_LOCKED_OUT` (reserved; 401 since M73 — owner learns of a lock only out of band, 01b-B01); `VALIDATION_FAILED`; network 01a-B04; success.
- **Edge:** no "forgot password" (not in scope; no dead link). **Steps:** 3.

### 01a-S02 Branch picker + nav [brief §2.2]
- **Purpose:** choose branch; reach Floors / Stations / Menu. **Data:** `allowed_branch_ids` (ULIDs; names after 01b `GET /v1/admin/branches` → 01b-S06). Show IDs mono LTR until then.
- **Nav:** Floors and tables · Stations · Menu · (01b adds Staff, Roles, Branch settings; 01c adds Options, Deals; 05 adds Payments, Tax rules, Receipt). Menu is tenant-wide and should not require a branch (today it does — awkward). Needs a current-page marker, branch name in header, Sign out (`POST /v1/auth/logout`, exists in 00 §6.24 but no button today).
- **States:** one branch → auto-pick is a design option; reload loses the branch (memory only).

### 01a-S03 Floors and tables [brief §2.3]
- **Layout:** header (branch, title, Show archived) → floor cards (name, sort number, Archive/Restore; table rows: name, seats, sort number, Archive/Restore; Add table row) → Add floor.
- **Fields:** Floor name (1–60, unique per branch, `name`); Sort number (integer, may be negative, `sort_order`); Table name (1–60, unique per branch); Seats (1–100, optional, `seats`, LTR); New floor / new table forms.
- **Actions:** `POST/PATCH /v1/admin/branches/:b/floors[/:id]`, `POST/PATCH …/tables[/:id]` (PATCH can also change seats and `floor_id` — not on the page today). Creating POSTs carry `Idempotency-Key` (ULID per form open). Archive = PATCH `archived: true`.
- **States:** loading (none today), empty ("Add your first floor"), save on blur with no feedback (today), `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE` (floor with active tables; `details.used_by.ids` could name them), `CONFIG_REFERENCE_INVALID`, `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_MISMATCH` (reload), `PERMISSION_DENIED`, `*_NOT_FOUND` (stale tab), network.
- **Sample:** Ground floor T1–T12 (4 seats), Family hall F1–F8 (6 seats), Rooftop archived.
- **Edge:** bulk add T1–T12 not supported by API (one POST each; the page can loop) — Q1; parking spots are **not tables** (S10).
- **Steps:** 12 tables today ≈ 36 actions. Target with a bulk form: ≤ 6.

### 01a-S04 Stations and programs [brief §2.4]
- **Fields per station:** Name (1–60, unique per branch); Where it is (0–60, `location_label`); Type: "Cooks each order on its own" (slot) / "Cooks in batches" (batch) (`station_type`, change refused while routes use it); How many at once (`capacity` 1–100); Freshness (batch only, minutes 0–60, 2 dp → `freshness_window_ms`; plain words: "How early a batch may be ready"); Taps (`completion_mode`: Start and Done / Done only / Done automatically).
- **Programs (batch):** Name (1–60, unique per station), Cook time (1 min–4 h, `cook_time_ms`), Archive/Restore; Add program.
- **API:** `POST/PATCH /v1/admin/branches/:b/stations[/:id]`, `…/programs[/:id]`.
- **States:** as S03; `CONFIG_IN_USE` on type change / archive; `PROGRAM_NOT_FOUND`.
- **Sample:** Tandoor (slot, 12, Start and Done, "Back left"); Karahi counter (slot, 4, Done only); Degh (batch, 2, freshness 30 min, program "Paye degh 240 min"); Fryer (batch, 8, "Fry 180 °C 6 min").
- **Not here:** live capacity override (D37) → 03a-S01; printer/screen per station (E0-HW AC1) → 03b-S07.

### 01a-S05 Menu list [brief §2.5]
- **Regions:** read-only line 01a-B01 → Tax classes (name, rate "16 %", Archive/Restore; Add: name + rate %) → Categories (name, Edit, Archive/Restore; New category) → Items: New item; Search (≤ 60, 300 ms, `q`), Category filter, Active/Archived switch; rows (name, group label, category, price "Rs 2,200 per kg"); Load more (`next_cursor`, 50 a page).
- **API:** `GET /v1/admin/menu?q&category_id&archived&cursor`; `POST/PATCH /v1/admin/tax-classes`, `…/categories`; `PATCH /v1/admin/menu-items/:id` (archive).
- **States:** loading; read-only (`can_edit_tenant` false → no buttons); empty menu ("Add a category first, then items"); no search match ("No items match 'naan'"); `CONFIG_IN_USE`; network.
- **Edge:** tax rate change or rename exists in the API but not on the page.
- **Steps:** Naan price 30 → 35: ≈ 6 actions + scrolling. Target ≤ 5.

### 01a-S06 Category form [brief §2.6]
Fields: Category name (1–60 unique), Sort number (integer, default 0), Available hours (01a-C01). **Save** / **Cancel**. `POST /v1/admin/categories` (Idempotency-Key) / `PATCH`. Sample: Breakfast 07:00–13:00.

### 01a-S07 Item form [brief §2.7]
- **Suggested groups** (fields unchanged, spec-fixed): *What the customer sees* (name, group label, description, category, price, tax); *Kitchen timing* (serving, cook time, prep, stock time, programs via routes); *Stock* (when stock runs out, stock unit, sold by, grams/ml per piece, low-stock alert, keeps overnight); *When sold* (hours); *Where sold* (route per branch).
- **Fields** (API name, default, validation): `name` 1–60 unique; `group_label` 0–60 (kept in schema 1; 01c may replace); `description`; `category_id` (first active); `tax_class_id` (**No tax** = null, default); `price_minor` (typed rupees, commas allowed, ≤ 2 dp, 0–10 000 000; "per piece / per kg / per L" follows Sold by); `serve_mode` (immediate default / sync: "Serve as soon as ready" / "Serve together with the rest of the order"); `cook_time_ms` (1 min–4 h, 2 dp); `prep_buffer_ms` (0–60 min); `stock_time_ms` (0…cook, optional); `out_of_stock_behaviour` (cook_fresh default / sold_out); `stock_unit` (piece / g shown kg / ml shown L); `sale_unit` (piece unless stock unit is g/ml; then piece or same); `stock_per_sale_unit` (shown only when units differ, 1–1 000 000); `low_stock_threshold` (QuantityInput in stock unit, empty = none, cleared on unit change); `carries_over` ("Keeps overnight", off); `availability_windows` (01a-C01); routes per branch: station ("Not sold at this branch" first), program (batch, required), stock program (optional). All numbers/prices LTR.
- **Actions:** **Save** → new: `POST /v1/admin/menu-items` (Idempotency-Key, with routes); edit: `PATCH` changed fields then one `PUT …/routes/:branch_id` per changed branch, in sequence. Cancel.
- **States:** routes loading; busy/slow; client check fails (should name and mark the field); `CONFIG_NAME_TAKEN`; `CONFIG_REFERENCE_INVALID` per `details.reason` (`archived`, `program_required`, `stock_time_exceeds_cook_time` "Stock time can't be longer than cook time", `wrong_branch`…); 01a-B02 on unit change; 01a-B03 partial save; `PERMISSION_DENIED`; read-only (cannot open); network (values kept).
- **Sample:** Chicken Karahi Rs 2,200/kg, g/g, low at 1 kg, cook 20 min, prep 2 min, stock time 5 min, Karahi counter at both branches; Lassi Rs 250 a glass, stock ml, sold by piece, 300 ml per glass, low at 2 L; Paye Rs 450, sold out when gone, keeps overnight, Degh / Paye degh.
- **Edge:** no category yet → disable Save with "Add a category first"; plate of karahi from a pot in g (sold by piece, 250 g per piece) — needs explanation; variants/modifiers/deals → 01c-S01….
- **Steps:** new Chicken Karahi ≈ 16 actions; target ≤ 12 with defaults.

### 01a-C01 Available hours field [brief §2.8]
"Always available" when empty; up to 4 rows From/To (HH:MM 24 h, LTR), Remove, Add hours. Errors: "Enter times as HH:MM", "From and To must differ"; To < From wraps past midnight (explain: "22:00–02:00 runs past midnight"); item sells only inside its own **and** its category's hours (say so).

### 01a-S10 Stock — PIN sign-in [brief §3.1]
Name tiles (`GET /admin/login-roster`, filtered to `manage-stock`) → PIN pad → `POST /admin/auth`. States: loading, nobody can open, signing in, `PIN_INVALID` (attempts left ≤ 2), `PIN_LOCKED_OUT`/`DEVICE_LOCKED_OUT` (time left from `retry_after_ms` — unused today), 00-F02, 00-F06, hub unreachable with **Retry**. Sample: Imran, Arif, Bilal (locked 14 min). Steps: 6.

### 01a-S11 Stock page [brief §3.2–3.9]
- **Regions (suggested order):** header (title, signed in as, sign out — Q3) → 01a-B10 → 01a-B16 → 01a-B11 + Close day → 01a-B12 → 01a-B13 → 01a-B14 → filters (Search, Category by `category_name`) → rows → sticky action bar **Save N counts** → 01a-B17.
- **Row fields:** item name (+ group label); **On sale / Off** toggle (`SetItemAvailability { item_id, is_available }`); stock-tracked only: **Count** (`QuantityInput`, unit pieces/kg/L, `on_hand`), **Still right** (confirm; re-sends shown `on_hand`), Reserved, Left to sell (`available`; 0 when count not valid), Counted at 11:05 (hub time), **Add** field + **Add** button (`AddPrecookedStock { item_id, quantity }`, sent at once), badges 01a-B15. Words: the spec's "Available" is overloaded (toggle vs number) — rename one.
- **Actions:** **Save counts** → `SetPrecookedStock { entries: [{ item_id, on_hand }] }` for touched rows (command_id per save, kept for retry); **Start day** → `OpenBusinessDay {}`; **Close day** → 01a-D10 → `CloseBusinessDay {}`; **Close and start new day** → Close then Open; **Keep this day open**. All `/admin/commands/*`, permission `manage-stock`, command_id ULID.
- **Polling:** `GET /admin/queries/stock` (with `meta_version`, `stock_version`) and `GET /admin/queries/config-status` every 15 s; a refresh never overwrites a row being edited; poll is not activity.
- **States:** first load; no items; no match; non-stock item (toggle only); hub unreachable (values kept); query refused; signed out on idle (**typed counts lost today** — Q4); `BUSINESS_DAY_NOT_OPEN` → retry card; `STOCK_NOT_TRACKED` "This item is no longer counted. The list is refreshed."; `MENU_ITEM_NOT_FOUND` "This item was removed from the menu."; `PERMISSION_DENIED`; `VALIDATION_FAILED`; `opened_recently` → 01a-B18; out of hours badge (still editable); no day open (rows editable but Save will fail — awkward).
- **Concurrent edit:** another tablet saves a count → next poll updates rows not being edited; another device closes the day → next save gets 409 → retry card.
- **Sample:** Karahi on hand 4.5 kg, reserved 1.5 kg, left 3 kg; Lassi 6.5 L / 0.6 L / 5.9 L; Paye out ("Sold out when 0", after 13:00 "Hours 07:00–13:00"); Naan toggle only.
- **Steps:** morning count of 30 items: 6 (sign in) + 1 (start day) + ~45 (counts/confirm) + 1 (save). Target: ≤ 1 tap per unchanged carried-over item ("Still right" for all?) — Q5. Add a batch: 4 actions.

### 01a-B10 … B18 (inline states)
| ID | Text (spec text marked *) | Data |
|---|---|---|
| B10 | *"Menu version 42 · checked 1 min ago" / "No menu yet" / "Waiting for hub confirmation"; problem: *"Menu update refused (reason). The hub is still using version 42." / *"…could not be applied" / *"The hub's cloud key was refused. Call support." | `config_version`, `last_poll`, `last_problem` |
| B11 | *"Day open: Sat 24 Oct since 09:12 (15 h)" (ok; warn after `day_stale_after_hours` 16) / *"Day closed at 01:10" | `business_day`, `day_stale`, `hub_time` |
| D10 | *"Close the business day? Counts of items that do not keep overnight will read 0 until the next day is started" — Cancel / Close day (danger) | — |
| B12 | *"Yesterday's day is still open since 09:12. Close it and start a new day?" — Close and start new day / Keep this day open | `day_stale` |
| B13 | "No business day is open. Start the day, then enter the counts." / retry: "The business day is not open, so this was not saved. Start the day to save it." | — |
| B14 | "Low: Chicken Karahi 900 g, Lassi 1.5 L · Out: Paye, Seekh Kebab" (tappable chips → row) | rows `level` |
| B15 | "Not counted today" (warn), "Hours 07:00–13:00" (info), "Off since Mon 24 Oct" (warn), "Sold out when 0" | `level`, windows, `unavailable_since` |
| B16 | "Reconnecting to the hub… What you typed is kept." | fetch failure |
| B17 | "Counts saved." / "Change or confirm a count first." / error text | command result |
| B18 | *"This day was started less than 4 h ago; nothing changed." | `day_min_gap_hours` |

## 5. Flows
1. **First-time setup (owner, laptop):** 01a-S01 → S02 (Gulberg) → S03 (Ground floor + 12 tables, Family hall + 8) → S04 (Tandoor, Karahi counter, Degh + Paye degh program) → S05 → S06 (Breakfast 07:00–13:00; Karahi; Breads; Drinks) → S05 tax classes → S07 ×100 (route per branch) → hub picks up the menu within ~1 min (B10 on the stock page shows the new version). Unhappy: name taken; station type change refused because items route to it; partial save B03; cloud down B04.
2. **Morning (manager, counter tablet, 06:45):** S10 → S11 → B12 stale prompt "Close and start new day" → counts for Paye 40 plates, Karahi 6 kg, Lassi 8 L, Seekh 60 → Save counts → B17. Unhappy: `opened_recently` B18; another tablet already started the day; idle sign-out mid-count (lost today).
3. **Lunch top-up:** search "seekh" → Add 10 → Add. Unhappy: day closed by someone → retry card B13 (same command_id).
4. **Item runs out / switch off:** row → Off → waiters see "Sold out" ≤ 5 s (02-B05). Back On after restock.
5. **Night close (01:00):** B11 → Close day → D10 → closed.
6. **Price change on the phone (owner, mid-service):** S01 → S02 → S05 search "naan" → S07 price 35 → Save → hub applies on next poll; **open orders keep their old price** (D25).

## 6. Data shown
| Entity | Fields / units | Source |
|---|---|---|
| Floor, table | name, sort_order, seats, archived_at | `GET /v1/admin/branches/:b/floors` |
| Station, program | type, capacity, freshness_window_ms, completion_mode, programs[] cook_time_ms | `GET …/stations` |
| Tax class | name, rate_bp | `GET /v1/admin/menu` |
| Category | name, sort_order, availability_windows (ms from midnight, hub local) | same |
| Item | see S07; price_minor (paisa); units g/ml/piece | same, paged |
| Stock row | items_meta + items: on_hand, reserved, available (stock unit), level ok/low/out/not_counted, set_at, is_available, unavailable_since | `GET /admin/queries/stock` (poll 15 s; no WS for admin sessions) |
| Config status | config_version, applied_at, last_poll, last_problem | `GET /admin/queries/config-status` |
| Business day | business_date, opened_at, closed_at, day_stale, hub_time | stock query |

## 7. Cross-module links
- **Needs:** 00 (owner login, admin PIN session, pairing); 01b for branch names (S37), branch settings `tax_enabled`, `day_stale_after_hours`, `day_min_gap_hours` (CLI-only today) and `manage-stock` as an assignable responsibility.
- **Gives:** the branch config snapshot every hub screen uses: tables per floor (02-S03), stations (00-S08 picker, 03b KDS), items/prices/units/windows/routes (02-S05, 01c), stock and availability live state (02-B05/B06 counts, sold out, slow), business day (05 replaces Open/Close and attaches Z report, keeping the events).
- 01c extends the item form (variants, modifiers, deals) and the stock page (stock pools shared across variants).
- 05 needs `tax_class_id`; 03b needs stations for printer config.

## 8. Open questions (owner)
- **Q1** Should the floors page add tables in bulk ("T1 to T12, 4 seats")? Needs a design decision; the API allows a client loop.
- **Q2** Should archive ask for confirmation (01a-D01) and should Cancel on a changed form ask (01a-D02)? Not in the spec; design-only.
- **Q3** Should the stock page have "Signed in as Imran · Sign out"? 00 has `POST /admin/auth/logout`; no spec text.
- **Q4** Typed counts are lost when the admin session idles out mid-count. Keep them on the device (like 02 drafts)? Needs a spec line.
- **Q5** Morning count: a "Confirm all carried-over counts" action? Today it is one Confirm per row.
- **Q6 (spec owner questions still open, 01a §12.6):** 3 (sold out vs cook more per item), 5 (same menu and prices at every branch?), 10 (which items cook in loads), 12 (manual On outside hours), 13 (rounding of kg lines).
- **Q7** The menu is tenant-wide; should the Menu tab work without picking a branch?

## 9. Design status
- **Built and working, styled only with kit classes on plain elements**: all 01a screens. Detailed current-state brief: `docs/design/ui-brief-01a.md` (2026-10-26, commit `2f1a1e4`).
- **Redesign:** the brief asks for one; `docs/design/01a-redesign/ui-redesign-01a.md` **does not exist in the repo**, and no canvas frame names are recorded anywhere. So: **designed (brief) but not redesigned**; every screen above is "needs redesign".
- Missing kit parts the redesign must propose (brief §5.2): page header/app bar, nav/tabs, list row, switch, segmented control, badge/chip, checkbox, toast, empty state, skeleton, sticky action bar, page-width layout.

## Story AC → screen IDs

| Story AC | Screens |
|---|---|
| E0-MENU AC1 (categories, archive) | 01a-S05, S06 |
| E0-MENU AC2 (item fields; image upload) | 01a-S07 — **image upload has no field** (not in 01a spec) |
| E0-MENU AC3 (stock time) | 01a-S07 |
| E0-MENU AC7 (archived items vanish from ordering) | 01a-S05 (Active/Archived), 02-S05 |
| E0-MENU AC8 (tax class per item) | 01a-S05, S07 |
| E0-AVAIL AC1 (toggle ≤ 5 s) | 01a-S11 |
| E0-AVAIL AC2, AC3 (greyed, blocked on ordering) | 02-S05, 02-B05 |
| E0-AVAIL AC4 (schedule) | 01a-C01 in S06/S07 (days of week **not supported** — windows are daily) |
| E0-AVAIL AC5 (manual overrides schedule until boundary) | **changed by S47**: window wins over manual On (owner Q12) — 01a-B15 shows hours |
| E1-FLR AC1 (floors; 2-D canvas) | 01a-S03 — **no canvas** (tiles per floor, README 02 carried) |
| E1-FLR AC2 (tables: name, seats, shape, position) | 01a-S03 — shape and position **not in spec** |
| E1-FLR AC3 (stations; live capacity override) | 01a-S04; live override → 03a-S01 |
| E1-FLR AC4 (freshness window) | 01a-S04 |
| E1-FLR AC5 (rename, reposition, archive) | 01a-S03, S04 |
| E1-FLR AC6 (archived station warning) | 03b-B06 |
| E1-ROUTE AC1, AC2, AC4, AC5 | 01a-S07 |
| E1-ROUTE AC3 (modifier overrides) | 01c-S03 |
| E1-STOCK AC1 (count at start, update any time) | 01a-S11 |
| E1-STOCK AC2 (countdown to manager and order takers) | 01a-S11; 02-S05 |
| E1-STOCK AC3, AC4 (reserve at submit, race) | 02-B07 |
| E1-STOCK AC5 (slow at 0) | 02-S05 |
| E1-STOCK AC6 (no count = 0) | 01a-B15 "Not counted today" |
| E10-CNT AC1 (manager view real time) | 01a-S11 (15 s poll, not push) |
| E3-KDS AC9 (completion mode set by admin) | 01a-S04 |

**ACs with no screen (gaps):** E0-MENU AC2 *image upload*; E1-FLR AC1 *2-D canvas* and AC2 *shape/position* (dropped by the spec: tiles per floor); E0-AVAIL AC4 *days of week*. All four are spec decisions, listed so the designer does not draw them.
