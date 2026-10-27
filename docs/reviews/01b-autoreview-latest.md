VERDICT: BLOCKERS

# 01b batch review: R-1 fix and tasks 43, 44, 46, 47, 50b (5658542..5dcfc6e)

Checked against: foundation §6; the 01b spec §6.13, §6.14, §6.15a, §7.5, §8, B7, B11; tests #74 c–e, #95, #98, #99; 01a v1.3 S50 a (the owner shell, which 01b does not change); the plan's "Done when" for tasks 43, 44, 46, 47 and 50b; AD-25 (amended) and AD-29 to AD-31. I re-ran the 4 test files in this batch: 26/26 pass.

## Blockers

- **R-1 (Blocker, T47 / AD-29: a wrong Class B)**: `docs/runbooks/owner-password-reset.md:17-34`, `docs/reviews/01b-auto-decisions.md` (AD-29).
  - **Problem:** §7.5 asks for "identity check questions" but does not list them. AD-29 picked them itself: the sign-in e-mail, the restaurant and branch names, and the name on the owner's hub tile. Who may receive a temporary owner password is auth and security behaviour. AUTOBUILD puts that explicitly in the Class B exclusion list, so this decision must be Class C (park it for the owner). The chosen questions are also weak:
    - the restaurant and branch names are public;
    - every staff member sees the owner's tile name on the hub;
    - the e-mail is often on invoices or business cards.
    
    AD-29 also says "no call-back rule invented". So nothing ties the caller to a known phone number.
  - **Failure scenario:** a staff member who has left phones support, claims to be the owner and answers all three questions from what they saw at work. Support runs `reset-owner-password` and reads the temporary password aloud. The caller signs in, sets a new password and owns the tenant: staff, roles, PIN resets and the owner lockout. Every one of the real owner's sessions is revoked.
  - **Required fix:**
    - Park this as P-n (task T47) with options, for example: (A) call back on a phone number recorded at onboarding; (B) a shared secret set at onboarding; (C) an in-person or video check.
    - Set T47 to PARKED.
    - Until the owner answers, change the runbook's identity section to say "Identity check: PENDING owner decision (P-n). Do not reset without the owner's agreed check". Keep the three questions only as a minimum, not as enough.
    - Mark AD-29 as superseded by P-n.

