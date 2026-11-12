# 04 gap sweep (P0.0, before phase 0)

> Pre-flight of `docs/plans/04-plan.md` (task P0.0). Read against `main` at `23cfa1b` (`spec-04` merged, PR #87). Spec: 04 v1.0. Every line number is on that commit. Part 1 holds the exact names the lanes use. Part 2 lists the real mismatches as G-rows, each with options and a Rec. Part 3 lists risks that need no ruling. **Ruled 2026-11-12 13:17 PKT (owner: "Your calls"): every G-row takes its Rec (G-1 b, G-2 a, G-3 a, G-4 a, G-5 a, G-6 a, G-7 a, G-8 b, G-9 a + c, G-10 a, G-11 a, G-12 a, G-13 a, G-14 a, G-15 a, G-16 a, G-17 a, G-18 a + b, G-19 a, G-20 b, G-21 b, G-22 a, G-23 a).** Plan patched (§ "Gap sweep patches" in `04-plan.md`). Spec text rows (G-1, G-7, G-8, G-11, G-12, G-14, G-17, G-19, G-20, G-21, G-23) land in P0.2: the target bumps carry them, and 04 itself bumps to **v1.0.1** (changelog + "Changed by v1.0.1 (G-n)" markers; v1.0 kept).

Spec numbers for P0.2: no open PR, and no `module-*` / `spec-*` branch adds a spec file that `main` lacks. The plan's numbers stand: **F v1.13, 00 v1.10, 01a v2.5, 01b v1.9, 01d v1.2.5, 02b v1.0.10, 03a v1.2.4**. 01e is not started, so 00 v1.10 is free. Migrations: hub next **0017**, **0018**; cloud next **0013**.

## 1. Exact names

### 1.1 Hub platform (00 / 01a)

| Need | Actual | File:line |
|---|---|---|
| `Projection` | `{ name, eventTypes, apply(tx, e, mode: 'live' \| 'catchup'), reset?(tx) }` | `apps/hub/src/projections/registry.ts:6-11` |
| `ProjectionRegistry` | `register`, `applyAll(tx, events, branchId)`, `catchUp(db, branchId) → { replayed }`, `afterCatchUp(fn)`; no names API | `registry.ts:13-18` |
| `applyAll` today | **upsert** of every registered projection's checkpoint (`INSERT … ON CONFLICT DO UPDATE`) | `registry.ts:46-56`, SQL `:122-128` |
| `catchUp` | writes a row for every projection (no row → job from 0, `reset` then) | `registry.ts:57-118` (`:67-71`, `:107`) |
| `createDeps` | 6 `register*` calls → 14 projections (branch_config, item_availability, alerts, alert_flags, alert_receipts, presence_today, device_bindings, tables, orders, kds_config, device_roles, pass, print_config, kitchen_tickets); callers setup `:116`, boot `:158` | `apps/hub/src/lib/boot.ts:301, :316-322` |
| boot step 3a | `ClockAlarm { source: 'boot' }` appended through `writer.run` → `applyAll` | `boot.ts:160-175` |
| `access_reconcile` | `registerAccessReconcile({ projections, writer, clock })` after 3a, before `catchUp`; also in the admin-bootstrap CLI | `boot.ts:176`; `projections/access-reconcile.ts:17-38`; `setup/issue-admin-bootstrap.ts:43-57` |
| `registerHubProjections` | does not exist (P0.5 adds it) | — |
| `createTestHub` | copies the 6 calls, never calls `catchUp`; writer branch `config.provisioned?.branch_id ?? 'branch-unset'` | `apps/hub/test/helpers/test-hub.ts:70-77, :94` |
| big fixture | `PROJECTIONS` hand list of 8; cache key `sha256hex({ migrations, projections })`; checkpoint insert | `apps/hub/test/helpers/big-fixture.ts:15-24, :28-39, :95-96` |
| 00 #67 / M48 tests | #67 `:21-51` (first `applyAll` `:40`); M48 "advances every checkpoint" `:53-82` | `apps/hub/test/projections/registry.int.test.ts` |
| 00 #100 | exists, forced alarm (`wallNow: () => DECOY_AT`) | `apps/hub/test/boot/boot-budget.int.test.ts:22-76` |
| per-projection statement tests | N = checkpoint row count: set-station-capacity `:168-195`, receipts `:453-459`, fires-tick `:238-262` | `apps/hub/test/{engine,alerts}/…` |
| `statementCounter(db)` | `{ readonly count; reset() }` (test helper) | `apps/hub/test/helpers/statement-counter.ts:3` |
| `staff`, `no_pin_staff` | `staff(staff_id PK, branch_id, display_name NOT NULL, pin_hash, lead_staff_id)`; `no_pin_staff(staff_id PK, display_name NOT NULL, lead_staff_id)` | hub `0003:1-6`, `0005:24`, `0006:95-97` |
| directory apply | `applyStaffDirectory(tx, d, setDirectory)`; version skip `:27-30`; staff loop `:77` (dup skip `:78-80`, bad `pin_hash` skip `:83-93`); no-pin loop `:155` (skip `:156-158`); `replaceCache` `:343-380`; runs in the caller's tx | `apps/hub/src/auth/apply-directory.ts:21` |
| `CloseBusinessDay` | admin, `manage-stock`; `not_open` `:21-32`, `opened_recently` `:33-41` (both `200 { changed: false }`); append `withStockEffects(ctx, [BusinessDayClosed])` `:44-68` | `apps/hub/src/commands/close-business-day.ts` |
| guard pattern | `registerMergeGuard(fn)`, `resetMergeGuard()`, `checkMergeGuard(db, q)` (none → 0 statements) | `apps/hub/src/tables/merge-guard.ts:9-21` |
| `CommandDef` / `CommandCtx` / `PreReadCtx` | `approvable?` `:56`, `queueable?` `:59`, `preRead?(db, payload, ctx)` `:61`; ctx `:13-32`; preRead ctx `:38-48` | `apps/hub/src/commands/registry.ts` |
| `defineQuery` | no `permission` field (check in `handle` via `ctx.directory.resolve`); `QueryCtx { db, page{cursor,limit}, directory, device, session, state, branchConfig, now }` | `apps/hub/src/queries/registry.ts:16-42` |
| list cursor | shared: `pageParams` (default 50, 1–200), `pagingOf`; encode / decode per query (alerts-inbox pattern); `querySchema` must declare `cursor`, `limit` | `queries/registry.ts:44-52, :155-162`; `alerts/queries/alerts-inbox.ts:91, :95, :169` |
| directory lookups | `directory.get(id)` `:266`, `directory.isNoPin(id)` `:364` | `apps/hub/src/auth/staff-directory.ts` |
| server wiring | `registerAlerts` `:208` … `registerPrint` `:213` → `registerVoids` / `registerAudit` after `:213`, before `registerUiAssets` `:214`; `registerCloseBusinessDay` `:173` | `apps/hub/src/server.ts` |

### 1.2 01d alerts

| Need | Actual | File:line |
|---|---|---|
| `defineAlertKind` | `defineAlertKind<V, D extends AlertDetails = never>(def)`; fields `:77-97`; `labels { card, lock, short? }` `:29`; startup checks `:106-145` (04 §3.5 passes them all) | `apps/hub/src/alerts/kinds.ts:103` |
| request part | `{ answers, right: { mode: 'approval', base_permission, range_permission? }, needs_pin, apply(ctx: AlertApplyCtx, answer: AnswerFacts), onWithdraw?(ctx) }`; **no `result_also_to`** | `kinds.ts:61-74` |
| `AnswerFacts` | `{ decision, answerer_staff_id, method, device_id, answered_at }` | `kinds.ts:36-42` |
| `AlertRecord` | `{ alert_id, kind, family, subject, dedupe_key, requester_staff_id, receiver_staff_id, raised_device_id, values, display, details, step, raised_at }` | `kinds.ts:45-59` |
| `APPROVAL_TIER_STEPS` | 3 steps (answerers; repeat + always_on; escalation) | `kinds.ts:187-191` |
| read-only tx | `readOnlyTx(tx)` | `apps/hub/src/engine-host/read-only-tx.ts:48` |
| `alerts.raiseMany` | `(ctx, inputs: RaiseInput[]) → RaiseResult[]`; `RaiseInput` `:45-68`; dedupe `:154-172` | `apps/hub/src/alerts/raise.ts:147` |
| `alerts.listOpen` | `(db, { kind?, subject? })`, 1 statement | `raise.ts:507` |
| `request_result` | `requestResultInput(request, outcome)`; target hard-coded `person` `:398`; dedupe `request_result:<alert_id>` `:402` | `raise.ts:383-404` |
| `checkAlertIds` | `(command, hook, record, drafts)` | `apps/hub/src/alerts/commands/request-row.ts:107` |
| answer | `runApply` `:108`; `preRead` `:132`; `handle` `:208`; answer raises `:238-249`; one `raiseMany` `:250-252` (no function named `prepare`) | `apps/hub/src/alerts/commands/answer-request.ts` |
| withdraw | `onWithdraw` on a `readOnlyTx` + `checkAlertIds` | `apps/hub/src/alerts/commands/withdraw-request.ts:40-43` |
| `AlertTarget` table_team | `{ kind: 'table_team', table_id, depth?: 'owner' \| 'direct' }` (absent = direct); resolver by 02a, not cached per tx | `packages/events/src/alerts.ts:36`; `apps/hub/src/tables/index.ts:43`; `alerts/targets.ts:283, :303` |
| `AlertDetailsBase` | V1 `item, quantity, amount, reason ≤200`; V2 + `minutes_late, lines[{ name, quantity, state }]` (no max); live + `identifier ≤40, station_name, printer_name, problem`; no `disposition` | `packages/events/src/alerts.ts:67-87` |
| `.pick` / display precedent | `CompDetails = AlertDetailsBase.pick(…)`; `tableCode(primary_table_id)` (private), display `{ kind_label_key, table_code, requester_name }` | `apps/hub/src/orders/comp-kind.ts:11-36`; `orders/commands/comp-line.ts:151-158, :174-178` |
| `AlertRaised` | v1, v2, v3 (identity upcasters), exported `index.ts:37-50`; `raise.ts` payload type V3 `:141, :203`, version from `latestVersion` `:341` | `packages/events/src/events/alert/` |
| `alerts` table | `values_json` `:15`, `details_json` `:17`; index `alerts_open_kind ON alerts(kind, raised_at) WHERE state='open'` `:33` | hub `0006_alerts.sql` |
| request events | `RequestAnswered { alert_id, decision, answerer_staff_id, method, device_id, on_requester_device }`; `RequestWithdrawn { alert_id, by_staff_id }`; `RequestPinFailed` (strict); `AlertClosed { alert_id, reason, by_staff_id \| null, note }` | `packages/events/src/events/alert/` |
| 01d answer bounds today | preRead = 1 (`answer-request.int.test.ts:194-205`); one `raiseMany` = 6 + R + T (`personal-notices.int.test.ts:379-416`); no whole-`handle` count test | `apps/hub/test/alerts/` |

### 1.3 02a / 02b orders

| Need | Actual | File:line |
|---|---|---|
| `planVoid` | `(parent: LedgerParent, children: LedgerRef[], n) → { lines: [{ order_item_id, units, after, payload }], refund_minor, comp_voided_minor }` (0-unit cascade lines dropped); `planRemove` `:179`, `planComp` `:223` | `apps/hub/src/orders/ledger.ts:194` |
| `readOrder` | `(ctx, order_id) → { order: OrderHead, lines: Line[] }`, private, throws `ORDER_NOT_FOUND`; no token / car / business_date / table_ids; LEFT JOIN `seatings` with no state filter | `apps/hub/src/orders/commands/remove-items.ts:44, :55, :58-74` |
| `orders` columns | `business_date`, `token`, `car_number`, `car_type` exist | hub `0013_orders.sql:7-9` |
| seatings | `seating_tables(…, joined_at)` (rows deleted on `TableCleaned`); `seating_orders` rows never deleted | hub `0012_tables.sql:18-25`; `tables/projection.ts:194` |
| `orders/exports.ts` | `seatingTotals` `:65`, `orderLines` `:79`, `ordersOf` `:116` (1 statement each, take `db`) | `apps/hub/src/orders/exports.ts` |
| `LineChangeDrafts` | `(ctx, order_id, changes) → EventDraft[]`, no options | `apps/hub/src/orders/contracts.ts:111` |
| line change | `lineChangeDrafts` `:101` (2 statements) → `changeDrafts(ctx, order_id, before, changes)` `:69` (`freeOf` judges **every** open comp `:78-81`); `staleCompCloses` `:28-43` (always `listOpen`); `COMP_KIND = 'comp'` `:20` | `apps/hub/src/orders/line-change.ts` |
| `applyComp` | in **comp-line.ts** (comp-kind.ts imports it) | `orders/commands/comp-line.ts:210` |
| check order | CompLine: 404 `:100` → 409/400 `:110-128` → `checkScope` `:163` → `planComp` `:167`. RemoveItems: billed `:127` → `requireLock` `:137` → plan loop `:158-190` → `checkScope` `:192` → `changeDrafts` `:202`. SetLineWeight: 404 `:45` … `LINE_ALREADY_SETTLED` `:53` → `checkScope` `:55` | `orders/commands/{comp-line,remove-items,set-line-weight}.ts` |
| order events | `OrderCancelled { order_id }`, `OrderFoodCleared { order_id, food_served }`, both `.strict()` | `packages/events/src/events/order/` |
| `ItemVoided` fold | `applyVoided` (caps at live, comped units last) | `apps/hub/src/orders/projection.ts:69, :295` |
| `order_lines` | `parent_order_item_id`, `line_kind`, `sale_unit`, `quantity`, `units`, `refundable_minor`, removed / voided / comped units, `comp_voided_minor`, `returned_units`, `served_at`, `is_food`; **no `live_units` column** (derived: `liveUnits` ledger.ts:49) | hub `0013_orders.sql:27-49` |
| merge guard | `MergeGuard (db, { seating_ids, order_ids? }) → { blocked, order_item_ids }`; merge passes `{ seating_ids }`, split adds `order_ids` (moved orders) — ready for v8 | `tables/contracts.ts:58`; `tables/commands/{merge-tables,split-seating}.ts:131-132` |
| `currentTableOf` | **02a's** (not 03b's): `(db, order_ids) → Map<order_id, { seating_id, primary_table_id, table_ids }>`, 1 statement; an order with no open seating has **no entry** | `apps/hub/src/tables/reads.ts:32-49` |
| error codes | exist: `VALIDATION_FAILED` `:2`, `MERGE_BLOCKED_BY_VOID` `:59`, `ITEM_WRONG_STAGE` `:63`, `VOID_PENDING` `:64`, `LINE_ALREADY_SETTLED` `:89`, `COMP_PENDING` `:91`, `CONFIG_REFERENCE_INVALID` `:102`; absent: `VOID_NOT_ALLOWED`, `DAY_CLOSE_BLOCKED` | `packages/domain/src/errors.ts` |
| fixtures | orders: `FX`, `fixtureMenu`, `openDay`, `openSeating`, `setZoneStock`, `appendOrder`; kds: + `COOK`, `cookDirectory`, `signInCook`, `pairDevice`, `pairKds`, `pairPassTablet`, `append`, `fireLines`, `serveLines`, `removeLine`, `voidLine` `:119` | `apps/hub/test/{orders,kds}/fixtures.ts` |

