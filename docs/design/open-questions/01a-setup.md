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
- **6.5 Same menu and prices at every branch?** Same menu and same prices for the pilot. A branch can only mark an item "Not sold here". Per-branch prices come later as price lists (P2). **Status:** blocked. Confirm with Arif.
- **6.10 Which items cook in loads (batch)?** This is data, not design. Expect Degh: Paye, Chanay, Biryani, Haleem; Fryer: fries, pakora. The owner enters it in Stations. **Status:** blocked. Owner data.
- **6.12 Manual On outside hours?** Hours win, as decided in S47. The stock row shows a "Hours 07:00–13:00" badge, so nobody is surprised. **Status:** recommended
- **6.13 Rounding of kg lines on the bill?** Weigh to 0.05 kg (50 g), price the line to the nearest Rs 1, and show the weight on the bill ("Chicken Karahi 1.25 kg × Rs 2,200 = Rs 2,750"). **Status:** blocked. Confirm with Arif; billing (05) uses it.

## Q7 Menu without picking a branch?
- **Recommended:** Yes. The Menu tab needs no branch (frame `OwnerBranchPicker` links straight to it). Inside the item form, the Kitchen section lists every branch, one row each.
- **Decision:** yes
- **Status:** recommended

## Q8 (new) Where does the branch picker remember its choice?
- **Recommended:** Keep it in `sessionStorage`, so it survives a reload in the same tab. If the owner has one branch, skip the picker.
- **Status:** recommended

---

## Q9 (new, from the build) Design wording for labels the spec quotes?
- **Context:** spec §8.1/§8.2 quote some labels word for word (Stock unit, Low stock alert at, Keeps overnight, Cook fresh, Available hours, Grams per piece, the unit-change warning, the Close day question, the stale-day sentence). The build keeps the spec's words; the design has friendlier ones (Counted in, Warn when below, Leftovers can be sold the next day, Cook more, Hours, One plate takes, "Counting changes from tomorrow", "Close today's business day?").
- **Recommended:** use the design's words. It needs an editorial spec line (01a v1.1.1) and a string-table change only.
- **Decision:**
- **Status:** open

## Q10 (new) Item counts the menu cannot show today?
- **Context:** the API has no item counts per category or tax rate, no menu total before the last page, no floor/station counts per branch, and no station filter for "Open these items" (S50 f).
- **Recommended:** leave them out for the pilot; add a small summary to §6.11 (counts per category and tax class) only if the owner misses them.
- **Decision:**
- **Status:** open

## Q11 (new) Show only people with the stock job on the stock sign-in?
- **Context:** `/admin/login-roster` lists every hub admin; the stock page cannot filter by `manage-stock`. Someone without it signs in and then sees the permission text.
- **Recommended:** keep as built until 01b assigns responsibilities; then add the permission to the roster answer.
- **Decision:**
- **Status:** open

## Q12 (new) Urdu translation and review
- **Context:** 29 of 471 owner and stock keys have Urdu (from `OwnerMenuUrdu` and `StockUrdu`); the rest are in `docs/design/handoff/01a/urdu-todo.md` and show in English on an Urdu page.
- **Recommended:** a translator fills `urdu-todo.md`, then someone reads every screen in Urdu once.
- **Decision:**
- **Status:** open

## Q13 (new) Screenshots of the built pages
- **Context:** the hand-off asked for Playwright screenshots in English and Urdu at the frame sizes; Playwright is not installed in this repo, so none were taken.
- **Recommended:** install Playwright outside the repo and capture them against canned API answers, as module 00 did.
- **Decision:** done 2026-10-26: 50 screenshots in `docs/design/handoff/01a/screens/` (canned API answers, not a live walk).
- **Status:** answered
