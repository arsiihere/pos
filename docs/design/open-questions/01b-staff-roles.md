# 01b — Staff and Roles: open questions

Copied from the 01b design hand-off on 2026-10-27. Q11–Q16 are the owner answers of README R21; Q17–Q21 come from README R24 and R25 (`docs/stories/01d-notifications-teams-refined.md`) and must be settled in the 01b spec.

How to use it:
- Claude Code builds each **recommended** answer unless you change it.
- To answer a question, edit its **Decision** line and set **Status** to `answered`.
- `blocked` means it is not built until you decide.

---

## Q1 Who edits staff and roles in P1?
- **Recommended:** Only the owner, in the owner app (cloud, email login).
- **For a PIN reset during the rush**, the owner uses the phone flow: search, then Reset PIN, then hand the phone over (frames `StaffPhone` and `PinPhone`).
- **Later (P2):** a manager with `manage-staff` gets their own cloud login and can reset PINs.
- **Decision:** owner only (recommended)
- **Status:** recommended

## Q2 How does a staff member get their PIN?
- **Recommended:** The staff member types it, twice, on the owner's phone or laptop. Nobody else sees it (frame `PinPhone`).
- **Fallback:** the owner types it and tells them (frame `PinDialog`).
- **Decision:** staff types it (recommended)
- **Status:** recommended

## Q3 Which permissions take a scope, and what are "own tables"?
- **Recommended:**
  - **Scope applies only to taking orders** ("Take orders at any table"): Tables they open / Any table / Chosen floors.
  - **"Own tables" means tables the waiter opened.** There is no per-shift assignment screen in P1.
  - **Default floors are set per person** in the staff form ("Which tables").
  - **Everything else is branch-wide.**
- **Why:** Per-shift table assignment adds daily work for the manager in a 1 500-order day.
- **Decision:** as recommended
- **Status:** recommended

## Q4 Responsibilities: only stock counting?
- **Recommended:**
  - P1 has one responsibility, "Count stock", set per station.
  - It can name several people and/or a whole role.
  - The stock page shows each person only their stations' rows.
  - `manage-stock` still shows all rows.
- **Decision:** as recommended
- **Status:** recommended

## Q5 Where does the owner read the role-change audit?
- **Recommended:** In the owner app, because role and staff changes happen in the cloud. It goes in module 07 (Owner view) as "Change history". Until then the changes are logged but have no viewer.
- **Decision:** owner app, module 07 (recommended)
- **Status:** recommended

## Q6 Should the staff list show whether a person has a paired phone?
- **Recommended:** No. That is hub data, and it is shown on the hub in 00-S16 (Screens and phones).
- **Decision:** no
- **Status:** recommended

## Q7 Must display names be unique?
- **Recommended:** Yes, among active staff at each branch.
  - If two people share a name, the error suggests adding a letter ("Ali R.").
  - **Why:** Two identical "Ali" tiles on the sign-in screen lead to wrong-person sign-ins and PIN lockouts.
- **Decision:** unique per branch (recommended)
- **Status:** recommended

## Q8 Idle limit per role or per person?
- **Recommended:** Per role, edited in the Roles list and the role editor.
  - A person with two roles gets the longer limit (most generous wins, like permissions).
  - Defaults: Waiter 5, Cook 5, Cashier 15, Manager 60, Owner 60 min.
- **Decision:** per role (recommended)
- **Status:** recommended

## Q9 Change-password and forgot-password for the owner?
- **Answered (owner):** yes.
  - **Change password:** part of P1, in the side-nav footer. It is designed as 01b-S09 (frames `Password*`).
  - **Forgot password:** for the pilot, through support. Support checks it is the owner and sends a one-time sign-in link. Self-service reset by email comes later.
- **Still needed:** the support phone number for the caption (`{support_phone}`, today `[SUPPORT NUMBER]`).
- **Decision:** change password in P1; forgot password via support
- **Status:** answered

## Q10 Duplicate PINs are allowed. OK?
- **Recommended:** Yes. Sign-in is name + PIN, so two people with "1234" are still different people. The PIN dialog says so.
- **Decision:** allowed
- **Status:** recommended

---

## Owner answers, 2026-10-27 (README R21)

These settle clashes between this design, spec 00 v1.4 and the code.

