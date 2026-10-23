# Build review 1 — module 00 tasks 16–20

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `f191b8f` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) and foundation §4.1, §6.1, §6.2, §6.8 where those tasks cite it |
| Plan | `docs/plans/00-plan.md` tasks 1–20, including 5b and 5c |
| Done per `docs/reviews/build-log.md` | tasks 2–20. Task 1 is commit `4abf807` and is in range. |
| Date | 2026-10-23 |
| Verdict | Fix the list below before task 21. |

Checked: spec deviations, §10 test numbering (each number exactly once), tests that do not lock the case they name, files outside each task's file list, secrets in logs, and contracts later tasks import.

The previous copy of this file reviewed tasks 1–15. Those items were fixed in `13a613e` .. `c9cdd5e` and are not reopened. This pass re-read that range, confirmed the backup helper still aborts on an encrypt or unlink failure and still chmod's the plaintext to `0600`, and reviewed tasks 16–20.

## What matches

- The nineteen `[00 §10 #…]` tests in this range (`#21`, `#62`–`#65`, `#67`, `#70`, `#72`, `#74`, `#78`, `#83`, `#97`, `#101`–`#103`, `#111`, `#122`, `#124`, `#129`) each appear once. No later §10 number is claimed.
- `0002_devices_sessions.sql` and `0003_staff_directory.sql` match §5.1, including the partial unique index, the station CHECKs, `requester_ip NOT NULL`, and `pairing_tokens` limited to `tablet`/`phone`.
- `guardsFor` matches §3.9 for the guards this task owns: host on every group, provisioned on every group except `health` and `setup`, guest on every group except `health` (which sets `isGuest`), version on `device`, `device-session`, `pair`, `pair-request`, and `ws`.
- `applyStaffDirectory` ignores an equal or older version before any write, skips a weak or malformed hash, an unknown role, an unknown role permission, and an unknown approver, keeps a malformed existing staff row out of `removed`, and ends a removed owner's phone with `DeviceRevoked { cause: 'owner_removed', actor_id: null }`. Session and revoke events use the §4.2 streams.
- The error handler returns the §6.1 envelope. Secret headers are redacted and the handler still sees them. `console.warn` on a skip or an ignored version carries `kind`, `id`, and `reason` or the two version numbers, not a PIN, token, or key.
- Names later tasks import (`buildHubServer`, `HubDeps`, `StaffDirectory`, `applyStaffDirectory`, `createSession`, `endSession`, `revokeDevice`, `activity`, `isIdleExpired`, `guardsFor`, `attachRouteGuards`) match the plan.

## Declined

- `pnpm-lock.yaml` and the hub `package.json` dependencies in tasks 16 and 18. The server imports Fastify and Zod; `pinHash` imports argon2. Not a behavior change.
- `writer.ts` gained `clock`, `ids`, and `branchId` on `WriterTx` in task 19. Session and directory rows cannot be timestamped or addressed without them. The build log recorded the ruling.
- `server.int.test.ts` gained `group: 'health'` in task 20. `ready()` throws on a route with no group, so the task 16 tests would not boot.
- `createSession` draws the token from `cryptoSecrets`. `WriterTx` has no `SecretGen`. The token is returned to the caller. The call is not a banned `randomUUID`.
- Task 20 guards do not record `authGeneration`. Task 21 sets `req.authGen` when the device and session guards run.
- The socket half of #83. Task 45 closes `4403`.
- #129 does not log the kept PIN in. Login is task 39. This task's job is the stored row.
- An unknown path is not host-checked. §3.9 attaches guards from `onRoute`, and a path with no route has no group. Task 16's `404` test stands.
- §7.2's `branch_id`, `device_id`, `session_id`, `staff_id`, `route`, `status`, and `ms` on every line. Task 16 requires `request_id`. Device and session ids do not exist until task 21. Nothing later reads those fields.
- `127.0.0.1`, a trailing dot, and an uppercase host. Task 7 locks the matcher. The guard calls it.
- An IPv4-mapped guest address. The same matcher. The guard passes `request.ip` through.
- Malformed JSON becomes `500 INTERNAL_ERROR`. §7.1 says anything other than a `DomainError` or a Zod failure is `INTERNAL_ERROR`.
- WS close codes `4403` and `4426`. No WS route exists yet. Tasks 44 and 45 own them.
- A backup that fails both encrypt attempts and then fails to unlink leaves a mode `0600` file. The migration still throws, and boot step 1 deletes `pre-migrate-*.sqlite` on the next start.

## Fix list

### 1. Route guards run after Zod

