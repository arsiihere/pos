# Task: implement the module 00 design (Hub Platform & Access)

You are working in the restaurant POS monorepo (Arif Chatkhara pilot). This folder is a design hand-off for **module 00** only. Implement it phase by phase. After each phase, stop, run the checks for that phase, commit, and give a short report. Do not start module 01b or any other module.

## 0. Files in this hand-off

| File | What it is |
|---|---|
| `00-design.md` | **The source of truth.** Per screen ID: frame names, component tree with kit classes, field → API mapping, actions → commands, every state, string keys, new kit CSS, shared changes, coverage. |
| `00-open-questions.md` | 10 product questions, each with a recommended answer and a status. |
| `frames/*.dc.html` | 102 design frames. Open `frames/INDEX.html` in a browser to see them all. Each frame is plain HTML and CSS: copy its class names and structure. |
| `frames/INDEX.md` | Frame file → screen ID → title. |
| `kit/kit-additions.css` | Full kit additions: 01a plus the module-00 block. |
| `kit/kit-00-block.css` | Only the new module-00 rules. |

Design canvas (for the owner, not needed by you): "00 Screens" on claude.ai.

## 1. Ground rules (apply to every phase)

1. **Read first.** Before changing anything, read:
   - `docs/specs/00_Hub_Platform_Access_Spec_v1.2.1.md`
   - `docs/design/inventory/00-hub-platform.md`
   - `apps/hub/src/setup/page.ts`, `apps/hub/src/auth/admin-bootstrap.ts`, `apps/hub/src/auth/pair-page.ts`, `apps/hub/src/commands/approve-pairing-request.ts`
   - `apps/hub/src/lib/strings.ts`
   - `packages/ui-kit/` (bundle.css, tokens)
   
   Then write a short plan in `docs/design/handoff/00/PLAN.md`, mapping each screen ID to the files you will touch.
2. **Use only kit classes and tokens.** No hard-coded colours, sizes or fonts. Use logical CSS properties only (`margin-inline-start`, etc.). Add new CSS only from `kit/kit-00-block.css`. If you truly need another class, make it token-only, add it to the kit (never page-specific), and list it in your report.
3. **Strings:** every visible text goes through `strings.ts` keys (`00-design.md` §2). Add English and Urdu for each key. The Urdu text is in the Urdu frames (`*Urdu.dc.html`). If a key has no Urdu yet, add it to `docs/design/handoff/00/urdu-todo.md` and leave the English as fallback. Never show error codes or server messages to users.
4. **UX rules:**
   - One primary button per screen.
   - Touch targets ≥ 56 px (72 px on `/pair` and KDS).
   - Status always shows an icon and a word.
   - No hover-only actions.
   - Codes, PINs, IPs, links, times and counts are always LTR (`.pos-ltr`, `.pos-input--mono`, `.pos-input--code`, `.pos-mono-wrap`).
   - No fixed heights on text, because Urdu Nastaliq is taller.
   - Respect `prefers-reduced-motion`.
5. **Offline hub rules:**
   - No CDN, Google Fonts or remote images. Fonts come from the kit.
   - No clipboard buttons and no in-page camera.
   - QR codes are SVG generated on the hub, black on a white tile.
6. **API contracts:** do not change existing endpoints or command shapes. New endpoints or fields are allowed only where §3 below says so. Follow the existing command pattern (`/admin/commands/<kebab-name>`, `command_id` ULID, permission check, audit entry).
7. **Open questions:**
   - Copy `00-open-questions.md` to `docs/design/open-questions/00-hub-platform.md`. This is the file the owner will answer later.
   - Build with each question's **recommended** answer unless its status is `blocked`.
   - Leave `blocked` items out and list them in your report.
   - At the top of PLAN.md, note every place where a recommended answer changed behaviour.
8. **Tests:**
   - Keep existing tests green.
   - Add unit tests for the error-code → UI-state mapping, for the global-state helper, and for every new query or command (permission denied, happy path, audit written).
9. **Commits:** one per phase, message `feat(00): <phase>`. Do not push unless asked.

## 2. Phases

### Phase 1: Kit
- Append `kit/kit-00-block.css` to `packages/ui-kit/components/bundle.css` (or to the kit-additions file the repo uses).
- In the existing kit additions, change the selector `.pos-list__name span` to `.pos-list__name > span`. This fixes chip colours in 01a lists.
- Add the new icons listed in `00-design.md` §3 to the kit icon set and README. Copy their SVG paths from the frames.
- **Check:** 01a pages still render. The stock list chips now show their tone colour.

### Phase 2: Shared global-state helper (00-F01…F08)
- Build one shared client helper (for example `renderGlobalState(code, ctx)` plus a reconnect banner). It maps each code to the right state:

  | Codes | State |
  |---|---|
  | `1012`, fetch failure | F01 banner, or full screen when nothing has loaded yet; backoff 0.5 → 5 s; clears itself |
  | `DEVICE_TOKEN_INVALID`, `DEVICE_REVOKED`, `4403` | F02 + Pair again (wipes the token) |
  | `GUEST_NETWORK_FORBIDDEN` | F03, with `details.staff_wifi_name` if present (Q6) |
  | `CLIENT_UPGRADE_REQUIRED`, `4426` | F04 |
  | `SERVICE_UNAVAILABLE` after 1 retry | F05 |
  | `HUB_NOT_PROVISIONED` | F06 |
  | `HOST_NOT_ALLOWED` | F07 |
  | `4401` after `DeviceTokenRotated` | F08 |

- Match frames `Global*.dc.html`. Make it reusable by every hub-served page; later modules will import it.
- **Check:** unit tests for each code.

