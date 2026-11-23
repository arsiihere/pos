# STAB-5 proposal: one kitchen line per unit on slot stations ("B2")

Status: **APPROVED (owner 2026-11-22: "yes start stab 5")**, with the §6 answers. Spec bumps per §4, then code, TDD.
below gets its own version bump (spec first), then the code, TDD.

## 1. Problem (owner reports, 2026-11-22)

1. **Per-unit times are not shown.** Karahi cooks in 20 min, the station cooks 4 at a time. An order of 5 is one line
   "×5", so all 5 show one time (40 min). The owner wants "4 ready in 20 min, the 5th in 40 min".
2. **A big line is pushed back without end (starvation).** 03a AD-4 places a line of `n` units as one block that needs
   `n` free units at the same moment (a line over capacity needs the whole station, for `ceil(n / cap)` rounds). On
   every re-plan a later, smaller line that fits the free units goes first.

Evidence (the real engine, `planOrder` + folds, scratch test, 2026-11-22; cook 20 min, capacity 4, minutes from the
first order):

| When | New order | Today's plan |
|---|---|---|
| 0 | A ×1, fired | 3 units free |
| 5 | B ×4 (one line) | B starts +25: waits for 4 free together, does not use the 3 free |
| 6 | C ×2 | C starts +6, **B pushed to +26** |
| 7 | D ×3 | D after B, **B pushed to +27** |
| 8 | E ×5 (one line) | needs the empty station: starts +68, ready +108 |
| 9 | F ×1 | F starts +9, **B pushed to +29** |

The same run with every unit as its own line: B's 3 units start at +5, its 4th at +25; C, D, E, F and a stream of
single orders follow **in arrival order**; nothing is pushed back. A split into capacity-sized chunks still pushed a
chunk of 4 back (any part bigger than one unit can wait for several free units at once), so the split is **per unit**.

Class: **(b) behaviour change** — the code follows 03a AD-4; the rule is wrong for a kitchen.

## 2. Decision proposed

**On `SubmitOrder`, a line with `quantity n > 1` whose item cooks on a slot station becomes `n` kitchen lines of 1 unit
each.** The engine is not changed: it already places one-unit lines fairly (above). The screens group the sibling
lines back, so staff and customers still see "Karahi ×5".

Not split (they stay one line, as today):

