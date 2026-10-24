# 01a Restaurant Setup — Implementation Plan (spec v0.4)

> **For the implementer (Cursor, no plugins):** follow `.cursor/rules/pos.mdc`. Do **one task per request**, in order. Each task: write the listed tests first, run them and see them fail for the stated reason, implement, run the task command and then `pnpm test`, check **Done when**, commit. Steps use checkboxes (`- [ ]`); do **not** tick them in this file (it is read-only for you). Tasks marked **Claude only** edit `docs/specs/`, `docs/plans/`, `docs/specs/README.md` or the foundation: **skip them and tell the user** — Claude does them.

**Goal:** Build module 01a: cloud restaurant data (floors, tables, stations, programs, tax classes, categories, items, per-branch routes) with idempotent creates and an audit trail; config delivery to the hub through a conditional poll; the hub's config apply as an event, the stock slice of `@pos/engine`, pre-cooked stock and availability commands; the owner app and the hub `/admin/stock` page as React entries in a new `apps/client`.

**Architecture:** The cloud owns the menu; every owner write runs one PostgreSQL transaction (idempotency key → lock → checks → write → `config_audit` → `bumpConfigVersion`). The hub polls `GET /v1/sync/config` every 60 s, verifies the snapshot hash over the raw JSON, and applies it in one `writer.run` (`config_snapshots` insert + `BranchConfigApplied` + optional staff directory), swapping the in-memory config after COMMIT. Stock lives only in `EngineState.stock`, folded from `StockSet` events.

**Tech stack:** existing 00 stack (Fastify 5.12.7, Zod 4.6.7, better-sqlite3 13.0.3, pg 8.23.1, Vitest 4.1.12, ESLint 10.13.0) + `apps/client` only: React 19.3.1, Vite 8.3.5, jsdom 30.1.3.

**Spec:** `docs/specs/01_Restaurant_Setup_Spec_v0.4.md` (cited as "§x" or "S12"); foundation `docs/specs/00_Foundation_Spec_v1.7.md` ("F §x"); 00 spec `docs/specs/00_Hub_Platform_Access_Spec_v1.2.md` ("00 Mxx"). Read the cited spec section before each task; this plan does not repeat the spec's tables.

**Starting point:** module 00 is built. Reuse, do not recreate: hub `writer.run`, `createStateHolder`, `createProjectionRegistry`, `defineCommand` / `commandRegistry(app)`, `defineQuery` / `queryRegistry(app)`, `registerStationValidator` / `stationExists`, `registerEventAudience`, `registerCatchUp`, `applyStaffDirectory`, `swapDirectory(app, …)`, `lib/hash.ts`, `lib/ui-assets.ts` (pattern for §7.1), `setup/cloud-client.ts` (pattern for the poll client), test helpers `createTestHub`, `seedDirectory`, `pairDevice`, `openSession`, `statementCounter`, `connectWs`, `aDirectory`; cloud `TenantScopedRepository`, `TenantLevelRepository`, `registerTenantScope` (`TENANT_SCOPE_ALLOWLIST`), `registerErrorHandler`, `loadDirectory` (`modules/hub-registration/repository.ts`), `SystemContext`, `seedTenant`, `issueRegistrationCode`, `createTestCloud`, `truncateAll`.

## Markers

| Marker | Meaning |
|---|---|
| **Claude only** | Edits `docs/specs/`, `docs/plans/`, `docs/specs/README.md` or the foundation. Cursor skips it. |
| **needs Docker Postgres** | Cloud integration tests: run `docker compose up -d postgres` first (port 5433, `pos/pos/pos_test`). |
| **needs hardware** | Needs the pilot mini PC or a physical device. Only the optional §7.5 check in task 43. |
| **STOP** | Do not start the next task until the user confirms. |

## Global Constraints

Every task implicitly includes these. Values copied from the spec.

- **Dependencies (§12.1, S35 g):** none new in `apps/hub`, `apps/cloud`, `packages/*`, **except** workspace links (`@pos/engine` in `apps/hub`) and `@types/node@22.19.1` (dev) in `packages/domain` (task 4, see Open decisions). `apps/client` only: `react@19.3.1`, `react-dom@19.3.1` (runtime); `vite@8.3.5`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `jsdom@30.1.3` (dev). Exact pins, no `^`. No React plugin, router, state library or testing library.
- **Determinism (F §6.7):** no `Date.now()`, `Math.random()`, `ulid()`, `crypto.randomUUID()` in `src/` (lint enforces). Hub uses `deps.clock` / `deps.ids`; cloud uses `deps.clock` / `deps.ids`; CLIs may use the system clock in their entry block only. `apps/client` may call `Date.now()` and `crypto.getRandomValues` (browser code; add `apps/client/src/**` to the lint exception list in task 34).
- **Envelope (F §6.1):** `{ data }` or `{ error: { code, message, details, request_id } }`. The only body-less reply is §6.1's `304`. Replays add `Idempotent-Replay: true`. `503` adds `Retry-After` (the 00 error handler does it from `details.retry_after_ms`).
- **Errors:** only catalogue codes; `throw new DomainError(code, details)`. New codes exist after task 3.
- **Naming (F §6.6):** snake_case on the wire and in SQL; camelCase in TS; `*_at` Unix ms; `*_ms` durations; money `*_minor` integer (`BIGINT` cloud, `INTEGER` hub).
- **Cloud SQL (D54):** owner routes query only through `TenantScopedRepository` (branch-level tables; SQL must use `$1` tenant and `$2` branch-id array, e.g. `WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3`) or `TenantLevelRepository` (tenant-level tables: `tax_classes`, `categories`, `menu_items`, `idempotency_keys`, `config_audit`; SQL must contain `tenant_id = $1`). Both accept a `pg.PoolClient`, so they work inside a transaction. Path `branch_id` not in `request.tenant.branchIds` → `404 BRANCH_NOT_FOUND`.
- **Cloud write script (§6 intro):** Zod → `BEGIN` → [creating POST: idempotency key insert] → target `FOR UPDATE` (`404` if absent) → reference rows `FOR SHARE` in id order → write → `writeConfigAudit` → `bumpConfigVersion` (branch rows last) → [store response on key] → `COMMIT`. Unique-index violation on an `*_active_name` index (pg `23505`) → `409 CONFIG_NAME_TAKEN { entity, name }`.
- **Hub SQL:** `writer.run` only; no `await` inside it; queries never write.
- **Fixed values:** poll interval 60 000 ms; poll HTTP timeout 10 000 ms; `pull-now` wait 12 000 ms, `503` with `retry_after_ms: 60000`; names 1–60 chars trimmed, unique case-insensitive among active rows; `price_minor` 0…1 000 000 000; `cook_time_ms` 1…14 400 000; `prep_buffer_ms` 0…3 600 000; `stock_time_ms` null or 0…`cook_time_ms`; `rate_bp` 0…10 000; station `capacity` 1…100; `freshness_window_ms` batch only 0…3 600 000 default 0; `completion_mode` `two_tap` (default) / `single_tap` / `auto_done`; `seats` null or 1…100; `description` ≤ 300; `out_of_stock_behaviour` `cook_fresh` (default) / `sold_out`; `business_day_start_ms` 0…86 340 000, multiple of 60 000, default 18 000 000; idempotency rows pruned after 86 400 000 ms; stock entries 1–200, `on_hand` int 0…9 999; `SNAPSHOT_SCHEMA_MAX = 1`, cloud `SNAPSHOT_SCHEMA_MIN_SERVED = 1`; stock page refresh 15 000 ms; epoch banner window 86 400 000 ms; CSP `default-src 'self'; frame-ancestors 'none'`; `Cache-Control` `no-cache` (index.html) and `public, max-age=31536000, immutable` (`assets/*`).
- **Secrets never logged:** the poller never logs the snapshot body or the directory (PIN hashes).
- **Tests:** names `it('[01a §10 #N] …')`, each N in exactly one test (coverage table below); other tests cite a section `it('[01a §6.4] …')`. Hub integration `apps/hub/test/**/*.int.test.ts`; cloud integration `apps/cloud/test/**/*.int.test.ts`; unit `*.test.ts` next to source; client `apps/client/src/**/*.test.tsx`.
- **Cross-tenant and route inventory (D54, M25):** every task that adds a cloud route adds it to `ROUTE_CASES` in `apps/cloud/test/cross-tenant.int.test.ts` (task 11 creates the table) with a path/payload that names tenant B's ids, and the 00 tests must stay green.
- **Commit:** `feat(01a): task N <title> [spec §x]`, only the task's files: `git add <files> && git commit -m "…"`.

## Open decisions (confirm before the named task)

1. **Task 4:** `packages/domain/src/hash.ts` imports `node:crypto`; `packages/domain` cannot typecheck it without `@types/node`. The plan adds `"@types/node": "22.19.1"` to `packages/domain` `devDependencies` (same pin as hub/cloud; a type-only dev dependency). §12.1 says "none new in packages/*". Claude records this in the spec at the next version bump.
2. **Task 23:** §4.2 gives `onBranchConfigApplied(fn)` with `fn(prev, next)` but says the hook appends events in the same transaction. The plan passes the transaction as a third argument: `fn(prev, next, tx: WriterTx)`. Additive.
3. **Tasks 25, 27:** 00's boot step 3 runs before the state holder exists and its context has only `{ config, db }`. The plan calls the stock fold and the config load **inline at the step-3 position in `lib/boot.ts`** and starts the poller at the step-6 position, instead of `registerBootStep` at module load (that would create an import cycle with `boot.ts`). Same order, same behaviour.
4. **Task 35:** §7.1 names route group `admin-page` for `/admin/stock/*`. 00's existing group `admin-bootstrap` already has exactly those guards (host, provisioned, guest; no credentials, M79). The plan uses `admin-bootstrap` and adds no group.
5. **Test #102 and #75** each have a server part and a page part in §11 (tasks 22/27 and 24/26 there). "Exactly one test per number" (§12.1): the number goes on the server test (#102) and the render test (#75); the other part is an unnumbered test citing the section.

