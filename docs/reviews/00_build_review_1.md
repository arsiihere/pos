# Build review 1 — module 00 tasks 2–38b

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `ab26386` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) |
| Plan | `docs/plans/00-plan.md` tasks 2–38b |
| Done per `docs/reviews/build-log.md` | tasks 2–38b. Task 1 is commit `4abf807`. |
| Date | 2026-10-24 |
| Verdict | Fix the list below before task 39. |

The previous copy of this file (through `51d732d`) listed seven items. Those landed in `e2f57b1` .. `08268bf` and are not reopened. This pass re-read the tree at `ab26386`, including tasks 35c–38b.

## What matches

- Every `[00 §10 #n]` name owned by tasks 2–38b is present once. No number is used twice. Later-task numbers (31–39, 42–55, 60, 69, 73, 77, 79, 81, 82, 104, 109, 112, 119–121, 123, 125, 126) are absent. `#100` is the multiline name in `boot-budget.int.test.ts`.
- `#127` opens an admin session from the CLI link while a hub holds the same file, expires the previous token, and writes `issued_by: 'cli'`.
- `#28`, `#29`, `#30`, `#84`, `#95`, `#96`, `#118`, `#130`, and `#131` cover the command, pair, poll, and approval outcomes they name, except the gaps in the fix list.
- `DevicePairingTokenGenerated.stream_id` is the pairing token id. `DevicePaired` sets exactly one of `pairing_token_id` and `pairing_request_id`. `DeviceTokenRotated` bumps `authGeneration`.
- No hub or cloud log line writes a PIN, bootstrap token, registration code, branch API key, or `pin_hash`. Header and body redaction still censors the §7.2 names. The pair URL is the exception in fix 5.

## Declined

- Hand-rolled HS256, files outside a task list, and the other items the previous copy of this file declined. Not reopened.
- `#90`'s hub half lives in `[00 §3.1 M41]`, the name task 33b requires, so the §10 number stays single.
- `#80`'s `owner_staff_id` is any non-empty string. The fixture staff ids are not ULIDs; a ULID check would fail the spec test.
- The hub-served `?t=` page always sends `device_type: 'phone'`. §8.1 pairs tablets from the Capacitor app; §8.2's page rules are the phone rules.
- `GET /admin/approve` stays group `admin`, as task 38b requires. See Needs spec change.

## Needs spec change

- **`branch_name` is discarded at setup.** §6.8 and §6.31 require it on the pair and poll responses, and M37 requires it in the hub catch-up part. §3.10 does not list a config field for it, and `HubProvisioned` is `{ tenant_id, branch_id, hub_version }` (M71). The hub returns `''`. Task 44's files do not include the config schema. Storing the register response's `branch_name` means adding a field §3.10 does not name. Not changed here.
- **A QR scan cannot open `/admin/approve`.** §8.2 says scanning `approve_url` opens `/admin/approve?r=…`. Task 38b puts that GET in group `admin`, so the browser navigation has no `Authorization` and no `X-Admin-Session` and the guard returns 401 before the HTML. M43 keeps the admin token in `sessionStorage`, which a navigation does not send. Serving the HTML without the device guard means changing the plan's group. Not changed here. Fix 2 still makes a submit that got past the guard post a real command.

## Fix list

### 1. The pair page cannot pair a phone or finish a screen

