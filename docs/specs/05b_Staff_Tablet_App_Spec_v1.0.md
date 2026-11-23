# 05b Staff Tablet App — Module Spec

| | |
|---|---|
| Module | 05b Staff Tablet App (Android shell + native alert service; small hub and client changes) |
| Version | **v1.0 APPROVED** (owner, 2026-11-23 12:24 PKT, "approve") — v0.3 unchanged, with every §4.5 row (F-1, H-1–H-4, D-1–D-4, A-1, C-1); the rows are applied by the 05b plan's phase 0 against the versions on `main` after 05a merges |
| Inherits | Shared Standards from **Foundation v1.15** §6 (as on `build/05a`); not redefined here |
| Depends on | Foundation v1.15 (§1 Android row, R33); **00 v1.12.3** (device token, §8.1, §8.2 pair page, §8.4 close-code texts, §6.36–§6.38 APK update, `/health`, `/staff/` page meta); **01d v1.3.5** (alert mode §3.7, frames, receipts §3.6, §8.1–§8.4); **05a v1.0.1** (pairing by request, `hardware_hint`, profile, §3.8 binding, §8). ⚠️ Changed by v0.2 (m-1): the versions are those 05a's phase 0 wrote on `build/05a`; 05b's rows target the next version of each |
| Replaces | **01d batch 9b** (`docs/plans/01d-tablet-plan.md`, T1–T7) and the app side of 01d §8.2 / §8.4. 9b's approved choices carry over: Kotlin (TQ2), OkHttp (TQ1), pinned `@capacitor/{core,android,cli}` |
| Read by | 06 (later: Android device command queue), 01e (alert routes), the installation runbook |
| Stories | Owner kickoff "Native Android alert channel + live updates" (chat 2026-11-22 22:00 PKT); owner rulings O-1–O-17 (§3.1); spike `spike/lock-alerts` (§3.3) |
| Number | `05b` = after 05a (owner 2026-11-23). Bump order STAB → 05a → 05b |

### Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-23 | First draft. Owner "approve" (11:44 PKT) for hostile review; OQ-1–OQ-4 took their Rec. |
| v0.2 | 2026-11-23 | **Hostile review `docs/reviews/05b_v0.1_hostile_review.md` (REWORK: 4 BLOCKER, 12 MAJOR, 16 MINOR, 4 NIT) fixed.** Owner rulings 12:06 PKT ("all rec") = O-13 (B-1: wipe the token only after an HTTP check confirms the revoke), O-14 (M-2: per-method guards on `PosNative`; LAN script-injection risk to the token accepted, as browsers today), O-15 (M-6: whoever posted the notification owns the urgent repeat; always-on tablets one sound per step), O-16 (M-8: lock task always on `everyone` tablets, notifications visible), O-17 (M-12: staff-build reload on tablets only). **BLOCKERS:** B-1 close-code rule (§3.5); B-2 the page keeps `pos-device` in IndexedDB as today, native holds a copy of the token for the service (M-2); B-3 the hub probe and the start-page choice are native (M-1, M-16); B-4 `setSession` / `setDeviceContext` give native the signed-in state and the device's always-on flag; the install window is native (M-15, D-3). **MAJORS:** M-1 origin-only `server.url` + `startPath`; M-2 guards (§3.6); M-3 transport and headers (H-3, F-1); M-4 the page never opens alert mode inside the app, and the app refuses a non-`tablet` approval; M-5 lock text and the silent / outcome / earlier-day rules in native (M-9, D-4); M-6 repeat ownership (M-10); M-7 Android 12–15 starts, exact alarms, notification permission (M-6, M-20); M-8 lock-task features (M-17); M-9 restart after the self-update, `4426` → update, install permission (M-15); M-10 `:alerts` process (M-4); M-11 native → page `state` event (§4.2); M-12 tablets only (M-13). **MINORS / NITS:** m-1–m-16, n-1–n-4 (each marked). Marked "⚠️ Changed by v0.2 (<id>)". |
| v0.3 | 2026-11-23 | **Targeted check `docs/reviews/05b_v0.2_targeted_check.md` (FIX THEN APPROVE: 33 FIXED, 3 PARTLY; new 0 B / 6 M / 7 m / 4 n) fixed.** Owner "both yes" (12:20 PKT) = O-18 (N-6: the service takes over a page-owned urgent repeat when the activity stops, hands it back on start) and O-19 (N-4: on `everyone` device-owner tablets the app is the persistent Home activity, so it comes back locked after a reboot or update). **MAJOR:** N-1 context persisted and re-sent after either process restarts (M-21); N-2 main-frame-only error handling in a `BridgeWebViewClient` subclass (M-1, test 24); N-3 the probe runs off the main thread with `load()` deferred (M-1); N-4 lock task input and re-entry (M-17, O-19); N-5 every page unpair trigger goes through `confirmRevoked` (D-2); N-6 repeat hand-over (M-10, O-18). **MINOR / NIT:** N-7 guest probe text (M-16); N-8 guard on the UI thread, origin = boundary (§3.6); N-9 re-pair paths (M-3, H-2); N-10 one owner process per store (§5); N-11 WifiLock no-op on 34+ (M-5); N-12 device-owner battery exemption by runbook (M-17); N-13 exact lock-task feature set (M-17); N-14 bridge path checked from the page (§11); N-15 references; N-16 D-4 reach; N-17 foreground broadcasts (M-4). Marked "⚠️ Changed by v0.3 (<id>)". |
| **v1.0** | 2026-11-23 | **APPROVED by the owner** ("approve", 12:24 PKT) as v0.3, with every §4.5 row. No rule changed. |

---

## §1. Header

### The four rules

1. **The app is a shell around the hub's `/staff/` page.** The WebView loads `http://<hub>/staff/`, the same page kiosks and phones open. A UI change ships with `ship-client` and reaches every tablet at its next page load; **only a native change needs an APK** (O-10).
2. **Alerts never depend on the page.** A native foreground service, in its own process, holds the 01d **alert-mode** socket (device token only) whether the page is open, paused, crashed, signed out or the screen is locked. It rings, wakes the screen for urgent alerts, and sends `delivered` receipts. ⚠️ Changed by v0.2 (M-10)
3. **LAN only.** Nothing in the alert path needs the internet; no FCM in the pilot (O-3).
4. **Hard to kill, quick to come back, slow to give up.** Foreground service, wake lock and WifiLock, a Doze-proof exact-alarm watchdog, restart on boot, update and swipe-away, device-owner provisioning on restaurant tablets (R33). A close code never unpairs the tablet without an HTTP check (O-13). ⚠️ Changed by v0.2 (B-1)

