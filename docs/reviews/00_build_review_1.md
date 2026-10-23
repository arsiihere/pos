# Build review 1 — module 00 tasks 2–35b

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `86a6459` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) |
| Plan | `docs/plans/00-plan.md` tasks 2–35b |
| Done per `docs/reviews/build-log.md` | tasks 2–35b. Task 1 is commit `4abf807`. |
| Date | 2026-10-24 |
| Verdict | Fix the list below before task 35c. |

The previous copy of this file reviewed tasks 2–32b. Those items were fixed in `1c8e1fe` .. `20b8911` and are not reopened. This pass re-read the tree through task 35b, including the registration and confirm paths those fixes touched.

## What matches

- Every `[00 §10 #n]` name in the suite is unique (80 tests, 80 numbers). Numbers owned by tasks 2–35b are present once. Later-task numbers are absent.
- Setup follows §6.4: normalise the code, persist `setup_attempt_id` before the cloud call, skip a second `HubProvisioned`, issue the bootstrap token inside the same transaction, write the key and backup key, return the fragment URL and `qrSvg`, exit 0. A weak hash is skipped and setup still returns 200.
- PIN order matches §3.5: subject lock, staff lock, directory lookup, semaphore, verify outside the transaction, re-read locks inside it. A correct PIN that is still verifying when the staff counter crosses 5 gets `429`. An expired staff lock counts the next failure as 1 (`attempts_remaining` 4). Device and IP windows restart at 300 000 ms. `"0123"` is not `"123"`.
- `/admin/auth` rejects a missing token, a kds, and a phone whose `staff_id` is not the owner before PIN work. A cashier's correct PIN resets the staff counter and does not open a session. Logout of a bootstrap session does not require a device token. The roster accepts a live bootstrap header and hides an expired lock.
- No new code logs a PIN, bootstrap token, registration code, or branch API key. Confirm's log line is the error and `hub confirm failed`. `console.warn` on a directory skip carries the staff id and the reason, not `pin_hash`.

## Declined

- Hand-rolled HS256 on `app.jwt`. Task 29's file list excluded `package.json`. Claims stay `sub`, `tenant_id`, `allowed_branch_ids`, 1 h.
- `HUB_MIN_VERSION` is loaded and never compared. §6.5 and §6.28 do not say to reject an old hub.
- `server.ts`, guard tests, `test-hub.ts`, `boot.int.test.ts`, and dependency additions outside some task file lists. The build log recorded those rulings. Task 35's guard-test edits are the same kind of ruling.
- `createSession` draws tokens from `cryptoSecrets`. The writer has no `SecretGen`.
- `#93` calls `checkPin` on the PIN semaphore. `POST /auth/pin` is task 39. Task 39 must pass `authSemaphores(app).pin`.
- Bootstrap `SessionStarted` payload `device_id` is null. That is the session row (§6.29). The envelope column is `hub-admin` (M7). `#92` asserts the column.
- `#114` covers `/admin/auth` only. The plan puts `/auth/pin` `STAFF_NOT_FOUND` in task 39 as `[00 §6.9]`, so the §10 number stays single.
- Setup mode does not mount command, query, or admin routes. The plan's task 25 test forbids those names in `printRoutes`. §3.2's 409 is the not-found handler (fix 3), not a second copy of every route.

## Needs spec change

- **A replay after confirm revokes the key the hub just stored.** §6.5 step 3 rotates on every valid exchange, including the same Idempotency-Key while `now − consumed_at < 3 600 000`. §6.28 expires unconsumed codes only, so the consumed code stays usable. Confirm can succeed, the hub can store `branch_api_key` and stop, and a replay inside the hour then revokes that key. Closing it means changing M14 or §6.28 (once `hub_confirmed_at` is set, the same-attempt exchange is `401` and does not rotate). Not changed here.

## Fix list

### 1. A rejected PIN match rolls back the staff-counter reset

- **Where:** `apps/hub/src/auth/pin.ts` `checkPin`. The reset and `onMatch` share one `writer.run`. A throw rolls the transaction back.
- **What's wrong:** §3.5 step 9 resets the staff counter, then runs the endpoint's success steps in that transaction. §6.9 says another staff member without takeover is `409 DEVICE_SESSION_ACTIVE` and the counters stay reset. Task 39's file list is `staff-session.ts` and `server.ts`. It cannot change `pin.ts`. The natural `onMatch` (check the holder, throw `DomainError`) undoes the reset.
- **Why it matters:** Task 39's `#35` cannot pass without editing a file the plan does not list.
- **Fix:** If `onMatch` throws after the reset statement, run a second `writer.run` that only resets the staff counter, then rethrow. A lockout throw before the reset must not clear the counter. Test `[00 §3.5] a DomainError from the match callback keeps the staff counter reset and writes no session`. Do not add a `[00 §10 #…]` name.
- **Spec change:** no.

### 2. An IP lockout stream id is the raw address

- **Where:** `apps/hub/src/auth/pin.ts` `recordFailure` for `subject.type === 'ip'`. `stream_id` is `o.subject.id`.
- **What's wrong:** §4.2 `DevicePinLockedOut` stream is `hub / device_id` or `ip:<addr>`. The payload `subject_id` is correct. The stream id is not. The existing `[00 §3.5]` IP test reads the payload only.
- **Why it matters:** Later modules partition by stream id. A device id and an IP that happen to be the same string would share a stream, and a reader looking for `ip:` will not find the row.
- **Fix:** `stream_id` is `ip:${subjectId}` when the subject is `ip`. Extend the existing `[00 §3.5] ip subject locks…` test to expect that `stream_id`. Do not add a second test name.
- **Spec change:** no.

### 3. An unprovisioned hub returns 404 for every other path

