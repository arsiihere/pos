# UI design brief

For a designer. It describes every screen that exists today (module 00), names the screens coming next, and lists the hard constraints a design must meet before we can build it. The specs in `docs/specs/` are the source of truth; section numbers like §8.2 refer to `00_Hub_Platform_Access_Spec_v1.2.1.md` and "F §…" to the foundation spec.

**What the product is:** a restaurant POS. A small Linux box in the restaurant (the **hub**) runs everything and serves the screens over the restaurant Wi-Fi. Cashier PCs, Android tablets, kitchen screens (KDS) and staff phones all talk only to the hub. The cloud is used for setup and reporting, never at the till.

**State of the screens today:** the module 00 pages are working skeletons with **no styling at all**: no CSS, plain browser form controls, raw translation keys shown as text. Everything below describes what they *do*. How they *look* is entirely yours.

---

## 1. Screens in module 00

Five pages, all served by the hub. There is no app shell and no navigation between them: each is opened by URL, usually by scanning a QR code.

| # | Screen | URL | Who sees it | Device |
|---|---|---|---|---|
| 1.1 | Hub setup | `/setup` | installer, once per hub | laptop on the restaurant LAN |
| 1.2 | First admin sign-in (bootstrap) | `/admin/bootstrap#t=…` | owner or first manager | installer's laptop or a phone (QR) |
| 1.3 | Approve a screen | `/admin/approve` or `/admin/approve?r=…` | manager | any paired admin device or the bootstrap tab; a manager's phone after scanning a screen's QR |
| 1.4 | Pair this screen (by request) | `/pair` | nobody signed in; the screen itself | cashier kiosk, KDS, tablet |
| 1.5 | Pair this phone (by token) | `/pair?t=…` | a staff member pairing their own phone | Android phone, iPhone |
| 1.6 | Login placeholder | shown inside `/pair` | anyone, after pairing | all |

Errors reach the page as `{ error: { code, details } }`. Pages must show the translated text for the key `errors.<CODE>`, never the server's `message` (F §6.2). The tables below list the codes each screen can receive and what we show today.

### 1.1 Hub setup — `/setup`

**Purpose:** connect a brand-new hub to the restaurant's cloud account. The installer types a one-time registration code from the cloud. The page exists only until the hub is set up; after that it returns `404`.

**Fields** (all plain text inputs today):

| Label (current) | What goes in | Notes |
|---|---|---|
| Registration code | 12 characters, letters and digits (e.g. `7K3Q-ZD9M-AB12`) | Dashes, spaces and lowercase are accepted and cleaned up. Autocomplete off |
| Advertised host | the hub's own IP address on the LAN, e.g. `192.168.0.107` | Must be an address of this machine. A design could offer a pick-list of the hub's addresses (not in the API today) |
| Guest networks | one or more network ranges, comma-separated, e.g. `192.168.50.0/24` | Customer Wi-Fi ranges that must never reach the POS. At least one is required |

**Button:** `Provision`.

**States:**

| State | Today | What it should show |
|---|---|---|
| Idle | the form | — |
| Submitting | nothing (no spinner, button stays live) | busy state; the cloud call can take up to 10 s |
| Success | a raw link (`first_admin_url`) and a QR code appended under the form | "Hub is set up. Scan to create the first admin" with a large QR, the link, and the **30-minute expiry** (`first_admin_expires_at`, not shown today). The hub **restarts by itself** right after answering (`restarting: true`), so the page should say "Hub restarting…"; the link starts working a few seconds later |
| Error | **nothing at all**: the page swallows every error | a message per code (below) |

**Error codes:**

| Code | Meaning for the user |
|---|---|
| `VALIDATION_FAILED` | `details.issues[].path` says which field: `registration_code` (malformed), `advertised_host` (not an address of this hub), `guest_network_cidrs` (bad range), `body` |
| `REGISTRATION_CODE_INVALID` | code wrong, used or expired (24 h): ask for a new one |
| `REGISTRATION_CODE_KIND_UNSUPPORTED` | the code is for a different kind of setup (hub replacement) |
| `SERVICE_UNAVAILABLE` | the cloud can't be reached: check the internet; retry in `details.retry_after_ms` (5 s) |
| `SETUP_IN_PROGRESS` | another setup attempt is running: wait |
| `HOST_NOT_ALLOWED` | opened by a hostname instead of the hub's IP |

### 1.2 First admin sign-in — `/admin/bootstrap#t=…`

