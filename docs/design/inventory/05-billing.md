# 05 — Billing: screen inventory

**No spec yet.** Sources: stories E0-PAY, E0-SHIFT, E0-REF AC1–3, E8-SPLIT, E8-ZR, E8-TAX, E3-RCPT (content), E0-TPL AC1/AC3 (receipt template), E6-PVOID AC3/AC4 (close blocks); foundation §4.6 (shift model), §3.5 (`InvoiceIssued`); README R7 (configurable payment modes incl. "online", manual card amount), R12 (template with variables), R13/R20 (PRA deferred; pilot runs beside the existing billing), 05 carried (tax at bill close, tax by bill type and payment method as data, business day open→close replaced by 05 with Z report, bill-level rounding, order taker may close own tables with per-person cash count, open shift on takeover). Conventions in [00-index.md](00-index.md).

**Pilot note (R20):** at milestone A the existing billing system keeps issuing receipts; this module's bill/receipt must still be complete, and the Z report is the owner's daily check.

---

## 1. Who and where
| Who (permission) | Device | How often | Conditions |
|---|---|---|---|
| Cashier (open shift — permission TBD, "opening requires the cashier role" in the story → R5: a permission) | Cashier kiosk 1920 (K) + counter printer + cash drawer; mouse/keyboard/touch | 1 500–2 000 bills/day; queue at lunch/dinner | Customers at the counter; mixed cash/card/online; change counting |
| Order taker closing bills on own tables, with own cash count (owner answer) | T, P | per table | at the table |
| `apply-discount`, `apply-comp`, `apply-refund`, service-charge remove, `reopen-bill` (each may need approval) | K, T | 10–50/day | reason required |
| Manager (acknowledge variance, tip over threshold, day close, reopen) | K, T, P | daily | night close ~01:00 |
| Owner (payment modes, tax rules, receipt template, thresholds; skip blind count) | L (owner app) | setup; rare | — |

Hub-only for bills, payments, shifts (work offline, E5-OFF AC1); online wallet/Raast modes need internet and show "unavailable" when it's down (E0-PAY AC7). Config (modes, tax rules, template) is cloud (owner app).

## 2. Jobs to be done
| # | Job | Story AC | Acceptance |
|---|---|---|---|
| J1 | As a cashier, I need to open my shift with a float before taking money. | E0-SHIFT AC1 | float in Rs; required before any payment |
| J2 | As a cashier, I need to see a bill: lines, pending voids excluded, subtotal, service charge, tax by class, total. | E3-RCPT AC2; E8-TAX AC1; E6-PVOID AC1 | rounding per restaurant |
| J3 | As a cashier, I need to take any mix of configured payment modes until the bill is covered. | E0-PAY AC1, AC2, AC6, AC7; R7 | card amount typed; online unavailable offline; can't close until 0 |
| J4 | As a cashier, I need tips, service charge and discounts with reasons and permissions. | E0-PAY AC3–5; edges | tip over threshold → manager ack |
| J5 | As a cashier, I need to split a bill by item, by person (seat), or by amount. | E8-SPLIT AC1–5 | amounts sum to total in paisa; remainder assigned explicitly |
| J6 | As a cashier, I need comps, full and partial refunds with reasons. | E0-REF AC1–3, AC5 | COMP label; logged |
| J7 | As a cashier, I need petty cash in/out with a reason. | E0-SHIFT AC2 | against the shift |
| J8 | As a cashier, I need to close my shift with a blind count. | E0-SHIFT AC3–5; E8-ZR AC1–3 | count before expected shown; variance; threshold → manager ack; skip owner-only, logged |
| J9 | As a manager, I need to close the day only when all shifts are closed, and get a Z report. | E0-SHIFT AC6, AC7; E8-ZR AC4, AC5; edges | blocked by open shifts, open orders (override logged), pending voids |
| J10 | As a manager, I need to reopen a closed day with permission; activity is flagged. | E0-SHIFT AC8 | "reopened" flag |
| J11 | As the owner, I need configurable payment modes, tax rules by bill type and payment method, and a receipt template with variables and live preview. | R7, R12; E0-TPL AC1, AC3; 05 carried | data, not code (R18) |
| J12 | As a cashier, I need to share or save a bill when the printer is down. | E8-SPLIT edge; E0-SHIFT edge (Z as PDF/CSV) | QR link or file |

