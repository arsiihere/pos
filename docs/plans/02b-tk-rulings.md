# 02b-TK Takeaway — owner rulings (24 Nov 2026, all confirmed)

Answers to the open questions of the 02b-TK backend audit (hand-off `docs/design/handoff/02b-tk/`, audit of `main` at `0c71cfa` against 00 v1.17, 00 HPA v1.12.4, 01a v2.10, 01b v1.11, 01c v1.4, 02b v1.0.24, 03a v1.2.10, 03b v1.0.15, 03c v1.0.15, 04 v1.0.8, 05 v1.0.34, 05a v1.0.6, 05b v1.0.1). These rulings bind every 02b-TK spec bump, plan and task. Where the hand-off (`GAPS.md`, frames) disagrees with a ruling or with the audit, the ruling wins, then the audit.

| # | Topic | Ruling | Lands in |
|---|---|---|---|
| R1 | Phone on takeaway | Phone **stays optional**. Every phone is normalised to **one canonical key** for matching (`0300…`, `92300…`, `+92 300…` → the same key); the digits **as typed** are kept for display. | 02b v1.0.25 §3.1, §5 (`phone_key`), customer-orders query |
| R2 | Unpaid hand-over | **No hub guard.** 05 B16 stays as approved. The client greys Hand over on a Due order. ~~A manager can override in the client.~~ ⚠️ Changed by owner ruling 2026-11-24 #2: **no client override in the pilot**; a Due order's Hand over stays disabled until paid, hint "Take payment first" (the override returns later as a request to the manager's own device, spec lane). **No `TAKEAWAY_UNPAID` code.** | Client (02b §8 note) |
| R3 | Contact on shared screens | Queue search (token / name / last 4 digits) runs **on the client** from the kiosk catch-up; **no contact fields on `open-orders`**. The TV board shows **tokens only, no names**. Held drafts shared per device **mask name and phone** for anyone without `view-customer-contact`. | Client; 02b §8 note; board spec |
| R4 | Pickup later | The **whole order** lands for the pickup time, including immediate / ready items (drinks wait too). Latest pickup = **end of the business day**. | 02b v1.0.25 (`pickup_at_ms`, `PICKUP_TIME_INVALID`); 03a bump (immediate lines wait for `pickup_at_ms`) |
| R5 | Customer status page | **In the pilot**: public LAN route with a **guest-network exemption**, **HMAC-signed** link, **in-memory rate limiter**. | 00 Hub Platform Access, Foundation (D28), 02b (§12.4 un-defer) |
| R6 | Printing | **No Urdu on any print** (PC437). On payment the receipt prints by default (as today). A **"Print check bill"** action is on the cart and the token view (`PrintCheckBill`). A **token slip** (English / Roman Urdu, with QR) prints **only for pay-later takeaway** orders. | Client (Print check bill); 03c v1.0.16 + 05 §3.16 (`takeaway_slip`) |
| R7 | Pickup board | The board is a **display session kind** (paired device, no person), **not a new device type**. | 00 Hub Platform Access, Foundation, 05a |
| R8 | Not collected | **Reuses `ready_window_ms`** (no new setting): 1× → alert the counter again, 2× → alert the manager; the ready tile turns **amber at 1×**. The takeaway ready alert must reach **the kiosks too**, not only the placer. | 03b v1.0.16 |
| R9 | Rush mode | **UI only**: dense layout + `top-items` query + setting `rush_open_orders` (default 15). **No kitchen behaviour change.** | Client; 02b v1.0.25 (`top-items`); 01a v2.11 (setting) |

## Audit corrections the build follows (over the hand-off)

- A **zone "Now"** is wrong on a takeaway tile: zone stock never serves takeaway (`apps/hub/src/orders/build-submit.ts:73`).
- A **pre-cooked** (stock-served) item shows its **reheat time** (`stock_time_ms`), not "Now"; "Now" only for a ready item or `stock_time_ms = 0`.
- The tile wait is an **estimate** (`stations-live` `wait_ms` + prep + cook (+ takeaway padding), 03a To-02 #9); the cart's eta-preview stays the promise.
- Option quantity counts toward a group's `max_choices` (`packages/domain/src/menu-lines.ts:233`).
- After a takeaway bill closes, an addition opens a **new bill** on the same key (05 #44e); the UI reads `bill?order_id` with the token's **newest** order.
- The default Cashier lacks `mark-served` in code (01b v1.8.1 not landed, plan row H10): fixed first (Part A task 1).

## Work order

- **Part A (no spec bump):** A1 H10 Cashier `mark-served` + cloud backfill (next free number); A2 client-only bundle on what is built (audit §2). Plan: `docs/plans/02b-tk-plan.md`.
- **Part B (spec bumps, then STOP for owner review before code):** 02b v1.0.25, 03a, 03b v1.0.16, 00 Hub Platform Access + Foundation + 05a, 03c v1.0.16 + 05 §3.16, 01a v2.11, new 05c — each through a hostile review in a fresh session (`docs/reviews/`).
