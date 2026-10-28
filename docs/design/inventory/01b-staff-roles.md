# 01b — Staff and Roles: screen inventory

**Spec:** `docs/specs/01b_Staff_Roles_Spec_v1.0.md` (**APPROVED** 2026-10-27, with 00 v1.5 and 01a v1.3). Every API name, field, limit and error code below comes from that spec; section numbers are cited as `§`. Where the spec gives no wording, the text is marked *(proposed copy)* and the designer may change it, but not the behaviour. Rewritten 2026-10-27 to replace the pre-spec inventory of 2026-10-26, so the 01b design can be regenerated. Conventions in [00-index.md](00-index.md).

**What changed since the first design hand-off** (`pos-design-01b-handoff/01b`, 30 frames) is listed in §10 at the end: the frames that must be redrawn, and the screens and states that have no frame yet.

**Status:** spec approved; backend being built (plan `docs/plans/01b-plan.md`); **no 01b owner page is built yet** (`apps/client/src/features/owner/` has no staff, roles, teams, branches or account folder).

---

## 1. Who and where

| Who | Device | Network | How often | Conditions |
|---|---|---|---|---|
| **Owner** (the only cloud login in P1, covers every branch, B8) | Laptop 1440 (L); owner phone 390 (OP) | Internet only (cloud owner app, entry `owner`). Every write needs the cloud | Setup: ~25 staff, 6 default roles. Then: a new person or a leaver weekly; PIN resets a few times a week, often **during the rush** | Rush case: owner on the phone, the staff member standing next to them |
| Staff member | types their own PIN on the owner's phone (D01 phone) | — | when a PIN is set or reset | the owner does not see the PIN |
| Support (phone call) | — | — | rare | resets the owner password (temporary password read over the phone) and links the owner login to their staff profile; no screen in the owner app |
| Stock counter on the hub | hub stock page (01a-S10, S11) | LAN | daily | sees only their stations' rows (§9) |

**Every 01b owner screen is designed at 1440 × 900 and 390 × 844, in English and in Urdu (RTL)** (spec §10.9 tests every page at both sizes and in both languages). Phone layouts use `.pos-list--stack` rows and a bottom action bar.

## 2. Jobs to be done

| # | Job | Source | Acceptance |
|---|---|---|---|
| J1 | See my branches by name, and whether each hub is up to date. | 01a S58, B19 | name, status, "Hub checked {ago}", "Up to date {ago}", warning when behind |
| J2 | Create a role with a name and permissions. | E6-ROLE AC1, AC2 | 20 permissions today, grouped; more appended later |
| J3 | Set each permission to Allowed / Needs approval (by which roles) / Not allowed, and where it applies. | E6-ROLE AC3, B2, B10 | several approver roles; scope only where the permission accepts one |
| J4 | Give a person one or more roles and see the result. | E6-ROLE AC4 | most generous grant wins; widest scope; denial always wins |
| J5 | Block one permission for one person. | E6-ROLE AC4 | "Never allow", owner only, always wins |
| J6 | Every change is logged. | E6-ROLE AC5 | audit row with before/after; **no viewer in 01b** (07, Q5) |
| J7 | Start with default roles and change them. | E6-ROLE AC6, B17 | 6 defaults: Owner, Manager, Cashier, Order taker, Waiter, Cook; renaming keeps them working |
| J8 | Never lock myself or a branch out of the hub admin. | E6-ROLE AC7 + edge, B7 | last-admin and own-admin guards with clear messages |
| J9 | Add staff, assign branches, mark a leaver, bring someone back. | R3 | leaver: out of every hub within ~1 min, sessions end, phone removed |
| J10 | Set or reset a PIN, even during the rush. | E0-PIN AC7, B9 | 4–6 digits, twice; needs internet; ends their sessions; duplicates allowed |
| J11 | Say who reports to whom at each branch, and see the teams. | E6-TEAM AC1–5, B1 | one lead per branch, no loops, leaver's people move up, team tree |
| J12 | Say which floors a person works on (for roles limited to "their floors"). | B2, Q11 | floors per branch |
| J13 | Say who counts stock for each station. | 01a S38, B4 | person(s) or role(s) per station; counters see only their stations |
| J14 | Set branch settings: tax, stale-day hours, start-day gap. | 01a §6.7, B16 | tax off by default; 1–48 h; 0–12 h; stale > gap |
| J15 | Set how long each role stays signed in while idle. | E0-PIN AC4, B13 | per role, 1–240 min; two roles → the longer |
| J16 | Be told my account was locked after wrong passwords. | 00 M73 | notice once, after the next sign-in or session refresh |
| J17 | Change my password; after a support reset, be made to choose a new one. | Q9, B5 | 10–200 characters; other devices signed out |

## 3. Screen list

