# 02a Tables — Implementation Plan (spec v1.1.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task, with superpowers:test-driven-development inside every task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build module 02a Tables on the hub: seatings and table state, the table lock and its tick, holder and assignment, take-over, handover with acceptance, force move, move / merge / split, bill request, cleaning, call waiter, the reads other modules use, the two queries and the `tables` catch-up part (02a §1.2). Then the staff client (§8), once its design handoff exists.

**Architecture:** one projection `tables` (T19) writes `seatings`, `seating_tables`, `seating_orders` and `table_locks` in `0012_tables.sql`; every lock change and every activity refresh is the fold of an event (T7, D44). Thirteen commands on the `table` stream (§6.19), one tick `table_locks`, two alert kinds (`table_handover`, `call_waiter`), two queries, one catch-up part. 02a fills the hooks 02p left (02p U3): the slip reader pair for 03a, the `table_team` / `zone_order_taker` resolvers for 01d, and `queueable` on `RequestBill` / `CleanTable` (00 v1.8).

**Tech Stack:** the existing stack (CLAUDE.md): Node 22, Fastify 5, better-sqlite3, Zod, Vitest, React (client). **No new dependency.** No cloud change, no cloud migration.

**Spec:** `docs/specs/02a_Tables_Spec_v1.1.1.md` (APPROVED; cited "§x", tests "#n"). Context only: `02p_Platform_Changes_Spec_v1.0.md` §1.3, §1.4 U3, §4.1 (what 02p built), `03a_Timing_Engine_Spec_v1.2.md` §4.4 (`registerSlipReaders`), `01d_Notifications_Requests_Spec_v1.2.1.md` §3.4, §4.2 (resolvers, D-1, D-3), `00_Hub_Platform_Access_Spec_v1.8.md` H-1 (`queueable`). **Read the cited section before each task**; the plan does not repeat the spec's tables, SQL or rule text. If the plan and the spec disagree, the spec wins: STOP and ask (CLAUDE.md).

**Starting point:** `main` at `2fa2db0` (02p merged). Branch `module-02a`. Next free hub migration: **`0012`** (`0011_scope_my_zones.sql` is the last). Nothing of 02a exists yet: no `apps/hub/src/tables/`, no `packages/events/src/events/table/`, no 02a codes in `errors.ts` (Foundation v1.11 §6.2 already lists them, F-3).

---

## ⛔ STOP — spec gaps and spec–code mismatches (owner ruling needed before the named tasks)

Found while writing this plan (CLAUDE.md: never silently diverge). Each is an **SG** row on `docs/plans/02a-status.md`, status "proposed (not yet ruled)". The plan names the options; it does **not** pick one. A task that depends on an open SG row does not start.

