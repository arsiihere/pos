VERDICT: BLOCKERS

# 01b batch review: fixes R-1, R-2, P-3/P-4 answers and tasks 51–55 (9564df8..20c28d1)

Checked against: foundation §6; the 01b spec §3.7, §6.1–§6.12, §8 (views, error mapping, support number Q3), §9, B19, B23, review 2 N4; test #78; the plan's "Done when" for tasks 51–55; AD-29/AD-31 amendments and AD-32; P-3 and P-4 with their answers. I re-ran `pnpm vitest run apps/client/src/features/owner apps/client/src/app`: 27 files, 79 tests, all pass.

There are no Blockers. The verdict is BLOCKERS because of the Should-fix findings below; the first line allows only PASS (zero Blockers and zero Should-fix) or BLOCKERS.

## Should-fix

- **R-1 (Should-fix, T51 / T52)**: `apps/client/src/features/owner/staff/StaffForm.tsx:682`, `apps/client/src/features/owner/roles/RoleList.tsx:133`.
  - **Problem:** the D02 "Mark as left" dialog maps every error other than `CONFIG_STALE` through the generic `errorText`. For `OWN_ADMIN_ACCESS`, `apiErrorKey` returns `errors.OWN_ADMIN_ACCESS` and ignores `details.reason`. So `reason: 'owner_not_linked'` never gets its own §8 text ("Your owner login isn't linked to your staff profile yet … Call support to link it."). `StaffForm`'s main save and `RoleList` use `ownAdminText`; the leave dialog does not. Separately, `LAST_ADMIN_REQUIRED` in the leave dialog and in the role-archive blocked dialog (`RoleList.blockedFor`, falls through to `errorText`) shows the generic sentence with no branch names. §8 says: "`LAST_ADMIN_REQUIRED` → roles field or blocked dialog naming the branches".
  - **Failure scenario:**
    - The owner is not yet linked (`owner_users.staff_id` null). They mark Bilal, the only hub admin at Gulberg, as left. The server answers `409 OWN_ADMIN_ACCESS { reason: 'owner_not_linked' }`. The dialog says "You can't remove your own admin access", which is false (Bilal is not the owner) and hides the real fix, `link-owner-staff`.
    - The owner archives the "Manager" role and gets `LAST_ADMIN_REQUIRED { branch_ids: [B2] }`. The blocked dialog does not say which branch would lose its admin.
  - **Required fix:**
    - In `LeftDialog.confirm`, map `OWN_ADMIN_ACCESS` through `ownAdminText(error.details)`.
    - In `LeftDialog` and `RoleList.blockedFor`, show `LAST_ADMIN_REQUIRED` with the branch names from `details.branch_ids`, as `RoleEditor` already does (`roles.last_admin_body`).
    - Add `[01b §8]` tests for both codes in the leave dialog and the archive dialog.

- **R-2 (Should-fix, T55)**: `apps/client/src/app/support.ts:13`; `apps/client/src/i18n/ur.ts:153,161`.
  - **Problem:** `withSupport` adds the number with an English-only regex (`/Call support(?=\.| to | if )/`). For Urdu texts (`account.forgot`, `branches.behind_body`, and the error texts once they are translated) it never matches. Owner answer Q3 and §8: "set → the number is appended" applies to every support text, whatever the language. The tests cover only English.
  - **Failure scenario:** the build sets `VITE_SUPPORT_PHONE=0300 1234567` and the owner uses the app in Urdu. They forget the password and open `#/account/password`. The caption reads "پاس ورڈ بھول گئے؟ سپورٹ کو فون کریں۔" with no number, which is exactly the case Q3 was answered for.
  - **Required fix:** give each support text a `{support}` placeholder, or a with-phone variant key, in both `en.ts` and `ur.ts`. Fill it from `supportPhone()` instead of rewriting the English sentence. Add the Urdu case to `support.test.ts` and to the ChangePassword caption test (phone set and unset).

- **R-3 (Should-fix, T54 / AD-32)**: `apps/client/src/features/owner/branches/BranchesView.tsx:63-81`.
  - **Problem:** §8 / B19 say every branch shows "Hub checked in {time} ago" **and** "Up to date {time} ago", with the second shown as a warning when `hub_last_seen_at − hub_synced_at > hub_stale_after_ms`. AD-32 adds an "away" state (a display-only call, correctly Class B). But it is checked **first** and replaces both B19 lines. While a hub is away, the page no longer shows how far behind it is or whether the behind warning applies.
  - **Failure scenario:** the Johar Town hub stopped taking config two hours ago (behind) and then lost the internet five minutes ago (away). The owner sees only "Johar Town hub last checked 5 min ago". They assume it is a short outage and do not learn that its config has been stale for two hours. A staff change made since then is not at the branch.
  - **Required fix:** keep the away notice, but still render the "Up to date {time}" line, and its warning when B19's condition holds, for an away hub. Add a `[01b #78]` case where the hub is both away and behind.

