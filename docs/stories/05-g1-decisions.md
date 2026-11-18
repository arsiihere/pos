# 05 Billing — G1 decisions (working record)

| | |
|---|---|
| Status | **G1 COMPLETE (owner, 2026-11-17 21:39 PKT, "all rec" on the re-asked items). Waiting for "go spec".** Working record of the G1 session (developer, 2026-11-17). §1 holds the owner's answers on G0 §6 (Q1–Q18) as given 2026-11-17 21:03 PKT; §2 the re-asked items and their final rulings (21:39 PKT); §3 the K rulings (all Rec, with the changes the Q answers force); §4 the decisions that follow; §5 the authority questions (A1–A7, open). |
| Base | `spec-05` rebased on `origin/main` @ `ea0ee00` (04 is on `main` via #220; 00 v1.11 via #224, Q-70). G0 = `docs/stories/05-g0.md` (`caf6289`, `4c1314b` after the rebase). Fiscal research = `docs/stories/05-fiscal-research.md`. |
| Supersedes in G0 | K-10 and K-11 are **stale** (04 is on `main`): spec task 0 takes the next free version numbers from `main` and every open branch, and bases on the 04 version on `main` (§3). Q3 was first narrowed to mixed payments, then **restored to G0 (a) splits** on 2026-11-17 21:48 PKT (§7). Q8 (a) is replaced by (b) reopen. Q13 (a) is replaced by zone printing (§2). |

## 1. Owner answers on G0 §6 (2026-11-17 21:03 PKT)

| # | Owner said | Ruling |
|---|---|---|
| Q1 | b (re-confirmed after M-15: live from day 1, G1-16) | **PRA adapter ships in the pilot** (Arif Chatkhara, Lahore). Port, outbox, rate table and adapter `none` are built either way (K-14). The owner registers the POS ID(s) with PRA and keeps the token outside the repo (§4 G1-12). |
| Q2 | "fixed nahi; banda call par takeaway kar deta 'main aa raha hoon'; check bill jo final nahi hota par us par sab hota hai; band bill ko reopen bhi karna parta hai" | **(a) widened.** (1) A takeaway / parking bill may close at any time after Send — before the food, after it, or when a phone-order customer arrives. (2) **Check bill** (pro-forma): prints items, prices, discount, service charge, tax and total at any time, any number of times, marked **"PROVISIONAL – NOT A TAX INVOICE"**; no invoice number, no fiscal call, no money event (an audit row only). (3) Reopen → Q8. |
| Q3 | "split payment ka matlab half bill cash, half online transfer" | **Superseded by §7 (21:48 PKT): splits are in the pilot.** First reading kept for the record: one bill paid by **one or more payments in different modes** (cash + online, cash + card, …) — this stays true inside every split. Mixed-class tax → Q4. |
| Q4 | "best solution batana" | Explained (§2); final ruling there. |
| Q5 | a | Service charge per order type (0 = off), removable with `remove-service-charge` + reason; **no tips** in the pilot. |
| Q6 | a | Discount on the bill only (amount or %), fixed reason buttons + note for Other, approval as the role's grant says; a free item is a comp (02b). |
| Q7 | b | **"Remove comp"** on an **unbilled** line, with approval (new approvable permission, default Manager approves); writes a 02b ledger event (02b bump, §4 G1-7). A billed line's comp is changed only through reopen (Q8). |
| Q8 | b | **Reopen a closed bill** (`reopen-bill`, reason required, approval as the grant says), edit, close again with a **new invoice number**. Fiscally: a **credit invoice** against the original (PRA `InvoiceType 3` + `RefUSIN`) then a new invoice (§4 G1-3). The original invoice and its receipt are never changed. A separate refund-without-reopen is not built in the pilot (a reopen with lines removed is the refund path). A **business day** is never reopened (Q11). |
| Q9 | "explain karna" | Explained (§2); final ruling there. |
| Q10 | "jo login kare wo har tarah ki payment le, log usi ka jaye" | Shaped with the owner (§2); final ruling there. |
| Q11 | "samjhana" | Explained (§2); final ruling there. |
| Q12 | "explain karna" | Explained (§2); final ruling there. |
| Q13 | "printers per zone (ground floor, first floor, zone); paper khatam ho ya na nikle to runtime par click karke kahin aur se print nikal le; cashier screen par bhejna load barhata" | Shaped (§2); final ruling there. |
| Q14 | a | Hub Z and X reports only (tax by class; discounts / comps / voids / refunds / reopens with requester, approver, method). Sales by item / hour / staff and the live money view → 07. |
| Q15 | "a; proper organised banana hai — vendor ya cheez khatam ho to counter se paise lo aur le aao" | Designed (§2); final ruling there. |
| Q16 | a | Seeded per-authority catalog as versioned cloud data; owner picks the authority and may override a row with its ref and date. |
| Q17 | a | Per-order-type "fiscalize" flag (data); platform orders off by default until A5 is answered; delivery itself is P2. |
| Q18 | "a theek; par 50k wali situation mein bill tod sakein taake is condition mein na jana pare; log CNIC nahi dete; rakhna zaroor hai par mana kare to phanse na rahein" | Shaped (§2); the "split the sale to stay below the threshold" part is **not built** (§2 Q18). |

## 2. Re-asked items — final rulings (2026-11-17 21:39 PKT, "all rec")

| # | What was explained | Ruling |
|---|---|---|
| Q4 | Rs 2,000 pre-tax, Rs 1,000 cash + Rs 1,000 card: higher rate → tax Rs 320 (safe, customer loses the digital rate); pro rata → Rs 160 + Rs 50 = Rs 210 (fair; under-paid if PRA wants the cash rate). | **A per-authority rule as data; default `higher_rate` (the cash rate on the whole bill) until PRA answers A6; `pro_rata` is a ready setting** (no code change to switch). Pro rata: the cashier states the digital part first; the system splits the pre-tax base in that ratio, taxes each part at its class rate, and shows the new total before the payments are taken (§4 G1-5). |
| Q9 | A shift = "this person answers for this money": float at open, count at close, the system shows what was expected. Per person vs shared per drawer. | **(a) a shift per person.** Everyone who takes payments opens their own shift (float if they hold cash). A drawer belongs to one open shift at a time. An order taker with `take-payment` on own tables collects into their own shift and counts it at close. |
| Q10 | Owner's idea: the person who logs in temporarily takes every kind of payment and the log is theirs. Twist: the cash sits in the first cashier's drawer. | **The person logged in takes any payment mode; every payment records `taken_by_staff_id` = that person (audit, reports). Cash goes into the drawer's open shift** (the first cashier's), so the drawer count matches; the X / Z report and the shift close show the drawer's takings broken down by `taken_by`. An optional **handover count** (the first cashier counts on return, the shift stays theirs) is offered, not forced. Card / online payments by the second person count in the drawer shift too when taken on that kiosk (one shift per kiosk drawer, Q9). |
| Q11 | 2 am close with table 7 unbilled: block + list + carry over with reason vs close anyway vs block and build day reopen. Bill reopen (Q8) needs no day reopen. | **(a)** Day close is refused while any order is neither billed nor cancelled (list shown); a manager may carry them over with a reason (logged); they bill next day and show on that day's Z. A business day is never reopened; a later fix is a bill reopen dated today. |
| Q12 | Walk-out Rs 1,500: void the lines through 04 (no invoice, no tax) vs a write-off mode (an invoice and tax the restaurant pays itself). | **(a)** void the unpaid lines through 04 (reason `walk_out`, approval, wastage); no "unpaid" payment mode. |
| Q13 | Bill request → check bill prints at the zone's printer; runtime printer picker; nothing pushed to the cashier screen. | **"Request bill" (02a `RequestBill`) prints the check bill at the printer routed for that floor / zone** (03c routing). If the job fails or the printer is out of paper, the staff app offers **"Print to: [printer]"** at run time and the job is re-sent there (03c print queue, a target override). **No alert and no push to the cashier screen** (G0 Q13 (a) dropped); the cashier's open-bills list shows "check bill printed" as a pulled status only. |
| Q15 | Proper petty cash: advances that get settled, direct cash-out, cash in, editable categories, limit approval. | **(a) as designed:** (1) **cash advance** to a named staff member for a purpose ("Rs 5,000, sabzi, Bilal"), open until **settled** (spent amount + change returned + optional note / bill photo deferred); open advances listed at shift close and on the X / Z; (2) **direct cash-out** (category, paid to — free text, amount, note); (3) **cash in** (e.g. owner adds float). Categories are an owner-edited list (branch settings). Above a branch limit → approval (`record-petty-cash`). Vendor khata / credit stays in module 10; petty cash is cash only. |
| Q18 | Splitting one sale into several invoices to stay below the Rs 50,000 threshold is structuring; the developer does not design it. Alternative: threshold on the whole sale, a refusal path, and ask PRA. | **The threshold applies to the whole sale (the bill, incl. after a reopen), per authority as data.** Above it the cashier is asked for name + CNIC / NTN. If the customer **refuses**, the bill closes **with manager approval** (new approvable permission, §4 G1-9) and the invoice carries `buyer_id_refused = true`; nothing blocks the counter. CNIC / NTN goes only into the invoice for the authority — never a log, never an alert body. The spec **never offers splitting a sale to stay under the threshold**. What the authority wants on a refusal is **A7** (open); its answer changes data or the adapter, not the flow. |

