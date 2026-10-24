# Build log — module 00

## Task 2 — domain ids, enums, error catalogue
Commit `76bad33`. Tests: `[F §6.2]` catalogue scan and DomainError details, `[00 §9]` spec 00 statuses, `[F §6.6]` ULID_RE. Full suite 4/4.
Assumed the catalogue is the v1.0 list in the current plan (includes `HOST_NOT_ALLOWED`, `STATION_LOGOUT_NOT_ALLOWED`, `PAIRING_REQUEST_NOT_FOUND`, `IP_LOCKED_OUT`, and `credentials_changed` on `SessionEndReason`). `details` defaults to `{}`. ULID check uses the foundation example and rejects `I`.

## Task 3 — permission catalogue
Commit `96129e3`. Tests: `[00 §10 #74]` unknown permission throws naming it; `[00 §3.6]` 19 unique entries. Full suite 6/6.
Catalogue order is the E6 AC2 list from stories, then `manage-devices` and `access-hub-admin`. `assertKnownPermissions` throws `Error` on the first unknown name.

## Task 4 — event envelopes and registry
Commit `8f22dde`. Tests: `[F §4.1]` unknown stream_type and required command ids; `[F §4.1, D46]` v1 upcast; `[F §4.1]` bad payload throws. Full suite 10/10.
Zod 4.6.7 `z.record` takes a key schema (`z.string()`), and `ZodTypeAny` is gone, so `payloadSchema` returns `z.ZodType`. Duplicate `(eventType, version)` and a version gap throw. `pnpm-lock.yaml` updated with `zod` and `@pos/domain`.

## Task 5 — spec 00 events, directory, ws, builders, fixtures
Commit `e42d842`. Tests: `[F §6.7, D46]` 14 fixtures upcast to `.latest.json`; `[F §6.7]` 14 builders parse; `[00 §6.21, M12]` auth and ack only; `[00 §4.2]` DevicePaired exactly one source id; `[00 §4.2]` minimal directory, `session_idle_ttl_ms` 0 rejected. Full suite 15/15.
Payloads follow spec §4.2 v1.0, including `issued_by` on `AdminBootstrapTokenIssued`, because this plan's task 5 already lists it. v1 and `.latest.json` match (no upcaster yet). `pin_hash` and `permission` are plain strings. `WsClientMessage` is the Zod schema and the inferred type.

## Task 5b — align with spec v0.6
Commit `aeeaf54`. Catalogue, `credentials_changed`, event payloads, `DirectorySchema`, and fixtures were already the v0.6/v1.0 shapes from tasks 2 and 5, so those tests stayed green (15/15).
`eslint` 10.13.0 and `typescript-eslint` 8.72.0 were already pinned in `package.json`. The missing piece was the `Date.now` exception for `apps/cloud/src/cli/*.ts`: a scratch there failed lint, then passed after the exception, then was deleted. No stored events and this branch is not `main`, but no v1 payload was edited.

## Task 5c — align with spec v1.0
Commit `64f5321`. Added `[00 §4.2] AdminBootstrapTokenIssued requires issued_by`; it passed on the first run because task 5 already required `issued_by`. `errors.ts` unchanged; `LOGIN_LOCKED_OUT` stays reserved.
Lint: `qrcode` is allowed only in `apps/hub/src/setup/issue-admin-bootstrap.ts` and `apps/hub/src/lib/qr.ts`. A scratch import elsewhere failed `pnpm lint`; those two paths did not. `Date.now` is allowed in the hub CLI entry. Scratches deleted. Full suite 16/16 and lint clean.

## Task 6 — hub clock, ids, secrets, canonical hash
Commit `a4b4482`. Tests: `[F §4.7]` wall clock does not move `branchNow`; `[F §4.7, D48]` wall ≤ last → `last+1` and `delta_ms = wall − last`; `[F §6.7]` `testIdGen` and monotonic `ulidGen`; `[00 §3.7]` payload hash ignores key order; `[00 §6.30]` `crockford(6)`. Full suite 22/22.
`wallNow` / `monoNow` are injected functions. `apps/hub/package.json` gained `ulid@3.0.2`, `@pos/domain`, and `@types/node` (not in the file list; needed to call `ulid` and typecheck `node:crypto`). `/// <reference types="node" />` because the base tsconfig sets `types: []`.

## Task 7 — semaphore, network and host matchers
Commit `0ebba82`. Tests: `[00 §7.4]` third acquire times out; `[00 §7.4]` release is FIFO; `[00 §3.9]` guest CIDR matches IPv4 and `::ffff:` mapped; `[00 §3.1 M45]` host allow-list, setup-mode own address, case and one trailing dot. Full suite 27/27.
`BlockList` is IPv4-only; mapped addresses are checked after stripping `::ffff:`. A missing or empty host header is false. `listOwnIPv4` skips internal and IPv6.

## Task 8 — encrypted file helper
Commit `82ad488`. Test: `[00 §10 #65]` round trip, then a flipped ciphertext byte leaves neither `out` nor `out.tmp`. Full suite 28/28.
Format is `POSENC1\n` ‖ IV ‖ ciphertext ‖ 16-byte tag. Decrypt holds the tag back and `setAuthTag` runs before `final()`. `DecipherGCM` is a cast because `createDecipheriv`'s string overload is typed as `Decipher`.

## Task 9 — hub config
Commit `2b870b1`. Tests: `[00 §3.10]` defaults; `[00 §3.10]` missing and malformed name the field; `[00 §10 #122]` mode 0600, thrown `renameSync` keeps the old file and deletes `.tmp`; `[00 §3.2]` `isProvisioned` / `isConfirmed`. Full suite 32/32.
`zod@4.6.7` added to `@pos/hub` (not in the file list). `backup_encryption_key` must decode to 32 bytes. Directory fsync uses the real `fs` after a successful rename. `chmod 0600` is applied to the temp file because `open` mode follows umask.

## Task 10 — sqlite connection and migrations runner
Commit `a7ceb76`. Tests: `[F §6.8]` pending files and checksums; applied-file checksum mismatch; backup once when `user_version > 0`; a failing file rolls back only itself; `openDb` WAL and `synchronous=FULL`; `-- migrate:foreign-keys-off` plus `foreign_key_check`. Full suite 38/38.
`better-sqlite3@13.0.3` and `@types/better-sqlite3@7.6.13` added to `@pos/hub` (not in the file list). `backup` is not called when `user_version` is 0. `applied` is the list of filenames applied in that run. Checksums are SHA-256 of the raw file bytes.

