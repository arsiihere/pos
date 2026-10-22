# 00 Hub Platform & Access — Implementation Plan

> **For the implementer (Cursor, no plugins):** follow `.cursor/rules/pos.mdc`. Do **one task per request**, in order. Each task: write the listed tests first, run them and see them fail, implement, run them and the full suite, commit. Steps use checkboxes (`- [ ]`) for tracking; do **not** tick them in this file (it is read-only for you).

**Goal:** Build module 00: the hub platform (event store, migrations, command/query registries, commit-then-swap writer, boot), hub access (setup, pairing, staff/admin/station sessions, lockouts, permissions, WebSocket) and the minimum cloud access (tenant guard, owner auth, hub registration, CLIs).

**Architecture:** pnpm + Turborepo monorepo. `apps/hub` (Fastify 5 + better-sqlite3, synchronous transactions, in-memory state swapped only after COMMIT), `apps/cloud` (Fastify 5 + PostgreSQL 16 through tenant-scoped repositories), shared `@pos/domain` (types, errors, permissions) and `@pos/events` (Zod schemas). Every hub write goes through one writer; every staff write goes through one generic command route.

**Tech stack:** TypeScript, Node.js 22, Fastify 5.12.7, fastify-type-provider-zod 7.0.0, Zod 4.6.7, better-sqlite3 13.0.3, @node-rs/argon2 2.2.2, @fastify/websocket 11.3.4, @fastify/jwt 10.2.5, pg 8.23.1, ulid 3.0.2, Vitest 4.1.12.

**Spec:** `docs/specs/00_Hub_Platform_Access_Spec_v0.5.md` (read with `docs/specs/00_Foundation_Spec_v1.7.md` §4.1, §5.6–§5.8, §6). Section references below like "§3.5" mean spec 00; "F §6.3" means the foundation.

**Safe to start before the hostile review of spec 00:** tasks **1–5** (monorepo, shared packages). They depend only on the frozen foundation and on spec 00 parts (error codes, permissions, event names) that a review can change only by *adding*, which later tasks absorb. Tasks 6+ wait for the review.

## Global Constraints

Every task implicitly includes these. Values are copied from the spec.

- **Versions (pin exactly, M26):** `fastify@5.12.7`, `fastify-type-provider-zod@7.0.0`, `zod@4.6.7`, `better-sqlite3@13.0.3`, `@node-rs/argon2@2.2.2`, `@fastify/websocket@11.3.4`, `@fastify/jwt@10.2.5`, `pg@8.23.1`, `ulid@3.0.2`, `vitest@4.1.12`, `typescript@5` latest 5.x, Node 22. No other runtime dependency. CIDR matching: `node:net` `BlockList`. Crypto: `node:crypto`. No `@fastify/cors`.
- **Determinism (F §6.7):** source code never calls `Date.now()`, `performance.now()`, `Math.random()`, `crypto.randomUUID()` or `ulid()` directly. Time comes from `Clock.branchNow()`, IDs from `IdGen.next()`, secrets from `randomBytes` passed in as `SecretGen` (task 6). The only exceptions are the two real implementations in `apps/hub/src/lib/clock.ts` / `ids.ts` and their cloud twins.
- **Envelope (F §6.1):** success `{ data }` (+ `meta` for paginated lists), error `{ error: { code, message, details, request_id } }`. No 204. Replays add header `Idempotent-Replay: true`. 429 and 503 add `Retry-After` (seconds, rounded up) and `details.retry_after_ms`.
- **Errors:** only codes from `ErrorCatalogue` (task 2). Throw `new DomainError(code, details)`.
- **Naming (F §6.6):** snake_case on the wire and in SQL, camelCase in TypeScript. Times `*_at` integer Unix ms; durations `*_ms`.
- **SQL:** better-sqlite3 transactions are `db.transaction(fn).immediate(...)` (= `BEGIN IMMEDIATE`). No `await` inside a transaction function.
- **Secrets never logged:** `pin`, `password`, `pairing_token`, `registration_code`, `refresh_token`, `device_token`, `session_token`, `admin_session_token`, `branch_api_key`, `access_token`, `backup_encryption_key`, headers `authorization`, `x-session-token`, `x-admin-session`.
- **Test locations (F §6.7):** unit `*.test.ts` next to source; hub integration `apps/hub/test/**/*.int.test.ts`; cloud integration `apps/cloud/test/**/*.int.test.ts`.
- **Test names:** `it('[00 §10 #N] …')` for spec-numbered tests (each number exactly once); otherwise `it('[00 §x.y] …')`.
- **Commit:** `feat(00): task N <title> [spec §x]`.
- **Fixed values:** PIN `/^\d{4,6}$/` (a string; leading zeros matter); argon2id PHC with `m ≥ 19456, t ≥ 2, p = 1`; lockout staff 5 / device or IP 10 in a 300 000 ms window / lock 900 000 ms; argon2 semaphore 2, wait 2 000 ms, then 503 `retry_after_ms: 1000`; pairing token TTL 600 000 ms; registration code 12 Crockford base32 chars, TTL 86 400 000 ms, same-attempt window 3 600 000 ms; sweeper 15 000 ms; heartbeat 60 000 ms; WS auth timeout 5 000 ms, ping 15 000 ms, pong timeout 30 000 ms; owner login lockout 10 failures / 900 000 ms window / 900 000 ms lock; JWT 1 h HS256; refresh token 30 d; query pages default 50, max 200; `cors_origins` default `["http://localhost"]`.

## Review Focus

Inputs the spec implies but no §10 test covers. Each has a test in the task named.

1. **IPv4-mapped client IPs** (`::ffff:192.168.20.7`, what Node reports on dual-stack sockets) must match an IPv4 guest CIDR, or the guest-network guard silently lets guests through → task 7.
2. **PINs with leading zeros** (`"0123"`) must verify as strings; a numeric coercion would turn them into `123` and lock staff out → task 34.
3. **Missing or malformed hub config file** at boot must exit non-zero with a clear message naming the bad field, not crash-loop with a stack trace → task 9.
4. **A directory whose `approver_role_id` names a role that is not in the directory** must be rejected whole, leaving the old directory in place (no half-applied permissions) → task 19.
5. **USB backup drive missing or read-only during a pre-migration backup** must fall back to `data_dir`; if that also fails, migrations must not run → task 11.

---

## File map

```
package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, vitest.config.ts, eslint.config.js, docker-compose.yml
packages/domain/src/{ids,errors,permissions,enums,index}.ts
packages/events/src/{envelope,registry,codecs,ws,directory,index}.ts
packages/events/src/events/{hub,staff,station}/<EventType>.v1.ts
packages/events/testing/index.ts            builders (subpath export @pos/events/testing)
packages/events/fixtures/<EventType>.v1.json, <EventType>.latest.json
apps/hub/src/lib/{clock,ids,secrets,semaphore,net,crypto-file,boot,health}.ts
apps/hub/src/config/{schema,load,write}.ts
apps/hub/src/db/{connection,migrate,pre-migrate-backup}.ts, db/migrations/000{1,2,3}_*.sql
apps/hub/src/engine-host/{append-events,state-holder,writer}.ts
apps/hub/src/projections/registry.ts
apps/hub/src/server.ts, main.ts
apps/hub/src/auth/{staff-directory,apply-directory,session-store,guards,pin,admin-session,station-validator,pairing,pair-page,staff-session,station-session,session-sweeper}.ts
apps/hub/src/commands/{registry,route,generate-device-pairing-token,revoke-device,force-logout-session,clear-pin-lockout}.ts
apps/hub/src/queries/{registry,devices,sessions,staff-roster,session}.ts
apps/hub/src/setup/{provision,cloud-client,page}.ts
apps/hub/src/ws/{server,catch-up,audience}.ts
apps/hub/deploy/hub.service
apps/hub/test/helpers/{db,test-hub,fixtures,stub-cloud,log-capture,statement-counter,ws-client}.ts
apps/cloud/src/{main,server}.ts, apps/cloud/src/lib/{env,clock,ids,secrets}.ts
apps/cloud/src/db/{client,migrate,credential-lookup,tenant-scoped-repository,tenant-level-repository}.ts, db/migrations/0001_platform.sql
apps/cloud/src/plugins/{tenant-scope,jwt,error-handler}.ts
apps/cloud/src/modules/hub-registration/{routes,service,repository,schemas,issue-code}.ts
apps/cloud/src/modules/owner-auth/{routes,service,repository,schemas}.ts
apps/cloud/src/modules/staff-roles/{default-roles,seed-tenant}.ts
apps/cloud/src/modules/health/routes.ts
apps/cloud/test/helpers/{test-cloud,global-setup}.ts
```

---

### Task 1: Monorepo skeleton — SAFE BEFORE REVIEW

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.config.ts`, `eslint.config.js`, `packages/domain/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`, `packages/events/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`, `apps/hub/{package.json,tsconfig.json,vitest.config.ts,src/main.ts}`, `apps/cloud/{package.json,tsconfig.json,vitest.config.ts,src/main.ts}`, `packages/domain/src/smoke.test.ts`
- Modify: `.gitignore` (add `node_modules`, `dist`, `.turbo`, `coverage`)

**Interfaces:** Produces workspace packages `@pos/domain`, `@pos/events`, `@pos/hub`, `@pos/cloud`; root scripts `pnpm test` (= `vitest run`), `pnpm lint`, `pnpm typecheck` (= `turbo run typecheck`).

- [ ] **Step 1: Write the failing test** `packages/domain/src/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as domain from './index';
describe('workspace', () => {
  it('[F §6.7] vitest projects run packages', () => { expect(domain).toBeDefined(); });
});
```
- [ ] **Step 2: Run** `pnpm install && pnpm test` → Expected: FAIL (no root config / workspace yet).
- [ ] **Step 3: Implement** the files. Root `vitest.config.ts`: `defineConfig({ test: { projects: ['packages/*', 'apps/*'] } })`; each package `vitest.config.ts` uses `defineProject`. `tsconfig.base.json`: `strict: true`, `module: "NodeNext"`, `target: "ES2023"`. `eslint.config.js`: flat config with `no-restricted-imports` blocking `**/db/client` from any file outside `apps/cloud/src/db/` (D54), and `no-restricted-syntax` forbidding `Date.now`, `performance.now`, `Math.random` outside `apps/*/src/lib/{clock,ids,secrets}.ts`, `apps/*/src/main.ts` and tests.
- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(00): task 1 monorepo skeleton [spec §7.11, F §5.1, §6.7]`

**Done when:** `pnpm test` runs the smoke test through the root projects config; lint rejects `Date.now()` in a scratch file under `apps/hub/src/` (check manually, then delete the scratch file).

---

### Task 2: `@pos/domain` — IDs, enums, error catalogue — SAFE BEFORE REVIEW

**Files:**
- Create: `packages/domain/src/{ids,enums,errors}.ts`, `packages/domain/src/errors.test.ts`, `packages/domain/src/ids.test.ts`
- Modify: `packages/domain/src/index.ts` (re-export); delete `packages/domain/src/smoke.test.ts`

**Interfaces — Produces:**
```ts
// ids.ts
export const ULID_RE: RegExp;                       // /^[0-9A-HJKMNP-TV-Z]{26}$/
export type Ulid = string;
// enums.ts
export type DeviceType = 'tablet' | 'cashier_kiosk' | 'kds' | 'phone';
export type SessionKind = 'staff' | 'admin' | 'station';
export type SessionEndReason = 'logout' | 'replaced' | 'taken_over' | 'idle_timeout' | 'forced'
  | 'device_revoked' | 'staff_removed' | 'hub_restored';
export type GrantType = 'allowed' | 'requires_approval';
export type Grant = GrantType | 'not_granted' | 'denied';
export type LockoutSubject = 'staff' | 'device' | 'ip';
// errors.ts
export const ErrorCatalogue: { readonly [code: string]: { readonly status: number } }; // `as const`
export type ErrorCode = keyof typeof ErrorCatalogue;
export class DomainError extends Error { constructor(code: ErrorCode, details?: Record<string, unknown>); readonly code: ErrorCode; readonly details: Record<string, unknown>; }
export function statusOf(code: ErrorCode): number;
```
`ErrorCatalogue` entries (status): `VALIDATION_FAILED 400`; `DEVICE_TOKEN_INVALID, SESSION_INVALID, SESSION_EXPIRED, ADMIN_SESSION_REQUIRED, PAIRING_TOKEN_INVALID, REGISTRATION_CODE_INVALID, BRANCH_API_KEY_INVALID, JWT_INVALID, PIN_INVALID, LOGIN_INVALID, REFRESH_TOKEN_INVALID 401`; `PERMISSION_DENIED, GUEST_NETWORK_FORBIDDEN, DEVICE_REVOKED, BRANCH_MISMATCH, DEVICE_TYPE_NOT_ALLOWED, DEVICE_NOT_OWNED 403`; `ROUTE_NOT_FOUND, STAFF_NOT_FOUND, STATION_NOT_FOUND, DEVICE_NOT_FOUND, SESSION_NOT_FOUND 404`; `TABLE_ALREADY_LOCKED, TABLE_LOCK_NOT_HELD, ITEM_WRONG_STAGE, VOID_PENDING, SYNC_SEQ_GAP, DEVICE_SESSION_ACTIVE, HUB_NOT_PROVISIONED, SETUP_IN_PROGRESS 409`; `REGISTRATION_CODE_KIND_UNSUPPORTED 422`; `CLIENT_UPGRADE_REQUIRED 426`; `PIN_LOCKED_OUT, DEVICE_LOCKED_OUT, LOGIN_LOCKED_OUT 429`; `INTERNAL_ERROR 500`; `SERVICE_UNAVAILABLE 503`.

