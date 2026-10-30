# 01c · Menu: variants, modifiers, deals — Brief

Sources used: spec `docs/specs/01c_Menu_Variants_Spec_v1.0.1.md` (APPROVED 2026-10-29; mainly §1, §3, §6, §8, §9, §12), owner-app UI contract `docs/plans/01c-ui-contract.md` (requirements only; the owner-app views are **not built**, AD-35), status board `docs/plans/01c-status.md` (AD rows), screen inventory `docs/design/inventory/01c-menu-variants.md` (written **before** the spec), the built hub stock page (`apps/client/src/features/admin/stock/`, 01c task 20) and its EN/UR strings (`apps/client/src/i18n/en.ts`, `ur.ts`), the demo seed (`apps/cloud/src/cli/seed-demo.ts`, 01c task 38), and the designer decisions of 2026-10-30 recorded in `docs/design/open-questions/01c-menu-variants.md` (Q1–Q18).

**Important:**
- **Not designed yet.** 01c has no design frames. The designer is drawing all 20 screens, with Urdu RTL (Q1: Decided (designer, 2026-10-30), status in progress; the owner chooses the look).
- **What is built.** The owner-app screens are not built (AD-35). Only the hub stock page rows (01c-B02) are built.
- **Where the copy comes from.**
  - Strings the spec fixes are quoted exactly.
  - Labels, buttons, empty states and messages decided by the designer are marked **Decided (designer, 2026-10-30)**.
  - Anything still not fixed is UNKNOWN.
- **Urdu.** None exists yet for any 01c owner-app string. The designer writes it with the frames, and the keys go into the design doc (Q5).
- **Owner-facing words** (Q4, Decided (designer, 2026-10-30)): the owner sees **"size group"** (code: variant group) and **"choice group"** (code: modifier group), never "variant" or "modifier". This brief uses the owner words in labels and the code names in API fields.

Sample data (from the demo seed; mock, never hard-code):
- **Restaurant:** Arif Chatkhara, branches Gulberg, Johar Town and DHA. DHA charges about 10 % more per branch price.
- **Size group Chicken Karahi** (category Karahi):
  - Chicken Karahi — Half, Rs 1,150, draws 500 g from Karahi pot.
  - Chicken Karahi — Full, Rs 2,200, draws 1 000 g.
- **Stock items:**

  | Stock item | Counted in | Counted at (station key in the seed) | Alert below | Keeps overnight |
  |---|---|---|---|---|
  | Karahi pot | g | Karahi | 1 kg | no |
  | Chicken tikka | pieces | BBQ | 10 | no |
  | Seekh kebab (4 pcs) | pieces | BBQ | 8 | no |
  | Chicken biryani | g | Karahi | 2 kg | no |
  | Fries | pieces | Fryer | 5 | no |
  | Raita | pieces | Drinks | 10 | yes |
  | Soft drink 1.5 L | pieces | Drinks | 6 | yes |

- **Choice groups:**
  - **Spice level:** pick 1 of Mild, Normal (default) or Hot, all free; used on category Karahi.
  - **Bread:** up to 6; Naan goes to the kitchen as the Naan item at its own price, up to 6; used on size group Chicken Karahi.
- **Deal Family karahi deal:** Rs 3,200, category Karahi, no tax, sold at every branch.
  - Part 1: 1 × Chicken Karahi — Full.
  - Part 2: 4 × Naan, or Roghni naan (+Rs 30).

---

## 1. Module summary

**What it is for.** 01c adds the menu shapes Pakistani restaurant ordering needs on top of 01a's plain items:
- **Size groups** (variant groups). One ordering tile with sizes (Half / Full, Small / Large). Each size is a full menu item with its own price, cooking time, station, branch prices, hours, stock and Selling switch. The group itself is never sold.
- **Stock items.** The "pot" counted each morning, separate from the menu, so Half and Full karahi share one count. Each stock item is counted at one station per branch.
- **Choice groups** (modifier groups). Choices on an item:
  - plain options: a note with a price, which can be free (Spicy, Extra raita);
  - options that go to the kitchen as another item (Naan), on that item's own station.

  They apply to categories, size groups or items, can be turned off for one of them ("Not here"), and can be offered and priced differently per branch.
- **Deals.** One price, one billed line. Each part goes to its own station; a part can offer a choice with a set extra price.
- **"Weighed when served".** For dishes priced per kg/L whose weight is known only at ordering or later (fish at the counter, desi murga).
- On the hub, the **stock page** now shows one row per stock item, with the dishes that draw from it listed under it.

**Who uses it, where, how often**

| Surface | Who (permission) | Device | How often |
|---|---|---|---|
| Owner app `/owner/` (cloud): item form sections, Size groups, Stock items, Choice groups, Deals | Owner. Tenant-level edits need an owner covering every branch (`can_edit_tenant`). Branch rows need the branch in the owner's allowed branches | Laptop 1440. Owner phone 390: **every 01c owner view has a 390 layout, one column, with branch rows stacked** (Q11, Decided (designer, 2026-10-30)) | Setup: ~20 sized items, ~10 choice groups, ~10 deals. Then monthly (a new deal) and occasional price changes. Calm; never during the rush |
| Hub stock page `/admin/stock` (01a-S11 with 01c-B02 rows) | Staff with `access-hub-admin` + `manage-stock` (scope `branch` or `my_stations`) | Counter tablet 1280, cashier kiosk 1280, manager's phone 390 | Daily: morning count, top-ups during the rush |
| Order taker, cook | See the result only (02 order screens, 03b tickets) | — | — |

No 01c screen is used on the kitchen screen (1920).

**Rules that apply everywhere**
- **Owner only.** Same sign-in and session handling as 01a and 01b, including `401` and `403 PASSWORD_CHANGE_REQUIRED`.
- **Read-only.** With `can_edit_tenant: false`, the tenant-level views open read-only (01a §8.1 rule): item form, size groups, stock item fields, choice group fields and deal fields. The "At each branch" rows stay editable for the owner's allowed branches. A tenant-level write without coverage → `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` (01a text).
- **Allowed branches only.** Every branch list shows only the owner's allowed branches.
- **No offline mode.** Every read and write needs the internet. Network failure or `503 SERVICE_UNAVAILABLE` → 01a-B04 banner, values kept, Save disabled until a read succeeds. The app never re-sends a failed write by itself.
- **Versions and stale saves.** Each of these carries a `version` that the form keeps and sends as `expected_version`: size group, stock item, choice group, deal, and each "At each branch" row.
  - On `409 CONFIG_STALE` the form shows the warn banner 01c-B03 ("Changed elsewhere" … "Reload"). The owner's draft stays editable and copyable until Reload. Never auto-retry.
  - This is one pattern for every module; 01b-B03 moves to it (Q8, Decided (designer, 2026-10-30)).
  - Menu items carry no version (last write wins).
- **One per-branch pattern** (Q15, Decided (designer, 2026-10-30)). Each 01c form has a section **"At each branch"** with one row per allowed branch. Each row has its own version and its own **"Save"** button, shown only when the row has unsaved changes. A row's stale banner shows on that row only. Lists show the same branch states as read-only chips.
- **Only send what changed.** A PATCH with only `expected_version` → `400`. A save that changes nothing answers `200` and writes nothing.
- **Lists inside a form are saved whole.** These are the options and "Applies to" links of a choice group, and the parts, choices and hours of a deal. A row the owner removes is **archived, never deleted**: it is listed under the form as **"Removed"** with **Restore** (01c-B06), and Restore brings back the same row (same id).
- **Error field paths.** A `422` names a field such as `options.2.linked_item_id` or `parts.1.choices.0.item_id`. The UI marks that row, counting rows in the order they were sent (01c-B01).
- **Not found** (Q17, Decided (designer, 2026-10-30)). On `404` for a size group, stock item, choice group or deal, the form is replaced by "This {size group / stock item / choice group / deal} isn't here any more. It may have been deleted on another device." with the button "Back to {list}". The list reloads.
- **Idempotency.** Every creating POST carries an `Idempotency-Key` made once and reused on its retries (01a rule).
- **Changes reach the hubs** on each hub's next config check (about a minute, 01a). A **stock unit change** takes effect on each hub at its next day open (notice on 01c-S07).
- **Language.** English and Urdu (RTL), as in 01a and 01b. Prices, quantities, units and IDs stay LTR. Every label needs EN and UR keys. The designer writes the Urdu with the frames, and the keys go into the design doc (Q5).
- **Lists** (Q12, Decided (designer, 2026-10-30)). Every 01c list has search by name and is sorted by `sort_order`, then name.
- **Never by dish name.** No rule depends on a dish or group name ("Karahi" is sample data only).

**Links to other modules**

| From | To | Why |
|---|---|---|
| 01c-S01 | 01a-S07 item form (01c-S01 is a set of new sections in it) | The item form gains "Size group", "Stock item" and "Weighed when served". v2.0 removes 01a's "Group with other sizes", "Counted in", "One plate takes", "Warn when below" and "Leftovers…" fields |
| 01a-S05 menu list | 01c-S08 / S01 | **A size group shows as one row with its sizes nested under it, expanded by default** (Q12, Decided (designer, 2026-10-30)). Search also matches the size group name |
| 01a phone quick-price page | 01c-S01 | **Shows the size group name above its sizes, and no 01c sections** (Q11, Decided (designer, 2026-10-30)) |
| 01c-S05 | 01a-C01 Available hours field | Deal "Hours" use 01a's hours rules |
| 01c-S05, S07, S01 | 01a categories, tax classes, stations (01a-S04, S06) | Pickers |
| 01c-D04 | 01a-D01 blocked dialog | Same "can't archive yet" pattern with new "used by" lists |
| 01c-S07 | 01b-S05 Stock counting | Who counts at a station (`my_stations`) now follows the stock item's station |
| Any versioned form in 00 / 01a / 01b | 01c-B03 | One stale pattern for every module (01b-B03 moves to it) |
| 01c-B02 | 01a-S10 / 01a-S11 hub stock page; 00-S20 hub admin home "Stock" | Stock page rows per stock item |
| 01c-S01, S08 | 02 order screens (02-D03 / 02-D04 in the 02 inventory; 02-S05) | Size tile, choices, deal line, "Sold out" |
| 01c-S05 | 03b tickets | Kitchen sees deal parts, not the deal |
| Owner shell side nav (01a-S02) | 01c-S08, S02, S04, S06 | Nav section **"Menu"**: "Items" (01a-S05), "Size groups" (01c-S08), "Choice groups" (01c-S02), "Deals" (01c-S04), "Stock items" (01c-S06) (Q4, Decided (designer, 2026-10-30)) |

---

## 2. Screen list

New IDs in this brief are marked ★. They are confirmed as written (Q2, Decided (designer, 2026-10-30)). 01c-D01 is retired (Q3).

