# 01a auto fix — batch 06

Answers `docs/reviews/01a-auto/review-06.md`.

## Blocker

None in the review.

## Should-fix

| Finding | Result | Commit |
|---|---|---|
| S1. Table PATCH with a bad `floor_id` on an archived row → `500` | **fixed** | `5faa210` |

S1: `assertActiveFloor` is now `assertFloor(scoped, branchId, floorId, { requireActive })`. `patchTable` runs it when `body.floor_id !== undefined || merged.archived_at === null`, with `requireActive: merged.archived_at === null`. A sent `floor_id` therefore always gets the `not_found` / `wrong_branch` check. The `archived` reason still applies only to an active merged row, so an archived table may still sit on an archived floor. New test `[01a §6.6] floor_id on an archived table, or with archived: true, is still checked → 422, never 500` covers both cases from the review: (a) an already archived table and (b) `{ archived: true, floor_id }`, each with `not_found` and `wrong_branch`. It asserts that nothing is written, no audit row is added and nothing is bumped. Before the fix it failed with `500`.

## Nits

| Nit | Result | Commit / reason |
|---|---|---|
| 1. Archived items' routes survive a station type change | **deferred** (not changed) | The fix is for item restore (task 30) or the route rules (task 32). Neither exists in this batch, and the implementer rules forbid editing `docs/plans/` beyond the Progress table, so it cannot go into the task 30 plan notes from here. **Carry it to task 30:** on item restore, revalidate the item's routes against §3.3 and refuse with `422`. Or, on a station type change, also clear the routes of archived items. |
| 2. Category `availability_windows` accepted and dropped | **deferred** (not changed) | The plan allows this until task 31, which stores the windows. **Carry it to task 31:** add a test that a PATCH carrying only windows changes the stored windows and the audit row (S47). |
| 3. `Accept-Encoding` `gzip;q=0` treated as acceptance; no `Vary` | **fixed** | `efe4a2f`: `acceptsGzip` parses the tokens and treats `q=0` as a refusal. Both `200` paths send `vary: accept-encoding`. New `[01a S48]` test (it failed before the fix). |
| 4. `*_NOT_FOUND` details drift | **fixed** | `99bb590`: `BRANCH_NOT_FOUND { branch_id }` (3 sites) and `FLOOR_NOT_FOUND { floor_id }`, as in §9. #19 and #23 now assert the details (both failed before the fix). |
| 5. Cross-tenant table case only hits the branch guard | **fixed** | `c759c67`: `[00 §10 #77]` now also POSTs a table on tenant A's own branch with B's `floor_id` and expects `422 { field: 'floor_id', reason: 'not_found' }`, with B's floor id nowhere in the response. This only adds coverage; the code already behaved correctly. |

No finding was rejected. Nothing needed a spec change, so no `.auto/STOP` was written.

## Verification

- `pnpm test`: **97 files, 368 tests, all passed**. That is 366 before plus 2 new tests (S1, nit 3). Nits 4 and 5 extend existing tests.
- `pnpm lint`: `eslint .`, exit 0.
