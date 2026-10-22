# Review 1 — 00 Hub Platform & Access Spec v0.5

| Field | Value |
|---|---|
| Spec under review | `docs/specs/00_Hub_Platform_Access_Spec_v0.5.md` (Draft, complete) |
| Checked against | `docs/specs/00_Foundation_Spec_v1.7.md` (APPROVED — FINAL), `docs/specs/README.md` (module map, approval checklist, R1–R15) |
| Review type | Hostile review, pipeline step 4 (fresh session) |
| Date | 2026-10-23 |
| **Verdict** | **REJECT.** 9 blockers, 15 major, 14 minor findings. The approval checklist has 6 unticked lines (end of file). |

Severity:
- **Blocker:** a security hole, data-loss path or race that would ship broken. Must be fixed before approval.
- **Major:** a wrong or missing rule that the build would get wrong or have to guess. Must be fixed or answered by a recorded decision before approval.
- **Minor:** an inconsistency, gap or over-build. Fix in the next version.

Each finding gives **Where**, **Problem**, **Failure** (a concrete scenario) and **Required** (what the next version must say). The fixes are suggestions; the spec author picks the mechanism.

---

## Blockers

### 1. Session and device validity is checked outside the write transaction (race)

- **Where:** §3.7 (session check before `writer.run`), §3.9 (device token and session guards in `onRequest`), §6.14, §6.15, §6.9 takeover, §3.4 sweeper.
- **Problem:** The device token, the session and the permission are all checked before `BEGIN IMMEDIATE`. Fastify hooks are async, so the sweeper timer, `RevokeDevice`, `ForceLogoutSession`, a takeover or `applyStaffDirectory` can commit between the guard and the command's transaction. Nothing re-checks inside the transaction. D32 handles the same window for idempotency with a re-check; the spec does not do the same for the session.
- **Failure:** A manager revokes a stolen tablet. An `OpenTable` command from that tablet passed the guard 1 ms earlier and commits after the revoke. The table is locked by a session that already has its `SessionEnded`. D51 released that session's locks when `SessionEnded` was applied, so the new lock is orphaned until the 10-minute lock TTL. The same happens when the sweeper ends an idle session in that window.
- **Required:** Inside `writer.run`, after the idempotency re-check, re-read the device row and the session row and reject with the same codes (`DEVICE_REVOKED`, `SESSION_EXPIRED`). Without SQL, a session generation number checked in memory inside the transaction also works. Add a race test: revoke and command in flight at the same time → the command is rejected.

### 2. Restore from a backup brings back revoked devices and ended sessions

- **Where:** §3.4 boot reconciliation (step 4b), §5.1 (`devices`, `staff_sessions` are mutable tables, not projections), M17, foundation §5.10 sources (a)/(b).
- **Problem:** `devices.revoked_at` and `staff_sessions.ended_at` are only in mutable tables. After a restore from the USB backup plus the cloud tail (§5.10 b), these tables hold their state as of the backup, while the events hold `DeviceRevoked` / `SessionEnded` written after it. Reconciliation only covers one direction: an event with no end and a table row that is not active. It does not handle a row that is active in the table but ended in the events, and it does not reconcile devices at all. Step 4 cannot rebuild these tables because they are not registered projections.
- **Failure:** At 15:00 a manager revokes the phone of a staff member who was fired (M38 `owner_removed`). The hub dies at 22:00 and is restored from the 04:00 USB backup plus the cloud tail. The fired employee's phone token is valid again, and so is any session token that was force-logged-out that day.
- **Required:** Either make `devices`, `pairing_tokens` (consumed state) and `staff_sessions` projections of their events, rebuilt in step 4, or add a boot step that applies every `DeviceRevoked` / `SessionEnded` newer than the table state. Add a restore test: backup → revoke → restore → token rejected. 00 owns these tables, so 00 must solve this; it cannot be left to 06.