### 1.4 03a engine / stock, 03b identifier

| Need | Actual | File:line |
|---|---|---|
| `stockEffects` | single: `(state, draft, ctx?)`; array: `<D>(state, drafts, ctx?) → Array<D \| StockDraft>`, per-draft loop, no pre-scan `:546-553` | `packages/engine/src/stock.ts:539-554` |
| `StockCtx` | `{ dayStartMs, stockItems, configStockUnits }`; missing ctx on a move → plain `Error` (`needCtx`) | `stock.ts:130-134, :350-353` |
| `waitingReserve` | `(state, stock_item_ids, t, ctx, except?: string)` — one id | `stock.ts:283-296` |
| scratch `book` | folds stock events only; `ItemVoided` / `ItemRemoved` no-op on it | `stock.ts:304-348` |
| causes | `ItemVoided` → `shareReleases(…, 'voided')` `:486-489`; `ItemRemoved` (absent `units` = whole) `:479-483`; `ItemMovedToStock` → `moveDrafts` + `waitingReserve(…, line id)` `:491-499` | `stock.ts` |
| `moveDrafts` | releases the **whole line's** reserve + `StockAdded { reason: 'moved' }`; non-integer share throws | `stock.ts:411-429` |
| `isEngineLine` / `isOrderInEngine` | `station_id !== null && line_kind !== 'deal'`; `(state, order_id, t)` | `packages/engine/src/plan.ts:17-19`; `lifecycle.ts:70-73` |
| stages | `added, cooking, done, served, removed, voided, returned` (`zone_undo` and `out_of_engine` are 02b `ITEM_WRONG_STAGE` values, not engine stages) | `packages/engine/src/state.ts:141`; `remove-items.ts:143, :146, :162` |
| state | `EngineOrder.table_id`; `EngineState.business_day` | `state.ts:101, :175` |
| `withStockEffects` / `openDayStockCtx` | `(ctx, drafts, stockCtx?)` restamps every output with `drafts[0]`'s envelope; `openDayStockCtx(state)` throws a plain `Error` with no open day | `apps/hub/src/commands/set-precooked-stock.ts:51-67` |
| event schemas | non-strict: `ItemVoided { order_item_id, units, refund_minor?, comp_voided_minor? }`, `ItemMovedToStock { order_item_id, units }` (order dir); `StockReleased`, `StockAdded` v2 (`reason: 'moved'?`), `StockReserved` (stock dir) | `packages/events/src/events/{order,stock}/` |
| host absent-id log | `QUIET_ON_UNTRACKED_ORDER` `:147`, `QUIET_ON_UNTRACKED_LINE` `:149`, `LINE_EVENTS` `:151`, `logAbsentIds` `:159-205` | `apps/hub/src/engine-host/reducer.ts` |
| host tests | #125 control `zone-filter:70-81`; restart / snapshot `boot-idset:184-216`; #133 `:257-274`, #134 `:283`, #135 `:292` (`unknownVoid` `:255`); R-3 `:209-213`; probes `q3-lines.ts:32-46` | `apps/hub/test/engine/` |
| identifier | 03b `identifierText` (slice 40) `kds/commands/ready.ts:125-133`; 03c copy, no slice `print/render/jobs.ts:43-51`; `passIdentity` dine-in `kds/commands/handover.ts:84-96`; `Identifier` `packages/domain/src/kds.ts:5-8`; `tableLabel` `kds/details.ts:82-84` | as listed |

