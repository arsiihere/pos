# 02a status board

Plan: `docs/plans/02a-plan.md` (26 tasks; hub built in **parallel waves 0–3**, prompts in `docs/plans/02a-parallel-prompts.md`; batches 1–5 as fallback; batch 5 = client, blocked on the design handoff). Spec: `docs/specs/02a_Tables_Spec_v1.1.2.md` (APPROVED; v1.1.2 = §3.4 re-sign-in, owner 2026-11-09), on top of 02p (merged, `2fa2db0`). Branch: `module-02a`.

> **Short Hinglish summary — padhein yahan se**
>
> **2026-11-09 (raat):** SG-1–SG-6 ka faisla ho gaya (neeche "Owner rulings"). Hub ke saare 4 batches ab khule hain.
> - Hub: 20 tasks (naya task 1b: 02b / 05 ke events ki schemas). Client: 5 tasks, design handoff ka intezaar.
> - Baad ke kaam `docs/OPEN-QUESTIONS.md` §5 mein: zone wala assignment rule (01b), archive warning (01a), hub se table manage karna (nayi story).
> - Agla qadam: Claude Code mein batch 1.

## Task table

| # | Task | §11 step | Batch | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| 1 | Table event schemas | 2 | 1 | NORMAL | **done (wave 0)** | `68fb020` |
| 1b | Schemas of folded 02b / 05 events (SG-2) | 2 | 1 | NORMAL | **done (wave 0)** | `635c73c`, `ad8b1f1` |
| 2 | `TableState`, §9 error codes | 2 | 1 | NORMAL | **done (wave 0)** | `00dd526` |
| 3 | Migration `0012_tables.sql` | 3 | 1 | HIGH | **done (wave 0)** | `4bf9f94` |
| 3b | `tables/contracts.ts`, `index.ts` skeleton (parallel waves) | 6–8 | wave 0 | NORMAL | **done (wave 0)** | `5b03f02`, `85a6688` |
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
| AD-6 | 6 | `zoneOf(table_id)` (§4.2, no directory parameter) reaches the directory via `currentDirectory(app)` captured in `registerTables`; signature unchanged (contracts.ts) | — | accepted with condition: `registerTables` captures a getter `() => currentDirectory(app)`, never the directory object; `zoneOf` reads it on every call; the `zone_order_taker` resolver keeps reading `alertDirectoryOf(tx)` | **ruled (owner, 2026-11-09)** |
| AD-7 | 3b | `SeatingRow.state = Exclude<TableState,'FREE'> \| 'CLOSED'`, `bill_closed: 0 \| 1`, `close_reason` literal union — the §5 CHECKs verbatim; `seatingOf().state` stays `TableState` | — | as read | **ruled (owner, 2026-11-09)** |
| AD-8 | 8 (lane 1B) | `requireLock` readings: `not_holder` error in the §9 shape; scope = the one table; `zoneOf` → `floor_id: ''` for a table absent from the config; `locked_by_name: null` when the holder is unknown | — | accepted as read; **change:** a queued call (`ctx.queuedAt !== null`) never takes **and never moves** a lock — the command proceeds, the lock stays where it is (task 8 fix on `module-02a`, test `[02a #60] queued replay does not move the caller's lock from his other device`) | **ruled (owner, 2026-11-09)** |
| AD-9 | 4, 5 (lane 1A) | `bindTablesProjectionLog` (live-only #55 log line bound in `registerTables`); `last_touch_at` refreshed by a non-holding device's event | — | accepted as is; plan "02a exports" notes `bindTablesProjectionLog`; #9's tick clause checked at the wave 1 checkpoint | **ruled (owner, 2026-11-09)** |
| AD-10 | 11 (lane 1C) | tick `table_locks` registered once per process, guarded by name; a table without an open seating has no entry | — | accepted | **ruled (owner, 2026-11-09)** |
| AD-11 | 11 (lane 1C) | Lane 1C blocker 1: §3.4 live session ignores a session that started after the lock's last activity | (a) spec bump; … | (a): spec **v1.1.2** (`451e19d`) — `s.started_at <= l.last_activity_at` in `due` and `intents`; test 8 extended | **ruled (owner, 2026-11-09)** |
| AD-12 | 11 (lane 1C) | Lane 1C blocker 2: existing tick suites see the new `table_locks` tick | — | allowed (like SG-6): `test/alerts/tick-loop.int.test.ts`, `test/engine/fires-tick.int.test.ts`, `fires-alerts-tick.int.test.ts`, `kinds.int.test.ts` may call `unregisterTick('table_locks')` after `createTestHub`; tests only | **ruled (owner, 2026-11-09)** |

New rows get status **"proposed (not yet ruled)"**. The owner rules them in batches.

## Owner rulings (this sprint)

| Date | Ruling | Where |
|---|---|---|
| 2026-11-09 | SG-1: zone's tables belong to the zone's order taker; no separate table assignment inside a zone (owner rule; 02a reads `assignedOrderTaker`, 01b / 01d follow-up) | plan, OPEN-QUESTIONS §5 |
| 2026-11-09 | SG-2 (a), SG-3 (a), SG-5 (a), SG-6 (a) (developer's call, owner delegated) | plan tasks 1b, 4–8 |
| 2026-11-09 | SG-4: archive warning (01a, later) + 02a safety-net group (developer's call, owner delegated); on-site table management = new story | plan tasks 17, 19; OPEN-QUESTIONS §5 |
| 2026-11-09 | AD-6 accepted with a condition: `registerTables` captures a getter `() => currentDirectory(app)` (never the directory object), `zoneOf` reads it on every call; `zone_order_taker` resolver keeps `alertDirectoryOf(tx)` | board AD-6; lane 1B task 6 |
| 2026-11-09 | AD-7 accepted (`SeatingRow` literal unions = §5 CHECKs) | board AD-7; `tables/contracts.ts` |
| 2026-11-09 | Wave 0 integrator decisions accepted: per-lane marker comments in `tables/index.ts`; "registers nothing yet" test replaced by `[02a §4.2] buildHubServer calls registerTables once with its app and deps` | board Wave 0 entry |
| 2026-11-09 | Spec **v1.1.2**: §3.4 re-sign-in on the same device releases the lock (`s.started_at <= l.last_activity_at` in `due` and `intents`), test 8 extended (lane 1C blocker 1, option (a)) | `docs/specs/02a_Tables_Spec_v1.1.2.md` (`451e19d`), README; AD-11 |
| 2026-11-09 | Lane 1C blocker 2: four existing tick test files may `unregisterTick('table_locks')` after `createTestHub` (tests only) | AD-12 |
| 2026-11-09 | Lane 1B readings accepted; queued call never takes and never moves a lock (task 8 fix on `module-02a`, opus review) | AD-8 |
| 2026-11-09 | Lane 1A: `bindTablesProjectionLog` accepted (plan note), non-holder `last_touch_at` accepted; #9 tick clause at the wave 1 checkpoint | AD-9; plan "02a exports" |
| 2026-11-09 | Lane 1C: `table_locks` registered once per process, guarded by name; no entry for a table without an open seating | AD-10 |

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

## Wave 0 — events, codes, migration, contracts (2026-11-09)

- **Tasks:** 1, 1b, 2, 3, 3b (integrator).
- **Commits:** `68fb020` (1), `635c73c` (1b), `00dd526` (2), `4bf9f94` (3), `5b03f02` (3b); review fixes `85a6688` (3b), `ad8b1f1` (1b).
- **Reviews:** one fresh opus reviewer per task. 1, 1b, 2, 3 approved first pass. 3b: two Important findings fixed in `85a6688` — `tables/index.ts` now has real `registerTables` / `registerTablesProjection` functions with one marker comment per lane (wave 1 B, C; wave 2 A–D; projection: wave 1 A), so lane registrations are purely additive (rule 3); `contracts.test.ts` lost its "registers nothing yet" asserts (they would turn red as soon as wave 1 lands, in a file no lane owns) and keeps `[02a §4.2] buildHubServer calls registerTables once with its app and deps` (integrator ruling). 1b: gate lint error (`_omitted` unused) fixed in `ad8b1f1`.
- **Gate:** TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test" — 379 files (1 skipped), 3486 tests passed (1 skipped, 1 todo), 609 s wall. Green.
- **§12.2 rows ticked:** none (no command yet).
- **Statement counts asserted:** none.
- **Tests closed:** none of §10 (schemas, codes, migration, contracts only).
- **Also:** `apps/hub/test/db/alerts-migration.int.test.ts` pinned migration list gets `0012_tables.sql` (task 3's "migration list" Done line).
- **AD rows (proposed):** AD-6 (`zoneOf` directory access), AD-7 (`SeatingRow` literal unions).
- **Carried (minor, deferred):** `table-events.test.ts` "TableMoved / SeatingSplit on the from table, TablesMerged on the into table" and `BillClosed` "on stream table" only echo their input (the registry has no stream) — the writers' tests (tasks 9, 14–16, 05) pin the stream; `LineComped.reason_code` is `z.string()` vs 02b's command `min(1)` — 02b's call; `CloseHandover` takes `CommandCtx` (§3.9), not `AlertCtx`.

## Next

1. **Owner:** review wave 0, then type `wave 1` in the integrator session (it creates worktrees `~/pos-02a-A`…`C`); open the three lane sessions per `docs/plans/02a-parallel-prompts.md` §3.
2. **Owner (any time):** AD-1–AD-5 (proposed readings).
3. **Design (parallel):** 02a handoff in `docs/design/handoff/02a/` from the screen list in plan batch 5; then a short plan patch for tasks 20–24.