## Task 11 — encrypted pre-migration backup
Commit `04c7ea0`. Tests: `[00 §10 #64]` encrypted backup decrypts to the old `user_version`; `[00 §10 #124]` missing `backup_dir` falls back to `data_dir`, both unwritable throws and no migration is applied; `[00 §10 #111]` leftover `pre-migrate-*.sqlite` deleted, `.enc` kept; `[00 §3.8]` unprovisioned skips the backup and migrations still run. Full suite 42/42.
No-op when unprovisioned or `backup_encryption_key` is absent. Plaintext is `db.backup()` under `data_dir`, then `encryptFile` to `backup_dir` (any failure falls back to `data_dir`). The plaintext is unlinked in `finally`. `deleteLeftoverPlaintext` returns sorted absolute paths matching `pre-migrate-*.sqlite` exactly.

## Task 12 — migration 0001 event store
Commit `8326b38`. Tests: `[00 §10 #62]` UPDATE and DELETE raise `events are immutable` and the row stays; `[00 §5.1]` `processed_commands` requires `device_id`, `command_type`, `payload_hash` (`session_id` may be null); `[F §4.1]` `(branch_id, seq)` is unique and the same `seq` is allowed on another branch. Full suite 45/45.
`0001_event_store.sql` is the foundation `events` table, indexes and immutability triggers, `sync_cursor`, `hub_heartbeat`, the spec 00 `processed_commands` shape, and `projection_checkpoints`. `freshDb()` opens a temp database and deletes the directory on cleanup.

## Task 13 — appendEvents
Commit `6c7a4d6`. Tests: `[00 §10 #63]` 1 000 appends with every third rolled back leave seqs `1..666`; `[F §4.1]` outside a transaction throws and inserts nothing; `[F §4.1]` an invalid payload throws before insert, and a swallowed error still leaves the table empty. Full suite 48/48.
`seq` is `COALESCE(MAX(seq), 0) + 1` per branch for the batch. Envelope and payload are checked with `parseEvent` before the one prepared INSERT. `@pos/events` was added to `@pos/hub` (not in the file list) so the hub can validate payloads.

## Task 14 — projection registry forward catch-up
Commit `d78b574`. Tests: `[00 §10 #67]` a checkpoint at 3 with `MAX(seq)` 5 replays only `seq > 3` and matches live rows; `[00 §3.1 M48]` `applyAll` advances every checkpoint, including a projection that ignores the events; `[00 §3.1 M48]` a missing checkpoint resets then replays, and a forward-only projection replays from 0 without reset. Full suite 51/51.
`catchUp` reads pages of 1 000 through `parseEvent` (`mode: 'catchup'`). `afterCatchUp` runs inside the last catch-up transaction, or in its own transaction when nothing is behind. `replayed` counts events passed to `apply`.

## Task 15 — writer, after-commit hooks, auth generation
Commit `79aa75b`. Tests: `[F D45]` state is still old inside `beforeCommit` and swaps after the run returns; `[F D45]` a throw in `beforeCommit` leaves state, events, `lastSeq`, generation and publish untouched; `[00 §3.1 M39]` `HubProvisioned` does not bump, and `SessionEnded` plus another event in one run bumps once; `[00 §3.7]` two appends publish once with seqs 1 and 2. Full suite 55/55. `pnpm typecheck` passed.
After COMMIT, in order: `state.swap`, `lastSeq`, one `authGeneration.bump` if any appended type is in `AUTH_EVENTS`, `onCommit`, `addAfterCommit`, `beforePublish`, then `publish` when the batch is non-empty. `beforeCommit` runs inside the immediate transaction, so a throw rolls it back.

## Task 16 — Fastify server, error handler, request id, redaction
Commit `0fc5173`. Tests: `[F §6.1]` DomainError envelope and catalogue status; unknown error `INTERNAL_ERROR` without the stack; unknown route `ROUTE_NOT_FOUND`; `[00 §7.2]` Zod `VALIDATION_FAILED` with `issues`; secret headers redacted and the handler still sees them. Full suite 64/64.
`fastify@5.12.7` and `fastify-type-provider-zod@7.0.0` added to `@pos/hub` (not in the file list). `request_id` is `ids.next()` via `LogController`. Header redaction copies headers in the request serializer so the live request stays intact; pino redact covers the body field names. `createTestHub` does not call `ready()`, so tests can register routes first. Default `Host` is `192.168.10.2:3000`.

## Task 17 — Migrations 0002 and 0003
Commit `508d917`. Tests: `[00 §5.1]` a second active staff or station session on one device violates the unique index; an ended session does not; an admin session does not occupy the slot; kds without a station and a phone without an owner are rejected; a station session with `staff_id` or `idle_ttl_ms` is rejected; a staff session without a device is rejected; an admin session without a device is allowed; `pairing_tokens` rejects `device_type 'kds'`. Full suite 68/68.
SQL matches §5.1, including the `0003` directory cache.

## Task 18 — StaffDirectory and resolve
Commit `6c096aa`. Tests: `[00 §10 #78]` denial beats allowed, allowed beats requires_approval, approver roles are the sorted union, none is `not_granted`; `[00 §3.1 M11]` `ttlFor` is the max across roles and the fixture TTLs; `[00 §5.1]` `load()` matches `fromInput` through the cache tables. Full suite 71/71.
`@node-rs/argon2@2.2.2` added to `@pos/hub` (not in the file list) for memoised `pinHash` (`m=19456`, `t=2`, `p=1`). `load()` issues the six selects and builds through `fromInput`. `S_WAIT` reuses `PIN.a`.

## Task 19 — applyStaffDirectory and the session store
Commit `d8ef245`. Tests: `[00 §10 #70]` removed staff sessions end `staff_removed` and the swapped directory is used on the next read; `[00 §10 #83]` removing the owner revokes only their phones (`owner_removed`, actor null) and ends the phone session `staff_removed`; `[00 §10 #101]` a changed `pin_hash` ends staff and admin sessions `credentials_changed`; `[00 §10 #102]` equal or older versions write no event; `[00 §10 #103]` weak hash, unknown role, unknown permission and unknown approver are skipped and a removal in the same push still happens; `[00 §10 #129]` a malformed hash keeps the old staff row and omits a new one. Full suite 77/77.
Ruling: `WriterTx` now carries `clock`, `ids` and `branchId` — `writer.ts` is outside the task file list, and the session and directory writes cannot timestamp or address a branch without them. Tokens come from `cryptoSecrets` because the writer has no `SecretGen`. A weak hash is `m < 19456` or `t < 2` or `p < 1`. Skips and ignored versions go to `console.warn`.

