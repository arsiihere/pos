# Build review 1 — module 00 tasks 2–32b

| Field | Value |
|---|---|
| Range | `f03c730` (plan commit, excluded) .. `b0125f9` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.0.md` (v1.0.1) |
| Plan | `docs/plans/00-plan.md` tasks 2–32b |
| Done per `docs/reviews/build-log.md` | tasks 2–32b. Task 1 is commit `4abf807`. |
| Date | 2026-10-23 |
| Verdict | Fix the list below before task 33. |

Earlier copies of this file reviewed tasks 1–28. Those items were fixed in `0a6c552` .. `db6a98d` and are not reopened. This pass re-read the tree through task 32b.

## What matches

- Every `[00 §10 #n]` name in the suite is unique. Numbers owned by tasks 2–32b are present once: `#1`–`#14`, `#21`–`#25`, `#56`, `#57`, `#58`, `#61`–`#68`, `#70`–`#72`, `#74`–`#76`, `#78`, `#83`, `#85`–`#90`, `#97`–`#103`, `#106`, `#108`, `#110`, `#111`, `#113`, `#115`–`#117`, `#122`, `#124`, `#128`, `#129`. Later-task numbers are absent.
- Register stays `pending_hub`, rotates a key on the same Idempotency-Key inside 1 h, and answers unknown, expired, and wrong-attempt codes with the same `401` body. Confirm uses `COALESCE` so a repeat keeps the first `hub_confirmed_at`. Reissue refuses a confirmed branch.
- Seed roles match §6.26 (TTLs, Owner and Manager grants, Cashier approval, Order taker empty). `SystemContext` and `credential-lookup` import pins match M55 and M56.
- No new code logs a PIN, token, password, registration code, branch API key, or `pin_hash`. `hub_registered` is `tenant_id`, `branch_id`, `kind`, `rotated`. Fastify's request serializer does not include the body or the `Authorization` header.

## Declined

- Hand-rolled HS256 on `app.jwt` instead of `@fastify/jwt`. Task 29's file list excluded `package.json`. `sign` / `verify` match the claims task 47 needs (`sub`, `tenant_id`, `allowed_branch_ids`, 1 h).
- `HUB_MIN_VERSION` is loaded and never compared. §6.5 and §6.28 do not say to reject an old `hub_version`. Inventing a status code would block task 33.
- The registration-code guard rejects only an unknown hash. Expiry and the same-attempt rule run inside the register transaction. `#24` locks the three `401` bodies.
- `server.ts`, `guards.int.test.ts`, `test-hub.ts`, `boot.int.test.ts`, and dependency additions outside some task file lists. The build log recorded those rulings.
- `createSession` draws tokens from `cryptoSecrets`. The writer has no `SecretGen`. Callers receive the plaintext token from the return value.

## Needs spec change

- **A replay after confirm revokes the key the hub just stored.** §6.5 step 3 rotates on every valid exchange, including the same Idempotency-Key while `now − consumed_at < 3 600 000`. §6.28 expires unconsumed codes only, so the consumed code stays usable. Confirm can succeed, the hub can store `branch_api_key` and stop, and a replay inside the hour then revokes that key. Module 06 would sync with a dead key. Closing it means changing M14 or §6.28 (for example: once `hub_confirmed_at` is set, the same-attempt exchange is `401` and does not rotate). Not changed here.

## Fix list

### 1. Two live codes for one branch can 500

- **Where:** `apps/cloud/src/modules/hub-registration/service.ts` `registerHub`. The transaction locks the code row only. `branch_api_keys_one_active` is the other lock.
- **What's wrong:** Reissue leaves the consumed code valid for the same Idempotency-Key for 1 h and inserts a second code. Two exchanges of those codes take different `FOR UPDATE` locks, then both `INSERT` a live key. PostgreSQL raises `23505`. The handler is not a `DomainError`, so the client gets `500 INTERNAL_ERROR`.
- **Why it matters:** M22 is the recovery when setup retries. That retry and the new code are in flight together. Task 33 passes a cloud 500 through as `INTERNAL_ERROR` and does not rotate.
- **Fix:** After the code is locked and accepted, `SELECT … FROM branches WHERE tenant_id = $1 AND branch_id = $2 FOR UPDATE`, then revoke and insert. Test `[00 §6.5] a same-attempt retry and a reissued code both return 200 and leave one live key`: hold the branch row, insert a live key, release, and expect the waiting register to return 200 with that key revoked.
- **Spec change:** no.

### 2. Confirm still succeeds after the key is revoked

- **Where:** `apps/cloud/src/modules/hub-registration/service.ts` `confirmHub`. The branch-key guard checks `revoked_at` on another connection. The update does not look at the key.
- **What's wrong:** `UPDATE branches` waits on the row lock, then sets `active` with whatever key the guard saw. A register that revoked that key and committed while confirm was waiting still gets `200`.
- **Why it matters:** Task 33b writes `confirmed_at` and stops on `200`. The hub keeps the revoked key.
- **Fix:** In the same transaction, lock the branch row and require a live `branch_api_keys` row for the presented key hash. Otherwise `401 BRANCH_API_KEY_INVALID` and do not change the branch. Test `[00 §6.28] confirm after the presented key is revoked is 401 and leaves the branch pending_hub`.
- **Spec change:** no.

### 3. `REGISTRATION_CODE_KIND_UNSUPPORTED` has empty details

- **Where:** `registerHub` throws `new DomainError('REGISTRATION_CODE_KIND_UNSUPPORTED')`. `#25` checks the status and the code only.
- **What's wrong:** §9 details are `{ kind, accepted_kinds }`. The body is `details: {}`.
- **Why it matters:** Task 33 step 4 copies the cloud error through. The kind the hub sent is not in the body.
- **Fix:** Pass `{ kind: row.kind, accepted_kinds: input.acceptedKinds }`. Extend `#25` to expect those details. Do not add a second `[00 §10 #25]` test.
- **Spec change:** no.

### 4. 429 and 503 never set `Retry-After`

- **Where:** `apps/hub/src/server.ts` and `apps/cloud/src/plugins/error-handler.ts`. Nothing in the repo sets the header.
- **What's wrong:** §7.1 `onSend` adds `Retry-After` for 429 and 503. The global constraint is seconds, rounded up, plus `details.retry_after_ms`.
- **Why it matters:** Task 34 may not edit `server.ts`. Task 47 may not edit the cloud error handler. Both throw `DomainError` with `retry_after_ms` and cannot add the header in their file lists.
- **Fix:** On 429 and 503, when `details.retry_after_ms` is a finite number ≥ 0, set `Retry-After` to `Math.ceil(ms / 1000)`. Tests `[00 §7.1] a 503 carries Retry-After rounded up from retry_after_ms` on the hub and `[00 §7.1] a 429 carries Retry-After rounded up from retry_after_ms` on the cloud. A 400 does not get the header.
- **Spec change:** no.

### 5. The cloud route inventory does not see the routes the server registered

- **Where:** `apps/cloud/test/route-inventory.int.test.ts` `[00 §10 #76]`. `seen` is filled by an `onRoute` hook added after `createTestCloud()`.
- **What's wrong:** Foundation §3.4: the inventory collects every route. The hook misses `POST /v1/hubs/register` and `POST /v1/hubs/confirm`. `onReady` still rejects a missing scope, so a wrong scope (`jwt` on confirm, `none` is already banned) stays green.
- **Why it matters:** Task 49's file list does not include `tenant-scope.ts`. Its cross-tenant loop cannot see routes that were registered before the test's hook.
- **Fix:** Record `{ method, url, tenantScope }` inside the existing `onRoute` hook and export `listTenantScopes(app)`. Extend `#76` so the list contains register as `registration-code` and confirm as `branch-key`. Do not add a second `[00 §10 #76]` test.
- **Spec change:** no.

### 6. Register's directory test does not lock the grants the hub will apply

- **Where:** `apps/cloud/test/hub-registration.int.test.ts` `[00 §10 #22]`. It checks staff ids and that `DirectorySchema` parses.
- **What's wrong:** An owner role with `permissions: []` still parses. `consumed_at` is selected and not asserted. Task 33 applies this directory. Task 35 requires `access-hub-admin` on that owner. `#56` locks the seed tables, not `loadDirectory`.
- **Why it matters:** A dropped permissions query stays green until admin login.
- **Fix:** In the existing `#22` test, expect `consumed_at` set to the idempotency key, and expect the Owner role's permissions to include `access-hub-admin` with `grant_type: 'allowed'`. Do not add a second `[00 §10 #22]` test.
- **Spec change:** no.