| ID | Name | Kind | Route | In first hand-off? |
|---|---|---|---|---|
| 01b-S01 | Staff list | screen | `#/staff` | yes |
| 01b-S02 | Staff form (new / edit) | screen | `#/staff/new`, `#/staff/:id` | yes — **redraw** (§10) |
| 01b-C02 | "What {name} can do" (effective permissions) | panel in S02 | — | yes — **redraw** |
| 01b-C03 | Reports to (per branch) | field group in S02 | — | **no** |
| 01b-C04 | Floors they work on (per branch) | field group in S02 | — | **no** (replaces "Which tables") |
| 01b-D01 | Set / reset PIN (laptop dialog, phone hand-over) | dialog / full screen | — | yes |
| 01b-D02 | Mark as left | dialog | — | yes — add states |
| 01b-S03 | Roles list (with idle limits, S08) | screen | `#/roles` | yes — **redraw** |
| 01b-S03a | Archived roles + Restore | state of S03 | `#/roles` (archived view) | **no** |
| 01b-S04 | Role editor | screen | `#/roles/new`, `#/roles/:id` | yes — **redraw** |
| 01b-C01 | Grant control (Allowed / Needs approval / Not allowed + Approved by + Where) | component | — | yes — **redraw** |
| 01b-D03 | Archive role: confirm / blocked (4 reasons) | dialog | — | partly (1 of 4 blocked reasons) |
| 01b-S05 | Stock counting (who counts which station) | screen | `#/stock-counting` | yes |
| 01b-S06 | Branches | screen | `#/branches` | yes — **redraw** |
| 01b-D04 | Rename branch | dialog | — | **no** |
| 01b-S07 | Branch settings | screen | `#/branches/:id/settings` | yes — fix default and add a rule |
| 01b-S08 | Idle limits | column in S03 + field in S04 | — | yes |
| 01b-S09 | Change password (normal and **forced**) | screen | `#/account/password` | yes — **add forced mode** |
| 01b-S10 | Teams (team tree) | screen | `#/teams` | **no** |
| 01b-B01 | Owner lockout notice | banner | any owner screen | yes — fix count |
| 01b-B02 | Saved — reaches each branch in about a minute (+ hub behind) | banner | after a save | yes — fix rule |
| 01b-B03 | Someone changed this since you opened it — Reload | banner | S02, S04, S05, S03 inline idle | **no** |
| 01b-B04 | People moved to a new lead | banner | after mark-as-left or removing a branch | **no** |
| 01b-B05 | Must change password (forced mode banner) | banner | S09 | **no** |

**Count: 24** (15 from the first inventory, plus S09, S10, S03a, D04, C03, C04, B03, B04, B05). The owner side nav: **People** group (Staff · Roles · Teams · Stock counting), **Branches** group (Branches and settings), footer **Change password** above **Sign out**.

## 4. Rules every screen follows

| Rule | Source |
|---|---|
| **Owner only.** There is no read-only view and no manager login in P1. | B8, Q1 |
| **Every write needs the internet.** If the cloud cannot be reached (network error or `503 SERVICE_UNAVAILABLE`), show the existing cloud-unreachable banner (01a-B04) and keep the page; **never** go to the sign-in page on a 503. | 01a S53, §6.13 |
| **The owner app never re-sends a failed write by itself.** The owner taps Try again. | 01a S53 |
| **Changes reach a branch on its next hub check (about a minute).** After every staff, role or stock-counting save, show B02. | B11, 01a §6.1 |
| **Edit forms carry a version.** Staff, role and stock-counting forms save with `expected_version`. If someone or something changed the record meanwhile, the save is refused with `409 CONFIG_STALE` → B03, keeping nothing of the stale form. The owner's own earlier action (a PIN reset, an archive that touched the person) **never** makes the next save stale: the client updates its versions from every response. | B23, §8 |
| **Role names carry no behaviour.** No screen hides, shows or changes anything because a role is called "Waiter" or "Owner". Renaming a default role changes nothing but the label. | §3.8, R5 |
| **Never show a permission key.** Always the plain label (§5.4 table). | design |
| **Signed out elsewhere.** If the password was changed or reset on another device, the next request gets `401 JWT_INVALID`; after a failed refresh the app goes to the owner sign-in page (01a-S01). No special message. | §6.13, §8 |
| **Forced password change.** While `must_change_password` is set, every owner route answers `403 PASSWORD_CHANGE_REQUIRED` → the app goes to S09 in forced mode; every other page redirects there. | §3.7, §8 |
| **Support number.** The app shows "Call support." with **no number**, unless the optional build value `VITE_SUPPORT_PHONE` is set; then " on {phone}" is added before the full stop. Design both variants. | §8, owner Q3 |
| **Hand-edited owner record.** Every write → `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`. Show a generic danger banner: *"You can't make changes for this restaurant. Call support."* (proposed copy). Reads still work. | B8, test 8 |

## 5. Per screen

### 01b-S01 Staff list — `#/staff`

**Purpose:** find a person fast, see roles, branches and PIN state. **Entry:** nav "Staff". **Exit:** S02, D01.

**Data:** `GET /v1/admin/staff?status=active|left&branch_id?` (§6.1) → `StaffWire[]`: `staff_id, display_name, role_ids, branch_ids, denied_permissions, has_pin, pin_set_at, is_active, left_at, reports_to[{branch_id, lead_staff_id}], floors[{branch_id, floor_ids}], version`. Role names come from `GET /v1/admin/roles`, branch names from `GET /v1/admin/branches`. **Search is client-side** (no `q` parameter). No pagination (design size 500).

**Layout (laptop):** app bar "Staff" + primary **Add staff** · search (`Find a name`) · branch select (All branches + each branch) · segmented **Working here N | Left N** · list: Name | Roles (chips) | Works at | PIN | actions **Reset PIN** / **Set PIN**, **Edit**.
**Phone:** stacked rows "Bilal · Waiter · Gulberg", **Reset PIN** beside the name (primary on the first match while searching) — rush flow ≤ 8 taps + digits.

**PIN column:**
| `has_pin` | Chip | Note |
|---|---|---|
| true | ok "Set" | — |
| false | warn "Not set" | tooltip/help: *"Not on sign-in screens until a PIN is set."* (proposed copy; B3: a person with no PIN is not sent to any hub) |
| left | info "Left {date}" | no PIN action |

**States**
| State | What shows |
|---|---|
| Loading | skeleton rows |
| Empty (first run) | `.pos-empty` "Add your first staff member" + **Add staff** + note: **"6 roles are ready: Owner, Manager, Cashier, Order taker, Waiter, Cook. You can change them in Roles."** |
| No match | "No one called "{q}"" + "Check the spelling, or look under Left." + **Show people who left** |
| Left view | muted rows, "Left {date}", no PIN action; note "People who left keep their name in old orders and the audit log. Edit one to bring them back." |
| Branch filter with nobody | "Nobody works at {branch} yet." (proposed copy) |
| Saved | B02 (+ B04 when people moved) |
| Cloud unreachable / 503 | list kept as last loaded, "Showing the list from {time}. PINs and changes need the internet."; Add / Reset PIN / Edit disabled |
| Lockout notice | B01 on top |

