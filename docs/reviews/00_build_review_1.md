# Build review 1 — module 00 tasks 1–28

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `f16e21d` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) |
| Plan | `docs/plans/00-plan.md` tasks 1–28 |
| Done per `docs/reviews/build-log.md` | tasks 2–28. Task 1 is commit `4abf807`. |
| Date | 2026-10-23 |
| Verdict | Fix the list below before task 29. |

Earlier copies of this file reviewed tasks 1–25. Those items were fixed in `13a613e` .. `14dcfc6` and are not reopened. This pass re-read the current tree for tasks 1–28 against the spec and the plan, and checked that every `[00 §10 #n]` name in the suite is unique.

## What matches

- Every §10 number the coverage table assigns to tasks 1–28 is present once: `#1`–`#14`, `#21`, `#58`, `#62`–`#68`, `#70`–`#72`, `#74`, `#75`, `#78`, `#83`, `#85`–`#88`, `#97`–`#103`, `#106`, `#108`, `#110`, `#111`, `#115`–`#117`, `#122`, `#124`, `#128`, `#129`. No `[00 §10 #n]` name is duplicated. Numbers owned by later tasks are absent.
- The command pipeline follows §3.7 on the paths the tests hit: device replay before the idle check, admin replay by `session_id`, idle expiry writes one `SessionEnded`, an ended bootstrap session is `ADMIN_SESSION_REQUIRED`, query limits are 50 and 200, and `DEVICE_TYPE_NOT_ALLOWED` carries the device type.
- `0001_platform.sql` matches §5.2 (tables, checks, partial unique indexes, no `idempotency_keys`, no `is_admin_role`). Repositories throw `TypeError('TenantContext required')` without a frozen context. Credential lookups are by email or hash only, and `forUpdate` appends `FOR UPDATE`.
- Boot writes `ClockAlarm` then `HubStarted`. `/health` returns `{ status }` to a guest and the full body otherwise. `DeviceTokenRotated` changes `token_hash` only in catch-up mode.
- No new code logs a PIN, token, password, `pin_hash`, or backup key. Directory warnings are version or `{ kind, id, reason }`.

## Declined

- In-transaction re-check compares the presented device token to `token_hash`. §3.7 and plan task 23 name only `revoked_at` → `DEVICE_REVOKED` and `ended_at` → `SESSION_EXPIRED`. `DeviceTokenRotated` bumps `authGeneration` so the re-check runs; it does not add a third code.
- In-flight admin command after `access-hub-admin` is removed but the command permission remains. M61 is the guard on the next request (`#106` leaves the session open). Inside the transaction, §3.7 resolves the command's permission, which `#86` locks.
- `server.ts`, `guards.int.test.ts`, `test-hub.ts`, and `boot.int.test.ts` outside some task file lists. The build log recorded those rulings. They do not hide a spec miss.
- Publish runs inside `writer.run`, before the HTTP body. Task 15 owns that order. Task 45 attaches the socket there.
- `hub_version` `0.0.0` and `missed_fires` 0. The build log recorded both. Missed fires belong to module 03a.
- `StaffDirectory.load` at step 4a is discarded. Guards load again at step 7.
- `pnpm-lock.yaml` and dependency additions the tasks needed to compile. Already declined.
- Cloud `BIGINT` columns come back as strings from `node-pg`. The SQL types match §5.2. Task 32 coerces `directory_version` when it parses a directory.

## Needs spec change

None.

## Fix list

### 1. A second `endSession` appends another `SessionEnded`

- **Where:** `apps/hub/src/auth/session-store.ts` `endSession`. The early return checks the in-memory `ended_at` only. The `UPDATE … WHERE ended_at IS NULL` result is ignored, and the append always runs.
- **What's wrong:** §3.4: "Every transition to ENDED writes exactly one `SessionEnded` … ENDED is terminal." Two `writer.run` calls can both hold a row read while it was active. The second update changes 0 rows and still appends. Logout, the sweeper, and force-logout (tasks 39, 41, 42) are separate transactions.
- **Why it matters:** Module 02 releases locks on `SessionEnded`. A second event releases them twice.
- **Fix:** If `changes === 0`, return before `activity.forget` and `append`. After a successful update, set `s.ended_at` so a second call with the same object returns at the top. Test `[00 §3.4] a second endSession on a stale row writes no SessionEnded`: end with `logout`, call again with the same object and reason `forced`, expect one event and `end_reason` `logout`.
- **Spec change:** no.

### 2. Step 4b scans the event log on the boot §7.8 says skips it

- **Where:** `apps/hub/src/projections/access-reconcile.ts` `restoreEmptyStaffSessions`. `apps/hub/test/helpers/big-fixture.ts` inserts no `staff_sessions` row. `[00 §10 #100]` copies that file.
- **What's wrong:** M48 and §3.8 step 4b run only when `staff_sessions` is empty and session events exist, because an unindexed scan grows with history. The existence check is `COUNT(*)` on `events` filtered by `event_type`. Nothing indexes `event_type`. §7.8's 1 M-event target is "4b skipped". The fixture has an empty `staff_sessions`, so #100 pays the scan, and `events_replayed === 0` does not see it. After task 41 deletes ended sessions, a boot with nobody logged in takes the same path.
- **Why it matters:** Tasks 44 and 45 open `/ws` only after boot. The scan sits in front of listen.
- **Fix:** Probe with `events_stream` and stop at one row: `stream_type` `staff` or `station`, `event_type` in `SessionStarted` / `SessionEnded`, `LIMIT 1`. Read payloads through that index too. Insert one `staff_sessions` row in the 1 M fixture and treat a cache without that row as stale. Test `[00 §3.1 M48] an empty staff_sessions table probes session streams instead of counting the event log`: the prepared SQL uses `stream_type` and `LIMIT 1`, and does not `COUNT(*)` the events table.
- **Spec change:** no.

