# 00 — Hub Platform & Access — Module Spec v1.6.1

**v1.6.1 (2026-11-02, developer): as-built patch from 01d v1.1** (`docs/specs/01d_Notifications_Requests_Spec_v1.1.md` §1 "Contract changes other modules read" and §4.5 "As built against C-00"; APPROVED by the developer 2026-11-02; patch-level so v1.7 stays free for 01e): `preRead(db, payload, ctx)` (AD-10); the early replay peek for `pinCheck` commands (AD-24); `authGen` captured before the session check (AD-25); the hooks ctx with `permission: null` (AD-26); the shared `/auth/pin` argon2 semaphore (AD-27); both `pinHooks` gain a trailing `cmd` (AD-94); the read-only view blocks `exec` / `pragma` / `transaction` (AD-21) and `rawDbOf` is exported from `engine-host/read-only-tx.ts` (AD-67); the `err` log key (AD-20, AD-28, AD-109); `startSweeper(deps, log)` (AD-29) and `startTickLoop(deps, log)` (AD-110); `due` on a read-only view (AD-111); `binding_route` on alert-mode sockets (AD-4); `4409` as the local constant `ALERT_REPLACED` (AD-30); receipt listener and builder guards, close `1011` (AD-31); `WsHub.sendToSessions` (AD-74); `/app/*` on route group `admin-device-public` and the app-release CLI through `tsx` (AD-34, AD-35); `/staff/` served with `indexMeta` `<meta>` tags (AD-T41-1). Each changed place carries a "Changed by 01d v1.1" marker. No error code, endpoint or merged migration change.

**v1.6 (2026-11-01).** Changes driven by 01d Notifications and requests v1.0 (`docs/specs/01d_Notifications_Requests_Spec_v1.0.md` §4.5 C-00, rows H-1–H-14; new M94 recording the package): §3.1 M12, M38, M47, M66 notes; §3.5 / §3.7 (`pinCheck`, `preRead`, `checkPin` hooks, `'checked-in-handler'`, `payload_hash` without the PIN); §4.2 (`defineCommand`, `registerCatchUp`, `ws` exports); §5.1 (`app_releases`, `staff_sessions_staff_activity`); §6.17; §6.21 (alert mode); §6.33 (count and split rule); new §6.36–§6.38 (tablet app update); §7.3; §8.1; §8.5. See 01d §4.5.

**v1.5 (2026-10-27).** Changes driven by 01b Staff & Roles v1.0 (v0.3, then hostile review 1, `docs/reviews/01b_spec_review_1.md`): §3.1 (M10, M29, M52, M57, M73, new M93), §3.6, §4.2, §5.1, §5.2, §6.5, §6.19, §6.20, §6.22, §6.23, §6.24a (new: JWT guard), §6.26, §6.27, §6.33 (note), §7.2, §7.10; §5.2 cloud migrations runner (01b review 2 N5). See 01b §4.3.

## §1. Header

| Field | Value |
|-------|-------|
| Module | 00 Hub Platform & Access |
| Version | **v1.6.1 — APPROVED** (developer, 2026-11-02): as-built patch from 01d v1.1 (the 00 rows of 01d v1.1 "Contract changes"; "Changed by 01d v1.1" markers); implemented by the 01d build; v1.6 kept as history. **v1.6 — APPROVED** (developer, 2026-11-01), together with 01d v1.0 (README R34 / R26): changes driven by 01d Notifications and requests v1.0 (M94, 01d §4.5 C-00 rows H-1–H-14; G4 hostile reviews runs 1–3 of 01d applied). **Supersedes v1.5**, which stays the implemented baseline until 01d's build lands; v1.5 kept as history. v1.5 — **APPROVED** by the owner (2026-10-27), together with 01b v1.0 and 01a v1.3: changes driven by 01b Staff & Roles v1.0 (M93, 01b §4.3; hostile reviews 1 and 2 of the 01b package applied). **Supersedes v1.4**, which stays the implemented baseline until 01b's build lands. v1.4 — **APPROVED** by the owner (2026-10-26, "apply what is good" on open questions Q11, Q12): phones use the light theme (M91); names in three responses (M92); §6.17 states what refreshes last-seen. v1.3 — **APPROVED** by the owner (2026-10-26, no hostile review requested): module 00 design hand-off (`docs/design/handoff/00/`): Urdu pages, hub admin home `/admin`, styled `/setup` after provisioning, setup address pick-list, three admin list queries, removal reason on the devices list, admin permissions in the sign-in response (M83–M90). v1.2.1 — editorial (2026-10-25): §4.2 names match the code (01a S25); no behaviour change. v1.2 — **APPROVED** (2026-10-24): UI kit on the 00 pages (M81, M82) over v1.1, implemented in plan tasks 67–71. v1.1 — **APPROVED** (2026-10-24): fixes from build review 1 (`docs/reviews/00_build_review_1.md`) over v1.0.1, which was **APPROVED** (2026-10-23) after Review 1 (`docs/reviews/00_review_1.md`) and Review 2 (`docs/reviews/00_review_2.md`) |
| Date | 2026-11-02 (v1.6.1); 2026-11-01 (v1.6); 2026-10-27 (v1.5); 2026-10-26 |
| Depends on | Foundation Spec v1.8 (APPROVED; v1.6 written against it, 01d C-F) |
| Inherits | **Shared Standards from Foundation v1.8 §6**, unchanged except where a decision in §3.1 names the section it overrides (D64 freeze rule) |
| Tier | T2 Production (foundation §1) |
| Already implemented | Plan task 1 (monorepo skeleton). Plan tasks 5b and 5c list what v0.6 and v1.0 change in tasks 1–5 |

### Changes in v1.6.1 (as-built patch from 01d v1.1, `docs/specs/01d_Notifications_Requests_Spec_v1.1.md` §1 and §4.5; developer, 2026-11-02)

| Row | Change | AD (01d v1.1) | Where |
|---|---|---|---|
| H-1, H-2 | Alert-mode sockets also receive `binding_route`; `4409` is the local constant `ALERT_REPLACED`, not in `WS_CLOSE`; a throwing `onReceipt` listener is logged and the socket kept; a throwing `alerts_open` or catch-up builder closes the socket `1011` | AD-4, AD-30, AD-31 | §6.21 |
| H-3 | `preRead(db, payload, ctx)`; early replay peek for `pinCheck` commands; `authGen` captured before the session check; hooks ctx with `permission: null`; shared `/auth/pin` argon2 semaphore; `pinHooks` gain a trailing `cmd: PosCommand`; BF-2 log `{ err, phase: 'onPrepareFailed' }` | AD-10, AD-24–AD-27, AD-94, AD-20 | §3.5 |
| H-3, H-4 | Read-only view blocks `exec` / `pragma` / `transaction`; `rawDbOf(view)` export (map key only); `WsHub.sendToSessions(sessionIds, frame)` | AD-21, AD-67, AD-74 | §4.2 |
| H-5 | `/app/*` on route group `admin-device-public`; CLI `tsx src/app-update/cli.ts` | AD-34, AD-35 | §3.9, §6.36–§6.38 |
| H-8 | Sweeper log key `err`, `startSweeper(deps, log)`; tick error `{ tick, err }`, `startTickLoop(deps, log)`; `due` on a read-only view | AD-28, AD-29, AD-109, AD-110, AD-111 | §7.3 |
| — | `/staff/` (route group `admin-page`) served with `indexMeta` `<meta>` tags: tenant and branch ids, branch name, hub clock | AD-T41-1 | §3.9 |

Additive or internal; no error code, endpoint, event or merged migration change.

### Changes in v1.6 (01d Notifications and requests v1.0, `docs/specs/01d_Notifications_Requests_Spec_v1.0.md` §4.5 C-00)

| Row | Change | Decision | Where | Test (01d) |
|---|---|---|---|---|
| H-1 | WS **alert mode**: `auth` without `session_token`; alert frames only, `receipt` in; separate socket list (never `deliver()`, audiences, catch-up); one alert-mode socket per device (`4409`); session sockets also accept `receipt` | M12, M94 | §6.21 | #26, #59 |
| H-2 | `WsServerMessage` adds `alerts_open`, `alert`, `alert_seen`, `alert_closed`; `WsClientMessage` adds `receipt`; `auth.session_token` optional | M94 | §6.21 | #26, #29 |
| H-3 | `'checked-in-handler'` marker for `HANDLER_CHECKED_COMMANDS`; `pinCheck`, `preRead`; `checkPin` `prepare` (read-only view) / `onMatch` / `onMismatch` / `onPrepareFailed` (one counting transaction for both PINs); `testHooks.betweenVerifyAndWriter` | M94 | §3.5, §3.7, §4.2 | #33, #44, #54, #60, #66 |
| H-4 | `ws.sendToDevices`, `ws.sendToStaff`, `ws.connectedSessions()` | M94 | §4.2 | #28, #61 |
| H-5 | Tablet app update, pilot minimum: §6.36 `GET /app/android/latest`, §6.37 `GET /app/android/<version_code>.apk`, §6.38 CLI `app-release add` / `mark-good`; §8.1 background service | M94 | §6.36–§6.38, §8.1 | #40, #65 |
| H-6 | Personal phones browser-only for alerts in the pilot (text only) | M38 | §3.1 | — |
| H-7 | `registerCatchUp.build(db, state, socketCtx)` | M94 | §4.2 | #43 |
| H-8 | Timers: hub tick, receipt flush; sweeper wrapped in try/catch | M66, M94 | §7.3 | #37, #38 |
| H-9 | `payload_hash` without the `pinCheck` field | M47 | §3.7, §3.1 | #56 |
| H-10 | PIN-bearing commands online-only; PINs never persisted on the device | M94 | §8.1, §8.5 | #56 |
| H-11 | Endpoint count 32 (+ §6.36, §6.37) and 4 CLIs; the split rule applies to the cloud part only (with README R-9); **decided at approval by the developer** | M94 | §6.33 | — |
| H-12 | 00-owned table `app_releases` created in 01d's migration `0006` | M94 | §5.1 | #40 |
| H-13 | Last seen refreshed by alert-mode pongs too | M94 | §6.17 | #26 |
| H-14 | Index `staff_sessions_staff_activity (staff_id, last_activity_at)` in 01d's `0006` | M94 | §5.1 | #57 |
| M94 | **01d Notifications and requests v1.0 changes this spec as listed in 01d §4.5 C-00** (H-1–H-14). Each changed section carries a "Changed by 01d v1.0" marker. 01d owns hub migration `0006_alerts.sql`, which also creates the 00-owned `app_releases` table and the `staff_sessions_staff_activity` index; this spec's merged migrations are not edited. | One package with 01d; later modules read 00 and find the current contract. | §3.1 | — |

Not in this bump: `point_id` on devices (with 01a points), `pager_bridge`, compact protocol, headless pairing (01e → a later 00 bump).

### Changes in v1.5 (01b Staff & Roles v1.0, `docs/specs/01b_Staff_Roles_Spec_v1.0.md` §4.3)

| Change | Decision | Where | Test (01b) |
|---|---|---|---|
| Cloud `staff.pin_hash` nullable (roll forward only); `pin_set_at`, `left_at`; `owner_users` password state (incl. `temp_password_expires_at`) and `staff_id` link; `roles` `default_key`, `archived_at`; `role_permissions.scope`; approver list table, `approver_role_id` dual-written (cloud `0005_staff_roles.sql`, owned by 01b) | M93 (01b B3, B5, B7, B10, B2, B17, B22) | §5.2 | 01b #6, #20, #62, #63, #75, #77, #79 |
| Hub `0005_directory_v2.sql`; directory read in 9 statements | M93 (01b B1, B2, B4, B10) | §5.1 | 01b #22 |
| Directory shape v2, additive (`approver_role_id` kept; `approver_role_ids`, `scope`, `lead_staff_id`, `floor_ids`, `responsibilities`; approver roles always sent; staff with no PIN not sent) | M93 (01b B3, B4, B10, B18) | §6.5, §4.2 | 01b #6, #21, #22, #24, #83 |
| `resolve` returns `scope`; new `StaffDirectory` lookups | M10, M93 (01b B1, B2, B4) | §3.6, §4.2 | 01b #12, #19, #31, #33 |
| `StaffDirectoryApplied` v2: `skipped.kind` adds `lead`, `responsibility`; unknown approver ids dropped, a grant left with none skipped | M52, M93 (01b B18) | §4.2 | 01b #23, #64, #84 |
| Roster adds `responsibilities`; session adds `scope` | M93 (01b B2, B4) | §6.19, §6.20 | 01b #19, #36 |
| Login: `must_change_password`, `lockout_notice`, expired temporary password refused, hash re-checked in the success transaction; refresh: owner row `FOR NO KEY UPDATE` first, a refresh token whose `credential_version` differs from the owner's refused, `lockout_notice`; JWT claim `cv` (the owner's `credential_version`); no `pwc` claim (01b review 2 N1, N2) | M73, M93 (01b B5) | §6.22, §6.23 | 01b #4, #41, #42, #74, #75, #81, #91, #98 |
| JWT guard reads the owner row: claim `cv` ≠ `credential_version` → `JWT_INVALID`; a failed read → `503 SERVICE_UNAVAILABLE`, never `401`; `PASSWORD_CHANGE_REQUIRED` on `/v1/admin/*` | M93 (01b B5) | §6.24a (new) | 01b #65, #73, #91, #107 |
| Cloud migrations runner refuses to start when the database holds a migration version this build has no file for | M93 (01b B22) | §5.2 | 01b #105 |
| `issue-registration-code`: only qualifying admins (`access-hub-admin` and `manage-devices`); duplicate names refused; tenant lock and directory bump; branch names unique | M57, M93 (01b B7, B11, B12, D-14) | §6.27 | 01b #86, #93, #94 |
| Default roles Owner, Manager, Cashier 15, Order taker 15 (owner, 01b Q12), Waiter, Cook, each with a `default_key`; owner staff row linked | M29, M93 (01b B6, B7, B17) | §6.26 | 01b #20, #77 |
| `POST /v1/auth/change-password` is 01b's route (not counted here); redaction and folder notes | M93 (01b B5) | §6.33, §7.2, §7.10 | 01b #44 |
| M93 | **01b Staff & Roles v1.0 changes this spec as listed in 01b §4.3** (rows 1–20). Each changed section carries a "Changed by 01b" marker. 01b owns the cloud migration `0005_staff_roles.sql` and the hub migration `0005_directory_v2.sql`; this spec's merged migrations are not edited. M30 (station sessions), M11, M50, M51 and M75 are unchanged; M57 is refined (§6.27). | One package for the owner to approve; later modules read 00 and find the current contract. | — |

No new route in this spec (00 stays at 30 endpoints, §6.33). New event schema version: `StaffDirectoryApplied` v2 (identity upcaster). Error codes added by 01b are 01b's (01b §9).

### Changes in v1.4 (open questions Q11, Q12 in `docs/design/open-questions/00-hub-platform.md`)

| Change | Decision | Where | Test |
|---|---|---|---|
| `/pair?t=` (phones) switches to the light theme in the page script; `/pair` is still served dark for screens | M91 | §8.2 | #151 |
| `GET /admin/login-roster` adds `role_names`; the approved `GET /pair/requests/:id` adds `station_name`; `POST /devices/pair` adds `owner_name` | M92 | §6.8, §6.13, §6.31 | #148–#150 |
| §6.17: last-seen is refreshed by every device-authenticated request and by each WebSocket pong (Q8, written during the v1.3 build) | — (clarification) | §6.17 | keepalive unit test |

Additive response fields only. No error code, event, payload, config field, migration or route changes. Q13 (address on `HOST_NOT_ALLOWED`, a foundation code) and Q14 (Urdu review) are not in this version.

### Changes in v1.3 (design hand-off `docs/design/handoff/00/`, open questions `docs/design/open-questions/00-hub-platform.md`)

| Change | Decision | Where | Test |
|---|---|---|---|
| Pages show Urdu, right to left, when the device language is Urdu; one `UR` table next to `EN` | M83 (amends M82) | §8.2 | #136 changed, #140 |
| `GET /setup` after provisioning: still `404`, now with the kit's "This hub is already set up" page (Q2) | M84 | §3.9, §6.33 | #141 |
| `/setup` offers this machine's own IPv4 addresses as a pick-list, plus a typed "Other address" (Q7) | M85 | §8.2 | #137 changed |
| Hub admin home and shell: new static page `GET /admin` (Q1) | M86 | §3.9, §6.33, §8.2 | #142 |
| `GET /admin/queries/devices` adds `revoked_reason`, `revoked_by_name`, `owner_name` (Q9) | M87 | §6.17 | #143 |
| New admin queries `lockouts` (Q3), `stations` (approve page station tiles), `staff` (Add a phone) | M88 | §6.18a–c | #144–#146 |
| `POST /admin/auth` and `/admin/auth/bootstrap` return the admin's `permissions` so pages hide what the admin can't do | M89 | §6.6, §6.29 | #147 |
| Query resources on the generic route (§6.2) don't count against the endpoint budget | M90 | §6.33 | — |
| M91 | **Phones use the light theme.** `/pair` is served with `data-theme="dark"` (M82, for kiosk and kitchen screens); with `?t=` the page script sets `data-theme="light"` before it renders, as the phone frames do. | Phones are read in daylight on the floor; the dark theme is for glare and distance on fixed screens. | — |
| M92 | **Responses carry the names the screens show.** `GET /admin/login-roster` staff rows add `role_names` (directory role names, for the line under each name tile); the approved `GET /pair/requests/:id` adds `station_name` (from the in-memory branch config, `null` for a cashier screen or an unknown station) so the screen can say "Opening the Tandoor kitchen screen…"; `POST /devices/pair` adds `owner_name` (`StaffDirectory`, `null` for tablets) so the phone can say "Only Bilal's name will be on it". | Without them the screens fall back to generic text and the tiles to bare names. No extra query: names come from memory. | — |

No error code, event, payload, config field or migration changes. No command changes. Q5 (waiter tablets) is blocked and not in this version; Q4, Q10 stay with 06 and 03b.

### Changes in v1.2 (UI kit, `docs/design/ui-brief.md`)

