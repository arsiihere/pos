# Build review 1 — module 00 tasks 21–25

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `bb2267f` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) |
| Plan | `docs/plans/00-plan.md` tasks 21–25 |
| Done per `docs/reviews/build-log.md` | tasks 2–25. Task 1 is commit `4abf807`. |
| Date | 2026-10-23 |
| Verdict | Fix the list below before task 25b. |

Tasks 1–20 were reviewed in the earlier copies of this file. Those items were fixed in `13a613e` .. `54bf68a` and are not reopened. This pass re-read tasks 21–25 (`320aa6e`, `5315d03`, `0606a78`, `876e246`, `a446ac7`) against the spec and the plan, and checked that every `[00 §10 #n]` name in the suite is unique.

## What matches

- Each §10 number these tasks claim (`#1`–`#13`, `#58`, `#66`, `#85`, `#86`, `#98`, `#99`, `#106`, `#110`, `#115`–`#117`) appears in exactly one test. No `[00 §10 #n]` name is duplicated anywhere in the suite.
- The command pipeline follows §3.7 on the paths the tests hit: registry, envelope, kebab name, token `device_id`, `tenant_id` / `branch_id` as `403 BRANCH_MISMATCH`, permission resolved inside `writer.run`, a handler `DomainError` rolls back and a retransmit is evaluated again, a reducer throw leaves state and `published` unchanged.
- An already-ended session can replay (`allowEnded`). The in-transaction re-check rejects a revoke committed in the pre-writer hook (`403 DEVICE_REVOKED`) and a directory apply that removes the permission (`403 PERMISSION_DENIED`, session left open). Admin replay matches `session_id`.
- Queries default `countsAsActivity` to false, touch memory only when it is true, and run `handle` on the read-only connection.
- Boot follows §3.8 for the steps this task owns: config, leftover plaintext, migrations, registered steps 2 then 3 then 5 then 6, clock guard through `createBranchClock` (`wall <= last` → `ClockAlarm { source: 'boot' }`, `branchNow = last + 1`), catch-up, then the server. An unprovisioned hub does not run those steps. `main.ts` passes real clocks and exits 1.
- No new code logs a PIN, token, password, `pin_hash`, or backup key.

## Declined

- `server.ts` and `guards.int.test.ts` outside task 21’s file list, and `test-hub.ts` outside task 22’s. Wiring so the guards and the publish recorder can see the hub. The build log recorded both rulings.
- Test commands and `TestNooped` live on the command route. The plan puts them there, and `appendEvents` only accepts a registered event type.
- Setup mode is an empty Fastify app. `/health` and `/setup` are tasks 26 and 33. The task 25 test locks the absence of command, query, admin, and auth routes.
- `StaffDirectory.load` at step 4a is discarded. `attachRouteGuards` loads again at step 7, after catch-up. Step 4b does not change the directory.
- `publish` runs inside `writer.run`, before the HTTP body is written. Task 15 owns that order. Sockets are task 45.
- The login half of #98 (the other staff member gets 200, not 409). The plan leaves it to task 39.
- #42’s “retransmit → identical response” is the revoke command’s own idempotency. A revoked device token is `403 DEVICE_REVOKED` at the guard (§3.9), which is what #116 locks.
- Replay does not refresh session activity. M19 says a replay has no new effects. The device guard still records `deviceSeen`, because the device token is a guard that runs before the fast path.
- Boot’s address list includes loopback. The host matcher already allows `127.0.0.1` and `localhost`. Setup mode’s extra addresses are the same non-internal IPv4 set `listOwnIPv4` returns.
- `registerBootStep` is process-global and the boot tests do not remove their steps. Those closures only push onto arrays that nothing else reads, so a later `boot()` does not throw and does not change its own step list.
- An unknown query name is `404` before the session check. §6.2’s session rule applies to a query that declares `session: 'required'`. An unregistered name is not one of those.
- `pnpm-lock.yaml` and dependency additions. Already declined in the earlier pass.

## Fix list

### 1. A committed command on an idle session never reaches the replay path