**Sample:** Arif (Owner, all branches), Imran (Manager + Shift lead, Gulberg), Sana (Cashier, Johar Town), Hamza (Order taker, Gulberg), Bilal, Ali R., Zubair (Waiter, Gulberg), Usman (Cook, no PIN, Gulberg).

### 01b-S02 Staff form — `#/staff/new`, `#/staff/:id`

**Layout (laptop):** app bar: back "Staff" · title ("New staff member" / "Edit {name}") · Cancel · primary **Add staff** / **Save**. Two columns (`.pos-split` 1fr | 380px): form sections on the start side, C02 on the end side. **Phone:** one column, C02 collapsed under a "What {name} can do" disclosure, Save in the bottom action bar.

**Sections and fields**

| Section | UI | API field | Rule | Default | Req |
|---|---|---|---|---|---|
| Who | Name on the sign-in screen | `display_name` | 1–40, trimmed; unique among **active** staff at each branch they work at, case-insensitive (B12) | — | yes |
| Who | Roles (chip toggles, `button.pos-chip[aria-pressed]`) | `role_ids[]` | ≥ 1, active roles only | — | yes |
| Who | Works at (branch chip toggles) | `branch_ids[]` | ≥ 1 | the branch picked in the list filter, if any | yes |
| Reports to (C03) | one select **per branch they work at**: "Reports to at {branch}" | `reports_to[{branch_id, lead_staff_id}]` | at most one lead per branch; lead must be active and work at that branch; no loop | "Nobody" | no |
| Floors they work on (C04) | floor chip toggles **per branch they work at** | `floors[{branch_id, floor_ids}]` | floors of that branch, not archived | none | no |
| PIN | text + **Set PIN** / **Reset PIN** → D01 | — (separate route) | — | — | — |
| Never allow (owner only) | list of blocked permissions + **Add** (permission picker, plain labels) + Remove | `denied_permissions[]` | any catalogue permission | nothing blocked | no |
| Status | "Working here. Can sign in at their branches." + **Mark as left** (danger) → D02 / "Left. Can't sign in anywhere." + **Bring back** | `is_active` | — | working | — |

**C03 Reports to — rules for the designer**
- One select per branch in "Works at"; adding a branch adds a select, removing one removes it.
- Options: active people who work at that branch, except the person themself. People without a PIN may be leads (e.g. a lead cook).
- Help: *"Who this person reports to at {branch}. A reporting line gives no extra permission."* (proposed copy; R5, E6-TEAM AC5).
- **Not in any first-hand-off frame.**

**C04 Floors they work on — when it shows**
- Shown **only when one of the person's selected roles has a grant with scope "their floors"** (`my_floors`; today possible on *Take orders at any table* and *Free a table someone else has open*). Otherwise hidden (the stored floors are kept).
- One chip group per branch in "Works at", listing that branch's active floors.
- Help: *"Their role decides what they can do; this decides on which floors."* (proposed copy).
- **Replaces** the first hand-off's "Which tables: Any table | Tables they open | Chosen floors" segmented control. **There is no per-person "Any table / Tables they open" choice** — where a permission applies is set on the role (C01).

**PIN section text**
- New: "Set it after saving, or now if they are next to you."
- Edit, PIN set: "Set on {date}. Resetting signs them out everywhere."
- Edit, no PIN: "No PIN yet. They don't appear on sign-in screens until one is set." (proposed copy)

**Actions**
- New: `POST /v1/admin/staff` with `Idempotency-Key` (§6.2). Then back to S01 with B02, **or** straight into D01 if the owner tapped "Set PIN now" (proposed).
- Edit: `PATCH /v1/admin/staff/:id` with `expected_version` and only the changed fields (§6.4).
- On success → S01 + B02; if the response's `moved_reports` is not empty → also B04.

**Errors** (each needs a designed state; StaffFormErrors frame must show all field errors)

| Code (`details`) | Where | Text |
|---|---|---|
| `400 VALIDATION_FAILED` | field errors + top banner "{n} things to fix" | per field: "Up to 40 letters", "Pick at least one role", "Pick at least one branch" |
| `409 STAFF_NAME_TAKEN {display_name, branch_id}` | Name field | "Another {name} works at {branch}. Add a letter, e.g. {name} R. or {name} K." (also on **Bring back**: the name was taken meanwhile) |
| `409 OWN_ADMIN_ACCESS {branch_ids}` | Roles field (or Never allow / Works at, whichever the change was) | "You can't remove your own admin access. Call support." (+ number variant) |
| `409 OWN_ADMIN_ACCESS {reason:'owner_not_linked'}` | danger banner | "Your owner login isn't linked to your staff profile yet, so admin access can't be removed. Call support to link it." |
| `409 LAST_ADMIN_REQUIRED {branch_ids}` | Roles field | *"{branch} would have nobody who can open the hub admin and pair screens. Give someone else admin access there first."* (proposed copy; must **name the branches**) |
| `409 STAFF_LINKED_TO_OWNER` | Status section | "This profile is linked to the owner login and can't be marked as left." |
| `409 CONFIG_STALE` | B03 | "Someone changed this since you opened it." + **Reload** |
| `422 CONFIG_REFERENCE_INVALID` `reason: 'role_archived'` | Roles field | *"{role} was archived. Pick another role."* (proposed) — also when bringing back a person whose only role was archived: Bring back must then ask for a role |
| `… reason: 'not_found'` | Roles field | *"This role no longer exists. Reload the page."* (proposed) |
| `… reason: 'not_at_branch'` (reports_to) | that branch's Reports to | *"{lead} doesn't work at {branch} any more. Pick someone else."* (proposed) |
| `… reason: 'loop'` | that branch's Reports to | *"{lead} already reports to {name} at {branch}. Pick someone else."* (proposed) |
| `… reason: 'wrong_branch'` / `'archived'` (floors) | that branch's floors | *"A floor was archived or moved. Reload and pick again."* (proposed) |
| `… reason: 'one_lead_per_branch'` | cannot happen from this UI (one select per branch) | — |
| `404 STAFF_NOT_FOUND` | full-page state | *"This person can't be found. They may have been removed."* + back to Staff (proposed) |
| `404 BRANCH_NOT_FOUND` | Works at | *"A branch is no longer available. Reload."* (proposed) |
| `403 tenant_wide_write` | banner | §4 rule |
| Network / 503 | 01a-B04, form kept, Save enabled again | "Nothing was saved. Try again when you are online." (proposed) |
| `422 IDEMPOTENCY_KEY_MISMATCH` | banner | generic "Something went wrong. Try again." |

