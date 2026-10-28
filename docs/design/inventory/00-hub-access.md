# 00 — Hub Platform & Access: screen inventory

Spec: `docs/specs/00_Hub_Platform_Access_Spec_v1.2.1.md` (APPROVED, implemented). Pages: `apps/hub/src/setup/page.ts`, `apps/hub/src/auth/admin-bootstrap.ts`, `apps/hub/src/commands/approve-pairing-request.ts`, `apps/hub/src/auth/pair-page.ts` (strings in `apps/hub/src/lib/strings.ts`). Conventions (IDs, device codes, LTR, story IDs) are in [00-index.md](00-index.md).

---

## 1. Who and where

| Who (permission, R5) | Device | Network | How often | Conditions |
|---|---|---|---|---|
| Installer (no account; holds a one-time registration code) | Laptop on the restaurant LAN (L) | Hub LAN + internet (setup calls the cloud) | Once per hub; again on hub replacement (06) | Back room, no hurry; may be on the phone with support |
| First admin (any staff with `access-hub-admin`; in practice the owner or branch manager) | Installer's laptop or a phone after scanning a QR (L, P) | Hub LAN | Once after setup; again in emergencies (hub CLI `issue-admin-bootstrap`) | Link valid 30 min, once |
| Staff with `manage-devices` (approves screens, makes phone QRs, revokes) | Paired admin device: tablet, kiosk, or own phone (T, K, P) | Hub LAN only | A few times at setup; then when a screen is replaced or a staff member joins/leaves (weekly) | Can happen mid-service (a KDS dies at lunch) |
| Staff with `manage-staff` (force logout, clear lockouts) | Same | Hub LAN | Rare; a few times a week in rush (a waiter locked out after 5 wrong PINs) | Rush: someone is waiting at the till |
| Nobody signed in — the screen itself | New cashier kiosk (K), KDS (W), tablet | Hub LAN | Once per screen | Read from across the room (code at 3 m) |
| Any staff member pairing their own phone (BYOD, R14) | Android phone or iPhone (P) | Separate phone SSID that reaches only the hub port (R16) | Once per person; again when storage is wiped | Cheap Android, older Chrome; iPhone must run as Home Screen app |

Hub-only: every screen here is served by the hub over plain HTTP (`http://<hub-ip>:3000`). Only `/setup` also needs internet (it calls the cloud). Arif Chatkhara: 3 branches, each its own hub; ~10 devices per branch (2 kiosks, 3–4 waiter tablets, 3 KDS: tandoor, karahi counter, degh; staff phones).

## 2. Jobs to be done

