# 01b · Staff and Roles — Brief

Sources used: spec `docs/specs/01b_Staff_Roles_Spec_v1.2.md` (APPROVED), design hand-off `docs/design/handoff/01b/` (`README.md`, 119 screens in `screens/*.html`, `urdu-todo.md`), inventory `docs/design/inventory/01b-staff-roles.md`, open questions `docs/design/open-questions/01b-staff-roles.md`. Frame file names below are in `docs/design/handoff/01b/screens/`. The four 01b frames that change 01a's hub stock page (`StockCounter*`, `StockRosterCounts`) and `BranchPickerNamed` are covered in the 01a brief.

Sample data (mock, never hard-code): Arif Chatkhara; branches Gulberg (`…P0AB`), Johar Town (`…M6PQ`), DHA (`…T4KD`, not open yet); staff Arif (Owner), Imran (Manager + Shift lead, Gulberg), Kamran (Manager, Johar Town), Sana (Cashier, Johar Town), Hamza (Order taker + Shift lead, Gulberg + Johar Town), Bilal, Ali R., Zubair (Waiter, Gulberg), Usman (Cook, no PIN); left: Kashif (Runner), Naveed (Cook), Faisal (Cashier); owner email `arif@arifchatkhara.pk`.

---

## 1. Module summary

**What it is for.** 01b is where the owner manages people: who works at which branch, what each role may do, PINs, who reports to whom, who counts stock at each station, branch names and settings, and the owner's own password. Everything is edited in the cloud owner app and reaches each branch hub on its next check (about a minute). It also guards against locking a branch or the owner out of the hub admin.

**Who uses it, where, how often**

| Who | Device | How often |
|---|---|---|
| Owner (the only cloud login in P1; covers every branch) | Laptop 1440; owner phone 390 | Setup: ~25 staff, 6 default roles (once). Then a new person or a leaver weekly; PIN resets a few times a week, often during the rush on the phone |
| Staff member | Types their own new PIN on the owner's phone (hand-over) | When a PIN is set or reset |
| Support (phone call) | No screen | Rare: resets the owner password, links the owner login to a staff profile |
| Stock counter | Hub stock page (01a-S10, 01a-S11) | Daily (see 01a brief) |

**Rules that apply everywhere**
- **Owner only.** No read-only view, no manager login in P1.
- **Every write needs the internet.** On a network error or `503 SERVICE_UNAVAILABLE`: the cloud-unreachable banner (01a-B04, "Can't reach the restaurant cloud — retrying…"), page kept, write actions off; never go to sign-in on a 503. The app never re-sends a failed write by itself; the owner taps Try again.
- **Changes reach a branch on its next hub check (about a minute).** After every staff, role, stock-counting or branch-settings save, show 01b-B02.
- **Edit forms carry a version.** Staff, role and stock-counting saves send `expected_version`; `409 CONFIG_STALE` → 01b-B03 (Reload, nothing of the stale form kept). The owner's own earlier action never makes the next save stale (client updates versions from every response, including `changed_versions`).
- **Role names carry no behaviour.** Nothing shows, hides or changes because a role is called "Waiter" or "Owner".
- **Never show a permission key.** Always the plain label.
- **Signed out elsewhere.** `401 JWT_INVALID` after a failed refresh → owner sign-in page (01a-S01), no special message.
- **Forced password change.** While `must_change_password` is set, every owner route answers `403 PASSWORD_CHANGE_REQUIRED` → 01b-S09 in forced mode; every other page redirects there.
- **Support number.** Every support text ends "Call support." with no number, unless the build value `VITE_SUPPORT_PHONE` is set; then " on {phone}" is added before the full stop (both variants in `SupportTexts.html`).
- **Hand-edited owner record.** Every write → `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` → danger banner "You can't make changes for this restaurant." / "Call support. Nothing was saved. You can still look." Reads still work.
- **Language.** English and Urdu (RTL), every page at 1440 and 390. Digits, PINs, codes, emails and IDs stay LTR. Missing Urdu is listed in `docs/design/handoff/01b/urdu-todo.md`.
- **Branch scoping.** Staff can work at several branches; "Reports to" and "Floors they work on" are per branch; Stock counting, Teams and Branch settings are per branch (branch select, remembered per tab).
- **Never shown or logged:** PINs, PIN hashes, passwords.

**Shell (side nav, every laptop page):** brand "Arif Chatkhara / Restaurant setup"; Menu · Floors and tables · Kitchen stations (01a); **People:** Staff ({n}) · Roles ({n}) · Teams · Stock counting; **Branches:** Branches and settings ({n}); foot: owner email (as built: `display_name`) · Change password · Sign out. Urdu nav: "عارف چٹخارہ" · "ریسٹورنٹ سیٹ اپ" · "مینیو" · "فلور اور میزیں" · "کچن اسٹیشن" · "لوگ" · "اسٹاف" · "رولز" · "ٹیمیں" · "اسٹاک کی گنتی" · "برانچیں" · "برانچیں اور سیٹنگ" · "پاس ورڈ بدلیں" · "سائن آؤٹ". Phone: Menu button opening the side menu as an overlay (01a v1.3.1).

**Links to other modules**

| From | To | Why |
|---|---|---|
| 01b-S01/S02 staff (PIN set, left) | 02-S01 tablet sign-in tiles; 00-S03/S07 admin rosters | People without a PIN never appear; leavers disappear |
| 01b-D02 Mark as left | 00-S16 devices list | Leaver's phone shows "Removed" |
| 01b-S03/S04 idle minutes | 02 staff sessions | Idle sign-out per role |
| 01b-S04 permissions | every hub screen (show / hide / "needs approval") | Effective permissions |
| 01b-S05 Stock counting | 01a-S10 ("Counts stock"), 01a-S11 (my stations only) | Responsibilities |
| 01b-S06 Branches | 01a-S02 branch picker names | Branch names |
| 01b-S07 Branch settings | 01a-S11 (stale-day, start-day gap), 05 billing (tax) | Settings |
| 01b-S02 Floors they work on | 01a-S03 floors | Floor list per branch |
| 01b-S05 "Open Kitchen stations" | 01a-S04 | Branch with no stations |
| 01b-S09 / B01 / B05 | 01a-S01 owner sign-in | Lock notice and forced change after sign-in |
| 01b-B04 "See team" | 01b-S10 | — |

---

## 2. Screen list

| Screen ID | Name | Device | Who uses it | How often | Used during rush? | Existing frame file name(s) |
|---|---|---|---|---|---|---|
| 01b-S01 | Staff list | Laptop 1440, phone 390 | Owner | Weekly (PIN resets several times a week) | yes (phone) | `Main.html`, `StaffEmpty`, `StaffLoading`, `StaffNoMatch`, `StaffLeft`, `StaffBranchEmpty`, `StaffCloudDown`, `StaffPhone`, `StaffPhoneList`, `StaffUrdu`, `StaffPhoneUrdu` |
| 01b-S02 | Staff form (new / edit) | Laptop 1440, phone 390 | Owner | Weekly | no | `StaffForm`, `StaffFormNew`, `StaffFormTwoBranches`, `StaffFormImran`, `StaffFormRemoveBranch`, `StaffFormErrors`, `StaffFormConflicts`, `StaffFormOwnAdmin`, `StaffFormLastAdmin`, `StaffFormNotLinked`, `StaffFormStale`, `StaffFormOffline`, `StaffFormTenant`, `StaffBringBack`, `StaffNotFound`, `StaffFormPhone`, `StaffFormUrdu` |
| 01b-C02 | What {name} can do (panel) | Laptop 1440 (folded on phone) | Owner | Weekly | no | in `StaffForm*` frames |
| 01b-C03 | Reports to (per branch) | Laptop 1440 | Owner | Weekly | no | `StaffForm`, `StaffFormNew`, `StaffFormTwoBranches`, `StaffFormConflicts` |
| 01b-C04 | Floors they work on (per branch) | Laptop 1440 | Owner | Rare | no | `StaffForm`, `StaffFormTwoBranches`, `StaffFormConflicts` |
| 01b-D01 | Set / reset PIN | Laptop dialog, phone full screen | Owner + staff member | A few times a week | yes | `PinDialog`, `PinMismatch`, `PinShort`, `PinSaving`, `PinSaved`, `PinFirst`, `PinOffline`, `PinPersonLeft`, `PinPhone`, `PinPhoneRepeat`, `PinPhoneMismatch`, `PinPhoneSaved`, `PinPhoneOffline`, `PinPhoneUrdu` |
| 01b-D02 | Mark as left | Laptop dialog | Owner | Weekly | no | `LeftDialog`, `LeftBlockedOwner`, `LeftBlockedAdmin`, `LeftOffline` |
| 01b-S03 | Roles list | Laptop 1440, phone 390 | Owner | Rare | no | `Roles`, `RolesCloudDown`, `RolesPhone`, `RolesUrdu`, `RolesLock` |
| 01b-S03a | Archived roles | Laptop 1440 | Owner | Rare | no | `RolesArchived`, `RolesArchivedEmpty`, `RolesRestoreTaken` |
| 01b-S04 | Role editor | Laptop 1440, phone 390 | Owner | Rare | no | `RoleEditor`, `RoleEditorNew`, `RoleEditorErrors`, `RoleEditorOwnAdmin`, `RoleEditorLastAdmin`, `RoleEditorStale`, `RoleNotFound`, `RoleEditorPhone`, `RoleEditorUrdu` |
| 01b-C01 | Grant control | Laptop 1440, phone 390 | Owner | Rare | no | `GrantControl` (component sheet) |
| 01b-D03 | Archive role (confirm / blocked) | Laptop dialog | Owner | Rare | no | `RoleArchiveConfirm`, `RoleArchiveInUseStaff`, `RoleArchiveInUseRole`, `RoleArchiveLastAdmin`, `RoleArchiveOwnAdmin` |
| 01b-S05 | Stock counting | Laptop 1440, phone 390 | Owner | Rare | no | `Responsibilities`, `ResponsibilitiesPicker`, `ResponsibilitiesUnsaved`, `ResponsibilitiesSaved`, `ResponsibilitiesStale`, `ResponsibilitiesChanged`, `ResponsibilitiesNoStations`, `ResponsibilitiesPhone`, `ResponsibilitiesUrdu` |
| 01b-S06 | Branches | Laptop 1440, phone 390 | Owner | Weekly (glance) | no | `Branches`, `BranchesAway`, `BranchesPhone`, `BranchesUrdu` |
| 01b-D04 | Rename branch | Laptop dialog | Owner | Rare | no | `BranchRename`, `BranchRenameTaken`, `BranchRenamed` |
| 01b-S07 | Branch settings | Laptop 1440, phone 390 | Owner | Rare | no | `BranchSettings`, `BranchSettingsRange`, `BranchSettingsGap`, `BranchSettingsSaved`, `BranchSettingsPhone`, `BranchSettingsUrdu` |
| 01b-S08 | Idle limits (column in S03, field in S04) | Laptop 1440 | Owner | Rare | no | `RolesIdle`, `RolesStale` (+ S04 frames) |
| 01b-S09 | Change password (normal / forced) | Laptop 1440, phone 390 | Owner | Rare | no | `Password`, `PasswordErrors`, `PasswordUnchanged`, `PasswordTooMany`, `PasswordOffline`, `PasswordSaved`, `PasswordForced`, `PasswordForcedPhone`, `PasswordPhone`, `PasswordUrdu` |
| 01b-S10 | Teams (team tree) | Laptop 1440, phone 390 | Owner | Rare | no | `Teams`, `TeamsFlat`, `TeamsEmpty`, `TeamsCloudDown`, `TeamsPhone`, `TeamsUrdu` |
| 01b-B01 | Owner lockout notice | Any owner page, laptop and phone | Owner | Rare | no | `OwnerLockNotice`, `StaffPhoneLock`, `RolesLock` |
| 01b-B02 | Saved — reaches each branch | Any edit page | Owner | Weekly | no | `StaffSaved`, `ResponsibilitiesSaved`, `BranchSettingsSaved` |
| 01b-B03 | Someone changed this — Reload | S02, S03 row, S04, S05 | Owner | Rare | no | `StaffFormStale`, `RolesStale`, `RoleEditorStale`, `ResponsibilitiesStale` |
| 01b-B04 | People moved to a new lead | S01 after a save | Owner | Rare | no | `StaffMoved` |
| 01b-B05 | Must change password (forced) | S09 | Owner | Rare | no | `PasswordForced`, `PasswordForcedPhone` |

