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