- [ ] **Step 1: Write failing tests.**
```ts
// errors.test.ts
it('[F §6.2] every DomainError code used in source is in the catalogue', () => {
  // read every .ts file under apps/*/src and packages/*/src (fs + glob via node:fs readdirSync recursive),
  // regex /new DomainError\(\s*'([A-Z_]+)'/g, collect codes
  for (const code of usedCodes) expect(ErrorCatalogue).toHaveProperty(code);
});
it('[00 §9] spec 00 codes have their statuses', () => {
  expect(statusOf('PIN_INVALID')).toBe(401); expect(statusOf('DEVICE_NOT_OWNED')).toBe(403);
  expect(statusOf('DEVICE_SESSION_ACTIVE')).toBe(409); expect(statusOf('REGISTRATION_CODE_KIND_UNSUPPORTED')).toBe(422);
  expect(statusOf('LOGIN_LOCKED_OUT')).toBe(429);
});
it('[F §6.2] DomainError carries code and details', () => {
  const e = new DomainError('STAFF_NOT_FOUND', { staff_id: 'x' });
  expect(e.code).toBe('STAFF_NOT_FOUND'); expect(e.details).toEqual({ staff_id: 'x' });
});
// ids.test.ts
it('[F §6.6] ULID_RE accepts Crockford ULIDs only', () => {
  expect(ULID_RE.test('01JBF3Q8ZK4M2N6P7R9S0T1V2W')).toBe(true);
  expect(ULID_RE.test('01JBF3Q8ZK4M2N6P7R9S0T1V2I')).toBe(false); // I not allowed
});
```
- [ ] **Step 2: Run** `pnpm vitest run packages/domain` → FAIL (modules missing).
- [ ] **Step 3: Implement** the three files per Interfaces.
- [ ] **Step 4: Run** `pnpm vitest run packages/domain && pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(00): task 2 domain ids, enums, error catalogue [spec §9, F §6.2]`

**Done when:** the catalogue holds exactly the codes above; the coverage test scans source files.

---

### Task 3: `@pos/domain` — permission catalogue — SAFE BEFORE REVIEW

**Files:** Create `packages/domain/src/permissions.ts`, `packages/domain/src/permissions.test.ts`; Modify `packages/domain/src/index.ts`.

**Interfaces — Produces:**
```ts
export const PERMISSIONS: readonly [ 'void-item','move-item-to-stock','mark-item-returned','apply-discount','apply-refund',
  'apply-comp','reopen-bill','edit-menu','view-reports','take-order-anywhere','boost-order','approve-void',
  'force-release-table-lock','reprint-ticket','view-audit-log','manage-roles','manage-staff','manage-devices','access-hub-admin' ];
export type Permission = typeof PERMISSIONS[number];
export function isPermission(x: string): x is Permission;
export function assertKnownPermissions(declared: Iterable<string>): void; // throws Error naming the first unknown
```
- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #74] a command declaring an unknown permission fails', () => {
  expect(() => assertKnownPermissions(['manage-devices', 'make-coffee'])).toThrow(/make-coffee/);
  expect(() => assertKnownPermissions(['manage-devices', 'access-hub-admin'])).not.toThrow();
});
it('[00 §3.6] catalogue has the E6 list plus manage-devices and access-hub-admin', () => {
  expect(PERMISSIONS).toHaveLength(19); expect(new Set(PERMISSIONS).size).toBe(19);
});
```
- [ ] **Step 2: Run** `pnpm vitest run packages/domain/src/permissions.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(00): task 3 permission catalogue [spec §3.6]`

**Done when:** the command registry (task 22) can call `assertKnownPermissions` at registration.

---

### Task 4: `@pos/events` — envelopes and event registry — SAFE BEFORE REVIEW

**Files:** Create `packages/events/src/{envelope,registry,codecs}.ts`, `packages/events/src/envelope.test.ts`, `packages/events/src/codecs.test.ts`; Modify `packages/events/src/index.ts`, `packages/events/package.json` (dep `zod@4.6.7`, `@pos/domain`).

**Interfaces — Produces:**
```ts
// envelope.ts — foundation §4.1 verbatim
export const StreamTypeSchema: z.ZodEnum<['order','table','station','stock','shift','audit','hub','staff']>;
export const PosEventSchema: z.ZodObject<…>;   export type PosEvent = z.infer<typeof PosEventSchema>;
export const PosCommandSchema: z.ZodObject<…>; export type PosCommand = z.infer<typeof PosCommandSchema>;
export type EventDraft = Omit<PosEvent, 'event_id'|'seq'|'recorded_at'|'tenant_id'|'branch_id'>;
// registry.ts
export function defineEvent<P extends z.ZodTypeAny>(def: { eventType: string; version: number; payload: P;
  upcastFromPrevious?: (prev: unknown) => z.infer<P> }): EventDef<P>;
export function latestVersion(eventType: string): number;
export function payloadSchema(eventType: string, version: number): z.ZodTypeAny;
// codecs.ts
export function parseEvent(raw: unknown): PosEvent;   // validates envelope + payload, upcasts to latest (D46)
export function draftOf<P>(def: EventDef<P>, d: { stream_type; stream_id; payload: z.infer<P>;
  occurred_at: number; actor_id: string | null; device_id: string }): EventDraft;  // sets event_type + schema_version
```
- [ ] **Step 1: Write failing tests.**
```ts
it('[F §4.1] PosEventSchema rejects an unknown stream_type', () => {
  expect(PosEventSchema.safeParse({ ...validEvent, stream_type: 'device' }).success).toBe(false);
});
it('[F §4.1] PosCommandSchema requires command_id and device_id', () => { /* omit each → success false */ });
it('[F §4.1, D46] parseEvent upcasts a v1 payload to the latest version', () => {
  const T = defineEvent({ eventType: 'TestThing', version: 1, payload: z.object({ a: z.number() }) });
  defineEvent({ eventType: 'TestThing', version: 2, payload: z.object({ a: z.number(), b: z.string() }),
    upcastFromPrevious: (p: any) => ({ ...p, b: 'x' }) });
  expect(parseEvent({ ...validEvent, event_type: 'TestThing', schema_version: 1, payload: { a: 1 } }).payload)
    .toEqual({ a: 1, b: 'x' });
});
it('[F §4.1] parseEvent rejects a payload that fails its schema', () => { /* throws */ });
```
- [ ] **Step 2: Run** `pnpm vitest run packages/events` → FAIL.
- [ ] **Step 3: Implement.** The registry is a module-level `Map<eventType, Map<version, def>>`; `defineEvent` throws on a duplicate `(eventType, version)` and on a version gap (v2 without v1).
- [ ] **Step 4: Run** → PASS; `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(00): task 4 event envelopes and registry [F §4.1, D46]`

---

### Task 5: `@pos/events` — spec 00 events, WS messages, builders, fixtures — SAFE BEFORE REVIEW

**Files:** Create `packages/events/src/events/hub/{HubProvisioned,HubStarted,ClockAlarm,StaffDirectoryApplied,DevicePairingTokenGenerated,DevicePaired,DeviceRevoked,DevicePinLockedOut}.v1.ts`, `packages/events/src/events/staff/{SessionStarted,SessionEnded,StaffPinLockedOut,PinLockoutCleared}.v1.ts`, `packages/events/src/ws.ts`, `packages/events/testing/index.ts`, `packages/events/fixtures/<each event>.v1.json` and `.latest.json` (12 × 2), `packages/events/src/fixtures.test.ts`, `packages/events/src/ws.test.ts`, `packages/events/testing/builders.test.ts`; Modify `packages/events/src/index.ts`, `packages/events/package.json` (exports `"./testing"`).

**Interfaces — Produces** (payload fields exactly as spec §4.2 events table; v1):
- `SessionStarted` / `SessionEnded` live in `events/staff/` but their `stream_type` is `'staff'` (stream_id = staff_id) or `'station'` (stream_id = station_id); the schema does not constrain stream_type.
- `DeviceRevoked` payload `{ device_id, reason: string|null, cause: 'manual'|'owner_removed' }`; `DevicePairingTokenGenerated` / `DevicePaired` include `owner_staff_id: string|null`; `ClockAlarm.source: 'boot'|'cloud_offset'`; `SessionEnded.reason`: `SessionEndReason`; `ended_by: string|null`.
- `ws.ts`: `WsClientMessage = { type:'auth', device_token, session_token } | { type:'ack', last_seq }`; `WsServerMessage = { type:'catch_up', as_of_seq, state: Record<string, unknown> } | { type:'event', seq, event: Pick<PosEvent,'event_id'|'event_type'|'schema_version'|'payload'> }`. (No `error` frame type is used by 00 before auth; keep F §6.5's `error` variant in the union.) Close codes exported: `WS_CLOSE = { CREDENTIALS: 4401, FORBIDDEN: 4403, UPGRADE: 4426, RESTARTING: 1012 }`.
- `@pos/events/testing`: one builder per event, `aSessionStarted(overrides?)`, `aSessionEnded(…)`, … returning a full `PosEvent` (deterministic ids `01J0000000000000000000000N`).

- [ ] **Step 1: Write failing tests.**
```ts
// fixtures.test.ts
it('[F §6.7, D46] every stored fixture upcasts to its .latest.json', () => {
  for (const f of v1Fixtures) expect(parseEvent(load(f)).payload).toEqual(load(latestOf(f)).payload);
});
// builders.test.ts
it('[F §6.7] every builder output parses with its own schema', () => {
  for (const b of Object.values(builders)) expect(() => parseEvent(b())).not.toThrow();
});
// ws.test.ts
it('[00 §6.21, M12] WsClientMessage accepts auth and ack only', () => {
  expect(WsClientMessage.safeParse({ type: 'auth', device_token: 'a', session_token: 'b' }).success).toBe(true);
  expect(WsClientMessage.safeParse({ type: 'hello' }).success).toBe(false);
});
```
- [ ] **Step 2: Run** `pnpm vitest run packages/events` → FAIL.
- [ ] **Step 3: Implement** with `defineEvent` from task 4.
- [ ] **Step 4: Run** → PASS; `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(00): task 5 spec 00 events, ws messages, builders, fixtures [spec §4.2, §6.21]`

---

> **Stop here until the hostile review of spec 00 is done** (the user will say when tasks 6+ may start).

### Task 6: Hub lib — clock, IDs, secrets

**Files:** Create `apps/hub/src/lib/{clock,ids,secrets}.ts`, `apps/hub/src/lib/clock.test.ts`, `apps/hub/src/lib/ids.test.ts`.

**Interfaces — Produces:**
```ts
// clock.ts
export interface Clock { branchNow(): number }
export function createBranchClock(o: { wallNow: () => number; monoNow: () => number; lastRecordedAt: number }):
  { clock: Clock; alarm: null | { wall_ms: number; last_recorded_at: number; delta_ms: number } };
