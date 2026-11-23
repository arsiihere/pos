# 05b manual checks and soak (plan A18)

Hand checks for the staff tablet app (spec `docs/specs/05b_Staff_Tablet_App_Spec_v1.0.md` §10.3 tests 18–28 and §10.4 soak S1–S7), run by the owner / developer on the pilot tablets. Nothing here is run or ticked by the build or CI (CLAUDE.md: no hardware checks in the cloud or CI).

Definition of Done (§12): tests 18–28 recorded **per pilot model and on one Android 14+ unit**; S1–S7 **PASS on the pilot model(s)**.

How to fill in: in each cell write **pass**, or **what you saw** (short; details under "Notes" below the table). `n/a` only where the check says so. Sign each section's **Done by / date** line.

---

## 0. Units under test

| | Model A (pilot) | Model B (pilot, second brand) | Android 14+ unit |
|---|---|---|---|
| Make / model | | | |
| Android version / SDK | | | (must be 14+ / SDK 34+) |
| OEM skin + security patch | | | |
| APK (`tablet.yml` run #, `version_code`) | | | |
| Build type (debug / release-signed) | | | |
| Device owner? (test 20) | | | |
| Profile audience (`everyone` / `listed`) | | | |

OQ-1: model A is the TCL 9198S if S1–S7 pass; model B a different brand.

## 0a. Five-tablet split (owner has 5 units, 2026-11-23)

Run everything in **one day + one night** by giving each unit a role. Fill §0 for every unit used.

| Unit | Build | Role | Manual checks (day) | Soak |
|---|---|---|---|---|
| **T1** | release, **device owner**, profile `everyone` (pass / kitchen) | lock task, Home, reboot, silent update | 20a, 20b, 20c, 20d, 20e, 21c, 26 (the staged unit) | S6 |
| **T2** | release, **device owner**, profile `listed` (approver) | alerts signed in / out, urgent, lock text, taps | 21a, 21b, 21d, 22a, 22b, 23 | S2 (battery, 4 h) |
| **T3** | debug | first run, pairing, hub down, crash, revoke | 18, 19, 24a, 24b, 24c, 28, then 27a **last** (revokes it) | — |
| **T4** | debug | live UI update, network outages, kills, burst | 25, 27b | S3, S4, S5, S7 |
| **T5** | release, not device owner (the **Android 14+ unit** if one of the five is 14+; else a second brand) | Android 14 full-screen-intent permission, OEM differences | 21b, 22a, 23 | — |

**Night:** S1 (8 h, alert every 60 ± 20 s) on **all five at once** — one `fire.mjs` run reaches every paired unit; `analyse.mjs` per device log. Re-pair T3 after 27a first.

Order: T1/T2 need the release APK (`tablet.yml` manual run with `release: true` after the merge to main) and a factory reset; start T3/T4 on the debug APK from `tablet-dev` meanwhile.

## 1. Before you start

1. Hub at the `module-05b` release commit, client shipped (`apps/hub/deploy/ship-client.sh`), `/health` `ready`.
2. Each unit set up by the §8.5 install checklist (non-device-owner units): battery "No restrictions" + auto-start + lock in recents; notifications urgent with sound, lock-screen content shown, DND off; "Install unknown apps" allowed; "Keep Wi-Fi on during sleep: Always", Wi-Fi power saving off, other networks forgotten; the hub's fixed IP; no AP isolation; on charger; never Force stop.
3. Soak tools and the device log: `tools/tablet-soak/DEV_HUB.md`.

---

## 2. Manual on the tablet (§10.3, tests 18–28)

| # | Check (spec §10.3) | Model A | Model B | Android 14+ unit |
|---|---|---|---|---|
| 18 | **First run.** Wrong address → M-16 message; wrong port → M-16 message; guest Wi-Fi → "Connect to the staff Wi-Fi" message; right address → pair by request → staff page. | | | |
| 19 | App approved as `phone` (not `tablet`) → refused, a new request started (M-4 review). | | | |
| 20a | **Device owner** provisioning with the release-signed APK on a factory-reset unit; battery allowlist by the runbook: `isIgnoringBatteryOptimizations()` true (device-health card). | | | |
| 20b | Lock task on an `everyone` profile: heads-up banner, notification shade, FSI and the power menu work while locked in. | | | |
| 20c | Reboot → the app is in front and locked, the service is up within 60 s. | | | |
| 20d | An APK update → the app is in front and locked again. | | | |
| 20e | Profile `everyone` → `listed` → unlocked and normal launcher at the next resume; and back to `everyone` → locked (O-19, N-4, N-12, N-13). | | | |
| 21a | Signed in, an alert: **one** banner, **one** sound (M-8). Measure the 1 s window across the process hop (write the ms). | | | |
| 21b | Signed out, locked: notification + sound; an urgent alert → FSI + a repeat every 10 s until seen elsewhere. | | | |
| 21c | Pass tablet (always-on): one sound per step. | | | |
| 21d | Lock text: the notification line equals the page's lock-panel line, in **EN** and in **UR** (switch the page language; M-9). A `silent` kind (`approval_receipt`) posts nothing. A `request_result` approved / rejected plays the rising / falling result sound. | | | |
| 22a | Signed in, screen off: the service posts and repeats (M-10). | | | |
| 22b | Screen goes off during a page-owned repeat → the service continues within 10 s (O-18). | | | |
| 23 | Tap a notification → inbox with the card focused, still signed in — also inside lock task (N-13). | | | |
| 24a | Hub stopped at app start → no ANR; the bundled page within the 3 s probe timeout; hub started → staff page by itself. | | | |
| 24b | Hub stopped while the page is open → the page's own "Can't reach the hub", still signed in, no reload. | | | |
| 24c | A later main-frame load failure → the hub-unreachable page; a failed subresource → nothing (N-2, N-3). | | | |
| 25 | `ship-client` + hub restart → a signed-out tablet reloads within 10 min; a signed-in one shows "Update ready". | | | |
| 26 | Staged APK: only the staged tablet installs, inside the install window; alerts are back after the install without opening the app; `mark-good` → the rest install. | | | |
| 27a | Revoke from `#/devices` → the service stops, the page goes back to `/pair`. | | | |
| 27b | Router rebooted onto the guest SSID, signed in **and** signed out → token kept on both sides, "Connect to the staff Wi-Fi", recovers on the staff SSID (N-5). | | | |
| 28 | Renderer crash (debug build, `chrome://crash`) during an urgent repeat → the repeat continues; the page comes back. | | | |

Notes (by test #):

-

Done by / date: ____________________

---

## 3. Soak acceptance (§10.4, per pilot model)

Tools: `tools/tablet-soak/` (`fire.mjs`, `analyse.mjs`, `skew.mjs`, `control-socket.mjs`, `log-receiver.mjs`, `mint-tablet-token.mjs`; how-to in `DEV_HUB.md`). Latency = device `alert_received` − hub `raised_at` + skew. Defaults on (wake lock, WifiLock, watchdog). Paste each `analyse.mjs` results row under its table; run the control socket alongside as the baseline.

| # | Scenario | Pass rule | Model A | Model B | Android 14+ unit (optional) |
|---|---|---|---|---|---|
| S1 | **8 h** locked on charger, an alert every 60 ± 20 s | 100 % received, notified and receipted; p95 < 3 s; no duplicates | | | |
| S2 | 4 h locked on battery from ≥ 90 %, **wake lock on** | as S1; **battery %/h recorded** (OQ-3) | | | |
| S3 | hub restarted 3× | every alert raised before each stop received via `alerts_open`; reconnect < 10 s after ready | | | |
| S4 | router rebooted 2× (~5 min) | outage alerts arrive after it, untouched | | | |
| S5 | process killed (`adb shell am kill`, or the debug build's "kill service") | back within 10 min (watchdog), untouched | | | |
| S6 | tablet rebooted | service up within 60 s without opening the app | | | |
| S7 | 30 alerts in 30 s (`fire.mjs --burst 30`) | 30 notified, no drop, no duplicate | | | |

Per run, record:

| Run | Unit | Scenario | Start / end (PKT) | Skew start / end ms | Fired | Received / notified | Hub receipts | Missed | Dupes | p50 / p95 / max ms | Battery %/h (S2) | Outage windows (S3, S4) | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | |

M-5 (N-11) on SDK 34+: note the WifiLock effect seen in S1 / S2 per model:

-

Done by / date: ____________________
