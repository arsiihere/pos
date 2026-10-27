VERDICT: BLOCKERS

# 01b batch review: tasks 17, 18, 20, 25, 27 (202dd11..cfaf4cf)

Checked against: foundation §6, 01b spec §3.4, §3.6, §6 (directory write script), §6.4, §6.7, §6.8, B14, tests #1, #5, #9, #11, #16, #32, #35, #101, #103; the plan tasks' "Done when"; AD-18 and AD-19.

## R-1 Blocker (T25, AD-18 (2) is not a valid Class B decision; test #5 contradicts the spec)

- `apps/cloud/src/modules/staff-roles/service.ts:390-411` and `apps/cloud/test/staff-roles/role-archive.int.test.ts:242,282`.
- The spec does not leave this open. The §6 directory write script says `writeConfigAudit (one row per changed entity …)`. The same paragraph names "a role archive removing the role from its holders" as a cascade that changes those staff records' versions. Test #5 says "role assignment writes exactly one `config_audit` row per changed entity". §6.4 follows the same rule for cascades: every B15 move writes its own `staff` row. AD-18 calls this a spec gap and chooses to write only the `role` / `archive` row. That changes the behaviour of the immutable audit log, which is a story requirement (E6 AC5). It should have been followed as written or parked; it was not a Class B decision.
- Failure scenario: Bilal holds Waiter and Shift lead. The owner archives Shift lead. Bilal's `role_ids` changes from `[waiter, shift]` to `[waiter]` and his version changes, but no `staff` audit row records it. An auditor reading Bilal's history cannot see when or why he lost the role. The #5 test asserts exactly one row for this archive, while its holder `p` loses the role in that same write, so the test protects the behaviour the spec rules out.
- Required fix: on archive, write one `staff` / `update` row per former holder, with `before` / `after` in wire shape (role_ids before and after). Change #5 to expect 1 + holders rows, and assert that the holder's row exists. Change AD-18 (2) to record the decision as spec-mandated. If the implementer still reads this as ambiguous, park it as P-n (audit behaviour) instead of deciding it. (AD-15's leaver → `responsibility` cascade has the same gap; it was accepted in an earlier batch, but it should be looked at again together with this one.)

## R-2 Should-fix (T25): restore does not check the stored grants against §6.6

- `apps/cloud/src/modules/staff-roles/service.ts:363`: `checkGrants` runs only when `body.grants` is sent. A restore (`archived: false`) re-checks only the name.
- Failure scenario: role X has `apply-discount` `requires_approval` with approver Y. Archive X. Y can now be archived, because B14 only blocks an approver of an **active** role. Restore X. X is active again with a grant whose only approver is an archived role. §6.6 ("approvers active roles of the tenant") fails on the merged row, which §6.7 ("rules as §6.6") requires. On the hub, B18 then drops or skips the approver, so cashiers holding X can never get a discount approved, and nothing warns the owner.
- Required fix: on restore, run the approver check on the merged grants (stored grants when `grants` is not sent). Answer `422 CONFIG_REFERENCE_INVALID { field: 'grants.N.approver_role_ids.M', reason: 'role_archived' }`, an existing code and reason, with nothing written. Add a test.

## Nits (non-blocking)

- N-1 (T27) `service.ts` `putResponsibilities`: the no-op comparison runs before `checkResponsibilities`. A body that repeats a station, or that has an empty entry naming a foreign or archived station, gets `200` when it collapses to the stored set and `422` otherwise. AD-19's "repeated station → 422" therefore depends on state. Consider running the per-entry station checks before the no-op comparison.
- N-2 (T25) `roleUsedBy` / `setRoleArchived` filter `staff_roles` by `role_id`, but the only index is the PK `(tenant_id, staff_id, role_id)`, so each query scans the tenant's rows. That is fine at pilot scale, and merged migrations are frozen. Note it for a later migration.
- N-3 (T20) `guards-race.int.test.ts`: between runs, the test deletes every `staff_branches` row at branch C. That leaves active staff with no branch, which §3.2 rule 1 forbids. The test does not depend on this, but it leaves invalid fixture state behind. Deactivating the two admins, or giving each run its own fixture, would be cleaner.
- N-4 (T17) `poller-leaver.int.test.ts` builds the "after" directory by hand from `aDirectory` instead of from the cloud's `loadDirectory` output. P-3 allows this, but the cloud and hub halves of #9 are linked only by a comment.
- N-5 (T27): plan task 27 lists `apps/cloud/test/cross-tenant.int.test.ts`, but the change was made in `test/helpers/route-cases.ts`. That is correct if cross-tenant iterates `ROUTE_CASES`. The build log should say so.

## Checked and fine

- T17: `STAFF_LINKED_TO_OWNER` is checked after the version and no-op checks and before `qualifyingAdmins`, so the answer is the same with or without a second admin. #101 covers the hand-linked row that is not an admin.
- T18 / T20: the tenant lock serialises the writes. Both race tests are 20 runs, and both were watched failing with the lock removed. #11 asserts the 409 code and branch.
- T27: GET is 1 statement (`pgCounter`). The PUT compares and replaces active-station rows only, and #103 shows the archived station's rows survive. The PUT bumps `directory_version` and writes one audit row with branch_id. The DB CHECK already allows the `responsibility` entity.
- AD-18 (1) (run the role-PATCH guards from T25) and AD-19 are valid Class B decisions: they use existing codes and reasons and change no wire shape.