---

## 3. Screens

### 01b-S01 · Staff list
- **Job:** find a person fast; see their roles, branches and PIN state; reset a PIN.
- **Entry points:** side nav "Staff" (`#/staff`); after any staff save.
- **Exits:** **Add staff** → 01b-S02 new; **Edit** / name → 01b-S02 edit; **Reset PIN** / **Set PIN** → 01b-D01.
- **Information shown:**

| Item | Mark |
|---|---|
| App bar "Staff" | USEFUL |
| Column heads Name · Roles · Works at · PIN | USEFUL |
| Name | MUST |
| Role chips ("Manager", "Shift lead") | MUST |
| Works at ("Gulberg, Johar Town") | USEFUL |
| PIN chip: ok "Set" + "Since {date}" / warn "Not set" + help "Not on sign-in screens until a PIN is set." / info "Left {date}" | MUST |
| Segmented counts "Working here {n}" · "Left {n}" | USEFUL |
| Phone row: "{name}" + "{roles} · {branches}" | MUST |

- **Actions:**

| Action | Mark | Result |
|---|---|---|
| **Add staff** (phone: **Add**) | PRIMARY | 01b-S02 new |
| **Reset PIN** / **Set PIN** (row) | SECONDARY (phone: primary on the first match while searching) | 01b-D01 |
| **Edit** (row) | SECONDARY | 01b-S02 |
| Search "Find a name" (client-side) | SECONDARY | filter |
| Branch select "All branches" / each branch | SECONDARY | `branch_id` filter |
| Working here / Left segmented | RARE | `status=active\|left` |

- **Inputs:** search text (default empty); branch select (default All branches); status (default Working here).
- **Decisions:** which person.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | loaded | list | as above | `Main.html` |
| Loading | fetching | skeleton rows under heads | — | `StaffLoading` |
| First run | no staff | empty block | "Add your first staff member" / "Each person gets a name on the sign-in screen, one or more roles, the branches they work at, and a PIN." / "Add staff" / "6 roles are ready: Owner, Manager, Cashier, Order taker, Waiter, Cook. You can change them in Roles." | `StaffEmpty` |
| No match | search finds nobody | empty block | "No one called "{q}"" / "Check the spelling, or look under Left." / "Clear search" / "Show people who left" | `StaffNoMatch` |
| Left view | Left selected | muted rows, "Left {date}", no PIN action; note | "Left 12 Oct" / "People who left keep their name in old orders and the audit log. Edit one to bring them back." | `StaffLeft` |
| Branch with nobody | branch filter empty | empty block | "Nobody works at {branch} yet." / "Add someone, or give an existing person {branch} under "Works at"." / "Add staff" | `StaffBranchEmpty` |
| Saved | after a save | 01b-B02 | see B02 | `StaffSaved` |
| People moved | `moved_reports` not empty | 01b-B04 | see B04 | `StaffMoved` |
| Cloud down | network / 503 | warn banner; list as last loaded; Add / Reset PIN / Edit disabled | "Can't reach the restaurant cloud — retrying…" / "Showing the list from {time}. PINs and changes need the internet." | `StaffCloudDown` |
| Lock notice | `lockout_notice` | 01b-B01 on top | see B01 | `OwnerLockNotice` |
| Phone list | width 390 | stacked rows with Reset PIN beside each | "Staff" / "Add" / "Find a name" / "Working here 9" / "Left 3" / "Reset PIN" | `StaffPhoneList` |
| Phone rush search | typing "bil" | matching rows; Reset PIN | "Bilal" "Waiter · Gulberg" "Reset PIN" / "Bilal A." "Cook · Johar Town" | `StaffPhone` |
| Urdu RTL (laptop) | Urdu | mirrored | "اسٹاف" / "اسٹاف شامل کریں" / "نام تلاش کریں" / "سب برانچیں" / "یہاں کام کر رہے" / "چھوڑ گئے" / heads "نام" · "رولز" · "کہاں کام کرتے ہیں" · "پن" / roles "مالک" "مینیجر" "شفٹ لیڈ" "کیشیئر" "آرڈر لینے والا" "ویٹر" "باورچی" / "سیٹ ہے" / "از 3 Oct" / "پن بدلیں" / "ترمیم" / "سیٹ نہیں" / "پن سیٹ ہونے تک سائن اِن اسکرین پر نہیں۔" / "پن سیٹ کریں" | `StaffUrdu` |
| Urdu RTL (phone) | Urdu | mirrored | "اسٹاف" / "شامل کریں" / "نام تلاش کریں" / "یہاں کام کر رہے" / "چھوڑ گئے" / "پن بدلیں" | `StaffPhoneUrdu` |

- **Error codes:** `SERVICE_UNAVAILABLE`, `JWT_INVALID`, `PASSWORD_CHANGE_REQUIRED`.
- **Edge cases:** up to ~500 people, no pagination; client-side search; rush flow on phone ≤ 8 taps + 8 digits; a person with no PIN is not sent to any hub.
- **Data needed:** `GET /v1/admin/staff?status=active|left&branch_id?` → `staff_id, display_name, role_ids, branch_ids, denied_permissions, has_pin, pin_set_at, is_active, left_at, reports_to[], floors[], version`; role names from `GET /v1/admin/roles`; branch names from `GET /v1/admin/branches`.

### 01b-S02 · Staff form (new / edit)
- **Job:** add a person or change their roles, branches, lead, floors, blocks and status.
- **Entry points:** **Add staff** / **Edit** on 01b-S01; name on 01b-S10; "Open {name}" in 01b-D03.
- **Exits:** Save / Add staff → 01b-S01 + B02 (+ B04); "They are next to me" checked → straight into 01b-D01 (proposed); **Reset PIN** → 01b-D01; **Mark as left** → 01b-D02; Cancel → 01b-S01.
- **Information shown:**

| Item | Mark |
|---|---|
| App bar: back "Staff", title "New staff member" / "Edit {name}" | MUST |
| Section help texts (see Inputs) | USEFUL |
| PIN section text: new "Set it after saving, or now if they are next to you."; edit "Set on {date}. Resetting signs them out everywhere."; no PIN "No PIN yet. They don't appear on sign-in screens until one is set." (proposed, no frame) | USEFUL |
| Never allow: "Block one thing for this person even if a role allows it." + list ("Give a refund" / "Never allowed, whatever the roles say") or "Nothing blocked." | RARE |
| Status: "Working here. Can sign in at their branches." / "Left on {date}. Can't sign in anywhere. Bringing back keeps the PIN; old reporting lines and stock counting don't come back." | USEFUL |
| Branch-removal warning: "Removing {branch} also removes {name}'s lead, floors and stock counting there. {person}, who reports to him at {branch}, will report to nobody." | MUST when shown |
| 01b-C02 panel (end column) | USEFUL |

- **Actions:**

| Action | Mark | Result |
|---|---|---|
| **Add staff** (new) / **Save** (edit) / **Bring back** (left person) | PRIMARY | `POST /v1/admin/staff` (Idempotency-Key) / `PATCH /v1/admin/staff/:id { expected_version, changed fields }` |
| **Cancel** | SECONDARY | 01b-S01 |
| **Reset PIN** / **Set PIN** | SECONDARY | 01b-D01 |
| Never allow **Add** (permission picker) / **Remove** | RARE | edits `denied_permissions` |
| **Mark as left** | DESTRUCTIVE | 01b-D02 |
| "Set the PIN right after adding — They are next to me" (new only) | SECONDARY | opens D01 after Add |

- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Name on the sign-in screen (`display_name`); help "Short and clear: it shows on tablets and phones. Up to 40 letters." | text | empty | 1–40, trimmed; unique among active staff at each branch, case-insensitive | "Up to 40 letters"; `STAFF_NAME_TAKEN` → "Another {name} works at {branch}. Add a letter, e.g. {name} R. or {name} K." |
| Roles (`role_ids[]`); help "Pick one or more. What each role may do is set in Roles." | chip toggles (Owner, Manager, Cashier, Order taker, Waiter, Cook, Shift lead …) | none | ≥ 1, active roles | "Pick at least one role"; `role_archived` → "{role} was archived. Pick another role to bring {name} back." (frame); `not_found` → "This role no longer exists. Reload the page." (proposed) |
| Works at (`branch_ids[]`); help "Their name shows on sign-in screens at these branches only." | branch chip toggles ("DHA (not open yet)") | the branch filtered on S01, if any | ≥ 1 | "Pick at least one branch"; `BRANCH_NOT_FOUND` → "A branch is no longer available. Reload." (proposed) |
| Reports to (C03) | see 01b-C03 | Nobody | see C03 | see C03 |
| Floors they work on (C04) | see 01b-C04 | none | see C04 | see C04 |
| Never allow (`denied_permissions[]`) | permission picker (plain labels) | nothing blocked | catalogue permissions | — |
| Status (`is_active`) | via Mark as left / Bring back | working | — | — |

