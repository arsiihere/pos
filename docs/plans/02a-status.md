# 02a status board

Plan: `docs/plans/02a-plan.md` (25 tasks, batches 1–5; batch 5 = client, blocked on the design handoff). Spec: `docs/specs/02a_Tables_Spec_v1.1.1.md` (APPROVED), on top of 02p (merged, `2fa2db0`). Branch: `module-02a`.

> **Short Hinglish summary — padhein yahan se**
>
> **2026-11-09 (raat):** SG-1–SG-6 ka faisla ho gaya (neeche "Owner rulings"). Hub ke saare 4 batches ab khule hain.
> - Hub: 20 tasks (naya task 1b: 02b / 05 ke events ki schemas). Client: 5 tasks, design handoff ka intezaar.
> - Baad ke kaam `docs/OPEN-QUESTIONS.md` §5 mein: zone wala assignment rule (01b), archive warning (01a), hub se table manage karna (nayi story).
> - Agla qadam: Claude Code mein batch 1.

## Task table

| # | Task | §11 step | Batch | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| 1 | Table event schemas | 2 | 1 | NORMAL | todo | |
| 1b | Schemas of folded 02b / 05 events (SG-2) | 2 | 1 | NORMAL | todo | |
| 2 | `TableState`, §9 error codes | 2 | 1 | NORMAL | todo | |
| 3 | Migration `0012_tables.sql` | 3 | 1 | HIGH | todo | |
| 4 | Projection `tables`, state fold, `reset` | 4 | 1 | HIGH | todo | |
| 5 | Lock activity fold | 5 | 1 | HIGH | todo | |
| 6 | Reads + 03a slip reader pair | 6 | 2 | NORMAL | todo | |
| 7 | `waiterTeam`, `table_team` / `zone_order_taker` resolvers | 7 | 2 | NORMAL | todo | |
| 8 | `requireLock` | 8 | 2 | HIGH | todo | |
| 9 | `OpenTable` | 9 | 2 | HIGH | todo | |
| 10 | Touch, Release, ForceRelease | 10 | 2 | NORMAL | todo | |
| 11 | Tick `table_locks` | 11 | 3 | HIGH | todo | |
| 12 | `closeHandover`, kind `table_handover`, `RequestTableHandover` | 12 | 3 | HIGH | todo | |
| 13 | `TakeOverTable`, `ForceMoveTable` | 13 | 3 | NORMAL | todo | |
| 14 | `MoveTable` | 14 | 3 | NORMAL | todo | |
| 15 | `MergeTables`, `registerMergeGuard` | 15 | 3 | HIGH | todo | |
| 16 | `SplitSeating` | 16 | 4 | HIGH | todo | |
| 17 | `RequestBill`, `CleanTable` (queueable) | 17 | 4 | NORMAL | todo | |
| 18 | Kind `call_waiter`, `CallWaiter` | 18 | 4 | NORMAL | todo | |
| 19 | Queries, catch-up, audiences | 19 | 4 | NORMAL | todo | |
| 20 | Client: login resume | 20 | 5 | UI | **blocked (design handoff)** | |
| 21 | Client: table map | 20 | 5 | UI | **blocked (design handoff)** | |
| 22 | Client: table sheet and dialogs | 20 | 5 | UI | **blocked (design handoff)** | |
| 23 | Client: banners, handover cards, offline | 20 | 5 | UI | **blocked (design handoff)** | |
| 24 | Client: Playwright flows | 20 | 5 | UI | **blocked (design handoff)** | |

## SG rows (spec gaps)

Full text: plan §"Spec gaps SG-1–SG-6 — ruled".