- **Where:** `apps/hub/src/auth/guards.ts` `onRoute` hook, which assigns `opts.preHandler`. Spec §7.1 and §3.7 put host, provisioned, guest, and version on `onRequest`, and Zod on `preValidation`.
- **What's wrong:** Fastify runs `preValidation` before `preHandler`. A POST with `Host: evil.example:3000` and a body that fails the route schema returns `400 VALIDATION_FAILED`. The same body from a guest address, or on an unprovisioned hub, is also `400`.
- **Why it matters:** M45 is a rebinding control. Task 22's command routes are schema-validated. A bad host, a guest, or an unprovisioned hub would answer `400` whenever the body is wrong, and the handler's schema becomes visible before the guard.
- **Fix:** Attach the same handlers on `onRequest`, ahead of any route `onRequest`. Add `[00 §7.1] guards run before Zod`: a bad host, a guest address, and an unprovisioned hub each return their guard status for a body that fails Zod.
- **Spec change:** no.

### 2. A directory row the cache cannot store aborts the apply

- **Where:** `apps/hub/src/auth/apply-directory.ts` `keepGrant` and the staff loop, then `replaceCache`.
- **What's wrong:** `DirectorySchema` allows an `allowed` grant with a non-null `approver_role_id`, two grants for one permission, two `role_ids` for one staff member, and two staff rows with one id. The §5.1 CHECK and primary keys then throw, and the transaction rolls back. `denied_permissions` is copied without `isPermission`, so an unknown denial is stored and is not listed in `skipped`.
- **Why it matters:** M52 exists so one bad row cannot block a removal. A fired employee in the same push stays. A stored unknown denial starts denying that permission the moment a later module appends the name to the catalogue.
- **Fix:** Skip and list those rows (`approver set on an allowed grant`, `duplicate permission`, `duplicate role`, `duplicate staff`, `unknown permission` on a denial). Keep the first legal reference. The rest of the push, including a removal, commits. Cover it with `[00 §3.1 M52] a grant or reference the cache cannot store is skipped and the rest applies`.
- **Spec change:** no.

### 3. A kept role whose approver was removed aborts the apply

- **Where:** `apps/hub/src/auth/apply-directory.ts` the loop that pushes `previous.roles` for a kept staff member. `[00 §10 #129]` only checks `pin_hash`.
- **What's wrong:** M75 keeps the previous role. That role's `approver_role_id` is a foreign key. When the new directory omits both the role and the approver, the insert throws `FOREIGN KEY constraint failed` and the push rolls back. #129 would also pass if the hash were kept and the roles and denials were replaced.
- **Why it matters:** The malformed row is the one M75 is for. A removal in that push does not happen, and the kept person's old PIN, role, and denials are not what the next boot loads.
- **Fix:** When retaining a role, also retain any missing approver role from the previous cache, transitively. Extend #129 so a new display name, a new role, and an empty denial list leave the previous display name, role, and denial in place. Add the omitted-approver case to the M52-style apply test (or the same #129 test) and expect the directory version to advance and another staff member to be removed.
- **Spec change:** no.

### 4. #70 does not lock an admin session or the after-commit swap

- **Where:** `apps/hub/test/auth/apply-directory.int.test.ts`, `[00 §10 #70]`. The code ends `staff` and `admin`, and calls `setDirectory` from `tx.onCommit`.
- **What's wrong:** The test opens one staff session. Ending only `kind === 'staff'` passes. Calling `setDirectory` inside the transaction, before `beforeCommit`, also passes, because the assertion runs after `writer.run` returns.
- **Why it matters:** Spec #70 says staff and admin sessions end `staff_removed`. The plan puts the directory swap on `onCommit` so a rolled-back apply cannot leave memory ahead of the cache. Task 22 resolves permissions from that object.
- **Fix:** In that test, open an admin session for the removed staff member and expect `staff_removed` and a `SessionEnded` for it. Inside `beforeCommit` of the second apply, expect the in-memory directory to still grant `reprint-ticket`; after `run` returns, expect `not_granted`.
- **Spec change:** no.

### 5. Session ends are locked on the row, and #83 does not show one transaction

- **Where:** `[00 §10 #101]` and `[00 §10 #83]` in `apply-directory.int.test.ts`. `endSession` and `revokeDevice` do append the events, and both writes sit inside `applyStaffDirectory`.
- **What's wrong:** #101 asserts `end_reason` and never reads `SessionEnded`. Updating the columns and skipping the append passes. #83 asserts `revoked_at` after `run` returns, so a revoke in `onCommit` passes, and the phone session's `SessionEnded` is not required.
- **Why it matters:** §4.2 says `SessionEnded` is the only signal that a session ended. Task 25's `access_reconcile` and task 45's socket close both follow the event. M38 revokes the phone in the directory transaction; a crash after commit must not leave it paired.
- **Fix:** #101 expects a `SessionEnded` with `credentials_changed` for the staff and admin sessions and none for the other staff member. #83 records `directory_version` and `revoked_at` inside `beforeCommit` and expects both to already be the new values, and expects the phone session's `SessionEnded`.
- **Spec change:** no.

### 6. #102 does not prove an equal or older payload is not written

