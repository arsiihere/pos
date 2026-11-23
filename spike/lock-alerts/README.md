# Spike: lock-screen alerts (throwaway)

**Question:** can a Kotlin foreground service on the pilot tablet keep the hub's existing 01d alert-mode socket alive while the tablet is locked, and ring for every alert? The answer feeds the 05b spec. This branch is **never merged** and is deleted after `SPIKE_RESULTS.md` is read.

- `app/`: Capacitor 8.6.2 shell + Kotlin `AlertService` (foreground service `specialUse`, OkHttp WS, notifications + full-screen intent, receipts, dedupe, boot start, JSONL log).
- `scripts/`: Node 22 tools with no dependencies (mint token, fire, control socket, skew, analyse). Full detail is in [`scripts/DEV_HUB.md`](scripts/DEV_HUB.md).
- `NOTES.md`: surprises. `SPIKE_RESULTS.md`: fill per unit × scenario.
- The APK is built by `.github/workflows/spike-apk.yml` on every push to this branch.

## Morning checklist (owner)

**0. Once:** on the laptop, Node 22 and the repo on branch `spike/lock-alerts`. **No USB or adb is needed:** the app uploads its log over the LAN to `scripts/log-receiver.mjs`, which also measures the clock skew. adb is optional and only needed for the device-owner check (step 1) and the S5 kill test. On the tablet, keep **Stay awake OFF** (you want it to sleep).

**Network-only loop (no adb):**
- Run `node log-receiver.mjs` on the hub's machine. It prints the receiver URL.
- In the app, put `http://<laptop-ip>:8787/log?label=<run>` in **Laptop log receiver** and tap **Upload log to laptop**. The log lands in `scripts/logs/tablet-<run>.jsonl`, and the receiver prints `--skew-ms`.
- Use the in-app buttons for toggles (then **Apply**), **Clear log** and Start/Stop.
- Updates: the APK is signed with a fixed spike key (`app/android/spike-debug.keystore`). From the build that added it onward, a new APK installs over the old one and keeps the token and log.

**1. Device-owner check (OQ2, R33).** Do this only on a **freshly factory-reset unit with no Google account added**, because the `dpm` command needs that. Install first (step 2), then:
```sh
adb shell dpm set-device-owner pos.spike.lockalerts/.AdminReceiver
```
Record success or the exact error in SPIKE_RESULTS "Units". If it fails, carry on without device owner and note it.

**2. Install the APK.** Either open this link on the tablet: `https://github.com/arsiihere/pos/releases/download/spike-lock-alerts/pos-spike-alerts.apk` (allow "install unknown apps" for the browser), or from the laptop:
```sh
curl -L -o pos-spike-alerts.apk https://github.com/arsiihere/pos/releases/download/spike-lock-alerts/pos-spike-alerts.apk
adb install -r pos-spike-alerts.apk
```

**3. Mint tokens.** Open `http://<hub-ip>:3000/admin` and sign in. In the DevTools Console, read the admin session **and** this browser's device token. The admin routes want both when the page runs on a paired browser; with only the session you get `401 DEVICE_TOKEN_INVALID`:
```js
[sessionStorage.admin_session_token, sessionStorage.admin_staff_id]
await new Promise(r => { const q = indexedDB.open('pos-device', 1); q.onsuccess = () => { const s = q.result.transaction('device').objectStore('device'); const out = {}; let n = 0; for (const k of ['token','device_id']) { const g = s.get(k); g.onsuccess = () => { out[k] = g.result; if (++n === 2) r(out); }; } }; })
```
Then mint, from `spike/lock-alerts/scripts`:
```sh
H=http://<hub-ip>:3000
A="--hub $H --admin-session <session> --staff <staff_id> --admin-device-token <token> --admin-device-id <device_id>"
node mint-tablet-token.mjs $A --label tablet-a
node mint-tablet-token.mjs $A --sender
node mint-tablet-token.mjs $A --label control
node -e 'console.log(require("./devices/tablet-a.json").device_token)'   # the TABLET's token (the last mint prints control's)
```
The hub's LAN IP: `hostname -I | awk '{print $1}'` on the hub machine; check `curl http://<hub-ip>:3000/health`. The laptop running the hub must not suspend during a soak.

**4. Inject the token** (printed by the mint script), or paste it into the app's page and tap **Save → native**:
```sh
adb shell am broadcast -a pos.spike.SET_TOKEN -n pos.spike.lockalerts/.DebugReceiver --es url http://<hub-ip>:3000 --es token <tablet-a token>
```

