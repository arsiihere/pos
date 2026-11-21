# 05 Billing — mapping

Screen ID → frames → components (CSS classes) → API fields. Brief: `docs/design/inventory/05-billing-design-brief.md`. CSS: the 04 set unchanged + `design/css/pulse-05.css` (prefix `b5-`, no new tokens).

## 05-S01

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `OpenBills` | 1920x1080 en | Lunch rush, 14 bills in server order (check bill printed first); badges; fiscal 3 waiting; shift card with My shift / Petty cash / Open drawer (kiosk 1920×1080) | `.b5-wl .b5-wr .b5-bd .b5-fis .b5-shiftcard` | GET /queries/open-bills · GET /queries/fiscal-status |
| `OpenBillsTablet` | 1280x800 en | Same list at 1280 (manager tablet); tap a row opens the bill (tablet 1280×800) | `.b5-wl .b5-wr` | GET /queries/open-bills |
| `OpenBillsEmpty` | 1920x1080 en | No open bills (01d .empty) — first load uses .sk skeleton rows (drawn small inside) (kiosk 1920×1080) | `.empty .sk` | GET /queries/open-bills → [] |
| `OpenBillsFiscal` | 1920x1080 en | Component: the fiscal line in all its states (kiosk 1920×1080) | `.b5-fis` | GET /queries/fiscal-status |
| `OpenBillsOffline` | 1920x1080 en | Hub down: last list kept “as of 1:38 PM”; rows still open the bill read-only; shift actions “Needs the hub” (kiosk 1920×1080) | `.b5-off .b5-needshub` | — |
| `OpenBillsUrdu` | 1920x1080 ur | Main state in Urdu (RTL; identifiers, amounts and times LTR) (kiosk 1920×1080) | `.b5-wl .b5-wr` | GET /queries/open-bills |

