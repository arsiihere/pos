# 01a auto batch 10

Tasks committed since the batch 09 report (`12d3dd3`). The batch 09 fixes (`81f49ec`, `5574fed`, `015e905`) came before them and are covered by fix-09.

| Task | Commit | Progress commit |
|---|---|---|
| 42 Hub apply failure: visible problem, parts retried alone | `9679045` | `a96b6c6` |
| 43 Hub directory through the poll | `5402ed9` | `992c996` |
| 44 Hub engine state through `createDeps`, reducer, boot fold, `stock_version` | `ac6f7f7` | `d0ec280` |
| 45 Hub boot config load after catch-up, `BODY_MISSING`, poll timer | `97ae049` | `3b61cff` |
| 46 Hub station validator | `09d6a41` | `a99c0d3` |

**Tests:** 429 before, 445 after (`pnpm test`, Postgres on 5433). Typecheck and lint pass after every task. No STOP.

## Things the reviewer should look at

1. **Task 42, `last_problem` after a partial retry (S43).** When the combined apply throws, the poll returns `rejected / apply_failed` and keeps `last_problem`, even if both parts then apply alone. It also does this when only the config part applies alone. S43 says the problem "stays until a poll applies the config part or is unchanged". I read that as "a later poll", so a directory that keeps failing stays visible. The result carries the versions that are current after the retries. The test seam is `ConfigPollerDeps.applyDirectory?` (defaults to 00's `applyStaffDirectory`).
2. **Task 43 passed on the first run.** The plan allows this. Task 39 had already built the directory part. To show the tests can fail, I disabled the directory part by hand: both tests failed. I then restored it (no src change committed).
3. **Task 44, `{}` with `applyEvent`.** Spec §2 says that with no step-3 handler the state is `{}`, so `createDeps` passes `{}` cast to `EngineState`. A `StockSet` folded onto `{}` would throw, because `state.stock` is undefined. This cannot happen in production, because main.ts always registers the step. It can happen in a test that boots without `registerRestaurantBootSteps()` and then appends stock events. `registerRestaurantBootSteps()` registers only once (a module flag). The test hub starts from `initialEngineState()` and resets `stockVersion` to 0.
4. **Task 45, poller shutdown.** A fetch that resolves after `stop()` returns `{ outcome: 'offline' }`. That result is not recorded, and nothing is written or swapped. `pollOnce()` after `stop()` returns the last result, or `not_ready`, without calling the cloud. Step 6 starts the timer and stops it from an `onClose` hook. The timer is unref'd. The timer tests use vitest fake timers (`setInterval` / `clearInterval` only).
5. **Task 45 → 46, #124.** The clause "and the station validator" could not be tested before task 46. Task 46 added it to the existing `#124` test, a test-only change under D3, recorded in the commit message and the build log.
6. **Task 46.** server.ts imports `sync/station-validator.ts` for its side effect (the spec says "registered at module load"). One 00 test file (`approve-pairing-request`) overrides the validator in its `afterEach`. That still works, because each vitest file gets its own modules.