**5. Open the app** and tap **Notification permission**, then **Battery-optimisation exemption** (Allow), then **Full-screen-intent permission** (check it is allowed), then **Start service**. In the status table, the socket should read `up` within a few seconds.

**6. Dry run (30 min).** Leave it unlocked for 2 alerts, then lock the screen:
```sh
cd spike/lock-alerts/scripts
node control-socket.mjs --device devices/control.json --quiet &
node fire.mjs --sender devices/sender.json --target devices/tablet-a.json --staff <manager> --pin <pin> --label dry --interval-s 60 --count 30
```
Each alert should ring and light the lock screen (red full-screen alert). Then pull and analyse:
```sh
adb exec-out run-as pos.spike.lockalerts cat files/spike-log.jsonl > logs/tablet-a-dry.jsonl
node skew.mjs --hub http://<hub-ip>:3000
node analyse.mjs --fire logs/fire-dry.jsonl --device logs/tablet-a-dry.jsonl --label dry --skew-ms <skew>
```

**7. Soak S1–S7** (table below) with the commands in `scripts/DEV_HUB.md` §A. Fill `SPIKE_RESULTS.md`. Clear the device log between runs:
```sh
adb shell am broadcast -a pos.spike.CLEAR_LOG -n pos.spike.lockalerts/.DebugReceiver
```

**If anything breaks,** paste these into the chat:
```sh
adb logcat -d | grep -E "PosSpike|AndroidRuntime|AlertService" | tail -200
adb exec-out run-as pos.spike.lockalerts cat files/spike-log.jsonl | tail -100
```
plus a screenshot of the status table.

## Soak scenarios (per unit; fire every 60 s ± 20 s unless stated)

| # | Scenario | How |
|---|---|---|
| S1 | 12 h locked on charger | Screen off, locked, charger, Wi-Fi on. Don't touch it. `--duration-h 12` |
| S2 | 4 h locked on battery | Unplug from ≥ 90 %. Battery %/h comes from the heartbeat lines. `--duration-h 4` |
| S3 | Hub restart | During S1/S2, restart the hub 3×, ≥ 20 min apart. Note stop and ready times → `--outage` |
| S4 | Router reboot | 2×, ~5 min each (below the 10 min `test_alert` expiry) → `--outage` |
| S5 | Process killed | `adb shell am kill pos.spike.lockalerts`, then separately `adb shell am force-stop pos.spike.lockalerts` (info only) |
| S6 | Reboot | `adb reboot`, leave it locked, don't open the app |
| S7 | Burst | `fire.mjs … --label S7 --burst 30` while locked |

**Pass, per unit:**
- 100 % of alerts fired while the hub was up are received, notified and have a hub receipt;
- p95 < 3 s outside outages;
- it rings every time (spot-check ≥ 10 by ear while locked);
- zero duplicates;
- S3, S4 and S6 recover untouched.

**Config:** defaults are wake lock ON, WifiLock ON, ping 15 s, urgent ON, plus the 10-min watchdog alarm. To measure whether the wake lock is really needed, turn it OFF in the app and re-run:
```sh
adb shell am broadcast -a pos.spike.SET_TOGGLE -n pos.spike.lockalerts/.DebugReceiver --es key wake_lock --es value false
```
Then Stop and Start the service from the app.

## Control (adb, debug only)

| Action | Command (`-n pos.spike.lockalerts/.DebugReceiver`) |
|---|---|
| Set token | `-a pos.spike.SET_TOKEN --es url http://HUB:3000 --es token TOK` |
| Start / stop service | `-a pos.spike.START` / `-a pos.spike.STOP` (if START is refused on Android 12+, press Start in the app) |
| Toggle | `-a pos.spike.SET_TOGGLE --es key wake_lock\|wifi_lock\|urgent_fsi\|ping_s --es value …` |
| Clear log | `-a pos.spike.CLEAR_LOG` |

Device log: `adb exec-out run-as pos.spike.lockalerts cat files/spike-log.jsonl`. Event names: `socket_*`, `auth_sent`, `first_frame`, `first_frame_timeout`, `reconnect_*`, `network_*`, `frame`, `alert_received`, `notify_posted`, `notified`, `receipt_sent`, `duplicate_dropped`, `fsi_shown`, `heartbeat` (every 5 min: screen, Doze, battery, locks, RSSI), `service_start` / `service_destroyed`, `boot_received`.
