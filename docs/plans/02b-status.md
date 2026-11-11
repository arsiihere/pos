# 02b status board

Plan: `docs/plans/02b-plan.md` (27 tasks; hub in **parallel waves 0–4**, prompts in `docs/plans/02b-parallel-prompts.md`; wave 5 = client, blocked on the design handoff). Spec: `docs/specs/02b_Ordering_Spec_v1.0.3.md` (APPROVED; v1.0.3 = AD-11, owner 2026-11-10), on top of `main` `67c84c6` (02a hub merged, v1.1.4). Branch: `module-02b`.

> **Short Hinglish summary**
>
> **2026-11-10:** 02b ka plan likh diya, code abhi zero.
> - Hub: 24 tasks, 5 waves (0–4). Client: 3 tasks, design handoff ka intezaar.
> - G-1, G-2, G-3, G-7 ka faisla ho gaya (neeche). 02a `main` mein merge, `module-02b` `main` se dobara bana.
> - Agla qadam: wave 0.
>
> **2026-11-10 (wave 0):** tasks 1–5 ban gaye, gate green (3807 tests).
> - Task 4 ke review mein 3 contract signatures ghalat nikle (AD-8, AD-9, AD-10). Token string hai jabke spec INTEGER kehta hai (AD-7).
> - Wave 1 se pehle owner ka faisla chahiye: AD-7, AD-8, AD-10 (aur AD-9 wave 2 se pehle).
>
> **2026-11-10 (owner ke faisle):** AD-7 ke liye schema sakht kar diya; AD-8, AD-9, AD-10 contracts mein aa gaye; AD-11 ke liye spec v1.0.3 approve hui aur code theek ho gaya. Gate green (3812).
> - Review mein 2 aur khaliyan mili: AD-12 (hub ka UTC offset) aur AD-13 (serve ne kaun si lines serve kin). Wave 1 se pehle in par faisla chahiye.

## Task table

