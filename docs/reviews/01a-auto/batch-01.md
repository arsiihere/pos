# 01a auto build — batch 01

Plan `docs/plans/01a-plan.md`, spec `docs/specs/01_Restaurant_Setup_Spec_v1.0.md`.

## Tasks done

| Task | Commit | Progress commit |
|---|---|---|
| 4 Domain: error codes, `manage-stock` | `87431d3` | `7fb453c` |
| 5 Domain: units (`parseQuantity`, `formatQuantity`) | `5a59704` | `123b498` |
| 6 Domain: availability windows | `4d674db` | `9f0ecce` |
| 7 Domain: `lineTotalMinor`, day-setting defaults | `426eec5` | `dd1cdfa` |
| 8 `@pos/domain/hash` | `d8e2f9e` | `a2d7690` |

Next task: 9 (events snapshot schema).

## Test count

- Before: 76 files, 264 tests (end of module 00).
- After: 81 files, 278 tests, all passing. `pnpm typecheck` and `pnpm lint` are clean after every task.

## Anything odd

- **Task 4 was already in the working tree.** An earlier try had left its changes uncommitted (`errors.ts`, `permissions.ts`, both tests, `apps/cloud/test/default-roles.test.ts`). They matched the plan exactly. `git stash` needs approval in this environment, so I checked red by removing `BUSINESS_DAY_NOT_OPEN` and `'manage-stock'` by hand. That gave three failures for the stated reason (codes and permission missing). I put them back, got green, and committed. No hub or cloud test listed the 19 permissions.
- **Rules conflict:** `.cursor/rules/pos.mdc` says never edit `docs/plans/`. The runner prompt asks for a Progress row per task, so I followed the runner and added rows plus the "Next task" line. The step checkboxes were not ticked.
- Tasks 5–7 each have one extra small test checking the export from the `@pos/domain` root, because each task edits `index.ts`. Task 5's plan listed that test; I added the same check to tasks 6 and 7.
- Task 8: `pnpm install` only added `@types/node` to `packages/domain` in the lockfile. Nothing in the hub passed `undefined` to `canonicalJson`.
- I left `.claude/settings.local.json.bak` untracked and did not touch it. It is outside every task.
