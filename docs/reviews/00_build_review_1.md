# Build review 1 — module 00 tasks 2–48

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `66ae9b4` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) |
| Plan | `docs/plans/00-plan.md` tasks 2–48 |
| Done per `docs/reviews/build-log.md` | tasks 2–48. Task 1 is commit `4abf807`. Tasks 49–51 are not started. |
| Date | 2026-10-24 |
| Verdict | Fix the list below before task 49. |

The copy of this file at `47c0b06` listed four items for tasks 2–43. Those landed in `7a15675` .. `ee0714f` and are not reopened. This pass re-read the tree at `66ae9b4`, including tasks 44–48.

## What matches

- Every `[00 §10 #n]` name owned by tasks 2–48 is present once. No number is used twice. Later-task numbers (77, 79, 125) are absent. The spec's §10 table has 131 numbers and no gaps.
- WebSocket auth matches §6.21: nothing is sent before a valid staff or station auth frame; timeout, a non-auth frame, a bad device, a bad or ended or other-device or admin session close `4401`; a revoked device closes `4403`; query-string tokens do not authenticate; host and guest close `4403` with zero frames. Catch-up reads `lastSeq()`, builds state, registers the socket, and sends, with no `await` between those steps. `hub.clock_alarm` is `{ wall_ms, last_recorded_at } | null` from the latest `ClockAlarm` row.
- Publish matches §6.21 and §4.2: `event.seq > asOfSeq`, `ClockAlarm` to every socket, `SessionEnded` then close `4401` with the reason, `DeviceRevoked` then close `4403`, shutdown `1012`. Pongs and acks do not touch activity. Ping is 15 s; no pong for 30 s terminates (`1006`, because `terminate()` sends no close frame).
- CORS matches §7.5: groups `device`, `device-session`, `pair`, and `pair-request` get the origin and `Vary: Origin`; `OPTIONS` is `200 { data: {} }` with the listed headers and `GET, POST`; another origin, `/admin/*`, and `/setup` get none. `@fastify/cors` is not a dependency.
- Owner login follows §6.22 and M73: the 10th failure is `401 LOGIN_INVALID` and sets `login_locked_until`; a locked account verifies only the dummy hash, leaves the account counter unchanged, and counts the IP failure; 30 recorded IP failures make the next request `429 IP_LOCKED_OUT`. Refresh is `base64url(HMAC-SHA256(REFRESH_TOKEN_SECRET, token))`, the 30 s window writes nothing, a later reuse revokes every live token of that user, and logout revokes only the caller's token.
- No hub or cloud log line writes a PIN, bootstrap token, registration code, branch API key, pairing token, poll secret, password, or `pin_hash`. Request and response bodies are not logged. The pair URL's `t` query value is still redacted.

## Declined

- Hand-rolled HS256, `branch_name: ''` as a code change, the approve-page group, and `pairing_source` after retention. Those stay under Needs spec change.
- `#90`'s hub half lives in `[00 §3.1 M41]`. `#80`'s `owner_staff_id` and `/auth/pin`'s `staff_id` stay non-empty strings because the fixture staff ids are not ULIDs.
- Files outside a task list that only removed a stub route (`guards.int.test.ts`, `guards-auth.int.test.ts`, `route-inventory.int.test.ts`, `test-hub.ts`, `boot.ts` where the plan already names it) so the real route could be registered. Not reopened.
- `#42`'s socket close is now the §4.2 case in `ws-publish.int.test.ts`. Not reopened.
- A device's `active_session` is the staff or station row. An admin session on that tablet stays in `GET /admin/queries/sessions`.
- §7.2's field list (`branch_id`, `device_id`, `session_id`, `staff_id`, `route`, `status`, `ms`) is not on every line. Task 46's test only requires the secrets to be absent, and tasks 49–51 do not read those fields.
- An idle session on `/ws` closes `4401` and is not ended there. M46's end-on-use path is the HTTP guard and the sweeper.
- The cloud request serializer omits headers and bodies, so a login password and a logout JWT are not on the request line. The redact list is there if a later log call passes those field names.
- Setup mode does not mount `/ws`. An unprovisioned full server still answers the provisioned guard with HTTP `409`.

## Needs spec change

- **§10 #53 still says the 10th failure is 429.** `apps/cloud/test/owner-auth/login.int.test.ts` names that sentence, and each of the 10 calls expects `401 LOGIN_INVALID` with `failed_login_count: 10` and `login_locked_until` set. M73 and §6.22 step (5) say login never returns `LOGIN_LOCKED_OUT`. Changing the handler to 429 would tell a guesser the password was wrong in a different way from a locked account. Leave the 401. Do not add a second #53. The spec owner rewrites that sentence; the test title follows after that.
- **`branch_name` is discarded at setup.** §6.8, §6.31, and M37 require it. §3.10 has no config field, and `HubProvisioned` is `{ tenant_id, branch_id, hub_version }`. The hub returns `''`, including `catch_up.state.hub.branch_name`. Not changed here.
- **A QR scan cannot open `/admin/approve`.** §8.2 says scanning `approve_url` opens `/admin/approve?r=…`. `GET /admin/approve` is group `admin`, so the navigation has no `Authorization` and no `X-Admin-Session`. M43 keeps the admin token in `sessionStorage`. Not changed here.
- **`pairing_source` does not survive retention.** §6.17 requires `token` or `request`. The devices query treats a `pairing_tokens` row as `token`. §5.1 deletes pairing tokens whose `expires_at` is older than 7 days, and a pairing token expires 10 minutes after it is issued. A week later every token-paired tablet and phone is reported as `request`. §5.1 has no column for the source. Not changed here.