- **Decisions:** roles; branches; lead per branch; floors; blocked permissions; whether to set the PIN now.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Edit (default) | Edit | full form + C02 | "Edit Hamza" / "Cancel" / "Save" / "Who" / "Name on the sign-in screen" / "Roles" / "Works at" / "Reports to" / "Floors they work on" / "PIN" / "Never allow (owner only)" / "Status" / "Mark as left" | `StaffForm` |
| New | Add staff | empty form; PIN option | "New staff member" / "Add staff" / "Set it after saving, or now if they are next to you." / "Set the PIN right after adding" / "They are next to me" | `StaffFormNew` |
| Two branches | two branches picked | one Reports to and one floor group per branch | "At Gulberg" "Imran" / "At Johar Town" "Kamran" / floors "Main hall" "Upstairs" | `StaffFormTwoBranches` |
| With a block | `denied_permissions` | Never allow list + C02 "Never" | "Give a refund" / "Never allowed, whatever the roles say" / "Remove" | `StaffFormImran` |
| Removing a branch | branch chip turned off | warn line under Works at | "Removing Johar Town also removes Hamza's lead, floors and stock counting there. Sana, who reports to him at Johar Town, will report to nobody." | `StaffFormRemoveBranch` |
| Validation errors | `VALIDATION_FAILED` / client | top banner + field errors | "3 things to fix" / "Name · Roles · Works at" / "Up to 40 letters" / "Pick at least one role" / "Pick at least one branch" / Reports to: "Pick a branch under "Works at" first." | `StaffFormErrors` |
| Conflicts | `STAFF_NAME_TAKEN`, `loop`, floor `archived`/`wrong_branch` | banner + field errors | "3 things to fix" / "Name · Reports to · Floors" / "Another Ali works at Gulberg. Add a letter, e.g. Ali R. or Ali K." / "Hamza already reports to Ali at Gulberg. Pick someone else." / "A floor was archived or moved. Reload and pick again." | `StaffFormConflicts` |
| Lead not at branch | `not_at_branch` | Reports to error | "{lead} doesn't work at {branch} any more. Pick someone else." (proposed) | none |
| Own admin access | `OWN_ADMIN_ACCESS` | banner "1 thing to fix · Roles" + Roles error | "You can't remove your own admin access. Call support." | `StaffFormOwnAdmin` |
| Owner not linked | `OWN_ADMIN_ACCESS { reason: 'owner_not_linked' }` | danger banner | "Your owner login isn't linked to your staff profile yet, so admin access can't be removed." / "Call support to link it." | `StaffFormNotLinked` |
| Last admin | `LAST_ADMIN_REQUIRED` | Roles error naming branches | "Johar Town would have nobody who can open the hub admin and pair screens. Give someone else admin access there first." | `StaffFormLastAdmin` |
| Stale | `CONFIG_STALE` | 01b-B03 | see B03 | `StaffFormStale` |
| Offline | network / 503 | warn banner; form kept; Save enabled again | "Can't reach the restaurant cloud — retrying…" / "Nothing was saved. Try again when you are online." | `StaffFormOffline` |
| Tenant write blocked | `PERMISSION_DENIED { tenant_wide_write }` | danger banner | "You can't make changes for this restaurant." / "Call support. Nothing was saved. You can still look." | `StaffFormTenant` |
| Bring back (role archived) | Bring back + `role_archived` | banner "1 thing to fix · Roles"; Roles error | "Runner was archived. Pick another role to bring Kashif back." / "Bring back" | `StaffBringBack` |
| Not found | `STAFF_NOT_FOUND` | full-page state | "Staff member" / "This person can't be found" / "They may have been removed." / "Back to Staff" | `StaffNotFound` |
| Idempotency mismatch | `IDEMPOTENCY_KEY_MISMATCH` | banner | "Something went wrong. Try again." (proposed) | none |
| Phone | width 390 | one column; C02 folded at top ("What Hamza can do · 5 allowed"); Cancel/Save in bottom bar | as frame | `StaffFormPhone` |
| Urdu RTL | Urdu | mirrored | see below | `StaffFormUrdu` |

  Urdu copy (from `StaffFormUrdu`): "حمزہ میں ترمیم" / "منسوخ" / "محفوظ کریں" / "کون" / "سائن اِن اسکرین پر نام" / "مختصر اور واضح: یہ ٹیبلٹ اور فون پر دکھتا ہے۔ زیادہ سے زیادہ 40 حروف۔" / "رولز" / "ایک یا زیادہ چنیں۔ ہر رول کیا کر سکتا ہے، یہ رولز میں طے ہے۔" / "کہاں کام کرتے ہیں" / "ڈی ایچ اے (ابھی نہیں کھلی)" / "ان کا نام صرف ان برانچوں کی سائن اِن اسکرین پر دکھے گا۔" / "کس کو رپورٹ کرتے ہیں" / "ہر برانچ میں یہ کس کو رپورٹ کرتے ہیں۔ رپورٹنگ لائن سے کوئی اضافی اجازت نہیں ملتی۔" / "گلبرگ میں" / "کن فلور پر کام کرتے ہیں" / "اس لیے دکھ رہا ہے کہ شفٹ لیڈ "ان کے فلور" استعمال کرتا ہے۔ رول طے کرتا ہے کیا کر سکتے ہیں؛ یہ طے کرتا ہے کن فلور پر۔" / floors "گراؤنڈ فلور" "فیملی ہال" "چھت" / "پن" / "3 اکتوبر کو سیٹ ہوا۔ بدلنے سے وہ ہر جگہ سے سائن آؤٹ ہو جائیں گے۔" / "پن بدلیں" / "کبھی اجازت نہیں (صرف مالک)" / "کسی ایک کام کو اس شخص کے لیے بند کریں چاہے رول اجازت دے۔" / "شامل کریں" / "کچھ بند نہیں۔" / "حالت" / "یہاں کام کر رہے ہیں۔ اپنی برانچوں میں سائن اِن کر سکتے ہیں۔" / "چھوڑ گئے" (Mark as left). Error states: no Urdu.
- **Error codes:** `VALIDATION_FAILED`, `STAFF_NAME_TAKEN`, `OWN_ADMIN_ACCESS`, `LAST_ADMIN_REQUIRED`, `STAFF_LINKED_TO_OWNER`, `CONFIG_STALE`, `CONFIG_REFERENCE_INVALID` (`role_archived`, `not_found`, `not_at_branch`, `loop`, `wrong_branch`, `archived`), `STAFF_NOT_FOUND`, `BRANCH_NOT_FOUND`, `PERMISSION_DENIED` (`tenant_wide_write`), `IDEMPOTENCY_KEY_MISMATCH`, `SERVICE_UNAVAILABLE`.
- **Edge cases:** long names (40 letters); many roles (catalogue of 7+ chips); two or three branches; PIN is not part of this save; Bring back keeps the PIN but not reporting lines or stock counting; `one_lead_per_branch` cannot happen from this UI.
- **Data needed:** reads staff record + `version`, roles (`GET /v1/admin/roles`), branches, floors per branch (01a), staff at each branch (for Reports to); writes `display_name, role_ids, branch_ids, reports_to[{branch_id, lead_staff_id}], floors[{branch_id, floor_ids}], denied_permissions, is_active, expected_version`; reads `moved_reports`, `changed_versions`.

### 01b-C02 · What {name} can do
- **Job:** show what the person can actually do after all roles and blocks are combined.
- **Entry points:** end column of 01b-S02 (folded disclosure on phone).
- **Exits:** none.
- **Information shown:** heading "What {name} can do" (MUST); rule line "Roles add up: the most generous grant wins, and the widest place. A "Never" always wins." (USEFUL); up to 6 rows (changed first, then risky) — permission label + grant chip + line (MUST); phone summary "{n} allowed" (USEFUL).

| Final grant | Line |
|---|---|
| Allowed | "Allowed · from {role}" + "· whole branch" / "· on their floors" / "· for their team" / "· for their stations"; e.g. "Allowed · from Manager · whole branch (beats "their floors" from Shift lead)" |
| Needs approval | "Needs approval · approved by {role A} or {role B}" |
| Not allowed | "Not allowed · no role gives it" |
| Never | "Never · blocked for {name}" |

- **Actions:** **See all 20** — SECONDARY.
- **Inputs:** none (computed live in the browser from roles and blocks on the page).
- **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Mixed grants | roles with grants | rows as table | as above | `StaffForm` |
| With Never | a block | "Never" row first | "Never · blocked for Imran" | `StaffFormImran` |
| All not allowed | only Waiter/Cook or no grants | every row "Not allowed" | "Not allowed · no role gives it" | `StaffFormNew` |
| Phone folded | width 390 | disclosure "What Hamza can do · 5 allowed" | — | `StaffFormPhone` |
| Urdu RTL | Urdu | mirrored | "حمزہ کیا کر سکتے ہیں" / "رولز جمع ہوتے ہیں: سب سے کھلی اجازت اور سب سے بڑی جگہ مانی جاتی ہے۔ "کبھی نہیں" ہمیشہ جیتتا ہے۔" / "منظوری چاہیے · مینیجر یا مالک منظور کرے" / "اجازت ہے · شفٹ لیڈ سے · ان کی ٹیم کے لیے" / "اجازت ہے · شفٹ لیڈ سے · ان کے فلور پر" / "اجازت نہیں · کوئی رول نہیں دیتا" / "تمام 20 دیکھیں" | `StaffFormUrdu` |

- **Error codes:** none. **Edge cases:** Allowed beats Needs approval; a wider scope on a Needs approval role does not widen an Allowed one; 20 permissions today, more later. **Data needed:** roles' `grants[]`, `denied_permissions`.

### 01b-C03 · Reports to (per branch)
- **Job:** set who this person reports to at each branch.
- **Entry points:** 01b-S02 section "Reports to".
- **Exits:** none.
- **Information shown:** help "Who this person reports to at each branch. A reporting line gives no extra permission." (USEFUL); one select per branch "At {branch}" (MUST).
- **Actions:** select — SECONDARY.
- **Inputs:** one select per branch in Works at; options = active people at that branch except the person (people without a PIN allowed); default "Nobody"; errors: `loop` "{lead} already reports to {name} at {branch}. Pick someone else."; `not_at_branch` "{lead} doesn't work at {branch} any more. Pick someone else." (proposed); no branch yet "Pick a branch under "Works at" first."
- **Decisions:** lead per branch.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| One branch | one branch | one select | "At Gulberg" | `StaffForm` |
| Several branches | 2+ branches | one select each | "At Gulberg" / "At Johar Town" | `StaffFormTwoBranches` |
| No branch | Works at empty | message instead of select | "Pick a branch under "Works at" first." | `StaffFormErrors` |
| Loop error | `loop` | field error | as above | `StaffFormConflicts` |

- **Error codes:** `CONFIG_REFERENCE_INVALID` (`loop`, `not_at_branch`). **Edge cases:** adding a branch adds a select; removing one removes it. **Data needed:** staff at each branch.

### 01b-C04 · Floors they work on (per branch)
- **Job:** say on which floors the person works, for roles limited to "their floors".
- **Entry points:** 01b-S02, shown only when a selected role has a `my_floors` grant.
- **Exits:** none.
- **Information shown:** help "Shown because {role} uses "Their floors". Their role decides what they can do; this decides on which floors." (USEFUL); floor chip group per branch "At {branch}" (MUST).
- **Actions:** floor chip toggles — SECONDARY.
- **Inputs:** floors of that branch, not archived; default none; error "A floor was archived or moved. Reload and pick again."
- **Decisions:** floors per branch.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Shown | role uses Their floors | chip groups | as above | `StaffForm`, `StaffFormTwoBranches` |
| Hidden | no `my_floors` role | section hidden (stored floors kept) | — | `StaffFormNew` |
| Floor archived | `wrong_branch` / `archived` | field error | as above | `StaffFormConflicts` |

- **Error codes:** `CONFIG_REFERENCE_INVALID`. **Edge cases:** no per-person "Any table / Tables they open" choice. **Data needed:** floors per branch (01a).