## 3. Screen list
| ID | Name | Kind |
|---|---|---|
| 05-S01 | Open shift (float) | screen |
| 05-S02 | Cashier home: bills to settle (bill requested tables, takeaway/parking ready to pay) | screen |
| 05-S03 | Bill (lines, pending voids, comps, discounts, service charge, tax, total) | screen |
| 05-D01 | Discount (amount or %, reason) | dialog |
| 05-D02 | Remove service charge (reason) | dialog |
| 05-D03 | Comp an item (reason) | dialog |
| 05-S04 | Take payment (modes, amounts, remaining, change due, tip) | screen |
| 05-D04 | Card amount (approved on the terminal) | dialog |
| 05-D05 | Online payment (bank transfer / wallet / Raast — reference) | dialog |
| 05-D06 | Tip over threshold — manager acknowledgement | dialog |
| 05-S05 | Split bill (by item / by person / by amount) | screen |
| 05-D07 | Assign the remainder (paisa) | dialog |
| 05-S06 | Refund (full / partial items / partial amount, reason) | screen |
| 05-S07 | Petty cash (in / out, reason) | dialog-screen |
| 05-S08 | Close shift — blind count | screen |
| 05-S09 | Close shift — result (expected, counted, variance) | screen |
| 05-D08 | Variance over threshold — manager acknowledgement | dialog |
| 05-D09 | Skip blind count (owner only, logged) | dialog |
| 05-S10 | Close day (checklist of blocks) | screen |
| 05-D10 | Close with open orders — override (logged) | dialog |
| 05-S11 | Z report (view, print, save PDF/CSV) | screen |
| 05-D11 | Reopen day | dialog |
| 05-D12 | Takeover with an open shift (README carried) | dialog |
| 05-S12 | Payment modes (owner list) | owner screen |
| 05-S13 | Tax rules (by bill type × payment mode) | owner screen |
| 05-S14 | Receipt template editor with live preview | owner screen |
| 05-S15 | Billing settings (service charge %, tip allocation, rounding, thresholds) | owner screen |
| 05-S16 | Share bill by QR (printer offline) | dialog-screen |
| 05-S17 | Open day (replaces 01a Start day at the till) | screen/state |
| 05-B01 | Bill can't close: N to pay / pending void / unpaid split | banner |
| 05-B02 | "Online payments unavailable — no internet" | banner |
| 05-B03 | Shift not open — open it to take payments | banner |
| 05-P01 | Bill (printed before payment) | print |
| 05-P02 | Receipt (on payment close) | print |
| 05-P03 | Z report print | print |
| 05-P04 | Shift close slip | print (Q8) |

**Count: 36.**

## 4. Per screen

### 05-S01 Open shift
Fields: **Starting cash** (Rs, LTR, ≥ 0, required, `opening_float_minor`) — optional denominations helper (Q1). **Open shift** → `OpenShift` (proposed; command_id). Blocks: no business day open → 05-S17. Sample: Sana, float Rs 5,000.

### 05-S02 Cashier home
Queue cards: "T7 · Bill requested 2 min ago · Rs 3,820", "Parking LEB 1234 · ready · Rs 1,450", "Takeaway #42". Shift strip: "Sana · shift since 12:00 · cash in drawer?" (hidden — blind), **Petty cash**, **Close shift**. Search by table / car / number.

