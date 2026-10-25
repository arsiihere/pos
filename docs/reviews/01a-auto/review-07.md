APPROVE

# 01a auto review — batch 07 (tasks 27–31)

Reviewer: independent, fresh session. Read: `batch-07.md`, plan tasks 27–31, spec v1.0 sections S8, S11, S26, S32, S34, S44, S46, S47, S48, §3.3, §6 preamble / §6.0, §6.11, §6.13–6.15, §10 rows #7, #33–38, #40, #41, #81, #88, #106, #107, #121, #128, #135, #138, #139, and `decisions.md`. Diffs: `a457dd0`, `9ded9e1`, `e782f60`, `c09e828`, `f726a4e`.

## Verification run by the reviewer

- `pnpm test`: **101 files passed, 390 tests passed** (0 failed), duration 103.56 s. This matches the batch report.
- `pnpm lint` (`eslint .`): exit 0, no output.
- `git diff --stat e81142d..HEAD -- package.json pnpm-lock.yaml apps/cloud/package.json`: empty, so no new dependency.

## Per task

**Task 27 `coversEveryBranch`** (`apps/cloud/src/lib/config-version.ts:36-47`). The SQL is the plan's statement word for word: `bool_and` over `branches` joined to the owner's `owner_users` row, with `$1` = tenant from `TenantLevelRepository`. A missing row or no branches gives `NULL`, which maps to `false` (`=== true`). That fails closed. The test (`config-version.int.test.ts`, `[01a S8]`) checks true → `array_remove` C by SQL → false, with `counter.count === 1` both times. Without the function it fails on the import. OK.