| # | Gap | Where it bites | Options (no pick) | Blocks |
|---|---|---|---|---|
| **SG-1** | `zone_order_taker` = "the order taker assigned to the table's **zone**" (01d v1.2.1 :393), and `zoneOf(table_id).zone_order_taker_staff_id` (§4.2). The hub directory has **no public read of a zone's assignee**: `StaffDirectory.zoneAssignee` is private (`auth/staff-directory.ts:99`); the only public reads are `assignedOrderTaker(tableId)` (table assignment **wins** over the zone, :316) and `zonesOf(staffId)` (adds the lead's zones, :333). 02a may not edit `auth/staff-directory.ts` (02p §1.3, §10 Acceptance). | `zoneOf`, resolver `zone_order_taker` (§4.2, §6.16) | (a) read it as `assignedOrderTaker(table_id)` (T10's "table wins") — differs from 01d's wording when a table has its own assignee; (b) a platform row adds `StaffDirectory.zoneOrderTaker(zone_id)` (01b file, owner-approved edit); (c) 01d text bump to (a)'s meaning | Task 6 (`zoneOf`), Task 7 (resolver) |
| **SG-2** | The `tables` projection folds events that **no package defines yet**: 02b's `OrderCancelled`, `OrderFoodServed`, `OrderFoodCleared`, `LineWeightSet`, `LineComped` (02b v1.0.2 §11 step 2) and 05's `BillClosed { seating_id }` (05 spec not written). 02a is built before 02b (T1). The writer cannot append an unregistered type, so the folds are untestable. | §3.1 fold, §3.3 activity list; tests #13, #32, #33 (fold clauses), #57, #58, #59 | (a) owner approves pulling 02b §11 step 2's five schemas (exact 02b §6 shapes) into 02a batch 1 as one extra task, and fixes `BillClosed`'s v1 shape now (`{ seating_id }`, stream?); (b) a mini platform batch (02p-style) adds the six schemas first; (c) 02a folds by type name only and these tests move to 02b / 05 acceptance (02a §12.1 DoD "all §10 tests pass" is then not met in this sprint) | Task 4 (those clauses), Task 5 (#59), Task 12 (#13), Task 17 (#32, #33) |
| **SG-3** | Tests #53 ("Bilal submits from his draft → order written") and #62 ("`MarkServed` by a non-holder → allowed") exercise **02b commands** (`SubmitOrder`, `MarkServed`) that do not exist in this sprint. | #53, #62 | (a) #53 at the `requireLock` level with a test-only command (`createTestHub({ testCommands: true })`) + the full clause in 02b; #62 moves to 02b (it pins 02b's P-1e rule); (b) both move to 02b | Task 8 (#53 placement only; the rest of task 8 is free) |
| **SG-4** | §3.14 / §6.17: the table map shows an **archived** table while it has a seating, with `name`, `seats`, its floor and `archived: true`. Snapshot V4 carries **active tables only** (01a §6.1 S22 test 4; `apps/cloud/src/modules/config-sync/builder.ts:128` `archived_at IS NULL`; table rows have no `is_archived`), so after archiving the hub knows neither its name nor its floor. | `table-map` builder, catch-up `tables`; tests #36, #40 | (a) show it with the floor of … nothing (unknown) → a "no floor" group, `name` = `table_id`; (b) a platform row: V4 delivers archived tables with `is_archived: true` (01a bump, R29 snapshot change); (c) 02a keeps the last known `{ name, seats, floor_id }` from config applies (a new 02a-owned cache — new behaviour, spec first) | Task 19 (archived clause of #36), Task 17 (#40 "map" part only) |
| **SG-5** | Wiring points outside 02p §10 Acceptance's list. (1) Projections must be registered **before** boot step 4's catch-up (`lib/boot.ts:173`), i.e. in `createDeps` next to `registerAlertProjections` (`lib/boot.ts:308`); `server.ts` (the only listed wiring file) runs at step 5, so a `tables` projection registered there is never replayed. (2) The test hub builds its own registry (`apps/hub/test/helpers/test-hub.ts:66-68`). | Task 4 | (a) allow one append-only line + import in `lib/boot.ts` `createDeps` and in `test/helpers/test-hub.ts`; (b) another registration point (00 change) | Task 4 |
| **SG-6** | Registration collisions with existing test doubles. `registerTargetResolver` throws on a second registration (`alerts/targets.ts:255`); 01d's `registerFakes()` (`test/alerts/fakes.ts:187-189`) registers `table_team` / `zone_order_taker` fakes, and ~20 01d test files call it **after** `createTestHub` (e.g. `tick-loop.int.test.ts:27-28`). If 02a registers its real resolvers when the hub is built, those files throw. Likewise 03a's `[03a #120] no readers registered → placed_by` assumes `slipReaders()` is `null`. | Tasks 6, 7 | (a) 02a registers in `registerTables(app, deps)` only when `!hasTargetResolver(kind)`, and `registerFakes` / 03a tests `unregister…` / `resetSlipReaders()` first (edits to 01d / 03a test files); (b) `createTestHub({ tables: false })` default for old suites (edit to `test-hub.ts`); (c) register at module load and change the fakes to replace (01d test file) | Task 6 (slip readers), Task 7 (resolvers) |

**Proposed readings (not blockers; AD rows on the board):**
- **AD-1:** §4.2 `requireLock` "with `ctx.queued`" (P-1b) = `ctx.queuedAt !== null` (`commands/registry.ts:31`; there is no `ctx.queued`).
- **AD-2:** "archived table" on the hub = a `table_id` absent from `branchConfig().floors[].tables[]` (V4 has no table `is_archived`); unknown ids get the same `404 TABLE_NOT_FOUND`.
- **AD-3:** `seatingTotals` (02b) does not exist; the handover card leaves `amount` out (§3.8 "omitted until 02b is built"). No stub is built.
- **AD-4:** `ItemServed` is not in `tables.eventTypes` (P-1d removed its fold, and it is not in §3.3's activity list).
- **AD-5:** kinds `table_handover` / `call_waiter` live in `apps/hub/src/tables/kinds.ts`, imported at module load by `apps/hub/src/tables/index.ts`, which `server.ts` imports (the static import chain `lib/boot.ts → server.ts` loads them before step 4's replay, as `engine-host/index.ts:12` does for 03a's kinds; §11 step 12, G4-3 #13).

**What can start now:** batch 1 tasks 1–3 (no SG). Task 4 needs SG-2 and SG-5 ruled. The kickoff prompt (end of this plan) says so.

---

## Markers

| Marker | Meaning |
|---|---|
| **RISK: HIGH** | One fresh implementer, then a full review by a fresh **opus** reviewer against the cited sections, the task's tests and the Global Constraints, before the next task. HIGH = the migration (3), the projection and its folds (4, 5), `requireLock` (8), `OpenTable` (9), the tick (11), the handover (12), merge (15), split (16). |
| **RISK: NORMAL** | One fresh implementer, then one fresh reviewer (opus). |
| **Shared** | Touches `packages/domain` or `packages/events`. Never two Shared tasks in parallel. |
| **Wiring** | Adds an append-only line to a shared wiring file (02p §10 Acceptance list, or an SG-5 ruling). |
| **UI** | Client only (`apps/client`). Implementer may be sonnet; reviewer opus. |
| **BLOCKED** | Cannot start until the named SG row is ruled or the design handoff exists. |

## Global Constraints

Every task implicitly includes these.

- **Agents:** one fresh implementer and one fresh reviewer per task. No subagent spawns subagents. A review fix round past 2 → STOP.
- **TDD:** the failing test first; run it; record the failure; then implement. Test names cite the spec test: `it('[02a #9] …')`; a test split across tasks is `[02a #31 fold]` / `[02a #31 command]` (01d plan P-2). Section-cited support tests: `[02a §3.4] …`. Each numbered clause lives in exactly one task (Coverage table).
- **Every command (§10 preamble):** happy path, each error code of its §12.2 row, D32 retransmit (same `command_id` → same response, no new event), scope (C8, `403 PERMISSION_DENIED { reason: 'outside_scope', table_ids }`, checked last), stale `seating_id` (`409 TABLE_SEATING_CHANGED`).
- **Implementer runs:** only their own files: `pnpm vitest run <files>` and `pnpm --filter <pkg> typecheck`.
- **Gate (per batch, controller only, one run at a time):** `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` (≈ 9 min). No timing asserts in the normal gate (03a AD-32); the §7 p99 numbers are not asserted in this sprint (no `test:perf` row exists for 02a).
- **Statement counts:** asserted with `statementCounter(db)` (`apps/hub/test/helpers/statement-counter.ts`) wherever §6 states a count; the reader pair and the resolvers are **exactly one statement per call** (§12.3 note, 03a AD-E6, test 121).
- **Commit:** one task per commit, only the task's files. Format `feat(02a): <title> [02a §x; §11 step N]`. Review fixes: `fix(02a): task N review … [02a §x]`. Author `Arslan Ahmed Arif <arsiiahmi@gmail.com>`.
- **Push:** `git push origin module-02a` after each batch checkpoint. No merge, no force-push, no push to `main` or any other branch, no reset, no rebase.
- **Files (02p §10 Acceptance):** own folders `apps/hub/src/tables/`, `apps/hub/test/tables/`, `packages/events/src/events/table/`, `apps/client/src/features/staff/tables/`; append-only lines in `apps/hub/src/server.ts` (`registerTables(app, deps)`), `packages/events/src/index.ts`, `packages/domain/src/errors.ts` and `TableState` in `@pos/domain`, a new migration `apps/hub/src/db/migrations/0012_tables.sql`, i18n strings, `StaffApp.tsx` / `SignIn.tsx` / `api.ts` (§8 Login only). Anything else → STOP (SG-5 / SG-6 are the known cases).
- **Readings:** a reading made without stopping is an `AD-n` row on `docs/plans/02a-status.md`, status "proposed (not yet ruled)". Never accept your own reading. Spec and code disagree, two specs disagree, a bound would change, a file outside the list, or new behaviour → STOP and ask.
- **Events:** schema version 1, stream `table`, **no session ids** (T7); device = envelope `device_id`; times = `recorded_at`.
- **No hard-coded names** (role, staff) in code (README R5, R18); strings in `apps/client/src/i18n/en.ts` and `ur.ts` or the Urdu to-do list.

## Exact names from today's code (later tasks rely on these)

| Need | Name and place |
|---|---|
| Slip reader pair (03a v1.2 §4.4) | `registerSlipReaders({ holdersOfOrders, currentTableOf })`, types `HoldersOfOrders = (db, order_ids: readonly string[]) => Map<string, string>`, `CurrentTableOf = (db, order_ids) => Map<string, { seating_id; primary_table_id; table_ids: string[] }>`; exported from `apps/hub/src/engine-host/index.ts:10` (`slip-readers.ts`); `db` is the tick's read-only view; tests: `resetSlipReaders()` |
| Resolvers (01d D-1) | `registerTargetResolver(kind, fn)` `apps/hub/src/alerts/targets.ts:254`; `TargetResolver<K> = (tx: WriterTx, targets: Array<Extract<AlertTarget,{kind:K}>>) => Map<string, ResolvedTarget>`; key `targetKey(target)` (`:273`) = `table_team:<table_id>:<depth ?? 'direct'>` / `zone_order_taker:<table_id>`; `ResolvedTarget { staff_ids, device_ids, owner_staff_id? }` (`:57`); directory via `alertDirectoryOf(tx)` (`alerts/raise.ts:91`); `hasTargetResolver`, `unregisterTargetResolver` (tests) |
| Tick | `registerTick({ name, due(db, state, now), intents(tx, state, now) })`, `TickDef` (`alerts/tick.ts:30`), exported from `alerts/index.ts:25` |
| Alerts API | `alerts.raise(ctx, RaiseInput) → { alert_id, events, deduped, requester_staff_id }`, `alerts.close(ctx, alert_id, 'obsolete', note?)`, `alerts.closeMany(ctx, CloseItem[])`, `alerts.byDedupeKey(db, kind, key) → string \| null` (`alerts/raise.ts:557`, exported `alerts/index.ts:23`); `RaiseInput { kind, subject, target, values?, display, details?, dedupe_key, requester_staff_id?, request?: { receiver_staff_id? } }` (`raise.ts:45`) |
| Kinds | `defineAlertKind(def)` (`alerts/kinds.ts:103`): `closes_on: 'owner' \| 'seen' \| { after_ms }`, `skip_requester?: boolean` (startup error on a request kind, `:134`), `request.apply(ctx: AlertApplyCtx<V,D>, answer: AnswerFacts) → EventDraft[]` (`answer.answerer_staff_id`, `ctx.alert.values`, `ctx.alert.alert_id`); step target `'raised_target'` / `{ kind: 'requester_lead' }` (`packages/events/src/alerts.ts:33-48`); draft `alert_id` checked by `checkAlertIds` (`alerts/commands/request-row.ts`) |
| Commands | `defineCommand({ commandType, payloadSchema, sessionKind: 'device', permission, queueable?, handle(ctx, payload, cmd) })` (`commands/registry.ts:50-73`); `ctx.actor.{staffId, deviceId}`, `ctx.directory`, `ctx.permission: Resolution \| null`, `ctx.clock`, `ctx.ids`, `ctx.tx`, `ctx.queuedAt: number \| null` (`:31`) |
| Queries / catch-up / audiences | `defineQuery({ resource, sessionKind: 'device', session: 'required', deviceTypes, countsAsActivity: false, querySchema, handle(ctx, q) })` (`queries/registry.ts:29-40`, `QueryCtx { db, directory, device, session, branchConfig, now }`); `registerCatchUp({ part: 'tables', appliesTo(socket), build(db, state, socket) })` (`ws/catch-up.ts:15-24`, `SocketCtx { deviceId, deviceType, staffId, kind, asOfSeq }`); `registerEventAudience(eventType, (event, socket) => boolean)` (`ws/audience.ts:8`) |
| Projection | `{ name: 'tables', eventTypes: string[], apply(tx, e, mode: 'live' \| 'catchup'), reset(tx) }` (`projections/registry.ts:6-11`), registered with `ProjectionRegistry.register` (SG-5 decides where) |
| Directory | `StaffDirectory` (`auth/staff-directory.ts`): `resolve(staffId, permission) → Resolution` (`{ grant: 'allowed' \| 'requires_approval' \| 'not_granted' \| 'denied', scope? }`), `floorsOf(staffId)`, `assignedOrderTaker(tableId)` (table wins, `allowed` take-order only, AD-30), `teamOf(staffId)` (direct reports with a PIN), `leadOf`, `get`, `list`. `zonesOf(staffId)` exists but 02a does not use it (02b's `my_zones`). |
| Config | `branchConfig()` and `zoneOfTable(tableId)` (`sync/branch-config-holder.ts:18, :49`); `engine_settings.table_lock_ttl_ms` (`packages/events/src/config.ts:276`); V4 `floors[].tables[] { table_id, name, seats, sort_order, zone_id }`, `floors[].zones[]` |
| Sessions | `staff_sessions (session_id, branch_id, kind IN ('staff','admin','station'), staff_id, station_id, device_id, started_at, last_activity_at, ended_at, idle_ttl_ms, …)`; `staff_sessions_active_device (device_id) WHERE ended_at IS NULL AND kind IN ('staff','station')`; `staff_sessions_active (branch_id) WHERE ended_at IS NULL` (`db/migrations/0002_devices_sessions.sql:60-81`) |
| Test helpers | `createTestHub`, `seedDirectory`, `pairDevice`, `openSession`, `endSessionNow` (`apps/hub/test/helpers/test-hub.ts`), `statementCounter`, `aDirectory`, `PIN`, `pinHash` (`fixtures.ts`), `connectWs` (`ws-client.ts`) |

## 02a exports (this plan fixes the names; all in `apps/hub/src/tables/`)

```ts
// reads.ts (§4.2) — each ONE statement, batch-shaped
export function tableOwners(db, table_ids: readonly string[]): Map<string, string>;
export const holdersOfOrders: HoldersOfOrders;
export const currentTableOf: CurrentTableOf;
export function seatingOf(db, table_id: string): { seating_id; primary_table_id; table_ids: string[]; state: TableState; holder_staff_id } | null;
export function zoneOf(table_id: string): { floor_id: string; zone_id: string | null; zone_order_taker_staff_id: string | null }; // 0 statements; SG-1
// team.ts (§3.5)
export function waiterTeam(seating: { assignee: string | null; holder_staff_id: string }, liveStaffIds: ReadonlySet<string>, directory: StaffDirectory): string[];
// lock.ts (§4.2)
export function requireLock(tx: WriterTx, ref: { table_id: string; seating_id: string }, ctx: CommandCtx): EventDraft[];
// merge-guard.ts (§4.1, 04)
export function registerMergeGuard(fn: (db, q: { seating_ids: string[]; order_ids?: string[] }) => { blocked: boolean; order_item_ids: string[] }): void;
// index.ts
export function registerTables(app: FastifyInstance, deps: HubDeps): void; // commands, queries, catch-up, audiences, tick, hooks (SG-6)
export function registerTablesProjection(projections: ProjectionRegistry): void; // SG-5
```

## Review Focus

Failure modes the spec implies; each line names the pinning test and task.

1. **Replay identity of the activity fold across a split.** Pinned by #9b (task 5): the fold reads `seating_orders` *as of the event*, single projection (T19).
2. **A non-holder's submit never takes a free lock**, queued or not. #46, #53 (SG-3), #60 (task 8).
3. **Handover `apply` drafts without `alert_id` → 500.** #52 (task 12): both `TableHolderChanged` and `TableLockReleased` carry it.
4. **Merge R23 in both directions.** #54, #54b (task 15): any table of either side assigned to someone else needs force.
5. **The tick at exactly `ttl`.** #8 (task 11): `>` in `due` and `intents`, idle = one statement, `EXPLAIN QUERY PLAN` uses `staff_sessions_active_device`.
6. **One statement per reader call** (03a test 121 bound). Task 6 asserts it for `holdersOfOrders`, `currentTableOf`, `tableOwners`.

---

## Batches

| Batch | Tasks | §11 steps | §12.2 rows closed | Starts when |
|---|---|---|---|---|
| 1 — data | 1–5 | 2, 3, 4, 5 | none (no endpoint); replay identity #38 | plan approved; tasks 4–5 also need SG-2, SG-5 |
| 2 — reads, hooks, lock, open | 6–10 | 6, 7, 8, 9, 10 | 6.1, 6.2, 6.3, 6.4 | batch 1 green; SG-1, SG-6 ruled |
| 3 — tick, holder, move, merge | 11–15 | 11, 12, 13, 14, 15 | 6.5, 6.6, 6.7, 6.8, 6.9, 6.10 | batch 2 green |
| 4 — split, bill, clean, call, queries | 16–19 | 16, 17, 18, 19 | 6.11, 6.12, 6.13, 6.14, 6.17, 6.18 | batch 3 green; SG-4 for task 19's archived clause |
| 5 — client | 20–24 | 20 | §8 flows | **BLOCKED** on the 02a design handoff (`docs/design/handoff/02a/`) |

**Total: 24 tasks in 5 batches** (19 hub tasks in batches 1–4; 5 client tasks in batch 5).

## Coverage (§10 test → task)

| Test | Task | | Test | Task |
|---|---|---|---|---|
| 1, 2, 4, 5, 6, 39, 43, 56 | 9 | | 24, 25, 26, 27, 54, 54b | 15 |
| 3 open part / Touch part | 9 / 10 | | 28, 29, 30, 51 | 16 |
| 7, 41 | 10 | | 31 fold / command | 4 / 17 |
| 8 | 11 | | 32 fold / `requireLock` / commands | 4 / 8 / 17 |
| 9, 9b, 59 | 5 (59: SG-2) | | 33 fold / Clean | 4 / 17 |
| 10, 11, 17, 47 | 13 | | 34, 40, 44, 49 | 17 (40 map part: SG-4) |
| 12, 14, 15, 16, 48, 52 | 12 | | 35, 50, 50b | 18 |
| 13 accept / Clean part | 12 (SG-2) / 17 | | 36, 37 | 19 (36 archived: SG-4) |
| 18, 19, 20, 21 | 7 | | 38, 55, 57, 58 | 4 (57, 58: SG-2) |
| 22, 23, 42 | 14 | | 45, 46, 53, 60 | 8 (53: SG-3) |
| 61 | 17 (Bill, Clean) / 18 (CallWaiter) | | 62 | SG-3 (02b) |

---

## Batch 1 — data (§11 steps 2–5)

### Task 1: table event schemas · RISK: NORMAL · Shared

**Spec:** §6.19, §4.4, T7. **§11 step 2.**

**Files:**
- Create: `packages/events/src/events/table/{TableOpened,TableLocked,TableLockTouched,TableLockReleased,TableHolderChanged,TableMoved,TablesMerged,SeatingSplit,BillRequested,TableCleaned}.v1.ts`, test `packages/events/src/events/table/table-events.test.ts`
- Modify (append only): `packages/events/src/index.ts` (one `export *` per file; each file calls `defineEvent({ eventType, version: 1, payload })` from `../../registry.js`, like `order/OrderBoosted.v1.ts`)

**Tests first:** `[02a §6.19] each table event round-trips with its §6.19 payload`; `[02a §6.19] stream_type 'table'; TableMoved / SeatingSplit on the from table, TablesMerged on the into table`; `[02a T7] no payload accepts a session id key` (`.strict()` objects); `[02a §6.19] TableLockReleased.reason enum is exactly the five reasons; alert_id optional`; `[02a §6.19] TableHolderChanged.reason enum take_over | handover | force_move`.

**Names:** `defineEvent` per file, payload consts `<Event>Payload`; event types exactly as §6.19; `party_size: int | null`; `absorbed_seating_id: string | null`; `new_seating_id: string | null`.

**Commit:** `feat(02a): table event schemas [02a §6.19, §4.4; §11 step 2]`
**Done:** the new test file and `packages/events` tests pass; `pnpm --filter @pos/events typecheck` clean.

### Task 2: `TableState` and §9 error codes · RISK: NORMAL · Shared

**Spec:** §9, §3.1 (states), §4.4. **§11 step 2.**

**Files:** Modify (append only) `packages/domain/src/errors.ts` (`ErrorCatalogue` entries `{ status }`), `packages/domain/src/enums.ts` (`TABLE_STATES` const + `TableState` type), `packages/domain/src/index.ts` export if needed; tests `packages/domain/src/errors.test.ts`, `packages/domain/src/enums.test.ts` (new) or the nearest existing test.

**Tests first:** `[02a §9] each new code has its status` (13 codes, table §9); `[02a §9] TABLE_NOT_FOUND, TABLE_ALREADY_LOCKED, TABLE_LOCK_NOT_HELD unchanged`; `[02a §3.1] TableState = FREE | SEATED | ORDERED | FOOD_ON_TABLE | BILL_REQUESTED | NEEDS_CLEANING` (FREE is the map's state of a table with no seating; `CLOSED` stays a row value only, §5).

**Commit:** `feat(02a): TableState and error codes [02a §9, §3.1; §11 step 2]`
**Done:** domain tests pass; `pnpm -w typecheck` clean. Foundation §6.2 already lists the codes (F-3) — check, no spec edit.

### Task 3: migration `0012_tables.sql` · RISK: HIGH

**Spec:** §5 (SQL verbatim). **§11 step 3.**

**Files:** Create `apps/hub/src/db/migrations/0012_tables.sql`, test `apps/hub/test/tables/migration.int.test.ts`.

**Tests first:** `[02a §5] 0012 creates seatings, seating_tables, seating_orders, table_locks with the §5 columns, CHECKs and four indexes`; `[02a §5] seatings.state CHECK refuses an unknown state; close_reason CHECK`; `[02a §5] a fresh DB migrates 0001→0012; re-run is a no-op`.

**Commit:** `feat(02a): tables migration [02a §5; §11 step 3]`
**Done:** test passes; `apps/hub/test/db` passes (migration list).

### Task 4: projection `tables` with the state fold and `reset` · RISK: HIGH · Wiring · needs SG-2, SG-5

**Spec:** §5 bullets, T19, §3.1 (with P-1d), T21, §3.14, §6.19 Fold column. **§11 step 4.**

**Files:** Create `apps/hub/src/tables/projection.ts` (`tablesProjection`, `foldState(seating)`), `apps/hub/src/tables/index.ts` (`registerTablesProjection`); test `apps/hub/test/tables/projection.int.test.ts`. Wiring per SG-5.

**Tests first:**
- `[02a #31 fold]` new `OrderPlaced` / `OrderLinesAdded` after `BillRequested` → ORDERED, `bill_requested_at` cleared; `OrderLinesAdded` sets `served_any = 0`.
- `[02a #32 fold]` `BillClosed { seating_id }` → NEEDS_CLEANING, sticky (SG-2).
- `[02a #33 fold]` every order cancelled → SEATED; bill requested then every order cancelled → SEATED (SG-2).
- `[02a #38]` reset + replay → identical four tables.
- `[02a #55]` takeaway / delivery `OrderPlaced` leaves every row unchanged; `dine_in` with `table_key = 'dine_in:' + S` joins S (prefix stripped, T21); a key naming no open seating is ignored and logged once `{ order_id, table_key }`, **live only**.
- `[02a #57]`, `[02a #58]` (P-1d `has_food` / `served_any`) (SG-2).
- `[02a §3.1]` FOOD_ON_TABLE only over live food orders; `TablesMerged` absorb moves `seating_orders`, closes S2 `merged`; `SeatingSplit` new seating / detach; `TableMoved` re-keys primary and `seating_tables`; `TableCleaned` → CLOSED, tables freed.

**Names:** `eventTypes` = the ten §6.19 types + `OrderPlaced`, `OrderLinesAdded`, `ItemRemoved`, `OrderCancelled`, `OrderFoodServed`, `OrderFoodCleared`, `LineWeightSet`, `LineComped`, `BillClosed` (AD-4: not `ItemServed`).

**Commit:** `feat(02a): tables projection and state fold [02a §5, §3.1, T19, T21; §11 step 4]`
**Done:** tests pass; the gate's projection registry and boot tests still pass (`apps/hub/test/boot`, `test/projections`).

### Task 5: lock part of `tables` — activity fold · RISK: HIGH · needs SG-2 (#59 only)

**Spec:** §3.3, T7, T19, §6.19 lock rows. **§11 step 5.**

**Files:** Modify `apps/hub/src/tables/projection.ts`; test `apps/hub/test/tables/lock-fold.int.test.ts`.

**Tests first:** `[02a #9]` 02b `OrderPlaced` by the lock's (staff, device) refreshes `last_activity_at`; the same event from another device does not; reset + replay → identical lock row; `[02a #9b]` refresh by `OrderLinesAdded` on O, then O split to S3; reset + replay → identical; `[02a #59]` `LineWeightSet` / `LineComped` by the holder refresh, by another person do not, no state change (SG-2); `[02a §3.3]` `TableLocked` upsert (device = envelope), `TableLockTouched` sets `last_touch_at`, `TableLockReleased` deletes, `TableMoved` re-keys, `TableCleaned` / absorb delete.

**Commit:** `feat(02a): lock activity fold [02a §3.3, T7, T19; §11 step 5]`
**Done:** tests pass; task 4's file still passes.

### Batch 1 checkpoint

- [ ] Gate green (command above). Record files, tests, wall time.
- [ ] §12.2 rows: none in this batch. Replay identity #38 and #9 green.
- [ ] Statement counts: none asserted yet (folds are inside the writer's transaction).
- [ ] Board: batch entry in `docs/plans/02a-status.md` (tasks, commits, reviews, gate, tests closed, AD rows); `docs(02a): checkpoint batch 1`; push `module-02a`; STOP for review.

---

## Batch 2 — reads, hooks, lock, open (§11 steps 6–10)

### Task 6: reads and the 03a slip reader pair · RISK: NORMAL · Wiring · needs SG-1 (`zoneOf`), SG-6

**Spec:** §4.2 rows `tableOwners`, `holdersOfOrders`, `seatingOf`, `currentTableOf`, `zoneOf`; §11 step 1 (reader pair); §12.3 note (one statement each). **§11 step 6.**

**Files:** Create `apps/hub/src/tables/reads.ts`; modify `apps/hub/src/tables/index.ts` (`registerTables` calls `registerSlipReaders({ holdersOfOrders, currentTableOf })` from `../engine-host/index.js`), append `registerTables(app, deps)` to `apps/hub/src/server.ts`; test `apps/hub/test/tables/reads.int.test.ts`.

**Tests first:** `[02a §4.2] tableOwners → Map<table_id, holder>, one statement for 40 tables`; `[02a §4.2] holdersOfOrders after move / merge / split → current holder, one statement`; `[02a §4.2] currentTableOf → { seating_id, primary_table_id, table_ids }, one statement`; `[02a §4.2] seatingOf null for a FREE table`; `[02a §4.2] zoneOf 0 statements, table without zone → zone_id null` (SG-1 for `zone_order_taker_staff_id`); `[02a §11 step 1] after registerTables, slipReaders() returns 02a's pair` (and an 03a fires-alerts pass uses it: receiver = holder of the oldest order, label = primary table name).

**Commit:** `feat(02a): table reads and slip reader pair [02a §4.2, §11 step 1, §12.3; §11 step 6]`
**Done:** tests pass; `apps/hub/test/engine/fires-alerts-tick.int.test.ts` (03a #120–#123) still passes (SG-6 ruling applied).

### Task 7: `waiterTeam` and the resolvers · RISK: NORMAL · needs SG-1, SG-6

**Spec:** §3.5, T4, T10, T16, §4.2 resolver rows, §6.16, 01d D-1 (e). **§11 step 7.**

**Files:** Create `apps/hub/src/tables/team.ts`, `apps/hub/src/tables/resolvers.ts`; modify `tables/index.ts` (`registerTargetResolver('table_team', tableTeam)`, `registerTargetResolver('zone_order_taker', zoneOrderTaker)`); tests `apps/hub/test/tables/team.test.ts`, `apps/hub/test/tables/resolvers.int.test.ts`.

**Tests first:** `[02a #18]`, `[02a #19]`, `[02a #20]` (`waiterTeam` unit); `[02a #21]` one batch with `owner` + `direct` for one table → `[holder]` and `W ∪ {holder}`, keyed `targetKey`, one statement for 40 targets (`UNION ALL` of open seatings and live staff sessions via `staff_sessions_active`), `owner_staff_id` = holder, directory via `alertDirectoryOf(tx)`; `[02a §6.16] zone_order_taker 0 statements` (SG-1).

**Commit:** `feat(02a): waiter team and table resolvers [02a §3.5, §4.2, §6.16; §11 step 7]`
**Done:** tests pass; `apps/hub/test/alerts` passes (SG-6 ruling applied).

### Task 8: `requireLock` · RISK: HIGH · needs SG-3 (#53 placement)

**Spec:** §4.2 `requireLock` (with P-1b), §2 (holder-only re-acquire), §3.15, T18. **§11 step 8.**

**Files:** Create `apps/hub/src/tables/lock.ts`; test `apps/hub/test/tables/require-lock.int.test.ts` (a test-only command through `createTestHub({ testCommands: true })` calls `requireLock`).

**Tests first:** `[02a #32 requireLock]` NEEDS_CLEANING → 409; `[02a #45]` moved order's old table → `TABLE_SEATING_CHANGED`, through `currentTableOf` → passes; `[02a #46]` non-holder without `take-order-anywhere` → 403 (free and held); `[02a #53]` (SG-3 form) after a take-over, Bilal with the permission → no `TableLocked`, lock stays free; `[02a #60]` `ctx.queuedAt !== null` on a free lock → nothing taken (AD-1); `[02a §4.2]` holder: free → `[TableLocked]`, same actor other device → `replaced_device_id`, other staff → `TABLE_ALREADY_LOCKED { locked_by_staff_id, locked_by_name }`; `requires_approval` grant = denied (§3.15); 1 statement.

**Commit:** `feat(02a): requireLock [02a §4.2, §2, §3.15; §11 step 8]`
**Done:** tests pass; statement count 1 asserted.

### Task 9: `OpenTable` · RISK: HIGH

**Spec:** §6.1, §3.2, T3, T15, T18, §3.14. **§11 step 9.**

**Files:** Create `apps/hub/src/tables/commands/open-table.ts`; modify `tables/index.ts`; test `apps/hub/test/tables/open-table.int.test.ts`.

**Tests first:** `[02a #1]`, `[02a #2]`, `[02a #3 open]`, `[02a #4]`, `[02a #5]`, `[02a #6]` (two opens, one seating), `[02a #39]` (COMMIT failure → no seating, no lock), `[02a #43]`, `[02a #56]`; plus §10 preamble: retransmit, scope (`my_floors`), stale `seating_id`, archived FREE → 404 (AD-2).

**Names:** `defineCommand({ commandType: 'OpenTable', permission: 'take-order', sessionKind: 'device', … })`; result `{ seating_id, primary_table_id, opened, holder_staff_id }`.

**Commit:** `feat(02a): OpenTable [02a §6.1, §3.2; §11 step 9]`
**Done:** tests pass; §12.2 row 6.1 errors (404, 409×3, 403) each covered; 1 read statement asserted.

### Task 10: `TouchTableLock`, `ReleaseTableLock`, `ForceReleaseTableLock` · RISK: NORMAL

**Spec:** §6.2, §6.3, §6.4, D61. **§11 step 10.**

**Files:** Create `apps/hub/src/tables/commands/lock-commands.ts`; test `apps/hub/test/tables/lock-commands.int.test.ts`.

**Tests first:** `[02a #7]`, `[02a #3 touch]`, `[02a #41]`; preamble per command (retransmit, scope for Force, stale `seating_id`).

**Commit:** `feat(02a): touch, release, force release [02a §6.2–§6.4, D61; §11 step 10]`
**Done:** tests pass; rows 6.2–6.4 covered.

### Batch 2 checkpoint

- [ ] Gate green; record counts.
- [ ] §12.2 rows ticked: **6.1, 6.2, 6.3, 6.4** (each listed error has a test).
- [ ] Statement counts asserted: `tableOwners` / `holdersOfOrders` / `currentTableOf` / `seatingOf` 1 each; `zoneOf` 0; `table_team` 1 for 40 targets; `requireLock` 1; `OpenTable` 1 read.
- [ ] 03a #120–#123 and 01d alerts tests green with the real readers / resolvers registered.
- [ ] Board entry; `docs(02a): checkpoint batch 2`; push; STOP for review.

---

## Batch 3 — tick, holder changes, move, merge (§11 steps 11–15)

### Task 11: tick `table_locks` · RISK: HIGH

**Spec:** §3.4, §6.5, T14. **§11 step 11.**

**Files:** Create `apps/hub/src/tables/tick.ts`; modify `tables/index.ts` (`registerTick`); test `apps/hub/test/tables/tick.int.test.ts`.

**Tests first:** `[02a #8]` TTL → `lock_ttl`; session ended → `session_expired`; at exactly `ttl` neither `due` nor a write; idle → one statement, no `writer.run`; `EXPLAIN QUERY PLAN` of the inner lookup uses `staff_sessions_active_device`; `actor_id = null`, `device_id = 'hub'`; `[02a §3.4]` a new sign-in on the same device does not keep the lock.

**Commit:** `feat(02a): table lock tick [02a §3.4, §6.5; §11 step 11]`
**Done:** tests pass; `due` = 1 statement, pass = 1 read + 1 append asserted.

### Task 12: `closeHandover`, kind `table_handover`, `RequestTableHandover` · RISK: HIGH · needs SG-2 (#13)

**Spec:** §3.8, §3.9, §6.7, §6.15, §11 step 12 (kinds at module top level). **§11 step 12.**

**Files:** Create `apps/hub/src/tables/kinds.ts` (top-level `defineAlertKind`, AD-5), `apps/hub/src/tables/handover.ts` (`closeHandover(ctx, seating_id, note)`), `apps/hub/src/tables/commands/request-table-handover.ts`; test `apps/hub/test/tables/handover.int.test.ts`.

**Tests first:** `[02a #12]`, `[02a #13 accept]` (SG-2), `[02a #14]`, `[02a #15]`, `[02a #16]` (fake clock, steps at 60 s and 120 s to `requester_lead`), `[02a #48]` (`details: {}` with no live order), `[02a #52]` (both drafts carry `alert_id`; no 500); `[02a §11 step 12]` a replayed open `table_handover` after restart is a known kind; preamble (retransmit, scope, stale seating, `not_holder`, receiver reasons).

**Commit:** `feat(02a): table handover with acceptance [02a §3.8, §3.9, §6.7, §6.15; §11 step 12]`
**Done:** tests pass; row 6.7 errors (409×5, 422, 403) covered; statements 1 + 1 + `raise` bound asserted (no `seatingTotals`, AD-3).

### Task 13: `TakeOverTable`, `ForceMoveTable` · RISK: NORMAL

**Spec:** §3.7, §6.6, §6.8, T5, T20. **§11 step 13.**

**Files:** Create `apps/hub/src/tables/commands/holder-commands.ts`; test `apps/hub/test/tables/holder-commands.int.test.ts`.

**Tests first:** `[02a #10]`, `[02a #11]`, `[02a #17]`, `[02a #47]` (take-over, accepted handover, force move each release the old holder's lock `holder_changed`; new holder opens at once).

**Commit:** `feat(02a): take over and force move [02a §3.7, §6.6, §6.8, T20; §11 step 13]`
**Done:** tests pass; rows 6.6, 6.8 covered; statement counts per §6.6 / §6.8 asserted.

### Task 14: `MoveTable` · RISK: NORMAL

**Spec:** §3.10, §6.9, T6, T17. **§11 step 14.**

**Files:** Create `apps/hub/src/tables/commands/move-table.ts`; test `apps/hub/test/tables/move-table.int.test.ts`.

**Tests first:** `[02a #22]`, `[02a #23]`, `[02a #42]`; preamble; scope on both tables.

**Commit:** `feat(02a): MoveTable [02a §3.10, §6.9; §11 step 14]`
**Done:** tests pass; row 6.9 (404, 409×5, 403) covered; 2 reads + `byDedupeKey` + close bound asserted.

### Task 15: `MergeTables` and `registerMergeGuard` · RISK: HIGH

**Spec:** §3.11, §6.10, §4.1 (04 guard), T6. **§11 step 15.**

**Files:** Create `apps/hub/src/tables/merge-guard.ts`, `apps/hub/src/tables/commands/merge-tables.ts`; test `apps/hub/test/tables/merge-tables.int.test.ts`.

**Tests first:** `[02a #24]`, `[02a #25]`, `[02a #26]`, `[02a #27]` (guard stub registered in the test; unregistered → never blocked), `[02a #54]`, `[02a #54b]`; preamble.

**Commit:** `feat(02a): MergeTables and merge guard [02a §3.11, §6.10, §4.1; §11 step 15]`
**Done:** tests pass; row 6.10 covered; 3 reads + guard + 2 `byDedupeKey` + `closeMany` bound asserted.

### Batch 3 checkpoint

- [ ] Gate green; record counts.
- [ ] §12.2 rows ticked: **6.5, 6.6, 6.7, 6.8, 6.9, 6.10**.
- [ ] Statement counts asserted: tick idle 1 / pass 1 + 1; handover 1 + 1 + bound; take-over 1 + 1 + bound; force move 1 + 1 + 1 + bound; move 2 + 1 + bound; merge 3 + guard + 2 + bound.
- [ ] Board entry; `docs(02a): checkpoint batch 3`; push; STOP for review.

---

## Batch 4 — split, bill, clean, call waiter, queries (§11 steps 16–19)

### Task 16: `SplitSeating` · RISK: HIGH

**Spec:** §3.12, §6.11, T17. **§11 step 16.**

**Files:** Create `apps/hub/src/tables/commands/split-seating.ts`; test `apps/hub/test/tables/split-seating.int.test.ts`.

**Tests first:** `[02a #28]`, `[02a #29]`, `[02a #30]`, `[02a #51]` (`holdersOfOrders` one holder per order after a split and a handover of one part); preamble.

**Commit:** `feat(02a): SplitSeating [02a §3.12, §6.11; §11 step 16]`
**Done:** tests pass; row 6.11 (404, 409×6, 403) covered; 3 reads + guard + 1 + bound asserted.

### Task 17: `RequestBill`, `CleanTable` (queueable) · RISK: NORMAL · needs SG-2 (#32, #33 clauses), SG-4 (#40 map part)

**Spec:** §3.13, §6.12, §6.13, §8 Offline (P-1f), §3.14. **§11 step 17.**

**Files:** Create `apps/hub/src/tables/commands/bill-clean.ts`; test `apps/hub/test/tables/bill-clean.int.test.ts`.

**Tests first:** `[02a #31 command]`, `[02a #32]` (Open / Merge / Handover → 409, Clean → FREE), `[02a #33]` Clean → `left_without_order`, `[02a #34]`, `[02a #13 clean]`, `[02a #40]`, `[02a #44]`, `[02a #49]`, `[02a #61]` (`RequestBill`, `CleanTable` registered `queueable: true`; a queued replay reads `ctx.queuedAt`); Clean closes the handover and `call_waiter` with 2 `byDedupeKey` + one `closeMany`.

**Commit:** `feat(02a): RequestBill and CleanTable, queueable [02a §3.13, §6.12, §6.13, P-1f; §11 step 17]`
**Done:** tests pass; rows 6.12 (409×4, 403), 6.13 (409×3) covered; Clean 1 + 2 + bound asserted.

### Task 18: kind `call_waiter` and `CallWaiter` · RISK: NORMAL

**Spec:** §3.13, §6.14 (kind verbatim), D-3. **§11 step 18.**

**Files:** Modify `apps/hub/src/tables/kinds.ts` (top-level, AD-5); create `apps/hub/src/tables/commands/call-waiter.ts`; test `apps/hub/test/tables/call-waiter.int.test.ts`.

**Tests first:** `[02a #35]`, `[02a #50]`, `[02a #50b]`, `[02a #61 CallWaiter]` (not queueable: `X-Queued-At` ignored, `ctx.queuedAt` null).

**Commit:** `feat(02a): CallWaiter and call_waiter kind [02a §3.13, §6.14; §11 step 18]`
**Done:** tests pass; row 6.14 (409×3) covered.

### Task 19: queries, catch-up, audiences · RISK: NORMAL · needs SG-4 (archived clause)

**Spec:** §6.17, §6.18, catch-up part `tables`, §6.19 Audiences, M59. **§11 step 19.**

**Files:** Create `apps/hub/src/tables/queries.ts` (`table-map`, `handover-candidates`, the shared map builder), `apps/hub/src/tables/audiences.ts`; modify `tables/index.ts`; test `apps/hub/test/tables/queries.int.test.ts`.

**Tests first:** `[02a #36]` 3 + 1 statements at 80 tables / 40 seatings; `mine` per (staff, device); archived seated table shown (SG-4); `[02a #37]`; `[02a §6.17] countsAsActivity: false` (session `last_activity_at` unchanged); `[02a §6.18] unknown table → 404`; `[02a §6.19 audiences]` every table event to staff sockets and cashier kiosks of the branch, `TableMoved` / `TablesMerged` / `SeatingSplit` also to KDS stations; catch-up `tables` = the map builder for the socket's (staff, device).

**Commit:** `feat(02a): table-map, handover-candidates, catch-up, audiences [02a §6.17, §6.18, §6.19; §11 step 19]`
**Done:** tests pass; rows 6.17, 6.18 covered.

### Batch 4 checkpoint (hub done)

- [ ] Gate green; record counts.
- [ ] §12.2 rows ticked: **6.11, 6.12, 6.13, 6.14, 6.17, 6.18** — with batches 2–3, all 16 rows.
- [ ] Statement counts asserted: split 3 + guard + 1 + bound; Clean 1 + 2 + bound; `table-map` 3 + 1; `handover-candidates` 2.
- [ ] §12.1 DoD (hub part): every §10 test placed and green except SG-ruled moves; replay identity (#38, #9); statement counts (#8, #21, #36).
- [ ] Board entry; `docs(02a): checkpoint batch 4 — hub done`; push; STOP for review.

---

## Batch 5 — client (§11 step 20) · **BLOCKED on the design handoff**

There is no `docs/design/handoff/02a/` yet; only the inventory `docs/design/inventory/02-ordering-tables.md`. The hub tasks are **not** blocked by this. The design can be made in parallel from this list (§8; inventory IDs in brackets). Files: `apps/client/src/features/staff/tables/`, append-only lines in `StaffApp.tsx`, `SignIn.tsx`, `api.ts`, `i18n/{en,ur}.ts`.

**Screens §8 needs (for the design brief):**

| § 8 item | Screen / state | Inventory | Devices |
|---|---|---|---|
| Login | Staff entry from `staff-roster`; `401 DEVICE_TOKEN_INVALID` / `403 DEVICE_REVOKED` → wipe token → `/pair` (pair-page resume) | 02-S01, 02-S02 | T, K, P |
| Table map | Floor tabs → zone groups → tiles: icon + word per state (fixed palette §3.1), names, "T4 + T5", holder initials, assignee when ≠ holder, padlock + locker name, time open, `party_size`, "archived" mark; filter "Mine" | 02-S03, 02-B01 | T, K, P |
| Open refused | `TABLE_ALREADY_LOCKED` → "Ali is taking an order here" + Force release (reason chips) | 02-B01, 02-D12 | T, K, P |
| Table sheet | Take over (assignee), Hand over (candidates, working first), Force move, Move, Merge, Split, Ask for bill, Clean, Call waiter (four chips) | 02-S06 actions, 02-D09, 02-D10, 02-D11, 02-D13, 02-D01 | T, K (P: subset) |
| `403 other_owner` | "Hand it over to Sara; she moves it" + Hand over preset to Sara | new | T, K |
| Handover card (receiver) | Accept / Decline; `TABLE_HANDOVER_STALE` → "Bill paid, waiting for cleaning" | new (01d card) | T, K, P |
| Handover waiting card (sender) | "Waiting for Bilal — 0:42", Withdraw | new (01d AD-1) | T, K, P |
| Banners | lock released (reason); "Opened on another device"; holder changed → "Ali now has this table. Keep as draft" (+ Send only with `take-order-anywhere`) | 02-B08, 02-B03, new | all |
| Call waiter sent | "Call sent 1 min ago" on the map; "Nobody else is working" at `recipients: 0` | new | T, K, P |
| Top bar | Requests (n) + Inbox (n) | 01d AD-168 | all |
| Offline | Open / Take over / Hand over / Force / Move / Merge / Split disabled "Needs the hub"; Ask for bill, Clean queued; Call waiter "Needs the hub"; queue log shows drops on `TABLE_SEATING_CHANGED` | 02-B02 | all |

| Task | Title | Tests (§12.1 "§8 flows") |
|---|---|---|
| 20 | Login resume and staff-entry route branch | `[02a §8 Login]` |
| 21 | Table map and tiles, "Mine" filter, catch-up + frames | `[02a §8 Table map]` |
| 22 | Table sheet, dialogs, `other_owner` hand-over preset, Force release | `[02a §8 Table sheet]` |
| 23 | Banners, handover cards, call-waiter state, offline rules (RequestBill / CleanTable through 02b's queue when it exists) | `[02a §8 Banners]`, `[02a §8 Offline]` |
| 24 | Playwright flows on tablet and phone viewports | §12.1 "§8 flows pass on a tablet and a phone" |

Each client task gets its full TDD steps when the handoff lands (a short plan patch, owner-approved). Commits: `feat(02a): <screen> [02a §8; §11 step 20]`.

---

## Claude Code kickoff

Paste this into a fresh Claude Code session in the repo (`~/pos`), after the owner has ruled the SG rows the batch needs:

```text
Repo: arsiihere/pos. Branch: module-02a (git fetch; git checkout module-02a; git pull). Never push to main or any other branch; no merge, rebase, reset or force-push.

Build 02a Tables, BATCH 1 only, from docs/plans/02a-plan.md (spec docs/specs/02a_Tables_Spec_v1.1.1.md, APPROVED).
Use superpowers:subagent-driven-development with superpowers:test-driven-development: one fresh implementer and one fresh reviewer per task (opus for RISK: HIGH), failing test first, one task per commit, commit message as the task says, author "Arslan Ahmed Arif" <arsiiahmi@gmail.com>.

Before starting, read docs/plans/02a-status.md. If SG-2 or SG-5 is not "ruled", build tasks 1–3 only, then STOP. Never pick an SG option yourself.

Rules: CLAUDE.md. Spec wins over the plan. Spec–code mismatch, a file outside the plan's list, a changed bound or new behaviour → STOP and add a row to docs/plans/02a-status.md ("proposed (not yet ruled)"). Implementers run only their own files; the controller runs the gate once per batch:
TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"
Never run pnpm test:perf. Never stop or restart the pos-pg-test container.

After the batch: gate green, batch entry in docs/plans/02a-status.md (tasks, commits, reviews, gate counts, tests closed, AD rows), commit it alone as "docs(02a): checkpoint batch 1", git push origin module-02a, then STOP for review. Do not start batch 2.
```

For later batches, change "BATCH 1" and the SG precondition line to the batch's row in the Batches table.

---

## Self-review (writer, 2026-11-09)

- **Coverage.** §11 steps 2–20 are tasks 1–24 (step 2 split into tasks 1 and 2; step 20 into tasks 20–24). Step 1's hooks are registered in tasks 6 (reader pair), 7 (resolvers), 17 (`queueable`). Every §10 test 1–62 (with 9b, 50b, 54b) is placed once, or in parts with a named split, or named under an SG row (#62).
- **§12.2.** All 16 rows close across batches 2–4; each checkpoint names its rows.
- **Names.** Taken from the code at `2fa2db0` (table "Exact names"); 02a's own names are fixed in "02a exports".
- **Open.** SG-1–SG-6 need the owner; AD-1–AD-5 are proposed readings.