## 05-S02

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `Bill` | 1920x1080 en | Table 7 unpaid: lines, server totals, dues side by side (cash 6,624.00 / card 5,996.00), pad idle, Close disabled with the balance reason (kiosk 1920×1080) | `.b5-k .b5-bh .b5-acts .b5-lines .ol .b5-tot .b5-dues .b5-pad .b5-close .b5-why` | GET /queries/bill?seating_id · GET /queries/branch-config (payment_modes) |
| `BillPadCard` | 1920x1080 en | Card chosen: “Total by card Rs 5,996.00”, amount pre-set to the card due; keypad 64 px (kiosk 1920×1080) | `.b5-mode[aria-pressed] .b5-pad__say .b5-in.focus .b5-keys` | AddPayment { mode_id: card, direction: in, amount_minor: 599600 } |
| `BillPadCash` | 1920x1080 en | Cash chosen: “Total in cash Rs 6,624.00”; Cash given typed 7,000 (never pre-filled); no change figure while typing — Change due comes only from the AddPayment result (Q-3 decided: server only) (kiosk 1920×1080) | `.b5-in.focus .b5-quick .b5-change.pre` | AddPayment { mode_id: cash, amount_minor: 662400, tendered_minor: 700000 } → change_due_minor |
| `BillMixed` | 1920x1080 en | Card 3,000.00 taken; dues now cash 3,624.00 / card 2,996.00 (server values); note on the cash-rate rule (B6) (kiosk 1920×1080) | `.b5-pay .b5-tr.paid .b5-mixed` | GET /queries/bill (after AddPayment result) |
| `BillReadyToClose` | 1920x1080 en | Paid in full by card: dues hidden (balance 0), Close is the one primary (kiosk 1920×1080) | `.b5-due.zero .b5-close .btn--primary` | CloseSplit { split_no: 1, expected_total_minor: 599600 } |
| `BillCloseBlocked` | 1920x1080 en | PENDING VOID (Raita, Ali’s request; struck, out of the totals) and WEIGHT NEEDED (Fish); Close disabled with the server’s blocks listed in order (kiosk 1920×1080) | `.ptag .ol.pend .b5-tg .b5-why` | GET /queries/bill → blocks[{ reason: void_pending / weight_pending / balance_due, split_no, details }] |
| `BillBuyerRequired` | 1920x1080 en | Family 2, net 52,400.00 > Rs 50,000: buyer row with Add buyer; Close disabled (kiosk 1920×1080) | `.b5-ban.c-warn (buyer row)` | GET /queries/bill → buyer { required, threshold_minor } |
| `BillTotalChanged` | 1920x1080 en | BILL_TOTAL_CHANGED after Close: banner with the new total, screen refreshed, never auto-closes (kiosk 1920×1080) | `.b5-ban.c-warn` | CloseSplit → 409 BILL_TOTAL_CHANGED { total_minor } |
| `BillPartlyPaid` | 1920x1080 en | T4 + T5 in 2 item splits: split 1 Closed (locked, AC1-S000124), split 2 open with a New line; Discount hidden; LINE_IN_CLOSED_SPLIT message with Reopen (kiosk 1920×1080) | `.b5-splits .b5-sp.done .ol.locked .b5-tg.c-new .msg.c-warn` | GET /queries/bill → splits[]; LINE_IN_CLOSED_SPLIT |
| `BillRefund` | 1920x1080 en | Table 7 reopened, 2 soft drinks removed: balance −325.00 → “Refund cash Rs 325.00” only; the pad offers Cash back only (kiosk 1920×1080) | `.b5-due.refund .b5-dir.back .ol.struck` | AddPayment { direction: out, amount_minor: 32500 } |
| `BillClosed` | 1920x1080 en | After Close: “Closed · Invoice AC1-S000123 · Rs 5,996.00”, receipt printed on Counter, fiscal number pending; Reprint receipt, Reopen, Done (kiosk 1920×1080) | `.b5-done .b5-pr.c-ok .b5-kv` | CloseSplit → { invoice_ref, fiscal_state: pending, receipt job } |
| `BillOffline` | 1920x1080 en | Hub down: last view kept “as of 1:38 PM”; pad, Close and every sheet “Needs the hub” (kiosk 1920×1080) | `.b5-off .b5-needshub` | — |
| `BillErrors` | 1920x1080 en | Component: the inline .msg for every bill error code (kiosk 1920×1080) | `.msg .b5-ferr` | 05 §9 codes |
| `BillReadOnly` | 1280x800 en | take-order only (Bilal): lines, total if cash / by card, Print check bill; no pad, no Close, no sheets (tablet 1280×800) | `.b5-t (read only)` | GET /queries/bill (take-order) · PrintCheckBill |
| `BillTablet` | 1280x800 en | Main state at 1280 — lines left, money right (no rail) (tablet 1280×800) | `.b5-t` | GET /queries/bill |
| `BillPortrait` | 800x1280 en | Main state at 800×1280: header, lines (scroll), totals + dues, modes, Close (tablet portrait 800×1280) | `.b5-col` | GET /queries/bill |
| `BillPhone` | 390x844 en | Hamza at Table 9 (own table): lines collapse to “5 items · Show lines”; pad below; Close pinned (phone 390×844) | `.b5-ph .b5-showlines` | GET /queries/bill (take-payment own_tables) |
| `BillUrdu` | 1920x1080 ur | Main state in Urdu (RTL); amounts, rates, times and table code LTR (kiosk 1920×1080) | `.b5-k (rtl)` | GET /queries/bill |

