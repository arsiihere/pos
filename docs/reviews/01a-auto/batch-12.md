# 01a auto batch 12

Tasks committed since the batch 11 report (`c5c0584`). The batch 11 fix commits (`c20a6f4`, `aa4c04c`, `5749f7a`, `f39dfde`, reply `923bd6a`) came in between. They are review fixes, not tasks.

| Task | Commit | Progress commit |
|---|---|---|
| 52 Hub `SetItemAvailability`, `itemAvailability` | `77b599b` | `08cd248` |
| 53 Hub stock query — versions, parts, `day_stale`, `hub_time` | `249b70f` | `5d229a1` |
| 54 Hub config status | `2d64fcb` | `b4a3f5e` |
| 55 Hub WS audiences and catch-up parts | `f946fcc` | `87b30a8` |
| 56 Hub `GET /queries/branch-config` with `hub_time` | `244558a` | `6623131` |

**Tests:** 462 before, 490 after (`pnpm test`, 128 files, Postgres on 5433). Typecheck and lint passed after every task. Every new test failed first for the stated reason (a missing route, module or part), then passed. No STOP. No file outside a task's Files list was changed. Next task: 57 (`apps/client` scaffold).

## Things the reviewer should look at

1. **`unit` differs between the stock query and the catch-up `stock` part (tasks 53, 55).** In §6.19 `items[].unit`, I used the count's own unit (`stockOf(...).unit`), because `on_hand` is measured in it. §6.19 says only that `on_hand`, `reserved` and `set_at` come from `stockOf`. In §4.5 the catch-up part uses `dayUnits(state, item).stock_unit`, because §4.5 says "`unit` from `dayUnits`". The two values differ only in two cases. One is an item that was never counted: the query says `'piece'` (the `stockOf` default) and the catch-up says the real unit. The other is a count taken before a unit change. In both cases the count is invalid and `available` is 0. The page reads the day's units from `items_meta` anyway. Decide whether §6.19 should use `dayUnits` too; if so, the change is one line in `queries/stock.ts`.
2. **`hubTime` returns `0 - offset × 60 000`, not `-offset × 60 000` (task 53).** The plan's interface comment uses the unary-minus form. In UTC that gives `-0`, which `toEqual` rejects. JSON would send `0` anyway, so the wire value is the same.
3. **Clock passed at registration (tasks 53, 55, 56).** `QueryCtx` and `CatchUpPart.build` have no clock, and `queries/registry.ts` and `ws/catch-up.ts` were not in the Files lists. So `registerStockQuery`, `registerBranchConfigQuery` and `registerRestaurantCatchUp` take `deps.clock`, the same way the existing `registerStaffRosterQuery(app, clock)` does. The catch-up registry is module-global, so `buildHubServer` registers the three parts per server and removes them in an `onClose` hook. Without that, every test hub would add another copy. If two servers were ever alive at once, the one built last would provide `hub_time`. That never happens in production (one server per process).
4. **Stock query with no config (task 53).** `config_version` is `null` and `meta_version` is `"0.<opened_at or 0>"`. `items_meta` and `items` cover every config item, not only stock-tracked ones, because the page also toggles availability on untracked items. `unavailable_since` needs `changed_at`, so the query does its own single read of `item_availability` and does not call `itemAvailability`, which returns only booleans.
5. **The manage-stock check in the stock query (task 53).** The handler checks it itself (`session: 'none'`; the admin guard has already required `access-hub-admin`). It answers `403 PERMISSION_DENIED { permission: 'manage-stock', grant }`, which is the same shape the command route uses.
6. **Config status reads (task 54).** The two primary-key reads are `branch_config` (`readBranchConfigRow`) and `staff_directory_meta`. On an unprovisioned hub the `branch_config` read is skipped, so that case is 1 statement. The version fields are `null` before the first apply. The poller is looked up with `configPoller(app)` on each request, because `bindConfigPoller` runs after the queries are registered.
7. **Item availability events go on the `stock` stream (task 52).** I used `stream_type: 'stock'` with `stream_id` = the item id, because §6.19 says all six stock-version events "are on the `stock` stream or are the business-day events". Permission is `manage-stock` (§10 #70). As in tasks 47–50, the handler appends its own event and returns `events: []`.
8. **Clauses moved between tasks.** Task 53 could not test #116's "catch-up `stock` part shows available 0" clause, because the part did not exist yet. Task 55 tests it in its own file as `[01a S41] … (#116 catch-up clause)`, so no other test file was edited. Two restart checks use the boot step 3 fold (`foldEngineEvents`) instead of a full `boot()`, as #133 did: the restart in #152, and the `stock_version` check. #147 already covers the real `boot()` path.
9. **#71 and the existing `itemAvailability`.** Task 37 built `itemAvailability`. To make #71 fail for the stated reason, its rows are written through the new command, so it failed at setup with `404 ROUTE_NOT_FOUND`.
10. **#90 under fake timers.** The test fakes `setTimeout`, `setInterval` and `Date`. It waits for the frame on the real `setImmediate` and never advances the fake clock, so 0 ms passed (< 5 000 ms). The reconnect runs after `vi.useRealTimers()`.
11. **Time zones.** `stock.int.test.ts` also passes under `TZ=Pacific/Kiritimati` and `TZ=America/New_York`. `hub-time.test.ts` and #151 set `process.env.TZ = 'Asia/Karachi'` while they run and restore it afterwards.
