# Build review 1 — module 00 tasks 1–5c

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `a67ed30` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) and foundation §4.1, §6.2, §6.5–§6.7 where those tasks cite it |
| Plan | `docs/plans/00-plan.md` tasks 1, 2, 3, 4, 5, 5b, 5c |
| Done per `docs/reviews/build-log.md` | tasks 2, 3, 4, 5, 5b, 5c. Task 1 is commit `4abf807` and is in range. |
| Date | 2026-10-23 |
| Verdict | Fix the list below before task 6. Task 6 is not allowed to edit `eslint.config.js`. |

Checked: spec deviations in the shared packages, §10 test numbering, tests that do not actually check the case they name, files outside each task's file list, secrets in logs, and contracts later tasks import.

## What matches

- `ErrorCatalogue` is the task 2 list, including reserved `LOGIN_LOCKED_OUT` 429. Statuses match spec §9 for the codes that test names.
- `PERMISSIONS` is the E6 AC2 list, then `manage-devices`, then `access-hub-admin` (19 names). `assertKnownPermissions` throws `Error` and names the first unknown.
- `[00 §10 #74]` is the only `[00 §10 #n]` test in the repo, and it appears once. Numbers owned by tasks 6+ are not due yet.
- The 14 event payloads match spec §4.2, including `issued_by`, `credentials_changed_staff_ids`, `skipped`, `pair_request_id`, and the DevicePaired exactly-one source id. `HubProvisioned` has no `setup_attempt_id`. `SessionEndReason` includes `credentials_changed` and `hub_restored`.
- `DirectorySchema`, `WsClientMessage` / `WsServerMessage`, and `WS_CLOSE` (4401, 4403, 4426, 1012) match the plan and foundation §6.5. The pushed `event` frame is the reduced shape.
- No `console.log` or other logger. Payloads carry token ids, not PIN, password, or token secrets.
- Task commits stay inside each task's file list, except the lockfile notes under Declined.

## Declined

- `pnpm-lock.yaml` in `4abf807` and `8f22dde`. `pnpm install` writes it for dependencies the task's `package.json` adds. Not a behavior change.
- Doc commits `7e3ae75` and `98752c2` edit specs, the plan, README, and reviews. Those are the human doc updates, not implementation defects.
- Build-log commits only touch `docs/reviews/build-log.md`.
- The `**/db/client` import ban is in task 1, ahead of task 28. It matches the later rule and does not change an export task 6 imports.
- `payloadSchema` returns `z.ZodType`. Zod 4 removed `ZodTypeAny`, which is what the plan text says. The code matches the library. Later tasks should copy `z.ZodType`. No spec change.
- Payload enums are copied beside `@pos/domain` instead of derived from it. The values match `SessionEndReason`, `DeviceType`, `GrantType`, and `LockoutSubject` today.
- Envelope ids are `z.string()`, as foundation §4.1 writes them. Event schemas do not constrain `stream_type`; task 5 says not to. Directory `pin_hash` and `permission` stay plain strings so the hub can apply M52.
- `staff_count`, `role_count`, and `delta_ms` are unbounded ints. The plan only bounds `directory_version` and `session_idle_ttl_ms`. `delta_ms` must be allowed to be negative for task 6.
- `ORDER_NOT_FOUND` and `TABLE_NOT_FOUND` are absent. Foundation §6.2 gives them as examples of later module codes.
- `packages/events/testing` is outside the events `tsconfig` `include`. Vitest still runs `builders.test.ts`. No type error in the builders.
- `passWithNoTests` remains on the events project. The tests are collected (16 tests after task 5c). Hub and cloud still have no tests, so their flag stays.
- A Zod failure can echo input inside a `ZodError`. Nothing in these packages logs it, and these payloads do not carry secrets.
- `ULID_RE` is `/^[0-9A-HJKMNP-TV-Z]{26}$/`, which is Crockford and rejects `I`, `L`, `O`, and `U`. The test only shows `I`. The regex is the contract; a second example would not change it.
- Builder time `1_761_000_000_000` and fixture time `1761000000000` differ. Nothing requires them to match.
- Tasks 5b and 5c did not rewrite payloads. Tasks 2–5 were already written from this plan, so the v0.6 and v1.0 shapes were already present. 5c's new test and the lint rule are the real delta.

## Fix list

### 1. Determinism lint does not ban `crypto.randomUUID()` or `ulid()`