## 3. K rulings (all Rec, 2026-11-17 21:39 PKT) and what the Q answers change

| # | Ruling |
|---|---|
| K-1 | (a) 05's own money event **per invoice** (`InvoiceIssued`: number, lines, discount, service charge, tax by class, rounding, payments with `taken_by`, change); at the bill's last split also `OrdersBilled` + (dine-in) `BillClosed`, one transaction. One invoice per closed split (§7); with Q8 a reopen writes `InvoiceCredited` (the credit) and, at the next close, a new `InvoiceIssued`. Foundation text: BILLED = `OrdersBilled`; reopen's effect on BILLED is decided in the spec (§4 G1-3). |
| K-2 | (a) `bill` stream (stream id = `bill_id`) for bill / payment / invoice / reopen / credit events; shift, petty cash, blind count on `shift`. Foundation bump + Zod enum. |
| K-3 | (a) as in G0 (restored by §7): one bill per seating (dine-in) or per order (takeaway / parking); splits are parts of it, each paid (1..n payments, any modes), numbered and printed on its own; `OrdersBilled` + `BillClosed` once, at the last split. 02a text row "last open bill" → "the bill's last split" (text only). |
| K-4 | (a) 02b bump: `order_lines.tax_class_id` + `LineView.tax_class_id`, hub migration with `orders` refold. |
| K-5 | (a) keep 01a's day commands; 05 registers day-close guards and a Z appender (`ZReportIssued` before `BusinessDayClosed`, same transaction); close moves to `close-business-day`, also on the staff app. |
| K-6 | → Q11 (a). |
| K-7 | (a) every mode always available; online modes may require a reference text (config per mode). |
| K-8 | → Q1 (b) PRA in the pilot. |
| K-9 | (a) 05 is hub-only; cloud shift / Z history and remote money tiles carried **To 06 / 07**. |
| K-10 | **Stale.** Spec task 0 recomputes the next free numbers from `main` and every open branch; STOP on a clash. |
| K-11 | **Stale.** 04 is on `main`; the spec bases on the 04 version on `main`; build starts from `main`. |
| K-12 | (a) fixed receipt layout with owner-edited header / footer lines, show / hide toggles and variables; no logo in the pilot; `renderText` to `@pos/domain`. Receipt adds the PRA fiscal number + verification QR (03c needs a QR block → 03c bump, §4 G1-11), and the check bill carries the "PROVISIONAL" banner. |
| K-13 | (a) 01b bump, **list widened by the Q answers**: `take-payment`, `manage-own-shift`, `close-shift-for-others`, `skip-blind-count` (Owner only), `record-petty-cash` (approvable), `remove-service-charge` (approvable), `close-business-day`, `open-cash-drawer`, **`reopen-bill` used** (approvable, Q8), **`remove-comp`** (approvable, Q7), **`close-without-buyer-id`** (approvable, Q18). Defaults by `default_key` + cloud backfill. Every grant state tested (04 G1-7 pattern). |
| K-14 | (a) README decision amending R13: port, outbox, rate table and adapter `none` are 05 pilot scope; **PRA adapter ships in the pilot (Q1)**; milestone C keeps SRB / KPRA / BRA / FBR-ICT. |
| K-15 | (a) rate from the branch authority's table keyed by (tax class, payment class, integration status, `effective_from`), each row with its notification ref, chosen at payment / close; `rate_bp` stays only for adapter `none`; mixed classes per Q4. |
| K-16 | (a) hub posts directly over HTTPS from the branch internet; a Windows-only authority path is decided with 01e when that adapter is built. |
| K-17 | (a) hub fiscal outbox in the close transaction; receipt prints "fiscal number pending" + the local number; catch-up window per authority as data (PRA 7 days, r.8(3)); stuck / old outbox → 01d alert to owner / manager; reprint shows the fiscal number once known. Applies to credits (reopen) too. |
| K-18 | (a) one POS ID per hub by default, optional per-device mapping in the branch's fiscal settings; A1 decides which. |

