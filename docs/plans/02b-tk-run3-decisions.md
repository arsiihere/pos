# 02b-TK — run 3 fix decisions (binding for every run-3 fix task)

Owner-approved 2026-11-25. The eight run-3 reviews (`docs/reviews/*_hostile_run3.md` on the `lane-02b-tk/review-*` branches) found the same few problems in several specs. Each fix task edits **only its own spec** but must apply these decisions **word for word in meaning**, so the specs agree. Where a decision and a review's suggested fix differ, this file wins. Rulings R1–R9 and OR-1–OR-7 (`02b-tk-rulings.md`) still hold.

## D1 — Boost keeps the pickup time (Q-PK-9), and scheduling ignores it

- A boost ("customer is here early") keeps `EngineOrder.pickup_at_ms` and `orders.pickup_at_ms`, and sets `boosted = true`. Nothing clears the pickup.
- **Effective scheduling pickup** = `boosted ? null : pickup_at_ms`. Every planning path uses it: preview, fold, boost, requeue, priority, later additions, the PR-4 pickup floor, the R4 hold (§3.5.8) and the held-slip set. After a boost no path may put the order back on hold.
- The held-slip set = sync groups + eligible immediate groups **only while the effective pickup is non-null**. A boost resolves a drinks-only held slip; an unresolved sync group stays open; no new held-drink warning is scheduled.
- A boost also releases the order's **own unfired held FIFO bookings** and rebooks them at their earliest feasible gap. Other orders' FIFO bookings stay fixed.
- **Readiness stays whole-order, held lines included**, boosted or not. A bag is never "Ready" while one of its lines (a drink, say) is still to make. Pass and counter show Ready only when every live line of the order is done.
- PK-1's numeric guarantee ("placements differ by at most the gap") is deleted; the gap and stored-promise rule stay. Add the boundary case to 03a test 180.
- Tests that say otherwise are rewritten: 03a 186 and 191, 03b 74 and 110, 02b 67, and Foundation v1.18 §4.7 (the boost paragraph). Engine state version v6 and replay rules still hold.

## D2 — Unpaid hand-over approval covers one order and one amount (owner: A)

- An approval of `RequestUnpaidHandover` covers **only the named order**, never sibling orders of the same token (an "add items" order needs its own approval).
- It covers **only the due at approval time** (store the approved amount). The effective approval ends when the bill closes or reopens, or when the order's due rises above the approved amount before hand-over. Then a fresh approval is needed. The original event stays for replay and audit; only the projection's effective approval clears.
- The hand-over check reads the due **fresh in the same transaction** and the actor's permissions at command time, never a cached value.

## D3 — The "due" formula

- **Due of an order / bill = Σ over its open splits of that split's balance** (the split's total − that split's net payments, the existing `balance_minor`). Closed splits contribute 0. Never "open total − bill-wide payments".
- Test: two Rs 500 splits, the first paid and closed, the second untouched → due Rs 500 (05 #60e). Also partial payment: one Rs 1,000 split with Rs 600 paid → due Rs 400.
- The check-bill paper and result show the **gross total** and the **remaining payable** as two separate fields.

## D4 — 05c is out of the pilot

- Nothing in the pilot depends on 05c: not its approval, its build, `when_none`, the `payment_*` alert kinds or `manage-payment-providers`. 01d defines a **pilot slice** that is approvable and buildable without 05c; the parked parts are moved to a "Parked with 05c" section, out of the version's acceptance and build lists.
- Specs that depend on 01d (02b TK-12, 01b B-5) depend on that pilot slice. 02b's migration note drops any 05c slot.

## D5 — Event versions for widened enums (D46)

- Adding `hand-over-unpaid` to the persisted permission enum carried by `AlertRaised` (and any other persisted enum a fix widens) is a **new event version with an identity upcaster**, registered in the event registry, with a replay test of the old version. 01b, 01d and 02b state the same version.
- Any new event (`CartCheckBillPrinted`, a point re-route event) is registered; a billing-audience event with no live recipient is registered with an always-false predicate and listed in 05 #91b.

## D6 — Migration numbers

- No reserved numbers. A migration takes the **next free contiguous number on `module-02b-tk` when its PR merges** (the runners refuse gaps). Today: cloud last 0021 → next 0022; hub last 0027 → next 0028. Specs name migrations `NNNN_<name>.sql`. Remove every `0130`–`0133`-style reservation.

## D7 — Archiving a Pass point re-routes its work (owner: B)

- A Pass point may be archived at any time. At archive, its **outstanding and returned lines move** to the point the normal routing would pick now among active points (order type, most specific wins, then fallback), in the same transaction, as a replay-safe event.
- The receiving Pass shows those lines marked "moved from <old point>".
- If no active point would receive them, the archive is refused with a validation error (an existing Foundation §6.2 code, unless none fits) telling the admin to activate another point first.
- Archive and routing edits bump the optimistic-lock version, and connected Pass screens learn the new routing (refetch) without a reconnect.

## D8 — Multi-point bag and the counter alert

- When a bag becomes incomplete again (undo, return or remake at any point), its counter "ready" alert closes and the R8 amber clock stops; both start again only when the **whole** order is ready. The amber clock never starts on a partial bag.

## D9 — Check bill before Send (cart / Due)

- One wire contract in 02b and 05: `PrintCartCheckBill { draft: { …, adds_to_order_id? }, printer_id? }`.
- An addition (`adds_to_order_id` set) uses the same guards as Send (type, business date, not cancelled; 404 unknown, 422 `CONFIG_REFERENCE_INVALID` with field `adds_to_order_id`) and applies `billAccess` to the referenced order. A plain draft stays scope-free.
- Effects on success: one print job, one `CartCheckBillPrinted` event (D5), one audit row. SQL budgets: copy 05's bounds into 02b TK-15 (routed ≤ 5, explicit printer ≤ 4, no route ≤ 2, addition + ≤ 5).

## How each fix task works

- Fix every BLOCKER and MAJOR of your spec's run-3 review, and the MINORs that are one-line wording fixes. Where a finding asks a change in another spec, write only your side and list the other side under "Needs in other specs" in your report.
- Keep the version number. Add a "Hostile run 3 fixes" table like the run-2 one: finding id → what changed → §. Mark each edit "⚠️ Changed by run 3 (<finding id>)".
- Do not edit code, plans or other specs. Do not run tests.
