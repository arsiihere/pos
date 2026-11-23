# 05b Staff Tablet App — Module Spec

| | |
|---|---|
| Module | 05b Staff Tablet App (Android shell + native alert service; small hub and client changes) |
| Version | **v0.1 DRAFT** (2026-11-23) — for owner review, then hostile review |
| Inherits | Shared Standards from **Foundation v1.15** §6; not redefined here |
| Depends on | Foundation v1.15 (§1 Android row R33); **00 v1.12.2** (device token, §8.1 token storage, §6.36–§6.38 APK update, `/health`, the `/staff/` page meta); **01d v1.3.4** (alert mode §3.7, frames, receipts §3.6, §8.1–§8.4, the 9b contract); **05a v1.0** (pairing by request, `hardware_hint`, listed / everyone, one-person binding §3.8, §8 "Capacitor app") |
| Replaces | **01d batch 9b** (`docs/plans/01d-tablet-plan.md`, T1–T7) and the app side of 01d §8.2 / §8.4. 9b's approved choices carry over: Kotlin (TQ2), OkHttp (TQ1), pinned `@capacitor/{core,android,cli}` |
| Read by | 06 (later: device command queue on Android), 01e (alert routes), the installation runbook |
| Stories | Owner kickoff "Native Android alert channel + live updates" (chat 2026-11-22 22:00 PKT) and rulings O-1–O-12 (§3.1); spike `spike/lock-alerts` (§3.3) |
| Number | `05b` = after 05a (owner 2026-11-23). Bump order STAB → 05a → 05b. Its 00 / 01d / 05a / F rows become their next versions after 05a's |

### Changelog

