APPROVE

# Build review 3 — module 00, build review 2 items 1–9 and task 61

| Field | Value |
|---|---|
| Range | `e15ca13` (excluded) .. `2a70ac5` — 12 commits (`7b6a143` docs, then `12eba2a` … `2a70ac5`) |
| Spec | `docs/specs/00_Hub_Platform_Access_Spec_v1.1.md`, only the sections the commits cite (M72, M73, M78–M80, §3.7, §3.9, §3.10, §6.4, §6.8, §6.17, §6.31, §6.32, §6.34, §7.7, §7.8, §8.2, §8.4, §10 #53/#79/#114/#132–#134, §12.1) |
| Fix list | `docs/reviews/00_build_review_2.md` items 1–9, plus task 61 (build-log line 286) |
| Tests at `2a70ac5` | 254/254 (hub + packages 219, cloud 35, 1 M fixture included), `pnpm lint` 0, `pnpm -r typecheck` clean — as reported in build-log line 286; not re-run for this review |
| Verdict | **APPROVE.** No blocker. Four should-fix items below; fix S1 before the pilot. S2 and S3 matter only once a real hub exists |

Reviewer note: the same session that wrote this code wrote this review, at the owner's request. The reviewer judged the diffs and cited spec text, not the build log's claims; the test counts above come from the log.

## Item status

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Recovery CLI runnable through pnpm (M72, §6.34) | **Resolved** | `apps/hub/package.json:19` `tsx` in `dependencies`; `apps/hub/test/setup/issue-admin-bootstrap.int.test.ts:70` spawns the real `pnpm --filter @pos/hub issue-admin-bootstrap` |
| 2 | Admin pages without credentials; approve by display code (M79) | **Resolved** | `apps/hub/src/commands/approve-pairing-request.ts:150` group `admin-bootstrap`, page embeds only `tenant_id`/`branch_id`; `:13` `request_id` optional; `:246–253` exactly-one pending match else `undefined` → 404; `:138` no-credential message; `:143` `'hub-admin'` for bootstrap; `apps/hub/src/auth/admin-bootstrap.ts:37–38`; test `approve-pairing-request.int.test.ts:154` (#133). See S1, S4 |
| 3 | Pair page stores `device_id`, recovers from a dead token | **Resolved** (to the fix-list scope) | `apps/hub/src/auth/pair-page.ts:51–62` `resumePaired` wipes `token`/`device_id`/`device_type` on 401/403 and returns false; `:76` one retry after `retry_after_ms`; `:118`, `:171` write `device_id`; test `pairing.int.test.ts:169` (#94). See S2, N3 |
| 4 | `branch_name` in config (M78) | **Resolved** | `apps/hub/src/config/schema.ts:36`; `setup/provision.ts:120`; `auth/pairing.ts:126,169,194`; `auth/pair-requests.ts:70`; `ws/server.ts:157`; `ws/catch-up.ts:55,59`; test `provision.int.test.ts:28` (#132). See S3 |
| 5 | `pairing_source` from `device_type` (M80) | **Resolved** | `apps/hub/src/queries/devices.ts:24`, still one statement; test `access-queries.int.test.ts:18` (#134) |
| 6 | #53 title (M73) | **Resolved** | `apps/cloud/test/owner-auth/login.int.test.ts:34` |
| 7 | #114 covers `/auth/pin` | **Resolved** | `apps/hub/test/auth/admin-session.int.test.ts:179`; the `[00 §6.9]` duplicate is gone; exactly one `[00 §10 #114]` test |
| 8 | Task 50: systemd unit, smoke | **Resolved**, hardware run pending | `apps/hub/deploy/hub.service:9,11`; `apps/hub/src/main.ts:5`; `apps/hub/test/smoke/smoke.ts`, `README.md`; `eslint.config.js:98` (narrow clock-ban exception); tests `boot/main.int.test.ts:14`, `smoke/smoke-report.test.ts:5`. Dev-box `command_p95` ≈ 7 ms vs 5 ms is recorded as a gap (build-log line 266), as §12.1 allows. #79 on the mini PC is the owner's |
| 9 | Build log, citations, lint | **Resolved** | `docs/reviews/build-log.md:240–286` (one entry per task, plus a late entry for `8b061c7`..`e15ca13` at `:272`); every code commit in the range cites a spec section; `apply-directory.int.test.ts:117`, `restore.int.test.ts:229` use a `const` holder, and the rule stays on |
| 61 | No test commands in the production hub | **Resolved** | `apps/hub/src/server.ts:83–88,122`; `commands/route.ts:46–49`; `lib/boot.ts:158` calls `buildHubServer(deps)` and `BootOptions` has no field for it, so `main.ts` cannot enable them; only `test/helpers/test-hub.ts:85` passes `{ testCommands: true }`; test `boot/boot.int.test.ts:55` → `404 ROUTE_NOT_FOUND`, no `TestNooped` row |

## New violations of foundation §6

| # | Class | Finding |
|---|---|---|
| S1 | **Should-fix** | **§6.7: `ApprovePairingRequest` has no retransmit test.** §6.7 asks every hub command for a happy path, one test per error code, and a retransmit test (D32). `apps/hub/test/commands/approve-pairing-request.int.test.ts` sends each approval with a fresh `command_id`; "replay" appears 0 times in the file, and no other test file calls this command. The gap predates this range, but `58d70ea` adds a second lookup path (code only, `:246`) that has never been retransmitted. Add one case: send the same `command_id` twice by code only; expect the same body with `Idempotent-Replay: true` and one `DevicePaired`. |

Checked, and no other §6 violation found: §6.1 (the HTML page routes follow the existing `/pair` and `/setup` pattern), §6.2 (no new codes; `details` unchanged), §6.3 (the code lookup is one statement inside the command transaction), §6.6, §6.7 determinism (only the smoke entry is exempted, next to `main.ts` and the CLIs), §6.8 (no migration), §6.9 (`apps/hub/deploy/` is M36; `test/smoke/` is a test folder).

## Other findings (spec 00, not foundation §6)

| # | Class | Finding |
|---|---|---|
| S2 | **Should-fix** | **A screen that reloads while the hub is down stays blank.** In `pair-page.ts:54` (`resumePaired`), and in the poll `tick`, `fetch` has no rejection handler. After a power loss (E5) the kiosk and KDS often reload before the hub opens HTTP (boot step 7), so `fetch` rejects with connection refused, the promise chain dies, and the screen stays empty until someone reloads it by hand. Fix: on a network error, retry with backoff (≤ 5 s, as §8.4 says for WS drops) instead of giving up. |
| S3 | **Should-fix** | **A config written before `7d021a2` no longer boots.** `config/schema.ts:36` makes `provisioned.branch_name` required. A hub provisioned under v1.0.1 fails boot step 0 with `ConfigError`, and `hub.service` (`Restart=always`, `RestartSec=1`) loops on it. §3.10 forbids the installer from editing `provisioned`, so there is no supported repair. No hub is deployed yet, so this is not a blocker. Before the pilot, either release-gate it ("re-provision any hub set up before v1.1"), or make the field optional with `''` until 06 refreshes it. Either choice needs an owner decision, and the second also needs a spec note in §3.10. |
| S4 | **Should-fix** | **A failed admin login on the approve page shows nothing.** At `approve-pairing-request.ts:75–77`, a non-200 `/admin/auth` only sets `screen.dataset.error`. A mistyped PIN, `PIN_LOCKED_OUT` or `DEVICE_LOCKED_OUT` leaves the form as it was with no message. §8.4 requires `attempts_remaining` for `PIN_INVALID` and time left for lockouts. |
| N1 | Nit | `apps/hub/test/smoke/smoke.ts:25` prints the literal `[00 §10 #79]`, so the §12.1 check "`grep` finds exactly one test per number" counts 2 for #79. Only one is a test (`smoke-report.test.ts:5`). Build the tag from parts, or have the grep look only at `it('` lines. |
| N2 | Nit | `?? ''` fallbacks for `branch_name` at `pairing.ts:126,169`, `pair-requests.ts:70`, `ws/server.ts:157` are dead code now that the schema requires the field. They can be dropped if S3 keeps the field required. |
| N3 | Nit | `pair-page.ts:62`: a non-KDS screen resumes to the `login` placeholder without checking its token, so a revoked kiosk is not noticed until the login UI (02, §8.3) calls the roster and gets 401/403. This is out of 00's built scope; note it for 02. |
| N4 | Nit | The approve page sends `device_id: undefined` → `400` on a device paired before `5b75d9f`, because no `device_id` is in IndexedDB. This affects development devices only. |
| N5 | Nit | Running the smoke on the mini PC needs the repo's `test/` tree and dev dependencies under `/opt/pos-hub`. `apps/hub/test/smoke/README.md` doesn't say so. |

## Recommended order

S1 (one test), S4 and S2 (pages, small), then decide S3 before the first pilot install. Nits as convenient.
