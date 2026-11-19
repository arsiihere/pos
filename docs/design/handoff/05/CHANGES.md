# 05 Billing — design changes note

Source of behaviour and copy: `docs/design/inventory/05-billing-design-brief.md` (PR #316), updated to **05 v1.0.6 / 02a v1.1.9** (PR #321). Look only: nothing here changes a spec. 95 frames, named as brief §2.1.

## 1. Design decisions

| # | Decision | Why |
|---|---|---|
| D-1 | **The kiosk bill screen is three columns: open bills · bill lines · money.** The open-bills list stays as a rail (same server order, same badges, same tap → bill). | At the lunch rush the cashier jumps between bills all the time. With the list always visible, the next bill is one tap away and the queue is never hidden. The list's data and order are unchanged (`GET /queries/open-bills`). On tablet, portrait and phone there is no rail: the list is the previous screen. |
| D-2 | **The cash / card dues are the hero of the money column**, two big cards side by side, cash in dark ink. The totals table above them has two columns, "If cash" and "By card", so every tax row and rounding row compares at a glance. | Brief §3.2.2: the dues pair is why the cashier asks "cash or card?". |
| D-3 | **Rounding adjustment has its own banded row**, apart from the tax rows, with a sign. | 05 §8, §3.5 (7). |
| D-4 | **Tapping a payment type fills the amount with that type's due.** The pad then says "Total by card Rs 5,996.00" (M-7). Cash given is empty with a focus ring, never pre-filled (M-6). Quick keys are 5,000 / 10,000 / Exact. **Change due is shown only from the `AddPayment` result** (`change_due_minor`); while typing the box says "shows after Add payment — from the hub". | Common cash path: Cash → 7,000 (keypad or keyboard) → Add payment → Close. Card: Card → Add payment → Close. |
| D-5 | **The single primary moves.** While money is left, Add payment is the primary and Close is disabled with the server's reason(s) under it. When the balance is 0, Close becomes the primary and the pad collapses to "All paid". | One primary per screen layer (01d rule); the screen always says what to do next. |
| D-6 | **Close blocks** show one quiet line when there is a single reason (balance). They show a boxed list "Can't close yet" when there are several, one line per `blocks[]` entry in server order (pinned `reason` → copy key, filled from `details`), each with its icon + word + colour. Each fix is on the line (Add buyer, Edit split). | §3.2.8; 05 v1.0.6 §6.1 (R-29). |
| D-7 | **Keypad keys are 64 px** (Q-6) and stay LTR in Urdu. Amounts are Bricolage, tabular, LTR islands in RTL. | |
| D-8 | **Sheets use the 04 / 01d `.dlg` look**: centred on kiosk / tablet, bottom sheet on portrait and phone. The primary button names the missing step ("Place 2 items first", "Make it add up to Rs 1,000.00"). An approvable action ends in "Ask for approval" + Needs approval tag. | 04 pattern. |
| D-9 | **Waiting card in the sheet's place** (01d requester card, info tone, ring with minutes, Withdraw). A short line says what is blocked meanwhile. | §3.5. |
| D-10 | **Shift close is numbered 1 → 4 in the spec's order**: card / online first (with "by" chips for takeover), then cash as a count only ("amount shows after you count"), then petty and open advances, then the count box with an "expected shows after you count" line. Expected appears only in the result. | Blind rule, B23. |
| D-11 | **Day close shows the guard order** (Void requests → Open shifts → Orders not billed). Only what the refusal proves is marked clear; the rest says "checked next". The blocker list is the right panel. | One blocker at a time (owner 2026-11-19). Nothing is pre-checked: the marks come only from the refusal's guard order. |
| D-12 | **Reports** lead with four KPIs (net after credits, invoices, average, fiscal), then sales, payments, shifts, fiscal (with Retry fiscal now), open bills, petty, comps / voids / reopens. | §3.11 order, grouped into cards (allowed). |
| D-13 | Bill state chip: Open = neutral, Partly paid = info, Closed = ok, Reopened = warn (while `reopen_count ≥ 1` and not CLOSED). | Status colours fixed; "Open" is not a warning. |
| D-16 | **Table tile marks** (02a v1.1.9): a small printer mark "Check bill printed" while `MapTile.check_printed_at` is set, a small "Reopened" mark while `MapTile.reopened`; both sit under the usual 02a state and can show together. | 05 v1.0.6 §6.4a (R-30). |
| D-17 | **Petty settle** shows the two typed amounts only; a mismatch is the hub's `PETTY_SETTLE_MISMATCH` shown inline after Settle. **Day close done** reads the Z number and content from `GET /queries/z-reports?business_date` after the close. | Reviewer MINORs (2026-11-20). |
| D-14 | Print status is a coloured row with the document kind; failed and waiting > 10 s carry **Print to** right on the row. | B18; R-27. |
| D-15 | Yellow sticky notes on frames are spec notes for the builder (e.g. "05 v1.0.5 §6.23a (G-28)"), not UI. | Prompt rule. |

## 2. Answers to the open questions (brief §7)

| # | Answer |
|---|---|
| Q-2 | No note on the open-bills row. The PENDING VOID tag and the Close block on the bill explain the difference. |
| Q-3 | **Decided: server only** (reviewer MINOR). No change figure while typing; Change due appears after Add payment from `change_due_minor`. |
| Q-4 | **Decided** (R-29): **New** = `lines[].added_after_close`, shown only on lines of an open split (`BillPartlyPaid`, `SplitLocked`). |
| Q-5 | **Decided** (R-29): `blocks = [{ reason, split_no, details }]`, pinned reasons `bill_not_open`, `void_pending`, `weight_pending`, `tax_unresolved`, `discount_pending`, `buyer_id_required`, `balance_due`, `shares_sum` → copy keys `billing.blocks.<reason>` (`BillCloseBlocked`, `BillBuyerRequired`, `DiscountWaiting`). |
| Q-6 | 64 px keys; the number field uses Bricolage at 26–30 px; physical keyboard digits work too. |
| Q-8 | No preview line and no computed amount; the field shows what was typed. Totals show after the answer. |
| Q-9 | On for the cashier kiosk (`ShiftOpen`), not shown on the phone (`ShiftOpenPhone`), off by default on a tablet. |
| Q-10 | Another person's shift is reached only from Day close → "Close this shift" (`ShiftOther`). No picker. |
| Q-11 | **Decided** (R-30, 02a v1.1.9): both marks on the tile from `MapTile.check_printed_at` and `MapTile.reopened` (`TableBillStates`, `TableSheetBill`). |
| Q-12 | "Who takes it" chips from the sign-in roster `GET /queries/staff-roster`. |
| Q-18 | **Decided** (R-29): "Reopened" chip while `reopen_count ≥ 1` and the bill is not CLOSED (`BillRefund`, `ReopenCorrections`). |

## 3. Copy changed or added (`key: new English`)

- `pad.tendered`: **Cash given** (as the brief).
- `billing.blocks.*` header: **Can't close yet** (new, designer copy, the box title).
- `billing.list.empty` sub-line (new): **Bills show here as soon as a table orders or a takeaway is placed.**
- `billing.prices_include_tax`: not drawn (the PK-PB seed is exclusive).
- `pad.idle` (new): **Pick how they pay** / **The amount fills in with what is due for that type.**
- `pad.all_paid` (new): **All paid** / **Add another payment only if the customer changes how they pay.**
- `pad.change_after_add` (new): **shows after Add payment — from the hub**.
- `billing.blocks.<reason>`: keys renamed to the pinned reasons (`bill_not_open` new: **This bill is already closed**; `buyer` → `buyer_id_required`; `balance` → `balance_due`; `shares` → `shares_sum`).
- `dayclose.done`: **Day closed · Z {z_no}** (no printer name; the Z prints by itself).
- `buyer.privacy` (new): **The number is sent with Close, then cleared. It is never shown again on any screen — it prints only on this customer's receipt.**
- `buyer.use` (new button): **Use for this close**.
- `shift.blind_hint` (new): **The expected amount shows after you count — count first.**
- `shift.cash_after_count` (new): **amount shows after you count**.
- `dayclose.order_hint` (new): **The hub checks in this order and shows one thing to fix at a time. Fix it, then tap Close day again.**
- `print.title` (new): **Print the receipt on…** / **Print the check bill on…**; `print.note`: **The receipt moves to the printer you pick. Nothing prints twice.**
- `petty.limit_ok` / `petty.limit_over` (new): **Up to {limit} is recorded at once** / **Over the {limit} limit — a manager approves it**.
- `split.place_first` (new, button): **Place {n} items first**.
- `offline.bill` (new): **Reconnecting to the hub… · Showing what we had as of {time} · every bill action needs the hub**.

No copy differs from the brief in meaning.

## 4. Sample-data mismatches (brief §0.6 vs these frames)

- **BillTotalChanged.** The brief says "changed to Rs 6,684.00". That doesn't follow from Table 7's numbers. The frame uses a consistent case: card 5,996.00 paid, 1 × Raita 120.00 added → card total **Rs 6,122.00**, left Rs 126.00 card / Rs 767.00 cash (whole split at cash rate). The Raita carries no New mark: no split is closed, so `added_after_close` is false.
- **T4 + T5 partly paid.** The brief says "Paid Rs 1,500.00". To stay consistent with net 3,000.00 + 5 % service charge, split 1 (net 1,200.00) is paid **Rs 1,462.00** cash, and split 2 shows cash 2,192.00 / card 1,985.00.
- **Remove comp card** shows "Paye × 1" as the brief's §4.1 example does, although §4.1's rule says the card shows only amount, reason and identifier. Builder: check whether the item name is in `details`. If not, drop it.
- **Reports.** X and Z numbers are invented, but they add up (net, tax by class, rounding, credits) and keep the 05 §6.26 invariant: takings = Z net + carried forward − brought forward (Z 0042: 413,300 = 412,300 + 1,000 − 0).

## 5. Open items

1. **"Done" on BillClosed** returns to the open-bills list. That is navigation only, no new behaviour.
2. **ShiftCountResult "Done"** leaves the shift screen. Signing out stays 01d's.
3. **Handover count rows** show only time, expected and counted. `handovers[]` fields beyond that aren't listed in the brief.
4. **Retry fiscal now** is drawn on the X for Imran (`close-business-day`). Other `view-reports` holders don't see the button.
5. **Phone bill**: the lines collapse to "5 items · Show lines". The expanded state reuses 02b's line rows (not drawn).
6. **Discount and petty sheets** include an on-screen keypad for the touch kiosk. The physical keyboard works too.
7. Fonts: `design/css/fonts.css` points to `../ds/pos/fonts/` (bundled). The canvas copy points to its own uploaded blobs.