- **Where:** `apps/hub/src/lib/boot.ts` setup branch. It mounts `/health` and `/setup` only. `installHubErrors` answers an unknown path with `404 ROUTE_NOT_FOUND`.
- **What's wrong:** §3.2: while unprovisioned, every route except `GET /health`, `GET /setup`, and `POST /setup/provision` returns `409 HUB_NOT_PROVISIONED`. `#21` registers those routes on a test hub, so production boot stays 404. §7.1 still checks the Host before that: a bad Host is `403`, not 409.
- **Why it matters:** A tablet that reaches the hub during setup cannot tell "not provisioned" from "no such route". Task 39 and later do not edit this branch.
- **Fix:** On the setup app, the not-found handler checks the host matcher first (`403 HOST_NOT_ALLOWED`), otherwise `409 HUB_NOT_PROVISIONED`. Extend `[00 §3.8] unprovisioned → setup mode routes only` so `GET /commands/x` is 409, `GET /commands/x` with `Host: evil.example:3000` is 403, and `printRoutes()` still has no command, query, admin, or auth route. Do not add a second `[00 §10 #21]`.
- **Spec change:** no.

### 4. Boot throws the hub log away

- **Where:** `apps/hub/src/lib/boot.ts` `createDeps` sets `logStream` to a `Writable` that drops every chunk. `buildHubServer` writes pino there. The confirm task logs with `app.log.error`.
- **What's wrong:** §7.2 is JSON to journald (stdout under systemd). §6.28 says a confirm 401, a 5xx, and a network error are logged and retried. The call happens. The bytes are discarded. Task 46's file list is `server.ts` and two new tests. It cannot point boot at stdout.
- **Why it matters:** A hub that never confirms leaves no log line. The branch API key must not appear in that line.
- **Fix:** Default the stream to `process.stdout`. Accept an optional `logStream` on `boot()` so the test can collect it. Test `[00 §6.28] a confirm failure is logged and the branch api key is not`: provisioned, not confirmed, `cloud_base_url` on a closed port, the captured line contains `hub confirm failed` and does not contain the key.
- **Spec change:** no.

### 5. The bootstrap page throws away the admin session token

- **Where:** `apps/hub/src/auth/admin-bootstrap.ts` `PAGE`. The login `fetch` does not read the response.
- **What's wrong:** §8.2: `admin_session_token` lives in `sessionStorage` only. This page is the client that receives it. No later task edits `admin-bootstrap.ts`. Task 37's pair page looks in `sessionStorage` for an admin token so it can log out (M43). Nothing ever writes the key.
- **Why it matters:** First-admin login succeeds and the browser has no token. The manager cannot call `/admin/*` from that page, and `#94` has nothing to clear.
- **Fix:** On a 200 body, `sessionStorage.setItem('admin_session_token', body.data.admin_session_token)`. Do not put the token in the URL. Extend `#92`'s static check to require that `setItem` and to reject `localStorage`. Do not add a second `[00 §10 #92]`.
- **Spec change:** no.

### 6. The IP lockout test uses one address

- **Where:** `apps/hub/test/auth/admin-bootstrap.int.test.ts` `[00 §10 #92]`. Ten failures and the 429 all use inject's default IP.
- **What's wrong:** §3.5 and §6.29 count the bootstrap path per client IP. A single global counter would pass.
- **Why it matters:** A later change that keys the lock on `'ip'` alone locks every manager after one guest's ten guesses.
- **Fix:** In the same `#92` test, after the 429, the same token from a second IP is `401 PIN_INVALID`, not `429`. Do not add a test name.
- **Spec change:** no.

### 7. A crashed setup can leave two live bootstrap tokens and still pass

- **Where:** `apps/hub/test/setup/provision.int.test.ts` `[00 §10 #20]`. It checks one `HubProvisioned` and a reused `setup_attempt_id`.
- **What's wrong:** §6.4 note: if the config write fails, the retry creates a new bootstrap token and the old one expires. The test never reads `admin_bootstrap_tokens`.
- **Why it matters:** Two live tokens means the lost response's link still opens an admin session after the retry.
- **Fix:** In the same `#20` test, after the 200 retry, exactly one row has `consumed_at` null and `expires_at` greater than `branchNow`, and there are two `AdminBootstrapTokenIssued` events. Do not add a test name.
- **Spec change:** no.

### 8. The confirm task's 401 retry is untested

- **Where:** `apps/hub/test/setup/confirm-task.int.test.ts` `[00 §3.1 M41]`. The stub throws a network error, then 503, then succeeds.
- **What's wrong:** §6.28 hub side: on 401, log and retry in 60 s. `startConfirmTask` retries every thrown error, so a 401 happens to retry. The test would stay green if a 401 stopped the loop.
- **Why it matters:** A rotated key (M14) answers 401. Stopping there leaves `confirmed_at` unset forever. The plan's file list for later tasks does not include `confirm-task.ts`.
- **Fix:** In the same test, the first failure is `401 BRANCH_API_KEY_INVALID`, the loop tries again, and success still writes `confirmed_at` and stops. Do not add a test name.
- **Spec change:** no.

### 9. The admin roster test never uses a phone

- **Where:** `apps/hub/test/auth/admin-session.int.test.ts` `[00 §10 #41]`. Tablet and bootstrap only.
- **What's wrong:** §6.13: on a phone the list is the owner, if that owner has `access-hub-admin`. The handler filters. The test does not.
- **Why it matters:** A phone roster of every admin is the enumeration M42 removed. `#82` is the staff roster, a later task, and it will not edit this test.
- **Fix:** In the same `#41` test, a phone owned by `S_OWNER` gets only that row, and a phone whose owner lacks `access-hub-admin` gets `staff: []`. Do not add a test name.
- **Spec change:** no.
