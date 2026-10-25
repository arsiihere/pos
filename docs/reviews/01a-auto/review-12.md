APPROVE

# 01a auto review — batch 12 (tasks 52–56)

Reviewer: independent; I did not write this code. Commits reviewed: `77b599b` (52), `249b70f` (53), `2d64fcb` (54), `f946fcc` (55), `244558a` (56). I checked them against plan tasks 52–56 and spec 01 v1.0 §4.5, §6.18, §6.19, §6.21, §6.23, S17, S29, S30, S33, S41, S43, S46, S47 and §10 tests 56, 69–73, 89–92, 102, 103, 116, 131, 132, 142, 145 (push clause), 146, 151, 152.

## Verification run by the reviewer

- `pnpm test`: **128 files, 490 tests, all passed** (108.7 s). This matches the batch report (462 → 490).
- `pnpm lint` (`eslint .`): **0 errors, 0 warnings**.

## What was checked

**Scope.** Each commit touches only the Files list of its task, plus `apps/hub/src/server.ts`, which every task is allowed to modify. No package.json or lockfile changed. Commit subjects match the plan and cite the spec sections.

**Task 52, §6.18 / S17** (`apps/hub/src/commands/set-item-availability.ts`)
- The command uses `sessionKind: 'admin'` and `manage-stock` (:16–17), as §6 Batch 4 / S18 require.
- With no config, or an unknown item, it answers `404 MENU_ITEM_NOT_FOUND { item_id }` (:21–23).
- It reads the current state with `itemAvailability`, so a missing row counts as available (:24). If the state is unchanged it appends nothing.
- Otherwise it appends one `ItemMadeUnavailable` or `ItemMadeAvailable` on the `stock` stream (:27–38). The writer's projection updates `item_availability` in the same transaction; #69 checks the row's `changed_at` against `recorded_at`.
- The result has the shape `{ item_id, is_available, changed }` (:41).
- The event fields (`occurred_at` from the clock, actor, device) follow the same pattern as `set-precooked-stock.ts:31–38`.
- Tests #69, #70 and #71 are each present once and cover every clause, including replay with the `idempotent-replay` header, the 403 details and the 1-statement read for 1 and for 100 ids.

**Task 53, §6.19** (`apps/hub/src/queries/stock.ts`)
- `meta_version` is `config_version.openDayStartMs ?? 0` (:27).
- `unchanged` requires both versions to match (:33). `items_meta` is sent only when `meta_version` differs (:46). `items` is sent when either version differs (:47).
- `offSince` is a single `json_each` statement and returns early when there are no items (:105–115). So the costs are: no config → 0 statements, unchanged → 0, items part → 1.
- `day_stale` uses `now − opened_at > hours × 3 600 000` on the open day only (:44).
- `unavailable_since` comes from `changed_at` (S30). `available` and `level` come from the engine functions (S41, S46), with `business_day_started_at` passed in.
- `hub_time` and `hub_local_date` come from the injected clock; there is no `in_window` field.
- `stock_version` is moved after COMMIT by `noteCommitted` (`lib/boot.ts:312`). At boot it is set by the step-3 fold (`sync/boot-steps.ts:44,60`) from the same scan, as §6.19 requires.
- `session: 'none'` follows plan R43. Admin routes take their session from the admin guard; `session` only gates device sessions (`queries/registry.ts:105`). So the in-handler `manage-stock` check (:98–102) is reached with a real session, and it returns the same 403 shape as the command route.
- Tests #72, #103, #116, #131, #132, #142, #146, #152, the S44 test, the 403 test and `hub-time.test.ts` are each present once. They assert statement counts on `readDb`, and every version transition #152 lists.

**Task 54, §6.21 / S29 / S43** (`apps/hub/src/queries/config-status.ts`)
- The data comes from 2 primary-key reads (`readBranchConfigRow` and `staff_directory_meta`), plus the poller's memory. #56 asserts 2 statements.
- Fields are `null` before the first apply. There is no `config_epoch` or `epoch_changed_at` field.
- Permission is `access-hub-admin`, enforced by the admin guard.
- #56, #102 (server part), `not_ready` and `apply_failed` are each tested once. The `apply_failed` test also checks that the problem clears after a successful re-poll.

**Task 55, §4.5** (`ws/restaurant-audiences.ts`, `ws/restaurant-catch-up.ts`)
- The audiences match the §4.5 table exactly: `BranchConfigApplied` goes to both socket kinds; the six stock and day events go to `staff` only.
- `branch_config` is `null` before the first apply, otherwise `{ config_version, snapshot_hash, hub_time }`.
- `availability` is 1 sorted statement on `is_available = 0`.
- `stock` covers stock-tracked config items only. `unit` comes from `dayUnits`; `available` and `level` come from the engine.
- Tests #73, #89, #90, #91, the #145 push clause, the S47 test and the #116 catch-up clause are each present once.
- #90 is sound. Timers are faked and never advanced, so a push delayed by any timer would never arrive and the frame assertion would fail. The 5 s assertion is secondary.

