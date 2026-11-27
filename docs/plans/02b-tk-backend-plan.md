# 02b-TK Takeaway — backend plan, Part B (hub, cloud, packages)

**Status: DRAFT plan, 2026-11-24. No task starts before the owner approves the Part B spec package** (`docs/plans/02b-tk-spec-status.md`; the README "current version" rows move only then). Inputs: owner rulings R1–R9, OR-1–OR-7 and the owner corrections (`docs/plans/02b-tk-rulings.md`); Part A and "Before go-live" (`docs/plans/02b-tk-plan.md`); README "Migration numbers"; §11 / §4.5 / §5 / §10 of 02b v1.0.25, 03a v1.2.11, 03b v1.0.16, 01d v1.3.7, 00 HPA v1.13, Foundation v1.18, 05a v1.0.7, 03c v1.0.16, 05 v1.0.35, 01a v2.11, 01c v1.5, 01b v1.12, 05c v0.2 (all DRAFT).

## Header

| | |
|---|---|
| Scope | Backend only: `apps/hub`, `apps/cloud`, `packages/{domain,events,engine}`. Docs-only tasks are marked. |
| Not in scope | **Client work** (`apps/client`, `apps/client/board/`, `apps/tablet`): the client lane, on its own branch, after the hub task each client task reads. The client lane **must remove R2's "Hand over anyway" override** built in Part A C2-2 (strings `v.pay_first` suffix and `v.override`, `apps/client/src/i18n/en.ts:4183-4184`; 03b string `pass.hand_over_anyway`): until 02b §3.7a ships, a Due order cannot be handed over (OR-7). |
| Branch | Cut **`module-02b-tk`** from `origin/main` and merge `claude/02b-tk-specs` into it (approved specs + Part A commits) — task B1-0. Each batch is a PR into `module-02b-tk` (CI `gate.yml` runs on `module-*`); the module merges into `main` with the gate green. |
| Gate (end of every batch, before every push) | `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` |
| Never in the cloud or CI | `pnpm test:perf` (02b test 83, 03a test 194, 03a §10.6 simulator gate), printer / NFC / power-loss checks. They run on the owner's machine or the pilot box. No timing asserts in the normal gate (03a AD-32). |
| Rules (CLAUDE.md) | TDD (failing test first); **one task per commit**; commit cites the spec, e.g. `feat(orders): open-orders keeps paid takeaways [02b v1.0.25 §3.3, §6.16]`; fixed statement counts, no N+1 (each query task has its 1-row / 50-row statement-count test); no file outside the task; new codes in `packages/domain/src/errors.ts` + Foundation §6.2 (already appended in F v1.18). |
| Migrations | Every new file is named **at merge with the next free number**, in merge order; a merged file is never edited or renumbered (README "Migration numbers"). `main` holds hub `0027`, cloud `0019_recipes.sql`. **Cloud order:** `cashier_mark_served` (Part A1, renumbered) → `takeaway_menu` (01a) → `takeaway_role_grants` (01b) → `point_order_types` (01a PT). **Hub order:** `orders_takeaway` (02b; races 08 Part D `0028_inventory.sql`, whichever merges first takes `0028`) → `display_sessions` (00 HPA) → `device_profiles_board` (05a) → 05c's provisional `0030` / `0031` (after STOP-0). Cloud `0022` (05c relay) after STOP-0. |
| Sizes | S ≈ 1–2 h, M ≈ 3–5 h, L ≈ 6–10 h (implementation + tests + gate). |
| Open owner questions that could change tasks (ids only) | 02b **TK-Q16** (could add a `handed_at` column if test 83 fails), **TK-Q18**, **TK-Q19**, **TK-Q20**, **TK-Q21**; 03b **R2-M-4**, **R2-m-2**, **R2-m-7**, **PT-2**, **PT-4**, **PT-6**; 01a **PT-6**, **R2-m-3**, **R2-m-8**; 01d **R2-M-4**, **R2-m-6**; 05 **R2-M-4**, **R2-M-6**; 05a **R2-m-3**, **R2-m-4**; 05c **R2-M-5**, **R2-M-6**, **STOP-0** (X-2, X-6, Q-C), **STOP-C** (X-3, X-5); **04 v1.0.9** (audit bump not yet drafted). |

### Blocks

- **BLOCKED-APPROVAL** — every task below until the owner approves the package.
- **BLOCKED-04** — task AU-1 also waits for the **04 v1.0.9** spec bump (rows 05 V-4, 02b TK-16, 05a AU-1); no 04 draft exists yet (latest `04_Voids_Audit_Spec_v1.0.8.md`). Write and approve it first (docs task D-04).
- **BLOCKED-STOP-0 / STOP-C** — 05c beyond its pure rules (Batch 15 only) waits for the Paymob document, host-app eligibility and a proven server confirmation (STOP-0), and the card part for X-3 / X-5 (STOP-C) (05c v0.2 §11).
- **Engine install** — the v6 engine (Batches 3–4) is installed **after hours**, only after the day's `BusinessDayClosed` and its day-close checkpoint are written (03a §11 install note, v5 precedent; v5 snapshot skipped, §3.12).

---

## Tiers (owner 2026-11-24) — the order changes, nothing is dropped

**Tier 1** is built and merged first, **Tier 2** after. The lane split, start order and parallel groups are in `docs/plans/02b-tk-lanes.md`; the Codex instruction for Tier 1 is `docs/plans/02b-tk-codex-tier1.md`.

| Tier | Tasks |
|---|---|
| **Tier 1** — takeaway counter on day 1 | B1-0, B1-1, B1-2, B1-3, B1-4, B1-6; B2-1, B2-2, B2-3; E-1 … E-10; P-1, P-2; C-1 (whole migration), C-3 / C-4 (`business_day_end_local_ms`, `takeaway_slip_on_send` only); R-1, R-2; PT-1 … PT-4; N-1, N-2; K-1, K-2, K-3; AU-1 (Tier 1 actions, after the 04 v1.0.9 draft); U-1 … U-4; CB-1, CB-2; S-1 … S-5 (slip without the QR until Tier 2); X-1 / X-2 (Tier 1 parts); all new error codes (in L0a) |
| **Tier 2** — after Tier 1 is merged | B1-5, B2-4; P-3, P-4, P-5, P-6; C-2, C-3 / C-4 (companions, short codes, `rush_open_orders`); H-1 (session kind / events), A-1 (board contracts), H-2 … H-11; A-2 … A-4; N-3; AU-1 (`board` detail); X-1 / X-2 (rest) |

Batch numbers below are the original dependency order; within a tier, follow the lanes file.

