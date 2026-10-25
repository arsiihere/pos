CHANGES NEEDED

# 01a auto review — batch 06 (tasks 22–26)

Reviewer: independent, fresh session. Scope: `3279dba` (22), `2bccd2a` (23), `6c6b47e` (24), `671d559` (25), `53eb634` (26), checked against plan tasks 22–26 and spec v1.0 §6 intro, §6.0, §6.1, §6.5, §6.6, §6.9, §6.10, §6.12, §6.13, §3.3, §9 and §10 #20–22, #24–32, #118–120.

## Verification run by the reviewer

- `pnpm test`: **97 files, 366 tests, all passed** (87 s). This matches the batch report.
- `pnpm lint`: `eslint .`, exit 0, no warnings.
- Files: each commit touches only its plan Files list (`config-sync/routes.ts` plus the new test for task 22; `modules/restaurant/*`, `cross-tenant.int.test.ts` and one new test file for tasks 23–26). No `package.json` or lockfile changes. gzip uses `node:zlib` (S48).
- Numbered tests: #20, #21, #22, #24, #25, #26, #27, #28, #29, #30, #31, #32, #118, #119 and #120 each appear exactly once. The section-tagged extras are present as the plan lists them. Each test asserts status, error code and `details`, and for the write paths also the audit rows and version bumps. With the route missing, each would fail (`404 ROUTE_NOT_FOUND`).
- Every route is in `ROUTE_CASES` with tenant B's ids. The D3 change to `[00 §10 #77]` exempts only strings in `error.details` that the request itself sent, and it adds a hard `404` assertion for the two tenant-level PATCH routes. This is bounded and acceptable (`apps/cloud/test/cross-tenant.int.test.ts`, task 26 hunk).
- D54: all branch SQL uses `tenant_id = $1 AND branch_id = ANY($2)`. Tenant-level SQL uses `tenant_id = $1`. `shareFloor` drops `branch_id = $3` on purpose (batch note 3) and stays within the caller's branches, so a foreign tenant's or a disallowed branch's floor reads as `not_found`, which is not a leak. Nothing logs bodies or secrets. This batch has no client code.
- Envelopes and errors: the codes come from the catalogue, and the `*_NOT_FOUND` details match §9 and 00 §9 (`STATION_NOT_FOUND { station_id }`). The in-service `VALIDATION_FAILED` uses the same `issues[{ path, message }]` shape as the error handler. Determinism: every timestamp comes from `deps.clock`, and ids from `deps.ids`.

## Blocker

None.

## Should-fix

### S1. Table PATCH with a bad `floor_id` on an archived row → `500` instead of `422`

- **Where:** `apps/cloud/src/modules/restaurant/service.ts:267`, `if (merged.archived_at === null) await assertActiveFloor(...)`.
- **Failure scenario:** `dining_tables` has `FOREIGN KEY (tenant_id, branch_id, floor_id) REFERENCES floors` (`0002_restaurant_setup.sql:55`). The floor check only runs when the merged row is active, so `floor_id` is never checked when:
  - (a) the table is already archived and the PATCH sends `{ floor_id: 'NO-SUCH-FLOOR' }`, or another branch's floor id;
  - (b) an active table is PATCHed with `{ archived: true, floor_id: <unknown or other-branch floor> }`.
  
  In both cases `updateTable` hits pg `23503`. `nameTaken` rethrows anything that is not `23505`, so the client gets `500`. §3.3 and §6.6 say the answer is `422 CONFIG_REFERENCE_INVALID { field: 'floor_id', reason: 'not_found' | 'wrong_branch' }`. A `500` also breaks the "never a SQL constraint 500" rule for merged rows (§3.3, last rule).
- **Fix:**
  - When `body.floor_id !== undefined`, always run the existence and branch part of the check, even if the merged row is archived.
  - Keep the `archived` reason only for an active merged row. One option is `assertFloor(scoped, branchId, floorId, { requireActive: merged.archived_at === null })`, called when `body.floor_id !== undefined || merged.archived_at === null`.
  - Add a `[01a §6.6]` test: archive a table, then PATCH `{ floor_id: 'NO-SUCH-FLOOR' }` → `422 not_found`, and PATCH `{ floor_id: <branch 1 floor> }` → `422 wrong_branch`, with no write and no bump.

## Nits

1. **Archived items' routes survive a station type change.** `apps/cloud/src/modules/restaurant/service.ts:390` and `repository.ts` `activeRouteItemIds` count only routes of active items (batch note 4). After batch → slot, an archived item's `item_routes` row can still hold `program_id` / `stock_program_id` on what is now a slot station, pointing at programs that are now archived. Restoring that item (task 30) would put a route into the snapshot that breaks §3.3 ("slot station → program ids null"). Fix in task 30 or 32: on item restore, revalidate the item's routes against §3.3 and refuse with `422`. Or, on a type change, also clear or remove routes of archived items. Record it in the task 30 plan notes so it is not lost.
2. **Category `availability_windows` are accepted and then dropped.** `apps/cloud/src/modules/restaurant/schemas.ts:140` and `PatchCategoryBody` accept non-empty `availability_windows`, but nothing is stored. A PATCH carrying only `availability_windows` returns `200`, writes an `update` audit row with `before` equal to `after`, and bumps every branch. The plan allows this until task 31, but task 31 must add a test that a windows-only PATCH changes the stored windows and the audit row (S47).
3. **`Accept-Encoding` parsing.** In `apps/cloud/src/modules/config-sync/routes.ts:27`, `/\bgzip\b/i` treats `gzip;q=0`, an explicit refusal, as acceptance. The `200` also carries no `Vary: Accept-Encoding`. Only the hub calls this route today, so the impact is low. Fix: ignore `gzip` tokens with `q=0`, and add `vary: accept-encoding` on both `200` paths.
4. **`*_NOT_FOUND` details drift.** `service.ts:162` (`FLOOR_NOT_FOUND`) and `service.ts:82`, `:128`, `:334` (`BRANCH_NOT_FOUND`) send no `details`, while §9 lists `{ floor_id }` and `{ branch_id }`. Since the #77 exemption now allows echoed ids, align them: `{ floor_id: floorId }` and `{ branch_id: branchId }`. Extend #19 and #23 to assert the details. (Ruling on batch note 2: yes, align.)
5. **The cross-tenant table case only exercises the branch guard.** In `apps/cloud/test/cross-tenant.int.test.ts:35`, the table POST and PATCH cases use tenant B's `branch_id`, so they stop at `404 BRANCH_NOT_FOUND`. The tenant scoping of `shareFloor` (no `branch_id = $3`) is never tested with a foreign floor id. Add one case: tenant A's own branch, `floor_id` = B's floor → `422 { reason: 'not_found' }`, with B's floor id appearing nowhere in the response.

## Notes on the batch report's open items

- Note 3 (`shareFloor` without `branch_id = $3`): acceptable. It stays tenant- and allowed-branch-scoped. See nit 5 for test coverage.
- Note 5 (the program-PATCH vs station-PATCH `40P01` deadlock): agreed it is real and rare. Task 34 should add the case, or `patchStation` should lock the station's programs before updating the station. This is not blocking here.
- Notes 6 and 7 (station type change, `location_label` 1–60): the code matches the notes and §6.9. No finding.
