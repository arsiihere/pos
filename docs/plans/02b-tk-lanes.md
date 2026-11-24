# 02b-TK backend — Codex lanes (parallel tasks)

Split of `docs/plans/02b-tk-backend-plan.md` (task ids below are that plan's) into **independent Codex cloud tasks**. Written 2026-11-24 after the owner's answers (05c parked; short list accepted). **No code is written by this file.**

## Rules for every lane (read first)

- Repo rules: `AGENTS.md` (= `CLAUDE.md`). TDD, one plan task per commit, commit message cites the spec §, gate: `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`. Never `pnpm test:perf`, printer or power-loss checks in the cloud.
- Build base: branch `module-02b-tk` (created by lane **L0**, task B1-0) = `origin/main` + `claude/02b-tk-specs`. Each lane works on its own branch `module-02b-tk-<lane>` and opens a PR into `module-02b-tk`; CI `gate.yml` must be green.
- **Owned paths only.** A lane may edit only the paths in its "May touch" column. Anything else it needs (an error code, an event schema, a shared type, a snapshot key) is in **L0** and must be merged first. If a lane finds it needs a file it does not own: stop and report — do not edit it.
- **Never edit `docs/specs/**`** (spec changes go back to the spec lane). Lanes may append to their own `docs/plans/02b-tk-<lane>-status.md` only.
- **Migrations**: no reserved numbers — the next free number at merge time (see "Migration numbers"; the runners refuse gaps).
- **05c is parked** (owner 2026-11-24): no 05c task, no `when_none`, no `payment_*` kinds, no `manage-payment-providers`. Cards stay the manual counter-machine mode.
- **Client work is not here.** The client lane (`claude/gracious-hawking-9670fy`) owns `apps/client/**`; it must also remove R2's "Hand over anyway" override (02b v1.0.25 §3.7a: until the manager request ships a Due order cannot be handed over).

## Migration numbers (corrected 2026-11-24)

Both runners (`apps/cloud/src/db/migrate.ts`, `apps/hub/src/db/migrate.ts`) **refuse gaps**: versions must be 1, 2, 3 … with no hole ("migration versions must be sequential"). So **no number is reserved ahead**. A lane writes its file with a working name and the **next free number on `module-02b-tk` at the moment its PR is merged**; if another lane merged a migration first, renumber yours before merge (never a merged file). Current state of `module-02b-tk`: cloud last = `0020_cashier_mark_served.sql` (Part A1, renumbered from `0019` after `main`'s `0019_recipes.sql`), hub last = `0027_device_profiles.sql`.

| Working name | Folder | Lane | Spec |
|---|---|---|---|
| `NNNN_orders_takeaway.sql` | hub | L-ORDERS | 02b v1.0.25 §5 (incl. `unpaid_handover_approved_at`) |
| `NNNN_display_sessions.sql` (Tier 2) | hub | L-ACCESS | 00 HPA v1.13 §5.1 H-8 |
| `NNNN_device_profiles_board.sql` (Tier 2) | hub | L-ACCESS | 05a v1.0.7 §5.4 |
| `NNNN_takeaway_menu.sql` | cloud | L-CLOUD-1 | 01a v2.11 §5, 01c v1.5 |
| `NNNN_takeaway_role_grants.sql` | cloud | L-ROLES | 01b v1.12 §5.1c |
| `NNNN_point_order_types.sql` | cloud | L-PT | 01a v2.11 PT-1 – PT-6 |

08's drafts follow the same rule when they merge.

## Two tiers (owner 2026-11-24)

Nothing is dropped; only the order changes. **Tier 1** (the takeaway counter works on day 1) is built and **merged into `module-02b-tk` first**; **Tier 2** starts after Tier 1 is merged.

- **Tier 1:** open-orders rework (a paid order stays until handed over, bill state, `ready_at`); `pickup_at_ms` + the 03a whole-order-hold engine chain; ready alert to the kiosks + not-collected (R8); Pass points by order type + Pass role + "Handed to customer"; unpaid hand-over request (01d / 02b / 01b); check bill on the cart and on a Due token (`PrintCartCheckBill`) + the takeaway token slip (03c, **printed without the QR** until Tier 2: `statusLink` is injected and returns `null`, which 03c already allows); the contracts and run-3 reviews these need.
- **Tier 2:** pickup board + voice (display session, board profile, `pickup-board`, `takeawayProgress`); customer status page (link, limiter, public listener; the slip then prints its QR); `customer-orders` (repeat by phone, with the `phone` log redaction); companions and short codes; `top-items` + `rush_open_orders`; the board parts of 01d and 04.

**Spec-lane prerequisite for Tier 1 (Claude, not Codex):** draft **04 v1.0.9** (audit actions `cart_check_bill_printed`, `unpaid_handover_requested` / `_answered` / `_approved`; the `board` detail of `device_profile_set` is written there too but built in Tier 2) and get it approved with the package; L-AUDIT-1 waits for it.

## Readiness

- **Ready now** (run 2 passed with wording fixes): 05a v1.0.7, 03c v1.0.16, 01c v1.5, Foundation v1.18, 01a v2.11 **except** its new PT rows.
- **Wait for run 3** (`docs/reviews/run3-prompts/`, all eight can run in parallel today): 02b, 01d, 03b (incl. Pass by order type), 03a, 05, 01b (targeted), 01a PT rows — all needed by **Tier 1**; 00 HPA (targeted, public listener) — needed by **Tier 2** only.
- The owner approves the package before anything merges to `main`; lanes merge into `module-02b-tk`.

## Tier 1 — lanes in start order

Lanes on the same step run **in parallel** (no shared files).

| Step | Lane | Start | Tasks (backend plan ids) | May touch (only) | Spec §§ | Migration | Depends on | Tests | Done when |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **L0a** contracts (ready specs) | **NOW**, alone | B1-1 (B1-0 done: branch + rename to cloud `0020`), B1-6, all new error codes (H-1 codes, S-3 code, C-2 code) | `packages/domain/src/{errors,ids}.ts` + tests, new `packages/domain/src/business-day.ts` (+ test), `packages/events/src/config.ts` | F v1.18 §6.2 (codes `PICKUP_TIME_INVALID`, `DISPLAY_NOT_ENABLED`, `TRACKING_LINK_INVALID`, `RATE_LIMITED`, `SHORT_CODE_IN_USE`, `TAKEAWAY_SLIP_NOT_ALLOWED`); 01a v2.11 `businessDayLatestMs`, snapshot keys `business_day_end_local_ms`, `engine_settings.rush_open_orders`, `takeaway_slip_on_send` | — | — | F §6.2 catalogue test; 01a test 218 | gate green |
| 2 | **L-CLOUD-1** settings + menu schema | **NOW** (after L0a) | C-1 (whole migration), C-3 (snapshot keys `business_day_end_local_ms`, `takeaway_slip_on_send` only), C-4 (`business_day_end_local_ms`, `takeaway_slip_on_send` on the settings wire only) | `apps/cloud/src/db/migrations/NNNN_takeaway_menu.sql`, `apps/cloud/src/modules/config-sync/**`, `apps/cloud/src/modules/staff-roles/{service,repository,versions}.ts`, `packages/events/src/admin/staff.ts`, their `apps/cloud/test/**` | 01a v2.11 §5, §6.10, snapshot header; 01b v1.12 B-1 (two fields) | cloud next free | L0a | 01a 214, 216–218; 01b 116 (slip part), 117 | gate green; the hub snapshot carries both settings |
| 2 | **L-PRINT** token slip | **NOW** (after L0a) | S-1, S-2, S-3, S-4 | `apps/hub/src/print/**`, `apps/hub/src/billing/print/ready-times.ts` (import change only), `apps/hub/test/print/**` | 03c v1.0.16 §3.9, §3.11, §4.2, §11 tasks 29–32 | — | L0a | 03c 57–63; 05 #92–#97b unchanged | gate green; `queueTakeawaySlipOnSubmit` exists; `statusLink` injected (returns `null`: no QR in Tier 1) |
| 3 | **L0b** contracts (run-3 specs) | **run 3** (02b, 03b, 01b, 01a PT) | PT-1, R-1 (domain part), R-2, U-1 (event schema), CB-2 (event schema) | `packages/domain/src/{permissions,kds,screens}.ts` (+ tests; in `screens.ts` only `hand-over-unpaid` in `LISTED_ONLY_PERMISSIONS`), `packages/events/src/events/order/UnpaidHandoverApproved.v1.ts`, `packages/events/src/events/hub/CartCheckBillPrinted.v1.ts`, the events index, `packages/events/src/config.ts` (`points[].order_types`) | 01b v1.12 B-4, B-5; 05a L-1; 03b PT-1 `routePoint`; 02b §6.19; 05 §6.3a | — | L0a merged | 01b 119 (domain), 03b 125–127, 05a 52 | gate green |
| 4 | **L-ENG** 03a whole-order hold | **run 3** (03a) | E-1 … E-10 | `packages/engine/**`, `apps/hub/test/engine/**`, `docs/plans/03a-manual-checks.md` | 03a v1.2.11 §3.5.8 PK-1 – PK-12, §3.8, §12.3 Q-PK-9 answer, §11 | — | L0a | 03a 178–193 (194 = `test:perf`, owner machine only), 31, 56, 186, 191 | gate green; state v6 + fixtures; after-hours install note |
| 4 | **L-BILL** `keyBalances` + check bill | **run 3** (05) | B1-3, CB-2, U-3 (05 parts) | `apps/hub/src/billing/**` (not `print/ready-times.ts`), `apps/hub/test/billing/**` | 05 v1.0.35 §6.2a, §6.3a, §4.5 TK-15 | — | L0b, L-PRINT, L-AUDIT-1 (for CB-2's audit map) | 05 #60f – #60k, #83 | gate green |
| 4 | **L-KDS** 03b hub | **run 3** (03b) | B1-4, K-1, K-2, K-3, PT-4 | `apps/hub/src/kds/**` (not `contracts.ts`' `LINE_READY_AT_SQL`, Tier 2), `apps/hub/src/ws/{kds-audiences,point-catch-up}.ts`, `apps/hub/src/queries/kds-config.ts`, `apps/hub/test/{kds,pass}/**` | 03b v1.0.16 §3.4, §3.5, §4.2 `readyAtOf`, §6.12, §6.15, §6.17, §6.21, PT-1 – PT-8 | — | L0b; L-ALERTS N-2 before K-2 | 03b 97–108, 110–131 (hub parts) | gate green |
| 4 | **L-ALERTS-1** 01d counter alert | **run 3** (01d) | N-1, N-2 | `apps/hub/src/alerts/**`, `packages/events/src/alerts.ts`, `apps/hub/test/alerts/**` | 01d v1.3.7 §3.4, §3.5 (no `when_none`), §5.4, §6, §11 (a), (b) | — | L0a | 01d 106–114, 122 | gate green |
| 4 | **L-ROLES** Pass role + grant | **run 3** (01b) | R-1 (cloud part) | `apps/cloud/src/modules/staff-roles/default-roles.ts`, its tests, `NNNN_takeaway_role_grants.sql` | 01b v1.12 §5.1c, §6.15 | cloud next free | L0b, L-CLOUD-1 merged | 01b 20, 118, 119 | gate green |
| 4 | **L-PT** points by order type (cloud) | **run 3** (01a PT, 03b PT) | PT-2 | `apps/cloud/src/modules/restaurant/points*` and the restaurant route schema for points, `NNNN_point_order_types.sql`, its tests | 01a v2.11 PT-1 – PT-6 | cloud next free | L0b, L-CLOUD-1 merged | 01a 219–222 | gate green |
| 3 | **L-AUDIT-1** 04 actions | **04 v1.0.9 approved** | AU-1 (Tier 1 actions only) | `packages/domain/src/audit.ts`, `audit.test.ts` | 04 v1.0.9 | — | L0a | 04's tests | gate green |
| 6 | **L-ORDERS-1** 02b hub | **run 3** (02b) | B1-2 (whole migration), B2-1, B2-2, B2-3 (**G-1 first**), P-1, P-2, PT-3 (submit part), U-1 (fold + row), U-2, U-3 (02b parts), U-4, CB-1, S-5 | `apps/hub/src/orders/**`, `apps/hub/test/orders/**`, `NNNN_orders_takeaway.sql` | 02b v1.0.25 §3.2 (2b, 6 PT-R1, 10a), §3.3, §3.7, §3.7a, §4.2 `priceCartDraft`, §5, §6.4a, §6.12a, §6.14, §6.16, §6.18 | hub `NNNN_orders_takeaway.sql` | L0b, L-BILL (B1-3), L-KDS (B1-4), L-ENG (for P-1), L-PRINT (for S-5), L-AUDIT-1 (for U-4) | 02b 59–68, 71–80, 82, 85–93 | gate green; order B1-2 → B2-1 → B2-2 → B2-3 → P-1 → … |
| 7 | **L-CLOSE-1** Tier 1 acceptance | all Tier 1 lanes merged | X-1 (Tier 1 parts), X-2 (slip + engine checks) | `docs/plans/02b-tk-backend-plan.md` (status), `docs/plans/{03c,03a}-manual-checks.md` | the §12.2 checklists of 02b, 03b, 03a, 05, 03c, 01d, 01b for Tier 1 endpoints | — | all Tier 1 | — | checklists ticked; **Tier 1 merged**; owner told |

Parallel groups: step 2 (L-CLOUD-1 ∥ L-PRINT); step 3 (L0b ∥ L-AUDIT-1, disjoint files); step 4 (L-ENG ∥ L-BILL ∥ L-KDS ∥ L-ALERTS-1 ∥ L-ROLES ∥ L-PT). L-ORDERS-1 can begin B1-2 → B2-3 as soon as L0b, B1-3 and B1-4 land, while L-ENG still runs; P-1 waits for L-ENG.

## Tier 2 — lanes in start order (after Tier 1 is merged)

| Step | Lane | Start | Tasks | May touch (only) | Spec §§ | Migration | Depends on | Tests | Done when |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **L0c** board contracts | after Tier 1 | A-1 (domain / events part), H-1 (`SessionKind` `display`, `SessionStarted` / `SessionEnded` v2, ws `display_hint`) | `packages/domain/src/screens.ts` (board keys), `packages/events/src/events/hub/{SessionStarted,SessionEnded,DeviceProfileSet}.v2.ts` + upcasters, the events index, `packages/events/src/ws.ts` | 05a v1.0.7 §3.6, §4.2; F v1.18 D46, F-2; 00 HPA M96 | — | Tier 1 | 05a 10, 30, 35 (schema parts) | gate green |
| 2 | **L-ACCESS** display session + board profile | after L0c | H-2, A-2, H-3, A-3, H-4, H-5, H-6 | `apps/hub/src/auth/**`, `apps/hub/src/ws/{server,catch-up}.ts`, `apps/hub/src/queries/registry.ts`, `apps/hub/src/lib/client-dist.ts`, `apps/hub/src/admin/page.ts`, the device-profile / approve commands, `apps/hub/test/{auth,ws,admin}/**`, `NNNN_display_sessions.sql`, `NNNN_device_profiles_board.sql` | 00 HPA v1.13 M96, §3.4a, §5.1, §6.21, §6.39, §8.2; 05a v1.0.7 §3.5, §3.6, §5.4, §6.3, §6.4 | hub `0031`, `0032` | L0c | 00 HPA M96 / §6.39 / §6.21 tests (incl. 203); 05a 30–35, 45, 50 | gate green |
| 2 | **L-STATUS-A** link + limiter + redaction | after Tier 1 (00 HPA run 3 for M98 / M99 only if it changes them) | H-7, H-8, P-4 | `apps/hub/src/status/{link,rate-limit}.ts` (new folder, OD-6), `apps/hub/src/setup/**`, `apps/hub/src/server.ts` (`redactQueryToken` only), `apps/hub/test/status/**` | 00 HPA v1.13 M98, M99, M100, §7.12; 02b TK-6 (1) | — | Tier 1 | 00 HPA M98, M99, 187, 200 | gate green; `statusLink` real (the slip prints its QR) |
| 2 | **L-CLOUD-2** companions, short codes, rush | after Tier 1 | C-2, C-3 (companions, short codes, `rush_open_orders`), C-4 (`rush_open_orders`) | `apps/cloud/src/modules/restaurant/**`, `apps/cloud/src/modules/config-sync/**`, `apps/cloud/src/modules/staff-roles/{service,repository,versions}.ts`, `packages/events/src/admin/{restaurant,staff}.ts`, their tests | 01a v2.11 §3.3, §6.14, §6.15; 01c v1.5 §6.4, §6.5; 01b v1.12 B-1 (rush) | — (columns already in L-CLOUD-1's `NNNN_takeaway_menu.sql`) | Tier 1 | 01a 207–213, 215; 01b 116 (rush part); 01c §10 | gate green |
| 2 | **L-ORDERS-2** 02b reads | after Tier 1 | B1-5 (`LINE_READY_AT_SQL`, in `apps/hub/src/kds/contracts.ts`), B2-4 `takeawayProgress`, P-3 (`order_id` ULID), P-5 `customer-orders`, P-6 `top-items` | `apps/hub/src/orders/**`, `apps/hub/src/kds/contracts.ts`, `apps/hub/test/orders/**`; `apps/hub/src/queries/registry.ts` **after L-ACCESS is merged** | 02b v1.0.25 §3.2 step 3, §4.2, §6.18b, §6.18c; 03b §4.2 | — | Tier 1; L-STATUS-A (P-4 before P-5) | 02b 69, 70, 81, 84; 03b 109 | gate green |
| 3 | **L-ALERTS-2** board guard | after L-ACCESS | N-3 | `apps/hub/src/alerts/**`, `apps/hub/src/lib/boot.ts` (boot order line) | 01d v1.3.7 §11 (c), D-5 | — | L-ACCESS | 01d 115–118, 120 | gate green |
| 3 | **L-STATUS-B** public listener, status page, pickup board | **00 HPA run 3** clean + L-ACCESS + L-STATUS-A + L-ORDERS-2 | H-9, H-10, H-11, A-4 | `apps/hub/src/status/{listener,page,read}.ts`, `apps/hub/src/server.ts`, `apps/hub/src/main.ts`, `apps/hub/src/queries/pickup-board.ts`, new `apps/hub/src/ws/display-*.ts`, runbook doc | 00 HPA v1.13 M97, §6.40, §6.41, §7.12, §7.13; 05a v1.0.7 §3.11, §6.12, §6.13 | — | as Start | 00 HPA 183, 187, 191–204; 05a 36–41, 46 | gate green |
| 3 | **L-AUDIT-2** board audit detail | after L0c | AU-1 (the `board` detail) | `packages/domain/src/audit.ts`, `audit.test.ts` | 04 v1.0.9 | — | L0c | 04's tests | gate green |
| 4 | **L-CLOSE-2** Tier 2 acceptance | all Tier 2 lanes merged | X-1 (rest), X-2 (board PC, router, voice checks) | as L-CLOSE-1 | 00 HPA, 05a, 02b §12.2 | — | all | — | checklists ticked; `test:perf` hand-off list |

Parallel groups: step 2 (L-ACCESS ∥ L-STATUS-A ∥ L-CLOUD-2 ∥ L-ORDERS-2, but L-ORDERS-2's registry lines wait for L-ACCESS); step 3 (L-ALERTS-2 ∥ L-STATUS-B ∥ L-AUDIT-2). Only **L-STATUS-B** waits for a run 3 (00 HPA targeted).

## Conflict notes

- `packages/domain/src/errors.ts`, `packages/events/src/config.ts`, the events index, `permissions.ts`, `screens.ts`, `kds.ts` → only L0a / L0b / L0c, each alone.
- `apps/hub/src/orders/**` → L-ORDERS-1 (Tier 1), then L-ORDERS-2 (Tier 2).
- `apps/hub/src/server.ts` → L-STATUS-A, then L-STATUS-B (different steps).
- `apps/hub/src/queries/registry.ts` → L-ACCESS; L-ORDERS-2 adds its lines after L-ACCESS is merged. (Tier 1 lanes add no new query; if one must, it stops and reports.)
- `apps/cloud/src/modules/config-sync/**`, `staff-roles/{service,repository,versions}.ts` → L-CLOUD-1 (Tier 1), then L-CLOUD-2 (Tier 2); `modules/restaurant/**` → L-PT (Tier 1, points only), then L-CLOUD-2.
- `apps/hub/src/alerts/**` → L-ALERTS-1 (Tier 1), then L-ALERTS-2 (Tier 2).
- `packages/domain/src/audit.ts` → L-AUDIT-1, then L-AUDIT-2.

The Codex instruction for Tier 1 is `docs/plans/02b-tk-codex-tier1.md`.
