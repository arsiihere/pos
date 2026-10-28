CHANGES NEEDED

# 01a auto review: batch 16

Reviewer: independent, read-only. Scope: task 68 (`8f34f02`), task 69 (`80294d2`) and task 70 (`aa1a90c`). Task 71 is a STOP (needs hardware) and has no commit. For each task I read the plan section (`docs/plans/01a-plan.md:1058-1083`), D5 and D7 (`docs/reviews/01a-auto/decisions.md:11-18`), the spec sections the tasks cite (§6.17–§6.19, §6.21, §8.2, and §10 #77, #102, #103, #132, #133, #137, #146), and each diff.

## Verification (run by me)

- `pnpm test`: **148 files, 555 tests: 554 passed, 1 failed** (122 s). The failure is `[00 §10 #63] seq gap-free across 1 000 appends with forced rollbacks` (`apps/hub/test/engine-host/append-events.int.test.ts:19`), which hit vitest's 5 000 ms timeout under full-suite load. No commit in this batch touches that file or `appendEvents`. Run on its own (`npx vitest run test/engine-host/append-events.int.test.ts`), it passes: 3/3 in 3.2 s. So it is a load-dependent timeout in module 00, not a regression from this batch. The total (555) matches the batch report.
- `pnpm lint` (`eslint .`): clean.

## What I checked

**Task 68 (hub-admin, login, D5, D7)**
- The paths and headers match 00:
  - `/admin/login-roster` and `/admin/auth` (`apps/hub/src/auth/admin-session.ts:31,123`);
  - `Authorization: Bearer <device token>`;
  - `X-Admin-Session`;
  - IndexedDB `pos-device` / `device` with keys `token` and `device_id`, as in `pair-page.ts`;
  - `sessionStorage` `admin_session_token`.
- `readDeviceToken` and `readDeviceId` can be injected (R10).
- The signed-out set (`ADMIN_SESSION_REQUIRED`, `SESSION_EXPIRED`) covers every code the admin guard throws for a missing, idle or ended session (`guards.ts:235-242`, `admin-session.ts:92-116`).
- The client-synthesised `HUB_NOT_PROVISIONED` is a catalogue code (`packages/domain/src/errors.ts:41`).
- D7:
  - `config-status.ts:28-29` returns the provisioned `tenant_id` and `branch_id`, or `null` on an unprovisioned hub;
  - `config-status.int.test.ts` shows that a command built from them gets a `200` (`changed: true`).
  - The §6.21 text patch is parked (`parked.md:10`).
- D5:
  - `packages/events/src/admin/hub.ts` imports only zod;
  - `stock.int.test.ts` parses real roster, auth, stock (full and unchanged) and all five command answers. `toEqual(parse(x))` also catches extra keys.
- No `package.json` or lockfile changed in the batch (`git diff b5f9953 HEAD --stat -- '*package.json' pnpm-lock.yaml` is empty).
- The out-of-list files are exactly the ones D5 and D7 allow.

**Task 69 (table, status, poll, hours)**
- §6.19 polling:
  - `meta_version` and `stock_version` are sent after the first answer;
  - an `unchanged` answer keeps the rows (`StockApp.tsx:92-95`);
  - the refresh runs every 15 000 ms while the page is visible (`:98-104`).
- Drafts are kept apart from the server rows, so a refresh never overwrites a typed value (Review Focus 4, covered by a test).
- Save counts sends every touched row in config order. The `command_id` is reused while the entries are identical and renewed after a success (D32).
- The hours badge:
  - uses `isOrderableByTime` with `createHubClock(hub_time)`, which runs on `performance.now` (S47);
  - is re-evaluated every 60 000 ms;
  - never shows for an item that is Off, because Off wins.
- "Off since" shows only when `unavailable_since < business_day_started_at` (S30).
- The status-line and banner texts match §8.2 / §6.21 word for word, including `apply_failed` and `not_ready`.
- The plan's 9 tests each exist once. Each tests its stated case and would fail without the code. For example, #77 sends an edit back to the same number and checks `I1` is in the payload; #137 sets the system time 3 h wrong.

**Task 70 (business day, Add)**
- Start day:
  - sits above the rows whenever `business_day_started_at` is null;
  - one tap sends `OpenBusinessDay {}` with no confirmation.
- A save answered `409 BUSINESS_DAY_NOT_OPEN` shows the retry action. After the tap the save is re-sent with the same `command_id` (test checks `sentCommands[2].command_id === sentCommands[0].command_id`).
- Close day asks for confirmation first.
- Close and start new day sends two commands with two different `command_id`s. Keep this day open hides the prompt.
- Add sends one `AddPrecookedStock` entry for that row, in the stock unit (1.5 kg → 1500).
- Review Focus 6 is covered: after another device closes the day, the next refresh shows Start day and Available 0, and the typed counts stay.

**Standards and security**
- There is no `dangerouslySetInnerHTML`, `innerHTML`, `style=`, CSS import, `console.*` or `randomUUID` in `features/admin`, `hub-admin.ts` or `hub-clock.ts`.
- All names render as React text.
- No token or PIN is logged.
- Tenant ids come from the hub, and the hub re-checks them (BRANCH_MISMATCH).
- The client's `Date.now()` calls (`occurred_at`, the roster lock) are allowed in browser code (plan Global Constraints).

## Blocker

None.

## Should-fix

1. **A refused stock query leaves a blank page with no message.** `apps/client/src/features/admin/stock/StockApp.tsx:80-84`.
   - **Failure:** a staff member has `access-hub-admin` (so they appear on the roster and can sign in, `admin-session.ts:133`) but not `manage-stock`. `GET /admin/queries/stock` answers `403 PERMISSION_DENIED` (`apps/hub/src/queries/stock.ts:101-102`). `refresh` returns without setting anything, so `clock` stays `null`. The page then shows only the title, the status line and a Save counts button. Tapping Save says "Change or confirm a count first." The `admin_stock.errors.PERMISSION_DENIED` text that task 68 added for this page is never shown on this path. Any other API error on the query (`409 HUB_NOT_PROVISIONED`, `500`) is swallowed the same way.
   - **Fix:** in `refresh`, when `!stock.ok` and `stock.error.kind === 'api'`, call `setMessage(errorMessage(stock.error))`, and clear it on the next good answer. Add a test `[01a §8.2] a 403 on the stock query shows the permission text`.

2. **Two §8.2 differences are not in the parked list.** `apps/client/src/i18n/en.ts:51` and `apps/client/src/features/admin/stock/StockTable.tsx:77-81`.
   - **Failure:** §8.2 says the `opened_recently` text names `<day_min_gap_hours>`, but the page says "only a short time ago". The category filter shows raw `category_id` values (ULIDs) as option labels. Both are real spec gaps: §6.19 and §6.18b return neither value. The batch report explains them (item 3), but they are not in `docs/reviews/01a-auto/parked.md`, where §6.21 / D7 and §7.8 / D6 are tracked for the next spec patch. CLAUDE.md says code must never diverge from the spec without the gap being tracked, so they can be lost after this batch.
   - **Fix:** add one line each to `parked.md`:
     - "[spec gap, §6.19/§8.2] add `category_name` to `items_meta`";
     - "[spec gap, §6.19/§6.18b/§8.2] return `day_min_gap_hours` so the `opened_recently` text can name it".
     
     Then patch the spec first and the page after.

## Nit

1. **Duplicate test number.** `BusinessDay.test.tsx:194` and `:246` are both named `[01a §10 #133 page part]`, but each number must appear in exactly one test (Global Constraints, Tests). Rename the second to `[01a §8.2, S33] one tap on Start day …; opened_recently …`.
2. **Roster lock uses the device clock.** `AdminLogin.tsx:32` compares the hub's `locked_until` with the device's `Date.now()`. The roster already sends `null` for expired locks (`admin-session.ts:131`), so a device clock 3 h fast shows a locked staff member as unlocked. Use `locked: s.locked_until !== null`.
3. **The Add retry after a 409 is not tested.** `StockApp.tsx:162,189`: §8.2 covers "a Save counts or Add" answered `409`, but only the save retry has a test. Add a case: Add → 409 → Start day → the same `command_id` is re-sent.
4. **Out-of-order refreshes.** `StockApp.tsx:72-96`: a post-save `refresh()` and the 15 s interval refresh can be in flight together. If the older answer lands last, it overwrites the rows and `versions`. Keep a sequence ref, as `MenuView`'s `latest` does, and drop answers older than the newest request.
5. **Day line turns warn a minute early.** `BusinessDayBar.tsx:45`: `floor(hours) >= staleAfterHours` turns the line warn at exactly 16 h 0 min, but `day_stale` only becomes true after 16 h (§6.19 uses `>`). Use the raw age: `clock.nowMs() - day.opened_at > staleAfterHours * 3_600_000`.
