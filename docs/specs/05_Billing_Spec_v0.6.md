# 05 Billing — Module Spec

| | |
|---|---|
| Module | 05 Billing (hub; cloud settings carried by 01a / 01b rows) |
| Version | **v0.6 DRAFT — hostile run 6 fixes; three owner questions pending** (`docs/reviews/05_v0.5.2_hostile_run6.md`, verdict FIX: 0 blocker, 7 major, 8 minor, 3 nit; fixes in §1.10; `TODO(owner)` for review Q-1 (H6-5), Q-2 (H6-3 confirmation), Q-3 (H6-6)). §4.5 numbers provisional (v0.5.2 H5-1). v0.5.2 … v0.1 kept as history |
| Inherits | Shared Standards from **Foundation v1.13** §6 (envelope, errors, hub HTTP, WS, list cursor, naming, tests, migrations, folders); not redefined here. v1.14 (row F-1…F-5) changes no §6 standard; it appends 05's §9 codes |
| Depends on | Foundation v1.13; 00 Hub Platform v1.11 (DRAFT on `main`; 05 needs only what v1.10.1 has, plus row H-1…H-4); 01a v2.5.1; 01b v1.9.1; 01c v1.1.2 (`allocateDealMinor`, deal / option money); 01d v1.2.5; 02a v1.1.6; 02b v1.0.14; 03a v1.2.4 (read-only: `stockEffects` order at day close, return lines never billed); 03c v1.0.10; 04 v1.0.3 (`pendingVoids`, `VOID_KIND`, `registerAuditAction`, `staff_names`, day-close void guard). 04 v1.0.4 / v1.0.5 (client and text only, on `module-04-client`) change nothing 05 reads |
| Read by | 06 (synced money events, cloud shift / Z history), 07 (sales reports, live money view, D22 tiles), 10 (vendor payments stay out of petty cash) |
| Stories | `docs/stories/05-g0.md` (stories 1–11, carried rows, K-1…K-18, G0-1…G0-10); **`docs/stories/05-g1-decisions.md` overrides G0 wherever they differ** (Q1–Q18, K rulings, G1-1…G1-16, A1–A7, M-1…M-15); `docs/stories/05-fiscal-research.md` |
| Branch | `spec-05` on `origin/main` @ `ea0ee00` |

### Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-17 | First draft from G0 + G1 ("go spec"). Owner questions OQ-1…OQ-8, authority questions A1…A10 and STOP items S-1…S-8 in §12.3. §4.5 rows are **proposed**; they are applied by 05's phase 0 after approval (04 precedent), never by editing a merged spec now. |
| **v0.2** | 2026-11-17 | **Owner answers OQ-1–OQ-8** (23:11–23:15 PKT), each place marked "⚠️ Changed in v0.2 (OQ-n)"; new STOP S-9 (02a NEEDS_CLEANING vs a new bill on a closed seating). OQ-1 (a) reopen writes 02b `OrdersUnbilled`; OQ-2 (b) one spec, two plan phases, README budget exception R38; **OQ-3 (b)** PRA token on a **hub admin page field** (write-only, hub-only, new permission `manage-fiscal-settings`, `SetFiscalToken`, `FiscalTokenSet` audit event with ids only; the CLI is dropped); **OQ-4 (b)** discount on the **whole bill only**, refused once a split closed (`BILL_PARTLY_PAID`); OQ-5 (a) proportional split invoices (A8 open); **OQ-6** a closed split is frozen, the unpaid remainder stays open, new lines join the open remainder automatically, all splits closed = bill closed and a new item on the seating opens a new bill, a closed split changes only by reopen (`LINE_IN_CLOSED_SPLIT`, rows Q-3 / V-1); OQ-7 (a); OQ-8 (a). STOP S-1–S-4: bumps kept, "proposed, owner to confirm at approval". |
| **v0.3** | 2026-11-17 | **Hostile run 1** (`docs/reviews/05_v0.2_hostile_run1.md`): every finding verified against the code (`origin/main` @ `ea0ee00`) before fixing; fixed H1-2–H1-4, H1-6–H1-8, H1-11–H1-15, H1-17–H1-27, each place marked "⚠️ Changed in v0.3 (H1-n)"; Owner answers 2026-11-17 23:49 PKT (`05-g1-decisions.md` §10) then applied in the same version: **H1-1 (R1), H1-5 (R3), H1-9 (R4), H1-16 (R5)**, marked "⚠️ Changed in v0.3 (H1-n, owner R-n)"; then **H1-10 + S-9 (R2, 23:58 PKT)**: reopen = full edit for every order type; dine-in reopen re-opens the seating while its table is not cleaned / re-seated (02a `SeatingReopened`), else corrections only; a new order on a just-closed, uncleaned seating opens a new bill; takeaway additions share the first order's `table_key` (02b row Q-6). No owner anchor left. Fix list §1.5. New authority question A12 (send order). |
| **v0.4** | 2026-11-18 | **Hostile run 2** (`docs/reviews/05_v0.3_hostile_run2.md`): every finding verified against `origin/main` @ `ea0ee00`; fixed H2-1–H2-7, H2-9–H2-12, H2-14–H2-20, H2-22–H2-28 and the run-1 PARTLY rows they cover (H1-4, H1-6, H1-9, H1-17, H1-21), marked "⚠️ Changed in v0.4 (H2-n)". Then the run-2 questions (2026-11-18 08:38 PKT, `05-g1-decisions.md` §11): **Q-1 (owner)** H2-8 — the frozen discount covers only lines on the bill at the first split close; **Q-2–Q-5 (developer call, owner delegated, review Rec)** — H2-13 queued replay after close refused; earlier-day takeaway reopen corrections only; H2-21 parking `bill_key` per plate per business day; Q-5 corrections only while a newer bill holds the key (final). New rows: 03a **v1.2.5** row S-1 (`OrderPlaced.adds_to_order_id`), 02b Q-6 rewritten (own token, `bill_key`). `TABLE_SEATING_CLOSED` dropped (H2-14). Fix list §1.6. |
| **v0.5** | 2026-11-18 | **Run 3, targeted check** (`docs/reviews/05_v0.4_targeted_check.md`): findings verified against `origin/main` @ `049f6ce` (hub / packages identical to `ea0ee00`); fixed H3-1 (owner answer 09:26 PKT: an add-on keeps the first order's token), H3-2–H3-9 and the PARTLY rows H2-2, H2-3, H2-4, H2-9, H2-22 (and through them H1-6, H1-9, H1-21), marked "⚠️ Changed in v0.5 (H3-n)". H3-9: `spec-05` rebased on `main` (PR #236 merged: 04 at v1.0.5 on `main`); every version and migration number re-checked — unchanged (04 still takes **v1.0.6**). Fix list §1.7. |
| **v0.5.1** | 2026-11-18 | **Run 4, targeted check** (`docs/reviews/05_v0.5_targeted_check.md`): H4-1–H4-7 fixed, marked "⚠️ Changed in v0.5.1 (H4-n)". **H4-2 renumbering** (developer call, owner may veto, `05-g1-decisions.md` §13): open PR #237 (notification deep links) holds 02a v1.1.7, 02b v1.0.15, 03a v1.2.5, 04 v1.0.6 and 01d v1.3; PR #237 lands first, so 05 now proposes **02a v1.1.8, 02b v1.0.16, 03a v1.2.6, 04 v1.0.7, 01d v1.3.1** — replaced everywhere in this file except the changelog rows of v0.1–v0.5, which keep the numbers those files carry (⚠️ Changed in v0.5.2 (H5-3): was "including the history rows above"); in v0.4 / v0.5's rows 03a v1.2.5 is now **v1.2.6** and 04 v1.0.6 is now **v1.0.7**; F v1.14, 00 v1.12, 01a v2.6, 01b v1.10, 03c v1.0.11 and all migration numbers unchanged (re-scanned: 4 open PRs, every branch). README: the R13 and milestone C "Amended by R37" markers are intended (R37 amends R13; H4-7). |
| **v0.5.2** | 2026-11-18 | **Run 5, targeted check** (`docs/reviews/05_v0.5.1_targeted_check.md`): H5-1–H5-5, text only, marked "⚠️ Changed in v0.5.2 (H5-n)". **H5-1** (developer call, owner may veto, `05-g1-decisions.md` §13): PR #237 merged into `module-deeplinks`, not `main`; 05 applies its bumps only in its phase 0, **after `module-deeplinks` (and anything else claiming those specs) has reached `main`**; phase 0 task 0 re-takes the next free numbers then, **without a STOP**, and updates §4.5 and the README in the same commit. The numbers in this file are **provisional**. History rows restored (H5-3). |
| **v0.6** | 2026-11-18 | **Hostile run 6 (full)** (`docs/reviews/05_v0.5.2_hostile_run6.md`): every finding verified against `origin/main` @ `049f6ce` (`commands/registry.ts:35,53-55`, `commands/route.ts:341-361`, `tables/lock.ts:50`, `orders/comp-kind.ts:33`, `orders/line-change.ts:92-95`, `cloud/…/default-roles.ts:36-40`); all 18 hold, none rejected. Fixed H6-1–H6-4, H6-7–H6-18; H6-6 provisionally with the review's Rec; **owner pending** (`TODO(owner)`): H6-5 / Q-1, Q-2 (H6-3's "no money on a counted drawer" awaits confirmation), H6-6 / Q-3. New: `PrintReport` (25 commands), errors `BILL_PAYMENT_ORDER`, reason `shift_counted`, event `BillClosedEmpty` (provisional), authority question A13. Fix list §1.10. |

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

Bills per seating (dine-in) or per order (takeaway / parking); splits (items / amount / equal); discount on the whole bill (before the first split closes) with reason and approval (⚠️ Changed in v0.2, OQ-4); sticky service charge (applied once by rule, removable with reason and approval, re-added only by hand); tax at payment from the authority rate table (payment class, mixed-class rule), rounding once per split; payments in any owner mode with tendered amount and change; close per split → invoice (gap-free number), at the last split `OrdersBilled` + `BillClosed`; check bill (provisional print, no number, no fiscal call); request-bill print at the floor / zone bill printer with a run-time "Print to" target; reopen a closed bill (credit invoice + new invoice at the next close); remove a comp on an unbilled line (approval); buyer name + CNIC / NTN above the authority threshold or an approved waiver; shifts per person (float, taken-by vs drawer shift, optional handover count, blind count, variance approval); petty cash (advance + settle, cash out, cash in, categories, limit approval); drawer no-sale open; carry-over of unbilled orders; day-close guards and the Z appender; X and Z reports; fiscal port, adapters `none` and `PRA`, the durable fiscal outbox and its worker, fiscal status and the stuck-outbox alert; receipt / check-bill / credit-note / Z `Doc` builders in `@pos/domain`.

### 1.3 Out of scope

Refund without reopen (`apply-refund` stays in the catalogue, unused; Q8). Business-day reopen (Q11). Tips (Q5). Line discounts (Q6). Card-terminal or wallet integration and reconciliation (R7, P2). Khata / customer credit, delivery charge and rider cash (P2; the sticky-charge rule already covers a delivery charge, G1-14). Raast payment QR (G1-11). Logo on the receipt (K-12). Sales by item / hour / staff, live money view, D22 tiles, cloud shift and Z history (07 / 06, K-9, Q14). Adapters SRB, KPRA, BRA, FBR-ICT (milestone C, K-14 / R37). Splitting a sale to stay under the buyer-ID threshold (**never built**, Q18). Vendor payments / payables (module 10). Training mode. Bill-photo upload for petty-cash settle (G1 Q15, deferred). Any change to how 02b prices a line or 04 voids one.

### 1.4 Decisions log

| ID | Decision | Source |
|---|---|---|
| B1 | **One bill per seating (dine-in) or per `bill_key` (takeaway: the root order of its additions; parking: the plate's `table_key`)** ⚠️ Changed in v0.4 (H2-4: was per `table_key`), ⚠️ Changed in v0.5.1 (H4-6): a takeaway addition keeps **the root's token**, its own `table_key` and the root's `bill_key` (H3-1) ⚠️ Changed in v0.4 (H2-21, Q-4, developer call, owner delegated): a parking `bill_key` is **per plate per business day** (`table_key || ':' || business_date`, the normalised plate, ⚠️ Changed in v0.5.1 (H4-6)), so a car that comes back on a later day starts a new bill. ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) (was "per order": a takeaway addition is a new order with the first order's `table_key`, 02b row Q-6; parking orders of one car already share it). A bill is created by the first 05 command that touches it (`BillOpened` + `ChargeApplied`); until then every read shows the bill **projected** from 02b and the rule (same numbers). Its orders: a **reopened** bill = its `bill_orders` set plus, in full-edit mode, the seating's / key's new unbilled orders; any other open bill = the seating's / key's orders with `billed_at IS NULL` and `cancelled_at IS NULL` that are not in another open bill's `bill_orders` (v0.3 H1-21). At the bill's last close they are written to `bill_orders`. **One full-edit open bill per seating / key at a time**: after a bill closes, a new order on that seating / key opens a new bill automatically, no staff action (OQ-6, S-9 (b)). | K-1, K-3, G0 story 1, R2 |
| B2 | **Splits are parts of the bill** (`items`, `amount`, `equal`). No split plan = one split (`split_no 1`). Each split holds 1..n payments, closes on its own into **one invoice** with its own number, tax, rounding, receipt; the bill closes at its last split: `OrdersBilled { order_ids, bill_id }` (02b) and, for dine-in, `BillClosed { seating_id }` (02a stream `table`) **once**, in that transaction. | K-1, K-3, M-1, G1-2 |
| B3 | **05 never writes 02b's ledger** (G0-2): line money is 02b `orderLines` (`billed_minor`) minus 04 `pendingVoids(…).refund_minor`; 05 owns only bill-level money. A line with `return_of` is never billed (03a §3.8a: its money is 0 already). | G0-2, 04 To 05, 03a To 05 |
| B4 | **Tax is never chosen at the bill.** Each line has exactly one `tax_class_id` (copied from `ItemAdded`, row Q-1, K-4); a deal line is taxed under the deal's class on its billed amount, an option child under its own; never from `allocated_price_minor`. Two classes are never added on one line; the checkout has **no tax buttons**. | G1-15, K-4, README :214 |
| B5 | **The rate comes from the authority rate table at payment / close** (row A-1): key (authority, tax class → fiscal category, payment class `cash` / `digital`, integration status, `effective_from` ≤ issue date), each row with its notification ref; owner overrides per tax class win over the seeded catalog. Adapter `none` uses `tax_classes[].rate_bp`. Choosing / switching a payment mode recomputes tax and total on the same screen. | K-15, Q16, M-7 |
| B6 | **Mixed payment classes inside one split:** rule per authority as data, `higher_rate` (default: the cash rate on the whole split) or `pro_rata` (digital amount entered first; §3.6). | Q4, G1-5, A6 |
| B7 | **Discount before tax, on the whole bill only** ⚠️ Changed in v0.2 (OQ-4: was "on the bill or one open split"), amount or percent, owner reason buttons + note for `other`; `apply-discount` grant (approval per grant, 01d kind `discount`); recomputed live on the whole bill and spread over **all bill lines** pro rata with `allocateCappedMinor` (⚠️ Changed in v0.3 H1-4: was `allocateDealMinor`, which can drive a line negative; G0-5 named it) **before** splitting, so each split carries its lines' shares; set and changed only while **no split is closed** (`409 BILL_PARTLY_PAID` after the first close); at the first split close its amount freezes and lines that join later carry no discount ; ⚠️ Changed in v0.3 (H1-5, owner R3): after any void / comp / remove / comp removal on the open part, the open part's discount = **min(frozen amount − Σ closed splits' D, the open part's current pre-discount total)**, never negative, re-spread over the open lines with `allocateCappedMinor`; closed splits never change; a reduction is not given back to the customer ⚠️ Changed in v0.4 (H2-8, Q-1, owner 2026-11-18 08:38 PKT): **the frozen discount covers only the lines that were on the bill when the first split closed** (`bill_discount_lines`, §5); the cap of R3 and its re-spread use only those of them still in the open part (cap = their current pre-discount total); a line that joins later is always full price, never carries a share; close refused while a discount request on the bill is open (`409 DISCOUNT_PENDING`). | Q6, OQ-4, G0-5, G0-6, M-9 |
| B8 | **Charges are sticky.** The service charge rate of the order type is written once at bill creation (`ChargeApplied { source: 'rule' }`); `RemoveServiceCharge` (approvable, reason) writes `ChargeRemoved`; no read, print, split, merge, move or reopen recomputes it from the rule; re-adding is an explicit `ApplyServiceCharge` (audited). | Q5, G1-14, M-3 |
| B9 | **Rounding once per split total** to the branch step (default Rs 1 = 100 paisa, method `nearest`, half up), printed as its own line. All arithmetic in integers (BigInt where products can pass 2^53), rounding half up at each named point only (§3.5). | D47, M-5 |
| B10 | **Payments** `{ mode_id, amount_minor, tendered_minor?, has_reference, taken_by_staff_id, shift_id }` ⚠️ Changed in v0.3 (H1-2, H1-20); any mode always available (K-7), reference required per mode (data); `amount_minor` is the money applied and never exceeds the split's balance (cash too); a cash `tendered_minor ≥ amount_minor` is what was handed over and its excess is the change, fixed at `AddPayment`; the reference (1–60 free text) lives only in the hub table `payment_references`, never in an event; removable before close (`take-payment`, reason, audited). | G1-2, K-7, M-6, H1-2, H1-20 |
| B11 | **Taken-by vs shift.** `taken_by_staff_id` = the signed-in person; `shift_id` = the shift whose money it is: on a device that is a **drawer** (has an open drawer shift) every payment lands in that drawer's shift, whoever takes it; on any other device the taker's own open shift. Cash on a device with no drawer shift and no own cash shift → `409 SHIFT_NOT_OPEN`. ⚠️ Changed in v0.6 (H6-3): a money shift is a shift in state **`open`** only; a COUNTED shift takes no payment, petty cash or drawer open → `409 SHIFT_NOT_OPEN { reason: 'shift_counted' }` (**TODO(owner) Q-2**: confirm "no money on a counted drawer while the variance waits"; Rec (a) no). | Q9, Q10, G1-6, README :183, H6-3 |
| B12 | **Close is online-only** (never device-queued), checked in one `BEGIN IMMEDIATE` transaction: pending void (04), pending weight (`live_units > 0`), open discount request, balance ≠ 0, buyer ID, screen total stale (`expected_total_minor`). Printer and internet are never on the close path. | G0-1, D11, 01c V18, R8, E5 AC1 |
| B13 | **Invoice numbers** are hub-assigned, per branch, gap-free, continuous across days, two series: `sale` and `credit` (G1-3). Assigned inside the close / reopen transaction as `MAX + 1` of the series (single writer, D45). | G0-3, G1-3 |
| B14 | (⚠️ Changed in v0.6 (H6-6), provisional, **TODO(owner) Q-3**: a reopened bill with no live line left — every order cancelled — and every split's balance 0 closes with **no new invoice**: `BillClosedEmpty { bill_id, alert_id? }`, state CLOSED, no `OrdersBilled`, no fiscal row; the credit alone stands for PRA.) **Reopen = full edit for every order type** (⚠️ Changed in v0.4 (H2-19): a reopen clears the discount's frozen amount; the discount is the bill's again until the next first close; ⚠️ Changed in v0.4 (H2-5): takeaway / parking full edit only while no other open bill holds the key, §3.10) ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) (`ReopenBill`, `reopen-bill`, approvable, reason): one `InvoiceCredited` per sale invoice of the bill (credit series, fiscal outbox ordered behind its original), 02b `OrdersUnbilled` (row Q-2, OQ-1), every split open again with its payments; lines are then added, voided, comped and removed through 02b / 04 as usual, discount and payments through 05; the next close of each split issues a **new** invoice number. **Dine-in:** full edit needs the seating re-opened (02a `SeatingReopened`, row T-3) — possible while the table has not been cleaned and no other open bill is on the seating; otherwise the reopen is **corrections only** (no new lines: 02a's `TABLE_SEATING_CHANGED`, ⚠️ Changed in v0.4 H2-14) (§3.10). A business day is never reopened; a bill from an earlier day may be reopened and its credit and new invoice count in **today's** Z (an earlier-day **takeaway / parking** reopen is corrections only, ⚠️ Changed in v0.4 (Q-3, developer call, owner delegated)). At a re-close, `BillClosed` is written when the seating is open and holds no other open bill (so a fully reopened table goes back to NEEDS_CLEANING); none otherwise. | Q8, Q11, G1-3, R2 |
| B15 | **A closed split is frozen; the rest stays open** ⚠️ Changed in v0.2 (OQ-6: was "the whole partly paid bill is frozen"). The units a closed split invoiced (item split: its assigned units; amount / equal split: every line's allocated share, so every line that existed at that close) can no longer change: 02b `RemoveItems` / `CompLine` / `SetLineWeight`, 05 `RemoveComp` and 04 `VoidItems` touching them → `409 LINE_IN_CLOSED_SPLIT` (line guard, rows Q-3, V-1); a change to a closed split is a reopen (Q8). Lines not in a closed split stay editable. **A new line ordered after a split closed joins the open remainder automatically** (the highest-numbered open split; no staff action). All splits closed = the bill is CLOSED; a later item on that seating opens a new bill (B1). Invariants: Σ closed-split units + open-remainder units = the bill's live line units; no unit in two splits. | OQ-6, G0-4 |
| B16 | **Takeaway / parking close any time after the first Send** (Q2): before the food, after it, or when a phone customer arrives. ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2): **before close** — forgot an item / customer wants more → `SubmitOrder` with `adds_to_order_id` (row Q-6: **the root order's token**, its own `table_key`, the root's `bill_key`, ⚠️ Changed in v0.5 (H3-1, owner 09:26 PKT)) joins the open bill; wrong item → 02b `RemoveItems` (not started) or 04 `VoidItems` (started, approval per grant) and add the right one; too many units → `RemoveItems` / `VoidItems` with `units`. **After close** → `ReopenBill` (approval per grant) → the same actions on the reopened bill → close again (credit + new invoice number). No lock for these types (02b §3.1), so nothing in 02a is involved. | Q2, G1-4, R2 |
| B17 | **Check bill** = a print, not a money event: built from the live bill by a pure `Doc` builder; banner `PROVISIONAL - NOT A TAX INVOICE`; never an invoice number, fiscal number or QR; total at the **default payment class** (cash) stated on the slip; one `CheckBillPrinted` event (audit, ids and counts). `RequestBill` (02a) prints it at the bill printer of the table's zone / floor; no 01d notice, no push to the cashier; the cashier's open-bills list shows "check bill printed" as a pulled status. | G1-1, G1-10, Q2, Q13 |
| B18 | **Print to.** A bill document whose job fails or waits (03c status) can be re-targeted at run time to another printer (`RetargetBillPrint`, 03c row P-2): the pending job moves; nothing prints twice. | G1-10, Q13 |
| B19 | **Buyer ID on the whole bill.** Threshold per authority as data (PRA Rs 50,000 = 5 000 000 paisa, pre-tax, after discount), checked on the **whole bill's** net (every split, closed or not, incl. after a reopen), never per split. Above it each split's close needs `{ buyer_name, buyer_id_number }` or an approved waiver (`WaiveBuyerId`, `close-without-buyer-id`, approvable) → invoice `buyer_id_refused = true`. The ID number lives **only** in the hub table `invoice_buyers` read by the adapter and the receipt builder (**TODO(owner) Q-1 (H6-5):** the receipt prints the last 4 today; PRA r.6 asks for the CNIC / NTN on the receipt — Rec (a) print the full number on paper, still out of every log, event, alert, audit row, Z, query response and sync): never in an event, a log line, an alert, an audit row, the Z or a response. **No feature splits a sale to stay under the threshold.** ⚠️ Changed in v0.3 (H1-16, owner R5): when the whole bill crosses the threshold only after a split closed without buyer data (a later round, OQ-6), the buyer ID (or the approved waiver) is required **from the next split close on**; closed splits and their invoices are untouched. | Q18, G1-9, A7, R5 |
| B20 | **Fiscal port.** `FiscalAdapter { key, submit(invoice), health() }` (credits go through `submit` with `invoice_type: 'credit'`); registered at startup by key (`none`, `PRA` in the pilot); the branch setting picks one; the hub posts directly over HTTPS from the branch internet (K-16). Every sale / credit invoice of a fiscalized order type gets one `fiscal_outbox` row in its transaction; the worker sends in invoice order, at least once, with the invoice's own id (USIN); the answer is an event (`FiscalNumberAssigned`), so receipts and reprints read it from the log. | K-14, K-16, K-17, G0-10, G1-12, G1-16 |
| B21 | **Offline / catch-up.** Close never waits for the authority. A receipt printed before the answer shows the local invoice number + **"FISCAL NUMBER PENDING"** + date / time (A2 default); a reprint after the answer shows the fiscal number and QR. Catch-up window per authority as data (PRA 7 days, r.8(3)); a row older than `stuck_after_ms` (data, default 30 min) or past half the window raises the 01d `fiscal_outbox_stuck` alert to managers (r.8(1) report is theirs). | K-17, A2 |
| B22 | **POS ID** per hub by default, optional per-device mapping (device → POS ID) in the branch fiscal settings; the token per POS ID is a **hub secret entered on the hub admin page** ⚠️ Changed in v0.2 (OQ-3 (b): was "hub config file by CLI"): `SetFiscalToken` (admin session, permission `manage-fiscal-settings`, Owner only by default, row B-1); **write-only** — no query or response ever returns it, the page shows only "set on <date>"; replacing = entering a new one; stored only in the hub table `fiscal_credentials` (never synced, never logged, never in an event; the audit event `FiscalTokenSet` carries ids and the time only); never in the repo, the spec or the cloud. | K-18, A1, G1-12, OQ-3 |
| B23 | **Shift per person.** `OpenShift` (float, 0 allowed); a drawer device holds at most one open shift; blind count server-enforced (no response carries `expected_minor` before the shift's `ShiftCounted`); variance above the branch threshold → 01d `shift_variance` request, the shift closes on approve; `skip-blind-count` (Owner by default) skips the count, always audited; optional `HandoverCount` on a drawer shift (variance recorded, shift stays open). | D21, Q9, Q10, G1-6 |
| B24 | **Petty cash is cash only, on a shift:** advance to a named staff member (open until settled: spent + change returned), direct cash-out (category, paid to, note), cash in; categories owner-edited; above the branch limit, or with a `requires_approval` grant → 01d `petty_cash` request. | Q15, G1-8 |
| B25 | **Day close stays 01a's `CloseBusinessDay`** (rows A-3, A-4): 05 registers guards (open shifts; unbilled, uncancelled, not carried-over orders) and an appender that closes 05's open requests `obsolete` and writes `ZReportIssued` before `BusinessDayClosed`, in the same transaction; the command moves to `close-business-day` and is also offered on the staff app (row H-1). `CarryOverOrders` (manager, reason) lets listed orders survive the close; they bill next day and show on that day's Z. Void requests still block (04). | K-5, Q11, M-8 |
| B26 | **Reports on the hub:** X (the open day, any time) and Z (one closed day) from the same pure builder over 05's projections; Z = Σ sale invoices − Σ credit invoices issued in the day, by payment mode, tax by class, discounts / comps / voids / reopens with requester, approver, method; per shift float / expected / counted / variance; open advances. Sales by item / hour / staff → 07. | Q14, K-9, G0 story 9 |
| B27 | **Remove comp** on an **unbilled** line (`RemoveComp`, `remove-comp`, approvable, reason) → 02b's new `LineCompRemoved` (row Q-4; 02b owns the event and its fold). A billed line's comp changes only through a reopen. | Q7, G1-7 |
| B28 | **Walk-out** = void the unpaid lines through 04 (reason `walk_out`, row V-2), no "unpaid" payment mode. | Q12 |
| B29 | **Receipt template** = a fixed layout with owner-edited header / footer lines, show / hide toggles and variables (`{branch_name}`, `{ntn}`, `{address}`, `{phone}`, `{bill_no}`, `{date}`, `{cashier}`); no logo; preview in the owner app with `renderText` moved to `@pos/domain` (row P-3). | K-12, R12 |
| B30 | **Logs carry ids and counts only** — never names, PINs, phone numbers, CNIC / NTN, tokens, amounts tied to a named person. ⚠️ Changed in v0.4 (H2-22): **no free text in an event** — notes, `paid_to` and references live in hub-only tables (`bill_texts`, `payment_references`), never synced; events carry `has_note` / `has_paid_to` / `has_reference`. | owner rule, G1-9, H2-22 |

### 1.5 Review fixes (v0.3, hostile run 1 on v0.2) ⚠️ Changed in v0.3

Every finding was checked against the code on `origin/main` @ `ea0ee00` (files named in the review) before the fix; all 27 hold. None is rejected.

| ID | Sev | Verified | What changed |
|---|---|---|---|
| H1-1 | BLOCKER | yes — `alerts/targets.ts` takes approver roles only from the requester's `requires_approval` grant | **Owner R1:** row D-1 becomes a **01d code row**: a request right `{ mode: 'holders', permission }` — the answerer must hold `permission` `allowed` with a scope covering the requester, never the requester; `shift_variance` and **every** `petty_cash` request use `{ mode: 'holders', permission: 'close-shift-for-others' }`, whatever the requester's grant. Row B-3 dropped (01d resolves holders). §3.14, D-1, #50, #53, #53b (approver matrix). |
| H1-2 | MAJOR | yes (spec-internal) | One cash rule: `amount_minor` = money applied (≤ balance, cash too), `tendered_minor` = handed over; change = Σ (tendered − amount) per cash payment; expected cash adds Σ cash `amount_minor`. §3.3 rule 8, §3.7, §6.9, §6.12, B10, #21, #23. |
| H1-3 | MAJOR | yes | Change belongs to the shift of the payment that received the tender (it is fixed at `AddPayment`); §3.3 rule 9 now only requires the closer's money shift for a **new** cash payment; `InvoiceIssued.change_shift_id` dropped. §3.3, §3.7, §6.12, #21. |
| H1-4 | MAJOR | yes — `menu-lines.ts:55-57` gives the whole remainder to the last weight; the review's run reproduces `[…, -2]` | New pure `allocateCappedMinor(total, caps)` (largest remainder, one paisa at a time to the largest fractional parts, never above a cap; `total ≤ Σ caps`), used for the discount spread and the `pro_rata` class spread; `allocateDealMinor` stays for deal parts and split shares. §3.5 (2), §3.6, B7, #10d. |
| H1-5 | MAJOR | yes | **Owner R3:** after any void / comp / remove / comp removal, the open part's discount = min(frozen − Σ closed-split D, open part's current pre-discount total), never negative, re-spread with `allocateCappedMinor`; closed splits never change; a reduction is not given back. B7, §3.5 (2), #16b. |
| H1-6 | MAJOR | yes — `LineGuard(db, order_id, touched_ids)` has no units | Row Q-3: guard input `touched: [{ order_item_id, units_after }]`; 05 refuses when `units_after` < the units closed splits invoiced. §3.8: a unit leaving the bill comes off the highest-numbered open split holding the line (fold of `ItemVoided` / `ItemRemoved` into the plan). #10b, #32. |
| H1-7 | MAJOR | yes — `MergeGuard` returns `{ blocked, order_item_ids }`, callers throw `MERGE_BLOCKED_BY_VOID` | Row T-1: `MergeGuard` returns `{ code, details } \| null`; 04 maps to its unchanged `MERGE_BLOCKED_BY_VOID`; `merge-tables` / `split-seating` throw the first non-null. |
| H1-8 | MAJOR | yes — `AlertRaised` is 04's (`REQUEST_ACTIONS`), `registerAuditAction` throws on a mapped type and after seal | Row V-3: 04 gains `registerRequestAction(kind, { requested, answered })`; 05 registers its seven kinds; `0023` deletes the `audit` checkpoint (`BillRequested` has history); §6.30: audit and request actions registered at module load, before any projection is built. |
| H1-9 | MAJOR | yes | **Owner R4:** day close allowed with a carried bill that has payments; X and Z show a separate line **"payments on open bills"** (and "paid earlier" for invoices that close carried bills); `RemovePayment` refuses a payment whose shift is COUNTED or CLOSED (`409 SHIFT_NOT_OPEN { reason: 'payment_shift_closed' }`) — money back on a reopened bill is an `out` payment on the actor's own money shift today; Z invariant restated. §6.10, §6.24, §6.26, F-4, #25b, #63b, #66. |
| H1-10 | MAJOR | yes — `requireLock` refuses NEEDS_CLEANING (`tables/lock.ts`) for `RemoveItems` / `SubmitOrder`; `SubmitOrder` always makes a new order (`ORDER_ITEM_ID_IN_USE` on an existing id) | **Owner R2:** reopen = full edit for every order type. **Takeaway / parking:** no lock; additions are new orders sharing the bill's `table_key` (02b row Q-6), so they join the reopened bill; cases B16. **Dine-in:** `ReopenBill` writes 02a **`SeatingReopened`** when the seating is not CLOSED and has no other open bill → full edit; otherwise reopen is **corrections only** (void / comp / remove, discount, payments; adding lines → `409 TABLE_SEATING_CLOSED`); row T-3; races §3.10. **S-9 (b):** a `SubmitOrder` on a NEEDS_CLEANING seating is accepted and re-occupies it; the new order opens a new bill. B1, B14, B16, §3.2, §3.10, §5, §6.12, §6.13, rows F-2, T-2, T-3, Q-6; tests #37b–#37f, #44a–#44e, #58b. |
| H1-11 | MINOR | yes — `applyDayClosed` sets `day_closed_at` on billed or all-served orders; `open-orders` hides them | Row Q-2: `OrdersUnbilled` also clears `day_closed_at`; new row **Q-5**: 02b folds `OrdersCarriedOver` (`carried_over = 1`), `applyDayClosed` skips and clears it, so a carried order stays on the open-orders list. |
| H1-12 | MINOR | yes | §6.6, §6.7 and the `discount` kind's `apply`: PARTLY_PAID → `BILL_PARTLY_PAID` checked before "not OPEN" → `BILL_NOT_OPEN`. |
| H1-13 | MINOR | yes | #8: 333.33 / 333.33 / 333.34 (remainder to the last). |
| H1-14 | MINOR | yes | §3.5 (3), (5): `N'_c = N_c + SC` for the SC class; `G = Σ N_c + SC + Σ T_c`; SC on pre-tax net, exclusive of tax in both price modes. |
| H1-15 | MINOR | yes | §3.6: `N_d` = the largest net whose digital total (net + its SC share + tax at `r_dig`, both price modes) ≤ `d`, by integer binary search over `[0, N]`; #15 gains an SC case. |
| H1-16 | MINOR | yes | **Owner R5:** when the whole bill crosses the threshold after a split closed without buyer data, the buyer ID is required from the next split close on (waiver with approval as before); closed splits and their invoices are untouched. B19, #42b. |
| H1-17 | MINOR | yes | (a) a credit of a `rejected` original is `rejected` too (same alert). (b) **strict order**: the oldest pending row (by `ord`) blocks the rows behind it, except a credit waiting for its original; A12 asks PRA whether order matters. §3.15. |
| H1-18 | MINOR | yes — `kinds.ts:151` | `fiscal_outbox_stuck`: `expires_at_day_close: true`; the worker re-raises it (same dedupe) on its next pass while a row is stuck. §3.15, row D-1. |
| H1-19 | MINOR | yes — `payloadHash(payload, omit)` omits one top-level field only (`lib/hash.ts`) | Row H-4 (code): `defineCommand({ hashOmit: string[] })` with dotted paths; `CloseSplit` omits `buyer`, `SetFiscalToken` omits `token`; rule: **a payload field that is a secret or a government ID is never hashed, stored or echoed** (also never in `VALIDATION_FAILED.issues`). #43, #81. |
| H1-20 | MINOR | yes | Choice: the reference moves to the hub-only table `payment_references` (like buyer IDs); `PaymentAdded` carries `has_reference` only; free text 1–60, no pattern check (a pattern would wrongly refuse real wallet ids that look like numbers, and the table never leaves the hub). B10, §3.7, §5, §6.9, §6.29. |
| H1-21 | MINOR | yes — `seatingTotals` counts billed orders | B1, §6.1, §6.2: a bill's orders are the seating's orders with `billed_at IS NULL` and `cancelled_at IS NULL` (CLOSED bills read `bill_orders`); open-bills lists only seatings with such an order. |
| H1-22 | MINOR | yes | §3.8: amount shares re-based on every change — the last open split absorbs the difference; below 1 paisa → close refused `BILL_SPLIT_INVALID { reason: 'shares_sum' }` until `SetSplits`. |
| H1-23 | MINOR | yes | §3.3 note, §6.12 step 6: each split close closes `obsolete` the open `comp` requests on the units it invoiced. |
| H1-24 | NIT | yes — `build-submit.ts:363` | Row Q-1 text: a `deal_part` carries the deal's class (unused, base 0). |
| H1-25 | NIT | yes | §12.5: "no new admin page" dropped. |
| H1-26 | NIT | yes | `openBillOf` removed from §4.2 (internal to 05). |
| H1-27 | NIT | yes | §5: `closed_split_units` filled by one `INSERT … SELECT … FROM json_each(lines)`; for amount / equal splits `units` = the line's live units at that close (the guard then freezes the whole line). |

