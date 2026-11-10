# 02b Ordering — Implementation Plan (spec v1.0.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development with superpowers:test-driven-development inside every task. The hub is built in **parallel waves** (section "Parallel waves"; prompts in `docs/plans/02b-parallel-prompts.md`), the way 02a was. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build module 02b Ordering on the hub (02b §1.2): orders and lines, `SubmitOrder` with config checks, zone routing and zone-served lines, stage-1 removal and `OrderCancelled`, the per-line money ledger, weighed lines, Served by tap, release / boost / return, comps with the approval kind, zone stock with its low / out kinds, token and parking fields, the exports other modules use, five queries, the `orders` catch-up part and audiences, and 02b's use of queued replays. Then the staff client (§8), once its design handoff exists.

**Architecture:** one projection `orders` (with `reset`) writes `orders`, `order_lines`, `zone_stock` in `0013_orders.sql` and folds only its own events (§5, 02a T19). Ten commands, three kinds, five queries, one catch-up part (§6, size 19). The engine stays pure (`@pos/engine`): commands call `checkOrderable`, `reserveStock`, `planOrder`, `calculateETA`, `stockEffects`, `planRelease`, `isOrderInEngine` on `ctx.state`. 02a's `tables` projection already folds every 02b event it needs (P-1d, built in 02a task 1b / task 4). No tick (`served_estimate` waits for 03b, O14).

**Tech Stack:** as CLAUDE.md. **No new dependency.** No cloud change, no cloud migration.

**Spec:** `docs/specs/02b_Ordering_Spec_v1.0.3.md` (APPROVED; v1.0.3 = v1.0.2 + the AD-11 zone-alert close rule, owner 2026-11-10; cited "§x", tests "#n"). Context only: 02a v1.1.4 (§4.2 reads, `requireLock`, T19, T21), 03a v1.2 §4.2 (`ProposedOrder`, events), 01c v1.1.2 §3.4.8 / §4.3 (deal money, `ItemAdded`), 01d v1.2.1 §3.4 (`alerts.*`, approval), 01a v2.3 A-1 (zones, settings), 01b v1.7 §3.3 (permissions, `my_zones`). **Read the cited section before each task**; the plan does not repeat the spec's tables, SQL or rule text. Plan and spec disagree → the spec wins: STOP and ask (CLAUDE.md).

**Starting point:** `main` at `67c84c6` (02a hub merged, spec v1.1.4). Branch `module-02b` re-cut from it (G-7 ruling). Next free hub migration: **`0013`**. Nothing of 02b exists: no `apps/hub/src/orders/`, no 02b codes in `errors.ts`.

**Already built elsewhere (do not rebuild):** 02a task 1b: `OrderCancelled`, `OrderFoodServed`, `OrderFoodCleared`, `LineWeightSet`, `LineComped` schemas (`packages/events/src/events/order/`), and 02a's fold of them. 02p: `OrderPlaced` E-1 fields (`has_food`, `sent_after_reconnect`, …), `ItemAdded` C-1 fields, `ItemRemoved.units`, `ItemServed.source/served_at`, `ItemVoided.refund_minor/comp_voided_minor`, `StockTransferredOut`, engine Q-3 / Q-5 / Q-6, 00 H-1 (`X-Queued-At`, `ctx.queuedAt`, idle pause; 00 tests 152–158), 01a A-1 (V4 `zones[].routes[]`, `.stock_items[]`, `is_ready_item`, settings), 01b B-1–B-5 (permissions `set-line-weight`, `manage-zone-stock`, `view-customer-contact`, scope `my_zones`).

---

## Gaps — ruled (owner, 2026-11-10)

| # | Ruling |
|---|---|
| G-1 | **(a)** 02a hook `registerSeatingTotals(fn)` in `tables/handover.ts` (like `registerMergeGuard`); 02b registers `seatingTotals` in `registerOrders`; task 23 edits those two 02a files and the 02a #12 test. |
| G-2 | **(a)** standing pre-approval: test-only edits that make an existing test count / reset what is registered (kinds, projections, audiences, commands, catch-up parts, statement bounds that include per-projection upserts); no production code, no assertion weakened; each listed in the wave entry. |
| G-3 | **(a)** one append-only line + import in `apps/hub/src/lib/boot.ts` `createDeps` and `apps/hub/test/helpers/test-hub.ts`, next to `registerTablesProjection`. |
| G-7 | `module-02a` merged into `main` (`67c84c6`); `module-02b` re-cut from `main` with the plan commit carried over. |

### Gap record (as found)

Found while writing this plan (CLAUDE.md: never silently diverge). Each is a **G** row on `docs/plans/02b-status.md`, "proposed (not yet ruled)". A task that depends on an open G row does not start.

