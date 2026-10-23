# Build review 1 — module 00 tasks 1–10

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `2b38dfa` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) and foundation §4.1, §4.7, §6.2, §6.5–§6.8 where those tasks cite it |
| Plan | `docs/plans/00-plan.md` tasks 1, 2, 3, 4, 5, 5b, 5c, 6, 7, 8, 9, 10 |
| Done per `docs/reviews/build-log.md` | tasks 2, 3, 4, 5, 5b, 5c, 6, 7, 8, 9, 10. Task 1 is commit `4abf807` and is in range. |
| Date | 2026-10-23 |
| Verdict | Fix the list below before task 11. |

Checked: spec deviations, §10 test numbering (each number exactly once), tests that do not lock the case they name, files outside each task's file list, secrets in logs, and contracts later tasks import.

The previous copy of this file (commit `7b39935`) reviewed tasks 1–5c. Those four items are fixed and are not reopened: `a431a56` (randomUUID / ulid lint), `b85ea82` (upcast `schema_version`), `ec251f1` (qrcode subpath), `5529476` (permission names). This pass re-reads that range and reviews tasks 6–10.

## What matches

- `ErrorCatalogue` is the task 2 list, including reserved `LOGIN_LOCKED_OUT` 429. Statuses match spec §9 for the codes that test names. `PERMISSIONS` is the 19 names in order. `[00 §10 #74]`, `[00 §10 #65]`, and `[00 §10 #122]` each appear once. Later §10 numbers are not due yet.
- The 14 event payloads match spec §4.2, including `issued_by` and DevicePaired's exactly-one source id. `DirectorySchema`, `WsClientMessage` / `WsServerMessage`, and `WS_CLOSE` match the plan. `parseEvent` upcast sets `schema_version`, and the tests now check it.
- No `console.log` or other logger. Config failures for a bad `backup_encryption_key` use the message `expected 32 bytes` and the field name; the key string is not in the `ZodError` message. Event payloads carry token ids, not PIN, password, or token secrets.
- `createBranchClock` alarms when `wall <= lastRecordedAt`, with `delta_ms = wall − last`, and starts at `last + 1`. `payloadHash` sorts keys recursively. The guest matcher accepts `::ffff:192.168.20.7`. The host matcher lowercases and strips one trailing dot. Semaphore handoff is FIFO. `encryptFile` / `decryptFile` are `POSENC1\n` ‖ 12-byte IV ‖ ciphertext ‖ 16-byte tag, and a bad tag leaves neither output path. Config defaults, field names, mode `0600`, and the rename-crash case match §3.10. `openDb` sets WAL, `synchronous=FULL`, foreign keys, and `busy_timeout=5000`. The runner checksums raw bytes, skips backup when `user_version` is 0, rolls a failed file back, and honours `-- migrate:foreign-keys-off`.

## Declined