### 3. Provisioning cannot recover after the 1-hour retry window

- **Where:** §3.2 crash note, §6.5 step 1 (`now − consumed_at < 3 600 000`) and step 4 (branch → `active`), M22 (reissue only for `pending_hub`), §6.27.
- **Problem:** The cloud consumes the code and sets the branch to `active` in the same transaction that sends the response. If the hub never commits (lost response, crash, internet down at the restaurant) and the installer retries after more than 1 hour, the code is `REGISTRATION_CODE_INVALID`. M22 cannot issue a new code because the branch is no longer `pending_hub`.
- **Failure:** The installer enters the code, the restaurant's internet drops before the response arrives, and the installer comes back the next morning. The hub is permanently unprovisionable for that branch. The only way out is a second branch row, which is the outcome M22 says it prevents.
- **Required:** Set `active` only on the hub's first authenticated sync (or a separate confirm call), or let M22 reissue for an `active` branch that has never synced. Add a test for a retry after the window.

### 4. `/admin/auth` is open to the whole staff LAN and can starve every tablet login

- **Where:** M7, M23, M32, §3.5, §3.9 (no device token on `/admin/auth` or `/admin/login-roster`), README R14.
- **Problem:** `/admin/auth` needs no device token. `/admin/login-roster` publishes every admin's `staff_id` without authentication. The argon2 semaphore (size 2) is **shared** with `/auth/pin`. The only per-client limit is per IP, and anyone on the LAN can change their IP freely. Since R14, every staff member's personal phone is on the staff WiFi, so "staff LAN = trusted devices" no longer holds.
- **Failure:** (a) A script on any phone on the staff WiFi loops `/admin/auth` with wrong PINs for each admin on the roster, rotating source IPs. Every admin is locked out for 15 minutes, again and again, and the two argon2 slots stay busy, so tablet PIN logins get `503` at shift change. (b) The same loop guesses 5 PINs per admin per 15 minutes, which is 480 per admin per day. A 4-digit PIN falls in about 10 days per admin, sooner with several admins.
- **Required:** Give `/admin/auth` its own semaphore (or a reserved slot for `/auth/pin`). Require a paired device or a manager-generated one-time admin link for `/admin/auth` and `/admin/login-roster`, or record an explicit risk-acceptance decision. State whether `failed_count` resets when a lock expires (§3.5 is silent; see #25).

### 5. The admin session stays in the KDS or kiosk browser after pairing

- **Where:** §8.2 bullets 2–3 ("the manager opens `/admin` on that browser … the admin UI navigates the same tab to `pair_url`"; `admin_session_token` in `sessionStorage`).
- **Problem:** The flow pairs a kitchen screen or the cashier kiosk from a manager's admin session in the same tab. `sessionStorage` survives navigation within a tab, and nothing ends the admin session.
- **Failure:** After pairing, a cook presses Back (or opens `/admin`) on the KDS and has the manager's admin session for up to 60 minutes. With it they can revoke devices, force-logout anyone, clear lockouts and mint pairing tokens for new devices.
- **Required:** The pairing step must call `POST /admin/auth/logout` and clear `sessionStorage` before navigating to `pair_url`. Add an E2E or integration test: after kiosk/KDS pairing the admin token returns `401 ADMIN_SESSION_REQUIRED`.

### 6. No Host-header check: DNS rebinding reaches the hub through any staff browser

- **Where:** §3.9 guards, §7.5 CORS, §6.3 (hub on plain `http://<ip>:3000`).
- **Problem:** The hub accepts any `Host` header. A web page visited from a staff phone or the kiosk can rebind its own domain to the hub's LAN IP and then call the hub same-origin. The request comes from a staff IP, so the guest-network guard passes. CORS does not protect against this. Routes that need no token become reachable from the internet through the browser: `/admin/auth`, `/admin/login-roster`, `/health`, `/devices/pair` and, before provisioning, `/setup/provision`.
- **Failure:** A malicious ad in a staff member's phone browser runs the PIN guessing and semaphore-starvation attack from #4 without the attacker ever joining the WiFi.
- **Required:** Add a guard that rejects requests whose `Host` is not `advertised_host:http_port` or `localhost` (plus a test). Record it in §3.9 and in the route-inventory test.

### 7. An idle-expired session keeps working until the next sweep and can be brought back

- **Where:** §3.4 (sweeper every 15 s ends idle sessions), §3.9 session guard (checks only that the session is not ended), M5, foundation §5.7 ("hub rejects session_token if idle longer than the role's TTL"), E0 PIN AC4.
- **Problem:** The guard does not compare `branchNow − last_activity` with `idle_ttl_ms`. Expiry happens only in the sweeper. Any request in the window between TTL and the next sweep (up to 15 s) is accepted **and refreshes activity**, so the expired session comes back. The M6 partial unique index also still counts that session as active, so the next staff member gets `409 DEVICE_SESSION_ACTIVE` for a session that has already timed out.
- **Failure:** An order-taker tablet idles for 5 min 10 s; the next tap succeeds and the 5-minute idle logout never happens. This breaks foundation §5.7 and E0 AC4.
- **Required:** The guard (and the login transaction) treats `now − last_activity > ttl` as ended. It may end the session itself in the same transaction or leave that to the sweeper. Add a test at TTL + 1 s, before the sweep runs.

### 8. Idempotent replay ignores `command_type`, and the device id is taken from the body

- **Where:** §3.7 fast path and re-check (match on `command_id` and device only), M19, §3.7 actor check (body `actor_id` is checked, body `device_id` is not).
- **Problem:** (a) The stored response is returned for any route that sends the same `command_id`; the command type is never compared. (b) §3.7 checks body `actor_id` against the session but never checks body `device_id` against the device token. M19 says "caller device" without saying which source it means.
- **Failure:** (a) A client bug reuses a `command_id` for `VoidItem` that was used for `SubmitOrder`. The hub answers `200` with the order's stored body and `Idempotent-Replay: true`, the client removes the void from its queue, and the void silently never happens. (b) If the build reads the body's `device_id`, the M19 protection is gone: any device can read another device's stored response.
- **Required:** Store `command_type` (and a payload hash) in `processed_commands`. A mismatch returns `400 VALIDATION_FAILED`, never a replay. State that the device identity always comes from the token, and reject a body `device_id` that does not match. Add tests for both.

### 9. Boot work grows with the whole event history (missing indexes, broken 90 s budget)

- **Where:** §3.8 steps 3a, 4, 4b; §7.8 (00's boot steps ≤ 5 s); README R6 (≈ 40k events/day/branch ≈ 14.6 M/year); foundation §5.8, D24.
- **Problem:**
  - **3a:** `SELECT MAX(recorded_at) FROM events` has no index, so it scans the whole table on every boot. `recorded_at` rises with `seq` (both are assigned in one writer transaction with `branchNow` never going backwards), so the newest `seq` row gives the same answer.
  - **4b:** "every session with a `SessionStarted` event and no `SessionEnded` event" is an anti-join over the entire `staff` and `station` stream history, matched on `payload.session_id` inside JSON. No index serves it, and it runs on every boot, not only after a restore.
  - **4:** M17 is ambiguous: if a checkpoint advances only when its own event types arrive, every quiet projection is behind `MAX(seq)` on every boot. Then it is `reset` and replayed **from seq 0**, which is a full rebuild on each boot.
- **Failure:** After a few months at R6 volume, 00's own steps exceed 5 s and eat into the 90 s that 03a needs for replay. Test 79 runs on an empty database and will not catch it.
- **Required:** For 3a, read `recorded_at` of the max-`seq` row. For 4b, run only when `staff_sessions` is empty while session events exist (the restore case), or bound it with an index or table. For 4, every commit advances every checkpoint (or the comparison uses the max seq of the projection's own event types), and a stale projection replays from its checkpoint, not from 0. Add a boot test on a 1 M-event fixture that asserts 00's steps stay inside the §7.8 budget.

---

## Major

### 10. Refresh-token reuse detection logs the owner out after a lost response or two tabs

- **Where:** M33, §6.23, test 54.
- **Problem:** Any second use of a rotated token revokes **all** of the user's tokens, with no grace period and no idempotency. Foundation §6.4 justifies idempotency with owners "on phones on mobile data". A lost refresh response is exactly that case. Test 54 even specifies "concurrent refresh → one 200, one 401", and under M33 that 401 revokes the winner's new token as well.
- **Failure:** The owner dashboard is open in two tabs, or the phone drops the refresh response. The owner is logged out on every device within the hour, every time it happens.
- **Required:** Allow a short reuse window (for example, the same token within 30 s returns the same successor), or make the refresh idempotent by key. Correct test 54 to state what happens to the winner's token.

### 11. A PIN reset does not end that staff member's sessions

- **Where:** §4.2 `applyStaffDirectory` (ends sessions only for **removed** staff), M18.
- **Failure:** A manager's PIN leaks, the owner resets it in the cloud, and the directory reaches the hub. Whoever used the leaked PIN keeps the manager's session (60-minute TTL) and any admin session.
- **Required:** End the sessions (`reason: 'staff_removed'` or a new `'credentials_changed'`) of every staff member whose `pin_hash` changed. Add a test.

### 12. `applyStaffDirectory` does not check that `directory_version` is newer

- **Where:** §4.2, §5.1 `staff_directory_meta`, §4.1 (06 calls it on every push).
- **Problem:** Nothing rejects an older or equal `directory_version`. Push-queue items can arrive late, be retried or be replayed after a restore.
- **Failure:** An old directory is applied after a newer one. A fired staff member comes back, with their old PIN, and their phone was already revoked, so only the PIN login path is needed.
- **Required:** Apply only when `directory_version > current`. An equal version is a no-op and writes no event. Add tests.

### 13. Behaviour on a weak `pin_hash` is undefined for later directory pushes

- **Where:** M8 ("weaker hashes are rejected when a directory is applied"), §6.4 step 5 (setup → 500).
- **Problem:** For pushes from 06 the spec does not say whether one weak hash rejects the whole directory or only that staff row.
- **Failure:** If the whole directory is rejected, one bad row from 01 blocks every later directory update, including the removal of a fired employee (#12 and M38 stop working).
- **Required:** Choose one: skip and log the row (the staff member cannot log in) and apply the rest, or reject everything. Say which, and test it.

### 14. Two browser tabs on one KDS kick each other off forever

- **Where:** §6.11 (each call replaces the active station session), §8.2 ("call `POST /auth/station` on every load"), §8.4 (`4401` → go to login).
- **Failure:** The kitchen PC opens a second window (a restored session or a double click). Tab A gets `4401` and logs in again, which replaces B's session. B gets `4401` and does the same. The two loop with no end, and the screen flickers during service.
- **Required:** On a station session `4401` with reason `replaced`, the client stops and shows "open in another window" rather than calling `/auth/station` again. Carry the reason in the close (or in the pushed `SessionEnded`), and add it to §8.4.

### 15. The threat model was not revisited after BYOD phones (R14)

- **Where:** M38, §8.2, foundation §5.7 (PIN in plaintext over the staff network, D28), §5.6 (device tokens never expire).
- **Problem:** Foundation D28 accepted plaintext PINs and bearer tokens on the staff WiFi on the assumption that only restaurant devices were on it. R14 puts every staff member's personal phone on that network. On a WPA2-PSK network, anyone who has the passphrase can decrypt other clients' traffic. Device tokens never expire, and admin PINs cross the same network.
- **Failure:** A staff member's phone (or a friend given the WiFi password) captures a cashier kiosk's device token, session token and the manager's admin PIN.
- **Required:** Add a decision that either accepts the risk explicitly (owner sign-off) or adds mitigations, such as a separate SSID or VLAN for phones with client isolation and phones limited to the hub port in the installation checklist. No silent inheritance.

### 16. Overrides the D64 rule requires that are not recorded

- **Where:** README checklist "Every foundation section the spec overrides is named in a decision"; §3.1.
- **Not recorded:**
  - Foundation §6.8 "every index on a tenant table **leads with `tenant_id`**" is broken by `owner_users_email`, `owner_refresh_tokens_hash`, `branch_api_keys_hash`, `branches_branch_id` and the `registration_codes` primary key `code_hash`. M16 overrides only the `branch_id` column rule.
  - `credential-lookup.ts` is a query path outside the repository layer. That is exactly the trigger foundation §8 names for revisiting RLS. It needs a decision and a lint or test that pins it to the two plugins.
  - Foundation §5.6 `POST /admin/devices/pairing-token → { hub_ip, hub_port, pairing_token }` is replaced by `/admin/commands/generate-device-pairing-token` with a different response.
  - Foundation §6.3 route groups have no place for `POST /auth/station`, `POST /admin/auth`, `POST /admin/auth/logout` or `GET /admin/login-roster`.
  - Foundation §6.3 `GET /ws` auth ("device token + session" by header) is overridden by M12; only §5.4 is cited.
  - `DEVICE_LOCKED_OUT` is reused for an **IP** subject (§6.2: a code is never "reused for another meaning"), and `DEVICE_TYPE_NOT_ALLOWED` is reused for "station sessions cannot log out" (§6.10).
- **Required:** One decision row for each, or change the design.

### 17. The CLIs have no permitted path to the database

- **Where:** §6.26, §6.27, foundation §3.4 item 2 (raw client not exported, `no-restricted-imports` lint), M25 (a repository without a `TenantContext` throws).
- **Problem:** `seed-tenant` creates a tenant before any `TenantContext` can exist. Both CLIs live in `modules/`, where the lint rule blocks the raw client. The spec does not say how they reach the database.
- **Failure:** The implementer either weakens the lint rule or builds a fake context. Either way D54 is broken quietly.
- **Required:** Name a mechanism, such as a `SystemContext` used only by `apps/cloud/src/cli/` with a lint allowlist entry and a test, and record it as a decision.

### 18. `is_admin_role` contradicts M7, and a new branch is invisible to the owner

- **Where:** §5.2 `roles.is_admin_role`, §6.26, §6.27, M7 ("roles are custom, so 'manager' must be a permission"), `owner_users.allowed_branch_ids`.
- **Problem:** (a) The CLI decides who reaches `/admin` at a new branch by a role flag, while the hub decides by the `access-hub-admin` permission. Managers (`is_admin_role = false`, but holding `access-hub-admin`) are not assigned, so the first person able to pair devices at a new branch is the Owner only. (b) `issue-registration-code` never adds the new branch to `owner_users.allowed_branch_ids`, so the owner's JWT cannot see it.
- **Required:** Assign the staff whose roles grant `access-hub-admin` and drop `is_admin_role` (YAGNI). Add the branch to the tenant owners' `allowed_branch_ids` in the same transaction, and test both.

### 19. Two sources of truth for `guest_network_cidrs` and `advertised_host`

- **Where:** §3.10 ("`setup_attempt_id`, `provisioned` and `backup_encryption_key` are written only by `/setup/provision`; the installer edits the rest") versus §6.4 input and step 7 (setup writes `guest_network_cidrs` and `advertised_host`).
- **Failure:** The installer sets the guest ranges in the config file. The setup form then sends `[]` (or a typo) and overwrites them, and guest-network protection is silently off. Nothing validates that the list is non-empty.
- **Required:** Pick one owner per field. If setup writes them, require at least one CIDR, and require `advertised_host` to be one of the host's own addresses.

### 20. Untested error codes and rules (foundation §6.7: one test per error code)

- **Where:** §10. The following have no test:
  - `404 STAFF_NOT_FOUND` on `/auth/pin` and `/admin/auth`.
  - `429 PIN_LOCKED_OUT` on `/admin/auth`.
  - `401 ADMIN_SESSION_REQUIRED` anywhere (test 72 checks only that the guard is present).
  - `401 DEVICE_TOKEN_INVALID` and `403 DEVICE_REVOKED` on HTTP routes (only WS `4403` is tested).
  - `401 SESSION_INVALID` for a session that belongs to another device (§6.10, §3.9).
  - `SESSION_EXPIRED` versus `SESSION_INVALID` on queries.
  - `/devices/pair`: `426`, guest network, rotation after 10 minutes → 401, rotation for a revoked device → 401.
  - `/setup/provision` `400 VALIDATION_FAILED`.
  - `GUEST_NETWORK_FORBIDDEN` on `/admin/*` and on WS.
  - M35 CORS (allowed origin, preflight, and no CORS headers on `/admin/*`).
  - §5.1 retention job (D32 seven-day prune).
  - §3.10 atomic config write.
  - M8 hash-parameter floor on directory push (06 path).
  - M33 refresh-token expiry and login-counter reset after a success.
  - Pre-migration backup to `data_dir` when the USB drive is missing.
  - `GET /v1/health` (marked "smoke" only, against foundation §6.7 "validation and happy path").
- **Acceptance table:** "E0 PIN edge: guest WiFi → 36, 49" is wrong, because test 49 has no guest-network case.
- **Required:** Add the tests and fix the acceptance mapping.

### 21. Two race tests describe things that cannot happen

- **Where:** test 51 ("event committed during catch-up build is delivered exactly once"), test 60 ("partial unique index" picks the loser).
- **Problem:** §6.21 step 4 builds the catch-up synchronously, so no commit can happen during the build, and test 51 cannot be set up. In test 60, `BEGIN IMMEDIATE` serialises the two logins, so the loser sees the winner's session in step 1 and gets the normal 409. The unique index never fires. Both tests would pass trivially and prove nothing.
- **The real race is elsewhere:** §3.7 orders `COMMIT → respond → ws.publish`. If `publish` runs after any `await` (`reply.send`, `onSend` hooks), a socket registered in that gap gets the event both in `catch_up` (`as_of_seq ≥ seq`) and as a push.
- **Required:** Publish filters `seq > socket.as_of_seq`, with a test that registers a socket between COMMIT and publish. Rewrite test 60 to assert the outcome without naming a mechanism, or test the index directly with a raw insert.

### 22. Generic queries refresh session activity, so polling defeats the idle logout

- **Where:** M5 ("every authenticated request (queries included) updates it"), §6.2, §6.21 (pongs deliberately excluded), E0 PIN AC4.
- **Failure:** 02 builds the table map with a 10-second `GET /queries/tables` refresh, a common fallback. Order-taker sessions then never idle out. The spec's own care about WS pongs does not help here.
- **Required:** Only commands, plus queries that declare `counts_as_activity: true`, refresh activity. Default to false and tell 02.

### 23. The pairing-token rotation is not audited

- **Where:** §6.8 step 3 ("rotate … `UPDATE devices SET token_hash`; no event").
- **Problem:** A device credential changes with no event. Foundation §4.1 says "every state mutation is an event", and E0 Hardware AC3 requires an audit of pairing.
- **Required:** Append `DeviceTokenRotated { device_id, pair_request_id }`, or justify the exception in a decision.

### 24. Admin access is checked only at login

- **Where:** §6.6 (`access-hub-admin` checked once), §6.17, §6.18 (no permission), §3.9 admin guard.
- **Failure:** The owner removes `access-hub-admin` from a manager's role. The manager's open admin session keeps reading device and session lists, which include staff names and IPs, until it idles out (60 min). Only the commands, which check their own permissions, are blocked.
- **Required:** The admin guard resolves `access-hub-admin` on every request. It is in memory (M18), so it costs zero SQL.

---

## Minor

### 25. The lockout counter after a lock expires is not specified

§3.5 says the staff threshold is "consecutive, until a success or a clear", but not whether `failed_count` resets when `locked_until` passes. If it does not reset, one wrong PIN after expiry locks the account again at once (1 guess per 15 min, harsh for a real user). If it does reset, the attacker gets 5 more guesses. Choose one and test it.

### 26. `/health` is open to the guest network

§6.3 sends `branch_id`, `hub_version`, `max_seq` and `clock_alarm` to customers' phones. `hub_version` helps target known bugs. Foundation §6.3 says "none (LAN only)". Either return a reduced body to guest ranges or apply the guard and let the installer use a staff port.

### 27. Owner login can be locked from the internet and reveals which accounts exist

§6.22 and M33: anyone who knows the owner's email can lock the account indefinitely (10 tries every 15 minutes), and there is no per-IP limit. A locked known account returns `429` while an unknown email returns `401`, so ten tries reveal whether an email is registered. Record the risk, or return `401` until a password is correct and add a per-IP limit. The counter increment must also be an atomic `UPDATE … SET failed_login_count = failed_login_count + 1`; the spec does not say so, and concurrent failures could lose counts.

### 28. Admin events share `device_id = 'hub-admin'`, which weakens the M19 replay match

§3.7 and M19 justify the device match with "a stored response may hold a pairing token". All admin browsers share `'hub-admin'`, so the match does not separate them. The admin guard runs first, which narrows the risk, but the stated reasoning does not hold for admin routes. Match on `session_id` (or `staff_id`) for admin commands.

### 29. `client_ip` is stored and never read

`staff_sessions.client_ip NOT NULL` is not used by any rule: admin sessions are not bound to an IP, and the admin sessions query does not return it. Either bind admin sessions to the IP or drop the column (YAGNI).

### 30. The retention job runs at "local midnight" with no time zone configured

§7.3: the hub has no time-zone setting in §3.10, and Lahore restaurants serve past midnight. A large `DELETE` inside `writer.run` during a rush blocks commands. Run it in the D63 quietest hour, next to the backup, or in batches.

### 31. "Stream" encryption contradicts "verify the tag before writing any output"

§7.9: AES-GCM cannot authenticate a stream before the last block. Test 65 ("writes no output") forces either buffering the whole database in memory or decrypting to a temp file and renaming it. Specify temp file + verify + rename. Also delete a leftover plaintext pre-migration copy at boot, in case the process crashed between copy and encrypt.

### 32. Malformed decision tables

- §1 "Changes in v0.3": the first row has 4 cells in a 3-column table. Two rows were merged (M38/R14 and R11), so the M38 row has lost its decision column.
- §3.1: a stray row `| M38 | §3.3, §3.4, … |` (line 151) duplicates M38, and M38 is listed before M37.

Renumber the decisions and fix both tables, because decisions are cited by ID across specs.

### 33. Library note contradicts the foundation

§7.11 says `fastify-type-provider-zod` 7.0.0 needs "zod ≥ 4.1.5", while foundation §6 says "requires Zod ≥ 4.2". One of them is wrong; re-check and correct it. §11 task 1 names `.eslintrc`; current ESLint uses `eslint.config.js` (flat config). Pin ESLint in §7.11, because the D54 lint rule depends on it.

### 34. §11 adds the §9 error codes twice

Task 2 builds the error catalogue "+ §9" and task 36 appends the §9 codes to `errors.ts` again. Say that task 2 creates them and task 36 only edits the foundation table and the README.

### 35. The cloud `idempotency_keys` table is built for 01 (over-engineering)

§5.2 says it is "used by 01+". No 00 route uses it (`/v1/hubs/register` uses M14 rotation instead). CLAUDE.md says "build only what the spec asks". Move it to 01. If it stays, its primary key `(tenant_id, key)` lets the same key collide across routes; include `route`. 00 also defines no retention for it or for `owner_refresh_tokens`, which gains a row on every refresh.

### 36. Command body `tenant_id` is never checked

§3.7 rejects a wrong `branch_id` with `BRANCH_MISMATCH` but accepts any `tenant_id`. Events take the tenant from config, so the harm is small, but the contract should say the field is checked (same code) or ignored.

### 37. `REGISTRATION_CODE_KIND_UNSUPPORTED` and `setup_attempt_id` give small information leaks

`HubProvisioned` puts `setup_attempt_id` into the event log, which syncs to the cloud and appears in audit views. Together with the code (often on paper), it allows a re-exchange within 1 hour, which revokes the hub's live API key. Leave `setup_attempt_id` out of the event payload.

### 38. Takeover on the cashier kiosk ignores the open cash shift

M20 lets any staff member with a PIN end the cashier's session at the drawer (R11). D21 says a shift belongs to one cashier. 00 does not need to solve shifts, but it should add a requirement for 05 in the README "Requirements carried" table: what happens to an open shift on takeover. Right now nothing hands it on.

---

## README approval checklist (as ticked by this review)

| Line | Status | Blocking finding(s) |
|---|---|---|
| §1–§12 present, in order | ✅ | — (#32 cosmetic) |
| §4 Exposes complete | ✅ | — |
| §5 indexes name the query they serve | ❌ | #9 (boot queries with no index), #16 (global indexes not recorded) |
| §10 per-endpoint, race and acceptance tests | ❌ | #20, #21 |
| §11 build order with citations | ✅ | (#34 minor) |
| §12 DoD, checklist, OQs, deferred | ✅ | — |
| §6.1 envelope | ✅ | — |
| §6.2 errors | ❌ | #16 (reused `DEVICE_LOCKED_OUT`, `DEVICE_TYPE_NOT_ALLOWED`) |
| §6.3 hub HTTP (fixed order, fixed query counts) | ❌ | #1 (no in-transaction re-check), #8 |
| §6.4 cloud HTTP | ✅ | (#10 is an idempotency gap with a recorded "none needed") |
| §6.5 WS | ✅ | (#21 publish filter) |
| §6.6 naming | ✅ | — |
| §6.7 tests | ❌ | #20 |
| §6.8 migrations | ✅ | — |
| §6.9 folders | ✅ | — (M36 recorded) |
| Every override named in a decision | ❌ | #16 |
| Status codes match §6 ↔ §9; permissions exist | ✅ | — |
| No forward reference except through Exposes | ✅ | — |
| Size inside budget | ✅ | 27 endpoints, 36 tasks |
| Hostile self-review done | ❌ | blockers #1–#9 show it was not effective |

## Summary

| Area | Findings |
|---|---|
| Races | 1, 7, 14, 21, 27 |
| Idempotency gaps | 3, 8, 10, 12, 23 |
| Security holes | 2, 4, 5, 6, 11, 13, 15, 24, 26, 28, 37 |
| Missing indexes / unbounded work | 9, 30 |
| N+1 | none found: every list and query declares a fixed statement count |
| Contradictions with foundation / README / itself | 16, 17, 18, 19, 22, 31, 32, 33, 34, 36 |
| Untested ACs / rules | 20, 21 |
| Over-engineering | 18 (`is_admin_role`), 29, 35 |
| Cross-module gap | 38 |

**To approve:** fix #1–#9, fix or record a decision for #10–#24, bump to v0.6, then hold Review 2 in a new session.