| # | Gap | Where it bites | Options (no pick) | Blocks |
|---|---|---|---|---|
| **G-1** | 02a §3.8: the handover card's `amount` comes from 02b's `seatingTotals` "once 02b is built"; 02a AD-3 left it out with no stub. Neither spec says **who wires it** or how 02a reaches a 02b function (02a may not import 02b). | 02a `tables/handover.ts` | (a) 02b task 23 adds a tiny hook in 02a (`registerSeatingTotals(fn)`, like `registerMergeGuard`) and 02b registers `seatingTotals` in `registerOrders`; edits two 02a files + 02a #12 test; (b) leave `amount` out until 05 | Task 23 only |
| **G-2** | 02b registers 3 kinds, 1 projection, ~19 audiences, 10 commands, 1 catch-up part. Existing suites that **list or count** registered things (as 02a hit with ticks, slip readers, resolvers, projection upserts: SG-6, AD-12, AD-14) may go red in files 02b does not own. | any wave | (a) standing pre-approval: test-only edits that make such a test count / reset what is registered (no production code, no assertion weakened, each noted in the wave entry); (b) STOP each time | none (avoids night STOPs) |
| **G-3** | Projection registration point: `orders` must be registered in `apps/hub/src/lib/boot.ts` `createDeps` and `apps/hub/test/helpers/test-hub.ts`, next to 02a's `registerTablesProjection` (02a SG-5 precedent). | Task 6 | (a) same as 02a SG-5: one append-only line + import in each | Task 6 |