**Task 56, §6.23** (`queries/branch-config.ts`)
- Settings are `sessionKind: 'device'`, `session: 'required'`, `allowStation: true`. The data comes from memory, with 0 statements.
- Before the first apply it returns `{ data: null }`.
- #92 covers a staff session, a station session, 0 statements and the 401 `SESSION_INVALID` from 00's guard. #151 covers `Asia/Karachi` → 18 000 000, and the catch-up part being null before any config.

**Foundation §6.** Responses use `{ data }` envelopes. Error codes come from the catalogue (`MENU_ITEM_NOT_FOUND`, `PERMISSION_DENIED`, `SESSION_INVALID`). Every time value comes from the injected `Clock`, never `Date.now()`; `hub-time.ts:5` reads only the OS time zone offset, which S47 requires. Commands go through the writer (commit, then swap, then publish).

**Security.** The hub DB holds one branch. The config-status read is keyed by the provisioned `branch_id`. Nothing new is logged: no tokens, no PIN data, no snapshot bodies. There is no client code in this batch, so no XSS surface. §6.23 returns the snapshot, which §6.23 says holds no secret.

## Blockers

None.

## Should-fix

None.

## Nits

1. **`unit` differs between the stock query and the catch-up `stock` part.**
   - Where: `apps/hub/src/queries/stock.ts:89` sends `entry.unit` (the `stockOf` value). `apps/hub/src/ws/restaurant-catch-up.ts:50` sends `dayUnits(state, item).stock_unit`.
   - Failure scenario: a stock-tracked item measured in `g` that was never counted. The stock query reports `unit: 'piece'` (the `stockOf` default), while the catch-up part reports `'g'`, which #89 asserts at `restaurant-ws.int.test.ts`. The same mismatch happens for a count taken before a unit change. A 02 client that reads `items[].unit` from §6.19 instead of `items_meta.stock_unit` would show the wrong unit. `available` is 0 in both cases, so no stock number is wrong.
   - §6.19 does not name the source of `unit` (it names only `on_hand`, `reserved` and `set_at`), so this is not a spec breach.
   - Fix: record an owner decision in `decisions.md`. Use `dayUnits(...).stock_unit` in §6.19 too, so it matches §4.5 and the command results' day unit (a one-line change at `stock.ts:89`). Add the wording at the next spec 01 revision.

2. **The stock query's `items` includes items that are not stock-tracked.**
   - Where: `apps/hub/src/queries/stock.ts:78–96`.
   - These rows carry `stockOf` defaults: `unit: 'piece'`, `available: 0`, `level: 'not_counted'`. §6.19 says the availability statement covers "the config's items", so this is allowed. But the page must filter `level` and `available` using `items_meta.is_stock_tracked`; otherwise every untracked item looks "not counted".
   - Fix: none needed in the hub. Make sure the task that builds the stock page (§8.2) has a component test where an untracked item shows no stock level and no alert.

3. **The catch-up parts live in a module-global registry, registered per server.**
   - Where: `apps/hub/src/server.ts` (`registerRestaurantCatchUp` plus its `onClose` hook) and `ws/catch-up.ts:23–28`.
   - Failure scenario: while two servers are alive in one process, every part is built twice per socket. The `availability` statement runs twice, and the last-registered server's clock provides `hub_time` for both. This happens in tests only: `stock.int.test.ts` #72 keeps two hubs alive at once (no WebSocket is opened there). Production runs one server per process, and the author reported this.
   - Fix (optional): have `registerRestaurantCatchUp` throw if parts are already registered, so a future double registration fails loudly instead of quietly doubling work.

4. **#152 uses shortcuts for two of its steps.**
   - Where: `apps/hub/test/queries/stock.int.test.ts`, #152.
   - The "after a config apply" step uses `swapBranchConfig`, not a real poll apply. The restart step calls `foldEngineEvents` directly, not `boot()`. Both are equivalent for what is asserted, because `meta_version` reads the holder and boot step 3 is exactly that fold. Still, a regression that leaves `setStockVersion` out of boot step 3 would not be caught here; it would be caught only if #147's setup asserts it.
   - Fix (optional): in #147 or #152, add one assertion that `stockVersion()` after a real `boot()` equals the last stock event's `seq`.

5. **#71 tests code from task 37.**
   - Where: `apps/hub/test/commands/set-item-availability.int.test.ts`, #71.
   - `itemAvailability` was built in task 37. #71 "failed first" only because its setup used the new route (404). The assertions themselves would pass on task 37's code, so #71 is not a regression test for task 52.
   - Fix: none needed; the case is tested once and correctly. This is noted only so the TDD claim in the batch report is read correctly.
