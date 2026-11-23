# 05a Device Access + Screens — Module Spec

| | |
|---|---|
| Module | 05a Device Access + Screens (hub + client) |
| Version | **v0.3 DRAFT** (2026-11-23) — v0.2 (three rules, owner 02:05–02:07 PKT) with the migration number and the spec versions corrected; ready for hostile review |
| Inherits | Shared Standards from **Foundation v1.15** §6; not redefined here |
| Depends on | Foundation v1.15; **00 v1.12.2** (devices, pairing M44, the STAB-1 tablet token flow M86, sessions, §3.5 PIN order, §3.7 pipeline); 01b v1.10.3 (directory); **01d v1.3.4** (bindings §3.7, kinds, requests §3.3); 02b v1.0.24 (kiosk home); **03b v1.0.14** (`SetDeviceRole`, `devices.point_id`); 05 v1.0.34 |
| Read by | 06 (sync carries `DeviceProfileSet`), 01e (headless pairing uses the same request flow) |
| Stories | Owner rulings in chat 2026-11-23 (rows O-1–O-8); the owner's note "Restaurant POS — how devices and screens work TODAY" |
| Number | `05a` = after 05, before 06 (owner 2026-11-21). Its 00 / 01d / 03b rows become their next bumps |

### Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-23 | First draft (solo devices, role entries, sign-in notice). |
| v0.2 | 2026-11-23 | **Owner: "bht complex ban raha ha"** → three rules only. Removed: solo concept, role entries, sign-in notice / Not me, shuffled keypad, access request, solo-only guard on hub admin by count. Owner rulings: OQ-4 in-person answers **removed**; OQ-3 floor managers keep approving their floor from a listed device; OQ-6 any listed device can approve, so one broken device never blocks; the shared-list risk (§3.4) **accepted** ("itna risk theak ha"). |
| **v0.3** | 2026-11-23 | Owner "yes fix it": corrections only, no rule change. Hub migration **`0026` → `0027_device_profiles.sql`** (`0026_order_line_part_of.sql` is taken by 02b v1.0.20, STAB-5) in §4.5 H-5, §5.1, §6.10, §11. Spec versions brought to the current ones: Foundation v1.14 → v1.15, 00 v1.12.1 → v1.12.2, 01b v1.10.1 → v1.10.3, 02b v1.0.18 → v1.0.24, 03b v1.0.9 → v1.0.14, 05 v1.0.32 → v1.0.34. §4.5 H-1 now names what it removes from 00 v1.12.2: the STAB-1 **Add a tablet** token flow (`#add-tablet`, M86, `&d=tablet`, tests 167, 168) along with **Add a phone**. |

---

## §1. Header

### The three rules

1. **One attach flow.** Every device shows a code; someone with `manage-devices` approves it on one form (name, kitchen station **or** screens, who may use it).
2. **"Who may use it" is `everyone` or `listed`.** On a `listed` device only the listed staff can sign in; any other PIN, even correct, is refused before it is checked.
3. **Approvals and admin only on `listed` devices.** On an `everyone` device the sensitive permissions (§3.3) never work, so a leaked PIN used at a shared counter or tablet cannot approve, refund or open hub admin.

### In scope

Pairing by request for every device type (token pairing removed), device profile (name, screens, access, point), the sign-in check, the listed-only guard, 01d binding and in-person changes, 03b Pass binding through screens, staff shell tabs, migration of paired devices.

### Out of scope / deferred (§12.4)

Sign-in alert with "Not me", shuffled PIN pad, PIN only while on shift, staff NFC cards, "add me to this device" request, Delivery screen, enforcing screens on the hub, 01e headless devices.

---

## §2. Existing architecture that must not change