## Task 20 — Route guards part 1
Commit `fd9588a`. Tests: `[00 §10 #72]` each group has its guard set and a route without a group fails `ready()`; `[00 §10 #21]` an unprovisioned device route is 409 `HUB_NOT_PROVISIONED`, `/health` and `/setup` pass; `[00 §10 #97]` `evil.example:3000` is 403 `HOST_NOT_ALLOWED` on `/health`, `/admin/auth`, `/devices/pair` and `/pair/requests`; `localhost:3000` and `192.168.10.2:3000` pass, and setup mode accepts the own address; `[00 §3.9]` `X-Client-Version` below min is 426 and an absent version passes; a guest address is 403 except on `/health`, which sets `isGuest`. Full suite 82/82.
Version applies to `device`, `device-session`, `pair`, `pair-request` and `ws`. Guards are async because Fastify waits on the returned promise. `server.int.test.ts` routes now declare `group: 'health'` so `ready()` still succeeds.

## Task 21 — Route guards part 2
Commit `320aa6e`. Tests: `[00 §10 #98]` a command at exactly the idle TTL still runs, and at TTL + 1 s returns 401 `SESSION_EXPIRED` with the row ended `idle_timeout`; the guard records `deviceSeen` and does not touch session activity; `[00 §10 #106]` removing `access-hub-admin` makes the next admin request 403 `PERMISSION_DENIED` and leaves the session open; `[00 §10 #115]` missing, unknown, ended, staff-kind and other-device admin tokens are 401 `ADMIN_SESSION_REQUIRED`; an idle admin session is ended `idle_timeout`; a bootstrap session (`device_id` null) needs no device token; `[00 §10 #116]` a missing or unknown device token is 401 `DEVICE_TOKEN_INVALID` and a revoked token is 403 `DEVICE_REVOKED` on `/commands`, `/queries`, `/auth/pin` and `/admin/auth`; `[00 §10 #117]` another device's session is `SESSION_INVALID` on commands and logout; queries return `SESSION_EXPIRED` when ended and `SESSION_INVALID` when unknown; logout accepts an ended session; a station session needs `allowStation`. Full suite 92/92.
Ruling: `server.ts` is outside the file list so `attachRouteGuards` can see the db, writer, clock and auth generation. `guards.int.test.ts` guard lists now include `device`, `session` and `admin`, and those routes send a device token so the host, version and guest checks still reach the handler. Admin idle answers `ADMIN_SESSION_REQUIRED`; a device session's idle answers `SESSION_EXPIRED`.

## Task 22 — Command registry and generic command route
Commit `5315d03`. Tests: `[00 §10 #1]` one event and one `processed_commands` row storing the token `device_id`; a body `device_id` that differs is 400; `[00 §10 #6]` path name ≠ `command_type` is 400 and an unknown name is 404; `[00 §10 #7]` and `[00 §10 #110]` wrong `branch_id` or `tenant_id` are 403 `BRANCH_MISMATCH`; `[00 §10 #8]` wrong `actor_id` is 400; `[00 §10 #9]` `not_granted`, `denied` and non-approvable `requires_approval` are 403, and the approvable handler sees `R_MGR`; `[00 §10 #10]` a station session is 403 unless `stationScoped`, then 200 with a null actor; `[00 §10 #11]` `STAFF_NOT_FOUND` writes nothing and a retransmit is evaluated again; `[00 §10 #12]` a throwing reducer aborts the commit, the state object is unchanged and nothing new is published. Full suite 101/101.
Ruling: `test-hub.ts` records `published` so a failed commit is visible. `TestNooped` is registered with `defineEvent` in the command route because `appendEvents` only accepts registered event types. The forced COMMIT failure is a reducer throw inside the writer transaction. Idempotent replay and the in-transaction auth re-check are task 23.

## Task 23 — Idempotency, replay, and the in-transaction auth re-check
Commit `0606a78`. Tests: `[00 §10 #2]` the same device gets the stored body, `Idempotent-Replay: true`, and no new rows; `[00 §10 #3]` replay still works after the session ended; `[00 §10 #4]` another device gets 400 `command_id already used`; `[00 §10 #5]` a new command id on an ended session is 401 `SESSION_EXPIRED`; `[00 §10 #58]` two overlapping requests write one event and return the same body; `[00 §10 #85]` a revoke in the pre-writer hook is 403 `DEVICE_REVOKED` with no command event; `[00 §10 #86]` ending the session in the hook is 401, and removing the permission is 403 with the session left open; `[00 §10 #99]` another type, payload, or admin session is 400, a body `device_id` mismatch is 400, and the same admin session replays. Full suite 109/109.
Ruling: `/commands` allows an ended session through the guard so the fast path can replay; the route then rejects a new command on that session. `#58` listens on 127.0.0.1 because `inject` cannot overlap two requests. `TestAdmin` is the admin-session command those cases need. Admin replay matches `session_id`.

## Task 24 — Query registry and generic query route
Commit `876e246`. Tests: `[00 §10 #13]` a query writes nothing and touches activity only when `countsAsActivity` is true; `[00 §6.2]` limit 201 is 400 `VALIDATION_FAILED`; `[00 §6.2]` a kds device on a tablet-only query is 403 `DEVICE_TYPE_NOT_ALLOWED`. Full suite 112/112.
Ruling: the handler lives in `queries/registry.ts` because that is the source file the task lists. `/queries` uses group `device` and checks the session in the handler when `session` is `required`, so `allowStation` is per query. `ctx.db` is the read-only connection. `pageParams` defaults to 50 and rejects a limit outside 1–200.

## Task 25 — Boot orchestrator and clock guard
Commit `a446ac7`. Tests: `[00 §10 #66]` when wall time equals the last `recorded_at`, boot's first write is `ClockAlarm` with `source: 'boot'` and `branchNow` is that time plus 1; `[00 §3.8]` registered steps 2, 3, 5, and 6 run in that order; `[00 §3.8]` an unprovisioned hub mounts no command, query, admin, or auth route and does not run registered steps; `[00 §3.10]` a `{}` config rejects with `ConfigError`. Full suite 116/116.
Ruling: the database file is `data_dir/hub.sqlite`, the name the backup tests already use. Setup mode is an empty Fastify app because `/health` belongs to task 26 and `server.ts` is not in this task's file list. Step 4b is left for task 25b. `main.ts` passes `Date.now` and `hrtime` and exits 1 on failure.

## Task 25b — access reconciliation on restore
Commit `f0884d2`. Tests: `[00 §10 #87]` copy plus tail → revoked 403, ended session 401, pairing token consumed, later tablet 401; `[00 §10 #88]` tail `SessionStarted` with no row → `hub_restored`, empty `staff_sessions` runs step 4b, a normal boot writes no `SessionEnded`; `[00 §10 #128]` live `DeviceTokenRotated` keeps the new hash, boot catch-up sets `rotated:<event_id>`; `[00 §10 #68]` cloud-only restore writes `SessionEnded hub_restored`. Full suite 120/120.
Ruling: `access_reconcile` is registered after the clock-alarm write. Registering it earlier would advance its checkpoint to that alarm and skip the restored tail. `boot.int.test.ts` is outside the file list; catch-up now parses every row, and the fixture event `Seeded` is not a registered type, so it is `HubProvisioned` with a valid payload. `#66` still asserts `ClockAlarm` is the boot write and `branchNow` is last + 1.