### In scope

The Android project `apps/tablet/` (Capacitor shell, native plugin `PosNative`, `AlertService`), the native hub probe and start-page choice, first-run hub address and pairing by request (05a), the token copy for the service, one notification per alert when signed in (01d §8.2), native lock text, family sounds, the urgent repeat, the notification-tap deep link (9b T7), the staff-build reload on tablets, the native / web compatibility check, the APK update client, device-owner provisioning with lock task, the fallback checklist, the device-health card and bar, the device test matrix and the soak acceptance.

### Out of scope / deferred (§12.4)

A phone app (post-pilot, owner first, O-6); iOS; FCM or any internet fallback; a downloaded offline UI bundle (O-10 option B); the Android device command queue (06); 01e devices; Play Store; device-log upload to the hub; reloading kiosks or KDS on a new build (O-17); a hub-side "tablet offline" notice.

---

## §2. Existing architecture that must not change

- **01d alert mode** (§3.7): `auth { device_token }` with no `session_token`; `alerts_open` on connect (rows carry `seen_by_me`, and the frame carries `binding_route_until`); `alert` frames carry the lock view only (`kind_label_key` and codes, no rendered text, `alerts/ws-frames.ts:303-311`); the device may send only `receipt`; hub pings every 15 s and kills after 30 s without a pong. 05b adds **one additive field** (D-4) and no new frame.
- **Close codes and their causes** (hub `ws/server.ts`, `auth/guards.ts`): `4401` = no auth within 5 s, a first frame not `auth`, a non-`receipt` frame on an alert socket, or an unknown token; `4403` = revoked device, **or before auth** a Host header not allowed or the guest network; `4409` replaced by a newer socket for the device; `4426` client upgrade required; `1011` builder failure; `1012` hub restarting. 00 §8.4 texts apply. ⚠️ Changed by v0.2 (B-1, m-4)
- **Receipts** (01d §3.6): `delivered` once per `(alert_id, step)`, batched hub-side (≤ 1 s); the hub dedupes, also between the page and the service.
- **The page opens alert mode only on `cashier_kiosk` and `phone`** (`features/alerts/socket.ts:91-94`); 05b adds "never inside the app" (D-2, M-4).
- **APK update endpoints and CLI** (00 §6.36–§6.38): `GET /app/android/latest`, `GET /app/android/<version_code>.apk` (tablets only, `403 DEVICE_TYPE_NOT_ALLOWED` otherwise), `app-release add … --stage`, `mark-good`. Built and tested. 05b writes only the app side.
- **05a pairing** (§6.1–§6.3) and the pair page's IndexedDB `pos-device` keys `token`, `device_id`, `device_type` (`auth/pair-page.ts:216-218`), read by the staff entry (`features/staff/main.tsx:30-34`), `wipeDeviceKeys`, `/admin` and `/admin/approve`. ⚠️ Changed by v0.2 (B-2): **kept as is in the app.**
- **`/staff/` page meta** (`server.ts` `pageMeta`): tenant, branch, hub clock. Client dist files load once at hub start; `ship-client.sh` requires the hub stopped.
- **Session token in page memory only** (00 §8.1); a reload signs the person out.

---

## §3. Domain rules

### 3.1 Owner rulings

| ID | Ruling | Source |
|---|---|---|
| O-1 | React / Vite + Capacitor for the staff app; no React Native or Kotlin UI rewrite before the pilot. | Kickoff 2026-11-22 |
| O-2 | Custom Kotlin Capacitor plugin: foreground service (`specialUse`, sideloaded) holding a WebSocket to the hub; high-importance notifications with sound, lock-screen visibility, full-screen intent for urgent; acks; dedupe; reconnect with backoff; boot restart; wake lock + WifiLock; battery-optimisation exemption flow. | Kickoff |
| O-3 | LAN with no internet; FCM only ever a fallback (not in the pilot). | Kickoff |
| O-4 | Hub side (queue, acks, replay, escalation) is 01d's, already built; 05b adds none. | Step 0 report |
| O-5 | Approvers (manager, owner) get a restaurant-owned **tablet**, `listed` to them only, device owner (R33). | 05a chat 2026-11-23 |
| O-6 | Phones stay browser-only in the pilot; a phone app is post-pilot, owner first. | Same |
| O-7 | Module 05b, after 05a; bump order STAB → 05a → 05b. | Same |
| O-8 | Pilot tablet model TBD; two units (ideally two models); TCL 9198S is a candidate. | Same |
| O-9 | Spike first (throwaway), then this spec, then build. | Kickoff |
| O-10 | The app loads the hub's `/staff/` page (option A). | 2026-11-23 11:45 |
| O-11 | Build every known protection in; give an install checklist. | 2026-11-23 11:30 |
| O-12 | Build now; the soak is acceptance (§10.4), not a gate on writing code. | 2026-11-23 11:36 |
| O-13 | A close code never wipes the token by itself: an HTTP check must confirm `DEVICE_TOKEN_INVALID` or `DEVICE_REVOKED`. | 2026-11-23 12:06 ("all rec", B-1) |
| O-14 | `PosNative` methods are guarded per method and per page (§3.6); `exitLockTask` is never callable from a page; the residual risk that LAN script injection reads the token is accepted (same as browsers today). | 12:06 (M-2) |
| O-15 | Whoever posted the notification owns the urgent repeat (page or service); always-on tablets (Pass / point) get one sound per step, then a badge only (01d §8.3). | 12:06 (M-6) |
| O-16 | Lock task **always** on `everyone` tablets, signed in too, with notifications visible inside it; approver (`listed`) tablets are not locked. | 12:06 (M-8) |
| O-17 | Staff-build reload on tablets only; kiosks and KDS unchanged. | 12:06 (M-12) |
| O-18 | When the activity stops (screen off, app hidden), the service takes over every page-owned urgent repeat still open and unseen, without a new first ring; it hands them back when the activity starts again. Refines O-15. | 2026-11-23 12:20 ("both yes", N-6) |
| O-19 | On `everyone` device-owner tablets the app is the persistent Home activity, so after a reboot or an APK update it comes back in front and locked. Approver (`listed`) tablets keep the normal launcher. | 12:20 (N-4) |

### 3.2 Decisions

