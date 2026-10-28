# 01a auto batch 09

Plan: `docs/plans/01a-plan.md`, spec `docs/specs/01_Restaurant_Setup_Spec_v1.0.md`. I read the decisions file (D1–D3). The only D3 use was in task 37: `apps/hub/test/helpers/big-fixture.ts` and `apps/hub/test/boot/boot-budget.int.test.ts`. Both are also in that task's Files list.

## Tasks committed since the last batch report (`a33dc12`)

The only commit between `a33dc12` and this session is `e9e1f94` (review 08, docs). Every `feat(01a): task` commit after the batch 08 report is listed here.

| Task | Commit | Progress commit | Tests added |
|---|---|---|---|
| 37 Hub migration 0004 and projections | `cc8290e` | `8c3b4d4` | `#49`, `[01a §5.1]` projection times = recorded_at, `[01a S5]` loadBranchConfig NONE / BODY_MISSING / APPLIED, `[01a §4.2]` itemAvailability(db, []) |
| 38 Hub config holder and HTTP client | `5f628e6` | `84bd7c8` | `[01a §3.4]` client outcomes, `[01a §3.4, S48]` request shape and 30 s timeout, `[01a S48]` real gzip, `[01a §4.2]` holder swap |
| 39 Hub `pollOnce` core | `3f49853` | `f3bf620` | `#42`, `#43`, `#44`, `#45`, `#53`, `#54`, `#95`, `#126`, cloud e2e `#140`, `[01a §3.4, S40 N4]`, `[01a S42]`, `[01a §7.3]`, `[01a §12.4]` |
| 40 Hub poller — schema version, stored-body format, commit failure | `3387815` | `12fdf87` | `#46`, `#94`, two `[01a S28 b]` tests |
| 41 Hub `onBranchConfigApplied` | `8d48b38` | `7d5823e` | `#58` |

For tasks 37, 38, 39 and 41, the new tests failed first for the expected reason:
- Tasks 37–39: the module was missing (projections, holder functions, client, poller).
- Task 41: `onBranchConfigApplied is not a function`.

`pnpm test`, `pnpm lint` and `pnpm typecheck` were green before each commit.

## Test count

- Before: 106 files, 403 tests (end of batch 08).
- After: 113 files, 429 tests, all passing.

## Rulings and anything odd (for the reviewer)

1. **Task 40 is tests only, and its tests passed on the first run.** This is a TDD gap and needs a review.
   - Cause: I built all of §3.4 steps 2 and 4 (i)–(iv) in task 39, because that task says "§3.4 steps 1–6". That includes `schema_unsupported` and "row schema ≠ 1 → send 0", which task 40 then tests.
   - What I did instead: I made 4 deliberate mutations of `config-poller.ts`, one at a time, and restored the file by hand after each. Each mutation turned the matching test red: no schema check, step 2 ignoring the row schema, swapping before COMMIT, and storing the parsed body.
   - I committed only the test file, and the commit message says so. There is no production change in task 40.
   - A stricter reading of the stop rules would have stopped here instead. Please confirm or reject this choice.
2. **Apply failure (task 39).** A throwing `writer.run` records `rejected / apply_failed` and logs the error at `error` (S43 a). The per-part retry (S43 b) is still task 42.
3. **Outcome edge cases (task 39):**
   - A 4xx other than `401` is logged at `error` with status and code and recorded as `offline`. The spec names only `401`.
   - A `200` whose config part is ignored (forward only) and has no newer directory is recorded as `unchanged` and clears `last_problem`.
   - A rejected config part with a newer directory applies the directory, records `applied`, and keeps `last_problem` (§3.4 step 6).
4. **Poller binding (task 39).** `buildHubServer` creates the poller and binds it per app; `configPoller(app)` reads it. `HubDeps.configClient` falls back to `httpConfigClient(cloud_base_url, branch_api_key)`. The test hub defaults to `stubConfigCloud()`, which returns `offline`. `start()` / `stop()` are not built yet (task 45).
5. **Malformed log (task 39, #126).** It writes one extra line, `config poll envelope malformed`, with `issues: [{ path, code }]` only. Unparsable JSON is also `malformed`, logged with code `invalid_json`.
6. **Big fixture (task 37).**
   - The fixture now checkpoints `access_reconcile`, `branch_config` and `item_availability` at `n` (exported `PROJECTIONS`).
   - Its `complete()` check now needs all three checkpoints, so the old cached `/tmp/pos-big-fixture-v1.sqlite` (built before 0004) is rebuilt once on the first run.
   - The budget test advances all three checkpoints to `N + 1` and asserts that each UPDATE hits one row.
7. **`loadBranchConfig` (task 37).**
   - Treats a stored body whose own `snapshot_schema_version` ≠ 1 as BODY_MISSING (§3.2), as well as a row with schema ≠ 1.
   - Skips the body read when the row's schema is wrong.
   - `itemAvailability` uses `item_id IN (SELECT value FROM json_each(?))`, so any number of ids is 1 statement. A missing row reads `true` (S17).
8. **Hooks (task 41).**
   - `prev` is the in-memory `branchConfig()`.
   - Hooks run right after the `BranchConfigApplied` append, so the projection row is already written. They run before the directory part.
   - `onBranchConfigApplied` returns an unsubscribe function, which tests use because the hook list is module-level.
9. **`stubConfigCloud().next` (task 38)** may be a function `(q) => Promise<ConfigFetch>`. #54 uses that to hold the request.
10. **Flaky 00 timing test.** In one full run during task 38, `[00 §10 #53]` (login timing within 2×, cloud) failed under load. It passed alone and in the full rerun. Nothing changed for it.
11. **Process note.** `/tmp` writes and `git checkout -- <file>` were not allowed in this session, so the task 40 mutations were made and undone with direct edits. `git status` was clean before the commit.

No STOP. `.auto/DONE` is not written (tasks 42–72 remain). Next task: 42 (apply failure, per-part retry).