- Device token auth; REVOKED terminal; re-pair = new row (00 §3.3).
- **`devices.device_type` keeps its four values and never changes on a row**; it now means hardware only. 01d bindings (AD-47), the client alert-mode rule (`socket.ts`), catch-ups and audiences read it.
- M44 request mechanics: 6-char display code, poll secret, 10-minute expiry, caps (M76), **the code check on approval** (proves the approver sees the physical screen).
- 00 §3.5 PIN order; new checks go **before step 2** (like M38): not a PIN failure, no argon2.
- Sessions, takeover (M20), replacement (M6).
- Bootstrap admin (M42) and the hub CLI `issue-admin-bootstrap` (M72): the last-resort way in if every listed admin device is lost.
- Event sourcing: projections rebuild from events, so the upgrade (§5.3) appends events.

---

## §3. Domain rules

### 3.1 Owner rulings

| ID | Ruling | Source |
|---|---|---|
| O-1 | One attach flow for every device. | 2026-11-23 01:16, 01:24 |
| O-2 | Approving a device needs `manage-devices` ("jiskay pass hub ki access ho"), not a role. | 01:16 |
| O-3 | A device is used by the people it was added for, plus anyone added later; nobody else. | 01:28 |
| O-4 | A personal phone stays locked to its owner. | 01:24 ("ye cheez loose nahi karna") |
| O-5 | A leaked PIN must not approve from a shared tablet. | 01:26 |
| O-6 | Screens per device as tabs; screen decides what is visible, permission what is allowed. | 2026-11-21 |
| O-7 | 01d in-person answers are removed. | 01:49 (OQ-4 "khatam karo") |
| O-8 | Keep it simple: `everyone` / `listed`; a listed device with several people may approve for all of them, risk accepted. | 02:05, 02:07 |

### 3.2 Decisions

| ID | Decision | Prevents |
|---|---|---|
| M-1 | The **approver picks the people** on the form; the unpaired device never shows a roster or takes a PIN. Each listed person proves themself at their first sign-in with their PIN. | Staff names shown to any LAN client, and PIN guessing from an unauthenticated device |
| M-2 | `device_type` comes from the device's hint, can be corrected on the form before approval, never after. | Breaking 01d / client readers (§2) |
| M-3 | Kitchen = `device_type = 'kds'` (station, no sign-in), unchanged. Every other type is a staff device with `access` and `screens`. | A mode column duplicating `kds` |
| M-4 | **Screens are a view boundary only.** The hub enforces access (rule 2) and the listed-only guard (rule 3); it does not map commands to screens. | A command→screen map across 02a / 02b / 03b / 05 with no security gain |
| M-5 | A `listed` device whose list becomes empty (staff removed from the directory) is revoked, `cause: 'access_empty'` (replaces M38's `owner_removed`). | A device nobody can use, still holding a live token |
| M-6 | Pass is a screen with a point; `devices.point_id` is written by `SetDeviceProfile`; 03b `SetDeviceRole` keeps only `lane_label`. | Two writers of `point_id` |
| M-7 | Inbox, requests to answer, own shift, Me and sign out are on every staff device, outside the screens. | Approval requests hidden behind a screen (01d R22) |
| M-8 | The hub admin home warns **"Only one device can manage devices — add a backup"** when exactly one unrevoked `listed` device lists a person holding `manage-devices`. | Owner's only admin laptop breaks, nobody can approve its replacement (owner's OQ-6 case) |

### 3.3 Listed-only permissions (rule 3)

`LISTED_ONLY_PERMISSIONS` in `@pos/domain/src/permissions.ts`:

`access-hub-admin`, `manage-devices`, `manage-staff`, `manage-roles`, `manage-fiscal-settings`, `approve-void`, `apply-refund`, `reopen-bill`, `close-shift-for-others`, `view-audit-log`.

Plus **answering a 01d request of a money kind** (`needs_pin: 'always'`).

Not in the list (owner OQ-3, so the counter keeps working): `close-business-day`, `view-reports`, `take-payment`, `open-cash-drawer`, `record-petty-cash`, and every permission a cashier or order taker uses. A **request** for approval (a cashier asking for a void) still works on an `everyone` device; only the **answer** needs a listed device.

