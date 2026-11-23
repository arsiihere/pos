# Takeaway — brief (Phases 1–3, 24 Nov 2026)

## Phase 1 — as built (main, 24 Nov 2026)
- KioskHome = the generic open-orders card (All / Takeaway / Parking / Abandoned) plus a side panel. Its Takeaway and Parking buttons **skip** the details sheets (`TakeawaySheet`, `ParkingSheet`). A parking order from the kiosk is refused at Send (no plate).
- The live ETA preview exists (`eta-preview`, "All ready by"). "Times will be set when sent" appears when the preview fails, most likely because **no business day is open**.
- The token is minted at `SubmitOrder` (MAX + 1 per day). An addition keeps its root's token.
- `open-orders` drops an order once it's **billed**, so a pay-first order leaves the queue while it's still cooking.
- Leaving the order screen orphans the draft (saved, but unreachable: a new id every time, and Held lists only held drafts).
- Done and Hold navigate to `#/orders`, which is the **Parking** tab.
- Paying needs the Cashier tab. The Order view has no Pay and no Add items.
- The ready alert reaches only the placer, and only through 03b Pass Ready.
- Add-on quantity works only by tapping again (no stepper), up to `max_quantity`.
- The name chip signs you out in one tap.
- The hub already supports `pickup_at_ms` (03a D3), option quantities, `adds_to_order_id`, and closing a takeaway bill before it's served (05 B16).
- Card and Raast integrations are out of 05's scope (R7).

## Phase 2 — jobs (owner answers)
Mixed payment (the cashier decides). Bags are handed over by the cashier + packer or by the kitchen pass. Tokens are shouted and a TV is possible. Phone orders are common and taken at the kiosk. The jobs mapped: walk-in, "kitna time?", family order, mixed timing (paye now / karahi later), phone-ahead, pay first / later, rush of 15, calling tokens, "where is my order?", change after Send, refunds / voids, repeat customers, hand-over, never-collected orders, day / shift not open.

## Phase 3 — features (all in the pilot, owner 2026-11-24)
0. Basic fixes bundle. 1. Send in the background. 2. Send & pay + quick cash. 3. Queue until handed over with Due / Paid + search. 4. Pickup board + voice. 5. Ready → hand-over strip. 6. Phone-ahead pickup time. 7. "Kitna time" without a cart + time-delta reason. 8. Keyboard mode. 9. Rush mode. 10. Repeat by phone. 11. Split pickup. 12. Not-collected watch. 13. Companion suggestions. 14. QR status page. 15. Counter-facing display + Raast. 16. Packer / Pass takeaway filter.
