# Spike notes — lock-screen alerts

Everything surprising found while building or soaking. Each entry: date, unit (or "build"), what happened, what it means for 05b.

## Build
- 2026-11-23 · build · The dev workspace has no Android SDK or Maven access, so the APK is built only by `.github/workflows/spike-apk.yml` on GitHub's runner (artifact `pos-spike-alerts-apk`).
- 2026-11-23 · build · Capacitor 8.6.2 (current stable), AGP 8.13.0, Kotlin 2.2.20, OkHttp 4.12.0, security-crypto 1.0.0, compile/target SDK 36, min SDK 24.
- 2026-11-23 · design · `test_alert` is family `info`, so the "treat all as urgent" toggle (default ON) attaches the full-screen intent to every alert. The soak exercises the urgent path; 05b will use `family` only.
- 2026-11-23 · design · On Android 12+, a foreground-service start from a background broadcast (the adb `START` broadcast) can be refused unless the app is battery-exempt. If it is refused, open the app and press **Start service**. The refusal is logged as `debug_start_failed`.

## Soak
- 2026-11-23 04:14 · owner's first tablet (model TBD) · First live test: notification while unlocked, and the red full-screen alert while locked. Lock text "Arif · spike-tablet-a · alert.test_alert.lock". Hub on the owner's laptop (10.190.116.133:3000).
- 2026-11-23 · setup · Admin routes from a paired admin browser need the device token (`Authorization: Bearer`) next to `X-Admin-Session`, otherwise `401 DEVICE_TOKEN_INVALID`. The README now has the console snippet.
- 2026-11-23 04:33 · TCL 9198S · Dry run on the first build (no device log): **19/19 delivered receipts** on the hub over ~19 min, locked, defaults (wake lock off, WifiLock on, ping 15 s, urgent FSI on).
- 2026-11-23 04:42 · TCL 9198S · Android 11 (SDK 30), TCL UI 3, security patch 2021-04-05, not device owner (not provisioned; no USB cable on hand for `dpm`). Battery-opt exempt, FSI allowed, notifications on. The LAN log upload works (skew 433 ms at that moment). After the reinstall, `alerts_open` replayed 4 still-open dry-run alerts and they were notified again (fresh dedupe set); this is correct.
- 2026-11-23 · TCL 9198S · No USB cable → no adb. The spike is now network-only (log upload, in-app toggles). Wireless-debugging pairing is not offered on this TCL UI build. The S5 (am kill) and device-owner checks need a cable later.
- 2026-11-23 04:45 · TCL 9198S · S1 (12 h, locked, on charger) started.