## Q11 One approver role per permission, or several?
- **Answered (owner):** several roles may approve one permission (`approver_role_ids[]`).
  - The approver answers on **their own** phone or tablet with their own PIN; the requester's device shows the result (README R22). The in-person PIN on the requester's device stays as a fallback.
  - The role editor's help text changes from "someone from the chosen role confirms with their PIN" to: "The request goes to people with these roles. They approve on their own device with their PIN."
  - Changes spec 00: `role_permissions.approver_role_id` becomes a list, in the database, the directory and `GET /queries/session`. The delivery itself is 01d's; the approval flow is 04's.
- **Decision:** several approver roles; remote approval
- **Status:** answered

## Q12 Can a staff member be saved without a PIN?
- **Answered (owner):** yes. The PIN chip shows "Not set", and the person is not on any sign-in screen until a PIN is set.
  - Changes the merged cloud migration (`staff.pin_hash NOT NULL`) and the 00 directory contract (staff with no PIN are left out of the directory, or sent without a hash: the 01b spec decides).
- **Decision:** yes (design as drawn)
- **Status:** answered

## Q13 Default roles and idle limits
- **Answered (owner):** Owner 60, Manager 60, Cashier 15, Waiter 5, Cook 5 minutes (the design's set).
  - Replaces `apps/cloud/src/modules/staff-roles/default-roles.ts` (Cashier 30, Order taker 5, no Cook). Tenants seeded before 01b need a data migration or are re-seeded: the 01b spec decides.
- **Decision:** design's set
- **Status:** answered

## Q14 Owner lockout: 5 or 10 wrong passwords?
- **Answered (owner):** 10, as spec 00 (M73) and the code. The B01 notice text uses `{n}` from the data, and the design's "5 times" sample changes to 10.
- **Decision:** 10
- **Status:** answered

## Q15 Tax on or off for a new branch?
- **Answered (owner):** off, as built (`branches.tax_enabled DEFAULT false`). The design's S07 frame shows it on only as sample data.
- **Decision:** off
- **Status:** answered

## Q16 Ranges for the business-day settings
- **Answered (owner):** the design's ranges: "open longer than" 1–48 h, "ignore a second Start day within" 0–12 h.
  - The cloud CHECK constraints (today 1–72 and 0–24) are tightened in a new migration; existing values outside the range must be clamped first.
- **Decision:** 1–48 h and 0–12 h
- **Status:** answered

---

## New from README R24 and R25 (teams, main role, capacity)

The design has no screen for these yet: each adds a field to the staff form (S02) or the role editor (S04), so the designer must add it.

## Q17 Teams: who reports to whom?
- **Recommended:** person → person. The staff form gets a **Reports to** field (one person, picked from staff at the same branch).
  - Teams can nest (waiter → order taker → manager). No loops: the server rejects A → B → A.
  - A reporting line never grants a permission (R5); it decides who is told (01d) and where things escalate.
  - When a lead leaves, the owner is shown their team to reassign; until then the team's alerts go one level up.
- **Decision:** person → person (recommended)
- **Status:** recommended

## Q18 Can someone report to two people?
- **Recommended:** no, one lead per person per branch in P1. A person who works at two branches can have a different lead at each.
- **Decision:** one per branch (recommended)
- **Status:** recommended

## Q19 Can a lead approve only for their own team?
- **Recommended:** yes. Add **My team** to the "Where" choices in the role editor (C01), next to Tables they open / Any table / Chosen floors, for approval permissions.
  - Example: Hamza (order taker) may approve a void only for his own waiters' tables.
- **Decision:** add "My team" (recommended)
- **Status:** recommended

## Q20 Main and secondary roles
- **Recommended:** each person has exactly **one main role** and any number of secondary roles. The staff form marks one role chip as **Main**.
  - Example: Ali, main role Delivery, secondary role Waiter: when he has no delivery he can work as a waiter.
  - Permissions still add up across all roles (most generous wins, M10); "main" only matters for teams, stats and suggestions (R25), and a stats split of main vs secondary work.
- **Decision:** one main, any secondary (recommended)
- **Status:** recommended

## Q21 Capacity per role and per person
- **Recommended:** the role editor gets **Can handle at once**: tables and guests (both optional). The staff form can override it for one person.
  - Example: Waiter 4 tables / 16 guests; Bilal (new) 2 tables / 8 guests.
  - Data only in 01b. It is used for load and over-capacity stats later (R25, P2). Cooks' capacity comes from the timing engine (03a), not from this field.
- **Decision:** tables and guests; role default with a person override (recommended)
- **Status:** recommended