| Screen ID | Name | Device | Who | How often | Used during rush? | Existing frame file names |
|---|---|---|---|---|---|---|
| 01c-S01 | Item form — "Size group", "Stock item" and "Weighed when served" sections (extends 01a-S07) | Laptop 1440, phone 390 | Owner | Setup, then weekly | no | none (being designed) |
| 01c-D01 | Retired by spec V2 — a size is a full item (01a-S07 + 01c-S01). | — | — | — | — | — |
| 01c-S08 ★ | Size groups list | Laptop 1440, phone 390 | Owner | Setup, rare | no | none (being designed) |
| 01c-S09 ★ | Size group form | Laptop 1440, phone 390 | Owner | Setup, rare | no | none (being designed) |
| 01c-S06 | Stock items list | Laptop 1440, phone 390 | Owner | Setup, rare | no | none (being designed) |
| 01c-S07 ★ | Stock item form, with "At each branch" rows | Laptop 1440, phone 390 | Owner | Setup, rare | no | none (being designed) |
| 01c-S02 | Choice groups list | Laptop 1440, phone 390 | Owner | Setup, monthly | no | none (being designed) |
| 01c-S03 | Choice group form (options, "Applies to", Removed) | Laptop 1440, phone 390 | Owner | Setup, monthly | no | none (being designed) |
| 01c-S10 ★ | Choice group — "At each branch" rows (option "Offered here / Price here") | Laptop 1440, phone 390 | Owner | Monthly | no | none (being designed) |
| 01c-D02 | "Applies to" dialog | Laptop 1440, phone 390 | Owner | Setup | no | none (being designed) |
| 01c-S04 | Deals list | Laptop 1440, phone 390 | Owner | Monthly | no | none (being designed) |
| 01c-S05 | Deal form (parts with choices, hours, Removed) | Laptop 1440, phone 390 | Owner | Monthly | no | none (being designed) |
| 01c-S11 ★ | Deal — "At each branch" rows ("Sold here / Price here") | Laptop 1440, phone 390 | Owner | Monthly | no | none (being designed) |
| 01c-D03 | Deal part choice picker | Laptop 1440, phone 390 | Owner | Monthly | no | none (being designed) |
| 01c-D04 ★ | In use — can't archive or change yet (extends 01a-D01) | Laptop 1440, phone 390 | Owner | Rare | no | none (01a `OwnerArchiveStation` is the pattern) |
| 01c-B01 | Rule and reference field errors | Laptop 1440, phone 390 | Owner | On error | no | none |
| 01c-B02 | Hub stock page — stock item row with its dishes (extends 01a-S11) | Tablet 1280, kiosk 1280, phone 390 | Manager / stock counter | Daily, many times | **yes** | none (built: `StockTable.tsx`) |
| 01c-B03 ★ | "Changed elsewhere" stale banner (one pattern for every module) | Laptop 1440, phone 390 | Owner | Rare | no | none |
| 01c-B04 ★ | Omitted at a branch warnings + "Checking branches…" | Laptop 1440, phone 390 | Owner | When it applies | no | none |
| 01c-B05 ★ | Required choice group with nothing offered at a branch (F1) | Laptop 1440, phone 390 | Owner | Rare | no | none |
| 01c-B06 ★ | "Removed" rows with Restore | Laptop 1440, phone 390 | Owner | Occasional | no | none |

**Count: 20 screens** (01c-D01 retired).

---

## 3. Screens

### 01c-S01 · Item form — "Size group", "Stock item" and "Weighed when served" sections
- **Job:** make an item a size in a size group, say which stock item it uses and how much per sale, or mark it weighed when served.
- **Entry points:**
  - 01a-S05 → New item, or an item → 01a-S07.
  - 01c-S09 "Open" on a size.
  - 01c-S09 "Add a size": a new item form with the size group and category already filled in.
- **Exits:**
  - Save → stays (01a "Saved" behaviour).
  - Cancel → 01a-S05.
  - "Open stock item" → 01c-S07, after the unsaved-changes guard.
  - Errors → 01c-B01, 01c-D04.
- **Information shown:**

| Info | Priority |
|---|---|
| Size group and size name | MUST |
| Stock item and "Uses per sale" **in the stock item's unit** (e.g. 500 g) | MUST |
| "Weighed when served" switch (only when Sold by is kg or L) | MUST |
| Read-only summary of the stock item: "{name} · counted in {unit} · keeps overnight / doesn't keep · {branch}: {station}, alert below {n}". One line per allowed branch, at most 3, then "+N more" (Q10) | USEFUL |
| Link "Open stock item" → 01c-S07 (Q10) | USEFUL |

- **Actions:**
  - PRIMARY: **Save item** (01a).
  - SECONDARY:
    - **Create a stock item with this name** (opens the inline mini-form);
    - **Open stock item**;
    - **Remove from size group** (Q4; sends size group and size name both null);
    - **Finish linking** (after a part-way create);
    - Cancel.
  - DESTRUCTIVE: Archive item (01a).
  - Inside the mini-form: **Create and link** (its own primary, scoped to the mini-form) and **Cancel** (Q9).
- **Inputs:**

| Field (label) | Type | Default | Validation | Error message |
|---|---|---|---|---|
| "Size group" (`variant_group_id`) | picker of active size groups, plus none | none (plain item); filled when opened from "Add a size" | active group of the tenant; the item's category must equal the group's | `not_found` → "This no longer exists. Pick another one."; `archived` → "This was archived. Pick another one."; `category_mismatch` → "Put this item in the same category as its size group."; `too_many_groups` (at `variant_group_id` when the save sets or changes the group, else `category_id`) → "An item can have up to 20 choice groups. Remove one first." |
| "Size name", e.g. Half (`variant_name`) | text | empty | 1–30, trimmed; required exactly when a size group is picked; unique among the group's active sizes (case-insensitive) | `409 CONFIG_NAME_TAKEN { entity: 'variant' }` → "That name is already used. Choose another name." (generic); `400` → UNKNOWN |
| "Stock item" (`stock_draws[0].stock_item_id`) | picker of active stock items, plus none | none | 0–1 draw; active stock item; unit rule below | `unit_mismatch` → "This stock is counted in a different unit. Sell this item by piece, or pick other stock."; `not_found` / `archived` → generic texts above |
| "Uses per sale" (`stock_draws[0].quantity_per_sale_unit`) | quantity in the stock item's unit (`parseQuantity` / `formatQuantity`) | 1 when the units match; empty and required when they differ | same unit as Sold by → 1 (hidden or locked: UNKNOWN); different units → item must be sold by piece, 1 … 1 000 000 | `unit_mismatch` → as above |
| "Weighed when served" (`requires_weighing`) | switch, shown only for kg / L items | off | only with Sold by g/ml; turning it on hides the Stock section | `weighed_item_stock_draw` → "Items weighed when served don't use stock. Remove the stock first."; `weighed_item_in_deal` → "Items weighed when served can't be in a deal."; `409 CONFIG_IN_USE { used_by: modifier_group }` → 01c-D04 |
| Mini-form "Name" | text | the size group's name if the item is in one ("Chicken Karahi"), else the item's name (Q9) | 1–60, unique among active stock items | `409 CONFIG_NAME_TAKEN { entity: 'stock_item' }` → "That name is already used. Choose another name." |
| Mini-form "Counted in" | choice piece / g / ml | the item's Sold by: kg → g, L → ml, piece → piece (Q9) | one of the three | — |
| Mini-form "Uses per sale" | quantity in the chosen unit | empty | shown only when "Counted in" differs from Sold by; then required, 1 … 1 000 000; differing units need the item sold by piece | "Create and link" stays disabled until filled (message UNKNOWN); `unit_mismatch` → "This stock is counted in a different unit. Sell this item by piece, or pick other stock." |

- **Decisions:** plain item or a size in a size group; one shared pot or its own stock; how much of the pot one sale takes; weighed at serving (no stock then).
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Plain item | no size group picked | "Size name" hidden or empty | "Size group" | none |
| In a size group | size group picked | "Size name" required; category must match the group | "Size group" / "Size name" | none |
| New size from 01c-S09 | "Add a size" | size group and category already filled in | — | none |
| Leaving a size group | "Remove from size group" | sends `{ variant_group_id: null, variant_name: null }` together | "Remove from size group" | none |
| No stock | no stock item | Stock section shows the picker and "Create a stock item with this name" | "Stock item" / "Create a stock item with this name" | none |
| Stock, same unit | stock unit = Sold by | "Uses per sale" is 1 | "Uses per sale" | none |
| Stock, different unit | item sold by piece, stock in g/ml | "Uses per sale" entered in the stock unit (e.g. "500 g") | "Uses per sale" | none |
| Stock summary | stock item picked | read-only summary line(s) under the picker; unit, alert and overnight are edited **only** on 01c-S07 (Q10) | "{name} · counted in {unit} · keeps overnight / doesn't keep · {branch}: {station}, alert below {n}"; "+N more"; "Open stock item" | none |
| Weighed when served on | switch on (kg/L item) | Stock section hidden; draw not sent | "Weighed when served" | none |
| Weighed switch hidden | Sold by piece | switch not shown | — | none |
| Mini-form open | "Create a stock item with this name" | **inline mini-form inside the Stock section, not a dialog** (Q9) | "Name" / "Counted in" / "Create and link" / "Cancel" | none |
| Mini-form, units differ (main case) | "Counted in" ≠ Sold by (piece-sold karahi drawing grams from one pot) | "Uses per sale" appears, required and empty; "Create and link" waits for it | "Uses per sale" | none |
| Creating stock item | "Create and link" | 3 calls in order: create the stock item (keeps overnight off, no alert) → "Counted here" at each branch where the item is routed, with that route's station → item save with the draw. All of these can be edited later on 01c-S07 | "Creating stock item… (1 of 3)" | none |
| Create stopped part-way | one of the 3 calls failed | the created stock item stays (it is on 01c-S06) | "Stock item made, but the item isn't linked yet." / "Finish linking" | none |
| Create retry | "Finish linking" | same Idempotency-Key for the create; re-reads the stock item and its branch rows; sends only the calls still needed, each with the version just read (never a false stale or name-taken error) | "Creating stock item… (n of 3)" | none |
| Mini-form cancelled | "Cancel" | mini-form closes; nothing sent | — | none |
| Rule error | `422` with one of the reasons above | field marked (01c-B01) | per reason, see 01c-B01 | none |
| In use | `409 CONFIG_IN_USE` on archive, unit change or turning weighing on | 01c-D04 | see 01c-D04 | none |
| Restore blocked | restoring an item whose size group or stock item is archived | field error at `variant_group_id` / `stock_draws.0.stock_item_id` | "This was archived. Pick another one." | none |
| Busy / slow / cloud down / read-only / name taken | as 01a-S07 | as 01a-S07 | as 01a-S07 | none |
| Too busy | `503 SERVICE_UNAVAILABLE` after the save's restart limit | 01a-B04 | see 01a-B04 | none |
| Phone | 390 | one column; summary lines stack; 01a's phone quick-price page shows no 01c sections (Q11) | — | none |
| Urdu RTL | Urdu | mirrored; quantities LTR | designer writes it | none |

