# 01c — Menu: variants, modifiers, deals: open questions

Copied from §6 of the 01c design brief (`updated-designs/brief/01c-brief.md`) on 2026-10-30. 01c has no design frames yet. The owner-app design will be built in the later UI module (AD-35).

How to use it:
- To answer a question, edit its **Decision** line and set **Status** to `answered`.
- `Decided (designer, 2026-10-30)` marks the designer's answers of 2026-10-30. They are applied in the brief.
- Spec changes that follow from a decision are drafted in the spec files as **"Proposed — needs approval"**. They are not applied to the approved text.

All 18 questions are decided.

---

## Q1 Designs
- **Decision:** the designer designs all 20 screens, with frames and Urdu RTL. The owner chooses the look.
- **Status:** Decided (designer, 2026-10-30) — work in progress

## Q2 New screen IDs
- 01c-S07–S11, D04 and B03–B06 were new in the brief.
- **Decision:** confirmed as written.
- **Status:** Decided (designer, 2026-10-30)

## Q3 Drop 01c-D01 (variant editor)?
- **Decision:** dropped from the inventory. One line remains: "Retired by spec V2 — a size is a full item (01a-S07 + 01c-S01)." Applied in `docs/design/inventory/01c-menu-variants.md`.
- **Status:** Decided (designer, 2026-10-30)

## Q4 Labels the spec does not fix
- **Decision:**
  - **Nav section "Menu":** "Items", "Size groups" (variant groups), "Choice groups" (modifier groups), "Deals", "Stock items".
  - **Words:** owners see "size group" and "choice group", never "variant" or "modifier". The code names stay.
  - **Buttons:**
    - "New size group", "New stock item", "New choice group", "New deal".
    - "Add option", "Add part", "Add choice". The 01c-D03 primary is "Add to part"; the 01c-D02 primary is "Done".
    - "Remove from size group" (leave the group).
  - **Field labels:**
    - "Size group", "Size name" (e.g. Half), "Stock item", "Uses per sale", "Weighed when served".
    - "Counted in", "Keeps overnight", "Customers pick" (at least / at most), "Up to", "Default", "Goes to kitchen as" (the linked item).
    - "Applies to", "Deal price", "Parts", "Hours".
  - **Empty states:**
    - "No size groups yet. Make one when a dish comes in sizes, like Half and Full."
    - "No stock items yet. Add the pots and packs you count each morning."
    - "No choice groups yet. Add one for things like spice level or extra naan."
    - "No deals yet."
- **Status:** Decided (designer, 2026-10-30)

## Q5 Urdu
- **Decision:** the designer writes the Urdu for every 01c string with the frames. The keys go into the design doc.
- **Status:** Decided (designer, 2026-10-30)

## Q6 F1 warning text (01c-B05)
- **Decision:** "Nothing is offered here, so items that need “{group}” can't be ordered at {branch}." Warn style; Save stays allowed.
- **Status:** Decided (designer, 2026-10-30)

## Q7 Texts for the nine new reasons, and the key prefix
- **Decision:**
  - The key prefix stays `errors.reference.<reason>` (as built). Spec §8 gets an erratum.
  - `category_mismatch`: "Put this item in the same category as its size group."
  - `unit_mismatch` on `stock_draws.0.stock_item_id`: "This stock is counted in a different unit. Sell this item by piece, or pick other stock."
  - `unit_mismatch` on `stock_unit`: "Some dishes use this stock in the old unit. Change those dishes first." The UI picks the text by the error's `field`; key `errors.reference.unit_mismatch_stock`.
  - `linked_item_not_piece`: "Only items sold by piece can be an option."
  - `choices_unsatisfiable`: "Customers must pick more than these options allow. Lower 'at least' or raise 'up to'."
  - `defaults_exceed_max`: "Too many options are set as default. Untick some or raise 'at most'."
  - `too_many_groups`: "An item can have up to 20 choice groups. Remove one first."
  - `choice_unit_mismatch`: "All choices in a part must be sold the same way — all by piece or all by weight."
  - `weighed_item_in_deal`: "Items weighed when served can't be in a deal."
  - `weighed_item_stock_draw`: "Items weighed when served don't use stock. Remove the stock first."
  - Urdu: the designer writes it with the frames.
- **Follow-ups:**
  - Spec §8 erratum: drafted at the end of the 01c spec, "Proposed — needs approval".
  - `en.ts` / `ur.ts` keys: code, later UI module.
- **Status:** Decided (designer, 2026-10-30)

## Q8 Stale conflict: one pattern or two?
- **Decision:** one pattern for every module.
  - On `409 CONFIG_STALE`, show a warn banner at the top of the form: title "Changed elsewhere", body "Someone saved this after you opened it. What you typed is still here — copy it, then reload.", button "Reload" (primary).
  - Keep the draft, editable and copyable, until Reload. Never auto-retry.
  - Reuse the key `errors.CONFIG_STALE` with the new text. 01b-B03 moves to this pattern and keeps the draft too.
  - The spec phrase "Changed elsewhere — reload" is the title plus the button.
- **Follow-ups:**
  - 01b spec and 01b brief: drafted at the end of each, "Proposed — needs approval".
  - The `errors.CONFIG_STALE` text: code.
- **Status:** Decided (designer, 2026-10-30)

