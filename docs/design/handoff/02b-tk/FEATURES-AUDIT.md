# 02b-TK Takeaway — backend audit prompt

Paste everything below the line into Claude Code at the repo root (with the hand-off at `docs/design/handoff/02b-tk/`).

---

You are auditing the **backend** (hub, packages, specs) against the new Takeaway design in `docs/design/handoff/02b-tk/` (read `CHANGES.md`, `GAPS.md`, `MAPPING.md` first). **Read only. Do not change any code or spec in this task.**

For **every feature below**, check the real code on `main` (`apps/hub`, `packages/*`, `apps/tablet`, `apps/client` only where a feature is client-only) and the latest spec in `docs/specs/`. The "Designer's belief" column was written from a read of the code on 24 Nov 2026. It may be wrong: **verify it, don't trust it.**

For each feature fill in:
- **Status:** `BUILT` (works today, no hub change) · `PARTIAL` (some of it exists) · `MISSING` (nothing).
- **Evidence:** file path + line, or spec § and version. For MISSING: where you looked.
- **What's left (backend):** commands, queries, fields, events, migrations, error codes, permissions, settings, audiences.
- **Spec to bump:** which spec, from which version (spec-first per CLAUDE.md).
- **Size:** S (< ½ day) · M (1–2 days) · L (3+ days or an outside dependency).
- **Risks / questions:** anything that clashes with an approved spec, privacy (§7), statement-count budgets, or the event-sourcing rules. STOP-and-ask items go here, not into code.

## Features

