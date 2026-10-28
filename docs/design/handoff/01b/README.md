# 01b design handoff — owner app screens

Source: the approved "01b Screens" design canvas (119 artboards). Exported as static HTML so they open in any browser
and can be read as plain markup. Open `screens/index.html` to browse them all.

**These screens are the source of truth for layout, states and copy for tasks T50b–T56.** The spec still wins on
behaviour (which call, which error code, which rule). If a screen and the spec disagree on behaviour, follow the
spec and write the difference in the build log under "Design vs spec".

## Folder

| Path | What |
|---|---|
| `screens/*.html` | One file per screen state. Title of each is in the table below |
| `screens/ds/pos/tokens.css`, `tokens.json` | POS design tokens (colors light/dark, type, spacing, radius, touch sizes) |
| `screens/ds/pos/components/bundle.css` | Base POS components: `.pos-btn`, `.pos-field`, `.pos-banner`, `.pos-pin`, `.pos-dialog`, `.pos-staff`, … |
| `screens/ds/pos/fonts/*.woff2` | Atkinson Hyperlegible (+ Mono) and Noto Nastaliq Urdu. Bundled — the hub LAN has no internet |
| `screens/kit-additions.css` | The extra classes these 01b screens add on top of the kit (shell, side nav, lists, chips, tables, grant control, …) |

## How to integrate (rules for the implementer)

1. **Do not paste the HTML into the app.** Build real components in `apps/client` that produce the same DOM structure
   and class names as the screen. The screen markup is the reference for structure, classes, order and copy.
2. **CSS:** compare `tokens.css` and `components/bundle.css` with `packages/ui-kit`. If they match, use the kit. If the
   kit is missing tokens or classes, add them to `packages/ui-kit` (not to the client). Port only the classes from
   `kit-additions.css` that the task's screens actually use, into `packages/ui-kit`, keeping the class names.
3. **Every screen = a state.** For each screen listed under a task, the view must be able to show that state
   (loading, empty, error codes, stale/409 reload, offline, cloud down, saved, blocked dialogs, phone layout, Urdu RTL).
   The error codes in screen titles (`VALIDATION_FAILED`, `LAST_ADMIN_REQUIRED`, `OWN_ADMIN_ACCESS`, `ROLE_NOT_FOUND`,
   429, 422 …) say which API answer shows that state.
4. **Phone screens** (`*Phone*`) are the owner phone layout (390 wide). Same component, responsive — not a second app.
5. **Urdu (`*Urdu*`) screens hold the real Urdu copy.** Take Urdu strings for the i18n catalogue from these files,
   matched to the English string in the same position of the English screen. Fill `urdu-todo.md` from them; list
   any key that has no Urdu in the designs as still TODO.
6. **RTL:** the kit uses logical properties (`inline-start/end`). Set `dir="rtl"` and `lang="ur"` on the root for Urdu.
   Digits, PINs, codes, emails and ids stay LTR (`.pos-ltr`).
7. **Demo data** (Arif Chatkhara, Gulberg, Hamza, Imran, Oct dates, counts) is mock. Never hard-code it.
8. **Icons** are inline stroke SVGs in the screens. Make one small icon component and reuse the same paths.
9. **Side nav** (in every laptop screen): Menu · Floors and tables · Kitchen stations · *People:* Staff, Roles, Teams,
   Stock counting · *Branches:* Branches and settings · foot: owner email, Change password, Sign out. Counts show next
   to Staff, Roles, Branches. This is what T50b aligns the existing T50 shell to.

## Screen → task map

### T51 — Client staff views and PIN dialog (48 screens)

