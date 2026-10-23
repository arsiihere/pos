# Build review 1 — module 00 tasks 2–35b

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `51d732d` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) |
| Plan | `docs/plans/00-plan.md` tasks 2–35b |
| Done per `docs/reviews/build-log.md` | tasks 2–35b. Task 1 is commit `4abf807`. |
| Date | 2026-10-24 |
| Verdict | Fix the list below before task 35c. |

The previous copy of this file (through `86a6459`) listed nine items. Those landed in `8365113` .. `51d732d` and are not reopened. This pass re-read the tree at `51d732d`.

## What matches

- Every `[00 §10 #n]` name owned by tasks 2–35b is present once (80 tests, 80 numbers, no duplicates). Later-task numbers are absent. `#100` is the multiline name in `boot-budget.int.test.ts`.
- PIN order, IP stream id `ip:<addr>`, staff-counter reset after a rejected match, bootstrap `sessionStorage`, one live bootstrap token after a crashed setup retry, phone roster scope, unprovisioned unknown routes (host 403, otherwise 409), and confirm retry on 401 match the sections those fixes cite.
- No hub or cloud log line writes a PIN, bootstrap token, registration code, branch API key, or `pin_hash`. `hub_registered` is `tenant_id`, `branch_id`, `kind`, `rotated`. Confirm's line is `hub confirm failed`.

## Declined

- Hand-rolled HS256 on `app.jwt`. Task 29's file list excluded `package.json`. Claims stay `sub`, `tenant_id`, `allowed_branch_ids`, 1 h.
- `HUB_MIN_VERSION` is loaded and never compared. §6.5 and §6.28 do not say to reject an old hub.
- `server.ts`, guard tests, `test-hub.ts`, `boot.int.test.ts`, and dependency additions outside some task file lists. The build log recorded those rulings.
- `createSession` draws tokens from `cryptoSecrets`. The writer has no `SecretGen`.
- `#93` calls `checkPin` on the PIN semaphore. `POST /auth/pin` is task 39.
- `#114` covers `/admin/auth` only. Task 39 adds `[00 §6.9]` for `/auth/pin`, so the §10 number stays single.
- Bootstrap `SessionStarted` payload `device_id` is null. The envelope column is `hub-admin` (M7). `#92` asserts the column.
- Setup mode does not mount command, query, or admin routes. §3.2's 409 is the not-found handler.
- A provisioned unknown path is 404. `#97` names real routes, and the host hook runs on those routes.
- `admin_bootstrap_tokens.session_id` stays null. §6.29 does not say to store it.
- Repeated `/admin/auth` does not end the previous admin session. §6.6 does not say to.
- Files outside a task's list that the build log already accepted are not re-listed.

## Needs spec change

- **A replay after confirm revokes the key the hub just stored.** §6.5 step 3 rotates on every valid exchange, including the same Idempotency-Key while `now − consumed_at < 3 600 000`. §6.28 expires unconsumed codes only, so the consumed code stays usable. Confirm can succeed, the hub can store `branch_api_key` and stop, and a replay inside the hour then revokes that key. Closing it means changing M14 or §6.28 (once `hub_confirmed_at` is set, the same-attempt exchange is `401` and does not rotate). Not changed here.

## Fix list

### 1. Register locks the code before the branch, so confirm can deadlock

- **Where:** `apps/cloud/src/modules/hub-registration/service.ts` `registerHub`. `lockRegistrationCode` (`FOR UPDATE` on the code) runs, then `SELECT … FROM branches … FOR UPDATE`. `confirmBranch` holds the branch row and then `UPDATE registration_codes` for unconsumed codes.
- **What's wrong:** Those lock orders are opposite. A register of an unconsumed code (a reissued code, while the hub still holds the previous key) waits on the branch that confirm already holds, and confirm waits on the code row. PostgreSQL aborts one transaction. The error handler turns that into `500`. §6.28 does not list 500. A setup retry treats cloud 500 as a failed exchange.
- **Why it matters:** The overlap is the confirm retry window (§6.28, every 60 s) against a reissued code. No later task edits `service.ts`.
- **Fix:** Read the code row without a lock to learn `branch_id`, take the branch row lock, then `lockRegistrationCode`, then re-check usability. Confirm already locks the branch first; leave it. Extend `[00 §6.5] a same-attempt retry and a reissued code both return 200 and leave one live key`: while register is waiting on the branch lock, the connection that holds the branch runs confirm's `UPDATE registration_codes … AND consumed_at IS NULL`. That update finishes, and the register still returns 200 with one live key.
- **Spec change:** no. §6.5 still takes `FOR UPDATE` on the code before the validity check. The branch lock is the one the earlier fix added so two registers cannot both insert a key.

### 2. Reissue can insert a code after the branch is confirmed

- **Where:** `apps/cloud/src/cli/issue-registration-code.ts`. The reissue path `SELECT`s `hub_confirmed_at` with no row lock, then inserts.
- **What's wrong:** §6.27: reissue is allowed only while `hub_confirmed_at IS NULL`, otherwise the command fails. A confirm can commit between the read and the insert. The insert waits only on the branch foreign key, so it still adds a live code on an active branch. §6.5 will exchange that code and rotate the hub's key. This is a new code created after confirm, separate from the replay-after-confirm case above.
- **Why it matters:** Task 47 does not edit this file. A code issued after confirm is a second way for the stored hub key to be revoked.
- **Fix:** `SELECT … FROM branches … FOR UPDATE`, re-check `hub_confirmed_at`, then expire and insert. Do this only after fix 1, so reissue, confirm, and register all lock the branch before code rows. Extend `[00 §10 #57]`: hold the branch row, let reissue block, set `status = 'active'` and `hub_confirmed_at`, commit, and expect reissue to throw with the code count unchanged.
- **Spec change:** no.

