# Build review 1 — module 00 tasks 2–49

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `863f8ab` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) |
| Plan | `docs/plans/00-plan.md` tasks 2–49 |
| Done per `docs/reviews/build-log.md` | tasks 2–49. Task 1 is commit `4abf807`. Tasks 50 and 51 are skipped. |
| Date | 2026-10-24 |
| Verdict | Fix the list below. Tasks 50 and 51 stay with the owner. |

Earlier passes (`47c0b06`, `c82d55a`) and the fix commits through `a563c62` are not reopened. This pass re-read the tree at `863f8ab`.

## What matches

- Every `[00 §10 #n]` for 1–131 is present once, except `#79` (task 50, the hardware smoke test). No number is used twice.
- WebSocket auth, publish, CORS, owner refresh, logout, confirm, and `/v1/health` match the sections those tasks implemented. `DeviceTokenRotated` closes `4401`. An old socket client closes `4426`. Request URLs redact `t`, `device_token`, and `session_token`. `#73` also rejects the dashed registration code.
- `#96` stores the plaintext device token in `delivery_token` and checks it hashes to the device row. `#95` checks the poll returns that column. Together they cover the approve-to-poll handoff.
- No hub or cloud log line writes a PIN, password, bootstrap token, registration code, branch API key, pairing token, poll secret, or `pin_hash`.

## Declined

- `#42`'s socket close `4403` is locked by `[00 §4.2]` in `ws-publish.int.test.ts`. The named test does not open a socket. Not reopened.
- `#90`'s hub half stays in `[00 §3.1 M41]`. The cloud half is the named `#90` test.
- `#98`'s second login is `[00 §3.1 M46]`. The named test locks the command `401`.
- Files outside a task list that only removed a colliding stub route. Not reopened.
- `TestFails` throws `STAFF_NOT_FOUND` with no `staff_id`. It is a synthetic handler error for `#11`, not a directory lookup.

## Needs spec change

- **§10 #53 still says the 10th failure is 429.** The test title repeats that sentence. The body expects ten `401 LOGIN_INVALID` responses, `failed_login_count: 10`, and `login_locked_until` set. M73 and §6.22 step (5) say login never returns `LOGIN_LOCKED_OUT`. Leave the 401. The spec owner rewrites that sentence.
- **`branch_name` is discarded at setup.** §6.8, §6.31, and M37 require it. §3.10 has no config field, and `HubProvisioned` is `{ tenant_id, branch_id, hub_version }`. The hub returns `''`. Not changed here.
- **A QR scan cannot open `/admin/approve`.** §8.2 says scanning `approve_url` opens `/admin/approve?r=…`. `GET /admin/approve` is group `admin`, so the navigation has no `Authorization` and no `X-Admin-Session`. Not changed here.
- **`pairing_source` does not survive retention.** §6.17 requires `token` or `request`. §5.1 deletes pairing tokens whose `expires_at` is older than 7 days, and a token expires 10 minutes after it is issued. A week later every token-paired device is reported as `request`. §5.1 has no column for the source. Not changed here.

## Fix list

### 1. One IP can record more than 30 login failures at once

- **Where:** `apps/cloud/src/modules/owner-auth/service.ts` `login`. `[00 §10 #109]` records 30 failures one after another, and its 10 parallel failures use a different address each.
- **What's wrong:** `check` runs, then login awaits the email lookup and argon2, and only then calls `record`. Every request that passes `check` before any of them records is allowed through. A burst from one IP all see the same count and all return `401 LOGIN_INVALID`.
- **Why it matters:** §6.22 step (1) is the cap on trying many owner emails from one address. The account counter is atomic. The IP cap is not.
- **Fix:** Count the attempt in `check`, before the first await, and drop that timestamp only when the password matches and the tokens commit. In `#109`, 31 simultaneous failures from one IP yield 30 `401`s and one `429`. A success does not consume a slot. Do not add a test name.
- **Spec change:** no.

### 2. An idle admin logout is stored as logout

