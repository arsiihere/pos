# 02a status board

Plan: `docs/plans/02a-plan.md` (26 tasks; hub built in **parallel waves 0–3**, prompts in `docs/plans/02a-parallel-prompts.md`; batches 1–5 as fallback; batch 5 = client, blocked on the design handoff). Spec: `docs/specs/02a_Tables_Spec_v1.1.4.md` (APPROVED; v1.1.4 = text only, owner 2026-11-10; v1.1.2 = §3.4 re-sign-in, owner 2026-11-09; v1.1.3 = queued calls never move a lock, owner 2026-11-10), on top of 02p (merged, `2fa2db0`). Branch: `module-02a`.

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
| 4 | Projection `tables`, state fold, `reset` | 4 | 1 | HIGH | **done (wave 1)** | `bef293b`, `7cbed65`, `9bd6570` |
| 5 | Lock activity fold | 5 | 1 | HIGH | **done (wave 1)** | `3e39daf`, `9926c28`, `53bd1ae` |
| 6 | Reads + 03a slip reader pair | 6 | 2 | NORMAL | **done (wave 1)** | `0d38b13`, `a6f6018`, `2777aac` |
| 7 | `waiterTeam`, `table_team` / `zone_order_taker` resolvers | 7 | 2 | NORMAL | **done (wave 1)** | `939a4e8` |
| 8 | `requireLock` | 8 | 2 | HIGH | **done (wave 1)** | `06ceaa4`, `009691b`, `7ef4670` |
| 9 | `OpenTable` | 9 | 2 | HIGH | **done (wave 2)** | `18d4d00` |
| 10 | Touch, Release, ForceRelease | 10 | 2 | NORMAL | **done (wave 2)** | `e677df2`, `221be6b` |
| 11 | Tick `table_locks` | 11 | 3 | HIGH | **done (wave 1)** | `0db74ee`, `f0c5f73` |
| 12 | `closeHandover`, kind `table_handover`, `RequestTableHandover` | 12 | 3 | HIGH | **done (wave 2)** | `33bff77` |
| 13 | `TakeOverTable`, `ForceMoveTable` | 13 | 3 | NORMAL | **done (wave 2)** | `8da5e3e`, `52a8eab` |
| 14 | `MoveTable` | 14 | 3 | NORMAL | **done (wave 2)** | `a649158`, `9cee82f`, `9a4c304` |
| 15 | `MergeTables`, `registerMergeGuard` | 15 | 3 | HIGH | **done (wave 2)** | `fcb09d6`, `d1ae892`, `fa10647` |
| 16 | `SplitSeating` | 16 | 4 | HIGH | **done (wave 2)** | `ca4967e` |
| 17 | `RequestBill`, `CleanTable` (queueable) | 17 | 4 | NORMAL | **done (wave 2)** | `4215c31`, `5c97400` |
| 18 | Kind `call_waiter`, `CallWaiter` | 18 | 4 | NORMAL | **done (wave 2)** | `49b6686`, `90886f4` |
| 19 | Queries, catch-up, audiences | 19 | 4 | NORMAL | **done (wave 3)** | `2357164` |
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
| AD-1 | 8 | §4.2 "`ctx.queued`" (P-1b) = `ctx.queuedAt !== null` (`commands/registry.ts:31`) | — | as read | **ruled (owner, 2026-11-10)** |
| AD-2 | 9, 14–16 | "Archived table" = absent from `branchConfig()` tables (V4 has no table `is_archived`); unknown ids → same `404 TABLE_NOT_FOUND` | — | as read | **ruled (owner, 2026-11-10)** |
| AD-3 | 12 | `seatingTotals` (02b) absent → handover card leaves `amount` out; no stub | — | as read | **ruled (owner, 2026-11-10)** |
| AD-4 | 4 | `ItemServed` not in `tables.eventTypes` (P-1d; not in §3.3's activity list) | — | as read | **ruled (owner, 2026-11-10)** |
| AD-5 | 12, 18 | Kind `table_handover` in `apps/hub/src/tables/kinds.ts`, kind `call_waiter` in `apps/hub/src/tables/call-waiter-kind.ts` (lane ownership, wave 2); both loaded at module load by `tables/index.ts` ← `server.ts` static import before boot step 4 (proved by `handover-boot.int.test.ts`) | — | as read (reworded 2026-11-10) | **ruled (owner, 2026-11-10)** |
| AD-6 | 6 | `zoneOf(table_id)` (§4.2, no directory parameter) reaches the directory via `currentDirectory(app)` captured in `registerTables`; signature unchanged (contracts.ts) | — | accepted with condition: `registerTables` captures a getter `() => currentDirectory(app)`, never the directory object; `zoneOf` reads it on every call; the `zone_order_taker` resolver keeps reading `alertDirectoryOf(tx)` | **ruled (owner, 2026-11-09)** |
| AD-7 | 3b | `SeatingRow.state = Exclude<TableState,'FREE'> \| 'CLOSED'`, `bill_closed: 0 \| 1`, `close_reason` literal union — the §5 CHECKs verbatim; `seatingOf().state` stays `TableState` | — | as read | **ruled (owner, 2026-11-09)** |
| AD-8 | 8 (lane 1B) | `requireLock` readings: `not_holder` error in the §9 shape; scope = the one table; `zoneOf` → `floor_id: ''` for a table absent from the config; `locked_by_name: null` when the holder is unknown | — | accepted as read; **change:** a queued call (`ctx.queuedAt !== null`) never takes **and never moves** a lock — the command proceeds, the lock stays where it is (task 8 fix on `module-02a`, test `[02a #60] queued replay does not move the caller's lock from his other device`); built `7ef4670`; spec **v1.1.3** (`676ad5c`) | **ruled (owner, 2026-11-09; spec 2026-11-10)** |
| AD-9 | 4, 5 (lane 1A) | `bindTablesProjectionLog` (live-only #55 log line bound in `registerTables`); `last_touch_at` refreshed by a non-holding device's event | — | accepted as is; plan "02a exports" notes `bindTablesProjectionLog`; #9's tick clause checked at the wave 1 checkpoint | **ruled (owner, 2026-11-09)** |
| AD-10 | 11 (lane 1C) | tick `table_locks` registered once per process, guarded by name; a table without an open seating has no entry | — | accepted | **ruled (owner, 2026-11-09)** |
| AD-11 | 11 (lane 1C) | Lane 1C blocker 1: §3.4 live session ignores a session that started after the lock's last activity | (a) spec bump; … | (a): spec **v1.1.2** (`451e19d`) — `s.started_at <= l.last_activity_at` in `due` and `intents`; test 8 extended | **ruled (owner, 2026-11-09)** |
| AD-12 | 11 (lane 1C) | Lane 1C blocker 2: existing tick suites see the new `table_locks` tick | — | allowed (like SG-6): `test/alerts/tick-loop.int.test.ts`, `test/engine/fires-tick.int.test.ts`, `fires-alerts-tick.int.test.ts`, `kinds.int.test.ts` may call `unregisterTick('table_locks')` after `createTestHub`; tests only. **2026-11-10:** also `test/engine/station-plan.int.test.ts`, and (test-only, not run in the gate) `test/engine/fires-tick.perf.test.ts`, `fires-alerts-tick.perf.test.ts` so the 03a perf numbers keep their old measured surface | **ruled (owner, 2026-11-09; extended 2026-11-10)** |
| AD-13 | 8 | Spec text after AD-8: §4.2 (v1.1.2 :246) still says same actor other device → `[TableLocked { replaced_device_id }]` with P-1b exempting only a free lock; §10 #60 (:634) has no move clause. Code (`7ef4670`) follows AD-8 | (a) spec v1.1.3; (b) leave the spec, AD-8 on the board is enough | (a): spec **v1.1.3** (`676ad5c`) — §4.2 P-1b "with `ctx.queued` no lock is taken or moved: a free lock stays free and the caller's lock stays on his other device; a lock held by another staff still gives `TABLE_ALREADY_LOCKED`"; §10 #60 extended | **ruled (owner, 2026-11-10)** |
| AD-14 | wave 1 gate | 03a test `test/engine/set-station-capacity.int.test.ts` pinned 16 statements (7 projection checkpoint upserts); the `tables` projection (SG-5) makes it 17 | (a) bound → 17; (b) derive the upserts from the registered projections | (b): `ours = 9 + COUNT(projection_checkpoints)` (`a58e12f`), test only. **Next platform batch:** 03a §10.5 "16 statements" should read "9 + one checkpoint upsert per registered projection" (text only, no bump now) | **ruled (owner, 2026-11-10)** |
| AD-15 | 11 (lane 1C) | `branchConfig()` null → `ttl` bound as NULL: only `session_expired` releases a lock, no `lock_ttl` until a config is applied (fail-safe, as `firesTick`) | — | accepted; test `[02a §3.4] no branch config → ttl bound NULL` | **ruled (owner, 2026-11-10)** |
| AD-16 | 15 (lane 2C) | "A merge that brings an order" clears `bill_requested_at` | — | **change:** only when the merge brings at least one live (not cancelled) order, same rule as #33; merging in an all-cancelled seating keeps BILL_REQUESTED (fix commit on `module-02a`, one-line filter in `applyMerged`, test `[02a §3.11] merge of an all-cancelled seating keeps BILL_REQUESTED`, opus review) | **ruled (owner, 2026-11-10)** |
| AD-17 | 14–16 (lane 2C) | Lane 2C's other readings and its pinned statement counts (lane-done summary to the owner) | — | accepted as read | **ruled (owner, 2026-11-10)** |
| AD-18 | 12 (lane 2B) | The `RequestTableHandover` note is accepted and **not stored** | — | accepted for now. **Spec gap for the next 02a text bump:** carry the note to the receiver's card | **ruled (owner, 2026-11-10)** |
| AD-19 | 12, 13 (lane 2B) | `inactive` checked before `no_permission`; sender scope; the extra `listOpen` statement on the `TABLE_HANDOVER_PENDING` path; and lane 2B's five smaller choices | — | accepted as read. Follow-up (one test-only commit): task 13 tests — holder not the assignee taking over → 403 `not_assigned`; take-over with `own_tables` scope; force move with no lock — and the §11 step 12 boot-replay test moved to its own file (real boot import chain) | **ruled (owner, 2026-11-10)** |
| AD-20 | 17, 18 (lane 2D) | (1) §12.2 409 counts = stale seating, no seating + each command's own codes (`TABLE_NOT_OPEN` unreachable: `seating_id` required); (2) `own_tables` = holder (T8), Clean has no 403 (`clean-table` branch scope only), CallWaiter has the scope 403; (3) Clean returns `{ reason }`, Bill `{ requested: true }`; (4) #40 split: Bill/Clean in 17, map 19, Move-from 14, Open 404 9; (5) `call_waiter` `display.table_code` = primary table name, `table_id` fallback; (6) i18n keys missing | — | all six accepted as read; CallWaiter's scope 403 follows the §10 preamble — **note for the next §12.2 text fix** (row 6.14 should list it); i18n keys `alert.table_handover.*`, `alert.call_waiter.*` → client batch 5 | **ruled (owner, 2026-11-10)** |
| AD-21 | wave 2 (integrator) | Lanes 2C / 2D wait for task 12 with `git branch --contains 02a-task12` listing `module-02a`; the integrator lands by cherry-pick (new sha), so that never holds | — | integrator told lanes 2C, 2D that task 12 was landed (`33bff77`); their own task 12 copies (`7f10b89`, `bd51698`) showed as `+` in `git cherry` (index.ts hunk context differs) and were skipped after a manual identity check. §2 wait rule now uses `git cherry module-02a 02a-task12` showing `-`; §1 skips a lane's own copy of a shared task that matches by content even if `git cherry` shows `+` | **ruled (owner, 2026-11-10)** |
| AD-22 | 13 | `own_tables` scope cannot do a real take-over (scope checked last, the caller is not yet the holder; only the no-op passes) | — | intended (T8: `own_tables` = only the seatings you hold; taking over someone else's table is outside it); no code change; owner-app hint → OPEN-QUESTIONS §5 02a-N2 | **ruled (owner, 2026-11-10)** |
| AD-23 | 19 | Archived seated tables (SG-4) are sent as a trailing pseudo-floor `{ floor_id: '', name: null, zones: [{ zone_id: null, name: null, tables }] }` (client supplies the "Archived tables" label); it is sent **even under a `floor_id` filter** (its floor is unknown); an unknown `floor_id` returns `floors: []` plus that group when one exists | (a) as built; (b) send it only without a filter; (c) a documented floor shape in §6.17 (spec note) | (a) **with one change:** the pseudo-floor also carries `archived: true` (the client keys on that, not on `floor_id ''`); fix commit + test, opus review; shape → next 02a text bump (§6.17) | **ruled (owner, 2026-11-10)** |
| AD-24 | 19 | `handover-candidates`: §6.7 receiver rule, working first, then name, then `staff_id`; a FREE configured table is valid; 404 only when neither configured nor seated; **`tables_held` counts open seatings** (a merged T7+T8 = 1) | — | as read | **ruled (owner, 2026-11-10)** |
| AD-25 | 19 | `BillClosed` gets no audience in 02a (§6.19 table does not list it; 05 owns it, SG-2): NEEDS_CLEANING reaches clients only via the next map read or catch-up until 05 registers one | — | accepted; 05 must register the `BillClosed` audience (OPEN-QUESTIONS §5 02a-N3) | **ruled (owner, 2026-11-10)** |
| AD-26 | 19 | Catch-up part `tables` limited to the map's device types (tablet, phone, cashier kiosk); the audience still sends table frames to a staff session on a KDS device, which gets no `tables` catch-up | (a) accept the difference; (b) align the audience to the same device types | (a) accepted as read | **ruled (owner, 2026-11-10)** |
| AD-27 | client 20–23 (plan) | Q-3 (G2a-8, G2a-9): shell / contracts task first, then 02a and 02b lanes in parallel; Bill / Clean offline "Needs the hub" behind one `enqueue()` until 02b's queue flips them to queued; 02a exports `useTableLock` + `LockBanner` | (a) wait for 02b; (b) interface now; (c) own queue | (b); spec v1.1.6 §8 | **accepted (owner 2026-11-12)** |
| AD-28 | 21 | Q-5 (G2a-1): map refresh from live frames, no timer (debounced `table-map` read on the listed triggers, stale replies dropped); handoff's 30 s refetch struck; AD-25 stays | (a) frames; (b) + `BillClosed` audience now | (a); spec v1.1.6 §8 | **accepted (owner 2026-11-12)** |
| AD-29 | hub gap batch + 23 | Q-12 (G2a-2): `call_waiter` display carries `requester_name`; chip not shown; TableMapWaiter copy without chip | (a) generic; (b) + caller name; (c) + chip | (b); spec v1.1.6 §6.14, test 63 | **accepted (owner 2026-11-12)** |
| AD-30 | 20 + hub gap batch | Q-13 (G2a-11): `401`/`403` from `staff-roster` and WS `4403` → wipe token / device id / type → Pair again → `/pair`; pair page sends non-KDS devices to `/staff/` | (a) client; (b) + pair-page redirect | (b); spec v1.1.6 §8, 00 v1.9.1 §8.2 | **accepted (owner 2026-11-12)** |
| AD-31 | 23 | Q-14 (G2a-3): device remembers its handover sends; after reload "Waiting for an answer"; result frame → `my-requests` diff; 01d fields deferred | (a) client; (b) 01d bump | (a); spec v1.1.6 §8; OPEN-QUESTIONS §9 | **accepted (owner 2026-11-12)** |
| AD-32 | 22 | Q-15 (G2a-4): buttons by grant only; `403 outside_scope` → "This table is outside your floors"; `floor_ids` deferred | (a) / (b) / (c) | (a); spec v1.1.6 §8 | **accepted (owner 2026-11-12)** |
| AD-33 | 22 | Q-16 (G2a-5): "Call sent" on the calling device only, sub line without names, repeat toast without time | (a) client; (b) hub tile field | (a); spec v1.1.6 §3.13 | **accepted (owner 2026-11-12)** |
| AD-34 | 21 | Q-17 (G2a-6): late flag from the holder's open `slip_warning` rows; void-waiting / bill-paid hidden until 04 / 05; "Waiting to send" once the queue exists | (a) / (b) drop all | (a); spec v1.1.6 §8 | **accepted (owner 2026-11-12)** |
| AD-35 | 22 | Q-18 (G2a-13): reason = `<chip_token>` or `<chip_token>: <note>`, ≤ 120; known tokens localised on display, else raw | (a) English label; (b) token; (c) localised | (b); spec v1.1.6 §8 | **accepted (owner 2026-11-12)** |
| AD-36 | 20–23 | Q-25 (G2a-7, 10, 12, 14, 15): no device name in TableBusyOwn; plan file list widened (alerts edits in one task); `{requester}` in `alert.table_handover.lock`; zone heading assignee from tiles; `other_owner` preset only when `assigned_staff_id` set and ≠ me | — | yes to all; spec v1.1.6 §8 (heading, preset) | **accepted (owner 2026-11-12)** |

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
| 2026-11-10 | AD-13 → (a): spec **v1.1.3** — queued calls never take or move a lock (§4.2 P-1b, §10 #60); AD-8 and AD-13 ruled | `docs/specs/02a_Tables_Spec_v1.1.3.md` (`676ad5c`), README |
| 2026-11-10 | Lane 1C: `unregisterTick('table_locks')` (test-only) also allowed in `test/engine/station-plan.int.test.ts`, `fires-tick.perf.test.ts`, `fires-alerts-tick.perf.test.ts` | AD-12 |
| 2026-11-10 | **Standing rule (integrator):** a cherry-pick conflict made only of added lines, each already allowed by an owner ruling, with no existing line changed → keep all of them in lane order, note it in the wave entry, go on without asking. Any other conflict still STOPs | `docs/plans/02a-parallel-prompts.md` §1 (integrator) |
| 2026-11-10 | Lane 1B/1C conflict in `test/engine/fires-alerts-tick.int.test.ts`, `kinds.int.test.ts`: keep both — `resetSlipReaders();` then `unregisterTick('table_locks');` | wave 1 entry |
| 2026-11-10 | AD-14 (b): 03a §10.5 statement bound counts the registered projections; 03a §10.5 text fix in the next platform batch | AD-14 |
| 2026-11-10 | AD-15: no branch config → no TTL release, only `session_expired` | AD-15 |
| 2026-11-10 | Lanes also run `pnpm --filter @pos/hub typecheck:tests` (the plain `typecheck` skips test files) | `docs/plans/02a-parallel-prompts.md` §2 |
| 2026-11-10 | Lane 2C: merge clears the bill request only when it brings a live order (fix commit); other 2C readings and statement counts accepted | AD-16, AD-17 |
| 2026-11-10 | Lane 2B: handover note not stored (spec gap: carry it to the receiver's card, next 02a text bump); other 2B readings accepted; task 13 test follow-ups + boot-replay test in its own file | AD-18, AD-19 |
| 2026-11-10 | Lane 2D: six readings accepted; CallWaiter scope 403 per §10 preamble (§12.2 text fix later); i18n keys → client batch 5 | AD-20 |
| 2026-11-10 | AD-21: hand-off wait uses `git cherry`; integrator skips a lane's content-identical copy of a shared task | AD-21; `02a-parallel-prompts.md` §1, §2 |
| 2026-11-10 | AD-22: `own_tables` cannot take over — intended (T8); owner-app hint 02a-N2 | AD-22; OPEN-QUESTIONS §5 |
| 2026-11-10 | AD-23: archived pseudo-floor accepted + `archived: true` (fix commit); AD-24, AD-26 as read; AD-25 accepted (05 registers the `BillClosed` audience, 02a-N3); lane worktrees, branches and local tags removed | AD-23–AD-26; OPEN-QUESTIONS §5 |
| 2026-11-10 | Build review rulings: #40 Move-from not waived (test-only commit, opus review); AD-1–AD-5 accepted as read (AD-5 reworded: `call_waiter` in `call-waiter-kind.ts`); tick tests for the v1.1.2 `started_at <= last_activity_at` boundary (equal → kept; 1 ms after → `session_expired`), test-only, opus review; spec **v1.1.4** text only; then the full gate and "ready to merge" | AD-1–AD-5; `docs/reviews/02a_v1.1.3_build_review.md`; spec v1.1.4 |

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

## Wave 1 — projection, reads, lock, team, resolvers, tick (2026-11-10)

- **Lanes and tasks:** 1A tasks 4, 5; 1B tasks 6, 8; 1C tasks 7, 11 — each task with its own implementer and opus reviewer in the lane session (lane reports). Landed by cherry-pick in lane order (A, B, C).
- **Commits on `module-02a`:** 1A `bef293b` (4), `7cbed65`, `9bd6570` (4 review), `3e39daf` (5) · 1B `0d38b13` (6), `a6f6018` (6 review), `06ceaa4` (8), `009691b` (8 review) · 1C `939a4e8` (7), `0db74ee` (11).
- **Integration fixes (integrator, after landing):** `2777aac` reads test no longer seeds the `seating_orders` row lane 1A's projection writes; `f0c5f73` tick test on the folded lock row (lane 1A's fold deletes the row on `TableLockReleased`) + "next pass idle" test; `9926c28`, `53bd1ae` `[02a #9 tick]` after reset + replay a refreshed lock is not released early (AD-9 checkpoint check — #9's tick clause was not covered); `a58e12f` 03a §10.5 bound counts registered projections (AD-14).
- **Owner-ruled change:** `7ef4670` task 8 — a queued call never takes or moves a lock (AD-8; opus review approved; spec v1.1.3).
- **Cherry-pick conflicts:** `tables/index.ts` import lines (1B after 1A, 1C after 1A+1B) — additive, kept in lane order; `test/engine/fires-alerts-tick.int.test.ts`, `kinds.int.test.ts` (1B `resetSlipReaders()` vs 1C `unregisterTick('table_locks')`, same line after `createTestHub`) — kept both in lane order (owner, 2026-11-10; now the standing rule).
- **Spec:** v1.1.2 (`451e19d`, §3.4 re-sign-in), v1.1.3 (`676ad5c`, queued calls never move a lock).
- **Gate:** TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test" — 386 files (1 skipped), 3563 tests passed (1 skipped, 1 todo), 572 s wall at `53bd1ae`. Green. Earlier runs: red on AD-14 (1 test), then on `typecheck:tests` for the new #9 test (fixed `53bd1ae`).
- **§12.2 rows ticked:** none (no command yet).
- **Statement counts asserted:** `tableOwners`, `holdersOfOrders`, `currentTableOf` 1 each (also for 40 ids / repeated ids); `seatingOf` 1; `zoneOf` 0; `table_team` 1 for 40 targets, `zone_order_taker` 1; `requireLock` 1 on every branch; tick idle 1 statement and no `writer.run`, pass with work 1 read + 1 append, `due` 1; `EXPLAIN QUERY PLAN` uses `staff_sessions_active_device` in `due` and `intents`. Replay identity #38 (all four tables), #9, #9b.
- **Tests closed (§10):** 8, 9 (incl. tick clause), 9b, 18, 19, 20, 21, 31 fold, 32 fold / `requireLock`, 33 fold, 38, 45, 46, 53 (`requireLock` part, SG-3), 55, 57, 58, 59, 60.
- **AD rows:** AD-8–AD-15 ruled (owner, 2026-11-09 / 10).
- **Carried (minor, deferred):** lane 1C parked test gaps — no tick test has a session that started strictly before `last_activity_at` (a `<=` → `=` change would pass); the T15 tick test does not seed the lock on the first device before the move; task 7's "no open seating" test leaves an impossible `seating_tables` row; no test asserts `table_team`'s query plan uses `staff_sessions_active`. Task 8: `lock.ts:7` header cites v1.1.1; `require-lock` test comment at the "differs only on a free lock" line is stale; `lastStatements` not asserted on the queued take-order-anywhere call. Process: lanes should also run `pnpm --filter @pos/hub typecheck:tests` (the plain `typecheck` skips test files).
- **Perf:** next `pnpm test:perf` (03a task 28, pilot box) must run `fires-tick.perf.test.ts`, `fires-alerts-tick.perf.test.ts` (AD-12).

## Wave 2 — commands: open, lock, handover, holder, move, merge, split, bill, clean, call waiter (2026-11-10)

- **Lanes and tasks:** 2A tasks 9, 10; 2B tasks 12, 13; 2C tasks 14, 15, 16; 2D tasks 17, 18 — each task with its own implementer and opus reviewer in the lane session. Landed as each lane tagged: task 12 first (`02a-task12`), then 2D, 2B, 2C, 2A.
- **Commits on `module-02a`:** 2B `33bff77` (12), `8da5e3e` (13) · 2D `4215c31` (17), `49b6686` (18), `90886f4` (18 review), `5c97400` (#13 clean) · 2C `a649158` (14), `9cee82f` (14 review), `fcb09d6` (15), `9a4c304` (14 handover close), `d1ae892` (15 handover close), `ca4967e` (16) · 2A `18d4d00` (9), `e677df2` (10), `221be6b` (10 review).
- **Owner-ruled follow-ups (integrator, opus review each):** `fa10647` merge of an all-cancelled seating keeps BILL_REQUESTED (AD-16); `52a8eab` task 13 tests (`not_assigned`, `own_tables`, force move with no lock) + boot-replay handover test in `handover-boot.int.test.ts` through the real boot import chain (AD-19).
- **Task 12 hand-off:** landed as `33bff77` and pushed; lanes 2C, 2D told directly, because `git branch --contains 02a-task12` never lists `module-02a` after a cherry-pick (AD-21, proposed). Their own task 12 copies (`7f10b89`, `bd51698`) showed as `+` in `git cherry` (their `index.ts` hunk context differed) and were **skipped** after checking: identical to task 12 outside `index.ts`, and their `index.ts` additions = task 12's.
- **Cherry-pick conflicts:** `tables/index.ts` import lines only (2B after 2D, 2C ×3, 2A ×2) — additive, kept in lane order A, B, C, D (standing rule). Registration lines sit under each lane's marker.
- **Gate:** TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test" — 396 files (1 skipped), 3769 tests passed (1 skipped, 1 todo), 592 s wall at `221be6b`. Green, first run.
- **§12.2 rows ticked:** 6.1–6.14 (6.5 tick in wave 1).
- **Statement counts asserted:** per command as the lanes pinned them (accepted as read, AD-17, AD-19, AD-20), e.g. `ForceMoveTable` 3 = 1 + 1 receiver session + 1 `byDedupeKey`; `closeStatements` 0 on a seating with no pending handover.
- **Tests closed (§10):** all of 1–61 except 36, 37 (task 19, wave 3) and 62 (moved to 02b, SG-3); 53 at the `requireLock` level (SG-3).
- **AD rows:** AD-16–AD-20 ruled; AD-21 proposed.
- **Carried (minor, deferred):** `applyMerged` `EXISTS` could also filter `seating_id = into` (no behaviour change today); spec §3.1 (:110) / §3.11 (:198) "an order" → "a live order" at the next 02a text bump; handover note to the receiver's card (AD-18, next 02a text bump); §12.2 row 6.14 to list CallWaiter's scope 403 (AD-20); `holder-commands` test "assignee already holds → covered" title overstates (the no-op returns before scope); `handover-boot` comment "step 0 pending" vs `step: -1`. **Owner question:** under T8 + scope-last, an `own_tables` grant can never allow a real take-over (the caller is not yet the holder when scope is checked), only the no-op — intended?

## Wave 3 — queries, catch-up, audiences; hub done (2026-11-10)

- **Task:** 19 (integrator; opus implementer, opus reviewer — approved, no Critical / Important).
- **Commit:** `2357164` `feat(02a): table-map, handover-candidates, catch-up, audiences`. Files: `tables/queries.ts`, `tables/audiences.ts`, `test/tables/queries.int.test.ts`, `tables/index.ts` (additive, wave 3 marker).
- **Gate:** TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test" — 397 files (1 skipped), 3779 tests passed (1 skipped, 1 todo), 583 s wall at `2357164`. Green, first run.
- **§12.2 rows ticked:** 6.17, 6.18 — with waves 1–2, **all 16 rows** (6.1–6.18).
- **Statement counts asserted:** `table-map` 3 + 1 at 80 tables / 40 seatings (open seatings ⋈ tables, locks, live order counts; then `last_seq`); catch-up build 3 (`as_of_seq` from the socket); `handover-candidates` 2 (the table's seating; one `UNION ALL` of live sessions and seatings held).
- **Tests closed (§10):** 36, 37. With waves 1–2: **every §10 test placed and green** except #62 (moved to 02b, SG-3); #53 at the `requireLock` level (SG-3).
- **§12.1 DoD (hub part):** all §10 tests green except the SG-ruled moves ✔; replay identity #38, #9 (incl. tick clause), #9b ✔; statement counts #8, #21, #36 ✔; no new dependency ✔; no cloud change ✔.
- **Also:** the map builder tolerates a floor without `zones` (only `call-waiter.int.test.ts`'s cast fixture lacks it; V4 requires `zones`, so no production effect).
- **AD rows (proposed):** AD-23 (archived pseudo-floor shape and filter — **rule before the client relies on it**), AD-24, AD-25, AD-26.
- **Carried (minor, deferred):** `queries.ts:161` comment says "older than snapshot V4" — only the test fixture; `handover-candidates` 404 / scope read the global `branchConfig()` while `table-map` uses `ctx.branchConfig` (same object today); the audience's `cashier_kiosk` clause is redundant (kiosks are `kind 'staff'`); `queries.int.test.ts:487` waits a fixed 30 ms before a negative assertion (prefer a marker frame).
- **Hub done.** Client = batch 5 (tasks 20–24), blocked on the design handoff.

## Build review closed — ready to merge (2026-11-10)

- **Owner rulings applied:** `b6d41fe` #40 Move-from test; AD-1–AD-5 ruled (AD-5 reworded); `3777b99`, `208ad01` tick boundary tests for `s.started_at <= l.last_activity_at` (equal → kept, 1 ms before → kept, 1 ms after → `session_expired`); spec **v1.1.4** (`1865991`, text only); AD-23 fix `58dfdae`.
- **Gate at `208ad01`:** 397 files (1 skipped), 3783 tests passed (1 skipped, 1 todo), 607 s. Green.
- **Review:** `docs/reviews/02a_v1.1.3_build_review.md` §7 verdict "ready to merge". Merge into `main` is the owner's.

## Next 02a text bump (v1.1.4) — done: `docs/specs/02a_Tables_Spec_v1.1.4.md` (owner, 2026-11-10)

Collected text fixes (owner, 2026-11-10); none changes behaviour already built. Applied in v1.1.4, plus §12.2 rows 6.15, 6.16 (build review G-7); the handover note is stated as accepted-not-stored (carrying it to the card needs a `values_schema` change, later bump):

1. Handover note carried to the receiver's card (AD-18).
2. §3.1 (:110) and §3.11 (:198): "an order" → "a live order" (AD-16).
3. §12.2 row 6.14: list CallWaiter's scope 403 (AD-20).
4. §6.17: the archived pseudo-floor `{ floor_id: '', name: null, archived: true, zones: [{ zone_id: null, name: null, tables }] }`; configured floors `archived: false`; sent even under a `floor_id` filter (AD-23).

**Next platform batch:** 03a §10.5 "16 statements" → "9 + one checkpoint upsert per registered projection" (AD-14).

## Next

1. **Owner:** merge `module-02a` into `main` (hub done, build review: ready to merge).
2. **Design:** 02a handoff in `docs/design/handoff/02a/` from the screen list in plan batch 5; then a short plan patch for tasks 20–24.

- **Perf note (owner 2026-11-10):** the next `pnpm test:perf` (03a task 28, pilot box) must run `apps/hub/test/engine/fires-tick.perf.test.ts` and `fires-alerts-tick.perf.test.ts` — they now `unregisterTick('table_locks')` (AD-12) and have not been run since.
