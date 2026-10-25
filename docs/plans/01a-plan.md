# 01a Restaurant Setup — Implementation Plan (spec v0.5)

> **For the implementer (Cursor, no plugins):** follow `.cursor/rules/pos.mdc` (task 3 points it at this plan). Do **one task per request**, in order. Each task: write the listed tests first, run them and see them fail for the stated reason, implement, run the task command and then `pnpm test`, check **Done when**, commit. Steps use checkboxes (`- [ ]`); do **not** tick them in this file (it is read-only for you). Tasks marked **Claude only** edit `docs/`, `.cursor/` or the foundation: **skip them and tell the user**. Tasks marked **Gated** wait for the named item in "Needs spec change" to be settled in the spec.

**Goal:** Build module 01a: cloud restaurant data (floors, tables, stations, programs, tax classes, categories, items, per-branch routes) with idempotent creates and an audit trail; config delivery to the hub through a conditional poll; the hub's config apply as an event, the stock slice of `@pos/engine`, pre-cooked stock and availability commands; the owner app and the hub `/admin/stock` page as entries of one Vite app, `apps/client`, with its build and hub release script.

**Architecture:** The cloud owns the menu; every owner write runs one PostgreSQL transaction (idempotency key → lock → checks → write → `config_audit` → `bumpConfigVersion`). The hub polls `GET /v1/sync/config` every 60 s, verifies the snapshot hash over the raw JSON, and applies it in one `writer.run` (`config_snapshots` insert + `BranchConfigApplied` + optional staff directory), swapping the in-memory config after COMMIT. Stock lives only in `EngineState.stock`, folded from `StockSet` events.

**Tech stack:** existing 00 stack (Fastify 5.12.7, Zod 4.6.7, better-sqlite3 13.0.3, pg 8.23.1, Vitest 4.1.12, ESLint 10.13.0) + `apps/client` only: React 19.3.1, Vite 8.3.5, jsdom 30.1.3.

**Spec:** `docs/specs/01_Restaurant_Setup_Spec_v0.5.md` (cited "§x" or "S12"); foundation `docs/specs/00_Foundation_Spec_v1.7.md` ("F §x"); 00 spec `docs/specs/00_Hub_Platform_Access_Spec_v1.2.md` ("00 Mxx"). Read the cited spec section before each task; the plan does not repeat the spec's tables. Review applied: `docs/reviews/01a_plan_review.md` (cited "R#n").

**Gate before task 4 (R1):** spec v0.5 is a DRAFT that has not been reviewed and is not yet committed. Start task 4 only after the user has committed the spec, run its hostile review (CLAUDE.md pipeline step 4) and re-baselined this plan on the reviewed version.

**Starting point:** module 00 is built. Reuse, do not recreate: hub `writer.run`, `createStateHolder`, `createProjectionRegistry`, `registerBootStep`, `defineCommand` / `commandRegistry(app)`, `defineQuery` / `queryRegistry(app)`, `registerStationValidator` / `stationExists`, `registerEventAudience`, `registerCatchUp`, `applyStaffDirectory`, `swapDirectory(app, …)`, `lib/hash.ts`, `lib/ui-assets.ts` (pattern for §7.1), `setup/cloud-client.ts` (pattern for the poll client), test helpers `createTestHub`, `seedDirectory`, `pairDevice`, `openSession`, `statementCounter`, `connectWs`, `aDirectory`; cloud `TenantScopedRepository`, `TenantLevelRepository`, `registerTenantScope` (`TENANT_SCOPE_ALLOWLIST`), `registerErrorHandler`, `loadDirectory` (`modules/hub-registration/repository.ts`), `SystemContext`, `seedTenant`, `issueRegistrationCode`, `createTestCloud`, `truncateAll`; the manual setup in `docs/manual-test-00.md`.

## Markers

