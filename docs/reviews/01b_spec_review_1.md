# 01b Spec Review 1 — hostile review of the 01b package

| Field | Value |
|---|---|
| Reviewed | `docs/specs/01b_Staff_Roles_Spec_v0.3.md` (Draft), `docs/specs/00_Hub_Platform_Access_Spec_v1.5.md` (Draft), `docs/specs/01_Restaurant_Setup_Spec_v1.3.md` (Draft), as one package |
| Date | 2026-10-27 |
| Session | Fresh session (CLAUDE.md pipeline step 4) |
| Code read | `apps/cloud/src/modules/owner-auth/*`, `plugins/jwt.ts`, `plugins/tenant-scope.ts`, `cli/seed-tenant.ts`, `cli/issue-registration-code.ts`, `modules/hub-registration/repository.ts` (`loadDirectory`), `modules/staff-roles/default-roles.ts`, `lib/config-version.ts`, `lib/idempotency.ts`, cloud migrations `0001`–`0004`; `apps/hub/src/auth/{apply-directory,staff-directory}.ts`, `apps/hub/src/sync/config-poller.ts`, `apps/hub/src/db/migrate.ts`, hub migration `0003`; `packages/events/src/{directory,config,registry}.ts`, `StaffDirectoryApplied.v1.ts`; `packages/domain/src/permissions.ts` |
| Result | 0 blockers, 9 majors, 12 minors |
| Verdict | **FIX THEN SHIP** |

---

## Major

### M1. `PASSWORD_CHANGE_REQUIRED` is claim-only; pre-reset access tokens bypass it
- **Where:** 01b B5 (L140), §3.7 (L245); 01a §6 (L579, "JWT claim `pwc`").
- **Code:** `plugins/jwt.ts` returns only `sub`, `tenant_id`, `allowed_branch_ids`; tokens live 1 h; nothing compares a token with the password state.
- **Scenario:** an access token is issued at 10:00. Support runs `reset-owner-password` at 10:20. Refresh tokens are revoked, but the 10:00 token has no `pwc` and keeps full `/v1/admin/*` access (PIN set, role edits, marking staff as left) until 11:00. Test 41 only checks the post-reset login's token.
- **Fix:** the JWT tenant guard reads the owner row by primary key (one statement per owner request): `JWT_INVALID` when `iat < password_changed_at`; `PASSWORD_CHANGE_REQUIRED` while the flag is set. The reset CLI also sets `password_changed_at`.

### M2. A refresh racing a password change keeps a 30-day session alive
- **Where:** 01b §6.11 step 5 (L638), §6.14 (L663); 00 §6.23.
- **Code:** `refreshTokens` locks only the presented token row and inserts a successor. The revoke (`UPDATE … WHERE revoked_at IS NULL`, READ COMMITTED) does not see a successor committed after its snapshot.
- **Scenario:** a client holding the old credentials refreshes at the moment the owner changes the password (or support resets it). The successor stays live for 30 days, and the 30 s grace path re-issues it. Test 43 covers a racing login only.
- **Fix:** refresh rejects a token whose `created_at ≤ owner_users.password_changed_at`, read in the same transaction. Test the race.

### M3. The temporary password never expires
- **Where:** 01b §6.14 (L663), B5.
- **Scenario:** support reads the password aloud on a call from a busy kitchen; the owner does not sign in for days; anyone who overheard signs in, is "forced" to choose a new password and owns the account. The password also goes to stdout: over AWS SSM with session logging it lands in S3/CloudWatch, contradicting "never logged".
- **Fix:** `temp_password_expires_at` (e.g. 24 h); login with an expired temporary password → `LOGIN_INVALID`, counted. Runbook: run the CLI in a shell with no session logging.

### M4. The last-admin guard protects the wrong permission
- **Where:** 01b B7 (L142), §3.4 (L214), D-3 (L236, L949).
- **Code:** pairing and revoking need `manage-devices` (`commands/generate-device-pairing-token.ts:20`, 00 §6.7); force-logout needs `manage-staff`. The guard counts only `access-hub-admin`. By D-3 every stock counter holds `access-hub-admin`.
- **Scenario:** the owner removes `manage-devices` from Owner and Manager (or denies it per person). A stock counter with `access-hub-admin` remains, so the guard sees no change → `200`. The branch can no longer pair a replacement tablet or revoke a lost phone (R14) until the roles are fixed from the cloud; while the cloud link is down, not at all. This is B7's own stated reason.
- **Fix:** a qualifying admin needs effective `access-hub-admin` **and** `manage-devices`, both `allowed` (same single SQL, one more term). Same definition for the own-admin guard.