## 4. Decisions that follow

| # | Decision |
|---|---|
| G1-1 | **Check bill** (Q2, Q13) is a print, not a money event: built from the live bill projection by a pure `Doc` builder in `@pos/domain`; banner "PROVISIONAL – NOT A TAX INVOICE"; never carries an invoice number, fiscal number or QR; an audit row (`check_bill_printed`, ids and counts only). Its total is the total the bill would close at **with the default payment class** (cash, Q4 `higher_rate`), stated on the slip. |
| G1-2 | **Payments** (Q3, §7): a split (a bill without splits is one split) holds 1..n payments, each `{ mode_id, amount_minor, reference?, taken_by_staff_id, shift_id }`; Σ payments − change = split total at its close; change only from cash; a payment may be removed before close (permission + audit). |
| G1-3 | **Reopen** (Q8): `ReopenBill { bill_id, reason_code, note }` → `InvoiceCredited { credit_no, ref_invoice_no, … }` (a full credit of the original, queued in the fiscal outbox as PRA `InvoiceType 3` with `RefUSIN` once the original has a fiscal number — if the original is still pending, the credit waits behind it in order) and the bill is open again for edits (lines through 02b / 04 as usual, discount, payments). The next close issues a **new invoice number**. Credits are numbered in their own gap-free series. Money already paid stays on the bill as payments; any difference is paid or given back at the next close (a negative balance is paid out from the closer's shift). Reopen of a bill from an earlier business day is allowed; the credit and the new invoice belong to **today's** Z. 02b BILLED: the spec decides whether reopen writes an `OrdersUnbilled` (02b bump) or 05 keeps reopened orders outside 02b's billed set — STOP-level design point for the spec's §4.5. |
| G1-4 | **Takeaway close** (Q2): `CloseBill` for an order-scoped bill is allowed any time after the first Send; 04 then refuses a void on its lines (closed) — a later problem is a reopen (G1-3). |
| G1-5 | **Mixed-class tax** (Q4): rule `mixed_class_rule ∈ { higher_rate, pro_rata }` per authority row set, default `higher_rate`. Pro rata needs the digital share before payment: the cashier enters the digital amount(s) first, the system recomputes tax and total and shows them; cash then pays the rest. Rounding once, at the bill total (G0 rule). Property test: Σ tax by class = printed tax; pro rata and higher rate agree when one class only. |
| G1-6 | **Taken-by vs shift** (Q10): payment events carry both `taken_by_staff_id` (who) and `shift_id` (whose money). Cash on a kiosk with a drawer always lands in that drawer's open shift; a kiosk without an open drawer shift refuses cash (`SHIFT_NOT_OPEN`). A person taking payments on their own device (order taker, Q9) uses their own shift. Optional `HandoverCount` on the drawer shift (counted, variance recorded, shift stays open). |
| G1-7 | **Remove comp** (Q7): command and request kind `remove_comp` on an unbilled line; on approve writes 02b's new `LineCompRemoved` (02b bump, 02b owns the event and the ledger fold); 04's audit list gains the action. |
| G1-8 | **Petty cash** (Q15): events on the `shift` stream — `PettyCashAdvanced`, `PettyCashSettled`, `PettyCashOut`, `PettyCashIn`; categories in branch settings (01a bump); limit approval via kind `petty_cash`; open advances block nothing but are listed at shift close and on X / Z. Expected cash = float + cash payments − change − cash refunds / payouts − advances + settled change − cash-out + cash-in. |
| G1-9 | **Buyer ID** (Q18): threshold per authority as data (PRA Rs 50,000 excl. tax); applies to the **whole bill's** pre-tax total after discount, never per split (a split cannot take a sale under the threshold); above it close needs `{ buyer_name, buyer_cnic_or_ntn }` or `buyer_id_refused` with an approved `close-without-buyer-id`; CNIC / NTN stored only in the invoice record handed to the adapter, redacted from every log, alert body, audit row and Z. No feature splits a sale to stay under the threshold. |
| G1-10 | **Zone printing for the check bill** (Q13): `RequestBill` prints at the floor / zone receipt printer by 03c routing; on a failed job the staff app shows "Print to: [printer]" and re-queues with a target override (03c bump if its queue lacks a per-job override). No 01d notice. |
| G1-11 | **Receipt QR** (K-12, Q1): 03c's `Doc` gains a QR block (ESC/POS `GS ( k`), payload = the PRA verification string from the stored answer; 03c bump. Raast payment QR is separate and not in the pilot. |
| G1-12 | **PRA adapter in the pilot** (Q1): cloud API over HTTPS from the hub (K-16); sandbox and production base URLs and the Bearer token are **branch fiscal settings / hub secrets, never in the repo or docs**; sandbox token used only in local / owner tests, never in CI. Adapter fixture tests from the research's request / response shapes; the live sandbox run is a manual owner step (CLAUDE.md: no network checks in CI). |
| G1-13 | **HIGH parts** (G0 §5) unchanged, plus: reopen + credit ordering in the outbox; Q10 taken-by vs shift expected-cash; petty-cash advance settle arithmetic; buyer-ID redaction test (no CNIC in any log line, alert or audit row). |

## 5. Authority questions (open; owner emails PRA at eims@pra.punjab.gov.pk)

Until answered the spec keeps each one **OPEN** and takes the strictest / safest default.

| # | Question | Default until answered |
|---|---|---|
| A1 | One POS ID for several tablets / kiosks behind one hub, or one per device? | one per hub; per-device mapping available (K-18) |
| A2 | What an offline "fiscal number pending" receipt must show | local invoice number + "fiscal number pending" + date / time; reprint after the answer |
| A3 | QR size, placement and logo rules | QR at the foot of the receipt, largest size the 80 mm paper allows, no logo |
| A4 | Time limit for a credit invoice against an original | none enforced; credit allowed for any original (G1-3) |
| A5 | Do delivery-platform orders get fiscalized by the restaurant? | not fiscalized (Q17 flag off) |
| A6 | Rate on a bill paid partly cash, partly card | `higher_rate` (Q4) |
| **A7** | **New.** A customer above the Rs 50,000 threshold refuses to give CNIC / NTN: may the invoice be issued, and what goes in the buyer fields? | close with manager approval, `buyer_id_refused = true`, buyer fields empty (G1-9) |

## 7. Current POS (Mutfak) — owner's screenshots and pain points (2026-11-17 21:43–21:48 PKT)

Screenshots shown in chat; **not committed** (they show customer phone numbers; the repo is public).

| # | Seen / said | What 05 (or another module) does |
|---|---|---|
| M-1 | Owner: "Split Order" exists today and staff use it → "agar is mein hai to rakhte hain split order" | **Splits are in the pilot** = G0 Q3 (a): split by items, by amount, and "equally into N"; each split paid (mixed modes allowed), numbered, fiscalized and printed on its own; no seats at ordering. Restores K-3 (a) and the G0 split stories. |
| M-2 | Owner: options come **all pre-checked**; staff untick everything except what they want | 01c already has per-option `is_default` (V6) set by the owner, default **false**; only options the owner marks default are preselected (01c §4.4 02, G3 5). No 05 change; the pilot menu setup must leave `is_default` off unless truly default (setup checklist note for 01c data entry). |
| M-3 | Owner: delivery charge (and other charges) are **re-applied every time the bill is opened**; staff remove them again and again | **Charges are applied once, by rule, when the bill is created; a removal is an event that sticks.** Opening, viewing, printing a check bill, splitting, a 02a merge / move or a reopen (Q8) never re-applies a removed charge; re-adding is an explicit action (audited). Applies to the service charge now (Q5) and to the delivery charge when delivery ships (P2). Test: remove → reopen / reprint / split → still removed. (G1-14) |
| M-4 | Checkout: sub total Rs 5,710, tax Rs 1,370.40 (= 24 %). Owner (21:52): every tax class configured (e.g. 5 %, 3 %, 16 %, 8 %) is **applied to every bill by default**; staff remove the ones not wanted | 24 % is most likely 16 % + 8 % stacked. **05 never stacks classes and staff never pick tax at the bill (G1-15).** Tax by class shown with its rate and payment class. |
| M-5 | Grand total Rs 7,080.40, rounding Rs 0.00 | Rounding step per branch (Rs 1 default), applied once to each split total (G0 rule); never a paisa total on a cash receipt. |
| M-6 | Received amount pre-filled with the grand total | The cashier enters the tendered amount; change is computed and goes into the shift's expected cash (blind count relies on it). |
| M-7 | One tax number before the payment mode is chosen | Choosing / switching a mode recomputes tax (K-15, Q4) and the total on the same screen, so the customer sees the digital rate. |
| M-8 | Table P=21 open **5,175 min** (~3.6 days) | Confirms Q11 (day close refuses unbilled orders); X report and cashier list flag bills open longer than a set age (setting). |
| M-9 | Discount buttons 5 / 10 / 15 / 20 % + "Special Discount", no visible approval | Q6: owner-edited reason buttons; approval by grant; every discount audited. |
| M-10 | "Long press for mass cancellation" | 04: every void with reason + approval; no mass cancel without it. |
| M-11 | Modes Cash, Credit Card, Jazz Cash | R7 owner list; online modes may require a reference (K-7). |
| M-12 | "Check Bill" on the checkout screen | Q2 check bill (G1-1). |
| M-13 | Availability screen (item struck out) | To confirm in spec task 0 which module marks an item unavailable by hand (01c `isAvailable` input / 03a stock); not 05. |
| M-15 | Owner (21:52): **Mutfak is not integrated with PRA** | Q1 re-asked; owner (2026-11-17 ~21:55 PKT): **build PRA and run it live from day 1** on the POS floor (G1-16). |
| M-14 | Delivery customer list mixes names and addresses ("BAKWAS", "!!!...CHINAR BAGH"); Call History | Delivery is P2: customer as name / phone / address fields, dedupe by phone; caller ID later. Not 05. |

Added decision:

| # | Decision |
|---|---|
| G1-16 | **PRA live from day 1 (Q1 re-asked, M-15).** The pilot branch's fiscal setting is `PRA` at go-live, not `none`. Go-live preconditions (owner tasks, in the plan's pilot checklist, not code): PRA registration of the POS ID(s) for the POS floor (A1 decides how many), production token, a sandbox run passed, and the owner's / accountant's acceptance that only the POS floor reports to PRA while the rest of the restaurant stays on Mutfak (R20). If any precondition is missing on go-live day the branch runs on `none` and switches by setting later (no code change); the switch date is recorded with the setting change (audited). |
| G1-15 | **Tax is never chosen at the bill (M-4).** Each menu item has exactly one `tax_class_id` (01a S31, copied to the line, K-4); the rate comes from the authority table by (class, payment class, integration status, date) (K-15). The checkout screen has **no tax buttons**; nothing is pre-applied for staff to remove. A class's rate applies only to lines of that class; two classes are never added onto one line. Tax-exempt sale (if ever needed) is a menu / order-type setting, not a cashier action. Test: a bill with lines in two classes shows two tax rows, each on its own lines' base only. |
| G1-14 | **Sticky charges (M-3):** a bill-level charge (service charge now; delivery charge later) is written once by rule at bill creation (`ChargeApplied`) and removed by `ChargeRemoved` (permission + reason); the bill projection folds both; no read path, print, split, merge or reopen recomputes it from the rule. |