| # | Job | Story / spec | Acceptance criteria |
|---|---|---|---|
| J1 | As an installer, I need to connect a new hub to the restaurant's cloud account so that the branch gets its menu and staff. | F §5.6 (D38, OQ12); 00 §6.4 | Code is 12 chars (dashes/spaces/lowercase cleaned); host must be this machine's address; ≥ 1 guest CIDR; success returns `first_admin_url` (30 min) and the hub restarts by itself; `/setup` returns 404 after |
| J2 | As the first admin, I need to sign in once without a paired device so that I can approve the first screens. | 00 M42, M72; D38 | Roster of admins as tiles (locked with time left); PIN 4–6 digits masked; success says "Signed in as …" and links Approve in the same tab |
| J3 | As a staff member with `manage-devices`, I need to let a new kiosk or kitchen screen in so that it can be used. | E0-HW AC3; 00 §6.30–6.32 (M44) | Type the 6-char code or scan the screen's QR; pick type; pick a station for a kitchen screen; result shown; approving is audited |
| J4 | As a new screen, I need to show a code and QR until a manager approves me so that nobody has to type a token. | 00 §8.2 | Code readable at 3 m; refresh every 2 s; 10 min expiry then "new code"; hub unreachable is calm and self-clears |
| J5 | As a staff member, I need to pair my own phone from a QR so that I can take orders on it. | R14; 00 M38, §8.2 | Device name 1–40 chars; iOS Safari shows Add-to-Home-Screen steps and does not pair; expired QR says "Ask a manager for a new QR" |
| J6 | As a staff member with `manage-devices`, I need to create a pairing QR for one person's phone so that only they can log in on it. | R14; 00 §6.7 | QR + link valid 10 min, once; phone's roster then shows only that person; generation audited (D38) |
| J7 | As a staff member with `manage-devices`, I need to see every device and revoke one so that a lost tablet or a leaver's phone stops working. | E0-HW AC3; D38; 00 §6.14, §6.17 | List: name, type, how paired, paired by, last seen, who is logged in, revoked; revoke with optional reason ≤ 200; ends its sessions; audited |
| J8 | As a staff member with `manage-staff`, I need to log someone out of any device so that a forgotten session can't be misused. | E0-PIN AC5; 00 §6.15, §6.18 | Active sessions listed; force logout is logged |
| J9 | As a staff member with `manage-staff`, I need to clear a PIN lockout so that a locked waiter can work again in rush. | E0-PIN AC6; 00 §6.16 | Clear for a person, a device or an IP; logged |
| J10 | As anyone on any device, I need clear, calm messages when the device can't work (hub down, wrong Wi-Fi, revoked, outdated) so that I know what to do. | E0-PIN edge (guest WiFi); E5-PWR AC8; 00 §8.4 | One full-screen state or banner per code (§8.4 table) |

Also in 00 but with no screen of its own: E0-PIN AC2 (PIN checked on the hub, offline), AC3 (actor attribution), AC4 (idle auto-logout → back to login, 02-S01), E6-ROLE AC3/4 (effective permission on the hub → drives show/hide on every screen), AC6 (default role seed), E5-PWR AC2–4, 9, 10 (boot), E5-DEV AC3 (replay without session).

## 3. Screen list

| ID | Name | Kind | URL / host | Exists today |
|---|---|---|---|---|
| 00-S01 | Hub setup form | screen | `/setup` | yes (kit-styled, 00 v1.2) |
| 00-S02 | Hub is set up — first admin QR, restarting | full-screen state | `/setup` | yes |
| 00-S03 | First admin sign-in (roster + PIN) | screen | `/admin/bootstrap#t=…` | yes |
| 00-S04 | First admin link expired | full-screen state | `/admin/bootstrap` | yes |
| 00-S05 | Signed in — go to Approve | full-screen state | `/admin/bootstrap` | yes |
| 00-S06 | Approve a screen — can't approve here | full-screen state | `/admin/approve` | yes |
| 00-S07 | Approve a screen — admin sign-in | screen | `/admin/approve` | yes |
| 00-S08 | Approve a screen — form | screen | `/admin/approve[?r=]` | yes |
| 00-S09 | Approve a screen — result (approved / error, approve another) | full-screen state | `/admin/approve` | yes |
| 00-S10 | Pair this screen — asking / code + QR | full-screen state (dark) | `/pair` | yes |
| 00-S11 | Pair this screen — code expired / couldn't ask | full-screen state (dark) | `/pair` | yes |
| 00-S12 | Pair this phone — name the phone | screen | `/pair?t=` | yes |
| 00-S13 | Pair this phone — iPhone: Add to Home Screen | full-screen state | `/pair?t=` | yes |
| 00-S14 | Pair this phone — QR expired / used | full-screen state | `/pair?t=` | yes |
| 00-S15 | Paired — hand-off to login | transient state | `/pair` | yes (word "login" → 02-S01) |
| 00-S16 | Devices list | screen | hub admin (route TBD) | **no** (API only) |
| 00-D01 | Revoke device (reason) | dialog | from 00-S16 | **no** |
| 00-S17 | Add a phone for a staff member (pick person → QR) | screen | hub admin | **no** |
| 00-S18 | Active sessions list | screen | hub admin | **no** |
| 00-D02 | Force logout confirm | dialog | from 00-S18 | **no** |
| 00-S19 | Lockouts (people, screens, addresses) | screen | hub admin | **no** |
| 00-D03 | Clear lockout confirm | dialog | from 00-S19 / 00-S18 | **no** |
| 00-S20 | Hub admin home (menu of admin jobs) | screen | hub admin | **no** — not in any spec (Open question Q1) |
| 00-F01 | Hub unreachable — reconnecting | banner + full-screen variant | every hub page | yes on `/pair` only |
| 00-F02 | This device must be paired again | full-screen state | every hub page | partial |
| 00-F03 | Connect to the staff Wi-Fi | full-screen state | every hub page | partial |
| 00-F04 | Update the app | full-screen blocking state | every hub page | partial |
| 00-F05 | Hub busy, try again | banner | every hub page | partial |
| 00-F06 | Hub is being set up | full-screen state | every hub page | partial |
| 00-F07 | Open the hub by its address | full-screen state | every hub page | partial |
| 00-F08 | Pair this device again (token rotated elsewhere) | full-screen state | every hub page | no |