| # | Feature (design frames) | What the UI needs from the backend | Designer's belief |
|---|---|---|---|
| 1 | **Live "Ready by" before Send** (HomeKiosk, CartTimeDelta) | `GET /queries/eta-preview` per cart change; group promises; the reason a time moved (previous vs new reply) | BUILT. Confirm why the Gulberg kiosk shows "Times will be set when sent": is it `BUSINESS_DAY_NOT_OPEN` from eta-preview when no day is open? Reproduce it in a test |
| 2 | **Wait on every menu tile / "kitna time" with an empty cart** (TileStates, HomeEmpty) | Per-item current wait for a 1-unit order: `GET /queries/stations-live` + item cook times; "Now" for pre-cooked / zone stock | PARTIAL. stations-live exists (STAB-4). Is a per-item wait computable on the client from it, or does it need a small query? |
| 3 | **Name + phone captured on every takeaway** (HomeKiosk, PhoneInvalid) | `SubmitOrder.takeaway { customer_name, phone }`, `OrderContactSet` | BUILT on the hub (the client skips the sheet today). Confirm the phone rule (10–13 digits) and the +92 handling |
| 4 | **Phone-ahead pickup time** (PickupLater) | `SubmitOrder.pickup_at_ms`, in the eta-preview draft too; the engine lands the food at that time; name + phone required when it's set | PARTIAL. 03a `pickup_at_ms` exists (D3); 02b sends `null`. No payload field (GAPS G-2, G-3) |
| 5 | **Repeat the last order by phone** (PhoneRepeat) | `GET /queries/customer-orders?phone=` → name, order count, last 3 orders' lines; `view-customer-contact`; index on `orders(phone, placed_at)` | MISSING (G-4) |
| 6 | **Queue keeps an order until it's handed over** (HomeKiosk, ReadyTiles, QueueTablet) | `open-orders` keeps a takeaway that is billed but not yet handed over; row fields `bill {state, due_minor}`, `customer_name`, `phone_last4`, `lines_summary`, `ready_at`, `handed {n,m}`, `pickup_at_ms` | PARTIAL. `open-orders` drops billed orders (`billed_at IS NULL`); fields missing (G-1) |
| 7 | **Send in the background, token shown at once** (SentToast, SentQueued) | `SubmitOrder` result `token` + `groups[].promise_ms`; queue keeps offline orders | BUILT. Confirm the token comes in the result and in the `OrderPlaced` frame for the kiosk audience |
| 8 | **Send & pay / pay later, pay from any token** (PayCash, PayCard, PayDone, PayError, TokenDue) | `GET /queries/bill?order_id`, `AddPayment` (cash with `tendered_minor`, card with `reference`), `CloseSplit` → receipt; takeaway close before served | BUILT (05 B16). Confirm `bill?order_id` works for a takeaway root and for an addition, and the statement counts |
| 9 | **Card by NFC on the tablet (Paymob) + dynamic Raast QR (Bank Alfalah)** (PayNfcTablet, PayRaast, CustomerDisplayRaast) | Provider port, payment intent events, webhook / poll → automatic `AddPayment` with the provider reference, timeout / failed states | MISSING. Out of 05 scope (R7). Needs a new spec 05c + a 05b Capacitor plugin (G-12). Size L, outside dependency |
| 10 | **No unpaid hand-over** (HostileReview 1 & 3, TokenDue, PackerPass) | Hub guard on `MarkServed` / `Handover` when it would serve the last live lines of an unpaid takeaway → `409 TAKEAWAY_UNPAID { due_minor }`; override permission `hand-over-unpaid` | MISSING (G-7) |
| 11 | **Hand over / give ready items now / partial pickup** (TokenReady, TokenPartial, HandoverUndo) | `MarkServed` with ids (subset = partial); Pass `Handover` counts too | BUILT. Confirm takeaway scope rules (`own_tables`, `branch`) for a cashier who didn't place the order |
| 12 | **Ready signal to the counter** (ReadyTiles, Board) | `ReadyToServe` / `ItemDone` frames reach the kiosk; `ready_at` per order | PARTIAL. The alert goes only to the placer (03b §3.5 step 4). Does every kiosk get the frames? `ready_at` missing (G-1) |
| 13 | **Not-collected watch (15 min)** (TokenLate) | `ready_at` + branch setting `takeaway_uncollected_ms`; `order-contact` for Call | MISSING setting; contact BUILT (G-17) |
| 14 | **Add items to a sent token** (TokenAddItems) | `SubmitOrder { adds_to_order_id }` keeps the token and joins the bill | BUILT (05 row Q-6). Confirm it after the root is paid (new bill vs reopen rules) |
| 15 | **Remove / cancel from a token** (TokenRemove) | `RemoveItems` (not started), `VoidItems` with approval (04), the bill follows; refund after pay | BUILT. Confirm the error codes the UI must map |
| 16 | **Pickup board on a TV + Urdu voice call-out** (Board, BoardCall, BoardRush, BoardEmpty, BoardOffline) | 05a screen key `board` (display-only session), route `/board/`, `GET /queries/pickup-board`, a live audience with ids-only frames, recorded number clips 1–999 | MISSING (G-8, G-9) |
| 17 | **Packer / Pass takeaway filter, Bag ready, Due on the card** (PackerPass) | 03b `pass` query filter by order type, `MarkReadyToServe`, bill state per order | PARTIAL. The Pass exists; filter and bill state missing (G-19) |
| 18 | **Customer status page from the slip QR** (StatusCooking, StatusReady, StatusUrdu) | Public LAN route `/t/<order_id>.<hmac>`, no session, read-only, rate-limited; token, stages, ~time, items | MISSING (G-10). Security review with 00 Hub Platform Access |
| 19 | **Token slip (80 mm) with big token, ~ready time, Urdu line, QR** (TokenSlip) | 03c doc `takeaway_slip`, printed on Send; merged with the receipt when paid at Send | PARTIAL. The receipt prints ready times (05 v1.0.33); no slip doc, no QR to the status page (G-11) |
| 20 | **Counter-facing customer display** (CustomerDisplay) | None for the cart mirror (client-only, BroadcastChannel); Raast state from #9 | BUILT for the hub side (client-only, G-14) |
| 21 | **Rush mode + "most ordered this hour"** (HomeRush) | Open takeaway count (from #6); `GET /queries/top-items?minutes=60&order_type=takeaway`; setting `rush_open_orders` | PARTIAL. Count yes; top-items query and setting missing (G-15) |
| 22 | **Add-on quantities (karahi + 4 naan)** (ItemSheet, DealSheet) | `SubmitOrder.lines[].options[].quantity`, option `max_quantity`, group `max_choices` | BUILT. Confirm the eta-preview and bill money for option quantity > 1 |
| 23 | **Companion suggestions ("+4 naan" under half karahi)** (CartSuggest, ItemSheet hint) | Menu config `companions: [{ item_id, quantity }]` per item / variant in the snapshot + owner UI | MISSING (G-5) |
| 24 | **Keyboard short codes ("hk" = half karahi)** (KeyboardMode) | Optional `short_code` per item / variant in config, else client fuzzy match | MISSING, optional (G-18) |
| 25 | **Held orders per counter (not per person) + leave guard + auto-hold on sign out** (HeldDrawer, LeaveGuard) | Device drafts only | Client-only (G-6). Confirm no hub piece, and whether 02b §8's ruling needs a spec bump |
| 26 | **Hand-over Undo (5 s)** (HandoverUndo) | None if the client delays `MarkServed` 5 s; else an `UndoServed` command | Client-only (G-16). Confirm `MarkServed` has no undo today |
| 27 | **Offline: queue orders, block payment** (HomeOffline, SentQueued, PhoneOffline) | `SubmitOrder` and `MarkServed` queueable; `AddPayment` not | BUILT. Confirm the queueable list; note whether a queueable cash `AddPayment` is even possible under 05 rules (G-13, later) |
| 28 | **Day / shift blocked before the first item** (DayNotStarted, ShellAnatomy) | Business-day state in the catch-up, `BusinessDayOpened` frame; `GET /queries/shift` for the cashier's own shift | BUILT? Confirm the catch-up carries the open day and that AddPayment refuses with no open shift (which code) |
| 29 | **Shell: person menu (Switch user, Lock, My shift, Sign out), tab active state, Live / Offline / Rush pill, Requests / Inbox counts** (ShellAnatomy, PersonMenu) | Session logout, switch-user flow (05a), alerts counts | BUILT. Client-only changes; confirm the switch-user flow exists in 05a code |
| 30 | **Search the queue by token / name / last 4 phone digits** (HomeKiosk) | Name and `phone_last4` on the kiosk's open-orders rows, privacy-scoped | MISSING fields (part of G-1); check §7 privacy |

## What I want back

1. The table above with your five columns filled, one row per feature, no row skipped.
2. **Already done:** list the BUILT rows, so we know what the UI can use straight away.
3. **Left to build:** the PARTIAL + MISSING rows grouped by spec (02b, 03a, 03b, 03c, 05, 05a, 05c new, 01a / 01c, 00), each with its spec bump, fields / endpoints / events / migrations / error codes, and size.
4. **Build order** for the 28 Feb 2027 pilot: dependencies first (G-1 before the board and rush mode, etc.), with outside dependencies (Paymob, Bank Alfalah) flagged early.
5. Anything in `GAPS.md` that is **wrong** (already exists, named wrongly, or clashes with an approved spec): say so with evidence.

Then STOP and wait for my go before touching any spec or code.
