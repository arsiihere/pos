# 02b status board

Plan: `docs/plans/02b-plan.md` (27 tasks; hub in **parallel waves 0–4**, prompts in `docs/plans/02b-parallel-prompts.md`; wave 5 = client, blocked on the design handoff). Spec: `docs/specs/02b_Ordering_Spec_v1.0.2.md` (APPROVED), on top of `main` `67c84c6` (02a hub merged, v1.1.4). Branch: `module-02b`.

> **Short Hinglish summary**
>
> **2026-11-10:** 02b ka plan likh diya, code abhi zero.
> - Hub: 24 tasks, 5 waves (0–4). Client: 3 tasks, design handoff ka intezaar.
> - G-1, G-2, G-3, G-7 ka faisla ho gaya (neeche). 02a `main` mein merge, `module-02b` `main` se dobara bana.
> - Agla qadam: wave 0.

## Task table

| # | Task | §11 step | Wave / lane | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| 1 | §9 error codes | 1 | 0 | NORMAL | todo | |
| 2 | `OrderContactSet`, `OrdersBilled`, `ZoneStockAdded`, `ZoneStockSet` | 2 | 0 | NORMAL | todo | |
| 3 | Migration `0013_orders.sql` | 3 | 0 | HIGH | todo | |
| 4 | `orders/contracts.ts`, `index.ts` skeleton, test fixtures | — | 0 | NORMAL | todo | |
| 5 | Zone kinds, `zoneAlertDrafts` | 15 | 0 | NORMAL | todo | |
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

## Owner rulings (this sprint)

| Date | Ruling | Where |
|---|---|---|
| 2026-11-10 | G-1 (a), G-2 (a), G-3 (a), G-7 re-cut from `main` | plan "Gaps — ruled" |

## Wave entries

*(one per checkpoint, newest last; same shape as 02a's)*

## Next

1. **Claude Code:** wave 0 with `docs/plans/02b-parallel-prompts.md` §3.
2. **Owner (any time):** AD-1–AD-6.
3. **Design (parallel):** `docs/design/handoff/02b/` from the screen list in plan wave 5.