## Task 26 — health, heartbeat, HubStarted
Commit `61b9dc7`. Tests: `[00 §10 #14]` guest `/health` is 200 in booting, ready, and setup; `[00 §10 #108]` guest body is `{ status }` and a staff address gets the full body; `[00 §10 #71]` `hub_down_at` is null on first boot and the stored heartbeat after that; `[F §5.8, D41]` no beat before 60 s, then `clock.branchNow()` each interval. Full suite 124/124.
`hub_version` is `0.0.0` (the fixture value; the hub package has no version). `missed_fires` is 0; missed fires belong to module 03a. `boot.int.test.ts` is outside the file list: `#66` now expects `HubStarted` after `ClockAlarm`, and the alarm assertion is still the second row.

## Task 26b — boot budget on 1 M events
Commit `c8ad97c`. Test: `[00 §10 #100]` boot of the cached 1 M-event fixture stays under 5 s; the clock alarm uses the max-`seq` row even when an earlier row has a later `recorded_at`; `events_replayed` is 0. Full suite 125/125.
The fixture is `os.tmpdir()/pos-big-fixture-v1.sqlite`, copied per run, and skipped when `POS_SKIP_BIG=1`. The only projection 00 registers is `access_reconcile`, so that is the checkpoint written at `MAX(seq)`. A decoy `TestNooped` row at `seq = N + 1` with `recorded_at = 1` is inserted on the copy; replaying it would throw, so a green boot is the "not replayed" check.

## Task 27 — cloud skeleton and schema
Commit `050a440`. Tests: `[00 §5.2]` the public tables match §5.2 and `idempotency_keys` is absent; a second live key on one branch is `23505` until the first is revoked; `requires_approval` without an approver is `23514`; `status 'active'` without `hub_confirmed_at` is `23514`; a rewritten migration file makes `migrate` throw. Full suite 130/130.
`pg@8.23.1`, `zod@4.6.7`, `fastify@5.12.7`, `fastify-type-provider-zod@7.0.0`, `ulid@3.0.2`, `@pos/domain`, `@types/pg@8.23.1` and `@types/node@22.19.1` were added to `@pos/cloud` (package.json is not in the file list). Postgres is `postgres:16` on port 5433, database `pos_test`, user and password `pos`. `migrate` checks `information_schema` before reading `schema_migrations`, because `0001_platform.sql` is what creates that table. A mismatch throws `MigrationChecksumError` (`migration checksum mismatch: <name>`). Cloud tests share one database, so Vitest runs them with `fileParallelism: false`. The D54 `db/client` import pin is already in `eslint.config.js`, so `main` and the tests take `createPool` from `db/migrate.ts`. The schema test binds the connection string as `databaseUrl` so the name does not shadow the `URL` constructor.

## Task 28 — cloud repositories and credential lookup
Commit `e31b2ab`. Tests: `[00 §10 #75]` a missing or unfrozen context throws `TypeError('TenantContext required')` from both repositories; `[F §3.4]` scoped SQL must reference `$1` and `$2` (`$10` does not count), level SQL must reference `tenant_id = $1`, and the query returns only that context's rows; `[00 §5.2]` email and hash lookups find the other tenant's row with no tenant argument, and `forUpdate` holds the row lock. Full suite 133/133.
The D54 `db/client` import pin was already in `eslint.config.js`, with `apps/cloud/src/db/` exempt, so this task left that file unchanged. `query` prepends the tenant id and, for the scoped repository, the branch ids. Lookups return the row or null; `refreshTokenByHash` and `registrationCodeByHash` append `FOR UPDATE` when asked.

## Task 29 — tenant-scope and owner-credentials plugins
Commit `9a3bd57`. Tests: `[00 §10 #76]` a route with no scope or an off-list `none` fails `ready()`; the allowlist, a tenant-level `jwt` route, `branch-key` and `registration-code` are accepted; `[F §3.4]` a missing or garbage JWT is 401 `JWT_INVALID` and a signed token sets `tenant_id`; `[00 §10 #113]` `credential-lookup` importers are the two plugins, and the `SystemContext` half is empty. Full suite 142/142.
Ruling: HS256 is `node:crypto` on `app.jwt` (1 h; claims `sub`, `tenant_id`, `allowed_branch_ids`) because `package.json` is outside this task's files. Branch keys and registration codes match SHA-256 hex; a revoked key is `BRANCH_API_KEY_INVALID`; an unknown code is `REGISTRATION_CODE_INVALID`. Expiry and the same-attempt window stay in the register transaction. Fastify's automatic `HEAD` beside `GET /v1/health` may use `tenantScope: 'none'`. Test files may still import `credential-lookup` so the task 28 repository test lints; `apps/cloud/src/db/**` keeps the pin.

## Task 30 — SystemContext and seed-tenant
Commit `11499d4`. Tests: `[00 §10 #56]` four roles with the §6.26 TTLs and grants, password and PIN verify, the owner holds `access-hub-admin` and `manage-devices`, a different-case email is refused; `[00 §10 #113]` now requires `cli/seed-tenant.ts` to import `SystemContext`, and every such importer stays under `cli/`. Full suite 143/143.
Ruling: `@node-rs/argon2@2.2.2` and `tsx@4.23.15` were added to `@pos/cloud` (`pnpm-lock.yaml` updated). `pnpm-workspace.yaml` sets `allowBuilds.esbuild: true`, otherwise `pnpm install` exits because tsx's esbuild postinstall is not approved. Hashes are argon2id `m=19456, t=2, p=1`. The CLI prompts twice with no echo and throws if the two entries differ. Duplicate email throws `email already exists`, including a `23505` from the unique index.

## Task 31 — issue-registration-code
Commit `1298996`. Tests: `[00 §6.27]` `normaliseCode('abcd-efgh jkmn')` is `ABCDEFGHJKMN`; `[00 §10 #57]` a new branch stays `pending_hub`, Owner and Manager are assigned, the cashier is not, both owners gain the branch, reissue sets the old code's `expires_at` to now, and a confirmed branch is refused. Full suite 145/145.
The stored hash is SHA-256 hex of the normalised 12-character code, matching the tenant-scope guard. Reissue inserts another `new_branch` code. Display form is `XXXX-XXXX-XXXX`. A confirmed branch throws `branch is confirmed`.