- **Where:** `apps/hub/src/auth/pair-page.ts`.
- **What's wrong:** §6.8 `pair_request_id` is a 26-character ULID. The page turns 16 random bytes into 16 Crockford characters, so `POST /devices/pair` is `400`. `indexedDB.open('pos-device')` never creates the `device` store, so the already-paired read and the token write throw. A lost response generates a new id on reload, which §8.2 rule 3 and M14 reject once the first call consumed the token. Logout sends only `X-Admin-Session`. §6.12 requires the device token for a device-bound admin session, so the M43 logout does not end the manager's session. After approval, KDS calls `POST /auth/station` with no `Authorization`. Task 40 cannot edit this file. A poll `404` is treated as "still pending" and never shows "Ask a manager to pair this screen" or a new request (§8.2, §8.4).
- **Why it matters:** Phone pairing, screen pairing, and the KDS station call stay broken after task 40.
- **Fix:** One 128-bit Crockford id (26 characters), reused from IndexedDB until the pair returns 200 or 401. Create the object store on `upgradeneeded`. Logout awaits `POST /admin/auth/logout` with the device bearer when a device token is stored, and still clears the admin token before any pair call. The station call sends `Authorization: Bearer <device_token>`. A poll 404 shows the ask-a-manager text and starts a new request. Extend `[00 §10 #94]` so the served HTML contains those steps. Do not add a second `[00 §10 #94]`.
- **Spec change:** no.

### 2. Approve submits a body that is not a command

- **Where:** `apps/hub/src/commands/approve-pairing-request.ts` `PAGE`.
- **What's wrong:** The fetch posts `{ command_type, payload }` and no auth headers. `PosCommandSchema` requires `command_id`, `tenant_id`, `branch_id`, `occurred_at`, `actor_id`, and `device_id`. The route returns 400, or 401 before that. Task 42 does not edit this file.
- **Why it matters:** A manager who reached the page cannot approve the screen.
- **Fix:** The authenticated GET embeds `tenant_id`, `branch_id`, `device_id`, `staff_id`, and the two tokens from that request. The script posts a full command to `/admin/commands/approve-pairing-request` with `Authorization` and `X-Admin-Session`. `command_id` is a new 26-character id. Extend `[00 §10 #96]` so the HTML for that admin contains those fields and headers. Do not add a test name.
- **Spec change:** no.

### 3. An unknown station hides a wrong display code

- **Where:** `apps/hub/src/commands/approve-pairing-request.ts` `handle`.
- **What's wrong:** §6.32 checks the request (missing, expired, approved, or display-code mismatch) before the station validator. The handler calls `stationExists` first. A wrong code and an unknown station return `404 STATION_NOT_FOUND`, and the request stays pending.
- **Why it matters:** The manager is told the station is missing when the code did not match.
- **Fix:** Load the request and compare `display_code` first. Call `stationExists` only after that succeeds. Extend `[00 §10 #96]`: wrong code plus an unknown station is `404 PAIRING_REQUEST_NOT_FOUND` and `approved_at` stays null. The existing unknown-station case on a valid code stays `STATION_NOT_FOUND`.
- **Spec change:** no.

### 4. `#80` never pairs the phone

- **Where:** `apps/hub/test/commands/generate-pairing-token.int.test.ts`.
- **What's wrong:** §10 #80 says pair → the device has `owner_staff_id`. The test stops at the `pairing_tokens` row. §6.7 also says `owner_staff_id` is required iff `phone`; `#28` never sends one on a tablet.
- **Why it matters:** A later edit can drop the owner on the device row, or accept an owner on a tablet, without failing a §10 test.
- **Fix:** In `[00 §10 #80]`, `POST /devices/pair` with that token and expect the device row's `owner_staff_id`. In `[00 §10 #28]`, a tablet payload that includes `owner_staff_id` is `400 VALIDATION_FAILED` and writes no token. Do not add a test name.
- **Spec change:** no.

### 5. The pairing token is written to the request log

- **Where:** `apps/hub/src/server.ts` request serializer `url: req.url`.
- **What's wrong:** `GET /pair?t=<pairing_token>` is the §6.7 URL. The serializer logs that URL. §7.2 redacts the header and body names and says request bodies are never logged. The token is in the query string, so the redaction paths do not see it. Task 46's `#73` greps captured logs for every pairing token the auth suites used.
- **Why it matters:** journald keeps the token that pairs a phone.
- **Fix:** Replace the `t` query value with `[Redacted]` in the logged URL. Extend the §7.2 log test: `GET /pair?t=<secret>` does not contain the secret, and the handler still receives it. Do not add a `[00 §10 #…]` name.
- **Spec change:** no.