- items on a **batch** station (tandoor, fryer: loads already group units, 03a §3.3);
- **weighed** items (`sale_unit` g / ml, `requires_weighing`);
- **zone-served** lines (02b §3.10, served from zone stock, never on a station);
- **from-stock** lines are split like any other (each unit draws its own stock; the engine's stock times per line hold).

## 3. Rules

**3.1 Who splits.** The hub, in the `SubmitOrder` build step (02b §3.2), so every client gets the same result and the
ETA preview (`eta-preview`, same build) shows the same per-unit times. The cart line's `order_item_id` stays the
**first** part's id; parts 2…n get hub-minted ids (`ids.next()`, retries dedupe by the D32 `command_id`). The result
`lines[]` lists every part.

**3.2 Siblings.** Every part carries `part_of` = the first part's `order_item_id` (on the first part too). This is an
**additive optional field on `ItemAdded`** (v1, no upcaster; absent = not split, the precedent of 01c C-1 on
`ItemAdded`). Grouping on every screen is by `part_of`; two separate cart lines of the same item stay separate.

**3.3 Options and deal parts.** A parent's option children (01c §4.3) are scaled per unit today (`option_quantity ×
units`); each part gets its own children with `option_quantity × 1` (same rule, per part). A child on a slot station
is a split line like its parent; a child on a batch station (naan) is one child line per part — its station batches
them into a load as today. Plain options (`options_json`) are copied to every part. A deal is split per deal unit: each
deal part line follows the same rules.

**3.4 Prices and billing (05).** Each part is priced as one unit (`price × 1` + its options); the sum equals today's
line total exactly (integer minor units, D47). The **bill, receipt, Z / X reports and fiscal invoice group** parts by
`part_of` into one row "Karahi ×5 — Rs 5 750". Discounts / comps on a grouped row apply to its parts (05 decides the
per-part share; the rounding rule of 05 §3 applies per part, the sum stays exact).

**3.5 Kitchen screens (03b).**

- **KDS station view:** siblings in the same stage show as one row "Karahi ×3" with the stage; parts in different
  stages show as separate rows ("×3 cooking", "×1 waiting"). **Done on a grouped row marks one part** (each pot
  finishes on its own); a "Done all n" action marks every part of the row. Start likewise. **Owner 2026-11-22 (Q1 = b): Done (and Start) on a grouped row act on every part of that row at once** — one tap, all parts in that stage; parts in another stage are their own row.
- **Pass card:** one row per `part_of` with the count per stage ("3 done · 1 cooking"); the Ready pick sheet
  (03b v1.0.10) lists the group with a count stepper ("2 of 4").
- **Tickets / printing (03c):** one ticket row per group with its count, as today's "×n".

**3.6 Order screen and order view (02b).** The cart shows each line's per-part times: "4 ready ~20 min · 1 ready
~40 min" (from the preview's per-part `eta_ms`). The order view groups by `part_of`.

**3.7 Remove, void, return, serve (02b, 04).** Actions on a grouped row name **how many** ("Remove 1 of 4"); the client
picks the parts, latest stage first: not started → cooking → done (so the part furthest from ready goes first). The
commands are unchanged: they already take `order_item_id` (+ `units` ≤ 1 for a part). Voids and returns per part keep
04's audit per line.

**3.8 Engine (03a).** No code change. 03a gets a note: AD-4 (over-capacity rounds) now applies only to lines that are
not split (batch, weighed); a slot-station line has one unit.

## 4. Spec bumps (after the owner's OK)

| Spec | Version | What changes |
|---|---|---|
| 02b Ordering | v1.0.20 | §3.2 the split in the build step; `part_of`; result lists every part; §8 cart per-part times, order view grouping; §3.4 / §3.5 remove by count; tests |
| 01c Menu Variants | patch | §4.3 option children per part (`option_quantity × 1`) |
| 03a Timing Engine | v1.2.8 | note only: AD-4 applies to unsplit lines; no rule change |
| 03b KDS + Pass | v1.0.11 | grouped rows by `part_of` and stage; Done one / Done all; Pass counts; Ready sheet stepper |
| 03c Printing | patch | ticket rows grouped by `part_of` |
| 04 Voids + Audit | patch | void / return by count on a grouped row; parts picked latest stage first |
| 05 Billing | v1.0.33 | bill, receipt, reports, fiscal grouped by `part_of`; discount / comp share per part |
| 01a Restaurant Setup | patch | branch setting `show_part_times_to_customers` (default true), owner-app toggle (Q2) |
| `@pos/events` | — | `ItemAdded.part_of?: string` (additive, v1) |

One new hub migration (found while planning phase 1): `0026_order_line_part_of` adds `order_lines.part_of` (ADD COLUMN, no refold; no merged migration changes); grouping reads it. If 05's
fiscal invoice needs a stored group, that is decided in 05's bump.

## 5. Tests (to be numbered in each spec)

1. Engine scenario of §1 with split lines: B's 3 units fire at once, nothing is pushed back, arrival order kept, E ×5
   starts as units free (the starvation regression test).
2. `SubmitOrder` ×5 on a slot station → 5 `ItemAdded` with units 1, one `part_of`, first id = the cart's; on a batch
   station, a weighed item, a zone line → one line as today.
3. Option children and deal parts per part; prices sum to today's line total.
4. ETA preview lists per-part times; cart shows "4 ready ~20 min · 1 ready ~40 min".
5. KDS: grouped row per stage; Done marks one part, Done all marks the row; Pass counts.
6. Bill / receipt / Z group the parts into one row with the exact total.
7. Remove / void / return "1 of 4" picks the latest-stage part.

## 6. Questions for the owner — answered 2026-11-22

- **Q1 = b:** Done / Start on a grouped KDS row act on all its parts at once (§3.5).
- **Q2 = customers too, behind a setting, on by default:** a new branch setting (01a) **`show_part_times_to_customers`**,
  default **true**. When on, the per-part ready times ("4 ready ~2:20 PM · 1 ready ~2:40 PM") are printed on the
  customer's takeaway token / receipt (03c, 05) as well as shown to staff; off → customers see only the order's
  promise. There is no customer display screen today; one belongs to the later screens feature
  (`docs/stories/screens-parking-qr-refined.md`) and will read the same setting. Adds 01a to §4 (branch setting,
  owner app toggle).
- **Q3 = a:** orders already open when this ships stay as they are.

Original questions:

1. **Done on a grouped KDS row:** one part per tap (recommended: each pot finishes on its own) with a "Done all", or
   all parts at once?
2. **Customer-facing time:** the order's promise stays "everything ready" (the last part). Per-part times show to staff
   only (recommended), or also on the takeaway token / customer screen?
3. **Orders already open when this ships:** left as they are (recommended), not re-split.

## 7. Out of scope

Batch-station loads, weighed items, zone stock, and any change to the engine's placement rules.

## 8. Serve choice at send (owner 2026-11-22: option C, "Ok")

Each kitchen line already carries `serve_mode` ('sync' = served together, 'immediate' = as ready), copied from the
menu item. The waiter can now choose it when sending:

- **Order switch** next to Send: "Serve: Together / As ready". It starts at the lines' menu settings; when they differ
  it shows "Mixed" until tapped. Setting it sets every line that has no override.
- **Line override** inside the line's edit sheet only (with options and the note), never on the cart row; an
  overridden line shows a small badge. **A line override always wins**; changing the order switch never clears it.
- `SubmitOrder` gains optional `serve_mode` on the order and on each line (additive); the hub copies the chosen mode
  to the line's `ItemAdded.serve_mode` instead of the item's. No engine change, no migration.
- Shown to the kitchen (KDS / Pass mark the mode) and the customer (slip: "Served together ~2:40" or the per-part
  times, under `show_part_times_to_customers`).
- Per-part ready times differ only for "as ready" lines; "together" lines of an order land together (03a sync groups).

Specs: 02b (payload, §3.2, order screen), 03b (mode on KDS / Pass), 03c / 05 (slip text).
