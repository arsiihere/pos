VERDICT: BLOCKERS

# 01b batch review: tasks 42, 45, 49, 50 (0f9ad19..ef31407)

Checked against: foundation §6; the 01b spec §6.11 (Retry), §6.12, §6.13, §6.15a steps 1–11, §8, §9; tests #61, #62, #72, #74 a–b, #97, #100; the plan's "Done when" for tasks 42, 45, 49 and 50; AD-25 to AD-28. I re-ran the 10 test files in this batch: 36/36 pass.

## Should-fix

- **R-1 (Should-fix, T45 / AD-25)**: `docs/specs/01b_Staff_Roles_Spec_v1.0.md:1054` (test #97), `apps/cloud/test/cli/link-owner-staff.int.test.ts:180`.
  - **Problem:** test #97 says Y is not a qualifying admin at B because of "a denial of `manage-devices` at B". `staff_permission_denials` has no branch column (00 0001), so that state cannot exist, and the test was rewritten with B as a branch Y is not assigned to. The decision itself is sound and is Class B: no schema, contract or security change, and the CLI is unchanged. But it changes what a spec test says without patching the spec. AUTOBUILD says: "If the spec text itself must change, patch the spec as a minor version … 'auto-patch AD-n'".
  - **Failure scenario:** the spec still describes a test that cannot be built. A later task or human reviewer who checks #97 against the spec finds a test that does not match its text. T46 (#95, "a denial of `access-hub-admin`") or a future 01b revision could also "fix" the schema to fit the stale text, adding a per-branch denial, which is a schema change used by 00.
  - **Required fix:** patch the spec to v1.0.1, changing #97 to "at B and C it is not assigned (denials are per person, not per branch)". Add a change-log line "auto-patch AD-25", and note the patch in AD-25. No code change.

## Nits (non-blocking)

- N-1 (T50): `apps/client/src/api/cloud-admin.ts:403`. `changePassword` goes through the shared `call`. On `401 JWT_INVALID` that path refreshes and re-sends the non-idempotent change. On a double-tap (§6.11 Retry, test 90), the second request can get `JWT_INVALID` before the first's `200` has stored the new pair. It would then refresh with the old refresh token (refused because `cv` no longer matches) and log the owner out, although "the first response's tokens stay valid". This is harmless once T55 disables the submit button while a request is in flight. Mention it in T55 or skip the refresh-and-retry for this one call.
- N-2 (T50): `apps/client/src/features/owner/Shell.tsx:37,39`. Staff and Teams both use the `user` icon.
- N-3 (T50): the plan puts the owner menu under `apps/client/src/components/`, but it lives in `features/owner/Shell.tsx`. This is a correct Class A path fix, but the build log does not mention it.
- N-4 (T49): `getTeamTree` silently drops people in a lead cycle (they are never roots and never reachable). §3.5 refuses loops on write, so this cannot happen today. A one-line comment would make the assumption explicit next to AD-28's "nobody active is hidden".

## Checked and fine

- **T42:** `afterOwnerRowLock` fires right after the owner-row lock on login, change and refresh. It is passed only when `testHooks` is set. #74 a shows the refresh's access token → `401 JWT_INVALID` on `/v1/admin/staff`, its successor → `401 REFRESH_TOKEN_INVALID`, and the change's token still working. #74 b shows the refresh → `401 REFRESH_TOKEN_INVALID` with exactly 2 token rows (none from the refresh). Waiting is proven with `pg_stat_activity` lock waiters, which is safe because cloud files run serially. Status records the check with the lock removed.
- **T45:** §6.15a steps 1–11 run in order, in one `SystemContext` transaction. The lock order is tenant → owner row (`FOR NO KEY UPDATE`), with `afterTenantLock` after the tenant lock.
  - Step 4: the refusals come in spec order. The "linked to another owner" check leaves out the acting owner's own row (AD-26, correct: that case is step 6's no-op).
  - Step 5: the target is printed before the no-op and confirm-name checks.
  - Step 7: the name comparison is exact, with no trim.
  - Step 8: a tenant with no branch is refused.
  - Step 9: one `qualifyingAdmins` statement, the same §3.4 SQL as the guards, lists every failing branch by name and id.
  - Step 10: the audit is `owner_user` / `update`, `actor_kind 'cli'`, `{ staff_id }` old → new, with no directory bump.
  - The tests: `expectRefused` asserts link unchanged, no audit row and no directory bump on every exit-1 path, including the usage path. #72 also asserts that test 69's write then gets `OWN_ADMIN_ACCESS` without `owner_not_linked`. #100 covers missing, case, double-space and trailing-space names, with the summary printed each time.
  - AD-26 (output format) is Class B.
- **T49:** 3 statements (counter reset at `handlerStart`, so the guard read is excluded). The count is re-checked after 6 more staff. The tree is built in memory and ordered `lower(display_name), staff_id`. `role_ids` are JS-sorted (§5.3). `has_pin` comes from `pin_hash IS NOT NULL`. A leaver is absent. A branch outside the JWT list and another tenant's branch both → `404 BRANCH_NOT_FOUND`. The route is added to `ROUTE_CASES` (AD-8) so the cross-tenant and guard sweeps cover it. #62 cloud half: a no-PIN Cook saved with `reports_to` shows in the tree and is absent from `loadDirectory`. Hub half: not in the roster, `POST /auth/pin` → `404 STAFF_NOT_FOUND`, no `auth_lockouts` row, no event. AD-28 is Class B (read-only display, defensive).
- **T50:** each API call's method, path, body and `Idempotency-Key` are asserted against §6. Only creating POSTs carry a key, and change-password carries none (§6.11). `changePassword` stores the new pair and clears `must_change_password`. That follows §6.11 (every older token dies; "the client keeps the first response"), so AD-27 is not a hidden session decision. `applyChangedVersions` returns a new store and leaves the old one unchanged. The router covers all six §8 hashes plus their edit routes and rejects others. The §8 support copy matches word for word. The test checks every `perm.<key>` from `PERMISSIONS`, every §9 code and every new reason. Missing Urdu is tracked in `docs/design/handoff/01b/urdu-todo.md` and enforced by the test, which meets the plan's "Done when". The request types are type-only additions to `@pos/events`, with no schema change.
- Scope: no file outside the four tasks, no migration touched, no test skipped or weakened.
