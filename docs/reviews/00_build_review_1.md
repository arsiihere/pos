# Build review 1 — module 00 tasks 1–15

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `0a2b8cc` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) and foundation §4.1, §4.7, §5.9 D45, §6.2, §6.5–§6.8 where those tasks cite it |
| Plan | `docs/plans/00-plan.md` tasks 1–15, including 5b and 5c |
| Done per `docs/reviews/build-log.md` | tasks 2, 3, 4, 5, 5b, 5c, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15. Task 1 is commit `4abf807` and is in range. |
| Date | 2026-10-23 |
| Verdict | Fix the list below before task 16. |

Checked: spec deviations, §10 test numbering (each number exactly once), tests that do not lock the case they name, files outside each task's file list, secrets in logs, and contracts later tasks import.

Earlier copies of this file are fixed and are not reopened. Tasks 1–5c: `a431a56` (randomUUID / ulid lint), `b85ea82` (upcast `schema_version`), `ec251f1` (qrcode subpath), `5529476` (permission names). Tasks 6–10: `02156d6` (integer `branchNow`), `b96f87c` (one backup call), `20ca4b1` (SHA-256 checksum). This pass re-reads that range and reviews tasks 11–15.

## What matches

- `[00 §10 #62]`, `#63`, `#64`, `#65`, `#67`, `#74`, `#111`, `#122`, and `#124` each appear once. No later §10 number is claimed early. The checksum half of #64 stays under `[F §6.8]`, which is how task 10 splits that spec row.
- `0001_event_store.sql` matches the foundation `events` table, `events_branch_seq`, `events_stream`, both immutability triggers (`events are immutable`), `sync_cursor`, and `hub_heartbeat`, plus spec §5.1 `processed_commands` and `projection_checkpoints`.
- `appendEvents` allocates `seq` inside the caller's transaction, validates the batch with `parseEvent` before the insert loop, and #63 leaves seqs `1..666` after the forced rollbacks.
- `catchUp` replays `seq > checkpoint`, does not `reset` when a row exists, and #67 would throw if seq `3` were inserted again. `createWriter` follows the task 15 order: immediate transaction, append + `applyAll`, reduce, `beforeCommit`, then after COMMIT swap, `lastSeq`, one `authGeneration` bump, `onCommit`, `addAfterCommit`, `beforePublish`, `publish`.
- `makePreMigrateBackup` is a no-op when unprovisioned or the key is absent, encrypts one snapshot, falls back to `data_dir` when `backup_dir` is missing, and deletes the plaintext on the success path. No `console.*` in this range. Event payloads carry ids, not a PIN, password, token, or `backup_encryption_key`.
- Task file lists match, except task 13 also adds `@pos/events` to the hub `package.json` (see Declined). Names later tasks import (`Writer`, `WriterTx`, `appendEvents`, `createProjectionRegistry`, `AUTH_EVENTS`, `freshDb`, `deleteLeftoverPlaintext`, `makePreMigrateBackup`) match the plan.

## Declined

- `pnpm-lock.yaml` and `@pos/events` on the hub in task 13. `appendEvents` calls `parseEvent`. Not a behavior change.
- Build-log commits. Review notes, not behavior.
- A provisioned config with no `backup_encryption_key` skips the backup. The task interface says no-op when the key is absent.
- `appendEvents` stores `parseEvent`'s upcast. Every 00 event is still v1, so `schema_version` equals the draft.
- `publish` runs inside `writer.run` before the handler returns. Task 15 puts it there so task 45's `beforePublish` hook sees `lastSeq` already advanced.
- `StateHolder.get()` is not a copy. D45 purity belongs to the reducer 03a registers.
- Events appended inside `afterCatchUp` sit above the checkpoint just written. Task 25b's apply is idempotent, and HTTP is not open until boot step 7, so those events are not published.
- `deleteLeftoverPlaintext` is not called from task 11. Boot step 1 (task 25) is the caller. #111 tests the function.
- The encrypt fallback reuses one IV. `encryptFile` deletes its temp file and throws before a destination file exists, so only one ciphertext remains.
- A checkpoint ahead of `MAX(seq)` is left in place. The immutability triggers make that state unreachable through this module.
- Seq is tested on one branch. A hub has one branch.
- `canonicalJson` and own `undefined`, `monotonicFactory` seed `0`, untested `listOwnIPv4`, uppercase `::FFFF:`, empty `guest_network_cidrs`, encrypted-file umask, and `chmodSync` outside the config rename `try`. Same declines as the tasks 1–10 pass. Nothing in tasks 11–15 makes them load-bearing.
- Calling `writer.run` from `afterCatchUp` would be a savepoint. Task 25b says to append on the hook's `tx`, not to re-enter the writer.