### 1.6 Review fixes (v0.4, hostile run 2 on v0.3) ⚠️ Changed in v0.4

Every finding was checked against the code on `origin/main` @ `ea0ee00` (`alerts/commands/request-row.ts:107` `checkAlertIds`; `packages/events/src/alerts.ts:66-90` `AlertDetailsBase`; `tables/audiences.ts:7-18` (no `BillClosed`); `0013_orders.sql:20` `orders_token` UNIQUE; `tables/commands/open-table.ts:55-61` (re-enters an open seating, no `TABLE_NOT_FREE`); `engine/src/slip.ts:352` `ordersByKey`). All hold; none is rejected. One fix differs from the review's text: **H2-4** keeps tokens unique and the slip key per order (own token, a separate `bill_key`) instead of a non-unique token index.

| ID | Sev | What changed |
|---|---|---|
| H2-1 | MAJOR | 01d `checkAlertIds` needs `payload.alert_id === record.alert_id` on every `apply` draft. Following 04 row Q-1 (optional `alert_id` on 02b events), **every 05-written event that an `apply` can return carries `alert_id`**: 05's own events `alert_id: string \| null` (`InvoiceCredited` gains it; `BillReopened`, `DiscountApplied`, `ChargeRemoved`, `BuyerIdWaived`, `PettyCash*`, `ShiftClosed` already had it); 02b `OrdersUnbilled` and 02a `SeatingReopened` gain optional `alert_id: string` (absent on the direct path), folds ignore it. Rows Q-2, T-3; §6.13, §6.29; #39. |
| H2-2 | MAJOR | Row Q-3: guard input `[{ order_item_id, units_after, comped_after, money_changes }]`; 05 refuses (`LINE_IN_CLOSED_SPLIT`) when `units_after` < closed units, `comped_after` > `units_after` − closed units, or `money_changes` (weight, price) on a line with closed units. §3.5: a line's open base = its base − Σ `closed_split_units.share_minor`. #10b, #10f. |
| H2-3 | MAJOR | §6.26, F-4: **brought forward** (payments on not-CLOSED bills at the day's open) and **carried forward** (at the close); invariant Σ takings = Z net + carried forward − brought forward (holds for carried-in, reopened-and-reclosed and reopened-and-left-open bills). #63b, #66. |
| H2-4 | MAJOR | Row Q-6 rewritten: a takeaway addition gets **its own token** (`orders_token` unique kept) and its **own `table_key`** (slip grouping unchanged); 02b stores `orders.bill_key` (`'takeaway:' + root order_id`, the root of the `adds_to_order_id` chain; parking `table_key`; dine-in `'dine_in:' + seating_id`) folded from `OrderPlaced.adds_to_order_id` (new optional field, 03a row S-1, engine ignores it); the receipt and ticket print "adds to #<root token>". 05 bills by `bill_key`. Earlier-day reopen: corrections only (Q-3, developer call, owner delegated). |
| H2-5 | MAJOR | §3.10: a takeaway / parking reopen is full edit only while **no other open bill holds the key** (projected included, H2-9); else corrections only — **final** (Q-5, developer call, owner delegated). #44f. |
| H2-6 | MAJOR | 05's `details` use the existing `AlertDetailsBase` keys: `amount` (minor), `reason` (code), `identifier`; `shift_variance` → `{ amount: variance }`; `fiscal_outbox_stuck` → `{ quantity: count, minutes_late: oldest age }`. No 01d schema change. §3.14, §3.15, §6.6, §6.18, §6.20. |
| H2-7 | MAJOR | Row T-3: `SeatingReopened` and `BillClosed` join 02a `TABLE_EVENT_TYPES` (staff + cashier kiosks) and the client map / table-view frame sets; row Q-2: `OrdersUnbilled` joins 02b `ORDER_EVENT_TYPES` and the client `ORDER_FRAMES`. #6, #37b. |
| H2-8 | MAJOR | **Owner Q-1:** the frozen discount covers only lines on the bill at the first split close (`bill_discount_lines` from the first `InvoiceIssued`); R3's cap and re-spread use only those still open; later lines full price. B7, §3.5 (2), §5, #16b, #16c. |
| H2-9 | MINOR | §3.10: "another open bill" = a non-closed `bills` row on the seating / key **or** an unbilled, uncancelled order of it not in this bill's `bill_orders` (a projected bill). |
| H2-10 | MINOR | §6.2: open-bills also lists every non-closed `bills` row whatever its seating's state. |
| H2-11 | MINOR | §3.9: the merge guard also refuses a bill with `reopen_count ≥ 1`. |
| H2-12 | MINOR | §3.5 (2): a line's discount share is split over its parts with `allocateCappedMinor(share, base_parts)`. #10d. |
| H2-13 | MINOR | **Q-2 (developer call, owner delegated, review Rec):** `allowBillClosed` only when `ctx.queuedAt === null`; a queued replay keeps `TABLE_NEEDS_CLEANING`; the device's queue log shows "bill closed — send again?" and a fresh resend opens a new bill (S-9). Row T-3 (3), #37g. |
| H2-14 | MINOR | Agreed: `TABLE_SEATING_CLOSED` dropped (T18's `TABLE_SEATING_CHANGED` already refuses a submit naming a cleaned seating); row T-3 (4): `readOrder` adds `seating_state`, `RemoveItems` skips the lock when it is `CLOSED`. §9, #37c. |
| H2-15 | MINOR | §5: plan entries as rows `bill_split_lines(bill_id, split_no, order_item_id, order_id, units)` (indexes on `order_item_id`, `order_id`); `billing` folds `ItemVoided`, `ItemRemoved` (and `SeatingSplit` by `order_id`). |
| H2-16 | MINOR | `BillOpened { …, bill_key }`. |
| H2-17 | MINOR | `reopen_bill` values carry the sale invoice ids at raise; `apply` throws (answer refused) when they differ. §6.13. |
| H2-18 | MINOR | §3.15: strict order **per POS ID**; #71 rewritten. |
| H2-19 | MINOR | B14: a reopen clears the discount's frozen amount. |
| H2-20 | MINOR | §6.1: `reference` only for `take-payment` holders in scope; others get `has_reference`. |
| H2-21 | MINOR | **Q-4 (developer call, owner delegated):** parking `bill_key` = `'parking:' + plate + ':' + business_date`; 02b's `table_key` (03a slip key) unchanged. B1, row Q-6, #44h. |
| H2-22 | MINOR | B30, §5: free text (`note`, `paid_to`, `disposition`-style notes) never enters an event: hub-only table `bill_texts(event_id, field, text)`; events carry `has_note` / `has_paid_to`; the hub audit view shows the reason code (the text is read from `bill_texts` on the hub only, by `view-audit-log`). §6.29. |
| H2-23 | MINOR | §3.10 race text and row T-3 (5): `OpenTable` re-enters the reopened seating (02a §6.1, unchanged); a stale `seating_id` → `TABLE_SEATING_CHANGED`. #37d. |
| H2-24 | NIT | README row 05 → v0.4 DRAFT; S-5 notes PR #236. |
| H2-25 | NIT | §3.1, #3, #37, §6.2 reworded per `bill_key`. |
| H2-26 | NIT | `SHIFT_NOT_OPEN` gains `payment_shift_closed`; §3.3 rule 8a; §6.13 result merged. |
| H2-27 | NIT | `SeatingReopened` only when the bill was CLOSED. |
| H2-28 | NIT | §6.12 step 2 adds the seating / other-bill read; §6.9 `tendered_minor` only on a cash `in` (`400`). |
| H1-4, H1-6, H1-9, H1-17, H1-21 (run-1 PARTLY) | — | closed by H2-12; H2-2 + H2-15; H2-3 + H2-26; H2-18; H2-9 + H2-10. H1-5 stays with H2-8 (owner). |

### 1.7 Review fixes (v0.5, run 3 targeted check on v0.4) ⚠️ Changed in v0.5

Each finding was checked against `origin/main` @ `049f6ce` (`kds/commands/ready.ts:89-130`, `print/render/jobs.ts:58-61`, `orders/ledger.ts` `takeOut`, `envelope.ts:45` `EventDraft` without `event_id`, `route.ts:150-155`, `AlertRaised.v1.ts:19` free `values` record, `0013_orders.sql:20` `orders_token`). All nine hold; none is rejected.

| ID | Sev | What changed |
|---|---|---|
| H3-1 | MAJOR | **Owner answer (2026-11-18 09:26 PKT), option (a):** a takeaway add-on **keeps the root order's token** (R2). Row Q-6: `orders_token` UNIQUE → non-unique index `orders_token_day (business_date, token)` in `0021_orders_billing.sql`; `nextToken` stays `MAX + 1` (only a root order takes a new token); own `table_key` (03a slip grouping unchanged); `bill_key` = the root's; the "adds to #<root token>" print need is dropped (no 03b / 03c row). **Token rule:** the token is a display identifier only; no code resolves token → order. Call sites on `main` (all by `order_id`, display only): 03b `kds/commands/ready.ts:89-130` (`identifierText` → `#<token>`), 03c `print/render/jobs.ts:58-61` (ticket header), client `pass/cards/PassCard.tsx:69-72`, `staff/orders/lists/OpenOrdersRow.tsx:95`, `staff/orders/view/OrderView.tsx:87` (`identOf`); 02b `nextToken` (`submit-order.ts:357-360`, MAX only). Any later token search must return the bill (`bill_key`) or the latest open order of that token, never assume one row. #44g. |
| H3-2 | MAJOR | `BillReopened { …, order_ids }` = the bill's current order set; the fold `INSERT OR IGNORE`s them into `bill_orders` (no new read: §6.13 already reads them), so a reopened PARTLY_PAID bill keeps its orders and is full edit when nothing else holds the seating / key. #37h. |
| H3-3 | MAJOR | §6.26 / F-4: **brought / carried forward = live payments on splits that are not closed** (at the day's open / close), incl. a reopened bill's splits and a carried bill's open splits; payments of a closed split are in its invoice and never counted again. #63b adds the PARTLY_PAID carry (500 closed, 200 open). |
| H3-4 | MINOR | Row Q-3: every caller (`RemoveItems`, `VoidItems`, `CompLine`, `RemoveComp`, `SetLineWeight`) passes `comped_after` and `base_after_minor` from its ledger result; 05 also refuses when `base_after − Σ closed shares < 0`, or `≠ 0` while `units_after` = closed units. #10f adds the comp-then-void sequence. |
| H3-5 | MINOR | Free text is out of **every** event payload and out of `AlertRaised.values`: `bill_texts(subject_id, field, text)` where `subject_id` is an id the command mints and carries in its event (`entry_id`, `payment_id`, or a `note_id` ULID for bill-level notes); written by the command on the direct path and **at raise** on the approval path (the alert `values` carry `subject_id` and `has_note` / `has_paid_to` only; `apply` reads no text). Every payload in §6 lists `has_note` / `has_paid_to`. #43. |
| H3-6 | MINOR | Row Q-6: `orders.bill_key` is for takeaway / parking only (`NULL` for dine-in); 05 bills dine-in through `seating_orders` (follows merges / splits, B1). |
| H3-7 | NIT | Parking `bill_key` = `table_key || ':' || business_date` (the normalised plate). |
| H3-8 | NIT | `InvoiceIssued` lists `discount_line_ids: string[] \| null` (the bill's first close, else `null`). |
| H3-9 | NIT | Rebased on `main`; S-5 updated; migration `0021_orders_billing.sql`; P0.12 / P0.13 file lists. |
| H2-2, H2-3, H2-4, H2-9, H2-22 (PARTLY) | — | closed by H3-4; H3-3; H3-1; H3-2; H3-5 — and with them H1-6, H1-9, H1-21. |

### 1.8 Review fixes (v0.5.1, run 4 targeted check on v0.5) ⚠️ Changed in v0.5.1

| ID | Sev | What changed |
|---|---|---|
| H4-1 | MAJOR | §3.10 / §6.13: the reopen decides its mode with **this bill's own order set excluded** — for a bill reopened from PARTLY_PAID that set is the orders §6.13 reads (step 1, ⚠️ Changed in v0.5.2 (H5-4)) and later writes as `BillReopened.order_ids`. Step order stated in §6.13: (1) read bill, invoices, the bill's orders; (2) read the seating / key state and other bills; (3) decide the mode with "another open bill" excluding the set from (1); (4) build drafts (`BillReopened { order_ids }` first, so its fold fills `bill_orders` before any later read). #37h passes as written (full edit). |
| H4-2 | MAJOR | Verified: PR #237 (`lane-P0/dl-spec`) holds `02a_Tables_Spec_v1.1.7`, `02b_Ordering_Spec_v1.0.15`, `03a_Timing_Engine_Spec_v1.2.5`, `04_Voids_Audit_Spec_v1.0.6`, `01d_Notifications_Requests_Spec_v1.3` (and 03b v1.0.9, not 05's). **Developer call, owner may veto: #237 lands first;** 05 takes 02a v1.1.8, 02b v1.0.16, 03a v1.2.6, 04 v1.0.7, 01d v1.3.1. Re-scanned 2026-11-18: no other open PR or branch claims these; no new migration anywhere. §4.5 version line, every row, S-5, README row 05. |
| H4-3 | MINOR | §3.9 + row T-1: the **seating-split** guard also refuses a bill with `reopen_count ≥ 1` (`409 BILL_HAS_PAYMENTS`), like the merge guard. #57. |
| H4-4 | MINOR | Note storage completed: every approvable kind's `values` carry `note_id` / `has_note` (never the text) and `apply` copies them (`discount`, `remove_service_charge`, `reopen_bill`, `remove_comp`, `close_without_buyer_id`, `petty_cash`); `BuyerIdWaived`, `LineCompRemoved` (row Q-4) and `ShiftClosed` gain `has_note`, `note_id`; `PettyCashSettled` gets its own `note_id` (no collision with the advance's `entry_id` rows); `petty_cash.paid_to` / `note` columns dropped. #43. |
| H4-5 | MINOR | Row Q-6: the add-on's `OrderPlaced.token` and the command result's `token` = the `adds_to_order_id` order's token (read by the statement that checks it); call-site list completed (`kds/commands/handover.ts`, `kds/details.ts` incl. `return_of`'s `ro.token`, `print/render/jobs.ts:140-223`, `orders/queries/{open-orders,order-view}.ts`, `orders/exports.ts`, client `QueuedSentCard.tsx:28` — all by `order_id`, display only); hub test `apps/hub/test/orders/migration.int.test.ts:14` (asserts the `orders_token` UNIQUE DDL) changes to the non-unique `orders_token_day` (*corrected by v0.5.2 H5-2: that test stops at 0013 and is unchanged; the four `test/db` migration tests change*). P0.12 files; #44g. |
| H4-6 | NIT | B1 and #44a texts: the add-on keeps the root's token, its own `table_key` and the root's `bill_key`; parking `table_key \|\| ':' \|\| business_date`. |
| H4-7 | NIT | README row 05 lists 03a; the R13 / milestone C amendment markers are intended (R37). |

### 1.9 Review fixes (v0.5.2, run 5 targeted check on v0.5.1) ⚠️ Changed in v0.5.2

| ID | Sev | What changed |
|---|---|---|
| H5-1 | MINOR | Verified: PR #237 `merged: true` into `module-deeplinks` (10:21 PKT), whose plan reaches `main` at its Z3 and plans a further 01d text bump (G-1) — 05's D-1 number. **Developer call, owner may veto:** 05's bumps are applied only in its phase 0, after `module-deeplinks` (and anything else claiming F, 00, 01a, 01b, 01d, 02a, 02b, 03a, 03c, 04) has reached `main`; phase 0 task 0 bases every bump on `main`'s text then and re-takes the next free numbers **without a STOP** (a pure renumber), updating §4.5 and README row 05 in the same commit; a clash in **content** (both change the same section) is still a STOP. §4.5 version line, S-5, P0.1. |
| H5-2 | MINOR | Verified against `main`: `test/orders/migration.int.test.ts` builds with `copyUpTo(dir, '0013')` and asserts `user_version` 13 (:171-190), so 0021 does not touch it — **P0.12 no longer changes it**. 0021 (likewise 0022, 0023) breaks four hub tests, each changed in the task that adds the migration: `test/db/alerts-migration.int.test.ts` (:180 "exactly 0001–0020": the list gains `0021_orders_billing.sql` / `0022_bill_routes.sql` / `0023_billing.sql`); `test/db/order-line-options-migration.int.test.ts`, `order-line-station-migration.int.test.ts`, `order-line-option-quantity-migration.int.test.ts` (their pre-00NN rewind re-runs the whole directory and asserts the exact `applied` list, and the rewinds must also undo 0021's columns `tax_class_id`, `carried_over`, `bill_key` and its index, so the re-run does not hit "duplicate column"). Plus one new test for 0021: `orders_token_day` non-unique (two `(date, 56)` rows accepted), `orders_token` gone. P0.12, P0.16, task 6, row Q-6, §1.8 H4-5 note. |
| H5-3 | NIT | Changelog rows v0.1–v0.5 restored to the numbers those files carry; the v0.5.1 row names the mapping. |
| H5-4 | NIT | §1.8 H4-1 says step 1; §6.13's Script reads the order set and, for takeaway / parking, the `bill_key`'s other bills (≤ 8 unchanged). |
| H5-5 | NIT | §6.18: a repeated `CloseShift` while its `shift_variance` request is open is **refused** `409 SHIFT_VARIANCE_PENDING { alert_id }` (new code, the `DISCOUNT_PENDING` / `BILL_REOPEN_PENDING` pattern — 05 has no generic pending-request code); nothing is written; the first note stays. |

### 1.10 Review fixes (v0.6, hostile run 6 on v0.5.2) ⚠️ Changed in v0.6

| ID | Sev | What changed |
|---|---|---|
| H6-1 | MAJOR | `invoice_ref` = `invoice_prefix` + series letter (`S` sale, `C` credit) + zero-padded number (`AC1-S000123`, `AC1-C000007`); unique index `invoices_ref` over both series; the outbox / USIN id of a credit therefore never equals a sale's. §5, §6.12, §6.13, #26. |
| H6-2 | MAJOR | Every approval `apply` re-checks state in the answer transaction and **throws (answer refused)** when it moved (02b `comp-kind.ts:33` precedent): `remove_comp` (§6.14 checks incl. the line guard), `petty_cash` (shift `open`, cash-out ≤ available is **not** re-checked, H6-15), `remove_service_charge` / `close_without_buyer_id` / `discount` (bill OPEN / PARTLY_PAID as their command), `reopen_bill` (invoice ids, H2-17), `shift_variance` (shift still COUNTED with that count). Each split close also closes `obsolete` the open `remove_comp` requests on the units it invoices. §3.14, §6.12, #41, #53. |
| H6-3 | MAJOR | A money shift is a shift in state **`open`**; a COUNTED shift takes no payment, petty cash or drawer open → `409 SHIFT_NOT_OPEN { reason: 'shift_counted' }`. The rejected-variance state is defined once: **stays COUNTED**, a recount is accepted, money stays refused until CLOSED. B11, §3.11, §6.9, §6.20, §6.21, #46, #50. **TODO(owner) Q-2** (confirmation). |
| H6-4 | MAJOR | PRA mapping from 05's records (§3.15): payment modes gain a data column **`pra_payment_mode`** (01a row A-1); per-line `tax_minor` and `rate_bp` on `InvoiceIssued.lines` (class tax spread over its lines with `allocateCappedMinor`, Σ = `TotalTaxCharged`); service charge = one item in its class; rounding only inside `TotalBillAmount`; a credit copies its original's buyer row and uses the **original's** POS ID. New **A13** (codes for wallet / QR / online and how rounding / service charge are sent); **STOP at build** for the PRA adapter task until A13 and PRA spec v1.2 answer them. |
| H6-5 | MAJOR | **TODO(owner) Q-1** (full CNIC on the receipt vs last 4). Anchor B19. |
| H6-6 | MAJOR | Provisional, review Rec (b): a reopened bill with no live line and every split balance 0 closes with **no new invoice** (`BillClosedEmpty`); **TODO(owner) Q-3**. B14, §3.10, #44j. |
| H6-7 | MAJOR | One registry `permission` per command; a second right is a handler check via `ctx.directory.resolve` (02a `lock.ts:50` pattern): `PrintCheckBill`, `RetargetBillPrint` → `take-order`; `PrintBillDocument { receipt \| credit_note }` → `take-payment`; **new `PrintReport { x_report \| z_report }`** → `view-reports`; `CountShift`, `CloseShift`, `HandoverCount`, `shift` query → `manage-own-shift`, another person's shift additionally needs `close-shift-for-others` (handler), and row B-1 makes `close-shift-for-others` require `manage-own-shift` in `checkGrants`. §6, §12.2 (25 commands). |
| H6-8 | MINOR | A credit follows its **original's** fiscal state, authority and POS ID, whatever the branch setting is now. §3.15, #78. |
| H6-9 | MINOR | The `BillRequested` fold computes from the `bills` row when one exists; open-bills `check_printed_at` = max(`bills.check_printed_at`, `seatings.bill_requested_at`). §6.4, §6.2, #18. |
| H6-10 | MINOR | `carried_orders` PRIMARY KEY `(order_id, business_date)`. §5, #63. |
| H6-11 | MINOR | `CloseSplit` takes `bill_ref` (ensure bill); a zero-total bill closes with no payment. §6.12, #5b. |
| H6-12 | MINOR | `pro_rata`: a digital `in` after a cash `in` on the split → `409 BILL_PAYMENT_ORDER`; the cash part's SC = SC − digital SC share; each part's SC share taxed at that part's rate. §3.6, #15. |
| H6-13 | MINOR | Verified (`default-roles.ts:40` grants Manager every permission but `manage-roles`): row B-2 — the Manager filter also excludes `skip-blind-count` and `manage-fiscal-settings`; the backfill grants Manager neither; #90. |
| H6-14 | MINOR | §11: `billing/index.ts` is created in task 7 and each task registers what it adds; the audit maps of 05-1's events move into 05-1 with 0023; 05-2 adds only its own (its events have no history before it). |
| H6-15 | MINOR | `PETTY_CASH_EXCEEDS_DRAWER` and its check are **dropped** (YAGNI: an overdraw shows as variance at the count; a refusal would let a cashier binary-search expected cash). §6.20, §9. |
| H6-16 | NIT | #16 names `allocateCappedMinor`. |
| H6-17 | NIT | `invoices_issued` index dropped (no invoice search query). |
| H6-18 | NIT | §6.2: per-class sums from the aggregate, then `computeBill` in memory; pending voids not subtracted in the list (labelled "before pending voids"). |

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

**Bill** = what one seating (dine-in) or one `bill_key` (takeaway root order with its additions; parking plate) owes ⚠️ Changed in v0.4 (H2-25). **Split** = one part of a bill paid on its own (`split_no` 1..n). **Line base** = a line's `billed_minor` (02b) minus its `pendingVoids` `refund_minor` (04); a `deal_part` and a return line have base 0; a pending-weight line has base 0 and blocks close. **Payment class** = `cash` | `digital`, from the payment mode (data). **Default class** = `cash` (the class a check bill and an unpaid split show). **Net** = Σ line bases − discount. **Invoice** = the immutable money record of one closed split (`series: 'sale'`) or of a credit (`series: 'credit'`). **Drawer** = a cashier device whose open shift was opened with `as_drawer: true`. **Fiscalized** = the bill's order type has `fiscalize: true` and the branch adapter is not `none`.

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
| PARTLY_PAID | lines **not** in a closed split: yes; units of a closed split: **no** (`LINE_IN_CLOSED_SPLIT`, B15) ⚠️ Changed in v0.2 (OQ-6) | open splits without payments only; closed splits never | open splits only | refused |
| CLOSED | no (`ORDER_BILLED`); a new order on the seating opens a **new** bill (B1) ⚠️ Changed in v0.2 (OQ-6) | no | no | n/a (seating NEEDS_CLEANING) |
| reopened (OPEN, `reopen_count ≥ 1`) ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) | **full edit:** yes, through 02b / 04 (add, remove, void, comp) — takeaway / parking always, dine-in when `SeatingReopened`; **corrections only** (dine-in, table cleaned / re-seated or another open bill on the seating): remove / void / comp / comp removal of its own lines, no new lines (02a's `409 TABLE_SEATING_CHANGED`, ⚠️ Changed in v0.4 H2-14) | yes for splits without payments | carried payments stay; balance may be negative (pay-out, §3.7) | full edit: as OPEN; corrections only: n/a |

### 3.3 Close preconditions (B12), checked in this order, all in the close transaction

1. Bill exists, state OPEN / PARTLY_PAID (`404 BILL_NOT_FOUND`, `409 BILL_NOT_OPEN`); the split exists and is open.
2. No pending void on the bill's orders (`pendingVoids(db, order_ids)` non-empty) → `409 BILL_CLOSE_BLOCKED { reason: 'void_pending', order_item_ids }`.
3. No pending weight (`live_units > 0` and `line_total_minor IS NULL`, 04 R-4) on a line of the split → `{ reason: 'weight_pending', order_item_ids }`.
4. No open `discount` request on the bill → `409 DISCOUNT_PENDING { alert_id }`.
5. *(Removed in v0.2, OQ-6: unassigned lines no longer exist — a `SetSplits` item plan must cover every live unit (§3.8) and a later line joins the open remainder automatically.)* ⚠️ Changed in v0.2 (OQ-6)
6. Buyer ID (B19): the whole bill's net > threshold → payload `buyer` present, or a `BuyerIdWaived` on the bill → else `409 BUYER_ID_REQUIRED { threshold_minor, net_minor }`.
7. `expected_total_minor` (the total the screen showed) equals the recomputed split total → else `409 BILL_TOTAL_CHANGED { expected_minor, total_minor }` (a void approved, a round added, a rate effective date passed while the cashier looked).
8. Balance ⚠️ Changed in v0.3 (H1-2): Σ in `amount_minor` − Σ out `amount_minor` = total (an `in` never exceeds the balance at `AddPayment`) → else `409 BILL_BALANCE_DUE { split_no, balance_minor }`. Change = Σ over the split's cash `in` payments of (`tendered_minor` − `amount_minor`), each part on its own payment's shift.
8a. ⚠️ Changed in v0.4 (H2-26): an amount plan whose re-based last open share falls below 1 paisa (§3.8) → `422 BILL_SPLIT_INVALID { reason: 'shares_sum' }`.
9. ⚠️ Changed in v0.3 (H1-3): change needs no check at close — each cash payment's change was fixed at `AddPayment` on that payment's money shift (§3.7). A **new** cash payment needs the closer's money shift (§6.9).

Pending **comp** requests do not block: each split close closes `obsolete` the open `comp` requests on the units it invoiced ⚠️ Changed in v0.3 (H1-23: was "only at the last close"); the last close closes the rest (02b To 05).

### 3.4 Line grouping for tax

For each live line of the bill's orders (by `orderLines`), base as §3.1, class = the line's `tax_class_id` (row Q-1): `item` → its own; `deal` → the deal's (on the whole billed deal amount); `deal_part` → none (base 0); `option_child` → its own. A line is taxed only when the branch has `tax_enabled` **and** the line's class is non-null (01a S34). No line is ever in two classes.

### 3.5 Split arithmetic (pure, `@pos/domain/src/billing/compute.ts`)

Per split `s`, given its lines (item split: the assigned units of each line, base pro rata to units with `allocateDealMinor`; amount / equal split: every bill line, base allocated by the split's share with `allocateDealMinor`, remainder to the last split), the discount, the service charge state, the payment classes and the rate table:

1. `S` = Σ line bases of the split.
2. `D` = the split's share of the **bill** discount (v0.2, OQ-4): the discount (amount, or percent → `floor(Σ bill bases × pct_bp / 10000)`) is spread over **every bill line** by base with **`allocateCappedMinor(D_bill, bases)`** ⚠️ Changed in v0.3 (H1-4): largest-remainder allocation, each share `floor(D × base / Σ base)`, the left-over paisa one each to the lines with the largest fractional part (ties: the line added first), never above the line's base; so `0 ≤ share ≤ base` always (property #10d). A split's `D` = Σ its lines' shares (item split: per assigned units; amount / equal: per allocated share; a line's share is split over its parts with **`allocateCappedMinor(share, base_parts)`**, the caps being the base parts just computed, ⚠️ Changed in v0.4 (H2-12); a line's **open base** = its base − Σ its `closed_split_units.share_minor`, shared by the open units, ⚠️ Changed in v0.4 (H2-2)); frozen at the first split close and capped for the open part per B7 (only over `bill_discount_lines`, Q-1) ⚠️ Changed in v0.3 (H1-5, owner R3); `D ≤ S` always. Per-class net `N_c` = class bases − class discount shares.
3. `SC` = `round_half_up((S − D) × sc_bp / 10000)` when the bill's service charge is applied, else 0 — always on the pre-tax net and **exclusive of tax in both price modes** ⚠️ Changed in v0.3 (H1-14). SC is taxed under `service_charge_tax_class_id` (setting; `null` = untaxed, A9): for that class `N'_c = N_c + SC`, for every other class `N'_c = N_c`.
4. Rates: for each class `c` and class `k ∈ {cash, digital}`, `r(c, k)` from the rate table at the issue date (B5). Split payment class: all payments digital → digital; all cash / none → cash; both → the authority's `mixed_class_rule`: `higher_rate` = cash; `pro_rata` = §3.6.
5. Tax ⚠️ Changed in v0.3 (H1-14): prices **exclusive**: `T_c = round_half_up(N'_c × r / 10000)`; prices **inclusive**: `T_c = round_half_up((N'_c − SC_c) − (N'_c − SC_c) × 10000 / (10000 + r)) + round_half_up(SC_c × r / 10000)` (menu prices carry their tax, the service charge never does; `SC_c` = SC in that class, else 0). Total before rounding: exclusive `G = Σ N_c + SC + Σ T_c`; inclusive `G = Σ N_c + SC + Σ round_half_up(SC_c × r / 10000)`. SC is counted once.
6. Rounding: `R = roundToStep(G, step, method) − G`; total `= G + R`. `R` prints as its own line.
7. Invariants (property tests, §10.3): Σ over splits of `S` = Σ bill line bases; Σ `T_c` printed = Σ invoice tax rows; one rounding per split; no negative line, net, tax or total; `pro_rata` and `higher_rate` give the same result when only one class is paid.

### 3.6 Mixed classes, `pro_rata` (B6)

The cashier enters the digital payment(s) first. With digital amount `d`, the digital net share `N_d` is the **largest integer net in `[0, N]` whose digital total ≤ `d`**, where the digital total of a net `x` = `x` + its service-charge share `round_half_up(x × sc_bp / 10000)` + the tax of both at `r_dig` per §3.5 (both price modes) ⚠️ Changed in v0.3 (H1-15: v0.2's closed form ignored SC); found by integer binary search (≤ 40 steps, pure). For several classes `x` is spread over the classes by `N_c` with `allocateCappedMinor`. The rest `N − N_d` is taxed at the cash rate. The screen shows the new total before cash is taken (M-7). Changing or removing a digital payment recomputes. `higher_rate` ignores the share. ⚠️ Changed in v0.6 (H6-12): on a `pro_rata` split a digital `in` after a cash `in` → `409 BILL_PAYMENT_ORDER { split_no }` (remove the cash first); the digital part's SC share = `round_half_up(N_d × sc_bp / 10000)`, the cash part's = SC − that share; each SC share is taxed at its own part's class rate.

### 3.7 Payments and change (B10, B11)

- `AddPayment` is accepted on an open split with `amount_minor > 0`; `direction: 'in'` normally; `direction: 'out'` only when the split's balance is negative (a reopened bill whose new total is lower than what was paid) and never above that negative balance — money given back from the closer's money shift (cash out of the drawer, or a card / online reversal recorded with a reference).
- ⚠️ Changed in v0.3 (H1-2, H1-3): every `in` payment's `amount_minor` ≤ the split's balance at `AddPayment` (cash too, `422 PAYMENT_EXCEEDS_BALANCE`). Cash `in`: `tendered_minor ≥ amount_minor` optional (absent = exact); its change `tendered − amount` is fixed at `AddPayment` and belongs to **that payment's** `shift_id` (the drawer that received the tender). A payment carried by a reopen keeps its shift and its change.
- A mode with `reference_required` → `422 PAYMENT_REFERENCE_REQUIRED` without a 1–60 character reference; the reference is stored only in `payment_references` (hub-only), `PaymentAdded` carries `has_reference` ⚠️ Changed in v0.3 (H1-20).
- Expected cash of a shift = float + Σ cash `in` `amount_minor` − Σ cash `out` `amount_minor` + Σ settled-advance cash returned − Σ advances − Σ cash-outs + Σ cash-ins ⚠️ Changed in v0.3 (H1-2: tendered and change cancel out on the receiving shift) (G1-8; property test).

### 3.8 Splits (B2)

- `SetSplits` replaces the plan of the **open** splits: `mode: 'items'` (each split lists `{ order_item_id, units }`; **every live unit not in a closed split exactly once** (`units_missing` / `units_exceed`); a deal goes whole; an option child follows its parent), `'amount'` (shares in paisa of the open remainder's total at the default class, ≥ 1 each, Σ = that total; converted to net shares by `allocateDealMinor`), `'equal'` (`n` 2–20 over the open remainder). A split with payments keeps its number and plan entry or the command is refused (`409 BILL_HAS_PAYMENTS { split_nos }`, G0-4: no money moves silently). Closed splits are never touched; after the first close the mode of the open remainder may change, the closed splits keep theirs. ⚠️ Changed in v0.2 (OQ-6)
- A later round (dine-in) adds lines: they **join the open remainder automatically** — the highest-numbered open split (item split: as assigned units; amount / equal: that split absorbs them whole) — with no staff action and no block on close; staff may move them among open splits with `SetSplits` ⚠️ Changed in v0.2 (OQ-6: was "unassigned until a `SetSplits`, close refused").
- **A unit leaving the bill** (`ItemVoided`, `ItemRemoved` folded by 05) comes off the **highest-numbered open split** that holds the line; units invoiced by a closed split can never leave (the line guard refuses, row Q-3) ⚠️ Changed in v0.3 (H1-6).
- **Amount shares are re-based on every change** ⚠️ Changed in v0.3 (H1-22): the last open split's share = the open remainder's default-class total − Σ the other open shares; if that would fall below 1 paisa the close is refused `422 BILL_SPLIT_INVALID { reason: 'shares_sum' }` until a `SetSplits`.
- The discount (B7, whole bill only, before the first close) and the service charge (B8) are bill-level and spread per §3.5 ⚠️ Changed in v0.2 (OQ-4).
- **Money invariants** (property tests #10b, #10c) ⚠️ Changed in v0.2 (OQ-6): Σ units over closed splits + open remainder = the bill's live line units; no unit is in two splits; the units invoiced by a closed split are unchanged until a reopen; Σ split totals (closed + open) = the bill as paid.
- The buyer-ID threshold reads the **whole bill** (B19); a split never changes it.

### 3.9 Follow 02a merges and splits (02a To 05, G0-4)

- Merge (`TablesMerged`, S2 into S): refused by 05's merge guard (row T-1) while either seating's bill has a payment, a discount, a closed split or **any invoice (`reopen_count ≥ 1`)** ⚠️ Changed in v0.4 (H2-11) (`409 BILL_HAS_PAYMENTS`). Otherwise the fold: S has a bill → S2's bill (if any) is marked `absorbed_into`; S has none → S2's bill is re-pointed to S. A removed service charge stays removed on the surviving bill (B8); the absorbed bill's own state is dropped.
- Seating split (`SeatingSplit`): refused while the source bill has payments, discount, a closed split **or `reopen_count ≥ 1`** (⚠️ Changed in v0.5.1 (H4-3): a reopened bill reads `bill_orders`, so a moved order would stay on it; same rule as merge, H2-11) (`409 BILL_HAS_PAYMENTS`); otherwise the moved orders leave the bill at the next read (the bill reads `seating_orders` live, B1); an item split plan that names a moved line drops that entry (fold); the remaining live units still sum to the open splits (a dropped unit simply leaves the bill).

### 3.10 Reopen (B14)

⚠️ Changed in v0.3 (H1-10 + S-9, owner R2, 2026-11-17 23:58 PKT): **reopen = full edit for every order type**, decided inside the reopen transaction (direct path) or the answer transaction (`reopen_bill` approve), from the state read there:

| Bill | Condition (read in the transaction) | Mode | 02a effect |
|---|---|---|---|
| takeaway / parking | **no other open bill holds the `bill_key`** ⚠️ Changed in v0.4 (H2-5) | **full edit** (no lock; additions = `SubmitOrder { adds_to_order_id }`, row Q-6; **not** for an earlier-day takeaway, see the next row) | none |
| takeaway / parking | the bill's orders are of an **earlier business day** (Q-3, developer call, owner delegated) | **corrections only**; an item to add is a new order today (its own bill) | none |
| takeaway / parking | another open bill holds the key (an addition after close opened it, #44e) | **corrections only** — **final** (Q-5, developer call, owner delegated) | none |
| dine-in | seating state ≠ `CLOSED` (not cleaned, so no new seating can be on its tables) **and** no other open bill on the seating | **full edit** | when the bill was CLOSED (⚠️ Changed in v0.4 (H2-27)): `SeatingReopened { seating_id, bill_id, alert_id? }` → `bill_closed = 0`, state re-folded from its live orders (ORDERED / FOOD_ON_TABLE), `bill_requested_at` cleared; holder and assignee unchanged, so `requireLock` passes for the holder / `take-order-anywhere` as usual |
| dine-in | seating `CLOSED` (cleaned, maybe re-seated), or another open bill on the seating (S-9 (b)) | **corrections only** (`bills.reopen_mode = 'corrections'`): void / comp / comp removal / remove of its own lines, discount, payments | none; a `SubmitOrder` naming that seating → 02a's `409 TABLE_SEATING_CHANGED` (T18; ⚠️ Changed in v0.4 (H2-14): no new code); a `RemoveItems` on a `CLOSED` seating skips the lock (row T-3) |

**Another open bill** ⚠️ Changed in v0.4 (H2-9), ⚠️ Changed in v0.5.1 (H4-1) = a non-closed `bills` row on the seating / `bill_key` **other than this one**, **or** an order of it with `billed_at IS NULL`, not cancelled and **not in this bill's order set** (its `bill_orders`; for a bill reopened from PARTLY_PAID, the orders §6.13 reads in its step 1 and writes as `BillReopened.order_ids`) (a projected bill counts). The mode is decided with this set excluded, before any draft is built (§6.13 step order).

**Races** (single writer, every check inside `BEGIN IMMEDIATE`): `CleanTable` committed first → the reopen sees `CLOSED` → corrections only. Reopen (full) committed first → the seating is occupied again, so `CleanTable` is refused `409 TABLE_HAS_OPEN_ORDERS` (02a, unchanged); `OpenTable` on its table re-enters the reopened seating (holder, or `take-order-anywhere`), a stale `seating_id` → `TABLE_SEATING_CHANGED` ⚠️ Changed in v0.4 (H2-23: was "`TABLE_NOT_FREE`", which `OpenTable` never answers). A reopen request raised before a clean and approved after it → the mode is the one read at approve (corrections only). A `SubmitOrder` (S-9 (b)) committed before a full reopen → the seating has another open bill → corrections only.

**S-9 (b), a new order after close** (row T-3): after `BillClosed` and before `CleanTable`, `SubmitOrder` on that seating is accepted (`requireLock` no longer refuses NEEDS_CLEANING for `SubmitOrder` only; `OpenTable`, merge, handover and `RemoveItems` keep `TABLE_NEEDS_CLEANING`); 02a's `OrderPlaced` fold sets `bill_closed = 0` and re-folds the state (ORDERED / FOOD_ON_TABLE); 05 sees an unbilled order that is in no open bill's `bill_orders` → a new projected bill on the seating; its close writes `BillClosed` again (B14).

Allowed on a CLOSED or PARTLY_PAID bill whose orders are not cancelled. Effects, one transaction: `BillReopened` → per closed split, `InvoiceCredited { credit_no, ref_invoice_id }` (credit = the full original: same lines, tax rows, discount, service charge, rounding; payments not reversed) → 02b `OrdersUnbilled { order_ids, bill_id }` when the bill was CLOSED (row Q-2) → every split OPEN again with its payments (its closed-split units are no longer frozen); the split plan stays. Fiscal: each credit's outbox row is ordered behind its original (an original still pending → the credit waits, B20). After a full-edit reopen: lines are added and changed through 02b / 04 as usual (corrections only: no additions), discount and charges through 05, payments added / removed / paid out (§3.7); the next close of each split issues a new sale invoice. Reopen never reopens the business day; credits and new invoices land in today's Z (the day open now). ⚠️ Changed in v0.6 (H6-6) (provisional, **TODO(owner) Q-3**): when every order of the reopened bill is cancelled (02b writes `OrderCancelled` when no live line is left) and every split's balance is 0 (money given back with `out` payments), the command that made it so appends **`BillClosedEmpty { bill_id }`** — state CLOSED, no sale invoice, no `OrdersBilled`, no fiscal row, no receipt; the credit is the only fiscal record.

### 3.11 Shifts (B23)

```
 (none) ──OpenShift──► OPEN ──CountShift──► COUNTED ──CloseShift──► CLOSED
                         │                     │  variance > threshold → shift_variance request; CLOSED on approve
                         │                     └─ reject → stays COUNTED; recount accepted; no money until CLOSED (v0.6 H6-3)
                         └──CloseShift { skip_count } (skip-blind-count)──► CLOSED (count_skipped)
   HandoverCount (drawer shift, any time while OPEN): count + variance recorded, shift stays OPEN
```

- One open shift per person; a drawer device in at most one open shift (`409 DRAWER_IN_USE`). A shift's money (B11) and its petty cash (B24) are the only inputs to its expected cash (§3.7).
- **Blind count:** `CountShift { counted_minor }` stores the count first; only its response (and later reads) carry `expected_minor` and `variance_minor`. Every read before that returns the shift without them (server rule, tested). A recount after a reject writes a new `ShiftCounted`.
- Open petty-cash advances never block `CloseShift` (G1-8); they are listed on the close screen and on the X / Z.
- Closing another person's shift: `close-shift-for-others` (blind count applies to the closer).
- A takeover on a drawer kiosk (README :183, Q10): the drawer shift stays open and keeps the drawer; the new person takes any mode; every payment lands in the drawer shift with `taken_by_staff_id` = the new person; the shift close and X / Z show the drawer's takings by `taken_by`.

### 3.12 Petty cash (B24)

`RecordPettyCash { kind: 'advance' | 'out' | 'in', amount_minor, category_id, paid_to?, advance_staff_id?, note? }` on the caller's money shift (cash). Advance: `advance_staff_id` required, open until `SettlePettyAdvance { advance_id, spent_minor, returned_minor, note? }` with `spent + returned = amount` (`422`); settling may happen on another shift (the returned cash lands there). Approval: grant `requires_approval` → request every time; grant `allowed` and `amount_minor > petty_cash_limit_minor` → request; every `petty_cash` request is answered by holders of `close-shift-for-others` (§3.14, H1-1 / owner R1). Vendor khata stays in module 10.

### 3.13 Day close (B25)

`CloseBusinessDay` (01a) after its own checks asks the guard list: 04 (void requests open) then 05 → `409 DAY_CLOSE_BLOCKED` with `reason`:
- `'shift_open'`: `{ shifts: [{ shift_id, staff_name, opened_at, is_drawer }], count }` (≤ 40);
- `'unbilled_orders'`: `{ orders: [{ order_id, identifier, total_minor, placed_at, open_minutes }], count }` (≤ 40): orders with `billed_at IS NULL`, `cancelled_at IS NULL`, not in `carried_orders` for this day.
Then the appender (row A-4) returns, in order: `AlertClosed` drafts (`obsolete`, note `day_closed`) for every open 05 request (`discount`, `remove_service_charge`, `petty_cash`, `shift_variance`, `reopen_bill`, `remove_comp`, `close_without_buyer_id`) and 02b's open `comp` requests (01d To 05) — void requests never reach here (04 guard); then `ZReportIssued`; then 01a appends 03a's `stockEffects` and `BusinessDayClosed`.

### 3.14 Approvals (01d kinds registered by 05)

| Kind | Raised by | Approver roles | `apply` (read-only, every draft carries `alert_id`) |
|---|---|---|---|
| `discount` | `ApplyDiscount` with grant `requires_approval` | the grant's `approver_role_ids` | `DiscountApplied` (re-checks the bill is OPEN and the amount still fits; else throws → answer refused) |
| `remove_service_charge` | `RemoveServiceCharge`, grant `requires_approval` | grant's | `ChargeRemoved` — ⚠️ Changed in v0.6 (H6-2): re-checks the bill is OPEN / PARTLY_PAID and the charge still applied, else throws |
| `reopen_bill` | `ReopenBill`, grant `requires_approval` | grant's | `BillReopened` + `InvoiceCredited`… + `OrdersUnbilled` (§3.10; numbers assigned in `apply` from the same read view, B13) |
| `remove_comp` | `RemoveComp`, grant `requires_approval` | grant's | 02b `LineCompRemoved` — ⚠️ Changed in v0.6 (H6-2): re-checks §6.14 (order not billed, `comped_units ≥ units`, line guard list incl. `LINE_IN_CLOSED_SPLIT`), else throws |
| `close_without_buyer_id` | `WaiveBuyerId`, grant `requires_approval` | grant's | `BuyerIdWaived` — ⚠️ Changed in v0.6 (H6-2): re-checks the bill is OPEN / PARTLY_PAID, else throws |
| `petty_cash` | `RecordPettyCash` (grant `requires_approval`, or over the limit) | **holders of `close-shift-for-others`** (01d right `{ mode: 'holders' }`, row D-1) ⚠️ Changed in v0.3 (H1-1, owner R1: was "grant's, or over-limit approvers") | the petty-cash event — ⚠️ Changed in v0.6 (H6-2): re-checks the shift is `open` (not COUNTED / CLOSED), else throws |
| `shift_variance` | `CloseShift` with `|variance| > variance_threshold_minor` | **holders of `close-shift-for-others`** (⚠️ Changed in v0.3, H1-1, owner R1) | `ShiftClosed { alert_id }` — ⚠️ Changed in v0.6 (H6-2): re-checks the shift is still COUNTED with the same `ShiftCounted`, else throws |

⚠️ Changed in v0.3 (H1-1, owner R1): 01d as built takes approver roles only from the requester's `requires_approval` grant (`alerts/targets.ts`); row D-1 adds the right **`{ mode: 'holders', permission: 'close-shift-for-others' }`**: any signed-in person who holds that permission `allowed` with a scope covering the requester may answer (Manager, Owner by default; never the requester), whatever the requester's own grant; routing (`answerers`) resolves those holders. `petty_cash` and `shift_variance` always use it.

*(v0.2's "over-limit approvers" via 01b `rolesGranting` is replaced by the 01d holders right; row B-3 dropped.)* Steps = `APPROVAL_TIER_STEPS`; `needs_pin: 'always'` (money; 01d `approval_receipt`); approver = `AnswerFacts.answerer_staff_id`, never `actor_id`. `details` carry ids, amounts and reason codes only (never a buyer ID), **in `AlertDetailsBase`'s existing keys** ⚠️ Changed in v0.4 (H2-6): `amount` (minor), `reason` (the reason code), `identifier`; `shift_variance` → `{ amount: variance_minor }`; any other key would be dropped by the schema. Withdraw = never asked (`onWithdraw` returns `[]`). Dedupe keys: `discount:<bill_id>`, `remove_sc:<bill_id>`, `reopen:<bill_id>`, `remove_comp:<order_item_id>`, `buyer_waiver:<bill_id>`, `petty:<command_id>`, `variance:<shift_id>`.

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

- **Order** ⚠️ Changed in v0.3 (H1-17), ⚠️ Changed in v0.4 (H2-18): **strict per POS ID** — for each POS ID the worker sends that POS ID's oldest `pending` row by `ord`, and while it backs off only **that POS ID's** later rows wait (A12: does PRA require order?); a credit waiting for its original steps aside; one POS ID with a missing token never holds another's rows. A credit of a `rejected` original becomes `rejected` too (same stuck alert, same developer fix). One request in flight per hub (PRA has no batch API; 200 invoices / rush fit easily).
- **At least once, same id:** the request carries the invoice's own `USIN` (= `invoice_ref`, e.g. `AC1-000123`); a crash between the HTTP answer and the `FiscalNumberAssigned` commit resends the same USIN (test). The outbox row is written by the projection fold in the close transaction, so a committed invoice always has its row; a rolled-back close has none.
- **Not fiscalized** (adapter `none`, or order type with `fiscalize: false`, or an invoice issued while the branch was on `none`): row state `not_required`; the receipt has no fiscal block.
- **Switch** `none` → `PRA` (G1-16) applies to invoices issued after the setting's `switched_at`; earlier invoices stay `not_required`. ⚠️ Changed in v0.6 (H6-8): **a credit always follows its original** — its fiscal state (`not_required` ↔ `not_required`; an `acked` / `pending` original → the credit is fiscalized), its authority and its POS ID — even when the branch has since switched to `none` or the reopening device maps to another POS ID.
- **Stuck:** a `pending` row older than `stuck_after_ms`, a `rejected` row, or a row older than half the authority's `catch_up_window_ms` → one `fiscal_outbox_stuck` alert (dedupe `fiscal_stuck:<branch_id>`, managers, `closes_on: 'owner'`, **`expires_at_day_close: true`** ⚠️ Changed in v0.3 (H1-18: 01d refuses `false` without `'seen'`); closed `done` when no row is stuck; after a day-close expiry the worker re-raises it with the same dedupe on its next pass while a row is still stuck); details = `{ quantity: stuck count, minutes_late: oldest age in minutes }` (⚠️ Changed in v0.4 (H2-6), existing keys).
- **Health:** `adapter.health()` is called by the worker at most every 60 s while rows wait; its result is in `fiscal-status` (§6.27). No HTTPS call ever runs on a command path.
- **Secrets:** the adapter reads the POS ID's token from the hub table `fiscal_credentials` (B22, §6.32) at send time ⚠️ Changed in v0.2 (OQ-3); a missing token → the row stays `pending` with `last_error: 'token_missing'` and the stuck alert fires (go-live precondition, G1-16).
- **PRA adapter** (`apps/hub/src/billing/fiscal/pra.ts`): `POST` JSON to the configured environment's base URL (`sandbox` / `production`, values in the branch fiscal settings; sandbox `https://ims.pral.com.pk/ims/sandbox/api/Live/PostData`, production `https://ims.pral.com.pk/ims/production/api/Live/PostData`), header `Authorization: Bearer <token>`; Node 22 built-in `fetch` with `AbortSignal.timeout(10_000)`. Fields from the research: `TotalSaleValue` (Σ item sale values excl. tax and discount), `TotalTaxCharged`, `Discount`, `TotalBillAmount`, `PaymentMode` (1 cash, 2 card, 3 voucher, 4 loyalty, 5 mixed, 6 cheque; from `pra_payment_mode`, H6-4), `InvoiceType` (1 sale; **3 credit with `RefUSIN`**), POS ID, USIN, date-time, buyer name / CNIC / NTN when present, items (description, quantity, unit price, sale value, tax rate, tax). **Mapping from 05's records** ⚠️ Changed in v0.6 (H6-4): `PaymentMode` = from each payment mode's **`pra_payment_mode`** column (owner data, 01a row A-1; seeded `cash` → 1, `card` → 2; wallet / QR / online have no code in the research → **A13**, no default); payments of more than one PRA code → 5 (mixed); a mode without a code → the invoice stays `pending` with `last_error: 'mode_unmapped'` and the stuck alert fires (never a guessed code). Items = `InvoiceIssued.lines` with per-line `tax_minor` and `rate_bp` (each class's `T_c` spread over its lines with `allocateCappedMinor(T_c, line nets)`, so Σ item tax = `TotalTaxCharged`); the **service charge** is one item `Service charge` in its tax class; **rounding** is inside `TotalBillAmount` only (not an item) until A13 says otherwise. A credit's buyer fields are read from its original's `invoice_buyers` row (`ref_invoice_id`), its POS ID is the original's (H6-8). **STOP at build:** the PRA adapter task (§11 task 30) does not start until A13 and PRA's spec v1.2 settle the unmapped codes and the rounding / service-charge placement. Every other field and the answer's shape are taken from PRA's "Technical Specification Software Fiscal Device v1.2" at build; a field the document leaves unclear is a STOP to the owner, not a guess. Verification QR payload = `https://reg.pra.punjab.gov.pk/IMSFiscalReport/SearchPOSInvoice_Report.aspx?PRAInvNo=<fiscal_number>` unless PRA's answer carries its own.
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
| 00 | `defineCommand` (`approvable`, `sessionKind: 'both'` row H-1), registry, projections registry (`register`, `reset`, live-only folds), `ctx.state` (business day), `ctx.directory`, `ctx.clock`, writer tx for worker appends, list cursor, `staff_names` (00 v1.10 H-1), hub admin page entry (row H-2), boot hook after listen (row H-3) | §3, §6 |
| 01a | `branchConfig()` (`tax_enabled`, `tax_classes` + `fiscal_category`, `billing` key, row A-1), `CloseBusinessDay` with guard and appender lists (rows A-3, A-4), `BusinessDayOpened` / `BusinessDayClosed`, `business_day` in engine state | §3.4–§3.6, §3.13 |
| 01b | `resolve(staff, permission)` with scopes, new permissions (row B-1), `ALLOWED_ONLY_PERMISSIONS` (B-3 dropped, H1-1) | §3.14, §6 |
| 01c | `allocateDealMinor` (BigInt-safe, remainder to the last) | §3.5, §3.6, §3.8 |
| 01d | `defineAlertKind`, the holders right (row D-1, H1-1), `APPROVAL_TIER_STEPS`, `alerts.raiseMany`, `alerts.listOpen`, `alerts.close` drafts, `AnswerFacts`, read-only `apply` contract, target `managers` | §3.13, §3.14, §3.15 |
| 02a | `seating_orders`, `seatings` (read-only joins), `currentTableOf`, merge guard list (row T-1), `BillRequested`, `TablesMerged`, `SeatingSplit`, `BillClosed` and `SeatingReopened` schemas (05 writes them, row T-3), `requireLock` rules (row T-3) | §3.8, §3.9, §3.16 |
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
| *(`openBillOf` removed from the exports: internal to 05)* ⚠️ Changed in v0.3 (H1-26) | — | — | — |
| `BILL_KINDS` | the seven kind names of §3.14 + `fiscal_outbox_stuck` | — | 07 money view, 01d tests |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 06 | Sync carries `bill`-stream events; cloud read models for shift and Z history and D22 tiles (sales by payment mode, discounts, voids) are built from synced events with `buildReport` / `computeBill` (K-9). `invoice_buyers` and `fiscal_outbox` are hub state and are **never synced** (B19). A hub restore from the cloud keeps the invoices (events) but loses buyer IDs, fiscal tokens and outbox worker state: the restore runbook re-derives the outbox from events (fold) and the owner re-enters the tokens on the hub admin page (B22). |
| 07 | Sales by item / category / hour / staff, the live money view with failed-PIN and notice-seen lists (01d To 05 money section, README :226), tax report — from `InvoiceIssued` / `InvoiceCredited` / payment events (Q14). |
| 01e | A Windows-only authority path (PRA local service, KPRA RIMS) is decided with 01e / hardware when such an adapter is built (K-16). |
| Milestone C | Adapters SRB, KPRA, BRA, FBR-ICT behind the port, each with its catalog rows confirmed against a notification (research rule). |
| Pilot checklist (plan) | G1-16 go-live preconditions (owner tasks): POS ID(s) registered with PRA (A1), production token entered on the hub admin page (B22, §6.32), one sandbox run passed, the owner's / accountant's acceptance that only the POS floor reports to PRA (R20). Any missing → the branch starts on `none`; the switch is a setting change (audited `config_audit`). M-2 note for 01c data entry: leave `is_default` off unless truly default. |

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

**Version numbers (spec task 0, 2026-11-17):** next free after `main` **and** every remote branch and open PR (checked with `gh api` and `git ls-tree` on every `origin/*` ref): F v1.13 → **v1.14**; 00 v1.11 (DRAFT on `main`) → **v1.12**; 01a v2.5.1 → **v2.6**; 01b v1.9.1 → **v1.10**; 01d v1.2.5 → **v1.3.1**; 02a v1.1.6 → **v1.1.8**; 02b v1.0.14 → **v1.0.16**; 03a v1.2.4 → **v1.2.6** (⚠️ Changed in v0.4 (H2-4), free on every ref); 03c v1.0.10 → **v1.0.11**; 04 v1.0.5 (on `main` since PR #236, ⚠️ Changed in v0.5 (H3-9)) → **v1.0.7**. ⚠️ Changed in v0.5.1 (H4-2): PR #237 (notification deep links, open) holds 02a v1.1.7, 02b v1.0.15, 03a v1.2.5, 04 v1.0.6, 01d v1.3; **developer call, owner may veto: #237 lands first**, so 05 takes the numbers above (re-scanned 2026-11-18: 4 open PRs, every branch). ⚠️ Changed in v0.5.2 (H5-1): #237 merged into `module-deeplinks`, not `main`. **These numbers are provisional.** 05 applies its bumps only in its phase 0, after `module-deeplinks` (and anything else claiming these specs) has reached `main`; P0.1 then bases each bump on `main`'s text and re-takes the next free numbers **without a STOP**, updating §4.5 and README row 05 in the same commit; only a content clash (two modules editing the same section) is a STOP. Migrations: hub **0021** (02b row Q-1), **0022** (03c row P-1), **0023** (05) (main ends at 0020; no branch claims more); cloud **0016**, **0017** (main ends at 0013; `lane-HD/h10` claims 0014, 0015). The numbers are re-taken at phase 0 (a renumber is no STOP, H5-1).

| Row | Target → version | Change | Why |
|---|---|---|---|
| F-1 | Foundation → **v1.14** §4.1 + `packages/events/src/envelope.ts` | `stream_type` gains **`'bill'`** (stream id = `bill_id`) for bill, split, payment, invoice, credit, reopen and fiscal-answer events; `shift` keeps shifts, petty cash, counts, drawer opens; `hub` gets `ZReportIssued`, `OrdersCarriedOver`. No DB CHECK exists; Zod enum only. | K-2 |
| F-2 | Foundation → **v1.14** §4.4 | "BILLED is set by `BillClosed`" → "BILLED is set by **`OrdersBilled`** (every order type); `BillClosed { seating_id }` only drives the table's NEEDS_CLEANING (dine-in, at each bill's last close while the seating holds no other open bill; 02a `SeatingReopened` undoes it, 05 B14 ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2)). A bill reopen writes `OrdersUnbilled` (02b), which returns the order to the state it had before BILLED." Diagram label "bill close" stays. | K-1, B14, OQ-1 |
| F-3 | Foundation → **v1.14** §3.5, §7 OQ15, §8 | §3.5: answered — the PRA adapter ships live in the pilot behind 05's fiscal port (G1-16); bill close never waits for the authority; the receipt prints first with "fiscal number pending" and posts later through the hub fiscal outbox (05 §3.15); the hub posts directly over HTTPS (K-16). OQ15 → **answered (05 v0.1, G1 Q1, M-15)**. §8 row "Fiscal integration beyond PRA" → "one port, an adapter per authority; SRB / KPRA / BRA / FBR-ICT at milestone C (README R37)". §8 row "Transactional outbox" gains: "exception: the **fiscal outbox** (05 §3.15) — an external authority with its own id and order rules is not the sync stream; justified by PRA r.8(3) and s.48." | Q1, K-14, K-16, K-17 |
| F-4 | Foundation → **v1.14** §4.6 | Shift = one person's money period (float, payments by `shift_id`, petty cash, blind count, variance); a drawer belongs to one open shift; taken-by vs shift (05 B11); day close also refused while an order is neither billed, cancelled nor carried over (05 B25); Z = Σ sale invoices − Σ credit invoices of the day, and Σ of the day's shift takings = Z net + carried forward − brought forward, both counted on **open splits** (05 §6.26, H1-9 / owner R4, H2-3, H3-3; property test). Money note §4.1: "rounds once, at the split total (05 §3.5)". | Q9–Q11, G1-6 |
| F-5 | Foundation §6.2 (append, no bump) | 05 §9 codes. | §9 |
| H-1 | 00 → **v1.12** §6.3 / registry (`apps/hub/src/commands/registry.ts`, `route.ts`) | `defineCommand({ sessionKind: 'device' \| 'admin' \| 'both' })`: `'both'` registers the command on `/commands/<name>` (staff session) **and** `/admin/commands/<name>` (admin session); one `command_id` space, same handler; permission resolved from the session's staff in both. Used by `CloseBusinessDay` (row A-5). Proposed, owner to confirm at approval (S-2). | K-5 |
| H-2 ⚠️ Changed in v0.2 (OQ-3) | 00 → **v1.12** §8.2 hub admin pages + nav | Hub admin entry **`/admin/fiscal/`** (side-nav item and home tile, the 00 v1.9.2 `/admin/printers/` pattern), shown by `manage-fiscal-settings`; the page (05 client) lists the POS IDs from the branch fiscal settings with "Token: set on <date>" / "not set" and a write-only field per POS ID that sends `SetFiscalToken`; the field is never pre-filled. No hub config field and no CLI (v0.1's proposal dropped). | G1-12, K-18, B22, OQ-3 |
| H-3 | 00 → **v1.12** boot (`apps/hub/src/lib/boot.ts`) | Start the **fiscal worker after listen**, beside the print worker (03c H-11 pattern), stop joined in `beat.stop`; 05 provides `startFiscalWorker(deps)`. | B20 |
| H-4 ⚠️ Changed in v0.3 (H1-19) | 00 → **v1.12** `lib/hash.ts`, `commands/{registry,route}.ts` (code) + logging test | `defineCommand({ hashOmit?: string[] })` with dotted paths extends H-9's single `omit`: the listed fields are removed before `payload_hash` is computed. **Rule: a payload field that is a secret or a government ID is never hashed, stored or echoed** — not in `processed_commands`, not in a log line, not in `VALIDATION_FAILED.issues` (the error mapper drops `input` / received values). `CloseSplit` omits `buyer`; `SetFiscalToken` omits `token`. Retransmit identity then compares the rest (a retransmit that changes only an omitted field is the same command). A hub test asserts no request body is logged for `/commands/*` and `/admin/commands/*`. | B19, B22, B30 |
| A-1 | 01a → **v2.6** §4.3 snapshot, §5.2 cloud `0016_billing_settings.sql`, §6 routes, §8.1 page | (1) `tax_classes[]` gains `fiscal_category: string \| null` (e.g. `'restaurant_service'`); `rate_bp` is "the rate for adapter `none` only". (2) Cloud table **`fiscal_catalog_rows`** (global, versioned, seeded): `authority, fiscal_category, payment_class, integration_status ('integrated' \| 'not_integrated'), rate_bp, effective_from DATE, notification_ref, source_note`; seeded only with rows whose ref is confirmed (PRA restaurant service: card / wallet / QR 500 bp, other 1600 bp, `PRA.32-24/2026/1313`, 2026-02-19); rows "ref not found" (research) are **not** seeded. Authority rules as data in `fiscal_authority_rules`: `authority, mixed_class_rule, buyer_id_threshold_minor, catch_up_window_ms, effective_from, ref` (PRA: `higher_rate`, 5 000 000, 604 800 000, eIMS Rules 2019). (3) Per-branch **billing settings** document (table `branch_billing_settings`, one row, `version`): payment modes `[{ mode_id, name, kind, payment_class, reference_required, is_active, sort_order, pra_payment_mode: int | null }]` (⚠️ Changed in v0.6 (H6-4): seeded 1 for `cash`, 2 for `card`, `null` otherwise until A13); `rounding_step_minor` (1–100 000, default 100), `rounding_method`; `prices_include_tax` (default false); `service_charge_bp` per order type (0–3 000, default 0); `service_charge_tax_class_id`; discount reasons `[{ code, label }]`; `max_discount_pct` (default 100); `variance_threshold_minor` (default 10 000); `petty_cash_limit_minor` (default 500 000); petty categories `[{ category_id, name, is_active }]`; `open_bill_flag_minutes` (default 240); receipt template (K-12: `header_lines` ≤ 6, `footer_lines` ≤ 6, ≤ 48 chars, show toggles `ntn`, `address`, `phone`, `cashier`, `order_no`, `bill_no`; `ntn`, `address`, `phone`, `invoice_prefix` ≤ 6); fiscal `{ authority, environment: 'sandbox' \| 'production', base_urls?, pos_ids: [{ pos_id, label }], default_pos_id, device_pos_ids: [{ device_id, pos_id }], integration_status, taxpayer_ntn, fiscalize_by_order_type: { dine_in, takeaway, parking, delivery } (delivery default false, Q17), stuck_after_ms (default 1 800 000), switched_at }`; owner rate overrides `[{ tax_class_id, payment_class, integration_status, rate_bp, effective_from, notification_ref }]`. **No secret** in it (B22). (4) Routes `GET` / `PUT /v1/admin/branches/:branch_id/billing` (`expected_version`, C2 branch guard, C4 check order, C7 route case, `config_audit` row, branch bump) and `GET /v1/admin/fiscal-catalog?authority=` (read-only). (5) Snapshot V4 gains the optional key **`billing`** (no snapshot version bump, R29; 03b A-1 precedent): the settings above plus `tax_rates` = for the branch's authority, every catalog row and override **resolved per tax class** (all `effective_from` rows, so the hub picks by date) and `authority_rules`; absent → hub defaults (adapter `none`, one cash mode, step 100, no service charge). (6) Owner app page "Billing" (§8.1) incl. the receipt preview with `renderText` (row P-4) and the fiscal-catalog view. | K-12, K-15, Q16, Q17, G1-5, G1-8, B5, B22 |
| A-2 | 01a → **v2.6** `@pos/events/src/admin/billing.ts` | Zod wire shapes for A-1 (C6 keyed lists: `mode_id`, `code`, `category_id`, `pos_id`, `device_id`; override key `(tax_class_id, payment_class, integration_status, effective_from)`); a mode with `kind: 'cash'` must have `payment_class: 'cash'` and at least one active cash mode exists (`422 CONFIG_REFERENCE_INVALID { field }`); unknown `tax_class_id` / `service_charge_tax_class_id` → `not_found` (C1). | A-1 |
| A-3 | 01a → **v2.6** §6.18b + code (`close-business-day.ts`) | `registerDayCloseGuard` keeps its signature but **appends** to an ordered list (registration order; 04's void guard first, then 05's); the first non-null result refuses; `resetDayCloseGuards()` for tests. 01a test #196 kept; new test: two guards, first wins. Proposed, owner to confirm at approval (S-3). | B25 |
| A-4 | 01a → **v2.6** §6.18b + code | `registerDayCloseAppender((ctx) → EventDraft[])` (list, registration order); after the guards, the command appends `[...appenderDrafts, ...withStockEffects(ctx, [BusinessDayClosed])]` in one transaction, so 03a's releases and `BusinessDayClosed` stay last (03a To 05) and the checkpoint follows `BusinessDayClosed`. Unregistered → today's behaviour. | K-5, B25 |
| A-5 | 01a → **v2.6** §6.18b, §8.2 + code | `CloseBusinessDay`: permission `manage-stock` → **`close-business-day`** (scope `branch`, B20 rule unchanged with the new name), `sessionKind: 'both'` (row H-1), so the staff app's manager / cashier kiosk can close the day; `/admin/stock` shows Close day by the new permission; on `DAY_CLOSE_BLOCKED` with `reason` `shift_open` / `unbilled_orders` it lists them like `void_pending` (G-21 `Message.items`). `OpenBusinessDay` stays `manage-stock` on the stock page. | K-5 |
| B-1 | 01b → **v1.10** catalogue + code (`packages/domain/src/permissions.ts`) | New permissions (group `bills`): `take-payment` (scopes `branch`, `my_floors`, `own_tables`), `manage-own-shift`, `close-shift-for-others`, `skip-blind-count`, `record-petty-cash`, `remove-service-charge`, `close-business-day`, `open-cash-drawer`, `remove-comp`, `close-without-buyer-id`, **`manage-fiscal-settings`** ⚠️ Changed in v0.2 (OQ-3) (all others `branch`). `ALLOWED_ONLY_PERMISSIONS` += `take-payment`, `manage-own-shift`, `close-shift-for-others`, `skip-blind-count`, `close-business-day`, `open-cash-drawer`, `manage-fiscal-settings`. Approvable: `apply-discount`, `remove-service-charge`, `reopen-bill`, `remove-comp`, `close-without-buyer-id`, `record-petty-cash`. ⚠️ Changed in v0.6 (H6-7): cloud `checkGrants` refuses a role granting `close-shift-for-others` without `manage-own-shift` (`422 CONFIG_REFERENCE_INVALID { field: 'grants.N.permission' }`), because the shift commands' registry permission is `manage-own-shift`. `apply-refund` stays, unused in the pilot (Q8). | K-13 |
| B-2 | 01b → **v1.10** default roles + cloud `0017_billing_defaults_backfill.sql` | Owner: every new permission `allowed`. Manager: every new permission `allowed` except `skip-blind-count` and `manage-fiscal-settings` (**Owner only** by default, OQ-3). Cashier: `take-payment` (`branch`), `manage-own-shift`, `open-cash-drawer`, `record-petty-cash` (`allowed`; the limit still applies), `apply-discount`, `remove-service-charge`, `reopen-bill`, `remove-comp`, `close-without-buyer-id` (each `requires_approval` by Manager). Order taker: `take-payment` (`own_tables`), `manage-own-shift`. `close-business-day`: Owner, Manager. ⚠️ Changed in v0.6 (H6-13): `default-roles.ts` builds Manager as "every permission but `manage-roles`" (`:40`), so that filter also excludes **`skip-blind-count`** and **`manage-fiscal-settings`**; the backfill grants Manager neither. New tenants by `seed-tenant` (`default-roles.ts`); existing tenants by the backfill, by **`default_key`**, active roles only (04 G-20 pattern), approver rows in `role_permission_approvers` with the dual-written `approver_role_id`; `directory_version` bump. Every grant state tested (04 G1-7 pattern). | K-13, README :191 |
| B-3 | *(dropped in v0.3, H1-1 / owner R1: 01d's holders right resolves the approvers)* | — | — |
| D-1 | 01d → **v1.3.1** §4.3 To 05, §3.3 (text) | 05's kinds (§3.14) and `fiscal_outbox_stuck` (action, `managers`, `closes_on: 'owner'`, `expires_at_day_close: true`, re-raised by the worker, H1-18); **code row** ⚠️ Changed in v0.3 (H1-1, owner R1: v0.2's "no 01d code change" was wrong): `AlertRight` gains `{ mode: 'holders', permission: Permission }` (`alerts/{kinds,targets,raise}.ts`, `answer-request.ts`): the answerer must hold `permission` `allowed` with a scope covering the requester and is never the requester; `answerers` routing resolves the holders; `approval` mode unchanged; 01d tests for the holders right and the approver matrix; at day close 05's appender closes its open requests and 02b's `comp` requests `obsolete` (note `day_closed`); void requests block instead (04). The "manager's live money view" part of To 05 moves **To 07** (Q14). | K-5, Q14, H1-1 |
| T-1 | 02a → **v1.1.8** §6 merge / split + code (`tables/{contracts,merge-guard}.ts`, `commands/{merge-tables,split-seating}.ts`) | `registerMergeGuard` appends to an ordered list (04 first, then 05); ⚠️ Changed in v0.3 (H1-7) `MergeGuard` returns `{ code: ErrorCode; details } \| null` (04's guard maps to today's `MERGE_BLOCKED_BY_VOID { order_item_ids }` unchanged); `merge-tables` and `split-seating` throw the first non-null result. 05's guard: `409 BILL_HAS_PAYMENTS { bill_id }` on a merge **and** a seating split when the bill has payments, a discount, a closed split or `reopen_count ≥ 1` (§3.9, ⚠️ Changed in v0.5.1 (H4-3)). Proposed, owner to confirm at approval (S-3). | G0-4 |
| T-2 | 02a → **v1.1.8** §4.3 To 05, §6.12, OQ1 (text) | "the seating's last open bill" → "**the bill's last split**" (K-3); `BillClosed` is written at a bill's last close while the seating is open and holds no other open bill (a full-edit re-close writes it again) ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2); `RequestBill`: 05 prints the check bill from `BillRequested` at the zone / floor bill printer (G1-10); OQ1 closed — no cashier alert (Q13). | K-3, Q13 |
| T-3 ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2), ⚠️ Changed in v0.4 (H2-1, H2-7, H2-13, H2-14, H2-23, H2-27) | 02a → **v1.1.8** §3 state fold, §4.2 `requireLock`, §6 + code (`tables/{lock,projection,audiences}.ts`, `packages/events/src/events/table/SeatingReopened.v1.ts`; client `features/staff/tables/map/map-store.ts`, `orders/table-view/refetch.ts`) | (1) Event **`SeatingReopened { seating_id, bill_id, alert_id?: string }`** (stream `table`, primary table; `alert_id` present on an approval, H2-1), written by 05's full-edit reopen of a **CLOSED** bill only (H2-27); fold: `bill_closed = 0` (only while state ≠ `CLOSED`), `bill_requested_at = NULL`, re-fold. (2) `OrderPlaced` on a seating with `bill_closed = 1` sets `bill_closed = 0` and re-folds (S-9 (b)). (3) `requireLock(…, { allowBillClosed: true })` from `SubmitOrder` only: NEEDS_CLEANING no longer refuses a submit; `OpenTable`, merge, handover keep `TABLE_NEEDS_CLEANING`; **H2-13 (Q-2, developer call, owner delegated):** only a live submit gets it (`ctx.queuedAt === null`); a queued replay keeps `TABLE_NEEDS_CLEANING`, and the client queue log shows "bill closed — send again?"; a fresh resend is accepted and opens a new bill (S-9). (4) No new error code (H2-14): a submit naming a cleaned seating keeps T18's `TABLE_SEATING_CHANGED`; `readOrder` adds `seating_state` (same statement) and `RemoveItems` skips the lock when it is `CLOSED`. (5) `CleanTable`, `OpenTable` unchanged (`TABLE_HAS_OPEN_ORDERS`; `OpenTable` re-enters an open seating, H2-23). (6) **Audiences** (H2-7): `SeatingReopened` and `BillClosed` join `TABLE_EVENT_TYPES` (staff sockets + cashier kiosks); the client map and table-view frame sets add both. Tests: reopen → state and frames, clean refused, submit on NEEDS_CLEANING, submit on a cleaned seating → T18. | H1-10, S-9, R2, H2-1, H2-7 |
| Q-1 | 02b → **v1.0.16** §5, §4.2 + code + hub `0021_orders_billing.sql` (⚠️ Changed in v0.5 (H3-9): the one 02b migration also carries `carried_over` (Q-5), `bill_key` and the token index (Q-6)) | `order_lines.tax_class_id TEXT NULL` (the `ItemAdded` line's class; a `deal_part` carries the deal's, never used because its base is 0 ⚠️ Changed in v0.3 (H1-24); `NULL` for an untaxed item); the fold writes it; `LineView.tax_class_id`, `ReadOrderLine` too (same statements); the migration adds the column and deletes the `orders` checkpoint so `orders` refolds from seq 0 (00 v1.10 H-2 safe; 0019 pattern). | K-4 |
| Q-2 | 02b → **v1.0.16** §3.3, §6.19 + code | Event **`OrdersUnbilled { order_ids: string[] (≥ 1), bill_id, alert_id?: string }`** (stream `order`, id = first order id, `.strict()`; `alert_id` present on an approval, ⚠️ Changed in v0.4 (H2-1)), written by 05's reopen; it joins 02b `ORDER_EVENT_TYPES` and the client `ORDER_FRAMES` (map, table view) (⚠️ Changed in v0.4 (H2-7)); fold `billed_at = NULL` **and `day_closed_at = NULL`** ⚠️ Changed in v0.3 (H1-11) for those orders; every 02b / 04 command that refused `ORDER_BILLED` accepts them again; the audience of `OrdersBilled` gets it too. | B14, OQ-1 |
| Q-6 ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2), ⚠️ Changed in v0.4 (H2-4), ⚠️ Changed in v0.5 (H3-1, H3-6, H3-7, H3-9) | 02b → **v1.0.16** §3.1, §3.2, §3.11, §5, §6.1 + code (`orders/{projection,build-submit}.ts`, `orders/commands/submit-order.ts`, hub `0021_orders_billing.sql`) | `SubmitOrder` for `takeaway` gains optional **`adds_to_order_id`**: a takeaway order of the **same business date**, not cancelled (unknown → `404 ORDER_NOT_FOUND`; another type, date or a cancelled order → `422 CONFIG_REFERENCE_INVALID { field: 'adds_to_order_id' }`; an earlier-day order is never a target, Q-3). The new order **keeps the root order's token** (owner H3-1 (a), R2; ⚠️ Changed in v0.5.1 (H4-5): its `OrderPlaced.token` and the command result's `token` = the `adds_to_order_id` order's token, read by the same statement that checks that order): `orders_token` UNIQUE is replaced by the non-unique index **`orders_token_day (business_date, token)`** in 0021; `nextToken` stays `MAX + 1` and runs only for a root order. It gets **its own `table_key`** (`'takeaway:' + order_id`, so 03a slip grouping is unchanged) and copies the customer fields; `OrderPlaced` carries `adds_to_order_id` (03a row S-1). New column **`orders.bill_key`** (0021; index `orders_bill_key`) for **takeaway / parking only** (`NULL` for dine-in, which 05 bills through `seating_orders`, H3-6): takeaway `'takeaway:' + root` (root = `adds_to_order_id`'s own root, else the order itself), parking `table_key || ':' || business_date` (the normalised plate, H3-7; Q-4); folded from `OrderPlaced` only. **Token rule:** a token is a display identifier only; every lookup is by `order_id` / `bill_key`; the call sites that show it (03b `kds/commands/ready.ts:89-130`, `kds/commands/handover.ts`, `kds/details.ts` incl. `return_of`'s `ro.token`; 03c `print/render/jobs.ts:58-61`, `:140-223`; 02b `orders/queries/{open-orders,order-view}.ts`, `orders/exports.ts`; client `pass/cards/PassCard.tsx`, `staff/orders/lists/OpenOrdersRow.tsx`, `staff/orders/view/OrderView.tsx`, `staff/orders/queue/QueuedSentCard.tsx:28`; ⚠️ Changed in v0.5.1 (H4-5)) read it by order id and need no change; the hub migration tests that list or re-run the whole directory change with 0021 (`test/db/alerts-migration.int.test.ts`, `order-line-{options,station,option-quantity}-migration.int.test.ts`; ⚠️ Changed in v0.5.2 (H5-2: was `test/orders/migration.int.test.ts:14`, which stops at 0013 and is unchanged)), plus a new 0021 test; a future token search returns the bill or the latest open order of that token. No "adds to #" print. No lock (02b §3.1). | H1-10, R2, H2-4, H3-1 |
| S-1 ⚠️ Changed in v0.4 (H2-4) | 03a → **v1.2.6** §4.2 `OrderPlaced` (text + schema) | Optional `adds_to_order_id: string` on `OrderPlaced` v1 (additive, R29, 04 T-1 pattern); the engine and every 03a fold ignore it; fixture with and without. No slip change (each order keeps its own `table_key`). | H2-4 |
| Q-5 ⚠️ Changed in v0.3 (H1-11) | 02b → **v1.0.16** §3.3 + code (`orders/projection.ts` `applyDayClosed`) | 02b folds 05's `OrdersCarriedOver` (`orders.carried_over = 1`, migration 0021 adds the column); `applyDayClosed` skips carried orders and clears the flag in the same fold, so a carried order keeps `day_closed_at = NULL` and stays on the open-orders list next day; the carry applies to one close. | B25 |
| Q-3 | 02b → **v1.0.16** §3.4 + code (`orders/line-guard.ts`) | `registerLineGuard` appends to an ordered list (04 first, then 05); first non-null → its `{ code, details }`. ⚠️ Changed in v0.3 (H1-6): the guard input becomes `(db, order_id, touched: [{ order_item_id, units_after }])` (every caller passes the planned live units after its change; 04's guard reads only the ids); 05 refuses when `units_after` < the units closed splits invoiced for that line. ⚠️ Changed in v0.4 (H2-2): the touched entry becomes `{ order_item_id, units_after, comped_after, money_changes: boolean }` (`CompLine`, `RemoveComp`: `comped_after`; `SetLineWeight` and any price change: `money_changes: true`); 05 also refuses when `comped_after > units_after − closed units`, or `money_changes` on a line with any closed units. ⚠️ Changed in v0.5 (H3-4): **every** caller (`RemoveItems`, `VoidItems`, `CompLine`, `RemoveComp`, `SetLineWeight`) passes `comped_after` and `base_after_minor` from its own ledger result; 05 also refuses when `base_after − Σ closed shares < 0`, or `≠ 0` while `units_after` = the closed units (a residual on zero open units). The guard signature widens to return `{ code: 'VOID_PENDING' \| 'LINE_IN_CLOSED_SPLIT', details }` (04's result maps to today's `VOID_PENDING` unchanged). 05's guard: a touched line's `units_after` is below the units closed splits of a not-CLOSED bill invoiced → `409 LINE_IN_CLOSED_SPLIT { order_item_id, bill_id, split_no }` (1 statement, `closed_split_units`) ⚠️ Changed in v0.2 (OQ-6: was "any closed split → `BILL_PARTLY_PAID`"). Proposed, owner to confirm at approval (S-3). | B15 |
| Q-4 | 02b → **v1.0.16** §3.9, §6.19 + code | Event **`LineCompRemoved { order_item_id, units, comp_minor, reason_code, has_note, note_id (⚠️ Changed in v0.5.1 (H4-4)), requester_staff_id, approver_staff_id, alert_id }`** (⚠️ Changed in v0.4 H2-22: the note in 05's `bill_texts`) (stream `order`), fold: `comped_units −= units`, `comp_minor −= comp_minor` (never below 0); written only by 05 on an unbilled line with `comped_units ≥ units`; export `planCompRemoval(line, units) → { units, comp_minor }` (the inverse of `planComp`'s per-unit value, 01c §3.4.8 cascades). 02b §12.3 Q2 "a comp cannot be undone" → "undone only before billing, by 05's `RemoveComp` with approval". | Q7, G1-7 |
| P-1 | 03c → **v1.0.11** §3.2, §5, §6 + hub `0022_bill_routes.sql` | Proposed, owner to confirm at approval (S-1). **Bill routes:** table `bill_routes(scope 'zone' \| 'floor' \| 'device' \| 'report' \| 'default', ref_id, printer_id)`, hub admin command `SetBillRoute { scope, ref_id, printer_id \| null }` (writes `BillRouteSet`, `hub` stream; `print_config` folds it), listed in `print-config`, a printer used by a route cannot be archived (`409 CONFIG_IN_USE`); export `billPrinterFor(db, { zone_id?, floor_id?, device_id?, report? })` → the first active of device → zone → floor → default (1 statement). 03c's Printers page gains a "Bill printers" section. | G1-10, S-1 |
| P-2 | 03c → **v1.0.11** §3.7, §4.2 + code | `retargetDocumentJob(tx, job_id, printer_id)`: a `document` job not acked and not cancelled moves to `printer_id` (`attempts = 0`, `last_error = NULL`; a job being sent is refused `409 PRINT_JOB_NOT_PENDING`); `documentJobsStatus(db, job_ids)` → `[{ job_id, printer_id, state: 'waiting' \| 'printing' \| 'printed' \| 'failed' \| 'cancelled', last_error }]` (1 statement). | G1-10, B18 |
| P-3 | 03c → **v1.0.11** §3.6 + `packages/domain/src/print.ts`, encoder | `DocBlock` gains `{ qr: string (≤ 400), size?: 3–8 }` → ESC/POS `GS ( k` (model 2, error correction M, module size `size`, default the largest that fits 80 mm / 58 mm, A3 default); `renderText` prints `[QR] <payload>`; a printer that ignores `GS ( k` still prints the fiscal number line beside it (05 always prints it). | G1-11, K-12, A3 |
| P-4 | 03c → **v1.0.11** §3.6, §4.2 (text + move) | `renderText(doc, width_cols)` moves to `@pos/domain/src/print-render.ts` (browser-safe, no `node:*`); the hub imports it from there. | K-12 |
| V-1 | 04 → **v1.0.7** §3.2, §6.1, §6.3 + code | `VoidItems` and `void-preview` ask 02b's line guard list with the touched lines and their `units_after` (H1-6) after the `ORDER_BILLED` check (05's guard → `409 LINE_IN_CLOSED_SPLIT` for units a closed split invoiced) ⚠️ Changed in v0.2 (OQ-6); 04's own lock check is unchanged. Proposed, owner to confirm at approval (S-4). | B15 |
| V-2 | 04 → **v1.0.7** §4.4 | `VOID_REASON_CODES` += `'walk_out'` (Q12). | Q12 |
| V-3 | 04 → **v1.0.7** §3.6 + `packages/domain/src/audit.ts` | `AUDIT_ACTIONS` += `fiscal_token_changed` (⚠️ Changed in v0.2, OQ-3), `bill_opened`, `check_bill_printed`, `bill_requested`, `splits_set`, `discount_requested`, `discount_applied`, `discount_removed`, `service_charge_removed`, `service_charge_applied`, `payment_added`, `payment_removed`, `buyer_id_waived`, `invoice_issued`, `bill_reopened`, `invoice_credited`, `fiscal_rejected`, `comp_removed`, `shift_opened`, `shift_counted`, `shift_count_skipped`, `handover_counted`, `shift_closed`, `petty_cash`, `drawer_opened`, `orders_carried_over`, `z_report_issued`; subject types `bill`, `shift`. Mapped by 05 through `registerAuditAction` (§6.30); details never carry a buyer ID or a name. ⚠️ Changed in v0.3 (H1-8): `AlertRaised` / `RequestAnswered` stay 04's; 04 gains **`registerRequestAction(kind, { requested, answered })`** (startup, before seal, a duplicate kind throws) feeding `REQUEST_ACTIONS`; 05 registers its seven kinds (`discount` → `discount_requested` / `discount_answered`; the others → `money_request_raised` / `money_request_answered`, the kind in the detail), so `AUDIT_ACTIONS` also gains `discount_answered`, `money_request_raised`, `money_request_answered`. 05's `0023` deletes the `audit` checkpoint so the projection refolds from seq 0 (02a's `BillRequested` has history; 04 §3.6 rule). | G0-9, E6 audit AC2 |
| R-1 | README (added in v0.1 as **proposed**; marked approved with 05; v0.2 adds **R38**, the size-budget exception, OQ-2) | Decision **R37** (amends R13, K-14 + G1-16; R13 carries an "Amended by R37" marker): "Fiscal port, outbox, rate table and adapter `none` are 05 pilot scope; the **PRA adapter ships and runs live from day 1** on the pilot's POS floor (G1-16), with the go-live preconditions as owner tasks and `none` as the setting fallback; milestone C keeps SRB / KPRA / BRA / FBR-ICT." Milestone C text "PRA/FBR integration (R13)" → "adapters SRB / KPRA / BRA / FBR-ICT (R37)". Module map row 05; carried rows To 05 marked landed (§4.6); new rows To 06 / To 07 from §4.3. | K-14, G1-16 |

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

- **`billing`** — ⚠️ Changed in v0.4 (H2-15): also 02b `ItemVoided`, `ItemRemoved` (a leaving unit off the highest open split, §3.8) and `SeatingSplit` by `order_id`; `BillOpened`, `ChargeApplied`, `ChargeRemoved`, `CheckBillPrinted`, `BillSplitsSet`, `DiscountApplied`, `DiscountRemoved`, `PaymentAdded`, `PaymentRemoved`, `BuyerIdWaived`, `InvoiceIssued` (+ `closed_split_units`), `BillReopened`, `InvoiceCredited`, `FiscalNumberAssigned`, `FiscalSubmitRejected`, `FiscalTokenSet`, `OrdersCarriedOver`, `ZReportIssued`, 02a `TablesMerged` / `SeatingSplit` (bill re-pointing, §3.9), `BusinessDayOpened` (current day key).
- **`shifts`** — `ShiftOpened`, `ShiftCounted`, `ShiftCountSkipped`, `HandoverCounted`, `ShiftClosed`, `PettyCashAdvanced`, `PettyCashSettled`, `PettyCashOut`, `PettyCashIn`, `DrawerOpened`, and the money facts of `PaymentAdded` / `PaymentRemoved` / `InvoiceIssued` (cash tendered, change) for the running expected cash.

Hub state that is **not** a projection (plain statements, never events, never synced; 03c rule): `invoice_buyers` (command-written), `payment_references` (command-written, v0.3 H1-20), `fiscal_credentials` (command-written, v0.2 OQ-3), `bill_print_jobs` (written with each print), and the worker columns of `fiscal_outbox`.

```sql
-- projection billing ---------------------------------------------------------------------------------------
CREATE TABLE bills (
  bill_id            TEXT PRIMARY KEY,
  scope              TEXT NOT NULL CHECK (scope IN ('seating','key')),   -- v0.3 R2: 'key' = takeaway / parking table_key
  seating_id         TEXT,                                  -- dine_in
  table_key          TEXT,                                  -- takeaway / parking: 02b orders.bill_key (v0.4 H2-4, H2-16; column name kept)
  order_type         TEXT NOT NULL,
  state              TEXT NOT NULL CHECK (state IN ('open','partly_paid','closed')),
  opened_at          INTEGER NOT NULL,
  closed_at          INTEGER,
  sc_bp              INTEGER NOT NULL DEFAULT 0,            -- ChargeApplied (rule or manual); 0 after ChargeRemoved
  sc_removed         INTEGER NOT NULL DEFAULT 0 CHECK (sc_removed IN (0,1)),   -- sticky (B8)
  discount_json      TEXT,                                  -- { kind, value, reason_code, alert_id, frozen_minor|null } | NULL; whole bill only (v0.2, OQ-4)
  split_mode         TEXT CHECK (split_mode IN ('items','amount','equal')),    -- NULL = one split
  buyer_waived       INTEGER NOT NULL DEFAULT 0 CHECK (buyer_waived IN (0,1)),
  check_printed_at   INTEGER,                               -- pulled status "check bill printed" (B17)
  reopen_count       INTEGER NOT NULL DEFAULT 0,
  reopen_mode        TEXT CHECK (reopen_mode IN ('full','corrections')),   -- v0.3 R2 (§3.10); NULL = never reopened
  absorbed_into      TEXT,                                  -- §3.9 merge
  CHECK ((scope = 'seating') = (seating_id IS NOT NULL)),
  CHECK ((scope = 'key') = (table_key IS NOT NULL))
);
CREATE UNIQUE INDEX bills_live_seating ON bills (seating_id) WHERE seating_id IS NOT NULL AND absorbed_into IS NULL AND state <> 'closed' AND reopen_mode IS NOT 'corrections';  -- openBillOf(seating); one open bill per seating, a later one after close (v0.2, OQ-6)
CREATE UNIQUE INDEX bills_live_key     ON bills (table_key) WHERE table_key IS NOT NULL AND state <> 'closed' AND reopen_mode IS NOT 'corrections';  -- openBillOf(key) (v0.3 R2)
CREATE INDEX bills_open                ON bills (state, opened_at) WHERE state <> 'closed' AND absorbed_into IS NULL;  -- open-bills list, X flag

CREATE TABLE bill_orders (              -- written at the bill's last close (B1); the reopen set (v0.2, OQ-6)
  bill_id TEXT NOT NULL, order_id TEXT NOT NULL, PRIMARY KEY (bill_id, order_id)
);
CREATE INDEX bill_orders_order ON bill_orders (order_id);                                  -- line guard (row Q-3)

CREATE TABLE bill_splits (
  bill_id   TEXT NOT NULL, split_no INTEGER NOT NULL CHECK (split_no BETWEEN 1 AND 20),
  plan_json TEXT,                                          -- amount: { share_minor }; equal: { n, k }; items: rows in bill_split_lines (v0.4, H2-15)
  state     TEXT NOT NULL CHECK (state IN ('open','closed')),
  invoice_id TEXT,                                         -- the current sale invoice when closed
  PRIMARY KEY (bill_id, split_no)
);

CREATE TABLE bill_discount_lines (      -- v0.4 (H2-8, owner Q-1): lines on the bill at the first split close; only they carry the frozen discount
  bill_id TEXT NOT NULL, order_item_id TEXT NOT NULL, PRIMARY KEY (bill_id, order_item_id)
);                                        -- filled from the first InvoiceIssued's discount_line_ids (one INSERT … SELECT json_each); cleared by BillReopened (H2-19)

CREATE TABLE bill_split_lines (         -- v0.4 (H2-15): item-split plan entries, foldable from events alone
  bill_id TEXT NOT NULL, split_no INTEGER NOT NULL, order_item_id TEXT NOT NULL, order_id TEXT NOT NULL, units INTEGER NOT NULL,
  PRIMARY KEY (bill_id, split_no, order_item_id)
);
CREATE INDEX bill_split_lines_line  ON bill_split_lines (order_item_id);              -- ItemVoided / ItemRemoved fold
CREATE INDEX bill_split_lines_order ON bill_split_lines (order_id);                   -- SeatingSplit fold

CREATE TABLE bill_payments (
  payment_id        TEXT PRIMARY KEY,
  bill_id           TEXT NOT NULL, split_no INTEGER NOT NULL,
  mode_id           TEXT NOT NULL,
  payment_class     TEXT NOT NULL CHECK (payment_class IN ('cash','digital')),
  direction         TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount_minor      INTEGER NOT NULL CHECK (amount_minor > 0),
  tendered_minor    INTEGER CHECK (tendered_minor IS NULL OR tendered_minor >= amount_minor),   -- change = tendered − amount, on this row's shift (v0.3, H1-2, H1-3)
  has_reference     INTEGER NOT NULL DEFAULT 0 CHECK (has_reference IN (0,1)),   -- v0.3 (H1-20): the text is in payment_references
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
  invoice_ref     TEXT NOT NULL,                           -- '<prefix>' + 'S' | 'C' + number = USIN (v0.6, H6-1)
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
CREATE UNIQUE INDEX invoices_ref ON invoices (invoice_ref);                             -- v0.6 (H6-1): USIN unique across sale and credit
CREATE INDEX invoices_day   ON invoices (business_date, series);                         -- Z / X
CREATE INDEX invoices_bill  ON invoices (bill_id);                                       -- reopen, bill view

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

CREATE TABLE closed_split_units (       -- v0.2 (OQ-6): units each closed split invoiced; deleted for the bill by BillReopened.
                                         -- v0.3 (H1-27): filled by one INSERT … SELECT … FROM json_each(InvoiceIssued.lines);
                                         -- amount / equal splits store the line's live units at that close (the whole line freezes)
  bill_id TEXT NOT NULL, split_no INTEGER NOT NULL, order_item_id TEXT NOT NULL, units INTEGER NOT NULL, share_minor INTEGER NOT NULL,
  PRIMARY KEY (bill_id, split_no, order_item_id)
);
CREATE INDEX closed_split_units_line ON closed_split_units (order_item_id);             -- 05 line guard (row Q-3), 1 statement

CREATE TABLE carried_orders (order_id TEXT NOT NULL, business_date TEXT NOT NULL, reason_code TEXT NOT NULL, PRIMARY KEY (order_id, business_date));  -- v0.6 (H6-10)  -- day-close guard
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
  category_id TEXT, advance_staff_id TEXT, at INTEGER NOT NULL,   -- v0.5.1 (H4-4): paid_to / note columns dropped (texts in bill_texts)
  settled_at INTEGER, settled_shift_id TEXT, spent_minor INTEGER, returned_minor INTEGER
);
CREATE INDEX petty_cash_shift ON petty_cash (shift_id);                                  -- shift view, Z
CREATE INDEX petty_cash_open  ON petty_cash (at) WHERE kind = 'advance' AND settled_at IS NULL;   -- open advances list

-- hub state (not projections) ------------------------------------------------------------------------------
CREATE TABLE invoice_buyers (           -- B19: the only place a buyer ID lives; written by CloseSplit; never synced, logged or returned
  invoice_id TEXT PRIMARY KEY, buyer_name TEXT NOT NULL, buyer_id_number TEXT NOT NULL
);
CREATE TABLE bill_texts (               -- v0.4 (H2-22), v0.5 (H3-5): every free text a 05 command takes; hub-only, never synced
  subject_id TEXT NOT NULL,              -- the id the command mints and its event carries (entry_id, payment_id, note_id)
  field TEXT NOT NULL CHECK (field IN ('note','paid_to')), text TEXT NOT NULL,
  PRIMARY KEY (subject_id, field)
);
CREATE TABLE payment_references (       -- v0.3 (H1-20): hub-only; written by AddPayment; never synced, logged or in an event
  payment_id TEXT PRIMARY KEY, reference TEXT NOT NULL
);
CREATE TABLE fiscal_credentials (       -- v0.2 (OQ-3, B22): written only by SetFiscalToken; never synced, logged, returned or put in an event
  pos_id TEXT PRIMARY KEY, token TEXT NOT NULL, set_at INTEGER NOT NULL, set_by_staff_id TEXT NOT NULL
);
CREATE TABLE bill_print_jobs (          -- B18: job ids per bill document (03c jobs are not events)
  job_id TEXT PRIMARY KEY, bill_id TEXT, doc_kind TEXT NOT NULL CHECK (doc_kind IN ('check','receipt','credit','report','no_sale')),
  ref_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX bill_print_jobs_bill ON bill_print_jobs (bill_id, created_at DESC);        -- bill view print status
```

**Why these shapes (YAGNI):** `bills.sc_removed` + `ChargeApplied` / `ChargeRemoved` is the M-3 fix (a re-applied charge after removal is the observed failure); `invoices_series_number` makes a duplicate number impossible even under a bug; `fiscal_outbox` is the F §3.5 queue — without it a lost or doubled invoice is a legal fault (PRA s.48) and a close would have to wait for the internet (E5 AC1); `invoice_buyers` exists only because the ID number must reach the authority and the receipt but must not enter the immutable, synced event log (G1-9); `shift_takings` keeps the shift-close and Z breakdown by taker at one statement (Q10) instead of a scan of payments; `billing_day` lets the fold key invoices and shifts to the open day without reading the engine state. No soft delete, no version columns: every change is an event.

**Audit refold** ⚠️ Changed in v0.3 (H1-8): `0023_billing.sql` ends with `DELETE FROM projection_checkpoints WHERE projection = 'audit'` so `audit` refolds from seq 0 with 05's maps (00 v1.10 H-2 safe).

**Retention:** none of these rows is pruned in the pilot (money and fiscal records); `invoice_buyers` is kept as long as its invoice, hub-only, never synced ⚠️ Changed in v0.2 (OQ-8). `fiscal_credentials` is in the hub database, so it is in the encrypted USB backup (00 `encryptFile`) and nowhere else. `bill_print_jobs` rows whose 03c job was pruned are dropped by the same 03c retention call (7 days).

---

## §6. Commands, events and queries

All commands: `POST /commands/<kebab-name>`, staff session (`sessionKind: 'device'`) unless stated; **not queueable** (G0-1: money, PIN-capable); scope checks last (C8); idempotent by `command_id` (D32; a retransmit returns the stored response); statement counts exclude 00's fixed envelope. Every money result carries the recomputed totals so the screen never computes its own (§8). `bill_ref` in payloads = `{ bill_id }` or `{ seating_id }` or `{ order_id }` (exactly one; an `order_id` resolves to its seating or its `table_key`, ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2); a reference to a bill not yet created creates it, B1).

**Common bill-open step ("ensure bill"),** used by every bill command: resolve `bill_ref` → `openBillOf` (1) → none: read the seating / order (`readOrder` / `seatings`, 1), refuse a seating that is not open (`409 TABLE_NOT_OPEN`) or an order that is cancelled (`409 BILL_NOT_OPEN { state: 'cancelled' }`), a takeaway / parking order not yet sent cannot exist (B16) → append `BillOpened` + `ChargeApplied { source: 'rule', rate_bp }` (`rate_bp` = `service_charge_bp[order_type]`; 0 → no `ChargeApplied`).

### Batch 1 — the bill (STOP for owner review after this batch)

#### 6.1 `GET /queries/bill?seating_id|order_id|bill_id`

- **Permission:** `take-payment` (its scope: `own_tables` → the caller holds the table / placed the order; `my_floors` → the table's floor) **or** `take-order` (read-only view for the order taker's check bill; ⚠️ Changed in v0.4 (H2-20): a payment's `reference` text only to `take-payment` holders whose scope covers the bill, everyone else gets `has_reference`). `403 PERMISSION_DENIED { reason: 'outside_scope' }` last.
- **Result:** `{ bill_id | null, state, scope, order_type, identifier, orders: [order_id], lines: [{ order_item_id, order_id, name, options, units, base_minor, tax_class_id, tags: ['comp' | 'pending_void' | 'weight_needed'] }], service_charge: { rate_bp, removed }, discount | null, splits: [{ split_no, state, plan, payments: [{ payment_id, mode_id, mode_name, direction, amount_minor, tendered_minor, change_minor, reference (from the hub-only `payment_references`, v0.3 H1-20), taken_by_name }], totals: { cash: Totals, digital: Totals, as_paid: Totals }, balance_minor, invoice: { invoice_ref, fiscal_number | null, fiscal_state } | null }], totals_default: Totals, buyer: { required, threshold_minor, waived }, blocks: [{ reason, ids }], open_requests: [{ kind, alert_id }], prints: [{ job_id, doc_kind, state, printer_name, last_error }], check_printed_at, as_of_seq }` with `Totals = { subtotal_minor, discount_minor, service_charge_minor, taxes: [{ tax_class_id, name, payment_class, rate_bp, base_minor, tax_minor }], rounding_minor, total_minor }`. Never a buyer ID number. `blocks` lists every §3.3 rule that would refuse a close now.
- **Statements:** ≤ 9, fixed: `openBillOf` (1), orders of the bill (`seating_orders` or `bill_orders`, 1), `orderLines` (1), `pendingVoids` (1), splits + payments (1 join), invoices of the bill (1), `alerts.listOpen` for the bill's 05 kinds (1), `bill_print_jobs` + `documentJobsStatus` (2). Config and directory in memory. Pure `computeBill`.

#### 6.2 `GET /queries/open-bills?floor_id?`

- **Permission:** `take-payment` (rows filtered by its scope).
- **Result:** `{ bills: [{ bill_id | null, seating_id | null, order_id | null, identifier, order_type, state, total_default_minor, paid_minor, check_printed_at, opened_at, open_minutes, flagged: open_minutes > open_bill_flag_minutes, partly_paid, has_open_request }], as_of_seq }` — ⚠️ Changed in v0.4 (H2-10, H2-25): every non-closed `bills` row (not absorbed) whatever its seating's state, plus every open seating with an order that is neither billed nor cancelled ⚠️ Changed in v0.3 (H1-21) and every `bill_key` (takeaway / parking) with an unbilled, uncancelled order, one row per key, whether or not a bill row exists yet (projected rows have `bill_id: null`); ordered by `check_printed_at` desc nulls last, then `opened_at`. Bounded by the branch's open tables and orders (≤ 300), returned whole.
- **Statements:** 3 (open seatings ⋈ seating_orders ⋈ orders ⋈ per-class line sums in one aggregate; unbilled non-table orders by `bill_key` with per-class sums; bills ⋈ payments sums). ⚠️ Changed in v0.6 (H6-18): the per-class sums feed the pure `computeBill` in memory (half-up tax per class, capped discount spread), so the list total equals the bill view's except pending voids, which the list does not subtract (shown as "before pending voids"). ⚠️ Changed in v0.6 (H6-9): `check_printed_at` = max(`bills.check_printed_at`, 02a `seatings.bill_requested_at`).

#### 6.3 `PrintCheckBill` — `{ bill_ref, printer_id? }`

- **Permission** ⚠️ Changed in v0.6 (H6-7): registry `take-order` (every Cashier and Order taker holds it by default), scope covering the table / order.
- **Script:** Zod → ensure bill → bill not CLOSED (`409 BILL_NOT_OPEN`) → lines + pending voids (2) → `computeBill` at the default class → printer: payload `printer_id` (must be active, `404 PRINTER_NOT_FOUND`) else `billPrinterFor` (1) → `buildCheckBillDoc` (banner `PROVISIONAL - NOT A TAX INVOICE`, no number, no QR, "total if paid in cash"; plus one line per digital rate when it differs) → `printDocument` (2) + `bill_print_jobs` (1) → append `CheckBillPrinted { bill_id, total_default_minor, line_count, printer_id | null, job_id | null, source: 'manual' }`. No printer → event with nulls, result `{ printed: false }`.
- **Result:** `{ bill_id, job_id | null, printer_name | null, totals_default }`. **Statements:** ≤ 9. **Audit:** `check_bill_printed`.

#### 6.4 Fold `BillRequested` → check bill (live only, B17)

05 registers a live-only reaction on 02a's `BillRequested` (03c's job-fold pattern; skipped on rebuild): ensure-bill drafts are **not** possible in a fold, so the reaction prints ⚠️ Changed in v0.6 (H6-9) **the `bills` row's bill when one exists** (its `sc_bp` / `sc_removed`, discount, splits; a removed service charge is never printed back, M-3), else the **projected** bill (same `computeBill`, reads `orderLines` + `pendingVoids` in the transaction after `orders` and `tables` folded) at `billPrinterFor({ zone_id, floor_id })` of the seating's primary table and records the job in `bill_print_jobs` (`bill_id` = the bill if it exists, else NULL with `ref_id = seating_id`). The audit row is 02a's `BillRequested` mapped by 05 as `bill_requested` (§6.30). No 01d notice. A replayed queued `RequestBill` prints at replay time. **Statements:** ≤ 6 per `BillRequested`.

#### 6.5 `SetSplits` — `{ bill_ref, mode: 'items' | 'amount' | 'equal' | 'none', splits?: [{ split_no, lines?: [{ order_item_id, units }], share_minor? }], n? }`

- **Permission:** `take-payment` (scope as §6.1).
- **Script:** Zod (`splits` 2–20, keyed by `split_no`; `lines` keyed by `order_item_id` per split; `n` 2–20 for `equal`) → ensure bill → state OPEN or PARTLY_PAID (closed bill → `409 BILL_NOT_OPEN`) → lines + closed splits (2) → validate per §3.8 over the **open remainder** ⚠️ Changed in v0.2 (OQ-6): closed split numbers are kept and may not appear (`422 BILL_SPLIT_INVALID { reason: 'split_closed' }`); item plan: every live unit not in a closed split exactly once (`reason: 'units_missing' | 'units_exceed', order_item_id`), deal whole and option child with its parent (`'deal_whole' | 'option_with_parent'`); amount plan: Σ shares = the open remainder's default-class total (`'shares_sum', expected_minor`); a split with live payments must keep its number (`409 BILL_HAS_PAYMENTS { split_nos }`); `none` = the open remainder as one split (only when at most one open split has payments) → append `BillSplitsSet { bill_id, mode, splits }`.
- **Result:** the bill view's `splits` (recomputed). **Statements:** ≤ 5. **Audit:** `splits_set` (counts only).

#### 6.6 `ApplyDiscount` — `{ bill_ref, kind: 'amount' | 'percent', value: int, reason_code, note? }` (approvable) ⚠️ Changed in v0.2 (OQ-4: no `split_no`)

- **Permission:** `apply-discount` (`branch`), `approvable: true`.
- **Script:** Zod (`amount` ≥ 1 paisa; `percent` in basis points 1–10 000; `reason_code` ∈ the branch's discount reasons, `note` required for `other`) → ensure bill → state PARTLY_PAID → `409 BILL_PARTLY_PAID { bill_id }` (the discount must be set before the first split closes, OQ-4) → state not OPEN → `409 BILL_NOT_OPEN` ⚠️ Changed in v0.3 (H1-12: this order, so `BILL_PARTLY_PAID` is reachable) → no open `discount` request on the bill (`409 DISCOUNT_PENDING { alert_id }`) → lines (2) → amount ≤ the whole bill's `S` and ≤ `max_discount_pct` of it (`422 DISCOUNT_TOO_LARGE { max_minor }`) → grant `allowed` → append `DiscountApplied { bill_id, kind, value, amount_minor (at apply), reason_code, has_note, note_id (⚠️ Changed in v0.5 (H3-5): the note in `bill_texts`), requester_staff_id, approver_staff_id: null, alert_id: null, replaces }` → grant `requires_approval` → `raiseMany` kind `discount` (`details { amount, reason, identifier }`, ⚠️ Changed in v0.4 (H2-6)), result `{ pending: { alert_id } }`. The `discount` kind's `apply` re-checks in the same order (PARTLY_PAID, then not OPEN), else throws (the answer is refused).
- **Result:** `{ applied: Totals } | { pending }`. **Statements:** ≤ 6 (+ 01d's raise bound). **Audit:** `discount_applied` / `discount_requested`.

#### 6.7 `RemoveDiscount` — `{ bill_id, reason_code, note? }`

- **Permission:** `apply-discount` (`allowed` or `requires_approval` grant both may remove; removal raises the price, never lowers it). Script: state PARTLY_PAID → `409 BILL_PARTLY_PAID` ⚠️ Changed in v0.2 (OQ-4) → state not OPEN → `409 BILL_NOT_OPEN` ⚠️ Changed in v0.3 (H1-12) → discount present ( no discount → `200 { changed: false }`) → `DiscountRemoved`. **Statements:** 2. **Audit:** `discount_removed`.

#### 6.8 `RemoveServiceCharge` — `{ bill_ref, reason_code, note? }` (approvable) and `ApplyServiceCharge` — `{ bill_ref, note? }`

- **Remove:** `remove-service-charge`, approvable. Ensure bill → OPEN / PARTLY_PAID → already removed → `200 { changed: false }` → `allowed` → `ChargeRemoved { bill_id, charge: 'service', reason_code, has_note, note_id, requester_staff_id, approver_staff_id, alert_id }`; `requires_approval` → kind `remove_service_charge`. **Never** re-applied by any read, print, split, merge or reopen (B8; tests 18, 19).
- **Apply (re-add):** `remove-service-charge` `allowed` (the same right decides both ways) → `ChargeApplied { source: 'manual', rate_bp: service_charge_bp[order_type] }`; already applied → `{ changed: false }`. **Statements:** ≤ 3 each. **Audit:** `service_charge_removed` / `service_charge_applied`.

#### 6.9 `AddPayment` — `{ bill_ref, split_no, mode_id, direction: 'in' | 'out', amount_minor, tendered_minor?, reference? }`

- **Permission:** `take-payment` (scope as §6.1).
- **Script:** Zod (`amount_minor` 1…1 000 000 000; `reference` 1–60, never echoed in an error; `tendered_minor` only on a cash `in`, else `400 VALIDATION_FAILED { path: 'payload.tendered_minor' }`, ⚠️ Changed in v0.4 (H2-28)) → ensure bill → split open (`409 BILL_NOT_OPEN`) → mode active in settings (`404 PAYMENT_MODE_NOT_FOUND`) → reference rule (`422 PAYMENT_REFERENCE_REQUIRED`) → money shift (B11; state `open` only, a COUNTED shift → `409 SHIFT_NOT_OPEN { reason: 'shift_counted' }`, ⚠️ Changed in v0.6 (H6-3)): the device's open drawer shift, else the caller's own open shift (an order taker's shift has no drawer, Q9) → none → `409 SHIFT_NOT_OPEN { reason: 'no_shift' }` → lines, pending voids, payments of the split (3) → recompute the split with this payment included (§3.5, §3.6) → an `in` `amount_minor` above the balance (cash too) → `422 PAYMENT_EXCEEDS_BALANCE { balance_minor }` ⚠️ Changed in v0.3 (H1-2); `out` only when the balance is negative and `amount ≤ −balance` (`422 PAYMENT_EXCEEDS_BALANCE`) → append `PaymentAdded { payment_id (ULID), bill_id, split_no, mode_id, payment_class, direction, amount_minor, tendered_minor, change_minor (= tendered − amount, cash only), has_reference, taken_by_staff_id: caller, shift_id }` + `payment_references` row when a reference was given (1) ⚠️ Changed in v0.3 (H1-20).
- **Result:** the split's `totals.as_paid`, `balance_minor`, `change_due_minor` (if cash tendered above), so the screen shows the recomputed tax at once (M-7). **Statements:** ≤ 7. **Audit:** `payment_added` (mode, amount, shift; no names).

#### 6.10 `RemovePayment` — `{ payment_id, reason_code: 'wrong_mode' | 'wrong_amount' | 'customer_changed' | 'other', note? }`

- **Permission:** `take-payment`; removing a payment taken by **someone else** also needs `close-shift-for-others` (`403 PERMISSION_DENIED { reason: 'not_own_payment' }`). Payment exists (`404 PAYMENT_NOT_FOUND`), not removed, its split open (`409 BILL_NOT_OPEN`) → its shift OPEN, else `409 SHIFT_NOT_OPEN { reason: 'payment_shift_closed' }` ⚠️ Changed in v0.3 (H1-9, owner R4): a payment on a COUNTED / CLOSED shift (a reopened earlier bill) is never removed; money back is an `AddPayment { direction: 'out' }` on the actor's own money shift today → `PaymentRemoved { payment_id, bill_id, split_no, reason_code, has_note }`. **Statements:** 2. **Audit:** `payment_removed`.

#### 6.11 `WaiveBuyerId` — `{ bill_id, note? }` (approvable)

- **Permission:** `close-without-buyer-id`, approvable. Bill OPEN / PARTLY_PAID; the whole bill's net above the threshold (else `200 { changed: false, reason: 'not_required' }`); already waived → `{ changed: false }` → `allowed` → `BuyerIdWaived { bill_id, has_note, note_id, requester_staff_id, approver_staff_id: null, alert_id: null }` (⚠️ Changed in v0.5.1 (H4-4)); `requires_approval` → kind `close_without_buyer_id`. Holds for every later split of the bill and survives a reopen (the customer is the same). **Statements:** ≤ 4. **Audit:** `buyer_id_waived`.

#### 6.12 `CloseSplit` — `{ bill_ref, split_no, expected_total_minor, buyer?: { name: string 1–60, id_number: string } }` (⚠️ Changed in v0.6 (H6-11): `bill_ref` with ensure bill, so a zero-total bill closes with no payment)

- **Permission:** `take-payment` (scope as §6.1). Not approvable (the money-risky parts are approved before: discount, waiver).
- **Validation:** `id_number` = CNIC 13 digits (dashes allowed, stored without) or NTN 7–9 alphanumerics (`400 VALIDATION_FAILED { path: 'payload.buyer.id_number' }`, message without the value). The handler never logs the payload.
- **Script:**
  1. Zod → `BEGIN IMMEDIATE` (00) → bill + split + payments + invoices of the bill (2).
  2. Orders of the bill (1) → `orderLines` (1) → `pendingVoids` (1) → `alerts.listOpen({ kind: 'discount', subject: bill })` and 02b `comp` requests of the orders (2) → dine-in: the seating's state and other open bills (1, for the `BillClosed` rule) ⚠️ Changed in v0.4 (H2-28).
  3. §3.3 rules 1–9 in order (first failure throws; nothing written).
  4. `computeSplit` with the split's payments → totals, tax rows, rounding; change = Σ the split's cash payments' `change_minor` (each already on its own shift) ⚠️ Changed in v0.3 (H1-2, H1-3).
  5. Number: `SELECT COALESCE(MAX(number), 0) + 1 FROM invoices WHERE series = 'sale'` (1); `invoice_ref = invoice_prefix + 'S' + zero-padded number` (⚠️ Changed in v0.6 (H6-1); a credit uses `'C'`); unique over both series (`invoices_ref`).
  6. Drafts: `InvoiceIssued { invoice_id, series: 'sale', number, invoice_ref, bill_id, split_no, business_date, issued_at, order_type, lines: [{ order_item_id, name, units, unit_price_minor, base_minor, discount_minor, tax_class_id, rate_bp, tax_minor }] (⚠️ Changed in v0.6 (H6-4): per-line tax = the class tax spread with `allocateCappedMinor`, Σ = the invoice's tax), subtotal_minor, discount_minor, service_charge_minor, taxes: [...], rounding_minor, total_minor, payment_class, mixed_rule, payment_ids, change_minor, discount_line_ids (string[] on the bill's first close, else `null`, ⚠️ Changed in v0.5 (H3-8)), fiscal: { authority, pos_id, required }, has_buyer_id, buyer_id_refused, closed_by }`; the invoice's `lines` carry each line's invoiced units and share, folded into `closed_split_units` (B15) ⚠️ Changed in v0.2 (OQ-6); the first close freezes the discount amount and lists `discount_line_ids` (the bill's lines at that moment, folded into `bill_discount_lines`, Q-1) (B7); when this is the **last open split**: 02b `OrdersBilled { order_ids, bill_id }` (stream `order`, first order) and, for dine-in when the seating is not `CLOSED` and holds no other open bill (⚠️ Changed in v0.3 (H1-10 + S-9, owner R2): was "first full close only"), 02a `BillClosed { seating_id }` (stream `table`, primary table); `AlertClosed` drafts (`obsolete`, note `bill_closed`) for open `comp` **and `remove_comp`** (⚠️ Changed in v0.6 (H6-2)) requests on the **units this split invoices** at every split close ⚠️ Changed in v0.3 (H1-23), and at the last close for the remaining `comp` requests on the bill's lines (02b To 05) and any open 05 request on the bill.
  7. Append (00) → projections fold (billing: invoice, outbox row; shifts: takings, change; 02b `billed_at`; 02a NEEDS_CLEANING) → `invoice_buyers` insert when `buyer` is present (1) → receipt: `billPrinterFor({ device_id })` (1), `buildReceiptDoc` (fiscal block = "FISCAL NUMBER PENDING" when `required`, B21; buyer name and the **last 4** of the ID number on paper; drawer block when a cash payment exists) → `printDocument` (2) + `bill_print_jobs` (1).
  8. COMMIT → respond → WS (`InvoiceIssued` to the bill's audience; `BillClosed` per 02a).
- **Result:** `{ invoice_id, invoice_ref, total_minor, change_minor, bill_state, receipt: { job_id | null, printer_name | null }, fiscal_state: 'pending' | 'not_required' }`.
- **Statements:** ≤ 18, fixed (no per-line or per-payment statement). Not an engine command (no `EngineState` change) — but it appends events in a transaction with folds: COMMIT-failure test asserts no outbox row, no print job, no buyer row (§10 #36).
- **Audit:** `invoice_issued` (number, total, class, has_buyer_id only).

#### 6.13 `ReopenBill` — `{ bill_id, reason_code ∈ BILL_REOPEN_REASONS, note? }` (approvable)

- **Permission:** `reopen-bill` (`branch`), approvable.
- **Step order** ⚠️ Changed in v0.5.1 (H4-1): (1) read the bill, its invoices and **its order set** (`bill_orders`, or for PARTLY_PAID the bill's current orders); (2) read the seating / key state and the other bills and unbilled orders on it; (3) decide the mode (§3.10) with the set from (1) excluded; (4) build the drafts, `BillReopened { order_ids }` first, so its fold fills `bill_orders` before any later read in the same transaction.
- **Script:** Zod → bill CLOSED or PARTLY_PAID (`409 BILL_NOT_OPEN { state }`) → an open `reopen_bill` request on the bill (`alerts.listOpen`, 1) → `409 BILL_REOPEN_PENDING { alert_id }` → invoices and the bill's order set (2) → the seating's state (dine-in), or the `bill_key`'s other bills (takeaway / parking), and the unbilled orders outside the set (1) ⚠️ Changed in v0.5.2 (H5-4) → mode per §3.10 ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) → `allowed` → drafts per §3.10 (+ 02a `SeatingReopened { seating_id, bill_id }` in full-edit mode): `BillReopened { bill_id, order_ids (the bill's current order set; folded into `bill_orders` with `INSERT OR IGNORE`, ⚠️ Changed in v0.5 (H3-2)), reason_code, has_note, note_id, requester_staff_id, approver_staff_id: null, alert_id: null }`, one `InvoiceCredited { invoice_id (new), alert_id (null on the direct path, ⚠️ Changed in v0.4 (H2-1)), series: 'credit', number (MAX+1 of credit, 1), invoice_ref (`prefix + 'C' + number`, ⚠️ Changed in v0.6 (H6-1)), ref_invoice_id, ref_invoice_ref, bill_id, split_no, business_date (today), …the original's amounts, fiscal }` per current sale invoice, `OrdersUnbilled` when CLOSED → `requires_approval` → kind `reopen_bill` (values `{ bill_id, invoice_ids, note_id, has_note }` (⚠️ Changed in v0.5.1 (H4-4)) — the current sale invoices at raise; `apply` throws, so the answer is refused, when they differ at answer time, ⚠️ Changed in v0.4 (H2-17); every `apply` draft carries the request's `alert_id`, H2-1; `apply` builds the same drafts read-only, numbers from the answer transaction's read view). On both paths the credit note is printed by the live-only fold of `InvoiceCredited` (§3.16), never by the command, so it prints once.
- **Result:** `{ reopened: { mode: 'full' | 'corrections', credits: [{ invoice_ref, total_minor }] } } | { pending: { alert_id } }` ⚠️ Changed in v0.4 (H2-26). **Statements:** ≤ 8. **Audit:** `bill_reopened` (with the mode), `invoice_credited`.

#### 6.14 `RemoveComp` — `{ order_item_id, units?, reason_code ∈ COMP_REMOVE_REASONS, note? }` (approvable)

- **Permission:** `remove-comp` (`branch`), approvable.
- **Script:** `readOrder` (1) → order not billed (`409 ORDER_BILLED`), line comped (`409 LINE_NOT_COMPED { order_item_id }`), `units ≤ comped_units` (`400`) → line guard list (02b, 1: a void pending on it → `409 VOID_PENDING`; units in a closed split → `409 LINE_IN_CLOSED_SPLIT`) ⚠️ Changed in v0.2 (OQ-6) → `planCompRemoval` (02b) → `allowed` → `LineCompRemoved { …, approver_staff_id: null, alert_id: null }` (02b event, 05 writes it); `requires_approval` → kind `remove_comp` (dedupe `remove_comp:<order_item_id>`).
- **Result:** `{ removed: { units, comp_minor } } | { pending }`. **Statements:** ≤ 4. **Audit:** `comp_removed`.

### Batch 2 — shifts, petty cash, drawer

#### 6.15 `OpenShift` — `{ float_minor, as_drawer: boolean }`

- **Permission:** `manage-own-shift`.
- **Script:** Zod (`float_minor` 0…100 000 000) → business day open (`409 BUSINESS_DAY_NOT_OPEN`, 01a's code) → caller has no open shift (`409 SHIFT_ALREADY_OPEN { shift_id }`) → `as_drawer`: the device is a `cashier_kiosk` or a tablet with a printer route (else `422 DRAWER_DEVICE_INVALID { device_id }`), and no open shift holds this device (`409 DRAWER_IN_USE { shift_id, staff_name }`) → `ShiftOpened { shift_id, staff_id, drawer_device_id | null, float_minor, business_date }` → drawer kick (`printDocument` with `{ drawer: true }` on the device route) when `float_minor > 0`.
- **Result:** `{ shift_id, opened_at }`. **Statements:** ≤ 5. **Audit:** `shift_opened`.

#### 6.16 `GET /queries/shift?shift_id?`

- **Permission** ⚠️ Changed in v0.6 (H6-7): registry `manage-own-shift`; another person's shift additionally needs `close-shift-for-others`, checked in the handler with `ctx.directory.resolve` (`403 PERMISSION_DENIED { permission: 'close-shift-for-others' }`).
- **Result:** `{ shift_id, staff_name, state, is_drawer, opened_at, float_minor, takings: [{ mode_id, mode_name, payment_class, in_minor, out_minor, change_minor, by: [{ taken_by_name, in_minor }] }], petty: [{ entry_id, kind, amount_minor, category_name, paid_to (read from the hub-only `bill_texts`, never from an event, ⚠️ Changed in v0.5 (H3-5)), advance_staff_name, settled }], open_advances_minor, handovers: [...], counted_minor | null, expected_minor | null, variance_minor | null }`. **Blind rule (B23):** `expected_minor` and `variance_minor` are `null` unless `counted_at` is set (a handover row shows the expected of its own count only); card / online takings **are** shown (they are checked against the terminal, story 7 AC5); the cash line shows only the count of cash payments, never their sum, before the count. **Statements:** 4.

#### 6.17 `CountShift` — `{ shift_id, counted_minor }`

- **Permission** ⚠️ Changed in v0.6 (H6-7): registry `manage-own-shift`; another person's shift additionally needs `close-shift-for-others`, checked in the handler with `ctx.directory.resolve` (`403 PERMISSION_DENIED { permission: 'close-shift-for-others' }`).
- **Script:** shift OPEN (`409 SHIFT_NOT_OPEN { reason: 'not_open' }`; a COUNTED shift after a rejected variance accepts a recount) → `ShiftCounted { shift_id, counted_minor, expected_minor, variance_minor, by_staff_id }` (expected from the running fold).
- **Result:** `{ expected_minor, variance_minor, over_threshold }` — the first time the server reveals expected. **Statements:** 2. **Audit:** `shift_counted`.

#### 6.18 `CloseShift` — `{ shift_id, skip_count?: true, note? }`

- **Permission** ⚠️ Changed in v0.6 (H6-7): registry `manage-own-shift`; another person's shift additionally `close-shift-for-others` (handler); `skip_count` → also `skip-blind-count` (`403 PERMISSION_DENIED { reason: 'skip_not_granted' }`).
- **Script:** shift exists (`404 SHIFT_NOT_FOUND`), not closed → not counted and no `skip_count` → `409 SHIFT_NOT_COUNTED` → `skip_count` → `ShiftCountSkipped` + `ShiftClosed` → `|variance| ≤ variance_threshold_minor` → `ShiftClosed { shift_id, closed_by, has_note, note_id (⚠️ Changed in v0.5.1 (H4-4)), alert_id: null, approver_staff_id: null }` → else an open `shift_variance` request for the shift → `409 SHIFT_VARIANCE_PENDING { alert_id }` (⚠️ Changed in v0.5.2 (H5-5): the repeat writes nothing, its `note` is ignored, the first note stays) → else `raiseMany` kind `shift_variance` (`details { amount: variance_minor }`, ⚠️ Changed in v0.4 (H2-6); approvers §3.14) → `{ pending }`. Approve → `apply` returns `ShiftClosed { alert_id, approver_staff_id }`. Reject → `apply` returns `[]`; the shift stays COUNTED and accepts a recount (§6.17) and a new `CloseShift`. Open advances are listed in the result, never blocking.
- **Result:** `{ closed: { shift_id } } | { pending }`. **Statements:** ≤ 5. **Audit:** `shift_closed` / `shift_count_skipped`.

#### 6.19 `HandoverCount` — `{ shift_id, counted_minor }`

- **Permission** ⚠️ Changed in v0.6 (H6-7): registry `manage-own-shift`; another person's drawer shift additionally `close-shift-for-others` (handler). Drawer shift OPEN → `HandoverCounted { shift_id, counted_minor, expected_minor, variance_minor, by_staff_id }`; the shift stays OPEN; the result reveals expected (it is a count). **Statements:** 2. **Audit:** `handover_counted`.

#### 6.20 `RecordPettyCash` — `{ kind, amount_minor, category_id, paid_to?, advance_staff_id?, note? }` (approvable) and `SettlePettyAdvance` — `{ entry_id, spent_minor, returned_minor, note? }`

- **Record:** `record-petty-cash`, approvable. Caller's money shift (B11; cash; state `open`, COUNTED → `shift_counted`, ⚠️ Changed in v0.6 (H6-3)) → else `409 SHIFT_NOT_OPEN` → category active (`422 CONFIG_REFERENCE_INVALID { field: 'category_id', reason: 'not_found' }`) → advance needs `advance_staff_id` in the directory (`422 … 'advance_staff_id'`) (⚠️ Changed in v0.6 (H6-15): no check against the shift's expected cash — a refusal would let a cashier binary-search it; an overdraw shows as variance at the count) → grant `allowed` and `amount ≤ petty_cash_limit_minor` → `PettyCashAdvanced` / `PettyCashOut` / `PettyCashIn { entry_id, shift_id, amount_minor, category_id, has_paid_to, advance_staff_id, has_note, requester_staff_id, approver_staff_id: null, alert_id: null }` + drawer kick → else kind `petty_cash` (values carry the entry **without text** — `entry_id`, amounts, ids, `has_note` / `has_paid_to`; the texts go to `bill_texts` under `entry_id` at raise, ⚠️ Changed in v0.5 (H3-5); `apply` returns the event; the drawer kick on approval is the requester's next `OpenCashDrawer`, not automatic).
- **Settle:** `record-petty-cash` `allowed`. Advance open (`404 PETTY_CASH_NOT_FOUND`, `409 PETTY_ADVANCE_SETTLED`), `spent + returned = amount` (`422 PETTY_SETTLE_MISMATCH { amount_minor }`) → caller's money shift (the returned cash lands there) → `PettyCashSettled { entry_id, shift_id, spent_minor, returned_minor, has_note, note_id }` (⚠️ Changed in v0.5.1 (H4-4): its own `note_id` ULID, so it never collides with the advance's `(entry_id, 'note')` row).
- **Statements:** ≤ 4 each. **Audit:** `petty_cash` (kind, amount, category; `paid_to` and names never in the audit detail).

#### 6.21 `OpenCashDrawer` — `{ reason_code: 'change_for_customer' | 'check_cash' | 'other', note? }`

- **Permission:** `open-cash-drawer`. The device is a drawer of a shift in state `open` (`409 SHIFT_NOT_OPEN { reason: 'no_drawer_shift' }`; a COUNTED drawer → `reason: 'shift_counted'`, ⚠️ Changed in v0.6 (H6-3)) → `DrawerOpened { shift_id, device_id, reason_code, has_note, note_id }` → `printDocument` (`{ drawer: true }`). **Statements:** 4. **Audit:** `drawer_opened`.

### Batch 3 — day close, reports, printing, fiscal

#### 6.22 `PrintBillDocument` — `{ doc: 'receipt' | 'credit_note', ref_id, printer_id? }` and `PrintReport` — `{ doc: 'x_report' | 'z_report', ref_id?, printer_id? }` ⚠️ Changed in v0.6 (H6-7: split)

- **Permission:** `PrintBillDocument` → `take-payment`; `PrintReport` → `view-reports` (one registry permission each, ⚠️ Changed in v0.6 (H6-7)).
- **Script:** the invoice (`404 INVOICE_NOT_FOUND`) / the Z (`404 Z_REPORT_NOT_FOUND`) / the open day's X from the projections (≤ 6) → builder (a receipt reprint is marked `REPRINT`, shows the fiscal number + QR once `FiscalNumberAssigned` exists, else "FISCAL NUMBER PENDING"; buyer from `invoice_buyers`, last 4 only) → printer (payload, else route) → `printDocument` + `bill_print_jobs` → no event (a reprint changes no money; the audit of reprints is 03c's `document` job list). **Statements:** ≤ 9.

#### 6.23 `RetargetBillPrint` — `{ job_id, printer_id }`

- **Permission:** `take-order` (⚠️ Changed in v0.6 (H6-7)). `bill_print_jobs` row exists (`404 PRINT_JOB_NOT_FOUND`) → `retargetDocumentJob` (03c row P-2; `409 PRINT_JOB_NOT_PENDING` when printed / being sent / cancelled; `404 PRINTER_NOT_FOUND`). No event. **Statements:** 3. Result: the job's new status.

#### 6.24 `CarryOverOrders` — `{ order_ids: string[1..40], reason_code ∈ CARRY_OVER_REASONS, note? }`

- ⚠️ Changed in v0.3 (H1-9, owner R4): a carried bill **may** already have payments (an open split or a partly paid bill); the close is allowed and the X / Z show them as **carried forward** (and the next day's as **brought forward**, §6.26, ⚠️ Changed in v0.4 H2-3).
- **Permission:** `close-business-day`. Each order unbilled and not cancelled (`409 ORDER_BILLED` / `400` per index) → `OrdersCarriedOver { order_ids, business_date, reason_code, has_note, note_id }` (`hub` stream). They survive this day's close only. **Statements:** 2. **Audit:** `orders_carried_over`.

#### 6.25 Day close — 01a `CloseBusinessDay` with 05's guard and appender (rows A-3, A-4, A-5)

- **05 guard** (after 04's): open shifts of any day (1, `shifts_open_staff`) → `409 DAY_CLOSE_BLOCKED { reason: 'shift_open', shifts, count }`; unbilled, uncancelled, not carried orders (1) → `{ reason: 'unbilled_orders', orders, count }` (≤ 40 listed, `count` via `COUNT(*) OVER ()`).
- **05 appender:** open 05 requests + 02b `comp` requests (`alerts.listOpen`, 1) → `AlertClosed { outcome: 'obsolete', note: 'day_closed' }` drafts (01d `close` helper); Z number = MAX + 1 (1); `buildReport` over the day (§6.26, ≤ 6) → `ZReportIssued { business_date, z_no, report }` (`hub` stream). The live-only fold prints it at the `report` route.
- **Bound:** 05 adds ≤ 10 statements to the close. **Engine:** the command already has its COMMIT-failure test; 05 adds one asserting no `ZReportIssued`, no `z_reports` row and no print job after a failed COMMIT (§10 #63).

#### 6.26 `GET /queries/x-report` and `GET /queries/z-reports?business_date?|cursor&limit`

- **Permission:** `view-reports`.
- **Report content (B26, `buildReport`):** sales: sale invoices count, gross (Σ subtotal), discounts (count, value, by reason, requester / approver / method from the audit fold), service charge, net, **tax by class and payment class** with rate, rounding, total; credits (count, value, by reason) and **net = sales − credits**; payments by mode (in, out, change); comps (value), voided comps (`comp_voided_minor`, 02b O21), comp removals; voids by disposition (wastage / staff meal / moved / null, count and value, 04 G-8, from `ItemVoided`); reopens (count, value, requester, approver); petty cash by category and kind, open advances (who, amount, age); per shift: staff, float, expected, counted, variance, skipped flag, takings by taker (Q10); fiscal: invoices pending / acked / rejected / not required; bills count, average bill, open bills (X only, with "open too long" flags, M-8); carried-over orders (Z of the day they are carried into lists them as "carried in"); **"brought forward"** and **"carried forward"** (payments on open bills) lines by mode and shift ⚠️ Changed in v0.3 (H1-9, owner R4), ⚠️ Changed in v0.4 (H2-3). **X** = the same over the open day, the shifts' expected cash **hidden** for shifts not counted (B23).
- **Statements:** X ≤ 8 fixed (invoices + taxes of the day, payments by mode, shifts + takings, petty, audit rows for discounts / reopens / voids of the day, outbox counts, open bills); Z list: 1 (cursor, F §6.3).
- **Invariant (property test)** ⚠️ Changed in v0.4 (H2-3), ⚠️ Changed in v0.5 (H3-3): **brought forward** = live payments on **splits that are not closed** at the day's open (incl. a reopened bill's splits and a carried bill's open splits); **carried forward** = the same at the close. Payments of a closed split are in its invoice and never counted again. **Σ the day's takings (`in` − `out`, all modes) = Z net (Σ sale − Σ credit totals of the day) + carried forward − brought forward.** The Z prints both lines by mode. A payment never changes after its shift is counted.

#### 6.27 `GET /queries/fiscal-status`

- **Permission:** `take-payment` or `view-reports`.
- **Result:** `{ authority, environment, adapter_health: 'ok' | 'failing' | 'unknown', last_success_at, pending_count, oldest_pending_age_ms, rejected_count, catch_up_window_ms, stuck: boolean, token_missing_pos_ids: [pos_id], tokens: [{ pos_id, set_at }] }` — never a token, never a buyer (⚠️ Changed in v0.2, OQ-3: `tokens` shows only "set on <date>"). **Statements:** 3.

#### 6.28 `RetryFiscalNow` — `{}`

- **Permission:** `close-business-day`. Sets `next_try_at = now` for `pending` rows (plain statement, not an event; 1) and wakes the worker; a `rejected` row is **not** resent here (it needs the fix the rejection names; a developer task). Result `{ pending_count }`.

#### 6.28a `SetFiscalToken` — `POST /admin/commands/set-fiscal-token`, `{ pos_id, token }` ⚠️ Changed in v0.2 (OQ-3, new)

- **Permission:** `manage-fiscal-settings` (allowed-only; **Owner only** by default, row B-1 / B-2), `sessionKind: 'admin'` (hub admin page `/admin/fiscal/`, row H-2). Not queueable.
- **Script:** Zod (`pos_id` 1–40 and listed in the branch fiscal settings' `pos_ids`, else `422 CONFIG_REFERENCE_INVALID { field: 'pos_id', reason: 'not_found' }`; `token` 1–512 printable, the Zod message never echoes it) → `INSERT … ON CONFLICT (pos_id) DO UPDATE` into `fiscal_credentials` (replace = a new token; there is no read-back) (1) → append `FiscalTokenSet { pos_id, set_at, set_by_staff_id }` (`hub` stream; **no token, no length, no hash**) → the worker picks the new token at its next send.
- **Result:** `{ pos_id, set_at }` — never the token. **Statements:** 2. **Audit:** `fiscal_token_changed` (ids and time only).
- **Rules:** no query, response, log line, event, sync payload or cloud row ever carries the token; `processed_commands` stores only the result above; the page field is write-only and never pre-filled; removing a token is not offered in the pilot (replace instead).

#### 6.29 Events (`schema_version` 1, `.strict()`, `@pos/events/src/events/<stream>/`)

| Event | Stream | Payload (besides ids named) | Folded by |
|---|---|---|---|
| `BillOpened` | bill | `{ bill_id, scope, seating_id, bill_key, order_type }` (⚠️ Changed in v0.4 (H2-16): `bill_key` non-null for scope `key`) | billing |
| `ChargeApplied` | bill | `{ bill_id, charge: 'service', rate_bp, source: 'rule' \| 'manual', has_note, note_id }` | billing |
| `ChargeRemoved` | bill | `{ bill_id, charge, reason_code, has_note, note_id, requester_staff_id, approver_staff_id, alert_id }` | billing |
| `CheckBillPrinted` | bill | `{ bill_id, total_default_minor, line_count, printer_id, job_id, source }` | billing |
| `BillSplitsSet` | bill | `{ bill_id, mode, splits }` | billing |
| `DiscountApplied` / `DiscountRemoved` | bill | §6.6 / §6.7 | billing |
| `PaymentAdded` / `PaymentRemoved` | bill | §6.9 / §6.10 (`has_reference` only, never the text, ⚠️ Changed in v0.3 H1-20) | billing, shifts |
| `BuyerIdWaived` | bill | `{ bill_id, has_note, note_id, requester_staff_id, approver_staff_id, alert_id }` (⚠️ Changed in v0.5.1 (H4-4)) | billing |
| `InvoiceIssued` | bill | §6.12 step 6 (no buyer ID, ever) | billing, shifts |
| `BillReopened` | bill | §6.13 | billing |
| `InvoiceCredited` | bill | §6.13 (+ `alert_id: string \| null`, ⚠️ Changed in v0.4 (H2-1)) | billing |
| `FiscalNumberAssigned` | bill | `{ invoice_id, authority, pos_id, fiscal_number, qr_payload }` (worker) | billing |
| `FiscalSubmitRejected` | bill | `{ invoice_id, authority, error_code (≤ 40), http_status }` (worker; no request body) | billing |
| `ShiftOpened`, `ShiftCounted`, `ShiftCountSkipped`, `HandoverCounted`, `ShiftClosed` | shift | §6.15–§6.19 | shifts |
| `PettyCashAdvanced`, `PettyCashSettled`, `PettyCashOut`, `PettyCashIn` | shift | §6.20 | shifts |
| `DrawerOpened` | shift | §6.21 | shifts |
| `OrdersCarriedOver`, `ZReportIssued` | hub | §6.24, §6.25 | billing |
| `BillClosedEmpty` ⚠️ Changed in v0.6 (H6-6, provisional) | bill | `{ bill_id, alert_id? }` | billing |
| `FiscalTokenSet` ⚠️ Changed in v0.2 (OQ-3) | hub | `{ pos_id, set_at, set_by_staff_id }` (no token) | billing (audit only) |
| 02b `OrdersBilled`, `OrdersUnbilled`, `LineCompRemoved`; 02a `BillClosed`, `SeatingReopened` (⚠️ Changed in v0.3, R2) | order / table | owned by 02b / 02a (rows Q-2, Q-4), written by 05 | orders, tables |

Every 05 event carries `has_note` / `has_paid_to` instead of free text (⚠️ Changed in v0.4 (H2-22); the text in `bill_texts`). ⚠️ Changed in v0.5 (H3-5): **no payload and no alert `values` carry text**; `bill_texts` is keyed by `subject_id` = the id the command mints and the event carries (`entry_id` for petty cash, `payment_id` for a payment, `note_id` — a ULID minted by the command — for bill-, charge-, discount-, reopen-, drawer- and carry-over notes), written by the command on the direct path and at raise on the approval path; `apply` never reads text. `DiscountApplied`, `DiscountRemoved`, `BillReopened` carry `has_note`, `note_id` likewise. ⚠️ Changed in v0.5.1 (H4-4): **every approvable kind's `values` carry `note_id` and `has_note`** (`discount`, `remove_service_charge`, `reopen_bill`, `remove_comp`, `close_without_buyer_id`, `petty_cash`; `shift_variance` takes `CloseShift`'s `note_id`) and `apply` copies them into its event, so an approved note resolves in `bill_texts`; `BuyerIdWaived`, `LineCompRemoved`, `ShiftClosed` carry `has_note`, `note_id`; `PettyCashSettled` has its own `note_id`. Events written by approval `apply` carry the request's `alert_id` and `approver_staff_id` = `AnswerFacts.answerer_staff_id` (01d contract). Builders in `@pos/events/testing` for each (F §6.7) and one fixture per event.

#### 6.30 Registrations at startup (`apps/hub/src/billing/index.ts`)

**At module load, before any projection is built** ⚠️ Changed in v0.3 (H1-8: `registerAuditAction` throws after the `audit` projection seals): `registerAuditAction` for each event in row V-3 and `registerRequestAction` for the seven kinds (map: actor = requester for approved actions, approver from the event, `subject_type 'bill' | 'shift' | 'order' | 'day'`, `amount_minor`, `reason`; detail ≤ 2 KB with ids and counts; **no buyer fields, no reference, no `paid_to`, no notes beyond the reason**); the eight alert kinds (§3.14, `fiscal_outbox_stuck`) at module top level (01d boot rule). **Then:** projections `billing`, `shifts` (after `orders`, `tables`, `audit`); live-only print folds (`BillRequested`, `InvoiceCredited`, `ZReportIssued`); `registerDayCloseGuard`, `registerDayCloseAppender` (rows A-3, A-4); `registerMergeGuard` (row T-1); `registerLineGuard` (row Q-3); `registerFiscalAdapter(noneAdapter)`, `registerFiscalAdapter(praAdapter)`; `startFiscalWorker` via 00 row H-3.

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
| Secrets | tokens only in the hub table `fiscal_credentials`, entered on the hub admin page (B22, §6.28a) ⚠️ Changed in v0.2 (OQ-3); the adapter reads at send; error texts from the authority are stored as a short code | a token in the repo, a log, an event or the cloud |
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
- **Hub admin `/admin/fiscal/`** ⚠️ Changed in v0.2 (OQ-3): per POS ID "Token: set on <date>" / "not set", a write-only field + Save (`SetFiscalToken`), shown by `manage-fiscal-settings`; the field is cleared after Save and never filled from the server.
- **Splits** ⚠️ Changed in v0.2 (OQ-4, OQ-6): the discount sheet is on the bill only and is hidden once a split is closed; closed splits show as locked with their invoice; lines added later appear in the open remainder with a "new" mark; a void / comp on a locked line shows `LINE_IN_CLOSED_SPLIT` with "Reopen the bill to change a paid split".

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
| `BILL_CLOSE_BLOCKED` | 409 | `{ reason: 'void_pending' \| 'weight_pending', order_item_ids }` (≤ 40) ⚠️ Changed in v0.2 (OQ-6: `lines_unassigned` dropped) | §3.3 rules 2, 3 |
| `DISCOUNT_PENDING` | 409 | `{ alert_id }` | a discount request on the bill is open (close, second discount) |
| `BUYER_ID_REQUIRED` | 409 | `{ threshold_minor, net_minor }` | §3.3 rule 6 |
| `BILL_TOTAL_CHANGED` | 409 | `{ expected_minor, total_minor }` | §3.3 rule 7 |
| `BILL_BALANCE_DUE` | 409 | `{ split_no, balance_minor }` | §3.3 rule 8 |
| `BILL_PARTLY_PAID` | 409 | `{ bill_id }` | `ApplyDiscount` / `RemoveDiscount` on a bill with a closed split (B7) ⚠️ Changed in v0.2 (OQ-4, OQ-6: was "any line edit on a partly paid bill") |
| `LINE_IN_CLOSED_SPLIT` ⚠️ Changed in v0.2 (OQ-6) | 409 | `{ order_item_id, bill_id, split_no }` | a remove / comp / comp removal / weight / void touching units a closed split invoiced (B15, rows Q-3, V-1) |
| `BILL_HAS_PAYMENTS` | 409 | `{ bill_id, split_nos? }` | merge / seating split with payments; a re-plan that drops a paid split |
| `BILL_REOPEN_PENDING` | 409 | `{ alert_id }` | a reopen request on the bill is open |
| `LINE_NOT_COMPED` | 409 | `{ order_item_id }` | `RemoveComp` on a line with no comped units |
| `SHIFT_NOT_OPEN` | 409 | `{ reason: 'no_shift' \| 'no_drawer_shift' \| 'not_open' \| 'payment_shift_closed' \| 'shift_counted' }` (⚠️ Changed in v0.6 (H6-3)) (⚠️ Changed in v0.4 (H2-26)) | money with no money shift; drawer action off a drawer; count of a closed shift |
| `SHIFT_ALREADY_OPEN` | 409 | `{ shift_id }` | second open shift for one person |
| `SHIFT_VARIANCE_PENDING` ⚠️ Changed in v0.5.2 (H5-5) | 409 | `{ alert_id }` | `CloseShift` while the shift's `shift_variance` request is open |
| `SHIFT_NOT_COUNTED` | 409 | `{ shift_id }` | close before a count without `skip_count` |
| `DRAWER_IN_USE` | 409 | `{ shift_id, staff_name }` | the device is already another open shift's drawer |
| `PETTY_ADVANCE_SETTLED` | 409 | `{ entry_id }` | settling a settled advance |
| ~~`PETTY_CASH_EXCEEDS_DRAWER`~~ ⚠️ Changed in v0.6 (H6-15: dropped, never appended) | — | — | a cash-out / advance above the shift's expected cash |
| `BILL_PAYMENT_ORDER` ⚠️ Changed in v0.6 (H6-12) | 409 | `{ split_no }` | a digital `in` after a cash `in` on a `pro_rata` split |
| `BILL_SPLIT_INVALID` | 422 | `{ reason: 'units_missing' \| 'units_exceed' \| 'deal_whole' \| 'option_with_parent' \| 'shares_sum' \| 'split_closed', order_item_id?, expected_minor? }` ⚠️ Changed in v0.2 (OQ-6) | §3.8, §6.5 |
| `DISCOUNT_TOO_LARGE` | 422 | `{ max_minor }` | discount above the target or `max_discount_pct` |
| `PAYMENT_EXCEEDS_BALANCE` | 422 | `{ balance_minor }` | non-cash above the balance; `out` above the negative balance |
| `PAYMENT_REFERENCE_REQUIRED` | 422 | `{ mode_id }` | mode needs a reference |
| `DRAWER_DEVICE_INVALID` | 422 | `{ device_id }` | `as_drawer` on a device that cannot hold a drawer |
| `PETTY_SETTLE_MISMATCH` | 422 | `{ amount_minor }` | spent + returned ≠ the advance |

⚠️ Changed in v0.4 (H2-14): v0.3's `TABLE_SEATING_CLOSED` is **dropped** — 02a's T18 `TABLE_SEATING_CHANGED` already refuses a submit naming a cleaned seating.

Reused (not new): `DAY_CLOSE_BLOCKED` (04) gains `reason: 'shift_open' \| 'unbilled_orders'` (shapes §3.13); `ORDER_BILLED`, `VOID_PENDING`, `TABLE_NOT_OPEN`, `BUSINESS_DAY_NOT_OPEN`, `PRINTER_NOT_FOUND`, `PRINT_JOB_NOT_FOUND`, `PRINT_JOB_NOT_PENDING`, `PERMISSION_DENIED` (new reasons `not_own_payment`, `skip_not_granted`), `CONFIG_REFERENCE_INVALID`, `VALIDATION_FAILED`. G0-7's `REFUND_EXCEEDS_PAID` is not created (no refund command, Q8).

---

## §10. Tests (`apps/hub/test/billing/*.int.test.ts`, `packages/domain/src/billing/*.test.ts`, `apps/hub/test/billing/fiscal/*.test.ts`; client tests in `apps/client/src/features/billing/`)

Every command also has: happy path, one test per error code it returns, retransmit returns the identical response and writes nothing (D32), and every grant state of its permission (`allowed`, `requires_approval`, not granted, out of scope; 04 G1-7 pattern). **HIGH** tests (G0 §5, G1-13) are marked **H**.

### 10.1 Bill, splits, discount, charges

1. Projected bill (no 05 event yet) equals the bill after `BillOpened` for the same lines (same `computeBill`).
2. Dine-in bill follows `seating_orders` (only orders neither billed nor cancelled, ⚠️ Changed in v0.3 H1-21; a closed seating's billed orders never appear as a projected bill): a second round joins; a cancelled order leaves; an archived table's order stays billable (01a §6.5).
3. Takeaway bill = one `bill_key` (the root order and its additions, ⚠️ Changed in v0.4 (H2-25)); close allowed before any `ItemServed` (Q2, B16); afterwards `RemoveItems` / `VoidItems` → `ORDER_BILLED`.
4. Lines: COMP shown at value with deduction; PENDING VOID tagged and only `refund_minor` subtracted (a comped unit's `comp_voided_minor` not); return line base 0; pending weight 0 and listed in `blocks`.
5b. ⚠️ Changed in v0.6 (H6-11): a fully comped (zero-total) bill closes with no payment via `bill_ref`.
5. **H** close refused for each §3.3 rule 1–9, in order, each with its code; nothing written (no event, outbox, job, buyer row).
6. `BillClosed` reaches the staff sockets and cashier kiosks (05 registers it in `TABLE_EVENT_TYPES`, ⚠️ Changed in v0.4 (H2-7)); `OrdersUnbilled` reaches the map / table view; the tile turns NEEDS_CLEANING; takeaway writes no `BillClosed`.
7. Item split: units over 2 splits; a deal whole; an option child with its parent; `units_missing`, `units_exceed`, `deal_whole`, `option_with_parent` refusals ⚠️ Changed in v0.2 (OQ-6).
8. Amount split: Σ shares must equal the default-class total (`shares_sum`); equal into 3 of Rs 1,000.00 → 333.33 / 333.33 / 333.34 net shares by `allocateDealMinor` (remainder to the last split, OQ-5) ⚠️ Changed in v0.3 (H1-13); a later round re-bases the last open share (H1-22).
9. Re-plan keeps a paid split's number; dropping it → `BILL_HAS_PAYMENTS`; after a close only the open remainder re-plans, naming a closed split → `BILL_SPLIT_INVALID { reason: 'split_closed' }` ⚠️ Changed in v0.2 (OQ-6).
10. **H** property: for random bills (1–40 lines, 1–3 classes, discounts, service charge, item / amount / equal splits, random payment classes) Σ split `S` = Σ line bases; Σ printed tax = Σ invoice tax rows; one rounding per split; no negative figure.
10b. **H** ⚠️ Changed in v0.2 (OQ-6) property over random bills with rounds added between split closes: Σ closed-split units + open-remainder units = the bill's live line units; no unit in two splits; every closed split's invoiced units and totals unchanged by later rounds, voids and comps on other lines.
10c. **H** ⚠️ Changed in v0.2 (OQ-6): after split 1 closes, a new round joins the highest-numbered open split with no staff action and no close block; when the last split closes the bill is CLOSED; a later order on that seating (where 02a allows one) opens a **new** bill with its own `BillOpened`.
10f. **H** ⚠️ Changed in v0.5 (H3-4): 3 × Rs 1,000, comp 1 before an item-split close (split 1 = 1 unit, share 666), then `VoidItems` 2 units → `LINE_IN_CLOSED_SPLIT` (residual base 334 on 0 open units). ⚠️ Changed in v0.4 (H2-2): line B 3 × Rs 1,000, 1 unit closed in split 1: comp 1 open unit → open part = 2,000 − 1,000 = 1,000 (not 1,333); comp 3 units → `LINE_IN_CLOSED_SPLIT`; a weight change on a line with closed units → refused; Σ closed shares + open base = line base after every step.
10d. **H** ⚠️ Changed in v0.3 (H1-4): property over random bases (incl. the review's `[99900, 99900, 99900, 100]` with 299 700, and run 2's base 10 000 / 99.99 % / units 2-2-1 per-part case, ⚠️ Changed in v0.4 (H2-12)) — `allocateCappedMinor`: Σ shares = total, `0 ≤ share ≤ base`, deterministic tie order; no split net, tax or total below 0.
10e. ⚠️ Changed in v0.3 (H1-6): item split `{B: 1}` closed in split 1, `{B: 2}` open in split 2; a 1-unit void of B → accepted, taken from split 2 (plan `{B: 1}`); a 2-unit void → `LINE_IN_CLOSED_SPLIT`; Σ closed + open = live units after each.
11. **H** tax table tests: exclusive and inclusive prices; 500 / 1600 bp; half-up at each named point only; a BigInt-sized product (Rs 9,999,999 × 1600 bp) exact.
12. Deal taxed under the deal's class on its whole billed amount; option child under its own; never from `allocated_price_minor` (README :214).
13. **H** G1-15: a bill with lines in two classes shows two tax rows, each on its own lines' base only; no line in two classes; `tax_enabled = false` or a null class → no tax.
14. **H** rate by date: a rate row effective tomorrow is not used today; at the effective date it is; the bill view shows the row's ref; an owner override beats the catalog row; adapter `none` uses `rate_bp`.
15. **H** ⚠️ Changed in v0.6 (H6-12): card after cash on a `pro_rata` split → `BILL_PAYMENT_ORDER`; SC split between the parts and taxed at each part's rate. Mixed classes: `higher_rate` → cash rate on the whole split; `pro_rata` → §6.31 step 3 numbers exactly; both equal when one class only; ⚠️ Changed in v0.3 (H1-15) with SC 10 % and with inclusive prices, the digital total of `N_d` ≤ `d` and of `N_d + 1` > `d`.
16b. **H** ⚠️ Changed in v0.3 (H1-5, owner R3): 10 % on Rs 2,000 (A in split 1, B in split 2); split 1 closes (D 100); void B → split 2 total 0, open discount 0 (never negative), split 1 unchanged; void half of B instead → open discount = min(100, B's remaining base) re-spread capped; no invoice below 0.
16c. **H** ⚠️ Changed in v0.4 (H2-8, owner Q-1): 10 % on Rs 2,000 (A split 1, B split 2); split 1 closes (D 100); a Rs 1,000 round C joins split 2; void B → open discount = min(100, B's remaining base) = 0, C pays full Rs 1,000; reopen clears `bill_discount_lines`.
16. Discount amount / percent on the **whole bill**, spread over every line by `allocateCappedMinor` (⚠️ Changed in v0.6 (H6-16)) before splitting, each split carrying its lines' shares; tax after discount (PRA example); `DISCOUNT_TOO_LARGE`; after a split closed `ApplyDiscount` / `RemoveDiscount` → `BILL_PARTLY_PAID` and the frozen amount stays; lines joining later carry no discount ⚠️ Changed in v0.2 (OQ-4).
17. Discount `requires_approval` → request; approve → `DiscountApplied { alert_id, approver_staff_id = answerer }`; close refused while pending (`DISCOUNT_PENDING`); withdraw → nothing; the bill closed meanwhile → `apply` throws, the answer is refused.
18. **H** sticky charge (M-3; ⚠️ Changed in v0.6 (H6-9): "Ask for bill" after a removal prints no charge and sets "check bill printed"): remove → reopen / check-bill print / split / merge / move / bill view / re-close → still removed; `ApplyServiceCharge` re-adds with `source: 'manual'`.
19. Service charge rate is the order type's at bill creation; a settings change later does not change an open bill.
20. Rounding step 100 / 500 / 1 000, methods nearest / down / up; the rounding line on the receipt.

### 10.2 Payments, close, invoices

21. ⚠️ Changed in v0.3 (H1-2, H1-3): cash `amount` 430 000 tendered 500 000 → change 70 000 on **that payment's** shift; expected cash +430 000; two cash payments on two shifts each keep their own change; a cash `amount` above the balance → `PAYMENT_EXCEEDS_BALANCE`.
22. Card above balance → `PAYMENT_EXCEEDS_BALANCE`; reference required → `PAYMENT_REFERENCE_REQUIRED`.
23. **H** property ⚠️ Changed in v0.3 (H1-2): Σ in `amount` − Σ out `amount` = split total at every close; change = Σ (tendered − amount) ≤ Σ cash tendered; Σ shifts' expected cash moves = Σ cash `amount` in − out.
24. Mode switch recomputes the total in the `AddPayment` result (M-7).
25b. ⚠️ Changed in v0.3 (H1-9, owner R4): reopen a day-1 bill on day 2 → `RemovePayment` of the day-1 payment → `SHIFT_NOT_OPEN { reason: 'payment_shift_closed' }`; the lower new total is settled by an `out` payment on today's shift; shift A's expected and count unchanged.
25. `RemovePayment` own; another's needs `close-shift-for-others` (`not_own_payment`).
26. **H** ⚠️ Changed in v0.6 (H6-1): sale and credit `invoice_ref`s never collide (`AC1-S000001` vs `AC1-C000001`); gap-free numbers: 200 closes interleaved with rollbacks (forced failures) leave numbers 1..200 with no gap; credit series separate.
27. `expected_total_minor` stale after a void approval between view and close → `BILL_TOTAL_CHANGED`.
28. **H** race: two kiosks close the same split → one invoice, the other `BILL_NOT_OPEN`; a void approved while closing → close refused or void refused (`ORDER_BILLED`), never both through.
29. Last split writes `OrdersBilled` (all the bill's orders) and `BillClosed` once; earlier splits write neither.
30. Each split close closes open `comp` requests on the units it invoiced `obsolete`; the last close the rest (02b To 05) ⚠️ Changed in v0.3 (H1-23).
31. Pending void blocks close (04 `pendingVoids`); after approve the bill drops the line and closes.
32. Partly paid bill ⚠️ Changed in v0.2 (OQ-6): `RemoveItems`, `CompLine`, `SetLineWeight`, `RemoveComp`, `VoidItems` on units a closed split invoiced → `LINE_IN_CLOSED_SPLIT` (rows Q-3, V-1); the same on a line only in the open remainder → accepted; after a reopen → accepted.
33. Pending weight with `live_units > 0` blocks; a voided pending-weight line (`live_units = 0`) does not (04 R-4).
34. Receipt `Doc`: number, lines, discount, service charge, tax per class with rate and payment class, rounding, total, payments, change, NTN / header / footer per template, "FISCAL NUMBER PENDING" when fiscalized and not answered, drawer block only with cash.
35. No printer routed → close succeeds, `receipt.job_id = null`, logged with ids.
36. **H** forced COMMIT failure on `CloseSplit` → no event, no outbox row, no print job, no `invoice_buyers` row, no `processed_commands` row.

### 10.3 Reopen, remove comp, buyer ID

37. **H** reopen a closed 2-split bill → two `InvoiceCredited` (credit series 1, 2, each the full original), `OrdersUnbilled`, splits open with payments; re-close → new sale numbers; dine-in full edit writes `BillClosed` again (#37b), corrections writes none ⚠️ Changed in v0.4 (H2-25).
37b. **H** ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) dine-in full-edit reopen (seating NEEDS_CLEANING, no other bill): `SeatingReopened` (reaches the map and table-view sockets, ⚠️ Changed in v0.4 (H2-7); a PARTLY_PAID reopen writes none, H2-27), table ORDERED / FOOD_ON_TABLE, holder's `SubmitOrder` and `RemoveItems` pass the lock, re-close writes `BillClosed` → NEEDS_CLEANING again.
37c. **H** ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) dine-in reopen after `CleanTable` (seating CLOSED, table re-seated or free): mode `corrections`; void / comp / `RemoveItems` (no lock, `readOrder.seating_state`) work; `SubmitOrder` on that seating → `TABLE_SEATING_CHANGED` (⚠️ Changed in v0.4 (H2-14)); re-close writes no `BillClosed`; the new seating on the table is unaffected.
37d. **H** ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) races: `CleanTable` then reopen → corrections; reopen then `CleanTable` → `TABLE_HAS_OPEN_ORDERS`; reopen then `OpenTable` → re-enters the reopened seating, a stale `seating_id` → `TABLE_SEATING_CHANGED` (⚠️ Changed in v0.4 (H2-23)); reopen request raised before a clean, approved after → corrections.
37e. ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) S-9 (b): after `BillClosed`, a `SubmitOrder` on the uncleaned seating is accepted, the table re-occupies, a **new** bill opens with no staff action; its close writes `BillClosed` again; `OpenTable` / merge on NEEDS_CLEANING still refused.
37h. ⚠️ Changed in v0.5 (H3-2): reopen a PARTLY_PAID dine-in bill and a PARTLY_PAID takeaway bill → `mode: 'full'`, `bill_orders` holds every order, the bill keeps every line, no projected second bill appears.
37g. ⚠️ Changed in v0.4 (H2-13, Q-2): a round queued offline before the close and replayed after it → `TABLE_NEEDS_CLEANING`; a fresh resend → accepted, new bill.
37f. ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) reopen of the first bill while the S-9 new bill is open → corrections only; the two bills never share an order (`bill_orders`); no unique-index clash.
38. **H** reopen after an earlier business day → credits and new invoices in today's Z; the old Z unchanged.
39. ⚠️ Changed in v0.4 (H2-1, H2-17): approve → every draft (`BillReopened`, `InvoiceCredited`, `OrdersUnbilled`, `SeatingReopened`) carries the request's `alert_id` and passes `checkAlertIds`; invoices changed between raise and approve → the answer is refused. Reopen approvable: approve → same drafts with `alert_id`; reject / withdraw → nothing; dedupe → `BILL_REOPEN_PENDING`.
40. Reopened bill with a lower total → negative balance → `AddPayment { direction: 'out' }` from the closer's shift; above it → `PAYMENT_EXCEEDS_BALANCE`.
41. ⚠️ Changed in v0.6 (H6-2): a `remove_comp` approved after its line's split closed or the bill closed → the answer is refused; a split close closes it `obsolete`. `RemoveComp` on an unbilled comped line → `LineCompRemoved`, bill rises; billed line → `ORDER_BILLED`; not comped → `LINE_NOT_COMPED`; void pending on it → `VOID_PENDING`; approval path.
42b. ⚠️ Changed in v0.3 (H1-16, owner R5): split 1 closes at a Rs 30,000 bill with no buyer data; a Rs 30,000 round joins; split 2's close needs the buyer ID or the approved waiver (`BUYER_ID_REQUIRED` otherwise); invoice 1 and its outbox row unchanged.
42. **H** buyer ID: whole-bill net above Rs 50,000 split into two splits each below → still required on each split; a waiver covers every split and survives a reopen; a bill under the threshold never asks; adapter `none` never asks.
43. **H** redaction (⚠️ Changed in v0.5.1 (H4-4): an approved `reopen_bill` with a note → `BillReopened.note_id` resolves in `bill_texts`; a settle note and the advance's note are two rows; ⚠️ Changed in v0.5 (H3-5): an over-limit petty cash with `paid_to` and a note → no text in `AlertRaised.values`, `details` or any event; the texts in `bill_texts` under `entry_id`; ⚠️ Changed in v0.4 (H2-20, H2-22): a `take-order`-only caller's bill view has `has_reference` only; no note or `paid_to` text in any event; ⚠️ Changed in v0.3, H1-19, H1-20: also `processed_commands.payload_hash` is over the payload **without** `buyer`, and a `VALIDATION_FAILED` on `buyer.id_number` carries no value; a payment reference is only in `payment_references`): a close with a CNIC leaves the number in `invoice_buyers` only — not in any event payload, log line (captured logger), alert `details` / `display`, audit row, Z / X, query response or receipt beyond the last 4.
44a. ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) takeaway before close: forgot an item / wants more → `SubmitOrder { adds_to_order_id }` → the root's token, its own `table_key`, the root's `bill_key`: joins the open bill (⚠️ Changed in v0.5.1 (H4-6)).
44b. ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) takeaway before close: wrong item → `RemoveItems` (not started) or `VoidItems` (started) + add the right one; too many units → `RemoveItems` / `VoidItems` with `units`; the bill follows.
44c. ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) takeaway after close: reopen → add (`adds_to_order_id`) → close → credit + new invoice covering both orders.
44d. ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) takeaway after close: reopen → void / remove the wrong item or extra units → close → credit + new invoice; parking: a second order of the same plate joins the bill before close and the reopened bill after.
44f. ⚠️ Changed in v0.4 (H2-5): close → addition opens a new bill on the key → reopen the first → corrections only (no unique-index clash; the addition stays on the new bill).
44g. ⚠️ Changed in v0.5 (H3-1), ⚠️ Changed in v0.5.1 (H4-5): an addition **keeps the root's token** (its `OrderPlaced.token` and the `SubmitOrder` result's `token` = the root's) (two orders with `(business_date, token)` equal are accepted, `orders_token_day` non-unique), its own `table_key` (slip of its own), `bill_key` = the root's; `nextToken` after it still gives MAX + 1; 03b / 03c / client show `#<token>` for both by order id.
44h. ⚠️ Changed in v0.4 (H2-21, Q-4): a parking bill carried from day 1; the same plate orders on day 2 → a new bill (`bill_key` with day 2's date); slip `table_key` unchanged.
44i. ⚠️ Changed in v0.4 (Q-3): reopen of a day-1 takeaway bill on day 2 → corrections only; `adds_to_order_id` to it → `422 CONFIG_REFERENCE_INVALID`; the new item is today's own order and bill.
44j. ⚠️ Changed in v0.6 (H6-6, provisional): full return — reopen, void every line, pay back with `out` → `BillClosedEmpty`, no sale invoice, no fiscal row; Z net −total; the bill leaves open-bills.
44e. ⚠️ Changed in v0.3 (H1-10 + S-9, owner R2) takeaway: an addition after the bill closed **without** a reopen → a new bill on the same key (the closed one untouched).
44. A takeaway closed before the food and reopened → credit + `OrdersUnbilled`; the kitchen keeps cooking (engine unaffected).

### 10.4 Shifts, petty cash, drawer

45. Open shift with float; second → `SHIFT_ALREADY_OPEN`; drawer taken → `DRAWER_IN_USE`.
46. **H** ⚠️ Changed in v0.6 (H6-3): a payment, petty cash or `OpenCashDrawer` on a counted drawer → `shift_counted`. Blind count: every `shift` query, `CloseShift` and X response before `ShiftCounted` has `expected_minor = null` and no cash sum; the `CountShift` response is the first with it (a `HandoverCount` reveals only its own handover's expected, §6.19).
47. **H** property (expected cash, G1-8, Q10): random payments (two takers on one drawer), change, outs, advances, settles (on another shift), cash-outs, cash-ins → the fold's expected = §3.7 formula; Σ shifts' takings = Σ the day's invoices − credits by mode.
48. Takeover on a drawer kiosk: the second person's cash and card land in the drawer shift with `taken_by` = them; the drawer close shows the breakdown by taker.
49. Order taker with `take-payment` (`own_tables`) and own shift: collects on own table only (`outside_scope` otherwise) into own shift.
53b. **H** ⚠️ Changed in v0.3 (H1-1, owner R1) approver matrix for `shift_variance` and `petty_cash`: requester grant `allowed` / `requires_approval` × answerer Owner / Manager (hold `close-shift-for-others`) / Cashier (does not) / the requester himself → only Owner and Manager answers are accepted (`not_approver` otherwise; never self); a scope that does not cover the requester → refused.
50b. ⚠️ Changed in v0.5.2 (H5-5): `CloseShift` with a new note while the variance request is open → `SHIFT_VARIANCE_PENDING`; no `bill_texts` row; the approved `ShiftClosed.note_id` is the first note's.
50. ⚠️ Changed in v0.6 (H6-3): reject → the shift stays COUNTED, recount accepted, money refused until CLOSED. Variance within threshold → closed; above → `shift_variance` request; a Manager approves (holders right, H1-1) / approve → `ShiftClosed { alert_id }`; reject → recount allowed.
51. `skip_count` needs `skip-blind-count` (default Owner only) and is audited.
52. Handover count records a variance and the shift stays open.
53. ⚠️ Changed in v0.6 (H6-2, H6-3, H6-15): an over-limit petty cash approved after the shift was counted → refused; any petty cash or payment on a COUNTED shift → `SHIFT_NOT_OPEN { reason: 'shift_counted' }`; no refusal reveals expected cash. Petty cash (over-limit request answered by a Manager through the holders right, H1-1): advance + settle (spent + returned = amount, else `PETTY_SETTLE_MISMATCH`), out, in; over the limit → request; `requires_approval` grant → request always; above drawer cash → `PETTY_CASH_EXCEEDS_DRAWER {}`.
54. Open advances listed at shift close and on X / Z; never block.
55. `OpenCashDrawer` off a drawer → `SHIFT_NOT_OPEN { reason: 'no_drawer_shift' }`; on a drawer prints the kick and audits.

### 10.5 Merges, splits of tables, printing

56. Merge with no payments: the absorbed bill folds into the survivor; a removed service charge on the survivor stays removed.
57. Merge / seating split with payments → `BILL_HAS_PAYMENTS` (05 guard after 04's), not `MERGE_BLOCKED_BY_VOID` ⚠️ Changed in v0.3 (H1-7); a seating split of a **reopened** bill with no payment left → `BILL_HAS_PAYMENTS` too (⚠️ Changed in v0.5.1 (H4-3)).
58. `BillRequested` → check bill at the zone's bill printer → floor → default; no 01d notice raised; a replayed queued `RequestBill` prints once.
59. Check bill `Doc`: banner, no invoice number / fiscal number / QR, default-class total, digital-rate line; `CheckBillPrinted` audit row with ids and counts.
60. **Print to:** a waiting / failed job → `RetargetBillPrint` moves it; a printed one → `PRINT_JOB_NOT_PENDING`; nothing prints twice.
61. Reprint after `FiscalNumberAssigned` shows the fiscal number and the QR block; before it, "FISCAL NUMBER PENDING".

### 10.6 Day close, reports

62. Day close refused: void pending (04 first), then open shift, then unbilled orders — each with its list (≤ 40) and `count`.
63b. ⚠️ Changed in v0.5 (H3-3) + a PARTLY_PAID carry: day 1 split 1 paid 500 and closed, split 2 paid 200, bill carried → takings 700 = Z 500 + CF 200; day 2 split 2 paid 300 and closed → 300 = Z 500 + 0 − BF 200. ⚠️ Changed in v0.3 (H1-9, owner R4), ⚠️ Changed in v0.4 (H2-3): carry-over of a bill with Rs 3,000 paid → close allowed; day-1 Z: carried forward 3,000; day-2 Z: the invoice, brought forward 3,000; a day-1 bill reopened and re-closed on day 2 at the same total → Z2 net 0, takings 0; reopened on day 2 and left open → Z2 net −1,000, carried forward 1,000; the §6.26 invariant holds every day.
63c. ⚠️ Changed in v0.6 (H6-10): carry the same order on day 1 and day 2 → two `carried_orders` rows, no key error, rebuild equal.
63. **H** carry-over → close succeeds; the carried orders bill next day and show on that day's Z as "carried in"; forced COMMIT failure → no `ZReportIssued`, no `z_reports`, no print job.
64. Appender closes open 05 requests and 02b comp requests `obsolete` (`day_closed`); void requests never reach it.
65. Event order in the close commit: `AlertClosed`… → `ZReportIssued` → 03a `StockReleased`… → `BusinessDayClosed`; the checkpoint follows `BusinessDayClosed` (03a To 05).
66. **H** Z invariant (restated, H1-9 / owner R4, ⚠️ Changed in v0.4 H2-3: Σ takings = Z net + carried forward − brought forward) over a generated day (sales, credits, reopens, splits, mixed classes, petty cash, three shifts): Z net = Σ sale − Σ credit; tax by class = Σ invoice tax rows; voids by disposition from `ItemVoided`; replay from seq 0 gives the identical Z.
67. X = the same builder over the open day; uncounted shifts' expected hidden.
68. `close-business-day` on the staff app (row H-1 `both`) and on `/admin/stock`; `manage-stock` alone no longer closes (row A-5).

### 10.7 Fiscal

69. **H** outbox row written in the close transaction (fold); a rolled-back close has none; `not_required` for adapter `none`, a non-fiscalized order type (delivery default off, Q17) and invoices before `switched_at`.
70. **H** crash between the HTTP answer and the `FiscalNumberAssigned` commit (fault injection) → restart resends the **same USIN**; one `FiscalNumberAssigned` in the log.
71. **H** order ⚠️ Changed in v0.4 (H2-18): strict **per POS ID** — a backing-off head row of POS ID 1 holds only POS ID 1's later rows; POS ID 2 with a missing token never holds POS ID 1; a credit waits for its original's ack and steps aside.
72. Back-off schedule with a fake clock; `RetryFiscalNow` pulls `next_try_at`; a `rejected` row is not resent.
73. Stuck alert (⚠️ Changed in v0.3, H1-18: expires at day close, re-raised on the next worker pass while stuck; H1-17: a credit of a rejected original is rejected): pending older than `stuck_after_ms`, a rejected row, or half the catch-up window → one `fiscal_outbox_stuck` to managers; closed when clear; details counts only.
74b. ⚠️ Changed in v0.6 (H6-4): `PaymentMode` from `pra_payment_mode` (cash 1, card 2, two codes → 5); a mode with no code → `pending`, `mode_unmapped`, stuck alert; Σ item tax = `TotalTaxCharged`; service charge item; credit carries the original's buyer and POS ID.
74. PRA adapter fixtures (recorded from the research's shapes and PRA spec v1.2 at build): sale (cash, card, mixed → `PaymentMode` 1 / 2 / 5), credit (`InvoiceType` 3 + `RefUSIN`), buyer fields above the threshold, 5xx → retry, 4xx → rejected, timeout → retry, duplicate USIN → per A10 default; the Bearer header comes from `fiscal_credentials` (v0.2, OQ-3); no network in the gate.
75. Token missing for the POS ID → row stays pending with `token_missing`, stuck alert, `fiscal-status.token_missing_pos_ids`; never thrown on a command.
76. Per-device POS ID mapping picks the device's POS ID; else the default (K-18).
77. `fiscal-status` and every log line of the worker contain no token, no buyer data (captured logger).
78. ⚠️ Changed in v0.6 (H6-8): a PRA original credited after the switch back to `none` → the credit goes to PRA under the original's POS ID. Switch `none` → `PRA` by setting: earlier invoices stay `not_required`; later ones pending.

### 10.8 Platform rows and registrations

79. Row A-3 / T-1 / Q-3 lists: two guards registered, the first non-null wins; 04's results unchanged.
80. Row H-1: a `'both'` command answers on both routes with one `command_id` space.
81. Row H-2 / §6.28a (⚠️ Changed in v0.3, H1-19: `payload_hash` computed without `token`) ⚠️ Changed in v0.2 (OQ-3): `SetFiscalToken` needs `manage-fiscal-settings` (Manager default refused, Owner allowed); the token is in `fiscal_credentials` only — not in the result, `processed_commands`, any event (`FiscalTokenSet` has no token), any log line (captured logger), `fiscal-status` (shows `set_at` only) or sync; replace overwrites; an unknown `pos_id` → `CONFIG_REFERENCE_INVALID`.
82. Row Q-1: `order_lines.tax_class_id` folded; migration 0021 refolds `orders` (checkpoint deleted).
83. Row Q-2: `OrdersUnbilled` clears `billed_at`; edits accepted again.
83b. Row Q-5 (⚠️ Changed in v0.3, H1-11): a carried order keeps `day_closed_at = NULL` across the close and stays on open-orders; `OrdersUnbilled` clears `day_closed_at`.
84. Row Q-4: `LineCompRemoved` fold never below 0; cascades with `planCompRemoval`.
85. Row P-1: `billPrinterFor` order device → zone → floor → default; a route's printer cannot be archived.
86. Row P-3: QR block encodes `GS ( k` bytes (golden bytes); `renderText` prints `[QR] …`; row P-4 import from `@pos/domain` without `node:*` (lint).
87. Row V-3 (⚠️ Changed in v0.3, H1-8: request rows for the seven 05 kinds via `registerRequestAction`; registering after seal throws; the `0023` checkpoint delete makes rebuild = live with old `BillRequested` events): every 05 event in row V-3 maps to its audit action; rebuild of `audit` equals live; no buyer data in `detail_json`.
88. Projections `billing` and `shifts`: rebuild from seq 0 equals live (every table, `fiscal_outbox` except worker columns).
89. Kinds registered at module top level; a replayed 05 alert finds its kind at boot (01d rule).
90. ⚠️ Changed in v0.6 (H6-13): Manager (new tenant and backfill) holds neither `skip-blind-count` nor `manage-fiscal-settings`; a role with `close-shift-for-others` and no `manage-own-shift` → `422`. Row B-2: default grants for new tenants and the backfill by `default_key` (active roles only; approver rows; `directory_version` bump; idempotent re-run).
91. Every 05 query uses its stated fixed statement count for 1 and for 40 bills / lines (no N+1).

### Acceptance

| Story / AC | Tests |
|---|---|
| G0 1 (see and print the bill) AC1–5 | 1, 2, 4, 58, 59 |
| G0 2 (payment and close) AC1–7 | 5, 6, 21–36 |
| G0 3 (split) AC1–3 | 7–10, 10b, 10c, 32 |
| OQ-3 token on the hub page | 81 |
| OQ-4 whole-bill discount | 16 |
| OQ-6 closed split frozen, remainder open, new bill | 10b, 10c, 32 |
| G0 4 (discount, service charge) AC1–4 | 16–19 |
| G0 5 (tax and rounding) AC1–4 | 10–15, 20 |
| G0 6 → Q8 (money back = reopen + credit) | 37–40, 44 |
| R2 reopen = full edit; dine-in seating reopen / corrections; S-9 new bill | 37b–37g, 44a–44i |
| Run-2 Q-1–Q-5 | 16c, 37g, 44f, 44h, 44i |
| Run-3 H3-1 (owner: same token) | 44g |
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
| P0.1 | After `module-deeplinks` (and any other lane claiming 05's targets) is on `main`: re-take the next free version and migration numbers on `main` and all branches **without a STOP**, update §4.5 and README row 05 in the same commit; STOP only on a content clash (⚠️ Changed in v0.5.2 (H5-1)) | `docs/specs/05_*`, `docs/specs/README.md` | §4.5 |
| P0.2 | Apply §4.5 rows to the target specs (one commit per target, "⚠️ Changed by 05 (row X-n)" markers, README R37 + row 05) | `docs/specs/*` | §4.5 |
| P0.3 | F-1 `bill` stream type | `packages/events/src/envelope.ts` | F-1 |
| P0.4 | H-1 `sessionKind: 'both'` | `apps/hub/src/commands/{registry,route}.ts` | H-1; #80 |
| P0.5 | H-2 `/admin/fiscal/` entry + nav ⚠️ Changed in v0.2 (OQ-3) | `apps/hub/src/admin/`, `apps/client/src/features/admin/fiscal/` | H-2 |
| P0.6 | A-3 guard list, A-4 appender list, A-5 permission + `both` + page | `apps/hub/src/commands/close-business-day.ts`, `apps/client/src/…/StockApp.tsx` | A-3–A-5; #68, #79 |
| P0.7 | B-1 permissions; D-1 01d holders right (H1-1, owner R1) | `packages/domain/src/permissions.ts`, `apps/hub/src/alerts/` | B-1, D-1; #53b |
| P0.8 | B-2 defaults + cloud `0017_billing_defaults_backfill.sql` | `apps/cloud/src/modules/staff-roles/default-roles.ts`, migrations | B-2; #90 |
| P0.9 | A-1, A-2 billing settings, fiscal catalog seed, routes, snapshot `billing` key — **HIGH** (rates) | `apps/cloud/src/modules/billing-settings/`, `0016_billing_settings.sql`, `packages/events/src/{config,admin/billing}.ts` | A-1, A-2; #14 |
| P0.10 | A-1 (6) owner Billing page with preview | `apps/client/src/features/owner/billing/` | A-1 |
| P0.11 | T-1 merge guard list; T-3 `SeatingReopened`, `requireLock` changes, audiences (v0.4: no new code) (⚠️ Changed in v0.3 (H1-10 + S-9, owner R2)) | `apps/hub/src/tables/{merge-guard,lock,projection}.ts`, `packages/events/src/events/table/` | T-1, T-3; #79, #37b–#37f |
| P0.12 | Q-1 `tax_class_id` + `0021_orders_billing.sql` (also `carried_over`, `bill_key`, `orders_token_day`; ⚠️ Changed in v0.5 (H3-9)) | `apps/hub/src/orders/{projection,exports}.ts`, `apps/hub/src/db/migrations/0021_orders_billing.sql`; ⚠️ Changed in v0.5.2 (H5-2: not `test/orders/migration.int.test.ts`, which stops at 0013): `apps/hub/test/db/alerts-migration.int.test.ts` (migration list + 0021), `apps/hub/test/db/order-line-{options,station,option-quantity}-migration.int.test.ts` (rewinds undo 0021's columns and index; `applied` lists include 0021), new `apps/hub/test/db/orders-billing-migration.int.test.ts` (`orders_token_day` non-unique, two `(date, 56)` rows accepted, `orders_token` gone) | Q-1; #82 |
| P0.13 | Q-2 `OrdersUnbilled`; Q-4 `LineCompRemoved` + `planCompRemoval`; Q-6 `adds_to_order_id` (root's token), `orders.bill_key` (v0.4 H2-4, v0.5 H3-1, H3-6); 03a S-1 `OrderPlaced.adds_to_order_id` | `packages/events/src/events/order/`, `apps/hub/src/orders/`, `apps/hub/src/orders/build-submit.ts`, `apps/hub/src/db/migrations/0021_orders_billing.sql` | Q-2, Q-4; #83, #84 |
| P0.14 | Q-3 line guard list; V-1 `VoidItems` asks it | `apps/hub/src/orders/line-guard.ts`, `apps/hub/src/voids/commands/void-items.ts`, `voids/queries/void-preview.ts` | Q-3, V-1; #32, #79 |
| P0.15 | V-2 `walk_out`; V-3 audit actions + subject types | `packages/domain/src/{voids,audit}.ts` | V-2, V-3 |
| P0.16 | P-1 bill routes + `0022_bill_routes.sql` + Printers page section | `apps/hub/src/print/`, client admin printers + `apps/hub/test/db/alerts-migration.int.test.ts` and the three rewind tests gain 0022 (⚠️ Changed in v0.5.2 (H5-2)) | P-1; #85 |
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
| 6 | Migration `0023_billing.sql` | `apps/hub/src/db/migrations/`; + `apps/hub/test/db/alerts-migration.int.test.ts` and the three rewind tests gain 0023 (⚠️ Changed in v0.5.2 (H5-2)) | §5 |
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
| 30 | **HIGH** PRA adapter + fixtures — **STOP at build until A13 and PRA spec v1.2 settle the unmapped `PaymentMode` codes and the rounding / service-charge placement** (⚠️ Changed in v0.6 (H6-4)) | `…/fiscal/pra.ts`, `apps/hub/test/billing/fiscal/fixtures/` | §3.15; #74–#76 |
| 31 | Stuck alert, `fiscal-status`, `RetryFiscalNow` | `…/fiscal/status.ts` | §6.27, §6.28; #73, #77 |
| 31a | `SetFiscalToken`, `fiscal_credentials` ⚠️ Changed in v0.2 (OQ-3) | `…/fiscal/credentials.ts` | §6.28a; #81 |
| 32 | Audit registrations | `…/audit-map.ts` | §6.30; #87 |
| 33 | Startup wiring | `apps/hub/src/billing/index.ts` | §6.30 |

**05 client (staff entry, ui-kit, R5).** 34 cashier open-bills list; 35 bill screen + payment pad + tendered / change; 36 split editor; 37 discount / service charge / buyer sheets; 38 print status + Print to; 39 shift open / count / close / handover; 40 petty cash; 41 day close + carry-over; 42 X / Z + fiscal status line; 43 i18n keys (EN, UR) for every §9 code and kind label.

**Close-out.** 44 E2E flows (webapp-testing: dine-in split + mixed payment; takeaway before food; reopen; day close with carry-over); 45 `test:perf` row (200-bill rush close on the pilot box, never in the gate); 46 manual checks (owner): PRA sandbox run with the owner's sandbox token (G1-12), receipt QR scan on each printer model (A3), drawer kick on the kiosk printer, go-live checklist (G1-16).

Estimate: 18 phase-0 + 34 hub + 10 client + 3 close-out = **65 tasks** (above the ~60 budget; accepted by OQ-2 (b), README R38). **Plan phases** ⚠️ Changed in v0.2 (OQ-2): **05-1** bills, payments, close, reopen, fiscal (hub tasks 1–20, 24, 27–31a and their client tasks); **05-2** shifts, petty cash, drawer, day close, X / Z (21–23, 25, 26, 32, 33). Phase 05-1 needs only `OpenShift` and the shift fold from 05-2, which it builds first (tasks 8, 15). ⚠️ Changed in v0.6 (H6-14): `apps/hub/src/billing/index.ts` is created in task 7 and **each task registers what it adds**; the audit maps of 05-1's events (task 32's part) ship in 05-1 together with 0023's `audit` checkpoint delete; 05-2 adds only its own maps (its events have no history before it, so no second refold).

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
| 6.3 | `PrintCheckBill` | command | `take-order` | BillOpened?, CheckBillPrinted | 404, 409×2 |
| 6.5 | `SetSplits` | command | `take-payment` | BillSplitsSet | 409×3, 422 |
| 6.6 | `ApplyDiscount` | command, approvable | `apply-discount` | DiscountApplied / request | 409×3, 422 |
| 6.7 | `RemoveDiscount` | command | `apply-discount` | DiscountRemoved | 409×2 |
| 6.8 | `RemoveServiceCharge` | command, approvable | `remove-service-charge` | ChargeRemoved / request | 409 |
| 6.8 | `ApplyServiceCharge` | command | `remove-service-charge` | ChargeApplied | 409 |
| 6.9 | `AddPayment` | command | `take-payment` | PaymentAdded | 404, 409×2, 422×2 |
| 6.10 | `RemovePayment` | command | `take-payment` (+ `close-shift-for-others`) | PaymentRemoved | 403, 404, 409 |
| 6.11 | `WaiveBuyerId` | command, approvable | `close-without-buyer-id` | BuyerIdWaived / request | 409 |
| 6.12 | `CloseSplit` | command | `take-payment` | InvoiceIssued, OrdersBilled, BillClosed, AlertClosed | 404, 409×8 |
| 6.13 | `ReopenBill` | command, approvable | `reopen-bill` | BillReopened, InvoiceCredited, OrdersUnbilled / request | 409×2 |
| 6.14 | `RemoveComp` | command, approvable | `remove-comp` | LineCompRemoved / request | 400, 409×4 |
| 6.15 | `OpenShift` | command | `manage-own-shift` | ShiftOpened | 409×3, 422 |
| 6.16 | `shift` | query | `manage-own-shift` (+ `close-shift-for-others` in the handler for another's) | — | 403, 404 |
| 6.17 | `CountShift` | command | same | ShiftCounted | 404, 409 |
| 6.18 | `CloseShift` | command | same (+ `skip-blind-count`) | ShiftClosed, ShiftCountSkipped / request | 403, 404, 409 |
| 6.19 | `HandoverCount` | command | same | HandoverCounted | 404, 409 |
| 6.20 | `RecordPettyCash` | command, approvable | `record-petty-cash` | PettyCash* / request | 409×2, 422 |
| 6.20 | `SettlePettyAdvance` | command | `record-petty-cash` | PettyCashSettled | 404, 409×2, 422 |
| 6.21 | `OpenCashDrawer` | command | `open-cash-drawer` | DrawerOpened | 409 |
| 6.22 | `PrintBillDocument` | command | `take-payment` | — | 404×2 |
| 6.22 | `PrintReport` ⚠️ Changed in v0.6 (H6-7) | command | `view-reports` | — | 404 |
| 6.23 | `RetargetBillPrint` | command | `take-order` | — | 404×2, 409 |
| 6.24 | `CarryOverOrders` | command | `close-business-day` | OrdersCarriedOver | 400, 409 |
| 6.25 | day close (01a) | guard + appender | `close-business-day` | AlertClosed, ZReportIssued | 409 `DAY_CLOSE_BLOCKED` |
| 6.26 | `x-report`, `z-reports` | queries | `view-reports` | — | 403 |
| 6.27 | `fiscal-status` | query | `take-payment` / `view-reports` | — | 403 |
| 6.28 | `RetryFiscalNow` | command | `close-business-day` | — | — |
| 6.28a | `SetFiscalToken` ⚠️ Changed in v0.2 (OQ-3) | admin command | `manage-fiscal-settings` | FiscalTokenSet | 422 |

**Size check** ⚠️ Changed in v0.6 (H6-7): **25 commands** (`PrintReport` split from `PrintBillDocument`; the day-close guard / appender is not a command) and **6 queries** = **31 hub endpoints**, plus 3 cloud routes carried by 01a (row A-1) = **34**, and ~65 build tasks. Above the ~30 / ~60 budget: **accepted by the owner (OQ-2 (b)) — one spec, two plan phases (§11), README R38**.

### 12.3 Open questions

**Owner questions (product choices)** — ⚠️ Changed in v0.2: **all answered** (owner, 2026-11-17 23:11–23:15 PKT; `docs/stories/05-g1-decisions.md` §9). The options and Rec are kept as asked; the answer ends each row.

| # | Question | Options | Rec |
|---|---|---|---|
| OQ-1 | **What does a bill reopen do to 02b's BILLED** (G1-3 design point)? | (a) **02b bump `OrdersUnbilled` (row Q-2): the orders are unbilled again, so line fixes go through 02b / 04 as usual (void with approval, comp removal), and the next close writes `OrdersBilled` again**; (b) the orders stay BILLED; a reopened bill allows only bill-level edits (discount, charges, payments) and "credit lines" kept by 05 outside 02b's ledger; (c) the orders stay BILLED; a reopen is only a credit + one fresh 05-built invoice re-entered by hand | **(a)** — one ledger (G0-2), voids keep their approval and wastage record; (b) makes a second line ledger in 05; (c) re-keys food — ⚠️ Changed in v0.2: **Answered (a)** (owner 2026-11-17 23:11–23:15 PKT): reopen writes 02b `OrdersUnbilled` (row Q-2); the orders return to unbilled, 02b adds and changes lines normally, the day-close guard sees them as unbilled. |
| OQ-2 | **Spec size:** 29 hub endpoints + 3 cloud routes = 32, ~64 build tasks (budget ~30 / ~60). Split? | (a) split at v0.2 into **05a Bills + payments + fiscal** and **05b Shifts + petty cash + day close + Z**; (b) **keep one spec, record a README decision (R38) as for 00's cloud part, and build in two plan phases (05-1 bills / fiscal, 05-2 shifts / day close)** | **(b)** — every payment needs a money shift (B11) and the Z needs both halves, so a split spec has a two-way dependency (05a needs 05b's shift, 05b's Z needs 05a's invoices); two plan phases give the same review size — ⚠️ Changed in v0.2: **Answered (b)**: one spec, two plan phases (05-1 / 05-2, §11); the >30 endpoint budget exception is README **R38** with this reason. |
| OQ-3 | Where is the PRA token entered? | (a) **hub CLI `set-fiscal-token` into the hub config file (row H-2), by the installer / developer at go-live**; (b) a write-only field on the hub admin page | **(a)** — no HTTP path ever carries the token; (b) later if owners must rotate tokens themselves — ⚠️ Changed in v0.2: **Answered (b)**: hub admin page field (§6.28a, B22, row H-2): `manage-fiscal-settings` (Owner only by default, row B-1), write-only ("set on <date>" only), replace = enter a new one, hub-only (never synced, logged or in events), audit `fiscal_token_changed` with ids only. v0.1's CLI is dropped. |
| OQ-4 | Discount target: G1 Q6 text says "on the bill only"; G0 Q6 (a), which the owner chose, says "on the bill or a split" | (a) **bill or one open split** (G0 (a) as chosen); (b) bill only | **(a)** — a split payer asking for a discount is the same customer case; spec written as (a) — ⚠️ Changed in v0.2: **Answered (b)**: discount on the **whole bill only**; refused with `409 BILL_PARTLY_PAID` once any split closed; spread pro rata over the lines before splitting (B7, §3.5, §6.6). |
| OQ-5 | Amount / equal splits when the adapter is PRA: each split is its own invoice with every line at its share (A8 open) | (a) **as written: proportional lines per split invoice**; (b) with a fiscal adapter, amount / equal splits become several payments on **one** invoice (one fiscal record), item splits stay separate invoices | **(a)** until PRA answers A8; (b) is a setting change if PRA refuses fractional lines — ⚠️ Changed in v0.2: **Answered (a)**: one invoice per amount / equal split with lines allocated proportionally (`allocateDealMinor`, remainder to the last); still subject to A8. |
| OQ-6 | A partly paid bill (one split closed): may lines still change? | (a) **frozen: line edits refused until the bill closes; a fix is a reopen** (B15); (b) lines outside closed item splits stay editable | **(a)** — amount splits have no line ownership; one rule is safer — ⚠️ Changed in v0.2: **Answered (owner rule, (b) made simple)**: a closed split is frozen; the unpaid remainder stays open; a new line after a split closed joins the open remainder automatically; all splits closed = bill closed, a new item on that seating opens a new bill; changing a closed split = reopen (B15, §3.8, `LINE_IN_CLOSED_SPLIT`, rows Q-3 / V-1, tests 10b, 10c, 32). |
| OQ-7 | Who approves over-limit petty cash and shift variances (the requester's grant is `allowed`)? | (a) **roles holding `close-shift-for-others` allowed at branch (row B-3)**; (b) a billing setting listing approver roles | **(a)** — no new setting; the same people close others' shifts — ⚠️ Changed in v0.2: **Answered (a)**: holders of `close-shift-for-others` (Manager, Owner by default); no separate setting. |
| OQ-8 | How long does the hub keep buyer IDs (`invoice_buyers`)? | (a) **as long as the invoice (legal record); never synced**; (b) delete after the fiscal ack + N days (reprints then show no buyer) | **(a)** until the accountant says otherwise — ⚠️ Changed in v0.2: **Answered (a)**: buyer ID kept as long as the invoice, hub-only, never synced. |

**Owner questions from hostile run 1** ⚠️ Changed in v0.3: Q-1 (H1-1) → **R1** holders of `close-shift-for-others` answer; Q-3 (H1-5) → **R3** open-part discount capped; Q-4 (H1-9) → **R4** carry-over with payments allowed, "payments on open bills" line, no removal on closed shifts; Q-5 (H1-16) → **R5** buyer ID from the next close (answers 2026-11-17 23:49 PKT, `05-g1-decisions.md` §10). Q-2 (H1-10 + S-9) → **R2** (23:58 PKT): reopen = full edit for every order type; dine-in seating re-opened while uncleaned, else corrections only; a new order on a just-closed seating opens a new bill (§3.10, rows T-3, Q-6). **Run 2 (v0.4):** review Q-1 (H2-8 leftover discount onto later rounds), Q-2 (H2-13 queued round replayed after close), Q-3 (earlier-day takeaway reopen: may it add?), Q-4 (H2-21 parking key per plate per business day), Q-5 (takeaway reopen while a newer bill holds the key) — text in `docs/reviews/05_v0.3_hostile_run2.md`; **Answered 2026-11-18 08:38 PKT** (§11 of `05-g1-decisions.md`): Q-1 owner; Q-2–Q-5 developer call, owner delegated (review Recs). **Run 6 (v0.6), pending:** review Q-1 (H6-5 full CNIC on the receipt), Q-2 (H6-3: no money on a counted drawer — applied, awaiting confirmation), Q-3 (H6-6 full refund ends with `BillClosedEmpty`, applied provisionally) — `TODO(owner)` anchors in B11, B14, B19, §3.10.

**Authority questions (open; defaults are the strictest / safest; answers change data or the adapter, not the flow).** A1–A7 as G1 §5 (A1 one POS ID per hub, per-device mapping ready; A2 local number + "fiscal number pending" + date / time; A3 QR at the foot, largest size, no logo; A4 no credit time limit; A5 platform orders not fiscalized; A6 `higher_rate`; A7 waiver with manager approval, `buyer_id_refused = true`, buyer fields empty). **New:**

| # | Question | Default until answered |
|---|---|---|
| A8 | How must an amount / equal split be reported — one invoice per payer with proportional lines, or one invoice with several payments? | one invoice per split with proportional lines (OQ-5 (a)) |
| A9 | Is the service charge part of the taxable value, and under which rate? | taxable under `service_charge_tax_class_id` (owner sets it; the safe setting is the restaurant class) |
| A13 ⚠️ Changed in v0.6 (H6-4) | PRA `PaymentMode` codes for wallet (JazzCash, EasyPaisa), QR (Raast) and online transfer; whether rounding and service charge are items or bill-level fields | **none — STOP the PRA adapter task (§11 task 30) until answered**; meanwhile such invoices stay `pending` (`mode_unmapped`) |
| A12 ⚠️ Changed in v0.3 (H1-17) | Must invoices reach PRA in invoice-number order per POS ID? | strict order (the head row blocks) |
| A10 | What does PRA answer to a re-sent USIN it already accepted (crash between send and ack)? | treat an answer carrying the fiscal number as success; anything else → `rejected` + alert, resolved by hand |

**STOP items (spec / code drift and G1 assumptions the code does not meet).**

| # | Finding | Handling in v0.1 |
|---|---|---|
| S-1 | G1-10 says the check bill prints "at the printer routed for that floor / zone (03c routing)", but 03c has **no floor / zone / device bill routing** — only `station_outputs` (03c §3.2, `print_jobs.printer_id` for `document` jobs). | 03c row P-1 adds bill routes; owner to confirm the routes live in 03c (hub admin Printers page) — ⚠️ Changed in v0.2: owner did not object; bump kept as written, **proposed, owner to confirm at approval**. |
| S-2 | K-5 "close-business-day also on the staff app": `CloseBusinessDay` is `sessionKind: 'admin'` and 00's registry allows one session kind per command (`registry.ts:53`). | 00 row H-1 (`'both'`) — ⚠️ Changed in v0.2: owner did not object; bump kept as written, **proposed, owner to confirm at approval**. |
| S-3 | `registerDayCloseGuard`, `registerMergeGuard`, `registerLineGuard` are single-slot ("at most one; a later registration replaces the earlier", `close-business-day.ts:14`, `merge-guard.ts:9`, `line-guard.ts:21`) and 04 already holds each slot; 05 registering would silently remove 04's guard. | rows A-3, T-1, Q-3 make them ordered lists — ⚠️ Changed in v0.2: owner did not object; bump kept as written, **proposed, owner to confirm at approval**. |
| S-4 | 04's `VoidItems` checks its own lock, not 02b's line guard, so units a closed split invoiced would still be voidable. | row V-1 — ⚠️ Changed in v0.2: owner did not object; bump kept as written, **proposed, owner to confirm at approval**. |
| S-5 | 04 v1.0.4 / v1.0.5 were on `module-04-client`. ⚠️ Changed in v0.5 (H3-9): **PR #236 merged them into `main`** (`049f6ce`); `spec-05` is rebased on it and README row 04 is `main`'s (v1.0.5). 05 bases on 04 v1.0.5 for its text (v1.0.4 / v1.0.5 are client / text only) and takes **v1.0.7** (still free on every ref). — ⚠️ Changed in v0.5.1 (H4-2): PR #237 claims 02a v1.1.7, 02b v1.0.15, 03a v1.2.5, 04 v1.0.6, 01d v1.3; 05 now takes 02a v1.1.8, 02b v1.0.16, 03a v1.2.6, **04 v1.0.7**, 01d v1.3.1 (developer call, owner may veto; `05-g1-decisions.md` §13). | ⚠️ Changed in v0.5.2 (H5-1): #237 merged into `module-deeplinks`; 05's phase 0 runs after that lane reaches `main` and re-takes the next free numbers then (no STOP for a renumber) |
| S-6 | Foundation §8 defers "Transactional outbox (separate outbox table)", while F §3.5 asks for a fiscal queue "same shape as the print queue". | row F-3 states the exception |
| S-7 | 01a S31 says 05 may extend the tax class shape "through a new snapshot schema version (S28)"; 05 adds an **optional** `billing` key and an optional `fiscal_category` without a version bump (R29, the 03b A-1 precedent). | owner to confirm no snapshot V5 |
| S-9 ⚠️ Changed in v0.2 (OQ-6) | OQ-6 says "a new item on that seating opens a new bill", but after `BillClosed` 02a puts the seating in NEEDS_CLEANING and refuses `requireLock` / open (`TABLE_NEEDS_CLEANING`), so a dine-in item can reach a closed bill's seating only if 02a allows it. 05 handles it (B1: one open bill per seating, a new one after close) but adds no 02a change. | owner to confirm: keep 02a's NEEDS_CLEANING rule (the guest's new item = a new seating after Clean), or a 02a bump letting a just-closed seating take a new round — **Resolved by owner R2 (2026-11-17 23:58 PKT), option (b):** 02a row T-3 lets a just-closed, uncleaned seating take a new round, which opens a new bill (§3.10). |
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
| Cloud shift / Z history, money tiles, sales reports | 06 / 07 (K-9, Q14) |
| Buyer-ID purge | OQ-8 (a): kept as long as the invoice |
| Card / wallet reconciliation | R7, P2 |

### 12.5 Hostile self-review (v0.1)

- **Races:** close vs void approve, two kiosks on one split, discount approved while closing, reopen approved twice, day close vs a close in flight — all in one `BEGIN IMMEDIATE` with the checks inside (tests 28, 17, 39, 62). An approval `apply` re-checks state read-only and throws when the bill moved on (01d refuses the answer).
- **Idempotency:** every command by `command_id`; the outbox by `invoice_id`; the PRA resend by USIN (A10 open). A queued `RequestBill` replay prints the check bill again — accepted (a reprint, no money).
- **N+1:** bill view ≤ 9, open bills 3, close ≤ 18, X ≤ 8, day close +≤ 10 — fixed counts (test 91).
- **Indexes:** each query in §5 names its index; the line guard uses `bill_orders_order`; the worker `fiscal_outbox_pending`.
- **Privacy:** buyer ID in one non-synced table, last 4 on paper, captured-logger tests; tokens only in the hub `fiscal_credentials` table, write-only (OQ-3); names never in logs; audit details ids and counts.
- **External failure:** internet down → close works, outbox waits, stuck alert after 30 min; PRA 4xx → rejected + alert, never silently resent; printer down → close works, Print to.
- **Contradictions checked:** status codes §6 ↔ §9; permissions ↔ row B-1; F §4.4 BILLED ↔ row F-2; 03a's `stockEffects` order ↔ row A-4; 04's guards stay first.
- **Over-engineering cut:** no separate payments service, no cache, no batch fiscal, no refund command, no per-split discount reasons, no snapshot V5; `bill_print_jobs` kept only because "Print to" needs the job id (G1-10); `shift_takings` kept only for the per-taker breakdown at a fixed statement count (Q10).
- **Known risk:** the PRA field mapping beyond the research is taken from PRA's spec v1.2 at build (task 30); an unclear field stops the build for the owner, it is not guessed.