### 3. `hub_restored` is stamped with the session's device

- **Where:** `apps/hub/src/projections/access-reconcile.ts` `sessionEndedDraft` sets `device_id` to `session.device_id ?? 'hub'`. `[00 §10 #88]`'s tail `SessionStarted` payload carries `device_id: 'dev-kept'`. `sessionEnds` reads the payload only.
- **What's wrong:** M7: "System events use `device_id = 'hub'`." `staff_removed` and `credentials_changed` already pass `'hub'`. A restore ending is a system event. The envelope column is the remembered session's device.
- **Why it matters:** Task 45 closes the socket from `session_id` and `reason`, so this does not change the close. The event 06 syncs is still attributed to the tablet.
- **Fix:** Set `device_id: 'hub'` on both the catch-up and step 4b drafts. In #88's tail case, expect the `events.device_id` column of that `SessionEnded` to be `hub`.
- **Spec change:** no.

### 4. WebSocket guards throw HTTP errors, so task 44 cannot close `4403` or `4426`

- **Where:** `apps/hub/src/auth/guards.ts` `host`, `guest`, and `version`. Group `ws` is `host`, `provisioned`, `guest`, `version`.
- **What's wrong:** §3.9: a bad host or a guest address is `403` "(WS: close `4403`)"; a too-old client is `426` "(WS: `4426`)". §6.21 step 1 says the same, with zero frames. The hooks throw `DomainError`, so the upgrade never becomes a socket. Plan task 44 may modify `server.ts` and create `ws/server.ts`. It may not modify `guards.ts`. `GET /ws` has to use group `ws` or `ready()` fails (#72).
- **Why it matters:** Task 44's tests `#48`, `#119`, and the WS half of #97 cannot observe a close frame while these hooks throw.
- **Fix:** On group `ws` only, do not throw. Set `request.wsClose` to `4403` for a bad host or a guest address, and `4426` for a too-old version. A later ws guard returns when `wsClose` is already set, so a bad host stays `4403`. HTTP groups still throw. Test `[00 §3.9] a ws route records close 4403 for a bad host or a guest and 4426 for an old client`. Task 44's upgrade handler closes with that code and sends no frame.
- **Spec change:** no.

### 5. An idle bootstrap session is ended as `hub`, not `hub-admin`

- **Where:** `apps/hub/src/auth/guards.ts` `endIdle` passes `fresh.device_id ?? 'hub'`. `[00 §10 #115]` idles a device-bound admin session. The bootstrap case in that test is a live session, then an already-ended one.
- **What's wrong:** M7 and §3.4: the bootstrap session has no device and uses `device_id = 'hub-admin'` in events. `openSession` already writes `SessionStarted` with `hub-admin`. The idle `SessionEnded` uses `hub` because the row's `device_id` is null.
- **Why it matters:** Task 35b and task 39 end this same session. The idle path is the one the guard owns now.
- **Fix:** When `kind === 'admin'` and `device_id` is null, pass `'hub-admin'`. Use the same choice in `endSessionNow`. In #115, idle a bootstrap session and expect one `SessionEnded` whose `device_id` column is `hub-admin`.
- **Spec change:** no.

### 6. The schema tests never lock "roles has no `is_admin_role`"

- **Where:** `apps/cloud/test/schema.int.test.ts`. Plan task 27, step 1, lists this next to the missing `idempotency_keys` table. The migration does not create the column. The approver insert names `(tenant_id, role_id, name, session_idle_ttl_ms)` only, so a nullable column or a column with a default still passes.
- **What's wrong:** M57: "No `is_admin_role`." Nothing reads `information_schema.columns` for `roles`.
- **Why it matters:** Task 30's `DEFAULT_ROLES` and task 31's "no flag" path stay green if the column appears.
- **Fix:** `it('[00 §5.2] roles has no is_admin_role')` selects `column_name` for `roles` and expects no `is_admin_role`.
- **Spec change:** no.

### 7. A frozen `TenantContext` can still gain branches

- **Where:** `apps/cloud/src/db/tenant-scoped-repository.ts` `isTenantContext` and `query`. The test helper deep-freezes `branchIds`. `#75` only passes an unfrozen outer object.
- **What's wrong:** Plan task 28: `TenantContext` is frozen, and both repositories throw `TypeError('TenantContext required')` without one. `Object.freeze` on the outer object leaves the array mutable. `query` spreads `this.ctx.branchIds` at call time, so `branchIds.push(...)` widens the next scoped query.
- **Why it matters:** Task 29 builds this object from the JWT `allowed_branch_ids`. A shallow freeze passes the guard.
- **Fix:** `assertTenantContext` returns `Object.freeze({ tenantId, branchIds: Object.freeze([...branchIds]) })`. Test `[F §3.4] a shallow-frozen context cannot gain a branch`: freeze `{ tenantId, branchIds }`, construct the repository, push another branch of the same tenant, and expect the query to return the original branch only.
- **Spec change:** no.
