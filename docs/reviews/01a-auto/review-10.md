APPROVE

# 01a auto review — batch 10 (tasks 42–46)

Reviewer: independent, fresh session. Scope: commits `9679045`, `5402ed9`, `ac6f7f7`, `97ae049`, `09d6a41`, checked against plan tasks 42–46 and spec 01 v1.0 sections S5, S6, S15, S16, S33, S43, §2, §3.2, §3.4, §6.19, §6.22, §7.2, §7.3, plus tests #47, #48, #50, #51, #52, #57, #67, #93, #115, #124.

## Verification (run by me)

- `pnpm test`, run 1: **1 failed / 444 passed (445)**, 117 of 118 files passed. The failure was `apps/hub/test/engine-host/append-events.int.test.ts` `[00 §10 #63]`, which timed out at 5 000 ms. That is a module-00 test, and no commit in this batch touches it or `engine-host/`. Run alone, it passes in 2.4 s.
- `pnpm test`, run 2: **445 passed (445)**, 118 of 118 files.
- `pnpm lint` (`eslint .`): clean, no output.

The 445 count matches the batch report. The run-1 timeout looks like load-dependent flakiness in a 00 test (1 000 appends under full-suite parallelism). It is not caused by this batch, but see Nit 5.

## Per task

**Task 42 (S43, §3.4 step 5, §7.3).** `apps/hub/src/sync/config-poller.ts:180-212`: when the combined `writer.run` throws, the code logs at error with `{ err }` (message and stack, not the body or the directory) and sets `last_problem { rejected, apply_failed, at }` (:183). It then retries the directory part alone, then the config part alone, each in its own `writer.run` (:186-205), in the order S43 (b) requires. Each part keeps its own swap (`tx.onCommit` at :255, 00's `setDirectory` via `onCommit` at `auth/apply-directory.ts:155`), so commit-then-swap holds. Test #50 covers one transaction for both parts (one published batch), a config-part failure (directory applied alone, config row, body and memory unchanged) and a directory-part failure (config applied alone, directory 0). Test #115 covers a throwing hook: no `BranchConfigApplied`, no hook event, `branchConfig()` is the same object, error-level log lines with no `$argon2id$` and no item names, the directory applied alone, a retry with `config_version: 3`, and a clear once the hook stops throwing. Both tests would fail on the old code, which returned without retrying, so the directory would never apply. The test seam `applyDirectory?` is in the plan's Files note.

Review focus 1 (problem kept when the parts later apply alone): S43 says the problem "stays until a poll applies the config part or is unchanged", and §3.4 step 6 says "unless a config part … failed in this poll". The implementation's reading is defensible. A directory that keeps failing stays visible, and the transient case clears at the next 304. Accepted, but see Nit 1.

**Task 43 (S6, R14, M38, M75).** Tests only; `config-poller.ts` is unchanged, which the plan allows. #51 asserts that `DeviceRevoked { cause: 'owner_removed', actor_id: null, device_id: 'hub' }`, `SessionEnded 'staff_removed'`, `BranchConfigApplied` and `StaffDirectoryApplied` arrive in one published batch, so they share one transaction. It also checks the DB rows and the in-memory directory. #52 asserts the row is kept, there is no revoke, the session stays open and the skip reason is `malformed pin_hash`. The author showed by hand that the tests fail with the part disabled.

**Task 44 (S15, S16, S33, §2, §6.19).**
- `lib/boot.ts:44-45` adds `BootContext.initialState?`. `createDeps` builds `createStateHolder(initialState ?? {})` and calls `setReducer(applyEvent)`, replacing the identity reducer, as §2 and S15 ask.
- `sync/boot-steps.ts:27-44` is `foldEngineEvents`, with the exact WHERE clause from the plan and `ORDER BY seq`. It starts from `initialEngineState()` and computes `stockVersion` in the same scan, with no extra query (§6.19).
- `sync/stock-version.ts`: the six event types match §6.19 exactly. `noteCommitted` runs in the writer's `publish` wrapper, which fires after COMMIT (`engine-host/writer.ts:93`).
- `QueryCtx.state` and `QueryCtx.branchConfig` are in `queries/registry.ts:22-24,120-121` (S16).
- `issue-admin-bootstrap.ts` uses `applyEvent`. `main.ts` calls `registerRestaurantBootSteps()` before `boot` (S15).
- The `@pos/engine` workspace dependency is the only new dependency, and the plan lists it.
- Tenant scoping: the fold filters by `branch_id`.
- On review focus 3: the step-3 handler returns early only when `provisioned` is undefined. That path never reaches step 3 (`boot.ts:100-127`), and provisioning ends with `deps.exit(0)` (`setup/provision.ts:141`). So a live hub never folds stock onto `{}`.
- Tests #67, #93, the S33 boot fold, the §6.19 version (including that a `ClockAlarm` does not move it, and the value after restart) and the main.ts check are all present, and all fail without the code.

**Task 45 (S5, S15, §3.2, §7.2).**
- Step 5 (`boot-steps.ts:63-68`) runs after step 4's `catchUp` (`boot.ts:162` before `:176`) and swaps `null` for NONE and BODY_MISSING (§3.2).
- Step 6 (`:70-78`) starts the unref'd 60 s timer and stops it in `onClose`.
- `config-poller.ts:119` drops a late result after `stop()`, writing, swapping and recording nothing. `:262` stops `pollOnce` after stop.
- `BootOptions.configClient` is set before `buildHubServer` binds the poller (`boot.ts:143`, `:169`).
- Tests: #47 covers the restart load and a byte-identical rebuild after checkpoint deletion. #48 covers the body missing (R32) and a foreign schema version, each going to `config_version=0` and then APPLIED. #124 covers the fold reaching the holder and a stale `branch_config` checkpoint caught up before the load. The two §7.2 tests use fake timers.

**Task 46 (§6.22, M31).** `sync/station-validator.ts:5-8` matches the §6.22 body exactly and reads memory only. It is registered at module load through the side-effect import at `server.ts:37-38`, before listen. #57 covers 404 `STATION_NOT_FOUND` before config, paired after apply, and 404 for an archived station and an unknown station, with KDS row counts asserted. It would fail without the code, because 00's default refuses every station. The test-only change to #124 is recorded in the commit message.

**Cross-cutting.**
- Files touched match each task's Files list, apart from the one test-only change noted under D3.
- No secrets, PIN hashes or snapshot bodies in logs (§7.3; asserted in #115).
- There is no client code in this batch.
- Error codes come from the existing catalogue (`STATION_NOT_FOUND`).
- Determinism: the fold uses `recorded_at` (#93), and the timers are injectable through fake timers.

## Blocker

None.

## Should-fix

None.

## Nit

1. **`apps/hub/src/sync/config-poller.ts:206-212`: no test or spec line covers "both parts apply alone in the same poll".**
   - *Scenario:* a transient failure in the combined transaction, after which both retries succeed. The poll returns `rejected / apply_failed` with the new versions, and the stock page shows the problem banner for up to 60 s, until the next 304.
   - *Why it matters:* the behaviour is a defensible reading of S43, but nothing pins it down, so a later change could flip it unnoticed.
   - *Fix:* add an assertion for this case to #50 (both retries succeed, so `lastProblem()` stays `apply_failed` and the next 304 clears it). Note the reading in the spec's next editorial bump, in §3.4 step 6.

2. **`apps/hub/test/boot/engine-fold.int.test.ts:65-71`: the `{}` test depends on running before the other tests in its file.**
   - *Scenario:* `registerRestaurantBootSteps()` sets a module-level flag. If someone reorders the tests, adds `.concurrent`, or runs with `--sequence.shuffle`, the `{}` assertion fails because the step-3 handler is already registered.
   - *Fix:* move the test to its own file, or call `vi.resetModules()` and import `boot` dynamically inside the test.

3. **`apps/hub/src/lib/boot.ts:307-310` and `engine-host/writer.ts:89-93`: `stock_version` moves only inside `publish`, which runs after the `onCommit` and `afterCommit` callbacks.**
   - *Scenario:* an `afterCommit` hook (for example access reconcile) throws after a `StockSet` commits. `publish` is skipped, `stock_version` stays behind, and the stock page's next poll with the old versions gets `unchanged: true` and shows the stale count until another stock event.
   - *Why it is only a Nit:* this follows the plan's wording, and the same hook failure already skips the WS publish in 00.
   - *Fix:* register `noteCommitted` as the first `writer.addAfterCommit` hook, or call it before the hooks loop. Raise it at the next plan or spec touch.

4. **`apps/hub/test/sync/poller-boot.int.test.ts:186-188,208`: task 46 changed a 01a test file outside its Files list and cited D3.**
   - *Why it matters:* D3 covers test infrastructure (helpers, fixtures, configs, outdated 00 assertions), not another task's 01a test. The change is harmless and was recorded.
   - *Fix:* either widen D3's wording to cover "a later task completing an earlier task's test clause", or list the file in the plan's Task 46 Files list next time.

5. **`apps/hub/test/engine-host/append-events.int.test.ts:19` (module 00, not touched by this batch): `#63` timed out at the default 5 000 ms in one of my two full runs.**
   - *Scenario:* under full-suite parallel load, the 1 000-append loop exceeds 5 s, so CI fails intermittently.
   - *Fix:* give this test an explicit timeout (for example `30_000` as the third `it` argument). Under D3 that is a test-only change.
