# 01b Staff and Roles — Module Spec v1.1

## §1. Header

| Field | Value |
|-------|-------|
| Module | 01b Staff and Roles: cloud staff and role admin, PINs, teams (reports to) and the team tree, stock-counting responsibilities, branch name and settings, owner change password and lockout notice |
| Version | **v1.1** (2026-10-28, as-built clarifications; human rulings on the 01b auto-decisions): the behaviour the merged 01b code ships where v1.0.1 left a gap, from AD-2, 4, 9, 11, 11-sup, 13, 14, 15, 18, 19, 21, 22, 23, 28 (contract level, so a minor bump) and AD-20, 26, 27, 31, 32, 33; §4.4 points at 01a v1.3.1. No migration, event schema version or error code is added. Two parts that contradict v1.0.1 text are **not** applied and stay open (§1.6, §12.3). Each edit carries an "As built, v1.1 (AD-n)" marker. **v1.0.1 — APPROVED** (auto-patch AD-25, 2026-10-28: test #97 states B as a branch Y is not assigned to, since `staff_permission_denials` has no branch column; no behaviour change). **v1.0** approved by the owner (2026-10-27): the approved text of v0.5, renumbered v1.0 at approval as every spec is (00 §12.1, 01a v0.7.1 → v1.0); no content change from v0.5. Approved together with 00 v1.5 and 01a v1.3 (which supersede 00 v1.4 and 01a v1.2). Owner visit answers Q3, Q7, Q8, Q11, Q12 applied in the approved text. **v0.5 over v0.4:** hostile review 2 (`docs/reviews/01b_spec_review_2.md`, 4 majors, 6 minors, FIX THEN APPROVE) applied: N1–N6 and N9 fixed, N7, N8, N10 deferred (§1.5, §12.4); judgment calls logged in §1.4. **v0.4 over v0.3:** every finding of hostile review 1 (`docs/reviews/01b_spec_review_1.md`, 9 majors, 12 minors) applied, with the developer's decisions: single owner in P1 (M8 / Q10 option a), 24 h temporary password (M3), `roles.default_key` with a backfill (M5) (§1.3). Developer decisions D-10 to D-14 applied the same day (§1.4). Next: owner reading, then approval of the package. **v0.3 over v0.2:** decisions D-6 to D-9, owner answers Q1, Q2, the `owner_users.staff_id` fail-safe, the `link-owner-staff` CLI and the B22 analysis (§1.2). **v0.2 over v0.1:** fixes the G2 gate check of v0.1 (§1.1); developer decisions D-1 (own-admin guard), Cook role, team tree; owner answers Q4, Q5, Q6, Q9 confirmed. |
| Depends on | Foundation v1.7 (APPROVED — FINAL); 00 Hub Platform & Access v1.4 (APPROVED, implemented); 01a Restaurant Setup v1.2 (APPROVED, implemented) |
| Inherits | **Shared Standards from Foundation v1.7 §6**, unchanged. Overrides are named in §3.1 (B-rows) with the section they override |
| Changes other specs | **00 → v1.5:** §3.1 M10, M29, M52, M57, M73 (and new M93 recording the package); §3.6; §4.2 (`StaffDirectory`, `applyStaffDirectory`, `StaffDirectoryApplied`); §5.1 (hub migration `0005`); §5.2 (`staff`, `owner_users`, `roles`, `role_permissions`); §6.5 (directory shape); §6.19; §6.20; §6.22; §6.23; §6.24a (new: JWT guard); §6.26; §6.27; §6.33 (note only); §7.2; §7.10. **01a → v1.3:** §3.1 S8, S26 (and new S60 recording the package); §4.4 (01b row); §5.2 (`branches` CHECKs and name index, `config_audit`); §6 shared failures and §6.0; §6.1; §6.7; §6.7b; §6.17; §6.17a; §6.18; §6.18a; §6.18b; §6.19; §8.2; §12.5; §3.4 (poll interval constant, D-11); §7.8 (roll-forward-only release step, review 2 N5; optional `VITE_SUPPORT_PHONE` build value, Q3). Every change is a row in §4.3 (00) or §4.4 (01a), and each target section carries a "Changed by 01b" marker. 00 v1.5 and 01a v1.3 are approved together with 01b (2026-10-27) and supersede 00 v1.4 / 01a v1.2 |
| Tier | T2 Production (foundation §1) |
| Milestone | A (pilot). Build order R21: **01b → 01d → 01c → 03a → 02 → 04** |
| Inputs | Design hand-off `pos-design-01b-handoff/01b` (`01b-design.md`, 30 frames); `docs/design/open-questions/01b-staff-roles.md` Q1–Q21; README R5, R14, R18, R21–R25; brainstorming decisions of 2026-10-27 (B1–B8); developer decisions of 2026-10-27 after the gate check (B7 own-admin guard, B17 Cook role, team tree §6.12); owner confirmations Q4, Q5, Q6, Q9 (2026-10-27) |

### 1.1 Changes in v0.2 (gate check G2 on v0.1)

| Gate item | Change | Where |
|---|---|---|
| 1, 4 | Every change to 00 listed in one table, each with a B-row | §4.3, B2–B5, B7, B10, B17, B18 |
| 2, 4 | Every change to 01a listed in one table, including the `PASSWORD_CHANGE_REQUIRED` guard per route and S26 | §4.4, B5, B11, B13, B16, B19–B21 |
| 3 | 00 M29 overridden by name: Cook and Waiter are team-membership roles; M30 unchanged | B17 |
| 4 | §5.1 is "Expand + contract, coordinated"; contract steps named and the F §6.8 override recorded; hub migration SQL added | §5.1, §5.2, B22 |
| 5 | Team tree implemented (E6-TEAM AC4) | §6.12, §8, test 61 |
| 6 | New tests 57–67; R3 row; tests 55, 56 in build steps | §10, §11 |
| 7, c, d | Story and carried-row test references corrected | §1 |
| 8, g | Reasons `wrong_branch`, `one_lead_per_branch` added; `role_archived` produced by §3.2 rule 2 | §3.2, §9 |
| 9, e, f | Guard list and dangling reference fixed | §3.4 |
| 10, h | Statement counts | §6.1, §6.5 |
| 11, i | change-password counts the per-IP failure | §6.11 |
| 12, j | B15 audit row named | B15, §5.1 |
| 13, 14, k, l | Endpoint count and checklist include CLIs, team tree and changed routes; 00's split rule checked | §6.16, §12.2 |
| 15 | [ASSUMPTION] tags inline; confirmed answers untagged | throughout, visit list |
| 16 | Why change-password does not trigger 00's split rule | §6.16 |
| 17 | D-1 decided: own admin role removal is blocked | B7, §3.4, `OWN_ADMIN_ACCESS` |
| a, b | Changes-to-other-specs lists complete | header, §4.3, §4.4 |

### 1.2 Changes in v0.3

| Item | Change | Where |
|---|---|---|
| D-6 | `OpenBusinessDay` and `CloseBusinessDay` need `manage-stock` with scope `branch`; a `my_stations` holder gets `403 PERMISSION_DENIED { reason: 'outside_scope', required_scope: 'branch' }` (the existing `outside_scope` reason, B20). The stock query tells the page the scope, so it hides the day actions | B20, §4.4 rows 12–13, tests 68, 71 |
| D-7 | Team tree is `GET /v1/admin/branches/:branch_id/team-tree` | §4.2, §6.12, §12.2, test 61 |
| D-8 | Team-membership roles are defaults only; no code branches on a role name | B17, §3.8 |
| Q1, Q2 | Confirmed by the owner: discount approver Manager; Waiter and Cook start with no permissions | §6.15, B17, visit list |
| `staff_id` null | The own-admin guard fails safe: with no link, a write that takes `access-hub-admin` from anyone is refused | B7, §3.4, §9, test 69 |
| B22 | Rewritten with the write paths checked in code; a test that no existing row breaks a new CHECK | B22, test 70 |
| D-9 | Decided: no client-version gate or clamp now; "never block the queue on a rejected value" is a requirement carried to 06, listed in §4.5 and in the README's carried-requirements table | B22, §4.5 |
| `link-owner-staff` | New support CLI sets `owner_users.staff_id`, so an `owner_not_linked` owner can be fixed without re-seeding | §6.15a, §7.5, §8, §9, test 72 |

### 1.3 Changes in v0.4 (hostile review 1, `docs/reviews/01b_spec_review_1.md`)

| Finding | Change | Where | Test |
|---|---|---|---|
| M1 | The JWT guard reads the owner row on every owner request: a token issued before the last password change or reset (compared by `iat_ms`, D-10) → `401 JWT_INVALID`; `must_change_password` is read from the row, not from a claim. The `pwc` claim is dropped *(v0.5: compared by `credential_version`, §1.5 N1)* | B5, §3.7, §6.13, §4.3 rows 11, 12, 18, §4.4 row 1 | 41, 42, 65, 73, 91 |
| M2 | Refresh locks the owner row `FOR SHARE` before the token row and rejects a token created before `password_changed_at`; change-password and `reset-owner-password` update the owner row before revoking. **Corrected from the review's wording**, whose `created_at` check alone misses one interleaving (§6.13) *(v0.5: `FOR NO KEY UPDATE` and `credential_version`, §1.5 N1, N2)* | B5, §3.7, §6.13, §6.14, §4.3 row 12 | 74 |
| M3 | Temporary password expires after 24 h (`temp_password_expires_at`); runbook: run the CLI in a shell with no session logging | B5, §3.7, §5.1, §6.13, §6.14, §7.5, §4.3 rows 2, 11 | 75 |
| M4 | A qualifying admin holds `access-hub-admin` **and** `manage-devices`, both `allowed`; both guards use it | B7, §3.4, §9 | 76 |
| M5 | `roles.default_key` (replaces `is_default`), set by `seed-tenant`, backfilled by the migration; §2 and §3.8 name `0003`'s role-name match; test 55 has an exact scope | B6, B17, §2, §3.8, §4.2, §5.1, §6.15, §4.3 rows 3, 14 | 20, 55, 77 |
| M6 | Directory v2 is additive: `approver_role_id` is still sent, so hubs not yet upgraded keep applying; §7.4 and test 24 rewritten; B19 records the last poll and the last poll that found the hub up to date (`hub_synced_at`) | B18, B19, §4.2, §4.3.1, §7.4, §4.4 rows 6, 7 | 24, 67, 78 |
| M7 | `pin_hash` nullable is a contract step: the cloud rolls forward only; `role_permissions.approver_role_id` is dual-written and its CHECK kept, so a rolled-back cloud still sends valid approvers | B22, §5.1, §7.4 | 79 |
| M8 | Single owner in P1: B8 is "the owner covers every branch"; per-person coverage, `can_edit`, `can_edit_roles` and `staff_outside_branches` removed; B7 copy "Call support"; multi-owner deferred (§12.4). Finding m8 is moot | B7, B8, §5.3, §6.1–§6.5, §8, §9, §12.4 | 8, 17, 48, 63 |
| M9 | Optimistic concurrency: staff and role `PATCH` and the responsibilities `PUT` carry `expected_version`; a stale one → `409 CONFIG_STALE` | B23, §5.3, §6.1, §6.4–§6.8, §9 | 80 |
| m1 | Refresh also returns and clears the lockout notice | §3.7, §6.13, §4.3 rows 12, 13 | 81 |
| m2 | The merged row of a staff `PATCH` is validated in the service: an active person keeps at least one active role | §3.2 rule 1, B14, §6.4 | 82 |
| m3 | The directory's role set includes approver roles read from `role_permission_approvers` | §4.3 row 5, §4.3.1 | 83 |
| m4 | The hub drops an unknown approver id and skips a grant left with none | B18, §4.3 row 8 | 84 |
| m5 | Directory writes take `tenants … FOR NO KEY UPDATE`; the lock analysis counts FK-implied locks | B11, §4.4 row 4 | 85 |
| m6 | `issue-registration-code` assigns only active staff without a denial of `access-hub-admin`, takes the tenant lock and bumps the directory | §4.3 row 19 | 86 |
| m7 | `staff_branches` is diffed, never replaced, so leads and floors at kept branches survive | §5.1 notes, §6.4 | 87 |
| m8 | Moot: one owner covers every branch (M8) | — | — |
| m9 | Branch rename is its own script (no bump); a unique index on `(tenant_id, lower(name))` serialises concurrent renames | §5.1, §6.9, §4.4 row 3 | 88 |
| m10 | `roles_idle` requires whole minutes; the migration aborts on names over the limits (no clamp) | §5.1, B22 | 89 |
| m11 | Change-password writes with `WHERE password_hash = $verified`; zero rows → `401 PASSWORD_INVALID` | §6.11 | 90 |
| m12 | Test 55 greps an exact file set; `0003` and `0005` exempted by name | §3.8, test 55 | 55 |

### 1.4 Decisions D-10 to D-15, follow-up answers, and v0.5 judgment calls (2026-10-27)

| Decision | Change | Where | Test |
|---|---|---|---|
| D-10 | JWT claim `iat_ms`; guard and refresh compare with `password_changed_at` in ms, strict `<` *(superseded in v0.5 by `credential_version`, §1.5 N1)* | B5, §3.7, §6.11, §6.13; 00 §6.22, §6.24a | 91 |
| D-11 | Warning threshold `3 × CONFIG_POLL_INTERVAL_MS`, sent as `hub_stale_after_ms`; shared constant confirmed, per-hub interval deferred (answer 2) | B19, §8, §12.4; 01a §3.4, §6.7b; §4.4 rows 7, 14 | 78, 92 |
| D-12 | `order_taker` key; Order taker and Waiter separate default roles; both roles for both jobs, no mode; carried row for 02; Order taker idle 15 min (answer 3; confirmed by the owner, Q12); hub fixtures keep the display name, renamed-roles hub test (answer 4) | B17, §4.2, §4.5, §5.1, §6.15, §11 steps 11, 14, owner Q12; 00 M29, §6.26; README R21 | 20, 77, 96 |
| D-13 | Own-admin removal blocked by design; runbook; no support override; `link-owner-staff` re-links only to a qualifying admin, audited (answer 1) | B7, §6.15a, §7.5 | 72, 95 |
| D-15 | Re-link target must be a qualifying admin at every branch where the old row is one; refusal lists the missing branches *(superseded in v0.5: every branch of the tenant, §1.5 N3)* | B7, §6.15a, §7.5, §12.2 | 97 |
| D-14 | New branch gets qualifying admins only; duplicate names refused, listed, never auto-renamed | §4.3 row 19; 00 M57, §6.27 | 93, 94 |

**Judgment calls made while applying review 2 (v0.5; the safer option in each case):**

| # | Call | Why it is the safer option | Where |
|---|---|---|---|
| J-1 | A failed JWT guard read answers `503 SERVICE_UNAVAILABLE` (existing code), not `500` | The client already treats 503 as "cloud unreachable, retry" (01a S53) and never as a sign-out | §6.13, 00 §6.24a, test 107 |
| J-2 | `link-owner-staff` refuses a tenant with no branch | "Qualifying admin at every branch" is vacuously true with no branches and would accept any row; `seed-tenant` links the owner at creation anyway | §6.15a step 8, test 72 |
| J-3 | `--confirm-name` is compared byte for byte (case, spaces, punctuation; no trimming) | A looser match could accept the wrong "Ali" | §6.15a step 7, test 100 |
| J-4 | The PIN fields leave the staff version input **and** the PIN route returns the version | Either alone fixes the false `409`; both also keep the client's held version exact | B23, §5.3, §6.3, test 102 |
| J-5 | Every directory write returns `changed_versions` for records changed by cascade | Without it a role archive or a leaver's B15 move would make other open forms stale through the owner's own action | §6 write script, test 102 |
| J-6 | A new code `STAFF_LINKED_TO_OWNER` (409), not a reason on `OWN_ADMIN_ACCESS` | It also covers a linked row that is not a qualifying admin, which `OWN_ADMIN_ACCESS` never fires for, and gives the clear message asked for | §6.4, §9, test 101 |
| J-7 | A JWT without `cv` counts as version 0; refresh-token rows get `DEFAULT 0` | Tokens issued before the release keep working until the first change or reset, then stop; no forced sign-out at release | §6.13, §5.1, test 91 |
| J-8 | `iat_ms` removed; `password_changed_at` kept for audit and display only | Nothing else reads `iat_ms`; one comparison rule instead of two | §6.13, D-10 note |
| J-9 | Only the cloud runner changes for N5 | The hub runner already refuses a database ahead of its files (`apps/hub/src/db/migrate.ts`, `user_version`) | B22, §4.3 row 20 |
| J-10 | Change-password and the reset CLI take an explicit `SELECT … FOR NO KEY UPDATE` before their `UPDATE` | One lock mode, taken first, on every path that touches the owner row | §6.11, §6.14 |
| J-11 | The "never redeploy older than 01b" step goes into 01a §7.8 (the existing release procedure), not a new runbook file | The release procedure already lives there; a second place would drift | §7.4, 01a §7.8, §4.4 row 15 |
| J-13 | The optional support number is a build-time value `VITE_SUPPORT_PHONE` (owner answer Q3) | The owner app has no runtime config and no route serves settings; a build value needs no new route, table or dependency | §8, 01a §7.8, §4.4 row 16 |
| J-12 | The N6 check covers the four keys every v1.4 seed created (`owner`, `manager`, `cashier`, `order_taker`) | `waiter` and `cook` do not exist before 01b (B6), so requiring them would abort every existing database | §5.1, test 106 |

### 1.5 Changes in v0.5 (hostile review 2, `docs/reviews/01b_spec_review_2.md`)

| Finding | Severity | Status | Where | Test |
|---|---|---|---|---|
| M7 partial / N5 | minor | Fixed: cloud runner refuses unknown applied versions; release step | B22, §7.4, §4.3 row 20, §4.4 row 15 | 105 |
| M9 partial / N4 | major | Fixed: version inputs, one builder, canonicalisation, PIN route and responsibilities PUT return versions, `changed_versions`, active-station set | B23, §5.3, §6, §6.3, §6.8, §8 | 102, 103, 104 |
| N1 | major | Fixed: `credential_version`, claim `cv`, equality; `iat_ms` removed | B5, §3.7, §5.1, §6.11, §6.13, §6.14, §4.3 rows 2, 11, 12, 18 | 74, 91 |
| N2 | major | Fixed: `FOR NO KEY UPDATE` on the owner row everywhere | B5, §6.11, §6.13, §6.14 | 98 |
| N3 | major | Fixed: every-branch target, tenant lock, `--confirm-name`, linked row cannot leave | B7, §6.4, §6.15a, §7.5, §9 | 72, 95, 97, 99, 100, 101 |
| N6 | minor | Fixed: backfill aborts on a gap | §5.1 | 106 |
| N7 | minor | Deferred with trigger | §12.4 | — |
| N8 | minor | Deferred with trigger | §12.4 | — |
| N9 | minor | Fixed: guard read failure → 503 | §6.13, §4.3 row 18, §4.4 row 1 | 107 |
| N10 | minor | Deferred with trigger | §12.4 | — |

### 1.6 Changes in v1.1 (as-built clarifications, 2026-10-28)

Source: `docs/reviews/01b-auto-decisions.md`. Each row documents behaviour the merged code already ships; the code and its tests are the evidence (files in the AD row). Conventions that every later module follows went to README "Carried conventions" C1–C9, not here.

| AD | Clarification | Where |
|---|---|---|
| 2 | Group of every permission in `PERMISSION_CATALOGUE` | §4.2 |
| 4 | `issue-registration-code --branch-id` (reissue) takes the tenant lock but does not bump `directory_version` | §4.3 row 19 |
| 9 | `id` / `reason` strings of `StaffDirectoryApplied.skipped` entries | B18 |
| 11 | Repeated ids in a list are dropped (lists are sets, C1); `field` paths for `wrong_branch` on `reports_to` / `floors`; an unknown floor → `reason: 'not_found'` | §3.2 rules 2, 5, 6 |
| 11-sup | A foreign or unknown `?branch_id` → `404 BRANCH_NOT_FOUND`, before any statement | §6.1 |
| 13 | `field` paths with no `reason` for "one grant per permission" and "approvers non-empty iff `requires_approval`"; roles ordered `lower(name)`, `role_id`; repeated approver ids dropped | §6.5, §6.6 |
| 14 | Which rules re-run on a staff PATCH: role-archived on the merged row, B12 on a rename or an added branch, leads and floors at a removed branch dropped. **Not applied:** "unsent fields are trusted" (contradicts "rules as §6.2 on the merged row", §12.3 D-16) | §6.4 |
| 15 | A leaver's sent `reports_to` is ignored; one audit row for the person (`left` / `returned` / `update`); each `reports_to_reassigned` row carries its branch; one `responsibility` / `update` row per branch whose active set a cascade changed. **Not applied:** listing branches whose set version did not change in `changed_versions.responsibilities` (contradicts the "whose version the write changed" rule, §12.3 D-17) | §6, §6.4 |
| 18 | Role PATCH runs the §3.4 guards on every non-no-op write; `used_by` checks staff before role; archive writes the role row plus one staff row per former holder; a role that approves its own grant does not block its archive | §3.4, §6.7 |
| 19 | Two entries for one station → `422` with `field`, no reason; unknown station or role → `not_found`; unknown or foreign staff → `not_at_branch`; GET checks the path branch without a statement | §3.6, §6.8 |
| 20 | Test #63: marking the owner's linked row as left answers `409 STAFF_LINKED_TO_OWNER` (J-6, #101) | §10 #63 |
| 21 | Where the `my_stations` check sits and what `item_ids` lists | §4.4 row 9 |
| 22 | Branch rename audit `before`/`after`; a case-only rename is a rename | §6.9 |
| 23 | `manage_stock_scope` on every stock query answer | §4.4 row 13 |
| 26 | `link-owner-staff` step 4 does not count the acting owner's own row | §6.15a |
| 27 | After a password change the client stores the new pair and clears `must_change_password` | §8 |
| 28 | Team tree: a person whose lead is not active at the branch is a root | §6.12 |
| 31 | Owner nav counts and foot name (the phone part is 01a v1.3.1 S50 a) | §8 |
| 32 | Branches page: hub-away notice | §8 |
| 33 | Stock page under `my_stations`: no-day banner, counter note, `outside_scope` banner | §8 |

### Stories covered

| Story | ACs | Where |
|---|---|---|
| E6 Custom roles and permissions | 1–7 and both edge cases | §3, §6.4–§6.7; tests 1, 5, 11–18, 20, 60, 63 |
| E0 PIN login | 4 (idle per role, editable), 7 (PIN set/reset; **D40 overridden**, B9) | §6.3, §6.7; tests 3, 6, 18, 58 |
| E0 PIN | 1 dropped (00 M27: duplicate PINs allowed) | — |
| R3 | staff ↔ branch assignment | §6.1–§6.2, §6.4; tests 2, 8, 30 |
| E6-TEAM (draft story, R24) | 1–5: one lead per branch, no loops, leaver re-parenting, team tree, no permission from a line | §3.5, §6.12; tests 26–31, 57, 61, 62 |
| 01a S38 | assignable responsibility "count stock" per station | §3.6, §6.8; tests 32–36 |
| 00 M73 (carried 01 / 07) | owner told about a lock | §6.13; test 4 |
| Q9 (owner answer) | owner change password; forgot password through support | §6.11, §6.14; tests 37–44 |
| 01a §6.7, §12.5 | branch settings endpoint | §6.10; tests 45, 46, 59 |

### Carried into 01b (README "Requirements carried to other modules")

| Row (README) | Requirement | How 01b meets it | Test |
|---|---|---|---|
| 01 (00 §4.2, M31) | `registerStationValidator` | done by 01a | — (01a) |
| 01 (00 §4.2, M29) | append new permissions with default grants to `default-roles.ts` | 01b adds no permission; defaults rewritten (§6.15) | 20 |
| 01 (00 M29, M51) | bump `tenants.directory_version` on every staff/role change, strictly upward | B11 | 2 |
| 01 (00 M57) | no `is_admin_role`; the admin guard checks `access-hub-admin` | B7, §3.4 | 1, 11, 63 |
| 01 (00 M69) | cloud `idempotency_keys` (built by 01a) used on creates | §6.2, §6.6 | 56, 60 |
| 01 / 07 (00 M73) | tell the owner about a locked login | §3.7, §6.13 | 4 |
| 01b (01a §4.4, §12.5) | permission scopes | B2, §3.3 | 12, 14, 19 |
| 01b (01a S38) | assignable responsibilities | §3.6, §6.8 | 32–36 |
| 01b (R5) | no role-named behaviour | §3.3, §4.2, B17 | 55 |
| 01b (01a §12.5) | idle TTL defaults editable by the owner | B13 (per role; departs from "restaurant settings", §4.4 row 5) | 18 |
| 01b (01a §6.7, S34) | branch settings endpoint | §6.10 | 45, 46, 59 |
| 01b (01a §12.5, S42) | audit staff removals and PIN resets for the restore runbook | §6.3, §6.4 | 9, 58 |
| 01b (01a §12.5) | PIN hashed on the cloud, recorded as a named decision overriding D40 | B9 | 3 |
| 01b (01a §12.5) | owner cannot remove their own admin access | B7 | 63 |
| 01b (R21) | several approvers; staff without a PIN; defaults; lockout 10; tax off; day ranges | B10, B3, B6, §3.7, B16 | 13, 6, 20, 4, 46 |
| 01b (R24) | Reports to | §3.5, §6.12 | 26–31, 57, 61 |
| 01b (R25) | main/secondary role, capacity | deferred (B1, §12.4) | — |

### In scope
- Cloud routes for staff, roles, PINs, responsibilities, the team tree, branch name and settings (§6).
- Owner change password, support password reset CLI, lockout notice on login.
- The staff directory contract change and its hub side (00 v1.5, §4.3).
- Scope data on grants and the facts a scope uses (floors, lead, stations) (B2), and the one scope enforced in v0.3, `my_stations` on the 01a stock page (B20).
- New default roles in `seed-tenant`, including Waiter and Cook (B6, B17, Q13).
- Owner app views for the design hand-off screens, plus the team tree (§8).

### Out of scope
- **Main and secondary roles, capacity** (R25, Q20, Q21): the module that first reads them adds them (B1).
- **Enforcing the other scopes** in ordering, tables and approvals: 02 and 04 (this module stores and delivers them).
- Notifications and requests (01d), table handover (02, R23), approval flow (04).
- A cloud login for managers (Q1: owner only in P1).
- A second owner login, e.g. a partner who owns some branches (Q10 decided: one owner per tenant in P1; §12.4).
- Self-service forgot password by e-mail (no sender exists).
- An audit viewer (Q5: module 07).
- Pushing a branch rename to the hub (§12.4).

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Cloud owns roles, staff, PIN hashes; hub caches them read-only and never creates a hash | F §3.1, D40 (hashing place overridden by B9, not the authority) |
| Effective permission: denial wins, else allowed > requires_approval > not_granted, approvers = union | 00 M10, §3.6 (shape extended by B2, B10; the precedence is unchanged) |
| Idle TTL of a multi-role person = the longest of their roles | 00 M11 |
| Directory versions only move forward; bad rows skipped; skipped staff keep their previous row | 00 M51, M52, M75 |
| PIN hash change ends sessions; removed staff: sessions end, owned phones revoked | 00 M50, M38 |
| No `is_admin_role`; admin = the `access-hub-admin` permission | 00 M57 |
| Station sessions for kitchen screens: no PIN, no idle timeout (cooks work through them) | 00 M30 (unchanged by B17) |
| A staff id not in the hub directory answers `404 STAFF_NOT_FOUND` at PIN sign-in, not counted as a failure | 00 §3.5 step 4 |
| Directory travels in 01a's config poll (`GET /v1/sync/config`), built by `loadDirectory` | 01a S6, §6.1 |
| Cloud write script, `withIdempotency`, `config_audit` insert-only, no-op writes nothing, owner allowed branches read from `owner_users` at write time | 01a §6, S7, S8, S26 |
| Tenant guard, `TenantScopedRepository` / `TenantLevelRepository`, route-inventory and cross-tenant tests | F §3.4, D54, 00 M16 |
| Owner login, refresh rotation, lockout at 10 failures in 15 min, locked account answers like a wrong password | 00 §6.22–§6.24, M64, M73 (the JWT guard gains one owner-row read, B5, §4.3 row 18) |
| Owner app: one Vite app, entry `owner`, hash routes, UI kit only, closed dependency list | 01a S35 |
| Permission catalogue in `@pos/domain/src/permissions.ts`; later modules append | 00 §3.6 |
| Event payloads change only through `schema_version` and an upcaster | F §4 (D46) |

**Code checked (2026-10-27):** `apps/cloud/src/modules/hub-registration/repository.ts` (`loadDirectory`, 5 statements), `apps/hub/src/auth/{apply-directory,staff-directory}.ts`, `apps/hub/src/queries/{session,staff-roster}.ts`, `apps/cloud/src/modules/{owner-auth,staff-roles}/`, `apps/cloud/src/cli/seed-tenant.ts`, `packages/events/src/directory.ts`, cloud migrations `0001`–`0004`, hub migrations `0001`–`0004`. Cloud routes in code: 24, none under `/v1/owner/*`. **Re-checked for v0.4 (review 1):** `apps/cloud/src/plugins/{jwt,tenant-scope}.ts`, `apps/cloud/src/cli/issue-registration-code.ts`, `apps/hub/src/sync/config-poller.ts`, `packages/events/src/{directory,config}.ts`. **Drift found:** the merged cloud migration `0003_manage_stock_backfill.sql` (01a S18) selects roles **by name** (`WHERE r.name IN ('Owner', 'Manager')`). It is merged and is not edited; §3.8 names it as the one historical exception and `default_key` (B17) removes the need for any later one. No other drift from 00 in the parts 01b touches.

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Why | Overrides |
|---|---|---|---|
| B1 | **v0.3 includes Reports to (Q17–Q19) and the team tree, and leaves main role and capacity (Q20, Q21) to the module that first reads them.** | YAGNI: nothing reads main role or capacity until P2 stats; both are additive columns later. 01d reads the lead line right after 01b. | — |
| B2 | **A scope belongs to the role's grant; the person supplies the facts it uses.** `scope ∈ branch, own_tables, my_floors, my_team, my_stations`. Each permission lists the scopes it accepts (§3.3); `branch` is the default and the only scope for the rest. Facts: the person's floors per branch (`my_floors`), their lead per branch (`my_team`), their stations from responsibilities (`my_stations`). `resolve` returns the winning scope (§3.3). | One field per permission for 02, 04 and the stock page to read; the person form stays short. | 00 M10 / §3.6 `resolve` return shape (adds `scope`); 00 §6.20 session response (§4.3 rows 6, 10) |
| B3 | **A person with no PIN is left out of the hub directory** until a PIN is set. | Without a PIN they cannot sign in, approve or own a phone; a PIN can only be set, never cleared, so nobody goes from listed to absent by this rule. No hub change. | 00 §5.2 `staff.pin_hash NOT NULL` (cloud column becomes nullable) |
| B4 | **Responsibilities travel in the staff directory**, not the branch config snapshot. | A person and their jobs arrive together, so a leaver never leaves a job behind; the stock sign-in roster already reads the directory. | 00 §6.5 directory shape, §6.19 roster response (§4.3 rows 5, 9) |
| B5 | **Owner password: forgot password = support CLI `reset-owner-password`** (temporary password valid **24 h**, `must_change_password`, confirmed by the owner, Q4), no sign-in link. **Change password** is `POST /v1/auth/change-password`, specified and counted here (§6.11), coded in 00's `owner-auth` folder. **Credential version (review 2 N1):** `owner_users.credential_version` is an integer that change-password and the reset CLI increment by 1 in the same transaction that changes the password, while they hold the owner row lock. Login and refresh read it while they hold the owner row lock and write it into the JWT (claim `cv`) and onto the refresh-token row (`owner_refresh_tokens.credential_version`). **The JWT guard reads the owner row on every owner request** (one statement by primary key, 00 §6.24a): `cv` ≠ `owner_users.credential_version` → `401 JWT_INVALID`; a failed read → `503 SERVICE_UNAVAILABLE`, never `401` (review 2 N9); while `must_change_password` is set, every `/v1/admin/*` route answers `403 PASSWORD_CHANGE_REQUIRED`. Refresh refuses a refresh token whose `credential_version` ≠ the owner's. **One lock mode on the owner row (review 2 N2):** login, refresh, change-password and the reset CLI each take `owner_users … FOR NO KEY UPDATE` before touching tokens (refresh: before its token row), so one owner's logins, refreshes and changes run one at a time and no transaction upgrades a shared lock (§6.13). Login and refresh return the lockout notice (M73). | No e-mail sender exists; a link needs a page, a token table and expiry for the same result. A forced change stops a password read out on the phone from staying in use, and the 24 h expiry stops an unused one from staying valid (review 1 M3). A claim in the token cannot reflect a reset made after it was issued (review 1 M1). A timestamp comparison fails when the change takes its timestamp before it gets the lock, or when the CLI host's clock differs (review 2 N1); a counter changed under the row lock has neither problem. A shared lock that the same transaction later upgrades deadlocks two concurrent logins (review 2 N2). | 00 §5.2 `owner_users`, `owner_refresh_tokens`; §6.22 login; §6.23 refresh; §6.24a JWT guard (new); §7.2 redaction; §7.10 folders; M73 "out of band" met here; 01a §6 shared failures (§4.3 rows 2, 11–13, 15–18; §4.4 row 1) |
| B6 | **No running tenants (owner, 2026-10-27): new defaults go into `seed-tenant`; dev and test data are re-seeded; no migration rewrites role grants.** The one role-data step in `0005` is the `default_key` backfill (B17, review 1 M5): it labels existing default roles and changes no grant. | Nothing to migrate. Later default changes never overwrite owner-edited roles either. | 00 §6.26 default roles table (Q13) |
| B7 | **Two admin guards over "qualifying admins".** A **qualifying admin** at a branch is an active staff member assigned to it, with a PIN, whose effective `access-hub-admin` **and** `manage-devices` are both `allowed` (review 1 M4). **(a) Last admin:** each branch keeps at least one qualifying admin (`409 LAST_ADMIN_REQUIRED`, E6 AC7). **(b) Own admin role:** the owner cannot make the staff row linked to their own login stop being a qualifying admin at any branch where it is one, by any write (roles, denials, branches, leaving, or a role edit): `409 OWN_ADMIN_ACCESS`, shown as "You can't remove your own admin access. Call support." The link is the new `owner_users.staff_id` (nullable), set by `seed-tenant` for the owner's staff row. **An owner with no linked staff row fails safe:** the guard cannot tell which row is theirs, so any write that makes any staff member stop being a qualifying admin at a branch is refused (`409 OWN_ADMIN_ACCESS { reason: 'owner_not_linked' }`). Tenants seeded before this change are re-seeded (B6), which sets the link; support can also set it with the `link-owner-staff` CLI (§6.15a). | (a) Pairing, pair-request approval and device revoke need `manage-devices` (00 §6.7, M44); a branch with no such admin cannot replace a tablet or revoke a lost phone (R14), and while the cloud is unreachable nobody can fix the roles. `access-hub-admin` alone is not enough: stock counters hold it (D-3). (b) E6 edge case (developer decision D-1, 2026-10-27): the owner cannot lock themselves out of the hub by mistake; with one owner per tenant (B8) the owner's row is the only guaranteed admin, so the block is by design and support has no override (D-13, runbook §7.5). `link-owner-staff` (first link and corrective re-link) accepts only a row that is a qualifying admin at **every branch of the tenant**, under the tenant lock, and only after support types the row's exact display name (review 2 N3, replacing D-15's superset rule); the owner's own row always meets this (B8, 00 §6.27), and the linked row can never be marked as left (`409 STAFF_LINKED_TO_OWNER`), so the guard always protects a real admin at every branch (§6.15a). | 00 §5.2 `owner_users` (adds `staff_id`), §6.26 (links it) (§4.3 rows 2, 14) |
| B8 | **One owner per tenant in P1, and the owner covers every branch** (Q10 decided 2026-10-27 on review 1 M8, option a). Every 01b write checks, at write time, that the acting owner's `owner_users.allowed_branch_ids` holds every branch of the tenant (01a S8's tenant-wide check, `coversEveryBranch`); otherwise `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`. There is no per-person or per-branch coverage rule, no `can_edit` and no read-only roles view. Branch paths still answer `404 BRANCH_NOT_FOUND` for a branch that is not the tenant's. Owner-only in P1 (Q1). | Only `seed-tenant` creates an owner login, and `issue-registration-code` adds every new branch to it (00 M57), so a partner owner with some branches cannot occur; rules for one would be untestable without hand-built rows. The write-time check stays as a guard against a hand-edited `owner_users` row. A second owner is deferred (§12.4). | — |
| B9 | **PINs are hashed on the cloud** (argon2id, 00 M8 parameters `m=19456, t=2, p=1` or stronger), sent over HTTPS from the owner app. Never logged, never in an audit row, never in a response. | The setting device is a browser; argon2id there needs a WASM library outside the closed dependency list (01a S35), and 19 MB of memory per hash on a cheap phone. TLS protects the transfer. Recorded as required by 01a §12.5. | **F §3.1 "Staff PINs" row, D40, E0 PIN AC7** ("hashed on the setting device") |
| B10 | **Several approver roles per grant** (`approver_role_ids[]`, Q11). The answer is given on the approver's own device (01d, 04); 01b only stores the list. | Owner answer R21 (1). | 00 §5.1, §5.2 `approver_role_id` (single); §6.5 directory shape; §4.2 `applyStaffDirectory` (§4.3 rows 3–5) |
| B11 | **Every write that changes directory data bumps `tenants.directory_version` by 1** in the same transaction, after taking `SELECT … FROM tenants WHERE tenant_id = $1 FOR NO KEY UPDATE` **first** (review 1 m5). Lock order for directory writes: tenants row → target rows (`staff` / `roles`) in id order. Floors, stations and roles named as references are read without a lock; directory writes never take an explicit lock on `branches`. The `issue-registration-code` CLI, which writes `staff_branches`, takes the same tenant lock first (§4.3 row 19). | 00 M51 (forward-only); taking the tenant row first serialises all staff and role writes of a tenant, which the admin guards (B7) need. **FK-implied locks counted:** inserts into tables that reference `tenants` (01a's tax classes, categories, menu items, availability windows) take `FOR KEY SHARE` on the tenant row, which conflicts with `FOR UPDATE` but **not** with `FOR NO KEY UPDATE`, so a directory write and a menu write never wait on each other at the tenant row. Inserts into `staff_branches` take `FOR KEY SHARE` on a `branches` row; they wait behind a config write that holds that row `FOR UPDATE`, but that config write never waits on anything a directory write holds (it takes no lock on `tenants` stronger than `KEY SHARE`, and reads directory tables without a lock), so no cycle forms. A floor or station archived concurrently is left out by `loadDirectory` (§3.2 rule 6, §3.6). | 01a S8 lock order (adds the directory-write order and corrects "config writes never lock `tenants`", §4.4 row 4) |
| B12 | **Display names are unique among active staff (with or without a PIN) at each branch they work at** (case-insensitive, trimmed; Q7 of the design, confirmed by the owner as visit Q9). | Two "Ali" tiles on one sign-in screen cause wrong sign-ins and lockouts. | — |
| B13 | **Idle limit per role, 1–240 minutes** (240 confirmed as the longest, owner answer Q8), edited on the role (design Q8); stored as `session_idle_ttl_ms` (unchanged column). | Satisfies the carried "idle TTL defaults editable by the owner" (01a §12.5) without a new settings table. **This departs from the carried row's "stored in restaurant settings"**: per-role values already exist (00 M11) and a second, restaurant-level default would need a precedence rule nobody asked for. | 01a §4.4 01b row, §12.5 "stored in restaurant settings" (§4.4 row 5) |
| B14 | **Archiving a role removes it from every staff member who has it**, in the same transaction; refused if any active staff member would be left with no role, if the role is an approver on another active role's grant, or if B7 would fail. A person who has left may be left with no role; bringing them back then needs `role_ids` in the same `PATCH` (§3.2 rule 1, review 1 m2). | E6 AC7; a role with holders and no clear outcome would leave people with no permissions silently. | — |
| B15 | **A leaver's direct reports move to the leaver's own lead** (or to no lead) at each branch, in the same transaction (confirmed by the owner, Q5). Each moved person gets one `config_audit` row: entity `staff`, action `reports_to_reassigned`, `before`/`after` = `{ branch_id, lead_staff_id }`. The response lists them. | E6-TEAM AC3: the team is never left without a line; the owner sees who moved and can change it. | — |
| B16 | **Branch day settings ranges 1–48 h and 0–12 h** (Q16), and tax default off (Q15, as built). | Owner answers R21 (5), (6). | 01a §5.2 CHECKs 1–72 and 0–24 (tightened by migration), §6.7 CLI ranges (§4.4 row 3) |
| B17 | **Override 00 M29 (role list); M30 unchanged.** Default roles are Owner, Manager, Cashier, **Order taker**, **Waiter** and **Cook** (D-12). **Order taker and Waiter are different jobs:** an order taker takes orders; a waiter (helper) serves. They are separate default roles with separate keys, and 02 grants each its own ordering permissions (README carried row). **A person who covers both jobs simply holds both roles** (multi-role, 00 M10, M11): during a rush an order taker who also serves is given the Waiter role as well; there is no special mode, rush toggle or role switch, and nothing in code treats the pair specially. Order taker has no grants (02 appends) and an idle limit of **15 min**, the same as Cashier, since both are counter roles (confirmed by the owner, Q12). Waiter and Cook are **team-membership roles**, not sign-in roles: they exist so the owner can place people in a team (Reports to, E6-TEAM), and they carry no permissions by default (confirmed by the owner, Q2). **They are defaults only (D-8):** a person seeded or created with them has no PIN (B3) and no permissions, and nothing else about them is special. A cook keeps working through station sessions (00 M30). They never get name-based behaviour (§3.8): an owner who gives a Cook a PIN or permissions gets a person who signs in and acts like anyone else with those grants. **Each default role carries a stable `default_key`** (`owner`, `manager`, `cashier`, `order_taker`, `waiter`, `cook`; unique per tenant when set; null for roles the owner creates), set by `seed-tenant` and kept when the owner renames the role (review 1 M5). A later module that appends a default grant to existing tenants (02 for Order taker and Waiter, each decided separately; 03b for Cook; 05 for Cashier) finds the role by `default_key`, never by name; `is_default` on the wire is `default_key IS NOT NULL`. | Owner answer Q13 asks for a Cook role; M29's "no Kitchen staff role" was about sign-in, which M30 still covers. Teams need the kitchen staff to exist as people. Without a stable key, the only way to reach "the Waiter role" of a running tenant is its name, which the owner may change and R5 forbids. | **00 M29** role list, §6.26 table (§4.3 rows 3, 14) |
| B18 | **Directory v2 is additive, and its skip kinds grow.** (a) Every v1 field is still sent with its v1 meaning: each grant keeps `approver_role_id` (the first of the sorted `approver_role_ids`, or null), next to the new `approver_role_ids` and `scope`; staff and roles only gain keys. A hub on v1.4 code drops the keys it does not know (its schemas are not `.strict()`) and keeps applying with v1 semantics: scoped grants act branch-wide and only the first approver is known, until that hub is upgraded (review 1 M6). (b) A lead or responsibility naming someone not in the directory is skipped (M52 pattern). (c) An approver id naming a role not in the directory is dropped from that grant's list (kind `'approver'`); a `requires_approval` grant left with no approver is skipped (kind `'approver'`, review 1 m4). (d) `StaffDirectoryApplied` moves to `schema_version: 2`, whose `skipped.kind` adds `'lead'` and `'responsibility'`; the v1 → v2 upcaster is the identity (every v1 payload is a valid v2 payload). *As built, v1.1 (AD-9):* `skipped` strings (free text, no schema change): a dropped approver `id` = `role:permission:approver`, `reason` = `unknown approver`; a skipped grant `id` = `role:permission`, `reason` = `unknown approver` (or `no approver` for an empty list, 00 #103); a lead `staff:lead` / `unknown staff`; a responsibility `responsibility:station:staff` / `unknown staff`; a responsibility naming a role the hub does not hold is kept (no FK, nobody holds it). | The directory travels inside the config poll envelope; a v1 hub that failed to parse a non-additive v2 directory would reject the **whole** poll (menu, prices and staff removals, `config-poller.ts` envelope parse), so one failed hub upgrade would freeze a branch. Without the skip, a lead with no PIN (B3) would block the whole apply; F D46 requires a new schema version for a payload change. | 00 §4.2 `StaffDirectoryApplied` payload, M52 skip list (§4.3 rows 5, 8) |
| B19 | **The cloud records two hub times per branch, both set by the config poll:** `branches.hub_last_seen_at` on every poll, and `branches.hub_synced_at` on a poll answered `304` (the hub reported the cloud's current `config_version` and `directory_version`, so it has applied everything). The branches list shows both (review 1 M6) and warns when they are more than **3 × the hub poll interval** apart; the interval is the shared constant `CONFIG_POLL_INTERVAL_MS` (`@pos/events`, used by the hub poller) and the cloud sends the threshold with the list (D-11). A **per-hub** poll interval is deferred (§12.4); if one is ever needed, the hub reports its interval on each poll and the cloud derives that branch's threshold from it. | Design S06 shows "Hub checked in 2 min ago"; the poll already reaches the cloud every minute, so no new route is needed. A hub that checks in but keeps rejecting what it receives gets `200` on every poll, never `304`: "checked in" alone would show it as healthy while it is frozen. | 01a §6.1 (adds a write after the read), §6.7b response (§4.4 rows 6, 7) |
| B20 | **`manage-stock` with scope `my_stations` limits the 01a stock page and its item commands to the person's stations** (confirmed by the owner, Q6). Scope `branch` behaves as today. | A stock counter must not change another station's counts. **Day open and close act on the whole branch, so they need scope `branch`** (D-6): a `my_stations` holder gets `403 PERMISSION_DENIED { permission: 'manage-stock', reason: 'outside_scope', required_scope: 'branch' }`. The existing reason `outside_scope` is reused; `required_scope` tells the page why. | 01a §6.17, §6.17a, §6.18, §6.18a, §6.18b, §6.19, §8.2 (§4.4 rows 9–13) |
| B21 | **`config_audit` gains 01b's entities and actions**, and `actor_kind 'cli'` is also used by `reset-owner-password` and `link-owner-staff` (the values `owner`, `cli` are unchanged). | T2 audit trail for staff, role and owner-account changes (E6 AC5, 01a S42). | 01a S26 lists, §5.2 `config_audit` CHECKs (§4.4 row 2) |
| B22 | **Cloud migration `0005_staff_roles.sql` carries its contract steps in the same release** (the day-setting clamp and tightened CHECKs; new CHECKs on existing `staff`, `roles` and `branches` columns; the unique branch-name index; and **`staff.pin_hash` becoming nullable**, §5.1), instead of a later release. **The cloud rolls forward only once `0005` is applied** (review 1 M7): v1.4 code selects `pin_hash` unfiltered, so after the first person saved without a PIN its directory would fail every hub's parse; a bad 01b release is fixed by a new release, never by redeploying v1.4 (§7.4). **Enforced from this release (review 2 N5):** the cloud migrations runner (`apps/cloud/src/db/migrate.ts`, 00 §5.2, §4.3 row 20) refuses to start when `schema_migrations` holds a version this build has no file for, so no later build can boot on a newer database. v1.4 itself cannot be changed, so the cloud release procedure (01a §7.8, §7.4) forbids redeploying any build older than 01b. The approver move does not break a rollback: `role_permissions.approver_role_id` is dual-written (§5.1) and its CHECK is kept. Names over the new limits are **not** clamped: the migration aborts with nothing applied (test 89), so a long name is fixed by hand before the release. | Safe for three reasons, checked against the code on 2026-10-27. **(1) Existing rows:** the migration's `UPDATE` clamp runs first, in the same transaction, and dev data is re-seeded (B6); test 70 proves no row breaks a new CHECK. **(2) No queued or offline writer reaches these columns:** they are written only by the owner app's online routes (§6.2, §6.4, §6.6, §6.7, §6.9, §6.10), whose Zod ranges equal the CHECKs, so an out-of-range value is a `400` before any SQL, and by the `set-branch-settings` CLI (01a §6.7), which checks the same ranges. The owner app never re-sends a failed write on its own (01a S53). Hubs and devices do not write them: the cloud's only hub routes are `POST /v1/hubs/register`, `POST /v1/hubs/confirm` and `GET /v1/sync/config` (a read); device command queues go to the hub, whose tables have no copy of these CHECKs. So no sync queue can hold such a value, and no CHECK violation can block one. **(3) Old hubs read the new values:** the hub's `BranchConfigSnapshotSchemaV1` still accepts 1–72 and 0–24 (not tightened), so 1–48 and 0–12 parse on every hub version. A client-version gate and a server-side clamp on sync are not added (§12.3 D-9): no route receives these values from a queue. **06 carried requirement:** when 06 adds hub-to-cloud ingest, a payload that fails a cloud CHECK must never block the queue behind it. | **F §6.8** "every migration must stay compatible with the previous app version" (for these steps only; `approver_role_id` stays dual-written until a later release drops it, §12.4); 06 inherits the carried "never block the queue" rule |
| B23 | **Optimistic concurrency on whole-value writes** (review 1 M9; made precise by review 2 N4). Staff `PATCH`, role `PATCH` and responsibilities `PUT` require `expected_version`; inside the transaction, after the target is locked (the responsibility set: after the tenant lock), the service builds the stored version and compares; a mismatch → `409 CONFIG_STALE { entity, id }`, nothing written. **The version covers only what the write replaces** (its *version input*, §5.3): staff `{ staff_id, display_name, role_ids, branch_ids, denied_permissions, reports_to, floors, is_active }` (not `has_pin`, `pin_set_at`, `left_at`); role `{ role_id, name, idle_minutes, archived, grants }` (`archived` = `archived_at IS NOT NULL`; not `is_default`, `staff_count`); responsibility set `{ branch_id, responsibilities }` over **active stations only**, the same rows the GET returns. **One builder:** `apps/cloud/src/modules/staff-roles/versions.ts` exports `toStaffWire`, `toRoleWire`, `toResponsibilitySet` and `staffVersion`, `roleVersion`, `responsibilitySetVersion`; every `GET`, every in-transaction compare and every write response uses them, and no other code computes a version. Canonicalisation rules: §5.3. **Every write returns the new version** of its target, and `changed_versions` for every other covered record it changed by cascade (§6, directory write script). | The tenant lock (B11) serialises writes but cannot tell that a client edited a stale copy; a whole-list save from an old tab would re-grant a permission revoked since, or undo a denial, with an ordinary audit row. A hash needs no new column. Hashing fields the write does not replace (the PIN) gave a false `409` after the owner's own PIN reset; two builders that order arrays or type `BIGINT`s differently would give a permanent `409` (review 2 N4). | — |

### 3.2 Staff member

```
               POST /staff                      PUT /staff/:id/pin
  (none) ───────────────────────► ACTIVE, no PIN ─────────────────────► ACTIVE, PIN set
                                    │  (not in directory, B3)              │  (in the directory of each of their branches)
                                    │                                      │
                                    └──────── PATCH is_active:false ───────┴──► LEFT (left_at set; out of every directory;
                                                                                 hub ends sessions, revokes owned phones, 00 M38)
                         LEFT ── PATCH is_active:true ──► ACTIVE (PIN kept, B15 not reversed)
```

Rules:
1. At least one role and at least one branch while active. A list sent empty → `400 VALIDATION_FAILED` (Zod). The **merged** row is also checked in the service (review 1 m2): an active person whose stored roles are all gone (B14 archived them while they had left) and who is brought back without `role_ids` → `422 CONFIG_REFERENCE_INVALID { field: 'role_ids', reason: 'role_archived' }`, nothing written.
2. Roles must be of the tenant and active: an unknown or foreign role → `422 CONFIG_REFERENCE_INVALID { field: 'role_ids.N', reason: 'not_found' }`; an archived role → `reason: 'role_archived'`. Branches must be the tenant's (`404 BRANCH_NOT_FOUND`, §6.2 rule 1). *As built, v1.1 (AD-11):* a repeated id in `role_ids`, `branch_ids` or `denied_permissions` is dropped, not refused (lists are sets, README C1).
3. Denied permissions: any catalogue permission (owner only, E6 AC3).
4. A PIN is 4–6 ASCII digits. Duplicates allowed (00 M27).
5. Reports to: per branch, at most one lead (Q18): two entries for one branch → `422 CONFIG_REFERENCE_INVALID { field: 'reports_to', reason: 'one_lead_per_branch' }`. The lead is active and works at that branch (`reason: 'not_at_branch'`), and there is no loop at that branch (`reason: 'loop'`, §3.5). A branch not in the person's `branch_ids` → `reason: 'wrong_branch'`. *As built, v1.1 (AD-11):* its `field` is `reports_to.N.branch_id` (N indexes the list as sent).
6. Floors: per branch, floors of that branch that are not archived at write time (another branch's floor → `reason: 'wrong_branch'`; archived → `reason: 'archived'`; *As built, v1.1 (AD-11):* an unknown floor id → `reason: 'not_found'`; `field` is `floors.N.branch_id` for a branch outside `branch_ids` and `floors.N.floor_ids.M` for a floor, N and M indexing the lists as sent); only meaningful when a role uses `my_floors`, but stored regardless. A floor archived later keeps its rows; `loadDirectory` leaves archived floors out (01a's floor archive is not touched).

### 3.3 Grants, scopes and the effective permission

Grant on a role, per permission: `grant_type ∈ allowed, requires_approval` (absent = `not_granted`, as today), `approver_role_ids` (non-empty iff `requires_approval`, active roles of the tenant, may include the role itself), `scope`.

**Scopes each permission accepts (`PERMISSION_SCOPES` in `@pos/domain`, B2)** (confirmed by the owner, Q11):

| Permission | Scopes | Who enforces |
|---|---|---|
| `take-order-anywhere` | `branch`, `my_floors` | 02 |
| `force-release-table-lock` | `branch`, `my_floors` | 02 |
| `approve-void` | `branch`, `my_team` | 04 |
| `manage-stock` | `branch`, `my_stations` | 01a stock page (B20, §4.4) |
| every other permission | `branch` | — |

`own_tables` is defined in the enum and offered by no permission in v0.3: today "tables they open" is what a person without `take-order-anywhere` gets (D5). A later spec that needs it on a permission adds the row (§12.3 D-2). A `scope` not in the permission's row → `422 CONFIG_REFERENCE_INVALID { field: 'grants.N.scope', reason: 'scope_not_allowed' }`.

**Effective permission (00 M10, extended by B2 and B10):**

```
resolve(staff, permission):
  denied        → { grant: 'denied' }
  winning type  = allowed if any role grants allowed, else requires_approval if any, else not_granted
  approver_role_ids = sorted union over the roles granting requires_approval   (only when the winner is requires_approval)
  scope         = the widest scope among the roles granting the winning type
                  order: branch > my_floors = my_team = my_stations > own_tables
                  (two different middle scopes cannot occur on one permission, §3.3 table)
  → { grant, approver_role_ids?, scope }        (scope absent for denied and not_granted)
```

A role that grants `requires_approval` with a wider scope than another role's `allowed` does not widen the `allowed` grant (test 12). Scope facts are not part of `resolve`; the hub exposes them separately (§4.2).

### 3.4 Admin guards (B7)

Both guards run inside the transaction, after the tenant row lock (B11). Each is computed once before the write and once after it, with one SQL statement per computation (a join of `staff`, `staff_branches`, `staff_roles`, `role_permissions` and `staff_permission_denials`, evaluating §3.3 for `access-hub-admin` and `manage-devices` in SQL):

- **Qualifying admin (review 1 M4):** active, `pin_hash IS NOT NULL`, assigned to the branch, effective `access-hub-admin` = `allowed` **and** effective `manage-devices` = `allowed`. A stock counter who holds `access-hub-admin` only for the stock page (D-3) is not one.
- **Own-admin guard (checked first):** `O_before` / `O_after` = the branches where the staff row in the acting owner's `owner_users.staff_id` is a qualifying admin. `O_before \ O_after` not empty → roll back, `409 OWN_ADMIN_ACCESS { branch_ids }`. **When `owner_users.staff_id` is null (fail safe):** any staff member who is a qualifying admin at a branch before the write and not after it → roll back, `409 OWN_ADMIN_ACCESS { branch_ids, reason: 'owner_not_linked' }`. The fix is `link-owner-staff` (§6.15a).
- **Last-admin guard:** `A_before` / `A_after` = the tenant's branches with at least one qualifying admin. `A_before \ A_after` not empty → roll back, `409 LAST_ADMIN_REQUIRED { branch_ids }`. Branches that had no admin before (a new branch, a new tenant before PINs) are not blocked.

Writes that run both guards: staff PATCH (roles, branches, denials, `is_active`) and role PATCH (grants, archive). *As built, v1.1 (AD-18):* the role PATCH runs them on every write that is not a no-op; a rename or idle edit cannot change the result. Staff create, PIN set and responsibility writes never remove an admin, so they run neither guard.

### 3.5 Reports to and the team tree (E6-TEAM, B1, B15)

- Stored per `(branch_id, staff_id) → lead_staff_id`.
- Loop check at write time: walk from the new lead upward at that branch (≤ number of active staff at the branch); reaching the person → `422 CONFIG_REFERENCE_INVALID { field: 'reports_to.N.lead_staff_id', reason: 'loop' }`.
- A lead must be active and work at that branch (`reason: 'not_at_branch'`).
- Leaving (`is_active: false`): B15 re-parents direct reports; their rows change to the leaver's lead at that branch (or are deleted when the leaver had none). The leaver's own row is deleted.
- A person removed from a branch: their row at that branch is deleted, and their reports there move up the same way (B15).
- A reporting line grants nothing (R5). The hub gives later modules `leadOf(staff)` and `teamOf(staff)` (direct reports only; 01d decides whether to walk further).
- People without a PIN (B3, e.g. cooks, B17) are not in the hub directory, so the hub's `teamOf` lists only members with a PIN. The **cloud team tree** (§6.12) lists everyone, with `has_pin`.

### 3.6 Responsibilities (S38, B4)

- One kind in v0.3: `count_stock` (Q4 of the design). Per branch, per station: a list of staff and a list of roles. Who counts which station at the pilot is setup data. **Both ways the owner assigns counting are covered (owner answer Q7):** a specific person (the station's `staff_ids`), or whoever handles that station (a role in the station's `role_ids`, e.g. a "Grill cook" role: every holder of it at that branch counts that station). Assignment by today's duty or shift is deferred (§12.4).
- A person's stations at a branch = stations where they are listed, or one of their roles is listed.
- Stations must be the branch's (`reason: 'wrong_branch'`) and active (`reason: 'archived'`); staff must work at the branch (`reason: 'not_at_branch'`); roles must be active (`reason: 'role_archived'`); all `422 CONFIG_REFERENCE_INVALID`. *As built, v1.1 (AD-19):* an unknown station or role id → `reason: 'not_found'`; an unknown or foreign staff id → `reason: 'not_at_branch'`; repeated ids inside `staff_ids` or `role_ids` are dropped (README C1); two entries naming one station → `field: 'responsibilities.N.station_id'` with no `reason` (README C3, C6).
- Archiving a role, or a person leaving or being removed from the branch, removes their entries in the same transaction. An **archived station keeps its rows** (restoring it brings them back); `loadDirectory` and the GET leave out archived stations, so 01a's station archive is not touched and keeps its lock order (01a S8, B11).
- On the hub: `manage-stock` with scope `my_stations` limits the stock page rows and the stock item commands to the person's stations (B20, §4.4). The person still opens the page through 00's admin sign-in, so their role also needs `access-hub-admin` (§12.3 D-3).

### 3.7 Owner password and lockout notice

| Rule | Value |
|---|---|
| New password | 10–200 characters [ASSUMPTION: developer default for the minimum, not an owner question], no other rule; must differ from the current one (`422 PASSWORD_UNCHANGED`) |
| Wrong current password | counts toward the 00 M64/M73 account lock (10 in 15 min) and the per-IP limit; a locked account answers `401 PASSWORD_INVALID` without checking (equal timing, M73) |
| On success | new hash written only if the stored hash is still the one verified (review 1 m11); `credential_version` + 1 and `password_changed_at = now` (audit and display only) in the same `UPDATE`, under the owner row lock; every refresh token of the user revoked; a fresh token pair carrying the new `credential_version` returned to the caller. Every other access token and refresh token stops working at once, including one issued by a login or refresh that held the owner row while the change waited (review 2 N1): it carries the old version |
| `must_change_password` | set by `reset-owner-password`; read from `owner_users` by the JWT guard on every owner request (no token claim for it, review 1 M1); every `/v1/admin/*` route answers `403 PASSWORD_CHANGE_REQUIRED` while set; `change-password`, `refresh` and `logout` stay open; cleared by a successful change |
| Temporary password | set by `reset-owner-password` with `temp_password_expires_at = now + 86 400 000` (24 h, review 1 M3). Login with it after that instant: the hash is verified as usual (equal timing); a match counts as a failure (account counter and per-IP) and answers `401 LOGIN_INVALID`; the owner calls support again. Cleared (null) by a successful change |
| Lock notice | when a login or change-password failure sets `login_locked_until`, the same `UPDATE` sets `lock_notice_at = now`. The next successful login **or rotating refresh** (review 1 m1) returns `lockout_notice { locked_at, failed_count: 10 }` and clears it in the same transaction (shown once); a refresh inside the 30 s grace window (M49) writes nothing and returns `null` |

### 3.8 Role names carry no behaviour (R5, D-8)

**No code may branch on a role's name.** What a person may do comes only from grants, denials, scopes and responsibilities; a role's name is a label for people. Lookups go by `role_id`, or by `default_key` (B17) when a seed or migration needs a default role. The only source files that contain default role names are:
- `apps/cloud/src/modules/staff-roles/default-roles.ts` (the default role data, with each role's `default_key`);
- `apps/cloud/src/db/migrations/0003_manage_stock_backfill.sql`: **merged before this rule existed** (01a S18); it selects `WHERE r.name IN ('Owner', 'Manager')` and is not edited (F §6.8);
- `apps/cloud/src/db/migrations/0005_staff_roles.sql`: the one-time `default_key` backfill (§5.1), the last name match allowed.

`seed-tenant` looks roles up by `default_key`. Test 55 has the exact scope (§10.9a).

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| Foundation | §6 standards, envelopes, catalogue rule; D46 schema versioning |
| 00 cloud | tenant guard, repositories, `loadDirectory` (changed, §4.3), `owner-credentials`, JWT plugin, argon2 (`@node-rs/argon2` 2.2.2, M8 parameters), `SystemContext` CLIs, login and refresh services |
| 00 hub | `applyStaffDirectory`, `StaffDirectory`, `GET /queries/session`, `GET /queries/staff-roster`, M38 phone revoke, §3.5 PIN checks |
| 01a cloud | `withIdempotency`, `writeConfigAudit`, `bumpConfigVersion`, `coversEveryBranch`, common write script, `GET /v1/sync/config`, `GET /v1/admin/branches` |
| 01a hub | `SetPrecookedStock`, `AddPrecookedStock`, `SetItemAvailability`, `GET /admin/queries/stock` (scope hook, §4.4) |
| 01a client | owner shell, `PinPad`, `StaffTiles`, `ulid.ts`, i18n, `BlockedDialog`, cloud client |

### 4.2 Exposes (later modules may rely only on these)

| Export | Shape | Used by |
|---|---|---|
| `PERMISSION_CATALOGUE` (`@pos/domain`, browser-safe) | `[{ key, group, scopes }]`, group ∈ `orders, kitchen, bills, menu_stock, people, reports`; labels are client strings `perm.<key>`. *As built, v1.1 (AD-2):* grouped by where the action happens in the restaurant: orders = `void-item`, `take-order-anywhere`, `boost-order`, `approve-void`, `force-release-table-lock`; kitchen = `move-item-to-stock`, `mark-item-returned`, `reprint-ticket`; bills = `apply-discount`, `apply-refund`, `apply-comp`, `reopen-bill`; menu_stock = `edit-menu`, `manage-stock`; people = `manage-roles`, `manage-staff`, `manage-devices`, `access-hub-admin`; reports = `view-reports`, `view-audit-log`. A later module appends its permission to the group where its action happens | 01b UI; later modules append rows |
| `PERMISSION_SCOPES`, `Scope` | §3.3 table as data | 02, 04 |
| Hub `StaffDirectory.resolve` | adds `scope` and `approver_role_ids[]` (§3.3) | 02, 04, 01a stock |
| Hub `StaffDirectory.floorsOf(staffId)`, `leadOf(staffId)`, `teamOf(staffId)`, `stationsOf(staffId, responsibility)`, `responsibilityHolders(stationId, responsibility)` | ids for this hub's branch | 01d, 02, 04, 01a stock |
| `GET /queries/session` | `permissions[p] = { grant, approver_role_ids?, scope? }` (additive `scope`) | clients |
| `GET /queries/staff-roster` | adds `responsibilities: string[]` per person (e.g. `['count_stock']`) | 01a stock sign-in (01a Q11), 02 |
| `StaffDirectoryApplied` v2 | `skipped.kind` adds `'lead'`, `'responsibility'` (B18) | 06 |
| Cloud tables | `staff_leads`, `staff_floors`, `responsibilities`, `branches.hub_last_seen_at`, `branches.hub_synced_at` (§5) | 07 (stats, R25) |
| `roles.default_key` | `owner \| manager \| cashier \| order_taker \| waiter \| cook \| null`, unique per tenant when set (B17) | 02, 03b, 05 migrations that append default grants to running tenants |
| Cloud `GET /v1/admin/branches/:branch_id/team-tree` | §6.12 | 01d owner views, 07 |
| `config_audit` entities | `staff`, `role`, `responsibility`, `branch`, `owner_user` (§5) | 06 restore runbook (01a S42), 07 |
| Directory change rule | a directory shape change is **additive** (B18 a): every field an older hub reads is still sent with its old meaning, so the cloud can be released before the hubs and a hub whose upgrade fails keeps applying. Removing a field waits until every hub reads its replacement | 01d, 06 |

### 4.3 Changes to 00 (→ v1.5)

Each row is applied to `00_Hub_Platform_Access_Spec_v1.5.md` with a "Changed by 01b" marker at the target section. "Lands in" is the 01b build step (§11) that implements it.

| # | Target § | What changes | Why (01b ref) | Lands in |
|---|---|---|---|---|
| 1 | §5.2 `staff` | `pin_hash` NOT NULL → nullable; adds `pin_set_at`, `left_at` (CHECK `is_active = (left_at IS NULL)`), name length CHECK | B3, §3.2 | step 1 (cloud `0005`) |
| 2 | §5.2 `owner_users`, `owner_refresh_tokens` | `owner_users` adds `must_change_password`, `lock_notice_at`, `password_changed_at` (audit and display), `temp_password_expires_at` (M3), `credential_version INT NOT NULL DEFAULT 0` (review 2 N1), `staff_id` (nullable link to the owner's staff row); `owner_refresh_tokens` adds `credential_version INT NOT NULL DEFAULT 0` (N1) | B5, B7 | step 1 |
| 3 | §5.2 `roles`, `role_permissions` | `roles` adds `default_key` (unique per tenant when set, backfilled, M5), `archived_at`, idle (whole minutes, m10) and name CHECKs, active-name unique index; `role_permissions` adds `scope`; new `role_permission_approvers`; `approver_role_id` is **dual-written** with the first approver and its CHECK is kept (M7) | B2, B10, B13, B14, B17, B22 | step 1 |
| 4 | §5.1 hub | new hub migration `0005_directory_v2.sql` (§5.2 here): `role_permissions` rebuilt with `scope`, approvers in their own table, `staff.lead_staff_id`, `staff_floors`, `responsibilities`; `StaffDirectory.load` reads 9 fixed statements instead of 6 | B1, B2, B4, B10 | step 5 |
| 5 | §6.5 response `directory`; §4.2 `applyStaffDirectory` | directory shape v2 (§4.3.1 below), **additive** (M6): `approver_role_ids[]` and `scope` next to the kept `approver_role_id`, `lead_staff_id`, `floor_ids`, `responsibilities`; staff with no PIN not sent; the role set includes every approver role read from `role_permission_approvers` (m3); `loadDirectory` 5 → 8 statements | B3, B4, B10, B18 | steps 3–5 |
| 6 | §3.1 M10, §3.6 `resolve` | returns `scope`; approvers read from the list table (the union rule is unchanged) | B2, B10 | step 5 |
| 7 | §4.2 `StaffDirectory` | adds `floorsOf`, `leadOf`, `teamOf`, `stationsOf`, `responsibilityHolders` | B1, B2, B4 | step 5 |
| 8 | §4.2 `StaffDirectoryApplied`, §3.1 M52 | payload `schema_version 2`: `skipped.kind` adds `'lead'`, `'responsibility'`; identity upcaster v1 → v2; M52's skip list adds a lead or responsibility naming an absent person, drops an unknown approver id from a grant's list and skips a `requires_approval` grant left with none (m4) | B18 | step 5 |
| 9 | §6.19 `GET /queries/staff-roster` | staff rows add `responsibilities: string[]` (from memory; query count unchanged) | B4 | step 5 |
| 10 | §6.20 `GET /queries/session` | `permissions[p]` adds `scope` (absent for `denied` / `not_granted`) | B2 | step 5 |
| 11 | §6.22 `POST /v1/auth/login` (and the JWT the change and refresh issue) | success: `user.must_change_password`, `data.lockout_notice`, read and clear `lock_notice_at`; failure: the `UPDATE` that sets `login_locked_until` also sets `lock_notice_at`; a matching temporary password past `temp_password_expires_at` counts as a failure → `401 LOGIN_INVALID` (M3); the success transaction first takes the owner row `WHERE password_hash = $verified FOR NO KEY UPDATE` (review 2 N2), no row → `401 LOGIN_INVALID` (M2, login path); the JWT gains claim `cv` = `credential_version` read under that lock, and the refresh-token row stores it (review 2 N1). No `iat_ms`, no `pwc` | B5 (M73) | step 10 |
| 12 | §6.23 `POST /v1/auth/refresh` | lock order: token looked up unlocked, then `owner_users … FOR NO KEY UPDATE` (review 2 N2; reads `must_change_password`, `credential_version`, `lock_notice_at`), then the token row `FOR UPDATE`; a token whose `credential_version` ≠ the owner's → `401 REFRESH_TOKEN_INVALID`, nothing revoked (review 2 N1, §6.13 here); successor row and JWT carry the current `credential_version`; the rotating path returns and clears `lockout_notice`, the grace path returns `null` (m1); response `user.must_change_password` | B5 | step 10 |
| 13 | §3.1 M73 | "told out of band (requirement on 01/07)" is met by the notice on the next login or rotating refresh (§6.13 here) | B5 | step 10 |
| 14 | §3.1 M29, §6.26 | default roles Owner 60, Manager 60, Cashier 15, Order taker 15 (Q12), Waiter 5, Cook 5 (Order taker kept as its own role, D-12), each with its `default_key`; roles looked up by `default_key`; `owner_users.staff_id` set to the owner's staff row | B6, B7, B17 | step 11 |
| 15 | §6.33 endpoint count | note: `POST /v1/auth/change-password` is specified and counted in 01b (§6.16 here); 00 stays at 30 | B5 | — |
| 16 | §7.2 redaction | body fields `current_password`, `new_password` | B5 | step 10 |
| 17 | §7.10 folders | `modules/owner-auth/` also holds change-password (01b); `cli/reset-owner-password.ts`, `cli/link-owner-staff.ts` | B5, B7 | step 10 |
| 18 | §6.24a (new), JWT tenant guard | after the signature check, one statement `SELECT must_change_password, credential_version FROM owner_users WHERE tenant_id = $1 AND user_id = $2` (JWT `sub`): no row, or claim `cv` (missing = 0) ≠ `credential_version` → `401 JWT_INVALID` (review 2 N1); the read fails (connection, timeout, any database error) → `503 SERVICE_UNAVAILABLE`, never `401` (review 2 N9); `must_change_password` on a `/v1/admin/*` route → `403 PASSWORD_CHANGE_REQUIRED`. Applies to every `tenantScope: 'jwt'` route, including logout (M1) | B5 | step 10 |
| 19 | §3.1 M57, §6.27 `issue-registration-code` | a new branch gets only **qualifying admins** (B7: active, with a PIN, effective `access-hub-admin` **and** `manage-devices` both `allowed`; m6, D-14a), so stock counters are not assigned; two of them with the same display name (case-insensitive, trimmed, B12) → exit 1 listing the duplicated names, nothing written, never auto-renamed (D-14b); the CLI takes `tenants … FOR NO KEY UPDATE` first and bumps `tenants.directory_version` (B11); *As built, v1.1 (AD-4):* the reissue path (`--branch-id`) takes the same lock but bumps nothing, because it changes no directory data; a branch name already used in the tenant (case-insensitive) → exit 1, nothing written (m9 index) | B7, B11, B12, m6, m9, D-14 | step 9 |
| 20 | §5.2 cloud migrations runner (`apps/cloud/src/db/migrate.ts`; 00 M1) | before applying anything, a `schema_migrations` row whose `version` has no file in this build → refuse to start: throw `MigrationUnknownVersionError` "database has migration NNNN (<name>) that this build does not have: this build is older than the database; deploy the current build (rollback is not supported)" and exit non-zero, nothing applied. The hub runner already refuses (`user_version` above its files, `apps/hub/src/db/migrate.ts`) and is unchanged (review 2 N5, B22) | B22 | step 1 |

Unchanged in 00: M30 (station sessions), M11, M50, M51, M75, §3.5 (a person with no PIN answers `404 STAFF_NOT_FOUND`, not counted), every hub route except rows 9 and 10.

#### 4.3.1 Directory shape v2 (`packages/events/src/directory.ts`)

Additive over v1 (B18 a, review 1 M6): a hub on v1.4 code parses it and applies it with v1 semantics. Release order in §7.4.

```json
{
  "directory_version": 42,
  "staff": [{
    "staff_id": "01JC…", "display_name": "Bilal", "pin_hash": "$argon2id$v=19$m=19456,t=2,p=1$…",
    "role_ids": ["01JC…waiter"], "denied_permissions": [],
    "lead_staff_id": "01JC…hamza", "floor_ids": ["01JC…ground"]
  }],
  "roles": [{
    "role_id": "01JC…waiter", "name": "Waiter", "session_idle_ttl_ms": 300000,
    "permissions": [
      { "permission": "take-order-anywhere", "grant_type": "allowed", "approver_role_id": null, "approver_role_ids": [], "scope": "my_floors" },
      { "permission": "apply-discount", "grant_type": "requires_approval", "approver_role_id": "01JC…manager", "approver_role_ids": ["01JC…manager", "01JC…owner"], "scope": "branch" }
    ]
  }],
  "responsibilities": [{ "responsibility": "count_stock", "station_id": "01JC…grill", "staff_ids": ["01JC…usman"], "role_ids": [] }]
}
```

- `approver_role_ids` (B10) is new; `approver_role_id` is **kept** and equals `role_permissions.approver_role_id`, the first of the sorted list (null for `allowed`), so v1.4 hubs keep their single approver. `lead_staff_id`, `floor_ids`, `scope`, `responsibilities` new. The staff list is per branch, so `lead_staff_id` and `floor_ids` are that branch's.
- The `roles` list holds every role held by a person sent **and** every role named in `role_permission_approvers` by those roles' grants (review 1 m3), so an approver role nobody holds at this branch (e.g. Manager at a branch with no manager) is still sent and Cashier's `apply-discount` is not skipped.
- v2 hubs read `approver_role_ids` and ignore `approver_role_id`.
- Staff with `pin_hash IS NULL` are not sent (B3); a `lead_staff_id` or responsibility naming someone not sent is **skipped** on the hub (B18), so the reference reads as none.
- M50 (PIN change ends sessions) and M38 (removed owner's phone revoked) unchanged; a lead or floor change ends nothing.

### 4.4 Changes to 01a (→ v1.3)

Each row is applied to `01_Restaurant_Setup_Spec_v1.3.1.md` (renamed from v1.3 by the S50 a amendment) with a "Changed by 01b" marker at the target section.

| # | Target § | What changes | Why (01b ref) | Lands in |
|---|---|---|---|---|
| 1 | §6 shared failures, §6.0 | `403 PASSWORD_CHANGE_REQUIRED` on every JWT owner route while `must_change_password` is set, `401 JWT_INVALID` for a token issued before the owner's last password change or reset (credential version, review 2 N1), and `503 SERVICE_UNAVAILABLE` when the guard cannot read the owner row (never `401`, review 2 N9); both decided by 00's JWT guard (00 §6.24a, §4.3 row 18), which reads the owner row once per request; that statement belongs to the guard and is not counted in a route's statement count (as the branch-key lookup of §6.1 is not). 01a routes: `GET …/branches/:b/floors` (6.2), `POST …/floors` (6.3), `PATCH …/floors/:id` (6.4), `POST …/tables` (6.5), `PATCH …/tables/:id` (6.6), `GET /v1/admin/branches` (6.7b), `GET …/stations` (6.8), `POST …/stations` and `PATCH …/stations/:id` (6.9), `POST …/programs` and `PATCH …/programs/:id` (6.10), `GET /v1/admin/menu` (6.11), `POST` and `PATCH /v1/admin/tax-classes` (6.12), `POST` and `PATCH /v1/admin/categories` (6.13), `POST /v1/admin/menu-items` (6.14), `PATCH /v1/admin/menu-items/:id` (6.15), `PUT …/routes/:branch_id` (6.16): **19 routes**. `GET /v1/sync/config` (branch key) is not affected | B5 | step 10 |
| 2 | §3.1 S26, §5.2 `config_audit` | `entity` adds `staff`, `role`, `responsibility`, `branch`, `owner_user`; `action` adds `pin_set`, `left`, `returned`, `reports_to_reassigned`, `password_change`, `password_reset`; `actor_kind` values unchanged (`owner`, `cli`), and `cli` is also written by `reset-owner-password` and `link-owner-staff` (S26 named only `set-branch-settings`) | B21 | step 1 |
| 3 | §5.2 `branches` CHECKs and indexes, §6.7 CLI | `day_stale_after_hours` 1–48 (was 1–72), `day_min_gap_hours` 0–12 (was 0–24); existing rows clamped first (§5.1); `set-branch-settings` accepts the same ranges; name length 1–60 CHECK and unique index `branches_name` on `(tenant_id, lower(name))` (m9; no clamp, the migration aborts on a violation); new columns `hub_last_seen_at`, `hub_synced_at` | B16, B19, B22 | steps 1, 9 |
| 4 | §3.1 S8 lock order | adds: directory writes (01b) take `tenants … FOR NO KEY UPDATE` first, then their target rows in id order, and read reference rows (floors, stations, roles) without a lock; they take no explicit lock on `branches`. **Corrects** "config writes never lock `tenants`": config inserts into tables referencing `tenants` take the FK's `FOR KEY SHARE` on it, which does not conflict with `FOR NO KEY UPDATE`; the no-cycle argument is B11's (m5) | B11 | step 6 |
| 5 | §4.4 01b row, §12.5 | "session idle TTL defaults stored in restaurant settings" → **per role** (`roles.session_idle_ttl_ms`, 1–240 min, edited on the role). This **departs from the carried row** | B13 | step 7 |
| 6 | §6.1 `GET /v1/sync/config` | after the read transaction, one statement: on `304`, `UPDATE branches SET hub_last_seen_at = $now, hub_synced_at = $now WHERE tenant_id = $1 AND branch_id = $2`; on `200`, the same `UPDATE` setting `hub_last_seen_at` only (M6). The directory part is 00 v1.5's additive shape (8 statements). Queries: 2 (`304`), ≤ 17 (`200`) | B19, B10, B18 | steps 4, 9 |
| 7 | §6.7b `GET /v1/admin/branches` | rows add `hub_last_seen_at` and `hub_synced_at` (both nullable); the response adds `hub_stale_after_ms = 3 × CONFIG_POLL_INTERVAL_MS` (D-11); still 1 statement | B19 | step 9 |
| 8 | §6.7 | the owner endpoint `PATCH /v1/admin/branches/:branch_id/settings` and its `GET` exist (01b §6.10) | B16 | step 9 |
| 9 | §6.17 `SetPrecookedStock`, §6.17a `AddPrecookedStock`, §6.18 `SetItemAvailability` | with the session's `manage-stock` scope `my_stations`, an entry (or the item) not routed at this branch to one of `stationsOf(staff, 'count_stock')` → `403 PERMISSION_DENIED { permission: 'manage-stock', reason: 'outside_scope', item_ids }`, nothing written. Scope `branch` unchanged. *As built, v1.1 (AD-21):* the scope check runs after 01a's own checks (config present, day open, item found, stock-tracked), so `404` / `409` / `422` keep their 01a meaning (README C8); `item_ids` lists every in-config entry outside the person's stations, in request order; a holder with no stations changes nothing | B20 | step 8 |
| 10 | §6.19 `GET /admin/queries/stock` | with scope `my_stations`, `items_meta` and `items` hold only items routed to the person's stations; statement count unchanged | B20 | step 8 |
| 11 | §8.2 `/admin/stock` page | shows only the rows the query returns; no client-side filtering of scope | B20 | step 8 |
| 12 | §6.18a `OpenBusinessDay`, §6.18b `CloseBusinessDay` | need `manage-stock` with scope `branch`; under `my_stations` → `403 PERMISSION_DENIED { permission: 'manage-stock', reason: 'outside_scope', required_scope: 'branch' }`, no event (checked after the `manage-stock` step) | B20 (D-6) | step 8 |
| 13 | §6.19 response, §8.2 page | the stock query adds `manage_stock_scope: 'branch' \| 'my_stations'` (the session's, from memory; *As built, v1.1 (AD-23):* required, on every answer including `unchanged`; `my_stations` only when the resolved `manage-stock` grant has that scope, else `branch`); under `my_stations` the page hides **Start day**, **Close day** and the stale-day prompt, and a `409 BUSINESS_DAY_NOT_OPEN` shows "The day hasn't been started. Ask someone who can start the day." | B20 (D-6) | steps 8, 13 |
| 14 | §3.4 config poll | the 60 000 ms interval becomes the shared constant `CONFIG_POLL_INTERVAL_MS` exported from `packages/events/src/config.ts`; the hub poller imports it (value unchanged) and the cloud derives `hub_stale_after_ms` from it (row 7) | B19, D-11 | step 9 |
| 15 | §7.8 cloud release | adds the step "never redeploy a cloud build older than 01b once `0005_staff_roles.sql` is applied; undo a release by deploying a newer fixed build" (v1.4 builds cannot refuse by themselves; later builds do, 00 §5.2 runner, §4.3 row 20) | B22 (review 2 N5) | step 1 |
| 16 | §7.8 build | the owner entry reads the optional build value `VITE_SUPPORT_PHONE`; unset → support texts end "Call support." with no number (owner answer Q3, 01b §8) | §8 (Q3) | step 13 |

Unchanged in 01a: the snapshot (§4.3), every other route, every event, the common write script, the branch-config hub side.

### 4.5 Requirements carried to other modules

Also listed in the README's "Requirements carried to other modules" table, so the receiving spec's gate check finds them.

| To | Requirement | From |
|---|---|---|
| 06 | **A rejected value never blocks the sync queue.** When 06 adds hub-to-cloud ingest (or any queued write to the cloud), a payload that fails a cloud CHECK or validation must be set aside (recorded, with the reason) so the items queued behind it keep syncing; decide then whether that needs a minimum client version, a server-side clamp with an audit row, or both. Not needed before 06: today no queue writes to the cloud (B22). | 01b B22, D-9 |
| 02, 03b, 05 | **Default grants reach running tenants by `default_key`, never by name** (`order_taker` and `waiter` for 02, `cook` for 03b, `cashier` for 05): append to `default-roles.ts` and, for seeded tenants, a migration `WHERE default_key = '<key>'` | 01b B17, §3.8 (review 1 M5) |
| 02 | **Order taker and Waiter are different jobs (D-12):** when 02 grants ordering permissions it decides them **separately per `default_key`** (`order_taker` takes orders; `waiter` serves) and must not assume the two roles are the same or give them the same grants by default. A person doing both holds both roles; 02 adds no mode or toggle for it | 01b B17, D-12 |
| 01d | **Cross-team requests (owner answer Q11):** when a person's own team is unavailable, they can send a task request (e.g. "serve table 5") to staff outside their team, such as others on the same floor. Example: an order taker's two waiters are busy, so they notify another order taker's waiters on the same floor. This is a request the receiver accepts, never a permission: it grants no authority over the other team (R5, E6-TEAM AC5) | 01b §3.3, §3.5 (Q11) |
| 01d, 06 | **Directory changes stay additive** (B18 a): old fields keep their meaning; removal only after every hub reads the replacement | 01b B18 (review 1 M6) |

---

## §5. Data model and migrations

### 5.1 Cloud — `0005_staff_roles.sql`

**Expand + contract, roll forward only** (F §6.8, overridden for the named steps by B22). Most steps expand (nullable or defaulted columns, new tables, a backfill). The **contract steps** are named below; they are safe because (1) the clamp runs first, in the same transaction, so no existing row can fail the tightened CHECKs; (2) there are no running tenants and dev data is re-seeded (B6), so the new CHECKs on names and idle times meet only seeded rows, and any violation aborts the whole migration with nothing applied; (3) the cloud rolls forward only once this migration is applied (B22, §7.4), so no app version older than 01b writes after it runs (an old `set-branch-settings` would be refused by the database, never silently stored). Name CHECKs and the unique branch-name index are not clamped: a violating row aborts the migration with nothing applied (test 89). Times `BIGINT` Unix ms. Tenant-level tables use `TenantLevelRepository` (M16); branch-level use `TenantScopedRepository`. Every index leads with `tenant_id`.

```sql
-- staff (B3, B12, §3.2)
ALTER TABLE staff ALTER COLUMN pin_hash DROP NOT NULL;                       -- contract for rollback (B22): v1.4 code cannot read a NULL. B3
ALTER TABLE staff ADD COLUMN pin_set_at BIGINT;                              -- expand. "Set on 12 Oct"
ALTER TABLE staff ADD COLUMN left_at BIGINT;                                 -- expand
ALTER TABLE staff ADD CONSTRAINT staff_left CHECK (is_active = (left_at IS NULL));            -- contract (new CHECK on existing rows; all active)
ALTER TABLE staff ADD CONSTRAINT staff_name_len CHECK (char_length(display_name) BETWEEN 1 AND 40);  -- contract
CREATE INDEX staff_active ON staff (tenant_id, is_active, display_name);    -- §6.1 list by status, ordered by name

-- names unique per branch among active staff (B12): checked in the write (§6.2 rule 4), not by index,
-- because uniqueness spans staff × staff_branches; the tenants row lock (B11) serialises the check.

-- owner link and password state (B5, B7)
ALTER TABLE owner_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;  -- expand
ALTER TABLE owner_users ADD COLUMN lock_notice_at BIGINT;                                -- expand
ALTER TABLE owner_users ADD COLUMN password_changed_at BIGINT;                           -- expand. JWT guard, refresh check (B5)
ALTER TABLE owner_users ADD COLUMN temp_password_expires_at BIGINT;                      -- expand. 24 h temporary password (B5)
ALTER TABLE owner_users ADD CONSTRAINT owner_users_temp_password
  CHECK (temp_password_expires_at IS NULL OR must_change_password);                     -- a temporary password is always a forced change
ALTER TABLE owner_users ADD COLUMN credential_version INT NOT NULL DEFAULT 0;            -- expand. B5 (review 2 N1): +1 on every change or reset
ALTER TABLE owner_refresh_tokens ADD COLUMN credential_version INT NOT NULL DEFAULT 0;   -- expand. N1: the owner's version when the token was issued
ALTER TABLE owner_users ADD COLUMN staff_id TEXT;                                        -- expand. B7 own-admin guard
ALTER TABLE owner_users ADD CONSTRAINT owner_users_staff
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff (tenant_id, staff_id);
CREATE UNIQUE INDEX owner_users_staff_once ON owner_users (tenant_id, staff_id)
  WHERE staff_id IS NOT NULL;                                                         -- one owner login per staff row (§6.15a)

-- roles (B13, B14, B17)
ALTER TABLE roles ADD COLUMN default_key TEXT
  CHECK (default_key IN ('owner','manager','cashier','order_taker','waiter','cook'));       -- expand. B17: stable handle; is_default = (default_key IS NOT NULL)
CREATE UNIQUE INDEX roles_default_key ON roles (tenant_id, default_key)
  WHERE default_key IS NOT NULL;                                             -- one role per key per tenant; later default-grant migrations look up by it
-- one-time backfill (review 1 M5), the last role-name match allowed (§3.8): per tenant and name, the oldest
-- role (smallest ULID role_id). 'Order taker' gets 'order_taker' (D-12). Waiter and Cook do not exist
-- before 01b and are not created here (B6: re-seeded). No grant changes.
UPDATE roles r SET default_key = m.default_key
  FROM (SELECT DISTINCT ON (tenant_id, name) tenant_id, role_id,
               CASE name WHEN 'Owner' THEN 'owner' WHEN 'Manager' THEN 'manager' WHEN 'Cashier' THEN 'cashier'
                         WHEN 'Order taker' THEN 'order_taker' END AS default_key
          FROM roles WHERE name IN ('Owner','Manager','Cashier','Order taker')
         ORDER BY tenant_id, name, role_id) m
 WHERE r.tenant_id = m.tenant_id AND r.role_id = m.role_id;
-- review 2 N6: abort loudly if any tenant would lack one of the four keys every v1.4 seed created
-- (e.g. the owner renamed "Manager" before this release). Fixed by hand, then the migration is re-run.
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(t.tenant_id || ': ' || k.key, ', ' ORDER BY t.tenant_id, k.key) INTO missing
    FROM tenants t
   CROSS JOIN (VALUES ('owner'), ('manager'), ('cashier'), ('order_taker')) AS k(key)
   WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.tenant_id = t.tenant_id AND r.default_key = k.key);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'default_key backfill incomplete (tenant: missing key): %', missing;
  END IF;
END $$;
ALTER TABLE roles ADD COLUMN archived_at BIGINT;                             -- expand
ALTER TABLE roles ADD CONSTRAINT roles_idle CHECK (session_idle_ttl_ms BETWEEN 60000 AND 14400000
                                                   AND session_idle_ttl_ms % 60000 = 0);  -- contract (whole minutes, m10)
ALTER TABLE roles ADD CONSTRAINT roles_name_len CHECK (char_length(name) BETWEEN 1 AND 40);          -- contract
CREATE UNIQUE INDEX roles_active_name ON roles (tenant_id, lower(name)) WHERE archived_at IS NULL;   -- CONFIG_NAME_TAKEN

-- grants (B2, B10): the approver list gets its own table. approver_role_id is dual-written with the first
-- approver (sorted) and its requires_approval ⇔ approver CHECK (role_permissions_check) is kept, so a
-- rolled-back v1.4 cloud still sends a valid approver (B22, review 1 M7). Dropped in a later release (§12.4).
ALTER TABLE role_permissions ADD COLUMN scope TEXT NOT NULL DEFAULT 'branch'
  CHECK (scope IN ('branch','own_tables','my_floors','my_team','my_stations'));          -- expand
CREATE TABLE role_permission_approvers (
  tenant_id TEXT NOT NULL, role_id TEXT NOT NULL, permission TEXT NOT NULL, approver_role_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, role_id, permission, approver_role_id),
  FOREIGN KEY (tenant_id, role_id, permission) REFERENCES role_permissions ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, approver_role_id) REFERENCES roles (tenant_id, role_id));
CREATE INDEX role_permission_approvers_approver
  ON role_permission_approvers (tenant_id, approver_role_id);                -- B14: "is this role an approver?"
INSERT INTO role_permission_approvers (tenant_id, role_id, permission, approver_role_id)
  SELECT tenant_id, role_id, permission, approver_role_id FROM role_permissions
   WHERE approver_role_id IS NOT NULL;                                        -- backfill (dev data only, B6)

-- teams (§3.5)
CREATE TABLE staff_leads (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, staff_id TEXT NOT NULL, lead_staff_id TEXT NOT NULL,
  CHECK (staff_id <> lead_staff_id),
  PRIMARY KEY (tenant_id, branch_id, staff_id),                              -- one lead per branch (Q18)
  FOREIGN KEY (tenant_id, branch_id, staff_id) REFERENCES staff_branches (tenant_id, branch_id, staff_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, branch_id, lead_staff_id) REFERENCES staff_branches (tenant_id, branch_id, staff_id));
CREATE INDEX staff_leads_lead ON staff_leads (tenant_id, branch_id, lead_staff_id);  -- B15 re-parent, loop walk

-- floors per person (B2)
CREATE TABLE staff_floors (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, staff_id TEXT NOT NULL, floor_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, staff_id, floor_id),
  FOREIGN KEY (tenant_id, branch_id, staff_id) REFERENCES staff_branches (tenant_id, branch_id, staff_id) ON DELETE CASCADE);

-- responsibilities (§3.6)
CREATE TABLE responsibilities (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  responsibility TEXT NOT NULL CHECK (responsibility IN ('count_stock')),
  station_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('staff','role')),
  subject_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, responsibility, station_id, subject_kind, subject_id));
CREATE INDEX responsibilities_subject ON responsibilities (tenant_id, subject_kind, subject_id);  -- leaver / role archive cleanup

-- branches (B16, B19, §6.9)
ALTER TABLE branches ADD COLUMN hub_last_seen_at BIGINT;                     -- expand. B19: every poll
ALTER TABLE branches ADD COLUMN hub_synced_at BIGINT;                        -- expand. B19: last 304 poll (hub up to date)
ALTER TABLE branches ADD CONSTRAINT branches_name_len CHECK (char_length(name) BETWEEN 1 AND 60);   -- contract
CREATE UNIQUE INDEX branches_name ON branches (tenant_id, lower(name));     -- contract (m9): §6.9 rename, issue-registration-code
UPDATE branches SET day_stale_after_hours = LEAST(day_stale_after_hours, 48),
                    day_min_gap_hours = LEAST(day_min_gap_hours, 12);        -- contract: clamp, runs first
ALTER TABLE branches DROP CONSTRAINT branches_day_stale_after_hours_check;
ALTER TABLE branches ADD CONSTRAINT branches_day_stale CHECK (day_stale_after_hours BETWEEN 1 AND 48);  -- contract
ALTER TABLE branches DROP CONSTRAINT branches_day_min_gap_hours_check;
ALTER TABLE branches ADD CONSTRAINT branches_day_gap CHECK (day_min_gap_hours BETWEEN 0 AND 12);        -- contract
-- branches_day_settings (stale > gap, 01a S33) is kept. The clamp keeps it true: before it, stale > gap;
-- if stale > 48 it becomes 48 and gap ≤ 12 < 48; if only gap > 12 it becomes 12 and stale > old gap > 12.

-- audit (01a S26 table, new entities and actions, B21)
ALTER TABLE config_audit DROP CONSTRAINT config_audit_entity_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_entity_check CHECK (entity IN (
  'floor','table','station','batch_program','tax_class','category','menu_item','item_route','branch_settings',
  'staff','role','responsibility','branch','owner_user'));                    -- expand (widens)
ALTER TABLE config_audit DROP CONSTRAINT config_audit_action_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_action_check CHECK (action IN (
  'create','update','archive','restore','route_set','route_removed',
  'pin_set','left','returned','reports_to_reassigned','password_change','password_reset'));  -- expand (widens)
```

Notes:
- Constraint names above follow PostgreSQL's generated names (`<table>_<column>_check` for a column CHECK, `<table>_check` for an unnamed table CHECK); build step 1 reads the real names from `0001`/`0002` first (§12.3 D-5).
- `role_permissions.approver_role_id` is dual-written: on every grant write it holds the first of the sorted `approver_role_ids` for `requires_approval`, null for `allowed` (the kept CHECK enforces it). `role_permission_approvers` is the source of truth; a later release drops the column (§12.4).
- `staff_leads` and `staff_floors` cascade from `staff_branches`, so removing a person from a branch removes their line and floors there (B15 re-parenting runs first, in the service). **A `branch_ids` change is applied as a diff** (review 1 m7): delete only the removed `staff_branches` rows and insert only the added ones; never delete-and-reinsert, which would cascade away the person's leads and floors at the branches they keep.
- The `staff_left` CHECK, the name CHECKs and `branches_name` are checked against existing rows by test 70 (no violation on seeded data) and test 89 (a violation aborts the migration, nothing applied).
- `pin_hash` never appears in `config_audit` `before`/`after` (§5.3 shapes exclude it).

### 5.2 Hub — `0005_directory_v2.sql`

Forward-only; `role_permissions` uses the table-rebuild pattern (F §6.8: the runner sets `PRAGMA foreign_keys = OFF` before the transaction and runs `PRAGMA foreign_key_check` before commit). All these tables are a cache replaced whole by `applyStaffDirectory` (00 §5.1), so the copy only keeps the hub working until the first v2 apply.

```sql
CREATE TABLE role_permissions_v2 (
  role_id    TEXT NOT NULL REFERENCES roles(role_id),
  permission TEXT NOT NULL,
  grant_type TEXT NOT NULL CHECK (grant_type IN ('allowed','requires_approval')),
  scope      TEXT NOT NULL DEFAULT 'branch'
             CHECK (scope IN ('branch','own_tables','my_floors','my_team','my_stations')),
  PRIMARY KEY (role_id, permission));
INSERT INTO role_permissions_v2 (role_id, permission, grant_type)
  SELECT role_id, permission, grant_type FROM role_permissions;
CREATE TABLE role_permission_approvers (
  role_id TEXT NOT NULL, permission TEXT NOT NULL,
  approver_role_id TEXT NOT NULL REFERENCES roles(role_id),
  PRIMARY KEY (role_id, permission, approver_role_id),
  FOREIGN KEY (role_id, permission) REFERENCES role_permissions_v2(role_id, permission));
INSERT INTO role_permission_approvers (role_id, permission, approver_role_id)
  SELECT role_id, permission, approver_role_id FROM role_permissions WHERE approver_role_id IS NOT NULL;
DROP TABLE role_permissions;
ALTER TABLE role_permissions_v2 RENAME TO role_permissions;   -- also renames the approvers' foreign-key target

ALTER TABLE staff ADD COLUMN lead_staff_id TEXT;               -- no FK: a skipped lead reads as none (B18)
CREATE TABLE staff_floors (
  staff_id TEXT NOT NULL REFERENCES staff(staff_id), floor_id TEXT NOT NULL,
  PRIMARY KEY (staff_id, floor_id));
CREATE TABLE responsibilities (
  responsibility TEXT NOT NULL CHECK (responsibility IN ('count_stock')),
  station_id     TEXT NOT NULL,
  subject_kind   TEXT NOT NULL CHECK (subject_kind IN ('staff','role')),
  subject_id     TEXT NOT NULL,
  PRIMARY KEY (responsibility, station_id, subject_kind, subject_id));
```

`StaffDirectory.load` reads 9 fixed statements (staff, roles, role_permissions, role_permission_approvers, staff_roles, staff_permission_denials, staff_floors, responsibilities, staff_directory_meta); still read whole at boot and after apply, so no secondary indexes (00 §5.1). `applyStaffDirectory` deletes children before parents (approvers, floors, responsibilities, then the 00 order). The hub reads `approver_role_ids` from the wire and ignores the kept `approver_role_id` (B18 a). The first line of the file is `-- migrate:foreign-keys-off`, which makes the hub runner (`apps/hub/src/db/migrate.ts`) turn foreign keys off for the rebuild and run `foreign_key_check` before commit.

### 5.3 Wire shapes (Zod in `packages/events/src/admin/staff.ts`, 01a D5)

```ts
StaffWire = { staff_id, display_name, role_ids: string[], branch_ids: string[],
              denied_permissions: Permission[], has_pin: boolean, pin_set_at: number | null,
              is_active: boolean, left_at: number | null,
              reports_to: { branch_id, lead_staff_id }[], floors: { branch_id, floor_ids: string[] }[],
              version: string }                                      // B23; not in audit rows
RoleWire  = { role_id, name, is_default: boolean,                     // default_key IS NOT NULL (B17)
              archived_at: number | null, idle_minutes: number,
              staff_count: number,                                   // active staff, read only; not hashed
              grants: { permission, grant_type: 'allowed' | 'requires_approval',
                        approver_role_ids: string[], scope: Scope }[],
              version: string }                                      // B23; not in audit rows
ResponsibilityWire = { responsibility: 'count_stock', station_id, staff_ids: string[], role_ids: string[] }
BranchWire = { branch_id, name, status, hub_last_seen_at: number | null, hub_synced_at: number | null,
               tax_enabled, day_stale_after_hours, day_min_gap_hours }
// version: B23, rules below.
TeamNode   = { staff_id, display_name, has_pin: boolean, role_ids: string[], members: TeamNode[] }
```

**Version inputs and canonicalisation (B23, review 2 N4).** One module, `apps/cloud/src/modules/staff-roles/versions.ts`, builds every wire (`toStaffWire`, `toRoleWire`, `toResponsibilitySet`) and every version (`staffVersion`, `roleVersion`, `responsibilitySetVersion`). `GET`s, in-transaction compares and write responses all call it; no other code builds a wire or a version.

| Entity | Version input (exactly these keys) |
|---|---|
| Staff | `staff_id`, `display_name`, `role_ids`, `branch_ids`, `denied_permissions`, `reports_to`, `floors`, `is_active` |
| Role | `role_id`, `name`, `idle_minutes`, `archived` (boolean, `archived_at IS NOT NULL`), `grants` (each `{ permission, grant_type, approver_role_ids, scope }`) |
| Responsibility set | `branch_id`, `responsibilities` (the branch's `ResponsibilityWire[]` for **active** stations only) |

1. **Hash:** `version = sha256hex(canonicalJson(input))` with `@pos/domain/hash` (01a S27), lowercase hex.
2. **Keys:** `canonicalJson` sorts object keys; the input has exactly the keys above, no more.
3. **Arrays are sorted by the builder** (and returned in the same order on the wire), by JavaScript string comparison (`a < b`, UTF-16 code units, no locale): `role_ids`, `branch_ids`, `denied_permissions`, `approver_role_ids`, `floor_ids`, and a responsibility's `staff_ids` and `role_ids` by value; `reports_to` and `floors` by `branch_id`; `grants` by `permission`; `responsibilities` by `station_id`, then `responsibility`. An array is never left in database order.
4. **Null and absence:** every key is always present. A nullable value is `null`, never `undefined` and never omitted; an empty list is `[]`. (`canonicalJson` throws on `undefined`, so a missing value fails in tests instead of hashing differently.)
5. **Numbers:** every `INT`/`BIGINT` column is converted with `Number()` in the repository, before any builder sees it (`pg` returns `BIGINT` as a string). `idle_minutes = session_idle_ttl_ms / 60000`, an integer by the `roles_idle` CHECK. Booleans stay booleans.
6. **Strings** are hashed as stored (`display_name` and `name` are trimmed at write time, §6.2, §6.6).

---

## §6. Endpoints

All under `/v1`, JWT, tenant guard (with 00 §6.24a's owner-row read, B5), owner account. Shared failures, not repeated: `400 VALIDATION_FAILED`, `401 JWT_INVALID` (including a token issued before the last password change or reset), `403 PASSWORD_CHANGE_REQUIRED` (§3.7; every route except §6.11), `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` (every write, B8), `422 IDEMPOTENCY_KEY_MISMATCH` (creating `POST`s). Statement counts below exclude the guard's read.

**Directory write script** (staff, roles, responsibilities): validate (Zod) → `BEGIN` → [creating `POST`: idempotency key first, 01a S7] → `SELECT … FROM tenants WHERE tenant_id = $1 FOR NO KEY UPDATE` (B11) → read the owner's `allowed_branch_ids` and `staff_id` from `owner_users`; the owner must cover every branch of the tenant (`coversEveryBranch`), else `403 tenant_wide_write` (B8, B7) → load and lock the target row(s) `FOR UPDATE` in id order (`404` if absent) → [`PATCH` / `PUT`: build the stored wire; `expected_version` ≠ its `version` → `409 CONFIG_STALE`, B23] → [guards: before, §3.4] → rule checks (§3.2–§3.6, on the **merged** row; reference rows read without a lock, B11) → write → [guards: after] → `writeConfigAudit` (one row per changed entity; `before`/`after` in wire shape without `pin_hash`, `version`, `staff_count`; *As built, v1.1 (AD-15):* a cascade that changes a branch's active responsibility set writes one `responsibility` / `update` row with that `branch_id`, `before`/`after` = the active set in GET wire shape; a branch that lost only rows at archived stations gets no row) → `UPDATE tenants SET directory_version = directory_version + 1` → [store response on key] → `COMMIT` → respond → [prune keys]. A no-op (merged state equals stored) writes nothing and answers `200` with the stored entity (01a S26 v1.0.2 rule); the version check runs first, so a stale no-op is still `409`. **Every directory write response** (review 2 N4) carries its target with the new `version` and `changed_versions: { staff: { staff_id, version }[], roles: { role_id, version }[], responsibilities: { branch_id, version }[] }`, listing every **other** covered record whose version the write changed by cascade (a B15 move, a role archive removing the role from its holders, responsibility entries deleted with a leaver, a removed branch or an archived role); each list is `[]` when none. The client replaces the version it holds for each listed record, so its own previous action never makes its next save stale.

### Batch 1 — staff and PINs

#### 6.1 `GET /v1/admin/staff`

| | |
|---|---|
| Query | `status=active|left` (default `active`), `branch_id?` (people working at that branch). *As built, v1.1 (AD-11-sup):* a `branch_id` outside the request's tenant branch list (foreign or unknown) → `404 BRANCH_NOT_FOUND { branch_id }`, checked with `assertBranchAllowed` before any statement (README C2) |
| Who sees whom | every staff member of the tenant (one owner, who covers every branch, B8) |
| Script | read-only; **6 statements**: staff (filtered by status and, with `branch_id`, by a join on `staff_branches`; ordered `lower(display_name)`, `staff_id`), `staff_branches`, `staff_roles`, `staff_permission_denials`, `staff_leads`, `staff_floors`, the last five `WHERE tenant_id = $1 AND staff_id = ANY($2)`; each person's `version` is computed in memory (B23) |
| Size | bounded (a 3-branch restaurant; design size 500 staff [ASSUMPTION: developer sizing]), no pagination; search `q` is client-side |
| Response | `200 { data: { staff: StaffWire[] } }` |
| Errors | `404 BRANCH_NOT_FOUND` (v1.1, AD-11-sup) |

#### 6.2 `POST /v1/admin/staff` (Idempotency-Key)

| | |
|---|---|
| Input | `{ display_name: string(1–40, trimmed), role_ids: string[] (≥1), branch_ids: string[] (≥1), denied_permissions?: Permission[], reports_to?: { branch_id, lead_staff_id }[], floors?: { branch_id, floor_ids }[] }` |
| Script | directory write script. Rules: (1) every `branch_ids` entry is a branch of the tenant, else `404 BRANCH_NOT_FOUND`; (2) roles per §3.2 rule 2; (3) `reports_to` / `floors` per §3.2 rules 5–6; (4) name unique among active staff at each of `branch_ids` (B12) → `409 STAFF_NAME_TAKEN { display_name, branch_id }` (first clash by branch id); (5) insert `staff` (`pin_hash NULL`), `staff_branches`, `staff_roles`, denials, leads, floors; audit `staff` / `create`. No guard (adds only). The person is not in any directory yet (B3), but the version bump is harmless and keeps one rule |
| Response | `200 { data: { staff: StaffWire, changed_versions } }` (`StaffWire.version` is the new version; `changed_versions` lists are empty) |
| Errors | `403 PERMISSION_DENIED`, `404 BRANCH_NOT_FOUND`, `409 STAFF_NAME_TAKEN`, `422 CONFIG_REFERENCE_INVALID` |

#### 6.3 `PUT /v1/admin/staff/:staff_id/pin`

| | |
|---|---|
| Input | `{ pin: /^\d{4,6}$/ }` |
| Script | hash first, outside the transaction (argon2id, M8 parameters; the cloud's argon2 runs on the libuv pool, 1 concurrent hash per request is fine at pilot scale); then directory write script (no `expected_version`: a PIN is set, never edited from a copy): person active (else `404 STAFF_NOT_FOUND`); set `pin_hash`, `pin_set_at`; audit `staff` / `pin_set` (`before`/`after` = `{ has_pin, pin_set_at }` only). No guard (§3.4). The PIN is not part of the staff version input (B23), so the version is unchanged; the response still returns it. Not a no-op even for the same PIN (a new salt): the hub ends sessions (M50), which is what a reset means |
| Idempotency | a retry hashes again and ends sessions again; harmless, no key needed |
| Response | `200 { data: { staff: StaffWire, changed_versions } }` (review 2 N4: the full person with `pin_set_at` and the current `version`, built by `toStaffWire`; `changed_versions` empty) |
| Never logged | `pin`, `pin_hash` (request body redacted in the logger, §7.2) |
| Errors | `404 STAFF_NOT_FOUND`, `403 PERMISSION_DENIED` |

#### 6.4 `PATCH /v1/admin/staff/:staff_id`

| | |
|---|---|
| Input | `expected_version: string` (required, B23) and any of `display_name`, `role_ids`, `branch_ids`, `denied_permissions`, `reports_to`, `floors` (each whole), `is_active` |
| Script | directory write script; stale `expected_version` → `409 CONFIG_STALE { entity: 'staff', id }`; rules as §6.2 on the merged row (§3.2 rule 1); *As built, v1.1 (AD-14):* an active merged row whose roles are all archived → `field: 'role_ids'`, `reason: 'role_archived'`; B12 (name unique at each branch) re-runs when the name changes or a branch is added, as well as on `is_active: true`; stored leads and floors at a removed branch drop out of the merged row; a merged row equal to the stored one is the no-op, decided after the version compare and before any rule; `branch_ids` applied as a diff (§5.1 notes); removed branches: B15 re-parent at that branch, delete the person's leads, floors and staff responsibilities there; `is_active: false`: **if any `owner_users.staff_id` points at this row → `409 STAFF_LINKED_TO_OWNER { staff_id }`, nothing written** (review 2 N3; checked before the guards, with a clear message: "This profile is linked to the owner login and can't be marked as left."); else set `left_at`, B15 at every branch, delete staff responsibilities, audit `left` (*As built, v1.1 (AD-15):* a `reports_to` sent with `is_active: false` is ignored, because the leaver's lead rows are deleted, §3.5); `is_active: true`: clear `left_at`, re-check B12, audit `returned`; each B15 move writes `staff` / `reports_to_reassigned` for the moved person; guards (§3.4). *As built, v1.1 (AD-15):* the person gets one audit row: `left` or `returned` when `is_active` changes, else `update`, also when other fields change in the same PATCH; each `reports_to_reassigned` row carries the branch of its move |
| Response | `200 { data: { staff: StaffWire, moved_reports: { staff_id, branch_id, lead_staff_id \| null }[], changed_versions } }` (moved people's new versions are in `changed_versions.staff`) |
| Errors | `404 STAFF_NOT_FOUND`, `403 PERMISSION_DENIED`, `409 CONFIG_STALE`, `409 STAFF_LINKED_TO_OWNER`, `409 STAFF_NAME_TAKEN`, `409 OWN_ADMIN_ACCESS`, `409 LAST_ADMIN_REQUIRED`, `422 CONFIG_REFERENCE_INVALID` |
| Concurrency | the tenant row lock serialises every directory write of the tenant (B11): the guards and the name check see committed state; `expected_version` refuses an edit made from a stale copy (B23) |

### Batch 2 — roles

#### 6.5 `GET /v1/admin/roles`

`?archived=false|true` (default false); *As built, v1.1 (AD-13):* ordered by `lower(name)`, `role_id` (README C3). **4 statements**: roles, `role_permissions`, `role_permission_approvers`, one `COUNT … GROUP BY role_id` over active staff; each role's `version` computed in memory (B23). Bounded (no pagination). `200 { data: { roles: RoleWire[] } }`. (`can_edit_roles` is removed: the one owner covers every branch, B8.)

#### 6.6 `POST /v1/admin/roles` (Idempotency-Key)

| | |
|---|---|
| Input | `{ name: string(1–40), idle_minutes: int(1–240), grants: Grant[] }`; `Grant = { permission, grant_type, approver_role_ids, scope? = 'branch' }` |
| Script | directory write script (B8 check included); rules: permission in catalogue, one grant per permission, `approver_role_ids` non-empty iff `requires_approval` (*As built, v1.1 (AD-13):* these two answer `422 CONFIG_REFERENCE_INVALID` with `field` `grants.N.permission` / `grants.N.approver_role_ids` and no `reason`, README C3; repeated approver ids are dropped, C1), approvers active roles of the tenant (`reason: 'not_found'` / `'role_archived'`; may include itself, resolved after insert), scope allowed (§3.3); unique active name → `409 CONFIG_NAME_TAKEN { entity: 'role', name }`; insert role (`default_key` null), grants (with `approver_role_id` = first sorted approver, §5.1), approvers; audit `role` / `create` |
| Response | `200 { data: { role: RoleWire, changed_versions } }` (lists empty) |
| Errors | `403 PERMISSION_DENIED`, `409 CONFIG_NAME_TAKEN`, `422 CONFIG_REFERENCE_INVALID` |

#### 6.7 `PATCH /v1/admin/roles/:role_id`

| | |
|---|---|
| Input | `expected_version: string` (required, B23) and any of `name`, `idle_minutes`, `grants` (whole list, replaces), `archived: boolean` |
| Script | directory write script (B8 check included); stale `expected_version` → `409 CONFIG_STALE { entity: 'role', id }`; rules as §6.6; `default_key` is never changed by this route (a renamed default role keeps its key, B17); `archived: true` per B14: refuse with `409 CONFIG_IN_USE { entity: 'role', id, used_by: { entity: 'staff' \| 'role', ids } }` if any active staff would have no role left, or another active role lists it as approver (*As built, v1.1 (AD-18):* `staff` is checked first, so it wins when both apply; a role listed only as its own approver does not block); else delete its `staff_roles` rows and role responsibilities, set `archived_at`; `archived: false` clears it (name uniqueness re-checked); guards (§3.4); audit `role` / `update` or `archive` / `restore` with grants in `before`/`after` (E6 AC5); *As built, v1.1 (AD-18):* `archive` / `restore` when `archived` changes, else `update`; an archive also writes one `staff` / `update` row per former holder (`role_ids` with and without the role), as the directory write script's one-row-per-entity rule says |
| Response | `200 { data: { role: RoleWire, changed_versions } }` (an archive lists its former holders in `changed_versions.staff` and the branches whose responsibility set lost the role in `changed_versions.responsibilities`) |
| Errors | `404 ROLE_NOT_FOUND`, `403 PERMISSION_DENIED`, `409 CONFIG_STALE`, `409 CONFIG_NAME_TAKEN`, `409 CONFIG_IN_USE`, `409 OWN_ADMIN_ACCESS`, `409 LAST_ADMIN_REQUIRED`, `422 CONFIG_REFERENCE_INVALID` |
| Note | the inline idle edit on the Roles list (S08) sends `{ expected_version, idle_minutes }` |

### Batch 3 — branches, responsibilities, team tree

#### 6.8 `GET` / `PUT /v1/admin/branches/:branch_id/responsibilities`

| | |
|---|---|
| GET | *As built, v1.1 (AD-19):* the path branch is checked against the request's tenant branch list without a statement (`assertBranchAllowed`, `404 BRANCH_NOT_FOUND`); the PUT reads it inside the transaction. 1 statement (rows of the branch joined to its **active** stations; archived stations' rows left out); `200 { data: { responsibilities: ResponsibilityWire[], version: string } }` built by `toResponsibilitySet` (stations with nobody are absent; the page shows them from the stations list; `version` per B23) |
| PUT input | `{ expected_version: string, responsibilities: ResponsibilityWire[] }`, the whole set for the branch (≤ one entry per station; *As built, v1.1 (AD-19):* a second entry for one station → `422 CONFIG_REFERENCE_INVALID { field: 'responsibilities.N.station_id' }`, no `reason`) |
| PUT script | directory write script; branch of the tenant (`404 BRANCH_NOT_FOUND`); after the tenant lock (B11 serialises it; no row lock needed), the stored set is read with **the GET's statement** (active stations only) and compared with `expected_version` → stale → `409 CONFIG_STALE { entity: 'responsibility', id: branch_id }`; rules §3.6 (every entry names an active station of the branch); **replace only the rows of the branch's active stations** (`DELETE … WHERE tenant_id = $1 AND branch_id = $2 AND station_id IN (<active stations of the branch>)`, then insert); rows of archived stations are never read for the compare and never deleted, so restoring a station brings its rows back (§3.6) and an archived station can never make the set permanently stale (review 2 N4); one audit row `responsibility` / `update` with the active set `before`/`after`; no-op rule applies |
| PUT response | `200 { data: { responsibilities: ResponsibilityWire[], version: string, changed_versions } }` (the stored active set and its new version, built as the GET; `changed_versions` lists empty) |
| Errors | `404 BRANCH_NOT_FOUND`, `409 CONFIG_STALE`, `422 CONFIG_REFERENCE_INVALID` |

#### 6.9 `PATCH /v1/admin/branches/:branch_id`

| | |
|---|---|
| Input | `{ name: string(1–60, trimmed) }` |
| Script | **its own script** (neither 01a's common write script, which always ends with `bumpConfigVersion`, nor the directory one; review 1 m9): `BEGIN` → B8 check → `SELECT … FROM branches WHERE tenant_id = $1 AND branch_id = $2 FOR UPDATE` (`404 BRANCH_NOT_FOUND`) → no-op rule → `UPDATE branches SET name` → a unique violation on `branches_name` (`(tenant_id, lower(name))`, §5.1) → `409 CONFIG_NAME_TAKEN { entity: 'branch', name }` → audit `branch` / `update` (*As built, v1.1 (AD-22):* `before`/`after` = `{ name }`; a change of letter case only is a rename, not a no-op) → `COMMIT`. No version bump (the hub shows its provisioned name, §12.4). Two concurrent renames to one name: the index lets one commit and the other gets `409` |
| Response | `200 { data: { branch: BranchWire } }` |
| Errors | `403 PERMISSION_DENIED`, `404 BRANCH_NOT_FOUND`, `409 CONFIG_NAME_TAKEN { entity: 'branch', name }` |

#### 6.10 `GET` / `PATCH /v1/admin/branches/:branch_id/settings`

| | |
|---|---|
| GET | branch of the tenant (`404 BRANCH_NOT_FOUND`); 1 statement; `200 { data: { branch: BranchWire } }` |
| PATCH input | `{ tax_enabled?, day_stale_after_hours?: int(1–48), day_min_gap_hours?: int(0–12) }`, at least one; merged row must keep `day_stale_after_hours > day_min_gap_hours` (`400 VALIDATION_FAILED`, issue on `day_min_gap_hours`) |
| PATCH script | 01a common write script plus the B8 check: lock the branch row, update, audit `branch_settings` / `update` (`actor_kind 'owner'`), `bumpConfigVersion` for this branch (01a §6.7, S34); no-op rule applies |
| Response | `200 { data: { branch: BranchWire } }` |
| Errors | `403 PERMISSION_DENIED`, `404 BRANCH_NOT_FOUND` |

#### 6.11 `POST /v1/auth/change-password` (JWT; not idempotent by key)

| | |
|---|---|
| Input | `{ current_password: string(1–200), new_password: string(10–200) }` |
| Script | (0) Per-IP limit, as 00 §6.22 step 1 (M64) → `429 IP_LOCKED_OUT`. (1) `new_password === current_password` → `422 PASSWORD_UNCHANGED` (before any hash work). (2) Read the user (`TenantLevelRepository`, JWT `sub`), including `password_hash`. (3) Locked (`login_locked_until > now`) → dummy verify, **count the IP failure**, `401 PASSWORD_INVALID`, account counter unchanged (M73, as 00 §6.22 step 4). (4) Verify argon2id against the hash read in (2); mismatch → the login counter `UPDATE … RETURNING` (sets `lock_notice_at` with the lock, §3.7), **count the IP failure**, `401 PASSWORD_INVALID` (as 00 §6.22 step 5). (5) Match → one transaction: **(a) `SELECT credential_version FROM owner_users WHERE tenant_id = $1 AND user_id = $2 AND password_hash = $verified FOR NO KEY UPDATE`** (review 1 m11, review 2 N2); **no row** (a concurrent change or a support reset committed after (2)) → `ROLLBACK`, `401 PASSWORD_INVALID`, nothing counted (not a guess). **(b)** `UPDATE owner_users SET password_hash = $new, credential_version = credential_version + 1, must_change_password = false, temp_password_expires_at = NULL, password_changed_at = $now, <counter reset> … RETURNING credential_version` (review 2 N1). **(c)** Revoke every refresh token of the user; issue a new pair carrying the new `credential_version` (JWT claim `cv`, refresh-token row column); audit `owner_user` / `password_change` (no password fields; `before`/`after` = `{ credential_version, password_changed_at }`) |
| Response | `200 { data: { access_token, access_expires_at, refresh_token, refresh_expires_at } }` |
| Retry | a retry after success fails with `401 JWT_INVALID` (its token predates the change) or `401 PASSWORD_INVALID`; the client keeps the first response. Acceptable: the form shows "Password changed" from the first answer. A double-tap sent at once: one `200`, one `401`, and the first response's tokens stay valid (test 90) |
| Never logged | both passwords, tokens |
| Errors | `401 PASSWORD_INVALID`, `422 PASSWORD_UNCHANGED`, `429 IP_LOCKED_OUT` |

#### 6.12 `GET /v1/admin/branches/:branch_id/team-tree` (E6-TEAM AC4)

| | |
|---|---|
| Path | `branch_id` |
| Auth | owner; path `branch_id` a branch of the tenant in the JWT's `allowed_branch_ids` (as 01a's branch paths; the one owner holds every branch, B8), else `404 BRANCH_NOT_FOUND` |
| Script | read-only; **3 statements**: active staff at the branch with `has_pin` (`staff ⋈ staff_branches`), `staff_leads` of the branch, `staff_roles` of those staff (`= ANY($ids)`); the tree is built in memory |
| Response | `200 { data: { branch_id, roots: TeamNode[] } }`: `roots` = active staff at the branch with no lead there, ordered by `lower(display_name)` (*As built, v1.1 (AD-28):* a person whose `staff_leads` row names someone who is not an active member at the branch is also a root, so nobody active is hidden); each node's `members` = its direct reports, same order. People without a PIN are included (`has_pin: false`, e.g. cooks, B17). Depth is bounded because loops are refused (§3.5) |
| Size | bounded (the branch's staff), no pagination |
| Errors | `404 BRANCH_NOT_FOUND` |

### Batch 4 — owner account and CLIs

#### 6.13 `POST /v1/auth/login`, `POST /v1/auth/refresh` and the JWT guard — changes in 00 (§6.22, §6.23, §6.24a; M73 carried)

**Login (00 §6.22):** success response `user` gains `must_change_password: boolean`; `data` gains `lockout_notice: { locked_at, failed_count } | null`. Failure paths: the `UPDATE` that sets `login_locked_until` also sets `lock_notice_at = now`. **Success transaction (review 2 N1, N2):** (a) `SELECT must_change_password, temp_password_expires_at, credential_version, lock_notice_at FROM owner_users WHERE tenant_id = $1 AND user_id = $2 AND password_hash = $verified FOR NO KEY UPDATE`; no row (a change or reset committed after the verify) → `ROLLBACK`, `401 LOGIN_INVALID`, nothing counted. (b) **Expired temporary password (M3):** `must_change_password AND temp_password_expires_at <= now` on that row → `ROLLBACK`, then the failure path (account counter, per-IP failure), `401 LOGIN_INVALID`. (c) Reset the counter, read and clear `lock_notice_at`, insert the refresh token with `credential_version` from (a), sign the JWT with claim **`cv`** = that `credential_version`. Every statement of the transaction runs under the one `FOR NO KEY UPDATE` lock taken in (a), so nothing is upgraded. JWT claims: `sub, tenant_id, allowed_branch_ids, iat, exp` unchanged, plus `cv`; no `pwc`, no `iat_ms` (v0.4's D-10 is superseded).

**Refresh (00 §6.23), lock order (M2, review 2 N1, N2):** (1) look the token up by hash **without** a lock, to learn its user (missing → `401 REFRESH_TOKEN_INVALID`); (2) `SELECT must_change_password, credential_version, lock_notice_at, … FROM owner_users WHERE tenant_id = $1 AND user_id = $2 FOR NO KEY UPDATE`; (3) lock the token row `FOR UPDATE` and run 00's checks; (4) the token row's `credential_version` ≠ the owner's → `401 REFRESH_TOKEN_INVALID`, nothing revoked. The successor row and the new JWT carry the owner's current `credential_version`. Response `user.must_change_password` as login; **`lockout_notice` as login on the rotating path** (read and clear `lock_notice_at` under the same lock, m1); the 30 s grace path writes nothing and returns `lockout_notice: null`. Refresh keeps sharing login's response schema.

**Why this is closed (review 2 N1):** change-password and the reset CLI increment `credential_version` while they hold the owner row lock. A login or refresh that held the lock first issued its tokens with the old version, so once the change commits those tokens, access **and** refresh, no longer match and are refused; a login or refresh that waits for the change reads the new version, and its old refresh token (or old password, for login) is refused. No clock is compared, so the order in which each transaction read the clock, and the CLI host's clock, do not matter. **Why no deadlock (review 2 N2):** every path takes the owner row in one mode, `FOR NO KEY UPDATE`, before any token row, and never upgrades it; inserts into `owner_refresh_tokens` and `config_audit` take the FK's `KEY SHARE` on the owner row, which `NO KEY UPDATE` allows. With one owner, serialising that owner's logins and refreshes costs nothing.

**JWT guard (00 §6.24a, new):** after the signature and expiry checks, one statement by primary key reads `must_change_password, credential_version` for the JWT's `sub`. No row → `401 JWT_INVALID`. Claim `cv` (missing = 0, which covers tokens issued before the release while the column is still at its default 0) ≠ `credential_version` → `401 JWT_INVALID`. **The read fails** (connection refused, timeout, any database error) → **`503 SERVICE_UNAVAILABLE`**, never `401`, so a slow or unreachable database never signs the owner out (review 2 N9); the owner app shows its existing cloud-unreachable state (01a S53). `must_change_password` on a `/v1/admin/*` route → `403 PASSWORD_CHANGE_REQUIRED`. Every `tenantScope: 'jwt'` route goes through it, including change-password and logout. The read runs outside the route's transaction, so a request that passed the guard just before a change committed completes; that is accepted (it was authorised when it started).

#### 6.14 CLI `pnpm --filter cloud reset-owner-password --email <email>`

`SystemContext` (M56), one transaction: user by `lower(email)` (unknown → exit 1); temporary password = 4 groups of 4 Crockford base32 chars from `secrets` (80 bits, e.g. `K7QM-2XRA-9TVD-H4PE`); argon2id hash; `SELECT … FROM owner_users … FOR NO KEY UPDATE` (review 2 N2); then `must_change_password = true`, **`temp_password_expires_at = now + 86 400 000`** (24 h, M3), **`credential_version = credential_version + 1`** (every existing access token and refresh token stops working, review 2 N1; the CLI host's clock plays no part), `password_changed_at = now` (audit and display), counters and lock cleared, `lock_notice_at = NULL` (N10 deferred, §12.4); revoke every refresh token; audit `owner_user` / `password_reset` (`actor_kind 'cli'`, B21; `before`/`after` = `{ credential_version, password_changed_at, temp_password_expires_at }`). Prints the temporary password and its expiry time once to stdout; the application never logs it. Support runs the CLI only in a shell with no session logging (no SSM session logging, no `script`, no terminal recorder; runbook §7.5), and reads the password to the owner on the phone after checking it is them (confirmed by the owner, Q4). An expired temporary password is replaced by running the CLI again.

#### 6.15 CLI `seed-tenant` — default roles (B6, B17, Q13)

| Role | `default_key` | Idle | Grants (00 catalogue + 01a `manage-stock`) |
|---|---|---|---|
| Owner | `owner` | 60 min | every permission `allowed`, scope `branch` |
| Manager | `manager` | 60 min | every permission except `manage-roles`, `allowed` |
| Cashier | `cashier` | 15 min | `apply-discount` requires approval by Manager (owner, Q1); `reprint-ticket` allowed |
| Order taker | `order_taker` | 15 min (owner, Q12) | none (02 appends, separately from Waiter; D-12); takes orders; a counter role like Cashier |
| Waiter | `waiter` | 5 min | none (02 appends; owner, Q2); team-membership role, defaults only (B17) |
| Cook | `cook` | 5 min | none (03b appends; owner, Q2); team-membership role, defaults only, station sessions (B17, 00 M30) |

Each role is inserted with its `default_key` (so `is_default` is true on the wire); `seed-tenant` looks roles up by `default_key` (the Owner role for the owner's staff row, Manager as Cashier's approver), not by name (§3.8). The owner staff row gets the Owner role and a PIN, as today, and `owner_users.staff_id` is set to it (B7). `default-roles.ts` gains a `default_key` per role; a later module appending a default grant to running tenants does so in a migration that selects `WHERE default_key = '<key>'`.

#### 6.15a CLI `pnpm --filter cloud link-owner-staff --owner <owner_user_id> --staff <staff_id> --confirm-name "<display name>"` (B7; rewritten in v0.5, review 2 N3)

`SystemContext` (M56), `apps/cloud/src/cli/link-owner-staff.ts`. The same rules apply to a **first link** (`staff_id` null) and to a **corrective re-link**. One transaction, in the B11 lock order (tenant → `owner_users` → `staff`):
1. `SELECT tenant_id FROM owner_users WHERE user_id = $1` (no lock, to learn the tenant); none → exit 1 "unknown owner", nothing written.
2. `SELECT … FROM tenants WHERE tenant_id = $t FOR NO KEY UPDATE` (B11): every directory write of the tenant now waits, so the target's admin status cannot change under the CLI.
3. `SELECT … FROM owner_users WHERE tenant_id = $t AND user_id = $1 FOR NO KEY UPDATE`.
4. `SELECT … FROM staff WHERE tenant_id = $t AND staff_id = $2`; none → exit 1 "staff not in this owner's tenant". The row is active, else exit 1 "staff has left". Another owner already linked to it → exit 1 "already linked to <user_id>" (also `owner_users_staff_once`). *As built, v1.1 (AD-26):* the acting owner's own link to this row does not count here; it is step 6's no-op.
5. **Print the target**: display name, role names and the branches where it works, so support can check it with the owner.
6. Same `staff_id` already set → prints "already linked", exit 0, nothing written (no-op rule, 01a S26).
7. **`--confirm-name` must equal the target's `display_name` exactly** (byte for byte: case, spaces and punctuation; no trimming). Missing or different → exit 1 "confirm-name does not match the staff member's name (printed above)", nothing written.
8. **The tenant must have at least one branch**, else exit 1 "the tenant has no branch yet; seed-tenant links the owner" (a vacuous "every branch" would accept any row).
9. **The target must be a qualifying admin at every branch of the tenant** (B7: assigned to it, active, `pin_hash IS NOT NULL`, effective `access-hub-admin` **and** `manage-devices` both `allowed`). One statement, §3.4's qualifying-admin SQL for the target, gives `Q`; `branches(tenant) \ Q` not empty → exit 1 "link refused: <display name> is not a qualifying admin at <branch name> (<branch_id>), …", listing every such branch, nothing written.
10. `UPDATE owner_users SET staff_id = $2`; one `config_audit` row: entity `owner_user`, action `update`, `actor_kind 'cli'`, `before`/`after` = `{ staff_id }` (B21): `{ staff_id: null }` → `{ staff_id: <new> }` for a first link, `{ staff_id: <old> }` → `{ staff_id: <new> }` for a re-link. No directory bump: `owner_users` is not directory data.
11. Prints the owner's e-mail and the old and new link.

**Why a link is never an override (D-13, review 2 N3):** the linked row is a qualifying admin at every branch when it is linked; from then on the own-admin guard (B7 b) refuses any write that would make it stop being one at a branch, and the row cannot be marked as left (`409 STAFF_LINKED_TO_OWNER`, §6.4). `issue-registration-code` assigns qualifying admins to a new branch (00 §6.27), so the owner's row covers new branches too. So whichever row support links, the owner keeps a real admin at every branch, and support cannot use the CLI to leave the owner without one. What the CLI cannot check is **whose** row it is: linking another person's admin row makes that person impossible to mark as left and protects their admin access instead of the owner's. The printed summary, `--confirm-name` and the runbook identity check (§7.5) are the defence. Used by support for the `owner_not_linked` message (§8) and to correct a wrong link; never to grant or remove anyone's access.

#### 6.16 Endpoint count

- **New routes: 14** — §6.1–§6.7 (7); §6.8 `GET`, `PUT` (2); §6.9 (1); §6.10 `GET`, `PATCH` (2); §6.11 (1); §6.12 (1).
- **Changed routes in other specs: 12** — 00: `POST /v1/auth/login`, `POST /v1/auth/refresh`, hub `GET /queries/session`, hub `GET /queries/staff-roster`; 01a: `GET /v1/sync/config`, `GET /v1/admin/branches`, `SetPrecookedStock`, `AddPrecookedStock`, `SetItemAvailability`, `OpenBusinessDay`, `CloseBusinessDay`, `GET /admin/queries/stock`. They stay in their own specs' counts (00 §6.33: 30; 01a §6.24: 28); none is added.
- **Guard only, not counted (v0.4):** 00's JWT guard (§6.24a, a guard, not a route) gives every `tenantScope: 'jwt'` route `401 JWT_INVALID` for a token older than the last password change; besides that, the 19 01a owner routes of §4.4 row 1 gain `403 PASSWORD_CHANGE_REQUIRED`, and 00's `POST /v1/auth/logout` gains nothing else. 20 routes, none counted.
- **CLIs (not endpoints, as in 00 §6.33 and 01a §6.24): 4** — `reset-owner-password` (new), `link-owner-staff` (new), `seed-tenant` (changed), `issue-registration-code` (changed, §4.3 row 19).
- **Total:** this spec's own budget is its **14 new routes** (inside the README 10–25 target; unchanged in v0.4); with the 12 changed routes it touches 26, and 30 counting the four CLIs. The ~30 split threshold applies to a spec's own routes, which are 14.
- **00's split rule:** 00 §6.33 counts **30** endpoints (hub 6.1–6.4, 6.6–6.21, 6.29–6.32 = 24; cloud 6.5, 6.22–6.25, 6.28 = 6) and says "any further endpoint splits the cloud access part into its own spec". `POST /v1/auth/change-password` is **specified and counted in 01b** (here), not added to 00's §6; its code sits in the `owner-auth` folder only by folder placement (00 §7.10). 00 v1.5 adds no route and stays at 30, so its split rule is not triggered. Rows 11–12 of §4.3 change existing 00 routes, which the rule does not count.

---

## §7. Cross-cutting

### 7.1 Rate limits
None new. `change-password` reuses the account counter (M73) and the per-IP limiter of login (30 failures / 15 min; both failure paths count, §6.11) — a stolen JWT cannot brute-force the current password faster than login could.

### 7.2 Logging and redaction
Add `body.current_password`, `body.new_password` to the cloud logger's redact paths (00 §7.2 pattern; `pin` is already a redacted body field there). `pin_hash` is never selected into a response or audit row (§5.3 shapes).

### 7.3 Performance
Directory build: 5 → 8 fixed statements (`loadDirectory`: + leads, floors (active floors only), responsibilities (active stations only); approvers join into the permissions statement, and the role statement's approver subquery reads `role_permission_approvers`, m3). A PIN hash costs ~50 ms on the cloud instance; one per request. The config poll adds one `UPDATE` by primary key per hub per minute (B19). The JWT guard adds one primary-key read of `owner_users` per owner request (B5, M1): a single owner, a few requests a minute at most. B23's `version` is a SHA-256 over a row the write already builds for the no-op rule.

### 7.4 Release and rollback (B18, B19, B22, §4.3.1; rewritten in v0.4, review 1 M6, M7)
**Order.** The cloud (with `0005_staff_roles.sql`) ships first, outside service hours (01a §7.8); each hub (with `0005_directory_v2.sql` and `StaffDirectoryApplied` v2) follows, one at a time, also outside service hours. No lockstep is needed:
- **A hub still on v1.4** receives the additive v2 directory inside the same poll envelope as before. Its schemas are not `.strict()`, so it drops the new keys, parses the envelope, and applies **both** parts: config (menu, prices, availability) and directory (staff removals, PIN resets, M38 revokes) keep flowing. It applies v1 semantics (B18 a): scoped grants act branch-wide (the only enforced scope, `my_stations` on the stock page, is a v2 hub feature anyway), only the first approver is known, and no-PIN staff are absent, as they would be on v2.
- **A hub whose upgrade fails** therefore stays on v1.4 and keeps working; nothing freezes. The branches page shows it: its `hub_synced_at` keeps up with `hub_last_seen_at` (it is applying), and the hub's own config status shows its version.
- **A hub that rejects what it receives** for any reason (S43) keeps polling, gets `200` every minute and never `304`, so `hub_synced_at` stops moving while `hub_last_seen_at` keeps moving; the owner app shows both (§8).

**Rollback.** The hubs can be rolled back by restoring the pre-migration backup (00, `pre-migrate-backup.ts`). **The cloud rolls forward only once `0005` is applied (B22):** v1.4 code selects `staff.pin_hash` without a filter, and after the first person is saved without a PIN, its directory fails every hub's parse. A bad 01b cloud release is fixed by a new release. `role_permissions.approver_role_id` stays dual-written (§5.1), so the approver move is not what blocks a rollback. **Enforcement (review 2 N5):** from this release, the cloud migrations runner refuses to start when the database holds a migration this build has no file for (00 §5.2, §4.3 row 20), so any build released after 01b that is redeployed onto a newer database stops at boot with a clear error instead of running. v1.4 has no such check and cannot be changed, so the cloud release procedure (01a §7.8, §4.4 row 15) adds the step: **"Never redeploy a cloud build older than 01b once `0005_staff_roles.sql` is applied; to undo a release, deploy a newer fixed build."** The hub runner already refuses a database ahead of its files (`user_version`).

### 7.5 Support runbook (B5)
`docs/runbooks/owner-password-reset.md` (new): identity check questions; **run the CLI only in a shell with no session logging** (not through an AWS SSM session with session logging on, not inside `script`, `asciinema` or a terminal recorder; clear the scrollback afterwards), because the temporary password is printed to stdout (M3); read the password once on the phone, never send it in writing; tell the owner it expires in 24 h. It also has a section **"Owner login not linked"**: when the owner reports "Your owner login isn't linked to your staff profile", find the staff row **the owner signs in with on the hub** (ask the owner to read the name on their own sign-in tile), run `link-owner-staff` with that row and `--confirm-name` set to the exact name the CLI prints (§6.15a). The row must be a qualifying admin at every branch; if the CLI lists branches where it is not, the owner gives it admin access there in the owner app, then support runs the CLI again. **Never link another person's row:** that person could then never be marked as left, and their admin access, not the owner's, would be protected. A section **"Own admin access"** (D-13): when the owner calls about "You can't remove your own admin access" (B7), support checks it is them and explains that this is **blocked by design**: with one owner per restaurant (B8), the owner's own staff row is the only admin that is guaranteed to exist, so removing it could leave every branch without anyone who can pair or revoke devices. If the owner wants someone else to run the hub, the owner gives that person admin access (a role with `access-hub-admin` and `manage-devices`) in the owner app; the owner's own access stays. **Support has no override:** no CLI or SQL removes the owner's admin access, and support never edits staff or roles for the owner. A section **"Correcting a wrong owner link"**: if support linked the owner's login to the wrong staff row, `link-owner-staff` re-links it under the same rules as a first link: the owner's real row, the exact `--confirm-name`, and a target that is a qualifying admin (active, with a PIN, `access-hub-admin` and `manage-devices`) at **every branch of the restaurant**. This is not an override: the linked row is a qualifying admin at every branch before and after, so the own-admin guard still holds everywhere; the re-link is audited with the old and new `staff_id`. If the CLI refuses, it lists the branches where the right row does not qualify; support tells the owner to give that row admin access there in the owner app, then runs the CLI again. The owner app shows no support number unless `VITE_SUPPORT_PHONE` is set at build time (§8, owner answer Q3).

### 7.6 Folder placement (F §6.9)
Cloud `apps/cloud/src/modules/staff-roles/` (routes, service, repository, schemas, team tree; existing folder), `owner-auth/` (change password, login and refresh changes), `plugins/tenant-scope.ts` (JWT guard owner-row read, 00 §6.24a), `cli/reset-owner-password.ts`, `cli/link-owner-staff.ts`, `cli/issue-registration-code.ts` (changed). Shared `packages/events/src/admin/staff.ts`, `packages/events/src/directory.ts` (v2), `packages/domain/src/permissions.ts` (catalogue, scopes). Hub `auth/apply-directory.ts`, `auth/staff-directory.ts`, `db/migrations/0005_directory_v2.sql`. Client `apps/client/src/features/owner/{staff,roles,teams,branches,account}/`.

---

## §8. Client contract (owner app, entry `owner`, 01a S35 rules)

| View | Screen IDs (design) | Calls |
|---|---|---|
| `#/staff` | 01b-S01, B02 | §6.1; branch filter, Working here / Left, client search |
| `#/staff/new`, `#/staff/:id` | S02, C02, D02 | §6.2, §6.4; C02 computed client-side with the §3.3 rule from §6.5's roles (no endpoint); "Floors they work on" shown only when one of the person's roles has a `my_floors` grant; **Reports to** select per branch (new, not in the frames, B1) |
| PIN dialog / phone hand-over | D01 | §6.3; two masked fields (laptop) or the kit PIN pad twice (phone); the PIN lives only in component state and is cleared after the request |
| `#/roles`, `#/roles/:id` | S03, S04, S08, C01, D03 | §6.5–§6.7 (no read-only variant: one owner, B8); **Approved by** is a multi-select of role chips; **Where** select from `PERMISSION_SCOPES`, with "My team" (Q19) |
| `#/teams` (new, not in the frames) | — | §6.12; branch picker (01a S52), an indented list of leads and their members (name, role names, "No PIN" chip when `has_pin` is false); each name opens `#/staff/:id`; read-only (lines are edited on the person) |
| `#/stock-counting` | S05 | §6.8 + 01a stations list |
| `#/branches`, `#/branches/:id/settings` | S06, S07 | 01a §6.7b (with `hub_last_seen_at` and `hub_synced_at`), §6.9, §6.10. Each branch shows "Hub checked in {time} ago" and "Up to date {time} ago" (B19); the second is shown as a warning when `hub_last_seen_at − hub_synced_at > hub_stale_after_ms`, where **`hub_stale_after_ms = 3 × CONFIG_POLL_INTERVAL_MS`** (180 000 ms today) comes in the `GET /v1/admin/branches` response; the page hardcodes no threshold (D-11). *As built, v1.1 (AD-32):* when `now − hub_last_seen_at > hub_stale_after_ms` the branch also shows "{branch} hub last checked {time}" above the "Up to date" line, which keeps its own warning |
| Edit forms (staff, role, stock counting) | S02, S04, S05 | keep the `version` of the loaded entity and send it as `expected_version`; after every write, replace the held version with the one in the response, and with each entry of `changed_versions` (review 2 N4), so the owner's own PIN reset or a cascade never makes the next save stale; on `409 CONFIG_STALE` show "Someone changed this since you opened it" with **Reload**, keeping nothing of the stale form (B23) |
| `#/account/password` | S09 | §6.11; forced view while `must_change_password` (every other view redirects); *As built, v1.1 (AD-27):* on `200` the client stores the returned token pair and sets the stored user's `must_change_password` to false (every older token stops working, review 2 N1); caption "Forgot your password? Call support." and, only when the optional build value `VITE_SUPPORT_PHONE` is set (§8 note), "Forgot your password? Call support on {phone}." (owner answer Q3) |
| Lockout banner | B01 | from §6.13 `lockout_notice`; "{n} times" uses `failed_count` (design Q14) |
| Shell (side menu) | design README §9 | *As built, v1.1 (AD-31):* the side menu shows counts next to Staff, Roles and Branches, taken from the lists the views already load (Branches: the allowed branches; no extra request); the foot shows the signed-in `display_name`, since the login response carries no e-mail. Phone: 01a v1.3.1 S50 a |

**Support number (owner answer Q3):** an optional build-time value `VITE_SUPPORT_PHONE` (Vite's built-in `import.meta.env`, no new dependency, set when the cloud build runs, 01a §7.8). Unset or empty → every support text ends with "Call support." and shows no number; set → the number is appended (" on {phone}"). No route serves it; changing it means a rebuild.

Error mapping: `STAFF_NAME_TAKEN` → name field; `STAFF_LINKED_TO_OWNER` → the Left switch: "This profile is linked to the owner login and can't be marked as left."; `SERVICE_UNAVAILABLE` from any owner route → the existing cloud-unreachable state (01a S53), never the sign-in page; `OWN_ADMIN_ACCESS` → roles field: "You can't remove your own admin access. Call support." (with " on {phone}" before the full stop only when `VITE_SUPPORT_PHONE` is set; owner answer Q3); `CONFIG_STALE` → the reload message above; `JWT_INVALID` after a refresh that also fails → sign-in page; with `reason: 'owner_not_linked'`: "Your owner login isn't linked to your staff profile yet, so admin access can't be removed. Call support to link it."; `LAST_ADMIN_REQUIRED` → roles field or blocked dialog naming the branches; `CONFIG_IN_USE` (role) → D03 blocked variant; `PASSWORD_INVALID` / `PASSWORD_UNCHANGED` → field errors; `PASSWORD_CHANGE_REQUIRED` → redirect to S09. Strings in English and Urdu (`staff.*`, `roles.*`, `teams.*`, `perm.<key>`, `errors.<CODE>`); missing Urdu goes to `docs/design/handoff/01b/urdu-todo.md`. Copy fixes from R21: the role editor's approval help text says "The request goes to people with these roles. They approve on their own device with their PIN."; the lockout banner shows `{n}` (10).

Hub pages: the stock page lists only the person's stations' rows under `my_stations` and hides the day actions (B20, §4.4 rows 11, 13). *As built, v1.1 (AD-33):* under `my_stations` with no day open, a warning banner "The day hasn't been started. Ask someone who can start the day." sits above the rows (no Start day); the rows and the Selling switch stay usable (01a §6.18 needs no open day); a count save or Add answered `409 BUSINESS_DAY_NOT_OPEN` shows the same sentence as a banner and keeps the counts; with a day open a note explains the page shows the person's stations; `403 PERMISSION_DENIED { reason: 'outside_scope' }` shows "You can only change items for your stations." and refreshes the query. Not shown: names of starters or stations (the stock query carries none); the staff roster shows `responsibilities` so the stock sign-in can show "Counts stock" (01a Q11).

---

## §9. Error catalogue additions

Appended to F §6.2 and `@pos/domain/src/errors.ts` in the build change (CLAUDE.md engineering rules).

| Code | Status | `details` | Returned when |
|---|---|---|---|
| `ROLE_NOT_FOUND` | 404 | `{ role_id }` | PATCH on an unknown or foreign role |
| `STAFF_NAME_TAKEN` | 409 | `{ display_name, branch_id }` | Another active staff member at that branch has the name (B12) |
| `LAST_ADMIN_REQUIRED` | 409 | `{ branch_ids }` | The write leaves a branch that had a qualifying admin (`access-hub-admin` and `manage-devices` both `allowed`, B7) with none (B7 a) |
| `OWN_ADMIN_ACCESS` | 409 | `{ branch_ids, reason?: 'owner_not_linked' }` | The write makes the acting owner's own staff row stop being a qualifying admin at those branches (B7 b); with `reason: 'owner_not_linked'`, the owner has no linked staff row and the write does so to anyone (fail safe); fixed by the `link-owner-staff` CLI (§6.15a, runbook §7.5) |
| `STAFF_LINKED_TO_OWNER` | 409 | `{ staff_id }` | `PATCH /v1/admin/staff/:id` with `is_active: false` on a row an `owner_users.staff_id` points at (review 2 N3) |
| `CONFIG_STALE` | 409 | `{ entity: 'staff' \| 'role' \| 'responsibility', id }` | `expected_version` differs from the stored entity's `version` (B23): the client edited a stale copy; nothing written |
| `PASSWORD_INVALID` | 401 | `{}` | Wrong current password, or the account is locked (M73) |
| `PASSWORD_UNCHANGED` | 422 | `{}` | New password equals the current one |
| `PASSWORD_CHANGE_REQUIRED` | 403 | `{}` | `must_change_password` is set (read from `owner_users` by the JWT guard, 00 §6.24a) and the route is a `/v1/admin/*` route |

Reused: `STAFF_NOT_FOUND` (00), `BRANCH_NOT_FOUND`, `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `CONFIG_REFERENCE_INVALID` (01a), `PERMISSION_DENIED`.

`CONFIG_REFERENCE_INVALID` `reason` values used by 01b: `archived` (01a's), and new `not_found` (§3.2 rule 2, §6.6), `role_archived` (§3.2 rule 2, §3.6, §6.6), `wrong_branch` (§3.2 rules 5–6, §3.6), `not_at_branch` (§3.2 rule 5, §3.5, §3.6), `loop` (§3.5), `one_lead_per_branch` (§3.2 rule 5), `scope_not_allowed` (§3.3). `PERMISSION_DENIED` `reason` gains `outside_scope` (§4.4 row 9) and reuses 01a's `tenant_wide_write` for every 01b write (B8); v0.3's `staff_outside_branches` is removed (single owner, review 1 M8). `LOGIN_INVALID`, `REFRESH_TOKEN_INVALID` and `JWT_INVALID` (00) gain the conditions of §6.13; `SERVICE_UNAVAILABLE` (503, existing) is reused for a failed JWT guard read (review 2 N9). `PASSWORD_TOO_SHORT` is not a code: a short password is `400 VALIDATION_FAILED` on `new_password`.

---

## §10. Tests

Numbering: 01b #1–#5 are reserved by 01a §12.5 for the carried items; the rest follow. Cloud tests in `apps/cloud/test/staff-roles/*.int.test.ts` and `apps/cloud/test/owner-auth/*.int.test.ts`; hub tests in `apps/hub/test/auth/*.int.test.ts`; names cite `[01b #N]`.

### 10.1 Carried (reserved numbers)
1. Role create, edit and archive from the catalogue; archiving or editing the last role that gives a branch its admin → `409 LAST_ADMIN_REQUIRED`, nothing written (01a §12.5, E6 AC7, M57).
2. Staff create and edit with branch assignment bump `tenants.directory_version` by exactly 1 per write; a no-op PATCH bumps nothing (M51, carried "01"; R3).
3. PIN set produces a hash with M8 parameters that 00's `applyStaffDirectory` accepts (not skipped under M52), and a PIN reset ends that person's sessions on the next apply (M50).
4. After 10 wrong passwords lock the account, the next successful login returns `lockout_notice { locked_at, failed_count: 10 }`; the login after that returns `null` (M73, carried "01 / 07").
5. Every role create, edit, archive, grant change and role assignment writes exactly one `config_audit` row per changed entity in the same transaction, with actor, before and after; a rolled-back write leaves none (E6 AC5).

### 10.2 Staff and PINs
6. Create without a PIN: `has_pin false`; not in `loadDirectory` for its branches (B3).
7. Name taken by an active person at a shared branch → `409 STAFF_NAME_TAKEN { branch_id }`; the same name at another branch only → `200`; a person who left does not block.
8. The owner edits a person who works at two branches → `200`; `GET /v1/admin/staff?branch_id=B` lists only people working at B; an `owner_users` row hand-edited to miss one branch → every 01b write `403 tenant_wide_write`, reads `200` (B8 single owner; R3).
9. Mark as left: `left_at` set, out of the directory, audit `left`; on the hub the person's sessions end `staff_removed` and their phone is revoked `owner_removed` (00 M38, end to end through the poll).
10. Bring back: `left_at` cleared, PIN kept, back in the directory with the same hash (no `credentials_changed`).
11. Two concurrent PATCHes each removing one of the last two qualifying admins at one branch (neither the acting owner's own row): one `200`, one `409 LAST_ADMIN_REQUIRED` (B11 serialisation).

### 10.3 Roles, grants, scopes
12. `resolve`: A allows with `my_floors`, B requires approval with `branch` → `allowed`, scope `my_floors`; A and B both allow, `my_floors` and `branch` → `branch`; denial wins over both (§3.3).
13. Approver union across roles is sorted and deduplicated; an `allowed` grant with approvers → `422`.
14. Scope not in the permission's row → `422 scope_not_allowed`.
15. Role name unique among active roles, case-insensitive → `409 CONFIG_NAME_TAKEN { entity: 'role' }`; an archived role's name is free.
16. Archive a role that a person holds with another role: removed from them, `200`; held as the only role by an active person → `409 CONFIG_IN_USE { used_by: { entity: 'staff' } }`; listed as approver elsewhere → `409 CONFIG_IN_USE { used_by: { entity: 'role' } }`.
17. With an `owner_users` row hand-edited to miss one branch: `POST /roles` and `PATCH /roles/:id` → `403 tenant_wide_write`, nothing written; `GET /roles` → `200` with no `can_edit_roles` field (B8 single owner).
18. `idle_minutes` 0 or 241 → `400`; a person with Waiter (5) and Manager (60) gets `ttlFor` 3 600 000 on the hub (M11).
19. Hub `GET /queries/session` returns `scope` and `approver_role_ids` per permission.
20. `seed-tenant` creates six roles, Owner 60, Manager 60, Cashier 15, Order taker 15, Waiter 5, Cook 5, with the §6.15 grants (Order taker, Waiter and Cook: none) and `default_key`s `owner`, `manager`, `cashier`, `order_taker`, `waiter`, `cook`; Order taker and Waiter are distinct `role_id`s; a staff member given both roles signs in once and `resolve` returns the union (no mode) (all `is_default` on the wire), and links `owner_users.staff_id`; renaming "Waiter" to "Bera" keeps `default_key 'waiter'` (B6, B7, B17).

### 10.4 Directory contract (00 v1.5)
21. `loadDirectory` returns the §4.3.1 shape in 8 statements, whatever the staff count (query-count assertion).
22. Hub apply of a directory with `approver_role_ids` and `scope` round-trips through `StaffDirectory.load` after restart (migration `0005` rebuild keeps existing rows).
23. A `lead_staff_id` or responsibility naming someone absent is skipped and listed in `StaffDirectoryApplied.skipped` (`kind 'lead'` / `'responsibility'`); the rest applies.
24. **Rewritten in v0.4 (M6):** a hub on v1.4 code (the v1.4 `SyncConfigEnvelopeSchema` and `DirectorySchema`, kept as a test fixture) receives a `200` poll whose directory is the v2 shape and whose config part is a new snapshot: the envelope parses, **both** parts apply (`applied`, no `rejected`), a person marked as left is removed with their sessions ended (M38), and a `requires_approval` grant resolves with the first approver (`approver_role_id`); a scoped grant resolves as allowed branch-wide (§7.4).
25. PIN body never appears in logs (redaction test over the request logger).

### 10.5 Teams
26. Lead must work at that branch → `422 not_at_branch`.
27. A → B → A at a branch → `422 loop`; a chain of 5 is accepted.
28. Leaver with 2 reports and a lead: reports move to the leaver's lead; `moved_reports` lists them; one `staff` / `reports_to_reassigned` audit row each (B15).
29. Leaver with no lead: reports end with no lead.
30. Removing a person from a branch moves their reports there and deletes their floors and lead there (R3).
31. Hub `leadOf` / `teamOf` return the branch's line; a reporting line changes no `resolve` result (R5).

### 10.6 Responsibilities and the stock page
32. PUT replaces the branch's set; a station of another branch → `422 wrong_branch`; GET returns it.
33. A role listed on a station gives every holder at that branch the station (`stationsOf`).
34. Hub: `manage-stock` with `my_stations` lists only those stations' items in `GET /admin/queries/stock`; `SetPrecookedStock`, `AddPrecookedStock` and `SetItemAvailability` with an outside item → `403 outside_scope`, nothing appended; scope `branch` unchanged (01a tests stay green).
35. An archived station's responsibilities are left out of `loadDirectory` and the GET; restoring the station brings them back (§3.6).
36. Staff roster query lists `responsibilities: ['count_stock']` for a counter.

### 10.7 Owner password
37. Change password happy path: new pair returned, every old refresh token revoked, audit row without password fields.
38. Wrong current → `401 PASSWORD_INVALID`, account counter +1 and per-IP failure counted; the 10th sets the lock and `lock_notice_at`.
39. Locked account → `401 PASSWORD_INVALID` even with the right password, account counter unchanged, per-IP failure counted (M73).
40. New = current → `422 PASSWORD_UNCHANGED`; 9 characters → `400 VALIDATION_FAILED` on `new_password`.
41. `reset-owner-password`: prints a 19-character temporary password and its expiry once, sets `must_change_password` and `temp_password_expires_at = now + 24 h`, revokes tokens; login with it → `200` with `user.must_change_password true` and a JWT with no `pwc` claim; `GET /v1/admin/staff` → `403 PASSWORD_CHANGE_REQUIRED`; change password clears both fields; the same token then gets `401 JWT_INVALID` (it predates the change) and the change's returned token gets `200`.
42. Refresh while `must_change_password` is set → `200` with `user.must_change_password true`; `/v1/admin/*` with the new access token still `403 PASSWORD_CHANGE_REQUIRED` (read from the row, not the token).
43. Concurrent change-password and login with the old password: the login after commit fails (hash read in its own statement).
44. `body.current_password` and `body.new_password` redacted in logs.

### 10.8 Branches
45. Settings PATCH writes `branch_settings` audit with `actor_kind 'owner'` and bumps that branch's `config_version` only.
46. `day_stale_after_hours` 49 or `day_min_gap_hours` 13 → `400`; a merged row with stale ≤ gap → `400 VALIDATION_FAILED` on `day_min_gap_hours`; a new branch starts with tax off (Q15).
47. Rename: unique among the tenant's branches; no version bump; `GET /v1/admin/branches` shows the new name and `hub_last_seen_at`.
48. `PATCH /v1/admin/branches/:b` and `…/settings` with a branch of another tenant or an unknown id → `404 BRANCH_NOT_FOUND`, nothing written (B8 single owner; cross-tenant per D54).

### 10.9 Pages (pipeline step 9, Playwright, 1440×900 and 390×844, English and Urdu)
49. Flow 1 new waiter (S01 → S02 → D01 → B02). 50. Flow 2 rush PIN reset on a phone ≤ 8 taps + digits. 51. Flow 3 leaver: hub device list shows the phone Removed. 52. Flow 4 new role "Shift lead" assigned to Imran. 53. Flow 5 last-admin guard dialog. 54. Forced change password after reset.

### 10.9a Extra
55. **Exact scope (v0.4, m12):** the test lists every file matching `apps/*/src/**/*.{ts,tsx,sql}` and `packages/*/src/**/*.{ts,tsx}`, excluding `**/*.test.ts`, `**/*.test.tsx` and anything under `apps/*/test/`, and greps each for the quoted literals `'Owner'`, `'Manager'`, `'Cashier'`, `'Order taker'`, `'Waiter'`, `'Cook'` (single or double quotes, case-sensitive). Allowed by name, and only these: `apps/cloud/src/modules/staff-roles/default-roles.ts`, `apps/cloud/src/db/migrations/0003_manage_stock_backfill.sql` (merged before R5, §3.8), `apps/cloud/src/db/migrations/0005_staff_roles.sql` (the `default_key` backfill). Any other hit fails the test with the file and line (R5). `cli/seed-tenant.ts` is not allowed: it looks up by `default_key`.
56. `POST /v1/admin/staff` replayed with the same `Idempotency-Key` returns the same body with `Idempotent-Replay: true` and creates one person (01a S7).

### 10.10 Added in v0.2
57. `reports_to` with two entries for one branch → `422 CONFIG_REFERENCE_INVALID { reason: 'one_lead_per_branch' }`, nothing written (E6-TEAM AC1).
58. PIN set and PIN reset each write exactly one `config_audit` row `staff` / `pin_set` with `before`/`after` = `{ has_pin, pin_set_at }`; no row contains `pin` or `pin_hash` (01a S42 carried row).
59. `GET /v1/admin/branches/:b/settings` returns the branch's `tax_enabled` and day settings in 1 statement; a branch outside the owner's list → `404 BRANCH_NOT_FOUND`.
60. `POST /v1/admin/roles` replayed with the same `Idempotency-Key` and body → same body, `Idempotent-Replay: true`, one role, one audit row; same key with another body → `422 IDEMPOTENCY_KEY_MISMATCH` (01a S7).
61. Team tree (`GET /v1/admin/branches/:b/team-tree`): Hamza leads Bilal and Usman (Cook, no PIN), Bilal leads Ali → `roots` lists Hamza (and anyone with no lead) with the nested members, `has_pin false` on Usman; a leaver is absent; 3 statements whatever the staff count; branch outside the owner's list → `404` (E6-TEAM AC4).
62. Cook (B17): a staff member with only the Cook role and no PIN can be saved with `reports_to` a lead (`200`) and appears in the team tree; on the hub they are absent from `GET /queries/staff-roster`, and `POST /auth/pin` with their `staff_id` → `404 STAFF_NOT_FOUND`, not counted as a PIN failure (00 §3.5 step 4).
63. Own admin role (B7 b): the owner removes the Owner role from their own linked staff row while another qualifying admin exists → `409 OWN_ADMIN_ACCESS { branch_ids }`, nothing written; the same edit on another person → `200`; a role PATCH removing `access-hub-admin` (or `manage-devices`) from the only role that gives it to the owner's row → `409 OWN_ADMIN_ACCESS`; marking themselves as left → `409 STAFF_LINKED_TO_OWNER { staff_id }`, nothing written (*As built, v1.1 (AD-20):* J-6, §6.4 and #101; v1.0.1 said `OWN_ADMIN_ACCESS`); the client's `errors.OWN_ADMIN_ACCESS` string is "You can't remove your own admin access. Call support…" in English and Urdu (E6 edge case; single owner, so no "another owner").
64. `StaffDirectoryApplied` v1 → v2 upcaster: a stored v1 payload upcasts to an equal v2 payload (fixture test, F D46, B18).
65. `PASSWORD_CHANGE_REQUIRED`: with `must_change_password` set on the row, every route in the route inventory under `/v1/admin/*` (01a's 19 and 01b's 13) answers `403`, including with an access token issued **after** the reset (the guard reads the row); `change-password`, `refresh` and `logout` answer normally.
66. Migration `0005` on a branch row with `day_stale_after_hours 72`, `day_min_gap_hours 24` reads 48 and 12 afterwards, `branches_day_settings` still holds; `set-branch-settings --day-stale-after-hours 49` exits 1, nothing written (B16).
67. `GET /v1/sync/config` sets `hub_last_seen_at` on both `304` and `200`, and `hub_synced_at` on `304` only; a hub that keeps reporting an old `config_version` (it rejects what it gets) moves `hub_last_seen_at` every poll and leaves `hub_synced_at` unchanged; `GET /v1/admin/branches` returns both; query counts 2 and ≤ 17 (B19, M6).

### 10.10a Added in v0.3
68. Day open and close (D-6): a session whose `manage-stock` scope is `my_stations` sends `OpenBusinessDay` and `CloseBusinessDay` → `403 PERMISSION_DENIED { permission: 'manage-stock', reason: 'outside_scope', required_scope: 'branch' }`, no event appended; the same commands with scope `branch` behave as 01a's tests (unchanged).
69. Own-admin fail safe (B7): an owner with `owner_users.staff_id` null removes the Manager role from another qualifying admin → `409 OWN_ADMIN_ACCESS { reason: 'owner_not_linked' }`, nothing written; a write that changes no one's `access-hub-admin` (a rename, a floor change) → `200`; after `seed-tenant` the link is set and the normal guard applies.
70. Migration `0005` on a database seeded by the v1.4 `seed-tenant` plus rows at the old limits (`day_stale_after_hours 72`, `day_min_gap_hours 24`, a 40-character name, idle 3 600 000): it commits, and afterwards a query per new CHECK and index (`staff_left`, `staff_name_len`, `roles_idle`, `roles_name_len`, `branches_name_len`, `branches_name`, `branches_day_stale`, `branches_day_gap`, `branches_day_settings`, `owner_users_temp_password`, `roles_default_key`, and the kept `role_permissions_check`) finds no violating row (B22).
71. `GET /admin/queries/stock` returns `manage_stock_scope` (`branch` or `my_stations`) for the session; the page hides **Start day**, **Close day** and the stale-day prompt for `my_stations` (page part, cited `[01b #71 page part]`).
72. **`link-owner-staff` first link (§6.15a, review 2 N3).** Owner with `staff_id` null, tenant with branches A and B. Link to the owner's row Y (a qualifying admin at A and B) with `--confirm-name` equal to Y's name → exit 0, `owner_users.staff_id = Y`, one `config_audit` row `owner_user` / `update`, `actor_kind 'cli'`, `before { staff_id: null }`, `after { staff_id: Y }`; test 69's write then gets the normal own-admin guard. **First link to a non-admin** (a Cook with no PIN; a cashier with a PIN but no `access-hub-admin`) → exit 1, link unchanged, no audit row. Unknown owner, a staff id of another tenant, a staff member who left, a row linked to another owner, a tenant with no branch → exit 1, nothing written. The same link again → exit 0, no audit row.

### 10.10b Added in v0.4 (hostile review 1)
73. **JWT guard (M1).** An access token issued before `reset-owner-password` → `401 JWT_INVALID` on `GET /v1/admin/staff`, `PATCH /v1/admin/staff/:id` and `POST /v1/auth/logout`; an access token issued before a change-password on another device → `401 JWT_INVALID`; the token returned by that change → `200`; a token whose `sub` has no `owner_users` row → `401 JWT_INVALID`. The guard adds exactly one statement to a request (query-count assertion on `GET /v1/admin/branches`: 1 route statement + 1 guard statement).
74. **Refresh and login racing a change or reset (M2, review 2 N1).** With a test barrier: (a) a rotating refresh holds the owner row (`FOR NO KEY UPDATE`) and has issued its successor and access token while change-password waits; after both commit, **the access token the refresh issued → `401 JWT_INVALID`** on `GET /v1/admin/staff`, and its successor refresh token → `401 REFRESH_TOKEN_INVALID`; (b) change-password holds the owner row while a refresh waits: the refresh → `401 REFRESH_TOKEN_INVALID`, no token issued; (c) (a) and (b) with `reset-owner-password` instead of change-password, also with the CLI's clock set 5 minutes ahead and 5 minutes behind the API's (no effect: no clock is compared); (d) a login that verified the old password and holds the owner row while a reset waits: after both commit, **its access token → `401 JWT_INVALID`** and its refresh token → `401 REFRESH_TOKEN_INVALID`; a login that verified the old password and waits behind the reset → `401 LOGIN_INVALID`, no refresh token inserted, account counter unchanged; (e) no deadlock in 50 interleaved runs of refresh against change-password.
75. **Temporary password expiry (M3).** Login with the temporary password at `+24 h − 1 ms` → `200`; at `+24 h` → `401 LOGIN_INVALID`, account counter +1 and per-IP failure counted; the CHECK `owner_users_temp_password` refuses `temp_password_expires_at` without `must_change_password`; a successful change sets `temp_password_expires_at` to null.
76. **Qualifying admin (M4).** (a) Branch A has the owner's linked row and a stock counter (`access-hub-admin` + `manage-stock` only): a role PATCH removing `manage-devices` from the Owner role → `409 OWN_ADMIN_ACCESS { branch_ids: [A] }`. (b) The same with `owner_users.staff_id` null → `409 OWN_ADMIN_ACCESS { reason: 'owner_not_linked' }`. (c) Branch C, where the owner's row does not work, has one manager and the stock counter: denying `manage-devices` to the manager → `409 LAST_ADMIN_REQUIRED { branch_ids: [C] }`, although the stock counter still holds `access-hub-admin`. (d) Adding a second manager at C first, then the same denial → `200`.
77. **`default_key` (M5).** Migration `0005` on a tenant seeded by the v1.4 `seed-tenant`: Owner, Manager, Cashier, Order taker get `owner`, `manager`, `cashier`, `order_taker`; no Waiter or Cook role is created; a tenant with two roles named "Manager" keys the smaller `role_id` only; no grant changes (row-by-row comparison of `role_permissions` before and after, ignoring the new `scope` column). A second role with the same `default_key` in one tenant → unique violation.
78. **B19 on the owner page (M6, page part).** `#/branches` shows "Hub checked in" and "Up to date"; with a response `hub_stale_after_ms` of 180 000, a gap of 180 001 ms shows the warning and 180 000 ms does not; with a fixture `hub_stale_after_ms` of 60 000, a gap of 90 000 ms warns (the page uses the response value, not a constant) (page test, both languages).
79. **Dual-written approver (M7).** A role created with `approver_role_ids [B, A]` stores `approver_role_id = A` (the first sorted); updated to `[C]` → `C`; changed to `allowed` → null; v1.4's `loadDirectory` SQL (kept as a fixture) run over these rows returns a directory the v1.4 `DirectorySchema` parses, with each `requires_approval` grant's single approver present (rollback of the approver move is safe; the `pin_hash` one is not, §7.4).
80. **Stale writes (M9).** Two tabs load the Cashier role; tab 1 removes `apply-refund` (`200`); tab 2 saves its whole grant list with its old `expected_version` → `409 CONFIG_STALE { entity: 'role', id }`, `apply-refund` still absent, no audit row. Same for a staff PATCH of `denied_permissions` and a responsibilities PUT. A person moved by B15 (another person left) has a new `version`, so a form opened before the move → `409`. A stale no-op body → `409`, not `200`.
81. **Lockout notice on refresh (m1).** After a lock, the owner's next rotating refresh returns `lockout_notice { locked_at, failed_count: 10 }` and clears it; the following refresh and the next login return `null`; a grace-window refresh (M49) returns `null` and clears nothing.
82. **Returning with no role (m2).** A person who left held only "Shift lead"; the role is archived (`200`, no active holder); `PATCH { expected_version, is_active: true }` → `422 CONFIG_REFERENCE_INVALID { field: 'role_ids', reason: 'role_archived' }`, nothing written; the same PATCH with `role_ids: [cashier]` → `200`.
83. **Approver roles in the directory (m3).** Branch B has cashiers and no manager; `loadDirectory(B)` includes the Manager role (named only as the Cashier grant's approver); on the hub, a cashier's `apply-discount` resolves `requires_approval` with `approver_role_ids [manager]`, not skipped.
84. **Approver skips on the hub (m4).** A grant with approvers `[known, unknown]` keeps `[known]` and lists `{ kind: 'approver' }` for the unknown one; a grant whose approvers are all unknown, or an empty list, is skipped with `{ kind: 'approver' }`; the rest of the directory applies.
85. **Lock modes (m5).** A directory write holding `tenants … FOR NO KEY UPDATE` (barrier) and a concurrent `POST /v1/admin/menu-items`: the menu create commits without waiting (asserted via `pg_locks` / a 1 s timeout); two directory writes still serialise (test 11).
86. **`issue-registration-code` (m6).** A new branch gets an active manager; not a manager who has left, not one with a denial of `access-hub-admin` or of `manage-devices`; `tenants.directory_version` +1; the CLI waits on a directory write holding the tenant lock; `--branch-name` equal to an existing branch name (other case) → exit 1, nothing written.
87. **`branch_ids` diff (m7).** A person at A and B with a lead and floors at A; `PATCH { branch_ids: [A] }` keeps the lead and floors at A, removes those at B, and leaves the `staff_branches` row for A untouched (same `ctid` before and after).
88. **Rename (m9).** Two concurrent renames of branches A and B to "Gulberg": one `200`, one `409 CONFIG_NAME_TAKEN { entity: 'branch' }`; a rename bumps neither `config_version` nor `directory_version` and writes one `branch` / `update` audit row; "gulberg" after "Gulberg" → `409`.
89. **Migration aborts loudly (m10).** `0005` on a database with a 41-character staff name, a 41-character role name, a 61-character branch name, two branches named "A" and "a" in one tenant, or a role idle of 90 000 ms: each case fails with the constraint's name, and nothing of `0005` is applied (`schema_migrations` unchanged, no new column).
90. **Concurrent change-password (m11).** Two identical change-password requests released together: one `200`, one `401 PASSWORD_INVALID`; the `200`'s tokens work; the stored hash verifies the new password; one audit row. A change-password that verified before a `reset-owner-password` committed → `401 PASSWORD_INVALID`, `must_change_password` stays true and the temporary password still works.

### 10.10c Added for decisions D-10 to D-14 (still v0.4)
91. **Credential version (review 2 N1, replaces v0.4's millisecond test).** A new owner has `credential_version 0`; login → JWT `cv: 0`, refresh-token row `0`. Change-password → `credential_version 1`; the returned pair has `cv: 1` and works; any token with `cv: 0` → `401 JWT_INVALID`, any refresh token with `0` → `401 REFRESH_TOKEN_INVALID`. A JWT with no `cv` claim (issued before the release) → `200` while the version is 0, `401 JWT_INVALID` after the first change. Reset → `2`. Two changes in the same millisecond still give two different versions.
92. **Threshold from the poll interval (D-11).** `GET /v1/admin/branches` returns `hub_stale_after_ms === 3 * CONFIG_POLL_INTERVAL_MS` (the test imports the constant from `@pos/events`); the hub poller schedules polls with `CONFIG_POLL_INTERVAL_MS` (fake timers: a poll at `t` and the next at `t + CONFIG_POLL_INTERVAL_MS`), and `apps/hub/src/sync/config-poller.ts` no longer declares its own interval constant (source check).
93. **New branch gets qualifying admins only (D-14a).** Tenant with the owner (Owner role), a manager (Manager role), a stock counter (`access-hub-admin` + `manage-stock`), a manager with a denial of `manage-devices`, a manager with no PIN and a manager who has left: `issue-registration-code --branch-name C` assigns the owner and the first manager only; `GET /v1/admin/staff?branch_id=C` lists those two.
94. **Duplicate names refused (D-14b).** Two qualifying admins named "Ali" and "ali " at other branches: `issue-registration-code --branch-name C` exits 1 and prints `Ali` with both `staff_id`s; no branch row, no registration code, no `staff_branches` row, `directory_version` unchanged, no name changed. After one is renamed in the owner app to "Ali R.", the same command exits 0 and assigns both. Three or more duplicates across two names: every duplicated name is listed.

### 10.10d Added for the answers to the D-decision questions (still v0.4)
95. **Corrective re-link (§6.15a, review 2 N3).** Owner linked to X (a qualifying admin at every branch): re-link to Y, also a qualifying admin at every branch, with the right `--confirm-name` → exit 0, `staff_id = Y`, one audit row `before { staff_id: X }`, `after { staff_id: Y }`, `actor_kind 'cli'`; afterwards removing Y's Owner role → `409 OWN_ADMIN_ACCESS`. **Re-link from a row that qualifies nowhere to a non-admin** (X lost its admin access by hand-edited data; target a Cook with no PIN) → exit 1, link unchanged, no audit row (the vacuous case of v0.4). Re-link to a row with no PIN, without `manage-devices`, with a denial of `access-hub-admin`, or that has left → exit 1.
96. **Renamed default roles change nothing on the hub (R5).** The hub fixture is applied twice, once as is and once with every role renamed (e.g. "Order taker" → "Bera", "Owner" → "Malik", "Manager" → "Incharge"; same `role_id`s and grants). For every staff member, `resolve` over every permission, `ttlFor`, `adminPermissions`, `GET /queries/session` permissions, the admin login roster membership, and the outcome of one command per permission class (allowed, `requires_approval`, `not_granted`, `denied`) are identical; only `role_names` display strings differ.
97. **Link target must qualify at every branch of the tenant (review 2 N3, replaces D-15's superset test).** Tenant with branches A, B, C; Y is a qualifying admin at A only (at B and C it is not assigned; denials are per person, not per branch, so a denial cannot make Y fail at B alone): first link and re-link to Y both exit 1 and the message lists B and C (names and ids), not A; nothing written. After Y is made a qualifying admin at B and C, the link exits 0 and is audited.

### 10.10e Added in v0.5 (hostile review 2)
98. **No deadlock on the owner row (N2).** Two logins of the owner released together → both `200`, no `40P01`, one counter reset each; two rotating refreshes of two different refresh tokens released together while `lock_notice_at` is set → both `200`, exactly one returns `lockout_notice`, no `40P01`; a login and a rotating refresh released together → both `200`. Each case 50 runs.
99. **`link-owner-staff` takes the tenant lock (N3).** (a) A staff `PATCH` that removes Y's `manage-devices` holds the tenant lock (barrier); the CLI linking Y waits; after the PATCH commits, the CLI exits 1 listing the branch. (b) The CLI holds the tenant lock having verified Y; the same PATCH waits; after the link commits, the PATCH → `409 OWN_ADMIN_ACCESS`.
100. **`--confirm-name` (N3).** Y is "Ali Raza": the flag missing → exit 1; `"ali raza"`, `"Ali  Raza"`, `"Ali Raza "` → exit 1, and the output shows Y's display name, role names and branches; `"Ali Raza"` → exit 0. Nothing written on any exit 1.
101. **Linked row cannot be marked as left (N3).** `PATCH { expected_version, is_active: false }` on the owner's linked row → `409 STAFF_LINKED_TO_OWNER { staff_id }`, nothing written, no audit row (also with `owner_users.staff_id` pointing at a row that is not a qualifying admin, built by hand); the same PATCH on any other person → `200`.
102. **No false `CONFIG_STALE` after the owner's own action (N4).** Open a person (`GET /v1/admin/staff`), set their PIN (`PUT …/pin` → `200 { staff }` whose `version` equals the GET's), then save a role change with the GET's version → `200`. Archive a role held by two people: the response's `changed_versions.staff` lists both with new versions; a save of either person with the listed version → `200`, with the old version → `409`. A leaver PATCH that moves two reports returns their new versions in `changed_versions.staff`.
103. **Archived station never makes the set stale (N4).** Station S has responsibilities; archive S (01a §6.9); `GET …/responsibilities` → set without S and a version; `PUT` with that version → `200 { responsibilities, version, changed_versions }`; S's rows are still in the table; restore S → the GET shows them again. A second PUT with the version from the first PUT's response → `200`.
104. **One builder, one hash (N4).** For a staff member, a role and a responsibility set, the `version` from the list `GET`, from the in-transaction compare (captured with a test hook) and from the write response are byte-identical; the builder gives the same version for rows whose `BIGINT`s come as strings (`"1730000000000"`) or numbers, whose arrays come in reverse order, and whose nullable values are `null`; it throws (test fails) on an `undefined` value. A source check finds no `sha256hex(canonicalJson(` call for these entities outside `versions.ts`.
105. **Roll-forward only is enforced (N5).** On a database whose `schema_migrations` holds `0005` and an extra row `0006_future.sql` that the build does not have, `migrate()` throws `MigrationUnknownVersionError` naming `0006_future.sql`, applies nothing, and the cloud process exits non-zero before listening; with the extra row removed, boot succeeds.
106. **`default_key` backfill aborts loudly (N6).** `0005` on a v1.4-seeded tenant whose "Manager" role was renamed "Incharge" → the migration fails with `default_key backfill incomplete (tenant: missing key): <tenant_id>: manager`, nothing of `0005` applied; a database with no tenants, or with every tenant intact, → commits.
107. **Guard read failure is never a sign-out (N9).** With the guard's `owner_users` read forced to fail (connection error, statement timeout): `GET /v1/admin/staff` and `POST /v1/auth/logout` → `503 SERVICE_UNAVAILABLE`, never `401`; the route handler is not called; once the read works again the same token → `200`. The owner app keeps the session and shows the cloud-unreachable state (page part).

### 10.11 Acceptance table

| AC | Test |
|---|---|
| E6 AC1 create roles | 1, 15 |
| E6 AC2 catalogue | 1, 14 |
| E6 AC3 three grants + approver; denial per person | 12, 13 |
| E6 AC4 multi-role most generous | 12, 18 |
| E6 AC5 logged | 5, 58 |
| E6 AC6 default set; owner can modify or replace | 20, 16 |
| E6 AC7 last admin | 1, 11 |
| E6 edge: allowed + requires_approval → allowed | 12 |
| E6 edge: own admin role → blocked with a clear message | 63 |
| E0 PIN AC4 idle per role | 18 |
| E0 PIN AC7 PIN set/reset, internet | 3, 6, 58 |
| R3 staff ↔ branch | 2, 8, 30 |
| E6-TEAM AC1 one lead per branch | 57 |
| E6-TEAM AC2 no loops | 27 |
| E6-TEAM AC3 leaver's team moves up | 28, 29 |
| E6-TEAM AC4 team tree visible | 61 |
| E6-TEAM AC5 no permission from a line | 31 |
| B17 Cook team member without PIN | 62 |
| S38 responsibilities | 32–36 |
| M73 owner notice | 4 |
| Q9 change / forgot password | 37–44, 65 |
| 01a §6.7 settings endpoint | 45, 46, 59 |
| D-6 day open and close need branch scope | 68, 71 |
| B7 fail safe with no owner link, and its fix (`link-owner-staff`: first link or corrective re-link, only to a qualifying admin at every branch of the tenant, §6.15a) | 69, 72 |
| B22 no existing row breaks a new CHECK | 66, 70, 89 |
| Review 1 M1 tokens older than a password change refused | 41, 65, 73 |
| Review 1 M2 no session survives a change or reset | 43, 74 |
| Review 1 M3 temporary password expires | 75 |
| Review 1 M4 qualifying admin needs `manage-devices` | 76 |
| Review 1 M5 default roles found by `default_key` | 20, 55, 77 |
| Review 1 M6 additive directory, hub sync visible | 24, 67, 78 |
| Review 1 M7 approver move rollback-safe | 79 |
| Review 1 M8 single owner | 8, 17, 48, 63 |
| Review 1 M9 stale writes refused | 80 |
| Review 1 m1–m11 | 81–90 (m8 moot) |
| D-10 / N1 credential version | 74, 91 |
| D-11 staleness threshold from the poll interval | 78, 92 |
| D-12 Order taker and Waiter separate | 20, 77 |
| D-13 no support override; link and re-link only to a qualifying admin at every branch of the tenant (review 2 N3, replacing D-15) | 72, 95, 97 |
| D-14 new branch: qualifying admins, no duplicate names | 93, 94 |
| R5 no hub behaviour from role names | 55, 96 |
| Review 2 N1 credential version, access token from a racing login or refresh refused | 74, 91 |
| Review 2 N2 no owner-row deadlock | 74, 98 |
| Review 2 N3 link target qualifies at every branch, tenant lock, confirm-name, linked row cannot leave | 72, 95, 97, 99, 100, 101 |
| Review 2 N4 versions: PIN, cascades, archived stations, one builder | 102, 103, 104 |
| Review 2 N5 roll-forward enforced | 105 |
| Review 2 N6 backfill aborts on a gap | 106 |
| Review 2 N9 guard read failure is 503 | 107 |

---

## §11. Build order

1. Cloud migration `0005_staff_roles.sql` (§5.1): read the real constraint names from `0001`/`0002` first. Tests 66 (migration part), 70, 77, 89, 106; and 00's cloud migrations runner refuses unknown applied versions (00 §5.2, §4.3 row 20): test 105.
2. `@pos/domain`: `PERMISSION_CATALOGUE`, `PERMISSION_SCOPES`, `Scope`, error codes (§9), F §6.2 rows appended. Tests 13, 14 (unit part).
3. `@pos/events`: directory schema v2 (§4.3.1), `StaffDirectoryApplied` v2 and its upcaster (B18), `admin/staff.ts` wire schemas (§5.3, with `version`). Test 64.
4. Cloud `loadDirectory` v2 (§4.3.1, §7.3), additive (keeps `approver_role_id`), approver roles from the list table. Tests 6, 21, 79 (directory part), 83.
5. Hub migration `0005_directory_v2.sql` (§5.2), `applyStaffDirectory` and `StaffDirectory` v2 (`resolve` scope, `floorsOf`, `leadOf`, `teamOf`, `stationsOf`), session and roster queries; approver drop/skip (B18 c). Tests 3, 12, 19, 22, 23, 24, 31, 36, 84.
6. Cloud staff routes §6.1–§6.4 with the directory write script (`FOR NO KEY UPDATE`, B8 check, `expected_version`), guards with the M4 qualifying-admin SQL (§3.4), B15, merged-row check and `branch_ids` diff. Tests 2, 7–11, 25–30, 56, 57, 58, 62 (cloud part), 63, 69, 76, 80 (staff part), 82, 85, 87, 101, 102, 104 (staff part). The version builder `versions.ts` (§5.3) comes first in this step.
7. Cloud role routes §6.5–§6.7, with the dual-written `approver_role_id`. Tests 1, 5, 15–18, 60, 79 (write part), 80 (role part), 104 (role part).
8. Responsibilities §6.8 and the 01a stock hook (§4.4 rows 9–13). Tests 32–35, 68, 71 (server part), 80 (responsibility part), 103, 104 (responsibility part).
9. Branches §6.9 (own script), §6.10, 01a §4.4 rows 3, 6–8, 14 (`hub_synced_at`, `hub_stale_after_ms`, `CONFIG_POLL_INTERVAL_MS`); `issue-registration-code` (§4.3 row 19). Tests 45–48, 59, 66 (CLI part), 67, 86, 88, 92, 93, 94.
10. Owner auth: `credential_version` on `owner_users` and `owner_refresh_tokens`, claim `cv`, `FOR NO KEY UPDATE` on the owner row in login, refresh, change-password and reset, guard `503` on a failed read (review 2 N1, N2, N9); §6.11 (with the hash compare-and-set), §6.13 (login re-check, refresh lock order and notice, JWT guard owner-row read, 00 §6.24a, §4.4 row 1), §6.14 and §6.15a CLIs, runbook, redaction. Tests 4, 37–44, 65, 72, 73, 74, 75, 81, 90, 91, 95, 97, 98, 99, 100, 107.
11. `seed-tenant` defaults §6.15 with `default_key`, lookups by key; re-seed dev data. Existing tests that find a default role **by name** move to `default_key`: `apps/cloud/test/default-roles.test.ts` (`grants('Order taker')` and the others) and `apps/cloud/test/cli/seed-tenant.int.test.ts` (the expected role list and `byRole.get('Order taker')`), which also expect the six roles. The hub fixtures (`apps/hub/test/helpers/fixtures.ts`, `apps/hub/test/queries/admin-lists.int.test.ts`) keep "Order taker" only as a display name: the hub directory carries no `default_key`, and no hub code compares it. Tests 20, 62 (hub part).
12. Team tree §6.12. Test 61.
13. Owner app views (§8), strings, Urdu todo; the 01a stock page's day actions under `my_stations` (§4.4 row 13). Tests 49–54, 71 (page part), 78.
14. Repository-wide checks: the role-name grep (R5), the renamed-roles hub run (R5), and the route-inventory / cross-tenant tests over the 14 new routes (D54). Tests 55 (exact scope, §10.9a), 96.

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done
- Every numbered test 1–107 has one matching test; all pass in CI.
- 00 v1.5 and 01a v1.3 approved in the same change set as 01b; README updated.
- Release done in the §7.4 order (cloud first, then each hub); every branch shows "Up to date" afterwards (B19).
- No route returns `pin_hash`; redaction tests pass.
- Route-inventory and cross-tenant tests cover the 14 new routes (D54).

### 12.2 Endpoint checklist

| § | Route / CLI | Auth | Idempotency | Audit | Bumps | Tests |
|---|---|---|---|---|---|---|
| 6.1 | `GET /v1/admin/staff` | owner (JWT guard, §6.13) | — | — | — | 8, 73 |
| 6.2 | `POST /v1/admin/staff` | owner covering every branch (B8) | key | `staff/create` | directory | 2, 6, 7, 56, 57, 62 |
| 6.3 | `PUT /v1/admin/staff/:id/pin` | owner covering every branch (B8) | retry-safe; returns `StaffWire` with `version` | `staff/pin_set` | directory | 3, 25, 58, 102 |
| 6.4 | `PATCH /v1/admin/staff/:id` | owner covering every branch (B8) | no-op rule; `expected_version` (B23) | `staff/update, left, returned, reports_to_reassigned` | directory | 2, 7–11, 26–30, 63, 76, 80, 82, 85, 87, 101, 102, 104 |
| 6.5 | `GET /v1/admin/roles` | owner | — | — | — | 17, 80 |
| 6.6 | `POST /v1/admin/roles` | owner covering every branch | key | `role/create` | directory | 1, 13–15, 17, 60, 79 |
| 6.7 | `PATCH /v1/admin/roles/:id` | owner covering every branch | no-op rule; `expected_version` (B23) | `role/update, archive, restore` | directory | 1, 5, 11, 16, 18, 63, 76, 79, 80, 102, 104 |
| 6.8 | `GET`/`PUT …/branches/:b/responsibilities` | owner covering every branch | PUT whole active-station set; `expected_version` (B23); returns `{ responsibilities, version }` | `responsibility/update` | directory | 32, 33, 35, 80, 103, 104 |
| 6.9 | `PATCH /v1/admin/branches/:b` | owner covering every branch | no-op rule; unique index | `branch/update` | — | 47, 48, 88 |
| 6.10 | `GET`/`PATCH …/branches/:b/settings` | owner covering every branch | no-op rule | `branch_settings/update` | that branch's config | 45, 46, 48, 59 |
| 6.11 | `POST /v1/auth/change-password` | JWT (guard, §6.13) | hash compare-and-set under `FOR NO KEY UPDATE`; `credential_version` + 1 (§6.11) | `owner_user/password_change` | — | 37–40, 43, 44, 74, 90, 91 |
| 6.12 | `GET /v1/admin/branches/:b/team-tree` | owner, branch of the tenant | — | — | — | 61, 62 |
| 6.13 | `POST /v1/auth/login` (00, changed) | allowlist | — | — | — | 4, 41, 74, 75, 91, 98 |
| 6.13 | `POST /v1/auth/refresh` (00, changed) | allowlist | M49; owner row `FOR NO KEY UPDATE` first; `credential_version` equality | — | — | 42, 74, 81, 91, 98 |
| 6.13 | JWT guard (00 §6.24a, new; not a route) and `POST /v1/auth/logout` (00, guard only) | JWT | — | — | — | 65, 73, 91, 107 |
| §4.3 | hub `GET /queries/session` (00, changed) | device + session | — | — | — | 19 |
| §4.3 | hub `GET /queries/staff-roster` (00, changed) | device | — | — | — | 36, 62 |
| §4.4 | `GET /v1/sync/config` (01a, changed) | branch key | read | — | — | 21, 24, 67, 83 |
| §4.4 | `GET /v1/admin/branches` (01a, changed) | owner | — | — | — | 47, 67, 78, 92 |
| §4.4 | `OpenBusinessDay`, `CloseBusinessDay` (01a, changed) | admin session, `manage-stock` scope `branch` | `command_id` | — | — | 68 |
| §4.4 | `SetPrecookedStock`, `AddPrecookedStock`, `SetItemAvailability` (01a, changed) | admin session, `manage-stock` | `command_id` | — | — | 34 |
| §4.4 | `GET /admin/queries/stock` (01a, changed) | admin session, `manage-stock` | — | — | — | 34, 71 |
| 6.14 | CLI `reset-owner-password` (new) | shell (no session logging) + `SystemContext` | rerun issues a new password; `credential_version` + 1 | `owner_user/password_reset` (`cli`) | — | 41, 74, 75, 90, 91 |
| 6.15a | CLI `link-owner-staff` (new) | shell + `SystemContext`; tenant lock; `--confirm-name` exact | same link → no-op; first link and re-link only to a qualifying admin at every branch of the tenant, else exit 1 listing the branches (review 2 N3) | `owner_user/update` (`cli`, old and new `staff_id`) | — | 72, 95, 97, 99, 100 |
| 6.15 | CLI `seed-tenant` (00, changed) | shell + `SystemContext` | refuses duplicate | — | — | 20 |
| §4.3 row 19 | CLI `issue-registration-code` (00, changed) | shell + `SystemContext` | reissue rules unchanged | — | directory | 86, 93, 94 |
| §4.3 row 20 | cloud migrations runner (00, changed; boot, not a route) | — | refuses unknown applied versions | — | — | 105 |

### 12.3 Open questions (developer)
- **D-1** *Decided 2026-10-27:* blocked (B7 b, test 63). *v0.4:* the message is "You can't remove your own admin access. Call support." (single owner, review 1 M8).
- **D-2** `own_tables` is in the scope enum but on no permission (§3.3). 02's spec decides whether any permission needs it; if none does, drop it in v1.0.
- **D-3** A stock counter must also hold `access-hub-admin` to open the stock page (00 M42). The hub admin home shows only what their other permissions allow (00 M89), so this gives no device or staff power, but the word "admin" may confuse owners. Alternative: a stock-only sign-in in 02's staff login. Review should decide.
- **D-4** Scope with mixed grant types (§3.3, test 12): the `requires_approval` role's wider scope does not apply "with approval" outside the `allowed` scope. 04 may want that; then `resolve` returns two scopes.
- **D-5** `config_audit`, `branches` and `role_permissions` constraint names in §5.1 follow PostgreSQL's naming rule; build step 1 verifies them against the database.
- **D-6** *Decided 2026-10-27:* day open and close need scope `branch`; `403 outside_scope` with `required_scope: 'branch'` (B20, §4.4 rows 12–13, tests 68, 71).
- **D-7** *Decided 2026-10-27:* `GET /v1/admin/branches/:branch_id/team-tree` (§6.12).
- **D-8** *Decided 2026-10-27:* team-membership roles are defaults only (no PIN, no permissions); no code branches on a role name (B17, §3.8).
- **D-9** *Decided 2026-10-27:* no client-version gate or clamp now; carried to 06 as "a rejected value never blocks the sync queue" (B22, §4.5, README carried-requirements table).
- **D-10** *Decided 2026-10-27:* the JWT carries `iat_ms` (Unix ms). The guard and refresh compare against `password_changed_at` in milliseconds with strict `<`: the guard compares `iat_ms`, refresh compares the refresh token's `created_at`. The token pair the change issues has both equal to `password_changed_at` and works; a token issued 1 ms earlier, even in the same second, is refused (§6.13, test 91). *Superseded in v0.5 (review 2 N1):* the comparison is an integer `credential_version` (claim `cv`, refresh-token column), equality, changed under the owner row lock; `iat_ms` is removed.
- **D-11** *Decided 2026-10-27:* the warning threshold is `3 × CONFIG_POLL_INTERVAL_MS` (shared constant in `@pos/events`, used by the hub poller; 180 000 ms today), sent by the cloud as `hub_stale_after_ms` (§8, B19, 01a §3.4, §6.7b; tests 78, 92).
- **D-12** *Decided 2026-10-27:* Order taker and Waiter are different jobs. `order_taker` joins the key set; the backfill keys the existing "Order taker"; `seed-tenant` creates Order taker and Waiter separately; a person doing both holds both roles, no mode (B17, §5.1, §6.15, README carried row for 02; tests 20, 77).
- **D-13** *Decided 2026-10-27:* own-admin removal is blocked by design; support explains it and tells the owner to give admin access to someone else if needed; **support has no override**. Runbook section written (§7.5). *Answered 2026-10-27:* `link-owner-staff` may re-link only to a row that is itself a qualifying admin, audited with the old and new `staff_id` (§6.15a, B7, tests 72, 95).
- **D-14** *Decided 2026-10-27:* (a) a new branch gets only qualifying admins (`access-hub-admin` and `manage-devices`, B7); stock counters are not assigned (test 93). (b) The CLI refuses when two assigned people share a name, listing the duplicates; the owner renames one and re-runs; no auto-rename (test 94). 00 §3.1 M57, §6.27; §4.3 row 19.
- **D-15** *Decided 2026-10-27:* a corrective re-link needs the new row to be a qualifying admin at every branch where the old row is one (a superset); otherwise exit 1, nothing written, the missing branches listed (§6.15a, B7, §7.5, test 97). *Superseded in v0.5 (review 2 N3):* the target must be a qualifying admin at every branch of the tenant (first link and re-link), under the tenant lock, with `--confirm-name`; test 97 rewritten.
- **D-16** *Open (v1.1, AD-14):* §6.4 says "rules as §6.2 on the merged row"; the built PATCH checks **sent** fields as §6.2 does and trusts unsent ones (they passed when written), except the role-archived check on the merged row (applied in v1.1). Example: a stored lead who has since left is not re-checked by a rename. Either amend §6.4 to the built rule (README C4) or change the code to re-run every §6.2 rule; until decided, the code's rule stands.
- **D-17** *Open (v1.1, AD-15):* the directory write script says `changed_versions` lists records "whose version the write changed by cascade"; the built leaver and branch-removal paths list in `changed_versions.responsibilities` **every** branch where the person's rows were deleted, including a branch that lost only rows at archived stations, whose set version is unchanged (the client stores the same value, so it is harmless). Either amend the rule to "may list a record whose version is unchanged" or change the code to list only changed sets.

### 12.4 Deferred until needed

| Item | Trigger |
|---|---|
| Main and secondary role, capacity per role and person (Q20, Q21, R25) | The first module that reads them (02 stats or 07, P2) |
| Branch rename reaching the hub (hub shows its provisioned name) | An owner reports the old name on a hub screen; add `branch_name` to the snapshot (01a S28 c, optional field) |
| "Made by Arif" on a role (design S03) | Owner asks; read from `config_audit` |
| Manager cloud login with `manage-staff` | P2 (Q1) |
| E-mail password reset | An e-mail sender exists |
| Dropping `role_permissions.approver_role_id` and the wire's `approver_role_id` (dual-written in v0.4, B18 a, M7) | Every hub runs v2 code **and** the cloud no longer needs to roll back past 01b (it already cannot, B22); one release drops the column, its CHECK and the wire field |
| A second owner login (partner owners with some branches; per-person and per-branch coverage, `can_edit`, read-only views, owner selection in `issue-registration-code`, "Ask another owner") | The owner asks for a second login, or a partner joins (Q10 decided for P1: one owner, review 1 M8). Review 1 m8 (B15 moves people another owner may not cover) must be decided then |
| Audit viewer | 07 (Q5) |
| Pagination of the staff list | > 500 staff in a tenant |
| Per-hub config poll interval (today the shared constant `CONFIG_POLL_INTERVAL_MS`, B19, D-11) | A hub needs a different interval; then the hub reports its interval on each poll and the cloud computes that branch's `hub_stale_after_ms` from it |
| **Review 2 N7:** the cloud cannot see which hubs run directory v2 (a v1.4 hub applies the additive directory, gets `304` and shows "Up to date" while it does not enforce `my_stations`, D-6 or multi-approvers) | Before the first release that relies on a v2-only hub behaviour across branches (02 enforcing scopes, or 04 approvals with several approvers), **or** before the §12.4 drop of `approver_role_id`, whichever comes first. Fix then: the hub sends its directory schema version on the poll (one header), the cloud stores it on `branches`, S06 shows "Hub needs update" below 2 |
| **Review 2 N8:** "Up to date" warns during long editing sessions (`hub_synced_at` moves only on `304`) | The owner reports the warning on a healthy hub, or 07 turns the B19 warning into an alert. Fix then: also set `hub_synced_at` when a poll reports the versions the cloud sent in its previous `200` (store the sent pair, two columns); extend test 67 |
| **Review 2 N10:** `reset-owner-password` clears `lock_notice_at`, so a lock that happened before a reset is never shown | 07 adds owner security notifications, or the owner asks why they were not told about failed sign-ins. Fix then: the reset clears the counters and the lock but keeps `lock_notice_at` |
| Assign stock counting by today's duty/shift (whoever is on that station this shift), owner answer Q7 | A shift/duty-roster module exists |
| Editing reporting lines from the team tree (drag and drop) | The owner asks; v0.3 edits lines on the person |

---

## Owner questions for the visit

Plain language. All answered at the owner visit (2026-10-27); no [ASSUMPTION] tags remain for them.

**Still open**

None.

**Confirmed by the owner (2026-10-27), no longer assumptions**

1. When a cashier gives a discount, the manager approves it by default (§6.15).
2. A new Waiter and a new Cook start with no permissions; the ordering and kitchen modules add them (§6.15, B17).
4. Support reads the temporary password to you on a phone call, and you change it at first sign-in (B5, §6.14).
5. When a team lead leaves, their people automatically report to the lead's own boss, and you can change it afterwards (B15).
6. A stock counter changes stock only for their own station (B20, §3.6).
9. Two people at the same branch never share a name on the sign-in screen ("Ali R." / "Ali K.") (B12).
3. No support phone number for now: the owner app says "Call support." with no number; a number can be added later as an optional setting (§8).
7. Stock counting is assigned to a specific person or to whoever handles the station (a role on the station); by today's shift is for later (§3.6, §12.4).
8. 4 hours (240 minutes) is the longest anyone stays signed in while idle (B13).
11. Scopes as listed: their floors for taking orders anywhere and freeing a locked table, their team for approving voids, their stations for stock (§3.3). Asking staff outside your team for help (e.g. another order taker's waiters on the same floor) is a request they accept, not a permission (01d, §4.5).
12. An order taker is signed out after 15 minutes idle, the same as a cashier (B17, §6.15).

**Decided 2026-10-27 (review 1)**

10. One owner login per restaurant in P1; a partner owner who owns only some branches is deferred until one is needed (B8, §12.4).
13. Order takers take orders; waiters (helpers) serve. They are separate roles; someone who does both during a rush has both roles (B17, D-12).