## 05-D01

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `SplitItems` | 1920x1080 en | By items, Table 7 into 2: split 1 Karahi + 3 Naan + 1 Raita; split 2 the rest; every unit placed (kiosk 1920×1080) | `.b5-scols .b5-scol .b5-su` | SetSplits { mode: items } |
| `SplitAmount` | 1920x1080 en | By amount: shares of the cash total 6,624.00 → 4,000.00 + 2,624.00, 0.00 left (kiosk 1920×1080) | `.b5-share .b5-sum` | SetSplits { mode: amount, shares_minor[] } |
| `SplitEqual` | 1920x1080 en | Equally in 2: each split cash 3,312.00 / card 2,998.00 (server values) (kiosk 1920×1080) | `.b5-stepper .b5-eqc` | SetSplits { mode: equal, n: 2 } |
| `SplitLocked` | 1920x1080 en | After the first close: split 1 locked with its invoice; split 2 has a payment (keeps its number); BILL_HAS_PAYMENTS message; New line (kiosk 1920×1080) | `.b5-scol.lockd .b5-su.lk` | SetSplits → BILL_HAS_PAYMENTS { split_nos } |
| `SplitInvalid` | 1920x1080 en | BILL_SPLIT_INVALID units_missing: unplaced items shown first; Save names the missing step (kiosk 1920×1080) | `.b5-scol.pool .b5-su.err` | SetSplits → BILL_SPLIT_INVALID { reason } |
| `SplitPortrait` | 800x1280 en | Split editor as a bottom sheet at 800×1280 (Equally, 2) (tablet portrait 800×1280) | `.scrim--sheet` | SetSplits |

## 05-D02

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `Discount` | 1920x1080 en | 10 % · Regular customer; the grant needs approval → “Ask for approval” with the Needs approval tag (kiosk 1920×1080) | `.b5-seg .b5-chips .b5-note-in .ntag` | ApplyDiscount { kind: percent, value: 1000, reason_code } → { pending: { alert_id } } / { applied: Totals } |
| `DiscountWaiting` | 1920x1080 en | Pending: the 01d requester card in the sheet’s place; Close blocked by DISCOUNT_PENDING (kiosk 1920×1080) | `.b5-wait (01d requester card)` | GET /queries/bill → open_requests[{ kind: discount }] |
| `DiscountPhone` | 390x844 en | Discount as a bottom sheet on Hamza’s phone (phone 390×844) | `.scrim--sheet .b5-chips.c2` | ApplyDiscount |

## 05-D03

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `ServiceChargeRemove` | 1920x1080 en | Remove service charge on T4 + T5 (5 % · Rs 150.00): reason Service complaint; needs approval (kiosk 1920×1080) | `.b5-chips.c2 .facts` | RemoveServiceCharge { reason_code, note? } |
| `ServiceChargeWaiting` | 1920x1080 en | Pending removal (requester card); plus the row states “removed · Add back” (kiosk 1920×1080) | `.b5-wait .b5-tr.gone` | ApplyServiceCharge { note? } (Add back) |

## 05-D04

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `Buyer` | 1920x1080 en | Family 2 over Rs 50,000: name “Sample Traders”, CNIC, fake value 00000-0000000-0 only while typing; “Customer refuses” needs approval (kiosk 1920×1080) | `.b5-in.text .b5-chips.c2 .b5-what` | CloseSplit { buyer: { name, tax_id: { type, value } } } · WaiveBuyerId |
| `BuyerWaiveWaiting` | 1920x1080 en | “Customer refuses” pending approval (requester card); the buyer row’s three results (kiosk 1920×1080) | `.b5-wait .b5-ban` | WaiveBuyerId → { pending } / allowed / { changed: false, reason: not_required } |
| `BuyerUrdu` | 1920x1080 ur | Buyer sheet in Urdu; the ID value and the type labels stay LTR (kiosk 1920×1080) | `.b5-in.text (rtl)` | CloseSplit.buyer |

## 05-D05

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `Reopen` | 1920x1080 en | Reopen a closed bill: reason Wrong payment type, what happens; needs approval (kiosk 1920×1080) | `.b5-chips .b5-what .facts` | ReopenBill { reason_code, note? } |
| `ReopenWaiting` | 1920x1080 en | Reopen pending (requester card); the bill stays closed until it is approved (kiosk 1920×1080) | `.b5-wait` | ReopenBill → { pending: { alert_id } } |
| `ReopenCorrections` | 1920x1080 en | Reopened (corrections only): credit AC1-C000017 Rs 5,996.00 printing; payment carried over; Close issues a new invoice (kiosk 1920×1080) | `.b5-ban.c-ok .b5-pr.c-info` | ReopenBill → { reopened: { mode: corrections, credits[] } } |
| `ReopenNotSupported` | 1920x1080 en | BILL_REOPEN_NOT_SUPPORTED (and the other reopen refusals) (kiosk 1920×1080) | `.msg.c-danger` | ReopenBill → BILL_REOPEN_NOT_SUPPORTED |