## Review Focus

Inputs the spec implies but no §10 test covers. Each has a test in the named task.

1. **Names with surrounding spaces or other case** (`" ground "` vs `"Ground"`): stored trimmed, and the duplicate is `409 CONFIG_NAME_TAKEN` → task 11.
2. **Prices typed as `" 1,200 "`, `"1200.50"`, `"1,20,000"` (lakh grouping) or `"١٢٠٠"`**: trimmed and grouped forms accepted (`120000`, `120050`, `12000000`); non-ASCII digits rejected → task 36.
3. **An owner's access token expiring mid-form**: the app refreshes once and retries the same request with the same `Idempotency-Key`; a second `401` goes to `#/login` and keeps nothing secret in memory → task 36.
4. **The 15 s stock refresh landing while the manager is typing a count**: the typed value in that row survives; other rows update → task 39.
5. **Shutdown during a poll interval**: after `stop()`, no further poll runs and an in-flight poll's result does not swap config after the database closed → task 25.

---

## Interfaces (later tasks rely on these exact names)

```ts
// packages/domain/src/hash.ts — subpath "@pos/domain/hash" (task 4). Not re-exported from the root.
export function canonicalJson(v: unknown): string;
export function sha256hex(s: string | Buffer): string;

// packages/events/src/config.ts (task 5)
export const SNAPSHOT_SCHEMA_MAX = 1;
export const BranchConfigSnapshotSchemaV1: z.ZodObject<…>;            // §4.3; NOT .strict()
export type BranchConfig = z.infer<typeof BranchConfigSnapshotSchemaV1>;
export type ConfigItem = BranchConfig['items'][number];
export type ConfigStation = BranchConfig['stations'][number];
export const SNAPSHOT_SCHEMAS: Readonly<Record<number, z.ZodType<BranchConfig>>>; // { 1: V1 }
export function isStockTracked(config: BranchConfig, item: ConfigItem): boolean;   // §4.3 last paragraph
export const SyncConfigEnvelopeSchema; // { data: { config: { snapshot_hash: string; snapshot: Record<string, unknown> } | null; directory: DirectoryInput | null } }

// packages/events (task 6): events BranchConfigApplied, StockSet, ItemMadeUnavailable, ItemMadeAvailable (v1, §4.2)
// packages/events/testing: aBranchConfigApplied(o?), aStockSet(o?), anItemMadeUnavailable(o?), anItemMadeAvailable(o?), aBranchConfig(o?): BranchConfig

// packages/engine/src (task 7) — package "@pos/engine", root export only
export interface StockEntry { on_hand: number; reserved: number; set_at: number | null }
export interface EngineState { stock: Record<string, StockEntry> }
export const ENGINE_STATE_VERSION = 1;
export function initialEngineState(): EngineState;
export function applyEvent(state: EngineState, event: PosEvent): EngineState;    // pure; unknown events return `state` unchanged (same reference)
export function buildEngineState(events: readonly PosEvent[]): EngineState;
export function stockOf(state: EngineState, itemId: string): StockEntry;         // missing → { on_hand: 0, reserved: 0, set_at: null }
export function availableStock(state: EngineState, itemId: string): number;      // max(0, on_hand − reserved)

// apps/cloud/src/lib/idempotency.ts (task 9)
export async function inTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
export interface IdempotentResult<T> { status: number; body: T; replay: boolean }
export async function withIdempotency<T>(
  ctx: { pool: pg.Pool; clock: Clock; tenant: TenantContext },
  request: { key: string | undefined; route: string; body: unknown },
  fn: (client: pg.PoolClient) => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>>;
export function sendIdempotent(reply: FastifyReply, r: IdempotentResult<unknown>): FastifyReply; // sets Idempotent-Replay on replays

// apps/cloud/src/lib/config-version.ts (task 10)
export type BumpScope = { kind: 'branch'; branchId: string } | { kind: 'tenant' };
export async function bumpConfigVersion(client: pg.PoolClient, tenant: TenantContext, scope: BumpScope): Promise<Array<{ branch_id: string; config_version: number }>>;
// apps/cloud/src/lib/config-audit.ts (task 10)
export type AuditEntity = 'floor'|'table'|'station'|'batch_program'|'tax_class'|'category'|'menu_item'|'item_route'|'branch_settings';
export type AuditAction = 'create'|'update'|'archive'|'restore'|'route_set'|'route_removed';
export interface AuditEntry { actor: { kind: 'owner'; ownerUserId: string } | { kind: 'cli' }; entity: AuditEntity; entityId: string; branchId: string | null; action: AuditAction; before: object | null; after: object | null }
export async function writeConfigAudit(client: pg.PoolClient, tenant: TenantContext, entry: AuditEntry, deps: { clock: Clock; ids: IdGen }): Promise<void>;
export function auditActionFor(before: { archived_at: number | null }, after: { archived_at: number | null }): 'update' | 'archive' | 'restore';

// apps/cloud/src/modules/config-sync/builders/v1.ts (task 13)
export async function buildSnapshotV1(client: pg.PoolClient, tenant: TenantContext, branchId: string, header: SnapshotHeader): Promise<BranchConfig>; // 6 statements, parsed with V1
export interface SnapshotHeader { config_epoch: string; config_version: number; currency_code: string; business_day_start_ms: number; tax_enabled: boolean }
// apps/cloud/src/modules/config-sync/builders/index.ts (task 14)
export const SNAPSHOT_SCHEMA_MIN_SERVED = 1;
export function createBuilderRegistry(o?: { minServed?: number; extra?: Record<number, SnapshotBuilder> }): BuilderRegistry; // tests register a v2
// CloudDeps gains (task 14): snapshotBuilders?: BuilderRegistry; testHooks?: CloudTestHooks
export interface CloudTestHooks { afterTargetLock?(route: string): Promise<void>; afterReferenceLock?(route: string): Promise<void>; beforeBump?(): Promise<void> }

// apps/hub/src/sync/branch-config-holder.ts (task 23)
export interface ConfigEntry { config: BranchConfig; snapshotHash: string; configVersion: number; configEpoch: string; snapshotSchemaVersion: number; appliedAt: number }
export function branchConfig(): BranchConfig | null;
export function currentConfigEntry(): ConfigEntry | null;
export function swapBranchConfig(entry: ConfigEntry | null): void;
export function onBranchConfigApplied(fn: (prev: BranchConfig | null, next: BranchConfig, tx: WriterTx) => void): () => void;
export function runBranchConfigHooks(prev: BranchConfig | null, next: BranchConfig, tx: WriterTx): void;

// apps/hub/src/projections/branch-config.ts (task 22)
export interface BranchConfigRow { branch_id: string; config_epoch: string; config_version: number; snapshot_schema_version: number; snapshot_hash: string; applied_at: number; epoch_changed_at: number | null }
export const branchConfigProjection: Projection;          // BranchConfigApplied → upsert; reset → DELETE
export function readBranchConfigRow(db: Database.Database, branchId: string): BranchConfigRow | undefined;
export function parseStoredSnapshot(body: string, schemas?: Record<number, z.ZodType<BranchConfig>>): BranchConfig; // JSON.parse + schema of its snapshot_schema_version
export type LoadedConfig = { state: 'NONE' } | { state: 'BODY_MISSING'; row: BranchConfigRow } | { state: 'APPLIED'; row: BranchConfigRow; entry: ConfigEntry };
export function loadBranchConfig(db: Database.Database, branchId: string): LoadedConfig; // 2 primary-key reads
// apps/hub/src/projections/item-availability.ts (task 22)
export const itemAvailabilityProjection: Projection;
export function itemAvailability(db: Database.Database, itemIds: readonly string[]): Map<string, boolean>; // 1 statement
export function registerRestaurantProjections(projections: ProjectionRegistry): void;

// apps/hub/src/sync/config-client.ts (task 23)
export interface ConfigQuery { config_epoch: string; config_version: number; directory_version: number; snapshot_schema: number }
export type ConfigFetch =
  | { kind: 'not_modified' } | { kind: 'ok'; text: string } | { kind: 'offline' }
  | { kind: 'error'; status: number; code: string; details: Record<string, unknown> };
export interface ConfigClient { fetchConfig(q: ConfigQuery): Promise<ConfigFetch> }
export function httpConfigClient(baseUrl: string, branchApiKey: string, timeoutMs?: number): ConfigClient; // default 10_000
// apps/hub/src/sync/config-poller.ts (tasks 23–25)
export type PollOutcome = 'applied'|'epoch_changed'|'unchanged'|'offline'|'rejected'|'upgrade_required'|'unauthorized';
export interface PollResult { outcome: PollOutcome; config_version: number | null; directory_version: number; at: number }
export interface PollProblem { outcome: 'rejected'|'upgrade_required'|'unauthorized'; reason: string; at: number }
export interface ConfigPoller { pollOnce(): Promise<PollResult>; lastPoll(): { outcome: PollOutcome; at: number } | null; lastProblem(): PollProblem | null; start(intervalMs?: number): void; stop(): void }
export function createConfigPoller(deps: {
  config: HubConfig; db: Database.Database; writer: Writer; clock: Clock; client: ConfigClient;
  setDirectory: (d: StaffDirectory) => void; log: Pick<FastifyBaseLogger, 'debug'|'info'|'warn'|'error'>;
  schemas?: { max: number; byVersion: Record<number, z.ZodType<BranchConfig>> }; // default SNAPSHOT_SCHEMA_MAX / SNAPSHOT_SCHEMAS
}): ConfigPoller;
export function configPoller(app: FastifyInstance): ConfigPoller;   // WeakMap, set by buildHubServer
// HubDeps gains (task 23): configClient?: ConfigClient   (default httpConfigClient(config.cloud_base_url, provisioned.branch_api_key))
// QueryCtx gains (task 25): state: Readonly<EngineState>; config: BranchConfig | null

// apps/hub/src/lib/business-day.ts (task 30)
export function businessDayStartedAt(nowMs: number, config: Pick<BranchConfig, 'business_day_start_ms'> | null): number; // hub OS time zone; null → 18_000_000

// apps/hub/src/auth/apply-directory.ts (task 41) — additive 4th parameter
export function applyStaffDirectory(tx, d, setDirectory, opts?: { allowNotNewer?: boolean }): { applied: boolean };

// apps/{hub,cloud}/src/lib/client-dist.ts (task 35)
export function registerClientDist(app: FastifyInstance, o: { prefix: '/owner/' | '/admin/stock/'; dir: string; routeConfig: Record<string, unknown>; headers?: Record<string, string> }): void;

// apps/client (tasks 34–39)
// src/features/owner/money.ts
export function parseRupeesToMinor(input: string): { ok: true; value: number } | { ok: false };
export function formatMinor(minor: number): string;               // 120000 → "1,200"
// src/api/cloud-admin.ts
export function createCloudAdmin(o: { fetch?: typeof fetch; storage?: Storage; onLoggedOut(): void }): CloudAdmin; // login, refresh-once, typed calls
export function newIdempotencyKey(): string;                        // ULID from crypto.getRandomValues
// src/api/hub-admin.ts
export function createHubAdmin(o: { fetch?: typeof fetch }): HubAdmin; // device token from IndexedDB 'pos-device'/'device', admin token from sessionStorage 'admin_session_token'
// src/app/router.ts
export function useHashRoute(): string;                             // '#/menu' → '/menu'
```