| Screen file | What it shows |
|---|---|
| `screens/Main.html` | 01b-S01 · Staff list — roles, branches, PIN state (laptop) |
| `screens/StaffEmpty.html` | 01b-S01 · Staff list — first run, 6 roles ready (laptop) |
| `screens/StaffLoading.html` | 01b-S01 · Staff list — loading (laptop) |
| `screens/StaffNoMatch.html` | 01b-S01 · Staff list — no match (laptop) |
| `screens/StaffLeft.html` | 01b-S01 · Staff list — people who left (laptop) |
| `screens/StaffBranchEmpty.html` | 01b-S01 · Staff list — branch filter with nobody (laptop) |
| `screens/StaffSaved.html` | 01b-B02 · Saved — reaches each branch in about a minute, one hub behind (laptop) |
| `screens/StaffMoved.html` | 01b-B04 · Hamza marked as left — people moved to a new lead (laptop) |
| `screens/StaffCloudDown.html` | 01b-S01 · Staff list — cloud can't be reached, actions off (laptop) |
| `screens/StaffPhone.html` | 01b-S01 · Rush: search “bil”, Reset PIN on the first match (owner phone) |
| `screens/StaffPhoneList.html` | 01b-S01 · Staff list (owner phone) |
| `screens/StaffUrdu.html` | 01b-S01 · Staff list — Urdu RTL (laptop) |
| `screens/StaffPhoneUrdu.html` | 01b-S01 · Staff list — Urdu RTL (owner phone) |
| `screens/StaffForm.html` | 01b-S02 · Edit Hamza — reports to (C03), floors (C04), what he can do (C02) (laptop) |
| `screens/StaffFormNew.html` | 01b-S02 · New waiter Ali R. — reports to Hamza, no floors needed (laptop) |
| `screens/StaffFormTwoBranches.html` | 01b-S02 · Works at two branches — one lead and floors per branch (laptop) |
| `screens/StaffFormImran.html` | 01b-S02 · Edit Imran — Manager + Shift lead, a refund blocked (laptop) |
| `screens/StaffFormRemoveBranch.html` | 01b-S02 · Removing a branch — what else goes with it (laptop) |
| `screens/StaffFormErrors.html` | 01b-S02 · VALIDATION_FAILED — name too long, no role, no branch (laptop) |
| `screens/StaffFormConflicts.html` | 01b-S02 · Name taken, reporting loop, floor archived (laptop) |
| `screens/StaffFormOwnAdmin.html` | 01b-S02 · OWN_ADMIN_ACCESS — can’t remove your own admin access (laptop) |
| `screens/StaffFormLastAdmin.html` | 01b-S02 · LAST_ADMIN_REQUIRED — names the branch (laptop) |
| `screens/StaffFormNotLinked.html` | 01b-S02 · Owner login not linked to a staff profile (laptop) |
| `screens/StaffFormStale.html` | 01b-B03 · Someone changed this since you opened it — Reload (laptop) |
| `screens/StaffFormOffline.html` | 01b-S02 · Can't save — no internet, form kept (laptop) |
| `screens/StaffFormTenant.html` | 01b-S02 · tenant_wide_write — no changes allowed for this restaurant (laptop) |
| `screens/StaffBringBack.html` | 01b-S02 · Bring back Kashif — his only role was archived, pick another (laptop) |
| `screens/StaffNotFound.html` | 01b-S02 · STAFF_NOT_FOUND (laptop) |
| `screens/StaffFormPhone.html` | 01b-S02 · Edit Hamza — one column, “What he can do” folded (owner phone) |
| `screens/StaffFormUrdu.html` | 01b-S02 · Edit Hamza — Urdu RTL (laptop) |
| `screens/PinDialog.html` | 01b-D01 · Set or reset PIN — typed twice (laptop) |
| `screens/PinMismatch.html` | 01b-D01 · PIN — the two PINs are different (laptop) |
| `screens/PinShort.html` | 01b-D01 · PIN — too short or not digits (laptop) |
| `screens/PinSaving.html` | 01b-D01 · PIN — saving (laptop) |
| `screens/PinSaved.html` | 01b-D01 · PIN saved — works at both branches in about a minute (laptop) |
| `screens/PinFirst.html` | 01b-D01 · First PIN — now on the sign-in screens (laptop) |
| `screens/PinOffline.html` | 01b-D01 · PIN — needs the internet, old PIN still works (laptop) |
| `screens/PinPersonLeft.html` | 01b-D01 · PIN — person was marked as left meanwhile (laptop) |
| `screens/PinPhone.html` | 01b-D01 · Hand the phone over — step 1, type a new PIN (owner phone) |
| `screens/PinPhoneRepeat.html` | 01b-D01 · Hand the phone over — step 2, type it again (owner phone) |
| `screens/PinPhoneMismatch.html` | 01b-D01 · Phone — the two PINs differ, start again (owner phone) |
| `screens/PinPhoneSaved.html` | 01b-D01 · Phone — saved, give the phone back (owner phone) |
| `screens/PinPhoneOffline.html` | 01b-D01 · Phone — no internet, old PIN still works (owner phone) |
| `screens/PinPhoneUrdu.html` | 01b-D01 · Hand the phone over — Urdu RTL (owner phone) |
| `screens/LeftDialog.html` | 01b-D02 · Mark Hamza as left — who moves to which lead (laptop) |
| `screens/LeftBlockedOwner.html` | 01b-D02 · Blocked — profile linked to the owner login (laptop) |
| `screens/LeftBlockedAdmin.html` | 01b-D02 · Blocked — Johar Town would have no admin (laptop) |
| `screens/LeftOffline.html` | 01b-D02 · Mark as left — no internet, nothing changed (laptop) |