| Version | Date | Change |
|---|---|---|
| **v0.1** | 2026-11-23 | First draft from the kickoff, the 05a decisions, owner ruling O-10 (the app loads the hub's `/staff/` page) and the spike's evidence. |

---

## §1. Header

### The four rules

1. **The app is a shell around the hub's `/staff/` page.** The WebView loads `http://<hub>/staff/`, the same page kiosks and phones open. A UI change ships with `ship-client` and reaches every tablet at its next page load; **only a native change needs an APK** (O-10).
2. **Alerts never depend on the page.** A native foreground service holds the 01d **alert-mode** socket (device token only) whether the page is open, paused, signed out or the screen is locked. It rings, wakes the screen for urgent alerts, and sends `delivered` receipts.
3. **LAN only.** Nothing in the alert path needs the internet; no FCM in the pilot (O-3).
4. **Hard to kill, quick to come back.** Foreground service, wake lock and WifiLock, a Doze-proof watchdog alarm, restart on boot and swipe-away, and device-owner provisioning on restaurant tablets (R33).

### In scope

The Android project `apps/tablet/` (Capacitor shell, native plugin `PosNative`, `AlertService`), first-run hub address and pairing by request (05a), device-token handoff to Keystore storage, one notification per alert when signed in (01d §8.2), the family sounds and the urgent repeat in native, the notification-tap deep link (9b T7), the page reload when the hub's staff build changes, the native / web compatibility check, the APK update client (01d §8.4), device-owner provisioning and the fallback checklist, the device-health card, the device test matrix and the soak acceptance.

### Out of scope / deferred (§12.4)

A phone app (post-pilot, owner first, O-6); iOS; FCM or any internet fallback; a downloaded offline UI bundle (O-10 option B); the Android device command queue (06); 01e pager / ESP32 devices; Play Store distribution; hub-side log upload of device logs.

---

## §2. Existing architecture that must not change

- **01d alert mode** (§3.7): `auth { device_token }` with no `session_token`; `alerts_open` on connect; `alert` frames carry the lock view only; the device may send only `receipt`; `4401` / `4403` / `4426` / `4409` / `1012` as 01d; hub pings every 15 s and kills after 30 s without a pong. **05b adds no frame and changes no hub alert rule.**
- **Receipts** (01d §3.6): `delivered` once per `(alert_id, step)`, batched hub-side (≤ 1 s); the hub dedupes.
- **The page opens alert mode never on a tablet** (01d §8.1): only the native service does. The shared client already checks the device type.
- **APK update endpoints and CLI** (00 §6.36–§6.38, 01d H-5): `GET /app/android/latest`, `GET /app/android/<version_code>.apk`, `app-release add … --stage`, `mark-good`. Built and tested (01d test 40). 05b writes only the app side.
- **05a pairing** (§6.1–§6.3): `POST /pair/requests` with `hardware_hint`, 6-char code, poll, approval by `manage-devices` with the code typed. The approved profile decides screens and access; `device_type` is hardware only.
- **`/staff/` page meta** (`server.ts` `pageMeta`): tenant, branch, hub clock. Client dist files are loaded once at hub start; `ship-client.sh` requires the hub stopped, so a new staff build is live from the next hub start.
- **Token storage** (00 §8.1): Android = Keystore-backed. The service never holds a session token or a PIN (01d §8.2).

---

## §3. Domain rules

### 3.1 Owner rulings

| ID | Ruling | Source |
|---|---|---|
| O-1 | React / Vite + Capacitor for the staff app; no React Native or Kotlin UI rewrite before the pilot. | Kickoff 2026-11-22 |
| O-2 | Custom Kotlin Capacitor plugin: foreground service (`specialUse`, sideloaded, not Play Store) holding a WebSocket to the hub; high-importance notifications with sound, lock-screen visibility, full-screen intent for urgent; acks; dedupe; reconnect with backoff; boot restart; wake lock + WifiLock; battery-optimisation exemption flow. | Kickoff |
| O-3 | Works over the LAN with no internet; FCM only ever a fallback (not in the pilot). | Kickoff |
| O-4 | Hub side: per-device queue, acks, replay on reconnect, escalation — **already built in 01d** (`alerts_open`, receipts, steps); 05b adds none. | Step 0 report, kickoff |
| O-5 | Approvers (manager, owner) get a restaurant-owned **tablet**, `listed` to them only, provisioned as device owner (R33). | 05a chat 2026-11-23, decision 2 (b) |
| O-6 | Phones stay browser-only in the pilot: no native phone app, no phone battery flow. A phone app is post-pilot, owner first. | Same |
| O-7 | Module number 05b, built after 05a; bump order STAB → 05a → 05b. | Same, decision 1 |
| O-8 | Pilot tablet model: TBD; two units to be bought (ideally two models). The spike unit TCL 9198S is a candidate (§3.3). | Same, decision 3 |
| O-9 | Spike first (throwaway `spike/lock-alerts`), then this spec, then build. | Kickoff plan |
| O-10 | **The app loads the hub's `/staff/` page** (option A): no downloaded bundle, no CORS, no zip / version / rollback machinery. Hub down at start → "Can't reach the hub" with retry. | 2026-11-23 11:45 PKT ("going with A"; owner asked to proceed) |
| O-11 | Build every known protection into the app; give an install checklist (`INSTALL_PRECAUTIONS`). | 2026-11-23 11:30 ("write code which works and tell the precautions") |
| O-12 | Stop the soak back-and-forth; start building the final app. The soak runs alongside, as acceptance (§10.4), not as a gate on writing code. | 2026-11-23 11:36 |

### 3.2 Decisions

| ID | Decision | Prevents |
|---|---|---|
| M-1 | **Runtime hub URL.** The hub address is stored natively (Keystore-backed prefs). At start, `MainActivity` builds the Capacitor config with `server.url = <hub>/staff/` and the hub host in `allowNavigation`, so the WebView loads the hub page **with the native bridge injected** on that origin. No hub address → the bundled first-run page (§3.4). | A build-time hub IP baked into the APK; a page without the bridge |
| M-2 | **The device token lives only in native storage on the app.** The page asks `PosNative.getDeviceToken()` once per load and holds it in memory; it writes nothing to IndexedDB `pos-device` on the app. `readDeviceKey` (client) gains a native branch. | Two copies that drift (e.g. a revoke clears one); the token readable from WebView storage |
| M-3 | **Pairing = 05a's request flow, run by the hub's pair page in the app.** After the hub address, the WebView opens `<hub>/pair?hint=tablet`. On approval the page calls `PosNative.setDeviceToken(token)` instead of IndexedDB, then goes to `/staff/`. | A second, native pairing UI |
| M-4 | **`AlertService` (spike-proven, §3.3)**: foreground service type `specialUse`; OkHttp WS to `ws://<hub>/ws`, alert mode; first frame within 10 s or cancel and reconnect; backoff 0.5 → 1 → 2 → 4 → 5 s, reset after the first frame; reconnect at once on `NetworkCallback.onAvailable` (LAN: `NET_CAPABILITY_VALIDATED` not required); OkHttp ping 15 s; close codes as 01d (§2). `START_STICKY`. | Lost alerts while the page is frozen; a half-open socket after a hub stop (spike finding) |
| M-5 | **Stay awake by default**: a partial wake lock and a WifiLock (`LOW_LATENCY` on API ≥ 29, else `HIGH_PERF`) are held while the service runs. Tablets live on chargers (`INSTALL_PRECAUTIONS` §D). A tablet on battery can turn the wake lock off in the device-health card. | Doze freezing the socket; Wi-Fi power save dropping it |
| M-6 | **Watchdog**: an `ELAPSED_REALTIME_WAKEUP` alarm every 10 min (`setExactAndAllowWhileIdle`; `setAndAllowWhileIdle` when exact alarms are refused) restarts the service if it was killed, re-takes lost locks, reconnects if down, and reschedules itself; also armed 60 s after boot and 2 s after `onTaskRemoved`. | An OEM kill that `START_STICKY` does not recover |
| M-7 | **Dedupe** by `(alert_id, step)`, persisted (last 2 000 keys), so a process restart or `alerts_open` replay never rings twice. A replayed row still gets its `delivered` receipt (01d §8.1 as built). | Double rings after reconnect or restart |
| M-8 | **One notification per alert when signed in** (01d §8.2 m6, unchanged): the page reports each `(alert_id, step)` it showed via `PosNative.reportShown`; the service holds its own notification up to 1 s and drops it for a reported pair. Signed out, or the page silent for 1 s → the service notifies alone. | Two banners and two sounds on a signed-in tablet |
| M-9 | **Family channels** (01d §8.3): three channels `pos_urgent` (alarm usage, full-screen intent, vibration long-long), `pos_action`, `pos_info`; `silent` kinds post nothing. Channel ids carry a version suffix so a sound change creates a new channel. | One channel sound for all families; Android freezing a channel's sound after first creation |
| M-10 | **Urgent repeat in native while signed out** (01d §8.3): every 10 s until an `alert_seen` or `alert_closed` frame for it, then every 2 min until closed. While signed in the page owns the repeat (M-8). | A signed-out urgent alert ringing once and going quiet |
| M-11 | **Full-screen intent for `urgent` only.** The FSI activity shows the lock text over the lock screen and turns the screen on; tapping it opens the page at the deep link (M-12). | Every info chime lighting up the screen |
| M-12 | **Notification tap** (9b T7, 01d §3.13.4): opens the WebView at `/staff/#/inbox?focus=alert:<alert_id>`. | Taps that open the app at its home |
| M-13 | **Staff build reload.** The hub computes `staff_build` = sha256 of the loaded `/staff/` `index.html` at start, serves it as page meta `pos-staff-build` and in `/health` (non-guest). The page compares on every socket (re)connect and every 10 min; when they differ and **no session is signed in** (or at the next sign-out), it reloads. Applies to kiosks and phones too. | Tablets running old JS for days after `ship-client` |
| M-14 | **Native / web compatibility.** `PosNative.info()` returns `native_api` (integer, bumped on any plugin API change) and the app `version_code`. The page declares `MIN_NATIVE_API`; below it, the page shows "Update the app" and calls `PosNative.checkForUpdate()`. Web code feature-checks optional plugin methods. A native change never needs a web change in the same release. | A new page calling a plugin method an old APK lacks |
| M-15 | **APK update client** (01d §8.4): check `latest` after each reconnect and hourly; download when `version_code` is higher; verify `sha256`; install with `PackageInstaller` silently when device owner, only when no session is signed in, the business day is closed, or in the M66 maintenance hour. Not device owner → a "Update ready" notification and the system install prompt. | Updates that interrupt a rush; unverified APKs |
| M-16 | **Hub unreachable at start**: the bundled local page shows "Can't reach the hub at <address>", retries `GET /health` every 5 s and loads `/staff/` on success; "Change hub address" needs a 5-second press and, on a paired tablet, a confirm ("This tablet will need to be paired again"). The alert service keeps retrying on its own. | A blank WebView; a casual tap that unpairs a tablet |
| M-17 | **Device owner on restaurant tablets** (R33): provisioned from a factory reset with `adb shell dpm set-device-owner <pkg>/.PosDeviceAdmin`; the app sets lock-task packages to itself and starts lock-task mode when signed out on a `everyone` device; status bar locked. Not device owner (a unit that refuses, or before provisioning) → the battery-exemption flow and the checklist (§8.4) are mandatory. | OEM battery killers; staff leaving the app |
| M-18 | **Device-health card** on the Me screen (web, data from `PosNative.health()`): service connected, last frame age, notifications on, battery exempt, full-screen intent allowed, device owner, wake lock, app version, `native_api`. Red row → a "Fix" button opening the matching system setting. | Silent misconfiguration found only when an alert is missed |
| M-19 | **Native log**: JSONL in app storage, rotated at 5 MB (2 files), the spike's event names (§3.3). Readable with adb; uploaded nowhere in the pilot. | No evidence after a missed alert |

### 3.3 Spike evidence (`spike/lock-alerts`, throwaway; results in its `SPIKE_RESULTS.md`)

- 2026-11-23, TCL 9198S, Android 11 (SDK 30), TCL UI 3, patch 2021-04-05, not device owner: notification while unlocked and the red full-screen alert while locked on the first live alert; **dry run 19/19 delivered** in ~19 min locked on defaults (wake lock off then).
- Scripts against a local hub: 61/61 received; hub restart recovered through `alerts_open` with dedupe; a burst of 30 clean.
- **Finding → M-4:** a stopping hub can accept TCP and never answer the WebSocket upgrade; without a first-frame timeout the client hangs in CONNECTING.
- **Finding → M-2 / §8:** admin routes from a paired admin browser need the device token next to `X-Admin-Session`.
- **Open:** the multi-hour locked soak (S1–S7) on the pilot model(s) — runs alongside the build as acceptance (§10.4, O-12).

### 3.4 First run and lifecycle

```
 install ─► first-run page (bundled): "Hub address" (typed, e.g. 192.168.1.10:3000)
              │ GET /health ok
              ▼
           WebView → <hub>/pair?hint=tablet (05a request flow, code on screen)
              │ approved → PosNative.setDeviceToken(token)  → AlertService starts
              ▼
           WebView → <hub>/staff/  (tabs from the 05a profile)
              │
   4401/4403 on the alert socket, or DEVICE_TOKEN_INVALID / DEVICE_REVOKED on the page
              ▼
           token cleared natively → WebView → <hub>/pair?hint=tablet
```

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | `/health`, `/staff/` page + meta, `/app/android/*`, device token auth | M-1, M-13, M-15, M-16 |
| 01d | alert-mode WS, frames, `receipt`, §8.1–§8.4 client rules | M-4–M-12 |
| 05a | `/pair` request flow, `hardware_hint`, profile | M-3 |

### 4.2 Exposes — `PosNative` plugin (Kotlin; TS interface in `apps/client/src/features/native/bridge.ts`, injected, no Capacitor import in `apps/client`)

| Method | Returns | Notes |
|---|---|---|
| `info()` | `{ native_api, version_code, version_name, device_owner }` | M-14 |
| `getDeviceToken()` / `setDeviceToken({ token })` / `clearDeviceToken()` | `{ token \| null }` | M-2, M-3; set starts the service |
| `getHubUrl()` / `setHubUrl({ url })` | `{ url \| null }` | M-1, M-16 |
| `reportShown({ alert_id, step })` | — | M-8 |
| `health()` | the M-18 fields | M-18 |
| `openSetting({ which: 'notifications' \| 'battery' \| 'fsi' \| 'app' })` | — | M-18 Fix buttons |
| `setWakeLock({ on })` | — | M-5, battery tablets |
| `checkForUpdate()` | `{ state: 'none' \| 'downloading' \| 'ready' \| 'installing' }` | M-14, M-15 |
| `enterLockTask()` / `exitLockTask()` | — | M-17 (device owner only; no-op otherwise) |

`native_api` starts at **1**. Events to the page: none in v1 (the page polls `health()` on the Me screen).

### 4.5 Changes to other specs (R26) — *Proposed, needs approval*

| Row | Target | Change |
|---|---|---|
| F-1 | Foundation §1 Android row, README R33 | "React + Capacitor (bundled assets + local SQLite command queue)" → "Capacitor shell loading the hub-served `/staff/` page (05b O-10); native alert service; restaurant tablets device owner (R33); native updates by APK from the hub, UI by `ship-client`". The local SQLite queue moves to 06's Android work (no queue exists today, 01d AD-2). |
| H-1 | 00 §6.x `/health`, `server.ts` `pageMeta` | Non-guest `/health` adds `staff_build`; `/staff/` and `/kds/` page meta add `pos-staff-build` (M-13). No statement added (computed at start). |
| H-2 | 00 §8.2 pair page (`auth/pair-page.ts`), 05a §8 | When `window.Capacitor?.isNativePlatform?.()` is true: send `hardware_hint: 'tablet'` (the `?hint=tablet` query is accepted too), and on approval call `PosNative.setDeviceToken` instead of writing IndexedDB, then go to `/staff/`. |
| D-1 | 01d §8.2, §8.4, plan 9b | §8.2 and §8.4's app side become "built by 05b (§3.2 M-4–M-15)"; `docs/plans/01d-tablet-plan.md` is superseded by the 05b plan (T7 included); 01d test #63 / #91's native halves move to 05b §10. No rule change. |
| D-2 | 01d §8.1 (client) | `readDeviceKey` gains the native branch (M-2); the staff-build reload (M-13) is added to the reconnect handler. |
| A-1 | 05a §8 "Capacitor app (9b …)" | "9b" → "05b"; the hub address is typed (§3.4); QR of the hub address deferred. |
| C-1 | client staff shell | Me screen: device-health card (M-18) when `PosNative` is present; "Update the app" banner (M-14). |

---

## §5. Data model and migrations

**No hub migration.** `app_releases` exists (01d). Native storage (app-private, `EncryptedSharedPreferences` with a Keystore master key): `hub_url`, `device_token`; plain prefs: `want_running`, `wake_lock`, dedupe keys (M-7), `last_update_check`.

## §6. Endpoints

No new hub endpoint. Changed: `/health` (H-1, one field), the pair page (H-2). Reused unchanged: `/ws` alert mode, `/app/android/latest`, `/app/android/<version_code>.apk`.

## §7. Cross-cutting

- **Security:** cleartext HTTP on the LAN as every client today (foundation); the device token never in WebView storage (M-2); no exported debug receivers in release builds (the spike's `DebugReceiver` is not carried over); release signing key backed up in two places (01d §8.4).
- **Battery:** the wake lock costs battery by design (M-5); tablets on chargers.
- **Dependencies (approved for 05b, pinned exactly):** `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` (9b approval), OkHttp (TQ1), `androidx.security:security-crypto`, `androidx.core:core-ktx`. Anything else → ask first.
- **Build:** the APK is built by a GitHub Actions workflow on the 05b branch (the dev box has no Android SDK), as the spike's `spike-apk.yml`; release APKs are signed with the release key held outside the repo.

## §8. Client contract

1. **First-run page** (bundled `www/`): hub address field, "Connect", reachability check, errors "No hub at this address" / "Not a POS hub".
2. **Pair page in the app** (H-2): unchanged look; token handed to native.
3. **Staff page** (unchanged UI): reads the token through `PosNative` (M-2); reports shown alerts (M-8); reload on a new staff build (M-13); "Update the app" banner (M-14); Me → device health (M-18).
4. **Hub unreachable page** (M-16).
5. **Install checklist** (non-device-owner units, and every unit as a check): battery "No restrictions" + auto-start + lock in recents; notifications urgent with sound, lock-screen content shown, DND off; "Keep Wi-Fi on during sleep: Always", Wi-Fi power saving off, other networks forgotten; hub fixed IP; no AP isolation; on charger; never Force stop. Daily: the status notification shows "Connected"; a manager's test alert rings. (From `spike/lock-alerts/INSTALL_PRECAUTIONS.md`; moves to the installation runbook.)

## §9. Error catalogue additions

None. Client-local states only ("Can't reach the hub", "Update the app").

## §10. Tests

### 10.1 Gate (Vitest)

1. `bridge.ts`: with a fake `PosNative`, `readDeviceKey('token')` returns the native token and writes no IndexedDB; without `PosNative`, IndexedDB as today.
2. Staff-build reload decision (pure): differs + signed out → reload; differs + signed in → reload at sign-out; same → nothing.
3. Compatibility (pure): `native_api` < `MIN_NATIVE_API` → banner + `checkForUpdate`; missing optional method → feature off, no throw.
4. One-notification rule: `reportShown` called once per `(alert_id, step)` the page shows (01d #63 moved here).
5. Hub: `/health` non-guest has `staff_build` equal to the page meta `pos-staff-build`; guest `/health` unchanged.
6. Hub: pair page with `?hint=tablet` sends `hardware_hint: 'tablet'`; the native branch calls `setDeviceToken` and writes no IndexedDB (page script test with a fake bridge).
7. Update decision (pure, 01d §8.4): install window (no session / day closed / maintenance hour), higher `version_code` only, staged device.

### 10.2 Native unit (Gradle, outside the gate, run in CI)

8. Dedupe keeps 2 000 keys and survives a restart; a replayed key sends a receipt and posts nothing.
9. Backoff sequence and reset after the first frame; first-frame timeout cancels and reconnects.
10. Close codes: 4401 / 4403 clear the token and stop; 4426 stop; 4409 stop; 1012 / 1006 reconnect.
11. Frame parsing for `alerts_open`, `alert`, `alert_seen`, `alert_closed`; unknown frames ignored.
12. Urgent repeat schedule: 10 s until seen, then 2 min until closed; stops on `alert_closed`.
13. `sha256` mismatch refuses an install.

### 10.3 Manual on the tablet (each pilot model)

14. First run → pair by request → staff page with the profile's tabs.
15. Signed in, alert: one banner, one sound (M-8). Signed out, screen locked: notification + sound; urgent → full-screen + repeat every 10 s until seen on another device.
16. Tap → inbox with the card focused.
17. Hub stopped at app start → "Can't reach the hub" → hub started → page loads by itself.
18. `ship-client` + hub restart → a signed-out tablet shows the new build within 10 min; a signed-in one at sign-out.
19. Staged APK: only the staged tablet updates in an allowed window; `mark-good` → the rest; alerts come back after the install.
20. Device-owner provisioning on a factory-reset unit; lock-task; reboot → service up within 60 s without opening the app.
21. Revoke the device from `#/devices` → service stops, page returns to the pair screen.

### 10.4 Soak acceptance (per pilot model, from the spike)

| # | Scenario | Pass |
|---|---|---|
| S1 | 4–12 h locked on charger, an alert every 60 ± 20 s | 100 % received, notified and receipted; p95 < 3 s; no duplicates |
| S2 | 4 h locked on battery from ≥ 90 % | as S1; battery %/h recorded |
| S3 | hub restarted 3× | every alert raised before each stop received via `alerts_open`; reconnect < 10 s after ready |
| S4 | router rebooted 2× (~5 min) | alerts raised in the outage arrive after it, untouched |
| S5 | app process killed | back within 10 min (watchdog), untouched |
| S6 | tablet rebooted | service up within 60 s without opening the app |
| S7 | 30 alerts in 30 s | 30 notified, no drop, no duplicate |

Tools: `spike/lock-alerts/scripts` (fire, log receiver, analyse) carried to `tools/tablet-soak/`.

## §11. Build order

1. `apps/tablet/` Capacitor project, pinned versions; CI workflow builds the debug APK; runtime `server.url` (M-1) proven on the device with the bridge present on the hub origin. Checked in the Capacitor 8.6.2 source (2026-11-23): `CapConfig.Builder.setServerUrl()` / `setAllowNavigation()` exist, `BridgeActivity.config` is passed to `Bridge.Builder.setConfig()` in `onCreate`, and the server URL is added to the bridge's allowed origins (`Bridge.java:241`), so `MainActivity` sets `config` before `super.onCreate` and calls `recreate()` after the first-run page saves the address. **If the device disagrees, STOP and ask** (fallback: a native WebView host without Capacitor's bridge, plugin calls via `addJavascriptInterface`).
2. `PosNative` storage methods + first-run page + hub-unreachable page (M-1, M-2, M-16).
3. `AlertService` from the spike, hardened (M-4–M-7, M-19); channels and urgent repeat (M-9–M-11); tap (M-12).
4. Hub H-1, H-2 (TDD, gate); client D-2, C-1, `bridge.ts` (tests 1–7).
5. One-notification rule (M-8).
6. APK update client (M-15), device owner + lock task (M-17), device health (M-18).
7. Release signing, runbook (install checklist, provisioning), manual checks §10.3, soak §10.4 on the pilot model(s).

## §12. Done, open questions, deferred

### 12.1 Definition of Done

Gate green with tests 1–7; native tests 8–13 green in CI; manual 14–21 recorded per pilot model in `docs/plans/05b-manual-checks.md`; soak S1–S7 PASS on the pilot model(s); §4.5 rows applied as the target bumps with "Changed by 05b" markers.

### 12.3 Open questions

| # | Question | Rec |
|---|---|---|
| OQ-1 | Pilot tablet model(s) (O-8). | Keep the TCL 9198S if S1–S7 pass; buy the second unit of a different brand for comparison |
| OQ-2 | Lock-task on `everyone` tablets when signed out: lock the tablet into the app, or leave Home reachable? | Lock (staff cannot wander off); exit needs a manager PIN later |
| OQ-3 | Approver tablets (O-5) on battery when carried around: keep the wake lock? | Yes on charger; off when carried (device-health toggle), and watch S2 numbers |
| OQ-4 | Hub address entry: typed only for the pilot, QR later? | Typed (one-time per tablet, done by the installer) |

### 12.4 Deferred until needed

Phone app (owner first); downloaded offline UI bundle; FCM / internet fallback; device log upload to the hub; Android SQLite command queue (06); QR hub-address scan; per-family custom sound files beyond the system defaults; Play Store build.
