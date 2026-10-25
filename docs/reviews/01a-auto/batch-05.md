# 01a auto build: batch 05

Plan `docs/plans/01a-plan.md`, spec `docs/specs/01_Restaurant_Setup_Spec_v1.0.md`. Decisions D2 (task 17) and D3 (`decisions.md`) applied.

## Tasks committed since the batch 04 report

| Task | Commit | Progress commit |
|---|---|---|
| 17 Cloud test infrastructure | `803a621` | `4ee32f8` |
| 18 Cloud floors GET/POST | `2e15f6e` | `47e082a` |
| 19 Cloud floor PATCH | `35c9760` | `2d5291a` |
| 20 Cloud snapshot builder | `f5bf426` | `d00c72c` |
| 21 Cloud `GET /v1/sync/config` | `d5b2dd3` | `632ad6b` |

No STOP. Next task: 22 (cloud sync gzip).

## Test count

- Before: 88 files, 319 tests on the committed tree. With batch 04's uncommitted task 17 files: 89 files, 320 tests.
- After: 92 files, 342 tests, all passing. `pnpm lint` and `pnpm typecheck` are clean.

## Notes per task

- **17:** I checked the files batch 04 left in the working tree against the plan and kept them. Under D2, `eslint.config.js` adds `apps/cloud/test/helpers/**/*.ts` and `apps/hub/test/helpers/**/*.ts` to the `**/*.test.ts` `no-restricted-imports` override. The commit message records this. I did not see the pg-counter test fail in this session: moving the helper aside to show it needed a shell permission I didn't have. The batch 04 build log records that it failed on the missing module.
- **18:** Created `modules/restaurant/{routes,service,repository,schemas}.ts`.
  - The floor insert is `INSERT … SELECT FROM branches` through `TenantScopedRepository`.
  - A 23505 on `floors_active_name` becomes `409 CONFIG_NAME_TAKEN { entity, name }`.
  - The audit actor is the JWT `sub`, read by verifying the bearer token again, as `/v1/auth/logout` does.
- **19:** Rulings for the reviewer:
  - An empty PATCH body is `400`.
  - Archiving a floor that is already archived keeps its `archived_at`.
  - `createFloor` also calls `beforeBump`, which #83 needs.
  - #83 also runs the PATCH path with a failing `beforeBump`.
- **20:** Built in 7 statements: floors, tables, stations ⋈ programs, tax classes, categories, items ⋈ routes, windows. Windows and tables are grouped with Maps, so a large menu is not O(items × windows). `seedMenu(pool, f, o)` is in `test/helpers/restaurant.ts`, as the plan lists.
- **21:**
  - Statement (1) runs inside the read-only `REPEATABLE READ` transaction, and the 304 path runs exactly 1 statement.
  - The response schema is `SyncConfigEnvelopeSchema` from `@pos/events`, whose snapshot is `z.record(z.string(), z.unknown())`.
  - The 304 goes through a `FastifyReply` cast, because the typed reply only knows the 200 schema.
  - #114 covers the cloud part: the hub-style hash over the response text, and `canonicalJson` throwing on `undefined`. Its "the hub applies it" clause needs the hub poller (tasks 39–40).

## Anything odd

- **Station order (spec gap, task 20).** The `stations` table has no `sort_order` column. §4.3 says arrays sort by `sort_order`, then id, and names only tax classes and programs as "by name, then id". I sorted stations by name, then id, the same rule as the other two tables without `sort_order`. This does not affect hash parity, because the hub hashes whatever order it receives. If the owner wants id order instead, it is a one-line change in `builder.ts`.
- **404 details (task 18).** `BRANCH_NOT_FOUND` and `FLOOR_NOT_FOUND` carry no details. My first version echoed the path `branch_id`, and the cross-tenant test (#77) caught tenant B's id in the response.
- **`sort_order` range.** The spec gives no range for `sort_order`. The schema accepts the INT column's range, default 0, so a large value gets a 400 instead of a 500.
- Test files are not typechecked: `apps/cloud/tsconfig.json` includes only `src`. This is the existing setup.
- No flaky failures this session: 6 full runs, all green.
- `.claude/settings.local.json.bak` is no longer in `git status`. I didn't touch it.