**Purpose:** the first time (and in emergencies), nobody has a paired device to sign in with. This one-time link lets an admin sign in once. It's created by setup (1.1) or by an installer command line tool, which prints the same link and a QR in the terminal. The link works for **30 minutes**, **once**, and issuing a new one cancels the old one. The token is read from the address bar and then removed from it.

**Content today:**
- a text input `Staff` that expects a **raw internal staff ID** (a 26-character code). Unusable: it should be a list of names.
- a text input `PIN` (numeric keyboard on phones, but **not masked**)
- a button `Sign in`
- under the form, the roster printed as **raw JSON**: `[{"staff_id":"…","display_name":"Test Owner","locked_until":null}]`. Only staff with admin rights are listed.

**What it should be:** pick your name from the admin roster (show "locked, N min left" for anyone with `locked_until` in the future), then a PIN pad, then success.

**States:**

| State | Today | Should show |
|---|---|---|
| Loading roster | blank | loading |
| Link expired, used or replaced (`PAIRING_TOKEN_INVALID` on load) | empty roster, script error | "This link has expired. Ask the installer for a new one" |
| Signing in | nothing | busy |
| Success | **nothing visible** (session saved silently) | "Signed in as <name>" and a way forward, e.g. a button to approve screens (1.3) **in the same tab**: the session lives in this tab only |
| Error | nothing visible | per code below |

**Error codes:** `PAIRING_TOKEN_INVALID` (link dead), `PIN_INVALID` (`details.attempts_remaining`), `PIN_LOCKED_OUT` / `IP_LOCKED_OUT` (`details.retry_after_ms`), `STAFF_NOT_FOUND`, `PERMISSION_DENIED` (not an admin), `VALIDATION_FAILED` (PIN must be 4–6 digits), `SERVICE_UNAVAILABLE` (hub busy; retry after `retry_after_ms`).

### 1.3 Approve a screen — `/admin/approve[?r=<request>]`

**Purpose:** a manager lets a new cashier kiosk or kitchen screen into the system. The screen shows a 6-character code (1.4); the manager types it here. Opened two ways: by scanning the screen's QR (adds `?r=`, so only that screen's request can be approved), or by opening the page on an admin device and typing the code.

The page has three steps, all rendered into one area.

**Step A: can't approve here.** No paired device and no first-admin session in this tab. Today it shows the raw key `pairing.approve_needs_admin_device`. Meaning: "Open this on a paired admin device and type the code there" (§8.2).