### 1.5 01b permissions, cloud, client

| Need | Actual | File:line |
|---|---|---|
| permissions | `void-item` `:2`, `move-item-to-stock` `:3` (both `branch`), `approve-void` `:53` (`branch`, `my_team`), `view-audit-log` `:16`; `DEFAULT_KEYS` `:107`; no `ALLOWED_ONLY_PERMISSIONS` | `packages/domain/src/permissions.ts` |
| default roles | `DEFAULT_ROLES`, cashier `:46-56`, order_taker `:62-70`, `allowed()`, `approvedByManager()`; test pins lists `default-roles.test.ts:56-61` | `apps/cloud/src/modules/staff-roles/default-roles.ts` |
| `checkGrants` | `(repo, grants, selfId?)`: duplicate → approver ⇔ `requires_approval` (`grants.N.approver_role_ids`) `:759-761` → scope → approvers active | `staff-roles/service.ts:754-773` |
| seed / schema | `seed-tenant` writes `role_permission_approvers` `:71-86`; CHECK `0001_platform.sql:41`; `role_permissions.scope` `0005:67`; approvers `0005:69-75`; `roles.default_key` `0005:31-34`, `archived_at` `0005:58`; `tenants.directory_version` `0001:8`; backfill precedent `0003_manage_stock_backfill.sql` | `apps/cloud/…` |
| roles editor | `GrantRow` options `RoleEditor.tsx:456-460`; keys `roles.grant.*` `en.ts:1168-1169` | `apps/client/src/features/owner/roles/` |
| day close client | `closeDay` refusal `if (!answer.ok) … return false` `:422-425`; `closeAndStart` `:443-445`; `errorMessage` by code `:56-61`; `Message { tone, text, detail? }` `:42`; `Banner` `:607`; chain test happy path only `BusinessDay.test.tsx:323` | `apps/client/src/features/admin/stock/StockApp.tsx` |