## Batch 1 — Prerequisites for G-1 and the pickup (7 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| B1-0 | Build branch `module-02b-tk` (origin/main + `claude/02b-tk-specs`); rename Part A1's `0019_cashier_mark_served.sql` to the next free cloud number (`0020` while 08d's `0020_inventory_receiving.sql` is unmerged) and fix its scratch-DB test's "at 18" to the new predecessor | README "Migration numbers"; 01b v1.11 §6.15 (A1) | cloud, rename only (order #1) | `apps/cloud/src/db/migrations/00NN_cashier_mark_served.sql`, `apps/cloud/test/db/cashier-mark-served-migration.int.test.ts` | A1 tests re-run | S 2 h | approval |
| B1-1 | Error `PICKUP_TIME_INVALID` (422, `{ reason, pickup_at_ms, earliest_ms, latest_ms }`) + `PICKUP_MIN_LEAD_MS` constant | 02b §9, §3.2 step 2b, §11 23(a); §4.5 TK-1; F v1.18 §6.2 | — | `packages/domain/src/errors.ts`, `errors.test.ts`, `packages/domain/src/` (constant) | errors catalogue test | S 1 h | B1-0 |
| B1-2 | `phoneKey` (pure, rules 1–4, 3a, 3b) + hub migration `orders_takeaway` (`pickup_at_ms`, `phone_key`, `option_id`, `deal_part_id`, `option_refs_json`, `unpaid_handover_approved_at`; indexes `orders_open_takeaway_paid`, `orders_phone`, `orders_placed`; `DELETE FROM projection_checkpoints WHERE projection = 'orders'`) + folds (`OrderPlaced`, `OrderContactSet`, `ItemAdded`) | 02b §3.1 Phone key, §5, §11 23(b) | **hub `NNNN_orders_takeaway.sql`**, next free at merge (hub order #1) | `apps/hub/src/orders/phone-key.ts`, `apps/hub/src/orders/projection.ts`, `apps/hub/src/db/migrations/NNNN_orders_takeaway.sql` | 02b 64, 65, 28, 29 (replay identity) | M 5 h | B1-0 |
| B1-3 | 05 `keyBalances(db, bill_keys)` read export (1 statement, 0 for none) | 05 v1.0.35 §6.2a, §4.2; 02b §4.5 TK-5 | — | `apps/hub/src/billing/queries/key-balances.ts`, billing exports | 05 #60e (+ 1 / 300 key statement count) | M 4 h | B1-0 |
| B1-4 | 03b `readyAtOf` export (latest `ReadyToServe` per order, whatever its alert state) | 03b v1.0.16 §4.2, §11 task 44 | — | `apps/hub/src/kds/exports.ts` | 03b 105 | S 2 h | B1-0 |
| B1-5 | 03b `LINE_READY_AT_SQL` scalar expression | 03b v1.0.16 §4.2, §11 task 46; 02b TK-3 | — | `apps/hub/src/kds/contracts.ts` | 03b 109 | S 2 h | B1-4 |
| B1-6 | 01a `businessDayLatestMs(opened_at, day_min_gap_hours, business_day_end_local_ms, utc_offset_ms)` + `BUSINESS_DAY_END_LOCAL_MS_DEFAULT` + hub snapshot key `business_day_end_local_ms` (optional, absent → default) | 01a v2.11 BD-3, §3.3, §4.3, §11 item 34 (5th bullet); 02b §3.2 step 2b | — | `packages/domain/src/` (helper + test), `packages/events/src/config.ts` | 01a 218 (pure + hub schema part), 214 (hub key) | S 2 h | B1-0 |

Gate. ≈ 18 h.

## Batch 2 — G-1 open orders (4 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| B2-1 | `openOrderRows` two-branch statement (takeaway open until handed over); `open-orders` row fields `bill { state, due_minor }` (via `keyBalances`), `ready_at` (via `readyAtOf`), `handed`, `lines_summary`, `lines_more`, `pickup_at_ms` (engine value while in engine); no contact fields; **≤ 5 statements**; flip 05 #83 | 02b §3.3 Open (lists), §6.16, §11 23(e); 05 v1.0.35 §10 #83 (TK-5) | — | `apps/hub/src/orders/queries/open-orders.ts`, `apps/hub/test/orders/queries.int.test.ts`, `apps/hub/test/orders/billing-rows.int.test.ts:111` | 02b 66, 67, 80 (open-orders part); 05 #83 | L 8 h | B1-2, B1-3, B1-4 |
| B2-2 | Catch-up part `orders` reads `openOrderRows(db, 'all')`: real `billed` / `billed_at`, `pickup_at_ms`; statements unchanged (4) | 02b §6.18 Catch-up part, §11 23(e) | — | `apps/hub/src/orders/catch-up.ts` | 02b 68 | S 2 h | B2-1 |
| B2-3 | `served_estimate` tick skips takeaway (filter on `order_type <> 'takeaway'`, 0 extra statements); parking keeps the estimate | 02b §3.7, §4.5 TK-9, §11 23(j); 03b v1.0.16 §3.4 (OQ-9) | — | `apps/hub/src/orders/served-estimate-tick.ts` | 02b 76, 77; 03b 124 | S 2 h | B2-1 |
| B2-4 | `takeawayProgress(db, state, filter)` export (2 statements; line `ready_at` rule, no-station lines held to the pickup) | 02b §4.2, §11 23(h) | — | `apps/hub/src/orders/exports.ts` | 02b 81, 80 (`takeawayProgress` part) | M 4 h | B1-5, B2-1 |

Gate. ≈ 16 h.

## Batch 3 — 03a whole-order hold, part 1 (5 tasks, `packages/engine`, pure)

All §3.5.8 PK rows; every test also asserts the same order with `pickup_at_ms: null` keeps its v1.2.10 placement (03a §10.3h kit).

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| E-1 | `ENGINE_STATE_VERSION = 6`; `newOrder` PK-1 normalisation (pickup ≤ `recorded_at` → `null`); v5 snapshot skipped; version asserts `state.test.ts:194`, `lines.test.ts:558` | 03a v1.2.11 §3.5.8 PK-1, PK-9, PK-11, §3.12 | — | `packages/engine/src/{version,apply-event}.ts` | 03a 180, 189 (version part) | M 4 h | B1-0 |
| E-2 | Held lines: `placeSequence` step order 3p / 4 / 4h, `placeImmediate`, `holdAndFire`, `trySyncAt`; ready and from-stock lines; kitchen-cannot-make-it | 03a §3.5.8 PK-1, PK-2, PK-8 | — | `packages/engine/src/plan.ts` | 03a 178, 179, 181; test 31 extended | L 10 h | E-1 |
| E-3 | Routing `chooseImmediate` (`max(arrival, p)`) and the FIFO option in the loop | 03a §3.5.8 PK-2, PK-4 | — | `packages/engine/src/route.ts`, `plan.ts` | 03a 182, 184 | M 5 h | E-2 |
| E-4 | Batch stations: `placeBatchImmediate`, `batch.ts` PK-3 sync join, R2-m-6 join and chain, `batchPass1` held step | 03a §3.5.8 PK-3, PK-7 | — | `packages/engine/src/{batch,replan}.ts`, `plan.ts` | 03a 183 | L 8 h | E-2 |
| E-5 | Later re-plans: `replan.ts` pass 1 held step (BQ-2), `overload.ts` `loOf` lower bound, auto-fill / `pullEarly` floor, `priority_due` crossing | 03a §3.5.8 PK-6, PK-7 | — | `packages/engine/src/{replan,overload,tick}.ts` | 03a 185 | L 8 h | E-4 |

Gate. ≈ 35 h.

## Batch 4 — 03a whole-order hold, part 2 (5 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| E-6 | Boost = early customer (clears `pickup_at_ms`); additions (`planOrder` uses the stored pickup), returns never held, release expedite; rewrite B3 tests `disturbances.test.ts:1099/1110/1121/1137` | 03a §3.5.8 PK-5, PK-7, §3.8a; Q-PK-1 | — | `packages/engine/src/{plan,apply-event}.ts` | 03a 186, 187 | M 5 h | E-5 |
| E-7 | Held groups slip (one slip-group set, R2-M-1) and `groupReadiness` for pickup orders (To 03b #12) | 03a §3.5.8 PK-6, §3.8; Q-PK-4 | — | `packages/engine/src/{slip,view}.ts` | 03a 190, 191 | M 5 h | E-6 |
| E-8 | Day close with a hidden held from-stock line (`StockReleased { day_closed }` first, order kept, checkpoint deferred) | 03a §3.5.8 PK-10, §3.7 | — | `packages/engine/src/{apply-event,stock}.ts` | 03a 188 | M 3 h | E-6 |
| E-9 | D62 fixtures `engine-state.v6.json`, `engine-log.v6.json`; live = replay harness (50 seeds) with pickup orders; simulator "pickup day" (run only by `pnpm test:perf`, owner's machine) | 03a §3.12, §10.6, PK-11, PK-12 | — | `packages/engine/test/` fixtures, `packages/engine/test/sim/` | 03a 189 (rest); 194 **test:perf only** | M 5 h | E-7, E-8 |
| E-10 | Hub engine tests: submit / preview with a fixture pickup batch; day-close writer order and deferred checkpoint; release note for the after-hours install | 03a §10.3h, §11 note; §3.12 | — | `apps/hub/test/engine/`, `docs/plans/03a-manual-checks.md` (install line) | 03a 192, 193 | M 3 h | E-9 |

Gate. ≈ 21 h.

## Batch 5 — Pickup on Send, lookups (6 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| P-1 | `SubmitOrder.pickup_at_ms` step 2b (takeaway only; earliest / latest via `businessDayLatestMs`; `no_time_left`, `other_day`, `too_early`, `after_day_end`; queued checks against `queued_at`) + `buildSubmit` `pickup_at_ms` (no more hard-coded `null`, `build-submit.ts:58`); additions copy nothing | 02b §3.1 Pickup time, §3.2 steps 2b, 7, 11, §11 23(c); 03a 02b-R4-1/-2 | — | `apps/hub/src/orders/commands/submit-order.ts`, `build-submit.ts`, `packages/events` command schema | 02b 59, 60, 61, 63, 78 | M 5 h | B1-1, B1-6, E-10 |
| P-2 | `eta-preview` draft `pickup_at_ms` + `pickup_bounds` | 02b §6.14, §11 23(d) | — | `apps/hub/src/orders/queries/eta-preview.ts` | 02b 62, 78 (preview part) | S 3 h | P-1 |
| P-3 | `SubmitOrder.order_id` must match `ULID_RE` (`400 VALIDATION_FAILED` path `order_id`, `not_ulid`) | 02b §3.2 step 3, §4.5 TK-10 (TK-Q17 = 00 OD-10) | — | `submit-order.ts`, `packages/domain/src/ids.ts` (reuse) | 02b 84 | S 1.5 h | B1-0 |
| P-4 | Hub request-log redaction adds `phone` (before `customer-orders`) | 00 HPA v1.13 §11 (11), 02b §4.5 TK-6 | — | `apps/hub/src/server.ts` (`redactQueryToken`) | 00 HPA 200 | S 1 h | B1-0 |
| P-5 | `GET /queries/customer-orders` (2 statements; visits by `COALESCE(bill_key, order_id)`; `RepeatLine`; `on_menu`; log `{ staff_id, matched }`) | 02b §6.18b, §11 23(f) | — | `apps/hub/src/orders/queries/customer-orders.ts`, query registry | 02b 69 | M 5 h | B1-2, P-4 |
| P-6 | `GET /queries/top-items` (1 statement, `item` lines only, ≤ 12) | 02b §6.18c, §11 23(g) | — | `apps/hub/src/orders/queries/top-items.ts` | 02b 70 | S 2.5 h | B1-2 |

Gate. ≈ 18 h.

## Batch 6 — Cloud config: 01a v2.11 + 01c v1.5 + 01b v1.12 settings (4 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| C-1 | Cloud migration `takeaway_menu`: `menu_item_companions`, `menu_items.short_code` + `menu_items_active_short_code`, `rush_open_orders`, `takeaway_slip_on_send`, `branches.business_day_end_local_ms`; ends with the `config_version` bump | 01a v2.11 §5.2c, MG-1, CP-1, SC-1, RO-1, TS-1, BD-1 (OD-8) | **cloud `NNNN_takeaway_menu.sql`**, next free at merge (cloud order #2, after B1-0's file) | `apps/cloud/src/db/migrations/` | 01a 206 | M 3 h | B1-0 |
| C-2 | Item `POST` / `PATCH` `companions` and `short_code` (01c v1.5 precedence, savepoint mapping), `SHORT_CODE_IN_USE` (errors.ts) | 01a v2.11 §3.3, §6.14, §6.15, §9, CP-2, SC-2; 01c v1.5 §6.4, §6.5 | — | `apps/cloud/src/modules/restaurant/{service,repository,schemas}.ts`, `packages/events/src/admin/restaurant.ts`, `packages/domain/src/errors.ts` | 01a 207, 208, 209, 211, 212, 213 | L 8 h | C-1 |
| C-3 | Menu read fields + snapshot builder (`items[].companions`, `short_code`, `engine_settings.rush_open_orders`, `takeaway_slip_on_send`, header `business_day_end_local_ms`) + hub schema keys + `HUB_ENGINE_SETTING_DEFAULTS`; builder statement count unchanged | 01a v2.11 §4.3, §6.1, §6.11, CP-4, SC-3, RO-3, TS-3, BD-3; 01c v1.5 §6.3 | — | `apps/cloud/src/modules/config-sync/builder.ts`, `packages/events/src/config.ts` | 01a 207, 210, 214 | M 5 h | C-2, B1-6 |
| C-4 | 01b settings `PATCH` / `GET`: `rush_open_orders`, `takeaway_slip_on_send` (`BRANCH_ENGINE_SETTING_KEYS`), branch field `business_day_end_local_ms` (whole minutes), S26 no-op | 01b v1.12 §6.10 (01a B-1, B-2); 01a BD-2, RO-2, TS-2 | — | `apps/cloud/src/modules/staff-roles/{service,repository,versions}.ts`, `packages/events/src/admin/staff.ts` | 01a 215, 217, 218 (cloud part); 01b 116, 117 | M 4 h | C-1 |

Gate. ≈ 20 h.

## Batch 7 — Roles and Pass points by order type (6 tasks)

PT rows: 01a v2.11 owner clarification PT-1 – PT-6, 03b v1.0.16 owner clarification PT-1 – PT-8 and §4.5 PT-R1 / PT-R2.

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| R-1 | Default role **Pass** (`run-pass`, `mark-served`, `reprint-ticket`; Cook unchanged) + permission **`hand-over-unpaid`** (`branch`, Owner / Manager, `ALLOWED_ONLY_PERMISSIONS`, group `orders`) + backfill of existing tenants; re-baseline `default-roles.test.ts`, `seed-tenant.int.test.ts` (seven roles) | 01b v1.12 §5.1c, §6.15, §11 item 11, B-4, B-5 (OR-2, OR-7) | **cloud `NNNN_takeaway_role_grants.sql`**, next free at merge (cloud order #3) | `packages/domain/src/permissions.ts`, `apps/cloud/src/modules/staff-roles/default-roles.ts`, `apps/cloud/src/db/migrations/` | 01b 20, 118, 119 | M 5 h | C-1 |
| R-2 | `hand-over-unpaid` joins `LISTED_ONLY_PERMISSIONS` | 05a v1.0.7 §3.3, L-1; 02b TK-13 | — | `packages/domain/src/screens.ts` (or the 05a lists file) | 05a 52 | S 1 h | R-1 |
| PT-1 | `routePoint(points, station, order_type)` + `POINT_ORDER_TYPES`, `ROUTING_WARN_ORDER_TYPES`, `RoutablePoint` (pure, browser-safe) | 03b v1.0.16 §4.4, PT-1, PT-2 | — | `packages/domain/src/kds.ts`, `kds.test.ts` | 03b 125–128 (PT-7) | S 2 h | B1-0 |
| PT-2 | Cloud `points.order_types` + points `POST` / `PATCH` `order_types` (`issueOnRepeat`, `'all'` = `NULL`, sorted) + builder sends `points[].order_types`; no `config_version` bump on migrate | 01a v2.11 PT-1, PT-2, PT-3, PT-5, §5.2a, §6.9a | **cloud `NNNN_point_order_types.sql`**, next free at merge (cloud order #4) | `apps/cloud/src/modules/restaurant/*`, `packages/events/src/admin/restaurant.ts`, `config-sync/builder.ts`, migrations | 01a 219, 220, 221 (cloud part) | M 5 h | R-1, PT-1 |
| PT-3 | Hub schema `points[].order_types` (optional, absent = `'all'`, `[]` refused) + 02b `buildSubmit` `engineLine` point = `routePoint(…, order_type)` (today `station?.point_id ?? null`, `build-submit.ts:421`), carry by the routed point; returns keep the served line's point | 03b v1.0.16 §3.1 Routed point, §4.5 PT-R1, PT-3; 01a PT-3, PT-6 (b) | — | `packages/events/src/config.ts`, `apps/hub/src/orders/build-submit.ts` | 01a 221 (hub part); 03b 129, 130 (PT-7) | M 4 h | PT-1 |
| PT-4 | `kds-config.routing_gaps` (`fallback` and `tie`, from memory, 0 extra statements) | 03b v1.0.16 §6.12, §3.8, PT-6 | — | `apps/hub/src/queries/kds-config.ts` | 03b 131 (PT-7) | S 2 h | PT-1 |

Gate. ≈ 19 h.

## Batch 8 — Counter alerts (R8): 01d screen devices + 03b counter (5 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| N-1 | 01d (a): `AlertStepTargetSchema` member `screen_devices`, resolver branch, startup refusals, `counter_card` (03b task 0h) | 01d v1.3.7 §3.5, §5.4, §11 v1.3.7 (a); 03b §4.5 D-7 | — | `packages/events/src/alerts.ts`, `apps/hub/src/alerts/{kinds,targets}.ts` | 01d 106, 107, 114 | M 5 h | B1-0 |
| N-2 | 01d (b): derived counter row in frames, catch-up, inbox; receipts; per-step re-read | 01d v1.3.7 §11 v1.3.7 (b) | — | `apps/hub/src/alerts/{ws-frames,catch-up,receipts}.ts`, `alerts/queries/alerts-inbox.ts` | 01d 108–113 | L 7 h | N-1 |
| K-1 | 03b task 42: counter audience for `ReadyToServe`, `ReadyToServeUndone`, `Handover`, `ReadyRetargeted` excluded (profile screens, per-order type map) | 03b v1.0.16 §6.17 | — | `apps/hub/src/ws/kds-audiences.ts` | 03b 97, 98, 106 | M 4 h | B1-0 |
| K-2 | 03b task 43: `ready_to_serve` `counter_screen`, complete-bag rule, `display.table_code` token, `counter_card`; `Handover` step 7 for takeaway / parking (Ready stays open) | 03b v1.0.16 §3.5, §6.21 | — | `apps/hub/src/kds/kinds.ts`, `apps/hub/src/kds/commands/{ready,handover}.ts` | 03b 21, 99–104, 108; 123 | L 7 h | N-2, K-1 |
| K-3 | 03b task 47 (hub part): `point_view.orders[]` `pickup_at_ms` + `no_station_lines` (+1 statement only with a pickup order) | 03b v1.0.16 §3.4, §6.15 (03a 03b-R4-1) | — | `apps/hub/src/ws/point-catch-up.ts` | 03b 110 | S 3 h | E-10 |

Gate. ≈ 26 h.

## Batch 9 — Display session kind and board profile (6 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| H-1 | 00 HPA (1): codes `DISPLAY_NOT_ENABLED`, `TRACKING_LINK_INVALID`, `RATE_LIMITED`, `DEVICE_TYPE_NOT_ALLOWED` widened; `SessionKind` `display`; `SessionStarted` / `SessionEnded` kind; ws `display_hint` | 00 HPA v1.13 §9, §4.2, §11 v1.13 (1); F v1.18 §6.2 | — | `packages/domain/src/errors.ts`, `packages/events/src/` | errors catalogue; 00 HPA 192 (type part) | S 2 h | B1-0 |
| A-1 | 05a step 10: `SCREEN_KEYS` + `board`, `screensOffered`, `BOARD_VOICES`, `isBoard`; `DeviceProfileSet` v2 + upcaster; `PickupBoardView` (audit mapper part is AU-1) | 05a v1.0.7 §3.6, §4.2, §11 step 10 | — | `packages/domain/src/screens.ts`, `packages/events/src/events/hub/` | 05a 35 (upcast part) | M 4 h | B1-0 |
| H-2 | 00 HPA (2): `staff_sessions` rebuild (FK-off recipe) with kind `display`, widened CHECKs, three indexes, active-device unique index | 00 HPA v1.13 §5.1 H-8 | **hub `00NN_display_sessions.sql`**, next free at merge (hub order #2) | `apps/hub/src/db/migrations/` | 00 HPA 174 | M 4 h | H-1, B1-2 (merge order) |
| A-2 | 05a step 11: `device_profiles.board_json` + fold | 05a v1.0.7 §5.4 | **hub `00NN_device_profiles_board.sql`**, next free at merge (hub order #3) | `apps/hub/src/db/migrations/`, `apps/hub/src/auth/device-profile.ts` | 05a 35 | S 2 h | A-1, H-2 |
| H-3 | 00 HPA (3): `sessionStream` / `sessionActor` and every §3.4a site; no `kind === 'station' ?` ternary left | 00 HPA v1.13 §3.4a, M96 | — | `apps/hub/src/auth/session-store.ts` and call sites | 00 HPA 191, 192, 193 | M 4 h | H-2 |
| A-3 | 05a step 12: approve / `SetDeviceProfile` board rules, self-guard (c), session ends, M-10 refusals (`DEVICE_ACCESS_DENIED { reason: 'display_device' }`) | 05a v1.0.7 §3.5, §6.3–§6.6, §6.8 | — | `apps/hub/src/auth/{pair-requests,staff-session,device-profile}.ts`, admin commands | 05a 30–34, 45, 48 (hub part) | M 5 h | A-2, H-3 |

Gate. ≈ 21 h.

## Batch 10 — Display auth, WS, pickup board (5 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| H-4 | 00 HPA (4): `POST /auth/display`; `allowDisplay` in guards and query registry; sweeper leaves display sessions alone | 00 HPA v1.13 §6.39, M96 | — | `apps/hub/src/auth/{guards,session-sweeper}.ts`, new route file, `apps/hub/src/queries/registry.ts` | 00 HPA 169–173, 190, 203 | M 5 h | A-3 |
| H-5 | 00 HPA (5): WS display mode (`hub` + `pickup_board` only), alert-mode refusal for boards (`4413`), `registerDisplayCatchUp`, `registerDisplayHint` | 00 HPA v1.13 §6.21; 01d C-F-37 | — | `apps/hub/src/ws/{server,catch-up}.ts` | 00 HPA 175, 176, 177, 194 | M 5 h | H-4 |
| N-3 | 01d (c): board guard in `always_on` / `point` / `screen_devices`, `SendTestAlert` check, conversion close `4413`, binding deletion, boot order | 01d v1.3.7 §11 v1.3.7 (c); 05a D-5 | — | `apps/hub/src/alerts/{targets,bindings,routes}.ts`, `alerts/commands/send-test-alert.ts`, `apps/hub/src/lib/boot.ts` | 01d 115–118, 120 | M 5 h | N-2, H-5 |
| A-4 | 05a step 13: `pickup-board` query (2 statements), `pickup_board` catch-up part, hints | 05a v1.0.7 §3.11, §6.12, §6.13 | — | `apps/hub/src/queries/pickup-board.ts`, `apps/hub/src/ws/` | 05a 36–40, 46, 50 | M 5 h | B2-4, H-5 |
| H-6 | 00 HPA (10), hub part: `.mp3` served from `client-dist`, pair-page routing to `/board/`, `/admin` device row "Pickup board" | 00 HPA v1.13 §8.2, §11 (10) | — | `apps/hub/src/lib/client-dist.ts`, `apps/hub/src/auth/pair-page.ts`, `apps/hub/src/admin/page.ts` | 00 HPA 188 (hub part), 190 | S 2 h | H-4 |

Gate. ≈ 22 h.

## Batch 11 — Customer status page (5 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| H-7 | 00 HPA (6): `status_link_key` (provision + boot), `statusLink` / `checkStatusLink` (HMAC, ULID only, lifetime OD-9) | 00 HPA v1.13 M98, M100, §6.40 | — | `apps/hub/src/status/link.ts` (new folder, OD-6), `apps/hub/src/setup/` | 00 HPA 180, 181, 182, 186, 195 | M 4 h | P-3 |
| H-8 | 00 HPA (7): in-memory rate limiter (`ip`, `invalid`, `order`, `valid` buckets) | 00 HPA v1.13 M99, §7.12 | — | `apps/hub/src/status/rate-limit.ts` | 00 HPA 185, 197 | M 4 h | H-7 |
| H-9 | 00 HPA (8): public listener on `public_status.port` (`GET /t/:link`, `/t/:link/status` only), guards, headers, `public_summary` logging, idle-socket cap, port-taken boot | 00 HPA v1.13 M97, §7.2, §7.13 | — | `apps/hub/src/status/listener.ts`, `apps/hub/src/server.ts`, `apps/hub/src/main.ts` | 00 HPA 178, 179, 187, 198, 201, 202, 204 | L 8 h | H-8 |
| H-10 | 00 HPA (9): §6.40 page (inline, CSP hashes) and §6.41 read over `takeawayProgress` `{ group_of }` | 00 HPA v1.13 §6.40, §6.41; 02b TK-6 (2) | — | `apps/hub/src/status/{page,read}.ts` | 00 HPA 183, 184 | M 5 h | H-9, B2-4 |
| H-11 | 00 HPA (12): runbook text (guest router check OD-5, `public_status.enabled` default false) — docs | 00 HPA v1.13 §7.13 step 2, OD-5 | — | `docs/` runbook | — | S 1 h | H-9 |

Gate. ≈ 22 h.

## Batch 12 — 04 audit bump and the unpaid hand-over request (OR-7) (5 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| AU-1 | **04 v1.0.9 audit bump, code** (BLOCKED-04, own task): `AUDIT_ACTIONS` += `cart_check_bill_printed`, `unpaid_handover_requested`, `unpaid_handover_answered`, `unpaid_handover_approved`; `DeviceProfileSet` mapper adds `board` to the `device_profile_set` detail | 04 v1.0.9 §3.6 (to be drafted: D-04); 05 v1.0.35 V-4; 02b TK-16; 05a AU-1 | — | `packages/domain/src/audit.ts` (:87 list, :499–513 mapper), `audit.test.ts` | 04 v1.0.9 tests (to be numbered), 05a 27 re-run | S 3 h | A-1, 04 v1.0.9 approved |
| U-1 | Event `UnpaidHandoverApproved` (v1) + `orders` fold on each `order_ids` + `open-orders` `unpaid_handover_approved` (statements unchanged) | 02b §3.7a Approve, §5, §6.16, §6.19, §11 23(k) | — (column already in B1-2's file) | `packages/events/src/events/order/`, `apps/hub/src/orders/{projection,queries/open-orders}.ts` | 02b 87, 89, 92 | M 4 h | B2-1 |
| U-2 | `RequestUnpaidHandover` (not queueable, 2 statements + `raise`), kind `hand_over_unpaid` (urgent, holders right, no `skip_requester`, `dedupe_key` by `bill_key`), audiences (Pass staff socket, `takeaway` screen phone, kiosk; not KDS) | 02b §6.4a, §6.12a, §6.19, §3.7a Ask; 01d v1.3.7 To 02b (122) | — | `apps/hub/src/orders/commands/request-unpaid-handover.ts`, `apps/hub/src/orders/hand-over-unpaid-kind.ts`, `apps/hub/src/orders/audiences.ts` | 02b 85, 86, 88, 93; 01d 122; 05a 52 (answer part) | M 6 h | U-1, R-1, R-2, B1-3 |
| U-3 | Request closes `obsolete`: `MarkServed` leaving no live unserved line (`handed_over`), `changeDrafts` `OrderCancelled` on `'close'` (+1 `listOpen` only then); 05 `CloseSplit` last close (`bill_closed`) and day-close set `CLOSED_AT_DAY_CLOSE` (`day_closed`) | 02b §3.7a No longer needed, §4.2 `lineChangeDrafts`, §4.5 TK-15; 05 v1.0.35 §4.5 TK-15 | — | `apps/hub/src/orders/{commands/mark-served,line-change}.ts`, `apps/hub/src/billing/lanes/day-close.ts:198`, billing `CloseSplit` | 02b 91; 05 #60j, #60k (see Inconsistencies 1) | M 5 h | U-2 |
| U-4 | Audit maps `registerRequestAction('hand_over_unpaid', …)`, `registerAuditAction('UnpaidHandoverApproved', …)` | 02b §4.5 TK-16 | — | `apps/hub/src/orders/` audit map | 02b 94 | S 2 h | U-2, AU-1 |

Gate. ≈ 20 h.

## Batch 13 — Check bill on the cart, token slip builders (5 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| CB-1 | 02b `priceCartDraft(config, draft, ctx)` export (steps 4–7 like `eta-preview`, stops before step 8; ≤ 1 statement) | 02b §4.2, §11 23(l); 05 TK-15 (1) | — | `apps/hub/src/orders/exports.ts` | 02b 95 | M 5 h | B1-0 |
| CB-2 | 05 `PrintCartCheckBill` + `buildCartCheckBillDoc` + event `CartCheckBillPrinted` + audit map (addition cart combined paper) | 05 v1.0.35 §6.3a, §11 11a, Q-9, V-4 (R2-M-4, R2-M-6) | — | `apps/hub/src/billing/commands/print-cart-check-bill.ts`, `billing/print/docs.ts`, `packages/events/src/events/hub/CartCheckBillPrinted.v1.ts`, `billing/audit-map.ts` | 05 #60f, #60g, #60i | M 6 h | CB-1, AU-1 |
| S-1 | 03c task 29: `customerReadyAt` (pure) moved out of 05; `ready-times.ts` imports it (05 #92–#97b unchanged) | 03c v1.0.16 §3.11, §4.2; 05 v1.0.35 §3.16 | — | `apps/hub/src/print/render/ready-at.ts`, `apps/hub/src/billing/print/ready-times.ts` | 05 #92–#97b re-run | S 2 h | B1-0 |
| S-2 | 03c task 30: `buildTakeawaySlipDoc`, `dayText`, golden bytes (PC437, no Urdu) | 03c v1.0.16 §3.11 | — | `apps/hub/src/print/render/takeaway-slip.ts`, `render/jobs.ts` | 03c 57, 58 | M 4 h | S-1 |
| S-3 | 03c task 31: `TAKEAWAY_SLIP_NOT_ALLOWED`, `printDocument` `meta.order_id`, `slipPrinterRow`, `print-queue` `kind_label`, `PrintTakeawaySlip` | 03c v1.0.16 §3.9, §6.7, §6.14, §9 | — (no 03c migration, §5) | `packages/domain/src/errors.ts`, `apps/hub/src/print/{api,bill-routes}.ts`, `print/commands/print-takeaway-slip.ts`, `apps/hub/src/queries/print-queue.ts` | 03c 59–64, 66 | M 5 h | S-2 |

Gate. ≈ 22 h.

## Batch 14 — Slip on Send, close-out (4 tasks)

| ID | Task | Spec § | Migration | Files | Tests | Size | Depends on |
|---|---|---|---|---|---|---|---|
| S-4 | 03c task 32: `queueTakeawaySlipOnSubmit` (never throws, SAVEPOINT) + `TAKEAWAY_SLIP_REPLAY_MS`; real `statusLink` and `takeaway_slip_on_send` | 03c v1.0.16 §3.11, Q-TK-2 | — | `apps/hub/src/print/slip-hook.ts`, `packages/domain/src/print.ts` | 03c 65; 00 HPA 196 | M 4 h | S-3, H-7, C-3 |
| S-5 | 02b `takeaway.print_slip` + step 10a + result `slip` | 02b §3.2 steps 2b, 10a, 11, §11 23(i); 03c Q-TK-1, Q-TK-3 | — | `apps/hub/src/orders/commands/submit-order.ts` | 02b 82 | M 3 h | S-4, P-1 |
| X-1 | Acceptance pass: 02b §12.2, 03b §12.2, 00 HPA, 05a, 03c, 05 endpoint checklists and statement counts; README rows closed; `test:perf` hand-off list for the owner (02b 83, 03a 194, §10.6) | 02b §11 22, §12; each spec §12 | — | `docs/plans/02b-tk-backend-plan.md` (status), README rows | all above | M 4 h | all of Batches 1–14 |
| X-2 | Manual-check docs: 03c task 33 (slip on 58 / 80 mm, QR from guest Wi-Fi), engine v6 after-hours install, board PC and router items G-1 – G-3 of "Before go-live" | 03c §11 33; 03a §11 note; `02b-tk-plan.md` Before go-live | — | `docs/plans/03c-manual-checks.md`, `docs/plans/03a-manual-checks.md` | manual (pilot) | S 1 h | S-5, E-10 |

Gate. ≈ 12 h.

## ~~Batch 15 — 05c~~ and ~~Behind STOP-0 / STOP-C~~ — REMOVED (owner 2026-11-24)

Paymob is out for now: the whole of 05c is parked ("§13 Later"); the pilot takes cards on the counter machine with a typed reference (works today). Tasks PC-1, PC-2 and PS-1 – PS-14 are removed, with 01d's `when_none` and the 05c alert kinds (their only consumer). No other task depended on them. **Totals below: 72 tasks, ≈ 292 h** (Batch 15's 1 task / 5 h removed).

## Inconsistencies found while planning (for the spec owners; no spec edited here)

**Resolved by the coordinator after planning (2026-11-24):** #1 05 TK-15 now says 0 statements and has tests #60j, #60k; #2 PT-R1 is in 02b v1.0.25 §3.2 step 6, PT-R2 in 03a v1.2.11 §3.3, and 01a §11 step 35 is the Pass-points build step; #3 03a §11 now points here. #4 (the 04 v1.0.9 draft) stays open: task D-04 writes it with the package approval.

1. **05 TK-15 statement count and tests.** 02b v1.0.25 §3.7a (c), (d) and §4.5 TK-15 say the 05 closes cost **0 statements** ("from the `alerts.listOpen` list it already reads"); 05 v1.0.35's TK-15 row (line 126) says **+1 statement** ("the open request by `dedupe_key`") on each path and cites tests **#60j, #60k**, which are not in 05 §10 (it ends at #60i). Task U-3 needs one answer and the two tests written.
2. **PT-R1 / PT-R2 not carried yet.** 03b v1.0.16 §4.5 PT-R1 (To 02b: `routePoint` in `buildSubmit`) and PT-R2 (To 03a) are not in 02b v1.0.25 or 03a v1.2.11 (no `routePoint` there); 03b's PT-7 tests 125–131 are cited in §12.2 row 24 but not yet in §10; 01a v2.11 §11 item 34 lists no PT step (only its DoD line). Batch 7 cites the 03b / 01a PT rows; the carries are owed before approval.
3. **03a §11 pointer.** 03a v1.2.11 §11 says its engine tasks are "planned in `docs/plans/02b-tk-plan.md` Part B"; they are planned here (Batches 3–4).
4. **04 bump does not exist.** 05 V-4, 02b TK-16 and 05a AU-1 all target "04 next version" / v1.0.9, but no 04 v1.0.9 draft is in `docs/specs/` (task D-04 before AU-1).
5. **01d (e) `when_none` placement.** 01d v1.3.7 §11 puts its build "in 03b's task 0h and 05c's plan"; its only user is 05c's `payment_unapplied`, so this plan builds (d), (e) behind STOP-0 (PS-2) to avoid dead code.

## Tier 1 acceptance (L-CLOSE-1, X-1; 2026-11-27; gaps closed in L-CLOSE-2, L-CLOSE-3 and L-CLOSE-4) — **Tier 1 backend ACCEPTED**

Trace of every Tier 1 task row's spec tests to repo tests, plus the §12.2 rows they touch (02b, 03b, 03c, 03a, 05, 01d, 01b). L-CLOSE-1 traced (`lane-02b-tk/close-1`, PR #533); L-CLOSE-2 (`lane-02b-tk/close-2`, PR #536) and L-CLOSE-3 (`lane-02b-tk/close-3`) closed the gaps below.

**Verdict (L-CLOSE-4, 2026-11-27): Tier 1 backend ACCEPTED.** Nothing blocking is left: L-CLOSE-4 (`lane-02b-tk/close-4`) built the R3-M-3 station metadata (owner approval 2026-11-27) and closed the 04 #61–#64 and 02b #28 clauses after the unpaid hand-over flow and CB-2 merged (PRs #534, #537). What stays open is outside the backend's Tier 1: the Tier 2 board items, client work (01b 119 R3-M-3, 05 #60h's offline greying), the owner's `pnpm test:perf` and pilot-hardware checks (below), and the D7 partial-Ready refresh deferred past the pilot.
(L-CLOSE-3 verdict, superseded: accepted except the R3-M-3 station metadata, which needed an owner decision on an additive `@pos/events` change.)

### Status per task

| Task(s) | State |
|---|---|
| B1-0 | covered; the A1 test now builds its scratch DB at 19, the predecessor of 0020 (L-CLOSE-3) |
| B1-1 … B1-6, B2-1 … B2-3, P-1, P-2, CB-1, S-1 … S-5 | covered |
| CB-2 (05 `PrintCartCheckBill`) | built by the other lane (PR #537): 05 #60f, #60g, #60i covered (`test/billing/print-cart-check-bill.int.test.ts`); #60h is the client's offline greying; 04 #61 added in L-CLOSE-4 |
| E-1 … E-10 (03a v1.2.11) | covered: 187 (new), 190 (a)–(f) (new), 185 full (new), 178 (a)–(e), 179 (b)–(d), 180 R3-M-4, 181, 182, 184 (a), (c), 186 (R3-M-2, R3-M-3, burger + fries), 191 (new); L-CLOSE-3: 183 (a) the max_early cap inside the freshness window, 183 (d) the #143 property with held lines, 193 "the re-plan runs once at the close" (after its releases) |
| C-1, C-3 / C-4 (Tier 1 keys), R-1, R-2, PT-1, PT-2, PT-4, N-1, N-2, K-3 | covered (01a 218 PATCH 12 600 001 and the snapshot via the PATCH added; 01b 119 R3-M-2 hub part added) |
| PT-3, D7 (03b 129, 130, 132) | 129 (new: Readies, dedupe keys, isolated audiences), 132 incl. the checkpoint case; 130 full (L-CLOSE-3: primary and alternate TA carry rows on a hidden non-FIFO line, the move to its alternate keeps TA, its return inherits TA, checkpoint + replay and cold replay = live) |
| K-1, K-2, D8 | 101 (new, real `ready_to_serve` steps), 102 / 103 return invalidation, closed alert never steps, extending Ready re-arms (new); L-CLOSE-3: 103 "Undo-rest" (an Undo after an extending press, §6.6: the rest stays a Ready, the counter alert closes and its clock stops), 108 reconnect with the real counter alert (staff `alerts` row with card, alert-mode `alerts_open` without, kiosk `orders`); Tier 2: 97 board socket |
| 03b 126, 128 (hub) | covered (new: routed points through SubmitOrder and ReturnToKitchen; parking fallback to Main); L-CLOSE-3: 126's point catch-ups (TA lists its routed line, Main its own), Ready at TA (readyAtOf, the 2× step to TA's Pass staff, not Main's). L-CLOSE-4: R3-M-3 station metadata built — see below |
| AU-1 | domain lists covered; L-CLOSE-4 through the real commands: 04 #61 (plain, addition and no-route carts; detail allowlist; audit-log filter; retransmit adds no row), 04 #62–#64 (takeaway and parking requests; approve and reject; one approved row after its answer; the three filters; rebuild = live after alert retention) |
| U-1 … U-4 (unpaid hand-over, PR #534) | 02b #85–#94 covered by the other lane's tests; 02b #28's fixture day now holds approvals and an approval clear (L-CLOSE-4) |
| L-CLOSE-1 extras | 01b 118 hub part, 03b 132 checkpoint case, counter-alert close after the engine drops an order: done |

### Engine fix found by the new tests (L-CLOSE-2)

- **Batch sync parts (03a BQ-6, F §4.7 step 3):** a sync group with more one-unit parts than one load chained one-unit loads backward (D36) instead of filling the earlier load it had formed: 16 sync parts on an 8-unit fryer got a target of +27 min (8 + eight singles) instead of +6 (two loads). Fixed in `packages/engine/src/plan.ts` (`trySyncAt`: a part may join a load formed earlier in the same trial). Pickup and walk-in orders alike. It changes `applyEvent` for such orders; v6 is not installed anywhere yet, so it stays inside `ENGINE_STATE_VERSION` 6 (owner confirmed 2026-11-27).

### Clause gaps closed in L-CLOSE-2 (02b / 03c / 01a / 01b)

02b #60, #62, #64, #76, #80, #82, #95; 03c #57 (and `print.slip.name_unprintable` is now logged), #58, #59, #60, #61, #62, #65; 01a #218; 01b #119 (R3-M-2 hub part). Closed later: 02b #28 (L-CLOSE-4). Still open: #67 D3 figures and Ready-undo on open-orders rows (covered in key-balances / bag-ready tests), 00 HPA 196 and the `DEVICE_TYPE_NOT_ALLOWED` widening (Tier 2), 01b 119 R3-M-3 (client), 01d 106 "not a board" (Tier 2).

### Closed in L-CLOSE-4: 03b R3-M-3 station metadata on a routed point

Found open in L-CLOSE-3 (`WsPointLines` had no `stations`; `pointViewBody` listed only the point's default stations), approved by the owner 2026-11-27 and built: optional `stations` on `WsPointLines` (`PointStationSchema`, the `point_view` station shape; additive in `packages/events/src/ws.ts`); `point_view.stations` = the point's active default stations ∪ the stations of its listed lines (routed ones too), from the same settings read; live `point_lines` carries, before `lines`, each station a socket newly references, from one shared settings read per commit (0 without one), and sends a held line again when the engine moves it to another station; held stations no longer referenced are dropped. `dark` stays the takeover at this point (takeover frames keep the effective default). Tests: 03b #126 (TA's catch-up lists Karahi; the live case in `test/pass/archive-moves.int.test.ts`: an empty connected TA Pass gets Karahi before its first line, the alternate move brings the alternate station and the line again, one settings read), `ws.test.ts` contract case.

### Flaky tests

- Short-PIN "not to contain" checks now parse the JSON and look for the secret by structure (`test/helpers/no-secret.ts`): `pin.int.test.ts` (both), `answer-pin.int.test.ts` (three), `answer-request.int.test.ts`. The long random secrets (tokens, argon2 hashes) keep their raw checks.

### Decided, not gaps

- 02b §6.16 / test 67 "2 statements with no row": the hub makes 1; accepted by the owner 2026-11-26.
- 02b test 61: the engine stores a passed queued pickup as null (owner ruling PQ-1, 2026-11-27); asserted.
- D7 refresh: `point_view_refresh` builds one view per receiving point; stays per point.
- **D7 partial Ready alert refresh — after the pilot (owner 2026-11-27):** a Ready at an archived point that keeps some lines should get its stale alert details replaced (03b §5, R3-M-1); it needs a new link event (`ReadyRetargeted` requires a non-empty `table_id`). Rare; deferred.

### Owner hand-off (`pnpm test:perf`, real disk, never in CI or the cloud)

- 02b test 83: `apps/hub/test/orders/open-orders.perf.test.ts` (written and typechecked in L-CLOSE-2, not run).
- 03a test 194 (pickup day): `packages/engine/test/sim/pickup.perf.test.ts`.
- 03a §10.6 gates, DoD 2 / §7.1 on the pilot mini PC (task 28).
- Manual: `docs/plans/03a-manual-checks.md` §1 (engine v6 install after hours), `docs/plans/03c-manual-checks.md` check 11 (token slip 58 / 80 mm; QR step Tier 2).

## Summary

| Batch | Theme | Tasks | Sizes (S / M / L) | Estimate |
|---|---|---|---|---|
| 1 | Prerequisites (errors, migration, `keyBalances`, `readyAtOf`, business day) | 7 | 5 / 2 / 0 | 18 h |
| 2 | G-1 open orders, catch-up, estimate skip, `takeawayProgress` | 4 | 2 / 1 / 1 | 16 h |
| 3 | 03a hold, part 1 | 5 | 0 / 2 / 3 | 35 h |
| 4 | 03a hold, part 2 | 5 | 0 / 5 / 0 | 21 h |
| 5 | Pickup on Send, ULID, phone redaction, lookups | 6 | 4 / 2 / 0 | 18 h |
| 6 | Cloud config 01a / 01c / 01b settings | 4 | 0 / 3 / 1 | 20 h |
| 7 | Pass role, `hand-over-unpaid`, Pass points by order type | 6 | 3 / 3 / 0 | 19 h |
| 8 | Counter alerts (01d + 03b R8) | 5 | 1 / 2 / 2 | 26 h |
| 9 | Display session kind, board profile | 6 | 2 / 4 / 0 | 21 h |
| 10 | Display auth, WS, pickup board | 5 | 1 / 4 / 0 | 22 h |
| 11 | Customer status page | 5 | 1 / 3 / 1 | 22 h |
| 12 | 04 audit bump, unpaid hand-over request | 5 | 2 / 3 / 0 | 20 h |
| 13 | Cart check bill, slip builders | 5 | 1 / 4 / 0 | 22 h |
| 14 | Slip on Send, acceptance, manual docs | 4 | 1 / 3 / 0 | 12 h |
| 15 | 05c pure rules (before STOP-0) | 1 | 0 / 1 / 0 | 5 h |
| **Total (unblocked after approval)** | | **73** | 23 / 42 / 8 | **≈ 297 h (≈ 37 dev-days)** |
| Behind STOP-0 / STOP-C | 05c core, relay, card adapter | 15 | 3 / 8 / 4 | ≈ 79 h |

**Critical path:** owner approval of the package → B1-0 → B1-6 → **E-1 → E-2 → E-4 → E-5 → E-6 → E-7 → E-9 → E-10** (≈ 48 h of engine work, then the after-hours v6 install) → P-1 → S-5 (with S-4 ready) → X-1 (≈ 70 h end to end; E-3 and E-8 run beside E-4 / E-7). Next-longest chains: the board lane B1-2 → H-2 → H-3 → A-3 → H-4 → H-5 → A-4 (≈ 35 h) and the G-1 lane B1-2 → B2-1 → B2-4 → H-10 (≈ 22 h, H-10 also after H-7 → H-8 → H-9). Side gates: 04 v1.0.9 approval (AU-1 → U-4, CB-2); STOP-0 / STOP-C for everything 05c beyond PC-1.
