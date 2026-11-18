# 05 Billing — Module Spec

| | |
|---|---|
| Module | 05 Billing (hub; cloud settings carried by 01a / 01b rows) |
| Version | **v0.1 DRAFT — awaiting owner review** (developer, 2026-11-17, from G0 + G1; not hostile-reviewed yet) |
| Inherits | Shared Standards from **Foundation v1.13** §6 (envelope, errors, hub HTTP, WS, list cursor, naming, tests, migrations, folders); not redefined here. v1.14 (row F-1…F-5) changes no §6 standard; it appends 05's §9 codes |
| Depends on | Foundation v1.13; 00 Hub Platform v1.11 (DRAFT on `main`; 05 needs only what v1.10.1 has, plus row H-1…H-4); 01a v2.5.1; 01b v1.9.1; 01c v1.1.2 (`allocateDealMinor`, deal / option money); 01d v1.2.5; 02a v1.1.6; 02b v1.0.14; 03a v1.2.4 (read-only: `stockEffects` order at day close, return lines never billed); 03c v1.0.10; 04 v1.0.3 (`pendingVoids`, `VOID_KIND`, `registerAuditAction`, `staff_names`, day-close void guard). 04 v1.0.4 / v1.0.5 (client and text only, on `module-04-client`) change nothing 05 reads |
| Read by | 06 (synced money events, cloud shift / Z history), 07 (sales reports, live money view, D22 tiles), 10 (vendor payments stay out of petty cash) |
| Stories | `docs/stories/05-g0.md` (stories 1–11, carried rows, K-1…K-18, G0-1…G0-10); **`docs/stories/05-g1-decisions.md` overrides G0 wherever they differ** (Q1–Q18, K rulings, G1-1…G1-16, A1–A7, M-1…M-15); `docs/stories/05-fiscal-research.md` |
| Branch | `spec-05` on `origin/main` @ `ea0ee00` |

### Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-17 | First draft from G0 + G1 ("go spec"). Owner questions OQ-1…OQ-8, authority questions A1…A10 and STOP items S-1…S-8 in §12.3. §4.5 rows are **proposed**; they are applied by 05's phase 0 after approval (04 precedent), never by editing a merged spec now. |

---

## §1. Header

### 1.1 Stories covered

- **E8** (P1): payments at checkout (mixed modes, change, manual card / online amounts, R7); split bill (by items, by amount, equally into N, each split paid and printed on its own; M-1); tax invoice (tax by class with its rate, NTN, total incl. tax; one class per line, never stacked, G1-15); Z report on the hub; blind count; cashier shifts and petty cash.
- **E0** "Payments at checkout" AC1, 2, 4–6 (AC7 dropped, K-7); "Refunds, cancellations, complimentary items" (a refund after close = **reopen + credit invoice**, Q8; comp removal before billing, Q7; walk-out = 04 void, Q12); "Cashier shifts, day open / close, petty cash, Z report" (AC1–AC7; AC8 day reopen **not built**, Q11); "Receipt and ticket templates" (fixed layout with owner-edited parts, K-12); "Printers, cash drawer" (drawer kick, no-sale open).
- **E3** counter receipt AC1–3; **E6** permissions AC2 (billing permissions, K-13); audit AC2 for billing actions (04 `registerAuditAction`).
- **D8, D9, D11, D21, D39, D47, D58** as narrowed by README R7, R12, R13 (amended by R37, §4.5 row R-1), R20.
- **Fiscal** (owner direction 2026-11-17, G1-16): fiscal adapter port with an adapter per authority, PRA live from day 1 on the POS floor.
- Carried rows: README :183, :191, :202, :203, :214, :226, :240, :243, :246; 02b §4.3 To 05, §12.3 Q2; 03c §4.3 To 05; 04 §4.3 To 05, G-8; OPEN-QUESTIONS 02a-N3, 02b AD-5; F §3.5, §4.6, §7 OQ15 (§4.6 lists where each lands).

### 1.2 In scope (hub)

Bills per seating (dine-in) or per order (takeaway / parking); splits (items / amount / equal); discount on the bill or one open split with reason and approval; sticky service charge (applied once by rule, removable with reason and approval, re-added only by hand); tax at payment from the authority rate table (payment class, mixed-class rule), rounding once per split; payments in any owner mode with tendered amount and change; close per split → invoice (gap-free number), at the last split `OrdersBilled` + `BillClosed`; check bill (provisional print, no number, no fiscal call); request-bill print at the floor / zone bill printer with a run-time "Print to" target; reopen a closed bill (credit invoice + new invoice at the next close); remove a comp on an unbilled line (approval); buyer name + CNIC / NTN above the authority threshold or an approved waiver; shifts per person (float, taken-by vs drawer shift, optional handover count, blind count, variance approval); petty cash (advance + settle, cash out, cash in, categories, limit approval); drawer no-sale open; carry-over of unbilled orders; day-close guards and the Z appender; X and Z reports; fiscal port, adapters `none` and `PRA`, the durable fiscal outbox and its worker, fiscal status and the stuck-outbox alert; receipt / check-bill / credit-note / Z `Doc` builders in `@pos/domain`.

### 1.3 Out of scope

Refund without reopen (`apply-refund` stays in the catalogue, unused; Q8). Business-day reopen (Q11). Tips (Q5). Line discounts (Q6). Card-terminal or wallet integration and reconciliation (R7, P2). Khata / customer credit, delivery charge and rider cash (P2; the sticky-charge rule already covers a delivery charge, G1-14). Raast payment QR (G1-11). Logo on the receipt (K-12). Sales by item / hour / staff, live money view, D22 tiles, cloud shift and Z history (07 / 06, K-9, Q14). Adapters SRB, KPRA, BRA, FBR-ICT (milestone C, K-14 / R37). Splitting a sale to stay under the buyer-ID threshold (**never built**, Q18). Vendor payments / payables (module 10). Training mode. Bill-photo upload for petty-cash settle (G1 Q15, deferred). Any change to how 02b prices a line or 04 voids one.

### 1.4 Decisions log

