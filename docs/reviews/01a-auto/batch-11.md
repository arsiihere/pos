# 01a auto batch 11

Tasks committed since the batch 10 report (`62fe1b2`). No fix commits came in between.

| Task | Commit | Progress commit |
|---|---|---|
| 47 Hub `OpenBusinessDay` | `3bc952d` | `99e1706` |
| 48 Hub `CloseBusinessDay` | `283e8c0` | `f70bbf0` |
| 49 Hub `SetPrecookedStock` | `a50108d` | `ad62918` |
| 50 Hub `AddPrecookedStock` | `cb12474` | `b632fd2` |
| 51 Hub business day across restart; units frozen per day | `8bdcb97` | `94e0e80` |

**Tests:** 445 before, 462 after (`pnpm test`, Postgres on 5433). Typecheck and lint pass after every task. No STOP. Next task: 52.

## Things the reviewer should look at

1. **Handlers append their own events (tasks 47–50).** All four commands call `ctx.tx.append(...)` inside `handle` and return `events: []`. The route still lists the event ids, because it reads them by seq. I did this for two reasons. First, the business-day results report `opened_at` / `closed_at` as exactly the event's `recorded_at`, which is what §6.18a/b say. Second, the stock results come from folding the appended events with `applyEvent`, which is §6.17's "engine fold for nextState". The other 00 commands return their drafts instead. Check that this departure is acceptable.
2. **Check order in §6.17 (task 49).** I followed the spec: config present → business day open → per-entry item checks. So with no day open, an unknown item answers `409`, not `404`. The plan says "(after the item checks of §6.17's order)", which could be read the other way. I took it to mean "in §6.17's order", and the spec wins either way.
3. **`set_at` in the results.** For `SetPrecookedStock`, and for the `set` entries of `AddPrecookedStock`, `set_at` is the command's clock reading (S40 N8). For an `added` entry it is the entry's unchanged count time, because S45 says an add does not move `set_at`. The spec's §6.17a result row does not say this explicitly.
4. **`CloseBusinessDay` `not_open` result.** It returns the last day's `business_date` / `opened_at` / `closed_at`. Before any day has been opened, all three are `null`. §6.18b gives only `closed_at | null`, so null for the other two fields is my reading.
5. **Clauses split across tasks (test-only, D3, recorded in the commit messages).** Task 48 could not yet test #145's "Set/Add → 409 after a close", and task 49 could not yet test #134's AddPrecookedStock clause. Task 50 (`cb12474`) added both clauses to the existing tests. #145's push clause is still for task 55, as the plan says.
6. **Exports for task 50.** `set-precooked-stock.ts` exports `uniqueItemIds`, `stockItems` and `stockResult`. Task 50's Files list does not include that file, so `add-precooked-stock.ts` imports them rather than changing it.
7. **Task 51 passed on the first run.** The plan allows this. To show the tests can fail, I broke two lines by hand: SetPrecookedStock writing the snapshot unit instead of `dayUnits`, and boot step 3 not setting `ctx.initialState`. Both tests failed, and I restored the lines (no src change committed). #147 runs through real `boot()` restarts with a movable wall/mono clock and gets its config and directory from a stub-cloud poll.
8. **403 coverage.** In #133 and #145, the 403 comes from S_CASH, who is stopped by the admin guard (`access-hub-admin`) before reaching the command. In #63 and #130, the 403 comes from an S_OWNER with `manage-stock` denied, so the command's own permission check is what refuses it (`details.permission: 'manage-stock'`).
9. **Test clocks.** The business-day tests set the clock to local 2026-10-25 hours. Their directories use 7-day idle TTLs, so admin sessions stay alive across the hour jumps.