**Side effects the form must explain** (help text or confirm):
- Removing a branch from a person removes their lead, floors and stock counting at that branch, and moves the people who reported to them there up to their own lead → B04 lists who moved.
- A PIN is not part of this form's save (D01).

### 01b-C02 What {name} can do

Computed **in the browser** from the roles and denials on the page (§3.3, no endpoint). Recomputes live as roles or denials are toggled.

| Final grant | Line |
|---|---|
| Allowed | "Allowed · from {role}" + scope if not whole branch: "· on their floors" / "· for their team" / "· for their stations" |
| Needs approval | "Needs approval · approved by {role A} or {role B}" (union of all approver roles, sorted) |
| Not allowed | "Not allowed · no role gives it" |
| Never (denied) | "Never · blocked for {name}" |

Rules shown in one line: "Roles add up: the most generous grant wins, and the widest place. A "Never" always wins."
- Allowed beats Needs approval; a wider scope on a "Needs approval" role does **not** widen an "Allowed" one (§3.3, test 12).
- Show the 6 most relevant (changed first, then risky), plus **See all 20**.
- A person with only Waiter or Cook: every row "Not allowed" (defaults have no grants).

### 01b-D01 Set / reset PIN

**Laptop dialog:** "New PIN for {name}" · two masked code fields "New PIN" / "Type it again" (4–6 digits, `inputmode=numeric`, LTR) · help "4 to 6 digits. Two people may have the same PIN." · "{name} is signed out on every device when you save. Anything they haven't sent stays on the device." · **Save PIN**.
**Phone hand-over (full screen):** info banner "Hand the phone to {name}. They type their new PIN twice. You won't see it." · kit PIN pad, step 1 "Type a new PIN", step 2 "Type it again". The PIN lives only in the page and is cleared after the request.

**Action:** `PUT /v1/admin/staff/:id/pin { pin }` (§6.3). Every save is a reset (signs them out everywhere), even with the same PIN.

| State | Text |
|---|---|
| Mismatch | "The two PINs are different. Type them again." |
| Too short / not digits | "PIN is 4 to 6 digits." |
| Saving | button busy |
| Saved | "{name}'s PIN is saved." / "It works at {branch} in about a minute. Tell {name} their new PIN." (several branches: "It works at Gulberg and Johar Town in about a minute.") |
| First PIN for someone who had none | same as Saved, plus "They now appear on the sign-in screens at {branches}." (proposed) |
| Network / 503 | "A new PIN needs the internet. Nothing changed." / "{name}'s old PIN still works. Try again when you are online." (no PIN yet: "They still have no PIN.") |
| `404 STAFF_NOT_FOUND` (person marked as left meanwhile) | *"{name} was marked as left, so a PIN can't be set."* (proposed) |

### 01b-D02 Mark as left

"Mark {name} as left?" · "They can't sign in anywhere, and their phone is removed from {branch} within about a minute. Their name stays on old orders. You can bring them back later." · if they have direct reports (known from the staff list): *"{n} people who report to {name} will report to {their lead} instead."* / *"…will report to nobody."* (proposed copy; B15) · Cancel / **Mark as left** (danger).

Action: `PATCH /v1/admin/staff/:id { expected_version, is_active: false }`.

| Outcome | Shown as |
|---|---|
| Done | S01 + B02 + B04 (if people moved) |
| `409 STAFF_LINKED_TO_OWNER` | dialog changes to blocked: "This profile is linked to the owner login and can't be marked as left." + Close |
| `409 OWN_ADMIN_ACCESS` / `LAST_ADMIN_REQUIRED` | blocked variant with the S02 texts |
| `409 CONFIG_STALE` | B03 |
| Network | "Nothing changed. Try again when you are online." |

**Bring back** (on S02 of a person who left): `PATCH { expected_version, is_active: true }`. PIN kept; old reporting lines **not** restored; stock counting not restored. If their only role was archived → `422 role_archived` → the form asks for a role first. If their name is now taken → `STAFF_NAME_TAKEN`.

### 01b-S03 Roles list — `#/roles` (with S08 idle limits)

**Data:** `GET /v1/admin/roles?archived=false|true` (§6.5) → `RoleWire[]`: `role_id, name, is_default, archived_at, idle_minutes, staff_count, grants[], version`.

**Layout:** app bar "Roles" + **New role** · intro "A role is a set of things people may do. Nothing on the screens depends on a role's name." · list: name + **Default** chip when `is_default` · People (`staff_count`, active staff) · **Signs out after idle** `[ N ] min` inline · **Edit** · **Archive** · segmented or toggle **Active | Archived** (S03a).
- **No "Made by Arif" line** (deferred, §12.4).
- Idle note: "Someone with two roles gets the longer time. Tablets sign out after this many idle minutes."

**Seeded roles (6)**
| Role | Idle | Grants out of the box |
|---|---|---|
| Owner | 60 | everything, whole branch |
| Manager | 60 | everything except Change roles |
| Cashier | 15 | Give a discount: needs approval by Manager; Reprint a kitchen ticket: allowed |
| Order taker | 15 | none yet (ordering module adds them) |
| Waiter | 5 | none yet; used to place people in teams |
| Cook | 5 | none yet; cooks work through kitchen screens without a PIN |