## Fix list

### 1. #124 never reaches the encrypt fallback

- **Where:** `apps/hub/test/db/pre-migrate-backup.int.test.ts`, `[00 §10 #124]`. Task 11, commit `04c7ea0`. The second half `chmod`s `data_dir` to `0555` (`pre-migrate-backup.int.test.ts` around the locked-dir block).
- **What's wrong:** `db.backup()` throws before either `encryptFile` call, because the plaintext path is inside that directory. A fallback that swallows the second encrypt error and lets migrations continue still passes, including "no `pre-migrate-*` file left", because the plaintext file was never created.
- **Why it matters:** M21 and the task interface say both encrypt attempts failing throws and no migration is applied. That is the case where a provisioned hub would migrate with no encrypted copy.
- **Fix:** Keep the missing-`backup_dir` half. Replace the locked-`data_dir` half with: `data_dir` writable, `backup_dir` mode `0555`, and `data_dir/pre-migrate-1-2.sqlite.enc` as a directory so the fallback `rename` throws. Expect the throw, `user_version` still `1`, and the plaintext snapshot gone.
- **Spec change:** no.

### 2. A failed plaintext delete is ignored

- **Where:** `apps/hub/src/db/pre-migrate-backup.ts`, the `finally` around `unlinkSync`.
- **What's wrong:** Every unlink error is swallowed, including `EBUSY` and `EPERM`. Encrypt can succeed, unlink can fail, and `makePreMigrateBackup` still resolves. `runMigrations` then applies the migration. Boot step 1, which would delete the leftover, has already run.
- **Why it matters:** The file is the database, PIN hashes included (M21). It stays in `data_dir` for the rest of the process lifetime. The task says the plaintext is always deleted; a failed delete is a failed backup.
- **Fix:** Rethrow any unlink error other than `ENOENT`, so the original `backup()` error still surfaces when the file was never created, and any other unlink failure aborts the migration. Test by making `unlinkSync` throw `EBUSY` for that plaintext path and expecting `user_version` to stay put.
- **Spec change:** no.

### 3. The plaintext snapshot is mode `0644`

- **Where:** `apps/hub/src/db/pre-migrate-backup.ts`, `db.backup(plain)` then `encryptFile`. `encryptFile` opens ciphertext with mode `0600`. The snapshot is created with the process umask.
- **What's wrong:** Until unlink, and for the whole uptime if unlink fails, any local user can read the copy. Config writes chmod `0600` because §3.10 requires it. This file is the same database.
- **Why it matters:** M21 exists because a copied hub database exposes every PIN. The copy should not be world-readable while it exists.
- **Fix:** `chmod` the plaintext to `0600` as soon as `backup()` resolves. In the #64 test, observe that mode before encrypt.
- **Spec change:** no. §7.9 does not set the mode; `0600` is stricter and matches the config file that holds the key.

### 4. `AUTH_EVENTS` is only locked for `SessionEnded`

- **Where:** `apps/hub/test/engine-host/writer.int.test.ts`, `[00 §3.1 M39]`. `AUTH_EVENTS` in `auth-generation.ts` lists `DeviceRevoked`, `DeviceTokenRotated`, `SessionEnded`, and `StaffDirectoryApplied`. The test appends one `SessionEnded` and one `HubProvisioned`.
- **What's wrong:** `AUTH_EVENTS = ['SessionEnded']` still passes. Bumping once per auth event also passes, because the batch contains a single auth event. The writer bumps once per committed batch (`appended.some(...)`).
- **Why it matters:** Task 23 #85 depends on `DeviceRevoked` moving the generation. Task 19 and task 37 depend on `StaffDirectoryApplied` and `DeviceTokenRotated`. M39 says one bump for the transaction, not one per event.
- **Fix:** In that same test, commit each of the four types and expect the generation to rise by one per transaction, and commit two `SessionEnded` events in one `run` and expect a single bump.
- **Spec change:** no.