export function fixedClock(t: number): Clock & { set(t: number): void; advance(ms: number): void };
export function steppingClock(t: number, stepMs: number): Clock;
export const T = 1_761_000_000_000;               // F §6.7 epoch for tests
// ids.ts
export interface IdGen { next(): string }
export function ulidGen(clock: Clock): IdGen;      // monotonicFactory from 'ulid', seeded with clock.branchNow()
export function testIdGen(): IdGen;               // deterministic valid ULIDs: '01J' + 23-char zero-padded counter
// secrets.ts
export interface SecretGen { token256(): string; bytes(n: number): Buffer } // token256 = 32 random bytes, base64url
export const cryptoSecrets: SecretGen;             // node:crypto randomBytes
export function testSecrets(): SecretGen;           // deterministic counter-based
export const sha256hex: (s: string) => string;
```
- [ ] **Step 1: Write failing tests.**
```ts
it('[F §4.7] branchNow = bootWall + mono elapsed and never jumps with the wall clock', () => {
  let wall = T, mono = 1000;
  const { clock } = createBranchClock({ wallNow: () => wall, monoNow: () => mono, lastRecordedAt: 0 });
  mono += 500; wall -= 60_000;                     // OS clock stepped back
  expect(clock.branchNow()).toBe(T + 500);
});
it('[F §4.7, D48] boot wall ≤ last recorded_at → starts at last+1 with an alarm', () => {
  const r = createBranchClock({ wallNow: () => T, monoNow: () => 0, lastRecordedAt: T + 10 });
  expect(r.clock.branchNow()).toBe(T + 11);
  expect(r.alarm).toEqual({ wall_ms: T, last_recorded_at: T + 10, delta_ms: -10 });
});
it('[F §6.7] testIdGen yields valid, increasing ULIDs', () => { /* ULID_RE, a < b */ });
it('[F §6.7] ulidGen is monotonic within one ms', () => { /* fixedClock, 3 ids strictly increasing */ });
```
`delta_ms` = `wall − last_recorded_at`.
- [ ] **Step 2: Run** `pnpm vitest run apps/hub/src/lib` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(00): task 6 hub clock, ids, secrets [F §4.7, §6.7, D48]`

---

### Task 7: Hub lib — semaphore and network matcher

**Files:** Create `apps/hub/src/lib/{semaphore,net}.ts`, `apps/hub/src/lib/semaphore.test.ts`, `apps/hub/src/lib/net.test.ts`.

**Interfaces — Produces:**
```ts
export class SemaphoreTimeoutError extends Error {}
export class Semaphore { constructor(size: number); acquire(timeoutMs: number): Promise<() => void> } // FIFO; release fn idempotent
export function createNetMatcher(cidrs: string[]): (ip: string) => boolean;   // BlockList.addSubnet
```
- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §7.4] third acquire waits and times out after the deadline', async () => {
  vi.useFakeTimers(); const s = new Semaphore(2);
  await s.acquire(2000); await s.acquire(2000);
  const p = s.acquire(2000); vi.advanceTimersByTime(2000);
  await expect(p).rejects.toBeInstanceOf(SemaphoreTimeoutError);
});
it('[00 §7.4] release hands the slot to the oldest waiter', async () => { /* order of resolution */ });
it('[00 §3.9] guest CIDR matches IPv4 and IPv4-mapped IPv6 addresses (Review Focus 1)', () => {
  const m = createNetMatcher(['192.168.20.0/24']);
  expect(m('192.168.20.7')).toBe(true); expect(m('::ffff:192.168.20.7')).toBe(true);
  expect(m('192.168.10.7')).toBe(false); expect(m('::1')).toBe(false);
});
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (strip a leading `::ffff:` when the rest is dotted IPv4). **Step 4: Run** → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 7 semaphore and network matcher [spec §3.9, §7.4]`

---

### Task 8: Hub lib — encrypted file helper

**Files:** Create `apps/hub/src/lib/crypto-file.ts`, `apps/hub/src/lib/crypto-file.test.ts`.

**Interfaces — Produces:** `encryptFile(src: string, dst: string, key: Buffer, iv: Buffer): Promise<void>`; `decryptFile(src: string, dst: string, key: Buffer): Promise<void>`; `MAGIC = Buffer.from('POSENC1\n')`. Format (§7.9): `MAGIC(8) ‖ IV(12) ‖ ciphertext ‖ tag(16)`, AES-256-GCM, written to `dst + '.tmp'`, fsync, rename. `decryptFile` must verify the tag **before** creating `dst` (decrypt to `dst.tmp`, verify `final()`, then rename; delete `.tmp` on failure). The caller supplies `iv` (from `SecretGen.bytes(12)`), keeping the function deterministic in tests.

- [ ] **Step 1: Write failing test.**
```ts
it('[00 §10 #65] round trip; a flipped byte fails the tag and writes no output', async () => {
  await encryptFile(plain, enc, key, iv); await decryptFile(enc, out, key);
  expect(readFileSync(out)).toEqual(readFileSync(plain));
  flipByte(enc, 30);
  await expect(decryptFile(enc, out2, key)).rejects.toThrow();
  expect(existsSync(out2)).toBe(false); expect(existsSync(out2 + '.tmp')).toBe(false);
});
```
- [ ] **Step 2–4:** run `pnpm vitest run apps/hub/src/lib/crypto-file.test.ts` → FAIL → implement with `createCipheriv('aes-256-gcm')` streams → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 8 encrypted file helper [spec §7.9, M21]`

---

### Task 9: Hub config loader and atomic writer

**Files:** Create `apps/hub/src/config/{schema,load,write}.ts`, `apps/hub/src/config/config.test.ts`.

**Interfaces — Produces:**
```ts
export const HubConfigSchema: z.ZodObject<…>;  // fields exactly §3.10; auth.* and cors_origins have the defaults from Global Constraints
export type HubConfig = z.infer<typeof HubConfigSchema>;
export class ConfigError extends Error { readonly field?: string }
export function loadHubConfig(path: string): HubConfig;          // throws ConfigError
export function writeHubConfigAtomic(path: string, cfg: HubConfig): void; // tmp → fsync → rename → fsync dir; mode 0o600
export function isProvisioned(cfg: HubConfig): boolean;           // provisioned.branch_id && provisioned.branch_api_key
export const DEFAULT_CONFIG_PATH = '/etc/pos-hub/config.json';    // overridable by env POS_HUB_CONFIG
```
- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §3.10] defaults fill auth limits and cors_origins', () => { /* minimal file → auth.pin_max_failures 5, argon2_concurrency 2, cors_origins ['http://localhost'] */ });
it('[00 §3.10] missing or malformed config fails with the field name (Review Focus 3)', () => {
  expect(() => loadHubConfig(missingPath)).toThrow(ConfigError);
  writeFileSync(p, '{ "http_port": "x" }');
  expect(() => loadHubConfig(p)).toThrow(/http_port/);
  writeFileSync(p, '{ not json'); expect(() => loadHubConfig(p)).toThrow(ConfigError);
});
it('[00 §3.10] atomic write leaves mode 0600 and no .tmp file', () => { /* statSync(p).mode & 0o777 === 0o600 */ });
it('[00 §3.2] isProvisioned needs both branch_id and branch_api_key', () => {});
```
- [ ] **Step 2–4:** run `pnpm vitest run apps/hub/src/config` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 9 hub config [spec §3.10]`

---

### Task 10: SQLite connection and migrations runner

**Files:** Create `apps/hub/src/db/{connection,migrate}.ts`, `apps/hub/test/db/migrate.int.test.ts`, `apps/hub/test/db/fixtures/migrations-a/{0001_a.sql,0002_b.sql}`.

**Interfaces — Produces:**
```ts
export function openDb(path: string): Database.Database;   // journal_mode=WAL, synchronous=FULL, foreign_keys=ON, busy_timeout=5000
export function openReadOnly(path: string): Database.Database; // { readonly: true }, same pragmas where allowed
export interface MigrationResult { from: number; to: number; applied: string[] }
export async function runMigrations(db: Database.Database, o: { dir: string; clock: Clock;
  backup?: (from: number, to: number) => Promise<void> }): Promise<MigrationResult>;
```
Runner rules (F §6.8): files `NNNN_<name>.sql`, sequential with no gap (else throw); applied version = `PRAGMA user_version`; checksums kept in a runner-owned table created on first run: `CREATE TABLE IF NOT EXISTS migration_checksums (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)` (`applied_at` = `o.clock.branchNow()`). On start, every applied file's SHA-256 must match its row, else throw `MigrationChecksumError`. If there are pending files and `user_version > 0`, call `backup(from, to)` once before the first. Each file runs in its own `db.transaction(...).immediate()` together with its checksum row and `PRAGMA user_version = N` (pragma inside the transaction is allowed for `user_version`). For a file whose first line is `-- migrate:foreign-keys-off`, set `PRAGMA foreign_keys = OFF` before the transaction, run `PRAGMA foreign_key_check` before commit (throw if rows), restore `ON` after.

- [ ] **Step 1: Write failing tests** (`[00 §10 #64]` is split: checksum part here, backup part in task 11 — so name these with §6.8):
```ts
it('[F §6.8] applies pending files in order and records checksums', …);   // user_version 2, 2 checksum rows
it('[F §6.8] refuses to start when an applied file changed', …);           // edit 0001_a.sql → rejects MigrationChecksumError
it('[F §6.8] calls backup once before the first pending file when user_version > 0', …);
it('[F §6.8] a failing file rolls back only itself', …);                    // 0002 has bad SQL → user_version stays 1
it('[F §6.8] openDb sets WAL and synchronous FULL', …);                    // pragma values: 'wal', 2
```
- [ ] **Step 2–4:** `pnpm vitest run apps/hub/test/db/migrate.int.test.ts` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 10 sqlite connection and migrations runner [spec §3.8, F §6.8]`

---

### Task 11: Encrypted pre-migration backup

**Files:** Create `apps/hub/src/db/pre-migrate-backup.ts`, `apps/hub/test/db/pre-migrate-backup.int.test.ts`.

**Interfaces:**
- Consumes: `encryptFile` (task 8), `runMigrations` `backup` option (task 10), `HubConfig` (task 9), `SecretGen` (task 6).
- Produces: `makePreMigrateBackup(o: { db: Database.Database; config: HubConfig; secrets: SecretGen }): (from: number, to: number) => Promise<void>`.
Behaviour (§3.8 step 1a, M21, §7.9): skip entirely (no-op) when the hub is not provisioned or has no `backup_encryption_key`. Plain copy via `db.backup(tmpPath)` into `config.data_dir`, then `encryptFile` to `<backup_dir>/pre-migrate-<from>-<to>.sqlite.enc`; if writing to `backup_dir` fails (missing, read-only), write to `<data_dir>/pre-migrate-<from>-<to>.sqlite.enc` instead; always delete the plain copy; if both fail, throw (migrations do not run).

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #64] pre-migration backup is encrypted and decrypts to the old user_version', …);
  // provisioned config with key; DB at user_version 1; run migrations with backup → file in backup_dir;
  // file starts with MAGIC; decryptFile → open → PRAGMA user_version === 1; no plain .sqlite left anywhere
it('[00 §7.9] backup_dir missing → falls back to data_dir (Review Focus 5)', …);
it('[00 §7.9] backup_dir and data_dir unwritable → throws and no migration is applied', …);
it('[00 §3.8] unprovisioned hub → no backup file, migrations still run', …);
```
- [ ] **Step 2–4:** `pnpm vitest run apps/hub/test/db/pre-migrate-backup.int.test.ts` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 11 encrypted pre-migration backup [spec §3.8, §7.9, M21]`

---

### Task 12: Migration 0001 — event store

**Files:** Create `apps/hub/src/db/migrations/0001_event_store.sql`, `apps/hub/test/db/event-store-schema.int.test.ts`, `apps/hub/test/helpers/db.ts`.

**Interfaces — Produces:** tables per §5.1 `0001`: foundation `events` (+ `events_branch_seq` unique, `events_stream`, triggers `events_no_update`, `events_no_delete`), `sync_cursor`, `hub_heartbeat`, `processed_commands` **with `device_id TEXT NOT NULL`** (M19) + `processed_commands_branch`, `projection_checkpoints`. Test helper `freshDb(): { db, path, cleanup() }` (temp dir, `openDb`, `runMigrations` on `apps/hub/src/db/migrations`, `fixedClock(T)`).

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #62] events UPDATE and DELETE raise', () => {
  insertEvent(db, …);
  expect(() => db.prepare('UPDATE events SET payload = ?').run('{}')).toThrow(/events are immutable/);
  expect(() => db.prepare('DELETE FROM events').run()).toThrow(/events are immutable/);
});
it('[00 §5.1] processed_commands requires device_id', () => { /* insert without device_id → throws NOT NULL */ });
it('[F §4.1] (branch_id, seq) is unique', () => {});
```
- [ ] **Step 2–4:** `pnpm vitest run apps/hub/test/db/event-store-schema.int.test.ts` → FAIL → write SQL → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 12 migration 0001 event store [spec §5.1, F §4.1]`

---

### Task 13: `appendEvents`

**Files:** Create `apps/hub/src/engine-host/append-events.ts`, `apps/hub/test/engine-host/append-events.int.test.ts`.

**Interfaces — Produces:**
```ts
export interface AppendCtx { clock: Clock; ids: IdGen; tenantId: string; branchId: string }
export function appendEvents(tx: Database.Database, drafts: EventDraft[], ctx: AppendCtx): PosEvent[];
```
Inside an open transaction only (assert `tx.inTransaction`, else throw). `seq` = `SELECT COALESCE(MAX(seq),0) FROM events WHERE branch_id = ?` + 1, +1 per draft; `event_id` from `ids`; `recorded_at` = `clock.branchNow()`; validates each with `PosEventSchema` + payload schema before insert; one prepared INSERT reused.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #63] seq is gap-free across 1 000 appends with forced rollbacks in between', () => {
  for (let i = 0; i < 1000; i++) {
    const tx = db.transaction(() => { appendEvents(db, [draft()], ctx); if (i % 7 === 0) throw new Error('rollback'); });
    try { tx.immediate(); } catch {}
  }
  const seqs = db.prepare('SELECT seq FROM events ORDER BY seq').pluck().all();
  expect(seqs).toEqual(seqs.map((_, i) => i + 1));
});
it('[F §4.1] appendEvents outside a transaction throws', …);
it('[F §4.1] an invalid payload throws and inserts nothing', …);
```
- [ ] **Step 2–4:** run file → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 13 appendEvents [spec §3.7, F §4.1]`

---

### Task 14: Projection registry, checkpoints, rebuild

**Files:** Create `apps/hub/src/projections/registry.ts`, `apps/hub/test/projections/registry.int.test.ts`.

**Interfaces — Produces:**
```ts
export interface Projection { name: string; eventTypes: string[];
  apply(tx: Database.Database, e: PosEvent): void; reset(tx: Database.Database): void }
