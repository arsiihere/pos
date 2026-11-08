# 02p Platform Changes — Implementation Plan (spec v1.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every approved upstream row of 02a v1.0 / v1.1 and 02b v1.0 in 00, 01a, 01b, 01c, 01d and 03a, in one sprint, so the 02a, 02b and 03b sprints touch only their own folders (02p §10 Acceptance).

**Architecture:** Three lanes on three branches (owner, 2026-11-08). **Platform A** (`~/pos-cloud`, branch `module-02p`) builds tasks 1–10: shared schemas and permissions, the 01a zone config and snapshot V4, the 01b assignments, `my_zones` and defaults. **Platform B** (its own worktree, branch `module-02p-hub`) builds tasks 11–13: 00 M95 and `queueable`, and 01d D-1 / D-3. The **engine lane** (`~/pos`, branch `module-02p-engine`) builds tasks 14–17 and the 03a carry-over (17b) against 03a v1.2, then task 18 once the owner has merged all three lanes. Consumers that 02a / 02b will write later (`holdersOfOrders`, the `table_team` resolver, `queueable` commands) are built behind their hooks with the spec's fallback and tested with test doubles (02p U3).

**Tech Stack:** the existing stack (CLAUDE.md): Node 22, Fastify 5, better-sqlite3 (hub), PostgreSQL 16 (cloud), React (owner app), Zod, Vitest. **No new dependency.**

**Spec:** `docs/specs/02p_Platform_Changes_Spec_v1.0.md` ("02p §x", tests "U-n"). It names the specs that are the source of truth, and each task cites its row:
- `00_Foundation_Spec_v1.11.md` (text only)
- `00_Hub_Platform_Access_Spec_v1.8.md` ("00 §x", M95, tests 152–158)
- `01_Restaurant_Setup_Spec_v2.3.md` (v2.2 + v2.3 rows A-1, tests 181–195)
- `01b_Staff_Roles_Spec_v1.7.md` (v1.6 B-1–B-3, v1.7 B-1–B-5)
- `01c_Menu_Variants_Spec_v1.1.2.md` (C-1)
- `01d_Notifications_Requests_Spec_v1.2.1.md` (D-1, D-3, test 25)
- `03a_Timing_Engine_Spec_v1.2.md` ("03a §x", Q-1–Q-6, Q-9, E-1, R-1–R-3, tests "#n" 94, 120–130)

If the plan and a bumped spec disagree, the spec wins. Stop and ask (CLAUDE.md).

**Starting point:** main at `0426753` + the approved task 0 on `module-02p-engine` (`4bffa9e`, 03a v1.2 and 01d v1.2.1 APPROVED by the owner on 2026-11-08). The next free migrations are: hub `0010`, cloud `0009`.

## Markers

| Marker | Meaning |
|---|---|
| **Lane: platform A** | Built in `~/pos-cloud` on `module-02p`, tasks 1–10. Its own session; `DATABASE_URL=postgres://pos:pos@127.0.0.1:5433/pos_test_cloud`; board `docs/plans/02p-status.md`. |
| **Lane: platform B** | Built in its own worktree on `module-02p-hub`, tasks 11–13. Its own session; `DATABASE_URL=postgres://pos:pos@127.0.0.1:5433/pos_test_hub`; board `docs/plans/02p-status-hub.md`. |
| **Lane: engine** | Built in `~/pos` on `module-02p-engine`, tasks 14–17, 17b, 18. `DATABASE_URL=…/pos_test`. |
| **RISK: HIGH** | One fresh implementer, then a full review by a fresh **opus** reviewer against the cited sections, the task's tests and the Global Constraints, before the next task. HIGH = every task with a migration (3, 7, 8), task 4 (snapshot V4), task 7 (assignments), tasks 15 and 17. |
| **RISK: NORMAL** | One fresh implementer, then one fresh reviewer (opus) for the task. |
| **Shared** | Touches `packages/domain`, `packages/events` or `packages/engine`. Never two Shared tasks in parallel inside a lane. |
| **needs Docker Postgres** | The task's own command needs `pos-pg-test` (port 5433). Never stop, restart or `compose down` it. |
| **UI** | Client only (`apps/client`). The implementer may be sonnet; the reviewer is opus. |

## Global Constraints

Every task implicitly includes these.

- **Agents:** one fresh implementer and one fresh reviewer per task; the reviewer runs on opus for HIGH tasks. No subagent spawns subagents. A review fix round past 2 → STOP (prompt stop rule 4).
- **TDD:** write the failing test first, run it, record the failure, then implement. Test names cite the spec test:
  - `it('[00 #152] …')`, `[01a #187]`, `[01d #25]`, `[03a #121]`;
  - `[02p U-3] …` / `[02p U-4] …` / `[02p U-5] …` where the bumped spec numbers no test (01b v1.6 / v1.7, 01c C-1);
  - section-cited support tests such as `[01b B-3]`.
  - Each numbered test lives in exactly one task (Coverage table).
- **Gate (per batch, controller only, one run at a time):** `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` (≈ 9 min). Implementers run only their own files: `pnpm vitest run <file> …` and `pnpm --filter <pkg> typecheck`. **No timing asserts in the normal gate** (03a AD-32).
- **`pnpm test:perf`:** only in task 18, on the real disk, alone on a quiet machine, never with `TMPDIR=/dev/shm`. On this laptop the three SQLite-COMMIT rows (`fires` with work, `fires_alerts` with work, snapshot full write) fail by design (≈ 27 ms per fsync). They are deferred to 03a task 28 and are not a regression; compare against the A/B in 03a v1.0.1 §7.1.
- **Commit:** one task per commit, only the task's files. Format `feat(<module>): <title> [<spec> <row>; 02p §11 #N]`, for example `feat(01b): my_zones scope [01b v1.7 B-3; 02p §11 #8]`. Review fixes are their own commits: `fix(<module>): task N review …`.
- **Push:** `git push origin module-02p` (platform A), `git push origin module-02p-hub` (platform B) or `git push origin module-02p-engine` (engine) after each batch checkpoint. No merge, force-push, push to main, reset or rebase: merges are the owner's.
- **Batch checkpoint:** after a batch's last task and its reviews, the controller:
  1. runs the gate;
  2. appends the batch entry to its lane's board (`docs/plans/02p-status.md` for platform A and the engine lane, `docs/plans/02p-status-hub.md` for platform B: tasks, commits, reviews, gate counts, tests closed, AD rows) and updates the MORNING REPORT;
  3. commits it alone (`docs(02p): checkpoint batch N`) and pushes.