Q1 re-asked after M-15 and confirmed **live from day 1** (G1-16); no open owner facts.

## 8. Next

On "go spec": `docs/specs/05_Billing_Spec_v0.1.md` with `anthropic-skills:backend-spec-writer` (foundation §6 Shared Standards; §4.5 bumps for F, 01a, 01b, 01d, 02a, 02b, 03c, 04 at the next free numbers; new error codes in F §6.2; README row 05 and the R13 amendment), then STOP for the owner.

## 9. Owner answers on spec v0.1 OQs (2026-11-17 23:15 PKT)

Answers given 23:11–23:15 PKT on `docs/specs/05_Billing_Spec_v0.1.md` §12.3; folded into `docs/specs/05_Billing_Spec_v0.2.md` with "⚠️ Changed in v0.2 (OQ-n)" markers.

| # | Owner said | Ruling (v0.2) |
|---|---|---|
| OQ-1 | (a) | Reopen writes a new 02b event `OrdersUnbilled` (02b bump row Q-2); the orders return to unbilled; 02b adds and changes lines normally; the day-close guard sees them as unbilled. |
| OQ-2 | (b) | One spec, two plan phases (05-1 bills / payments / close / reopen / fiscal; 05-2 shifts / petty cash / drawer / day close / X / Z); no 05a / 05b split. The >30 endpoint budget exception is README **R38** with this reason. |
| OQ-3 | (b) | PRA token entered in a **hub admin page field** (`/admin/fiscal/`, `SetFiscalToken`), not a CLI. Gated by the new permission `manage-fiscal-settings` (Owner only by default, 01b bump row B-1 / B-2); write-only — never returned by any query or shown again (the page shows "set on <date>" only); replace = enter a new one; stored only on the hub (table `fiscal_credentials`; never synced, never logged, never in events); audit row `fiscal_token_changed` from `FiscalTokenSet`, ids only. |
| OQ-4 | (b) | Discount on the **whole bill only**, never per split. A bill with any closed split refuses a new discount (and its removal) with `409 BILL_PARTLY_PAID`; the discount must be set before the first split closes; spread pro rata over the lines (G0-5) before splitting. |
| OQ-5 | (a) | Amount / equal split = one invoice per split with lines allocated proportionally (`allocateDealMinor`, remainder to the last); stays subject to A8. |
| OQ-6 | owner rule (= (b) made simple) | A closed (paid) split is frozen; the bill's unpaid remainder stays open; any new line ordered after a split closed joins the open remainder automatically (no staff action); if every split is closed the bill is closed and a new item on that seating opens a **new bill** automatically; changing a closed split = reopen (Q8). Invariants: Σ closed splits + open remainder = bill lines; no line unit in two splits; a void / comp / remove / weight on units of a closed split → `409 LINE_IN_CLOSED_SPLIT` unless reopened (02b row Q-3, 04 row V-1). |
| OQ-7 | (a) | Approver for over-limit petty cash and shift variance = holders of `close-shift-for-others` (Manager, Owner by default); no separate setting. |
| OQ-8 | (a) | Buyer ID kept as long as the invoice; hub-only, never synced. |
| S-1–S-4 | no objection | Proposed bumps kept as written, marked "proposed, owner to confirm at approval". S-5–S-8 unchanged. |

