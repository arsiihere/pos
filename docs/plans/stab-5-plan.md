# STAB-5 plan: one kitchen line per unit on slot stations

Source: `docs/plans/stab-b2-unit-split-proposal.md` (APPROVED, owner 2026-11-22). One local branch, no push
(owner rule). Each phase: spec bump first, failing tests, code, gate green, commit per task.

## Phase 1 — the split on the hub (02b v1.0.20, `@pos/events`)

1. `ItemAdded.part_of?: string` (additive at v1, no upcaster; absent on an unsplit line). Events test.
2. `buildSubmit` expands a cart line before it is built: `line_kind 'item'`, `quantity n > 1`, sale unit `piece`,
   not `requires_weighing`, not a zone candidate (`from_zone`), routed station (`routeOf`) of type `slot` →
   `n` lines of quantity 1. Ids: part 1 = the cart's `order_item_id`, part k = `<id>-p<k>`; a linked option's
   child likewise `<child id>-p<k>`. Every part (and every part's child) carries `part_of` = part 1's id (a child:
   part 1's child id). Prices, stock draws and children per unit by the existing rules. Deal lines are not split in
   phase 1 (phase 5).
3. `requireIdsFree` checks the derived ids too (`<id>-p2…pN` for every line with quantity > 1; a superset, same
   statement).
4. `eta-preview` gets the same build, so its `lines[]` lists every part with its own `eta_ms`; the submit result
   likewise.
5. Engine regression test (03a, test only): the §1 scenario of the proposal with split lines — no line pushed back,
   arrival order kept.

## Phase 2 — order screen and order view (02b)

Cart: per-part times "4 ready ~2:20 PM · 1 ready ~2:40 PM" from the preview; order view and open-orders group parts by
`part_of`; remove by count (latest stage first).

## Phase 3 — KDS, Pass, tickets (03b v1.0.11, 03c)

Grouped rows by `part_of` and stage; Start / Done on a grouped row act on all its parts (owner Q1 = b); Pass counts and
the Ready sheet with a count; ticket rows grouped.

## Phase 4 — voids and returns (04)

Void / return by count on a grouped row; parts picked latest stage first.

## Phase 5 — deals

A deal line with quantity n whose parts cook on slot stations: split per deal unit (n deal lines of quantity 1, each
with its parts); deal price allocation per unit, the sum exact.

## Phase 6 — bill, receipt, reports, customer times (05, 01a, 03c)

Bill / receipt / X / Z / fiscal group parts by `part_of`, exact totals; branch setting
`show_part_times_to_customers` (default true) and the per-part ready times on the takeaway token / receipt.
