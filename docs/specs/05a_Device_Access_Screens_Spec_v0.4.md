# 05a Device Access + Screens — Module Spec

| | |
|---|---|
| Module | 05a Device Access + Screens (hub + client) |
| Version | **v0.4 DRAFT** (2026-11-23) — v0.3 with every finding of `docs/reviews/05a_v0.3_hostile_review.md` fixed under the owner rulings of 2026-11-23 02:39 PKT ("jo theak aur simple hai wo kardo"); ready for a targeted re-check |
| Inherits | Shared Standards from **Foundation v1.15** §6; not redefined here |
| Depends on | Foundation v1.15; **00 v1.12.2** (devices, pairing M44, the STAB-1 tablet token flow M86, sessions, §3.5 PIN order, §3.6 resolve, §3.7 pipeline, M42 / M72 bootstrap); **01b v1.10.3** (directory); **01d v1.3.4** (bindings §3.7, routes §3.4, kinds, requests §3.3, links §3.13); 02b v1.0.24 (kiosk home, audiences); **03b v1.0.14** (`SetDeviceRole`, `devices.point_id`, Pass readers); 04 v1.0.7 (audit actions); **05 v1.0.34** (money commands, shifts) |
| Read by | 06 (sync carries `DeviceProfileSet`), 01e (headless pairing uses the same request flow), 9b (Capacitor app) |
| Stories | Owner rulings in chat 2026-11-23 (rows O-1–O-15); the owner's note "Restaurant POS — how devices and screens work TODAY" |
| Number | `05a` = after 05, before 06 (owner 2026-11-21). Its 00 / 01d / 03b / 04 rows become their next bumps |

### Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-23 | First draft (solo devices, role entries, sign-in notice). |
| v0.2 | 2026-11-23 | **Owner: "bht complex ban raha ha"** → three rules only. Removed: solo concept, role entries, sign-in notice / Not me, shuffled keypad, access request, solo-only guard on hub admin by count. Owner rulings: OQ-4 in-person answers **removed**; OQ-3 floor managers keep approving their floor from a listed device; OQ-6 any listed device can approve, so one broken device never blocks; the shared-list risk (§3.4) **accepted** ("itna risk theak ha"). |
| v0.3 | 2026-11-23 | Owner "yes fix it": corrections only, no rule change. Hub migration `0026` → `0027_device_profiles.sql`; spec versions brought to the current ones; §4.5 H-1 names the STAB-1 **Add a tablet** flow it removes. |
| **v0.4** | 2026-11-23 | **Hostile review `docs/reviews/05a_v0.3_hostile_review.md` fixed** (owner rulings 02:39 PKT, rows O-9–O-15). **BLOCKERS:** B-1 the listed-only rule moves **into `resolve()`** through a session-bound directory view (§3.3, §3.3a); B-2 "nothing is taken away" replaced by the list of what is lost, M-8 warns at 0 or 1, and at 0 the hub admin home offers a recovery link from `issueAdminBootstrap` (§3.2 M-8, §5.3, §6.11); B-3 bindings derived from the latest profile (§3.8). **MAJORS:** M-1 money `allowed` grants downgraded to "Confirm on your phone" on `everyone` devices (§3.3a, §3.9); M-2 `close-shift-for-others` leaves the list, requests always raised (§3.3); M-3 approve / revoke / edit / list on both routes (§6.3, §6.4, §6.8); M-4 `device_waiting` lifecycle (§3.10); M-5 money requests never ring where they cannot be answered (§3.9); M-6 self-guard extended, admin sessions ended on a switch to `everyone` (§6.4); M-7 revoke only a one-person phone, others → `everyone` + needs review (§3.2 M-5, §6.9); M-8 cause `owner_removed` kept, 04 audit action `device_profile_set` (§4.2, §4.5 A-1); M-9 kiosks and tablets keep the `manager` screen (§5.3); M-10 all six "tablet only" Pass readers (§4.5 K-1, K-2, D-4); M-11 deep links to a missing screen fall back to the inbox, read-only screens removed (§3.6, §8); M-12 `needs_review` in the event and the projection, rebuild steps, upgrade step placement (§5); M-13 tests (§10). **MINORS:** m-1 – m-16 (§6.1, §6.3, §6.5, §6.8, §6.13, §8, §9, §4.5 H-1, D-2). Assumptions in §12.3. Marked "⚠️ Changed by v0.4 (<id>)". |

---

## §1. Header

### The three rules

1. **One attach flow.** Every device shows a code; someone with `manage-devices` approves it on one form (name, kitchen station **or** screens, who may use it).
2. **"Who may use it" is `everyone` or `listed`.** On a `listed` device only the listed staff can sign in; any other PIN, even correct, is refused before it is checked.
3. **Approvals and admin only on `listed` devices.** On an `everyone` device the sensitive permissions (§3.3) never work, and a money action a person is allowed to do directly needs their own confirmation from a listed device (§3.3a). So a leaked PIN used at a shared counter or tablet cannot approve, void, discount, comp, reopen or open hub admin. ⚠️ Changed by v0.4 (M-1)

### In scope

Pairing by request for every device type (token pairing removed), device profile (name, screens, access, point), the sign-in check, the listed-only mask in `resolve()`, money downgrades, 01d binding, routing and in-person changes, 03b Pass binding through screens, staff shell tabs, migration of paired devices, admin recovery at zero admin devices.

### Out of scope / deferred (§12.4)

Sign-in alert with "Not me", shuffled PIN pad, PIN only while on shift, staff NFC cards, "add me to this device" request, Delivery screen, enforcing screens on the hub, 01e headless devices, the Capacitor app itself (9b; §8 states what 9b must do).

---

## §2. Existing architecture that must not change