**Task 28 item POST** (`service.ts` `createMenuItem`, `repository.ts` `share*`, `insertMenuItem`, `insertItemRoutes`, `insertConfigAuditRows`).
- The §6.14 body matches. `tax_class_id` is a required nullable key (`schemas.ts:198`). S44/S46/S41 defaults are present. The units rule is a `400 VALIDATION_FAILED` that names the field (`assertUnits`). Stock > cook is `422 CONFIG_REFERENCE_INVALID {field:'stock_time_ms', reason:'stock_time_exceeds_cook_time'}`.
- A route branch outside the JWT branches gives `404 BRANCH_NOT_FOUND` before the transaction, so nothing is written (#36 asserts counts and versions).
- References are locked `FOR SHARE` with one statement per kind. Stations and programs use `= ANY` with `ORDER BY id` (S8). The §3.3 route rules are all covered: wrong_branch, archived, not_found, program_not_allowed, program_required, program_wrong_station, archived program.
- Item and routes are one `INSERT` each. Audit (`menu_item/create` plus one `item_route/route_set` per route, `branch_id` null / the route's branch, S26 / §6.0) comes before the tenant bump.
- #37 compares the statement count for 1 and 3 routes and checks the 4 `item_route` audit rows. #33 checks `bigint` storage and the exact audit rows. #34, #35, #41, #88, the `tax_class_id`-missing case and the S44 case each exist once and assert the stated outcome.
- Cross-tenant: B's category and tax class give `422 not_found`, and B's ids are not echoed.

**Task 29 menu read** (`service.ts` `listMenu`, `repository.ts` `selectAll*`, `selectMenuPage`, `selectItemWindows`, `selectItemRoutes`).
- It runs exactly the 6 statements of §6.11, including `= ANY('{}')` on an empty page. The keyset `(lower(name), item_id) > ($n,$id)` uses `LIMIT limit+1`. `%`, `_` and `\` are escaped, with `ESCAPE '\'` on `name` and `group_label`.
- Routes go through `TenantScopedRepository`, so only the JWT's branches are returned (#40 `onlyA`). `can_edit_tenant` comes from the DB row, not the token (#139 checks both directions).
- A bad cursor, `limit` 0 or 201, or a bad `status` gives `400`. #138 covers 50/50/20 pages, an insert before the cursor, a rename repeat with de-duplication by `item_id`, literal `%` / `_` / `\`, archived, category and 6 statements per page.

**Task 30 item PATCH** (`service.ts` `patchMenuItem`).
- The order is: lock `FOR UPDATE` → `404 MENU_ITEM_NOT_FOUND` → merged-row units / stock ≤ cook / references `FOR SHARE` → re-check routes on restore → update (`nameTaken` → 409) → one audit row (`auditActionFor`: update / archive / restore) → tenant bump.
- #121 shows `422`, not a CHECK `500`, with nothing written (row, audit, versions). #128's `sale_unit 'g'` alone gives `400` with nothing written. #81 checks the exact before / after with `branch_id` null. #7 checks the A-only vs A+B+C bumps. #38, #106 and #107 are as specified. The cross-tenant PATCH on B's item gives `404`.

**Task 31 windows** (`replaceWindows`, `insertWindows`, `deleteWindowsOf`, `selectWindowsOf`).
- POST inserts its windows in one multi-row `INSERT`. A PATCH that carries the field runs delete + insert inside the write's transaction, after the row lock. Without the field the stored set is kept, which the test checks.
- The audit `before` / `after` carry `availability_windows` (§6.0 v0.7). Responses are sorted by `start_ms, end_ms, window_id`.
- The `AvailabilityWindows` schema (`schemas.ts:129-135`) enforces the multiple-of-60 000 range, `start ≠ end` and at most 4. #135 covers item and category, the wrap, replacement (old `window_id`s gone), same-start sorting by end, the snapshot, and four bad inputs × four writes with no rows written.

**Foundation §6 / security.** Envelopes are `{ data }` and errors come from the catalogue (`CONFIG_REFERENCE_INVALID`, `MENU_ITEM_NOT_FOUND`, `BRANCH_NOT_FOUND`, `VALIDATION_FAILED`, `CONFIG_NAME_TAKEN`); there are no new codes. Every query is tenant-scoped through `TenantLevelRepository` / `TenantScopedRepository` (`$1` = tenant), and the D54 exception is used only for tenant-level tables. Ids come from the injected `IdGen` and times from the injected `Clock`. Nothing new is logged, and the test logs show `authorization` as `[Redacted]`. There is no client code in this batch.

**Files.** Tasks 27–30 touch only their Files lists. Task 31 also edits `menu-items.int.test.ts` and `tax-categories.int.test.ts`, test-only and recorded in the commit message (see Nit 3).

The tenant-wide `403` (S8) is not yet enforced. That is planned for task 33, and the batch report discloses it (ruling 9), so it is not counted here.

## Blocker

None.

## Should-fix

None.

## Nit

1. **The restore re-check sees only the JWT's branches.** `apps/cloud/src/modules/restaurant/service.ts:885` reads the routes with `selectItemRoutes(scoped, …)`, and `assertRoutes` locks stations through `shareStationsById` (`repository.ts:533`), which also filters by the JWT branches.
   - Failure scenario (after task 33): `issue-registration-code` appends branch C to the owner's row, but the owner's token predates it (the exact case S8 v1.0 describes). The tenant-wide guard passes on the DB row. While the item is archived, C's station is archived, because archived items' routes do not block a station archive. The owner restores the item. The route at C is not re-checked, so C's next snapshot (`config-sync/builder.ts:80-83`, which does not filter by station state) routes an active item to an archived station.
   - Fix (in task 33, which adds the DB-row guard): for the restore re-check, read the item's routes and their stations / programs through `TenantLevelRepository` across all the tenant's branches. The tenant-wide guard already guarantees the owner covers them. Add a test with a token for A and B only and a DB row for A, B and C.
2. **`insertConfigAuditRows` duplicates `writeConfigAudit`.** `apps/cloud/src/modules/restaurant/repository.ts:670` has the same columns and actor mapping as `apps/cloud/src/lib/config-audit.ts:28`.
   - Failure scenario: a later column or actor change (for example the 01b `actor_kind`) is made in one function only, and the item / route audit rows diverge from every other entity's.
   - Fix: move the multi-row form into `config-audit.ts` (for example `writeConfigAudits(db, entries[], deps)`) and have `writeConfigAudit` call it with one entry. Do this when a task's Files list includes `config-audit.ts`.
3. **D3 is applied to 01a tests (batch ruling 1).** `decisions.md` D3 names "module-00 tests" whose assertions the 01a spec makes outdated. Task 31 edited the 01a tests #33 and #120. The edit is test-only, needed and correct (S47 makes `availability_windows` part of the shape).
   - Failure scenario: a later batch reads D3 even more broadly and rewrites a 01a assertion to fit the code instead of the spec.
   - Fix: the owner either confirms by adding a line to D3 ("…and earlier 01a tests whose exact-shape assertions a later 01a task's cited spec section extends") or rejects it.
4. **The "at most one route per branch" refine has no test.** The refine is at `apps/cloud/src/modules/restaurant/schemas.ts:217-221`.
   - Failure scenario: the refine is dropped in a refactor. Two routes for branch A then reach `insertItemRoutes` and fail on the `item_routes` primary key as a `500` instead of a `400`.
   - Fix: add one case to `menu-items.int.test.ts` (#34 block): two routes with the same `branch_id` → `400 VALIDATION_FAILED`, with nothing written.
5. **`group_label` and `description` limits are not in the spec.** `apps/cloud/src/modules/restaurant/schemas.ts:186-187` uses trimmed 1–60 or null for `group_label`, and ≤ 300 untrimmed for `description`. The spec gives no limit for either (batch ruling 8). This is a gap, not a contradiction, but it is an API contract the owner page (task 66) will rely on.
   - Failure scenario: the page sets its own lengths and rejects or truncates differently from the server.
   - Fix: record both limits in the spec's §12.3 open questions, or in the next 01a spec revision's §3.3 row, so the page task copies them from the spec.