## Task 32 — hubs/register
Commit `010ba70`. Tests: `[00 §10 #22]` the code is consumed, the branch stays `pending_hub`, one live key, directory staff are the branch's active staff; `[00 §10 #23]` the same key within 1 h rotates the key; `[00 §10 #24]` another key, an expired code and an unknown code are the same 401; `[00 §10 #25]` `replace_hub` accepted only as `new_branch` is 422 and stays unconsumed; `[00 §10 #61]` two concurrent registers yield one 200 and one 401. Full suite 150/150.
Ruling: `@pos/events` was added to `@pos/cloud` so the directory is checked with `DirectorySchema`. The task 29 inventory sample moved to `POST /v1/sample/register` because this route now owns `POST /v1/hubs/register`. The branch API key is stored as SHA-256 hex of the plaintext. Same-attempt reuse requires `now − consumed_at < 3_600_000`. The directory is the five queries in §6.5. The log line is `hub_registered` with `rotated`.

## Task 32b — hubs/confirm
Commit `b1dd52e`. Tests: `[00 §10 #89]` after 1 h the same code is 401 `REGISTRATION_CODE_INVALID`, and a reissued code for the still-unconfirmed branch registers; `[00 §10 #90]` confirm sets `active` and `hub_confirmed_at`, a repeat returns the same timestamp, a bad key is 401 `BRANCH_API_KEY_INVALID`. Full suite 152/152.
The hub half of #90 (confirm task) is task 33b and is not in this commit. Confirm uses the branch from the branch-key guard. `hub_confirmed_at` is `COALESCE` so the first timestamp sticks. Unconsumed codes for that branch get `expires_at = now`. `hub_version` is validated and not stored.

## Task 33 — setup provisioning and bootstrap token
Commit `f063d06`. Tests: `[00 §10 #15]` directory, `HubProvisioned` without `setup_attempt_id`, `AdminBootstrapTokenIssued`, config key and backup key, `first_admin_url`, exit 0; `[00 §10 #16]` setup routes 404 once provisioned; `[00 §10 #17]` overlapping call is 409 `SETUP_IN_PROGRESS`; `[00 §10 #18]` unreachable is 503 `retry_after_ms` 5000, and cloud 401/422 pass through; `[00 §10 #19]` weak hash skipped, setup still 200; `[00 §10 #20]` crash before the provisioned config write reuses `setup_attempt_id` and writes one `HubProvisioned`; `[00 §10 #105]` empty CIDRs, foreign host, malformed code are 400; `[00 §3.1 M77]` `qrSvg` matches `QRCode.create` dark modules. Full suite 164/164.
Ruling: `registerSetupRoutes` takes an optional `writeConfig` so #20 can throw on the provisioned write; the plan's required arguments are unchanged. The M77 test loads `qrcode` with a dynamic import because a static import is lint-forbidden outside `lib/qr.ts` and `eslint.config.js` is outside this task. Events are written with a writer built from the cloud's tenant and branch, because the boot writer is fixed to `branch-unset` and `writer.ts` is outside the file list. `qrcode@1.5.4` is in `apps/hub/package.json` (`pnpm-lock.yaml` updated). Unprovisioned boot uses `installHubErrors` so 503 carries `Retry-After`. `beat.stop` is annotated `() => void` so the existing heartbeat assignment typechecks. The HTTP client calls `/v1/hubs/register` and `/v1/hubs/confirm`.

## Task 33b — hub confirm task
Commit `db3b7e6`. Test: `[00 §3.1 M41]` a network error and a 503 are retried; success writes `confirmed_at` and stops. Full suite 165/165.
Boot step 7 starts the task when the hub is provisioned and not confirmed, and `stop()` clears it. Any thrown confirm error is logged and retried; the loop stops only after the config write.

## Task 34 — PIN verification and lockouts
Commit `7072806`. Tests: `[00 §10 #59]` a correct PIN still in verify gets 429 `PIN_LOCKED_OUT` after parallel wrong PINs cross 5; `[00 §10 #107]` an expired staff lock then one wrong PIN has `attempts_remaining` 4; `[00 §3.5]` the 5th failure writes `StaffPinLockedOut` and a later success clears only the staff counter; `[00 §3.5]` a device window at 300 000 ms starts again at count 1; `[00 §3.5]` PIN `0123` matches its hash and `123` does not; `[00 §7.4]` a full semaphore for 2 s is 503 `retry_after_ms` 1000; `[00 §3.5]` an IP subject locks with `IP_LOCKED_OUT` and `DevicePinLockedOut { subject_type: 'ip' }`. Full suite 172/172.
Expiry uses `locked_until > branchNow`, so the instant the lock time is reached the counter resets. A device or IP failure inside the window keeps `window_started_at`; at `window_started_at + 300 000` the next failure starts a new window.

## Task 35 — admin session and roster
Commit `deb3c2a`. Tests: `[00 §10 #26]` a tablet login binds the session and a cashier PIN is 403 with the staff counter reset; `[00 §10 #27]` ten failures across staff lock the device; `[00 §10 #40]` a repeat logout is `already_ended` and writes one `SessionEnded`; `[00 §10 #41]` the roster lists admin staff for a tablet token and a live bootstrap token, and answers 401 with neither; `[00 §10 #91]` a missing token is 401, a kds is 403, another staff member on a phone is 403 `DEVICE_NOT_OWNED` before PIN work, the phone owner is 200, and another device's token is 401; `[00 §10 #93]` a full PIN semaphore still lets `/admin/auth` succeed, and a full admin semaphore still lets `checkPin` on the PIN semaphore succeed; `[00 §10 #114]` `STAFF_NOT_FOUND` and `PIN_LOCKED_OUT` on `/admin/auth`. Full suite 179/179.
Ruling: logout and the roster use group `admin-bootstrap` and enforce §6.12 and §6.13 in the handler. `requireAdmin` rejects an ended session, and the device guard on `admin-device-public` rejects a bootstrap header with no device token; `guards.ts` is outside this task. A denied `access-hub-admin` is thrown after the PIN transaction commits so the staff-counter reset stays. `#93` calls `checkPin` with the PIN semaphore because `POST /auth/pin` is task 39. `#97` and `#116` no longer register a stub `POST /admin/auth`; an allowed host with an empty body is 400 from the real handler.

## Task 35b — first-admin bootstrap
Commit `c2460a4`. Test: `[00 §10 #92]` a live token opens one admin session with `device_id` null and `SessionStarted.device_id` `hub-admin`; the second use and a token at `expires_at` are 401 `PAIRING_TOKEN_INVALID`; ten wrong PINs from one IP then the next call is 429 `IP_LOCKED_OUT`; `GET /admin/bootstrap` reads `location.hash`, sends `X-Admin-Bootstrap`, calls `history.replaceState`, and has no `?t=` or `location.search`. Full suite 180/180.
The IP case raises `pin_max_failures` to 100 so the staff lock at 5 does not hide the IP lock at 10. The token is consumed in the same transaction as the session insert, and only when `access-hub-admin` is allowed.