- **Readings:** a reading made without stopping is an `AD-n` row on the lane's board (platform B numbers its rows `AD-H1`, `AD-H2` … so the boards never collide), status **"proposed (not yet ruled)"**. Never accept your own reading. Spec and code disagree, two specs disagree, a timeout or bound would change, a file outside the task, or new behaviour → STOP and ask (prompt stop rules 1–5).
- **Acceptance (02p §10):** after 02p, 02a / 02b edit only their own folders and append-only wiring lines. Anything a task leaves for them must therefore already exist (hooks, types, catalogue rows, labels).
- **Merged migrations are never edited.** New forward migrations take the next free number at build time: hub `0010`+, cloud `0009`+. Platform A owns every migration in this sprint; platform B and the engine lane add none.
- **Events (03a v1.2 §5.3):** no upcaster and no version bump. Every new field is **optional** at schema version 1, and an event logged without it still parses (U-5, U-8). `StockTransferredOut` is new at v1. `ENGINE_STATE_VERSION` stays **3**.
- **Statement bounds asserted where the task touches them:**
  - `fires_alerts` with work = 2 (`listOpen`) + ≤ 2 (`holdersOfOrders`, `currentTableOf`) + ≤ 1 line facts + 01d bounds; idle 0 (03a R-1, test 121);
  - boot step 3 = 4 + 2 + 1 (03a R-3, test 130);
  - 01a test 187: sync 200 = "+1" after task 4, "+2" after task 7;
  - list endpoints use a fixed number of queries (no N+1).
- **Purity (03a §2.1):** `packages/engine/src` imports nothing from `node:*`, has no `Date.now()`, `Math.random()`, timers or I/O, and mutates no input.
- **Strings:** every new label goes in `apps/client/src/i18n/en.ts`, and in `ur.ts` or 01b's Urdu to-do list (`i18n.test.ts:121-124`, 02p n-5).
- **No hard-coded names** (role, item, station) in code (README R5, R18).

## Review Focus

Five failure modes the spec implies but no named test exercises. Each line names its pinning test and the task that owns it.

1. **A reconnecting device after a hub restart mid-outage.** Hub down, device off longer than the TTL, then both back: the session is paused from `hub_down_at`, and the cap counts from `paused_since`, not from boot. Pinned in task 11 (`[00 M95] restart during a paused outage keeps paused_since from before the restart`).
2. **An assignment to a zone that is archived later.** The assignee keeps the row, but `zonesOf` and `assignedOrderTaker` drop the zone. Pinned in task 8 (`[01b B-3] an archived assigned zone drops out of zonesOf`).
3. **Two `dine_in` groups of one pass sharing an oldest order holder.** One `holdersOfOrders` call with de-duplicated ids, and each group's receiver is the holder of its own oldest order. Pinned in task 14 (`[03a #120] three groups, two share a holder, one call with distinct ids`).
4. **A partial `ItemRemoved` with `units` ≥ the line's units.** Treated as the whole line, with no negative units and no double release. Pinned in task 16 (`[03a §3.7 Q-4] units ≥ line units removes the whole line once`).
5. **`StockTransferredOut` for a stock item the hub has never seen.** Creates no phantom stock entry: on_hand stays 0, one breach diagnostic, replay = live. Pinned in task 17 (`[03a #127] unknown stock item`).

---

## Lanes, batches, order

| Batch | Lane | Tasks | Starts when |
|---|---|---|---|
| 0 | engine | 0 (done, `4bffa9e`) | — |
| 1 | platform A | 1, 2 | plan approved |
| 2 | platform A | 3, 4, 5, 6 | batch 1 green |
| 3 | platform A | 7, 8, 9, 10 | batch 2 green |
| 4 | platform B | 12, 13, then 11 | plan approved; task 11 after the owner has merged `module-02p` (with task 4) into `module-02p-hub` |
| 5a | engine | 17b (03a carry-over; needs no task-1 schema) | plan approved |
| 5b | engine | 14, 15, 16, 17 | the owner has merged `module-02p` (with task 1) into `module-02p-engine` |
| 6 | engine | 18 | the owner has merged all three lanes (task 18 runs on the merged head) |

The engine lane runs 17b first, while it waits for task 1. Tasks 14–17 need task 1's schemas (`ItemAdded.served_from_zone_id`, `ItemServed.source`, `ItemRemoved.units`, `StockTransferredOut`, `OrderPlaced` E-1 fields). Platform B's task 11 reads `BranchConfig.settings.queue_auto_send_max_ms`, a type that task 4 adds, so B builds 12 and 13 first and starts 11 after the owner merges `module-02p` (with task 4) into `module-02p-hub`.

**File ownership (no file is edited by two lanes):**
- **Platform A:** `packages/domain`, `packages/events`, `apps/cloud`, hub `auth/staff-directory.ts`, `auth/apply-directory.ts`, `sync/`, `ws/restaurant-audiences.ts`, `db/migrations/`, `apps/client`. Under `apps/hub/test/engine/`, platform A owns exactly two files: `boot.int.test.ts` (task 5, the `:450` `STOCK_VERSION_EVENTS` assert, n-4) and `stock-audiences.int.test.ts` (task 5).
- **Platform B:** hub `auth/session-sweeper.ts`, `auth/staff-session.ts`, `auth/session-store.ts`, `ws/server.ts`, `lib/boot.ts`, `commands/registry.ts`, `commands/route.ts`, `server.ts`, `alerts/targets.ts`, `alerts/kinds.ts`, and their tests (`apps/hub/test/auth/`, `test/commands/`, `test/alerts/`, `test/cors.int.test.ts`, `src/alerts/*.test.ts`).
- **Engine:** `packages/engine` and hub `engine-host/`, with every other file under `apps/hub/test/engine/` and `test/engine-host/`. Its new boot tests go in a new file, `apps/hub/test/engine/boot-idset.int.test.ts` (tasks 15, 17), never in `boot.int.test.ts`.

## Coverage (test → task)

| Test | Task |
|---|---|
| U-5 schema part (C-1, E-1, Q-4, Q-6, Q-9, Q-5 schema); 03a #129 | 1 |
| U-4 catalogue, scope sets, ranks, labels | 2 |
| 01a #181–#186, #189–#191 (cloud) | 3 |
| 01a #187 ("+1"), #188, #192, #193 ("delivered with defaults") | 4 |
| 01a #194 (first two clauses) | 5 |
| 01a #189–#195 client part (#195 item form) | 6 |
| U-3 (assignments, directory v3, `assignedOrderTaker`); 01a #187 ("+2") | 7 |
| U-4 `zonesOf`, `my_zones` rank and CHECK | 8 |
| U-4 defaults by `default_key`, settings `PATCH`; 01a #193 ("written, range-checked") | 9 |
| U-3 client part | 10 |
| 00 #152–#156 (U-1) | 11 |
| 00 #157, #158 (U-1) | 12 |
| 01d #25 as changed, D-1 (a)–(d), D-3 (U-6) | 13 |
| 03a #120, #121, #122, #123 (U-7) | 14 |
| 03a #124, #125, #130 (U-8 Q-3) | 15 |
| 03a #126 (U-8 Q-4) | 16 |
| 03a #127, #128, #94 updated, 01a #194 third clause (U-8 Q-5, Q-6) | 17 |
| 03a open item 13 gaps 1, 2, 4, 5, 7 | 17b |
| U-9 | 18 |

---

## Batch 1 — shared types and schemas (platform A)

### Task 1: event schemas — additive fields and `StockTransferredOut` · Lane: platform A · RISK: NORMAL · Shared

**Rows:** 01c v1.1.2 C-1; 03a v1.2 E-1, Q-4, Q-5, Q-6, Q-9 (schema part only).

**Files:**
- Modify:
  - `packages/events/src/events/order/ItemAdded.v1.ts`
  - `OrderPlaced.v1.ts`
  - `ItemRemoved.v1.ts`
  - `ItemServed.v1.ts`
  - `ItemVoided.v1.ts`
  - `packages/events/src/registry.ts`
  - `packages/events/src/index.ts`