- **Where:** `apps/hub/src/auth/admin-session.ts` `POST /admin/auth/logout`. The route group is `admin-bootstrap`, so `requireAdmin` does not run.
- **What's wrong:** An admin session past its idle TTL is ended `'logout'` and the response is 200. `requireAdmin` ends the same session `'idle_timeout'` and returns `401 ADMIN_SESSION_REQUIRED`. `/auth/logout` does that in the session guard before the handler. §3.9 applies the admin session guard, including M46, to `/admin/*` except `/admin/auth`, `/admin/auth/bootstrap`, and `/admin/login-roster`. Logout is not one of those three. §6.12 still accepts an already-ended session as `already_ended`, which is why the route cannot use `requireAdmin` as written.
- **Why it matters:** The audit says the manager logged out. The session had already expired. A later report treats it as an intentional logout.
- **Fix:** After the ended-session check, an idle session is ended `'idle_timeout'` and the response is `401 ADMIN_SESSION_REQUIRED`. An already-ended session stays `200` with `already_ended`. In `#40`, advance past the idle TTL and assert that. Do not add a test name.
- **Spec change:** no.

### 3. A lost provision response leaves the process up

- **Where:** `apps/hub/src/setup/provision.ts`, the `reply.send(...).then` after `saveConfig`.
- **What's wrong:** `exit(0)` runs only when `send` resolves. The rejection handler rethrows. Config is already provisioned, `setupInProgress` is cleared, and this process was booted as the setup server. Setup routes are now 404. systemd does not restart it.
- **Why it matters:** M13 exits so there is no "become provisioned while running" path. §6.4 says exit after the response is flushed. Once the config write has succeeded, staying up is that path.
- **Fix:** Call `exit(0)` after the send attempt whether the flush succeeds or throws. Do not exit when a step before the config write fails. Add `[00 §6.4]` for a flush that throws. Do not add a §10 number.
- **Spec change:** no.

### 4. A paired screen reloads into a new pairing request

- **Where:** `apps/hub/src/auth/pair-page.ts`. With no `?t=`, the script always `POST`s `/pair/requests`. The IndexedDB token is read first and then ignored on this path. `device_type` is not stored. A non-200 create reads `body.data` and throws, so a `429` or `503` draws no retry button.
- **What's wrong:** §8.2 stores `device_token` in IndexedDB and has the KDS call `POST /auth/station` so the screen stays paired. Chrome kiosk mode reopens `/pair`. A second approval creates a second device. `#94` checks that the HTML contains strings, and the `if (deviceToken)` login branch sits after the screen path returns, so the test stays green.
- **Why it matters:** A kiosk or KDS restart looks unpaired and fills the pairing-request cap.
- **Fix:** If a device token is already stored, do not create a request. Persist `device_type` with the token. On load, call `/auth/station` for `kds`, otherwise show login. A non-200 create shows "Ask a manager" and a button that starts again. In `#94`, the `if (!pairingToken)` block checks `deviceToken` before `fetch('/pair/requests')`, and that branch contains `/auth/station`. Do not add a test name.
- **Spec change:** no.

### 5. §9 `details` are missing on several hub errors

- **Where:** bare `DomainError` throws in `apps/hub/src/auth/pairing.ts`, `staff-session.ts`, `admin-session.ts`, `station-session.ts`, `pin.ts`, `commands/generate-device-pairing-token.ts`, and `commands/approve-pairing-request.ts`.
- **What's wrong:** §9 defines `DEVICE_TYPE_NOT_ALLOWED { device_type, allowed }`, `DEVICE_NOT_OWNED { device_id }`, `STAFF_NOT_FOUND { staff_id }`, and `STATION_NOT_FOUND { station_id }`. The query route already sends `device_type` and `allowed`. These throws send `{}`. The tests that hit them assert `error.code` only, so deleting a future details object would stay green.
- **Why it matters:** §8 clients read `allowed`, `staff_id`, and `station_id` from `details`.
- **Fix:** Pass those objects. Assert them in the existing `#29`, `#36`, `#39`, `#80`, `#81`, `#91`, `#96`, and `#114` tests. Leave `TestFails` alone. Do not add a test name.
- **Spec change:** no.

### 6. #22 never puts active staff on a second branch

- **Where:** `apps/cloud/test/hub-registration.int.test.ts` `#22`, and `loadDirectory` in `apps/cloud/src/modules/hub-registration/repository.ts`.
- **What's wrong:** §10 #22 says the directory has this branch's staff only. The fixture's cashier is active and has no `staff_branches` row. Gone is on this branch and inactive. Deleting `AND sb.branch_id = $2` from the staff query and from the roles CTE still returns only the owner. The SQL does filter. The test does not lock it.
- **Why it matters:** §6.27 puts the owner on every new branch. A later edit can ship another branch's `pin_hash` values in this hub's directory.
- **Fix:** In `#22`, add a second branch, an active staff member assigned only to it, and a role assigned only to that staff member. Assert that staff id and role name are absent from the first branch's directory. No production change while the SQL stays as written. Do not add a test name.
- **Spec change:** no.
