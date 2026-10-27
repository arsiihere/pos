VERDICT: PASS

# 01b batch review: tasks 15, 16, 19, 23, 24 (2026-10-28)

**Scope:** the commits after `30bca55 review(01b): batch review`: `08ef777` (T15), `93c27a0` (T16), `1df74d0` (T19), `ee8c4cd` (T23), `aa2f6dd` (T24), `2c117c7` (docs).

**Checked against:** foundation §6 (envelope, `DomainError` codes), 01b B7, B8, B11, B12, B13, B15, B21, B22, B23, §3.2 rules 1/5, §3.4, §3.5, §3.6, §6 directory write script, §6.4, §6.7; tests #10, #17, #18, #26–#30, #57, #69, #79; plan tasks 15, 16, 19, 23, 24 "Done when"; the Interfaces "Cloud guards" block; AD-15, AD-16, AD-17.

**Run:** `guards`, `leaving`, `reports-to`, `role-patch`, `roles`, `cross-tenant` int tests: 6 files, 26 tests, all pass.

**Previous nits closed:** last review's N-1 (`is_active` now applied, #10), N-2 (a lead losing a branch moves their reports first, then the branch row goes, #30) and N-3 (a self-lead and A→B→A give `422 loop`, #27). N-4 (staff guards) is done by T19.

## What holds up
- **Guards (§3.4, B7):** `qualifyingAdmins` is one statement (`pgCounter` = 1), evaluated after the tenant lock both before the rules and after the write. Own-admin runs first, then the fail-safe `owner_not_linked` (anyone who stops qualifying at a branch), then last-admin over `A_before \ A_after` only, so branches with no admin before are not blocked. The signature matches the Interfaces block. A stock counter (`access-hub-admin` only) is shown not to qualify.
- **B15 / §3.5:** reports are re-parented to the leaver's own lead (or have their row deleted) before `removeBranches`. This is needed because the `lead_staff_id` FK has no cascade. Each move writes one `staff` / `reports_to_reassigned` audit row with `{ branch_id, lead_staff_id }` and its branch, and appears in `moved_reports` and `changed_versions.staff`. The leaver's own lead rows are deleted. Staff responsibilities are deleted at every branch (leaving) or at the removed branch, and those branches go into `changed_versions.responsibilities`, built by the one builder (B23).
- **Loop walk:** one recursive statement per `reports_to` entry, capped by the branch's active staff count, and it stops when it reaches the person. Leads from other branches are not counted (checked in #27).
- **Role PATCH (§6.7 without archive):** target is locked `FOR UPDATE` after the tenant lock; a missing or foreign role gives `404 ROLE_NOT_FOUND`. The version is compared before the no-op check, so a stale no-op still answers `409`. §6.6 grant rules run on the sent grants, and the name is checked only when it changes. `default_key` is never written. `replaceGrants` cascades to the approver rows and dual-writes `approver_role_id`, checked by #79 against the v1.4 SQL fixture. Exactly one `role` / `update` audit row, with grants and without `version` / `staff_count`.
- **Class B review:** AD-15 (a leaver's sent `reports_to` is ignored; one person audit row `left`/`returned`/`update`; extra responsibility branches may be listed), AD-16 (shared person predicate; CLI behaviour unchanged from AD-6) and AD-17 (`archived` accepted, not yet applied) leave event schemas, the sync contract, request/response shapes, error codes, money/stock and auth unchanged. They are correctly Class B.

## Findings
No Blockers and no Should-fix.

## Nits (non-blocking)
- N-1 (T24) `apps/cloud/src/modules/staff-roles/service.ts:325-373`: role PATCH runs no admin guards yet (§3.4 lists role PATCH grants). Right now a grant edit can remove `manage-devices` from the Owner role and leave every branch without a qualifying admin. The plan assigns this to task 26 (#63, #76), but the T24 status note records only the `archived` interim. Add "no guards until T26" to that note, and do not release before T26.
- N-2 (T23/T24) #18 cloud half: `idle_minutes` 0 / 241 → `400` is tested only on `POST /roles`. `RolePatchBody` uses the same `IdleMinutes`, but no PATCH case would catch a later schema split. Add the PATCH case when task 30 touches the file.
- N-3 (T15) `repository.ts` `leadLineReaches`: the hop cap ("≤ active staff", plan Done when) is never exercised. No test builds an existing cycle that does not include the person (hand-written SQL) to show the walk ends and answers "no loop" instead of hanging.
- N-4 (T16) #10 "no `credentials_changed`" is shown only indirectly, by the same `pin_hash` in the cloud `loadDirectory`. The hub apply is not run. That is acceptable as 00 code (P-3 pattern), but T17's hub test (`poller-leaver.int.test.ts`) could also assert a returner raises no `credentials_changed`.
- N-5 (T19) #69 "after `seed-tenant` the link is set" is simulated by an SQL `UPDATE owner_users SET staff_id`. `seed-tenant` setting the link is covered elsewhere (T48), so this is wording only.