New in v0.2: **STOP S-9** — 02a refuses a new round on a seating in NEEDS_CLEANING (after `BillClosed`), so "a new item on that seating opens a new bill" happens in practice only on a new seating, unless the owner asks for a 02a bump.

## 10. Owner answers on hostile run 1 (2026-11-17 23:49 PKT)

Questions Q-1–Q-5 of `docs/reviews/05_v0.2_hostile_run1.md`; applied to `docs/specs/05_Billing_Spec_v0.3.md` ("⚠️ Changed in v0.3 (H1-n, owner R-n)").

| # | Finding | Ruling |
|---|---|---|
| R1 | H1-1 (Q-1) | 01d bump (code): holders of `close-shift-for-others` (Manager, Owner by default) can answer `shift_variance` and every `petty_cash` request, whatever the requester's grant; never the requester. Row D-1 is a code row ("no 01d code change" was wrong); 01b row B-3 dropped; tests incl. the approver matrix. |
| R2 | H1-10 + S-9 (Q-2), answered 2026-11-17 23:58 PKT | **Reopen = full edit for every order type** (add lines, void / comp / remove, discount, payments), then close again (credit + new invoice number). Takeaway / parking: no lock; after `OrdersUnbilled` lines are added (a new order sharing the first order's token and `table_key`, 02b `adds_to_order_id`) and voided normally; cases before close (normal add / void) and after close (reopen → edit → close) written out with tests. Dine-in: `ReopenBill` also re-opens the seating (02a `SeatingReopened`, solution B) while its table has not been cleaned and no new seating / other open bill is on it, so `requireLock` passes as usual; otherwise the reopen is **corrections only** (void / comp / remove, discount, payments; adding lines → `409 TABLE_SEATING_CLOSED`); races vs `CleanTable` / `OpenTable` resolved by the state read in the reopen / answer transaction. **S-9 (b):** after a bill closes and before the table is cleaned, a new order on that seating is accepted (02a: `SubmitOrder` not refused by NEEDS_CLEANING; the `OrderPlaced` fold clears `bill_closed`) and opens a new bill automatically. |
| R3 | H1-5 (Q-3) | After any void / comp / remove the open part's frozen discount is capped to the open part's current pre-discount total (never above it, never negative), re-spread with the capped allocator; closed splits never change. |
| R4 | H1-9 (Q-4) | Day close is allowed with a carried-over bill that has payments; X and Z show a separate line "payments on open bills"; `RemovePayment` on a reopened bill may not touch a payment whose shift is closed or counted — money back comes from today's (the actor's) shift as an `out` payment; Z invariant: Σ takings = Z net + payments on open bills − paid earlier. |
| R5 | H1-16 (Q-5) | When the whole bill crosses the threshold after a split closed without buyer data, the buyer ID (or the approved waiver) is required from the next split close on; closed splits untouched. |

## 11. Answers on hostile run 2 (2026-11-18 08:38 PKT)

Questions Q-1–Q-5 of `docs/reviews/05_v0.3_hostile_run2.md`; applied to `docs/specs/05_Billing_Spec_v0.4.md` ("⚠️ Changed in v0.4"). Q-1 is the owner's own ruling; Q-2–Q-5 the owner answered "your call", so the developer took the review's Rec (**developer call, owner delegated**).

| # | Finding | Who | Ruling |
|---|---|---|---|
| Q-1 | H2-8 | owner | The frozen discount covers only the lines that were on the bill when the first split closed; lines that join later are full price. R3's cap and re-spread use only those lines still in the open part; B7 and R3 agree. |
| Q-2 | H2-13 | developer call, owner delegated | A round queued offline and replayed after the bill closed is refused (`TABLE_NEEDS_CLEANING`, as today); the device shows "bill closed — send again?"; a fresh resend is accepted and opens a new bill (S-9). |
| Q-3 | earlier-day takeaway reopen | developer call, owner delegated | Reopening an earlier-business-day takeaway (or parking) bill is corrections only; an addition is a new order today with its own bill. |
| Q-4 | H2-21 | developer call, owner delegated | A parking bill is keyed per plate per business day (`bill_key = 'parking:' + plate + ':' + business_date`); 02b's slip `table_key` is unchanged. |
| Q-5 | H2-5 | developer call, owner delegated | While a newer bill is open on the same takeaway / parking key, a reopen of the older bill is corrections only (the provisional v0.4 rule made final). |