### 5. Catch-up mode, `afterCatchUp`, and reset-when-current are not locked

- **Where:** `apps/hub/test/projections/registry.int.test.ts`. `registry.ts` passes `'live'` from `applyAll` and `'catchup'` from `catchUp`, runs `afterCatchUp` inside the page transaction (and in its own transaction when nothing is behind), and sets `reset` only when the checkpoint row is missing. Every test projection ignores `mode`. No test registers a hook. No projection with `reset` is caught up once its checkpoint is already `MAX(seq)`.
- **What's wrong:** These still pass: always call `apply` with `'live'`; leave `afterCatchUp` a no-op, or call it after the page transaction commits; call `reset` whenever `last_seq >= MAX(seq)`.
- **Why it matters:** M74 / #128 keys off `'catchup'` versus `'live'`. #88's `hub_restored` insert has to commit with the page, and a hook throw has to roll that page back. A reset on an up-to-date projection wipes its rows on every boot.
- **Fix:** Record `mode` on the #67 counter and expect `live` for the events at or below the checkpoint and `catchup` for the rest. Add a checkpoint already at `MAX(seq)` on a projection that has `reset`, and assert `reset` is not called and its rows stay. Assert a hook sees `db.inTransaction`, and that a throw from the hook leaves that page's checkpoint unmoved.
- **Spec change:** no.

### 6. After-commit order is not locked

- **Where:** `apps/hub/test/engine-host/writer.int.test.ts`, `[F D45]` and `[00 §3.7]`. `writer.ts` after COMMIT does swap, `lastSeq`, bump, `onCommit`, `addAfterCommit`, `beforePublish`, then `publish`.
- **What's wrong:** The tests lock "a throw in `beforeCommit` means publish does not run" and "two appends publish once". Invoking `onCommit` inside the transaction, or calling `publish` before `beforePublish`, or updating `lastSeq` after `beforePublish`, still passes.
- **Why it matters:** Task 19's `setDirectory` is an `onCommit` hook and must observe the committed database. Task 45 #112 registers the socket in `beforePublish` and drops the duplicate only if `lastSeq` already matches the new event.
- **Fix:** On one successful `run`, record `db.inTransaction` inside `onCommit` (false), the state already swapped, and the sequence `onCommit` → `addAfterCommit` → `beforePublish` → `publish`, with `lastSeq` already the new seq inside `beforePublish`.
- **Spec change:** no.

### 7. Catch-up page size is not locked

- **Where:** `apps/hub/src/projections/registry.ts` `PAGE = 1000`. #67 replays two events.
- **What's wrong:** One unbounded `SELECT`, or a cursor that skips the 1001st row, still passes. Task 26b's 1 M-event boot sets every checkpoint to `MAX(seq)`, so it never enters the page loop.
- **Why it matters:** A skipped page advances the checkpoint past events the projection never applied. Those rows are never replayed.
- **Fix:** Catch up 1 001 events with no checkpoint and assert each seq is applied once. Record `projection_checkpoints.last_seq` after each upsert and expect `1000` then `1001`, which an unbounded single statement does not produce.
- **Spec change:** no.

### 8. An invalid payload is only tested as a one-event batch

- **Where:** `apps/hub/test/engine-host/append-events.int.test.ts`, `[F §4.1] invalid payload inserts nothing`.
- **What's wrong:** The swallowed error is a single bad draft. Validate-then-insert per event still passes: the bad draft throws before its own insert. A batch of one valid draft and one invalid draft would commit the valid row when the caller swallows the error. The implementation parses the whole batch first; the test does not require that.
- **Why it matters:** The writer swallows nothing, but any caller that catches (the test's own shape, and a handler that maps a bad draft) would persist a partial batch. Foundation §4.1 is append-only and gap-free; a partial batch inside a committed transaction is a permanent prefix.
- **Fix:** In that same test, append one valid draft and one invalid draft, swallow the throw inside the transaction, and expect zero rows.
- **Spec change:** no.

## Needs spec change

- **§10 #67 still says reset.** The catalogue row is "checkpoint behind `MAX(seq)` → `reset` + replay". M48 and §3.8 step 4 say `reset` + full replay only when the checkpoint row is missing; a checkpoint that is merely behind replays `seq > checkpoint`. Task 14 and the code follow M48. The §10 sentence should be updated to match M48. No code change.