### 01b-D01 · Set / reset PIN
- **Job:** give a person a new PIN without the owner seeing it.
- **Entry points:** **Reset PIN** / **Set PIN** on 01b-S01 or 01b-S02; after Add staff with "They are next to me".
- **Exits:** Done / Cancel / Close → back.
- **Information shown:** laptop: title "New PIN for {name}" (MUST); help "4 to 6 digits. Two people may have the same PIN." (USEFUL); note "{name} is signed out on every device when you save. Anything they haven't sent stays on the device." (MUST). Phone: info banner "Hand the phone to {name}." / "They type their new PIN twice. You won't see it." (MUST); "Step 1 of 2" / "Step 2 of 2" (USEFUL); "Saving signs them out on every device." (USEFUL).
- **Actions:** laptop **Save PIN** — PRIMARY; **Cancel** — SECONDARY. Phone: **Next** (step 1) / **Save** (step 2) — PRIMARY; keys 0–9, Delete. Result **Done** — PRIMARY. Offline **Try again** — PRIMARY.
- **Inputs:** New PIN and Type it again — masked, 4–6 digits, `inputmode=numeric`, LTR, default empty; errors "PIN is 4 to 6 digits." and "The two PINs are different. Type them again."
- **Decisions:** none (the staff member types).
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Laptop default | open | dialog over the list | "New PIN for Bilal" / "New PIN" / "Type it again" / "Cancel" / "Save PIN" | `PinDialog` |
| Mismatch | fields differ | error | "The two PINs are different. Type them again." | `PinMismatch` |
| Too short | < 4 or not digits | error | "PIN is 4 to 6 digits." | `PinShort` |
| Saving | request | button busy | "Saving…" | `PinSaving` |
| Saved | 200 | result | "{name}'s PIN is saved" / "It works at Gulberg and Johar Town in about a minute. Tell Hamza his new PIN." / "Done" | `PinSaved` |
| First PIN | person had none | result + extra line | "Usman's PIN is saved" / "It works at Gulberg in about a minute. Tell Usman his new PIN." / "He now appears on the sign-in screens at Gulberg." / "Done" | `PinFirst` |
| Offline | network / 503 | banner; button Try again | "A new PIN needs the internet. Nothing changed." / "Bilal's old PIN still works. Try again when you are online." (no PIN yet: "They still have no PIN.", proposed) / "Try again" | `PinOffline` |
| Person left | `STAFF_NOT_FOUND` | message + Close | "Bilal was marked as left, so a PIN can't be set." / "Bring him back from Staff › Left first." / "Close" | `PinPersonLeft` |
| Phone step 1 | phone | PIN pad | "New PIN for Bilal" / "Hand the phone to Bilal." / "They type their new PIN twice. You won't see it." / "Step 1 of 2" / "Type a new PIN" / "Delete" / "Next" / "Saving signs them out on every device." | `PinPhone` |
| Phone step 2 | Next | PIN pad | "Step 2 of 2" / "Type it again" / "Save" | `PinPhoneRepeat` |
| Phone mismatch | differ | back to step 1 + banner | "The two PINs are different. Type them again." / "Hand the phone back to Bilal." | `PinPhoneMismatch` |
| Phone saved | 200 | result | "Bilal's PIN is saved" / "It works at Gulberg in about a minute. Tell Bilal his new PIN. Take the phone back." / "Done" | `PinPhoneSaved` |
| Phone offline | network | result | "A new PIN needs the internet" / "Nothing changed. Bilal's old PIN still works. Try again when you are online." / "Try again" | `PinPhoneOffline` |
| Phone Urdu | Urdu | mirrored | "بلال کا نیا پن" / "فون بلال کو دیں۔" / "وہ نیا پن دو بار لکھیں گے۔ آپ کو نظر نہیں آئے گا۔" / "مرحلہ 1 از 2" / "نیا پن لکھیں" / "مٹائیں" / "آگے" / "محفوظ کرنے سے وہ ہر ڈیوائس سے سائن آؤٹ ہو جائیں گے۔" | `PinPhoneUrdu` |

- **Error codes:** `VALIDATION_FAILED`, `STAFF_NOT_FOUND`, `SERVICE_UNAVAILABLE`.
- **Edge cases:** every save is a reset (signs them out everywhere), even with the same PIN; duplicates allowed; PIN lives only in component state, cleared after the request.
- **Data needed:** `PUT /v1/admin/staff/:id/pin { pin }`; `display_name`, `branch_ids`, `has_pin`; response version.

### 01b-D02 · Mark as left
- **Job:** stop a leaver signing in anywhere, and show who moves to which lead.
- **Entry points:** **Mark as left** on 01b-S02.
- **Exits:** Cancel → S02; Mark as left → 01b-S01 + B02 (+ B04); blocked → Close.
- **Information shown:** title "Mark {name} as left?" (MUST); body "He can't sign in anywhere, and his phone is removed from Gulberg and Johar Town within about a minute. His name stays on old orders. You can bring him back later." (MUST); moves "2 people who report to Hamza at Gulberg (Bilal, Ali R.) will report to Imran instead." / "Sana at Johar Town will report to nobody." (MUST when present).
- **Actions:** **Cancel** — SECONDARY; **Mark as left** — DESTRUCTIVE → `PATCH /v1/admin/staff/:id { expected_version, is_active: false }`; blocked **Close** — PRIMARY; offline **Try again** — PRIMARY.
- **Inputs:** none. **Decisions:** confirm.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Confirm | open | dialog | as above | `LeftDialog` |
| Linked to owner | `STAFF_LINKED_TO_OWNER` | blocked | "Arif can't be marked as left" / "This profile is linked to the owner login and can't be marked as left." / "Close" | `LeftBlockedOwner` |
| Last admin | `LAST_ADMIN_REQUIRED` | blocked | "Kamran can't be marked as left" / "Johar Town would have nobody who can open the hub admin and pair screens." / "Give someone else admin access there first." / "Close" | `LeftBlockedAdmin` |
| Own admin | `OWN_ADMIN_ACCESS` | blocked (S02 text) | "You can't remove your own admin access. Call support." | none |
| Offline | network | message + Try again | "Nothing changed. Try again when you are online." / "Hamza can still sign in." / "Cancel" / "Try again" | `LeftOffline` |
| Stale | `CONFIG_STALE` | 01b-B03 | — | none |
| Done | 200 | S01 + B02 + B04 | see B04 | `StaffMoved` |

- **Error codes:** `STAFF_LINKED_TO_OWNER`, `LAST_ADMIN_REQUIRED`, `OWN_ADMIN_ACCESS`, `CONFIG_STALE`, `SERVICE_UNAVAILABLE`.
- **Edge cases:** no direct reports → move lines hidden; leaver's sessions end and phone is removed.
- **Data needed:** direct reports per branch and their new lead (from the staff list), `version`.

### 01b-S03 · Roles list
- **Job:** see all roles, their size and idle sign-out; start editing or archiving one.
- **Entry points:** side nav "Roles" (`#/roles`).
- **Exits:** **New role** → 01b-S04 new; **Edit** → 01b-S04; **Archive** → 01b-D03; Archived → 01b-S03a.
- **Information shown:**

| Item | Mark |
|---|---|
| Intro "A role is a set of things people may do. Nothing on the screens depends on a role's name." | USEFUL |
| Segmented "Active {n}" · "Archived {n}" | USEFUL |
| Row: name + "Default" chip | MUST |
| People: "1 person" / "{n} people" | USEFUL |
| "Signs out after idle [N] min" (01b-S08) | USEFUL |
| Note "Someone with two roles gets the longer time. Tablets sign out after this many idle minutes." | RARE |

- **Actions:** **New role** — PRIMARY; **Edit** — SECONDARY; **Archive** — DESTRUCTIVE; idle input (01b-S08) — SECONDARY; Active/Archived — RARE.
- **Inputs:** idle minutes per row (see 01b-S08).
- **Decisions:** which role to edit.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | loaded | 6 defaults + custom roles (Owner 60, Manager 60, Cashier 15, Order taker 15, Waiter 5, Cook 5; Shift lead 30) | as above | `Roles` |
| Loading | fetching | UNKNOWN (no frame) | — | none |
| Cloud down | network | banner; list kept; edits off | "Can't reach the restaurant cloud — retrying…" / "Showing roles from {time}. Changes need the internet." | `RolesCloudDown` |
| Lock notice | `lockout_notice` on refresh | 01b-B01 | see B01 | `RolesLock` |
| Phone | width 390 | rows "{n} people · signs out after {n} min" + Edit; app bar "New" | "Roles" / "New" / "1 person · signs out after 60 min" | `RolesPhone` |
| Urdu RTL | Urdu | mirrored | "رولز" / "نیا رول" / "رول ان کاموں کا مجموعہ ہے جو لوگ کر سکتے ہیں۔ اسکرینوں پر کچھ بھی رول کے نام پر منحصر نہیں۔" / "فعال" / "آرکائیو" / "پہلے سے" (Default) / "{n} لوگ" / "بیکار رہنے پر سائن آؤٹ" / "منٹ" / "ترمیم" / "آرکائیو" / "دو رول والے کو لمبا وقت ملتا ہے۔ ٹیبلٹ اتنے منٹ بیکار رہنے پر سائن آؤٹ ہوتے ہیں۔" | `RolesUrdu` |

- **Error codes:** `SERVICE_UNAVAILABLE`, `CONFIG_STALE` (idle row).
- **Edge cases:** no "Made by" line (deferred); seeded Waiter/Order taker/Cook have no grants yet.
- **Data needed:** `GET /v1/admin/roles?archived=false|true` → `role_id, name, is_default, archived_at, idle_minutes, staff_count, grants[], version`.

### 01b-S03a · Archived roles
- **Job:** see archived roles and restore one.
- **Entry points:** "Archived" segment on 01b-S03.
- **Exits:** Restore → row moves to Active.
- **Information shown:** row: name + "Archived {date} · nobody has it" (MUST); note "A restored role has nobody. Give it to people in Staff." (USEFUL).
- **Actions:** **Restore** — SECONDARY → `PATCH { expected_version, archived: false }`.
- **Inputs:** none. **Decisions:** restore or not.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| List | archived roles exist | muted rows | "Runner" / "Archived 12 Oct · nobody has it" / "Restore" | `RolesArchived` |
| Empty | none | empty line | "No archived roles." / "Roles you archive show here and can be restored." | `RolesArchivedEmpty` |
| Name taken | `CONFIG_NAME_TAKEN` | row error | "Another active role is called Runner. Rename one first." | `RolesRestoreTaken` |
| Stale | `CONFIG_STALE` | 01b-B03 | — | none |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** `CONFIG_NAME_TAKEN`, `CONFIG_STALE`. **Edge cases:** holders were removed on archive. **Data needed:** archived roles list.

### 01b-S04 · Role editor
- **Job:** set what a role may do, where, and who approves.
- **Entry points:** **New role** / **Edit** on 01b-S03; "Open {role}" from 01b-D03.
- **Exits:** Save role → 01b-S03 + B02; Cancel → 01b-S03; guard dialogs (D03 blocked variants) → OK.
- **Information shown:** app bar back "Roles", title "New role" / "Edit {role}" (MUST); explain box "Allowed: they just do it. Needs approval: they ask, and the request goes to people with the chosen roles, who approve on their own device with their PIN. Not allowed: the button is hidden." (USEFUL); groups with C01 rows (MUST):

| Group | Permissions (label; "Where" choices) |
|---|---|
| Orders and tables | Take orders at any table (Whole branch · Their floors); Free a table someone else has open (Whole branch · Their floors); Approve removing an item (Whole branch · My team); Remove a cooking item from an order; Rush an order in the kitchen |
| Kitchen items | Reprint a kitchen ticket; Move a removed item to ready stock; Mark an item returned |
| Bills and cash | Give a discount; Give a refund; Give an item free; Reopen a closed bill |
| Menu and stock | Change the menu; Count stock and switch items off (Whole branch · Their stations) |
| People and screens | Change roles; Add staff, reset PINs, unlock; Pair and remove screens; Open hub admin |
| Reports and logs | See sales reports; See the audit log |

