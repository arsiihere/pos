# 00 — Hub Platform & Access: design for integration

Canvas: **00 Screens** (102 frames, 10 rows). Inventory: `docs/design/inventory/00-hub-access.md`. Design system: POS (tokens.json v1, installed on the canvas as `ds/pos`). Kit: `kit-additions.css` = 01a additions + the module-00 block below.

Conventions used in every frame
- Root: `.pos-root` + `lang` + `dir` + `data-theme` (dark only on `/pair` screens and KDS).
- Light pages: `.pos-page` → `.pos-appbar` → `.pos-content`. Hub admin pages add `.pos-shell` + `.pos-sidenav` (tablet/kiosk) or `.pos-appbar--phone` with a back link (phone).
- Full-screen states: `.pos-screen.pos-screen--{ok|warn|danger|info}` → `.pos-screen__icon` → `.pos-screen__title` → `.pos-screen__body` → one action row.
- Codes, PINs, IPs, links, times, counts: `.pos-ltr`, `.pos-input--mono`, `.pos-input--code`, `.pos-mono-wrap`, `.pos-code__value`.
- One primary (`.pos-btn--primary`) per screen. Danger actions use `.pos-btn--danger` (outlined), never filled.
- Sample data: hub `192.168.0.107:3000`, guest range `192.168.50.0/24`, staff Wi-Fi `AC-Staff` (sample, see Q6), time now 13:18 (lunch rush).

## 0. As built (2026-10-26, spec 00 v1.4)

Where the implementation differs from the sections below, this list wins. Build plan and notes: `PLAN.md`.