### M5. Default roles have no stable identity; 02 and 03b cannot append grants without role-name matching (R5)
- **Where:** 01b B17 (L152), §6.15 (L672–673), §3.8 (L250), B6.
- **Code:** merged `0003_manage_stock_backfill.sql` already matches `WHERE r.name IN ('Owner','Manager')`. §3.8 says only two files contain role names and §2 says no drift was found; both are wrong. Test 55 will fail on it or must quietly exempt it.
- **Scenario:** the pilot runs when 02 ships; 02 must give the Waiter role `take-order-anywhere`. The only handles are the name (the owner may have renamed it) or `is_default`, which does not say which default a role is.
- **Fix:** `roles.default_key` (`owner|manager|cashier|waiter|cook`, unique per tenant when not null), set by `seed-tenant`; §3.8 allows lookups by `default_key`; test 55 exempts `0003` by name.

### M6. Directory v2 is not additive; an un-upgraded hub rejects the whole poll while the owner app shows it healthy
- **Where:** 01b §4.3.1 (L332), §7.4 (L712), test 24, B19.
- **Code:** the directory is inside `SyncConfigEnvelopeSchema` (`packages/events/src/config.ts:125`); the old `DirectorySchema` requires `approver_role_id`; the envelope parse fails → `rejected/malformed` before any part is considered (`config-poller.ts:145–150`). §7.4's "fails the directory part, keeps its last directory" is wrong: menu, prices, availability and staff removals all freeze. B19 still writes `hub_last_seen_at` on every poll.
- **Scenario:** on release night branch 3's hub upgrade fails. Next morning a fired cashier's PIN still works and price changes do not arrive; S06 says "Hub checked in 1 min ago".
- **Fix:** keep v2 additive by also sending `approver_role_id` (first approver or null); old hubs drop unknown keys. Old hubs treat a scoped grant as branch-wide until upgraded (only `my_stations` is enforced, acceptable). Rewrite test 24. B19 reports the last successful apply, not only the last poll.

### M7. `pin_hash DROP NOT NULL` is labelled "expand" but breaks a cloud rollback
- **Where:** 01b §5.1 (L376), B22 (L157), F §6.8.
- **Code:** v1.4 `loadDirectory` (`repository.ts:114–120`) selects `pin_hash` unfiltered; the schema requires a string.
- **Scenario:** a bug forces a cloud rollback to v1.4 the day after release (the F §6.8 promise). Every branch with a no-PIN person (every Cook, every new hire before the PIN dialog) fails every poll and freezes. Rolled-back code also reads grants with a null `approver_role_id`; hubs skip them and discount approval silently disappears.
- **Fix:** list the nullable `pin_hash` as a B22 contract step; §7.4 states the cloud rolls forward only once `0005` is applied. The M6 dual-send removes the approver half.

### M8. The multi-owner model cannot occur; B7's advice is a dead end and B8 cannot be tested honestly
- **Where:** 01b B7 copy "Ask another owner" (L142, L736), B8 (L143), tests 8, 17, 48, 63; 00 M57 (L280), §6.27 (L1235).
- **Code:** only `seed-tenant` inserts `owner_users` (one per tenant); `issue-registration-code` appends every new branch to every owner.
- **Scenario:** the owner wants to give up the hub admin role and gets "Ask another owner": none exists and none can be created. The only workaround (support re-link) defeats the guard. A partner owner added by hand silently gains every new branch. Tests 8, 17, 48 need hand-built owner rows.
- **Fix:** answer Q10 now: (a) single owner in P1, B8 becomes "covers every branch", B7 copy "Call support"; or (b) an `add-owner` CLI and owner selection in `issue-registration-code`.