| Change | Decision | Where | Test |
|---|---|---|---|
| The pages need the bundled UI kit (CSS + fonts); the hub had no static-file route | M81 | §3.9, §6.33, §6.35, §12.2 | #135 |
| The 00 pages show raw keys and hardcoded English, swallow errors (setup, bootstrap), take a raw `staff_id`, show PINs in clear and name a phone through `window.prompt` | M82 | §8.2, §8.4 | #136–#139; the two `[00 §8.4]` page tests now expect the English text |
| M83 | **Urdu on the 00 pages (amends M82).** `strings.ts` holds `EN` and `UR` with the same keys; a key missing from `UR` falls back to `EN` (list kept in `docs/design/handoff/00/urdu-todo.md`). The server still sends `<html lang="en" dir="ltr">`; the page script picks the language once on load: `?lang=en\|ur` if present (kept in `localStorage` key `pos-lang`), else the stored value, else `ur` when `navigator.language` starts with `ur`, else `en`; it then sets `lang`, `dir` (`rtl` for Urdu) and renders every text through `t()`. Codes, PINs, addresses, links, times and counts stay LTR (`.pos-ltr`, mono classes); digits stay Latin. | D12 asks for translation keys and the design system requires Urdu RTL; the hub has no stored device language, and server-side negotiation would need per-request rendering of static pages. | — |
| M84 | **`GET /setup` after provisioning answers `404` with the kit page "This hub is already set up"** (`setup.already_*`), no form and no hub data. | Foundation §5.6 requires `/setup` to return 404 permanently; a bare 404 sends installers to support. The status stays 404, so nothing reachable changes. | — |
| M85 | **The setup page lists this machine's IPv4 addresses** (from `os.networkInterfaces()`: IPv4, not internal, not `169.254.0.0/16`; label = interface name, "Ethernet" first when the name starts with `en`/`eth`) as pick tiles, preselecting the first Ethernet one, plus "Other address" with the typed field. The list is rendered into the page by `GET /setup`; `POST /setup/provision` is unchanged (M58 still validates). | The two-network mistake (cable and Wi-Fi addresses differ) is the most likely setup error and is only caught by M58 after typing. | — |
| M86 | **Hub admin home `GET /admin`** (00-S20 and S16–S19, D01–D03): a static page like M79 (guards host, provisioned, guest network; no credentials in the page). The script reuses the `/admin/approve` sign-in (device token from IndexedDB `pos-device`, admin session in `sessionStorage`; bootstrap sessions allowed). Views by hash: home, `#devices`, `#add-phone`, `#sessions`, `#lockouts`. It calls only §6.7, §6.14–§6.18c. Lists refresh on open and after each action (no WebSocket). The side menu also links other modules' admin pages that exist (today `/admin/stock`). | Foundation §5.6 sends "all later admin access" through `/admin`, but no page exists: devices, sessions and lockouts have endpoints and no screen. | — |
| M87 | **The devices list shows why a device was removed:** §6.17 adds `revoked_reason` (from the device's latest `DeviceRevoked` payload `reason`), `revoked_by_name` (`revoked_by` through `StaffDirectory`) and `owner_name` (`owner_staff_id` through `StaffDirectory`). | A removed row without a reason or actor sends the manager to the audit log; the reason is already stored in the event. No migration: one extra read of `events` (index `events_stream`) only when `include_revoked=true`. | — |
| M88 | **Three admin list queries:** `lockouts` (§6.18a: staff, device and IP lockouts in force), `stations` (§6.18b: active stations with what they cook, for the approve page's station tiles and station names on lists), `staff` (§6.18c: active staff with role names and phone count, for "Add a phone"). All `sessionKind: 'admin'`, so bootstrap admin sessions work. | Clearing a lockout you can't see is useless (`ClearPinLockout` takes `device` and `ip`); the approve page loads without a device session, so `GET /queries/branch-config` is unavailable there; `GET /admin/login-roster` lists admins only, not the waiter whose phone is being added. | — |
| M89 | **Admin sign-in returns the admin's permissions:** §6.6 and §6.29 responses add `permissions: { 'manage-devices': boolean, 'manage-staff': boolean }` (effective, D19). Pages hide actions the admin lacks and keep `403 PERMISSION_DENIED` as the authority (permissions may change mid-session; the page then shows its read-only state). | `GET /queries/session` needs a device session, which a bootstrap admin and the admin page don't have; without this every button is shown and fails. | — |
| M90 | **Query resources served by the generic route (§6.2) are listed in §6.33 but not counted against the endpoint budget.** They add no route, guard or pipeline; each still declares its query count. | M88 adds three resources; counting them would force the cloud-access split promised in §6.33 for no structural reason. | — |

One route is added (`GET /ui/*`, a static route that §6.33 does not count, like the four page routes). No error code, event, payload, config field or migration changes.

### Changes in v1.1 (build review 1, `docs/reviews/00_build_review_1.md`)

| Build review item | Decision | Where | Test |
|---|---|---|---|
| `branch_name` is discarded at setup | M78 | §3.10, §6.4, §6.8, §6.31, M37, §12.4 | #132 |
| A QR scan cannot open `/admin/approve` (a navigation carries no `Authorization` / `X-Admin-Session`) | M79 | §3.9, §6.32, §8.1, §8.2 | #133 |
| `pairing_source` does not survive retention | M80 | §6.17 | #134 |
| §10 #53 still says the 10th failure is `429` (contradicts M73) | editorial | §10 #53 | #53 (title only) |
| §12.1 cites plan task 50 for the foundation table (it is task 51) | editorial | §12.1 | — |

No error code is added. One payload field becomes optional (`ApprovePairingRequest.request_id`); one config field is added (`provisioned.branch_name`). No endpoint, event or migration changes.

### Changes in v1.0.1 (patch)

| Change | Decision | Where | Test |
|---|---|---|---|
| MQ12 closed: hub-served pages show QR codes made with the same `qrcode@1.5.4`, rendered on the hub as SVG; lint allowlist extended | M77 | §6.4, §6.7, §6.30, §7.11, §8.2, §12.3 | #131 |

No rule, endpoint or schema changes; three responses gain an SVG field.

### Changes in v1.0 (Review 2, `docs/reviews/00_review_2.md`)

| Review 2 item | Decision | Where | Test |
|---|---|---|---|
| N1 — no way to regain admin access | M72 (hub CLI `issue-admin-bootstrap`; README requirement on 06) | §3.4, §4.2, §6.4, §6.29, §6.34, §7.11 | #127 |
| N2 — login while locked reveals the right password | M73 (amends M64) | §6.22 | #109 (rewritten) |
| A — `DeviceTokenRotated` live apply | M74 (amends M40); README requirement on 06 (re-apply directory after USB restore) | §3.1 M40 | #128 |
| B — query guard writes | M55 (f) | §3.1 M55 | #98 (existing) |
| C — malformed-hash row looks like a removal | M75 (amends M52) | §3.1 M52, §4.2 | #129 |
| D — pairing-request cap can be filled by one client | M76 (amends M44) | §5.1, §6.30 | #130 |

### Changes in v0.6 (Review 1, `docs/reviews/00_review_1.md`)

| Review # | Decision | Where |
|---|---|---|
| 1 — auth re-check inside the transaction | M39 | §3.7, §4.2, §10 #85–86 |
| 2 — restore brings back revoked devices / ended sessions | M40 | §3.4, §3.8, §5.1, §10 #87–88 |
| 3 — provisioning stuck after the 1 h window | M41 | §3.2, §6.5, §6.27, §6.28, §10 #89–90 |
| 4 — `/admin/auth` open to the LAN | M42, M44 | §3.5, §3.9, §6.6, §6.13, §6.29–§6.32, §10 #91–96 |
| 5 — admin session left in the paired browser | M43 | §8.2, §10 #94 |
| 6 — DNS rebinding | M45 | §3.9, §9, §10 #97 |
| 7 — idle-expired session keeps working | M46 | §3.4, §3.9, §10 #98 |
| 8 — replay ignores command type; body device id | M47 | §3.7, §5.1, §10 #99 |
| 9 — boot work grows with history | M48 | §3.8, §5.1, §7.8, §10 #100 |
| 10 — refresh reuse logs owner out | M49 | §6.23, §10 #54 |
| 11 — PIN reset keeps sessions | M50 | §3.4, §4.2, §10 #101 |
| 12 — directory version not checked | M51 | §4.2, §10 #102 |
| 13 — weak hash behaviour | M52 | §4.2, §6.4, §10 #19, #103 |
| 14 — two KDS tabs loop | M53 | §6.11, §6.21, §8.4, §10 #104 |
| 15 — BYOD threat model | M54 | §3.1, README R16 |
| 16 — unrecorded overrides; reused codes | M55 | §3.1, §9 |
| 17 — CLI database path | M56 | §6.26, §6.27, §7.10 |
| 18 — `is_admin_role`; owner cannot see new branch | M57 | §5.2, §6.27, §10 #57 |
| 19 — two owners of guest CIDRs / host | M58 | §3.10, §6.4, §10 #105 |
| 20–21 — missing and impossible tests | — (test changes) | §10 |
| 22 — polling defeats idle logout | M59 | §3.4, §4.2, §6.2, §10 #13 |
| 23 — rotation not audited | M60 | §4.2, §6.8, §10 #30 |
| 24 — admin access checked only at login | M61 | §3.9, §10 #106 |
| 25 — counter after lock expiry | M62 | §3.5, §10 #107 |
| 26 — `/health` on the guest network | M63 | §6.3, §10 #108 |
| 27 — owner login enumeration / lock | M64 | §6.22, §10 #109 |
| 28 — admin replay match | M47 | §3.7 |
| 29 — unused `client_ip` | M65 | §5.1 |
| 30 — retention at midnight | M66 | §7.3, §10 #121 |
| 31 — GCM "stream" wording; leftover plaintext | M67 | §7.9, §3.8, §10 #111 |
| 32 — malformed tables | editorial (IDs kept; tables fixed) | §1, §3.1 |
| 33 — library notes | M68 | §7.11 |
| 34 — §9 codes added twice | editorial | §11 |
| 35 — `idempotency_keys` built for 01 | M69 | §5.2 |
| 36 — command `tenant_id` unchecked | M70 | §3.7, §10 #110 |
| 37 — `setup_attempt_id` in the event | M71 | §4.2 |
| 38 — takeover and an open cash shift | README requirement on 05 | README |
| Owner choice for #4/#5 — screens pair by QR + approve | M44 | §6.30–§6.32 |

Decision IDs are cited by the README and the plan, so v0.6 keeps every existing ID; Review 1's request to renumber is met by fixing the table order (M37 before M38) and removing the stray row.

### Earlier changes

| Version | Change | Decision |
|---|---|---|
| v0.5 | iOS Safari (not standalone): pair page does not pair; add to Home Screen, pair from the home-screen app | client contract (§8.2) |
| v0.4 | iOS "Add to Home Screen" hint after pairing (replaced by v0.5) | client contract |
| v0.3 | Device type `phone` (BYOD), owner-only login, revoked when the owner leaves | M38 (README R14) |
| v0.3 | Takeover default confirmed: any staff member with a correct PIN | README R11 |
| v0.3 | No service worker / secure-context APIs in hub-served browsers | README R15 |
| v0.2 | Owner review of v0.1; batches 2–3; §7–§12 | M19–M37 |
| v0.1 | First draft | M1–M18 |

### Stories covered

| Story | ACs covered here | ACs covered elsewhere |
|---|---|---|
| E0 Staff — PIN login on shared devices | 2, 3 (actor attribution mechanism), 4, 5, 6; edge cases (shared device, guest WiFi) | 1 dropped (M27); 7 PIN set/reset → 01 |
| E0 Hardware — printers, drawer, multiple terminals | 3 (pairing, manage-devices, audit) | 1, 2, 4, 5 → 03b; 6 kiosk shell → 03b/client |
| E6 Custom roles and permissions | 3, 4 (effective permission on the hub, D19); 6 (default role set via seed, M29) | 1, 2, 5, 7 → 01 |
| E5 Hub restart after power loss | 2, 3, 4 (boot orchestration, migrations, projection catch-up), 9, 10 (00's share) | 4 engine replay, 5 missed fires → 03a; 7 print queue → 03b |
| E5 Device resilience during hub restart | 3 (hub side: replay without session, M19) | 1, 2, 4 device queue → 02 |
| E0 Backups and restore | restore safety of access state (M40) | backups, restore flow → 06 |

### In scope
- **Hub platform:** SQLite connection, migrations runner (§6.8) with encrypted pre-migration backup (M21), event store and `appendEvents` (§4.1), `processed_commands` (D32, M47), projection registry with forward catch-up (M17, M48), commit-then-swap writer with in-transaction auth re-check (D45, M39), command and query registries with generic routes (§6.3), boot orchestrator (§5.8 steps 0, 1, 1a, 3a, 4, 4a, 4b, 7, 8), heartbeat (D41), clock and boot clock guard (D48), error handler (§6.2), route guards incl. Host guard (M45), encrypted-file helper, retention.
- **Hub access:** `/setup` provisioning (new-branch codes) and first-admin bootstrap (M42), hub confirmation (M41), device pairing by token (tablets, phones) and by screen request (kiosk, KDS; M44), revocation, staff / admin / station sessions (§5.7, D28, M30), PIN lockouts, takeover, force logout, idle expiry (M46), staff directory cache and effective permissions (D19), restore reconciliation of access state (M40).
- **Hub WS transport:** auth message, keepalive, ordered push with `as_of_seq` filter, catch-up and audience framework (§5.4, §6.5).
- **Cloud access:** migrations runner, error handler, tenant-scope guard (D54) with three credential types, owner login/refresh/logout (JWT), registration-code exchange and hub confirmation, CLI `seed-tenant` and `issue-registration-code` with a `SystemContext` (M56), canonical staff/role tables and the permission catalogue.

### Out of scope
- Cloud staff and role admin routes and UI, PIN set/reset, staff-to-branch assignment → **01** (M27). Cloud `idempotency_keys` store → **01** (M69).
- Engine host: reducer registration, snapshots, replay, fire-scheduler tick, missed fires (§5.8 steps 2, 3, 6) → **03a** (M28).
- Print queue resume (step 5) → 03b. Station-scoped commands (`StartItem`, `DoneItem`) → 03b.
- Replace-hub codes and restore flow (§5.10), sync agent, `hub_push_queue`, cloud-offset `ClockAlarm`, nightly backup, quiet-hour computation (D63) → 06.
- Device-side command queue policy → 02 (M19). Cash shift handling on takeover → 05 (README).
- Business commands. Customer-facing routes (P2, D20).

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| `events` table shape, indexes and immutability triggers; `sync_cursor` | §4.1 |
| `processed_commands` (extended by M19, M47) | §4.1, D32 |
| `PosEventSchema`, `PosCommandSchema` envelopes; ULID IDs; `schema_version` + upcasters | §4.1, D46 |
| Durability: `BEGIN IMMEDIATE`, WAL, `synchronous=FULL`; ack only after COMMIT | §4.1, D24 |
| Two-step idempotency check (fast path, then authoritative re-check in the transaction) | §4.1, D32 |
| Commit-then-swap: in-memory state changes only after COMMIT | D45 |
| Fixed command processing order; one command = one transaction; commands over HTTP only | §6.3 |
| `seq` = `MAX(seq) + 1` per branch, gap-free | §4.1, §5.9 step 7 |
| Device token 256-bit, stored as SHA-256; pairing token 256-bit, single-use, 10-min TTL | §5.6, D53 |
| PIN auth on hub, no internet; lockout 5 per staff / 10 per device in 5 min, 15 min; per-role idle TTL | §5.7, D28 |
| Hub never creates or modifies a PIN hash | D40, §3.1 |
| `/setup` only while unprovisioned, registration code only, 404 forever after | §5.6, D38 |
| `branchNow` from boot wall clock + monotonic; never earlier than the log | §4.7, D48 |
| Heartbeat every 60 s into `hub_heartbeat`; `HubStarted` audit event | §5.8, D41 |
| Envelope, error catalogue, status map, naming, test and migration rules | §6 |
| Cloud tenant scoping: default-on guard, repository base class, route-inventory and cross-tenant tests | §3.4, D54 |

---

## §3. Domain rules

### 3.1 Module decisions

Each decision states the failure it prevents (YAGNI test) and any foundation section it overrides. Where a later decision changes an earlier one, the earlier row says so.

| # | Decision | Prevents / reason | Overrides |
|---|---|---|---|
| M1 | **Cloud access minimum lives here:** cloud migrations runner, error handler, tenant guard (D54), owner login/refresh/logout, registration-code exchange and hub confirmation. | Provisioning (D38) needs the cloud and 01 needs owner auth; without these, 00 could not be built or tested alone. | — |
| M2 | **Tenants and registration codes are created by a cloud CLI in P1** (§6.26, §6.27), not an HTTP route. | One tenant, three branches, installed by the developer. Revisit with replace-hub UI (06) or P3 onboarding. | — |
| M3 | **The initial staff directory arrives in the provisioning response**; later updates through `applyStaffDirectory()` (called by 06). | Without it nobody could open admin to pair the first device until sync (06) exists. | — |
| M4 | **Sessions are a mutable table plus events** (`SessionStarted`, `SessionEnded`). | D51 releases table locks when a session ends; the tick is a pure function of events (D44), so a session end must be an event. | — |
| M5 | **Session activity is tracked in memory and flushed every 15 s** by the sweeper. *Which requests count: M59.* | §6.3 forbids writes in queries. Cost: after a crash a session may expire up to 15 s early. | — |
| M6 | **One active device-bound session per device** (staff or station), enforced by a partial unique index. The same staff member logging in again replaces their own session (`'replaced'`). Another staff member: M20. Admin sessions do not occupy the device slot. | E0 edge case "previous session must be closed or timed out"; replace-by-same-staff covers a lost login response. | — |
| M7 | **Admin session = session with `kind = 'admin'`**, requires `access-hub-admin`. *Changed by M42:* it is opened on a paired device and bound to it; only the one-time bootstrap session has no device and uses `device_id = 'hub-admin'` in events. System events use `device_id = 'hub'`. | Roles are custom (E6), so "manager" (D38) must be a permission. | — |
| M8 | **PIN hash format is argon2id in PHC form only**, minimum `m=19456, t=2, p=1`; bcrypt not accepted. *How a weaker hash is handled: M52.* Argon2 slows online guessing only; it does not protect a copied database (M21). | We control every setting device (D40). | §5.7 "argon2id (preferred) or bcrypt" → argon2id only |
| M9 | **Session tokens are stored as SHA-256 hashes.** | A copied database would otherwise contain live session tokens. | §5.7 (made specific) |
| M10 | **Effective permission (D19)**: `denied` if the owner set a denial; else the most permissive grant across roles, `allowed` > `requires_approval` > `not_granted`; approver roles = union. Commands accept `requires_approval` only when they declare `approvable: true` (04). *v1.5 (01b B2, B10):* the result also carries the winning `scope`, and approvers are read from the approver list (§3.6). | Implements E6 AC3–4 once. | — |
| M11 | **Idle TTL for a multi-role staff member** = max `session_idle_ttl_ms` across roles. | D19 "most permissive" applied to TTL. | — |
| M12 | **WS authenticates with the first client message** `{ type: 'auth', device_token, session_token }` within 5 s, else close `4401`. Never headers, never the query string. | Browsers and the Capacitor WebView cannot set WebSocket headers; query-string tokens land in logs. | §5.4 and §6.3 `/ws` row (header and query credentials) |
| M13 | **Provisioning finishes with a process restart** (exit 0; systemd `Restart=always`). | Avoids a second "become provisioned while running" start path. | — |
| M14 | **Credential exchanges are retry-safe by rotation, not by stored response** (`/hubs/register` with `Idempotency-Key: <setup_attempt_id>`; `/devices/pair` with `pair_request_id`). A repeat issues a **new** secret and revokes the previous one. | A lost response would leave a consumed code and no secret; a stored response would keep the plaintext secret in the database. | §6.4 stored-response idempotency, for `/v1/hubs/register` only |
| M15 | **The tenant guard accepts a third credential type**, the registration code, on `/v1/hubs/register` only. | Keeps the unscoped allowlist unchanged and the route-inventory test meaningful. | §3.4 item 1 (credential list) |
| M16 | **Tenant-level cloud tables** (`tenants`, `owner_users`, `owner_refresh_tokens`, `staff`, `roles`, `role_permissions`, `staff_roles`, `staff_permission_denials`) carry `tenant_id` only, through `TenantLevelRepository`. Branch-level tables keep both columns. | Staff work at several branches and roles are tenant-wide (E6). | §6.8 "every tenant table has `tenant_id` and `branch_id`" and §3.4 item 2, for these tables only |
| M17 | **Projection checkpoints table**, updated in the same transaction as projection rows. *How it advances and how a stale projection catches up: M48.* | §5.8 step 4 "max(seq) per projection table" is unreliable for projections that delete rows. | §5.8 step 4 (mechanism) |
| M18 | **Staff directory held in memory**, loaded at boot and swapped after the commit that applies a new one (D45 pattern). | Zero SQL per permission check. | — |
| M19 | **Replay without a session.** On `POST /commands/:name` the idempotency fast path runs with the device token alone: a stored response for this `command_id`, from this device, with the same command type and payload (M47) is returned with `Idempotent-Replay: true` and no new effects. Otherwise the session rules apply. **Open item for 02:** queued commands never processed whose session has ended. | A tablet whose session idled out during a hub restart would otherwise never learn its order was committed. | §4.1 `processed_commands` shape; §5.7 "mutating requests carry `X-Session-Token`" (replay only) |
| M20 | **Takeover.** Another staff member with a correct PIN on a device with an active staff session gets `409 DEVICE_SESSION_ACTIVE { …, can_take_over: true }`; retry with `takeover: true` ends the holder's session `'taken_over'` (`ended_by` = new staff); D51 releases their locks. No permission needed (README R11). Not on phones (M38). | A forgotten logout would block a shared tablet mid-service. | — |
| M21 | **A copied hub database exposes PINs** (≤ 10⁶ values per PIN). No backup holds the database in plaintext. 00 encrypts its pre-migration backups (AES-256-GCM, §7.9) with `backup_encryption_key`, kept only in the hub config file. **Requirement on 06:** nightly backups encrypted with the same key, never on the USB drive; solve key availability for restore on a replacement hub. | A lost `POSBACKUP` drive would leak every PIN of the branch. | §5.8 note "PINs are already argon2id hashes" (no longer a protection claim); §6.8 pre-migration backup (now encrypted) |
| M22 | **CLI reissue for an unconfirmed branch.** `issue-registration-code --branch-id <id>` issues a new `new_branch` code for a branch whose `hub_confirmed_at IS NULL` (M41) and expires its unconsumed codes. | A failed setup would otherwise need a second branch row. | — |
| M23 | **Argon2 verify concurrency cap.** *Changed by M42:* two separate semaphores, `/auth/pin` (default 2, `auth.argon2_concurrency`) and admin logins (default 1, `auth.admin_argon2_concurrency`). When full, wait ≤ 2 s, then `503 SERVICE_UNAVAILABLE { retry_after_ms: 1000 }`. | A login burst would starve the thread pool; admin guessing must not block tablet logins. | §6.2 note "503 cloud only" (hub returns it here and for setup, §9) |
| M24 | **No WS frame before auth**; `catch_up` carries the full role-scoped open state as of `as_of_seq`; client `last_seq` not needed. *Publish filter: §6.21.* | An unauthenticated socket learns nothing; no "events since N" gap path. | §5.4 ("events seq > N"; `last_seq` query) |
| M25 | **D54 tests cover tenant-level routes** (route inventory, cross-tenant test, both repositories throw without a `TenantContext`). | M16 adds a second repository class. | — |
| M26 | **Library versions pinned** (§7.11), checked against the npm registry on 2026-10-23. Vitest stays on 4.1.12 (foundation §6.7). | Unpinned majors drift between dev, CI and the hub. | — |
| M27 | **01 owns cloud staff/role admin**, PIN set/reset, staff-to-branch assignment. Duplicate PINs are allowed (login is staff + PIN). | Salted hashes make duplicate detection impossible on the cloud. | E0 PIN AC1 (story) |
| M28 | **03a owns the engine host** (§5.8 steps 2, 3, 6); 00 provides the hooks. 03a is built before or alongside 02. | — | — |
| M29 | **`seed-tenant` seeds Owner, Manager, Cashier, Order taker** (§6.26). TTLs to confirm with the owner. No Kitchen staff role (M30). *Overridden in v1.5 by 01b B17:* the defaults are Owner, Manager, Cashier, Order taker, Waiter and Cook; Order taker and Waiter are different jobs (01b D-12; a person doing both holds both roles); Waiter and Cook are team-membership roles with no permissions, and cooks keep working through station sessions (M30 unchanged). | — | — |
| M30 | **Station sessions** (`kind 'station'`, `device_type 'kds'` only): device bound to one `station_id`; no PIN, no idle timeout; events carry `actor_id = null`; only `stationScoped` commands; WS accepts them. | Cooks will not log in with a PIN; a shared kitchen identity would fake attribution. | §4.2 "actor_id null when source = 'inferred'" (also null for station taps); §5.7 "session identifies the staff actor" |
| M31 | **The station binding is chosen by the approving manager.** *Changed by M44:* KDS screens pair through a pairing request; the manager picks the station when approving. Station existence is checked through `registerStationValidator` (01). Rebinding = revoke + re-pair. | The unpaired screen has no credentials to list stations. | — |
| M32 | **Admin login roster** lists only staff whose `access-hub-admin` resolves `allowed`. *Changed by M42:* it requires a paired device token or the bootstrap token. | Admins pick a name, not a ULID. | — |
| M33 | **Owner login protection:** opaque 256-bit refresh tokens, stored hashed, rotated on every refresh. *Reuse rule: M49. Lock and enumeration rule: M64.* | Owner login is internet-facing. | — |
| M34 | **Replay before permission.** The idempotency fast path runs before session and permission checks; a replay returns a response authorised when produced and has no effects. | Required by M19. | — |
| M35 | **CORS for the Capacitor origin** (`cors_origins`, default `["http://localhost"]`) on device routes only. | The WebView origin is not the hub. | — |
| M36 | **Deploy folder** `apps/hub/deploy/` for the systemd unit. | §6.9 has no place for OS install files. | §6.9 folder list |
| M37 | **00 contributes a `hub` catch-up part** `{ hub: { clock_alarm: { wall_ms, last_recorded_at } \| null, branch_name } }`. `branch_name` comes from the config (M78). | A KDS connecting after a `ClockAlarm` would never see the D48 banner. | — |
| M38 | **Device type `phone` (README R14).** Hub-served browser client; owned by one staff member (`owner_staff_id`, chosen when the pairing token is generated); only the owner may log in (`403 DEVICE_NOT_OWNED`, checked before any PIN work); takeover never applies; revoked automatically (`cause: 'owner_removed'`) when `applyStaffDirectory` removes the owner. | A personal phone left paired after a staff member quits; colleagues acting as each other from a device that leaves the building. | — |
| M39 | **Auth is re-checked inside the write transaction.** The hub keeps an in-memory `authGeneration` counter, bumped in the after-commit step of every transaction that writes `DeviceRevoked`, `DeviceTokenRotated`, `SessionEnded` or `StaffDirectoryApplied`. A guard records the generation it saw. Inside `writer.run`, right after the idempotency re-check, if the generation changed, the device row and the session row are re-read (2 PK lookups) and rejected with the guard's codes (`DEVICE_REVOKED`, `SESSION_EXPIRED`, …). The permission (§3.6) is resolved **inside** the transaction against the current directory, always. | A command that passed the guard 1 ms before a revoke, force logout, sweep or directory change would otherwise commit for a dead session, e.g. lock a table whose lock D51 can no longer release. better-sqlite3 runs commit and after-commit in one synchronous step, so no transaction can start between them. | §6.3 order: precondition checks now include the auth re-check |
| M40 | **Access state is reconciled forward from events.** A forward-only projection `access_reconcile` (no reset) consumes `DevicePaired`, `DeviceTokenRotated`, `DeviceRevoked`, `SessionStarted`, `SessionEnded` and applies idempotent updates: `DevicePaired` → mark its pairing token / pairing request consumed; `DeviceTokenRotated` → **during boot catch-up only, never live (M74)**: set the device's `token_hash` to the unusable value `'rotated:' ‖ event_id` (the device must re-pair); `DeviceRevoked` → set `revoked_at`; `SessionEnded` → set `ended_at`. Live writes go to the tables directly; the projection's live apply is then a no-op. At boot step 4 it replays every event with `seq > checkpoint` (M48). `SessionStarted` events replayed at boot whose session has no row and no `SessionEnded` get `SessionEnded { reason: 'hub_restored' }` after the replay. `last_activity_at` and `last_seen_at` stay working data. | After a restore from a USB backup plus the cloud tail (§5.10 b), a fired employee's revoked phone and every force-logged-out session would be valid again. | §5.10 step 5 (adds access reconciliation to the rebuild) |
| M41 | **The branch stays `pending_hub` until the hub confirms.** On the first boot after provisioning, the hub calls `POST /v1/hubs/confirm` (branch API key) in the background, retrying every 60 s until it succeeds, and then records `provisioned.confirmed_at` in its config. The cloud sets `hub_confirmed_at` and `status = 'active'`. M22 reissue is allowed while `hub_confirmed_at IS NULL`. | Lost response or internet down at setup, retried the next morning: the code is consumed and the branch was already `active`, so no code could ever be issued again. | — |
| M42 | **Admin access needs a paired device.** `/admin/auth` and `/admin/login-roster` require a device token of type `tablet`, `cashier_kiosk` or `phone` (the phone's owner only). The admin session is bound to that device; every admin request carries the device token and `X-Admin-Session`. **Bootstrap:** provisioning creates one single-use first-admin token (30 min TTL); the setup page shows it as a link/QR (`/admin/bootstrap#t=…`). It opens one admin session without a device after staff + PIN + `access-hub-admin`; the PIN failures on this path count per IP (`429 IP_LOCKED_OUT`). Admin logins use their own argon2 semaphore (M23). | Any phone on the staff WiFi (R14) could otherwise lock out every admin and guess admin PINs (~480/day per admin) while starving tablet logins. | §5.6 step 1 ("admin opens hub:3000/admin in a browser"; now on a paired device) |
| M43 | **The admin UI never leaves an admin session in a browser it pairs.** Before any same-tab navigation to `/pair` or `pair_url`, the admin UI calls `POST /admin/auth/logout` and clears `sessionStorage`. | A cook pressing Back on a freshly paired screen would hold a manager's admin session. | — |
| M44 | **Kiosk and KDS screens pair by request + approval.** The unpaired screen opens `/pair`, creates a pairing request (`POST /pair/requests`) and shows a QR (request id) and a 6-character display code; a manager on a paired admin device scans it and runs `ApprovePairingRequest` with the device type and, for KDS, the station; the screen polls `GET /pair/requests/:id` with its poll secret and receives its device token. The token flow (`GenerateDevicePairingToken`) is for camera devices only: `tablet` and `phone`. *Caps: M76.* | Under M42 an unpaired screen cannot open admin, and screens cannot scan a QR. | §5.6 setup flow steps 2–6 (pairing token endpoint `POST /admin/devices/pairing-token` and its response) |
| M45 | **Host guard.** Every route, including `/health` and `/ws`, rejects a `Host` header that is not `<advertised_host>:<http_port>`, `localhost:<http_port>` or `127.0.0.1:<http_port>` with `403 HOST_NOT_ALLOWED` (WS: close `4403`). In setup mode (no `advertised_host` yet) the host's own IPv4 addresses are accepted. | DNS rebinding from any web page opened on a staff phone or the kiosk would reach the hub same-origin from a staff IP. | — |
| M46 | **Idle expiry is enforced on every request, not only by the sweeper.** The session guard and the login transaction treat `branchNow − last_activity_at > idle_ttl_ms` as ended: the guard ends the session (`SessionEnded 'idle_timeout'`, own `writer.run`) and answers `401 SESSION_EXPIRED`; the login transaction ends it before checking the device slot. | Foundation §5.7 / E0 AC4: a tap 10 s after the TTL would otherwise succeed and revive the session, and the next staff member would get `409` for a timed-out session. | — |
| M47 | **Replay matches command type and payload.** `processed_commands` stores `command_type`, `payload_hash` (SHA-256 of the canonical JSON of `payload`) and `session_id`. A stored row with a different type or hash → `400 VALIDATION_FAILED`, never a replay. Device identity always comes from the token; a body `device_id` that differs → `400`. Admin replays match `session_id` (not `'hub-admin'`). | A client bug reusing a `command_id` for `VoidItem` would silently get the stored `SubmitOrder` answer; any device could read another's stored response by sending its id. | §4.1 `processed_commands` shape |
| M48 | **Boot cost is bounded.** 3a reads `recorded_at` of the max-`seq` row (served by `events_branch_seq`). Every committed transaction advances every registered projection's checkpoint to its last seq. A projection whose checkpoint is behind `MAX(seq)` replays from its checkpoint; `reset` + full replay happens only when it has no checkpoint row. Step 4b runs only when `staff_sessions` is empty while session events exist. A boot test on a 1 M-event fixture holds 00's steps inside §7.8. | At R6 volume (≈ 40k events/day), unindexed scans and full rebuilds would eat the 90 s budget within months. | §5.8 step 4 (mechanism) |
| M49 | **Refresh reuse grace.** The successor of a refresh token is `HMAC-SHA256(REFRESH_TOKEN_SECRET, old_token)`; presenting the same rotated token within 30 s of its rotation returns that same successor (and a new access JWT) without revoking anything; later reuse revokes all the user's refresh tokens. | Two tabs or a lost refresh response on mobile data would log the owner out everywhere. | — |
| M50 | **A changed `pin_hash` ends that staff member's sessions** (`SessionEnded { reason: 'credentials_changed' }`), staff and admin. | A leaked PIN, reset in the cloud, would keep the thief's session for up to 60 minutes. | — |
| M51 | **Directory versions only move forward.** `applyStaffDirectory` applies only when `directory_version > current`; equal or older → no-op, no event, logged. | A late or replayed push would bring back fired staff with their old PINs. | — |
| M52 | **Bad directory rows are skipped, never blocking.** A staff row with a weak or malformed `pin_hash` is skipped; *what happens to that person's existing row: M75*; a role assignment or approver naming an absent role, or a permission not in this hub's catalogue, skips only that reference. Every skip is logged and listed in `StaffDirectoryApplied.skipped`. The rest applies. *v1.5 (01b B18):* a lead or a responsibility naming a staff member absent from the directory is also skipped (kinds `lead`, `responsibility`); an approver id naming an absent role is dropped from that grant's list, and a `requires_approval` grant left with no approver is skipped (kind `approver`). Supersedes the "reject" wording of M8 and v0.5 Review Focus 4. | One bad row from 01 would otherwise block every later update, including the removal of a fired employee. | — |
| M53 | **Station replaced = stop.** When a station session is replaced, its socket receives `SessionEnded { reason: 'replaced' }` and closes `4401` with close reason text `replaced`; the client stops and shows "Open in another window" instead of calling `/auth/station` again. | Two tabs on one KDS would kick each other off forever. | — |
| M54 | **LAN plaintext risk accepted for P1** with owner sign-off (README R16). Installation checklist: personal phones join a **separate SSID with client isolation** that can reach only the hub port; restaurant devices stay on the staff SSID. LAN TLS revisited at P3. | R14 put personal phones on the network that carries PINs and bearer tokens in plaintext (D28); isolation removes phone-to-phone sniffing on the same AP. | — |
| M55 | **Overrides recorded from Review 1 #16:** (a) the global credential indexes (`owner_users_email`, `owner_refresh_tokens_hash`, `branch_api_keys_hash`, `branches_branch_id`, primary key `registration_codes.code_hash`) do not lead with `tenant_id`, because they serve lookups before a tenant is known; (b) `db/credential-lookup.ts` is a bounded query path outside the repository layer, importable only by `plugins/tenant-scope.ts` and `plugins/owner-credentials.ts` (lint + test) — the RLS revisit trigger in foundation §8 does not fire for these read-by-secret lookups, and any other importer would; (c) `GET /ws` auth (§6.3) per M12; (d) route groups added: `POST /auth/station`, `POST /admin/auth`, `POST /admin/auth/logout`, `POST /admin/auth/bootstrap`, `GET /admin/login-roster`, `POST /pair/requests`, `GET /pair/requests/:id`; (e) new codes `IP_LOCKED_OUT` and `STATION_LOGOUT_NOT_ALLOWED` replace the reuse of `DEVICE_LOCKED_OUT` and `DEVICE_TYPE_NOT_ALLOWED`; (f) **query guard write (Review 2 note B):** on `GET /queries/*` and `GET /admin/queries/*`, the session guard may end an idle-expired session (`SessionEnded 'idle_timeout'`) in its own `writer.run` before answering `401` (M46). The query itself still never writes. | D64 requires every override to be named. | §6.8 index rule; §8 RLS row (scope); §6.3 route groups, `/ws` row and "queries: no writes" (guard only, f); §5.6 (via M44) |
| M56 | **CLIs live in `apps/cloud/src/cli/`** and reach the database through `SystemContext`, a class constructible only there (lint allowlist + a test that fails if any other folder imports it). | `seed-tenant` must create a tenant before any `TenantContext` can exist; the alternative is weakening the D54 lint rule. | §6.9 folder list (adds `apps/cloud/src/cli/`) |
| M57 | **No `is_admin_role`.** A new branch gets every staff member whose roles grant `access-hub-admin`; `issue-registration-code` adds the branch to every tenant owner's `allowed_branch_ids` in the same transaction. The "at least one admin role" guard (E6 AC7) is 01's, on the permission. *v1.5 (01b §4.3 row 19, D-14):* a new branch gets only **qualifying admins** (01b B7): active staff with a PIN whose effective `access-hub-admin` **and** `manage-devices` are both `allowed` (stock counters with `access-hub-admin` alone are not assigned); if two of them share a display name (case-insensitive, trimmed, 01b B12) the CLI refuses and lists the names; it takes the tenant row lock first and bumps `directory_version` (01b B11). | A flag would contradict M7; managers with `access-hub-admin` could not pair a new branch; the owner's JWT could not see it. | — |
| M58 | **`/setup` owns `guest_network_cidrs` and `advertised_host`.** At least one CIDR is required; `advertised_host` must be one of the host's own IPv4 addresses. The installer does not edit them in the config file. | Two writers would let a blank setup form silently disable the guest guard. | — |
| M59 | **What counts as activity:** every command, `/auth/*` login, and queries that declare `counts_as_activity: true` (default `false`). WS pongs and acks never count. **Note for 02:** a polled query must not opt in. | A 10-second table-map poll would keep order-taker sessions alive forever. | — |
| M60 | **`DeviceTokenRotated { device_id, pair_request_id }`** is appended when `/devices/pair` rotates a token. | A device credential change with no event breaks §4.1 and the E0 pairing audit; M40 needs it. | — |
| M61 | **The admin guard resolves `access-hub-admin` on every request** (in memory, M18); not allowed → `403 PERMISSION_DENIED`. | A manager who loses the permission would keep reading device and session lists until idle. | — |
| M62 | **The staff and device/IP counters reset to 0 when a lock expires.** | Without it one wrong PIN after expiry locks a real user again at once. | — |
| M63 | **`/health` returns `{ status }` only to guest-network clients**; the full body to others. | Customers' phones would learn `hub_version` and `branch_id`. | — |
| M64 | **Owner login:** *the locked-account rule is replaced by M73;* a per-IP limit (30 failures per 15 min, in memory — the cloud is one instance, D57) answers `429 IP_LOCKED_OUT`; counters change with atomic `UPDATE … SET failed_login_count = failed_login_count + 1 … RETURNING`. | Ten tries would reveal which emails exist; concurrent failures could lose counts. | — |
| M65 | **`staff_sessions.client_ip` dropped**; IP lockouts read the request IP. | Stored and never read. | — |
| M66 | **Retention runs in the maintenance hour, in batches.** `maintenance_hour` (local time of the hub OS, default 4) can be set by 06 from the D63 quiet hour through `setMaintenanceHour(h)`; deletes run in batches of 500 rows, one `writer.run` per batch. | A big `DELETE` at midnight during a late rush would block commands. | — |
| M67 | **Encrypted files are written to a temp file, verified, then renamed**; a leftover plaintext pre-migration copy in `data_dir` is deleted at boot step 1. | GCM cannot authenticate before the last block; a crash between copy and encrypt would leave PINs on disk. | — |
| M68 | **Library notes corrected:** `fastify-type-provider-zod@7.0.0` declares peer `zod >=4.1.5` (registry, 2026-10-23); foundation §6 says ≥ 4.2; the pinned `zod@4.6.7` satisfies both. ESLint pinned (`eslint@10.13.0`, `typescript-eslint@8.72.0`, flat config `eslint.config.js`) because the D54 and M55/M56 rules depend on it. | — | — |
| M69 | **`idempotency_keys` moves to 01** (no 00 route uses it); `owner_refresh_tokens` rows expired more than 7 days are deleted on each login of that user. | Over-build; unbounded growth of refresh rows. | — |
| M70 | **Command `tenant_id` is checked** like `branch_id` (`403 BRANCH_MISMATCH`). | The contract would otherwise accept any tenant silently. | — |
| M71 | **`setup_attempt_id` is not in the `HubProvisioned` payload.** | The id plus a paper code would allow a re-exchange that revokes the live key. | — |
| M72 | **Admin recovery by hub CLI.** `pnpm --filter hub issue-admin-bootstrap`, run as the hub service user on the hub machine (shell or physical access is the authority), opens the hub database and, in one `writer.run`: sets `expires_at = now` on every live bootstrap token, creates a new single-use token (30 min TTL), appends `AdminBootstrapTokenIssued { issued_by: 'cli' }` (`actor_id` null, `device_id 'hub'`). It prints `first_admin_url` and a terminal QR code (`qrcode@1.5.4`, CLI only). It works whether or not the hub process is running (SQLite serialises the writers; the event has no engine or WS effect). `/setup/provision` uses the same function with `issued_by: 'setup'`. **Requirement on 06:** the replace-hub restore flow issues one automatically after restore. | Without it the one-time bootstrap token is the only device-less admin entry: a late installer, a lost bootstrap response, losing every admin device, or a cloud-only restore would lock the hub out permanently, and the only recovery (re-register as a new branch) loses unsynced events. | — |
| M73 | **A locked owner account never verifies the password** (replaces M64's locked-account rule; Review 2 N2). While `login_locked_until > now`: run the dummy hash (equal timing), answer `401 LOGIN_INVALID` whatever the password, and do not change the account counter. The per-IP limiter still counts the attempt as a failure. The owner is told about the lock out of band (requirement on 01/07; *v1.5: met by 01b's `lockout_notice` on the next successful login or rotating refresh, §6.22, §6.23*). `429 LOGIN_LOCKED_OUT` is no longer returned by login. | Under M64 a locked account still answered differently for the right password, so distributed guessing could continue through the lock. | — |
| M74 | **`DeviceTokenRotated` is applied by `access_reconcile` only during boot catch-up** (mode `'catchup'`), never on the live path, where the new hash is written directly by `/devices/pair`. | A live apply would overwrite the fresh hash and lock out the device that just re-paired. | — |
| M75 | **A skipped staff row keeps its previous row.** If a staff row is skipped for a weak or malformed `pin_hash` (M52) and the hub already has a row for that staff member, the previous row (with its old hash, roles and denials as last applied) stays, and the person is **not** treated as removed: no `staff_removed` session end, no `owner_removed` phone revoke. A staff member with no previous row is simply absent. A real PIN reset (valid new hash) still ends sessions (M50). | One bad row from 01 would otherwise force a re-pair of that person's phone and end their sessions. | — |
| M77 | **QR codes on hub-served pages use `qrcode@1.5.4`** (closes MQ12), the library M72 already pins for the CLI. QR codes are rendered **on the hub** as SVG by one helper, `apps/hub/src/lib/qr.ts` → `qrSvg(text: string): string` (synchronous: `QRCode.create(text, { errorCorrectionLevel: 'M' })`, then an SVG `<path>` built from `modules`, 4-module quiet zone). Responses carry the SVG next to the URL: `first_admin_qr_svg` (§6.4), `pair_qr_svg` (§6.7), `approve_qr_svg` (§6.30); pages insert it as-is. No QR library is served to browsers. Lint: `qrcode` is importable only by `lib/qr.ts` and the CLI entry (`setup/issue-admin-bootstrap.ts`). | Screens cannot be paired by scanning (M44) and the first-admin link cannot be opened from a phone without a QR; rendering on the hub keeps the hub-served pages free of a bundler and of a second QR dependency, and keeps `handle` synchronous (D32 stored responses). | — |
| M76 | **Pairing-request caps: 2 pending per requester IP, 10 pending in total.** Over the per-IP cap → `429 IP_LOCKED_OUT { retry_after_ms }` (time until that IP's oldest pending request expires); over the global cap → `503 SERVICE_UNAVAILABLE { retry_after_ms: 60000 }`. `pair_requests` stores `requester_ip`. | One client on the staff WiFi could otherwise keep the 10 slots full and block kiosk/KDS pairing. | — |
| M78 | **`branch_name` is kept in the hub config.** `/setup/provision` writes the register response's `branch_name` to `provisioned.branch_name` (§3.10); §6.8, §6.31 and the M37 catch-up part read it from there. It is not added to `HubProvisioned` (payload frozen at v1). It shows the name at setup time; a cloud rename reaching the hub is deferred (§12.4). | §6.8, §6.31 and M37 return `branch_name`, but neither the config (§3.10) nor `HubProvisioned` (M71) stores it, so the hub could only send `''`. | — |
| M79 | **Admin pages load without credentials; approval works without a scan.** `GET /admin/bootstrap` and `GET /admin/approve` are static pages: guards host, provisioned and guest network only; they embed no token (`/admin/approve` embeds `tenant_id` and `branch_id` only). The page script reads the device token from IndexedDB and the admin session from `sessionStorage`, and logs in an admin in the same tab when there is none (§8.2). `ApprovePairingRequest.request_id` is optional: without it the hub approves the one pending request whose `display_code` matches; none or more than one → `404 PAIRING_REQUEST_NOT_FOUND`. | A camera scan opens `approve_url` as a plain navigation in a new tab: no `Authorization`, no `X-Admin-Session`, no `sessionStorage`, so the v1.0 page (group `admin`) always answered `401`. Devices that cannot scan or whose scan opens another browser (kiosk, Capacitor tablet, iOS home-screen app, R15) had no way to approve at all. | §3.9 (route groups for the two pages); M55 (d) list |
| M80 | **`pairing_source` is derived from `device_type`:** `tablet`, `phone` → `'token'`; `cashier_kiosk`, `kds` → `'request'` (M44 makes the source a function of the type). No column. | The v1.0 derivation from `pairing_tokens` turns every token-paired device into `'request'` once retention deletes its token (7 days after expiry). | — |
| M81 | **The hub serves the UI kit at `GET /ui/*` (route group `static`: guards host and guest network only, no provisioned check, no credentials).** Source: `packages/ui-kit/`, a new folder with CSS, fonts and their licences only (no `package.json`, not a workspace package; the hub resolves it relative to its own source, which holds in the `/opt/pos-hub` checkout). Only `.css` and `.woff2` files are served; the file list is read once at registration, so a path that is not in it (`..`, `README.md`, `tokens.json`, licence files) is `404 ROUTE_NOT_FOUND`. Headers: `Content-Type` `text/css; charset=utf-8` or `font/woff2`; `Cache-Control: public, max-age=31536000, immutable`. Pages link the two stylesheets with `?v=<first 12 hex of sha256(tokens.css ‖ bundle.css)>` so a hub update reaches cached browsers; the query is ignored by the route. Registered on the setup-mode server too, because `/setup` uses it before provisioning. No new dependency (`node:fs`, no `@fastify/static`). Not counted in §6.33, like the page routes. | The pages run on the LAN with no internet (README R15), so fonts and CSS must come from the hub; kiosks and phones reload often, so long caching keeps the hub idle. A whitelist read at start cannot be walked out of. | §3.9 (new group row), §6.33 note |
| M82 | **The 00 pages use the UI kit and one English string table.** Each page links `/ui/tokens.css` and `/ui/components/bundle.css`, sets `<html lang="en" dir="ltr" data-theme>` (`dark` on `/pair`, `light` elsewhere), puts `class="pos-root"` on `<body>` and keeps one inline `<script>`. Text comes from one object `EN` (`apps/hub/src/lib/strings.ts`, keys as in `docs/design/ui-brief.md`, `errors.<CODE>` for codes); the page shows the text for the key, never a raw key and never the server `message` (F §6.2). Fixes: setup shows a busy button, a slow-call banner after 3 s, a banner per error code and the failing field; the bootstrap page shows the admin roster as name tiles (no raw JSON, no `staff_id` input) and a success screen with the way to `/admin/approve`; every PIN input is `type="password"` with `inputmode="numeric"`; the phone pair page asks for the device name in a field (1–40 characters) instead of `window.prompt`. Element ids `screen`, `setup`, `login`, `roster` and class `display-code` stay; script behaviour (storage keys, requests, retries) is unchanged. Urdu (`UR`) is added later (D12). | D12 requires translation keys; the brief found the pages unusable as shipped (errors invisible, raw IDs, clear-text PINs). | §8.2, §8.4 |
| M94 | **01d Notifications and requests v1.0 changes this spec as listed in 01d §4.5 C-00** (rows H-1–H-14; approved 2026-11-01 by the developer with 01d v1.0). Each changed section carries a "Changed by 01d v1.0" marker. 01d owns hub migration `0006_alerts.sql` (it also creates the 00-owned `app_releases` table and the `staff_sessions_staff_activity` index); this spec's merged migrations are not edited. | One package with 01d; later modules read 00 and find the current contract. | — |

> ⚠️ Changed by 01b (B2, B10): M10 returns the winning scope and reads approvers from a list. See 01b §4.3.
> ⚠️ Changed by 01b (B17, D-12): M29's role list is overridden (Order taker kept, Waiter and Cook added, each with a `default_key`); M30 unchanged. See 01b §4.3.
> ⚠️ Changed by 01b (B18): M52 also skips a lead or responsibility naming an absent person, drops an unknown approver id and skips a grant left with no approver. See 01b §4.3.
> ⚠️ Changed by 01b (B5): M73's out-of-band notice is the `lockout_notice` on login or rotating refresh. See 01b §4.3.
> ⚠️ Changed by 01b (B7, B11, B12, review 1 m6, D-14): M57's new-branch assignment takes only qualifying admins (`access-hub-admin` and `manage-devices`), refuses duplicate names, and runs under the tenant lock. See 01b §4.3 row 19.
> ⚠️ Changed by 01d v1.0 (H-1, H-2): M12's `auth` frame takes `session_token` optionally; without it the socket is in **alert mode** (§6.21). See 01d §4.5.
> ⚠️ Changed by 01d v1.0 (H-6, README R14 as narrowed by 01d R-7): M38 phones are browser-only for alerts in the pilot (alerts only while the page is open); no code change. See 01d §4.5.
> ⚠️ Changed by 01d v1.0 (H-9): M47's `payload_hash` is taken over the payload **with the field named by the command's `pinCheck` removed** (§3.7). See 01d §4.5.
> ⚠️ Changed by 01d v1.0 (H-8): M66's retention runs inside the sweeper's try/catch (§7.3). See 01d §4.5.

### 3.2 Provisioning state

```
  ┌──────────────┐ POST /setup/provision ┌───────────────────┐ restart ┌──────────────────────┐ POST /v1/hubs/confirm ┌───────────┐
  │UNPROVISIONED │──────────────────────►│PROVISIONED_PENDING│────────►│PROVISIONED_UNCONFIRMED│─────────────────────►│ CONFIRMED │
  │no branch/key │ directory+event+config│ process exiting   │ (M13)   │ /setup → 404          │  (M41, background)   │           │
  └──────────────┘                       └───────────────────┘         └──────────────────────┘                      └───────────┘
```

- **Provisioned** means the config contains `provisioned.branch_id` and `provisioned.branch_api_key`. **Confirmed** adds `provisioned.confirmed_at`. The hub serves normally in both provisioned states.
- While UNPROVISIONED, every route except `GET /health`, `GET /setup`, `POST /setup/provision` returns `409 HUB_NOT_PROVISIONED`.
- One provisioning attempt at a time (in-process flag); a second gets `409 SETUP_IN_PROGRESS`.
- Crash between the SQLite commit and the config write: still UNPROVISIONED; the retry reuses `setup_attempt_id` (from config, not from the event, M71); within 1 h the cloud rotates the key; later, the installer asks for a reissued code (M22, M41). The hub writes `HubProvisioned` once per `branch_id`.
- Cloud side: the branch stays `pending_hub` until confirm; the code is consumed at exchange.

### 3.3 Device lifecycle

```
 tablet, phone:      GenerateDevicePairingToken ──POST /devices/pair──────────────────┐
 cashier_kiosk, kds: POST /pair/requests ──ApprovePairingRequest──GET /pair/requests/:id┤──► ACTIVE ──RevokeDevice / owner removed──► REVOKED
                                                                                        │      │
                                                                                        │      └─ /devices/pair retry (M14) → DeviceTokenRotated
```

- A device row is created only by a successful pair or approval. REVOKED is terminal (`403 DEVICE_REVOKED`); re-pairing creates a new row.
- `device_type ∈ { tablet, cashier_kiosk, kds, phone }`. `kds` has a `station_id` and opens station sessions only; the others open staff sessions only (`403 DEVICE_TYPE_NOT_ALLOWED`). `phone` has an `owner_staff_id`; only the owner logs in (M38).
- Revoking ends the device's active sessions (staff/station and admin) in the same transaction (`'device_revoked'`) and closes its sockets with `4403`.

### 3.4 Session lifecycle

| Kind | Opened by | Device | Actor in events | Idle TTL | Allowed calls |
|---|---|---|---|---|---|
| `staff` | `POST /auth/pin` | tablet, cashier_kiosk, phone (owner only); required | `staff_id` | `ttlFor(staff)` (M11) | commands, queries, WS |
| `station` | `POST /auth/station` | kds; required | `null` | none | `stationScoped` commands, queries with `allowStation`, WS |
| `admin` | `POST /admin/auth` | tablet, cashier_kiosk, phone (owner); required and bound | `staff_id` | `ttlFor(staff)` | `/admin/*` with the same device token |
| `admin` (bootstrap) | `POST /admin/auth/bootstrap` with a token issued by setup or the hub CLI (M72) | none (`'hub-admin'` in events) | `staff_id` | `ttlFor(staff)` | `/admin/*` without a device token |

```
                     open
  (none) ─────────────────────────► ACTIVE ──┬── logout (staff/admin) ─────────────► ENDED 'logout'
                                             ├── same staff, or new station session ► ENDED 'replaced'           (M6, M53)
                                             ├── other staff, takeover: true ──────► ENDED 'taken_over'         (M20)
                                             ├── idle > ttl (guard, login, sweeper) ► ENDED 'idle_timeout'      (M46)
                                             ├── ForceLogoutSession ───────────────► ENDED 'forced'
                                             ├── device revoked ───────────────────► ENDED 'device_revoked'
                                             ├── staff removed on directory apply ─► ENDED 'staff_removed'
                                             ├── pin_hash changed on apply ────────► ENDED 'credentials_changed' (M50)
                                             └── restore reconciliation ───────────► ENDED 'hub_restored'       (M40, M48)
```

- Every transition to ENDED writes exactly one `SessionEnded { session_id, kind, staff_id, station_id, reason, ended_by }` and bumps `authGeneration` after commit (M39). ENDED is terminal.
- **Activity (M59):** commands, logins and opted-in queries refresh `last_activity_at` in memory; the sweeper persists it.
- **Expiry (M46):** guard and login transaction end idle sessions on contact; the sweeper (every 15 s) ends the rest. Station sessions never idle out.
- **Restore (M40, M48):** forward reconciliation from checkpoint; step 4b runs only when `staff_sessions` is empty while session events exist (cloud-only restore) and ends every session that has `SessionStarted` and no `SessionEnded` with `'hub_restored'`.
- An ended session token gets `401 SESSION_EXPIRED`; an unknown one `401 SESSION_INVALID` (except the M19 replay path and the logout routes).

### 3.5 PIN verification and lockout

Order of checks for `POST /auth/pin`, `POST /admin/auth`, `POST /admin/auth/bootstrap`:

1. Guards (§3.9). Phone owner check (M38) before anything else counts.
2. Rate-subject lockout — device (`/auth/pin`, `/admin/auth`) or client IP (bootstrap): `locked_until > branchNow` → `429 DEVICE_LOCKED_OUT` / `429 IP_LOCKED_OUT`. A lock that has expired resets its counter to 0 (M62).
3. Staff lockout: `locked_until > branchNow` → `429 PIN_LOCKED_OUT`; expired → counter reset (M62).
4. Staff in the directory, else `404 STAFF_NOT_FOUND` (not counted).
5. Acquire the route's argon2 semaphore (M23, M42): wait ≤ 2 s, else `503 SERVICE_UNAVAILABLE { retry_after_ms: 1000 }`.
6. `argon2.verify(pin_hash, pin)` outside any transaction, with `pin` as the received string; release the semaphore.
7. `writer.run`: re-read both lockout rows; locked now → `429`, even if the PIN was correct.
8. Mismatch → increment counters; on a threshold set `locked_until` and append the lockout event; commit; `401 PIN_INVALID { attempts_remaining }`.
9. Match → reset the staff counter (device/IP counter is not reset); continue with the endpoint's success steps in the same transaction.

| Subject | Threshold | Window | Lock | Event |
|---|---|---|---|---|
| `staff` | `auth.pin_max_failures` (5) consecutive | until a success, a clear, or lock expiry | `auth.pin_lockout_ms` (900 000) | `StaffPinLockedOut` |
| `device` | `auth.device_max_failures` (10) | fixed window `auth.device_failure_window_ms` (300 000) from the first failure | `auth.pin_lockout_ms` | `DevicePinLockedOut { subject_type: 'device' }` |
| `ip` (bootstrap only) | same as device | same | same | `DevicePinLockedOut { subject_type: 'ip' }` |

**Commands with a PIN (v1.6, 01d H-3).** A command that declares `pinCheck` (§4.2) runs the same steps 2–9 through `checkPin`, with three additions: (a) its optional **`preRead(db, payload, ctx)`** runs read-only before step 2 and before argon2 — a `DomainError` from it is returned with no PIN verified and nothing counted; (b) inside the step-7 transaction, after the lock re-read and **before** the match / mismatch branch, **`prepare(tx)`** runs on a **read-only transaction view** (`append` / `onCommit` throw; a non-`readonly` statement throws) and returns the drafts; (c) the outcome is one transaction in every case: `prepare` ok + match → reset the staff counter, `onMatch(tx, P)` appends; `prepare` ok + mismatch → step 8 plus **`onMismatch(tx)`** drafts, `401`; **`prepare` throws** → for **both** PINs, one failure is counted on the staff and the subject counters exactly as step 8 (lockout events at the threshold) and **`onPrepareFailed(tx, error, matched)`** drafts are appended, then the `prepare` error is returned (`IdempotentReplay` is not a failure: the stored response, nothing counted). So no response, counter delta or transaction count depends on whether the PIN matched. Sign-in passes none of these and behaves as today.

> ⚠️ Changed by 01d v1.0 (H-3): PIN-bearing commands (`pinCheck`, `preRead`, `prepare`, `onMatch`, `onMismatch`, `onPrepareFailed`). See 01d §4.5 H-3 and 01d §3.3 rule 4.
> ⚠️ Changed by 01d v1.1 (AD-10, AD-24–AD-27, AD-94, AD-20): as built, `preRead(db, payload, ctx)`; a `pinCheck` command peeks for a replay early (a replay with no valid token gets `401`, not the stored `200`); `authGen` is captured before the session check (at most one extra M39 re-check); the hooks ctx is built on the writable transaction with `permission: null`; PIN commands share the `/auth/pin` argon2 semaphore; both `pinHooks` gain a trailing `cmd: PosCommand` argument (only `cmd.command_id` is read, for 01d's `pin_use_failed` dedupe key); `checkPin` is unchanged; BF-2's log line is `{ err, phase: 'onPrepareFailed' }`. See 01d v1.1 §4.5.

### 3.6 Effective permission (M10)

```
resolve(staff_id, permission):
  if (staff_id, permission) in staff_permission_denials → { grant: 'denied' }
  grants = [ rp.grant_type for rp in role_permissions
             where rp.role_id in staff_roles(staff_id) and rp.permission = permission ]
  if 'allowed' in grants           → { grant: 'allowed' }
  if 'requires_approval' in grants → { grant: 'requires_approval',
                                       approver_role_ids: sorted union of approver_role_id }
  → { grant: 'not_granted' }
```

**v1.5 (01b §3.3):** `approver_role_ids` is the sorted union of every approver in `role_permission_approvers` for the roles granting `requires_approval`; both `allowed` and `requires_approval` results add `scope`, the widest scope among the roles granting the winning type (`branch` > `my_floors` = `my_team` = `my_stations` > `own_tables`). The precedence above is unchanged.

> ⚠️ Changed by 01b (B2, B10): `resolve` returns `scope`; approvers come from the approver list. See 01b §4.3.


**Command rule** (resolved inside the transaction, M39): staff/admin session: `allowed` → continue; `requires_approval` with `approvable: true` → continue with `ctx.permission`; otherwise `403 PERMISSION_DENIED { permission, grant }`. Station session: command must be `stationScoped`, else `403 PERMISSION_DENIED { permission, session_kind: 'station' }`.

**Permission catalogue** (`@pos/domain/src/permissions.ts`): E6 AC2 list + `manage-devices` (D38) + `access-hub-admin` (M7). Later modules append in their own spec; a unit test fails if a command declares a permission not in the catalogue.

### 3.7 Command pipeline (implements §6.3 order)

```
POST /commands/:name   or   POST /admin/commands/:name
 ── guards (§3.9): host, provisioned, guest net, client version, device token, [admin session]
 ── registry lookup ─────────────────────────────────── 404 ROUTE_NOT_FOUND
 ── Zod: PosCommandSchema; :name ↔ command_type ─────── 400 VALIDATION_FAILED
 ── body device_id = token device ('hub-admin' only for the bootstrap admin session) ─ 400 (M47)
 ── tenant_id, branch_id = config ───────────────────── 403 BRANCH_MISMATCH (M70)
 ── idempotency fast path (M19, M34, M47):
      row = processed_commands[command_id]
      row matches (device | admin session_id) AND command_type AND payload_hash → replay, Idempotent-Replay: true
      row exists otherwise → 400 VALIDATION_FAILED (issue: command_id already used)
 ── device session for /commands (staff or station; idle check M46) ── 401 SESSION_INVALID / SESSION_EXPIRED
 ── body actor_id = session staff_id (null for station) ─ 400
 ── payload Zod ──────────────────────────────────────── 400
 ── record g0 = authGeneration
 ── writer.run(tx ⇒ {
        idempotency re-check (same rules) ─────────────── hit → ROLLBACK, replay
        if authGeneration ≠ g0: re-read device + session ─ DEVICE_REVOKED / SESSION_EXPIRED (M39)
        kind ↔ command, permission (§3.6, current directory) ─ 403 PERMISSION_DENIED
        { events, result } = command.handle(ctx)          synchronous; may throw DomainError
        appended = tx.append(events)                     seq = MAX(seq)+1…, recorded_at = branchNow; projections + all checkpoints
        INSERT processed_commands { command_id, branch_id, device_id, session_id, command_type, payload_hash,
                                    response_json: { status: 200, body }, recorded_at }
        nextState = appended.reduce(reducer, state)
      })
 ── COMMIT → swap state → after-commit hooks (authGeneration, directory) → respond 200 → ws.publish(appended)
 ── touch session activity (M59)
```

- `handle` is synchronous. Async work (argon2) happens before the writer.
- A `DomainError` from any step inside the transaction rolls back; nothing is stored (§6.1); a retransmit is evaluated again.
- `payload_hash` = SHA-256 hex of the canonical JSON (keys sorted recursively, no whitespace) of `payload` **with the field named by the command's `pinCheck` removed** (`AnswerRequest`: `pin`; commands without `pinCheck`: the whole payload, unchanged). A PIN never enters `processed_commands`. M19 / M47 replay still matches on `command_id`, device (or admin `session_id`), command type and this hash; a replay that differs only in the PIN replays the stored response (no new effect). The SQL comment on `payload_hash` in `0001` is unchanged in the merged migration; the rule lives in `apps/hub/src/lib/hash.ts` and the pipeline.
- **PIN step (v1.6, H-3):** for a command with `pinCheck`, after "payload Zod": `preRead` (read-only), then `checkPin(…)` (§3.5) whose `prepare` = idempotency re-check, M39 re-check, permission, `handle` (drafts only) and whose `onMatch` = append and `processed_commands`. **Test hook** `testHooks.betweenVerifyAndWriter` between argon2 `verify` and `writer.run` (`pin.ts:70–75`), like `betweenGuardAndWriter` (`route.ts:92`).
- **`permission: 'checked-in-handler'` (v1.6, H-3):** a staff command whose right depends on the payload declares it; the registry accepts it **only** for `HANDLER_CHECKED_COMMANDS = ['AnswerRequest', 'WithdrawRequest', 'MarkAlertsSeen']` (any other → startup error); such a command needs a staff session (station → `403 PERMISSION_DENIED { session_kind: 'station' }`); `ctx.permission = null`; the handler runs its own right check before writing.

> ⚠️ Changed by 01d v1.0 (H-3, H-9): `payload_hash` without the PIN field; the PIN step; the handler-checked marker. See 01d §4.5.

### 3.8 Boot sequence ownership (§5.8)

| Step | What | Owner |
|---|---|---|
| 0 | Load and Zod-validate hub config; unprovisioned → setup mode (steps 1, 1a, then 7 with only `/health` and `/setup`) | 00 |
| 1 | Open SQLite: WAL, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`; delete leftover `pre-migrate-*.sqlite` plaintext copies in `data_dir` (M67) | 00 |
| 1a | Migrations: encrypted pre-migration backup when `user_version > 0` and provisioned; per-file transaction; checksum check | 00 |
| 2–3 | Snapshot load and replay into engine state | 03a |
| 3a | Clock guard: `last = recorded_at of the max-seq row` (M48); `Date.now() ≤ last` → `ClockAlarm { source: 'boot' }`, `branchNow` starts at `last + 1` | 00 |
| 4 | Projection catch-up (M48): each projection with checkpoint < `MAX(seq)` replays from its checkpoint (`reset` + full replay only without a checkpoint row); includes `access_reconcile` (M40) and its `hub_restored` endings | 00 |
| 4a | Load `StaffDirectory` (M18) | 00 |
| 4b | Only if `staff_sessions` is empty and session events exist: end every open session `'hub_restored'` (M48) | 00 |
| 5 | Print queue resume | 03b |
| 6 | Missed fires | 03a |
| 7 | Open HTTP + WS; start sweeper (15 s), heartbeat (60 s); if provisioned and not confirmed, start the confirm task (M41) | 00 |
| 8 | `HubStarted { hub_down_at, hub_up_at, events_replayed, missed_fires, boot_ms }` | 00 |

A failing step stops boot; the process exits non-zero; systemd restarts it. `GET /health` reports `boot_step`.

### 3.9 Route guards

Applied by a root `onRoute` hook from each route's `config.group`. A hub route-inventory test fails if any route lacks the guard set for its group.

| Guard | Applies to | Failure |
|---|---|---|
| host (M45) | **all routes** | `403 HOST_NOT_ALLOWED` (WS: close `4403`) |
| provisioned | all except `/health`, `/setup*`, `/ui/*` (M81) | `409 HUB_NOT_PROVISIONED` |
| guest network (`guest_network_cidrs`) | all except `/health` (reduced body, M63) | `403 GUEST_NETWORK_FORBIDDEN` (WS: close `4403`) |
| client version (`X-Client-Version` < `min_client_version`; absent passes) | `/commands/*`, `/queries/*`, `/auth/*`, `/devices/pair`, `/pair/*`, `/ws` | `426 CLIENT_UPGRADE_REQUIRED` (WS: `4426`) |
| device token (`Authorization: Bearer`) | `/commands/*`, `/queries/*`, `/auth/*`, `/admin/*` except `/admin/auth/bootstrap`, the static pages (M79) and requests carrying a bootstrap admin session | `401 DEVICE_TOKEN_INVALID`; revoked → `403 DEVICE_REVOKED` |
| device session (`X-Session-Token`, staff/station, same device, idle check M46) | `/commands/*` after the M19 fast path; `/queries/*` with `session: 'required'`; `POST /auth/logout` (accepts ended) | `401 SESSION_INVALID` / `401 SESSION_EXPIRED` |
| admin session (`X-Admin-Session`, kind admin, same device unless bootstrap, idle check M46, `access-hub-admin` re-resolved M61) | `/admin/*` except `/admin/auth`, `/admin/auth/bootstrap`, `/admin/login-roster` and the static pages (M79) | `401 ADMIN_SESSION_REQUIRED`; permission lost → `403 PERMISSION_DENIED` |
| roster access | `/admin/login-roster`: device token (tablet/cashier_kiosk/phone) **or** `X-Admin-Bootstrap` header with a live bootstrap token | `401 DEVICE_TOKEN_INVALID` / `401 PAIRING_TOKEN_INVALID` |
| static admin pages (M79, M86) | `GET /admin/bootstrap`, `GET /admin/approve`, `GET /admin`: host, provisioned, guest network only; no device token, no session; the page script sends credentials on its own requests | as the guards above |
| UI kit (M81) | `GET /ui/*` (group `static`): host and guest network only; works before provisioning | as the guards above |
| pairing token / poll secret | `POST /devices/pair`, `GET /pair/requests/:id` (in handler) | `401 PAIRING_TOKEN_INVALID` / `404 PAIRING_REQUEST_NOT_FOUND` |
| WS auth message | `/ws` (§6.21) | close `4401` / `4403` |

Every accepted guard records `authGeneration` for the M39 re-check.

> ⚠️ Changed by 01d v1.1 (AD-34, AD-T41-1): `/app/*` (§6.36, §6.37) uses route group `admin-device-public` (host, provisioned, guest network, device token: exactly the guard set above), not `device`, whose client-version guard would give an outdated tablet `426` on the endpoint it needs to update. The hub serves 01d's `staff` entry at `/staff/` on route group `admin-page`, like `/admin/stock/`; `registerClientDist({ indexMeta })` adds `<meta>` `pos-tenant-id`, `pos-branch-id`, `pos-branch-name`, `pos-hub-now-ms`, `pos-hub-utc-offset-ms` to its `index.html` on each request: ids and the clock only, no secret, as `/admin/approve` already embeds tenant and branch ids (M79). See 01d v1.1 §4.5.

### 3.10 Hub config file

`/etc/pos-hub/config.json`, mode `0600`, owned by the hub service user, written atomically (temp file, fsync, rename, fsync dir).

```json
{
  "cloud_base_url": "https://api.example-pos.app/v1",
  "http_port": 3000,
  "data_dir": "/var/lib/pos-hub",
  "backup_dir": "/media/POSBACKUP",
  "cors_origins": ["http://localhost"],
  "min_client_version": "1.0.0",
  "maintenance_hour": 4,
  "auth": { "pin_max_failures": 5, "device_max_failures": 10, "device_failure_window_ms": 300000,
            "pin_lockout_ms": 900000, "argon2_concurrency": 2, "admin_argon2_concurrency": 1 },
  "advertised_host": "192.168.10.2",
  "guest_network_cidrs": ["192.168.20.0/24"],
  "setup_attempt_id": "01JBF3Q8ZK4M2N6P7R9S0T1V2W",
  "provisioned": { "tenant_id": "01JB…", "branch_id": "01JB…", "branch_name": "Gulberg", "branch_api_key": "…", "confirmed_at": 1761000000000 },
  "backup_encryption_key": "<base64, 32 bytes>"
}
```

| Fields | Written by |
|---|---|
| `cloud_base_url`, `http_port`, `data_dir`, `backup_dir`, `cors_origins`, `min_client_version`, `maintenance_hour`, `auth.*` | installer |
| `advertised_host`, `guest_network_cidrs` (M58), `setup_attempt_id`, `provisioned.{tenant_id, branch_id, branch_name, branch_api_key}` (M78), `backup_encryption_key` | `/setup/provision` only |
| `provisioned.confirmed_at` | the confirm task (M41) only |

The branch API key and backup key never reach SQLite or a backup (D53, M21).

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| Foundation | Envelopes and schemas (§4.1), Shared Standards (§6), `EngineState` type only |
| 01 | Writes cloud staff/role tables (§5.2), bumps `tenants.directory_version` on every change; registers `registerStationValidator` |
| 03a | Registers the reducer and boot steps 2, 3, 6 |
| 06 | Calls `applyStaffDirectory`; uses `encryptFile` / `decryptFile`, `backup_encryption_key`; calls `setMaintenanceHour` |

### 4.2 Exposes (later modules may rely only on these)

**Hub (`apps/hub/src`):**

| Export | Shape | Used by |
|---|---|---|
| `defineCommand` | `{ commandType, payloadSchema, sessionKind: 'device' \| 'admin', permission, approvable?, stationScoped?, pinCheck?, preRead?, handle(ctx): { events: EventDraft[], result } }`. `permission` may be `null` only when `stationScoped` and the command is never allowed to staff; `'checked-in-handler'` only for `HANDLER_CHECKED_COMMANDS` (§3.7, v1.6). **`pinCheck(payload, ctx) → { staff_id, pin, field } \| null`** and **`preRead(db, payload, ctx)`** (v1.6, 01d H-3): §3.5 "Commands with a PIN". Every command counts as session activity (M59) | every module with commands |
| `defineQuery` | `{ resource, sessionKind: 'device' \| 'admin', session: 'required' \| 'none', allowStation?, deviceTypes?, countsAsActivity?: boolean (default false, M59), querySchema, handle(ctx) }`; `ctx.db` is a read-only connection; ctx = `{ db, page, directory, device, session }` | every module with queries |
| `CommandCtx` | `{ tx, state (read-only), clock, ids, secrets, actor: { kind, staffId \| null, stationId \| null, sessionId, deviceId }, permission, branch: { tenantId, branchId }, directory, config }` | handlers |

**Socket context** passed to audiences and catch-up: `{ deviceId, deviceType, sessionId, kind, staffId, stationId, asOfSeq }`.

| `EventDraft` | `PosEvent` without `event_id`, `seq`, `recorded_at`, `tenant_id`, `branch_id` | handlers |
| `writer.run(fn)` | the only path that writes events (§3.7 inner part); `afterCommit` hooks; `lastSeq()` | registry, 03a tick, sweeper, auth routes |
| `authGeneration` | `{ current(): number; bump(): void }` — bumped after commit by `DeviceRevoked`, `DeviceTokenRotated`, `SessionEnded`, `StaffDirectoryApplied` | guards, writer |
| `registerProjection` | `{ name, eventTypes, apply(tx, event), reset?(tx) }` — without `reset` the projection is forward-only (M40) | modules with projection tables |
| `state.setReducer(reducer)` | reducer `(state, event) => state`; one reducer, a later call replaces it; folded by the writer inside the transaction, and by replay (03a) | 01a, 03a |
| `registerBootStep` | `{ step: '2' \| '3' \| '5' \| '6', run(bootCtx) }` | 03a, 03b |
| `registerCatchUp` | `{ part, appliesTo(socketCtx), build(db, state, socketCtx) }` (v1.6, H-7: the third argument is the socket context given to `appliesTo`; additive, existing parts ignore it; `apps/hub/src/ws/catch-up.ts` passes `socket`); parts merged into `catch_up.state` | 01d, 02, 03b, 04, 05 |
| `registerEventAudience` | `(eventType, (event, socketCtx) => boolean)`; events with no audience are not pushed | every module with pushed events |
| `registerStationValidator` | `(tx, stationId) => boolean`; until registered, every `station_id` is rejected | 01 |
| `StaffDirectory` | `resolve`, `get`, `ttlFor`, `version`, `permissionsOf`; v1.5 (01b): `floorsOf`, `leadOf`, `teamOf`, `stationsOf`, `responsibilityHolders` | registry, 04 |
| `applyStaffDirectory(tx, directory)` | v1.5: directory shape v2 (01b §4.3.1). M51 version rule, M52 skip rule; replaces the cache; ends sessions of removed staff and of staff whose `pin_hash` changed (M50); revokes phones of removed owners (M38); appends `StaffDirectoryApplied`; swaps after commit | 06 |
| `setMaintenanceHour(h)` | 0–23, local hub time (M66) | 06 |
| `issueAdminBootstrap(tx, issuedBy: 'setup' \| 'cli' \| 'restore')` | expires live bootstrap tokens, creates one (30 min), appends `AdminBootstrapTokenIssued`; returns `{ token, expires_at }` (M72) | 06 (replace-hub restore) |
| `encryptFile(src, dst, key, iv)` / `decryptFile(src, dst, key)` | AES-256-GCM file format (§7.9) | 06 |
| `clock.branchNow()`, `ids.next()`, `secrets` | §6.7 determinism | everyone |
| `ws.sendToDevices(device_ids, frame)`, `ws.sendToStaff(staff_ids, frame)` | v1.6 (H-4): after commit only; `sendToDevices` reaches every socket of the device — staff, station and alert mode | 01d |
| `ws.connectedSessions()` | v1.6 (H-4): `Array<{ staffId, deviceId, sessionId, kind }>` of the open session sockets, from the in-memory list (`apps/hub/src/ws/server.ts`), no statement | 01d |

> ⚠️ Changed by 01b (B1, B2, B4, B10): `StaffDirectory` gains floor, lead, team and responsibility lookups; `applyStaffDirectory` takes directory v2. See 01b §4.3.
> ⚠️ Changed by 01d v1.0 (H-3, H-4, H-7): `defineCommand` gains `pinCheck` / `preRead` and the handler-checked marker; `registerCatchUp.build` gets the socket context; new `ws` exports. See 01d §4.5.
> ⚠️ Changed by 01d v1.1 (AD-21, AD-67, AD-74): the read-only transaction view blocks `exec`, `pragma` and `transaction` and requires `readonly && reader`; `engine-host/read-only-tx.ts` exports `rawDbOf(view)`, used only as a map key by 01d's `bindAlertEnv`, never handed to kind code; new export `WsHub.sendToSessions(sessionIds, frame)` (after commit; alert frames are per recipient and hiding is per session). See 01d v1.1 §4.5.

**Events introduced (all `schema_version: 1`; v1.5: `StaffDirectoryApplied` is `schema_version: 2`):**

| Event | `stream_type` / `stream_id` | Payload | Pushed to |
|---|---|---|---|
| `HubProvisioned` | `hub` / branch_id | `{ tenant_id, branch_id, hub_version }` (M71) | — |
| `HubStarted` | `hub` / branch_id | `{ hub_down_at \| null, hub_up_at, events_replayed, missed_fires, boot_ms }` | — |
| `ClockAlarm` | `hub` / branch_id | `{ wall_ms, last_recorded_at, delta_ms, source: 'boot' \| 'cloud_offset' }` | all sockets |
| `StaffDirectoryApplied` | `hub` / branch_id | `{ directory_version, staff_count, role_count, removed_staff_ids, credentials_changed_staff_ids, skipped: Array<{ kind: 'staff' \| 'role_assignment' \| 'permission' \| 'approver' \| 'lead' \| 'responsibility', id, reason }> }` (v2, 01b B18: `lead`, `responsibility` added; v1 → v2 upcaster is the identity) | — |
| `AdminBootstrapTokenIssued` | `hub` / branch_id | `{ bootstrap_token_id, expires_at, issued_by: 'setup' \| 'cli' \| 'restore' }` (M72) | — |
| `DevicePairingTokenGenerated` | `hub` / pairing_token_id | `{ pairing_token_id, device_type: 'tablet' \| 'phone', owner_staff_id \| null, expires_at }` | — |
| `DevicePaired` | `hub` / device_id | `{ device_id, device_name, device_type, station_id \| null, owner_staff_id \| null, pairing_token_id \| null, pairing_request_id \| null }` (exactly one source id) | — |
| `DeviceTokenRotated` | `hub` / device_id | `{ device_id, pair_request_id }` (M60) | the device's sockets (close `4401`) |
| `DeviceRevoked` | `hub` / device_id | `{ device_id, reason \| null, cause: 'manual' \| 'owner_removed' }` | the device's sockets (close `4403`) |
| `SessionStarted` | `staff` / staff_id, or `station` / station_id | `{ session_id, kind, staff_id \| null, station_id \| null, device_id \| null, idle_ttl_ms \| null }` | — |
| `SessionEnded` | as `SessionStarted` | `{ session_id, kind, staff_id \| null, station_id \| null, reason, ended_by \| null }`; reason ∈ `logout, replaced, taken_over, idle_timeout, forced, device_revoked, staff_removed, credentials_changed, hub_restored` | that session's sockets (close `4401`, close reason = `reason`) |
| `StaffPinLockedOut` | `staff` / staff_id | `{ staff_id, locked_until, failed_count }` | — |
| `DevicePinLockedOut` | `hub` / device_id or `ip:<addr>` | `{ subject_type: 'device' \| 'ip', subject_id, locked_until, failed_count }` | — |
| `PinLockoutCleared` | `staff` / staff_id, or `hub` / subject | `{ subject_type, subject_id }` | — |

`SessionEnded` is the only signal that a session ended (D51, for kinds `staff` and `admin`).

> ⚠️ Changed by 01b (B18): `StaffDirectoryApplied` moves to schema version 2 with two new skip kinds. See 01b §4.3.


**Cloud (`apps/cloud/src`):** `TenantScopedRepository`, `TenantLevelRepository` (M16), `tenant-scope` plugin (JWT, branch API key, registration code), `owner-credentials` plugin (M55), `jwt` plugin, error handler, migrations runner, `SystemContext` (CLI only, M56), tables in §5.2, `default-roles.ts`.

---

## §5. Data model and migrations

### 5.1 Hub (SQLite)

**`0001_event_store.sql`** — foundation `events` (+ `events_branch_seq`, `events_stream`, immutability triggers) and `sync_cursor` verbatim; `hub_heartbeat` verbatim; plus:

```sql
CREATE TABLE processed_commands (           -- §4.1 + M19, M47
  command_id    TEXT    PRIMARY KEY,
  branch_id     TEXT    NOT NULL,
  device_id     TEXT    NOT NULL,           -- from the token; 'hub-admin' for the bootstrap admin session
  session_id    TEXT,                       -- admin replays match on it (M47)
  command_type  TEXT    NOT NULL,
  payload_hash  TEXT    NOT NULL,           -- SHA-256 hex of canonical payload JSON
  response_json TEXT    NOT NULL,           -- { status, body }
  recorded_at   INTEGER NOT NULL
);
CREATE INDEX processed_commands_branch ON processed_commands (branch_id, recorded_at);  -- 7-day prune

CREATE TABLE projection_checkpoints (       -- M17, M48
  branch_id  TEXT    NOT NULL,
  projection TEXT    NOT NULL,
  last_seq   INTEGER NOT NULL,
  PRIMARY KEY (branch_id, projection)
);
```

Index note (M48): step 3a reads `SELECT recorded_at FROM events WHERE branch_id = ? ORDER BY seq DESC LIMIT 1`, served by `events_branch_seq`.

**`0002_devices_sessions.sql`:**

```sql
CREATE TABLE devices (
  device_id      TEXT    PRIMARY KEY,
  branch_id      TEXT    NOT NULL,
  token_hash     TEXT    NOT NULL UNIQUE,   -- every device-authenticated request; 'rotated:<event_id>' after M40
  device_name    TEXT    NOT NULL,
  device_type    TEXT    NOT NULL CHECK (device_type IN ('tablet','cashier_kiosk','kds','phone')),
  station_id     TEXT,
  owner_staff_id TEXT,
  paired_at      INTEGER NOT NULL,
  paired_by      TEXT    NOT NULL,
  last_seen_at   INTEGER,
  revoked_at     INTEGER,
  revoked_by     TEXT,
  CHECK ((device_type = 'kds')   = (station_id IS NOT NULL)),
  CHECK ((device_type = 'phone') = (owner_staff_id IS NOT NULL))
);
-- no index on owner_staff_id: the M38 revoke scans tens of device rows once per directory apply

CREATE TABLE pairing_tokens (              -- tablet and phone (M44)
  pairing_token_id    TEXT    PRIMARY KEY,
  branch_id           TEXT    NOT NULL,
  token_hash          TEXT    NOT NULL UNIQUE,   -- POST /devices/pair
  device_type         TEXT    NOT NULL CHECK (device_type IN ('tablet','phone')),
  owner_staff_id      TEXT,
  created_by          TEXT    NOT NULL,
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  consumed_at         INTEGER,
  consumed_request_id TEXT,
  device_id           TEXT,
  CHECK ((device_type = 'phone') = (owner_staff_id IS NOT NULL))
);

CREATE TABLE pair_requests (               -- cashier_kiosk and kds (M44)
  request_id       TEXT    PRIMARY KEY,     -- in the QR
  branch_id        TEXT    NOT NULL,
  poll_secret_hash TEXT    NOT NULL,        -- SHA-256 of the screen's poll secret
  display_code     TEXT    NOT NULL,        -- 6 Crockford chars, shown on screen and checked on approval
  device_name      TEXT    NOT NULL,
  requester_ip     TEXT    NOT NULL,        -- per-IP cap (M76)
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,        -- created_at + 600 000
  approved_at      INTEGER,
  approved_by      TEXT,
  device_id        TEXT,
  delivery_token   TEXT                     -- plaintext device token until expires_at, then NULL (retention)
);
CREATE INDEX pair_requests_pending ON pair_requests (branch_id, expires_at)
  WHERE approved_at IS NULL;               -- caps: 10 pending, 2 per IP (§6.30, M76; ≤ 10 rows scanned)

CREATE TABLE admin_bootstrap_tokens (      -- M42
  bootstrap_token_id TEXT    PRIMARY KEY,
  branch_id          TEXT    NOT NULL,
  token_hash         TEXT    NOT NULL UNIQUE,
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,     -- created_at + 1 800 000
  consumed_at        INTEGER,
  session_id         TEXT
);

CREATE TABLE staff_sessions (
  session_id       TEXT    PRIMARY KEY,
  branch_id        TEXT    NOT NULL,
  token_hash       TEXT    NOT NULL UNIQUE,    -- M9
  kind             TEXT    NOT NULL CHECK (kind IN ('staff','admin','station')),
  staff_id         TEXT,
  station_id       TEXT,
  device_id        TEXT,                       -- NULL only for the bootstrap admin session
  idle_ttl_ms      INTEGER,                    -- NULL only for station
  started_at       INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  ended_at         INTEGER,
  end_reason       TEXT,
  ended_by         TEXT,
  CHECK (kind = 'admin' OR device_id IS NOT NULL),
  CHECK ((kind = 'station') = (station_id IS NOT NULL)),
  CHECK ((kind = 'station') = (staff_id IS NULL)),
  CHECK ((kind = 'station') = (idle_ttl_ms IS NULL))
);
CREATE UNIQUE INDEX staff_sessions_active_device
  ON staff_sessions (device_id) WHERE ended_at IS NULL AND kind IN ('staff','station');   -- M6
CREATE INDEX staff_sessions_active ON staff_sessions (branch_id) WHERE ended_at IS NULL; -- sweeper, lists

CREATE TABLE auth_lockouts (
  branch_id         TEXT    NOT NULL,
  subject_type      TEXT    NOT NULL CHECK (subject_type IN ('staff','device','ip')),
  subject_id        TEXT    NOT NULL,
  failed_count      INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  locked_until      INTEGER,
  PRIMARY KEY (branch_id, subject_type, subject_id)
);
CREATE INDEX auth_lockouts_locked ON auth_lockouts (branch_id, locked_until) WHERE locked_until IS NOT NULL;
```

**`0003_staff_directory.sql`** — cache of cloud data (D40). Replaced whole by `applyStaffDirectory`; the only hub tables where DELETE is normal.

```sql
CREATE TABLE staff (staff_id TEXT PRIMARY KEY, branch_id TEXT NOT NULL,
  display_name TEXT NOT NULL, pin_hash TEXT NOT NULL);
CREATE TABLE roles (role_id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, name TEXT NOT NULL,
  session_idle_ttl_ms INTEGER NOT NULL CHECK (session_idle_ttl_ms > 0));
CREATE TABLE role_permissions (
  role_id          TEXT NOT NULL REFERENCES roles(role_id),
  permission       TEXT NOT NULL,
  grant_type       TEXT NOT NULL CHECK (grant_type IN ('allowed','requires_approval')),
  approver_role_id TEXT REFERENCES roles(role_id),
  CHECK ((grant_type = 'requires_approval') = (approver_role_id IS NOT NULL)),
  PRIMARY KEY (role_id, permission));
CREATE TABLE staff_roles (staff_id TEXT NOT NULL REFERENCES staff(staff_id),
  role_id TEXT NOT NULL REFERENCES roles(role_id), PRIMARY KEY (staff_id, role_id));
CREATE TABLE staff_permission_denials (staff_id TEXT NOT NULL REFERENCES staff(staff_id),
  permission TEXT NOT NULL, PRIMARY KEY (staff_id, permission));
CREATE TABLE staff_directory_meta (branch_id TEXT PRIMARY KEY,
  directory_version INTEGER NOT NULL, applied_at INTEGER NOT NULL);
```

`not_granted` is the absence of a row. The directory is read whole at boot and after apply (6 fixed SELECTs), so no secondary indexes.

**v1.5:** 01b's hub migration `0005_directory_v2.sql` (01b §5.2) rebuilds `role_permissions` with `scope` and without `approver_role_id` (the hub reads `approver_role_ids`; the cloud keeps sending `approver_role_id` for hubs not yet upgraded, 01b B18 a), adds `role_permission_approvers`, `staff.lead_staff_id`, `staff_floors` and `responsibilities`. The directory is then read in 9 fixed SELECTs.

> ⚠️ Changed by 01b (B1, B2, B4, B10): hub migration `0005_directory_v2.sql`; 9 SELECTs instead of 6. See 01b §4.3.



**v1.6 (01d H-12, H-14):** 01d's hub migration `0006_alerts.sql` also creates two 00-owned objects:

```sql
CREATE TABLE app_releases (               -- §6.36–§6.38; written only by the hub CLI; not a projection
  version_code     INTEGER PRIMARY KEY,
  version_name     TEXT    NOT NULL,
  sha256           TEXT    NOT NULL,
  staged_device_id TEXT,                    -- null = marked good, released to every tablet
  added_at         INTEGER NOT NULL
);
CREATE INDEX staff_sessions_staff_activity ON staff_sessions (staff_id, last_activity_at);  -- 01d §3.4.3 (c) last-activity read
```

The index serves 01d's last-activity read and changes no 00 behaviour.

> ⚠️ Changed by 01d v1.0 (H-12, H-14): `app_releases` and `staff_sessions_staff_activity`, created in 01d's `0006`. See 01d §4.5.

**Retention (M66; batches of 500, one `writer.run` per batch, in the maintenance hour):** `staff_sessions` ended > 7 d; `pairing_tokens` expired > 7 d; `pair_requests` expired > 7 d, and `delivery_token = NULL` on every expired request at each sweep; `admin_bootstrap_tokens` expired > 7 d; `processed_commands` > 7 d (D32); `auth_lockouts` unlocked with window older than 1 d.

### 5.2 Cloud (PostgreSQL 16)

**v1.5:** 01b's cloud migration `0005_staff_roles.sql` (01b §5.1) changes these tables: `staff.pin_hash` becomes nullable and `staff` adds `pin_set_at`, `left_at` (B3); `owner_users` adds `must_change_password`, `lock_notice_at`, `password_changed_at`, `temp_password_expires_at`, `credential_version` (B5, review 2 N1) and `staff_id`, the owner's own staff row (B7); `owner_refresh_tokens` adds `credential_version` (review 2 N1); `roles` adds `default_key` (backfilled for existing default roles, B17), `archived_at` and idle (whole minutes) and name CHECKs; `role_permissions` adds `scope`, the approver list moves to `role_permission_approvers`, and `approver_role_id` stays, dual-written with the first approver, with its CHECK kept (B2, B10, B22). **The cloud rolls forward only once `0005` is applied** (01b B22, §7.4: v1.4 cannot read a NULL `pin_hash`). `0001` itself is merged and unchanged.

**Cloud migrations runner (v1.5, 01b B22, review 2 N5):** `apps/cloud/src/db/migrate.ts`, before applying anything, compares the `schema_migrations` rows with the build's files; a stored `version` with no file in this build → throw `MigrationUnknownVersionError` ("database has migration NNNN (<name>) that this build does not have: this build is older than the database; deploy the current build"), apply nothing, and the process exits non-zero before it listens. The existing checksum check is unchanged. (The hub runner already refuses a `user_version` above its files.) Test: 01b #105.

> ⚠️ Changed by 01b (B2, B3, B5, B7, B10, B17, B22, review 2 N1, N5): cloud `staff`, `owner_users`, `owner_refresh_tokens`, `roles`, `role_permissions` change in 01b's `0005_staff_roles.sql`; the cloud runner refuses a database ahead of the build; roll forward only. See 01b §4.3 rows 2, 3, 20.

**`0001_platform.sql`.** Times are `BIGINT` Unix ms (§6.8). Tenant-level tables per M16.

```sql
CREATE TABLE schema_migrations (version INT PRIMARY KEY, name TEXT NOT NULL,
  checksum TEXT NOT NULL, applied_at BIGINT NOT NULL);

-- tenant-level (M16)
CREATE TABLE tenants (
  tenant_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  currency_code TEXT NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  directory_version BIGINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL);
CREATE TABLE owner_users (
  tenant_id TEXT NOT NULL REFERENCES tenants, user_id TEXT NOT NULL,
  email TEXT NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
  allowed_branch_ids TEXT[] NOT NULL,
  failed_login_count INT NOT NULL DEFAULT 0, login_window_started_at BIGINT,
  login_locked_until BIGINT,                                         -- M33
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, user_id));
CREATE UNIQUE INDEX owner_users_email ON owner_users (lower(email)); -- login lookup (pre-tenant)
CREATE TABLE owner_refresh_tokens (
  tenant_id TEXT NOT NULL, token_id TEXT NOT NULL, user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
  rotated_at BIGINT, revoked_at BIGINT,
  PRIMARY KEY (tenant_id, token_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES owner_users);
CREATE UNIQUE INDEX owner_refresh_tokens_hash ON owner_refresh_tokens (token_hash);  -- refresh lookup
CREATE INDEX owner_refresh_tokens_user ON owner_refresh_tokens (tenant_id, user_id)
  WHERE revoked_at IS NULL;                                          -- reuse → revoke all
CREATE TABLE staff (
  tenant_id TEXT NOT NULL REFERENCES tenants, staff_id TEXT NOT NULL,
  display_name TEXT NOT NULL, pin_hash TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, staff_id));
CREATE TABLE roles (                                                -- no is_admin_role (M57)
  tenant_id TEXT NOT NULL REFERENCES tenants, role_id TEXT NOT NULL, name TEXT NOT NULL,
  session_idle_ttl_ms INTEGER NOT NULL CHECK (session_idle_ttl_ms > 0),
  PRIMARY KEY (tenant_id, role_id));
CREATE TABLE role_permissions (
  tenant_id TEXT NOT NULL, role_id TEXT NOT NULL, permission TEXT NOT NULL,
  grant_type TEXT NOT NULL CHECK (grant_type IN ('allowed','requires_approval')),
  approver_role_id TEXT,
  CHECK ((grant_type = 'requires_approval') = (approver_role_id IS NOT NULL)),
  PRIMARY KEY (tenant_id, role_id, permission),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles,
  FOREIGN KEY (tenant_id, approver_role_id) REFERENCES roles (tenant_id, role_id));
CREATE TABLE staff_roles (
  tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, role_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, staff_id, role_id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff, FOREIGN KEY (tenant_id, role_id) REFERENCES roles);
CREATE TABLE staff_permission_denials (
  tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, permission TEXT NOT NULL,
  PRIMARY KEY (tenant_id, staff_id, permission),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff);

-- branch-level
CREATE TABLE branches (
  tenant_id TEXT NOT NULL REFERENCES tenants, branch_id TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_hub','active')),
  hub_confirmed_at BIGINT,                                          -- M41
  CHECK ((status = 'active') = (hub_confirmed_at IS NOT NULL)),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id));
CREATE UNIQUE INDEX branches_branch_id ON branches (branch_id);
CREATE TABLE staff_branches (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, staff_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, staff_id),                     -- directory build per branch
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches, FOREIGN KEY (tenant_id, staff_id) REFERENCES staff);
CREATE TABLE registration_codes (
  code_hash TEXT PRIMARY KEY,                                       -- exchange lookup (pre-tenant)
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('new_branch','replace_hub')),
  created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
  consumed_at BIGINT, consumed_attempt_id TEXT,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);
CREATE INDEX registration_codes_branch ON registration_codes (tenant_id, branch_id)
  WHERE consumed_at IS NULL;                                        -- M22 reissue / confirm expire old codes
CREATE TABLE branch_api_keys (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, key_id TEXT NOT NULL,
  key_hash TEXT NOT NULL, created_at BIGINT NOT NULL, revoked_at BIGINT,
  PRIMARY KEY (tenant_id, key_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);
CREATE UNIQUE INDEX branch_api_keys_hash ON branch_api_keys (key_hash);        -- sync auth (pre-tenant)
CREATE UNIQUE INDEX branch_api_keys_one_active
  ON branch_api_keys (tenant_id, branch_id) WHERE revoked_at IS NULL;          -- one live key per branch

-- idempotency_keys: moved to 01 (M69)
```

The four global unique indexes (`owner_users_email`, `owner_refresh_tokens_hash`, `branch_api_keys_hash`, `registration_codes.code_hash`) plus `branches_branch_id` serve credential lookups that run **before** a tenant is known. They do not lead with `tenant_id` (override recorded in M55 a). They are queried only by `db/credential-lookup.ts`, importable only by `plugins/tenant-scope.ts` and `plugins/owner-credentials.ts` (M55 b); the raw client stays unexported (D54). The CLIs reach the database only through `SystemContext` (M56).

---

## §6. Endpoints

Error sets: **G-hub** = `403 HOST_NOT_ALLOWED`, `403 GUEST_NETWORK_FORBIDDEN`, `409 HUB_NOT_PROVISIONED`. **G-dev** = G-hub + `401 DEVICE_TOKEN_INVALID`, `403 DEVICE_REVOKED`, `426 CLIENT_UPGRADE_REQUIRED`. **G-admin** = G-dev + `401 ADMIN_SESSION_REQUIRED`, `403 PERMISSION_DENIED`. All times `branchNow`.

### Batch 1 — blank hub to logged-in staff

#### 6.1 `POST /commands/:name` and `POST /admin/commands/:name`

| | |
|---|---|
| Permission | per command (§3.6), resolved inside the transaction |
| Auth | `/commands/*`: device token + device session (after the M19 fast path). `/admin/commands/*`: device token + bound admin session (bootstrap session: no device token) |
| Input | `PosCommandSchema`; `payload` by the command's schema |
| Processing | §3.7 exactly |
| Idempotency | D32 two-step; M19 device match; M47 type + payload hash; admin by `session_id` |
| Response | `200 { data: { command_id, event_ids, result } }` |
| Errors | G-dev / G-admin; `400 VALIDATION_FAILED`; `401 SESSION_INVALID` / `SESSION_EXPIRED`; `403 BRANCH_MISMATCH` / `PERMISSION_DENIED` / `DEVICE_REVOKED` (in-transaction, M39); `404 ROUTE_NOT_FOUND`; the command's own |
| Query count | fast path 1; transaction: re-check 1, auth re-read 0 or 2 (M39), `MAX(seq)` 1, 1 per event, 1 `processed_commands`, projections per command |

#### 6.2 `GET /queries/:resource` and `GET /admin/queries/:resource` — generic query route

| | |
|---|---|
| Auth | `/queries/*`: device token; + device session when the query declares `session: 'required'`; station sessions only when `allowStation`. `/admin/queries/*`: device token + bound admin session (`access-hub-admin` re-resolved, M61) |
| Input | query string by `querySchema`; lists that can grow without bound use `cursor` + `limit` (default 50, max 200) |
| Processing | resolve; validate; `handle(ctx)` on the read-only connection; no transaction, no writes; refresh in-memory session activity **only** when the query declares `countsAsActivity: true` (M59) |
| Response | `200 { data, meta? }` (`meta.next_cursor` for paginated) |
| Errors | G-dev or G-admin; `400 VALIDATION_FAILED`; `401 SESSION_*`; `403 DEVICE_TYPE_NOT_ALLOWED` (query `deviceTypes`); `404 ROUTE_NOT_FOUND`; query's own |
| Query count | fixed per query, declared in its spec (CLAUDE.md no N+1) |

#### 6.3 `GET /health`

| | |
|---|---|
| Auth | none; host guard applies; guest network gets the reduced body (M63) |
| Response | staff networks: `200 { data: { status, boot_step, provisioned, confirmed, branch_id \| null, max_seq \| null, hub_version, clock_alarm } }`; guest ranges: `200 { data: { status } }` |

#### 6.4 `POST /setup/provision` (hub)

| | |
|---|---|
| Auth | registration code; route exists only while UNPROVISIONED |
| Input | `{ registration_code (12 Crockford, dashes/spaces/case ignored), guest_network_cidrs: CIDR[] (min 1), advertised_host: IPv4 that is one of this host's own addresses (os.networkInterfaces) }` (M58) |

Processing:
1. Provisioned → `404 ROUTE_NOT_FOUND`. Flag set → `409 SETUP_IN_PROGRESS`.
2. Validate; normalise the code.
3. No `setup_attempt_id` → generate and write config atomically (M14).
4. Cloud `POST /hubs/register`, `Idempotency-Key: <setup_attempt_id>`, `{ registration_code, hub_version, accepted_kinds: ['new_branch'] }`, 10 s. Network error → `503 SERVICE_UNAVAILABLE { retry_after_ms: 5000 }`; cloud error → same status and code.
5. Zod-validate the response shape (malformed → `500 INTERNAL_ERROR`, nothing written). Individual bad rows are skipped by M52, not rejected.
6. `writer.run`: `applyStaffDirectory`; append `HubProvisioned` unless one exists for this `branch_id`; `issueAdminBootstrap(tx, 'setup')` (M42, M72).
7. Generate `backup_encryption_key` unless present; write config atomically (`provisioned` incl. `branch_name` (M78), `guest_network_cidrs`, `advertised_host`, key).
8. `200 { data: { tenant_id, branch_id, branch_name, restarting: true, first_admin_url: "http://<advertised_host>:<port>/admin/bootstrap#t=<token>", first_admin_qr_svg, first_admin_expires_at } }`; exit(0) after the response is flushed (M13). The setup page shows `first_admin_url` as a link and `first_admin_qr_svg` as the QR (M77).

| | |
|---|---|
| Errors | `400 VALIDATION_FAILED`, `401 REGISTRATION_CODE_INVALID`, `403 HOST_NOT_ALLOWED` / `GUEST_NETWORK_FORBIDDEN`, `404 ROUTE_NOT_FOUND`, `409 SETUP_IN_PROGRESS`, `422 REGISTRATION_CODE_KIND_UNSUPPORTED`, `500 INTERNAL_ERROR`, `503 SERVICE_UNAVAILABLE` |
| Events | `StaffDirectoryApplied`, `HubProvisioned`, `AdminBootstrapTokenIssued` |

Note: the bootstrap token survives the restart because it is stored hashed in SQLite before the config write; if the config write fails, the retry creates a new one and the old one expires.

#### 6.5 `POST /v1/hubs/register` (cloud)

| | |
|---|---|
| Auth | registration code via tenant-scope plugin (M15). Unknown, expired, or consumed by another attempt → `401 REGISTRATION_CODE_INVALID` (one code for all, so the response does not reveal which codes exist) |
| Headers | `Idempotency-Key: <ULID>` required |
| Input | `{ registration_code, hub_version: semver, accepted_kinds: ('new_branch' \| 'replace_hub')[] (min 1) }` |

Processing (one transaction):
1. `SELECT … FROM registration_codes WHERE code_hash = $1 FOR UPDATE`. Valid when `expires_at > now` and (`consumed_at IS NULL` or (`consumed_attempt_id = Idempotency-Key` and `now − consumed_at < 3 600 000`)).
2. `kind ∉ accepted_kinds` → `422 REGISTRATION_CODE_KIND_UNSUPPORTED`; not consumed.
3. New 256-bit key: revoke the branch's live key; INSERT the new hash.
4. If unconsumed: set `consumed_at`, `consumed_attempt_id`. The branch **stays `pending_hub`** until the hub confirms (§6.28, M41).
5. Directory in 5 fixed queries: branch + tenant; active staff ⨝ `staff_branches`; roles referenced by those staff or as approvers; their `role_permissions`; `staff_roles` + `staff_permission_denials` for those staff.
6. COMMIT; respond.

| | |
|---|---|
| Response | `200 { data: { tenant_id, branch_id, branch_name, currency_code, kind, branch_api_key, directory: { directory_version, staff: [{ staff_id, display_name, pin_hash, role_ids, denied_permissions }], roles: [{ role_id, name, session_idle_ttl_ms, permissions: [{ permission, grant_type, approver_role_id }] }] } } }`. **v1.5:** `directory` is shape v2 (01b §4.3.1), **additive over v1**: staff add `lead_staff_id`, `floor_ids`; grants keep `approver_role_id` (the first approver) and add `approver_role_ids[]` and `scope`; the role list includes every approver role; a top-level `responsibilities` list; staff with no PIN are not sent. A v1.4 hub parses it and applies it with v1 semantics (01b B18 a, §7.4) |
| Idempotency | M14 rotation |
| Concurrency | `FOR UPDATE` serialises two exchanges of one code; `branch_api_keys_one_active` guarantees one live key |
| Errors | `400 VALIDATION_FAILED`, `401 REGISTRATION_CODE_INVALID`, `422 REGISTRATION_CODE_KIND_UNSUPPORTED`, `500 INTERNAL_ERROR` |
| Audit | the hub's `HubProvisioned` event (reaches the cloud through 06); log line `hub_registered { tenant_id, branch_id, kind, rotated }` |


> ⚠️ Changed by 01b (B3, B4, B10, B18): the provisioning response carries the additive directory shape v2. See 01b §4.3.

#### 6.6 `POST /admin/auth` — admin session (M42)

| | |
|---|---|
| Auth | device token, `device_type ∈ { tablet, cashier_kiosk, phone }` (kds → `403 DEVICE_TYPE_NOT_ALLOWED`); phone: `staff_id` must be the owner (`403 DEVICE_NOT_OWNED`) |
| Input | `{ staff_id, pin: /^\d{4,6}$/ }` |
| Processing | §3.5 with rate subject `device` and the admin semaphore; on match, in the same transaction: `access-hub-admin` must be `allowed` (else `403 PERMISSION_DENIED`, counters stay reset); INSERT session `kind 'admin'`, `device_id` = caller, `idle_ttl_ms = ttlFor`; append `SessionStarted` |
| Response | `200 { data: { admin_session_token, session_id, staff_id, display_name, idle_ttl_ms, permissions: { 'manage-devices': boolean, 'manage-staff': boolean } } }` (`permissions`: M89, effective in the same transaction) |
| Errors | G-dev; `400`, `401 PIN_INVALID`, `403 DEVICE_TYPE_NOT_ALLOWED` / `DEVICE_NOT_OWNED` / `PERMISSION_DENIED`, `404 STAFF_NOT_FOUND`, `429 PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT`, `503 SERVICE_UNAVAILABLE` |
| Events | `SessionStarted`; lockout events |

#### 6.7 `POST /admin/commands/generate-device-pairing-token` — `GenerateDevicePairingToken`

| | |
|---|---|
| Permission | `manage-devices` (D38) |
| Payload | `{ device_type: 'tablet' \| 'phone', owner_staff_id?: ULID }`; `owner_staff_id` required iff `phone`; `cashier_kiosk` and `kds` pair by request (§6.30–§6.32, M44) → `400 VALIDATION_FAILED` |
| Handler | If `phone`: `owner_staff_id` not in the directory → `404 STAFF_NOT_FOUND`. Generate 256-bit token (base64url) + `pairing_token_id`; `expires_at = branchNow + 600 000`; INSERT `pairing_tokens` (hash); event `DevicePairingTokenGenerated` |
| Result | `{ pairing_token, pairing_token_id, expires_at, pair_url: "http://<advertised_host>:<port>/pair?t=<pairing_token>", pair_qr_svg }`; the admin UI shows `pair_qr_svg` (M77) |
| Idempotency | D32; the stored response holds the plaintext token, which is useless after 10 min or one pair (accepted) |
| Errors | §6.1; `404 STAFF_NOT_FOUND` |

#### 6.8 `POST /devices/pair` (tablet, phone)

| | |
|---|---|
| Auth | pairing token in the body; guards: host, provisioned, guest network, client version |
| Input | `{ pairing_token, pair_request_id: ULID, device_name: string(1–40), device_type }` |

Processing (`writer.run`):
1. Look up by `sha256(pairing_token)`. Missing or `expires_at ≤ branchNow` → `401 PAIRING_TOKEN_INVALID`.
2. `device_type ≠ token.device_type` → `403 DEVICE_TYPE_NOT_ALLOWED`.
3. Consumed: same `pair_request_id`, `branchNow − consumed_at < 600 000`, device not revoked → **rotate** (M14): new token, `UPDATE devices SET token_hash`, append `DeviceTokenRotated { device_id, pair_request_id }` (M60; bumps `authGeneration`, M39). Otherwise (other request id, 600 000 ms or more after consumption, or a revoked device) → `401 PAIRING_TOKEN_INVALID`.
4. Unconsumed: if the token is for a `phone` whose owner is no longer in the directory → `401 PAIRING_TOKEN_INVALID`. New `device_id`, 256-bit `device_token`; INSERT `devices` (with the token's `owner_staff_id`); mark token consumed; append `DevicePaired` (`actor_id` = token `created_by`, `device_id` = new device).

| | |
|---|---|
| Response | `200 { data: { device_id, device_token, device_type, owner_staff_id \| null, owner_name \| null, branch_id, branch_name, hub_version } }` (`owner_name`: M92); `branch_name` from config (M78) |
| Errors | G-hub; `400 VALIDATION_FAILED`, `401 PAIRING_TOKEN_INVALID`, `403 DEVICE_TYPE_NOT_ALLOWED`, `426 CLIENT_UPGRADE_REQUIRED` |
| Events | `DevicePaired` (`pairing_token_id` set), `DeviceTokenRotated` |

#### 6.9 `POST /auth/pin` — staff session

| | |
|---|---|
| Auth | device token; device type `tablet`, `cashier_kiosk` or `phone` (else `403 DEVICE_TYPE_NOT_ALLOWED`) |
| Input | `{ staff_id: ULID, pin: /^\d{4,6}$/, takeover?: boolean (default false) }` |
| Owner check | `phone` and `staff_id ≠ owner_staff_id` → `403 DEVICE_NOT_OWNED`, checked **before** §3.5 step 2 so it is not counted as a PIN failure and no PIN is verified (M38) |

Processing: §3.5 with rate subject `device` and the PIN semaphore; on match, in the same transaction:
0. An active session on this device that is idle-expired (`branchNow − last_activity_at > idle_ttl_ms`) is ended `'idle_timeout'` first (M46), so it never causes a `409`.
1. Active session on this device:
   - same `staff_id` → end it `'replaced'`.
   - other staff, `takeover` false → ROLLBACK; `409 DEVICE_SESSION_ACTIVE { staff_id, display_name, can_take_over: true }` (holder's). Counters stay reset.
   - other staff, `takeover` true → end it `'taken_over'`, `ended_by` = new staff (M20).
2. INSERT session `kind 'staff'`, `idle_ttl_ms = ttlFor`; append `SessionStarted`.
3. COMMIT. Two logins on one device are serialised by `BEGIN IMMEDIATE`; the second sees the first's session in step 1. The partial unique index stays as the backstop; a constraint error is mapped to `409 DEVICE_SESSION_ACTIVE`.

| | |
|---|---|
| Response | `200 { data: { session_token, session_id, staff_id, role_ids, display_name, idle_ttl_ms } }` (foundation §5.7 fields + `session_id`, `idle_ttl_ms`) |
| Idempotency | same-staff replace (M6) |
| Errors | G-dev; `400 VALIDATION_FAILED`, `401 PIN_INVALID`, `403 DEVICE_TYPE_NOT_ALLOWED` / `DEVICE_NOT_OWNED`, `404 STAFF_NOT_FOUND`, `409 DEVICE_SESSION_ACTIVE`, `429 PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT`, `503 SERVICE_UNAVAILABLE` |
| Events | `SessionStarted`; `SessionEnded` (`replaced` / `taken_over`); lockout events |

#### 6.10 `POST /auth/logout`

| | |
|---|---|
| Auth | device token + `X-Session-Token` (ended sessions accepted) |
| Processing | `writer.run`: load session by hash (must belong to this device, else `401 SESSION_INVALID`); kind `station` → `403 STATION_LOGOUT_NOT_ALLOWED` (station sessions end only by force, replacement or revoke; M55 e); if active: end `'logout'`, append `SessionEnded` |
| Response | `200 { data: { session_id, ended_at, already_ended } }` |
| Errors | G-dev; `401 SESSION_INVALID`; `403 STATION_LOGOUT_NOT_ALLOWED` |
| Events | `SessionEnded` |

### Batch 2 — station sessions, admin, pairing requests

#### 6.11 `POST /auth/station` — station session (M30)

| | |
|---|---|
| Auth | device token; device type `kds` (else `403 DEVICE_TYPE_NOT_ALLOWED`) |
| Input | `{}` |
| Processing | `writer.run`: if an active station session exists for the device → end it `'replaced'`; INSERT session `kind 'station'`, `station_id` = device's, `idle_ttl_ms NULL`; append `SessionStarted` (stream `station`) |
| Response | `200 { data: { session_token, session_id, station_id } }` |
| Idempotency | replace: a retry ends the previous session and returns a new one |
| Post-commit | the replaced session's sockets get `SessionEnded { reason: 'replaced' }`, then close `4401` with close reason `replaced`; the client stops (M53, §8.4) |
| Errors | G-dev; `403 DEVICE_TYPE_NOT_ALLOWED` |
| Events | `SessionStarted`, `SessionEnded` (`replaced`) |

#### 6.12 `POST /admin/auth/logout`

| | |
|---|---|
| Auth | `X-Admin-Session` (ended accepted); device token required unless the session is the bootstrap session |
| Response | `200 { data: { session_id, ended_at, already_ended } }` |
| Errors | G-hub; `401 ADMIN_SESSION_REQUIRED` (unknown token or other device) |

#### 6.13 `GET /admin/login-roster` (M32, M42)

| | |
|---|---|
| Auth | device token of type tablet / cashier_kiosk / phone, **or** header `X-Admin-Bootstrap: <live bootstrap token>` |
| Response | `{ staff: [{ staff_id, display_name, role_names, locked_until \| null }] }` (`role_names`: M92) — staff with `access-hub-admin` allowed; on a phone only the owner (if allowed) |
| Query count | 1 |
| Errors | G-hub; `401 DEVICE_TOKEN_INVALID` / `PAIRING_TOKEN_INVALID` (bootstrap token not live); `403 DEVICE_REVOKED` / `DEVICE_TYPE_NOT_ALLOWED` |

#### 6.14 `POST /admin/commands/revoke-device` — `RevokeDevice`

| | |
|---|---|
| Permission | `manage-devices` |
| Payload | `{ device_id, reason?: string(≤200) }` |
| Handler | device missing → `404 DEVICE_NOT_FOUND`; already revoked → return result with `already_revoked: true`, no events; else set `revoked_at/by`, end its active staff/station session and every admin session bound to it `'device_revoked'` (`ended_by` = actor), append `DeviceRevoked { cause: 'manual' }` (bumps `authGeneration`, M39) |
| Result | `{ device_id, revoked_at, already_revoked }` |
| Post-commit | sockets of the device get `DeviceRevoked` then close `4403` |
| Errors | §6.1; `404 DEVICE_NOT_FOUND` |
| Events | `DeviceRevoked`, `SessionEnded` |

#### 6.15 `POST /admin/commands/force-logout-session` — `ForceLogoutSession`

| | |
|---|---|
| Permission | `manage-staff` |
| Payload | `{ session_id }` |
| Handler | missing → `404 SESSION_NOT_FOUND`; already ended → `already_ended: true`, no events; else end `'forced'`, `ended_by` = actor; append `SessionEnded`. Any kind, including the caller's own admin session |
| Result | `{ session_id, ended_at, already_ended }` |
| Errors | §6.1; `404 SESSION_NOT_FOUND` |
| Events | `SessionEnded` (E0 PIN AC5: forced logout logged) |

#### 6.16 `POST /admin/commands/clear-pin-lockout` — `ClearPinLockout`

| | |
|---|---|
| Permission | `manage-staff` |
| Payload | `{ subject_type: 'staff' \| 'device' \| 'ip', subject_id }` |
| Handler | row missing or not locked → `cleared: false`, no events; else reset `failed_count = 0`, `locked_until = NULL`; append `PinLockoutCleared` |
| Result | `{ subject_type, subject_id, cleared }` |
| Errors | §6.1 |
| Events | `PinLockoutCleared` (D28: lockout clearable by a manager) |

#### 6.17 `GET /admin/queries/devices`

| | |
|---|---|
| Input | `?include_revoked=false` |
| Response | `{ devices: [{ device_id, device_name, device_type, station_id, owner_staff_id, owner_name, pairing_source: 'token' \| 'request', paired_at, paired_by_name, last_seen_at, revoked_at, revoked_by_name, revoked_reason, active_session: { session_id, kind, staff_id, display_name } \| null }] }` (`owner_name`, `revoked_by_name`, `revoked_reason`: M87; null when not applicable) |
| Query count | 1 (devices LEFT JOIN active sessions), plus 1 when `include_revoked=true` (`SELECT stream_id, payload FROM events WHERE stream_type = 'hub' AND stream_id IN (<revoked ids>) AND event_type = 'DeviceRevoked'`, latest per device; `events_stream`); names from `StaffDirectory`; last-seen from memory merged over the column (refreshed by every device-authenticated request and by each WebSocket pong, **including alert-mode sockets** (01d, §6.21): a tablet holding only its alert connection, with no session, counts as seen in device health; so a kitchen screen holding only its socket is seen every 15 s; Q8); `pairing_source` from `device_type` (M80). Bounded list (a branch has tens of devices), returned whole |

> ⚠️ Changed by 01d v1.0 (H-13): last seen also refreshed by alert-mode pongs (same `armKeepalive`). See 01d §4.5.

#### 6.18 `GET /admin/queries/sessions`

| | |
|---|---|
| Response | `{ sessions: [{ session_id, kind, staff_id, display_name, station_id, device_id, device_name, started_at, last_activity_at, idle_ttl_ms }] }` — active only |
| Query count | 1 (active sessions LEFT JOIN devices, served by `staff_sessions_active`); activity from memory. Bounded by devices + admins |

#### 6.18a `GET /admin/queries/lockouts` (M88)

| | |
|---|---|
| Auth | §6.2 admin (`access-hub-admin`) |
| Response | `{ staff: [{ staff_id, display_name, locked_until }], devices: [{ device_id, device_name, locked_until }], ips: [{ ip, locked_until }] }`, each sorted by `locked_until` descending; only rows with `locked_until > branchNow`. IP lockouts come from bootstrap sign-in only (§3.5) |
| Query count | 1 (`auth_lockouts` LEFT JOIN `devices` for device names, served by `auth_lockouts_locked`); staff names from `StaffDirectory` (a staff row no longer in the directory is skipped) |
| Activity | `countsAsActivity: false` |
| Errors | G-admin |

#### 6.18b `GET /admin/queries/stations` (M88)

| | |
|---|---|
| Auth | §6.2 admin (`access-hub-admin`) |
| Response | `{ stations: [{ station_id, name, location_label, category_names }] }` — non-archived stations in config order (01a §4.3); `category_names` = up to 3 names of categories that have an item on the station, by category `sort_order`. Empty list when no branch config is loaded yet |
| Query count | 0 (in-memory branch config, 01a S40) |
| Activity | `countsAsActivity: false` |
| Errors | G-admin |

#### 6.18c `GET /admin/queries/staff` (M88)

| | |
|---|---|
| Auth | §6.2 admin (`access-hub-admin`) |
| Response | `{ staff: [{ staff_id, display_name, role_names, phone_count }] }` sorted by `display_name`; `phone_count` = non-revoked `phone` devices owned by the staff member |
| Query count | 1 (`SELECT owner_staff_id, COUNT(*) FROM devices WHERE device_type = 'phone' AND revoked_at IS NULL GROUP BY owner_staff_id`); staff and role names from `StaffDirectory` |
| Activity | `countsAsActivity: false` |
| Errors | G-admin |

#### 6.19 `GET /queries/staff-roster`

| | |
|---|---|
| Auth | device token, `session: 'none'`; device type `tablet` / `cashier_kiosk` / `phone` |
| Response | `{ staff: [{ staff_id, display_name, locked_until \| null, responsibilities: string[] (v1.5, 01b B4) }], active_session: { staff_id, display_name } \| null }` sorted by `display_name`; on a `phone` the list holds only the owner (M38) |
| Query count | 2 (lockouts; this device's active session) |
| Activity | `countsAsActivity: false` (M59) |
| Errors | G-dev; `403 DEVICE_TYPE_NOT_ALLOWED` |


> ⚠️ Changed by 01b (B4): roster rows add `responsibilities` (e.g. `['count_stock']`), from memory; query count unchanged. See 01b §4.3.

#### 6.20 `GET /queries/session`

| | |
|---|---|
| Auth | device token + device session; `allowStation: true` |
| Response | `{ session_id, kind, staff: { staff_id, display_name, role_ids } \| null, station_id \| null, idle_ttl_ms \| null, permissions: { [permission]: { grant, approver_role_ids?, scope? } } }` (v1.5, 01b B2: `scope` present for `allowed` and `requires_approval`); station sessions get `permissions: {}` |
| Query count | 0 beyond the session guard (directory in memory) |
| Activity | `countsAsActivity: false` (M59) |
| Errors | G-dev; `401 SESSION_*` |


> ⚠️ Changed by 01b (B2): `permissions[p]` adds `scope`. See 01b §4.3.

### Batch 3 — WebSocket and cloud access

#### 6.21 `GET /ws` — hub WebSocket (M12, M24)

Handshake and auth:
1. Upgrade: host check (M45) and guest-network check (close `4403`), client-version check (close `4426`). Start a 5 s timer.
2. **Nothing is sent before auth succeeds** — no `catch_up`, no `event`, no `error` frame. Any first frame that is not a valid `auth` message, or no message within 5 s → close `4401`.
3. `{ type: 'auth', device_token, session_token }`: device valid and not revoked (else `4401`; revoked `4403`); session active, kind `staff` or `station`, same device (else `4401`).
4. Synchronously (no `await` between them, so no commit can interleave): read `as_of_seq` = last committed seq; build `catch_up.state` from 00's `hub` part (M37) and every `registerCatchUp` part whose `appliesTo(socketCtx)`; register the socket for publishing; send `{ type: 'catch_up', as_of_seq, state }`.

After auth:
- Each committed event goes to the sockets for which its audience returns true **and** `event.seq > socket.as_of_seq` (publish filter), in ascending `seq`, as `{ type: 'event', seq, event }` (§6.5). The filter prevents a duplicate when a socket registers between COMMIT and publish (Review 1 #21).
- Client `{ type: 'ack', last_seq }` is accepted and recorded in memory for diagnostics only.
- Keepalive: ping every 15 s; no pong for 30 s → terminate. Pongs and acks do **not** refresh session activity (M5): an app left open with nobody using it still idles out at its role TTL (E0 PIN AC4).
- `SessionEnded` for the socket's session: send the event, close `4401` with the close reason text = `reason` (`replaced` drives M53). `DeviceTokenRotated` for the socket's device: send, close `4401`. `DeviceRevoked`: send, close `4403`. Hub shutdown: close `1012`.
- Tokens are never accepted from the query string or headers on `/ws`.
- **Session sockets also accept `receipt` frames** after auth (01d §6 batch 3; v1.6).

**Alert mode (v1.6, 01d H-1, H-2).** `{ type: 'auth', device_token }` **without** `session_token` (device types `tablet`, `cashier_kiosk`, `kds`, `phone`; device valid, not revoked): the hub sends `alerts_open`, then only `alert` / `alert_seen` / `alert_closed` frames; it accepts only `receipt` frames (any other frame → close `4401`); no catch-up, no event frames. Closed `4403` / `4401` on `DeviceRevoked` / `DeviceTokenRotated` by an after-commit check on those two events (no frame sent first). **Alert-mode sockets are kept in a separate list**, never passed to `deliver()`, `registerEventAudience` audiences or `registerCatchUp` parts, so the socket context `{ deviceId, deviceType, sessionId, kind, staffId, stationId, asOfSeq }` is unchanged. Keepalive as above (pongs refresh last seen, §6.17). **One alert-mode socket per device:** a new alert-mode auth closes the device's existing alert-mode socket `4409`, logged `{ device_id, old_remote_address, new_remote_address }`. `packages/events/src/ws.ts`: `WsServerMessage` adds `alerts_open`, `alert`, `alert_seen`, `alert_closed`; `WsClientMessage` adds `receipt`, and the `auth` variant's `session_token` becomes optional. Staff-session sockets also get `alert` / `alert_seen` / `alert_closed`; station sockets get device-target alerts (01d §6 batch 3).

> ⚠️ Changed by 01d v1.0 (H-1, H-2): alert mode, `receipt` on session sockets, new frame types. See 01d §4.5.
> ⚠️ Changed by 01d v1.1 (AD-4, AD-30, AD-31): alert-mode sockets also receive `binding_route { until }` and `alerts_open.binding_route_until` (01d §6 batch 3); the one-per-device close `4409` is the local constant `ALERT_REPLACED` in `ws/server.ts`, not in `WS_CLOSE` (01d 9b adds `WS_CLOSE.REPLACED`); a throwing `onReceipt` listener is caught and logged `{ err, device_id, alert_id }` and the socket stays open; a throwing `alerts_open` or catch-up builder is logged `{ err, device_id }` and closes that socket `1011` (a local constant). See 01d v1.1 §4.5.

| | |
|---|---|
| Query count | catch-up: sum of the registered parts' declared fixed counts |
| Library | `@fastify/websocket` 11.3.4 (on `ws` 8.x) |

#### 6.22 `POST /v1/auth/login` (cloud, allowlisted)

| | |
|---|---|
| Input | `{ email, password: string(8–200) }` |
| Processing | (1) Per-IP limit (M64): ≥ 30 failures from this IP in the last 900 000 ms (in memory; the cloud is one instance, D57) → `429 IP_LOCKED_OUT { retry_after_ms }`. (2) `owner-credentials` lookup by `lower(email)`; unknown email → verify against a fixed dummy hash (equal timing), count the IP failure, `401 LOGIN_INVALID`. (3) A lock that has expired resets the counter (M62). (4) **Locked** (`login_locked_until > now`): verify against the dummy hash (equal timing), **do not** verify the real hash, do not change the account counter, count the IP failure, `401 LOGIN_INVALID` (M73). (5) Not locked: verify argon2id. Mismatch → atomic `UPDATE owner_users SET failed_login_count = failed_login_count + 1 … RETURNING failed_login_count` (window 900 000 ms, threshold 10 → `login_locked_until = now + 900 000`), count the IP failure, `401 LOGIN_INVALID`. Match → reset counter; delete this user's refresh tokens expired more than 7 days (M69); issue JWT (HS256, 1 h; claims `sub, tenant_id, allowed_branch_ids`) and refresh token (256-bit, 30 d, hash stored). **v1.5 (01b §3.7, §6.13):** the step (5) `UPDATE` that sets `login_locked_until` also sets `lock_notice_at = now`; a match with `must_change_password` set and `temp_password_expires_at <= now` (an expired temporary password) takes the mismatch path (counted, `401 LOGIN_INVALID`); on a match, the success transaction first takes the owner row `WHERE password_hash = <the verified hash> FOR NO KEY UPDATE` (01b review 2 N2; none: a reset or change committed meanwhile → `ROLLBACK`, `401 LOGIN_INVALID`, nothing counted) and reads `credential_version`, then resets the counter, reads and clears `lock_notice_at`, stores `credential_version` on the new refresh-token row and signs the JWT with **claim `cv`** = that `credential_version` (01b review 2 N1; `sub, tenant_id, allowed_branch_ids, iat, exp` unchanged; no `pwc`, the JWT guard reads the row, §6.24a). Refresh (§6.23) issues its JWT with the same claims |
| Response | `200 { data: { access_token, access_expires_at, refresh_token, refresh_expires_at, user: { user_id, display_name, tenant_id, allowed_branch_ids, must_change_password }, lockout_notice: { locked_at, failed_count } \| null } }` (v1.5: `must_change_password`, `lockout_notice`, 01b B5) |
| Idempotency | none needed: a retry issues another refresh token; unused ones expire |
| Errors | `400 VALIDATION_FAILED`, `401 LOGIN_INVALID`, `429 IP_LOCKED_OUT` |
| Never logged | password, tokens |


> ⚠️ Changed by 01b (B5, review 2 N1, N2): login returns `must_change_password` and the one-time `lockout_notice`, refuses an expired temporary password, takes the owner row `FOR NO KEY UPDATE` and re-checks the hash before issuing tokens, and adds the `cv` claim. See 01b §4.3.

#### 6.23 `POST /v1/auth/refresh` (cloud, allowlisted)

| | |
|---|---|
| Input | `{ refresh_token }` |
| Processing | one transaction. *v1.5 (01b §6.13, M2):* look the token up by hash without a lock (missing → `401 REFRESH_TOKEN_INVALID`), then `SELECT … FROM owner_users … FOR NO KEY UPDATE` for its user (01b review 2 N2), then `FOR UPDATE` on the token row; the token row's `credential_version` ≠ `owner_users.credential_version` → `401 REFRESH_TOKEN_INVALID`, nothing revoked (01b review 2 N1). The successor row and the new JWT (claim `cv`) carry the owner's current `credential_version`. Missing, expired or revoked → `401 REFRESH_TOKEN_INVALID`. Not rotated → set `rotated_at`; successor = `HMAC-SHA256(REFRESH_TOKEN_SECRET, refresh_token)` (base64url); insert its hash (30 d); issue a JWT. Rotated within 30 000 ms → return the same successor (recomputed) and a new JWT, write nothing (M49). Rotated longer ago → revoke every live token of the user; `401 REFRESH_TOKEN_INVALID`. v1.5 (01b B5): the owner-row read returns `must_change_password` (response `user.must_change_password`); the rotating path also returns and clears `lockout_notice` (as §6.22), the grace path returns `lockout_notice: null` and writes nothing |
| Response | as §6.22 |
| Concurrency | two refreshes of one token: both get the same successor |


> ⚠️ Changed by 01b (B5, review 2 N1, N2): refresh locks the owner row `FOR NO KEY UPDATE` first, refuses a token whose `credential_version` differs from the owner's, and returns the lockout notice. See 01b §4.3.

#### 6.24 `POST /v1/auth/logout` (cloud, JWT)

| | |
|---|---|
| Input | `{ refresh_token }` |
| Processing | revoke the token if it belongs to the JWT's user (`TenantLevelRepository`); otherwise do nothing (no information leak) |
| Response | `200 { data: { revoked: boolean } }` |
| Errors | `400 VALIDATION_FAILED`, `401 JWT_INVALID` |

#### 6.24a JWT guard (cloud, `tenantScope: 'jwt'`; v1.5, 01b B5) — a guard, not an endpoint

After the signature, `alg` and `exp` checks in `plugins/tenant-scope.ts`, one statement by primary key through `db/credential-lookup.ts` (M55 b): `SELECT must_change_password, credential_version FROM owner_users WHERE tenant_id = $1 AND user_id = $2` (JWT `tenant_id`, `sub`). No row → `401 JWT_INVALID`. Claim `cv` ≠ `credential_version` → `401 JWT_INVALID` (a token issued before the last password change or support reset; a missing claim counts as 0, the column default, so tokens issued before the 01b release work until the first change; 01b review 2 N1). **The read fails** (connection, timeout, any database error) → `503 SERVICE_UNAVAILABLE`, never `401` (01b review 2 N9). The read runs outside the route's transaction; a request that passed it just before a change commits completes. `must_change_password` and the route is under `/v1/admin/*` → `403 PASSWORD_CHANGE_REQUIRED` (01b §9). Every JWT route goes through it (01a's owner routes, 01b's routes, change-password, logout). The statement belongs to the guard and is not counted in any route's statement count. Tests: 01b #65, #73, #91, #107.

> ⚠️ Changed by 01b (B5, review 2 N1, N9): new JWT guard read, compared by the `cv` claim against `credential_version`; a failed read is `503`, never `401`; the forced change is read from the row. See 01b §4.3 row 18.

#### 6.25 `GET /v1/health` (cloud, allowlisted)

`200 { data: { status: 'ok', version, db: 'ok' } }` after `SELECT 1`; DB failure → `503 SERVICE_UNAVAILABLE`.

#### 6.26 CLI `pnpm --filter cloud seed-tenant` (`apps/cloud/src/cli/seed-tenant.ts`)

| | |
|---|---|
| Args | `--name <tenant> --currency PKR --owner-email <email> --owner-name <name>`; prompts (no echo) for owner password and owner PIN, twice each |
| Processing | through `SystemContext` (M56), one transaction: refuse if the email exists; create tenant, default roles (below), `owner_users` (argon2id password), owner `staff` (argon2id PIN, M8 params) with the Owner role; v1.5 (01b B7): `owner_users.staff_id` is set to that staff row. Prints `tenant_id`, `user_id`, `staff_id` |
| Use | dev, tests, and pilot setup until 01's staff admin exists (M27) |

**Default roles (M29 as overridden by 01b B17; v1.5 values from 01b §6.15, owner answer Q13):**

| Role | Idle TTL | Grants |
|---|---|---|
| Owner (`owner`) | 60 min | every catalogue permission `allowed` (includes `access-hub-admin`, `manage-devices`) |
| Manager (`manager`) | 60 min | every permission except `manage-roles`, `allowed` |
| Cashier (`cashier`) | 15 min | `apply-discount` requires approval (Manager), `reprint-ticket` allowed; 05 appends billing permissions |
| Order taker (`order_taker`) | 15 min (owner, 01b Q12) | none; 02 appends ordering permissions, decided separately from Waiter (01b D-12); a counter role like Cashier |
| Waiter (`waiter`) | 5 min | none; 02 appends ordering permissions. Team-membership role (01b B17) |
| Cook (`cook`) | 5 min | none; 03b appends kitchen permissions. Team-membership role: no PIN expected, cooks use station sessions (M30) |

Each default role is inserted with its `default_key` (in brackets; v1.5, 01b B17), and `seed-tenant` finds roles by `default_key`, not by name. A module that appends a default grant to running tenants selects the role `WHERE default_key = '<key>'`. Order taker and Waiter are different jobs and separate roles; a person doing both holds both (01b B17, D-12).

No role flag marks "admin" roles (M57); admin access is the `access-hub-admin` permission.

Each module that adds a permission appends its default grants to `apps/cloud/src/modules/staff-roles/default-roles.ts` in its own task.

> ⚠️ Changed by 01b (B6, B7, B17, D-12): default roles are Owner, Manager, Cashier (15 min), Order taker (15 min, owner Q12), Waiter, Cook, each with a `default_key`; the owner's staff row is linked in `owner_users.staff_id`. See 01b §4.3.

#### 6.27 CLI `issue-registration-code`

In `apps/cloud/src/cli/issue-registration-code.ts` using `SystemContext`. New branch: create `pending_hub`; assign every staff member whose roles grant `access-hub-admin` (`allowed`) to it; append the branch id to every tenant owner's `allowed_branch_ids` (M57). Reissue (`--branch-id`): branch must have `hub_confirmed_at IS NULL` (M41, M22), else exit 1; expire its unconsumed codes. Code: 12 Crockford chars, `sha256` stored, 24 h. **v1.5 (01b §4.3 row 19):** the new-branch transaction first takes `SELECT … FROM tenants WHERE tenant_id = $1 FOR NO KEY UPDATE` (01b B11); it assigns only **qualifying admins** (01b B7, D-14a): staff with `is_active` and `pin_hash IS NOT NULL` whose effective `access-hub-admin` and effective `manage-devices` are both `allowed` (01b §3.3: no denial of either, and at least one role granting each as `allowed`), one statement with the same SQL as 01b §3.4's guard; **if two or more of them share a display name** (`lower(trim(display_name))`, 01b B12) → exit 1 "duplicate names at the new branch: <name> (<staff_id>, <staff_id>); rename one in the owner app and run again", listing every duplicated name, nothing written (no branch, no code; D-14b; the CLI never renames anyone); it bumps `tenants.directory_version` by 1; a `--branch-name` equal to an existing branch name of the tenant (case-insensitive, index `branches_name`, 01b §5.1) → exit 1, nothing written. Tests: 01b #86, #93, #94.

> ⚠️ Changed by 01b (B7, B11, B12, review 1 m6, m9, D-14): qualifying admins only; duplicate names refused; tenant lock and directory bump; unique branch names. See 01b §4.3 row 19.

#### 6.28 `POST /v1/hubs/confirm` (cloud, branch API key) — M41

| | |
|---|---|
| Auth | `tenantScope: 'branch-key'` |
| Input | `{ hub_version }` |
| Processing | `UPDATE branches SET status = 'active', hub_confirmed_at = COALESCE(hub_confirmed_at, now)` for the key's branch; expire its unconsumed registration codes |
| Response | `200 { data: { branch_id, hub_confirmed_at } }` (same value on repeats) |
| Errors | `401 BRANCH_API_KEY_INVALID`, `400 VALIDATION_FAILED` |
| Hub side | confirm task: on success write `provisioned.confirmed_at` to config; on network error or 5xx retry in 60 s; on 401 log an error and retry in 60 s (the key may have been rotated by a newer setup) |

#### 6.29 `POST /admin/auth/bootstrap` — first admin (M42)

| | |
|---|---|
| Auth | none beyond host, provisioned, guest network |
| Input | `{ bootstrap_token, staff_id, pin }` (the page reads the token from the URL fragment, never sends it in a URL) |
| Processing | token by hash: missing, expired or consumed → `401 PAIRING_TOKEN_INVALID`; then §3.5 with rate subject `ip` and the admin semaphore; on match in the same transaction: `access-hub-admin` allowed; consume the token; INSERT admin session with `device_id NULL`; append `SessionStarted` (`device_id 'hub-admin'`) |
| Tokens | issued by `/setup/provision` (`issued_by 'setup'`), the hub CLI (§6.34, `'cli'`) or 06's restore flow (`'restore'`); issuing one expires any live one (M72) |
| Response | as §6.6, including `permissions` (M89) |
| Errors | G-hub; `400`, `401 PAIRING_TOKEN_INVALID` / `PIN_INVALID`, `403 PERMISSION_DENIED`, `404 STAFF_NOT_FOUND`, `429 PIN_LOCKED_OUT` / `IP_LOCKED_OUT`, `503 SERVICE_UNAVAILABLE` |

#### 6.30 `POST /pair/requests` — screen asks to be paired (M44)

| | |
|---|---|
| Auth | none beyond host, provisioned, guest network, client version |
| Input | `{ device_name: string(1–40) }` |
| Processing | `writer.run` (no event): pending = `approved_at IS NULL AND expires_at > now`; ≥ 2 pending from this `requester_ip` → `429 IP_LOCKED_OUT { retry_after_ms }` (until that IP's oldest pending expires); ≥ 10 pending in total → `503 SERVICE_UNAVAILABLE { retry_after_ms: 60000 }` (M76); generate `request_id` (ULID), `poll_secret` (256-bit), `display_code` (6 Crockford chars); INSERT with `poll_secret_hash`, `requester_ip`, `expires_at = now + 600 000` |
| Response | `200 { data: { request_id, poll_secret, display_code, expires_at, approve_url: "http://<advertised_host>:<port>/admin/approve?r=<request_id>", approve_qr_svg } }`; the screen shows `approve_qr_svg` plus the display code (M77) |
| Errors | G-hub; `400`, `426`, `429 IP_LOCKED_OUT`, `503` |
| Events | none (an unauthenticated request is not a staff fact; approval is) |

#### 6.31 `GET /pair/requests/:id` — screen polls

| | |
|---|---|
| Auth | header `X-Poll-Secret`; unknown id, wrong secret or expired → `404 PAIRING_REQUEST_NOT_FOUND` (indistinguishable) |
| Response | `200 { data: { status: 'pending' } }` or `{ status: 'approved', device_id, device_token, device_type, station_id \| null, station_name \| null, branch_name }` (`station_name`: M92) (repeatable until `expires_at`; `branch_name` from config, M78) |
| Query count | 1; no writes |

#### 6.32 `ApprovePairingRequest` (`/admin/commands/approve-pairing-request`)

| | |
|---|---|
| Permission | `manage-devices` |
| Payload | `{ request_id?, display_code, device_type: 'cashier_kiosk' \| 'kds', station_id? }` (`station_id` required iff `kds`; `request_id` optional, M79) |
| Handler | with `request_id`: request missing, expired, already approved, or `display_code` mismatch → `404 PAIRING_REQUEST_NOT_FOUND`; without it: the pending requests (`approved_at IS NULL AND expires_at > now`, `pair_requests_pending`, ≤ 10 rows) whose `display_code` matches must be exactly one, else `404 PAIRING_REQUEST_NOT_FOUND`; kds: station validator false → `404 STATION_NOT_FOUND`; new `device_id` + 256-bit token; INSERT `devices` (name from the request, `paired_by` = actor); set `approved_at`, `approved_by`, `device_id`, `delivery_token`; append `DevicePaired { pairing_request_id }` |
| Result | `{ device_id, device_type, station_id }` (never the token) |
| Errors | §6.1; `404 PAIRING_REQUEST_NOT_FOUND` / `STATION_NOT_FOUND` |

#### 6.33 Endpoint count

Hub: 6.1–6.4, 6.6–6.21, 6.29–6.32 = 24. Cloud: 6.5, 6.22–6.25, 6.28 = 6. **30 endpoints**, at the README budget (~30); plus 3 CLIs (6.26, 6.27, 6.34), which are not endpoints. Static routes are not counted: the five pages (`GET /setup`, `/pair`, `/admin/bootstrap`, `/admin/approve`, `/admin` (M86)) and the UI kit (`GET /ui/*`, 6.35, M81). Query resources on the §6.2 route are listed but not counted (M90): `devices`, `sessions`, `staff-roster`, `session` (counted before v1.3 as 6.17–6.20 and kept in the 30) and the M88 additions `lockouts`, `stations`, `staff`. `GET /setup` after provisioning is the same static route answering `404` with a page (M84). Any further endpoint splits the cloud access part (6.5, 6.22–6.28, cloud CLIs) into its own spec. **v1.5:** still 30. `POST /v1/auth/change-password` is specified and counted in 01b (01b §6.11, §6.16); its code lives in `modules/owner-auth/` by folder placement only (§7.10), so it is not an endpoint of this spec.

> ⚠️ Changed by 01b (B5): change-password is 01b's route; 00 stays at 30 endpoints. See 01b §4.3.

**v1.6 (01d H-11, decided at approval by the developer, 2026-11-01):** Hub: 6.1–6.4, 6.6–6.21, 6.29–6.32 = 24, plus **6.36–6.37** (tablet update, added by 01d v1.0 H-5) = **26**. Cloud: 6.5, 6.22–6.25, 6.28 = 6. **32 endpoints**; plus 4 CLIs (6.26, 6.27, 6.34, 6.38). The split rule applies to the cloud part only: any further **cloud** endpoint splits the cloud access part (6.5, 6.22–6.28, cloud CLIs) into its own spec. Hub endpoints that this spec owns stay here even when another module's spec adds them; endpoints a module spec owns are counted in that spec (as 01b's change-password). (6.37 checks the device token and type, so it is counted, unlike the static `GET /ui/*`, M81.) With README R-9.

> ⚠️ Changed by 01d v1.0 (H-11): 32 endpoints, 4 CLIs; the split rule is for the cloud part. Supersedes the "30 endpoints" and "Any further endpoint splits" sentences above. See 01d §4.5.

#### 6.34 Hub CLI `pnpm --filter hub issue-admin-bootstrap` (M72)

| | |
|---|---|
| Where | `apps/hub/src/setup/issue-admin-bootstrap.ts` (entry) using `issueAdminBootstrap` |
| Who | the hub service user on the hub machine; refuses to run as another user (`process.getuid()` ≠ owner of `data_dir` → exit 1) |
| Preconditions | hub provisioned (else exit 1, "run setup instead") |
| Processing | load config; `openDb`; build the writer with 00's projections and a branch clock (`createBranchClock` with the max-seq row's `recorded_at`, D48); one `writer.run(tx ⇒ issueAdminBootstrap(tx, 'cli'))` |
| Output | `first_admin_url` (`http://<advertised_host>:<port>/admin/bootstrap#t=<token>`), its expiry, and a terminal QR (`qrcode.toString(url, { type: 'terminal', small: true })`) |
| Effect | every earlier live bootstrap token stops working; the new one is single-use, 30 min |
| Concurrency with a running hub | SQLite `BEGIN IMMEDIATE` + `busy_timeout` serialises with the hub's writer; `seq` stays gap-free because both read `MAX(seq)` inside their transaction. The hub's in-memory `lastSeq` lags until its next commit, which only lowers a new socket's `as_of_seq` (no event is lost; this event has no audience) |


#### 6.35 `GET /ui/*` — UI kit (M81)

| | |
|---|---|
| Group | `static` (host, guest network); before and after provisioning |
| Serves | `packages/ui-kit/**/*.css` and `**/*.woff2`, listed once at registration; anything else `404 ROUTE_NOT_FOUND` |
| Headers | `Content-Type` `text/css; charset=utf-8` / `font/woff2`; `Cache-Control: public, max-age=31536000, immutable` |
| Query | ignored (pages add `?v=<hash>`, M81) |
| Errors | `403 HOST_NOT_ALLOWED`, `403 GUEST_NETWORK_FORBIDDEN`, `404 ROUTE_NOT_FOUND` |
| Writes | none |
---

#### 6.36 `GET /app/android/latest` (v1.6, 01d H-5)

| | |
|---|---|
| Auth | device token (guards §3.9); device type `tablet` (the cashier runs Windows Chrome / Edge, foundation §1, D56), else `403 DEVICE_TYPE_NOT_ALLOWED` |
| Response | `200 { data: { version_name, version_code, sha256, staged_device_id \| null } }` = the newest release **this device may install**: the newest release if its `staged_device_id` is null (marked good) or equals the calling device; otherwise the newest release with `staged_device_id` null. No such release → `404 ROUTE_NOT_FOUND` |
| Query count | 1 statement on `app_releases` |
| Client | the app installs when `version_code` > its own (01d §8.4 windows) |

#### 6.37 `GET /app/android/<version_code>.apk` (v1.6, 01d H-5)

| | |
|---|---|
| Auth | as §6.36 |
| Response | streams the file (`application/vnd.android.package-archive`); unknown version → `404 ROUTE_NOT_FOUND` |

#### 6.38 Hub CLI `pnpm --filter hub app-release` (v1.6, 01d H-5)

- `app-release add <apk> --version-code N --version-name X --stage <device_id>`: copies the APK into `<data_dir>/apk/`, writes `sha256`, keeps the newest 2 good versions plus the staged one, deletes older files.
- `app-release mark-good <version_code>`: sets `staged_device_id = null`, releasing it to every tablet.
- State: `app_releases` (§5.1, v1.6). No event: an installation action, logged by the CLI. Nothing else in the pilot (no rollout percentage, no per-device history). (01d Q5.)

> ⚠️ Changed by 01d v1.0 (H-5): new §6.36–§6.38. See 01d §4.5 and 01d §8.4.
> ⚠️ Changed by 01d v1.1 (AD-34, AD-35): §6.36 and §6.37 use route group `admin-device-public` (§3.9); the §6.38 CLI runs as `tsx src/app-update/cli.ts` (`pnpm --filter @pos/hub app-release …`); the hub has no build step. See 01d v1.1 §4.5.

## §7. Cross-cutting

### 7.1 Hub request pipeline order

`onRequest`: assign `request_id` (ULID) → host (M45) → provisioned → guest network → client version → device token / admin session / session (per route group; each records `authGeneration`, M39). `preValidation`: Zod (fastify-type-provider-zod). Handler. `onSend`: `Idempotent-Replay` / `Retry-After` headers. Error handler: `DomainError` → catalogue status; Zod → `VALIDATION_FAILED`; anything else → `INTERNAL_ERROR` (logged with stack, never returned). Prevents: a route reaching its handler without its guards (route-inventory test).

### 7.2 Logging and redaction

Fastify's pino logger, JSON to journald. Fields on every line: `request_id`, `branch_id`, `device_id`, `session_id`, `staff_id`, `route`, `status`, `ms`. Redacted paths: `req.headers.authorization`, `req.headers["x-session-token"]`, `req.headers["x-admin-session"]`, and any body field named `pin`, `password`, `pairing_token`, `registration_code`, `refresh_token`, `device_token`, `session_token`, `admin_session_token`, `branch_api_key`, `access_token`, `bootstrap_token`, `poll_secret`, `delivery_token`, `backup_encryption_key`, v1.5 (01b B5) `current_password`, `new_password`, and headers `x-admin-bootstrap`, `x-poll-secret`. Request and response bodies are never logged. A test greps captured log output of the whole auth test suite for every secret it used. Prevents: PINs and tokens in journald or support bundles.

> ⚠️ Changed by 01b (B5): cloud redaction adds `current_password` and `new_password`. See 01b §4.3.

### 7.3 Timers

| Timer | Interval | Work |
|---|---|---|
| Session sweeper | 15 s | flush activity and `last_seen_at`; end idle sessions; clear expired `delivery_token`s |
| Heartbeat | 60 s | upsert `hub_heartbeat` (D41) |
| Retention | in `maintenance_hour`, batches of 500 | §5.1 retention (M66) |
| Confirm task | 60 s until confirmed | §6.28 (M41) |
| Hub tick (v1.6) | 500 ms | registered ticks (`registerTick`, 01d §3.5), each in its own transaction, opened only when `due` |
| Receipt flush (v1.6) | 1 000 ms or 100 receipts | 01d §3.6; skipped when the buffer is empty |

The session sweeper (sweep, then retention) is wrapped in try/catch: an error is logged `{ timer: 'sweeper', error }` and the next run continues (`apps/hub/src/auth/session-sweeper.ts` `startSweeper`).

> ⚠️ Changed by 01d v1.0 (H-8): two timers added; sweeper errors caught. See 01d §4.5.
> ⚠️ Changed by 01d v1.1 (AD-28, AD-29, AD-109, AD-110, AD-111): the sweeper logs `{ timer: 'sweeper', err }` (pino serializes an Error only under `err`) and `startSweeper(deps, log)` takes a logger (one call site, `lib/boot.ts`); the hub tick logs a whole-tick error `{ tick, err }` and the other ticks still run, `startTickLoop(deps, log)` takes a logger, and each tick's `due` runs on a read-only view. See 01d v1.1 §3.5, §4.5.

### 7.4 Argon2 semaphores (M23, M42)

Two process-wide semaphores: PIN (`auth.argon2_concurrency`, 2) and admin (`auth.admin_argon2_concurrency`, 1). FIFO, 2 s deadline.

### 7.5 CORS (M35)

`@fastify/cors` is **not** added; the hub sets `Access-Control-Allow-Origin` for origins in `cors_origins` on `/commands`, `/queries`, `/auth`, `/devices/pair`, `/pair/*` and answers `OPTIONS` preflight (allowed headers: `Authorization`, `X-Session-Token`, `X-Client-Version`, `X-Poll-Secret`, `Content-Type`). `/admin/*` and `/setup/*` send no CORS headers (same-origin only). Prevents: tablet requests failing in the WebView; another LAN origin driving admin routes from a browser.

### 7.6 Cloud rate limiting

Owner login per account (M33, M64) and per IP (M64).

### 7.7 Env and config

Hub: config file only (§3.10), `POS_HUB_CONFIG` for tests. Cloud: `DATABASE_URL`, `JWT_SECRET` (≥ 32 bytes), `REFRESH_TOKEN_SECRET` (≥ 32 bytes, M49), `PORT`, `HUB_MIN_VERSION`.

### 7.8 Performance targets (hub mini PC)

| Path | Target |
|---|---|
| `/auth/pin` p95, no contention | ≤ 300 ms |
| Command pipeline overhead (no-op command) p95 | ≤ 5 ms |
| 00's boot steps (0, 1, 3a, 4 with no stale projection, 4a, 4b skipped, 7) on a **1 M-event** database | ≤ 5 s (M48; test #100) |

### 7.9 Encrypted file format (M21, M67)

`MAGIC 'POSENC1\n'` ‖ IV (12) ‖ ciphertext ‖ tag (16), AES-256-GCM. **Encrypt:** stream to `dst.tmp`, fsync, rename. **Decrypt:** stream to `dst.tmp`; only after `final()` verifies the tag, fsync and rename to `dst`; on failure delete `dst.tmp`. No output path ever holds unverified plaintext. Pre-migration plaintext copies live in `data_dir` until encrypted and are deleted at boot step 1 if a crash left one.

### 7.10 Folder placement (§6.9)

Files land in the §6.9 folders: `apps/hub/src/{config,db,commands,queries,projections,engine-host,ws,auth,setup,lib}`, `apps/hub/deploy/` (M36), `apps/cloud/src/{plugins,modules/{hub-registration,owner-auth,staff-roles,health},db,lib}` and `apps/cloud/src/cli/` (M56; the only new folder). `engine-host/` holds only the generic state holder and writer in 00; 03a adds tick and snapshots there. v1.5: `modules/owner-auth/` also holds 01b's change-password route, and `cli/` holds 01b's `reset-owner-password.ts` and `link-owner-staff.ts`.

> ⚠️ Changed by 01b (B5, B7): `owner-auth/` hosts 01b's change-password; `cli/reset-owner-password.ts`, `cli/link-owner-staff.ts`. See 01b §4.3.

### 7.11 Library versions (M26, M68; npm registry 2026-10-23)

| Package | Version |
|---|---|
| `fastify` | 5.12.7 |
| `fastify-type-provider-zod` | 7.0.0 (peer `zod >=4.1.5`; foundation says ≥ 4.2; 4.6.7 satisfies both) |
| `zod` | 4.6.7 |
| `better-sqlite3` | 13.0.3 |
| `@node-rs/argon2` | 2.2.2 |
| `@fastify/websocket` | 11.3.4 (on `ws` ^8.16) |
| `@fastify/jwt` | 10.2.5 |
| `pg` | 8.23.1 |
| `ulid` | 3.0.2 |
| `vitest` | 4.1.12 (5.x exists; MQ9) |
| `eslint` / `typescript-eslint` | 10.13.0 / 8.72.0, flat config `eslint.config.js` |
| `tsx` (dev, CLIs) | 4.23.15 |
| `qrcode` (hub: CLI M72, `lib/qr.ts` M77) | 1.5.4 (npm registry 2026-10-23) |

---

## §8. Client contract

### 8.1 Capacitor app (tablets)

- **Transport:** the hub is plain HTTP/WS on the LAN (foundation §1). Capacitor 6+ serves the app from an `https://localhost` origin by default, which would make every hub call mixed content. Requirement: `server.androidScheme: 'http'` (origin `http://localhost`, matching `cors_origins`) and an Android network security config that permits cleartext **only** to private ranges (`10/8`, `172.16/12`, `192.168/16`), not a global `usesCleartextTraffic`. To verify against current Capacitor docs during the 02 client work (source checked here: community reports only, MQ7).
- **Pairing:** scan the QR (`pair_url`), extract `t`, send `POST /devices/pair` with a new `pair_request_id` kept until success; on a lost response retry with the same id (M14).
- **Token storage:** `device_token` in Android Keystore-backed secure storage (plugin chosen in 02); `session_token` in memory only (app restart = log in again). PINs are never persisted on the device (v1.6, H-10).
- **Background service** holding the alert connection (01d §8.2); silent update from the hub (§6.36–§6.38) (v1.6, H-5).
- **Headers:** `Authorization`, `X-Session-Token`, `X-Client-Version` on every request.
- **Admin screens** in the tablet app call `/admin/*` with the tablet's device token plus `X-Admin-Session` (M42). The app approves a screen in its own admin screen (display code typed, or `r` read by an in-app scanner) and posts `ApprovePairingRequest`; it does not open `/admin/approve`, whose browser storage is not the app's (M79).

> ⚠️ Changed by 01d v1.0 (H-5, H-10): background service and hub update; PINs never persisted. See 01d §4.5.

### 8.2 Hub-served browsers (cashier kiosk, KDS, staff phones, admin)

- **No service worker, no secure-context-only APIs (README R15).** The hub origin is plain HTTP on the LAN, so service workers do not run (except on the kiosk, which Chrome/Edge launches with `--unsafely-treat-insecure-origin-as-secure=http://<hub-ip>:3000`). The client never depends on a service worker; the command queue is IndexedDB only. IDs use `crypto.getRandomValues` (available without a secure context); `crypto.randomUUID` and `crypto.subtle` are not used.
- **Kiosk and KDS pairing (M44):** the unpaired screen opens `/pair` (no `t`), calls `POST /pair/requests`, keeps `poll_secret` in memory, shows the QR (`approve_url`) and the display code, and polls `GET /pair/requests/:id` every 2 s until approved or expired (then shows "Ask a manager to pair this screen" and offers a new request). On approval it stores `device_token`, `device_id` and `device_type` in IndexedDB; KDS then calls `POST /auth/station`. On a later load with a stored token the page does not create a request: KDS calls `POST /auth/station`, others go to login; `401 DEVICE_TOKEN_INVALID` / `403 DEVICE_REVOKED` wipe the stored values and start a new request (§8.4).
- **Approving (M44, M79):** the manager scans the QR (opens `/admin/approve?r=…` in the phone browser) or opens `/admin/approve` on a hub-served admin device and types the display code. The page loads with no credentials. Its script:
  1. Reads `token` and `device_id` from IndexedDB `pos-device` (written by the pair page on every successful pair or approval poll) and `admin_session_token`, `admin_staff_id`, `admin_bootstrap` from `sessionStorage`.
  2. No device token and no bootstrap admin session → "Open this on a paired admin device and type the code there" (key `pairing.approve_needs_admin_device`); no request is sent.
  3. Device token but no admin session in this tab → admin login in the page (`GET /admin/login-roster`, PIN → `POST /admin/auth`); stores `admin_session_token` and `admin_staff_id` in `sessionStorage`.
  4. Form: display code (with `request_id` = `r` when present), type, station for KDS → `ApprovePairingRequest` with `device_id` from IndexedDB (`'hub-admin'` and no `Authorization` for a bootstrap session).
- **Bootstrap page (M42, M79):** after a successful `POST /admin/auth/bootstrap` it stores `admin_session_token`, `admin_staff_id` and `admin_bootstrap = '1'` in `sessionStorage`.
- **Phone theme (M91):** with `?t=` the pair page sets `data-theme="light"` before rendering; screens keep the served dark theme.
- **Language (M83):** the page script chooses `en` or `ur` on load (`?lang=`, then `localStorage` `pos-lang`, then `navigator.language`), sets `lang` and `dir` on `<html>`, and takes every text from `EN` or `UR` through `t()`. Codes, PINs, addresses, links, times and counts stay LTR.
- **Setup addresses (M85):** `GET /setup` renders this machine's IPv4 addresses as pick tiles (Ethernet first and preselected) plus "Other address" with the typed field; the chosen value is sent as `advertised_host`.
- **Hub admin home (M86):** `GET /admin` loads without credentials; its script signs in like `/admin/approve` step 3, keeps `permissions` (M89) with the admin session in `sessionStorage`, hides actions the admin lacks, and treats `403 PERMISSION_DENIED` as the read-only state. Kitchen screens with `last_seen_at` older than 2 minutes show a warning (Q8).
- **Global states (00-F01…F08):** every page maps §8.4 codes through one helper (`apps/hub/src/lib/global-state.ts`).
- **Look and text (M82):** every page links `/ui/tokens.css` and `/ui/components/bundle.css`, sets `lang`, `dir` and `data-theme` (`dark` on `/pair`, `light` elsewhere) on `<html>` and `class="pos-root"` on `<body>`, and shows text from the `EN` table (`errors.<CODE>` for error codes, never `message`). PIN inputs are `type="password"`, `inputmode="numeric"`. Setup: busy button, slow-call banner after 3 s, error banner per code, failing field marked from `details.issues[].path`, success screen with the first-admin QR and link. Bootstrap: admin roster as name tiles (locked ones disabled with the time left), success screen linking `/admin/approve` in the same tab. Phone pairing: a device-name field (1–40 characters) replaces `window.prompt`.
- **Admin session hygiene (M43):** before any same-tab navigation to `/pair` or a `pair_url`, the admin UI calls `POST /admin/auth/logout` and clears `sessionStorage`. `admin_session_token` lives in `sessionStorage` only.
- **First admin (M42):** the setup page shows `first_admin_url` as a link and QR; `/admin/bootstrap` reads the token from `location.hash`, sends it only in the request body / `X-Admin-Bootstrap` header, then removes it from the address bar (`history.replaceState`).
- **Phones (M38):** the manager generates a `phone` token for the staff member in the admin UI on a paired admin device; the staff member scans the QR with the phone camera, which opens `pair_url` in the phone browser; the hub-served pair page asks for a device name and calls `POST /devices/pair`. The roster shows only the owner, so login is PIN only. The device token is in IndexedDB. Browsers may clear site storage of rarely used origins (Safari: script-written storage after 7 days without use); home-screen web apps are reportedly exempt (MQ10).
- **Pair page rules (phones):**
  1. **Already paired** (a device token exists in this context's storage) → ignore `t` and go to the login screen. This matters because the home-screen app always starts on the saved `pair_url`.
  2. **iOS Safari, not standalone** (iOS user agent and `navigator.standalone !== true`) → **do not call `POST /devices/pair`.** Show "Add to Home Screen, then open it from there" with the Share → Add to Home Screen steps (key `pairing.ios_add_to_home`). Leave the URL untouched, including `?t=<pairing_token>`, so the saved home-screen app opens on `pair_url`.
  3. **iOS standalone** (`navigator.standalone === true`) or **any other phone browser** → ask for a device name, then call `POST /devices/pair` as usual (new `pair_request_id`, retried with the same id on a lost response, M14).
  4. **`401 PAIRING_TOKEN_INVALID`** (the 10-minute token expired before the app was opened, or it was already used) → "Ask a manager for a new QR" (key `pairing.token_expired`). A new QR on iOS means adding a new home-screen icon; the old icon can be deleted.
- Pairing inside the standalone context works whether or not iOS shares storage between Safari and the home-screen app: the token is stored where it is used. Safari itself never holds a device token on iOS.
- **Fallback, all phones:** a phone whose storage was cleared has no token; the app (which reopens on the old `pair_url`) hits rule 4 and shows "Pair this phone again — ask a manager for a new QR". Re-pairing creates a new device row; the old one stays until a manager revokes it or the owner leaves.

### 8.3 Login flow (tablet, kiosk, phone)

1. `GET /queries/staff-roster` → name grid (locked names greyed with time left).
2. Pick name → PIN pad → `POST /auth/pin`.
3. (tablet, kiosk) `409 DEVICE_SESSION_ACTIVE` with `can_take_over` → dialog "Bilal is logged in — log him out?" (key `auth.takeover.confirm`) → retry with `takeover: true`.
4. Success → `GET /queries/session` for permissions; hide actions whose grant is `not_granted` / `denied`; show "needs approval" for `requires_approval`.
5. Open `/ws`, send `auth` as the first frame.


### 8.4 Error handling

| Code | Client behaviour |
|---|---|
| `SESSION_EXPIRED`, `SESSION_INVALID`, WS close `4401` (any reason except below) | go to login; keep unsent drafts (BUILDING) on the device |
| `DEVICE_TOKEN_INVALID`, `DEVICE_REVOKED`, WS `4403` (non-guest) | wipe `device_token`; show "This device must be paired again" |
| `GUEST_NETWORK_FORBIDDEN`, WS `4403` (before auth) | "Connect to the staff WiFi" |
| `CLIENT_UPGRADE_REQUIRED`, WS `4426` | blocking "Update the app" screen |
| `PIN_INVALID` | shake PIN pad; show `attempts_remaining` when ≤ 2 |
| `PIN_LOCKED_OUT`, `DEVICE_LOCKED_OUT`, `IP_LOCKED_OUT` | show time left from `retry_after_ms` |
| `SERVICE_UNAVAILABLE` | retry once after `retry_after_ms`, then show "Hub busy, try again" |
| `HUB_NOT_PROVISIONED` | "Hub is being set up" |
| WS `1012` or drop | reconnect with backoff (max 5 s, §5.4); re-send `auth` |
| WS `4401` with reason `replaced` on a KDS | stop; show "This screen is open in another window" (key `kds.replaced`); do **not** call `/auth/station` (M53). A "Use this window" button calls it once on purpose |
| WS `4401` after `DeviceTokenRotated` | the device has a newer token elsewhere: show "Pair this device again" |
| `HOST_NOT_ALLOWED` | "Open the hub by its address" (installer error) |
| `STATION_LOGOUT_NOT_ALLOWED` | hide the logout button on KDS |
| `PAIRING_REQUEST_NOT_FOUND` (poll) | request expired: offer a new request |


All text through `errors.<code>` / `auth.*` / `kds.*` / `pairing.*` translation keys (D12).

### 8.5 Command queue replay (M19)

On reconnect the device resends every unacknowledged command with its original `command_id`, even when its session has ended. A `200` with `Idempotent-Replay: true` means the command had been committed: remove it from the queue. A `401 SESSION_*` means it was never processed: keep it and apply 02's policy (open item, M19). A `400 VALIDATION_FAILED` on a resend with issue `command_id already used` is a client bug: log it, keep the command, do not retry automatically.

**PIN-bearing commands are online-only (v1.6, 01d H-10).** A command whose payload carries a PIN (`AnswerRequest` with `method: 'pin'` or `'in_person'`) is never written to the device command queue (Android SQLite, cashier IndexedDB, foundation §1 / D56); the client sends it only while connected, holds the PIN in memory until the response arrives, and on a network error shows "No connection to the hub — try again" and discards the PIN.

> ⚠️ Changed by 01d v1.0 (H-10). See 01d §4.5.

---

## §9. Error catalogue additions

Appended to foundation §6.2 and `errors.ts` when this spec is approved.

| Code | Status | `details` | Returned when |
|---|---|---|---|
| `PIN_INVALID` | 401 | `{ attempts_remaining }` | PIN mismatch (§3.5) |
| `LOGIN_INVALID` | 401 | `{}` | cloud login failure (M64) |
| `REFRESH_TOKEN_INVALID` | 401 | `{}` | §6.23 |
| `DEVICE_TYPE_NOT_ALLOWED` | 403 | `{ device_type, allowed }` | session kind or pairing type does not fit the device |
| `DEVICE_NOT_OWNED` | 403 | `{ device_id }` | non-owner login on a phone (M38, M42) |
| `HOST_NOT_ALLOWED` | 403 | `{}` | Host header not allowed (M45) |
| `STATION_LOGOUT_NOT_ALLOWED` | 403 | `{}` | `/auth/logout` with a station session (M55 e) |
| `STAFF_NOT_FOUND` | 404 | `{ staff_id }` | not in the hub directory |
| `STATION_NOT_FOUND` | 404 | `{ station_id }` | station validator rejects |
| `DEVICE_NOT_FOUND` | 404 | `{ device_id }` | `RevokeDevice` target missing |
| `SESSION_NOT_FOUND` | 404 | `{ session_id }` | `ForceLogoutSession` target missing |
| `PAIRING_REQUEST_NOT_FOUND` | 404 | `{}` | §6.31, §6.32 (M44) |
| `DEVICE_SESSION_ACTIVE` | 409 | `{ staff_id, display_name, can_take_over }` | M6, M20 |
| `HUB_NOT_PROVISIONED` | 409 | `{}` | before provisioning |
| `SETUP_IN_PROGRESS` | 409 | `{}` | concurrent setup |
| `REGISTRATION_CODE_KIND_UNSUPPORTED` | 422 | `{ kind, accepted_kinds }` | §6.5 |
| `IP_LOCKED_OUT` | 429 | `{ retry_after_ms }` | bootstrap PIN path (M42); cloud per-IP login limit (M64); per-IP pairing-request cap (M76) |
| `LOGIN_LOCKED_OUT` | 429 | `{ retry_after_ms }` | reserved; not returned by login since M73 (kept in the catalogue so the code is never reused) |

**Extended `details` (additive):** `PERMISSION_DENIED { permission, grant?, session_kind? }`; `PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT { retry_after_ms }`; `SERVICE_UNAVAILABLE { retry_after_ms }`.

**Status-map note:** the hub returns `503 SERVICE_UNAVAILABLE` for setup (cloud unreachable), the argon2 semaphores (M23) and a full pairing-request queue (§6.30). Foundation §6.2 calls 503 cloud-only; none of these is on the order or payment path.

---

## §10. Tests

Conventions per foundation §6.7: hub integration tests in `apps/hub/test/**/*.int.test.ts` on a temp SQLite file through `inject()`; cloud in `apps/cloud/test/**/*.int.test.ts` on PostgreSQL 16. Test names cite `[00 §10 #n]`. Argon2 in tests uses the M8 minimum params (precomputed hashes keep the suite fast). Tests 1–84 keep their v0.5 numbers: §10.1 lists the unchanged ones, §10.2 the ones changed in v0.6, §10.3 the new ones (85–126 from v0.6, 127–130 from v1.0, 131 from v1.0.1, 132–134 from v1.1; #109 rewritten in v1.0; #53 corrected in v1.1).

### 10.1 Unchanged tests (from v0.5)

| # | Where | Case |
|---|---|---|
| 1 | §6.1 | no-op test command: happy path writes 1 event + 1 `processed_commands` row with `device_id` |
| 2 | §6.1 | retransmit same `command_id`, same device, valid session → identical body, `Idempotent-Replay: true`, no new rows |
| 3 | §6.1 | retransmit after the session ended → stored response replayed (M19) |
| 4 | §6.1 | retransmit from another device → `400 VALIDATION_FAILED`, nothing replayed |
| 5 | §6.1 | new `command_id` after the session ended → `401 SESSION_EXPIRED` |
| 6 | §6.1 | `:name` ≠ `command_type` → 400; unknown name → 404 `ROUTE_NOT_FOUND` |
| 7 | §6.1 | `branch_id` ≠ config → 403 `BRANCH_MISMATCH` |
| 8 | §6.1 | body `actor_id` ≠ session staff → 400 |
| 9 | §6.1 | grant `not_granted` → 403; `denied` overriding an `allowed` role → 403; `requires_approval` on a non-approvable command → 403; on an approvable one → handler sees approver roles |
| 10 | §6.1 | station session on a non-`stationScoped` command → 403 `{ session_kind: 'station' }`; on a `stationScoped` test command → 200 with `actor_id null` |
| 11 | §6.1 | handler throws `DomainError` → error envelope, no rows, retransmit evaluated again |
| 12 | §6.1 | forced COMMIT failure → state unchanged, nothing published (D45) |
| 14 | §6.3 | `/health` in setup, booting and ready states; no guest-network guard |
| 16 | §6.4 | after provisioning → 404 |
| 17 | §6.4 | concurrent second call → 409 `SETUP_IN_PROGRESS` |
| 18 | §6.4 | cloud unreachable → 503; cloud 401 / 422 passed through |
| 20 | §6.4 | crash after commit before config write; retry → same `setup_attempt_id` sent, no second `HubProvisioned` |
| 21 | §6.4 | other routes before provisioning → 409 `HUB_NOT_PROVISIONED` |
| 23 | §6.5 | same `Idempotency-Key` within 1 h → new key, previous revoked |
| 24 | §6.5 | other key after consumption, expired code, unknown code → identical 401 |
| 25 | §6.5 | `replace_hub` code with `accepted_kinds ['new_branch']` → 422 and the code stays unconsumed |
| 29 | §6.8 | happy path; expired token → 401; used token by another request → 401; `device_type` mismatch → 403 |
| 31 | §6.9 | happy path; wrong PIN → 401 with `attempts_remaining`; 5th failure → `StaffPinLockedOut`, next correct PIN → 429 |
| 32 | §6.9 | 10 failures from one device across staff → `DEVICE_LOCKED_OUT` |
| 33 | §6.9 | same staff again → previous session ended `replaced` |
| 34 | §6.9 | other staff without takeover → 409 with holder and `can_take_over: true`; nothing written |
| 35 | §6.9 | other staff with `takeover: true` → holder `SessionEnded { reason: 'taken_over', ended_by }` |
| 36 | §6.9 | kds device → 403 `DEVICE_TYPE_NOT_ALLOWED`; guest-network IP → 403; old client version → 426; bad Host → `403 HOST_NOT_ALLOWED` |
| 37 | §6.9 | semaphore full for 2 s → 503 with `retry_after_ms` |
| 39 | §6.11 | happy path; second call replaces; tablet → 403 |
| 40 | §6.12 | admin logout; repeat idempotent |
| 42 | §6.14 | revoke ends the staff session and bound admin sessions, publishes `DeviceRevoked`, closes socket `4403`; retransmit same `command_id` → identical response; new command on a revoked device → `already_revoked`; unknown → 404; no `manage-devices` → 403 |
| 43 | §6.15 | force logout of staff, station and admin sessions; event has `ended_by`; retransmit → identical response; new command on an ended session → `already_ended`; unknown → 404; no `manage-staff` → 403 |
| 44 | §6.16 | clear staff, device and ip locks; retransmit → identical response; unlocked subject → `cleared: false`, no event; no `manage-staff` → 403 |
| 45 | §6.17–§6.18 | lists, fixed query count (statement counter = 1) with 1 and 20 devices |
| 46 | §6.19 | roster with active session and locks; 2 statements with 1 and 30 staff |
| 47 | §6.20 | staff permissions map equals `resolve` for every catalogue entry; station → `{}` |
| 48 | §6.21 | no frame of any kind before auth: connect, wait 5.1 s, assert zero frames received and close `4401` |
| 49 | §6.21 | first frame not `auth`, bad device, bad session, admin session → close `4401` with zero frames; revoked device → `4403` |
| 50 | §6.21 | tokens in query string ignored (connection still requires the auth frame) |
| 52 | §6.21 | `SessionEnded` delivered then close `4401`; idle socket without pong terminated at 30 s; an open socket with pongs only does not keep the session past its TTL |
| 53 | §6.22 | login happy path; wrong password and unknown email both 401 with similar timing (within 2×); the 10th failure sets `login_locked_until` and still answers `401 LOGIN_INVALID` (M73; v1.1 corrects "→ 429") |
| 55 | §6.24 | logout revokes own token; another user's token → `revoked: false`, still valid |
| 56 | §6.26 | seed creates roles per table, owner can log in to cloud and (after setup) to hub admin; duplicate email refused |
| 58 | — | Two concurrent retransmits of one new command: exactly one set of events; both get the same body (D32 re-check) |
| 59 | — | Parallel wrong PINs crossing the threshold while a correct PIN is verifying: correct PIN gets 429 (§3.5 step 7) |
| 61 | — | Two `/v1/hubs/register` with one code and different keys: one 200, one 401 |
| 62 | — | `events` UPDATE and DELETE raise (D52 triggers) |
| 63 | — | `seq` gap-free across 1 000 commands with forced rollbacks in between |
| 64 | — | Migrations: checksum change of an applied file → boot refuses; pre-migration backup is encrypted, decrypts to a DB with the old `user_version` |
| 65 | — | `encryptFile` / `decryptFile` round trip; a flipped byte fails the tag and writes no output |
| 66 | — | Clock guard: `Date.now()` ≤ max `recorded_at` → `ClockAlarm`, `branchNow` starts at max + 1 |
| 67 | — | Projection rebuild: checkpoint behind `MAX(seq)` → `reset` + replay gives the same rows as live application |
| 68 | — | Boot reconciliation: `SessionStarted` without `SessionEnded` and empty `staff_sessions` → `SessionEnded 'hub_restored'` |
| 69 | — | Sweeper ends idle staff and admin sessions at `ttl + ≤15 s`, never station sessions; multi-role TTL = max (M11) |
| 71 | — | `HubStarted` carries `hub_down_at` from `hub_heartbeat`; null on first boot |
| 72 | — | Hub route inventory: every route has its guard set; adding an unguarded test route fails the test |
| 73 | — | Log redaction: no secret used by the auth suites appears in captured logs |
| 74 | — | Permission catalogue: a command declaring an unknown permission fails the unit test |
| 75 | — | `TenantScopedRepository` and `TenantLevelRepository` without a `TenantContext` throw (M25) |
| 76 | — | Cloud route inventory covers every route, including tenant-level ones (M25) |
| 77 | — | Cross-tenant: two seeded tenants; every scoped route with tenant A's JWT returns no tenant B row (M25) |
| 78 | — | Unit: `resolve()` truth table over denial / allowed / requires_approval / none, with multiple roles and multiple approvers |
| 79 | — | Smoke on target hardware: §7.8 targets |
| 80 | — | Phone pairing: `GenerateDevicePairingToken` for `phone` without `owner_staff_id` → 400; unknown owner → 404; pair → device has `owner_staff_id` (M38) |
| 81 | — | Phone login: owner → 200; another staff member with a correct PIN → `403 DEVICE_NOT_OWNED`, no PIN verified, no counter change, no takeover offered |
| 82 | — | Phone roster lists only the owner |
| 83 | — | `applyStaffDirectory` removing the owner revokes their phones in the same transaction (`DeviceRevoked { cause: 'owner_removed' }`, `actor_id` null), ends the phone session, closes its socket `4403`; other devices untouched |
| 84 | — | Pairing a phone whose owner was removed after the token was generated → `401 PAIRING_TOKEN_INVALID` |

### 10.2 Changed tests

| # | Case |
|---|---|
| 13 | A query makes no writes; it refreshes activity only when it declares `countsAsActivity: true` (M59) |
| 15 | Setup happy path against a stub cloud: directory applied, `HubProvisioned` without `setup_attempt_id` (M71), `AdminBootstrapTokenIssued`, config has key + `backup_encryption_key`, response has `first_admin_url`, exit(0) requested |
| 19 | Cloud returns one weak `pin_hash`: that staff row is skipped and listed in `skipped`, the rest applies, setup succeeds (M52) |
| 22 | Register happy path: code consumed, branch still `pending_hub`, `hub_confirmed_at` null, one live key, directory has this branch's staff only (M41) |
| 26 | `/admin/auth` on a paired tablet: happy path, session bound to the tablet; staff without `access-hub-admin` → 403 and staff counter reset |
| 27 | Device counter on `/admin/auth`: 10 failures from one device across staff → `DEVICE_LOCKED_OUT` |
| 28 | `GenerateDevicePairingToken`: tablet ok; `kds` or `cashier_kiosk` → 400; no `manage-devices` → 403; retransmit → same token |
| 30 | Retry with same `pair_request_id` → new token works, old token → 401, one `DevicePaired`, one `DeviceTokenRotated` (M60) |
| 38 | Logout; repeat → `already_ended: true`, one event; station session → `403 STATION_LOGOUT_NOT_ALLOWED` |
| 41 | Login roster: with a tablet token lists only `access-hub-admin` holders with lock time; with a live bootstrap header the same; with neither → 401 |
| 51 | Catch-up `as_of_seq` then events strictly ascending; after a boot `ClockAlarm`, a new socket's catch-up has `hub.clock_alarm` set |
| 54 | Refresh rotates; the same rotated token within 30 s → the same successor, nothing revoked; two concurrent refreshes → both 200 with the same successor; the rotated token after 30 s → 401 and every live token of the user revoked (M49) |
| 57 | New branch + code: staff holding `access-hub-admin` (Owner and Manager) assigned; every owner's `allowed_branch_ids` contains the branch; reissue for an unconfirmed branch expires the old code; reissue after confirm refused (M41, M57) |
| 60 | Two `/auth/pin` for different staff on one device at once: exactly one 200 and one `409 DEVICE_SESSION_ACTIVE`, one active session row (outcome only) |
| 70 | Removing a staff member ends their staff and admin sessions `'staff_removed'`; a permission change applies to the next command (resolved in the transaction) |

### 10.3 New tests

| # | Case |
|---|---|
| 85 | M39: a command passes the guard; `RevokeDevice` commits before the command's transaction starts (test hook between guard and `writer.run`) → command rejected `403 DEVICE_REVOKED`, no events |
| 86 | M39: same with `ForceLogoutSession` → `401 SESSION_EXPIRED`; same with a directory apply removing the permission → `403 PERMISSION_DENIED` |
| 87 | M40 restore: copy the DB (backup) → revoke a device, force-logout a session, pair a tablet with a token issued before the copy → take the copy, append the tail events, boot → revoked token `403 DEVICE_REVOKED`, ended session `401 SESSION_EXPIRED`, the pairing token stays consumed, the tablet paired after the copy gets `401 DEVICE_TOKEN_INVALID` |
| 88 | M40/M48: a `SessionStarted` in the tail with no row and no `SessionEnded` → `SessionEnded 'hub_restored'` after boot; cloud-only restore (empty `staff_sessions`, session events present) runs step 4b; a normal boot does not |
| 89 | M41: register, then no confirm; after 1 h the same code → 401; reissue for the unconfirmed branch → new code → register works |
| 90 | `/v1/hubs/confirm`: sets `active` + `hub_confirmed_at`; repeat returns the same value; bad key → 401; hub confirm task writes `confirmed_at` and stops; retries after a 503 |
| 91 | M42: `/admin/auth` without a device token → 401; kds → 403; phone with another staff member → `403 DEVICE_NOT_OWNED`; phone owner → 200; an admin session used with another device's token → `401 ADMIN_SESSION_REQUIRED` |
| 92 | M42 bootstrap: link opens one admin session without a device; second use → 401; after 30 min → 401; 10 wrong PINs from one IP → `429 IP_LOCKED_OUT` |
| 93 | M42/M23: the PIN semaphore full does not delay `/admin/auth`, and the admin semaphore full does not delay `/auth/pin` |
| 94 | M43: the admin UI and pair page scripts call `/admin/auth/logout` and clear `sessionStorage` before navigating to `/pair` (static check of served HTML); after that call the admin token → 401 |
| 95 | M44 `/pair/requests`: create → poll pending → approve → poll returns the token (twice) → after `expires_at` → 404 and `delivery_token` cleared; wrong poll secret → 404; 11th pending request → 503 |
| 96 | M44 `ApprovePairingRequest`: kds with station → device with `station_id`, `DevicePaired { pairing_request_id }`; wrong display code → 404; approved twice → 404; unknown station → 404; no `manage-devices` → 403; result never contains the token |
| 97 | M45: Host `evil.example:3000` → 403 `HOST_NOT_ALLOWED` on `/health`, `/admin/auth`, `/devices/pair`, `/pair/requests`, and WS close `4403`; `localhost:3000` and `<advertised_host>:3000` pass; setup mode accepts the host's own address |
| 98 | M46: at TTL + 1 s, before any sweep, a command → `401 SESSION_EXPIRED` and the row is ended `'idle_timeout'`; another staff member's login on that device → 200 (no 409) |
| 99 | M47: same `command_id` with another `command_type` → 400; with another payload → 400; body `device_id` ≠ token → 400; admin replay from another admin session → 400; same admin session → replay |
| 100 | M48: on a 1 M-event fixture, 00's boot steps finish within §7.8; 3a uses the max-seq row; a projection that saw no events in the last 10 000 is not replayed |
| 101 | M50: a directory with a changed `pin_hash` ends that staff member's staff and admin sessions `'credentials_changed'`; others untouched |
| 102 | M51: version equal → no-op, no event; older → no-op; newer → applied |
| 103 | M52: weak hash row, unknown role in an assignment, unknown permission, unknown approver → each skipped and listed; everything else applied; removal of another staff member in the same push still happens |
| 104 | M53: second `/auth/station` → first socket gets `SessionEnded { reason: 'replaced' }` then close `4401` with reason `replaced` |
| 105 | M58: setup with `guest_network_cidrs: []` → 400; `advertised_host` not on this host → 400; malformed code → 400 |
| 106 | M61: remove `access-hub-admin` from a manager with an open admin session → next admin query → 403 |
| 107 | M62: after a staff lock expires, one wrong PIN → `attempts_remaining: 4` |
| 108 | M63: `/health` from a guest IP → `{ status }` only; from a staff IP → full body |
| 109 | M73 (rewritten in v1.0): a locked account gives **identical** responses (status, body except `request_id`) for the right and a wrong password, both `401 LOGIN_INVALID`; the real hash is not verified (spy) and the account counter does not change; 30 failures from one IP → `429 IP_LOCKED_OUT`; 10 concurrent failures on an unlocked account → count 10 |
| 110 | M70: command `tenant_id` ≠ config → 403 `BRANCH_MISMATCH` |
| 111 | M67: a leftover `pre-migrate-*.sqlite` in `data_dir` is deleted at boot |
| 112 | §6.21 publish filter: a socket registered between COMMIT and publish (test hook) receives the event once (in catch-up), not again as a push |
| 113 | M55/M56: lint fails when a file other than the two plugins imports `credential-lookup`, or a file outside `cli/` imports `SystemContext`; a test enumerates importers and asserts the allowlists |
| 114 | `404 STAFF_NOT_FOUND` on `/auth/pin` and `/admin/auth`; `429 PIN_LOCKED_OUT` on `/admin/auth` |
| 115 | `401 ADMIN_SESSION_REQUIRED`: missing, unknown, ended, and staff-kind token on `/admin/queries/devices` |
| 116 | `401 DEVICE_TOKEN_INVALID` and `403 DEVICE_REVOKED` on `/commands/*`, `/queries/*`, `/auth/pin`, `/admin/auth` |
| 117 | `401 SESSION_INVALID` for a session of another device on `/auth/logout` and `/commands/*`; on queries, ended → `SESSION_EXPIRED`, unknown → `SESSION_INVALID` |
| 118 | `/devices/pair`: old client → 426; guest IP → 403; rotation 10 min + 1 s after consumption → 401; rotation for a revoked device → 401 |
| 119 | `GUEST_NETWORK_FORBIDDEN` on `/admin/auth`, `/admin/queries/devices`, `/pair/requests`, and WS close `4403` before auth |
| 120 | M35 CORS: allowed origin gets headers and preflight on device routes and `/pair/*`; other origins none; `/admin/*` and `/setup` never |
| 121 | M66 retention: runs only in `maintenance_hour`; deletes in batches of 500 with other commands committing between batches; D32 7-day prune of `processed_commands` |
| 122 | §3.10 atomic config write: mode `0600`, no `.tmp` left, a crash before rename leaves the old file intact |
| 123 | M33: an expired refresh token → 401; a successful login resets the failure counter |
| 124 | Pre-migration backup falls back to `data_dir` when `backup_dir` is missing; both unwritable → migrations do not run |
| 125 | `/v1/health`: 200 `{ status: 'ok', db: 'ok' }`; DB down → 503 |
| 126 | M69: login deletes that user's refresh tokens expired more than 7 days; other users' rows untouched |
| 127 | M72: after the setup bootstrap token expires, `issue-admin-bootstrap` prints a new link; the new link opens an admin session; the old link → `401 PAIRING_TOKEN_INVALID`; a live token is expired by a second CLI run; `AdminBootstrapTokenIssued { issued_by: 'cli' }` is written; the CLI works while the hub process holds the database open |
| 128 | M74: a live `/devices/pair` rotation leaves the new `token_hash` in place (the new token works after the commit and after `access_reconcile` ran live); the same event replayed in boot catch-up sets `'rotated:<event_id>'` |
| 129 | M75: a directory push with a malformed hash for an existing staff member keeps their old row (old PIN still logs in), ends none of their sessions, revokes none of their phones, and lists the skip; for a new staff member the row is absent |
| 131 | M77: the §6.4, §6.7 and §6.30 responses carry an SVG (`<svg` … `</svg>`, no `<script>`) equal to `qrSvg(url)` for their URL; `qrSvg` is deterministic and builds the matrix with `QRCode.create(url, { errorCorrectionLevel: 'M' })` (same module count and dark modules as the library's own `toString(…, { type: 'svg' })` for that URL); a lint scratch import of `qrcode` outside the two allowed files fails |
| 132 | M78: setup writes the register response's `branch_name` to `provisioned.branch_name`; `POST /devices/pair`, the approved `GET /pair/requests/:id` and the WS `catch_up.state.hub.branch_name` return it |
| 133 | M79: `GET /admin/approve` and `GET /admin/bootstrap` without `Authorization` or `X-Admin-Session` → `200` HTML with no device or session token in the body; a guest IP → 403; `ApprovePairingRequest` without `request_id` approves the single pending request with that `display_code`; no match, or two pending requests with the same code → `404 PAIRING_REQUEST_NOT_FOUND`; static check: the approve page reads IndexedDB and `sessionStorage`, logs in with `/admin/auth` when no admin session is stored, and sends no request when neither a device token nor a bootstrap session exists |
| 134 | M80: a token-paired tablet still reports `pairing_source: 'token'` after its `pairing_tokens` row is deleted by retention; an approved kds reports `'request'` |
| 135 | M81: `GET /ui/tokens.css` and `/ui/components/bundle.css` → `200` `text/css; charset=utf-8`; a font → `200` `font/woff2`; all with `Cache-Control: public, max-age=31536000, immutable`; a `?v=` query is ignored; `/ui/README.md`, `/ui/tokens.json`, `/ui/../package.json`, `/ui/%2e%2e/package.json` and an unknown file → `404 ROUTE_NOT_FOUND`; served by the setup-mode server before provisioning; a guest IP → 403; a bad Host → 403; group `static` has guards host and guest |
| 136 | M82, M83: `/setup`, `/admin/bootstrap`, `/admin/approve`, `/pair` and `/admin` (M86) link both stylesheets with the M81 `?v=` hash, are served with `lang="en" dir="ltr"`, `data-theme` `dark` on `/pair` and `light` elsewhere, `class="pos-root"`, one inline `<script>`, no `http://` or `https://` asset URL, keep ids `screen` / `setup` / `login` / `roster` and class `display-code`; every key the page scripts look up exists in `EN`, and every `UR` key exists in `EN`; every PIN input is `type="password"` with `inputmode="numeric"` |
| 137 | M82, M85 setup page: the address tiles list the given interfaces' IPv4 addresses (internal and `169.254.*` removed, Ethernet first and selected) and "Other address" reveals the typed field; submit → the button is busy and disabled; after 3 s the `setup.slow` banner shows; `400 VALIDATION_FAILED` with an `advertised_host` issue → that field is marked and the banner shows `errors.VALIDATION_FAILED`; `503` → `errors.SERVICE_UNAVAILABLE`; the button is usable again after an error; success → the first-admin link and QR |
| 138 | M82 bootstrap page: the roster renders one name tile per admin (a locked one is disabled and shows the time left); no `staff_id` text input and no JSON on the page; a tap selects the tile; sign-in sends the selected `staff_id`; `PIN_INVALID` shows the error and the attempts left when ≤ 2; success shows the signed-in screen with a link to `/admin/approve`; a dead link shows the expired screen |
| 139 | M82 phone pairing (`/pair?t=`): a device-name field is shown and `window.prompt` is never called; an empty name marks the field and sends nothing; a name sends `POST /devices/pair` with it; `401` shows `pairing.token_expired` |
| 140 | M83: language choice: `?lang=ur` → `lang="ur" dir="rtl"` and Urdu text, remembered on the next load without the parameter; `navigator.language` `ur-PK` → Urdu; `en-US` → English; a key missing from `UR` shows the `EN` text |
| 141 | M84: after provisioning `GET /setup` → `404` HTML with `setup.already_title` and no form, no `tenant_id` / `branch_id`; before provisioning → `200` form |
| 142 | M86: `GET /admin` without credentials → `200` HTML with no token; a guest IP → 403; group guards as `/admin/approve`; static check: the script signs in through `/admin/auth` when no admin session is stored and calls only §6.7, §6.14–§6.18c |
| 143 | M87: devices query with `include_revoked=true` returns `revoked_reason` (from the latest `DeviceRevoked`), `revoked_by_name`, and `owner_name` for phones; without it the query runs once; a revoke with no reason → `revoked_reason: null` |
| 144 | M88 lockouts: a locked staff, device and IP are listed with names; an expired lock and an unlocked row are not; no `access-hub-admin` → 403 |
| 145 | M88 stations: archived stations left out; `category_names` holds at most 3, in category order, only categories with an item on the station; no config → empty list |
| 146 | M88 staff: every directory staff member with role names; `phone_count` counts only non-revoked phones; one query |
| 147 | M89: `/admin/auth` and `/admin/auth/bootstrap` return `permissions` matching the effective permissions (a Manager has both, an admin without `manage-staff` gets `false`) |
| 148 | M92: `GET /admin/login-roster` rows carry `role_names` from the directory (Owner → `['Owner']`) |
| 149 | M92: the approved `GET /pair/requests/:id` for a kds carries `station_name` from the branch config; a cashier screen gets `null` |
| 150 | M92: `POST /devices/pair` for a phone returns `owner_name` of the owner |
| 151 | M91: `/pair?t=` sets `data-theme="light"` in the page script; `/pair` without `t` keeps the served dark theme; the paired phone shows the owner's name and a kds shows its station name |
| 130 | M76: a third pending request from one IP → `429 IP_LOCKED_OUT` with `retry_after_ms` until its oldest expires; requests from other IPs still succeed; the 11th pending overall → 503 |


### 10.4 Acceptance table (corrected)

| Story AC | Test(s) |
|---|---|
| E0 PIN AC2 | 31, 15 |
| E0 PIN AC3 | 1, 8, 10 |
| E0 PIN AC4 (idle logout) | 69, 98, 13, 52 |
| E0 PIN AC5 | 43 |
| E0 PIN AC6 | 31, 32, 27, 44, 59, 107, 114 |
| E0 PIN AC7 | 15, 19, 70, 101, 103 |
| E0 PIN edge: shared device | 33, 34, 35, 60, 98 |
| E0 PIN edge: guest WiFi | 36, 119 |
| E0 Hardware AC3 | 26, 28, 29, 30, 42, 80, 82, 95, 96, 133, 134 |
| E6 roles AC3, AC4 | 9, 47, 78, 86 |
| E6 roles AC6 | 56 |
| E5 power loss AC2–4, 9, 10 | 14, 15, 64, 67, 71, 79, 100, 111, 124 |
| E5 device resilience AC3 | 3, 58, 99 |
| E0 backups (restore safety) | 87, 88 |
| D38 setup protected, then 404 | 15, 16, 24, 89, 92 |
| D48 clock guard | 66, 51 |
| D51 lock release input | 35, 38, 42, 43, 68, 69, 70, 85, 86, 88, 98, 101 |
| D54 tenant scoping | 75, 76, 77, 113 |
| M21 encrypted backups | 64, 65, 111 |
| README R14 phones | 80–84, 91 |
| Review 1 security fixes | 85, 86, 91, 92, 93, 94, 97, 99, 106, 108, 109 |
| Review 2 fixes (N1, N2, A, C, D) | 127, 109, 128, 129, 130 |
| M77 QR codes | 131 |
| Build review 1 fixes (v1.1) | 132, 133, 134 |

---

## §11. Build order

The executable task list is `docs/plans/00-plan.md` (regenerated for v1.0). Build order, by section:

| Plan tasks | Work | Spec |
|---|---|---|
| 1–5 | Monorepo, `@pos/domain` (all §9 codes are created here, once), `@pos/events` (all §4.2 events, `DirectorySchema`) | §7.11, §9, §4.2 |
| 5b, 5c | Bring already-built tasks 1–5 to v0.6 and v1.0 | §9, §4.2, M72 |
| 6–17 | Hub lib (clock, ids, canonical hash, semaphores, host matcher, crypto-file), config, DB, migrations + encrypted backup, event store, projections (forward catch-up, M48), writer (`authGeneration`, M39), server, schema | §3.7, §3.8, §5.1, §7 |
| 18–26b | Directory (M50–M52), guards (host, idle, admin re-resolve), command and query routes (M47, M59, M39), boot, access reconciliation (M40), health (M63), 1 M-event boot budget | §3.4–§3.9, §6.1–§6.3 |
| 27–33b | Cloud skeleton, repositories, tenant scope + owner-credentials (M55), `SystemContext` CLIs (M56, M57), register + confirm (M41), hub setup + bootstrap token, hub confirm task | §5.2, §6.4, §6.5, §6.26–§6.28 |
| 34–46 | PIN + lockouts (M62), admin auth + bootstrap (M42) + recovery CLI (35c, M72), pairing token, pair (M60), pairing requests + approve (M44), staff/station sessions, sweeper + retention (M66), admin commands, queries, WS (publish filter), CORS + redaction | §6.6–§6.21, §6.29–§6.32 |
| 47–50 | Owner login (M64), refresh (M49), health + cross-tenant, systemd + smoke | §6.22–§6.25, §7.8 |
| 51 | Foundation §6.2 table and README only (codes already exist from task 2) — not for Cursor | §9, D64 |
| 67–71 | v1.2: UI kit and `GET /ui/*` (M81); setup, bootstrap, approve and pair pages on the kit with the `EN` table (M82) | §6.35, §8.2, §8.4 |
| 82 | v1.4: M91 phone theme, M92 names in three responses | §6.8, §6.13, §6.31, §8.2 |
| 77+ | v1.3: design hand-off phases 3–6 (`docs/design/handoff/00/PLAN.md`): pages restyled with `UR` (M83–M85), §6.17 fields and §6.18a–c queries, sign-in `permissions` (M87–M89), `/admin` (M86) | §6.17–§6.18c, §6.6, §6.29, §8.2 |

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done

- Every §10 test exists with its `[00 §10 #n]` name and passes; `grep` finds exactly one test per number.
- Hub and cloud route-inventory tests and the cross-tenant test pass.
- §7.8 targets met on the pilot hub hardware (or the gap recorded in `docs/reviews/`).
- No secret appears in logs (test 73).
- §9 codes exist in `errors.ts` (plan task 2/5b) and are appended to the foundation §6.2 table (plan task 51).
- Test #100 passes on the 1 M-event fixture; restore tests #87–88 pass.
- Review 2's blockers N1 and N2 are fixed (v1.0).
- README status updated; spec version bumped to v1.0 at approval, v1.1 after build review 1, v1.2 for the UI kit (M81, M82).

### 12.2 Endpoint checklist

| § | Route / command | Auth | Permission | Idempotency | Events | Tests |
|---|---|---|---|---|---|---|
| 6.1 | `POST /commands/:name`, `/admin/commands/:name` | device + session / device + admin | per command (in txn) | D32 + M19 + M47 | per command | 1–12, 58, 85, 86, 99, 110 |
| 6.2 | `GET /queries/:r`, `/admin/queries/:r` | device (+session) / device + admin | per query; admin re-resolve | n/a | — | 13, 106, 117 |
| 6.3 | `GET /health` | none (host guard) | — | n/a | — | 14, 97, 108 |
| 6.4 | `POST /setup/provision` | code | — | M14 | `HubProvisioned`, `StaffDirectoryApplied`, `AdminBootstrapTokenIssued` | 15–21, 105, 132 |
| 6.5 | `POST /v1/hubs/register` | code (M15) | — | M14 | — | 22–25, 61, 89 |
| 6.6 | `POST /admin/auth` | device | `access-hub-admin` | none needed | `SessionStarted`, lockouts | 26, 27, 91, 93, 114, 147 |
| 6.7 | `GenerateDevicePairingToken` | device + admin | `manage-devices` | D32 | `DevicePairingTokenGenerated` | 28, 80 |
| 6.8 | `POST /devices/pair` | pairing token | — | M14 | `DevicePaired`, `DeviceTokenRotated` | 29, 30, 84, 118, 150 |
| 6.9 | `POST /auth/pin` | device | — | M6 replace | `SessionStarted`, `SessionEnded`, lockouts | 31–37, 59, 60, 81, 98 |
| 6.10 | `POST /auth/logout` | device + session | — | natural | `SessionEnded` | 38, 117 |
| 6.11 | `POST /auth/station` | device (kds) | — | replace | `SessionStarted`, `SessionEnded` | 39, 104 |
| 6.12 | `POST /admin/auth/logout` | admin (+device) | — | natural | `SessionEnded` | 40, 94 |
| 6.13 | `GET /admin/login-roster` | device or bootstrap | — | n/a | — | 41, 148 |
| 6.14 | `RevokeDevice` | device + admin | `manage-devices` | D32 | `DeviceRevoked`, `SessionEnded` | 42 |
| 6.15 | `ForceLogoutSession` | device + admin | `manage-staff` | D32 | `SessionEnded` | 43 |
| 6.16 | `ClearPinLockout` | device + admin | `manage-staff` | D32 | `PinLockoutCleared` | 44 |
| 6.17–6.18 | admin device / session lists | device + admin | `access-hub-admin` | n/a | — | 45, 115, 134, 143 |
| 6.18a–c | admin lockouts / stations / staff (M88, not counted M90) | device + admin | `access-hub-admin` | n/a | — | 144–146 |
| 6.19–6.20 | staff roster, session | device (+session) | — | n/a | — | 46, 47, 82 |
| 6.21 | `GET /ws` | auth frame | — | n/a | pushes | 48–52, 104, 112, 119 |
| 6.22 | `POST /v1/auth/login` | none (allowlist) | — | none needed | — | 53, 109, 123, 126 |
| 6.23 | `POST /v1/auth/refresh` | none (allowlist) | — | M49 | — | 54, 123 |
| 6.24 | `POST /v1/auth/logout` | JWT | — | natural | — | 55 |
| 6.25 | `GET /v1/health` | none (allowlist) | — | n/a | — | 125 |
| 6.26 | CLI `seed-tenant` | shell + `SystemContext` | — | refuses duplicate | — | 56 |
| 6.27 | CLI `issue-registration-code` | shell + `SystemContext` | — | reissue (M22) | — | 57 |
| 6.28 | `POST /v1/hubs/confirm` | branch key | — | natural | — | 90 |
| 6.29 | `POST /admin/auth/bootstrap` | bootstrap token | `access-hub-admin` | single use | `SessionStarted`, lockouts | 92 |
| 6.30 | `POST /pair/requests` | none (host, guest) | — | none needed | — | 95, 130, 131 |
| 6.34 | Hub CLI `issue-admin-bootstrap` | shell, service user | — | expires older tokens | `AdminBootstrapTokenIssued` | 127 |
| 6.31 | `GET /pair/requests/:id` | poll secret | — | read-only | — | 95, 149 |
| 6.32 | `ApprovePairingRequest` | device + admin | `manage-devices` | D32 | `DevicePaired` | 96, 133 |
| 6.35 | `GET /ui/*` (static, not counted) | none (host, guest) | — | n/a | — | 135 |
| — | static pages `GET /setup` (M84), `/admin` (M86) | none (host, guest; `/admin` also provisioned) | — | n/a | — | 136, 141, 142 |
| 6.36 | `GET /app/android/latest` (v1.6) | device token, type `tablet` | — | read-only | — | 01d #40, #65 |
| 6.37 | `GET /app/android/<version_code>.apk` (v1.6) | device token, type `tablet` | — | read-only | — | 01d #40 |
| 6.38 | Hub CLI `app-release add` / `mark-good` (v1.6) | shell, service user | — | keeps 2 good + staged | — (CLI log) | 01d #40 |

> ⚠️ Changed by 01d v1.0 (H-5, H-11): rows 6.36–6.38; tests are 01d's. See 01d §4.5.

### 12.3 Open questions

| # | Question | Blocks |
|---|---|---|
| MQ5 | Default role TTLs: confirm with the restaurant owner. | pilot comfort |
| MQ6 | 02 device queue policy for unprocessed commands after session end (M19). | 02 spec |
| MQ7 | Capacitor LAN transport: verify `androidScheme: 'http'` + private-range cleartext against current docs. | 02 client build |
| MQ8 | 06 backup key availability for USB restore on a replacement hub (M21). | 06 spec |
| MQ9 | Vitest 5: stay on 4.x or record an upgrade. | nothing now |
| MQ10 | iOS checks on a real iPhone (saved URL keeps `?t=`, standalone flag, storage past 7 days, flow inside 10 min). | phone client work |
| MQ11 | Owner sign-off on the LAN plaintext risk and the phone SSID requirement (M54, README R16). | installation |
| MQ12 | **Closed in v1.0.1 by M77:** QR codes on hub-served pages use `qrcode@1.5.4`, rendered as SVG on the hub. | — |

### 12.4 Deferred until needed

| Item | Why deferred |
|---|---|
| Rate limit on `/v1/hubs/register` | 60-bit codes, 24 h TTL. Revisit with an HTTP issuing route (M2). |
| bcrypt verification | M8. |
| HTTP route to issue registration codes | M2. |
| Sliding-window device lockout | Fixed window is enough with the per-staff limit. |
| WS backpressure | LAN, tens of sockets. |
| Security headers / CSP on hub-served pages | LAN-only, same-origin; revisit with customer pages (P2). The Host guard (M45) covers DNS rebinding. |
| Session takeover permission | M20 / R11; owner setting later. |
| LAN TLS | M54; revisit at P3. |
| Branch rename reaching the hub (M78) | The name is display-only; 06's directory push can carry it when 01 adds rename. |
| Device-token expiry | Tokens are revocable, revoked on owner exit (M38), reconciled on restore (M40); revisit with LAN TLS (P3). |
