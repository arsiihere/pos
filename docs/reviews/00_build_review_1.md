# Build review 1 — module 00 tasks 2–43

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `8ce6093` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) |
| Plan | `docs/plans/00-plan.md` tasks 2–43 |
| Done per `docs/reviews/build-log.md` | tasks 2–43. Task 1 is commit `4abf807`. |
| Date | 2026-10-24 |
| Verdict | Fix the list below before task 44. |

The copy of this file at `0df071e` listed five items for tasks 2–38b. Those landed in `d7cdc11` .. `9b28531` and are not reopened. This pass re-read the tree at `8ce6093`, including tasks 39–43.

## What matches

- Every `[00 §10 #n]` name owned by tasks 2–43 is present once. No number is used twice. Later-task numbers (48–55, 73, 77, 79, 104, 109, 112, 119, 120, 123, 125, 126) are absent.
- `#31`–`#39`, `#42`–`#47`, `#60`, `#69`, `#81`, `#82`, and `#121` cover the login, logout, station, sweeper, admin-command, and query outcomes they name, except the gaps in the fix list.
- Staff login ends an idle holder before the slot check, maps a unique-index failure to `409`, and refuses a phone login that is not the owner before any PIN work. Station replace writes `ended_by` null. The sweeper ends idle staff and admin sessions, never station sessions, and retention matches the §5.1 windows and the 500-row batches.
- No hub or cloud log line writes a PIN, bootstrap token, registration code, branch API key, pairing token, poll secret, or `pin_hash`. The pair URL's `t` query value is still redacted. Header and body redaction still censor the §7.2 names.

## Declined

- Hand-rolled HS256, and the other items the previous copy of this file declined. Not reopened.
- `#90`'s hub half lives in `[00 §3.1 M41]`, the name task 33b requires, so the §10 number stays single.
- `#80`'s `owner_staff_id` and `/auth/pin`'s `staff_id` are any non-empty string. The fixture staff ids are not ULIDs; a ULID check would fail the spec tests.
- Task 39 edits `apps/hub/test/auth/guards-auth.int.test.ts`, which is outside that task's file list, so the real `/auth/pin` and `/auth/logout` are not registered twice. Tasks 40–43 stay inside their file lists. Not reopened.
- `#42`'s socket close `4403` is task 45, as the plan says. This review does not ask for it.
- A device's `active_session` is the staff or station row. An admin session on that tablet stays in `GET /admin/queries/sessions`. The devices field is one object, and the unique index allows a staff session and an admin session on the same device. `#45` locks the admin row out of `active_session`.

## Needs spec change

- **`branch_name` is discarded at setup.** §6.8 and §6.31 require it on the pair and poll responses, and M37 requires it in the hub catch-up part. §3.10 does not list a config field for it, and `HubProvisioned` is `{ tenant_id, branch_id, hub_version }` (M71). The hub returns `''`. Storing the register response's `branch_name` means adding a field §3.10 does not name. Not changed here.
- **A QR scan cannot open `/admin/approve`.** §8.2 says scanning `approve_url` opens `/admin/approve?r=…`. Task 38b puts that GET in group `admin`, so the browser navigation has no `Authorization` and no `X-Admin-Session` and the guard returns 401 before the HTML. M43 keeps the admin token in `sessionStorage`, which a navigation does not send. Serving the HTML without the device guard means changing the plan's group. Not changed here.
- **`pairing_source` does not survive retention.** §6.17 requires `token` or `request`. The devices query treats a `pairing_tokens` row as `token`. §5.1 deletes pairing tokens whose `expires_at` is older than 7 days, and a pairing token expires 10 minutes after it is issued. A week later every token-paired tablet and phone is reported as `request`. §5.1 has no column to store the source, and scanning `DevicePaired` out of the event log on each list is not a one-statement read the 1 M-event hub can afford. Not changed here.

## Fix list

### 1. Command `event_ids` omit events the handler appended