Pipeline rule (00 §3.7, after the permission resolve): permission in the list ∧ session on a device with `access = 'everyone'` → `403 PERMISSION_DENIED { permission, reason: 'listed_device_only' }`. `/admin/auth` on an `everyone` device → the same `403` (not counted as a PIN failure, checked before §3.5 step 2).

### 3.4 Accepted risk (O-8)

On a listed device with several people (a floor tablet listing the floor manager and two waiters), a waiter who learns the manager's PIN can approve there. The owner chose who is on that list. Everywhere else a leaked PIN approves nothing.

### 3.5 Sign-in check (`POST /auth/pin`, `POST /admin/auth`)

Before §3.5 step 2: device `listed` and `staff_id` not on its list → **`403 DEVICE_ACCESS_DENIED`** (not counted, no argon2). Replaces `DEVICE_NOT_OWNED` (kept as an alias until 06). Takeover (M20) never applies on a listed device with one person (today: never on phones). Reads from the in-memory `deviceProfile` map: no statement.

### 3.6 Screens

| Key | Shows | Acts (with the permission) | Offered on |
|---|---|---|---|
| `dine_in` | table map, table view | open table, take order, send, served, request bill | all staff hardware |
| `takeaway` | takeaway queue, New order | create order, pay takeaway bills | all |
| `parking` | car slots made at runtime, New car order | create order, served, pay parking bills | all |
| `cashier` | every open bill, Held | settle, split, reprint, drawer, petty cash | `cashier_kiosk`, `tablet` |
| `pass` | Pass view of the device's point | `run-pass` | all; needs `point_id` |
| `manager` | live view, reports, day close, audit, test alert | (listed-only items hidden on `everyone` devices) | all |

- Tabs in list order; the device remembers its last tab.
- A screen the person cannot view at all (`manager` without `view-reports` / `view-audit-log`) is hidden; other screens show read-only without the permission.
- 1–6 screens, unique, offered for the hardware; `pass` ⇔ `point_id` set.

### 3.7 Device lifecycle

```
 unpaired ─POST /pair/requests─► PENDING (code on screen, 10 min)
                                     │ ApprovePairingRequest (manage-devices, on a listed device; code typed or QR scanned)
                                     ▼
                                  ACTIVE ──SetDeviceProfile──► ACTIVE (name, screens, access, point; live, no re-pair)
                                     ├── RevokeDevice ─────────────────────► REVOKED
                                     └── listed + list empty (directory) ──► REVOKED 'access_empty'
```

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | `devices`, `pair_requests`, `defineCommand`, `ws.sendToDevices`, session events | pairing, profile, sign-in |
| 01b | directory (staff ids), `applyStaffDirectory` hook | access check, M-5 |
| 01d | `raise` (permission target), `registerKind`, binding projection | `device_waiting`, bindings |
| 03b | `branchConfig().points`, `point` resolver | Pass screen |

### 4.2 Exposes

| Export | Shape |
|---|---|
| Event `DeviceProfileSet` v1 (stream `hub`, id = device_id) | `{ device_id, device_name, access: 'everyone' \| 'listed', staff_ids: string[], screens: ScreenKey[], point_id: string \| null, profile_version: int, cause: 'approved' \| 'edited' \| 'directory' \| 'upgrade' }` — the whole profile each time; replay = last event wins |
| `deviceProfile(device_id)` | memory `{ access, staff_ids: Set, screens, point_id }`, refreshed after `DeviceProfileSet`, `DevicePaired`, `DeviceRevoked` commits |
| `LISTED_ONLY_PERMISSIONS`, `SCREEN_KEYS`, `screensOffered(device_type)` | `@pos/domain` |

### 4.5 Changes to other specs (R26) — *Proposed, needs approval*

