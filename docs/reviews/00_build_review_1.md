# Build review 1 — module 00 tasks 2–49

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `d624e79` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) |
| Plan | `docs/plans/00-plan.md` tasks 2–49 |
| Done per `docs/reviews/build-log.md` | tasks 2–49. Task 1 is commit `4abf807`. Tasks 50 and 51 are skipped. |
| Date | 2026-10-24 |
| Verdict | Fix the list below. Tasks 50 and 51 stay with the owner. |

Earlier passes through `7568d56` and the fix commits through `d624e79` (`eabd4f8` login IP count-before-await; `d624e79` idle admin logout) are not reopened. This pass re-read the tree at `d624e79`.

## What matches

- Every `[00 §10 #n]` for 1–131 is present once, except `#79` (task 50, the hardware smoke test). No number is used twice.
- WebSocket auth, publish, CORS, owner refresh, logout, confirm, and `/v1/health` match the sections those tasks implemented. `DeviceTokenRotated` closes `4401`. An old socket client closes `4426`. Request URLs redact `t`, `device_token`, and `session_token`. `#73` also rejects the dashed registration code.
- `#96` stores the plaintext device token in `delivery_token` and checks it hashes to the device row. `#95` checks the poll returns that column. Together they cover the approve-to-poll handoff.
- No hub or cloud log line writes a PIN, password, bootstrap token, registration code, branch API key, pairing token, poll secret, or `pin_hash`. Hub redacts secret headers. Owner login IP limiter reserves a slot in `check` before the first await (`eabd4f8`). Idle admin logout ends `idle_timeout` (`d624e79`).

## Declined

- `#42`'s socket close `4403` is locked by `[00 §4.2]` in `ws-publish.int.test.ts`. The named test does not open a socket. Not reopened.
- `#90`'s hub half stays in `[00 §3.1 M41]`. The cloud half is the named `#90` test.
- `#98`'s second login is `[00 §3.1 M46]`. The named test locks the command `401`.
- Files outside a task list that only removed a colliding stub route. Not reopened.
- `TestFails` throws `STAFF_NOT_FOUND` with no `staff_id`. It is a synthetic handler error for `#11`, not a directory lookup.
- Hand-rolled HS256 instead of `@fastify/jwt` (task 29 build-log ruling). Runtime-correct; not a defect.
- Whether an idle staff `/auth/logout` should prefer `idle_timeout` over `logout` the way admin logout now does. Spec §3.4 lists idle endings as guard/login/sweeper; staff logout already runs under the session guard.

## Needs spec change

- **§10 #53 still says the 10th failure is 429.** The test title repeats that sentence. The body expects ten `401 LOGIN_INVALID` responses, `failed_login_count: 10`, and `login_locked_until` set. M73 and §6.22 step (5) say login never returns `LOGIN_LOCKED_OUT`. Leave the 401. The spec owner rewrites that sentence.
- **`branch_name` is discarded at setup.** §6.8, §6.31, and M37 require it. §3.10 has no config field, and `HubProvisioned` is `{ tenant_id, branch_id, hub_version }`. The hub returns `''`. Not changed here.
- **A QR scan cannot open `/admin/approve`.** §8.2 says scanning `approve_url` opens `/admin/approve?r=…`. `GET /admin/approve` is group `admin`, so the navigation has no `Authorization` and no `X-Admin-Session`. Not changed here.
- **`pairing_source` does not survive retention.** §6.17 requires `token` or `request`. §5.1 deletes pairing tokens whose `expires_at` is older than 7 days, and a token expires 10 minutes after it is issued. A week later every token-paired device is reported as `request`. §5.1 has no column for the source. Not changed here.
- **§10 #114 vs plan task 35.** Spec text includes `STAFF_NOT_FOUND` on `/auth/pin` and `/admin/auth`; the plan moves the `/auth/pin` half to `[00 §6.9]`. Coverage exists; wording disagrees. Not changed here.

## Fix list

### 1. A lost provision response leaves the process up

- **Where:** `apps/hub/src/setup/provision.ts`, the `reply.send(...).then` after `saveConfig`.
- **What's wrong:** `exit(0)` runs only when `send` resolves. The rejection handler rethrows. Config is already provisioned, `setupInProgress` is cleared, and this process was booted as the setup server. Setup routes are now 404. systemd does not restart it.
- **Why it matters:** M13 exits so there is no "become provisioned while running" path. §6.4 says exit after the response is flushed. Once the config write has succeeded, staying up is that path.
- **Fix:** Call `exit(0)` after the send attempt whether the flush succeeds or throws. Do not exit when a step before the config write fails. Add `[00 §6.4]` for a flush that throws. Do not add a §10 number.
- **Spec change:** no.

### 2. A paired screen reloads into a new pairing request

