VERDICT: PASS

# 01b batch review — tasks 1, 5 (2026-10-27)

Scope: no earlier `review(01b)` commit, so every 01b commit on the branch: `c8fe165` (task 1), `736506c` (task 5), `e78a327` (status board, build log). Checked against foundation §6, 01b spec v1.0 §3.3, §4.2, §5.1, §9, tests #70 and #77, plan tasks 1 and 5 ("Done when", Interfaces Domain block), and AD-1, AD-2.

## What was checked
- `0005_staff_roles.sql` is the §5.1 block line for line. The only change is the `password_changed_at` comment ("audit and display"), which the plan requires. Constraint names match the D-5 list. The clamp runs before the tightened CHECKs. No file under `apps/cloud/src/` other than the SQL changed.
- No cloud source path writes `staff.is_active = false`, so the new `staff_left` CHECK breaks no runtime writer. The only test fixture affected (`hub-registration`) was fixed as the plan says. Branch-name uniqueness in `issue-registration-code` and `default_key` in `seed-tenant` belong to tasks 34 and 48; they are out of scope here.
- Domain: `PERMISSION_SCOPES` matches the §3.3 table (`own_tables` is on no permission). `PERMISSION_CATALOGUE`, `SCOPES`, `Scope`, `DEFAULT_KEYS` and `DefaultKey` match the plan's Interfaces block. The nine §9 codes have the right statuses. `index.ts` already re-exports `permissions.js`.
- AD-1 is correctly Class B (really a test technique; no schema, spec or contract change). Two active "Manager" roles cannot survive `roles_active_name` in the same migration, so testing the backfill on a rolled-back prefix of the real SQL checks the spec rule without changing it.
- AD-2 is correctly Class B. Catalogue groups only affect the roles editor layout; they have no schema, API, sync or security effect. All six groups are used.
- P-1 (the foundation §6.2 edit) is parked correctly. `errors.ts` is ahead of foundation §6.2 until the human answers it.
- No money, stock, event, sync, auth or lock code in this batch. No tests skipped or weakened.

## Findings

No Blockers. No Should-fix.

- **R-1 (Nit, T1)** `apps/cloud/test/db/staff-roles-migration.int.test.ts:61` — #70 shows that the migration committed and that each constraint is `convalidated`, but it never re-reads the 40/60-character rows. A future migration could silently truncate names and #70 would still pass. Fix: assert the branch name is still 60 characters and the staff and role names are still 40 after `migrate()`.
- **R-2 (Nit, T1)** `apps/cloud/test/db/staff-roles-migration.int.test.ts:113` — the duplicate-"Manager" case cannot tell "smallest role_id" apart from "first inserted", because the extra role is both larger and inserted later. Fix: insert a role with a smaller id (for example `'00000000000000000000000000'`) after the seed, and expect it to get the key.
- **R-3 (Nit, T1)** `apps/cloud/test/helpers/scratch-db.ts:38` — a crashed run leaves its `pos_test_0005_<pid>_*` databases behind. The build log already reports 12 from an earlier process. Fix: in `scratchDatabaseAt`, drop any `pos_test_0005_%` database whose pid is no longer running, or document a manual cleanup step in the runbook.
- **R-4 (Nit, T5)** `packages/domain/src/permissions.ts:54` — `GROUPS` is listed in `PERMISSIONS` order rather than by group, so reviewing AD-2 means reading it twice. Fix: order the entries by group, or add a comment that points to AD-2.