export interface ProjectionRegistry { register(p: Projection): void;
  applyAll(tx: Database.Database, events: PosEvent[], branchId: string): void;   // + upserts projection_checkpoints(last_seq)
  rebuildStale(db: Database.Database, branchId: string): { rebuilt: string[] } }  // §3.8 step 4
export function createProjectionRegistry(): ProjectionRegistry;
```
`rebuildStale`: for each projection whose checkpoint < `MAX(seq)` (missing checkpoint = 0): in one immediate transaction, `reset`, then read events `ORDER BY seq` in pages of 1 000 through `parseEvent`, `apply` those with matching `eventTypes`, set checkpoint to `MAX(seq)`. `applyAll` updates the checkpoint of **every** registered projection to the last event's seq (a projection that ignores an event is still up to date).

- [ ] **Step 1: Write failing test.**
```ts
it('[00 §10 #67] checkpoint behind MAX(seq) → reset + replay gives the same rows as live application', …);
  // test projection "counter" counting SessionStarted per staff; apply 5 events live → snapshot rows;
  // set checkpoint to 2 and corrupt rows; rebuildStale → rows equal snapshot; rebuilt === ['counter']
it('[00 §3.8] up-to-date projections are not rebuilt', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 14 projection registry [spec §3.8, M17]`

---

### Task 15: Writer — commit-then-swap

**Files:** Create `apps/hub/src/engine-host/{state-holder,writer}.ts`, `apps/hub/test/engine-host/writer.int.test.ts`.

**Interfaces — Produces:**
```ts
export type Reducer<S> = (s: S, e: PosEvent) => S;
export interface StateHolder<S> { get(): Readonly<S>; setReducer(r: Reducer<S>): void; reducer(): Reducer<S>; swap(next: S): void }
export function createStateHolder<S>(initial: S): StateHolder<S>;       // default reducer: identity
export interface WriterTx { db: Database.Database; state: Readonly<unknown>; append(drafts: EventDraft[]): PosEvent[] }
export interface Writer { run<T>(fn: (tx: WriterTx) => T): { result: T; appended: PosEvent[] } }
export function createWriter(o: { db; clock; ids; tenantId; branchId; projections: ProjectionRegistry;
  state: StateHolder<unknown>; publish: (events: PosEvent[]) => void; afterCommit?: Array<() => void>;
  testHooks?: { beforeCommit?: () => void } }): Writer;
```
`run`: one `db.transaction(...).immediate()`: call `fn`, collect events from `append` (which calls `appendEvents` then `projections.applyAll`), compute `next = appended.reduce(reducer, state.get())`, call `testHooks.beforeCommit` last inside the transaction (a throw there rolls back). After the transaction returns: `state.swap(next)`, then `publish(appended)` if non-empty. Any throw → nothing swapped, nothing published, error rethrown. `appended` across multiple `append` calls in one `run` is concatenated in seq order.

- [ ] **Step 1: Write failing tests.**
```ts
it('[F D45] state swaps only after COMMIT and publish sees committed events', …);
it('[F D45] a throw in beforeCommit leaves state, events and publish untouched', …);
  // (the §10 #12 version of this, through the HTTP route, is in task 22)
it('[00 §3.7] two append calls in one run get consecutive seqs and one publish', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 15 writer commit-then-swap [spec §3.7, §4.2, F D45]`

---

### Task 16: Fastify server, error handler, request id, redaction

**Files:** Create `apps/hub/src/server.ts`, `apps/hub/test/helpers/test-hub.ts`, `apps/hub/test/helpers/log-capture.ts`, `apps/hub/test/server.int.test.ts`.

**Interfaces — Produces:**
```ts
export interface HubDeps { config: HubConfig; db: Database.Database; readDb: Database.Database; clock: Clock; ids: IdGen;
  secrets: SecretGen; writer: Writer; state: StateHolder<unknown>; projections: ProjectionRegistry;
  logStream?: NodeJS.WritableStream }
export function buildHubServer(deps: HubDeps): FastifyInstance;  // async-ready; registers ZodTypeProvider, error handler, request id
export const REDACT_PATHS: string[];   // pino redact, every secret in Global Constraints, as req.headers.* and *.<field>
// test helper
export interface TestHub { app: FastifyInstance; deps: HubDeps; clock: ReturnType<typeof fixedClock>; logs(): string; close(): Promise<void> }
export async function createTestHub(o?: { provisioned?: boolean; config?: Partial<HubConfig> }): Promise<TestHub>;
```
`createTestHub`: temp dir, `freshDb`, provisioned config (`tenant_id 'tenant-a'`, `branch_id 'branch-1'`, random api key, `backup_encryption_key`), `fixedClock(T)`, `testIdGen()`, `testSecrets()`, logs captured to an in-memory stream. Error handler: `DomainError` → `{ error: { code, message: code, details, request_id } }` with `statusOf(code)`; Zod/Fastify validation → `VALIDATION_FAILED` with `details.issues: [{ path, message }]`; 404 handler → `ROUTE_NOT_FOUND`; anything else → `INTERNAL_ERROR` (logged with stack, never in the body). `request_id` = `ids.next()`, also on every log line. Do not log bodies.

- [ ] **Step 1: Write failing tests.**
```ts
it('[F §6.1] DomainError maps to the envelope and status', …);   // test route throws DomainError('STAFF_NOT_FOUND', {staff_id:'x'})
it('[F §6.1] unknown errors become INTERNAL_ERROR without a stack in the body', …);
it('[F §6.1] unknown route → 404 ROUTE_NOT_FOUND envelope', …);
it('[F §6.1] Zod failure → 400 VALIDATION_FAILED with details.issues', …);
it('[00 §7.2] authorization and x-session-token headers are redacted in logs', …);
```
- [ ] **Step 2–4:** `pnpm vitest run apps/hub/test/server.int.test.ts` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 16 hub server and error handler [spec §7.1, §7.2, F §6.1]`

---

### Task 17: Migrations 0002 and 0003

**Files:** Create `apps/hub/src/db/migrations/0002_devices_sessions.sql`, `apps/hub/src/db/migrations/0003_staff_directory.sql`, `apps/hub/test/db/access-schema.int.test.ts`.

**Interfaces — Produces:** tables exactly as spec §5.1 v0.5 (`devices` with `station_id`, `owner_staff_id` and both CHECKs; `pairing_tokens` same; `staff_sessions` with 4 CHECKs, `staff_sessions_active_device` partial unique on `(device_id) WHERE ended_at IS NULL AND kind IN ('staff','station')`, `staff_sessions_active`; `auth_lockouts` + `auth_lockouts_locked`; directory cache tables with `grant_type`).

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §5.1, M6] a second active session on one device violates the unique index', …);
it('[00 §5.1] an ended session does not block a new one on the same device', …);
it('[00 §5.1] kds device without station_id and phone without owner_staff_id are rejected', …);
it('[00 §5.1] station session with staff_id or idle_ttl_ms is rejected', …);
it('[00 §5.1] admin session with a device_id is rejected', …);
```
- [ ] **Step 2–4:** run → FAIL → SQL → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 17 migrations 0002 and 0003 [spec §5.1]`

---

### Task 18: `StaffDirectory` and `resolve`

**Files:** Create `packages/events/src/directory.ts`, `apps/hub/src/auth/staff-directory.ts`, `apps/hub/src/auth/staff-directory.test.ts`, `apps/hub/test/helpers/fixtures.ts`; Modify `packages/events/src/index.ts`.

**Interfaces — Produces:**
```ts
// packages/events/src/directory.ts — shared by hub (this task) and cloud (task 32)
export const DirectorySchema: z.ZodObject<…>;   // the shape below; pin_hash z.string(), ids z.string()
export type DirectoryInput = z.infer<typeof DirectorySchema>;
// shape:
interface DirectoryShape { directory_version: number;
  staff: Array<{ staff_id; display_name; pin_hash; role_ids: string[]; denied_permissions: string[] }>;
  roles: Array<{ role_id; name; session_idle_ttl_ms: number;
    permissions: Array<{ permission; grant_type: GrantType; approver_role_id: string | null }> }> }
export type Resolution = { grant: 'allowed' } | { grant: 'requires_approval'; approver_role_ids: string[] }
  | { grant: 'not_granted' } | { grant: 'denied' };
export class StaffDirectory {
  static fromInput(d: DirectoryInput): StaffDirectory;
  static load(db: Database.Database): StaffDirectory;           // 6 fixed SELECTs (§5.1)
  get version(): number;
  get(staffId: string): { staff_id; display_name; pin_hash; role_ids: string[] } | undefined;
  list(): Array<{ staff_id; display_name }>;                       // sorted by display_name
  resolve(staffId: string, p: Permission): Resolution;
  permissionsOf(staffId: string): Record<Permission, Resolution>;
  ttlFor(staffId: string): number;                                 // max over roles (M11)
}
// fixtures.ts (tests only)
export const PIN = { a: '1234', b: '0123', c: '999999' };
export async function pinHash(pin: string): Promise<string>;        // @node-rs/argon2 hash, argon2id m=19456 t=2 p=1, memoised
export async function aDirectory(o?: Partial<…>): Promise<DirectoryInput>;
  // staff: owner 'S-OWNER' (role R-OWNER all permissions, ttl 3 600 000), manager 'S-MGR' (R-MGR: all but manage-roles, 3 600 000),
  // cashier 'S-CASH' (R-CASH: apply-discount requires_approval R-MGR, reprint-ticket allowed, 1 800 000),
  // waiter 'S-WAIT' (R-WAIT: nothing, 300 000); ULID-shaped ids exported as constants
```
- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #78] resolve truth table', () => {
  // denial beats allowed; allowed beats requires_approval; requires_approval beats none;
  // two roles requiring approval from R-MGR and R-OWNER → approver_role_ids ['R-MGR','R-OWNER'] (sorted, deduped);
  // no grant → not_granted; unknown staff → not_granted
});
it('[00 §3.1 M11] ttlFor is the max across roles', …);
it('[00 §5.1] load() reads what fromInput describes (round trip through tables)', …);  // uses applyStaffDirectory? no: insert rows directly in the test
```
- [ ] **Step 2–4:** `pnpm vitest run apps/hub/src/auth/staff-directory.test.ts` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 18 staff directory and resolve [spec §3.6, M10, M11, M18]`

---

### Task 19: `applyStaffDirectory`

**Files:** Create `apps/hub/src/auth/apply-directory.ts`, `apps/hub/src/auth/session-store.ts`, `apps/hub/test/auth/apply-directory.int.test.ts`.