- **Error codes:**
  - `CONFIG_REFERENCE_INVALID`: `not_found`, `archived`, `category_mismatch`, `unit_mismatch`, `too_many_groups`, `weighed_item_stock_draw`, `weighed_item_in_deal`.
  - `CONFIG_NAME_TAKEN`: `variant`, `stock_item`.
  - `CONFIG_IN_USE`: `used_by` `modifier_group` or `deal`; choice groups are reported first.
  - Others: `VALIDATION_FAILED` (`400`), `PERMISSION_DENIED`, `MENU_ITEM_NOT_FOUND`, `SERVICE_UNAVAILABLE`, `IDEMPOTENCY_KEY_MISMATCH`.
- **Edge cases:**
  - Changing the item's category while it is in a size group → `category_mismatch`. Only the size group's own category move changes its sizes.
  - Changing Sold by while a deal part offers the item, and the part would mix units → `409 CONFIG_IN_USE { used_by: deal }`.
  - Changing Sold by away from piece, or turning weighing on, while an active option sends the item to the kitchen → `409 { used_by: modifier_group }`.
  - Turning weighing on while a deal offers the item → `weighed_item_in_deal` at `requires_weighing`.
  - Changing Sold by to piece on a weighed item → `400`.
  - Archiving an item that an option of an active choice group sends to the kitchen, or that an active deal part offers → `409 CONFIG_IN_USE`.
  - Mini-form with an item sold by kg and "Counted in" set to piece → `unit_mismatch` (only piece-sold items can use a different unit).
  - The order line's name is the item's own name ("Chicken Karahi — Full"), so each size is named in full.
- **Data needed:**
  - `GET /v1/admin/menu`: `variant_groups`, archived included; per item `variant_group_id`, `variant_name`, `stock_draws`, `requires_weighing`, routes.
  - `GET /v1/admin/stock-items`: names, units, `carries_over`, branch rows and versions (for the summary line).
  - 01a categories and stations.

### 01c-D01 · Retired
Retired by spec V2 — a size is a full item (01a-S07 + 01c-S01). Q3 is Decided (designer, 2026-10-30), and the inventory now carries only this line. States: none.

### 01c-S08 ★ · Size groups list
- **Job:** see and open the ordering tiles that hold sizes.
- **Entry points:** nav "Menu" → "Size groups".
- **Exits:** a group → 01c-S09; "New size group" → 01c-S09 (new).
- **Information shown** (columns, Q12):

| Info | Priority |
|---|---|
| Name | MUST |
| Category | MUST |
| Sizes: chips with price ("Half Rs 1,150", "Full Rs 2,200") | MUST |
| Archived groups (the menu read returns them) | RARE |

- **Actions:** PRIMARY **New size group**; SECONDARY open a group; RARE show archived (label UNKNOWN).
- **Inputs:** search by name. Sort is `sort_order`, then name.
- **Decisions:** which tile to edit.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Loading | open | skeleton | — | none |
| List | groups exist | rows with size chips | "Size groups" | none |
| Empty | no groups | empty state | "No size groups yet. Make one when a dish comes in sizes, like Half and Full." | none |
| No search match | search finds nothing | UNKNOWN | UNKNOWN | none |
| Archived shown | toggle | archived groups listed | UNKNOWN | none |
| Read-only | `can_edit_tenant` false | no "New size group"; rows open as view | — | none |
| Cloud down | network / `503` | 01a-B04 | see 01a-B04 | none |
| Phone | 390 | one column; chips wrap | — | none |
| Urdu RTL | Urdu | mirrored; prices LTR | designer writes it | none |

- **Error codes:** `SERVICE_UNAVAILABLE`.
- **Edge cases:** a group shows as a tile at a branch only when at least one active size is routed there. Whether this shows on the list: UNKNOWN.
- **Data needed:** `GET /v1/admin/menu` → `variant_groups` (`variant_group_id`, `name`, `category_id`, `description`, `sort_order`, `archived`, `member_ids`, `version`) and each size's name and price.

### 01c-S09 ★ · Size group form
- **Job:** name the tile, set its category and order, and see its sizes.
- **Entry points:** 01c-S08.
- **Exits:**
  - Save, or Cancel → 01c-S08.
  - "Open" on a size → 01c-S01.
  - "Add a size" → new 01c-S01.
  - Archive blocked → 01c-D04.
  - Stale → 01c-B03.
  - Not found → back to 01c-S08.
- **Information shown:**

| Info | Priority |
|---|---|
| Name, category | MUST |
| Sizes, read-only: size name, price, "Open" link (Q16) | USEFUL |
| Description, sort order | RARE |

- **Actions:**
  - PRIMARY: **Save**.
  - SECONDARY: **Add a size**; "Open" on a size; Cancel.
  - DESTRUCTIVE: **Archive** (only with no active sizes).
  - RARE: Restore (archived group).
  - No reordering of sizes in the pilot (Q16).
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Name (`name`) | text | empty | 1–60, trimmed, unique among active groups (case-insensitive) | `409 CONFIG_NAME_TAKEN { entity: 'variant_group' }` → "That name is already used. Choose another name." |
| Category (`category_id`) | select | UNKNOWN | active category | `not_found` / `archived` → generic texts; `too_many_groups` at `category_id` → "An item can have up to 20 choice groups. Remove one first." |
| Description (`description`) | text | empty | UNKNOWN length | — |
| Sort order (`sort_order`) | integer | 0 | — | — |

- **Decisions:** tile name; which category the tile and all its sizes sit in.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| New | "New size group" | empty form; POST with Idempotency-Key; no sizes yet | UNKNOWN | none |
| Edit | open group | form with version; sizes listed read-only | UNKNOWN | none |
| Category moved | category changed and saved | every size moves too, archived ones included | UNKNOWN (no notice is specified) | none |
| Busy / slow | save | busy button; "Still working…" after 3 s | "Still working…" | none |
| Name taken | `409 CONFIG_NAME_TAKEN` | name field error | "That name is already used. Choose another name." | none |
| Archive blocked | `409 CONFIG_IN_USE { used_by: menu_item }` | 01c-D04 listing active sizes | see 01c-D04 | none |
| Stale | `409 CONFIG_STALE { entity: 'variant_group' }` | 01c-B03 | see 01c-B03 | none |
| Not found | `404 VARIANT_GROUP_NOT_FOUND` | form replaced; the list reloads | "This size group isn't here any more. It may have been deleted on another device." / "Back to Size groups" | none |
| Read-only | `can_edit_tenant` false | view only | — | none |
| Cloud down | network / `503` | 01a-B04 | see 01a-B04 | none |
| Phone | 390 | one column | — | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `CONFIG_REFERENCE_INVALID` (`not_found`, `archived`, `too_many_groups`), `CONFIG_STALE`, `VARIANT_GROUP_NOT_FOUND`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `SERVICE_UNAVAILABLE`.
- **Edge cases:** a group holds items only, never groups (one level). Sizes are added only from the item form (Q16).
- **Data needed:** the group from the menu read; categories; each size's name, price and `item_id`.

### 01c-S06 · Stock items list
- **Job:** see every counted pot or pack, its unit, which dishes use it and where it is counted.
- **Entry points:**
  - Nav "Menu" → "Stock items".
  - After a part-way "Create and link", the created item is listed here.
- **Exits:** a stock item → 01c-S07; "New stock item" → 01c-S07 (new).
- **Information shown** (columns, Q12):

| Info | Priority |
|---|---|
| Name | MUST |
| Counted in | MUST |
| Used by: dish + amount ("Half 500 g, Full 1 kg") | MUST |
| Counted at: branch: station (read-only chips) | USEFUL |
| Keeps overnight | USEFUL |
| Archived stock items (`status=archived`) | RARE |

- **Actions:** PRIMARY **New stock item**; SECONDARY open; RARE show archived.
- **Inputs:** search by name, **also matching dish names**; status `active` (default) / `archived`. Sort is `sort_order`, then name.
- **Decisions:** which stock item to edit.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Loading | open | skeleton | — | none |
| List | items exist | rows | "Stock items" | none |
| Empty | none | empty state | "No stock items yet. Add the pots and packs you count each morning." | none |
| No search match | search finds nothing | UNKNOWN | UNKNOWN | none |
| Archived | status archived | archived rows with Restore | UNKNOWN | none |
| Not counted anywhere | every branch entry has `station_id: null` | no "Counted at" chips | UNKNOWN | none |
| Read-only | `can_edit_tenant` false | no "New stock item"; branch rows still editable in the form | — | none |
| Cloud down | network / `503` | 01a-B04 | see 01a-B04 | none |
| Phone | 390 | one column; chips stack | — | none |
| Urdu RTL | Urdu | mirrored; units LTR | designer writes it | none |

- **Error codes:** `SERVICE_UNAVAILABLE`.
- **Edge cases:** one stock item can feed dishes in different size groups.
- **Data needed:** `GET /v1/admin/stock-items?status=` → `can_edit_tenant` and `stock_items[]`:
  - `stock_item_id`, `name`, `stock_unit`, `carries_over`, `archived`, `version`;
  - `branches[{ branch_id, station_id, low_stock_threshold, version }]`;
  - `drawers[{ item_id, name, variant_name, quantity_per_sale_unit }]`;
  - plus station names.

### 01c-S07 ★ · Stock item form
- **Job:** name the pot, set its unit and overnight rule, and at each branch say which station counts it and when to warn.
- **Entry points:** 01c-S06; "Open stock item" on 01c-S01 (Q10).
- **Exits:** Save → 01c-S06; Cancel → 01c-S06; archive blocked → 01c-D04; stale → 01c-B03; not found → 01c-S06.
- **Information shown:**

| Info | Priority |
|---|---|
| Name, "Counted in", "Keeps overnight" | MUST |
| Section "At each branch": one row per allowed branch with "Counted here" switch · station · alert below (Q15) | MUST |
| Dishes that draw from it and how much each uses | USEFUL |
| Unit change notice (when the unit is changed) | USEFUL |

