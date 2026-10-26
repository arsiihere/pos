# 01a — Restaurant Setup: design for integration

Canvas: **Module 01a Screens** (54 frames). The 28 original frames are kept and retitled with screen IDs. 26 frames were added in three new rows at the bottom ("01a additions · …").

Inventory: `docs/design/inventory/01a-setup.md`. Current-state brief: `docs/design/ui-brief-01a.md`. Spec: `01_Restaurant_Setup_Spec_v1.0.2.md` §8.

Kit: `kit-additions.css` is the same file as module 00. It is 01a + 00 blocks with the `.pos-list__name > span` fix, so chips in rows keep their colour. Design system: POS.

**Two surfaces**
- **Owner app** `/owner/` (cloud, laptop first; phone for price changes). Shell:
  - `.pos-shell`
  - `.pos-sidenav` (brand "Arif Chatkhara / Restaurant setup"; Menu · Floors and tables · Kitchen stations; foot: email + Sign out). 01b, 01c and 05 add items later.
  - column: `.pos-appbar` → `.pos-content`
  - Phone: `.pos-appbar--phone` + bottom `.pos-actionbar` used as a tab bar.
- **Hub stock page** `/admin/stock` (tablet first, phone, kiosk). Shell:
  - `.pos-page` → `.pos-appbar` (title "Stock", day chip, menu status chip, signed-in name, Sign out, Close day)
  - `.pos-content` → `.pos-list.pos-list--stock`
  - sticky `.pos-actionbar` with **Save N counts**. It moves under the 00-S20 hub admin shell when that ships.

Sample data: Gulberg `…P0AB`, Johar Town `…M6PQ` (IDs until 01b names branches); Chicken Karahi Rs 2,200/kg; Paye Rs 450 (sold out when gone, keeps overnight, 07:00–13:00); Naan Rs 30; Lassi Rs 250 a glass (300 ml, counted in L); Seekh Kebab pieces.

---

## 1. Per screen

### 01a-S01 Owner sign in — `#/login`
**Frames:** `OwnerLogin` (LOGIN_INVALID), `OwnerLoginCloudDown` (busy + B04).

**Tree**
```
grid 1fr | 1fr
  aside (action ground): POS mark, headline, one line, footer caption
  main > form.pos-stack (max 420)
    .pos-section__head  h2 "Sign in" + p
    .pos-field Email     input.pos-input type=email autocomplete=username      (LTR)
    .pos-field Password  .pos-input-affix (input type=password + Show button)
    button.pos-btn--primary.pos-btn--lg.pos-btn--block "Sign in"  (.is-busy "Signing in…")
    .pos-banner (danger: LOGIN_INVALID | warn: B04)
```

**Fields → API:** `email` (trim), `password`. **Action:** `POST /v1/auth/login`; Enter submits; after 3 s show the slow banner (`common.slow`).

**States**

| State | Text |
|---|---|
| `LOGIN_INVALID` | "Email or password is wrong · Check both and try again." |
| `VALIDATION_FAILED` | Field error on the empty field. |
| Network | B04 banner; values kept. |
| `LOGIN_LOCKED_OUT` / `IP_LOCKED_OUT` | Reserved. Show the `LOGIN_INVALID` text (the API returns 401, M73). |

No "forgot password" link. **Taps:** 3.

### 01a-S02 Branch picker + navigation — `#/`
**Frame:** `OwnerBranchPicker` (new). The nav shell is in every owner frame.

**Tree**
```
.pos-appbar (brand, email, Sign out)
.pos-content--narrow
  h1.title "Which branch are you setting up?"   p.body-lg
  .pos-tiles.pos-tiles--pick (2 cols) > button.pos-tile[aria-pressed]
      name + small (mono ID tail · "2 floors · 3 stations")
  .pos-explain    (IDs show until names are set)
  .pos-callout    "Menu is the same for every branch" + a "Open the menu"   (Q7: menu needs no branch)
  primary "Continue with {branch}"
```

**Data:** `allowed_branch_ids`. Name and counts come from 01b `GET /v1/admin/branches` when it exists; until then show `…` + the last 4 characters of the ID in mono.

**Behaviour**
- If there is only one branch, skip this screen and auto-pick it.
- Keep the chosen branch in `sessionStorage`; today it is in memory and a reload loses it.
- The branch `<select>` in the Floors and Stations app bars switches branch.
- Sign out → `POST /v1/auth/logout`.