## Fix list

### 1. A WebSocket URL keeps `device_token` and `session_token`

- **Where:** `apps/hub/src/server.ts` `redactQueryToken`. `[00 §10 #50]` connects to `/ws?device_token=…&session_token=…` and never reads `hub.logs()`.
- **What's wrong:** The request serializer logs `url`. The redactor only rewrites `t=`. §6.21 ignores those query tokens, and §7.2 forbids tokens in the logs. A client that puts them on the upgrade URL writes both into journald. Deleting the redactor's `t=` rule fails #73; deleting nothing about `device_token` leaves #50 green.
- **Why it matters:** The device token is the device credential. The session token is the staff session. Both would be in the support bundle.
- **Fix:** Redact `device_token` and `session_token` the same way as `t`. In `[00 §10 #50]`, after the query-string connection, the captured log contains neither token. Do not add a test name.
- **Spec change:** no.

### 2. #73 does not search for the registration code that was sent

- **Where:** `apps/hub/test/log-redaction.int.test.ts` (`REGISTRATION_CODE` is `ZZ73-SECR-ETKM`; the assertion searches `normalise(...)`, which is `ZZ73SECRETKM`).
- **What's wrong:** §10 #73 and §7.2 say no secret used by the auth flow appears in the captured logs. The provision body sends the dashed code. That string does not contain the normalised form, so a log of the body would still pass.
- **Why it matters:** Bodies are not logged today. The test would miss the one secret that only travels in that body.
- **Fix:** In that same #73 test, also assert the logs do not contain `ZZ73-SECR-ETKM`. Keep the normalised form. Do not add a test name. Change production code only if that assertion fails.
- **Spec change:** no.

### 3. WebSocket tests leave process-global registrations behind

- **Where:** `apps/hub/test/ws/ws-publish.int.test.ts` `[00 §10 #112]` calls `registerEventAudience('HubStarted', () => true)`. `apps/hub/test/ws/ws-auth.int.test.ts` `[00 §10 #51]` calls `registerCatchUp` for part `probe`. Neither removes the registration. `apps/hub/src/ws/audience.ts` and `apps/hub/src/ws/catch-up.ts` only append.
- **What's wrong:** Audiences and catch-up parts are process-global. After #112, `HubStarted` is delivered to every open socket for the rest of the worker. §4.2 gives `HubStarted` no audience, which is why #51's later frames are `ClockAlarm` only. After #51, any socket whose `staffId` is `S_PROBE` gains a `probe` part. Vitest reuses workers across files.
- **Why it matters:** A later hub test that opens a socket across a boot will see a `HubStarted` push the spec does not send. Task 49 does not open a socket; the next module's socket test will.
- **Fix:** `registerEventAudience` and `registerCatchUp` return a function that removes that one registration. #112 and #51 call it when the test ends, including on failure. Built-in audiences stay. Do not add a test name.
- **Spec change:** no.

### 4. Nothing locks the `DeviceTokenRotated` close

- **Where:** `apps/hub/src/ws/server.ts` `closeFor`, and `apps/hub/src/ws/audience.ts`. The §4.2 test in `apps/hub/test/ws/ws-publish.int.test.ts` covers `DeviceRevoked` only.
- **What's wrong:** §6.21 and §4.2 say the device's sockets receive `DeviceTokenRotated` and then close `4401`. Removing that branch leaves every current test green. #30 checks the HTTP rotation and does not open a socket.
- **Why it matters:** A tablet that rotated on another screen keeps a live socket on the old token.
- **Fix:** In the existing `[00 §4.2]` test, append `DeviceTokenRotated` for an authenticated device. That socket receives the event and closes `4401`. Another device's socket stays open. Do not add a test name.
- **Spec change:** no.

### 5. Nothing locks an old WebSocket client to `4426`

- **Where:** `apps/hub/src/auth/guards.ts` `version`, the `ws` branch that sets `request.wsClose = 4426`. `[00 §3.1 M45]` only connects with a bad Host.
- **What's wrong:** §6.21 step 1 closes `4426` when `X-Client-Version` is below `min_client_version`, and an absent version passes. Removing the websocket branch leaves the HTTP 426 tests green and the socket tests green.
- **Why it matters:** An old KDS would stay connected on a protocol the hub no longer speaks.
- **Fix:** In the existing `[00 §3.1 M45]` test, an upgrade with `X-Client-Version` below the hub minimum closes `4426` with zero frames, and an absent version still reaches auth. Do not add a test name.
- **Spec change:** no.