## Task 35c — issue-admin-bootstrap CLI
Commit `e71193a`. Tests: `[00 §10 #127]` an expired setup token, a CLI link that opens an admin session, the old link `401 PAIRING_TOKEN_INVALID`, a later run expires the previous CLI token, `AdminBootstrapTokenIssued { issued_by: 'cli' }`, while a TestHub holds the same file open; `[00 §6.34]` unprovisioned throws `run setup instead`, and another uid throws with no event. Full suite 186/186.
`runIssueAdminBootstrap` loads config, checks the uid against `data_dir`, opens `hub.sqlite` with no migrations, and builds a branch clock from the max-seq `recorded_at`. It registers `access_reconcile`, then `issueAdminBootstrap(tx, 'cli')`. Output is the URL, the ISO expiry, and a terminal QR. `qrcode@1.5.4` was already a hub dependency. The script is `tsx src/setup/issue-admin-bootstrap.ts`.

## Task 36 — GenerateDevicePairingToken
Commit `32d9ccc`. Follow-up `e2101d4` sets `DevicePairingTokenGenerated.stream_id` to the pairing token id. Tests: `[00 §10 #28]` tablet token, `kds` and `cashier_kiosk` are 400, a denied `manage-devices` is 403, retransmit returns the same token; `[00 §10 #80]` phone without an owner is 400, an unknown owner is 404, the token row stores `owner_staff_id`; `[00 §3.1 M31]` `stationExists` is false until `registerStationValidator`. Full suite 189/189 before the stream-id assertion; the pairing-token file passed after `e2101d4`.
Ruling: `#80`'s device row is written by `POST /devices/pair` (task 37). This test checks the token row that pairing copies. `owner_staff_id` is any non-empty string because the fixture staff ids are not ULIDs. The plaintext token is base64url of 32 bytes.