| Row | Target | Change |
|---|---|---|
| H-1 | 00 §3.3, §6.7, §6.8, §6.30–§6.32, §8.1, §8.2, M86 | Every device pairs by request; approval takes the profile (§6.3). `GenerateDevicePairingToken` and `POST /devices/pair` removed (pilot not live; `pairing_tokens` stays, unused), and with them the hub admin views **Add a phone** (`#add-phone`) and **Add a tablet** (`#add-tablet`, 00 v1.12.2 STAB-1, M86), the pair page's `t` / `d` parameters, and 00 tests 167, 168 (replaced by §10 test 1). The Capacitor app shows the request code instead of scanning a token QR. Pair page text "Ask someone with hub access to approve this screen" |
| H-2 | 00 §3.5, §6.6, §6.9 | §3.5 check; `DEVICE_ACCESS_DENIED`; `/admin/auth` refused on `everyone` devices |
| H-3 | 00 §3.7 | Listed-only guard (§3.3) |
| H-4 | 00 M38, §6.13, §6.17, §6.18c, §6.19, `apply-directory.ts` | `owner_staff_id` readers → the profile's `staff_ids`; `phone_count` → `device_count` (listed devices naming the person); M38 revoke → M-5; roster on a listed device = its people only |
| H-5 | 00 §5.1 | Migration `0027` (§5.1) |
| D-1 | 01d §3.7 bindings | The phone row's rule ("bound to `owner_staff_id` from `DevicePaired`, permanent") becomes: **a `listed` device with exactly one person** (any hardware) is bound to that person permanently, from `DeviceProfileSet`. Other devices follow today's tablet / kiosk rows by hardware |
| D-2 | 01d §3.3 rule 2 | **Method `in_person` removed** (O-7): `403 PERMISSION_DENIED { reason: 'in_person_removed' }`; the answer sheet drops "Someone else answers here". Money-kind answers need a listed device (§3.3) |
| D-3 | 01d §3.10 | New kind `device_waiting` (info; target `permission: manage-devices`; dedupe `device_waiting`; deep link to the approve form; **never shows the code**) |
| K-1 | 03b §3.8 | `SetDeviceRole.point_id` removed (M-6); the `point` resolver and `always_on` read "unrevoked non-kds devices with `point_id`" (was tablets only) |
| K-2 | 00 §8.2, 03b Kitchen screens page | "Use as Pass tablet" link and bind dialog → the device edit form |
| C-1 | client staff shell | tabs from `screens`; home = first screen (was kiosk → `kiosk_home`, else inbox / pass); `device_profile` push redraws the tabs |

---

## §5. Data model and migrations

### 5.1 Hub migration `0027_device_profiles.sql`

```sql
CREATE TABLE device_profiles (           -- projection of DeviceProfileSet; staff devices only
  device_id       TEXT    PRIMARY KEY REFERENCES devices(device_id),
  access          TEXT    NOT NULL CHECK (access IN ('everyone','listed')),
  screens         TEXT    NOT NULL,      -- JSON array, ordered, 1–6
  profile_version INTEGER NOT NULL       -- SetDeviceProfile expected_version
);

CREATE TABLE device_people (             -- projection of DeviceProfileSet.staff_ids (listed devices)
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  staff_id  TEXT NOT NULL,
  PRIMARY KEY (device_id, staff_id)
);
CREATE INDEX device_people_staff ON device_people (staff_id);
  -- serves M-5 (devices naming a removed staff member) and H-4 device_count

ALTER TABLE pair_requests ADD COLUMN hardware_hint TEXT
  CHECK (hardware_hint IN ('tablet','cashier_kiosk','kds','phone'));
```

- `devices` has `CHECK ((device_type = 'phone') = (owner_staff_id IS NOT NULL))`, which refuses a phone without an owner. The migration **rebuilds `devices`** without that one check (SQLite table rebuild, same columns and other checks). This is a new forward migration; the merged `0002` is not edited. `owner_staff_id` stays as a column, null on new rows.
- `device_name` and `point_id` on `devices` are updated by the `DeviceProfileSet` projection.
- Both new tables are projections (`registerHubProjections`) and rebuild by replay.