- Create: `packages/events/src/events/stock/StockTransferredOut.v1.ts`
- Test:
  - `packages/events/src/events/order/order-events.test.ts`
  - `packages/events/src/events/stock/stock-events.test.ts`
  - `packages/events/src/fixtures.test.ts`

**Interfaces:**
- Produces (exact field names; each optional, `.optional()` or with a parse default, as stated):
  - `ItemAdded`: `served_from_zone_id: string | null` (missing → `null`), `is_ready_item: boolean` (missing → `false`).
  - `OrderPlaced`: optional `business_date: string`, `token: string`, `car_number: string`, `car_type: string`, `order_note: string`, `sent_after_reconnect: boolean`, `has_phone: boolean`, `has_food: boolean`. No contact field.
  - `ItemRemoved`: `{ order_item_id, units?: int ≥ 1 }`.
  - `ItemServed`: `source: 'tap' | 'estimated' | 'zone'`, `served_at?: int`.
  - `ItemVoided`: `refund_minor?: int`, `comp_voided_minor?: int`.
  - `StockTransferredOut` v1, stream `stock`, id `stock_item_id`: `{ stock_item_id: string, quantity: number > 0, zone_id: string }`.
- Consumed by: tasks 5, 14–17; 02b (producer).

- [ ] **Step 1: Write the failing tests.**
  - `[02p U-5] ItemAdded without served_from_zone_id / is_ready_item parses as null / false`
  - `[02p U-5] ItemAdded with both fields round-trips`
  - `[03a #129] OrderPlaced, ItemServed, ItemRemoved, ItemVoided round-trip the new fields`
  - `[03a #129] every existing fixture parses unchanged`: loop over `packages/events` fixtures and the engine fixtures `packages/engine/fixtures/engine-log.v*.json`.
  - `[03a §4.2 Q-5] StockTransferredOut v1 parses; quantity 0 or negative → fails`
  - `[03a §4.2 Q-6] ItemServed source 'zone' accepted; 'other' rejected`
- [ ] **Step 2:** `pnpm vitest run packages/events/src/events` → FAIL.
- [ ] **Step 3:** Implement. Register `StockTransferredOut` in `registry.ts` and export it from `index.ts`.
- [ ] **Step 4:** Run the tests again → PASS. Then `pnpm --filter @pos/events typecheck` and `pnpm vitest run packages/engine apps/hub/test/engine`, so existing fixtures still parse.
- [ ] **Step 5: Commit.** `feat(events): 02b additive fields and StockTransferredOut [01c v1.1.2 C-1; 03a v1.2 E-1, Q-4–Q-6, Q-9; 02p §11 #1]`. Push right away: the owner merges this into the engine lane.

### Task 2: permissions, scopes, ranks and labels · Lane: platform A · RISK: NORMAL · Shared

**Rows:** 01b v1.6 B-1, B-3; v1.7 B-1–B-5 (catalogue part); 01a v2.2 `ZONE_NOT_FOUND`; 02p M-4, n-4, n-5, m-9.

**Files:**
- Modify:
  - `packages/domain/src/permissions.ts`
  - `packages/domain/src/errors.ts` (append `ZONE_NOT_FOUND` 404 `{ zone_id }` only; 02a / 02b codes stay in their sprints, m-9)
  - `apps/hub/src/auth/staff-directory.ts:45` (`SCOPE_RANK`)
  - `apps/client/src/features/owner/staff/people.ts:31` (`WIDTH`)
  - `apps/client/src/i18n/en.ts`, `apps/client/src/i18n/ur.ts` (or the Urdu to-do list)
- Test:
  - `packages/domain/src/permissions.test.ts:47-61`: the "only `mark-served` offers `own_tables`" clause becomes 01b v1.7 §3.3.
  - `packages/domain/src/errors.test.ts`
  - `apps/client/src/i18n/i18n.test.ts`

**Interfaces:**
- Produces:
  - `Permission` adds `take-order`, `clean-table`, `set-line-weight`, `manage-zone-stock`, `view-customer-contact`.
  - `Scope` adds `'my_zones'`.
  - `PERMISSION_SCOPES` exactly as 01b v1.7 §3.3, the table at :370–:386:

    | Permission | Scopes |
    |---|---|
    | `take-order` | `branch`, `my_floors`, `own_tables` |
    | `clean-table` | `branch` |
    | `mark-served` | `branch`, `own_tables`, `my_floors` |
    | `boost-order` | gains `own_tables` |
    | `mark-item-returned` | gains `own_tables` |
    | `set-line-weight` | `branch` |
    | `manage-zone-stock` | `branch`, `my_zones` |
    | `view-customer-contact` | `branch`, `my_floors`, `own_tables` |

    The implementer copies these sets from §3.3 itself, not from this summary.
  - Catalogue group `orders` for all five.
  - `SCOPE_RANK` / `WIDTH` give `my_zones` rank **1**, with the 01b resolve order `branch > my_floors = my_team = my_stations = my_zones > own_tables`.
  - Labels: `perm.<key>` ×5, `staff.scope.my_zones`, `roles.scope.my_zones`, `errors.reference.already_assigned`.

- [ ] **Step 1: Write the failing tests.**
  - `[02p U-4] PERMISSION_CATALOGUE has the five keys in group orders`
  - `[02p U-4] PERMISSION_SCOPES equals 01b v1.7 §3.3` (one `toEqual` per listed permission, the rest `['branch']`)
  - `[02p U-4] own_tables is offered by exactly take-order, mark-served, boost-order, mark-item-returned, view-customer-contact`
  - `[02p U-4] my_zones ranks with my_floors in SCOPE_RANK and WIDTH`
  - `[01a A-1] ZONE_NOT_FOUND is 404`
  - i18n completeness: the existing tests cover the new keys.
- [ ] **Step 2:** Run `packages/domain`, `apps/hub/src/auth/staff-directory.test.ts`, `apps/client/src/i18n` → FAIL.
- [ ] **Step 3:** Implement. The same commit carries all the files above, so batch 1 stays green (M-4).
- [ ] **Step 4:** Run again → PASS. Then `pnpm -w typecheck`, because the `Record<Scope, …>` types now require `my_zones`.
- [ ] **Step 5: Commit.** `feat(01b): permissions, my_zones scope, labels [01b v1.6 B-1, v1.7 B-1–B-5; 02p §11 #2]`.

---

## Batch 2 — 01a (platform A)

### Task 3: cloud zones, zone routes, stock items, `is_ready_item`, settings columns · Lane: platform A · RISK: HIGH (migration) · needs Docker Postgres

**Rows:** 01a v2.2 A-1, v2.3 A-1 (cloud part). Spec: 01a §5.2 (`zones`, `dining_tables.zone_id`, `zone_item_routes`, `zone_stock_items`, `menu_items.is_ready_item`, `branch_engine_settings` new columns), §6.6a / §6.6b (zone routes, nested replace lists), §6.2–§6.4 (floors list with zones, tables accept `zone_id`).

**Files:**
- Create:
  - `apps/cloud/src/db/migrations/0009_zones.sql`
  - zone routes and service in `apps/cloud/src/modules/restaurant/` (`routes.ts`, `service.ts`, `repository.ts`, `schemas.ts`, `versions.ts`)
