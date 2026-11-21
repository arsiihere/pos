# 05 Billing — design brief

For the designer. This one file is everything you need to design every **staff** screen, state, sheet and alert card of module **05 (Billing)**: the cashier screen, the bill and its payment pad, splits, the bill sheets, print status, shifts, petty cash, the cash drawer, day close, X / Z reports and the approval cards. All behaviour is already decided by the approved spec. Your job is the look and the layout only.

**Sources, in order of authority:** `docs/specs/05_Billing_Spec_v1.0.6.md` (APPROVED; cited "05 §n"; its decisions B1–B32 are cited "05 B-n"; ⚠️ Changed for 05 v1.0.6: the bill view's `lines[].added_after_close`, pinned `blocks` and `reopen_count` (R-29, Q-4 / Q-5 / Q-18), the table-tile marks (R-30, Q-11, 02a v1.1.9) and `prints[].printer_name` (R-35)). Then the build board `docs/plans/05-status.md` and `docs/plans/05-gaps.md` (owner rulings R-1 … R-14, gaps G-1 … G-27; later rulings R-15 … R-21 are already in the spec text as "Changed in v1.0.3 / v1.0.4"), the plan `docs/plans/05-plan.md` (client rows C1 tasks 34–38 and C2 tasks 39–42; reading PL-12 = owner ruling D-3), and the specs 05 leans on: 01d Alerts v1.3.4 (cards, PIN, holders right), 02a v1.1.9 / 02b (table view and tile marks, line tags, Ask for bill), 04 (PENDING VOID, day-close void block), 03c v1.0.12 (printers and document jobs), 01b (permissions). What is already built is cited by file: `packages/domain/src/billing/{types,compute,docs}.ts`, `packages/domain/src/errors.ts`, `apps/client/src/i18n/en.ts`, and the hand-offs `docs/design/handoff/{01d,02a,02b,04}/`.

**Print to picker (now in the spec):** the **Print to** picker reads the staff query `GET /queries/bill-printers` (`take-order`, any grant — the same permission as `RetargetBillPrint`; result `[{ printer_id, name }]` of active printers). The owner approved it on 2026-11-19 as gap **G-28** and amended the permission in ruling **R-27**; it is 05 **v1.0.5 §6.23a** (PR #317), kept in v1.0.6. Everything that depends on it is marked **"05 v1.0.5 (G-28)"**.

**This file replaces nothing.** `docs/design/inventory/05-billing.md` is the pre-spec inventory (36 screens). Much of it is outdated (tips, split by person, refund screen, reopen day, owner settings screens). Where it disagrees with this file, this file wins, because this file follows the approved spec. A mapping of every old ID is in §2.3.

---

## 0. How to use this brief

### 0.1 Scope

You design, for the **staff entry** (`apps/client`, light Pulse staff theme):

1. **Cashier screen (05-S01)** — the open-bills list with its badges and the fiscal status line. 05 §6.2, §6.27, §8.
2. **Bill screen (05-S02)** with its **payment pad (05-C01)** — lines, server totals, dues, tendered and change, refunds, close, every block. 05 §3.2–§3.7, §6.1, §6.9–§6.12, §8.
3. **Split editor (05-D01)** — items / amount / equal; locked splits. 05 §3.8, §6.5, §8.
4. **Bill sheets** — discount (05-D02), service charge (05-D03), buyer (05-D04), reopen (05-D05), remove comp (05-D06), remove payment (05-D07). 05 §6.6–§6.8, §6.10, §6.11, §6.13, §6.14.
5. **Print status and Print to (05-C02)**. 05 §3.16, §6.22, §6.23, B18; picker data 05 v1.0.5 §6.23a (G-28, R-27).
6. **Shift screens** — open (05-S03), my shift / close / blind count / handover (05-S04). 05 §3.11, §6.15–§6.19.
7. **Petty cash (05-D08)** and **Open cash drawer (05-D09)**. 05 §3.12, §6.20, §6.21.
8. **Day close in the staff app (05-S05)** — blockers, carry over, close, the Z shown. 05 §3.13, §6.24, §6.25.
9. **Reports (05-S06)** — X any time, the Z list and one Z. 05 §6.26.
10. **Alert cards for the 05 kinds (05-N01 … N08)** on 01d's card, banner, inbox and answer sheet. You design their content in every state, not new components. 05 §3.14, §3.15.
11. **The delta 05 adds to 02a / 02b screens** (05-X01, X02) — check bill printed, bill closed → To clean, reopened seating, the Bill entry. Draw only the delta.

### 0.2 Not to be designed here

| Thing | Why / where it lives |
|---|---|
| Owner app Billing settings page (payment modes, jurisdiction, discount reasons, petty categories, limits, receipt template and preview) | Owner settings, built on existing owner-app patterns without a 05 hand-off: plan PL-12, owner ruling **D-3** (task P0.10). |
| Hub admin `/admin/fiscal/` token page | Same ruling D-3 (task 31a; P0.5 shell). 05 §6.28a, §8. |
| Hub admin Stock page text for the new day-close reasons | D-3 (task P0.6). 05 row A-5. The staff-app day close **is** in scope (05-S05). |
| Hub admin Printers "Bill printers" section (bill routes) | D-3 (task P0.16). 03c v1.0.12 row P-1. |
| Printed layouts: check bill, receipt, credit note, X / Z, no-sale | Fixed by the doc builders `packages/domain/src/billing/docs.ts` (task 4a, merged; 05 §3.16, B17, B21, B29) and the owner's receipt template (owner app). Not drawn here; §5 says what the screen may show about them. |
| The void sheet, PENDING VOID line, void approver card, 04's day-close void list on `/admin/stock` | 04 hand-off (`docs/design/handoff/04/`). 05 only **shows** a pending void as a line tag and a close block. |
| Comp sheet, "Comp it?", weight entry, Remove (stage 1) | 02b hand-off (`Comp`, `CompItPrompt`, `EnterWeight`). 05 adds only **Remove comp** (05-D06). |
| Ask for bill confirm, Mark clean, table colours, table sheet | 02a hand-off (`AskBill`, `Clean`, `TableSheet`, `Tiles`). 05 adds a delta only (05-X01, X02). |
| PIN step, "Approve here", answer errors, inbox, banners, lock text, toasts | 01d hand-off (`Pin*`, `InPerson*`, `Answer*`, `Inbox*`, `Banner*`, `Lock*`). Reused unchanged. |
| Tips, split by person, refund screen, business-day reopen, line discounts, khata, card-terminal / wallet integration, Raast QR, receipt logo, cash count by denomination, Z as PDF / CSV, QR "share bill" | Out of v1.0: 05 §1.3 (tips Q5, refund without reopen Q8, day reopen Q11, line discounts Q6, khata P2, terminals R7, Raast G1-11, logo K-12); `CountShift` takes one `counted_minor` (05 §6.17); no export or share API exists. Owner confirmed the drop on 2026-11-19. |
| `pro_rata` mixed-payment declaration step | Removed in 05 v0.8.1 (§26); v1.1 at the earliest (05 §3.6). |

### 0.3 The "design only" rule

"Sari information ho, aur design mein bas design hi bana ho." Every behaviour, rule, limit, error code, number and printed text below is decided by the spec. **The designer chooses look and layout only.** Do not add, remove or change behaviour: no new buttons, confirmations, steps, settings, filters or data. Where the spec is silent, this file says **"spec silent → designer choice"** (you choose the look; behaviour is unchanged) or lists it in §7 as an open design question with a recommendation. If a screen would need data the API does not give, it is in §7, not in the design. If you think a behaviour is wrong, write a note on the frame. Do not design around it.

**Money is never computed on the screen.** Every total, tax row, rounding line, due, change and refund shown comes from the server (05 §8 "totals from the server only", §6.1, §6.9 result). The screen formats them with the bill's `currency.exponent` (05 §8 i18n, row F-6): never a hard-coded 2 decimals. Draw the sample in PKR (exponent 2), and do not draw a layout that only works with 2 decimals.

Copy is **intent plus a proposed English text** (§6). You may improve the wording. You may not change the meaning. Error texts never show the server's message, a code, a permission key, a kind key, a ULID or a raw enum value (00-index "Error by code"). Status is always **icon + word + colour**, never colour alone. Times are 12-hour ("1:22 PM").

### 0.4 Deliverable the owner expects

Same format as the 01d / 02 / 04 hand-offs: a **Claude Design** canvas "05 Billing Screens" with static `*.dc.html` frames at device size; the integrator imports it into `docs/design/handoff/05/` (`README.md`, `CHANGES.md`, `MAPPING.md` + `mapping.json`, `INDEX.html`, `design/*.dc.html`, `design/css/`, `design/screens/<frame>__WxH__<lang>.png`, `urdu-todo.md`). The prompt for the canvas is `docs/design/handoff/05/DESIGN-PROMPT.md`. The client lanes C1 and C2 wait for that folder (05-plan §3.1, §4.1).

| Rule | Detail |
|---|---|
| One frame per state | Every state in §3 that changes what a screen shows gets a frame, named `<ScreenName><State>` (e.g. `BillCloseBlocked`). Small inline states (one line of text) may share a component frame with a note. §2.1 lists the frames. |
| Sizes | **Cashier kiosk 1920×1080** (main device for 05: mouse, keyboard and touch). **Tablet 1280×800** landscape and **800×1280** portrait (manager / cashier tablet). **Staff phone 390×844** (an order taker closing own tables with `take-payment` scope `own_tables`, 05 §6.1, B11). |
| Theme | The light Pulse staff theme only. 05 has no KDS frame (the KDS shows no 05 screen). |
| Urdu RTL | The **main state of each screen** in Urdu (§2.1 marks them `…Urdu`): Latin digits; amounts, invoice numbers, times, identifiers and counts are LTR islands inside RTL. |
| Amounts | `formatMinor(amount_minor, exponent)` style output (`packages/domain/src/billing/docs.ts` `formatMinor`): "Rs 6,624.00". Right-aligned, tabular figures, always LTR. Negative amounts (refunds, a negative variance, a negative rounding) show a sign and a word, never colour alone. |
| Sample data | §0.6. Never a real phone number, ID number, token, email or machine path (repo is public, W-5). |
| Pixel rules | As 01d PROMPT "Pixel-perfect and layout behaviour": the page never scrolls on tablet / kiosk; only list regions scroll; no horizontal scroll on the phone. |

### 0.5 Design language to follow

- **Pulse, Arif Chatkhara direction** (01d, 02, 04 hand-offs): maroon chrome `#6E140E`, cream ground `#F8F1E7`, white cards, saffron primary `#F4A321`, Bricolage Grotesque (display, **numbers and amounts**) + Figtree (text) + Geist Mono (invoice numbers, references) + Noto Nastaliq Urdu. Files: `docs/design/handoff/04/design/css/` (`pulse.css`, `v-brand.css`, `pulse-01d.css`, `pulse-02.css`, `pulse-04.css`, `tokens.css`, `bundle.css`, `fonts.css`) and the bundled fonts in `docs/design/handoff/04/design/ds/pos/fonts/` (the hub has no internet; nothing from a CDN).
- **New styles go in one new `pulse-05.css`, with no new tokens.** Status colours are fixed: ok (paid, printed, closed), warn (blocked, waiting, over limit, open too long), danger (failed print, variance over threshold, rejected fiscal), info (pending approval, fiscal pending).
- **Reuse, do not redraw:** 01d alert card `.ac`, banner, inbox row, answer sheet, PIN pad, `.msg`, `.toast`, `.sk`, `.empty`, bottom sheet (`.scrim--sheet`); 02 table sheet, tiles, top bar, hub-offline bar ("Needs the hub" disabled state, 02-B02); 02b order lines and the COMP tag; 04 PENDING VOID tag `.ptag` (renamed `.vptag` in the ui-kit), Needs-approval tag `.ntag`, sheet `.dlg--v`, banner list `.pos-banner__list` with "and N more".
- **White-label:** only `--brand-primary` / `--brand-secondary` change per restaurant.
- **Global rules** (00-index, 01d PROMPT): one primary button per screen layer; status is icon + word + colour; 12-hour times; never show a permission key, kind key, error code, ULID or raw enum value; disabled buttons say why (inline reason, `aria-disabled`).

### 0.6 Sample data (Arif Chatkhara, Gulberg branch, lunch rush, 1:40 PM)

Branch jurisdiction **`PK-PB`** (adapter `PRA`): prices exclusive, rounding step Rs 1 nearest on every bill (`applies_to: 'all'`), mixed rule `higher_rate`, buyer ID threshold Rs 50,000 (types CNIC, NTN), fiscal number label "PRA invoice no." (05 row A-1 seed, Appendix P.4). Currency PKR, exponent 2. Restaurant-service profile: **16 % cash, 5 % digital** (05 §6.31).

| What | Sample |
|---|---|
| **Main bill — Table 7** (05 §6.31) | Dine-in, waiter Bilal. Lines: 1 × Chicken Karahi Full 2,200.00 · 1 × Seekh Kebab (6 pcs) 900.00 · 6 × Naan 360.00 · 2 × Raita 240.00 · 1 × Paye 1,450.00 · 4 × Soft drink 560.00 → **net Rs 5,710.00**. No service charge (`service_charge.rate_bp` 0). |
| Its dues, unpaid | **Cash due Rs 6,624.00** (tax 16 % 913.60, rounding +0.40) · **Card due Rs 5,996.00** (tax 5 % 285.50, rounding +0.50) (05 §3.5 (7), §6.31). |
| All by card | Card 5,996.00 → close → invoice **AC1-S000123** (prefix `AC1-`, sale series, 05 §6.12 step 5, §6.31), "FISCAL NUMBER PENDING" until the worker answers. |
| Mixed | Card 3,000.00 paid → the split is now cash class → **cash due Rs 3,624.00** (05 §6.31 step 3). |
| Cash with change | Cash, tendered Rs 7,000.00 for 6,624.00 → **change due Rs 376.00**. |
| Equal split of Table 7 in 2 | Each split net 2,855.00 → cash due 3,312.00, card due 2,998.00 (illustration of §3.5 per split; the screen shows server values). |
| Discount | 10 % "Regular customer" on Table 7 → discount 571.00 → cash due 5,961.00, card due 5,396.00 (illustration). |
| Service charge sample — **T4 + T5** | Merged tables, waiter Ali, net 3,000.00, service charge 5 % = 150.00, charge taxed under the same profile → cash due 3,654.00, card due 3,308.00 (illustration). After Remove: cash 3,480.00, card 3,150.00. |
| Refund sample | Table 7 paid cash 6,624.00, reopened, 2 soft drinks removed (−280.00) → new cash total 6,299.00 → **refund cash Rs 325.00** (05 §3.5 (7) "jitna liya utna wapas"). |
| Buyer ID sample — **Family 2** | Corporate lunch, net 52,400.00 (> Rs 50,000 threshold) → buyer required. Buyer name "Sample Traders"; ID type CNIC; value typed only as the obviously fake **`00000-0000000-0`**; never shown again after send (§3.5.3). |
| Takeaway | **#12**, 3 × Naan + 1 × Chicken Karahi Half, placed by order taker Hamza. Earlier-day takeaway **#12 18 Nov**. |
| Parking | **PARKING ABC 123 SEDAN** (sample plate placeholder, 04 ruling O8). |
| Payment modes (owner data) | Cash (cash class) · Card (digital) · JazzCash (wallet, digital, needs a reference) · Bank transfer (online, digital, needs a reference). |
| Discount reasons (owner data, 05 §4.4 examples, R-10) | Regular customer · Staff · Owner's guest · Complaint · Other (needs a note). |
| Petty categories (owner data, R-10) | Supplies · Repairs · Transport · Staff food. Petty cash limit **Rs 5,000** (R-14 default). Variance threshold **Rs 100** (R-14 default). Open-too-long flag at **240 min** (R-14 default). |
| People | Sana (cashier, kiosk drawer shift), Usman (evening cashier), Imran (manager), Arif (owner), Bilal and Ali (waiters), Hamza (order taker, phone). |
| Devices / printers | "Counter kiosk" (cashier kiosk, drawer); "Tablet 3" (manager tablet). Printers: "Counter" (bill route of the ground floor and the counter device), "First floor bill" (first-floor bill route), "Tandoor printer". |
| Shift | Sana's drawer shift opened 11:00 AM, float Rs 5,000.00; card takings 3 payments 18,420.00; JazzCash 2 payments 2,150.00; cash 14 payments (count only before the count); counted 48,250.00 → expected 48,500.00 → **variance −250.00** (over Rs 100 → sign-off). |

---

## 1. Who and where

| Code | Device | Size | Who | Conditions | Touch target |
|---|---|---|---|---|---|
| **K** | Cashier kiosk: Windows, hub-served app in Chrome / Edge kiosk mode, mouse + keyboard + touch, counter printer, cash drawer (05 B11 "drawer") | 1920×1080 | Cashier (Sana) with `take-payment`, `manage-own-shift`, `record-petty-cash`, `open-cash-drawer`; manager on takeover | Queue at the counter at 1:30 PM; customers watching the screen; 1 500–2 000 bills a day; mixed cash / card / wallet | 56 px (staff rule); keypad keys 64 px recommended (§7 Q-6) |
| **T** | Manager or cashier tablet (Android, Capacitor) | 1280×800; portrait 800×1280 | Manager (Imran): approvals, day close, shift close for others, reports; a cashier on a tablet drawer (a tablet with a printer route, 05 §6.15) | Walking the floor; one hand | 56 px |
| **P** | Staff phone | 390×844 | Order taker / waiter (Hamza) closing own tables or own takeaway orders (`take-payment` scope `own_tables`, 05 §6.1) with his own shift (no drawer; 05 §6.9 money shift) | At the table, standing, customer beside him | 56 px |

**Permissions decide what shows** (R5: permission-derived, never a role check). The 05 permissions (01b, R-23) and their existing / new labels `perm.<key>` in `apps/client/src/i18n/en.ts`: `take-payment`, `apply-discount` (exists: "Give a discount"), `remove-service-charge`, `close-without-buyer-id`, `reopen-bill` (exists: "Reopen a closed bill"), `remove-comp`, `manage-own-shift`, `close-shift-for-others`, `skip-blind-count`, `record-petty-cash`, `open-cash-drawer`, `close-business-day`, `view-reports` (exists: "See sales reports"), `take-order` (exists: "Take orders"). An approvable permission held as `requires_approval` shows the **Needs approval** tag on its action (04 `.ntag` pattern); held `allowed` shows no tag. Never show the key.

**Network.** Everything is hub LAN. **No 05 command is queueable** (05 §6 header, G0-1: money, PIN-capable). While the hub socket is down, every 05 action shows the 02 "Needs the hub" disabled state with the hub-offline bar; reads keep the last data with its time (05 §8 "Online-only actions show 'Needs the hub' offline"). Billing never needs the internet: close, payments, shifts, petty cash and day close work on the LAN; only the fiscal answer waits (05 §7 Offline).

**Live updates.** The cashier screen and the bill screen refetch on focus, on `event` frames of the bill / order / table streams and on reconnect (05 §8; plan G-26: the three `ORDER_FRAMES` lists). There is **no sound and no push for a bill request** (05 §8, Q13): the badge on the list is the only signal.

---

## 2. Screen inventory

### 2.1 Table

Kinds: **S** screen, **C** component, **D** dialog or sheet, **B** banner or inline state, **N** alert card (01d component, new kind), **X** delta on an existing 02 screen. Devices as §1. Frames: the names the canvas must use; sizes in brackets (K 1920×1080, T 1280×800, TP 800×1280, P 390×844).

| ID | Name | Kind | Device | Who (permission) | Spec | Frames |
|---|---|---|---|---|---|---|
| **05-S01** | Cashier screen — open bills | S | K T | `take-payment` | 05 §6.2, §6.27, §8 | `OpenBills` (K) · `OpenBillsTablet` (T) · `OpenBillsEmpty` (K) · `OpenBillsFiscal` (K, fiscal line states) · `OpenBillsOffline` (K) · `OpenBillsUrdu` (K) |
| **05-S02** | Bill screen | S | K T TP P | `take-payment` (full); `take-order` (read-only) | 05 §3.2–§3.7, §6.1, §6.3, §6.12, §8 | `Bill` (K, unpaid, dues side by side) · `BillPadCard` (K) · `BillPadCash` (K) · `BillMixed` (K) · `BillReadyToClose` (K) · `BillCloseBlocked` (K) · `BillBuyerRequired` (K) · `BillTotalChanged` (K) · `BillPartlyPaid` (K) · `BillRefund` (K) · `BillClosed` (K) · `BillOffline` (K) · `BillErrors` (K, component) · `BillReadOnly` (T) · `BillTablet` (T) · `BillPortrait` (TP) · `BillPhone` (P) · `BillUrdu` (K) |
| 05-C01 | Payment pad (modes, amount, tendered, change) | C | in 05-S02 | `take-payment` | 05 §3.7, §6.9, §8 | in `Bill`, `BillPadCard`, `BillPadCash`, `BillMixed`, `BillRefund` |
| 05-C03 | Totals block (subtotal, discount, service charge, tax rows, rounding, total, dues) | C | in 05-S02, D01 | — | 05 §3.5, §6.1 `Totals`, §8 | in every `Bill*` frame |
| 05-C04 | Line row with tags (COMP, PENDING VOID, WEIGHT NEEDED, Tax not set, new, locked) | C | in 05-S02, D01 | — | 05 §6.1 `tags`, §8 | in `Bill`, `BillCloseBlocked`, `BillPartlyPaid`, `SplitLocked` |
| **05-D01** | Split editor | D | K TP | `take-payment` | 05 §3.8, §6.5, §8 | `SplitItems` (K) · `SplitAmount` (K) · `SplitEqual` (K) · `SplitLocked` (K) · `SplitInvalid` (K) · `SplitPortrait` (TP) |
| **05-D02** | Discount sheet | D | K P | `apply-discount` | 05 §6.6, §6.7, B7 | `Discount` (K) · `DiscountWaiting` (K) · `DiscountPhone` (P) |
| **05-D03** | Remove service charge (and Add back) | D | K | `remove-service-charge` | 05 §6.8, B8 | `ServiceChargeRemove` (K) · `ServiceChargeWaiting` (K) |
| **05-D04** | Buyer sheet (name + ID type + ID value; Customer refuses) | D | K | `take-payment`; waiver `close-without-buyer-id` | 05 §3.3 (6), §6.11, §6.12, B19 | `Buyer` (K) · `BuyerWaiveWaiting` (K) · `BuyerUrdu` (K) |
| **05-D05** | Reopen bill | D | K | `reopen-bill` | 05 §3.10, §6.13 | `Reopen` (K) · `ReopenWaiting` (K) · `ReopenCorrections` (K) · `ReopenNotSupported` (K) |
| **05-D06** | Remove comp | D | T | `remove-comp` | 05 §6.14, B27 | `RemoveComp` (T) · `RemoveCompWaiting` (T) |
| **05-D07** | Remove payment | D | K | `take-payment` (+ `close-shift-for-others` for another person's payment) | 05 §6.10 | `RemovePayment` (K) · `RemovePaymentShiftClosed` (K) |
| **05-C02** | Print status + Print to picker | C | K T P | status and picker: everyone who sees the bill (`take-order`, any grant, R-27; `take-payment` holders hold it by default) | 05 §3.16, §6.1 `prints`, §6.22, §6.23, B18; 05 v1.0.5 §6.23a (G-28, R-27) | `PrintStatus` (K, component) · `PrintTo` (K) · `PrintToPhone` (P) |
| **05-S03** | Open shift | S | K P | `manage-own-shift` | 05 §3.11, §6.15 | `ShiftOpen` (K) · `ShiftOpenErrors` (K, component) · `ShiftOpenPhone` (P) |
| **05-S04** | My shift / close (blind count, result, sign-off, skip, handover, another person's shift) | S | K T P | `manage-own-shift`; `skip-blind-count`; `close-shift-for-others` | 05 §3.11, §6.16–§6.19, B23 | `ShiftClose` (K) · `ShiftCountResult` (K) · `ShiftVariancePending` (K) · `ShiftSkip` (K) · `ShiftHandover` (K) · `ShiftHandoverResult` (K) · `ShiftOther` (T) · `ShiftPhone` (P) · `ShiftUrdu` (K) |
| **05-D08** | Petty cash (advance / out / in; open advances; Settle) | D | K | `record-petty-cash` | 05 §3.12, §6.20, B24 | `Petty` (K) · `PettyAdvance` (K) · `PettyWaiting` (K) · `PettyAdvances` (K) · `PettySettle` (K) · `PettyUrdu` (K) |
| **05-D09** | Open cash drawer (no sale) | D | K | `open-cash-drawer` | 05 §6.21 | `Drawer` (K) |
| **05-S05** | Day close (staff app) | S | T K | `close-business-day` | 05 §3.13, §6.24, §6.25, row A-5 | `DayClose` (T) · `DayCloseVoids` (T) · `DayCloseShifts` (T) · `DayCloseUnbilled` (T) · `CarryOver` (T) · `DayCloseDone` (T) · `DayCloseKiosk` (K) · `DayCloseUrdu` (T) |
| **05-S06** | Reports (X, Z list, one Z) | S | K T | `view-reports` | 05 §6.22, §6.26, B26 | `XReport` (K) · `ZList` (K) · `ZReport` (K) · `ReportsTablet` (T) |
| **05-N01** | Discount approval card | N | T K P | requester / grant's approvers | 05 §3.14 `discount` | `AnswerDiscount` (T) |
| **05-N02** | Remove service charge card | N | T K P | grant's approvers | 05 §3.14 `remove_service_charge` | `AnswerServiceCharge` (T) |
| **05-N03** | Reopen bill card | N | T K P | grant's approvers | 05 §3.14 `reopen_bill` | `AnswerReopen` (T) |
| **05-N04** | Remove comp card | N | T K P | grant's approvers | 05 §3.14 `remove_comp` | `AnswerRemoveComp` (T) |
| **05-N05** | Close without buyer ID card | N | T K P | grant's approvers | 05 §3.14 `close_without_buyer_id` | `AnswerBuyerWaiver` (T) |
| **05-N06** | Petty cash card | N | T K P | holders of `close-shift-for-others` | 05 §3.14 `petty_cash` | `AnswerPetty` (T) |
| **05-N07** | Shift variance sign-off card | N | T K P | holders of `close-shift-for-others` | 05 §3.14 `shift_variance` | `AnswerVariance` (T) |
| **05-N08** | Fiscal records stuck (notice) | N | T K P | managers | 05 §3.15 "Stuck" | in `Cards05` |
| 05-N09 | Every 05 card state (requester and approver sides) | N | T K P | — | 01d C01, D01, N04 | `Cards05` (T, component) · `Answers05States` (T, component) · `AnswerKiosk05` (K) · `AnswerPhone05` (P) · `AnswerUrdu05` (T) |
| **05-X01** | Table tile / map delta (check bill printed, To clean after close, reopened) | X | T | as 02a | 05 §3.10, §6.2, 02a `BillClosed`, `SeatingReopened` | `TableBillStates` (T) |
| **05-X02** | Table sheet delta (Bill entry, bill states) | X | T P | `take-payment` / `take-order` | 05 §6.1, §6.3, §8 | `TableSheetBill` (T) · `TableSheetBillPhone` (P) |

**Frame count: 95** — K 60 · T 26 · TP 2 · P 7. Urdu frames (7, inside the count): `OpenBillsUrdu`, `BillUrdu`, `BuyerUrdu`, `ShiftUrdu`, `PettyUrdu`, `DayCloseUrdu`, `AnswerUrdu05`.

### 2.2 Reused, not redesigned (draw only if a frame needs it for context)

| Reused | From | Where it shows up here |
|---|---|---|
| Staff sign-in, PIN pad, top bar, staff nav, tablet alerts header (B05) | 01d `SignIn`, B05; 02 top bar | around every 05 screen |
| Alert card `.ac`, inbox row, banner, answer sheet D01, PIN step D02, Approve here D03, read-only line B02, answer errors B04, result to requester N04, lock text F01 | 01d hand-off | 05-N01 … N09 |
| PENDING VOID tag, struck price, total note `.xp`, Needs-approval tag `.ntag`, sheet `.dlg--v`, banner list with "and N more" | 04 hand-off | 05-C04, every approvable action, 05-S05 |
| COMP tag, weight-pending line, Comp sheet, Enter weight | 02b hand-off (`CartLines`, `Comp`, `EnterWeight`) | 05-C04 (the weight itself is entered in 02b's order view; the bill only shows the tag and the block) |
| Table map tiles and colours (Bill red, To clean grey), table sheet, Ask for bill inline confirm, Mark clean, hub-offline bar | 02a hand-off (`Tiles`, `TableSheet`, `AskBill`, `Clean`, `TableMapOffline`) | 05-X01, X02; "Needs the hub" everywhere |
| Open orders list on the kiosk | 02b `OpenOrdersKiosk` | stays as a tab beside 05-S01 (§3.1.1 Entry) |

### 2.3 Old inventory IDs (`05-billing.md`) → this brief

| Old | Name (old) | Now |
|---|---|---|
| 05-S01 | Open shift (float) | **kept as 05-S03** |
| 05-S02 | Cashier home: bills to settle | **kept as 05-S01** (open-bills list, 05 §6.2) |
| 05-S03 | Bill | **kept as 05-S02** |
| 05-D01 | Discount | **kept as 05-D02** (whole bill only, 05 B7) |
| 05-D02 | Remove service charge | **kept as 05-D03** (with Add back, 05 §6.8) |
| 05-D03 | Comp an item | **out of scope** — 02b Comp sheet (02b hand-off `Comp`); 05 adds only Remove comp (05-D06) |
| 05-S04 | Take payment | **merged into 05-S02** (payment pad 05-C01 on the bill screen, 05 §8) |
| 05-D04 | Card amount | **merged into 05-C01** (amount on the pad; no terminal integration, 05 §1.3) |
| 05-D05 | Online payment (reference) | **merged into 05-C01** (reference field when the mode needs one, 05 §3.7) |
| 05-D06 | Tip over threshold | **dropped** — no tips in v1.0 (05 §1.3, Q5) |
| 05-S05 | Split bill (by item / person / amount) | **kept as 05-D01** — items / amount / equal; **"by person" dropped** (no seats; 05 §3.8, SPLIT_MODES) |
| 05-D07 | Assign the remainder | **dropped** — no remainder step: later lines join the open remainder automatically and amount shares are re-based by the server (05 §3.8, OQ-6, H1-22) |
| 05-S06 | Refund | **dropped** — no refund without reopen (05 §1.3, Q8); a refund is Reopen (05-D05) + a pay-out on the pad (05-S02 `BillRefund`) |
| 05-S07 | Petty cash | **kept as 05-D08** |
| 05-S08 | Close shift — blind count | **merged into 05-S04** (`ShiftClose`) |
| 05-S09 | Close shift — result | **merged into 05-S04** (`ShiftCountResult`) |
| 05-D08 | Variance over threshold — manager acknowledgement | **merged into 05-N07** (sign-off request after the shift is already closed, 05 §3.11, Q-2) and 05-S04 `ShiftVariancePending` |
| 05-D09 | Skip blind count | **merged into 05-S04** (`ShiftSkip`, `skip-blind-count`, 05 §6.18) |
| 05-S10 | Close day (checklist) | **kept as 05-S05** — refusal lists one blocker at a time (05 §3.13, §6.25; owner 2026-11-19) |
| 05-D10 | Close with open orders — override | **merged into 05-S05** as **Carry over** (`CarryOverOrders`, 05 §6.24); no override |
| 05-S11 | Z report (view, print, PDF / CSV) | **kept as 05-S06** (view + print); **PDF / CSV dropped** (no API; owner 2026-11-19) |
| 05-D11 | Reopen day | **dropped** — no business-day reopen (05 §1.3, Q11) |
| 05-D12 | Takeover with an open shift | **dropped as a dialog** — a takeover on a drawer kiosk needs no step: the drawer shift stays open and payments land in it by `taken_by` (05 §3.11, Q10); shown on 05-S04 takings "by" |
| 05-S12 | Payment modes (owner) | **out of scope** — owner Billing settings page (PL-12, D-3) |
| 05-S13 | Tax rules (owner) | **out of scope** — jurisdiction catalog (read-only to owners) + owner Billing settings page (05 row A-1; PL-12, D-3) |
| 05-S14 | Receipt template editor | **out of scope** — owner Billing settings page with `renderText` preview (05 §8 Owner app; PL-12, D-3) |
| 05-S15 | Billing settings | **out of scope** — owner Billing settings page (PL-12, D-3) |
| 05-S16 | Share bill by QR (printer offline) | **dropped** — no share API (owner 2026-11-19); a failed print uses **Print to** (05-C02, B18) |
| 05-S17 | Open day | **out of scope** — `OpenBusinessDay` stays on `/admin/stock` (05 row A-5) |
| 05-B01 | Bill can't close | **kept as 05-S02 `BillCloseBlocked`** (server `blocks`, 05 §6.1, §3.3) |
| 05-B02 | Online payments unavailable — no internet | **dropped** — every mode is always available on the LAN (05 B10, K-7); only "Needs the hub" when the hub is down |
| 05-B03 | Shift not open | **kept as a state of 05-S02 / 05-S03** (`SHIFT_NOT_OPEN no_shift`, §3.2.12) |
| 05-P01 | Bill (printed before payment) | **out of scope** — check bill doc builder (05 B17, `docs.ts`); the screen shows its print status (05-C02) |
| 05-P02 | Receipt | **out of scope** — receipt builder (05 B21, B29); print status only |
| 05-P03 | Z report print | **out of scope** — report builder (05 B26); 05-S06 shows the Z on screen |
| 05-P04 | Shift close slip | **dropped** — not in 05 §3.16's document list |

---

## 3. Per screen

Field-by-field data uses the wire names so the builder can map them. Do not show the wire names to users. "Result" = the command's response body (05 §6.n); every money result carries recomputed totals, so the screen never computes its own (05 §6 header, §8).

### 3.1 Cashier screen (05-S01)

#### 3.1.1 05-S01 Open bills

**Purpose.** Every bill that still needs money, in one list: tables that asked for the bill, open tables, takeaway and parking orders. The cashier picks one and opens the bill screen. (05 §6.2, §8 "Cashier screen".)

**Entry.** Staff nav tab **"Bills"**, shown with `take-payment` (R5). On the cashier kiosk it is the home screen after sign-in for `take-payment` holders; 02b's Open orders stays a tab beside it (owner 2026-11-19, §7 Q-1). Optional floor filter = the query's `floor_id` (05 §6.2): only floors the API knows; spec silent on the control → designer choice (a segmented floor switch, or none when the branch has one floor).

**Data (`GET /queries/open-bills?floor_id?`, 05 §6.2):**

| Field | Shown as | Example |
|---|---|---|
| `identifier` | row title, large | "T7", "T4 + T5", "#12", "#12 18 Nov", "PARKING ABC 123 SEDAN", "Family 2" |
| `order_type` | small icon + word (Dine-in / Takeaway / Parking) | "Dine-in" |
| `total_default_minor` | amount, right | "Rs 6,624.00" — the total if paid in cash (the default class, 05 §3.1). Label it so: "if cash". It is **before pending voids** (05 §6.2): when the bill has one, the bill screen may differ; no note is needed on the row (spec silent; §7 Q-2) |
| `paid_minor` | "Paid Rs 3,000.00" under the total, only when > 0 | — |
| `partly_paid` | badge **Partly paid** (info) | — |
| `check_printed_at` | badge **Check bill printed** + 12-hour time ("1:32 PM") | ordering: newest check bill first (the server orders the list, 05 §6.2) |
| `opened_at`, `open_minutes` | "Open 46 min" | — |
| `flagged` (`open_minutes > open_bill_flag_minutes`, default 240) | badge **Open too long** (warn, icon + word) | "Open too long · 4 h 12 min" |
| `has_open_request` | badge **Waiting for approval** (info) | a discount / reopen / waiver request on it |
| `state` | not shown as a word on the row except via the badges above (spec silent → designer choice) | — |
| `bill_id` null (projected bill) | no difference on screen | — |

The list is returned whole (≤ 300 rows) and **in server order** (`check_printed_at` desc nulls last, then `opened_at`, 05 §6.2). Do not draw sort or search controls (no API).

**Fiscal status line (05 §8 Reports, §6.27)** — only when `adapter_key` is not `none`. A strip at the top or bottom of the list (designer choice):

| `GET /queries/fiscal-status` | Shown as |
|---|---|
| `pending_count` 0, `rejected_count` 0, `adapter_health: 'ok'` | ok icon + "Fiscal: all sent" (+ `last_success_at` "last 1:38 PM") |
| `pending_count` > 0 | info icon + "Fiscal: 3 waiting · oldest 12 min" (`oldest_pending_age_ms`) |
| `stuck: true` | warn icon + "Fiscal: 3 waiting · oldest 2 h 05 min — tell a manager" |
| `rejected_count` > 0 | danger icon + "Fiscal: 1 not accepted — tell a manager" |
| `token_missing` not empty | danger icon + "Fiscal: not set up on this hub — tell the owner" (never a token, never a `pos_id` value on staff screens) |
| `adapter_health: 'failing'` / `'unknown'` | warn / neutral word: "Fiscal: can't reach the authority" / "Fiscal: not checked yet" |

The line has **no action** for a cashier (`RetryFiscalNow` is `close-business-day`, 05 §6.28; it lives on the X report, §3.11). It needs `take-payment` or `view-reports` (05 §6.27).

**Refresh (05 §8):** on focus, on `event` frames of the bill / order / table streams, and on reconnect. **No sound, no push, no banner for a bill request** (Q13). A row may appear or move while the cashier looks; spec silent on motion → designer choice (no animation needed).

**States:**

| State | What shows |
|---|---|
| Normal (`OpenBills`) | Lunch rush, 14 rows: T7 "Check bill printed 1:32 PM", T4 + T5 "Partly paid · Paid Rs 1,500.00", #12, PARKING ABC 123 SEDAN, Family 2 "Waiting for approval", T2 "Open too long". Fiscal line "Fiscal: 3 waiting · oldest 12 min". |
| Empty (`OpenBillsEmpty`) | 01d `.empty`: "No open bills" (spec silent → designer copy). |
| First load | 01d `.sk` skeleton rows (draw inside `OpenBillsEmpty` as a note; no separate frame). |
| Fiscal line states (`OpenBillsFiscal`) | All six rows of the table above, stacked as a component frame. |
| Hub down (`OpenBillsOffline`) | 02 hub-offline bar; the last list stays with "as of 1:38 PM"; rows still open the bill screen read-only (every action "Needs the hub"). |
| Tablet (`OpenBillsTablet`) | Same list, 1280 wide. |
| Urdu (`OpenBillsUrdu`) | Main state RTL; identifiers, amounts, times LTR. |

**Actions:** tap a row → 05-S02 for that bill (by `bill_id`, else `seating_id`, else `order_id`, the `bill_ref` rule, 05 §6 header). Shift strip: spec silent → designer choice: a small header block on this screen showing "Sana · shift since 11:00 AM" with **My shift** (05-S04), **Petty cash** (05-D08) and **Open drawer** (05-D09) by permission (§7 Q-1). **Never show any cash expected figure here** (blind rule, 05 B23).

### 3.2 Bill screen (05-S02) and its parts

#### 3.2.1 05-S02 Bill screen

**Purpose.** One bill: its lines, the server's totals, the payment pad, splits, the bill sheets, close, print status. (05 §3.2–§3.7, §6.1, §8 "Bill screen".)

**Entry.** From 05-S01; from the 02 table sheet's **Bill** action (05-X02); from 02b's order view of a takeaway / parking order (spec silent → designer choice of the button; it opens the same screen). A person with `take-order` and no `take-payment` gets the **read-only** view (`BillReadOnly`, §3.2.13).

**Layout (spec silent on arrangement → designer choice, within these rules):** on the kiosk, lines on the left, totals + pad on the right; the Close button is the single primary on the screen layer. Header: `identifier`, order type, the splits strip (when more than one split), the bill's menu (Print check bill, Split, Discount, Reopen; by permission and state). The pad never covers the totals.

**Data (`GET /queries/bill?seating_id|order_id|bill_id`, 05 §6.1):**

| Field | Shown as |
|---|---|
| `identifier`, `order_type`, `scope` | header ("T7 · Dine-in") |
| `state` (`OPEN` / `PARTLY_PAID` / `CLOSED`) and `reopen_count` (int ≥ 0) | header chip with icon + word: Open / Partly paid / Closed; **"Reopened" while `reopen_count ≥ 1` and the bill is not CLOSED** (05 v1.0.6 §6.1, §8; R-29, Q-18) |
| `lines[]` `{ order_item_id, name, options, units, base_minor, tags, added_after_close }` | 05-C04 rows (§3.2.3); `added_after_close` drives the **New** mark (05 v1.0.6 §6.1; R-29, Q-4) |
| `service_charge: { rate_bp, removed }` | 05-C03 service charge row (§3.2.4); hidden when `rate_bp` is 0 and not removed |
| `discount` | 05-C03 discount row; reason word (owner label, never the code) |
| `splits[]` `{ split_no, state, plan, payments[], totals: { cash, digital, as_paid }, balance_minor, invoice }` | the splits strip and each split's totals and payments |
| `totals_default` | the bill total at the default class (cash) when no split exists or for the whole-bill line |
| `buyer: { required, threshold_minor, waived }` | buyer row (§3.5.3) |
| `blocks[]` `{ reason, split_no, details }` (05 v1.0.6 §6.1; R-29, Q-5) | the Close button's reason lines, one copy key per pinned `reason`, filled from `details` (§3.2.8) |
| `open_requests[]` `{ kind, alert_id }` | the waiting cards in the sheets (§3.5) |
| `prints[]` `{ job_id, doc_kind, state, printer_name, last_error }` | 05-C02 (§3.4); `printer_name` comes from 03c `documentJobsStatus` (05 v1.0.6 R-35) |
| `check_printed_at` | "Check bill printed 1:32 PM" in the header |
| `currency: { code, exponent }` | every amount's format |
| `prices_include_tax` | one small line under the totals: "Prices include tax" / no line when exclusive (spec silent on the wording → designer copy; §6.2) |
| `as_of_seq` | not shown |

**Payments list per split** (05 §6.1 `payments[]`): mode name, direction (**In** / **Back** for an `out`), `amount_minor`, for cash `tendered_minor` + `change_minor` ("Tendered 7,000.00 · Change 376.00"), `taken_by_name`, a reference shown as "Ref ••…" only to `take-payment` holders whose scope covers the bill (05 §6.1; everyone else sees "Has reference"). Each payment has **Remove** (05-D07) while its split is open.

**States (each a frame):**

| Frame | State |
|---|---|
| `Bill` | Table 7 unpaid; one split; no payments; dues side by side "Cash Rs 6,624.00 · Card Rs 5,996.00"; pad idle; Close disabled with "Take Rs 6,624.00 in cash or Rs 5,996.00 by card" (the balance reason, §3.2.8). |
| `BillPadCard` | Card chosen on the pad: amount pre-set to the card due 5,996.00 (the server's due for that class, 05 §3.5 (7), M-7) — "Total by card Rs 5,996.00 · tax 5 % · rounding +0.50". |
| `BillPadCash` | Cash chosen: "Total in cash Rs 6,624.00"; **tendered field empty** (never pre-filled, M-6); Sana types 7,000; **no change is shown while typing**; after **Add payment** the pad shows "Change due Rs 376.00" from the `AddPayment` result `change_due_minor` (server only, no client arithmetic; §7 Q-3 Decided). |
| `BillMixed` | Card 3,000.00 taken; payments list shows it; dues now "Cash Rs 3,624.00 · Card Rs 2,996.00" (whatever the server returns; the card due after one digital payment is at the digital rate while no cash `in` exists, 05 §3.5 (7)); note "Any cash makes the whole bill cash rate" (05 B6; copy §6.2). |
| `BillReadyToClose` | Balance 0; both payment dues hidden (05 §3.5 (7): dues are 0 while balance ≤ 0); Close enabled, primary. |
| `BillCloseBlocked` | Lines with PENDING VOID (Raita, Ali's request) and WEIGHT NEEDED (Fish 1 kg); Close disabled with the `blocks` text as a list (§3.2.8). |
| `BillBuyerRequired` | Family 2, net 52,400.00 > 50,000: buyer row "Buyer details needed above Rs 50,000.00"; Close disabled; Add buyer (05-D04). |
| `BillTotalChanged` | `BILL_TOTAL_CHANGED` after Close: banner "The total changed to Rs 6,684.00 — check it and close again"; the screen has refreshed; **never auto-closes** (05 §8). |
| `BillPartlyPaid` | T4 + T5 in 2 item splits: split 1 **Closed** (locked, invoice AC1-S000124, lock icon), split 2 open with a "new" line (2 × Naan added after the close); Discount hidden (05 §8); a void attempt on a locked line shows "Reopen the bill to change a paid split" (`LINE_IN_CLOSED_SPLIT`). |
| `BillRefund` | Table 7 reopened, 2 soft drinks removed: balance −325.00 → only "Refund cash Rs 325.00" (card refund hidden: card paid 0, 05 §8); the pad offers Cash **back** only. |
| `BillClosed` | After Close: "Closed · Invoice AC1-S000123 · Rs 5,996.00"; receipt print status (05-C02) "Printed on Counter"; fiscal "Fiscal number pending" (`fiscal_state: 'pending'`, 05 §6.12 result); actions: Reprint receipt (`PrintBillDocument`), Reopen (05-D05), Done. Change shown big when > 0 ("Give change Rs 376.00"). |
| `BillOffline` | Hub down: last view kept with "as of 1:38 PM"; pad, Close and every sheet "Needs the hub". |
| `BillErrors` | Component: the inline `.msg` for every code of §3.2.12. |
| `BillReadOnly` (T) | `take-order` only: lines, `totals_default` "Total if paid in cash Rs 6,624.00", "By card Rs 5,996.00"; **Print check bill**; no pad, no Close, no sheets. |
| `BillTablet` (T), `BillPortrait` (TP), `BillPhone` (P) | Main state at each size. Phone: Hamza at Table 9 (own table), lines collapse to a count with "Show lines"; pad below; Close pinned. |
| `BillUrdu` (K) | Main state RTL. |

**Permissions:** viewing needs `take-payment` (scope `own_tables` → the caller holds the table / placed the order; `my_floors` → the table's floor) or `take-order` (read-only) (05 §6.1). Outside scope → `PERMISSION_DENIED outside_scope` → full-screen `.msg` "This bill is not one of your tables" (§6). Sheets show by their own permissions (§2.1).

**Offline:** every 05 action needs the hub (no queue, 05 §6 header): show 02's "Needs the hub" on each action; reads keep the last data.

#### 3.2.2 05-C03 Totals block

From `splits[n].totals.<class>` / `totals_default` (`Totals` = `{ subtotal_minor, discount_minor, service_charge_minor, taxes[], rounding_minor, total_minor }`, 05 §6.1):

| Row | Rule |
|---|---|
| Subtotal | `subtotal_minor` |
| Discount | `discount_minor` with the reason label; only when a discount exists |
| Service charge {rate} | `service_charge_minor`, rate from `service_charge.rate_bp` ("5 %"); **Remove** / **Add back** on the row (§3.5.2) |
| Tax rows | one row per `taxes[]` entry: `label` + rate ("Punjab sales tax on services 16 %") + `tax_minor`. No tax buttons, ever (05 §8, G1-15). Tax label is jurisdiction data; draw it as given. |
| **Rounding adjustment** | `rounding_minor`, **its own row, apart from the tax rows** (05 §8, §3.5 (7)); hidden when 0 (as the receipt, AD-30); sign shown ("+0.40", "−0.24") |
| **Total** | `total_minor`, the largest number on the screen |
| Dues | "Cash Rs 6,624.00 · Card Rs 5,996.00" side by side from the latest `AddPayment` result or the view's per-class totals (05 §8, §3.5 (7)). Under `applies_to: 'cash'` the cash due is already rounded down to the coin step (server). While balance ≤ 0 both are hidden. |
| Refund dues | when balance < 0: "Refund card Rs x / cash Rs y"; a type with 0 is hidden (05 §8) |
| Paid / balance | "Paid Rs 3,000.00 · Left Rs 3,624.00" from `balance_minor` (05 §6.1) |

The dues pair is the reason the cashier asks "cash or card?". Draw it so the two numbers compare at a glance.

#### 3.2.3 05-C04 Line row

From `lines[]` (05 §6.1): `units` × `name`, `options` beneath (02b style), `base_minor` right. Tags (`tags[]`), each icon + word (02b / 04 patterns):

| Tag | Look | Rule |
|---|---|---|
| `comp` | 02b **COMP** tag; base 0.00 | **Remove comp** on the line menu for `remove-comp` holders (05-D06), only while the order is not billed (05 §6.14) |
| `pending_void` | 04 **PENDING VOID** tag, price struck; the line is out of the totals; Close blocked | from 04 `pendingVoids` (05 §3.1 line base) |
| `weight_needed` | **WEIGHT NEEDED** (warn); base 0.00; Close blocked | 04 R-4; weight is entered in 02b's order view |
| `tax_unresolved` | **Tax not set** (danger); Close blocked; text "Ask the owner to set the tax for this item" | 05 §3.3 3a, §3.4 |
| new (later line in the open remainder) | small **New** tag on a line of an **open** split when `lines[].added_after_close` is `true` (05 v1.0.6 §6.1, §8; R-29) | the server's flag only; never on a line of a closed split |
| in a closed split | lock icon, no line actions | 05 B15 |

No line price editing, no line discount (05 §1.3).

#### 3.2.4 Splits strip

When `splits.length > 1`: one tab per `split_no` ("Split 1 · Closed · AC1-S000124", "Split 2 · Rs 2,998.00 by card / 3,312.00 cash"). The pad and Close act on the selected open split (`AddPayment.split_no`, `CloseSplit.split_no`). **Split** opens 05-D01.

#### 3.2.5 05-C01 Payment pad

**Data:** payment modes from the branch config snapshot (`GET /queries/branch-config` → `snapshot.billing.payment_modes`: `mode_id`, name, kind, `payment_class`, `reference_required`, active; 05 row A-1, F §6.23). Every active mode is a button; **all are always shown** (05 B10, K-7). Order = the owner's order in settings.

**Flow:**
1. Tap a mode → the pad shows "**Total by card Rs 5,996.00**" / "**Total in cash Rs 6,624.00**" — the due of that mode's class before taking it (05 §8, M-7). The amount field is pre-set to that due; the cashier may type less (a part payment).
2. Cash only: **Tendered** field, empty (never pre-filled with the total, M-6); quick keys spec silent → designer choice (e.g. 5,000 / 10,000 / exact) as long as nothing is pre-filled.
3. Mode with `reference_required`: a **Reference** field (1–60 chars) before Add; never shown back except to `take-payment` holders as described in §3.2.1.
4. **Add payment** → `AddPayment { bill_ref, split_no, mode_id, direction: 'in', amount_minor, tendered_minor?, reference? }`. The result's dues, rounding and `change_due_minor` replace the screen's numbers (05 §6.9 result).
5. Refund (balance < 0): the pad shows only modes of the types with a refund due, labelled **Give back**, amount pre-set to that type's refund due; `direction: 'out'`; a card / online give-back takes a reference ("Reversal ref"), per the mode's `reference_required`.

**The pad never computes tax, rounding or change** (05 §8). No client arithmetic at all: typed digits are echoed as typed, and no figure is derived from them (no change preview, §7 Q-3; no running sums, §3.8). Change due appears only from the `AddPayment` result.

#### 3.2.6 Close

**Close** (one primary) → `CloseSplit { bill_ref, split_no, expected_total_minor = the total the screen shows, buyer? }` (05 §6.12). Result → `BillClosed` frame: invoice ref, total, change, receipt print status, `fiscal_state` ('pending' → "Fiscal number pending"; 'not_required' → no fiscal line). When the last split closes, the bill state is CLOSED and the table goes To clean (02a; 05-X01).

A zero-total split (everything comped, or a 0 cash total under cash rounding) closes with no payment (05 §6.12, §3.5 (7)): Close is enabled with balance 0 and no payment list. A reopened bill whose orders are all cancelled and every split's balance 0 closes **empty** (`{ bill_state: 'closed', empty: true }`, 05 §6.12 step 3): "Closed · nothing billed · money given back" (copy §6.2).

#### 3.2.7 Print check bill

**Print check bill** in the bill menu (`take-order`, 05 §6.3) → `PrintCheckBill { bill_ref }`. Result `{ job_id, printer_name, totals_default }` → toast "Check bill sent to Counter" and 05-C02 shows its status. `printed: false` (no printer) → "No bill printer is set up — show the screen to the customer" (05 §3.16). Not allowed on a CLOSED bill (`BILL_NOT_OPEN`).

#### 3.2.8 Close blocked text (`blocks[]`)

The Close button stays visible, **disabled, with the server's reasons listed under it** (05 §8). One line per `blocks[]` entry, in the server's order (§3.3 rule order, then `split_no`). ⚠️ Changed for 05 v1.0.6 (R-29, Q-5): each entry is `{ reason, split_no, details }` with one **pinned** `reason` per §3.3 rule; `details` is exactly the §9 error's details. One copy key per reason:

| `reason` (05 §6.1) | `split_no` | `details` | Line (`billing.blocks.<reason>`) |
|---|---|---|---|
| `bill_not_open` | `null` | `{ bill_id, state }` | "This bill is already closed" (refresh) |
| `void_pending` | `null` | `{ reason, order_item_ids }` | "{n} item(s) waiting for void approval: {items}" — names from `lines[]` by `order_item_id` |
| `weight_pending` | the split | `{ reason, order_item_ids }` | "{n} item(s) need a weight: {items}" |
| `tax_unresolved` | the split | `{ reason, order_item_ids }` (may hold `'service_charge'`, R-1) | "Tax is not set for {items} — ask the owner" / "Tax is not set for the service charge — ask the owner" |
| `discount_pending` | `null` | `{ alert_id }` | "A discount is waiting for approval" |
| `buyer_id_required` | `null` | `{ threshold_minor, net_minor, accepted_types }` | "Buyer details needed above {threshold}" + **Add buyer** |
| `balance_due` | the split | `{ split_no, balance_minor }` | "Take {cash} in cash or {card} by card" — the two dues of that split from the view (§3.2.2), never computed |
| `shares_sum` | the last open split | `{ reason: 'shares_sum' }` | "Split amounts no longer add up — edit the split" + **Edit split** |

Rules 5, 7 and 9 never appear in `blocks` (05 §6.1). With more than one open split, a split rule's line names its split ("Split 2: …"). Each line's text comes from §6.

#### 3.2.9 Partly paid and locked splits

05 §3.2, §3.8, §8: closed splits show as locked with their invoice (`splits[n].invoice.invoice_ref`, fiscal state); the discount sheet is hidden once a split is closed (`BILL_PARTLY_PAID` would refuse it); lines added later join the open remainder with a **New** tag; a void / comp / remove / weight on a locked unit is refused `LINE_IN_CLOSED_SPLIT` → "Reopen the bill to change a paid split" (05 §8) with **Reopen** for `reopen-bill` holders.

#### 3.2.10 Reopened bill

After 05-D05 succeeds: state Open, a "Reopened" chip, mode word from the result (`full` → "Full edit: add, remove or change items"; `corrections` → "Corrections only: remove, void or comp; new items go on a new bill") (05 §3.10, §6.13 result). Payments carried over stay on their splits; balance may go negative → `BillRefund`.

#### 3.2.11 Buyer row

When `buyer.required` (whole bill net > `threshold_minor`, 05 §3.3 (6), B19): a row "Buyer details needed above Rs 50,000.00" with **Add buyer** (05-D04). After a buyer is entered for this close: "Buyer added" (never the ID, never the name back from the server — the server never returns them; the client holds them only until `CloseSplit` is sent, then clears them, plan task 37, owner 2026-11-19). `buyer.waived` → "Customer refused buyer details (approved)". Not required → no row.

#### 3.2.12 Bill errors (`BillErrors`, inline `.msg`, keys `errors.<code>`)

| Code (05 §9) | When on this screen | Shown as |
|---|---|---|
| `BILL_NOT_FOUND` | stale link | full-screen `.msg` + back to Bills |
| `BILL_NOT_OPEN` | any command on a closed / absorbed / cancelled bill | `.msg` "This bill is already closed" (state `cancelled`: "This order was cancelled"); refresh |
| `BILL_CLOSE_BLOCKED` | Close raced a block | reasons as §3.2.8 (`void_pending` / `weight_pending` / `tax_unresolved` with item names) |
| `DISCOUNT_PENDING` | Close or second discount while one is waiting | "A discount is waiting for approval" |
| `BUYER_ID_REQUIRED` | Close without buyer | opens 05-D04 with the threshold from `details.threshold_minor` |
| `BILL_TOTAL_CHANGED` | Close with a stale total | `BillTotalChanged` (refresh, show `details.total_minor`, never auto-close) |
| `BILL_BALANCE_DUE` | Close with money left | "Rs {balance} still to take on split {n}" |
| `BILL_SPLIT_INVALID` `shares_sum` | Close on a stale amount plan | "Split amounts no longer add up — edit the split" |
| `PAYMENT_MODE_NOT_FOUND` | mode archived meanwhile | "This payment type was removed — pick another" (refresh config) |
| `PAYMENT_MODE_NOT_FISCAL` | fiscalized bill, mode without authority code (at Add or at Close) | "{mode} can't be used for a tax invoice here — use another, or remove it and take it again" |
| `PAYMENT_EXCEEDS_BALANCE` | amount above the due / refund above what that type paid / any `in` on a paid split | "That is more than {due} — the most you can take by {mode} is Rs {details.balance_minor}"; for 0: "Nothing left to pay on this split" / "Nothing to give back by {type}" |
| `PAYMENT_REFERENCE_REQUIRED` | reference missing | field error "Enter the reference" |
| `PAYMENT_CASH_STEP` | cash amount off the coin step (`applies_to: 'cash'`) | "Cash must be in steps of Rs {details.step_minor}" |
| `PAYMENT_NOT_FOUND` | remove of a removed payment | "Already removed" (refresh) |
| `SHIFT_NOT_OPEN` `no_shift` | Add payment with no money shift | "Open your shift to take money" + **Open shift** (05-S03) |
| `SHIFT_NOT_OPEN` `payment_shift_closed` | Remove of a payment whose shift is counted | 05-D07 `RemovePaymentShiftClosed` |
| `BILL_HAS_PAYMENTS` | split re-plan dropping a paid split | in 05-D01 (§3.3) |
| `LINE_IN_CLOSED_SPLIT` | a line change on a locked unit (from 02b / 04 screens and Remove comp) | "Reopen the bill to change a paid split" |
| `TABLE_NOT_OPEN` | bill of a seating that is not open | "This table is no longer open" |
| `ORDER_BILLED` | Remove comp on a billed line | "Already billed — reopen the bill to change it" |
| `PERMISSION_DENIED` `outside_scope` / `not_own_payment` | not your table / someone else's payment | "This bill is not one of your tables" / "Only a manager can remove someone else's payment" |
| `VALIDATION_FAILED` | buyer ID pattern, reference length | field error (buyer: "Check the ID number" — never echo the value) |
| network / hub down | any | "Needs the hub" |

### 3.3 Split editor (05-D01)

**Purpose.** Re-plan how the **open remainder** is paid: by items, by amount, or equally. (05 §3.8, §6.5, §8.)

**Entry.** **Split** on the bill screen (`take-payment`). Kiosk: a large sheet over the bill (designer choice); portrait: bottom sheet (`SplitPortrait`).

**Modes (05 §6.5):** a three-way switch **Items / Amount / Equal**, and **One bill** (`mode: 'none'`, only when at most one open split has payments).

- **Items** (`SplitItems`): columns per split ("Split 1", "Split 2", "+ Add split", 2–20), each line placed by units ("2 of 6 Naan"); **every live unit not in a closed split exactly once** — the sheet shows "{n} items not placed" until it is 0; a deal moves whole; an option goes with its parent (05 §3.8). Draw Table 7 into 2: split 1 Karahi + 3 Naan + 1 Raita; split 2 the rest.
- **Amount** (`SplitAmount`): one amount per split in minor units of the open remainder's **default-class (cash) total**, ≥ 1 each, sum = that total ("Rs 6,624.00 to share · Rs 0.00 left"). The server re-bases the last open share on every change (05 §3.8): after Save the shares shown are the server's.
- **Equal** (`SplitEqual`): `n` 2–20 stepper over the open remainder; each split's dues come back from the server (sample: 2 × "cash 3,312.00 / card 2,998.00").

**Locked** (`SplitLocked`): closed splits are shown first, locked with their invoice ref, not editable and not selectable (`split_closed`); after the first close the open remainder's mode may change, the closed splits keep theirs (05 §3.8). A split with payments keeps its number: it cannot be removed (`BILL_HAS_PAYMENTS { split_nos }` → "Split {n} has a payment — remove the payment first or keep the split"). Lines added later show **New**.

**Save** → `SetSplits`; the result is the recomputed `splits` (05 §6.5). **Errors** (`SplitInvalid`, `BILL_SPLIT_INVALID` reasons, keys `errors.BILL_SPLIT_INVALID.<reason>`): `units_missing` "Every item must be in a split — {item} is not", `units_exceed` "{item} is placed more than once", `deal_whole` "A deal moves as a whole", `option_with_parent` "Options go with their item", `shares_sum` "Amounts must add up to Rs {expected}", `split_closed` "A paid split can't be changed". No customer names on splits (no field in the API).

### 3.4 Print status and Print to (05-C02)

**Data:** `prints[]` of the bill view `{ job_id, doc_kind, state, printer_name, last_error }` (05 §6.1; 03c `documentJobsStatus`). `doc_kind`: check bill, receipt, credit note.

| `state` | Shown as |
|---|---|
| waiting | info icon + "Printing on {printer_name}…" (`printer_name` from the bill view's `prints[]`, 05 v1.0.6 R-35) |
| printed | ok icon + "Printed on {printer_name}" |
| failed | danger icon + "Didn't print on {printer_name}" + `last_error` as a word from 03c's list (`printers.error.*`: "Can't reach the printer", "Out of paper", …; never raw) |
| no printer | "No bill printer set up" (05 §3.16: the command still succeeds) |

**Print to** (05 §8, B18): shown on **failed**, or when **waiting more than 10 s** (client timer from when the status first showed waiting; spec §8). A picker lists the active printers by **name** from **`GET /queries/bill-printers` → `{ printers: [{ printer_id, name }] }`** (sorted by name, read when the picker opens; `take-order`, any grant) **— 05 v1.0.5 §6.23a (G-28, R-27)**; the job's current printer is the one whose `name` equals the status row's `printer_name`, marked; picking one sends `RetargetBillPrint { job_id, printer_id }` → the job's new status. Errors: `PRINT_JOB_NOT_PENDING` "Already printed or cancelled" (refresh), `PRINTER_NOT_FOUND` "This printer was removed — pick another", `PRINT_JOB_NOT_FOUND` "This print is no longer there". Nothing prints twice (B18). **Anyone who can retarget sees the picker:** the query and `RetargetBillPrint` both need `take-order` (any grant), so an order taker with the read-only bill (`BillReadOnly`) or on the phone gets the same picker as the cashier (R-27; §7 Q-7). There is no state without the picker.

Frames: `PrintStatus` (component: three states for each doc kind, the 10 s waiting with Print to), `PrintTo` (K, picker open over `BillClosed`: "Counter" failed "Out of paper" → pick "First floor bill"), `PrintToPhone` (P, Hamza's check bill for Table 9 failed on "First floor bill" → the picker as a bottom sheet → pick "Counter").

Reprints: **Reprint receipt** / **Reprint credit note** on a closed split (`PrintBillDocument { doc, ref_id }`, `take-payment`, 05 §6.22) → the same status row. The printed text is fixed by the builder ("REPRINT", fiscal number or "FISCAL NUMBER PENDING" / "FISCAL NUMBER NOT ISSUED", 05 §6.22, R-11); not drawn here. `INVOICE_NOT_FOUND` → "This invoice can't be found".

### 3.5 Bill sheets

All sheets: 04's `.dlg--v` look (centred on kiosk / tablet, bottom sheet on portrait and phone). One primary button that names the missing step until the form is complete (04 pattern: "Pick a reason" → "Write why first" → the action). **Reason `other` always needs a note ≤ 200 characters** (05 §4.4). An approvable action held as `requires_approval` ends in **Ask for approval** with the Needs-approval tag; held `allowed` ends in the action word. The result decides what shows: `{ pending: { alert_id } }` → the **waiting card** in the sheet's place (01d requester card, §4.2); else the applied result. The bill view's `open_requests[]` keeps the waiting card visible after a refresh.

#### 3.5.1 05-D02 Discount

**Entry:** bill menu **Discount** (`apply-discount`), only while the bill is OPEN with **no closed split** (hidden once a split is closed, 05 §8, B7; the whole bill only).

**Form:** **Amount** or **Percent** switch; value (amount in minor units ≥ 1; percent in basis points 1–10 000 shown as "10 %", decimals allowed to 0.01 %); **reason buttons from settings** (`snapshot.billing.discount_reasons`, owner labels, 05 B7, R-3); note (required for `other`). A preview line "Discount Rs 571.00" is **not** computed on the screen: the amount shows after the server answers (spec silent on a preview; §7 Q-8).

**Send:** `ApplyDiscount { bill_ref, kind, value, reason_code, note? }` → `{ applied: Totals }` (sheet closes, totals refresh, toast "Discount applied") or `{ pending: { alert_id } }` (`DiscountWaiting`: "Waiting for Imran or a manager · 10 % · Regular customer"; Close is blocked meanwhile by `DISCOUNT_PENDING`).

**Remove:** on the discount row, **Remove discount** (`apply-discount`, allowed or requires_approval both may remove; reason + note for other) → `RemoveDiscount`; `{ changed: false }` → nothing to do (refresh).

**Errors:** `DISCOUNT_TOO_LARGE { max_minor }` "The most you can give is Rs {max}"; `DISCOUNT_PENDING` "A discount is already waiting for approval"; `BILL_PARTLY_PAID` "A split is already paid — no discount now"; `BILL_NOT_OPEN`.

Frames: `Discount` (K, 10 %, Regular customer, needs approval → "Ask for approval"), `DiscountWaiting` (K), `DiscountPhone` (P).

#### 3.5.2 05-D03 Service charge

**Row:** "Service charge 5 % · Rs 150.00" with **Remove** (`remove-service-charge`); when removed: "Service charge removed" with **Add back** (`remove-service-charge` **allowed** only; the same right decides both ways, 05 §6.8). **Never re-added by anything else** (B8): no auto re-add after a split, merge, print or reopen; draw no such cue.

**Remove sheet** (`ServiceChargeRemove`): reason buttons `CHARGE_REMOVE_REASONS` (Customer asked · Service complaint · Staff meal · Other) + note → `RemoveServiceCharge` → applied (row shows "removed", totals refresh: T4 + T5 cash 3,480.00 / card 3,150.00) or pending (`ServiceChargeWaiting`). `{ changed: false }` → already removed (refresh). **Add back** → `ApplyServiceCharge { bill_ref, note? }`, no sheet needed beyond an inline confirm (spec silent on a confirm → designer choice; note optional).

#### 3.5.3 05-D04 Buyer

**Entry:** the buyer row (§3.2.11) or `BUYER_ID_REQUIRED` on Close.

**Form (05 §6.12, §8, J-4):** **Name** (1–60); **ID type** picker from the jurisdiction's accepted types (snapshot `billing.jurisdiction` buyer `accepted_types[].label`: "CNIC", "NTN" — jurisdiction data labels, shown as given); **ID number** (1–40, the type's `strip` characters allowed, e.g. dashes for CNIC). Field help from the type (spec silent → designer copy, e.g. "13 digits"). **Draw the value only as `00000-0000000-0`** (obviously fake). The value lives only in the field: it is sent with `CloseSplit.buyer`, then the form clears, and it is **never shown again** on any screen (05 §7 Privacy; plan task 37; owner 2026-11-19). After entry the row says "Buyer added — sent with Close" (no value, no last 4).

**Customer refuses** (`close-without-buyer-id`) → `WaiveBuyerId { bill_id, note? }` → `allowed`: row "Customer refused buyer details"; `requires_approval`: `BuyerWaiveWaiting`; `{ changed: false, reason: 'not_required' }` → "Not needed for this bill" (refresh). The waiver holds for every later split and survives a reopen (05 §6.11).

**Errors:** `VALIDATION_FAILED` on `payload.buyer.tax_id.value` / `.type` → "Check the ID number" / "Pick an ID type" (never echoes the value); `BUYER_ID_REQUIRED` again → keep the sheet.

Frames: `Buyer` (K, Family 2, CNIC, fake value), `BuyerWaiveWaiting` (K), `BuyerUrdu` (K).

#### 3.5.4 05-D05 Reopen bill

**Entry:** **Reopen** on a CLOSED or PARTLY_PAID bill (`reopen-bill`), from `BillClosed`, the bill header, or `LINE_IN_CLOSED_SPLIT`.

**Form:** reason buttons `BILL_REOPEN_REASONS` (Wrong item billed · Wrong payment type · Customer returned an item · Price error · Other) + note; a line saying what happens (05 §3.10): "Each paid split gets a credit note. Payments stay. Close again to issue new invoices." (copy §6.2).

**Send:** `ReopenBill` → `{ reopened: { mode, credits: [{ invoice_ref, total_minor }] } }` → `ReopenCorrections` / full edit result: "Reopened · Credit AC1-C000017 Rs 5,996.00" + the mode sentence (§3.2.10); or `{ pending }` → `ReopenWaiting`. The credit note prints by itself (05 §3.16) and shows in 05-C02.

**Errors:** `BILL_REOPEN_PENDING` "A reopen is already waiting for approval"; `BILL_REOPEN_NOT_SUPPORTED` (`ReopenNotSupported`) "This bill can't be reopened: its tax invoice can't be credited here — ask the owner" (05 §3.15; never for the Pakistan seed, but drawn for other jurisdictions); `BILL_NOT_OPEN { state }` "Only a closed or partly paid bill can be reopened".

#### 3.5.5 05-D06 Remove comp

**Entry:** line menu on a COMP line (`remove-comp`), order not billed. Usually from the order view (02b) or the bill screen line row; draw on a tablet bill (`RemoveComp`).

**Form:** units stepper "1 of 2" when the line has more comped units (`units?` ≤ `comped_units`); reason `COMP_REMOVE_REASONS` (Comped by mistake · Wrong line · Other) + note → `RemoveComp` → `{ removed: { units, comp_minor } }` ("Comp removed · Rs 450.00 back on the bill") or `{ pending }` (`RemoveCompWaiting`).

**Errors:** `ORDER_BILLED` "Already billed — reopen the bill to change it"; `LINE_NOT_COMPED` "This item is not comped" (refresh); `VOID_PENDING` "A void is waiting on this item"; `LINE_IN_CLOSED_SPLIT`.

#### 3.5.6 05-D07 Remove payment

**Entry:** **Remove** on a payment of an open split (`take-payment`; someone else's payment needs `close-shift-for-others` — hide Remove on others' payments for people without it, R5).

**Form:** reason `wrong_mode` / `wrong_amount` / `customer_changed` / `other` (Wrong payment type · Wrong amount · Customer changed their mind · Other) + note → `RemovePayment` → the payment leaves the list, dues refresh, toast "Payment removed". Not approvable.

**Shift closed** (`RemovePaymentShiftClosed`, `SHIFT_NOT_OPEN payment_shift_closed`): "This payment's shift is already counted — it can't be removed. Give the money back from your shift instead." (05 §6.10: money back = an `out` on today's shift, which the pad offers when the balance is negative). Other errors: `PAYMENT_NOT_FOUND`, `PERMISSION_DENIED not_own_payment`, `BILL_NOT_OPEN`.

### 3.6 Open shift (05-S03)

**Purpose.** Start my shift with a float before taking money. (05 §3.11, §6.15, B23.)

**Entry:** on sign-in, when `manage-own-shift` and no open shift (spec silent on the trigger → designer choice: the Bills screen shows a card "Open your shift to take money" with **Open shift**; the pad's `SHIFT_NOT_OPEN no_shift` links here). Also from the staff nav "My shift".

**Form:** **Starting cash (float)** amount, 0 allowed (0 … 10¹²); **Use this kiosk's cash drawer** switch (`as_drawer`), shown only on a device that can hold a drawer (a cashier kiosk, or a tablet with a printer route; the server refuses otherwise, `DRAWER_DEVICE_INVALID`). Default spec silent → designer choice (Rec: on for a cashier kiosk, off on a tablet / phone; §7 Q-9). **Open shift** → `OpenShift { float_minor, as_drawer }` → `{ shift_id, opened_at }` → toast "Shift open · drawer opened" (the drawer kicks when the float > 0, 05 §6.15).

**Errors (`ShiftOpenErrors`, component):** `DRAWER_IN_USE { staff_name }` "This drawer is in Usman's open shift — he must close it first, or open without the drawer"; `SHIFT_ALREADY_OPEN` "Your shift is already open" + **Go to my shift**; `DRAWER_DEVICE_INVALID` "This device can't hold a cash drawer"; `BUSINESS_DAY_NOT_OPEN` "The day isn't started — ask a manager to start it"; hub down "Needs the hub".

Frames: `ShiftOpen` (K, Sana, Rs 5,000.00, drawer on), `ShiftOpenErrors` (K), `ShiftOpenPhone` (P, Hamza, float 0, no drawer switch).

### 3.7 My shift and close (05-S04)

**Purpose.** See my shift, count and close it (blind), or skip the count, or count at a handover. (05 §3.11, §6.16–§6.19, §8 "Shift".)

**Data (`GET /queries/shift?shift_id?`, 05 §6.16):** `staff_name`, `state`, `is_drawer`, `opened_at`, `float_minor`, `takings[] { mode_name, payment_class, in_minor, out_minor, change_minor, by[] { taken_by_name, in_minor } }`, `petty[] { kind, amount_minor, category_name, paid_to, advance_staff_name, settled }`, `open_advances_minor`, `handovers[]`, and **`counted_minor`, `expected_minor`, `variance_minor` — all `null` until the count** (blind rule, server-enforced, 05 B23, §7 "Blind count").

**Order on the close screen (05 §8, the order is the rule):**
1. **Card / online takings first**: each digital mode with its total and count ("Card · 3 payments · Rs 18,420.00", "JazzCash · 2 · Rs 2,150.00") — to check against the terminal (story 7 AC5). On a drawer shift, "by" lists who took them (takeover, 05 §3.11).
2. **Cash line shows only the count of cash payments, never their sum** ("Cash · 14 payments") (05 §6.16).
3. Petty cash entries of the shift and **open advances** ("Ali · advance Rs 1,000.00 · open"), listed, never blocking (05 §3.11).
4. **Counted cash** amount field — **before any expected figure** (05 §8). No denominations (one `counted_minor`).
5. **Count and close** → `CountShift { shift_id, counted_minor, note? }` → result `{ closed: true, expected_minor, variance_minor, sign_off }` — the first time expected appears.

**Result (`ShiftCountResult`):** Expected / Counted / Variance with sign and word ("Short Rs 250.00" / "Over Rs 40.00" / "Exact"); tone: within threshold neutral / ok; over threshold warn. The shift is **closed and the drawer is free at once** (05 §6.17). `sign_off` not null → `ShiftVariancePending`: "Variance sent for sign-off (pending); the drawer is free" (05 §8 exact intent) — the shift does not wait. Open petty requests of the shift were closed as obsolete (05 §6.17) → one line "1 petty cash request was cancelled because the shift closed" (spec gives the list in the result; copy §6.6).

**Skip count (`ShiftSkip`)**, `skip-blind-count` only: **Close without counting** → inline confirm with optional note → `CloseShift { shift_id, skip_count: true, note? }` → "Shift closed without a count". Without the permission the action is absent. `PERMISSION_DENIED skip_not_granted` → "You can't skip the count".

**Handover (`ShiftHandover`, `ShiftHandoverResult`)**, drawer shifts only: **Count at handover** → counted amount → `HandoverCount { shift_id, counted_minor }` → result reveals expected and variance **of that count**; the shift stays OPEN (05 §6.19). The handover list shows past counts with their own expected.

**Another person's shift (`ShiftOther`, T)** — `close-shift-for-others`: from day close (§3.10) or a staff picker (spec silent on the picker → open question §7 Q-10). Same screen with "Usman's shift"; the blind count applies to the closer (05 §3.11).

**Errors:** `SHIFT_NOT_OPEN not_open` "This shift is already closed" (refresh); `SHIFT_NOT_FOUND`; `PERMISSION_DENIED { permission: 'close-shift-for-others' }` "Only a manager can see someone else's shift".

**Phone (`ShiftPhone`):** Hamza's own shift (no drawer): takings by mode, cash payment count, count field, Count and close.

Frames: `ShiftClose`, `ShiftCountResult`, `ShiftVariancePending`, `ShiftSkip`, `ShiftHandover`, `ShiftHandoverResult` (K), `ShiftOther` (T), `ShiftPhone` (P), `ShiftUrdu` (K, `ShiftClose` in Urdu).

### 3.8 Petty cash (05-D08)

**Purpose.** Cash out of / into my shift's drawer, and advances to staff, with categories. (05 §3.12, §6.20, B24.)

**Entry:** the shift strip / My shift (`record-petty-cash`).

**Form (`Petty`):** kind switch **Advance** / **Cash out** / **Cash in**; amount; **category** from `snapshot.billing.petty_categories` (owner labels; R-3); **Paid to** (text, optional; never shown in reports or alerts, 05 §7 Privacy); for Advance, **Staff member** (`advance_staff_id`, required; the picker's source is spec silent → §7 Q-12, Rec: the existing sign-in roster `GET /queries/staff-roster`); note.

**Button label:** **Record** when the grant is `allowed` and the amount ≤ `petty_cash_limit_minor` (snapshot `billing`); **Ask for approval** with the Needs-approval tag when the amount is over the limit or the grant is `requires_approval` (owner 2026-11-19). **The server decides**: whatever the label, a `{ pending }` result shows `PettyWaiting` ("Waiting for a manager · Cash out Rs 6,500.00 · Repairs"; approvers are holders of `close-shift-for-others`, 05 §3.14); an applied result → toast "Recorded · drawer opened" (drawer kick, 05 §6.20). On approval the drawer is not kicked automatically: the requester's next **Open drawer** does it (05 §6.20) — the result banner (01d N04) should say "Approved — open the drawer to take the cash" (copy §6.6).

**No check against the cash in the drawer** (H6-15: a refusal would let a cashier find the expected cash); draw no "not enough cash" state.

**Open advances (`PettyAdvances`):** list "Ali · Rs 1,000.00 · 2 h ago · Settle" (from the shift's `petty[]` with kind advance and `settled: false`; settling may happen on another shift). **Settle (`PettySettle`):** Spent + Returned, which must add up to the advance ("Rs 1,000.00 = spent 760.00 + returned 240.00"; **no running sum on the form** — the client adds nothing; the server checks and a mismatch answers `PETTY_SETTLE_MISMATCH { amount_minor }`, shown inline) → `SettlePettyAdvance { entry_id, spent_minor, returned_minor, note? }` (`record-petty-cash` allowed); the returned cash lands in the settler's shift.

**Errors:** `SHIFT_NOT_OPEN` "Open your shift first"; `CONFIG_REFERENCE_INVALID category_id` "This category was removed — pick another"; `… advance_staff_id` "Pick who takes the advance"; `PETTY_CASH_NOT_FOUND` "This advance can't be found"; `PETTY_ADVANCE_SETTLED` "Already settled"; `PETTY_SETTLE_MISMATCH { amount_minor }` "Spent and returned must add up to Rs {amount}".

Frames: `Petty` (cash out, Rs 600.00, Supplies → Record), `PettyAdvance` (advance to Ali Rs 1,000.00), `PettyWaiting` (Rs 6,500.00 over the Rs 5,000 limit → Ask for approval, then waiting), `PettyAdvances`, `PettySettle` (with the mismatch error inline), `PettyUrdu` (all K).

### 3.9 Open cash drawer (05-D09)

**Entry:** shift strip **Open drawer** (`open-cash-drawer`), only on a drawer device of an open shift. **Form:** reason `change_for_customer` / `check_cash` / `other` (Change for a customer · Check the cash · Other) + note → `OpenCashDrawer` → drawer opens (no-sale document), toast "Drawer opened". Error `SHIFT_NOT_OPEN no_drawer_shift` "This device has no open drawer shift". Frame: `Drawer` (K).

### 3.10 Day close (05-S05)

**Purpose.** Close the business day from the staff app; get the Z. (05 §3.13, §6.24, §6.25, row A-5.)

**Entry:** staff nav "Close day" (`close-business-day`; manager tablet or cashier kiosk). `/admin/stock` keeps its own Close day (row A-5; out of scope here).

**Flow (owner 2026-11-19: the guard list stops at the first blocker):** **Close day** → `CloseBusinessDay` (01a) → refused with `409 DAY_CLOSE_BLOCKED` and **one** reason, in guard order: 04 void requests, then 05 open shifts, then 05 unbilled orders. The screen shows **that reason's list**; the manager fixes it and taps **Close day** again; the next blocker (if any) appears. No pre-check list (no read gives all three at once).

| Frame | `reason` | List rows (from `details`) | Actions per row |
|---|---|---|---|
| `DayClose` | — | Start state: "Close the day for Gulberg · Thu 19 Nov"; one primary **Close day**; a short line of what happens (05 §3.13: open requests are cancelled, the Z prints) | — |
| `DayCloseVoids` | `void_pending` (04) | `voids[] { identifier, item, requester_name }`, "and {count − 40} more" (04 pattern) — "{count} void requests are still open — answer them first" | link to 01d Requests (existing screen) |
| `DayCloseShifts` | `shift_open` | `shifts[] { staff_name, opened_at, is_drawer }` + `count` — "{count} shifts are still open — close them first" | **Close this shift** → 05-S04 for that `shift_id` (`close-shift-for-others`; §7 Q-10) |
| `DayCloseUnbilled` | `unbilled_orders` | `orders[] { identifier, total_minor, placed_at, open_minutes }` + `count` — "{count} orders are not billed — bill them or carry them over" | tick rows → **Carry over** (`CarryOver`); open the bill (05-S02) |
| `CarryOver` | — | sheet: the ticked orders (1–40), reason `CARRY_OVER_REASONS` (Table still seated · Customer will pay later · Other) + note → `CarryOverOrders { order_ids, reason_code, note? }` → rows leave the list; "Carried to tomorrow" | — |
| `DayCloseDone` | success | "Day closed · Z 0043" and the Z shown on screen (§3.11 content). **The Z number and content come from `GET /queries/z-reports?business_date=<the closed date>`** read after the close succeeds (05 §6.26), never from the `CloseBusinessDay` result. The Z prints by itself (05 §6.25); **Print again** (`PrintReport { doc: 'z_report', ref_id }`) shows its status in 05-C02 | — |

A carried order may already have payments; the close is allowed and the Z shows them as carried forward (05 §6.24). A pending variance sign-off never blocks (05 §6.25); draw no such row. **Errors:** `ORDER_BILLED` on carry-over "Already billed — refresh"; 01a's own refusals as 01a's copy; hub down "Needs the hub".

Frames: `DayClose`, `DayCloseVoids`, `DayCloseShifts`, `DayCloseUnbilled`, `CarryOver`, `DayCloseDone` (T), `DayCloseKiosk` (K, `DayCloseShifts` at 1920), `DayCloseUrdu` (T).

### 3.11 Reports (05-S06)

**Entry:** staff nav "Reports" (`view-reports`). Two tabs: **Today (X)** and **Z reports**.

**X (`XReport`):** `GET /queries/x-report` — the open day so far, any time. **Z list (`ZList`):** `GET /queries/z-reports?cursor&limit` — rows "Z 0042 · Wed 18 Nov · net Rs 412,300.00" (cursor paging, newest first; a `business_date` lookup is the same query, spec silent on a date control → designer choice of a simple date jump or none). **One Z (`ZReport`).**

**Content (05 §6.26, B26; shape = `ReportDocInput` in `packages/domain/src/billing/docs.ts`, names resolved at render):** in this order (designer may group into cards):
- header: X or Z number, business date, issued time, currency;
- sales: invoices count, gross, discounts (count, value, by reason, who asked / approved / method), service charge, net, **tax by tax code, profile and payment class with rate**, **rounding as its own line**, total;
- credits (count, value, by reason) and **net after credits**;
- payments by mode (in, out, change); **brought forward** and **carried forward** by mode and person;
- comps (value, voided comps, comp removals); voids by disposition (wastage / staff meal / moved / none); reopens (count, value, who);
- petty cash by category and kind; open advances (who, amount, age);
- per shift: staff, float, expected, counted, variance, skipped, **sign-off state** (pending sign-off / approved / disputed); **variance sign-offs** recorded today; **pending sign-offs**;
- takings by taker; full refunds; fiscal (pending / accepted / not accepted / not required); bills count and average;
- X only: open bills with "open too long" flags; carried-over orders ("carried in" on the next Z).

**Print:** **Print** → `PrintReport { doc: 'x_report' | 'z_report', ref_id? }` → 05-C02 status. `Z_REPORT_NOT_FOUND` "This Z report can't be found". **Retry fiscal now** on the X fiscal section for `close-business-day` holders → `RetryFiscalNow` → "{pending_count} waiting — sending now" (05 §6.28; rejected rows are not resent, say so: "Not accepted invoices need a fix from support"). No export (owner 2026-11-19).

Frames: `XReport`, `ZList`, `ZReport` (K), `ReportsTablet` (T, X at 1280).

### 3.12 Table and order delta (05-X01, 05-X02)

Draw only the change on the 02a / 02b screens (02a hand-off `Tiles`, `TableSheet`).

| What | Where | Rule |
|---|---|---|
| Check bill printed | **tile: small printer mark** while `MapTile.check_printed_at` is set; table sheet: "Check bill printed 1:32 PM" | 02a v1.1.9 `table-map` `MapTile.check_printed_at` (05 v1.0.6 §6.4a, row T-4; R-30, Q-11 Decided) = max(05's check bill, 02a `bill_requested_at`); live refresh on `TableMarksChanged` |
| Bill closed → To clean | tile goes To clean grey (02a NEEDS_CLEANING on `BillClosed`) | 02a; no 05 visual beyond it |
| New order after close (before clean) | tile back to Ordered (02a fold); the new bill is separate | 05 §3.10 S-9 (b) |
| Reopened bill | tile keeps its 02a state (Ordered / Eating) with a small **Reopened** mark while `MapTile.reopened` is `true` | 02a v1.1.9 `MapTile.reopened` (05 v1.0.6 §6.4a: an open bill of the seating with `reopen_count ≥ 1`; R-30); `SeatingReopened` / `TableMarksChanged` refresh it |
| **Bill** action on the table sheet | for `take-payment` (scope) → 05-S02; for `take-order` only → 05-S02 read-only (§3.2.1) | owner 2026-11-19 (§7 Q-1); Ask for bill stays as 02a drew it |
| Corrections-only reopen | table sheet: "Bill reopened for corrections — new items go on a new bill" | 05 §3.10; `SubmitOrder` on that seating → 02a's `TABLE_SEATING_CHANGED` copy (existing) |

Frames: `TableBillStates` (T: tiles in each state, both marks on the tile, alone and together), `TableSheetBill` (T: Bill action + check bill printed + reopened line), `TableSheetBillPhone` (P).

---

## 4. Alert cards (01d components, 05 kinds)

All eight use 01d's card (C01), banner (B01), inbox row, answer sheet (D01), PIN step (D02, **reused unchanged**), "Approve here" (D03), read-only line (B02), answer errors (B04), result to the requester (N04) and lock text (F01), as designed in `docs/design/handoff/01d/`. You design their **text and detail lines** in each state, in English and Urdu. String keys: `alert.<kind>.card`, `alert.<kind>.lock`, `alert.<kind>.name` (the existing 01d / 04 pattern, e.g. `alert.void_approval.*`).

**Rules for every 05 request kind** (05 §3.14):
- `needs_pin: 'always'` (money): every Approve and Reject goes through the PIN step. Steps = 01d's `APPROVAL_TIER_STEPS` (reminder, escalation as 01d draws them).
- `details` carry only `amount` (minor), `reason` (the reason code → its label), `identifier` (05 §3.14, H2-6): **the card shows nothing else** — never a buyer ID, a note text, `paid_to` or a name beyond the requester 01d already shows.
- The **lock line** (signed-out kiosk, phone lock) shows only the kind label, table and requester (01d two-level rule), never the amount or reason.
- The approver is the person whose PIN answered (`answerer_staff_id`, never the device's session).
- **Withdraw** is 01d's own action on the requester's card; withdrawing changes nothing in 05 (`onWithdraw` returns `[]`).
- **Can no longer apply:** on Approve, the kind's `apply` re-checks the bill / shift; if it no longer fits, the answer is **refused** (01d B04 error state) — "This can't be approved any more: {why}"; the request stays open until withdrawn, rejected or closed. A **reject always succeeds**.
- **Closed obsolete:** a request is closed by the system when the bill closes (`bill_closed`, 05 §6.12 step 6), the day closes (`day_closed`, 05 §3.13; not `shift_variance`), or the shift closes (`shift_closed`, petty cash, 05 §6.17). Card closed line: 01d `alerts.closed.bill_closed` / `.expired` style ("Closed: bill closed", "Closed: day closed", "Closed: shift closed").

### 4.1 Per kind

| ID | Kind (`alert.<kind>`) | Raised by | Approvers | Card shows (details) | Lock shows | Approve does | Can no longer apply when (approve refused) |
|---|---|---|---|---|---|---|---|
| 05-N01 | `discount` | `ApplyDiscount`, grant `requires_approval` | the grant's `approver_role_ids` | "Discount · T7 · Rs 571.00 · Regular customer" (`amount`, `reason`, `identifier`); requester | "T7 · Discount · Sana" | applies the discount (`DiscountApplied`) | bill no longer OPEN, a split closed, or the amount no longer fits → "The bill changed — ask again" |
| 05-N02 | `remove_service_charge` | `RemoveServiceCharge`, `requires_approval` | grant's | "Remove service charge · T4 + T5 · Service complaint" | "T4 · Remove service charge · Ali" | `ChargeRemoved` | bill not open / charge already removed |
| 05-N03 | `reopen_bill` | `ReopenBill`, `requires_approval` | grant's | "Reopen bill · T7 · Wrong payment type" (+ amount when given) | "T7 · Reopen bill · Sana" | credits the invoices and reopens (§3.5.4); the credit note prints at the **answerer's** device route | the bill's invoices changed since the ask, or the invoice can't be credited (`BILL_REOPEN_NOT_SUPPORTED`) |
| 05-N04 | `remove_comp` | `RemoveComp`, `requires_approval` | grant's | "Remove comp · T7 · Paye × 1 · Comped by mistake" (`amount` = comp value) | "T7 · Remove comp · Bilal" | `LineCompRemoved` | order billed, units no longer comped, a void pending, or the units are in a paid split |
| 05-N05 | `close_without_buyer_id` | `WaiveBuyerId`, `requires_approval` | grant's | "Close without buyer details · Family 2 · Rs 60,784.00" | "Family 2 · No buyer details · Sana" | `BuyerIdWaived` | bill not open |
| 05-N06 | `petty_cash` | `RecordPettyCash` over the limit or `requires_approval` | **holders of `close-shift-for-others`** (01d holders right, row D-1; Manager, Owner by default; never the requester) | "Petty cash · Cash out Rs 6,500.00 · Repairs" (no `paid_to`, no note) | "Petty cash · Sana" | records the entry (no drawer kick; the requester opens the drawer, §3.8) | the shift is closed → closed obsolete `shift_closed` |
| 05-N07 | `shift_variance` | `CountShift` with `|variance| >` threshold (the shift is already CLOSED) | holders of `close-shift-for-others` | "Shift variance · Sana · Short Rs 250.00" (`amount` = variance with sign) | "Shift variance · Sana" | **Sign-off:** Approve → `approved`; Reject → `disputed` (a record only: shown on X / Z with who and when; no deduction, no follow-up, 05 §3.14 Q-4). Answer buttons may read **Approve** / **Dispute** (copy §6.7) | already signed off elsewhere |
| 05-N08 | `fiscal_outbox_stuck` (notice, no answer) | 01d tick when a fiscal record is stuck (05 §3.15) | managers; `closes_on: 'owner'` | "Fiscal records stuck · 3 waiting · oldest 2 h 05 min" (`quantity`, `minutes_late`); help "Tax invoices are not reaching the authority. Tell the owner." | "Fiscal records stuck" | — (notice; 01d D04 detail) | — |

`shift_variance` **does not expire at day close**: it can be answered on a later day (05 §3.14). Every other 05 request closes obsolete at day close (05 §3.13). `fiscal_outbox_stuck` closes by itself when nothing is stuck and expires at day close (re-raised next tick while still stuck).

### 4.2 States to draw (`Cards05`, `Answers05States`)

**Requester side** (the person who asked; card in the sheet's place and in 01d's "My requests" / inbox):

| State | Card |
|---|---|
| Waiting | "Waiting for Imran or a manager" (01d `answer.waiting_for`) + elapsed "waiting 3 min" + **Withdraw** |
| Reminder / escalated | 01d tags (no 05 text) |
| Approved | 01d N04 banner "Approved by Imran 1:44 PM"; the sheet's result (e.g. discount applied, totals refresh) |
| Rejected | "Rejected by Imran 1:44 PM"; nothing changed |
| Withdrawn | "Withdrawn"; nothing changed |
| Can no longer apply | the requester keeps the waiting card (the answer was refused); approver sees B04 (below) |
| Closed obsolete | "Closed: bill closed" / "Closed: day closed" / "Closed: shift closed" |

**Approver side** (01d answer sheet D01): details (kind label, identifier, amount, reason, requester, waiting time) → Approve / Reject → PIN (D02) → done ("Approved" / "Rejected"); someone answered first (B04 409 → toast who); not your team / informed (B02); hub down (B03); **can no longer apply** (B04 refused: "This can't be approved any more: the bill changed" — per kind as §4.1); own request (B04 403 self: "You can't approve your own request").

Frames: `AnswerDiscount`, `AnswerServiceCharge`, `AnswerReopen`, `AnswerRemoveComp`, `AnswerBuyerWaiver`, `AnswerPetty`, `AnswerVariance` (T, answer sheet, waiting); `Cards05` (T, every kind's card in the inbox, requester and approver, plus the stuck notice); `Answers05States` (T, approved / rejected / withdrawn / can no longer apply / closed obsolete); `AnswerKiosk05` (K, discount on the kiosk answer sheet); `AnswerPhone05` (P, a requester's result on the phone); `AnswerUrdu05` (T, `AnswerDiscount` in Urdu).

---

## 5. Printed layouts

**Not in scope.** The check bill, receipt, credit note, X / Z and no-sale are built by the merged builders in `packages/domain/src/billing/docs.ts` (`buildCheckBillDoc`, `buildReceiptDoc`, `buildCreditNoteDoc`, `buildReportDoc`; 05 §3.16, B17, B21, B26, B29; task 4a, AD-30) and the owner's receipt template (owner app). The screen never draws a receipt preview.

What the staff screens may say about paper:
- The check bill is provisional: banner `PROVISIONAL - NOT A TAX INVOICE`, no number, total if paid in cash plus "Total if paid by card" (05 §6.3, B17, AD-30). The screen copy may echo "Check bill (not a tax invoice)".
- A receipt shows the invoice number always, and the fiscal block "FISCAL NUMBER PENDING" / the fiscal number + QR / "FISCAL NUMBER NOT ISSUED" (05 §3.16, R-11). On screen the closed split shows the matching word: "Fiscal number pending" / "Fiscal no. {fiscal_number}" (`splits[n].invoice.fiscal_number`, with the jurisdiction's label, e.g. "PRA invoice no.") / "Not accepted by the authority" (`fiscal_state: 'rejected'`).
- The full buyer ID prints only on that customer's receipt and its reprints (05 §7 Privacy, Q-1). **No screen shows it.**

---

## 6. Copy list

Proposed English. Keys follow the client's existing pattern (`apps/client/src/i18n/en.ts`, `ur.ts`). Every key is **[UR]** (staff app, D12: EN + UR for every error). Strings with no Urdu frame go to `docs/design/handoff/05/urdu-todo.md`. Placeholders in `{}` stay LTR; amounts are formatted by the client with the bill's exponent (`{amount}` = "Rs 6,624.00").

### 6.1 Cashier screen (05-S01)

| Key | English | Intent |
|---|---|---|
| `billing.nav` | Bills | staff nav tab |
| `billing.list.if_cash` | if cash | under `total_default_minor` |
| `billing.list.paid` | Paid {amount} | `paid_minor` > 0 |
| `billing.badge.check_printed` | Check bill printed {time} | `check_printed_at` |
| `billing.badge.partly_paid` | Partly paid | `partly_paid` |
| `billing.badge.open_too_long` | Open too long · {duration} | `flagged` |
| `billing.badge.waiting` | Waiting for approval | `has_open_request` |
| `billing.list.open_for` | Open {duration} | `open_minutes` |
| `billing.list.empty` | No open bills | empty |
| `billing.list.as_of` | as of {time} | offline |
| `billing.type.dine_in` / `.takeaway` / `.parking` | Dine-in / Takeaway / Parking | `order_type` |
| `fiscal.line.ok` | Fiscal: all sent · last {time} | §3.1.1 |
| `fiscal.line.pending` | Fiscal: {n} waiting · oldest {duration} | pending |
| `fiscal.line.stuck` | Fiscal: {n} waiting · oldest {duration} — tell a manager | `stuck` |
| `fiscal.line.rejected` | Fiscal: {n} not accepted — tell a manager | `rejected_count` |
| `fiscal.line.token_missing` | Fiscal: not set up on this hub — tell the owner | `token_missing` |
| `fiscal.line.failing` / `.unknown` | Fiscal: can't reach the authority / Fiscal: not checked yet | `adapter_health` |
| `shift.strip` | {name} · shift since {time} | shift strip |
| `shift.open_prompt` | Open your shift to take money | no shift |

### 6.2 Bill screen, pad, splits, print (05-S02, C01–C04, D01)

| Key | English | Intent |
|---|---|---|
| `billing.state.open` / `.partly_paid` / `.closed` / `.reopened` | Open / Partly paid / Closed / Reopened | header chip; Reopened while `reopen_count ≥ 1` and not CLOSED |
| `billing.prices_include_tax` | Prices include tax | `prices_include_tax` |
| `billing.totals.subtotal` / `.discount` / `.service_charge` / `.rounding` / `.total` | Subtotal / Discount · {reason} / Service charge {rate} / Rounding adjustment / Total | 05-C03 |
| `billing.totals.tax_row` | {label} {rate} | tax row |
| `billing.dues.cash` / `.card` | Cash {amount} / Card {amount} | dues side by side |
| `billing.dues.paid_left` | Paid {paid} · Left {left} | balance |
| `billing.refund.cash` / `.card` | Refund cash {amount} / Refund card {amount} | negative balance |
| `billing.mixed_note` | Any cash on this split makes the whole split cash rate | `BillMixed` (05 B6) |
| `billing.tag.comp` / `.pending_void` / `.weight_needed` / `.tax_unresolved` / `.new` | COMP / PENDING VOID / WEIGHT NEEDED / Tax not set / New | 05-C04 (COMP and PENDING VOID reuse 02b / 04 keys) |
| `billing.locked_split` | Paid · {invoice_ref} | closed split |
| `billing.split_tab` | Split {n} | splits strip |
| `pad.total_card` / `pad.total_cash` / `pad.total_mode` | Total by card {amount} / Total in cash {amount} / Total by {mode} {amount} | mode chosen (M-7) |
| `pad.amount` / `pad.tendered` / `pad.change_due` / `pad.reference` | Amount / Cash given / Change due {amount} / Reference | pad fields |
| `pad.add` / `pad.give_back` | Add payment / Give back | pad buttons |
| `pad.payment.in` / `.out` / `.tendered_change` / `.has_reference` / `.by` | In / Back / Given {tendered} · Change {change} / Has reference / by {name} | payments list |
| `billing.close` | Close bill / Close split {n} | primary |
| `billing.blocks.bill_not_open` | This bill is already closed | §3.2.8 (pinned reasons, 05 v1.0.6) |
| `billing.blocks.void_pending` | {n} items waiting for void approval: {items} | §3.2.8 |
| `billing.blocks.weight_pending` | {n} items need a weight: {items} | |
| `billing.blocks.tax_unresolved` / `.tax_unresolved_sc` | Tax is not set for {items} — ask the owner / Tax is not set for the service charge — ask the owner | R-1 |
| `billing.blocks.discount_pending` | A discount is waiting for approval | |
| `billing.blocks.buyer_id_required` | Buyer details needed above {threshold} | |
| `billing.blocks.balance_due` | Take {cash} in cash or {card} by card | |
| `billing.blocks.shares_sum` | Split amounts no longer add up — edit the split | |
| `billing.closed` | Closed · Invoice {invoice_ref} · {amount} | `BillClosed` |
| `billing.closed_empty` | Closed · nothing billed · money given back | empty close |
| `billing.give_change` | Give change {amount} | change > 0 |
| `billing.fiscal.pending` / `.number` / `.rejected` / `.not_required` | Fiscal number pending / {label} {fiscal_number} / Not accepted by the authority / — | closed split |
| `billing.total_changed` | The total changed to {amount} — check it and close again | `BILL_TOTAL_CHANGED` |
| `billing.reopen_mode.full` / `.corrections` | Full edit: add, remove or change items / Corrections only: remove, void or comp; new items go on a new bill | §3.2.10 |
| `billing.buyer.needed` / `.added` / `.waived` | Buyer details needed above {threshold} / Buyer added — sent with Close / Customer refused buyer details | §3.2.11 |
| `billing.check_bill` / `.check_sent` / `.no_printer` | Print check bill / Check bill sent to {printer} / No bill printer is set up — show the screen to the customer | §3.2.7 |
| `billing.read_only` | Total if paid in cash {cash} · By card {card} | `BillReadOnly` |
| `billing.reprint_receipt` / `.reprint_credit` | Reprint receipt / Reprint credit note | §3.4 |
| `print.waiting` / `.printed` / `.failed` / `.none` / `.print_to` | Printing on {printer}… / Printed on {printer} / Didn't print on {printer}: {error} / No bill printer set up / Print to | 05-C02 |
| `split.title` / `.items` / `.amount` / `.equal` / `.one` / `.add` | Split the bill / Items / Amount / Equally / One bill / Add split | 05-D01 |
| `split.not_placed` / `.to_share` / `.save` | {n} items not placed / {amount} to share · {left} left / Save split | |

### 6.3 Bill sheets (05-D02 … D07)

| Key | English | Intent |
|---|---|---|
| `sheet.needs_approval` | Needs approval | tag (reuse 04 `.ntag` key) |
| `sheet.ask_approval` / `sheet.pick_reason` / `sheet.write_why` | Ask for approval / Pick a reason / Write why first | button steps |
| `discount.title` / `.amount` / `.percent` / `.apply` / `.remove` / `.applied` | Discount the bill / Amount / Percent / Give discount / Remove discount / Discount applied | 05-D02 |
| `discount.waiting` | Waiting for {name} or a manager · {value} · {reason} | pending |
| `sc.remove` / `.add_back` / `.removed` | Remove / Add back / Service charge removed | 05-D03 |
| `sc.reason.customer_request` / `.service_complaint` / `.staff_meal` / `.other` | Customer asked / Service complaint / Staff meal / Other | CHARGE_REMOVE_REASONS |
| `buyer.title` / `.name` / `.type` / `.number` / `.refuses` / `.not_needed` | Buyer details / Name / ID type / ID number / Customer refuses / Not needed for this bill | 05-D04 |
| `reopen.title` / `.what_happens` / `.done` | Reopen bill / Each paid split gets a credit note. Payments stay. Close again to issue new invoices. / Reopened · credit {credit_ref} {amount} | 05-D05 |
| `reopen.reason.wrong_item_billed` / `.wrong_payment_mode` / `.customer_returned_item` / `.price_error` / `.other` | Wrong item billed / Wrong payment type / Customer returned an item / Price error / Other | BILL_REOPEN_REASONS |
| `comp_remove.title` / `.done` | Remove comp / Comp removed · {amount} back on the bill | 05-D06 |
| `comp_remove.reason.comped_by_mistake` / `.wrong_line` / `.other` | Comped by mistake / Wrong line / Other | COMP_REMOVE_REASONS |
| `payment_remove.title` / `.done` / `.shift_closed` | Remove payment / Payment removed / This payment's shift is already counted — it can't be removed. Give the money back from your shift instead. | 05-D07 |
| `payment_remove.reason.wrong_mode` / `.wrong_amount` / `.customer_changed` / `.other` | Wrong payment type / Wrong amount / Customer changed their mind / Other | |

### 6.4 Shift (05-S03, S04)

| Key | English | Intent |
|---|---|---|
| `shift.nav` / `shift.open` / `shift.float` / `shift.as_drawer` | My shift / Open shift / Starting cash / Use this kiosk's cash drawer | 05-S03 |
| `shift.opened` | Shift open · drawer opened | toast |
| `shift.digital_first` | Check these against the card machine | takings header |
| `shift.cash_count_only` | Cash · {n} payments | blind line |
| `shift.counted` / `shift.count_close` | Cash counted / Count and close | count |
| `shift.expected` / `.variance_short` / `.variance_over` / `.variance_exact` | Expected / Short {amount} / Over {amount} / Exact | result |
| `shift.variance_pending` | Variance sent for sign-off (pending); the drawer is free | §8 exact intent |
| `shift.petty_cancelled` | {n} petty cash request was cancelled because the shift closed | result list |
| `shift.skip` / `.skipped` | Close without counting / Shift closed without a count | 05-S04 skip |
| `shift.handover` / `.handover_done` | Count at handover / Handover counted · shift still open | handover |
| `shift.other_title` | {name}'s shift | ShiftOther |
| `shift.open_advances` | Open advances | list |

### 6.5 Petty cash and drawer (05-D08, D09)

| Key | English | Intent |
|---|---|---|
| `petty.title` / `.advance` / `.out` / `.in` | Petty cash / Advance / Cash out / Cash in | kinds |
| `petty.category` / `.paid_to` / `.staff` | Category / Paid to / Who takes it | fields |
| `petty.record` / `.recorded` | Record / Recorded · drawer opened | allowed |
| `petty.waiting` / `.approved_open_drawer` | Waiting for a manager · {kind} {amount} · {category} / Approved — open the drawer to take the cash | pending / result |
| `petty.settle` / `.spent` / `.returned` / `.settled` | Settle / Spent / Returned / Settled | settle |
| `drawer.open` / `.opened` | Open drawer / Drawer opened | 05-D09 |
| `drawer.reason.change_for_customer` / `.check_cash` / `.other` | Change for a customer / Check the cash / Other | reasons |

### 6.6 Day close and reports (05-S05, S06)

| Key | English | Intent |
|---|---|---|
| `dayclose.nav` / `.title` / `.close` / `.what_happens` | Close day / Close the day for {branch} · {date} / Close day / Open requests are cancelled and the Z report prints. | 05-S05 |
| `dayclose.blocked.shift_open` / `_one` | {count} shifts are still open — close them first / 1 shift is still open — close it first | `shift_open` |
| `dayclose.blocked.unbilled` / `_one` | {count} orders are not billed — bill them or carry them over / 1 order is not billed — bill it or carry it over | `unbilled_orders` |
| `dayclose.blocked.voids` | reuse `admin_stock.errors.DAY_CLOSE_BLOCKED`, `_one`, `_more` | `void_pending` |
| `dayclose.close_shift` / `.carry_over` / `.carried` | Close this shift / Carry over / Carried to tomorrow | actions |
| `carry.reason.table_still_seated` / `.customer_will_pay_later` / `.other` | Table still seated / Customer will pay later / Other | CARRY_OVER_REASONS |
| `dayclose.done` | Day closed · Z {z_no} | done; `z_no` from `GET /queries/z-reports?business_date` (05 §6.26) |
| `reports.nav` / `.x` / `.z` / `.print` / `.retry_fiscal` | Reports / Today (X) / Z reports / Print / Retry fiscal now | 05-S06 |
| `reports.rounding` / `.brought_forward` / `.carried_forward` / `.net_after_credits` | Rounding / Brought forward / Carried forward / Net after credits | report lines |
| `reports.signoff.pending` / `.approved` / `.disputed` | Pending sign-off / Approved / Disputed | shift rows |
| `reports.retry_done` / `.rejected_note` | {n} waiting — sending now / Not accepted invoices need a fix from support | RetryFiscalNow |

### 6.7 Alert kinds

| Key | English |
|---|---|
| `alert.discount.name` / `.card` / `.lock` | Discount / Discount · {identifier} · {amount} · {reason} / {table} · Discount · {requester} |
| `alert.remove_service_charge.name` / `.card` / `.lock` | Remove service charge / Remove service charge · {identifier} · {reason} / {table} · Remove service charge · {requester} |
| `alert.reopen_bill.name` / `.card` / `.lock` | Reopen bill / Reopen bill · {identifier} · {reason} / {table} · Reopen bill · {requester} |
| `alert.remove_comp.name` / `.card` / `.lock` | Remove comp / Remove comp · {identifier} · {amount} · {reason} / {table} · Remove comp · {requester} |
| `alert.close_without_buyer_id.name` / `.card` / `.lock` | No buyer details / Close without buyer details · {identifier} · {amount} / {table} · No buyer details · {requester} |
| `alert.petty_cash.name` / `.card` / `.lock` | Petty cash / Petty cash · {amount} · {reason} / Petty cash · {requester} |
| `alert.shift_variance.name` / `.card` / `.lock` / `.approve` / `.reject` | Shift variance / Shift variance · {requester} · {amount} / Shift variance · {requester} / Approve / Dispute |
| `alert.fiscal_outbox_stuck.name` / `.card` / `.lock` / `.help` | Fiscal records stuck / Fiscal records stuck · {quantity} waiting · oldest {minutes} min / Fiscal records stuck / Tax invoices are not reaching the authority. Tell the owner. |
| `alerts.closed.day_closed` / `.shift_closed` | Closed: day closed / Closed: shift closed (beside the existing `.bill_closed`) |
| `answer.no_longer` | This can't be approved any more: {why} |

### 6.8 Errors (`errors.<code>`, every 05 §9 code; struck-through codes left out)

| Key | English |
|---|---|
| `errors.BILL_NOT_FOUND` | This bill can't be found — go back to Bills |
| `errors.SHIFT_NOT_FOUND` | This shift can't be found |
| `errors.INVOICE_NOT_FOUND` | This invoice can't be found |
| `errors.PAYMENT_NOT_FOUND` | This payment was already removed |
| `errors.PAYMENT_MODE_NOT_FOUND` | This payment type was removed — pick another |
| `errors.PETTY_CASH_NOT_FOUND` | This advance can't be found |
| `errors.Z_REPORT_NOT_FOUND` | This Z report can't be found |
| `errors.BILL_NOT_OPEN` / `_cancelled` | This bill is already closed / This order was cancelled |
| `errors.BILL_CLOSE_BLOCKED` | Can't close yet: {reasons} (reasons as `billing.blocks.*`) |
| `errors.DISCOUNT_PENDING` | A discount is waiting for approval |
| `errors.BUYER_ID_REQUIRED` | Buyer details are needed above {threshold} |
| `errors.BILL_TOTAL_CHANGED` | The total changed to {amount} — check it and close again |
| `errors.BILL_BALANCE_DUE` | {amount} still to take on split {n} |
| `errors.BILL_PARTLY_PAID` | A split is already paid — no discount now |
| `errors.LINE_IN_CLOSED_SPLIT` | Reopen the bill to change a paid split |
| `errors.BILL_HAS_PAYMENTS` | Split {n} has a payment — remove the payment first or keep the split (merge / split of the table: "This bill has a payment — the tables can't be joined or split now") |
| `errors.BILL_REOPEN_PENDING` | A reopen is already waiting for approval |
| `errors.BILL_REOPEN_NOT_SUPPORTED` | This bill can't be reopened: its tax invoice can't be credited here — ask the owner |
| `errors.LINE_NOT_COMPED` | This item is not comped |
| `errors.SHIFT_NOT_OPEN.no_shift` / `.no_drawer_shift` / `.not_open` / `.payment_shift_closed` | Open your shift to take money / This device has no open drawer shift / This shift is already closed / This payment's shift is already counted — give the money back from your shift instead |
| `errors.SHIFT_ALREADY_OPEN` | Your shift is already open |
| `errors.DRAWER_IN_USE` | This drawer is in {name}'s open shift — they must close it first, or open without the drawer |
| `errors.PETTY_ADVANCE_SETTLED` | Already settled |
| `errors.BILL_SPLIT_INVALID.units_missing` / `.units_exceed` / `.deal_whole` / `.option_with_parent` / `.shares_sum` / `.split_closed` | Every item must be in a split — {item} is not / {item} is placed more than once / A deal moves as a whole / Options go with their item / Amounts must add up to {amount} / A paid split can't be changed |
| `errors.DISCOUNT_TOO_LARGE` | The most you can give is {amount} |
| `errors.PAYMENT_MODE_NOT_FISCAL` | {mode} can't be used for a tax invoice here — use another, or remove it and take it again |
| `errors.PAYMENT_EXCEEDS_BALANCE` / `_zero_in` / `_zero_out` | The most you can take by {mode} is {amount} / Nothing left to pay on this split / Nothing to give back by {type} |
| `errors.PAYMENT_REFERENCE_REQUIRED` | Enter the reference |
| `errors.PAYMENT_CASH_STEP` | Cash must be in steps of {amount} |
| `errors.DRAWER_DEVICE_INVALID` | This device can't hold a cash drawer |
| `errors.PETTY_SETTLE_MISMATCH` | Spent and returned must add up to {amount} |
| `errors.DAY_CLOSE_BLOCKED.shift_open` / `.unbilled_orders` | as `dayclose.blocked.*` (staff app); `void_pending` keeps 04's text |
| `errors.PERMISSION_DENIED.not_own_payment` / `.skip_not_granted` / `.outside_scope` | Only a manager can remove someone else's payment / You can't skip the count / This bill is not one of your tables |
| reused, existing keys | `errors.PRINTER_NOT_FOUND`, `errors.PRINT_JOB_NOT_FOUND`, `errors.PRINT_JOB_NOT_PENDING`, `errors.VALIDATION_FAILED`, `errors.CONFIG_REFERENCE_INVALID`; 02a / 02b / 04 / 01a keys for `ORDER_BILLED`, `VOID_PENDING`, `TABLE_NOT_OPEN`, `BUSINESS_DAY_NOT_OPEN`, `TABLE_SEATING_CHANGED` (check `en.ts` at build; add an `errors.<code>` key where none exists, task 43a / 43b) |

### 6.9 Existing strings (do not rewrite)

`perm.apply-discount` "Give a discount"; `perm.reopen-bill` "Reopen a closed bill"; `perm.view-reports` "See sales reports"; `perm.take-order` "Take orders"; the 01d `alerts.*` and `answer.*` keys; 04's PENDING VOID and Needs-approval keys; 02b's COMP key; `admin_stock.errors.DAY_CLOSE_BLOCKED*`. **New `perm.*` labels for the 05 permissions** (`take-payment`, `remove-service-charge`, `close-without-buyer-id`, `remove-comp`, `manage-own-shift`, `close-shift-for-others`, `skip-blind-count`, `record-petty-cash`, `open-cash-drawer`, `close-business-day`, `manage-fiscal-settings`) are R-23's 11 labels, added by task 43a / 43b; the screens never show them.

---

## 7. Open design questions

Only what the spec leaves to design, or where a screen would need data the API does not give. Rulings from the owner on 2026-11-19 are marked **Decided**.

| # | Question | Recommendation |
|---|---|---|
| Q-1 | Where the cashier screen, shift, petty cash, day close and reports sit in the staff nav, and how a waiter reaches a bill. Spec silent. | **Decided** (owner 2026-11-19): kiosk home = Bills for `take-payment` holders; 02b Open orders stays a tab; the table sheet gets a **Bill** action by scope; My shift, Petty cash, Close day and Reports are nav items by permission; the shift strip on Bills holds My shift / Petty cash / Open drawer. |
| Q-2 | `open-bills` totals are "before pending voids" (05 §6.2); the bill screen subtracts them. Show a note on the row? | No note: the PENDING VOID tag and Close block on the bill screen explain it; the row stays short. |
| Q-3 | Change preview before Add: the server returns `change_due_minor` only after `AddPayment`. | **Decided** (reviewer MINOR, owner 2026-11-20): **server only.** No change figure while typing; "Change due" shows after Add from `change_due_minor`. The client does no arithmetic on money, not even a subtraction of two typed numbers (05 §8). |
| Q-4 | The "New" mark for lines added after a split closed (05 §8). | **Decided** (owner ruling R-29, 05 v1.0.6 §6.1): the bill view carries `lines[].added_after_close`; the New mark shows on a line of an open split when it is `true`. |
| Q-5 | `blocks[].reason` values for §3.3 rules 4, 6, 8, 8a. | **Decided** (owner ruling R-29, 05 v1.0.6 §6.1): `blocks = [{ reason, split_no, details }]`, one pinned reason per §3.3 rule (`bill_not_open`, `void_pending`, `weight_pending`, `tax_unresolved`, `discount_pending`, `buyer_id_required`, `balance_due`, `shares_sum`); one copy key per reason (§3.2.8, §6.2). |
| Q-6 | Keypad size on the kiosk for amounts. | 64 px keys, the number display in Bricolage at the total's size; physical keyboard digits work too. |
| Q-7 | `GET /queries/bill-printers` permission vs `RetargetBillPrint` (`take-order`, 05 §6.23). | **Decided** (owner ruling R-27, 2026-11-19; 05 v1.0.5 §6.23a, PR #317): the query uses `take-order` (any grant), the same as `RetargetBillPrint`. Anyone who can retarget sees the Print to picker; no "ask the cashier" state. Frame `PrintToPhone` added. |
| Q-8 | A discount preview ("Rs 571.00") before sending: the server computes it (`applied: Totals`). | No preview line and no computed amount: the field shows only what was typed ("10 %" / "Rs 500.00"); the discount amount and new totals show after the server answers. |
| Q-9 | Default of the "use this drawer" switch on Open shift. | On for a cashier kiosk, off for a tablet; hidden on a phone (it can't hold a drawer). |
| Q-10 | Opening another person's shift (for `close-shift-for-others`): the only list of open shifts is `DAY_CLOSE_BLOCKED shift_open`. A staff picker for shifts has no API. | Reach another person's shift only from the day-close list (`DayCloseShifts` → Close this shift). No separate picker (it would need a new query). |
| Q-11 | Check-bill-printed mark on the 02a tile. | **Decided** (owner ruling R-30 (b), 05 v1.0.6 §6.4a row T-4, 02a v1.1.9): `MapTile.check_printed_at` and `MapTile.reopened`; the tile shows a small printer mark and a small Reopened mark (both may show together); `TableMarksChanged` refreshes them. |
| Q-12 | Source of the "Who takes it" staff picker for a petty advance (`advance_staff_id`). Spec silent. | Use the existing sign-in roster `GET /queries/staff-roster` (device session, lists staff). |
| Q-13 | Buyer ID on screen. | **Decided** (owner 2026-11-19): typed value visible only while editing, fake sample `00000-0000000-0`, cleared after send, never shown again. |
| Q-14 | Petty cash button label. | **Decided** (owner 2026-11-19): "Record" under the limit; "Needs approval" / "Ask for approval" over it or on a `requires_approval` grant; the server decides. |
| Q-15 | Day close blockers all at once or one by one. | **Decided** (owner 2026-11-19): one by one, in guard order (05 §3.13, §6.25). |
| Q-16 | Print to printer list. | **Decided** (owner 2026-11-19): `GET /queries/bill-printers`, 05 v1.0.5 §6.23a (G-28; permission `take-order` per R-27). |
| Q-17 | Dropped old-inventory screens (tips, by person, refund screen, reopen day, QR share, PDF / CSV, denominations). | **Decided** (owner 2026-11-19): dropped; §2.3 rows say why. |
| Q-18 | How the "Reopened" chip is known on an OPEN bill. | **Decided** (owner ruling R-29, 05 v1.0.6 §6.1): `reopen_count`; the chip shows while `reopen_count ≥ 1` and the bill is not CLOSED. |

---

*Written 2026-11-19 from `module-05` @ `6bc87c4` (05 v1.0.4); updated 2026-11-20 to `module-05` @ `4fcc615` (05 v1.0.6, 02a v1.1.9; PR #321). Nothing in this file changes a spec.*