- **Where:** `apps/hub/src/commands/route.ts` registers `POST /commands/:name` as `device-session` with `allowEnded: true`. `apps/hub/src/auth/guards.ts` `requireSession` ends an idle session and throws `401 SESSION_EXPIRED` in `onRequest`. The handler then requires `request.session` before `decide`.
- **What's wrong:** M19 says the fast path on `POST /commands/:name` runs with the device token alone and has no new effects. §3.7 and §3.9 put the device-session check, including the idle check, after that path. `allowEnded` only lets an already-ended row through. A stored `command_id` whose session has gone idle is answered `401`, and the hub writes `SessionEnded { reason: 'idle_timeout' }`. A resend with no `X-Session-Token` is `401 SESSION_INVALID` for the same reason. #3 only calls `endSessionNow` and resends the old token, so this passes. §8.5 tells the device that `401 SESSION_*` means the command was never processed.
- **Why it matters:** A tablet whose session idled out resends the committed command and keeps it in the queue. Task 25b and task 45 both follow `SessionEnded`. The idle end is a new effect on a path that must not write.
- **Fix:** Give `/commands/:name` group `device`. After the tenant check, replay or `command_id` conflict from the token’s `device_id` with no session required. Only on a miss, apply the session rules: missing, unknown, or another device → `SESSION_INVALID`; idle → `endSession` then `SESSION_EXPIRED`; already ended → `SESSION_EXPIRED`. A station session stays allowed through to the command rule. In #3, on `/commands/test-noop`, advance past the TTL and resend the stored `command_id` (with the session token, and again with only the device token): both return the stored body, `Idempotent-Replay: true`, and the row is still open. A new `command_id` at TTL + 1 s on that route returns `401 SESSION_EXPIRED`, ends the row `idle_timeout`, and writes one `SessionEnded`. #98’s guard route at exactly the TTL stays 200.
- **Spec change:** no.

### 2. An ended bootstrap admin session is reported as an invalid device

- **Where:** `apps/hub/src/auth/guards.ts` `liveBootstrap` requires `ended_at === null`.
- **What's wrong:** §3.9 exempts a request carrying a bootstrap admin session (`device_id` null) from the device token. The plan’s admin guard then answers missing, unknown, and ended with `401 ADMIN_SESSION_REQUIRED`. After logout, or on the retry after the idle end, the same header with no `Authorization` hits the device guard and returns `401 DEVICE_TOKEN_INVALID`. #115’s bootstrap case is a live session, so this passes.
- **Why it matters:** §8.4 tells the client that `DEVICE_TOKEN_INVALID` means wipe the device token and pair again. The setup browser has no device token. Task 32’s bootstrap logout and task 39’s idle end both leave this header in place.
- **Fix:** Treat `kind === 'admin'` and `device_id === null` as bootstrap whether or not the row has ended. The admin guard already returns `ADMIN_SESSION_REQUIRED` for an ended row. Extend #115 with an ended bootstrap session and no device token.
- **Spec change:** no.

### 3. #117 does not call the session check it names

- **Where:** `[00 §10 #117]` in `apps/hub/test/auth/guards-auth.int.test.ts`. It mounts `POST /commands/noop` and `GET /queries/orders` with group `device-session`.
- **What's wrong:** Those static paths win over `POST /commands/:name` and `GET /queries/:resource`. The production query handler returns `404` for an unknown resource before `requireDeviceSession`. Ended → `SESSION_EXPIRED` and unknown → `SESSION_INVALID` are locked on the guard, not on the generic query route §6.2 assigns them to. After item 1, `/commands/:name` will not use the session guard either, so the command half of #117 would have the same hole.
- **Why it matters:** A wrong status from `requireDeviceSession` (or from the command route’s own session check) still leaves #117 green. Task 27’s queries and every later command rely on those two codes.
- **Fix:** Point the query half at `GET /queries/test-quiet`. Point the command half at `POST /commands/test-noop` with a real command body, so a validation failure cannot satisfy it. Keep the logout and station cases on the guard routes: logout is not mounted yet, and `allowStation` on a route config is what that guard is for.
- **Spec change:** no.

