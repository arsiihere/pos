# 01a Restaurant Setup — Implementation Plan (spec v0.6.1)

> **For the implementer (Cursor, no plugins):** follow `.cursor/rules/pos.mdc` (task 3 points it at this plan). Do **one task per request**, in order. Each task: write the listed tests first, run them and see them fail for the stated reason, implement, run the task command and then `pnpm test`, check **Done when**, commit. Steps use checkboxes (`- [ ]`); do **not** tick them in this file (it is read-only for you). Tasks marked **Claude only** edit `docs/`, `.cursor/` or the foundation: **skip them and tell the user**.

**Goal:** Build module 01a: cloud restaurant data (floors, tables, stations, programs, tax classes, categories, items, per-branch routes) with idempotent creates and an audit trail; config delivery to the hub through a conditional poll; the hub's config apply as an event, the stock slice of `@pos/engine`, pre-cooked stock and availability commands; the owner app and the hub `/admin/stock` page as entries of one Vite app, `apps/client`, with its build and hub release script; the `restore-bump` and `set-branch-settings` cloud CLIs.

**Architecture:** The cloud owns the menu; every owner write runs one PostgreSQL transaction (idempotency key → lock → checks on the merged row → write → `config_audit` → `bumpConfigVersion`). The hub polls `GET /v1/sync/config` every 60 s, verifies the snapshot hash over the exact wire JSON, and applies it in one `writer.run` (`config_snapshots` insert + `BranchConfigApplied` + optional staff directory), swapping the in-memory config after COMMIT; a failed apply is recorded as a visible problem and each part is retried alone. Stock lives only in `EngineState.stock`, folded from `StockSet` events; a count from an earlier business day reads as 0.

**Tech stack:** existing 00 stack (Fastify 5.12.7, Zod 4.6.7, better-sqlite3 13.0.3, pg 8.23.1, Vitest 4.1.12, ESLint 10.13.0) + `apps/client` only: React 19.3.1, Vite 8.3.5, jsdom 30.1.3.

**Spec:** `docs/specs/01_Restaurant_Setup_Spec_v0.6.1.md` (cited "§x" or "S12"); foundation `docs/specs/00_Foundation_Spec_v1.7.md` ("F §x"); 00 spec `docs/specs/00_Hub_Platform_Access_Spec_v1.2.md` ("00 Mxx"; v1.2.1 after task 1). Read the cited spec section before each task; the plan does not repeat the spec's tables. Reviews applied: `docs/reviews/01a_plan_review.md` (cited "R#n" as "Rn") and `docs/reviews/01a_spec_review_1.md` (through spec v0.6, cited by the spec decision it produced).

**Gate before task 4 (the first code task):** Do not start until the owner answers are applied (spec v0.7) and a re-review approves it (v1.0). Then re-baseline again (expected small).

**Starting point:** module 00 is built. Reuse, do not recreate: hub `writer.run`, `createStateHolder`, `createProjectionRegistry`, `registerBootStep`, `defineCommand` / `commandRegistry(app)`, `defineQuery` / `queryRegistry(app)`, `registerStationValidator` / `stationExists`, `registerEventAudience`, `registerCatchUp`, `applyStaffDirectory` (signature unchanged), `swapDirectory(app, …)`, `lib/hash.ts`, `lib/ui-assets.ts` (pattern for §7.1), `setup/cloud-client.ts` (pattern for the poll client), test helpers `createTestHub`, `seedDirectory`, `pairDevice`, `openSession`, `statementCounter`, `connectWs`, `aDirectory`, `captureLogs`; cloud `TenantScopedRepository`, `TenantLevelRepository`, `registerTenantScope` (`TENANT_SCOPE_ALLOWLIST`), `registerErrorHandler`, `loadDirectory` (`modules/hub-registration/repository.ts`), `SystemContext`, `seedTenant`, `issueRegistrationCode`, `createTestCloud`, `truncateAll`; the manual setup in `docs/manual-test-00.md`.

## Markers

| Marker | Meaning |
|---|---|
| **Claude only** | Edits `docs/`, `.cursor/` or the foundation. Cursor skips it. |
| **needs Docker Postgres** | The task's own command needs Postgres. Note: **every** `pnpm test` runs the cloud suite, so Postgres must be up for every `pnpm test`: keep `docker compose up -d postgres` running for every task (R19). |
| **needs hardware** | Needs the pilot mini PC or another `ssh` target on the LAN. Only task 58 (release drill, §7.5 timing). |
| **STOP** | Do not start the next task until the user confirms. |

## Global Constraints

Every task implicitly includes these. Values copied from spec v0.6.1.

- **Node:** 22.22.2 or later on dev machines and CI (S35 g; jsdom 30.1.3 needs it). Root `engines.node` becomes `>=22.22.2 <23` in task 46.
- **Dependencies (§12.1, S35 g):** none new in `apps/hub`, `apps/cloud`, `packages/*` except workspace links (`@pos/engine` in `apps/hub` and `apps/client`) and `@types/node@22.19.1` (dev, types only) in `packages/domain` (S40 N1). `apps/client` only, a closed list: `react@19.3.1`, `react-dom@19.3.1` (runtime); `vite@8.3.5`, `jsdom@30.1.3`, `@types/react@19.3.0`, `@types/react-dom@19.3.0` (dev). Exact pins. No router, state, form, CSS or testing library; no React plugin; no `ulid` package in the client (S35 j).
- **Browser-safe packages (S35 k):** nothing under `packages/engine/**`, and nothing under `packages/domain/src/**` except `src/hash.ts`, imports `node:*` (test files exempt). Lint enforces it from task 10.
- **Determinism (F §6.7):** no `Date.now()`, `Math.random()`, `ulid()`, `crypto.randomUUID()` in hub/cloud/package `src/` (lint enforces). `apps/client/src/**` is browser code and may read the clock and `crypto.getRandomValues` (task 47 sets the lint block); it never calls `crypto.randomUUID` (no secure context on the hub, S35 j).
- **Envelope (F §6.1):** `{ data }` or `{ error: { code, message, details, request_id } }`. The only body-less reply is §6.1's `304`. Replays add `Idempotent-Replay: true`. The hub never answers `503` (S24 removed `pull-now`).
- **Errors:** only catalogue codes; `throw new DomainError(code, details)`. New codes exist after task 4 (12 codes, §9). A tenant-wide write by an owner who does not cover every branch is `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` (S8; existing code).
- **Naming (F §6.6):** snake_case on the wire and in SQL; camelCase in TS; `*_at` Unix ms; `*_ms` durations; money `*_minor` integer.
- **Cloud SQL (D54):** owner routes query only through `TenantScopedRepository` (branch-level tables: SQL uses `$1` tenant and `$2` branch-id array, e.g. `WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3`) or `TenantLevelRepository` (SQL contains `tenant_id = $1`; tenant-level tables `tax_classes`, `categories`, `menu_items`, `idempotency_keys`, `config_audit`, plus `branches` for `bumpConfigVersion` only: the D54 exception of S40 N3). Both accept a `pg.PoolClient`. Path `branch_id` not in `request.tenant.branchIds` → `404 BRANCH_NOT_FOUND`. CLIs use `SystemContext` (M56).
- **Cloud write script (§6 intro):** Zod → `BEGIN` → [creating POST: idempotency key insert, `request_hash` over method + filled path + body] → target `FOR UPDATE` (`404` if absent) → rule checks on the **merged** row; reference rows `FOR SHARE` in id order → write → `writeConfigAudit` → `bumpConfigVersion` (branch rows last; tenant-wide: coverage check) → [store response on key] → `COMMIT` → [creating POST: prune old keys in their own statement]. pg `23505` on an `*_active_name` index → `409 CONFIG_NAME_TAKEN { entity, name }`. Route body schemas are validated before the tenant guard runs, so tests that expect `401`/`404`/`403` send a valid body (R39).
- **Hub SQL:** `writer.run` only; no `await` inside it; queries never write; query handlers `prepare` per call (so `statementCounter` on `deps.readDb` sees them, R31). Projection times are the event's `recorded_at`, never the clock (§5.1).
- **Fixed values:** poll interval 60 000 ms; poll HTTP timeout 10 000 ms; names 1–60 chars trimmed, unique case-insensitive among active rows; `price_minor` 0…1 000 000 000; `cook_time_ms` 1…14 400 000; `prep_buffer_ms` 0…3 600 000; `stock_time_ms` null or 0…`cook_time_ms`; `rate_bp` 0…10 000; station `capacity` 1…100; `freshness_window_ms` batch only 0…3 600 000 default 0; `completion_mode` `two_tap` (default) / `single_tap` / `auto_done`; `seats` null or 1…100; `description` ≤ 300; `out_of_stock_behaviour` `cook_fresh` (default) / `sold_out`; `business_day_start_ms` 0…86 340 000, multiple of 60 000, default 18 000 000 (not settable in 01a); idempotency rows pruned after 86 400 000 ms, at most 100 per prune; stock entries 1–200, `on_hand` int 0…9 999; `SNAPSHOT_SCHEMA_VERSION = 1`; stock page refresh 15 000 ms; CSP `default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` (cloud `/owner/*` and hub `/admin/stock/*`); `Cache-Control` `no-cache` (index.html) and `public, max-age=31536000, immutable` (`assets/*`); `restore-bump` sets each version to `GREATEST(v + 1, now_ms)`.
- **Client (S35 d–f, j, k):** styling only through `apps/client/src/app/ui-kit.ts` (the only CSS imports); no `style` prop; no `dangerouslySetInnerHTML`; shared components in `src/components/`; ULIDs only from `src/app/ulid.ts`; may import `@pos/domain` (root), `@pos/events`, `@pos/engine`.
- **Secrets never logged (§7.3):** the poller never logs the snapshot body or the directory (PIN hashes); a `malformed` envelope logs only Zod issue paths and codes, never `input` / `received`.
- **Tests:** names `it('[01a §10 #N] …')`, each N in exactly one test (coverage table); other tests cite a section `it('[01a §6.4] …')`; page parts `it('[01a §10 #N page part] …')` (S40 N11). Hub integration `apps/hub/test/**/*.int.test.ts`; cloud integration `apps/cloud/test/**/*.int.test.ts`; unit `*.test.ts` next to source; client `apps/client/src/**/*.test.tsx` and `apps/client/test/*.test.ts`.
- **Cross-tenant and route inventory (D54, M25):** every task that adds a cloud route adds a case to `ROUTE_CASES` in `apps/cloud/test/cross-tenant.int.test.ts` (task 14 creates it) whose path/payload names tenant B's ids and whose body is otherwise valid; the 00 tests stay green.
- **Commit:** `feat(01a): task N <title> [spec §x]`, only the task's files: `git add <files> && git commit -m "…"`.

## Spec decisions applied

**S40 (plan review, spec v0.5):**

| # | Decision | Where in the plan |
|---|---|---|
| N1 | `@types/node@22.19.1` dev dependency in `packages/domain` (`hash.ts` only) | task 6 |
| N2 | `onBranchConfigApplied(prev, next, tx)` | task 34 |
| N3 | Tenant-wide bump through `TenantLevelRepository` on `branches`: allowed D54 exception | task 13 |
| N4 | Skipped poll → outcome `not_ready`, no HTTP call; config status / page say "Waiting for hub confirmation" | tasks 32, 43, 57 |
| N5 | Removed in v0.6 with `pull-now` (S24) | — |
| N6 | S25 edits line 8 | task 1 |
| N7 | Money: trim, drop every comma, ASCII digits with ≤ 2 decimals (`"1,20,000"` ok, `"1,2,3"` = 12300); negatives, letters, other digits rejected | task 51 |
| N8 | `SetPrecookedStock` result `set_at` may differ by ms from the stored `recorded_at`; the stock query is the truth | task 40 |
| N9 | `QueryCtx.branchConfig` (not `.config`) | task 37 |
| N10 | §7.5 targets checked by the runbook / hub smoke script, not automated tests | task 58 |
| N11 | Tests 75, 102, 103, 104: both parts automated. The numbered test covers the server/render part; a test cited `[01a §10 #n page part]` covers the page part; the page parts are also runbook steps | tasks 5, 42, 43, 47, 55, 57, 58 |
| N12 | First boot after 0004 replays the full log once (§7.6 risk) | task 30 |