**Count: 31** (20 screens and states, 3 dialogs, 8 global states). Global states 00-F01…F08 are reused by every later hub-served surface (see index §Global states).

## 4. Per screen

### 00-S01 Hub setup form
- **Purpose:** connect this hub to the restaurant's cloud account. **Entry:** installer opens `http://<hub-ip>:3000/setup`. **Exit:** 00-S02 on success; stays on error.
- **Layout:** product mark + title "Set up this hub" → short intro (what a registration code is, where to get it) → form (3 fields) → primary **Set up hub** → error banner under the button → slow banner after 3 s.
- **Fields**

| Label | Type | Unit / format | Validation | Default | Req | API field | LTR |
|---|---|---|---|---|---|---|---|
| Registration code | text, mono, autocomplete off, `autocapitalize=characters` | 12 letters/digits, shown grouped `7K3Q-ZD9M-AB12` | dashes, spaces, lowercase cleaned; 12 chars | empty | yes | `registration_code` | yes |
| Hub address on this network | text, mono (could be a pick-list of the hub's addresses — not in API) | IPv4 `192.168.0.107` | must be an address of this machine | empty | yes | `advertised_host` | yes |
| Customer Wi-Fi ranges (blocked) | text, mono, comma-separated (or repeatable rows) | CIDR `192.168.50.0/24` | ≥ 1 valid CIDR | empty | yes | `guest_network_cidrs[]` | yes |

- **Actions:** **Set up hub** → `POST /setup/provision` (no auth; cloud call ≤ 10 s); busy + slow banner; no confirmation; not idempotent on the client (single-use code; `SETUP_IN_PROGRESS` guards double tap).
- **States**

| State | Shows |
|---|---|
| Idle | form |
| Busy / slow | button spinner; "Still working…" after 3 s |
| `VALIDATION_FAILED` | mark the field named in `details.issues[].path`; text per field: code "Check the code: 12 letters and digits", host "This is not an address of this hub", ranges "Check the ranges, e.g. 192.168.50.0/24" |
| `REGISTRATION_CODE_INVALID` | "This code is wrong, used or older than 24 hours. Ask for a new one." |
| `REGISTRATION_CODE_KIND_UNSUPPORTED` | "This code is for replacing a hub. Use the replace-hub steps." (restore flow is 06-S04) |
| `SERVICE_UNAVAILABLE` | "The cloud can't be reached. Check the internet, then try again in 5 s." (`retry_after_ms`) |
| `SETUP_IN_PROGRESS` | "Setup is already running. Wait a moment." |
| `HOST_NOT_ALLOWED` | 00-F07 |
| Network drop | 00-F01 banner; values kept |
| Already provisioned | page is 404 (no design; the installer lands on the hub's plain 404) — Open question Q2 |

- **Sample:** code `7K3Q-ZD9M-AB12`, host `192.168.0.107`, guest `192.168.50.0/24`.
- **Edge cases:** hub has two NICs (Wi-Fi + Ethernet) → installer must pick the LAN one; installer opens by hostname (`pos-hub.local`) → `HOST_NOT_ALLOWED`.
- **Steps:** 3 fields + 1 tap. Target ≤ 4 actions.

### 00-S02 Hub is set up
- **Purpose:** hand over the first-admin link. **Entry:** 00-S01 success. **Exit:** the admin scans the QR (opens 00-S03 on their phone) or clicks the link.
- **Layout:** ok status icon + "Hub is set up" → "Hub restarting…" line (spinner until the link answers) → large QR on white tile → link (mono, LTR) → "Works once, for 30 minutes (until 14:32)".
- **Data:** `first_admin_url`, `first_admin_expires_at` (hub time), `restarting: true`.
- **States:** restarting (link not yet live), ready, expired (time passed → tell installer to run `issue-admin-bootstrap`).
- **Edge:** page refreshed after restart → `/setup` is 404, the QR is gone; the installer must use the hub CLI (00 §6.34).

### 00-S03 First admin sign-in
- **Purpose:** first admin signs in once without a paired device. **Entry:** QR/link from 00-S02 or hub CLI. **Exit:** 00-S05; 00-S04 if the link is dead.
- **Layout:** title "Sign in as the first admin" → name tiles (admins only) → PIN pad (appears after a name is tapped; keep it on screen on a phone) → error line.
- **Fields:** Name (tile pick, `staff_id`); PIN (masked dots, 4–6 digits, `pin`, LTR).
- **Actions:** submit PIN → `POST /admin/auth/bootstrap` (token from `location.hash`, then removed from the address bar). No idempotency key; one-time token.
- **States:** loading roster; roster empty "No one on the staff list can open the hub admin. Ask the owner." (`bootstrap.no_admins`); locked tile "Locked · 14 min" (`locked_until`); `PIN_INVALID` shake + "2 tries left" when ≤ 2; `PIN_LOCKED_OUT` / `IP_LOCKED_OUT` time left; `STAFF_NOT_FOUND`; `PERMISSION_DENIED` "This person can't open the hub admin"; `VALIDATION_FAILED` "PIN is 4 to 6 digits"; `SERVICE_UNAVAILABLE` retry once then 00-F05; `PAIRING_TOKEN_INVALID` → 00-S04.
- **Sample roster:** Arif (owner), Imran (manager), Bilal (locked 14 min).
- **Steps:** 1 tap name + 4–6 digits + Enter = 6–8 taps.

### 00-S04 First admin link expired
"This link has expired. Ask the installer for a new one." (`bootstrap.expired_*`). Cause: used, older than 30 min, or replaced by a newer one. No action.

### 00-S05 Signed in
"Signed in as Imran" + primary **Approve a screen** (opens 00-S08 **in the same tab**; session is `sessionStorage`, one tab only) + note "Keep this tab open". Session idle 1 h for managers.

### 00-S06 Approve — can't approve here
- **Purpose:** explain why a phone that scanned a screen's QR can't approve. **Entry:** `/admin/approve?r=` with no device token and no bootstrap session. **Text:** "Open this on a paired admin device and type the code there." (`pairing.approve_needs_admin_device`). No action. **Edge:** the manager's own phone not yet paired → they need 00-S17 first (chicken-and-egg at setup: use 00-S03 bootstrap tab).

### 00-S07 Approve — admin sign-in
- **Layout:** name tiles (admins; on a phone only its owner) → PIN pad → error line. **API:** `GET /admin/login-roster`, `POST /admin/auth` → `admin_session_token` in `sessionStorage`.
- **States:** as 00-S03, plus `DEVICE_LOCKED_OUT` ("Too many wrong PINs on this screen · 15 min"), `DEVICE_REVOKED` / `DEVICE_TOKEN_INVALID` → 00-F02.

### 00-S08 Approve a screen — form
- **Purpose:** approve one pairing request. **Entry:** 00-S05, 00-S07, or QR with `?r=`. **Exit:** 00-S09.
- **Fields**

| Label | Type | Validation | Default | Req | API | LTR |
|---|---|---|---|---|---|---|
| Code on the screen | text, mono, 6 chars, uppercase | A–Z without I L O U, digits | from the request when `?r=` | yes | `display_code` (+ `request_id` = `r`) | yes |
| What is this screen? | segmented: **Cashier screen** / **Kitchen screen** | — | none | yes | `device_type: cashier_kiosk \| kds` | — |
| Which station? (kitchen screen only) | station picker (names from branch config: Tandoor, Karahi counter, Degh) | required for kitchen, forbidden for cashier | none | kitchen only | `station_id` | — |

- **Action:** **Approve** → `ApprovePairingRequest` (`/admin/commands/approve-pairing-request`), permission `manage-devices`, command_id ULID, busy state, no confirmation. Audited.
- **States:** `PAIRING_REQUEST_NOT_FOUND` "No screen is waiting with this code. Check the code on the screen." (expired 10 min or already approved); `STATION_NOT_FOUND` "This station is not set up. Add it in the owner app."; `VALIDATION_FAILED`; `ADMIN_SESSION_REQUIRED` → 00-S07; `PERMISSION_DENIED` "You can't add screens. Ask a manager."
- **Steps:** type 6 chars (or 0 with QR) + 1 type + 1 station + 1 Approve = 3–9.

### 00-S09 Approve — result
"Screen approved. It will open in a few seconds." + **Approve another** (`approve.another`) back to an empty 00-S08. Error variant shows the code's text + **Try again**.

### 00-S10 Pair this screen (dark theme, 1920 kiosk / KDS wall)
- **Purpose:** show the display code and QR until approved. **Entry:** a new screen opens `/pair`. **Exit:** approved → kiosk to 02-S01, KDS to 03b-S01 (station session, silent).
- **Layout:** title "Ask a manager to pair this screen" → QR (white tile, ≥ 1 m scan) → display code `7KQ2XD` in `code-display` 72 px with accent underline (LTR) → "Expires in 9:41" countdown (`expires_at`) → hub-unreachable line if set.
- **API:** `POST /pair/requests` → `GET /pair/requests/:id` every 2 s (`poll_secret` in memory).
- **States:** starting; asking; waiting (code + QR); hub unreachable line (00-F01, keeps the code, retry 0.5 → 5 s); approved; already paired (silent); revoked (forget, back to asking).

### 00-S11 Pair this screen — expired / couldn't ask
"Ask a manager to pair this screen" + **Get a new code** (`pairing.new_code`). Distinguish causes: expired (`pairing.code_expired`); too many requests (`IP_LOCKED_OUT`, wait N min); hub busy (`SERVICE_UNAVAILABLE` after one silent retry); guest network (00-F03).

### 00-S12 Pair this phone — name it
- **Fields:** Phone name (text 1–40, `device_name`, default empty; help "e.g. Bilal's phone"). **Action:** **Pair this phone** → `POST /devices/pair { pairing_token, device_name, device_type: 'phone', pair_request_id }` (retry with the same `pair_request_id` on a lost answer, M14). **States:** name error (`pairing.name_error`), busy, success 00-S15, `PAIRING_TOKEN_INVALID` → 00-S14, hub unreachable → 00-F01.
- **Steps:** scan QR with camera (outside app) + type name + 1 tap.

### 00-S13 iPhone — Add to Home Screen
- **Purpose:** first screen every iPhone user sees; must not pair in Safari. **Layout:** title "Add to Home Screen, then open it from there" → 3 illustrated steps: tap Share (icon), tap "Add to Home Screen", open the new icon (`pairing.ios_step_*`). URL untouched (`?t=` kept). **Edge:** QR expires (10 min) before the user opens the icon → 00-S14 in the home-screen app; delete the old icon.

### 00-S14 QR expired / used
"Ask a manager for a new QR" (`pairing.token_expired`); on iPhone add "Then add the new link to your Home Screen; you can delete the old icon."

### 00-S15 Paired
"This phone is paired" (`pairing.paired_*`) → goes straight to 02-S01 login (roster = only the phone's owner).

### 00-S16 Devices list (not built)
- **Purpose:** see every paired device and who's on it. **Entry:** hub admin (00-S20 or a link from any admin page). **Exit:** 00-D01, 00-S17.
- **Layout:** title "Screens and phones" → filter **Show removed** (toggle, `include_revoked`) → list grouped by type (Cashier screens, Kitchen screens, Tablets, Phones) → per row: name, type icon + word, station (kitchen), owner (phone), paired on + by, last seen ("2 min ago", hub time), who is logged in now, **Remove** (danger, secondary).
- **Data:** `GET /admin/queries/devices` → `{ device_id, device_name, device_type, station_id, owner_staff_id, pairing_source, paired_at, paired_by_name, last_seen_at, revoked_at, active_session { display_name, kind } }`.
- **States:** loading; empty (only this device) ; read-only for someone without `manage-devices` (no Remove; query itself needs `access-hub-admin`); removed rows labelled "Removed 24 Oct"; hub unreachable (00-F01, list kept).
- **Sample:** "Counter 1" cashier screen · Imran logged in · seen now; "Tandoor" kitchen screen · station Tandoor · seen 10 s ago; "Bilal's phone" · owner Bilal · seen 3 h ago; "Tablet 3" · removed 20 Oct.
- **Edge:** removing the device you are using → ends your own admin session (show warning in 00-D01); a kitchen screen that is offline right now (03b auto-print fallback) shows last seen in warn tone.

### 00-D01 Revoke device
"Remove Tablet 3? It will stop working at once and anyone logged in on it is logged out." Field **Reason (optional)** text ≤ 200 (`reason`). Buttons **Cancel** / **Remove** (danger). → `RevokeDevice` (`manage-devices`, command_id). `already_revoked: true` → "Already removed". `DEVICE_NOT_FOUND`. Audited.

### 00-S17 Add a phone for a staff member (not built)
- **Steps:** pick the person (name tiles from staff directory) → **Make QR** → QR + link (mono) + "Works once, for 10 minutes · 9:41" → the person scans with their phone camera. **API:** `GenerateDevicePairingToken { device_type: 'phone', owner_staff_id }` → `pair_qr_svg`, `pair_url`. Permission `manage-devices`; audited. **Edge:** phone already paired for that person (allowed; a new row); person has left (not in directory). **Note:** no clipboard "Copy link" (insecure origin).

### 00-S18 Active sessions (not built)
List from `GET /admin/queries/sessions`: person or station, device name, kind (staff / kitchen screen / admin), started, last activity, idle limit ("logs out after 5 min idle"). Row action **Log out** (`manage-staff`) → 00-D02. Station sessions show no Log out on the KDS itself (`STATION_LOGOUT_NOT_ALLOWED`), but a manager can force-end one here.

### 00-D02 Force logout
"Log Bilal out of Tablet 2? Anything he hasn't sent stays on the tablet." → `ForceLogoutSession` (command_id). `already_ended` → "Already logged out". `SESSION_NOT_FOUND`. Logged (E0-PIN AC5).

### 00-S19 Lockouts (not built)
Tabs or sections: **People** (from roster `locked_until`), **Screens**, **Addresses** (bootstrap IPs). Each row "Locked · 14 min" + **Unlock** → 00-D03 → `ClearPinLockout { subject_type, subject_id }`. `cleared: false` → "Already unlocked". There is **no query listing device/IP lockouts** in 00 (only staff `locked_until` in rosters) → Open question Q3.

### 00-D03 Clear lockout
"Unlock Bilal now? He can try his PIN again." **Cancel** / **Unlock**. Logged.

### 00-S20 Hub admin home (not in any spec)
Needed to reach 00-S16…S19, 01a stock (`/admin/stock`), 03a capacity, 03b printers, 06 backup/sync. See Q1.

### 00-F01 … 00-F08 global states
| ID | Trigger | Text | Action |
|---|---|---|---|
| 00-F01 | fetch/WS fails, `1012` | "Can't reach the hub — retrying…" (banner on working screens; full-screen only if nothing was ever loaded) | none; clears itself; backoff ≤ 5 s |
| 00-F02 | `DEVICE_TOKEN_INVALID`, `DEVICE_REVOKED`, WS `4403` | "This device must be paired again" | **Pair again** → wipes token → 00-S10 / 00-S14 |
| 00-F03 | `GUEST_NETWORK_FORBIDDEN` | "Connect to the staff Wi-Fi" + network name if known | none |
| 00-F04 | `CLIENT_UPGRADE_REQUIRED`, WS `4426` | "Update the app" (tablet: Play Store/APK; browser: reload) | **Reload** |
| 00-F05 | `SERVICE_UNAVAILABLE` after one retry | "Hub busy, try again" | **Try again** |
| 00-F06 | `HUB_NOT_PROVISIONED` | "The hub is being set up" | none |
| 00-F07 | `HOST_NOT_ALLOWED` | "Open the hub by its address, e.g. http://192.168.0.107:3000" | none |
| 00-F08 | WS `4401` after `DeviceTokenRotated` | "Pair this device again" | **Pair again** |

## 5. Flows

**F1 New hub to first approved screen** — 00-S01 → 00-S02 (scan QR on phone) → 00-S03 (Imran, PIN) → 00-S05 → **Approve a screen** → meanwhile the kiosk shows 00-S10 `7KQ2XD` → 00-S08 (type code, Cashier screen) → 00-S09 → kiosk goes to 02-S01. Unhappy: code invalid (00-S01 error); hub restarts slowly (00-S02 waiting); link expired (00-S04 → CLI); kiosk request expired (00-S11 → new code → retype).

**F2 Kitchen screen mid-rush (tandoor KDS died, replacement tablet)** — new tablet browser `/pair` → 00-S10 → manager scans QR with own paired phone → 00-S07 (if no admin session) → 00-S08 prefilled code, **Kitchen screen**, **Tandoor** → 00-S09 → KDS opens station view 03b-S01. Old KDS: 00-S16 → 00-D01 Remove. Unhappy: manager's phone unpaired → 00-S06; station missing → `STATION_NOT_FOUND`.

**F3 Waiter pairs own phone (Android)** — manager 00-S17 (Bilal → QR) → Bilal scans with camera → 00-S12 name → 00-S15 → 02-S01 (only Bilal). iPhone: → 00-S13 → Add to Home Screen → open icon → 00-S12 → 00-S15. Unhappy: 10 min passed → 00-S14 → back to manager.

**F4 Locked-out waiter in rush** — waiter gets `PIN_LOCKED_OUT` on 02-S01 → manager opens 00-S19 on own phone → **Unlock** → 00-D03 → waiter retries. Target: ≤ 5 taps for the manager after admin sign-in.

**F5 Staff member leaves** — owner marks them inactive in 01b-S02 → next config poll removes them → their phone is revoked automatically (01a test 51) → appears "Removed" in 00-S16.

## 6. Data shown

| Entity | Fields (units) | Source |
|---|---|---|
| Admin roster | `staff_id`, `display_name`, `locked_until` (hub ms) | `GET /admin/login-roster`; bootstrap roster |
| Pairing request | `request_id`, `display_code` (6), `approve_url`, `expires_at` | `POST /pair/requests`, poll |
| Device | see 00-S16 | `GET /admin/queries/devices` |
| Session | `session_id`, `kind`, `display_name`, `station_id`, `device_name`, `started_at`, `last_activity_at`, `idle_ttl_ms` | `GET /admin/queries/sessions` |
| Phone pairing token | `pair_qr_svg`, `pair_url`, expiry 10 min | `GenerateDevicePairingToken` result |
| Effective permissions | `{ [permission]: { grant, approver_role_ids } }` | `GET /queries/session` (used by every module) |

No WS on admin pages (admin sessions have no socket); lists refresh on open and after each action.

## 7. Cross-module links
- **Needs:** cloud registration code (00 CLI `issue-registration-code` today; a cloud owner screen for it is not specified — Q4); stations from 01a (station picker in 00-S08); staff directory from 01b.
- **Gives:** pairing and sessions to every client; the login hand-off (00-S15 → 02-S01); global states 00-F01…F08 to all hub surfaces; `GET /queries/session` permissions that every later screen uses to show, hide or mark "needs approval".
- 06 reuses 00-S01 for replace-hub codes (06-S04) and shows the first-admin link after a restore (00-S02 pattern).

## 8. Open questions (owner / product)
- **Q1** There is no hub admin home or navigation in any spec. Where does a manager go to reach devices, sessions, lockouts, stock, capacity, printers, backups? Which module owns it (00 or 01b)?
- **Q2** After setup, `/setup` is a plain 404. Should it say "This hub is already set up" instead?
- **Q3** Device and IP lockouts have a clear command but no list query. Should the lockouts screen list them (needs a 00 query), or only people?
- **Q4** Registration codes are issued by a cloud CLI. Should the owner app have "Add a hub / Replace a hub" (06 covers replace-hub)?
- **Q5** Who owns the screens 00-S16…S19 (ui-brief §1.7 says "likely 01/02 admin")? They need a module and a spec section before build.
- **Q6** Should the device list show a kitchen screen that is offline right now as a warning (ties to 03b auto-print)?

## 9. Design status
- **Designed and built:** 00-S01…S15 restyled with the UI kit in spec 00 v1.2 (plan tasks 67–71): name tiles on bootstrap, masked PIN, field marking, success QR, approve another, phone name field. `docs/design/ui-brief.md` §1 still describes the **old unstyled pages** ("no CSS at all", `window.prompt`) — **outdated**; the strings in `apps/hub/src/lib/strings.ts` are the current text.
- **No design frames** are referenced anywhere in the repo (no canvas/Figma frame names); the 00 pages were designed in code from the brief.
- **Not designed:** 00-S16…S20, 00-D01…D03, 00-F02…F08 as full-screen frames, Urdu RTL frames for every 00 page.

## Story AC → screen IDs

| Story AC | Screens |
|---|---|
| E0-PIN AC2 (hub verifies PIN offline) | 00-S03, 00-S07 (and 02-S01) |
| E0-PIN AC3 (actions attributed) | no screen (audit content shown in 04-S03) |
| E0-PIN AC4 (idle auto-logout) | 00-F02 n/a; session expiry → 02-S01 (owned by 02) |
| E0-PIN AC5 (force logout, logged) | 00-S18, 00-D02 |
| E0-PIN AC6 (lockout, clearable) | 00-S03, 00-S07 (time left), 00-S19, 00-D03 |
| E0-PIN edge (guest Wi-Fi) | 00-F03 |
| E0-PIN edge (shared device across shifts) | 02-D01 takeover |
| E0-HW AC3 (pairing, manage-devices, audit) | 00-S06…S17, 00-D01 |
| E6-ROLE AC3/AC4 (effective permission) | no own screen; drives every screen's show/hide |
| E6-ROLE AC6 (default role set) | no screen in 00 (seed); edited in 01b-S04 |
| E5-PWR AC8 (devices reconnect) | 00-F01 |
| E5-PWR AC2–4, 9, 10 | no screen (boot); audit in 04-S03 |
| E5-DEV AC3 (hub replays without session) | no screen in 00 (02-D14 owns the client side) |

**ACs with no screen in this module:** E0-PIN AC3, E6-ROLE AC3/4/6, E5-PWR AC2–4/9/10, E5-DEV AC3 — all are back-end rules with screens in other modules or none needed (counted in the index as "no screen needed", not gaps).