## 05-D06

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `RemoveComp` | 1280x800 en | Remove comp on a tablet bill: Paye “1 of 2”, Comped by mistake; needs approval (tablet 1280×800) | `.b5-stepper .b5-tg.comp` | RemoveComp { units: 1, reason_code } → { removed } / { pending } |
| `RemoveCompWaiting` | 1280x800 en | Remove comp pending (requester card) + result and refusal copy (tablet 1280×800) | `.b5-wait` | RemoveComp → { pending: { alert_id } } |

## 05-D07

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `RemovePayment` | 1920x1080 en | Remove Sana’s card payment Rs 3,000.00 · Wrong amount (not approvable) (kiosk 1920×1080) | `.b5-pay .b5-chips.c2` | RemovePayment { payment_id, reason_code, note? } |
| `RemovePaymentShiftClosed` | 1920x1080 en | SHIFT_NOT_OPEN payment_shift_closed: the payment can’t be removed; give the money back from today’s shift (kiosk 1920×1080) | `.msg.c-warn` | RemovePayment → SHIFT_NOT_OPEN { reason: payment_shift_closed } |

## 05-C02

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `PrintStatus` | 1920x1080 en | Component: each document kind in every print state, incl. the 10 s wait with Print to (kiosk 1920×1080) | `.b5-pr (c-info / c-ok / c-danger / c-mute)` | bill.prints[] { doc_kind, state, printer_name, last_error } |
| `PrintTo` | 1920x1080 en | Receipt failed on Counter (Out of paper) → Print to → pick First floor bill. 05 v1.0.5 §6.23a (G-28) (kiosk 1920×1080) | `.b5-chip (printer picker)` | GET /queries/bill-printers · RetargetBillPrint |
| `PrintToPhone` | 390x844 en | Hamza’s check bill for Table 9 failed on First floor bill → Print to as a bottom sheet → Counter (phone 390×844) | `.scrim--sheet .b5-chip` | GET /queries/bill-printers · RetargetBillPrint (take-order) |

## 05-S03

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `ShiftOpen` | 1920x1080 en | Sana opens her shift: starting cash Rs 5,000.00, drawer on (cashier kiosk default, Q-9); toast after: “Shift open · drawer opened” (kiosk 1920×1080) | `.b5-card .b5-in.focus .b5-chip (switch)` | OpenShift { float_minor: 500000, as_drawer: true } |
| `ShiftOpenErrors` | 1920x1080 en | Component: every Open shift refusal inline (kiosk 1920×1080) | `.msg` | OpenShift errors |
| `ShiftOpenPhone` | 390x844 en | Hamza on the phone: float 0, no drawer switch (a phone can’t hold a drawer) (phone 390×844) | `.b5-ph` | OpenShift { float_minor: 0, as_drawer: false } |