**Step B: manager sign-in** (paired device, not yet signed in as admin):
- `Staff`: a dropdown of display names (admins only; on a staff phone, only the phone's owner)
- `PIN`: numeric input, **not masked**
- button `Sign in`
- an error line under the button. This is the only page that already formats lockouts (§8.4):

| Code | Text today |
|---|---|
| `PIN_INVALID`, `attempts_remaining` ≤ 2 | `errors.PIN_INVALID · attempts_remaining 2` |
| `PIN_INVALID`, more than 2 left | `errors.PIN_INVALID` |
| `PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT` | `errors.PIN_LOCKED_OUT · 15 min` (minutes left, rounded up) |
| anything else | `errors.<CODE>` (e.g. `PERMISSION_DENIED`, `DEVICE_REVOKED`, `DEVICE_TOKEN_INVALID`, `SERVICE_UNAVAILABLE`) |

The roster also carries `locked_until` per person; it isn't shown today.

**Step C: approve form:**

| Label (current) | Control | Notes |
|---|---|---|
| Display code | text | 6 characters from the screen |
| Type | dropdown with raw values `cashier_kiosk`, `kds` | needs human labels: "Cashier screen" / "Kitchen screen" |
| Station | text | **required for a kitchen screen only**, forbidden otherwise. Should become a station picker once stations exist (module 01) |
| Approve | button | |

**Result:** the whole form is replaced by `pairing.approved` or `errors.<CODE>`. There's no "approve another" button; you reload the page.

| Code | Meaning |
|---|---|
| `PAIRING_REQUEST_NOT_FOUND` | wrong code, request expired (10 min) or already approved |
| `STATION_NOT_FOUND` | station doesn't exist. **In 00 every kitchen-screen approval fails this way**, because stations come with module 01 |
| `VALIDATION_FAILED` | station missing for a kitchen screen, or given for a cashier screen |
| `ADMIN_SESSION_REQUIRED` | admin session timed out (Owner/Manager: 1 h idle): sign in again |
| `PERMISSION_DENIED` | this admin may not manage devices |

### 1.4 Pair this screen — `/pair` (no token)

**Purpose:** what a brand-new cashier kiosk or kitchen screen shows until a manager approves it. It must be readable **from across a room**: the manager reads the code off this screen or scans its QR with their phone.

**States:**

| State | Text today | Notes |
|---|---|---|
| Starting | blank | |
| Asking the hub | `Ask a manager to pair this screen` | hardcoded English today; will become a key |
| Waiting for approval | a **QR code** (for the manager's phone, opens 1.3 with `?r=`) and the **6-character display code** (letters A–Z without I, L, O, U, plus digits; e.g. `7KQ2XD`) | refreshes every 2 s. The request expires after **10 min** (`expires_at`); no countdown today |
| Expired, or couldn't create a request | `Ask a manager to pair this screen` plus a **button with the same label** | the button starts a new request. Causes: expired, too many waiting requests from this screen (`IP_LOCKED_OUT`), hub busy (`SERVICE_UNAVAILABLE`, after one silent automatic retry), guest network (`GUEST_NETWORK_FORBIDDEN`). Today all of them look the same |
| **Hub unreachable** (power cut, hub rebooting) | an extra line `pairing.hub_unreachable` under everything | keeps retrying (every 0.5 s, growing to 5 s) and clears itself when the hub is back. The code stays on screen. This must look reassuring, not broken: the hub comes back by itself (build review 3, S2) |
| Approved | `login` | see 1.6 |
| Already paired (opened again later) | `login` | a kitchen screen instead starts its station session silently. If its pairing was revoked, it forgets it and goes back to "Asking the hub" |

The screen sends the name `screen` for every device; there's no name field.

### 1.5 Pair this phone — `/pair?t=<token>`

**Purpose:** a staff member pairs their **own** phone (BYOD, README R14). A manager creates a QR for that person on an admin device (API exists, **no screen yet**, see 1.7); the staff member scans it with the phone camera, which opens this page. The QR works for 10 minutes, once.

**States:**

| State | Today | Spec meaning (§8.2) |
|---|---|---|
| Already paired | `login` | go to login |
| **iPhone in Safari** (not opened from the Home Screen) | `pairing.ios_add_to_home` | "Add to Home Screen, then open it from there", with the Share → Add to Home Screen steps illustrated. The page must **not** pair in Safari, and must leave the URL alone so the Home Screen icon reopens it. This screen needs real design work: it's the first thing every iPhone user sees |
| Name the phone | the browser's own `window.prompt("device name")` | should be a proper field: 1–40 characters. Cancel today leaves a blank page |
| Pairing | nothing | busy |
| Paired | `login` | |
| QR expired or already used | `pairing.token_expired` | "Ask a manager for a new QR". On iPhone that means a new Home Screen icon (the old one can be deleted) |
| Other error / hub unreachable | blank (one silent retry) | needs a state |

### 1.6 Login placeholder

After any successful pairing, the page shows the single word **`login`**. The real login screen comes in module 02 (§8.3, listed in section 2): pick your name, enter your PIN, and handle "someone else is logged in here".

### 1.7 Admin functions with an API but no screen yet

These exist on the hub today and will need screens (owning module not fixed; likely 01/02 admin):

- **Devices list:** name, type, how it was paired, paired by, last seen, revoked, who is logged in on it.
- **Revoke a device** (optional reason, up to 200 characters).
- **Add a phone for a staff member:** shows a QR (`pair_qr_svg`) and link, valid 10 min.
- **Sessions list / force logout.**
- **Clear a lockout** for a person, a device or an IP address.

### 1.8 Error behaviour every future screen must design for (§8.4)

| Code | Client behaviour |
|---|---|
| `SESSION_EXPIRED`, `SESSION_INVALID` | back to login; unsent work is kept on the device |
| `DEVICE_TOKEN_INVALID`, `DEVICE_REVOKED` | "This device must be paired again" |
| `GUEST_NETWORK_FORBIDDEN` | "Connect to the staff WiFi" |
| `CLIENT_UPGRADE_REQUIRED` | blocking "Update the app" screen |
| `PIN_INVALID` | shake the PIN pad; show attempts left when ≤ 2 |
| `PIN_LOCKED_OUT`, `DEVICE_LOCKED_OUT`, `IP_LOCKED_OUT` | show the time left (5 wrong PINs lock a person for 15 min) |
| `SERVICE_UNAVAILABLE` | retry once, then "Hub busy, try again" |
| `HUB_NOT_PROVISIONED` | "Hub is being set up" |
| connection drop | reconnect quietly (backoff ≤ 5 s) |
| kitchen screen opened in a second window | "This screen is open in another window" + a "Use this window" button (key `kds.replaced`) |

---

## 2. Screens coming next (provisional)

Specs 01, 02 and 03b aren't written yet. These names come from the module map in `docs/specs/README.md` and the stories it points to (`docs/stories/stories-refined.md`).

**01 Restaurant Setup**
- Floor editor: draw floors and place tables.
- Station placement: put kitchen stations on the floor.
- Menu editor: items, prices, categories.
- Recipe route editor: which stations an item passes through.
- Batch programs and daily pre-cooked stock entry.
- Stock levels.
- Staff and roles admin (cloud, owner): custom roles and permissions.
- PIN set and reset for staff.
- Staff-to-branch assignment.

**02 Ordering + Tables**
- Staff login: name grid with locked names greyed, PIN pad, and the takeover dialog "Bilal is logged in — log him out?" (`auth.takeover.confirm`).
- Table map: tap a table to open its order.
- Order screen: menu, per-item ETA preview, sold-out and slow items flagged.
- Running order: add items to an open table.
- Order types: dine-in, takeaway, parking, delivery, web.
- Device status screens from 1.8: re-pair, staff WiFi, update app, hub busy.

**03b KDS + Printing**
- Station KDS queue: what to cook next, in order.
- "Open in another window" screen (`kds.replaced`).
- Slip warnings on waiter screens.
- Station kitchen ticket layout: thermal paper, 58 mm and 80 mm.
- Counter receipt layout: logo, tax IDs, QR. The template's content comes in 05.

**Rule for all of them (README R5):** there are **no role-named screens**. Each screen shows or hides actions based on the signed-in person's permissions: hidden when not granted, and marked "needs approval" when a manager must approve. The order-taker view is one shared view.

---

## 3. Hard constraints

### 3.1 Network: plain HTTP on the LAN, no internet

- Pages load from `http://<hub-ip>:3000` (e.g. `http://192.168.0.107:3000`). **No HTTPS, and the restaurant may have no internet at all.**
- **Nothing may load from outside the hub.** No Google Fonts, no CDN scripts or CSS, no icon fonts from the web, no remote images, no analytics. Every font, icon and image ships inside the hub (and inside the Android app bundle).
- Because the origin isn't secure, browsers **disable** some features. Design must not depend on:
  - **in-page camera** (so no in-page QR scanner; phones scan with the OS camera app, which opens the link)
  - **async clipboard** ("copy" buttons)
  - **web notifications** and **service workers** (the cashier kiosk alone runs with a browser flag that allows them; don't rely on it)
- Offline means "the hub is unreachable", not "no internet". Nothing works without the hub; screens show a calm "reconnecting" state, never a dead page (1.4).

### 3.2 Devices

| Device | How it runs | Design notes |
|---|---|---|
| **Cashier PC** | Windows, Chrome or Edge in **kiosk mode** (full screen, no address bar, no browser back), auto-start at login | landscape, large monitor; mouse and/or touch; no browser UI to fall back on, so every screen needs its own way forward and back |
| **Android tablets** | native app (React + Capacitor) with the screens bundled inside; model and Android version still open (OQ2, Android 6+ assumed) | waiter ordering and admin; touch only; portrait and landscape |
| **Kitchen screens (KDS)** | browser pointed at the hub | wall-mounted or on a counter; read from 1–3 m; touch with wet or greasy hands |
| **Cheap Android phones** | staff's own phones, hub-served page in Chrome | small screens (design down to **360 px** wide), low-end CPUs, older Chrome |
| **iPhones** | staff's own phones; must run as a **Home Screen web app** (1.5) | iOS Safari quirks; storage may be wiped if unused for a long time (then the phone re-pairs) |

Phone login is PIN only: the roster shows just the phone's owner.

### 3.3 Language: English and Urdu (right-to-left)

- **Spec status:** decision D12 says P1 ships **English only**, but every string must be a translation key and the layout must be **RTL-ready**; Urdu is switched on after P1. So design every screen in **English and in Urdu (mirrored, RTL) now**, even though Urdu ships later.
- **No hardcoded text.** Deliver every string as a key plus its English (and Urdu, if you have it) text, e.g. `pairing.hub_unreachable` → "Can't reach the hub — retrying…". Error texts use the key `errors.<CODE>`.
- **Mirroring:** with RTL, layouts flip (back arrows, progress, list alignment). Some things must **not** flip:
  - display codes, PINs and phone numbers
  - prices and quantities
  - IP addresses and QR codes
  
  Mark which elements stay left-to-right.
- **Urdu type:** Nastaliq script needs much more line height than Latin and is wider; check every fixed-height box (buttons, KDS tickets, table tiles). The font must be bundled (3.1) and cheap Android phones may have no Urdu font of their own. Font file size matters on these phones, and the font needs an open licence (e.g. OFL).
- Open question for the owner: Latin digits (123) or Urdu digits (۱۲۳) in Urdu mode. Design both until answered.

### 3.4 Kitchen and floor use

- **Big touch targets** with generous spacing. Fingers are wet, greasy or gloved, and people tap while walking.
- **Readable from a distance** on the KDS and the pair screen (1.4): large type, high contrast, nothing important in small grey text.
- **Large icons, always with a text label** (story E13, AC4): no icon-only controls.
- **Don't rely on colour alone**: kitchens have glare and harsh lighting, and some staff are colour-blind. Pair colour with an icon, a word or a shape.
- **No hover**, no double-tap, no long-press-only actions, and no small swipe targets.
- Busy, loud rooms: important changes need to be visible at a glance. Sound comes later (P3 audio callouts).
- **QR codes** are generated by the hub as a black-on-transparent SVG that scales to its box. Always place them on a **white tile** with margin (including in a dark theme), large enough to scan from about 1 m.

### 3.5 How the pages are built today, so the design comes back integrable

**Module 00 pages (today):**
- Each page is a **TypeScript function that returns one HTML string** (template literal), sent by the hub's web server (Fastify) as `text/html`. Files:
  - `apps/hub/src/setup/page.ts` (1.1)
  - `apps/hub/src/auth/admin-bootstrap.ts` (1.2)
  - `apps/hub/src/commands/approve-pairing-request.ts` (1.3)
  - `apps/hub/src/auth/pair-page.ts` (1.4–1.6)
- All behaviour is an **inline `<script>`** of plain browser JavaScript inside that string: no framework, no build step, no bundler. The script builds most elements at runtime (`document.createElement`) inside one `<div id="screen">`.
- **No CSS exists**, no `<link>`, and the hub has **no route for static files** (fonts, images, CSS files). Anything a 00 page needs must be **inline**: a `<style>` block and inline SVG. A bundled Urdu font needs a small static-file route on the hub first (a code change, planned with the build).
- **No i18n layer yet:** pages print raw keys (`login`, `pairing.*`, `errors.*`) mixed with some hardcoded English. Your string table becomes that layer.
- Device state lives in the browser's IndexedDB (`pos-device`); the admin session lives in `sessionStorage` (one tab only, gone when the tab closes). This is why some flows must stay in the same tab (1.2 → 1.3).

**Module 02 onwards (planned, F §8):**
- **One React app** (`apps/client`, not created yet). The hub serves it to the kiosk, KDS and phones, and the Android app bundles it.
- It will have a `i18n/` folder with translation keys and `errors.<code>` keys.

**Please deliver:**
1. **Frames for every state** in the tables above, at 360 px phone, tablet, 1920 × 1080 kiosk/KDS, in English and mirrored Urdu.
2. **Design tokens as CSS custom properties** (`--color-…`, `--space-…`, `--font-size-…`, `--radius-…`, `--touch-min`). Plain CSS drops straight into the 00 pages' inline `<style>` and carries over to React unchanged.
3. **Icons as inline SVG** (single colour, `currentColor`), not an icon font.
4. **Fonts as `.woff2` files** with their licence. Say which weights are used, and keep the set small.
5. **A string table:** key, English, Urdu, max length, and whether the text stays left-to-right.
6. For 00, a **static HTML/CSS mockup per screen** (no JavaScript, no external files) is the most integrable form: we keep the existing scripts and map your markup and classes onto them. Element IDs the scripts use today: `screen`, `setup`, `login`, `roster`, and class `display-code`.
7. **Component specs for 02+:** the PIN pad, staff name grid, the dialog, status banners (hub unreachable / hub busy / locked) and full-screen blocking states. Give sizes, states (default, pressed, disabled, error) and RTL behaviour.
