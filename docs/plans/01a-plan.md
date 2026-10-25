# 01a Restaurant Setup — Implementation Plan (spec v1.0)

**Spec v1.0 APPROVED. Build in task order.**

> **For the implementer (Cursor, no plugins):** follow `.cursor/rules/pos.mdc`. Do **one task per request**, in order. Each task: write the listed tests first, run them and see them fail for the stated reason, implement, run the task command and then `pnpm test`, check **Done when**, commit. Steps use checkboxes (`- [ ]`); do **not** tick them in this file (it is read-only for you). Tasks marked **Claude only** edit `docs/`, `.cursor/` or the foundation: **skip them and tell the user**.

**Goal:** Build module 01a: cloud restaurant data (floors, tables, stations, programs, tax classes, categories, items with units, low-stock threshold, `carries_over` and time windows, per-branch routes) with idempotent creates and an audit trail; config delivery to the hub through a conditional, gzipped poll; the hub's config apply as an event, the stock and business-day slice of `@pos/engine`, the stock, availability and business-day commands; the owner app and the hub `/admin/stock` page as entries of one Vite app, `apps/client`, with its build and hub release script; the `restore-bump` and `set-branch-settings` cloud CLIs.

**Architecture:** The cloud owns the menu; every owner write runs one PostgreSQL transaction (idempotency key → lock → checks on the merged row → write → `config_audit` → `bumpConfigVersion`, which reads the owner's allowed branches from `owner_users` for tenant-wide writes). The hub polls `GET /v1/sync/config` every 60 s (gzip, 30 s timeout), verifies the snapshot hash over the exact wire JSON, and applies it in one `writer.run` (`config_snapshots` insert + `BranchConfigApplied` + optional staff directory), swapping the in-memory config after COMMIT; a failed apply is recorded as a visible problem and each part is retried alone. Stock lives only in `EngineState.stock`, folded from `StockSet` / `StockAdded`; the business day is `EngineState.business_day`, opened and closed by `BusinessDayOpened` / `BusinessDayClosed`, with the item units frozen at the open. A count is valid only within the open day unless the item carries over.

**Tech stack:** existing 00 stack (Fastify 5.12.7, Zod 4.6.7, better-sqlite3 13.0.3, pg 8.23.1, Vitest 4.1.12, ESLint 10.13.0) + `apps/client` only: React 19.3.1, Vite 8.3.5, jsdom 30.1.3.

**Spec:** `docs/specs/01_Restaurant_Setup_Spec_v1.0.md` (cited "§x" or "S12"); foundation `docs/specs/00_Foundation_Spec_v1.7.md` ("F §x"); 00 spec `docs/specs/00_Hub_Platform_Access_Spec_v1.2.1.md` ("00 Mxx"). Read the cited spec section before each task; the plan does not repeat the spec's tables. Reviews applied: `docs/reviews/01a_plan_review.md` ("Rn"), `docs/reviews/01a_spec_review_1.md` and `docs/reviews/01a_spec_review_2.md` (through spec v1.0, cited by the spec decision each produced).

**Starting point:** module 00 is built. Reuse, do not recreate: hub `writer.run`, `createStateHolder`, `createProjectionRegistry`, `registerBootStep`, `defineCommand` / `commandRegistry(app)`, `defineQuery` / `queryRegistry(app)`, `registerStationValidator` / `stationExists`, `registerEventAudience`, `registerCatchUp`, `applyStaffDirectory` (signature unchanged), `swapDirectory(app, …)`, `lib/hash.ts`, `lib/ui-assets.ts` (pattern for §7.1), `setup/cloud-client.ts` (pattern for the poll client), test helpers `createTestHub`, `seedDirectory`, `pairDevice`, `openSession`, `statementCounter`, `connectWs`, `aDirectory`, `captureLogs`; cloud `TenantScopedRepository`, `TenantLevelRepository`, `registerTenantScope` (`TENANT_SCOPE_ALLOWLIST`), `registerErrorHandler`, `loadDirectory` (`modules/hub-registration/repository.ts`), `SystemContext`, `seedTenant`, `issueRegistrationCode`, `createTestCloud`, `truncateAll`; the manual setup in `docs/manual-test-00.md`.

## Progress

| Task | Commit |
|---|---|
| 1 Spec 00 v1.2.1 editorial patch | `013afb4` |
| 2 Foundation §6.2 codes | `ee81c61` |
| 3 `.cursor/rules/pos.mdc` → this plan and spec v1.0 | `757e1de` |
| 4 Domain: error codes, `manage-stock` | `87431d3` |
| 5 Domain: units | `5a59704` |
| 6 Domain: availability windows | `4d674db` |
| 7 Domain: `lineTotalMinor`, day-setting defaults | `426eec5` |
| 8 `@pos/domain/hash` | `d8e2f9e` |
| 9 Events: snapshot schema `config.ts` | `38f8ce8` |
| 10 Events: seven events, fixtures, builders | `392b1a4` |
| 11 `@pos/engine`: stock slice | `d0d8172` |
| 12 `@pos/engine`: business day, `dayUnits`, `stockLevel` | `7d3cb9d` |
| 13 Lint: browser-safe packages | `4856528` |
| 14 Cloud migration `0002_restaurant_setup.sql` | `0a633c4` |
| 15 Cloud `withIdempotency` | `161df82` |
| 16 Cloud `bumpConfigVersion`, `writeConfigAudit` | `e372f85` |
| 17 Cloud test infrastructure | `803a621` |
| 18 Cloud floors GET/POST | `2e15f6e` |
| 19 Cloud floor PATCH | `35c9760` |
| 20 Cloud snapshot builder | `f5bf426` |
| 21 Cloud `GET /v1/sync/config` | `d5b2dd3` |
| 22 Cloud sync gzip | `3279dba` |
| 23 Cloud tables | `2bccd2a` |
| 24 Cloud stations | `6c6b47e` |
| 25 Cloud batch programs | `671d559` |
| 26 Cloud tax classes, categories | `53eb634` |
| 27 Cloud owner-row read helper | `a457dd0` |
| 28 Cloud menu-item POST | `9ded9e1` |
| 29 Cloud menu read — search, pages, `can_edit_tenant` | `e782f60` |
| 30 Cloud menu-item PATCH | `c09e828` |
| 31 Cloud availability windows | `f726a4e` |
| 32 Cloud route PUT | `65ff15e` |
| 33 Cloud tenant-wide write guard from the database | `c89db91` |
| 34 Cloud lock-order races | `f8141fe` |
| 35 Cloud CLI `set-branch-settings` | `c52a21c` |
| 36 Cloud CLI `restore-bump` | `dc29dd8` |
| 37 Hub migration 0004 and projections | `cc8290e` |
| 38 Hub config holder and HTTP client | `5f628e6` |
| 39 Hub `pollOnce` core | `3f49853` |
| 40 Hub poller — schema version, stored-body format, commit failure | `3387815` |

**Next task for Cursor: 41.**

## Markers

| Marker | Meaning |
|---|---|
| **Claude only** | Edits `docs/`, `.cursor/` or the foundation. Cursor skips it. |
| **needs Docker Postgres** | The task's own command needs Postgres. Note: **every** `pnpm test` runs the cloud suite, so Postgres must be up for every `pnpm test`: keep `docker compose up -d postgres` running for every task (R19). |
| **needs hardware** | Needs the pilot mini PC or another `ssh` target on the LAN. Only task 71 (release drill, §7.5 timing). |
| **STOP** | Do not start the next task until the user confirms. |

## Global Constraints

Every task implicitly includes these. Values copied from spec v1.0.

- **Node:** 22.22.2 or later on dev machines and CI (S35 g; jsdom 30.1.3 needs it). Root `engines.node` becomes `>=22.22.2 <23` in task 57.
- **Dependencies (§12.1, S35 g):** none new in `apps/hub`, `apps/cloud`, `packages/*` except workspace links (`@pos/engine` in `apps/hub` and `apps/client`) and `@types/node@22.19.1` (dev, types only) in `packages/domain` (S40 N1). gzip uses `node:zlib`; no compression plugin (S48). `apps/client` only, a closed list: `react@19.3.1`, `react-dom@19.3.1` (runtime); `vite@8.3.5`, `jsdom@30.1.3`, `@types/react@19.3.0`, `@types/react-dom@19.3.0` (dev). Exact pins. No router, state, form, CSS or testing library; no React plugin; no `ulid` package in the client (S35 j).
- **Browser-safe packages (S35 k):** nothing under `packages/engine/**`, and nothing under `packages/domain/src/**` except `src/hash.ts`, imports `node:*` (test files exempt). Lint enforces it from task 13. `localTimeOfDayMs` takes the UTC offset as an argument and never reads the runtime time zone (S47).
- **Determinism (F §6.7):** no `Date.now()`, `Math.random()`, `ulid()`, `crypto.randomUUID()` in hub/cloud/package `src/` (lint enforces). `apps/client/src/**` is browser code and may read the clock, `performance.now()` and `crypto.getRandomValues` (task 58 sets the lint block); it never calls `crypto.randomUUID` (no secure context on the hub, S35 j), and it evaluates time windows with the hub's `hub_time`, never the device's wall clock or time zone (S47).
- **Envelope (F §6.1):** `{ data }` or `{ error: { code, message, details, request_id } }`. The only body-less reply is §6.1's `304`. Replays add `Idempotent-Replay: true`. The hub never answers `503`.
- **Errors:** only catalogue codes; `throw new DomainError(code, details)`. New codes exist after task 4 (13 codes, §9, including `BUSINESS_DAY_NOT_OPEN 409`). A tenant-wide write by an owner whose `owner_users.allowed_branch_ids` row does not cover every branch is `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` (S8; existing code).
- **Naming (F §6.6):** snake_case on the wire and in SQL; camelCase in TS; `*_at` Unix ms; `*_ms` durations; money `*_minor` integer; quantities integers in the smallest unit (pieces, g, ml, S44).
- **Cloud SQL (D54):** owner routes query only through `TenantScopedRepository` (branch-level tables: `WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3`) or `TenantLevelRepository` (SQL contains `tenant_id = $1`; tenant-level tables `tax_classes`, `categories`, `menu_items`, `availability_windows`, `idempotency_keys`, `config_audit`, plus `branches` and the owner's own `owner_users` row for `bumpConfigVersion` / `coversEveryBranch` only: the D54 exception of S40 N3 and S8). Both accept a `pg.PoolClient`. Path `branch_id` not in `request.tenant.branchIds` → `404 BRANCH_NOT_FOUND`. CLIs use `SystemContext` (M56).
- **Cloud write script (§6 intro):** Zod → `BEGIN` → [creating POST: idempotency key insert, `request_hash` over method + filled path + body] → target `FOR UPDATE` (`404` if absent) → rule checks on the **merged** row; reference rows `FOR SHARE` in id order → write → `writeConfigAudit` → `bumpConfigVersion` (tenant-wide: read the owner's `owner_users.allowed_branch_ids`, then the branch rows `FOR UPDATE`, coverage check) → [store response on key] → `COMMIT` → [creating POST: prune old keys in their own statement]. pg `23505` on an `*_active_name` index → `409 CONFIG_NAME_TAKEN { entity, name }`. Route body schemas are validated before the tenant guard runs, so tests that expect `401`/`404`/`403` send a valid body (R39).
- **Hub SQL:** `writer.run` only; no `await` inside it; queries never write; query handlers `prepare` per call (so `statementCounter` on `deps.readDb` sees them, R31). Projection times are the event's `recorded_at`, never the clock (§5.1).
- **Fixed values:** poll interval 60 000 ms; poll HTTP timeout **30 000 ms** with `Accept-Encoding: gzip` (S48); names 1–60 chars trimmed, unique case-insensitive among active rows; `price_minor` 0…1 000 000 000 minor units; `cook_time_ms` 1…14 400 000; `prep_buffer_ms` 0…3 600 000; `stock_time_ms` null or 0…`cook_time_ms`; `rate_bp` 0…10 000; station `capacity` 1…100; `freshness_window_ms` batch only 0…3 600 000 default 0; `completion_mode` `two_tap` (default) / `single_tap` / `auto_done`; `seats` null or 1…100; `description` ≤ 300; `out_of_stock_behaviour` `cook_fresh` (default) / `sold_out`; `stock_unit`, `sale_unit` ∈ `piece` (default) / `g` / `ml`, equal → `stock_per_sale_unit` 1, different → `sale_unit 'piece'` and `stock_per_sale_unit` 1…1 000 000 (S44); `low_stock_threshold` null or 0…1 000 000; `carries_over` default false; `availability_windows` 0–4 per item and per category, `start_ms`/`end_ms` 0…86 340 000, multiples of 60 000, `start_ms ≠ end_ms`, sorted `start_ms, end_ms, window_id` (S47); branch settings `day_stale_after_hours` 1…72 (default 16), `day_min_gap_hours` 0…24 (default 4), stale > gap (S33); idempotency rows pruned after 86 400 000 ms, at most 100 per prune; stock entries 1–200, `on_hand` 0…1 000 000, `quantity` 1…1 000 000; menu page `limit` 1…200 (default 50), `q` 1…60; `SNAPSHOT_SCHEMA_VERSION = 1`; stock page refresh 15 000 ms; CSP `default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` (cloud `/owner/*` and hub `/admin/stock/*`); `Cache-Control` `no-cache` (index.html) and `public, max-age=31536000, immutable` (`assets/*`); `restore-bump` sets each version to `GREATEST(v + 1, now_ms)`. **Removed, never build:** `business_day_start_ms`, `businessDayStartedAt`, a date-based day open, `end_current_day`, `config_epoch`, `pull-now`.
- **Client (S35 d–f, j, k):** styling only through `apps/client/src/app/ui-kit.ts` (the only CSS imports); no `style` prop; no `dangerouslySetInnerHTML`; shared components in `src/components/`; ULIDs only from `src/app/ulid.ts`; may import `@pos/domain` (root), `@pos/events`, `@pos/engine`.
- **Secrets never logged (§7.3):** the poller never logs the snapshot body or the directory (PIN hashes); a `malformed` envelope logs only Zod issue paths and codes, never `input` / `received`.
- **Tests:** names `it('[01a §10 #N] …')`, each N in exactly one test (coverage table); other tests cite a section `it('[01a §6.4] …')`; page parts `it('[01a §10 #N page part] …')` (S40 N11, extended in §12.1). Hub integration `apps/hub/test/**/*.int.test.ts`; cloud integration `apps/cloud/test/**/*.int.test.ts`; unit `*.test.ts` next to source; client `apps/client/src/**/*.test.tsx` and `apps/client/test/*.test.ts`.
- **Cross-tenant and route inventory (D54, M25):** every task that adds a cloud route adds a case to `ROUTE_CASES` in `apps/cloud/test/cross-tenant.int.test.ts` (task 17 creates it) whose path/payload names tenant B's ids and whose body is otherwise valid; the 00 tests stay green.
- **Commit:** `feat(01a): task N <title> [spec §x]`, only the task's files: `git add <files> && git commit -m "…"`.

## Spec decisions applied

**S40 (plan review, spec v0.5):**

| # | Decision | Where |
|---|---|---|
| N1 | `@types/node@22.19.1` dev dependency in `packages/domain` (`hash.ts` only) | task 8 |
| N2 | `onBranchConfigApplied(prev, next, tx)` | task 41 |
| N3 | Tenant-wide bump through `TenantLevelRepository` on `branches`: allowed D54 exception | task 16 |
| N4 | Skipped poll → `not_ready`, no HTTP call; status "Waiting for hub confirmation" | tasks 39, 54, 69 |
| N6 | S25 edits line 8 | task 1 (done) |
| N7 | Money: trim, drop every comma, ASCII digits with ≤ 2 decimals | task 62 |
| N8 | Stock command result `set_at` may differ by ms from `recorded_at`; the stock query is the truth | task 49 |
| N9 | `QueryCtx.branchConfig` (not `.config`) | task 44 |
| N10 | §7.5 targets by runbook / hub smoke script, not automated tests | task 71 |
| N11 | Numbered test = server/render part; `[… page part]` = page part; page parts also runbook steps | tasks 58, 66, 69, 70, 71 |
| N12 | First boot after 0004 replays the full log once (§7.6) | task 37 |

**Spec v0.6–v0.6.1 (review 1, cuts):** no epoch, no directory resend, no 00 behaviour change, no schema negotiation, no `pull-now`, parking is 02's (no task builds them); B2 apply failure (task 42); wire hash and `canonicalJson` throws on `undefined` (tasks 8, 21); every confirmed count appends `StockSet` (tasks 49, 69); `on_hand`, `reserved` ≥ 0 (task 11); archived tax classes and programs stay in the snapshot (tasks 9, 20); boot placement through `BootContext.initialState` and step 5 after catch-up (tasks 44, 45); on-site release (tasks 60, 71); happy paths and merged-row rules (tasks 23, 25, 26, 30); idempotency hash and prune (task 15); browser-safe lint (task 13); review 1 nits as in the tasks below.

**Spec v0.7–v1.0 (owner answers, review 2):**

| Item | Decision | Where |
|---|---|---|
| Units (S44) | `stock_unit`, `sale_unit`, `stock_per_sale_unit`; integers in the smallest unit; kg / L in the UI (`parseQuantity`, `formatQuantity`) | tasks 5, 9, 14, 28, 30, 61, 67 |
| Frozen units (S44, review 2 S-2) | `BusinessDayOpened.units`; `dayUnits(state, item)` on every stock path; a unit change takes effect at the next open | tasks 12, 47, 51 |
| Serve from stock (S14, review 2 S-1) | `canServeFromStock(available, quantity, stockPerSaleUnit)` = `available ≥ quantity × stockPerSaleUnit` | task 11 |
| Stock adds (S45) | `StockAdded`, `AddPrecookedStock`; an add onto an invalid count is a `StockSet`; a `StockAdded` in another unit throws in the fold (nit 1) | tasks 10, 11, 50 |
| Low stock (S46) | `low_stock_threshold`; derived `stockLevel`, no event; alert bar on `/admin/stock` | tasks 12, 53, 69 |
| `carries_over` (S41) | per item; `countIsValid` / `availableStock` with `openDayStartMs(state)` | tasks 11, 12, 53 |
| Time windows (S47) | rows on items and categories; `inAvailabilityWindows`, `localTimeOfDayMs(now, offset)`, `isOrderableByTime`; manual Off wins; manual On does not override a window [ASSUMPTION] | tasks 6, 31, 67, 69 |
| Business day (S33, review 2 B1) | open → closed; `OpenBusinessDay` (no-op while open), `CloseBusinessDay` (`day_min_gap_hours` guard); stock commands `409 BUSINESS_DAY_NOT_OPEN` while none is open; stale-day prompt after `day_stale_after_hours`; both hours are branch settings with a DB and CLI rule (stale > gap) | tasks 14, 35, 47, 48, 49, 53, 70 |
| Hub time (S47, review 2 S-4) | `hub_time { now_ms, utc_offset_ms }` in catch-up `branch_config`, §6.23 and §6.19 | tasks 53, 55, 56, 69 |
| Stock poll (§6.19, review 2 S-5) | `meta_version` / `stock_version` short-circuit; `items_meta` and `items` parts; `stock_version` from the boot fold | tasks 44, 53, 69 |
| Tenant-wide guard (S8, review 2 S-6) | reads `owner_users.allowed_branch_ids` at write time; `can_edit_tenant` the same way | tasks 16, 29, 33 |
| Menu read (§6.11, S48) | `q`, `category_id`, `status`, keyset `cursor`, `limit`; 6 statements; rename can repeat a row, the page de-duplicates (nit 3) | tasks 29, 66 |
| gzip (S48) | `node:zlib` gzip of the `200`; identical bytes on both paths (nit 2); 30 s poll timeout | tasks 22, 38 |
| Line total (§4.2) | `lineTotalMinor` in `@pos/domain`, half-up per line [ASSUMPTION] | task 7 |
| Day settings (S33) | `branches.day_stale_after_hours`, `day_min_gap_hours`, CHECK stale > gap; snapshot fields; `set-branch-settings` flags | tasks 14, 20, 35 |
| Deferred | off-thread snapshot work until a branch snapshot > 1 000 items; the poller logs `warn` above it (§12.4) | task 39 |

## Review Focus

Inputs the spec implies but no §10 test covers. Each has a test in the named task.

1. **Names with surrounding spaces or other case** (`" ground "` vs `"Ground"`): stored trimmed; the duplicate is `409 CONFIG_NAME_TAKEN` → task 18.
2. **Prices or quantities pasted with a prefix or unit** (`"Rs 1,200"`, `"₨1200"`, `"1.5kg"`): rejected with the field error, never saved as 0 or partially → tasks 5, 62.
3. **An owner's access token expiring mid-form**: one refresh, the same request retried with the same `Idempotency-Key`; a second `401` clears storage and goes to `#/login` → task 62.
4. **The 15 s stock refresh landing while the manager types a count**: that row keeps the typed value → task 69.
5. **Shutdown during a poll**: after `stop()` no further poll runs, and an in-flight poll that resolves later does not swap the config → task 45.
6. **Another device closes the day while the stock page is open**: the next refresh shows the Start day action, Available 0 for non-carrying rows, and keeps typed counts → task 70.
7. **A window boundary passing while the page is open**: the hours badge changes within a minute without a server answer → task 69.

---

## Interfaces (later tasks rely on these exact names)

```ts
// packages/domain/src/units.ts — root export (task 5); browser-safe
export type Unit = 'piece' | 'g' | 'ml';
export function parseQuantity(text: string, unit: Unit): { ok: true; value: number } | { ok: false }; // 'g'/'ml': kg/L text, ≤ 3 decimals
export function formatQuantity(n: number, unit: Unit): string;                                      // 1500,'g' → "1.5 kg"

// packages/domain/src/availability-windows.ts — root export (task 6); browser-safe
export interface AvailabilityWindow { start_ms: number; end_ms: number }
export function localTimeOfDayMs(nowMs: number, utcOffsetMs: number): number;     // never reads the runtime zone
export function inAvailabilityWindows(windows: readonly AvailabilityWindow[], localTimeOfDayMs: number): boolean; // [] → true; [start,end), wraps
export function isOrderableByTime(item: { availability_windows: readonly AvailabilityWindow[] }, category: { availability_windows: readonly AvailabilityWindow[] } | null, hubNowMs: number, utcOffsetMs: number): boolean;

// packages/domain/src/line-total.ts — root export (task 7); browser-safe
export function lineTotalMinor(priceMinor: number, quantity: number, saleUnit: Unit): number; // piece: p×q; g/ml: half-up(p×q/1000), BigInt product
export const DEFAULT_DAY_STALE_AFTER_HOURS = 16;
export const DEFAULT_DAY_MIN_GAP_HOURS = 4;

// packages/domain/src/hash.ts — subpath "@pos/domain/hash" (task 8). Not re-exported from the root.
export function canonicalJson(v: unknown): string;   // throws on undefined anywhere in v (S27)
export function sha256hex(s: string | Buffer): string;

// packages/events/src/config.ts (task 9)
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const BranchConfigSnapshotSchemaV1: z.ZodObject<…>;            // §4.3 (v1.0 fields); NOT .strict()
export type BranchConfig = z.infer<typeof BranchConfigSnapshotSchemaV1>;
export type ConfigItem = BranchConfig['items'][number];
export type ConfigCategory = BranchConfig['categories'][number];
export type ConfigStation = BranchConfig['stations'][number];
export function isStockTracked(config: BranchConfig, item: ConfigItem): boolean;   // §4.3
export const SyncConfigEnvelopeSchema; // { data: { config: { snapshot_hash: string; snapshot: Record<string, unknown> } | null; directory: DirectoryInput | null } }

// packages/events (task 10): BranchConfigApplied, StockSet {item_id,on_hand,unit}, StockAdded {item_id,quantity,unit},
//   BusinessDayOpened {business_date, units}, BusinessDayClosed {}, ItemMadeUnavailable, ItemMadeAvailable (v1, §4.2)
// packages/events/testing: aBranchConfigApplied, aStockSet, aStockAdded, aBusinessDayOpened, aBusinessDayClosed,
//   anItemMadeUnavailable, anItemMadeAvailable (each (o?)), aBranchConfig(o?): BranchConfig

// packages/engine/src (tasks 11–12) — package "@pos/engine"; browser-safe (S35 k)
export interface StockEntry { on_hand: number; reserved: number; set_at: number | null; unit: Unit }
export interface DayUnits { stock_unit: Unit; sale_unit: Unit; stock_per_sale_unit: number }
export interface BusinessDay { business_date: string; opened_at: number; closed_at: number | null; units: Record<string, DayUnits> }
export interface EngineState { stock: Record<string, StockEntry>; business_day: BusinessDay | null }
export const ENGINE_STATE_VERSION = 1;
export function initialEngineState(): EngineState;                                  // { stock: {}, business_day: null }
export function applyEvent(state: EngineState, event: PosEvent): EngineState;      // pure; unknown events return `state` (same reference)
export function buildEngineState(events: readonly PosEvent[]): EngineState;
export function stockOf(state: EngineState, itemId: string): StockEntry;           // missing → { 0, 0, null, 'piece' }
export function openDayStartMs(state: EngineState): number | null;                 // opened_at while closed_at null
export function dayUnits(state: EngineState, item: ConfigItem): DayUnits;          // frozen entry, else the item's own fields
export function countIsValid(entry: StockEntry, businessDayStartMs: number | null, item: { carries_over: boolean; stock_unit: Unit }): boolean;
//   spec signature; callers pass { carries_over: item.carries_over, stock_unit: dayUnits(state, item).stock_unit } (availableStock / stockLevel do this inside)
export function availableStock(state: EngineState, itemId: string, businessDayStartMs: number | null, item: ConfigItem): number;
export function stockLevel(state: EngineState, itemId: string, businessDayStartMs: number | null, item: ConfigItem): 'not_counted' | 'out' | 'low' | 'ok';
export function saleUnitsAvailable(available: number, stockPerSaleUnit: number): number;   // floor
export function canServeFromStock(available: number, quantity: number, stockPerSaleUnit: number): boolean;

// apps/cloud/src/lib/idempotency.ts (task 15)
export async function inTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>, o?: { isolation?: 'REPEATABLE READ'; readOnly?: boolean }): Promise<T>;
export interface IdempotentResult<T> { status: number; body: T; replay: boolean }
export async function withIdempotency<T>(
  ctx: { pool: pg.Pool; clock: Clock; tenant: TenantContext; log: Pick<FastifyBaseLogger, 'error'> },
  request: { key: string | undefined; method: string; path: string /* filled */; body: unknown },
  fn: (client: pg.PoolClient) => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>>;
export function sendIdempotent(reply: FastifyReply, r: IdempotentResult<unknown>): FastifyReply;

// apps/cloud/src/lib/config-version.ts and config-audit.ts (task 16; the owner-row check is task 33)
export interface TenantSql { query<R extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<R[]> }
export type BumpScope = { kind: 'branch'; branchId: string } | { kind: 'tenant'; ownerUserId: string | null /* null = CLI */ };
export async function bumpConfigVersion(db: TenantSql, scope: BumpScope): Promise<Array<{ branch_id: string; config_version: number }>>;
export async function coversEveryBranch(db: TenantSql, ownerUserId: string): Promise<boolean>;   // 1 statement, no lock (§6.11)
export type AuditEntity = 'floor'|'table'|'station'|'batch_program'|'tax_class'|'category'|'menu_item'|'item_route'|'branch_settings';
export type AuditAction = 'create'|'update'|'archive'|'restore'|'route_set'|'route_removed';
export interface AuditEntry { actor: { kind: 'owner'; ownerUserId: string } | { kind: 'cli' }; entity: AuditEntity; entityId: string; branchId: string | null; action: AuditAction; before: object | null; after: object | null }
export async function writeConfigAudit(db: TenantSql, entry: AuditEntry, deps: { clock: Clock; ids: IdGen }): Promise<void>;
export function auditActionFor(before: { archived_at: number | null }, after: { archived_at: number | null }): 'update' | 'archive' | 'restore';

// apps/cloud/src/server.ts (task 17): CloudDeps gains testHooks?: CloudTestHooks
export interface CloudTestHooks {
  handlerStart?(route: string): void;                 // first line of a handler: tests reset pgCounter here (R9)
  afterTargetLock?(route: string): Promise<void>;     // task 34
  afterReferenceLock?(route: string): Promise<void>;  // task 34
  beforeBump?(): Promise<void>;                       // task 19
  beforePrune?(): Promise<void>;                      // task 15 (#122)
}

// apps/cloud/src/modules/config-sync/builder.ts (task 20) — one builder (S28)
export interface SnapshotHeader { config_version: number; currency_code: string; tax_enabled: boolean; day_stale_after_hours: number; day_min_gap_hours: number }
export async function buildSnapshot(client: pg.PoolClient, tenant: TenantContext, branchId: string, header: SnapshotHeader): Promise<Record<string, unknown>>;
//   7 statements; returns the wire object JSON.parse(JSON.stringify(BranchConfigSnapshotSchemaV1.parse(built))) (S27)

// apps/cloud/src/cli (tasks 35–36)
export async function setBranchSettings(sys: SystemContext, input: { branchId: string; taxEnabled?: boolean; dayStaleAfterHours?: number; dayMinGapHours?: number }, deps: { clock: Clock; ids: IdGen }):
  Promise<{ tax_enabled: boolean; day_stale_after_hours: number; day_min_gap_hours: number }>;
export async function restoreBump(sys: SystemContext, input: { tenantId: string }, deps: { clock: Clock }):
  Promise<{ branches: Array<{ branch_id: string; before: number; after: number }>; directory: { before: number; after: number } }>;

// apps/hub/src/projections/branch-config.ts, item-availability.ts (task 37)
export interface BranchConfigRow { branch_id: string; config_version: number; snapshot_schema_version: number; snapshot_hash: string; applied_at: number }
export const branchConfigProjection: Projection;
export function readBranchConfigRow(db: Database.Database, branchId: string): BranchConfigRow | undefined;
export function parseStoredSnapshot(body: string): BranchConfig;
export type LoadedConfig = { state: 'NONE' } | { state: 'BODY_MISSING'; row: BranchConfigRow } | { state: 'APPLIED'; row: BranchConfigRow; entry: ConfigEntry };
export function loadBranchConfig(db: Database.Database, branchId: string): LoadedConfig;   // 2 PK reads; schema ≠ 1 → BODY_MISSING
export const itemAvailabilityProjection: Projection;
export function itemAvailability(db: Database.Database, itemIds: readonly string[]): Map<string, boolean>; // 1 statement
export function registerRestaurantProjections(projections: ProjectionRegistry): void;

// apps/hub/src/sync/branch-config-holder.ts (type: task 37; functions: task 38; hooks: task 41)
export interface ConfigEntry { config: BranchConfig; snapshotHash: string; configVersion: number; snapshotSchemaVersion: number; appliedAt: number }
export function branchConfig(): BranchConfig | null;
export function currentConfigEntry(): ConfigEntry | null;
export function swapBranchConfig(entry: ConfigEntry | null): void;
export function onBranchConfigApplied(fn: (prev: BranchConfig | null, next: BranchConfig, tx: WriterTx) => void): () => void;
export function runBranchConfigHooks(prev: BranchConfig | null, next: BranchConfig, tx: WriterTx): void; // a throw propagates (S43)

// apps/hub/src/sync/config-client.ts (task 38)
export interface ConfigQuery { config_version: number; directory_version: number }
export type ConfigFetch = { kind: 'not_modified' } | { kind: 'ok'; text: string } | { kind: 'offline' }
  | { kind: 'error'; status: number; code: string; details: Record<string, unknown> };   // 4xx only
export interface ConfigClient { fetchConfig(q: ConfigQuery): Promise<ConfigFetch> }
export function httpConfigClient(baseUrl: string, branchApiKey: string, timeoutMs?: number): ConfigClient; // default 30_000, Accept-Encoding: gzip

// apps/hub/src/sync/config-poller.ts (tasks 39–43, 45)
export type PollOutcome = 'applied'|'unchanged'|'offline'|'rejected'|'unauthorized'|'not_ready';
export type RejectReason = 'malformed'|'hash_mismatch'|'schema_unsupported'|'schema_invalid'|'apply_failed';
export interface ConfigPoller { pollOnce(): Promise<PollResult>; lastPoll(): { outcome: PollOutcome; at: number } | null; lastProblem(): PollProblem | null; start(intervalMs?: number): void; stop(): void }
export function createConfigPoller(deps: { config: HubConfig; db: Database.Database; writer: Writer; clock: Clock; client: ConfigClient;
  setDirectory: (d: StaffDirectory) => void; log: Pick<FastifyBaseLogger, 'debug'|'info'|'warn'|'error'>; applyDirectory?: typeof applyStaffDirectory }): ConfigPoller;
export function configPoller(app: FastifyInstance): ConfigPoller;

// apps/hub/src/sync/boot-steps.ts (tasks 44–45)
export function foldEngineEvents(db: Database.Database, branchId: string): { state: EngineState; stockVersion: number };
//   stream_type 'stock' (all events) + stream_type 'hub' BusinessDayOpened/Closed, by seq; stockVersion = max seq of the six stock-version events
export function registerRestaurantBootSteps(): void;  // step '3' fold → ctx.initialState + setStockVersion; '5' config load; '6' poller start
// apps/hub/src/sync/stock-version.ts (task 44)
export function stockVersion(): number; export function setStockVersion(n: number): void;
export function noteCommitted(events: readonly PosEvent[]): void;   // called from createDeps' publish wrapper after COMMIT
// apps/hub/src/lib/hub-time.ts (task 53)
export function hubTime(clock: Clock): { now_ms: number; utc_offset_ms: number };  // -new Date(now).getTimezoneOffset() * 60_000
// lib/boot.ts (task 44): BootContext gains initialState?: unknown; createDeps(…, initialState?) → createStateHolder(initialState ?? {}) + setReducer(applyEvent)
// HubDeps.state: StateHolder<EngineState>; CommandCtx.state: Readonly<EngineState>; QueryCtx gains state, branchConfig (S40 N9)

// apps/{hub,cloud}/src/lib/client-dist.ts (task 59)
export const CSP = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export function registerClientDist(app: FastifyInstance, o: { prefix: '/owner/' | '/admin/stock/'; dir: string; routeConfig: Record<string, unknown> }): void;
export const CLIENT_DIST_DIR: string;  // fileURLToPath(new URL('../../../client/dist/<entry>/', import.meta.url)) (S39 b)

// apps/client (tasks 57–70)
// src/app/ulid.ts: newUlid(nowMs?: number): string
// src/app/hub-clock.ts (task 69): createHubClock(hubTime: { now_ms; utc_offset_ms }, perfNow = () => performance.now()): { nowMs(): number; offsetMs: number }
// src/components/: PinPad, StaffTiles, BusyButton, Banner({ tone: 'danger'|'warn'|'info' })
// src/features/owner/money.ts: parseRupeesToMinor(input): { ok: true; value } | { ok: false }; formatMinor(minor): string
// src/api/cloud-admin.ts: createCloudAdmin(o: { fetch?; storage?; onLoggedOut(): void }): CloudAdmin
// src/api/hub-admin.ts: createHubAdmin(o: { fetch?; storage?; readDeviceToken?: () => Promise<string | null> }): HubAdmin   (R10)
// src/app/router.ts: useHashRoute(): string
// src/features/admin/stock/badges.ts: offSince(unavailableSince, businessDayStartMs): number | null; hoursLabel(windows): string
```

---

## Coverage table (§10 → task)

Every active §10 number of spec v1.0 (1–154 except the removed 55, 96–101, 104, 109–112), each in exactly one task. Page parts (S40 N11) are listed separately and do not count as the number's task.

| Task | Tests |
|---|---|
| 5 | 141 |
| 6 | 136, 137 |
| 7 | 150 |
| 11 | 66, 129, 148 |
| 12 | 68 |
| 13 | 127 |
| 14 | 84 |
| 15 | 9, 10, 11, 12, 13, 14, 122 |
| 16 | 8 |
| 18 | 16, 17, 23, 80 |
| 19 | 18, 19, 83 |
| 20 | 4, 5, 85 |
| 21 | 1, 2, 3, 6, 114 |
| 23 | 20, 21, 22, 118 |
| 24 | 24, 25, 26, 27 |
| 25 | 28, 29, 30, 119 |
| 26 | 31, 32, 120 |
| 28 | 33, 34, 35, 36, 37, 41, 88 |
| 29 | 40, 138, 139 |
| 30 | 7, 38, 81, 106, 107, 121, 128 |
| 31 | 135 |
| 32 | 39, 82 |
| 33 | 117, 153 |
| 34 | 86, 87 |
| 35 | 105, 108, 154 |
| 36 | 123 |
| 37 | 49 |
| 39 | 42, 43, 44, 45, 53, 54, 95, 126, 140 |
| 40 | 46, 94 |
| 41 | 58 |
| 42 | 50, 115 |
| 43 | 51, 52 |
| 44 | 67, 93 |
| 45 | 47, 48, 124 |
| 46 | 57 |
| 47 | 133 |
| 48 | 143, 144, 145 |
| 49 | 59, 60, 61, 62, 63, 64, 65, 134 |
| 50 | 130 |
| 51 | 147, 149 |
| 52 | 69, 70, 71 |
| 53 | 72, 103, 116, 131, 132, 142, 146, 152 |
| 54 | 56, 102 |
| 55 | 73, 89, 90, 91 |
| 56 | 92, 151 |
| 57 | 113, 125 |
| 58 | 79 |
| 59 | 15, 78 |
| 62 | 74 |
| 64 | 76 |
| 66 | 75 |
| 69 | 77 |

Page parts: `#75 page part` task 58; `#139 page part` task 66; `#102`, `#103`, `#132`, `#137 page part` task 69; `#133`, `#146 page part` task 70.

142 active numbers in 52 tasks. Task 72 re-checks this in the code with `grep`.

## Task list (→ spec v1.0 §11 step)

| # | Task | §11 | Markers |
|---|---|---|---|
| 1 | Spec 00 v1.2.1 editorial patch — **done** `013afb4` | 1 | Claude only |
| 2 | Foundation §6.2: append §9 codes — **done** `ee81c61` | 2 | Claude only |
| 3 | `.cursor/rules/pos.mdc` → this plan, spec v1.0 — **done** `757e1de` | — | Claude only |
| 4 | Domain: error codes, `manage-stock` | 2 | needs Docker Postgres |
| 5 | Domain: units (`parseQuantity`, `formatQuantity`) | 2 | |
| 6 | Domain: availability windows | 2 | |
| 7 | Domain: `lineTotalMinor`, day-setting defaults | 2 | |
| 8 | `@pos/domain/hash` (throws on `undefined`) | 3 | |
| 9 | Events: snapshot schema `config.ts` | 4 | |
| 10 | Events: seven events, fixtures, builders | 4 | |
| 11 | `@pos/engine`: stock slice | 5 | |
| 12 | `@pos/engine`: business day, `dayUnits`, `stockLevel` | 5 | |
| 13 | Lint: browser-safe packages | 24 (early: guards tasks 5–12) | |
| 14 | Cloud migration `0002_restaurant_setup.sql` | 6 | needs Docker Postgres |
| 15 | Cloud `withIdempotency` | 7 | needs Docker Postgres |
| 16 | Cloud `bumpConfigVersion`, `writeConfigAudit` | 8 | needs Docker Postgres |
| 17 | Cloud test infrastructure | 9 | needs Docker Postgres |
| 18 | Cloud floors GET/POST | 9 | needs Docker Postgres |
| 19 | Cloud floor PATCH | 9 | needs Docker Postgres |
| 20 | Cloud snapshot builder | 13 | needs Docker Postgres |
| 21 | Cloud `GET /v1/sync/config` | 13 | needs Docker Postgres |
| 22 | Cloud sync gzip | 13 | needs Docker Postgres |
| 23 | Cloud tables | 9 | needs Docker Postgres |
| 24 | Cloud stations | 10 | needs Docker Postgres |
| 25 | Cloud batch programs | 10 | needs Docker Postgres |
| 26 | Cloud tax classes, categories | 11 | needs Docker Postgres |
| 27 | Cloud owner-row read helper (`ownerAllowedBranches`) | 8 | needs Docker Postgres |
| 28 | Cloud menu-item POST (units, threshold, `carries_over`) | 12 | needs Docker Postgres |
| 29 | Cloud menu read: search, pages, `can_edit_tenant` | 12a | needs Docker Postgres |
| 30 | Cloud menu-item PATCH | 12 | needs Docker Postgres |
| 31 | Cloud availability windows (items and categories) | 11, 12 | needs Docker Postgres |
| 32 | Cloud route PUT | 12 | needs Docker Postgres |
| 33 | Cloud tenant-wide write guard from the database | 8 | needs Docker Postgres |
| 34 | Cloud lock-order races | 10, 12 | needs Docker Postgres |
| 35 | Cloud CLI `set-branch-settings` | 14 | needs Docker Postgres |
| 36 | Cloud CLI `restore-bump` | 14 | needs Docker Postgres |
| 37 | Hub migration 0004, projections | 15 | |
| 38 | Hub config holder and HTTP client (gzip, 30 s) | 16 | |
| 39 | Hub `pollOnce` core; gzip end to end (#140) | 16 | needs Docker Postgres |
| 40 | Hub poller: schema version, stored-body format, commit failure | 16 | |
| 41 | Hub `onBranchConfigApplied` | 16 | |
| 42 | Hub apply failure: visible problem, parts retried alone | 16 | |
| 43 | Hub directory through the poll | 17 | |
| 44 | Hub engine state through `createDeps`, reducer, boot fold, `stock_version` | 19 | |
| 45 | Hub boot config load after catch-up, `BODY_MISSING`, poll timer | 17, 19 | |
| 46 | Hub station validator | 18 | |
| 47 | Hub `OpenBusinessDay` | 31 | |
| 48 | Hub `CloseBusinessDay` | 31 | |
| 49 | Hub `SetPrecookedStock` | 20 | |
| 50 | Hub `AddPrecookedStock` | 30 | |
| 51 | Hub business day across restart; units frozen per day | 31 | |
| 52 | Hub `SetItemAvailability`, `itemAvailability` | 21 | |
| 53 | Hub stock query (versions, parts, `day_stale`, `hub_time`) | 22 | |
| 54 | Hub config status | 22 | |
| 55 | Hub WS audiences and catch-up parts | 23 | |
| 56 | Hub `GET /queries/branch-config` with `hub_time` | 23 | |
| 57 | `apps/client` scaffold, build, ULID helper | 24 | |
| 58 | `apps/client` lint rules | 24 | |
| 59 | `client-dist`, `admin-page` group, `/owner/*` allowlist, CSP on both | 25 | needs Docker Postgres |
| 60 | `apps/hub/deploy/ship-client.sh` | 25 | |
| 61 | Shared components, quantity input | 27 (pre) | |
| 62 | Owner money and `cloud-admin` client | 26 | |
| 63 | Owner shell: login, branch picker, app | 26 | |
| 64 | Owner floors view | 26 | |
| 65 | Owner stations view | 26 | |
| 66 | Owner menu list: search, Load more, read-only start | 26 | |
| 67 | Owner item and category forms: units, threshold, keeps overnight, hours | 26 | |
| 68 | `/admin/stock`: `hub-admin` client and PIN login | 27 | |
| 69 | `/admin/stock`: stock table, status, banner, alert bar, save, versioned poll, hours | 27 | |
| 70 | `/admin/stock`: business day (Start day, Close day, stale prompt) and Add | 27 | |
| 71 | Manual runbook and release drill | 29 | needs Docker Postgres, needs hardware |
| 72 | README, spec status, runbook file, DoD close-out | §12.1 | Claude only |

---

### Task 1: Spec 00 v1.2.1 editorial patch — Claude only — **done** (`013afb4`)

`00_Hub_Platform_Access_Spec_v1.2.md` → `…_v1.2.1.md` with the three S25 edits (line 8 version, line 472 `defineQuery` ctx, line 481 `state.setReducer`); README row and links updated.

### Task 2: Foundation §6.2 — append the §9 codes — Claude only — **done** (`ee81c61`)

The 13 codes of 01a §9 appended to the 404, 409 and 422 rows as "01a §9: …" (D64 append-only).

### Task 3: Point the implementer rules at this plan — Claude only — **done** (`757e1de`)

`.cursor/rules/pos.mdc`: current plan `docs/plans/01a-plan.md`, spec v1.0; 00's plan finished; stop markers **Claude only** / **STOP**; Postgres up for every `pnpm test`; browser-code clock exception.

### Task 4: Domain — error codes and `manage-stock` — needs Docker Postgres

**Files:** Modify `packages/domain/src/errors.ts`, `packages/domain/src/errors.test.ts`, `packages/domain/src/permissions.ts`, `packages/domain/src/permissions.test.ts`; Create `apps/cloud/test/default-roles.test.ts` (runs in the cloud project, whose global setup waits for Postgres, R19).

**Interfaces — Produces:** catalogue entries `BRANCH_NOT_FOUND 404, FLOOR_NOT_FOUND 404, TABLE_NOT_FOUND 404, PROGRAM_NOT_FOUND 404, TAX_CLASS_NOT_FOUND 404, CATEGORY_NOT_FOUND 404, MENU_ITEM_NOT_FOUND 404, CONFIG_NAME_TAKEN 409, CONFIG_IN_USE 409, BUSINESS_DAY_NOT_OPEN 409, CONFIG_REFERENCE_INVALID 422, IDEMPOTENCY_KEY_MISMATCH 422, STOCK_NOT_TRACKED 422`; `'manage-stock'` appended last in `PERMISSIONS` (20 entries).

- [ ] **Step 1: Tests:** `[01a §9] 01a codes have their statuses` (all 13). Rename the 00 test to `[00 §3.6, 01a S18] catalogue has 20 unique entries` and append `'manage-stock'`. `default-roles.test.ts`: `[01a S18] Owner and Manager grant manage-stock; Cashier and Order taker do not`.
- [ ] **Step 2:** `pnpm vitest run packages/domain apps/cloud/test/default-roles.test.ts` → FAIL (codes missing).
- [ ] **Step 3:** Add the codes and the permission. `default-roles.ts` needs no change (Owner = all, Manager = all but `manage-roles`).
- [ ] **Step 4:** Same → PASS; `pnpm test`. If a hub or cloud test lists the 19 permissions exactly and fails, stop and report its path.
- [ ] **Step 5:** Commit `feat(01a): task 4 error codes and manage-stock permission [spec §9, S18]`

### Task 5: Domain — units

**Files:** Create `packages/domain/src/units.ts`, `packages/domain/src/units.test.ts`; Modify `packages/domain/src/index.ts`.

S44: `g` / `ml` text is kg / L with ≤ 3 decimals (`"1.5"` → 1500); pieces are integers. Trim spaces; ASCII digits and one `.` only; no unit suffix in the text (the UI shows the unit beside the field). Pure integer arithmetic on the digit string (no `parseFloat`). No `node:*` import.

- [ ] **Step 1: Tests:** `[01a §10 #141]` exactly as §10; Review Focus 2: `[01a S44] "1.5kg" and "1,5" are rejected`; `[01a S44] exported from the @pos/domain root`.
- [ ] **Step 2–4:** `pnpm vitest run packages/domain` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 5 quantity units in domain [spec S44]`

### Task 6: Domain — availability windows

**Files:** Create `packages/domain/src/availability-windows.ts`, `packages/domain/src/availability-windows.test.ts`; Modify `packages/domain/src/index.ts`.

S47: `localTimeOfDayMs(nowMs, utcOffsetMs) = ((nowMs + utcOffsetMs) % 86_400_000 + 86_400_000) % 86_400_000`; never `new Date().getTimezoneOffset()`. `[start, end)`; `end < start` wraps. `isOrderableByTime` = inside the item's windows (if any) and the category's (if any).

- [ ] **Step 1: Tests** (the file sets `process.env.TZ = 'UTC'` in `beforeAll` and restores it, so the runtime zone cannot help): `[01a §10 #136]` exactly as §10; `[01a §10 #137]` (the `isOrderableByTime` cases of §10; the page badge is `#137 page part` in task 69).
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 6 availability windows in domain [spec S47]`

### Task 7: Domain — `lineTotalMinor` and day-setting defaults

**Files:** Create `packages/domain/src/line-total.ts`, `packages/domain/src/line-total.test.ts`; Modify `packages/domain/src/index.ts`.

`piece` → `price × quantity`; `g` / `ml` → `(BigInt(price) × BigInt(quantity) × 2n + 1000n) / 2000n` (half-up, non-negative inputs), returned as `Number`. Non-integer or negative input throws. Also export `DEFAULT_DAY_STALE_AFTER_HOURS = 16`, `DEFAULT_DAY_MIN_GAP_HOURS = 4` (S33).

- [ ] **Step 1: Tests:** `[01a §10 #150]` exactly as §10; `[01a S33] day-setting defaults are 16 and 4`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 7 line total and day defaults in domain [spec §4.2, S33]`

### Task 8: `@pos/domain/hash`

**Files:** Create `packages/domain/src/hash.ts`, `packages/domain/src/hash.test.ts`; Modify `packages/domain/package.json` (`exports["./hash"] = "./src/hash.ts"`; `devDependencies: { "@types/node": "22.19.1" }`), `apps/hub/src/lib/hash.ts`, `pnpm-lock.yaml`.

- [ ] **Step 1: Tests:** `[01a S27] canonicalJson sorts keys at every depth and keeps array order`; `[01a S27] canonicalJson throws on undefined as a value, in an array and at the top level`; `[01a S27] sha256hex('abc')` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; `[01a S27] @pos/domain root does not export canonicalJson`.
- [ ] **Step 2:** `pnpm vitest run packages/domain` → FAIL (module missing).
- [ ] **Step 3:** `hash.ts` starts with `/// <reference types="node" />` (base tsconfig `types: []`, R20). Move the two bodies from `apps/hub/src/lib/hash.ts`; `canonicalJson` throws `new Error('canonicalJson: undefined')` where it wrote `null` for `undefined`. The hub file becomes `export { canonicalJson, sha256hex } from '@pos/domain/hash';` plus its `payloadHash`. `pnpm install`.
- [ ] **Step 4:** `pnpm vitest run packages/domain apps/hub/src/lib/hash.test.ts apps/hub/test/commands` → PASS (no current caller passes `undefined`; if one does, stop and report it); `pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 8 @pos/domain/hash subpath [spec S27]`

### Task 9: Events — snapshot schema (`config.ts`)

**Files:** Create `packages/events/src/config.ts`, `packages/events/src/config.test.ts`; Modify `packages/events/src/index.ts`.

**Interfaces — Produces:** fields and nullability exactly the §4.3 JSON of v1.0: `snapshot_schema_version` (literal 1), `config_version` (int ≥ 1), `branch_id`, `currency_code`, `tax_enabled`, `day_stale_after_hours` (int 1…72), `day_min_gap_hours` (int 0…24), `floors[…tables[…]]`, `stations[…programs[…, is_archived]]`, `tax_classes[…, is_archived]`, `categories[{category_id,name,sort_order,availability_windows}]`, `items[{…v0.6 fields…, stock_unit, sale_unit, stock_per_sale_unit, low_stock_threshold|null, carries_over, availability_windows, station_id, program_id|null, stock_program_id|null}]`; windows `{ start_ms, end_ms }`. **No `business_day_start_ms`.** Numbers `z.number().int()` (no coercion). `SyncConfigEnvelopeSchema.snapshot` is `z.record(z.string(), z.unknown())`.

- [ ] **Step 1: Tests:** `[01a §4.3] the §4.3 example parses`; `[01a S28 c] unknown fields are dropped, not rejected` (including an old `business_day_start_ms`); `[01a S27] price_minor "120000" fails`; `[01a S34] missing tax_enabled fails; tax_class_id null passes`; `[01a S22] programs and tax classes require is_archived`; `[01a S33, S44, S46, S47] missing day_stale_after_hours, stock_unit, carries_over or availability_windows fails`; `[01a §4.3] isStockTracked` (slot + `stock_time_ms` → true; slot + null → false; batch + `stock_program_id` → true; batch + null → false).
- [ ] **Step 2–4:** `pnpm vitest run packages/events` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 9 branch config snapshot schema v1 [spec §4.3, S22, S28, S33, S44–S47]`

### Task 10: Events — seven events, fixtures, builders

**Files:** Create `packages/events/src/events/hub/{BranchConfigApplied,BusinessDayOpened,BusinessDayClosed}.v1.ts`, `packages/events/src/events/stock/{StockSet,StockAdded,ItemMadeUnavailable,ItemMadeAvailable}.v1.ts`, `packages/events/fixtures/<each>.{v1,latest}.json`; Modify `packages/events/src/index.ts`, `packages/events/src/fixtures.test.ts` (expected file count + 14), `packages/events/testing/index.ts`, `packages/events/testing/builders.test.ts`.

**Interfaces — Produces:** payloads §4.2: `BranchConfigApplied { config_version, snapshot_schema_version, snapshot_hash (64 hex), previous_config_version|null }`; `StockSet { item_id, on_hand: int 0…1 000 000, unit }`; `StockAdded { item_id, quantity: int 1…1 000 000, unit }`; `BusinessDayOpened { business_date: /^\d{4}-\d{2}-\d{2}$/, units: Record<item_id, { stock_unit, sale_unit, stock_per_sale_unit }> }`; `BusinessDayClosed {}`; `ItemMadeUnavailable { item_id }`; `ItemMadeAvailable { item_id }`. `aBranchConfig()` returns a valid snapshot with a slot station "Karahi", a stock-tracked item `I1` (`piece`), a stock-tracked item `I3` (`g` / `piece` / 250) and a non-tracked item `I2`.

- [ ] **Step 1: Tests:** fixture count; `[01a §4.2] StockSet rejects on_hand 1000001 and -1; StockAdded rejects quantity 0`; `[01a §4.2] StockSet and StockAdded require unit`; `[01a §4.2] BusinessDayOpened rejects "25-10-2026"`; `[01a §4.2] BranchConfigApplied has no epoch fields`; each new builder parses with its schema.
- [ ] **Step 2–5:** `pnpm vitest run packages/events` → FAIL → implement → PASS → commit `feat(01a): task 10 config, stock and business-day events [spec §4.2]`

### Task 11: `@pos/engine` — stock slice

**Files:** Create `packages/engine/{package.json,tsconfig.json,vitest.config.ts}`, `packages/engine/src/{state,stock,apply-event,version,index}.ts`, `packages/engine/src/stock.test.ts`; Modify `pnpm-lock.yaml`.

`package.json`: `"name": "@pos/engine"`, `"exports": { ".": "./src/index.ts" }`, `dependencies: { "@pos/events": "workspace:*", "@pos/domain": "workspace:*" }`, script `typecheck`. Copy `tsconfig.json` / `vitest.config.ts` from `packages/events`. No `node:*` import (S35 k). In this task `EngineState` already has `business_day` (always `null` here); task 12 folds it. `countIsValid(entry, start, { carries_over, stock_unit })`: false when `set_at` null, or `entry.unit ≠ stock_unit`, or (`!carries_over` and (`start === null` or `set_at < start`)). `availableStock` passes `dayUnits(state, item).stock_unit`; `dayUnits` in this task returns the item's own fields (task 12 adds the frozen lookup).

- [ ] **Step 1: Tests:** `[01a §10 #66]` exactly as §10.4; `[01a §10 #129]` exactly as §10 (including the throwing `StockAdded` in another unit, state unchanged); `[01a §10 #148]` exactly as §10; `[01a S41] availableStock: carries_over false and set_at before start → 0; at or after → max(0, on_hand − reserved); set_at null → 0; start null → 0; carries_over true ignores start`; `[01a S14] stockOf on a missing item → { 0, 0, null, 'piece' }`; `[01a S15] applyEvent returns the same reference for a non-stock event`.
- [ ] **Step 2:** `pnpm install && pnpm vitest run packages/engine` → FAIL.
- [ ] **Step 3:** `applyEvent` copies only the touched entry; `set_at = event.recorded_at`, never a clock; `reserved` unchanged by `StockSet` / `StockAdded`; a `StockAdded` whose `unit` ≠ the entry's throws `Error('StockAdded unit mismatch')`.
- [ ] **Step 4–5:** PASS; `pnpm typecheck && pnpm test` → commit `feat(01a): task 11 engine package with stock slice [spec S14, S41, S44, S45]`

### Task 12: `@pos/engine` — business day, `dayUnits`, `stockLevel`

**Files:** Modify `packages/engine/src/{state,stock,apply-event,index}.ts`; Create `packages/engine/src/business-day.test.ts`, `packages/engine/fixtures/{engine-log.v1.json,engine-state.v1.json}`.

Fold: `BusinessDayOpened` → `business_day = { business_date, opened_at: recorded_at, closed_at: null, units }`; `BusinessDayClosed` → `closed_at = recorded_at` (no-op if none open). `openDayStartMs`, `dayUnits` (frozen entry for `item.item_id` when a day is open and lists it), `stockLevel` per S46 (`not_counted` / `out` / `low` / `ok`), `saleUnitsAvailable`.

- [ ] **Step 1: Tests:** `[01a §10 #68]` `buildEngineState(engine-log.v1.json)` deep-equals `engine-state.v1.json` (log: `BusinessDayOpened`, 4 `StockSet` and one `StockAdded` on 2 items, `BusinessDayClosed`, one `HubStarted`; test 147 needs both day events in the fixture); `[01a S33] openDayStartMs is null before an open and after a close`; `[01a S44] dayUnits returns the frozen triple while open and the item's own fields for an unlisted item or with no day open`; `[01a S46] stockLevel cases` (not counted, out, low at the threshold, ok above it, threshold null).
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm typecheck && pnpm test` → commit `feat(01a): task 12 engine business day and stock level [spec S33, S44, S46]`

### Task 13: Lint — browser-safe packages

**Files:** Modify `eslint.config.js`; Create `packages/engine/src/lint.test.ts` (the engine project includes `src/**/*.test.ts`).

One block after the root block (S35 k): `files: ['packages/engine/**/*.ts', 'packages/domain/src/**/*.ts']`, `ignores: ['packages/domain/src/hash.ts', '**/*.test.ts']`, `'no-restricted-imports': ['error', { patterns: [...dbClientImports.patterns, ...qrcodeImports.patterns, ...credentialLookupImports.patterns, ...systemContextImports.patterns, { group: ['node:*'], message: 'S35 k: packages/engine and the @pos/domain root must stay browser-safe' }] }]` (flat config replaces the rule's options, so the root patterns are repeated).

- [ ] **Step 1: Test** (`// @vitest-environment node`, `new ESLint().lintText(code, { filePath })`): `[01a §10 #127]` exactly as §10.5e, and `lintFiles(['packages/engine', 'packages/domain'])` → 0 errors (tasks 5–12 stayed clean).
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm lint` → commit `feat(01a): task 13 browser-safe lint for engine and domain [spec S35 k]`

### Task 14: Cloud migration `0002_restaurant_setup.sql` — needs Docker Postgres

**Files:** Create `apps/cloud/src/db/migrations/0002_restaurant_setup.sql` (verbatim §5.2 of v1.0: `config_version`, `tax_enabled`, `day_stale_after_hours`, `day_min_gap_hours`, `branches_day_settings`; no `business_day_start_ms`, no `config_epoch`; `menu_items` v0.7 columns and CHECKs; `availability_windows`; `menu_items_name_order`), `apps/cloud/test/db/restaurant-schema.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #84]` `UPDATE` and `DELETE` on a `config_audit` row raise `config_audit is insert-only`; every primary key and index on the new tables leads with `tenant_id` (`pg_index`); (the cross-tenant clause is task 17's `config_audit` row, R26). `[01a §5.2] tax_class_id NULL accepted; stock_time_ms > cook_time_ms rejected; a slot station with freshness 0 rejected`; `[01a §5.2, S44] stock 'piece' / sale 'g' rejected; equal units with stock_per_sale_unit 2 rejected`; `[01a §5.2, S47] a window with item_id and category_id both set, or start = end, rejected`; `[01a §5.2, S33] branches defaults 16 / 4; stale 4 with gap 4 rejected; no business_day_start_ms column`.
- [ ] **Step 2–4:** `pnpm vitest run apps/cloud/test/db/restaurant-schema.int.test.ts` → FAIL → add the file → PASS; `pnpm test` (if `schema.int.test.ts` asserts an exact table list and fails, stop and report).
- [ ] **Step 5:** Commit `feat(01a): task 14 cloud restaurant setup migration [spec §5.2, S26, S32–S34, S44–S47]`

### Task 15: Cloud `withIdempotency` — needs Docker Postgres

**Files:** Create `apps/cloud/src/lib/idempotency.ts`, `apps/cloud/test/lib/idempotency.int.test.ts`.

Behaviour S7. The key is checked **inside** `withIdempotency` (missing or not a ULID → `VALIDATION_FAILED` with `issues: [{ path: 'headers.idempotency-key', … }]`, R39). `request_hash = sha256hex(canonicalJson({ method, path, body }))`, `path` filled. One transaction: `INSERT … ON CONFLICT DO NOTHING RETURNING`; no row → stored row: same hash → replay (roll back); different → `422 IDEMPOTENCY_KEY_MISMATCH { idempotency_key }`. On success `UPDATE` `response_status`, `response_body` before COMMIT. **After COMMIT**, in its own statement: `await testHooks?.beforePrune?.()`, then `DELETE FROM idempotency_keys WHERE ctid IN (SELECT ctid FROM idempotency_keys WHERE tenant_id = $1 AND created_at < $2 LIMIT 100 FOR UPDATE SKIP LOCKED)`; a prune error is logged at `error` and the result returned unchanged. Queries through `TenantLevelRepository`.

- [ ] **Step 1: Tests.** Register `POST /v1/test/floors/:branch_id` in the test file (inserts a `floors` row through `withIdempotency`; name `"dup"` → `CONFIG_NAME_TAKEN`). `[01a §10 #9]`, `#10`, `#11`, `#12`, `#13`, `#14`, `#122` as §10.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 15 cloud idempotency keys [spec S7, M69]`

### Task 16: Cloud `bumpConfigVersion` and `writeConfigAudit` — needs Docker Postgres

**Files:** Create `apps/cloud/src/lib/config-version.ts`, `apps/cloud/src/lib/config-audit.ts`, `apps/cloud/test/lib/config-version.int.test.ts`.

Both take a `TenantSql` (R2, R3). Neither imports `SystemContext` or the db client. Branch scope: `UPDATE branches SET config_version = config_version + 1 WHERE tenant_id = $1 AND branch_id = $2 RETURNING …`. Tenant scope: `SELECT branch_id FROM branches WHERE tenant_id = $1 ORDER BY branch_id FOR UPDATE`, then `UPDATE … WHERE tenant_id = $1 RETURNING …` (S40 N3). In this task `ownerUserId` is accepted but not checked (task 33 adds the owner-row check). `writeConfigAudit` inserts one row (`audit_id = ids.next()`, `at = clock.branchNow()`).

- [ ] **Step 1: Tests:** `[01a §10 #8]`; `[01a S8] tenant scope bumps all 3 branches`; `[01a S26] writeConfigAudit stores actor, entity, before/after; cli actor stores null user`; `[01a S26] auditActionFor`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 16 config version bump and audit writer [spec S8, S26]`

### Task 17: Cloud test infrastructure — needs Docker Postgres

**Files:** Create `apps/cloud/test/helpers/restaurant.ts`, `apps/cloud/test/helpers/pg-counter.ts`, `apps/cloud/test/helpers/pg-counter.int.test.ts`; Modify `apps/cloud/test/helpers/test-cloud.ts` (option `testHooks`, R6), `apps/cloud/src/server.ts` (`CloudDeps.testHooks?: CloudTestHooks`), `apps/cloud/test/cross-tenant.int.test.ts`.

```ts
export interface RestaurantFixture { tenantId: string; userId: string; branches: [string, string, string]; token: string; tokenFor(branchIds: string[]): string; branchKey: string; other: { tenantId: string; userId: string; branchId: string; token: string } }
export async function restaurantFixture(cloud: TestCloud): Promise<RestaurantFixture>; // truncateAll; seedTenant ×2; issueRegistrationCode ×3 (+1 for B); /v1/hubs/register for A
export function owner(f: RestaurantFixture, token?: string): { headers: Record<string, string> };   // authorization + fresh idempotency-key
export function pgCounter(pool: pg.Pool): { readonly count: number; reset(): void };
```
`cross-tenant.int.test.ts`: `ROUTE_CASES: Record<string, (ids) => { url: string; payload?: unknown }>` keyed `"METHOD /url"`, today's two routes; its keys equal the jwt/branch-key routes; a tenant B `config_audit` row and its `audit_id` in `bIds` (R26).

- [ ] **Step 1: Tests:** `[01a §10 test infra] pgCounter counts statements on pool.query and on connected clients, not BEGIN/COMMIT`; the refactored cross-tenant test passes with the two 00 routes.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 17 cloud test fixtures and route cases [spec §10, D54]`

### Task 18: Cloud floors GET/POST — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/restaurant/{routes,service,repository,schemas}.ts`, `apps/cloud/test/restaurant/floors.int.test.ts`; Modify `apps/cloud/src/server.ts`, `apps/cloud/test/cross-tenant.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #16]`, `#17`, `#23`, `#80`; Review Focus 1: `[01a §3.3] " ground " is stored as "ground" and duplicates "Ground"`; `[01a S8] create floor bumps only that branch`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 18 floors list and create [spec §6.2, §6.3, §6.0, S26]`

### Task 19: Cloud floor PATCH — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`, `apps/cloud/test/restaurant/floors.int.test.ts`.

The service calls `await deps.testHooks?.beforeBump?.()` right before `bumpConfigVersion`. PATCH rules on the merged row (§3.3).

- [ ] **Step 1: Tests:** `[01a §10 #18]`, `#19`, `#83`; `[01a §6.4] restore checks name uniqueness`; `[01a §6.4] rename → 200, audited update, branch bumped`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 19 floor patch [spec §6.4, S22, S26]`

### Task 20: Cloud snapshot builder — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/config-sync/builder.ts`, `apps/cloud/test/config-sync/builder.int.test.ts`; Modify `apps/cloud/test/helpers/restaurant.ts` (`seedMenu(pool, f, o)`: floors, tables, stations, programs, tax classes, categories, items (with units, thresholds, `carries_over`), routes and windows by SQL; archived rows on request; returns ids).

7 fixed statements (floors ⋈ tables; stations ⋈ programs; tax classes; categories; items ⋈ routes for this branch; item and category windows in one statement; the header is passed in). Active rows only, except stations, programs and tax classes (S22). Arrays by `sort_order`, then id; tax classes and programs by name, then id; windows by `start_ms, end_ms, window_id` (nit 4). `BIGINT` → `Number()`; then `BranchConfigSnapshotSchemaV1.parse` (no coercion); then the wire object (S27).

- [ ] **Step 1: Tests:** `[01a §10 #4]`, `#5` (`pgCounter`: ≤ 13 and equal for 10 and 300 items), `#85`; `[01a S47] two windows with the same start are ordered by end`; `[01a S33] the header's day settings are in the snapshot`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 20 snapshot builder [spec §6.1, §4.3, S22, S27, S47]`

### Task 21: Cloud `GET /v1/sync/config` — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/config-sync/{routes,service,schemas}.ts`, `apps/cloud/test/config-sync/sync-config.int.test.ts`; Modify `apps/cloud/src/server.ts`, `apps/cloud/test/cross-tenant.int.test.ts`.

Script §6.1. First line `deps.testHooks?.handlerStart?.('GET /v1/sync/config')` (the guard's key lookup is not counted, R9). Query `config_version` / `directory_version` int ≥ 0 (`z.coerce`). Everything after the guard inside `inTransaction(pool, fn, { isolation: 'REPEATABLE READ', readOnly: true })`, including statement (1) (`config_version, tax_enabled, day_stale_after_hours, day_min_gap_hours, directory_version, currency_code`). `304` via `reply.code(304).send()`. `snapshot_hash = sha256hex(canonicalJson(wire))`; the response sends `wire`; response schema `config.snapshot: z.record(z.string(), z.unknown())`. No gzip yet (task 22).

- [ ] **Step 1: Tests:** `[01a §10 #1]`, `#2`, `#3`, `#6`, `#114` (as §10; the hub-style check over the response text).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 21 config sync endpoint [spec §6.1, S4, S27, S28]`

### Task 22: Cloud sync gzip — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/config-sync/routes.ts`; Create `apps/cloud/test/config-sync/sync-gzip.int.test.ts`.

S48 b, nit 2: build `const body = JSON.stringify({ data })` once from `wire`. Request `Accept-Encoding` includes `gzip` → `reply.header('content-encoding', 'gzip').header('content-type', 'application/json; charset=utf-8').send(gzipSync(body))` (`node:zlib`); otherwise send the same `body` string with the same content type. `304` unchanged.

- [ ] **Step 1: Tests:** `[01a S48] with Accept-Encoding gzip the 200 has content-encoding gzip and gunzips to exactly the plain body; its hash matches snapshot_hash`; `[01a S48] without Accept-Encoding the body is plain JSON; a 304 has no content-encoding`. (Test #140, which also needs the hub poller, is in task 39.)
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 22 gzip config sync response [spec S48, §6.1]`

### Task 23: Cloud tables — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/tables.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #20]`, `#21`, `#22`, `#118`; `[01a §6.6] moving a table to another branch's floor → 422 wrong_branch`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 23 tables [spec §6.5, §6.6, S22, S26]`

### Task 24: Cloud stations — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/stations.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #24]`, `#25`, `#26`, `#27`; `[01a S10] "Fryer" twice in one branch → 409; in another branch → 201`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 24 stations [spec §6.8, §6.9, S10, S22]`

### Task 25: Cloud batch programs — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/programs.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #28]`, `#29`, `#30`, `#119`; `[01a §6.10] archiving a program used as program_id → 409`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 25 batch programs [spec §6.10]`

### Task 26: Cloud tax classes and categories — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/tax-categories.int.test.ts`.

Tenant-level, bump every branch (tenant scope with the JWT `sub` as `ownerUserId`), `branch_id` null in audit. Categories accept `availability_windows` in the body schema but this task writes none (task 31).

- [ ] **Step 1: Tests:** `[01a §10 #31]`, `#32`, `#120`; `[01a S8] a category create bumps all three branches`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 26 tax classes and categories [spec §6.12, §6.13]`

### Task 27: Cloud owner-row read helper — needs Docker Postgres

**Files:** Modify `apps/cloud/src/lib/config-version.ts` (`coversEveryBranch(db, ownerUserId)`: one statement `SELECT bool_and(b.branch_id = ANY(o.allowed_branch_ids)) FROM branches b JOIN owner_users o ON o.tenant_id = b.tenant_id AND o.user_id = $2 WHERE b.tenant_id = $1`), `apps/cloud/test/lib/config-version.int.test.ts`.

S8 (review 2 S-6): the owner's allowed branches come from `owner_users`, never the JWT claim. `TenantLevelRepository` exception recorded in §5.2.

- [ ] **Step 1: Tests:** `[01a S8] coversEveryBranch true for an owner row with A, B, C; false after removing C from the row by SQL; one statement`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 27 owner allowed branches from the database [spec S8]`

### Task 28: Cloud menu-item POST — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/menu-items.int.test.ts`.

§6.14 of v1.0. Body: `tax_class_id: z.string().nullable()` as a required key (review 1 nit 3); `stock_unit?`, `sale_unit?`, `stock_per_sale_unit?` (defaults `piece`, `piece`, 1), `low_stock_threshold?` (default null), `carries_over?` (default false). The schema has **no** `availability_windows` in this task; task 31 adds it. Units rule of §3.3 checked in the service (`400 VALIDATION_FAILED` with the field path). References locked `FOR SHARE` in id order with `= ANY($ids)`; item and routes in one multi-row `INSERT` each. A route branch outside `allowed_branch_ids` → `404 BRANCH_NOT_FOUND`, nothing written.

- [ ] **Step 1: Tests:** `[01a §10 #33]`, `#34`, `#35`, `#36`, `#37` (equal counts for 1 and 3 routes), `#41`, `#88`; `[01a §6.14] a body without the tax_class_id key → 400`; `[01a S44] g / piece / 250 → 201 and the three fields in the response`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 28 menu item create [spec §6.14, S11, S34, S44, S46]`

### Task 29: Cloud menu read — search, pages, `can_edit_tenant` — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/menu-read.int.test.ts`.

§6.11 of v1.0: query `q?`, `category_id?`, `status?` (`active` default, `archived`), `cursor?` (base64url JSON `{ n: lower(name), id }`), `limit?` 1…200 default 50. 6 statements: `coversEveryBranch` (task 27), tax classes, categories with windows, items page `WHERE (lower(name), item_id) > ($n, $id) … ORDER BY lower(name), item_id LIMIT limit + 1` (ILIKE with `%`, `_`, `\` escaped), page windows `= ANY($ids)`, page routes `= ANY($ids)`. Bad cursor → `400`.

- [ ] **Step 1: Tests:** `[01a §10 #40]`, `#138`, `#139` (server part; the read-only page is `#139 page part` in task 66).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 29 owner menu read with search and pages [spec §6.11, S8, S48]`

### Task 30: Cloud menu-item PATCH — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/menu-patch.int.test.ts`.

§6.15. Rules on the merged row (§3.3), after the row lock: a lowered `cook_time_ms` below the stored `stock_time_ms` → `422`; `sale_unit 'g'` alone onto `piece` / `piece` → `400`; never a CHECK `500`.

- [ ] **Step 1: Tests:** `[01a §10 #7]`, `#38`, `#81`, `#106`, `#107`, `#121`, `#128` ("in the snapshot" = poll `GET /v1/sync/config` with branch A's key).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 30 item patch [spec §6.15, §3.3, S26, S32, S34, S44]`

### Task 31: Cloud availability windows — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*` (item POST/PATCH and category POST/PATCH bodies gain `availability_windows`; POST inserts one multi-row `INSERT`; PATCH with the field deletes the target's rows and inserts the new set in the transaction; `before` / `after` audit include the array), `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/windows.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #135]` exactly as §10 (item and category).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 31 availability windows on items and categories [spec S47, §6.13–6.15]`

### Task 32: Cloud route PUT — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/routes-put.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #39]`, `#82`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 32 item route put [spec §6.16, S26]`

### Task 33: Cloud tenant-wide write guard from the database — needs Docker Postgres

**Files:** Modify `apps/cloud/src/lib/config-version.ts` (tenant scope: first `SELECT allowed_branch_ids FROM owner_users WHERE tenant_id = $1 AND user_id = $2` when `ownerUserId` is set, then the locking `SELECT`; a branch not in the row → `throw new DomainError('PERMISSION_DENIED', { reason: 'tenant_wide_write' })`; CLIs pass `null` and skip the check), `apps/cloud/test/lib/config-version.int.test.ts`; Create `apps/cloud/test/restaurant/tenant-wide.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #117]` (owner row limited to A by SQL, so the database, not the token, decides); `[01a §10 #153]` exactly as §10 (an old token still works after `issueRegistrationCode` adds D; a row lacking D with a token listing A–D → `403`); `[01a S8] the 403 writes nothing, no audit row, no key stored`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm vitest run apps/cloud/test/restaurant` green → commit `feat(01a): task 33 tenant-wide writes checked against owner_users [spec S8, D30]`

### Task 34: Cloud lock-order races — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/service.ts` (`afterTargetLock`, `afterReferenceLock` hooks); Create `apps/cloud/test/restaurant/races.int.test.ts`.

Barrier: request 1's hook awaits a promise the test resolves once request 2 is blocked (poll `pg_stat_activity.wait_event_type = 'Lock'` for up to 2 000 ms).

- [ ] **Step 1: Tests:** `[01a §10 #86]` both orders; `[01a §10 #87]` both orders plus two concurrent item creates committing; no `40P01`.
- [ ] **Step 2–5:** run → FAIL (or hang → fix lock order per S8) → PASS → commit `feat(01a): task 34 config write lock order [spec S8, §5.2]`

### Task 35: Cloud CLI `set-branch-settings` — needs Docker Postgres

**Files:** Create `apps/cloud/src/cli/set-branch-settings.ts`, `apps/cloud/test/cli/set-branch-settings.int.test.ts`; Modify `apps/cloud/package.json` (script `set-branch-settings`: `tsx src/cli/set-branch-settings.ts`).

§6.7 of v1.0. Inside `sys.tx`: `SELECT tenant_id, tax_enabled, day_stale_after_hours, day_min_gap_hours FROM branches WHERE branch_id = $1 FOR UPDATE`; merge the given options; check ranges and **stale > gap** on the merged values (else error, exit 1, nothing written); update; `writeConfigAudit` (`branch_settings` / `update`, `actor_kind 'cli'`); `bumpConfigVersion` branch scope (R3). Options: `--branch` (required), `--tax-enabled true|false`, `--day-stale-after-hours <n>`, `--day-min-gap-hours <n>`; at least one setting; any other option (e.g. `--business-day-start`) → usage error, exit 1.

- [ ] **Step 1: Tests:** `[01a §10 #105]`, `#108`, `#154`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 35 set-branch-settings CLI [spec §6.7, S33, S34, M56]`

### Task 36: Cloud CLI `restore-bump` — needs Docker Postgres

**Files:** Create `apps/cloud/src/cli/restore-bump.ts`, `apps/cloud/test/cli/restore-bump.int.test.ts`; Modify `apps/cloud/package.json` (script `restore-bump`).

§6.7a, S42. Inside `sys.tx`: `SELECT directory_version FROM tenants WHERE tenant_id = $1 FOR UPDATE` (none → "unknown tenant", exit 1); old values read first, then `UPDATE branches SET config_version = GREATEST(config_version + 1, $2) WHERE tenant_id = $1 RETURNING branch_id, config_version` and `UPDATE tenants SET directory_version = GREATEST(directory_version + 1, $2) WHERE tenant_id = $1 RETURNING directory_version`; `$2 = deps.clock.branchNow()`; no `config_audit` row; prints old and new values.

- [ ] **Step 1: Tests:** `[01a §10 #123]` (cloud part as §10; the hub's forward-only apply is task 39's `[01a S42]` test).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 36 restore-bump CLI [spec S42, §6.7a, M56]`

### Task 37: Hub migration 0004 and projections

**Files:** Create `apps/hub/src/db/migrations/0004_restaurant_config.sql` (verbatim §5.1), `apps/hub/src/sync/branch-config-holder.ts` (the `ConfigEntry` type only), `apps/hub/src/projections/branch-config.ts`, `apps/hub/src/projections/item-availability.ts`, `apps/hub/test/projections/restaurant-projections.int.test.ts`; Modify `apps/hub/src/lib/boot.ts` (`registerRestaurantProjections(projections)` in `createDeps`), `apps/hub/test/helpers/test-hub.ts`, `apps/hub/test/helpers/big-fixture.ts` (also checkpoints `branch_config` and `item_availability` at `n`, R4), `apps/hub/test/boot/boot-budget.int.test.ts` (decoy step advances them to `N + 1`).

`branch_config`: upsert from the payload, `applied_at = recorded_at`. `item_availability`: `ItemMadeUnavailable` → 0, `ItemMadeAvailable` → 1, `changed_at = recorded_at`. Both have `reset`. No business-day table (the day is in `EngineState`, S33). First boot after 0004 replays once (S40 N12).

- [ ] **Step 1: Tests:** `[01a §10 #49]`; `[01a §5.1] projection times = recorded_at`; `[01a S5] loadBranchConfig returns NONE, BODY_MISSING and APPLIED`; `[01a §4.2] itemAvailability(db, [])` → empty map, 0 statements.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 37 hub config and availability projections [spec §5.1, S5, S17]`

### Task 38: Hub config holder and HTTP client

**Files:** Modify `apps/hub/src/sync/branch-config-holder.ts`; Create `apps/hub/src/sync/branch-config-holder.test.ts`, `apps/hub/src/sync/config-client.ts`, `apps/hub/src/sync/config-client.test.ts`, `apps/hub/test/helpers/stub-config-cloud.ts`.

`httpConfigClient` (pattern `setup/cloud-client.ts`): `GET {root}/v1/sync/config?config_version=…&directory_version=…`, `authorization: Bearer <key>`, `accept-encoding: gzip`, `AbortSignal.timeout(timeoutMs)` default **30 000** (S48); `304` → `not_modified`; `200` → `ok` with `await response.text()` (fetch decompresses gzip; never `json()`); fetch error, timeout or `5xx` → `offline`; `4xx` → `error`. `stub-config-cloud.ts` as before (`stubConfigCloud(): ConfigClient & { calls; next; respondWithSnapshot(snapshot, o?) }`).

- [ ] **Step 1: Tests** (replace `globalThis.fetch` in `beforeEach`, restore in `afterEach`): `[01a §3.4] 304 → not_modified; 200 → ok with the exact body text; 503 and a thrown fetch → offline; 401 → error with code`; `[01a §3.4, S48] the request carries exactly config_version and directory_version, Accept-Encoding gzip, and a 30 000 ms timeout by default`; `[01a S48] a real gzip response from a local node:http server decodes to the original text`; holder: `[01a §4.2] swapBranchConfig then branchConfig returns it; null resets`.
- [ ] **Step 2–5:** `pnpm vitest run apps/hub/src/sync` → FAIL → implement → PASS → commit `feat(01a): task 38 hub config holder and cloud client [spec §3.4, §4.2, S48]`

### Task 39: Hub `pollOnce` core — needs Docker Postgres

**Files:** Create `apps/hub/src/sync/config-poller.ts`, `apps/hub/test/sync/poller.int.test.ts`, `apps/cloud/test/config-sync/sync-gzip-e2e.int.test.ts` (cloud project, so Postgres is up; imports the hub's `httpConfigClient`, `createConfigPoller` and `createTestHub` by relative path, as task 59's helper test does); Modify `apps/hub/src/server.ts` (`HubDeps.configClient?`; the poller with `setDirectory: (d) => swapDirectory(app, d)`, `log: app.log`), `apps/hub/test/helpers/test-hub.ts` (option `configClient`, default a stub returning `offline`; `swapBranchConfig(null)` on create).

§3.4 steps 1–6. Step 1 skip → `not_ready`, no HTTP call (S40 N4). One in-flight promise. Step 4: envelope failure → `malformed`, logged with issue paths and codes only; (i) hash over `canonicalJson(raw)`; (iv) forward only. Hash and Zod parse run **before** `writer.run` (S48 d). A parsed snapshot with more than 1 000 items logs `warn` once per apply (§12.4 trigger). Apply in one `writer.run`: `INSERT OR IGNORE INTO config_snapshots`, append `BranchConfigApplied`, `tx.onCommit(() => swapBranchConfig(entry))`; directory part `applyStaffDirectory(tx, directory, setDirectory)` in the same `writer.run`. Tests create the hub confirmed (R13).

- [ ] **Step 1: Tests:** `[01a §10 #42]`, `#43`, `#44`, `#45`, `#53`, `#54`, `#95`, `#126`; in the cloud e2e file `[01a §10 #140]` (5 000-item `seedMenu`; cloud on port 0; ≤ 13 statements; the hub poller's real `fetch` gets a gzip `200`, the hash verifies and the config applies; without the header the body is plain); `[01a §3.4, S40 N4] an unconfirmed hub makes no HTTP call and records not_ready`; `[01a S42] versions far above the hub's (after restore-bump) are applied`; `[01a §7.3] log levels and no snapshot body in the logs`; `[01a §12.4] a 1 001-item snapshot logs one warn`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 39 hub config poll and apply [spec §3.4, S5, S6, S28 d, §7.3]`

### Task 40: Hub poller — schema version, stored-body format, commit failure

**Files:** Modify `apps/hub/src/sync/config-poller.ts`; Create `apps/hub/test/sync/poller-schema.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #46]`, `#94`; `[01a S28 b] snapshot_schema_version 2 → schema_unsupported, no event, old config kept`; `[01a S28 b] a branch_config row with version 2 → the poll sends config_version=0 and applies once`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 40 snapshot schema version rules [spec S28, S29]`

### Task 41: Hub `onBranchConfigApplied`

**Files:** Modify `apps/hub/src/sync/branch-config-holder.ts`, `apps/hub/src/sync/config-poller.ts`; Create `apps/hub/test/sync/config-hook.int.test.ts`.

- [ ] **Step 1: Test:** `[01a §10 #58]`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 41 branch config applied hook [spec §4.2, S40 N2]`

### Task 42: Hub apply failure — visible problem, parts retried alone

**Files:** Modify `apps/hub/src/sync/config-poller.ts` (S43; `applyDirectory` dep); Create `apps/hub/test/sync/poller-apply-failure.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #50]`, `#115`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 42 visible apply failure and per-part retry [spec S43, §3.4]`

### Task 43: Hub directory through the poll

**Files:** Create `apps/hub/test/sync/poller-directory.int.test.ts`; Modify `apps/hub/src/sync/config-poller.ts` only if a test fails.

- [ ] **Step 1: Tests:** `[01a §10 #51]`, `#52`.
- [ ] **Step 2–5:** run. If they pass on the first run, show the output and say so; otherwise implement → PASS → commit `feat(01a): task 43 staff directory through the config poll [spec S6, R14, M38]`

### Task 44: Hub engine state through `createDeps`, reducer, boot fold, `stock_version`

**Files:** Create `apps/hub/src/sync/boot-steps.ts`, `apps/hub/src/sync/stock-version.ts`, `apps/hub/test/boot/engine-fold.int.test.ts`; Modify `apps/hub/package.json` (`"@pos/engine": "workspace:*"`), `pnpm-lock.yaml`, `apps/hub/src/lib/boot.ts`, `apps/hub/src/main.ts` (call `registerRestaurantBootSteps()` before `boot`), `apps/hub/src/setup/issue-admin-bootstrap.ts:44–45`, `apps/hub/test/helpers/test-hub.ts`, `apps/hub/src/server.ts` (`HubDeps.state: StateHolder<EngineState>`), `apps/hub/src/commands/registry.ts`, `apps/hub/src/commands/route.ts:102` (R8), `apps/hub/src/queries/registry.ts` (`QueryCtx.state`, `QueryCtx.branchConfig`). Read, do not change: `apps/hub/src/engine-host/writer.ts`.

S15, §2: `BootContext.initialState?`; `createDeps(…, initialState?)` builds `createStateHolder(initialState ?? {})` + `setReducer(applyEvent)` in place of `boot.ts:278–279`; its `publish` wrapper calls `noteCommitted(events)` before `publishSlot`. Step `'3'`: `const { state, stockVersion } = foldEngineEvents(ctx.db, branchId)` → `ctx.initialState = state`, `setStockVersion(stockVersion)`. `foldEngineEvents` selects `WHERE branch_id = ? AND (stream_type = 'stock' OR (stream_type = 'hub' AND event_type IN ('BusinessDayOpened','BusinessDayClosed'))) ORDER BY seq` (uses `events_stream`, R34); no extra boot query for `stock_version` (§6.19).

- [ ] **Step 1: Tests:** `[01a §10 #67]`, `[01a §10 #93]`; `[01a §2] with no step-3 handler the state is {} as before`; `[01a S33] a BusinessDayOpened and BusinessDayClosed in the log are folded at boot`; `[01a §6.19] stockVersion after boot equals the last stock-stream or business-day event's seq; noteCommitted moves it after a commit and ignores other events`; `[01a S15] main.ts registers the restaurant boot steps`.
- [ ] **Step 2–5:** `pnpm install`; run → FAIL → implement → PASS; `pnpm typecheck && pnpm test` → commit `feat(01a): task 44 engine state via createDeps and boot fold [spec S15, S16, S33, §2, §6.19]`

### Task 45: Hub boot config load after catch-up, `BODY_MISSING`, poll timer

**Files:** Modify `apps/hub/src/sync/boot-steps.ts` (step `'5'` load; step `'6'` start + `onClose` stop), `apps/hub/src/sync/config-poller.ts` (`stop()` marks the poller stopped), `apps/hub/src/lib/boot.ts` (`BootOptions.configClient`); Create `apps/hub/test/sync/poller-boot.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #47]`, `#48` (append `BranchConfigApplied` without its body, R32), `#124`; Review Focus 5: `[01a §7.2] after stop() no poll runs and a late in-flight result does not swap`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 45 hub config boot after catch-up and poll timer [spec S5, S15, §3.2, §7.2]`

### Task 46: Hub station validator

**Files:** Create `apps/hub/src/sync/station-validator.ts`, `apps/hub/test/sync/station-validator.int.test.ts`; Modify `apps/hub/src/server.ts`.

- [ ] **Step 1: Test:** `[01a §10 #57]`. Body exactly §6.22.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 46 station validator from branch config [spec §6.22, M31]`

### Task 47: Hub `OpenBusinessDay`

**Files:** Create `apps/hub/src/commands/open-business-day.ts`, `apps/hub/test/commands/business-day.int.test.ts`; Modify `apps/hub/src/server.ts`.

§6.18a: `sessionKind: 'admin'`, `manage-stock`, payload `{}` (strict). Open day → no event, `reason: 'already_open'`. Else `BusinessDayOpened { business_date, units }`: `business_date` = the hub's local `YYYY-MM-DD` of `clock.branchNow()` (`new Date(now)` local getters); `units` for every stock-tracked item in `branchConfig()` (empty with no config). Result per §6.18a.

- [ ] **Step 1: Tests:** `[01a §10 #133]` (server part; the Start day action is `#133 page part` in task 70).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 47 open business day [spec §6.18a, S33, S44]`

### Task 48: Hub `CloseBusinessDay`

**Files:** Create `apps/hub/src/commands/close-business-day.ts`; Modify `apps/hub/src/server.ts`, `apps/hub/test/commands/business-day.int.test.ts`.

§6.18b: none open → `not_open`; `now − opened_at < day_min_gap_hours × 3 600 000` (snapshot value, else `DEFAULT_DAY_MIN_GAP_HOURS`; negative age counts as recent) → `opened_recently`; else `BusinessDayClosed {}`.

- [ ] **Step 1: Tests:** `[01a §10 #143]`, `#144`, `#145` (all of §10 except its last clause, the push to staff sockets, which task 55 tests as `[01a §4.5]` once the audiences exist).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 48 close business day [spec §6.18b, S33]`

### Task 49: Hub `SetPrecookedStock`

**Files:** Create `apps/hub/src/commands/set-precooked-stock.ts`, `apps/hub/test/commands/set-precooked-stock.int.test.ts`; Modify `apps/hub/src/server.ts`.

§6.17 of v1.0. Validate **all** entries before any event. No open day (`openDayStartMs(ctx.state) === null`) → `409 BUSINESS_DAY_NOT_OPEN` (after the item checks of §6.17's order). One `StockSet { item_id, on_hand, unit: dayUnits(state, item).stock_unit }` per entry, even for an equal value. Result with `available`, `level`, `set_at = ctx.clock.branchNow()` (S40 N8). Test setup opens a day through `OpenBusinessDay`.

- [ ] **Step 1: Tests:** `[01a §10 #59]`, `#60`, `#61`, `#62`, `#63`, `#64`, `#65`, `#134`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 49 set pre-cooked stock [spec §6.17, S14, S18, S33, S41]`

### Task 50: Hub `AddPrecookedStock`

**Files:** Create `apps/hub/src/commands/add-precooked-stock.ts`, `apps/hub/test/commands/add-precooked-stock.int.test.ts`; Modify `apps/hub/src/server.ts`.

§6.17a: same checks and `409`; per entry `countIsValid(stockOf(state, id), openDayStartMs(state), { carries_over: item.carries_over, stock_unit: dayUnits(state, item).stock_unit })` → `StockAdded`, else `StockSet { on_hand: quantity }`; `recorded_as` in the result.

- [ ] **Step 1: Tests:** `[01a §10 #130]` exactly as §10.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 50 add pre-cooked stock [spec §6.17a, S45]`

### Task 51: Hub business day across restart; units frozen per day

**Files:** Create `apps/hub/test/commands/business-day-restart.int.test.ts`; Modify only if a test fails: `apps/hub/src/sync/boot-steps.ts`, `apps/hub/src/commands/{open-business-day,set-precooked-stock,add-precooked-stock}.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #147]`, `#149` (the stock query part of #149 reads `stockOf` and `dayUnits` directly until task 53; the query assertions are repeated in task 53's `[01a S44]` test).
- [ ] **Step 2–5:** run → if they pass on the first run, show the output and say so; otherwise implement → PASS → commit `feat(01a): task 51 business day across restart and frozen units [spec S33, S44]`

### Task 52: Hub `SetItemAvailability` and `itemAvailability`

**Files:** Create `apps/hub/src/commands/set-item-availability.ts`, `apps/hub/test/commands/set-item-availability.int.test.ts`; Modify `apps/hub/src/server.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #69]`, `#70`, `#71`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 52 item availability [spec §6.18, S17]`

### Task 53: Hub stock query — versions, parts, `day_stale`, `hub_time`

**Files:** Create `apps/hub/src/queries/stock.ts`, `apps/hub/src/lib/hub-time.ts`, `apps/hub/src/lib/hub-time.test.ts`, `apps/hub/test/queries/stock.int.test.ts`; Modify `apps/hub/src/server.ts`.

§6.19 of v1.0. Resource `stock`, `sessionKind: 'admin'`, `session: 'none'` (R43); handler checks `manage-stock` else `403`. `meta_version = \`${config_version}.${openDayStartMs(state) ?? 0}\``; `stock_version()`; both equal → `{ unchanged: true, … }` with 0 statements; `items_meta` when `meta_version` differs; `items` (1 statement on `item_availability`) when either differs. `day_stale` from `day_stale_after_hours` (snapshot, else default). `hub_time = hubTime(ctx.clock)`; `hub_local_date`. No `in_window` field (the page computes it, S47).

- [ ] **Step 1: Tests:** `[01a §10 #72]`, `#103` (server part), `#116`, `#131`, `#132` (server part), `#142`, `#146` (server part), `#152`; `[01a S44] after a unit change mid-day the query shows the frozen unit and stock_per_sale_unit`; `[01a §6.19] an admin without manage-stock → 403`; `hub-time.test.ts`: `[01a S47] hubTime gives now_ms and utc_offset_ms 18000000 under TZ=Asia/Karachi`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 53 stock query with versions and hub time [spec §6.19, S30, S33, S41, S46, S47]`

### Task 54: Hub config status

**Files:** Create `apps/hub/src/queries/config-status.ts`, `apps/hub/test/queries/config-status.int.test.ts`; Modify `apps/hub/src/server.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #56]`, `#102` (server part); `[01a §6.21] not_ready on an unconfirmed hub`; `[01a §6.21] apply_failed reason`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 54 config status [spec §6.21, S29, S43]`

### Task 55: Hub WS audiences and catch-up parts

**Files:** Create `apps/hub/src/ws/restaurant-audiences.ts`, `apps/hub/src/ws/restaurant-catch-up.ts`, `apps/hub/test/ws/restaurant-ws.int.test.ts`; Modify `apps/hub/src/server.ts`.

§4.5 of v1.0: audiences for `BranchConfigApplied` (staff + station), `ItemMade*`, `StockSet`, `StockAdded`, `BusinessDayOpened`, `BusinessDayClosed` (staff). Catch-up `branch_config` = `{ config_version, snapshot_hash, hub_time } | null`; `stock` = `{ business_day (with units), business_day_started_at, items: { on_hand, reserved, set_at, unit, available, level } }`.

- [ ] **Step 1: Tests:** `[01a §10 #73]`, `#89`, `#90` (fake timers), `#91`; `[01a §4.5] BusinessDayClosed reaches staff sockets, not station sockets (#145 push clause)`; `[01a S47] the catch-up branch_config part carries hub_time`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 55 restaurant ws pushes and catch-up [spec §4.5, S33, S41, S46, S47]`

### Task 56: Hub `GET /queries/branch-config` with `hub_time`

**Files:** Create `apps/hub/src/queries/branch-config.ts`, `apps/hub/test/queries/branch-config.int.test.ts`; Modify `apps/hub/src/server.ts`.

`defineQuery({ resource: 'branch-config', sessionKind: 'device', session: 'required', allowStation: true, … })` → `{ data: { config_version, snapshot_hash, snapshot, hub_time } }` or `{ data: null }`.

- [ ] **Step 1: Tests:** `[01a §10 #92]`, `#151`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 56 branch config query with hub time [spec §6.23, S47]`

### Task 57: `apps/client` scaffold, build, ULID helper

**Files:** Create `apps/client/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts}`, `apps/client/owner/index.html`, `apps/client/admin-stock/index.html`, `apps/client/src/app/{router.ts,mount.tsx,ui-kit.ts,ulid.ts,router.test.tsx,ulid.test.ts}`, `apps/client/src/features/owner/main.tsx`, `apps/client/src/features/admin/stock/main.tsx`, `apps/client/src/i18n/{en.ts,index.ts}`, `apps/client/test/setup.ts`, `apps/client/test/build-output.test.ts`; Modify root `package.json` (`"test": "pnpm --filter @pos/client build && vitest run"`; `engines.node` `">=22.22.2 <23"`), `.gitignore` (`apps/client/dist/` if not ignored), `pnpm-lock.yaml`.

- `package.json`: `"name": "@pos/client"`, private, `"type": "module"`, deps exactly S35 g plus `@pos/domain`, `@pos/events`, `@pos/engine` (`workspace:*`); scripts `"build": "vite build --mode owner && vite build --mode admin-stock"`, `"typecheck": "tsc --noEmit"`.
- `vite.config.ts`: per mode `root` `./<mode>/`, `base` `/owner/` or `/admin/stock/`, `build: { outDir: ./dist/<mode>/, emptyOutDir: true, manifest: true, assetsInlineLimit: 0 }`; any other mode throws. No plugin.
- `tsconfig.json` (R21): standalone, `strict`, `ES2023`, `ESNext`, `Bundler`, `jsx react-jsx`, `lib ["ES2023","DOM","DOM.Iterable"]`, `types []`, `noEmit`, `skipLibCheck`, `include ["src"]`, tests excluded.
- `vitest.config.ts`: `environment: 'jsdom'`, `setupFiles: ['./test/setup.ts']` (`IS_REACT_ACT_ENVIRONMENT = true`, R23).
- `src/app/ui-kit.ts`: `import '../../../../packages/ui-kit/tokens.css'; import '../../../../packages/ui-kit/components/bundle.css';` — the only CSS imports (S35 d, R14).
- `src/app/ulid.ts`: `newUlid(nowMs = Date.now())`, `crypto.getRandomValues`, Crockford base32 (method of `apps/hub/src/auth/pair-page.ts:207`).

- [ ] **Step 1: Tests:** `[01a S35 b] useHashRoute follows hashchange`; `[01a §10 #125]`; `build-output.test.ts` (`// @vitest-environment node`, R22): `[01a §10 #113]`, plus `[01a S35 d] each dist has an assets/*.woff2 file` (UI kit fonts in the build, R14).
- [ ] **Step 2–4:** `pnpm install && pnpm vitest run --project @pos/client` → FAIL → implement → `pnpm --filter @pos/client build && pnpm vitest run --project @pos/client` → PASS; `pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 57 client app scaffold, build and ulid [spec S35, S39 a]`

### Task 58: `apps/client` lint rules

**Files:** Modify `eslint.config.js`; Create `apps/client/test/lint.test.ts`.

One block **last**, `files: ['apps/client/src/**/*.{ts,tsx}']` (R11):
- `'no-restricted-syntax': ['error', { selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]', message: 'S35 e' }, { selector: 'JSXAttribute[name.name="style"]', message: 'S35 d: style only from packages/ui-kit' }, { selector: 'CallExpression[callee.property.name="randomUUID"]', message: 'S35 j: use src/app/ulid.ts' }, { selector: 'CallExpression[callee.property.name="getTimezoneOffset"]', message: 'S47: use hub_time.utc_offset_ms' }]` — browser code may read the clock; do **not** add `apps/client/src/**` to the existing `'off'` list.
- `'no-restricted-imports': ['error', { paths: [{ name: '@pos/domain/hash', message: 'S27' }, { name: 'ulid', message: 'S35 j' }], patterns: [...dbClientImports.patterns, ...qrcodeImports.patterns, ...credentialLookupImports.patterns, ...systemContextImports.patterns, { group: ['node:*'], message: 'S35 f' }, { group: ['**/apps/hub/**', '**/apps/cloud/**', '**/hub/src/**', '**/cloud/src/**'], message: 'S35 f' }, { regex: '^(?!.*packages/ui-kit/).*\\.css$', message: 'S35 d' }] }]`.

- [ ] **Step 1: Tests** (`// @vitest-environment node`, `lintText(code, { filePath: 'apps/client/src/x.tsx' })`): `[01a §10 #79]`; `[01a §10 #75 page part] dangerouslySetInnerHTML fails lint`; `[01a S35 j] crypto.randomUUID() and import 'ulid' fail`; `[01a S47] getTimezoneOffset() fails in apps/client/src`; `[F §6.7] Date.now() passes in apps/client/src, fails in apps/hub/src`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm lint` → commit `feat(01a): task 58 client lint rules [spec S35 d, e, f, j, S47]`

### Task 59: `client-dist`, `admin-page` group, `/owner/*` allowlist, CSP on both — needs Docker Postgres

**Files:** Create `apps/hub/src/lib/client-dist.ts`, `apps/cloud/src/lib/client-dist.ts`, `apps/hub/test/client-dist.int.test.ts`, `apps/cloud/test/owner-pages.int.test.ts`; Modify `apps/hub/src/auth/guards.ts` (`'admin-page'` group: host, provisioned, guest), `apps/hub/test/auth/guards.int.test.ts`, `apps/hub/src/server.ts`, `apps/cloud/src/server.ts`, `apps/cloud/src/plugins/tenant-scope.ts` (`TENANT_SCOPE_ALLOWLIST` += `'GET /owner/'`, `'GET /owner/*'`), `apps/cloud/test/route-inventory.int.test.ts`.

§7.1 and S39 b: `CLIENT_DIST_DIR = fileURLToPath(new URL('../../../client/dist/<entry>/', import.meta.url))` (R18). At registration read the file list and bodies into memory; a missing dir → `app.log.error` and every path `404`; `GET <prefix>` → `index.html` (`Cache-Control: no-cache`); `GET <prefix>*` → a listed file whose extension is in the map (`assets/*` get `public, max-age=31536000, immutable`), else `404 ROUTE_NOT_FOUND` (so `.vite/manifest.json` and `../` paths are never served). Types: `.html text/html; charset=utf-8`, `.js text/javascript; charset=utf-8`, `.css text/css; charset=utf-8`, `.woff2 font/woff2`, `.svg image/svg+xml`, `.png image/png`. Every served file carries `Content-Security-Policy: CSP` on **both** apps (S21). Hub: `registerClientDist(app, { prefix: '/admin/stock/', dir: CLIENT_DIST_DIR, routeConfig: { group: 'admin-page' } })`; cloud: prefix `/owner/`, `routeConfig: { tenantScope: 'none' }`.

- [ ] **Step 1: Tests:** hub file `[01a §10 #78]` (one test runs the cases against both helpers, importing the cloud one by relative path `../../cloud/src/lib/client-dist`: temp dir with `index.html`, `assets/a1.js`, `.vite/manifest.json`; a `../` path; a missing dir; CSP on every file); cloud file `[01a §10 #15]` (real `apps/client/dist/owner/`: `/owner/` and one `assets/*.js` / `*.css` load with no JWT and carry the exact CSP; no `<script>` without `src`; `GET /ui/tokens.css` → 404; route inventory passes).
- [ ] **Step 2–5:** `pnpm --filter @pos/client build && pnpm vitest run apps/hub/test/client-dist.int.test.ts apps/hub/test/auth/guards.int.test.ts apps/cloud/test/owner-pages.int.test.ts apps/cloud/test/route-inventory.int.test.ts` → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 59 serve built client pages [spec §7.1, S21, S35 c, S39 b]`

### Task 60: `apps/hub/deploy/ship-client.sh`

**Files:** Create `apps/hub/deploy/ship-client.sh` (mode 755).

§7.8 step 5 (a)–(e) exactly; only `bash`, `git`, `tar`, `ssh`; `is-active` check before any `tar`. Checked by the runbook's release drill (task 71), not Vitest.

- [ ] **Step 1:** `bash apps/hub/deploy/ship-client.sh` → "No such file".
- [ ] **Step 2:** Write the script.
- [ ] **Step 3: Checks:** `bash -n` → no output; no argument → usage, exit ≠ 0; dirty tree → "tree is dirty", no `ssh`; no `dist` → "build output missing"; `grep -n 'is-active'` precedes any `tar`.
- [ ] **Step 4:** Commit `feat(01a): task 60 hub client ship script [spec S39 d, e, §7.8]`

### Task 61: Shared components and quantity input

**Files:** Create `apps/client/src/components/{PinPad,StaffTiles,BusyButton,Banner,QuantityInput}.tsx`, `apps/client/src/components/components.test.tsx`; Modify `apps/client/src/i18n/en.ts`.

Props: data and callbacks only (S35 i). `QuantityInput({ unit, value: number | null, onChange })` shows pieces, kg or L, parses with `parseQuantity`, `inputmode` `numeric` for pieces and `decimal` otherwise (S44). `BusyButton` slow state after 3 000 ms.

- [ ] **Step 1: Tests:** `[01a S35 i] PinPad calls onSubmit with the typed digits and clears`; `StaffTiles calls onPick`; `BusyButton disabled while busy, slow text after 3 s`; `Banner tone class`; `[01a S44] QuantityInput shows 1500 g as "1.5" with "kg" and emits 1500 for "1.5"; rejects "1.2345"`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 61 shared client components [spec S35 i, S44, §8.1]`

### Task 62: Owner money and `cloud-admin` client

**Files:** Create `apps/client/src/features/owner/money.ts`, `money.test.ts`, `apps/client/src/api/cloud-admin.ts`, `apps/client/src/api/cloud-admin.test.ts`.

`money.ts`: §8.1 / S40 N7. `cloud-admin.ts`: tokens in `sessionStorage`; typed calls for §6.2–§6.16 (menu read with `q`, `category_id`, `status`, `cursor`, `limit`); creating calls take the form's `Idempotency-Key`; one refresh on `401 JWT_INVALID`, then `onLoggedOut()`; `network` error; typed `403 PERMISSION_DENIED`.

- [ ] **Step 1: Tests:** `[01a §10 #74]`; Review Focus 2: `[01a §8.1] "Rs 1,200" and "₨1200" are rejected`; Review Focus 3: `[01a §8.1] 401 → one refresh → same Idempotency-Key; second 401 → onLoggedOut`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 62 owner money parsing and cloud client [spec §8.1]`

### Task 63: Owner shell — login, branch picker, app

**Files:** Create `apps/client/src/features/owner/login/LoginView.tsx`, `apps/client/src/features/owner/BranchPicker.tsx`, `apps/client/src/features/owner/App.tsx`, `App.test.tsx`; Modify `apps/client/src/features/owner/main.tsx`, `apps/client/src/i18n/en.ts`.

- [ ] **Step 1: Tests:** `[01a §8.1] no token shows login; a successful login shows the branch picker with the JWT's branch ids`; `[01a §8.1] a failed login shows errors.LOGIN_INVALID text`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 63 owner app shell [spec §8.1, S37]`

### Task 64: Owner floors view

**Files:** Create `apps/client/src/features/owner/floors/FloorsView.tsx`, `FloorsView.test.tsx`, `apps/client/src/features/owner/form.ts` (`useIdempotencyKey()`); Modify `App.tsx`, `apps/client/src/i18n/en.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #76]` (R37); `[01a §8.1] floors with tables, archived rows behind a toggle, sort number edit sends PATCH { sort_order }`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 64 owner floors view [spec §8.1]`

### Task 65: Owner stations view

**Files:** Create `apps/client/src/features/owner/stations/StationsView.tsx`, `StationsView.test.tsx`; Modify `App.tsx`, `apps/client/src/i18n/en.ts`.

- [ ] **Step 1: Tests:** `[01a §8.1] freshness field only for batch; programs under batch stations; a 409 shows errors.CONFIG_IN_USE text`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 65 owner stations view [spec §8.1]`

### Task 66: Owner menu list — search, Load more, read-only start

**Files:** Create `apps/client/src/features/owner/menu/MenuView.tsx`, `MenuView.test.tsx`; Modify `App.tsx`, `apps/client/src/i18n/en.ts`.

§8.1: tax classes and categories lists; items a page at a time, search box (`q` sent 300 ms after typing stops), category filter, Active / Archived switch, **Load more** while `next_cursor`; pages appended and de-duplicated by `item_id` (nit 3). `can_edit_tenant: false` → no save buttons and one info line; a `403 tenant_wide_write` on a save still shows `errors.PERMISSION_DENIED`.

- [ ] **Step 1: Tests:** `[01a §10 #75]` (render part); `[01a §10 #139 page part] can_edit_tenant false opens read-only with the info line`; `[01a §8.1, S48] typing sends one request after 300 ms; Load more appends the next page; a repeated item_id is shown once`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 66 owner menu list [spec §8.1, S8, S48]`

### Task 67: Owner item and category forms

**Files:** Create `apps/client/src/features/owner/menu/{ItemForm,CategoryForm,WindowsField}.tsx`, `ItemForm.test.tsx`; Modify `MenuView.tsx`, `apps/client/src/i18n/en.ts`.

§8.1 of v1.0: tax picker ("No tax" first and default → `tax_class_id: null`; archived classes and programs not offered); route picker per branch filtered by station type; minutes ↔ `_ms`; "When pre-cooked stock runs out"; **Stock unit / Sold by** with "Pieces per …" only when they differ, and the warning "Takes effect when the next business day starts…" on any unit change (nit 9); **Low stock alert at** in the stock unit (`QuantityInput`); **Keeps overnight**; **Available hours** (`WindowsField`: up to 4 from–to rows in HH:MM, empty = always) on items and categories.

- [ ] **Step 1: Tests:** `[01a S34] a new item defaults to No tax and sends tax_class_id null`; `[01a S11] a batch station shows the program select, a slot station hides it`; `[01a S44] g / piece shows "Pieces per …" and sends stock_per_sale_unit; changing a unit shows the next-day warning`; `[01a S46, S41] threshold 1.5 kg sends 1500; Keeps overnight sends carries_over true`; `[01a S47] 07:00–13:00 sends { 25200000, 46800000 }; a fifth row cannot be added; equal times show a field error`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 67 owner item and category forms [spec §8.1, S32, S34, S41, S44, S46, S47]`

### Task 68: `/admin/stock` — `hub-admin` client and PIN login

**Files:** Create `apps/client/src/api/hub-admin.ts`, `hub-admin.test.ts`, `apps/client/src/features/admin/stock/{StockApp,AdminLogin}.tsx`, `AdminLogin.test.tsx`; Modify `apps/client/src/features/admin/stock/main.tsx`, `apps/client/src/i18n/en.ts`.

`hub-admin.ts` calls the endpoints 00's admin pages call (read `apps/hub/src/auth/admin-session.ts` and `apps/hub/src/auth/pair-page.ts`: paths, headers, IndexedDB `pos-device` / `device`, `sessionStorage` `admin_session_token`); typed calls for §6.17, §6.17a, §6.18, §6.18a, §6.18b, §6.19 (with `meta_version`, `stock_version`), §6.21. `readDeviceToken` defaults to the IndexedDB read; tests inject it (R10). `AdminLogin` = `StaffTiles` + `PinPad`.

- [ ] **Step 1: Tests:** `[01a §8.2] no admin session shows the roster; tile + PIN stores admin_session_token and shows the stock view`; `[01a §8.2] hub-admin sends the device token and admin session headers`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 68 hub admin client and PIN login [spec §8.2, S35 i]`

### Task 69: `/admin/stock` — table, status, banner, alert bar, save, versioned poll, hours

**Files:** Create `apps/client/src/features/admin/stock/{StockTable,ConfigStatus,AlertBar}.tsx`, `badges.ts`, `apps/client/src/app/hub-clock.ts`, `StockTable.test.tsx`, `hub-clock.test.ts`; Modify `StockApp.tsx`, `apps/client/src/i18n/en.ts`.

§8.2: stock query and config status on open and every 15 000 ms while visible, sending the last `meta_version` / `stock_version` (an `unchanged` answer keeps the rows); **one status line** and the **danger banner** (S29, S43); **alert bar** (`low` then `out`); search and category filter over `items_meta`; rows with `QuantityInput` On hand, Reserved, Available, "Set at", "Not counted today" from `level`, "Sold out when 0", Available / Off toggle, "Off since"; **hours badge** from `isOrderableByTime` with `createHubClock(hub_time)` re-evaluated every 60 000 ms; **Save counts** sends every touched row (edited or Confirm), numbers in the day's unit, `command_id` kept for retries.

- [ ] **Step 1: Tests:** `[01a §10 #77]`; `[01a §10 #102 page part]`; `[01a §10 #103 page part]`; `[01a §10 #132 page part] alert bar lists low then out; hidden when none`; `[01a §10 #137 page part] with the device clock 3 h wrong, the hours badge follows hub_time`; `hub-clock.test.ts`: `[01a S47] nowMs advances with performance.now, not Date.now`; Review Focus 4: `[01a §8.2] a refresh does not overwrite the row being edited`; Review Focus 7: `[01a S47] the badge changes within 60 s after a window end with no server answer`; `[01a §6.19] an unchanged answer keeps rows and sends no item data`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm --filter @pos/client build` → commit `feat(01a): task 69 hub stock page table and polling [spec §8.2, §6.19, S29, S30, S46, S47]`

### Task 70: `/admin/stock` — business day and Add

**Files:** Create `apps/client/src/features/admin/stock/{BusinessDayBar,StartDay,StalePrompt}.tsx`, `BusinessDay.test.tsx`; Modify `StockApp.tsx`, `StockTable.tsx` (Add field and button per row → `AddPrecookedStock` for that row), `apps/client/src/i18n/en.ts`.

§8.2 of v1.0: "Day open … since … (15 h)" / "Day closed at …" styled by **age**, not date (nit 5); **Close day** with confirmation → `CloseBusinessDay` (`opened_recently` message); **Start day** large action above the rows whenever no day is open; one tap → `OpenBusinessDay {}`, then the entry continues; a save or Add answered `409 BUSINESS_DAY_NOT_OPEN` shows Start day and, after the tap, re-sends the pending command with the **same** `command_id` (00 M19 stores no response for a refused command) keeping typed values; **stale prompt** when `day_stale` → "Close and start new day" (`CloseBusinessDay` then `OpenBusinessDay`, two `command_id`s) or "Keep this day open".

- [ ] **Step 1: Tests:** `[01a §10 #133 page part]`; `[01a §10 #146 page part]`; `[01a S45] Add sends AddPrecookedStock for one row with the parsed quantity`; Review Focus 6: `[01a S33] after another device closes the day, the next refresh shows Start day and Available 0 for non-carrying rows, typed counts kept`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm --filter @pos/client build` → commit `feat(01a): task 70 hub stock page business day and add [spec §8.2, S33, S45]`

### Task 71: Manual runbook and release drill — needs Docker Postgres, needs hardware

**Files:** none. Run on the dev box with the setup of `docs/manual-test-00.md` §1–§3 (database `pos_manual`, never `pos_test`; cloud on port 4000 through the `cloud` wrapper with `node --import tsx src/main.ts`; hub on port 3000 with `cd apps/hub && node --import tsx src/main.ts`). Report each result in the chat; Claude writes `docs/manual-test-01a.md` (task 72).

- [ ] `pnpm --filter @pos/client build`; start cloud and hub; `seed-tenant`, `issue-registration-code`, provision as in 00's runbook.
- [ ] Owner at `http://localhost:4000/owner/`: floor, slot station "Karahi", batch station "Fryer" with a program, a category with a breakfast window, items (one in pieces with a stock time, one in grams sold by the plate with a threshold, one with Keeps overnight). Within 60 s the hub `http://localhost:3000/admin/stock/` lists them.
- [ ] Pair a KDS browser to "Karahi" → paired.
- [ ] Start day (one tap), count in kg, Add to one row; stop the cloud; set counts and toggle an item off → saved; status line offline.
- [ ] Business day: Close day → Available 0 for non-carrying rows, the carrying item keeps its count; Start day; leave a day open past `day_stale_after_hours` (set to 1 with `set-branch-settings` for the drill) → the stale prompt; Close and start new day.
- [ ] Unit change mid-day on the owner page → the hub keeps the old unit until the next Start day, then shows "Not counted today".
- [ ] Restore drill (S42): `pg_dump pos_manual`, two menu edits and a staff removal, restore; the hub keeps the newer menu; `pnpm --filter @pos/cloud restore-bump --tenant <id>`; within 60 s the hub applies the older menu and directory.
- [ ] Large menu: seed 5 000 items by SQL; the owner menu pages and searches; the hub pulls it (note the apply time and the `warn` log).
- [ ] Timing (§7.5, S40 N10): p95 of 20 `curl` calls for the `304` path and a full snapshot; hub apply time from the log.
- [ ] Page parts of tests 75, 102, 103, 132, 133, 137, 139, 146 (S40 N11): scratch `dangerouslySetInnerHTML` fails `pnpm lint`; danger banner after a forced hash mismatch; "Off since"; alert bar; Start day; hours badge with the tablet clock set wrong; read-only menu for a branch-limited owner; stale prompt.
- [ ] **needs hardware** — release drill §7.8 steps 1–6 on site over the LAN, including one refusal; ends with `/admin/stock/` → `200` with the CSP header. Optional: `SetPrecookedStock` with 200 entries ≤ 50 ms p95 on the mini PC.
- [ ] No commit.

### Task 72: README, spec status, runbook file, DoD close-out — Claude only

**Files:** Modify `docs/specs/README.md` (01a implemented status), the 01a spec status line; Create `docs/manual-test-01a.md` (from task 71's report, layout of `docs/manual-test-00.md`).

- [ ] Coverage in code: for every number N in this plan's coverage table, `grep -rhoE "\[01a §10 #N\]" apps packages | wc -l` = 1; for the page parts listed under the table, `grep -rhoE "\[01a §10 #N page part\]" apps | wc -l` = 1; no test cites a removed number (55, 96–101, 104, 109–112) or a number not in the table.
- [ ] Walk §12.1 and §12.2; record gaps. Commit `feat(01a): task 72 module 01a close-out [spec §12.1]`
