# 05b Staff Tablet App — Implementation Plan (spec v1.0)

> **For agentic workers:** one task = one commit citing the spec (`[05b §x; test n]`). JS / hub tasks are TDD in the normal gate (failing test first). Native tasks are tested by Gradle unit tests in `tablet.yml` (CI builds the APK; this dev box has no Android SDK) and by the manual checks on the tablet (`docs/plans/05b-manual-checks.md`). Board: `docs/plans/05b-status.md`.

**Spec:** `docs/specs/05b_Staff_Tablet_App_Spec_v1.0.md` (APPROVED 2026-11-23 12:24 PKT, every §4.5 row). Reviews: `docs/reviews/05b_v0.1_hostile_review.md`, `05b_v0.2_targeted_check.md`. Do **not** build §1 "Out of scope" or §12.3.

**Goal:** the Android staff app: a Capacitor shell that loads the hub's `/staff/` page, a native `AlertService` in its own process on the 01d alert-mode socket, guarded `PosNative`, native lock text and sounds, APK self-update, device owner with lock task and Home; plus the small hub and client changes (§4.5).

## 0. Two phases (why)

| Phase | Branch | Touches | When |
|---|---|---|---|
| **A — native** | `module-05b` off `main` | `apps/tablet/**`, `.github/workflows/tablet.yml`, `tools/tablet-soak/**`, `docs/plans/05b-*` | **Now.** No file 05a touches, so no wait. |
| **B — hub + client + rows** | `module-05b`, after `main` has 05a (merge `main` in, never rebase) | `apps/hub/src/{lib/health.ts,server.ts,auth/pair-page.ts,alerts/alert-sockets.ts}`, `packages/events/src/ws.ts`, `apps/client/src/features/{native,alerts,staff}/**`, the §4.5 bumps | After the 05a PR merges. `pair-page.ts`, `socket.ts`, `main.tsx` and the 00 / 01d / 05a specs are all rewritten by 05a first. |

