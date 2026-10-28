CHANGES NEEDED

# 01a auto review — batch 14 (tasks 60–64)

Reviewer: independent session, no code changed. Commits reviewed: `f020a1b` (60), `4e1c307` (61), `2ffdc21` (62), `a6300b2` (63), `b5c5c3d` (64), each against its plan section (`docs/plans/01a-plan.md:983-1024`) and the cited spec sections (S35, S37, S39 d/e, S44, §7.7, §7.8, §8.1, §10 #74/#76; S7 and §6 shared failures for the error paths).

## Verification run by the reviewer

- `pnpm test`: **139 files, 519 tests passed**. This matches the batch report (502 → 519).
- `pnpm lint` (`eslint .`): clean, no output.
- `git diff 1a9f1e4 HEAD -- apps/client/package.json package.json pnpm-lock.yaml`: empty, so no new dependency (S35 g).
- Files per commit match each task's Files list. Task 64's `App.tsx` and `en.ts` edits are listed. `ship-client.sh` is mode 100755 in git.
- `ship-client.sh` runtime checks (no argument, dirty tree, missing build): **not run.** This harness also refused to execute the script, even inside a throwaway `/tmp` clone. I checked them by reading the code: `apps/hub/deploy/ship-client.sh:16-19` exits 2 with usage, `:25-27` reports "tree is dirty", and `:28-30` reports "build output missing". All three run before the first `ssh` at `:35`. They still have to run in the task 71 release drill.

## Spec conformance (summary)

- **Task 60**: §7.8 step 5 (a)–(e) are all in the script: (a) `:25-30`; (b) `is-active` at `:35`, before the first `tar` at `:51`; (c) `:44-48`; (d) staging into `admin-stock.new` at `:51-53`; (e) the `mv` swap and `.old` delete at `:56`. It uses only bash, git, tar and ssh, ships only `admin-stock`, and `set -euo pipefail` gives exit 0 only when every step succeeds.
- **Task 61**: the components take props and callbacks only and make no API calls (S35 i). `QuantityInput` uses `parseQuantity` and `formatQuantity` from `@pos/domain`, with `inputmode` numeric for pieces and decimal otherwise (S44). `BusyButton` shows the slow banner after `SLOW_AFTER_MS = 3_000`. The PIN is never rendered (`PinPad.tsx:30-33` shows dots only), and the test checks this at `components.test.tsx:63`.
- **Task 62**: `parseRupees` matches §8.1 / S40 N7 exactly (trim, strip commas, ASCII digits, at most 2 decimals). The paths in `cloud-admin.ts:294-350` match `apps/cloud/src/modules/restaurant/routes.ts:70-293`. The response interfaces match `restaurant/schemas.ts` and `owner-auth/schemas.ts`. Tokens are in sessionStorage. A `401 JWT_INVALID` triggers exactly one refresh and a retry with the same headers, so the same `Idempotency-Key` (`:254-269`); a second 401 calls `onLoggedOut`.
- **Task 63**: the branch picker shows the JWT's `allowed_branch_ids` as IDs (S37). The login error shows `errors.LOGIN_INVALID` text.
- **Task 64**: the floor editor follows S9 (name, sort number, archive/restore; no canvas). The key is made when the form opens, kept across a failed retry and renewed after a success (§8.1, #76). There is one primary button on the screen (`FloorsView.tsx:93`; the add-table button is not primary).
- **Numbered tests**: each plan-named test appears exactly once. #74 is `money.test.ts:5`; "Rs/₨" is `money.test.ts:14`; the 401 refresh test is `cloud-admin.test.ts:61`; the two task 63 tests are `App.test.tsx:49` and `:84`; #76 is `FloorsView.test.tsx:97`; the floors/toggle/PATCH test is `FloorsView.test.tsx:140`; the five task 61 tests are in `components.test.tsx`. Each one tests the stated case and imports a module that did not exist before its commit, so it failed first.
- **Security**: no `dangerouslySetInnerHTML` or `innerHTML`. Every server value is rendered as a React text child, and server `message` strings are never shown, only i18n text by code. There is no logging in the client. No PIN or token is rendered or logged. Tenant scoping stays server-side; the client only sends branch IDs from the JWT, and the server re-checks them (S19, S8).

## Blocker

None.

## Should-fix

1. **`IDEMPOTENCY_KEY_MISMATCH` traps the add form behind "Something went wrong. Try again."**
   - **Where:** `apps/client/src/i18n/en.ts` (no `errors.IDEMPOTENCY_KEY_MISMATCH`, so `errorKey` falls back to `errors.UNKNOWN`), `apps/client/src/features/owner/floors/FloorsView.tsx:75-80` and `:127-132`.
   - **Failure scenario:** this is the case §8.1 and F §6.4 are written for. The owner submits "Ground" on mobile data. The cloud commits, but the response is lost, so the client gets `network` and keeps the key (correct). The owner fixes a typo to "Ground floor" and submits again with the same key. The new request hash differs, so the cloud answers `422 IDEMPOTENCY_KEY_MISMATCH` (S7, §6 shared failures). The banner says "Something went wrong. Try again." Every retry sends the same key with the same changed body and gets the same 422. The view also never reloads after a failed create, so the floor that was created stays hidden. The form is stuck until the owner leaves the view. Every later creating form that uses `form.ts` (stations, programs, tax classes, categories, items) inherits this.
   - **Fix:** add an `errors.IDEMPOTENCY_KEY_MISMATCH` text, for example "This form was already saved with other values. The list is reloaded; check it before adding again." In `form.ts`, or in each add form on that code, call `renew()` and reload the list. Add a test: network failure, edit the field, the second submit gets a 422, then the list is reloaded and the next submit carries a new key. A request with a different body is not a retry of the same form submission, so renewing the key here does not conflict with §8.1's "keeps it across retries".

2. **The code diverges from §7.7 without a recorded ruling: the client uses hand-written TS interfaces, not "@pos/events schemas".**
   - **Where:** `apps/client/src/api/cloud-admin.ts:26-166`; spec `01_Restaurant_Setup_Spec_v1.0.md:781` ("`src/api/{cloud-admin,hub-admin}.ts` (typed fetch clients using `@pos/events` schemas)").
   - **Failure scenario:** the batch report (item 3) admits the divergence. `@pos/events` has no admin response schemas, and the client may not import `apps/cloud`, so the interfaces copy `restaurant/schemas.ts` by hand. When a cloud schema changes, the client type silently drifts and no test catches it. CLAUDE.md says "If code and spec disagree, STOP and ask; never silently diverge." Reporting it in a batch note is not a ruling. Task 66+ (`hub-admin.ts`) will repeat the same pattern.
   - **Fix:** get an owner ruling, recorded as a decision (like D4) or as a plan note. Option (a): accept TS interfaces for 01a and note it in the plan. Option (b): spec-first, move the admin response Zod schemas into `@pos/events` and have both the cloud routes and `cloud-admin.ts` use them. Do this before `hub-admin.ts` is written. Until then, change no code.

## Nits

1. **`IP_LOCKED_OUT` has no text.**
   - **Where:** `apps/client/src/i18n/en.ts` has `errors.LOGIN_LOCKED_OUT`, but the cloud login throws `IP_LOCKED_OUT` (`apps/cloud/src/modules/owner-auth/service.ts:127`). `LOGIN_LOCKED_OUT` is not thrown anywhere in `apps/cloud/src`.
   - **Failure scenario:** a locked-out owner sees "Something went wrong. Try again." and keeps retrying into the lockout.
   - **Fix:** add `errors.IP_LOCKED_OUT` with the same text as `LOGIN_LOCKED_OUT`.

2. **`ship-client.sh` treats every state except `active` as stopped.**
   - **Where:** `apps/hub/deploy/ship-client.sh:39`. `systemctl is-active` also prints `activating`, `deactivating` and `reloading`.
   - **Failure scenario:** with `Restart=always`, a hub inside its restart delay after a crash reports `activating`. The script ships, the hub then boots, and it may load the page mid-swap.
   - **Fix:** this follows §7.8 (b) literally, so the change has to go spec-first: refuse unless the state is `inactive` or `failed`. Otherwise, note the case in the task 71 drill.

3. **A rejected rename keeps the refused text in the field.**
   - **Where:** `apps/client/src/features/owner/floors/FloorsView.tsx:26` and `:45`. `useEffect(() => setText(value), [value])` does not fire when the reload returns the same `value`.
   - **Failure scenario:** a `409 CONFIG_NAME_TAKEN` leaves the field showing the refused name, so the screen disagrees with the server; only the banner says otherwise.
   - **Fix:** reset the text on a failed commit. For example, have `onCommit` return a promise of success and call `setText(value)` on failure, or key the field on a reload counter.

4. **Concurrent logouts call `onLoggedOut` several times.**
   - **Where:** `apps/client/src/api/cloud-admin.ts:248-252` and `:262`.
   - **Failure scenario:** N parallel calls all await the same failed refresh, and each calls `loggedOut()`. The result is harmless today (`navigate('/login')` runs N times), but it would not be harmless if `onLoggedOut` gains side effects.
   - **Fix:** call `onLoggedOut` once per failed refresh, for example by having `refreshOnce` handle logout when it fails.

5. **The `"L"` check in the `QuantityInput` test is weak.**
   - **Where:** `apps/client/src/components/components.test.tsx:168`. `toContain('L')` would pass on any capital L in the rendered text.
   - **Failure scenario:** a regression that drops the unit label would go unnoticed if any other capital L were rendered.
   - **Fix:** assert on the label element itself, for example `container.querySelector('.pos-row span')?.textContent === 'L'`.
