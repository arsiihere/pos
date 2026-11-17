# 05 Billing — G1 decisions (working record)

| | |
|---|---|
| Status | **G1 COMPLETE (owner, 2026-11-17 21:39 PKT, "all rec" on the re-asked items). Waiting for "go spec".** Working record of the G1 session (developer, 2026-11-17). §1 holds the owner's answers on G0 §6 (Q1–Q18) as given 2026-11-17 21:03 PKT; §2 the re-asked items and their final rulings (21:39 PKT); §3 the K rulings (all Rec, with the changes the Q answers force); §4 the decisions that follow; §5 the authority questions (A1–A7, open). |
| Base | `spec-05` rebased on `origin/main` @ `ea0ee00` (04 is on `main` via #220; 00 v1.11 via #224, Q-70). G0 = `docs/stories/05-g0.md` (`caf6289`, `4c1314b` after the rebase). Fiscal research = `docs/stories/05-fiscal-research.md`. |
| Supersedes in G0 | K-10 and K-11 are **stale** (04 is on `main`): spec task 0 takes the next free version numbers from `main` and every open branch, and bases on the 04 version on `main` (§3). Q3's "split by items / amount" and K-3's split model are replaced (§1 Q3, §3 K-3). Q8 (a) is replaced by (b) reopen. Q13 (a) is replaced by zone printing (§2). |

## 1. Owner answers on G0 §6 (2026-11-17 21:03 PKT)

| # | Owner said | Ruling |
|---|---|---|
| Q1 | b | **PRA adapter ships in the pilot** (Arif Chatkhara, Lahore). Port, outbox, rate table and adapter `none` are built either way (K-14). The owner registers the POS ID(s) with PRA and keeps the token outside the repo (§4 G1-12). |
| Q2 | "fixed nahi; banda call par takeaway kar deta 'main aa raha hoon'; check bill jo final nahi hota par us par sab hota hai; band bill ko reopen bhi karna parta hai" | **(a) widened.** (1) A takeaway / parking bill may close at any time after Send — before the food, after it, or when a phone-order customer arrives. (2) **Check bill** (pro-forma): prints items, prices, discount, service charge, tax and total at any time, any number of times, marked **"PROVISIONAL – NOT A TAX INVOICE"**; no invoice number, no fiscal call, no money event (an audit row only). (3) Reopen → Q8. |
| Q3 | "split payment ka matlab half bill cash, half online transfer" | **No bill split in the pilot.** One bill per seating (dine-in) or per order (takeaway / parking), paid by **one or more payments in different modes** (cash + online, cash + card, …). Splits by item / amount / "equally into N" move to a later version (§12 Deferred in the spec). Mixed-class tax → Q4. |
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
| K-1 | (a) 05's own money event **per invoice** (`InvoiceIssued`: number, lines, discount, service charge, tax by class, rounding, payments with `taken_by`, change); at close also `OrdersBilled` + (dine-in) `BillClosed`, one transaction. With Q3 there is one invoice per bill close; with Q8 a reopen writes `InvoiceCredited` (the credit) and, at the next close, a new `InvoiceIssued`. Foundation text: BILLED = `OrdersBilled`; reopen's effect on BILLED is decided in the spec (§4 G1-3). |
| K-2 | (a) `bill` stream (stream id = `bill_id`) for bill / payment / invoice / reopen / credit events; shift, petty cash, blind count on `shift`. Foundation bump + Zod enum. |
| K-3 | (a) **narrowed by Q3**: one bill per seating (dine-in) or per order (takeaway / parking), **no splits**; several payments per bill. 02a text row "last open bill" → "the bill closes" (text only). |
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
| G1-2 | **Payments** (Q3): a bill holds 1..n payments, each `{ mode_id, amount_minor, reference?, taken_by_staff_id, shift_id }`; Σ payments − change = bill total at close; change only from cash; a payment may be removed before close (permission + audit). |
| G1-3 | **Reopen** (Q8): `ReopenBill { bill_id, reason_code, note }` → `InvoiceCredited { credit_no, ref_invoice_no, … }` (a full credit of the original, queued in the fiscal outbox as PRA `InvoiceType 3` with `RefUSIN` once the original has a fiscal number — if the original is still pending, the credit waits behind it in order) and the bill is open again for edits (lines through 02b / 04 as usual, discount, payments). The next close issues a **new invoice number**. Credits are numbered in their own gap-free series. Money already paid stays on the bill as payments; any difference is paid or given back at the next close (a negative balance is paid out from the closer's shift). Reopen of a bill from an earlier business day is allowed; the credit and the new invoice belong to **today's** Z. 02b BILLED: the spec decides whether reopen writes an `OrdersUnbilled` (02b bump) or 05 keeps reopened orders outside 02b's billed set — STOP-level design point for the spec's §4.5. |
| G1-4 | **Takeaway close** (Q2): `CloseBill` for an order-scoped bill is allowed any time after the first Send; 04 then refuses a void on its lines (closed) — a later problem is a reopen (G1-3). |
| G1-5 | **Mixed-class tax** (Q4): rule `mixed_class_rule ∈ { higher_rate, pro_rata }` per authority row set, default `higher_rate`. Pro rata needs the digital share before payment: the cashier enters the digital amount(s) first, the system recomputes tax and total and shows them; cash then pays the rest. Rounding once, at the bill total (G0 rule). Property test: Σ tax by class = printed tax; pro rata and higher rate agree when one class only. |
| G1-6 | **Taken-by vs shift** (Q10): payment events carry both `taken_by_staff_id` (who) and `shift_id` (whose money). Cash on a kiosk with a drawer always lands in that drawer's open shift; a kiosk without an open drawer shift refuses cash (`SHIFT_NOT_OPEN`). A person taking payments on their own device (order taker, Q9) uses their own shift. Optional `HandoverCount` on the drawer shift (counted, variance recorded, shift stays open). |
| G1-7 | **Remove comp** (Q7): command and request kind `remove_comp` on an unbilled line; on approve writes 02b's new `LineCompRemoved` (02b bump, 02b owns the event and the ledger fold); 04's audit list gains the action. |
| G1-8 | **Petty cash** (Q15): events on the `shift` stream — `PettyCashAdvanced`, `PettyCashSettled`, `PettyCashOut`, `PettyCashIn`; categories in branch settings (01a bump); limit approval via kind `petty_cash`; open advances block nothing but are listed at shift close and on X / Z. Expected cash = float + cash payments − change − cash refunds / payouts − advances + settled change − cash-out + cash-in. |
| G1-9 | **Buyer ID** (Q18): threshold per authority as data (PRA Rs 50,000 excl. tax); applies to the bill's pre-tax total after discount; above it close needs `{ buyer_name, buyer_cnic_or_ntn }` or `buyer_id_refused` with an approved `close-without-buyer-id`; CNIC / NTN stored only in the invoice record handed to the adapter, redacted from every log, alert body, audit row and Z. No feature splits a sale to stay under the threshold. |
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

## 6. Next

On "go spec": `docs/specs/05_Billing_Spec_v0.1.md` with `anthropic-skills:backend-spec-writer` (foundation §6 Shared Standards; §4.5 bumps for F, 01a, 01b, 01d, 02a, 02b, 03c, 04 at the next free numbers; new error codes in F §6.2; README row 05 and the R13 amendment), then STOP for the owner.