- `pnpm-lock.yaml` and the hub `package.json` dependency lines in tasks 4, 6, 9, and 10. Those tasks call `ulid`, `zod`, and `better-sqlite3`, which the plan pins and which are not yet in the hub package. `@types/node` and `@types/better-sqlite3` are dev-only. Not a behavior change.
- Doc commits `7e3ae75` and `98752c2`, and the build-log commits. Human doc updates, not implementation defects.
- `payloadSchema` returns `z.ZodType`. Zod 4 removed `ZodTypeAny`. Later tasks should copy `z.ZodType`.
- Payload enums are copied beside `@pos/domain`. The values match today.
- `canonicalJson` turns an own `undefined` value into `null`, while `JSON.stringify` omits that key. Command and event payloads are parsed JSON or Zod output, which do not contain `undefined`.
- `monotonicFactory` treats seed `0` as missing and calls `Date.now()`. `createBranchClock` with `lastRecordedAt >= 0` never returns 0 (`bootWall` is at least `last + 1`).
- `listOwnIPv4` is untested. On Node 22 `family` is the string `'IPv4'`, and a fake iface map returns only the non-internal IPv4. The plan does not name a test.
- Uppercase `::FFFF:` is not treated as IPv4-mapped. Node's `remoteAddress` and the review-focus example are lowercase. A non-match fails closed for the guest check only if some other layer uppercases the address; nothing in this module does.
- Empty `guest_network_cidrs` parses. M58's "at least one CIDR" is the setup endpoint (task 33, #105), and the plan marks the config field optional.
- Encrypted files are created with mode `0o600`, which the kernel masks with the umask, and §7.9 does not require `0600` or a directory fsync. Config writes do chmod and directory fsync, which §3.10 requires.
- `chmodSync` sits outside the rename `try`. A successful `writeFileSync` followed by a throwing `chmod` would leave `.tmp`. That is not the #122 crash (rename), and a read-only directory already fails the write, which does delete `.tmp`.
- Backup is not invoked when the callback throws, so later files are not applied. Task 11 owns that test (#124). The runner already awaits `backup` before the apply loop.
- `06` decrypts with `decryptFile`, not a second decoder. The #65 test checks the magic and a tag failure. A self-consistent layout bug would still have to pass that tag check.

## Fix list

### 1. `branchNow` can be a fractional millisecond

- **Where:** `apps/hub/src/lib/clock.ts` `branchNow` (`bootWall + (monoNow() - bootMono)`). Task 6, commit `a4b4482`. The test in `clock.test.ts` only advances `monoNow` by whole milliseconds.
- **What's wrong:** `performance.now()` is fractional. A boot clock whose mono reading moves by `0.4` returns `….4`. `ulid` 3.0.2 `encodeTime` throws `Time must be an integer` on that value, so `ulidGen` throws. `recorded_at` and `occurred_at` are `z.number().int()` (foundation §4.1, §6.6).
- **Why it matters:** Task 13 stamps `recorded_at` from `branchNow`, and every id goes through `ulidGen(clock)`. The first id after a fractional tick fails, and an event with a fractional `recorded_at` fails the envelope. The current test stays green.
- **Fix:** `Math.floor` the sum in `branchNow`. In the existing `[F §4.7] branchNow never jumps with the wall clock` test, advance mono by a fraction and expect the floored integer. Then `ulidGen` on that clock must return a ULID.
- **Spec change:** no.

### 2. The backup test never has two pending files

- **Where:** `apps/hub/test/db/migrate.int.test.ts`, `[F §6.8] calls backup once before the first pending file when user_version > 0`. Task 10, commit `a7ceb76`.
- **What's wrong:** After `user_version` is 1 the test adds only `0002_b.sql` and expects `[[1, 2]]`. A runner that calls `backup` inside the per-file loop still passes. The implementation calls it once with the last pending version (`migrate.ts`, before the apply loop). The test does not lock that.
- **Why it matters:** Foundation §6.8 copies the database once before the first pending file. Task 11 names that one file `pre-migrate-<from>-<to>`. A per-file callback writes one backup per file and the task 11 tests can still pass if they only add one migration.
- **Fix:** In that same test, add `0002` and `0003` in one run and expect a single call `[1, 3]`.
- **Spec change:** no.

### 3. Applied checksums are not required to be SHA-256

- **Where:** `apps/hub/test/db/migrate.int.test.ts`, `[F §6.8] applies pending files and records checksums`. The assertion selects `version, name, applied_at` and omits `checksum`.
- **What's wrong:** The second run proves the stored string still matches whatever function both sides use. Replacing `sha256hex` with another stable hash of the bytes keeps both tests green. Foundation §6.8 says SHA-256. The runner does use `sha256hex` of the raw file bytes.
- **Why it matters:** Task 11's restore compares that column only by "the file changed". A wrong algorithm is stored on every hub that boots, and a later correct checker refuses to start.
- **Fix:** In that same test, expect `checksum` to equal `sha256hex` of each fixture file's bytes.
- **Spec change:** no.

## Needs spec change

None.