## 05-S04

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `ShiftClose` | 1920x1080 en | Close my shift, in the spec’s order: card / online totals first (with who took them), cash as a count only, petty and open advances, then the blind count (kiosk 1920×1080) | `.b5-tk .b5-tk.blind .b5-by .b5-adv .b5-countbox` | GET /queries/shift · CountShift { counted_minor: 4825000 } |
| `ShiftCountResult` | 1920x1080 en | After Count and close: Expected 48,500.00 · Counted 48,250.00 · Short Rs 250.00 (over the Rs 100 threshold, warn); shift closed, drawer free (kiosk 1920×1080) | `.b5-res .var` | CountShift → { closed, expected_minor, variance_minor, sign_off } |
| `ShiftVariancePending` | 1920x1080 en | sign_off not null → “Variance sent for sign-off (pending); the drawer is free” — the shift does not wait; tones for over / exact shown below (kiosk 1920×1080) | `.b5-wait .b5-res .var` | CountShift → sign_off { alert_id } |
| `ShiftSkip` | 1920x1080 en | skip-blind-count: inline confirm with an optional note → “Shift closed without a count” (kiosk 1920×1080) | `.b5-what (inline confirm)` | CloseShift { skip_count: true, note? } |
| `ShiftHandover` | 1920x1080 en | Drawer shift: Count at handover, typed 31,200.00; expected still hidden (kiosk 1920×1080) | `.b5-countbox` | HandoverCount { counted_minor: 3120000 } |
| `ShiftHandoverResult` | 1920x1080 en | Handover result: expected and variance of that count only; shift stays open; past handover counts listed (kiosk 1920×1080) | `.b5-res` | HandoverCount → { expected_minor, variance_minor } |
| `ShiftOther` | 1280x800 en | Imran closes Usman’s shift from day close (close-shift-for-others); same blind order (tablet 1280×800) | `.b5-countbox` | GET /queries/shift?shift_id · CountShift |
| `ShiftPhone` | 390x844 en | Hamza’s own shift (no drawer): takings by mode, cash payment count, count field, Count and close (phone 390×844) | `.b5-ph .b5-tk` | GET /queries/shift · CountShift |
| `ShiftUrdu` | 1920x1080 ur | ShiftClose in Urdu (RTL; amounts and times LTR) (kiosk 1920×1080) | `.b5-tk (rtl)` | GET /queries/shift |

## 05-D08

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `Petty` | 1920x1080 en | Cash out Rs 600.00 · Supplies · under the limit → Record (drawer opens; toast “Recorded · drawer opened”) (kiosk 1920×1080) | `.b5-seg .b5-chips.c4 .b5-limit` | RecordPettyCash { kind: out, amount_minor: 60000, category_id, paid_to? } |
| `PettyAdvance` | 1920x1080 en | Advance Rs 1,000.00 to Ali (staff from the sign-in roster, Q-12) · Staff food (kiosk 1920×1080) | `.b5-chip (staff)` | RecordPettyCash { kind: advance, advance_staff_id } |
| `PettyWaiting` | 1920x1080 en | Rs 6,500.00 over the Rs 5,000 limit → Ask for approval → waiting card; approval asks the requester to open the drawer (kiosk 1920×1080) | `.b5-wait .ntag` | RecordPettyCash → { pending: { alert_id } } |
| `PettyAdvances` | 1920x1080 en | Open advances: Ali Rs 1,000.00 · 2 h ago · Settle; Bilal Rs 500.00 · yesterday (kiosk 1920×1080) | `.b5-adv` | GET /queries/shift → petty[] (advance, settled: false) |
| `PettySettle` | 1920x1080 en | Settle Ali’s Rs 1,000.00: spent 760.00, returned 200.00 → the hub answers PETTY_SETTLE_MISMATCH, shown inline (no client running sum) (kiosk 1920×1080) | `.msg.c-danger` | SettlePettyAdvance { spent_minor, returned_minor } → PETTY_SETTLE_MISMATCH |
| `PettyUrdu` | 1920x1080 ur | Petty cash (cash out) in Urdu (kiosk 1920×1080) | `.b5-seg (rtl)` | RecordPettyCash |

## 05-D09

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `Drawer` | 1920x1080 en | Open cash drawer (no sale): reason + note → toast “Drawer opened” (kiosk 1920×1080) | `.b5-chips` | OpenCashDrawer { reason_code, note? } |

