# Build review 2 — module 00, fixes after build review 1

| Field | Value |
|---|---|
| Range | `a87e3ff` (build review 1) .. `e15ca13` |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.1.md` (v1.1 DRAFT, owner review; built against v1.0.1) |
| Plan | `docs/plans/00-plan.md` tasks 50–51, then tasks 52–60 = items 1–9 below |
| Date | 2026-10-24 |
| Tests at `e15ca13` | hub + packages: 56 files, 211 passed, 1 skipped (`POS_SKIP_BIG=1`). Cloud not run here: `postgres:16` on 5433 was down |
| Verdict | Fix the list below. Items 2–5 wait for the owner's approval of v1.1 |

## Build review 1 fix list: status

| # | Item | Commit | Result |
|---|---|---|---|
| 1 | exit after provision when the flush fails | `8b061c7` | done; `[00 §6.4]` test added |
| 2 | paired screen reloads into a new request | `719cd58` | partly done; follow-up in item 3 below |
| 3 | §9 `details` on hub errors | `dacea3c` | done; the only bare one left is `TestFails` (declined in review 1) |
| 4 | #22 second-branch isolation | `3646773`, `4308fa5` | done |
| 5 | cloud `Authorization` redaction | `08a2ce0` | done |
| 6 | hub directory CHECKs | `02d85b4` | done |
| 7 | `/devices/pair` accepts screen types | `e15ca13` | done; no test, which the review allowed |

None of the eight commits cites a spec section (CLAUDE.md). None is in `build-log.md`. Item 9 covers both.

## "Needs spec change" from build review 1: resolution

| Item | Resolution |
|---|---|
| §10 #53 says the 10th failure is 429 | Spec v1.1 rewrites #53 (M73 behaviour); test title in item 6 |
| `branch_name` discarded | Spec v1.1 **M78**: `provisioned.branch_name` in config; item 4 |
| QR scan cannot open `/admin/approve` | Spec v1.1 **M79**: static admin pages, in-page admin login, approval by display code alone; items 2–3 |
| `pairing_source` lost after retention | Spec v1.1 **M80**: derived from `device_type`; item 5 |
| §10 #114 vs plan task 35 | No spec change. The spec's wording stands, so the `#114` test covers both routes; item 7 |

## Skipped tasks: resolution

- **Task 50 (systemd unit and smoke test):** the files are Cursor's work (item 8). Running `[00 §10 #79]` on the pilot mini PC is the owner's job; record the numbers or the gap in `docs/reviews/` (§12.1).
- **Task 51 (foundation table and README):** the foundation §6.2 status map now lists the spec 00 §9 codes, appended only (D64), and `errors.ts` already had all of them. The README row points at v1.1. Moving 00 to "Implemented" waits for items 1–9 and #79. This stays with the owner, not Cursor.

## Fix list

### 1. The admin recovery CLI cannot run on the hub

- **Where:** `apps/hub/package.json`. The script is `"issue-admin-bootstrap": "tsx src/setup/issue-admin-bootstrap.ts"`, but `tsx` is a dependency of `@pos/cloud` only. `pnpm --filter hub exec sh -c 'command -v tsx'` prints nothing.
- **What's wrong:** §6.34 / M72 runs `pnpm --filter hub issue-admin-bootstrap` on the hub machine. `#127` calls `runIssueAdminBootstrap` in-process, so it stays green.
- **Why it matters:** this CLI is the only way to regain admin access once the bootstrap token is gone. Its absence breaks recovery exactly when it's needed.
- **Fix:** add `"tsx": "4.23.15"` to `@pos/hub` `dependencies` (not dev; it runs on the hub, §7.11) and update `pnpm-lock.yaml`. Add a `[00 §6.34]` test that spawns `pnpm --filter @pos/hub issue-admin-bootstrap` with `POS_HUB_CONFIG` pointing at a provisioned temp config, and expects exit 0 with an `/admin/bootstrap#t=` line. Do not add a §10 number.
- **Spec change:** no.

### 2. Admin pages load without credentials; approve by display code (M79)

- **Where:** `apps/hub/src/commands/approve-pairing-request.ts` (`GET /admin/approve`, `approvePage`, `Payload`, handler) and `apps/hub/src/auth/admin-bootstrap.ts` (page script).
- **What's wrong:** `GET /admin/approve` is group `admin`, and it renders the caller's device token and admin session token into the HTML. A camera navigation has neither header, so it always gets `401`.
- **Fix:**
  - `GET /admin/approve` uses group `admin-bootstrap` (host, provisioned, guest; the same set as `GET /admin/bootstrap`). It embeds only `tenant_id` and `branch_id`, and no token.
  - The page script follows spec §8.2 "Approving" steps 1–4: read IndexedDB `pos-device` (`token`, `device_id`) and `sessionStorage` (`admin_session_token`, `admin_staff_id`, `admin_bootstrap`). With neither a token nor a bootstrap session, show `pairing.approve_needs_admin_device` and send nothing. With no admin session, log in through `GET /admin/login-roster` + `POST /admin/auth`. Then post `ApprovePairingRequest`, using `device_id` `'hub-admin'` and no `Authorization` for a bootstrap session.
  - `Payload.request_id` becomes optional. Without it, select pending rows (`approved_at IS NULL AND expires_at > now`, this branch) with that `display_code`. Anything other than exactly one row → `404 PAIRING_REQUEST_NOT_FOUND`.
  - The bootstrap page stores `admin_staff_id` and `admin_bootstrap = '1'` beside `admin_session_token`.
  - Tests: `[00 §10 #133]` per spec §10. Keep `#96` green; it still passes `request_id`.