- **Where:** `eslint.config.js` `forbiddenCalls` (the `Date.now` / `performance.now` / `Math.random` selectors only). Task 1, commit `4abf807`. Still missing after task 5c edited this file.
- **What's wrong:** Task 1 step 3 requires `no-restricted-syntax` for `crypto.randomUUID` as well. Global Constraints also forbid a direct `ulid()` call outside the listed exception files. A named import (`import { randomUUID } from 'node:crypto'` then `randomUUID()`, or `ulid()` from the `ulid` package) is not a `crypto.randomUUID` member call, so a member selector alone would miss it.
- **Why it matters:** This lint is the only mechanical guard. Task 6 adds id and secret generation and its file list does not include `eslint.config.js`, so the hole stays open. `hash.ts` or a route can call `crypto.randomUUID()` or `ulid()` and `pnpm lint` still passes. The exception list already turns the rule off for `clock.ts`, `ids.ts`, `secrets.ts`, `main.ts`, the cloud CLI, `issue-admin-bootstrap.ts`, and tests, but that switch does nothing for calls that are not banned.
- **Fix:** Add selectors for a callee property named `randomUUID`, a callee named `randomUUID`, and a callee named `ulid`, with the same Clock / IdGen / SecretGen messages. Leave the existing off-switch for the exception files.
- **Spec change:** no.

### 2. Upcast tests never check `schema_version`

- **Where:** `packages/events/src/codecs.test.ts` (`[F §4.1, D46] parseEvent upcasts v1 to latest` asserts only `{ a: 1, b: 'x' }`). `packages/events/src/fixtures.test.ts` compares `parseEvent(v1).payload` to `.latest.json` and ignores the rest of that file. Task 4, commit `8f22dde`; fixtures in task 5, commit `e42d842`.
- **What's wrong:** `parseEvent` does set `schema_version` to the latest version (`packages/events/src/codecs.ts`). The tests still pass if that assignment is removed, or if a `.latest.json` claims a different `schema_version` than the parsed event.
- **Why it matters:** Replay and sync treat `schema_version` as the payload version (D46). A v2 payload left marked v1 is the bug this test exists to catch. The 14 real fixtures are still v1, so only the codec test actually walks an upcaster.
- **Fix:** Expect `schema_version` 2 on the parsed test event. Expect `parseEvent(v1)` to deep-equal the whole `.latest.json` fixture.
- **Spec change:** no.

### 3. `qrcode` ban is the exact package name only

- **Where:** `eslint.config.js` `qrcodeImports` (`paths: [{ name: 'qrcode' }]`). Task 5c, commit `64f5321`.
- **What's wrong:** `paths[].name` matches `import … from 'qrcode'` and not `qrcode/lib/…`. The allowlist for `issue-admin-bootstrap.ts` and `lib/qr.ts` is the right idea; those files replace the rule and may import the package.
- **Why it matters:** M77 is one library, imported only from those two files. A deep import elsewhere passes `pnpm lint`. Later QR tasks do not edit this file.
- **Fix:** Restrict `qrcode`, `qrcode/*`, and `qrcode/**` on the base rule and on the cloud `db/` override. Keep the two allowlisted files on the db-client-only override so they can still import it. Do not spread a `patterns` object over the db-client `patterns` array; that would drop the db-client ban.
- **Spec change:** no.

### 4. The permission tests do not lock the catalogue or the first unknown name

- **Where:** `packages/domain/src/permissions.test.ts`. Task 3, commit `96129e3`.
- **What's wrong:** `[00 §3.6]` checks `PERMISSIONS.length === 19` and that the set has 19 entries. Any 19 strings pass. `[00 §10 #74]` uses one unknown name, so it does not show that `assertKnownPermissions` names the first unknown when several are declared. The implementation list is the right E6 list; the tests would not notice a rename.
- **Why it matters:** Later commands and the seed roles import these strings. A renamed permission fails at runtime in task 22+, and this unit test stays green. Spec §3.6 says a unit test fails if a command declares a permission not in the catalogue; #74 is that test and must keep its name. There is still exactly one `[00 §10 #74]`.
- **Fix:** In the existing `[00 §3.6]` test, expect the exact 19 names in order. In the existing `[00 §10 #74]` test, declare two unknowns and expect the message to name the first and not the second.
- **Spec change:** no.

## Needs spec change

None.