**Interfaces:**
- Consumes: `StaffDirectory` (18), `WriterTx` (15), events (5).
- Produces:
```ts
// session-store.ts — the only code that ends sessions or revokes devices
export function endSession(tx: WriterTx, s: { session_id; kind; staff_id; station_id; device_id },
  reason: SessionEndReason, endedBy: string | null, actorId: string | null, deviceIdForEvent: string): void;
  // UPDATE staff_sessions SET ended_at, end_reason, ended_by; append SessionEnded (stream staff/staff_id or station/station_id)
export function revokeDevice(tx: WriterTx, deviceId: string, o: { reason: string | null; cause: 'manual' | 'owner_removed';
  actorId: string | null; eventDeviceId: string }): void;     // sets revoked_at/by, ends active session 'device_revoked', appends DeviceRevoked
export function activeSessionsOf(tx: WriterTx, where: { staffId?: string; deviceId?: string }): SessionRow[];
// apply-directory.ts
export class DirectoryInvalidError extends Error {}
export function applyStaffDirectory(tx: WriterTx, d: DirectoryInput, onCommit: (dir: StaffDirectory) => void): void;
```
`applyStaffDirectory` (§4.2, M8, M38): validate first, throwing `DirectoryInvalidError` (nothing written) when: a `pin_hash` is not `$argon2id$v=19$m=…,t=…,p=…$…` or `m < 19456`, `t < 2`, `p ≠ 1`; a `role_ids` or `approver_role_id` names a role missing from `roles`; a permission is not in the catalogue. Then delete all cache rows and insert the new ones; `removed = old staff ids − new`; for each removed staff: `endSession(…, 'staff_removed', null, null, 'hub')` for each active session, and `revokeDevice(…, { cause: 'owner_removed', reason: null, actorId: null, eventDeviceId: 'hub' })` for each non-revoked `phone` they own; upsert `staff_directory_meta`; append `StaffDirectoryApplied { directory_version, staff_count, role_count, removed_staff_ids }` (actor null, device 'hub'). Register `onCommit` in the writer's `afterCommit` so the in-memory directory swaps only after COMMIT.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #70] removing a staff member ends their sessions staff_removed; permission changes apply on the next read', …);
it('[00 §10 #83] removing the owner revokes their phones in the same transaction; other devices untouched', …);
  // DeviceRevoked { cause: 'owner_removed' }, actor_id null; phone session ended; tablet of another staff untouched
  // (socket close 4403 is asserted in task 44)