| ID | Decision | Source |
|---|---|---|
| B1 | **One bill per seating (dine-in) or per order (takeaway / parking).** A bill is created by the first 05 command that touches it (`BillOpened` + `ChargeApplied`); until then every read shows the bill **projected** from 02b and the rule (same numbers). Its orders are, while open, the seating's live orders (02a `seating_orders` read at command / query time, merges and splits followed) or the one order; at the first close they are frozen in `bill_orders`. | K-1, K-3, G0 story 1 |
| B2 | **Splits are parts of the bill** (`items`, `amount`, `equal`). No split plan = one split (`split_no 1`). Each split holds 1..n payments, closes on its own into **one invoice** with its own number, tax, rounding, receipt; the bill closes at its last split: `OrdersBilled { order_ids, bill_id }` (02b) and, for dine-in, `BillClosed { seating_id }` (02a stream `table`) **once**, in that transaction. | K-1, K-3, M-1, G1-2 |
| B3 | **05 never writes 02b's ledger** (G0-2): line money is 02b `orderLines` (`billed_minor`) minus 04 `pendingVoids(…).refund_minor`; 05 owns only bill-level money. A line with `return_of` is never billed (03a §3.8a: its money is 0 already). | G0-2, 04 To 05, 03a To 05 |
| B4 | **Tax is never chosen at the bill.** Each line has exactly one `tax_class_id` (copied from `ItemAdded`, row Q-1, K-4); a deal line is taxed under the deal's class on its billed amount, an option child under its own; never from `allocated_price_minor`. Two classes are never added on one line; the checkout has **no tax buttons**. | G1-15, K-4, README :214 |
| B5 | **The rate comes from the authority rate table at payment / close** (row A-1): key (authority, tax class → fiscal category, payment class `cash` / `digital`, integration status, `effective_from` ≤ issue date), each row with its notification ref; owner overrides per tax class win over the seeded catalog. Adapter `none` uses `tax_classes[].rate_bp`. Choosing / switching a payment mode recomputes tax and total on the same screen. | K-15, Q16, M-7 |
| B6 | **Mixed payment classes inside one split:** rule per authority as data, `higher_rate` (default: the cash rate on the whole split) or `pro_rata` (digital amount entered first; §3.6). | Q4, G1-5, A6 |
| B7 | **Discount before tax, on the bill or one open split**, amount or percent, owner reason buttons + note for `other`; `apply-discount` grant (approval per grant, 01d kind `discount`); spread over the target's lines pro rata with `allocateDealMinor`; close refused while a discount request on the bill is open (`409 DISCOUNT_PENDING`). | Q6, G0-5, G0-6, M-9, OQ-4 |
| B8 | **Charges are sticky.** The service charge rate of the order type is written once at bill creation (`ChargeApplied { source: 'rule' }`); `RemoveServiceCharge` (approvable, reason) writes `ChargeRemoved`; no read, print, split, merge, move or reopen recomputes it from the rule; re-adding is an explicit `ApplyServiceCharge` (audited). | Q5, G1-14, M-3 |
| B9 | **Rounding once per split total** to the branch step (default Rs 1 = 100 paisa, method `nearest`, half up), printed as its own line. All arithmetic in integers (BigInt where products can pass 2^53), rounding half up at each named point only (§3.5). | D47, M-5 |
| B10 | **Payments** `{ mode_id, amount_minor, tendered_minor?, reference?, taken_by_staff_id, shift_id }`; any mode always available (K-7), reference required per mode (data); cash may be tendered above the balance → change at close; non-cash never above the balance; removable before close (`take-payment`, reason, audited). | G1-2, K-7, M-6 |
| B11 | **Taken-by vs shift.** `taken_by_staff_id` = the signed-in person; `shift_id` = the shift whose money it is: on a device that is a **drawer** (has an open drawer shift) every payment lands in that drawer's shift, whoever takes it; on any other device the taker's own open shift. Cash on a device with no drawer shift and no own cash shift → `409 SHIFT_NOT_OPEN`. | Q9, Q10, G1-6, README :183 |
| B12 | **Close is online-only** (never device-queued), checked in one `BEGIN IMMEDIATE` transaction: pending void (04), pending weight (`live_units > 0`), open discount request, unassigned lines (item split), balance ≠ 0, buyer ID, screen total stale (`expected_total_minor`). Printer and internet are never on the close path. | G0-1, D11, 01c V18, R8, E5 AC1 |
| B13 | **Invoice numbers** are hub-assigned, per branch, gap-free, continuous across days, two series: `sale` and `credit` (G1-3). Assigned inside the close / reopen transaction as `MAX + 1` of the series (single writer, D45). | G0-3, G1-3 |
| B14 | **Reopen** (`ReopenBill`, `reopen-bill`, approvable, reason): one `InvoiceCredited` per sale invoice of the bill (credit series, fiscal outbox ordered behind its original), 02b `OrdersUnbilled` (row Q-2, OQ-1), every split open again with its payments; the next close of each split issues a **new** invoice number. A business day is never reopened; a bill from an earlier day may be reopened and its credit and new invoice count in **today's** Z. `BillClosed` is never written twice (a re-close of a dine-in bill writes none). | Q8, Q11, G1-3 |
| B15 | **Partly paid bill is frozen.** From the first closed split until the bill closes, 02b `RemoveItems` / `CompLine` / `SetLineWeight` and 04 `VoidItems` on the bill's orders are refused (`409 BILL_PARTLY_PAID`, line guard, rows Q-3, V-1); a fix is a reopen. New rounds (dine-in) still join the open splits. | OQ-6, G0-4 |
| B16 | **Takeaway / parking close any time after the first Send** (the order exists): before the food, after it, or when a phone customer arrives. After close, 02b / 04 refuse edits (`ORDER_BILLED`); a later problem is a reopen. | Q2, G1-4 |
| B17 | **Check bill** = a print, not a money event: built from the live bill by a pure `Doc` builder; banner `PROVISIONAL - NOT A TAX INVOICE`; never an invoice number, fiscal number or QR; total at the **default payment class** (cash) stated on the slip; one `CheckBillPrinted` event (audit, ids and counts). `RequestBill` (02a) prints it at the bill printer of the table's zone / floor; no 01d notice, no push to the cashier; the cashier's open-bills list shows "check bill printed" as a pulled status. | G1-1, G1-10, Q2, Q13 |
| B18 | **Print to.** A bill document whose job fails or waits (03c status) can be re-targeted at run time to another printer (`RetargetBillPrint`, 03c row P-2): the pending job moves; nothing prints twice. | G1-10, Q13 |
| B19 | **Buyer ID on the whole bill.** Threshold per authority as data (PRA Rs 50,000 = 5 000 000 paisa, pre-tax, after discount), checked on the **whole bill's** net (every split, closed or not, incl. after a reopen), never per split. Above it each split's close needs `{ buyer_name, buyer_id_number }` or an approved waiver (`WaiveBuyerId`, `close-without-buyer-id`, approvable) → invoice `buyer_id_refused = true`. The ID number lives **only** in the hub table `invoice_buyers` read by the adapter and the receipt builder: never in an event, a log line, an alert, an audit row, the Z or a response. **No feature splits a sale to stay under the threshold.** | Q18, G1-9, A7 |
| B20 | **Fiscal port.** `FiscalAdapter { key, submit(invoice), health() }` (credits go through `submit` with `invoice_type: 'credit'`); registered at startup by key (`none`, `PRA` in the pilot); the branch setting picks one; the hub posts directly over HTTPS from the branch internet (K-16). Every sale / credit invoice of a fiscalized order type gets one `fiscal_outbox` row in its transaction; the worker sends in invoice order, at least once, with the invoice's own id (USIN); the answer is an event (`FiscalNumberAssigned`), so receipts and reprints read it from the log. | K-14, K-16, K-17, G0-10, G1-12, G1-16 |
| B21 | **Offline / catch-up.** Close never waits for the authority. A receipt printed before the answer shows the local invoice number + **"FISCAL NUMBER PENDING"** + date / time (A2 default); a reprint after the answer shows the fiscal number and QR. Catch-up window per authority as data (PRA 7 days, r.8(3)); a row older than `stuck_after_ms` (data, default 30 min) or past half the window raises the 01d `fiscal_outbox_stuck` alert to managers (r.8(1) report is theirs). | K-17, A2 |
| B22 | **POS ID** per hub by default, optional per-device mapping (device → POS ID) in the branch fiscal settings; the token per POS ID is a **hub secret** in the hub config file (row H-2), never in the repo, the spec, the cloud, an event or a log. | K-18, A1, G1-12, OQ-3 |
| B23 | **Shift per person.** `OpenShift` (float, 0 allowed); a drawer device holds at most one open shift; blind count server-enforced (no response carries `expected_minor` before the shift's `ShiftCounted`); variance above the branch threshold → 01d `shift_variance` request, the shift closes on approve; `skip-blind-count` (Owner by default) skips the count, always audited; optional `HandoverCount` on a drawer shift (variance recorded, shift stays open). | D21, Q9, Q10, G1-6 |
| B24 | **Petty cash is cash only, on a shift:** advance to a named staff member (open until settled: spent + change returned), direct cash-out (category, paid to, note), cash in; categories owner-edited; above the branch limit, or with a `requires_approval` grant → 01d `petty_cash` request. | Q15, G1-8 |
| B25 | **Day close stays 01a's `CloseBusinessDay`** (rows A-3, A-4): 05 registers guards (open shifts; unbilled, uncancelled, not carried-over orders) and an appender that closes 05's open requests `obsolete` and writes `ZReportIssued` before `BusinessDayClosed`, in the same transaction; the command moves to `close-business-day` and is also offered on the staff app (row H-1). `CarryOverOrders` (manager, reason) lets listed orders survive the close; they bill next day and show on that day's Z. Void requests still block (04). | K-5, Q11, M-8 |
| B26 | **Reports on the hub:** X (the open day, any time) and Z (one closed day) from the same pure builder over 05's projections; Z = Σ sale invoices − Σ credit invoices issued in the day, by payment mode, tax by class, discounts / comps / voids / reopens with requester, approver, method; per shift float / expected / counted / variance; open advances. Sales by item / hour / staff → 07. | Q14, K-9, G0 story 9 |
| B27 | **Remove comp** on an **unbilled** line (`RemoveComp`, `remove-comp`, approvable, reason) → 02b's new `LineCompRemoved` (row Q-4; 02b owns the event and its fold). A billed line's comp changes only through a reopen. | Q7, G1-7 |
| B28 | **Walk-out** = void the unpaid lines through 04 (reason `walk_out`, row V-2), no "unpaid" payment mode. | Q12 |
| B29 | **Receipt template** = a fixed layout with owner-edited header / footer lines, show / hide toggles and variables (`{branch_name}`, `{ntn}`, `{address}`, `{phone}`, `{bill_no}`, `{date}`, `{cashier}`); no logo; preview in the owner app with `renderText` moved to `@pos/domain` (row P-3). | K-12, R12 |
| B30 | **Logs carry ids and counts only** — never names, PINs, phone numbers, CNIC / NTN, tokens, amounts tied to a named person. | owner rule, G1-9 |

---

## §2. Existing architecture that must not change

- **Events** INSERT-only with triggers (F §4.1, D52); every command through 00's registry (`defineCommand`, `approvable`, fixed processing order, `processed_commands`, D32); one command = one transaction; commands over HTTP only.
- **Projections** are events-only read models registered with 00's registry (`register`, `reset`); a rebuild from seq 0 equals live (02a T19, 04 V16). Hub state that is not a projection (print jobs, worker columns) follows 03c's rule: plain statements, never events, never synced.
- **02b** owns order lines, `billed_minor`, comps (`LineComped`, `comp` kind), `OrdersBilled` (schema `{ order_ids, bill_id }`, stream `order`, id = first order id), `billed_at` and `ORDER_BILLED`; **02a** owns seatings, `seating_orders`, `RequestBill` / `BillRequested`, the NEEDS_CLEANING fold on `BillClosed { seating_id }` (stream `table`, `.strict()`); **04** owns voids, `pendingVoids`, the void day-close guard and the audit projection / `AUDIT_ACTIONS`; **03c** owns printers, `print_jobs`, the worker and ESC/POS; **03a** owns `stockEffects` before `BusinessDayClosed` and the day-close checkpoint; **01d** owns the request record, steps, answers, PIN, `approval_receipt`, read-only `apply`; **01b** owns permissions, grants, `default_key`, the branch settings endpoint; **01a** owns the business day commands and events, tax classes and the config snapshot.
- **Money** is integer minor units (`_minor`, D47); IDs are ULIDs; time is `branchNow` (F §4.7).
- **Day close** keeps 01a's command and events, the 04 void guard (`409 DAY_CLOSE_BLOCKED`) and 03a's `stockEffects` before `BusinessDayClosed` as the checkpoint event (03a To 05).
- **Single-slot hooks** (`registerDayCloseGuard`, `registerMergeGuard`, `registerLineGuard`) become ordered lists (rows A-3, T-1, Q-3); 04's registrations keep their place and behaviour.

---

## §3. Domain rules

### 3.1 Words

**Bill** = what one seating (dine-in) or one takeaway / parking order owes. **Split** = one part of a bill paid on its own (`split_no` 1..n). **Line base** = a line's `billed_minor` (02b) minus its `pendingVoids` `refund_minor` (04); a `deal_part` and a return line have base 0; a pending-weight line has base 0 and blocks close. **Payment class** = `cash` | `digital`, from the payment mode (data). **Default class** = `cash` (the class a check bill and an unpaid split show). **Net** = Σ line bases − discount. **Invoice** = the immutable money record of one closed split (`series: 'sale'`) or of a credit (`series: 'credit'`). **Drawer** = a cashier device whose open shift was opened with `as_drawer: true`. **Fiscalized** = the bill's order type has `fiscalize: true` and the branch adapter is not `none`.

### 3.2 Bill state

```
 (projected) ──first 05 command──► OPEN ──first split closes──► PARTLY_PAID ──last split closes──► CLOSED
                                     ▲                                                              │
                                     └──────────────────── ReopenBill (approved) ◄──────────────────┘
                                                            (credits every sale invoice; REOPENED = OPEN with history)
```

| State | Lines editable (02b / 04) | Splits re-plannable | Payments | Merge / split of the seating (02a) |
|---|---|---|---|---|
| projected / OPEN, no payment | yes | yes | add / remove | yes; an absorbed bill folds into the surviving one (§3.9) |
| OPEN with payments | yes | only splits without payments may change or go | add / remove | refused `409 BILL_HAS_PAYMENTS` |
| PARTLY_PAID | **no** (`BILL_PARTLY_PAID`, B15) | no | open splits only | refused |
| CLOSED | no (`ORDER_BILLED`) | no | no | n/a (seating NEEDS_CLEANING) |
| reopened (OPEN, `reopen_count ≥ 1`) | yes, through 02b / 04 | yes for splits without payments | carried payments stay; balance may be negative (pay-out, §3.7) | n/a (no new rounds: a closed seating takes no orders) |

### 3.3 Close preconditions (B12), checked in this order, all in the close transaction

1. Bill exists, state OPEN / PARTLY_PAID (`404 BILL_NOT_FOUND`, `409 BILL_NOT_OPEN`); the split exists and is open.
2. No pending void on the bill's orders (`pendingVoids(db, order_ids)` non-empty) → `409 BILL_CLOSE_BLOCKED { reason: 'void_pending', order_item_ids }`.
3. No pending weight (`live_units > 0` and `line_total_minor IS NULL`, 04 R-4) on a line of the split → `{ reason: 'weight_pending', order_item_ids }`.
4. No open `discount` request on the bill → `409 DISCOUNT_PENDING { alert_id }`.
5. Item split: every bill line unit is in some split; the closing split's lines are live → `{ reason: 'lines_unassigned', order_item_ids }`.
6. Buyer ID (B19): the whole bill's net > threshold → payload `buyer` present, or a `BuyerIdWaived` on the bill → else `409 BUYER_ID_REQUIRED { threshold_minor, net_minor }`.
7. `expected_total_minor` (the total the screen showed) equals the recomputed split total → else `409 BILL_TOTAL_CHANGED { expected_minor, total_minor }` (a void approved, a round added, a rate effective date passed while the cashier looked).
8. Balance: Σ in-payments − Σ out-payments ≥ total and (Σ non-cash ≤ total); change = Σ in − Σ out − total, from cash only (≤ Σ cash tendered) → else `409 BILL_BALANCE_DUE { split_no, balance_minor }`.
9. Cash change needs the closing device's money shift (B11) → else `409 SHIFT_NOT_OPEN`.

Pending **comp** requests on the bill's lines do not block: they are closed `obsolete` in the close transaction (02b To 05).

### 3.4 Line grouping for tax

For each live line of the bill's orders (by `orderLines`), base as §3.1, class = the line's `tax_class_id` (row Q-1): `item` → its own; `deal` → the deal's (on the whole billed deal amount); `deal_part` → none (base 0); `option_child` → its own. A line is taxed only when the branch has `tax_enabled` **and** the line's class is non-null (01a S34). No line is ever in two classes.

### 3.5 Split arithmetic (pure, `@pos/domain/src/billing/compute.ts`)

Per split `s`, given its lines (item split: the assigned units of each line, base pro rata to units with `allocateDealMinor`; amount / equal split: every bill line, base allocated by the split's share with `allocateDealMinor`, remainder to the last split), the discount, the service charge state, the payment classes and the rate table:

1. `S` = Σ line bases of the split.
2. `D` = the split's discount: a bill discount is spread over the open splits by `S` (closed splits keep what they had); percent → `floor(S_total × pct_bp / 10000)` on the bill, then spread; `D ≤ S`. `D` is spread over the split's lines by base (`allocateDealMinor`) → per-class net `N_c`.
3. `SC` = `round_half_up((S − D) × sc_bp / 10000)` when the bill's service charge is applied, else 0. SC is taxed under `service_charge_tax_class_id` (setting; `null` = untaxed, A9) — it joins that class's net.
4. Rates: for each class `c` and class `k ∈ {cash, digital}`, `r(c, k)` from the rate table at the issue date (B5). Split payment class: all payments digital → digital; all cash / none → cash; both → the authority's `mixed_class_rule`: `higher_rate` = cash; `pro_rata` = §3.6.
5. Tax, prices **exclusive**: `T_c = round_half_up(N_c × r / 10000)`; total before rounding `G = Σ N_c + SC + Σ T_c`. Prices **inclusive** (setting): `T_c = N_c − round_half_up(N_c × 10000 / (10000 + r))`; `G = Σ N_c + SC`.
6. Rounding: `R = roundToStep(G, step, method) − G`; total `= G + R`. `R` prints as its own line.
7. Invariants (property tests, §10.3): Σ over splits of `S` = Σ bill line bases; Σ `T_c` printed = Σ invoice tax rows; one rounding per split; no negative line, net, tax or total; `pro_rata` and `higher_rate` give the same result when only one class is paid.

### 3.6 Mixed classes, `pro_rata` (B6)

The cashier enters the digital payment(s) first. With digital amount `d` and the split at the digital rate per class, the digital net share is the largest `N_d ≤ N` whose digital total ≤ `d` (`N_d = floor(d × 10000 / (10000 + r_dig))` for a single class; for several classes `N_d` is spread over the classes by `N_c` with `allocateDealMinor`); the rest `N − N_d` is taxed at the cash rate. The screen shows the new total before cash is taken (M-7). Changing or removing a digital payment recomputes. `higher_rate` ignores the share.

### 3.7 Payments and change (B10, B11)

- `AddPayment` is accepted on an open split with `amount_minor > 0`; `direction: 'in'` normally; `direction: 'out'` only when the split's balance is negative (a reopened bill whose new total is lower than what was paid) and never above that negative balance — money given back from the closer's money shift (cash out of the drawer, or a card / online reversal recorded with a reference).
- Cash `in`: `tendered_minor ≥ amount_minor` optional (absent = exact); at close, change = Σ tendered over the split's cash payments − the cash still needed, attributed to the shift of the split's **last** cash payment. Non-cash `in` never exceeds the split's balance (`422 PAYMENT_EXCEEDS_BALANCE`).
- A mode with `reference_required` → `422 PAYMENT_REFERENCE_REQUIRED` without a 1–60 character reference.
- Expected cash of a shift = float + Σ cash `in` tendered − Σ change attributed − Σ cash `out` + Σ settled-advance change returned − Σ advances − Σ cash-outs + Σ cash-ins (G1-8; property test).

### 3.8 Splits (B2)

- `SetSplits` replaces the split plan of an OPEN bill: `mode: 'items'` (each split lists `{ order_item_id, units }`; a line's units may spread over splits; a deal goes whole; an option child follows its parent), `'amount'` (shares in paisa of the bill total at the default class, ≥ 1 each, Σ = that total; converted to net shares by `allocateDealMinor`), `'equal'` (`n` 2–20). A split with payments keeps its number and plan entry or the command is refused (`409 BILL_HAS_PAYMENTS { split_nos }`, G0-4: no money moves silently). Closed splits are never touched.
- A later round (dine-in) adds lines: item split → unassigned until a `SetSplits` puts them somewhere (close refused, §3.3 rule 5); amount / equal → absorbed by the open splits' shares pro rata.
- The discount (B7) and the service charge (B8) are bill-level and spread per §3.5.
- The buyer-ID threshold reads the **whole bill** (B19); a split never changes it.

### 3.9 Follow 02a merges and splits (02a To 05, G0-4)

- Merge (`TablesMerged`, S2 into S): refused by 05's merge guard (row T-1) while either seating's bill has a payment, a discount, or a closed split (`409 BILL_HAS_PAYMENTS`). Otherwise the fold: S has a bill → S2's bill (if any) is marked `absorbed_into`; S has none → S2's bill is re-pointed to S. A removed service charge stays removed on the surviving bill (B8); the absorbed bill's own state is dropped.
- Seating split (`SeatingSplit`): refused while the source bill has payments, discount or a closed split; otherwise the moved orders leave the bill at the next read (the bill reads `seating_orders` live, B1); an item split plan that names a moved line drops that entry (fold) and the bill needs `SetSplits` again before close.

### 3.10 Reopen (B14)

Allowed on a CLOSED or PARTLY_PAID bill whose orders are not cancelled. Effects, one transaction: `BillReopened` → per closed split, `InvoiceCredited { credit_no, ref_invoice_id }` (credit = the full original: same lines, tax rows, discount, service charge, rounding; payments not reversed) → 02b `OrdersUnbilled { order_ids, bill_id }` when the bill was CLOSED (row Q-2) → every split OPEN again with its payments; the split plan stays. Fiscal: each credit's outbox row is ordered behind its original (an original still pending → the credit waits, B20). After a reopen: lines change through 02b / 04 as usual (voids with approval, comp removal), discount and charges through 05, payments added / removed / paid out (§3.7); the next close of each split issues a new sale invoice. Reopen never reopens the business day; credits and new invoices land in today's Z (the day open now).

### 3.11 Shifts (B23)

```
 (none) ──OpenShift──► OPEN ──CountShift──► COUNTED ──CloseShift──► CLOSED
                         │                     │  variance > threshold → shift_variance request; CLOSED on approve
                         │                     └─ reject → OPEN again (recount)
                         └──CloseShift { skip_count } (skip-blind-count)──► CLOSED (count_skipped)
   HandoverCount (drawer shift, any time while OPEN): count + variance recorded, shift stays OPEN
```

- One open shift per person; a drawer device in at most one open shift (`409 DRAWER_IN_USE`). A shift's money (B11) and its petty cash (B24) are the only inputs to its expected cash (§3.7).
- **Blind count:** `CountShift { counted_minor }` stores the count first; only its response (and later reads) carry `expected_minor` and `variance_minor`. Every read before that returns the shift without them (server rule, tested). A recount after a reject writes a new `ShiftCounted`.
- Open petty-cash advances never block `CloseShift` (G1-8); they are listed on the close screen and on the X / Z.
- Closing another person's shift: `close-shift-for-others` (blind count applies to the closer).
- A takeover on a drawer kiosk (README :183, Q10): the drawer shift stays open and keeps the drawer; the new person takes any mode; every payment lands in the drawer shift with `taken_by_staff_id` = the new person; the shift close and X / Z show the drawer's takings by `taken_by`.

### 3.12 Petty cash (B24)

`RecordPettyCash { kind: 'advance' | 'out' | 'in', amount_minor, category_id, paid_to?, advance_staff_id?, note? }` on the caller's money shift (cash). Advance: `advance_staff_id` required, open until `SettlePettyAdvance { advance_id, spent_minor, returned_minor, note? }` with `spent + returned = amount` (`422`); settling may happen on another shift (the returned cash lands there). Approval: grant `requires_approval` → request every time; grant `allowed` and `amount_minor > petty_cash_limit_minor` → request to the over-limit approvers (§3.14). Vendor khata stays in module 10.

### 3.13 Day close (B25)

`CloseBusinessDay` (01a) after its own checks asks the guard list: 04 (void requests open) then 05 → `409 DAY_CLOSE_BLOCKED` with `reason`:
- `'shift_open'`: `{ shifts: [{ shift_id, staff_name, opened_at, is_drawer }], count }` (≤ 40);
- `'unbilled_orders'`: `{ orders: [{ order_id, identifier, total_minor, placed_at, open_minutes }], count }` (≤ 40): orders with `billed_at IS NULL`, `cancelled_at IS NULL`, not in `carried_orders` for this day.
Then the appender (row A-4) returns, in order: `AlertClosed` drafts (`obsolete`, note `day_closed`) for every open 05 request (`discount`, `remove_service_charge`, `petty_cash`, `shift_variance`, `reopen_bill`, `remove_comp`, `close_without_buyer_id`) and 02b's open `comp` requests (01d To 05) — void requests never reach here (04 guard); then `ZReportIssued`; then 01a appends 03a's `stockEffects` and `BusinessDayClosed`.

### 3.14 Approvals (01d kinds registered by 05)

| Kind | Raised by | Approver roles | `apply` (read-only, every draft carries `alert_id`) |
|---|---|---|---|
| `discount` | `ApplyDiscount` with grant `requires_approval` | the grant's `approver_role_ids` | `DiscountApplied` (re-checks the bill is OPEN and the amount still fits; else throws → answer refused) |
| `remove_service_charge` | `RemoveServiceCharge`, grant `requires_approval` | grant's | `ChargeRemoved` |
| `reopen_bill` | `ReopenBill`, grant `requires_approval` | grant's | `BillReopened` + `InvoiceCredited`… + `OrdersUnbilled` (§3.10; numbers assigned in `apply` from the same read view, B13) |
| `remove_comp` | `RemoveComp`, grant `requires_approval` | grant's | 02b `LineCompRemoved` |
| `close_without_buyer_id` | `WaiveBuyerId`, grant `requires_approval` | grant's | `BuyerIdWaived` |
| `petty_cash` | `RecordPettyCash` (grant `requires_approval`, or over the limit) | grant's, or over-limit approvers | the petty-cash event |
| `shift_variance` | `CloseShift` with `|variance| > variance_threshold_minor` | over-limit approvers | `ShiftClosed { alert_id }` |

Over-limit approvers = the roles whose grant of `close-shift-for-others` is `allowed` at `branch` (01b row B-3, `rolesGranting`, in memory). Steps = `APPROVAL_TIER_STEPS`; `needs_pin: 'always'` (money; 01d `approval_receipt`); approver = `AnswerFacts.answerer_staff_id`, never `actor_id`. `details` carry ids, amounts and reason codes only (never a buyer ID). Withdraw = never asked (`onWithdraw` returns `[]`). Dedupe keys: `discount:<bill_id>`, `remove_sc:<bill_id>`, `reopen:<bill_id>`, `remove_comp:<order_item_id>`, `buyer_waiver:<bill_id>`, `petty:<command_id>`, `variance:<shift_id>`.

### 3.15 Fiscal port and outbox (B20–B22)

```
 CloseSplit / ReopenBill tx ──► InvoiceIssued / InvoiceCredited ──fold──► fiscal_outbox row (state pending, ord = invoice seq)
                                                                                   │
 fiscal worker (after listen, one at a time, oldest ord first, one in flight) ◄────┘
   adapter.submit(record) ── ok {fiscal_number, qr_payload} ──► writer tx: FiscalNumberAssigned (event) → row acked
                          ── retryable (network, 5xx, timeout) ──► attempts+1, next_try_at = backoff (5 s, 30 s, 2 min, then 5 min)
                          ── rejected (4xx, validation) ──► FiscalSubmitRejected (event), row 'rejected', alert; never auto-resent
                          ── duplicate (adapter recognises its USIN already accepted) ──► treated as ok when the adapter returns the number, else 'rejected' (A10)
```

- **Order:** the worker sends the lowest `ord` among `pending` rows whose `next_try_at ≤ now`; a credit row is not sent while its original is not `acked` (it waits; the original's failure does not block other invoices). One request in flight (PRA has no batch API; 200 invoices / rush fit easily).
- **At least once, same id:** the request carries the invoice's own `USIN` (= `invoice_ref`, e.g. `AC1-000123`); a crash between the HTTP answer and the `FiscalNumberAssigned` commit resends the same USIN (test). The outbox row is written by the projection fold in the close transaction, so a committed invoice always has its row; a rolled-back close has none.
- **Not fiscalized** (adapter `none`, or order type with `fiscalize: false`, or an invoice issued while the branch was on `none`): row state `not_required`; the receipt has no fiscal block.
- **Switch** `none` → `PRA` (G1-16) applies to invoices issued after the setting's `switched_at`; earlier invoices stay `not_required`; a credit of a `not_required` original is `not_required`.
- **Stuck:** a `pending` row older than `stuck_after_ms`, a `rejected` row, or a row older than half the authority's `catch_up_window_ms` → one `fiscal_outbox_stuck` alert (dedupe `fiscal_stuck:<branch_id>`, managers, `closes_on: 'owner'`; closed `done` when no row is stuck); details = counts and the oldest age only.
- **Health:** `adapter.health()` is called by the worker at most every 60 s while rows wait; its result is in `fiscal-status` (§6.27). No HTTPS call ever runs on a command path.
- **Secrets:** the adapter reads the POS ID's token from the hub config (row H-2) at send time; a missing token → the row stays `pending` with `last_error: 'token_missing'` and the stuck alert fires (go-live precondition, G1-16).
- **PRA adapter** (`apps/hub/src/billing/fiscal/pra.ts`): `POST` JSON to the configured environment's base URL (`sandbox` / `production`, values in the branch fiscal settings; sandbox `https://ims.pral.com.pk/ims/sandbox/api/Live/PostData`, production `https://ims.pral.com.pk/ims/production/api/Live/PostData`), header `Authorization: Bearer <token>`; Node 22 built-in `fetch` with `AbortSignal.timeout(10_000)`. Fields from the research: `TotalSaleValue` (Σ item sale values excl. tax and discount), `TotalTaxCharged`, `Discount`, `TotalBillAmount`, `PaymentMode` (1 cash, 2 card, 5 mixed; others unused), `InvoiceType` (1 sale; **3 credit with `RefUSIN`**), POS ID, USIN, date-time, buyer name / CNIC / NTN when present, items (description, quantity, unit price, sale value, tax rate, tax). Every other field and the answer's shape are taken from PRA's "Technical Specification Software Fiscal Device v1.2" at build; a field the document leaves unclear is a STOP to the owner, not a guess. Verification QR payload = `https://reg.pra.punjab.gov.pk/IMSFiscalReport/SearchPOSInvoice_Report.aspx?PRAInvNo=<fiscal_number>` unless PRA's answer carries its own.
- **Live sandbox runs are manual owner steps** (G1-12); CI and the normal gate use recorded fixtures only (no network, CLAUDE.md).

### 3.16 Printing (03c, B17, B18)

| Document | When | Printer | Drawer |
|---|---|---|---|
| Check bill | `PrintCheckBill`; 02a `BillRequested` (live-only fold, 03c pattern) | payload `printer_id`, else the bill route of the table's zone → floor → default (row P-1); takeaway / parking: the device's route → default | no |
| Receipt (one per invoice) | `CloseSplit` | the device's route → default | yes when the split had a cash `in` or `out` payment |
| Credit note | live-only fold of `InvoiceCredited` (direct `ReopenBill` and `reopen_bill` approve alike) | the event's device route (the answerer's on an approval) → default | no |
| Z / X | `ZReportIssued` (live-only fold); X and any reprint through `PrintBillDocument` (§6.22) | `report` route → default | no |
| No-sale | `OpenCashDrawer` | the device's route | yes |

No printer routed / none active → the document is skipped (logged with ids), the command still succeeds (R8, 03c To 05); the screen shows the receipt (§8). Every job id is kept in `bill_print_jobs` so the bill view shows its status and "Print to" can move it (B18).

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| F | §6 standards; envelope stream types (+ `bill`, row F-1) | everything |
| 00 | `defineCommand` (`approvable`, `sessionKind: 'both'` row H-1), registry, projections registry (`register`, `reset`, live-only folds), `ctx.state` (business day), `ctx.directory`, `ctx.clock`, writer tx for worker appends, list cursor, `staff_names` (00 v1.10 H-1), hub config (`fiscal_credentials`, row H-2), boot hook after listen (row H-3) | §3, §6 |
| 01a | `branchConfig()` (`tax_enabled`, `tax_classes` + `fiscal_category`, `billing` key, row A-1), `CloseBusinessDay` with guard and appender lists (rows A-3, A-4), `BusinessDayOpened` / `BusinessDayClosed`, `business_day` in engine state | §3.4–§3.6, §3.13 |
| 01b | `resolve(staff, permission)` with scopes, new permissions (row B-1), `rolesGranting` (row B-3), `ALLOWED_ONLY_PERMISSIONS` | §3.14, §6 |
| 01c | `allocateDealMinor` (BigInt-safe, remainder to the last) | §3.5, §3.6, §3.8 |
| 01d | `defineAlertKind`, `APPROVAL_TIER_STEPS`, `alerts.raiseMany`, `alerts.listOpen`, `alerts.close` drafts, `AnswerFacts`, read-only `apply` contract, target `managers` | §3.13, §3.14, §3.15 |
| 02a | `seating_orders`, `seatings` (read-only joins), `currentTableOf`, merge guard list (row T-1), `BillRequested`, `TablesMerged`, `SeatingSplit`, `BillClosed` schema (05 writes it) | §3.8, §3.9, §3.16 |
| 02b | `orderLines`, `ordersOf`, `readOrder` (+ `tax_class_id`, row Q-1), `OrdersBilled` (05 writes it), `OrdersUnbilled` and `LineCompRemoved` (rows Q-2, Q-4; 05 writes them, 02b folds them), line guard list (row Q-3), `COMP_KIND`, `ORDER_BILLED` | §3.3–§3.10 |
| 03a | nothing new: `stockEffects` stays inside 01a's close after 05's appender drafts; a return line's money is 0 | §3.13 |
| 03c | `printDocument`, `Doc` (+ QR block, row P-3), `renderText` (moved, row P-4), `billPrinterFor`, `retargetDocumentJob`, `documentJobsStatus` (rows P-1, P-2) | §3.16 |
| 04 | `pendingVoids(db, order_ids)` (subtract `refund_minor` only; close refused while any), `VOID_KIND`, `registerAuditAction`, `AUDIT_ACTIONS` (+ 05's, row V-3), line guard asked by `VoidItems` (row V-1), `walk_out` reason (row V-2) | §3.3, §6.30 |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| Events (`bill`, `shift`, `hub` streams; §6.29) | Zod in `@pos/events/src/events/{bill,shift,hub}/` | — | 06 sync, 07 reports, 04 audit map |
| `computeSplit`, `computeBill` | pure (`@pos/domain/src/billing/compute.ts`) | 0 | hub, clients (screen totals), 07 |
| `buildReceiptDoc`, `buildCheckBillDoc`, `buildCreditNoteDoc`, `buildReportDoc` | pure `Doc` builders (`@pos/domain/src/billing/docs.ts`) | 0 | hub print, owner-app preview |
| `buildReport(input)` | pure X / Z builder | 0 | hub, 07 (same rules on synced events) |
| `FiscalAdapter`, `registerFiscalAdapter(adapter)` | §3.15 (`apps/hub/src/billing/fiscal/port.ts`) | — | milestone C adapters (SRB, KPRA, BRA, FBR-ICT) |
| `openBillOf(db, { seating_id \| order_id })` | `{ bill_id, state } \| null` | 1 | 02a / 02b clients via queries only |
| `BILL_KINDS` | the seven kind names of §3.14 + `fiscal_outbox_stuck` | — | 07 money view, 01d tests |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 06 | Sync carries `bill`-stream events; cloud read models for shift and Z history and D22 tiles (sales by payment mode, discounts, voids) are built from synced events with `buildReport` / `computeBill` (K-9). `invoice_buyers` and `fiscal_outbox` are hub state and are **never synced** (B19). A hub restore from the cloud keeps the invoices (events) but loses buyer IDs and outbox worker state: the restore runbook re-derives the outbox from events (fold) and re-enters fiscal tokens (row H-2). |
| 07 | Sales by item / category / hour / staff, the live money view with failed-PIN and notice-seen lists (01d To 05 money section, README :226), tax report — from `InvoiceIssued` / `InvoiceCredited` / payment events (Q14). |
| 01e | A Windows-only authority path (PRA local service, KPRA RIMS) is decided with 01e / hardware when such an adapter is built (K-16). |
| Milestone C | Adapters SRB, KPRA, BRA, FBR-ICT behind the port, each with its catalog rows confirmed against a notification (research rule). |
| Pilot checklist (plan) | G1-16 go-live preconditions (owner tasks): POS ID(s) registered with PRA (A1), production token entered on the hub (row H-2), one sandbox run passed, the owner's / accountant's acceptance that only the POS floor reports to PRA (R20). Any missing → the branch starts on `none`; the switch is a setting change (audited `config_audit`). M-2 note for 01c data entry: leave `is_default` off unless truly default. |

### 4.4 Shared types (`@pos/domain/src/billing/types.ts`, browser-safe)

```typescript
export const PAYMENT_CLASSES = ['cash', 'digital'] as const;
export const PAYMENT_MODE_KINDS = ['cash', 'card', 'wallet', 'online', 'other'] as const;   // kind 'cash' ⇔ class 'cash'
export const SPLIT_MODES = ['items', 'amount', 'equal'] as const;
export const MIXED_CLASS_RULES = ['higher_rate', 'pro_rata'] as const;
export const ROUNDING_METHODS = ['nearest', 'down', 'up'] as const;
export const AUTHORITIES = ['none', 'PRA', 'SRB', 'KPRA', 'BRA', 'FBR_ICT'] as const;      // adapters shipped: none, PRA
export const INVOICE_SERIES = ['sale', 'credit'] as const;
export const FISCAL_ROW_STATES = ['pending', 'acked', 'rejected', 'not_required'] as const;
export const DISCOUNT_KINDS = ['amount', 'percent'] as const;
export const PETTY_KINDS = ['advance', 'out', 'in'] as const;
export const BILL_REOPEN_REASONS = ['wrong_item_billed', 'wrong_payment_mode', 'customer_returned_item', 'price_error', 'other'] as const;
export const CHARGE_REMOVE_REASONS = ['customer_request', 'service_complaint', 'staff_meal', 'other'] as const;
export const COMP_REMOVE_REASONS = ['comped_by_mistake', 'wrong_line', 'other'] as const;
export const CARRY_OVER_REASONS = ['table_still_seated', 'customer_will_pay_later', 'other'] as const;
// discount reasons are owner-edited (billing settings), e.g. regular_customer, staff, owner_guest, complaint, other
```

`note` (≤ 200) is required whenever a reason code is `other`.

### 4.5 Changes to other specs (R26) — *Proposed — needs approval*; applied by 05's phase 0 with "⚠️ Changed by 05 (row X-n)" markers (R34). Merged specs are not edited now.

**Version numbers (spec task 0, 2026-11-17):** next free after `main` **and** every remote branch and open PR (checked with `gh api` and `git ls-tree` on every `origin/*` ref): F v1.13 → **v1.14**; 00 v1.11 (DRAFT on `main`) → **v1.12**; 01a v2.5.1 → **v2.6**; 01b v1.9.1 → **v1.10**; 01d v1.2.5 → **v1.2.6**; 02a v1.1.6 → **v1.1.7**; 02b v1.0.14 → **v1.0.15**; 03c v1.0.10 → **v1.0.11**; 04 v1.0.3 → **v1.0.6** (v1.0.4 and v1.0.5 are claimed by `module-04-client` and the `lane-VU1/*`, `lane-VU2/*`, `lane-P0/04-spec-v10{4,5}` branches; 05 skips them). No clash found. Migrations: hub **0021** (02b row Q-1), **0022** (03c row P-1), **0023** (05) (main ends at 0020; no branch claims more); cloud **0016**, **0017** (main ends at 0013; `lane-HD/h10` claims 0014, 0015). The numbers are re-checked at phase 0; a clash then is a STOP.

| Row | Target → version | Change | Why |
|---|---|---|---|
| F-1 | Foundation → **v1.14** §4.1 + `packages/events/src/envelope.ts` | `stream_type` gains **`'bill'`** (stream id = `bill_id`) for bill, split, payment, invoice, credit, reopen and fiscal-answer events; `shift` keeps shifts, petty cash, counts, drawer opens; `hub` gets `ZReportIssued`, `OrdersCarriedOver`. No DB CHECK exists; Zod enum only. | K-2 |
| F-2 | Foundation → **v1.14** §4.4 | "BILLED is set by `BillClosed`" → "BILLED is set by **`OrdersBilled`** (every order type); `BillClosed { seating_id }` only drives the table's NEEDS_CLEANING (dine-in, once per seating). A bill reopen writes `OrdersUnbilled` (02b), which returns the order to the state it had before BILLED." Diagram label "bill close" stays. | K-1, B14, OQ-1 |
| F-3 | Foundation → **v1.14** §3.5, §7 OQ15, §8 | §3.5: answered — the PRA adapter ships live in the pilot behind 05's fiscal port (G1-16); bill close never waits for the authority; the receipt prints first with "fiscal number pending" and posts later through the hub fiscal outbox (05 §3.15); the hub posts directly over HTTPS (K-16). OQ15 → **answered (05 v0.1, G1 Q1, M-15)**. §8 row "Fiscal integration beyond PRA" → "one port, an adapter per authority; SRB / KPRA / BRA / FBR-ICT at milestone C (README R37)". §8 row "Transactional outbox" gains: "exception: the **fiscal outbox** (05 §3.15) — an external authority with its own id and order rules is not the sync stream; justified by PRA r.8(3) and s.48." | Q1, K-14, K-16, K-17 |
| F-4 | Foundation → **v1.14** §4.6 | Shift = one person's money period (float, payments by `shift_id`, petty cash, blind count, variance); a drawer belongs to one open shift; taken-by vs shift (05 B11); day close also refused while an order is neither billed, cancelled nor carried over (05 B25); Z = Σ sale invoices − Σ credit invoices of the day, and equals Σ of the day's shift takings (property test). Money note §4.1: "rounds once, at the split total (05 §3.5)". | Q9–Q11, G1-6 |
| F-5 | Foundation §6.2 (append, no bump) | 05 §9 codes. | §9 |
| H-1 | 00 → **v1.12** §6.3 / registry (`apps/hub/src/commands/registry.ts`, `route.ts`) | `defineCommand({ sessionKind: 'device' \| 'admin' \| 'both' })`: `'both'` registers the command on `/commands/<name>` (staff session) **and** `/admin/commands/<name>` (admin session); one `command_id` space, same handler; permission resolved from the session's staff in both. Used by `CloseBusinessDay` (row A-5). | K-5 |
| H-2 | 00 → **v1.12** hub config (`apps/hub/src/config/schema.ts`) + CLI | Optional `fiscal_credentials: [{ pos_id: string 1–40, token: string 1–512 }]` in the hub config file (same file and mode as `branch_api_key`, `backup_encryption_key`); CLI `pnpm --filter hub set-fiscal-token --pos-id <id>` reads the token from **stdin** (never argv, never echoed), writes the file atomically, prints only "saved for <pos_id>"; `--remove`. Never logged, never in `/health`, a query, an event, sync or the USB backup (the restore runbook re-enters it). | G1-12, K-18, B22, OQ-3 |
| H-3 | 00 → **v1.12** boot (`apps/hub/src/lib/boot.ts`) | Start the **fiscal worker after listen**, beside the print worker (03c H-11 pattern), stop joined in `beat.stop`; 05 provides `startFiscalWorker(deps)`. | B20 |
| H-4 | 00 → **v1.12** logging (test only) | A hub test asserts no request body is logged for `/commands/*` (Fastify default); a `CloseSplit` with a buyer ID leaves no trace of the number in any log line (05 test #71). | B19, B30 |
| A-1 | 01a → **v2.6** §4.3 snapshot, §5.2 cloud `0016_billing_settings.sql`, §6 routes, §8.1 page | (1) `tax_classes[]` gains `fiscal_category: string \| null` (e.g. `'restaurant_service'`); `rate_bp` is "the rate for adapter `none` only". (2) Cloud table **`fiscal_catalog_rows`** (global, versioned, seeded): `authority, fiscal_category, payment_class, integration_status ('integrated' \| 'not_integrated'), rate_bp, effective_from DATE, notification_ref, source_note`; seeded only with rows whose ref is confirmed (PRA restaurant service: card / wallet / QR 500 bp, other 1600 bp, `PRA.32-24/2026/1313`, 2026-02-19); rows "ref not found" (research) are **not** seeded. Authority rules as data in `fiscal_authority_rules`: `authority, mixed_class_rule, buyer_id_threshold_minor, catch_up_window_ms, effective_from, ref` (PRA: `higher_rate`, 5 000 000, 604 800 000, eIMS Rules 2019). (3) Per-branch **billing settings** document (table `branch_billing_settings`, one row, `version`): payment modes `[{ mode_id, name, kind, payment_class, reference_required, is_active, sort_order }]`; `rounding_step_minor` (1–100 000, default 100), `rounding_method`; `prices_include_tax` (default false); `service_charge_bp` per order type (0–3 000, default 0); `service_charge_tax_class_id`; discount reasons `[{ code, label }]`; `max_discount_pct` (default 100); `variance_threshold_minor` (default 10 000); `petty_cash_limit_minor` (default 500 000); petty categories `[{ category_id, name, is_active }]`; `open_bill_flag_minutes` (default 240); receipt template (K-12: `header_lines` ≤ 6, `footer_lines` ≤ 6, ≤ 48 chars, show toggles `ntn`, `address`, `phone`, `cashier`, `order_no`, `bill_no`; `ntn`, `address`, `phone`, `invoice_prefix` ≤ 6); fiscal `{ authority, environment: 'sandbox' \| 'production', base_urls?, pos_ids: [{ pos_id, label }], default_pos_id, device_pos_ids: [{ device_id, pos_id }], integration_status, taxpayer_ntn, fiscalize_by_order_type: { dine_in, takeaway, parking, delivery } (delivery default false, Q17), stuck_after_ms (default 1 800 000), switched_at }`; owner rate overrides `[{ tax_class_id, payment_class, integration_status, rate_bp, effective_from, notification_ref }]`. **No secret** in it (B22). (4) Routes `GET` / `PUT /v1/admin/branches/:branch_id/billing` (`expected_version`, C2 branch guard, C4 check order, C7 route case, `config_audit` row, branch bump) and `GET /v1/admin/fiscal-catalog?authority=` (read-only). (5) Snapshot V4 gains the optional key **`billing`** (no snapshot version bump, R29; 03b A-1 precedent): the settings above plus `tax_rates` = for the branch's authority, every catalog row and override **resolved per tax class** (all `effective_from` rows, so the hub picks by date) and `authority_rules`; absent → hub defaults (adapter `none`, one cash mode, step 100, no service charge). (6) Owner app page "Billing" (§8.1) incl. the receipt preview with `renderText` (row P-4) and the fiscal-catalog view. | K-12, K-15, Q16, Q17, G1-5, G1-8, B5, B22 |
| A-2 | 01a → **v2.6** `@pos/events/src/admin/billing.ts` | Zod wire shapes for A-1 (C6 keyed lists: `mode_id`, `code`, `category_id`, `pos_id`, `device_id`; override key `(tax_class_id, payment_class, integration_status, effective_from)`); a mode with `kind: 'cash'` must have `payment_class: 'cash'` and at least one active cash mode exists (`422 CONFIG_REFERENCE_INVALID { field }`); unknown `tax_class_id` / `service_charge_tax_class_id` → `not_found` (C1). | A-1 |
| A-3 | 01a → **v2.6** §6.18b + code (`close-business-day.ts`) | `registerDayCloseGuard` keeps its signature but **appends** to an ordered list (registration order; 04's void guard first, then 05's); the first non-null result refuses; `resetDayCloseGuards()` for tests. 01a test #196 kept; new test: two guards, first wins. | B25 |
| A-4 | 01a → **v2.6** §6.18b + code | `registerDayCloseAppender((ctx) → EventDraft[])` (list, registration order); after the guards, the command appends `[...appenderDrafts, ...withStockEffects(ctx, [BusinessDayClosed])]` in one transaction, so 03a's releases and `BusinessDayClosed` stay last (03a To 05) and the checkpoint follows `BusinessDayClosed`. Unregistered → today's behaviour. | K-5, B25 |
| A-5 | 01a → **v2.6** §6.18b, §8.2 + code | `CloseBusinessDay`: permission `manage-stock` → **`close-business-day`** (scope `branch`, B20 rule unchanged with the new name), `sessionKind: 'both'` (row H-1), so the staff app's manager / cashier kiosk can close the day; `/admin/stock` shows Close day by the new permission; on `DAY_CLOSE_BLOCKED` with `reason` `shift_open` / `unbilled_orders` it lists them like `void_pending` (G-21 `Message.items`). `OpenBusinessDay` stays `manage-stock` on the stock page. | K-5 |
| B-1 | 01b → **v1.10** catalogue + code (`packages/domain/src/permissions.ts`) | New permissions (group `bills`): `take-payment` (scopes `branch`, `my_floors`, `own_tables`), `manage-own-shift`, `close-shift-for-others`, `skip-blind-count`, `record-petty-cash`, `remove-service-charge`, `close-business-day`, `open-cash-drawer`, `remove-comp`, `close-without-buyer-id` (all others `branch`). `ALLOWED_ONLY_PERMISSIONS` += `take-payment`, `manage-own-shift`, `close-shift-for-others`, `skip-blind-count`, `close-business-day`, `open-cash-drawer`. Approvable: `apply-discount`, `remove-service-charge`, `reopen-bill`, `remove-comp`, `close-without-buyer-id`, `record-petty-cash`. `apply-refund` stays, unused in the pilot (Q8). | K-13 |
| B-2 | 01b → **v1.10** default roles + cloud `0017_billing_defaults_backfill.sql` | Owner: every new permission `allowed`. Manager: every new permission `allowed` except `skip-blind-count`. Cashier: `take-payment` (`branch`), `manage-own-shift`, `open-cash-drawer`, `record-petty-cash` (`allowed`; the limit still applies), `apply-discount`, `remove-service-charge`, `reopen-bill`, `remove-comp`, `close-without-buyer-id` (each `requires_approval` by Manager). Order taker: `take-payment` (`own_tables`), `manage-own-shift`. `close-business-day`: Owner, Manager. New tenants by `seed-tenant` (`default-roles.ts`); existing tenants by the backfill, by **`default_key`**, active roles only (04 G-20 pattern), approver rows in `role_permission_approvers` with the dual-written `approver_role_id`; `directory_version` bump. Every grant state tested (04 G1-7 pattern). | K-13, README :191 |
| B-3 | 01b → **v1.10** hub `StaffDirectory` | `rolesGranting(permission, grant: 'allowed', scope: 'branch'): string[]` (role ids, in memory, 0 statements) for 05's over-limit approvers. | §3.14 |
| D-1 | 01d → **v1.2.6** §4.3 To 05, §3.3 (text) | 05's kinds (§3.14) and `fiscal_outbox_stuck` (action, `managers`, `closes_on: 'owner'`); at day close 05's appender closes its open requests and 02b's `comp` requests `obsolete` (note `day_closed`); void requests block instead (04). The "manager's live money view" part of To 05 moves **To 07** (Q14). No 01d code change. | K-5, Q14 |
| T-1 | 02a → **v1.1.7** §6 merge / split + code (`tables/merge-guard.ts`) | `registerMergeGuard` appends to an ordered list (04 first, then 05); first non-null refuses. 05's guard: `409 BILL_HAS_PAYMENTS { bill_id }` (§3.9). | G0-4 |
| T-2 | 02a → **v1.1.7** §4.3 To 05, §6.12, OQ1 (text) | "the seating's last open bill" → "**the bill's last split**" (K-3); `BillClosed` is written once per seating (a re-close after a reopen writes none); `RequestBill`: 05 prints the check bill from `BillRequested` at the zone / floor bill printer (G1-10); OQ1 closed — no cashier alert (Q13). | K-3, Q13 |
| Q-1 | 02b → **v1.0.15** §5, §4.2 + code + hub `0021_order_line_tax_class.sql` | `order_lines.tax_class_id TEXT NULL` (the `ItemAdded` line's class; `NULL` for a `deal_part` and for an untaxed item); the fold writes it; `LineView.tax_class_id`, `ReadOrderLine` too (same statements); the migration adds the column and deletes the `orders` checkpoint so `orders` refolds from seq 0 (00 v1.10 H-2 safe; 0019 pattern). | K-4 |
| Q-2 | 02b → **v1.0.15** §3.3, §6.19 + code | Event **`OrdersUnbilled { order_ids: string[] (≥ 1), bill_id }`** (stream `order`, id = first order id, `.strict()`), written by 05's reopen; fold `billed_at = NULL` for those orders; every 02b / 04 command that refused `ORDER_BILLED` accepts them again; the audience of `OrdersBilled` gets it too. | B14, OQ-1 |
| Q-3 | 02b → **v1.0.15** §3.4 + code (`orders/line-guard.ts`) | `registerLineGuard` appends to an ordered list (04 first, then 05); first non-null → its `{ code, details }`. The guard signature widens to return `{ code: 'VOID_PENDING' \| 'BILL_PARTLY_PAID', details }` (04's result maps to today's `VOID_PENDING` unchanged). 05's guard: any of the order's bill has a closed split and the bill is not CLOSED → `409 BILL_PARTLY_PAID { bill_id }` (1 statement). | B15 |
| Q-4 | 02b → **v1.0.15** §3.9, §6.19 + code | Event **`LineCompRemoved { order_item_id, units, comp_minor, reason_code, note, requester_staff_id, approver_staff_id, alert_id }`** (stream `order`), fold: `comped_units −= units`, `comp_minor −= comp_minor` (never below 0); written only by 05 on an unbilled line with `comped_units ≥ units`; export `planCompRemoval(line, units) → { units, comp_minor }` (the inverse of `planComp`'s per-unit value, 01c §3.4.8 cascades). 02b §12.3 Q2 "a comp cannot be undone" → "undone only before billing, by 05's `RemoveComp` with approval". | Q7, G1-7 |
| P-1 | 03c → **v1.0.11** §3.2, §5, §6 + hub `0022_bill_routes.sql` | **Bill routes:** table `bill_routes(scope 'zone' \| 'floor' \| 'device' \| 'report' \| 'default', ref_id, printer_id)`, hub admin command `SetBillRoute { scope, ref_id, printer_id \| null }` (writes `BillRouteSet`, `hub` stream; `print_config` folds it), listed in `print-config`, a printer used by a route cannot be archived (`409 CONFIG_IN_USE`); export `billPrinterFor(db, { zone_id?, floor_id?, device_id?, report? })` → the first active of device → zone → floor → default (1 statement). 03c's Printers page gains a "Bill printers" section. | G1-10, S-1 |
| P-2 | 03c → **v1.0.11** §3.7, §4.2 + code | `retargetDocumentJob(tx, job_id, printer_id)`: a `document` job not acked and not cancelled moves to `printer_id` (`attempts = 0`, `last_error = NULL`; a job being sent is refused `409 PRINT_JOB_NOT_PENDING`); `documentJobsStatus(db, job_ids)` → `[{ job_id, printer_id, state: 'waiting' \| 'printing' \| 'printed' \| 'failed' \| 'cancelled', last_error }]` (1 statement). | G1-10, B18 |
| P-3 | 03c → **v1.0.11** §3.6 + `packages/domain/src/print.ts`, encoder | `DocBlock` gains `{ qr: string (≤ 400), size?: 3–8 }` → ESC/POS `GS ( k` (model 2, error correction M, module size `size`, default the largest that fits 80 mm / 58 mm, A3 default); `renderText` prints `[QR] <payload>`; a printer that ignores `GS ( k` still prints the fiscal number line beside it (05 always prints it). | G1-11, K-12, A3 |
| P-4 | 03c → **v1.0.11** §3.6, §4.2 (text + move) | `renderText(doc, width_cols)` moves to `@pos/domain/src/print-render.ts` (browser-safe, no `node:*`); the hub imports it from there. | K-12 |
| V-1 | 04 → **v1.0.6** §3.2, §6.1, §6.3 + code | `VoidItems` and `void-preview` ask 02b's line guard list for the touched ids after the `ORDER_BILLED` check (05's partly-paid guard → `409 BILL_PARTLY_PAID`); 04's own lock check is unchanged. | B15 |
| V-2 | 04 → **v1.0.6** §4.4 | `VOID_REASON_CODES` += `'walk_out'` (Q12). | Q12 |
| V-3 | 04 → **v1.0.6** §3.6 + `packages/domain/src/audit.ts` | `AUDIT_ACTIONS` += `bill_opened`, `check_bill_printed`, `bill_requested`, `splits_set`, `discount_requested`, `discount_applied`, `discount_removed`, `service_charge_removed`, `service_charge_applied`, `payment_added`, `payment_removed`, `buyer_id_waived`, `invoice_issued`, `bill_reopened`, `invoice_credited`, `fiscal_rejected`, `comp_removed`, `shift_opened`, `shift_counted`, `shift_count_skipped`, `handover_counted`, `shift_closed`, `petty_cash`, `drawer_opened`, `orders_carried_over`, `z_report_issued`; subject types `bill`, `shift`. Mapped by 05 through `registerAuditAction` (§6.30); details never carry a buyer ID or a name. | G0-9, E6 audit AC2 |
| R-1 | README (added in v0.1 as **proposed**; marked approved with 05) | Decision **R37** (amends R13, K-14 + G1-16; R13 carries an "Amended by R37" marker): "Fiscal port, outbox, rate table and adapter `none` are 05 pilot scope; the **PRA adapter ships and runs live from day 1** on the pilot's POS floor (G1-16), with the go-live preconditions as owner tasks and `none` as the setting fallback; milestone C keeps SRB / KPRA / BRA / FBR-ICT." Milestone C text "PRA/FBR integration (R13)" → "adapters SRB / KPRA / BRA / FBR-ICT (R37)". Module map row 05; carried rows To 05 marked landed (§4.6); new rows To 06 / To 07 from §4.3. | K-14, G1-16 |

### 4.6 Carried rows (README) and where they land

| Row | Lands in |
|---|---|
| :183 open cash shift on takeover | B11, §3.11; test 48 |
| :191 defaults by `default_key` | row B-2; test 90 |
| :202 tax at close, business day, rounding, shifts, order-taker cash count | B4–B6, B9, B23, B25; §3.4–§3.6; tests 10–15, 20, 45–52, 62–68 |
| :203 payment modes, receipt template, PRA | B10, B29, B20 (R37 amends R13); tests 22, 34, 69–78 |
| :214 deal / option tax, weight pending | B4, §3.3 rule 3; tests 12, 33 |
| :226 discount kind, day-close requests, money view | B7, §3.13, §3.14; money view → 07 (§4.3); tests 16, 17, 64 |
| :240 bill per seating, `BillClosed`, merge / split, reprint, archived table | B1, B2, §3.9, B17; tests 1, 2, 6, 56–59 |
| :243 `stockEffects` before `BusinessDayClosed`, return lines | row A-4, B3; tests 4, 65 |
| :246 pending void, day close, refund after close, Z dispositions | §3.3 rule 2, §3.13, B14 (reopen replaces `apply-refund`), §6.26; tests 31, 33, 37, 62, 66 |
| 02b To 05, §12.3 Q2 | B3, B27, §3.3; row Q-4; tests 4, 30, 41 |
| 03c To 05 | §3.16; rows P-1–P-4; tests 34, 35, 58–61, 85, 86 |
| 04 To 05, G-8 | §3.3, §3.13, Z voids by disposition (§6.26); tests 31, 66 |
| OPEN-QUESTIONS 02a-N3 | `BillClosed` audience = 02a's (staff sockets + kiosks), unchanged; test 6 |
| OPEN-QUESTIONS 02b AD-5 | B2 |
| F §3.5, §7 OQ15 | B20, B21; row F-3 |
| F §4.6 | §3.11, §3.13; row F-4 |

---

## §5. Data model (hub SQLite) — `apps/hub/src/db/migrations/0023_billing.sql`

Two projections, both **events-only** (they read only their own tables and the event; never 02b's or 02a's tables in a fold), with `reset`, registered after `orders`, `tables` and `audit`:

- **`billing`** — `BillOpened`, `ChargeApplied`, `ChargeRemoved`, `CheckBillPrinted`, `BillSplitsSet`, `DiscountApplied`, `DiscountRemoved`, `PaymentAdded`, `PaymentRemoved`, `BuyerIdWaived`, `InvoiceIssued`, `BillReopened`, `InvoiceCredited`, `FiscalNumberAssigned`, `FiscalSubmitRejected`, `OrdersCarriedOver`, `ZReportIssued`, 02a `TablesMerged` / `SeatingSplit` (bill re-pointing, §3.9), `BusinessDayOpened` (current day key).
- **`shifts`** — `ShiftOpened`, `ShiftCounted`, `ShiftCountSkipped`, `HandoverCounted`, `ShiftClosed`, `PettyCashAdvanced`, `PettyCashSettled`, `PettyCashOut`, `PettyCashIn`, `DrawerOpened`, and the money facts of `PaymentAdded` / `PaymentRemoved` / `InvoiceIssued` (cash tendered, change) for the running expected cash.

Hub state that is **not** a projection (plain statements, never events, never synced; 03c rule): `invoice_buyers` (command-written), `bill_print_jobs` (written with each print), and the worker columns of `fiscal_outbox`.

```sql
-- projection billing ---------------------------------------------------------------------------------------
CREATE TABLE bills (
  bill_id            TEXT PRIMARY KEY,
  scope              TEXT NOT NULL CHECK (scope IN ('seating','order')),
  seating_id         TEXT,                                  -- dine_in
  order_id           TEXT,                                  -- takeaway / parking
  order_type         TEXT NOT NULL,
  state              TEXT NOT NULL CHECK (state IN ('open','partly_paid','closed')),
  opened_at          INTEGER NOT NULL,
  closed_at          INTEGER,
  sc_bp              INTEGER NOT NULL DEFAULT 0,            -- ChargeApplied (rule or manual); 0 after ChargeRemoved
  sc_removed         INTEGER NOT NULL DEFAULT 0 CHECK (sc_removed IN (0,1)),   -- sticky (B8)
  discount_json      TEXT,                                  -- { split_no|null, kind, value, reason_code, alert_id } | NULL
  split_mode         TEXT CHECK (split_mode IN ('items','amount','equal')),    -- NULL = one split
  buyer_waived       INTEGER NOT NULL DEFAULT 0 CHECK (buyer_waived IN (0,1)),
  check_printed_at   INTEGER,                               -- pulled status "check bill printed" (B17)
  reopen_count       INTEGER NOT NULL DEFAULT 0,
  bill_closed_written INTEGER NOT NULL DEFAULT 0 CHECK (bill_closed_written IN (0,1)),  -- B14: BillClosed once
  absorbed_into      TEXT,                                  -- §3.9 merge
  CHECK ((scope = 'seating') = (seating_id IS NOT NULL)),
  CHECK ((scope = 'order') = (order_id IS NOT NULL))
);
CREATE UNIQUE INDEX bills_live_seating ON bills (seating_id) WHERE seating_id IS NOT NULL AND absorbed_into IS NULL;  -- openBillOf(seating)
CREATE UNIQUE INDEX bills_order        ON bills (order_id) WHERE order_id IS NOT NULL;                                -- openBillOf(order)
CREATE INDEX bills_open                ON bills (state, opened_at) WHERE state <> 'closed' AND absorbed_into IS NULL;  -- open-bills list, X flag

CREATE TABLE bill_orders (              -- frozen at the first close (B1); also the reopen set
  bill_id TEXT NOT NULL, order_id TEXT NOT NULL, PRIMARY KEY (bill_id, order_id)
);
CREATE INDEX bill_orders_order ON bill_orders (order_id);                                  -- line guard (row Q-3)

CREATE TABLE bill_splits (
  bill_id   TEXT NOT NULL, split_no INTEGER NOT NULL CHECK (split_no BETWEEN 1 AND 20),
  plan_json TEXT,                                          -- items: [{ order_item_id, units }]; amount: { share_minor }; equal: { n, k }
  state     TEXT NOT NULL CHECK (state IN ('open','closed')),
  invoice_id TEXT,                                         -- the current sale invoice when closed
  PRIMARY KEY (bill_id, split_no)
);

CREATE TABLE bill_payments (
  payment_id        TEXT PRIMARY KEY,
  bill_id           TEXT NOT NULL, split_no INTEGER NOT NULL,
  mode_id           TEXT NOT NULL,
  payment_class     TEXT NOT NULL CHECK (payment_class IN ('cash','digital')),
  direction         TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount_minor      INTEGER NOT NULL CHECK (amount_minor > 0),
  tendered_minor    INTEGER CHECK (tendered_minor IS NULL OR tendered_minor >= amount_minor),
  reference         TEXT,
  taken_by_staff_id TEXT NOT NULL,
  shift_id          TEXT NOT NULL,
  added_at          INTEGER NOT NULL,
  removed_at        INTEGER,
  invoice_id        TEXT                                   -- set by InvoiceIssued; cleared by BillReopened (carried to the next close)
);
CREATE INDEX bill_payments_split ON bill_payments (bill_id, split_no) WHERE removed_at IS NULL;   -- bill view, close

CREATE TABLE invoices (
  invoice_id      TEXT PRIMARY KEY,
  series          TEXT NOT NULL CHECK (series IN ('sale','credit')),
  number          INTEGER NOT NULL,                        -- gap-free per series (B13)
  invoice_ref     TEXT NOT NULL,                           -- '<prefix><number>' = USIN
  bill_id         TEXT NOT NULL, split_no INTEGER NOT NULL,
  ref_invoice_id  TEXT,                                    -- credit → original
  business_date   TEXT NOT NULL,                           -- the open day at issue (Z key)
  issued_at       INTEGER NOT NULL,
  order_type      TEXT NOT NULL,
  subtotal_minor  INTEGER NOT NULL, discount_minor INTEGER NOT NULL, service_charge_minor INTEGER NOT NULL,
  tax_minor       INTEGER NOT NULL, rounding_minor INTEGER NOT NULL, total_minor INTEGER NOT NULL,
  change_minor    INTEGER NOT NULL,
  payment_class   TEXT NOT NULL,                           -- the split's class, or 'mixed'
  has_buyer_id    INTEGER NOT NULL CHECK (has_buyer_id IN (0,1)),
  buyer_id_refused INTEGER NOT NULL CHECK (buyer_id_refused IN (0,1)),
  closed_by       TEXT NOT NULL,
  doc_json        TEXT NOT NULL,                           -- lines + tax rows + payments as in the event (receipt reprint, Z)
  credited_by     TEXT,                                    -- the credit invoice_id once credited
  fiscal_number   TEXT, qr_payload TEXT                    -- FiscalNumberAssigned
);
CREATE UNIQUE INDEX invoices_series_number ON invoices (series, number);                  -- MAX+1, gap check
CREATE INDEX invoices_day   ON invoices (business_date, series);                         -- Z / X
CREATE INDEX invoices_bill  ON invoices (bill_id);                                       -- reopen, bill view
CREATE INDEX invoices_issued ON invoices (issued_at DESC, invoice_id);                   -- invoices search (cursor)

CREATE TABLE invoice_taxes (
  invoice_id TEXT NOT NULL, tax_class_id TEXT NOT NULL, payment_class TEXT NOT NULL,
  rate_bp INTEGER NOT NULL, base_minor INTEGER NOT NULL, tax_minor INTEGER NOT NULL, rate_ref TEXT,
  PRIMARY KEY (invoice_id, tax_class_id, payment_class)
);                                                                                       -- Z tax by class (joined by invoices_day)

CREATE TABLE fiscal_outbox (            -- rows by the billing fold (live + rebuild, INSERT OR IGNORE); worker columns below
  invoice_id   TEXT PRIMARY KEY,
  ord          INTEGER NOT NULL,                           -- the invoice event's seq (send order)
  ref_invoice_id TEXT,                                     -- credit waits for its original
  authority    TEXT NOT NULL, pos_id TEXT,
  state        TEXT NOT NULL CHECK (state IN ('pending','acked','rejected','not_required')),
  queued_at    INTEGER NOT NULL,
  acked_at     INTEGER,
  -- worker-owned (plain statements; reset by a rebuild, which is harmless)
  attempts     INTEGER NOT NULL DEFAULT 0, next_try_at INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,                                       -- a short code only ('timeout', 'http_503', 'token_missing', …)
  in_flight_at INTEGER
);
CREATE INDEX fiscal_outbox_pending ON fiscal_outbox (ord) WHERE state = 'pending';       -- worker head, status, stuck check

CREATE TABLE carried_orders (order_id TEXT PRIMARY KEY, business_date TEXT NOT NULL, reason_code TEXT NOT NULL);  -- day-close guard
CREATE TABLE z_reports (business_date TEXT PRIMARY KEY, z_no INTEGER NOT NULL UNIQUE, issued_at INTEGER NOT NULL, report_json TEXT NOT NULL);
CREATE TABLE billing_day (k INTEGER PRIMARY KEY CHECK (k = 1), business_date TEXT, opened_at INTEGER);  -- current day key

-- projection shifts ----------------------------------------------------------------------------------------
CREATE TABLE shifts (
  shift_id        TEXT PRIMARY KEY,
  staff_id        TEXT NOT NULL,
  drawer_device_id TEXT,                                   -- non-NULL = drawer shift (B11)
  business_date   TEXT NOT NULL,
  opened_at       INTEGER NOT NULL,
  float_minor     INTEGER NOT NULL CHECK (float_minor >= 0),
  state           TEXT NOT NULL CHECK (state IN ('open','counted','closed')),
  expected_cash_minor INTEGER NOT NULL,                    -- running (§3.7); never returned before counted_at (B23)
  counted_minor   INTEGER, counted_at INTEGER, variance_minor INTEGER,
  count_skipped   INTEGER NOT NULL DEFAULT 0 CHECK (count_skipped IN (0,1)),
  variance_alert_id TEXT,
  closed_at       INTEGER, closed_by TEXT
);
CREATE UNIQUE INDEX shifts_open_staff  ON shifts (staff_id) WHERE state <> 'closed';                       -- SHIFT_ALREADY_OPEN
CREATE UNIQUE INDEX shifts_open_drawer ON shifts (drawer_device_id) WHERE state <> 'closed' AND drawer_device_id IS NOT NULL;  -- DRAWER_IN_USE
CREATE INDEX shifts_day ON shifts (business_date);                                                         -- Z / X, day-close guard

CREATE TABLE shift_handovers (shift_id TEXT NOT NULL, at INTEGER NOT NULL, counted_minor INTEGER NOT NULL,
  expected_minor INTEGER NOT NULL, variance_minor INTEGER NOT NULL, by_staff_id TEXT NOT NULL, PRIMARY KEY (shift_id, at));

CREATE TABLE shift_takings (            -- per shift × mode × taker (X / Z / shift close breakdown, Q10)
  shift_id TEXT NOT NULL, mode_id TEXT NOT NULL, taken_by_staff_id TEXT NOT NULL,
  in_minor INTEGER NOT NULL DEFAULT 0, out_minor INTEGER NOT NULL DEFAULT 0, change_minor INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shift_id, mode_id, taken_by_staff_id)
);

CREATE TABLE petty_cash (
  entry_id TEXT PRIMARY KEY, shift_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('advance','out','in')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  category_id TEXT, paid_to TEXT, advance_staff_id TEXT, note TEXT, at INTEGER NOT NULL,
  settled_at INTEGER, settled_shift_id TEXT, spent_minor INTEGER, returned_minor INTEGER
);
CREATE INDEX petty_cash_shift ON petty_cash (shift_id);                                  -- shift view, Z
CREATE INDEX petty_cash_open  ON petty_cash (at) WHERE kind = 'advance' AND settled_at IS NULL;   -- open advances list

-- hub state (not projections) ------------------------------------------------------------------------------
CREATE TABLE invoice_buyers (           -- B19: the only place a buyer ID lives; written by CloseSplit; never synced, logged or returned
  invoice_id TEXT PRIMARY KEY, buyer_name TEXT NOT NULL, buyer_id_number TEXT NOT NULL
);
CREATE TABLE bill_print_jobs (          -- B18: job ids per bill document (03c jobs are not events)
  job_id TEXT PRIMARY KEY, bill_id TEXT, doc_kind TEXT NOT NULL CHECK (doc_kind IN ('check','receipt','credit','report','no_sale')),
  ref_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX bill_print_jobs_bill ON bill_print_jobs (bill_id, created_at DESC);        -- bill view print status
```

**Why these shapes (YAGNI):** `bills.sc_removed` + `ChargeApplied` / `ChargeRemoved` is the M-3 fix (a re-applied charge after removal is the observed failure); `invoices_series_number` makes a duplicate number impossible even under a bug; `fiscal_outbox` is the F §3.5 queue — without it a lost or doubled invoice is a legal fault (PRA s.48) and a close would have to wait for the internet (E5 AC1); `invoice_buyers` exists only because the ID number must reach the authority and the receipt but must not enter the immutable, synced event log (G1-9); `shift_takings` keeps the shift-close and Z breakdown by taker at one statement (Q10) instead of a scan of payments; `billing_day` lets the fold key invoices and shifts to the open day without reading the engine state. No soft delete, no version columns: every change is an event.

**Retention:** none of these rows is pruned in the pilot (money and fiscal records). `bill_print_jobs` rows whose 03c job was pruned are dropped by the same 03c retention call (7 days).

---

## §6. Commands, events and queries

All commands: `POST /commands/<kebab-name>`, staff session (`sessionKind: 'device'`) unless stated; **not queueable** (G0-1: money, PIN-capable); scope checks last (C8); idempotent by `command_id` (D32; a retransmit returns the stored response); statement counts exclude 00's fixed envelope. Every money result carries the recomputed totals so the screen never computes its own (§8). `bill_ref` in payloads = `{ bill_id }` or `{ seating_id }` or `{ order_id }` (exactly one; a reference to a bill not yet created creates it, B1).

**Common bill-open step ("ensure bill"),** used by every bill command: resolve `bill_ref` → `openBillOf` (1) → none: read the seating / order (`readOrder` / `seatings`, 1), refuse a seating that is not open (`409 TABLE_NOT_OPEN`) or an order that is cancelled (`409 BILL_NOT_OPEN { state: 'cancelled' }`), a takeaway / parking order not yet sent cannot exist (B16) → append `BillOpened` + `ChargeApplied { source: 'rule', rate_bp }` (`rate_bp` = `service_charge_bp[order_type]`; 0 → no `ChargeApplied`).

### Batch 1 — the bill (STOP for owner review after this batch)

#### 6.1 `GET /queries/bill?seating_id|order_id|bill_id`

- **Permission:** `take-payment` (its scope: `own_tables` → the caller holds the table / placed the order; `my_floors` → the table's floor) **or** `take-order` (read-only view for the order taker's check bill). `403 PERMISSION_DENIED { reason: 'outside_scope' }` last.
- **Result:** `{ bill_id | null, state, scope, order_type, identifier, orders: [order_id], lines: [{ order_item_id, order_id, name, options, units, base_minor, tax_class_id, tags: ['comp' | 'pending_void' | 'weight_needed'] }], service_charge: { rate_bp, removed }, discount | null, splits: [{ split_no, state, plan, payments: [{ payment_id, mode_id, mode_name, direction, amount_minor, tendered_minor, reference, taken_by_name }], totals: { cash: Totals, digital: Totals, as_paid: Totals }, balance_minor, invoice: { invoice_ref, fiscal_number | null, fiscal_state } | null }], totals_default: Totals, buyer: { required, threshold_minor, waived }, blocks: [{ reason, ids }], open_requests: [{ kind, alert_id }], prints: [{ job_id, doc_kind, state, printer_name, last_error }], check_printed_at, as_of_seq }` with `Totals = { subtotal_minor, discount_minor, service_charge_minor, taxes: [{ tax_class_id, name, payment_class, rate_bp, base_minor, tax_minor }], rounding_minor, total_minor }`. Never a buyer ID number. `blocks` lists every §3.3 rule that would refuse a close now.
- **Statements:** ≤ 9, fixed: `openBillOf` (1), orders of the bill (`seating_orders` or `bill_orders`, 1), `orderLines` (1), `pendingVoids` (1), splits + payments (1 join), invoices of the bill (1), `alerts.listOpen` for the bill's 05 kinds (1), `bill_print_jobs` + `documentJobsStatus` (2). Config and directory in memory. Pure `computeBill`.

#### 6.2 `GET /queries/open-bills?floor_id?`

- **Permission:** `take-payment` (rows filtered by its scope).
- **Result:** `{ bills: [{ bill_id | null, seating_id | null, order_id | null, identifier, order_type, state, total_default_minor, paid_minor, check_printed_at, opened_at, open_minutes, flagged: open_minutes > open_bill_flag_minutes, partly_paid, has_open_request }], as_of_seq }` — every open seating with a live order and every unbilled takeaway / parking order, whether or not a bill row exists yet (projected rows have `bill_id: null`); ordered by `check_printed_at` desc nulls last, then `opened_at`. Bounded by the branch's open tables and orders (≤ 300), returned whole.
- **Statements:** 3 (open seatings ⋈ seating_orders ⋈ orders ⋈ line sums in one aggregate; unbilled non-table orders with line sums; bills ⋈ payments sums). Totals at the default class from the aggregate (no per-bill `computeBill` read).

#### 6.3 `PrintCheckBill` — `{ bill_ref, printer_id? }`

- **Permission:** `take-order` or `take-payment` (either, any scope that covers the table / order).
- **Script:** Zod → ensure bill → bill not CLOSED (`409 BILL_NOT_OPEN`) → lines + pending voids (2) → `computeBill` at the default class → printer: payload `printer_id` (must be active, `404 PRINTER_NOT_FOUND`) else `billPrinterFor` (1) → `buildCheckBillDoc` (banner `PROVISIONAL - NOT A TAX INVOICE`, no number, no QR, "total if paid in cash"; plus one line per digital rate when it differs) → `printDocument` (2) + `bill_print_jobs` (1) → append `CheckBillPrinted { bill_id, total_default_minor, line_count, printer_id | null, job_id | null, source: 'manual' }`. No printer → event with nulls, result `{ printed: false }`.
- **Result:** `{ bill_id, job_id | null, printer_name | null, totals_default }`. **Statements:** ≤ 9. **Audit:** `check_bill_printed`.

#### 6.4 Fold `BillRequested` → check bill (live only, B17)

05 registers a live-only reaction on 02a's `BillRequested` (03c's job-fold pattern; skipped on rebuild): ensure-bill drafts are **not** possible in a fold, so the reaction prints the **projected** bill (same `computeBill`, reads `orderLines` + `pendingVoids` in the transaction after `orders` and `tables` folded) at `billPrinterFor({ zone_id, floor_id })` of the seating's primary table and records the job in `bill_print_jobs` (`bill_id` = the bill if it exists, else NULL with `ref_id = seating_id`). The audit row is 02a's `BillRequested` mapped by 05 as `bill_requested` (§6.30). No 01d notice. A replayed queued `RequestBill` prints at replay time. **Statements:** ≤ 6 per `BillRequested`.

#### 6.5 `SetSplits` — `{ bill_ref, mode: 'items' | 'amount' | 'equal' | 'none', splits?: [{ split_no, lines?: [{ order_item_id, units }], share_minor? }], n? }`

- **Permission:** `take-payment` (scope as §6.1).
- **Script:** Zod (`splits` 2–20, keyed by `split_no` 1..n contiguous; `lines` keyed by `order_item_id` per split; `n` 2–20 for `equal`) → ensure bill → state OPEN, no closed split (`409 BILL_PARTLY_PAID`) → lines (1) → validate per §3.8: item plan: every unit of every live line at most once (`422 BILL_SPLIT_INVALID { reason: 'units_exceed', order_item_id }`), deal whole and option child with its parent (`reason: 'deal_whole' | 'option_with_parent'`); amount plan: Σ shares = `totals_default.total_minor` (`reason: 'shares_sum', expected_minor`); a split with live payments must keep its number (`409 BILL_HAS_PAYMENTS { split_nos }`); `none` = back to one split (only when no split but 1 has payments) → append `BillSplitsSet { bill_id, mode, splits }`.
- **Result:** the bill view's `splits` (recomputed). **Statements:** ≤ 5. **Audit:** `splits_set` (counts only).

#### 6.6 `ApplyDiscount` — `{ bill_ref, split_no: number | null, kind: 'amount' | 'percent', value: int, reason_code, note? }` (approvable)

- **Permission:** `apply-discount` (`branch`), `approvable: true`.
- **Script:** Zod (`amount` ≥ 1 paisa; `percent` in basis points 1–10 000; `reason_code` ∈ the branch's discount reasons, `note` required for `other`) → ensure bill → OPEN or PARTLY_PAID with the target split open (`409 BILL_NOT_OPEN`) → no open `discount` request on the bill (`409 DISCOUNT_PENDING { alert_id }`) → lines (2) → amount ≤ the target's `S` and ≤ `max_discount_pct` of it (`422 DISCOUNT_TOO_LARGE { max_minor }`) → grant `allowed` → append `DiscountApplied { bill_id, split_no, kind, value, amount_minor (at apply), reason_code, note, requester_staff_id, approver_staff_id: null, alert_id: null }` (replaces a previous discount; the event says so: `replaces: true`) → grant `requires_approval` → `raiseMany` kind `discount` (`details { amount_minor, reason_code, identifier }`), result `{ pending: { alert_id } }`.
- **Result:** `{ applied: Totals } | { pending }`. **Statements:** ≤ 6 (+ 01d's raise bound). **Audit:** `discount_applied` / `discount_requested`.

#### 6.7 `RemoveDiscount` — `{ bill_id, reason_code, note? }`

- **Permission:** `apply-discount` (`allowed` or `requires_approval` grant both may remove; removal raises the price, never lowers it). Script: bill OPEN / PARTLY_PAID with the discount's split open, discount present (`409 BILL_NOT_OPEN`; no discount → `200 { changed: false }`) → `DiscountRemoved`. **Statements:** 2. **Audit:** `discount_removed`.

#### 6.8 `RemoveServiceCharge` — `{ bill_ref, reason_code, note? }` (approvable) and `ApplyServiceCharge` — `{ bill_ref, note? }`

- **Remove:** `remove-service-charge`, approvable. Ensure bill → OPEN / PARTLY_PAID → already removed → `200 { changed: false }` → `allowed` → `ChargeRemoved { bill_id, charge: 'service', reason_code, note, requester_staff_id, approver_staff_id, alert_id }`; `requires_approval` → kind `remove_service_charge`. **Never** re-applied by any read, print, split, merge or reopen (B8; tests 18, 19).
- **Apply (re-add):** `remove-service-charge` `allowed` (the same right decides both ways) → `ChargeApplied { source: 'manual', rate_bp: service_charge_bp[order_type] }`; already applied → `{ changed: false }`. **Statements:** ≤ 3 each. **Audit:** `service_charge_removed` / `service_charge_applied`.

#### 6.9 `AddPayment` — `{ bill_ref, split_no, mode_id, direction: 'in' | 'out', amount_minor, tendered_minor?, reference? }`

- **Permission:** `take-payment` (scope as §6.1).
- **Script:** Zod (`amount_minor` 1…1 000 000 000) → ensure bill → split open (`409 BILL_NOT_OPEN`) → mode active in settings (`404 PAYMENT_MODE_NOT_FOUND`) → reference rule (`422 PAYMENT_REFERENCE_REQUIRED`) → money shift (B11): the device's open drawer shift, else the caller's own open shift (an order taker's shift has no drawer, Q9) → none → `409 SHIFT_NOT_OPEN { reason: 'no_shift' }` → lines, pending voids, payments of the split (3) → recompute the split with this payment included (§3.5, §3.6) → digital `in` above the balance → `422 PAYMENT_EXCEEDS_BALANCE { balance_minor }`; `out` only when the balance is negative and `amount ≤ −balance` (`422 PAYMENT_EXCEEDS_BALANCE`) → append `PaymentAdded { payment_id (ULID), bill_id, split_no, mode_id, payment_class, direction, amount_minor, tendered_minor, reference, taken_by_staff_id: caller, shift_id }`.
- **Result:** the split's `totals.as_paid`, `balance_minor`, `change_due_minor` (if cash tendered above), so the screen shows the recomputed tax at once (M-7). **Statements:** ≤ 7. **Audit:** `payment_added` (mode, amount, shift; no names).

#### 6.10 `RemovePayment` — `{ payment_id, reason_code: 'wrong_mode' | 'wrong_amount' | 'customer_changed' | 'other', note? }`

- **Permission:** `take-payment`; removing a payment taken by **someone else** also needs `close-shift-for-others` (`403 PERMISSION_DENIED { reason: 'not_own_payment' }`). Payment exists (`404 PAYMENT_NOT_FOUND`), not removed, its split open (`409 BILL_NOT_OPEN`) → `PaymentRemoved { payment_id, bill_id, split_no, reason_code, note }`. **Statements:** 2. **Audit:** `payment_removed`.

#### 6.11 `WaiveBuyerId` — `{ bill_id, note? }` (approvable)

- **Permission:** `close-without-buyer-id`, approvable. Bill OPEN / PARTLY_PAID; the whole bill's net above the threshold (else `200 { changed: false, reason: 'not_required' }`); already waived → `{ changed: false }` → `allowed` → `BuyerIdWaived { bill_id, requester_staff_id, approver_staff_id: null, alert_id: null }`; `requires_approval` → kind `close_without_buyer_id`. Holds for every later split of the bill and survives a reopen (the customer is the same). **Statements:** ≤ 4. **Audit:** `buyer_id_waived`.

#### 6.12 `CloseSplit` — `{ bill_id, split_no, expected_total_minor, buyer?: { name: string 1–60, id_number: string } }`

- **Permission:** `take-payment` (scope as §6.1). Not approvable (the money-risky parts are approved before: discount, waiver).
- **Validation:** `id_number` = CNIC 13 digits (dashes allowed, stored without) or NTN 7–9 alphanumerics (`400 VALIDATION_FAILED { path: 'payload.buyer.id_number' }`, message without the value). The handler never logs the payload.
- **Script:**
  1. Zod → `BEGIN IMMEDIATE` (00) → bill + split + payments + invoices of the bill (2).
  2. Orders of the bill (1) → `orderLines` (1) → `pendingVoids` (1) → `alerts.listOpen({ kind: 'discount', subject: bill })` and 02b `comp` requests of the orders (2).
  3. §3.3 rules 1–9 in order (first failure throws; nothing written).
  4. `computeSplit` with the split's payments → totals, tax rows, rounding, change (attributed to the last cash payment's shift).
  5. Number: `SELECT COALESCE(MAX(number), 0) + 1 FROM invoices WHERE series = 'sale'` (1); `invoice_ref = invoice_prefix + zero-padded number`.
  6. Drafts: `InvoiceIssued { invoice_id, series: 'sale', number, invoice_ref, bill_id, split_no, business_date, issued_at, order_type, lines: [{ order_item_id, name, units, unit_price_minor, base_minor, discount_minor, tax_class_id }], subtotal_minor, discount_minor, service_charge_minor, taxes: [...], rounding_minor, total_minor, payment_class, mixed_rule, payment_ids, change_minor, change_shift_id, fiscal: { authority, pos_id, required }, has_buyer_id, buyer_id_refused, closed_by }`; when this is the **last open split**: 02b `OrdersBilled { order_ids, bill_id }` (stream `order`, first order) and, for dine-in on the first full close only (`bill_closed_written = 0`), 02a `BillClosed { seating_id }` (stream `table`, primary table); `AlertClosed` drafts (`obsolete`, note `bill_closed`) for open `comp` requests on the bill's lines (02b To 05) and for any open 05 request on the bill.
  7. Append (00) → projections fold (billing: invoice, outbox row; shifts: takings, change; 02b `billed_at`; 02a NEEDS_CLEANING) → `invoice_buyers` insert when `buyer` is present (1) → receipt: `billPrinterFor({ device_id })` (1), `buildReceiptDoc` (fiscal block = "FISCAL NUMBER PENDING" when `required`, B21; buyer name and the **last 4** of the ID number on paper; drawer block when a cash payment exists) → `printDocument` (2) + `bill_print_jobs` (1).
  8. COMMIT → respond → WS (`InvoiceIssued` to the bill's audience; `BillClosed` per 02a).
- **Result:** `{ invoice_id, invoice_ref, total_minor, change_minor, bill_state, receipt: { job_id | null, printer_name | null }, fiscal_state: 'pending' | 'not_required' }`.
- **Statements:** ≤ 18, fixed (no per-line or per-payment statement). Not an engine command (no `EngineState` change) — but it appends events in a transaction with folds: COMMIT-failure test asserts no outbox row, no print job, no buyer row (§10 #36).
- **Audit:** `invoice_issued` (number, total, class, has_buyer_id only).

#### 6.13 `ReopenBill` — `{ bill_id, reason_code ∈ BILL_REOPEN_REASONS, note? }` (approvable)

- **Permission:** `reopen-bill` (`branch`), approvable.
- **Script:** Zod → bill CLOSED or PARTLY_PAID (`409 BILL_NOT_OPEN { state }`) → an open `reopen_bill` request on the bill (`alerts.listOpen`, 1) → `409 BILL_REOPEN_PENDING { alert_id }` → invoices of the bill (1) → `allowed` → drafts per §3.10: `BillReopened { bill_id, reason_code, note, requester_staff_id, approver_staff_id: null, alert_id: null }`, one `InvoiceCredited { invoice_id (new), series: 'credit', number (MAX+1 of credit, 1), invoice_ref, ref_invoice_id, ref_invoice_ref, bill_id, split_no, business_date (today), …the original's amounts, fiscal }` per current sale invoice, `OrdersUnbilled` when CLOSED → `requires_approval` → kind `reopen_bill` (values `{ bill_id }`; `apply` builds the same drafts read-only, numbers from the answer transaction's read view). On both paths the credit note is printed by the live-only fold of `InvoiceCredited` (§3.16), never by the command, so it prints once.
- **Result:** `{ reopened: { credits: [{ invoice_ref, total_minor }] } } | { pending: { alert_id } }`. **Statements:** ≤ 7. **Audit:** `bill_reopened`, `invoice_credited`.

#### 6.14 `RemoveComp` — `{ order_item_id, units?, reason_code ∈ COMP_REMOVE_REASONS, note? }` (approvable)

- **Permission:** `remove-comp` (`branch`), approvable.
- **Script:** `readOrder` (1) → order not billed (`409 ORDER_BILLED`), line comped (`409 LINE_NOT_COMPED { order_item_id }`), `units ≤ comped_units` (`400`) → line guard list (02b, 1: a void pending on it → `409 VOID_PENDING`; partly paid → `409 BILL_PARTLY_PAID`) → `planCompRemoval` (02b) → `allowed` → `LineCompRemoved { …, approver_staff_id: null, alert_id: null }` (02b event, 05 writes it); `requires_approval` → kind `remove_comp` (dedupe `remove_comp:<order_item_id>`).
- **Result:** `{ removed: { units, comp_minor } } | { pending }`. **Statements:** ≤ 4. **Audit:** `comp_removed`.

### Batch 2 — shifts, petty cash, drawer

#### 6.15 `OpenShift` — `{ float_minor, as_drawer: boolean }`

- **Permission:** `manage-own-shift`.
- **Script:** Zod (`float_minor` 0…100 000 000) → business day open (`409 BUSINESS_DAY_NOT_OPEN`, 01a's code) → caller has no open shift (`409 SHIFT_ALREADY_OPEN { shift_id }`) → `as_drawer`: the device is a `cashier_kiosk` or a tablet with a printer route (else `422 DRAWER_DEVICE_INVALID { device_id }`), and no open shift holds this device (`409 DRAWER_IN_USE { shift_id, staff_name }`) → `ShiftOpened { shift_id, staff_id, drawer_device_id | null, float_minor, business_date }` → drawer kick (`printDocument` with `{ drawer: true }` on the device route) when `float_minor > 0`.
- **Result:** `{ shift_id, opened_at }`. **Statements:** ≤ 5. **Audit:** `shift_opened`.

#### 6.16 `GET /queries/shift?shift_id?`

- **Permission:** own shift → `manage-own-shift`; another's → `close-shift-for-others`.
- **Result:** `{ shift_id, staff_name, state, is_drawer, opened_at, float_minor, takings: [{ mode_id, mode_name, payment_class, in_minor, out_minor, change_minor, by: [{ taken_by_name, in_minor }] }], petty: [{ entry_id, kind, amount_minor, category_name, paid_to, advance_staff_name, settled }], open_advances_minor, handovers: [...], counted_minor | null, expected_minor | null, variance_minor | null }`. **Blind rule (B23):** `expected_minor` and `variance_minor` are `null` unless `counted_at` is set (a handover row shows the expected of its own count only); card / online takings **are** shown (they are checked against the terminal, story 7 AC5); the cash line shows only the count of cash payments, never their sum, before the count. **Statements:** 4.

#### 6.17 `CountShift` — `{ shift_id, counted_minor }`

- **Permission:** own → `manage-own-shift`; other → `close-shift-for-others`.
- **Script:** shift OPEN (`409 SHIFT_NOT_OPEN { reason: 'not_open' }`; a COUNTED shift after a rejected variance accepts a recount) → `ShiftCounted { shift_id, counted_minor, expected_minor, variance_minor, by_staff_id }` (expected from the running fold).
- **Result:** `{ expected_minor, variance_minor, over_threshold }` — the first time the server reveals expected. **Statements:** 2. **Audit:** `shift_counted`.

#### 6.18 `CloseShift` — `{ shift_id, skip_count?: true, note? }`

- **Permission:** own → `manage-own-shift`; other → `close-shift-for-others`; `skip_count` → also `skip-blind-count` (`403 PERMISSION_DENIED { reason: 'skip_not_granted' }`).
- **Script:** shift exists (`404 SHIFT_NOT_FOUND`), not closed → not counted and no `skip_count` → `409 SHIFT_NOT_COUNTED` → `skip_count` → `ShiftCountSkipped` + `ShiftClosed` → `|variance| ≤ variance_threshold_minor` → `ShiftClosed { shift_id, closed_by, alert_id: null, approver_staff_id: null }` → else an open `shift_variance` request for the shift → the same `{ pending: { alert_id } }` again (no new raise) → else `raiseMany` kind `shift_variance` (`details { variance_minor, expected_minor, counted_minor }`, approvers §3.14) → `{ pending }`. Approve → `apply` returns `ShiftClosed { alert_id, approver_staff_id }`. Reject → `apply` returns `[]`; the shift stays COUNTED and accepts a recount (§6.17) and a new `CloseShift`. Open advances are listed in the result, never blocking.
- **Result:** `{ closed: { shift_id } } | { pending }`. **Statements:** ≤ 5. **Audit:** `shift_closed` / `shift_count_skipped`.

#### 6.19 `HandoverCount` — `{ shift_id, counted_minor }`

- **Permission:** `manage-own-shift` on own drawer shift, else `close-shift-for-others`. Drawer shift OPEN → `HandoverCounted { shift_id, counted_minor, expected_minor, variance_minor, by_staff_id }`; the shift stays OPEN; the result reveals expected (it is a count). **Statements:** 2. **Audit:** `handover_counted`.

#### 6.20 `RecordPettyCash` — `{ kind, amount_minor, category_id, paid_to?, advance_staff_id?, note? }` (approvable) and `SettlePettyAdvance` — `{ entry_id, spent_minor, returned_minor, note? }`

- **Record:** `record-petty-cash`, approvable. Caller's money shift (B11; cash) → else `409 SHIFT_NOT_OPEN` → category active (`422 CONFIG_REFERENCE_INVALID { field: 'category_id', reason: 'not_found' }`) → advance needs `advance_staff_id` in the directory (`422 … 'advance_staff_id'`) → `out` / `advance` ≤ the shift's expected cash (`409 PETTY_CASH_EXCEEDS_DRAWER {}` — the response never states the amount, B23) → grant `allowed` and `amount ≤ petty_cash_limit_minor` → `PettyCashAdvanced` / `PettyCashOut` / `PettyCashIn { entry_id, shift_id, amount_minor, category_id, paid_to, advance_staff_id, note, requester_staff_id, approver_staff_id: null, alert_id: null }` + drawer kick → else kind `petty_cash` (values carry the whole entry; `apply` returns the event; the drawer kick on approval is the requester's next `OpenCashDrawer`, not automatic).
- **Settle:** `record-petty-cash` `allowed`. Advance open (`404 PETTY_CASH_NOT_FOUND`, `409 PETTY_ADVANCE_SETTLED`), `spent + returned = amount` (`422 PETTY_SETTLE_MISMATCH { amount_minor }`) → caller's money shift (the returned cash lands there) → `PettyCashSettled { entry_id, shift_id, spent_minor, returned_minor, note }`.
- **Statements:** ≤ 4 each. **Audit:** `petty_cash` (kind, amount, category; `paid_to` and names never in the audit detail).

#### 6.21 `OpenCashDrawer` — `{ reason_code: 'change_for_customer' | 'check_cash' | 'other', note? }`

- **Permission:** `open-cash-drawer`. The device is a drawer of an open shift (`409 SHIFT_NOT_OPEN { reason: 'no_drawer_shift' }`) → `DrawerOpened { shift_id, device_id, reason_code, note }` → `printDocument` (`{ drawer: true }`). **Statements:** 4. **Audit:** `drawer_opened`.

### Batch 3 — day close, reports, printing, fiscal

#### 6.22 `PrintBillDocument` — `{ doc: 'receipt' | 'credit_note' | 'x_report' | 'z_report', ref_id?, printer_id? }`

- **Permission:** `receipt` / `credit_note` → `take-payment`; `x_report` / `z_report` → `view-reports`.
- **Script:** the invoice (`404 INVOICE_NOT_FOUND`) / the Z (`404 Z_REPORT_NOT_FOUND`) / the open day's X from the projections (≤ 6) → builder (a receipt reprint is marked `REPRINT`, shows the fiscal number + QR once `FiscalNumberAssigned` exists, else "FISCAL NUMBER PENDING"; buyer from `invoice_buyers`, last 4 only) → printer (payload, else route) → `printDocument` + `bill_print_jobs` → no event (a reprint changes no money; the audit of reprints is 03c's `document` job list). **Statements:** ≤ 9.

#### 6.23 `RetargetBillPrint` — `{ job_id, printer_id }`

- **Permission:** `take-order` or `take-payment`. `bill_print_jobs` row exists (`404 PRINT_JOB_NOT_FOUND`) → `retargetDocumentJob` (03c row P-2; `409 PRINT_JOB_NOT_PENDING` when printed / being sent / cancelled; `404 PRINTER_NOT_FOUND`). No event. **Statements:** 3. Result: the job's new status.

#### 6.24 `CarryOverOrders` — `{ order_ids: string[1..40], reason_code ∈ CARRY_OVER_REASONS, note? }`

- **Permission:** `close-business-day`. Each order unbilled and not cancelled (`409 ORDER_BILLED` / `400` per index) → `OrdersCarriedOver { order_ids, business_date, reason_code, note }` (`hub` stream). They survive this day's close only. **Statements:** 2. **Audit:** `orders_carried_over`.

#### 6.25 Day close — 01a `CloseBusinessDay` with 05's guard and appender (rows A-3, A-4, A-5)

- **05 guard** (after 04's): open shifts of any day (1, `shifts_open_staff`) → `409 DAY_CLOSE_BLOCKED { reason: 'shift_open', shifts, count }`; unbilled, uncancelled, not carried orders (1) → `{ reason: 'unbilled_orders', orders, count }` (≤ 40 listed, `count` via `COUNT(*) OVER ()`).
- **05 appender:** open 05 requests + 02b `comp` requests (`alerts.listOpen`, 1) → `AlertClosed { outcome: 'obsolete', note: 'day_closed' }` drafts (01d `close` helper); Z number = MAX + 1 (1); `buildReport` over the day (§6.26, ≤ 6) → `ZReportIssued { business_date, z_no, report }` (`hub` stream). The live-only fold prints it at the `report` route.
- **Bound:** 05 adds ≤ 10 statements to the close. **Engine:** the command already has its COMMIT-failure test; 05 adds one asserting no `ZReportIssued`, no `z_reports` row and no print job after a failed COMMIT (§10 #63).

#### 6.26 `GET /queries/x-report` and `GET /queries/z-reports?business_date?|cursor&limit`

- **Permission:** `view-reports`.
- **Report content (B26, `buildReport`):** sales: sale invoices count, gross (Σ subtotal), discounts (count, value, by reason, requester / approver / method from the audit fold), service charge, net, **tax by class and payment class** with rate, rounding, total; credits (count, value, by reason) and **net = sales − credits**; payments by mode (in, out, change); comps (value), voided comps (`comp_voided_minor`, 02b O21), comp removals; voids by disposition (wastage / staff meal / moved / null, count and value, 04 G-8, from `ItemVoided`); reopens (count, value, requester, approver); petty cash by category and kind, open advances (who, amount, age); per shift: staff, float, expected, counted, variance, skipped flag, takings by taker (Q10); fiscal: invoices pending / acked / rejected / not required; bills count, average bill, open bills (X only, with "open too long" flags, M-8); carried-over orders (Z of the day they are carried into lists them as "carried in"). **X** = the same over the open day, the shifts' expected cash **hidden** for shifts not counted (B23).
- **Statements:** X ≤ 8 fixed (invoices + taxes of the day, payments by mode, shifts + takings, petty, audit rows for discounts / reopens / voids of the day, outbox counts, open bills); Z list: 1 (cursor, F §6.3).
- **Invariant (property test):** Z net = Σ sale totals − Σ credit totals of the day = Σ over the day's shifts of (cash in − change − cash out) + Σ non-cash in − Σ non-cash out.

#### 6.27 `GET /queries/fiscal-status`

- **Permission:** `take-payment` or `view-reports`.
- **Result:** `{ authority, environment, adapter_health: 'ok' | 'failing' | 'unknown', last_success_at, pending_count, oldest_pending_age_ms, rejected_count, catch_up_window_ms, stuck: boolean, token_missing_pos_ids: [pos_id] }` — never a token, never a buyer. **Statements:** 2.

#### 6.28 `RetryFiscalNow` — `{}`

- **Permission:** `close-business-day`. Sets `next_try_at = now` for `pending` rows (plain statement, not an event; 1) and wakes the worker; a `rejected` row is **not** resent here (it needs the fix the rejection names; a developer task). Result `{ pending_count }`.

#### 6.29 Events (`schema_version` 1, `.strict()`, `@pos/events/src/events/<stream>/`)

| Event | Stream | Payload (besides ids named) | Folded by |
|---|---|---|---|
| `BillOpened` | bill | `{ bill_id, scope, seating_id, order_id, order_type }` | billing |
| `ChargeApplied` | bill | `{ bill_id, charge: 'service', rate_bp, source: 'rule' \| 'manual', note }` | billing |
| `ChargeRemoved` | bill | `{ bill_id, charge, reason_code, note, requester_staff_id, approver_staff_id, alert_id }` | billing |
| `CheckBillPrinted` | bill | `{ bill_id, total_default_minor, line_count, printer_id, job_id, source }` | billing |
| `BillSplitsSet` | bill | `{ bill_id, mode, splits }` | billing |
| `DiscountApplied` / `DiscountRemoved` | bill | §6.6 / §6.7 | billing |
| `PaymentAdded` / `PaymentRemoved` | bill | §6.9 / §6.10 | billing, shifts |
| `BuyerIdWaived` | bill | `{ bill_id, requester_staff_id, approver_staff_id, alert_id }` | billing |
| `InvoiceIssued` | bill | §6.12 step 6 (no buyer ID, ever) | billing, shifts |
| `BillReopened` | bill | §6.13 | billing |
| `InvoiceCredited` | bill | §6.13 | billing |
| `FiscalNumberAssigned` | bill | `{ invoice_id, authority, pos_id, fiscal_number, qr_payload }` (worker) | billing |
| `FiscalSubmitRejected` | bill | `{ invoice_id, authority, error_code (≤ 40), http_status }` (worker; no request body) | billing |
| `ShiftOpened`, `ShiftCounted`, `ShiftCountSkipped`, `HandoverCounted`, `ShiftClosed` | shift | §6.15–§6.19 | shifts |
| `PettyCashAdvanced`, `PettyCashSettled`, `PettyCashOut`, `PettyCashIn` | shift | §6.20 | shifts |
| `DrawerOpened` | shift | §6.21 | shifts |
| `OrdersCarriedOver`, `ZReportIssued` | hub | §6.24, §6.25 | billing |
| 02b `OrdersBilled`, `OrdersUnbilled`, `LineCompRemoved`; 02a `BillClosed` | order / table | owned by 02b / 02a (rows Q-2, Q-4), written by 05 | orders, tables |

Events written by approval `apply` carry the request's `alert_id` and `approver_staff_id` = `AnswerFacts.answerer_staff_id` (01d contract). Builders in `@pos/events/testing` for each (F §6.7) and one fixture per event.

#### 6.30 Registrations at startup (`apps/hub/src/billing/index.ts`)

Projections `billing`, `shifts` (after `orders`, `tables`, `audit`); live-only print folds (`BillRequested`, `InvoiceCredited`, `ZReportIssued`); the eight alert kinds (§3.14, `fiscal_outbox_stuck`) at module top level (01d boot rule); `registerDayCloseGuard`, `registerDayCloseAppender` (rows A-3, A-4); `registerMergeGuard` (row T-1); `registerLineGuard` (row Q-3); `registerFiscalAdapter(noneAdapter)`, `registerFiscalAdapter(praAdapter)`; `registerAuditAction` for each event in row V-3 (map: actor = requester for approved actions, approver from the event, `subject_type 'bill' | 'shift' | 'order' | 'day'`, `amount_minor`, `reason`; detail ≤ 2 KB with ids and counts; **no buyer fields, no `paid_to`, no notes beyond the reason**); `startFiscalWorker` via 00 row H-3.

#### 6.31 Example — Table 7, Rs 5,710 of food (one class, restaurant service), PRA, rounding step Rs 1

1. Waiter taps **Ask for bill** → 02a `BillRequested` → 05 prints the check bill at the first-floor bill printer: subtotal 5,710.00; tax 16 % (cash) 913.60 → total if paid in cash **6,624.00** (rounding +0.40); a line "card / wallet / QR: 5,996.00". Banner `PROVISIONAL - NOT A TAX INVOICE`. `bill_requested` audit row.
2. All by card: the cashier taps Card → the screen shows 5,710 + 285.50 = 5,995.50 → **5,996.00** (+0.50) → `AddPayment` card 5,996.00 → `CloseSplit { expected_total_minor: 599600 }` → `InvoiceIssued` `AC1-000123` (class digital, tax row 500 bp), `OrdersBilled`, `BillClosed`; outbox row pending; receipt "FISCAL NUMBER PENDING" if the worker has not answered yet; no drawer kick.
3. Mixed instead, Rs 3,000 card + rest cash: `higher_rate` (PRA default) → the whole split at 16 % → 6,624.00, card 3,000 + cash 3,624. With `pro_rata` set: digital net share = ⌊300 000 × 10 000 / 10 500⌋ = 285 714 paisa (tax 14 286), cash net 285 286 (tax 45 646) → 630 932 → **6,309.00** (−0.32); card 3,000 + cash 3,309.
4. Worker posts to PRA (`InvoiceType` 1, `PaymentMode` 2 or 5, USIN `AC1-000123`) → `FiscalNumberAssigned`; a reprint shows the PRA number and QR.

---

## §7. Cross-cutting (each item with the failure it prevents)

| Item | Rule | Prevents |
|---|---|---|
| Transactions | Every 05 command in one `BEGIN IMMEDIATE`; close / reopen / day-close checks inside it (F §6.3) | void approved, weight entered or a second kiosk closing between check and write (F §1 race table) |
| Idempotency | `command_id` (D32) for every command; the fiscal outbox keyed by `invoice_id`, USIN = `invoice_ref` | double invoice on a retransmit; double fiscal post after a crash |
| Gap-free numbers | `MAX + 1` under the single writer + unique index | a gap or duplicate an authority audit would flag |
| Fiscal worker | one in flight; back-off 5 s → 30 s → 2 min → every 5 min; HTTP timeout 10 s; never on a command path; started after listen (row H-3); paused while the hub has no route to the internet (`fetch` fails fast) | close waiting for the internet; a flood of retries on a dead link |
| Stuck alert | §3.15; one alert per branch | an invoice missing the PRA window unnoticed (r.8(3)) |
| Privacy | buyer ID only in `invoice_buyers`; receipts print the last 4; no response returns it; logs carry ids and counts only (B30); `details` / audit / Z never carry names beyond the existing `staff_names` read model, never buyer data, never `paid_to` | CNIC leaks into the immutable, synced log or the cloud |
| Secrets | tokens only in the hub config file (row H-2); the adapter reads at send; error texts from the authority are stored as a short code | a token in the repo, a log or the cloud |
| Blind count | `expected_*` fields null before `ShiftCounted`, enforced in the query and command result builders (one function); test per response | cashier sees expected before counting (D21) |
| Rate effective date | issue date = local calendar date of `issued_at` in the hub's time zone (01a S47 rule); the bill view shows the rate row's ref | wrong rate on the notification day |
| Performance | close ≤ 18 statements, bill view ≤ 9, X ≤ 8 (fixed, no N+1); no timing assert in the gate (03a AD-32); `test:perf` adds a 200-bill rush close row on the pilot box | close slow at peak (200 bills / rush, R6) |
| Rate limits | none new (LAN, PIN lockout covers PIN answers, 01d) | — |
| Offline | close, payments, shifts, petty cash, day close work on the LAN without internet (G0-1); only the fiscal answer waits | billing stops when the internet drops (E5) |
| Folder | `apps/hub/src/billing/{commands,queries,projections,fiscal,print,kinds,lanes}/`, `packages/domain/src/billing/`, `packages/events/src/events/{bill,shift}/`, `apps/client/src/features/billing/` (F §6.9 `features/cashier` named `billing`); no new top-level folder | — |

---

## §8. Client contract (`apps/client`, staff entry; R5 permission-derived; ui-kit only)

- **Cashier screen** (kiosk / tablet with `take-payment`): open-bills list (§6.2) pulled on focus, on `event` frames of bill / order / table streams and on reconnect; "check bill printed" badge; "open too long" flag; partly-paid badge. No push, no sound for bill requests (Q13).
- **Bill screen:** lines with COMP / PENDING VOID / WEIGHT NEEDED tags; totals from the server only (§6.1) — the client never computes tax; **no tax buttons** (G1-15); the payment-mode pad shows each mode; choosing a mode shows the total at that class before taking it (M-7); tendered amount entry with change due (M-6; never pre-filled with the total); split editor (items / amount / equal); discount sheet (reason buttons from settings, approval waiting card); service charge row with Remove / Add back; buyer sheet when `buyer.required` (name + CNIC / NTN, "Customer refuses" → `WaiveBuyerId`); Close button disabled with the server's `blocks` text; `BILL_TOTAL_CHANGED` → refresh and show the new total, never auto-close. Online-only actions show "Needs the hub" offline (G0-1).
- **Print status:** each bill document shows waiting / printed / failed with the printer name; on failed or waiting > 10 s a **Print to** picker lists active printers (`RetargetBillPrint`, B18).
- **Shift:** open with float; close shows card / online totals and asks for the counted cash **before** any expected figure; variance result after the count; "Waiting for manager" on a variance request; open advances list; handover count (drawer shifts).
- **Petty cash:** advance / out / in sheet with categories; open advances with Settle.
- **Day close** (staff app, `close-business-day`): blockers list (voids, open shifts, unbilled orders with Carry over), then Close; Z shown and printed. `/admin/stock` keeps its Close day (row A-5).
- **Reports:** X (any time) and Z list (`view-reports`); fiscal status line (pending count, oldest age) on the cashier screen when the adapter is not `none`.
- **Errors:** every §9 code has an `errors.<code>` key (EN + UR, D12); `DAY_CLOSE_BLOCKED` reasons render as lists.
- **i18n:** amounts formatted only in the client (D47); Latin digits in Urdu (R20).
- **Owner app** (01a row A-1 (6)): Billing settings page with the receipt preview (`renderText`) and the fiscal catalog; no secret field.

---

## §9. Error catalogue additions (Foundation §6.2; appended to the status map and `@pos/domain/src/errors.ts` at build, no bump on its own, R34)

| Code | Status | `details` | Returned when |
|---|---|---|---|
| `BILL_NOT_FOUND` | 404 | `{ bill_id }` | unknown bill id |
| `SHIFT_NOT_FOUND` | 404 | `{ shift_id }` | unknown shift |
| `INVOICE_NOT_FOUND` | 404 | `{ invoice_id }` | reprint of an unknown invoice |
| `PAYMENT_NOT_FOUND` | 404 | `{ payment_id }` | remove of an unknown / already removed payment |
| `PAYMENT_MODE_NOT_FOUND` | 404 | `{ mode_id }` | mode unknown or inactive in the branch settings |
| `PETTY_CASH_NOT_FOUND` | 404 | `{ entry_id }` | settle of an unknown advance |
| `Z_REPORT_NOT_FOUND` | 404 | `{ business_date }` | reprint of a Z that does not exist |
| `BILL_NOT_OPEN` | 409 | `{ bill_id, state }` | the bill / split is closed, absorbed, or its order cancelled |
| `BILL_CLOSE_BLOCKED` | 409 | `{ reason: 'void_pending' \| 'weight_pending' \| 'lines_unassigned', order_item_ids }` (≤ 40) | §3.3 rules 2, 3, 5 |
| `DISCOUNT_PENDING` | 409 | `{ alert_id }` | a discount request on the bill is open (close, second discount) |
| `BUYER_ID_REQUIRED` | 409 | `{ threshold_minor, net_minor }` | §3.3 rule 6 |
| `BILL_TOTAL_CHANGED` | 409 | `{ expected_minor, total_minor }` | §3.3 rule 7 |
| `BILL_BALANCE_DUE` | 409 | `{ split_no, balance_minor }` | §3.3 rule 8 |
| `BILL_PARTLY_PAID` | 409 | `{ bill_id }` | line edit, void, comp, weight, split re-plan on a bill with a closed split (B15) |
| `BILL_HAS_PAYMENTS` | 409 | `{ bill_id, split_nos? }` | merge / seating split with payments; a re-plan that drops a paid split |
| `BILL_REOPEN_PENDING` | 409 | `{ alert_id }` | a reopen request on the bill is open |
| `LINE_NOT_COMPED` | 409 | `{ order_item_id }` | `RemoveComp` on a line with no comped units |
| `SHIFT_NOT_OPEN` | 409 | `{ reason: 'no_shift' \| 'no_drawer_shift' \| 'not_open' }` | money with no money shift; drawer action off a drawer; count of a closed shift |
| `SHIFT_ALREADY_OPEN` | 409 | `{ shift_id }` | second open shift for one person |
| `SHIFT_NOT_COUNTED` | 409 | `{ shift_id }` | close before a count without `skip_count` |
| `DRAWER_IN_USE` | 409 | `{ shift_id, staff_name }` | the device is already another open shift's drawer |
| `PETTY_ADVANCE_SETTLED` | 409 | `{ entry_id }` | settling a settled advance |
| `PETTY_CASH_EXCEEDS_DRAWER` | 409 | `{}` (never the amount, B23) | a cash-out / advance above the shift's expected cash |
| `BILL_SPLIT_INVALID` | 422 | `{ reason: 'units_exceed' \| 'deal_whole' \| 'option_with_parent' \| 'shares_sum', order_item_id?, expected_minor? }` | §3.8 |
| `DISCOUNT_TOO_LARGE` | 422 | `{ max_minor }` | discount above the target or `max_discount_pct` |
| `PAYMENT_EXCEEDS_BALANCE` | 422 | `{ balance_minor }` | non-cash above the balance; `out` above the negative balance |
| `PAYMENT_REFERENCE_REQUIRED` | 422 | `{ mode_id }` | mode needs a reference |
| `DRAWER_DEVICE_INVALID` | 422 | `{ device_id }` | `as_drawer` on a device that cannot hold a drawer |
| `PETTY_SETTLE_MISMATCH` | 422 | `{ amount_minor }` | spent + returned ≠ the advance |

Reused (not new): `DAY_CLOSE_BLOCKED` (04) gains `reason: 'shift_open' \| 'unbilled_orders'` (shapes §3.13); `ORDER_BILLED`, `VOID_PENDING`, `TABLE_NOT_OPEN`, `BUSINESS_DAY_NOT_OPEN`, `PRINTER_NOT_FOUND`, `PRINT_JOB_NOT_FOUND`, `PRINT_JOB_NOT_PENDING`, `PERMISSION_DENIED` (new reasons `not_own_payment`, `skip_not_granted`), `CONFIG_REFERENCE_INVALID`, `VALIDATION_FAILED`. G0-7's `REFUND_EXCEEDS_PAID` is not created (no refund command, Q8).

---

## §10. Tests (`apps/hub/test/billing/*.int.test.ts`, `packages/domain/src/billing/*.test.ts`, `apps/hub/test/billing/fiscal/*.test.ts`; client tests in `apps/client/src/features/billing/`)

Every command also has: happy path, one test per error code it returns, retransmit returns the identical response and writes nothing (D32), and every grant state of its permission (`allowed`, `requires_approval`, not granted, out of scope; 04 G1-7 pattern). **HIGH** tests (G0 §5, G1-13) are marked **H**.

### 10.1 Bill, splits, discount, charges

1. Projected bill (no 05 event yet) equals the bill after `BillOpened` for the same lines (same `computeBill`).
2. Dine-in bill follows `seating_orders`: a second round joins; a cancelled order leaves; an archived table's order stays billable (01a §6.5).
3. Takeaway bill = one order; close allowed before any `ItemServed` (Q2, B16); afterwards `RemoveItems` / `VoidItems` → `ORDER_BILLED`.
4. Lines: COMP shown at value with deduction; PENDING VOID tagged and only `refund_minor` subtracted (a comped unit's `comp_voided_minor` not); return line base 0; pending weight 0 and listed in `blocks`.
5. **H** close refused for each §3.3 rule 1–9, in order, each with its code; nothing written (no event, outbox, job, buyer row).
6. `BillClosed` reaches 02a's audience; the tile turns NEEDS_CLEANING; takeaway writes no `BillClosed`.
7. Item split: units over 2 splits; a deal whole; an option child with its parent; `units_exceed`, `deal_whole`, `option_with_parent` refusals.
8. Amount split: Σ shares must equal the default-class total (`shares_sum`); equal into 3 of Rs 1,000.00 → 333.34 / 333.33 / 333.33 net shares by `allocateDealMinor`.
9. Re-plan keeps a paid split's number; dropping it → `BILL_HAS_PAYMENTS`; after the first close → `BILL_PARTLY_PAID`.
10. **H** property: for random bills (1–40 lines, 1–3 classes, discounts, service charge, item / amount / equal splits, random payment classes) Σ split `S` = Σ line bases; Σ printed tax = Σ invoice tax rows; one rounding per split; no negative figure.
11. **H** tax table tests: exclusive and inclusive prices; 500 / 1600 bp; half-up at each named point only; a BigInt-sized product (Rs 9,999,999 × 1600 bp) exact.
12. Deal taxed under the deal's class on its whole billed amount; option child under its own; never from `allocated_price_minor` (README :214).
13. **H** G1-15: a bill with lines in two classes shows two tax rows, each on its own lines' base only; no line in two classes; `tax_enabled = false` or a null class → no tax.
14. **H** rate by date: a rate row effective tomorrow is not used today; at the effective date it is; the bill view shows the row's ref; an owner override beats the catalog row; adapter `none` uses `rate_bp`.
15. **H** mixed classes: `higher_rate` → cash rate on the whole split; `pro_rata` → §6.31 step 3 numbers exactly; both equal when one class only.
16. Discount amount / percent, spread by `allocateDealMinor`, tax after discount (PRA example); `DISCOUNT_TOO_LARGE`; discount on one split leaves the others.
17. Discount `requires_approval` → request; approve → `DiscountApplied { alert_id, approver_staff_id = answerer }`; close refused while pending (`DISCOUNT_PENDING`); withdraw → nothing; the bill closed meanwhile → `apply` throws, the answer is refused.
18. **H** sticky charge (M-3): remove → reopen / check-bill print / split / merge / move / bill view / re-close → still removed; `ApplyServiceCharge` re-adds with `source: 'manual'`.
19. Service charge rate is the order type's at bill creation; a settings change later does not change an open bill.
20. Rounding step 100 / 500 / 1 000, methods nearest / down / up; the rounding line on the receipt.

### 10.2 Payments, close, invoices

21. Cash tendered above balance → change at close; change attributed to the last cash payment's shift.
22. Card above balance → `PAYMENT_EXCEEDS_BALANCE`; reference required → `PAYMENT_REFERENCE_REQUIRED`.
23. **H** property: Σ in − Σ out − change = split total at every close; change ≤ Σ cash tendered.
24. Mode switch recomputes the total in the `AddPayment` result (M-7).
25. `RemovePayment` own; another's needs `close-shift-for-others` (`not_own_payment`).
26. **H** gap-free numbers: 200 closes interleaved with rollbacks (forced failures) leave numbers 1..200 with no gap; credit series separate.
27. `expected_total_minor` stale after a void approval between view and close → `BILL_TOTAL_CHANGED`.
28. **H** race: two kiosks close the same split → one invoice, the other `BILL_NOT_OPEN`; a void approved while closing → close refused or void refused (`ORDER_BILLED`), never both through.
29. Last split writes `OrdersBilled` (all the bill's orders) and `BillClosed` once; earlier splits write neither.
30. Close closes open `comp` requests on the bill's lines `obsolete` (02b To 05).
31. Pending void blocks close (04 `pendingVoids`); after approve the bill drops the line and closes.
32. Partly paid bill: `RemoveItems`, `CompLine`, `SetLineWeight`, `VoidItems` → `BILL_PARTLY_PAID` (rows Q-3, V-1); a new round joins the open split.
33. Pending weight with `live_units > 0` blocks; a voided pending-weight line (`live_units = 0`) does not (04 R-4).
34. Receipt `Doc`: number, lines, discount, service charge, tax per class with rate and payment class, rounding, total, payments, change, NTN / header / footer per template, "FISCAL NUMBER PENDING" when fiscalized and not answered, drawer block only with cash.
35. No printer routed → close succeeds, `receipt.job_id = null`, logged with ids.
36. **H** forced COMMIT failure on `CloseSplit` → no event, no outbox row, no print job, no `invoice_buyers` row, no `processed_commands` row.

### 10.3 Reopen, remove comp, buyer ID

37. **H** reopen a closed 2-split bill → two `InvoiceCredited` (credit series 1, 2, each the full original), `OrdersUnbilled`, splits open with payments; re-close → new sale numbers; `BillClosed` not written again.
38. **H** reopen after an earlier business day → credits and new invoices in today's Z; the old Z unchanged.
39. Reopen approvable: approve → same drafts with `alert_id`; reject / withdraw → nothing; dedupe → `BILL_REOPEN_PENDING`.
40. Reopened bill with a lower total → negative balance → `AddPayment { direction: 'out' }` from the closer's shift; above it → `PAYMENT_EXCEEDS_BALANCE`.
41. `RemoveComp` on an unbilled comped line → `LineCompRemoved`, bill rises; billed line → `ORDER_BILLED`; not comped → `LINE_NOT_COMPED`; void pending on it → `VOID_PENDING`; approval path.
42. **H** buyer ID: whole-bill net above Rs 50,000 split into two splits each below → still required on each split; a waiver covers every split and survives a reopen; a bill under the threshold never asks; adapter `none` never asks.
43. **H** redaction: a close with a CNIC leaves the number in `invoice_buyers` only — not in any event payload, log line (captured logger), alert `details` / `display`, audit row, Z / X, query response or receipt beyond the last 4.
44. A takeaway closed before the food and reopened → credit + `OrdersUnbilled`; the kitchen keeps cooking (engine unaffected).

### 10.4 Shifts, petty cash, drawer

45. Open shift with float; second → `SHIFT_ALREADY_OPEN`; drawer taken → `DRAWER_IN_USE`.
46. **H** blind count: every `shift` query, `CloseShift` and X response before `ShiftCounted` has `expected_minor = null` and no cash sum; the `CountShift` response is the first with it (a `HandoverCount` reveals only its own handover's expected, §6.19).
47. **H** property (expected cash, G1-8, Q10): random payments (two takers on one drawer), change, outs, advances, settles (on another shift), cash-outs, cash-ins → the fold's expected = §3.7 formula; Σ shifts' takings = Σ the day's invoices − credits by mode.
48. Takeover on a drawer kiosk: the second person's cash and card land in the drawer shift with `taken_by` = them; the drawer close shows the breakdown by taker.
49. Order taker with `take-payment` (`own_tables`) and own shift: collects on own table only (`outside_scope` otherwise) into own shift.
50. Variance within threshold → closed; above → `shift_variance` request; approve → `ShiftClosed { alert_id }`; reject → recount allowed.
51. `skip_count` needs `skip-blind-count` (default Owner only) and is audited.
52. Handover count records a variance and the shift stays open.
53. Petty cash: advance + settle (spent + returned = amount, else `PETTY_SETTLE_MISMATCH`), out, in; over the limit → request; `requires_approval` grant → request always; above drawer cash → `PETTY_CASH_EXCEEDS_DRAWER {}`.
54. Open advances listed at shift close and on X / Z; never block.
55. `OpenCashDrawer` off a drawer → `SHIFT_NOT_OPEN { reason: 'no_drawer_shift' }`; on a drawer prints the kick and audits.

### 10.5 Merges, splits of tables, printing

56. Merge with no payments: the absorbed bill folds into the survivor; a removed service charge on the survivor stays removed.
57. Merge / seating split with payments → `BILL_HAS_PAYMENTS` (05 guard after 04's).
58. `BillRequested` → check bill at the zone's bill printer → floor → default; no 01d notice raised; a replayed queued `RequestBill` prints once.
59. Check bill `Doc`: banner, no invoice number / fiscal number / QR, default-class total, digital-rate line; `CheckBillPrinted` audit row with ids and counts.
60. **Print to:** a waiting / failed job → `RetargetBillPrint` moves it; a printed one → `PRINT_JOB_NOT_PENDING`; nothing prints twice.
61. Reprint after `FiscalNumberAssigned` shows the fiscal number and the QR block; before it, "FISCAL NUMBER PENDING".

### 10.6 Day close, reports

62. Day close refused: void pending (04 first), then open shift, then unbilled orders — each with its list (≤ 40) and `count`.
63. **H** carry-over → close succeeds; the carried orders bill next day and show on that day's Z as "carried in"; forced COMMIT failure → no `ZReportIssued`, no `z_reports`, no print job.
64. Appender closes open 05 requests and 02b comp requests `obsolete` (`day_closed`); void requests never reach it.
65. Event order in the close commit: `AlertClosed`… → `ZReportIssued` → 03a `StockReleased`… → `BusinessDayClosed`; the checkpoint follows `BusinessDayClosed` (03a To 05).
66. **H** Z invariant over a generated day (sales, credits, reopens, splits, mixed classes, petty cash, three shifts): Z net = Σ sale − Σ credit; tax by class = Σ invoice tax rows; voids by disposition from `ItemVoided`; replay from seq 0 gives the identical Z.
67. X = the same builder over the open day; uncounted shifts' expected hidden.
68. `close-business-day` on the staff app (row H-1 `both`) and on `/admin/stock`; `manage-stock` alone no longer closes (row A-5).

### 10.7 Fiscal

69. **H** outbox row written in the close transaction (fold); a rolled-back close has none; `not_required` for adapter `none`, a non-fiscalized order type (delivery default off, Q17) and invoices before `switched_at`.
70. **H** crash between the HTTP answer and the `FiscalNumberAssigned` commit (fault injection) → restart resends the **same USIN**; one `FiscalNumberAssigned` in the log.
71. **H** order: the worker sends in `ord` order; a credit waits for its original's ack; one failing original does not block other invoices.
72. Back-off schedule with a fake clock; `RetryFiscalNow` pulls `next_try_at`; a `rejected` row is not resent.
73. Stuck alert: pending older than `stuck_after_ms`, a rejected row, or half the catch-up window → one `fiscal_outbox_stuck` to managers; closed when clear; details counts only.
74. PRA adapter fixtures (recorded from the research's shapes and PRA spec v1.2 at build): sale (cash, card, mixed → `PaymentMode` 1 / 2 / 5), credit (`InvoiceType` 3 + `RefUSIN`), buyer fields above the threshold, 5xx → retry, 4xx → rejected, timeout → retry, duplicate USIN → per A10 default; the Bearer header comes from the hub config; no network in the gate.
75. Token missing for the POS ID → row stays pending with `token_missing`, stuck alert, `fiscal-status.token_missing_pos_ids`; never thrown on a command.
76. Per-device POS ID mapping picks the device's POS ID; else the default (K-18).
77. `fiscal-status` and every log line of the worker contain no token, no buyer data (captured logger).
78. Switch `none` → `PRA` by setting: earlier invoices stay `not_required`; later ones pending.

### 10.8 Platform rows and registrations

79. Row A-3 / T-1 / Q-3 lists: two guards registered, the first non-null wins; 04's results unchanged.
80. Row H-1: a `'both'` command answers on both routes with one `command_id` space.
81. Row H-2: `set-fiscal-token` reads stdin, never prints the token; the config Zod accepts the field; `/health` omits it.
82. Row Q-1: `order_lines.tax_class_id` folded; migration 0021 refolds `orders` (checkpoint deleted).
83. Row Q-2: `OrdersUnbilled` clears `billed_at`; edits accepted again.
84. Row Q-4: `LineCompRemoved` fold never below 0; cascades with `planCompRemoval`.
85. Row P-1: `billPrinterFor` order device → zone → floor → default; a route's printer cannot be archived.
86. Row P-3: QR block encodes `GS ( k` bytes (golden bytes); `renderText` prints `[QR] …`; row P-4 import from `@pos/domain` without `node:*` (lint).
87. Row V-3: every 05 event in row V-3 maps to its audit action; rebuild of `audit` equals live; no buyer data in `detail_json`.
88. Projections `billing` and `shifts`: rebuild from seq 0 equals live (every table, `fiscal_outbox` except worker columns).
89. Kinds registered at module top level; a replayed 05 alert finds its kind at boot (01d rule).
90. Row B-2: default grants for new tenants and the backfill by `default_key` (active roles only; approver rows; `directory_version` bump; idempotent re-run).
91. Every 05 query uses its stated fixed statement count for 1 and for 40 bills / lines (no N+1).

### Acceptance

| Story / AC | Tests |
|---|---|
| G0 1 (see and print the bill) AC1–5 | 1, 2, 4, 58, 59 |
| G0 2 (payment and close) AC1–7 | 5, 6, 21–36 |
| G0 3 (split) AC1–3 | 7–10, 32 |
| G0 4 (discount, service charge) AC1–4 | 16–19 |
| G0 5 (tax and rounding) AC1–4 | 10–15, 20 |
| G0 6 → Q8 (money back = reopen + credit) | 37–40, 44 |
| G0 7 (shift) AC1–6 | 45–52 |
| G0 8 (petty cash) AC1–2 | 53, 54 |
| G0 9 (day close, Z, X) AC1–5 | 62–68 |
| G0 10 (settings) AC1–2 | 14, 19, 34 (+ 01a row A-1 tests) |
| G0 11 (fiscal) AC1–7 | 69–78, 42, 43, 61 |
| Q7 remove comp | 41 |
| Q12 walk-out | 04 row V-2 test (void with `walk_out`) |
| Q13 zone printing, Print to | 58, 60 |
| M-3 sticky charges | 18 |
| M-4 / G1-15 no stacking | 13 |
| M-5 rounding, M-6 tendered, M-7 recompute, M-8 open-too-long | 20, 21, 24, 67 |
| README :183 takeover | 48 |

---

## §11. Build order (one task per commit, TDD, platform rows first — README build-order note; HIGH tasks: own PR, Opus implementer and reviewer, money MINORs fixed before merge, owner rulings Q-39 / Q-41 / Q-60)

**Phase 0 — after approval (spec task 0 done in v0.1: numbers in §4.5).**

| # | Task | Files | Spec |
|---|---|---|---|
| P0.1 | Re-check every version and migration number on `main` and all branches; STOP on a clash | — | §4.5 |
| P0.2 | Apply §4.5 rows to the target specs (one commit per target, "⚠️ Changed by 05 (row X-n)" markers, README R37 + row 05) | `docs/specs/*` | §4.5 |
| P0.3 | F-1 `bill` stream type | `packages/events/src/envelope.ts` | F-1 |
| P0.4 | H-1 `sessionKind: 'both'` | `apps/hub/src/commands/{registry,route}.ts` | H-1; #80 |
| P0.5 | H-2 `fiscal_credentials` + `set-fiscal-token` CLI | `apps/hub/src/config/schema.ts`, `apps/hub/src/cli/` | H-2; #81 |
| P0.6 | A-3 guard list, A-4 appender list, A-5 permission + `both` + page | `apps/hub/src/commands/close-business-day.ts`, `apps/client/src/…/StockApp.tsx` | A-3–A-5; #68, #79 |
| P0.7 | B-1 permissions, B-3 `rolesGranting` | `packages/domain/src/permissions.ts`, `apps/hub/src/auth/staff-directory.ts` | B-1, B-3 |
| P0.8 | B-2 defaults + cloud `0017_billing_defaults_backfill.sql` | `apps/cloud/src/modules/staff-roles/default-roles.ts`, migrations | B-2; #90 |
| P0.9 | A-1, A-2 billing settings, fiscal catalog seed, routes, snapshot `billing` key — **HIGH** (rates) | `apps/cloud/src/modules/billing-settings/`, `0016_billing_settings.sql`, `packages/events/src/{config,admin/billing}.ts` | A-1, A-2; #14 |
| P0.10 | A-1 (6) owner Billing page with preview | `apps/client/src/features/owner/billing/` | A-1 |
| P0.11 | T-1 merge guard list | `apps/hub/src/tables/merge-guard.ts` | T-1; #79 |
| P0.12 | Q-1 `tax_class_id` + `0021_order_line_tax_class.sql` | `apps/hub/src/orders/{projection,exports}.ts` | Q-1; #82 |
| P0.13 | Q-2 `OrdersUnbilled`; Q-4 `LineCompRemoved` + `planCompRemoval` | `packages/events/src/events/order/`, `apps/hub/src/orders/` | Q-2, Q-4; #83, #84 |
| P0.14 | Q-3 line guard list; V-1 `VoidItems` asks it | `apps/hub/src/orders/line-guard.ts`, `apps/hub/src/voids/commands/void-items.ts`, `voids/queries/void-preview.ts` | Q-3, V-1; #32, #79 |
| P0.15 | V-2 `walk_out`; V-3 audit actions + subject types | `packages/domain/src/{voids,audit}.ts` | V-2, V-3 |
| P0.16 | P-1 bill routes + `0022_bill_routes.sql` + Printers page section | `apps/hub/src/print/`, client admin printers | P-1; #85 |
| P0.17 | P-2 retarget + job status; P-3 QR block; P-4 `renderText` to `@pos/domain` | `apps/hub/src/print/`, `packages/domain/src/{print,print-render}.ts` | P-2–P-4; #60, #86 |
| P0.18 | H-3 fiscal worker boot hook (stub worker) | `apps/hub/src/lib/boot.ts` | H-3 |

**05 hub.**

| # | Task | Files | Spec / tests |
|---|---|---|---|
| 1 | Shared types | `packages/domain/src/billing/types.ts` | §4.4 |
| 2 | **HIGH** `computeSplit` / `computeBill` (tax, discount spread, service charge, mixed classes, rounding) + table tests | `packages/domain/src/billing/compute.ts` | §3.4–§3.6; #10–#16, #20 |
| 3 | **HIGH** property tests for compute | `compute.property.test.ts` | §3.5 (7); #10, #15, #23 |
| 4 | `Doc` builders (check bill, receipt, credit note, report) | `packages/domain/src/billing/docs.ts` | §3.16, B29; #34, #59, #61 |
| 5 | Events (Zod, builders, fixtures) | `packages/events/src/events/{bill,shift,hub}/` | §6.29 |
| 6 | Migration `0023_billing.sql` | `apps/hub/src/db/migrations/` | §5 |
| 7 | Projection `billing` (+ outbox rows) | `apps/hub/src/billing/projections/billing.ts` | §5; #88 |
| 8 | Projection `shifts` (expected cash, takings) — **HIGH** | `…/projections/shifts.ts` | §3.7; #47 |
| 9 | Kinds (§3.14, `fiscal_outbox_stuck`) | `apps/hub/src/billing/kinds/` | §3.14; #89 |
| 10 | Ensure-bill, `bill` query, `open-bills` | `…/commands/ensure-bill.ts`, `…/queries/{bill,open-bills}.ts` | §6.1, §6.2; #1, #2, #4, #91 |
| 11 | `PrintCheckBill` + `BillRequested` fold | `…/commands/print-check-bill.ts`, `…/print/folds.ts` | §6.3, §6.4; #58, #59 |
| 12 | `SetSplits` | `…/commands/set-splits.ts` | §6.5; #7–#9 |
| 13 | `ApplyDiscount`, `RemoveDiscount` | `…/commands/discount.ts` | §6.6, §6.7; #16, #17 |
| 14 | `RemoveServiceCharge`, `ApplyServiceCharge` | `…/commands/service-charge.ts` | §6.8; #18, #19 |
| 15 | `OpenShift`, `shift` query (blind rule) | `…/commands/open-shift.ts`, `…/queries/shift.ts` | §6.15, §6.16; #45, #46 |
| 16 | `AddPayment`, `RemovePayment` | `…/commands/payments.ts` | §6.9, §6.10; #21–#25, #48, #49 |
| 17 | **HIGH** `CloseSplit` | `…/commands/close-split.ts` | §6.12; #5, #6, #26–#36 |
| 18 | `WaiveBuyerId` + buyer redaction | `…/commands/waive-buyer-id.ts` | §6.11; #42, #43 |
| 19 | **HIGH** `ReopenBill` + kind `apply` | `…/commands/reopen-bill.ts` | §6.13; #37–#40, #44 |
| 20 | `RemoveComp` | `…/commands/remove-comp.ts` | §6.14; #41 |
| 21 | `CountShift`, `CloseShift`, `HandoverCount` | `…/commands/shift-close.ts` | §6.17–§6.19; #46, #50–#52 |
| 22 | `RecordPettyCash`, `SettlePettyAdvance` | `…/commands/petty-cash.ts` | §6.20; #53, #54 |
| 23 | `OpenCashDrawer` | `…/commands/open-cash-drawer.ts` | §6.21; #55 |
| 24 | Merge guard, line guard (05) | `…/lanes/guards.ts` | §3.9, B15; #32, #56, #57 |
| 25 | **HIGH** day-close guard, appender, `CarryOverOrders` | `…/lanes/day-close.ts`, `…/commands/carry-over.ts` | §6.24, §6.25; #62–#65 |
| 26 | **HIGH** `buildReport`, X / Z queries, `ZReportIssued` print fold | `packages/domain/src/billing/report.ts`, `…/queries/reports.ts` | §6.26; #66, #67 |
| 27 | `PrintBillDocument`, `RetargetBillPrint` | `…/commands/print-docs.ts` | §6.22, §6.23; #60, #61 |
| 28 | Fiscal port, `none` adapter, registry | `apps/hub/src/billing/fiscal/{port,none}.ts` | §3.15; #69, #78 |
| 29 | **HIGH** fiscal worker (order, back-off, crash resend, credits behind originals) | `…/fiscal/worker.ts` | §3.15; #70–#72 |
| 30 | **HIGH** PRA adapter + fixtures | `…/fiscal/pra.ts`, `apps/hub/test/billing/fiscal/fixtures/` | §3.15; #74–#76 |
| 31 | Stuck alert, `fiscal-status`, `RetryFiscalNow` | `…/fiscal/status.ts` | §6.27, §6.28; #73, #77 |
| 32 | Audit registrations | `…/audit-map.ts` | §6.30; #87 |
| 33 | Startup wiring | `apps/hub/src/billing/index.ts` | §6.30 |

**05 client (staff entry, ui-kit, R5).** 34 cashier open-bills list; 35 bill screen + payment pad + tendered / change; 36 split editor; 37 discount / service charge / buyer sheets; 38 print status + Print to; 39 shift open / count / close / handover; 40 petty cash; 41 day close + carry-over; 42 X / Z + fiscal status line; 43 i18n keys (EN, UR) for every §9 code and kind label.

**Close-out.** 44 E2E flows (webapp-testing: dine-in split + mixed payment; takeaway before food; reopen; day close with carry-over); 45 `test:perf` row (200-bill rush close on the pilot box, never in the gate); 46 manual checks (owner): PRA sandbox run with the owner's sandbox token (G1-12), receipt QR scan on each printer model (A3), drawer kick on the kiosk printer, go-live checklist (G1-16).

Estimate: 18 phase-0 + 33 hub + 10 client + 3 close-out = **64 tasks** (above the ~60 budget; see OQ-2).

---

## §12. Definition of Done, checklist, questions, deferred

### 12.1 Definition of Done

1. Every §4.5 row applied with its marker, version and test; README R37 and row 05 updated.
2. Every §10 test exists with its number in its name and passes in the normal gate (`TMPDIR=/dev/shm …`); HIGH tasks reviewed in their own PR.
3. Every command: happy path, one test per code, retransmit, every grant state; every query: fixed statement count at 1 and 40.
4. No buyer ID, token, PIN, name or phone in any log line (captured-logger tests #43, #77).
5. Rebuild of `billing`, `shifts`, `audit` from seq 0 equals live.
6. Owner manual checks (§11 #46) done on the pilot hardware before go-live; go-live preconditions met or the branch on `none`.

### 12.2 Endpoint checklist

| § | Name | Kind | Permission | Events | Errors |
|---|---|---|---|---|---|
| 6.1 | `bill` | query | `take-payment` / `take-order` | — | 403, 404 |
| 6.2 | `open-bills` | query | `take-payment` | — | 403 |
| 6.3 | `PrintCheckBill` | command | `take-order` / `take-payment` | BillOpened?, CheckBillPrinted | 404, 409×2 |
| 6.5 | `SetSplits` | command | `take-payment` | BillSplitsSet | 409×3, 422 |
| 6.6 | `ApplyDiscount` | command, approvable | `apply-discount` | DiscountApplied / request | 409×2, 422 |
| 6.7 | `RemoveDiscount` | command | `apply-discount` | DiscountRemoved | 409 |
| 6.8 | `RemoveServiceCharge` | command, approvable | `remove-service-charge` | ChargeRemoved / request | 409 |
| 6.8 | `ApplyServiceCharge` | command | `remove-service-charge` | ChargeApplied | 409 |
| 6.9 | `AddPayment` | command | `take-payment` | PaymentAdded | 404, 409×2, 422×2 |
| 6.10 | `RemovePayment` | command | `take-payment` (+ `close-shift-for-others`) | PaymentRemoved | 403, 404, 409 |
| 6.11 | `WaiveBuyerId` | command, approvable | `close-without-buyer-id` | BuyerIdWaived / request | 409 |
| 6.12 | `CloseSplit` | command | `take-payment` | InvoiceIssued, OrdersBilled, BillClosed, AlertClosed | 404, 409×8 |
| 6.13 | `ReopenBill` | command, approvable | `reopen-bill` | BillReopened, InvoiceCredited, OrdersUnbilled / request | 409×2 |
| 6.14 | `RemoveComp` | command, approvable | `remove-comp` | LineCompRemoved / request | 400, 409×4 |
| 6.15 | `OpenShift` | command | `manage-own-shift` | ShiftOpened | 409×3, 422 |
| 6.16 | `shift` | query | `manage-own-shift` / `close-shift-for-others` | — | 403, 404 |
| 6.17 | `CountShift` | command | same | ShiftCounted | 404, 409 |
| 6.18 | `CloseShift` | command | same (+ `skip-blind-count`) | ShiftClosed, ShiftCountSkipped / request | 403, 404, 409 |
| 6.19 | `HandoverCount` | command | same | HandoverCounted | 404, 409 |
| 6.20 | `RecordPettyCash` | command, approvable | `record-petty-cash` | PettyCash* / request | 409×2, 422 |
| 6.20 | `SettlePettyAdvance` | command | `record-petty-cash` | PettyCashSettled | 404, 409×2, 422 |
| 6.21 | `OpenCashDrawer` | command | `open-cash-drawer` | DrawerOpened | 409 |
| 6.22 | `PrintBillDocument` | command | `take-payment` / `view-reports` | — | 404×3 |
| 6.23 | `RetargetBillPrint` | command | `take-order` / `take-payment` | — | 404×2, 409 |
| 6.24 | `CarryOverOrders` | command | `close-business-day` | OrdersCarriedOver | 400, 409 |
| 6.25 | day close (01a) | guard + appender | `close-business-day` | AlertClosed, ZReportIssued | 409 `DAY_CLOSE_BLOCKED` |
| 6.26 | `x-report`, `z-reports` | queries | `view-reports` | — | 403 |
| 6.27 | `fiscal-status` | query | `take-payment` / `view-reports` | — | 403 |
| 6.28 | `RetryFiscalNow` | command | `close-business-day` | — | — |

**Size check:** **23 commands** (+ the day-close guard / appender, not a command) and **6 queries** = **29 hub endpoints**, plus 3 cloud routes carried by 01a (row A-1) = **32**, and ~64 build tasks. Above the ~30 / ~60 budget → **OQ-2**.

### 12.3 Open questions

**Owner questions (product choices).**

| # | Question | Options | Rec |
|---|---|---|---|
| OQ-1 | **What does a bill reopen do to 02b's BILLED** (G1-3 design point)? | (a) **02b bump `OrdersUnbilled` (row Q-2): the orders are unbilled again, so line fixes go through 02b / 04 as usual (void with approval, comp removal), and the next close writes `OrdersBilled` again**; (b) the orders stay BILLED; a reopened bill allows only bill-level edits (discount, charges, payments) and "credit lines" kept by 05 outside 02b's ledger; (c) the orders stay BILLED; a reopen is only a credit + one fresh 05-built invoice re-entered by hand | **(a)** — one ledger (G0-2), voids keep their approval and wastage record; (b) makes a second line ledger in 05; (c) re-keys food |
| OQ-2 | **Spec size:** 29 hub endpoints + 3 cloud routes = 32, ~64 build tasks (budget ~30 / ~60). Split? | (a) split at v0.2 into **05a Bills + payments + fiscal** and **05b Shifts + petty cash + day close + Z**; (b) **keep one spec, record a README decision (R38) as for 00's cloud part, and build in two plan phases (05-1 bills / fiscal, 05-2 shifts / day close)** | **(b)** — every payment needs a money shift (B11) and the Z needs both halves, so a split spec has a two-way dependency (05a needs 05b's shift, 05b's Z needs 05a's invoices); two plan phases give the same review size |
| OQ-3 | Where is the PRA token entered? | (a) **hub CLI `set-fiscal-token` into the hub config file (row H-2), by the installer / developer at go-live**; (b) a write-only field on the hub admin page | **(a)** — no HTTP path ever carries the token; (b) later if owners must rotate tokens themselves |
| OQ-4 | Discount target: G1 Q6 text says "on the bill only"; G0 Q6 (a), which the owner chose, says "on the bill or a split" | (a) **bill or one open split** (G0 (a) as chosen); (b) bill only | **(a)** — a split payer asking for a discount is the same customer case; spec written as (a) |
| OQ-5 | Amount / equal splits when the adapter is PRA: each split is its own invoice with every line at its share (A8 open) | (a) **as written: proportional lines per split invoice**; (b) with a fiscal adapter, amount / equal splits become several payments on **one** invoice (one fiscal record), item splits stay separate invoices | **(a)** until PRA answers A8; (b) is a setting change if PRA refuses fractional lines |
| OQ-6 | A partly paid bill (one split closed): may lines still change? | (a) **frozen: line edits refused until the bill closes; a fix is a reopen** (B15); (b) lines outside closed item splits stay editable | **(a)** — amount splits have no line ownership; one rule is safer |
| OQ-7 | Who approves over-limit petty cash and shift variances (the requester's grant is `allowed`)? | (a) **roles holding `close-shift-for-others` allowed at branch (row B-3)**; (b) a billing setting listing approver roles | **(a)** — no new setting; the same people close others' shifts |
| OQ-8 | How long does the hub keep buyer IDs (`invoice_buyers`)? | (a) **as long as the invoice (legal record); never synced**; (b) delete after the fiscal ack + N days (reprints then show no buyer) | **(a)** until the accountant says otherwise |

**Authority questions (open; defaults are the strictest / safest; answers change data or the adapter, not the flow).** A1–A7 as G1 §5 (A1 one POS ID per hub, per-device mapping ready; A2 local number + "fiscal number pending" + date / time; A3 QR at the foot, largest size, no logo; A4 no credit time limit; A5 platform orders not fiscalized; A6 `higher_rate`; A7 waiver with manager approval, `buyer_id_refused = true`, buyer fields empty). **New:**

| # | Question | Default until answered |
|---|---|---|
| A8 | How must an amount / equal split be reported — one invoice per payer with proportional lines, or one invoice with several payments? | one invoice per split with proportional lines (OQ-5 (a)) |
| A9 | Is the service charge part of the taxable value, and under which rate? | taxable under `service_charge_tax_class_id` (owner sets it; the safe setting is the restaurant class) |
| A10 | What does PRA answer to a re-sent USIN it already accepted (crash between send and ack)? | treat an answer carrying the fiscal number as success; anything else → `rejected` + alert, resolved by hand |

**STOP items (spec / code drift and G1 assumptions the code does not meet).**

| # | Finding | Handling in v0.1 |
|---|---|---|
| S-1 | G1-10 says the check bill prints "at the printer routed for that floor / zone (03c routing)", but 03c has **no floor / zone / device bill routing** — only `station_outputs` (03c §3.2, `print_jobs.printer_id` for `document` jobs). | 03c row P-1 adds bill routes; owner to confirm the routes live in 03c (hub admin Printers page) |
| S-2 | K-5 "close-business-day also on the staff app": `CloseBusinessDay` is `sessionKind: 'admin'` and 00's registry allows one session kind per command (`registry.ts:53`). | 00 row H-1 (`'both'`) |
| S-3 | `registerDayCloseGuard`, `registerMergeGuard`, `registerLineGuard` are single-slot ("at most one; a later registration replaces the earlier", `close-business-day.ts:14`, `merge-guard.ts:9`, `line-guard.ts:21`) and 04 already holds each slot; 05 registering would silently remove 04's guard. | rows A-3, T-1, Q-3 make them ordered lists |
| S-4 | 04's `VoidItems` checks its own lock, not 02b's line guard, so a partly paid bill's lines would still be voidable. | row V-1 |
| S-5 | 04 v1.0.4 and v1.0.5 exist on `module-04-client` (and `lane-VU1/*`, `lane-VU2/*`, `lane-P0/04-spec-v10{4,5}`) but not on `main` and in no open PR's file list; README row 04 still says v1.0.3. 05 bases on v1.0.3 and takes **v1.0.6**. | integrator: merge order — if `module-04-client` lands after 05's phase 0, its v1.0.4 / v1.0.5 fold under v1.0.6 (Z3a reconcile pattern) |
| S-6 | Foundation §8 defers "Transactional outbox (separate outbox table)", while F §3.5 asks for a fiscal queue "same shape as the print queue". | row F-3 states the exception |
| S-7 | 01a S31 says 05 may extend the tax class shape "through a new snapshot schema version (S28)"; 05 adds an **optional** `billing` key and an optional `fiscal_category` without a version bump (R29, the 03b A-1 precedent). | owner to confirm no snapshot V5 |
| S-8 | `apply-refund` exists in the catalogue (`permissions.ts`) with no command after Q8. | kept, unused, documented (row B-1) |

### 12.4 Deferred until needed

| Item | Why deferred |
|---|---|
| Refund without reopen | Q8: a reopen with lines removed is the refund path |
| Day reopen | Q11 |
| Tips, line discounts, delivery charge | Q5, Q6, P2 (B8 already covers a delivery charge) |
| Adapters SRB / KPRA / BRA / FBR-ICT | milestone C (R37); the port is ready |
| Windows-host adapter path | K-16 / 01e, only if an authority has no HTTPS API |
| Batch fiscal posting | PRA has no batch call; one in flight handles ~200 bills / rush |
| Raast payment QR, logo on the receipt | G1-11, K-12 |
| Petty-cash bill photo | Q15 (optional note now) |
| Hub admin page for tokens | OQ-3 (b) |
| Cloud shift / Z history, money tiles, sales reports | 06 / 07 (K-9, Q14) |
| Buyer-ID retention policy | OQ-8 |
| Card / wallet reconciliation | R7, P2 |

### 12.5 Hostile self-review (v0.1)

- **Races:** close vs void approve, two kiosks on one split, discount approved while closing, reopen approved twice, day close vs a close in flight — all in one `BEGIN IMMEDIATE` with the checks inside (tests 28, 17, 39, 62). An approval `apply` re-checks state read-only and throws when the bill moved on (01d refuses the answer).
- **Idempotency:** every command by `command_id`; the outbox by `invoice_id`; the PRA resend by USIN (A10 open). A queued `RequestBill` replay prints the check bill again — accepted (a reprint, no money).
- **N+1:** bill view ≤ 9, open bills 3, close ≤ 18, X ≤ 8, day close +≤ 10 — fixed counts (test 91).
- **Indexes:** each query in §5 names its index; the line guard uses `bill_orders_order`; the worker `fiscal_outbox_pending`.
- **Privacy:** buyer ID in one non-synced table, last 4 on paper, captured-logger tests; tokens only in the hub config; names never in logs; audit details ids and counts.
- **External failure:** internet down → close works, outbox waits, stuck alert after 30 min; PRA 4xx → rejected + alert, never silently resent; printer down → close works, Print to.
- **Contradictions checked:** status codes §6 ↔ §9; permissions ↔ row B-1; F §4.4 BILLED ↔ row F-2; 03a's `stockEffects` order ↔ row A-4; 04's guards stay first.
- **Over-engineering cut:** no separate payments service, no cache, no batch fiscal, no refund command, no per-split discount reasons, no snapshot V5, no new admin page; `bill_print_jobs` kept only because "Print to" needs the job id (G1-10); `shift_takings` kept only for the per-taker breakdown at a fixed statement count (Q10).
- **Known risk:** the PRA field mapping beyond the research is taken from PRA's spec v1.2 at build (task 30); an unclear field stops the build for the owner, it is not guessed.