| # | Task | §11 step | Wave / lane | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| 1 | §9 error codes | 1 | 0 | NORMAL | **done (wave 0)** | `f024331` |
| 2 | `OrderContactSet`, `OrdersBilled`, `ZoneStockAdded`, `ZoneStockSet` | 2 | 0 | NORMAL | **done (wave 0)** | `ed359f3` |
| 3 | Migration `0013_orders.sql` | 3 | 0 | HIGH | **done (wave 0)** | `8ec74c0` |
| 4 | `orders/contracts.ts`, `index.ts` skeleton, test fixtures | — | 0 | NORMAL | **done (wave 0); contract fix waits on AD-8–AD-10** | `c2a05b1` |
| 5 | Zone kinds, `zoneAlertDrafts` | 15 | 0 | NORMAL | **done (wave 0)** | `81b365a` |
| 6 | Projection `orders` | 3 | 1A | HIGH | todo | |
| 7 | Exports `seatingTotals`, `orderLines`, `ordersOf` | 16 | 1A | NORMAL | todo | |
| 8 | Ledger `lineShares`, cascades | 4 | 1B | HIGH | todo | |
| 9 | Food rules `foodDrafts` | (9, 11, 13) | 1B | HIGH | todo | |
| 10 | `buildSubmit`, zone routing | 5 | 1C | NORMAL | todo | |
| 11 | `SubmitOrder` | 6 | 2A | HIGH | todo | |
| 12 | Zone-served submit | 7 | 2A | HIGH | todo | |
| 13 | `eta-preview` | 8 | 2A | NORMAL | todo | |
| 14 | `RemoveItems`, `lineChangeDrafts` | 9 | 2B | HIGH | todo | |
| 15 | `SetLineWeight` | 10 | 2B | NORMAL | todo | |
| 16 | `CompLine`, kind `comp` | 14 | 2B | HIGH | todo | |
| 17 | `MarkServed` | 11 | 2C | NORMAL | todo | |
| 18 | `ReleaseItems`, `BoostOrder` | 12 | 2C | NORMAL | todo | |
| 19 | `ReturnToKitchen` | 13 | 2C | HIGH | todo | |
| 20 | `AddZoneStock`, `SetZoneStock` | 15 | 2D | NORMAL | todo | |
| 21 | Queries, catch-up, audiences | 17 | 3A | NORMAL | todo | |
| 22 | Queued replays (02b's use) | 18 | 3B | HIGH | todo | |
| 23 | Handover card amount | — | 3C | NORMAL | todo | |
| 24 | Perf file, acceptance map, README rows | 22 | 4 | NORMAL | todo | |
| 25 | Client: queue and drafts | 19 | 5 | UI | **blocked (design handoff)** | |
| 26 | Client: ordering screen, options, preview | 20 | 5 | UI | **blocked (design handoff)** | |
| 27 | Client: table view orders, comp, zone stock, open orders, contact | 21 | 5 | UI | **blocked (design handoff)** | |

## G rows (gaps, owner ruling needed)

| # | Gap | Blocks | Options | Choice | Status |
|---|---|---|---|---|---|
| G-1 | Who wires `seatingTotals` into 02a's handover card (`amount`) | 23 | (a) 02a hook `registerSeatingTotals`, 02b registers it; (b) leave out until 05 | (a) 02a hook `registerSeatingTotals` | **ruled (owner, 2026-11-10)** |
| G-2 | Test-only edits to existing suites that list / count registered kinds, projections, audiences, commands, catch-up parts | none | (a) standing pre-approval, each noted in the wave entry; (b) STOP each time | (a) standing pre-approval, test-only, listed per wave | **ruled (owner, 2026-11-10)** |
| G-3 | `orders` projection registered in `lib/boot.ts` `createDeps` and `test/helpers/test-hub.ts` | 6 | (a) one append-only line + import each (02a SG-5) | (a) same as 02a SG-5 | **ruled (owner, 2026-11-10)** |
| G-7 | Base branch: merge `module-02a` into `main` first; re-cut `module-02b` from `main` or keep it on `module-02a` | wave 0 | owner | merged `67c84c6`; `module-02b` re-cut from `main` | **ruled (owner, 2026-11-10)** |

## AD rows

| # | Task | Reading | Status |
|---|---|---|---|
| AD-1 | 11, 22 | §3.2 `{ ...ctx, queued }` = 02a's `ctx.queuedAt !== null`; queued never takes or moves a lock (02a v1.1.3) | proposed (not yet ruled) |
| AD-2 | 22, 24 | #31: 02b writes only its own clauses; 00 clauses map to 00 tests 152–158 | proposed (not yet ruled) |
| AD-3 | 11, 17 | 02a #53 "order written" and 02a #62 are built here | proposed (not yet ruled) |
| AD-4 | 24 | #34 perf file written, not run; owner runs `pnpm test:perf` | proposed (not yet ruled) |
| AD-5 | — | 05 writes both `OrdersBilled` and `BillClosed`; note for 05 | proposed (not yet ruled) |
| AD-6 | 2, 21 | zone events on stream `table`, id `zone:`; no 02a reader sees them | proposed (not yet ruled) |
| AD-7 | 6, 11 | **Spec–code mismatch.** `OrderPlaced.token` is `z.string()` (02p `3db9ce1`), but 02b §5 has `token INTEGER` and §3.2 step 9 "1 + MAX(token)"; `car_type` is `z.string()` vs §5's CHECK. Options: (a) change the schema to `z.number().int()` / an enum (a Shared change, so do it before wave 1, as integrator fix commit); (b) keep string events; the projection stores `Number(token)` and `SubmitOrder` validates `car_type`. Recommendation: (b), because it changes no event schema that is already written; (a) only if the owner wants the event typed. | **ruled (owner, 2026-11-10): (a) tighten the schema** — `token` = `z.number().int().min(1).optional()`, `car_type` = `z.enum(['sedan','mini','large']).optional()`; `631b336` |
| AD-8 | 4 → 10, 11, 12 | **Contract.** `BuildSubmit(config, input)` can't do §3.2 step 4 (Off needs `item_availability`, out of hours needs hub `now`), `follow_up` (DB read), or routing by the seating's **primary** table (`seatingOf`). Zone candidates: does `proposed` include them or not (M-4 fallback)? Options: (a) add `ctx: { now; isAvailable; primary_table_id \| null; follow_up }`; `proposed` / `itemAdded` treat candidates as kitchen lines, and the caller drops the ones that pass the count and sets `served_from_zone_id`; (b) keep it as written, and lane 2A does those checks outside. Recommendation: (a). | **ruled (owner, 2026-11-10): (a)** — `f8b9e85`; amended by AD-12 (`876dfdc`) |
| AD-9 | 4 → 14 | **Contract.** `LineChangeDrafts(tx, …)` (§4.2 says `tx`) can't close stale comp requests with the caller's actor: `alerts.closeMany` needs an `AlertCtx`, and a bare `tx` forces `tickCtx` (actor null, device `hub`) into the audit log. Options: (a) `(ctx: CommandCtx, order_id, changes)` (ctx.tx is the tx; 02a `RequireLock` precedent), reading §4.2's `tx` as a name; (b) keep `tx`. Recommendation: (a). | **ruled (owner, 2026-11-10): (a)** — `f8b9e85` |
| AD-10 | 4 → 9 | **Contract.** `FoodDrafts` is pure but returns `EventDraft[]`, which needs `occurred_at` / `actor_id` / `device_id`. Options: (a) return envelope-less drafts `{ stream_type, stream_id, event_type, schema_version, payload }` (as engine `StockReservedDraft`, `ItemsReleasedDraft`), so the caller adds the envelope; doc says `lines` = the order's lines **after** the change; (b) keep it. Recommendation: (a). | **ruled (owner, 2026-11-10): (a)** — `f8b9e85`; amended by AD-13 (`876dfdc`) |
| AD-11 | 5, 20 | **Spec gap.** §3.10 closes `zone_stock_low` and `zone_stock_out` only when the count goes back **above** the threshold, so 0 → 1 (threshold 2) leaves `zone_stock_out` open. Built literally. Options: (a) keep it; (b) close `out` as soon as the count is > 0 (spec bump). | **ruled (owner, 2026-11-10): (b), spec v1.0.3 APPROVED** — `b9b3167`, `7273015`; code `602a7a4` |
| AD-12 | 4 → 10, 11, 13 | **Contract gap in the AD-8 ruling (fix B review, Critical).** S47 checks windows on **hub local time**. Both `isOrderableByTime(item, category, now, utc_offset_ms)` and `ITEM_OUT_OF_HOURS.opens_at_ms` need the hub's UTC offset. `BranchConfig` has no offset field, and `availability-windows.ts` says "never read from the runtime". The hub gets the offset from `hubTime(clock) → { now_ms, utc_offset_ms }`. Options: (a) add `utc_offset_ms: number` to `BuildSubmitCtx` (the caller passes `hubTime`); (b) replace `now` with `time: { now_ms; utc_offset_ms }` (the `hubTime` shape). Recommendation: (a). | **ruled (owner, 2026-11-10): (a)** — `utc_offset_ms` from `hubTime()`, never the runtime timezone; `876dfdc` |
| AD-13 | 4 → 9, 17, 19 | **Contract gap in the AD-10 ruling (fix B review, Important).** §3.7 says `OrderFoodServed` follows "every `ItemServed` that serves at least one food line". `FoodDrafts(order_id, lines, 'served')` gets only the lines after the change, so it can't tell which lines this `ItemServed` served. A failing case: a karahi is returned and its replacement is cooking, then a water is tap-served. The old karahi still has `served_at`, so the function would emit `OrderFoodServed` and the table would go green too early. Options: (a) `after: { kind: 'served'; order_item_ids: readonly string[] } \| 'change' \| 'return'`; (b) add a 4th parameter `served_ids`; (c) keep it, with a doc line. Recommendation: (a). | **ruled (owner, 2026-11-10): (a)** — `OrderFoodServed` only when the served ids include a food line (§3.3); `876dfdc` |
| AD-14 | 9 | `OrderFoodCleared.food_served` counts served food lines with no live filter: a void after the serve still gives `true` (task 9 review Important #1; spec silent; built literally) | **ruled (owner, 2026-11-11): keep as built** (text bump) |
| AD-15 | 6, 19 | Lane 1A STOP: `order_lines.return_of` has no event the projection may fold (`OrderLinesAdded` Fold "—"; `ItemReturned` remake only). Engine order is `OrderLinesAdded` → `ItemAdded` (03a placeholders), so an UPDATE at `OrderLinesAdded` finds no row | **ruled (owner, 2026-11-11): (A)** optional `return_of: string` on `ItemAdded` v1 (additive); task 19 writes it, the projection folds it from `ItemAdded`; `a3399b2` (also a types-only `Omit<ItemAddedPayload, 'return_of'>` in engine `plan.ts` `ProposedLine` for the name clash; opus review: behaviour-neutral) |
| AD-16 | 10, 11 | Lane 1C S-1: line `stock_draws` must be the day-frozen draws (01c V20, `dayDraws`); `BuildSubmitCtx` had no state | **ruled (owner, 2026-11-11): (a)** `BuildSubmitCtx.draws` resolver (item_id → `dayDraws`); `5d2773e` |
| AD-17 | 10, 14 | Lane 1C S-2: 02b says `422 VALIDATION_FAILED` (§4.4, §10 #1, §3.4, §3.5); foundation §6.2 / `errors.ts` = 400 | **ruled (owner, 2026-11-11): (a) keep 400** (foundation wins; text bump) |
| AD-18 | 10 | Lane 1C S-3: §6.1 `variant_id` has no meaning (01c V2: a variant is its own item) | **ruled (owner, 2026-11-11): (a) accepted and ignored** (text bump) |
| AD-19 | 10 | Lane 1C S-4: a deal outside its windows | **ruled (owner, 2026-11-11): (a)** `ITEM_OUT_OF_HOURS { deal_id, opens_at_ms }` (text bump) |
| AD-20 | 10 | Lane 1C S-5: a `kitchen_note` on a deal line lands on the header, which no slip shows | **ruled (owner, 2026-11-11): (b)** copied to every engine part (text bump) |
| AD-21 | 10, 11 | Lane 1C readings (task 10 review leftovers): deal parts in snapshot order, not `sort_order`; a weighed `from_zone` candidate cannot occur (01a A-1: zone stock items are piece); `isAvailable` = manual Off only, task 11 must not fold sold out into it; `order_note` of #2 tested in task 11 | **ruled (owner, 2026-11-11): accepted**; plan patch on task 11 |
| AD-22 | 9 | `isEngineLine` is not exported from `@pos/engine` (plan "Exact names" row wrong); task 9 copied it in `food.ts` | **ruled (owner, 2026-11-11):** re-export from `packages/engine/src/index.ts`, `food.ts` imports it (fix commit, opus review) |

## Owner rulings (this sprint)

| Date | Ruling | Where |
|---|---|---|
| 2026-11-10 | G-1 (a), G-2 (a), G-3 (a), G-7 re-cut from `main` | plan "Gaps — ruled" |
| 2026-11-10 | AD-7 tighten `OrderPlaced` `token` / `car_type` schemas; AD-8, AD-9, AD-10 accepted (one contracts commit); AD-11 spec change → 02b v1.0.3 APPROVED; the plan's migration-list path (`test/alerts/` → really `test/db/`) noted here, no plan edit | AD rows, "Next 02b text bump", Wave 0 entry |
| 2026-11-10 | AD-12 (a) `utc_offset_ms` in `BuildSubmitCtx`; AD-13 (a) `after: { kind: 'served'; order_item_ids } \| 'change' \| 'return'` | AD rows, "Next 02b text bump" |
| 2026-11-11 | AD-14 keep as built; AD-15 (A) `ItemAdded.return_of`; AD-16 (a) draws resolver; AD-17 keep 400; AD-18 ignore `variant_id`; AD-19 `{ deal_id, opens_at_ms }`; AD-20 (b) note to every engine part; AD-21 lane 1C readings accepted, plus a plan patch for task 11; AD-22 `isEngineLine` re-export. Test-only: the ledger comp-then-weight test starts from a weighed line; the property test never comps a weight-pending g line; in the fixtures, a g/ml deal part's quantity = part quantity × deal count (01c §3.4.2) | AD-14–AD-22, "Next 02b text bump", plan task 11 |

## Next 02b text bump

Readings already accepted in code that the next 02b text patch writes into the spec (owner, 2026-11-10):

- **AD-8:** §4.2 / §3.2 — `buildSubmit(config, input, ctx)` with `ctx: { now, isAvailable, primary_table_id | null, follow_up }` (+ AD-12 if ruled). Zone candidates are built as kitchen lines, and `SubmitOrder` removes the zone-served ones after the count check and sets `served_from_zone_id`.
- **AD-9:** §4.2 / §3.5 — `lineChangeDrafts(ctx: CommandCtx, order_id, changes)`; read the spec's `tx` as `ctx.tx`. The closes carry the caller's actor and device (02a `requireLock` precedent).
- **AD-10:** §4.2 / §3.3 — `foodDrafts` returns drafts without time / actor / device (`{ stream_type, stream_id, event_type, schema_version, payload }`), and the caller adds the envelope. `lines` = the order's lines after the change. AD-13: `after` = `{ kind: 'served'; order_item_ids } | 'change' | 'return'`; `OrderFoodServed` only when the served ids include a food line (§3.3).
- (AD-1 from the plan: cite 02a v1.1.3 in the header and §3.2 step 2.)
- **AD-14:** §3.3 / §3.5: `food_served` counts served food lines, including one voided after it was served.
- **AD-15:** 03a §4.2 (ItemAdded fields) and 02b §6.19 / §3.8: `ItemAdded.return_of?` is set on a return line's `ItemAdded` (fix and remake). 02b §5 folds it into `order_lines.return_of`.
- **AD-16:** §3.2 / §4.2: `BuildSubmitCtx.draws` takes the day-frozen draws from `dayDraws` (01c V20).
- **AD-17:** every mention of "422 `VALIDATION_FAILED`" becomes **400** (§4.4, §10 #1, §3.4 `gml_deal_part_partial`, §3.5 `units > live_units`).
- **AD-18:** §6.1: drop `variant_id` from the payload, or mark it "accepted and ignored".
- **AD-19:** §9: `ITEM_OUT_OF_HOURS { item_id | deal_id, opens_at_ms | null }`.
- **AD-20:** §3.2 / 01c §4.3 row: a deal's `kitchen_note` is copied to every engine part.

## Wave entries

*(one per checkpoint, newest last; same shape as 02a's)*

## Wave 0 — codes, events, migration, contracts, zone kinds (2026-11-10)

- **Tasks:** 1, 2, 3, 4, 5 (integrator, sequential).
- **Commits:** `f024331` (1), `ed359f3` (2), `8ec74c0` (3), `c2a05b1` (4), `81b365a` (5). No fix commits.
- **Reviews:** a fresh implementer and a fresh opus reviewer for each task. 1, 2, 3 and 5 were approved first pass. **4: "Needs fixes", with 3 Important findings, all plan-mandated contract signatures (AD-8, AD-9, AD-10).** These are not fixed here ("never accept your own reading"). The contract fix is one integrator commit **before wave 1**, once you rule. Task 2: there is one plan-mandated Important finding. Its stream asserts build an envelope and check it, and prove nothing (the registry has no stream, same as 02a). Ruling: no fix in 2. Task 20 asserts `stream_type 'table'` and `stream_id 'zone:'+zone_id` on the appended `ZoneStockAdded` / `ZoneStockSet`. `OrdersBilled` is written by 05 (AD-5).
- **Gate:** TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test". Result: 401 files (1 skipped), 3807 tests passed (1 skipped, 1 todo), 563 s wall. Green.
- **§12.2 rows ticked:** 12 (`zone_stock_low`), 13 (`zone_stock_out`), kinds only. Their #14 command clauses are in task 20.
- **Statement counts asserted:** `zoneAlertDrafts`: one `listOpen` per zone subject (task 5).
- **Tests closed:** `[02b #14 alerts]`, plus the `[02b §9]`, `[02b §6.19]`, `[02b §5]`, `[02b §4.2]` and `[02b fixtures]` support tests.
- **Also:** `apps/hub/test/db/alerts-migration.int.test.ts` adds `0013_orders.sql` to its pinned migration list. The plan's path `test/alerts/` was wrong, and the integrator corrected it. G-2 edits: none.
- **Fixtures (task 4):** `apps/hub/test/orders/fixtures.ts` provides `fixtureMenu()`, `openDay`, `openSeating`, `appendOrder` and `setZoneStock`. Each appends real events through the writer. `appendOrder` writes `token` as a string (AD-7).
- **AD rows (proposed):** AD-7 (token / car_type types), AD-8 (`BuildSubmit` context), AD-9 (`LineChangeDrafts` ctx), AD-10 (`FoodDrafts` draft shape), AD-11 (zone out-alert close).
- **Carried (minor, deferred):**
  - Task 2:
    - the five-schema test checks key sets only, not nullability;
    - `OrderContactSet` has no test for a missing `customer_name` or `order_id`.
  - Task 3: the migration test does not isolate CHECK `removed_units + voided_units <= units`.
  - Task 4:
    - add a doc line "readers convert 0/1 → boolean; never cast rows";
    - export `SubmitOption`;
    - the fixture deal header's `line_total_minor` ignores extras.
  - Task 5:
    - the label key is built from a string (add a drift test);
    - document "one direction per item per call";
    - §6.13 names `alert.zone_stock_out.lock` only implicitly;
    - no re-raise after a day-close expiry while the count is still low.

### Wave 0 — owner rulings applied (2026-11-10)

- **Commits:**
  - `631b336`: AD-7. `OrderPlaced.token` is an int ≥ 1 and `car_type` is an enum. The fixture writes an int token.
  - `b9b3167`: spec v1.0.3 (AD-11), its README row, and the plan's Spec line.
  - `f8b9e85`: AD-8–AD-10 contract signatures, plus the task-4 minors (doc line "readers convert SQLite 0/1 → boolean; never cast rows" and `SubmitOption` exported).
  - `602a7a4`: `zoneAlertDrafts` follows v1.0.3. Out closes above 0 and low closes above its threshold. New test `[02b #14 alerts] 0 → 1 closes out, low stays open while ≤ threshold`, plus the task-5 minors (label drift test, one-direction comment).
  - `7273015`: v1.0.3 §3.5. The zone-undo sentence now points to §3.10's rule. It still had the old wording; this is the same AD-11 ruling, and the fix C review found it.
- **Reviews:**
  - Fix A (AD-7): approved.
  - Fix C (AD-11): approved by opus. Minor: the "0 → 9 closes both" test relies on `listOpen` order.
  - Fix B (AD-8–10): opus "Needs fixes". It found two gaps in the ruled shapes, now **AD-12** (hub UTC offset for S47) and **AD-13** (which lines a serve served). These amend owner rulings, so they are proposed and not built. They block tasks 10 and 9. Fix B minors (deferred): `FoodDrafts` element type is broad; `zoneCandidates` has no `zone_id`; `SubmitInput` needs ids, so eta-preview has to mint them (a doc line for lane 2A).
- **AD-12, AD-13** (`876dfdc`): `BuildSubmitCtx.utc_offset_ms`; `FoodDrafts` `after` with served ids. Review approved (sonnet). Checks: `apps/hub/test/orders` 4 files and 19 tests passed; hub `typecheck` and `typecheck:tests` clean. There was no full gate; the wave 1 gate covers it (owner).
- **Plan path note:** the migration-list test is `apps/hub/test/db/alerts-migration.int.test.ts`. The plan says `test/alerts/`. Owner: noted here, no plan edit.
- **Gate:** TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test". Result: 401 files (1 skipped), 3812 tests passed (1 skipped, 1 todo), 544 s wall. Green.

## Next

1. **Claude Code:** wave 1. Lanes 1A (tasks 6, 7), 1B (8, 9) and 1C (10) are cut from `876dfdc`.
2. **Owner (any time):** AD-1–AD-6.
3. **Design (parallel):** `docs/design/handoff/02b/` from the screen list in plan wave 5.