Phase A's app can be soaked against today's hub with a token minted by `tools/tablet-soak` (the spike's mint path), so the soak (§10.4) runs while phase B waits.

## 1. Global constraints

- **Dependencies** (pinned exactly): `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` **8.6.2**; OkHttp **4.12.0**; `androidx.security:security-crypto` **1.0.0**; `androidx.core:core-ktx` (Capacitor's `androidxCoreVersion`); Kotlin Gradle plugin **2.2.20**; AGP **8.13.0** (Capacitor 8.6.2's template). Anything else → ask.
- **Language:** Kotlin for all native code (TQ2). `MainActivity` too.
- **Package:** `pk.arifchatkhara.pos` — ⚠️ proposed (AD-1); application id is permanent once a tablet is device owner.
- **Signing:** debug builds use the committed `apps/tablet/android/debug.keystore` (never for device owner); release builds use the release key from CI secrets (`TABLET_RELEASE_KEYSTORE_B64`, `…_PASSWORD`), never in the repo (spec §7, m-9).
- **Exports:** only `MainActivity`, `BootReceiver`, `PosDeviceAdmin` (spec §7).
- **No spike code is merged.** Phase A ports the spike's logic into the 05b structure; `spike/lock-alerts` is deleted after S1–S7.

## 2. Tasks

### Phase A — native (`apps/tablet/`)

| # | Task | Spec | Tests / check |
|---|---|---|---|
| A1 | Capacitor 8.6.2 project `apps/tablet/` (pnpm workspace member, `capacitor.config.json` with `webDir: www`), Kotlin, pinned deps; `tablet.yml`: build debug APK + `./gradlew testDebugUnitTest`, upload artifact, publish to the rolling pre-release `tablet-dev` | §7 CI, §11 step 1 | CI green |
| A2 | `MainActivity` (Kotlin): deferred `load()`, splash, `probeHub` on a background thread (3 s), `config` with origin-only `server.url` + `startPath /staff/` or bundled; `recreate()` switch; `BridgeWebViewClient` subclass: main-frame `onReceivedError` / `onReceivedHttpError` → bundled unreachable page; `onRenderProcessGone` → `true` + recreate | M-1, M-4 (render), N-2, N-3 | Gradle: probe result mapping (M-16 table incl. guest `status`-only); manual 18, 24 |
| A3 | Stores: `main_secure` / `main_plain` (main process), `alerts_secure` / `alerts_plain` (`:alerts`), Keystore-loss → "not paired" (M-22) | §5, M-22, N-10 | Gradle: store owner rules, `AEADBadTagException` → not paired |
| A4 | `PosNative` plugin with the §3.6 guards (UI-thread `getUrl()`, origin boundary, path guard), `NOT_ALLOWED_HERE`; `info`, `probeHub`, `get/setHubOrigin`, `setDeviceToken` (refuse non-`tablet`), `confirmRevoked`, `setSession`, `setDeviceContext`, `reportShown`, `health`, `openSetting`, `setWakeLock`, `checkForUpdate`, `state` event; broadcasts to `:alerts` with `FLAG_RECEIVER_FOREGROUND` | §3.6, §4.2, M-3, M-21 | Gradle test 17 (guards), refusal of non-tablet |
| A5 | Bundled `www/`: first-run page (host:port, Connect, M-16 messages), M-20 permission steps, hub-unreachable page (5 s retry, 5 s press "Change hub address") | §8.1, §8.4, M-16, M-20 | manual 18 |
| A6 | `AlertService` in `:alerts`: FGS `specialUse`, OkHttp alert mode, first-frame timeout, backoff, network callback, ping 15 s, generation guard, wake lock + WifiLock (29–33), log rotation (M-19) | M-4, M-5, M-19 | Gradle test 12 |
| A7 | Close-code rule + `confirmRevoked` HTTP check (`GET /app/android/latest`) | §3.5, O-13 | Gradle test 13 |
| A8 | Dedupe (2 000 keys, `seen_by_me` silent), receipts after post, `alerts_open` / `alert` / `alert_seen` / `alert_closed` handling | M-7, §2 | Gradle test 11, 14 (parsing part) |
| A9 | Lock strings generator `apps/tablet/scripts/gen-lock-strings.mjs` → `apps/tablet/android/app/src/main/assets/lock-strings.json` (EN, UR lock lines, `SILENT_KINDS`, outcome sounds) + gate test 10 (file equals a fresh run); channels `pos_*_v1`, notification text | M-9 | gate 10; Gradle 14 |
| A10 | Urgent repeat: poster ownership, `SoundPool` alarm stream, 10 s / 2 min / escalation step-up, persisted open-urgent set, always-on one sound per step, activity stop / start hand-over (O-18) | M-10, O-15, O-18 | Gradle 15 |
| A11 | One-notification hold (1 s, `reportShown`), session / context persistence and `service_started` → `needs_context` | M-8, M-21, N-1 | Gradle 15 (restart case) |
| A12 | FSI activity (urgent only), notification tap → `evaluateJavascript` hash or load with hash; ULID check | M-11, M-12 | manual 21, 23 |
| A13 | Watchdog: exact allow-while-idle 10 min (`USE_EXACT_ALARM`, `SCHEDULE_EXACT_ALARM` maxSdk 32), boot 60 s, `MY_PACKAGE_REPLACED`, `onTaskRemoved` 2 s | M-6 | manual S5, S6 |
| A14 | APK update client: `latest` after reconnect + hourly with `X-Client-Version`, download, `sha256`, install window (signed out + no open unseen urgent; unknown after a service restart → closed), `PackageInstaller` silent on device owner else prompt; `4426` → check | M-15, D-3 | Gradle 16; manual 26 |
| A15 | Device owner: `PosDeviceAdmin`, self-grant `POST_NOTIFICATIONS`, lock task from `setDeviceContext.lock_task` in `onResume`, features `NOTIFICATIONS \| HOME \| GLOBAL_ACTIONS`, persistent preferred HOME + `lockTaskMode="if_whitelisted"` | M-17, O-16, O-19 | manual 20 |
| A16 | `health()` fields (channels, permissions, exact alarms, install, DO, lock task, wake lock, store readable) | M-18 | Gradle: health mapping |
| A17 | Release signing in `tablet.yml` (secrets), provisioning runbook `docs/plans/05b-provisioning.md` (factory reset → release APK → `dpm set-device-owner` → `dumpsys deviceidle whitelist +pkg` → checklist §8.5) | §7, M-17, N-12 | manual 20 |
| A18 | `tools/tablet-soak/` from the spike scripts (mint, fire, log receiver, analyse; skew); `docs/plans/05b-manual-checks.md` (tests 18–28, S1–S7) | §10.3, §10.4 | — |

### Phase B — hub, client, rows (after 05a is on `main`)

| # | Task | Spec | Tests |
|---|---|---|---|
| P0.1 | Read every target's version on `main`; write the bumps: F (F-1, also `CLAUDE.md` stack row and CI line, README R33), 00 (H-1–H-4), 01d (D-1–D-4), 05a (A-1) with "Changed by 05b" markers; `01d-tablet-plan.md` marked superseded | §4.5 | — |
| B1 | Hub `/health` `staff_build` + `/staff/` meta `pos-staff-build` | H-1 | gate 7 |
| B2 | Hub pair page: `tablet` hint inside the app, `setDeviceToken`, refusal → wipe + new request, `resumePaired` → `setDeviceToken` | H-2, N-9 | gate 8 |
| B3 | Hub `alerts_open` rows `from_business_day`; kiosk / phone pages list them silently | D-4 | gate 9 |
| B4 | Client `features/native/bridge.ts`: no alert mode with `PosNative`; `setSession` / `setDeviceContext` at load and on change; `reportShown`; `state` listener (needs_context, paired false, red bar) | D-2, M-8, M-21 | gate 1, 4, 5 |
| B5 | Client unpair path through `confirmRevoked` (HTTP 401 / 403, socket 4401 / 4403) | §3.5, D-2, N-5 | gate 6 |
| B6 | Client staff-build reload / banner (tablets only), "Update the app" (`MIN_NATIVE_API`) | M-13, M-14 | gate 2, 3 |
| B7 | Client Me → device-health card, red bar | M-18, C-1 | gate (render test) |
| B8 | End-to-end on the tablet: manual 18–28, soak S1–S7 on the pilot model(s); DoD | §12.1 | manual |

## 3. Batches

- **A-1:** A1, A2, A3 → push → CI APK on the tablet: first-run + probe + bundled pages work (owner installs).
- **A-2:** A4, A5, A6, A7, A8 → APK: pairing with a minted token, alerts with the screen locked.
- **A-3:** A9, A10, A11, A12, A13 → APK: text, sounds, repeat, FSI, tap, watchdog. **Soak S1–S7 starts here** (owner).
- **A-4:** A14, A15, A16, A17, A18 → device owner, updates, health, release build.
- **B:** after 05a merges: P0.1, B1–B7, then B8.

## 4. Decisions (AD)

| # | Decision | Status |
|---|---|---|
| AD-1 | Application id `pk.arifchatkhara.pos`, app name "Arif POS" | proposed — owner to confirm before A15 (device owner makes it permanent) |
| AD-2 | `apps/tablet` is a pnpm workspace member (Capacitor CLI via pnpm); it has no `typecheck` / `test` scripts, so turbo skips it | proposed |
