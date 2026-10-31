# 00 · Hub Platform & Access — Brief

Sources used: spec `docs/specs/00_Hub_Platform_Access_Spec_v1.5.md` (APPROVED), design hand-off `docs/design/handoff/00/` (`00-design.md`, frames in `frames/*.dc.html`, screenshots of the built pages in `screens/*.png`), inventory `docs/design/inventory/00-hub-access.md`, open questions `docs/design/open-questions/00-hub-platform.md`. Frame file names below are in `docs/design/handoff/00/frames/`; `.png` names are in `docs/design/handoff/00/screens/`.

Sample data used in every frame (mock, never hard-code): restaurant Arif Chatkhara; hub `192.168.0.107:3000`; customer Wi-Fi range `192.168.50.0/24`; staff Wi-Fi `AC-Staff`; time now 13:18 (lunch rush); staff Arif (Owner), Imran (Manager), Sana (Shift lead), Bilal, Hamza, Ali (Waiters), Usman (Head cook), Zubair (Runner); stations Tandoor, Karahi counter, Degh.

---

## 1. Module summary

**What it is for.** Module 00 turns a blank mini PC into a working branch hub and controls who and what may use it. It covers the one-time hub setup, the first admin sign-in, pairing every cashier screen, kitchen screen and staff phone, and the hub admin pages where a manager sees devices, who is signed in and who is locked out. It also owns the global "something is wrong" states (hub down, wrong Wi-Fi, device removed, app too old) that every later hub screen reuses.

**Who uses it, where, how often**

| Who (permission) | Device | How often |
|---|---|---|
| Installer (no account; holds a one-time registration code) | Laptop 1440 on the restaurant LAN | Once per hub (again only if the hub is replaced) |
| First admin (any staff with `access-hub-admin`; in practice owner or branch manager) | Installer's laptop 1440, or a phone 390 after scanning a QR | Once after setup; again only in emergencies |
| Staff with `manage-devices` (approve screens, make phone QRs, remove devices) | Paired tablet 1280, cashier kiosk 1280, or own phone 390 | A few times at setup, then weekly (screen replaced, staff joins/leaves); can happen mid-service |
| Staff with `manage-staff` (log people out, unlock) | Same | Rare; a few times a week in rush (waiter locked out) |
| The new screen itself (nobody signed in) | Cashier kiosk 1280, kitchen screen 1920 | Once per screen |
| Any staff member pairing their own phone | Android phone or iPhone 390 | Once per person; again if phone storage is wiped |

**Rules that apply everywhere**
- **Permissions.** Every hub admin page needs an admin session (`access-hub-admin`). Actions hide when the admin lacks the permission (the sign-in returns `permissions`, M89): no `manage-devices` → no Approve, no Add a phone, no Remove; no `manage-staff` → no Log out, no Unlock. A `403 PERMISSION_DENIED` shows the read-only state of that page.
- **Hub down / offline.** All 00 pages are served by the hub over plain HTTP on the LAN. When the hub cannot be reached: a pulsing warn banner on a page that already shows data (data kept, hub-dependent actions disabled), or a full-screen state if nothing was ever loaded (00-F01). Retry with backoff 0.5 s → 5 s; clears by itself. Only `/setup` also needs the internet (it calls the cloud).
- **Language.** English or Urdu (right-to-left). Picked on load: `?lang=en|ur` → `localStorage pos-lang` → `navigator.language`. In Urdu, `lang="ur" dir="rtl"`. Codes, PINs, IP addresses, links, times and counts always stay left-to-right. Digits stay Latin in Urdu. Many keys still have no Urdu (see §6).
- **Theme.** Light everywhere, except `/pair` on kiosk and kitchen screens, which is dark. `/pair?t=` (phones) switches to light (M91).
- **Branch scoping.** Each branch has its own hub. Everything in 00 is local to that one hub/branch: devices, sessions, lockouts and staff names are this branch's only.
- **One primary button per screen.** Danger actions use the outlined danger button, never filled.
- **Error text** always comes from the string table (`errors.<CODE>`), never the server's `message`.
- **No WebSocket on admin pages.** Lists refresh on open and after each action (Sessions and Lockouts also have a Refresh button).

**Links to other modules**

| From | To | Why |
|---|---|---|
| 00-S15 Paired (phone) | 02-S01 staff login | Phone opens sign-in showing only its owner |
| 00-S10 Pair this screen (cashier kiosk) | 02-S01 staff login | After approval |
| 00-S10 Pair this screen (kitchen) | 03b-S01 station view | After approval, station session starts |
| 00-S08 Approve form | 01a stations (branch config) | Station tiles come from 01a stations |
| 00-S17 Add a phone | 01b staff directory | Person list and role names |
| 00-S20 Hub admin home | 01a `/admin/stock` (01a-S10/S11), 03a Kitchen capacity, 03b Printers, 06 Backup and sync | "Other jobs" menu items |
| 00-S01 setup | 06-S04 replace-hub | `REGISTRATION_CODE_KIND_UNSUPPORTED` points there |
| 00-S16 devices list | 01b-S02 Mark as left | A leaver's phone shows as Removed |
| 00-D02 end a kitchen session | 03b (owns what the KDS shows after) | Open question Q10 |
| 00-F01…F08 | Every hub-served screen in 01a, 02, 03a, 03b, 06 | Shared global states |

---

## 2. Screen list

| Screen ID | Name | Device | Who uses it | How often | Used during rush? | Existing frame file name(s) |
|---|---|---|---|---|---|---|
| 00-S01 | Hub setup form | Laptop 1440 | Installer | Once | no | `Main.dc.html`, `SetupBusy`, `SetupFieldErrors`, `SetupCodeInvalid`, `SetupCodeReplace`, `SetupCloudDown`, `SetupInProgress`, `SetupOffline`, `SetupAlready`, `SetupUrdu` (.dc.html); `setup-en.png`, `setup-ur.png`, `setup-phone.png`, `setup-already.png` |
| 00-S02 | Hub is set up (first-admin QR) | Laptop 1440 | Installer | Once | no | `SetupDone`, `SetupReady`, `SetupLinkExpired`; `setup-done.png` |
| 00-S03 | First admin sign-in | Phone 390, laptop 1440 | First admin | Once | no | `BootSignIn`, `BootSignInLaptop`, `BootLoading`, `BootNoAdmins`, `BootWrongPin`, `BootLocked`, `BootIpLocked`, `BootShortPin`, `BootNotAdmin`, `BootUrdu`; `boot-laptop.png`, `boot-wrongpin.png`, `boot-phone-ur.png` |
| 00-S04 | First admin link expired | Phone 390 | First admin | Rare | no | `BootExpired`; `boot-expired.png` |
| 00-S05 | Signed in — go to Approve | Phone 390 | First admin | Once | no | `BootSignedIn` |
| 00-S06 | Approve — can't approve here | Phone 390 | Manager with an unpaired phone | Rare | yes | `ApproveNotHere`; `approve-nothere.png` |
| 00-S07 | Approve — admin sign-in | Tablet 1280, phone 390 | `manage-devices` staff | Weekly | yes | `ApproveSignIn`, `ApproveScreenLocked` |
| 00-S08 | Approve a screen — form | Tablet 1280, phone 390 | `manage-devices` staff | Weekly (many at setup) | yes | `ApproveForm`, `ApproveFormCashier`, `ApproveFormBusy`, `ApproveNoRequest`, `ApproveBadCode`, `ApproveNoStation`, `ApproveReadOnly`, `ApprovePhone`, `ApproveUrdu`; `approve-form.png`, `approve-form-ur.png`, `approve-phone.png`, `approve-errors.png` |
| 00-S09 | Approve — result | Tablet 1280 | `manage-devices` staff | Weekly | yes | `ApproveDone`, `ApproveFailed`; `approve-done.png` |
| 00-S10 | Pair this screen (dark) | Kitchen screen 1920, cashier kiosk 1280 | The new screen (read by the manager) | Once per screen | yes (KDS replaced mid-service) | `PairStarting`, `PairWaiting`, `PairKiosk`, `PairHubDown`, `PairApproved`, `PairUrdu`; `pair-kds.png`, `pair-kiosk-ur.png` |
| 00-S11 | Pair this screen — expired / couldn't ask | Kitchen screen 1920, kiosk 1280 | The new screen | Rare | yes | `PairExpired`, `PairTooMany`, `PairHubBusy` |
| 00-S12 | Pair this phone — name it | Phone 390 | Staff member | Once per person | no | `PhoneName`, `PhoneNameBusy`, `PhoneNameError`, `PhoneHubDown`, `PhoneUrdu`; `phone-name.png`, `phone-name-ur.png` |
| 00-S13 | iPhone — Add to Home Screen | Phone 390 (iPhone) | Staff member | Once per person | no | `PhoneIos`, `PhoneIosUrdu`; `phone-ios.png` |
| 00-S14 | Pair this phone — QR expired / used | Phone 390 | Staff member | Rare | no | `PhoneExpired`, `PhoneExpiredIos` |
| 00-S15 | Paired — opening sign-in | Phone 390 (also kiosk/KDS via `PairApproved`) | Staff member | Once | no | `PhonePaired` |
| 00-S16 | Screens and phones (devices list) | Tablet 1280, phone 390 | `access-hub-admin` (remove: `manage-devices`) | Weekly | yes | `Devices`, `DevicesRemoved`, `DevicesReadOnly`, `DevicesLoading`, `DevicesEmpty`, `DevicesOffline`, `DevicesRemovedOk`, `DevicesPhone`, `DevicesUrdu`; `admin-devices.png`, `admin-devices-phone.png`, `admin-devices-ro.png`, `admin-devices-ur.png` |
| 00-D01 | Remove a screen or phone (dialog) | Tablet 1280 (popup 720) | `manage-devices` | Weekly | yes | `DevicesRemoveDialog`, `DevicesRemoveSelf`; `admin-remove-dialog.png` |
| 00-S17 | Add a phone for staff | Tablet 1280, phone 390 | `manage-devices` | Weekly | no | `AddPhonePick`, `AddPhoneQr`, `AddPhoneExpired`, `AddPhoneQrPhone`; `admin-addphone.png`, `admin-addphone-qr.png` |
| 00-S18 | Signed in now (sessions) | Tablet 1280 | `access-hub-admin` (log out: `manage-staff`) | Rare | yes | `Sessions`, `SessionsReadOnly`, `SessionsDone`; `admin-sessions.png` |
| 00-D02 | Log someone out (dialog) | Tablet 1280 (popup 720) | `manage-staff` | Rare | yes | `SessionsLogoutDialog`, `SessionsEndKdsDialog` |
| 00-S19 | Locked out | Tablet 1280, phone 390 | `access-hub-admin` (unlock: `manage-staff`) | A few times a week | yes | `Lockouts`, `LockoutsEmpty`, `LockoutsDone`, `LockoutsReadOnly`, `LockoutsPhone`, `LockoutsUrdu`; `admin-lockouts.png`, `admin-lockouts-phone.png`, `admin-lockouts-phone-ur.png` |
| 00-D03 | Unlock (dialog) | Tablet 1280 (popup 720), phone 390 | `manage-staff` | A few times a week | yes | `LockoutsUnlockDialog`, `LockoutsUnlockIpDialog` |
| 00-S20 | Hub admin home | Tablet 1280, phone 390 | `access-hub-admin` | Daily/weekly | yes | `AdminHome`; `admin-home.png`, `admin-home-phone.png` |
| 00-F01 | Can't reach the hub | All | Everyone | Rare | yes | `GlobalHubDown`, `GlobalHubDownBanner`, `GlobalHubDownUrdu` (+ `SetupOffline`, `DevicesOffline`, `PhoneHubDown`, `PairHubDown`) |
| 00-F02 | This device must be paired again | All | Everyone | Rare | yes | `GlobalRepair`, `GlobalRepairPhone`, `GlobalRepairKds` |
| 00-F03 | Connect to the staff Wi-Fi | Phone 390, tablet 1280 | Everyone | Rare | yes | `GlobalWifi`, `GlobalWifiTablet`, `GlobalWifiUrdu` |
| 00-F04 | Update the app | Tablet 1280, phone/browser 390 | Everyone | Rare | yes | `GlobalUpdateTablet`, `GlobalUpdateBrowser` |
| 00-F05 | Hub busy, try again | All (banner) | Everyone | Rare | yes | `GlobalBusy` |
| 00-F06 | The hub is being set up | Kiosk 1280 | Everyone | Once | no | `GlobalNotSetUp` |
| 00-F07 | Open the hub by its address | Laptop 1440 | Installer | Rare | no | `GlobalWrongHost` |
| 00-F08 | Pair this device again (paired elsewhere) | Tablet 1280 | Everyone | Rare | yes | `GlobalRotated` |