## Q9 "Create a stock item with this name" (replaces the earlier Q9 decision)
- **Decision:**
  - The button opens an **inline mini-form inside the Stock section** (not a dialog):
    - **Name:** default = the size group's name if the item is in one ("Chicken Karahi"), else the item's name.
    - **Counted in:** piece / g / ml. Default = the item's Sold by (kg → g, L → ml, piece → piece).
    - **Uses per sale:** shown only when the unit differs from Sold by; required, empty.
    - **Buttons:** "Create and link" (primary) and "Cancel".
  - Keeps overnight = off, alert = none, and "Counted here" = each routed branch with that route's station. All of these can be edited later on 01c-S07.
  - Progress: "Creating stock item… (1 of 3)". Failure: "Stock item made, but the item isn't linked yet." with "Finish linking".
  - This makes the "units differ" case reachable. It is the main case: piece-sold karahi drawing grams from one pot.
- **Status:** Decided (designer, 2026-10-30). The note on the earlier answer (that "units differ" was unreachable) is resolved.

## Q10 Stock fields on the item form
- **Decision:**
  - The item form "Stock" section has three parts:
    - the stock item picker;
    - "Uses per sale", in the stock unit;
    - one read-only summary line from the stock item: "{name} · counted in {unit} · keeps overnight / doesn't keep · {branch}: {station}, alert below {n}". There is one line per allowed branch, at most 3, then "+N more".
  - The link "Open stock item" goes to 01c-S07, after the unsaved-changes guard.
  - Unit, alert and overnight are edited ONLY on 01c-S07.
- **Status:** Decided (designer, 2026-10-30)

## Q11 Phone (390)
- **Decision:** every 01c owner view gets a 390 layout: one column, with branch rows stacked. 01a's phone quick-price page shows the size group name above its sizes and no 01c sections.
- **Status:** Decided (designer, 2026-10-30)

## Q12 Lists
- **Decision:** every list has search by name and is sorted by `sort_order`, then name.
  - **S08:** Name · Category · Sizes, as chips with price ("Half Rs 1,150", "Full Rs 2,200").
  - **S06:** Name · Counted in · Used by, as dish + amount ("Half 500 g, Full 1 kg") · Counted at (branch: station) · Keeps overnight. Search also matches dish names.
  - **S02:** Name · Customers pick ("Pick 1" / "Up to 6" / "Pick 1–2") · Options (first 3 + "+N") · Applies to · branch warnings.
  - **S04:** Name · Deal price · Parts ("1 Full karahi + 4 Naan") · Sold at (branch chips with the branch price) · warnings.
  - **01a-S05** shows a size group as one row, with its sizes nested under it and expanded by default.
- **Status:** Decided (designer, 2026-10-30)

## Q13 "Applies to" picker
- **Decision:**
  - A dialog with search at the top and 3 tabs with counts: Categories / Size groups / Items. Items are grouped by category and load in pages.
  - Each row has a 3-way control: "—" / "Use" / "Not here". "Not here" is not shown on categories.
  - A strip at the bottom reads "Used on 3 · Not here on 1", with the rule note "The most specific wins: item > size group > category."
- **Status:** Decided (designer, 2026-10-30)

## Q14 Removed deal parts
- **Decision:**
  - Request a spec change so `archived_parts` also returns `quantity` and `choices[{ item_id }]`. The row then reads "4 × Naan or Roghni naan".
  - Until then, the row shows "A removed part" + Restore.
- **Follow-up:** the spec change is drafted at the end of the 01c spec, "Proposed — needs approval".
- **Status:** Decided (designer, 2026-10-30)

## Q15 Where the per-branch rows live
- **Decision:** ONE per-branch pattern. Each form has a section "At each branch", with one row per allowed branch.
  - **Stock item:** "Counted here" switch · station · alert below.
  - **Deal:** "Sold here" switch · Price here.
  - **Choice group:** the branch row expands to its options ("Offered here" switch · Price here).
  - Each row has its own version and its own "Save" button, shown only when the row has unsaved changes. A row's stale banner shows on that row only.
  - Lists show the same branch states as read-only chips.
- **Status:** Decided (designer, 2026-10-30)

## Q16 Size group members
- **Decision:** sizes are added only from the item form. On 01c-S09:
  - The members list is read-only: size name, price, and an "Open" link.
  - "Add a size" opens a new item form with the size group and category already filled in.
  - There is no reordering in the pilot.
- **Status:** Decided (designer, 2026-10-30)

## Q17 Not-found handling
- **Decision:**
  - **Owner forms:** the form is replaced by "This {size group / stock item / choice group / deal} isn't here any more. It may have been deleted on another device." with the button "Back to {list}". The list reloads.
  - **Hub stock save `404`:** "A stock item changed in setup. Reload this page and count again." with "Reload".
- **Status:** Decided (designer, 2026-10-30)

## Q18 Unit change notice on 01c-S07
- **Decision:** a warn notice, shown as soon as the unit is changed (before Save): "New unit starts at each branch's next day open. Today's counts stay in {old}; count in {new} from tomorrow."
- **Status:** Decided (designer, 2026-10-30)

---

## Still UNKNOWN (for the designer to settle in the frames)
- The "show archived" toggle label and the archived-list states.
- "No search match" copy on the owner lists.
- Price and quantity error texts (`400`).
- Defaults for a new stock item's "Counted in" (from the list), a deal's category, and a part's quantity.
- In 01c-D03, whether items that are not allowed are hidden or disabled.
- "Open these items" and the titles in 01c-D04.
- `BRANCH_NOT_FOUND` handling.
