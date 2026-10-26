# 01a — Restaurant Setup: open questions

Copy this file to `docs/design/open-questions/01a-setup.md`. It works like the 00 file:
- To answer a question, edit its **Decision** line and set **Status** to `answered`.
- `recommended` means the recommended answer is built unless you change it.
- `blocked` means it needs the owner before it is built.

---

## Q1 Bulk add tables ("T1 to T12, 4 seats")?
- **Recommended:** Yes, in the page; no API change.
  - The page loops one POST per table.
  - Each POST carries its own idempotency key, so a retry adds no duplicates.
  - Progress shows as "Adding 4 of 12…", and the loop stops on the first error with its reason.
  - It is used in the first-run form (`OwnerFloorsEmpty`) and the "Add tables" tile (`OwnerFloors`).
- **Why:** It cuts first setup from about 36 actions to 6.
- **Decision:** bulk add in the page (recommended)
- **Status:** recommended

## Q2 Confirm on archive (D01) and on Cancel with changes (D02)?
- **Recommended:**
  - Confirm before archiving an item, category, station, tax rate or floor. These change what waiters can sell.
  - Archive tables and batch recipes at once, with an 8 s "Archived · Undo" chip.
  - Always ask "Discard your changes?" when leaving a changed form.
- **Decision:** as recommended
- **Status:** recommended

## Q3 "Signed in as Imran · Sign out" on the stock page?
- **Recommended:** Yes, already in every stock frame. It calls `POST /admin/auth/logout`.
- **Why:** The tablet is shared, and the next person must not save counts under Imran's name.
- **Decision:** yes
- **Status:** recommended

## Q4 Keep typed counts when the session idles out?
- **Recommended:** Yes (frame `StockCountsKept`).
  - Unsaved counts go to `localStorage`, keyed by device + business date + staff id.
  - After the same person signs in again, they come back with a banner: "Your 7 unsaved counts from 09:31 are back".
  - Saving, Discard, or a new business day clears them.
  - Another person signing in does not see them; they stay until that person's day ends.
- **Spec line needed:** "Unsaved stock counts survive an idle sign-out on the same device for the same staff member and business day."
- **Decision:** keep on device (recommended)
- **Status:** recommended

## Q5 "Confirm all carried-over counts" in one tap?
- **Recommended:** Yes (frame `StockConfirmAll`).
  - Show a callout "8 counts from last night" with **All 8 are still right**.
  - Rows the manager changed first are left as typed.
  - It sends one `SetPrecookedStock` with the shown values; no new command.
- **Why:** The morning count drops from about 45 taps to about 20.
- **Decision:** yes
- **Status:** recommended

## Q6 Spec owner questions still open (01a §12.6)
These are business decisions for Arif. Each has my suggestion.
- **6.3 Sold out vs cook more, per item?** Yes, per item; it is already the field "When it runs out". Paye and Chanay are Sold out; Karahi and BBQ are Cook more. **Status:** recommended
- **6.5 Same menu and prices at every branch?** **Answered (owner):** the menu is shared, but the price can differ per branch. The item has a main price, and each branch row in the item form has an optional "Price here" (empty = main price). Frames: `OwnerItem`, `OwnerItemNew`, `OwnerMenu` (chip "Johar Town Rs 2,300"). Needs a spec addendum and an API field (see CLAUDE-TASK Phase 2b). **Status:** answered
- **6.10 Which items cook in loads (batch)?** **Answered (owner):** this is decided per item in the item form, by picking a batch station and its recipe for each branch. That is already in the design; there is no separate setting. **Status:** answered
- **6.12 Manual On outside hours?** Hours win, as decided in S47. The stock row shows a "Hours 07:00–13:00" badge, so nobody is surprised. **Status:** recommended
- **6.13 Rounding of kg lines on the bill?** **Answered (owner):** yes. Weigh to 0.05 kg (50 g), price the line to the nearest Rs 1, and show the weight on the bill ("Chicken Karahi 1.25 kg × Rs 2,200 = Rs 2,750"). Billing (05) applies it; 02 uses the same rule for the order line. **Status:** answered

## Q7 Menu without picking a branch?
- **Recommended:** Yes. The Menu tab needs no branch (frame `OwnerBranchPicker` links straight to it). Inside the item form, the Kitchen section lists every branch, one row each.
- **Decision:** yes
- **Status:** recommended

## Q8 (new) Where does the branch picker remember its choice?
- **Recommended:** Keep it in `sessionStorage`, so it survives a reload in the same tab. If the owner has one branch, skip the picker.
- **Status:** recommended