## 05-S05

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `DayClose` | 1280x800 en | Start: “Close the day for Gulberg · Thu 19 Nov”, what happens, the check order, one primary Close day (tablet 1280×800) | `.b5-dc .b5-dcard .b5-guard` | CloseBusinessDay (01a) |
| `DayCloseVoids` | 1280x800 en | Refused: 4 void requests still open (04’s list and copy, “and N more”) → answer them first (tablet 1280×800) | `.b5-blk .b5-br .b5-more` | 409 DAY_CLOSE_BLOCKED { reason: void_pending, voids[], count } |
| `DayCloseShifts` | 1280x800 en | Refused: 2 shifts are still open → Close this shift opens that shift’s close (blind count for the closer) (tablet 1280×800) | `.b5-br` | 409 DAY_CLOSE_BLOCKED { reason: shift_open, shifts[] } |
| `DayCloseUnbilled` | 1280x800 en | Refused: 3 orders are not billed → tick rows → Carry over, or open the bill (tablet 1280×800) | `.b5-tick .b5-br.sel` | 409 DAY_CLOSE_BLOCKED { reason: unbilled_orders, orders[] } |
| `CarryOver` | 1280x800 en | Carry over 2 ticked orders: reason + note → rows leave the list, “Carried to tomorrow” (tablet 1280×800) | `.b5-kv .b5-chips` | CarryOverOrders { order_ids, reason_code, note? } |
| `DayCloseDone` | 1280x800 en | Success: “Day closed · Z 0043” — number and content read from GET /queries/z-reports?business_date after the close (not from CloseBusinessDay); Print again → print status (tablet 1280×800) | `.b5-blk .b5-kpi .b5-rc` | CloseBusinessDay → then GET /queries/z-reports?business_date=2026-11-19 · PrintReport { doc: z_report, ref_id } |
| `DayCloseKiosk` | 1920x1080 en | DayCloseShifts at 1920 on the cashier kiosk (manager signed in) (kiosk 1920×1080) | `.b5-dc` | 409 DAY_CLOSE_BLOCKED shift_open |
| `DayCloseUrdu` | 1280x800 ur | DayCloseShifts in Urdu (tablet 1280×800) | `.b5-dc (rtl)` | 409 DAY_CLOSE_BLOCKED |

## 05-S06

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `XReport` | 1920x1080 en | Today (X) any time: sales with tax by class and rate, rounding apart, credits and net after credits, payments by mode, shifts with sign-off state, fiscal with Retry fiscal now, open bills (kiosk 1920×1080) | `.b5-kpis .b5-rc .b5-rr .b5-rr.rnd` | GET /queries/x-report · PrintReport { doc: x_report } · RetryFiscalNow |
| `ZList` | 1920x1080 en | Z reports, newest first (cursor paging); the selected Z’s summary beside it (kiosk 1920×1080) | `.b5-zl` | GET /queries/z-reports?cursor&limit |
| `ZReport` | 1920x1080 en | One Z (0042): same sections as X plus per-shift sign-off states, sign-offs recorded, pending sign-offs, carried forward; Print (kiosk 1920×1080) | `.b5-rc` | GET /queries/z-reports (one) · PrintReport { doc: z_report, ref_id } |
| `ReportsTablet` | 1280x800 en | X at 1280 on the manager tablet (lower cards scroll) (tablet 1280×800) | `.b5-kpis .b5-rc` | GET /queries/x-report |

## 05-N01

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `AnswerDiscount` | 1280x800 en | Discount: answer sheet (01d D01) — kind, identifier, amount, reason, requester, waiting; Approve / Reject go through the 01d PIN step (tablet 1280×800) | `01d .ac .dlg .facts .acts` | alert kind discount · details { amount, reason, identifier } · needs_pin: always |

## 05-N02

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `AnswerServiceCharge` | 1280x800 en | Remove service charge: answer sheet (01d D01) — kind, identifier, amount, reason, requester, waiting; Approve / Reject go through the 01d PIN step (tablet 1280×800) | `01d .ac .dlg .facts .acts` | alert kind remove_service_charge · details { amount, reason, identifier } · needs_pin: always |