### 01a-S03 Floors and tables — `#/floors`
**Frames:** `OwnerFloors` (bulk add), `OwnerFloorsEmpty` (first run), `OwnerFloorsArchived` (Show archived on, name taken, saved chip), `OwnerTableDialog` (edit table), `OwnerArchiveFloor` (D01 blocked).

**Tree**
```
appbar: title · branch select · end: .pos-switch "Show archived" · primary "Add floor"
section.pos-section per floor
  head: h2 name, p "12 tables · 48 seats" · Rename · Archive | Restore
  .pos-tiles > button.pos-tile (name + small "4 seats")  → OwnerTableDialog
  .pos-tile--add "Add tables" → inline .pos-explain bulk row (From · To · Seats each · "Adds 4 tables: F9…F12" · Cancel · Add N tables)
archived floor: section on surface-sunken, chip "Archived" + Restore
```

**Fields → API**

| Field | API |
|---|---|
| Floor name | `name` (1–60, unique per branch) |
| Sort / position | `sort_order` (integer) |
| Table name | `name` (1–60, unique per branch, mono) |
| Seats | `seats` (1–100, optional) |
| Floor (in the table dialog) | `floor_id` (PATCH supports a move) |

**Actions**
- `POST /v1/admin/branches/:b/floors`, `PATCH …/floors/:id`, `POST …/tables`, `PATCH …/tables/:id`.
- Archive = PATCH `archived: true`; Restore = `archived: false`.
- Each POST carries `Idempotency-Key`, one ULID per form open.
- Bulk add (Q1) loops one POST per table. Each table gets its own key, derived from one key per form open + the table name, so a retry is safe. The button shows progress ("Adding 4 of 12…"). It stops on the first error and names it.

**States**