- **Actions:** **Save role** — PRIMARY; **Cancel** — SECONDARY; C01 controls — SECONDARY.
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Role name; help "Up to 40 letters. Different from your other roles." | text | empty (new) | 1–40, unique among active roles, case-insensitive | "Another role is called {name}." |
| Signs out after idle; help "1 to 240 minutes." | number + "min" | 15 (new, frame) | 1–240 | "1 to 240 minutes" |
| Each permission (C01) | see 01b-C01 | Not allowed (new) | Needs approval needs ≥ 1 approver | "Pick at least one role to approve." |

- **Decisions:** grant per permission; approvers; where it applies; idle minutes.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Edit | Edit | all groups | "Edit Shift lead" / "Cancel" / "Save role" | `RoleEditor` |
| New | New role | everything Not allowed | "New role" | `RoleEditorNew` |
| Errors | client / server | banner "3 things to fix" + fields | "3 things to fix" / "Role name · Signs out after idle · Rush an order in the kitchen" / "Another role is called Manager." / "1 to 240 minutes" / "Pick at least one role to approve." | `RoleEditorErrors` |
| Own admin | `OWN_ADMIN_ACCESS` | segment snaps back ("Snapped back — see the message") + dialog | "You can't remove your own admin access" / ""Open hub admin" stays Allowed on Owner, because that is how you open the hub admin." / "You can't remove your own admin access." / "Call support." / "OK" | `RoleEditorOwnAdmin` |
| Owner not linked | `OWN_ADMIN_ACCESS { owner_not_linked }` | message | "Your owner login isn't linked to your staff profile yet, so admin access can't be removed. Call support to link it." | none |
| Last admin | `LAST_ADMIN_REQUIRED` | segment snaps back + dialog | "Manager needs to keep this" / "At least one person at Johar Town must be able to open the hub admin and pair screens." / "Kamran is the only one there, through Manager. Give "Open hub admin" and "Pair and remove screens" to another role he has first." / "OK" | `RoleEditorLastAdmin` |
| Approver archived | `role_archived` | C01 row error, chip removed (proposed) | UNKNOWN text | none |
| Stale | `CONFIG_STALE` | 01b-B03 | see B03 | `RoleEditorStale` |
| Not found | `ROLE_NOT_FOUND` | full-page state | "Role" / "This role can't be found" / "It may have been removed." / "Back to Roles" | `RoleNotFound` |
| Offline | network | form kept | "Nothing was saved." (proposed) | none |
| Phone | width 390 | one permission per row, stacked; Save role in bottom bar | as frame | `RoleEditorPhone` |
| Urdu RTL | Urdu | mirrored | see below | `RoleEditorUrdu` |

  Urdu copy (from `RoleEditorUrdu`): "شفٹ لیڈ میں ترمیم" / "منسوخ" / "رول محفوظ کریں" / "رول کا نام" / "زیادہ سے زیادہ 40 حروف۔ باقی رولز سے مختلف۔" / "بیکار رہنے پر سائن آؤٹ" / "منٹ" / "1 سے 240 منٹ۔" / "اجازت ہے": "وہ بس کر لیتے ہیں۔" / "منظوری چاہیے": "وہ پوچھتے ہیں، اور درخواست چنے گئے رولز والوں کو جاتی ہے جو اپنی ڈیوائس پر اپنے پن سے منظور کرتے ہیں۔" / "اجازت نہیں": "بٹن چھپ جاتا ہے۔" / groups "آرڈر اور میزیں" · "کچن آئٹم" · "بل اور کیش" · "مینیو اور اسٹاک" · "لوگ اور اسکرینیں" · "رپورٹیں اور لاگ" / permissions "کسی بھی میز پر آرڈر لینا" · "کسی اور کی کھلی میز چھڑوانا" · "آئٹم ہٹانے کی منظوری دینا" · "پکتا ہوا آئٹم آرڈر سے ہٹانا" · "کچن میں آرڈر جلدی کروانا" · "کچن ٹکٹ دوبارہ پرنٹ کرنا" · "ہٹایا گیا آئٹم تیار اسٹاک میں ڈالنا" · "آئٹم واپس آیا لکھنا" · "ڈسکاؤنٹ دینا" · "رقم واپس کرنا" · "آئٹم مفت دینا" · "بند بل دوبارہ کھولنا" · "مینیو بدلنا" · "اسٹاک گننا اور آئٹم بند کرنا" · "رولز بدلنا" · "اسٹاف شامل کرنا، پن بدلنا، ان لاک کرنا" · "اسکرینیں جوڑنا اور ہٹانا" · "ہب ایڈمن کھولنا" · "سیلز رپورٹیں دیکھنا" · "آڈٹ لاگ دیکھنا" / "کہاں" / "ان کے فلور" / "ہر شخص کے فلور" / "ان کی ٹیم" / "جو انہیں رپورٹ کرتے ہیں" / "منظور کرنے والے".
- **Error codes:** `VALIDATION_FAILED`, `CONFIG_NAME_TAKEN`, `OWN_ADMIN_ACCESS`, `LAST_ADMIN_REQUIRED`, `CONFIG_STALE`, `ROLE_NOT_FOUND`, `CONFIG_REFERENCE_INVALID` (`role_archived`, `scope_not_allowed`), `SERVICE_UNAVAILABLE`.
- **Edge cases:** 20 permissions today; later modules append to a group without a redesign; saving audits before/after (no viewer here).
- **Data needed:** role `name, idle_minutes, grants[] {permission, grant_type, approver_role_ids, scope}, version`; active roles for approver chips; `PERMISSION_CATALOGUE`, `PERMISSION_SCOPES`; `PATCH /v1/admin/roles/:id` / `POST /v1/admin/roles`.