- **Where:** `[00 §10 #102]`. The equal and older calls send the same staff row the hub already has.
- **What's wrong:** A version check that still replaces the cache, as long as it does not append and does not change `directory_version`, passes.
- **Why it matters:** M51 is what stops a replayed push from restoring a fired employee's PIN. The task says no writes.
- **Fix:** Send the equal and the older versions with a different display name and an extra staff id. Expect the stored name and the staff set to stay as the version-2 apply left them.
- **Spec change:** no.

### 7. Idle expiry is not locked at the boundary

- **Where:** `apps/hub/src/auth/session-store.ts` `isIdleExpired`. No test calls it. The plan's formula is `idle_ttl_ms != null && now − max(row.last_activity_at, activity.get(id) ?? 0) > idle_ttl_ms`.
- **What's wrong:** `>=` still passes task 21's #98, which moves the clock to TTL + 1 s. Ignoring `activity` still passes #98, because that test does not touch the session.
- **Why it matters:** M46 says `>` . Task 41's sweeper and task 21's guard both call this function. A session touched in memory, or a session at exactly its TTL, would be ended early.
- **Fix:** Add `[00 §3.1 M46] isIdleExpired is strict and an activity touch counts`: exactly the TTL is not expired, one millisecond later is, a touch moves that boundary, and `idle_ttl_ms == null` is never expired.
- **Spec change:** no.

### 8. A multi-digit client version is not locked

- **Where:** `[00 §3.9] X-Client-Version below min returns 426`, which uses `0.9.0` and `1.0.0`. `isBelow` compares numeric components.
- **What's wrong:** A string compare still passes those two values. `1.0.9` against a minimum of `1.0.10` is not below under a string compare (`"9" > "1"`) and is below under the numeric compare.
- **Why it matters:** §3.9 says `< min_client_version`. Task 39's #36 rejects an old client. A string compare would let `1.0.9` through a `1.0.10` floor.
- **Fix:** In that test, set `min_client_version` to `1.0.10` and expect `1.0.9` to be `426` and `1.0.10` to pass.
- **Spec change:** no.

### 9. Provisioned and guest are only tested on one group

- **Where:** `[00 §10 #21]` blocks `/commands/test` (`device`) and lets `/health` and `/setup/provision` through. The guest test blocks `/commands/test` and lets `/health` through.
- **What's wrong:** Skipping `provisioned` on `admin`, or skipping `guest` on `setup`, still passes.
- **Why it matters:** §3.9 applies provisioned to every route except `/health` and `/setup*`, and guest to every route except `/health`. An open admin route before provisioning, or a setup route that answers a guest address, is the case the guards are for.
- **Fix:** In #21, expect `409 HUB_NOT_PROVISIONED` for one route of each of `device`, `device-session`, `admin`, `admin-device-public`, `admin-bootstrap`, `pair`, `pair-request`, and `ws`. In the guest test, expect `403` for a `setup` route as well as the device route.
- **Spec change:** no.

### 10. Secret body fields are declared and never logged

- **Where:** `[00 §7.2] secret headers are redacted in logs`. `REDACT_PATHS` lists `pin`, `password`, `backup_encryption_key`, and the other §7.2 names. The test sends headers only.
- **What's wrong:** Dropping every body path and leaving the header serializer in place still passes. No request logs a body today, so the paths are unexecuted.
- **Why it matters:** §7.2 and the plan's secret list exist so a later `log.info` of a parsed body cannot put a PIN or the backup key in journald. Task 48's #73 greps the auth logs for those values.
- **Fix:** In that test file, log an object that carries `pin`, `password`, and `backup_encryption_key` and expect the captured stream to contain `[Redacted]` and none of the values. The handler's own view of the headers stays as it is.
- **Spec change:** no.

### 11. Denial is not locked against a requires-approval-only grant

- **Where:** `[00 §10 #78]`. `S_DENY` is denied `reprint-ticket`, which `R_A` grants as `allowed`.
- **What's wrong:** Checking the denial only when an `allowed` grant exists still passes. A staff member whose only grant is `requires_approval`, and who is denied that permission, is not in the table.
- **Why it matters:** §3.6 returns `denied` before it looks at grants. Task 22's command rule treats `requires_approval` as a continue on an approvable command. A denial that lost to that grant would let the command through.
- **Fix:** In the same truth table, add a staff member on `R_B` only, denied `apply-discount`, and expect `{ grant: 'denied' }`.
- **Spec change:** no.

## Needs spec change

- **§10 #67 still says reset.** The catalogue row is "checkpoint behind `MAX(seq)` → `reset` + replay". M48 and §3.8 step 4 say `reset` + full replay only when the checkpoint row is missing; a checkpoint that is merely behind replays `seq > checkpoint`. Task 14 and the code follow M48. The §10 sentence should be updated to match M48. No code change.