**Inline idle edit:** saves on blur → `PATCH /v1/admin/roles/:id { expected_version, idle_minutes }`. States: saving, **Saved** chip, out of range "1 to 240 minutes", `CONFIG_STALE` → B03 for that row, network → value reverts + "Not saved" chip.

**States:** loading · cloud unreachable (list kept, edits disabled) · empty archived view "No archived roles."

### 01b-S03a Archived roles

Archived view of S03: muted rows, "Archived {date}", **Restore** (`PATCH { expected_version, archived: false }`). Restore errors: `409 CONFIG_NAME_TAKEN` → *"Another active role is called {name}. Rename one first."* (proposed); `CONFIG_STALE` → B03. Restored role has nobody (holders were removed on archive).

### 01b-S04 Role editor — `#/roles/new`, `#/roles/:id`

**Layout:** app bar: back "Roles" · title · Cancel · **Save role** · section Role name (1–40, unique among active roles, case-insensitive) · Signs out after idle (1–240 min) · explain box: **"Allowed: they just do it. Needs approval: they ask, and the request goes to people with the chosen roles, who approve on their own device with their PIN. Not allowed: the button is hidden."** (R21 copy fix) · groups, each a list of C01 rows.

**Groups and permissions (from `PERMISSION_CATALOGUE` in code, 20 today):**

| Group | key → label | Where (scope) choices |
|---|---|---|
| Orders and tables | `take-order-anywhere` → Take orders at any table | Whole branch · Their floors |
| | `force-release-table-lock` → Free a table someone else has open | Whole branch · Their floors |
| | `approve-void` → Approve removing an item | Whole branch · My team |
| | `void-item` → Remove a cooking item from an order | — |
| | `boost-order` → Rush an order in the kitchen | — |
| Kitchen items | `reprint-ticket` → Reprint a kitchen ticket | — |
| | `move-item-to-stock` → Move a removed item to ready stock | — |
| | `mark-item-returned` → Mark an item returned | — |
| Bills and cash | `apply-discount` → Give a discount | — |
| | `apply-refund` → Give a refund | — |
| | `apply-comp` → Give an item free | — |
| | `reopen-bill` → Reopen a closed bill | — |
| Menu and stock | `edit-menu` → Change the menu | — |
| | `manage-stock` → Count stock and switch items off | Whole branch · Their stations |
| People and screens | `manage-roles` → Change roles | — |
| | `manage-staff` → Add staff, reset PINs, unlock | — |
| | `manage-devices` → Pair and remove screens | — |
| | `access-hub-admin` → Open hub admin | — |
| Reports and logs | `view-reports` → See sales reports | — |
| | `view-audit-log` → See the audit log | — |

New permissions from later modules are appended to a group; the grid grows without a redesign.

**Errors and guards**
| Case | Shown as |
|---|---|
| Name empty / > 40 | field error |
| `409 CONFIG_NAME_TAKEN` | Name field: *"Another role is called {name}."* (proposed) |
| Needs approval with no approver | C01 row error: *"Pick at least one role to approve."* (proposed; client check, server `400`) |
| An approver role was archived meanwhile (`422 role_archived`) | C01 row error, chip removed (proposed) |
| Idle out of range | "1 to 240 minutes" |
| `409 OWN_ADMIN_ACCESS` (turning off *Open hub admin* or *Pair and remove screens* on a role the owner relies on) | segment snaps back + D03 blocked variant "You can't remove your own admin access. Call support." |
| `409 OWN_ADMIN_ACCESS {reason:'owner_not_linked'}` | the owner-not-linked text (S02) |
| `409 LAST_ADMIN_REQUIRED {branch_ids}` | segment snaps back + D03 blocked naming the branches |
| `409 CONFIG_STALE` | B03 |
| Network / 503 | form kept, "Nothing was saved." |
| `404 ROLE_NOT_FOUND` | full-page state *"This role can't be found."* + back to Roles (proposed) |

Saving a role edit audits before/after (E6 AC5); no viewer here.

### 01b-C01 Grant control

One row per permission: plain label · segmented **Allowed | Needs approval | Not allowed** · when **Needs approval**: "Approved by" — **multi-select role chips** (one or more; may include this role itself) · when the permission has more than one scope (table above): "Where" select, shown for Allowed and Needs approval.
- "Where" labels: **Whole branch** (default) · **Their floors** (help: "floors set on each person") · **My team** (help: "people who report to them") · **Their stations** (help: "stations set in Stock counting").
- There is **no "Tables they open"** option (no permission offers it, D-2).
- Reused by later modules for any permission setting.

### 01b-D03 Archive role

**Confirm:** "Archive {role}?" · "{n} people have it. They keep their other roles. Their stock counting through this role stops." (with names when few: "Imran keeps his Manager role.") · Cancel / **Archive**. Action: `PATCH { expected_version, archived: true }`. After success: back to S03 + B02.

**Blocked variants (each needs a frame):**
| Code | Title / body |
|---|---|
| `409 CONFIG_IN_USE {used_by: {entity:'staff', ids}}` | *"{role} can't be archived"* / *"{names} would have no role left. Give them another role first."* + **Open {name}** (proposed) |
| `409 CONFIG_IN_USE {used_by: {entity:'role', ids}}` | *"{role} can't be archived"* / *"{role} approves requests for {other roles}. Change who approves there first."* + **Open {other role}** (proposed) |
| `409 LAST_ADMIN_REQUIRED {branch_ids}` | "{role} can't be archived" / "At least one person at {branches} must be able to open the hub admin." / "Give "Open hub admin" and "Pair and remove screens" to another role first, such as Manager." |
| `409 OWN_ADMIN_ACCESS` | "You can't remove your own admin access. Call support." |

### 01b-S05 Stock counting — `#/stock-counting`

**Data:** `GET /v1/admin/branches/:b/responsibilities` → `{ responsibilities: [{ responsibility:'count_stock', station_id, staff_ids[], role_ids[] }], version }` + the 01a stations list (active stations only) (§6.8).