### Phase 3: Restyle existing pages 00-S01 … 00-S15
These pages exist already. Change their markup and copy to match the frames; keep their logic and API calls.

| IDs | Page | Notes |
|---|---|---|
| S01 / S02 | `setup/page.ts` | Frames `Main`, `Setup*`. Q7: replace the host text field with a pick-list of this machine's IPv4 addresses (`os.networkInterfaces()`, non-internal, no 169.254, Ethernet preselected) as `.pos-tiles--pick` tiles, plus "Other address" with a typed field. Slow banner after 3 s. Field marking from `details.issues[].path`. S02 polls until the first-admin link answers (restarting → ready), and shows expired after `first_admin_expires_at`. Q2: after provisioning, return status 404 with the styled `SetupAlready` page. |
| S03–S05 | `auth/admin-bootstrap.ts` | Frames `Boot*`. Remove the token from the address bar after reading it. Locked tiles show minutes from `locked_until`, rounded up. Show "tries left" only when ≤ 2. Auto-submit on the 6th digit. |
| S06–S09 | approve pages | Frames `Approve*`. Prefill from `?r=`. The kitchen screen shows station tiles from branch config. Show the "will open as" aside. Q5 is blocked: keep two type options for now. |
| S10–S11 | `auth/pair-page.ts` | Dark theme. Frames `Pair*`. m:ss countdown from `expires_at`. Hub-unreachable banner keeps the code. Too-many state disables the button with a countdown. |
| S12–S15 | phone pairing | Frames `Phone*`. iOS Safari, not standalone → S13 and no pairing call. Reuse `pair_request_id` on retry. |

- Every page gets `lang`/`dir` from the device language and works in Urdu RTL (compare with the `*Urdu` frames).
- **Check:**
  - Run the hub locally and walk flow F1 (new hub → first approved screen) and F3 (phone pairing).
  - If Playwright is available, screenshot each page at the frame size (laptop 1440×900, tablet 1280×800, phone 390×844, KDS 1920×1080) in en and ur. Save to `docs/design/handoff/00/screens/`, then compare by eye with the frames.

### Phase 4: Backend for the new admin screens
Add only these, following the existing command and query pattern, with permissions and audit:

| Item | Permission | Notes |
|---|---|---|
| `GET /admin/queries/devices?include_revoked=` | `access-hub-admin` | Exists per spec 00 §6.14. Add `revoked_reason` and `revoked_by_name` (Q9). Ensure the KDS heartbeat updates `last_seen_at` at least every 30 s (Q8). |
| `GET /admin/queries/sessions` | `access-hub-admin` | Spec 00 §6.15, if not built yet. |
| `GET /admin/queries/lockouts` | `access-hub-admin` | **New** (Q3). Shape in `00-open-questions.md`. |
| `RevokeDevice` | `manage-devices` | `/admin/commands/revoke-device` |
| `GenerateDevicePairingToken` | `manage-devices` | `/admin/commands/generate-device-pairing-token` |
| `ForceLogoutSession` | `manage-staff` | `/admin/commands/force-logout-session` |
| `ClearPinLockout` | `manage-staff` | `/admin/commands/clear-pin-lockout` |

- If a command already exists under another path, keep the existing path and note it in `00-design.md`.
- **Check:** tests for permission denied, happy path, idempotent results (`already_revoked`, `already_ended`, `cleared:false`) and audit entries.

### Phase 5: New hub admin pages 00-S20, S16–S19 and dialogs D01–D03
- Route `/admin` (Q1) uses the shared `.pos-shell` + `.pos-sidenav`. Menu items:
  - Hub admin, Screens and phones, Signed in now, Locked out.
  - Under "Other jobs": Stock (link the existing `/admin/stock`), Kitchen capacity, Printers, Backup and sync. Show these only if the route exists; otherwise hide them.
  - Hide items and buttons by permission (from `GET /queries/session`).
- On phones, the sidenav becomes the home tile list. Inner pages use `.pos-appbar--phone` with a back link.
- Build pages and states exactly as `00-design.md` §1 and frames `AdminHome`, `Devices*`, `AddPhone*`, `Sessions*`, `Lockouts*`. Read-only, loading, empty, offline and success banners are all required.
- Reuse the admin sign-in from 00-S07 for `/admin`. The admin session lives in `sessionStorage`. Lists refresh on open and after each action; there is no WebSocket.
- Lockouts: People, Screens and Addresses from the new query.
- **Check:**
  - Walk flow F2 (replace the tandoor KDS mid-rush, remove the old one) and flow F4 (unlock Bilal from a manager's phone in ≤ 5 taps after sign-in).
  - Screenshots as in Phase 3.

### Phase 6: Docs and report
- Update `docs/design/ui-brief.md` §1. It still describes the old unstyled pages; point it to `00-design.md`.
- Copy `00-design.md` to `docs/design/handoff/00/00-design.md`. Update it wherever the implementation differs: paths, names, extra states.
- Make sure `docs/design/open-questions/00-hub-platform.md` exists. Add any new questions you hit at the bottom, in the same format (context, recommended, decision, status).
- Final report to the owner, short:
  - what was built, per phase;
  - tests run;
  - blocked items (Q5);
  - recommended answers in use, each with where it lives in code;
  - anything not done, and why.

## 3. Out of scope
- Spec enum change for waiter tablets (Q5, blocked).
- Owner-app "Add / Replace hub" (Q4, deferred to 06).
- KDS "stopped" screen after a forced session end (Q10, owned by 03b).
- Anything in modules 01b, 02, 03a, 03b, 04, 06 beyond linking to their existing routes.