- **Where:** `apps/hub/src/auth/pair-page.ts`. With no `?t=`, the script always `POST`s `/pair/requests`. The IndexedDB token is read first and then ignored on this path. `device_type` is not stored. A non-200 create reads `body.data` and throws, so a `429` or `503` draws no retry button. After approve, a non-`kds` screen stores the token and returns with a blank UI.
- **What's wrong:** §8.2 stores `device_token` in IndexedDB and has the KDS call `POST /auth/station` so the screen stays paired. Chrome kiosk mode reopens `/pair`. A second approval creates a second device. `#94` checks that the HTML contains strings, and the `if (deviceToken)` login branch sits after the screen path returns, so the test stays green.
- **Why it matters:** A kiosk or KDS restart looks unpaired and fills the pairing-request cap.
- **Fix:** If a device token is already stored, do not create a request. Persist `device_type` with the token. On load, call `/auth/station` for `kds`, otherwise show login. A non-200 create shows "Ask a manager" and a button that starts again. After approve, non-`kds` shows login. In `#94`, the `if (!pairingToken)` block checks `deviceToken` before `fetch('/pair/requests')`, and that branch contains `/auth/station`. Do not add a test name.
- **Spec change:** no.

### 3. §9 `details` are missing on several hub errors

- **Where:** bare `DomainError` throws in `apps/hub/src/auth/pairing.ts`, `staff-session.ts`, `admin-session.ts`, `station-session.ts`, `pin.ts`, `commands/generate-device-pairing-token.ts`, and `commands/approve-pairing-request.ts`.
- **What's wrong:** §9 defines `DEVICE_TYPE_NOT_ALLOWED { device_type, allowed }`, `DEVICE_NOT_OWNED { device_id }`, `STAFF_NOT_FOUND { staff_id }`, and `STATION_NOT_FOUND { station_id }`. The query route already sends `device_type` and `allowed`. These throws send `{}`. The tests that hit them assert `error.code` only, so deleting a future details object would stay green.
- **Why it matters:** §8 clients read `allowed`, `staff_id`, and `station_id` from `details`.
- **Fix:** Pass those objects. Assert them in the existing `#29`, `#36`, `#39`, `#80`, `#81`, `#91`, `#96`, and `#114` tests. Leave `TestFails` alone. Do not add a test name.
- **Spec change:** no.

### 4. #22 never puts active staff on a second branch

- **Where:** `apps/cloud/test/hub-registration.int.test.ts` `#22`, and `loadDirectory` in `apps/cloud/src/modules/hub-registration/repository.ts`.
- **What's wrong:** §10 #22 says the directory has this branch's staff only. The fixture's cashier is active and has no `staff_branches` row. Gone is on this branch and inactive. Deleting `AND sb.branch_id = $2` from the staff query and from the roles CTE still returns only the owner. The SQL does filter. The test does not lock it.
- **Why it matters:** §6.27 puts the owner on every new branch. A later edit can ship another branch's `pin_hash` values in this hub's directory.
- **Fix:** In `#22`, add a second branch, an active staff member assigned only to it, and a role assigned only to that staff member. Assert that staff id and role name are absent from the first branch's directory. No production change while the SQL stays as written. Do not add a test name.
- **Spec change:** no.

### 5. Cloud logs do not redact the Authorization header

- **Where:** `apps/cloud/src/server.ts` logger config.
- **What's wrong:** Plan Global Constraints require header `authorization` never logged. Cloud redacts body-shaped secret field names only. Hub redacts headers via a request serializer. Fastify's default request serializer omits headers today, so this is latent until logging changes, but confirm and logout send Bearer branch keys and JWTs.
- **Why it matters:** A later serializer change, or an explicit `request.log.info({ headers })`, would leak live credentials.
- **Fix:** Mirror the hub: redact `authorization` (and keep the body paths). Add a cloud log-capture assertion on a route that sends `Authorization`. Do not add a §10 number; use `[00 §7.2]` or similar.
- **Spec change:** no.

### 6. Hub directory CHECKs are not locked by tests

- **Where:** `apps/hub/src/db/migrations/0003_staff_directory.sql` (`session_idle_ttl_ms > 0`, grant/approver CHECK); `0002_devices_sessions.sql` phone pairing token ↔ `owner_staff_id`. `apps/hub/test/db/access-schema.int.test.ts` covers device/session/kds-token CHECKs only.
- **What's wrong:** Cloud already locks the grant/approver CHECK. A migration edit that drops these hub CHECKs would stay green.
- **Why it matters:** Later modules write directory rows; a missing CHECK lets invalid grants or a zero TTL into the cache.
- **Fix:** Extend `access-schema.int.test.ts` under the existing `[00 §5.1]` naming style: `session_idle_ttl_ms = 0` fails; `allowed` with an approver fails; `requires_approval` without an approver fails; phone pairing token without `owner_staff_id` fails. No production change while the SQL stays as written. Do not add a §10 number.
- **Spec change:** no.

### 7. `POST /devices/pair` accepts screen device types

- **Where:** `apps/hub/src/auth/pairing.ts` body schema `device_type: z.enum(['tablet', 'phone', 'cashier_kiosk', 'kds'])`.
- **What's wrong:** §6.8 is tablet/phone only; kiosk and KDS pair via pairing request (M44). Sending `kds` or `cashier_kiosk` on this route becomes a type-mismatch `DEVICE_TYPE_NOT_ALLOWED` against a tablet/phone token, or would succeed if a token of that type existed.
- **Why it matters:** Pairing-token generation already refuses kiosk/KDS (`#28`). The pair body should match.
- **Fix:** Narrow the Zod enum to `['tablet', 'phone']`. Existing `#29` stays; a `VALIDATION_FAILED` path does not need a new §10 number.
- **Spec change:** no.