## 12. Run 3 (targeted check of v0.4) — owner answer and notes (2026-11-18)

`docs/reviews/05_v0.4_targeted_check.md` (FIX: 0 blocker, 3 major, 3 minor, 3 nit); applied in `docs/specs/05_Billing_Spec_v0.5.md` ("⚠️ Changed in v0.5 (H3-n)").

| # | Finding | Who | Ruling / note |
|---|---|---|---|
| H3-1 (Q-1) | takeaway add-on token | owner, 2026-11-18 09:26 PKT, option (a) | A takeaway add-on **keeps the first (root) order's token**, as R2 said. 02b row Q-6: `orders_token` becomes the non-unique index `orders_token_day (business_date, token)` in hub migration `0021_orders_billing.sql`; `nextToken` stays `MAX + 1` for root orders only; the add-on keeps its own `table_key` (03a slip grouping unchanged) and the root's `bill_key`. The "adds to #<root token>" print is dropped. **Rule:** the token is a display identifier only; no code resolves token → order today (03b `kds/commands/ready.ts`, 03c `print/render/jobs.ts`, client Pass card, open-orders row, order view all read it by `order_id`); any future token search returns the bill or the latest open order of that token. |
| H3-2 | reopened PARTLY_PAID bill had no `bill_orders` | developer (review fix) | `BillReopened` carries the bill's `order_ids`, folded into `bill_orders`, so the reopen is full edit and keeps every line. |
| H3-3 | Z invariant for a carried PARTLY_PAID bill | developer (review fix) | Brought / carried forward count payments on **open splits** only; property test on both days. |
| H3-4 | residual base after comp + void | developer (review fix) | Line guard gets `comped_after` and `base_after_minor` from every caller and refuses a residual. |
| H3-5 | free text in events / alert values | developer (review fix) | `bill_texts(subject_id, …)` keyed by an id the command mints (`entry_id`, `payment_id`, `note_id`); written at raise on the approval path; no text in any event or `AlertRaised.values`. |
| H3-6 – H3-8 | dine-in `bill_key`, parking key text, `discount_line_ids` | developer (review fix) | `bill_key` takeaway / parking only (dine-in via `seating_orders`); parking `table_key || ':' || business_date`; `InvoiceIssued.discount_line_ids`. |
| H3-9 | rebase | developer | `spec-05` rebased on `origin/main` @ `049f6ce` (PR #236 merged; 04 at v1.0.5 on `main`); 05's version and migration numbers unchanged (04 → v1.0.6). |

## 13. Run 4 (targeted check of v0.5) — version numbers (2026-11-18)

`docs/reviews/05_v0.5_targeted_check.md` (FIX: 0 blocker, 2 major, 3 minor, 2 nit); applied in `docs/specs/05_Billing_Spec_v0.5.1.md`.

| # | Finding | Who | Ruling |
|---|---|---|---|
| H4-2 (review Q-1) | PR #237 (notification deep links) holds 02a v1.1.7, 02b v1.0.15, 03a v1.2.5, 04 v1.0.6, 01d v1.3 | **developer call, owner may veto** | **PR #237 lands first.** 05 takes the next free numbers after it: **02a v1.1.8, 02b v1.0.16, 03a v1.2.6, 04 v1.0.7, 01d v1.3.1** (re-scanned 2026-11-18: 4 open PRs and every branch; no other claim). F v1.14, 00 v1.12, 01a v2.6, 01b v1.10, 03c v1.0.11 and the migrations (hub 0021–0023, cloud 0016–0017) are unchanged. If the owner reverses the order, #237 renumbers instead (review option (b)). |
| H4-1, H4-3–H4-7 | reopen mode with the bill's own orders excluded; split guard on reopened bills; note keys; token call sites and the migration test; text | developer (review fixes) | as the review's smallest fixes; see spec §1.8. The README's R13 / milestone C "Amended by R37" markers are intended. |

**Run 5 (targeted check of v0.5.1, `docs/reviews/05_v0.5.1_targeted_check.md`), 2026-11-18 — developer call, owner may veto (H5-1):** PR #237 merged into `module-deeplinks`, not `main`, and that lane plans a further 01d text bump. 05 therefore applies its version bumps **only in its phase 0, after `module-deeplinks` (and anything else claiming those specs) has reached `main`**; phase 0 task 0 bases each bump on `main`'s text then and re-takes the next free numbers **without a STOP** (a pure renumber), updating 05 §4.5 and README row 05 in the same commit; only a content clash stays a STOP. The numbers in 05 v0.5.2 (01d v1.3.1, 02a v1.1.8, 02b v1.0.16, 03a v1.2.6, 04 v1.0.7, …) are **provisional**. H5-2–H5-5 are review text fixes (spec v0.5.2 §1.9); H5-5 adds `409 SHIFT_VARIANCE_PENDING` for a repeated `CloseShift` while its variance request is open (the first note stays).

## 14. Owner answers on hostile run 6 (2026-11-18 11:08–11:09 PKT)

Questions Q-1–Q-3 of `docs/reviews/05_v0.5.2_hostile_run6.md`; applied to `docs/specs/05_Billing_Spec_v0.6.md` ("⚠️ Changed in v0.6 (…, owner 2026-11-18 11:08–11:09 PKT)").

| # | Finding | Ruling |
|---|---|---|
| Q-1 | H6-5 | (a) The full CNIC / NTN prints **only on that customer's receipt** (the original and reprints of that invoice) when the authority requires it above the threshold; never on screens, check bills, X / Z, logs, events, alerts, audit rows or hashes; reprint access stays today's permission (`take-payment`). |
| Q-2 | H6-3 (owner's simpler model; changes the shift model) | **Counting closes the shift immediately and frees the drawer** (`CountShift` writes `ShiftCounted` + `ShiftClosed`). A variance above the threshold is recorded on the closed shift and raises a `shift_variance` request that only **signs it off**: approve → `approved`, reject → `disputed` (shown on X / Z); no recount, no reopen of the shift. The drawer is never held by a pending variance, and a pending sign-off never blocks the day close (it carries as "pending sign-off" on the Z). Approvers stay the holders of `close-shift-for-others`. The COUNTED state, reason `shift_counted`, `SHIFT_VARIANCE_PENDING` and `SHIFT_NOT_COUNTED` are dropped; `CloseShift` is only the `skip-blind-count` close. |
| Q-3 | H6-6 | (a) A fully refunded bill (reopened, every line voided / removed, Rs 0) closes with **no new invoice**: event `BillClosedEmpty`, state CLOSED, no `OrdersBilled`, no fiscal row, no receipt; the credit alone records it. Z: the credit counts as usual (Z net −its total), the money given back is `out` in takings, and a "full refunds" line shows the count and value. |

## 15. Owner answers on run 7 (2026-11-18 11:21 PKT, all Rec)

Questions of `docs/reviews/05_v0.6_targeted_check.md`; applied in `docs/specs/05_Billing_Spec_v0.6.1.md` ("⚠️ Changed in v0.6.1"). Run-7 Q-1 (add §14) is **moot**: §14 was already in this file at `7e35656`.

| # | Finding | Ruling |
|---|---|---|
| Q-2 | H7-2 | `print_jobs.payload` stores the CNIC / NTN masked to the **last 4** digits; the full number is filled in only when the job is sent (03c worker, 05 filler, never written back); a reprint of the receipt rebuilds the full number from the hub-only invoice record (`invoice_buyers`), not from the print queue. |
| Q-3 | H7-2 | The **credit note prints the last 4 only**; the full number goes to the authority inside the credit submission (read from the original's `invoice_buyers` row). |
| Q-4 | H7-1 | `disputed` is a **record only** — shown on X / Z and the shift history (who, when); no automatic deduction, block or follow-up. |

## 16. Run 8 (targeted check of v0.6.1) — owner `pro_rata` ruling and notes (2026-11-18)

`docs/reviews/05_v0.6.1_targeted_check.md`; applied in `docs/specs/05_Billing_Spec_v0.6.2.md` ("⚠️ Changed in v0.6.2").

| # | Finding | Who | Ruling |
|---|---|---|---|
| Q-2 | H8-2 (+ H6-12, H7-7) | **owner, 2026-11-18 11:36 PKT** | **Keep `pro_rata` and fix it now.** A split's tax under `pro_rata` depends **only on the amounts per payment class** (the declared / actual cash vs digital shares of the pre-tax base), **never on payment order, timing or any shift's state**. The cashier declares the digital share before the first payment (`DeclareClassShares`; a single-class first payment declares that class); once a payment is taken the declaration may move only within the unpaid part. At close Σ digital payments must match the declared digital part (with its tax), else `409 BILL_CLASS_SHARE_MISMATCH`, resolved by changing the unpaid part or adding / removing payments on still-open shifts; a payment on a closed shift is never removed or re-taxed. Card-then-cash and cash-then-card give the same tax; counting a shift changes nothing; a reopen re-taxes nothing already paid unless lines change. Property test: permuting payment order and closing shifts never changes tax. `BILL_PAYMENT_ORDER` dropped. |
| Q-1 | H8-1 | developer call per §14 / §15 intent | A sign-off shows on the X / Z of the day it is signed off ("variance sign-offs"); still-pending variances are listed as "pending sign-offs" on every X / Z until signed. |
| Q-3 | H8-3 | review Rec | Only payments on fiscalized order types need a PRA code (checked at `AddPayment` and at close); non-fiscalized order types take any mode. |
| Q-4 | label | — | The run-6 full-refund ruling (§14 Q-3) is "no new invoice" — the owner's words and what the spec built; in run 6 that was option **(b)**, so §14's "(a)" label is a slip; the spec's labels now read "Q-3 (b)". Behaviour unchanged. |

## 17. Owner ruling — jurisdiction-neutral core (2026-11-18 11:41 PKT)

The product is a SaaS sold across Pakistani provinces **and other countries**. PRA is only one plug-in adapter. 05's **core** is made jurisdiction-neutral **now, before the build** (05's money tables are migrations that cannot be edited after merge). **No other adapter is built**; the pilot still runs only the PRA adapter live. Applied in `docs/specs/05_Billing_Spec_v0.7.md` ("⚠️ Changed in v0.7 (J-n)", list §1.13). Every earlier ruling (§1–§16) stays final except where this one restates it.

| # | Ruling | Where in 05 v0.7 |
|---|---|---|
| J-1 | **Jurisdiction settings are data, per branch:** a seeded catalog plus owner overrides, like the rate table — authority / adapter key; currency (its minor-unit exponent comes from the currency, never a hard-coded 2); prices tax-inclusive or tax-exclusive; cash rounding rule (step, mode, applies to cash only or to all); buyer-ID threshold and accepted ID types; receipt fiscal fields; catch-up window; credit / return support. The Pakistan rows reproduce today's behaviour exactly. | B9, B31, §3.1, §3.15, row A-1, row F-6 |
| J-2 | **Taxes per line are a list:** an item has a tax profile (01a's tax class) → an ordered list of taxes, each with rate rows by payment class / date / integration status as today, simple or compound on the previous ones. Pakistan profiles have one tax, so G1-15 is unchanged in effect (no staff tax buttons, nothing pre-applied, never the Mutfak stacking); stacking exists only where the jurisdiction data define it (e.g. Canada GST + PST). **G1-15 restated:** taxes come only from the item's profile and the jurisdiction data, never chosen at the bill. The 01a / 02b rows change accordingly (the line carries a tax profile id; the rates come from the snapshot at payment, and each invoice keeps the rates it used). | B4, B5, §3.4–§3.6, rows A-1, Q-1 |
| J-3 | **Tax-inclusive pricing** is defined: back-calculation, rounding point, discount and service-charge order for inclusive vs exclusive, with property tests for both. | §3.5, tests #11, #11c |
| J-4 | **Buyer identification is generic:** `buyer_tax_id { type, value }`, the types from the jurisdiction data (CNIC, NTN, VAT number, …); every CNIC privacy rule of §14 / §15 (full value only on that customer's receipt and its reprints; last 4 in the print queue and on credit notes; never in logs, events, alerts, audit, Z, hashes or sync) applies to every type. | B19, §6.12, §5, test #43 |
| J-5 | **Payment mode → authority code map:** the single "PRA code" becomes a per-adapter code map on each payment mode; "a mode without a code is refused on fiscalized bills" is checked against the branch's adapter. | row A-1, §6.9, §6.12 |
| J-6 | **Adapter details leave the core:** credit invoice type, USIN / number formats, strict ordering per POS ID, catch-up values, token handling, field mapping and A1–A13 move to a separate **"Appendix: PRA adapter"**; the core describes only the port contract (submit sale, submit credit, health, answer shape, ordering capability flag, idempotency key) that any adapter implements. The `none` adapter stays. | §3.15, Appendix P |
| J-7 | **Words in core text:** authority / jurisdiction / buyer tax ID / fiscal number — not PRA / CNIC — except in the appendix and the Pakistan seed data. | B32 |
| — | **YAGNI:** only shape and data now; no second adapter, no locale / translation work, no multi-currency per branch beyond one currency per branch. Endpoint count kept (32 hub + 3 cloud). | §1.3, §12.2 |

Questions this raised (spec v0.7 §12.3, Rec applied provisionally until the owner answers): **OQ-9** currency per tenant (foundation §6 today) vs per branch — Rec keep per tenant, a branch's jurisdiction must match; **OQ-10** service-charge base under inclusive prices — Rec the back-calculated pre-tax net; **OQ-11** cash-only rounding with a mixed split — Rec round whenever any cash is involved.

**Answers on OQ-9–OQ-11 (owner delegated, 2026-11-18 11:59 PKT, "your calls") — developer call, owner delegated;** applied in `docs/specs/05_Billing_Spec_v0.7.1.md` ("⚠️ Changed in v0.7.1 (OQ-n)"):

| # | Ruling |
|---|---|
| OQ-9 | ~~**Currency per branch**~~ — **superseded by §18 Q-1 (owner, 2026-11-18 12:18 PKT): currency per tenant.** Original call kept: **Currency per branch**, not per tenant: one owner may run branches in different countries under one tenant. Cloud `branches.currency_code` (backfilled from `tenants.currency_code`, which stays as the default for new branches; 01a row A-6, foundation row F-6); each branch's jurisdiction must use that branch's currency; owner-level / cross-branch money views (06 / 07) group by currency and never sum across currencies. |
| OQ-10 | With tax-inclusive prices, the service charge is computed on the back-calculated pre-tax net (Rec). |
| OQ-11 | ~~superseded by §18 Q-2: only the cash part is rounded.~~ Original call kept: With a cash-only rounding rule, a split is rounded whenever any cash is involved (any cash payment, or none yet); only an all-digital split stays exact (Rec). |

## 18. Owner answers on hostile run 9 (2026-11-18 12:18 PKT, all Rec)

Questions Q-1 / Q-2 of `docs/reviews/05_v0.7.1_hostile_run9.md`; applied in `docs/specs/05_Billing_Spec_v0.7.2.md` ("⚠️ Changed in v0.7.2 (H9-n)").

| # | Finding | Ruling |
|---|---|---|
| Q-1 | H9-1, H9-10 | **Currency per tenant again: one tenant = one country / currency.** Supersedes the §17 OQ-9 developer call (its text kept, marked). 05's row A-6 and its backfill are dropped; foundation row F-6 says the currency is per tenant, with the minor-unit exponent taken from the currency; every branch's jurisdiction must use the tenant's currency (checked when a jurisdiction is chosen). An owner with branches in two countries opens a second tenant; a cross-tenant owner view is a later item (deferred, not 05). |
| Q-2 | H9-2 | Under a cash-only rounding rule **only the cash part is rounded**; card / digital parts are exact. Pakistan (round every bill to Rs 1) is unchanged. Supersedes the §17 OQ-11 call. |

## 19. Run 10 (targeted check of v0.7.2) — cash-only rounding dues (2026-11-18)

`docs/reviews/05_v0.7.2_targeted_check.md`; applied in `docs/specs/05_Billing_Spec_v0.7.3.md` ("⚠️ Changed in v0.7.3 (H10-n)").

| # | Finding | Who | Ruling |
|---|---|---|---|
| Q-1 | H10-1, H10-2 | **developer call following the owner's §18 Q-2 ruling ("card parts exact"); owner may veto** | Option (a). Under cash-only rounding the screen shows **two dues — the card (exact) due and the cash (rounded) due**. A card always pays exact amounts; rounding applies only to the cash part, and only once cash is paid, so an all-card split has no rounding line. Any payment order works: cash first, then the exact card balance; or card first, then the rounded cash balance. Cash amounts are multiples of the rounding step. Test #20b becomes a property test over random partial cash / card amounts and orders. Pakistan (round every bill to Rs 1) is unchanged. |
| H10-3, H10-4 | defaults | developer (review fix) | A `NULL` rounding step = no rounding in the catalog text too; with no billing settings the hub uses built-in rules equal to the `PK` seed for a PKR tenant and to the `none` seed (no rounding) otherwise. |
| H10-5, H10-6 | adapter config | developer (review fix) | No secret in `adapter_settings` (public config only); an adapter's keys and tokens are named credentials in the hub-only `fiscal_credentials`, like the PRA token. `base_urls` are keyed by adapter; pending rows and credits use the adapter recorded on the invoice. |
| H10-7, H10-8 | text | developer (review fix) | `seed-tenant` refuses an unknown ISO 4217 code (00 row H-5); stale text fixed. |

## 20. Run 11 (targeted check of v0.7.3) — cash refunds and the close rule (2026-11-18)

`docs/reviews/05_v0.7.3_targeted_check.md`; applied in `docs/specs/05_Billing_Spec_v0.7.4.md` ("⚠️ Changed in v0.7.4 (H11-n)").

| # | Finding | Who | Ruling |
|---|---|---|---|
| Q-1 | H11-3 | **developer call, owner may veto** | Option (a): **cash refunds round like a sale.** Under a cash-only rounding rule a cash refund is a multiple of the rounding step, rounded with the jurisdiction's mode (on its size), so a reopened bill never stays open at a sub-step amount (5.01 owed back → 5.00 in cash, 0.01 is the new invoice's rounding line). Card refunds stay exact. Pakistan (round every bill to Rs 1) is unchanged. |
| H11-1, H11-2 | close rule, `pro_rata` | developer (review's tested fix) | The split closes on balance 0, and a paid split shows card due 0. Under `pro_rata` the card due is the declared digital part minus card paid, and a declaration whose cash part rounds to 0 is refused. §16's "payment order never matters" still holds. |
| H11-4, H11-5 | credentials, text | developer (review fix) | One write-only admin field and one `fiscal-status` entry per credential name (PRA unchanged: one token). One shared seed constant; "card only" on the pad. |