**Proposed readings (not blockers; AD rows on the board):**
- **AD-1:** §3.2 step 2 `requireLock(…, { ...ctx, queued })` = 02a as built: `requireLock(tx, ref, ctx)` reading `ctx.queuedAt !== null` (02a AD-1). 02a v1.1.3 also makes a queued call never **move** a lock; 02b inherits that and does not restate it (next 02b text bump: cite 02a v1.1.3 in the header and §3.2 step 2).
- **AD-2:** #31 mixes 00 behaviour built and tested in 02p (00 tests 152–158: idle pause, cap, `X-Queued-At` clamp and CORS, ended sessions) with 02b's own use. Task 22 writes only 02b's clauses (`sent_after_reconnect`, `ItemServed.served_at`, queued submit takes / moves no lock, `X-Queued-At` ignored on a non-queueable 02b command, queued replay accepted with an emptied zone (#13)); task 24 maps every other #31 clause to its 00 test by name.
- **AD-3:** 02a moved two of its tests here (02a SG-3): **[02a #53 order]** (after a take-over, Bilal with `take-order-anywhere` submits from his draft → order written, lock stays free) in task 11; **[02a #62]** (`MarkServed` by a non-holder → allowed) in task 17.
- **AD-4:** #34 (perf) is written in task 24 as a `*.perf.test.ts` and **not run** by any agent (CLAUDE.md: `pnpm test:perf` only on the real disk, alone, by the owner).
- **AD-5:** 05 will write both 02b's `OrdersBilled { order_ids, bill_id }` and 02a's `BillClosed { seating_id }` (02a SG-2) on a bill close; task 24 adds it to `docs/OPEN-QUESTIONS.md` §5 for the 05 spec; nothing to build here.
- **AD-6:** zone events (`ZoneStockAdded`, `ZoneStockSet`) are on stream `table` with id `'zone:' + zone_id` (§6.19); 02a's projection and audiences select by event type, so they never see them. Task 2 asserts the stream; task 21 asserts no 02a reader picks them up.

**G-7 (process):** ruled above.

---

## Markers

| Marker | Meaning |
|---|---|
| **RISK: HIGH** | Fresh implementer, then a full review by a fresh **opus** reviewer against the cited sections, the task's tests and the Global Constraints. HIGH = migration (3), projection (6), ledger (8), food rules (9), `SubmitOrder` (11), zone-served submit (12), `RemoveItems` (14), comp (16), return (19), queued replays (22). |
| **RISK: NORMAL** | Fresh implementer, then one fresh reviewer (opus). |
| **Shared** | Touches `packages/domain` or `packages/events`. Never two in parallel (all in wave 0). |
| **Wiring** | Adds an append-only line to a shared wiring file. |
| **UI** | Client only. Implementer may be sonnet; reviewer opus. |
| **BLOCKED** | Waits for a G row or the design handoff. |

## Global Constraints

Every task implicitly includes these (same as 02a, with 02a's lessons).

- **Agents:** one fresh implementer and one fresh reviewer per task. No subagent spawns subagents. Review fix round past 2 → STOP.
- **TDD:** failing test first; record the failure; then implement. Names cite the spec: `it('[02b #9] …')`; a split clause is `[02b #23 serve]`; support tests `[02b §3.4] …`. Each numbered clause lives in one task (Coverage table).
- **Every command (§6 common rules):** happy path, each error code of its §12.2 row, D32 retransmit (same `command_id` → same response, no new event), scope last (C8, `403 PERMISSION_DENIED { reason: 'outside_scope' }`), dine-in stale `seating_id` (`409 TABLE_SEATING_CHANGED`) where the command carries one.
- **Implementer runs:** only their own files: `pnpm vitest run <files>`, `pnpm --filter <pkg> typecheck` **and** `pnpm --filter @pos/hub typecheck:tests` (02a owner rule).
- **Gate (per wave, integrator only):** `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`. No timing asserts in the normal gate (03a AD-32).
- **Statement counts:** `statementCounter(db)` (`apps/hub/test/helpers/statement-counter.ts`) wherever §6 / §3.2 states a count; "statements exclude 01d's own bounds and the append" (§6 common rules).
- **Commit:** one task per commit, only the task's files. `feat(02b): <title> [02b §x; §11 step N]`. Review fixes: `fix(02b): task N review … [02b §x]`. Author `Arslan Ahmed Arif <arsiiahmi@gmail.com>`.
- **Push:** only `module-02b`, only by the integrator. No merge, rebase, reset or force-push; tags local only.
- **Files:** own folders `apps/hub/src/orders/`, `apps/hub/test/orders/`, `apps/client/src/features/staff/orders/`; append-only lines in `apps/hub/src/server.ts` (`registerOrders(app, deps)`), `packages/events/src/index.ts`, `packages/domain/src/errors.ts`; new `apps/hub/src/db/migrations/0013_orders.sql`; i18n strings; G-1 / G-2 / G-3 rulings. Anything else → STOP.
- **Readings:** an `AD-n` row on `docs/plans/02b-status.md`, "proposed (not yet ruled)". Never accept your own reading.
- **Questions:** never wait on an interactive question menu. Write the question as a STOP block (what, where in the spec / code, options, your recommendation), commit nothing for that clause, tag `02b-lane-<N><X>-stop`, keep building the lane's other clauses if they do not depend on it, and stop when nothing is left. (02a lane 2A waited 8 h on an unseen menu.)
- **Events:** schema version 1, no session ids, times = `recorded_at`, device = envelope `device_id`. **Logs:** `order_id`, `command_type`, `order_type`, line count, `queued`; never names, phones or totals (§7).
- **No hard-coded names** (role, staff) in code (R5, R18).

## Exact names from today's code

| Need | Name and place |
|---|---|
| Engine (pure, `@pos/engine`) | `checkOrderable(state, proposed)` (throws), `planOrder(state, proposed, now, from_stock) → PlanResult`, `calculateETA(state, proposed, now, from_stock?)`, `ProposedOrder`, `ProposedLine` (`plan.ts:1091–1252`); `reserveStock(state, proposed, dayStartMs, stockItems, configStockUnits) → { drafts, from_stock, refused }`, `stockEffects(state, draft \| drafts, stock_ctx?)`, `openDayStartMs(state)`, `dayDraws`, `saleUnitsAvailable` (`stock.ts`); `isOrderInEngine(state, order_id, t)`, `ORDER_EXIT_AFTER_SERVED_MS` (`lifecycle.ts`); `planRelease(state, order_ids, { released, expedite })` (`slip.ts:695`); `isEngineLine` (`plan.ts:17`); `applyEvent(s, e, { strict: false })` |
| Hub stock helpers | `withStockEffects(ctx, drafts, stockCtx?)`, `openDayStockCtx(state)` (`apps/hub/src/commands/set-precooked-stock.ts:51, :58`) — pattern: `apps/hub/src/commands/add-precooked-stock.ts` |
| Menu money (`@pos/domain` `menu-lines.ts`) | `orderLineTotalMinor`, `allocateDealMinor(total, weights)`, `checkOptionChoices`, `isGroupSatisfiable`, `isItemOrderable`, `childQuantity`, `optionChargeMinor` |
| Commands | `defineCommand({ commandType, payloadSchema, sessionKind: 'device', permission, queueable?, approvable?, handle(ctx, payload, cmd) })`; `ctx.{state, tx, actor, directory, permission, clock, ids, queuedAt}` (`commands/registry.ts`); registration through `commandRegistry` (`commands/route.ts`) |
| Alerts | `alerts.{raise, raiseMany, close, closeMany, listOpen(db, { kind?, subject? }), byDedupeKey}` (`alerts/raise.ts:557`), `defineAlertKind` (`alerts/kinds.ts:103`), `APPROVAL_TIER_STEPS` (`alerts/kinds.ts:187`), `checkAlertIds` |
| 02a | `seatingOf`, `currentTableOf`, `zoneOf`, `holdersOfOrders` (`tables/reads.ts`), `requireLock(tx, { table_id, seating_id }, ctx)` (`tables/lock.ts`), tables `seating_orders`, `seatings` (read-only joins, P-1c), `registerTablesProjection` placement in `lib/boot.ts` / `test-hub.ts` |
| Queries / catch-up / audiences | `defineQuery`, `registerCatchUp({ part, appliesTo, build(db, state, socket) })`, `registerEventAudience(type, fn)` (as 02a used them) |
| Config | `branchConfig()` V4: `floors[].zones[].routes[] { item_id, station_id }`, `.stock_items[]`, `items[].is_ready_item`; settings `queue_auto_send_max_ms`, `zone_undo_ms`, `slow_item_threshold_ms`, `comp_reason_chips` (`packages/events/src/config.ts:305–318`) |
| Errors already there | `ZONE_NOT_FOUND`, `MENU_ITEM_NOT_FOUND`, `DEAL_NOT_FOUND`, `TABLE_*`, `ITEM_WRONG_STAGE`, `STATION_PAUSED`, `ORDER_NOT_IN_ENGINE`, `RETURN_ALREADY_OPEN`, `BUSINESS_DAY_NOT_OPEN` |
| Test helpers | `createTestHub`, `seedDirectory`, `pairDevice`, `openSession`, `statementCounter`, `connectWs` |

## 02b exports and contracts (task 4 writes them as types; all in `apps/hub/src/orders/`)

```ts
// contracts.ts — types only (task 4)
export type LineView = { order_item_id; line_kind; name; units; live_units; comped_units; removed_units; voided_units; returned_units;
  refundable_minor; comp_minor; comp_voided_minor; removed_minor; refund_minor; line_total_minor; billed_minor;
  served_at; served_source; zone_served; /* + projection columns the commands need */ };
export type OrderView = { order_id; order_type; table_key; placed_by; placed_at; follow_up; cancelled; billed; has_phone; lines: LineView[] };
export type SeatingTotals = (db, seating_id: string) => { total_minor: number; order_count: number };          // §4.2, 1 statement
export type OrderLines = (db, order_ids: readonly string[]) => Map<string, LineView[]>;                        // 1 statement
export type OrdersOf = (db, seating_id: string) => OrderView[];                                                // 1 statement
export type LineShares = (line: { refundable_minor; units; comped_units; removed_units; voided_units; comp_minor }) =>
  { next_share_minor(n: number): number; comped_take_back_minor(n: number): number };                          // 0 statements, pure
export type LineChangeDrafts = (tx, order_id: string, changes: { order_item_id: string; units_out: number }[]) => EventDraft[]; // 2
export type FoodDrafts = (order_id: string, lines: readonly LineView[], after: 'served' | 'change' | 'return') => EventDraft[];   // pure, §3.3
export type ZoneAlertDrafts = (ctx, changes: { zone_id; item_id; before: number; after: number }[]) => EventDraft[];               // §3.10
export type BuildSubmit = (config, input: SubmitInput) => { proposed: ProposedOrder; itemAdded: ItemAddedPayload[]; zoneCandidates: string[] }; // pure
// index.ts
export function registerOrders(app, deps): void;              // commands, kinds, queries, catch-up, audiences
export function registerOrdersProjection(projections): void;  // G-3
```

---

## Batches → waves

| Wave | Tasks | §11 steps | §12.2 rows closed | Starts when |
|---|---|---|---|---|
| 0 — foundation (integrator) | 1, 2, 3, 4, 5 | 1, 2, 3 (migration), 15 (kinds) | 12, 13 (kinds) | now |
| 1 — data and pure rules (3 lanes) | 6, 7 · 8, 9 · 10 | 3, 4, 5, 16 | — | wave 0 green |
| 2 — commands (4 lanes) | 11, 12, 13 · 14, 15, 16 · 17, 18, 19 · 20 | 6–15 | 1–11 | wave 1 green |
| 3 — reads, queue, hand-off (3 lanes) | 21 · 22 · 23 | 17, 18 | 14–19 | wave 2 green |
| 4 — perf file and acceptance (integrator) | 24 | 22 | all 19 | wave 3 green |
| 5 — client | 25, 26, 27 | 19, 20, 21 | §8 | **BLOCKED** on `docs/design/handoff/02b/` |

**Total: 27 tasks** (24 hub, 3 client).

## Coverage (§10 test → task)

| Test | Task | | Test | Task |
|---|---|---|---|---|
| 1, 4, 5, 7, 8, 9, 10, 16 | 11 | | 22 | 17 (queued serve: 22) |
| 2, 6, 11 | 10 | | 23 submit / remove / serve / boost | 11 / 14 / 17 / 18 |
| 3 pure / preview-vs-submit | 10 / 13 | | 24 | 18 |
| 12, 13 | 12 (13 queued clause: 22) | | 25, 40 | 19 |
| 14 alerts / commands | 5 / 20 | | 26, 27 | 16 |
| 15, 17, 18 | 14 | | 28 | 6 |
| 19, 20, 37, 38, 39 pure / command | 8 / 14, 16 (39 approved-comp clause: 16) | | 29 fold / exports | 6 / 7 |
| 19 weight clause, 21 | 15 | | 30 fold / open-orders | 6 / 21 |
| §3.3 food rules (in #12) | 9 | | 31 | 22 (00 clauses mapped: 24) |
| 32, 33 queries | 21 (33 eta-preview: 13; refill tile: 20) | | 34 | 24 (written, not run) |
| [02a #53 order] | 11 | | [02a #62] | 17 |
| 35, 36 | client 25, 26 | | | |

---

## Wave 0 — foundation (integrator, sequential)

### Task 1: §9 error codes · RISK: NORMAL · Shared
**Spec:** §9. **§11 step 1.** **Files:** append `packages/domain/src/errors.ts` (`ErrorCatalogue`), `packages/domain/src/errors.test.ts`. **Tests first:** `[02b §9] each new code has its status` (14 codes); `[02b §9] reused codes unchanged`. Check Foundation v1.11 §6.2 lists them (no bump, R34); missing → STOP. **Commit:** `feat(02b): error codes [02b §9; §11 step 1]` **Done:** domain tests pass, `pnpm -w typecheck` clean.

### Task 2: the four missing event schemas · RISK: NORMAL · Shared
**Spec:** §6.19, §5, O17. **§11 step 2.** **Files:** create `packages/events/src/events/order/{OrderContactSet,OrdersBilled}.v1.ts`, `packages/events/src/events/table/{ZoneStockAdded,ZoneStockSet}.v1.ts`; append `packages/events/src/index.ts`; tests appended to `order-events.test.ts`, `table-events.test.ts`. **Tests first:** round-trip with the §6.19 payload; `OrdersBilled` on stream `order` (first `order_id`); zone events on stream `table`, id `zone:<zone_id>` (AD-6); `[02b §6.19] the five schemas 02a built match §6.19 exactly` (no edit; mismatch → STOP); `OrderPlaced` has no contact field (O17). **Commit:** `feat(02b): OrderContactSet, OrdersBilled, zone stock events [02b §6.19; §11 step 2]` **Done:** events tests pass.

### Task 3: migration `0013_orders.sql` · RISK: HIGH
**Spec:** §5 (SQL verbatim). **§11 step 3.** **Files:** `apps/hub/src/db/migrations/0013_orders.sql`, `apps/hub/test/orders/migration.int.test.ts`; append 0013 to the migration list pinned in `apps/hub/test/alerts/alerts-migration.int.test.ts` (as 02a task 3 did). **Tests first:** `[02b §5] 0013 creates orders, order_lines, zone_stock with the §5 columns, CHECKs and three indexes`; ledger CHECKs refuse a bad row; fresh DB migrates 0001→0013, re-run no-op. **Commit:** `feat(02b): orders migration [02b §5; §11 step 3]`.

### Task 4: `orders/contracts.ts`, `index.ts` skeleton, test fixtures · RISK: NORMAL · Wiring
**Spec:** §4.2; plan "02b exports and contracts". **Files:** `apps/hub/src/orders/contracts.ts` (types only), `apps/hub/src/orders/index.ts` (`registerOrders`, `registerOrdersProjection` with **one marker comment per lane per wave**, as 02a's final skeleton), append `registerOrders(app, deps)` to `server.ts`; `apps/hub/test/orders/fixtures.ts`: `appendOrder(hub, { order_type, seating_id?, lines })` that appends real `OrderPlaced` + `ItemAdded` (+ `StockReserved`) through the writer with the engine fields a fixture day needs, `fixtureMenu()` (piece, g, deal with parts, option child, ready item, zone item), `openDay(hub)`. **Tests first:** `[02b §4.2] contracts compile` (`expectTypeOf`); `[02b fixtures] appendOrder writes an order the engine holds` ; buildHubServer calls `registerOrders` once. **Commit:** `feat(02b): order contracts, wiring skeleton, fixtures [02b §4.2]`.

### Task 5: zone kinds and `zoneAlertDrafts` · RISK: NORMAL
**Spec:** §6.13 (verbatim), §3.10 Alerts, §6.19 (stream `table`, `zone:`). **§11 step 15 (kinds part).** **Files:** `apps/hub/src/orders/zone-kinds.ts` (top-level `defineAlertKind` × 2, imported by `index.ts`), `apps/hub/src/orders/zone-alerts.ts`; `apps/hub/test/orders/zone-alerts.int.test.ts`. **Tests first:** `[02b #14 alerts]` above → ≤ threshold raises `zone_stock_low` (dedupe `zone_low:<z>:<i>`, targets `manage-zone-stock` + managers at step 0); reaching 0 raises `zone_stock_out` while low is open; back above closes both `done`; one `listOpen` for `zone:<id>`; known kinds after a boot replay. **Commit:** `feat(02b): zone stock kinds and alert drafts [02b §6.13, §3.10; §11 step 15]`.

### Wave 0 checkpoint
- [ ] Gate green; files, tests, wall time recorded. §12.2 rows 12, 13 (kinds). Board entry "Wave 0"; `docs(02b): checkpoint wave 0`; push; STOP.

---

## Wave 1 — data and pure rules

### Task 6: projection `orders` with `reset` · RISK: HIGH · Wiring (G-3 (a)) — lane 1A
**Spec:** §5 bullets, §3.3 (billed, day close), §3.4 (ledger columns from events), §3.10 counts, §6.19 Fold column, O17, T19. **§11 step 3.** **Files:** `apps/hub/src/orders/projection.ts`; G-3 lines in `lib/boot.ts`, `test/helpers/test-hub.ts`; `apps/hub/test/orders/projection.int.test.ts`. **Tests first:** `[02b #28]` live = replay over a fixture day, `orders` registered before and after `tables`; `[02b #29 fold]` `OrdersBilled` sets `billed_at` on every listed order; `[02b #30 fold]` day close sets `day_closed_at` only on cancelled / billed / finished orders (deal finished when every part served; billed dine-in with an untapped line leaves; carried order leaves at the next close); `[02b §5]` each event's fold (contact columns only from `OrderContactSet`; `ItemServed` `served_at = min(served_at, recorded_at)`; `LineWeightSet` sets `refundable_minor`; zone `ItemAdded` −, zone `ItemRemoved` + always, `ZoneStockAdded` +, `ZoneStockSet` =; `ItemVoided` uses its `refund_minor` / `comp_voided_minor`); no read of another projection. **Commit:** `feat(02b): orders projection [02b §5, §3.3, §3.10, T19; §11 step 3]`.

### Task 7: exports `seatingTotals`, `orderLines`, `ordersOf` · RISK: NORMAL — lane 1A
**Spec:** §4.2, §3.13, §3.4 (`billed_minor`, deal rule), P-1c. **§11 step 16.** **Files:** `apps/hub/src/orders/exports.ts`; `apps/hub/test/orders/exports.int.test.ts`. **Tests first:** `[02b #29 exports]` merge T5 into T4 → T5's order in T4's `seatingTotals` / `ordersOf`; `[02b #37 totals]` untouched family deal → `seatingTotals` 320 000, parts `billed_minor` 0; pending weight 0, return lines 0; one statement each (40 orders). **Commit:** `feat(02b): seatingTotals, orderLines, ordersOf [02b §4.2, §3.13; §11 step 16]`.

### Task 8: ledger `lineShares` and cascades (pure) · RISK: HIGH — lane 1B
**Spec:** §3.4 (all bullets), O19–O21, 01c §3.4.8. **§11 step 4.** **Files:** `apps/hub/src/orders/ledger.ts`; `apps/hub/test/orders/ledger.test.ts`. **Tests first:** `[02b #19 pure]` every ledger clause on plain counters; `[02b #20]` 1 000-sequence property test (fixed seed); `[02b #37 pure]`, `[02b #38 pure]`, `[02b #39 pure]` cascade caps and per-line event shapes as pure drafts; `[02b §3.4] gml_deal_part_partial` rule. **Commit:** `feat(02b): per-line money ledger [02b §3.4, O19–O21; §11 step 4]`.

### Task 9: food rules `foodDrafts` (pure) · RISK: HIGH — lane 1B
**Spec:** §3.3 (food line, `OrderFoodServed`, `OrderFoodCleared` gate), P-1d, owner Q5. **Supports §11 steps 9, 11, 13.** **Files:** `apps/hub/src/orders/food.ts`; `apps/hub/test/orders/food.test.ts`. **Tests first:** `[02b §3.3]` `is_food` = engine line ∧ not zone-served ∧ ¬ready; served food → `OrderFoodServed`; served water only → none; change leaving a live order with no live unserved food → `OrderFoodCleared { food_served }`; non-food return with a karahi still cooking → none (N-1); no-station or ready live line never blocks (R-4). **Commit:** `feat(02b): food rules for table state [02b §3.3, P-1d]`.

### Task 10: `buildSubmit` and zone routing (pure) · RISK: NORMAL — lane 1C
**Spec:** §3.2 steps 3–7, §3.1, O3, O4, O5 (candidates only), D25, 01c §4.3. **§11 step 5.** **Files:** `apps/hub/src/orders/build-submit.ts`; `apps/hub/test/orders/build-submit.test.ts`. **Tests first:** `[02b #2]` each `line_kind` copies 01c §4.3 (deal allocation 229 315 / 12 508 / 78 177; batch cook times; notes); `[02b #6]` Off / out of hours (hub time) / unsatisfiable group / linked option unavailable → each code; `[02b #11]` zone route wins, takeaway ignores it; `[02b #3 pure]` the function uses the config it is given; repeated id → 400 path; delivery → 422 path `order_type`; parking `car_number_norm`. **Commit:** `feat(02b): build submit lines and zone routing [02b §3.2, §3.1; §11 step 5]`.

### Wave 1 checkpoint
- [ ] Gate green. Replay identity #28. Statement counts: exports 1 each. Board "Wave 1"; push; STOP.

---

## Wave 2 — commands

### Task 11: `SubmitOrder` · RISK: HIGH — lane 2A
**Spec:** §6.1, §3.2 (steps 1–4, 6–11), §3.11, §3.14. **§11 step 6.** **Files:** `apps/hub/src/orders/commands/submit-order.ts`; `apps/hub/test/orders/submit-order.int.test.ts`. **Tests first:** `[02b #1]` (batch order exactly 03a :615; statement count 7 + append), `#4`, `#5`, `#7`, `#8`, `#9`, `#10`, `#16`; `[02b #23 submit]` default order taker outside floors, default cashier takeaway; `[02a #53 order]` (AD-3); preamble. **Names:** `queueable: true`; result §3.2 step 11 (`promise_ms` only). **Commit:** `feat(02b): SubmitOrder [02b §6.1, §3.2; §11 step 6]` **Done:** row 1 errors covered.

### Task 12: zone-served path in submit · RISK: HIGH — lane 2A
**Spec:** §3.2 step 5, 10, O5, §3.10, Q-3. **§11 step 7.** **Files:** `orders/commands/submit-order.ts` (lane-owned), `apps/hub/test/orders/submit-zone.int.test.ts`. **Tests first:** `[02b #12]` (every clause, incl. both projections in either order), `[02b #13]` (except the queued clause, task 22). **Commit:** `feat(02b): zone-served lines at submit [02b §3.2, §3.10, O5; §11 step 7]`.

### Task 13: `eta-preview` · RISK: NORMAL — lane 2A
**Spec:** §6.14. **§11 step 8.** **Files:** `apps/hub/src/orders/queries/eta-preview.ts`; test `eta-preview.int.test.ts`. **Tests first:** `[02b #33 preview]` appends nothing, `from_stock`, `follow_up` (round 2 preview = submit), `countsAsActivity: false`, 3 statements, > 8 KB → 400; `[02b #3]` config applied between preview and submit. **Commit:** `feat(02b): eta-preview [02b §6.14; §11 step 8]`.

### Task 14: `RemoveItems` and `lineChangeDrafts` · RISK: HIGH — lane 2B
**Spec:** §6.2, §3.5, §3.4, §3.9 (stale requests), §3.3. **§11 step 9.** **Files:** `orders/commands/remove-items.ts`, `orders/line-change.ts`; test `remove-items.int.test.ts`. **Tests first:** `[02b #15]`, `#17`, `#18`; `[02b #19 command]`, `[02b #37 remove]`, `[02b #39 remove]`; `[02b #23 remove]`; `lineChangeDrafts` 2 statements. **Commit:** `feat(02b): RemoveItems and lineChangeDrafts [02b §6.2, §3.5; §11 step 9]`.

### Task 15: `SetLineWeight` · RISK: NORMAL — lane 2B
**Spec:** §6.3, §3.6. **§11 step 10.** **Files:** `orders/commands/set-line-weight.ts`; test. **Tests first:** `[02b #21]`; `[02b #19 weight]` comp then weight → `LINE_ALREADY_SETTLED`. **Commit:** `feat(02b): SetLineWeight [02b §6.3, §3.6; §11 step 10]`.

### Task 16: `CompLine` and kind `comp` · RISK: HIGH — lane 2B
**Spec:** §6.8, §6.12 (verbatim), §3.9, 01d approval. **§11 step 14.** **Files:** `orders/comp-kind.ts` (top level), `orders/commands/comp-line.ts`; test `comp.int.test.ts`. **Tests first:** `[02b #26]`, `[02b #27]`, `[02b #38 comp]`, `[02b #39 approved]`. **Names:** `approvable: true`; `apply` read-only, drafts carry `alert_id`. **Commit:** `feat(02b): CompLine and comp kind [02b §6.8, §6.12, §3.9; §11 step 14]`.

### Task 17: `MarkServed` · RISK: NORMAL — lane 2C
**Spec:** §6.4, §3.7, O16, §3.3. **§11 step 11.** **Files:** `orders/commands/mark-served.ts`; test. **Tests first:** `[02b #22]` (except the queued clause, task 22); `[02b #23 serve]` (default waiter AD-32); `[02a #62]`. **Names:** `queueable: true`, no lock. **Commit:** `feat(02b): MarkServed [02b §6.4, §3.7; §11 step 11]`.

### Task 18: `ReleaseItems`, `BoostOrder` · RISK: NORMAL — lane 2C
**Spec:** §6.5, §6.6, §3.8, O18. **§11 step 12.** **Files:** `orders/commands/release-boost.ts`; test. **Tests first:** `[02b #24]`, `[02b #23 boost]`. **Commit:** `feat(02b): ReleaseItems and BoostOrder [02b §6.5, §6.6, §3.8; §11 step 12]`.

### Task 19: `ReturnToKitchen` · RISK: HIGH — lane 2C
**Spec:** §6.7, §3.8 (E-4, E-7), §3.3 (non-food return). **§11 step 13.** **Files:** `orders/commands/return-to-kitchen.ts`; test. **Tests first:** `[02b #25]`, `[02b #40]`. **Commit:** `feat(02b): ReturnToKitchen [02b §6.7, §3.8; §11 step 13]`.

### Task 20: `AddZoneStock`, `SetZoneStock` · RISK: NORMAL — lane 2D
**Spec:** §6.9, §6.10, §3.10, Q-5. **§11 step 15.** **Files:** `orders/commands/zone-stock.ts`; test. **Tests first:** `[02b #14 commands]` (refill transfers per draw, short → `STOCK_INSUFFICIENT`, Count, alerts via task 5's helper); `[02b #33 refill tile]` a refill emits the stock frame (`StockTransferredOut` in `STOCK_VERSION_EVENTS` and the stock-frame audience, A-1) — no timing assert (03a AD-32); an order taker without `manage-zone-stock` receives `ZoneStockAdded`; scope `my_zones`. **Commit:** `feat(02b): zone refill and count [02b §6.9, §6.10, §3.10; §11 step 15]`.

### Wave 2 checkpoint
- [ ] Gate green. §12.2 rows 1–11 ticked. Statement counts per §6.1–6.10 asserted. Board "Wave 2"; push; STOP.

---

## Wave 3 — reads, queue, hand-off

### Task 21: queries, catch-up, audiences · RISK: NORMAL — lane 3A
**Spec:** §6.15–§6.18, catch-up `orders`, §6.19 Audiences, O17. **§11 step 17.** **Files:** `orders/queries/{seating-orders,open-orders,zone-stock,order-contact}.ts`, `orders/catch-up.ts`, `orders/audiences.ts`; test `queries.int.test.ts`. **Tests first:** `[02b #32]`, `[02b #33 queries]` (counts 2 / 2 / 1 / 1, catch-up 3), `[02b #30 open-orders]` (carried order with its date), `[02b AD-6]` zone events reach no 02a reader. **Commit:** `feat(02b): order queries, catch-up, audiences [02b §6.15–§6.19; §11 step 17]`.

### Task 22: queued replays (02b's use) · RISK: HIGH — lane 3B
**Spec:** §3.12 (hub part), §3.2 step 2, §3.7, O11, AD-1, AD-2. **§11 step 18.** **Files:** `orders/commands/submit-order.ts`, `orders/commands/mark-served.ts` (ownership moves to lane 3B in wave 3); test `queued.int.test.ts`. **Tests first:** `[02b #31 02b]` (AD-2 list), `[02b #13 queued]`, `[02b #22 queued]`. **Commit:** `feat(02b): queued replays for submit and served [02b §3.12; §11 step 18]`.

### Task 23: handover card amount · RISK: NORMAL — lane 3C (G-1 (a))
**Spec:** 02a §3.8, 02b §4.2. **Files:** per G-1 (a): `apps/hub/src/tables/handover.ts`, a `registerSeatingTotals` hook in 02a, `orders/index.ts` registration; the 02a #12 test. **Tests first:** `[02a #12 amount]` the card's `details.amount` = `seatingTotals`; 1 statement more on the handover path. **Commit:** `feat(02b): handover card shows the seating total [02a §3.8; 02b §4.2]`.

### Wave 3 checkpoint
- [ ] Gate green. §12.2 rows 14–19. Board "Wave 3"; push; STOP.

## Wave 4 — perf file and acceptance (integrator)

### Task 24: perf test file, acceptance pass, README rows · RISK: NORMAL
**Spec:** §7, §10 #34, Acceptance table, §12.1. **§11 step 22.** **Files:** `apps/hub/test/orders/submit.perf.test.ts` (written, typechecked, **not run**, AD-4); `docs/plans/02b-status.md` acceptance map (each story AC → green test names; each #31 00 clause → its 00 test, AD-2); `docs/specs/README.md` carried rows closed only where the spec says. **Commit:** `test(02b): perf file and acceptance map [02b §10 #34, §12.1; §11 step 22]`. Then the wave 4 checkpoint and STOP; the owner runs `pnpm test:perf` on the real disk.

---

## Wave 5 — client · **BLOCKED on the design handoff**

There is no `docs/design/handoff/02b/` (inventory: `docs/design/inventory/02-ordering-tables.md`, 02-S05). Screens §8 needs: ordering screen (rail, search, tiles with Sold out / Not now / "4 left" / slow clock, cart by ETA with promise times, options sheet, notes, Hold, Send), zone tiles ("Raita · 6 here", zone-empty flip), takeaway (name, phone, big token) and parking (plate LTR mono, type icons), table view orders part (rounds, stages, Mark served, Send what's ready, Boost, Return fix / remake, Comp with waiting card, Remove with stepper, weight entry, Call, "Send it as a new item"), open orders (token / plate, ready n / m, "from <date>", abandoned for managers), zone stock screen (Refill, Count, low / out), queue banner and queue log, device idle lock, late cards grouped by current table (O18). Tasks 25 (queue + drafts, #35), 26 (ordering screen, #36), 27 (table view, comp card, zone stock, open orders, contact) get their TDD steps in a plan patch when the handoff lands.

---

## Parallel waves — rules (same as 02a, with its lessons)

1. **Contract in code** (`orders/contracts.ts`, task 4); a lane never changes it; needing a change → STOP that lane.
2. **Tests on real tables / real events**, never a mock of another lane's code; `apps/hub/test/orders/fixtures.ts` is the shared way to seed orders.
3. **One file, one lane per wave** (table below). Exception: each lane's own lines under its marker in `orders/index.ts`.
4. **Lanes never push or merge.** The integrator cherry-picks finished, reviewed commits onto `module-02b` in table order (git cherry `+` lines; skip a lane's own copy of a shared commit when it matches by content, 02a AD-21), runs the lane's files plus both typechecks, and pushes. Additive conflicts allowed by an owner ruling → keep all lines in lane order (02a standing rule); anything else → STOP.
5. **At most 4 lanes**; only the integrator runs the gate, once per wave.
6. **Hand-off** by local tags: `02b-lane-<N><X>-done`, and `02b-lane-<N><X>-stop` for a question (Global Constraints, "Questions"). The integrator checks tags every 2 minutes and reports a `-stop` tag to the owner at once.

| Wave | Lane | Tasks | Owns |
|---|---|---|---|
| 0 | integrator | 1 → 2 → 3 → 4 → 5 | as in each task |
| 1 | A | 6 → 7 | `orders/projection.ts`, `orders/exports.ts`; G-3 lines; `test/orders/projection*`, `exports*` |
| 1 | B | 8 → 9 | `orders/ledger.ts`, `orders/food.ts`; their tests |
| 1 | C | 10 | `orders/build-submit.ts`; its test |
| 2 | A | 11 → 12 → 13 | `commands/submit-order.ts`, `queries/eta-preview.ts`; their tests |
| 2 | B | 14 → 15 → 16 | `commands/remove-items.ts`, `orders/line-change.ts`, `commands/set-line-weight.ts`, `orders/comp-kind.ts`, `commands/comp-line.ts`; their tests |
| 2 | C | 17 → 18 → 19 | `commands/mark-served.ts`, `commands/release-boost.ts`, `commands/return-to-kitchen.ts`; their tests |
| 2 | D | 20 | `commands/zone-stock.ts`; its test |
| 3 | A | 21 | `orders/queries/*` (not eta-preview), `orders/catch-up.ts`, `orders/audiences.ts`; its test |
| 3 | B | 22 | `commands/submit-order.ts`, `commands/mark-served.ts`; `test/orders/queued*` |
| 3 | C | 23 | per G-1 |
| 4 | integrator | 24 | as in the task |

## Self-review (writer, 2026-11-10)

- **Coverage.** §11 steps 1–22 → tasks 1–27 (step 3 → tasks 3 + 6; step 15 → 5 + 20; steps 19–21 → 25–27). Every §10 test 1–40 is placed (table above), #31's 00 clauses mapped at task 24, 02a's #53 / #62 placed (AD-3).
- **§12.2.** 19 rows close over waves 0–3.
- **Names.** From the code at `46f74a6`; 02b's own names fixed in "02b exports and contracts".
- **Open.** G-1–G-3, G-7 ruled (owner, 2026-11-10); AD-1–AD-6 proposed.