### 4. Idle expiry is locked on the row, not on SessionEnded

- **Where:** `[00 §10 #98]` and the idle half of `[00 §10 #115]`. Both assert `end_reason`. The query route’s `requireDeviceSession` is a second copy of the same end, and nothing calls it past the TTL.
- **What's wrong:** §3.4 and M46 require one `SessionEnded { reason: 'idle_timeout' }`. An `UPDATE` of the columns, skipping `endSession`, still passes. M55(f) allows the query path to write that event and nothing else; a query that only updates the row still passes #13, which never idles a session.
- **Why it matters:** Task 25b’s `access_reconcile` and task 45’s socket close follow the event. A swept-looking row with no event is still open after a restore.
- **Fix:** In #98 and the idle half of #115, expect one `SessionEnded` with `reason: 'idle_timeout'` and no second one. In #98, also `GET /queries/test-quiet` for a session that is past its TTL: `401 SESSION_EXPIRED`, one `SessionEnded`, and no other new event.
- **Spec change:** no.

### 5. Replay identity is not distinguished from the session

- **Where:** `[00 §10 #2]` resends with the same session. `[00 §10 #99]`’s other admin session is also a different device. `decide` matches `device_id` on `/commands` and `session_id` on `/admin/commands`.
- **What's wrong:** Matching `/commands` on `session_id` still passes #2 and #4, because the other device has a different session. Matching `/admin/commands` on `device_id` still passes #99, because the other admin has a different device. M19’s key is the device. M47’s admin key is `session_id`. The unique index allows a second admin session on the same device; a second staff session has to wait until the first has ended.
- **Why it matters:** A match on the wrong key replays one device’s stored response to another session, or refuses the replay M19 exists to return.
- **Fix:** In #2, end the staff session, open another for the same staff member on the same device, and resend. Expect the stored body. In #99, open a second admin session on the first admin’s device and resend. Expect `400` and `command_id already used`.
- **Spec change:** no.

### 6. The query limit bounds are not locked

- **Where:** `[00 §6.2] a limit above 200 is 400`. `pageParams` uses default 50 and `limit > 200`. The test sends only `limit=201`. `test-page` returns the raw query value, not `ctx.page.limit`.
- **What's wrong:** `limit >= 200` still fails the test, because 201 is still rejected. An omitted limit can be stored as 1 or 500 and the response stays `{ limit: null }`.
- **Why it matters:** §6.2’s max is 200 and the default is 50. Task 27’s lists use `pageParams`. A default of 500 is an unbounded read, which the no-N+1 rule is there to stop.
- **Fix:** Have `test-page` return `ctx.page.limit`. Expect an omitted limit to be 50, `limit=200` to be 200, and `limit=201` to be `400 VALIDATION_FAILED`.
- **Spec change:** no.

### 7. DEVICE_TYPE_NOT_ALLOWED has no details

- **Where:** `apps/hub/src/queries/registry.ts` throws `DEVICE_TYPE_NOT_ALLOWED` with no details. `[00 §6.2] a device type outside deviceTypes is 403` asserts the code only.
- **What's wrong:** §9 gives that code `details: { device_type, allowed }`. The query path sends `{}`.
- **Why it matters:** §6.9, §6.11, and §6.31 return the same code. One shape is what a client can branch on. An empty object forces every later caller to invent its own.
- **Fix:** Throw `{ device_type, allowed }` with the token’s type and the query’s `deviceTypes`. Expect `{ device_type: 'kds', allowed: ['tablet'] }` from the existing test.
- **Spec change:** no.

## Needs spec change

- **§10 #67 still says reset.** The catalogue row is "checkpoint behind `MAX(seq)` → `reset` + replay". M48 and §3.8 step 4 say `reset` + full replay only when the checkpoint row is missing; a checkpoint that is merely behind replays `seq > checkpoint`. Task 14 and the code follow M48. The §10 sentence should be updated to match M48. No code change.