## 05-N03

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `AnswerReopen` | 1280x800 en | Reopen bill: answer sheet (01d D01) — kind, identifier, amount, reason, requester, waiting; Approve / Reject go through the 01d PIN step (tablet 1280×800) | `01d .ac .dlg .facts .acts` | alert kind reopen_bill · details { amount, reason, identifier } · needs_pin: always |

## 05-N04

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `AnswerRemoveComp` | 1280x800 en | Remove comp: answer sheet (01d D01) — kind, identifier, amount, reason, requester, waiting; Approve / Reject go through the 01d PIN step (tablet 1280×800) | `01d .ac .dlg .facts .acts` | alert kind remove_comp · details { amount, reason, identifier } · needs_pin: always |

## 05-N05

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `AnswerBuyerWaiver` | 1280x800 en | Close without buyer details: answer sheet (01d D01) — kind, identifier, amount, reason, requester, waiting; Approve / Reject go through the 01d PIN step (tablet 1280×800) | `01d .ac .dlg .facts .acts` | alert kind close_without_buyer_id · details { amount, reason, identifier } · needs_pin: always |

## 05-N06

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `AnswerPetty` | 1280x800 en | Petty cash: answer sheet (01d D01) — kind, identifier, amount, reason, requester, waiting; Approve / Reject go through the 01d PIN step (tablet 1280×800) | `01d .ac .dlg .facts .acts` | alert kind petty_cash · details { amount, reason, identifier } · needs_pin: always |

## 05-N07

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `AnswerVariance` | 1280x800 en | Shift variance: answer sheet (01d D01) — kind, identifier, amount, reason, requester, waiting; Approve / Dispute go through the 01d PIN step (tablet 1280×800) | `01d .ac .dlg .facts .acts` | alert kind shift_variance · details { amount, reason, identifier } · needs_pin: always |

## 05-N09

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `Cards05` | 1280x1640 en | Every 05 kind’s card (approver), reminder / escalated, requester waiting cards, the fiscal stuck notice, lock lines (tablet 1280×800) | `01d .ac .fam .atag · .b5-wait` | alert.<kind>.card / .lock |
| `Answers05States` | 1280x1000 en | Approved / rejected / withdrawn / can no longer apply / closed obsolete (bill, day, shift); approver errors (tablet 1280×800) | `.b5-ban (01d N04 / B04 look)` | alerts.closed.* · answer.no_longer |
| `AnswerKiosk05` | 1920x1080 en | Discount on the kiosk answer sheet (Imran at the counter); PIN step is 01d’s (kiosk 1920×1080) | `01d .dlg` | alert discount |
| `AnswerPhone05` | 390x844 en | Requester’s result on Hamza’s phone: “Approved by Imran 1:44 PM”, totals refreshed (phone 390×844) | `.b5-ban.c-ok (N04)` | alert result |
| `AnswerUrdu05` | 1280x800 ur | AnswerDiscount in Urdu (RTL; amount, time, table code LTR) (tablet 1280×800) | `01d .dlg (rtl)` | alert discount |

## 05-X01

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `TableBillStates` | 1280x800 en | Tiles: Bill asked, check bill printed mark, To clean after close, new order after close, Reopened mark, both marks together (02a v1.1.9 MapTile) (tablet 1280×800) | `02a .tt + .b5-tg` | 02a v1.1.9 table-map MapTile { reopened, check_printed_at } · TableMarksChanged |

## 05-X02

| Frame | Size | State | Components | API |
|---|---|---|---|---|
| `TableSheetBill` | 1280x800 en | Table sheet: Bill action (take-payment → bill screen; take-order → read-only), check bill printed line, corrections-only reopen line (tablet 1280×800) | `02a .tv + Bill action` | GET /queries/bill (from seating_id) |
| `TableSheetBillPhone` | 390x844 en | Phone table sheet: Bill action for Hamza’s own table (take-payment own_tables) (phone 390×844) | `.scrim--sheet` | GET /queries/bill |