**Layout:** app bar "Stock counting" + branch select · intro "These people see the stock page for their stations. Several people can share a station." · list: station + the items counted there | who: person chips and role chips (accent) | **Change** · warn banner per station with nobody: "Nobody counts {station} at {branch}." / "{items} will show "Not counted today" every morning until someone is chosen."
- **Change** opens a picker: people who work at this branch, and active roles (a role means "everyone with this role at {branch}", owner Q7).
- Save sends the **whole branch set**: `PUT … { expected_version, responsibilities }`.
- Help: *"A counter needs "Count stock and switch items off" set to "Their stations" and "Open hub admin" on their role to open the stock page."* (proposed; D-3).

**States:** loading · branch with no stations: *"{branch} has no stations yet. Add them in Setup."* (proposed) · saved (B02) · `CONFIG_STALE` (B03) · `422` (a person no longer at the branch, a role or station archived meanwhile): *"Something changed. Reload and pick again."* (proposed) · cloud unreachable.
- People who leave, roles that are archived and branches removed from a person drop out of this list automatically.
- An archived station disappears from this page and comes back with its people when restored.

### 01b-S06 Branches — `#/branches`

**Data:** `GET /v1/admin/branches` (01a §6.7b) → rows `{ branch_id, name, status, hub_last_seen_at, hub_synced_at }` + `hub_stale_after_ms` (180 000 today; **never hardcoded**).

**Row:** name + ID tail · status chip **Open** | **Not open yet** · "Hub checked {ago}" · **"Up to date {ago}"** · **Rename** (D04) · **Settings** (S07). Footer note: "A new branch is added by support when its hub is installed."

| State of a branch | Shown as |
|---|---|
| No hub yet (`hub_last_seen_at` null) | "No hub yet" |
| Healthy (`hub_last_seen_at − hub_synced_at ≤ hub_stale_after_ms`) | "Hub checked 1 min ago · Up to date 1 min ago" |
| **Checking in but not applying** (gap > threshold) | warn: *"Up to date {ago}. The hub checks in but hasn't taken the latest changes. Call support if this stays."* (proposed copy) |
| **Not checking in** (now − `hub_last_seen_at` > threshold) | warn: "{branch} hub last checked {n} min ago. It gets the change when it is back online." |

### 01b-D04 Rename branch

