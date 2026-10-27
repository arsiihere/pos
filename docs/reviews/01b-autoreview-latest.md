VERDICT: BLOCKERS

# 01b batch review: fixes R-1, R-2 and tasks 26, 28, 30, 31, 32 (6de0948..993880e)

Checked against: foundation §6, the 01b spec §6 directory write script, §4.4 rows 9–13, §6.7, §6.9, §6.10, B8, B14, B16, B20, B23, and tests #5, #34, #45–#48, #59, #63, #76, #80, #82, #88, #102 and #104. Also checked: the plan tasks' "Done when", AD-15 (reopened by the last review), the AD-18 amendment, and AD-20 to AD-22.

## R-1 Blocker (R-1 fix 6de0948 / T25, and T16 via AD-15): cascaded responsibility-set changes write no `responsibility` audit row

- Code: `apps/cloud/src/modules/staff-roles/service.ts:407-411` (role archive) and `service.ts:262` (leaver).
- The §6 directory write script requires `writeConfigAudit` with one row per changed entity, and it lists both cascades by name: "responsibility entries deleted with a leaver" and "an archived role". The code already treats each branch's responsibility set as a changed entity, because it lists that set in `changed_versions.responsibilities` with a new version. Yet neither path writes a `responsibility` / `update` row for it. The R-1 fix in this batch added the per-holder `staff` rows, then stopped. The AD-18 amendment calls the per-entity rule "spec-mandated, not a decision", which applies equally to the responsibility sets. The last review explicitly reopened AD-15 for this batch, and it is still not addressed. Choosing to write fewer audit rows than §6 requires is not a Class B decision (same reasoning as the previous R-1).
- Failure scenario: Branch A's responsibilities say "Shift lead counts stock at Grill". The owner archives Shift lead. `setRoleArchived` deletes that responsibility row, and the response lists A in `changed_versions.responsibilities` with a new version. `config_audit` gets one `role` / `archive` row and the holders' `staff` rows, but no `responsibility` row for A. An auditor reading A's responsibility history sees the Grill counter disappear with no record. The leaver case is the same: when Bilal leaves, his `count_stock` entries are deleted silently.
- Required fix:
  - For each branch whose active responsibility set the cascade changed, write one `responsibility` / `update` row with `branch_id` set. Its `before` / `after` must be the active set in wire shape, built with the GET's statement before and after the delete.
  - Write no row for a branch where only rows at an archived station were deleted, because its active set did not change.
  - Extend #5 (archive) and the leaver test to assert these rows.
  - Amend AD-15 the same way as AD-18 (spec-mandated). If the implementer still reads this as open, park it as P-n instead of deciding it.

## R-2 Should-fix (T28): the stock query's `meta_version` ignores the `my_stations` scope, so a scope change mid-session does not reach the page

- Code: `apps/hub/src/queries/stock.ts:31`. `metaVersion` is `${config_version}.${start}`, but under B20 `items_meta` and `items` now depend on the directory: the person's `count_stock` stations and their `manage-stock` scope. A directory change (`directory_version`) moves neither part of the version.
- Failure scenario:
  1. A stock counter has the stock page open for station S1.
  2. The owner also gives them S2 through `PUT …/responsibilities`, and the directory syncs to the hub.
  3. The next poll sends the same `meta_version` and `stock_version`, so the hub answers `unchanged: true` with `items_meta: null, items: null`.
  4. `StockApp.tsx:163-164` keeps the old rows. S2's items stay missing until a menu or config change, a day open or close, a stock movement, or a page reload.
  5. Even when stock moves, `items` includes S2's items but `items_meta` is still null. The page builds its rows from `meta` (`StockApp.tsx:178`), so S2's rows still do not show.
  6. The reverse happens when a role's scope changes from `my_stations` to `branch`.
- Required fix: make the meta part of the version depend on the scope, without an extra statement. For example, append a scope key: `b` for scope `branch`, or a short hash of the in-scope item ids under `my_stations`. Then an in-scope change returns fresh `items_meta` and `items`. Add a test: query, change the directory with `seedDirectory`, query again with the returned versions, and expect the new items.

## Nits (non-blocking)

- N-1 (T26, AD-20): spec test #63 still says "marking themselves as left → `409 OWN_ADMIN_ACCESS`", which contradicts J-6 and #101. AD-20's reading is right, but the spec stays self-contradictory. An auto-patch (v1.0.1, test #63's wording only) would stop the next reader from tripping over it.
- N-2 (T30 / R-2 fix): `checkGrants(…, roleId)` treats the role being written as active even when the PATCH edits the grants of a role that stays archived. That is harmless: restore re-checks the grants, and an archived role grants nothing. But the comment says "counts as active here" without saying the role is still archived.
- N-3 (R-1 fix): `selectRoleHolders` repeats the holder list that `setRoleArchived` already returns. The archive path now costs two extra statements: holder ids, then staff before and after. Fine at pilot scale; one `selectStaff` keyed by role would do.
- N-4 (T28): until task 29, a `my_stations` holder can still `OpenBusinessDay` / `CloseBusinessDay` (§4.4 row 12, D-6). This is expected interim state. Keep T29 next so the gap does not ship.
- N-5 (T31, AD-22): the `branch` audit row holds `{ name }` only, while `branch_settings` rows hold the three settings fields. Both are fine. The build log or AD-22 could say that 01a's "`before` = the locked row" is read as "the fields the route owns" for both.

## Checked and fine

- R-2 fix: restore runs `checkGrants` on the stored grants. A role that approves its own grant still restores, and an archived approver → `422 role_archived` with nothing written.
- T26: #63, #76 a–d and #82 assert codes, `branch_ids` and "nothing written". The tests were watched failing with the guards removed.
- T28: the scope check comes after the 01a checks (AD-21, a valid Class B: no new code or shape). `item_ids` lists every outside item. The rejected commands append nothing and leave no `processed_commands` row. The query keeps 1 statement, and a holder with no stations sees none.
- T30: the version hook is called at all three in-transaction compares, and #104's source check is real. #80 and #102 were watched failing with the cascade marks removed.
- T31: its own script (B8 → `FOR UPDATE` → no-op → update → 23505 `branches_name` → `409`), no version bump, tenant-filtered lock → 404 across tenants. #88 runs 10 concurrent pairs. `AuditEntity` `branch` is allowed by the 0005 CHECK.
- T32: the merged stale ≤ gap check → `400 VALIDATION_FAILED` on `day_min_gap_hours`, in the same issue shape as 01a. The no-op writes nothing. Exactly one branch's `config_version` is bumped (#45). GET is 1 statement, with the guard read excluded. B8 → 403 is tested.