## Task 37 — device pairing and pair page
Commit `29af341`. Tests: `[00 §10 #29]` happy path, expired and reused tokens are 401, a type mismatch is 403; `[00 §10 #30]` the same `pair_request_id` rotates the device token; `[00 §10 #84]` a removed phone owner is 401; `[00 §10 #118]` old client 426, guest 403, late or revoked rotation 401; `[00 §10 #94]` the pair page logs out and clears `sessionStorage` before pairing; `[00 §6.8]` a phone device stores `owner_staff_id` (the device half of #80). Full suite 195/195.
Ruling: `branch_name` is not on the hub config or `HubProvisioned`, so the pair response sends an empty string. `guards.int.test.ts` is outside the file list: the `/devices/pair` stub collided with the real route, and an allowed host with an empty body is now 400. Rotation keeps the original `consumed_at`.

## Task 38 — pairing requests
Commit `772afcf`. Tests: `[00 §10 #95]` create, pending, approved poll twice, expiry 404, `clearExpiredDeliveryTokens`, wrong secret 404, 11th pending 503; `[00 §6.31]` an approved poll after `expires_at` is 404 and the clearer nulls `delivery_token`; `[00 §10 #130]` a third pending request from one IP is 429, other IPs still succeed, the 11th overall is 503; `[00 §10 #131]` setup, pairing-token and pairing-request SVGs match `qrSvg` and contain no `<script>`. Full suite 199/199.
Ruling: the poll is one read and does not clear `delivery_token`; `clearExpiredDeliveryTokens` does. `branch_name` is `''`, same as task 37. `guards.int.test.ts` dropped the `/pair/requests` stub; an empty body on an allowed host is 400. The pair page's no-token branch now creates a request and still contains the words "Ask a manager".

## Task 38b — ApprovePairingRequest
Commit `4dfb62a`. Test: `[00 §10 #96]` a kds approval stores `station_id` and `DevicePaired.pairing_request_id`, a wrong display code and a second approval are 404, an unknown station is 404, a denied `manage-devices` is 403, and the result has no token. `GET /admin/approve` reads `r` and posts the command. Full suite 200/200.
A kds approval calls `stationExists`. The plaintext device token is stored only as `delivery_token` for the screen poll.

## Task 39 — staff PIN session and logout
Commit `67ffe70`. Tests: `[00 §10 #31]` cashier login, then the 5th failure writes `StaffPinLockedOut` and the next correct PIN is 429; `[00 §10 #32]` 10 failures across staff write `DevicePinLockedOut`; `[00 §10 #33]` the same staff replaces the holder; `[00 §10 #34]` another staff without takeover is 409 and writes nothing; `[00 §10 #35]` takeover ends the holder `taken_over`; `[00 §10 #36]` kds, guest, old client and a bad host are rejected; `[00 §10 #37]` both PIN permits held for 2 s is 503; `[00 §10 #38]` logout is idempotent and a station session is 403 `STATION_LOGOUT_NOT_ALLOWED`; `[00 §10 #60]` two staff logins at once yield one 200 and one 409; `[00 §10 #81]` the phone owner logs in, and another staff member is 403 `DEVICE_NOT_OWNED` without a PIN check; `[00 §6.9]` `STAFF_NOT_FOUND` is not counted; `[00 §3.1 M46]` an idle holder is ended `idle_timeout` before the slot check. Full suite 213/213.
Ruling: `guards-auth.int.test.ts` is outside the file list. The `/auth/pin` and `/auth/logout` stubs collided with the real routes. `#116` still checks the device guard and skips re-registering those paths. `#117` uses the real logout, which stays 200 for an ended session. `staff_id` is a non-empty string because the fixture ids are not ULIDs. A phone whose owner does not match returns before the PIN semaphore. A unique-constraint insert is mapped to 409 `DEVICE_SESSION_ACTIVE`; better-sqlite3 rolls the transaction back when that throw leaves the callback. `#60` took the explicit 409 path. `#63` timed out once under suite load and passed on the next full run.

## Task 40 — station session
Commit `0cb59df`. Test: `[00 §10 #39]` a kds station session has a null staff id and idle TTL, a second call replaces it with `ended_by` null, and a tablet is 403. Full suite 214/214.
Ruling: a replaced station session has `ended_by` null because the actor is null (M30). No file outside the task list. The socket half of `#104` stays in task 45. `#63` timed out twice (~5455 ms and ~5808 ms) and the third full run passed.

## Task 41 — session sweeper and retention
Commit `95f5123`. Tests: `[00 §10 #69]` idle staff and admin sessions end within 15 s, a station session never ends, and a multi-role TTL is the max; `[00 §10 #121]` retention runs in the maintenance hour, in batches of 500, once per local day. Full suite 216/216.
Ruling: the last retention day is a `WeakMap` keyed by the database, so `#69`'s `startSweeper` does not consume `#121`'s day. `setMaintenanceHour` is process-global. Each batch is one `DELETE … LIMIT 500` in its own `writer.run`; the after-commit hook sees 500 old commands still present. The next local day deletes 13 rows: the 10 new commands, the boundary command, the unlocked fresh lockout, and `old-locked` because `locked_until <= now`. Rows kept at one day before the first run stay. The sweeper starts only on the provisioned boot path and stops with the heartbeat. `#121`'s 1 000 fixture rows are inserted in one transaction. The first full-suite run timed out at 5 s while those inserts autocommitted; after the transaction the suite passed.

## Task 42 — admin access commands
Commit `affb567`. Tests: `[00 §10 #42]` revoke ends the staff session and the admin session bound to that device, writes `DeviceRevoked`, replays, then `already_revoked`, and rejects an unknown device and a denied `manage-devices`; `[00 §10 #43]` force logout of staff, station, another admin and the caller's own admin session, with `ended_by`, replay, `already_ended`, unknown 404 and denied `manage-staff`; `[00 §10 #44]` staff, device and IP locks clear, an unlocked or expired subject is `cleared: false` with no event, and a denied `manage-staff` is 403. Full suite 219/219.
Ruling: the socket close `4403` is task 45. This test asserts the `DeviceRevoked` row. `endSession` appends `SessionEnded` inside the handler, so the command envelope's `event_ids` lists only the drafts the handler returns (`DeviceRevoked`, `PinLockoutCleared`). A subject is locked only when `locked_until > now`. Retransmit is asserted on a staff logout: `requireAdmin` rejects an ended admin session before the idempotency replay, so a replay of the caller's own logout cannot pass the guard.

## Task 43 — access queries
Commit `9af7aa3`. Tests: `[00 §10 #45]` device and session lists stay at one statement with 1 and 20 devices; `[00 §10 #46]` the roster has the active session and locks, at two statements with 1 and 30 staff; `[00 §10 #47]` a cashier's permission map equals `permissionsOf` and a station session returns `{}`; `[00 §10 #82]` a phone roster lists only the owner. Full suite 223/223.
Ruling: `pairing_source` is `token` when a `pairing_tokens` row points at the device, and `request` otherwise. No column was added. A device's `active_session` is its staff or station session; an admin session on that device is left out of that field and still appears in the sessions list. `last_seen_at` and `last_activity_at` use the in-memory value when one is present. The statement counter counts executions on `readDb`. The session guard uses the writer database, so `GET /queries/session` counts 0. `countsAsActivity` is false; the device guard still records `last_seen` for the calling device. The roster clock is closed over from `HubDeps` because `QueryCtx` has no clock and `registry.ts` is outside the file list. A lockout is listed only when `locked_until > branchNow`. The 18 extra devices are inserted with SQL because `testSecrets` repeats every 8 tokens.

## Task 44 — WebSocket auth and catch-up
Commit `4de9778`. Tests: `[00 §10 #48]` no frame for 5.1 s then close `4401`; `[00 §10 #49]` non-auth, bad device, bad session, other device, ended session and admin session close `4401` with zero frames, revoked device closes `4403`; `[00 §10 #50]` query-string tokens do not authenticate; `[00 §10 #51]` catch-up `as_of_seq` then strictly ascending events, and a boot `ClockAlarm` sets `hub.clock_alarm`; `[00 §10 #119]` guest `403` on admin auth, admin devices and pairing requests, and the socket closes `4403` before auth; `[00 §3.1 M45]` a bad Host closes `4403`. Full suite 229/229.
Ruling: `@fastify/websocket@11.3.4` was added to `@pos/hub` (`pnpm-lock.yaml` updated). `branch_name` is `''` because the hub does not store it. `hub.clock_alarm` is `{ wall_ms, last_recorded_at }` from the latest `ClockAlarm` row. Committed events reach sockets through `writer.addAfterCommit`, because `publish` is fixed when the writer is built and `writer.ts`, `boot.ts` and `test-hub.ts` are outside this task. `guards.int.test.ts` is outside the file list: its stub `GET /ws` moved to `/guard/ws` so the real route can own `/ws`; the close-code assertions are unchanged. An idle session closes `4401` and is not ended here.

## Task 45 — WebSocket publish and audiences
Commit `2289d42`. Tests: `[00 §10 #52]` `SessionEnded` then close `4401` with the reason, a socket with auto-pong off terminates `1006` at 30 s, and pongs leave `last_activity_at` alone so the session is `401` after its TTL; `[00 §10 #104]` a second station login delivers `replaced` and closes `4401` reason `replaced`; `[00 §10 #112]` auth inside `beforePublish` gets one `catch_up` at that seq and no push; `[00 §4.2]` manual and `owner_removed` `DeviceRevoked` are delivered and the socket closes `4403`; `[00 §6.21]` shutdown closes `1012`. Full suite 234/234.
Ruling: `test-hub.ts` is outside the file list. Its `publish` forwards to the socket publisher, and `createTestHub` accepts `testHooks`, so `#112` can authenticate inside `beforePublish`. `#51`'s later events are `ClockAlarm` because `HubStarted` has no audience and is not pushed. A batch that contains both `SessionEnded` and `DeviceRevoked` sends both frames and closes `4403`. Acks are stored and do not touch activity. Ping is 15 s; no pong for 30 s terminates. Shutdown close does not wait for the websocket server to drain.

## Task 46 — CORS and log redaction
Commit `6637ddf`. Tests: `[00 §10 #120]` an allowed origin gets `Access-Control-Allow-Origin` and `Vary: Origin` on device, device-session, pair and pair-request routes, and `OPTIONS` answers `200` with the preflight headers and `GET, POST`; another origin gets none; `/admin/*` and `/setup` never. `[00 §10 #73]` setup, bootstrap, admin auth, pairing token, pair, pairing request, PIN login, station login and logout leave their secrets out of the captured logs. Full suite 236/236.
Ruling: preflight is `200 { data: {} }` because the envelope forbids 204. The redaction sweep needed no new censor: request bodies are not logged, and the header and `t=` redactors from task 16 already cover these routes. The cashier and owner PINs in `#73` are `482631` and `573920` so a response-time float cannot contain them.

## Task 47 — Cloud owner login
Commit `2eae6b4`. Tests: `[00 §10 #53]` login returns the JWT and a hashed refresh token; a wrong password and an unknown email are both `401 LOGIN_INVALID` within 2×; 10 failures lock the account. `[00 §10 #109]` a locked account answers `401 LOGIN_INVALID` for the right and a wrong password, the real hash is not verified, the account counter stays, 30 failures from one IP are `429 IP_LOCKED_OUT`, and 10 concurrent failures count 10. `[00 §10 #126]` login deletes that user's refresh tokens expired more than 7 days. `#56` also logs in over HTTP. Full suite 239/239.
Ruling: §10 `#53` still says the 10th failure is `429`. M73 and this task's interface say login never returns `LOGIN_LOCKED_OUT`, so the 10th failure is `401 LOGIN_INVALID` and sets `login_locked_until`. The per-IP `429` is the 31st request, after 30 counted failures. `route-inventory.int.test.ts` is outside the file list: its stub `POST /v1/auth/login` is removed so the real route owns that path; the allowlist assertion reads the registered scopes.

## Task 48 — Cloud refresh and logout
Commit `7e51fee`. Tests: `[00 §10 #54]` refresh returns `base64url(HMAC-SHA256(REFRESH_TOKEN_SECRET, token))`, a replay within 30 000 ms returns that successor and writes nothing, two concurrent refreshes both return it, and a replay after 30 000 ms is `401 REFRESH_TOKEN_INVALID` and revokes every live token of the user. `[00 §10 #55]` logout revokes the caller's token; another user's token answers `revoked: false` and still refreshes. `[00 §10 #123]` an expired refresh token is `401`, and a successful login resets `failed_login_count`. Full suite 242/242.
Ruling: `route-inventory.int.test.ts` is outside the file list again. Its stub `POST /v1/auth/refresh` is removed so the real route owns that path. Logout is `tenantScope: 'jwt'` and revokes through `TenantLevelRepository`. A token is expired when `expires_at <= now`.

## Task 49 — cloud health and cross-tenant suite
Commit `e8993a0`. Tests: `[00 §10 #125]` `/v1/health` is 200 `{ status: 'ok', version: '0.0.0', db: 'ok' }`, and ending the pool makes the next call 503 `SERVICE_UNAVAILABLE`; `[00 §10 #77]` tenant A's JWT and branch key, on every `jwt` and `branch-key` route, return no tenant B id. `#77` passed before the health route existed. Full suite 244/244.
Ruling: `route-inventory.int.test.ts` is outside the file list. Its stub `GET /v1/health` collided with the real route, so the stub is gone and the sample-scope list is `jwt`, `branch-key`, `registration-code`. `version` is `0.0.0` because the cloud package has no version. A failed `SELECT 1` throws `SERVICE_UNAVAILABLE`.

## Task 50 — systemd unit and hardware smoke test
skipped – needs owner/Claude. §10 #79 is the smoke test on the target mini PC.

## Task 51 — foundation error table and README
skipped – needs owner/Claude. Marked NOT for Cursor; it edits the foundation spec and `docs/specs/README.md`.




## Task 52 — hub recovery CLI runs through pnpm (build review 2 item 1)
Commit below. Test: `[00 §6.34]` spawns `pnpm --filter @pos/hub issue-admin-bootstrap` with `POS_HUB_CONFIG` on a provisioned temp config; exit 0 and an `/admin/bootstrap#t=` line. Before the change it failed with `tsx: not found`. Hub + packages 212/212 (1 skipped, big fixture). Cloud not run: Postgres on 5433 down.
`tsx@4.23.15` is a runtime `dependency` of `@pos/hub` (it runs on the hub, §7.11); `pnpm-lock.yaml` updated. `pnpm lint` already fails on `prefer-const` in `apply-directory.int.test.ts:117` and `restore.int.test.ts:229`, both outside this item, so they are left as they are.

## Task 53 — admin pages without credentials, approve by display code (build review 2 item 2)
Commit below. Test: `[00 §10 #133]` `GET /admin/approve` and `GET /admin/bootstrap` with no headers are 200 and the approve page has no device or session token; a guest IP is 403 `GUEST_NETWORK_FORBIDDEN`; the approve page reads IndexedDB and `sessionStorage`, logs in through `/admin/login-roster` + `/admin/auth`, and shows `pairing.approve_needs_admin_device` with neither credential; `ApprovePairingRequest` without `request_id` approves the single pending match, and no match or two pending requests with one code (forced by SQL) are 404 `PAIRING_REQUEST_NOT_FOUND`. It failed first with 401. Hub + packages 213/213 (1 skipped). Cloud not run: Postgres on 5433 down.
Ruling: `#96` asserted that the page embedded the caller's tokens, which M79 now forbids, so those page assertions moved into `#133` without the token checks; `#96`'s command cases are unchanged. `/admin/approve` uses group `admin-bootstrap` (host, provisioned, guest), the same as `/admin/bootstrap`. The bootstrap page stores `admin_staff_id` and `admin_bootstrap = '1'`. The code lookup is one statement served by `pair_requests_pending`.

## Task 54 — pair page stores device_id and recovers from a dead token (build review 2 item 3)
Commit below. Test: `[00 §10 #94]` static check extended: `resumePaired` runs before `fetch('/pair/requests')`, treats `401`/`403` from `/auth/station` as dead and deletes `token`, `device_id` and `device_type`; both success paths write `device_id`; the create path handles `retry_after_ms`. It failed first on `retry_after_ms`. Hub + packages 213/213 (1 skipped). Cloud not run: Postgres on 5433 down.
`resumePaired` returns `false` after wiping, and the page then starts a new pairing request. A `429` or `503` on create retries once after `details.retry_after_ms`; the next failure shows the "Ask a manager" button.

## Task 55 — branch_name kept in the hub config (build review 2 item 4)
Commit below. Test: `[00 §10 #132]` setup with the stub cloud's `branch_name: 'Main'` writes `provisioned.branch_name`; a hub booted with that `provisioned` returns it from `POST /devices/pair`, the approved `GET /pair/requests/:id`, and the WS `catch_up.state.hub.branch_name`. It failed first with `undefined` in the saved config. Hub + packages 214/214 (1 skipped); `boot-budget.int.test.ts` run separately (fixture built, passed). Cloud not run: Postgres on 5433 down.
`provisioned.branch_name` is required in `HubConfigSchema`. `buildCatchUpState` takes `branchName` as a fifth argument (from `ws/server.ts`). Test configs that build `provisioned` gained `branch_name: 'Main'`, and the three tests that expected `''` (`#29`, `#95`, `#51`) now expect `'Main'`. These files are outside the item's list, but the item tells us to update them.

## Task 56 — pairing_source derived from device_type (build review 2 item 5)
Commit below. Test: `[00 §10 #134]` a tablet whose `pairing_tokens` row is deleted (retention) still lists `pairing_source: 'token'`, and a kds lists `'request'`. It failed first with `'request'`. `#45` keeps one statement. Hub + packages 215/215 (1 skipped). No cloud code touched.
Ruling: `#45` expected `'request'` for the admin tablet, because it had no `pairing_tokens` row. Under M80 a tablet is always `'token'`, so the expectation changed. The `CASE` no longer reads `pairing_tokens`.