### 3. A CIDR BlockList rejects is stored, and the next boot crashes

- **Where:** `apps/hub/src/setup/provision.ts` `validCidr`. `createNetMatcher` (`apps/hub/src/lib/net.ts`) calls `BlockList.addSubnet` on every boot.
- **What's wrong:** §6.4 step 2 validates `guest_network_cidrs` as CIDRs. `validCidr` accepts any four octets `Number` parses as 0–255. `192.168.020.0/24` passes (`Number('020')` is 20). `BlockList.addSubnet` throws `ERR_INVALID_ADDRESS`. Setup has already committed the directory, `HubProvisioned`, the bootstrap token, and the config, then `exit(0)`. The next boot dies in `buildHubServer` before listen. `/setup` is gone because the hub is provisioned. Confirm never runs.
- **Why it matters:** No later task lists `provision.ts`.
- **Fix:** A CIDR is valid only when `new BlockList().addSubnet` on the original address text does not throw. Return `400 VALIDATION_FAILED` before the cloud call. Extend `[00 §10 #105]` with `192.168.020.0/24`: 400, no `registerHub` call, config still unprovisioned.
- **Spec change:** no.

### 4. The documented cloud base URL is requested as `/v1/v1/…`

- **Where:** `apps/hub/src/setup/cloud-client.ts`. `httpCloudClient` appends `/v1/hubs/register` and `/v1/hubs/confirm`.
- **What's wrong:** §3.10's config example is `cloud_base_url: "https://api.example-pos.app/v1"`. §6.4 step 4 is `POST /hubs/register` on that base. The cloud mounts `/v1/hubs/register` and `/v1/hubs/confirm`. The client asks for `/v1/v1/hubs/…`. A non-JSON 404 becomes `500 INTERNAL_ERROR`. Confirm retries that failure forever.
- **Why it matters:** Tasks 33 and 33b stub `CloudClient` and do not list `cloud-client.ts`.
- **Fix:** Strip one trailing slash and a trailing `/v1`, then request `{origin}/v1/hubs/register` and `{origin}/v1/hubs/confirm`. Both `https://api.example-pos.app/v1` and `https://api.example-pos.app` hit the cloud routes. Add `[00 §6.4] a cloud_base_url that already ends in /v1 calls /v1/hubs/register and /v1/hubs/confirm once`. Do not add a `[00 §10 #…]` name. The test must not record the branch API key in a log assertion that prints it.
- **Spec change:** no.

### 5. The command registry is closed inside the route

- **Where:** `apps/hub/src/commands/route.ts` `registerCommandRoutes`. It builds a registry, registers the test commands, and returns nothing. `buildHubServer` cannot keep it.
- **What's wrong:** §6.1 and §6.7 send `GenerateDevicePairingToken`, `RevokeDevice`, `ForceLogoutSession`, `ClearPinLockout`, and `ApprovePairingRequest` through `POST /admin/commands/:name` and the §3.7 pipeline (idempotency, in-transaction auth re-check, `processed_commands`). Tasks 36, 38b, and 42 may create those modules and edit `server.ts`. They may not edit `route.ts`. A second route would skip §3.7, and `#42`–`#44` require retransmit of the same `command_id`.
- **Why it matters:** Those tasks cannot `register` on the registry the route closes over.
- **Fix:** Keep the registry `registerCommandRoutes` uses and export `commandRegistry(app)` for it. `server.ts` stays a one-line call. A later task registers with `commandRegistry(app).register(...)`. Test `[00 §6.1] a command registered on the live registry is served`. Do not add a `[00 §10 #…]` name.
- **Spec change:** no.

### 6. A query handler cannot see the directory, the device, or the session

- **Where:** `apps/hub/src/queries/registry.ts`. `QueryCtx` is `{ db, page }`. `registerQueryRoutes` keeps the registry private. `runQuery` does not pass `currentDirectory(app)`, `request.device`, or `request.session`.
- **What's wrong:** §6.17–§6.20: device names and the staff roster come from `StaffDirectory`, the phone roster is the owner (`request.device.owner_staff_id`), and `GET /queries/session` is the caller's session. Query counts are 1, 1, 2, and 0, so a handler must not call `StaffDirectory.load`. Task 43's files are the four query modules and `server.ts`. `queries/registry.ts` is not on that list.
- **Why it matters:** Task 43 cannot register a query or read the directory without editing a file the plan does not list.
- **Fix:** `QueryCtx` gains `directory`, `device`, and `session`. `runQuery` sets them from `currentDirectory(app)` and the request before `handle`. Export `queryRegistry(app)` the same way as fix 5. Extend `[00 §10 #13]` so the quiet query's body includes that device id, that session id, and that the directory knows the staff member. Do not add a second `[00 §10 #13]`.
- **Spec change:** no.

### 7. Device last-seen can only be read by clearing it

- **Where:** `apps/hub/src/auth/session-store.ts` `activity.deviceSeen` / `drainDevices`.
- **What's wrong:** §6.17: last-seen is the in-memory value merged over the column. The guard writes `deviceSeen`. The only read is `drainDevices()`, which clears the map. Task 41's sweeper is the flush (`drainDevices` into `last_seen_at`). Task 43's devices query must merge the same map and must not steal the sweeper's timestamps. Task 43's files do not include `session-store.ts`. `activity.get` already peeks session touches; devices have no peek.
- **Why it matters:** A query that drains races the sweeper and drops timestamps. A query that cannot peek edits `session-store.ts`.
- **Fix:** `deviceSeenAt(id): number | undefined` reads and does not clear. Extend `[00 §10 #98]` so `deviceSeenAt` returns the timestamp the guard recorded, and the following `drainDevices()` still returns that same pair. Do not add a test name.
- **Spec change:** no.