| Topic | As built |
|---|---|
| Kit | All of `kit/kit-additions.css` (01a + 00) was appended to `packages/ui-kit/components/bundle.css`; the repo had no 01a additions yet. Extra token-only rules: `a.pos-btn { text-decoration: none }`; `.pos-split` stacks and `.pos-content` narrows under 760 px. Icons added to `apps/hub/src/lib/page.ts` and the kit README (no `camera`: unused, and in-page cameras are out). |
| Files | Setup `apps/hub/src/setup/page.ts`; bootstrap `auth/admin-bootstrap.ts`; approve page stays in `commands/approve-pairing-request.ts`; pair `auth/pair-page.ts`; shared sign-in (tiles + PIN pad) `auth/signin-client.ts`; global states `lib/global-state.ts`; hub admin `admin/page.ts` + `admin/routes.ts`. |
| Strings | `apps/hub/src/lib/strings.ts`: `EN` and `UR`. Keys follow §2 with additions (`*_body` second lines, `pin.*`, `admin.*`, …). Keys without Urdu: `urdu-todo.md`. |
| Language | `?lang=en\|ur` → `localStorage pos-lang` → `navigator.language`. The server sends `lang="en" dir="ltr"`; the script sets `lang`/`dir` on `<html>` and `<body>` and swaps type classes to the kit's `ur-*` classes, like the *Urdu frames. |
| API added (spec v1.3) | `GET /admin` (M86); admin queries `stations`, `lockouts`, `staff` (M88); devices `owner_name`, `revoked_by_name`, `revoked_reason` (M87); sign-in `permissions` (M89). Commands already existed at the §1 paths. |
| 00-S01 | Host field is pick tiles of this machine's IPv4 (M85) + "Other address". `/setup` after provisioning: 404 with the SetupAlready page (M84). |
| 00-S03/S07 | One shared sign-in. Roster tiles show the first role name (`role_names`, spec v1.4 M92). |
| 00-S08 | Station tiles from the `stations` query; small line = location label or first 3 category names. Kind has no default; missing kind/station are field errors (`approve.err_kind`, `approve.err_station`). |
| 00-S10/S15 | "Paired" bodies name the station (`station_name`) and the owner (`owner_name`), spec v1.4 M92; generic text only when a screen resumes without a fresh approval. `/pair?t=` (phones) switches to the light theme in the script (M91). |
| 00-F07 | Address line only when the error carries `advertised_host` (it doesn't today). |
| 00-S16 | `pairing_source` shows "Screen code" / "QR link" ("First admin" is not derivable). "Show removed" uses the kit switch (red when off). |
| 00-S20 | Phone layout chosen with `matchMedia('(max-width: 760px)')`. Other jobs: Stock only when the built `/admin/stock` exists. |
| Q8 | A WebSocket pong marks the device seen (every 15 s); the 2 min warning is client-side. |
| Q5 | Blocked: Approve keeps two types. |

---

## 1. Per screen

### 00-S01 Hub setup form — `/setup`
Frames: `Main.dc.html` (idle), `SetupBusy`, `SetupFieldErrors`, `SetupCodeInvalid`, `SetupCodeReplace`, `SetupCloudDown`, `SetupInProgress`, `SetupOffline`, `SetupAlready` (proposal, Q2), `SetupUrdu`.

Tree
```
.pos-root.pos-page (laptop 1440)
  header.pos-appbar
    .pos-sidenav__brand  "Restaurant POS / Hub setup"      (reused brand block, no logo)
    .pos-appbar__end > .pos-chip[screen] .pos-ltr  "192.168.0.107:3000"
  [.pos-banner--warn.pos-banner--pulse]                  (00-F01, network drop)
  main.pos-content  grid 560px | 400px
    section.pos-card
      h1.title  "Set up this hub"   p.body muted (intro)
      .pos-field  Registration code   input.pos-input.pos-input--code
      .pos-field  Hub address         input.pos-input.pos-input--mono
      .pos-field  Customer Wi-Fi      input.pos-input.pos-input--mono
      button.pos-btn--primary.pos-btn--lg.pos-btn--block  "Set up hub"   (+ .is-busy)
      .pos-banner (error / slow)                         (under the button)
    aside  h2.heading "What happens next"  ol.pos-checklist (3 steps)
```

| Field | API field | Client rule | Error state |
|---|---|---|---|
| Registration code | `registration_code` | strip dashes/spaces, uppercase, 12 chars; show grouped `7K3Q-ZD9M-AB12` | `.pos-field--error` + `setup.err_code` |
| Hub address on this network | `advertised_host` | IPv4 | `setup.err_host` |
| Customer Wi-Fi ranges (blocked) | `guest_network_cidrs[]` | split on comma, trim, ≥ 1 | `setup.err_cidr` |

Action: **Set up hub** → `POST /setup/provision` (no auth). Busy: button `.is-busy` "Setting up…", inputs stay editable but submit blocked; after 3 s add `.pos-banner--warn.pos-banner--pulse` `setup.slow`.

| State | Frame | UI |
|---|---|---|
| Idle | Main | form |
| Busy / slow | SetupBusy | spinner + warn banner |
| `VALIDATION_FAILED` | SetupFieldErrors | mark field from `details.issues[].path` (`registration_code`→code, `advertised_host`→host, `guest_network_cidrs*`→ranges) |
| `REGISTRATION_CODE_INVALID` | SetupCodeInvalid | danger banner |
| `REGISTRATION_CODE_KIND_UNSUPPORTED` | SetupCodeReplace | info banner (links to 06-S04 when it exists) |
| `SERVICE_UNAVAILABLE` | SetupCloudDown | warn banner, retry allowed after `retry_after_ms` |
| `SETUP_IN_PROGRESS` | SetupInProgress | info banner, button disabled until answer |
| `HOST_NOT_ALLOWED` | GlobalWrongHost (00-F07) | full screen |
| Network drop | SetupOffline | 00-F01 banner on top, values kept, button disabled |
| Already provisioned | SetupAlready | proposed instead of plain 404 (Q2) |

Taps: 3 fields + 1 = 4 ✓.

### 00-S02 Hub is set up — `/setup`
Frames: `SetupDone` (restarting), `SetupReady`, `SetupLinkExpired`.
```
.pos-screen.pos-screen--ok
  .pos-screen__icon[check]  h1 "Hub is set up"  p (scan or open here)
  .pos-row > .pos-chip--warn[sync] "Hub restarting…" | .pos-chip--ok[check] "Hub is ready"
  .pos-code > .pos-code__qr (QR of first_admin_url) · p.pos-mono-wrap (link) · p.pos-code__meta "Works once, for 30 minutes (until 14:32)"
  action: button "Wait for the restart" [disabled] → a.pos-btn--primary "Open sign-in here" (href = first_admin_url)
```
Data: `first_admin_url`, `first_admin_expires_at` (format HH:mm hub time), `restarting`. Poll `HEAD first_admin_url` (or `/healthz`) every 1 s until it answers → ready. Expired (client clock ≥ expires_at): `.pos-screen--danger`, `.pos-code__qr--void` "QR expired", meta shows CLI `issue-admin-bootstrap` in `.value-mono`.

### 00-S03 First admin sign-in — `/admin/bootstrap#t=…`
Frames: `BootSignIn` (phone), `BootSignInLaptop`, `BootLoading`, `BootNoAdmins`, `BootWrongPin`, `BootLocked`, `BootIpLocked`, `BootShortPin`, `BootNotAdmin`, `BootUrdu`.
```
main.pos-content
  p.caption "Restaurant POS · Hub admin"  h1.title  p.body muted
  .pos-staff (3 cols on phone) > button.pos-staff__tile[aria-pressed] | .pos-staff__tile.is-locked (small: lock icon + "Locked · 14 min")
  section.pos-card
    p "PIN for <strong>Imran</strong>"
    [error line p.label danger | .pos-banner--danger]
    .pos-pin(.is-error|.is-locked) > .pos-pin__dots + .pos-pin__keys (Delete · 0 · Sign in)
```
| Field | API |
|---|---|
| Name tile | `staff_id` (roster from bootstrap response) |
| PIN (dots) | `pin` (4–6 digits, never shown) |

Action: Sign in key (or 6th digit) → `POST /admin/auth/bootstrap { token (from location.hash, then history.replaceState to drop it), staff_id, pin }`.

| State | Frame | UI / text key |
|---|---|---|
| Loading roster | BootLoading | 3 tiles with `.pos-skeleton` |
| Empty roster | BootNoAdmins | `.pos-empty` in card · `bootstrap.no_admins` |
| Locked tile | all | `.is-locked` + `staff.locked_min` from `locked_until` (round up) |
| `PIN_INVALID` | BootWrongPin | `.pos-pin.is-error` shake + `pin.tries_left` (only when ≤ 2) |
| `PIN_LOCKED_OUT` | BootLocked | tile becomes locked, keys `.is-locked`, banner `pin.locked_person` |
| `IP_LOCKED_OUT` | BootIpLocked | keys locked, banner `pin.locked_ip` |
| `VALIDATION_FAILED` | BootShortPin | `pin.length` |
| `PERMISSION_DENIED` / `STAFF_NOT_FOUND` | BootNotAdmin | banner `bootstrap.not_admin`; on STAFF_NOT_FOUND refetch roster |
| `SERVICE_UNAVAILABLE` | GlobalBusy (00-F05) | one silent retry first |
| `PAIRING_TOKEN_INVALID` | BootExpired (00-S04) | |

Taps: name + 4–6 digits + Sign in = 6–8 ✓ (6th digit auto-submits → 7 max for 6-digit PIN).

### 00-S04 First admin link expired
Frame `BootExpired`. `.pos-screen--danger` [clock] · `bootstrap.expired_title`, `bootstrap.expired_body`. No action.

### 00-S05 Signed in
Frame `BootSignedIn`. `.pos-screen--ok` · title `bootstrap.signed_in` ("Signed in as {name}") · `a.pos-btn--primary.pos-btn--lg.pos-btn--block` **Approve a screen** → `/admin/approve` same tab · caption `bootstrap.idle_note`.

### 00-S06 Approve — can't approve here
Frame `ApproveNotHere` (phone). `.pos-screen--info` [screen] · `pairing.approve_needs_admin_device` + caption `approve.first_admin_hint`. No action.

### 00-S07 Approve — admin sign-in
Frames `ApproveSignIn`, `ApproveScreenLocked`. Same tree as 00-S03 in the StockPin tablet layout (tiles left, PIN card right), appbar chip `approve.signin_chip`. API `GET /admin/login-roster` → tiles; `POST /admin/auth` → `admin_session_token` → `sessionStorage`. On a phone the roster has only its owner (one tile, pre-selected). Extra states: `DEVICE_LOCKED_OUT` → banner `pin.locked_device`, keys locked; `DEVICE_REVOKED` / `DEVICE_TOKEN_INVALID` → 00-F02.

### 00-S08 Approve a screen — form
Frames `ApproveForm` (kitchen, from QR), `ApproveFormCashier` (typed), `ApproveFormBusy`, `ApproveNoRequest`, `ApproveBadCode`, `ApproveNoStation`, `ApproveReadOnly`, `ApprovePhone`, `ApproveUrdu`.
```
header.pos-appbar  a.pos-btn[back flip] "Hub admin" · h1 "Approve a screen" · end: staff name
main grid (620 | 360)
  section.pos-card
    .pos-row > .pos-chip--ok[check] "From the QR you scanned"      (only when ?r=)
    .pos-field  "Code on the screen"  input.pos-input--code maxlength=6
    .pos-field  "What is this screen?"  .pos-seg.pos-seg--block > .pos-seg__opt[screen] Cashier | [flame] Kitchen
    .pos-field  "Which station?" (kitchen only)  .pos-tiles (3 cols; 1 col on phone) > button.pos-tile[aria-pressed] name + small (what it cooks)
    [.pos-banner]
    button.pos-btn--primary.pos-btn--lg.pos-btn--block[check] "Approve"
  aside.pos-card  "The new screen will open as" · .pos-explain (icon + "Kitchen screen · Tandoor") · audit note
```
| Field | API | Notes |
|---|---|---|
| Code on the screen | `display_code`; `request_id` = `r` | uppercase; allowed A–Z minus I L O U, 0–9; prefilled from request when `?r=` |
| What is this screen? | `device_type` `cashier_kiosk` \| `kds` | no default |
| Which station? | `station_id` | stations from branch config (01a); small line = station description or first 3 menu categories |

Action: **Approve** → `POST /admin/commands/approve-pairing-request { command_id (ULID), request_id?, display_code, device_type, station_id? }` with `admin_session_token`. Busy = `ApproveFormBusy`.

| State | Frame | Text key |
|---|---|---|
| `PAIRING_REQUEST_NOT_FOUND` | ApproveNoRequest (field error) | `errors.PAIRING_REQUEST_NOT_FOUND` |
| `VALIDATION_FAILED` | ApproveBadCode | `approve.err_code_format` |
| `STATION_NOT_FOUND` | ApproveNoStation | `errors.STATION_NOT_FOUND` |
| `PERMISSION_DENIED` | ApproveReadOnly (form disabled) | `errors.PERMISSION_DENIED_devices` |
| `ADMIN_SESSION_REQUIRED` | → 00-S07 | — |
| Hub unreachable | GlobalHubDownBanner | 00-F01 |
| Hub busy | GlobalBusy | 00-F05 |

Taps: from QR 3 (type, station, Approve); typed 6 + 1 + 1 = 8 cashier / 9 kitchen ✓ (≤ 9).

### 00-S09 Approve — result
Frames `ApproveDone`, `ApproveFailed`. `.pos-screen--ok` "Screen approved" + body `approve.done_body` ("{Station} kitchen screen will open in a few seconds." / "The cashier screen will open in a few seconds.") · primary **Approve another** (`approve.another`) → empty 00-S08 · secondary link **Hub admin** → 00-S20. Error: `.pos-screen--danger` with the error key text + primary **Try again** (back to filled form).

### 00-S10 Pair this screen (dark) — `/pair`
Frames `PairStarting`, `PairWaiting` (KDS 1920), `PairKiosk` (1280), `PairHubDown`, `PairApproved`, `PairUrdu`.
```
.pos-root[data-theme=dark].pos-page
  main.pos-screen
    h1.pos-screen__title  "Ask a manager to pair this screen"
    p.pos-screen__body    how-to line
    .pos-code > .pos-code__qr (approve_url QR) · .pos-code__value "7KQ2XD" · p.pos-code__meta [clock] "Expires in 9:41"
    [.pos-banner--warn.pos-banner--pulse  pairing.hub_unreachable]
```
Data: `POST /pair/requests` → `request_id`, `display_code`, `approve_url`, `expires_at`, `poll_secret` (memory only); `GET /pair/requests/:id` every 2 s. Countdown from `expires_at` (m:ss). Approved → `PairApproved` (ok, "Paired", "Opening the {station} kitchen screen…") → kiosk 02-S01 / KDS 03b-S01. Revoked or already paired: silent (no frame; revoked = back to PairStarting).

### 00-S11 Pair this screen — expired / couldn't ask
Frames `PairExpired` (`pairing.code_expired`), `PairTooMany` (`IP_LOCKED_OUT`, button disabled with m:ss countdown), `PairHubBusy` (`SERVICE_UNAVAILABLE` after one silent retry). Guest network → `GlobalWifiTablet` (00-F03). Primary `.pos-btn--lg` (72 px) **Get a new code** (`pairing.new_code`) → `POST /pair/requests`.

### 00-S12 Pair this phone — name it — `/pair?t=`
Frames `PhoneName`, `PhoneNameBusy`, `PhoneNameError`, `PhoneHubDown`, `PhoneUrdu`.
```
main.pos-content (16 px gutters)
  [.pos-banner--warn.pulse]
  p.caption brand · h1.title "Pair this phone" · p.body muted
  section.pos-card
    .pos-field "Phone name"  input.pos-input maxlength=40 enterkeyhint=done   help "e.g. Bilal's phone · up to 40 letters"
    button.pos-btn--primary.pos-btn--lg.pos-btn--block[phone] "Pair this phone"
  p.caption "Only you can sign in on this phone."
```
Action → `POST /devices/pair { pairing_token: t, device_name, device_type: 'phone', pair_request_id }` (generate `pair_request_id` once per page load; reuse on retry). States: name error `pairing.name_error`; busy; success → 00-S15; `PAIRING_TOKEN_INVALID` → 00-S14; unreachable → banner, button disabled, name kept.

### 00-S13 iPhone — Add to Home Screen
Frames `PhoneIos`, `PhoneIosUrdu`. Shown when iOS Safari and not `navigator.standalone`. `ol.pos-checklist` × 3: number · bold step (`pairing.ios_step_1..3`) · `.pos-callout__icon` with [share] / [add-home] / [phone]. `.pos-banner--info` `pairing.ios_link_time`. No button. Never calls `/devices/pair`.

### 00-S14 QR expired / used
Frames `PhoneExpired`, `PhoneExpiredIos`. `.pos-screen--danger` [clock] `pairing.token_expired` + body `pairing.token_expired_body` / `pairing.token_expired_ios`.

### 00-S15 Paired
Frame `PhonePaired`. `.pos-screen--ok` `pairing.paired_title` + `pairing.paired_body` ("Opening sign-in… Only {owner}'s name will be on it."); redirect to 02-S01 after 1.5 s.

### 00-S20 Hub admin home (new — Q1)
Frame `AdminHome`.
```
.pos-shell
  nav.pos-sidenav  brand (restaurant name / "Hub admin")
    a.pos-sidenav__item  Hub admin | Screens and phones (small count) | Signed in now (count) | Locked out (count)
    caption "Other jobs"  Stock (01a /admin/stock) | Kitchen capacity (03a) | Printers (03b) | Backup and sync (06)
    .pos-sidenav__foot  "Imran · Manager"  button[logout] "Sign out"
  column
    header.pos-appbar  h1 "Hub admin"  end: a.pos-btn--primary[plus] "Approve a screen"
    main.pos-content
      p.body muted  "Branch hub · 192.168.0.107"
      .pos-tiles.pos-tiles--menu > a.pos-tile  (.pos-tile__head icon + job, small line, optional status chip)
      h2.heading "Other jobs"  .pos-tiles--menu (4 tiles)
```
Data: counts from `GET /admin/queries/devices`, `/sessions`, roster `locked_until`. Status chips: kitchen screen with `last_seen_at` > 2 min (Q8) → warn; any lockout → danger. Items hidden by permission (e.g. no `manage-devices` → no Approve button, no Add a phone tile). Same nav is the shell for 00-S16…S19 and should host 01a stock, 03a, 03b, 06 admin pages.

### 00-S16 Screens and phones (new)
Frames `Devices`, `DevicesRemoved`, `DevicesReadOnly`, `DevicesLoading`, `DevicesEmpty`, `DevicesOffline`, `DevicesRemovedOk`, `DevicesPhone`, `DevicesUrdu`.
```
appbar: h1 "Screens and phones" · end: button.pos-switch[role=switch] "Show removed" · a.pos-btn[qr] "Add a phone" · a.pos-btn--primary[plus] "Approve a screen"
[.pos-banner ok/info/warn]
ul.pos-list.pos-list--devices
  li.pos-list__head  Screen or phone | Paired | Last seen | Signed in now | —
  li.pos-list__group "Cashier screens" small(count)   (order: Cashier, Kitchen, Tablets, Phones, Removed)
  li.pos-list__row
    .pos-list__name > strong.pos-list__who [type icon] name · span type line · [.pos-list__tags > .pos-chip--accent "This screen"]
    .pos-list__meta  paired date · by name / span pairing source
    .pos-list__meta last seen | .pos-chip--warn[clock] "Not seen for 6 min"
    .pos-list__meta signed-in person | "Kitchen screen" | —
    button.pos-btn--danger "Remove"
  li.pos-list__row.is-muted (removed) … .pos-chip--danger[x] "Removed 20 Oct · reason"
phone: ul.pos-list.pos-list--stack, Remove beside the name, "Approve" primary at top
```
| Shown | API field (`GET /admin/queries/devices?include_revoked=`) |
|---|---|
| Name | `device_name` |
| Type icon + word, group | `device_type` (+ tablet, Q5) |
| Station | `station_id` → station name (01a) |
| "Phone · Bilal only" | `owner_staff_id` → staff name (01b) |
| Paired on · by | `paired_at` (d MMM, "Today HH:mm"), `paired_by_name` |
| How paired | `pairing_source` → "Screen code" / "Phone QR" / "First admin" |
| Last seen | `last_seen_at` → "Now" (< 30 s), "10 s ago", "6 min ago", "3 h ago"; warn when a kitchen screen > 2 min |
| Signed in now | `active_session.display_name`; kind `station` → "Kitchen screen"; none → "—" |
| Removed | `revoked_at` (+ reason if the query returns it — Q9) |
| This screen | `device_id === current device` |

Actions: **Remove** → 00-D01. **Add a phone** → 00-S17. **Approve a screen** → 00-S08. Show removed → refetch with `include_revoked=true`. Refresh: on open and after each action (no WS).

States: loading (`.pos-skeleton` rows) · first run (only this device + `.pos-callout--accent`) · read-only (no `manage-devices`: no Remove, no Add/Approve, info banner) · hub unreachable (list kept, Remove disabled, banner with time of last list) · removed success (ok banner).

### 00-D01 Remove a screen or phone
Frames `DevicesRemoveDialog`, `DevicesRemoveSelf`.
```
.pos-dialog.pos-dialog--form
  h2.pos-dialog__title "Remove Tablet 3?"   p.pos-dialog__body
  [.pos-banner--warn  "This is the screen you are using."]   (device_id == current)
  .pos-field "Reason (optional)" input maxlength=200, help shows "29 / 200"
  .pos-dialog__footer  button "Cancel" · button.pos-btn--danger[x] "Remove"
```
→ `POST /admin/commands/revoke-device { command_id, device_id, reason? }` (`manage-devices`). Result: success → close, ok banner `devices.removed` on 00-S16; `already_revoked: true` → ok banner `devices.already_removed`; `DEVICE_NOT_FOUND` → info banner `errors.DEVICE_NOT_FOUND` + refetch; self → after success go to 00-F02.

### 00-S17 Add a phone for a staff member (new)
Frames `AddPhonePick`, `AddPhoneQr`, `AddPhoneExpired`, `AddPhoneQrPhone`.
```
pick:  .pos-section__head · .pos-input-affix[search] · .pos-staff (4 cols) > .pos-staff__tile (name, small "Waiter · Has 1 phone")
       footer.pos-actionbar  info (selected person) · button.pos-btn--primary.pos-btn--lg[qr] "Make QR"
qr:    section.pos-card > .pos-code  h2 "Ali scans this with his phone camera" · p · .pos-code__qr · .pos-chip--warn[clock] "Works once, for 10 minutes · 9:41"
       · p.pos-mono-wrap (pair_url) · button[reload] "Make a new QR" · button.pos-btn--primary[check] "Done"
expired: .pos-code__qr--void "This QR has expired" · .pos-chip--danger "Expired" · primary "Make a new QR"
```
Data: staff directory (active staff, 01b) + count of `devices` where `owner_staff_id` = staff. Action **Make QR** → `POST /admin/commands/generate-device-pairing-token { command_id, device_type: 'phone', owner_staff_id }` → `pair_qr_svg` (inline, sanitized), `pair_url`, expiry (now + 10 min). **Done** → 00-S16. No copy-link button (insecure origin). Taps: 2.

### 00-S18 Signed in now (new)
Frames `Sessions`, `SessionsReadOnly`, `SessionsDone`.
```
appbar end: p.caption "Refreshed 13:18" · button[reload] "Refresh"
ul.pos-list.pos-list--sessions
  head: Who | On | Last activity | —
  row: .pos-list__name (strong.pos-list__who [user|flame] name · span "Staff · since 11:40" · [.pos-chip--accent "You"])
       .pos-list__meta device name
       .pos-list__meta last activity / span idle rule  (warn text + clock when < 2 min to idle logout)
       button[logout] "Log out"   (hidden on own row and without manage-staff)
```
| Shown | API (`GET /admin/queries/sessions`) |
|---|---|
| Who | `display_name` (station name for kitchen sessions) |
| Kind | `kind` → "Staff" / "Hub admin" / "Kitchen screen" |
| Since | `started_at` HH:mm |
| On | `device_name` |
| Last activity | `last_activity_at` relative |
| Idle rule | `idle_ttl_ms` → "Signs out after 5 min idle"; null → "Stays on until a manager ends it" |

Action **Log out** → 00-D02.

### 00-D02 Log someone out
Frames `SessionsLogoutDialog` (staff), `SessionsEndKdsDialog` (kitchen screen). → `POST /admin/commands/force-logout-session { command_id, session_id }` (`manage-staff`). Success → ok banner `sessions.logged_out`; `already_ended` → `sessions.already_ended`; `SESSION_NOT_FOUND` → same text + refetch.

### 00-S19 Locked out (new)
Frames `Lockouts`, `LockoutsEmpty`, `LockoutsDone`, `LockoutsReadOnly`, `LockoutsPhone`, `LockoutsUrdu`.
```
three sections: People | Screens | Addresses
  .pos-section__head h2 · ul.pos-list.pos-list--lockouts
    row: .pos-list__name (who/what + why "5 wrong PINs · until 13:32") · .pos-chip--danger[lock] "Locked · 14 min" · button[unlock] "Unlock"
  empty section: p [check] "No one is locked out."
phone: danger banner for the newest person lockout + .pos-list--stack with a block primary "Unlock Bilal"
```
Data: People from `GET /admin/login-roster` (`locked_until`); Screens and Addresses need a new query (Q3) — the frames show the layout for when it exists; ship People only until then. Action **Unlock** → 00-D03. Taps (F4, manager phone after sign-in): Hub admin → Locked out → Unlock Bilal → Unlock = 4 ✓ (≤ 5).

### 00-D03 Unlock
Frames `LockoutsUnlockDialog`, `LockoutsUnlockIpDialog`. → `POST /admin/commands/clear-pin-lockout { command_id, subject_type: 'staff'|'device'|'ip', subject_id }`. Success → ok banner `lockouts.unlocked`; `cleared: false` → `lockouts.already_unlocked`.

### 00-F01 … 00-F08 Global states (every hub page)
| ID | Frames | Component | Trigger → UI |
|---|---|---|---|
| F01 | GlobalHubDown, GlobalHubDownBanner, GlobalHubDownUrdu, SetupOffline, DevicesOffline, PhoneHubDown, PairHubDown | `.pos-banner--warn.pos-banner--pulse` (working screen) / `.pos-screen--warn` (nothing loaded) | fetch/WS fail, `1012`; backoff 0.5 → 5 s; actions that need the hub disabled |
| F02 | GlobalRepair, GlobalRepairPhone, GlobalRepairKds | `.pos-screen--danger` + primary **Pair again** | `DEVICE_TOKEN_INVALID`, `DEVICE_REVOKED`, WS `4403` → wipe token → 00-S10 (screens) / 00-S14 (phones) |
| F03 | GlobalWifi, GlobalWifiTablet, GlobalWifiUrdu | `.pos-screen--warn` | `GUEST_NETWORK_FORBIDDEN`; network name from config (Q6), sentence without it if unknown |
| F04 | GlobalUpdateTablet, GlobalUpdateBrowser | `.pos-screen--info` + **Reload** | `CLIENT_UPGRADE_REQUIRED`, WS `4426` |
| F05 | GlobalBusy | `.pos-banner--warn` + inline **Try again** | `SERVICE_UNAVAILABLE` after one retry |
| F06 | GlobalNotSetUp | `.pos-screen--info` pulse | `HUB_NOT_PROVISIONED`; poll, opens by itself |
| F07 | GlobalWrongHost | `.pos-screen--info` + `.pos-mono-wrap` address | `HOST_NOT_ALLOWED` (address from `advertised_host` if the error carries it) |
| F08 | GlobalRotated | `.pos-screen--danger` + **Pair again** | WS `4401` after `DeviceTokenRotated` |

Recommendation: one `<pos-global-state>` helper in the shared client that maps error code → frame, so 01a–06 surfaces reuse it unchanged.

---

## 2. String keys (new or changed; English)

Existing keys named in the inventory keep their names; text changes are marked *changed*.

| Key | English |
|---|---|
| setup.title | Set up this hub |
| setup.intro | You need a registration code from the restaurant owner or support. It has 12 letters and digits and works once, for 24 hours. |
| setup.code_label / setup.code_help | Registration code / Dashes and spaces don't matter. |
| setup.host_label / setup.host_help | Hub address on this network / The address screens will use to open the hub. If it has a cable and Wi-Fi, use the cable one. |
| setup.cidr_label / setup.cidr_help | Customer Wi-Fi ranges (blocked) / Phones on these ranges can't open the POS. Separate several with commas. |
| setup.submit / setup.busy | Set up hub / Setting up… |
| setup.slow | Still working… This can take 10 seconds. Don't close this page. |
| setup.next_title, setup.next_1..3 | What happens next / Set up the hub / Scan the first-admin QR with the manager's phone / Approve the first screen |
| setup.err_code / err_host / err_cidr | Check the code: 12 letters and digits / This is not an address of this hub / Check the ranges, e.g. 192.168.50.0/24 |
| errors.REGISTRATION_CODE_INVALID | This code is wrong, used or older than 24 hours. Ask for a new one. |
| errors.REGISTRATION_CODE_KIND_UNSUPPORTED | This code is for replacing a hub. Use the replace-hub steps. |
| errors.SERVICE_UNAVAILABLE_cloud | The cloud can't be reached. Check the internet, then try again in {s} s. |
| errors.SETUP_IN_PROGRESS | Setup is already running. Wait a moment. |
| setup.already_title / setup.already_body | This hub is already set up / To add a screen, open Approve a screen on a manager's phone or tablet. (Q2) |
| setup.done_title / setup.done_body | Hub is set up / Scan this with the owner's or manager's phone camera, or open the link on this laptop. |
| setup.restarting / setup.ready / setup.wait_restart / setup.open_here | Hub restarting… / Hub is ready / Wait for the restart / Open sign-in here |
| setup.link_meta | Works once, for 30 minutes (until {time}) |
| setup.link_expired_body | It was valid for 30 minutes. Ask support to make a new first-admin link. |
| bootstrap.title / bootstrap.sub | Sign in as the first admin / Tap your name, then type your PIN. |
| bootstrap.loading | Getting the staff list… |
| bootstrap.no_admins | No one on the staff list can open the hub admin. Ask the owner. |
| bootstrap.not_admin | This person can't open the hub admin. Pick another name. |
| bootstrap.expired_title / expired_body | This link has expired / Ask the installer for a new one. A link works once, for 30 minutes. *changed (adds 2nd sentence)* |
| bootstrap.signed_in / idle_note | Signed in as {name} / Keep this tab open. Closing it signs you out. · You stay signed in for 1 hour without use. |
| pin.for / pin.delete / pin.submit | PIN for {name} / Delete / Sign in |
| pin.tries_left | Wrong PIN · {n} tries left |
| pin.length | PIN is 4 to 6 digits |
| pin.locked_person | Too many wrong PINs. {name} can try again in {min} min, or another admin can sign in. |
| pin.locked_ip | Too many wrong PINs from this phone. Try again in {min} min. |
| pin.locked_device | Too many wrong PINs on this screen · {min} min |
| staff.locked_min | Locked · {min} min |
| approve.title / approve.who / approve.who_sub | Approve a screen / Who's approving? / Only people who can add screens are shown. |
| approve.signin_chip | Manager sign-in |
| approve.first_admin_hint | Setting up a new hub? Use the first-admin link on the installer's laptop. |
| pairing.approve_needs_admin_device | Open this on a paired admin device and type the code there. (title: Can't approve on this phone) |
| approve.from_qr | From the QR you scanned |
| approve.code_label / code_help | Code on the screen / 6 letters and digits, shown big on the new screen. |
| approve.kind_label / kind_cashier / kind_kitchen | What is this screen? / Cashier screen / Kitchen screen |
| approve.station_label | Which station? |
| approve.submit / approve.busy | Approve / Approving… |
| approve.preview_title / preview_kds / preview_cashier / audit_note | The new screen will open as / It opens the station view and shows new tickets. / It opens the staff sign-in. / Approving is recorded with your name. |
| approve.err_code_format | The code has 6 letters and digits |
| errors.PAIRING_REQUEST_NOT_FOUND | No screen is waiting with this code. Check the code on the screen. |
| errors.STATION_NOT_FOUND | This station is not set up. Add it in the owner app, then approve again. *changed (adds "then approve again")* |
| errors.PERMISSION_DENIED_devices | You can't add screens. Ask a manager. |
| approve.done_title / done_body_kds / done_body_cashier | Screen approved / {station} kitchen screen will open in a few seconds. / The cashier screen will open in a few seconds. |
| approve.another / approve.failed / approve.retry | Approve another / Not approved / Try again |
| pairing.title / pairing.how | Ask a manager to pair this screen / On a manager's phone or tablet: open Approve a screen, then scan this QR or type the code. |
| pairing.starting / pairing.starting_body | Getting a pairing code… / This takes a few seconds. |
| pairing.expires_in | Expires in {m:ss} |
| pairing.hub_unreachable | Can't reach the hub — retrying… The code still works. Nothing to do. |
| pairing.approved_title / approved_body | Paired / Opening the {station} kitchen screen… |
| pairing.code_expired | This code has expired. Get a new one, then ask again. |
| pairing.too_many | Too many new codes from this screen. Wait {min} min, then get a new one. · Get a new code in {m:ss} |
| pairing.hub_busy | The hub is busy and couldn't make a code. |
| pairing.new_code | Get a new code |
| pairing.phone_title / phone_intro | Pair this phone / Your manager made this link for you. Give the phone a name your manager will recognise. |
| pairing.name_label / name_help | Phone name / e.g. Bilal's phone · up to 40 letters |
| pairing.name_error | Give the phone a name, up to 40 letters. |
| pairing.submit / pairing.busy / pairing.only_you | Pair this phone / Pairing… / Only you can sign in on this phone. |
| pairing.ios_title / ios_body | Add to Home Screen, then open it from there / Safari can't keep you signed in. The POS works from its Home Screen icon. |
| pairing.ios_step_1..3 | Tap Share at the bottom of Safari / Tap "Add to Home Screen", then Add / Open the new POS icon on your Home Screen |
| pairing.ios_link_time | This link works for 10 minutes. |
| pairing.token_expired / token_expired_body / token_expired_ios | Ask a manager for a new QR / This QR works once, for 10 minutes. / Then add the new link to your Home Screen; you can delete the old icon. |
| pairing.paired_title / paired_body | This phone is paired / Opening sign-in… Only {owner}'s name will be on it. |
| admin.title / admin.nav_* | Hub admin / Screens and phones / Signed in now / Locked out / Other jobs / Stock / Kitchen capacity / Printers / Backup and sync |
| admin.branch_line | Branch hub · {host} |
| admin.tile_devices / tile_add_phone / tile_sessions / tile_lockouts | {n} paired / Make a QR one person scans / {n} people and kitchen screens / After 5 wrong PINs |
| admin.sign_out | Sign out |
| devices.title / show_removed / add_phone / approve | Screens and phones / Show removed / Add a phone / Approve a screen |
| devices.col_* | Screen or phone / Paired / Last seen / Signed in now |
| devices.group_* | Cashier screens / Kitchen screens / Tablets / Phones / Removed |
| devices.type_* | Cashier screen / Kitchen screen · {station} / Waiter tablet / Phone · {owner} only |
| devices.source_* | Screen code / Phone QR / First admin |
| devices.paired_by | {date} · by {name} |
| devices.seen_now / seen_ago / not_seen | Now / {n} {unit} ago / Not seen for {n} min |
| devices.this_screen / kitchen_session / nobody | This screen / Kitchen screen / — |
| devices.removed_on | Removed {date} · {reason} |
| devices.read_only | You can see screens and phones but can't remove them. Ask a manager. |
| devices.first_run_title / first_run_body | Add the other screens / Open Pair on each new screen, then approve its code here. Make a QR for each waiter's phone. |
| devices.offline | Can't reach the hub — retrying… Showing the list from {time}. Remove works again when the hub answers. |
| devices.removed / already_removed | {name} removed. It stopped working and anyone on it was logged out. / {name} was already removed. |
| devices.remove_title / remove_body / remove_reason / remove_self / remove | Remove {name}? / It will stop working at once and anyone logged in on it is logged out. / Reason (optional) / This is the screen you are using. You will be signed out here, and it must be paired again before anyone can use it. / Remove |
| errors.DEVICE_NOT_FOUND | This screen or phone is no longer on the list. |
| addphone.title / who / who_sub / find | Add a phone for staff / Whose phone is it? / The QR pairs one phone. Only this person can sign in on it. / Find a name |
| addphone.has_phones / no_phone | Has {n} phone / No phone yet |
| addphone.make_qr / scan_title / scan_body | Make QR / {name} scans this with their phone camera / Not the POS app: the normal camera. The link opens the POS on their phone. |
| addphone.valid / expired / new_qr / done | Works once, for 10 minutes · {m:ss} / This QR has expired · Expired / Make a new QR / Done |
| sessions.title / refreshed / refresh | Signed in now / Refreshed {time} / Refresh |
| sessions.col_* | Who / On / Last activity |
| sessions.kind_* | Staff / Hub admin / Kitchen screen |
| sessions.since / idle_rule / stays_on / idle_soon / you | {kind} · since {time} / Signs out after {n} min idle / Stays on until a manager ends it / Signs out in {n} min / You |
| sessions.log_out / read_only | Log out / You can see who is signed in but can't log anyone out. Ask a manager. |
| sessions.logout_title / logout_body | Log {name} out of {device}? / Anything they haven't sent stays on the {device}. They can sign in again with their PIN. |
| sessions.end_kds_title / end_kds_body / end_kds | End the {station} kitchen screen session? / The {station} screen goes back to its start screen. Its tickets stay on the hub and print if no kitchen screen shows them. / End session |
| sessions.logged_out / already_ended | {name} logged out of {device}. / Already logged out. |
| lockouts.title / people / screens / addresses | Locked out / People / Screens / Addresses |
| lockouts.why_person / why_screen / why_ip | 5 wrong PINs · until {time} / 5 wrong PINs on this screen · until {time} / First-admin sign-in · until {time} |
| lockouts.none_people / none_screens / none_ip | No one is locked out. / No screen is locked. / No address is locked. |
| lockouts.unlock / unlock_name | Unlock / Unlock {name} |
| lockouts.banner_person | {name} is locked out · They typed a wrong PIN 5 times. |
| lockouts.read_only | You can see lockouts but can't clear them. Ask a manager. |
| lockouts.confirm_title / confirm_body / confirm_ip_body | Unlock {name} now? / They can try their PIN again. This is recorded with your name. / The phone or laptop at this address can try a first-admin PIN again. |
| lockouts.unlocked / already_unlocked | {name} unlocked. They can try their PIN again now. / Already unlocked. |
| global.hub_down_title / hub_down_body | Can't reach the hub — retrying… / Check that the hub box in the back room has power. This screen opens by itself when it answers. |
| global.repair_title / repair_body / repair_phone_title / repair_phone_body / pair_again | This device must be paired again / A manager removed it, or its pairing is no longer valid. Pair it again, then ask a manager to approve it. / This phone must be paired again / Ask a manager for a new QR for your phone. / Pair again |
| global.wifi_title / wifi_body / wifi_body_unknown | Connect to the staff Wi-Fi / This phone is on the customer Wi-Fi. Switch to {ssid} in your Wi-Fi settings, then come back. / This phone is on the customer Wi-Fi. Switch to the staff Wi-Fi, then come back. |
| global.update_title / update_app_body / update_browser_body / reload | Update the app / The hub needs a newer version. Update the POS app from the Play Store, then open it again. / The hub has a newer version. Reload to get it. / Reload |
| global.busy / busy_small / try_again | Hub busy, try again. / Nothing was saved. / Try again |
| global.not_set_up_title / body | The hub is being set up / This screen opens by itself when setup is done. |
| global.wrong_host_title / body | Open the hub by its address / Type the number address in the browser, not a name. |
| global.rotated_title / body | Pair this device again / This device's pairing was renewed on another copy of the app. Pair it again here. |

Urdu text for every key is in the Urdu frames (SetupUrdu, BootUrdu, ApproveUrdu, PairUrdu, PhoneUrdu, PhoneIosUrdu, DevicesUrdu, LockoutsUrdu, GlobalWifiUrdu, GlobalHubDownUrdu); keys without an Urdu frame need translation before release.

---

## 3. New kit classes (append to `packages/ui-kit/components/bundle.css` or kit-additions)

```css
.pos-appbar--phone { padding: var(--space-2) var(--space-4); min-height: 64px; gap: var(--space-3); }
.pos-appbar--phone .pos-appbar__title { font: 700 22px/28px var(--font-sans); }
.pos-input--code { min-height: var(--touch-kitchen); font: 700 28px/36px var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; text-align: center; direction: ltr; }
[dir="rtl"] .pos-input--code { text-align: center; }
.pos-mono-wrap { font: 500 18px/26px var(--font-mono); direction: ltr; unicode-bidi: isolate; overflow-wrap: anywhere; text-align: start; }
.pos-list__group { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-4); background: var(--surface); border-top: 1px solid var(--line); font: 700 17px/22px var(--font-sans); color: var(--ink-muted); }
.pos-list__group small { font: 700 15px/1 var(--font-mono); padding: 4px 8px; border-radius: var(--radius-pill); background: var(--surface-sunken); color: var(--ink); }
.pos-list__meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; font: 400 17px/22px var(--font-sans); }
.pos-list__meta > span { font: 400 15px/20px var(--font-sans); color: var(--ink-muted); }
.pos-list__who { display: inline-flex; align-items: center; gap: var(--space-2); font: 700 17px/22px var(--font-sans); }
.pos-list--devices .pos-list__head, .pos-list--devices .pos-list__row { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.1fr) minmax(0, 0.9fr) minmax(0, 0.9fr) 128px; }
.pos-list--sessions .pos-list__head, .pos-list--sessions .pos-list__row { grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1.2fr) 136px; }
.pos-list--lockouts .pos-list__head, .pos-list--lockouts .pos-list__row { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) 136px; }
.pos-list__row > .pos-chip { justify-self: start; }
.pos-tiles--menu { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.pos-tiles--menu .pos-tile { min-height: 120px; padding: var(--space-4); gap: var(--space-2); justify-content: flex-start; text-decoration: none; }
.pos-tile__head { display: flex; align-items: center; gap: var(--space-3); }
.pos-tile__head .pos-icon { width: 32px; height: 32px; }
.pos-code__qr--void { display: grid; place-items: center; background: var(--surface-sunken); border: 2px dashed var(--line-strong); color: var(--ink-muted); text-align: center; padding: var(--space-6); font: 700 17px/22px var(--font-sans); }
.pos-skeleton { display: block; height: 20px; border-radius: var(--radius-sm); background: var(--surface-sunken); animation: pos-pulse 1.4s ease-in-out infinite; }
@keyframes pos-pulse { 50% { opacity: .5; } }
@media (prefers-reduced-motion: reduce) { .pos-skeleton { animation: none; } }
[lang="ur"] :is(.pos-appbar__title, .pos-sidenav__brand strong, .pos-sidenav__brand span, .pos-sidenav__item, .pos-sidenav__item small, .pos-seg__opt, .pos-chip, .pos-list__head, .pos-list__name strong, .pos-list__name span, .pos-list__group, .pos-list__meta, .pos-list__meta span, .pos-list__who, .pos-switch, .pos-actionbar__info, .pos-actionbar__info strong, .pos-callout__text h2, .pos-callout__text p, .pos-section__head h2, .pos-section__head p, .pos-explain, .pos-tile, .pos-tile small, .pos-empty h3, .pos-count__unit, .pos-input-affix > span, .pos-code__qr--void) { font-family: var(--font-urdu); line-height: 2; }
[lang="ur"] .pos-input:not(.pos-input--mono):not(.pos-input--code) { font-family: var(--font-urdu); line-height: 2; }
```

Icons added (same 24px / 2px stroke rules as the README set): `unlock`, `tablet`, `plus`, `grid`, `box`, `printer`, `gauge`, `qr`, `logout`, `search`, `reload`, `download`, `camera` (unused), `link`. SVG sources are in `lib.py` of the generator and inline in each frame; add them to the README icon table.

## 4. Changes to shared components (earlier modules keep working)
1. **`.pos-list__name span` → `.pos-list__name > span`** (kit-additions, 01a). The old selector also hit chips nested in `.pos-list__tags`, so they lost their tone colour (01a Stock "Low" / "Out" chips). Direct-child only fixes that; the plain help lines in 01a are direct children, so nothing else changes.
2. Urdu font block above: 01a's Urdu frame used inline `font-family` overrides; those still work and can now be removed.
3. `.pos-staff__tile.is-locked small` is reused unchanged; `.pos-pin.is-locked` / `.is-error` unchanged.
4. The hub-admin `.pos-sidenav` (00-S20) should become the shared admin shell; 01a `/admin/stock` moves inside it (its own appbar stays).
5. Global states 00-F01…F08 are one shared helper (see §1) used by 01a stock, 02, 03a/b, 06 pages.

---

## 5. Coverage

### Screen IDs
| ID | Frames |
|---|---|
| 00-S01 | Main, SetupBusy, SetupFieldErrors, SetupCodeInvalid, SetupCodeReplace, SetupCloudDown, SetupInProgress, SetupOffline, SetupAlready, SetupUrdu |
| 00-S02 | SetupDone, SetupReady, SetupLinkExpired |
| 00-S03 | BootSignIn, BootSignInLaptop, BootLoading, BootNoAdmins, BootWrongPin, BootLocked, BootIpLocked, BootShortPin, BootNotAdmin, BootUrdu |
| 00-S04 | BootExpired |
| 00-S05 | BootSignedIn |
| 00-S06 | ApproveNotHere |
| 00-S07 | ApproveSignIn, ApproveScreenLocked |
| 00-S08 | ApproveForm, ApproveFormCashier, ApproveFormBusy, ApproveNoRequest, ApproveBadCode, ApproveNoStation, ApproveReadOnly, ApprovePhone, ApproveUrdu |
| 00-S09 | ApproveDone, ApproveFailed |
| 00-S10 | PairStarting, PairWaiting, PairKiosk, PairHubDown, PairApproved, PairUrdu |
| 00-S11 | PairExpired, PairTooMany, PairHubBusy |
| 00-S12 | PhoneName, PhoneNameBusy, PhoneNameError, PhoneHubDown, PhoneUrdu |
| 00-S13 | PhoneIos, PhoneIosUrdu |
| 00-S14 | PhoneExpired, PhoneExpiredIos |
| 00-S15 | PhonePaired |
| 00-S16 | Devices, DevicesRemoved, DevicesReadOnly, DevicesLoading, DevicesEmpty, DevicesOffline, DevicesRemovedOk, DevicesPhone, DevicesUrdu |
| 00-D01 | DevicesRemoveDialog, DevicesRemoveSelf |
| 00-S17 | AddPhonePick, AddPhoneQr, AddPhoneExpired, AddPhoneQrPhone |
| 00-S18 | Sessions, SessionsReadOnly, SessionsDone |
| 00-D02 | SessionsLogoutDialog, SessionsEndKdsDialog |
| 00-S19 | Lockouts, LockoutsEmpty, LockoutsDone, LockoutsReadOnly, LockoutsPhone, LockoutsUrdu |
| 00-D03 | LockoutsUnlockDialog, LockoutsUnlockIpDialog |
| 00-S20 | AdminHome (proposal) |
| 00-F01 | GlobalHubDown, GlobalHubDownBanner, GlobalHubDownUrdu (+ SetupOffline, DevicesOffline, PhoneHubDown, PairHubDown) |
| 00-F02 | GlobalRepair, GlobalRepairPhone, GlobalRepairKds |
| 00-F03 | GlobalWifi, GlobalWifiTablet, GlobalWifiUrdu |
| 00-F04 | GlobalUpdateTablet, GlobalUpdateBrowser |
| 00-F05 | GlobalBusy |
| 00-F06 | GlobalNotSetUp |
| 00-F07 | GlobalWrongHost |
| 00-F08 | GlobalRotated |

All 31 IDs designed.

### Jobs and story ACs
| AC | Frames |
|---|---|
| J1 code cleaned, 12 chars | Main, SetupFieldErrors |
| J1 host is this machine | SetupFieldErrors, GlobalWrongHost |
| J1 ≥ 1 guest CIDR | Main, SetupFieldErrors |
| J1 returns first_admin_url, restarts by itself | SetupDone, SetupReady, SetupLinkExpired |
| J1 `/setup` 404 after | SetupAlready (proposed replacement, Q2) |
| J2 roster tiles with lock time | BootSignIn, BootLocked |
| J2 PIN 4–6 masked | BootSignIn, BootShortPin |
| J2 "Signed in as …" + Approve same tab | BootSignedIn |
| J3 type code or scan QR | ApproveForm (QR), ApproveFormCashier (typed) |
| J3 pick type, station for kitchen | ApproveForm, ApproveFormCashier |
| J3 result shown | ApproveDone, ApproveFailed |
| J3 audited | ApproveForm (audit note in aside) |
| J4 code readable at 3 m | PairWaiting (72 px code-display on 1920) |
| J4 2 s refresh, 10 min expiry, new code | PairWaiting (countdown), PairExpired |
| J4 hub unreachable calm, self-clears | PairHubDown |
| J5 name 1–40 | PhoneName, PhoneNameError |
| J5 iOS Add-to-Home-Screen, no pairing in Safari | PhoneIos |
| J5 expired QR text | PhoneExpired, PhoneExpiredIos |
| J6 QR + link 10 min, once | AddPhoneQr, AddPhoneExpired, AddPhoneQrPhone |
| J6 roster only that person | PhonePaired (hand-off text); roster itself is 02-S01 |
| J6 generation audited | no visible UI (server); noted |
| J7 list fields | Devices, DevicesPhone |
| J7 revoke with reason ≤ 200, ends sessions | DevicesRemoveDialog, DevicesRemoveSelf, DevicesRemovedOk |
| J7 revoked rows | DevicesRemoved |
| J8 sessions listed, force logout | Sessions, SessionsLogoutDialog, SessionsEndKdsDialog, SessionsDone |
| J9 clear for person, device, IP | Lockouts, LockoutsUnlockDialog, LockoutsUnlockIpDialog, LockoutsDone, LockoutsPhone |
| J10 one state per code | GlobalHubDown … GlobalRotated |
| E0-PIN AC2 | BootSignIn, ApproveSignIn |
| E0-PIN AC5 | Sessions, SessionsLogoutDialog |
| E0-PIN AC6 | BootLocked, ApproveScreenLocked, Lockouts, LockoutsUnlockDialog |
| E0-PIN edge guest Wi-Fi | GlobalWifi, GlobalWifiTablet |
| E0-HW AC3 | ApproveNotHere … AddPhoneQr, DevicesRemoveDialog |
| E5-PWR AC8 | GlobalHubDown, GlobalHubDownBanner |
| Read-only (no permission) | ApproveReadOnly, DevicesReadOnly, SessionsReadOnly, LockoutsReadOnly |

### Not designed, and why
- **Printed tickets (58/80 mm)** — this module prints nothing.
- **02-S01 staff login, 03b-S01 station view** — hand-off targets owned by 02 / 03b.
- **E0-PIN AC3/AC4, E6-ROLE AC3/4/6, E5-PWR AC2–4/9/10, E5-DEV AC3** — back-end rules with no screen in 00 (inventory agrees).
- **00-S10 "already paired" and "revoked → forget"** — silent transitions; revoked returns to PairStarting.
- **Urdu for every state frame** — one Urdu frame per surface (10); remaining keys need translation.
- **Screens and Addresses lockout sections** — drawn, but need a list query (Q3) before build.

---

## 6. Open questions (owner / product)
1. **Q1 Hub admin home.** I designed 00-S20 with a shared side menu (devices, sessions, lockouts + stock, capacity, printers, backup). Does 00 own it, or 01b? It needs a route (`/admin`).
2. **Q2 `/setup` after setup.** Show "This hub is already set up" (SetupAlready) instead of a plain 404?
3. **Q3 Device and IP lockouts.** Add a 00 query listing them so the Screens and Addresses sections can ship, or show People only?
4. **Q4 Registration codes.** Should the owner app have "Add a hub / Replace a hub" so the installer doesn't need a support CLI?
5. **Waiter tablets.** Approve only offers Cashier or Kitchen. Are tablets paired with a phone-style QR (one owner) or by screen code as shared devices? This decides the "Tablets" group and a third option on 00-S08.
6. **Staff Wi-Fi name.** 00-F03 is clearer with the network name ("AC-Staff" is a sample). Can the branch config store it?
7. **Hub address pick-list.** Can `/setup` list the hub's own addresses so the installer picks one (avoids the two-NIC mistake), instead of typing?
8. **Kitchen screen offline warning (Q6).** At what silence should a kitchen screen show "Not seen" in warn — 2 min during service hours?
9. **Removal reason.** Should the devices query return `reason` so removed rows can show it (DevicesRemoved assumes yes)?
10. **Ending a kitchen-screen session.** After a manager force-ends it, what should the KDS show — its pairing screen or a "signed out, tap to start" screen? I assumed it goes back to its start screen and its tickets fall back to auto-print.
