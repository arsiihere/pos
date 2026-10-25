# 01a auto batch 07

Plan: `docs/plans/01a-plan.md`, spec `docs/specs/01_Restaurant_Setup_Spec_v1.0.md`. Decisions file read (D1–D3). D3 used once (task 31).

## Tasks committed since the last batch report (`e81142d`)

The batch 06 fix commits (`5faa210`, `99bb590`, `c759c67`, `efe4a2f`) are covered by `fix-06.md`. No `feat(01a): task` commit came between `e81142d` and this session, so the list below is complete.

| Task | Commit | Progress commit | Tests added |
|---|---|---|---|
| 27 Cloud owner-row read helper | `a457dd0` | `45ad227` | `[01a S8]` coversEveryBranch true / false after removing C by SQL / one statement |
| 28 Cloud menu-item POST | `9ded9e1` | `37106f5` | `#33`, `#34`, `#35`, `#36`, `#37`, `#41`, `#88`, `[01a §6.14]` no `tax_class_id` key → 400, `[01a S44]` g / piece / 250 |
| 29 Cloud menu read | `e782f60` | `de8a694` | `#40`, `#138`, `#139` (server part) |
| 30 Cloud menu-item PATCH | `c09e828` | `a311ff7` | `#7`, `#38`, `#81`, `#106`, `#107`, `#121`, `#128`, `[01a §6.15]` restore re-checks the merged row |
| 31 Cloud availability windows | `f726a4e` | `d2d3d05` | `#135` |

For every task, the new tests failed first for the stated reason: task 27 `coversEveryBranch is not a function`; tasks 28–30 a missing route (`404 ROUTE_NOT_FOUND`); task 31 no `availability_windows` in the response. After that, `pnpm test`, `pnpm lint` and `pnpm typecheck` were green before each commit. `ROUTE_CASES` gains `POST /v1/admin/menu-items`, `GET /v1/admin/menu` and `PATCH /v1/admin/menu-items/:item_id`. A tenant B item, with its route, is now in `bIds`.

## Test count

- Before: 97 files, 368 tests (after fix-06).
- After: 101 files, 390 tests, all passing.

## Rulings and anything odd (for the reviewer)

1. **D3 applied to 01a tests, not only 00 tests (task 31).** S47 puts `availability_windows` into the item and category shape, including the audit `before` / `after`. Two earlier tests compared that shape exactly: `[01a §10 #33]` (task 28, `menu-items.int.test.ts`) and `[01a §10 #120]` (task 26, `tax-categories.int.test.ts`). Both now expect `availability_windows: []`. These are test-only edits outside task 31's Files list. D3 names "module-00 tests" whose assertions the 01a spec makes outdated; I read it as also covering 01a tests that a later 01a task makes outdated, because D3 reserves STOP for production code, specs and plans. Both edits are recorded in the commit message and the build log. If that reading is wrong, the alternative was a STOP.
2. **One multi-row audit INSERT (task 28).** §6.14 counts "1 audit insert" for the item and its routes, and `#37` needs equal counts for 1 and 3 routes. `writeConfigAudit` writes one row and `config-audit.ts` is not in the Files list, so `restaurant/repository.ts` gains `insertConfigAuditRows`, a multi-row `INSERT … SELECT … unnest(…)` with the same columns. It partly duplicates `writeConfigAudit`. The reviewer may want it moved into `config-audit.ts` later.
3. **Route error fields:** `CONFIG_REFERENCE_INVALID.details.field` is `routes.<i>.station_id`, `routes.<i>.program_id` or `routes.<i>.stock_program_id`, with `<i>` the index in the body. On a restore (task 30), `<i>` is the index among the stored routes, sorted by `branch_id`. Item-level fields are `category_id`, `tax_class_id` and `stock_time_ms` (`stock_time_exceeds_cook_time`). The units rule (S44) is a `400 VALIDATION_FAILED` whose issue path is `sale_unit` or `stock_per_sale_unit`.
4. **Order of checks in item POST:** the route branches are checked against the JWT's `allowed_branch_ids` (`404 BRANCH_NOT_FOUND`), then the units rule and stock ≤ cook, all before the idempotency key. Inside the transaction come the key, then category `FOR SHARE`, tax class `FOR SHARE` (when not null), stations `= ANY` `FOR SHARE` (by `station_id`), programs `= ANY` `FOR SHARE` (by `program_id`), then item insert, route insert, window insert, audit and bump. The route and window inserts are skipped when their arrays are empty. Another branch's station is `wrong_branch`. A program that is not on the route's station, including one at another branch, is `program_wrong_station`.
5. **Restore re-checks routes (task 30, carries review-06 nit 1).** A restore runs `assertRoutes` on the item's stored routes, so it cannot bring back a route to a station or program that was archived in the meantime (`422 … archived`). Limitation: the routes are read through `TenantScopedRepository`, so only the JWT's branches are checked (and returned in the PATCH response). Suppose an owner's token lists fewer branches than their `owner_users` row, and task 33's tenant-wide check passes on the DB row. Then a route at a branch missing from the token is not re-checked. The other direction is not covered either: a station type change still leaves archived items' routes in place.
6. **Item PATCH references:** the category and tax class are re-checked when they are sent or when the merged row is active. An archived item may keep an archived reference but never an unknown one, which is the same pattern as tables and floors. Archiving needs no in-use check (§6.15).
7. **Menu read (task 29):** it always runs exactly 6 statements, including an empty page, where windows and routes are queried with `= ANY('{}')`. The cursor is base64url JSON `{ n, id }`, where `n` is Postgres' own `lower(name)`. A cursor that does not decode, or is not an object with string `n` and `id`, returns `400 VALIDATION_FAILED` with issue path `cursor`. `q` escapes `\`, `%` and `_` and uses `ILIKE … ESCAPE '\'` on `name` and `group_label`. Tax classes are ordered by name, then id; categories by `sort_order`, then id; windows by `{ start_ms, end_ms }`, as in the snapshot. The server does not de-duplicate across pages; `#138` shows that a rename across the cursor repeats a row and that de-duplicating by `item_id` (the page's job, task 66) gives each item once.
8. **Spec gives no length for `group_label`:** it is trimmed, 1–60 characters, or null (the same rule as `location_label`). `description` is ≤ 300 characters and not trimmed.
9. **Not yet enforced:** the tenant-wide `403` (task 33). Today an owner whose row lacks a branch can still create and patch items, tax classes and categories. `can_edit_tenant` (task 29) already reads the row.
10. **Bookkeeping:** the build-log lines for tasks 27 and 28 were committed with task 29's progress commit (`de8a694`), because the first two progress commits staged only the plan. All five lines are in `docs/reviews/build-log.md`.

No STOP. `.auto/DONE` is not written (tasks 32–72 remain). Next task: 32.