## 2. Mismatches (G-rows)

| G | Task | Spec / plan says | Code has | Options | Rec |
|---|---|---|---|---|---|
| **G-1** | P0.6 (H-1) | `staff_names` seed `INSERT … SELECT …, <now>` | migrations are plain SQL (`db/migrate.ts:70`), no hub clock | (a) `unixepoch('subsecond')*1000` wall time; (b) `(SELECT COALESCE(MAX(recorded_at), 0) FROM events)`; (c) `updated_at` nullable, seed NULL | **b** — hub-clock timeline, deterministic |
| **G-2** | u6 (H-1) | upsert every person in the input lists | input can repeat an id, or carry one id in both lists (skips `:78-80`, `:156`); cache keeps the first | (a) staff then no-pin, first wins (as the cache); (b) last wins | **a**, test beside "bad `pin_hash` still named" |
| **G-3** | P0.5 (H-2) | big fixture `PROJECTIONS` derived from `registerHubProjections` + `access_reconcile` | list has 8 of 15; #100 is green today only because the 3a upsert makes the other 7 rows; no names API | (a) recording stub registry in the fixture; (b) `names()` on the registry (00 contract change); (c) exported const list (drifts) | **a**, same commit as update-only |
| **G-4** | P0.2, P0.5 | "00 test list **adds** #100" | 00 v1.9 already has #100 (`:1808`), test forces the alarm | (a) P0.2 **restates** #100 (all projections + `access_reconcile`, forced alarm, checkpoint = MAX(seq)); P0.5 changes the fixture only; (b) leave text | **a** |
| **G-5** | a3 | "Foundation list cursor" | only `pageParams` shared; encode / decode per query | (a) copy alerts-inbox base64url JSON + Zod into `audit/queries.ts`, cursor `{ r: recorded_at, s: seq }`; (b) shared helper (touches 01d) | **a** |
| **G-6** | P0.5 (H-2) | — | admin-bootstrap CLI registers only `access_reconcile`; under update-only it stops writing that row; first boot replays it from 0 (idempotent, M40) | (a) no code, name the CLI in H-2's invariant note; (b) `catchUp` in the CLI | **a** |
| **G-7** | u7 (D-2) | `result_also_to(alert)`, 1 statement (`currentTableOf`) | no `db` reachable from `(alert)` | (a) `result_also_to?(ctx: AlertApplyCtx)` like `onWithdraw`, on a `readOnlyTx`, in `handle` on reject only (never in `preRead`); (b) `(db, alert)`; (c) module state | **a** |
| **G-8** | u7 (D-2) | "a target resolving only to the requester is not raised", +1 resolver statement | `raiseMany` resolves inside itself; resolver not cached per tx, so pre-resolving costs a 2nd statement; `requestResultInput` hard-codes target and dedupe | (a) kind returns `null` when holder = requester (+1 holder read); (b) internal `RaiseInput.drop_if_only?: staff_id` — `raiseMany` drops when routed recipients ⊆ that person; plus `target` / `dedupe_key` overrides on `requestResultInput`; (c) cache resolver results (refactor) | **b** — no extra statement, judges real recipients |
| **G-9** | u7, 04 #31 | "01d's tests assert the new bound" | no whole-`handle` count test exists | (a) 01d test with a fake approval kind with / without the hook: reject +2, approve / withdraw equal; (b) whole-handle test first; (c) `raiseMany` spy | **a + c**; 04 #31 cites it |
| **G-10** | v6 (§3.5) | `lines` ≤ 10, `state` ∈ `not_started / cooking / cooked / served` | base `lines` has no max, `state` any string | (a) kind-local `pick(…).extend({ lines })`; (b) slice in code only; (c) put it in the D-3 base | **a** — base and frozen versions untouched |
| **G-11** | P0.2 (D-1) | "decisions row 4" | it is row 4 of 01d v1.2.4's "Changes in v0.4" table (`:202`), not a §3.1 decision (those are A1–A14) | (a) "Changed by 04" marker on that row, real rule in §3.3 `:397` and To 05 `:784`; (b) rewrite the history row | **a** |
| **G-12** | u3 (Q-3) | CompLine asks the guard with **planned** touched ids, after its 404 / 409, **before scope** | `checkScope` `:163` runs before `planComp` `:167` | (a) move `compDrafts` / `planComp` (pure, 0 statements) above `checkScope`, ask with the plan's ids; `applyComp` plans then asks (1 → 2 statements); (b) ask with named line + all children before planning (over-blocks 0-unit children); (c) ask after scope (breaks C8) | **a**; RemoveItems (`:190`/`:192`) and SetLineWeight (`:53`/`:55`) already fit |
| **G-13** | u3 | files `orders/comp-kind.ts` for `applyComp` | `applyComp` is in `comp-line.ts:210` | (a) fix the plan's file list; (b) move the function | **a** |
| **G-14** | u1, v5 (Q-2, §3.5) | "no current table" = `table_ids = []` "as 03b's `currentTableOf`" | `currentTableOf` is **02a's** and returns **no entry** for an order with no open seating; `readOrder`'s seatings join has no state filter, so a closed seating gives a non-null `primary_table_id` with `table_ids = []` | (a) 04's identifier keys "no current table" on `table_ids.length === 0` and ignores `readOrder`'s `primary_table_id` for it; `result_also_to` uses `currentTableOf` (no entry → `null`); text fix in P0.2; (b) add `s.state <> 'CLOSED'` to `readOrder` (changes RemoveItems' path); (c) add `seating_state` to the row | **a**; test 20c gets a closed-seating fixture |
| **G-15** | u2 (Q-4) | `lineChangeDrafts(…, { stale_comps })`; judge only lines in `changes` | RemoveItems calls `changeDrafts` directly (`:202`), so a wrapper-only option misses it; `freeOf` judges every line | (a) option on `changeDrafts` too: `keep` skips `staleCompCloses`; `freeOf` → `undefined` for ids not in `changes`; widen `LineChangeDrafts`; (b) wrapper only | **a** |
| **G-16** | u1 (Q-2) | export `readOrder` + its row type | private types `OrderHead`, `Line` (too generic); `exports.ts` convention is `db` + 1 statement + no throw | (a) export `readOrder` from `exports.ts` with types `ReadOrderHead` / `ReadOrderLine`, `table_ids: string[]` parsed from JSON; note the `ctx` / throw exception in the file header; (b) keep it in `remove-items.ts`, re-export | **a** |
| **G-17** | u4 (T-2) | exclude every line named by any `ItemVoided` / `ItemRemoved` in the array + the moved line | `waitingReserve(…, except?: string)` one id; no pre-scan | (a) pre-scan the array into a `Set`, thread it into every `waitingReserve` call, `except: ReadonlySet<string>`; single-draft overload uses `{ moved line }`; empty set for 01a / BF-8 arrays; (b) set only in the move case; (c) fold voids into the scratch `book` (wider, changes BF-8) | **a** |
| **G-18** | u5 (T-3) | restate #125, #133–#135 with an `ItemServed { source: 'tap' }` probe; remove R-3 | 8 `voided(…)` probes in `boot-idset` (`unknownVoid` `:255`); #125 control expects void / remove warns | (a) swap `unknownVoid` for `served(…, 'tap')`, drop the two void rows of the control; (b) also add an `ItemStarted`-unknown warn row | **a + b** |
| **G-19** | u9 (B-2) | `requires_approval` on `move-item-to-stock` → `422 { field: 'grants.N.grant_type' }` | the approver check (`:759-761`) runs first, so no-approver gives `grants.N.approver_role_ids` | (a) allowed-only check first, before `:759`; (b) after | **a** — one deterministic field for #32 |
| **G-20** | P0.6 (B-1) | backfill by `default_key`, manager as approver | `roles.archived_at` exists; a migration bypasses `checkGrants`' archived rule | (a) accept (pre-live); (b) `archived_at IS NULL` on grantee and manager; (c) error if manager archived | **b** |
| **G-21** | UA (A-1 client) | show "`count` void requests are still open" + the list | `Message { tone, text, detail?: string }`; no `DAY_CLOSE_BLOCKED` texts; no test of the refused chain | (a) join list into `detail`; (b) `items?: string[]` on `Message`, rendered in `Banner`; (c) dialog | **b** + a `closeAndStart` test: a 409 sends no Open |
| **G-22** | P0.4 | `z.enum(VOID_REASON_CODES / VOID_DISPOSITIONS)` | constants do not exist yet (P0.3) | (a) P0.4 needs P0.3 (already sequential; say so); (b) inline enums | **a** |
| **G-23** | P0.2 (02b v1.0.10) | — | 02b §3.5 (`:158`) still says `lineChangeDrafts(tx, …)`; statement comments `remove-items.ts:20-22`, `comp-line.ts:204` and 02b §6.2 / §6.3 / §6.8 counts go +1 with a registered guard | (a) fix in the same v1.0.10 pass; (b) leave | **a** |

## 3. Risks (no ruling; carried into lane prompts)

- `openDayStockCtx` throws a plain `Error` (→ 500) with no open day: rule 7 `day_closed` must run **before** `withStockEffects(…, anyMoved ? openDayStockCtx(state) : undefined)` (v3 / v4).
- `withStockEffects` restamps every draft's envelope from `drafts[0]`: `alert_id` stamping (§3.3 step 5) goes on **payloads**, after the call (v3 / v7).
- `moveDrafts` releases the **whole** line's reserve on a partial move; safe only because `cooking` / `done` lines hold `reserved = 0` — spike P0.9 pins it.
- Q-2's `json_group_array(… ORDER BY …)` needs SQLite ≥ 3.44: u1 runs `select sqlite_version()` first (`better-sqlite3` 13.0.3).
- D-3 must land (P0.4) before the kind's `details_schema` with `disposition` typechecks; `approval_receipt` copies details through `AlertDetailsBase` (`kinds.ts:308`), so it picks `disposition` up then.