- **Spec change:** v1.1 M79, §3.9, §6.32, §8.2.

### 3. The pair page stores `device_id` and recovers from a dead token

- **Where:** `apps/hub/src/auth/pair-page.ts` (`resumePaired`, the approve poll, the `/devices/pair` success path, the create-request error path).
- **What's wrong:** `resumePaired` ignores the `/auth/station` response, so a revoked or unknown KDS token shows `login` forever. `device_id` is never stored, but the item 2 approve page needs it. A `429` or `503` on create shows a button, but §8.4 says to retry after `retry_after_ms`.
- **Fix:**
  - Write `device_id` to IndexedDB on both success paths.
  - In `resumePaired`, on `401` or `403` from `/auth/station`, delete `token`, `device_id` and `device_type`, then start a new pairing request.
  - On a `429` or `503` from create, retry once after `details.retry_after_ms`, then show the button.
  - Extend the `#94` static check: `resumePaired` contains `deleteKey(db, 'token')`, and both success paths write `device_id`. Do not add a test name.
- **Spec change:** v1.1 §8.2 (pairing paragraph); §8.4 unchanged.

### 4. Store and return `branch_name` (M78)

- **Where:** `apps/hub/src/config/schema.ts` (`provisioned`), `apps/hub/src/setup/provision.ts` (step 7 config write), `apps/hub/src/auth/pairing.ts:193`, `apps/hub/src/auth/pair-requests.ts:70`, `apps/hub/src/ws/catch-up.ts:53,57`.
- **Fix:**
  - Add `branch_name: z.string()` to `provisioned`, and write `data.branch_name` there at setup.
  - The three readers use `deps.config.provisioned.branch_name` instead of `''`.
  - Update the test configs that build `provisioned`.
  - Tests: `[00 §10 #132]`.
- **Spec change:** v1.1 M78, §3.10, §6.4, §6.8, §6.31.

### 5. Derive `pairing_source` from `device_type` (M80)

- **Where:** `apps/hub/src/queries/devices.ts`, the `CASE WHEN EXISTS (… pairing_tokens …)` expression.
- **Fix:** `CASE WHEN d.device_type IN ('tablet','phone') THEN 'token' ELSE 'request' END`. The statement count stays at 1 (`#45`). Tests: `[00 §10 #134]`; delete the `pairing_tokens` row before the query.
- **Spec change:** v1.1 M80, §6.17.

### 6. `#53` title still says 429

- **Where:** `apps/cloud/test/owner-auth/login.int.test.ts:34`.
- **Fix:** rename the test to the v1.1 §10 #53 text: `… the 10th failure sets login_locked_until and still answers 401 LOGIN_INVALID`. The body stays as it is.
- **Spec change:** v1.1 §10 #53 (editorial).

### 7. `#114` does not cover `/auth/pin`

- **Where:** `apps/hub/test/auth/staff-session.int.test.ts:237` (`[00 §6.9] STAFF_NOT_FOUND on /auth/pin`) and `apps/hub/test/auth/admin-session.int.test.ts:179` (`[00 §10 #114]`).
- **Fix:** move the `/auth/pin` assertion into the `#114` test, including the `details.staff_id` check from `dacea3c`, and delete the `[00 §6.9]` duplicate. `grep '§10 #114'` must still find exactly one test (§12.1).
- **Spec change:** no.

### 8. Task 50: systemd unit and smoke script

- **Where:** create `apps/hub/deploy/hub.service`, `apps/hub/test/smoke/{smoke.ts,README.md}`; add the `smoke` script to `apps/hub/package.json`; modify `apps/hub/src/main.ts`.
- **Fix:**
  - The unit follows plan task 50 as amended: `WorkingDirectory=/opt/pos-hub/apps/hub`, `ExecStart=/usr/bin/node --import tsx src/main.ts`. Leave the other lines as written.
  - `main.ts` reads `process.env.POS_HUB_CONFIG ?? DEFAULT_CONFIG_PATH`, as the CLI does (§7.7).
  - `smoke.ts` prints one `[00 §10 #79]` line per §7.8 target (`/auth/pin` p95 ≤ 300 ms, no-op command p95 ≤ 5 ms, the 1 M-event boot ≤ 5 s through the #100 fixture) and exits 1 on any miss.
  - Done when `systemd-analyze verify apps/hub/deploy/hub.service` is clean and `pnpm --filter @pos/hub smoke` runs on a dev machine. The owner runs it on the mini PC.
- **Spec change:** no (M13, M36, §7.8; plan task 50 interface updated).

### 9. Build log and commit citations

- **Where:** `docs/reviews/build-log.md`, plus every commit for items 1–8.
- **Fix:**
  - Append one build-log entry for build review 1's fixes (the 8 commits `8b061c7`..`e15ca13`) and one per item here, in the existing format (commit, tests, rulings).
  - Every new commit cites its spec section, e.g. `fix(00): approve a screen by display code [spec 00 M79, §6.32]`.
  - Do not rewrite the eight existing commits.
- **Spec change:** no.