---

## Coverage table (§10 → task)

| Tests | Task | Tests | Task | Tests | Task |
|---|---|---|---|---|---|
| 1, 2, 3, 6, 20, 96, 99 | 14 | 42, 43, 44, 45, 53, 54, 95 | 23 | 81, 82 | 19 |
| 4, 5, 85 | 13 | 46, 58, 94, 97, 98, 100 | 24 | 83 | 12 |
| 7 | 19 | 47, 48, 50, 51, 52 | 25 | 84 | 8 |
| 8 | 10 | 49 | 22 | 86, 87 | 20 |
| 9, 10, 11, 12, 13, 14 | 9 | 55, 56, 102 | 31 | 88 | 18 |
| 15, 78 | 35 | 57 | 26 | 89, 73, 90, 91 | 32 |
| 16, 17, 23, 80 | 11 | 59, 60, 61, 62, 63, 64, 65 | 28 | 92 | 33 |
| 18, 19, 21, 22 | 12 | 66, 68 | 7 | 93, 67 | 27 |
| 24, 25, 26, 27 | 15 | 69, 70, 71 | 29 | 101, 105, 108 | 21 |
| 28, 29, 30 | 16 | 72, 103, 104 | 30 | 106, 107 | 19 |
| 31, 32 | 17 | 74, 76 | 36 | 109, 110, 111 | 42 |
| 33, 34, 35, 36, 37, 40 | 18 | 75 | 38 | 112 | 41 |
| 38, 39, 41 | 19 | 77 | 39 | 79 | 34 |

All 112 numbers, each once. The **Done when** of task 44 re-checks this with `grep`.

## Task list (→ spec §11 step)

| # | Task | §11 | Markers |
|---|---|---|---|
| 1 | Spec 00 v1.2.1 editorial patch | 1 | Claude only |
| 2 | Foundation §6.2: append §9 codes | 2 | Claude only |
| 3 | Domain: error codes, `manage-stock` | 2 | |
| 4 | `@pos/domain/hash` | 3 | confirm Open decision 1 |
| 5 | Events: snapshot schema `config.ts` | 4 | |
| 6 | Events: four events, fixtures, builders | 4 | |
| 7 | `@pos/engine` stock slice | 5 | |
| 8 | Cloud migration `0002_restaurant_setup.sql` | 6 | needs Docker Postgres |
| 9 | Cloud `withIdempotency` | 7 | needs Docker Postgres |
| 10 | Cloud `bumpConfigVersion`, `writeConfigAudit` | 8 | needs Docker Postgres |
| 11 | Cloud test fixtures + floors GET/POST | 9 | needs Docker Postgres |
| 12 | Cloud floor PATCH, tables POST/PATCH | 9 | needs Docker Postgres |
| 13 | Cloud snapshot builder v1 | 13 | needs Docker Postgres |
| 14 | Cloud `GET /v1/sync/config` | 13 | needs Docker Postgres |
| 15 | Cloud stations | 10 | needs Docker Postgres |
| 16 | Cloud batch programs | 10 | needs Docker Postgres |
| 17 | Cloud tax classes, categories | 11 | needs Docker Postgres |
| 18 | Cloud menu GET, menu-item POST | 12 | needs Docker Postgres |
| 19 | Cloud menu-item PATCH, route PUT | 12 | needs Docker Postgres |
| 20 | Cloud lock-order races | 10, 12 | needs Docker Postgres |
| 21 | Cloud CLIs `rotate-config-epoch`, `set-branch-settings` | 14 | needs Docker Postgres |
| 22 | Hub migration 0004, projections | 15 | |
| 23 | Hub config holder, client, `pollOnce` core | 16 | confirm Open decision 2 |
| 24 | Hub poller: schema versions, epoch, hook, commit failure | 16 | |
| 25 | Hub boot: config load, `BODY_MISSING`, timer, directory via poll, `QueryCtx` | 16, 17 | |
| 26 | Hub station validator | 18 | |
| 27 | Hub engine reducer and boot stock fold | 19 | |
| 28 | Hub `SetPrecookedStock` | 20 | |
| 29 | Hub `SetItemAvailability`, `itemAvailability` | 21 | |
| 30 | Hub business day, stock query | 22 | |
| 31 | Hub config status, `pull-now` | 22 | |
| 32 | Hub WS audiences and catch-up parts | 23 | |
| 33 | Hub `GET /queries/branch-config` | 23 | |
| 34 | `apps/client` scaffold | 24 | |
| 35 | `client-dist` helper (hub + cloud), `/owner/*` allowlist + CSP | 25 | needs Docker Postgres |
| 36 | Owner app shell: login, router, API client, money | 26 | |
| 37 | Owner floors and stations views | 26 | |
| 38 | Owner menu view | 26 | |
| 39 | Hub `/admin/stock` app | 27 | |
| 40 | Spec 00 v1.3 entry: `allowNotNewer` | 28 (pre) | Claude only, **STOP** |
| 41 | `applyStaffDirectory` `allowNotNewer` | 28 | |
| 42 | Directory resend on epoch change (cloud + hub) | 28 | needs Docker Postgres |
| 43 | Manual runbook | 29 | needs Docker Postgres; optional needs hardware |
| 44 | README, spec status, DoD close-out | §12.1 | Claude only |

---

### Task 1: Spec 00 v1.2.1 editorial patch — Claude only

**Files:** Rename `docs/specs/00_Hub_Platform_Access_Spec_v1.2.md` → `…_v1.2.1.md`; Modify it (line 7 version, line 472 `defineQuery` row, line 481 `registerReducer` row, exactly as S25); Modify `docs/specs/README.md` (00 row: link and version); update links to the old file name (`grep -rl "Access_Spec_v1.2.md" docs CLAUDE.md .cursor`).

- [ ] Apply the three edits verbatim from S25. No behaviour change.
- [ ] `grep -rn "Access_Spec_v1.2.md" docs .cursor CLAUDE.md` → no hits.
- [ ] Commit `feat(01a): task 1 spec 00 v1.2.1 editorial patch [spec S25, §2]`

### Task 2: Foundation §6.2 — append the §9 codes — Claude only

**Files:** Modify `docs/specs/00_Foundation_Spec_v1.7.md` (§6.2 list only: append the 13 codes of §9 with status, in §9 order, citing "01a §9").

- [ ] Append only; no other foundation edit (D64).
- [ ] Commit `feat(01a): task 2 foundation error codes from 01a [spec §9, F §6.2]`

### Task 3: Domain — error codes and `manage-stock`

**Files:** Modify `packages/domain/src/errors.ts`, `packages/domain/src/errors.test.ts`, `packages/domain/src/permissions.ts`, `packages/domain/src/permissions.test.ts`; Create `apps/cloud/test/default-roles.test.ts`.

**Interfaces — Produces:** catalogue entries `BRANCH_NOT_FOUND 404, FLOOR_NOT_FOUND 404, TABLE_NOT_FOUND 404, PROGRAM_NOT_FOUND 404, TAX_CLASS_NOT_FOUND 404, CATEGORY_NOT_FOUND 404, MENU_ITEM_NOT_FOUND 404, CONFIG_NAME_TAKEN 409, CONFIG_IN_USE 409, CONFIG_REFERENCE_INVALID 422, IDEMPOTENCY_KEY_MISMATCH 422, STOCK_NOT_TRACKED 422, SNAPSHOT_SCHEMA_UNSUPPORTED 409`; permission `'manage-stock'` appended last in `PERMISSIONS` (20 entries).

- [ ] **Step 1: Tests.** `errors.test.ts`: `[01a §9] 01a codes have their statuses` (all 13 above). `permissions.test.ts`: rename the 00 test to `[00 §3.6, 01a S18] catalogue has 20 unique entries` and append `'manage-stock'` to the expected list. `default-roles.test.ts` (unit, no DB): `[01a S18] Owner and Manager grant manage-stock; Cashier and Order taker do not`.
- [ ] **Step 2:** `pnpm vitest run packages/domain apps/cloud/test/default-roles.test.ts` → FAIL (codes missing).
- [ ] **Step 3:** Add the codes and the permission. `default-roles.ts` needs no change (Owner = all, Manager = all but `manage-roles`); the test proves it.
- [ ] **Step 4:** Same command → PASS; `pnpm test` (hub tests that snapshot permission lists must still pass; if one lists 19 permissions explicitly, update that expectation in this task and name it in the commit).
- [ ] **Step 5:** Commit `feat(01a): task 3 error codes and manage-stock permission [spec §9, S18]`

