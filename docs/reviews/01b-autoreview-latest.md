VERDICT: PASS

# 01b batch review: tasks 10, 13, 14, 21, 22 (2026-10-28)

**Scope:** the commits after `06a116b review(01b): batch review`: `13889a0` (R-1 fix), `700ce3f` (autobuild prompt), `ecd44f3` (T10), `0a4785c` (T13), `7d6700a` (T14), `b2ff8a3` (T21), `1e6331f` (T22), `80fd0c1` (docs).

**Checked against:** foundation §6, 01b spec v1.0 §3.1 (B3, B8, B9, B10, B11, B12, B21, B23), §3.2, §3.3, §3.4, §4.3 rows 9–10, §5.1, §5.3, §6 directory write script, §6.3–§6.6, §9, tests #2, #3, #8, #13–#15, #19, #25, #36, #58, #60, #85, #87; plan tasks 10, 13, 14, 21, 22 ("Done when"); AD-13, AD-14.

**What holds:**
- Directory write script order is right: idempotency key first (role POST) → tenants `FOR NO KEY UPDATE` → owner row and B8 → target `FOR UPDATE` in id order → version compare → rules → write → audit → `directory_version + 1` → commit. A no-op skips the bump and the audit (tested in #2), and the version compare runs before the no-op check, so a stale no-op is `409` (B23 test).
- PIN (§6.3, B9): argon2id with M8 parameters, hashed outside the transaction; 404 for a leaver, unknown id or another tenant's person; the audit row holds only `{ has_pin, pin_set_at }`; `pin` is redacted in the logger; never a no-op; version unchanged; bumps the directory, so the hub gets the new hash (#3 hub half ends sessions `credentials_changed`).
- Staff PATCH (§6.4): the `branch_ids` diff leaves the kept `staff_branches` row untouched (#87 checks the ctid); the person's own leads and floors at a removed branch go by FK cascade; whole-list replace for denials, leads and floors; B12 re-runs on a rename or an added branch.
- Roles (§6.5, §6.6, B10): 4 statements; `approver_role_id` is dual-written as the first approver in UTF-16 sort order, with one `role_permission_approvers` row per approver; approvers are checked as active roles of the tenant; the name check is case-insensitive among active roles (backed by the `roles_active_name` index); `staff_count` counts only active staff; the audit `after` leaves out `version` and `staff_count`; replay and mismatch are covered by #60.
- T21: the tenant lock is `FOR NO KEY UPDATE`. #85 proves a menu-item create does not wait on it, and the build log records that the test fails when the lock is switched to `FOR UPDATE`.
- T10: roster responsibilities come from memory, the statement count stays at 2, and the 00 #46 / #82 expectations were widened, not weakened.
- AD-13 is correctly Class B: it adds no code or reason value, the status is the one test #13 asks for, and no other module consumes these new routes. AD-14 is correctly Class B: it only decides which rule checks re-run, with no schema, contract or security effect.
- No skipped or weakened tests. The fixture's `Z…` seed-id space is test infrastructure only.

## Findings

None at Blocker or Should-fix.

## Nits (non-blocking)

- N-1 (T14) `apps/cloud/src/modules/staff-roles/service.ts:178-179`: while task 16 is pending, a body `{ expected_version, is_active: false }` is taken as a no-op and answers `200`, so the person stays active and in the directory. This is tracked on the T16 status row. Task 16 must make this path change state and add a test that fails if `is_active` is ignored.
- N-2 (T14) `apps/cloud/src/modules/staff-roles/repository.ts:316-319` and `0005_staff_roles.sql:86`: removing a branch from a person who leads someone there hits the `staff_leads.lead_staff_id` FK (no cascade), so the call fails with a `500` (pg 23503) instead of the B15 move. Staff responsibilities at the removed branch are also left behind. Both belong to task 16 (status note). Its tests must cover a lead losing a branch, not only a lead leaving.
- N-3 (T14) `service.ts:197` (`checkReportsTo`): with no loop walk yet, `reports_to` naming the person themself reaches the `staff_leads` CHECK and returns a `500`, and a two-person loop A→B→A is stored. Task 15 (loop walk, #27) must include the self-lead case and expect `422 loop`.
- N-4 (T14) staff PATCH runs no admin guards (§3.4) until task 19. This follows the plan's order, but until then a PATCH can remove the last qualifying admin or the owner's own admin access. Do not release before task 19.
- N-5 (T22) `repository.ts:108-113`: the `staff_count` query filters `staff_roles` by `role_id = ANY($2)`. If `staff_roles` has no index leading with `(tenant_id, role_id)`, this scans the whole tenant. That is fine at pilot size; note it for task 25 (archive cleanup uses the same access path).