**Spec v0.6 / v0.6.1 (hostile review 1 and the owner's cuts):**

| Item | Decision | Where in the plan |
|---|---|---|
| Cuts | No epoch, no directory resend, no 00 behaviour change, no schema negotiation, no `pull-now`, no `--business-day-start`, parking is 02's order type (S10, S24, S28, S29, S33, S36) | no task builds them |
| B2 | Failed apply → `last_problem { rejected, apply_failed }`, each part retried alone (S43) | task 35; banner task 57 |
| S-1 | Hash over the exact wire JSON; `canonicalJson` throws on `undefined`; raw `snapshot` response schema (S27) | tasks 6, 18 |
| S-3 | `availableStock(state, itemId, businessDayStartMs)` in `@pos/engine`; `businessDayStartedAt` in `@pos/domain` [ASSUMPTION] (S41, S33) | tasks 5, 9, 42, 44 |
| S-4 | Every confirmed count appends `StockSet` (§6.17, §8.2) | tasks 40, 57 |
| S-5 | `on_hand ≥ 0`, `reserved ≥ 0`; a count below `reserved` leaves `reserved` (S14); re-plan is 03a's | task 9 |
| S-6 | Archived tax classes and programs stay in the snapshot (S22); program cook times copied to order lines is a requirement carried to 02 (§4.4) | tasks 7, 17; README check in task 59 |
| S-7 | Tenant-wide write needs every branch in `allowed_branch_ids` → `403` (S8) | task 26; client text task 55 |
| S-9 | Initial engine state through `BootContext.initialState` → `createDeps`; `branchConfig()` and the station validator load in boot step 5, after step 4's catch-up (S15, §2) | tasks 37, 38 |
| S-10 | On-site LAN release outside service hours: stop → checkout → install → ship-client → start; `ship-client.sh` refuses while the hub runs (S39, §7.8) | tasks 49, 58 |
| S-11 | Happy paths for table PATCH, program, tax class, category; PATCH rules on the merged row (§3.3) | tasks 19, 21, 22, 24 |
| S-12 | `request_hash` over method + path + body; prune after COMMIT with `SKIP LOCKED` (S7) | task 12 |
| Nits | 1 count after the guard (task 18); 2 projection times from `recorded_at` (task 30); 3 `tax_class_id: string \| null` required (task 23); 4 statement 1 inside `REPEATABLE READ` (task 18); 5 browser ULID (task 46); 6 CSP `base-uri` / `form-action`, also on the hub (task 48); 7 root `engines.node` (task 46); 8 `@pos/engine` workspace dep in the hub (task 37); 9 batch-route item fields unused (task 23, no validation change); 10 no Zod inputs in logs (task 32) | as listed |
| Stored body | A stored body whose `snapshot_schema_version` ≠ `SNAPSHOT_SCHEMA_VERSION` counts as missing (S28 b) | task 33 |
| Catch-up | `stock` part carries `business_day_started_at` and `set_at` (§4.5) | task 44 |
| restore-bump | Cloud CLI (S42, §6.7a) | task 29 |
| Browser-safe | Lint block for `packages/engine` and the `packages/domain` root (S35 k) | task 10 |

## Review Focus

Inputs the spec implies but no §10 test covers. Each has a test in the named task.

1. **Names with surrounding spaces or other case** (`" ground "` vs `"Ground"`): stored trimmed; the duplicate is `409 CONFIG_NAME_TAKEN` → task 15.
2. **Prices pasted with a currency prefix** (`"Rs 1,200"`, `"₨1200"`): rejected with the field error, never saved as 0 or as a partial number → task 51.
3. **An owner's access token expiring mid-form**: one refresh, the same request retried with the same `Idempotency-Key`; a second `401` clears storage and goes to `#/login` → task 51.
4. **The 15 s stock refresh landing while the manager types a count**: that row keeps the typed value → task 57.
5. **Shutdown during a poll**: after `stop()` no further poll runs, and an in-flight poll that resolves later does not swap the config → task 38.
6. **The business day rolling over while the stock page is open**: the next 15 s refresh shows Available 0 for counts from the previous day → task 57.

---

## Interfaces (later tasks rely on these exact names)

```ts
// packages/domain/src/business-day.ts — root export of "@pos/domain" (task 5); browser-safe
export function businessDayStartedAt(nowMs: number, businessDayStartMs: number): number; // runtime's local time zone

// packages/domain/src/hash.ts — subpath "@pos/domain/hash" (task 6). Not re-exported from the root.
export function canonicalJson(v: unknown): string;   // throws on undefined anywhere in v (S27)
export function sha256hex(s: string | Buffer): string;

// packages/events/src/config.ts (task 7)
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const BranchConfigSnapshotSchemaV1: z.ZodObject<…>;            // §4.3; NOT .strict()
export type BranchConfig = z.infer<typeof BranchConfigSnapshotSchemaV1>;
export type ConfigItem = BranchConfig['items'][number];
export type ConfigStation = BranchConfig['stations'][number];
export function isStockTracked(config: BranchConfig, item: ConfigItem): boolean;   // §4.3
export const SyncConfigEnvelopeSchema; // { data: { config: { snapshot_hash: string; snapshot: Record<string, unknown> } | null; directory: DirectoryInput | null } }

// packages/events (task 8): BranchConfigApplied, StockSet, ItemMadeUnavailable, ItemMadeAvailable (v1, §4.2)
// packages/events/testing: aBranchConfigApplied(o?), aStockSet(o?), anItemMadeUnavailable(o?), anItemMadeAvailable(o?), aBranchConfig(o?): BranchConfig

// packages/engine/src (task 9) — package "@pos/engine"; browser-safe (S35 k)
export interface StockEntry { on_hand: number; reserved: number; set_at: number | null }
export interface EngineState { stock: Record<string, StockEntry> }
export const ENGINE_STATE_VERSION = 1;
export function initialEngineState(): EngineState;
export function applyEvent(state: EngineState, event: PosEvent): EngineState;    // pure; unknown events return `state` (same reference)
export function buildEngineState(events: readonly PosEvent[]): EngineState;
export function stockOf(state: EngineState, itemId: string): StockEntry;         // missing → { on_hand: 0, reserved: 0, set_at: null }
export function availableStock(state: EngineState, itemId: string, businessDayStartMs: number): number;
//   set_at null or < businessDayStartMs → 0 [ASSUMPTION, S41]; else max(0, on_hand − reserved). The only place the S41 rule lives.

// apps/cloud/src/lib/idempotency.ts (task 12)
export async function inTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>, o?: { isolation?: 'REPEATABLE READ'; readOnly?: boolean }): Promise<T>;
export interface IdempotentResult<T> { status: number; body: T; replay: boolean }
export async function withIdempotency<T>(
  ctx: { pool: pg.Pool; clock: Clock; tenant: TenantContext; log: Pick<FastifyBaseLogger, 'error'> },
  request: { key: string | undefined; method: string; path: string /* filled, e.g. /v1/admin/branches/<b>/floors */; body: unknown },
  fn: (client: pg.PoolClient) => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>>;
export function sendIdempotent(reply: FastifyReply, r: IdempotentResult<unknown>): FastifyReply;

// apps/cloud/src/lib/config-version.ts and config-audit.ts (task 13; tenant scope gains allowedBranchIds in task 26)
// A runner whose $1 is already bound to the tenant id: TenantLevelRepository satisfies it; CLIs build one from SystemContext.
export interface TenantSql { query<R extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<R[]> }
export type BumpScope = { kind: 'branch'; branchId: string } | { kind: 'tenant'; allowedBranchIds: readonly string[] /* task 26 */ };
export async function bumpConfigVersion(db: TenantSql, scope: BumpScope): Promise<Array<{ branch_id: string; config_version: number }>>;
export type AuditEntity = 'floor'|'table'|'station'|'batch_program'|'tax_class'|'category'|'menu_item'|'item_route'|'branch_settings';
export type AuditAction = 'create'|'update'|'archive'|'restore'|'route_set'|'route_removed';
export interface AuditEntry { actor: { kind: 'owner'; ownerUserId: string } | { kind: 'cli' }; entity: AuditEntity; entityId: string; branchId: string | null; action: AuditAction; before: object | null; after: object | null }
export async function writeConfigAudit(db: TenantSql, entry: AuditEntry, deps: { clock: Clock; ids: IdGen }): Promise<void>;
export function auditActionFor(before: { archived_at: number | null }, after: { archived_at: number | null }): 'update' | 'archive' | 'restore';

// apps/cloud/src/server.ts (task 14): CloudDeps gains testHooks?: CloudTestHooks
export interface CloudTestHooks {
  handlerStart?(route: string): void;                 // first line of a handler: tests reset pgCounter here (R9)
  afterTargetLock?(route: string): Promise<void>;     // task 27
  afterReferenceLock?(route: string): Promise<void>;  // task 27
  beforeBump?(): Promise<void>;                       // task 16
  beforePrune?(): Promise<void>;                      // task 12 (forced prune failure, #122)
}
// apps/cloud/test/helpers/test-cloud.ts (task 14): createTestCloud(o?: { captureLogs?: boolean; testHooks?: CloudTestHooks })

// apps/cloud/src/modules/config-sync/builder.ts (task 17) — one builder (S28)
export interface SnapshotHeader { config_version: number; currency_code: string; business_day_start_ms: number; tax_enabled: boolean }
export async function buildSnapshot(client: pg.PoolClient, tenant: TenantContext, branchId: string, header: SnapshotHeader): Promise<Record<string, unknown>>;
//   returns the wire object: JSON.parse(JSON.stringify(BranchConfigSnapshotSchemaV1.parse(built))) (S27)

// apps/cloud/src/cli/restore-bump.ts (task 29)
export async function restoreBump(sys: SystemContext, input: { tenantId: string }, deps: { clock: Clock }):
  Promise<{ branches: Array<{ branch_id: string; before: number; after: number }>; directory: { before: number; after: number } }>;
// apps/cloud/src/cli/set-branch-settings.ts (task 28)
export async function setBranchSettings(sys: SystemContext, input: { branchId: string; taxEnabled: boolean }, deps: { clock: Clock; ids: IdGen }): Promise<{ tax_enabled: boolean }>;

// apps/hub/src/projections/branch-config.ts (task 30)
export interface BranchConfigRow { branch_id: string; config_version: number; snapshot_schema_version: number; snapshot_hash: string; applied_at: number }
export const branchConfigProjection: Projection;
export function readBranchConfigRow(db: Database.Database, branchId: string): BranchConfigRow | undefined;
export function parseStoredSnapshot(body: string): BranchConfig;                 // JSON.parse + BranchConfigSnapshotSchemaV1
export type LoadedConfig = { state: 'NONE' } | { state: 'BODY_MISSING'; row: BranchConfigRow } | { state: 'APPLIED'; row: BranchConfigRow; entry: ConfigEntry };
export function loadBranchConfig(db: Database.Database, branchId: string): LoadedConfig;
//   2 primary-key reads; a row whose snapshot_schema_version ≠ SNAPSHOT_SCHEMA_VERSION is BODY_MISSING (S28 b)
// apps/hub/src/projections/item-availability.ts (task 30)
export const itemAvailabilityProjection: Projection;
export function itemAvailability(db: Database.Database, itemIds: readonly string[]): Map<string, boolean>; // 1 statement
export function registerRestaurantProjections(projections: ProjectionRegistry): void;

// apps/hub/src/sync/branch-config-holder.ts (ConfigEntry type: task 30; functions: task 31; hooks: task 34)
export interface ConfigEntry { config: BranchConfig; snapshotHash: string; configVersion: number; snapshotSchemaVersion: number; appliedAt: number }
export function branchConfig(): BranchConfig | null;
export function currentConfigEntry(): ConfigEntry | null;
export function swapBranchConfig(entry: ConfigEntry | null): void;
export function onBranchConfigApplied(fn: (prev: BranchConfig | null, next: BranchConfig, tx: WriterTx) => void): () => void;
export function runBranchConfigHooks(prev: BranchConfig | null, next: BranchConfig, tx: WriterTx): void; // a throw propagates (S43)

// apps/hub/src/sync/config-client.ts (task 31)
export interface ConfigQuery { config_version: number; directory_version: number }
export type ConfigFetch =                                         // network error, timeout and 5xx all map to 'offline' here (R30)
  | { kind: 'not_modified' } | { kind: 'ok'; text: string } | { kind: 'offline' }
  | { kind: 'error'; status: number; code: string; details: Record<string, unknown> };   // 4xx only
export interface ConfigClient { fetchConfig(q: ConfigQuery): Promise<ConfigFetch> }
export function httpConfigClient(baseUrl: string, branchApiKey: string, timeoutMs?: number): ConfigClient; // default 10_000

// apps/hub/src/sync/config-poller.ts (tasks 32–36, 38)
export type PollOutcome = 'applied'|'unchanged'|'offline'|'rejected'|'unauthorized'|'not_ready';
export type RejectReason = 'malformed'|'hash_mismatch'|'schema_unsupported'|'schema_invalid'|'apply_failed';
export interface PollResult { outcome: PollOutcome; config_version: number | null; directory_version: number; at: number }
export interface PollProblem { outcome: 'rejected' | 'unauthorized'; reason: RejectReason | 'unauthorized'; at: number }
export interface ConfigPoller { pollOnce(): Promise<PollResult>; lastPoll(): { outcome: PollOutcome; at: number } | null; lastProblem(): PollProblem | null; start(intervalMs?: number): void; stop(): void }
export function createConfigPoller(deps: {
  config: HubConfig; db: Database.Database; writer: Writer; clock: Clock; client: ConfigClient;
  setDirectory: (d: StaffDirectory) => void; log: Pick<FastifyBaseLogger, 'debug'|'info'|'warn'|'error'>;
  applyDirectory?: typeof applyStaffDirectory;   // test seam for S43 (#50); default 00's function
}): ConfigPoller;
export function configPoller(app: FastifyInstance): ConfigPoller;   // WeakMap, set by buildHubServer
// HubDeps gains (task 32): configClient?: ConfigClient   (default httpConfigClient(config.cloud_base_url, provisioned.branch_api_key))
// BootOptions gains (task 38): configClient?: ConfigClient

// apps/hub/src/sync/boot-steps.ts (tasks 37–38)
export function foldStockEvents(db: Database.Database, branchId: string): EngineState;  // stream_type = 'stock' AND event_type = 'StockSet', by seq
export function registerRestaurantBootSteps(): void;  // idempotent; step '3' stock fold → ctx.initialState, '5' config load, '6' poller start
// lib/boot.ts (task 37): BootContext gains initialState?: unknown; createDeps(…, initialState?) builds createStateHolder(initialState ?? {}) (S15, §2)
// HubDeps.state: StateHolder<EngineState>; CommandCtx.state: Readonly<EngineState>; QueryCtx gains state: Readonly<EngineState>, branchConfig: BranchConfig | null (S40 N9)

// apps/{hub,cloud}/src/lib/client-dist.ts (task 48) — identical apart from the entry name
export const CSP = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export function registerClientDist(app: FastifyInstance, o: { prefix: '/owner/' | '/admin/stock/'; dir: string; routeConfig: Record<string, unknown> }): void; // every file gets CSP
export const CLIENT_DIST_DIR: string;  // fileURLToPath(new URL('../../../client/dist/<entry>/', import.meta.url)) — owner on cloud, admin-stock on hub (S39 b)

// apps/client (tasks 46–57)
// src/app/ulid.ts (task 46): export function newUlid(nowMs?: number): string;   // Date.now() + crypto.getRandomValues, Crockford base32 (S35 j)
// src/components/: PinPad({ length?, busy, onSubmit(pin) }), StaffTiles({ staff, onPick }), BusyButton({ busy, children, … }), Banner({ tone: 'danger'|'warn'|'info', children })
// src/features/owner/money.ts
export function parseRupeesToMinor(input: string): { ok: true; value: number } | { ok: false };
export function formatMinor(minor: number): string;               // 120000 → "1,200"
// src/api/cloud-admin.ts
export function createCloudAdmin(o: { fetch?: typeof fetch; storage?: Storage; onLoggedOut(): void }): CloudAdmin;
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

Every active §10 number of spec v0.6.1, each in exactly one task. Page parts (S40 N11) are listed separately and do not count as the number's task.

| Task | Tests |
|---|---|
| 5 | 104 |
| 9 | 66, 68 |
| 10 | 127 |
| 11 | 84 |
| 12 | 9, 10, 11, 12, 13, 14, 122 |
| 13 | 8 |
| 15 | 16, 17, 23, 80 |
| 16 | 18, 19, 83 |
| 17 | 4, 5, 85 |
| 18 | 1, 2, 3, 6, 114 |
| 19 | 20, 21, 22, 118 |
| 20 | 24, 25, 26, 27 |
| 21 | 28, 29, 30, 119 |
| 22 | 31, 32, 120 |
| 23 | 33, 34, 35, 36, 37, 40, 41, 88 |
| 24 | 7, 38, 81, 106, 107, 121 |
| 25 | 39, 82 |
| 26 | 117 |
| 27 | 86, 87 |
| 28 | 105, 108 |
| 29 | 123 |
| 30 | 49 |
| 32 | 42, 43, 44, 45, 53, 54, 95, 126 |
| 33 | 46, 94 |
| 34 | 58 |
| 35 | 50, 115 |
| 36 | 51, 52 |
| 37 | 67, 93 |
| 38 | 47, 48, 124 |
| 39 | 57 |
| 40 | 59, 60, 61, 62, 63, 64, 65 |
| 41 | 69, 70, 71 |
| 42 | 72, 103 |
| 43 | 56, 102 |
| 44 | 73, 89, 90, 91, 116 |
| 45 | 92 |
| 46 | 113, 125 |
| 47 | 79 |
| 48 | 15, 78 |
| 51 | 74 |
| 53 | 76 |
| 55 | 75 |
| 57 | 77 |

Page parts: `#75 page part` task 47; `#102 page part`, `#103 page part`, `#104 page part` task 57.

116 active numbers in 43 tasks. Task 59 re-checks this in the code with `grep`.

## Task list (→ spec v0.6.1 §11 step)

| # | Task | §11 | Markers |
|---|---|---|---|
| 1 | Spec 00 v1.2.1 editorial patch | 1 | Claude only |
| 2 | Foundation §6.2: append §9 codes | 2 | Claude only |
| 3 | Point `.cursor/rules/pos.mdc` at this plan and spec v0.6.1 | — | Claude only |
| 4 | Domain: error codes, `manage-stock` | 2 | needs Docker Postgres |
| 5 | Domain: `businessDayStartedAt` | 2 | |
| 6 | `@pos/domain/hash` (throws on `undefined`) | 3 | |
| 7 | Events: snapshot schema `config.ts` | 4 | |
| 8 | Events: four events, fixtures, builders | 4 | |
| 9 | `@pos/engine` stock slice | 5 | |
| 10 | Lint: browser-safe packages | 24 (moved early: guards tasks 5–9) | |
| 11 | Cloud migration `0002_restaurant_setup.sql` | 6 | needs Docker Postgres |
| 12 | Cloud `withIdempotency` | 7 | needs Docker Postgres |
| 13 | Cloud `bumpConfigVersion`, `writeConfigAudit` | 8 | needs Docker Postgres |
| 14 | Cloud test infrastructure | 9 | needs Docker Postgres |
| 15 | Cloud floors GET/POST | 9 | needs Docker Postgres |
| 16 | Cloud floor PATCH | 9 | needs Docker Postgres |
| 17 | Cloud snapshot builder | 13 | needs Docker Postgres |
| 18 | Cloud `GET /v1/sync/config` | 13 | needs Docker Postgres |
| 19 | Cloud tables | 9 | needs Docker Postgres |
| 20 | Cloud stations | 10 | needs Docker Postgres |
| 21 | Cloud batch programs | 10 | needs Docker Postgres |
| 22 | Cloud tax classes, categories | 11 | needs Docker Postgres |
| 23 | Cloud menu GET, menu-item POST | 12 | needs Docker Postgres |
| 24 | Cloud menu-item PATCH | 12 | needs Docker Postgres |
| 25 | Cloud route PUT | 12 | needs Docker Postgres |
| 26 | Cloud tenant-wide write guard | 8, 12 | needs Docker Postgres |
| 27 | Cloud lock-order races | 10, 12 | needs Docker Postgres |
| 28 | Cloud CLI `set-branch-settings` | 14 | needs Docker Postgres |
| 29 | Cloud CLI `restore-bump` | 14 | needs Docker Postgres |
| 30 | Hub migration 0004, projections | 15 | |
| 31 | Hub config holder and HTTP client | 16 | |
| 32 | Hub `pollOnce` core | 16 | |
| 33 | Hub poller: schema version, stored-body format, commit failure | 16 | |
| 34 | Hub `onBranchConfigApplied` | 16 | |
| 35 | Hub apply failure: visible problem, parts retried alone | 16 | |
| 36 | Hub directory through the poll | 17 | |
| 37 | Hub engine state through `createDeps`, reducer, stock fold, ctx typing | 19 | |
| 38 | Hub boot config load after catch-up, `BODY_MISSING`, poll timer | 17, 19 | |
| 39 | Hub station validator | 18 | |
| 40 | Hub `SetPrecookedStock` | 20 | |
| 41 | Hub `SetItemAvailability`, `itemAvailability` | 21 | |
| 42 | Hub stock query | 22 | |
| 43 | Hub config status | 22 | |
| 44 | Hub WS audiences and catch-up parts | 23 | |
| 45 | Hub `GET /queries/branch-config` | 23 | |
| 46 | `apps/client` scaffold, build, ULID helper | 24 | |
| 47 | `apps/client` lint rules | 24 | |
| 48 | `client-dist` (hub + cloud), `admin-page` group, `/owner/*` allowlist, CSP on both | 25 | needs Docker Postgres |
| 49 | `apps/hub/deploy/ship-client.sh` | 25 | |
| 50 | Shared components | 27 (pre) | |
| 51 | Owner money and `cloud-admin` client | 26 | |
| 52 | Owner shell: login, branch picker, app | 26 | |
| 53 | Owner floors view | 26 | |
| 54 | Owner stations view | 26 | |
| 55 | Owner menu view | 26 | |
| 56 | `/admin/stock`: `hub-admin` client and PIN login | 27 | |
| 57 | `/admin/stock`: stock table, status line, problem banner, save | 27 | |
| 58 | Manual runbook and release drill | 29 | needs Docker Postgres, needs hardware |
| 59 | README, spec status, runbook file, DoD close-out | §12.1 | Claude only |

---

### Task 1: Spec 00 v1.2.1 editorial patch — Claude only

**Files:** Rename `docs/specs/00_Hub_Platform_Access_Spec_v1.2.md` → `…_v1.2.1.md`; Modify it (line 8 Version row (S40 N6), line 472 `defineQuery` row, line 481 `registerReducer` row, as S25); Modify `docs/specs/README.md`; update links (`grep -rl "Access_Spec_v1.2.md" docs CLAUDE.md .cursor`).

- [ ] Apply the three edits from S25. No behaviour change (v0.6.1 needs no 00 behaviour change at all). `grep -rn "Access_Spec_v1.2.md" docs .cursor CLAUDE.md` → no hits outside `docs/reviews/`.
- [ ] Commit `feat(01a): task 1 spec 00 v1.2.1 editorial patch [spec S25, §2]`

### Task 2: Foundation §6.2 — append the §9 codes — Claude only

**Files:** Modify `docs/specs/00_Foundation_Spec_v1.7.md` (§6.2 list only: append the 12 codes of §9 with status, in §9 order, citing "01a §9").

- [ ] Append only (D64). Commit `feat(01a): task 2 foundation error codes from 01a [spec §9, F §6.2]`

### Task 3: Point the implementer rules at this plan — Claude only

**Files:** Modify `.cursor/rules/pos.mdc` (R12): current plan `docs/plans/01a-plan.md` implementing `docs/specs/01_Restaurant_Setup_Spec_v0.6.1.md` (or its reviewed successor, v1.0, after the gate); 00's plan named as finished; the stop marker reads "**Claude only**" instead of "NOT for Cursor"; Postgres must be running for every `pnpm test`.

- [ ] Commit `feat(01a): task 3 implementer rules for 01a [CLAUDE.md pipeline]`

> **Gate.** Do not start until the owner answers are applied (spec v0.7) and a re-review approves it (v1.0). Then re-baseline again (expected small).

### Task 4: Domain — error codes and `manage-stock` — needs Docker Postgres

**Files:** Modify `packages/domain/src/errors.ts`, `packages/domain/src/errors.test.ts`, `packages/domain/src/permissions.ts`, `packages/domain/src/permissions.test.ts`; Create `apps/cloud/test/default-roles.test.ts` (runs in the cloud project, whose global setup waits for Postgres, R19).

**Interfaces — Produces:** catalogue entries `BRANCH_NOT_FOUND 404, FLOOR_NOT_FOUND 404, TABLE_NOT_FOUND 404, PROGRAM_NOT_FOUND 404, TAX_CLASS_NOT_FOUND 404, CATEGORY_NOT_FOUND 404, MENU_ITEM_NOT_FOUND 404, CONFIG_NAME_TAKEN 409, CONFIG_IN_USE 409, CONFIG_REFERENCE_INVALID 422, IDEMPOTENCY_KEY_MISMATCH 422, STOCK_NOT_TRACKED 422`; `'manage-stock'` appended last in `PERMISSIONS` (20 entries).

- [ ] **Step 1: Tests:** `[01a §9] 01a codes have their statuses` (all 12). Rename the 00 test to `[00 §3.6, 01a S18] catalogue has 20 unique entries` and append `'manage-stock'`. `default-roles.test.ts`: `[01a S18] Owner and Manager grant manage-stock; Cashier and Order taker do not`.
- [ ] **Step 2:** `pnpm vitest run packages/domain apps/cloud/test/default-roles.test.ts` → FAIL (codes missing).
- [ ] **Step 3:** Add the codes and the permission. `default-roles.ts` needs no change (Owner = all, Manager = all but `manage-roles`).
- [ ] **Step 4:** Same → PASS; `pnpm test`. If a hub or cloud test lists the 19 permissions exactly and fails, stop and report its path (it is not in this task's Files).
- [ ] **Step 5:** Commit `feat(01a): task 4 error codes and manage-stock permission [spec §9, S18]`

### Task 5: Domain — `businessDayStartedAt`

**Files:** Create `packages/domain/src/business-day.ts`, `packages/domain/src/business-day.test.ts`; Modify `packages/domain/src/index.ts`.

Local midnight of `nowMs` (`new Date(nowMs)`, `setHours(0,0,0,0)`) + `businessDayStartMs`; if > `nowMs`, use the previous day (`setDate(d − 1)`). No `node:*` import (S35 k). Tests save `process.env.TZ`, set `'Asia/Karachi'` in `beforeAll`, restore it in `afterAll` (R35).

- [ ] **Step 1: Tests:** `[01a §10 #104]` (the `businessDayStartedAt` cases of §10; the badge is `#104 page part` in task 57, S40 N11); `[01a S33] exported from the @pos/domain root`.
- [ ] **Step 2–4:** `pnpm vitest run packages/domain` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 5 business day start in domain [spec S33, S41]`

### Task 6: `@pos/domain/hash`

**Files:** Create `packages/domain/src/hash.ts`, `packages/domain/src/hash.test.ts`; Modify `packages/domain/package.json` (`exports["./hash"] = "./src/hash.ts"`; `devDependencies: { "@types/node": "22.19.1" }`), `apps/hub/src/lib/hash.ts`, `pnpm-lock.yaml`.

- [ ] **Step 1: Tests:** `[01a S27] canonicalJson sorts keys at every depth and keeps array order`; `[01a S27] canonicalJson throws on undefined as a value, in an array and at the top level` (`{ a: undefined }`, `[undefined]`, `undefined`); `[01a S27] sha256hex('abc')` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; `[01a S27] @pos/domain root does not export canonicalJson` (`import * as root from './index'`).
- [ ] **Step 2:** `pnpm vitest run packages/domain` → FAIL (module missing).
- [ ] **Step 3:** `hash.ts` starts with `/// <reference types="node" />` (the base tsconfig has `types: []`, R20). Move the two bodies from `apps/hub/src/lib/hash.ts`; `canonicalJson` throws `new Error('canonicalJson: undefined')` where it would have written `null` for `undefined` (`null` stays `null`). The hub file becomes `export { canonicalJson, sha256hex } from '@pos/domain/hash';` plus its `payloadHash`. `pnpm install`.
- [ ] **Step 4:** `pnpm vitest run packages/domain apps/hub/src/lib/hash.test.ts apps/hub/test/commands` → PASS (no current caller, e.g. `payloadHash` in `commands/route.ts:145`, passes `undefined`; if one does, stop and report it); `pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 6 @pos/domain/hash subpath [spec S27]`

### Task 7: Events — snapshot schema (`config.ts`)

**Files:** Create `packages/events/src/config.ts`, `packages/events/src/config.test.ts`; Modify `packages/events/src/index.ts`.

**Interfaces — Produces:** Interfaces block. Fields and nullability exactly the §4.3 JSON: `snapshot_schema_version` (literal 1), `config_version` (int ≥ 1), `branch_id`, `currency_code`, `business_day_start_ms`, `tax_enabled` (boolean, required), `floors[{floor_id,name,sort_order,tables[{table_id,name,seats|null,sort_order}]}]`, `stations[{station_id,name,location_label|null,station_type,capacity,freshness_window_ms|null,completion_mode,is_archived,programs[{program_id,name,cook_time_ms,is_archived}]}]`, `tax_classes[{tax_class_id,name,rate_bp,is_archived}]`, `categories[{category_id,name,sort_order}]`, `items[{item_id,category_id,name,group_label|null,description|null,sort_order,price_minor,tax_class_id|null,serve_mode,prep_buffer_ms,cook_time_ms,stock_time_ms|null,out_of_stock_behaviour,station_id,program_id|null,stock_program_id|null}]`. No `config_epoch`. Numbers are `z.number().int()` (no coercion). `SyncConfigEnvelopeSchema.snapshot` is `z.record(z.string(), z.unknown())`; `directory` is the existing `DirectorySchema` or null.

- [ ] **Step 1: Tests:** `[01a §4.3] the §4.3 example parses`; `[01a S28 c] unknown fields are dropped, not rejected`; `[01a S27] price_minor "120000" fails`; `[01a S34] missing tax_enabled fails; tax_class_id null passes`; `[01a S22] programs and tax classes require is_archived`; `[01a §4.3] isStockTracked` (slot + `stock_time_ms` → true; slot + null → false; batch + `stock_program_id` → true; batch + null → false).
- [ ] **Step 2–4:** `pnpm vitest run packages/events` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 7 branch config snapshot schema v1 [spec §4.3, S22, S28]`

### Task 8: Events — four events, fixtures, builders

**Files:** Create `packages/events/src/events/hub/BranchConfigApplied.v1.ts`, `packages/events/src/events/stock/{StockSet,ItemMadeUnavailable,ItemMadeAvailable}.v1.ts`, `packages/events/fixtures/{BranchConfigApplied,StockSet,ItemMadeUnavailable,ItemMadeAvailable}.{v1,latest}.json`; Modify `packages/events/src/index.ts`, `packages/events/src/fixtures.test.ts` (14 → 18), `packages/events/testing/index.ts`, `packages/events/testing/builders.test.ts`.

**Interfaces — Produces:** payloads §4.2: `BranchConfigApplied { config_version: int ≥ 1, snapshot_schema_version: int ≥ 1, snapshot_hash: /^[0-9a-f]{64}$/, previous_config_version: int|null }`; `StockSet { item_id, on_hand: int 0…9999 }`; `ItemMadeUnavailable { item_id }`; `ItemMadeAvailable { item_id }`. `aBranchConfig()` returns a valid snapshot with a slot station "Karahi", a stock-tracked item `I1` and a non-tracked item `I2`.

- [ ] **Step 1: Tests:** fixtures test expects 18 files; `[01a §4.2] StockSet rejects on_hand 10000 and -1`; `[01a §4.2] BranchConfigApplied has no epoch fields` (an extra `config_epoch` is dropped); each new builder parses with its schema.
- [ ] **Step 2–5:** `pnpm vitest run packages/events` → FAIL → implement → PASS → commit `feat(01a): task 8 config and stock events [spec §4.2]`

### Task 9: `@pos/engine` — stock slice

**Files:** Create `packages/engine/{package.json,tsconfig.json,vitest.config.ts}`, `packages/engine/src/{state,stock,apply-event,version,index}.ts`, `packages/engine/src/engine.test.ts`, `packages/engine/fixtures/{stock-log.v1.json,engine-state.v1.json}`; Modify `pnpm-lock.yaml`.

`package.json`: `"name": "@pos/engine"`, `"exports": { ".": "./src/index.ts" }`, `dependencies: { "@pos/events": "workspace:*" }`, script `typecheck`. Copy `tsconfig.json` / `vitest.config.ts` from `packages/events`. No `node:*` import (S35 k).

- [ ] **Step 1: Tests:** `[01a §10 #66]` exactly as §10.4 (including `{ on_hand 5, reserved 5 }` + `StockSet 3` → `{ 3, 5 }`, available 0, never below 0); `[01a §10 #68]` `buildEngineState(stock-log.v1.json)` deep-equals `engine-state.v1.json` (log: 4 `StockSet` on 2 items + one `HubStarted`); `[01a S41] availableStock: set_at before businessDayStartMs → 0 with on_hand 4; set_at at or after → max(0, on_hand − reserved); set_at null → 0`; `[01a S14] stockOf on a missing item → { 0, 0, null }`; `[01a S15] applyEvent returns the same reference for a non-stock event`.
- [ ] **Step 2:** `pnpm install && pnpm vitest run packages/engine` → FAIL.
- [ ] **Step 3:** `applyEvent` copies only the touched entry; `set_at = event.recorded_at`, never a clock; `reserved` unchanged by `StockSet`.
- [ ] **Step 4–5:** PASS; `pnpm typecheck && pnpm test` → commit `feat(01a): task 9 engine package with stock slice [spec S14, S15, S41]`

### Task 10: Lint — browser-safe packages

**Files:** Modify `eslint.config.js`; Create `packages/engine/test/lint.test.ts` (or `packages/engine/src/lint.test.ts` if the engine project has no `test/` include; check `vitest.config.ts`).

Add one block after the root block (S35 k): `files: ['packages/engine/**/*.ts', 'packages/domain/src/**/*.ts']`, `ignores: ['packages/domain/src/hash.ts', '**/*.test.ts']`, `'no-restricted-imports': ['error', { patterns: [...dbClientImports.patterns, ...qrcodeImports.patterns, ...credentialLookupImports.patterns, ...systemContextImports.patterns, { group: ['node:*'], message: 'S35 k: packages/engine and the @pos/domain root must stay browser-safe' }] }]` (a flat-config block replaces, not merges, the rule's options, so the root patterns are repeated).

- [ ] **Step 1: Test** (`// @vitest-environment node`, `new ESLint().lintText(code, { filePath })`): `[01a §10 #127]` exactly as §10.5e (fails in `packages/engine/src/x.ts` and `packages/domain/src/x.ts`; passes in `packages/domain/src/hash.ts` and `packages/domain/src/x.test.ts`; `@pos/domain` import passes in the engine; `pnpm lint` on the tree, run as `new ESLint().lintFiles(['packages/engine', 'packages/domain'])` with 0 errors).
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm lint` → commit `feat(01a): task 10 browser-safe lint for engine and domain [spec S35 k]`

### Task 11: Cloud migration `0002_restaurant_setup.sql` — needs Docker Postgres

**Files:** Create `apps/cloud/src/db/migrations/0002_restaurant_setup.sql` (verbatim §5.2: no `config_epoch`), `apps/cloud/test/db/restaurant-schema.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #84]` `UPDATE` and `DELETE` on a `config_audit` row raise `config_audit is insert-only`; its primary key and every index on the new tables lead with `tenant_id` (`pg_index`). (#84's cross-tenant clause is covered by task 14's `config_audit` row in the cross-tenant test, R26.) `[01a §5.2] tax_class_id NULL accepted; stock_time_ms > cook_time_ms rejected`; `[01a §5.2] a slot station with freshness 0 is rejected`; `[01a §5.2] branches has no config_epoch column; business_day_start_ms defaults to 18000000 and tax_enabled to false`.
- [ ] **Step 2–4:** `pnpm vitest run apps/cloud/test/db/restaurant-schema.int.test.ts` → FAIL → add the file → PASS; `pnpm test` (if `schema.int.test.ts` asserts an exact table list and fails, stop and report).
- [ ] **Step 5:** Commit `feat(01a): task 11 cloud restaurant setup migration [spec §5.2, S26, S32–S34]`

### Task 12: Cloud `withIdempotency` — needs Docker Postgres

**Files:** Create `apps/cloud/src/lib/idempotency.ts`, `apps/cloud/test/lib/idempotency.int.test.ts`.

Behaviour S7. The key is checked **inside** `withIdempotency` by hand (not a Fastify header schema): missing or not a ULID → `throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'headers.idempotency-key', message }] })` (R39). `request_hash = sha256hex(canonicalJson({ method, path, body }))`, `path` filled (S7). In one transaction: `INSERT … ON CONFLICT DO NOTHING RETURNING`; no row → read the stored row: same hash → its status/body with `replay: true` (roll back); different hash → `422 IDEMPOTENCY_KEY_MISMATCH { idempotency_key }`. On success `UPDATE` `response_status`, `response_body` before COMMIT. Any throw rolls everything back. **After COMMIT**, in its own statement on the pool: `await testHooks?.beforePrune?.()`, then `DELETE FROM idempotency_keys WHERE ctid IN (SELECT ctid FROM idempotency_keys WHERE tenant_id = $1 AND created_at < $2 LIMIT 100 FOR UPDATE SKIP LOCKED)`; a prune error is logged at `error` and the result is returned unchanged. Queries go through `TenantLevelRepository`.

- [ ] **Step 1: Tests.** In the test file register `POST /v1/test/floors/:branch_id` (`tenantScope: 'jwt'`) that inserts a `floors` row through `withIdempotency` and throws `CONFIG_NAME_TAKEN` on name `"dup"`. Seed with `seedTenant` + `issueRegistrationCode`; sign the JWT with `cloud.app.jwt.sign`. `[01a §10 #9]`, `#10`, `#11`, `#12` (`Promise.all` of two injects: one `floors` row, one reply with `idempotent-replay: true`), `#13`, `#14` (old rows for tenants A and B inserted directly; a call as A removes A's only, after the response), `#122` (same key and body on branch A then branch B → `422`; two concurrent creates with old rows present both commit; `beforePrune` throws → `201`, error logged).
- [ ] **Step 2–5:** `pnpm vitest run apps/cloud/test/lib/idempotency.int.test.ts` → FAIL → implement → PASS → commit `feat(01a): task 12 cloud idempotency keys [spec S7, M69]`

### Task 13: Cloud `bumpConfigVersion` and `writeConfigAudit` — needs Docker Postgres

**Files:** Create `apps/cloud/src/lib/config-version.ts`, `apps/cloud/src/lib/config-audit.ts`, `apps/cloud/test/lib/config-version.int.test.ts`.

Both take a `TenantSql` (Interfaces; R2, R3): routes pass `new TenantLevelRepository(request.tenant, client)`; CLIs build one from `SystemContext` (task 28). Neither file imports `SystemContext` or the db client (lint). SQL: branch scope `UPDATE branches SET config_version = config_version + 1 WHERE tenant_id = $1 AND branch_id = $2 RETURNING branch_id, config_version`; tenant scope `SELECT branch_id FROM branches WHERE tenant_id = $1 ORDER BY branch_id FOR UPDATE`, then `UPDATE branches SET config_version = config_version + 1 WHERE tenant_id = $1 RETURNING …` (every branch, S40 N3). In this task the tenant scope has no `allowedBranchIds` yet (task 26 adds the S8 coverage check). `writeConfigAudit` inserts one row (`audit_id = ids.next()`, `at = clock.branchNow()`); `before`/`after` passed as JSON.

- [ ] **Step 1: Tests:** `[01a §10 #8]` 10 concurrent `inTransaction(… bumpConfigVersion(branch A))` → +10 exactly; `[01a S8] tenant scope bumps all 3 branches`; `[01a S26] writeConfigAudit stores actor, entity, before/after; cli actor stores null user`; `[01a S26] auditActionFor`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 13 config version bump and audit writer [spec S8, S26]`

### Task 14: Cloud test infrastructure — needs Docker Postgres

**Files:** Create `apps/cloud/test/helpers/restaurant.ts`, `apps/cloud/test/helpers/pg-counter.ts`, `apps/cloud/test/helpers/pg-counter.int.test.ts`; Modify `apps/cloud/test/helpers/test-cloud.ts` (option `testHooks` passed into `buildCloudServer`, R6), `apps/cloud/src/server.ts` (`CloudDeps.testHooks?: CloudTestHooks`), `apps/cloud/test/cross-tenant.int.test.ts`.

**Interfaces — Produces:**
```ts
export interface RestaurantFixture { tenantId: string; userId: string; branches: [string, string, string]; token: string; tokenFor(branchIds: string[]): string; branchKey: string /* branch A */; other: { tenantId: string; userId: string; branchId: string; token: string } }
export async function restaurantFixture(cloud: TestCloud): Promise<RestaurantFixture>; // truncateAll; seedTenant ×2; issueRegistrationCode ×3 (+1 for B); /v1/hubs/register for branch A; JWTs via cloud.app.jwt.sign({ sub: userId, tenant_id, allowed_branch_ids })
export function owner(f: RestaurantFixture, token?: string): { headers: Record<string, string> };   // authorization + fresh idempotency-key
export function pgCounter(pool: pg.Pool): { readonly count: number; reset(): void }; // wraps pool.query and clients from pool.connect; ignores BEGIN*/COMMIT/ROLLBACK/SET TRANSACTION
```
`cross-tenant.int.test.ts`: replace the exact route list with `ROUTE_CASES: Record<string, (ids) => { url: string; payload?: unknown }>` keyed `"METHOD /url"`, holding today's two routes; assert its keys equal the jwt/branch-key routes; add a tenant B `config_audit` row (inserted directly) and its `audit_id` to `bIds` (R26).

- [ ] **Step 1: Tests:** `[01a §10 test infra] pgCounter counts statements on pool.query and on connected clients, not BEGIN/COMMIT`; the refactored cross-tenant test passes with the two 00 routes.
- [ ] **Step 2–5:** `pnpm vitest run apps/cloud/test/helpers apps/cloud/test/cross-tenant.int.test.ts` → FAIL → implement → PASS → commit `feat(01a): task 14 cloud test fixtures and route cases [spec §10, D54]`

### Task 15: Cloud floors GET/POST — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/restaurant/{routes,service,repository,schemas}.ts`, `apps/cloud/test/restaurant/floors.int.test.ts`; Modify `apps/cloud/src/server.ts` (`registerRestaurantRoutes(app, deps)`), `apps/cloud/test/cross-tenant.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #16]`, `#17`, `#23`, `#80`; Review Focus 1: `[01a §3.3] " ground " is stored as "ground" and duplicates "Ground"`; `[01a S8] create floor bumps only that branch`.
- [ ] **Step 2–5:** `pnpm vitest run apps/cloud/test/restaurant apps/cloud/test/cross-tenant.int.test.ts` → FAIL → implement → PASS → commit `feat(01a): task 15 floors list and create [spec §6.2, §6.3, §6.0, S26]`

### Task 16: Cloud floor PATCH — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`, `apps/cloud/test/restaurant/floors.int.test.ts`.

The service calls `await deps.testHooks?.beforeBump?.()` right before `bumpConfigVersion`. PATCH rules run on the merged row (§3.3).

- [ ] **Step 1: Tests:** `[01a §10 #18]`, `#19`, `#83`; `[01a §6.4] restore checks name uniqueness`; `[01a §6.4] rename → 200, audited update, branch bumped`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 16 floor patch [spec §6.4, S22, S26]`

### Task 17: Cloud snapshot builder — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/config-sync/builder.ts`, `apps/cloud/test/config-sync/builder.int.test.ts`; Modify `apps/cloud/test/helpers/restaurant.ts` (`seedMenu(pool, f, o)`: inserts floors, tables, stations, programs, tax classes, categories, items and routes by SQL, archived rows on request; returns their ids).

6 fixed statements (floors ⋈ tables; stations ⋈ programs; tax classes; categories; items ⋈ routes for this branch; the header is passed in). Active rows only, except stations, programs and tax classes (all, with `is_archived`, S22). Arrays ordered by `sort_order`, then id; tax classes and programs by name, then id (§4.3). The repository converts `BIGINT` columns with `Number()`; then `BranchConfigSnapshotSchemaV1.parse` (no coercion, so a missed conversion fails, S27); then `JSON.parse(JSON.stringify(parsed))` (the wire object, S27).

- [ ] **Step 1: Tests:** `[01a §10 #4]` (archived station, program and tax class present with `is_archived: true`; archived item absent), `#5` (`pgCounter`: ≤ 12 and equal for 10 and 300 items), `#85` (hub-style `sha256hex(canonicalJson(V1.parse(JSON.parse(JSON.stringify(snapshot)))))` equals the cloud hash; a copy with `price_minor: "120000"` fails `parse`).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 17 snapshot builder [spec §6.1, §4.3, S22, S27]`

### Task 18: Cloud `GET /v1/sync/config` — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/config-sync/{routes,service,schemas}.ts`, `apps/cloud/test/config-sync/sync-config.int.test.ts`; Modify `apps/cloud/src/server.ts` (register), `apps/cloud/test/cross-tenant.int.test.ts`.

Script §6.1. The handler's first line is `deps.testHooks?.handlerStart?.('GET /v1/sync/config')` (the tenant guard's key lookup runs before it and is not counted, R9, nit 1). Query: `config_version` / `directory_version` int ≥ 0 (`z.coerce`); no other parameter. Everything after the guard runs inside `inTransaction(pool, fn, { isolation: 'REPEATABLE READ', readOnly: true })`, **including statement (1)** (nit 4). `304` via `reply.code(304).send()`. Hash: `snapshot_hash = sha256hex(canonicalJson(wire))`, and the response sends `wire` (S27). The route's response schema types `config.snapshot` as `z.record(z.string(), z.unknown())`. Directory only when `directory_version` differs.

- [ ] **Step 1: Tests:** `[01a §10 #1]` (reset `pgCounter` in `handlerStart`; count = 1), `#2`, `#3`, `#6`, `#114` (seed an extra optional field through a test-only builder wrapper that leaves it `undefined` on one item and sets it on another; the hub-style check over the response **text**: `JSON.parse` → `sha256hex(canonicalJson(raw)) === snapshot_hash`, and `BranchConfigSnapshotSchemaV1.parse(raw)` succeeds; `canonicalJson({ a: undefined })` and `canonicalJson([undefined])` throw; the existing hub hash and command tests are run by `pnpm test`).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 18 config sync endpoint [spec §6.1, S4, S27, S28]`

### Task 19: Cloud tables — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/tables.int.test.ts`.

§6.5, §6.6. PATCH rules on the merged row (§3.3). "In the snapshot" = `GET /v1/sync/config` with branch A's key.

- [ ] **Step 1: Tests:** `[01a §10 #20]` (table with `seats: null`), `#21`, `#22`, `#118`; `[01a §6.6] moving a table to another branch's floor → 422 wrong_branch`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 19 tables [spec §6.5, §6.6, S22, S26]`

### Task 20: Cloud stations — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/stations.int.test.ts`.

§6.8, §6.9. In-use checks use `item_routes_station`; tests seed routes with `seedMenu`. Batch → slot archives the station's programs, one `batch_program` / `archive` audit row each.

- [ ] **Step 1: Tests:** `[01a §10 #24]`, `#25`, `#26`, `#27`; `[01a S10] "Fryer" twice in one branch → 409; in another branch → 201`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 20 stations [spec §6.8, §6.9, S10, S22]`

### Task 21: Cloud batch programs — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/programs.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #28]`, `#29`, `#30`, `#119`; `[01a §6.10] archiving a program used as program_id → 409`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 21 batch programs [spec §6.10]`

### Task 22: Cloud tax classes and categories — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/tax-categories.int.test.ts`.

Tenant-level (`TenantLevelRepository`), bump every branch, `branch_id` null in audit.

- [ ] **Step 1: Tests:** `[01a §10 #31]`, `#32`, `#120`; `[01a S8] a category create bumps all three branches`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 22 tax classes and categories [spec §6.12, §6.13]`

### Task 23: Cloud menu GET and menu-item POST — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/menu-items.int.test.ts`.

§6.11, §6.14. Body schema: `tax_class_id: z.string().nullable()` as a **required** key (nit 3). Tax class (when not null), stations and programs locked `FOR SHARE` in id order with `= ANY($ids)`; item and routes in one multi-row `INSERT` each; reasons per §9. A route branch outside `allowed_branch_ids` → `404 BRANCH_NOT_FOUND`, nothing written. At a batch station the item's `cook_time_ms` / `stock_time_ms` are still validated as §3.3 says and not used (nit 9: no validation change).

- [ ] **Step 1: Tests:** `[01a §10 #33]`, `#34`, `#35`, `#36`, `#37` (`pgCounter` reset in `handlerStart`: equal for 1 and 3 routes), `#40`, `#41`, `#88`; `[01a §6.14] a body without the tax_class_id key → 400`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 23 menu read and item create [spec §6.11, §6.14, S11, S34]`

### Task 24: Cloud menu-item PATCH — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/menu-patch.int.test.ts`.

§6.15. Rules on the merged row (§3.3): stored row + PATCH fields, checked after the row lock, so a lowered `cook_time_ms` below the stored `stock_time_ms` is `422`, never a CHECK `500`.

- [ ] **Step 1: Tests:** `[01a §10 #7]` (table rename at A bumps A only; item price PATCH bumps A, B, C), `#38`, `#81`, `#106`, `#107`, `#121` ("in the snapshot" = poll `GET /v1/sync/config` with branch A's key).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 24 item patch [spec §6.15, §3.3, S26, S32, S34]`

### Task 25: Cloud route PUT — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/*`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/restaurant/routes-put.int.test.ts`.

§6.16. PUT takes no `Idempotency-Key`; `{ station_id: null }` deletes the route (`route_removed`, `after` null).

- [ ] **Step 1: Tests:** `[01a §10 #39]`, `#82`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 25 item route put [spec §6.16, S26]`

### Task 26: Cloud tenant-wide write guard — needs Docker Postgres

**Files:** Modify `apps/cloud/src/lib/config-version.ts` (tenant scope takes `allowedBranchIds`; after the locking `SELECT`, any branch not in it → `throw new DomainError('PERMISSION_DENIED', { reason: 'tenant_wide_write' })`), `apps/cloud/src/modules/restaurant/service.ts` (tenant-level writes pass `request.tenant.branchIds`), `apps/cloud/test/lib/config-version.int.test.ts`; Create `apps/cloud/test/restaurant/tenant-wide.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #117]` (with `f.tokenFor([A])`); `[01a S8] bumpConfigVersion tenant scope with allowedBranchIds missing C throws PERMISSION_DENIED and updates nothing`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm vitest run apps/cloud/test/restaurant` green → commit `feat(01a): task 26 tenant-wide writes need every branch [spec S8, D30]`

### Task 27: Cloud lock-order races — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/restaurant/service.ts` (`await deps.testHooks?.afterTargetLock?.(route)` after the target `FOR UPDATE`; `afterReferenceLock?.(route)` after the reference `FOR SHARE`); Create `apps/cloud/test/restaurant/races.int.test.ts`.

Barrier: request 1's hook awaits a promise the test resolves once request 2 is blocked (poll `pg_stat_activity.wait_event_type = 'Lock'` for up to 2 000 ms).

- [ ] **Step 1: Tests:** `[01a §10 #86]` both orders; `[01a §10 #87]` both orders plus two concurrent item creates committing. Outcome pairs as §10; never an active route on an archived station/program; no `40P01`.
- [ ] **Step 2–5:** run → FAIL (or hang → fix lock order per S8) → PASS → commit `feat(01a): task 27 config write lock order [spec S8, §5.2]`

### Task 28: Cloud CLI `set-branch-settings` — needs Docker Postgres

**Files:** Create `apps/cloud/src/cli/set-branch-settings.ts`, `apps/cloud/test/cli/set-branch-settings.int.test.ts`; Modify `apps/cloud/package.json` (script `set-branch-settings`: `tsx src/cli/set-branch-settings.ts`).

**Interfaces — Produces:** `setBranchSettings` (Interfaces block). Inside `sys.tx(async (t) => …)`: `SELECT tenant_id, tax_enabled FROM branches WHERE branch_id = $1 FOR UPDATE` gives the tenant (unknown branch → error); then `const db: TenantSql = { query: (sql, params = []) => t.query(sql, [tenantId, ...params]) }` passed to `writeConfigAudit` (`branch_settings` / `update`, `actor_kind 'cli'`) and `bumpConfigVersion` (branch scope) (R3). The entry block parses `--branch` and `--tax-enabled true|false` only (§6.7); any other option, including `--business-day-start`, → usage error, exit 1, nothing written.

- [ ] **Step 1: Tests:** `[01a §10 #105]`, `#108`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 28 set-branch-settings CLI [spec §6.7, S34, M56]`

### Task 29: Cloud CLI `restore-bump` — needs Docker Postgres

**Files:** Create `apps/cloud/src/cli/restore-bump.ts`, `apps/cloud/test/cli/restore-bump.int.test.ts`; Modify `apps/cloud/package.json` (script `restore-bump`: `tsx src/cli/restore-bump.ts`).

§6.7a, S42. Inside `sys.tx`: `SELECT directory_version FROM tenants WHERE tenant_id = $1 FOR UPDATE` (none → error "unknown tenant"; the entry exits 1); `UPDATE branches SET config_version = GREATEST(config_version + 1, $2) WHERE tenant_id = $1 RETURNING branch_id, config_version` (with the old values read first); `UPDATE tenants SET directory_version = GREATEST(directory_version + 1, $2) WHERE tenant_id = $1 RETURNING directory_version`. `$2 = deps.clock.branchNow()`. No `config_audit` row. The entry prints each old and new value.

- [ ] **Step 1: Tests:** `[01a §10 #123]`: cloud at `config_version 50` / `directory_version 35`; set them to 40 / 30 by SQL (the restored dump); `GET /v1/sync/config?config_version=50&directory_version=35` → the config and directory it returns carry versions below the hub's (forward-only would ignore them); run `restoreBump` with `fixedClock(T)` → every branch's `config_version` and the tenant's `directory_version` ≥ `T` and > the old values, no `config_audit` row; the same GET now returns versions > 50 / > 35, which the hub's forward-only rule applies (task 32 covers the rule); a second `restoreBump` with `fixedClock(T + 1000)` raises them again; unknown tenant → throws, nothing written; ESLint `lintText` shows `apps/cloud/src/modules/x.ts` importing `../cli/system-context` fails (M56).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 29 restore-bump CLI [spec S42, §6.7a, M56]`

### Task 30: Hub migration 0004 and projections

**Files:** Create `apps/hub/src/db/migrations/0004_restaurant_config.sql` (verbatim §5.1: no epoch columns), `apps/hub/src/sync/branch-config-holder.ts` (the `ConfigEntry` type only), `apps/hub/src/projections/branch-config.ts`, `apps/hub/src/projections/item-availability.ts`, `apps/hub/test/projections/restaurant-projections.int.test.ts`; Modify `apps/hub/src/lib/boot.ts` (`registerRestaurantProjections(projections)` in `createDeps`), `apps/hub/test/helpers/test-hub.ts` (same), `apps/hub/test/helpers/big-fixture.ts` (also insert checkpoints `branch_config` and `item_availability` at `n`, R4), `apps/hub/test/boot/boot-budget.int.test.ts` (its decoy step also advances those two checkpoints to `N + 1`).

`branch_config` projection: upsert from the payload; `applied_at = event.recorded_at` (nit 2). `item_availability`: `ItemMadeUnavailable` → `(item_id, 0, recorded_at, actor_id)`, `ItemMadeAvailable` → `1`. Both have `reset` (`DELETE`). `loadBranchConfig`: row by primary key, then body by `snapshot_hash`; a row whose `snapshot_schema_version` ≠ `SNAPSHOT_SCHEMA_VERSION` is `BODY_MISSING` (S28 b); `parseStoredSnapshot` is `JSON.parse` + `BranchConfigSnapshotSchemaV1`. `ConfigEntry` lives in `sync/branch-config-holder.ts`; this task creates that file with the interface only, and task 31 adds the functions. The first boot after 0004 replays the full log once (S40 N12).

- [ ] **Step 1: Tests:** `[01a §10 #49]`; `[01a §5.1] BranchConfigApplied upserts branch_config with applied_at = recorded_at; ItemMade* set changed_at = recorded_at`; `[01a S5] loadBranchConfig returns NONE, BODY_MISSING and APPLIED`; `[01a §4.2] itemAvailability(db, [])` → empty map, 0 statements.
- [ ] **Step 2–5:** `pnpm vitest run apps/hub/test/projections apps/hub/test/boot/boot-budget.int.test.ts` → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 30 hub config and availability projections [spec §5.1, S5, S17]`

### Task 31: Hub config holder and HTTP client

**Files:** Modify `apps/hub/src/sync/branch-config-holder.ts`; Create `apps/hub/src/sync/branch-config-holder.test.ts`, `apps/hub/src/sync/config-client.ts`, `apps/hub/src/sync/config-client.test.ts`, `apps/hub/test/helpers/stub-config-cloud.ts`.

`httpConfigClient` (pattern: `setup/cloud-client.ts`): `GET {root}/v1/sync/config?config_version=…&directory_version=…` with `authorization: Bearer <key>`, `AbortSignal.timeout(timeoutMs)`; `304` → `not_modified`; `200` → `ok` with `await response.text()` (never `json()`: the hash is checked over the raw text); fetch error, timeout or `5xx` → `offline`; `4xx` → `error` with the envelope's code/details. `stub-config-cloud.ts`: `stubConfigCloud(): ConfigClient & { calls: ConfigQuery[]; next: ConfigFetch[]; respondWithSnapshot(snapshot: object, o?: { directory?: DirectoryInput; hash?: string }): void }` (hashes with `@pos/domain/hash` unless `hash` is given).

- [ ] **Step 1: Tests** (`config-client.test.ts`, replacing `globalThis.fetch` in `beforeEach` and restoring it in `afterEach`): `[01a §3.4] 304 → not_modified; 200 → ok with the exact body text; 503 and a thrown fetch → offline; 401 → error with code`; `[01a §3.4] the query string carries exactly config_version and directory_version`; `branch-config-holder.test.ts`: `[01a §4.2] swapBranchConfig then branchConfig returns it; null resets`.
- [ ] **Step 2–5:** `pnpm vitest run apps/hub/src/sync` → FAIL → implement → PASS → commit `feat(01a): task 31 hub config holder and cloud client [spec §3.4, §4.2]`

### Task 32: Hub `pollOnce` core

**Files:** Create `apps/hub/src/sync/config-poller.ts`, `apps/hub/test/sync/poller.int.test.ts`; Modify `apps/hub/src/server.ts` (`HubDeps.configClient?`; `buildHubServer` creates the poller with `setDirectory: (d) => swapDirectory(app, d)` and `log: app.log`, stores it for `configPoller(app)`), `apps/hub/test/helpers/test-hub.ts` (option `configClient`, default a stub returning `offline`; `swapBranchConfig(null)` on create).

§3.4 steps 1–6, happy and reject paths. Step 1 skip (not provisioned or not confirmed): no HTTP call; record and return `{ outcome: 'not_ready', … }` (S40 N4). Concurrent calls share one in-flight promise. Step 4: envelope parse failure → `rejected` / `malformed`, logged with issue paths and codes only (nit 10); (i) hash over `canonicalJson(raw)` → `hash_mismatch`; (iv) forward only. Apply in one `writer.run`: `INSERT OR IGNORE INTO config_snapshots` (`body = canonicalJson(raw)`, `received_at = clock`), append `BranchConfigApplied` (`stream_type 'hub'`, `stream_id` branch id, `actor_id` null, `device_id 'hub'`, `previous_config_version` from the row), `tx.onCommit(() => swapBranchConfig(entry))`; directory part `applyStaffDirectory(tx, directory, setDirectory)` in the same `writer.run`. Log levels §7.3. **Tests create the hub confirmed:** `createTestHub({ config: { provisioned: { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'test-branch-api-key', confirmed_at: 1 } } })` (R13).

- [ ] **Step 1: Tests:** `[01a §10 #42]`, `#43`, `#44`, `#45`, `#53`, `#54`, `#95`, `#126` (`captureLogs`; the logs never contain a `pin_hash` value or `$argon2id$`); `[01a §3.4, S40 N4] an unconfirmed hub makes no HTTP call and records not_ready`; `[01a S42] a snapshot and directory with versions far above the hub's (as after restore-bump) are applied`; `[01a §7.3] outcome log levels (unchanged debug, applied info, rejected error) and h.logs() never contains the snapshot body` (R28).
- [ ] **Step 2–5:** `pnpm vitest run apps/hub/test/sync` → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 32 hub config poll and apply [spec §3.4, S5, S6, S28 d, §7.3]`

### Task 33: Hub poller — schema version, stored-body format, commit failure

**Files:** Modify `apps/hub/src/sync/config-poller.ts`; Create `apps/hub/test/sync/poller-schema.int.test.ts`.

Adds §3.4 step 2's version-0 rule (no row, body missing, or row `snapshot_schema_version` ≠ `SNAPSHOT_SCHEMA_VERSION`, S28 b), step 4 (ii) `schema_unsupported` (raw `snapshot_schema_version` ≠ `SNAPSHOT_SCHEMA_VERSION`: nothing appended, old config kept), (iii) `schema_invalid`, and `last_problem` clearing (step 6).

- [ ] **Step 1: Tests:** `[01a §10 #46]` (`testHooks.beforeCommit` throws → `branchConfig()` unchanged, no `config_snapshots` row), `#94`; `[01a S28 b] a snapshot with snapshot_schema_version 2 (correct hash) → rejected schema_unsupported, no event, old config kept, polled again next tick`; `[01a S28 b] a branch_config row with snapshot_schema_version 2 → the poll sends config_version=0 and applies the version-1 snapshot once; the next poll sends its real version`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 33 snapshot schema version rules [spec S28, S29]`

### Task 34: Hub `onBranchConfigApplied`

**Files:** Modify `apps/hub/src/sync/branch-config-holder.ts` (`onBranchConfigApplied`, `runBranchConfigHooks`), `apps/hub/src/sync/config-poller.ts` (call `runBranchConfigHooks(prev, next, tx)` after the append); Create `apps/hub/test/sync/config-hook.int.test.ts`.

- [ ] **Step 1: Test:** `[01a §10 #58]` (the hook appends a `ClockAlarm`-shaped event through `tx.append`; it commits with `BranchConfigApplied`; a throwing hook rolls both back).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 34 branch config applied hook [spec §4.2, S40 N2]`

### Task 35: Hub apply failure — visible problem, parts retried alone

**Files:** Modify `apps/hub/src/sync/config-poller.ts` (S43; `applyDirectory` dep, default `applyStaffDirectory`); Create `apps/hub/test/sync/poller-apply-failure.int.test.ts`.

§3.4 step 5, S43: wrap the combined `writer.run` in `try`; on a throw record `last_problem { outcome: 'rejected', reason: 'apply_failed', at }` and log at `error` with the error message (never body or directory); then, if a directory part exists, `writer.run` it alone (`try`/`catch`), then the config part alone (`try`/`catch`). A part that fails again stays unapplied; the next poll retries. `last_problem` clears only when a later poll applies the config part or is `unchanged`.

- [ ] **Step 1: Tests:** `[01a §10 #50]` (config part fails through a throwing `onBranchConfigApplied` hook → directory applied alone, config not; directory part fails through a throwing `applyDirectory` → config applied alone, directory not; both succeed → one transaction), `#115`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 35 visible apply failure and per-part retry [spec S43, §3.4]`

### Task 36: Hub directory through the poll

**Files:** Create `apps/hub/test/sync/poller-directory.int.test.ts`; Modify `apps/hub/src/sync/config-poller.ts` only if a test fails.

- [ ] **Step 1: Tests:** `[01a §10 #51]`, `#52`.
- [ ] **Step 2–5:** run. If they pass on the first run (the code came in task 32), show the output and say so; otherwise implement → PASS → commit `feat(01a): task 36 staff directory through the config poll [spec S6, R14, M38]`

### Task 37: Hub engine state through `createDeps`, reducer, stock fold, ctx typing

**Files:** Create `apps/hub/src/sync/boot-steps.ts`, `apps/hub/test/boot/stock-fold.int.test.ts`; Modify `apps/hub/package.json` (`"@pos/engine": "workspace:*"`, nit 8), `pnpm-lock.yaml`, `apps/hub/src/lib/boot.ts`, `apps/hub/src/main.ts` (call `registerRestaurantBootSteps()` before `boot`), `apps/hub/src/setup/issue-admin-bootstrap.ts:44–45`, `apps/hub/test/helpers/test-hub.ts`, `apps/hub/src/server.ts` (`HubDeps.state: StateHolder<EngineState>`), `apps/hub/src/commands/registry.ts` (`CommandCtx.state: Readonly<EngineState>`), `apps/hub/src/commands/route.ts:102` (`state: tx.state as Readonly<EngineState>`, R8), `apps/hub/src/queries/registry.ts` (`QueryCtx.state`, `QueryCtx.branchConfig = branchConfig()`; `QueryRouteDeps.state`). Read, do not change: `apps/hub/src/engine-host/writer.ts` (`WriterTx.state` stays `Readonly<unknown>`; the cast is in `route.ts`).

S15 and §2 (S-9): `BootContext` gains `initialState?: unknown` (`boot.ts:36–40`). `createDeps` gains a last parameter `initialState?: unknown` and builds `createStateHolder(initialState ?? {})` with `setReducer(applyEvent)` in place of `boot.ts:278–279`; the provisioned path passes `ctx.initialState`, the setup path passes nothing (`{}` as today; `applyEvent` returns the same state for every non-stock event). `registerRestaurantBootSteps()` (idempotent, module flag) registers through 00's `registerBootStep`: step `'3'` → `ctx.initialState = foldStockEvents(ctx.db, branchId)`. `foldStockEvents` selects `WHERE branch_id = ? AND stream_type = 'stock' AND event_type = 'StockSet' ORDER BY seq`, starting from `initialEngineState()` (uses `events_stream`, R34). Registering from `main.ts`, not at module load, avoids an import cycle with `boot.ts`.

- [ ] **Step 1: Tests** (each test calls `registerRestaurantBootSteps()` before `boot`): `[01a §10 #67]`, `[01a §10 #93]` (boot clock 1 h later on restart; `set_at` unchanged); `[01a §2] with no step-3 handler the state is {} as before`; `[01a S15] main.ts registers the restaurant boot steps` (read `main.ts` source: contains the call).
- [ ] **Step 2–5:** `pnpm install`; run → FAIL → implement → PASS; `pnpm typecheck && pnpm test` (boot-budget stays green) → commit `feat(01a): task 37 engine state via createDeps and boot stock fold [spec S15, S16, §2]`

### Task 38: Hub boot config load after catch-up, `BODY_MISSING`, poll timer

**Files:** Modify `apps/hub/src/sync/boot-steps.ts` (step `'5'`: `loadBranchConfig` → `swapBranchConfig(APPLIED ? entry : null)`; step 5 runs after step 4's projection catch-up (`boot.ts:153`), so a rebuilt or caught-up `branch_config` is read, and the server does not listen until after step 6. Step `'6'`: `configPoller(ctx.app).start()` and `ctx.app.addHook('onClose', () => poller.stop())`), `apps/hub/src/sync/config-poller.ts` (`stop()` clears the interval and marks the poller stopped so an in-flight result skips apply and swap), `apps/hub/src/lib/boot.ts` (`BootOptions.configClient` into deps); Create `apps/hub/test/sync/poller-boot.int.test.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #47]` (after one apply, restart with `boot()` → same `branchConfig()`; delete the `branch_config` checkpoint and row, restart → catch-up rebuilds byte-identical rows and the config loads); `[01a §10 #48]` (setup: append `BranchConfigApplied` through `writer.run` **without** inserting `config_snapshots`, R32 → boot is `BODY_MISSING`, next poll sends `config_version=0` and applies); `[01a §10 #124]` (counts survive a restart through `ctx.initialState`; append a newer `BranchConfigApplied` and its body, then set the `branch_config` checkpoint back by one → after boot `branchConfig()` and `stationExists` use the newest config); Review Focus 5: `[01a §7.2] after stop() no poll runs and a late in-flight result does not swap` (fake timers, a stub that resolves after `stop()`).
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm vitest run apps/hub/test/boot` green → commit `feat(01a): task 38 hub config boot after catch-up and poll timer [spec S5, S15, §3.2, §7.2]`

### Task 39: Hub station validator

**Files:** Create `apps/hub/src/sync/station-validator.ts`, `apps/hub/test/sync/station-validator.int.test.ts`; Modify `apps/hub/src/server.ts` (side-effect import before routes).

- [ ] **Step 1: Test:** `[01a §10 #57]`. Body exactly §6.22.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 39 station validator from branch config [spec §6.22, M31]`

### Task 40: Hub `SetPrecookedStock`

**Files:** Create `apps/hub/src/commands/set-precooked-stock.ts`, `apps/hub/test/commands/set-precooked-stock.int.test.ts`; Modify `apps/hub/src/server.ts`.

`defineCommand({ commandType: 'SetPrecookedStock', sessionKind: 'admin', permission: 'manage-stock', … })`. Payload: `entries` 1–200, `refine` unique `item_id`. Validate **all** entries before producing any event (§6.17). **One `StockSet` per entry, even when `on_hand` equals the current value** (S-4). Result from `stockOf(ctx.state, id)` with `on_hand` replaced, `set_at = ctx.clock.branchNow()` (may differ by ms from the stored `recorded_at`; the stock query is the truth, S40 N8), `available = availableStock(next, id, businessDayStartedAt(now, config.business_day_start_ms))`.

- [ ] **Step 1: Tests:** `[01a §10 #59]`, `#60`, `#61`, `#62`, `#63`, `#64`, `#65`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 40 set pre-cooked stock [spec §6.17, S14, S18, S41]`

### Task 41: Hub `SetItemAvailability` and `itemAvailability`

**Files:** Create `apps/hub/src/commands/set-item-availability.ts`, `apps/hub/test/commands/set-item-availability.int.test.ts`; Modify `apps/hub/src/server.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #69]`, `#70`, `#71` (`statementCounter(deps.db)` installed before the call: 1 statement for 1 id and for 100 ids).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 41 item availability [spec §6.18, S17]`

### Task 42: Hub stock query

**Files:** Create `apps/hub/src/queries/stock.ts`, `apps/hub/test/queries/stock.int.test.ts`; Modify `apps/hub/src/server.ts`.

Resource `stock`, `sessionKind: 'admin'`, `session: 'none'` (as 00's admin queries: the admin guard already requires the session, so this matches §6.19's "session required", R43); handler checks `ctx.directory.resolve(ctx.session!.staff_id, 'manage-stock').grant === 'allowed'` else `403 PERMISSION_DENIED { permission: 'manage-stock' }`. Shape §6.19: `business_day_started_at = businessDayStartedAt(now, config.business_day_start_ms)` (from `@pos/domain`), `available = availableStock(state, id, business_day_started_at)`.

- [ ] **Step 1: Tests:** `[01a §10 #72]` (`statementCounter(deps.readDb)`, R31), `[01a §10 #103]` (`unavailable_since` values; the badge is `#103 page part` in task 57); `[01a §6.19] an admin without manage-stock → 403`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 42 stock query [spec §6.19, S30, S33, S41]`

### Task 43: Hub config status

**Files:** Create `apps/hub/src/queries/config-status.ts`, `apps/hub/test/queries/config-status.int.test.ts`; Modify `apps/hub/src/server.ts`.

Resource `config-status`, guard `access-hub-admin`, shape §6.21 (no epoch fields; `last_problem.outcome` `rejected` | `unauthorized` with the S29 reasons).

- [ ] **Step 1: Tests:** `[01a §10 #56]`, `#102` (server part; the banner is `#102 page part` in task 57); `[01a §6.21] config status shows last_poll.outcome not_ready on an unconfirmed hub`; `[01a §6.21] an apply_failed poll shows reason apply_failed`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 43 config status [spec §6.21, S29, S43]`

### Task 44: Hub WS audiences and catch-up parts

**Files:** Create `apps/hub/src/ws/restaurant-audiences.ts`, `apps/hub/src/ws/restaurant-catch-up.ts`, `apps/hub/test/ws/restaurant-ws.int.test.ts`; Modify `apps/hub/src/server.ts`.

Catch-up `stock` part shape §4.5: `{ business_day_started_at, items: { [item_id]: { on_hand, reserved, set_at, available } } }`, `available` from `availableStock`.

- [ ] **Step 1: Tests:** `[01a §10 #73]`, `#89`, `#90` (`vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] })`), `#91`, `#116` (hub part of S41: yesterday's 23:00 count of 4, clock at 12:00 the next day → stock query and catch-up show `available 0`, `on_hand 4`; after `SetPrecookedStock` of 4 → `available 4`).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 44 restaurant ws pushes and catch-up [spec §4.5, S41]`

### Task 45: Hub `GET /queries/branch-config`

**Files:** Create `apps/hub/src/queries/branch-config.ts`, `apps/hub/test/queries/branch-config.int.test.ts`; Modify `apps/hub/src/server.ts`.

`defineQuery({ resource: 'branch-config', sessionKind: 'device', session: 'required', allowStation: true, … })` → `{ data: { config_version, snapshot_hash, snapshot } }` or `{ data: null }` from `currentConfigEntry()`.

- [ ] **Step 1: Test:** `[01a §10 #92]` (count on `deps.readDb` = 0).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 45 branch config query [spec §6.23]`

### Task 46: `apps/client` scaffold, build, ULID helper

**Files:** Create `apps/client/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts}`, `apps/client/owner/index.html`, `apps/client/admin-stock/index.html`, `apps/client/src/app/{router.ts,mount.tsx,ui-kit.ts,ulid.ts,router.test.tsx,ulid.test.ts}`, `apps/client/src/features/owner/main.tsx`, `apps/client/src/features/admin/stock/main.tsx`, `apps/client/src/i18n/{en.ts,index.ts}`, `apps/client/test/setup.ts`, `apps/client/test/build-output.test.ts`; Modify root `package.json` (`"test": "pnpm --filter @pos/client build && vitest run"`; `engines.node` `">=22.22.2 <23"`, nit 7), `.gitignore` (`apps/client/dist/` if `dist` is not already ignored), `pnpm-lock.yaml`.

- `package.json`: `"name": "@pos/client"`, private, `"type": "module"`, deps exactly S35 g plus `"@pos/domain": "workspace:*"`, `"@pos/events": "workspace:*"`, `"@pos/engine": "workspace:*"`; scripts `"build": "vite build --mode owner && vite build --mode admin-stock"`, `"typecheck": "tsc --noEmit"`.
- `vite.config.ts`: `defineConfig(({ mode }) => { if (mode !== 'owner' && mode !== 'admin-stock') throw …; return { root: fileURLToPath(new URL(`./${mode}/`, import.meta.url)), base: mode === 'owner' ? '/owner/' : '/admin/stock/', build: { outDir: fileURLToPath(new URL(`./dist/${mode}/`, import.meta.url)), emptyOutDir: true, manifest: true, assetsInlineLimit: 0 } } })`. JSX uses Vite's built-in transform with the tsconfig's `jsx`; no plugin.
- `tsconfig.json` (R21): standalone (not the base): `strict`, `target ES2023`, `module ESNext`, `moduleResolution Bundler`, `jsx react-jsx`, `lib ["ES2023","DOM","DOM.Iterable"]`, `types []`, `noEmit`, `skipLibCheck`, `include ["src"]`, `exclude ["src/**/*.test.tsx", "src/**/*.test.ts"]` (`vite.config.ts` and `test/` run under Vite/Vitest only and are not typechecked, so `@types/node` is not needed).
- `vitest.config.ts`: `defineProject({ test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'] } })`; `setup.ts` sets `globalThis.IS_REACT_ACT_ENVIRONMENT = true` (R23).
- `src/app/ui-kit.ts`: `import '../../../../packages/ui-kit/tokens.css'; import '../../../../packages/ui-kit/components/bundle.css';` — the only CSS imports (S35 d, R14). `mount.tsx` imports it and renders the entry's root into `#root`. Each `main.tsx` mounts a placeholder view with an i18n title.
- `src/app/ulid.ts` (S35 j, nit 5): `newUlid(nowMs = Date.now())`: 10 time characters + 16 random characters from `crypto.getRandomValues(new Uint8Array(16))`, Crockford base32, the method of `apps/hub/src/auth/pair-page.ts:207`.

- [ ] **Step 1: Tests:** `[01a S35 b] useHashRoute follows hashchange`; `[01a §10 #125]` (`ulid.test.ts`, with `crypto.randomUUID` deleted in the test); `build-output.test.ts` (first line `// @vitest-environment node`, R22): `[01a §10 #113]` exactly as §10, plus `[01a S35 d] each dist has an assets/*.woff2 file` (the UI kit fonts are in the build, R14).
- [ ] **Step 2:** `pnpm install && pnpm vitest run --project @pos/client` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm --filter @pos/client build && pnpm vitest run --project @pos/client` → PASS; `pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit `feat(01a): task 46 client app scaffold, build and ulid [spec S35, S39 a]`

### Task 47: `apps/client` lint rules

**Files:** Modify `eslint.config.js`; Create `apps/client/test/lint.test.ts`.

Add one block **last** in the config, `files: ['apps/client/src/**/*.{ts,tsx}']` (R11):
- `'no-restricted-syntax': ['error', { selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]', message: 'S35 e' }, { selector: 'JSXAttribute[name.name="style"]', message: 'S35 d: style only from packages/ui-kit' }, { selector: 'CallExpression[callee.property.name="randomUUID"]', message: 'S35 j: use src/app/ulid.ts' }]` — no `forbiddenCalls` (browser code may read the clock); do **not** add `apps/client/src/**` to the existing `'off'` list.
- `'no-restricted-imports': ['error', { paths: [{ name: '@pos/domain/hash', message: 'S27' }, { name: 'ulid', message: 'S35 j' }], patterns: [...dbClientImports.patterns, ...qrcodeImports.patterns, ...credentialLookupImports.patterns, ...systemContextImports.patterns, { group: ['node:*'], message: 'S35 f' }, { group: ['**/apps/hub/**', '**/apps/cloud/**', '**/hub/src/**', '**/cloud/src/**'], message: 'S35 f' }, { regex: '^(?!.*packages/ui-kit/).*\\.css$', message: 'S35 d: CSS only from packages/ui-kit' }] }]` (flat config replaces, not merges, the root options, so the root patterns are repeated).

- [ ] **Step 1: Tests** (`lint.test.ts`, `// @vitest-environment node`, `new ESLint().lintText(code, { filePath: 'apps/client/src/x.tsx' })`): `[01a §10 #79]` exactly as §10 (forbidden imports, a `.css` outside the kit and a `style` prop fail; `../../../../packages/ui-kit/tokens.css`, `@pos/engine` and `@pos/domain` pass); `[01a §10 #75 page part] dangerouslySetInnerHTML in apps/client/src fails lint`; `[01a S35 j] crypto.randomUUID() and import 'ulid' fail in apps/client/src`; `[F §6.7] Date.now() in apps/client/src passes, in apps/hub/src fails`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm lint` → commit `feat(01a): task 47 client lint rules [spec S35 d, e, f, j]`

### Task 48: `client-dist`, `admin-page` group, `/owner/*` allowlist, CSP on both — needs Docker Postgres

**Files:** Create `apps/hub/src/lib/client-dist.ts`, `apps/cloud/src/lib/client-dist.ts`, `apps/hub/test/client-dist.int.test.ts`, `apps/cloud/test/owner-pages.int.test.ts`; Modify `apps/hub/src/auth/guards.ts` (group `'admin-page'` in `RouteGroup` and `GROUPS`; `guardsFor` gives it host, provisioned, guest), `apps/hub/test/auth/guards.int.test.ts` (expected map gains `'admin-page': ['host', 'provisioned', 'guest']`), `apps/hub/src/server.ts` (`registerClientDist(app, { prefix: '/admin/stock/', dir: CLIENT_DIST_DIR, routeConfig: { group: 'admin-page' } })`), `apps/cloud/src/server.ts` (prefix `/owner/`, `routeConfig: { tenantScope: 'none' }`), `apps/cloud/src/plugins/tenant-scope.ts` (`TENANT_SCOPE_ALLOWLIST` += `'GET /owner/'`, `'GET /owner/*'`), `apps/cloud/test/route-inventory.int.test.ts` (`ALLOWLIST`).

§7.1 and S39 b: `CLIENT_DIST_DIR = fileURLToPath(new URL('../../../client/dist/<entry>/', import.meta.url))` (R18). At registration read the file list and bodies into memory; a missing dir → `app.log.error` and every path `404`; `GET <prefix>` → `index.html`; `GET <prefix>*` → a listed file whose extension is in the map, else `404 ROUTE_NOT_FOUND` (so `.vite/manifest.json` is never served). Every served file carries `Content-Security-Policy: CSP` on **both** apps (S21, nit 6). Types: `.html text/html; charset=utf-8`, `.js text/javascript; charset=utf-8`, `.css text/css; charset=utf-8`, `.woff2 font/woff2`, `.svg image/svg+xml`, `.png image/png`. Adding §7.1's `admin-page` group (with the M79 guards) keeps the spec literal.

- [ ] **Step 1: Tests:** hub file `[01a §10 #78]` — one test runs the cases (temp dir with `index.html`, `assets/a1.js`, `.vite/manifest.json`; a path with `../`; a missing dir; the CSP header on every served file) against both helpers, importing the cloud one by relative path (`../../cloud/src/lib/client-dist`; it imports only `node:*` and `fastify`). Cloud file `[01a §10 #15]` (real `apps/client/dist/owner/`: `/owner/` and one `assets/*.js` and `assets/*.css` load with no JWT and carry the exact CSP of S21; no `<script>` without `src`; `GET /ui/tokens.css` → 404; route inventory passes).
- [ ] **Step 2–5:** `pnpm --filter @pos/client build && pnpm vitest run apps/hub/test/client-dist.int.test.ts apps/hub/test/auth/guards.int.test.ts apps/cloud/test/owner-pages.int.test.ts apps/cloud/test/route-inventory.int.test.ts` → FAIL → implement → PASS; `pnpm test` → commit `feat(01a): task 48 serve built client pages [spec §7.1, S21, S35 c, S39 b]`

### Task 49: `apps/hub/deploy/ship-client.sh`

**Files:** Create `apps/hub/deploy/ship-client.sh` (mode 755).

§7.8 step 5 (a)–(e) exactly: `#!/usr/bin/env bash`, `set -euo pipefail`, usage `ship-client.sh <ssh-target>`; only `bash`, `git`, `tar`, `ssh`. Order of checks: (a) dirty tree or missing `apps/client/dist/admin-stock/index.html`; (b) `ssh <target> systemctl is-active hub` prints `active` → "hub is running: stop it first (§7.8 step 2)", exit ≠ 0; (c) hub `git rev-parse HEAD` ≠ local; (d) stream to `admin-stock.new`; (e) swap with `mv`, delete `admin-stock.old`. The spec checks it in the runbook's release drill (task 58), not in Vitest.

- [ ] **Step 1: Check before writing:** `bash apps/hub/deploy/ship-client.sh` → "No such file".
- [ ] **Step 2:** Write the script.
- [ ] **Step 3: Checks:** `bash -n apps/hub/deploy/ship-client.sh` → no output; no argument → usage, exit ≠ 0; with an uncommitted scratch file present → "tree is dirty", exit ≠ 0, no `ssh` attempted (delete the scratch file after); with `apps/client/dist` removed → "build output missing", exit ≠ 0; `grep -n 'is-active' apps/hub/deploy/ship-client.sh` → the check runs before any `tar`.
- [ ] **Step 4:** Commit `feat(01a): task 49 hub client ship script [spec S39 d, e, §7.8]`

### Task 50: Shared components

**Files:** Create `apps/client/src/components/{PinPad,StaffTiles,BusyButton,Banner}.tsx`, `apps/client/src/components/components.test.tsx`; Modify `apps/client/src/i18n/en.ts`.

Props per the Interfaces block; data and callbacks only, no API calls (S35 i). UI kit classes from `packages/ui-kit/README.md`. `BusyButton` shows the slow state after 3 000 ms of `busy`.

- [ ] **Step 1: Tests:** `[01a S35 i] PinPad calls onSubmit with the typed digits and clears`; `StaffTiles calls onPick with the staff id`; `BusyButton is disabled while busy and shows the slow text after 3 s` (fake timers); `Banner renders its tone class`.
- [ ] **Step 2–5:** `pnpm vitest run --project @pos/client` → FAIL → implement → PASS → commit `feat(01a): task 50 shared client components [spec S35 i, §8.1]`

### Task 51: Owner money and `cloud-admin` client

**Files:** Create `apps/client/src/features/owner/money.ts`, `money.test.ts`, `apps/client/src/api/cloud-admin.ts`, `apps/client/src/api/cloud-admin.test.ts`.

`money.ts` rules: §8.1 / S40 N7. `cloud-admin.ts`: tokens in `sessionStorage` (`owner_access_token`, `owner_refresh_token`); typed calls for §6.2–§6.16 returning parsed `{ data }` or a typed error; creating calls take the form's `Idempotency-Key` (from `newUlid()`); on `401 JWT_INVALID` call `/v1/auth/refresh` once and retry the same request (same headers, same `Idempotency-Key`); a second `401` clears storage and calls `onLoggedOut()`; network failure → a `network` error the views show as a banner; `403 PERMISSION_DENIED` → a typed error (S8).

- [ ] **Step 1: Tests:** `[01a §10 #74]` (all the §10 cases, including `"1,20,000"` and `"1,2,3"`); Review Focus 2: `[01a §8.1] "Rs 1,200" and "₨1200" are rejected`; Review Focus 3: `[01a §8.1] 401 → one refresh → retried with the same Idempotency-Key; second 401 → onLoggedOut and storage cleared`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 51 owner money parsing and cloud client [spec §8.1]`

### Task 52: Owner shell — login, branch picker, app

**Files:** Create `apps/client/src/features/owner/login/LoginView.tsx`, `apps/client/src/features/owner/BranchPicker.tsx`, `apps/client/src/features/owner/App.tsx`, `apps/client/src/features/owner/App.test.tsx`; Modify `apps/client/src/features/owner/main.tsx`, `apps/client/src/i18n/en.ts`.

Routes `#/login`, `#/`, `#/floors`, `#/stations`, `#/menu` (§8.1); no token → `#/login`; branch picker lists `allowed_branch_ids` decoded from the JWT payload (S37).

- [ ] **Step 1: Tests:** `[01a §8.1] no token shows login; a successful login stores tokens and shows the branch picker with the JWT's branch ids`; `[01a §8.1] a failed login shows errors.LOGIN_INVALID text`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 52 owner app shell [spec §8.1, S37]`

### Task 53: Owner floors view

**Files:** Create `apps/client/src/features/owner/floors/FloorsView.tsx`, `FloorsView.test.tsx`, `apps/client/src/features/owner/form.ts` (`useIdempotencyKey()`: `newUlid()` per opened form, kept across retries); Modify `apps/client/src/features/owner/App.tsx`, `apps/client/src/i18n/en.ts`.

- [ ] **Step 1: Tests:** `[01a §10 #76]` on the "add floor" form (network failure, retry sends the same key; close and reopen → new key, R37); `[01a §8.1] floors with tables, archived rows behind a toggle, sort number edit sends PATCH { sort_order }`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 53 owner floors view [spec §8.1]`

### Task 54: Owner stations view

**Files:** Create `apps/client/src/features/owner/stations/StationsView.tsx`, `StationsView.test.tsx`; Modify `apps/client/src/features/owner/App.tsx`, `apps/client/src/i18n/en.ts`.

- [ ] **Step 1: Tests:** `[01a §8.1] freshness field only for batch; programs listed under batch stations; a 409 shows errors.CONFIG_IN_USE text`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 54 owner stations view [spec §8.1]`

### Task 55: Owner menu view

**Files:** Create `apps/client/src/features/owner/menu/{MenuView,ItemForm}.tsx`, `MenuView.test.tsx`; Modify `apps/client/src/features/owner/App.tsx`, `apps/client/src/i18n/en.ts`.

Tax picker: "No tax" first and default, sending `tax_class_id: null`; archived tax classes and programs are not offered; route picker per branch filtered by station type (program select only for batch); minutes ↔ `_ms`; "When pre-cooked stock runs out": Cook fresh (default) / Sold out. A save answered `403 PERMISSION_DENIED` shows the `errors.PERMISSION_DENIED` text, keeps the form, and disables menu saves for the session (the page cannot know the tenant's branch list before 01b, so it learns from the first `403`, §8.1, S8).

- [ ] **Step 1: Tests:** `[01a §10 #75]` (render part; the lint check is `#75 page part` in task 47, S40 N11); `[01a S34] a new item defaults to No tax and sends tax_class_id null`; `[01a S11] a batch station shows the program select, a slot station hides it`; `[01a §8.1, S8] a 403 on save shows errors.PERMISSION_DENIED and disables saves`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 55 owner menu view [spec §8.1, S8, S32, S34]`

### Task 56: `/admin/stock` — `hub-admin` client and PIN login

**Files:** Create `apps/client/src/api/hub-admin.ts`, `hub-admin.test.ts`, `apps/client/src/features/admin/stock/{StockApp,AdminLogin}.tsx`, `AdminLogin.test.tsx`; Modify `apps/client/src/features/admin/stock/main.tsx`, `apps/client/src/i18n/en.ts`.

`hub-admin.ts` calls the endpoints 00's admin pages call (read `apps/hub/src/auth/admin-session.ts` and `apps/hub/src/auth/pair-page.ts` for paths, headers, IndexedDB `pos-device` / store `device`, `sessionStorage` key `admin_session_token`). `readDeviceToken` defaults to the IndexedDB read; tests inject it (jsdom has no IndexedDB, R10). `AdminLogin` = `StaffTiles` + `PinPad`. `command_id` from `newUlid()`.

- [ ] **Step 1: Tests:** `[01a §8.2] no admin session shows the roster; picking a tile and a PIN stores admin_session_token and shows the stock view`; `[01a §8.2] hub-admin sends the device token and admin session headers`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(01a): task 56 hub admin client and PIN login [spec §8.2, S35 i]`

### Task 57: `/admin/stock` — stock table, status line, problem banner, save

**Files:** Create `apps/client/src/features/admin/stock/{StockTable,ConfigStatus}.tsx`, `apps/client/src/features/admin/stock/badges.ts`, `StockTable.test.tsx`; Modify `StockApp.tsx`, `apps/client/src/i18n/en.ts`.

§8.2: stock + config status on open and every 15 000 ms while `document.visibilityState === 'visible'`; **one status line** ("Menu version 42 · checked 1 min ago", "· offline", or "Waiting for hub confirmation" while `last_poll.outcome` is `not_ready`); **danger banner** for `last_problem` (`rejected` with its reason, `apply_failed` text, `unauthorized`); no "Get changes now" button; **Available** from the query; **Save counts** sends every touched row (edited, even to the same number, or confirmed with the row's **Confirm** button), `on_hand` as numbers, `command_id` kept for retries; badges from `badges.ts` (Interfaces).

- [ ] **Step 1: Tests:** `[01a §10 #77]`; `[01a §10 #102 page part] danger banner for rejected (with reason, and apply_failed) and unauthorized; status line shows not_ready as "Waiting for hub confirmation"`; `[01a §10 #103 page part] "Off since <day>" when unavailable_since is before business_day_started_at; no badge when after` (also unit-test `offSince`); `[01a §10 #104 page part] "Not counted today": set_at yesterday 23:00 → no badge at now 02:00 (day started yesterday 05:00), badge at now 06:00; set_at null → badge` (also unit-test `notCountedToday`); `[01a §8.2] on_hand values are sent as numbers`; Review Focus 4: `[01a §8.2] a refresh does not overwrite the row being edited`; Review Focus 6: `[01a §8.2, S41] after a refresh across the business-day start a stale row shows Available 0`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS; `pnpm --filter @pos/client build` → commit `feat(01a): task 57 hub stock and availability page [spec §8.2, S29, S30, S33, S41]`

### Task 58: Manual runbook and release drill — needs Docker Postgres, needs hardware

**Files:** none. Run on the dev box with the setup of `docs/manual-test-00.md` §1–§3 (database `pos_manual`, never `pos_test`, which the cloud tests truncate; cloud on port 4000 through the `cloud` wrapper with `node --import tsx src/main.ts`; hub on port 3000 with `cd apps/hub && node --import tsx src/main.ts`). Report each result in the chat; Claude writes `docs/manual-test-01a.md` from the report (task 59).

- [ ] `pnpm --filter @pos/client build`; start cloud and hub; `seed-tenant`, `issue-registration-code`, provision as in 00's runbook.
- [ ] Owner at `http://localhost:4000/owner/`: floor, slot station "Karahi", batch station "Fryer" with a program, a category, two items (one with stock time). Within 60 s the hub `http://localhost:3000/admin/stock/` lists them.
- [ ] Pair a KDS browser to "Karahi" (00 screen-request flow) → paired.
- [ ] Stop the cloud; set counts and toggle an item off → saved; the status line shows offline.
- [ ] Business day: set a count, move the hub clock past the next 05:00 → Available 0 and "Not counted today"; re-enter the same number (or **Confirm**) → Available back, badge gone.
- [ ] Restore drill (S42): `pg_dump pos_manual`, make two menu edits and remove a staff member, restore the dump; within 60 s the hub still shows the newer menu (forward only); run `pnpm --filter @pos/cloud restore-bump --tenant <id>`; within 60 s the hub applies the older menu and the older staff directory (the removed staff member can log in again: the runbook re-applies the removal).
- [ ] Timing (§7.5, S40 N10): note the p95 of 20 `curl` calls for the `304` path and for a full snapshot, and the hub apply time from the log.
- [ ] Page parts of tests 75, 102, 103, 104, also automated in tasks 47 and 57 (S40 N11): a scratch `dangerouslySetInnerHTML` in `apps/client/src/x.tsx` makes `pnpm lint` fail (delete it after); on `/admin/stock/`, force a hash mismatch (edit one snapshot field in the cloud DB without bumping) → danger banner; turn an item off, set the hub clock past the next business-day start → "Off since" badge; a count from before the business-day start → "Not counted today", a count after → no badge.
- [ ] **needs hardware** — release drill §7.8 steps 1–6 **on site over the LAN** against the pilot mini PC or any `ssh` target with an `/opt/pos-hub` checkout: build and test → stop → push the tag and checkout → `pnpm install --frozen-lockfile --prod` → `ship-client.sh` → start; include one refusal (dirty tree, hub still active, or a different commit); ends with `/admin/stock/` → `200` with the CSP header on the hub. Optional on the mini PC: `SetPrecookedStock` with 200 entries ≤ 50 ms p95.
- [ ] No commit.

### Task 59: README, spec status, runbook file, DoD close-out — Claude only

**Files:** Modify `docs/specs/README.md` (01a status, carried requirements §4.4 including 02's copy of program cook times and parking as an order type, 06's `restore-bump`, 00 drift notes §2), the 01a spec status line; Create `docs/manual-test-01a.md` (from task 58's report, same layout as `docs/manual-test-00.md`).

- [ ] Coverage in code: for every active §10 number N of the spec (the numbers in this plan's coverage table), `grep -rhoE "\[01a §10 #N\]" apps packages | wc -l` = 1; for `75 102 103 104`, `grep -rhoE "\[01a §10 #N page part\]" apps | wc -l` = 1 (S40 N11); no test cites a §10 number that is not in the coverage table.
- [ ] Walk §12.1 and §12.2; record gaps. Commit `feat(01a): task 59 module 01a close-out [spec §12.1]`