---

## 3. Screens

### 00-S01 · Hub setup form
- **Job:** connect this hub to the restaurant's cloud account.
- **Entry points:** installer opens `http://<hub-ip>:3000/setup` on a laptop on the restaurant LAN.
- **Exits:** success → 00-S02. Any error → stays here. `HOST_NOT_ALLOWED` → 00-F07. Hub already set up → SetupAlready state (same URL).
- **Information shown:**

| Item | Mark |
|---|---|
| App bar brand "Restaurant POS / Hub setup" | USEFUL |
| App bar chip with the hub address `192.168.0.107:3000` (LTR) | USEFUL |
| Title "Set up this hub" | MUST |
| Intro "You need a registration code from the restaurant owner or support. It has 12 letters and digits and works once, for 24 hours." | MUST |
| Field help texts (see Inputs) | USEFUL |
| Aside "What happens next": 1 "Set up the hub" / "This code, the address and the customer Wi-Fi"; 2 "Scan the first-admin QR with the manager's phone" / "First admin signs in, valid 30 minutes"; 3 "Approve the first screen" / "A cashier screen or a kitchen screen" | USEFUL |

- **Actions:**

| Action | Mark | Result |
|---|---|---|
| **Set up hub** (large, full width) | PRIMARY | `POST /setup/provision` (no auth) |

- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Registration code (`registration_code`) | text, mono, code style, autocomplete off, `autocapitalize=characters`; help "Dashes and spaces don't matter." | empty | strip dashes/spaces, uppercase, must be 12 letters/digits; shown grouped `7K3Q-ZD9M-AB12` | "Check the code: 12 letters and digits" |
| Hub address on this network (`advertised_host`) | As built (spec M85): pick tiles of this machine's IPv4 addresses ("192.168.0.107 · Ethernet", "… · Wi-Fi"; labels Cable / Wi-Fi), Ethernet first and preselected, plus "Other address" with a typed mono field. Frames still show only the typed field. Help "The address screens will use to open the hub. If it has a cable and Wi-Fi, use the cable one." | Ethernet address preselected (typed field empty) | IPv4; must be an address of this machine | "This is not an address of this hub" |
| Customer Wi-Fi ranges (blocked) (`guest_network_cidrs[]`) | text, mono, comma-separated; help "Phones on these ranges can't open the POS. Separate several with commas." | empty | split on comma, trim, at least 1 valid CIDR | "Check the ranges, e.g. 192.168.50.0/24" |

- **Decisions the user must make here:** which network address screens will use (cable vs Wi-Fi); which IP ranges are the customer Wi-Fi.
- **States:**

| State | Trigger | What changes on screen | Copy | Frame |
|---|---|---|---|---|
| Default (idle) | page load | form, empty fields (sample values in frame) | as above | `Main.dc.html`, `setup-en.png` |
| Busy | tap Set up hub | button busy "Setting up…"; inputs stay editable, submit blocked | "Setting up…" | `SetupBusy` |
| Slow | still busy after 3 s | warn pulsing banner under the button | "Still working…" / "This can take 10 seconds. Don't close this page." | `SetupBusy` |
| Field errors | `VALIDATION_FAILED`; field from `details.issues[].path` (`registration_code`→code, `advertised_host`→host, `guest_network_cidrs*`→ranges) | each failing field marked red with its message | per Inputs table | `SetupFieldErrors` |
| Code invalid | `REGISTRATION_CODE_INVALID` | danger banner under button | "This code is wrong, used or older than 24 hours." / "Ask for a new one." | `SetupCodeInvalid` |
| Replace-hub code | `REGISTRATION_CODE_KIND_UNSUPPORTED` | info banner | "This code is for replacing a hub." / "Use the replace-hub steps." | `SetupCodeReplace` |
| Cloud down | `SERVICE_UNAVAILABLE` | warn banner; retry allowed after `retry_after_ms` | "The cloud can't be reached." / "Check the internet, then try again in {s} s." (frame: 5 s) | `SetupCloudDown` |
| Setup already running | `SETUP_IN_PROGRESS` | info banner; button disabled until the answer comes | "Setup is already running." / "Wait a moment." | `SetupInProgress` |
| Hub unreachable | network drop | 00-F01 banner on top; typed values kept; button disabled | "Can't reach the hub — retrying…" / "What you typed stays here." | `SetupOffline` |
| Wrong host | `HOST_NOT_ALLOWED` | whole page replaced by 00-F07 | see 00-F07 | `GlobalWrongHost` |
| Already set up | `GET /setup` after provisioning (HTTP 404 with a styled page, M84) | full-screen info state, no form, no action | "This hub is already set up" / "To add a screen, open Approve a screen on a manager's phone or tablet." | `SetupAlready`, `setup-already.png` |
| Urdu RTL | language = Urdu | mirrored layout; fields stay LTR | see Urdu copy below | `SetupUrdu`, `setup-ur.png` |
| Narrow / phone | width < 760 px | two columns stack (`.pos-split` stacks) | same | `setup-phone.png` |

  Urdu copy (from `SetupUrdu`): brand "ریسٹورنٹ POS" / "ہب سیٹ اپ"; title "اس ہب کو سیٹ اپ کریں"; intro "آپ کو مالک یا سپورٹ سے رجسٹریشن کوڈ چاہیے۔ اس میں 12 حروف اور ہندسے ہوتے ہیں اور یہ ایک بار، 24 گھنٹے کے لیے چلتا ہے۔"; "رجسٹریشن کوڈ" / "ڈیش اور خالی جگہ سے فرق نہیں پڑتا۔"; "اس نیٹ ورک پر ہب کا پتا" / "وہ پتا جس سے اسکرینیں ہب کھولیں گی۔ اگر تار اور وائی فائی دونوں ہوں تو تار والا لکھیں۔"; "گاہکوں کے وائی فائی کی رینج (بند)" / "ان رینج پر فون POS نہیں کھول سکتے۔ کئی ہوں تو کوما سے الگ کریں۔"; button "ہب سیٹ اپ کریں"; aside "آگے کیا ہوگا": "ہب سیٹ اپ کریں" / "یہ کوڈ، پتا اور گاہکوں کا وائی فائی"; "مینیجر کا فون QR اسکین کرے" / "پہلا ایڈمن سائن اِن، 30 منٹ کے لیے"; "پہلی اسکرین منظور کریں" / "کیشیئر یا کچن اسکرین". Error, busy and "already set up" texts have no Urdu yet (UNKNOWN).

- **Error codes shown here:** `VALIDATION_FAILED`, `REGISTRATION_CODE_INVALID`, `REGISTRATION_CODE_KIND_UNSUPPORTED`, `SERVICE_UNAVAILABLE`, `SETUP_IN_PROGRESS`, `HOST_NOT_ALLOWED` (copy above).
- **Edge cases and limits:** hub with two network cards (Wi-Fi + Ethernet) — installer must pick the LAN one (pick list prevents this); opening the hub by hostname (`pos-hub.local`) → `HOST_NOT_ALLOWED`; double tap guarded by `SETUP_IN_PROGRESS`; the code works once, so the client does not retry by itself; cloud call can take up to 10 s.
- **Data needed:** writes `registration_code`, `advertised_host`, `guest_network_cidrs[]`; reads `first_admin_url`, `first_admin_expires_at`, `restarting`, `details.issues[].path`, `retry_after_ms`; server-rendered list of the machine's IPv4 addresses.

### 00-S02 · Hub is set up
- **Job:** hand the first-admin sign-in link to the owner or manager.
- **Entry points:** success on 00-S01.
- **Exits:** admin scans the QR (opens 00-S03 on their phone), or taps **Open sign-in here** (00-S03 on the laptop). Page refreshed after restart → `/setup` shows "already set up"; the QR is gone (use the hub CLI).
- **Information shown:**

| Item | Mark |
|---|---|
| OK icon + title "Hub is set up" | MUST |
| Body "Scan this with the owner's or manager's phone camera, or open the link on this laptop." | MUST |
| Status chip "Hub restarting…" (warn, sync icon) → "Hub is ready" (ok, check icon) | MUST |
| QR of `first_admin_url` on a white tile | MUST |
| The link in mono, LTR, wrapping (`http://192.168.0.107:3000/admin/bootstrap#t=…`) | USEFUL |
| Meta "Works once, for 30 minutes (until {time})" (HH:mm hub time) | MUST |

- **Actions:**

| Action | Mark | Result |
|---|---|---|
| **Wait for the restart** (disabled while restarting) → becomes **Open sign-in here** (link to `first_admin_url`) | PRIMARY | opens 00-S03 in this tab |

- **Inputs:** none.
- **Decisions:** scan on a phone or open on this laptop.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Restarting | right after setup; client polls `HEAD first_admin_url` (or `/healthz`) every 1 s | warn chip; button disabled | "Hub restarting…" / "Wait for the restart" | `SetupDone`, `setup-done.png` |
| Ready | link answers | ok chip; primary link enabled | "Hub is ready" / "Open sign-in here" | `SetupReady` |
| Link expired | client clock ≥ `first_admin_expires_at` | danger screen; QR replaced by a void box "QR expired"; meta shows the CLI command in mono | "This link has expired" / "It was valid for 30 minutes. Ask support to make a new first-admin link." / chip "Link expired" / "Make a new link on the hub:" `issue-admin-bootstrap` | `SetupLinkExpired` |

  Urdu: none in frames (UNKNOWN).