| Marker | Meaning |
|---|---|
| **Claude only** | Edits `docs/`, `.cursor/` or the foundation. Cursor skips it. |
| **Gated (N#)** | Do not start until "Needs spec change" item N# is settled in the spec. |
| **needs Docker Postgres** | The task's own command needs Postgres. Note: **every** `pnpm test` runs the cloud suite, so keep `docker compose up -d postgres` running for every task (R19). |
| **needs hardware** | Needs the pilot mini PC or another `ssh` target. Only task 54 (release drill, §7.5 timing). |
| **STOP** | Do not start the next task until the user confirms. |

## Global Constraints

Every task implicitly includes these. Values copied from the spec.

- **Node:** 22.22.2 or later on dev machines and CI (S35 g; jsdom 30.1.3 needs it).
- **Dependencies (§12.1, S35 g):** none new in `apps/hub`, `apps/cloud`, `packages/*` except workspace links (`@pos/engine` in `apps/hub`) and, if N1 is approved, `@types/node@22.19.1` (dev) in `packages/domain`. `apps/client` only, a closed list: `react@19.3.1`, `react-dom@19.3.1` (runtime); `vite@8.3.5`, `jsdom@30.1.3`, `@types/react@19.3.0`, `@types/react-dom@19.3.0` (dev). Exact pins. No router, state, form, CSS or testing library; no React plugin.
- **Determinism (F §6.7):** no `Date.now()`, `Math.random()`, `ulid()`, `crypto.randomUUID()` in hub/cloud/package `src/` (lint enforces). `apps/client/src/**` is browser code and may use them (task 40 sets the lint block).
- **Envelope (F §6.1):** `{ data }` or `{ error: { code, message, details, request_id } }`. The only body-less reply is §6.1's `304`. Replays add `Idempotent-Replay: true`. `503` adds `Retry-After` (the 00 error handlers do it from `details.retry_after_ms`).
- **Errors:** only catalogue codes; `throw new DomainError(code, details)`. New codes exist after task 4.
- **Naming (F §6.6):** snake_case on the wire and in SQL; camelCase in TS; `*_at` Unix ms; `*_ms` durations; money `*_minor` integer.
- **Cloud SQL (D54):** owner routes query only through `TenantScopedRepository` (branch-level tables: SQL uses `$1` tenant and `$2` branch-id array, e.g. `WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3`) or `TenantLevelRepository` (SQL contains `tenant_id = $1`; tenant-level tables `tax_classes`, `categories`, `menu_items`, `idempotency_keys`, `config_audit`, plus `branches` for `bumpConfigVersion` only, see N3). Both accept a `pg.PoolClient`. Path `branch_id` not in `request.tenant.branchIds` → `404 BRANCH_NOT_FOUND`.
- **Cloud write script (§6 intro):** Zod → `BEGIN` → [creating POST: idempotency key insert] → target `FOR UPDATE` (`404` if absent) → reference rows `FOR SHARE` in id order → write → `writeConfigAudit` → `bumpConfigVersion` (branch rows last) → [store response on key] → `COMMIT`. pg `23505` on an `*_active_name` index → `409 CONFIG_NAME_TAKEN { entity, name }`. Route body schemas are validated before the tenant guard runs, so tests that expect `401`/`404` send a valid body (R39).
- **Hub SQL:** `writer.run` only; no `await` inside it; queries never write; query handlers `prepare` per call (so `statementCounter` on `deps.readDb` sees them, R31).
- **Fixed values:** poll interval 60 000 ms; poll HTTP timeout 10 000 ms; `pull-now` wait 12 000 ms, `503` with `retry_after_ms: 60000`; names 1–60 chars trimmed, unique case-insensitive among active rows; `price_minor` 0…1 000 000 000; `cook_time_ms` 1…14 400 000; `prep_buffer_ms` 0…3 600 000; `stock_time_ms` null or 0…`cook_time_ms`; `rate_bp` 0…10 000; station `capacity` 1…100; `freshness_window_ms` batch only 0…3 600 000 default 0; `completion_mode` `two_tap` (default) / `single_tap` / `auto_done`; `seats` null or 1…100; `description` ≤ 300; `out_of_stock_behaviour` `cook_fresh` (default) / `sold_out`; `business_day_start_ms` 0…86 340 000, multiple of 60 000, default 18 000 000; idempotency rows pruned after 86 400 000 ms; stock entries 1–200, `on_hand` int 0…9 999; `SNAPSHOT_SCHEMA_MAX = 1`, cloud `SNAPSHOT_SCHEMA_MIN_SERVED = 1`; stock page refresh 15 000 ms; epoch banner window 86 400 000 ms; CSP `default-src 'self'; frame-ancestors 'none'`; `Cache-Control` `no-cache` (index.html) and `public, max-age=31536000, immutable` (`assets/*`).
- **Client (S35 d–f):** styling only through `apps/client/src/app/ui-kit.ts` (the only CSS imports); no `style` prop; no `dangerouslySetInnerHTML`; shared components in `src/components/`.
- **Secrets never logged:** the poller never logs the snapshot body or the directory (PIN hashes).
- **Tests:** names `it('[01a §10 #N] …')`, each N in exactly one test (coverage table); other tests cite a section `it('[01a §6.4] …')`. Hub integration `apps/hub/test/**/*.int.test.ts`; cloud integration `apps/cloud/test/**/*.int.test.ts`; unit `*.test.ts` next to source; client `apps/client/src/**/*.test.tsx` and `apps/client/test/*.test.ts`.
- **Cross-tenant and route inventory (D54, M25):** every task that adds a cloud route adds a case to `ROUTE_CASES` in `apps/cloud/test/cross-tenant.int.test.ts` (task 12 creates it) whose path/payload names tenant B's ids and whose body is otherwise valid; the 00 tests stay green.
- **Commit:** `feat(01a): task N <title> [spec §x]`, only the task's files: `git add <files> && git commit -m "…"`.

## Needs spec change (for the user; the plan does not edit the spec)

| # | Item | Plan meanwhile | Gates |
|---|---|---|---|
| N1 | §12.1 says no new dependency in `packages/*`, but `@pos/domain/hash` (S27) imports `node:crypto` and `packages/domain` cannot typecheck it without `@types/node`. Allow `@types/node@22.19.1` (dev) in `packages/domain`. | Task 5 adds it | task 5 |
| N2 | §4.2 `onBranchConfigApplied(fn)` gives `fn(prev, next)` but says the hook appends events in the same transaction. Add the transaction: `fn(prev, next, tx: WriterTx)`. | Task 28 builds the 3-argument form | task 28 |
| N3 | S8 / §5.2: `bumpConfigVersion`'s tenant-wide bump must reach every branch, not only the JWT's `allowed_branch_ids`, so it queries `branches` through `TenantLevelRepository`. Record `branches` as a tenant-level access for this helper only (R2). | Task 11 does this | — |
| N4 | §3.4 step 1 / §6.20 / §6.21: the result of a skipped poll (hub not provisioned or not confirmed) is not defined (R13). | `pollOnce()` makes no HTTP call, returns `{ outcome: 'offline', … }`, records nothing in `last_poll`; `pull-now` answers `503` | — |
| N5 | §6.20 lists only `applied` / `unchanged` → `200` (R29). | `epoch_changed` → `200` with `outcome: 'applied'`; `rejected`, `upgrade_required`, `unauthorized`, `offline`, timeout → `503` | — |
| N6 | S25 says "line 7 (version)"; the 00 spec's Version row is line 8 (R40). | Task 1 edits line 8 | — |
| N7 | §8.1 money: only `"1,200"` is specified. Decide on surrounding spaces, lakh grouping `"1,20,000"` and odd grouping `"1,2,3"` (R45). | Trim spaces; accept digits with optional standard 3-digit comma groups and ≤ 2 decimals; reject lakh and odd grouping | — |
| N8 | §6.17 result `set_at` uses the command's clock; the stored `set_at` is the event's `recorded_at`, read again by `appendEvents`, so they can differ by milliseconds (R33). | Result uses `ctx.clock.branchNow()`; the stock query is the authority | — |
| N9 | §4.2/S16 `QueryCtx.config` (a `BranchConfig`) has the same name as `CommandCtx.config` (`HubConfig`) (R42). | Keeps the spec name | — |
| N10 | §7.5 performance targets have no automated test (R27). | Task 54 measures them by hand | — |
| N11 | §10 #75, #102, #104 each have a server part and a page part; "one test per number" (§12.1). | Number on the server/unit part; the other part is an unnumbered test citing the section | — |
| N12 | First boot after migration 0004 on a hub with history replays the whole log for the two new projections (R4). Acceptable for the pilot (small logs); confirm. | No skip logic | — |

## Review Focus

Inputs the spec implies but no §10 test covers. Each has a test in the named task.

1. **Names with surrounding spaces or other case** (`" ground "` vs `"Ground"`): stored trimmed; the duplicate is `409 CONFIG_NAME_TAKEN` → task 13.
2. **Prices typed as `" 1,200 "` or `"1,2,3"`**: the first is `120000`, the second is rejected (N7) → task 44.
3. **An owner's access token expiring mid-form**: one refresh, the same request retried with the same `Idempotency-Key`; a second `401` clears storage and goes to `#/login` → task 44.
4. **The 15 s stock refresh landing while the manager types a count**: that row keeps the typed value → task 50.
5. **Shutdown during a poll**: after `stop()` no further poll runs, and an in-flight poll that resolves later does not swap the config → task 30.

---

## Interfaces (later tasks rely on these exact names)

```ts
// packages/domain/src/hash.ts — subpath "@pos/domain/hash" (task 5). Not re-exported from the root.
export function canonicalJson(v: unknown): string;
export function sha256hex(s: string | Buffer): string;

// packages/events/src/config.ts (task 6)
export const SNAPSHOT_SCHEMA_MAX = 1;
export const BranchConfigSnapshotSchemaV1: z.ZodObject<…>;            // §4.3; NOT .strict()
export type BranchConfig = z.infer<typeof BranchConfigSnapshotSchemaV1>;
export type ConfigItem = BranchConfig['items'][number];
export type ConfigStation = BranchConfig['stations'][number];
export const SNAPSHOT_SCHEMAS: Readonly<Record<number, z.ZodType<BranchConfig>>>; // { 1: V1 }
export function isStockTracked(config: BranchConfig, item: ConfigItem): boolean;   // §4.3 last paragraph
export const SyncConfigEnvelopeSchema; // { data: { config: { snapshot_hash: string; snapshot: Record<string, unknown> } | null; directory: DirectoryInput | null } }

// packages/events (task 7): BranchConfigApplied, StockSet, ItemMadeUnavailable, ItemMadeAvailable (v1, §4.2)
// packages/events/testing: aBranchConfigApplied(o?), aStockSet(o?), anItemMadeUnavailable(o?), anItemMadeAvailable(o?), aBranchConfig(o?): BranchConfig

// packages/engine/src (task 8) — package "@pos/engine"
export interface StockEntry { on_hand: number; reserved: number; set_at: number | null }
export interface EngineState { stock: Record<string, StockEntry> }
export const ENGINE_STATE_VERSION = 1;
export function initialEngineState(): EngineState;
export function applyEvent(state: EngineState, event: PosEvent): EngineState;    // pure; unknown events return `state` (same reference)
export function buildEngineState(events: readonly PosEvent[]): EngineState;
export function stockOf(state: EngineState, itemId: string): StockEntry;         // missing → { on_hand: 0, reserved: 0, set_at: null }
export function availableStock(state: EngineState, itemId: string): number;      // max(0, on_hand − reserved)

// apps/cloud/src/lib/idempotency.ts (task 10)
export async function inTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>, o?: { isolation?: 'REPEATABLE READ' }): Promise<T>;
export interface IdempotentResult<T> { status: number; body: T; replay: boolean }
export async function withIdempotency<T>(
  ctx: { pool: pg.Pool; clock: Clock; tenant: TenantContext },
  request: { key: string | undefined; route: string; body: unknown },
  fn: (client: pg.PoolClient) => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>>;
export function sendIdempotent(reply: FastifyReply, r: IdempotentResult<unknown>): FastifyReply;

// apps/cloud/src/lib/config-version.ts and config-audit.ts (task 11)
// A runner whose $1 is already bound to the tenant id: TenantLevelRepository satisfies it; CLIs build one from SystemContext.
export interface TenantSql { query<R extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<R[]> }
export type BumpScope = { kind: 'branch'; branchId: string } | { kind: 'tenant' };
export async function bumpConfigVersion(db: TenantSql, scope: BumpScope): Promise<Array<{ branch_id: string; config_version: number }>>;
export type AuditEntity = 'floor'|'table'|'station'|'batch_program'|'tax_class'|'category'|'menu_item'|'item_route'|'branch_settings';
export type AuditAction = 'create'|'update'|'archive'|'restore'|'route_set'|'route_removed';
export interface AuditEntry { actor: { kind: 'owner'; ownerUserId: string } | { kind: 'cli' }; entity: AuditEntity; entityId: string; branchId: string | null; action: AuditAction; before: object | null; after: object | null }
export async function writeConfigAudit(db: TenantSql, entry: AuditEntry, deps: { clock: Clock; ids: IdGen }): Promise<void>;
export function auditActionFor(before: { archived_at: number | null }, after: { archived_at: number | null }): 'update' | 'archive' | 'restore';

// apps/cloud/src/server.ts (task 12): CloudDeps gains testHooks?: CloudTestHooks; snapshotBuilders?: BuilderRegistry (typed in task 16)
export interface CloudTestHooks {
  handlerStart?(route: string): void;                 // first line of a handler: tests reset pgCounter here (R9)
  afterTargetLock?(route: string): Promise<void>;     // task 22
  afterReferenceLock?(route: string): Promise<void>;  // task 22
  beforeBump?(): Promise<void>;                       // task 14
}
// apps/cloud/test/helpers/test-cloud.ts (task 12): createTestCloud(o?: { captureLogs?: boolean; testHooks?: CloudTestHooks; snapshotBuilders?: BuilderRegistry })

// apps/cloud/src/modules/config-sync/builders/v1.ts (task 15)
export interface SnapshotHeader { config_epoch: string; config_version: number; currency_code: string; business_day_start_ms: number; tax_enabled: boolean }
export async function buildSnapshotV1(client: pg.PoolClient, tenant: TenantContext, branchId: string, header: SnapshotHeader): Promise<BranchConfig>;
// apps/cloud/src/modules/config-sync/builders/index.ts (task 16)
export type SnapshotBuilder = (client: pg.PoolClient, tenant: TenantContext, branchId: string, header: SnapshotHeader) => Promise<Record<string, unknown>>;
export interface BuilderRegistry { minServed: number; max: number; get(version: number): SnapshotBuilder }
export const SNAPSHOT_SCHEMA_MIN_SERVED = 1;
export function createBuilderRegistry(o?: { minServed?: number; extra?: Record<number, SnapshotBuilder> }): BuilderRegistry;

// apps/hub/src/projections/branch-config.ts (task 24)
export interface BranchConfigRow { branch_id: string; config_epoch: string; config_version: number; snapshot_schema_version: number; snapshot_hash: string; applied_at: number; epoch_changed_at: number | null }
export const branchConfigProjection: Projection;
export function readBranchConfigRow(db: Database.Database, branchId: string): BranchConfigRow | undefined;
export function parseStoredSnapshot(body: string, schemas?: Record<number, z.ZodType<BranchConfig>>): BranchConfig;
export type LoadedConfig = { state: 'NONE' } | { state: 'BODY_MISSING'; row: BranchConfigRow } | { state: 'APPLIED'; row: BranchConfigRow; entry: ConfigEntry };
export function loadBranchConfig(db: Database.Database, branchId: string): LoadedConfig;      // 2 primary-key reads
// apps/hub/src/projections/item-availability.ts (task 24)
export const itemAvailabilityProjection: Projection;
export function itemAvailability(db: Database.Database, itemIds: readonly string[]): Map<string, boolean>; // 1 statement
export function registerRestaurantProjections(projections: ProjectionRegistry): void;

// apps/hub/src/sync/branch-config-holder.ts (ConfigEntry type: task 24; functions: task 25)
export interface ConfigEntry { config: BranchConfig; snapshotHash: string; configVersion: number; configEpoch: string; snapshotSchemaVersion: number; appliedAt: number }
export function branchConfig(): BranchConfig | null;
export function currentConfigEntry(): ConfigEntry | null;
export function swapBranchConfig(entry: ConfigEntry | null): void;
// task 28 (Gated N2):
export function onBranchConfigApplied(fn: (prev: BranchConfig | null, next: BranchConfig, tx: WriterTx) => void): () => void;
export function runBranchConfigHooks(prev: BranchConfig | null, next: BranchConfig, tx: WriterTx): void;

// apps/hub/src/sync/config-client.ts (task 25)
export interface ConfigQuery { config_epoch: string; config_version: number; directory_version: number; snapshot_schema: number }
export type ConfigFetch =                                         // network error, timeout and 5xx all map to 'offline' here (R30)
  | { kind: 'not_modified' } | { kind: 'ok'; text: string } | { kind: 'offline' }
  | { kind: 'error'; status: number; code: string; details: Record<string, unknown> };   // 4xx only
export interface ConfigClient { fetchConfig(q: ConfigQuery): Promise<ConfigFetch> }
export function httpConfigClient(baseUrl: string, branchApiKey: string, timeoutMs?: number): ConfigClient; // default 10_000

// apps/hub/src/sync/config-poller.ts (tasks 26–31)
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
// HubDeps gains (task 26): configClient?: ConfigClient   (default httpConfigClient(config.cloud_base_url, provisioned.branch_api_key))
// BootOptions gains (task 30): configClient?: ConfigClient

// apps/hub/src/sync/boot-steps.ts (tasks 29–30)
export function foldStockEvents(db: Database.Database, branchId: string): EngineState;  // stream_type = 'stock' AND event_type = 'StockSet', by seq
export function registerRestaurantBootSteps(): void;  // idempotent; step '3' stock fold, '5' config load, '6' poller start
// lib/boot.ts (task 29): BootContext gains state: StateHolder<EngineState> (created before step 2, passed to createDeps)
// HubDeps.state: StateHolder<EngineState>; CommandCtx.state: Readonly<EngineState>; QueryCtx gains state: Readonly<EngineState>, config: BranchConfig | null

// apps/hub/src/lib/business-day.ts (task 35)
export function businessDayStartedAt(nowMs: number, config: Pick<BranchConfig, 'business_day_start_ms'> | null): number; // OS time zone; null → 18_000_000

// apps/hub/src/auth/apply-directory.ts (task 52) — additive 4th parameter
export function applyStaffDirectory(tx, d, setDirectory, opts?: { allowNotNewer?: boolean }): { applied: boolean };

// apps/{hub,cloud}/src/lib/client-dist.ts (task 41) — identical apart from the entry name
export function registerClientDist(app: FastifyInstance, o: { prefix: '/owner/' | '/admin/stock/'; dir: string; routeConfig: Record<string, unknown>; headers?: Record<string, string> }): void;
export const CLIENT_DIST_DIR: string;  // fileURLToPath(new URL('../../../client/dist/<entry>/', import.meta.url)) — owner on cloud, admin-stock on hub (S39 b)

// apps/client (tasks 39–50)
// src/components/: PinPad({ length?, busy, onSubmit(pin) }), StaffTiles({ staff, onPick }), BusyButton({ busy, children, … }), Banner({ tone: 'danger'|'warn'|'info', children })
// src/features/owner/money.ts
export function parseRupeesToMinor(input: string): { ok: true; value: number } | { ok: false };
export function formatMinor(minor: number): string;               // 120000 → "1,200"
// src/api/cloud-admin.ts
export function createCloudAdmin(o: { fetch?: typeof fetch; storage?: Storage; onLoggedOut(): void }): CloudAdmin;
export function newIdempotencyKey(): string;                        // ULID from crypto.getRandomValues
// src/api/hub-admin.ts (R10: injectable for jsdom, which has no IndexedDB)
export function createHubAdmin(o: { fetch?: typeof fetch; storage?: Storage; readDeviceToken?: () => Promise<string | null> }): HubAdmin;
// src/app/router.ts
export function useHashRoute(): string;                             // '#/menu' → '/menu'
// src/features/admin/stock/badges.ts
export function notCountedToday(setAt: number | null, businessDayStartedAt: number): boolean;
export function offSince(unavailableSince: number | null, businessDayStartedAt: number): number | null;
```

---

## Coverage table (§10 → task)

| Tests | Task | Tests | Task | Tests | Task |
|---|---|---|---|---|---|
| 1, 2, 3, 6, 20, 96, 99 | 16 | 42, 43, 44, 45, 53, 54, 95 | 26 | 81, 82 | 21 |
| 4, 5, 85 | 15 | 46, 94, 97, 98, 100 | 27 | 83 | 14 |
| 7 | 21 | 47, 48 | 30 | 84 | 9 |
| 8 | 11 | 49 | 24 | 86, 87 | 22 |
| 9, 10, 11, 12, 13, 14 | 10 | 50, 51, 52 | 31 | 88 | 20 |
| 15, 78 | 41 | 55, 56, 102 | 36 | 73, 89, 90, 91 | 37 |
| 16, 17, 23, 80 | 13 | 57 | 32 | 92 | 38 |
| 18, 19, 21, 22 | 14 | 58 | 28 | 67, 93 | 29 |
| 24, 25, 26, 27 | 17 | 59, 60, 61, 62, 63, 64, 65 | 33 | 101, 105, 108 | 23 |
| 28, 29, 30 | 18 | 66, 68 | 8 | 106, 107 | 21 |
| 31, 32 | 19 | 69, 70, 71 | 34 | 109, 110, 111 | 53 |
| 33, 34, 35, 36, 37, 40 | 20 | 72, 103, 104 | 35 | 112 | 52 |
| 38, 39, 41 | 21 | 74 | 44 | 113 | 39 |
| 75 | 48 | 76 | 46 | 77 | 50 |
| 79 | 40 | | | | |

All 113 numbers, each once. Task 55 re-checks this in the code with `grep`.

## Task list (→ spec v0.5 §11 step)

| # | Task | §11 | Markers |
|---|---|---|---|
| 1 | Spec 00 v1.2.1 editorial patch | 1 | Claude only |
| 2 | Foundation §6.2: append §9 codes | 2 | Claude only |
| 3 | Point `.cursor/rules/pos.mdc` at this plan | — | Claude only |
| 4 | Domain: error codes, `manage-stock` | 2 | needs Docker Postgres |
| 5 | `@pos/domain/hash` | 3 | Gated N1 |
| 6 | Events: snapshot schema `config.ts` | 4 | |
| 7 | Events: four events, fixtures, builders | 4 | |
| 8 | `@pos/engine` stock slice | 5 | |
| 9 | Cloud migration `0002_restaurant_setup.sql` | 6 | needs Docker Postgres |
| 10 | Cloud `withIdempotency` | 7 | needs Docker Postgres |
| 11 | Cloud `bumpConfigVersion`, `writeConfigAudit` | 8 | needs Docker Postgres |
| 12 | Cloud test infrastructure | 9 | needs Docker Postgres |
| 13 | Cloud floors GET/POST | 9 | needs Docker Postgres |
| 14 | Cloud floor PATCH, tables | 9 | needs Docker Postgres |
| 15 | Cloud snapshot builder v1 | 13 | needs Docker Postgres |
| 16 | Cloud `GET /v1/sync/config` | 13 | needs Docker Postgres |
| 17 | Cloud stations | 10 | needs Docker Postgres |
| 18 | Cloud batch programs | 10 | needs Docker Postgres |
| 19 | Cloud tax classes, categories | 11 | needs Docker Postgres |
| 20 | Cloud menu GET, menu-item POST | 12 | needs Docker Postgres |
| 21 | Cloud menu-item PATCH, route PUT | 12 | needs Docker Postgres |
| 22 | Cloud lock-order races | 10, 12 | needs Docker Postgres |
| 23 | Cloud CLIs | 14 | needs Docker Postgres |
| 24 | Hub migration 0004, projections | 15 | |
| 25 | Hub config holder and HTTP client | 16 | |
| 26 | Hub `pollOnce` core | 16 | |
| 27 | Hub poller: schema versions, epoch, commit failure | 16 | |
| 28 | Hub `onBranchConfigApplied` | 16 | Gated N2 |
| 29 | Hub engine reducer, boot steps, stock fold, ctx typing | 19 | |
| 30 | Hub boot config load, `BODY_MISSING`, poll timer | 16, 17 | |
| 31 | Hub directory through the poll | 16, 17 | |
| 32 | Hub station validator | 18 | |
| 33 | Hub `SetPrecookedStock` | 20 | |
| 34 | Hub `SetItemAvailability`, `itemAvailability` | 21 | |
| 35 | Hub business day, stock query | 22 | |
| 36 | Hub config status, `pull-now` | 22 | |
| 37 | Hub WS audiences and catch-up parts | 23 | |
| 38 | Hub `GET /queries/branch-config` | 23 | |
| 39 | `apps/client` scaffold and build | 24 | |
| 40 | `apps/client` lint rules | 24 | |
| 41 | `client-dist` (hub + cloud), `admin-page` group, `/owner/*` allowlist + CSP | 25 | needs Docker Postgres |
| 42 | `apps/hub/deploy/ship-client.sh` | 25 | |
| 43 | Shared components | 27 (pre) | |
| 44 | Owner money and `cloud-admin` client | 26 | |
| 45 | Owner shell: login, branch picker, app | 26 | |
| 46 | Owner floors view | 26 | |
| 47 | Owner stations view | 26 | |
| 48 | Owner menu view | 26 | |
| 49 | `/admin/stock`: `hub-admin` client and PIN login | 27 | |
| 50 | `/admin/stock`: stock table, banners, save | 27 | |
| 51 | Spec 00 v1.3 entry: `allowNotNewer` | 28 (pre) | Claude only, **STOP** |
| 52 | `applyStaffDirectory` `allowNotNewer` | 28 | |
| 53 | Directory resend on epoch change | 28 | needs Docker Postgres |
| 54 | Manual runbook and release drill | 29 | needs Docker Postgres, needs hardware |
| 55 | README, spec status, runbook file, DoD close-out | §12.1 | Claude only |

---

### Task 1: Spec 00 v1.2.1 editorial patch — Claude only

**Files:** Rename `docs/specs/00_Hub_Platform_Access_Spec_v1.2.md` → `…_v1.2.1.md`; Modify it (line 8 Version row (N6), line 472 `defineQuery` row, line 481 `registerReducer` row, as S25); Modify `docs/specs/README.md`; update links (`grep -rl "Access_Spec_v1.2.md" docs CLAUDE.md .cursor`).

- [ ] Apply the three edits from S25. No behaviour change. `grep -rn "Access_Spec_v1.2.md" docs .cursor CLAUDE.md` → no hits.
- [ ] Commit `feat(01a): task 1 spec 00 v1.2.1 editorial patch [spec S25, §2]`

### Task 2: Foundation §6.2 — append the §9 codes — Claude only

**Files:** Modify `docs/specs/00_Foundation_Spec_v1.7.md` (§6.2 list only: append the 13 codes of §9 with status, in §9 order, citing "01a §9").

- [ ] Append only (D64). Commit `feat(01a): task 2 foundation error codes from 01a [spec §9, F §6.2]`

### Task 3: Point the implementer rules at this plan — Claude only

**Files:** Modify `.cursor/rules/pos.mdc` (R12): current plan `docs/plans/01a-plan.md` implementing `docs/specs/01_Restaurant_Setup_Spec_v0.5.md` (or its reviewed successor); 00's plan named as finished; the stop marker reads "**Claude only** or **Gated**" instead of "NOT for Cursor"; Postgres must be running for `pnpm test`.

- [ ] Commit `feat(01a): task 3 implementer rules for 01a [CLAUDE.md pipeline]`

### Task 4: Domain — error codes and `manage-stock` — needs Docker Postgres

**Files:** Modify `packages/domain/src/errors.ts`, `packages/domain/src/errors.test.ts`, `packages/domain/src/permissions.ts`, `packages/domain/src/permissions.test.ts`; Create `apps/cloud/test/default-roles.test.ts` (runs in the cloud project, whose global setup waits for Postgres, R19).

**Interfaces — Produces:** catalogue entries `BRANCH_NOT_FOUND 404, FLOOR_NOT_FOUND 404, TABLE_NOT_FOUND 404, PROGRAM_NOT_FOUND 404, TAX_CLASS_NOT_FOUND 404, CATEGORY_NOT_FOUND 404, MENU_ITEM_NOT_FOUND 404, CONFIG_NAME_TAKEN 409, CONFIG_IN_USE 409, CONFIG_REFERENCE_INVALID 422, IDEMPOTENCY_KEY_MISMATCH 422, STOCK_NOT_TRACKED 422, SNAPSHOT_SCHEMA_UNSUPPORTED 409`; `'manage-stock'` appended last in `PERMISSIONS` (20 entries).

- [ ] **Step 1: Tests:** `[01a §9] 01a codes have their statuses` (all 13). Rename the 00 test to `[00 §3.6, 01a S18] catalogue has 20 unique entries` and append `'manage-stock'`. `default-roles.test.ts`: `[01a S18] Owner and Manager grant manage-stock; Cashier and Order taker do not`.
- [ ] **Step 2:** `pnpm vitest run packages/domain apps/cloud/test/default-roles.test.ts` → FAIL (codes missing).
- [ ] **Step 3:** Add the codes and the permission. `default-roles.ts` needs no change (Owner = all, Manager = all but `manage-roles`).
- [ ] **Step 4:** Same → PASS; `pnpm test`. If a hub or cloud test lists the 19 permissions exactly and fails, stop and report its path (it is not in this task's Files).
- [ ] **Step 5:** Commit `feat(01a): task 4 error codes and manage-stock permission [spec §9, S18]`

### Task 5: `@pos/domain/hash` — Gated N1

**Files:** Create `packages/domain/src/hash.ts`, `packages/domain/src/hash.test.ts`; Modify `packages/domain/package.json` (`exports["./hash"] = "./src/hash.ts"`; `devDependencies: { "@types/node": "22.19.1" }`), `apps/hub/src/lib/hash.ts`, `pnpm-lock.yaml`.

- [ ] **Step 1: Tests:** `[01a S27] canonicalJson sorts keys at every depth and keeps array order`; `[01a S27] sha256hex('abc')` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; `[01a S27] @pos/domain root does not export canonicalJson` (`import * as root from './index'`).
- [ ] **Step 2:** `pnpm vitest run packages/domain` → FAIL (module missing).
- [ ] **Step 3:** `hash.ts` starts with `/// <reference types="node" />` (the base tsconfig has `types: []`, R20). Move the two bodies from `apps/hub/src/lib/hash.ts` unchanged; the hub file becomes `export { canonicalJson, sha256hex } from '@pos/domain/hash';` plus its `payloadHash`. `pnpm install`.
- [ ] **Step 4:** `pnpm vitest run packages/domain apps/hub/src/lib/hash.test.ts` → PASS; `pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 5 @pos/domain/hash subpath [spec S27]`

### Task 6: Events — snapshot schema (`config.ts`)

**Files:** Create `packages/events/src/config.ts`, `packages/events/src/config.test.ts`; Modify `packages/events/src/index.ts`.

**Interfaces — Produces:** Interfaces block. Fields and nullability exactly the §4.3 JSON: `snapshot_schema_version` (literal 1), `config_epoch` (string, min 1), `config_version` (int ≥ 1), `branch_id`, `currency_code`, `business_day_start_ms`, `tax_enabled` (boolean, required), `floors[{floor_id,name,sort_order,tables[{table_id,name,seats|null,sort_order}]}]`, `stations[{station_id,name,location_label|null,station_type,capacity,freshness_window_ms|null,completion_mode,is_archived,programs[{program_id,name,cook_time_ms}]}]`, `tax_classes[{tax_class_id,name,rate_bp}]`, `categories[{category_id,name,sort_order}]`, `items[{item_id,category_id,name,group_label|null,description|null,sort_order,price_minor,tax_class_id|null,serve_mode,prep_buffer_ms,cook_time_ms,stock_time_ms|null,out_of_stock_behaviour,station_id,program_id|null,stock_program_id|null}]`. Numbers are `z.number().int()` (no coercion). `SyncConfigEnvelopeSchema.snapshot` is `z.record(z.string(), z.unknown())`; `directory` is the existing `DirectorySchema` or null.

- [ ] **Step 1: Tests:** `[01a §4.3] the §4.3 example parses`; `[01a S28 c] unknown fields are dropped, not rejected`; `[01a S27] price_minor "120000" fails`; `[01a S34] missing tax_enabled fails; tax_class_id null passes`; `[01a §4.3] isStockTracked` (slot + `stock_time_ms` → true; slot + null → false; batch + `stock_program_id` → true; batch + null → false).
- [ ] **Step 2–4:** `pnpm vitest run packages/events` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 6 branch config snapshot schema v1 [spec §4.3, S28]`

### Task 7: Events — four events, fixtures, builders

**Files:** Create `packages/events/src/events/hub/BranchConfigApplied.v1.ts`, `packages/events/src/events/stock/{StockSet,ItemMadeUnavailable,ItemMadeAvailable}.v1.ts`, `packages/events/fixtures/{BranchConfigApplied,StockSet,ItemMadeUnavailable,ItemMadeAvailable}.{v1,latest}.json`; Modify `packages/events/src/index.ts`, `packages/events/src/fixtures.test.ts` (14 → 18), `packages/events/testing/index.ts`, `packages/events/testing/builders.test.ts`.

**Interfaces — Produces:** payloads §4.2: `BranchConfigApplied { config_epoch: string, config_version: int ≥ 1, snapshot_schema_version: int ≥ 1, snapshot_hash: /^[0-9a-f]{64}$/, previous_config_epoch: string|null, previous_config_version: int|null }`; `StockSet { item_id, on_hand: int 0…9999 }`; `ItemMadeUnavailable { item_id }`; `ItemMadeAvailable { item_id }`. `aBranchConfig()` returns a valid snapshot with a slot station "Karahi", a stock-tracked item `I1` and a non-tracked item `I2`.

- [ ] **Step 1: Tests:** fixtures test expects 18 files; `[01a §4.2] StockSet rejects on_hand 10000 and -1`; each new builder parses with its schema.
- [ ] **Step 2–5:** `pnpm vitest run packages/events` → FAIL → implement → PASS → commit `feat(01a): task 7 config and stock events [spec §4.2]`

### Task 8: `@pos/engine` — stock slice

**Files:** Create `packages/engine/{package.json,tsconfig.json,vitest.config.ts}`, `packages/engine/src/{state,stock,apply-event,version,index}.ts`, `packages/engine/src/engine.test.ts`, `packages/engine/fixtures/{stock-log.v1.json,engine-state.v1.json}`; Modify `pnpm-lock.yaml`.

`package.json`: `"name": "@pos/engine"`, `"exports": { ".": "./src/index.ts" }`, `dependencies: { "@pos/events": "workspace:*" }`, script `typecheck`. Copy `tsconfig.json` / `vitest.config.ts` from `packages/events`.

- [ ] **Step 1: Tests:** `[01a §10 #66]` exactly as §10.4; `[01a §10 #68]` `buildEngineState(stock-log.v1.json)` deep-equals `engine-state.v1.json` (log: 4 `StockSet` on 2 items + one `HubStarted`); `[01a S14] stockOf on a missing item → { 0, 0, null }`; `[01a S15] applyEvent returns the same reference for a non-stock event`.
- [ ] **Step 2:** `pnpm install && pnpm vitest run packages/engine` → FAIL.
- [ ] **Step 3:** `applyEvent` copies only the touched entry; `set_at = event.recorded_at`, never a clock.
- [ ] **Step 4–5:** PASS; `pnpm typecheck && pnpm test` → commit `feat(01a): task 8 engine package with stock slice [spec S14, S15]`

### Task 9: Cloud migration `0002_restaurant_setup.sql` — needs Docker Postgres

**Files:** Create `apps/cloud/src/db/migrations/0002_restaurant_setup.sql` (verbatim §5.2), `apps/cloud/test/db/restaurant-schema.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #84]` `UPDATE` and `DELETE` on a `config_audit` row raise `config_audit is insert-only`; its primary key and every index on the new tables lead with `tenant_id` (`pg_index`). (#84's cross-tenant clause is covered by task 12's `config_audit` row in the cross-tenant test, R26.) `[01a §5.2] tax_class_id NULL accepted; stock_time_ms > cook_time_ms rejected`; `[01a §5.2] a slot station with freshness 0 is rejected`.
- [ ] **Step 2–4:** `pnpm vitest run apps/cloud/test/db/restaurant-schema.int.test.ts` → FAIL → add the file → PASS; `pnpm test` (if `schema.int.test.ts` asserts an exact table list and fails, stop and report).
- [ ] **Step 5:** Commit `feat(01a): task 9 cloud restaurant setup migration [spec §5.2, S26, S29, S32–S34]`

### Task 10: Cloud `withIdempotency` — needs Docker Postgres

**Files:** Create `apps/cloud/src/lib/idempotency.ts`, `apps/cloud/test/lib/idempotency.int.test.ts`.

Behaviour S7. The key is checked **inside** `withIdempotency` by hand (not a Fastify header schema): missing or not a ULID → `throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'headers.idempotency-key', message }] })` (R39). Request hash `sha256hex(canonicalJson({ route, body }))`. In one transaction: `DELETE FROM idempotency_keys WHERE tenant_id = $1 AND created_at < now − 86 400 000`, then `INSERT … ON CONFLICT DO NOTHING RETURNING`; no row → read the stored row: same hash → its status/body with `replay: true` (roll back); different hash → `422 IDEMPOTENCY_KEY_MISMATCH { idempotency_key }`. On success `UPDATE` `response_status`, `response_body` before COMMIT. Any throw rolls everything back. Queries go through `TenantLevelRepository` on the transaction client.

- [ ] **Step 1: Tests.** In the test file register `POST /v1/test/floors/:branch_id` (`tenantScope: 'jwt'`) that inserts a `floors` row through `withIdempotency` and throws `CONFIG_NAME_TAKEN` on name `"dup"`. Seed with `seedTenant` + `issueRegistrationCode`; sign the JWT with `cloud.app.jwt.sign`. `[01a §10 #9]`, `#10`, `#11`, `#12` (`Promise.all` of two injects: one `floors` row, one reply with `idempotent-replay: true`), `#13`, `#14` (old rows for tenants A and B inserted directly; a call as A removes A's only).
- [ ] **Step 2–5:** `pnpm vitest run apps/cloud/test/lib/idempotency.int.test.ts` → FAIL → implement → PASS → commit `feat(01a): task 10 cloud idempotency keys [spec S7, M69]`

### Task 11: Cloud `bumpConfigVersion` and `writeConfigAudit` — needs Docker Postgres

**Files:** Create `apps/cloud/src/lib/config-version.ts`, `apps/cloud/src/lib/config-audit.ts`, `apps/cloud/test/lib/config-version.int.test.ts`.

Both take a `TenantSql` (Interfaces; R2, R3): routes pass `new TenantLevelRepository(request.tenant, client)`; CLIs build one from `SystemContext` (task 23). Neither file imports `SystemContext` or the db client (lint). SQL: branch scope `UPDATE branches SET config_version = config_version + 1 WHERE tenant_id = $1 AND branch_id = $2 RETURNING branch_id, config_version`; tenant scope `SELECT branch_id FROM branches WHERE tenant_id = $1 ORDER BY branch_id FOR UPDATE`, then `UPDATE branches SET config_version = config_version + 1 WHERE tenant_id = $1 RETURNING …` (every branch, N3). `writeConfigAudit` inserts one row (`audit_id = ids.next()`, `at = clock.branchNow()`); `before`/`after` passed as JSON.

- [ ] **Step 1: Tests:** `[01a §10 #8]` 10 concurrent `inTransaction(… bumpConfigVersion(branch A))` → +10 exactly; `[01a S8] tenant scope bumps all 3 branches even with a JWT listing one`; `[01a S26] writeConfigAudit stores actor, entity, before/after; cli actor stores null user`; `[01a S26] auditActionFor`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 11 config version bump and audit writer [spec S8, S26]`

### Task 12: Cloud test infrastructure — needs Docker Postgres

**Files:** Create `apps/cloud/test/helpers/restaurant.ts`, `apps/cloud/test/helpers/pg-counter.ts`, `apps/cloud/test/helpers/pg-counter.int.test.ts`; Modify `apps/cloud/test/helpers/test-cloud.ts` (options `testHooks`, `snapshotBuilders` passed into `buildCloudServer`, R6), `apps/cloud/src/server.ts` (`CloudDeps.testHooks?: CloudTestHooks`, `CloudDeps.snapshotBuilders?: unknown` until task 16 types it), `apps/cloud/test/cross-tenant.int.test.ts`.

**Interfaces — Produces:**
```ts
export interface RestaurantFixture { tenantId: string; userId: string; branches: [string, string, string]; token: string; tokenFor(branchIds: string[]): string; branchKey: string /* branch A */; other: { tenantId: string; userId: string; branchId: string; token: string } }
export async function restaurantFixture(cloud: TestCloud): Promise<RestaurantFixture>; // truncateAll; seedTenant ×2; issueRegistrationCode ×3 (+1 for B); /v1/hubs/register for branch A; JWTs via cloud.app.jwt.sign({ sub: userId, tenant_id, allowed_branch_ids })
export function owner(f: RestaurantFixture, token?: string): { headers: Record<string, string> };   // authorization + fresh idempotency-key
export function pgCounter(pool: pg.Pool): { readonly count: number; reset(): void }; // wraps pool.query and clients from pool.connect; ignores BEGIN*/COMMIT/ROLLBACK
```
`cross-tenant.int.test.ts`: replace the exact route list with `ROUTE_CASES: Record<string, (ids) => { url: string; payload?: unknown }>` keyed `"METHOD /url"`, holding today's two routes; assert its keys equal the jwt/branch-key routes; add a tenant B `config_audit` row (inserted directly) and its `audit_id` to `bIds` (R26).

- [ ] **Step 1: Tests:** `[01a §10 test infra] pgCounter counts statements on pool.query and on connected clients, not BEGIN/COMMIT`; the refactored cross-tenant test passes with the two 00 routes.
- [ ] **Step 2–5:** `pnpm vitest run apps/cloud/test/helpers apps/cloud/test/cross-tenant.int.test.ts` → FAIL → implement → PASS → commit `feat(01a): task 12 cloud test fixtures and route cases [spec §10, D54]`

### Task 13: Cloud floors GET/POST — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/restaurant/{routes,service,repository,schemas}.ts`, `apps/cloud/test/restaurant/floors.int.test.ts`; Modify `apps/cloud/src/server.ts` (`registerRestaurantRoutes(app, deps)`), `apps/cloud/test/cross-tenant.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #16]`, `#17`, `#23`, `#80`; Review Focus 1: `[01a §3.3] " ground " is stored as "ground" and duplicates "Ground"`; `[01a S8] create floor bumps only that branch`.
- [ ] **Step 2–5:** `pnpm vitest run apps/cloud/test/restaurant apps/cloud/test/cross-tenant.int.test.ts` → FAIL → implement → PASS → commit `feat(01a): task 13 floors list and create [spec §6.2, §6.3, §6.0, S26]`

### Task 14: Cloud floor PATCH, tables — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`, `apps/cloud/test/restaurant/floors.int.test.ts`; Create `apps/cloud/test/restaurant/tables.int.test.ts`.

The service calls `await deps.testHooks?.beforeBump?.()` right before `bumpConfigVersion`.

- [ ] **Step 1: Tests:** `[01a §10 #18]`, `#19`, `#21`, `#22`, `#83`; `[01a §6.4] restore checks name uniqueness`; `[01a §6.6] moving a table to another branch's floor → 422 wrong_branch`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 14 floor patch and tables [spec §6.4–§6.6, S22, S26]`

### Task 15: Cloud snapshot builder v1 — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/config-sync/builders/v1.ts`, `apps/cloud/test/config-sync/builder.int.test.ts`; Modify `apps/cloud/test/helpers/restaurant.ts` (`seedMenu(pool, f, o)`: inserts floors, tables, stations, programs, tax classes, categories, items and routes by SQL; returns their ids).

6 fixed statements (floors ⋈ tables; stations ⋈ programs; tax classes; categories; items ⋈ routes for this branch; the header is passed in), active rows only except stations (all, with `is_archived`), arrays ordered by `sort_order`, then id. The repository converts `BIGINT` columns with `Number()`; then `BranchConfigSnapshotSchemaV1.parse` (no coercion, so a missed conversion fails, S27).

- [ ] **Step 1: Tests:** `[01a §10 #4]`, `#5` (`pgCounter`: ≤ 12 and equal for 10 and 300 items), `#85` (hub-style `sha256hex(canonicalJson(V1.parse(JSON.parse(JSON.stringify(snapshot)))))` equals the cloud hash; a copy with `price_minor: "120000"` fails `parse`).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 15 snapshot builder v1 [spec §6.1, §4.3, S27]`

### Task 16: Cloud `GET /v1/sync/config` — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/config-sync/{routes,service,schemas}.ts`, `apps/cloud/src/modules/config-sync/builders/index.ts`, `apps/cloud/test/config-sync/sync-config.int.test.ts`; Modify `apps/cloud/src/server.ts` (register; type `snapshotBuilders?: BuilderRegistry`, default `createBuilderRegistry()`), `apps/cloud/test/helpers/test-cloud.ts` (type the option), `apps/cloud/test/cross-tenant.int.test.ts`.

Script §6.1 steps 0–5; the handler's first line is `deps.testHooks?.handlerStart?.('GET /v1/sync/config')` (the tenant guard's key lookup runs before it and is not counted, R9). Query: `config_epoch` string (may be empty), `config_version` / `directory_version` int ≥ 0, `snapshot_schema` int ≥ 1 (`z.coerce`). `304` via `reply.code(304).send()`. Build inside `inTransaction(pool, fn, { isolation: 'REPEATABLE READ' })`. Directory only when `directory_version` differs (the epoch rule for it is task 53).

- [ ] **Step 1: Tests:** `[01a §10 #1]` (reset `pgCounter` in `handlerStart`; count = 1), `#2`, `#3`, `#6`, `#20` (parking floor and `P1` created through the owner routes), `#96` (registry with a test v2 builder adding `promo_banner`; the `409` case: 0 statements after `handlerStart`), `#99` (assert only the `config` part; the directory part changes in task 53, R41).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 16 config sync endpoint [spec §6.1, S4, S28, S29]`

### Task 17: Cloud stations — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/stations.int.test.ts`.

§6.8, §6.9. In-use checks use `item_routes_station`; tests seed routes with `seedMenu`. Batch → slot archives the station's programs, one `batch_program` / `archive` audit row each.

- [ ] **Step 1: Tests:** `[01a §10 #24]`, `#25`, `#26`, `#27`; `[01a S10] "Fryer" twice in one branch → 409; in another branch → 201`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 17 stations [spec §6.8, §6.9, S10, S22]`

### Task 18: Cloud batch programs — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/programs.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #28]`, `#29`, `#30`; `[01a §6.10] archiving a program used as program_id → 409`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 18 batch programs [spec §6.10]`

### Task 19: Cloud tax classes and categories — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/tax-categories.int.test.ts`.

Tenant-level (`TenantLevelRepository`), bump every branch, `branch_id` null in audit.

- [ ] **Step 1: Tests:** `[01a §10 #31]`, `#32`; `[01a S8] a category create bumps all three branches`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 19 tax classes and categories [spec §6.12, §6.13]`

### Task 20: Cloud menu GET and menu-item POST — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/menu-items.int.test.ts`.

§6.11, §6.14. Stations and programs locked `FOR SHARE` in id order with `= ANY($ids)`; item and routes in one multi-row `INSERT` each; reasons per §9. A route branch outside `allowed_branch_ids` → `404 BRANCH_NOT_FOUND`, nothing written.

- [ ] **Step 1: Tests:** `[01a §10 #33]`, `#34`, `#35`, `#36`, `#37` (`pgCounter` reset in `handlerStart`: equal for 1 and 3 routes), `#40`, `#88`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 20 menu read and item create [spec §6.11, §6.14, S11]`

### Task 21: Cloud menu-item PATCH and route PUT — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/menu-patch.int.test.ts`.

§6.15, §6.16. PUT takes no `Idempotency-Key`; `{ station_id: null }` deletes the route (`route_removed`, `after` null).

- [ ] **Step 1: Tests:** `[01a §10 #7]` (table rename at A bumps A only; item price PATCH bumps A, B, C), `#38`, `#39`, `#41`, `#81`, `#82`, `#106`, `#107` ("in the snapshot" = poll `GET /v1/sync/config` with branch A's key).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 21 item patch and route put [spec §6.15, §6.16, S26, S32, S34]`

### Task 22: Cloud lock-order races — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/service.ts` (`await deps.testHooks?.afterTargetLock?.(route)` after the target `FOR UPDATE`; `afterReferenceLock?.(route)` after the reference `FOR SHARE`); Create `apps/cloud/test/restaurant/races.int.test.ts`.

Barrier: request 1's hook awaits a promise the test resolves once request 2 is blocked (poll `pg_stat_activity.wait_event_type = 'Lock'` for up to 2 000 ms).

- [ ] **Step 1: Tests:** `[01a §10 #86]` both orders; `[01a §10 #87]` both orders plus two concurrent item creates committing. Outcome pairs as §10; never an active route on an archived station/program; no `40P01`.
- [ ] **Step 2–5:** run → FAIL (or hang → fix lock order per S8) → PASS → commit `feat(01a): task 22 config write lock order [spec S8, §5.2]`

### Task 23: Cloud CLIs — needs Docker Postgres

**Files:** Create `apps/cloud/src/cli/rotate-config-epoch.ts`, `apps/cloud/src/cli/set-branch-settings.ts`, `apps/cloud/test/cli/branch-cli.int.test.ts`; Modify `apps/cloud/package.json` (scripts `rotate-config-epoch`, `set-branch-settings`: `tsx src/cli/….ts`).

**Interfaces — Produces:** `rotateConfigEpoch(sys: SystemContext, input: { branchId: string }, deps: { ids: IdGen }): Promise<{ branch_id: string; config_epoch: string }>`; `setBranchSettings(sys, input: { branchId: string; taxEnabled?: boolean; businessDayStart?: string /* "HH:MM" */ }, deps: { clock; ids }): Promise<{ business_day_start_ms: number; tax_enabled: boolean }>`. Inside `sys.tx(async (t) => …)`: `SELECT tenant_id, … FROM branches WHERE branch_id = $1 FOR UPDATE` gives the tenant (unknown branch → error); then `const db: TenantSql = { query: (sql, params = []) => t.query(sql, [tenantId, ...params]) }` passed to `writeConfigAudit` and `bumpConfigVersion` (R3). Entry blocks parse `--branch`, `--tax-enabled true|false`, `--business-day-start HH:MM`; `24:00`, `05:30:15`, `5:7` → error, nothing written.

- [ ] **Step 1: Tests:** `[01a §10 #101]` (also: copy only `0001_platform.sql` to a temp dir, `CREATE DATABASE pos_test_mig01a`, migrate it, insert two branches, migrate with the real dir → two distinct non-empty epochs, drop the database; and ESLint `lintText` shows `apps/cloud/src/modules/x.ts` importing `../cli/system-context` fails), `#105`, `#108`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 23 rotate-config-epoch and set-branch-settings CLIs [spec S29 a, §6.7, S33, S34]`

### Task 24: Hub migration 0004 and projections

**Files:** Create `apps/hub/src/db/migrations/0004_restaurant_config.sql` (verbatim §5.1), `apps/hub/src/sync/branch-config-holder.ts` (the `ConfigEntry` type only), `apps/hub/src/projections/branch-config.ts`, `apps/hub/src/projections/item-availability.ts`, `apps/hub/test/projections/restaurant-projections.int.test.ts`; Modify `apps/hub/src/lib/boot.ts` (`registerRestaurantProjections(projections)` in `createDeps`), `apps/hub/test/helpers/test-hub.ts` (same), `apps/hub/test/helpers/big-fixture.ts` (also insert checkpoints `branch_config` and `item_availability` at `n`, R4), `apps/hub/test/boot/boot-budget.int.test.ts` (its decoy step also advances those two checkpoints to `N + 1`).

`branch_config` projection: upsert from the payload; `applied_at = event.recorded_at`; `epoch_changed_at = recorded_at` when `previous_config_epoch !== null && previous_config_epoch !== config_epoch`, else unchanged. `item_availability`: `ItemMadeUnavailable` → `(item_id, 0, recorded_at, actor_id)`, `ItemMadeAvailable` → `1`. Both have `reset` (`DELETE`). `loadBranchConfig`: row by primary key, then body by `snapshot_hash`; `parseStoredSnapshot` is `JSON.parse` + the schema of its `snapshot_schema_version`. `ConfigEntry` lives in `sync/branch-config-holder.ts`; this task creates that file with the interface only, and task 25 adds the functions.

- [ ] **Step 1: Tests:** `[01a §10 #49]`; `[01a §5.1] BranchConfigApplied upserts branch_config and sets epoch_changed_at only on an epoch change`; `[01a S5] loadBranchConfig returns NONE, BODY_MISSING and APPLIED`; `[01a §4.2] itemAvailability(db, [])` → empty map, 0 statements.
- [ ] **Step 2–5:** `pnpm vitest run apps/hub/test/projections apps/hub/test/boot/boot-budget.int.test.ts` → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 24 hub config and availability projections [spec §5.1, S5, S17]`

### Task 25: Hub config holder and HTTP client

**Files:** Modify `apps/hub/src/sync/branch-config-holder.ts`; Create `apps/hub/src/sync/branch-config-holder.test.ts`, `apps/hub/src/sync/config-client.ts`, `apps/hub/src/sync/config-client.test.ts`, `apps/hub/test/helpers/stub-config-cloud.ts`.

`httpConfigClient` (pattern: `setup/cloud-client.ts`): `GET {root}/v1/sync/config?…` with `authorization: Bearer <key>`, `AbortSignal.timeout(timeoutMs)`; `304` → `not_modified`; `200` → `ok` with `await response.text()` (never `json()`: the hash is checked over the raw text); fetch error, timeout or `5xx` → `offline`; `4xx` → `error` with the envelope's code/details. `stub-config-cloud.ts`: `stubConfigCloud(): ConfigClient & { calls: ConfigQuery[]; next: ConfigFetch[]; respondWithSnapshot(snapshot: object, o?: { directory?: DirectoryInput; hash?: string }): void }` (hashes with `@pos/domain/hash` unless `hash` is given).

- [ ] **Step 1: Tests** (`config-client.test.ts`, replacing `globalThis.fetch` in `beforeEach` and restoring it in `afterEach`): `[01a §3.4] 304 → not_modified; 200 → ok with the exact body text; 503 and a thrown fetch → offline; 401 → error with code`; `[01a §3.4] the query string carries all four parameters`; `branch-config-holder.test.ts`: `[01a §4.2] swapBranchConfig then branchConfig returns it; null resets`.
- [ ] **Step 2–5:** `pnpm vitest run apps/hub/src/sync` → FAIL → implement → PASS → commit `feat(01a): task 25 hub config holder and cloud client [spec §3.4, §4.2]`

### Task 26: Hub `pollOnce` core

**Files:** Create `apps/hub/src/sync/config-poller.ts`, `apps/hub/test/sync/poller.int.test.ts`; Modify `apps/hub/src/server.ts` (`HubDeps.configClient?`; `buildHubServer` creates the poller with `setDirectory: (d) => swapDirectory(app, d)` and `log: app.log`, stores it for `configPoller(app)`), `apps/hub/test/helpers/test-hub.ts` (option `configClient`, default a stub returning `offline`; `swapBranchConfig(null)` on create).

§3.4 steps 1–6 for one schema version. Step 1 skip (not provisioned or not confirmed): no HTTP call, return `{ outcome: 'offline', … }`, record nothing (N4). Concurrent calls share one in-flight promise. Apply in one `writer.run`: `INSERT OR IGNORE INTO config_snapshots` (`body = canonicalJson(raw)`, `received_at = clock`), append `BranchConfigApplied` (`stream_type 'hub'`, `stream_id` branch id, `actor_id` null, `device_id 'hub'`), `tx.onCommit(() => swapBranchConfig(entry))`; directory part `applyStaffDirectory(tx, directory, setDirectory)` in the same `writer.run`. Log levels §7.3. **Tests create the hub confirmed:** `createTestHub({ config: { provisioned: { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'test-branch-api-key', confirmed_at: 1 } } })` (R13).

- [ ] **Step 1: Tests:** `[01a §10 #42]`, `#43`, `#44`, `#45`, `#53`, `#54`, `#95`; `[01a §3.4] an unconfirmed hub makes no HTTP call`; `[01a §7.3] outcome log levels (unchanged debug, applied info, rejected error) and h.logs() never contains the snapshot body or a pin_hash` (R28).
- [ ] **Step 2–5:** `pnpm vitest run apps/hub/test/sync` → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 26 hub config poll and apply [spec §3.4, S5, S6, S28 d, §7.3]`

### Task 27: Hub poller — schema versions, epoch, commit failure

**Files:** Modify `apps/hub/src/sync/config-poller.ts`; Create `apps/hub/test/sync/poller-versions.int.test.ts`.

Adds §3.4 step 2's version-0 rule (row `snapshot_schema_version < max`), step 3's `409 SNAPSHOT_SCHEMA_UNSUPPORTED` → `upgrade_required`, step 4 (ii) `schema_too_new`, (iii) `schema_invalid`, (iv) the epoch rule and `epoch_changed` (log `warn`), and `last_problem` clearing (step 6).

- [ ] **Step 1: Tests:** `[01a §10 #46]` (`testHooks.beforeCommit` throws → `branchConfig()` unchanged, no `config_snapshots` row), `#94`, `#97` (hub side with the stub; the cloud side is #96), `#98` (poller `schemas: { max: 2, byVersion: { 1: V1, 2: V1.extend({ promo_banner: z.string() }) } }`), `#100`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 27 snapshot schema and epoch rules [spec S28, S29 b, c]`

### Task 28: Hub `onBranchConfigApplied` — Gated N2

**Files:** Modify `apps/hub/src/sync/branch-config-holder.ts` (`onBranchConfigApplied`, `runBranchConfigHooks`), `apps/hub/src/sync/config-poller.ts` (call `runBranchConfigHooks(prev, next, tx)` after the append); Create `apps/hub/test/sync/config-hook.int.test.ts`.

- [ ] **Step 1: Test:** `[01a §10 #58]` (the hook appends a `ClockAlarm`-shaped event through `tx.append`; it commits with `BranchConfigApplied`; a throwing hook rolls both back).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 28 branch config applied hook [spec §4.2]`

### Task 29: Hub engine reducer, boot steps, stock fold, ctx typing

**Files:** Create `apps/hub/src/sync/boot-steps.ts`, `apps/hub/test/boot/stock-fold.int.test.ts`; Modify `apps/hub/package.json` (`"@pos/engine": "workspace:*"`), `pnpm-lock.yaml`, `apps/hub/src/lib/boot.ts`, `apps/hub/src/main.ts` (call `registerRestaurantBootSteps()` before `boot`), `apps/hub/src/setup/issue-admin-bootstrap.ts:44–45`, `apps/hub/test/helpers/test-hub.ts`, `apps/hub/src/server.ts` (`HubDeps.state: StateHolder<EngineState>`), `apps/hub/src/commands/registry.ts` (`CommandCtx.state: Readonly<EngineState>`), `apps/hub/src/commands/route.ts:102` (`state: tx.state as Readonly<EngineState>`, R8), `apps/hub/src/queries/registry.ts` (`QueryCtx.state`, `QueryCtx.config = branchConfig()`; `QueryRouteDeps.state`).

`boot.ts`: replace lines 278–279 by a holder created in `boot()` before step 2 — `createStateHolder<EngineState>(initialEngineState())` with `setReducer(applyEvent)` — put on `BootContext.state` and passed to `createDeps` (the setup path gets its own). `registerRestaurantBootSteps()` (idempotent, module flag) registers through 00's `registerBootStep`: step `'3'` → `ctx.state.swap(foldStockEvents(ctx.db, branchId))`. `foldStockEvents` selects `WHERE branch_id = ? AND stream_type = 'stock' AND event_type = 'StockSet' ORDER BY seq` (uses `events_stream`, R34). Using `registerBootStep` keeps S15's "boot step 3" literal; registering from `main.ts`, not at module load, avoids an import cycle with `boot.ts`.

- [ ] **Step 1: Tests** (each test calls `registerRestaurantBootSteps()` before `boot`): `[01a §10 #67]`, `[01a §10 #93]` (boot clock 1 h later on restart; `set_at` unchanged); `[01a S15] main.ts registers the restaurant boot steps` (read `main.ts` source: contains the call).
- [ ] **Step 2–5:** `pnpm install`; run → FAIL → implement → PASS; `pnpm typecheck && pnpm test` (boot-budget stays green) → commit `feat(01a): task 29 engine reducer and boot stock fold [spec S15, S16, §2]`

### Task 30: Hub boot config load, `BODY_MISSING`, poll timer

**Files:** Modify `apps/hub/src/sync/boot-steps.ts` (step `'5'`: `loadBranchConfig` → `swapBranchConfig(APPLIED ? entry : null)`; it runs after step 4's projection catch-up, so a rebuilt `branch_config` is read, R7. Step `'6'`: `configPoller(ctx.app).start()` and `ctx.app.addHook('onClose', () => poller.stop())`), `apps/hub/src/sync/config-poller.ts` (`BODY_MISSING` → `config_version=0`; `stop()` clears the interval and marks the poller stopped so an in-flight result skips apply and swap), `apps/hub/src/lib/boot.ts` (`BootOptions.configClient` into deps); Create `apps/hub/test/sync/poller-boot.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #47]` (after one apply, restart with `boot()` → same `branchConfig()`; delete the `branch_config` checkpoint and row, restart → catch-up rebuilds the same row and the config loads); `[01a §10 #48]` (setup: append `BranchConfigApplied` through `writer.run` **without** inserting `config_snapshots`, R32 → boot is `BODY_MISSING`, next poll sends `config_version=0` and applies); Review Focus 5: `[01a §7.2] after stop() no poll runs and a late in-flight result does not swap` (fake timers, a stub that resolves after `stop()`).
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm vitest run apps/hub/test/boot` green → commit `feat(01a): task 30 hub config boot and poll timer [spec S5, §3.2, §7.2]`

### Task 31: Hub directory through the poll

**Files:** Create `apps/hub/test/sync/poller-directory.int.test.ts`; Modify `apps/hub/src/sync/config-poller.ts` only if a test fails.

- [ ] **Step 1: Tests:** `[01a §10 #50]`, `#51`, `#52`.
- [ ] **Step 2–5:** run. If they pass on the first run (the code came in task 26), show the output and say so; otherwise implement → PASS → commit `feat(01a): task 31 staff directory through the config poll [spec S6, R14, M38]`

### Task 32: Hub station validator

**Files:** Create `apps/hub/src/sync/station-validator.ts`, `apps/hub/test/sync/station-validator.int.test.ts`; Modify `apps/hub/src/server.ts` (side-effect import before routes).

- [ ] **Step 1: Test:** `[01a §10 #57]`. Body exactly §6.22.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 32 station validator from branch config [spec §6.22, M31]`

### Task 33: Hub `SetPrecookedStock`

**Files:** Create `apps/hub/src/commands/set-precooked-stock.ts`, `apps/hub/test/commands/set-precooked-stock.int.test.ts`; Modify `apps/hub/src/server.ts`.

`defineCommand({ commandType: 'SetPrecookedStock', sessionKind: 'admin', permission: 'manage-stock', … })`. Payload: `entries` 1–200, `refine` unique `item_id`. Validate **all** entries before producing any event (§6.17). Result from `stockOf(ctx.state, id)`, `on_hand` replaced, `set_at = ctx.clock.branchNow()` for changed rows (N8).

- [ ] **Step 1: Tests:** `[01a §10 #59]`, `#60`, `#61`, `#62`, `#63`, `#64`, `#65`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 33 set pre-cooked stock [spec §6.17, S14, S18]`

### Task 34: Hub `SetItemAvailability` and `itemAvailability`

**Files:** Create `apps/hub/src/commands/set-item-availability.ts`, `apps/hub/test/commands/set-item-availability.int.test.ts`; Modify `apps/hub/src/server.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #69]`, `#70`, `#71` (`statementCounter(deps.db)` installed before the call: 1 statement for 1 id and for 100 ids).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 34 item availability [spec §6.18, S17]`

### Task 35: Hub business day and stock query

**Files:** Create `apps/hub/src/lib/business-day.ts`, `apps/hub/src/lib/business-day.test.ts`, `apps/hub/src/queries/stock.ts`, `apps/hub/test/queries/stock.int.test.ts`; Modify `apps/hub/src/server.ts`.

`businessDayStartedAt`: local midnight of `nowMs` (`new Date(nowMs)`, `setHours(0,0,0,0)`) + `business_day_start_ms`; if > `nowMs`, use the previous day (`setDate(d − 1)`). Tests save `process.env.TZ`, set `'Asia/Karachi'` in `beforeAll`, restore it in `afterAll` (R35). Stock query: resource `stock`, `sessionKind: 'admin'`, `session: 'none'` (as 00's admin queries: the admin guard already requires the session, so this matches §6.19's "session required", R43); handler checks `ctx.directory.resolve(ctx.session!.staff_id, 'manage-stock').grant === 'allowed'` else `403 PERMISSION_DENIED { permission: 'manage-stock' }`. Shape §6.19.

- [ ] **Step 1: Tests:** `[01a §10 #104]` (unit: the `businessDayStartedAt` cases; the badge part is task 50, N11), `[01a §10 #72]` (`statementCounter(deps.readDb)`, R31), `[01a §10 #103]`; `[01a §6.19] an admin without manage-stock → 403`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 35 business day and stock query [spec §6.19, S30, S33]`

### Task 36: Hub config status and `pull-now`

**Files:** Create `apps/hub/src/queries/config-status.ts`, `apps/hub/src/sync/config-routes.ts`, `apps/hub/test/sync/config-routes.int.test.ts`; Modify `apps/hub/src/server.ts`.

`POST /admin/config/pull-now` (`group: 'admin'`): `Promise.race([poller.pollOnce(), a 12 000 ms setTimeout])` (a real timer; it records nothing). Mapping per N5; `unauthorized` is also logged at `error`. Config status: resource `config-status`, shape §6.21.

- [ ] **Step 1: Tests:** `[01a §10 #55]` (the "no admin session" case sends a paired device's token, so the answer is `401 ADMIN_SESSION_REQUIRED`, R44), `#56`, `#102` (server part, N11).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 36 config status and pull-now [spec §6.20, §6.21, S24, S29 c]`

### Task 37: Hub WS audiences and catch-up parts

**Files:** Create `apps/hub/src/ws/restaurant-audiences.ts`, `apps/hub/src/ws/restaurant-catch-up.ts`, `apps/hub/test/ws/restaurant-ws.int.test.ts`; Modify `apps/hub/src/server.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #73]`, `#89`, `#90` (`vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] })`), `#91`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 37 restaurant ws pushes and catch-up [spec §4.5]`

### Task 38: Hub `GET /queries/branch-config`

**Files:** Create `apps/hub/src/queries/branch-config.ts`, `apps/hub/test/queries/branch-config.int.test.ts`; Modify `apps/hub/src/server.ts`.

`defineQuery({ resource: 'branch-config', sessionKind: 'device', session: 'required', allowStation: true, … })` → `{ data: { config_version, snapshot_hash, snapshot } }` or `{ data: null }` from `currentConfigEntry()`.

- [ ] **Step 1: Test:** `[01a §10 #92]` (count on `deps.readDb` = 0).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 38 branch config query [spec §6.23]`

### Task 39: `apps/client` scaffold and build

**Files:** Create `apps/client/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts}`, `apps/client/owner/index.html`, `apps/client/admin-stock/index.html`, `apps/client/src/app/{router.ts,mount.tsx,ui-kit.ts,router.test.tsx}`, `apps/client/src/features/owner/main.tsx`, `apps/client/src/features/admin/stock/main.tsx`, `apps/client/src/i18n/{en.ts,index.ts}`, `apps/client/test/setup.ts`, `apps/client/test/build-output.test.ts`; Modify root `package.json` (`"test": "pnpm --filter @pos/client build && vitest run"`; `engines.node` `">=22.22.2 <23"`), `.gitignore` (`apps/client/dist/` if `dist` is not already ignored), `pnpm-lock.yaml`.

- `package.json`: `"name": "@pos/client"`, private, `"type": "module"`, deps exactly S35 g plus `"@pos/domain": "workspace:*"`, `"@pos/events": "workspace:*"`; scripts `"build": "vite build --mode owner && vite build --mode admin-stock"`, `"typecheck": "tsc --noEmit"`.
- `vite.config.ts`: `defineConfig(({ mode }) => { if (mode !== 'owner' && mode !== 'admin-stock') throw …; return { root: fileURLToPath(new URL(`./${mode}/`, import.meta.url)), base: mode === 'owner' ? '/owner/' : '/admin/stock/', build: { outDir: fileURLToPath(new URL(`./dist/${mode}/`, import.meta.url)), emptyOutDir: true, manifest: true, assetsInlineLimit: 0 } } })`. JSX uses Vite's built-in transform with the tsconfig's `jsx`; no plugin.
- `tsconfig.json` (R21): standalone (not the base): `strict`, `target ES2023`, `module ESNext`, `moduleResolution Bundler`, `jsx react-jsx`, `lib ["ES2023","DOM","DOM.Iterable"]`, `types []`, `noEmit`, `skipLibCheck`, `include ["src"]`, `exclude ["src/**/*.test.tsx"]` (`vite.config.ts` and `test/` run under Vite/Vitest only and are not typechecked, so `@types/node` is not needed).
- `vitest.config.ts`: `defineProject({ test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'] } })`; `setup.ts` sets `globalThis.IS_REACT_ACT_ENVIRONMENT = true` (R23).
- `src/app/ui-kit.ts`: `import '../../../../packages/ui-kit/tokens.css'; import '../../../../packages/ui-kit/components/bundle.css';` — the only CSS imports (S35 d, R14). `mount.tsx` imports it and renders the entry's root into `#root`. Each `main.tsx` mounts a placeholder view with an i18n title.

- [ ] **Step 1: Tests:** `[01a S35 b] useHashRoute follows hashchange`; `build-output.test.ts` (first line `// @vitest-environment node`, R22): `[01a §10 #113]` exactly as §10, plus `[01a S35 d] each dist has an assets/*.woff2 file` (R14).
- [ ] **Step 2:** `pnpm install && pnpm vitest run --project @pos/client` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm --filter @pos/client build && pnpm vitest run --project @pos/client` → PASS; `pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 39 client app scaffold and build [spec S35, S39 a]`

### Task 40: `apps/client` lint rules

**Files:** Modify `eslint.config.js`; Create `apps/client/test/lint.test.ts`.

Add one block **last** in the config, `files: ['apps/client/src/**/*.{ts,tsx}']` (R11):
- `'no-restricted-syntax': ['error', { selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]', message: 'S35 e' }, { selector: 'JSXAttribute[name.name="style"]', message: 'S35 d: style only from packages/ui-kit' }]` — no `forbiddenCalls` (browser code may read the clock); do **not** add `apps/client/src/**` to the existing `'off'` list.
- `'no-restricted-imports': ['error', { paths: [{ name: '@pos/domain/hash', message: 'S27' }], patterns: [...dbClientImports.patterns, ...qrcodeImports.patterns, ...credentialLookupImports.patterns, ...systemContextImports.patterns, { group: ['node:*'], message: 'S35 f' }, { group: ['**/apps/hub/**', '**/apps/cloud/**', '**/hub/src/**', '**/cloud/src/**'], message: 'S35 f' }, { regex: '^(?!.*packages/ui-kit/).*\\.css$', message: 'S35 d: CSS only from packages/ui-kit' }] }]` (flat config replaces, not merges, the root options, so the root patterns are repeated).

- [ ] **Step 1: Tests** (`lint.test.ts`, `// @vitest-environment node`, `new ESLint().lintText(code, { filePath: 'apps/client/src/x.tsx' })`): `[01a §10 #79]` exactly as §10 (forbidden imports, a `.css` outside the kit and a `style` prop fail; `../../../../packages/ui-kit/tokens.css` and `@pos/domain` pass); `[01a S35 e] dangerouslySetInnerHTML fails`; `[F §6.7] Date.now() in apps/client/src passes, in apps/hub/src fails`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm lint` → commit `feat(01a): task 40 client lint rules [spec S35 d, e, f]`

### Task 41: `client-dist`, `admin-page` group, `/owner/*` allowlist and CSP — needs Docker Postgres

**Files:** Create `apps/hub/src/lib/client-dist.ts`, `apps/cloud/src/lib/client-dist.ts`, `apps/hub/test/client-dist.int.test.ts`, `apps/cloud/test/owner-pages.int.test.ts`; Modify `apps/hub/src/auth/guards.ts` (group `'admin-page'` in `RouteGroup` and `GROUPS`; `guardsFor` gives it host, provisioned, guest), `apps/hub/test/auth/guards.int.test.ts` (expected map gains `'admin-page': ['host', 'provisioned', 'guest']`), `apps/hub/src/server.ts` (`registerClientDist(app, { prefix: '/admin/stock/', dir: CLIENT_DIST_DIR, routeConfig: { group: 'admin-page' } })`), `apps/cloud/src/server.ts` (prefix `/owner/`, `routeConfig: { tenantScope: 'none' }`, CSP header), `apps/cloud/src/plugins/tenant-scope.ts` (`TENANT_SCOPE_ALLOWLIST` += `'GET /owner/'`, `'GET /owner/*'`), `apps/cloud/test/route-inventory.int.test.ts` (`ALLOWLIST`).

§7.1 and S39 b: `CLIENT_DIST_DIR = fileURLToPath(new URL('../../../client/dist/<entry>/', import.meta.url))` (R18). At registration read the file list and bodies into memory; a missing dir → `app.log.error` and every path `404`; `GET <prefix>` → `index.html`; `GET <prefix>*` → a listed file whose extension is in the map, else `404 ROUTE_NOT_FOUND` (so `.vite/manifest.json` is never served). Types: `.html text/html; charset=utf-8`, `.js text/javascript; charset=utf-8`, `.css text/css; charset=utf-8`, `.woff2 font/woff2`, `.svg image/svg+xml`, `.png image/png`. Adding §7.1's `admin-page` group (with the M79 guards) keeps the spec literal.

- [ ] **Step 1: Tests:** hub file `[01a §10 #78]` — one test runs the cases (temp dir with `index.html`, `assets/a1.js`, `.vite/manifest.json`; a path with `../`; a missing dir) against both helpers, importing the cloud one by relative path (`../../cloud/src/lib/client-dist`; it imports only `node:*` and `fastify`). Cloud file `[01a §10 #15]` (real `apps/client/dist/owner/`: `/owner/` and one `assets/*.js` and `assets/*.css` load with no JWT and carry the CSP header; no `<script>` without `src`; `GET /ui/tokens.css` → 404; route inventory passes).
- [ ] **Step 2–5:** `pnpm --filter @pos/client build && pnpm vitest run apps/hub/test/client-dist.int.test.ts apps/hub/test/auth/guards.int.test.ts apps/cloud/test/owner-pages.int.test.ts apps/cloud/test/route-inventory.int.test.ts` → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 41 serve built client pages [spec §7.1, S21, S35 c, S39 b]`

### Task 42: `apps/hub/deploy/ship-client.sh`

**Files:** Create `apps/hub/deploy/ship-client.sh` (mode 755).

§7.8 step 3 (a)–(d) exactly: `#!/usr/bin/env bash`, `set -euo pipefail`, usage `ship-client.sh <ssh-target>`; only `bash`, `git`, `tar`, `ssh`. The spec checks it in the runbook's release drill (task 54), not in Vitest.

- [ ] **Step 1: Check before writing:** `bash apps/hub/deploy/ship-client.sh` → "No such file".
- [ ] **Step 2:** Write the script.
- [ ] **Step 3: Checks:** `bash -n apps/hub/deploy/ship-client.sh` → no output; no argument → usage, exit ≠ 0; with an uncommitted scratch file present → "tree is dirty", exit ≠ 0, no `ssh` attempted (delete the scratch file after); with `apps/client/dist` removed → "build output missing", exit ≠ 0.
- [ ] **Step 4:** Commit `feat(01a): task 42 hub client ship script [spec S39 d, e, §7.8]`

### Task 43: Shared components

**Files:** Create `apps/client/src/components/{PinPad,StaffTiles,BusyButton,Banner}.tsx`, `apps/client/src/components/components.test.tsx`; Modify `apps/client/src/i18n/en.ts`.

Props per the Interfaces block; data and callbacks only, no API calls (S35 i). UI kit classes from `packages/ui-kit/README.md`. `BusyButton` shows the slow state after 3 000 ms of `busy`.

- [ ] **Step 1: Tests:** `[01a S35 i] PinPad calls onSubmit with the typed digits and clears`; `StaffTiles calls onPick with the staff id`; `BusyButton is disabled while busy and shows the slow text after 3 s` (fake timers); `Banner renders its tone class`.
- [ ] **Step 2–5:** `pnpm vitest run --project @pos/client` → FAIL → implement → PASS → commit `feat(01a): task 43 shared client components [spec S35 i, §8.1]`

### Task 44: Owner money and `cloud-admin` client

**Files:** Create `apps/client/src/features/owner/money.ts`, `money.test.ts`, `apps/client/src/api/cloud-admin.ts`, `apps/client/src/api/cloud-admin.test.ts`.

`money.ts` rules: N7. `cloud-admin.ts`: tokens in `sessionStorage` (`owner_access_token`, `owner_refresh_token`); typed calls for §6.2–§6.16 returning parsed `{ data }` or a typed error; on `401 JWT_INVALID` call `/v1/auth/refresh` once and retry the same request (same headers, same `Idempotency-Key`); a second `401` clears storage and calls `onLoggedOut()`; network failure → a `network` error the views show as a banner.

- [ ] **Step 1: Tests:** `[01a §10 #74]`; Review Focus 2: `[01a §8.1] " 1,200 " → 120000; "1,2,3" rejected`; Review Focus 3: `[01a §8.1] 401 → one refresh → retried with the same Idempotency-Key; second 401 → onLoggedOut and storage cleared`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 44 owner money parsing and cloud client [spec §8.1]`

### Task 45: Owner shell — login, branch picker, app

**Files:** Create `apps/client/src/features/owner/login/LoginView.tsx`, `apps/client/src/features/owner/BranchPicker.tsx`, `apps/client/src/features/owner/App.tsx`, `apps/client/src/features/owner/App.test.tsx`; Modify `apps/client/src/features/owner/main.tsx`, `apps/client/src/i18n/en.ts`.

Routes `#/login`, `#/`, `#/floors`, `#/stations`, `#/menu` (§8.1); no token → `#/login`; branch picker lists `allowed_branch_ids` decoded from the JWT payload (S37).

- [ ] **Step 1: Tests:** `[01a §8.1] no token shows login; a successful login stores tokens and shows the branch picker with the JWT's branch ids`; `[01a §8.1] a failed login shows errors.LOGIN_INVALID text`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 45 owner app shell [spec §8.1, S37]`

### Task 46: Owner floors view

**Files:** Create `apps/client/src/features/owner/floors/FloorsView.tsx`, `FloorsView.test.tsx`, `apps/client/src/features/owner/form.ts` (`useIdempotencyKey()`: a key per opened form, kept across retries); Modify `apps/client/src/features/owner/App.tsx`, `apps/client/src/i18n/en.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #76]` on the "add floor" form (network failure, retry sends the same key; close and reopen → new key, R37); `[01a §8.1] floors with tables, archived rows behind a toggle, sort number edit sends PATCH { sort_order }`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 46 owner floors view [spec §8.1]`

### Task 47: Owner stations view

**Files:** Create `apps/client/src/features/owner/stations/StationsView.tsx`, `StationsView.test.tsx`; Modify `apps/client/src/features/owner/App.tsx`, `apps/client/src/i18n/en.ts`.

- [ ] **Step 1: Tests:** `[01a §8.1] freshness field only for batch; programs listed under batch stations; a 409 shows errors.CONFIG_IN_USE text`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 47 owner stations view [spec §8.1]`

### Task 48: Owner menu view

**Files:** Create `apps/client/src/features/owner/menu/{MenuView,ItemForm}.tsx`, `MenuView.test.tsx`; Modify `apps/client/src/features/owner/App.tsx`, `apps/client/src/i18n/en.ts`.

Tax picker: "No tax" first and default; route picker per branch filtered by station type (program select only for batch); minutes ↔ `_ms`; "When pre-cooked stock runs out": Cook fresh (default) / Sold out.

- [ ] **Step 1: Tests:** `[01a §10 #75]` (render part; the lint part is task 40, N11); `[01a S34] a new item defaults to No tax and sends tax_class_id null`; `[01a S11] a batch station shows the program select, a slot station hides it`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 48 owner menu view [spec §8.1, S32, S34]`

### Task 49: `/admin/stock` — `hub-admin` client and PIN login

**Files:** Create `apps/client/src/api/hub-admin.ts`, `hub-admin.test.ts`, `apps/client/src/features/admin/stock/{StockApp,AdminLogin}.tsx`, `AdminLogin.test.tsx`; Modify `apps/client/src/features/admin/stock/main.tsx`, `apps/client/src/i18n/en.ts`.

`hub-admin.ts` calls the endpoints 00's admin pages call (read `apps/hub/src/auth/admin-session.ts` and `apps/hub/src/auth/pair-page.ts` for paths, headers, IndexedDB `pos-device` / store `device`, `sessionStorage` key `admin_session_token`). `readDeviceToken` defaults to the IndexedDB read; tests inject it (jsdom has no IndexedDB, R10). `AdminLogin` = `StaffTiles` + `PinPad`.

- [ ] **Step 1: Tests:** `[01a §8.2] no admin session shows the roster; picking a tile and a PIN stores admin_session_token and shows the stock view`; `[01a §8.2] hub-admin sends the device token and admin session headers`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 49 hub admin client and PIN login [spec §8.2, S35 i]`

### Task 50: `/admin/stock` — stock table, banners, save

**Files:** Create `apps/client/src/features/admin/stock/{StockTable,ConfigBanners}.tsx`, `apps/client/src/features/admin/stock/badges.ts`, `StockTable.test.tsx`; Modify `StockApp.tsx`, `apps/client/src/i18n/en.ts`.

§8.2: stock + config status on open and every 15 000 ms while `document.visibilityState === 'visible'`; **Save counts** sends changed rows only, `on_hand` as numbers, `command_id` kept for retries; badges from `badges.ts` (Interfaces).

- [ ] **Step 1: Tests:** `[01a §10 #77]`; `[01a §8.2, S29 c] danger banner for rejected / upgrade_required / unauthorized; warn banner when epoch_changed_at is within 24 h, not after` (page part of #102, N11); `[01a S33] notCountedToday: set_at yesterday 23:00 with day start today 05:00 → true; null → true` (page part of #104); `[01a §8.2] on_hand values are sent as numbers`; Review Focus 4: `[01a §8.2] a refresh does not overwrite the row being edited`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm --filter @pos/client build` → commit `feat(01a): task 50 hub stock and availability page [spec §8.2, S29 c, S30, S33]`

### Task 51: Spec 00 v1.3 entry for `allowNotNewer` — Claude only, STOP

**Files:** Modify the 00 spec (behaviour entry for S36 b narrowing M51; version v1.3); `docs/specs/README.md`.

- [ ] Write the entry; get the user's approval (§12.1). **STOP** until approved. Commit `feat(01a): task 51 spec 00 v1.3 allowNotNewer entry [spec S36]`

### Task 52: `applyStaffDirectory` `allowNotNewer`

**Files:** Modify `apps/hub/src/auth/apply-directory.ts` (4th parameter; the not-newer early return applies only when `opts?.allowNotNewer !== true`); Create `apps/hub/test/auth/apply-directory-not-newer.int.test.ts`.

- [ ] **Step 1: Test:** `[01a §10 #112]`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm vitest run apps/hub/test/auth` unchanged → commit `feat(01a): task 52 applyStaffDirectory allowNotNewer [spec S36 b, 00 v1.3]`

### Task 53: Directory resend on epoch change — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/config-sync/service.ts` (directory when `directory_version` differs **or** the epoch differs), `apps/hub/src/sync/config-poller.ts` (§3.4 step 5 b: `{ allowNotNewer: outcome === 'epoch_changed' }`; the directory part runs on `epoch_changed` even when not newer); Create `apps/cloud/test/config-sync/directory-resend.int.test.ts`, `apps/hub/test/sync/directory-resend.int.test.ts`.

- [ ] **Step 1: Tests:** cloud `[01a §10 #109]`; hub `[01a §10 #110]`, `[01a §10 #111]`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 53 directory resend on epoch change [spec S36]`

### Task 54: Manual runbook and release drill — needs Docker Postgres, needs hardware

**Files:** none. Run on the dev box with the setup of `docs/manual-test-00.md` §1–§3 (database `pos_manual`, never `pos_test`, which the cloud tests truncate; cloud on port 4000 through the `cloud` wrapper with `node --import tsx src/main.ts`; hub on port 3000 with `cd apps/hub && node --import tsx src/main.ts`). Report each result in the chat; Claude writes `docs/manual-test-01a.md` from the report (task 55).

- [ ] `pnpm --filter @pos/client build`; start cloud and hub; `seed-tenant`, `issue-registration-code`, provision as in 00's runbook.
- [ ] Owner at `http://localhost:4000/owner/`: floor, slot station "Karahi", batch station "Fryer" with a program, a category, two items (one with stock time). Within 60 s, or after **Get changes now**, the hub `http://localhost:3000/admin/stock/` lists them.
- [ ] Pair a KDS browser to "Karahi" (00 screen-request flow) → paired.
- [ ] Stop the cloud; set counts and toggle an item off → saved; config status shows offline.
- [ ] Restore drill: `pg_dump pos_manual`, make two menu edits and remove a staff member, restore the dump, `pnpm --filter @pos/cloud rotate-config-epoch --branch <id>`; the hub applies the older menu and directory and shows the epoch banner.
- [ ] Timing (§7.5, N10): note the p95 of 20 `curl` calls for the `304` path and for a full snapshot, and the hub apply time from the log.
- [ ] **needs hardware** — release drill §7.8 steps 1–4 against the pilot mini PC or any `ssh` target with an `/opt/pos-hub` checkout, including one refusal (dirty tree or a different commit); ends with `/admin/stock/` → `200` on the hub. Optional on the mini PC: `SetPrecookedStock` with 200 entries ≤ 50 ms p95.
- [ ] No commit.

### Task 55: README, spec status, runbook file, DoD close-out — Claude only

**Files:** Modify `docs/specs/README.md` (01a status, carried requirements §4.4, 00 drift notes §2), the 01a spec status line; Create `docs/manual-test-01a.md` (from task 54's report, same layout as `docs/manual-test-00.md`).

- [ ] `for n in $(seq 1 113); do c=$(grep -rhoE "\[01a §10 #$n\]" apps packages | wc -l); [ "$c" = 1 ] || echo "#$n: $c"; done` → no output.
- [ ] Walk §12.1 and §12.2; record gaps. Commit `feat(01a): task 55 module 01a close-out [spec §12.1]`
