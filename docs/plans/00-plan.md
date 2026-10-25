# 00 Hub Platform & Access — Implementation Plan (spec v1.0)

> **For the implementer (Cursor, no plugins):** follow `.cursor/rules/pos.mdc`. Do **one task per request**, in order. Each task: write the listed tests first, run them and see them fail, implement, run them and the full suite, commit. Steps use checkboxes (`- [ ]`); do **not** tick them in this file (it is read-only for you).

**Goal:** Build module 00: the hub platform (event store, migrations, command/query registries, commit-then-swap writer with in-transaction auth re-check, boot with forward catch-up), hub access (setup + first-admin bootstrap, confirmation, pairing by token and by screen request, staff/admin/station sessions, lockouts, permissions, WebSocket) and the minimum cloud access (tenant guard, owner auth, hub registration and confirmation, CLIs).

**Architecture:** pnpm + Turborepo monorepo. `apps/hub` (Fastify 5 + better-sqlite3, synchronous transactions, in-memory state swapped only after COMMIT), `apps/cloud` (Fastify 5 + PostgreSQL 16 through tenant-scoped repositories), shared `@pos/domain` and `@pos/events`. Every hub write goes through one writer; every staff write through one generic command route.

**Tech stack:** TypeScript, Node.js 22, Fastify 5.12.7, fastify-type-provider-zod 7.0.0, Zod 4.6.7, better-sqlite3 13.0.3, @node-rs/argon2 2.2.2, @fastify/websocket 11.3.4, @fastify/jwt 10.2.5, pg 8.23.1, ulid 3.0.2, Vitest 4.1.12, ESLint 10.13.0 + typescript-eslint 8.72.0, tsx 4.23.15 (dev).

**Spec:** `docs/specs/00_Hub_Platform_Access_Spec_v1.3.md` (v1.3: tasks 77–81 for M83–M90; v1.2: tasks 67–71 for M81, M82; v1.1: tasks 1–51 built against v1.0.1, tasks 52+ in `docs/reviews/00_build_review_2.md`) (with `docs/specs/00_Foundation_Spec_v1.7.md` §4.1, §5.6–§5.8, §6). "§3.5" means spec 00; "F §6.3" means the foundation; "M39" is a spec 00 decision in §3.1.

**Task status:** task **1** is done (commit `4abf807`). Tasks 2–5 are written for v1.0. **Tasks 5b and 5c** bring already-done tasks to v0.6 and v1.0: do them before task 6 (each only verifies if nothing needs changing). Tasks 6+ implement v1.0.

## Global Constraints

Every task implicitly includes these. Values are copied from the spec.

- **Versions (pin exactly, M26, M68):** `fastify@5.12.7`, `fastify-type-provider-zod@7.0.0`, `zod@4.6.7`, `better-sqlite3@13.0.3`, `@node-rs/argon2@2.2.2`, `@fastify/websocket@11.3.4`, `@fastify/jwt@10.2.5`, `pg@8.23.1`, `ulid@3.0.2`, `vitest@4.1.12`, `eslint@10.13.0`, `typescript-eslint@8.72.0`, `tsx@4.23.15` (dev), `qrcode@1.5.4` (hub, imported **only** by `apps/hub/src/setup/issue-admin-bootstrap.ts` (M72) and `apps/hub/src/lib/qr.ts` (M77)), `typescript@5` latest 5.x, Node 22. No other runtime dependency. CIDR: `node:net` `BlockList`. Crypto: `node:crypto`. No `@fastify/cors`.
- **Determinism (F §6.7):** source never calls `Date.now()`, `performance.now()`, `Math.random()`, `crypto.randomUUID()` or `ulid()` directly. Use `Clock.branchNow()`, `IdGen.next()`, `SecretGen` (task 6). Exceptions: `apps/*/src/lib/{clock,ids,secrets}.ts`, `apps/*/src/main.ts`, `apps/cloud/src/cli/*.ts` entry points, `apps/hub/src/setup/issue-admin-bootstrap.ts` (CLI entry).
- **Envelope (F §6.1):** `{ data }` (+ `meta`), or `{ error: { code, message, details, request_id } }`. No 204. Replays add `Idempotent-Replay: true`. 429/503 add `Retry-After` (seconds, rounded up) and `details.retry_after_ms`.
- **Errors:** only `ErrorCatalogue` codes (task 2/5b). `throw new DomainError(code, details)`.
- **Naming (F §6.6):** snake_case on the wire and in SQL; camelCase in TS; `*_at` Unix ms; `*_ms` durations.
- **SQL:** `db.transaction(fn).immediate(...)` = `BEGIN IMMEDIATE`. No `await` inside a transaction function.
- **Secrets never logged:** `pin`, `password`, `pairing_token`, `registration_code`, `refresh_token`, `device_token`, `session_token`, `admin_session_token`, `branch_api_key`, `access_token`, `backup_encryption_key`, `bootstrap_token`, `poll_secret`, `delivery_token`; headers `authorization`, `x-session-token`, `x-admin-session`, `x-admin-bootstrap`, `x-poll-secret`.
- **Tests:** unit `*.test.ts` next to source; hub integration `apps/hub/test/**/*.int.test.ts`; cloud integration `apps/cloud/test/**/*.int.test.ts`. Names `it('[00 §10 #N] …')` (each N exactly once) or `it('[00 §x.y] …')`.
- **Commit:** `feat(00): task N <title> [spec §x]`.
- **Fixed values:** PIN `/^\d{4,6}$/` as a string; argon2id PHC `m ≥ 19456, t ≥ 2, p = 1`; lockout staff 5 / device or IP 10 in 300 000 ms / lock 900 000 ms, counters reset when a lock expires (M62); semaphores PIN 2, admin 1, wait 2 000 ms, then 503 `retry_after_ms: 1000`; pairing token TTL 600 000 ms; pairing request TTL 600 000 ms, max 10 pending, display code 6 Crockford chars, poll every 2 000 ms; bootstrap token TTL 1 800 000 ms (issuing one expires any live one); pairing requests max 2 pending per requester IP; registration code 12 Crockford chars, TTL 86 400 000 ms, same-attempt window 3 600 000 ms; sweeper 15 000 ms; heartbeat 60 000 ms; confirm retry 60 000 ms; retention batch 500 rows in `maintenance_hour` (default 4); WS auth timeout 5 000 ms, ping 15 000 ms, pong timeout 30 000 ms; owner login lock 10 failures / 900 000 ms window / 900 000 ms lock; owner per-IP limit 30 failures / 900 000 ms; refresh grace 30 000 ms; JWT 1 h HS256; refresh 30 d; query pages default 50, max 200; `cors_origins` default `["http://localhost"]`.
- **Crockford alphabet:** `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
- **QR codes (M72, M77):** one library, `qrcode@1.5.4`. The CLI prints a terminal QR (task 35c). Pages get an SVG made on the hub by `qrSvg(text)` in `apps/hub/src/lib/qr.ts` (task 33) and insert it as-is; no QR library is served to browsers; do not hand-write a QR encoder.

## Review Focus

Inputs the spec implies but no §10 test covers. Each has a test in the task named.

1. **IPv4-mapped client IPs** (`::ffff:192.168.20.7`) must match an IPv4 guest CIDR → task 7.
2. **`Host` header with uppercase or a trailing dot** (`LOCALHOST:3000`, `localhost.:3000`) must be normalised before the M45 comparison → task 7.
3. **Missing or malformed hub config** must exit non-zero naming the bad field → task 9.
4. **Payload key order** must not change `payload_hash`, or a retransmit from another serialiser is rejected as a mismatch → task 6.
5. **A pairing request polled after approval but after `expires_at`** must return 404, and the plaintext `delivery_token` must be gone from the row → task 38.

---

## File map

```
package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, vitest.config.ts, eslint.config.js, docker-compose.yml
packages/domain/src/{ids,errors,permissions,enums,index}.ts
packages/events/src/{envelope,registry,codecs,ws,directory,index}.ts
packages/events/src/events/{hub,staff}/<EventType>.v1.ts
packages/events/testing/index.ts
packages/events/fixtures/<EventType>.v1.json, <EventType>.latest.json
apps/hub/src/lib/{clock,ids,secrets,hash,semaphore,net,crypto-file,qr,boot,health}.ts
apps/hub/src/config/{schema,load,write}.ts
apps/hub/src/db/{connection,migrate,pre-migrate-backup}.ts, db/migrations/000{1,2,3}_*.sql
apps/hub/src/engine-host/{append-events,state-holder,writer,auth-generation}.ts
apps/hub/src/projections/{registry,access-reconcile}.ts
apps/hub/src/server.ts, main.ts
apps/hub/src/auth/{staff-directory,apply-directory,session-store,guards,pin,admin-session,admin-bootstrap,bootstrap-tokens,station-validator,pairing,pair-page,pair-requests,staff-session,station-session,session-sweeper}.ts
apps/hub/src/commands/{registry,route,generate-device-pairing-token,approve-pairing-request,revoke-device,force-logout-session,clear-pin-lockout}.ts
apps/hub/src/queries/{registry,devices,sessions,staff-roster,session}.ts
apps/hub/src/setup/{provision,cloud-client,confirm-task,page,issue-admin-bootstrap}.ts
apps/hub/src/ws/{server,catch-up,audience}.ts
apps/hub/deploy/hub.service
apps/hub/test/helpers/{db,test-hub,fixtures,stub-cloud,log-capture,statement-counter,ws-client,big-fixture}.ts
apps/cloud/src/{main,server}.ts, apps/cloud/src/lib/{env,clock,ids,secrets}.ts
apps/cloud/src/db/{client,migrate,credential-lookup,tenant-scoped-repository,tenant-level-repository}.ts, db/migrations/0001_platform.sql
apps/cloud/src/plugins/{tenant-scope,owner-credentials,jwt,error-handler}.ts
apps/cloud/src/modules/hub-registration/{routes,service,repository,schemas}.ts
apps/cloud/src/modules/owner-auth/{routes,service,repository,schemas}.ts
apps/cloud/src/modules/staff-roles/default-roles.ts
apps/cloud/src/modules/health/routes.ts
apps/cloud/src/cli/{system-context,seed-tenant,issue-registration-code,codes}.ts
apps/cloud/test/helpers/{test-cloud,global-setup}.ts
```

---

### Task 1: Monorepo skeleton — SAFE BEFORE REVIEW

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.config.ts`, `eslint.config.js`, `packages/domain/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`, `packages/events/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`, `apps/hub/{package.json,tsconfig.json,vitest.config.ts,src/main.ts}`, `apps/cloud/{package.json,tsconfig.json,vitest.config.ts,src/main.ts}`, `packages/domain/src/smoke.test.ts`; Modify `.gitignore` (`node_modules`, `dist`, `.turbo`, `coverage`).

**Interfaces:** workspace packages `@pos/domain`, `@pos/events`, `@pos/hub`, `@pos/cloud`; root scripts `pnpm test` (= `vitest run`), `pnpm lint`, `pnpm typecheck` (= `turbo run typecheck`).

- [ ] **Step 1: Failing test** `packages/domain/src/smoke.test.ts`: `it('[F §6.7] vitest projects run packages', () => expect(domain).toBeDefined())`.
- [ ] **Step 2: Run** `pnpm install && pnpm test` → FAIL.
- [ ] **Step 3: Implement.** Root `vitest.config.ts`: `defineConfig({ test: { projects: ['packages/*', 'apps/*'] } })`; packages use `defineProject`. `tsconfig.base.json`: `strict`, `module: "NodeNext"`, `target: "ES2023"`. `eslint.config.js` (flat; ESLint 10 + typescript-eslint 8): `no-restricted-syntax` forbidding `Date.now`, `performance.now`, `Math.random`, `crypto.randomUUID` outside the Global Constraints exceptions and tests. (Import-boundary rules come in tasks 28–30, when those files exist.)
- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(00): task 1 monorepo skeleton [spec §7.11, F §5.1, §6.7]`

**Done when:** a scratch `Date.now()` in `apps/hub/src/x.ts` fails lint (check, then delete the scratch file).

---

### Task 2: `@pos/domain` — IDs, enums, error catalogue — SAFE BEFORE REVIEW

**Files:** Create `packages/domain/src/{ids,enums,errors}.ts`, `packages/domain/src/{errors,ids}.test.ts`; Modify `packages/domain/src/index.ts`; delete `smoke.test.ts`.

**Interfaces — Produces:**
```ts
export const ULID_RE: RegExp;  export type Ulid = string;
export type DeviceType = 'tablet' | 'cashier_kiosk' | 'kds' | 'phone';
export type SessionKind = 'staff' | 'admin' | 'station';
export type SessionEndReason = 'logout' | 'replaced' | 'taken_over' | 'idle_timeout' | 'forced'
  | 'device_revoked' | 'staff_removed' | 'credentials_changed' | 'hub_restored';