- **Where:** `apps/hub/src/commands/route.ts` (`event_ids` is taken only from `handled.events`). `RevokeDevice` and `ForceLogoutSession` call `endSession`, which appends `SessionEnded` on the same transaction and does not return that draft.
- **What's wrong:** §6.1 and foundation D32 store `{ command_id, event_ids, result }` as the command's events. A revoke that ends two sessions returns only the `DeviceRevoked` id. A force logout returns `event_ids: []` while one `SessionEnded` is committed. The replay body keeps that list for 7 days.
- **Why it matters:** Task 45 publishes the writer's full batch, so the socket can show a `SessionEnded` the command response never names. A client that treats `event_ids` as the committed set drops the session end.
- **Fix:** After the handler returns, `event_ids` is every event this transaction appended, in `seq` order. Extend `[00 §10 #42]` so the revoke's `event_ids` are the two `SessionEnded` rows and the `DeviceRevoked` row. Extend `[00 §10 #43]` so the staff force logout's `event_ids` is that `SessionEnded`. Do not add a test name.
- **Spec change:** no.

### 2. An IP lockout clear is not on the lockout's stream

- **Where:** `apps/hub/src/commands/clear-pin-lockout.ts` `stream_id`.
- **What's wrong:** §4.2 puts `DevicePinLockedOut` for an IP on `hub` / `ip:<addr>`. `PinLockoutCleared` is `staff` / `staff_id`, or `hub` / subject. The clear uses the raw address (`192.168.10.9`). The lock and the clear are different hub streams. A device id equal to that address would share the clear's stream.
- **Why it matters:** §4.2 is the contract later modules may rely on. Replaying the `ip:<addr>` stream never sees the clear.
- **Fix:** An IP clear uses `stream_id` `ip:<addr>`. `subject_id` in the payload stays the raw address. A staff clear stays `staff` / staff id. A device clear stays `hub` / device id. Extend `[00 §10 #44]` with those three stream ids. Do not add a test name.
- **Spec change:** no.

### 3. A correct PIN that loses the device slot does not lock the counter rule

- **Where:** `apps/hub/test/auth/staff-session.int.test.ts` `[00 §10 #34]`. The reset itself is in `apps/hub/src/auth/pin.ts` (the second transaction after the rollback).
- **What's wrong:** §6.9 says the occupied-device path rolls the login back and the staff counter stays reset. §3.5 step 9 resets the staff counter and does not reset the device counter. `#34` checks that no event was written. It never sets a staff failure and never reads `auth_lockouts`. Deleting the post-rollback reset leaves `#34` green.
- **Why it matters:** A cashier who typed the right PIN and was refused with 409 keeps the failures, and the next wrong PIN locks them early.
- **Fix:** In `[00 §10 #34]`, one wrong PIN for the challenger, then the correct PIN without takeover. The response is still 409, the holder is still active, the event count is unchanged, the challenger's staff `failed_count` is 0, and the device `failed_count` is still 1. Do not add a test name. Change production code only if that assertion fails.
- **Spec change:** no.

### 4. Force logout reports a later `ended_at` than the row

- **Where:** `apps/hub/src/commands/force-logout-session.ts` `ended_at: ctx.clock.branchNow()` after `endSession`.
- **What's wrong:** `endSession` already stored `tx.clock.branchNow()` on the row. The result reads the clock again. On the branch clock that value is `floor(bootWall + mono elapsed)`, so the two reads can fall on either side of a millisecond. The stored command body then disagrees with `staff_sessions.ended_at`. `#43` compares the result to `hub.clock.branchNow()` on a frozen test clock, so the split is invisible.
- **Why it matters:** The replay body is the result, not the row. A later read of the session shows a different instant.
- **Fix:** The result's `ended_at` is the timestamp `endSession` wrote. Extend `[00 §10 #43]` so a clock that advances on each read still has `result.ended_at` equal to the row, and the replayed body carries that same timestamp. Do not add a test name.
- **Spec change:** no.
