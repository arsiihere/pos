CHANGES NEEDED

# 01a auto review — batch 11 (tasks 47–51)

Reviewer: independent, did not write this code. Commits reviewed: `3bc952d` (47), `283e8c0` (48), `a50108d` (49), `cb12474` (50), `8bdcb97` (51), against plan tasks 47–51 and spec 01 v1.0 §6.17, §6.17a, §6.18a, §6.18b, S14, S18, S33, S41, S44, S45, tests 59–65, 130, 133, 134, 143–145, 147, 149.

## Verification run by the reviewer

- `pnpm test`: **122 files, 462 tests passed, 0 failed** (121 s). Matches the batch report (445 → 462).
- `pnpm lint`: `eslint .` exits clean, no warnings or errors.
- Every numbered test in the batch (#59–65, #130, #133, #134, #143, #144, #145, #147, #149) is cited by exactly one `[01a §10 #n]` title.
- Files: only the files in the plan's lists changed, plus `server.ts` registrations. Task 50 also edits `business-day.int.test.ts` and `set-precooked-stock.int.test.ts`, which are not in its Files list (see Nit 4). No `package.json` or lockfile change, so no new dependency.

## Answers to the batch report's questions

1. **Handlers append their own events.** This works. `writer.run` folds **every** event appended through `tx.append` before COMMIT and swaps only after COMMIT (`apps/hub/src/engine-host/writer.ts:63-85`). The route reads `event_ids` by seq after `handle` (`apps/hub/src/commands/route.ts:120-131`). So commit-then-swap (D45) and the response envelope are kept, and `opened_at` / `closed_at` are exactly the event's `recorded_at`, as §6.18a/b say. The handler-side `applyEvent` fold in the stock commands is used only for the result. The swapped state comes from the writer's own fold of the same events, so the two cannot diverge. Acceptable.
2. **Check order (§6.17).** It is correct. §6.17's script (spec line 677) puts "config present → a business day is open → each entry…", and `stockItems` (`set-precooked-stock.ts:61-66`) follows that order. The plan's wording is ambiguous; the spec wins.
3. **`set_at` for an `added` entry.** Returning the unchanged count time follows S45 ("`set_at` is unchanged") and S40 N8. Acceptable.
4. **`not_open` before any day.** Returning `null` for all three fields is a reasonable reading of §6.18b's result shape. Acceptable.
5–9. Checked and agreed. The two hand-broken lines in task 51 cover code paths the tests do reach.

## Spec conformance (checked, no finding)

- §6.18a: strict `{}` payload; `already_open` when `business_day` is non-null and `closed_at` is null; `BusinessDayOpened { business_date, units }` with `stream_type 'hub'`, `stream_id = branch_id`; `units` holds only stock-tracked items and is empty with no config (`open-business-day.ts:20-56`).
- §6.18b: `not_open` / `opened_recently` / `closed`. The gap comes from `branchConfig()?.day_min_gap_hours ?? DEFAULT_DAY_MIN_GAP_HOURS`. The strict `<` lets a close at exactly 4 h through (#143) and makes a negative age count as recent (#144) (`close-business-day.ts:20-42`).
- §6.17: entries 1–200, `on_hand` 0…1 000 000, duplicates → 400 via `superRefine`, every entry checked before any append, one `StockSet` per entry with `unit = dayUnits(state, item).stock_unit`, result fields from `availableStock` / `stockLevel` (`set-precooked-stock.ts:10-47, 76-88`).
- §6.17a: the same checks; `countIsValid(stockOf(...), openDayStartMs(...), { carries_over, stock_unit: dayUnits(...) })` picks `StockAdded` or `StockSet { on_hand: quantity }`; `recorded_as` is in the result (`add-precooked-stock.ts:25-58`). Because a `StockAdded` is only written when the units match, S14's mismatch throw cannot fire.
- S44 frozen units: `dayUnits` reads `business_day.units` only while a day is open (`packages/engine/src/stock.ts:19-27`); #149 covers both the mid-day change and the new-item fallback.
- D54 / tenant scoping: the route checks `tenant_id` / `branch_id` against `provisioned` (`route.ts:78-80`), and events carry `ctx.branch.branchId`. No new SQL in the handlers.
- Security: no logging added; no PINs, hashes or secrets touched; no client code in this batch.

## Blocker

None.

## Should-fix

1. **#133 and #145 do not test "without `manage-stock` → 403" for `OpenBusinessDay` / `CloseBusinessDay`.**
   `apps/hub/test/commands/business-day.int.test.ts:55-58` and `:179-182` send the command as `S_CASH`. `R_CASH` lacks `access-hub-admin` (`apps/hub/test/helpers/fixtures.ts:40-48`), so the admin route guard refuses the request before the command's own permission check runs. The batch report says the same in item 8.
   *Failure scenario:* if `open-business-day.ts:18` or `close-business-day.ts:17` declared `permission: 'access-hub-admin'` (or any permission other than `manage-stock`), both tests would still pass. A head cook whose custom role (01b) has `access-hub-admin` but not `manage-stock` could then open or close the business day. That breaks S18 and §6.18a/b's permission column (spec §12 table, lines 1200-1201).
   *Fix:* do what #63 and #130 already do. Seed the directory with `S_OWNER.denied_permissions = ['manage-stock']`, send both commands as `S_OWNER`, and assert `403`, `error.code === 'PERMISSION_DENIED'` and `error.details.permission === 'manage-stock'`. The S_CASH request can stay as an extra guard check. Test-only change.

## Nits

1. **The expected `business_date` is computed with the same algorithm as the code** (`business-day.int.test.ts:27, 227, 332-335` is a copy of `open-business-day.ts:62-65`). On a UTC CI runner, a UTC-based implementation (`toISOString().slice(0, 10)`) would also pass. *Fix:* assert the literals `'2026-10-25'` and `'2026-10-26'`; the clocks are already built from local `new Date(2026, 9, 25, h)`.
2. **#133's "restart" clause is a direct `foldEngineEvents` call** (`business-day.int.test.ts:47`), not a real restart. #147 does cover a real `boot()` restart, so this is only a naming gap. *Fix:* call it a "boot step 3 fold" in the comment, or point to #147.
3. **#63's "the Manager default role has it" uses the test fixture's `R_MGR`** (`set-precooked-stock.int.test.ts:94-103`; `fixtures.ts:34-39`), not `apps/cloud/src/modules/staff-roles/default-roles.ts`. The real default (line 28) does include `manage-stock`, but this test would not notice if it stopped. *Fix:* assert on `defaultRoles` in `apps/cloud/test/default-roles.test.ts`, or reword the title.
4. **Task 50 edits two test files outside its Files list** (`business-day.int.test.ts`, `set-precooked-stock.int.test.ts`). The edits are test-only, small and recorded in the commit message (D3). *Fix:* none needed now. Next time, add the files to the plan's Files list when a clause is deferred.
5. **Dead fallback** `setAt ?? now` at `apps/hub/src/commands/add-precooked-stock.ts:54`. An `added` entry always has a non-null `set_at`, because `countIsValid` is false when `set_at` is null. *Fix:* use a non-null assertion, or leave a one-line comment saying why it cannot be null.