### M9. Whole-list PATCH/PUT allow lost updates that silently re-grant revoked permissions
- **Where:** 01b §6.4 (L572, L576), §6.7 (L597), §6.8 (L610).
- **Code:** the tenant lock serialises writes; it does not detect a stale read.
- **Scenario:** the owner removes `apply-refund` from Cashier on the laptop after a theft; a phone tab open on the Cashier role adds `reprint-ticket` and saves the whole grant list; `apply-refund` is back, audited as a normal update. Same for a person's `denied_permissions`.
- **Fix:** `expected_updated_at` (or a row version) on role and staff PATCH and on the responsibilities PUT; mismatch → `409` with a new code (§6.2 append rule).

---

## Minor

- **m1.** The lockout notice only appears at login (§3.7 L246, §6.13 L659); the owner app lives on 30-day refreshes, so the owner may not see it for weeks. Refresh shares `LoginResponse` (`owner-auth/routes.ts:265`), so a required `lockout_notice` breaks refresh serialisation. **Fix:** refresh also returns and clears the notice.
- **m2.** B14 checks only active holders (L149; §3.2 rule 1 is Zod-only). Archiving a role held only by someone who left, then `PATCH {is_active:true}`, gives an active person with zero roles and a PIN in the directory. **Fix:** validate the merged row (≥ 1 role, ≥ 1 branch) in the service.
- **m3.** The directory's role set must include approver roles from `role_permission_approvers` (§4.3 row 5 L293, §7.3 L709). Today's query finds them through `rp.approver_role_id`, which 01b leaves NULL; a branch with no Manager on staff would not receive the Manager role and Cashier's `apply-discount` would be skipped. **Fix:** say so; add a test.
- **m4.** Hub behaviour for `requires_approval` with empty `approver_role_ids` is unspecified now that the DB CHECK is dropped (L406). **Fix:** skip as kind `approver` (M52); test.
- **m5.** B11's no-cycle argument rests on a false premise (L146; 01a S8 L104). FK inserts into `tax_classes`, `categories`, `menu_items` and availability windows take `FOR KEY SHARE` on `tenants`, which conflicts with `FOR UPDATE`; `staff_branches` inserts take `KEY SHARE` on `branches`, which conflicts with the tenant-wide bump. No cycle found from current orders, but the proof is wrong and directory writes queue behind menu writes. **Fix:** `FOR NO KEY UPDATE` on `tenants`; correct S8.
- **m6.** 00 §6.27 `issue-registration-code` not updated for 01b: assigns left staff and no-PIN staff, ignores denials, skips B12, no directory lock. **Fix:** filter `is_active` and denials; add a §4.3 row.
- **m7.** `staff_leads` / `staff_floors` cascade from `staff_branches` (§5.1 L423, L431); a delete-and-reinsert of `branch_ids` wipes leads and floors at kept branches. **Fix:** the spec requires a diff.
- **m8.** B15 re-parenting edits people a partner owner may not cover (B8 vs B15). Check or accept explicitly; moot if Q10 is (a).
- **m9.** §6.9 (L619) says "01a common write script" and "no version bump"; 01a §6 (L579) says every write ends with a bump. Branch name uniqueness has no index; two concurrent renames to one name both succeed.
- **m10.** New name CHECKs have no clamp; test 70 tries only 40 characters, and branch and owner names are unbounded today. `roles_idle` accepts non-minute values while `RoleWire.idle_minutes` is an integer. **Fix:** test 41/61-character names; add `% 60000 = 0`.
- **m11.** Concurrent change-password: the current password is verified before the transaction. A double-tap succeeds twice and the second revokes the first's tokens; a change verified before a support reset that commits after it clears `must_change_password`. **Fix:** step 5 `UPDATE … WHERE password_hash = $verified`, 0 rows → 401.
- **m12.** Test 55 needs a defined grep scope: hub test fixtures and `0003` contain role names (see M5).

## Checked and fine
- `link-owner-staff` tenant checks.
- The clamp preserves `branches_day_settings`.
- Identity upcaster; the registry supports `upcastFromPrevious`.
- Hub DROP/RENAME rebuild of `role_permissions`.
- No runtime code branches on a role name (`roleNames()` only feeds the display).
- No enumeration through change-password (JWT-only; the `422` precedes verification and leaks nothing).

## Verdict
**FIX THEN SHIP.** The design holds; every fix is local. M1–M4 and M6 before approval (security, R14 staff-revoke guarantee); M5, M7, M8, M9 are decisions plus small spec edits.