- **Error codes shown here:** none.
- **Edge cases:** page refreshed after restart → QR lost (hub CLI `issue-admin-bootstrap`, spec §6.34); link works once.
- **Data needed:** `first_admin_url`, `first_admin_expires_at`, `restarting`.

### 00-S03 · First admin sign-in
- **Job:** the first admin signs in once without a paired device, so they can approve the first screens.
- **Entry points:** QR or link from 00-S02, or a link from the hub CLI (`/admin/bootstrap#t=…`). The token is read from the URL hash and then removed from the address bar.
- **Exits:** success → 00-S05. Dead link → 00-S04. Hub busy after one silent retry → 00-F05.
- **Information shown:**

| Item | Mark |
|---|---|
| Caption "Restaurant POS · Hub admin" | USEFUL |
| Title "Sign in as the first admin" | MUST |
| Subtitle "Tap your name, then type your PIN." | MUST |
| Name tiles (admins only): name + first role name (`role_names`, e.g. "Owner", "Manager") | MUST |
| Locked tile: lock icon + "Locked · {min} min" (from `locked_until`, rounded up) | MUST |
| PIN card "PIN for {name}" + dots (never shows digits) | MUST |
| Error line / banner | MUST when present |

- **Actions:**

| Action | Mark | Result |
|---|---|---|
| Tap a name tile | SECONDARY | selects person, shows PIN pad |
| Digit keys 0–9, **Delete** | SECONDARY | type PIN |
| **Sign in** key (or 6th digit auto-submits) | PRIMARY | `POST /admin/auth/bootstrap { token, staff_id, pin }` |

- **Inputs:** PIN — masked dots, 4–6 digits, default empty, LTR; error "PIN is 4 to 6 digits". Name — tile pick (required; "Tap your name first." if missing, key `bootstrap.pick_first`).
- **Decisions:** which person signs in.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | roster loaded | tiles + PIN card | "Sign in as the first admin" / "Tap your name, then type your PIN." / "PIN for {name}" / keys "Delete" · "0" · "Sign in" | `BootSignIn` (phone), `BootSignInLaptop`, `boot-laptop.png` |
| Loading | fetching roster | 3 skeleton tiles | "Getting the staff list…" | `BootLoading` |
| Empty roster | no admins | empty block in card, no PIN pad | "No one can open the hub admin" / "No one on the staff list can open the hub admin. Ask the owner." | `BootNoAdmins` |
| Wrong PIN | `PIN_INVALID` | PIN pad shakes; tries left only when ≤ 2 | "Wrong PIN · {n} tries left" (frame: 2) | `BootWrongPin`, `boot-wrongpin.png` |
| Person locked | `PIN_LOCKED_OUT` | tile becomes locked; keys locked; danger banner | "Too many wrong PINs." / "{name} can try again in {min} min, or another admin can sign in." | `BootLocked` |
| This phone locked | `IP_LOCKED_OUT` | keys locked; banner | "Too many wrong PINs from this phone." / "Try again in {min} min." | `BootIpLocked` |
| PIN too short | `VALIDATION_FAILED` | error line | "PIN is 4 to 6 digits" | `BootShortPin` |
| Not an admin / removed | `PERMISSION_DENIED` or `STAFF_NOT_FOUND` (then roster refetched) | banner | "This person can't open the hub admin." / "Pick another name. If a name is gone from the list, that person was removed from the staff list." | `BootNotAdmin` |
| Hub busy | `SERVICE_UNAVAILABLE` after one silent retry | 00-F05 banner | "Hub busy, try again." / "Nothing was saved." | `GlobalBusy` |
| Link dead | `PAIRING_TOKEN_INVALID` | go to 00-S04 | — | `BootExpired` |
| Urdu RTL | language = Urdu | mirrored | see below | `BootUrdu`, `boot-phone-ur.png` |

  Urdu copy (from `BootUrdu`): "ریسٹورنٹ POS · ہب ایڈمن"; "پہلے ایڈمن کے طور پر سائن اِن کریں"; "اپنے نام پر ٹیپ کریں، پھر پن لکھیں۔"; roles "مالک", "مینیجر"; "لاک · 14 منٹ"; "پن برائے"; keys "مٹائیں", "سائن اِن". Error texts: no Urdu (UNKNOWN).
- **Error codes shown here:** `PIN_INVALID`, `PIN_LOCKED_OUT`, `IP_LOCKED_OUT`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `STAFF_NOT_FOUND`, `SERVICE_UNAVAILABLE`, `PAIRING_TOKEN_INVALID`.
- **Edge cases:** 6th digit submits automatically (max 7 taps for a 6-digit PIN); lock time shown from `locked_until`; staff limits: 5 wrong PINs → person locked 15 min; 10 failures in 5 min from one IP → IP locked.
- **Data needed:** reads roster `staff_id`, `display_name`, `role_names`, `locked_until`; writes `token`, `staff_id`, `pin`; reads `admin_session_token`, `permissions`; stores `admin_session_token`, `admin_staff_id`, `admin_bootstrap='1'` in `sessionStorage`.

### 00-S04 · First admin link expired
- **Job:** tell the person the link no longer works.
- **Entry points:** 00-S03 with a used, older-than-30-min or replaced link (`PAIRING_TOKEN_INVALID`).
- **Exits:** none (no action).
- **Information shown:** danger screen, clock icon (MUST); title "This link has expired" (MUST); body "Ask the installer for a new one. A link works once, for 30 minutes." (MUST).
- **Actions:** none.
- **Inputs:** none.
- **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | `PAIRING_TOKEN_INVALID` | full-screen danger | as above | `BootExpired`, `boot-expired.png` |
| Urdu RTL | Urdu | UNKNOWN (no Urdu frame) | — | none |

- **Error codes shown here:** `PAIRING_TOKEN_INVALID`.
- **Edge cases:** a newer link replaces an older one.
- **Data needed:** none.

### 00-S05 · Signed in — go to Approve
- **Job:** confirm sign-in and send the admin to approve the first screen.
- **Entry points:** success on 00-S03.
- **Exits:** **Approve a screen** → 00-S08 in the same tab (session lives in this tab only).
- **Information shown:** ok screen; title "Signed in as {name}" (MUST); caption "Keep this tab open. Closing it signs you out." (MUST); "You stay signed in for 1 hour without use." (USEFUL).
- **Actions:** **Approve a screen** (large, full width) — PRIMARY.
- **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | bootstrap success | ok screen | as above | `BootSignedIn` |
| Urdu RTL | Urdu | UNKNOWN (no Urdu frame) | — | none |

- **Error codes:** none. **Edge cases:** closing the tab ends the session. **Data needed:** `display_name`.