### 5.2 Invariants

- `access = 'everyone'` ⇔ no `device_people` rows; `listed` ⇒ 1–20 rows.
- `kds` devices have no `device_profiles` row.

### 5.3 Paired devices on upgrade (one boot step after the migration)

For each unrevoked non-kds device without a profile, append `DeviceProfileSet { cause: 'upgrade' }`, actor `'hub-migration'`. Nothing a device can do today is taken away, except approvals on shared devices (rule 3, by design).

| Today | Access | Screens |
|---|---|---|
| `cashier_kiosk` | `everyone` | `takeaway`, `parking`, `dine_in`, `cashier` |
| `tablet` with `point_id` | `everyone` | `pass`, `dine_in`, `takeaway`, `parking`, `cashier` |
| `tablet` | `everyone` | `dine_in`, `takeaway`, `parking`, `cashier` |
| `phone` | `listed` [owner] | `dine_in`, `takeaway`, `parking`, `manager` |

---

## §6. Endpoints

### 6.1 `POST /pair/requests` (changed, 00 §6.30)

Input adds `hardware_hint?` (Capacitor app → `tablet`; pair page → `phone` for a phone user agent, else `cashier_kiosk`). Processing unchanged plus the column; **post-commit** raise `device_waiting` (one open notice; updated with the pending count). Response and errors unchanged.

### 6.2 `GET /pair/requests/:id` (changed, 00 §6.31)

`approved` adds `screens`. `kds` → `/kds/`, others → `/staff/` (unchanged).

### 6.3 `ApprovePairingRequest` (changed, 00 §6.32)

| | |
|---|---|
| Permission | `manage-devices` (listed-only: from a listed device or the bootstrap admin session) |
| Payload | `{ request_id?, display_code, device_type, device_name: string(1–40), station_id?, access?, staff_ids?, screens?, point_id? }`. `kds` ⇒ `station_id` required, the rest absent. Else `access` and `screens` required; `listed` ⇒ `staff_ids` 1–20 unique; `everyone` ⇒ `staff_ids` absent |

Processing (`writer.run`):
1. Find the request (00 §6.32 rules) → `404 PAIRING_REQUEST_NOT_FOUND`.
2. `kds`: station validator → `404 STATION_NOT_FOUND`.
3. Staff device: each `staff_ids` entry in the directory → else `404 STAFF_NOT_FOUND { staff_id }`; screens offered for the hardware → else `400 VALIDATION_FAILED { field: 'screens' }`; `pass` ⇔ `point_id` → else `400 VALIDATION_FAILED { field: 'point_id' }`; point active → else `404 POINT_NOT_FOUND`.
4. INSERT `devices` (no owner), mark the request approved, append `DevicePaired` (v1, unchanged); staff device: append `DeviceProfileSet { cause: 'approved', profile_version: 1 }`.
5. Post-commit: refresh `deviceProfile`; resolve `device_waiting` if nothing is pending.

| | |
|---|---|
| Result | `{ device_id, device_type, station_id, screens, access }` (never the token) |
| Idempotency | D32 |
| Errors | §6.1; `400`, `403 PERMISSION_DENIED`, `404 PAIRING_REQUEST_NOT_FOUND` / `STATION_NOT_FOUND` / `STAFF_NOT_FOUND` / `POINT_NOT_FOUND` |
| Events | `DevicePaired`, `DeviceProfileSet` |

Form defaults (client): `phone` hint → `listed`, one person to pick, screen `dine_in`; `cashier_kiosk` → `everyone`, `takeaway` + `cashier`; `tablet` → `everyone`, `dine_in`. Name suggested ("Counter 2", "Ali's phone").

### 6.4 `SetDeviceProfile` (new; `/admin/commands/` and `/commands/`)

| | |
|---|---|
| Permission | `manage-devices` (listed-only) |
| Payload | `{ device_id, expected_version, device_name?, access?, staff_ids?, screens?, point_id? }`; unsent fields kept; §6.3 step 3 rules on the merged profile |