**Done when:** `grep -c "manage-stock" packages/domain/src/permissions.ts` = 1.

### Task 4: `@pos/domain/hash`

**Files:** Create `packages/domain/src/hash.ts`, `packages/domain/src/hash.test.ts`; Modify `packages/domain/package.json` (`exports["./hash"] = "./src/hash.ts"`; `devDependencies: { "@types/node": "22.19.1" }`), `apps/hub/src/lib/hash.ts` (re-export), `pnpm-lock.yaml`.

- [ ] **Step 1: Tests** (`hash.test.ts`): `[01a S27] canonicalJson sorts keys at every depth and keeps array order`; `[01a S27] sha256hex matches node:crypto for a known vector` (`sha256hex('abc')` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`); `[01a S27] @pos/domain root does not export canonicalJson` (`import * as root from './index'`; `expect('canonicalJson' in root).toBe(false)`).
- [ ] **Step 2:** `pnpm vitest run packages/domain` → FAIL (module missing).
- [ ] **Step 3:** Move the two function bodies from `apps/hub/src/lib/hash.ts` unchanged. Hub `lib/hash.ts` becomes `export { canonicalJson, sha256hex } from '@pos/domain/hash';` plus its existing `payloadHash`. `pnpm install`.
- [ ] **Step 4:** `pnpm vitest run packages/domain apps/hub/src/lib/hash.test.ts` → PASS; `pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 4 @pos/domain/hash subpath [spec S27]`

### Task 5: Events — snapshot schema (`config.ts`)

**Files:** Create `packages/events/src/config.ts`, `packages/events/src/config.test.ts`; Modify `packages/events/src/index.ts`.

**Interfaces — Produces:** see Interfaces block (`SNAPSHOT_SCHEMA_MAX`, `BranchConfigSnapshotSchemaV1`, `BranchConfig`, `ConfigItem`, `ConfigStation`, `SNAPSHOT_SCHEMAS`, `isStockTracked`, `SyncConfigEnvelopeSchema`). Field set and nullability exactly as the §4.3 JSON: top level `snapshot_schema_version` (literal 1), `config_epoch` (string, min 1), `config_version` (int ≥ 1), `branch_id`, `currency_code`, `business_day_start_ms`, `tax_enabled` (boolean, **required**), `floors[{floor_id,name,sort_order,tables[{table_id,name,seats|null,sort_order}]}]`, `stations[{station_id,name,location_label|null,station_type 'slot'|'batch',capacity,freshness_window_ms|null,completion_mode,is_archived,programs[{program_id,name,cook_time_ms}]}]`, `tax_classes[{tax_class_id,name,rate_bp}]`, `categories[{category_id,name,sort_order}]`, `items[{item_id,category_id,name,group_label|null,description|null,sort_order,price_minor,tax_class_id|null,serve_mode 'immediate'|'sync',prep_buffer_ms,cook_time_ms,stock_time_ms|null,out_of_stock_behaviour,station_id,program_id|null,stock_program_id|null}]`. Numbers are `z.number().int()` (a string `"120000"` fails, S27). `SyncConfigEnvelopeSchema` types `snapshot` as `z.record(z.string(), z.unknown())` and `directory` as the existing `DirectorySchema` or null.

- [ ] **Step 1: Tests:** `[01a §4.3] the §4.3 example parses`; `[01a S28 c] unknown fields are dropped, not rejected` (extra `promo`, `items[0].spice_level`); `[01a S27] price_minor "120000" fails`; `[01a S34] missing tax_enabled fails; tax_class_id null passes`; `[01a §4.3] isStockTracked: slot + stock_time_ms → true; slot + null → false; batch + stock_program_id → true; batch + null → false`.
- [ ] **Step 2–4:** `pnpm vitest run packages/events` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 5 branch config snapshot schema v1 [spec §4.3, S28]`

### Task 6: Events — four events, fixtures, builders

**Files:** Create `packages/events/src/events/hub/BranchConfigApplied.v1.ts`, `packages/events/src/events/stock/{StockSet,ItemMadeUnavailable,ItemMadeAvailable}.v1.ts`, `packages/events/fixtures/{BranchConfigApplied,StockSet,ItemMadeUnavailable,ItemMadeAvailable}.{v1,latest}.json`; Modify `packages/events/src/index.ts`, `packages/events/src/fixtures.test.ts` (count 14 → 18), `packages/events/testing/index.ts`, `packages/events/testing/builders.test.ts`.

**Interfaces — Produces:** payloads exactly §4.2: `BranchConfigApplied { config_epoch: string, config_version: int ≥ 1, snapshot_schema_version: int ≥ 1, snapshot_hash: /^[0-9a-f]{64}$/, previous_config_epoch: string|null, previous_config_version: int|null }`; `StockSet { item_id, on_hand: int 0…9999 }`; `ItemMadeUnavailable { item_id }`; `ItemMadeAvailable { item_id }`. Builders listed in the Interfaces block (`aBranchConfig()` returns a valid snapshot with one slot station "Karahi", one stock-tracked item `I1`, one non-tracked item `I2`).

- [ ] **Step 1: Tests:** fixtures test now expects 18 files; `[01a §4.2] StockSet rejects on_hand 10000 and -1`; builders test: each new builder parses with its schema; `aBranchConfig()` parses with `BranchConfigSnapshotSchemaV1`.
- [ ] **Step 2–4:** `pnpm vitest run packages/events` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 6 config and stock events [spec §4.2]`

### Task 7: `@pos/engine` — stock slice

**Files:** Create `packages/engine/{package.json,tsconfig.json,vitest.config.ts}`, `packages/engine/src/{state,stock,apply-event,version,index}.ts`, `packages/engine/src/engine.test.ts`, `packages/engine/fixtures/{stock-log.v1.json,engine-state.v1.json}`; Modify `pnpm-lock.yaml`.

`package.json`: `"name": "@pos/engine"`, `"exports": { ".": "./src/index.ts" }`, `dependencies: { "@pos/events": "workspace:*" }`, script `typecheck`. Copy `tsconfig.json` / `vitest.config.ts` from `packages/events`.

- [ ] **Step 1: Tests** (`engine.test.ts`): `[01a §10 #66]` state `{ I1: { on_hand: 5, reserved: 2, set_at: T0 } }` + `StockSet { I1, on_hand: 4 }` with `recorded_at: T1` → `{ 4, 2, T1 }`, `availableStock` 2; then `StockSet 1` → `availableStock` 0. `[01a §10 #68]` `buildEngineState(stock-log.v1.json)` deep-equals `engine-state.v1.json` (log: 4 `StockSet` events on 2 items plus one `HubStarted`). `[01a S14] stockOf on a missing item → { 0, 0, null }`. `[01a S15] applyEvent returns the same reference for a non-stock event`.
- [ ] **Step 2:** `pnpm install && pnpm vitest run packages/engine` → FAIL.
- [ ] **Step 3:** Implement; `applyEvent` copies only the touched entry (`{ ...state, stock: { ...state.stock, [id]: next } }`); `set_at = event.recorded_at`, never a clock.
- [ ] **Step 4:** Same → PASS; `pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 7 engine package with stock slice [spec S14, S15]`

### Task 8: Cloud migration `0002_restaurant_setup.sql` — needs Docker Postgres

**Files:** Create `apps/cloud/src/db/migrations/0002_restaurant_setup.sql` (verbatim §5.2), `apps/cloud/test/db/restaurant-schema.int.test.ts`; Modify `apps/cloud/test/schema.int.test.ts` only if it asserts an exact table list.

- [ ] **Step 1: Tests:** `[01a §10 #84]` insert one `config_audit` row, then `UPDATE` and `DELETE` each raise `config_audit is insert-only`; its primary key leads with `tenant_id` and every index on the new tables leads with `tenant_id` (query `pg_index`). `[01a §5.2] menu_items accepts tax_class_id NULL and rejects stock_time_ms > cook_time_ms`; `[01a §5.2] a station with type slot and freshness 0 is rejected`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/db/restaurant-schema.int.test.ts` → FAIL.
- [ ] **Step 3:** Add the file. Expand-only: no 0001 edit.
- [ ] **Step 4:** Same → PASS; `pnpm vitest run --project @pos/cloud`.
- [ ] **Step 5:** Commit `feat(01a): task 8 cloud restaurant setup migration [spec §5.2, S26, S29, S32–S34]`

### Task 9: Cloud `withIdempotency` — needs Docker Postgres

**Files:** Create `apps/cloud/src/lib/idempotency.ts`, `apps/cloud/test/lib/idempotency.int.test.ts`.

**Interfaces — Produces:** `inTransaction`, `withIdempotency`, `sendIdempotent` (Interfaces block). Behaviour S7: missing key or non-ULID → `400 VALIDATION_FAILED` with `issues[0].path = 'headers.idempotency-key'`; request hash = `sha256hex(canonicalJson({ route, body }))`; inside one transaction: `DELETE … WHERE tenant_id = $1 AND created_at < now − 86 400 000`, then `INSERT … ON CONFLICT DO NOTHING RETURNING`; no row → read the stored row: same hash → return it with `replay: true` (rollback our empty transaction); different hash → `422 IDEMPOTENCY_KEY_MISMATCH { idempotency_key }`. On success `UPDATE` the row's `response_status`, `response_body` before COMMIT. Any throw rolls back (key gone).

- [ ] **Step 1: Tests.** In the test file register a test route `POST /v1/test/floors/:branch_id` (`tenantScope: 'jwt'`) that inserts a `floors` row through `withIdempotency` and throws `CONFIG_NAME_TAKEN` on name `"dup"`. Seed with `seedTenant` + `issueRegistrationCode`; sign the JWT with `cloud.app.jwt.sign`. Tests `[01a §10 #9]`, `#10`, `#11`, `#12`, `#13`, `#14` exactly as §10.1 (for #12, fire two `inject` calls with `Promise.all`; assert one `floors` row and one reply with `idempotent-replay: true`; for #14, insert an old row for tenant A and one for tenant B directly, then call the route as A → A's old row gone, B's kept).
- [ ] **Step 2–4:** `pnpm vitest run apps/cloud/test/lib/idempotency.int.test.ts` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(01a): task 9 cloud idempotency keys [spec S7, M69]`

### Task 10: Cloud `bumpConfigVersion` and `writeConfigAudit` — needs Docker Postgres

**Files:** Create `apps/cloud/src/lib/config-version.ts`, `apps/cloud/src/lib/config-audit.ts`, `apps/cloud/test/lib/config-version.int.test.ts`.

**Interfaces — Produces:** Interfaces block. `bumpConfigVersion`: branch scope → `UPDATE branches SET config_version = config_version + 1 WHERE tenant_id = $1 AND branch_id = $3 RETURNING …`; tenant scope → first `SELECT branch_id FROM branches WHERE tenant_id = $1 ORDER BY branch_id FOR UPDATE`, then one `UPDATE … WHERE tenant_id = $1 RETURNING`. `writeConfigAudit` inserts one row (`audit_id = ids.next()`, `at = clock.branchNow()`).

- [ ] **Step 1: Tests:** `[01a §10 #8]` 10 concurrent `inTransaction(… bumpConfigVersion(branch A))` → version +10 exactly. `[01a S8] tenant scope bumps every branch once, branch scope bumps one` (3 branches). `[01a S26] writeConfigAudit stores actor, entity, before/after; cli actor stores null user`. `[01a S26] auditActionFor: archived_at null→set archive, set→null restore, else update`.
- [ ] **Step 2–4:** run → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(01a): task 10 config version bump and audit writer [spec S8, S26]`

### Task 11: Cloud test fixtures and floors GET/POST — needs Docker Postgres

**Files:** Create `apps/cloud/test/helpers/restaurant.ts`, `apps/cloud/test/helpers/pg-counter.ts`, `apps/cloud/src/modules/restaurant/{routes,service,repository,schemas}.ts`, `apps/cloud/test/restaurant/floors.int.test.ts`; Modify `apps/cloud/src/server.ts` (`registerRestaurantRoutes(app, deps)`), `apps/cloud/test/cross-tenant.int.test.ts`.

**Interfaces — Produces:**
```ts
// test/helpers/restaurant.ts
export interface RestaurantFixture { tenantId: string; userId: string; branches: [string, string, string]; token: string; tokenFor(branchIds: string[]): string; branchKey: string /* branch A's API key */ ; other: { tenantId: string; branchId: string; token: string } }
export async function restaurantFixture(cloud: TestCloud): Promise<RestaurantFixture>; // truncateAll, seedTenant ×2, issueRegistrationCode ×3 (+1 for B), /v1/hubs/register for branch A
export function owner(f: RestaurantFixture, token?: string): { headers: Record<string, string> };   // authorization + fresh idempotency-key
// test/helpers/pg-counter.ts
export function pgCounter(pool: pg.Pool): { readonly count: number; reset(): void };  // wraps pool.connect clients and pool.query; counts statements other than BEGIN/COMMIT/ROLLBACK
// src/modules/restaurant/routes.ts
export function registerRestaurantRoutes(app: FastifyInstance, deps: CloudDeps): void;
```
`cross-tenant.int.test.ts`: replace the exact route list with `ROUTE_CASES: Record<string, (ids) => { url: string; payload?: unknown }>` keyed `"METHOD /url"`; assert `Object.keys(ROUTE_CASES).sort()` equals the jwt/branch-key routes, and every case gets no tenant B id back. Branch-path cases use tenant B's branch id (expect `404 BRANCH_NOT_FOUND`).

- [ ] **Step 1: Tests:** `[01a §10 #16]`, `[01a §10 #17]`, `[01a §10 #23]` (GET and POST on a branch outside `allowed_branch_ids` → `404 BRANCH_NOT_FOUND`), `[01a §10 #80]` as §10. Review Focus 1: `[01a §3.3] " ground " is stored as "ground" and duplicates "Ground"` → `409 CONFIG_NAME_TAKEN { entity: 'floor', name: 'Ground' }`. `[01a S8] create floor bumps only that branch`.
- [ ] **Step 2–4:** `pnpm vitest run apps/cloud/test/restaurant apps/cloud/test/cross-tenant.int.test.ts` → FAIL → implement → PASS; `pnpm vitest run --project @pos/cloud`.
- [ ] **Step 5:** Commit `feat(01a): task 11 floors list and create [spec §6.2, §6.3, §6.0, S26]`

### Task 12: Cloud floor PATCH, tables POST/PATCH — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/{routes,service,repository,schemas}.ts`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/tables.int.test.ts`; Modify `apps/cloud/test/restaurant/floors.int.test.ts`.

**Interfaces — Consumes:** `CloudTestHooks.beforeBump` — add `testHooks?: CloudTestHooks` to `CloudDeps` now (the Interfaces block type); the service calls `await deps.testHooks?.beforeBump?.()` right before `bumpConfigVersion`.

- [ ] **Step 1: Tests:** `[01a §10 #18]`, `#19`, `#21`, `#22`, `#83` (replay of a floor create → one audit row; `409` → no audit row; `beforeBump` throws → no floor, no audit row, `config_version` unchanged). `[01a §6.4] restore checks name uniqueness`; `[01a §6.6] moving a table to another branch's floor → 422 wrong_branch`.
- [ ] **Step 2–4:** run → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(01a): task 12 floor patch and tables [spec §6.4–§6.6, S22, S26]`

### Task 13: Cloud snapshot builder v1 — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/config-sync/builders/v1.ts`, `apps/cloud/test/config-sync/builder.int.test.ts`; Modify `apps/cloud/test/helpers/restaurant.ts` (add `seedMenu(pool, f, o)` that inserts floors/tables/stations/programs/tax classes/categories/items/routes by SQL and returns their ids).

`buildSnapshotV1`: 6 fixed statements (floors ⋈ tables; stations ⋈ programs; tax classes; categories; items ⋈ routes for this branch; header is passed in), active rows only except stations (all, with `is_archived`), arrays ordered `sort_order, id`, then `BranchConfigSnapshotSchemaV1.parse`. The repository converts `BIGINT` columns (`price_minor`, `config_version`) with `Number()`; the parse does not coerce, so a missed conversion fails it (S27).

- [ ] **Step 1: Tests:** `[01a §10 #4]`, `[01a §10 #5]` (≤ 12 statements with `pgCounter` for 10 and for 300 items, and equal counts), `[01a §10 #85]` (hub-style `sha256hex(canonicalJson(BranchConfigSnapshotSchemaV1.parse(JSON.parse(JSON.stringify(snapshot)))))` equals the builder's hash; a hand-made copy with `price_minor: "120000"` fails `parse`).
- [ ] **Step 2–4:** run → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(01a): task 13 snapshot builder v1 [spec §6.1, §4.3, S27]`

### Task 14: Cloud `GET /v1/sync/config` — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/config-sync/{routes,service,schemas}.ts`, `apps/cloud/src/modules/config-sync/builders/index.ts`, `apps/cloud/test/config-sync/sync-config.int.test.ts`; Modify `apps/cloud/src/server.ts`, `apps/cloud/test/cross-tenant.int.test.ts`.

Script exactly §6.1 steps 0–5. Query schema: `config_epoch` string (may be empty), `config_version` / `directory_version` int ≥ 0, `snapshot_schema` int ≥ 1 (all `z.coerce`). `304` via `reply.code(304).send()`. `REPEATABLE READ` transaction for the build. Directory part: **only** when `directory_version` differs (the epoch rule for the directory is task 42). Uses `loadDirectory(client, tenantId, branchId)`.

- [ ] **Step 1: Tests:** `[01a §10 #1]`, `#2`, `#3`, `#6`, `#20` (create the parking floor and `P1` through the owner routes, then poll), `#96` (use `createBuilderRegistry({ extra: { 2: testBuilderV2 } })` passed through `CloudDeps.snapshotBuilders`; v2 adds a field `promo_banner`), `#99`.
- [ ] **Step 2–4:** run → FAIL → implement → PASS; cross-tenant passes with the branch-key case.
- [ ] **Step 5:** Commit `feat(01a): task 14 config sync endpoint [spec §6.1, S4, S28, S29]`

### Task 15: Cloud stations — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/stations.int.test.ts`.

§6.8, §6.9. In-use checks use `item_routes_station`; tests seed routes with `seedMenu` (SQL). A batch → slot change archives the station's programs and writes one `batch_program` / `archive` audit row each.

- [ ] **Step 1: Tests:** `[01a §10 #24]`, `#25`, `#26`, `#27`. `[01a S10] two stations "Fryer" in one branch → 409; same name in another branch → 201`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 15 stations [spec §6.8, §6.9, S10, S22]`

### Task 16: Cloud batch programs — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/programs.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #28]`, `#29`, `#30`; `[01a §6.10] archiving a program used as program_id → 409`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 16 batch programs [spec §6.10]`

### Task 17: Cloud tax classes and categories — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/tax-categories.int.test.ts`.

Both tenant-level (`TenantLevelRepository`), bump every branch, `branch_id` null in audit.

- [ ] **Step 1: Tests:** `[01a §10 #31]`, `#32`; `[01a S8] a category create bumps all three branches`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 17 tax classes and categories [spec §6.12, §6.13]`

### Task 18: Cloud menu GET and menu-item POST — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/menu-items.int.test.ts`.

§6.11, §6.14. Route checks lock stations and programs `FOR SHARE` in id order with `= ANY($ids)`; item row and route rows in one multi-row `INSERT` each; reasons per §9. A route branch outside `allowed_branch_ids` → `404 BRANCH_NOT_FOUND`, nothing written.

- [ ] **Step 1: Tests:** `[01a §10 #33]`, `#34`, `#35`, `#36`, `#37` (`pgCounter`, equal count for 1 and 3 routes), `#40`, `#88`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 18 menu read and item create [spec §6.11, §6.14, S11]`

### Task 19: Cloud menu-item PATCH and route PUT — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/menu-patch.int.test.ts`.

§6.15, §6.16. PUT needs no `Idempotency-Key`; `{ station_id: null }` deletes the route (`route_removed`, `after` null).

- [ ] **Step 1: Tests:** `[01a §10 #7]` (table rename at A via §6.6 bumps A only; item price PATCH bumps A, B, C), `#38`, `#39`, `#41`, `#81`, `#82`, `#106`, `#107` (each "in the snapshot" assertion polls `GET /v1/sync/config` with branch A's key).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 19 item patch and route put [spec §6.15, §6.16, S26, S32, S34]`

### Task 20: Cloud lock-order races — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/service.ts` (call `deps.testHooks?.afterTargetLock?.(route)` after the target `FOR UPDATE` and `afterReferenceLock?.(route)` after the reference `FOR SHARE`); Create `apps/cloud/test/restaurant/races.int.test.ts`.

Barrier: the hook for request 1 awaits a promise that the test resolves after request 2 has been sent and is blocked (poll `pg_stat_activity.wait_event_type = 'Lock'` up to 2 000 ms).

- [ ] **Step 1: Tests:** `[01a §10 #86]` both orders; `[01a §10 #87]` both orders plus two concurrent item creates committing. Assert outcome pairs exactly as §10, never an active route on an archived station/program, and no `40P01` deadlock.
- [ ] **Step 2–5:** run → FAIL (or hang → fix lock order per S8) → PASS → commit `feat(01a): task 20 config write lock order [spec S8, §5.2]`

### Task 21: Cloud CLIs — needs Docker Postgres

**Files:** Create `apps/cloud/src/cli/rotate-config-epoch.ts`, `apps/cloud/src/cli/set-branch-settings.ts`, `apps/cloud/test/cli/branch-cli.int.test.ts`; Modify `apps/cloud/package.json` (scripts `rotate-config-epoch`, `set-branch-settings`, `tsx src/cli/….ts`).

**Interfaces — Produces:** `rotateConfigEpoch(sys: SystemContext, input: { branchId: string }, deps: { ids: IdGen }): Promise<{ branch_id: string; config_epoch: string }>`; `setBranchSettings(sys, input: { branchId: string; taxEnabled?: boolean; businessDayStart?: string /* "HH:MM" */ }, deps: { clock; ids }): Promise<{ business_day_start_ms: number; tax_enabled: boolean }>`. Each file has an entry block (like `seed-tenant.ts`) parsing `--branch`, `--tax-enabled true|false`, `--business-day-start HH:MM`. `"HH:MM"` → ms; `24:00`, `05:30:15`, `5:7` → error, nothing written.

- [ ] **Step 1: Tests:** `[01a §10 #101]` (includes: copy only `0001_platform.sql` into a temp dir, `CREATE DATABASE pos_test_mig01a`, migrate it, insert two branches, migrate with the real dir → two distinct non-empty epochs; drop the database; and an ESLint `lintText` check that `apps/cloud/src/modules/x.ts` importing `../cli/system-context` fails), `#105`, `#108`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 21 rotate-config-epoch and set-branch-settings CLIs [spec S29 a, §6.7, S33, S34]`

### Task 22: Hub migration 0004 and projections

**Files:** Create `apps/hub/src/db/migrations/0004_restaurant_config.sql` (verbatim §5.1), `apps/hub/src/projections/branch-config.ts`, `apps/hub/src/projections/item-availability.ts`, `apps/hub/test/projections/restaurant-projections.int.test.ts`; Modify `apps/hub/src/lib/boot.ts` (`registerRestaurantProjections(projections)` in `createDeps`), `apps/hub/test/helpers/test-hub.ts` (same).

Projection `branch_config`: upsert from the payload; `applied_at = event.recorded_at`; `epoch_changed_at = recorded_at` when `previous_config_epoch !== null && previous_config_epoch !== config_epoch`, else the old value. `item_availability`: `ItemMadeUnavailable` → `(item_id, 0, recorded_at, actor_id)`, `ItemMadeAvailable` → `1`. Both have `reset` (`DELETE`).

- [ ] **Step 1: Tests:** `[01a §10 #49]`; `[01a §5.1] BranchConfigApplied upserts branch_config and sets epoch_changed_at only on an epoch change`; `[01a §4.2] itemAvailability(db, [])` returns an empty map with 0 statements.
- [ ] **Step 2–5:** `pnpm vitest run apps/hub/test/projections` → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 22 hub config and availability projections [spec §5.1, S5, S17]`

### Task 23: Hub config holder, client, `pollOnce` core

**Files:** Create `apps/hub/src/sync/{branch-config-holder,config-client,config-poller}.ts`, `apps/hub/test/helpers/stub-config-cloud.ts`, `apps/hub/test/sync/poller.int.test.ts`; Modify `apps/hub/src/server.ts` (`HubDeps.configClient?`; create the poller in `buildHubServer`, store it for `configPoller(app)`), `apps/hub/test/helpers/test-hub.ts` (option `configClient`, call `swapBranchConfig(null)` on create).

**Interfaces — Produces:** Interfaces block (holder, client, poller). `stub-config-cloud.ts`: `stubConfigCloud(): ConfigClient & { calls: ConfigQuery[]; next: ConfigFetch[]; respondWithSnapshot(snapshot: object, o?: { directory?: DirectoryInput; hash?: string }): void }` (`respondWithSnapshot` hashes with `@pos/domain/hash` unless `hash` is given).

`pollOnce` = §3.4 steps 1–6 for one schema version: concurrent calls share one in-flight promise. Apply in one `writer.run`: `INSERT OR IGNORE INTO config_snapshots` (`body = canonicalJson(raw)`, `received_at = clock`), append `BranchConfigApplied` (`stream_type 'hub'`, `stream_id` branch id, `actor_id` null, `device_id 'hub'`), `runBranchConfigHooks(prev, next, tx)`, `tx.onCommit(() => swapBranchConfig(entry))`. Directory part: `applyStaffDirectory(tx, directory, (d) => setDirectory(d))` in the same `writer.run`. Logging per §7.3.

- [ ] **Step 1: Tests:** `[01a §10 #42]`, `#43`, `#44`, `#45`, `#53`, `#54`, `#95` (the stub sends a raw snapshot with an extra field and the hash of the stripped form).
- [ ] **Step 2–5:** `pnpm vitest run apps/hub/test/sync` → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 23 hub config poll and apply [spec §3.4, S5, S6, S28 d]`

### Task 24: Hub poller — schema versions, epoch, hook, commit failure

**Files:** Modify `apps/hub/src/sync/config-poller.ts`; Create `apps/hub/test/sync/poller-versions.int.test.ts`.

Adds §3.4 step 2's version-0 rules (row `snapshot_schema_version < max` → send `config_version=0`), step 3's `409 SNAPSHOT_SCHEMA_UNSUPPORTED` → `upgrade_required`, step 4 (ii) `schema_too_new`, (iii) `schema_invalid`, (iv) epoch rule and `epoch_changed` outcome (log `warn`), and `last_problem` clearing (step 6).

- [ ] **Step 1: Tests:** `[01a §10 #46]` (`testHooks.beforeCommit` throws → `branchConfig()` unchanged, no `config_snapshots` row), `#58`, `#94`, `#97` (hub side: stub serves a schema-1 snapshot, then `409` → config kept, `lastProblem().outcome = 'upgrade_required'`, next `ok` clears it; the cloud side is #96), `#98` (poller with `schemas: { max: 2, byVersion: { 1: V1, 2: V1.extend({ promo_banner: z.string() }) } }`), `#100`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 24 snapshot schema and epoch rules [spec S28, S29 b, c, §4.2]`

### Task 25: Hub boot — config load, `BODY_MISSING`, timer, directory via poll, `QueryCtx`

**Files:** Modify `apps/hub/src/lib/boot.ts` (at the step-3 position: `const loaded = loadBranchConfig(db, branchId)`, `swapBranchConfig(loaded.state === 'APPLIED' ? loaded.entry : null)`; at the step-6 position: `configPoller(app).start()`; `beat.stop` also calls `configPoller(app).stop()`; `BootOptions.configClient?: ConfigClient` passed into deps), `apps/hub/src/sync/config-poller.ts` (`BODY_MISSING` → `config_version=0`; `stop()` cancels the timer and makes an in-flight result skip the swap), `apps/hub/src/queries/registry.ts` (`QueryCtx.state`, `QueryCtx.config`; `QueryRouteDeps` gains `state: StateHolder<unknown>`), `apps/hub/src/server.ts` (pass `state`); Create `apps/hub/test/sync/poller-boot.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #47]` (boot() with a config file after one apply → `branchConfig()` equal; `projections.catchUp` after `DELETE FROM projection_checkpoints WHERE projection = 'branch_config'` rebuilds the same row), `#48`, `#50`, `#51`, `#52`. Review Focus 5: `[01a §7.2] after stop() no poll runs on the next interval, and an in-flight poll resolving after stop() does not swap the config` (fake timers, stub that resolves late).
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm vitest run apps/hub/test/boot` stays green → commit `feat(01a): task 25 hub config boot, body-missing path and poll timer [spec S5, S6, S16, §3.2, §7.2]`

### Task 26: Hub station validator

**Files:** Create `apps/hub/src/sync/station-validator.ts`, `apps/hub/test/sync/station-validator.int.test.ts`; Modify `apps/hub/src/server.ts` (import `./sync/station-validator.js` for its side effect, before routes).

Body exactly §6.22.

- [ ] **Step 1: Test:** `[01a §10 #57]` (ApprovePairingRequest for a KDS screen request as in 00's tests).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 26 station validator from branch config [spec §6.22, M31]`

### Task 27: Hub engine reducer and boot stock fold

**Files:** Modify `apps/hub/src/lib/boot.ts` (lines 278–279: `createStateHolder<EngineState>(initialState)` and `state.setReducer(applyEvent)`; at the step-3 position fold the `stock` stream: `SELECT … FROM events WHERE branch_id = ? AND event_type = 'StockSet' ORDER BY seq` → `buildEngineState` → pass as `initialState` to `createDeps`), `apps/hub/src/setup/issue-admin-bootstrap.ts:44–45`, `apps/hub/test/helpers/test-hub.ts` (same two lines), `apps/hub/src/server.ts` (`HubDeps.state: StateHolder<EngineState>`), `apps/hub/src/commands/registry.ts` (`CommandCtx.state: Readonly<EngineState>`); `apps/hub/package.json` (`"@pos/engine": "workspace:*"`), `pnpm-lock.yaml`; Create `apps/hub/test/boot/stock-fold.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #67]`, `[01a §10 #93]` (advance the boot clock by 1 h before restart; `set_at` unchanged).
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm typecheck && pnpm test` → commit `feat(01a): task 27 engine reducer and boot stock fold [spec S15, §2]`

### Task 28: Hub `SetPrecookedStock`

**Files:** Create `apps/hub/src/commands/set-precooked-stock.ts`, `apps/hub/test/commands/set-precooked-stock.int.test.ts`; Modify `apps/hub/src/server.ts` (`registerSetPrecookedStock(app)`).

`defineCommand({ commandType: 'SetPrecookedStock', sessionKind: 'admin', permission: 'manage-stock', … })`. Payload Zod: `entries` 1–200, `refine` unique `item_id`. Handler per §6.17 (validate **all** entries before producing any event); result values from `stockOf(ctx.state, id)` with `on_hand` replaced and `set_at = ctx.clock.branchNow()` for changed rows.

- [ ] **Step 1: Tests:** `[01a §10 #59]`, `#60`, `#61`, `#62`, `#63`, `#64`, `#65` (#65: `testHooks.beforeCommit` throws → `deps.state.get().stock` unchanged).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 28 set pre-cooked stock [spec §6.17, S14, S18]`

### Task 29: Hub `SetItemAvailability` and `itemAvailability`

**Files:** Create `apps/hub/src/commands/set-item-availability.ts`, `apps/hub/test/commands/set-item-availability.int.test.ts`; Modify `apps/hub/src/server.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #69]`, `#70`, `#71` (`statementCounter` on `deps.db`: 1 statement for 1 id and for 100 ids).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 29 item availability [spec §6.18, S17]`

### Task 30: Hub business day and stock query

**Files:** Create `apps/hub/src/lib/business-day.ts`, `apps/hub/src/lib/business-day.test.ts`, `apps/hub/src/queries/stock.ts`, `apps/hub/test/queries/stock.int.test.ts`; Modify `apps/hub/src/server.ts`.

`businessDayStartedAt`: local midnight of `nowMs` (via `new Date(nowMs)` + `setHours(0,0,0,0)`, OS time zone) + `business_day_start_ms`; if that is > `nowMs`, subtract one day (use `setDate(d − 1)`, not − 86 400 000). Tests set `process.env.TZ = 'Asia/Karachi'` in `beforeAll`. Stock query: resource `stock`, `sessionKind: 'admin'`, `session: 'none'` (the admin guard supplies the session); handler checks `ctx.directory.resolve(ctx.session.staff_id, 'manage-stock').grant === 'allowed'` else `403 PERMISSION_DENIED { permission: 'manage-stock' }`; shape and statement count exactly §6.19.

- [ ] **Step 1: Tests:** `[01a §10 #104]` (unit), `[01a §10 #72]`, `[01a §10 #103]`; `[01a §6.19] an admin without manage-stock → 403`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 30 business day and stock query [spec §6.19, S30, S33]`

### Task 31: Hub config status and `pull-now`

**Files:** Create `apps/hub/src/queries/config-status.ts`, `apps/hub/src/sync/config-routes.ts`, `apps/hub/test/sync/config-routes.int.test.ts`; Modify `apps/hub/src/server.ts`.

`POST /admin/config/pull-now` (`group: 'admin'`): `Promise.race([poller.pollOnce(), a 12 000 ms setTimeout])` (a real timer: it bounds a network wait, it records nothing); `applied`/`epoch_changed`/`unchanged` → `200 { data: { outcome, config_version, directory_version } }` (`epoch_changed` reported as `applied`); anything else or timeout → `503 SERVICE_UNAVAILABLE { retry_after_ms: 60000 }` (log `error` for `unauthorized`). Config status: resource `config-status`, shape §6.21.

- [ ] **Step 1: Tests:** `[01a §10 #55]`, `#56`, `#102` (server part: hash-mismatch poll → `last_problem { rejected, hash_mismatch, at }`; cleared after the next `unchanged`).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 31 config status and pull-now [spec §6.20, §6.21, S24, S29 c]`

### Task 32: Hub WS audiences and catch-up parts

**Files:** Create `apps/hub/src/ws/restaurant-audiences.ts`, `apps/hub/src/ws/restaurant-catch-up.ts`, `apps/hub/test/ws/restaurant-ws.int.test.ts`; Modify `apps/hub/src/server.ts` (side-effect imports).

Audiences per §4.5 table (`socket.kind`). Catch-up parts `branch_config`, `availability`, `stock` per §4.5 (`stock` lists only stock-tracked items of `branchConfig()`, values from `stockOf`/`availableStock`).

- [ ] **Step 1: Tests:** `[01a §10 #73]`, `#89`, `#90` (`vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] })`), `#91`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 32 restaurant ws pushes and catch-up [spec §4.5]`

### Task 33: Hub `GET /queries/branch-config`

**Files:** Create `apps/hub/src/queries/branch-config.ts`, `apps/hub/test/queries/branch-config.int.test.ts`; Modify `apps/hub/src/server.ts`.

`defineQuery({ resource: 'branch-config', sessionKind: 'device', session: 'required', allowStation: true, … })` returning `{ data: { config_version, snapshot_hash, snapshot } }` or `{ data: null }` from `currentConfigEntry()`.

- [ ] **Step 1: Test:** `[01a §10 #92]`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 33 branch config query [spec §6.23]`

### Task 34: `apps/client` scaffold

**Files:** Create `apps/client/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts}`, `apps/client/owner/index.html`, `apps/client/admin-stock/index.html`, `apps/client/src/app/{router.ts,mount.tsx}`, `apps/client/src/features/owner/main.tsx`, `apps/client/src/features/admin/stock/main.tsx`, `apps/client/src/i18n/{en.ts,index.ts}`, `apps/client/src/app/router.test.tsx`, `apps/client/test/lint.test.ts`; Modify `eslint.config.js`, `.gitignore` (`apps/client/dist` if `dist` is not already ignored), `pnpm-lock.yaml`.

`package.json`: `"name": "@pos/client"`, `"private": true`, `"type": "module"`, deps exactly S35 g plus `"@pos/domain": "workspace:*"`, `"@pos/events": "workspace:*"`; scripts `build`: `vite build --mode owner && vite build --mode admin-stock`, `typecheck`: `tsc --noEmit`. `vite.config.ts`: `defineConfig(({ mode }) => ({ root: resolve(dir, mode), base: mode === 'owner' ? '/owner/' : '/admin/stock/', build: { outDir: resolve(dir, 'dist', mode), emptyOutDir: true } }))`; unknown mode throws. JSX uses Vite's built-in transform with the tsconfig `jsx: "react-jsx"`; no plugin. `tsconfig.json`: `jsx: "react-jsx"`, `lib: ["ES2023", "DOM", "DOM.Iterable"]`, `types: []`. `vitest.config.ts`: `defineProject({ test: { environment: 'jsdom' } })`. Each `main.tsx` mounts a placeholder view with an i18n title. ESLint, for `apps/client/**/*.{ts,tsx}`: `no-restricted-syntax` adds `JSXAttribute[name.name="dangerouslySetInnerHTML"]`; `no-restricted-imports` patterns `@pos/domain/hash`, `node:*`, `**/apps/hub/**`, `**/apps/cloud/**`, `**/hub/src/**`, `**/cloud/src/**`; the F §6.7 clock rule is off for `apps/client/src/**`.

- [ ] **Step 1: Tests:** `router.test.tsx`: `[01a S35 b] useHashRoute follows hashchange`. `lint.test.ts` (ESLint `lintText` with `filePath` under `apps/client/src/`): `[01a §10 #79]` each forbidden import fails, `@pos/domain` and `@pos/events` pass; `[01a S35 e] dangerouslySetInnerHTML fails lint`.
- [ ] **Step 2:** `pnpm install && pnpm vitest run --project @pos/client` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS; `pnpm --filter @pos/client build` → `apps/client/dist/owner/index.html` and `dist/admin-stock/index.html` exist; `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 34 client app scaffold [spec S35]`

### Task 35: `client-dist` helper, `/owner/*` allowlist and CSP — needs Docker Postgres

**Files:** Create `apps/hub/src/lib/client-dist.ts`, `apps/cloud/src/lib/client-dist.ts`, `apps/hub/test/client-dist.int.test.ts`, `apps/cloud/test/owner-pages.int.test.ts`; Modify `apps/hub/src/server.ts` (`registerClientDist(app, { prefix: '/admin/stock/', dir: <apps/client/dist/admin-stock>, routeConfig: { group: 'admin-bootstrap' } })`), `apps/cloud/src/server.ts` (prefix `/owner/`, `routeConfig: { tenantScope: 'none' }`, CSP header), `apps/cloud/src/plugins/tenant-scope.ts` (`TENANT_SCOPE_ALLOWLIST` += `'GET /owner/'`, `'GET /owner/*'`), `apps/cloud/test/route-inventory.int.test.ts` (`ALLOWLIST`), root `package.json` (`"test": "pnpm --filter @pos/client build && vitest run"`).

Helper per §7.1: read the file list once at registration; missing dir → `app.log.error` and every path 404; `GET <prefix>` → `index.html`; `GET <prefix>*` → listed file or `404 ROUTE_NOT_FOUND`; types `.html text/html; charset=utf-8`, `.js text/javascript; charset=utf-8`, `.css text/css; charset=utf-8`, `.woff2 font/woff2`, `.svg image/svg+xml`, `.png image/png`. The two copies are identical except imports (§12.4).

- [ ] **Step 1: Tests:** hub file `[01a §10 #78]`: one test runs the same cases (temp dir with `index.html`, `assets/a1.js`, a file outside; and a missing dir) against both helpers, importing the cloud one by relative path (`../../cloud/src/lib/client-dist`; it imports only `node:*` and `fastify`). Cloud file `[01a §10 #15]` (reads the real `apps/client/dist/owner/index.html`: no `<script>` without `src`; `GET /ui/tokens.css` → 404; route inventory passes).
- [ ] **Step 2–5:** `pnpm --filter @pos/client build && pnpm vitest run apps/hub/test/client-dist.int.test.ts apps/cloud/test/owner-pages.int.test.ts apps/cloud/test/route-inventory.int.test.ts` → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 35 serve built client pages [spec §7.1, S21, S35 c]`

### Task 36: Owner app shell — login, router, API client, money

**Files:** Create `apps/client/src/features/owner/money.ts`, `money.test.ts`, `apps/client/src/api/cloud-admin.ts`, `apps/client/src/api/cloud-admin.test.ts`, `apps/client/src/features/owner/login/LoginView.tsx`, `apps/client/src/features/owner/BranchPicker.tsx`, `apps/client/src/features/owner/App.tsx`, `apps/client/src/features/owner/form.ts` (`useIdempotencyKey()`: a key per opened form, kept across retries); Modify `apps/client/src/features/owner/main.tsx`, `apps/client/src/i18n/en.ts`.

`cloud-admin.ts`: tokens in `sessionStorage` (`owner_access_token`, `owner_refresh_token`); on `401 JWT_INVALID` call `/v1/auth/refresh` once and retry the same request (same headers, same `Idempotency-Key`); second `401` → clear storage, `onLoggedOut()`. Branch picker lists `allowed_branch_ids` decoded from the JWT payload (S37). UI per §8.1 rules (UI kit classes, busy button, 3 s slow banner, network-failure banner keeps the form).

- [ ] **Step 1: Tests:** `[01a §10 #74]`; Review Focus 2: `[01a §8.1] " 1,200 " → 120000; "1,20,000" → 12000000; "١٢٠٠" rejected`; `[01a §10 #76]` (form component: submit fails with network error, retry sends the same key; reopen → new key); Review Focus 3: `[01a §8.1] 401 → one refresh → retried with the same Idempotency-Key; second 401 → onLoggedOut and storage cleared`.
- [ ] **Step 2–5:** `pnpm vitest run --project @pos/client` → FAIL → implement → PASS → commit `feat(01a): task 36 owner app shell and money parsing [spec §8.1, S35, S37]`

### Task 37: Owner floors and stations views

**Files:** Create `apps/client/src/features/owner/floors/FloorsView.tsx`, `FloorsView.test.tsx`, `apps/client/src/features/owner/stations/StationsView.tsx`, `StationsView.test.tsx`; Modify `apps/client/src/api/cloud-admin.ts` (typed calls §6.2–6.10), `apps/client/src/features/owner/App.tsx`, `apps/client/src/i18n/en.ts`.

- [ ] **Step 1: Tests:** `[01a §8.1] floors view lists floors with tables, archived rows filtered by a toggle, sort number edits send PATCH { sort_order }`; `[01a §8.1] stations view shows freshness only for batch and shows errors.CONFIG_IN_USE text on 409`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 37 owner floors and stations views [spec §8.1]`

### Task 38: Owner menu view

**Files:** Create `apps/client/src/features/owner/menu/{MenuView,ItemForm}.tsx`, `MenuView.test.tsx`; Modify `apps/client/src/api/cloud-admin.ts` (§6.11–6.16), `apps/client/src/features/owner/App.tsx`, `apps/client/src/i18n/en.ts`.

Tax picker: "No tax" first and default (`tax_class_id: null`); route picker per branch filtered by station type (program select only for batch); minutes ↔ `_ms`; "When pre-cooked stock runs out": Cook fresh (default) / Sold out.

- [ ] **Step 1: Tests:** `[01a §10 #75]` (render; `container.querySelector('img')` is null and the name text is present); `[01a S34] a new item form defaults to No tax and sends tax_class_id null`; `[01a S11] choosing a batch station shows the program select, a slot station hides it`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 38 owner menu view [spec §8.1, S32, S34]`

### Task 39: Hub `/admin/stock` app

**Files:** Create `apps/client/src/api/hub-admin.ts`, `hub-admin.test.ts`, `apps/client/src/features/admin/stock/{StockApp,PinLogin,StockTable,Banners}.tsx`, `StockApp.test.tsx`; Modify `apps/client/src/features/admin/stock/main.tsx`, `apps/client/src/i18n/en.ts`.

`hub-admin.ts` calls the same endpoints as 00's admin pages (read `apps/hub/src/auth/admin-session.ts` and `pair-page.ts` for paths, headers, the IndexedDB `pos-device` / store `device` and `sessionStorage` keys). Page per §8.2: reads stock + config status on open and every 15 000 ms while `document.visibilityState === 'visible'`; Save counts sends changed rows only with a `command_id` kept for retries; badges use `business_day_started_at`.

- [ ] **Step 1: Tests:** `[01a §10 #77]`; `[01a §8.2, S29 c] danger banner for rejected / upgrade_required / unauthorized; warn banner when epoch_changed_at is within 24 h, not after`; `[01a §8.2] on_hand values are sent as numbers`; Review Focus 4: `[01a §8.2] a refresh does not overwrite the row being edited`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm --filter @pos/client build` → commit `feat(01a): task 39 hub stock and availability page [spec §8.2, S29 c, S30, S33]`

### Task 40: Spec 00 v1.3 entry for `allowNotNewer` — Claude only, STOP

**Files:** Modify the 00 spec (behaviour entry for S36 b: `applyStaffDirectory(tx, d, setDirectory, { allowNotNewer })`, narrowing M51), bump to v1.3; `docs/specs/README.md` row.

- [ ] Write the entry; get the user's approval (§12.1 last bullet). **STOP** until approved.
- [ ] Commit `feat(01a): task 40 spec 00 v1.3 allowNotNewer entry [spec S36]`

### Task 41: `applyStaffDirectory` `allowNotNewer`

**Files:** Modify `apps/hub/src/auth/apply-directory.ts` (4th parameter; `if (d.directory_version <= current && opts?.allowNotNewer !== true)` keeps today's path); Create `apps/hub/test/auth/apply-directory-not-newer.int.test.ts`.

- [ ] **Step 1: Test:** `[01a §10 #112]`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm vitest run apps/hub/test/auth` unchanged → commit `feat(01a): task 41 applyStaffDirectory allowNotNewer [spec S36 b, 00 v1.3]`

### Task 42: Directory resend on epoch change — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/config-sync/service.ts` (directory when `directory_version` differs **or** the epoch differs), `apps/hub/src/sync/config-poller.ts` (step 5 b: `{ allowNotNewer: outcome === 'epoch_changed' }`, and the directory part is applied on `epoch_changed` even when not newer); Create `apps/cloud/test/config-sync/directory-resend.int.test.ts`, `apps/hub/test/sync/directory-resend.int.test.ts`.

- [ ] **Step 1: Tests:** cloud `[01a §10 #109]`; hub `[01a §10 #110]`, `[01a §10 #111]`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 42 directory resend on epoch change [spec S36]`

### Task 43: Manual runbook — needs Docker Postgres (optional: needs hardware)

**Files:** none. Cursor runs the steps and reports each result in the chat; Claude writes `docs/runbooks/01a-manual-test.md` from the report in task 44 (`docs/` is Claude only).

- [ ] Start Postgres, cloud, hub (provisioned against the local cloud). `seed-tenant`, `issue-registration-code`, provision.
- [ ] Owner logs in at `http://localhost:3001/owner/`, creates a floor, a slot station "Karahi", a batch station "Fryer" with a program, a category, two items (one with stock time). Within 60 s the hub `/admin/stock/` shows them (or press **Get changes now**).
- [ ] Pair a KDS browser to "Karahi" (00 screen-request flow) → paired.
- [ ] Unplug the internet (stop the cloud); set stock counts and toggle an item off → saved; config status shows "offline".
- [ ] Restore drill: `pg_dump` the cloud DB, make two menu edits and remove a staff member, restore the dump, run `pnpm --filter @pos/cloud rotate-config-epoch --branch <id>`; the hub applies the older menu and directory and the stock page shows the epoch banner.
- [ ] Optional, **needs hardware** (pilot mini PC): `SetPrecookedStock` with 200 entries ≤ 50 ms p95 (§7.5).
- [ ] No commit (report results).

### Task 44: README, spec status, runbook, DoD close-out — Claude only

**Files:** Modify `docs/specs/README.md` (01a status, carried requirements §4.4, 00 drift notes §2), `docs/specs/01_Restaurant_Setup_Spec_v0.4.md` status line; Create `docs/runbooks/01a-manual-test.md` (from task 43's report).

- [ ] `for n in $(seq 1 112); do c=$(grep -rhoE "\[01a §10 #$n\]" apps packages | wc -l); [ "$c" = 1 ] || echo "#$n: $c"; done` → no output.
- [ ] Walk §12.1 and §12.2; record gaps.
- [ ] Commit `feat(01a): task 44 module 01a close-out [spec §12.1]`