- Modify: `apps/cloud/src/modules/restaurant/*`, `apps/cloud/src/modules/menu-variants/*` (item `is_ready_item`)
- Test:
  - `apps/cloud/test/restaurant/zones.int.test.ts` (new)
  - `apps/cloud/test/restaurant/floors.int.test.ts`

**Interfaces:**
- Produces:
  - `POST /v1/admin/branches/:branch_id/floors/:floor_id/zones` and `PATCH …/zones/:zone_id`, with exact paths from 01a §6.6a / §6.6b, a body with `routes[]` and `stock_items[]` (replace lists; absent = keep, `[]` = clear), and `422 CONFIG_REFERENCE_INVALID { field: 'routes.N.…' | 'stock_items.N.item_id' }`;
  - `404 ZONE_NOT_FOUND`;
  - the floors list returns zones.

- [ ] **Step 1: Write the failing tests.** 01a tests #181–#186 and #189–#191, each `it('[01a #N] …')`, with 01a §10's assertions verbatim. The settings columns are created here and delivered in task 4; their writes come in task 9.
- [ ] **Step 2:** `DATABASE_URL=postgres://pos:pos@127.0.0.1:5433/pos_test_cloud pnpm vitest run apps/cloud/test/restaurant` → FAIL.
- [ ] **Step 3:** Implement the migration (forward only; indexes as 01a §5.2 lists them) and the routes.
- [ ] **Step 4:** Run again → PASS. Also run `apps/cloud/test/cross-tenant.int.test.ts`, because the new routes need the tenant guard.
- [ ] **Step 5: Commit.** `feat(01a): zones, zone routes and stock items, is_ready_item [01a v2.2 A-1, v2.3 A-1; 02p §11 #3]`.

### Task 4: snapshot V4 and hub apply · Lane: platform A · RISK: HIGH

**Rows:** 01a v2.2 A-1, v2.3 A-1 (snapshot); 02p U5 (V3 → V4 once).

**Files:**
- Modify:
  - `apps/cloud/src/modules/config-sync/builder.ts`, `schemas.ts`
  - `packages/events/src/config.ts` (`BranchConfig`: `floors[].zones[]` with `routes[]`, `stock_items[]`; `tables[].zone_id`; `items[].is_ready_item`; the settings fields; `comp_reason_chips`)
  - `apps/hub/src/sync/config-client.ts`, `config-poller.ts`
  - fixtures under `apps/cloud/test/fixtures/` and `packages/events` (V3 → V4 **once**)
- Test:
  - `apps/cloud/test/config-sync/*.int.test.ts`
  - `apps/hub/test/sync/*.int.test.ts`
  - `packages/events/src/config.test.ts`

**Interfaces:**
- Produces: `snapshot_schema_version = 4`. `BranchConfig` (in memory on the hub through `branchConfig()`) carries `floors[].zones[].{ zone_id, name, is_archived, routes[]: { item_id, station_id }, stock_items[]: { item_id, threshold } }`, `floors[].tables[].zone_id`, `items[].is_ready_item`, `engine_settings.{ queue_auto_send_max_ms, zone_undo_ms, slow_item_threshold_ms, served_estimate_ms, comp_reason_chips }` (AD-10; beside the A-12 fields). Read later by 03a (task 14, `floors[].tables[].name` only), 00 M95 (task 11, `queue_auto_send_max_ms`), 02a / 02b.

- [ ] **Step 1: Write the failing tests.**
  - 01a #187: the sync poll 200 path takes **one statement more than v2.1**, and the body has `snapshot_schema_version: 4` with `zones[]` and `zone_id`;
  - #188: hub with snapshot 3 stored, cloud on 4 → full apply;
  - #192;
  - #193, only the part "delivered with defaults": `queue_auto_send_max_ms 14 400 000`, `zone_undo_ms 300 000`, `slow_item_threshold_ms 900 000`, `served_estimate_ms null`, `comp_reason_chips` `["Late","Wrong item","Quality","Guest","Other"]`;
  - `[02p U5] every snapshot fixture is V4`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Re-baseline the sync bound tests to "+1". 01b's directory bound row moves only in task 7.
- [ ] **Step 4:** Run the config-sync, hub sync and engine boot tests → PASS. The hub engine reads only `floors[].tables[]`, so `apps/hub/test/engine` must stay green.
- [ ] **Step 5: Commit.** `feat(01a): snapshot V4 [01a v2.2 A-1, v2.3 A-1; 02p §11 #4]`.

### Task 5: `StockTransferredOut` in `stock_version` and the stock frame · Lane: platform A · RISK: NORMAL

**Rows:** 01a v2.3 A-1 (stock lists); 01a test #194, first two clauses.

**Files:**
- Modify:
  - `apps/hub/src/sync/stock-version.ts` (add to `STOCK_VERSION_STOCK_EVENTS`)
  - `apps/hub/src/ws/restaurant-audiences.ts` (the stock-frame audience)
- Test:
  - `apps/hub/test/engine/boot.int.test.ts:450`: "nine types" becomes ten, with `StockTransferredOut` (n-4). This assert checks `STOCK_VERSION_EVENTS`, which this task changes, so it is green on `module-02p`. Platform A owns this file.
  - `apps/hub/test/engine/stock-audiences.int.test.ts`

**Interfaces:**
- Consumes: task 1 `StockTransferredOut`.
- Produces: nothing new. The boot fold list is the engine's `ENGINE_REPLAY_EVENTS.stock`, added in task 17 (M-6).

- [ ] **Step 1: Write the failing tests.**
  - `[01a #194] StockTransferredOut moves stock_version`
  - `[01a #194] StockTransferredOut sends a stock frame to the stock audience`
  - Update `boot.int.test.ts:450`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Two list entries.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit.** `feat(01a): StockTransferredOut in stock lists [01a v2.3 A-1; 02p §11 #5]`.

### Task 6: owner app — zones, zone routes and stock items, ready-item checkbox, settings fields · Lane: platform A · RISK: NORMAL · UI

**Rows:** 01a v2.2 / v2.3 §8.1; 01a tests #189–#195, client part.

**Files:**
- Modify:
  - `apps/client/src/features/owner/floors/*` (zones on the floor screen; per-zone routes and stock items)
  - `apps/client/src/features/owner/menu/*` (item form "Ready item (not cooked)")
  - `apps/client/src/features/owner/branches/*` (settings fields, or wherever the branch settings form lives today)
  - `apps/client/src/i18n/{en,ur}.ts`
- Test: colocated `*.test.tsx` beside each changed screen.

- [ ] **Step 1: Write the failing tests.**
  - `[01a #195] item form round-trips is_ready_item`
  - `[01a #189 client] zone editor sends routes / stock_items as replace lists`
  - `[01a #193 client] settings form shows and sends the four settings and the chips`
  - `[01a #181 client] zones listed under their floor`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with the existing owner form helpers (`form.ts`), no new dependency.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit.** `feat(01a): owner app zones and settings [01a v2.2, v2.3 §8.1; 02p §11 #6]`.

---

## Batch 3 — 01b (platform A)

### Task 7: assignments — migrations, staff routes, directory v3, `assignedOrderTaker` · Lane: platform A · RISK: HIGH (migration, task 7) · needs Docker Postgres