| # | Gap | Blocks | Options | Choice | Status |
|---|---|---|---|---|---|
| SG-1 | No public read of a **zone's** assignee for `zone_order_taker` / `zoneOf` (`StaffDirectory.zoneAssignee` private; `assignedOrderTaker` lets the table win) | 6, 7 | (a) use `assignedOrderTaker(table_id)`; (b) platform row adds `StaffDirectory.zoneOrderTaker(zone_id)`; (c) 01d text bump to (a) | Owner rule: a table inside a zone is never assigned separately (zone's tables = zone's order taker); 02a reads `assignedOrderTaker(table_id)`; 01b validation + 01d text later (OPEN-QUESTIONS §5) | **ruled (owner, 2026-11-09)** |
| SG-2 | Folded events not defined anywhere: 02b `OrderCancelled`, `OrderFoodServed`, `OrderFoodCleared`, `LineWeightSet`, `LineComped`; 05 `BillClosed` | 4, 5, 12, 17 (tests #13, #32, #33, #57, #58, #59) | (a) pull 02b §11 step 2's five schemas into 02a batch 1 + fix `BillClosed` v1 now; (b) mini platform batch first; (c) fold by name, move tests to 02b / 05 | (a); `BillClosed` v1 `{ seating_id }`, stream `table`; task 1b | **ruled (owner, 2026-11-09)** |
| SG-3 | Tests #53, #62 need 02b commands (`SubmitOrder`, `MarkServed`) | 8 (#53) | (a) #53 at `requireLock` level via a test-only command, #62 → 02b; (b) both → 02b | (a); #62 → 02b | **ruled (owner, 2026-11-09)** |
| SG-4 | Archived seated table on the map: V4 delivers active tables only, so no name / floor | 17 (#40 map part), 19 (#36 clause) | (a) `name = table_id`, "no floor" group; (b) V4 delivers archived tables (01a bump); (c) 02a keeps last known name / floor (new behaviour) | warning (01a owner app, later) + 02a safety net: "Archived tables" group, name = `table_id` | **ruled (owner, 2026-11-09)** |
| SG-5 | Projection must register before boot step 4 (`lib/boot.ts` `createDeps`) and in `test/helpers/test-hub.ts` — neither is in 02p §10 Acceptance | 4 | (a) allow one append-only line + import in each; (b) another registration point (00 change) | (a) | **ruled (owner, 2026-11-09)** |
| SG-6 | Registering the real resolvers / slip readers collides with 01d `registerFakes()` (throws) and 03a's "no readers" tests | 6, 7 | (a) register only if absent + 01d / 03a tests unregister / reset first; (b) `createTestHub({ tables: false })` for old suites; (c) module-load registration, fakes replace | (a) | **ruled (owner, 2026-11-09)** |

## AD rows

| # | Task | Reading | Options | Choice | Status |
|---|---|---|---|---|---|
| AD-1 | 8 | §4.2 "`ctx.queued`" (P-1b) = `ctx.queuedAt !== null` (`commands/registry.ts:31`) | — | as read | proposed (not yet ruled) |
| AD-2 | 9, 14–16 | "Archived table" = absent from `branchConfig()` tables (V4 has no table `is_archived`); unknown ids → same `404 TABLE_NOT_FOUND` | — | as read | proposed (not yet ruled) |
| AD-3 | 12 | `seatingTotals` (02b) absent → handover card leaves `amount` out; no stub | — | as read | proposed (not yet ruled) |
| AD-4 | 4 | `ItemServed` not in `tables.eventTypes` (P-1d; not in §3.3's activity list) | — | as read | proposed (not yet ruled) |
| AD-5 | 12, 18 | Kinds in `apps/hub/src/tables/kinds.ts`, loaded via `tables/index.ts` ← `server.ts` static import before boot step 4 | — | as read | proposed (not yet ruled) |

New rows get status **"proposed (not yet ruled)"**. The owner rules them in batches.

## Owner rulings (this sprint)

| Date | Ruling | Where |
|---|---|---|
| 2026-11-09 | SG-1: zone's tables belong to the zone's order taker; no separate table assignment inside a zone (owner rule; 02a reads `assignedOrderTaker`, 01b / 01d follow-up) | plan, OPEN-QUESTIONS §5 |
| 2026-11-09 | SG-2 (a), SG-3 (a), SG-5 (a), SG-6 (a) (developer's call, owner delegated) | plan tasks 1b, 4–8 |
| 2026-11-09 | SG-4: archive warning (01a, later) + 02a safety-net group (developer's call, owner delegated); on-site table management = new story | plan tasks 17, 19; OPEN-QUESTIONS §5 |

## Batch entries

*(one per checkpoint, newest last)*

```
## Batch N — <title> (<date>)

- **Tasks:** …
- **Commits:** `<sha>` (task), …
- **Reviews:** per task; HIGH by opus. Findings and fix commits.
- **Gate:** TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test" — <files>, <tests>, <wall time>.
- **§12.2 rows ticked:** …
- **Statement counts asserted:** …
- **Tests closed:** …
- **AD rows (proposed):** …
- **Carried:** …
```

## Next

1. **Claude Code:** batch 1 (tasks 1, 1b, 2–5) with the kickoff prompt in `docs/plans/02a-plan.md` §"Claude Code kickoff".
2. **Owner (any time):** AD-1–AD-5 (proposed readings).
3. **Design (parallel):** 02a handoff in `docs/design/handoff/02a/` from the screen list in plan batch 5; then a short plan patch for tasks 20–24.