### T52 — Client roles views (24 screens)

| Screen file | What it shows |
|---|---|
| `screens/Roles.html` | 01b-S03 · Roles — 6 defaults + Shift lead, idle sign-out per role (S08) (laptop) |
| `screens/RolesIdle.html` | 01b-S08 · Idle minutes saved on leaving the box — saving, saved, out of range, not saved (laptop) |
| `screens/RolesStale.html` | 01b-B03 · Idle row — someone changed Cashier meanwhile (laptop) |
| `screens/RolesArchived.html` | 01b-S03a · Archived roles — Restore (laptop) |
| `screens/RolesArchivedEmpty.html` | 01b-S03a · Archived roles — none (laptop) |
| `screens/RolesRestoreTaken.html` | 01b-S03a · Restore — name taken by an active role (laptop) |
| `screens/RolesCloudDown.html` | 01b-S03 · Roles — cloud can't be reached, edits off (laptop) |
| `screens/RolesPhone.html` | 01b-S03 · Roles (owner phone) |
| `screens/RolesUrdu.html` | 01b-S03 · Roles — Urdu RTL (laptop) |
| `screens/RoleEditor.html` | 01b-S04 · Role editor — Shift lead, 20 permissions, grant control C01 (laptop) |
| `screens/RoleEditorNew.html` | 01b-S04 · New role — everything Not allowed to start (laptop) |
| `screens/RoleEditorErrors.html` | 01b-S04 · Name taken, no approver, idle out of range (laptop) |
| `screens/RoleEditorOwnAdmin.html` | 01b-S04 · Owner role — “Open hub admin” snaps back, own access (laptop) |
| `screens/RoleEditorLastAdmin.html` | 01b-S04 · Manager role — turning off “Pair and remove screens” is blocked, names Johar Town (laptop) |
| `screens/RoleEditorStale.html` | 01b-B03 · Role editor — someone changed this role (laptop) |
| `screens/RoleNotFound.html` | 01b-S04 · ROLE_NOT_FOUND (laptop) |
| `screens/RoleEditorPhone.html` | 01b-S04 · Role editor — one permission per row, stacked (owner phone) |
| `screens/RoleEditorUrdu.html` | 01b-S04 · Role editor — Urdu RTL (laptop) |
| `screens/GrantControl.html` | 01b-C01 · Grant control — every combination (component sheet) |
| `screens/RoleArchiveConfirm.html` | 01b-D03 · Archive Shift lead — who keeps what (laptop) |
| `screens/RoleArchiveInUseStaff.html` | 01b-D03 · Blocked — someone would have no role left (laptop) |
| `screens/RoleArchiveInUseRole.html` | 01b-D03 · Blocked — this role approves for other roles (laptop) |
| `screens/RoleArchiveLastAdmin.html` | 01b-D03 · Blocked — last admin at Johar Town (laptop) |
| `screens/RoleArchiveOwnAdmin.html` | 01b-D03 · Blocked — your own admin access (laptop) |

### T53 — Client teams and stock-counting views (15 screens)

| Screen file | What it shows |
|---|---|
| `screens/Teams.html` | 01b-S10 · Teams — Gulberg team tree, read-only (laptop) |
| `screens/TeamsFlat.html` | 01b-S10 · Teams — no reporting lines yet at Johar Town (laptop) |
| `screens/TeamsEmpty.html` | 01b-S10 · Teams — nobody works at DHA (laptop) |
| `screens/TeamsCloudDown.html` | 01b-S10 · Teams — cloud can't be reached, last loaded tree (laptop) |
| `screens/TeamsPhone.html` | 01b-S10 · Teams (owner phone) |
| `screens/TeamsUrdu.html` | 01b-S10 · Teams — Urdu RTL (laptop) |
| `screens/Responsibilities.html` | 01b-S05 · Stock counting — who counts each Gulberg station (laptop) |
| `screens/ResponsibilitiesPicker.html` | 01b-S05 · Change — pick people and roles for a station (laptop) |
| `screens/ResponsibilitiesUnsaved.html` | 01b-S05 · Changed — Save sends the whole Gulberg set (laptop) |
| `screens/ResponsibilitiesSaved.html` | 01b-B02 · Stock counting saved (laptop) |
| `screens/ResponsibilitiesStale.html` | 01b-B03 · Stock counting — someone changed it (laptop) |
| `screens/ResponsibilitiesChanged.html` | 01b-S05 · 422 — a person, role or station changed meanwhile (laptop) |
| `screens/ResponsibilitiesNoStations.html` | 01b-S05 · Branch with no stations yet (laptop) |
| `screens/ResponsibilitiesPhone.html` | 01b-S05 · Stock counting (owner phone) |
| `screens/ResponsibilitiesUrdu.html` | 01b-S05 · Stock counting — Urdu RTL (laptop) |