export type GrantType = 'allowed' | 'requires_approval';
export type Grant = GrantType | 'not_granted' | 'denied';
export type LockoutSubject = 'staff' | 'device' | 'ip';
export const ErrorCatalogue: { readonly [code: string]: { readonly status: number } };  // as const
export type ErrorCode = keyof typeof ErrorCatalogue;
export class DomainError extends Error { constructor(code: ErrorCode, details?: Record<string, unknown>); readonly code; readonly details }
export function statusOf(code: ErrorCode): number;
```
Catalogue: `VALIDATION_FAILED 400`; `DEVICE_TOKEN_INVALID, SESSION_INVALID, SESSION_EXPIRED, ADMIN_SESSION_REQUIRED, PAIRING_TOKEN_INVALID, REGISTRATION_CODE_INVALID, BRANCH_API_KEY_INVALID, JWT_INVALID, PIN_INVALID, LOGIN_INVALID, REFRESH_TOKEN_INVALID 401`; `PERMISSION_DENIED, GUEST_NETWORK_FORBIDDEN, DEVICE_REVOKED, BRANCH_MISMATCH, DEVICE_TYPE_NOT_ALLOWED, DEVICE_NOT_OWNED, HOST_NOT_ALLOWED, STATION_LOGOUT_NOT_ALLOWED 403`; `ROUTE_NOT_FOUND, STAFF_NOT_FOUND, STATION_NOT_FOUND, DEVICE_NOT_FOUND, SESSION_NOT_FOUND, PAIRING_REQUEST_NOT_FOUND 404`; `TABLE_ALREADY_LOCKED, TABLE_LOCK_NOT_HELD, ITEM_WRONG_STAGE, VOID_PENDING, SYNC_SEQ_GAP, DEVICE_SESSION_ACTIVE, HUB_NOT_PROVISIONED, SETUP_IN_PROGRESS 409`; `REGISTRATION_CODE_KIND_UNSUPPORTED 422`; `CLIENT_UPGRADE_REQUIRED 426`; `PIN_LOCKED_OUT, DEVICE_LOCKED_OUT, IP_LOCKED_OUT, LOGIN_LOCKED_OUT 429`; `INTERNAL_ERROR 500`; `SERVICE_UNAVAILABLE 503`.

- [ ] **Step 1: Failing tests:** `[F §6.2] every DomainError code used in source is in the catalogue` (scan `apps/*/src`, `packages/*/src` for `new DomainError\(\s*'([A-Z_]+)'`); `[00 §9] spec 00 codes have their statuses` (PIN_INVALID 401, DEVICE_NOT_OWNED 403, HOST_NOT_ALLOWED 403, STATION_LOGOUT_NOT_ALLOWED 403, PAIRING_REQUEST_NOT_FOUND 404, DEVICE_SESSION_ACTIVE 409, REGISTRATION_CODE_KIND_UNSUPPORTED 422, IP_LOCKED_OUT 429, LOGIN_LOCKED_OUT 429); `[F §6.2] DomainError carries code and details`; `[F §6.6] ULID_RE accepts Crockford ULIDs only`.
- [ ] **Step 2–4:** `pnpm vitest run packages/domain` → FAIL → implement → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `feat(00): task 2 domain ids, enums, error catalogue [spec §9, F §6.2]`

---

### Task 3: `@pos/domain` — permission catalogue — SAFE BEFORE REVIEW

**Files:** Create `packages/domain/src/permissions.ts`, `packages/domain/src/permissions.test.ts`; Modify `packages/domain/src/index.ts`.

**Interfaces:** `PERMISSIONS` (19 entries: the E6 list + `manage-devices`, `access-hub-admin`), `type Permission`, `isPermission(x)`, `assertKnownPermissions(declared: Iterable<string>): void` (throws naming the first unknown).

- [ ] **Step 1: Failing tests:** `[00 §10 #74] a command declaring an unknown permission fails`; `[00 §3.6] catalogue has 19 unique entries`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 3 permission catalogue [spec §3.6]`

---

### Task 4: `@pos/events` — envelopes and event registry — SAFE BEFORE REVIEW

**Files:** Create `packages/events/src/{envelope,registry,codecs}.ts`, `packages/events/src/{envelope,codecs}.test.ts`; Modify `packages/events/src/index.ts`, `packages/events/package.json` (`zod@4.6.7`, `@pos/domain`).

**Interfaces — Produces:**
```ts
export const StreamTypeSchema;  // 'order','table','station','stock','shift','audit','hub','staff' (F §4.1)
export const PosEventSchema; export type PosEvent;
export const PosCommandSchema; export type PosCommand;
export type EventDraft = Omit<PosEvent, 'event_id'|'seq'|'recorded_at'|'tenant_id'|'branch_id'>;
export function defineEvent<P>(def: { eventType; version; payload: P; upcastFromPrevious? }): EventDef<P>;
export function latestVersion(eventType: string): number;
export function payloadSchema(eventType: string, version: number): z.ZodTypeAny;
export function parseEvent(raw: unknown): PosEvent;     // envelope + payload, upcast to latest (D46)
export function draftOf<P>(def: EventDef<P>, d: { stream_type; stream_id; payload; occurred_at; actor_id; device_id }): EventDraft;
```
- [ ] **Step 1: Failing tests:** `[F §4.1] PosEventSchema rejects an unknown stream_type`; `[F §4.1] PosCommandSchema requires command_id and device_id`; `[F §4.1, D46] parseEvent upcasts v1 to latest`; `[F §4.1] parseEvent rejects a bad payload`.
- [ ] **Step 2–5:** run → FAIL → implement (module-level registry map; duplicate or gapped versions throw) → PASS → commit `feat(00): task 4 event envelopes and registry [F §4.1, D46]`

---

### Task 5: `@pos/events` — spec 00 events, directory schema, WS messages, builders, fixtures — SAFE BEFORE REVIEW

**Files:** Create `packages/events/src/events/hub/{HubProvisioned,HubStarted,ClockAlarm,StaffDirectoryApplied,AdminBootstrapTokenIssued,DevicePairingTokenGenerated,DevicePaired,DeviceTokenRotated,DeviceRevoked,DevicePinLockedOut}.v1.ts`, `packages/events/src/events/staff/{SessionStarted,SessionEnded,StaffPinLockedOut,PinLockoutCleared}.v1.ts`, `packages/events/src/{ws,directory}.ts`, `packages/events/testing/index.ts`, `packages/events/fixtures/<each of the 14 events>.v1.json` and `.latest.json`, `packages/events/src/{fixtures,ws,directory}.test.ts`, `packages/events/testing/builders.test.ts`; Modify `packages/events/src/index.ts`, `packages/events/package.json` (exports `"./testing"`).

**Interfaces — Produces:** payloads exactly spec §4.2 v0.6, including: `HubProvisioned { tenant_id, branch_id, hub_version }`; `StaffDirectoryApplied { directory_version, staff_count, role_count, removed_staff_ids, credentials_changed_staff_ids, skipped: Array<{ kind: 'staff'|'role_assignment'|'permission'|'approver', id, reason }> }`; `AdminBootstrapTokenIssued { bootstrap_token_id, expires_at, issued_by: 'setup'|'cli'|'restore' }`; `DevicePairingTokenGenerated { pairing_token_id, device_type: 'tablet'|'phone', owner_staff_id|null, expires_at }`; `DevicePaired { device_id, device_name, device_type, station_id|null, owner_staff_id|null, pairing_token_id|null, pairing_request_id|null }` (refine: exactly one source id non-null); `DeviceTokenRotated { device_id, pair_request_id }`; `DeviceRevoked { device_id, reason|null, cause: 'manual'|'owner_removed' }`; `SessionStarted { session_id, kind, staff_id|null, station_id|null, device_id|null, idle_ttl_ms|null }`; `SessionEnded { session_id, kind, staff_id|null, station_id|null, reason: SessionEndReason, ended_by|null }`. `SessionStarted`/`SessionEnded` streams are `staff`/staff_id or `station`/station_id; the schema does not constrain `stream_type`.
- `directory.ts`: `DirectorySchema` = `{ directory_version: int ≥ 1, staff: [{ staff_id, display_name, pin_hash: string, role_ids: string[], denied_permissions: string[] }], roles: [{ role_id, name, session_idle_ttl_ms: int > 0, permissions: [{ permission: string, grant_type, approver_role_id: string|null }] }] }` — `pin_hash` and `permission` are plain strings; the hub applies quality rules (M52). `type DirectoryInput`.
- `ws.ts`: `WsClientMessage = auth | ack`; `WsServerMessage = catch_up | event | error`; `WS_CLOSE = { CREDENTIALS: 4401, FORBIDDEN: 4403, UPGRADE: 4426, RESTARTING: 1012 }`.
- builders: one per event (`aHubProvisioned(overrides?)` …).

- [ ] **Step 1: Failing tests:** `[F §6.7, D46] every stored fixture upcasts to its .latest.json`; `[F §6.7] every builder output parses`; `[00 §6.21, M12] WsClientMessage accepts auth and ack only`; `[00 §4.2] DevicePaired requires exactly one pairing source id`; `[00 §4.2] DirectorySchema accepts a minimal directory and rejects session_idle_ttl_ms 0`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 5 spec 00 events, directory, ws, builders, fixtures [spec §4.2, §6.21]`

---

### Task 5b: Bring tasks 1–5 to spec v0.6

Do this after tasks 1–5 exist. If they were written from this version of the plan, every item below is already true: verify, report "nothing to change", commit nothing. If they were written from the v0.5 plan, apply the changes.

**Files:** Modify only files created by tasks 1–5.

**Changes (v0.5 plan → v0.6):**
1. `errors.ts`: add `HOST_NOT_ALLOWED 403`, `STATION_LOGOUT_NOT_ALLOWED 403`, `PAIRING_REQUEST_NOT_FOUND 404`, `IP_LOCKED_OUT 429`; extend the `[00 §9]` test.
2. `enums.ts`: add `'credentials_changed'` to `SessionEndReason`.
3. Events: add `AdminBootstrapTokenIssued.v1`, `DeviceTokenRotated.v1` (+ fixtures, builders). Change v1 payloads in place: `HubProvisioned` drops `setup_attempt_id`; `StaffDirectoryApplied` adds `credentials_changed_staff_ids`, `skipped`; `DevicePairingTokenGenerated` `device_type` → `'tablet'|'phone'` and drops `station_id`; `DevicePaired` adds `pairing_request_id`, `pairing_token_id` nullable, exactly-one refine; `SessionEnded.reason` uses the new enum. Editing v1 in place is allowed **only because no hub has stored any event and nothing is merged to `main`**; if either is false, stop and ask (it would need v2 + upcasters, F §6.7).
4. Add `packages/events/src/directory.ts` (`DirectorySchema`) + test if missing.
5. `eslint.config.js`: pin `eslint@10.13.0`, `typescript-eslint@8.72.0`; add `apps/cloud/src/cli/*.ts` to the `Date.now` exceptions.
6. Update fixtures (`.v1.json`, `.latest.json`) to the changed payloads.

- [ ] **Step 1: Failing tests:** the updated `[00 §9]` test and the new fixture/builder/directory tests.
- [ ] **Step 2–4:** `pnpm test` → FAIL → apply → PASS.
- [ ] **Step 5: Commit** `feat(00): task 5b align shared packages with spec v0.6 [spec §4.2, §9]`

---

### Task 5c: Bring already-done tasks to spec v1.0

Do this after 5b. Task 1 is done; tasks 2–5 may be done by then. Apply only what is missing; if nothing is, report "nothing to change" and commit nothing.

**Files:** Modify only files created by tasks 1–5.

**Changes (v0.6 → v1.0):**
1. `eslint.config.js` (task 1): add `apps/hub/src/setup/issue-admin-bootstrap.ts` to the `Date.now` / `performance.now` exceptions (CLI entry, M72); add a `no-restricted-imports` rule allowing `qrcode` only in that file and in `apps/hub/src/lib/qr.ts` (M77).
2. `AdminBootstrapTokenIssued.v1` (task 5): add `issued_by: z.enum(['setup','cli','restore'])`; update its fixtures and builder. In-place v1 edit allowed only under the 5b condition (no stored events, nothing merged to `main`), else stop and ask.
3. `errors.ts` (task 2): no change. `LOGIN_LOCKED_OUT` stays in the catalogue (reserved, M73).

- [ ] **Step 1: Failing tests:** `[00 §4.2] AdminBootstrapTokenIssued requires issued_by` (in `packages/events/src/fixtures.test.ts` or a new `bootstrap-event.test.ts` beside it); `[00 §3.1 M72, M77] lint allows qrcode only in the hub CLI entry and lib/qr.ts` (a scratch import elsewhere fails `pnpm lint`; check, then delete the scratch file).
- [ ] **Step 2–4:** `pnpm test && pnpm lint` → FAIL → apply → PASS.
- [ ] **Step 5: Commit** `feat(00): task 5c align shared packages with spec v1.0 [spec §4.2, M72]`

---

> **Tasks 6+ implement spec v0.6.** Start them only after the user confirms (Review 2 may still change the spec).

### Task 6: Hub lib — clock, IDs, secrets, canonical hash

**Files:** Create `apps/hub/src/lib/{clock,ids,secrets,hash}.ts`, `apps/hub/src/lib/{clock,ids,hash}.test.ts`.

**Interfaces — Produces:**
```ts
export interface Clock { branchNow(): number }
export function createBranchClock(o: { wallNow; monoNow; lastRecordedAt: number }): { clock: Clock; alarm: null | { wall_ms; last_recorded_at; delta_ms } };
export function fixedClock(t: number): Clock & { set(t): void; advance(ms): void };
export function steppingClock(t: number, stepMs: number): Clock;
export const T = 1_761_000_000_000;
export interface IdGen { next(): string }
export function ulidGen(clock: Clock): IdGen;   export function testIdGen(): IdGen;
export interface SecretGen { token256(): string; bytes(n: number): Buffer; crockford(n: number): string }
export const cryptoSecrets: SecretGen;   export function testSecrets(): SecretGen;
export const sha256hex: (s: string | Buffer) => string;
export function canonicalJson(v: unknown): string;      // keys sorted recursively, no whitespace
export function payloadHash(payload: unknown): string;  // sha256hex(canonicalJson(payload))  (M47)
```
- [ ] **Step 1: Failing tests:** `[F §4.7] branchNow never jumps with the wall clock`; `[F §4.7, D48] boot wall ≤ last recorded_at → last+1 with an alarm (delta_ms = wall − last)`; `[F §6.7] testIdGen yields valid increasing ULIDs`; `[F §6.7] ulidGen is monotonic within one ms`; `[00 §3.7] payloadHash ignores key order (Review Focus 4)` (`{a:1,b:{d:2,c:3}}` and `{b:{c:3,d:2},a:1}` equal; `{a:2,…}` differs); `[00 §6.30] crockford(6) uses only the Crockford alphabet`.
- [ ] **Step 2–5:** `pnpm vitest run apps/hub/src/lib` → FAIL → implement → PASS → commit `feat(00): task 6 hub clock, ids, secrets, canonical hash [F §4.7, §6.7, M47]`

---

### Task 7: Hub lib — semaphore, network and host matchers

**Files:** Create `apps/hub/src/lib/{semaphore,net}.ts`, `apps/hub/src/lib/{semaphore,net}.test.ts`.

**Interfaces — Produces:**
```ts
export class SemaphoreTimeoutError extends Error {}
export class Semaphore { constructor(size: number); acquire(timeoutMs: number): Promise<() => void> }
export function createNetMatcher(cidrs: string[]): (ip: string) => boolean;
export function listOwnIPv4(ifaces?: ReturnType<typeof os.networkInterfaces>): string[];   // non-internal IPv4
export function createHostMatcher(o: { port: number; advertisedHost: string | null; ownIPv4: string[] }): (hostHeader: string | undefined) => boolean;
  // allowed: `${advertisedHost}:${port}` (when set), `localhost:${port}`, `127.0.0.1:${port}`;
  // advertisedHost null (setup mode): also `${ip}:${port}` for each own IPv4.
  // Lowercase; strip one trailing dot from the hostname; missing header → false.
```
- [ ] **Step 1: Failing tests:** `[00 §7.4] third acquire times out after the deadline`; `[00 §7.4] release hands the slot to the oldest waiter`; `[00 §3.9] guest CIDR matches IPv4 and IPv4-mapped IPv6 (Review Focus 1)`; `[00 §3.1 M45] host matcher: allowed, wrong port, other host, missing header, setup-mode own address`; `[00 §3.1 M45] host matcher normalises case and a trailing dot (Review Focus 2)`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 7 semaphore, network and host matchers [spec §3.9, §7.4, M45]`

---

### Task 8: Hub lib — encrypted file helper

**Files:** Create `apps/hub/src/lib/crypto-file.ts`, `apps/hub/src/lib/crypto-file.test.ts`.

**Interfaces:** `encryptFile(src, dst, key: Buffer, iv: Buffer): Promise<void>`; `decryptFile(src, dst, key): Promise<void>`; `MAGIC = Buffer.from('POSENC1\n')`. §7.9: encrypt streams to `dst.tmp`, fsync, rename; decrypt streams to `dst.tmp`, and only after `final()` verifies the tag fsyncs and renames; on failure deletes `dst.tmp`.

- [ ] **Step 1: Failing test:** `[00 §10 #65] round trip; a flipped byte fails the tag and writes no output` (neither `out` nor `out.tmp` exists after the failure).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 8 encrypted file helper [spec §7.9, M21, M67]`

---

### Task 9: Hub config

**Files:** Create `apps/hub/src/config/{schema,load,write}.ts`, `apps/hub/src/config/config.test.ts`.

**Interfaces — Produces:**
```ts
export const HubConfigSchema;   // fields exactly §3.10 v0.6; advertised_host, guest_network_cidrs, setup_attempt_id, provisioned, backup_encryption_key optional
export type HubConfig;
export class ConfigError extends Error { readonly field?: string }
export function loadHubConfig(path: string): HubConfig;
export function writeHubConfigAtomic(path: string, cfg: HubConfig, fsImpl?: Pick<typeof fs, 'writeFileSync'|'fsyncSync'|'renameSync'|'openSync'|'closeSync'>): void;  // 0o600
export function isProvisioned(cfg): boolean;   // provisioned.branch_id && provisioned.branch_api_key
export function isConfirmed(cfg): boolean;     // provisioned.confirmed_at set (M41)
export const DEFAULT_CONFIG_PATH = '/etc/pos-hub/config.json';
```
Defaults: `auth.{pin_max_failures 5, device_max_failures 10, device_failure_window_ms 300000, pin_lockout_ms 900000, argon2_concurrency 2, admin_argon2_concurrency 1}`, `cors_origins ['http://localhost']`, `maintenance_hour 4` (0–23).

- [ ] **Step 1: Failing tests:** `[00 §3.10] defaults fill auth limits, cors_origins and maintenance_hour`; `[00 §3.10] missing or malformed config fails naming the field (Review Focus 3)`; `[00 §10 #122] atomic write: mode 0600, no .tmp left, a crash before rename leaves the old file intact` (inject an `fsImpl.renameSync` that throws once); `[00 §3.2] isProvisioned / isConfirmed`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 9 hub config [spec §3.10, M41, M58]`

---

### Task 10: SQLite connection and migrations runner

**Files:** Create `apps/hub/src/db/{connection,migrate}.ts`, `apps/hub/test/db/migrate.int.test.ts`, `apps/hub/test/db/fixtures/migrations-a/{0001_a.sql,0002_b.sql}`.

**Interfaces:** `openDb(path)` (WAL, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`); `openReadOnly(path)`; `runMigrations(db, { dir, clock, backup? }): Promise<{ from, to, applied }>`. Runner-owned table `migration_checksums (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)`; sequential files; checksum mismatch → `MigrationChecksumError`; `backup(from, to)` once before the first pending file when `user_version > 0`; each file + its checksum row + `PRAGMA user_version` in one immediate transaction; first line `-- migrate:foreign-keys-off` → FK off around the transaction, `foreign_key_check` before commit.

- [ ] **Step 1: Failing tests (`[F §6.8]`):** applies pending files and records checksums; refuses when an applied file changed (the checksum half of #64); calls backup once; a failing file rolls back only itself; `openDb` sets WAL and synchronous FULL.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 10 sqlite connection and migrations runner [spec §3.8, F §6.8]`

---

### Task 11: Encrypted pre-migration backup and leftover cleanup

**Files:** Create `apps/hub/src/db/pre-migrate-backup.ts`, `apps/hub/test/db/pre-migrate-backup.int.test.ts`.

**Interfaces:** `makePreMigrateBackup({ db, config, secrets }): (from, to) => Promise<void>` (no-op when unprovisioned or no key; `db.backup()` to `<data_dir>/pre-migrate-<from>-<to>.sqlite`; `encryptFile` to `<backup_dir>/pre-migrate-<from>-<to>.sqlite.enc`, fallback `<data_dir>/….sqlite.enc`; always delete the plaintext; both fail → throw); `deleteLeftoverPlaintext(dataDir): string[]` (deletes `pre-migrate-*.sqlite`, keeps `.enc`; boot step 1, M67).

- [ ] **Step 1: Failing tests:** `[00 §10 #64] pre-migration backup is encrypted and decrypts to the old user_version`; `[00 §10 #124] backup_dir missing → data_dir; both unwritable → throws and no migration applied`; `[00 §10 #111] a leftover pre-migrate-*.sqlite is deleted, .enc kept`; `[00 §3.8] unprovisioned → no backup file, migrations still run`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 11 encrypted pre-migration backup [spec §3.8, §7.9, M21, M67]`

---

### Task 12: Migration 0001 — event store

**Files:** Create `apps/hub/src/db/migrations/0001_event_store.sql`, `apps/hub/test/db/event-store-schema.int.test.ts`, `apps/hub/test/helpers/db.ts`.

**Interfaces:** §5.1 v0.6 `0001`: foundation `events` (+ indexes, triggers), `sync_cursor`, `hub_heartbeat`, `processed_commands` with `device_id NOT NULL`, `session_id`, `command_type NOT NULL`, `payload_hash NOT NULL`; `projection_checkpoints`. Helper `freshDb(): { db, path, dir, cleanup() }`.

- [ ] **Step 1: Failing tests:** `[00 §10 #62] events UPDATE and DELETE raise`; `[00 §5.1] processed_commands requires device_id, command_type, payload_hash`; `[F §4.1] (branch_id, seq) is unique`.
- [ ] **Step 2–5:** run → FAIL → SQL → PASS → commit `feat(00): task 12 migration 0001 event store [spec §5.1, F §4.1, M47]`

---

### Task 13: `appendEvents`

**Files:** Create `apps/hub/src/engine-host/append-events.ts`, `apps/hub/test/engine-host/append-events.int.test.ts`.

**Interfaces:** `appendEvents(tx, drafts, ctx: { clock, ids, tenantId, branchId }): PosEvent[]` — inside a transaction only; `seq = COALESCE(MAX(seq),0)+1…`; validates envelope + payload; one prepared INSERT.

- [ ] **Step 1: Failing tests:** `[00 §10 #63] seq gap-free across 1 000 appends with forced rollbacks`; `[F §4.1] outside a transaction throws`; `[F §4.1] invalid payload inserts nothing`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 13 appendEvents [spec §3.7, F §4.1]`

---

### Task 14: Projection registry — forward catch-up

**Files:** Create `apps/hub/src/projections/registry.ts`, `apps/hub/test/projections/registry.int.test.ts`.

**Interfaces — Produces:**
```ts
export interface Projection { name: string; eventTypes: string[]; apply(tx, e: PosEvent, mode: 'live' | 'catchup'): void; reset?(tx): void }
export interface ProjectionRegistry { register(p: Projection): void;
  applyAll(tx, events: PosEvent[], branchId: string): void;   // apply matching events (mode 'live'), then set EVERY projection's checkpoint to the last seq (M48)
  catchUp(db, branchId: string): { replayed: Record<string, number> };
  afterCatchUp(fn: (tx) => void): void }                        // run once after all catch-up, inside the last catch-up transaction
export function createProjectionRegistry(): ProjectionRegistry;
```
`catchUp` (§3.8 step 4, M48): checkpoint row missing → with `reset`: `reset` + replay from 0; forward-only: replay from 0; checkpoint < `MAX(seq)` → replay `seq > checkpoint` in pages of 1 000 through `parseEvent` (mode `'catchup'`), then set the checkpoint; checkpoint = `MAX(seq)` → skip.

- [ ] **Step 1: Failing tests:** `[00 §10 #67] checkpoint behind MAX(seq) → replay from the checkpoint gives the same rows as live application` (a counter projection must not double-count events ≤ checkpoint); `[00 §3.1 M48] applyAll advances every checkpoint, including projections that ignore the events`; `[00 §3.1 M48] no checkpoint row: with reset → reset and full replay; forward-only → replay from 0 without reset`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 14 projection registry forward catch-up [spec §3.8, M17, M48]`

---

### Task 15: Writer — commit-then-swap, after-commit hooks, auth generation

**Files:** Create `apps/hub/src/engine-host/{state-holder,writer,auth-generation}.ts`, `apps/hub/test/engine-host/writer.int.test.ts`.

**Interfaces — Produces:**
```ts
export interface AuthGeneration { current(): number; bump(): void }
export function createAuthGeneration(): AuthGeneration;
export const AUTH_EVENTS = ['DeviceRevoked','DeviceTokenRotated','SessionEnded','StaffDirectoryApplied'] as const;
export type Reducer<S> = (s: S, e: PosEvent) => S;
export interface StateHolder<S> { get(): Readonly<S>; setReducer(r): void; reducer(): Reducer<S>; swap(next: S): void }
export function createStateHolder<S>(initial: S): StateHolder<S>;
export interface WriterTx { db; state: Readonly<unknown>; append(drafts: EventDraft[]): PosEvent[]; onCommit(fn: () => void): void }
export interface Writer { run<T>(fn: (tx: WriterTx) => T): { result: T; appended: PosEvent[] }; lastSeq(): number;
  addAfterCommit(fn: (appended: PosEvent[]) => void): void }
export function createWriter(o: { db; clock; ids; tenantId; branchId; projections; state; authGeneration: AuthGeneration;
  publish: (events: PosEvent[]) => void; testHooks?: { beforeCommit?: () => void; beforePublish?: () => void } }): Writer;
```
`run`: immediate transaction → `fn` → `append` (appendEvents + `projections.applyAll`) → `next = reduce` → `testHooks.beforeCommit` → commit. After commit, synchronously and in order: `state.swap(next)`; update `lastSeq`; any appended type ∈ `AUTH_EVENTS` → `authGeneration.bump()`; `tx.onCommit` callbacks; `addAfterCommit` hooks; `testHooks.beforePublish`; `publish(appended)` if non-empty. On a throw: none of that.

- [ ] **Step 1: Failing tests:** `[F D45] state swaps only after COMMIT`; `[F D45] a throw in beforeCommit leaves state, events, lastSeq, generation and publish untouched`; `[00 §3.1 M39] a committed SessionEnded bumps authGeneration once; other events do not`; `[00 §3.7] two appends in one run → consecutive seqs, one publish`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 15 writer, after-commit hooks, auth generation [spec §3.7, §4.2, M39, F D45]`

---

### Task 16: Fastify server, error handler, request id, redaction

**Files:** Create `apps/hub/src/server.ts`, `apps/hub/test/helpers/{test-hub,log-capture}.ts`, `apps/hub/test/server.int.test.ts`.

**Interfaces — Produces:**
```ts
export interface HubDeps { config; db; readDb; clock; ids; secrets; writer: Writer; state; projections; authGeneration;
  ownIPv4: string[]; logStream?: NodeJS.WritableStream; testHooks?: { betweenGuardAndWriter?: () => Promise<void> } }
export function buildHubServer(deps: HubDeps): FastifyInstance;
export const REDACT_PATHS: string[];   // every secret in Global Constraints
export interface TestHub { app; deps; clock: ReturnType<typeof fixedClock>; logs(): string; close(): Promise<void> }
export async function createTestHub(o?: { provisioned?: boolean; config?: Partial<HubConfig> }): Promise<TestHub>;
  // provisioned config: tenant 'tenant-a', branch 'branch-1', advertised_host '192.168.10.2', http_port 3000,
  // guest_network_cidrs ['192.168.20.0/24'], backup_encryption_key; ownIPv4 ['192.168.10.2']; inject() default Host '192.168.10.2:3000'
```
Error handler: `DomainError` → envelope + `statusOf`; Zod → `VALIDATION_FAILED { issues: [{ path, message }] }`; 404 → `ROUTE_NOT_FOUND`; else `INTERNAL_ERROR` (stack logged, never returned). `request_id = ids.next()` on every log line. Bodies never logged.

- [ ] **Step 1: Failing tests (`[F §6.1]` / `[00 §7.2]`):** DomainError → envelope and status; unknown error → INTERNAL_ERROR without stack; unknown route → ROUTE_NOT_FOUND; Zod failure → VALIDATION_FAILED with issues; secret headers redacted in logs.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 16 hub server and error handler [spec §7.1, §7.2, F §6.1]`

---

### Task 17: Migrations 0002 and 0003

**Files:** Create `apps/hub/src/db/migrations/0002_devices_sessions.sql`, `apps/hub/src/db/migrations/0003_staff_directory.sql`, `apps/hub/test/db/access-schema.int.test.ts`.

**Interfaces:** tables exactly §5.1 v0.6: `devices`, `pairing_tokens` (`tablet`/`phone` only), `pair_requests` (with `requester_ip TEXT NOT NULL`, M76) + `pair_requests_pending`, `admin_bootstrap_tokens`, `staff_sessions` (no `client_ip`; `CHECK (kind = 'admin' OR device_id IS NOT NULL)` + three station CHECKs), `staff_sessions_active_device`, `staff_sessions_active`, `auth_lockouts` + index; `0003` directory cache.

- [ ] **Step 1: Failing tests (`[00 §5.1]`):** a second active staff/station session on one device violates the unique index; an ended session does not block; an admin session does not occupy the device slot; kds without station and phone without owner rejected; station session with staff_id or idle_ttl rejected; staff session without device rejected; admin session without device allowed (bootstrap); `pairing_tokens` rejects `device_type 'kds'`.
- [ ] **Step 2–5:** run → FAIL → SQL → PASS → commit `feat(00): task 17 migrations 0002 and 0003 [spec §5.1]`

---

### Task 18: `StaffDirectory` and `resolve`

**Files:** Create `apps/hub/src/auth/staff-directory.ts`, `apps/hub/src/auth/staff-directory.test.ts`, `apps/hub/test/helpers/fixtures.ts`.

**Interfaces — Produces:**
```ts
export type Resolution = { grant: 'allowed' } | { grant: 'requires_approval'; approver_role_ids: string[] } | { grant: 'not_granted' } | { grant: 'denied' };
export class StaffDirectory {
  static fromInput(d: DirectoryInput): StaffDirectory;   static load(db): StaffDirectory;   // 6 fixed SELECTs
  get version(): number;  get(staffId); list(); resolve(staffId, p: Permission): Resolution;
  permissionsOf(staffId): Record<Permission, Resolution>;  ttlFor(staffId): number;          // max over roles (M11)
  hasAdmin(staffId): boolean;                                                                // resolve(…, 'access-hub-admin').grant === 'allowed'
}
// fixtures.ts
export const PIN = { a: '1234', b: '0123', c: '999999' };
export async function pinHash(pin: string): Promise<string>;   // argon2id m=19456 t=2 p=1, memoised
export async function aDirectory(o?): Promise<DirectoryInput>;
  // S_OWNER (R_OWNER: all, 3 600 000), S_MGR (R_MGR: all but manage-roles, 3 600 000),
  // S_CASH (R_CASH: apply-discount requires_approval R_MGR, reprint-ticket allowed, 1 800 000), S_WAIT (R_WAIT: none, 300 000)
```
- [ ] **Step 1: Failing tests:** `[00 §10 #78] resolve truth table`; `[00 §3.1 M11] ttlFor is the max across roles`; `[00 §5.1] load() round trip through the cache tables`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 18 staff directory and resolve [spec §3.6, M10, M11, M18]`

---

### Task 19: `applyStaffDirectory` and the session store

**Files:** Create `apps/hub/src/auth/{apply-directory,session-store}.ts`, `apps/hub/test/auth/apply-directory.int.test.ts`.

**Interfaces — Produces:**
```ts
// session-store.ts — the only code that creates/ends sessions or revokes devices
export interface SessionRow { session_id; kind; staff_id; station_id; device_id; idle_ttl_ms; last_activity_at; ended_at; token_hash }
export function createSession(tx: WriterTx, o: { kind; staffId; stationId; deviceId; idleTtlMs; eventDeviceId }): { sessionId; token };
export function endSession(tx: WriterTx, s: SessionRow, reason: SessionEndReason, endedBy: string | null, actorId: string | null, eventDeviceId: string): void;
export function revokeDevice(tx: WriterTx, deviceId: string, o: { reason; cause: 'manual'|'owner_removed'; actorId; eventDeviceId; revokedBy }): void;
  // sets revoked_at/by; ends its staff/station session and every admin session bound to it ('device_revoked'); appends DeviceRevoked
export function findSessionByToken(db, token: string): SessionRow | undefined;   // includes ended rows
export function activeSessionsOf(db, where: { staffId?: string; deviceId?: string; kind?: SessionKind }): SessionRow[];
export const activity: { touch(id, at): void; get(id): number | undefined; drain(): Array<[string, number]>;
  deviceSeen(id, at): void; drainDevices(): Array<[string, number]>; forget(id): void };
export function isIdleExpired(s: SessionRow, now: number): boolean;  // idle_ttl_ms != null && now − max(row.last_activity_at, activity.get(id) ?? 0) > idle_ttl_ms
// apply-directory.ts
export function applyStaffDirectory(tx: WriterTx, d: DirectoryInput, setDirectory: (dir: StaffDirectory) => void): { applied: boolean };
```
Rules (§4.2, M38, M50–M52, M75): (1) `d.directory_version ≤ current` → `{ applied: false }`, no writes, log (M51). (2) Skips (M52): staff whose `pin_hash` does not match `^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$` or is below the floor → skip staff; `role_ids` entry not in `roles` → skip that assignment; permission not in `PERMISSIONS` → skip that grant; `approver_role_id` not in `roles` → skip that grant; each skip → `{ kind, id, reason }` + warn log. (3) Replace cache rows; **a staff row skipped for its hash keeps its previous cache rows** (staff, role assignments, denials) when they exist (M75). (4) `removed` = old staff ids − new staff ids (counting staff kept by M75 as present, so they are never removed); `changed` = staff in both with a different `pin_hash`. (5) Removed: end every active session (staff + admin) `'staff_removed'`; revoke their non-revoked phones (`cause 'owner_removed'`, actor null, eventDeviceId `'hub'`). Changed: end every active session `'credentials_changed'`. (6) Upsert meta; append `StaffDirectoryApplied`. (7) `tx.onCommit(() => setDirectory(StaffDirectory.fromInput(effective)))`.

- [ ] **Step 1: Failing tests:** `[00 §10 #70] removed staff → sessions ended staff_removed; a permission change applies on the next read`; `[00 §10 #83] removing the owner revokes their phones in the same transaction; other devices untouched`; `[00 §10 #101] changed pin_hash ends staff and admin sessions credentials_changed`; `[00 §10 #102] equal version → no-op, no event; older → no-op; newer → applied`; `[00 §10 #103] weak hash, unknown role assignment, unknown permission, unknown approver → skipped and listed; the rest applied; a removal in the same push happens`; `[00 §10 #129] malformed hash for an existing staff member keeps the old row (old PIN still logs in), ends no session, revokes no phone, lists the skip; for a new staff member the row is absent`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 19 applyStaffDirectory and session store [spec §4.2, M38, M50, M51, M52, M75]`

---

### Task 20: Route guards — host, provisioned, guest network, client version, inventory

**Files:** Create `apps/hub/src/auth/guards.ts`, `apps/hub/test/auth/guards.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** `type RouteGroup = 'health' | 'setup' | 'device' | 'device-session' | 'admin' | 'admin-device-public' | 'admin-bootstrap' | 'pair' | 'pair-request' | 'ws'`; routes declare `config: { group }`; root `onRoute` attaches guards by group per §3.9; a route without a group makes `ready()` throw. `guardsFor(group)`, `listRouteGuards(app)`. This task: `host` (all groups, `createHostMatcher`), `provisioned`, `guest` (all except `health`, which gets `req.isGuest`), `version`.

- [ ] **Step 1: Failing tests:** `[00 §10 #72] every route has its guard set; an unguarded route fails`; `[00 §10 #21] other routes before provisioning → 409`; `[00 §10 #97] bad Host → 403 HOST_NOT_ALLOWED on /health and on test routes of the admin-device-public, pair and pair-request groups; localhost and the advertised host pass; setup mode accepts an own address` (WS half in task 44); `[00 §3.9] X-Client-Version below min → 426; absent passes`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 20 route guards part 1 [spec §3.9, M45]`

---

### Task 21: Route guards — device, device session, admin session

**Files:** Modify `apps/hub/src/auth/guards.ts`, `apps/hub/test/helpers/test-hub.ts`; Create `apps/hub/test/auth/guards-auth.int.test.ts`.

**Interfaces:** request decorations `req.device`, `req.session`, `req.authGen` (= `authGeneration.current()` when the guard ran). Device: bearer → `sha256` → missing `401 DEVICE_TOKEN_INVALID`, revoked `403 DEVICE_REVOKED`; `activity.deviceSeen`. Device session: `X-Session-Token` → unknown or other device `401 SESSION_INVALID`; ended `401 SESSION_EXPIRED`; `isIdleExpired` → `writer.run(endSession 'idle_timeout')` then `401 SESSION_EXPIRED` (M46); options `allowEnded`, `allowStation`. Admin: device token required unless the session's `device_id IS NULL` (bootstrap); `X-Admin-Session` missing/unknown/ended/not admin/other device → `401 ADMIN_SESSION_REQUIRED`; idle → end + 401; `directory.hasAdmin(staff_id)` false → `403 PERMISSION_DENIED { permission: 'access-hub-admin' }` (M61). Guards **do not** touch activity (M59; routes decide). Test helpers: `seedDirectory(h, d?)`, `pairDevice(h, { type, stationId?, ownerStaffId? })`, `openSession(h, { kind, staffId?, deviceId?, stationId? })`, `endSessionNow(h, id, reason?)`.

- [ ] **Step 1: Failing tests:** `[00 §10 #98] at TTL + 1 s before any sweep → 401 SESSION_EXPIRED and the row is ended idle_timeout` (login half in task 39); `[00 §10 #106] access-hub-admin removed → next admin request 403`; `[00 §10 #115] ADMIN_SESSION_REQUIRED: missing, unknown, ended, staff-kind token, other device`; `[00 §10 #116] DEVICE_TOKEN_INVALID and DEVICE_REVOKED on a /commands, a /queries, an /auth/pin and an /admin/auth test route`; `[00 §10 #117] SESSION_INVALID for another device's session; on queries ended → EXPIRED, unknown → INVALID`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 21 route guards part 2 [spec §3.9, M42, M46, M61]`

---

### Task 22: Command registry and generic command route

**Files:** Create `apps/hub/src/commands/{registry,route}.ts`, `apps/hub/test/commands/route.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces — Produces:**
```ts
export interface CommandCtx { tx: WriterTx; state; clock; ids; secrets;
  actor: { kind: SessionKind; staffId: string | null; stationId: string | null; sessionId: string; deviceId: string };
  permission: Resolution | null; branch: { tenantId; branchId }; directory: StaffDirectory; config: HubConfig }
export interface CommandDef<P> { commandType; payloadSchema: P; sessionKind: 'device' | 'admin'; permission: Permission | null;
  approvable?: boolean; stationScoped?: boolean; handle(ctx, payload, cmd): { events: EventDraft[]; result: unknown } }
export function defineCommand<P>(d: CommandDef<P>): CommandDef<P>;
export function createCommandRegistry(): { register(d): void; byPath(name): CommandDef | undefined };
export function toKebab(commandType: string): string;
```
Route order per §3.7 **without** the fast path and the M39 re-check (task 23 adds both): registry → envelope + kebab → body `device_id` = token device (bootstrap admin: `'hub-admin'`) else 400 → `tenant_id` and `branch_id` = config else `403 BRANCH_MISMATCH` (M70) → session → `actor_id` → payload → `writer.run`: kind/permission resolved **inside** (§3.6, M39) → `handle` → `append` → INSERT `processed_commands { …, device_id, session_id, command_type, payload_hash: payloadHash(payload) }` → respond → `activity.touch(session_id)` (every command counts, M59). Test-only commands: `TestNoop` (`reprint-ticket`, event `TestNooped`), `TestApprovable` (`apply-discount`, `approvable`), `TestStation` (`stationScoped`, permission null), `TestFails` (throws `STAFF_NOT_FOUND`).

- [ ] **Step 1: Failing tests:** `[00 §10 #1]`, `#6`, `#7`, `#8`, `#9`, `#10`, `#11`, `#12` (as worded in spec §10.1); `[00 §10 #110] tenant_id ≠ config → 403 BRANCH_MISMATCH`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 22 command registry and route [spec §3.7, §6.1, M70]`

---

### Task 23: Idempotency, replay without session, in-transaction auth re-check

**Files:** Modify `apps/hub/src/commands/route.ts`; Create `apps/hub/test/commands/idempotency.int.test.ts`.

**Interfaces:** §3.7 exactly. Fast path (after the tenant/branch check, before the session check): row by `command_id`; match = (`/commands`: `row.device_id = req.device.device_id`; `/admin/commands`: `row.session_id = admin session id`) **and** same `command_type` **and** `row.payload_hash = payloadHash(payload)` → replay stored `{ status, body }` + `Idempotent-Replay: true`; row exists without a match → `400 VALIDATION_FAILED` (`issues: [{ path: 'command_id', message: 'command_id already used' }]`). Inside `writer.run`: the same re-check first; then if `authGeneration.current() !== req.authGen` → re-read device (`revoked_at` → `DEVICE_REVOKED`) and session (`ended_at` → `SESSION_EXPIRED`) (M39). Call `deps.testHooks.betweenGuardAndWriter?.()` right before `writer.run`.

- [ ] **Step 1: Failing tests:** `[00 §10 #2]`, `#3`, `#4`, `#5`, `#58`; `[00 §10 #85] revokeDevice committed in the hook → 403 DEVICE_REVOKED, no events`; `[00 §10 #86] endSession in the hook → 401 SESSION_EXPIRED; applyStaffDirectory removing the permission → 403 PERMISSION_DENIED`; `[00 §10 #99] other command_type 400; other payload 400; body device_id ≠ token 400; admin replay from another admin session 400; same admin session → replay`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 23 idempotent replay and in-transaction auth re-check [spec §3.7, M19, M34, M39, M47]`

---

### Task 24: Query registry and generic query route

**Files:** Create `apps/hub/src/queries/registry.ts`, `apps/hub/test/queries/route.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** `QueryDef { resource; sessionKind; session: 'required'|'none'; allowStation?; deviceTypes?; countsAsActivity?: boolean (default false); querySchema; handle(ctx, q) }`, `defineQuery`, `createQueryRegistry`, `pageParams` (default 50, max 200). `ctx.db` read-only. Activity touched only when `countsAsActivity` (M59).

- [ ] **Step 1: Failing tests:** `[00 §10 #13] no writes; activity refreshed only with countsAsActivity: true`; `[00 §6.2] limit above 200 → 400`; `[00 §6.2] deviceTypes → 403 DEVICE_TYPE_NOT_ALLOWED`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 24 query registry and route [spec §6.2, M59]`

---

### Task 25: Boot orchestrator and clock guard

**Files:** Create `apps/hub/src/lib/boot.ts`, `apps/hub/test/boot/boot.int.test.ts`; Modify `apps/hub/src/main.ts`.

**Interfaces:** `registerBootStep(step: '2'|'3'|'5'|'6', run)`; `boot({ configPath, wallNow, monoNow, listen?, ifaces? }): Promise<{ deps; app; step(); stop() }>`. Steps (§3.8): 0 config; 1 `openDb` + `deleteLeftoverPlaintext`; 1a migrations with `makePreMigrateBackup`; 2–3 registered; 3a `last = SELECT recorded_at FROM events WHERE branch_id = ? ORDER BY seq DESC LIMIT 1` (M48) → `createBranchClock`; alarm → `ClockAlarm { source: 'boot' }` as the first write; 4 `projections.catchUp`; 4a `StaffDirectory.load`; 4b in task 25b; 5, 6 registered; 7 build server (listen if asked). Unprovisioned → 0, 1, 1a, 7 setup mode. `main.ts` passes real clocks and exits 1 on error.

- [ ] **Step 1: Failing tests:** `[00 §10 #66] wall ≤ last recorded_at → ClockAlarm first, branchNow = last + 1`; `[00 §3.8] registered steps run in order`; `[00 §3.8] unprovisioned → setup mode routes only`; `[00 §3.10] invalid config → boot rejects with ConfigError`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 25 boot orchestrator and clock guard [spec §3.8, D48, M48]`

---

### Task 25b: Access reconciliation (restore safety)

**Files:** Create `apps/hub/src/projections/access-reconcile.ts`, `apps/hub/test/boot/restore.int.test.ts`; Modify `apps/hub/src/lib/boot.ts` (register the projection; step 4b).

**Interfaces:** forward-only projection `access_reconcile` (no `reset`), eventTypes `DevicePaired, DeviceTokenRotated, DeviceRevoked, SessionStarted, SessionEnded`; idempotent `apply` (M40): `DevicePaired` → mark the pairing token (`consumed_at = COALESCE(consumed_at, e.recorded_at)`) or pair request (`approved_at = COALESCE(…)`) by source id; `DeviceTokenRotated` (mode `'catchup'` only, **never live**, M74) → `UPDATE devices SET token_hash = 'rotated:' || event_id WHERE device_id = ? AND token_hash NOT LIKE 'rotated:%'`; `DeviceRevoked` → `revoked_at = COALESCE(revoked_at, e.recorded_at)`; `SessionEnded` → `ended_at = COALESCE(ended_at, e.recorded_at)`, `end_reason = COALESCE(end_reason, reason)`; `SessionStarted` (mode `'catchup'`) → remember `session_id` if no row exists. `afterCatchUp`: every remembered session with no `SessionEnded` in the replay → append `SessionEnded { reason: 'hub_restored' }`. Step 4b: `staff_sessions` empty **and** a `SessionStarted` event exists → end every session that has `SessionStarted` and no `SessionEnded` (`'hub_restored'`).

- [ ] **Step 1: Failing tests:** `[00 §10 #87] backup → revoke, force-logout, pair → restore copy + tail → revoked token 403, ended session 401, pairing token consumed, tablet paired after the copy 401` (in the test: copy the DB file; keep writing on the original; append the original's events with `seq >` the copy's max into the copy with raw INSERTs; boot the copy); `[00 §10 #88] tail SessionStarted with no row → hub_restored; empty staff_sessions with session events → step 4b runs; a normal boot writes no SessionEnded`; `[00 §10 #128] a live /devices/pair rotation keeps the new token_hash (the new token works after the live access_reconcile apply); the same event in boot catch-up sets 'rotated:<event_id>'` (use `appendEvents` + `projections.applyAll` with a `DeviceTokenRotated` draft for the live half, since `/devices/pair` is task 37); `[00 §10 #68] cloud-only restore: SessionStarted without SessionEnded and empty staff_sessions → SessionEnded hub_restored`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 25b access reconciliation on restore [spec §3.4, §3.8, M40, M48, M74]`

---

### Task 26: `/health`, heartbeat, `HubStarted`

**Files:** Create `apps/hub/src/lib/health.ts`, `apps/hub/test/boot/health.int.test.ts`; Modify `apps/hub/src/lib/boot.ts`.

**Interfaces:** `GET /health` (group `health`): guest → `{ status }`; else `{ status: 'booting'|'setup'|'ready', boot_step, provisioned, confirmed, branch_id|null, max_seq|null, hub_version, clock_alarm }` (M63). `startHeartbeat(db, clock, branchId): () => void`. Step 8 `HubStarted`.

- [ ] **Step 1: Failing tests:** `[00 §10 #14] /health in setup, booting and ready; no guest guard`; `[00 §10 #108] guest IP → { status } only`; `[00 §10 #71] HubStarted hub_down_at from the heartbeat; null on first boot`; `[F §5.8, D41] heartbeat every 60 s`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 26 health, heartbeat, HubStarted [spec §6.3, §3.8, D41, M63]`

---

### Task 26b: Boot budget on 1 M events

**Files:** Create `apps/hub/test/helpers/big-fixture.ts`, `apps/hub/test/boot/boot-budget.int.test.ts`.

**Interfaces:** `buildBigFixture(path, n = 1_000_000): void` — raw prepared INSERTs in transactions of 50 000, `TestNooped`-shaped events with increasing `seq` and `recorded_at`, checkpoint rows at `MAX(seq)` for every projection 00 registers; cached at `os.tmpdir()/pos-big-fixture-v1.sqlite` and copied per run.

- [ ] **Step 1: Failing test:** `[00 §10 #100] 00's boot steps on 1 M events within 5 s; 3a uses the max-seq row; a projection with checkpoint = MAX(seq) is not replayed` (`{ timeout: 600_000 }`; may be skipped in CI with `POS_SKIP_BIG=1`, but must pass before task 51).
- [ ] **Step 2–5:** run → FAIL (if a step is slow) → fix → PASS → commit `feat(00): task 26b boot budget test [spec §7.8, M48]`

---

### Task 27: Cloud skeleton, env, migrations, schema 0001

**Files:** Create `docker-compose.yml` (`postgres:16`, port 5433, db `pos_test`), `apps/cloud/src/server.ts`, `apps/cloud/src/lib/{env,clock,ids,secrets}.ts`, `apps/cloud/src/db/{client,migrate}.ts`, `apps/cloud/src/db/migrations/0001_platform.sql`, `apps/cloud/src/plugins/error-handler.ts`, `apps/cloud/test/helpers/{global-setup,test-cloud}.ts`, `apps/cloud/test/schema.int.test.ts`; Modify `apps/cloud/vitest.config.ts`, `apps/cloud/src/main.ts`.

**Interfaces:** `CloudEnvSchema` (`DATABASE_URL`, `JWT_SECRET` ≥ 32, `REFRESH_TOKEN_SECRET` ≥ 32, `PORT`, `HUB_MIN_VERSION`); `createPool(url)` (only importable inside `apps/cloud/src/db/` — rule added in task 28); `migrate(pool, dir, clock)`; `buildCloudServer({ pool, env, clock, ids, secrets })`; `createTestCloud()`, `truncateAll(pool)`. Schema = spec §5.2 v0.6.

- [ ] **Step 1: Failing tests (`[00 §5.2]`):** all tables exist and `idempotency_keys` does not; one live key per branch; `requires_approval` needs an approver; `status 'active'` requires `hub_confirmed_at`; `roles` has no `is_admin_role`; checksum change → `migrate` throws.
- [ ] **Step 2–5:** `docker compose up -d postgres && pnpm vitest run apps/cloud/test/schema.int.test.ts` → FAIL → implement → PASS → commit `feat(00): task 27 cloud skeleton and schema [spec §5.2, §7.7, M41, M57, M69]`

---

### Task 28: Cloud repositories and credential lookup

**Files:** Create `apps/cloud/src/db/{tenant-scoped-repository,tenant-level-repository,credential-lookup}.ts`, `apps/cloud/test/db/repositories.int.test.ts`; Modify `eslint.config.js` (D54: `no-restricted-imports` of `**/db/client` outside `apps/cloud/src/db/`).

**Interfaces:** `TenantContext { tenantId; branchIds }` (frozen); `TenantScopedRepository` (prepends `$1 tenant_id`, `$2 branch_ids`; SQL must reference both); `TenantLevelRepository` (prepends `$1`; SQL must reference `tenant_id = $1`); both throw `TypeError('TenantContext required')` without a frozen context. `credentialLookup`: `ownerByEmail`, `refreshTokenByHash(client, hash, forUpdate)`, `branchByApiKeyHash`, `registrationCodeByHash(client, hash, forUpdate)`.

- [ ] **Step 1: Failing tests:** `[00 §10 #75] both repositories throw without a TenantContext`; `[F §3.4] scoped SQL without placeholders throws`; `[00 §5.2] credential lookups work across tenants by hash/email only`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 28 cloud repositories and credential lookup [spec M16, M25, M55, F §3.4]`

---

### Task 29: Tenant-scope and owner-credentials plugins, route inventory, import pins

**Files:** Create `apps/cloud/src/plugins/{tenant-scope,owner-credentials,jwt}.ts`, `apps/cloud/test/route-inventory.int.test.ts`, `apps/cloud/test/import-pins.test.ts`; Modify `apps/cloud/src/server.ts`, `eslint.config.js` (M55 b: `credential-lookup` importable only from `plugins/tenant-scope.ts` and `plugins/owner-credentials.ts`).

**Interfaces:** routes declare `config.tenantScope: 'jwt' | 'branch-key' | 'registration-code' | 'none'`; `'none'` only for `TENANT_SCOPE_ALLOWLIST = ['POST /v1/auth/login', 'POST /v1/auth/refresh', 'GET /v1/health']`; `jwt` (HS256; claims → `TenantContext`; `401 JWT_INVALID`); `branch-key` (`401 BRANCH_API_KEY_INVALID`); `registration-code` (normalised `body.registration_code` → `TenantContext`; unknown → `401 REGISTRATION_CODE_INVALID`). `owner-credentials` decorates `app.ownerCredentials = { byEmail(email), refreshByHash(client, hash, forUpdate) }`.

- [ ] **Step 1: Failing tests:** `[00 §10 #76] every cloud route has a tenant scope, tenant-level routes included; none only for the allowlist`; `[F §3.4] bad JWT → 401 JWT_INVALID`; `[00 §10 #113] credential-lookup imported only by the two plugins; SystemContext only from cli/` (walks `apps/cloud/src` import lines; the `SystemContext` half passes vacuously until task 30, which extends it).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 29 tenant-scope and owner-credentials plugins [spec M15, M25, M55, F §3.4]`

---

### Task 30: `SystemContext` and CLI `seed-tenant`

**Files:** Create `apps/cloud/src/cli/{system-context,seed-tenant}.ts`, `apps/cloud/src/modules/staff-roles/default-roles.ts`, `apps/cloud/test/cli/seed-tenant.int.test.ts`; Modify `apps/cloud/package.json` (script `seed-tenant`: `tsx src/cli/seed-tenant.ts`), `eslint.config.js` (M56: `cli/system-context` importable only from `apps/cloud/src/cli/`), `apps/cloud/test/import-pins.test.ts`.

**Interfaces:** `class SystemContext { constructor(pool); query<R>(sql, params): Promise<R[]>; tx<T>(fn: (c: SystemContext) => Promise<T>): Promise<T> }`. `DEFAULT_ROLES` per spec §6.26 (no flag; Owner and Manager include `access-hub-admin` and `manage-devices`). `seedTenant(sys, { name, currency, ownerEmail, ownerName, password, pin }, deps): Promise<{ tenant_id; user_id; staff_id }>`; CLI prompts twice each, no echo.

- [ ] **Step 1: Failing tests:** `[00 §10 #56] seed creates the roles; password and PIN hashes verify; the owner staff holds access-hub-admin and manage-devices; duplicate email refused` (HTTP login half added in task 47); extend the existing import-pins test from task 29 with the `SystemContext` allowlist (no new test name).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 30 SystemContext and seed-tenant [spec §6.26, M29, M56, M57]`

---

### Task 31: CLI `issue-registration-code`

**Files:** Create `apps/cloud/src/cli/{issue-registration-code,codes}.ts`, `apps/cloud/test/cli/issue-code.int.test.ts`; Modify `apps/cloud/package.json` (script).

**Interfaces:** `codes.ts`: `generateCode(secrets): string` (`XXXX-XXXX-XXXX`), `normaliseCode(input): string`. `issueRegistrationCode(sys, { tenantId } & ({ branchName } | { branchId }), deps): Promise<{ code; branch_id; expires_at }>`: new branch `pending_hub`; `staff_branches` for every staff whose roles grant `access-hub-admin` `allowed`; `allowed_branch_ids = array_append(…)` for every owner of the tenant (M57). Reissue: branch must have `hub_confirmed_at IS NULL` (M41, M22) else throw; expire unconsumed codes.

- [ ] **Step 1: Failing tests:** `[00 §10 #57] new branch: Owner and Manager assigned; owners' allowed_branch_ids include it; reissue for an unconfirmed branch expires the old code; reissue after confirm refused`; `[00 §6.27] normaliseCode('abcd-efgh jkmn') === 'ABCDEFGHJKMN'`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 31 issue-registration-code [spec §6.27, M22, M41, M57]`

---

### Task 32: Cloud `POST /v1/hubs/register`

**Files:** Create `apps/cloud/src/modules/hub-registration/{routes,service,repository,schemas}.ts`, `apps/cloud/test/hub-registration.int.test.ts`; Modify `apps/cloud/src/server.ts`.

**Interfaces:** `tenantScope: 'registration-code'`; request/response per spec §6.5 (response `directory` = `DirectorySchema`); one transaction with `FOR UPDATE`; consume the code, **do not** change branch status (M41); key = `secrets.token256()`; log `hub_registered { tenant_id, branch_id, kind, rotated }`.

- [ ] **Step 1: Failing tests:** `[00 §10 #22]`, `#23`, `#24`, `#25`, `#61` (as worded in spec §10).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 32 hubs/register [spec §6.5, M14, M15, M41]`

---

### Task 32b: Cloud `POST /v1/hubs/confirm`

**Files:** Modify `apps/cloud/src/modules/hub-registration/{routes,service,repository,schemas}.ts`; Create `apps/cloud/test/hub-confirm.int.test.ts`.

**Interfaces:** `tenantScope: 'branch-key'`; body `{ hub_version }`; `UPDATE branches SET status = 'active', hub_confirmed_at = COALESCE(hub_confirmed_at, $now)`; expire unconsumed codes; response `{ branch_id, hub_confirmed_at }`.

- [ ] **Step 1: Failing tests:** `[00 §10 #89] no confirm: after 1 h the same code → 401; reissue for the unconfirmed branch → new code → register works`; `[00 §10 #90] confirm sets active + hub_confirmed_at; repeat returns the same value; bad key → 401` (hub task half: task 33b).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 32b hubs/confirm [spec §6.28, M41]`

---

### Task 33: Hub `POST /setup/provision`, setup page, bootstrap token

**Files:** Create `apps/hub/src/setup/{provision,cloud-client,page}.ts`, `apps/hub/src/auth/bootstrap-tokens.ts`, `apps/hub/src/lib/qr.ts`, `apps/hub/src/lib/qr.test.ts`, `apps/hub/test/helpers/stub-cloud.ts`, `apps/hub/test/setup/provision.int.test.ts`; Modify `apps/hub/src/server.ts`, `apps/hub/src/lib/boot.ts`.

**Interfaces:** `CloudClient { registerHub(body, idempotencyKey); confirmHub(apiKey, body) }`; `httpCloudClient(baseUrl, timeoutMs = 10_000)` (global `fetch` + `AbortSignal.timeout`; errors `CloudUnreachableError`, `CloudError(status, code, details)`); `registerSetupRoutes(app, deps & { cloud, configPath, exit })`. Steps §6.4 1–8 (v0.6): input per M58 (`guest_network_cidrs` min 1, each valid; `advertised_host` ∈ `deps.ownIPv4`); step 6 also calls `issueAdminBootstrap(tx, 'setup')` from `auth/bootstrap-tokens.ts`: `issueAdminBootstrap(tx: WriterTx, issuedBy: 'setup'|'cli'|'restore', deps: { clock; ids; secrets }): { token: string; bootstrap_token_id: string; expires_at: number }` — sets `expires_at = now` on every live token, inserts a new one (hash; `expires_at = now + 1 800 000`), appends `AdminBootstrapTokenIssued { …, issued_by }` (actor null, device `'hub'`); response includes `first_admin_url` (`/admin/bootstrap#t=<token>`), `first_admin_qr_svg` and `first_admin_expires_at`. `lib/qr.ts`: `qrSvg(text: string): string` — synchronous; `QRCode.create(text, { errorCorrectionLevel: 'M' })`, then one `<svg viewBox>` with a single `<path>` of the dark modules and a 4-module quiet zone (M77). The setup page shows the link and inserts the SVG; add `qrcode@1.5.4` to `apps/hub/package.json` here if task 35c has not yet. Add `apps/hub/package.json` to Files when you do. The hub must not import cloud code: copy the 4-line `normaliseCode` into `provision.ts`.

- [ ] **Step 1: Failing tests:** `[00 §10 #15]`, `#16`, `#17`, `#18`, `#19`, `#20` (as worded in spec §10); `[00 §10 #105] empty cidrs → 400; advertised_host not own → 400; malformed code → 400`; `[00 §3.1 M77] qrSvg is deterministic, contains no <script>, and has the same dark modules as QRCode.create for that text`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 33 setup provisioning and bootstrap token [spec §6.4, §3.2, M13, M14, M42, M58, M71]`

---

### Task 33b: Hub confirm task

**Files:** Create `apps/hub/src/setup/confirm-task.ts`, `apps/hub/test/setup/confirm-task.int.test.ts`; Modify `apps/hub/src/lib/boot.ts` (start at step 7 when provisioned and not confirmed).

**Interfaces:** `startConfirmTask({ cloud, config, configPath, clock, log }): () => void` — call `confirmHub` now and every 60 000 ms until success; success → `writeHubConfigAtomic` with `provisioned.confirmed_at`, stop; network error, 5xx or 401 → log, retry.

- [ ] **Step 1: Failing test:** `[00 §3.1 M41] confirm task writes confirmed_at and stops; retries after a 503 and after a network error`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 33b hub confirm task [spec §6.28, M41]`

---

### Task 34: PIN verification and lockouts

**Files:** Create `apps/hub/src/auth/pin.ts`, `apps/hub/test/auth/pin.int.test.ts`.

**Interfaces:** `RateSubject = { type: 'device' | 'ip'; id }`; `checkPin<T>(deps: { db; writer; directory: () => StaffDirectory; clock; config; semaphore: Semaphore; verify }, o: { staffId; pin; subject; eventDeviceId }, onMatch: (tx) => T): Promise<T>`. §3.5 steps 2–9; expired locks reset counters (M62); locked → `PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT` / `IP_LOCKED_OUT` with `retry_after_ms`; mismatch → commit counters + lockout event, then `PIN_INVALID { attempts_remaining }`; semaphore timeout → `SERVICE_UNAVAILABLE { retry_after_ms: 1000 }`.

- [ ] **Step 1: Failing tests:** `[00 §10 #59] parallel wrong PINs cross the threshold while a correct PIN verifies → 429`; `[00 §10 #107] after a lock expires, one wrong PIN → attempts_remaining 4`; `[00 §3.5] 5th failure writes StaffPinLockedOut; success resets only the staff counter`; `[00 §3.5] device window restarts after 300 000 ms`; `[00 §3.5] PIN "0123" verifies against a hash of "0123" and not "123"` (real argon2); `[00 §7.4] semaphore full for 2 s → 503 retry_after_ms 1000`; `[00 §3.5] ip subject locks with IP_LOCKED_OUT and DevicePinLockedOut subject_type ip`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 34 PIN verification and lockouts [spec §3.5, M23, M62]`

---

### Task 35: Admin auth (device-bound), admin logout, login roster

**Files:** Create `apps/hub/src/auth/admin-session.ts`, `apps/hub/test/auth/admin-session.int.test.ts`; Modify `apps/hub/src/server.ts` (creates two semaphores: PIN `auth.argon2_concurrency`, admin `auth.admin_argon2_concurrency`).

**Interfaces:** `POST /admin/auth` (group `admin-device-public`: host, provisioned, guest, device token; `device_type ∈ {tablet, cashier_kiosk, phone}`; phone owner check before PIN work) per §6.6; `POST /admin/auth/logout` per §6.12; `GET /admin/login-roster` per §6.13 (device token of the three types, or `X-Admin-Bootstrap` with a live, unconsumed bootstrap token).

- [ ] **Step 1: Failing tests:** `[00 §10 #26]`, `#27`, `#40`, `#41`, `#91`, `#93` (as worded in spec §10); `[00 §10 #114] STAFF_NOT_FOUND on /admin/auth; PIN_LOCKED_OUT on /admin/auth` (the `/auth/pin` STAFF_NOT_FOUND case is a separate `[00 §6.9]` test in task 39).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 35 admin session and roster [spec §6.6, §6.12, §6.13, M42]`

---

### Task 35b: First-admin bootstrap

**Files:** Create `apps/hub/src/auth/admin-bootstrap.ts`, `apps/hub/test/auth/admin-bootstrap.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** `POST /admin/auth/bootstrap` (group `admin-bootstrap`) per §6.29; `GET /admin/bootstrap` serves a static page that reads `location.hash`, calls the roster with `X-Admin-Bootstrap`, posts the login, then `history.replaceState` to drop the hash.

- [ ] **Step 1: Failing test:** `[00 §10 #92] one admin session without a device; second use 401; after 30 min 401; 10 wrong PINs from one IP → 429 IP_LOCKED_OUT; the page reads location.hash and calls replaceState, and never sends the token in a URL query` (static check of the served HTML).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 35b first-admin bootstrap [spec §6.29, M42]`

---

### Task 35c: Hub CLI `issue-admin-bootstrap` (admin recovery)

**Files:** Create `apps/hub/src/setup/issue-admin-bootstrap.ts`, `apps/hub/test/setup/issue-admin-bootstrap.int.test.ts`; Modify `apps/hub/package.json` (dependency `qrcode@1.5.4`; script `issue-admin-bootstrap`: `tsx src/setup/issue-admin-bootstrap.ts`).

**Interfaces — Produces:**
```ts
export async function runIssueAdminBootstrap(o: { configPath: string; wallNow: () => number; monoNow: () => number;
  uid: number; out: NodeJS.WritableStream }): Promise<{ url: string; expires_at: number }>;
// entry (bottom of the file, only when run directly): runIssueAdminBootstrap({ configPath: process.env.POS_HUB_CONFIG ?? DEFAULT_CONFIG_PATH,
//   wallNow: Date.now, monoNow: () => performance.now(), uid: process.getuid!(), out: process.stdout }), exit 1 on error
```
Behaviour (§6.34, M72): unprovisioned → throw "run setup instead"; `uid` ≠ owner uid of `config.data_dir` → throw; `openDb` (no migrations, no server); register 00's projections; branch clock from the max-seq row (D48); `writer.run(tx ⇒ issueAdminBootstrap(tx, 'cli', deps))`; print the URL, the expiry (ISO), and `await QRCode.toString(url, { type: 'terminal', small: true })`.

- [ ] **Step 1: Failing test:** `[00 §10 #127] after the setup token expires, the CLI prints a new link that opens an admin session; the old link → 401 PAIRING_TOKEN_INVALID; a second run expires the first CLI token; AdminBootstrapTokenIssued { issued_by: 'cli' } written; works while a TestHub holds the same database file open` (boot a TestHub on a file DB, run the CLI function against the same file, then call `/admin/auth/bootstrap` on the TestHub); `[00 §6.34] refuses when unprovisioned and when run as another uid`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 35c issue-admin-bootstrap CLI [spec §6.34, M72]`

---

### Task 36: `GenerateDevicePairingToken` (tablet, phone)

**Files:** Create `apps/hub/src/commands/generate-device-pairing-token.ts`, `apps/hub/src/auth/station-validator.ts`, `apps/hub/test/commands/generate-pairing-token.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** `registerStationValidator(fn)`, `stationExists(tx, id)` (false until registered). Command per §6.7 v1.0.1: payload `{ device_type: 'tablet'|'phone', owner_staff_id? }` (iff phone); result `{ pairing_token, pairing_token_id, expires_at, pair_url, pair_qr_svg: qrSvg(pair_url) }` (M77).

- [ ] **Step 1: Failing tests:** `[00 §10 #28]`, `[00 §10 #80]` (as worded in spec §10).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 36 pairing token command [spec §6.7, M38, M44]`

---

### Task 37: `POST /devices/pair` and the phone/tablet pair page

**Files:** Create `apps/hub/src/auth/{pairing,pair-page}.ts`, `apps/hub/test/auth/pairing.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** `POST /devices/pair` (group `pair`) per §6.8 v0.6 (rotation appends `DeviceTokenRotated`; 600 000 ms or more after consumption, or revoked → 401). `GET /pair` serves one static page: with `?t=` → phone rules 1–4 (§8.2); without `t` → screen flow (task 38; until then it shows "Ask a manager"). The page: no service worker; `crypto.getRandomValues` for `pair_request_id`; IndexedDB for the token; if `sessionStorage` holds an admin token, call `POST /admin/auth/logout` and clear `sessionStorage` before anything else (M43).

- [ ] **Step 1: Failing tests:** `[00 §10 #29]`, `#30`, `#84`, `#118` (as worded in spec §10); `[00 §10 #94] the served page logs out an admin session and clears sessionStorage before pairing, and uses neither randomUUID nor serviceWorker; after the logout call the admin token → 401`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 37 device pairing and pair page [spec §6.8, §8.2, M14, M38, M43, M60]`

---

### Task 38: Pairing requests — create and poll

**Files:** Create `apps/hub/src/auth/pair-requests.ts`, `apps/hub/test/auth/pair-requests.int.test.ts`; Modify `apps/hub/src/auth/pair-page.ts`, `apps/hub/src/server.ts`.

**Interfaces:** `POST /pair/requests` (group `pair-request`) per §6.30 v1.0 (stores `requester_ip = req.ip`; ≥ 2 pending from that IP → `429 IP_LOCKED_OUT { retry_after_ms }` until its oldest pending expires; ≥ 10 pending → 503, M76); `GET /pair/requests/:id` (header `X-Poll-Secret`) per §6.31 — `approved` + token only while `now < expires_at`, else 404 even if approved; `clearExpiredDeliveryTokens(tx, now)` (called by the sweeper, task 41). Response adds `approve_qr_svg: qrSvg(approve_url)` (M77). Pair page without `t`: create a request, show `approve_qr_svg` and the display code in large type, poll every 2 000 ms, store the token; KDS → `POST /auth/station`.

- [ ] **Step 1: Failing tests:** `[00 §10 #95] create → pending → approved (insert the approval rows directly; the command is task 38b) → token twice → after expires_at 404 and delivery_token cleared by clearExpiredDeliveryTokens; wrong secret 404; 11th pending → 503`; `[00 §6.31] polled after approval but after expires_at → 404 and no delivery_token in the row (Review Focus 5)`; `[00 §10 #130] third pending request from one IP → 429 IP_LOCKED_OUT with retry_after_ms; other IPs still succeed; 11th pending overall → 503`; `[00 §10 #131] the setup (§6.4), pairing-token (§6.7) and pairing-request (§6.30) responses carry an SVG equal to qrSvg(their URL), with no <script>`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 38 pairing requests [spec §6.30, §6.31, M44, M76]`

---

### Task 38b: `ApprovePairingRequest`

**Files:** Create `apps/hub/src/commands/approve-pairing-request.ts`, `apps/hub/test/commands/approve-pairing-request.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** per §6.32. Admin approve page `GET /admin/approve` (group `admin`; static; reads `r`, asks for the display code, type and station, posts the command).

- [ ] **Step 1: Failing test:** `[00 §10 #96]` (as worded in spec §10).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 38b approve pairing request [spec §6.32, M31, M44]`

---

### Task 39: `POST /auth/pin` and `POST /auth/logout`

**Files:** Create `apps/hub/src/auth/staff-session.ts`, `apps/hub/test/auth/staff-session.int.test.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** §6.9 v0.6 (step 0: idle-expired holder ended first, M46; activity counts) and §6.10 (station → `403 STATION_LOGOUT_NOT_ALLOWED`).

- [ ] **Step 1: Failing tests:** `[00 §10 #31]`, `#32`, `#33`, `#34`, `#35`, `#36`, `#37`, `#38`, `#60`, `#81` (as worded in spec §10); `[00 §6.9] STAFF_NOT_FOUND on /auth/pin`; `[00 §3.1 M46] an idle-expired holder does not cause 409; the new login succeeds` (completes #98).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 39 staff PIN session and logout [spec §6.9, §6.10, M6, M20, M38, M46]`

---

### Task 40: `POST /auth/station`

**Files:** Create `apps/hub/src/auth/station-session.ts`, `apps/hub/test/auth/station-session.int.test.ts`; Modify `apps/hub/src/server.ts`.

- [ ] **Step 1: Failing test:** `[00 §10 #39] happy path; second call replaces; tablet → 403` (socket half #104 in task 45).
- [ ] **Step 2–5:** run → FAIL → implement per §6.11 → PASS → commit `feat(00): task 40 station session [spec §6.11, M30]`

---

### Task 41: Session sweeper and retention

**Files:** Create `apps/hub/src/auth/session-sweeper.ts`, `apps/hub/test/auth/session-sweeper.int.test.ts`; Modify `apps/hub/src/lib/boot.ts`.

**Interfaces:** `sweepOnce(deps): { ended: string[] }` (flush `activity.drain()` / `drainDevices()`; end idle non-station sessions; `clearExpiredDeliveryTokens`); `startSweeper(deps): () => void` (15 000 ms); `retentionOnce(deps, now): { deleted: number }` (only when the hub-local hour of `now` = `maintenance_hour`, once per local day; batches of 500, each its own `writer.run`; tables per §5.1); `setMaintenanceHour(h)` (0–23; exported for 06).

- [ ] **Step 1: Failing tests:** `[00 §10 #69]`, `[00 §10 #121]` (as worded in spec §10).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 41 session sweeper and retention [spec §3.4, §5.1, §7.3, M66]`

---

### Task 42: Admin commands — revoke device, force logout, clear lockout

**Files:** Create `apps/hub/src/commands/{revoke-device,force-logout-session,clear-pin-lockout}.ts`, `apps/hub/test/commands/admin-commands.int.test.ts`; Modify `apps/hub/src/server.ts`.

- [ ] **Step 1: Failing tests:** `[00 §10 #42]`, `#43`, `#44` (as worded; revoke also ends bound admin sessions; socket closes in task 45).
- [ ] **Step 2–5:** run → FAIL → implement per §6.14–§6.16 → PASS → commit `feat(00): task 42 admin access commands [spec §6.14–§6.16]`

---

### Task 43: Access queries

**Files:** Create `apps/hub/src/queries/{devices,sessions,staff-roster,session}.ts`, `apps/hub/test/queries/access-queries.int.test.ts`, `apps/hub/test/helpers/statement-counter.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** shapes §6.17–§6.20 v0.6 (`devices` with `owner_staff_id`, `pairing_source`; sessions without `client_ip`); all `countsAsActivity: false`.

- [ ] **Step 1: Failing tests:** `[00 §10 #45]`, `#46`, `#47`, `#82`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 43 access queries [spec §6.17–§6.20]`

---

### Task 44: WebSocket — auth frame and catch-up

**Files:** Create `apps/hub/src/ws/{server,catch-up}.ts`, `apps/hub/test/ws/ws-auth.int.test.ts`, `apps/hub/test/helpers/ws-client.ts`; Modify `apps/hub/src/server.ts`.

**Interfaces:** `SocketCtx { deviceId; deviceType; sessionId; kind: 'staff'|'station'; staffId; stationId; asOfSeq }`; `registerCatchUp`; `registerWs(app, deps): WsHub`. §6.21: host + guest checks on upgrade (close 4403, zero frames); nothing sent before auth; 5 000 ms; `as_of_seq = writer.lastSeq()`; built-in `hub` part (M37). Query-string tokens ignored.

- [ ] **Step 1: Failing tests:** `[00 §10 #48]`, `#49`, `#50`, `#51` (as worded); `[00 §10 #119] GUEST_NETWORK_FORBIDDEN on /admin/auth, /admin/queries/devices, /pair/requests, and WS close 4403 before auth`; `[00 §3.1 M45] WS upgrade with a bad Host closes 4403` (WS half of #97).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 44 websocket auth and catch-up [spec §6.21, M12, M24, M37, M45]`

---

### Task 45: WebSocket — publish filter, audiences, keepalive, closes

**Files:** Create `apps/hub/src/ws/audience.ts`, `apps/hub/test/ws/ws-publish.int.test.ts`; Modify `apps/hub/src/ws/server.ts`, `apps/hub/src/lib/boot.ts` (writer `publish` → WS).

**Interfaces:** `registerEventAudience(type, fn)`; built-ins: `ClockAlarm` → all; `SessionEnded` → that session's sockets, then close 4401 with close reason = `reason`; `DeviceTokenRotated` → that device's sockets, close 4401; `DeviceRevoked` → that device's sockets, close 4403. Publish filter `event.seq > socket.asOfSeq`. Ping 15 000 ms, terminate at 30 000 ms; pongs/acks never touch activity. Shutdown 1012.

- [ ] **Step 1: Failing tests:** `[00 §10 #52]`; `[00 §10 #104] second /auth/station → first socket gets SessionEnded replaced, close 4401 reason 'replaced'`; `[00 §10 #112] a socket registered in writer testHooks.beforePublish gets the event once`; `[00 §4.2] DeviceRevoked (manual and owner_removed) delivered then 4403` (completes #42, #83).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 45 websocket publish and audiences [spec §6.21, §4.2, M53]`

---

### Task 46: CORS and log-redaction sweep

**Files:** Modify `apps/hub/src/server.ts`; Create `apps/hub/test/{cors,log-redaction}.int.test.ts`.

**Interfaces:** §7.5 v0.6: groups `device`, `device-session`, `pair`, `pair-request` get CORS for `cors_origins` (+ `Vary: Origin`), preflight headers `Authorization, X-Session-Token, X-Client-Version, X-Poll-Secret, Content-Type`, methods `GET, POST`; never admin groups or setup.

- [ ] **Step 1: Failing tests:** `[00 §10 #120]` (as worded); `[00 §10 #73] no secret from setup, bootstrap, admin auth, pairing token, pair, pairing request, PIN login, station login, logout appears in the logs`.
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 46 CORS and log redaction [spec §7.2, §7.5, M35]`

---

### Task 47: Cloud owner login

**Files:** Create `apps/cloud/src/modules/owner-auth/{routes,service,repository,schemas}.ts`, `apps/cloud/test/owner-auth/login.int.test.ts`; Modify `apps/cloud/src/server.ts`, `apps/cloud/test/cli/seed-tenant.int.test.ts` (add the HTTP login assertion to #56).

**Interfaces:** `POST /v1/auth/login` (`tenantScope: 'none'`) per §6.22 v1.0 (M64, M69, **M73: while locked, verify only the dummy hash, answer `401 LOGIN_INVALID`, leave the account counter unchanged, count the IP failure; never return `LOGIN_LOCKED_OUT`**): in-memory `createIpLimiter({ max: 30, windowMs: 900_000, clock })`; atomic counter `UPDATE … RETURNING`; `issueTokens(client, user, deps)` (also used by task 48); credentials through `app.ownerCredentials`.

- [ ] **Step 1: Failing tests:** `[00 §10 #53]`, `#109`, `#126` (as worded in spec §10).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 47 owner login [spec §6.22, M33, M62, M64, M69, M73]`

---

### Task 48: Cloud refresh and logout

**Files:** Modify `apps/cloud/src/modules/owner-auth/{routes,service,repository,schemas}.ts`; Create `apps/cloud/test/owner-auth/refresh.int.test.ts`.

**Interfaces:** §6.23 v0.6: successor = base64url(`HMAC-SHA256(REFRESH_TOKEN_SECRET, old_token)`); within 30 000 ms of rotation the same token returns the same successor and writes nothing; later reuse revokes all. §6.24 logout.

- [ ] **Step 1: Failing tests:** `[00 §10 #54]`, `#55`, `#123` (as worded in spec §10).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 48 owner refresh and logout [spec §6.23, §6.24, M49]`

---

### Task 49: Cloud health and cross-tenant suite

**Files:** Create `apps/cloud/src/modules/health/routes.ts`, `apps/cloud/test/{health,cross-tenant}.int.test.ts`; Modify `apps/cloud/src/server.ts`.

- [ ] **Step 1: Failing tests:** `[00 §10 #125] /v1/health ok; db down → 503`; `[00 §10 #77] every scoped route with tenant A's credentials returns no tenant B id` (seed A and B with `seedTenant` + `issueRegistrationCode`; iterate the route inventory; scopes `jwt` and `branch-key`).
- [ ] **Step 2–5:** run → FAIL → implement → PASS → commit `feat(00): task 49 cloud health and cross-tenant tests [spec §6.25, M25, F §3.4]`

---

### Task 50: systemd unit and hardware smoke test

**Files:** Create `apps/hub/deploy/hub.service`, `apps/hub/test/smoke/{smoke.ts,README.md}`; Modify `apps/hub/package.json` (script `smoke`).

**Interfaces:** unit: `Type=simple`, `WorkingDirectory=/opt/pos-hub/apps/hub`, `ExecStart=/usr/bin/node --import tsx src/main.ts` (no build step exists and `@pos/domain` / `@pos/events` export `.ts` source; `tsx@4.23.15` is a hub dependency, build review 2 item 1), `Restart=always`, `RestartSec=1`, `After=time-sync.target network-online.target`, `Wants=time-sync.target network-online.target`, `User=poshub`, `Environment=POS_HUB_CONFIG=/etc/pos-hub/config.json`. `smoke.ts` prints `[00 §10 #79]` lines per §7.8 target and exits 1 on a miss; it also runs the #100 fixture boot.

- [ ] **Step 1: Write** `smoke.ts`. **Step 2: Run** `pnpm --filter @pos/hub smoke` on a dev machine. **Step 3: Commit** `feat(00): task 50 systemd unit and smoke test [spec §7.8, M13, M36]`

**Done when:** `systemd-analyze verify apps/hub/deploy/hub.service` reports no errors on a Linux machine.

---

### Task 51: Foundation error table and README — **NOT for Cursor**

Done by the spec owner. The codes already exist in `errors.ts` (task 2 / 5b); this task only edits docs.

- [ ] Append the §9 codes to the foundation §6.2 status table (the one allowed foundation edit, D64).
- [ ] `docs/specs/README.md`: 00 status → Implemented.
- [ ] Commit `docs(00): append error codes to foundation, mark 00 implemented [spec §9, D64]`.

---

### Tasks 52–60: spec v1.1 and build review 1 follow-ups

Defined in `docs/reviews/00_build_review_2.md` (numbered fix list; item *n* is task 51+*n*). Each item cites its spec section; v1.1 items (M78–M80, #132–#134) start only after the owner approves spec v1.1.

---

### Tasks 67–71: spec v1.2 — UI kit on the 00 pages (M81, M82)

Source of the kit: `packages/ui-kit/` (`tokens.css`, `components/bundle.css`, `fonts/*.woff2` with their OFL licences, `README.md`). Shared page code lives in `apps/hub/src/lib/`: `ui-assets.ts` (route + `?v=` hash), `strings.ts` (`EN`), `page.ts` (`<head>`, in-page `t()` / error text, icons). One commit per task.

- **Task 67 — UI kit and `GET /ui/*`** (§6.35, M81, #135). Files: `packages/ui-kit/**`, `apps/hub/src/lib/ui-assets.ts`, `auth/guards.ts` (group `static`), `server.ts`, `lib/boot.ts` (setup-mode server), `test/ui-assets.int.test.ts`, `test/auth/guards.int.test.ts`. Commit `feat(00): task 67 UI kit static route [spec §6.35, M81]`.
- **Task 68 — setup page** (§8.2, M82, #136 setup part, #137). Files: `lib/strings.ts`, `lib/page.ts`, `setup/page.ts`, `test/helpers/page-sandbox.ts`, `test/setup/setup-page.int.test.ts`, `test/ui-pages.int.test.ts`. Commit `feat(00): task 68 setup page on the UI kit [spec §8.2, M82]`.
- **Task 69 — bootstrap page** (#136, #138). Files: `auth/admin-bootstrap.ts`, `test/auth/admin-bootstrap-page.int.test.ts`. Commit `feat(00): task 69 bootstrap page on the UI kit [spec §8.2, M82]`.
- **Task 70 — approve page** (#136, `[00 §8.4]` approve test). Files: `commands/approve-pairing-request.ts`, `test/commands/approve-pairing-request.int.test.ts`. Commit `feat(00): task 70 approve page on the UI kit [spec §8.2, §8.4, M82]`.
- **Task 71 — pair page** (#136, #139, `[00 §8.4]` pair test). Files: `auth/pair-page.ts`, `test/auth/pairing.int.test.ts`. Commit `feat(00): task 71 pair page on the UI kit [spec §8.2, §8.4, M82]`.

**Done when:** #135–#139 pass, the existing page tests (#92, #94, #133, the two `[00 §8.4]` tests) pass, and the §12.1 grep finds exactly one test per number.

### Tasks 77–81: spec v1.3 — module 00 design hand-off (M83–M90)

Source: `docs/design/handoff/00/` (`00-design.md`, frames, `PLAN.md`). Already done before v1.3: hand-off phase 1 (kit, `e2d63aa`) and phase 2 (global-state helper, `e6c7ed1`). The owner asked for **one commit per hand-off phase**, so these tasks are grouped into phase commits `feat(00): <phase> [spec …]`.

- **Task 77 — hand-off phase 3: existing pages restyled** (§8.2, M83–M85, M89, §6.18b; #136, #137, #140, #141, #145, #147). Files: `lib/strings.ts` (`UR`), `lib/page.ts` (language), `setup/page.ts`, `setup/provision.ts`, `auth/admin-bootstrap.ts`, `commands/approve-pairing-request.ts`, `auth/pair-page.ts`, `auth/admin-session.ts` (permissions), `queries/stations.ts`, tests. The `stations` query and sign-in `permissions` move here from phase 4 because the approve page needs them.
- **Task 78 — hand-off phase 4: admin queries** (§6.17, §6.18a, §6.18c, M87, M88; #143, #144, #146; Q8 `last_seen_at` check; missing tests for the four admin commands). Files: `queries/devices.ts`, `queries/lockouts.ts`, `queries/staff.ts`, `queries/registry.ts`, tests.
- **Task 79 — hand-off phase 5: `/admin` page** (M86; #142). Files: `admin/page.ts`, `admin/routes.ts`, `server.ts`, `auth/guards.ts` (route group), tests.
- **Task 80 — hand-off phase 6: docs** (`docs/design/ui-brief.md` §1, `00-design.md`, open questions).
- **Task 81 — Q5 waiter tablets**: blocked until the owner approves the `device_type` enum change; not in v1.3.

**Done when:** #136, #137 and #140–#147 pass, every earlier test passes, and the §12.1 grep finds exactly one test per number.

---

## Coverage check (spec §10 → task)

| Tests | Task |
|---|---|
| 136, 137, 140, 141, 145, 147 | 77 |
| 143, 144, 146 | 78 |
| 142 | 79 |
| 1, 6–12, 110 | 22 |
| 2–5, 58, 85, 86, 99 | 23 |
| 13 | 24 |
| 14, 71, 108 | 26 |
| 15–20, 105 | 33 |
| 21, 72, 97 (HTTP) | 20 |
| 22–25, 61 | 32 |
| 26, 27, 40, 41, 91, 93, 114 | 35 |
| 28, 80 | 36 |
| 29, 30, 84, 94, 118 | 37 |
| 31–38, 60, 81 | 39 |
| 39 | 40 |
| 42–44 | 42 |
| 45–47, 82 | 43 |
| 48–51, 119 | 44 |
| 52, 104, 112 | 45 |
| 53, 109, 126 | 47 |
| 54, 55, 123 | 48 |
| 56 | 30 (+47) |
| 57 | 31 |
| 59, 107 | 34 |
| 62 | 12 |
| 63 | 13 |
| 64, 111, 124 | 11 (checksum half in 10) |
| 65 | 8 |
| 66 | 25 |
| 67 | 14 |
| 68, 87, 88 | 25b |
| 69, 121 | 41 |
| 70, 83, 101, 102, 103 | 19 (socket half of 83 in 45) |
| 73, 120 | 46 |
| 74 | 3 |
| 75 | 28 |
| 76, 113 | 29 (+30) |
| 77, 125 | 49 |
| 78 | 18 |
| 79 | 50 |
| 89, 90 | 32b (+33b) |
| 92 | 35b |
| 95 | 38 |
| 96 | 38b |
| 98 | 21 (+39) |
| 100 | 26b |
| 106, 115, 116, 117 | 21 |
| 122 | 9 |
| 127 | 35c |
| 128 | 25b |
| 129 | 19 |
| 130 | 38 |
| 131 | 38 (helper test in 33) |
| 135 | 67 |
| 136 | 68–71 |
| 137 | 68 |
| 138 | 69 |
| 139 | 71 |