### 00-S06 · Approve — can't approve here
- **Job:** explain why a phone that scanned a screen's QR cannot approve it.
- **Entry points:** `/admin/approve?r=…` opened with no device token and no bootstrap admin session (e.g. manager's personal phone not yet paired).
- **Exits:** none.
- **Information shown:** info screen with screen icon (MUST); title "Can't approve on this phone" (MUST); body "Open this on a paired admin device and type the code there." (MUST); caption "Setting up a new hub? Use the first-admin link on the installer's laptop." (USEFUL).
- **Actions:** none. **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | no credentials | full-screen info; no request is sent | as above | `ApproveNotHere`, `approve-nothere.png` |
| Urdu RTL | Urdu | UNKNOWN (no Urdu frame) | — | none |

- **Error codes:** none. **Edge cases:** chicken-and-egg at setup — the manager's phone must be paired first (00-S17), or use the first-admin tab. **Data needed:** reads IndexedDB `pos-device` and `sessionStorage` only.

### 00-S07 · Approve — admin sign-in
- **Job:** a manager signs in on a paired device before approving.
- **Entry points:** `/admin/approve` (or `/admin`) on a paired device with no admin session in this tab; `ADMIN_SESSION_REQUIRED` from 00-S08.
- **Exits:** success → 00-S08 (or 00-S20 when entered from `/admin`). `DEVICE_REVOKED` / `DEVICE_TOKEN_INVALID` → 00-F02.
- **Information shown:** app bar title "Approve a screen" + chip "Manager sign-in" (USEFUL); heading "Who's approving?" (MUST); "Only people who can add screens are shown." (USEFUL); name tiles with role name (MUST); "PIN for {name}" + dots (MUST). On a phone the roster has only the phone's owner (one tile, pre-selected).
- **Actions:** name tile (SECONDARY); keys 0–9, Delete (SECONDARY); **Sign in** (PRIMARY) → `POST /admin/auth`.
- **Inputs:** PIN, 4–6 digits, masked; errors as 00-S03.
- **Decisions:** who approves.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | roster loaded (`GET /admin/login-roster`) | tiles left, PIN card right (tablet) | "Who's approving?" / "Only people who can add screens are shown." / "PIN for Imran" | `ApproveSignIn` |
| Loading / empty / wrong PIN / person locked / too short / not admin | same as 00-S03 | same as 00-S03 | same texts as 00-S03 | UNKNOWN (no separate frames; reuse 00-S03 frames) |
| Screen locked | `DEVICE_LOCKED_OUT` | keys locked; banner | "Too many wrong PINs on this screen · {min} min" / "Use another paired screen or wait." | `ApproveScreenLocked` |
| Device removed | `DEVICE_REVOKED` / `DEVICE_TOKEN_INVALID` | go to 00-F02 | — | `GlobalRepair` |
| Urdu RTL | Urdu | UNKNOWN (no Urdu frame) | — | none |

- **Error codes:** `PIN_INVALID`, `PIN_LOCKED_OUT`, `DEVICE_LOCKED_OUT`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `STAFF_NOT_FOUND`, `DEVICE_REVOKED`, `DEVICE_TOKEN_INVALID`, `SERVICE_UNAVAILABLE`.
- **Edge cases:** device lock = 10 failures in 5 min on this screen, 15 min lock.
- **Data needed:** roster `staff_id`, `display_name`, `role_names`, `locked_until`; writes `staff_id`, `pin`; reads `admin_session_token`, `permissions`.

### 00-S08 · Approve a screen — form
- **Job:** let one new kiosk or kitchen screen in.
- **Entry points:** 00-S05, 00-S07, 00-S20 / 00-S16 **Approve a screen** button, or scanning the screen's QR (`?r=`, code prefilled).
- **Exits:** Approve → 00-S09. Back link "Hub admin" → 00-S20. `ADMIN_SESSION_REQUIRED` → 00-S07.
- **Information shown:**

| Item | Mark |
|---|---|
| App bar: back "Hub admin", title "Approve a screen", signed-in staff name at the end | USEFUL |
| Chip "From the QR you scanned" (only with `?r=`) | USEFUL |
| Station tiles: name + small line (location label, or first 3 menu category names, e.g. "Naan, roti, kulcha") | MUST (kitchen only) |
| Aside "The new screen will open as" + preview ("Kitchen screen · Tandoor" / "Cashier screen") + line "It opens the station view and shows new tickets." / "It opens the staff sign-in." | USEFUL |
| Audit note "Approving is recorded with your name." | RARE |

- **Actions:**

| Action | Mark | Result |
|---|---|---|
| **Approve** (large, full width, check icon) | PRIMARY | `POST /admin/commands/approve-pairing-request { command_id, request_id?, display_code, device_type, station_id? }` |
| Back "Hub admin" | SECONDARY | 00-S20 |

- **Inputs:**

| Field | Type | Default | Validation | Error message |
|---|---|---|---|---|
| Code on the screen (`display_code`; `request_id` = `r`) | text, mono, code style, max 6, uppercase; help "6 letters and digits, shown big on the new screen." | prefilled from the request when `?r=`; else empty | A–Z without I L O U, and 0–9; 6 chars | "The code has 6 letters and digits" |
| What is this screen? (`device_type`) | segmented: **Cashier screen** (screen icon) / **Kitchen screen** (flame icon) | none (no default) | required | key `approve.err_kind` (text UNKNOWN) |
| Which station? (`station_id`) — kitchen only | tiles, 3 columns (1 on phone) | none | required for kitchen, forbidden for cashier | key `approve.err_station` (text UNKNOWN) |

- **Decisions:** cashier or kitchen; which station.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| From QR (kitchen) | `?r=` present | chip shown, code prefilled | "From the QR you scanned" | `ApproveForm`, `approve-form.png` |
| Typed code (cashier) | no `?r=` | no chip; no station field | — | `ApproveFormCashier` |
| Busy | tap Approve | button busy | "Approving…" | `ApproveFormBusy` |
| No screen waiting | `PAIRING_REQUEST_NOT_FOUND` (code expired or already approved) | field error on code | "No screen is waiting with this code. Check the code on the screen." | `ApproveNoRequest`, `approve-errors.png` |
| Bad code format | `VALIDATION_FAILED` | field error | "The code has 6 letters and digits" | `ApproveBadCode` |
| Station not set up | `STATION_NOT_FOUND` | banner | "This station is not set up." / "Add it in the owner app, then approve again." | `ApproveNoStation` |
| Read-only | `PERMISSION_DENIED` (no `manage-devices`) | form disabled; banner | "You can't add screens." / "Ask a manager." | `ApproveReadOnly` |
| Session gone | `ADMIN_SESSION_REQUIRED` | go to 00-S07 | — | `ApproveSignIn` |
| Hub unreachable | network | 00-F01 banner; values kept | "Can't reach the hub — retrying…" / "What is on screen stays. It clears by itself." | `GlobalHubDownBanner` |
| Hub busy | `SERVICE_UNAVAILABLE` after retry | 00-F05 banner + inline Try again | "Hub busy, try again." / "Nothing was saved." / "Try again" | `GlobalBusy` |
| No stations loaded | `stations` query returns empty (no branch config yet) | UNKNOWN (no frame) | UNKNOWN | none |
| Phone | width 390 | one column, station tiles 1 column, no aside | — | `ApprovePhone`, `approve-phone.png` |
| Urdu RTL | Urdu | mirrored | see below | `ApproveUrdu`, `approve-form-ur.png` |

  Urdu copy (from `ApproveUrdu`): "ہب ایڈمن"; "اسکرین منظور کریں"; "اسکین کیے گئے QR سے"; "اسکرین پر لکھا کوڈ"; "6 حروف اور ہندسے، نئی اسکرین پر بڑے لکھے ہیں۔"; "یہ کون سی اسکرین ہے؟"; "کیشیئر اسکرین"; "کچن اسکرین"; "کون سا اسٹیشن؟"; "تندور" / "نان، روٹی، کلچہ"; "کڑاہی کاؤنٹر" / "کڑاہی فی کلو، ہانڈی"; "دیگ" / "پائے، نہاری، چنے"; button "منظور کریں"; "نئی اسکرین یوں کھلے گی"; "کچن اسکرین · تندور"; "یہ اسٹیشن کا منظر کھولے گی اور نئی ٹکٹیں دکھائے گی۔". Error and audit texts: no Urdu.
- **Error codes:** `PAIRING_REQUEST_NOT_FOUND`, `VALIDATION_FAILED`, `STATION_NOT_FOUND`, `PERMISSION_DENIED`, `ADMIN_SESSION_REQUIRED`, `SERVICE_UNAVAILABLE`.
- **Edge cases:** taps — from QR 3 (type, station, Approve); typed 8 (cashier) / 9 (kitchen). Waiter tablets: a third option "Waiter tablet" is **blocked** (Q5), so only two types are built. Pairing request expires after 10 min.
- **Data needed:** reads `GET /admin/queries/stations` → `station_id`, `name`, `location_label`, `category_names`; request `r`; writes `command_id` (ULID), `request_id`, `display_code`, `device_type` (`cashier_kiosk` | `kds`), `station_id`; uses `admin_session_token` and device id from IndexedDB.

### 00-S09 · Approve — result
- **Job:** show whether the screen was approved.
- **Entry points:** Approve on 00-S08.
- **Exits:** **Approve another** → empty 00-S08; **Hub admin** → 00-S20; **Try again** → back to the filled 00-S08.
- **Information shown:** ok screen title "Screen approved" + body "{station} kitchen screen will open in a few seconds." or "The cashier screen will open in a few seconds." (MUST). Error: danger screen "Not approved" + the error text (MUST).
- **Actions:** success — **Approve another** (PRIMARY), **Hub admin** link (SECONDARY). Failure — **Try again** (PRIMARY).
- **Inputs:** none. **Decisions:** approve another or finish.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Approved | 200 | ok screen | "Screen approved" / "Tandoor kitchen screen will open in a few seconds." / "Approve another" / "Hub admin" | `ApproveDone`, `approve-done.png` |
| Not approved | error answer | danger screen | "Not approved" / (error text, e.g. "No screen is waiting with this code. Check the code on the screen.") / "Try again" | `ApproveFailed` |
| Urdu RTL | Urdu | UNKNOWN (no frame) | — | none |

- **Error codes:** any 00-S08 code, shown with its text.
- **Edge cases:** the new screen opens by itself after its next poll (≤ 2 s).
- **Data needed:** station name, `device_type`.

### 00-S10 · Pair this screen
- **Job:** a new kiosk or kitchen screen shows a code and QR until a manager approves it.
- **Entry points:** a new screen opens `/pair` (no stored device token); 00-F02 / 00-F08 **Pair again**; 00-S11 **Get a new code**.
- **Exits:** approved → kiosk to 02-S01, kitchen screen to 03b-S01 (station session). Expired / refused → 00-S11. Guest network → 00-F03.
- **Information shown (dark theme):**

| Item | Mark |
|---|---|
| Title "Ask a manager to pair this screen" | MUST |
| How-to "On a manager's phone or tablet: open Approve a screen, then scan this QR or type the code." | MUST |
| QR of `approve_url` on a white tile (scannable from ≥ 1 m) | MUST |
| Display code, e.g. `7KQ2XD`, 72 px code-display, accent underline, LTR (readable at 3 m) | MUST |
| Countdown "Expires in {m:ss}" with clock icon | USEFUL |

- **Actions:** none (screen waits).
- **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Starting | page opened, `POST /pair/requests` sent | no code yet | "Getting a pairing code…" / "This takes a few seconds." | `PairStarting` |
| Waiting (KDS) | code received; polls `GET /pair/requests/:id` every 2 s | code + QR + countdown | as above, "Expires in 9:41" | `PairWaiting`, `pair-kds.png` |
| Waiting (kiosk) | same, 1280 | same layout at 1280 | same | `PairKiosk` |
| Hub unreachable | poll fails | warn pulsing banner; code kept; retry 0.5 → 5 s | "Can't reach the hub — retrying…" / "The code still works. Nothing to do." | `PairHubDown` |
| Approved | poll returns approved | ok screen | "Paired" / "Opening the {station} kitchen screen…" (generic text if a screen resumes without a fresh approval) | `PairApproved` |
| Already paired | stored token exists | silent: skip to login / station session | — | none |
| Revoked | request revoked | silent: back to Starting | — | none |
| Urdu RTL | Urdu | mirrored; code and QR LTR | "مینیجر سے کہیں کہ اس اسکرین کو جوڑیں" / "مینیجر کے فون یا ٹیبلٹ پر «اسکرین منظور کریں» کھولیں، پھر یہ QR اسکین کریں یا کوڈ لکھیں۔" / "ختم ہونے میں 9:41" | `PairUrdu`, `pair-kiosk-ur.png` |

- **Error codes:** `PAIRING_REQUEST_NOT_FOUND` (poll) → 00-S11; `GUEST_NETWORK_FORBIDDEN` → 00-F03; `IP_LOCKED_OUT`, `SERVICE_UNAVAILABLE` → 00-S11.
- **Edge cases:** code valid 10 min; `poll_secret` kept in memory only; KDS replaced mid-service.
- **Data needed:** `request_id`, `display_code`, `approve_url`, `expires_at`, `poll_secret`; on approval `device_token`, `device_id`, `device_type`, `station_name` (stored in IndexedDB).

### 00-S11 · Pair this screen — expired / couldn't ask
- **Job:** tell the screen's user why there is no code and let them get a new one.
- **Entry points:** 00-S10 code expired, too many requests, or hub busy.
- **Exits:** **Get a new code** → 00-S10 (`POST /pair/requests`).
- **Information shown:** title "Ask a manager to pair this screen" (MUST); cause line (MUST).
- **Actions:** **Get a new code** — PRIMARY, 72 px tall.
- **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Code expired | `expires_at` passed / `PAIRING_REQUEST_NOT_FOUND` on poll | cause line + button | "This code has expired. Get a new one, then ask again." / "Get a new code" | `PairExpired` |
| Too many codes | `IP_LOCKED_OUT` | button disabled with countdown | "Too many new codes from this screen. Wait {min} min, then get a new one." / "Get a new code in {m:ss}" | `PairTooMany` |
| Hub busy | `SERVICE_UNAVAILABLE` after one silent retry | cause line + button | "The hub is busy and couldn't make a code." / "Get a new code" | `PairHubBusy` |
| Guest network | `GUEST_NETWORK_FORBIDDEN` | 00-F03 | — | `GlobalWifiTablet` |
| Urdu RTL | Urdu | UNKNOWN (no frame) | — | none |

- **Error codes:** `PAIRING_REQUEST_NOT_FOUND`, `IP_LOCKED_OUT`, `SERVICE_UNAVAILABLE`, `GUEST_NETWORK_FORBIDDEN`.
- **Edge cases:** per-IP cap on pairing requests.
- **Data needed:** `retry_after_ms`.

### 00-S12 · Pair this phone — name it
- **Job:** a staff member pairs their own phone from a QR their manager made.
- **Entry points:** scanning the QR from 00-S17 with the phone camera (`/pair?t=`); iPhone after opening from the Home Screen (00-S13).
- **Exits:** success → 00-S15. `PAIRING_TOKEN_INVALID` → 00-S14. Already paired → straight to login (02-S01).
- **Information shown (light theme, 16 px gutters):** caption "Restaurant POS" (USEFUL); title "Pair this phone" (MUST); "Your manager made this link for you. Give the phone a name your manager will recognise." (MUST); caption "Only you can sign in on this phone." (USEFUL).
- **Actions:** **Pair this phone** (large, full width, phone icon) — PRIMARY → `POST /devices/pair { pairing_token, device_name, device_type: 'phone', pair_request_id }`.
- **Inputs:** Phone name (`device_name`) — text, max 40, `enterkeyhint=done`; help "e.g. Bilal's phone · up to 40 letters"; default empty; 1–40 characters; error "Give the phone a name, up to 40 letters."
- **Decisions:** what to call the phone.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | page load (Android, or iOS standalone) | name field + button | as above | `PhoneName`, `phone-name.png` |
| Name missing | empty / > 40 | field error | "Give the phone a name, up to 40 letters." | `PhoneNameError` |
| Busy | tap Pair | button busy | "Pairing…" | `PhoneNameBusy` |
| Hub unreachable | network | warn banner on top; button disabled; name kept | "Can't reach the hub — retrying…" / "Stay on the staff Wi-Fi. Your name is kept." | `PhoneHubDown` |
| QR expired / used | `PAIRING_TOKEN_INVALID` | go to 00-S14 | — | `PhoneExpired` |
| Paired | 200 | go to 00-S15 | — | `PhonePaired` |
| Urdu RTL | Urdu | mirrored | "ریسٹورنٹ POS"; "یہ فون جوڑیں"; "آپ کے مینیجر نے یہ لنک صرف آپ کے لیے بنایا ہے۔ فون کو ایسا نام دیں جو مینیجر پہچان لے۔"; "فون کا نام"; placeholder "بلال کا فون"; "مثلاً: بلال کا فون · زیادہ سے زیادہ 40 حروف"; button "یہ فون جوڑیں"; "اس فون پر صرف آپ سائن اِن کر سکیں گے۔" | `PhoneUrdu`, `phone-name-ur.png` |

- **Error codes:** `PAIRING_TOKEN_INVALID`, `GUEST_NETWORK_FORBIDDEN` (→ 00-F03).
- **Edge cases:** `pair_request_id` generated once per page load and reused on retry after a lost answer; phone on the customer Wi-Fi → 00-F03.
- **Data needed:** writes `pairing_token` (from `t`), `device_name`, `device_type`, `pair_request_id`; reads `device_token`, `owner_name`.

### 00-S13 · iPhone — Add to Home Screen
- **Job:** stop iPhone users pairing inside Safari (Safari cannot keep them signed in) and show them how to add the POS to the Home Screen.
- **Entry points:** `/pair?t=` opened in iOS Safari, not standalone.
- **Exits:** user adds to Home Screen and opens the new icon → 00-S12 inside the home-screen app.
- **Information shown:** title "Add to Home Screen, then open it from there" (MUST); body "Safari can't keep you signed in. The POS works from its Home Screen icon." (MUST); 3 numbered steps with icons — 1 "Tap Share at the bottom of Safari" (share icon), 2 "Tap "Add to Home Screen", then Add" (add-home icon), 3 "Open the new POS icon on your Home Screen" (phone icon) (MUST); info banner "This link works for 10 minutes." (USEFUL).
- **Actions:** none. Never calls `/devices/pair`. URL (with `?t=`) is left untouched.
- **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | iOS + not standalone | steps | as above | `PhoneIos`, `phone-ios.png` |
| Urdu RTL | Urdu | mirrored | "ہوم اسکرین پر شامل کریں، پھر وہیں سے کھولیں" / "Safari میں آپ سائن اِن نہیں رہ سکتے۔ POS ہوم اسکرین والے آئیکن سے چلتا ہے۔" / "نیچے «شیئر» پر ٹیپ کریں" / "«ہوم اسکرین میں شامل کریں» پر ٹیپ کریں" / "ہوم اسکرین پر نیا POS آئیکن کھولیں" / "یہ لنک 10 منٹ چلتا ہے۔" | `PhoneIosUrdu` |

- **Error codes:** none.
- **Edge cases:** QR expires (10 min) before the user opens the icon → 00-S14 in the home-screen app; old icon can be deleted.
- **Data needed:** user agent, `navigator.standalone`.

### 00-S14 · Pair this phone — QR expired / used
- **Job:** tell the staff member to get a new QR.
- **Entry points:** `PAIRING_TOKEN_INVALID` on 00-S12; phone whose storage was cleared reopening the old link.
- **Exits:** none (go to the manager).
- **Information shown:** danger screen, clock icon; title "Ask a manager for a new QR" (MUST); body "This QR works once, for 10 minutes." (Android) or "Then add the new link to your Home Screen; you can delete the old icon." (iPhone) (MUST).
- **Actions:** none. **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Android / other | token invalid | danger screen | "Ask a manager for a new QR" / "This QR works once, for 10 minutes." | `PhoneExpired` |
| iPhone | token invalid in home-screen app | danger screen, iOS body | "Ask a manager for a new QR" / "Then add the new link to your Home Screen; you can delete the old icon." | `PhoneExpiredIos` |
| Urdu RTL | Urdu | UNKNOWN (no frame) | — | none |

- **Error codes:** `PAIRING_TOKEN_INVALID`.
- **Edge cases:** re-pairing creates a new device row; old one stays until removed.
- **Data needed:** none.

### 00-S15 · Paired — opening sign-in
- **Job:** confirm pairing and hand over to staff sign-in.
- **Entry points:** success on 00-S12.
- **Exits:** automatic redirect to 02-S01 after 1.5 s (roster shows only the owner).
- **Information shown:** ok screen; title "This phone is paired" (MUST); body "Opening sign-in… Only {owner}'s name will be on it." (MUST).
- **Actions:** none. **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | 200 from `/devices/pair` | ok screen, then redirect | as above (`owner_name`; generic text when null) | `PhonePaired` |
| Urdu RTL | Urdu | UNKNOWN (no frame) | — | none |

- **Error codes:** none. **Edge cases:** none. **Data needed:** `owner_name`.

### 00-S16 · Screens and phones
- **Job:** see every paired device and who is on it; remove a lost or broken one.
- **Entry points:** 00-S20 side nav "Screens and phones" or its tile.
- **Exits:** **Remove** → 00-D01; **Add a phone** → 00-S17; **Approve a screen** → 00-S08.
- **Information shown:**

| Item | Mark |
|---|---|
| Group headers with counts, in this order: Cashier screens, Kitchen screens, Tablets, Phones, Removed | MUST |
| Name (`device_name`) with type icon | MUST |
| Type line: "Cashier screen" / "Kitchen screen · {station}" / "Waiter tablet" / "Phone · {owner} only" | MUST |
| Chip "This screen" on the device in use | USEFUL |
| Paired: "{date} · by {name}" ("18 Oct · by Arif", "Today 13:02 · by Imran") | RARE |
| How paired: "Screen code" / "Phone QR" (as built: "Screen code" / "QR link") | RARE |
| Last seen: "Now" (< 30 s), "10 s ago", "1 min ago", "3 h ago" | MUST |
| Warn chip "Not seen for {n} min" (kitchen screen silent > 2 min) | MUST |
| Signed in now: person name / "Kitchen screen" / "—" | USEFUL |
| Removed rows (muted): danger chip "Removed {date} · {reason}" ("Removed 20 Oct · Lost on the family hall floor") | RARE |
| Column heads: Screen or phone · Paired · Last seen · Signed in now | USEFUL |

- **Actions:**

| Action | Mark | Result |
|---|---|---|
| **Approve a screen** (app bar, plus icon) | PRIMARY | 00-S08 |
| **Add a phone** (qr icon) | SECONDARY | 00-S17 |
| **Show removed** switch | RARE | refetch with `include_revoked=true` |
| **Remove** (per row, outlined danger) | DESTRUCTIVE | 00-D01 |

- **Inputs:** Show removed switch, default off.
- **Decisions:** which device to remove.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | list loaded | grouped list | as above | `Devices`, `admin-devices.png` |
| Loading | fetching | skeleton rows under the column heads | — | `DevicesLoading` |
| First run | only this device | one row + accent callout + Add a phone | "Add the other screens" / "Open Pair on each new screen, then approve its code here. Make a QR for each waiter's phone." | `DevicesEmpty` |
| Show removed | switch on | "Removed" group, muted rows with reason | "Removed 20 Oct · {reason}", "Removed today 13:04 · Screen broke at lunch" | `DevicesRemoved` |
| Read-only | no `manage-devices` | no Remove, no Add a phone, no Approve; info banner | "You can see screens and phones but can't remove them." / "Ask a manager." | `DevicesReadOnly`, `admin-devices-ro.png` |
| Hub unreachable | network | warn banner; list kept; Remove disabled | "Can't reach the hub — retrying…" / "Showing the list from {time}. Remove works again when the hub answers." | `DevicesOffline` |
| Removed (success) | 00-D01 success | ok banner | "{name} removed." / "It stopped working and anyone on it was logged out." | `DevicesRemovedOk` |
| Already removed | `already_revoked: true` | ok banner | "{name} was already removed." | none (copy only) |
| Not found | `DEVICE_NOT_FOUND` | info banner + refetch | "This screen or phone is no longer on the list." | none (copy only) |
| Phone | width 390 | stacked rows; Remove beside the name; "Approve" primary at top; meta line "Seen 10 s ago · Kitchen screen" | as frame | `DevicesPhone`, `admin-devices-phone.png` |
| Urdu RTL | Urdu | mirrored | see below | `DevicesUrdu`, `admin-devices-ur.png` |

  Urdu copy (from `DevicesUrdu`): nav "عارف چٹخارہ" · "ہب ایڈمن" · "اسکرینیں اور فون" · "ابھی سائن اِن" · "لاک ہوئے" · "دوسرے کام" · "اسٹاک" · "کچن کی گنجائش" · "پرنٹر" · "بیک اپ اور سنک" · "عمران · مینیجر" · "سائن آؤٹ"; title "اسکرینیں اور فون"; "ہٹائے گئے بھی دکھائیں"; "اسکرین منظور کریں"; heads "اسکرین یا فون | کب جوڑا | آخری بار دیکھا | ابھی سائن اِن"; "کچن اسکرینیں"; "کچن اسکرین · تندور"; "آج"; "· عمران نے"; "ابھی"; "6 منٹ سے نظر نہیں آئی"; "کچن اسکرین"; "ہٹائیں"; "فون"; "حمزہ کا فون"; "فون · صرف حمزہ"; "3 گھنٹے پہلے". (The Urdu frame has no Add a phone button — see §6.)
- **Error codes:** `DEVICE_NOT_FOUND`, `PERMISSION_DENIED`.
- **Edge cases:** a branch has tens of devices (list returned whole); removing the device you are using → ends your own session (00-D01 warning); kitchen screen offline (tickets fall back to auto-print in 03b) shows warn; refresh only on open and after actions.
- **Data needed:** `GET /admin/queries/devices?include_revoked=` → `device_id, device_name, device_type, station_id, owner_staff_id, owner_name, pairing_source, paired_at, paired_by_name, last_seen_at, revoked_at, revoked_by_name, revoked_reason, active_session { session_id, kind, staff_id, display_name }`; station names from 01a config; current `device_id`.

### 00-D01 · Remove a screen or phone
- **Job:** confirm removing one device, with an optional reason.
- **Entry points:** **Remove** on a 00-S16 row.
- **Exits:** Cancel → 00-S16. Remove → 00-S16 with ok banner; if it was this device → 00-F02.
- **Information shown:** title "Remove {name}?" (MUST); body "It will stop working at once and anyone logged in on it is logged out." (MUST); warn banner when it is this device: "This is the screen you are using." / "You will be signed out here, and it must be paired again before anyone can use it." (MUST when shown); reason help "Shown in the device list and the audit log · {n} / 200" (USEFUL).
- **Actions:** **Cancel** (SECONDARY); **Remove** (x icon, outlined danger) — DESTRUCTIVE and the dialog's main action → `POST /admin/commands/revoke-device { command_id, device_id, reason? }`.
- **Inputs:** Reason (optional) — text, max 200, default empty, counter "29 / 200"; no error message designed beyond the length limit (UNKNOWN).
- **Decisions:** remove or not; reason.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | Remove tapped | dialog | as above | `DevicesRemoveDialog`, `admin-remove-dialog.png` |
| This device | `device_id` = current | warn banner added | "This is the screen you are using." / "You will be signed out here, and it must be paired again before anyone can use it." | `DevicesRemoveSelf` |
| Busy / error | request in flight / failure | UNKNOWN (no frame) | — | none |
| Urdu RTL | Urdu | UNKNOWN (no frame) | — | none |

- **Error codes:** `DEVICE_NOT_FOUND` ("This screen or phone is no longer on the list."), `already_revoked` result ("{name} was already removed.").
- **Edge cases:** removal is audited.
- **Data needed:** `device_id`, `device_name`, `reason`, `command_id`.

### 00-S17 · Add a phone for staff
- **Job:** make a one-time QR that pairs one person's phone.
- **Entry points:** **Add a phone** on 00-S16; tile "Add a phone for staff" on 00-S20.
- **Exits:** **Done** → 00-S16. Back link "Screens and phones".
- **Information shown:**

| Item | Mark |
|---|---|
| Title "Add a phone for staff"; heading "Whose phone is it?" | MUST |
| Help "The QR pairs one phone. Only this person can sign in on it." | USEFUL |
| Name tiles (4 columns): name + "{role} · Has {n} phone" / "{role} · No phone yet" | MUST |
| Bottom action bar: selected person | USEFUL |
| QR step: "{name} scans this with their phone camera" (frame: "Ali scans this with his phone camera") | MUST |
| "Not the POS app: the normal camera. The link opens the POS on their phone." | USEFUL |
| QR image | MUST |
| Warn chip "Works once, for 10 minutes · {m:ss}" | MUST |
| `pair_url` in mono | RARE |

- **Actions:**

| Action | Mark | Result |
|---|---|---|
| Search "Find a name" | SECONDARY | filters tiles |
| Pick a name tile | SECONDARY | selects |
| **Make QR** (qr icon, large) | PRIMARY (pick step) | `POST /admin/commands/generate-device-pairing-token { command_id, device_type: 'phone', owner_staff_id }` |
| **Done** (check icon) | PRIMARY (QR step) | 00-S16 |
| **Make a new QR** (reload icon) | SECONDARY (PRIMARY in expired state) | new token |

- **Inputs:** search text (default empty, no validation); one person (required).
- **Decisions:** whose phone.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Pick person | open | search + tiles + action bar | as above | `AddPhonePick`, `admin-addphone.png` |
| QR shown | Make QR success | QR card + countdown | "Works once, for 10 minutes · 9:41" | `AddPhoneQr`, `admin-addphone-qr.png` |
| QR expired | 10 min passed | void box + danger chip; primary Make a new QR | "This QR has expired" / "Expired" / "Make a new QR" | `AddPhoneExpired` |
| QR on manager's phone | width 390 | single column QR | same copy | `AddPhoneQrPhone` |
| Read-only | no `manage-devices` | page/tile hidden | — | none |
| Loading / empty / no match | — | UNKNOWN (no frames) | — | none |
| Urdu RTL | Urdu | UNKNOWN (no frame) | — | none |

- **Error codes:** `PERMISSION_DENIED`, `SERVICE_UNAVAILABLE` (00-F05).
- **Edge cases:** person already has a phone (allowed; a new row); person has left (not in the list); no "Copy link" button (insecure origin); generation is audited; 2 taps.
- **Data needed:** `GET /admin/queries/staff` → `staff_id, display_name, role_names, phone_count`; result `pair_qr_svg` (inline, sanitised), `pair_url`, expiry (now + 10 min).

### 00-S18 · Signed in now
- **Job:** see who is signed in on which device, and log someone out.
- **Entry points:** 00-S20 nav "Signed in now" or its tile.
- **Exits:** **Log out** → 00-D02.
- **Information shown:**

| Item | Mark |
|---|---|
| Caption "Refreshed {time}" | USEFUL |
| Column heads Who · On · Last activity | USEFUL |
| Who: name (user icon) or station name (flame icon) | MUST |
| Kind + since: "Staff · since 11:40" / "Hub admin · since 12:02" / "Kitchen screen · since 07:00" | USEFUL |
| Chip "You" on own row | USEFUL |
| On: device name | MUST |
| Last activity: "Now" / "1 min ago" | MUST |
| Idle rule: "Signs out after 5 min idle" / "Signs out after 1 h idle" / "Stays on until a manager ends it"; warn "Signs out in {n} min" with clock when < 2 min left | USEFUL |

- **Actions:** **Refresh** (reload icon) — SECONDARY; **Log out** per row (logout icon) — DESTRUCTIVE (hidden on own row and without `manage-staff`). No primary action on this page.
- **Inputs:** none. **Decisions:** whom to log out.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | loaded | list | as above | `Sessions`, `admin-sessions.png` |
| Read-only | no `manage-staff` | no Log out buttons; info banner | "You can see who is signed in but can't log anyone out." / "Ask a manager." | `SessionsReadOnly` |
| Logged out | 00-D02 success | ok banner | "{name} logged out of {device}." / "Anything he hadn't sent stays on the tablet." (frame) | `SessionsDone` |
| Already ended | `already_ended` / `SESSION_NOT_FOUND` | banner + refetch | "Already logged out." | none (copy only) |
| Loading / empty / hub down | — | UNKNOWN (no frames; hub down uses 00-F01 banner) | — | none |
| Urdu RTL | Urdu | UNKNOWN (no frame) | — | none |

- **Error codes:** `SESSION_NOT_FOUND`, `PERMISSION_DENIED`.
- **Edge cases:** a kitchen screen cannot log itself out (`STATION_LOGOUT_NOT_ALLOWED`), but a manager can end it here.
- **Data needed:** `GET /admin/queries/sessions` → `session_id, kind, staff_id, display_name, station_id, device_id, device_name, started_at, last_activity_at, idle_ttl_ms`.

### 00-D02 · Log someone out
- **Job:** confirm ending one session.
- **Entry points:** **Log out** on 00-S18.
- **Exits:** Cancel / success → 00-S18.
- **Information shown:** staff: title "Log {name} out of {device}?" + body "Anything they haven't sent stays on the {device}. They can sign in again with their PIN." (frame: "Log Bilal out of Tablet 2?" / "Anything he hasn't sent stays on the tablet. He can sign in again with his PIN."). Kitchen: "End the {station} kitchen screen session?" + "The {station} screen goes back to its start screen. Its tickets stay on the hub and print if no kitchen screen shows them." (MUST).
- **Actions:** **Cancel** (SECONDARY); **Log out** / **End session** (DESTRUCTIVE, main action) → `POST /admin/commands/force-logout-session { command_id, session_id }`.
- **Inputs:** none. **Decisions:** confirm.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Staff session | staff row | dialog | as above | `SessionsLogoutDialog` |
| Kitchen session | station row | dialog | as above | `SessionsEndKdsDialog` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** `SESSION_NOT_FOUND` → "Already logged out."
- **Edge cases:** what the KDS shows after its session is ended is owned by 03b (Q10).
- **Data needed:** `session_id`, `display_name`, `device_name`, `station` name.

### 00-S19 · Locked out
- **Job:** clear a PIN lockout so a locked waiter (or screen, or address) can work again.
- **Entry points:** 00-S20 nav "Locked out" or its tile (danger chip when someone is locked).
- **Exits:** **Unlock** → 00-D03.
- **Information shown:**

| Item | Mark |
|---|---|
| Caption "Refreshed {time}" | USEFUL |
| Section **People**: name + "5 wrong PINs · until {time}" + danger chip "Locked · {min} min" | MUST |
| Section **Screens**: device name + "5 wrong PINs on this screen · until {time}" + chip | USEFUL |
| Section **Addresses**: IP (LTR) + "First-admin sign-in · until {time}" + chip | RARE |
| Column heads Who or what · Locked | USEFUL |
| Phone: danger banner for the newest person lockout "{name} is locked out" / "They typed a wrong PIN 5 times." (frame: "He typed a wrong PIN 5 times.") | MUST |

- **Actions:** **Refresh** (SECONDARY); **Unlock** per row (unlock icon, SECONDARY); phone: block primary "Unlock {name}" (PRIMARY on phone).
- **Inputs:** none. **Decisions:** whom to unlock.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | loaded | three sections | as above | `Lockouts`, `admin-lockouts.png` |
| Nobody locked | all lists empty | each section shows a check line | "No one is locked out." / "No screen is locked." / "No address is locked." | `LockoutsEmpty` |
| Unlocked | 00-D03 success | ok banner; row gone | "{name} unlocked." / "They can try their PIN again now." (frame: "He can try his PIN again now.") | `LockoutsDone` |
| Already unlocked | `cleared: false` | banner | "Already unlocked." | none (copy only) |
| Read-only | no `manage-staff` | no Unlock; info banner | "You can see lockouts but can't clear them." / "Ask a manager." | `LockoutsReadOnly` |
| Phone (rush) | width 390 | banner + stacked rows + block Unlock | "Bilal is locked out" / "He typed a wrong PIN 5 times." / "Bilal" "Waiter · until 13:32" "Locked · 14 min" / "Unlock Bilal" / "Counter 2" "Screen · until 13:27" "Unlock" | `LockoutsPhone`, `admin-lockouts-phone.png` |
| Urdu RTL (phone) | Urdu | mirrored | "لاک ہوئے" / "بلال لاک ہو گیا ہے" / "اس نے 5 بار غلط پن لکھا۔" / "ویٹر · 13:32 تک" / "لاک · 14 منٹ" / "بلال کا لاک کھولیں" / "کاؤنٹر 2" / "اسکرین · 13:27 تک" / "لاک کھولیں" | `LockoutsUrdu`, `admin-lockouts-phone-ur.png` |

- **Error codes:** `PERMISSION_DENIED`.
- **Edge cases:** lock lasts 15 min; target ≤ 4 taps on a manager's phone after sign-in (Hub admin → Locked out → Unlock Bilal → Unlock).
- **Data needed:** `GET /admin/queries/lockouts` → `staff[{staff_id, display_name, locked_until}]`, `devices[{device_id, device_name, locked_until}]`, `ips[{ip, locked_until}]`, sorted by `locked_until` desc.

### 00-D03 · Unlock
- **Job:** confirm clearing one lockout.
- **Entry points:** **Unlock** on 00-S19.
- **Exits:** Cancel / success → 00-S19.
- **Information shown:** person: "Unlock {name} now?" + "They can try their PIN again. This is recorded with your name." (frame: "He can try his PIN again. …"); address: "Unlock {ip}?" + "The phone or laptop at this address can try a first-admin PIN again." (MUST).
- **Actions:** **Cancel** (SECONDARY); **Unlock** (PRIMARY of the dialog) → `POST /admin/commands/clear-pin-lockout { command_id, subject_type: 'staff'|'device'|'ip', subject_id }`.
- **Inputs:** none. **Decisions:** confirm.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Person / screen | staff or device row | dialog | as above | `LockoutsUnlockDialog` |
| Address | IP row | dialog with IP in mono | as above | `LockoutsUnlockIpDialog` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** none specific (`cleared: false` → "Already unlocked.").
- **Edge cases:** audited.
- **Data needed:** `subject_type`, `subject_id`.

### 00-S20 · Hub admin home
- **Job:** one place for a manager to reach every hub admin job.
- **Entry points:** `GET /admin` (sign-in as 00-S07 if no admin session); "Hub admin" links on 00-S08/S09.
- **Exits:** side nav / tiles → 00-S16, 00-S17, 00-S18, 00-S19; **Approve a screen** → 00-S08; Other jobs → 01a stock (`/admin/stock`), 03a, 03b, 06; **Sign out** → `POST /admin/auth/logout`.
- **Information shown:**

| Item | Mark |
|---|---|
| Side nav brand: restaurant name / "Hub admin" | USEFUL |
| Nav items with counts: Hub admin · Screens and phones ({n}) · Signed in now ({n}) · Locked out ({n}) | MUST |
| Nav caption "Other jobs": Stock · Kitchen capacity · Printers · Backup and sync | USEFUL |
| Nav foot "{name} · {role}" (frame "Imran · Manager") | USEFUL |
| Line "Branch hub · {host}" | RARE |
| Tiles: "Screens and phones" / "{n} paired" (+ warn chip "{station} kitchen screen not seen for {n} min"); "Add a phone for staff" / "Make a QR one person scans"; "Signed in now" / "{n} people and kitchen screens"; "Locked out" / "After 5 wrong PINs" (+ danger chip "{name} locked · {min} min") | MUST |
| "Other jobs" tiles: Stock / "Morning count, fresh batches"; Kitchen capacity / "How busy each station is"; Printers / "Kitchen and bill printers"; Backup and sync / "Last backup {time}" | USEFUL |

- **Actions:** **Approve a screen** (app bar, plus) — PRIMARY; tiles and nav items — SECONDARY; **Sign out** — SECONDARY.
- **Inputs:** none. **Decisions:** which job.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | signed in | shell + tiles | as above | `AdminHome`, `admin-home.png` |
| Kitchen screen silent | `last_seen_at` > 2 min | warn chip on tile | "Degh kitchen screen not seen for 6 min" | `AdminHome` |
| Someone locked | any lockout | danger chip on tile | "Bilal locked · 14 min" | `AdminHome` |
| Limited permissions | admin lacks a permission | items hidden (no `manage-devices` → no Approve, no Add a phone tile) | — | none |
| Other jobs not built | target module page does not exist | menu item hidden (as built: Stock only when `/admin/stock` exists) | — | none |
| Phone | width ≤ 760 px | phone layout | UNKNOWN details | `admin-home-phone.png` |
| Urdu RTL | Urdu | nav labels as in `DevicesUrdu` | see 00-S16 Urdu | none for home |
| Hub down | network | 00-F01 | — | none |

- **Error codes:** `PERMISSION_DENIED`, `ADMIN_SESSION_REQUIRED`.
- **Edge cases:** same shell hosts 00-S16…S19 and should host 01a stock, 03a, 03b, 06 pages.
- **Data needed:** counts from `GET /admin/queries/devices`, `/sessions`, `/lockouts`; `permissions`; restaurant name; signed-in name and role.

### 00-F01 · Can't reach the hub
- **Job:** keep people calm when the hub does not answer.
- **Entry points:** any hub page — fetch/WebSocket fails, WS close `1012`.
- **Exits:** clears by itself when the hub answers.
- **Information shown:** banner (working screen) or full screen (nothing loaded): title "Can't reach the hub — retrying…" (MUST); body (MUST).
- **Actions:** none.
- **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Full screen | nothing ever loaded | warn screen | "Can't reach the hub — retrying…" / "Check that the hub box in the back room has power. This screen opens by itself when it answers." | `GlobalHubDown` |
| Banner | page has data | pulsing warn banner; data kept; hub actions disabled | "Can't reach the hub — retrying…" / "What is on screen stays. It clears by itself." | `GlobalHubDownBanner` |
| Page-specific bodies | setup / devices / phone / pair | banner body changes | "What you typed stays here." / "Showing the list from {time}. Remove works again when the hub answers." / "Stay on the staff Wi-Fi. Your name is kept." / "The code still works. Nothing to do." | `SetupOffline`, `DevicesOffline`, `PhoneHubDown`, `PairHubDown` |
| Urdu RTL | Urdu | mirrored | "ہب سے رابطہ نہیں ہو رہا — دوبارہ کوشش…" / "دیکھیں کہ پچھلے کمرے میں ہب کے ڈبے کو بجلی مل رہی ہے۔ ہب جواب دے تو یہ اسکرین خود کھل جائے گی۔" | `GlobalHubDownUrdu` |

- **Error codes:** network failure, WS `1012`.
- **Edge cases:** backoff 0.5 → 5 s.
- **Data needed:** time of last good load.

### 00-F02 · This device must be paired again
- **Job:** tell the user the device was removed or its pairing is invalid, and restart pairing.
- **Entry points:** `DEVICE_TOKEN_INVALID`, `DEVICE_REVOKED`, WS `4403` (non-guest); after removing your own device (00-D01).
- **Exits:** **Pair again** → wipes stored token → 00-S10 (screens) / 00-S14 (phones).
- **Information shown:** danger screen title + body (MUST).
- **Actions:** **Pair again** — PRIMARY.
- **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Tablet / kiosk | token invalid / revoked | danger screen | "This device must be paired again" / "A manager removed it, or its pairing is no longer valid. Pair it again, then ask a manager to approve it." / "Pair again" | `GlobalRepair` |
| Phone | same on a phone | danger screen | "This phone must be paired again" / "Ask a manager for a new QR for your phone." / "Pair again" | `GlobalRepairPhone` |
| Kitchen screen | same on KDS | danger screen 1920 | "This screen must be paired again" / "Tap Pair again, then ask a manager to approve the new code." / "Pair again" | `GlobalRepairKds` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** `DEVICE_TOKEN_INVALID`, `DEVICE_REVOKED`.
- **Edge cases:** none. **Data needed:** none.

### 00-F03 · Connect to the staff Wi-Fi
- **Job:** tell a device on the customer Wi-Fi to switch networks.
- **Entry points:** `GUEST_NETWORK_FORBIDDEN`, WS `4403` before auth.
- **Exits:** user switches Wi-Fi and comes back.
- **Information shown:** warn screen title "Connect to the staff Wi-Fi" + body with network name if known (MUST).
- **Actions:** none. **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Phone, name known | `details.staff_wifi_name` present | name in mono | "This phone is on the customer Wi-Fi. Switch to {ssid} in your Wi-Fi settings, then come back." | `GlobalWifi` |
| Tablet | same on tablet | — | "This tablet is on the customer Wi-Fi. Switch to {ssid}, then come back." | `GlobalWifiTablet` |
| Name unknown | no name configured (as built today) | sentence without name | "This phone is on the customer Wi-Fi. Switch to the staff Wi-Fi, then come back." | none (copy only) |
| Urdu RTL | Urdu | mirrored | "اسٹاف وائی فائی سے جڑیں" / "یہ فون گاہکوں کے وائی فائی پر ہے۔ وائی فائی سیٹنگ میں AC-Staff چنیں، پھر واپس آئیں۔" | `GlobalWifiUrdu` |

- **Error codes:** `GUEST_NETWORK_FORBIDDEN`. **Edge cases:** where the name comes from is Q6. **Data needed:** `details.staff_wifi_name` (optional).

### 00-F04 · Update the app
- **Job:** block use until the app is updated.
- **Entry points:** `CLIENT_UPGRADE_REQUIRED`, WS `4426`.
- **Exits:** **Reload**.
- **Information shown:** info screen title "Update the app" + body (MUST).
- **Actions:** **Reload** — PRIMARY.
- **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Android tablet | Capacitor app | info screen | "Update the app" / "The hub needs a newer version. Update the POS app from the Play Store, then open it again." / "Reload" | `GlobalUpdateTablet` |
| Browser | hub-served page | info screen | "Update the app" / "The hub has a newer version. Reload to get it." / "Reload" | `GlobalUpdateBrowser` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** `CLIENT_UPGRADE_REQUIRED`. **Edge cases:** none. **Data needed:** none.

### 00-F05 · Hub busy, try again
- **Job:** tell the user nothing was saved and let them retry.
- **Entry points:** `SERVICE_UNAVAILABLE` after one automatic retry after `retry_after_ms`.
- **Exits:** **Try again**.
- **Information shown:** warn banner "Hub busy, try again." + "Nothing was saved." (MUST).
- **Actions:** inline **Try again** — SECONDARY.
- **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Banner | 503 after retry | warn banner over the page | as above | `GlobalBusy` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** `SERVICE_UNAVAILABLE`. **Edge cases:** none. **Data needed:** `retry_after_ms`.

### 00-F06 · The hub is being set up
- **Job:** tell a screen that the hub is not provisioned yet.
- **Entry points:** `HUB_NOT_PROVISIONED`.
- **Exits:** opens by itself when setup is done (polls).
- **Information shown:** info screen with pulse; "The hub is being set up" / "This screen opens by itself when setup is done." (MUST).
- **Actions:** none. **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | `HUB_NOT_PROVISIONED` | info screen, polling | as above | `GlobalNotSetUp` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** `HUB_NOT_PROVISIONED`. **Edge cases:** none. **Data needed:** none.

### 00-F07 · Open the hub by its address
- **Job:** tell the installer to use the number address, not a name.
- **Entry points:** `HOST_NOT_ALLOWED`.
- **Exits:** none.
- **Information shown:** info screen "Open the hub by its address" / "Type the number address in the browser, not a name." (MUST); address in mono `http://192.168.0.107:3000` (USEFUL — only when the error carries `advertised_host`, which it does not today).
- **Actions:** none. **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | `HOST_NOT_ALLOWED` | info screen; address line hidden today | as above | `GlobalWrongHost` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** `HOST_NOT_ALLOWED`. **Edge cases:** see Q13. **Data needed:** `details.advertised_host` (not sent today).

### 00-F08 · Pair this device again (paired elsewhere)
- **Job:** tell the user the device's pairing was renewed on another copy of the app.
- **Entry points:** WS `4401` after `DeviceTokenRotated`.
- **Exits:** **Pair again** → 00-S10.
- **Information shown:** danger screen "Pair this device again" / "This device's pairing was renewed on another copy of the app. Pair it again here." (MUST).
- **Actions:** **Pair again** — PRIMARY.
- **Inputs:** none. **Decisions:** none.
- **States:**

| State | Trigger | What changes | Copy | Frame |
|---|---|---|---|---|
| Default | WS 4401 + rotated | danger screen | as above | `GlobalRotated` |
| Urdu RTL | Urdu | UNKNOWN | — | none |

- **Error codes:** WS `4401`. **Edge cases:** none. **Data needed:** none.

---

## 4. Flows

**F1 New hub to first approved screen (installer + manager)**
1. 00-S01 Hub setup form → fill 3 fields → Set up hub.
   - Failure: field errors (00-S01 field errors) → fix → retry. Code invalid / replace-hub code → stop, get a new code. Cloud down → wait {s} s, retry. Hub unreachable → banner, values kept.
2. 00-S02 Restarting → Ready.
   - Failure: link expired → run `issue-admin-bootstrap` on the hub.
3. Manager scans the QR → 00-S03 First admin sign-in → tap name → PIN.
   - Failure: wrong PIN (tries left) → retry; person locked → another admin; phone IP locked → wait; not admin → pick another name; link dead → 00-S04.
4. 00-S05 Signed in → Approve a screen.
5. Meanwhile the kiosk opens `/pair` → 00-S10 Starting → Waiting (code `7KQ2XD`).
   - Failure: code expired → 00-S11 → Get a new code → retype.
6. 00-S08 type code, Cashier screen → Approve → 00-S09 Screen approved.
   - Failure: no screen waiting → field error; bad format → field error.
7. Kiosk → 00-S10 Approved → 02-S01 staff login.

**F2 Kitchen screen replaced mid-rush**
1. New tablet browser opens `/pair` → 00-S10 Waiting.
2. Manager scans the QR with their own paired phone → 00-S07 sign-in (if no admin session in this tab) → 00-S08 prefilled, chip "From the QR you scanned" → Kitchen screen → Tandoor → Approve.
   - Failure: manager's phone not paired → 00-S06. Station missing → `STATION_NOT_FOUND` banner. Screen locked → `DEVICE_LOCKED_OUT`.
3. 00-S09 → new KDS opens 03b-S01.
4. Old KDS: 00-S20 → 00-S16 → Remove → 00-D01 (reason "Screen broke at lunch") → ok banner.

**F3 Waiter pairs own phone**
1. Manager: 00-S16 or 00-S20 → 00-S17 → pick Bilal → Make QR → QR shown.
   - Failure: 10 min pass → QR expired → Make a new QR.
2. Bilal scans with the normal camera:
   - Android → 00-S12 → type name → Pair this phone → 00-S15 → 02-S01 (only Bilal).
   - iPhone in Safari → 00-S13 → Add to Home Screen → open icon → 00-S12 → 00-S15.
   - Failure: QR expired/used → 00-S14 → back to the manager. On customer Wi-Fi → 00-F03. Hub down → 00-S12 banner, name kept.

**F4 Locked-out waiter in rush**
1. Waiter gets `PIN_LOCKED_OUT` on 02-S01.
2. Manager on own phone: 00-S20 → Locked out (00-S19 phone) → **Unlock Bilal** → 00-D03 Unlock → ok banner "Bilal unlocked."
   - Failure: manager lacks `manage-staff` → read-only banner. Already unlocked → "Already unlocked."
3. Waiter retries PIN.

**F5 Staff member leaves**
1. Owner marks them as left in 01b-S02 → next config poll removes them → their phone is revoked automatically → appears in 00-S16 "Removed" group.

**F6 Log a forgotten session out**
1. 00-S20 → 00-S18 → Log out (row) → 00-D02 → Log out → ok banner.
   - Failure: session already ended → "Already logged out." + refetch.

---

## 5. Components used

| Component | Screens |
|---|---|
| Staff name tiles (with locked note "Locked · {min} min" and role line) | 00-S03, 00-S07, 00-S17 (with "Has {n} phone" line) |
| PIN pad (dots + 0–9, Delete, Sign in; error shake; locked) | 00-S03, 00-S07 |
| Full-screen state (`.pos-screen--ok / warn / danger / info`: icon, title, body, one action) | 00-S02, 00-S04, 00-S05, 00-S06, 00-S09, 00-S10 (dark), 00-S11, 00-S13, 00-S14, 00-S15, 00-F01…F08, SetupAlready |
| Banner (danger / warn / info / ok, pulsing warn for hub down) | 00-S01, 00-S03, 00-S07, 00-S08, 00-S12, 00-S16, 00-S18, 00-S19, 00-F01, 00-F05 |
| Code display (big code, QR on white tile, countdown, meta line, void "expired" box) | 00-S02, 00-S10, 00-S17 |
| Code input (mono, uppercase, centred) | 00-S01, 00-S08 |
| Segmented control | 00-S08 (Cashier / Kitchen) |
| Pick tiles | 00-S01 (host addresses), 00-S08 (stations) |
| Checklist (numbered steps) | 00-S01 aside, 00-S13 |
| Hub admin shell (side nav with counts, "Other jobs", foot with name + Sign out) | 00-S16, 00-S17, 00-S18, 00-S19, 00-S20 |
| App bar (desktop and phone with back link) | 00-S01, 00-S07, 00-S08, 00-S16…S20 |
| List with group headers, rows, meta columns, chips | 00-S16, 00-S18, 00-S19 |
| Chips (ok / warn / danger / accent / info) | 00-S02, 00-S08, 00-S16, 00-S17, 00-S18, 00-S19, 00-S20 |
| Switch | 00-S16 (Show removed) |
| Dialog (title, body, field, footer Cancel + action) | 00-D01, 00-D02, 00-D03 |
| Skeleton rows / tiles | 00-S03, 00-S16 |
| Action bar (bottom, sticky) | 00-S17 |
| Search input with icon | 00-S17 |
| Global-state helper (one code → one state) | every hub page |

---

## 6. Open questions

1. **Waiter tablets (Q5, BLOCKED).** Approve offers only Cashier screen / Kitchen screen. Devices list frames show a "Tablets" group and "Waiter tablet" rows paired by "Phone QR". How tablets are paired, and whether 00-S08 gets a third option "Waiter tablet", is UNKNOWN until the spec enum change is approved.
2. **Approve form field errors for type and station.** Keys `approve.err_kind` and `approve.err_station` exist as built, but their English text is not in the design or spec: UNKNOWN.
3. **00-S01 host field.** The spec (M85) and the build use pick tiles ("Cable", "Wi-Fi", "Other address"); every setup frame still shows a typed field. No frame for the pick list: UNKNOWN layout.
4. **Pairing source labels.** Design says "Screen code" / "Phone QR" / "First admin"; as built "Screen code" / "QR link" ("First admin" cannot be derived). Which label is right?
5. **Lockouts query shape.** Q3 recommended an `ips[].source: 'bootstrap'|'pair'` field; spec 6.18a has no `source`, and says IP lockouts come from bootstrap sign-in only. The Addresses row text "First-admin sign-in · until {time}" assumes bootstrap.
6. **Staff Wi-Fi name (Q6).** Where `staff_wifi_name` is stored (01b branch settings) is not specified; today the fallback sentence is always shown.
7. **`HOST_NOT_ALLOWED` address (Q13).** Not built; needs a security look. 00-F07 shows no address today.
8. **What a kitchen screen shows after a manager ends its session (Q10).** Owned by 03b; recommended "Kitchen screen stopped by {name}" + **Start kitchen screen** is not designed or specified.
9. **Hub admin home on a phone.** `admin-home-phone.png` exists (as built), but no design frame describes it: UNKNOWN layout rules.
10. **Missing state frames:** loading/empty/no-match for 00-S17; loading/empty/hub-down for 00-S18 and 00-S19; busy/error inside 00-D01/D02/D03; 00-S07 wrong-PIN/locked-person states (assumed to reuse 00-S03); 00-S08 with no stations configured.
11. **Urdu.** Urdu exists only in 10 frames (Setup, Boot, Approve, Pair, Phone, PhoneIos, Devices, Lockouts, GlobalWifi, GlobalHubDown). About 240 keys have no Urdu (`docs/design/handoff/00/urdu-todo.md`), including every error text, 00-S02, S04–S07, S09, S11, S14, S15, S17, S18, S20 and D01–D03. Existing Urdu has not been reviewed by a native speaker (Q14).
12. **`DevicesUrdu` has no Add a phone button** while the English frame does — omission or intended?
13. **Copy with gendered pronouns in frames** ("Ali scans this with his phone camera", "He can try his PIN again", "Anything he hadn't sent") vs string keys using "their"/"they". Which wording ships?
14. **Other jobs tiles** (Kitchen capacity, Printers, Backup and sync "Last backup 03:00") belong to modules 03a, 03b, 06 that are not specified yet; their status lines are UNKNOWN.
15. **Read-only state on 00-S17** (no `manage-devices`) — the tile and button are hidden, but what happens if the URL is opened directly is UNKNOWN.

---

## 7. Clutter report

| Screen | Problem (from the marks above) | What could move behind "More" or a second tap |
|---|---|---|
| 00-S16 Screens and phones | 5 columns per row; "Paired {date} · by {name}" and "How paired" are RARE but take a whole column; app bar has 3 controls (Show removed, Add a phone, Approve a screen) | Move "Paired / by / how" into a row detail or tooltip; move **Show removed** into a "More" menu or a filter; keep Last seen + warn chip and Signed in now visible |
| 00-S20 Hub admin home | Side nav and tiles repeat the same 4 destinations; "Branch hub · {host}" line is RARE; Other jobs appear twice (nav caption + tiles) | Keep tiles (with status chips) as the main surface and drop the duplicated "Other jobs" tile grid, or collapse nav to icons on the home page; move the host line to a footer |
| 00-S01 Hub setup form | Aside "What happens next" (USEFUL) competes with the form on a laptop; long help text under every field | Collapse the aside into a one-line step indicator; shorten help to one line and keep the rest behind an info icon |
| 00-S08 Approve form | Aside preview and audit note (USEFUL / RARE) repeat what the segmented control and station tile already say | Fold the preview into a single line under the Approve button; move the audit note into the result screen |
| 00-S18 Signed in now | Each row shows kind + since + idle rule (USEFUL) under every name | Show only the warn "Signs out in {n} min" by default; move "since" and the idle rule to a row detail |
| 00-S19 Locked out | Addresses section (RARE) is as prominent as People (MUST) | Keep People open; collapse Screens and Addresses into a "Show screens and addresses" disclosure when empty or on phone |
| 00-D01 Remove | Fine: one destructive action, one optional field | — |
| 00-S17 Add a phone | `pair_url` in mono (RARE) next to the QR | Hide the link behind "Show link" |