| State | Frame | UI |
|---|---|---|
| Loading | (as `OwnerMenuLoading`) | skeleton |
| Empty | `OwnerFloorsEmpty` | floor + bulk tables in one form, ≤ 6 actions |
| Saved | `OwnerFloorsArchived` | `.pos-chip--ok` "Saved" for 3 s near what changed (replaces today's silent save on blur) |
| `CONFIG_NAME_TAKEN` | `OwnerFloorsArchived` | field error "{name} is already used at {branch}. Pick another name." |
| `CONFIG_IN_USE` | `OwnerArchiveFloor` | lists `details.used_by.ids` as chips |
| `CONFIG_REFERENCE_INVALID`, `VALIDATION_FAILED` | — | field error |
| `IDEMPOTENCY_KEY_MISMATCH` | — | banner "This page is out of date. Reload." |
| `PERMISSION_DENIED` | — | read-only line |
| `*_NOT_FOUND` | — | banner "Someone removed this. The page is refreshed." + refetch |
| Network | — | B04 |

Parking spots are not tables.

### 01a-S04 Stations and programs — `#/stations`
**Frames:** `OwnerStations` (list + Degh open for edit), `OwnerAddStation`, `OwnerAddRecipe`, `OwnerArchiveStation` (D01, CONFIG_IN_USE).

**Fields → API**

| Field | Control | API |
|---|---|---|
| Name | input | `name` |
| Where it is | input | `location_label` |
| How it cooks | `.pos-tiles--pick` / `.pos-seg`: one order at a time = `slot`, in batches = `batch`. Disabled with help "Can't change while items use this station." when routes exist | `station_type` |
| How many at once | number | `capacity` (1–100) |
| A cooked batch stays fresh for | min, batch only | `freshness_window_ms` (0–60, 2 dp) |
| Cook marks it done by | select: Start + Done taps / One Done tap / Itself when time is up | `completion_mode` `two_tap` / `one_tap` / `auto` |
| Recipe name | input | program `name` |
| Recipe cooking time | min, ≤ 4 h | `cook_time_ms` |

**Actions:** `POST/PATCH /v1/admin/branches/:b/stations[/:id]`, `…/programs[/:id]` (Idempotency-Key on POST).

**States:** as S03, plus `CONFIG_IN_USE` on a type change or archive (`OwnerArchiveStation` lists the items, with the action "Open these items" → S05 filtered) and `PROGRAM_NOT_FOUND`.

### 01a-S05 Menu list — `#/menu`
**Frames:** `OwnerMenu` (items), `OwnerMenuCategories`, `OwnerMenuTax` (+ inline add), `OwnerMenuReadOnly` (B01), `OwnerMenuNoMatch`, `OwnerMenuLoading`, `OwnerMenuFirstRun`, `OwnerMenuPhone`, `OwnerMenuUrdu`, `OwnerTaxDialog`.

**Tree**
```
appbar: "Menu" · chip--info "Shared by every branch" · primary (New item | New category | New tax rate, per tab)
row: .pos-seg (Items 42 · Categories 6 · Tax rates 2)
     | search .pos-input-affix · category select · .pos-seg Active/Archived
ul.pos-list.pos-list--menu
  row: name + sub (unit · station) · category · .pos-list__num price "/ kg" · tags (branches, hours, sold out) · Edit
Load more (cursor)
```

The three API regions (tax classes, categories, items) become three tabs of one page.

**Data and API**
- `GET /v1/admin/menu?q&category_id&archived&cursor`. Search is debounced 300 ms, ≤ 60 chars. 50 items a page, then a **Load more** button.
- `POST/PATCH /v1/admin/tax-classes`, `…/categories`.
- Archive an item: `PATCH /v1/admin/menu-items/:id {archived:true}` after `OwnerArchiveItem`.

**Columns**

| Column | Source |
|---|---|
| Price | `price_minor` / 100, "Rs 2,200 / kg" (unit from `sale_unit`/`stock_unit`) |
| Branches | count of routes with a station ("2 of 2 branches"; warn when partial) |
| Hours | `availability_windows` (+ category windows) |
| Sold out when gone | `out_of_stock_behaviour = sold_out` |

**Categories tab:** order (`sort_order`), name, hours chip or "All day", item count, Edit (→ S06), Archive (→ `OwnerArchiveCategory`).

**Tax tab:** "No tax" is the fixed default row and can't be edited. Other rows show name, rate %, item count, Edit (→ `OwnerTaxDialog`: name + rate; rename and rate change are already in the API) and Archive (disabled while items use it). Inline add: name + rate (≤ 2 dp → `rate_bp`).

**States**

| State | Frame | UI |
|---|---|---|
| Loading | `OwnerMenuLoading` | skeleton rows |
| Read-only (`can_edit_tenant` false) | `OwnerMenuReadOnly` | info banner "You can see the menu but not change it. Only an owner of every branch can change the shared menu." No New buttons; Edit becomes View. |
| Empty menu | `OwnerMenuFirstRun` | 5-step checklist |
| No match | `OwnerMenuNoMatch` | `.pos-empty` "No items match "{q}"" + Clear search / Show archived |
| `CONFIG_IN_USE` | — | dialog listing the items |
| Network | — | B04 |

**Taps (Naan 30 → 35 on a phone):** search, Edit, price, Save = 4 (+ typing) ✓ ≤ 5.

### 01a-S06 Category form
**Frame:** `OwnerCategoryDialog`. Designed as a dialog (`.pos-dialog--form`) over the Categories tab, not a replacement page. Same fields:

| Field | API |
|---|---|
| Category name | `name` |
| Position | `sort_order` (help "1 shows first when ordering.") |
| When can it be ordered? | `.pos-seg` All day / Only at set hours → C01 |

Note line: "Every item in Breakfast follows these hours. An item can narrow them further, never widen them."

**Actions:** `POST /v1/admin/categories` (Idempotency-Key) / `PATCH`. **Cancel** on a changed form → D02.

### 01a-S07 Item form
**Frames:** `OwnerItem` (edit Biryani Full, with B02 in the aside), `OwnerItemNew` (Chicken Karahi by kg), `OwnerItemErrors` (fix list + field errors + C01), `OwnerItemPartial` (B03), `OwnerItemCloudDown` (B04), `OwnerItemPhone` (quick price change), `OwnerDiscard` (D02), `OwnerArchiveItem` (D01).

**Tree**
```
appbar: back "Menu" · title New item | Edit item · Cancel · primary Add item | Save item
[.pos-banner--danger "N things to fix" with anchor links]   [B03 / B04 banner]
.pos-split
  stack of .pos-section:
    What customers see — name, category select, group label, description
    Price — Sold by .pos-seg (Piece or plate | Weight (kg) | Volume (L)) · price .pos-input-affix (Rs | per {unit}) · Tax select (No tax default)
    Kitchen — .pos-list rows per branch: branch name + ID tail | station select ("Not sold here" first) | recipe select (batch only) or "Cooks each order · no recipe needed"
              grid: cooking time · extra time to plate · Serve .pos-seg (When ready | With the table)
    Ready-made stock — .pos-switch "Kept ready" · Counted in .pos-seg (Plates | kg from the pot | Litres)
              · .pos-explain conversion ("One plate takes 400 g … 10 kg counted = 25 plates"; hidden when units match)
              · serve from stock in · warn when below (stock unit) · When it runs out .pos-seg (Cook more | Sold out)
              · .pos-switch "Leftovers can be sold the next day"
    Hours — .pos-seg All day / Only at set hours → C01
    Archive this item (edit only) → D01
  aside.pos-card "How staff will see it": name + price, check list of facts, B02 warn banner when units change
```

**Fields → API** (UI word → field)

| UI | API | Rule |
|---|---|---|
| Item name | `name` | 1–60, unique |
| Group with other sizes | `group_label` | 0–60 (01c may replace) |
| Short description | `description` | — |
| Category | `category_id` | first active by default; none → Save disabled, "Add a category first" |
| Price | `price_minor` | typed rupees, commas ok, ≤ 2 dp, 0–10 000 000 |
| Tax | `tax_class_id` | No tax = null |
| Serve: When ready / With the table | `serve_mode` | `immediate` / `sync` |
| Cooking time | `cook_time_ms` | 1 min–4 h |
| Extra time to plate | `prep_buffer_ms` | 0–60 min |
| Serve from stock in | `stock_time_ms` | ≤ cook time |
| When it runs out: Cook more / Sold out | `out_of_stock_behaviour` | `cook_fresh` / `sold_out` |
| Counted in: Plates / kg from the pot / Litres | `stock_unit` | `piece` / `g` (shown kg) / `ml` (shown L) |
| Sold by | `sale_unit` | piece unless the stock unit is g/ml (then piece or same) |
| One plate takes | `stock_per_sale_unit` | only when units differ |
| Warn when below | `low_stock_threshold` | stock unit; empty = none; cleared on unit change |
| Leftovers can be sold the next day | `carries_over` | — |
| Hours | `availability_windows` | C01 |
| Station / recipe per branch | routes | `station_id`, `program_id` (batch required), stock program optional |

**Actions**
- New: `POST /v1/admin/menu-items` (Idempotency-Key, routes included).
- Edit: `PATCH` the changed fields, then one `PUT …/routes/:branch_id` per changed branch, in sequence.

**States**

| State | Frame | UI |
|---|---|---|
| Routes loading | — | skeleton in Kitchen |
| Busy / slow | — | `is-busy` + 3 s banner |
| Client check fails | `OwnerItemErrors` | top banner listing problems with links; each field marked |
| `CONFIG_NAME_TAKEN` | — | name field error |
| `CONFIG_REFERENCE_INVALID` | — | text by `details.reason`: `program_required` "Choose a batch recipe."; `stock_time_exceeds_cook_time` "Must be shorter than the cooking time ({n} min)."; `archived` "This {station/category} was archived. Pick another."; `wrong_branch` "This station belongs to another branch." |
| B02 unit change | `OwnerItem` | warn banner in the aside |
| B03 partial | `OwnerItemPartial` | warn banner + "Save {branch} again" + the failing route row marked |
| `PERMISSION_DENIED` / read-only | — | can't open (View only) |
| Network | `OwnerItemCloudDown` | B04, values kept, Save disabled until back |

**Taps (new Chicken Karahi):** name, category, Weight, price, station × 2, cook, prep, Kept ready, kg, warn-below, Add item ≈ 12 ✓.

**Phone (`OwnerItemPhone`):** price-first page. Price, tax, the On sale switch, then collapsed Kitchen / Hours rows with Edit, then **Save price**. The help line says "Was Rs 30. Open orders keep the old price." (D25).

### 01a-C01 Available hours field
**Frames:** `OwnerCategoryDialog`, `OwnerItemErrors`.

**Layout:** `.pos-seg` All day / Only at set hours, then up to 4 `.pos-hours-row` (From `type=time` mono · To · Remove), then "Add hours (N more allowed)".

**Messages**

| Case | Text |
|---|---|
| Wrap past midnight | info chip "22:00–02:00 runs past midnight" |
| Same time | error "From and To must be different." |
| Bad format | error "Enter times as HH:MM" |
| Item + category overlap | chip "Can be ordered 07:00–11:00 (item and category overlap)" |

**API:** `availability_windows: [{start_ms, end_ms}]`, ms from midnight, hub local time.

### 01a-B01 Read-only menu line
**Frame:** `OwnerMenuReadOnly`. Key `menu.read_only` (see S05).

### 01a-B02 Unit-change warning
**Frame:** `OwnerItem` (aside). "Counting changes from tomorrow · Each branch counts this item again when its next day starts."

### 01a-B03 Partial save
**Frame:** `OwnerItemPartial`. Banner: "Item saved. One branch was not. {Branch}: {reason text}. Pick another station or Not sold here, then save again." The button **Save {branch} again** retries only the failed `PUT routes`.

### 01a-B04 Cloud unreachable
**Frames:** `OwnerLoginCloudDown`, `OwnerItemCloudDown`. A warn pulse banner on every owner screen; values kept; Save disabled until a request succeeds (retry with backoff ≤ 5 s).

### 01a-D01 Archive confirm
**Frames:** `OwnerArchiveItem`, `OwnerArchiveCategory`, `OwnerArchiveFloor` (blocked), `OwnerArchiveStation` (blocked).

**Rule (Q2):**
- Confirm before archiving an item, a category, a station, a tax rate or a floor.
- Tables and recipes archive at once, with an undo chip ("Archived · Undo", 8 s), because they are cheap to restore.

The danger button names the thing ("Archive Paye"). A blocked case shows a reason and a way forward instead of an Archive button.

### 01a-D02 Discard changes?
**Frame:** `OwnerDiscard`. Shown when Cancel, Back or a nav item is used on a dirty form. **Keep editing** is primary; **Discard changes** is danger outline. The body names what changed (dirty fields → labels).

### 01a-S10 Stock — PIN sign-in
**Frames:** `StockPin`, `StockPinError` (wrong PIN + locked tile + forgot help), `StockPinNobody`, `StockPinOffline`.

**Tree:** tiles (roster `GET /admin/login-roster`, filtered to `manage-stock`) | `.pos-card` with `.pos-pin`. Same component as 00-S07.

**States**
- loading (skeleton tiles);
- nobody can open (`StockPinNobody`);
- `PIN_INVALID` (tries left ≤ 2);
- `PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT` (minutes from `retry_after_ms`, rounded up);
- 00-F02 / 00-F06;
- hub unreachable with **Retry now** (`StockPinOffline`).

**Taps:** 6.

### 01a-S11 Stock page — `/admin/stock`
**Frames:** `Main` (morning count), `StockPhone`, `StockAddSheet`, `StockUrdu`, `StockFeedback`, `StockOffline`, `StockNoDay`, `StockStale`, `StockCloseDay`, `StockMenuProblem`, `StockNotSaved`, `StockOpenedRecently`, `StockNoMatch`, `StockConfirmAll` (Q5), `StockCountsKept` (Q4).

**Regions, in order**
1. appbar
2. B10 status chip / problem banner
3. B16 reconnect banner
4. B12 stale card / B13 start-day card
5. B14 low/out chips
6. filter `.pos-seg` (To count · Low or out · Off · All) + search
7. list
8. sticky action bar

**Row:** `.pos-list__name` (name, sub, badges B15) · `.pos-count` (input mono + unit + `.pos-count__same` "Still right") · "Left to sell" `.pos-list__num` + "x on orders" · **Add** (opens `StockAddSheet` on phone, inline on tablet) · `.pos-switch` On/Off.

The word "Available" is not used. The number is "Left to sell"; the switch is "Selling On/Off".

**Fields → API**

| UI | API |
|---|---|
| Count now | `on_hand` (pieces whole; kg/L 3 dp; shown in kg/L, sent in g/ml) |
| Still right | re-sends the shown `on_hand` |
| Left to sell | `available` (0 when the count is not valid) |
| on orders | `reserved` |
| Counted at | `set_at` |
| Selling | `is_available` |
| Off since | `unavailable_since` |
| badges | `level` ok / low / out / not_counted |

**Actions** (all `/admin/commands/*`, `manage-stock`, command_id ULID kept for retry)

| Action | Command |
|---|---|
| Save N counts | `SetPrecookedStock { entries: [{item_id, on_hand}] }` (touched rows only) |
| Add | `AddPrecookedStock { item_id, quantity }` (sent at once; quick chips +5/+10/+20/+50 on phone) |
| Selling switch | `SetItemAvailability { item_id, is_available }` |
| Start day | `OpenBusinessDay {}` |
| Close day | D10 → `CloseBusinessDay {}` |
| Close it and start today | Close, then Open |
| All N are still right (Q5) | one `SetPrecookedStock` with the carried-over rows' shown values |

**Polling:** `GET /admin/queries/stock` + `GET /admin/queries/config-status` every 15 s. A row being edited is never overwritten, and polling is not counted as activity.

**States**

| State | Frame | UI |
|---|---|---|
| No day open | `StockNoDay` | B13 callout + Start day; rows show last counts, toggles work, counting locked |
| Yesterday still open | `StockStale` | B12 "Keep it open" / "Close it and start today" |
| Close day | `StockCloseDay` | D10 summary (started, keeps overnight, switched off) |
| Saved / added / switch failed | `StockFeedback` | B17 per row + action bar ("30 counts saved at 09:41") |
| Nothing to save | — | B17 info "Change or confirm a count first." |
| Hub unreachable | `StockOffline` | B16 + "2 counts waiting" |
| Menu update refused | `StockMenuProblem` | B10 danger + warn chip "Menu version 42" |
| `BUSINESS_DAY_NOT_OPEN` | `StockNotSaved` | B13 retry callout "Start day and save" (same command_id) |
| `opened_recently` | `StockOpenedRecently` | B18 info |
| No match / `STOCK_NOT_TRACKED` / `MENU_ITEM_NOT_FOUND` | `StockNoMatch` | info banner + empty |
| Idle sign-out | `StockCountsKept` | Q4: typed counts restored after sign-in |

### 01a-B10 … B18
Covered by the S11 frames above:

| ID | Frames |
|---|---|
| B10 | `Main` / `StockMenuProblem` |
| B11 | appbar chips in every stock frame, `StockStale` |
| D10 | `StockCloseDay` |
| B12 | `StockStale` |
| B13 | `StockNoDay`, `StockNotSaved` |
| B14 | `Main` |
| B15 | `Main`, `StockStale`, `StockConfirmAll` |
| B16 | `StockOffline` |
| B17 | `StockFeedback` |
| B18 | `StockOpenedRecently` |

The text is in the inventory table, with the spec text kept verbatim where marked *.

---

## 2. String keys (new; English)
Existing 01a keys keep their names. Only new or changed ones are listed.

| Key | English |
|---|---|
| owner.branch_title / branch_body | Which branch are you setting up? / Floors, tables and kitchen stations belong to one branch. You can switch any time from the top of the page. |
| owner.branch_ids_note | Branch names show once they are set in Branch settings. Until then the end of each branch's ID shows. |
| owner.menu_shared_title / menu_shared_body / open_menu | Menu is the same for every branch / Items, categories, prices and tax need no branch. / Open the menu |
| owner.continue_with | Continue with {branch} |
| owner.sign_out | Sign out |
| common.cloud_down / cloud_down_body | Can't reach the restaurant cloud — retrying… / Your changes stay on this page. Save works again when the internet is back. |
| common.saved | Saved |
| common.slow | Still working… |
| floors.first_title / first_body | Add your first floor / Name the floor, then add its tables in one go. You can rename or add more later. |
| floors.first_table / last_table / seats_each | First table / Last table / Seats per table (optional) |
| floors.adds_n | Adds {n} tables: {first} … {last}, {seats} seats each. |
| floors.parking_note | Parking is not a table; it has its own order type. |
| floors.add_floor_and_tables / adding_progress | Add floor and {n} tables / Adding {i} of {n}… |
| floors.show_archived / archived_on / restore | Show archived / Archived {date} · {n} tables · waiters can't pick it / Restore |
| errors.CONFIG_NAME_TAKEN_table | {name} is already used at {branch}. Pick another name. |
| errors.IDEMPOTENCY_KEY_MISMATCH | This page is out of date. Reload. |
| errors.NOT_FOUND_stale | Someone removed this. The page is refreshed. |
| menu.read_only / read_only_body | You can see the menu but not change it. / Only an owner of every branch can change the shared menu. |
| menu.no_match / no_match_body / clear_search / show_archived | No items match "{q}" / Check the spelling, or look in Archived. / Clear search / Show archived |
| menu.cats_order_help | Order sets where the category shows on the order screen. 1 shows first. |
| menu.tax_default | Default for new items |
| menu.new_tax / add_tax | New tax rate / Add tax rate |
| item.no_conversion | Sold by kg and counted in kg: no conversion needed. Half kg sells as 0.5. |
| item.partial / partial_body / save_branch_again | Item saved. One branch was not. / {branch}: {reason}. Pick another station or Not sold here, then save again. / Save {branch} again |
| item.price_was | Was Rs {old}. Open orders keep the old price. |
| item.save_price / on_sale_both | Save price / On sale at both branches |
| item.reach_branches | Each branch gets the new price within a minute. |
| archive.item_title / item_body | Archive {name}? / It disappears from ordering at both branches within a minute. Past orders and reports keep it. You can restore it from Archived. |
| archive.category_title / category_body | Archive {name}? / Its {n} items stop showing on the order screen too. Their stock counts and history stay. |
| archive.station_blocked / station_blocked_body / open_items | {name} can't be archived yet / {n} items are cooked here. Move them to another station or mark them Not sold here at {branch} first. / Open these items |
| archive.undo | Archived · Undo |
| discard.title / body / keep / discard | Discard your changes to {name}? / You changed {fields}. They are not saved yet. / Keep editing / Discard changes |
| stock.pin_nobody / pin_nobody_body | No one here can count stock / The owner gives the stock job to a person in Staff and roles. Then their name shows here. |
| stock.pin_offline_body / retry_now | The names appear when the hub answers. / Retry now |
| stock.menu_version_chip | Menu version {v} · checked {ago} |
| stock.not_saved_title / not_saved_body / start_and_save / waiting | These counts were not saved / The business day is not open, so this was not saved. Start the day to save it. Your {n} counts are kept. / Start day and save / {n} counts waiting |
| stock.opened_recently_small | Someone started it at {time}. Keep counting. |
| stock.no_match / no_match_body | No item matches "{q}" / Only items counted each morning and items you can switch off are here. |
| stock.carry_title / carry_body / carry_all | {n} counts from last night / If the pots still hold the same, confirm them all at once. Change any that are different first. / All {n} are still right |
| stock.counted_last_night | Counted last night {time} |
| stock.kept_title / kept_body / not_saved_yet / kept_on_device / discard | Your {n} unsaved counts from {time} are back. / You were signed out for being idle. Check them, then save. / Not saved yet / Kept on this tablet / Discard |

Urdu: `OwnerMenuUrdu` (owner app) and `StockUrdu` (stock page). The other keys need translation (`urdu-todo.md`).

---

## 3. Kit
No new classes for 01a beyond the shared `kit-additions.css` (01a block + 00 block). Change: `.pos-list__name span` → `.pos-list__name > span`.

## 4. Changes to shared components

| Change | Owner |
|---|---|
| `StaffTiles`: render the locked note ("Locked · 14 min" from `locked_until` / `retry_after_ms`) — not rendered today | 00 + 01a |
| `Dialog`: focus trap + Escape (missing today) | kit |
| App bar, side nav, list row, switch, segmented control, chip, sticky action bar, empty state, skeleton: implement as components from the kit classes; 01a is the first user | client |
| Toast: use a 3 s `.pos-chip--ok` near the changed element; undo chip for D01 cheap archives | client |
| Owner nav: menu items added by 01b, 01c, 05 must follow the `.pos-sidenav__item` pattern | 01b/01c/05 |
| `/admin/stock` moves inside the 00-S20 hub admin shell once it ships | 00 |

---

## 5. Coverage

### Screen IDs

| ID | Frames |
|---|---|
| S01 | OwnerLogin, OwnerLoginCloudDown |
| S02 | OwnerBranchPicker (+ nav in every owner frame) |
| S03 | OwnerFloors, OwnerFloorsEmpty, OwnerFloorsArchived, OwnerTableDialog |
| S04 | OwnerStations, OwnerAddStation, OwnerAddRecipe |
| S05 | OwnerMenu, OwnerMenuCategories, OwnerMenuTax, OwnerMenuReadOnly, OwnerMenuNoMatch, OwnerMenuLoading, OwnerMenuFirstRun, OwnerMenuPhone, OwnerMenuUrdu, OwnerTaxDialog |
| S06 | OwnerCategoryDialog |
| S07 | OwnerItem, OwnerItemNew, OwnerItemErrors, OwnerItemPartial, OwnerItemCloudDown, OwnerItemPhone |
| C01 | OwnerCategoryDialog, OwnerItemErrors |
| B01 | OwnerMenuReadOnly |
| B02 | OwnerItem |
| B03 | OwnerItemPartial |
| B04 | OwnerLoginCloudDown, OwnerItemCloudDown |
| D01 | OwnerArchiveItem, OwnerArchiveCategory, OwnerArchiveFloor, OwnerArchiveStation |
| D02 | OwnerDiscard |
| S10 | StockPin, StockPinError, StockPinNobody, StockPinOffline |
| S11 | Main, StockPhone, StockAddSheet, StockUrdu, StockNoMatch, StockConfirmAll, StockCountsKept |
| B10 | Main, StockMenuProblem |
| B11 | all stock frames (appbar), StockStale |
| D10 | StockCloseDay |
| B12 | StockStale |
| B13 | StockNoDay, StockNotSaved |
| B14 | Main |
| B15 | Main, StockStale, StockConfirmAll |
| B16 | StockOffline |
| B17 | StockFeedback |
| B18 | StockOpenedRecently |

All 26 IDs are designed.

### Jobs and story ACs

| AC | Frames |
|---|---|
| J1 sign in | OwnerLogin, OwnerLoginCloudDown |
| J2 branch | OwnerBranchPicker |
| J3 floors/tables (E1-FLR AC1, AC2, AC5) | OwnerFloors*, OwnerTableDialog, OwnerArchiveFloor |
| J4 stations (E1-FLR AC3–5, E3-KDS AC9) | OwnerStations, OwnerAddStation, OwnerAddRecipe, OwnerArchiveStation |
| J5 tax (E0-MENU AC8) | OwnerMenuTax, OwnerTaxDialog |
| J6 categories + hours (E0-MENU AC1, E0-AVAIL AC4) | OwnerMenuCategories, OwnerCategoryDialog |
| J7 item (E0-MENU AC2, AC3, AC7; E1-ROUTE AC1/2/4/5) | OwnerItem, OwnerItemNew, OwnerItemErrors, OwnerItemPartial |
| J8 find fast (S48) | OwnerMenu, OwnerMenuNoMatch, OwnerMenuPhone |
| J9 PIN (E0-PIN) | StockPin, StockPinError |
| J10 start day (S33) | StockNoDay |
| J11 counts (E1-STOCK AC1, AC6; E10-CNT AC1) | Main, StockConfirmAll, StockPhone |
| J12 fresh batch (S45) | StockAddSheet, StockFeedback |
| J13 Off/On (E0-AVAIL AC1, AC5) | Main, StockFeedback |
| J14 low/out (S46, E10-CNT AC1/3) | Main (B14 chips) |
| J15 close / stale (S33) | StockCloseDay, StockStale, StockOpenedRecently |
| J16 menu status (§6.21) | Main, StockMenuProblem |

### Not designed, and why
- **E0-MENU AC2 image upload:** not in the 01a spec.
- **E1-FLR AC1/AC2 2-D canvas, table shape and position:** the spec dropped them; tables are tiles per floor.
- **E0-AVAIL AC4 days of the week:** windows are daily in the spec.
- **01b-dependent:** branch names (shown as ID tails); branch settings (`tax_enabled`, `day_stale_after_hours`, `day_min_gap_hours`) go to 01b-S07.
- **Printed tickets:** module 01a prints nothing.
- **Urdu frames:** one per surface (OwnerMenuUrdu, StockUrdu); the rest go in `urdu-todo.md`.
- **Kiosk 1920 stock layout:** uses the tablet layout centered at `content-max` 1280; no separate frame.