**Rows:** 01b v1.6 B-2 (§3.2 rule 7, §4.2, §4.3.1, §5.1, §5.2, staff routes, `StaffWire`).

**Files:**
- Create:
  - `apps/cloud/src/db/migrations/0010_assignments.sql`
  - `apps/hub/src/db/migrations/0010_assignments.sql` (hub copy, directory v3)
- Modify:
  - `apps/cloud/src/modules/staff-roles/{routes,service,repository,schemas,write}.ts`
  - `packages/events/src/directory.ts` (directory v3, additive)
  - `apps/hub/src/auth/apply-directory.ts`, `staff-directory.ts`
- Test:
  - `apps/cloud/test/staff-roles/assignments.int.test.ts` (new)
  - `apps/hub/test/auth/staff-directory.int.test.ts` (or the existing directory test)
  - the sync bound tests (01a #187 → "+2"; 01b's directory bound row)

**Interfaces:**
- Produces:
  - staff wire `assignments: [{ branch_id, assigned_zone_ids: string[], assigned_table_ids: string[] }]`, with exact names from 01b §4.3.1;
  - hub `StaffDirectory.assignedOrderTaker(table_id: string): string | null`, in memory. It returns the table's assignee, else the zone's assignee, else `null`, and only counts people who hold `take-order`.

- [ ] **Step 1: Write the failing tests** (U-3, 02p m-6):
  - `[02p U-3] one person per zone and per table → 422 CONFIG_REFERENCE_INVALID { field: 'assignments', reason: 'already_assigned', staff_id }`
  - `[02p U-3] another branch's zone → reason 'wrong_branch'`
  - `[02p U-3] an archived zone → reason 'archived'`
  - `[02p U-3] an archived zone drops out of the directory`
  - `[02p U-3] a leaver frees their assignments`
  - `[02p U-3] an assignee without take-order is stored; assignedOrderTaker ignores them`
  - `[02p U-3] directory v3 carries the lists; a v2 reader still parses it`
  - `[02p U-3] assignedOrderTaker: table → zone → null`
  - `[01a #187] sync 200 path "+2"`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Cloud and hub migrations: forward only, plus the indexes 01b §5.1 / §5.2 list for the "one per zone / table" rule. Keep the directory read to the existing statement count plus the one 01b allows.
- [ ] **Step 4:** Run → PASS. Also run `apps/hub/test/alerts` and `apps/hub/test/auth`, since the directory feeds alert targets.
- [ ] **Step 5: Commit.** `feat(01b): staff assignments and assignedOrderTaker [01b v1.6 B-2; 02p §11 #7]`.

### Task 8: `my_zones` CHECK expand and `StaffDirectory.zonesOf` · Lane: platform A · RISK: HIGH (migration) · needs Docker Postgres

**Rows:** 01b v1.7 B-3; 01b §4.2 `zonesOf` export line (02p M-3).

**Files:**
- Create:
  - `apps/cloud/src/db/migrations/0011_scope_my_zones.sql`
  - `apps/hub/src/db/migrations/0011_scope_my_zones.sql`

  Both widen both `scope` CHECKs with `'my_zones'`.
- Modify: `apps/hub/src/auth/staff-directory.ts`
- Test:
  - `apps/hub/src/auth/staff-directory.test.ts`
  - `apps/cloud/test/staff-roles/*.int.test.ts`
  - `apps/hub/test/db/*` (migration test)

**Interfaces:**
- Produces: `StaffDirectory.zonesOf(staffId: string): readonly string[]`. In memory, like `stationsOf`: the person's assigned zones ∪ their lead's (`lead_staff_id`) at this hub's branch. No assignment or a leaver → `[]`. `resolve` with scope `my_zones` reads it; a permission with scope `my_zones` and no assignment matches nothing (02p §3).
- No `own_tables` reader and no non-table-order helper: those are 02a / 02b (m-4).

- [ ] **Step 1: Write the failing tests.**
  - `[02p U-4] zonesOf: own zones`
  - `[02p U-4] zonesOf: lead's zones`
  - `[02p U-4] zonesOf: no assignment → []`
  - `[02p U-4] zonesOf: leaver → []`
  - `[01b B-3] an archived assigned zone drops out of zonesOf` (Review Focus 2)
  - `[02p U-4] a role_permissions row with scope 'my_zones' inserts after the expand migration` (cloud and hub)
  - `[02p U-4] my_zones resolves with my_floors rank`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit.** `feat(01b): my_zones scope and zonesOf [01b v1.7 B-3; 02p §11 #8]`.

### Task 9: default grants by `default_key`, re-seed, settings `PATCH` fields · Lane: platform A · RISK: NORMAL · needs Docker Postgres

**Rows:** 01b v1.6 B-1 defaults; v1.7 B-1, B-2, B-4, B-5 defaults; v1.7 settings fields (01a v2.3 A-1); 01a #193 "written, range-checked".

**Files:**
- Modify:
  - `apps/cloud/src/modules/staff-roles/default-roles.ts`
  - the branch settings route in `apps/cloud/src/modules/staff-roles/` or `restaurant/`, wherever `PATCH /v1/admin/branches/:branch_id/settings` lives today
  - the dev / test seed (`apps/cloud/src/cli/*`)
- Test:
  - `apps/cloud/test/default-roles.test.ts`
  - the settings int test

**Interfaces:**
- Default grants exactly as 01b v1.6 B-1 and v1.7 §6.15 (the implementer copies the §6.15 table):
  - Cashier: `set-line-weight`, `view-customer-contact` (`branch`), `apply-comp` (approval by Manager);
  - Order taker: `boost-order`, `view-customer-contact` (`own_tables`), `apply-comp` (approval);
  - `manage-zone-stock`: Owner and Manager only;
  - `take-order`: Owner, Manager, Order taker, Cashier, not Waiter;
  - `clean-table`: Owner, Manager, Order taker, Waiter, Cashier;
  - `mark-served` stays `branch` (03a AD-32).
- Settings `PATCH` accepts and range-checks the four settings and `comp_reason_chips`, with ranges from 01a v2.3 A-12.

- [ ] **Step 1: Write the failing tests.**
  - `[02p U-3] take-order, clean-table seeded by default_key`
  - `[02p U-4] Cashier and Order taker defaults`
  - `[02p U-4] manage-zone-stock only Owner, Manager`
  - `[01a #193] settings written and range-checked` (one out-of-range value per field → 400 `VALIDATION_FAILED`)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Release note line: dev and pilot tenants are re-seeded (R29).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit.** `feat(01b): 02a / 02b default grants and settings fields [01b v1.6 B-1, v1.7 B-1–B-5; 01a v2.3 A-1; 02p §11 #9]`.

### Task 10: owner app — staff form "Assigned tables" · Lane: platform A · RISK: NORMAL · UI

**Rows:** 01b v1.6 B-2 §8; U-3 client part.

**Files:**
- Modify: `apps/client/src/features/owner/staff/*`, `apps/client/src/i18n/{en,ur}.ts`
- Test: colocated `*.test.tsx`.

- [ ] **Step 1: Write the failing tests.**
  - `[02p U-3 client] the staff form shows zones and tables per branch and sends assignments`
  - `[02p U-3 client] already_assigned shows errors.reference.already_assigned on the field`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit.** `feat(01b): owner app assigned tables [01b v1.6 B-2; 02p §11 #10]`.

---

## Batch 4 — 00 and 01d (platform B, `module-02p-hub`)

### Task 11: 00 M95 paused idle clock · Lane: platform B · RISK: NORMAL

**Starts after** the owner merges `module-02p` (task 4's `BranchConfig.engine_settings` fields, AD-10) into `module-02p-hub`.

**Rows:** 00 v1.8 H-1 (M95). Spec: 00 §3.1 M95, the guard step before M46, the sweeper rules, M5's 15 s save, boot pause from `HubStarted.hub_down_at`.

**Files:**
- Modify:
  - `apps/hub/src/auth/session-sweeper.ts`, `staff-session.ts`, `session-store.ts`
  - `apps/hub/src/ws/server.ts` (open-socket count per device)
  - `apps/hub/src/lib/boot.ts` (pause from `hub_down_at`)
  - the command pipeline's guard step in `apps/hub/src/commands/route.ts`
- Test: `apps/hub/test/auth/idle-pause.int.test.ts` (new)

**Interfaces:**
- Produces: in memory, per device, `{ open_sockets: number, paused_at: number | null, paused_since: number | null }`.
  - At the next contact, before M46's check, `last_activity_at += now − paused_at`.
  - The sweeper skips paused devices, and ends `idle_timeout` when `now − paused_since > queue_auto_send_max_ms`. The cap is read from `branchConfig()?.engine_settings.queue_auto_send_max_ms ?? 14_400_000` (02p §3).
  - Re-pause when there is still no socket after the shift.
  - M5's save writes the shifted `last_activity_at` of paused devices.
  - The login response carries `idle_ttl_ms` if it does not already.

- [ ] **Step 1: Write the failing tests.**
  - 00 #152–#156, each `[00 #N]`, with the spec's minutes, using the hub test clock (no real sleeps, no timing asserts);
  - `[00 M95] restart during a paused outage keeps paused_since from before the restart` (Review Focus 1).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Ended sessions are never accepted again (M19, M39, M59 unchanged).
- [ ] **Step 4:** Run, plus `apps/hub/test/auth` and `apps/hub/test/ws` → PASS.
- [ ] **Step 5: Commit.** `feat(00): M95 paused idle clock [00 v1.8 H-1; 02p §11 #11]`.

### Task 12: `X-Queued-At`, `defineCommand({ queueable })`, CORS · Lane: platform B · RISK: NORMAL

**Rows:** 00 v1.8 H-1 (header, flag, CORS).

**Files:**
- Modify:
  - `apps/hub/src/commands/registry.ts` (`CommandDef.queueable?: boolean`)
  - `apps/hub/src/commands/route.ts` (read the header)
  - `apps/hub/src/server.ts` (the CORS preflight allowed-headers list)
- Test: `apps/hub/test/commands/queued-at.int.test.ts` (new), `apps/hub/test/cors.int.test.ts`

**Interfaces:**
- Produces:
  - `defineCommand({ …, queueable: true })`;
  - `ctx.queuedAt: number | null`. It is set only for a queueable command with a valid header, clamped to `[started_at − 120_000, now]`; otherwise `null`.
- No command in 00 / 01x is made queueable here; 02a / 02b declare theirs.

- [ ] **Step 1: Write the failing tests.**
  - `[00 #157]` with a test-only queueable command registered in the test;
  - `[00 #158]`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit.** `feat(00): X-Queued-At and queueable commands [00 v1.8 H-1; 02p §11 #12]`.

### Task 13: 01d D-1 `table_team` full set keyed by depth; D-3 `skip_requester` · Lane: platform B · RISK: NORMAL

**Rows:** 01d v1.2.1 D-1 (a)–(d), D-3. D-1 (e) is 02a test 21; D-2 is text.

**Files:**
- Modify: `apps/hub/src/alerts/targets.ts`, `kinds.ts`
- Test:
  - `apps/hub/src/alerts/targets.test.ts`
  - `apps/hub/test/alerts/targets.int.test.ts` (test 25)
  - `apps/hub/src/alerts/kinds.test.ts`

**Interfaces:**
- Produces:
  - the `registerTargetResolver(kind, fn)` map value `{ staff_ids, device_ids, owner_staff_id? }`;
  - `targetKey({ kind: 'table_team', table_id, depth })` = `table_team:<table_id>:<depth>`, with a missing depth normalised to `direct`;
  - `ResolvedTarget.owner_staff_id?`;
  - the kind flag `skip_requester?: boolean` (default `false`).

- [ ] **Step 1: Write the failing tests.**
  - `[01d #25]` as changed in 01d v1.2.1: the fake resolver returns the full set; `owner` + `direct` for one table in one batch give two lists; a missing depth = `direct`; the marker appears once per `owner_staff_id`.
  - `[02p U-6] D-1 (b): no teamOf(owners) added for table_team; the presence filter still applies`
  - `[02p U-6] D-1 (c): the absent-owner marker and the zone fallback use owner_staff_id`
  - `[02p U-6] D-3: skip_requester drops the requester from every step's set`
  - `[02p U-6] D-3: startup error on a request kind`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. One statement per resolver call stays.
- [ ] **Step 4:** Run, plus `apps/hub/test/alerts` → PASS.
- [ ] **Step 5: Commit.** `feat(01d): table_team full set by depth, skip_requester [01d v1.2.1 D-1, D-3; 02p §11 #13]`.

---

## Batch 5 — 03a (engine lane, against 03a v1.2)

### Task 17b: 03a carry-over — open item 13 (gaps 1, 2, 4, 5, 7) · Lane: engine · RISK: NORMAL

Runs first in the lane: it needs no task-1 schema. Tests only, plus the simulator field.

**Rows:** 03a v1.0.1 §1 "Gaps recorded as built" 1, 2, 4, 5, 7; `docs/plans/03a-status.md` open item 13.

**Files:**
- Modify:
  - `apps/hub/test/engine/fires-alerts-tick.int.test.ts` (gap 1)
  - `apps/hub/test/engine/fires-tick.int.test.ts` (gap 2)
  - `packages/engine/test/sim/generate.ts` (gap 4: add `placed_by` to the simulator's orders)
  - `apps/hub/test/engine/fires-alerts-tick.perf.test.ts` (gap 4)
  - `apps/hub/test/engine/kinds.int.test.ts` (gap 4 `EXPLAIN QUERY PLAN`)
  - `apps/hub/test/engine/snapshots.int.test.ts` (gap 5)
  - `packages/engine/test/stock-folds.test.ts` and `apps/hub/test/engine/config-hook.int.test.ts` (gap 7)

- [ ] **Step 1: Write the tests.** They should pass against the built code. If one fails, it is a bug: STOP, then systematic-debugging.
  - `[03a §10.5 gap 1] a fires_alerts pass that closes and raises in one go: exact statement count`
  - `[03a §10.5 gap 1] an overload pass: exact count`
  - `[03a §10.5 gap 1] the first pass after a day close (obsolete closes): exact count`
  - `[03a §10.5 gap 2] a fires pass writing Start, Done, StockConsumed, ReservationsShifted drafts: exact count`
  - `[03a §7.1 gap 4] the simulator's orders carry placed_by, so the slip raise path is timed` (`harness.test.ts` asserts that raised slips > 0 on the peak seed)
  - `[03a §6.2a gap 4] EXPLAIN QUERY PLAN of the line-facts read uses the events_stream index`
  - `[03a §3.12 gap 5] a scoped live = replay compare right after the deferred checkpoint is written`
  - `[03a AD-35 gap 7] the StockReleased test pins stations.S1 unchanged`
  - `[03a AD-35 gap 7] a hook commit during the catch-up back-off takes the catchUps.delete branch`
- [ ] **Step 2:** Run the listed files (not `test:perf`) → PASS. The perf file's numbers are read only in task 18.
- [ ] **Step 3: Commit.** `test(03a): v1.0.1 gaps 1, 2, 4, 5, 7 [03a v1.0.1 §1; 02p batch 5 carry-over]`.

### Task 14: Q-2 seating key; Q-1 reader pair, receiver, label and bound · Lane: engine · RISK: NORMAL

**Rows:** 03a v1.2 Q-1, Q-2, R-1, R-2; U-7; AD-37 (1), (2).

**Files:**
- Create: `apps/hub/src/engine-host/slip-readers.ts`
- Modify:
  - `apps/hub/src/engine-host/fires-alerts-tick.ts` (step 2 receiver and display; `receiverOf` at :166–170)
  - `apps/hub/src/engine-host/index.ts` (export)
  - `apps/hub/test/engine/fakes.ts` (fake readers)
- Test:
  - `apps/hub/test/engine/fires-alerts-tick.int.test.ts`
  - `apps/hub/test/engine/kinds.int.test.ts` (test 65 dine_in clause handed to #120; test 113 wording)
  - `packages/engine/test/slip.test.ts` (Q-2 keys)

**Interfaces:**
- Produces:

  ```ts
  // apps/hub/src/engine-host/slip-readers.ts
  export type HoldersOfOrders = (db: Database.Database, order_ids: readonly string[]) => Map<string, string>;
  export type CurrentTableOf = (db: Database.Database, order_ids: readonly string[]) =>
    Map<string, { seating_id: string; primary_table_id: string; table_ids: string[] }>;
  export function registerSlipReaders(r: { holdersOfOrders: HoldersOfOrders; currentTableOf: CurrentTableOf }): void;
  export function slipReaders(): { holdersOfOrders: HoldersOfOrders; currentTableOf: CurrentTableOf } | null;
  export function resetSlipReaders(): void; // tests only
  ```

  `db` is the tick's read-only view (`readOnlyDb`).
- Behaviour (03a §3.8, §6.2a):
  - Over the slips of the pass not in `skipped`, collect the **distinct** oldest order ids (`slip.order_ids[0]`) of `dine_in` groups. If there is at least one and the readers are registered: **one** `holdersOfOrders` call and **one** `currentTableOf` call.
  - Receiver = the holder of the oldest order, else `placed_by`.
  - `display.table_code` = `branchConfig()` `floors[].tables[]` `name` of that order's `primary_table_id`. It is `null` when the readers are unregistered, there is no entry, or the table is not in the config.
  - Takeaway / delivery / parking: `placed_by`, `table_code: null`, no call.
  - Do not filter by order type with a string prefix on `table_key`: use `state.orders[oldest].order_type`.

- [ ] **Step 1: Write the failing tests.**
  - `[03a #120] dine_in receiver = holder of the oldest order`
  - `[03a #120] split then handover: the oldest order's holder`
  - `[03a #120] no holder → placed_by`
  - `[03a #120] takeaway / parking → placed_by, no reader call`
  - `[03a #120] no readers registered → placed_by, table_code null`
  - `[03a #120] three groups, two share a holder, one call with distinct ids` (Review Focus 3)
  - `[03a #121] dine_in slip pass for 1 and 3 tables = 2 + 1 + 1 + 1 + 01d's bounds, same count; a takeaway-only pass = 2 + 0 + 0 + 1 + 01d; idle 0`. Count with the existing statement counter, like the test at :196.
  - `[03a #122]` all clauses of 03a v1.2 §10.3f, including "after a move the next raise uses the new primary table" and "no entry → null".
  - `[03a #123]` (U-7, AD-37 (2)): a seating S1 slip answered "Wait"; a new seating S2 on the same table runs late → fresh slip `dine_in:S2`; a second late group in S1 raises nothing.
  - `[03a §3.2 Q-2] dine_in keys built from seating ids in the engine slip tests`
  - Update test 65 / 113 per 03a v1.2 markers.
- [ ] **Step 2:** Run the listed files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, plus all of `apps/hub/test/engine` and `packages/engine/test/slip.test.ts` → PASS.
- [ ] **Step 5: Commit.** `feat(03a): slip reader pair, seating key, primary-table label [03a v1.2 Q-1, Q-2, R-1, R-2; 02p §11 #14]`.

### Task 15: Q-3 zone lines, empty orders, host id set and boot read · Lane: engine · RISK: HIGH · Shared

**Rows:** 03a v1.2 Q-3, R-3 (with T-6 and re-check R-2); n-7; U-8 Q-3 part.

**Files:**
- Modify:
  - `packages/engine/src/apply-event.ts` (`foldItemAdded` :424, `foldOrderPlaced` :327)
  - `apps/hub/src/engine-host/reducer.ts` (`logAbsentIds` :107+, the id set)
  - `apps/hub/src/engine-host/replay.ts` (`loadEngineBase` exposes the readable checkpoint rows' `last_seq`; step 3 adds the read)
  - `apps/hub/src/engine-host/boot-steps.ts`
- Test:
  - `packages/engine/test/lines.test.ts` (#124)
  - `apps/hub/test/engine/boot-idset.int.test.ts` (new, engine-owned: #125 restart clauses, #130)
  - `apps/hub/test/engine/live-replay.property.int.test.ts` or a new `apps/hub/test/engine/zone-filter.int.test.ts` (#125 live and replay)

**Interfaces:**
- Engine:
  - `foldItemAdded` with `served_from_zone_id != null` → returns `state` itself, no diagnostic.
  - `foldOrderPlaced` with `order_item_ids.length === 0` → returns `state` itself.
- Host: `untrackedLineIds: Set<string>` in host memory (`host-flags.ts`), not engine state, cleared at restart. Ids come from:
  - live: committed `ItemAdded` with `served_from_zone_id != null` or `line_kind === 'deal'`;
  - boot: the step-3 replay's `ItemAdded` rows, plus one read.
- The boot read (03a §3.12):

  ```sql
  SELECT json_extract(payload, '$.order_item_id') FROM events
  WHERE branch_id = ? AND stream_type = 'order' AND seq > ? AND event_type = 'ItemAdded'
    AND (json_extract(payload, '$.served_from_zone_id') IS NOT NULL OR json_extract(payload, '$.line_kind') = 'deal')
  ```

  The `seq > ?` value: the older `last_seq` when step 2 read **two readable** checkpoint rows; else `0` (a torn or unparsable row does not count).
- `logAbsentIds` skips:
  - `ItemAdded` with `served_from_zone_id`;
  - `ItemServed` with `source: 'zone'`;
  - `ItemRemoved` / `ItemVoided` whose id is in the set.

- [ ] **Step 1: Write the failing tests.**
  - `[03a #124]` both folds return the same object (`toBe`), and `diagnostics` stays empty.
  - `[03a #125]`, all three legs:
    - live: no `absent id` line for each of the four shapes;
    - full replay: no `invalid_event` diagnostic for the zone `ItemAdded`;
    - restart, three cases (one checkpoint → read from 0; two readable → read from the older; two with the newer torn → read from 0), each with no false warn, using the §3.12 sequence (O1, H1 deal, Z1 zone, served, exit, close, checkpoint C, restart, `ItemVoided` Z1 and `ItemRemoved` H1);
    - control, live only: the same events on an unknown id log one line each.
  - `[03a #130]` step 3 = 4 + 2 + 1 statements; the read's bound per the three cases; `EXPLAIN QUERY PLAN` shows `events_branch_stream`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, plus all of `packages/engine/test` and `apps/hub/test/engine` (`boot.int.test.ts` included, read-only for this lane) → PASS. Replay = live (test 94 and the property test) must hold.
- [ ] **Step 5: Commit.** `feat(03a): zone lines, empty orders, absent-id filter and boot id set [03a v1.2 Q-3, R-3; 02p §11 #15]`.

### Task 16: Q-4 partial `ItemRemoved` · Lane: engine · RISK: NORMAL · Shared

**Rows:** 03a v1.2 Q-4 (§3.7, §4.2).

**Files:**
- Modify:
  - `packages/engine/src/apply-event.ts` (`foldItemEnded` :793 for `removed` with `units`)
  - `packages/engine/src/stock.ts` (`stockEffects(ItemRemoved)`: the share path used by `ItemVoided { units }`, not `lineReleases`)
- Test: `packages/engine/test/stock-effects.test.ts`, `packages/engine/test/lines.test.ts`

**Interfaces:** `ItemRemoved { order_item_id, units? }`.
- `units` absent, or ≥ the line's units → the whole line, exactly as before (test 88 unchanged).
- Else the partial-void unit path: the line keeps `units − n`, and each draw releases `n`'s share with reason `removed`.

- [ ] **Step 1: Write the failing tests.**
  - `[03a #126] units 1 on a 3-unit from-stock line → one unit's share released per draw, line keeps 2`
  - `[03a #126] units absent → whole line (test 88 holds)`
  - `[03a §3.7 Q-4] units ≥ line units removes the whole line once` (Review Focus 4)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all of `packages/engine/test` → PASS.
- [ ] **Step 5: Commit.** `feat(03a): partial ItemRemoved [03a v1.2 Q-4; 02p §11 #16]`.

### Task 17: Q-5 `StockTransferredOut` fold and replay list; Q-6 `ItemServed` fields · Lane: engine · RISK: HIGH · Shared

**Rows:** 03a v1.2 Q-5, Q-6; 01a #194 third clause ("boot fold counts it", M-6).

**Files:**
- Modify:
  - `packages/engine/src/replay-events.ts` (`stock` list gains `StockTransferredOut`)
  - `packages/engine/src/apply-event.ts` (new `foldStockTransferredOut`; `foldItemServed` :775)
  - `packages/engine/src/stock.ts` (`stockEffects(StockTransferredOut)` = `[]`)
- Test:
  - `packages/engine/test/state.test.ts:208` (the replay list; n-4)
  - `packages/engine/test/replay-events.test.ts` (test 94)
  - `packages/engine/test/stock-folds.test.ts`
  - `packages/engine/test/lifecycle.test.ts` (`served_at`)
  - `apps/hub/test/engine/boot-idset.int.test.ts` (01a #194 "boot fold counts it")

**Interfaces:**
- `foldStockTransferredOut`: `on_hand −= quantity`, clamped at 0; a breach is appended to `state.diagnostics` (non-strict) or thrown (strict), like `foldStockAdded`'s clamp rule. No reservation and no re-plan.
- `foldItemServed`:
  - `source: 'zone'` → returns `state` itself;
  - otherwise, the served time = `min(served_at ?? recorded_at, recorded_at)`.

- [ ] **Step 1: Write the failing tests.**
  - `[03a #127] lowers on_hand, clamps at 0 with a logged breach`
  - `[03a #127] unknown stock item creates no phantom entry beyond the clamp rule` (Review Focus 5)
  - `[03a #94] the applyEvent cases equal the union of the lists, with StockTransferredOut`
  - `[03a #127] replay = live over a day with transfers`
  - `[03a #128] source 'zone' is a no-op`
  - `[03a #128] served_at earlier → served_at; later → recorded_at`
  - `[01a #194] the boot fold counts StockTransferredOut`
  - Update `state.test.ts:208`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `ENGINE_STATE_VERSION` stays 3, and the snapshot fixture test (#56) stays green.
- [ ] **Step 4:** Run all of `packages/engine/test` and `apps/hub/test/engine` → PASS.
- [ ] **Step 5: Commit.** `feat(03a): StockTransferredOut fold, ItemServed zone and served_at [03a v1.2 Q-5, Q-6; 02p §11 #17]`.

---

## Batch 6 — regression (engine lane, after the owner merges both lanes)

### Task 18: simulator gate, full gate, README · Lane: engine · RISK: NORMAL

**Rows:** 02p U-9, §7 regression gate, §12.1 DoD.

- [ ] **Step 1:** On the merged head (all three lanes), run `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` → green. Record files, tests and wall time in the status board.
- [ ] **Step 2:** On the real disk, alone on a quiet machine, with no `TMPDIR`: `pnpm test:perf`. Record the 03a §7.1 table next to the 03a v1.0.1 A/B. The three SQLite-COMMIT rows are expected to fail on this laptop (deferred to 03a task 28). Any other red row → STOP. Gap 4: the slip raise path is now timed; record the number.
- [ ] **Step 3:** Check 02p §10 Acceptance: `git diff main..HEAD --stat` touches only 00 / 01a–01d / 03a files and the listed shared files. List every file, and record any surprise as an AD row.
- [ ] **Step 4:** README: the 02p row becomes "Built" (with the merge sha); the "built in 02p" cells of 00 v1.8, 01a v2.2–v2.3, 01b v1.6–v1.7, 01c v1.1.2, 01d v1.2.1 and 03a v1.2 become "built". Check that the 02a v1.1.1 and 02b v1.0.1 §11 notes are still true (DoD).
- [ ] **Step 5: Commit.** `docs(02p): built, gate green [02p §12.1; README]`. Push, then STOP for the owner.

---

## Self-review (writer, 2026-11-08)

- **Coverage.** Every §11 task 1–18 is here, in three lanes (owner, 2026-11-08). Every U-n maps to a task in the Coverage table. Every 03a v1.2 test 120–130 and 01a 181–195 is placed. 00 152–158 are in tasks 11 and 12. 01d test 25 is in task 13.
- **Names and types.** The same across tasks: `registerSlipReaders`, `holdersOfOrders`, `currentTableOf`, `zonesOf`, `assignedOrderTaker`, `queueable`, `ctx.queuedAt`, `untrackedLineIds`, `StockTransferredOut`.
- **Open for the controller.** The exact cloud file for the branch settings `PATCH` (task 9) and the owner settings form (task 6) are found at build time; the spec fixes the behaviour.