it('[00 §3.1 M8] a weak pin_hash rejects the whole directory', …);
it('[00 §4.2] approver_role_id not in the directory rejects the whole directory; old directory stays (Review Focus 4)', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 19 applyStaffDirectory [spec §4.2, M8, M38]`

---

### Task 20: Route guards — provisioned, guest network, client version, inventory

**Files:** Create `apps/hub/src/auth/guards.ts`, `apps/hub/test/auth/guards.int.test.ts`; Modify `apps/hub/src/server.ts` (register the `onRoute` hook).

**Interfaces — Produces:**
```ts
export type RouteGroup = 'health' | 'setup' | 'device' | 'device-session' | 'admin' | 'admin-public' | 'pair' | 'ws';
// every route declares config: { group: RouteGroup }; the onRoute hook attaches preHandlers by group (§3.9 table)
export function guardsFor(group: RouteGroup): string[];   // names, e.g. ['provisioned','guest','version','device']
export function listRouteGuards(app: FastifyInstance): Array<{ method; url; group; guards: string[] }>;
```
This task implements `provisioned`, `guest` (via `createNetMatcher(config.guest_network_cidrs)`, request ip `req.ip`), `version` (semver compare `X-Client-Version` < `min_client_version` → 426; absent passes). A route without `config.group` makes `app.ready()` throw. Task 21 adds `device`, `session`, `admin`.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #72] every route has its guard set; an unguarded route fails', …);
  // listRouteGuards matches guardsFor(group) for each route; adding a test route without group → ready() rejects
it('[00 §3.9] guest network → 403 on device routes but not on /health', …);
it('[00 §3.9] X-Client-Version below min → 426; absent → passes', …);
it('[00 §10 #21] other routes before provisioning → 409 HUB_NOT_PROVISIONED', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 20 route guards part 1 [spec §3.9]`

---

### Task 21: Route guards — device token, device session, admin session

**Files:** Modify `apps/hub/src/auth/guards.ts`, `apps/hub/src/auth/session-store.ts`; Create `apps/hub/test/auth/guards-auth.int.test.ts`; Modify `apps/hub/test/helpers/test-hub.ts` (add helpers below).

**Interfaces — Produces:**
```ts
// request decorations
req.device?: { device_id; device_type: DeviceType; station_id: string|null; owner_staff_id: string|null };
req.session?: SessionRow;                  // kind, staff_id, station_id, device_id, session_id
// session-store.ts additions
export function findSessionByToken(db, token: string): SessionRow | undefined;   // sha256 lookup, ended rows included
export const activity: { touch(sessionId: string, at: number): void; get(sessionId): number | undefined;
  drain(): Array<[string, number]>; deviceSeen(deviceId: string, at: number): void; drainDevices(): Array<[string, number]> };
// test-hub helpers
export function seedDirectory(h: TestHub, d?: DirectoryInput): Promise<void>;
export function pairDevice(h: TestHub, o: { type: DeviceType; stationId?: string; ownerStaffId?: string }): { deviceId: string; token: string };
export function openSession(h: TestHub, o: { kind: SessionKind; staffId?: string; deviceId?: string; stationId?: string }): { sessionId: string; token: string };
export function endSessionNow(h: TestHub, sessionId: string, reason?: SessionEndReason): void;
```
Rules (§3.9): device: `Authorization: Bearer` → sha256 lookup → missing `401 DEVICE_TOKEN_INVALID`, revoked `403 DEVICE_REVOKED`. Session (`device-session` group): `X-Session-Token` → unknown `401 SESSION_INVALID`, other device `401 SESSION_INVALID`, ended `401 SESSION_EXPIRED`; groups may opt into `allowEnded` (logout) and `allowStation`. Admin: `X-Admin-Session` → missing/unknown/ended/not admin kind → `401 ADMIN_SESSION_REQUIRED`. Every accepted session calls `activity.touch(session_id, branchNow)`; every accepted device `activity.deviceSeen`.

- [ ] **Step 1: Write failing tests** (named `[00 §3.9] …`): bad bearer → 401; revoked device → 403; session of another device → 401 `SESSION_INVALID`; ended → 401 `SESSION_EXPIRED`; station session rejected where `allowStation` is false; admin header missing → 401; accepted session updates `activity`.
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 21 route guards part 2 [spec §3.9, M5]`

---

### Task 22: Command registry and generic command route

**Files:** Create `apps/hub/src/commands/{registry,route}.ts`, `apps/hub/test/commands/route.int.test.ts`; Modify `apps/hub/src/server.ts` (mount routes).

**Interfaces — Produces:**
```ts
export interface CommandCtx { tx: WriterTx; state: Readonly<unknown>; clock: Clock; ids: IdGen; secrets: SecretGen;
  actor: { kind: SessionKind; staffId: string | null; stationId: string | null; sessionId: string; deviceId: string };
  permission: Resolution | null; branch: { tenantId: string; branchId: string }; directory: StaffDirectory;
  config: HubConfig }
export interface CommandDef<P extends z.ZodTypeAny> { commandType: string; payloadSchema: P;
  sessionKind: 'device' | 'admin'; permission: Permission | null; approvable?: boolean; stationScoped?: boolean;
  handle(ctx: CommandCtx, payload: z.infer<P>, cmd: PosCommand): { events: EventDraft[]; result: unknown } }
export function defineCommand<P extends z.ZodTypeAny>(d: CommandDef<P>): CommandDef<P>;
export function createCommandRegistry(): { register(d: CommandDef<any>): void; byPath(name: string): CommandDef<any> | undefined };
  // register: assertKnownPermissions; kebab(commandType) is the path; duplicate → throw
export function toKebab(commandType: string): string;      // 'GenerateDevicePairingToken' → 'generate-device-pairing-token'
```
Route `POST /commands/:name` (group `device`) and `POST /admin/commands/:name` (group `admin`): §3.7 **without** the M19 session-less replay (task 23 adds it; in this task the device session is required before anything). Order: registry lookup (404) → `PosCommandSchema` + kebab match (400) → `branch_id` (403 `BRANCH_MISMATCH`) → session → `actor_id` equals session `staff_id` (null for station) (400) → payload schema (400) → kind/permission (§3.6; 403 `PERMISSION_DENIED` with `details { permission, grant }` or `{ permission, session_kind: 'station' }`) → `writer.run`: `handle`, `tx.append(events)`, INSERT `processed_commands { command_id, branch_id, device_id (caller or 'hub-admin'), response_json: JSON.stringify({ status: 200, body }), recorded_at }` → respond `200 { data: { command_id, event_ids, result } }`.

Test commands registered only in tests: `TestNoop` (permission `reprint-ticket`, emits one `TestNooped` event defined in the test file with `defineEvent`, stream `hub`), `TestApprovable` (`apply-discount`, `approvable: true`, returns `ctx.permission`), `TestStation` (`stationScoped: true`, permission null), `TestFails` (throws `DomainError('STAFF_NOT_FOUND')`).

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #1] happy path writes 1 event and 1 processed_commands row with device_id', …);
it('[00 §10 #6] name ≠ command_type → 400; unknown name → 404', …);
it('[00 §10 #7] branch_id ≠ config → 403 BRANCH_MISMATCH', …);
it('[00 §10 #8] actor_id ≠ session staff → 400', …);
it('[00 §10 #9] not_granted, denied override, non-approvable requires_approval → 403; approvable → approver roles', …);
it('[00 §10 #10] station session: non-stationScoped → 403 session_kind station; stationScoped → 200 actor_id null', …);
it('[00 §10 #11] DomainError → envelope, no rows, retransmit evaluated again', …);
it('[00 §10 #12] forced COMMIT failure → state unchanged, nothing published', …);  // testHooks.beforeCommit throws
```
- [ ] **Step 2–4:** `pnpm vitest run apps/hub/test/commands/route.int.test.ts` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 22 command registry and route [spec §3.7, §6.1]`

---

### Task 23: Idempotency and replay without a session (D32, M19, M34)

**Files:** Modify `apps/hub/src/commands/route.ts`; Create `apps/hub/test/commands/idempotency.int.test.ts`.

**Interfaces:** Consumes task 22. Change the order to §3.7 exactly: after the `branch_id` check and **before** the session check, `SELECT device_id, response_json FROM processed_commands WHERE command_id = ?`: same device (`'hub-admin'` on admin routes) → reply stored `status`/`body` with `Idempotent-Replay: true`; other device → `400 VALIDATION_FAILED` (`issues: [{ path: 'command_id', message: 'command_id already used' }]`). Inside `writer.run`, repeat the lookup first; a hit throws an internal `ReplayHit(row)` that the route catches after rollback and turns into the stored reply.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #2] retransmit, same device, valid session → identical body, Idempotent-Replay, no new rows', …);
it('[00 §10 #3] retransmit after the session ended → stored response replayed', …);
it('[00 §10 #4] retransmit from another device → 400, nothing replayed', …);
it('[00 §10 #5] new command_id after the session ended → 401 SESSION_EXPIRED', …);
it('[00 §10 #58] two concurrent retransmits of one new command → one set of events, same body', …);
  // fire both inject() calls without awaiting in between; Promise.all; count events = 1; bodies equal
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 23 idempotent replay without session [spec §3.7, M19, M34, F D32]`

---

### Task 24: Query registry and generic query route

**Files:** Create `apps/hub/src/queries/registry.ts`, `apps/hub/test/queries/route.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces — Produces:**
```ts
export interface QueryCtx { db: Database.Database /* read-only */; state: Readonly<unknown>; clock: Clock;
  directory: StaffDirectory; device?: DeviceRow; session?: SessionRow; config: HubConfig }
export interface QueryDef<Q extends z.ZodTypeAny> { resource: string; sessionKind: 'device' | 'admin';
  session: 'required' | 'none'; allowStation?: boolean; deviceTypes?: DeviceType[]; querySchema: Q;
  handle(ctx: QueryCtx, q: z.infer<Q>): { data: unknown; meta?: { next_cursor: string | null } } }
export function defineQuery<Q extends z.ZodTypeAny>(d: QueryDef<Q>): QueryDef<Q>;
export function createQueryRegistry(): { register(d: QueryDef<any>): void; get(resource: string, admin: boolean): QueryDef<any> | undefined };
export const pageParams: z.ZodObject<{ cursor: z.ZodOptional<z.ZodString>; limit: z.ZodDefault<…> }>; // default 50, max 200
```
`deviceTypes` set → other device types get `403 DEVICE_TYPE_NOT_ALLOWED { device_type, allowed }`.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #13] a query makes no writes and refreshes in-memory activity', …);  // db.prepare('select total_changes()') before/after equal
it('[00 §6.2] limit above 200 → 400', …);
it('[00 §6.2] deviceTypes restriction → 403 DEVICE_TYPE_NOT_ALLOWED', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 24 query registry and route [spec §6.2]`

---

### Task 25: Boot orchestrator and clock guard

**Files:** Create `apps/hub/src/lib/boot.ts`, `apps/hub/test/boot/boot.int.test.ts`; Modify `apps/hub/src/main.ts`.

**Interfaces — Produces:**
```ts
export type BootStepId = '0'|'1'|'1a'|'2'|'3'|'3a'|'4'|'4a'|'4b'|'5'|'6'|'7'|'8';
export interface BootCtx { config: HubConfig; db?: Database.Database; clock?: Clock; counts: { events_replayed: number; missed_fires: number };
  setStep(id: BootStepId): void }
export function registerBootStep(step: '2'|'3'|'5'|'6', run: (ctx: BootCtx) => void | Promise<void>): void;
export async function boot(o: { configPath: string; wallNow: () => number; monoNow: () => number;
  listen?: boolean }): Promise<{ deps: HubDeps; app: FastifyInstance; step(): BootStepId; stop(): Promise<void> }>;
```
Order §3.8. This task implements steps 0, 1, 1a (with task 11's backup), 3a (`createBranchClock` with `MAX(recorded_at)`; on alarm append `ClockAlarm { …, source: 'boot' }` in its own `writer.run` as the first write), 4 (`projections.rebuildStale`), 4a (`StaffDirectory.load`), 7 (build server; listen only if `listen`). Steps 4b, 8 and timers come in tasks 26 and 40. Unprovisioned → steps 0, 1, 1a, then 7 in setup mode. `main.ts` calls `boot({ configPath: process.env.POS_HUB_CONFIG ?? DEFAULT_CONFIG_PATH, wallNow: Date.now, monoNow: () => performance.now(), listen: true })` and exits 1 on error (this file is allowed to read the real clock).

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #66] wall ≤ max recorded_at → ClockAlarm written first, branchNow starts at max + 1', …);
it('[00 §3.8] registered steps run in order between the built-in ones', …);   // record order of 2, 3, 5, 6 stubs
it('[00 §3.8] unprovisioned → setup mode: only /health and /setup routes answer', …);
it('[00 §3.10] invalid config → boot rejects with ConfigError (Review Focus 3, boot path)', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 25 boot orchestrator and clock guard [spec §3.8, F §5.8, D48]`

---

### Task 26: `/health`, heartbeat, `HubStarted`

**Files:** Create `apps/hub/src/lib/health.ts`, `apps/hub/test/boot/health.int.test.ts`; Modify `apps/hub/src/lib/boot.ts`.

**Interfaces — Produces:** `GET /health` (group `health`) → `{ data: { status: 'booting'|'setup'|'ready', boot_step, provisioned, branch_id|null, max_seq|null, hub_version, clock_alarm: boolean } }`; `startHeartbeat(db, clock, branchId): () => void` (upsert every 60 000 ms); step 8 appends `HubStarted { hub_down_at: last_beat|null (read before the first beat), hub_up_at: branchNow, events_replayed, missed_fires, boot_ms }` (actor null, device 'hub').

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #14] /health in setup, booting and ready; no guest-network guard', …);
it('[00 §10 #71] HubStarted carries hub_down_at from hub_heartbeat; null on first boot', …);
it('[F §5.8, D41] heartbeat upserts every 60 s', …);  // fake timers
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 26 health, heartbeat, HubStarted [spec §6.3, §3.8, D41]`

---

### Task 27: Cloud skeleton, env, migrations, schema 0001

**Files:** Create `docker-compose.yml` (service `postgres: image postgres:16`, port 5433, db `pos_test`), `apps/cloud/src/server.ts`, `apps/cloud/src/lib/env.ts`, `apps/cloud/src/db/{client,migrate}.ts`, `apps/cloud/src/db/migrations/0001_platform.sql`, `apps/cloud/src/plugins/error-handler.ts`, `apps/cloud/src/lib/{clock,ids,secrets}.ts`, `apps/cloud/test/helpers/{global-setup,test-cloud}.ts`, `apps/cloud/test/schema.int.test.ts`; Modify `apps/cloud/vitest.config.ts` (globalSetup), `apps/cloud/src/main.ts`.

**Interfaces — Produces:**
```ts
export const CloudEnvSchema: z.ZodObject<{ DATABASE_URL; JWT_SECRET /* min 32 chars */; PORT; HUB_MIN_VERSION }>;
export function createPool(url: string): pg.Pool;       // only importable inside apps/cloud/src/db/ (lint, task 1)
export async function migrate(pool: pg.Pool, dir: string, clock: Clock): Promise<string[]>; // schema_migrations, checksum, per-file txn, '-- migrate:no-transaction'
export function buildCloudServer(d: { pool: pg.Pool; env: CloudEnv; clock: Clock; ids: IdGen; secrets: SecretGen }): FastifyInstance;
// test-cloud.ts
export async function createTestCloud(): Promise<{ app; pool; clock; close() }>; // TEST_DATABASE_URL (default postgres://postgres:postgres@localhost:5433/pos_test)
export async function truncateAll(pool): Promise<void>;
```
Global setup runs `migrate` once per run. Error handler mirrors hub task 16 (same envelope; `SERVICE_UNAVAILABLE` on pg connection errors). Lib files mirror hub `clock` (cloud: `systemClock` + `fixedClock`), `ids`, `secrets`.

- [ ] **Step 1: Write failing tests** `[00 §5.2] …`: all tables exist; `branch_api_keys_one_active` rejects a second live key per branch; `role_permissions` CHECK rejects `requires_approval` without approver; checksum change → `migrate` throws.
- [ ] **Step 2: Run** `docker compose up -d postgres && pnpm vitest run apps/cloud/test/schema.int.test.ts` → FAIL.
- [ ] **Step 3: Implement.** **Step 4:** run → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 27 cloud skeleton and schema [spec §5.2, §7.7, F §6.8]`

---

### Task 28: Cloud repositories and credential lookup

**Files:** Create `apps/cloud/src/db/{tenant-scoped-repository,tenant-level-repository,credential-lookup}.ts`, `apps/cloud/test/db/repositories.int.test.ts`.

**Interfaces — Produces:**
```ts
export interface TenantContext { readonly tenantId: string; readonly branchIds: readonly string[] } // Object.freeze
export abstract class TenantScopedRepository { constructor(ctx: TenantContext, pool: pg.Pool);
  protected query<R>(sql: string, params: unknown[]): Promise<R[]>; }   // prepends params $1 tenant_id, $2 branch_ids; sql must reference both, else throw
export abstract class TenantLevelRepository { constructor(ctx: TenantContext, pool: pg.Pool);
  protected query<R>(sql: string, params: unknown[]): Promise<R[]>; }   // prepends $1 tenant_id; sql must reference "tenant_id = $1"
export const credentialLookup: {
  ownerByEmail(pool, email: string): Promise<OwnerRow | undefined>;
  refreshTokenByHash(client, hash: string, forUpdate: boolean): Promise<RefreshRow | undefined>;
  branchByApiKeyHash(pool, hash: string): Promise<{ tenant_id; branch_id } | undefined>;
  registrationCodeByHash(client, hash: string, forUpdate: boolean): Promise<CodeRow | undefined>;
};
```
Both repository constructors throw `TypeError('TenantContext required')` when `ctx` is missing or not frozen.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #75] both repository classes throw without a TenantContext', …);
it('[F §3.4] scoped query without tenant_id/branch_id placeholders throws', …);
it('[00 §5.2] credential lookups find rows across tenants by hash/email only', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 28 cloud repositories and credential lookup [spec M16, M25, F §3.4]`

---

### Task 29: Cloud tenant-scope plugin and route inventory

**Files:** Create `apps/cloud/src/plugins/tenant-scope.ts`, `apps/cloud/src/plugins/jwt.ts`, `apps/cloud/test/route-inventory.int.test.ts`; Modify `apps/cloud/src/server.ts`.

**Interfaces — Produces:** routes declare `config.tenantScope: 'jwt' | 'branch-key' | 'registration-code' | 'none'`; `'none'` allowed only for the allowlist `['POST /v1/auth/login', 'POST /v1/auth/refresh', 'GET /v1/health']` (exported `TENANT_SCOPE_ALLOWLIST`), else `app.ready()` throws. Root `onRoute` adds the preHandler. `jwt`: `@fastify/jwt` HS256 with `JWT_SECRET`; claims `{ sub, tenant_id, allowed_branch_ids }` → `TenantContext`; invalid → `401 JWT_INVALID`. `branch-key`: bearer → `sha256` → `branchByApiKeyHash` (non-revoked) → `401 BRANCH_API_KEY_INVALID`. `registration-code`: reads `body.registration_code`, normalises (uppercase, strip `-`/spaces), `sha256`, `registrationCodeByHash` → TenantContext `{ tenantId, branchIds: [branch_id] }`; unknown → `401 REGISTRATION_CODE_INVALID` (validity checks stay in the service, task 32). `req.tenant` is frozen.

- [ ] **Step 1: Write failing test.**
```ts
it('[00 §10 #76] every cloud route has a tenant scope; tenant-level routes included; none only for the allowlist', …);
  // collect via onRoute; add a test route without tenantScope → ready() rejects; add 'none' on a non-allowlisted path → rejects
```
plus `[F §3.4] bad JWT → 401 JWT_INVALID`.
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 29 tenant-scope plugin and route inventory [spec M15, M25, F §3.4]`

---

### Task 30: CLI `seed-tenant` and default roles

**Files:** Create `apps/cloud/src/modules/staff-roles/{default-roles,seed-tenant}.ts`, `apps/cloud/test/cli/seed-tenant.int.test.ts`; Modify `apps/cloud/package.json` (script `seed-tenant`: `tsx src/modules/staff-roles/seed-tenant.ts`; dev dep `tsx`).

**Interfaces — Produces:**
```ts
export const DEFAULT_ROLES: Array<{ key: 'owner'|'manager'|'cashier'|'order_taker'; name: string; is_admin_role: boolean;
  session_idle_ttl_ms: number; grants: Array<{ permission: Permission; grant_type: GrantType; approver?: 'manager' }> }>;
  // Owner: all PERMISSIONS allowed, admin, 3 600 000; Manager: all but manage-roles, 3 600 000;
  // Cashier: apply-discount requires_approval approver manager, reprint-ticket allowed, 1 800 000; Order taker: none, 300 000
export async function seedTenant(pool, o: { name; currency: string; ownerEmail; ownerName; password; pin },
  deps: { clock; ids; hash: (s: string) => Promise<string> }): Promise<{ tenant_id; user_id; staff_id }>;
```
CLI entry parses `--name --currency --owner-email --owner-name`, prompts twice each (no echo, `node:readline` with muted output) for password (8–200) and PIN (`/^\d{4,6}$/`), hashes with argon2id `{ memoryCost: 19456, timeCost: 2, parallelism: 1 }`. One transaction; duplicate email → throws `Error('owner email exists')`, exit 1.

- [ ] **Step 1: Write failing test.**
```ts
it('[00 §10 #56] seed creates the roles in the table; owner logs in to the cloud; duplicate email refused', …);
  // login part: call POST /v1/auth/login only after task 46 exists → in THIS task assert the stored password_hash
  // verifies with @node-rs/argon2 and the owner staff has the Owner role (which includes access-hub-admin, the hub side of #56);
  // task 46 adds the HTTP login assertion to this test file
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 30 seed-tenant and default roles [spec §6.26, M29]`

---

### Task 31: CLI `issue-registration-code`

**Files:** Create `apps/cloud/src/modules/hub-registration/issue-code.ts`, `apps/cloud/test/cli/issue-code.int.test.ts`; Modify `apps/cloud/package.json` (script).

**Interfaces — Produces:**
```ts
export function generateCode(secrets: SecretGen): string;      // 12 chars from '0123456789ABCDEFGHJKMNPQRSTVWXYZ', formatted XXXX-XXXX-XXXX
export function normaliseCode(input: string): string;          // uppercase, strip '-' and whitespace
export async function issueRegistrationCode(pool, o: { tenantId: string } & ({ branchName: string } | { branchId: string }),
  deps: { clock; ids; secrets }): Promise<{ code: string; branch_id: string; expires_at: number }>;
```
§6.27: new branch `pending_hub` + `staff_branches` for every staff holding an `is_admin_role` role; reissue only for `pending_hub` (else throw `Error('branch is not pending_hub')`) and set `expires_at = now` on its unconsumed codes. Store `sha256(normaliseCode(code))`, kind `new_branch`, `expires_at = now + 86 400 000`.

- [ ] **Step 1: Write failing test.**
```ts
it('[00 §10 #57] new branch + code; reissue for pending_hub expires the old code; reissue for active refused', …);
it('[00 §6.27] normaliseCode makes "abcd-efgh jkmn" equal to "ABCDEFGHJKMN"', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 31 issue-registration-code [spec §6.27, M22]`

---

### Task 32: Cloud `POST /v1/hubs/register`

**Files:** Create `apps/cloud/src/modules/hub-registration/{routes,service,repository,schemas}.ts`, `apps/cloud/test/hub-registration.int.test.ts`; Modify `apps/cloud/src/server.ts`.

**Interfaces — Produces:** route `tenantScope: 'registration-code'`; request/response schemas exactly §6.5; the response `directory` uses `DirectorySchema` from `@pos/events` (task 18). Service runs §6.5 steps 1–6 in one `BEGIN`…`COMMIT` with `FOR UPDATE`; key = `secrets.token256()`; log line `hub_registered { tenant_id, branch_id, kind, rotated }`.


- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #22] happy path: code consumed, branch active, one live key, directory has this branch\'s staff only', …);
it('[00 §10 #23] same Idempotency-Key within 1 h → new key, previous revoked', …);
it('[00 §10 #24] other key after consumption, expired code, unknown code → identical 401 bodies (except request_id)', …);
it('[00 §10 #25] replace_hub code with accepted_kinds [new_branch] → 422, code unconsumed', …);
it('[00 §10 #61] two concurrent registers with one code and different keys → one 200, one 401', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 32 hubs/register [spec §6.5, M14, M15]`

---

### Task 33: Hub `POST /setup/provision` and setup page

**Files:** Create `apps/hub/src/setup/{provision,cloud-client,page}.ts`, `apps/hub/test/helpers/stub-cloud.ts`, `apps/hub/test/setup/provision.int.test.ts`; Modify `apps/hub/src/server.ts`, `apps/hub/src/lib/boot.ts` (setup mode mounts these routes).

**Interfaces — Produces:**
```ts
export interface CloudClient { registerHub(body: { registration_code; hub_version; accepted_kinds: ['new_branch'] },
  idempotencyKey: string): Promise<RegisterResponse> }   // throws CloudUnreachableError | CloudError(status, code, details)
export function httpCloudClient(baseUrl: string, timeoutMs = 10_000): CloudClient;   // global fetch + AbortSignal.timeout
export function registerSetupRoutes(app, deps: HubDeps & { cloud: CloudClient; configPath: string; exit: (code: number) => void }): void;
// stub-cloud.ts: createStubCloud(behaviour) → CloudClient recording calls
```
Steps exactly §6.4 1–8; `exit(0)` is called in an `onResponse` hook (after the reply is flushed). Validation: `registration_code` 12 Crockford chars after `normaliseCode` (import the same rule; duplicate the 4-line function in `setup/provision.ts` — the hub must not import cloud code), `guest_network_cidrs` valid CIDRs (`BlockList.addSubnet` must not throw), `advertised_host` IPv4. `GET /setup` returns the static HTML page (form posting JSON; no external assets).

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #15] happy path: directory applied, HubProvisioned written, config has key + backup_encryption_key, exit(0) requested', …);
it('[00 §10 #16] after provisioning → 404', …);
it('[00 §10 #17] concurrent second call → 409 SETUP_IN_PROGRESS', …);
it('[00 §10 #18] cloud unreachable → 503 retry_after_ms 5000; cloud 401 and 422 passed through', …);
it('[00 §10 #19] weak pin_hash from cloud → 500, nothing written', …);
it('[00 §10 #20] crash after commit before config write; retry sends the same setup_attempt_id; one HubProvisioned', …);
  // simulate crash: deps.writeConfig throws once after the commit
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 33 setup provisioning [spec §6.4, §3.2, M13, M14]`

---

### Task 34: PIN verification and lockouts

**Files:** Create `apps/hub/src/auth/pin.ts`, `apps/hub/test/auth/pin.int.test.ts`.

**Interfaces — Produces:**
```ts
export type RateSubject = { type: 'device'; id: string } | { type: 'ip'; id: string };
export interface PinCheckDeps { db; writer: Writer; directory: () => StaffDirectory; clock: Clock; config: HubConfig;
  semaphore: Semaphore; verify: (hash: string, pin: string) => Promise<boolean> }
export async function checkPin<T>(deps: PinCheckDeps, o: { staffId: string; pin: string; subject: RateSubject;
  eventDeviceId: string }, onMatch: (tx: WriterTx) => T): Promise<T>;
```
§3.5 steps 2–9 exactly (step 1 guards are the route's). Thresholds from `config.auth`. On semaphore timeout throw `DomainError('SERVICE_UNAVAILABLE', { retry_after_ms: 1000 })`. Lock checks throw `PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT` with `retry_after_ms = locked_until − now`. Mismatch: commit counters and any lockout event, then throw `PIN_INVALID { attempts_remaining: max(0, pin_max_failures − failed_count) }`. The PIN is passed to `verify` as the string received (never `Number()`).

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #59] parallel wrong PINs cross the threshold while a correct PIN verifies → the correct one gets 429', …);
  // verify stub: correct PIN resolves after a manual gate; 5 wrong attempts complete first; open gate → PIN_LOCKED_OUT
it('[00 §3.5] 5th consecutive failure writes StaffPinLockedOut; success resets the staff counter only', …);
it('[00 §3.5] device window: failure after 300 000 ms restarts the count at 1', …);
it('[00 §3.5] PIN "0123" verifies against a hash of "0123" and not "123" (Review Focus 2)', …);  // real argon2
it('[00 §7.4] semaphore full for 2 s → SERVICE_UNAVAILABLE retry_after_ms 1000', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 34 PIN verification and lockouts [spec §3.5, M23]`

---

### Task 35: Admin auth, admin logout, admin login roster

**Files:** Create `apps/hub/src/auth/admin-session.ts`, `apps/hub/test/auth/admin-session.int.test.ts`; Modify `apps/hub/src/server.ts`, `apps/hub/src/auth/session-store.ts`.

**Interfaces — Produces:** `POST /admin/auth` (group `admin-public`), `POST /admin/auth/logout` (group `admin`, accepts ended), `GET /admin/login-roster` (group `admin-public`); bodies/responses exactly §6.6, §6.12, §6.13. `createSession(tx, o: { kind; staffId|null; stationId|null; deviceId|null; clientIp; idleTtlMs|null; eventDeviceId }): { sessionId; token }` added to `session-store.ts` (also used by tasks 38, 39). `server.ts` creates one `new Semaphore(config.auth.argon2_concurrency)` shared by `/admin/auth` and `/auth/pin`.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #26] happy path; staff without access-hub-admin → 403 and staff counter reset', …);
it('[00 §10 #27] 10 failures from one IP across staff → DEVICE_LOCKED_OUT, event subject_type ip', …);
it('[00 §10 #40] admin logout; repeat → already_ended true, one SessionEnded', …);
it('[00 §10 #41] login roster lists only access-hub-admin allowed, with locked_until', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 35 admin session and roster [spec §6.6, §6.12, §6.13, M7, M32]`

---

### Task 36: `GenerateDevicePairingToken` and station validator

**Files:** Create `apps/hub/src/commands/generate-device-pairing-token.ts`, `apps/hub/src/auth/station-validator.ts`, `apps/hub/test/commands/generate-pairing-token.int.test.ts`; Modify `apps/hub/src/server.ts` (register command).

**Interfaces — Produces:** `registerStationValidator(fn: (tx: Database.Database, stationId: string) => boolean): void`; `stationExists(tx, id): boolean` (false until registered). Command per §6.7 (payload Zod with `superRefine` for `station_id` iff `kds`, `owner_staff_id` iff `phone`); result `{ pairing_token, pairing_token_id, expires_at, pair_url }` with `pair_url = \`http://${config.advertised_host}:${config.http_port}/pair?t=${token}\``.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #28] tablet ok; kds valid station ok; kds without station 400; unknown station 404; no manage-devices 403; retransmit same token', …);
it('[00 §10 #80] phone: no owner 400; unknown owner 404; ok stores owner_staff_id on the token', …);
  // (the paired device having owner_staff_id is asserted in task 37)
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 36 pairing token command [spec §6.7, M31, M38]`

---

### Task 37: `POST /devices/pair` and pair page

**Files:** Create `apps/hub/src/auth/pairing.ts`, `apps/hub/src/auth/pair-page.ts`, `apps/hub/test/auth/pairing.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces — Produces:** `POST /devices/pair` (group `pair`) per §6.8 steps 1–4 (M14 rotation; phone owner re-check). `GET /pair` (group `pair`) serves a static HTML page implementing the §8.2 **pair page rules 1–4** in inline JS (no external assets): detects iOS Safari non-standalone (`/iPad|iPhone|iPod/.test(navigator.userAgent) && navigator.standalone !== true`) and then does not call the API; uses `crypto.getRandomValues` for `pair_request_id` (ULID encoding inline); stores `device_token` in IndexedDB; text via keys `pairing.ios_add_to_home`, `pairing.token_expired` with English fallbacks.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #29] happy path; expired → 401; used by another request → 401; device_type mismatch → 403', …);
it('[00 §10 #30] retry with same pair_request_id → new token works, old token 401, one DevicePaired', …);
it('[00 §10 #84] phone whose owner was removed after token generation → 401 PAIRING_TOKEN_INVALID', …);
it('[00 §8.2] pair page never calls /devices/pair when iOS non-standalone and never uses randomUUID', …);
  // static assertions on the served HTML: contains 'navigator.standalone', 'getRandomValues', not 'randomUUID', not 'serviceWorker'
```
also extend #80: paired phone has `owner_staff_id` (assert inside the #84 file's setup is fine; keep #80 in task 36).
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 37 device pairing and pair page [spec §6.8, §8.2, M14, M38]`

---

### Task 38: `POST /auth/pin` and `POST /auth/logout`

**Files:** Create `apps/hub/src/auth/staff-session.ts`, `apps/hub/test/auth/staff-session.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** Consumes `checkPin` (34), `createSession`, `endSession` (19, 35). Routes per §6.9 (group `device`, `deviceTypes: tablet|cashier_kiosk|phone`; phone owner check before `checkPin`) and §6.10 (group `device-session`, `allowEnded`). `ttlFor` from the directory; the partial-unique-index violation (`SQLITE_CONSTRAINT_UNIQUE` on `staff_sessions_active_device`) maps to `409 DEVICE_SESSION_ACTIVE`.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #31] happy path; wrong PIN 401 attempts_remaining; 5th failure StaffPinLockedOut; then correct PIN 429', …);
it('[00 §10 #32] 10 failures from one device across staff → DEVICE_LOCKED_OUT', …);
it('[00 §10 #33] same staff again → previous session ended replaced', …);
it('[00 §10 #34] other staff without takeover → 409 holder + can_take_over true; nothing written', …);
it('[00 §10 #35] other staff with takeover → holder SessionEnded taken_over with ended_by', …);
it('[00 §10 #36] kds → 403 DEVICE_TYPE_NOT_ALLOWED; guest IP → 403; old client → 426', …);
it('[00 §10 #37] semaphore full for 2 s → 503 retry_after_ms + Retry-After header', …);
it('[00 §10 #38] logout; repeat already_ended, one event; station session → 403', …);
it('[00 §10 #60] two logins for different staff on one device at once → one 200, one 409', …);
it('[00 §10 #81] phone: owner 200; other staff with correct PIN → 403 DEVICE_NOT_OWNED, no verify, no counter, no takeover', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 38 staff PIN session and logout [spec §6.9, §6.10, M6, M20, M38]`

---

### Task 39: `POST /auth/station`

**Files:** Create `apps/hub/src/auth/station-session.ts`, `apps/hub/test/auth/station-session.int.test.ts`; Modify `apps/hub/src/server.ts`.

- [ ] **Step 1: Write failing test.** `it('[00 §10 #39] happy path; second call replaces; tablet → 403', …)` — response `{ session_token, session_id, station_id }`; `SessionStarted` stream `station`/station_id with `idle_ttl_ms: null`.
- [ ] **Step 2–4:** run → FAIL → implement per §6.11 → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 39 station session [spec §6.11, M30]`

---

### Task 40: Session sweeper, boot reconciliation, retention

**Files:** Create `apps/hub/src/auth/session-sweeper.ts`, `apps/hub/test/auth/session-sweeper.int.test.ts`; Modify `apps/hub/src/lib/boot.ts` (step 4b; start sweeper at step 7).

**Interfaces — Produces:** `sweepOnce(deps): { ended: string[] }` (flush `activity.drain()` into `last_activity_at`, `drainDevices()` into `devices.last_seen_at`; end non-station sessions idle beyond `idle_ttl_ms` with `'idle_timeout'`; once per local day run §5.1 retention); `startSweeper(deps): () => void` (every 15 000 ms); `reconcileSessions(deps): number` (§3.4 boot reconciliation, `'hub_restored'`).

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #68] SessionStarted without SessionEnded and empty staff_sessions → SessionEnded hub_restored', …);
it('[00 §10 #69] idle staff and admin sessions end at ttl + ≤15 s; station never; multi-role TTL = max', …);
it('[00 §5.1] retention deletes ended sessions > 7 d, expired pairing tokens > 7 d, processed_commands > 7 d', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 40 session sweeper and reconciliation [spec §3.4, §5.1, §7.3]`

---

### Task 41: Admin commands — revoke device, force logout, clear lockout

**Files:** Create `apps/hub/src/commands/{revoke-device,force-logout-session,clear-pin-lockout}.ts`, `apps/hub/test/commands/admin-commands.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** each `defineCommand({ sessionKind: 'admin', … })` per §6.14–§6.16; use `revokeDevice` (cause `'manual'`) and `endSession` from `session-store.ts`. Socket closing is wired in task 44 (audiences); here assert events only.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #42] revoke ends session, writes DeviceRevoked manual; retransmit identical; already_revoked; unknown 404; no manage-devices 403', …);
it('[00 §10 #43] force logout staff/station/admin; ended_by; retransmit identical; already_ended; unknown 404; no manage-staff 403', …);
it('[00 §10 #44] clear staff/device/ip locks; retransmit identical; unlocked → cleared false, no event; no manage-staff 403', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 41 admin access commands [spec §6.14–§6.16]`

---

### Task 42: Access queries

**Files:** Create `apps/hub/src/queries/{devices,sessions,staff-roster,session}.ts`, `apps/hub/test/queries/access-queries.int.test.ts`, `apps/hub/test/helpers/statement-counter.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** shapes exactly §6.17–§6.20. `statement-counter.ts`: wraps a read-only `Database` so `prepare(...).all/get/run` calls are counted (`countStatements(db, fn): number`).

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #45] devices and sessions lists use 1 statement with 1 and 20 devices', …);
it('[00 §10 #46] roster shows active session and locks; 2 statements with 1 and 30 staff', …);
it('[00 §10 #47] session permissions equal resolve for every catalogue entry; station → {}', …);
it('[00 §10 #82] phone roster lists only the owner', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 42 access queries [spec §6.17–§6.20]`

---

### Task 43: WebSocket — auth frame and catch-up

**Files:** Create `apps/hub/src/ws/{server,catch-up}.ts`, `apps/hub/test/ws/ws-auth.int.test.ts`, `apps/hub/test/helpers/ws-client.ts`; Modify `apps/hub/src/server.ts`, `apps/hub/src/engine-host/writer.ts`.

**Interfaces — Produces:**
```ts
export interface SocketCtx { deviceId; deviceType: DeviceType; sessionId; kind: 'staff' | 'station'; staffId: string | null; stationId: string | null }
export function registerCatchUp(p: { part: string; appliesTo(s: SocketCtx): boolean; build(db: Database.Database, state: unknown): unknown }): void;
export interface WsHub { sockets(): Array<{ ctx: SocketCtx; send(m: WsServerMessage): void; close(code: number): void }> }
export function registerWs(app, deps): WsHub;    // GET /ws via @fastify/websocket, group 'ws'
```
§6.21 steps 1–4, M12, M24: nothing sent before auth; 5 000 ms timer; failures close with a code only; `as_of_seq` = last committed seq kept in memory by the writer's publish path (add `lastSeq(): number` to `Writer`); built-in part `hub: { clock_alarm, branch_name }` (M37). Query-string tokens are ignored. `ws-client.ts`: test client built on `ws` recording every frame and the close code.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #48] no frame before auth: wait 5.1 s → zero frames, close 4401', …);   // fake timers ok
it('[00 §10 #49] non-auth first frame, bad device, bad session, admin session → 4401 with zero frames; revoked → 4403', …);
it('[00 §10 #50] tokens in the query string are ignored', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 43 websocket auth and catch-up [spec §6.21, M12, M24, M37]`

---

### Task 44: WebSocket — publish, audiences, keepalive, closes

**Files:** Create `apps/hub/src/ws/audience.ts`, `apps/hub/test/ws/ws-publish.int.test.ts`; Modify `apps/hub/src/ws/server.ts`, `apps/hub/src/lib/boot.ts` (writer `publish` → WS).

**Interfaces — Produces:** `registerEventAudience(eventType: string, fn: (e: PosEvent, s: SocketCtx) => boolean): void`; built-in audiences (§4.2): `ClockAlarm` → all; `SessionEnded` → sockets with that `session_id`, then close `4401`; `DeviceRevoked` → that device's sockets, then close `4403`. Events with no audience are not sent. Ping every 15 000 ms; terminate after 30 000 ms without pong; pongs and acks do not touch session activity. Shutdown closes `1012`.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #51] catch-up as_of_seq then ascending events; an event committed during catch-up is delivered once; boot ClockAlarm shows in catch-up', …);
it('[00 §10 #52] SessionEnded then close 4401; no pong 30 s → terminated; pongs alone do not keep the session past its TTL', …);
it('[00 §4.2] DeviceRevoked (manual and owner_removed) delivered then close 4403', …);  // completes #42 and #83 socket parts
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 44 websocket publish and audiences [spec §6.21, §4.2]`

---

### Task 45: CORS and log-redaction sweep

**Files:** Modify `apps/hub/src/server.ts`; Create `apps/hub/test/cors.int.test.ts`, `apps/hub/test/log-redaction.int.test.ts`.

**Interfaces:** §7.5: for groups `device`, `device-session`, `pair` add `Access-Control-Allow-Origin: <origin>` when `origin ∈ config.cors_origins` (plus `Vary: Origin`); answer `OPTIONS` preflight with `Access-Control-Allow-Headers: Authorization, X-Session-Token, X-Client-Version, Content-Type` and `Access-Control-Allow-Methods: GET, POST`. Never on `admin`, `admin-public`, `setup`.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §7.5] allowed origin gets CORS headers and preflight; other origins and /admin get none', …);
it('[00 §10 #73] no secret used by the auth flows appears in captured logs', …);
  // run setup (stub cloud), admin auth, pairing token, pair, pin login, station login, logout in one TestHub;
  // collect every secret string sent or returned; assert none is a substring of hub.logs()
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 45 CORS and log redaction [spec §7.2, §7.5, M35]`

---

### Task 46: Cloud owner login

**Files:** Create `apps/cloud/src/modules/owner-auth/{routes,service,repository,schemas}.ts`, `apps/cloud/test/owner-auth/login.int.test.ts`; Modify `apps/cloud/src/server.ts`, `apps/cloud/test/cli/seed-tenant.int.test.ts` (add the HTTP login assertion to #56).

**Interfaces — Produces:** `POST /v1/auth/login` (`tenantScope: 'none'`) per §6.22 / M33; `issueTokens(client, user, deps): Promise<{ access_token; access_expires_at; refresh_token; refresh_expires_at }>` (also used by task 47). Unknown email verifies against a module-level dummy hash created once at startup.

- [ ] **Step 1: Write failing test.**
```ts
it('[00 §10 #53] login ok; wrong password and unknown email both 401 within 2× timing; 10 failures → 429', …);
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 46 owner login [spec §6.22, M33]`

---

### Task 47: Cloud refresh and logout

**Files:** Modify `apps/cloud/src/modules/owner-auth/{routes,service,repository,schemas}.ts`; Create `apps/cloud/test/owner-auth/refresh.int.test.ts`.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §10 #54] refresh rotates; reused rotated token → 401 and all user tokens revoked; concurrent refresh → one 200, one 401', …);
it('[00 §10 #55] logout revokes own token; another user\'s token → revoked false and still valid', …);
```
- [ ] **Step 2–4:** run → FAIL → implement §6.23–§6.24 → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 47 owner refresh and logout [spec §6.23, §6.24, M33]`

---

### Task 48: Cloud health and cross-tenant suite

**Files:** Create `apps/cloud/src/modules/health/routes.ts`, `apps/cloud/test/cross-tenant.int.test.ts`; Modify `apps/cloud/src/server.ts`.

- [ ] **Step 1: Write failing tests.**
```ts
it('[00 §6.25] /v1/health ok; db down → 503', …);
it('[00 §10 #77] every scoped route with tenant A credentials returns no tenant B row', …);
  // seed tenants A and B (seedTenant + issueRegistrationCode for each); for every route in the route inventory
  // whose scope is jwt or branch-key, call it with A's credentials and assert no B tenant_id/branch_id/staff_id appears in the body
```
- [ ] **Step 2–4:** run → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 48 cloud health and cross-tenant tests [spec §6.25, M25, F §3.4]`

---

### Task 49: systemd unit and hardware smoke test

**Files:** Create `apps/hub/deploy/hub.service`, `apps/hub/test/smoke/smoke.ts`, `apps/hub/test/smoke/README.md`; Modify `apps/hub/package.json` (script `smoke`: `tsx test/smoke/smoke.ts`).

**Interfaces:** `hub.service`: `Type=simple`, `ExecStart=/usr/bin/node /opt/pos-hub/apps/hub/dist/main.js`, `Restart=always`, `RestartSec=1`, `After=time-sync.target network-online.target`, `Wants=time-sync.target network-online.target`, `User=poshub`, `Environment=POS_HUB_CONFIG=/etc/pos-hub/config.json`. `smoke.ts` (run by a person on the hub, not in CI): boots against a temp config, measures `/auth/pin` p95 over 50 logins, no-op command overhead p95 over 1 000 commands, and 00's boot steps; prints a table against §7.8 targets and exits 1 if any target is missed.

- [ ] **Step 1: Write** `smoke.ts` so that it prints `[00 §10 #79] …` lines per target. (No Vitest test; this is the #79 test.)
- [ ] **Step 2: Run** `pnpm --filter @pos/hub smoke` on a dev machine → prints the table (targets may pass or fail there; the binding run is on the pilot hub).
- [ ] **Step 3: Commit** `feat(00): task 49 systemd unit and smoke test [spec §7.8, M13, M36]`

**Done when:** `systemd-analyze verify apps/hub/deploy/hub.service` reports no errors (on a Linux machine with systemd).

---

### Task 50: Append error codes to the foundation and mark 00 implemented — **NOT for Cursor**

Done by the spec owner (Claude or the user), because Cursor must never edit `docs/specs/`.

- [ ] Append the §9 codes to foundation §6.2 (the one allowed foundation edit, D64).
- [ ] Update `docs/specs/README.md`: 00 status → Implemented.
- [ ] Commit `docs(00): append error codes, mark 00 implemented [spec §9, D64]`.

---

## Coverage check (spec §10 → task)

| Tests | Task |
|---|---|
| 1, 6–12 | 22 |
| 2–5, 58 | 23 |
| 13 | 24 |
| 14, 71 | 26 |
| 15–21 | 33 (21 in 20) |
| 22–25, 61 | 32 |
| 26, 27, 40, 41 | 35 |
| 28, 80 | 36 |
| 29, 30, 84 | 37 |
| 31–38, 60, 81 | 38 |
| 39 | 39 |
| 42–44 | 41 |
| 45–47, 82 | 42 |
| 48–50 | 43 |
| 51, 52 | 44 |
| 53 | 46 |
| 54, 55 | 47 |
| 56 | 30 (+46) |
| 57 | 31 |
| 59 | 34 |
| 62 | 12 |
| 63 | 13 |
| 64 | 11 (checksum part in 10) |
| 65 | 8 |
| 66 | 25 |
| 67 | 14 |
| 68, 69 | 40 |
| 70, 83 | 19 (socket part in 44) |
| 72 | 20 |
| 73 | 45 |
| 74 | 3 |
| 75 | 28 |
| 76 | 29 |
| 77 | 48 |
| 78 | 18 |
| 79 | 49 |