### T54 — Client branches and settings views (14 screens)

| Screen file | What it shows |
|---|---|
| `screens/Branches.html` | 01b-S06 · Branches — healthy, hub not taking changes, no hub yet (laptop) |
| `screens/BranchesAway.html` | 01b-S06 · Branches — Johar Town hub not checking in (laptop) |
| `screens/BranchRename.html` | 01b-D04 · Rename a branch (laptop) |
| `screens/BranchRenameTaken.html` | 01b-D04 · Rename — name taken (laptop) |
| `screens/BranchRenamed.html` | 01b-D04 · Renamed (laptop) |
| `screens/BranchesPhone.html` | 01b-S06 · Branches (owner phone) |
| `screens/BranchesUrdu.html` | 01b-S06 · Branches — Urdu RTL (laptop) |
| `screens/BranchSettings.html` | 01b-S07 · Branch settings — Gulberg, tax off by default (laptop) |
| `screens/BranchSettingsRange.html` | 01b-S07 · Branch settings — value out of range (laptop) |
| `screens/BranchSettingsGap.html` | 01b-S07 · Branch settings — start-day gap not less than stale hours (laptop) |
| `screens/BranchSettingsSaved.html` | 01b-S07 · Branch settings — saved (laptop) |
| `screens/BranchSettingsPhone.html` | 01b-S07 · Branch settings (owner phone) |
| `screens/BranchSettingsUrdu.html` | 01b-S07 · Branch settings — Urdu RTL (laptop) |
| `screens/BranchPickerNamed.html` | 01a-S02 · Branch picker with branch names (laptop) |

### T55 — Client change password, lockout banner, support number (14 screens)

| Screen file | What it shows |
|---|---|
| `screens/OwnerLockNotice.html` | 01b-B01 · Owner lock notice — once, after the next sign-in (laptop) |
| `screens/StaffPhoneLock.html` | 01b-B01 · Lock notice on the phone (owner phone) |
| `screens/RolesLock.html` | 01b-B01 · Lock notice on any page — here on Roles, after a session refresh (laptop) |
| `screens/Password.html` | 01b-S09 · Change password — from the side nav (laptop) |
| `screens/PasswordErrors.html` | 01b-S09 · Wrong current password, too short, not the same (laptop) |
| `screens/PasswordUnchanged.html` | 01b-S09 · PASSWORD_UNCHANGED (laptop) |
| `screens/PasswordTooMany.html` | 01b-S09 · 429 — too many tries (laptop) |
| `screens/PasswordOffline.html` | 01b-S09 · Cloud can't be reached — nothing changed (laptop) |
| `screens/PasswordSaved.html` | 01b-S09 · Password changed (laptop) |
| `screens/PasswordForced.html` | 01b-B05 · Forced change after a support reset — no side nav (laptop) |
| `screens/PasswordForcedPhone.html` | 01b-B05 · Forced change (owner phone) |
| `screens/PasswordPhone.html` | 01b-S09 · Change password (owner phone) |
| `screens/PasswordUrdu.html` | 01b-S09 · Change password — Urdu RTL (laptop) |
| `screens/SupportTexts.html` | 01b · Support texts — with and without a support number (component sheet) |

### T56 — Client stock page under `my_stations` (01a hub screens) (4 screens)

| Screen file | What it shows |
|---|---|
| `screens/StockCounter.html` | 01a-S11 · Hub stock page — Usman counts only his stations, no Start/Close day (tablet) |
| `screens/StockCounterNotStarted.html` | 01a-S11 · Stock page — day not started, counter can’t start it (tablet) |
| `screens/StockCounterOutside.html` | 01a-S11 · Stock page — change outside your stations refused, 403 outside_scope (tablet) |
| `screens/StockRosterCounts.html` | 01a-S10 · Stock sign-in — “Counts stock” under the name (tablet) |