### 01b-C01 · Grant control
- **Job:** set one permission for one role.
- **Entry points:** each row of 01b-S04 (reused later by any module's permission setting).
- **Exits:** none.
- **Information shown:** plain label (MUST); segmented **Allowed | Needs approval | Not allowed** (MUST); "Approved by" chips when Needs approval (MUST); "Where" select when the permission has more than one scope, for Allowed and Needs approval (USEFUL); Where help: "floors set on each person" / "people who report to them" / "stations set in Stock counting" (USEFUL).
- **Actions:** segment, approver chips, Where select — SECONDARY.
- **Inputs:** grant (default Not allowed on a new role); Approved by — multi-select role chips, may include this role; Where — Whole branch (default) · Their floors · My team · Their stations (only the ones the permission accepts; no "Tables they open").
- **Decisions:** grant, approvers, scope.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Not allowed | segment | nothing else | "Not allowed — nothing else to choose" | `GrantControl` |
| Allowed, one place | permission with no scope | no Where | "Allowed — one place only, no "Where"" | `GrantControl` |
| Allowed + Where | scoped permission | Where select | "Where" / "Their floors" / "floors set on each person"; "My team" / "people who report to them"; "Their stations" / "stations set in Stock counting" | `GrantControl` |
| Needs approval | segment | Approved by chips | "Approved by" / Owner · Manager · Cashier · Order taker · Shift lead | `GrantControl` |
| Needs approval + Where | scoped | both | — | `GrantControl` |
| No approver | none picked | row error | "Pick at least one role to approve." | `GrantControl`, `RoleEditorErrors` |
| Snapped back | guard refused | segment returns, note | "Snapped back — see the message" | `GrantControl`, `RoleEditorOwnAdmin` |

- **Error codes:** `OWN_ADMIN_ACCESS`, `LAST_ADMIN_REQUIRED`, `CONFIG_REFERENCE_INVALID` (`role_archived`, `scope_not_allowed`). **Edge cases:** many approver roles → chip wrapping. **Data needed:** permission scopes, active roles.

### 01b-D03 · Archive role
- **Job:** confirm archiving a role, or explain why it cannot be archived.
- **Entry points:** **Archive** on 01b-S03.
- **Exits:** Cancel / Close / OK → S03; Archive → S03 + B02; Open {name}/{role} → S02 / S04.
- **Information shown:** title + body (MUST).
- **Actions:** confirm: **Cancel** (SECONDARY), **Archive {role}** (DESTRUCTIVE) → `PATCH { expected_version, archived: true }`. Blocked: **Close** / **OK** (SECONDARY / PRIMARY), **Open {name}** / **Open {role}** (PRIMARY).
- **Inputs:** none. **Decisions:** archive or not.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Confirm | Archive | dialog | "Archive Shift lead?" / "2 people have it. They keep their other roles. Their stock counting through this role stops." / "Imran keeps his Manager role. Hamza keeps Order taker." / "Cancel" / "Archive Shift lead" | `RoleArchiveConfirm` |
| Someone left with no role | `CONFIG_IN_USE { used_by: staff }` | blocked | "Cook can't be archived" / "Usman would have no role left." / "Give him another role first." / "Close" / "Open Usman" | `RoleArchiveInUseStaff` |
| Role approves for others | `CONFIG_IN_USE { used_by: role }` | blocked | "Manager can't be archived" / "Manager approves requests for Cashier and Shift lead." / "Change who approves there first." / "Close" / "Open Cashier" | `RoleArchiveInUseRole` |
| Last admin | `LAST_ADMIN_REQUIRED` | blocked | "Manager can't be archived" / "At least one person at Johar Town must be able to open the hub admin." / "Give "Open hub admin" and "Pair and remove screens" to another role first, such as Shift lead." / "OK" | `RoleArchiveLastAdmin` |
| Own admin | `OWN_ADMIN_ACCESS` | blocked | "Owner can't be archived" / "You can't remove your own admin access." / "Call support." / "OK" | `RoleArchiveOwnAdmin` |
| Stale / offline | `CONFIG_STALE` / network | B03 / B04 | — | none |

- **Error codes:** `CONFIG_IN_USE`, `LAST_ADMIN_REQUIRED`, `OWN_ADMIN_ACCESS`, `CONFIG_STALE`. **Edge cases:** many names → list length UNKNOWN. **Data needed:** holders and their other roles; `used_by`.

### 01b-S05 · Stock counting
- **Job:** choose who counts stock at each station of a branch.
- **Entry points:** side nav "Stock counting" (`#/stock-counting`).
- **Exits:** **Change** → picker; **Save** → B02; "Open Kitchen stations" → 01a-S04.
- **Information shown:**

| Item | Mark |
|---|---|
| App bar "Stock counting" + branch select | MUST |
| Intro "These people see the stock page for their stations. Several people can share a station." | USEFUL |
| Station row: name + items counted there ("Paye, Nihari, Chanay") | MUST |
| Who: person chips + role chips ("Everyone with Manager") or "Nobody yet" | MUST |
| Warn per station with nobody: "Nobody counts {station} at {branch}." / "{items} will show "Not counted today" every morning until someone is chosen." | MUST |
| Help "A counter needs "Count stock and switch items off" set to "Their stations", and "Open hub admin", on their role to open the stock page." | RARE |

- **Actions:** **Save** — PRIMARY → `PUT /v1/admin/branches/:b/responsibilities { expected_version, responsibilities }` (whole branch set); **Change** — SECONDARY; picker **Done** (PRIMARY) / **Cancel**; **Reload** (stale/422).
- **Inputs:** picker: people who work at this branch (chips) and active roles (chips, "A role means everyone with that role at {branch}, now and later."); default current set.
- **Decisions:** who counts each station.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | loaded | rows | as above | `Responsibilities` |
| Picker | Change | dialog | "Who counts BBQ grill?" / "Gulberg · Seekh Kebab, Chicken Tikka" / "People who work at Gulberg" / "Roles" / "A role means everyone with that role at Gulberg, now and later." / "Cancel" / "Done" | `ResponsibilitiesPicker` |
| Unsaved | a station changed | info banner | "1 station changed. Save to send it." / "Saving sends who counts every Gulberg station at once." | `ResponsibilitiesUnsaved` |
| Saved | 200 | ok banner | "Stock counting at Gulberg saved. Changes reach each branch within about a minute." | `ResponsibilitiesSaved` |
| Stale | `CONFIG_STALE` | B03 | "Someone changed this since you opened it." / "Reload shows the current version. Your changes here are not saved." / "Reload" | `ResponsibilitiesStale` |
| Changed meanwhile | `422` (person left, role/station archived) | banner + Reload | "Something changed. Reload and pick again." / "A person left Gulberg, or a role or station was archived, since you opened this page." / "Reload" | `ResponsibilitiesChanged` |
| No stations | branch has none | empty block | "{branch} has no stations yet." / "Add them in Setup › Kitchen stations." / "Open Kitchen stations" | `ResponsibilitiesNoStations` |
| Loading / cloud down | fetching / network | UNKNOWN frame; B04 rule | — | none |
| Phone | width 390 | stacked rows; Save in bottom bar | "Nobody counts Drinks counter." | `ResponsibilitiesPhone` |
| Urdu RTL | Urdu | mirrored | "اسٹاک کی گنتی" / "محفوظ کریں" / "یہ لوگ اپنے اسٹیشنوں کا اسٹاک صفحہ دیکھتے ہیں۔ ایک اسٹیشن کئی لوگ بانٹ سکتے ہیں۔" / "تمام مینیجر" / "بدلیں" / "ابھی کوئی نہیں" / "گلبرگ میں مشروبات کاؤنٹر کوئی نہیں گنتا۔" / "جب تک کوئی نہ چنا جائے، لسی اور منرل واٹر ہر صبح "آج نہیں گنا" دکھائیں گے۔" / "گنتی کرنے والے کے رول پر "اسٹاک گننا اور آئٹم بند کرنا" = "ان کے اسٹیشن" اور "ہب ایڈمن کھولنا" ہونا چاہیے تاکہ اسٹاک صفحہ کھلے۔" | `ResponsibilitiesUrdu` |

- **Error codes:** `CONFIG_STALE`, `CONFIG_REFERENCE_INVALID` (422), `BRANCH_NOT_FOUND`, `SERVICE_UNAVAILABLE`.
- **Edge cases:** leavers, archived roles and removed branches drop out automatically; an archived station disappears and comes back with its people when restored; with 01c v1.0 the `my_stations` scope uses the stock item's station.
- **Data needed:** `GET /v1/admin/branches/:b/responsibilities` → `{ responsibilities: [{ responsibility: 'count_stock', station_id, staff_ids[], role_ids[] }], version }`; 01a active stations; items per station; staff at branch; active roles.

### 01b-S06 · Branches
- **Job:** see branches by name and whether each hub is up to date.
- **Entry points:** side nav "Branches and settings" (`#/branches`).
- **Exits:** **Rename** → 01b-D04; **Settings** → 01b-S07.
- **Information shown:**

| Item | Mark |
|---|---|
| Row: name + ID tail ("…P0AB") | MUST (name), RARE (ID tail) |
| Status chip "Open" / "Not open yet" | USEFUL |
| "Hub checked {ago} · Up to date {ago}" / "No hub yet" | MUST |
| Warn: hub not taking changes / not checking in | MUST when present |
| Footer "A new branch is added by support when its hub is installed." | RARE |

- **Actions:** **Rename** — SECONDARY; **Settings** — SECONDARY. No primary action.
- **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Healthy | `hub_last_seen_at − hub_synced_at ≤ hub_stale_after_ms` | ok line | "Hub checked 1 min ago · Up to date 1 min ago" | `Branches` |
| Not taking changes | gap > threshold | warn | "Up to date 2 h ago." / "The hub checks in but hasn't taken the latest changes. Call support if this stays." | `Branches` |
| Not checking in | `now − hub_last_seen_at > hub_stale_after_ms` | warn | "Johar Town hub last checked 12 min ago." / "It gets the change when it is back online." | `BranchesAway` |
| No hub yet | `hub_last_seen_at` null | text | "Not open yet" / "No hub yet" | `Branches` |
| Renamed | D04 success | ok banner | "Renamed to Gulberg Main." / "The hub screens there keep the old name for now." | `BranchRenamed` |
| Phone | width 390 | stacked rows (no ID tails) | as frame | `BranchesPhone` |
| Urdu RTL | Urdu | mirrored | "برانچیں اور سیٹنگ" / "کھلی" / "ہب نے 1 منٹ پہلے چیک کیا · 1 منٹ پہلے تک تازہ" / "نام بدلیں" / "سیٹنگ" / "2 گھنٹے پہلے تک تازہ۔" / "ہب چیک کرتا ہے مگر تازہ تبدیلیاں نہیں لے رہا۔ اگر ایسا رہے تو سپورٹ کو فون کریں۔" / "ابھی نہیں کھلی" / "ابھی ہب نہیں" / "نئی برانچ سپورٹ شامل کرتی ہے جب اس کا ہب لگتا ہے۔" | `BranchesUrdu` |
| Loading / cloud down | — | UNKNOWN frame | — | none |

- **Error codes:** `SERVICE_UNAVAILABLE`. **Edge cases:** threshold `hub_stale_after_ms` (180 000 ms today) comes from the server, never hard-coded. **Data needed:** `GET /v1/admin/branches` → `branch_id, name, status, hub_last_seen_at, hub_synced_at`, `hub_stale_after_ms`.

### 01b-D04 · Rename branch
- **Job:** change a branch's name.
- **Entry points:** **Rename** on 01b-S06.
- **Exits:** Cancel / Rename → 01b-S06 (ok banner).
- **Information shown:** title "Rename {branch}" (MUST); help "Up to 60 letters. Different from your other branches." (USEFUL); note "The hub screens at the branch keep showing the old name for now." (USEFUL).
- **Actions:** **Rename** — PRIMARY → `PATCH /v1/admin/branches/:id { name }`; **Cancel** — SECONDARY.
- **Inputs:** Branch name — text, default current name, 1–60, trimmed, unique among the restaurant's branches (case-insensitive); error "Another branch is called {name}."; empty/too long text UNKNOWN.
- **Decisions:** new name.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | Rename | dialog | "Rename Gulberg" / "Branch name" / "Cancel" / "Rename" | `BranchRename` |
| Name taken | `CONFIG_NAME_TAKEN` | field error | "Another branch is called Johar Town." | `BranchRenameTaken` |
| Renamed | 200 | dialog closes; S06 ok banner | "Renamed to Gulberg Main." / "The hub screens there keep the old name for now." | `BranchRenamed` |
| Offline / Urdu | — | UNKNOWN | — | none |

- **Error codes:** `CONFIG_NAME_TAKEN`, `VALIDATION_FAILED`, `SERVICE_UNAVAILABLE`. **Edge cases:** no version check; rename does not reach the hub. **Data needed:** `name`.

### 01b-S07 · Branch settings
- **Job:** set tax on/off and the business-day guards for one branch.
- **Entry points:** **Settings** on 01b-S06 (`#/branches/:id/settings`).
- **Exits:** Save settings → ok banner; Cancel / back "Branches" → 01b-S06.
- **Information shown:** title "{branch} settings" (MUST); tabs "General · Kitchen timing · Voids and returns" (see §6); sections Tax and Business day with help (USEFUL).
- **Actions:** **Save settings** — PRIMARY → `PATCH … { only changed fields }`; **Cancel** — SECONDARY.
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Charge tax at this branch (`tax_enabled`); help "When off, bills at this branch show no tax, whatever the item's tax rate. Off until you turn it on." | switch | off | — | — |
| Warn when a business day has been open longer than [N] hours (`day_stale_after_hours`); help "The stock page asks to close yesterday's day. 1 to 48 hours." | number + "hours" | 16 | 1–48 | "Use 1 to 48 hours." |
| Ignore a second "Start day" within [N] hours (`day_min_gap_hours`); help "Stops a day being started twice by two tablets. 0 to 12 hours. Must be less than the hours above." | number + "hours" | 4 | 0–12; less than stale hours | "Must be less than the stale-day hours ({n})." |

- **Decisions:** tax on/off; stale hours; start-day gap.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | loaded | form | as above | `BranchSettings` |
| Out of range | 60 typed | field error | "Use 1 to 48 hours." | `BranchSettingsRange` |
| Gap not less | gap ≥ stale | error on gap field | "Must be less than the stale-day hours (10)." | `BranchSettingsGap` |
| Saved | 200 | ok banner | "Settings saved. Gulberg gets them within about a minute." | `BranchSettingsSaved` |
| Phone | width 390 | one column; Save settings in bottom bar; no tabs | as frame | `BranchSettingsPhone` |
| Urdu RTL | Urdu | mirrored | "گلبرگ کی سیٹنگ" / "منسوخ" / "سیٹنگ محفوظ کریں" / "عام" / "کچن کا وقت" / "ووئڈ اور واپسی" / "ٹیکس" / "بند ہو تو اس برانچ کے بلوں پر ٹیکس نہیں، چاہے آئٹم کا ٹیکس ریٹ کچھ بھی ہو۔ آن کرنے تک بند۔" / "اس برانچ میں ٹیکس لگائیں" / "کاروباری دن" / "جب کاروباری دن اس سے زیادہ کھلا رہے تو خبردار کریں" / "گھنٹے" / "اسٹاک صفحہ کل کا دن بند کرنے کو کہتا ہے۔ 1 سے 48 گھنٹے۔" / "دوسرا "دن شروع کریں" اتنی دیر میں نظرانداز کریں" / "دو ٹیبلٹ سے دن دو بار شروع ہونے سے روکتا ہے۔ 0 سے 12 گھنٹے۔ اوپر والے گھنٹوں سے کم ہو۔" | `BranchSettingsUrdu` |
| Not found / offline | `404` / network | UNKNOWN frame | — | none |

- **Error codes:** `VALIDATION_FAILED`, `BRANCH_NOT_FOUND`, `SERVICE_UNAVAILABLE`. **Edge cases:** later settings (kitchen timing, voids, service charge) will appear here. **Data needed:** `GET /v1/admin/branches/:b/settings` → `tax_enabled, day_stale_after_hours, day_min_gap_hours`.

### 01b-S08 · Idle limits
- **Job:** set how long each role stays signed in while idle.
- **Entry points:** column "Signs out after idle" on 01b-S03; field on 01b-S04.
- **Exits:** none (saves on leaving the box).
- **Information shown:** "Signs out after idle [N] min" (USEFUL); note "Someone with two roles gets the longer time. Tablets sign out after this many idle minutes." (RARE).
- **Actions:** none besides the input (save on blur → `PATCH /v1/admin/roles/:id { expected_version, idle_minutes }`).
- **Inputs:** number, minutes, default role's current (new role 15); 1–240; error "1 to 240 minutes".
- **Decisions:** minutes per role.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Saving | blur | chip | "Saving…" | `RolesIdle` |
| Saved | 200 | ok chip | "Saved" | `RolesIdle` |
| Out of range | 300 typed | error | "1 to 240 minutes" | `RolesIdle` |
| Not saved | network | value reverts; chip | "Not saved" | `RolesIdle` |
| Stale row | `CONFIG_STALE` | B03 inline on that row | "Someone changed this since you opened it." / "Reload shows the current version. Your changes here are not saved." / "Reload" | `RolesStale` |

- **Error codes:** `VALIDATION_FAILED`, `CONFIG_STALE`, `SERVICE_UNAVAILABLE`. **Edge cases:** two roles → the longer time. **Data needed:** `idle_minutes`, `version`.

### 01b-S09 · Change password (normal and forced)
- **Job:** the owner changes their password; after a support reset, they must choose a new one.
- **Entry points:** side nav foot **Change password**; B01 **Change password**; forced after signing in with a temporary password (`PASSWORD_CHANGE_REQUIRED`).
- **Exits:** success → stays (normal) / into the app (forced: Staff or the last page). Forced mode: only **Sign out** leaves.
- **Information shown:** app bar "Account" (MUST); "Change your password" / "For {email}" (MUST); explain "Other phones and laptops signed in to your account are signed out. Hub tablets and staff PINs are not affected." (USEFUL); caption "Forgot your password? Call support." (RARE).
- **Actions:** **Change password** — PRIMARY (busy "Changing…") → `POST /v1/auth/change-password { current_password, new_password }`; **Show** — SECONDARY; forced **Sign out** — SECONDARY.
- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Current password (forced: "Temporary password") | password | empty | required | `PASSWORD_INVALID` → "This is not your current password." |
| New password; help "At least 10 characters. A short sentence is easy to remember." | password + Show | empty | 10–200 | "Use at least 10 characters." / "Use at most 200 characters."; `PASSWORD_UNCHANGED` → "Pick a password you haven't used here." |
| Type the new password again | password | empty | equals new | "The two new passwords are different." |

- **Decisions:** new password.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | open | form | as above | `Password` |
| Errors | client / server | banner "3 things to fix" + fields | "3 things to fix" / "Current password · New password · Type it again" / field texts above | `PasswordErrors` |
| Same password | `PASSWORD_UNCHANGED` | new-password error | "Pick a password you haven't used here." | `PasswordUnchanged` |
| Too many tries | `429 IP_LOCKED_OUT` | banner | "Too many tries. Wait 15 minutes and try again." / "Nothing changed." | `PasswordTooMany` |
| Offline | network / 503 | warn banner | "Can't reach the restaurant cloud — retrying…" / "Nothing changed. Your old password still works. Try again when you are online." | `PasswordOffline` |
| Saved | 200 | ok banner; fields cleared | "Password changed." / "You stay signed in here. Other devices were signed out." | `PasswordSaved` |
| Forced (B05) | `must_change_password` | no side nav; banner; "Temporary password" label; Sign out in app bar | see 01b-B05 | `PasswordForced` |
| Forced phone | width 390 | same | "Choose a new password" / "Sign out" | `PasswordForcedPhone` |
| Phone | width 390 | one column; button at bottom | "Change password" / "Current password" / "New password" / "At least 10 characters." / "Type it again" / "Other devices signed in to your account are signed out." / "Forgot your password? Call support." | `PasswordPhone` |
| Support number set | `VITE_SUPPORT_PHONE` | caption | "Forgot your password? Call support on {phone}." | `SupportTexts` |
| Urdu RTL | Urdu | mirrored | "اکاؤنٹ" / "اپنا پاس ورڈ بدلیں" / "برائے" / "موجودہ پاس ورڈ" / "نیا پاس ورڈ" / "دکھائیں" / "کم از کم 10 حروف۔ چھوٹا جملہ یاد رکھنا آسان ہے۔" / "نیا پاس ورڈ دوبارہ لکھیں" / "آپ کے اکاؤنٹ سے سائن اِن دوسرے فون اور لیپ ٹاپ سائن آؤٹ ہو جائیں گے۔ ہب ٹیبلٹ اور اسٹاف کے پن متاثر نہیں ہوں گے۔" / "پاس ورڈ بدلیں" / "پاس ورڈ بھول گئے؟ سپورٹ کو فون کریں۔" | `PasswordUrdu` |

- **Error codes:** `PASSWORD_INVALID`, `PASSWORD_UNCHANGED`, `VALIDATION_FAILED`, `IP_LOCKED_OUT`, `PASSWORD_CHANGE_REQUIRED`, `SERVICE_UNAVAILABLE`.
- **Edge cases:** temporary password works once and expires 24 h after it was given (older → sign-in says wrong password); the response holds a new session the client keeps.
- **Data needed:** owner email, `must_change_password`; response token pair.

### 01b-S10 · Teams
- **Job:** see who reports to whom at a branch.
- **Entry points:** side nav "Teams" (`#/teams`); B04 **See team**.
- **Exits:** tap a name → 01b-S02 (`#/staff/:id`).
- **Information shown:** app bar "Teams" + branch select (MUST); intro "Who reports to whom at {branch}. Change a line on the person." (USEFUL); indented tree: name, role names, "No PIN" chip, team size "4 people in his team" / "2 people" (MUST); footer "People with no lead at this branch are at the top. A reporting line gives no extra permission." (RARE).
- **Actions:** name — SECONDARY; branch select — SECONDARY. Read-only (no drag and drop).
- **Inputs:** branch select (remembered per tab).
- **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Tree | loaded | indented list | Gulberg: Arif (Owner); Imran (Manager · Shift lead) "4 people in his team" → Hamza (Order taker · Shift lead) "2 people" → Bilal, Ali R. (Waiter); Usman (Cook) "No PIN"; Zubair (Waiter) | `Teams` |
| No reporting lines | nobody has a lead | flat list + note | "No reporting lines yet. Set "Reports to" on a person." | `TeamsFlat` |
| Nobody at branch | empty | empty block | "Nobody works at DHA yet." / "Give people DHA under "Works at" on their page." | `TeamsEmpty` |
| Cloud down | network | banner; last loaded tree | "Can't reach the restaurant cloud — retrying…" / "Showing the teams from 1:02 PM." | `TeamsCloudDown` |
| Phone | width 390 | stacked tree + hint | "Tap a name to change who they report to." | `TeamsPhone` |
| Branch not found | `BRANCH_NOT_FOUND` | UNKNOWN | — | none |
| Loading | fetching | UNKNOWN | — | none |
| Urdu RTL | Urdu | mirrored | "ٹیمیں" / "گلبرگ میں کون کس کو رپورٹ کرتا ہے۔ لائن شخص کے صفحے پر بدلیں۔" / "ٹیم میں 4 لوگ" / "2 لوگ" / "پن نہیں" / "جن کا اس برانچ میں کوئی لیڈ نہیں وہ اوپر ہیں۔ رپورٹنگ لائن سے کوئی اضافی اجازت نہیں ملتی۔" | `TeamsUrdu` |

- **Error codes:** `BRANCH_NOT_FOUND`, `SERVICE_UNAVAILABLE`. **Edge cases:** any depth; ~25 people. **Data needed:** `GET /v1/admin/branches/:b/team-tree` → `{ branch_id, roots: [{ staff_id, display_name, has_pin, role_ids, members[] }] }`.

### 01b-B01 · Owner lockout notice
- **Job:** tell the owner someone tried their password too many times.
- **Entry points:** the first screen after the next sign-in, or any open page when the session next refreshes (`lockout_notice`).
- **Exits:** **Got it** hides it; **Change password** → 01b-S09.
- **Information shown:** danger banner "Someone tried to sign in to your account with a wrong password {n} times on {date} at {time}." / "If this wasn't you, change your password." (MUST).
- **Actions:** **Change password** — SECONDARY; **Got it** — SECONDARY.
- **Inputs:** none. **Decisions:** change password or dismiss.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| After sign-in | `lockout_notice` in login | banner on first page | "…10 times on 27 Oct at 10:42 PM." | `OwnerLockNotice` |
| On any page | refresh returns it | banner on that page | same | `RolesLock` |
| Phone | width 390 | banner | same | `StaffPhoneLock` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** none. **Edge cases:** shown once; `{n}` = `failed_count` (10). **Data needed:** `lockout_notice { locked_at, failed_count }`.

### 01b-B02 · Saved — reaches each branch
- **Job:** confirm a save and warn if a branch hub is behind.
- **Entry points:** after any staff, role, stock-counting or branch-settings save.
- **Exits:** none.
- **Information shown:** ok banner "{name} saved. Changes reach each branch within about a minute." (MUST); warn line per affected branch that is behind "{branch} hub last checked {n} min ago." / "It gets the change when it is back online." (MUST when present).
- **Actions:** none. **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Saved, a hub behind | save + stale branch | ok + warn | "Hamza saved. Changes reach each branch within about a minute." / "Johar Town hub last checked 12 min ago." / "It gets the change when it is back online." | `StaffSaved` |
| Stock counting saved | S05 save | ok | "Stock counting at Gulberg saved. Changes reach each branch within about a minute." | `ResponsibilitiesSaved` |
| Settings saved | S07 save | ok | "Settings saved. Gulberg gets them within about a minute." | `BranchSettingsSaved` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** none. **Edge cases:** threshold from `hub_stale_after_ms`. **Data needed:** branch hub times.

### 01b-B03 · Someone changed this — Reload
- **Job:** stop the owner overwriting someone else's change.
- **Entry points:** `409 CONFIG_STALE` on S02, S04, S05 and the S03 idle row; also two tabs on the same page.
- **Exits:** **Reload** shows the current record, dropping unsaved changes.
- **Information shown:** warn banner "Someone changed this since you opened it." / "Reload shows the current version. Your changes here are not saved." (MUST).
- **Actions:** **Reload** — PRIMARY.
- **Inputs:** none. **Decisions:** reload.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Staff form | stale save | banner on top | as above | `StaffFormStale` |
| Role editor | stale save | banner | as above | `RoleEditorStale` |
| Stock counting | stale save | banner | as above | `ResponsibilitiesStale` |
| Roles idle row | stale idle save | inline on row | as above | `RolesStale` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** `CONFIG_STALE`. **Edge cases:** never caused by the owner's own previous action. **Data needed:** `version`.

### 01b-B04 · People moved to a new lead
- **Job:** show who now reports to whom after a leaver or a branch removal.
- **Entry points:** S01 after a save whose response has `moved_reports`.
- **Exits:** **See team** → 01b-S10.
- **Information shown:** info lines "{n} people now report to {lead} at {branch}: {names}." / "1 person now reports to nobody at {branch}: {name}." (MUST).
- **Actions:** **See team** — SECONDARY.
- **Inputs:** none. **Decisions:** whether to fix lines.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Shown | `moved_reports` not empty | under B02 | "Hamza saved. Changes reach each branch within about a minute." / "2 people now report to Imran at Gulberg: Bilal, Ali R." / "1 person now reports to nobody at Johar Town: Sana." / "See team" | `StaffMoved` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** none. **Edge cases:** many people → list length UNKNOWN. **Data needed:** `moved_reports`.

### 01b-B05 · Must change password (forced)
- **Job:** make the owner choose a new password after a support reset.
- **Entry points:** S09 forced mode.
- **Exits:** success → into the app; **Sign out**.
- **Information shown:** banner "Choose a new password to continue." / "The temporary password from support works only once and expires 24 hours after it was given." (MUST); no side nav (only brand + Sign out).
- **Actions:** **Change password** — PRIMARY; **Sign out** — SECONDARY.
- **Inputs:** as S09 with "Temporary password".
- **Decisions:** new password.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Laptop | forced | no nav; banner | as above | `PasswordForced` |
| Phone | forced, 390 | app bar "Choose a new password" + Sign out | as above | `PasswordForcedPhone` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** `PASSWORD_CHANGE_REQUIRED`, plus S09 codes. **Edge cases:** every other page redirects here. **Data needed:** `must_change_password`.

---

## 4. Flows

**F1 New waiter (laptop)**
1. 01b-S01 → **Add staff** → 01b-S02 new: name "Ali R.", role Waiter, Works at Gulberg, Reports to Hamza, tick "They are next to me" → **Add staff**.
   - Failure: field errors banner; `STAFF_NAME_TAKEN` "Another Ali works at Gulberg…"; offline "Nothing was saved…".
2. 01b-D01 (laptop) New PIN ×2 → **Save PIN** → "Ali R.'s PIN is saved" / "He now appears on the sign-in screens at Gulberg."
   - Failure: mismatch; too short; offline "A new PIN needs the internet…".
3. 01b-S01 + B02 (warn if the Gulberg hub is behind). Within ~1 min Ali is on Gulberg tablets.

**F2 Forgot PIN in the rush (owner phone)**
1. 01b-S01 phone → search "bil" → **Reset PIN** on Bilal.
2. 01b-D01 phone: hand over → step 1 → **Next** → step 2 → **Save**.
   - Failure: PINs differ → back to step 1; offline → "Bilal's old PIN still works."
3. "Bilal's PIN is saved … Take the phone back." → **Done**. ≤ 8 taps + 8 digits.

**F3 Leaver with a team**
1. 01b-S02 Hamza → **Mark as left** → 01b-D02 (2 people move to Imran; Sana to nobody) → **Mark as left**.
   - Failure: linked to owner → blocked; last admin → blocked; offline → Try again; stale → B03.
2. 01b-S01 + B02 + B04 → **See team** → 01b-S10.
3. Hub: Hamza's phone shows "Removed" in 00-S16.

**F4 New role "Shift lead"**
1. 01b-S03 → **New role** → 01b-S04: Remove a cooking item = Needs approval by Manager or Owner; Approve removing an item = Allowed, My team; Free a table someone else has open = Allowed, Their floors → **Save role**.
   - Failure: name taken; no approver; idle out of range.
2. 01b-S02 Imran → add Shift lead → floors appear (C04) → pick floors → **Save** → C02 shows the result.

**F5 Last-admin / own-admin guard**
1. 01b-S04 Owner role → turn off "Open hub admin" → snaps back + dialog "You can't remove your own admin access."
2. 01b-S04 Manager role (only admin at Johar Town) → turn off "Pair and remove screens" → snaps back + dialog naming Johar Town.

**F6 Forced password change after a support reset**
1. 01a-S01 sign in with the temporary password → 01b-S09 forced (B05) → new password ×2 → **Change password** → into the app.
   - Failure: temporary password older than 24 h → sign-in says wrong → call support. Too many tries → wait 15 min.

**F7 Stock counter**
1. 01b-S05 Gulberg → BBQ grill → **Change** → pick Usman → **Done** → **Save** → B02.
   - Failure: stale → Reload; 422 → "Something changed. Reload and pick again."; no stations → Open Kitchen stations.
2. 01b-S04 Cook role: "Count stock and switch items off" = Allowed, Their stations; "Open hub admin" = Allowed → **Save role**.
3. Hub 01a-S10/S11: Usman sees only his stations, no Start/Close day.

**F8 Archive a role**
1. 01b-S03 → **Archive** on Shift lead → 01b-D03 confirm → **Archive Shift lead** → B02.
   - Failure: someone's only role → blocked "Open Usman"; approves for others → blocked "Open Cashier"; last admin / own admin → blocked.

**F9 Two tabs**
1. Edit Cashier in two tabs → save one → save the other → B03 → **Reload**.

**F10 Owner not linked**
1. 01b-S02 → remove someone's admin access → banner "Your owner login isn't linked to your staff profile yet…" → call support.

**F11 Branch rename and settings**
1. 01b-S06 → **Rename** → 01b-D04 → **Rename** → ok banner. Failure: name taken.
2. 01b-S06 → **Settings** → 01b-S07 → change → **Save settings** → ok banner. Failure: out of range; gap not less than stale hours.

---

## 5. Components used

| Component | Screens |
|---|---|
| Owner app shell (side nav with People and Branches groups and counts; foot Change password + Sign out; phone overlay) | all except forced S09 |
| App bar (back link, title, branch select, Cancel + primary) | S01–S07, S09, S10 |
| List rows (name, chips, meta, row actions; phone stacked rows) | S01, S03, S03a, S05, S06 |
| Chip toggles (roles, branches, floors, approver roles, picker people/roles) | S02, C01, C04, S05 picker |
| Status chips (Set / Not set / Left / Default / Open / Not open yet / No PIN / Saved / Saving… / Not saved) | S01, S03, S06, S08, S10 |
| Segmented control (Working here/Left, Active/Archived, Allowed/Needs approval/Not allowed) | S01, S03, C01 |
| Select (branch filter, Reports to, Where) | S01, C03, C01, S05, S10 |
| Grant control row (C01) | S04 (reused by later modules) |
| Effective-permission panel (C02) | S02 |
| PIN fields ×2 (laptop) / kit PIN pad two steps (phone) | D01 |
| Dialog (confirm, blocked with "Open {x}", form) | D01, D02, D03, D04, S04 guards, S05 picker |
| Banner (ok saved + warn hub-behind; warn stale + Reload; info moved + See team; danger lock + Got it; danger tenant/not linked; cloud unreachable) | B01–B05, S01, S02, S03, S05, S09, S10 |
| Error summary banner ("{n} things to fix" + list) | S02, S04, S09 |
| Inline save-on-blur number with status chip | S08 |
| Indented tree list | S10 |
| Empty / not-found full-page state | S01, S02, S03a, S04, S05, S10 |
| Skeleton rows | S01 |
| Switch | S07 (tax), S02 ("They are next to me") |
| Number field with unit affix (min, hours) | S04, S07, S08 |
| Password field with Show | S09 |
| Bottom action bar (phone) | S02, S04, S05, S07, S09 |
| Support text with optional number | S02, D02, D03, S04, S06, S09 |

---

## 6. Open questions

1. **Branch settings tabs.** Every S07 frame shows tabs "General · Kitchen timing · Voids and returns", but only Tax and Business day settings exist (spec: "Later settings … will appear here"). Are the extra tabs meant to show now? (Possible invented UI.)
2. **"Set the PIN right after adding — They are next to me".** Shown on the new-staff form; the spec only says Add staff then D01 or back to S01 ("proposed"). Is it a switch, a checkbox or a button, and what is its default? UNKNOWN.
3. **Proposed copy with no frame:** PIN section "No PIN yet. They don't appear on sign-in screens until one is set."; `not_at_branch` Reports-to error; `not_found` role error; `BRANCH_NOT_FOUND` on Works at; `IDEMPOTENCY_KEY_MISMATCH` "Something went wrong. Try again."; approver archived in C01; D01 offline "They still have no PIN."; role-editor offline "Nothing was saved."; rename empty/too long; Teams `BRANCH_NOT_FOUND`.
4. **Missing state frames:** loading for S03, S05, S06, S10; cloud down for S05, S06, S07, D04; offline/stale for D03; Urdu for every banner (B01–B05), D01 laptop, D02, D03, D04, S03a, S09 errors, S02 error states.
5. **Phone shell.** Spec 01a v1.3.1 uses a Menu button + overlay side menu at phone width; no 01b phone frame shows how the nav opens.
6. **Hub-side items (owned by 01a pages):** the "Counts stock" label on the stock sign-in is not built (plan task T62). The stock counter "day not started" frame names "like Imran" and hides rows, while the spec (AD-33) keeps rows usable and says the query carries no names — see 01a brief §6.
7. **Developer questions that may change screens:** D-2 (`own_tables` scope unused; 02 decides), D-3 (a stock counter needs "Open hub admin"; may become a stock-only sign-in in 02), D-4 (approval outside an allowed scope; 04 decides).
8. **Deferred (do not design now):** "Made by" on roles; branch rename reaching the hub; audit viewer (07); manager cloud login (P2); e-mail password reset.
9. **Pronouns in frame copy** ("Tell Hamza his new PIN", "He can't sign in anywhere", "4 people in his team", "Give him another role first") vs gender-neutral string keys ("Tell {name} their new PIN"). Which wording ships?
10. **Example in RoleArchiveLastAdmin.** Frame says "…to another role first, such as Shift lead."; inventory says "such as Manager." Is the suggested role fixed text or computed?
11. **S01 lists role chips for "Arif" as Owner with Works at "Gulberg, DHA"** while DHA is "Not open yet" — can staff be assigned to a branch with no hub? (Spec allows it; confirm the UI shows it this way.)
12. **Phone S09 copy** differs from laptop ("Type it again", "Other devices signed in to your account are signed out.") — intended short forms?

---

## 7. Clutter report

| Screen | Problem (from the marks above) | What could move behind "More" or a second tap |
|---|---|---|
| 01b-S02 Staff form | 7 sections (Who, Reports to, Floors, PIN, Never allow, Status) plus the C02 panel; Never allow is RARE; Status/Mark as left is DESTRUCTIVE and sits in the main flow | Move "Never allow" behind an "Advanced" disclosure; move **Mark as left** into a "More" menu in the app bar; keep C02 collapsed to a one-line summary ("5 allowed") on laptop too, expanding on tap |
| 01b-S01 Staff list | Each row has Reset PIN and Edit buttons plus 4 columns; "Since {date}" under PIN is RARE | Keep **Reset PIN** (rush) visible; make the whole row open Edit; drop "Since {date}" to a tooltip |
| 01b-S04 Role editor | 20 permission rows × 3-way segment, with Approved by and Where expanding inline; the explain box takes space every time | Collapse groups (Orders and tables open, others closed); show only rows that are not "Not allowed" by default with "Show all 20"; move the explain box behind an info icon |
| 01b-S03 Roles list | Every row shows Edit, Archive and an inline idle input; idle note is RARE | Move **Archive** into a row "More" menu; keep idle input; move the note to help |
| 01b-S05 Stock counting | Footer help (RARE) and per-station warn banners compete with rows | Turn per-station warnings into a warn chip on the row with one summary banner; move the help line into an info icon |
| 01b-S06 Branches | ID tail (RARE) and footer note (RARE) on every visit; Rename and Settings both per row | Hide ID tails behind hover; move **Rename** into the Settings page or a row menu |
| 01b-S07 Branch settings | Three tabs where only one has settings | Remove empty tabs until their settings exist |
| 01b-D01 PIN (phone) | Already minimal: one action per step | — |