Field "Branch name" (1–60, trimmed, unique among the restaurant's branches, case-insensitive) · help *"The hub screens at the branch keep showing the old name for now."* (proposed copy; a rename does not reach the hub, §12.4) · Cancel / **Rename**. `PATCH /v1/admin/branches/:id { name }`. Errors: `409 CONFIG_NAME_TAKEN` → *"Another branch is called {name}."* (proposed); empty / too long; network. Saved → row updates, ok banner *"Renamed to {name}."* (proposed). No version check (none in the spec).

### 01b-S07 Branch settings — `#/branches/:id/settings`

**Data:** `GET /v1/admin/branches/:b/settings` (§6.10).

| UI | API | Rule | Default |
|---|---|---|---|
| Charge tax at this branch (switch) — "When off, bills at this branch show no tax, whatever the item's tax rate." | `tax_enabled` | — | **off** (B16) |
| Warn when a business day has been open longer than [N] hours — "The stock page asks to close yesterday's day. 1 to 48 hours." | `day_stale_after_hours` | 1–48 | 16 |
| Ignore a second "Start day" within [N] hours — "Stops a day being started twice by two tablets. 0 to 12 hours." | `day_min_gap_hours` | 0–12 | 4 |
| Later settings (kitchen timing, voids, service charge) will appear here. | — | — | — |

`PATCH … { only changed fields }`. **Errors:** out of range (field); **stale hours must be more than the gap** → error on the gap field: *"Must be less than the stale-day hours ({n})."* (proposed copy; spec: `400` on `day_min_gap_hours`); network; `404`. **Saved:** "Settings saved. {branch} gets them within about a minute."

### 01b-S09 Change password — `#/account/password`

**Entry:** side-nav footer **Change password**; B01 button **Change password**; **forced** after a support reset.

**Layout:** app bar "Account" · card (max 560): "Change your password" + email (LTR) · Current password · New password (Show toggle; help "At least 10 characters. A short sentence is easy to remember.") · Type the new password again · explain "Other phones and laptops signed in to your account are signed out. Hub tablets and staff PINs are not affected." · **Change password** (busy "Changing…") · caption **"Forgot your password? Call support."** (number variant when `VITE_SUPPORT_PHONE` is set). Phone: same fields, button in the bottom bar.

**Forced mode (B05, new):** after signing in with the temporary password support read out. Banner *"Choose a new password to continue. The temporary password from support works only once and expires 24 hours after it was given."* (proposed copy) · "Current password" label becomes *"Temporary password"* (proposed) · **no side nav and no way to other pages** (each redirects here) · **Sign out** stays.

`POST /v1/auth/change-password { current_password, new_password }` (§6.11); the response holds a new session (the client keeps it; the owner stays signed in here).

| Case | Text |
|---|---|
| `401 PASSWORD_INVALID` (wrong, or account locked) | "This is not your current password." |
| `400 VALIDATION_FAILED` on `new_password` (< 10 or > 200) | "Use at least 10 characters." / "Use at most 200 characters." |
| `422 PASSWORD_UNCHANGED` | "Pick a password you haven't used here." |
| Repeat differs (client) | "The two new passwords are different." |
| `429 IP_LOCKED_OUT` | *"Too many tries. Wait 15 minutes and try again."* (proposed) |
| Network / 503 | "Nothing changed. Your old password still works. Try again when you are online." |
| Saved | "Password changed." / "You stay signed in here. Other devices were signed out." (forced mode → then into the app, Staff or the last page) |

**Owner sign-in page (01a-S01) cases to add:** a temporary password used after 24 h → the normal wrong-password message; the owner calls support again (no special text).

### 01b-S10 Teams — `#/teams` (new)

**Data:** `GET /v1/admin/branches/:b/team-tree` (§6.12) → `{ branch_id, roots: TeamNode[] }`, `TeamNode = { staff_id, display_name, has_pin, role_ids, members: TeamNode[] }`.

**Layout:** app bar "Teams" + branch picker (remembered per tab, 01a S52) · intro *"Who reports to whom at {branch}. Change a line on the person."* (proposed) · indented list: lead → their people (any depth), each row: name, role names, **"No PIN"** chip when `has_pin` is false · each name opens `#/staff/:id` · people with no lead at this branch appear at the top level. **Read-only** (no drag and drop; lines are edited on S02).

**States:** loading · nobody at the branch · nobody has a lead (flat list, note *"No reporting lines yet. Set "Reports to" on a person."*, proposed) · cloud unreachable · `404 BRANCH_NOT_FOUND`.
**Sample (Gulberg):** Imran → Hamza → Bilal, Ali R.; Imran → Usman (Cook, No PIN); Zubair (no lead).

### 01b-B01 Owner lockout notice

Danger banner with **Got it** and **Change password**: "Someone tried to sign in to your account with a wrong password **{n}** times on {date} at {time}." / "If this wasn't you, change your password." `{n}` = `failed_count` (**10**), date and time from `locked_at`. Shown **once**, either on the first screen after the next sign-in **or on whatever page is open when the session next refreshes** (§3.7) — design it on top of any owner page.

### 01b-B02 Changes reach each branch

Ok banner after every staff, role, stock-counting or branch-settings save: "{name} saved. Changes reach each branch within about a minute." Plus a warn line per affected branch that is behind (same rule and data as S06, threshold from `hub_stale_after_ms`): "{branch} hub last checked {n} min ago. It gets the change when it is back online."

### 01b-B03 Someone changed this — Reload (new)

Warn banner on S02, S04, S05 (and the S03 idle row): *"Someone changed this since you opened it."* + **Reload**. Reload drops every unsaved change and shows the current record (§8, B23). Also when the owner has the same page open in two tabs.

### 01b-B04 People moved to a new lead (new)

Info banner after marking someone as left, or removing a branch from them, when `moved_reports` is not empty: *"{n} people now report to {lead} at {branch}: Bilal, Ali R."* / *"…now report to nobody at {branch}."* + **See team** (→ S10) (proposed copy; B15: "the owner sees who moved and can change it").

### 01b-B05 Must change password (new)

The forced-mode banner on S09 (above).

## 6. Error texts (one place)

| Code | Text (English) | Source |
|---|---|---|
| `STAFF_NAME_TAKEN` | Another {name} works at {branch}. Add a letter, e.g. {name} R. or {name} K. | design, B12 |
| `OWN_ADMIN_ACCESS` | You can't remove your own admin access. Call support. | §8 |
| `OWN_ADMIN_ACCESS` + `owner_not_linked` | Your owner login isn't linked to your staff profile yet, so admin access can't be removed. Call support to link it. | §8 |
| `LAST_ADMIN_REQUIRED` | names the branches (S02, D03) | §8 |
| `STAFF_LINKED_TO_OWNER` | This profile is linked to the owner login and can't be marked as left. | §8 |
| `CONFIG_STALE` | Someone changed this since you opened it. [Reload] | §8 |
| `CONFIG_IN_USE` (role) | D03 blocked variants | §8 |
| `PASSWORD_INVALID` | This is not your current password. | design |
| `PASSWORD_UNCHANGED` | Pick a password you haven't used here. | design (was `PASSWORD_SAME`) |
| `VALIDATION_FAILED` on `new_password` | Use at least 10 characters. | §9 (no `PASSWORD_TOO_SHORT` code) |
| `PASSWORD_CHANGE_REQUIRED` | → S09 forced mode | §8 |
| `SERVICE_UNAVAILABLE` (503) / network | cloud-unreachable state 01a-B04, never sign-in | §8 |
| `JWT_INVALID` after a failed refresh | → owner sign-in page | §8 |
| Support texts | end with "Call support." — or "Call support on {phone}." when the build value is set | §8 |

All strings in English and Urdu (`staff.*`, `roles.*`, `teams.*`, `perm.<key>`, `errors.<CODE>`, `account.*`, `branches.*`); missing Urdu goes to `docs/design/handoff/01b/urdu-todo.md`.

## 7. Flows (each is a page test, spec §10.9)

1. **New waiter (laptop):** S01 → Add staff → S02 (Ali, Waiter, Gulberg, Reports to Hamza) → Add staff → D01 PIN ×2 → Saved → B02 → within ~1 min Ali is on Gulberg tablets. Unhappy: no internet; name taken ("Ali R."); Gulberg hub behind (B02 warn).
2. **Forgot PIN in the rush (owner phone):** S01 search "bil" → Reset PIN → hand the phone over → PIN ×2 → Saved. ≤ 8 taps + 8 digits. Unhappy: no internet → old PIN still works.
3. **Leaver with a team:** S02 Hamza → Mark as left → D02 (2 people will report to Imran) → B02 + B04 → hub shows Hamza's phone as Removed (00-S16). Unhappy: Hamza's profile is the owner's → `STAFF_LINKED_TO_OWNER`.
4. **New role "Shift lead":** S03 → New role → S04: Remove a cooking item: needs approval by Manager or Owner; Approve removing an item: Allowed, My team; Free a table someone else has open: Allowed, Their floors → Save → S02 Imran: add Shift lead, set floors → C02 shows the result.
5. **Last-admin / own-admin guard:** S04 Owner role → turn off "Open hub admin" → snaps back + D03 blocked (own access). Same on the only manager at Johar Town → D03 blocked naming Johar Town.
6. **Forced password change after a support reset:** sign in with the temporary password → S09 forced → new password → into the app. Unhappy: temporary password older than 24 h → sign-in refuses → call support.
7. **Stock counter:** S05 Gulberg → Grill: Usman → Save; S04 Cook role or Usman's role: Count stock = Allowed, Their stations, + Open hub admin → on the hub, Usman sees only Grill rows and no Start/Close day (§9).
8. **Archive a role:** S03 → Archive Shift lead → D03 confirm → Imran keeps Manager. Unhappy: Shift lead is someone's only role → blocked.
9. **Two tabs:** edit Cashier in two tabs, save one, save the other → B03 → Reload.
10. **Owner not linked:** removing someone's admin access → owner-not-linked message → call support.

## 8. Data shown

Staff, roles and responsibilities each carry a `version` (sent back as `expected_version`). Branches: `name, status, hub_last_seen_at, hub_synced_at` and `hub_stale_after_ms`. Branch settings: `tax_enabled, day_stale_after_hours, day_min_gap_hours`. Team tree nodes. Login and refresh: `user.must_change_password`, `lockout_notice { locked_at, failed_count }`. **Never shown or logged:** PINs, PIN hashes, passwords.

## 9. Changes 01b makes to other modules' screens

| Screen | Change | Source |
|---|---|---|
| **01a-S11 hub stock page** | A person whose "Count stock" is limited to **their stations** sees only those stations' rows. **Start day, Close day and the stale-day prompt are hidden** for them. If the day isn't started: "The day hasn't been started. Ask someone who can start the day." A stale page that tries to change an item outside their stations → *"You can only change items for your stations."* (proposed copy for `403 outside_scope`) | B20, 01a §4.4 rows 9–13 |
| **01a-S10 stock sign-in roster** | People with the stock-counting job show **"Counts stock"** | §4.2, 01a Q11 |
| **01a-S02 branch picker** | branch names (frame `BranchPickerNamed`) | 01a S58 |
| **01a-S01 owner sign-in** | after sign-in: B01 if a lock happened; forced S09 after a reset; an expired temporary password is just a wrong password | §6.13 |
| **01a owner shell side nav** | People group (Staff · Roles · Teams · Stock counting), Branches group, footer Change password | §8 |
| **00-S16 hub devices list** | a leaver's phone shows Removed | 00 M38 |
| **02-S01 tablet sign-in tiles** (and 00 admin rosters) | people without a PIN never appear (cooks, waiters placed only for teams); idle sign-out per role | B3, B13 |

## 10. Delta against the first hand-off (`pos-design-01b-handoff/01b`)

**Redraw (contradicts the spec):**
1. `StaffForm`, `StaffFormNew`: remove "Which tables (Any table | Tables they open | Chosen floors)"; add **C03 Reports to** per branch and **C04 Floors they work on** (only when a role uses "Their floors").
2. `RoleEditor`, `RoleUrdu`: "Where" options per permission (§5 table) — no "Tables they open"; add **My team** and **Their stations**; group order and membership from code (Remove a cooking item is in Orders and tables); new explain text.
3. `StaffEmpty`: **6** roles, including Order taker.
4. `Roles`: 6 rows; remove "Made by Arif".
5. `BranchSettings*`: tax **off** by default; add the stale > gap error.
6. `OwnerLockNotice`: {n} = 10 (`failed_count`), and show it can appear on any page.
7. `Password*`: caption "Forgot your password? Call support." (no one-time link, no fixed number); error `PASSWORD_UNCHANGED`; add 429.
8. `StaffFormErrors`: own-access text "…Call support."; last-admin names the branches.
9. `StaffForm` C02 aside: several approvers ("Manager or Owner") and scope wording.
10. `Branches`: add "Up to date {ago}" and the two warning states; Rename opens D04.
11. `StaffSaved`: hub-behind threshold from the server (not 5 min).

**New frames needed (no frame today):**
S10 Teams (laptop, phone, Urdu, empty) · S09 forced mode (B05) · S03a archived roles + Restore · D03 three more blocked variants · D02 blocked (linked to owner) and the "people will move" line · B03 stale + Reload (on S02, S04, S05) · B04 people moved · D04 rename branch · owner-not-linked message · S01 "Not set" help and branch-with-nobody state · D01 first-PIN and person-left states · S05 no-stations state · `tenant_wide_write` banner · support-number variant of every support text · hub stock page for a station-limited counter (01a-S11) and "Counts stock" on 01a-S10 · phone and Urdu versions of every 01b screen (§1).

## 11. Open questions

None for the owner (all answered at the 2026-10-27 visit). Developer questions that may change screens later: **D-2** (`own_tables` scope unused; 02 decides), **D-3** (a stock counter needs "Open hub admin"; may become a stock-only sign-in in 02), **D-4** (approval outside an allowed scope; 04 decides). Deferred: "Made by" on roles, branch rename reaching the hub, audit viewer (07), manager cloud login (P2), e-mail password reset.

## Story AC → screen IDs

| Story AC | Screens |
|---|---|
| E6-ROLE AC1 create role | S03, S04 |
| E6-ROLE AC2 catalogue | S04 (C01) |
| E6-ROLE AC3 three grants + approvers | C01 |
| E6-ROLE AC4 multi-role, denial | S02 (Roles, Never allow), C02 |
| E6-ROLE AC5 logged | no screen (viewer in 07) |
| E6-ROLE AC6 default set | S01 empty note, S03 Default chips |
| E6-ROLE AC7 + edge (last admin, own admin) | D03, S02 errors, D02 blocked |
| E6-TEAM AC1–3 one lead, no loops, leaver re-parent | C03, D02, B04 |
| E6-TEAM AC4 team tree | S10 |
| E6-TEAM AC5 a line grants nothing | C03 help, C02 |
| E0-PIN AC4 idle per role | S03 (S08), S04 |
| E0-PIN AC7 PIN set/reset, internet | D01 |
| E2-TBL AC4 floors | C01 "Their floors", C04 |
| R3 staff ↔ branch | S02 Works at |
| 01a S38 responsibilities | S05, 01a-S11, 01a-S10 |
| M73 owner lockout | B01 |
| Q9 change / forgot password | S09, B05 |
| 01a S58 branch names, settings | S06, D04, S07 |

**ACs with no screen:** E6-ROLE AC5's viewer (module 07).
