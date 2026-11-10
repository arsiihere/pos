# 02b status board

Plan: `docs/plans/02b-plan.md` (27 tasks; hub in **parallel waves 0–4**, prompts in `docs/plans/02b-parallel-prompts.md`; wave 5 = client, blocked on the design handoff). Spec: `docs/specs/02b_Ordering_Spec_v1.0.2.md` (APPROVED), on top of `main` `67c84c6` (02a hub merged, v1.1.4). Branch: `module-02b`.

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
| AD-7 | 6, 11 | **Spec–code mismatch.** `OrderPlaced.token` is `z.string()` (02p `3db9ce1`), but 02b §5 has `token INTEGER` and §3.2 step 9 "1 + MAX(token)"; `car_type` is `z.string()` vs §5's CHECK. Options: (a) change the schema to `z.number().int()` / an enum (a Shared change, so do it before wave 1, as integrator fix commit); (b) keep string events; the projection stores `Number(token)` and `SubmitOrder` validates `car_type`. Recommendation: (b), because it changes no event schema that is already written; (a) only if the owner wants the event typed. | proposed (not yet ruled); **blocks 6, 11** |
| AD-8 | 4 → 10, 11, 12 | **Contract.** `BuildSubmit(config, input)` can't do §3.2 step 4 (Off needs `item_availability`, out of hours needs hub `now`), `follow_up` (DB read), or routing by the seating's **primary** table (`seatingOf`). Zone candidates: does `proposed` include them or not (M-4 fallback)? Options: (a) add `ctx: { now; isAvailable; primary_table_id \| null; follow_up }`; `proposed` / `itemAdded` treat candidates as kitchen lines, and the caller drops the ones that pass the count and sets `served_from_zone_id`; (b) keep it as written, and lane 2A does those checks outside. Recommendation: (a). | proposed (not yet ruled); **blocks 10** |
| AD-9 | 4 → 14 | **Contract.** `LineChangeDrafts(tx, …)` (§4.2 says `tx`) can't close stale comp requests with the caller's actor: `alerts.closeMany` needs an `AlertCtx`, and a bare `tx` forces `tickCtx` (actor null, device `hub`) into the audit log. Options: (a) `(ctx: CommandCtx, order_id, changes)` (ctx.tx is the tx; 02a `RequireLock` precedent), reading §4.2's `tx` as a name; (b) keep `tx`. Recommendation: (a). | proposed (not yet ruled); blocks 14 (wave 2) |
| AD-10 | 4 → 9 | **Contract.** `FoodDrafts` is pure but returns `EventDraft[]`, which needs `occurred_at` / `actor_id` / `device_id`. Options: (a) return envelope-less drafts `{ stream_type, stream_id, event_type, schema_version, payload }` (as engine `StockReservedDraft`, `ItemsReleasedDraft`), so the caller adds the envelope; doc says `lines` = the order's lines **after** the change; (b) keep it. Recommendation: (a). | proposed (not yet ruled); **blocks 9** |
| AD-11 | 5, 20 | **Spec gap.** §3.10 closes `zone_stock_low` and `zone_stock_out` only when the count goes back **above** the threshold, so 0 → 1 (threshold 2) leaves `zone_stock_out` open. Built literally. Options: (a) keep it; (b) close `out` as soon as the count is > 0 (spec bump). | proposed (not yet ruled) |

## Owner rulings (this sprint)

| Date | Ruling | Where |
|---|---|---|
| 2026-11-10 | G-1 (a), G-2 (a), G-3 (a), G-7 re-cut from `main` | plan "Gaps — ruled" |

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

## Next

1. **Owner, before wave 1:** rule on **AD-7, AD-8, AD-10** (they block tasks 6, 9, 10) and AD-9 (blocks task 14). Then the integrator makes one contract-fix commit to `orders/contracts.ts` (and the fixtures, if AD-7 changes) before it cuts the lanes.
2. **Claude Code:** `wave 1` once those are ruled.
3. **Owner (any time):** AD-1–AD-6, AD-11.
4. **Design (parallel):** `docs/design/handoff/02b/` from the screen list in plan wave 5.
