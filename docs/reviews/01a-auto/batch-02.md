# 01a auto build — batch 02

Plan `docs/plans/01a-plan.md`, spec `docs/specs/01_Restaurant_Setup_Spec_v1.0.md`.

## Tasks done

| Task | Commit | Progress commit |
|---|---|---|
| 9 Events: snapshot schema `config.ts` | `38f8ce8` | `f4011f4` |
| 10 Events: seven events, fixtures, builders | `392b1a4` | `b92cce8` |
| 11 `@pos/engine`: stock slice | `d0d8172` | `33a05b3` |
| 12 `@pos/engine`: business day, `dayUnits`, `stockLevel` | `7d3cb9d` | `596f8e6` |
| 13 Lint: browser-safe packages | `4856528` | `42c865d` |

Next task: 14 (cloud migration `0002_restaurant_setup.sql`, needs Docker Postgres).

## Test count

- Before: 81 files, 278 tests.
- After: 85 files, 303 tests, all passing. `pnpm typecheck` and `pnpm lint` are clean after every task.

## Anything odd

- **One flaky full-suite run during task 12.** One test failed in one run. I didn't capture its name because the output was full of hub `CloudUnreachableError` log lines, which are normal for those tests. The next two full runs were green (302/302), and task 13's run was green too. Task 12 only touches `packages/engine`, and the engine tests passed every time, so the flake is most likely in an existing hub or cloud integration test. Worth watching.
- **Task 9:** I added one extra test, `[01a §6.1] SyncConfigEnvelopeSchema…`, because the task exports `SyncConfigEnvelopeSchema` and nothing else covered it. Its `directory` field reuses the existing `DirectorySchema`. Value ranges are enforced only where the plan gives them (`config_version ≥ 1`, day hours 1…72 and 0…24). The enums follow §5.2, and the other numbers are plain `int()`, because the cloud CHECKs own the ranges.
- **Task 10:** an extra `[01a §4.2]` test covers the payloads of `BusinessDayClosed`, `ItemMadeUnavailable` and `ItemMadeAvailable`, plus `[01a §4.3] aBranchConfig…`. The stock builders default to item `I1` with `stream_type 'stock'`, `stream_id` = item id. A payload override does not change `stream_id`, which callers set themselves, as the engine tests do.
- **Task 11:** `@pos/engine` has no `zod` dependency (no new deps allowed), so `apply-event.ts` declares the three payload shapes as local interfaces and casts `event.payload` through `unknown`. The fold trusts payloads that were already validated on append. `pnpm install` added only the `packages/engine` importer to the lockfile.
- **Task 12:** `state.ts` and `index.ts` are in the task's Files list but needed no change: task 11 already added `business_day` and the barrel exports everything. A `BusinessDayClosed` with no open day returns the same state. A second `BusinessDayOpened` replaces the day; `OpenBusinessDay` (task 47) is what makes that a no-op.
- **Task 13:** `lint.test.ts` imports `eslint` from the root devDependencies (no package dependency added) and runs with `cwd` set to the repo root.
- **Tooling:** the sandbox blocks some shell forms (`${…}` in heredocs, `git -C`, `cd … && cp`, writes to `/tmp`). I wrote those files with the editor tools instead. This changed no content.
- The untracked `.claude/settings.local.json.bak` is still untouched.