Processing (`writer.run`):
1. Device missing, revoked or `kds` → `404 DEVICE_NOT_FOUND`.
2. `profile_version ≠ expected_version` → `409 CONFIG_STALE` (01b R32 "Changed elsewhere" + Reload).
3. Validate the merged profile.
4. Editing the device the editor is signed in on so that it no longer lets the editor in → `422 DEVICE_ACCESS_SELF { device_id }`.
5. Append `DeviceProfileSet { cause: 'edited', profile_version + 1 }`.
6. Post-commit: refresh `deviceProfile`; an active session of someone no longer allowed → end it `'forced'` (`ended_by` = editor; existing reason) and close its sockets `4401`; push `device_profile { screens, access, point_id }` to the device (a removed tab under the user → first remaining tab + toast).

| | |
|---|---|
| Result | `{ device_id, profile_version }` |
| Errors | §6.1; `400`, `404 DEVICE_NOT_FOUND` / `STAFF_NOT_FOUND` / `POINT_NOT_FOUND`, `409 CONFIG_STALE`, `422 DEVICE_ACCESS_SELF` |

### 6.5 `POST /auth/pin`, `POST /admin/auth` (changed, 00 §6.9, §6.6)

§3.5 and §3.3 checks before 00 §3.5 step 2. `/auth/pin` response adds `device: { screens, access, point_id }`.

### 6.6 `GET /queries/staff-roster` (changed, 00 §6.19)

`listed` device → only its people; `everyone` → the whole directory (unchanged). Query count unchanged (memory).

### 6.7 `GET /queries/session` (changed, 00 §6.20)

Adds `device: { device_id, screens, access, point_id }` and `listed_only: true` on each permission of §3.3. The client hides listed-only actions on an `everyone` device.

### 6.8 `GET /admin/queries/devices` (changed, 00 §6.17)

Each row adds `access`, `people: [{ staff_id, display_name }]`, `screens`, `point_id`, `profile_version`, `needs_review` (profile `cause = 'upgrade'` and never edited); response adds `pending_requests: [{ request_id, device_name, hardware_hint, created_at }]` (never the code) and `admin_backup_warning: boolean` (M-8). Query count: today's 1, +1 for `device_profiles` / `device_people`, +1 for pending requests.

Page groups by first screen: **Waiting** (pending requests), **Counter** (takeaway / cashier / parking), **Floor** (dine_in), **Pass**, **Back office** (manager), **Kitchen** (kds), **Personal** (listed, one person). Hardware is an icon only.

### 6.9 Directory apply (changed, 00 `applyStaffDirectory` hook)

Staff removed from the directory → for every device naming them (`device_people_staff`), append `DeviceProfileSet { cause: 'directory' }` without them; a list left empty → `RevokeDevice` path with `cause: 'access_empty'` (M-5), in the same apply transaction. Bounded: tens of devices.

### 6.10 Upgrade boot step (§5.3)

Runs once after `0027`, before listen; idempotent (skips devices with a profile).

---

## §7. Cross-cutting

No new timer, cache, job or dependency: every check reads the in-memory `deviceProfile` map, refreshed on commit (YAGNI: tens of devices per branch).

## §8. Client contract

- **Pair page:** one flow for every device: big code + QR, "Ask someone with hub access to approve this screen". iOS keeps "Add to Home Screen" first, then the request from the home-screen app (00 §8.2 rule 2, now for the request).
- **Approve form:** in `/staff/` on a listed device, opened from the `device_waiting` notice or the device list; `/admin/approve` stays for the bootstrap admin. The code is typed or the QR scanned, never prefilled.
- **Staff shell:** tabs from `screens`; inbox, requests, shift, Me, sign out in the top bar (M-7); redraw on `device_profile`.
- **Answer sheet (01d):** no "someone else answers here".

## §9. Error catalogue additions

