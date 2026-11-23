# STAB-7 proposal: a maximum delay per item, then priority

Status: **design agreed by the owner (2026-11-22: "alright man done!")**; the 03a spec text is 03a v1.2.8
(§3.5.7, PR-1–PR-8, tests 152–161, with STAB-6), **approved by the owner 2026-11-22 ("all recommendations approve start working on it")**, with 01a v2.7.4,
01c v1.1.3, 02b v1.0.24 and 03b v1.0.13; questions 9–14 answered with the recommendations; build plan `docs/plans/stab-6-7-plan.md`; design and owner questions in
`docs/plans/stab-6-batch-rounds-proposal.md` §10.

## 1. Owner request (2026-11-22)

"A count for a particular item that it can be pushed back by that much time, not more than that, and if that count
reaches it, increase its priority and send it to the KDS." Example: table A orders fish, karahi and BBQ, served
together; another table orders the same BBQ later — the earlier order must not be left waiting behind newer ones.

## 2. What the engine does today (03a v1.2.7)

- Waada Guard (default policy): every line has a deadline (latest start that keeps its order's promise); older lines are
  placed first and keep a cushion (`min_slack_keep_ms`); ties by `w × waiting`, `w = item weight_pct × order-type
  weight` (dine-in / takeaway / delivery / parking / follow-up branch settings) (§3.5.2–§3.5.4).
- A line is never placed past its deadline except by a boost or an overload (§3.5.6), where lateness is shared by
  weight and capped per item by `max_late_ms`.
- Not tracked: how often or how far a line has been pushed back; no automatic priority; nothing on the KDS says why a
  line jumped ahead or waits (a held "together" line looks like it is waiting when it is timed to land with its order).

## 3. Cooking patterns this must work for

| Pattern | Examples | Effect of a push-back |
|---|---|---|
| One-by-one on a free spot (slot) | wok, karahi stove, tawa, grill, sauté, griddle, pizza deck | waits for the next free spot |
| Rounds (batch) | tandoor, fryer baskets, steamers, bread oven | waits for the next round |
| From stock / hot-holding | degh curry, biryani, soup, haleem, rolls | plating only, rarely the bottleneck |
| Cold / assembly | salads, raita, desserts, drinks | quick |
| Long fixed cooks | slow roast, braise, paye, baked dishes | cannot be sped up or interrupted |
| Fragile after cooking | fries, naan, roti, tempura, fried fish, steak rest | must not be cooked too early |
| Fired on call | courses ("fire mains") | held until called |

Two facts hold for every pattern: (1) the push-back that hurts is the one that makes the customer's food later than
promised — many re-plan moves are harmless (a held line still landing on time), so a push-back **count** is the wrong
measure; (2) food already cooking is never interrupted.

## 4. The agreed rule

1. **Max delay (minutes)** per menu item, with a **branch default** (e.g. 5 min); empty on an item = the branch default;
   an item may have no limit.
2. **Delay** = how far the food's planned ready time has moved past the promise given when the order was placed: for a
   "served together" group the group's ready time, for an "as ready" line its own.
3. When the delay reaches the limit the line becomes **priority**:
   - slot stations: it takes the next free spot, ahead of every non-priority line;
   - batch stations: it goes first into the next round (with STAB-6's arrival-order rounds);
   - stock / cold items: front of the queue;
   - long cooks: if still waiting, it starts at the next chance; nothing already cooking changes;
   - KDS and Pass mark it **"Priority · n min late"**; the manager gets the existing late-order (slip) alert.
4. **Served together:** when one line of a group becomes priority, the group's not-yet-started lines become priority
   with it, so the whole meal comes out soonest.
5. **Fragile items** still respect "Can be ready early by" (`max_early_ms`): priority means "next free spot", never
   "cook now and let it wait at the pass".
6. The order-type weights stay; they order the lines that are not at their limit. The max delay is the hard safety net.
7. Nothing already cooking is pre-empted; priority only reorders waiting lines.

## 5. Where it lands (to be specified)

- 01a: `menu_items.max_delay_ms` (nullable) + branch default `max_delay_default_ms`; owner-app fields next to "Can be
  ready early by".
- 03a: the line keeps its first promise; re-plan ordering puts priority lines first (pass 1) and on batch stations into
  the next round first; the fires tick fires priority lines at the first free unit; the line carries a `priority`
  state for the screens.
- 03b: "Priority · n min late" on KDS and Pass rows.
- In the same 03a draft as STAB-6 (both change re-plan ordering), approved together, then built test-first.