- **Actions:**
  - PRIMARY: **Save** (tenant fields).
  - SECONDARY: per branch row, **Save** (shown only when the row has unsaved changes; own version, own PUT).
  - DESTRUCTIVE: **Archive**.
  - RARE: Restore.
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Name (`name`) | text | empty | 1–60, unique among active stock items | `409 CONFIG_NAME_TAKEN { entity: 'stock_item' }` → "That name is already used. Choose another name." |
| "Counted in" (`stock_unit`) | choice piece / g / ml | UNKNOWN for a new item from the list | one of the three | `422 unit_mismatch` at `stock_unit` → "Some dishes use this stock in the old unit. Change those dishes first." (key `errors.reference.unit_mismatch_stock`) |
| "Keeps overnight" (`carries_over`) | switch | off | boolean | — |
| Branch row: "Counted here" | switch | off (no row) | off sends `station_id: null` | — |
| Branch row: station (`station_id`) | select of that branch's active stations | — (shown when "Counted here" is on) | active station of that branch | `not_found` / `archived` → generic texts; `wrong_branch` → "This station belongs to another branch." |
| Branch row: alert below (`low_stock_threshold`) | quantity in the stock unit | empty (none) | none or 0 … 1 000 000; not allowed with "Counted here" off (`400`) | UNKNOWN |

- **Decisions:** one pot for several dishes or one each; who counts it at each branch; warning level.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| New | "New stock item" | empty form | UNKNOWN | none |
| Edit | open | form + "At each branch" rows, each with its own version | "At each branch" | none |
| Counted at a branch | "Counted here" on | station and alert shown | "Counted here" | none |
| Not counted at a branch | "Counted here" off (`station_id: null`) | station and alert hidden | "Counted here" | none |
| Row has changes | edit in a branch row | that row's "Save" appears | "Save" | none |
| Unit change notice | "Counted in" changed, **before Save** (Q18) | warn notice | "New unit starts at each branch's next day open. Today's counts stay in {old}; count in {new} from tomorrow." | none |
| Unit blocked | `422 unit_mismatch` at `stock_unit` | unit field error | "Some dishes use this stock in the old unit. Change those dishes first." | none |
| Archive blocked | `409 CONFIG_IN_USE { used_by: menu_item }` | 01c-D04 listing dishes | see 01c-D04 | none |
| Branch row stale | `409 CONFIG_STALE { entity: 'stock_item_branch' }`, e.g. two tabs set a branch the first time | 01c-B03 **on that row only** | see 01c-B03 | none |
| Stock item stale | `409 CONFIG_STALE { entity: 'stock_item' }` | 01c-B03 | see 01c-B03 | none |
| Branch row on archived item | `422 stock_item_id archived` | row error | "This was archived. Pick another one." | none |
| Not found | `404 STOCK_ITEM_NOT_FOUND` | form replaced; the list reloads | "This stock item isn't here any more. It may have been deleted on another device." / "Back to Stock items" | none |
| Branch not found | `404 BRANCH_NOT_FOUND` | UNKNOWN | UNKNOWN | none |
| Busy / slow / cloud down | as 01a | as 01a | "Still working…" | none |
| Read-only | `can_edit_tenant` false | tenant fields view only; branch rows editable for allowed branches | — | none |
| Phone | 390 | one column; branch rows stack | — | none |
| Urdu RTL | Urdu | mirrored; quantities LTR | designer writes it | none |

- **Error codes:** `CONFIG_NAME_TAKEN`, `CONFIG_REFERENCE_INVALID` (`unit_mismatch`, `not_found`, `archived`, `wrong_branch`), `CONFIG_IN_USE`, `CONFIG_STALE`, `STOCK_ITEM_NOT_FOUND`, `BRANCH_NOT_FOUND`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `SERVICE_UNAVAILABLE`.
- **Edge cases:**
  - Archiving a station (01a) that is used by an active "Counted here" row → `409 CONFIG_IN_USE { used_by: stock_item }` on the station.
  - A stock item counted at a branch where no dish draws from it shows on the hub stock page as "Not used by any dish here" (01c-B02).
  - The branch PUT answers `{ branch: null }` after "Counted here" is turned off.
- **Data needed:** the item from `GET /v1/admin/stock-items`; each branch's active stations.

### 01c-S02 · Choice groups list
- **Job:** see every choice group (Spice level, Bread) and where it applies.
- **Entry points:** nav "Menu" → "Choice groups".
- **Exits:** a group → 01c-S03; "New choice group" → 01c-S03.
- **Information shown** (columns, Q12):

| Info | Priority |
|---|---|
| Name | MUST |
| Customers pick: "Pick 1" / "Up to 6" / "Pick 1–2" | MUST |
| Options: first 3 + "+N" | MUST |
| Applies to | USEFUL |
| Branch warnings: 01c-B04, 01c-B05 as read-only chips | USEFUL |
| Archived groups | RARE |

- **Actions:** PRIMARY **New choice group**; SECONDARY open; RARE show archived.
- **Inputs:** search by name; status `active` / `archived`. Sort is `sort_order`, then name.
- **Decisions:** which group to edit.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Loading | open | skeleton | — | none |
| List | groups exist | rows | "Choice groups" | none |
| Empty | none | empty state | "No choice groups yet. Add one for things like spice level or extra naan." | none |
| No search match | search finds nothing | UNKNOWN | UNKNOWN | none |
| Checking branches | menu pages still loading | no omission warnings | "Checking branches…" | none |
| Omission warning | an option's kitchen item has no route at X (after the last menu page) | 01c-B04 chip | "Not offered at X: its item is not sold there" | none |
| Required group empty at a branch | F1 | 01c-B05 chip | see 01c-B05 | none |
| Archived | status archived | archived groups with Restore | UNKNOWN | none |
| Read-only | `can_edit_tenant` false | no "New choice group" | — | none |
| Cloud down | network / `503` | 01a-B04 | see 01a-B04 | none |
| Phone | 390 | one column | — | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** `SERVICE_UNAVAILABLE`.
- **Edge cases:** an omission warning must never appear from a partial load.
- **Data needed:**
  - `GET /v1/admin/modifier-groups?status=`: groups with `options`, `archived_options`, `links`, `branches`, `version`, `can_edit_tenant`.
  - Every `GET /v1/admin/menu` page, for item routes and the names of "Applies to" targets.

### 01c-S03 · Choice group form
- **Job:** define a choice group: its options, how many the customer must and may pick, defaults, and what it applies to.
- **Entry points:** 01c-S02.
- **Exits:**
  - Save → 01c-S02; Cancel.
  - "Applies to" → 01c-D02.
  - "At each branch" → 01c-S10, a section of this form.
  - Stale → 01c-B03.
  - Not found → 01c-S02.
- **Information shown:**

| Info | Priority |
|---|---|
| Name, "Customers pick" (at least / at most) | MUST |
| Options table, one row per option (see Inputs) | MUST |
| "Applies to" list: category / size group / item, with "Use" or "Not here" | MUST |
| Section "At each branch" (01c-S10) | USEFUL |
| "Removed" options with Restore (01c-B06) | USEFUL |
| Sort order | RARE |

- **Actions:**
  - PRIMARY: **Save**.
  - SECONDARY:
    - **Add option**;
    - remove an option row (it is archived on save);
    - **Restore**;
    - "Applies to" → 01c-D02;
    - Cancel.
  - DESTRUCTIVE: archive group.
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Name (`name`) | text | empty | 1–40, unique among active groups | `409 CONFIG_NAME_TAKEN { entity: 'modifier_group' }` → "That name is already used. Choose another name." |
| "Customers pick" — at least (`min_choices`) | number | 0 (inventory) | 0 … 50; ≤ at most; ≤ Σ "Up to" of active options | `choices_unsatisfiable` → "Customers must pick more than these options allow. Lower 'at least' or raise 'up to'." |
| "Customers pick" — at most (`max_choices`) | number | 1 (inventory) | 1 … 50; ≥ at least; ≥ number of defaults | `defaults_exceed_max` → "Too many options are set as default. Untick some or raise 'at most'." |
| Option name (`options.N.name`) | text | empty | 1–40, unique in the group (case-insensitive) | `409 CONFIG_NAME_TAKEN { entity: 'modifier_option' }` → "That name is already used. Choose another name." |
| Option price (`price_minor`) | Rs | UNKNOWN | plain: required, 0 … 1 000 000 000 (0 = free is valid). With "Goes to kitchen as": empty = that item's own branch price, or a value in range | `400` → UNKNOWN |
| "Up to" (`max_quantity`) | number | 1 | 1 … 20 | `400` → UNKNOWN |
| "Default" (`is_default`) | checkbox | off | defaults ≤ at most | `defaults_exceed_max` → as above |
| "Goes to kitchen as" (`linked_item_id`) | item picker or none | none (plain option) | active item sold by piece and not weighed | `linked_item_not_piece` → "Only items sold by piece can be an option."; `archived` / `not_found` → generic texts |
| Option order (`sort_order`) | integer / drag (UNKNOWN) | 0 | — | — |
| "Applies to" (`links`) | via 01c-D02 | none | 0–500; one per target; no "Not here" on a category; ≤ 20 choice groups on any item | `too_many_groups` at `links` → "An item can have up to 20 choice groups. Remove one first."; `400` at `links.N.target_id` → UNKNOWN |