- **R-2 (Blocker, T50b / AD-31: a wrong Class B, and a change to another module's approved spec)**: `apps/client/src/features/owner/Shell.tsx:100-120,130-138`, `docs/reviews/01b-auto-decisions.md` (AD-31).
  - **Problem:** 01a v1.3 S50 a (APPROVED) says the owner shell is "a side menu … and, at phone width (≤ 760 px), a bottom tab bar". 01b §8 and §4.4 do not change S50 a. T50b removed the phone tab bar and replaced it with an app-bar Menu button that opens the side nav in an overlay. That is a user-visible behaviour change to 01a's approved spec, made because the design hand-off's frames show it.
    - AUTOBUILD puts "a fix that needs another module's spec to change" in Class C.
    - CLAUDE.md says "If code and spec disagree, STOP and ask" and "Any behaviour change goes spec-first".
    - The plan's "Done when" (render like `StaffPhoneList.html`) points at the design, but the plan ranks below the spec. The conflict had to be parked, not resolved in the plan's favour.
    - The menu, floor and station pages (01a views) are affected too, not only the 01b views.
  - **Failure scenario:** the 01a spec and the client now disagree on the phone shell. A later 01a re-review or T59's Playwright pass, if written from S50 a, fails or "fixes" it back. Any future reader of S50 a gets the wrong picture. On the phone, Sign out, which the tab bar's page reached before, is now two taps behind an overlay that no spec describes.
  - **Required fix:**
    - Park as P-n (task T50b): "01b design shows a Menu button with an overlay nav on phone; 01a S50 a says bottom tab bar". Options: (A) keep the tab bar (8 items plus Sign out at 390 px); (B) Menu button and overlay, with 01a S50 a amended by the human; (C) a tab bar for 4 items plus a "More" item.
    - Restore the S50 a phone tab bar (`TabBar` still exists in `components/SideNav.tsx:68`) until the human answers. The laptop nav changes (groups, counts, foot), which match S50 a's side menu, may stay.
    - Mark AD-31's phone part as superseded by P-n, and set the T51–T56 rows that depend on the phone shell to WAITING only if they need it.

## Should-fix

- **R-3 (Should-fix, T50b)**: `apps/client/src/features/owner/Shell.tsx:104-114`.
  - **Problem:** the phone nav overlay reuses `.pos-overlay`, the dialog backdrop, but none of the dialog behaviour that 01a test 161 requires of the kit's `Dialog`:
    - Escape does not close it;
    - Tab is not trapped, so the page behind stays reachable;
    - focus does not return to the Menu button;
    - it has no `role="dialog"` or `aria-modal`.
    
    `components/Dialog.tsx` already implements all of this. The fix is moot if R-2 is resolved with option A.
  - **Failure scenario:** a keyboard or screen-reader user on a tablet at ≤ 760 px opens the menu. Focus stays on the Menu button behind the overlay, Tab walks the hidden page, and Escape does nothing. The overlay can only be closed by tapping the backdrop.
  - **Required fix:** if the overlay stays (R-2 option B), build it on the existing `Dialog` component, or give it the same Escape, focus-trap and focus-return behaviour. Add a test for each.

## Nits (non-blocking)

- N-1 (T50b): `apps/client/src/features/owner/Shell.test.tsx`. The build log says this test was written after the change (no TDD), and its names cite `[01b §8]` with no test number. The plan gave this Claude-only task no test step, but the hard rule still applies.
- N-2 (T50b): the plan's "Done when" (render like `Main.html` at 1440 and `StaffPhoneList.html` at 390) was not checked. The build log defers it to T59, but the status row says DONE without noting this.
- N-3 (T46): `apps/cloud/test/cli/link-owner-staff.int.test.ts` #99 b says "the CLI holds the tenant lock having verified Y". The hook fires at `apps/cloud/src/cli/link-owner-staff.ts:42`, before the qualification check at `:87`. The outcome is the same because the lock serialises the two writers, but the test does not prove "having verified".
- N-4 (T47): `docs/runbooks/owner-password-reset.md:31,65`. Support pastes caller-supplied text into SQL by hand (`'<email>'`, `'<name on the tile>'`), on a host whose `DATABASE_URL` can write. Use `psql -v` with `:'email'` and `BEGIN READ ONLY`.
- N-5 (T50b): the production code no longer uses `TabBar`; only `kit.test.tsx` does. It is dead code, unless R-2 restores it.

## Checked and fine

- **Spec patch (previous R-1):** v1.0.1 changes only the text of #97, with the change-log line "auto-patch AD-25". The README version cell and AD-25 are updated. No other spec text changed.
- **T43:**
  - #74 c runs (a) and (b) with the reset CLI in-process, on the same clock and on clocks 5 minutes ahead and behind. The reset's `afterOwnerRowLock` is wired to the same pause as the API's.
  - (a): the refresh's access token → `401 JWT_INVALID`, and its successor → `401 REFRESH_TOKEN_INVALID`.
  - (b): the refresh → `401 REFRESH_TOKEN_INVALID`, with 1 token row (none issued).
  - #74 d covers both orders. When the reset goes first, the login → `401 LOGIN_INVALID` with no token row and a counter of 0, so an increment would be caught.
  - #74 e alternates the start order over 50 runs and asserts change → 200, refresh ∈ {200, 401 `REFRESH_TOKEN_INVALID`}, and no `40P01`.
  - Waiting is proven with `pg_stat_activity` lock waiters, which is safe because `fileParallelism: false`.
- **T44:** #98's three cases each run 50 times. Login ‖ login: both 200 and the counter goes 3 → 0. Refresh ‖ refresh with `lock_notice_at` set: exactly one `lockout_notice`, and the notice is cleared. Login ‖ refresh: both 200. Status 200 catches a deadlock even when the 500 body hides the code. The status row records the check with the lock changed to `FOR SHARE`. No change under `src/`.
- **T46:**
  - #95: a re-link X → Y writes exactly one audit row (`actor_kind 'cli'`, old and new `staff_id`, printed `link:` line), and Y then gets `OWN_ADMIN_ACCESS`. A re-link from a row that qualifies nowhere to a no-PIN Cook is refused, so there is no vacuous pass.
  - The no-PIN, `manage-devices` denial, `access-hub-admin` denial and leaver cases are all refused through `expectRefused`, which also checks no audit row and no bump.
  - #99 a and b use real barriers and lock waiters, with the PATCH's `afterTenantLock` test hook. (a) lists all three branches. (b) gives `409 OWN_ADMIN_ACCESS` after the link.
- **T50b (apart from R-2 and R-3):**
  - The laptop nav order, groups and counts follow README §9. The Branches count comes from data the API gave (`allowed.length`), so it respects S50 f.
  - The foot shows `display_name` as S50 a requires, and AD-31's no-e-mail call is correct.
  - Every nav link and Sign out go through the discard guard.
  - AD-30 (label copy) is a correct Class B: §8 fixes no `perm.<key>` text, and no spec-pinned copy changed. "Count stock and switch items off" matches 01a §6.18's `manage-stock` gate on `SetItemAvailability`.
  - The Urdu to-do list shrank to 16 keys, and the i18n test enforces it.
- Scope: no migrations, events, API contracts or error codes touched; no test skipped or weakened; no file outside the tasks.
