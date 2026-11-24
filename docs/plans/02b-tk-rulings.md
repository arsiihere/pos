# 02b-TK Takeaway — owner rulings (24 Nov 2026, all confirmed)

Answers to the open questions of the 02b-TK backend audit (hand-off `docs/design/handoff/02b-tk/`, audit of `main` at `0c71cfa` against 00 v1.17, 00 HPA v1.12.4, 01a v2.10, 01b v1.11, 01c v1.4, 02b v1.0.24, 03a v1.2.10, 03b v1.0.15, 03c v1.0.15, 04 v1.0.8, 05 v1.0.34, 05a v1.0.6, 05b v1.0.1). These rulings bind every 02b-TK spec bump, plan and task. Where the hand-off (`GAPS.md`, frames) disagrees with a ruling or with the audit, the ruling wins, then the audit.

| # | Topic | Ruling | Lands in |
|---|---|---|---|
| R1 | Phone on takeaway | Phone **stays optional**. Every phone is normalised to **one canonical key** for matching (`0300…`, `92300…`, `+92 300…` → the same key); the digits **as typed** are kept for display. | 02b v1.0.25 §3.1, §5 (`phone_key`), customer-orders query |
| R2 | Unpaid hand-over | **No hub guard.** 05 B16 stays as approved. The client greys Hand over on a Due order; a manager can override in the client. **No `TAKEAWAY_UNPAID` code.** | Client (02b §8 note)  **Changed by OR-7 (owner, 24 Nov 2026):** the client override is gone; the unlock is a 01d manager request (`hand_over_unpaid`, 02b v1.0.25 §3.7a); no hub guard still. |
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

## Owner review of the Part B package (24 Nov 2026, final answers)

Every recommended default in "Owner decisions blocking approval" (`docs/plans/02b-tk-spec-status.md`) is **accepted**, except these, which bind like R1–R9:

| # | Topic | Answer | Lands in |
|---|---|---|---|
| OR-1 | Board voice (05a OQ-B3 / O-20, 00 OD-7) | **English only**, no Urdu clips. Numbers are composed from ~31 pieces (chime, "token number", one–nineteen, twenty…ninety, "hundred", "thousand"), so every token 1–2000 is spoken ("token number two hundred fifty seven"). | 05a v1.0.7 §8, 00 HPA v1.13 OD-7, F v1.18 stack row |
| OR-2 | Pass hands the bag to the customer (03b OQ-9 / 02b TK-Q12) | A Pass action **"Handed to customer"** on takeaway / parking cards sends `MarkServed` for the order's lines (collected, closes the Ready, clears the board). **Owner correction (24 Nov):** the Pass point is run by a dedicated person, so a **new default role "Pass"** (`run-pass`, `mark-served`, `reprint-ticket`; seeded and added to existing tenants by the same backfill, no existing role changed); **Cook keeps exactly its grants**; the action shows only for a person holding both `run-pass` and `mark-served`. The Pass→staff Handover is unchanged. | 03b v1.0.16 §3.4, 02b v1.0.25 §8, 01b v1.12 B-4 |
| OR-3 | Raast (05c) | **Out of the pilot.** Paymob SoftPOS card part kept (Q-B – Q-E as recommended); everything Raast in 05c §13 "Later". Card machine with a manual reference stays the fallback. | 05c v0.2 |
| OR-4 | `payment_unapplied` with no manager present (05c Q-E / 01d Q-37f) | Also sent to the **Owner** role. | 01d v1.3.7 §3.5 `when_none`, 05c D-1 |
| OR-5 | Check bill (03c / 05 D-7) | A check bill can be printed **any time until the bill is paid**: unsent cart → "NOT SENT YET — CHECK BILL" document job, no token, no bill on the hub; sent token with money due → `PrintCheckBill`; paid → "Print receipt again". | 05 v1.0.35 §6.3a, 03c v1.0.16, 02b §8 |
| OR-6 | Hardware | Board on an owner-provided PC (OD-2 kept); a router that gives guest Wi-Fi only the public status port (OD-5 kept). | `docs/plans/02b-tk-plan.md` "Before go-live" |
| OR-7 | Unpaid hand-over (replaces R2's client override) | The counter sends a **01d request** "Hand over unpaid token N" to holders of the new permission **`hand-over-unpaid`** on their own `listed` devices; a manager approves; Hand over unlocks for that order only. **Until it ships, a Due order cannot be handed over.** R2's "no hub guard" stays. | 02b v1.0.25 §3.7a, 01b v1.12 B-5, 05a v1.0.7 L-1, 01d v1.3.7 To 02b, 03b §3.4 |