- **Decisions:**
  - Required or optional: at least ≥ 1 makes the group required.
  - Paid or free.
  - A plain note, or an item that goes to its own station.
  - A preselected default, e.g. "Normal" (G3 5).
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| New | "New choice group" | empty; 1 option row needed | UNKNOWN | none |
| Edit | open | options with `option_id`, links, version | UNKNOWN | none |
| Plain option | no "Goes to kitchen as" | price required | UNKNOWN | none |
| Kitchen option | item picked in "Goes to kitchen as" | price optional (empty = the item's price); the row shows it goes to that item's station | "Goes to kitchen as" | none |
| Option removed | owner removes a row and saves | row archived, moves to "Removed" | "Removed" | none |
| Option restored | "Restore" | same option back (same id) | "Restore" | none |
| Rule error | `422` at `min_choices`, `options`, `options.N…` or `links` | 01c-B01 on the row as sent | per reason, see 01c-B01 | none |
| Name taken | `409 CONFIG_NAME_TAKEN` | field error | "That name is already used. Choose another name." | none |
| Stale | `409 CONFIG_STALE { entity: 'modifier_group' }` | 01c-B03 | see 01c-B03 | none |
| Restore group blocked | restoring a group whose kitchen item is now archived or not sold by piece | field error at `options.N.linked_item_id` | "Only items sold by piece can be an option." / "This was archived. Pick another one." | none |
| Not found | `404 MODIFIER_GROUP_NOT_FOUND` | form replaced; the list reloads | "This choice group isn't here any more. It may have been deleted on another device." / "Back to Choice groups" | none |
| Busy / slow / cloud down / read-only | as 01a | as 01a | "Still working…" | none |
| Phone | 390 | one column; option rows stack | — | none |
| Urdu RTL | Urdu | mirrored; prices LTR | designer writes it | none |

- **Error codes:**
  - `CONFIG_NAME_TAKEN`: `modifier_group`, `modifier_option`.
  - `CONFIG_REFERENCE_INVALID`: `choices_unsatisfiable`, `defaults_exceed_max`, `linked_item_not_piece`, `too_many_groups`, `not_found`, `archived`.
  - Others: `CONFIG_STALE`, `MODIFIER_GROUP_NOT_FOUND`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `SERVICE_UNAVAILABLE`, `IDEMPOTENCY_KEY_MISMATCH`.
- **Edge cases:**
  - A plain option never changes station, cook time or serve mode. Only a "Goes to kitchen as" item does, using that item's own settings.
  - Inside a deal part, or as a kitchen option, an item offers only its plain options.
  - Options and links are sent whole. A new row carries no id (an id on a new row → `400`). Another group's option id → `422 options.N.option_id not_found`.
  - A group has 1–50 options.
- **Data needed:** the group from `GET /v1/admin/modifier-groups`; items with `sale_unit`, `requires_weighing` and routes; categories; size groups.

### 01c-S10 ★ · Choice group — "At each branch" rows
- **Job:** at one branch, switch off an option or give it a different price.
- **Entry points:** section "At each branch" on 01c-S03 (Q15).
- **Exits:** row "Save" → stays; stale → 01c-B03 on that row; F1 → 01c-B05.
- **Information shown:**

| Info | Priority |
|---|---|
| One row per allowed branch; **the row expands to its options** | MUST |
| Each option: "Offered here" switch, "Price here" (base price as reference) | MUST |
| F1 warning when a required group has nothing offered at that branch | MUST (when it applies) |

- **Actions:** PRIMARY: row **Save**, shown only when the row has unsaved changes. SECONDARY: reset all to defaults (sends `options: []`); label UNKNOWN.
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| "Offered here" (`is_offered`) | switch per option | on | — | — |
| "Price here" (`price_minor_override`) | Rs per option | empty (base price) | none or 0 … 1 000 000 000; not allowed when not offered (`400`) | UNKNOWN |

- **Decisions:** which options this branch sells and at what price (G3 8: rent and costs differ by area).
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Collapsed | default | branch row with state chips | branch name | none |
| Expanded | tap the row | options with "Offered here" / "Price here" | "Offered here / Price here" | none |
| Defaults | no differences stored | every option offered at its base price | — | none |
| Row has changes | an edit | row "Save" appears; only differences are saved (whole list, 0–50) | "Save" | none |
| Required group empty here | required group with nothing offered here | 01c-B05; save allowed; the group's items can't be ordered at this branch | see 01c-B05 | none |
| Stale | `409 CONFIG_STALE { entity: 'modifier_group_branch' }` | 01c-B03 on this row only | see 01c-B03 | none |
| Group archived | `422 modifier_group_id archived` | row error | UNKNOWN | none |
| Unknown option | `422 options.N.option_id not_found` | row error | "This no longer exists. Pick another one." | none |
| Read-only | branch not in allowed branches | branch not listed | — | none |
| Busy / cloud down | as 01a | as 01a | "Still working…" | none |
| Phone | 390 | rows stack; expanded options in one column | — | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** `CONFIG_STALE`, `CONFIG_REFERENCE_INVALID` (`archived`, `not_found`), `VALIDATION_FAILED`, `BRANCH_NOT_FOUND`, `MODIFIER_GROUP_NOT_FOUND`, `SERVICE_UNAVAILABLE`. This PUT takes no Idempotency-Key.
- **Edge cases:**
  - Price order at a branch: "Price here" > the option price > the kitchen item's own branch price.
  - A kitchen option is offered at a branch only where its item is routed; otherwise 01c-B04.
- **Data needed:** the group's `branches[{ branch_id, options[{ option_id, is_offered, price_minor_override }], version }]`.

### 01c-D02 · "Applies to" dialog
- **Job:** choose where the choice group is used, and where it is not.
- **Entry points:** 01c-S03 "Applies to".
- **Exits:** "Done" → 01c-S03 (links are saved with the group); close/cancel (label UNKNOWN).
- **Information shown** (Q13):

| Info | Priority |
|---|---|
| Search at the top | MUST |
| 3 tabs with counts: "Categories" / "Size groups" / "Items". Items are grouped by category and load in pages | MUST |
| Each row: name + a 3-way control "—" / "Use" / "Not here" ("Not here" is not shown on categories) | MUST |
| Strip at the bottom: "Used on 3 · Not here on 1" | USEFUL |
| Rule note: "The most specific wins: item > size group > category." | USEFUL |

- **Actions:** PRIMARY **Done**; SECONDARY the 3-way control per row, tab switch, search.
- **Inputs:** `target_kind` ∈ category, variant_group, item; "Use" = `attach`, "Not here" = `detach`, "—" = no link.
  - "Not here" on a category is not allowed (`400`); the control doesn't offer it.
  - One link per target (`400` at `links.N.target_id`).
- **Decisions:** where the group shows up when ordering.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Open | "Applies to" | Categories tab, strip with current counts | "Categories" / "Size groups" / "Items"; "Used on {n} · Not here on {m}" | none |
| Searching | text typed | rows filtered in the current tab | UNKNOWN placeholder | none |
| Items loading | Items tab, more pages | grouped list grows by pages | UNKNOWN | none |
| Use | "Use" on a row | row marked; strip count updates | "Use" | none |
| Not here | "Not here" on a size group or item | row marked; strip count updates | "Not here" | none |
| Category row | Categories tab | control shows only "—" / "Use" | — | none |
| Too many groups | save → `422 too_many_groups` at `links` | back on 01c-S03 with a field error | "An item can have up to 20 choice groups. Remove one first." | none |
| Archived target | `422 not_found` / `archived` | row error on 01c-S03 | generic texts | none |
| Phone | 390 | full-screen dialog; tabs scroll | — | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** `CONFIG_REFERENCE_INVALID` (`too_many_groups`, `not_found`, `archived`), `VALIDATION_FAILED`.
- **Edge cases:**
  - Deals take no links: a deal part's item keeps its own groups.
  - 0–500 links.
- **Data needed:** categories, size groups, and every menu page of items with their category.

### 01c-S04 · Deals list
- **Job:** see every deal, its price, its parts and where it is sold.
- **Entry points:** nav "Menu" → "Deals".
- **Exits:** a deal → 01c-S05; "New deal" → 01c-S05.
- **Information shown** (columns, Q12):

| Info | Priority |
|---|---|
| Name | MUST |
| Deal price | MUST |
| Parts: "1 Full karahi + 4 Naan" | MUST |
| Sold at: branch chips with the branch price (read-only) | USEFUL |
| Warnings: "Not sold at X: part N has no routed choice" (01c-B04) | USEFUL |
| Archived deals (`status=archived`) | RARE |

- **Actions:** PRIMARY **New deal**; SECONDARY open; RARE show archived.
- **Inputs:** search by name; status `active` / `archived`. Sort is `sort_order`, then name.
- **Decisions:** which deal to edit.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Loading | open | skeleton | — | none |
| List | deals exist | rows | "Deals" | none |
| Empty | none | empty state | "No deals yet." | none |
| No search match | search finds nothing | UNKNOWN | UNKNOWN | none |
| Checking branches | menu pages loading | no warnings | "Checking branches…" | none |
| Omission warning | a deal sold at X has a part with no choice routed at X | 01c-B04 | "Not sold at X: part N has no routed choice" | none |
| Sold nowhere | new deal, no branch row sold | no "Sold at" chips | UNKNOWN | none |
| Archived | status archived | archived deals with Restore | UNKNOWN | none |
| Read-only | `can_edit_tenant` false | no "New deal" | — | none |
| Cloud down | network / `503` | 01a-B04 | see 01a-B04 | none |
| Phone | 390 | one column | — | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** `SERVICE_UNAVAILABLE`.
- **Edge cases:** a new deal is sold nowhere until a branch row says "Sold here".
- **Data needed:**
  - `GET /v1/admin/deals?status=`: `parts` with `choices`, `archived_parts`, `availability_windows`, `branches[{ branch_id, is_sold, price_minor_override, version }]`, `version`, `can_edit_tenant`.
  - Every menu page, for routes and item names.

### 01c-S05 · Deal form
- **Job:** build a deal: name, one price, category, tax, hours, and its parts with the choices for each.
- **Entry points:** 01c-S04.
- **Exits:**
  - Save → 01c-S04; Cancel.
  - "Add choice" → 01c-D03.
  - "At each branch" → 01c-S11, a section of this form.
  - Stale → 01c-B03.
  - Not found → 01c-S04.
- **Information shown:**

| Info | Priority |
|---|---|
| Name, "Deal price", category, tax | MUST |
| "Parts": quantity (in the choices' unit), choices with extra price | MUST |
| "Hours" | USEFUL |
| Section "At each branch" (01c-S11) | USEFUL |
| "Removed" parts with Restore (01c-B06) | USEFUL |
| Description, sort order | RARE |

- **Actions:**
  - PRIMARY: **Save**.
  - SECONDARY:
    - **Add part**;
    - **Add choice** → 01c-D03;
    - remove a part (it is archived on save);
    - **Restore**;
    - Cancel.
  - DESTRUCTIVE: archive deal.
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Name (`name`) | text | empty | 1–60, unique among active deals | `409 CONFIG_NAME_TAKEN { entity: 'deal' }` → "That name is already used. Choose another name." |
| "Deal price" (`price_minor`) | Rs | empty | 0 … 1 000 000 000 | UNKNOWN |
| Category (`category_id`) | select | UNKNOWN | active category | `not_found` / `archived` → generic texts |
| Tax (`tax_class_id`) | select, can be none | none | active tax class or none | `not_found` / `archived` → generic texts |
| "Hours" (`availability_windows`) | 01a-C01 | all day | 01a S47 rules | see 01a-C01 |
| Part quantity (`parts.N.quantity`) | number in the choices' Sold by (e.g. 4 pieces, 500 g) | UNKNOWN | 1 … 1 000 000 | UNKNOWN |
| Part choices (`parts.N.choices`) | list via 01c-D03 | — | 1–20, one per item, all with the same Sold by; no weighed item | `choice_unit_mismatch` at `parts.N.choices` → "All choices in a part must be sold the same way — all by piece or all by weight."; `weighed_item_in_deal` at `parts.N.choices.M.item_id` → "Items weighed when served can't be in a deal." |
| Choice extra price (`extra_price_minor`) | Rs | 0 | 0 … 1 000 000 000; 0 when the part has one choice (`400`) | UNKNOWN |
| Part / choice order (`sort_order`) | integer | 0 | — | — |
| Description (`description`) | text | empty | UNKNOWN | — |

- **Decisions:**
  - The deal price.
  - A fixed part, or "customer picks one" with extras (G3 7).
  - Tax: the whole deal line uses the deal's tax class.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| New | "New deal" | empty; POST with Idempotency-Key; not sold anywhere yet | UNKNOWN | none |
| Edit | open | parts with `deal_part_id`, version | UNKNOWN | none |
| Fixed part | one choice | extra price hidden or locked at 0 | UNKNOWN | none |
| Pick-one part | 2+ choices | extra price per choice | UNKNOWN | none |
| Part removed | removed and saved | archived, listed under "Removed" | "Removed" | none |
| Part restored | "Restore" | same part back | "Restore" | none |
| Rule error | `422` at `parts.N.choices…` | 01c-B01 on the row as sent | per reason, see 01c-B01 | none |
| Name taken | `409 CONFIG_NAME_TAKEN` | field error | "That name is already used. Choose another name." | none |
| Stale | `409 CONFIG_STALE { entity: 'deal' }` | 01c-B03 | see 01c-B03 | none |
| Restore blocked | restoring a deal whose category, tax class or choice item is archived | field error at `category_id` / `tax_class_id` / choice | "This was archived. Pick another one." | none |
| Other deal's part | `422 parts.N.deal_part_id not_found` | row error | "This no longer exists. Pick another one." | none |
| Not found | `404 DEAL_NOT_FOUND` | form replaced; the list reloads | "This deal isn't here any more. It may have been deleted on another device." / "Back to Deals" | none |
| Busy / slow / cloud down / read-only | as 01a | as 01a | "Still working…" | none |
| Phone | 390 | one column; parts and choices stack | — | none |
| Urdu RTL | Urdu | mirrored; prices LTR | designer writes it | none |

- **Error codes:**
  - `CONFIG_NAME_TAKEN`: `deal`.
  - `CONFIG_REFERENCE_INVALID`: `choice_unit_mismatch`, `weighed_item_in_deal`, `not_found`, `archived`.
  - Others: `CONFIG_STALE`, `DEAL_NOT_FOUND`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `SERVICE_UNAVAILABLE`, `IDEMPOTENCY_KEY_MISMATCH`.
- **Edge cases:**
  - A deal has 1–10 parts. The same item may be in two parts.
  - Pilot: one choice × the part quantity (4 × Roghni, not 2 + 2).
  - A deal has no station, cook time or stock of its own. A part item keeps its own plain choice groups.
  - Archiving an item, category or tax class that an active deal uses → 01c-D04.
  - There is no deal On/Off switch on the hub (deferred).
- **Data needed:** the deal from `GET /v1/admin/deals`; categories; tax classes; items with `sale_unit`, `requires_weighing` and routes.

### 01c-S11 ★ · Deal — "At each branch" rows
- **Job:** sell or withdraw a deal at a branch and set its price there.
- **Entry points:** section "At each branch" on 01c-S05 (Q15).
- **Exits:** row "Save" → stays; stale → 01c-B03 on that row.
- **Information shown:** one row per allowed branch with the "Sold here" switch, "Price here" (deal price as reference) and the omission warning (01c-B04). All MUST.
- **Actions:** PRIMARY: row **Save**, shown only when the row has unsaved changes.
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| "Sold here" (`is_sold`) | switch | off for a new deal | — | selling an archived deal → `422 archived` (text UNKNOWN) |
| "Price here" (`price_minor_override`) | Rs | empty (deal price) | none or 0 … 1 000 000 000; not allowed with "Sold here" off (`400`) | UNKNOWN |

- **Decisions:** which branches sell it, and the branch price (DHA higher).
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Not sold | `is_sold: false` | price disabled | "Sold here" | none |
| Sold at deal price | sold, no override | — | "Sold here" / "Price here" | none |
| Sold at branch price | override set | — | "Price here" | none |
| Row has changes | an edit | row "Save" appears | "Save" | none |
| Withdrawn | "Sold here" turned off and saved | response `{ branch: null }` | — | none |
| Part not routed | after the last menu page | 01c-B04 on the row | "Not sold at X: part N has no routed choice" | none |
| Stale | `409 CONFIG_STALE { entity: 'deal_branch' }` | 01c-B03 on this row only | see 01c-B03 | none |
| Busy / cloud down | as 01a | as 01a | "Still working…" | none |
| Phone | 390 | rows stack | — | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** `CONFIG_STALE`, `CONFIG_REFERENCE_INVALID` (`archived`), `VALIDATION_FAILED`, `DEAL_NOT_FOUND`, `BRANCH_NOT_FOUND`, `SERVICE_UNAVAILABLE`.
- **Edge cases:** if the deal is archived while a branch row is being saved, one wins; the other gets a stale or `archived` error.
- **Data needed:** `branches[{ branch_id, is_sold, price_minor_override, version }]` for every allowed branch.

### 01c-D03 · Deal part choice picker
- **Job:** pick the item(s) a part offers.
- **Entry points:** 01c-S05 "Add choice".
- **Exits:** "Add to part" → 01c-S05; cancel (label UNKNOWN).
- **Information shown:**
  - MUST: items with Sold by and price.
  - USEFUL: items not allowed (weighed, or a different Sold by from the part's other choices). Whether they are hidden or disabled is UNKNOWN.
- **Actions:** PRIMARY **Add to part** (Q4); SECONDARY cancel.
- **Inputs:** item search (UNKNOWN); one item per choice; no duplicates within a part.
- **Decisions:** what the customer may pick in this part.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Picking | open | item list | "Add to part" | none |
| Item not allowed | weighed, or another Sold by | disabled or hidden (UNKNOWN) | UNKNOWN | none |
| Loading more | menu pages loading | UNKNOWN | UNKNOWN | none |
| Phone | 390 | full-screen picker | — | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** none of its own (save errors come back on 01c-S05).
- **Edge cases:** up to 20 choices per part.
- **Data needed:** every menu item (`sale_unit`, `requires_weighing`, price, routes).

### 01c-D04 ★ · In use — can't archive or change yet
- **Job:** explain why an archive or change was refused, and what uses the thing.
- **Entry points:**
  - `409 CONFIG_IN_USE` from 01c-S01, S03, S05, S07 or S09.
  - The same error from 01a archives (category, tax class, station, item).
- **Exits:** Close → the form. Opening the users (01a-D01 pattern "Open these items") is UNKNOWN for 01c targets.
- **Information shown:** what is blocked, and `used_by.entity` with the named list (`ids` → names). MUST.
- **Actions:** PRIMARY **Close** (01a-D01); SECONDARY open the listed things (UNKNOWN).
- **Inputs:** none.
- **Decisions:** archive or change the users first.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Size group has sizes | archive size group, `used_by: menu_item` | list of sizes | UNKNOWN (01a pattern "{name} can't be archived yet") | none |
| Stock item has dishes | archive stock item, `used_by: menu_item` | list of dishes | UNKNOWN | none |
| Item used by a choice group | archive item / unit change / weighing on, `used_by: modifier_group` | list of choice groups | UNKNOWN | none |
| Item in a deal | archive item, or a unit change that would mix a part, `used_by: deal` | list of deals | UNKNOWN | none |
| Category used | archive category, `used_by: variant_group` or `deal` | list | UNKNOWN | none |
| Tax class used | archive tax class, `used_by: deal` | list | UNKNOWN | none |
| Station counts stock | archive station, `used_by: stock_item` | list of stock items | UNKNOWN | none |
| Generic fallback | any | — | "Still in use. Archive or move what uses it first." | none |
| Phone | 390 | full-width dialog | — | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** `CONFIG_IN_USE` (`entity` adds `variant_group`, `stock_item`, `menu_item`).
- **Edge cases:**
  - When both apply, choice groups are reported before deals.
  - An option blocks an item archive only when its choice group is active.
- **Data needed:** `used_by.ids` resolved to names, from the lists already loaded.

### 01c-B01 · Rule and reference field errors
- **Job:** show exactly which field or row broke a menu rule.
- **Entry points:** `422 CONFIG_REFERENCE_INVALID { field, reason }` on any 01c save.
- **Exits:** the owner fixes the field and saves again.
- **Information shown:** the marked field or row, and the reason text. MUST. Paths such as `options.N…` and `parts.N.choices.M…` map to the row as sent.
- **Actions:** none (it marks fields). **Inputs:** none. **Decisions:** none.
- **States.** There is one state per reason.
  - Copy keys stay `errors.reference.<reason>` as built. Spec §8's `errors.CONFIG_REFERENCE_INVALID.<reason>` needs an erratum (proposal drafted in the spec).
  - The designer writes the Urdu with the frames (Q7, Decided (designer, 2026-10-30)).

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| `category_mismatch` | item category ≠ its size group's | field error (field read from the response) | "Put this item in the same category as its size group." | none |
| `unit_mismatch` on `stock_draws.0.stock_item_id` | the draw unit rule is broken | stock field error (key `errors.reference.unit_mismatch`) | "This stock is counted in a different unit. Sell this item by piece, or pick other stock." | none |
| `unit_mismatch` on `stock_unit` | a unit change breaks a dish's draw | "Counted in" field error (key `errors.reference.unit_mismatch_stock`) | "Some dishes use this stock in the old unit. Change those dishes first." | none |
| `linked_item_not_piece` | the kitchen item is not sold by piece, or is weighed | `options.N.linked_item_id` | "Only items sold by piece can be an option." | none |
| `choices_unsatisfiable` | at least > the total of "Up to" | `min_choices` or `options` | "Customers must pick more than these options allow. Lower 'at least' or raise 'up to'." | none |
| `defaults_exceed_max` | defaults > at most | `min_choices` or `options` | "Too many options are set as default. Untick some or raise 'at most'." | none |
| `too_many_groups` | more than 20 groups would apply to an item | `links`, `category_id` or `variant_group_id` | "An item can have up to 20 choice groups. Remove one first." | none |
| `choice_unit_mismatch` | a part's choices differ in Sold by | `parts.N.choices` | "All choices in a part must be sold the same way — all by piece or all by weight." | none |
| `weighed_item_in_deal` | weighed item in a deal | `parts.N.choices.M.item_id` or `requires_weighing` | "Items weighed when served can't be in a deal." | none |
| `weighed_item_stock_draw` | weighed item with stock | `stock_draws` or `requires_weighing` | "Items weighed when served don't use stock. Remove the stock first." | none |
| `not_found` | reference gone | field | "This no longer exists. Pick another one." | none |
| `archived` | reference archived | field | "This was archived. Pick another one." | none |
| `wrong_branch` | station of another branch | field | "This station belongs to another branch." | none |
| Generic | reason without a text | field | "Something it points to is archived or missing. Choose another one." | none |

- **Error codes:** `CONFIG_REFERENCE_INVALID`.
- **Edge cases:** on a restore that sends no list, N and M count the stored active rows in wire order.
- **Data needed:** the sent body, to map indexes to rows.

### 01c-B02 · Hub stock page — stock item row with its dishes (built)
- **Job:** count each pot once, see how many of each dish it still covers, and switch dishes on or off.
- **Entry points:** 01a-S11 (every row of the stock list).
- **Exits:** as 01a-S11.
- **Information shown:**

| Info | Priority |
|---|---|
| Stock item name; sub line: unit word ("pieces" / "counted in kg" / "counted in L") and "keeps overnight" | MUST |
| "Count now" input in the stock unit; "Still right" | MUST |
| "Left to sell", "{n} on orders" | MUST |
| Level chips "Low" / "Out"; "Not counted today" | MUST |
| Under it, one row per dish that draws from it: dish name, the whole sale units the stock covers ("Left to sell" in that dish's unit), its Selling switch | MUST |
| "Not used by any dish here" | USEFUL |
| "Sold out when 0" chip on a dish | USEFUL |

- **Actions:** as 01a-S11.
  - PRIMARY: **Save** counts.
  - SECONDARY: **Add** / "Fresh batch"; **Still right**; the Selling switch per dish.
  - There is no deal switch.
- **Inputs:** count (`on_hand`) and add (`quantity` 1 … 1 000 000) per **stock item**, in its unit; otherwise as 01a.
- **Decisions:** as 01a-S11.
- **States.** English copy is as built. Urdu is given where `ur.ts` has it; other Urdu is as in the 01a brief.

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Stock row | stock item counted here | count, add, level | "Count now" / "Still right" / "Left to sell" / "{n} on orders" / "Add" | none (built `StockTable.tsx`) |
| Dish rows | drawers exist | listed under the stock row, with sale units left and Selling | "Selling" | none |
| Dish of another station | `my_stations`, dish not on this page | dish row with no Selling switch | — | none |
| Not used here | `has_tracked_drawers: false` | info chip; counts still allowed | "Not used by any dish here" / UR "یہاں کسی ڈش میں استعمال نہیں" | none |
| Not counted | `level: not_counted` | warn chip | "Not counted today" / UR "آج نہیں گنا" | none |
| Low / Out | level | chips; alert bar "Low: {items}" / "Out: {items}" | "Low" (UR "کم") / "Out" | none |
| Filter | "Show" | filtered rows | "To count" (UR "گننا باقی") / "Low or out" / "Off" / "All" (UR "سب") | none |
| Search match | search | matches the stock item name or any dish name | "Search items" | none |
| No match | search finds nothing | empty state | "No item matches “{q}”" / "Only items counted each morning and items you can switch off are here." / "Clear search" | none |
| Add sheet (phone) | Add | sheet for the stock item | "Add a fresh batch" / "{name} · {left} left now" / "How many are ready?" / "Add {n}" / "After adding: {left} left to sell" | none |
| Stock item changed in setup | `404 STOCK_ITEM_NOT_FOUND` on save or add; nothing saved for any entry | banner with Reload (Q17, Decided (designer, 2026-10-30)); not built yet | "A stock item changed in setup. Reload this page and count again." / "Reload" | none |
| Outside scope | `403 outside_scope { stock_item_ids }` | as 01b | see 01b brief | none |
| No day / stale / hub down | as 01a-S11 | as 01a-S11 | see 01a brief | none |

- **Error codes:** `STOCK_ITEM_NOT_FOUND`, `BUSINESS_DAY_NOT_OPEN`, `PERMISSION_DENIED` (`outside_scope`), `VALIDATION_FAILED`.
- **Edge cases:**
  - A day opened before a unit change keeps the old unit until the next day open.
  - One stock row shows Half and Full both under the Karahi pot (6 kg → Half 12, Full 6).
  - Rows are keyed by `stock_item_id`; availability stays per dish.
- **Data needed:** `GET /admin/queries/stock` returns:
  - `stock_items_meta[{ stock_item_id, name, stock_unit, carries_over, station_id, low_stock_threshold, has_tracked_drawers, drawers[{ item_id, name, variant_name, sale_unit, quantity_per_sale_unit }] }]`;
  - `stock[{ stock_item_id, on_hand, reserved, unit, available, level, set_at }]`;
  - `items_meta` / `items`.

### 01c-B03 ★ · "Changed elsewhere" stale banner
- **Job:** stop a save that would overwrite someone else's newer change, without losing the owner's typing.
- **Entry points:**
  - `409 CONFIG_STALE` on 01c-S03, S05, S07 and S09, and on the "At each branch" rows (S07, S10, S11), where it shows on that row only.
  - The same pattern applies to every module's versioned forms, 01b-B03 included (Q8, Decided (designer, 2026-10-30)).
- **Exits:** "Reload" → the form reloads with the new version.
- **Information shown:** warn banner at the top of the form, or on the row. MUST. The owner's draft stays editable and copyable until Reload. MUST.
- **Actions:** PRIMARY **Reload**.
- **Inputs:** none.
- **Decisions:** reload, after copying what they typed.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Stale | `409 CONFIG_STALE { entity, id }` | warn banner; draft kept, editable and copyable, until Reload; never auto-retry | "Changed elsewhere" / "Someone saved this after you opened it. What you typed is still here — copy it, then reload." / "Reload" | none |
| Stale row | `409` on an "At each branch" row | the same banner, inside that row only | same | none |
| Reloaded | "Reload" | form or row reloads with the new version; draft discarded | — | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** `CONFIG_STALE` (`variant_group`, `stock_item`, `stock_item_branch`, `modifier_group`, `modifier_group_branch`, `deal`, `deal_branch`).
- **Edge cases:**
  - It reuses the key `errors.CONFIG_STALE` with the new text; today's text is "Someone changed this since you opened it".
  - The spec phrase "Changed elsewhere — reload" is the title plus the button.
  - 01b-B03 moves to this pattern and keeps the draft too. This change to the 01b spec is drafted as a proposal and needs approval.
- **Data needed:** `entity`, `id`.

### 01c-B04 ★ · Omitted at a branch warnings
- **Job:** tell the owner that something they set to sell at a branch won't show there.
- **Entry points:** 01c-S02 / S03 (kitchen option), 01c-S04 / S05 / S11 (deal).
- **Exits:** none (information only).
- **Information shown:** the warning per branch. MUST. On lists it shows as a read-only chip (Q15).
- **Actions:** none specified. **Inputs:** none.
- **Decisions:** route the item at that branch, or change the option or part.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Checking | menu pages still loading (`next_cursor` not null) | no warnings; shown once per page, not per row | "Checking branches…" | none |
| Deal omitted | a deal sold at X has part N with no choice routed at X | warning | "Not sold at X: part N has no routed choice" | none |
| Option omitted | a kitchen option's item has no route at X | warning | "Not offered at X: its item is not sold there" | none |
| None | all fine after the last page | nothing | — | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** none (computed in the app).
- **Edge cases:** never shown from a partial load.
- **Data needed:** the §6.10 and §6.13 responses, and the routes from every §6.3 menu page.

### 01c-B05 ★ · Required choice group with nothing offered at a branch (F1)
- **Job:** warn that a required choice group has nothing to pick at a branch, so its items can't be ordered there.
- **Entry points:** 01c-S10 branch row; 01c-S02 as a chip.
- **Exits:** the save still goes through.
- **Information shown:** the warning, in warn style (Q6, Decided (designer, 2026-10-30)). MUST.
- **Actions:** none (Save stays allowed). **Inputs:** none.
- **Decisions:** offer an option here, or accept that those items aren't orderable here.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Warning | `min_choices ≥ 1` and no option offered at the branch | warn line; Save allowed | "Nothing is offered here, so items that need “{group}” can't be ordered at {branch}." | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** none. **Edge cases:** none further. **Data needed:** the group's `min_choices` and the branch row values.

### 01c-B06 ★ · "Removed" rows with Restore
- **Job:** bring back an option or part removed earlier.
- **Entry points:** under the 01c-S03 options and the 01c-S05 parts.
- **Exits:** Restore → the row returns to the list and is saved with the form.
- **Information shown:**
  - Removed options: `archived_options` name.
  - Removed parts: "A removed part" until the spec change (Q14) adds quantity and choices; then "4 × Naan or Roghni naan".

  USEFUL.
- **Actions:** SECONDARY **Restore**.
- **Inputs:** none. **Decisions:** restore or not.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Removed options | archived options exist | list under the options | "Removed" / option name / "Restore" | none |
| Removed parts (today) | archived parts exist; wire has id only | list under the parts | "Removed" / "A removed part" / "Restore" (Q14, Decided (designer, 2026-10-30)) | none |
| Removed parts (after spec change) | `archived_parts` carries quantity + choices | readable part | "4 × Naan or Roghni naan" / "Restore" | none |
| None removed | no archived rows | list hidden | — | none |
| Restore blocked | the restored row points at an archived or changed item | 01c-B01 on that row | per reason | none |
| Urdu RTL | Urdu | mirrored | designer writes it | none |

- **Error codes:** `CONFIG_REFERENCE_INVALID`. **Edge cases:** the restored row keeps its id.
- **Data needed:** `archived_options[{ option_id, name }]`; `archived_parts[{ deal_part_id }]`, and after the proposed spec change also `quantity` and `choices[{ item_id }]`.

---

## 4. Flows

1. **Half and Full karahi from one pot.**
   1. 01c-S08 → "New size group" → "Chicken Karahi", category Karahi → Save.
   2. 01c-S09 → "Add a size" → 01a-S07 with the size group and category filled in → "Chicken Karahi — Half", Rs 1,150, "Size name" Half.
   3. Stock section → "Create a stock item with this name" → mini-form: Name "Chicken Karahi", "Counted in" g, "Uses per sale" 500 g → "Create and link" → "Creating stock item… (1 of 3)" → linked.
   4. "Add a size" again → "Full", Rs 2,200 → pick stock item "Chicken Karahi", "Uses per sale" 1 000 g → Save.
   5. Optional: "Open stock item" → 01c-S07 to set the alert or rename the stock item (e.g. "Karahi pot").

   Failure branches:
   - Item category ≠ size group category → "Put this item in the same category as its size group."
   - Item sold by kg with the stock counted in piece → "This stock is counted in a different unit. Sell this item by piece, or pick other stock."
   - Size name "Half" used twice in the group → name taken.
   - A create call fails → "Stock item made, but the item isn't linked yet." → "Finish linking" (same key, re-read, only the missing calls).
   - The mini-form's "Uses per sale" is empty → "Create and link" waits.
2. **Stock item from the list.** 01c-S06 → "New stock item" → Name, "Counted in", "Keeps overnight" → Save. Then, under "At each branch", per branch: "Counted here" on → station → alert below → row Save.

   Failure branches:
   - Name taken.
   - Another tab set the same branch first → 01c-B03 on that row only.
   - Station archived → "This was archived. Pick another one."
3. **Bread extras.**
   1. 01c-S02 → "New choice group" → "Bread", "Customers pick" at least 0, at most 6.
   2. "Add option" → Naan, "Goes to kitchen as" Naan item (price empty = Naan's price), "Up to" 6.
   3. "Applies to" → 01c-D02 → "Size groups" tab → Chicken Karahi "Use" → strip "Used on 1 · Not here on 0" → "Done" → Save.

   Failure branches:
   - Naan sold by kg → "Only items sold by piece can be an option."
   - At least > the total of "Up to" → "Customers must pick more than these options allow. …"
   - More than 20 choice groups on an item → "An item can have up to 20 choice groups. Remove one first."
   - Naan not routed at DHA → 01c-B04 "Not offered at DHA: its item is not sold there".
4. **Spice level with a default, except one item.** 01c-S03 "Spice level", pick 1 of Mild / Normal ("Default") / Hot, all Rs 0. "Applies to" → category Karahi "Use" + item Lassi "Not here".

   Failure branch: two defaults with at most 1 → "Too many options are set as default. Untick some or raise 'at most'."
5. **Different extras per branch.** 01c-S03 → "At each branch" → expand DHA → Extra raita "Price here" Rs 90 → row Save. Expand Gulberg → Naan "Offered here" off → row Save.

   Failure branches:
   - A required group left with nothing offered → 01c-B05 "Nothing is offered here, so items that need “Spice level” can't be ordered at Gulberg." (Save allowed).
   - Another tab saved that row first → 01c-B03 on that row only.
6. **Family karahi deal.**
   1. 01c-S04 → "New deal" → name, "Deal price" Rs 3,200, category Karahi, no tax.
   2. "Add part": 1 × Full karahi. "Add part": quantity 4 → "Add choice" → 01c-D03 → Naan "Add to part", Roghni naan "Add to part" (+Rs 30) → Save.
   3. "At each branch" → "Sold here" on at each branch (DHA "Price here" higher) → row Save.

   Failure branches:
   - A part mixing piece and kg items → "All choices in a part must be sold the same way — all by piece or all by weight."
   - A weighed fish → "Items weighed when served can't be in a deal."
   - A single-choice part with an extra → `400`.
   - A part not routed at X → 01c-B04 "Not sold at X: part N has no routed choice".
   - Selling an archived deal → `422 archived`.
7. **Weighed fish.** 01a-S07 fish, Sold by kg → "Weighed when served" on (the Stock section hides) → Save.

   Failure branches:
   - A deal offers it → "Items weighed when served can't be in a deal."
   - An option sends it to the kitchen → 01c-D04 (`used_by: modifier_group`).
   - Changed to Sold by piece while weighed → `400`.
   - It has stock → "Items weighed when served don't use stock. Remove the stock first."
8. **Archive something in use.** Archive Naan (01a) → 01c-D04 listing the Bread group and the Family karahi deal. Archive Karahi pot → 01c-D04 listing Half and Full.
9. **Remove and restore.**
   1. 01c-S03: remove "Hot" → Save → listed under "Removed".
   2. "Restore" → Save → the same option is back.
   3. On 01c-S05 a removed part shows "A removed part" + "Restore".

   Failure branch: the restored group's kitchen item is now sold by kg → "Only items sold by piece can be an option."
10. **Unit change.** 01c-S07 Karahi pot "Counted in" g → piece → notice "New unit starts at each branch's next day open. Today's counts stay in g; count in piece from tomorrow." → Save.

    Failure branch: dishes draw grams → "Some dishes use this stock in the old unit. Change those dishes first."
11. **Morning count on the hub.** 01a-S11 → Karahi pot row: Count now 6 kg → Save → Half "12" and Full "6" left to sell under it.

    Failure branches:
    - No day open → 01a-B13.
    - A stock item removed from config → "A stock item changed in setup. Reload this page and count again." → "Reload".
    - The counter is outside their stations → `403 outside_scope`.
12. **Stale edit.** Two tabs edit Spice level. The second Save → 01c-B03 "Changed elsewhere": the draft stays editable → copy → "Reload" → re-apply.
13. **Deleted on another device.** The owner opens a deal that another device just archived → `404` → "This deal isn't here any more. It may have been deleted on another device." → "Back to Deals" → the list reloads.

---

## 5. Components used

| Component | Used on |
|---|---|
| Owner shell side nav, section "Menu" (Items, Size groups, Choice groups, Deals, Stock items), app bar (01a) | every owner screen |
| List rows with sub line and chips; search; empty state (01a) | 01c-S02, S04, S06, S08, B02 |
| Chips with price ("Half Rs 1,150"), branch chips with price, warning chips | 01c-S08, S04, S06, S02 |
| Form sections with field errors (01a) | 01c-S01, S03, S05, S07, S09 |
| Inline mini-form inside a section (own primary + Cancel) | 01c-S01 |
| Read-only summary line(s) with "+N more" and a link | 01c-S01 |
| Select / picker (category, tax class, station, size group, stock item, item) | 01c-S01, S03, S05, S07, S09, D03 |
| Quantity input with unit (`parseQuantity` / `formatQuantity`, LTR) | 01c-S01, S05, S07, B02 |
| Rs price input (LTR) | 01c-S03, S05, S10, S11 |
| Switch | 01c-S01 "Weighed when served", S07 "Keeps overnight" and "Counted here", S10 "Offered here", S11 "Sold here", B02 Selling |
| Repeatable row table (options; parts with nested choices) | 01c-S03, S05 |
| Read-only member list with "Open" + "Add a size" | 01c-S09 |
| **"At each branch" section: one row per branch, own version, Save shown only when dirty, row-level stale banner, expandable row** | 01c-S07, S10, S11 |
| Dialog with search, tabs with counts, paged grouped list | 01c-D02 |
| 3-way segmented control "—" / "Use" / "Not here" | 01c-D02 |
| Summary strip ("Used on 3 · Not here on 1") | 01c-D02 |
| "Removed" list with Restore | 01c-B06 on S03, S05 |
| Hours field 01a-C01 | 01c-S05 |
| Blocked dialog (01a-D01) | 01c-D04 |
| Full-form replacement message with "Back to {list}" | 01c-S03, S05, S07, S09 |
| Banners: danger, warn, info; "Still working…"; 01a-B04 cloud down | all |
| Stale warn banner with draft kept (form or row) | 01c-B03, every module |
| Warning line per branch | 01c-B04, B05 |
| Hub chips (Low, Out, Not counted today, Not used by any dish here, Sold out when 0) | 01c-B02 |
| Hub stock add sheet (01a phone) | 01c-B02 |

---

## 6. Open questions

All 18 questions are answered. Full text is in `docs/design/open-questions/01c-menu-variants.md`.

1. **Designs.** Decided (designer, 2026-10-30): the designer draws all 20 screens, with frames and Urdu RTL. In progress; the owner chooses the look.
2. **New screen IDs.** Decided (designer, 2026-10-30): confirmed as written.
3. **01c-D01.** Decided (designer, 2026-10-30): dropped from the inventory; one line remains.
4. **Labels.** Decided (designer, 2026-10-30): nav, buttons, field labels and empty states as used above. The owner sees "size group" and "choice group".
5. **Urdu.** Decided (designer, 2026-10-30): the designer writes every 01c string with the frames; the keys go into the design doc.
6. **F1 text.** Decided (designer, 2026-10-30): see 01c-B05.
7. **Reason texts and key prefix.** Decided (designer, 2026-10-30): see 01c-B01. Spec §8 erratum drafted as a proposal.
8. **Stale pattern.** Decided (designer, 2026-10-30): one pattern, 01c-B03. The 01b change is drafted as a proposal.
9. **"Create a stock item with this name".** Decided (designer, 2026-10-30), replacing the earlier answer: an inline mini-form (see 01c-S01). The "units differ" case is now reachable, and it is the main case.
10. **Stock fields on the item form.** Decided (designer, 2026-10-30): summary line + "Open stock item"; unit, alert and overnight are edited only on 01c-S07.
11. **Phone.** Decided (designer, 2026-10-30): a 390 layout for every view; 01a's quick-price page shows the size group name and no 01c sections.
12. **Lists.** Decided (designer, 2026-10-30): columns on 01c-S08, S06, S02 and S04; search and sort rules; 01a-S05 nests sizes.
13. **"Applies to".** Decided (designer, 2026-10-30): see 01c-D02.
14. **Removed deal parts.** Decided (designer, 2026-10-30): "A removed part" for now. The spec change is drafted as a proposal.
15. **Per-branch pattern.** Decided (designer, 2026-10-30): the "At each branch" section.
16. **Size group members.** Decided (designer, 2026-10-30): added only from the item form; read-only list; no reordering.
17. **Not found.** Decided (designer, 2026-10-30): the form is replaced with a message and "Back to {list}"; the hub stock 404 has its own text.
18. **Unit change notice.** Decided (designer, 2026-10-30): see 01c-S07.

Still UNKNOWN after these decisions:
- the "show archived" toggle labels and archived-list states;
- "No search match" copy on the owner lists;
- price and quantity error texts (`400`);
- the defaults for a new stock item's "Counted in", a deal's category and a part's quantity;
- the hidden-vs-disabled choice in 01c-D03;
- "Open these items" in 01c-D04 and the 01c-D04 titles;
- `BRANCH_NOT_FOUND` handling.

These are for the designer to settle in the frames.

---

## 7. Clutter report

- **Inventory D01 variant editor.** It duplicated the item form, and is retired (Q3).
- **Per-branch everything.** Item routes and prices (01a), "Counted here" (01c-S07), "Offered here / Price here" (01c-S10) and "Sold here / Price here" (01c-S11) were four per-branch grids of the same shape. **Decided (Q15):** one "At each branch" section pattern, with read-only chips on lists. 01a's item routes could adopt it too; that is a design call outside 01c.
- **Two "group" ideas.** **Decided (Q4):** the owner sees "Size groups" and "Choice groups", each with its own nav entry and empty-state explanation.
- **Error noise.** There are fourteen reason texts (01c-B01) plus generic ones, and many are rare setup mistakes. Show them inline on the field only, never as stacked banners.
- **Item form length.** 01a-S07 is already long. The "Size group", "Stock item" and "Weighed when served" sections should collapse when unused. The create mini-form opens inline only on demand.
- **Warnings during load.** Show "Checking branches…" once per page, not once per row.
- **Hub stock page.** Dish rows under each stock item double the row count, and the built page lists every drawer. Consider collapsing the dish rows when a stock item has one dish whose unit equals the stock unit (the same numbers twice). This is a design call; the spec only requires the dishes to be listed.
