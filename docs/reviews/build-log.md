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
