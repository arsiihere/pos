# Install precautions — staff tablet alerts (TCL 9198S, TCL UI 3, Android 11)

Do these once per tablet at install. Each one removes a way Android or TCL can silence alerts while the tablet is locked. Menu names vary a little between TCL builds; look for the words given.

## A. App battery: never restrict
1. Settings → **Battery** → find the app (POS / "POS Spike Alerts") → **No restrictions** / **Don't optimise** / **Allow background activity**.
2. Settings → Battery → **Smart Manager**, or **App auto-start** / **Background management** (TCL): **allow auto-start** and **allow running in background** for the app.
3. Open recents (the square button), long-press the app → **Lock** (padlock), so "clear all" never kills it.
4. Turn **Battery saver / Power saving mode** OFF, and turn **Adaptive battery** OFF.
5. In the app: the **Battery-optimisation exemption** button shows `true` in Status.

## B. Notifications: loud, on the lock screen
1. Settings → Apps → the app → **Notifications** → ON. Channel **"POS alerts"**: Importance **Urgent / Make sound and pop on screen**, sound ON, vibration ON.
2. Lock screen: Settings → Notifications → Lock screen → **Show all notification content**.
3. **Do Not Disturb OFF**, or add the app to DND exceptions.
4. **Notification volume high**. Volume key → settings → notification slider up; don't use silent or vibrate mode.
5. In the app: **Full-screen-intent** shows `true`.

## C. Wi-Fi: never sleeps, never wanders
1. Settings → Wi-Fi → Advanced (or ⋮) → **Keep Wi-Fi on during sleep: Always**.
2. Turn OFF any **Wi-Fi power saving**, **Smart network switch**, or **Switch to mobile data / better network** option.
3. Forget every other saved Wi-Fi network, so the tablet only knows the restaurant network.
4. The router gives the **hub a fixed IP** (DHCP reservation), and the app uses that IP.
5. The router must **not** use client / AP isolation (tablets must reach the hub). Use one SSID for everything.

## D. Power and placement
1. Tablets live on a **charger** at their station. The app holds a wake lock by default, which costs battery; on a charger that doesn't matter.
2. Don't **force stop** the app (Settings → Apps → Force stop). Force-stop is the one thing nothing can recover from until someone opens the app again.
3. After any **reboot**, the app restarts itself within ~1 minute. Check the "POS alerts — Connected" status notification is there.

## E. Daily check (10 seconds, start of shift)
- The status bar shows the **"POS alerts — Connected"** notification.
- The manager sends a **test alert** from the manager screen (01d) and the tablet rings.

## F. Later (pilot hardening, needs a factory reset + USB once)
- **Device owner / lock-task** (R33): the strongest protection. The OS treats the app as the device's owner, so the battery managers can't kill it, and staff can't exit, uninstall or force-stop it. It needs a factory-reset tablet and one adb command; it will be part of the 05b provisioning steps.

## What the app now does by itself (spike build after 2026-11-23 11:40)
- A foreground service with a permanent notification (Android won't freeze it like a normal app).
- A **wake lock ON by default**: the CPU stays awake, so Doze can't freeze the socket.
- A **WifiLock**: the Wi-Fi radio stays in low-latency mode while the screen is off.
- A **Doze-proof watchdog alarm every 10 min**: if the service was killed, it restarts it; if the socket is down, it reconnects.
- Restarts after **reboot** and after the app is **swiped away**.
- Reconnects at once when Wi-Fi comes back. Retries every 0.5 → 5 s, and gives up on a dead connection attempt after 10 s.
- On reconnect the hub re-sends every still-open alert, and the app never rings twice for the same one.