- **R-4 (Should-fix, T47 / T50b: parked answers not applied)**: `docs/runbooks/owner-password-reset.md:19,36`, `docs/plans/01b-status.md` (T47, T50b rows), `apps/client/src/features/owner/Shell.tsx:95-100`.
  - **Problem:** 43df423 recorded the human's answers to P-3 (call back the owner's mobile number from the onboarding checklist) and P-4 (option B: Menu button and an overlay nav built on the kit `Dialog`; Change password and Sign out reachable on the phone). Nothing in this batch applies them:
    - The runbook still says "Identity check: PENDING owner decision (P-3) … still do not reset until P-3 is answered".
    - T47 and T50b are still PARKED.
    - The phone shell still has the tab bar with no Change password and no Sign out.
  - **Failure scenario:**
    - An owner calls support after a lock-out. The runbook forbids any reset, so support either refuses a legitimate owner or ignores the runbook, and the call-back check is never written down.
    - On a phone the owner cannot sign out or reach `#/account/password` from the nav, although T55 now ships that view.
  - **Required fix:**
    - Set T47 and T50b back to TODO (answered).
    - Add the P-3 call-back step to the runbook's identity section: call back on the number in the onboarding checklist before any temporary password or owner link; the AD-29 questions are a pre-check only.
    - Build the P-4 B phone nav on `Dialog` (Escape, focus trap, focus return, `role="dialog"`), with tests. Record it under "Design vs spec" in the build log, as the answer says.

## Nits (non-blocking)

- N-1 (T54): `apps/client/src/features/owner/branches/BranchesView.test.tsx:45`. `warned()` matches any `.pos-hub.is-warn`, so it cannot tell the B19 "behind" warning from the AD-32 "away" notice. The #78 threshold case passes only because the clock is frozen exactly at `seen = threshold`. Assert on the `branches.behind` text instead.
- N-2 (T55): `apps/client/src/features/owner/account/ChangePassword.tsx:143`. The support caption is hidden on the forced view (`!forced`). §8 puts the caption on `#/account/password` without that exception, and a forced owner whose temporary password expired is the person who most needs it.
- N-3 (T55): the "Done when" requires `pnpm --filter @pos/client build` with `VITE_SUPPORT_PHONE` set. The build log says it was not run, but the status row says DONE.
- N-4 (T52): the build log says the tests were written first but first run after the views. Red was never observed for the stated reason.
- N-5 (T51–T55): no view state was compared with the handoff screens at 1440 / 390. This is deferred to T59, but every "Done when" lists it.

## Checked and fine

- **Edit forms (B23, review 2 N4):**
  - Staff, role, idle-inline and stock-counting writes send the held `version` as `expected_version`.
  - The PIN dialog hands the response's version back to the form, so a PIN reset never makes the next save stale.
  - `CONFIG_STALE` disables Save and offers Reload. Reload remounts the editor from a fresh read, so nothing of the stale form is kept (the test asserts that).
- **Staff PATCH:** it sends only the changed fields, and each list whole. Leaving is `{ expected_version, is_active: false }`. `STAFF_LINKED_TO_OWNER` shows the §8 text.
- **PIN:** the PIN stays in component state only and is cleared after every request, success or failure. The phone hand-over drops the first PIN once the second is typed. The test checks that the DOM no longer holds the value.
- **Roles:**
  - "Approved by" is a chip multi-select of active roles, and the role itself can be picked.
  - "Where" comes from `PERMISSION_SCOPES`.
  - An approval grant with no approver is refused before sending.
  - Admin-guard snap-back works, and `OWN_ADMIN_ACCESS` uses `ownAdminText`.
- **Stock counting:** the PUT sends the whole active set, and a station with nobody is left out (AD-19). After a save, the held version is replaced with the response's.
- **Teams:** the tree is indented, shows "No PIN" from `has_pin`, each name links to `#/staff/:id`, and it is read-only.
- **Branches:**
  - The threshold comes from the response's `hub_stale_after_ms`; there is no `180000` in `apps/client/src`.
  - Settings check the ranges and stale > gap before sending, and send only the changed fields.
  - AD-32 is a valid Class B (display only, no wire change). Its placement is R-3.
- **Session:**
  - A 503 now goes to the cloud-unreachable state and probe; the probe treats 503 as still down.
  - `PASSWORD_CHANGE_REQUIRED` marks the stored user and redirects. Every view redirects while `must_change_password` is set, with no side nav.
  - The lockout notice is stored from login or refresh, shows `failed_count`, and is cleared on sign-out.
  - `JWT_INVALID` followed by `REFRESH_TOKEN_INVALID` lands on sign-in once.
- **R-1 / R-2 fixes (previous review):** P-3 and P-4 are parked with options, AD-29 and AD-31 are amended, and the S50 a tab bar is restored with a test.
- **Scope:**
  - No server code, migrations, events, API contracts or error codes changed. The `listBranches` client type gains `hub_stale_after_ms`, which the server already sends.
  - No test is skipped or weakened.
  - `App.tsx`, `form.ts` and `cloud-admin.ts` changes are needed by the views (Class A, logged).
