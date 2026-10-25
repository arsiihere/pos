# 01b — Staff and Role Admin: screen inventory

**No spec yet.** Sources: README module map row 01b and "Requirements carried" (01b rows, 01 rows), 01a §12.5 (01b scope list), 00 §3.6 (effective permission), §3.4 (session TTL), stories E6-ROLE and E0-PIN AC7. API names below are **proposed**; the 01b spec fixes them. Confirmed by 01a S37: `GET /v1/admin/branches` and `PATCH /v1/admin/branches/:branch_id/settings`. Required for milestone A **before the first live order**, built alongside 02. Conventions in [00-index.md](00-index.md).

---

## 1. Who and where

| Who | Device | Network | How often | Conditions |
|---|---|---|---|---|
| Owner (cloud account; role/permission edits) — later: staff with `manage-roles` / `manage-staff` (Q1) | Laptop 1440 (L); phone 360 (OP) for "reset Bilal's PIN now" | Internet only (cloud owner app `/owner/`); PIN set/reset **requires internet** (D40) | Setup: ~25 staff, 5–6 roles. Then: new waiter or leaver weekly; PIN reset a few times a week, often **during rush** ("I forgot my PIN") | Rush case: owner on phone, waiter standing next to the till |
| Staff member (receives a PIN) | — (told verbally or typed by themselves on the owner's phone — Q2) | — | — | — |

## 2. Jobs to be done

| # | Job | Story / source | Acceptance |
|---|---|---|---|
| J1 | As the owner, I need to see my branches by name so that I stop reading IDs. | 01a S37 | `{ branch_id, name, status }` list |
| J2 | As the owner, I need to create a role with a name and a set of permissions so that permissions match my real staff. | E6-ROLE AC1, AC2 | name; every permission in the catalogue (20 today) |
| J3 | As the owner, I need to set each permission to allowed / needs approval (from which role) / not granted so that sensitive actions are controlled. | E6-ROLE AC3 | three grants; approver role(s) when "needs approval" |
| J4 | As the owner, I need to give a staff member one or more roles so that their permissions add up. | E6-ROLE AC4 | most permissive wins; preview of the result |
| J5 | As the owner, I need to deny one permission to one person so that a role grant can't give it to them. | E6-ROLE AC4 (denied override) | owner-only; always wins |
| J6 | As the owner, I need every role and permission change logged so that I can see who changed what. | E6-ROLE AC5 | one audit row with before/after (view in 04-S03 / cloud — Q5) |
| J7 | As the owner, I need the default roles at setup and to change or replace them so that I start fast. | E6-ROLE AC6 | seeded set editable |
| J8 | As the owner, I must not be able to remove the last admin access (or my own) so that nobody is locked out. | E6-ROLE AC7, edge | block with clear message (`access-hub-admin` guard, 00 M57) |
| J9 | As the owner, I need to add staff, assign branches, and mark a leaver inactive so that only current staff can log in. | README R3; 01a §12.5 | exit → removed from hub directory on next poll → sessions end, BYOD phone revoked |
| J10 | As the owner, I need to set or reset a staff PIN so that they can log in. | E0-PIN AC7 (overridden: hashed on the cloud, 01a §12.5) | 4–6 digits; ends their sessions (M50); needs internet; duplicates allowed (M27) |
| J11 | As the owner, I need to limit a permission to own tables or a floor so that waiters work their section. | owner answer v0.7 (scopes); E2-TBL AC4 | scope per grant: everywhere / own tables / a floor (Q3) |
| J12 | As the owner, I need to assign responsibilities (e.g. stock counting for a station) so that the right person counts. | owner answer v0.7 (S38) | responsibility → person (or role), per station |
| J13 | As the owner, I need to set branch settings (tax on/off, stale-day hours, min gap) so that each branch behaves right. | 01a §6.7, S34, S33 | `tax_enabled`, `day_stale_after_hours` (16), `day_min_gap_hours` (4) |
| J14 | As the owner, I need to set how long an idle session lasts per role so that waiters' tablets lock quickly but managers' don't. | E0-PIN AC4; D28; owner answer v0.7 | defaults 5 min order taker, 1 h manager; editable |
| J15 | As the owner, I need to be told my account was locked after too many wrong passwords so that I can react. | 00 M73 carried (01/07) | notice on the next successful login (+ e-mail if a sender exists) |

## 3. Screen list

| ID | Name | Kind |
|---|---|---|
| 01b-S01 | Staff list | screen |
| 01b-S02 | Staff form (new / edit: name, roles, branches, active, individual denials) | screen |
| 01b-D01 | Set / reset PIN | dialog |
| 01b-D02 | Mark as left (deactivate) confirm | dialog |
| 01b-S03 | Roles list | screen |
| 01b-S04 | Role editor (name, permission grid, approver roles, scopes) | screen |
| 01b-D03 | Archive role confirm / blocked (last admin, own access) | dialog |
| 01b-C01 | Permission grant control (allowed / needs approval / not granted + approver + scope) | component |
| 01b-C02 | Effective permissions preview (for one person) | panel |
| 01b-S05 | Responsibilities (who counts stock for which station) | screen |
| 01b-S06 | Branches list (names) — replaces the ID tiles of 01a-S02 | screen |
| 01b-S07 | Branch settings | screen |
| 01b-S08 | Session idle limits (restaurant settings) | screen or section of S07 |
| 01b-B01 | "Your account was locked on 24 Oct 22:10 after wrong passwords" notice | banner on first screen after login |
| 01b-B02 | "Changes reach each branch within about a minute" / branch hub offline note | banner |

**Count: 15.**

## 4. Per screen

### 01b-S01 Staff list
- **Purpose:** find a person, see roles and branches. **Entry:** owner nav "Staff". **Exit:** S02, D01.
- **Layout:** header (title, **Add staff**) → search by name → filter branch, Active/Left → rows: name, roles (chips), branches, PIN set yes/no, phone paired (from hub? not in cloud — Q6), actions **Reset PIN**, **Edit**.
- **Data (proposed):** `GET /v1/admin/staff` → `{ staff_id, display_name, role_ids, branch_ids, is_active, has_pin }`.
- **States:** loading; empty ("Add your first staff member"); no match; network (cloud unreachable banner 01a-B04 pattern); permission (owner only today).
- **Sample:** Imran — Branch manager — Gulberg; Bilal — Waiter — Gulberg; Sana — Cashier — Johar Town; Arif — Owner — all.

### 01b-S02 Staff form
| Label | Type | Validation | Default | Req | API (proposed) | LTR |
|---|---|---|---|---|---|---|
| Name shown on screens | text | 1–40 (roster tile), unique? (Q7) | — | yes | `display_name` | — |
| Roles | multi-select chips | ≥ 1 | — | yes | `role_ids[]` | — |
| Works at | branch checkboxes (names from S06) | ≥ 1 | current branch | yes | `branch_ids[]` (`staff_branches`) | — |
| Floors / tables they cover | per scoped permission (C01) | — | everywhere | no | scope rows (Q3) | — |
| Never allow (owner only) | list of permissions with "Denied" | — | none | no | `staff_permission_denials` | — |
| Status | Active / Left (D02) | — | Active | yes | `is_active` | — |
- **Effective preview:** C02 shows each permission's final grant and which role gave it (D19 rule).
- **Actions:** **Save** (`POST` with `Idempotency-Key` / `PATCH`), **Set PIN** (D01). Each change bumps `tenants.directory_version`; 01b-B02 explains delay.
- **Errors:** validation, name taken (if unique), last-admin guard (if removing the role leaves no `access-hub-admin` holder), own access ("You can't remove your own admin access"), network.

### 01b-D01 Set / reset PIN
- PIN pad or two masked fields (enter, repeat), 4–6 digits, LTR. Text: "Bilal's sessions on every device end when you save." Requires internet. Sent over HTTPS, hashed on the cloud (decision to record in 01b, overrides D40).
- **States:** mismatch, too short, saving, saved ("Works at Gulberg in about a minute"), network ("Needs internet; nothing changed").
- **Edge:** duplicate PINs allowed (login is name + PIN). PIN reset while the person is mid-order → their session ends on next poll; their draft stays on the device (02-D14).

### 01b-D02 Mark as left
"Mark Bilal as left? He can't log in anywhere, and his phone is removed from Gulberg." Cancel / Mark as left. Audited (needed for `restore-bump` runbook).

### 01b-S03 Roles list / 01b-S04 Role editor / 01b-C01
- List: name, number of people, Archive. Editor: Role name (1–40, unique), permission grid grouped by plain-language areas (Orders and tables, Kitchen, Bills and cash, Menu and stock, People and devices, Reports and logs), each row C01: **Allowed** / **Needs approval** (+ "approved by" role picker, multi) / **Not allowed**; optional scope (Everywhere / Own tables / A floor…) where the permission supports it (Q3).
- **Permission catalogue today (20):** void-item, move-item-to-stock, mark-item-returned, apply-discount, apply-refund, apply-comp, reopen-bill, edit-menu, view-reports, take-order-anywhere, boost-order, approve-void, force-release-table-lock, reprint-ticket, view-audit-log, manage-roles, manage-staff, manage-devices, access-hub-admin, manage-stock. Later modules append (02 place orders?, 05 open shift, payments…) — the grid must grow without redesign. Show plain labels ("Remove a cooking item from a bill") not keys.
- **Default roles (seed):** Owner, Manager, Cashier, Waiter, Cook (names are data, R5: no screen behaves by role name).
- **D03:** archive refused when the role is the last one carrying `access-hub-admin`, or when it would remove the owner's own access: "At least one role must be able to open the hub admin."

### 01b-S05 Responsibilities
Rows: responsibility (today only "Count stock"), station (Tandoor, Degh…), person(s). Replaces S18's interim rule (stock page open to `manage-stock`). Exact model → Q4.

### 01b-S06 Branches list
`GET /v1/admin/branches` → name, status. Tiles replace 01a-S02 IDs. Sample: Gulberg, Johar Town, DHA (not yet live).

### 01b-S07 Branch settings
| Label | Type | Validation | Default | API | LTR |
|---|---|---|---|---|---|
| Charge tax at this branch | switch | — | on? (S34 optional tax) | `tax_enabled` | — |
| Warn when a day has been open longer than | number, hours | 1–48 (proposed) | 16 | `day_stale_after_hours` | yes |
| Ignore a second "start day" within | number, hours | 0–12 (proposed) | 4 | `day_min_gap_hours` | yes |
→ `PATCH /v1/admin/branches/:b/settings` (owner only, `config_audit`, bumps the branch). Other modules' branch settings land here too (03a slip threshold, slow threshold, lock TTL; 04 void timeout override; 05 service charge…) — see index §Settings.

### 01b-S08 Session idle limits
Per role: "Log out after N minutes idle" (default 5 waiter, 60 manager), applies to the hub (`ttlFor(staff)`). Q8: per role or per person?

### 01b-B01 Owner lockout notice
"Someone tried to sign in to your account with a wrong password 5 times on 24 Oct at 22:10. If this wasn't you, change your password." Shown once on the next successful login. (No password change screen exists in any spec — Q9.)

## 5. Flows
1. **New waiter (owner, laptop):** S01 → Add staff → S02 (Ali, Waiter, Gulberg, floor Ground) → Save → D01 PIN 4821 ×2 → saved → within ~1 min Ali appears on Gulberg tablets (02-S01) → manager makes his phone QR (00-S17). Unhappy: no internet → D01 network error; Ali's name duplicates another Ali (Q7).
2. **Forgot PIN in rush (owner, phone):** S01 search "bil" → Reset PIN → D01 → saved → Bilal logs in on the tablet ~1 min later. Target ≤ 8 taps + 8 digits. Unhappy: hub offline from cloud → change waits (B02: "Gulberg hub last checked 12 min ago").
3. **Leaver:** S01 → Bilal → Mark as left → D02 → hub ends sessions and revokes his phone (00-S16 shows Removed).
4. **New role "Shift lead":** S03 → New → S04: void-item Needs approval by Manager; approve-void Allowed; force-release-table-lock Allowed; manage-stock Allowed → Save → assign to Imran (S02) → C02 preview.
5. **Last-admin guard:** S04 Owner role → turn off access-hub-admin → D03 blocked.

## 6. Data shown
Staff (`staff_id`, `display_name`, roles, branches, `is_active`, has_pin); roles (`role_id`, name, grants `{ permission, grant_type, approver_role_id, scope }`); denials; branches (`branch_id`, name, status); branch settings; idle limits. All from cloud admin endpoints (proposed); hub receives them through 01a's config poll (`applyStaffDirectory`).

## 7. Cross-module links
- **Needs:** 00 permission catalogue, `access-hub-admin` guard (M57), directory push; 01a config poll and `GET /v1/admin/branches` for 01a-S02.
- **Gives:** the staff roster (02-S01 login tiles, 00-S03/S07 admin rosters), effective permissions (every screen's show/hide and "needs approval"), scopes (02 table map: own tables/floor), responsibilities (01a stock page access), idle TTL (02 auto-logout), branch settings (01a day line, 05 tax).
- 04's approval routing uses "needs approval from role X".

## 8. Open questions (owner)
- **Q1** Only the owner edits staff and roles in P1, or also staff with `manage-staff` / `manage-roles` (they are hub-side PIN users; the owner app is cloud email login)?
- **Q2** How does a staff member get their PIN: the owner types it and tells them, or the staff member types it on the owner's phone?
- **Q3** Which permissions take a scope (own tables, a floor)? Is "own tables" = tables I opened, or tables assigned to me (E2-TBL AC4 "assigned to floors or tables by default")? Who assigns tables to waiters, and how often (per shift)?
- **Q4** Responsibilities: only stock counting? Per station or per item? Can one person have several?
- **Q5** Where does the owner read the role-change audit (E6-ROLE AC5): cloud owner app or hub audit view (04-S03)?
- **Q6** Should the staff list show whether a person has a paired phone (hub-only data)?
- **Q7** Must display names be unique per branch (two "Ali"s on the login grid)?
- **Q8** Idle limit per role or per person? Which role's limit applies to a person with two roles?
- **Q9** No change-password or forgot-password flow exists for the owner. Needed for P1?
- **Q10** Story E0-PIN AC1 (unique PIN) is dropped (M27). Confirm the owner is fine with duplicates.

## 9. Design status
Not designed. No brief. The 01a branch picker (01a-S02) is the only related screen and is waiting for 01b-S06.

## Story AC → screen IDs
| Story AC | Screens |
|---|---|
| E6-ROLE AC1 | 01b-S03, S04 |
| E6-ROLE AC2 | 01b-S04 (C01) |
| E6-ROLE AC3 | 01b-C01 |
| E6-ROLE AC4 (multi-role, denied) | 01b-S02, C02 |
| E6-ROLE AC5 (logged) | no 01b screen; viewer 04-S03 or Q5 |
| E6-ROLE AC6 (default set) | 01b-S03 |
| E6-ROLE AC7 + edge (last admin, own admin) | 01b-D03 |
| E0-PIN AC4 (idle per role) | 01b-S08 |
| E0-PIN AC7 (PIN set/reset, internet) | 01b-D01 |
| E2-TBL AC4 (assigned to floors/tables) | 01b-C01 scopes / S02 (Q3) |
| R3 staff-to-branch | 01b-S02 |
| M73 owner lockout notice | 01b-B01 |
| S37 branch names, S34/S33 settings | 01b-S06, S07 |

**ACs with no screen:** none in this module (E6-ROLE AC5's viewer is in 04 or open).