- Device token auth; REVOKED terminal; re-pair = new row (00 §3.3).
- **`devices.device_type` keeps its four values and never changes on a row**; it now means hardware only. Its readers are: 01d bindings (AD-47) and routes, the client alert-mode rule (`socket.ts`), catch-ups and audiences (02b O17, 05 bill audiences), `as_drawer` (05).
- M44 request mechanics: 6-char display code, poll secret, 10-minute expiry, caps (M76), **the code check on approval** (proves the approver sees the physical screen).
- 00 §3.5 PIN order; new checks go **before step 2** (as M38's check does today, `auth/staff-session.ts:33-35`): not a PIN failure, no argon2.
- Sessions, takeover (M20), replacement (M6).
- Bootstrap admin (M42) and the hub CLI `issue-admin-bootstrap` (M72): the last-resort way in. The token still needs staff + PIN + `access-hub-admin`, with failures counted per IP. §6.11 reuses the same `issueAdminBootstrap` function and adds no new sign-in path.
- Event sourcing: projections rebuild from events. ⚠️ Changed by v0.4 (M-12): `devices` itself is **not** a projection. Its rows are inserted by handlers, and its event folds are forward-only `UPDATE`s with no reset (`kds/device-roles.ts:64`). So the upgrade (§5.3) appends events, and the new `device_profiles` / `device_people` tables are true projections.
- Routing and approver reads use the hub's unmasked directory (`alertDirectoryOf`, `alerts/raise.ts:98`). Only the **session's own** grants are masked (§3.3a). ⚠️ Changed by v0.4 (B-1)

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
| O-9 | The listed-only rule lives in the effective-permission resolver, one point for every check. | 02:39 (B-1) |
| O-10 | On an `everyone` device a direct money grant becomes a request the person confirms on their own listed device; with no listed device it goes to the normal approvers. | 02:39 (M-1) |
| O-11 | `close-shift-for-others` is counter work, not listed-only; raising a request is never masked. | 02:39 (M-2) |
| O-12 | State what the upgrade takes away; warn at 0 or 1 admin devices; at 0 show the bootstrap link on the hub admin home. | 02:39 (B-2) |
| O-13 | A binding follows the device's latest profile. | 02:39 (B-3) |
| O-14 | Editing your own device so you lose admin is refused; switching a device to `everyone` ends its admin sessions. | 02:39 (M-6) |
| O-15 | Only a personal phone (one person) is revoked when its list empties; any other device becomes `everyone` and needs review. Kiosks and tablets keep the `manager` screen. | 02:39 (M-7, M-9) |

### 3.2 Decisions

| ID | Decision | Prevents |
|---|---|---|
| M-1 | The **approver picks the people** on the form; the unpaired device never shows a roster or takes a PIN. Each listed person proves themself at their first sign-in with their PIN. | Staff names shown to any LAN client, and PIN guessing from an unauthenticated device |
| M-2 | `device_type` comes from the device's hint, can be corrected on the form before approval, never after. | Breaking `device_type` readers (§2) |
| M-3 | Kitchen = `device_type = 'kds'` (station, no sign-in), unchanged. Every other type is a staff device with `access` and `screens`. | A mode column duplicating `kds` |
| M-4 | **Screens are a view boundary only.** The hub enforces access (rule 2) and the mask (rule 3); it does not map commands to screens. Audiences stay as today (by permission and hardware). | A command→screen map across 02a / 02b / 03b / 05 with no security gain |
| M-5 | ⚠️ Changed by v0.4 (M-7): when a directory removal empties a device's list: a **phone whose list had exactly one person** is revoked (`cause: 'owner_removed'`, as M38 today). **Any other device** becomes `access = 'everyone'` with `needs_review = true` and is never revoked, so its drawer shift, printer routes, device targets and point work keep running. | A personal phone left paired after its owner leaves; a counter or Pass device going dark mid-service on an unattended sync |
| M-6 | Pass is a screen with a point; `devices.point_id` is written by `SetDeviceProfile`; 03b `SetDeviceRole` keeps only `lane_label`. | Two writers of `point_id` |
| M-7 | Inbox, requests to answer, own shift, Me and sign out are on every staff device, outside the screens. | Approval requests hidden behind a screen (01d R22) |
| M-8 | ⚠️ Changed by v0.4 (B-2): the hub admin home and the device list warn when **0 or 1** unrevoked `listed` devices list a person whose `manage-devices` resolves `allowed`. With 1: "Only one device can manage devices — add a backup". With 0: "No device can manage devices" and the **recovery link** (§6.11). The count comes from the in-memory `deviceProfile` map and the directory; no statement. | Owner's only admin device breaks, or the upgrade leaves none (OQ-6) |

### 3.3 Listed-only and money permissions (rule 3)

⚠️ Changed by v0.4 (B-1, M-1, M-2, m-16). Two lists in `@pos/domain/src/permissions.ts`:

- **`LISTED_ONLY_PERMISSIONS`** (masked to `not_granted`): `access-hub-admin`, `manage-devices`, `manage-staff`, `manage-roles`, `manage-fiscal-settings`, `approve-void`, `view-audit-log`.
- **`MONEY_PERMISSIONS`** (an `allowed` grant is downgraded): `void-item`, `apply-discount`, `apply-comp`, `apply-refund` (no command today; refunds go through `reopen-bill`, 05 S-8), `reopen-bill`.
- **Answering a 01d request of a money kind** (`needs_pin: 'always'`) needs a listed device (§3.9). This is the one rule that is not a permission, so it lives in `AnswerRequest` (§4.5 D-2).

**Not in either list** (O-11, owner OQ-3: counter work never breaks): `close-shift-for-others`, `close-business-day`, `view-reports`, `take-payment`, `open-cash-drawer`, `record-petty-cash`, `remove-comp`, `remove-service-charge`, `close-without-buyer-id`, and every permission a cashier or order taker uses.

**Counter check (OQ-3)** on an `everyone` kiosk:
- Unchanged: taking payment, the drawer, petty cash, closing another cashier's shift and its count (05 §6.18–§6.21), removing another cashier's payment (05 §6.10), reports, day close.
- A cashier's void, discount, comp and reopen **requests** are raised as today.
- Changed: a manager's direct void, discount, comp or reopen becomes "Confirm on your phone" (§3.3a). Every money answer moves to a listed device.

### 3.3a The mask in `resolve()` (00 §3.6) ⚠️ Changed by v0.4 (B-1, M-1, M-2)

`resolve(staff_id, permission)` is unchanged. Every place that resolves **for a session** gets a session-bound view, `directory.forSession(session)`. Its `resolve(staff_id, permission)` applies the table below **only when `staff_id` is the session's own staff and the session's device has `access = 'everyone'`**. Other staff ids resolve unmasked (their device is not this one).

The view is what these places get, so each inherits the rule from one point:
- `ctx.directory` of commands (`commands/registry.ts:28,44`), queries (`queries/registry.ts:19,119`) and PIN hooks;
- `authorize` in the pipeline (`commands/route.ts:353-373`);
- the admin guard (`requireAdmin` → `hasAdmin`, `auth/guards.ts:246`), `adminPermissions` and `permissionsOf`;
- 01d `mayAnswer` (`alerts/targets.ts:516`, for the answerer);
- direct routes that resolve for their session against the raw directory, today `print/routes.ts:111` (`requireManageDevices`), which switch to the view. ⚠️ Changed by v0.4 (B-1: a call site the review did not list)

Other raw-directory reads (`orders/audiences.ts:61`, routing) are about sockets or other people and stay unmasked (M-4).

| Session's own grant | `access = 'everyone'` device | Listed device, or a session with no device (bootstrap admin) |
|---|---|---|
| permission in `LISTED_ONLY_PERMISSIONS`, `allowed` | `{ grant: 'not_granted', masked: 'listed_only' }` | unchanged |
| permission in `MONEY_PERMISSIONS`, `allowed` | `{ grant: 'requires_approval', approver_role_ids: [], scope, masked: 'downgraded' }` | unchanged |
| any permission, `requires_approval` | **unchanged** (raising a request is never masked) | unchanged |
| `denied`, `not_granted`, any other permission | unchanged | unchanged |

- A `403 PERMISSION_DENIED` thrown for a masked resolution carries `reason: 'listed_device_only'` (pipeline and every handler or query that throws on a resolution: they read `resolution.masked`).
- A `downgraded` resolution takes the command's existing request path (`approvable: true`, 00 §3.7). `alerts.raise` reads `ctx.permission.masked === 'downgraded'` and stores the right as §3.9 says. Handlers do not change: they pass `ctx.permission.approver_role_ids` as today (`void-items.ts:71`, `discount.ts:184`, `reopen-bill.ts:343`, `comp-line.ts`).
- `GET /queries/session` returns the view's result, so the client hides `listed_only` actions and shows `downgraded` ones as "Confirm on your phone" (§6.7).
- Queued commands are resolved at execution time (`route.ts:144-146`). A command queued on a listed device and replayed after the device became `everyone` is masked (fail-closed). A command from a session the edit ended gets `401` and goes to the 02b §3.12 queue log. ⚠️ Changed by v0.4 (m-13)
- WS audiences (02b, 05) are unchanged (M-4). ⚠️ Changed by v0.4 (m-12)
- Cost: no statement; the device profile and the directory are in memory.

### 3.4 Accepted risk (O-8)

On a listed device with several people (a floor tablet listing the floor manager and two waiters), a waiter who learns the manager's PIN can approve there. The owner chose who is on that list. Everywhere else a leaked PIN approves nothing, and its direct money actions need the owner's own listed device (§3.3a).

### 3.5 Sign-in check (`POST /auth/pin`, `POST /admin/auth`)

Before 00 §3.5 step 2, both checks are not counted, run no argon2 and read the in-memory `deviceProfile` map with no statement:
- device `listed` and `staff_id` not on its list → **`403 DEVICE_ACCESS_DENIED { device_id }`**;
- `/admin/auth` on an `everyone` device → `403 PERMISSION_DENIED { permission: 'access-hub-admin', reason: 'listed_device_only' }`.

⚠️ Changed by v0.4 (m-8): the hub returns `DEVICE_ACCESS_DENIED` only. `DEVICE_NOT_OWNED` stays in `errors.ts` and F §6.2 (a code is never renamed or reused) but is no longer returned; the client maps both codes to the same text.

⚠️ Changed by v0.4 (m-10): **Takeover (M20)** is allowed between two people on the same `listed` list and on `everyone` devices. An unlisted person never reaches it (the check above runs first). On a one-person device only that person signs in, so only replacement (M6) applies.

### 3.6 Screens

| Key | Shows | Acts (with the permission) | Offered on |
|---|---|---|---|
| `dine_in` | table map, table view | open table, take order, send, served, request bill | all staff hardware |
| `takeaway` | takeaway queue, New order | create order, pay takeaway bills | all |
| `parking` | car slots made at runtime, New car order | create order, served, pay parking bills | all |
| `cashier` | every open bill, Held | settle, split, reprint, drawer, petty cash | `cashier_kiosk`, `tablet` |
| `pass` | Pass view of the device's point | `run-pass` | all; needs `point_id` |
| `manager` | live view, reports, day close, audit, test alert | (masked items hidden, §3.3a) | all |

- Tabs in list order; the device remembers its last tab.
- ⚠️ Changed by v0.4 (M-11): a screen is **hidden** when the person holds none of its permissions. There are no read-only screens: `cashier` needs `take-payment`; `manager` needs one of `view-reports`, `close-business-day`, `view-audit-log`, `manage-devices` (after the mask).
- 1–6 screens, unique, offered for the hardware; `pass` ⇔ `point_id` set.
- ⚠️ Changed by v0.4 (M-11, m-11): **hardware still decides three things.** Customer contact goes to `cashier_kiosk` hardware and the placer (02b O17), so a `tablet` with `cashier` does not see it. A drawer shift needs a kiosk or a tablet with a printer route (05 `as_drawer`, `DRAWER_DEVICE_INVALID`). Bill-stream audiences are `take-payment` holders and kiosks (05 H16-6).

### 3.7 Device lifecycle

```
 unpaired ─POST /pair/requests─► PENDING (code on screen, 10 min)
                                     │ ApprovePairingRequest (manage-devices, unmasked: a listed device or the bootstrap admin session; code typed)
                                     ▼
                                  ACTIVE ──SetDeviceProfile──► ACTIVE (name, screens, access, point; live, no re-pair)
                                     ├── RevokeDevice ─────────────────────────────────────► REVOKED
                                     ├── one-person phone, person removed (directory) ────► REVOKED 'owner_removed'
                                     └── other device, list emptied (directory) ─────────► ACTIVE, everyone, needs_review
```

### 3.8 Alert binding (01d §3.7) ⚠️ Changed by v0.4 (B-3)

The binding of a device is derived from its **latest** profile, recomputed on every `DeviceProfileSet`:

| Latest profile | Bound person |
|---|---|
| `listed`, exactly one person P (any hardware) | P, permanent (`session_id` NULL); `SessionStarted` / `SessionEnded` never touch it; routes like today's phone row (connected and present, no idle check) |
| `tablet` hardware, any other profile | the last signed-in person (today's tablet rule) |
| `phone` hardware, `everyone` or several people | the tablet rule |
| `cashier_kiosk` hardware, any other profile | none (today's BF-3 rule) |
| `kds` | none (no profile) |
| **no profile yet** (replay before the device's first `DeviceProfileSet`) | today's rules by hardware: a phone is bound to `DevicePaired.owner_staff_id`; tablet, kiosk, kds as today |

**Transitions on `DeviceProfileSet`:**
- To one person P → upsert `(device_id, P, session_id NULL)`; this replaces any session row.
- Away from one person → delete the permanent row. The next `SessionStarted` binds by the hardware rule. A session still open on the device stays unbound until its next sign-in, so the header shows "Alerts: none".
- `DeviceRevoked` → delete the row, as today.

**Client:** alert mode stays by hardware (`socket.ts:90-94`): kiosk and phone pages open it while signed out; the tablet page never does (9b's service will). So a one-person listed tablet page has no alert socket until 9b (known 01d gap, unchanged).

**Rebuild:** the projection keeps its own `device_id → latest profile` map from events and reads no `device_profiles` row, so `reset` + replay gives the same rows.

### 3.9 Money requests and answers (01d) ⚠️ Changed by v0.4 (M-1, M-5)

1. **Raise from a downgraded grant.** The request is raised as the kind's own request (same kind, values, details, steps), with the stored right chosen at raise:
   - **(a) the requester is on ≥ 1 unrevoked listed device** (from `deviceProfile`, no statement) → `right_mode: 'named'`, `receiver_staff_id` = the requester. Card text "Confirm on your phone". The requester answers it with their own PIN from a listed device; 01d rule 5 ("self") is skipped only for a `named` request whose receiver is its requester.
   - **(b) no listed device** → `right_mode: 'holders'`, `permission` = the kind's `range_permission` if it has one (void: `approve-void`), else its `base_permission` (`apply-discount`, `apply-comp`, `reopen-bill`). The normal approvers answer: anyone holding that permission `allowed` with a scope covering the requester, never the requester (rule 5 applies). **[ASSUMPTION A-2]**

   Both reuse `AlertRaised` v5's right modes, so there is no event version change.
2. **Answers:** a money-kind answer (`needs_pin: 'always'`) from a session on an `everyone` device → `403 PERMISSION_DENIED { reason: 'listed_device_only' }`. It is returned by `preRead`, right after rule 3 (PIN rule) and before argon2 (nothing counted, no PIN verified), and re-checked in `prepare`. Accept kinds are unchanged. No in-person answers (O-7).
3. **Routing (M-5):** for a money kind, a person route to an `everyone` device is dropped at resolve time (01d §3.4.3). Device targets keep their lock-only line, as today (they never answer). `requests-to-answer` on an `everyone` device omits money requests. The §3.9 "no one can approve" check counts an approver as reachable only through a listed-device route. So a request whose approvers are only on shared devices escalates as if they were away.
4. **Requester text:** `my-requests.ask_in_person` keeps its field; the client text becomes "Waiting — find a manager" (new key `request.find_approver`), because in-person answering is removed.

### 3.10 `device_waiting` (01d kind) ⚠️ Changed by v0.4 (M-4)

| | |
|---|---|
| Kind | `device_waiting`, family `info`, subject `hub` / branch_id, dedupe key `device_waiting`, `lead_fallback: false`, no request part |
| Target | `{ kind: 'permission', permission: 'manage-devices' }`, **listed devices only** (the §3.9 rule 3 drop applies to this kind too) |
| Raise | inside the `POST /pair/requests` transaction, only when no open `device_waiting` exists (1 statement); `actor_id` null, `device_id 'hub'`. 00 §6.30 "Events: none" becomes "`AlertRaised` (`device_waiting`) when none is open" |
| Update | none: a new request while it is open writes nothing. The alert carries no count and never the code; the device list shows the count |
| Close | `done` in the `ApprovePairingRequest` transaction when no other request is pending (the existing `pair_requests_pending` read); `obsolete` by the session sweeper (00 §7.3, existing 15 s timer) when no request is pending any more (expiry), in its existing write |
| Link | new 01d link type `{ type: 'devices' }` → staff route `#/devices` (the device list, Waiting group; §8) |

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | `devices`, `pair_requests`, `defineCommand`, `ws.sendToDevices`, session events, `issueAdminBootstrap` | pairing, profile, sign-in, recovery |
| 01b | directory (staff ids, grants), `applyStaffDirectory` hook | access check, mask, M-5 |
| 01d | `raise` (permission target), `registerKind`, binding projection, `mayAnswer` | `device_waiting`, bindings, §3.9 |
| 03b | `branchConfig().points`, `point` resolver | Pass screen |

### 4.2 Exposes

| Export | Shape |
|---|---|
| Event `DeviceProfileSet` v1 (stream `hub`, id = device_id, like `DevicePaired`; ⚠️ Changed by v0.4 (m-9)) | `{ device_id, device_name, access: 'everyone' \| 'listed', staff_ids: string[] (empty for everyone), screens: ScreenKey[], point_id: string \| null, profile_version: int, cause: 'approved' \| 'edited' \| 'directory' \| 'upgrade', needs_review: boolean }`. The whole profile each time; replay = last event per device wins. `needs_review` is `true` for `upgrade` and for a `directory` event that switched the device to `everyone` (M-5); otherwise `false`. ⚠️ Changed by v0.4 (M-12) |
| Audit action `device_profile_set` (04, row A-1) | detail `{ device_name, access, people: display names, screens, point_id, cause }`; actor = the editor (null for `upgrade` / `directory`). ⚠️ Changed by v0.4 (M-8) |
| `DeviceRevoked.cause` | unchanged enum `['manual', 'owner_removed']`: M-5's revoke is the M38 case and keeps `owner_removed`. No schema change. ⚠️ Changed by v0.4 (M-8) |
| `deviceProfile(device_id)` | memory `{ access, staff_ids: Set, screens, point_id, needs_review }`, refreshed after `DeviceProfileSet`, `DevicePaired`, `DeviceRevoked` commits |
| `directory.forSession(session)` | the masked view (§3.3a) |
| `LISTED_ONLY_PERMISSIONS`, `MONEY_PERMISSIONS`, `SCREEN_KEYS`, `screensOffered(device_type)` | `@pos/domain` |

### 4.5 Changes to other specs (R26) — *Proposed, needs approval*

| Row | Target | Change |
|---|---|---|
| H-1 | 00 §3.3, §6.7, §6.8, §6.30–§6.32, §8.1, §8.2, M14, M44, M86 | Every device pairs by request; approval takes the profile (§6.3). ⚠️ Changed by v0.4 (m-14): **removed**: `GenerateDevicePairingToken` (`commands/generate-device-pairing-token.ts`) and `POST /devices/pair` (`auth/pairing.ts`) with their registrations (`server.ts:36,177`; `pairing_token` stays in `SECRET_FIELDS`, `server.ts:92`); the pair page's `t` / `d` branch (`auth/pair-page.ts:359-374`); the hub admin views **Add a phone** (`#add-phone`) and **Add a tablet** (`#add-tablet`, STAB-1) (`admin/page.ts:33-34, 880-1025`); 00 tests 167, 168 (replaced by §10 test 1). `pairing_tokens` stays (unused; the sweeper purges it); the `DevicePaired` and `pairing_token_generated` audit mappers stay for history; `DeviceTokenRotated` (M14) is retired for devices (no path writes it). Pair page text "Ask someone with hub access to approve this screen". The Capacitor lines are 9b text (§8) |
| H-2 | 00 §3.5, §6.6, §6.9, §6.13 | §3.5 checks; `DEVICE_ACCESS_DENIED`; `/admin/auth` refused on `everyone` devices; `/admin/login-roster` (§6.13): `everyone` → `403 listed_device_only`; listed → its people whose `access-hub-admin` is `allowed`; response adds `recovery_available` (§6.11). ⚠️ Changed by v0.4 (m-4) |
| H-3 | 00 §3.6, §3.7, §6.20 | ⚠️ Changed by v0.4 (B-1): the mask lives in the session view of `resolve()` (§3.3a); the pipeline's `authorize`, `requireAdmin` and the query registry use the view; `403` reason `listed_device_only`. The pipeline gains no separate guard |
| H-4 | 00 M38, §6.13, §6.17, §6.18c, §6.19, `apply-directory.ts` | `owner_staff_id` readers → the profile's `staff_ids`; `phone_count` → `device_count` (listed devices naming the person); M38 revoke → M-5; roster on a listed device = its people only. ⚠️ Changed by v0.4 (m-3): §6.17 `pairing_source` (today a `CASE` on `device_type`, `queries/devices.ts:24`) is **dropped** from the response |
| H-5 | 00 §5.1 | Migration `0027` (§5.1) |
| H-6 | 00 §3.7, §6.2 | ⚠️ Changed by v0.4 (M-3): a query may be `sessionKind: 'both'` (registered on `GET /queries/` and `GET /admin/queries/`), like 05 row H-1 for commands; used by `devices` (§6.8) |
| H-7 | 00 §6.29 / M72, §4.2 events | ⚠️ Changed by v0.4 (B-2): `AdminBootstrapTokenIssued` **v2** adds `issued_by: 'recovery'` (upcaster v1 → v2 = identity); `issueAdminBootstrap(tx, 'recovery')` (§6.11) |
| D-1 | 01d §3.7 bindings, §3.4.3 routes | ⚠️ Changed by v0.4 (B-3): §3.8 table and transitions replace the phone row; the projection consumes `DeviceProfileSet`; a one-person permanent row routes like the phone row on any hardware (`alerts/routes.ts:115-119`) |
| D-2 | 01d §3.3 rules 2, 4, 5; §6.2; §6.8 | **Method `in_person` removed** (O-7): the payload enum keeps the value, and `preRead` returns `403 PERMISSION_DENIED { reason: 'in_person_removed' }` before argon2. `RequestAnswered.method` / `RequestPinFailed.method` keep `in_person` for history. `answered_on_requester_device` stays (now only `pin` / `session` answers on the raising device). 00 §8.5's "`'in_person'`" sentence goes. The answer sheet drops "Approve here" (`AnswerSheet.tsx:412-415`, `InPerson.tsx`). ⚠️ Changed by v0.4 (m-5, M-1, M-5): §3.9 rules 1–4 (the downgraded right; rule 5 skipped for a named self request; the money-answer refusal placed after rule 3 in `preRead` / `prepare`; the routing drop; `request.find_approver` text) |
| D-3 | 01d §3.10, §3.13.1, §3.13.5 | New kind `device_waiting` (§3.10), link type `{ type: 'devices' }`, route `#/devices` added to the `focus`-free route list. ⚠️ Changed by v0.4 (M-4) |
| D-4 | 01d §3.4 `always_on` (from 03b D-5 / D-6) | ⚠️ Changed by v0.4 (M-10): "unrevoked `tablet` devices bound to an active point" → "unrevoked non-kds devices with `point_id` set to an active point" (`alerts/targets.ts:443`) |
| K-1 | 03b §3.4, §3.8, §6.10, §6.12, §6.15 | `SetDeviceRole.point_id` removed (M-6): new `DeviceRoleSet` events carry the device's current `point_id` unchanged (v1 shape kept), so the forward-only fold (`kds/device-roles.ts:65-75`) and historic events replay as today. ⚠️ Changed by v0.4 (M-10): "Pass tablet" (03b:100) = "a non-kds device with `point_id`" in **every** reader: the memory map (`device-roles.ts:36`, also refreshed after `DeviceProfileSet`), the `point` resolver (`device-roles.ts:78-82`), `kds-config.pass_tablets` (`queries/kds-config.ts:19-21, 89-91`) and `PassScreen.tsx:130` (route parsing with the device's own type). `always_on` is row D-4 |
| K-2 | 00 §8.2, 03b Kitchen screens page | "Use as Pass tablet" link (`admin/page.ts:774-777`) and the bind dialog (`BindDialog.tsx:45`) → a link to the device edit form (§8), shown on every non-kds row |
| A-1 | 04 audit (`packages/domain/src/audit.ts`) | ⚠️ Changed by v0.4 (M-8): new action `device_profile_set` (§4.2); existing `device_paired`, `device_revoked`, `pairing_token_generated` unchanged |
| B-1 | 05 §8 (counter), §6.13 | ⚠️ Changed by v0.4 (M-1, M-2): no rule change in 05; its approvable commands take the downgraded path through `ctx.permission` (§3.3a); the client shows "Confirm on your phone" |
| F-1 | Foundation §6.2 | ⚠️ Changed by v0.4 (m-8): append 403 `DEVICE_ACCESS_DENIED`, 422 `DEVICE_ACCESS_SELF` (R34, no bump) |
| C-1 | client staff shell | ⚠️ Changed by v0.4 (M-9, M-11, gating): tabs from `screens`; home = first screen (was kiosk → `kiosk_home`, else inbox / pass; `kiosk_home` is retired, its content is the `takeaway` screen); `device_profile` push redraws the tabs; **what is shown comes from the profile and the masked permissions, never from `device_type` or screen width**. Width only picks the layout (bottom tabs ≤ 760 px, top bar wider; `PHONE_QUERY`, `shell/layout.ts:4`); the width gates `!phone && …` (`StaffApp.tsx:500-510`) are removed |

---

## §5. Data model and migrations

### 5.1 Hub migration `0027_device_profiles.sql` ⚠️ Changed by v0.4 (M-12)

The file's first line is `-- migrate:foreign-keys-off` (the runner's rebuild recipe, `db/migrate.ts:66-79`; `foreign_key_check` runs before commit). Its steps, in order:

1. **Rebuild `devices`** without `CHECK ((device_type = 'phone') = (owner_staff_id IS NOT NULL))`:
   - `CREATE TABLE devices_v2` with every column of `0002` and `0008`, in order: `device_id TEXT PRIMARY KEY`, `branch_id`, `token_hash TEXT NOT NULL UNIQUE`, `device_name`, `device_type` (with its `IN` check), `station_id`, `owner_staff_id`, `paired_at`, `paired_by`, `last_seen_at`, `revoked_at`, `revoked_by`, `point_id`, `lane_label`, and `CHECK ((device_type = 'kds') = (station_id IS NOT NULL))`.
   - `INSERT INTO devices_v2 SELECT … FROM devices`; `DROP TABLE devices`; `ALTER TABLE devices_v2 RENAME TO devices`.
   - `devices` has no other index or trigger, and no FK refers to it today, so nothing else is recreated.
   - The merged `0002` is not edited. `owner_staff_id` stays as a column, null on new rows.
2. **Create the projections:**

```sql
CREATE TABLE device_profiles (           -- projection of DeviceProfileSet; staff devices only
  device_id       TEXT    PRIMARY KEY REFERENCES devices(device_id),
  access          TEXT    NOT NULL CHECK (access IN ('everyone','listed')),
  screens         TEXT    NOT NULL,      -- JSON array, ordered, 1–6
  profile_version INTEGER NOT NULL,      -- SetDeviceProfile expected_version
  needs_review    INTEGER NOT NULL CHECK (needs_review IN (0,1))   -- from DeviceProfileSet.needs_review
);

CREATE TABLE device_people (             -- projection of DeviceProfileSet.staff_ids (listed devices)
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  staff_id  TEXT NOT NULL,
  PRIMARY KEY (device_id, staff_id)
);
CREATE INDEX device_people_staff ON device_people (staff_id);   -- M-5 and H-4 device_count
```

3. **Add the hint column:**

```sql
ALTER TABLE pair_requests ADD COLUMN hardware_hint TEXT
  CHECK (hardware_hint IN ('tablet','cashier_kiosk','kds','phone'));
```

- `device_profiles` / `device_people` are projections (`registerHubProjections`, with `reset` = `DELETE` of both). They have no checkpoint at first boot, so `catchUp` resets them and replays from seq 0 (`projections/registry.ts:71,99`).
- The `DeviceProfileSet` fold also writes `devices.device_name` and `devices.point_id` as a **forward-only** `UPDATE` (the `device_roles` pattern): it is idempotent and is not part of the reset (§2).
- These FKs are the first that refer to `devices`. Any later rebuild of `devices` must use the FK-off recipe.

### 5.2 Invariants

- `access = 'everyone'` ⇔ no `device_people` rows; `listed` ⇒ 1–20 rows (M-5 never leaves a listed device empty: it switches to `everyone` or revokes).
- `kds` devices have no `device_profiles` row.

### 5.3 Paired devices on upgrade ⚠️ Changed by v0.4 (B-2, M-9, M-12)

One boot step (§6.10) after the projection catch-up appends `DeviceProfileSet { cause: 'upgrade', needs_review: true }` for each unrevoked non-kds device without a profile.

| Today | Access | Screens |
|---|---|---|
| `cashier_kiosk` | `everyone` | `takeaway`, `parking`, `dine_in`, `cashier`, `manager` |
| `tablet` with `point_id` | `everyone` | `pass`, `dine_in`, `takeaway`, `parking`, `cashier`, `manager` |
| `tablet` | `everyone` | `dine_in`, `takeaway`, `parking`, `cashier`, `manager` |
| `phone` | `listed` [owner] | `dine_in`, `takeaway`, `parking`, `manager` |

**What the upgrade takes away** (by design, rule 3):

- On **kiosks and tablets**:
  - hub admin (`/admin/auth` → `403`);
  - approving a pairing request (the Capacitor and browser admin screens);
  - device, staff and lockout admin;
  - fiscal settings;
  - audit view;
  - every **money answer**.
- On kiosks and tablets, a manager's **direct** void, discount, comp and reopen become "Confirm on your phone".
- `kiosk_home` becomes the `takeaway` screen (C-1).

What stays: Reports, Day close, Test alert and every counter action (§3.3), through the `manager` screen (M-9).

**Recovery:** after the upgrade, a branch whose admins own no paired phone has **0** listed admin devices. M-8 shows the recovery link on the hub admin home (§6.11), so the owner pairs their phone through the normal flow, approving it from the bootstrap session.

---

## §6. Endpoints

### 6.1 `POST /pair/requests` (changed, 00 §6.30)

⚠️ Changed by v0.4 (m-2): input adds `hardware_hint?`, a **default for the form only** (M-2):
- The pair page sends `phone` when the user agent matches `/iPhone|Android.*Mobile/`; otherwise it sends nothing. iPadOS reports a desktop agent and Android tablets omit `Mobile`, so those requests reach the form without a hint.
- The 9b app will send `tablet`.

Processing: as today, plus the column and the `device_waiting` raise (§3.10). Statements: today's + 1 (open `device_waiting` read) + the raise when none is open. Response and errors unchanged.

### 6.2 `GET /pair/requests/:id` (changed, 00 §6.31)

`approved` adds `screens`. `kds` → `/kds/`, others → `/staff/` (unchanged). Query count unchanged (1).

### 6.3 `ApprovePairingRequest` (changed, 00 §6.32)

| | |
|---|---|
| Route | ⚠️ Changed by v0.4 (M-3): `sessionKind: 'both'` (`/commands/approve-pairing-request` and `/admin/commands/…`; today admin only, `approve-pairing-request.ts:379-382`) |
| Permission | `manage-devices`, resolved through the view, so it works only on a listed device or in the bootstrap admin session (O-2; `access-hub-admin` is not needed on `/commands`) |
| Payload | `{ request_id?, display_code, device_type, device_name: string(1–40), station_id?, access?, staff_ids?, screens?, point_id? }`. `kds` ⇒ `station_id` required, the rest absent. Else `access` and `screens` required; `listed` ⇒ `staff_ids` 1–20 unique; `everyone` ⇒ `staff_ids` absent |

Processing (`writer.run`):
1. Find the request (00 §6.32 rules: exact `display_code` match) → `404 PAIRING_REQUEST_NOT_FOUND`.
2. `kds`: station validator → `404 STATION_NOT_FOUND`.
3. Staff device:
   - each `staff_ids` entry must be in the directory → else `404 STAFF_NOT_FOUND { staff_id }`;
   - screens must be offered for the hardware → else `400 VALIDATION_FAILED { field: 'screens' }`;
   - `pass` ⇔ `point_id` → else `400 VALIDATION_FAILED { field: 'point_id' }`;
   - the point must be active → else `404 POINT_NOT_FOUND`.
4. INSERT `devices` (no owner), mark the request approved, append `DevicePaired` (v1, unchanged; stream `hub` / device_id); staff device: append `DeviceProfileSet { cause: 'approved', profile_version: 1, needs_review: false }`. Close `device_waiting` if no other request is pending (§3.10).
5. Post-commit: refresh `deviceProfile`.

| | |
|---|---|
| Result | `{ device_id, device_type, station_id, screens, access }` (never the token) |
| Idempotency | D32 |
| Statements | ⚠️ Changed by v0.4 (m-6): request read (1), INSERT, UPDATE, appends (2–3), pending read for the close (1) + the close |
| Errors | §6.1; `400`, `403 PERMISSION_DENIED` (incl. `listed_device_only`), `404 PAIRING_REQUEST_NOT_FOUND` / `STATION_NOT_FOUND` / `STAFF_NOT_FOUND` / `POINT_NOT_FOUND` |
| Events | `DevicePaired`, `DeviceProfileSet`, `AlertClosed` |

Form defaults (client): `phone` hint → `listed`, one person to pick, screen `dine_in`; `cashier_kiosk` or no hint → `everyone`, `takeaway` + `cashier` + `manager`; `tablet` → `everyone`, `dine_in` + `manager`. Name suggested ("Counter 2", "Ali's phone").

### 6.4 `SetDeviceProfile` (new; `sessionKind: 'both'`)

| | |
|---|---|
| Permission | `manage-devices` (listed-only, through the view) |
| Payload | `{ device_id, expected_version, device_name?, access?, staff_ids?, screens?, point_id? }`; unsent fields kept; §6.3 step 3 rules on the merged profile |

Processing (`writer.run`):
1. Device missing, revoked or `kds` → `404 DEVICE_NOT_FOUND`.
2. `profile_version ≠ expected_version` → `409 CONFIG_STALE { device_id, profile_version }` (01b R32 "Changed elsewhere" + Reload). ⚠️ Changed by v0.4 (m-7)
3. Validate the merged profile.
4. ⚠️ Changed by v0.4 (M-6): **self-guard** → `422 DEVICE_ACCESS_SELF { device_id }`. It applies when the device is the one the editor's session is on (staff session device, or the device an admin session is bound to), and the edit either:
   - (a) leaves the editor off a `listed` list, or
   - (b) switches the device to `everyone` while the editor's `manage-devices` or `access-hub-admin` resolves `allowed` unmasked, which would cost them admin there.
5. Append `DeviceProfileSet { cause: 'edited', profile_version + 1, needs_review: false }`.
6. Post-commit, in order:
   - refresh `deviceProfile`;
   - a staff session of someone no longer allowed → end it `'forced'` (`ended_by` = editor) and close its sockets `4401`;
   - ⚠️ Changed by v0.4 (M-6): the device became `everyone` → end every **admin** session bound to it `'forced'`;
   - push `device_profile { screens, access, point_id }` to the device (a removed tab under the user → first remaining tab + toast).

| | |
|---|---|
| Result | `{ device_id, profile_version }` |
| Statements | ⚠️ Changed by v0.4 (m-6): device + profile read (1), people read (1), append, projection writes; session ends 1 per ended session (≤ 1 staff + admin sessions of one device) |
| Errors | §6.1; `400`, `403 PERMISSION_DENIED`, `404 DEVICE_NOT_FOUND` / `STAFF_NOT_FOUND` / `POINT_NOT_FOUND`, `409 CONFIG_STALE`, `422 DEVICE_ACCESS_SELF` |

`RevokeDevice` (00 §6.14) becomes `sessionKind: 'both'` too (M-3), with no other change.

### 6.5 `POST /auth/pin`, `POST /admin/auth` (changed, 00 §6.9, §6.6)

§3.5 checks before 00 §3.5 step 2. `/auth/pin` response adds `device: { screens, access, point_id }`. Statements unchanged (memory).

### 6.6 `GET /queries/staff-roster` (changed, 00 §6.19)

`listed` device → only its people; `everyone` → the whole directory (unchanged). Query count unchanged (2).

### 6.7 `GET /queries/session` (changed, 00 §6.20)

Adds `device: { device_id, screens, access, point_id }`. Each `permissions[p]` is the **view's** resolution (§3.3a), with `masked: 'listed_only' | 'downgraded'` when masked. The client hides `listed_only` and shows `downgraded` as "Confirm on your phone". Query count 0.

### 6.8 Device list `devices` (changed, 00 §6.17)

⚠️ Changed by v0.4 (M-3): `sessionKind: 'both'` (H-6), permission `manage-devices` (view).

Each row adds `access`, `people: [{ staff_id, display_name }]`, `screens`, `point_id`, `profile_version`, `needs_review` (from `device_profiles.needs_review`; M-12). `pairing_source` is dropped (m-3). The response adds `pending_requests: [{ request_id, device_name, hardware_hint, created_at }]` (never the code) and `admin_warning: 0 | 1 | null` (M-8: the count when it is 0 or 1, else null).

Query count: today's 1–2, +1 for `device_profiles` ⋈ `device_people`, +1 for pending requests.

⚠️ Changed by v0.4 (m-15): page groups, first match wins: **Waiting** (pending requests), **Kitchen** (kds), **Personal** (listed, one person), then by first screen: **Counter** (takeaway / cashier / parking), **Floor** (dine_in), **Pass**, **Back office** (manager). Hardware is an icon only. A **needs review** chip shows on flagged rows; any edit clears it.

### 6.9 Directory apply (changed, 00 `applyStaffDirectory` hook) ⚠️ Changed by v0.4 (M-7, m-6)

The removed staff's sessions end `'staff_removed'` first (today's order). Then, in the same apply transaction:
1. **1 statement:** `SELECT device_id, staff_id FROM device_people WHERE staff_id IN (<removed>)` (`device_people_staff`).
2. For each affected device:
   - **phone hardware whose list was exactly the removed person** → the `RevokeDevice` path, `cause: 'owner_removed'`;
   - **a list left non-empty** → `DeviceProfileSet { cause: 'directory', needs_review: false }` without them;
   - **any other device whose list is left empty** → `DeviceProfileSet { cause: 'directory', access: 'everyone', staff_ids: [], needs_review: true }`.

The device's drawer shift, printer routes, device targets and point are untouched. Bounded: tens of devices, one append each.

### 6.10 Upgrade boot step (§5.3) ⚠️ Changed by v0.4 (M-12)

Runs at boot **after** the projection `catchUp` (so `device_profiles` is current) and before listen.

- **Reads:** 1 statement: `devices` LEFT JOIN `device_profiles`, unrevoked, non-kds, no profile.
- **Writes:** one `writer.run` appending one `DeviceProfileSet` per device. `actor_id` null, `device_id 'hub'`, as other hub-written events (00 M72, 01d).
- **Idempotent:** a device with a profile is skipped, so a second boot appends nothing.

### 6.11 Admin recovery at zero admin devices ⚠️ Changed by v0.4 (B-2)

| | |
|---|---|
| Signal | `GET /admin/login-roster` (00 §6.13) adds `recovery_available: boolean` = M-8 count is 0 (memory, no statement). The hub admin home shows "No device can manage devices" and a **Recover admin access** button when it is true |
| Route | `POST /admin/recovery-link`, auth as `/admin/login-roster` (device token of a paired non-kds device); no session |
| Processing | count ≠ 0 → `403 PERMISSION_DENIED { reason: 'recovery_not_needed' }`; else `writer.run(tx ⇒ issueAdminBootstrap(tx, 'recovery'))` (M72: expires every live bootstrap token, new single-use 30-min token, `AdminBootstrapTokenIssued` v2) |
| Response | `{ first_admin_url, expires_at }`; the page shows it as a QR and a link (as setup does, M42) |
| Security | the link is the existing bootstrap path: it still needs a staff member, their PIN and `access-hub-admin`, with failures counted per IP (M42). No new sign-in path. A second press expires the first link |
| Statements | 1 transaction of `issueAdminBootstrap` |

---

## §7. Cross-cutting

No new timer, cache, job or dependency. Every check reads the in-memory `deviceProfile` map and the directory, refreshed on commit (YAGNI: tens of devices per branch). The `device_waiting` close on expiry rides the existing session sweeper.

## §8. Client contract

- **Pair page:** one flow for every device: big code + QR, "Ask someone with hub access to approve this screen". iOS keeps "Add to Home Screen" first, then the request from the home-screen app (00 §8.2 rule 2, now for the request).
- ⚠️ Changed by v0.4 (m-2): **Capacitor app (9b, future: no app code exists yet).** 9b shows the request code from `POST /pair/requests` with `hardware_hint: 'tablet'`. It must learn the hub address without a token QR (typed, or a QR of the hub address shown by setup or the admin home). 9b specifies how.
- **Approve form:** in `/staff/` (`#/devices`, M-3) on a listed device, opened from the `device_waiting` notice or the device list; `/admin/approve` stays for the bootstrap admin. ⚠️ Changed by v0.4 (m-1): the QR fills the request (`r`); **the display code is always typed** (the M44 proof), never prefilled.
- **Device list and edit form:** `#/devices` in `/staff/` and `/admin#devices`, the same query (§6.8) and commands (§6.3, §6.4, `RevokeDevice`); the Kitchen screens page links to the edit form (K-2).
- **Staff shell (C-1):** tabs from `screens`; inbox, requests, shift, Me, sign out in the top bar (M-7); redraw on `device_profile`. Items come from the profile and the masked permissions only; width picks the layout only.
- ⚠️ Changed by v0.4 (M-11): **deep links (01d §3.13)** to a place whose screen the device does not have (`#/tables/…` without `dine_in`, `#/orders/…` without `takeaway` / `parking`, `#/pass` without `pass`) **fall back to the inbox** with the alert selected (`#/inbox?focus=alert:<id>`), with a toast "Open this on a device with <screen>". Deep links only ever target the 01d §3.13.5 routes, so no other fallback is needed.
- **Answer sheet (01d):** no "Approve here" (in-person) path; on an `everyone` device a money card shows "Approve on a listed device" with no Approve button. A downgraded request shows "Confirm on your phone" to the requester at the counter, and the answer sheet on their phone.
- **Errors:** `DEVICE_ACCESS_DENIED` and `DEVICE_NOT_OWNED` → "This device is not set up for you"; `PERMISSION_DENIED { reason: 'listed_device_only' }` → "Do this on your own phone"; `DEVICE_ACCESS_SELF` → "You would lose access on this device".

## §9. Error catalogue additions

| Code | Status | Details |
|---|---|---|
| `DEVICE_ACCESS_DENIED` | 403 | `{ device_id }`; returned instead of `DEVICE_NOT_OWNED` (§3.5) |
| `DEVICE_ACCESS_SELF` | 422 | `{ device_id }`. A business rule on the editor's own device, independent of concurrent edits (those give `CONFIG_STALE`). ⚠️ Changed by v0.4 (m-7) |
| `PERMISSION_DENIED` reasons `listed_device_only`, `in_person_removed`, `recovery_not_needed` | 403 | existing code, new reasons |

Appended to Foundation §6.2 (row F-1) and `@pos/domain/src/errors.ts` (§11 step 1). ⚠️ Changed by v0.4 (m-8)

## §10. Tests

⚠️ Changed by v0.4 (M-13): renumbered and extended.

| # | Case |
|---|---|
| 1 | phone, tablet, kiosk and kds pair through `/pair/requests` + approve; the token routes answer `404 ROUTE_NOT_FOUND` |
| 2 | wrong display code → `404`, nothing written; a request id from the QR with no code → `400` |
| 3 | Bilal's correct PIN on Ali's listed phone → `403 DEVICE_ACCESS_DENIED`; no counter changed; argon2 not called; `staff-roster` on the phone lists only Ali |
| 4 | **resolver:** on an `everyone` device the session view returns `not_granted / listed_only` for each `LISTED_ONLY_PERMISSIONS` entry granted `allowed`, `requires_approval / downgraded` for each `MONEY_PERMISSIONS` entry granted `allowed`, everything else unchanged; on a listed device and in a bootstrap session nothing is masked; another staff id is never masked |
| 4a | call site **pipeline:** `ApprovePairingRequest` from an `everyone` device → `403 listed_device_only` |
| 4b | call site **check inside a handler:** the fiscal query's own `manage-fiscal-settings` check (`fiscal/credentials.ts:91`) and the printer route's `manage-devices` check (`print/routes.ts:111`) on an `everyone` device → `403 listed_device_only` |
| 4c | call site **query:** the audit query (`audit/queries.ts:105`) on an `everyone` device → `403` |
| 4d | call site **admin guard:** an admin session bound to a device switched to `everyone` is ended (`'forced'`); a racing `/admin/queries/devices` before the end → `403` |
| 4e | call site **`/admin/auth`** on an `everyone` device → `403 listed_device_only`, no PIN verified, no counter |
| 4f | call site **`AnswerRequest`:** a void answer on an `everyone` device → `403 listed_device_only` from `preRead`; argon2 not called; counters unchanged |
| 4g | `GET /queries/session` reports `masked` per §6.7 |
| 5 | the same manager on their listed phone answers the void |
| 6 | floor tablet listed [floor manager, waiter]: floor manager answers a void there (accepted risk §3.4) |
| 7 | a cashier on an `everyone` counter raises a void request: it is raised, rings the manager's **listed** phone, and does not ring the manager's `everyone` tablet session; `requests-to-answer` there omits it |
| 7a | approvers reachable only on `everyone` devices → the request escalates as unreachable (§3.9 rule 3) |
| 7b | a cashier's `ReopenBill` with `requires_approval` on an `everyone` counter raises the request |
| 7c | counter work on an `everyone` kiosk: a manager closes and counts another cashier's shift, removes another cashier's payment, opens the drawer, records petty cash, prints a Z report, closes the day — all succeed |
| 8 | `in_person` answer → `403 in_person_removed`, before argon2 |
| 9 | `SetDeviceProfile` removing the signed-in person ends the session `'forced'` and pushes `device_profile` |
| 10 | two admins edit one device → the second gets `409 CONFIG_STALE { device_id, profile_version }` |
| 11 | an admin removing themself from the device they are on → `422 DEVICE_ACCESS_SELF`; switching it to `everyone` → `422`; switching **another** device to `everyone` ends that device's admin sessions |
| 12 | directory removal: dropped from every list in one read; a one-person **phone** → revoked `owner_removed`; a one-person **kiosk** with an open drawer shift → `everyone`, `needs_review`, shift still open and payable; a listed Pass tablet emptied → `everyone`, its Pass still works |
| 13 | `pass` without `point_id` → `400`; `cashier` on a phone → `400` |
| 14 | replay rebuilds `device_profiles` / `device_people` exactly, including `needs_review` |
| 14a | bindings: a one-person listed tablet binds its person permanently; edit 1 → 2 people drops the permanent row and the next sign-in binds (tablet rule); 2 → `everyone` on a phone follows the tablet rule; → 1 person binds permanently again; a one-person kiosk binds permanently and routes; `reset` + replay gives the same rows |
| 14b | replay of an old phone: bound to `DevicePaired.owner_staff_id` until its upgrade `DeviceProfileSet`, then by the profile |
| 15 | upgrade: a phone becomes `listed` [owner]; a kiosk becomes `everyone` with its five screens; a tablet keeps `manager`; every action visible before the upgrade per hardware is visible after, except §5.3's list; events have `actor_id` null and `device_id 'hub'`; second boot appends nothing |
| 16 | admin warning: 0 listed admin devices → `admin_warning: 0`, `recovery_available: true`; 1 → `1`; 2 → `null` |
| 16a | recovery: `POST /admin/recovery-link` at 0 issues a bootstrap token (`issued_by: 'recovery'`), the link signs in with PIN, the owner approves their phone; at ≥ 1 → `403 recovery_not_needed` |
| 17 | downgrade with a listed device: a manager's direct void on an `everyone` kiosk raises a `named` request to themself; it rings only their listed phone; they approve it there with their PIN (rule 5 skipped); answering it from the kiosk → `403 listed_device_only` |
| 18 | downgrade with no listed device: the request is `holders` of `approve-void`; another manager answers on a listed device; the requester cannot (`self`) |
| 19 | downgraded discount, comp and reopen follow tests 17–18 (holders of `apply-discount`, `apply-comp`, `reopen-bill`) |
| 20 | a queued manager command replayed after the device became `everyone` is masked (fail-closed) |
| 21 | `device_waiting`: one notice for two requests; never the code; closed `done` when the last is approved; closed `obsolete` by the sweeper when the last expires; delivered only to listed devices; link opens `#/devices` |
| 22 | a phone with `pass` + `point_id` receives `ready_to_serve`, is in `always_on`, and is listed in `kds-config.pass_tablets` |
| 23 | deep link to `#/tables/…` on a device without `dine_in` → inbox with the alert selected |
| 24 | `ApprovePairingRequest` on `/commands` from a listed staff session with `manage-devices` and no `access-hub-admin` → `200`; the bootstrap admin session approves on `/admin/commands` |
| 25 | `hardware_hint` outside the four values → `400` |
| 26 | takeover between two listed people works; an unlisted person gets `403 DEVICE_ACCESS_DENIED` before any takeover |
| 27 | audit: `DeviceProfileSet` writes a `device_profile_set` row with the editor as actor |

## §11. Build order

1. `@pos/domain`: `SCREEN_KEYS`, `screensOffered`, `LISTED_ONLY_PERMISSIONS`, `MONEY_PERMISSIONS`; `errors.ts` (`DEVICE_ACCESS_DENIED`, `DEVICE_ACCESS_SELF`); audit action `device_profile_set`. `@pos/events`: `DeviceProfileSet` v1, `AdminBootstrapTokenIssued` v2. [§3.3, §3.6, §4.2, §9]
2. Migration `0027` with the `devices` rebuild; projections; `deviceProfile` memory. [§5]
3. The session view `forSession` and its call sites (pipeline, queries, admin guard, PIN hooks); `/queries/session`. [§3.3a, H-3]
4. Pairing (§6.1–§6.3) on both routes; remove token routes. [H-1, M-3]
5. Sign-in and roster (§6.5, §6.6, login-roster). [H-2]
6. `SetDeviceProfile` (§6.4), `RevokeDevice` both routes; device list (§6.8, H-6); directory apply (§6.9). [H-4]
7. 01d D-1–D-4 (bindings, §3.9 money rules, `device_waiting`); 03b K-1, K-2.
8. Upgrade boot step (§6.10); admin recovery (§6.11). [H-7]
9. Client: pair page, approve form, device list page, shell tabs (C-1), deep-link fallback, answer sheet. [§8, C-1, K-2]

## §12. Done, open questions, deferred

### 12.1 Definition of Done

Every §10 test green in the normal gate. A manual check on a tablet, a kiosk PC, a KDS screen and an Android + iPhone phone covers: pair, sign in, refused PIN, live tab change, "Confirm on your phone", recovery link. 00 / 01d / 03b / 04 are bumped with "Changed by 05a" markers, and F §6.2 is appended.

### 12.3 Open questions

| # | Question | Rec |
|---|---|---|
| OQ-1 | `close-business-day` and `view-reports` stay usable on `everyone` devices (counter)? | Yes (owner OQ-3, O-11) |
| OQ-2 | Up to 20 people on a listed device enough? | Yes |
| A-1 **[ASSUMPTION]** | `remove-comp`, `remove-service-charge` and `close-without-buyer-id` are not money-downgraded (the owner's M-1 list names five permissions) | Keep as ruled; add later if wanted |
| A-2 **[ASSUMPTION]** | With no listed device, a downgraded request goes to holders of the kind's `range_permission`, else its `base_permission` (§3.9 rule 1b) | The simplest "normal approvers" for a grant that has no approver roles |
| A-3 **[ASSUMPTION]** | No hard "last admin device" refusal; the M-8 warning and the recovery link cover it (M-6 asked only for the self-guard) | Keep |
| A-4 **[ASSUMPTION]** | After a profile edit away from one person, a still-open session stays unbound until its next sign-in (§3.8) | Keeps the binding projection free of session reads |
| A-5 **[ASSUMPTION]** | `device_waiting` carries no count ("update" writes nothing) | The device list shows the count |
| A-6 **[ASSUMPTION]** | `DEVICE_ACCESS_SELF` stays `422` as the owner's M-6 ruling names it (review m-7 offered `409`) | Keep |
| A-7 **[ASSUMPTION]** | `kiosk_home` is retired; its content is the `takeaway` screen | Confirm on the kiosk at the manual check |

### 12.4 Deferred until needed

Sign-in alert with "Not me"; shuffled PIN pad on shared devices; PIN only while on shift (05 shifts + 01d presence); staff NFC card + PIN; "add me to this device" request; Delivery screen (with 02b delivery); customer pickup board; screens enforced on the hub; 6-digit PINs for some roles; the Capacitor app (9b).