| Code | Status | Details |
|---|---|---|
| `DEVICE_ACCESS_DENIED` | 403 | `{ device_id }` (replaces `DEVICE_NOT_OWNED`, kept as an alias until 06) |
| `DEVICE_ACCESS_SELF` | 422 | `{ device_id }` |
| `PERMISSION_DENIED` reasons `listed_device_only`, `in_person_removed` | 403 | existing code, new reasons |

## §10. Tests

| # | Case |
|---|---|
| 1 | phone, tablet, kiosk and kds pair through `/pair/requests` + approve; the token routes answer `404 ROUTE_NOT_FOUND` |
| 2 | wrong display code → `404`, nothing written |
| 3 | Bilal's correct PIN on Ali's listed phone → `403 DEVICE_ACCESS_DENIED`; no counter changed; argon2 not called |
| 4 | manager signs in on an `everyone` counter: payment works; answering a void, refund and `/admin/auth` → `403 listed_device_only` |
| 5 | the same manager on their listed phone answers the void |
| 6 | floor tablet listed [floor manager, waiter]: floor manager answers a void there (accepted risk §3.4) |
| 7 | a cashier on an `everyone` counter raises a void request: it is raised and reaches the approvers' devices |
| 8 | `in_person` answer → `403 in_person_removed` |
| 9 | `SetDeviceProfile` removing the signed-in person ends the session `'forced'` and pushes `device_profile` |
| 10 | two admins edit one device → the second gets `409 CONFIG_STALE` |
| 11 | an admin making their own device stop letting them in → `422 DEVICE_ACCESS_SELF` |
| 12 | staff removed from the directory: dropped from every list; a list left empty revokes the device `access_empty` |
| 13 | `pass` without `point_id` → `400`; `cashier` on a phone → `400` |
| 14 | replay rebuilds `device_profiles` / `device_people` exactly; 01d: a listed one-person tablet binds its person permanently |
| 15 | upgrade: a phone becomes `listed` [owner]; a kiosk becomes `everyone` with its four screens; second boot appends nothing |
| 16 | admin backup warning shows with one admin device and clears when a second is approved |

## §11. Build order

1. `@pos/domain`: `SCREEN_KEYS`, `screensOffered`, `LISTED_ONLY_PERMISSIONS`; `@pos/events`: `DeviceProfileSet` v1. [§3.3, §3.6, §4.2]
2. Migration `0027` with the `devices` rebuild; projections; `deviceProfile` memory. [§5]
3. Pairing (§6.1–§6.3); remove token routes. [H-1]
4. Sign-in and roster (§6.5, §6.6); listed-only guard in the pipeline; session (§6.7). [H-2, H-3]
5. `SetDeviceProfile` (§6.4); device list (§6.8); directory apply (§6.9). [H-4]
6. 01d D-1–D-3; 03b K-1, K-2.
7. Upgrade boot step (§6.10).
8. Client: pair page, approve form, device list page, shell tabs, answer sheet. [§8, C-1, K-2]

## §12. Done, open questions, deferred

### 12.1 Definition of Done

Every §10 test green in the normal gate; manual check on a tablet, a kiosk PC, a KDS screen and an Android + iPhone phone: pair, sign in, refused PIN, tab change live; 00 / 01d / 03b bumped with "Changed by 05a" markers.

### 12.3 Open questions

| # | Question | Rec |
|---|---|---|
| OQ-1 | `close-business-day` and `view-reports` stay usable on `everyone` devices (counter)? | Yes (owner OQ-3: don't break counter work); move them to the list later if needed |
| OQ-2 | Up to 20 people on a listed device enough? | Yes |

### 12.4 Deferred until needed

Sign-in alert with "Not me"; shuffled PIN pad on shared devices; PIN only while on shift (05 shifts + 01d presence); staff NFC card + PIN; "add me to this device" request; Delivery screen (with 02b delivery); customer pickup board; screens enforced on the hub; 6-digit PINs for some roles.