### 05-S03 Bill
- **Lines:** item, qty (pieces/kg), unit price, line total (`lineTotalMinor`), labels COMP / PENDING VOID (excluded, 04-B01) / DISCOUNT.
- **Totals:** Subtotal; Service charge 5 % (removable, D02); Discount; Tax per class ("PRA cash 16 %: Rs 520" — rate resolved at bill close; none when `tax_enabled` off or line has no tax class); Rounding (bill level, 05's); **Total**. All LTR "Rs 3,820".
- **Actions:** Print bill (05-P01, sets BILL_REQUESTED?), Discount (`apply-discount`), Comp line (`apply-comp`), Remove service charge, Split (05-S05), Take payment (05-S04), item actions (04-S01).
- **States:** pending void (B01: "1 void waiting for approval — can't close yet"); approval needed tags; discounts needing approval pending (Q2); offline from cloud (fine — hub).
- **Sample (T7):** Karahi Full 1 kg 2,200; Naan ×4 120; Lassi ×2 500; Seekh ×6 900 → subtotal 3,720; service 0; tax PRA cash 16 % = 595.20 → total 4,315 (rounded? Q3).

### 05-S04 Take payment
- **Layout:** total and **Left to pay** (big, LTR) → payment mode buttons from the owner list (Cash, Card, Online: JazzCash/Easypaisa/Raast/bank transfer) — all always shown (E0-PAY AC1; D8), online greyed "No internet" (B02) → entered payments list (mode, amount, remove) → tip field → change due (cash) → primary **Close bill** (disabled until 0).
- **Cash:** amount tendered keypad, quick buttons (exact, 5,000, 10,000), change "Give back Rs 685". Drawer kicks on close (E0-HW AC2).
- **Card (05-D04):** "Amount approved on the card machine" (Rs, prefilled with left to pay); optional last 4 / approval code? (Q4).
- **Errors:** over-payment non-cash, `SPLIT_TOTAL_MISMATCH`, `VOID_PENDING`, shift not open (B03), `PERMISSION_DENIED`, tax changed (?).
- **Result:** `BillClosed` + `InvoiceIssued` (F §3.5); receipt prints (05-P02); table → NEEDS_CLEANING.
- **Steps target:** cash exact: 3 taps (Cash → Exact → Close). Mixed card + cash: ≤ 7.

### 05-S05 Split bill
Tabs **By item** (tap items into split A/B/C…), **By person** (seat numbers or names — seats are not in the order model yet, Q5), **By amount** (enter amounts; remainder in paisa must be assigned, 05-D07). Each split paid independently; bill closes when all splits are paid. Relationship to 02 split table (02-D11) — Q17 in 02.

### 05-S06 Refund
After a bill is closed: pick bill (search by no./table/time) → Full (all items returned via lifecycle, D10) or select items or partial amount → reason (04-C01) → refund mode → `apply-refund` (approval possible). Prints a refund slip? (Q8).

### 05-S08 / 05-S09 Close shift
S08: "Count the cash in the drawer" → **Counted cash** (Rs, LTR; optional denominations) → **Show result**. The expected amount is **never shown before** the count (blind, D21). S09: Expected, Counted, Variance (+/−, warn/danger tone + word), petty cash list; variance over threshold → 05-D08 manager PIN acknowledgement; **Close shift**. 05-D09 skip (owner only, logged).

### 05-S10 Close day
Checklist with live status: All shifts closed (list open ones: "Sana — open"), No open orders (list; override 05-D10, logged), No pending voids (link 04-S02), → **Close day and print Z report**. Replaces 01a's Close day for the till (the 01a stock page close remains? Q6).

### 05-S11 Z report
Per E8-ZR AC5 / E0-SHIFT AC7: business date and open→close times; sales by payment mode; voids (count, value); discounts; comps; petty cash entries; per shift expected vs counted and variance; total variance; tax by class (E8-TAX AC3 tie-in). Actions: Print (05-P03), Save PDF, Save CSV (file download), Reopen day (05-D11, permission, flags later activity "reopened").

### 05-D12 Takeover with open shift
Text depends on owner answer (README 05 carried): hand over / block / require close. Q7.

### 05-S12 … S15 Owner config (cloud owner app)
- **S12 Payment modes:** list (name, kind: cash / card / online, needs internet yes/no, active, sort) — R7 configurable list.
- **S13 Tax rules:** grid bill type (dine-in, takeaway, delivery, parking? Q9) × payment mode → tax class or rate (data, R18). Sample: PRA card 5 %, PRA cash 16 % (from 01a tax classes).
- **S14 Receipt template:** fields/variables (logo upload, business name, address, NTN/tax IDs, footer, language EN) with `{variables}` and a **live preview** (03b-P07) at 58 and 80 mm; takes effect on the next print (E0-TPL AC4).
- **S15 Billing settings:** service charge %, auto-add on (dine-in only?), tip allocation (staff/house), tip threshold %, variance threshold Rs, rounding method (nearest Rs 1 / 5 / 10, half up), timeout-override for pending voids (04-S06).

### 05-P01 / P02 / P03 print content
```
        ARIF CHATKHARA
   Main Boulevard, Gulberg, Lahore
        NTN 1234567-8
--------------------------------
Bill 0427        T7      13:52
Waiter Bilal
--------------------------------
Chicken Karahi Full 1kg  2,200
4 x Naan                   120
2 x Lassi                  500
6 x Seekh kebab            900
  PENDING VOID: 1 x Raita   (80)
--------------------------------
Subtotal                 3,720
PRA cash 16%               595
Total                Rs  4,315
--------------------------------
Cash                     5,000
Change                     685
      Thank you — come again
```
Receipt adds payments and change; bill omits them. No QR in P1 (D20). Z report print: sections as 05-S11.

## 5. Flows
1. **Cash bill at the counter:** 05-S02 T7 → 05-S03 → Take payment → Cash → Exact/5,000 → Close → receipt + drawer → table needs cleaning. Unhappy: pending void → B01 → wait/approve (04) or 04-D07; printer offline → 05-S16 QR / queued.
2. **Split by amount 3 ways:** 05-S03 → Split → By amount 1,440/1,440/1,435 → remainder 0.00 → pay each.
3. **Card + cash:** Card 3,000 (05-D04) → Cash rest → Close.
4. **Online when internet down:** Online greyed (B02) → choose cash/card.
5. **Discount needing approval:** D01 10 % "regular customer" → needs approval → manager approves (approval surface Q2).
6. **Shift change 17:00:** Sana 05-S08 count 48,250 → S09 variance −250 (under threshold) → closed → Usman logs in (02-S01) → 05-S01 float.
7. **Night close:** 05-S10 → all closed → Z report 05-S11 → print.

## 6. Data shown
Bill (lines copied at submit, D25; tax class per line; rate at close), payments (mode id, amount_minor, reference), tips, service charge, discounts, comps, refunds, shift (float, petty cash, payments, counted, expected, variance), business day, Z report aggregates, config (modes, tax rules, template, settings). All money integer paisa (D47), shown "Rs 4,315" (LTR).

## 7. Cross-module links
Needs 02 orders (bill type = order type), 04 pending voids/item lifecycle (refunds/returns), 01a tax classes, `tax_enabled`, business day events, 03b printing and drawer kick, 01b permissions. Gives sales/payments/voids/discounts to 07 (owner view) and 06 (sync), `InvoiceIssued` for a later PRA module (R13).

## 8. Open questions (owner)
- **Q1** Count cash by denomination (5,000 / 1,000 / 500 / 100 / 50 / 20 / 10 notes and coins) or one total?
- **Q2** How does a manager approve a discount/comp/refund that needs approval: PIN on the cashier screen, or an alert on their phone like voids?
- **Q3** Bill rounding: to the nearest rupee? Rs 5? Who absorbs it?
- **Q4** Card payments: record last 4 digits or approval code?
- **Q5** Split by person: are seats recorded at ordering (they aren't in 02 today)?
- **Q6** After 05, does the stock page still have its own Close day, or only the till?
- **Q7** Open shift on takeover: hand over, block takeover, or require shift close? (README carried.)
- **Q8** Print a shift-close slip and refund slip?
- **Q9** Tax by bill type: is parking a separate type or "takeaway"? Delivery is P2.
- **Q10** Can an order taker close bills on own tables and keep cash (owner answer) — with their own shift/float?
- **Q11** Tip allocation "to staff": to whom (the waiter on the order)?
- **Q12** Khata/credit (P2) — show the option disabled or hide it?

## 9. Design status
Not designed.

## Story AC → screen IDs
| Story AC | Screens |
|---|---|
| E0-PAY AC1, AC2 | 05-S04 |
| E0-PAY AC3 + tip edge | 05-S04, D06, S15 |
| E0-PAY AC4 | 05-S03, D02, S15 |
| E0-PAY AC5 | 05-D01 |
| E0-PAY AC6 | 05-D04 |
| E0-PAY AC7 | 05-B02, D05 |
| E0-PAY edge partial payment | 05-S04 (left to pay), B01 |
| E0-SHIFT AC1 | 05-S01 |
| E0-SHIFT AC2 | 05-S07 |
| E0-SHIFT AC3, AC4, AC5 | 05-S08, S09, D08, D09 |
| E0-SHIFT AC6 + edges | 05-S10, D10, S17 |
| E0-SHIFT AC7 | 05-S11, P03 |
| E0-SHIFT AC8 | 05-D11 |
| E0-SHIFT edge printer offline Z | 05-S11 (PDF/CSV) |
| E0-REF AC1, AC2 | 05-S06 |
| E0-REF AC3 | 05-D03 |
| E8-SPLIT AC1–5 + edges | 05-S05, D07, S16 |
| E8-ZR AC1–5 + edge handover | 05-S08–S11 |
| E8-TAX AC1, AC2 | 05-S03, P01, P02, S15 |
| E8-TAX AC3 (tax report) | 07-S05 |
| E8-TAX AC4 (pluggable) | no screen (architecture) |
| E8-TAX AC5 (PRA conditional) | **no screen** — deferred (R13) |
| E3-RCPT AC1–4 | 05-P01, P02, S14 |
| E0-TPL AC1, AC3 | 05-S14 (+ 03b-P07) |
| E6-PVOID AC3, AC4 | 05-B01, 04-D07 |
| R7 payment modes | 05-S12 |
| 05 carried: tax by bill type and mode | 05-S13 |

**ACs with no screen:** E8-TAX AC5 (PRA, deferred by R13); E8-TAX AC4 (architecture only).