| ID | Decision | Prevents |
|---|---|---|
| M-1 | **Start page chosen natively.** ⚠️ Changed by v0.3 (N-3): `MainActivity` overrides `load()` to do nothing at first and shows a splash; `probeHub` (M-16) runs **on a background thread** with a 3 s timeout; then, on the UI thread, it sets `config` and calls `super.load()` (`BridgeActivity` tolerates a null bridge until then). Probe OK → `config` with `server.url = http://<host>:<port>` (**origin only**) and `startPath = /staff/` (`CapConfig.Builder.setServerUrl`, `setStartPath`); no `allowNavigation` (same-host navigation is always allowed). No address or probe failed → `config` without `server.url`: the bundled pages (§8.1, §8.4) on the local origin **`https://localhost`** (Capacitor's default scheme and host), where the bridge is injected. Switching = `recreate()`. ⚠️ Changed by v0.3 (N-2): a `BridgeWebViewClient` subclass (`bridge.setWebViewClient`) overrides `onReceivedError(view, request, error)` and `onReceivedHttpError(view, request, response)` and recreates into the bundled "hub unreachable" page **only when `request.isForMainFrame()`**; a failed subresource, or the hub stopping under an already-loaded page, never reloads it (the page shows its own "Can't reach the hub" state and keeps the session). ⚠️ Changed by v0.2 (M-1, B-3) | A path in the bridge's origin rule (falls back to `addJavascriptInterface`, open to every frame); a bundled page that cannot reach the hub (mixed content, no CORS) or has no bridge |
| M-2 | **The page's device store stays as today** (IndexedDB `pos-device`: `token`, `device_id`, `device_type`), so the staff entry, `wipeDeviceKeys`, `/admin` and `/admin/approve` work unchanged. **Native keeps its own copy of the token** (EncryptedSharedPreferences) for the service, set by the pair page (H-2) and cleared only by the revoke rule (§3.5). The page never reads the token from native. ⚠️ Changed by v0.2 (B-2; O-14 accepts the page-side exposure) | A page that cannot start without ids; readers left without a native branch |
| M-3 | **Pairing = 05a's request flow, on the hub's pair page in the app.** After the address is accepted (M-16), the WebView opens `/pair?hint=tablet`. On approval the page writes IndexedDB as today **and** calls `PosNative.setDeviceToken({ token, device_id, device_type })`. Native refuses `device_type ≠ 'tablet'` ("Approve this tablet as a Tablet"). ⚠️ Changed by v0.3 (N-9): the **page** then wipes its own three keys (`wipeDeviceKeys`) and starts a new request; inside the app the pair page always sends `hardware_hint: 'tablet'`, whatever the query (PairAgain and revoke paths open plain `/pair`); `resumePaired` also calls `setDeviceToken` when `PosNative` is present, so native recovers its copy from a page that still holds a valid token. ⚠️ Changed by v0.2 (M-4) | An app approved as `phone` / `kiosk` / `kds` (4409 loops with the page, no APK updates, sent to `/kds/`) |
| M-4 | **`AlertService` in process `:alerts`** (with the watchdog and boot receivers): foreground service type `specialUse`; OkHttp WS `ws://<hub>/ws`, alert mode; first frame within 10 s or cancel and reconnect (generation guard); backoff 0.5 → 1 → 2 → 4 → 5 s, reset at the first frame; reconnect at once on `NetworkCallback.onAvailable` (`NET_CAPABILITY_VALIDATED` not required); OkHttp ping 15 s; close codes per §3.5. `START_STICKY`. The plugin talks to it by explicit broadcasts within the package, sent with `FLAG_RECEIVER_FOREGROUND` (⚠️ Changed by v0.3, N-17; a bound `Messenger` if test 21 measures more than 200 ms). The activity's `onRenderProcessGone` returns `true` and recreates the activity. ⚠️ Changed by v0.2 (M-10) | A renderer crash or page OOM killing alerts; a half-open socket after a hub stop |
| M-5 | **Stay awake by default:** a partial wake lock and a WifiLock (`WIFI_MODE_FULL_HIGH_PERF` on API 29–33; ⚠️ Changed by v0.3 (N-11): on 34+ the platform maps it to `LOW_LATENCY`, which does nothing with the screen off, so on 34+ the app relies on the wake lock, the checklist's "Keep Wi-Fi on during sleep" and the hub's 15 s pings; the effect per model is recorded in S1 / S2) while the service runs. Tablets live on chargers (§8.5). The device-health card can turn the wake lock off for a carried tablet (OQ-3). ⚠️ Changed by v0.2 (m-3) | Doze freezing the socket; Wi-Fi power save |
| M-6 | **Watchdog**: an exact allow-while-idle alarm (`setExactAndAllowWhileIdle`, `ELAPSED_REALTIME_WAKEUP`) every 10 min restarts the service if it was killed, re-takes lost locks, reconnects if down, reschedules itself. Permissions: `USE_EXACT_ALARM` (API 33+, granted at install for a sideloaded app) and `SCHEDULE_EXACT_ALARM` (31–32). The service start from the alarm relies on the exact-alarm exemption, and on device owner or the battery allowlist as well; the non-exact fallback is used only if exact alarms are refused, and then the battery exemption is mandatory (M-20). Also armed 60 s after `BOOT_COMPLETED`, at `MY_PACKAGE_REPLACED`, and 2 s after `onTaskRemoved`. ⚠️ Changed by v0.2 (M-7, M-9) | An OEM kill that `START_STICKY` does not recover; a refused background start on Android 12+ |
| M-7 | **Dedupe** by `(alert_id, step)`, persisted (last 2 000 keys): a known key posts nothing but still sends its `delivered` receipt. An `alerts_open` row with `seen_by_me: true` is shown silently (no sound, no FSI). ⚠️ Changed by v0.2 (m-11) | Double rings; old seen alerts ringing after a reinstall |
| M-8 | **One notification per alert when signed in** (01d §8.2 m6): the page reports each `(alert_id, step)` it showed via `reportShown`; the service holds its own up to 1 s and drops it for a reported pair. Signed out (M-21), or no report within 1 s (screen off, page paused) → the service posts alone. The 1 s window is measured across the process hop (§10.3 test 21). | Two banners and two sounds |
| M-9 | **Native text and sound rules.** The APK carries a generated `lock-strings.json` (the lock lines of the EN and UR tables, the `SILENT_KINDS` set, the `request_result` outcome sounds), produced from `@pos/domain` / the client i18n tables by `apps/tablet/scripts/gen-lock-strings.mjs`; a gate test fails when the committed file differs from a fresh run. Language = the page's language, passed by `setDeviceContext`. Channels `pos_urgent_v1` (alarm usage, FSI), `pos_action_v1`, `pos_info_v1`, `pos_result_v1`; a sound change bumps the suffix and deletes the old channel. `silent` kinds post nothing. An `alerts_open` row with `from_business_day` set (D-4) is listed without sound. ⚠️ Changed by v0.2 (M-5) | Notifications showing i18n keys; silent kinds ringing; yesterday's alerts ringing |
| M-10 | **Urgent repeat — the poster owns it** (O-15): the page if it reported the pair within 1 s, else the service, signed in or not, every 10 s until `alert_seen` or `alert_closed`, then every 2 min until closed; at the escalation step one volume step-up (01d §8.3). The service keeps a persisted set of open, unseen urgent alerts and re-arms their repeat after a restart without a second first-ring. The repeat sound plays on the **alarm stream** (`SoundPool`) while the notification stays posted once. Always-on device (`setDeviceContext.always_on`, i.e. a `point_id` is set): one sound per step, then nothing. ⚠️ Changed by v0.3 (N-6, O-18): the activity's `onStop` tells the service, which starts the repeat for every reported pair still open and unseen, **without a new first ring**, within 10 s; `onStart` hands them back to the page. ⚠️ Changed by v0.2 (M-6, m-8) | A paused page owning a repeat it cannot play; notification sound throttling; a Pass tablet ringing every 10 s |
| M-11 | **Full-screen intent for `urgent` only.** The FSI activity shows the lock text over the lock screen and turns the screen on; tapping opens the deep link (M-12). | Every chime lighting up the screen |
| M-12 | **Notification tap** (9b T7): the launcher activity receives `alert_id` (validated as a ULID); if the hub page is loaded, native sets `location.hash = '#/inbox?focus=alert:<id>'` by `evaluateJavascript` (no reload, so no sign-out); otherwise it loads `/staff/` with that hash. ⚠️ Changed by v0.2 (m-10) | A tap that reloads the page and signs the person out |
| M-13 | **Staff-build reload, tablets only** (O-17). The hub computes `staff_build` = sha256 of the loaded `/staff/` `index.html` at start; it is served as `/staff/` page meta `pos-staff-build` and in non-guest `/health`. **When `PosNative` is present**, the page compares on every socket (re)connect and every 10 min; when they differ: signed out → reload; signed in → banner "Update ready — sign out to load it". Kiosks, phones and `/kds/` do not reload. ⚠️ Changed by v0.2 (M-12) | Tablets on old JS for days |
| M-14 | **Native / web compatibility.** `info()` returns `native_api` (integer, starts at 1, bumped on any plugin API change) and `version_code`. The page declares `MIN_NATIVE_API`; below it, a banner "Update the app" and `checkForUpdate()`. Optional methods are feature-checked. | A new page calling a method an old APK lacks |
| M-15 | **APK update client — native.** The service checks `GET /app/android/latest` (with `X-Client-Version`, H-3) after each reconnect and hourly; downloads a higher `version_code`; verifies `sha256` (catches a corrupt download only; integrity rests on Android's same-signer rule and the release key, §7). **Install window (native):** no session signed in (M-21) **and** no open unseen urgent alert. Device owner → `PackageInstaller` silently; otherwise an "Update ready" notification and the system prompt (`REQUEST_INSTALL_PACKAGES`; the user allows "Install unknown apps" once, §8.5). After the install, `MY_PACKAGE_REPLACED` restarts the service (M-6). `4426` on the socket → `checkForUpdate()`, keep reconnecting. The 01d §8.4 "business day closed / M66 hour" inputs are dropped for the app (D-3). ⚠️ Changed by v0.2 (B-4, M-9) | Updates during a rush; a self-update that leaves alerts off; inputs native cannot know |
| M-16 | **Hub probe (native).** `probeHub({ origin })`: OkHttp `GET <origin>/health`; OK = `200` with `status: 'ready'`, `provisioned: true` and a `hub_version` field. Errors: no answer → "No hub at this address"; ⚠️ Changed by v0.3 (N-7): `200` whose `data` has **only** `status` (the guest answer, `lib/health.ts:21`) → "Connect to the staff Wi-Fi"; any other `200` without `hub_version` → "Not a POS hub"; `HOST_NOT_ALLOWED` → "Use the address shown on the hub's setup page (with the port)"; not ready → "The hub is starting…" and retry. (`/health` never returns `GUEST_NETWORK_FORBIDDEN`; that code stays in §3.5, where `/app/android/latest` returns it.) The address must include the port. "Hub unreachable" page: retries every 5 s and `recreate()`s on success; "Change hub address" needs a 5-second press and, on a paired tablet, a confirm ("This tablet will need to be paired again"). ⚠️ Changed by v0.2 (B-3, m-6) | A first run that cannot complete; an address that the hub's Host check refuses |
| M-17 | **Device owner and lock task** (R33, O-16): provisioned from a factory reset with the **release-signed** APK, `adb shell dpm set-device-owner <pkg>/.PosDeviceAdmin`, no screen-lock credential. On `everyone` tablets lock task is always on (signed in or out). ⚠️ Changed by v0.3 (N-13): `setLockTaskFeatures(NOTIFICATIONS \| HOME \| GLOBAL_ACTIONS)` (heads-up, shade, FSI, the power menu; no `KEYGUARD`, so no lock screen inside lock task); test 23 runs inside lock task. ⚠️ Changed by v0.3 (N-4, O-19): the input is `setDeviceContext.lock_task` (true when the profile audience is `everyone`), persisted in the main process; the activity calls `startLockTask()` / `stopLockTask()` in `onResume` from it, so a profile change `everyone` ↔ `listed` takes effect at the next resume (`stopLockTask` is native-only and follows the profile, never a page call); on device owner with `lock_task` true the app is set as the persistent preferred HOME activity (`addPersistentPreferredActivity`, `CATEGORY_HOME`) and declares `android:lockTaskMode="if_whitelisted"`, so it is in front and locked after a reboot or an update; with `lock_task` false the preferred HOME is cleared. Approver (`listed`) tablets are not locked. As device owner the app grants itself `POST_NOTIFICATIONS` (`setPermissionGrantState`), so the health "Fix" actions need no Settings app. ⚠️ Changed by v0.3 (N-12): device owner exempts background service starts; the battery-optimisation allowlist is set by the runbook (`adb shell dumpsys deviceidle whitelist +<pkg>`) and checked by test 20 (`isIgnoringBatteryOptimizations()`). Exit from lock task: never from a page (O-14); only by the provisioning runbook (adb / factory reset) in the pilot. Unproven on any unit until §10.3 test 20. ⚠️ Changed by v0.2 (M-8, m-9, m-2) | OEM battery killers; staff leaving the app; lock task hiding alerts |
| M-18 | **Device health** (web, from `health()`): service connected, last frame age, alert socket state, each channel's importance and sound, `POST_NOTIFICATIONS`, full-screen intent allowed, battery exempt, can schedule exact alarms, can install updates, device owner, lock task, wake lock, app version, `native_api`, token store readable. Shown on the Me screen; **a red bar on every staff screen** when the service has been disconnected for 60 s (from the `state` event). Non-device-owner "Fix" buttons open the matching Settings screen. ⚠️ Changed by v0.2 (m-7, m-14, M-7, M-9) | A silent tablet nobody notices |
| M-19 | **Native log**: JSONL in app storage, rotated at 5 MB (2 files), the spike's event names. Read with adb; uploaded nowhere in the pilot. | No evidence after a missed alert |
| M-20 | **First-run permissions** (non-device-owner): `POST_NOTIFICATIONS` (13+), the battery-optimisation exemption (**hard step**, the app stays on it until granted), full-screen intent (14+, `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`), "Install unknown apps". ⚠️ Changed by v0.2 (M-7) | No notifications on 13+; refused background starts |
| M-21 | **Session and device context to native.** `setSession({ signed_in, staff_id? })` and `setDeviceContext({ always_on, language, lock_task })` are called **at every page load** and on every change. ⚠️ Changed by v0.3 (N-1): `always_on`, `language` and `lock_task` are persisted (plain prefs; not secrets); `signed_in` is memory-only in `:alerts`. When `:alerts` (re)starts it broadcasts `service_started`; the plugin emits `state { needs_context: true }` and the page re-sends both. Until the page has spoken after a service restart, `signed_in` is unknown: M-8's 1 s hold applies (post only without a `reportShown`), and the install window stays **closed**. After a reboot or update with no page yet, native uses the persisted context and treats the tablet as signed out. ⚠️ Changed by v0.2 (B-4) | Native guessing who is signed in |
| M-22 | **Keystore loss**: a token store that throws (e.g. `AEADBadTagException` after an OS update) is treated as "not paired" with a red health row; never a crash loop. ⚠️ Changed by v0.2 (m-5) | A tablet stuck crashing after an OTA |

### 3.3 Spike evidence (`spike/lock-alerts`, throwaway)

⚠️ Changed by v0.2 (m-2): the evidence is in the spike's `NOTES.md` and commits; its `SPIKE_RESULTS.md` is still the empty template.

- First live alert (owner's first tablet; the device facts were recorded later as TCL 9198S, Android 11 / SDK 30, TCL UI 3, patch 2021-04-05, not device owner): notification unlocked, red full-screen alert locked.
- Dry run on the first build: **19/19 `delivered` receipts on the hub** in ~19 min locked — receipts, not a device log or a count of rings.
- Scripts with a laptop socket standing in for the tablet (commit `c4e051d5`): 61/61 received; hub restart recovered via `alerts_open` with dedupe; a burst of 30 clean.
- **Finding → M-4:** a stopping hub can accept TCP and never answer the upgrade.
- **Not yet proven:** the hardened build (wake lock, watchdog) has no soak data; S5 and device owner untested (no USB cable on hand); no Android 13+ unit tested.

### 3.4 First run and lifecycle

```
 install ─► bundled first-run page: hub address (host:port) → probeHub (native)
              │ OK → store origin → recreate()
              ▼
           hub page /pair?hint=tablet (05a request flow; code on screen)
              │ approved → IndexedDB as today + setDeviceToken (native refuses non-tablet)
              ▼                                  └─► AlertService starts
           /staff/  (tabs from the 05a profile; setSession / setDeviceContext)
              │
   alert socket 4401/4403 ─► HTTP check (§3.5) ─► DEVICE_TOKEN_INVALID / DEVICE_REVOKED
              ▼
           native clears its token ─► state event { paired: false } ─► page wipes IndexedDB ─► /pair
```

### 3.5 Close-code rule (O-13) ⚠️ Changed by v0.2 (B-1, M-9, m-4)

| Code | Native action |
|---|---|
| `4401`, `4403` | One HTTP call, `GET /app/android/latest` with the token. `401 DEVICE_TOKEN_INVALID` or `403 DEVICE_REVOKED` → clear the native token, stop the service, `state { paired: false }`. `GUEST_NETWORK_FORBIDDEN` → status text "Connect to the staff Wi-Fi", keep the token, back off and retry. `HOST_NOT_ALLOWED` → "Open the hub by its address", same. Any other answer, or no answer → reconnect with backoff. |
| `4409` | Log; health row "Replaced by another connection"; reconnect after 60 s. |
| `4426` | `checkForUpdate()`; keep reconnecting with backoff. |
| any other (`1000`, `1006`, `1011`, `1012`, …) | Reconnect with backoff. |

⚠️ Changed by v0.3 (N-5): the page side mirrors it. When `PosNative` is present, **every** page unpair trigger — HTTP `401 DEVICE_TOKEN_INVALID` / `403 DEVICE_REVOKED`, and a session-socket close `4401` / `4403` — calls `PosNative.confirmRevoked()`, which runs the same HTTP check. `revoked: true` → native clears its copy, the page runs `wipeDeviceKeys` and opens `/pair`. `revoked: false` → keep everything, show the 00 §8.4 text for the reason native found ("Connect to the staff Wi-Fi", "Open the hub by its address") or "Can't reach the hub", and keep retrying. A `state { paired: false }` while the page still holds keys → the page offers its token once through `setDeviceToken`; only a `confirmRevoked` result of `true` leads to a wipe (N-9).

### 3.6 `PosNative` guards (O-14) ⚠️ Changed by v0.2 (M-2)

⚠️ Changed by v0.3 (N-8): the plugin reads the WebView's main-frame URL (`bridge.getWebView().getUrl()`) **on the UI thread** on every call (posting and waiting; WebView methods are UI-thread only). Capacitor already refuses calls from non-main frames (`MessageHandler`). The **origin** check (hub origin vs. `https://localhost`) is the boundary; the path check inside the hub origin is a guard against mistakes only (any script on the hub origin can open `/pair`; O-14 accepts that).

| Method | Allowed from |
|---|---|
| `probeHub`, `setHubOrigin`, `getHubOrigin` | the bundled local origin only |
| `setDeviceToken` | the hub origin, path `/pair` only |
| `confirmRevoked` | any hub page; native decides by its own HTTP check |
| `setSession`, `setDeviceContext`, `reportShown`, `info`, `health`, `setWakeLock`, `checkForUpdate`, `openSetting`, `addListener('state')` | the hub origin (any path) or the bundled origin |
| exit lock task | **not exposed** |

A refused call rejects with `NOT_ALLOWED_HERE` and is logged (M-19).

---

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | `/health`, `/staff/` page + meta, `/app/android/*`, device token auth, §8.4 close-code texts | M-1, M-13, M-15, M-16, §3.5 |
| 01d | alert-mode WS, frames, `receipt`, §8.1–§8.4 client rules | M-4–M-12 |
| 05a | `/pair` request flow, `hardware_hint`, profile (`point_id` for always-on) | M-3, M-21 |
| client | i18n lock lines, `SILENT_KINDS`, outcome sounds | M-9 (generated copy) |

### 4.2 Exposes — `PosNative` (Kotlin; TS interface in `apps/client/src/features/native/bridge.ts`, read as `window.Capacitor?.Plugins?.PosNative`, no Capacitor import in `apps/client`)

| Method | Returns | Notes |
|---|---|---|
| `info()` | `{ native_api, version_code, version_name, device_owner }` | M-14 |
| `probeHub({ origin })` | `{ ok, reason? }` | M-16; bundled only |
| `getHubOrigin()` / `setHubOrigin({ origin })` | `{ origin \| null }` | M-1; bundled only; set → `recreate()` |
| `setDeviceToken({ token, device_id, device_type })` | — | M-3; `/pair` only; starts the service |
| `confirmRevoked()` | `{ revoked: boolean, reason? }` | §3.5 |
| `setSession({ signed_in, staff_id? })` | — | M-21 |
| `setDeviceContext({ always_on, language, lock_task })` | — | M-9, M-10, M-17, M-21 |
| `reportShown({ alert_id, step })` | — | M-8 |
| `health()` | the M-18 fields | M-18 |
| `openSetting({ which })` | — | M-18 Fix (non-device-owner) |
| `setWakeLock({ on })` | — | M-5 |
| `checkForUpdate()` | `{ state: 'none' \| 'downloading' \| 'ready' \| 'installing' }` | M-14, M-15 |
| event `state` | `{ paired, alert_socket: 'up' \| 'connecting' \| 'down', binding_route_until \| null, update_ready, needs_context }` | ⚠️ Changed by v0.2 (M-11): revoke / unpair to the page; the red bar (M-18); the 01d tablet header gap AD-T42 closes with `binding_route_until` from `alerts_open` |

`native_api` = **1**.

### 4.5 Changes to other specs (R26) — *Approved 2026-11-23 with v1.0; applied by the 05b plan's phase 0* ⚠️ Changed by v0.2 (M-3, B-4, M-5, m-13)

| Row | Target | Change |
|---|---|---|
| F-1 | Foundation §1 Android row, F §6 `X-Client-Version` reason (F v1.15:1562), F command-queue lines (F v1.15:1366, 1731), README R33, `CLAUDE.md` stack row | "React + Capacitor (bundled assets + local SQLite command queue)" → "Capacitor shell loading the hub-served `/staff/` page (05b O-10); native alert service; restaurant tablets device owner (R33); native updates by APK from the hub, UI by `ship-client`". `X-Client-Version`: sent by the app's native calls (the APK can be older than the hub); the hub page is as new as the hub. The Android SQLite queue lines move to 06. |
| H-1 | 00 `/health`, `server.ts` `pageMeta` (`/staff/` only) | Non-guest `/health` adds `staff_build`; `/staff/` meta adds `pos-staff-build`. `/kds/` unchanged (O-17). |
| H-2 | 00 §8.2 pair page (`auth/pair-page.ts`) | `?hint=tablet` → `hardware_hint: 'tablet'`; when `PosNative` is present, after writing IndexedDB as today, call `setDeviceToken({ token, device_id, device_type })`; if it rejects (non-tablet), show its message and start a new request. |
| H-3 | 00 §8.1 (Android) | Transport: a **global cleartext permit** in the app (a network security config cannot name a typed private IP; the owner accepts the LAN risk, O-14); the bundled pages on the local origin never call the hub from JS (native `probeHub`). Pairing per 05a / 05b. Token: IndexedDB for the page as browsers, plus the native copy (05b M-2). Headers: the hub page sends what the browser page sends; native OkHttp calls send `X-Client-Version: <version_name>`. Admin pages work as in a browser (B-2 resolved by M-2). Replaces "network security config to private ranges", "`androidScheme: 'http'`", "Keystore-only token". |
| H-4 | 00 §8.4 | The app's close-code handling is 05b §3.5 (alert mode). |
| D-1 | 01d §8.2 (title "Tablet app (Capacitor, bundled)", token line), §8.3 repeat owner, §8.4 app side, plan 9b | §8.2 → "Tablet app (05b)": built by 05b M-4–M-12; token per 05b M-2. §8.3: the urgent repeat is owned by whoever posted the notification (05b M-10, O-15). §8.4's app side is 05b M-15. `docs/plans/01d-tablet-plan.md` is superseded by the 05b plan (T7 included); 01d #63 / #91's native halves move to 05b §10. |
| D-2 | 01d §8.1 (client) | The page never opens alert mode when `PosNative` is present (whatever `device_type`); `setSession`, `setDeviceContext`, `reportShown` calls; the `state` listener (wipe + `/pair` on `paired: false`; the red bar); every page unpair trigger (HTTP `401` / `403`, socket `4401` / `4403`) → `confirmRevoked()`; wipe only on `revoked: true` (§3.5, ⚠️ Changed by v0.3, N-5); context calls at every page load (M-21). |
| D-3 | 01d §8.4 | For the 05b app the install window is "no session signed in and no open unseen urgent alert"; the business-day and M66 inputs are not used by the app. |
| D-4 | 01d §3.7 `alerts_open` rows, 01d §8.1 | Additive field `from_business_day` (as the `alerts` catch-up rows carry, BF-4), so the service lists earlier-day rows without sound. ⚠️ Changed by v0.3 (N-16): build points `WsAlertsOpenRow` (`packages/events/src/ws.ts`) and the strict parse in `alerts/alert-sockets.ts`, reusing the catch-up fragment (`catch-up.ts`), no extra statement; the kiosk / phone pages on alert mode list those rows without sound too (01d §8.1); live `alert` frames are unchanged (a later step of an earlier-day alert rings, as today). |
| A-1 | 05a v1.0.1 §8 "Capacitor app (9b …)", §3.8 "Client", header "Read by … 9b", §1 out-of-scope line, "The 9b app will send `tablet`" (⚠️ Changed by v0.3, N-15) | "9b" → "05b"; the hub address is typed (host:port); "the tablet page never does (9b's service will)" → "05b's service does". |
| C-1 | client staff shell | Me screen: device-health card; red bar (M-18); "Update ready" and "Update the app" banners (M-13, M-14); `lock-strings.json` generator test (M-9). |

---

## §5. Data model and migrations

**No hub migration.** ⚠️ Changed by v0.3 (N-10): one owner process per store, and each keyset is created only by its owner. `:alerts` owns `alerts_secure` (EncryptedSharedPreferences: `device_token`, `device_id`) and `alerts_plain` (`want_running`, `wake_lock`, dedupe keys M-7, open-urgent set M-10, `always_on`, `language`, `last_update_check`); the plugin forwards `setDeviceToken` / `confirmRevoked` to it by broadcast and gets the reply the same way. The main process owns `main_secure` (`hub_origin`) and `main_plain` (`lock_task`). Credential-encrypted storage: the service starts after the first unlock; device-owner tablets have no lock credential (M-17), so boot needs no unlock. ⚠️ Changed by v0.2 (m-5)

## §6. Endpoints

No new hub endpoint. Changed: `/health` (H-1), the pair page (H-2), `alerts_open` rows (D-4). Reused: `/ws` alert mode, `/app/android/latest`, `/app/android/<version_code>.apk`.

## §7. Cross-cutting

- **Security:** global cleartext on the LAN (H-3); the page holds the token as browsers do and the native copy is guarded (§3.6, O-14); **APK integrity rests on Android's same-signer rule and the release key** — the `sha256` from the hub only catches a corrupt download (M-2 review). Release key backed up in two places; device-owner units are provisioned with the release-signed APK only (the spike's debug key never ships). ⚠️ Changed by v0.2 (M-2, m-9)
- **Exported components:** launcher `MainActivity` (validates intent data, M-12); `BootReceiver` (system actions only); `PosDeviceAdmin` (`BIND_DEVICE_ADMIN`); everything else unexported; no `FileProvider` path covering the download folder; no debug receivers. ⚠️ Changed by v0.2 (m-15)
- **Battery:** the wake lock costs battery by design; tablets on chargers.
- **Dependencies (pinned):** `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` (9b approval), OkHttp (TQ1), `androidx.security:security-crypto`, `androidx.core:core-ktx`; Capacitor's own transitive dependencies (`androidx.webkit`, AppCompat) are accepted with it. Anything else → ask first. ⚠️ Changed by v0.2 (n-3)
- **CI:** a GitHub Actions workflow `tablet.yml` on the 05b branches builds the APK and runs the Gradle unit tests (§10.2); it is a **required check** next to `gate.yml` for merging 05b (⚠️ Changed by v0.3: a GitHub branch-protection setting the owner applies; `CLAUDE.md`'s CI line gains it with the F-1 change). Release APKs are signed outside the repo. ⚠️ Changed by v0.2 (m-12)

## §8. Client contract

1. **First-run page** (bundled): hub address `host:port`, "Connect" → `probeHub` → the M-16 messages; then the M-20 permission steps (non-device-owner).
2. **Pair page in the app** (H-2).
3. **Staff page:** no alert-mode socket in the app (D-2); `setSession` / `setDeviceContext` / `reportShown`; `state` listener; staff-build banner / reload (M-13); "Update the app" (M-14); Me → device health; red bar (M-18).
4. **Hub unreachable page** (bundled, M-16).
5. **Install checklist** (non-device-owner units; every unit as a check): battery "No restrictions" + auto-start + lock in recents; notifications urgent with sound, lock-screen content shown, DND off; "Install unknown apps" allowed; "Keep Wi-Fi on during sleep: Always", Wi-Fi power saving off, other networks forgotten; the hub's fixed IP; no AP isolation; on charger; never Force stop. **Daily:** the status notification shows "Connected"; a test alert sent **from a listed device** (05a: Test alert needs `manage-devices`, listed-only) rings. Moves to the installation runbook. ⚠️ Changed by v0.2 (m-16, M-9)

## §9. Error catalogue additions

No hub code. Plugin-local rejection `NOT_ALLOWED_HERE` (§3.6); client-local states ("Can't reach the hub", "Update ready", "Update the app").

## §10. Tests

### 10.1 Gate (Vitest)

1. `bridge.ts`: no `PosNative` → today's behaviour; with a fake → the alert-mode socket is **never** opened, for `tablet`, `phone` and `cashier_kiosk` types (M-4 review).
2. Staff-build decision (pure, M-13): differs + signed out → reload; differs + signed in → banner, reload at sign-out; same → nothing; no `PosNative` → nothing.
3. Compatibility (pure, M-14).
4. One-notification rule: `reportShown` once per `(alert_id, step)` shown (01d #63 moved here).
5. `setSession` and `setDeviceContext` at page load, sign-in, sign-out, idle timeout, takeover, `device_profile` push (`always_on` = `point_id` set; `lock_task` = audience `everyone`), and on `state { needs_context: true }` (N-1).
6. `state { paired: false }` with no page keys → `/pair`; with page keys → `setDeviceToken` offered once; page `DEVICE_REVOKED` **and a session-socket `4403`** → `confirmRevoked()`; `revoked: true` → wipe; `revoked: false` → keys kept, the reason's text shown (N-5, N-9).
7. Hub: non-guest `/health` `staff_build` equals `/staff/` meta `pos-staff-build`; guest `/health` and `/kds/` meta unchanged.
8. Hub: pair page `?hint=tablet` sends `hardware_hint: 'tablet'`; with a fake bridge it sends `tablet` **without** the query too, writes IndexedDB **and** calls `setDeviceToken` with the three keys; a rejection wipes the three keys, shows its message and starts a new request; `resumePaired` with a fake bridge calls `setDeviceToken` (N-9).
9. Hub: `alerts_open` rows carry `from_business_day` (D-4).
10. `lock-strings.json` equals a fresh generator run (M-9).

### 10.2 Native unit (Gradle, in `tablet.yml`, required check)

11. Dedupe keeps 2 000 keys across a restart; a known key sends a receipt and posts nothing; `seen_by_me` → silent.
12. Backoff and reset; first-frame timeout cancels and reconnects; the generation guard ignores an old socket.
13. Close codes per §3.5 with a fake HTTP check: guest / host errors keep the token; `DEVICE_REVOKED` clears it; `4409` 60 s; `4426` → update; others reconnect.
14. Frame parsing (`alerts_open`, `alert`, `alert_seen`, `alert_closed`, unknown ignored); lock text from `lock-strings.json` in EN and UR; silent kinds post nothing; `from_business_day` silent.
15. Urgent repeat: poster ownership; 10 s until seen, then 2 min until closed; step-up at escalation; re-armed after a restart without a first-ring; always-on → one sound per step; activity stop → the service takes over within 10 s without a first ring, start → hands back (O-18); `:alerts` restarted while the page stays signed in → 1 s hold, no double banner, install window closed until `setSession` (N-1).
16. Install window (no session, no open unseen urgent); `sha256` mismatch refuses; version not higher → nothing.
17. Guards (§3.6): each method from an allowed and a refused URL.

### 10.3 Manual on the tablet (each pilot model, **and one Android 14+ unit**)

18. First run: wrong address / wrong port / guest Wi-Fi → the M-16 messages; right address → pair by request → staff page.
19. App approved as `phone` → refused, new request started.
20. Device-owner provisioning (release-signed APK) on a factory-reset unit, battery allowlist by the runbook (`isIgnoringBatteryOptimizations()` true); lock task on an `everyone` profile: heads-up banner, shade, FSI and the power menu work while locked in; reboot → the app is in front and locked and the service is up within 60 s; an APK update → the app is in front and locked; profile `everyone` → `listed` → unlocked and normal launcher at the next resume, and back (O-19, N-4, N-12, N-13).
21. Signed in, alert: one banner, one sound (M-8; measure the 1 s window across the process hop). Signed out, locked: notification + sound; urgent → FSI + repeat every 10 s until seen elsewhere; Pass tablet → one sound per step.
22. Signed in with the screen off: the service posts and repeats (M-10). Screen goes off during a page-owned repeat → the service continues within 10 s (O-18).
23. Tap → inbox with the card focused, still signed in — also inside lock task (N-13).
24. Hub stopped at app start → no ANR, the bundled page within the 3 s probe timeout → hub started → staff page by itself; hub stopped while the page is open → the page's own "Can't reach the hub", still signed in, no reload; a later main-frame load failure → the hub-unreachable page; a failed subresource → nothing (N-2, N-3).
25. `ship-client` + hub restart → a signed-out tablet reloads within 10 min; a signed-in one shows "Update ready".
26. Staged APK: only the staged tablet installs, in the window; alerts are back after the install without opening the app; `mark-good` → the rest.
27. Revoke from `#/devices` → service stops, page back to `/pair`. Router reboot to the guest SSID, signed in and signed out → token kept on both sides, "Connect to the staff Wi-Fi", recovers on the staff SSID (N-5).
28. Renderer crash (debug build `chrome://crash`) during an urgent repeat → the repeat continues; the page comes back.

### 10.4 Soak acceptance (per pilot model) ⚠️ Changed by v0.2 (m-12)

Tools: `spike/lock-alerts/scripts` carried to `tools/tablet-soak/` (fire, log receiver, analyse). Latency = device `alert_received` − hub `raised_at` + skew (log-receiver skew at upload). Defaults on (wake lock, WifiLock, watchdog).

| # | Scenario | Pass |
|---|---|---|
| S1 | **8 h** locked on charger, an alert every 60 ± 20 s | 100 % received, notified and receipted; p95 < 3 s; no duplicates |
| S2 | 4 h locked on battery from ≥ 90 %, **wake lock on** | as S1; battery %/h recorded (input to OQ-3) |
| S3 | hub restarted 3× | every alert raised before each stop received via `alerts_open`; reconnect < 10 s after ready |
| S4 | router rebooted 2× (~5 min) | outage alerts arrive after it, untouched |
| S5 | process killed by `adb shell am kill` (or the debug build's "kill service" button) | back within 10 min (watchdog), untouched |
| S6 | tablet rebooted | service up within 60 s without opening the app |
| S7 | 30 alerts in 30 s | 30 notified, no drop, no duplicate |

## §11. Build order

1. `apps/tablet/` Capacitor project (pinned), `tablet.yml` (APK + Gradle tests); `MainActivity` start-page choice with origin-only `server.url` + `startPath` (M-1). Device check: no "Invalid url, using fallback" in logcat; ⚠️ Changed by v0.3 (N-14): from the page, `window.androidBridge` has `addEventListener` (the WebMessageListener path; the silent `addJavascriptInterface` fallback has only `postMessage`); `PosNative` present on `/staff/` and `/pair`, calls refused from a cross-origin frame; hub off at app start → no ANR, bundled page within 3 s (N-3). **If the device disagrees, STOP and ask.**
2. Storage, `probeHub`, guards (§3.6), first-run and hub-unreachable pages, M-20 permissions, M-22.
3. `AlertService` in `:alerts` from the spike, hardened: M-4–M-7, §3.5, M-19; watchdog with exact alarms (M-6).
4. M-9 generator + channels; M-10 repeat; M-11 FSI; M-12 tap.
5. Hub H-1, H-2, D-4 (TDD, gate); client D-2, C-1, `bridge.ts`, M-13, M-14 (tests 1–10).
6. M-8 one-notification rule; M-21 context; `state` event (M-11 review).
7. APK update client (M-15), device owner + lock task (M-17), health (M-18).
8. Release signing, runbook (checklist §8.5, provisioning), manual §10.3, soak §10.4.

## §12. Done, open questions, deferred

### 12.1 Definition of Done

Gate green with tests 1–10; `tablet.yml` green with 11–17; manual 18–28 recorded per pilot model and one Android 14+ unit in `docs/plans/05b-manual-checks.md`; soak S1–S7 PASS on the pilot model(s); §4.5 rows applied as the target bumps with "Changed by 05b" markers.

### 12.2 Open questions

⚠️ Changed by v0.2 (n-2): numbered 12.2 (was 12.3). All four answered by the owner (2026-11-23 11:44, Rec):

| # | Question | Answer |
|---|---|---|
| OQ-1 | Pilot tablet model(s) | Keep the TCL 9198S if S1–S7 pass; second unit of a different brand |
| OQ-2 | Lock task on `everyone` tablets | Lock always (O-16); exit by the runbook only in the pilot |
| OQ-3 | Approver tablets carried on battery | Wake lock on when charging, off when carried (health toggle); S2 numbers inform |
| OQ-4 | Hub address entry | Typed `host:port` for the pilot; QR later |

### 12.3 Deferred until needed

Phone app (owner first); downloaded offline UI bundle; FCM / internet fallback; device-log upload; Android SQLite queue (06); QR hub address; custom sound files; Play Store build; kiosk / KDS reload on a new build (O-17); a hub-side "tablet offline" notice for listed tablets (m-14); a manager-PIN lock-task exit.
