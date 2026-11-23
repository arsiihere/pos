# 05b — Tablet provisioning runbook (device owner + lock task)

Spec: `docs/specs/05b_Staff_Tablet_App_Spec_v1.0.md` M-17 (N-4, N-12, N-13, O-16, O-19), §7, §8 item 5, §10.3 test 20. Plan: A15, A17.

Every restaurant tablet is **device owner** (R33, O-5). `everyone` tablets (kitchen, floor) run in lock task with the app as Home; approver (`listed`) tablets are device owner too, but keep the normal launcher and are not locked. The app decides that by itself from the device profile it gets from the hub (`setDeviceContext.lock_task`); nothing in this runbook sets it per tablet.

**Application id:** `pk.arifchatkhara.pos` (`apps/tablet/android/app/build.gradle`, `applicationId`). ⚠️ Plan AD-1: the owner confirms it before the first unit is provisioned. Once a unit is device owner the id can only change with a factory reset of that unit.

Commands below use `APP=pk.arifchatkhara.pos`.

---

## 0. Rules that are never broken

1. **Never provision with a debug build.** Debug APKs (`pos-tablet-<run>.apk`, the `tablet-dev` pre-release) are signed with the committed debug key, which is public. A device owner bound to that key accepts any APK anyone signs with it (§7, m-9). Use only a `tablet-release-<run>` APK.
2. **The release key is backed up in two places** (§7), both off the build machine (step 1.3). Losing it means every device-owner tablet must be factory reset to take a new key: Android only installs an update signed by the same key (M-15).
3. **No Google account and no screen lock on the unit.** `dpm set-device-owner` fails if any account exists, and lock task has no lock screen (N-13: no `KEYGUARD`).
4. **Device owner comes off only by a factory reset.** The app is not `testOnly`, so `dpm remove-active-admin` refuses it, and there is no exit from lock task in the app or the page (O-14).

---

## 1. One-time: the release key and the CI secrets

Done once, by the owner, on his own machine. Not in the cloud, not in the repo.

1.1 Make the key (25-year validity; choose two strong passwords and keep them in the password manager):

```bash
keytool -genkeypair -v -keystore pos-tablet-release.jks -alias pos-tablet \
  -keyalg RSA -keysize 4096 -validity 9125 \
  -dname "CN=Arif Chatkhara POS tablet, O=Arif Chatkhara, C=PK"
```

1.2 Record the certificate fingerprint (used in step 3.3 to check every APK):

> **Done 2026-11-23** (owner, `tools/tablet-release/make-release-key.sh`; the 4 `TABLET_RELEASE_*` secrets are set). Release certificate SHA-256 (public, safe to record):
> `32:27:77:2A:88:80:D6:E0:74:01:3B:05:86:9B:C2:71:CD:C9:E0:0B:0D:85:B5:6C:52:B3:59:D8:04:F7:49:45`


```bash
keytool -list -v -keystore pos-tablet-release.jks -alias pos-tablet | grep 'SHA256:'
```

1.3 Back up `pos-tablet-release.jks` **and** both passwords in two separate places, for example: (a) the password manager as an attachment, (b) an encrypted USB drive kept at home (not at the restaurant). Check both copies open before deleting any working copy.

1.4 Put it in the repo's Actions secrets (GitHub → Settings → Secrets and variables → Actions), or with `gh`:

```bash
base64 -w0 pos-tablet-release.jks | gh secret set TABLET_RELEASE_KEYSTORE_B64 -R arsiihere/pos
gh secret set TABLET_RELEASE_STORE_PASSWORD -R arsiihere/pos   # prompts; paste the store password
gh secret set TABLET_RELEASE_KEY_ALIAS -R arsiihere/pos        # pos-tablet
gh secret set TABLET_RELEASE_KEY_PASSWORD -R arsiihere/pos     # prompts; paste the key password
```

---

## 2. Build the release APK

GitHub → Actions → **tablet** → *Run workflow* → branch (`module-05b`, later `main`) → tick **release** → Run.

- With the secrets present the run uploads the artifact `pos-tablet-release-apk` and creates the pre-release **`tablet-release-<run>`** holding `pos-tablet-release-<run>.apk`.
- Without the secrets the run shows a notice "Release build skipped" and builds the debug APK only. That APK is **not** for provisioning.

Or from a terminal: `gh workflow run tablet.yml -R arsiihere/pos --ref module-05b -f release=true`, then `gh release download tablet-release-<run> -R arsiihere/pos`.

---

## 3. Provision one unit

Needs: the tablet on its charger, a USB data cable, a laptop with `adb` (Android platform-tools), the release APK, the hub's address `host:port` (shown on the hub's setup page).

3.1 **Factory reset** the tablet (Settings → System → Reset → Erase all data). Back up nothing from it.

3.2 **Setup wizard:** language; join the **staff Wi-Fi** (the hub's network, not the guest one); **skip** the Google account; **skip** every screen lock (choose "None" / "Skip"); decline optional extras (OEM accounts, backups, "Find my device" accounts). Finish to the home screen.

3.3 **Developer options:** Settings → About tablet → tap *Build number* 7 times → Developer options → turn on **USB debugging**. Connect USB, accept the laptop's key on the tablet ("Always allow").

```bash
adb devices                                       # the unit shows as "device"
adb shell dumpsys account | grep -c 'Account {'   # must print 0
apksigner verify --print-certs pos-tablet-release-<run>.apk | grep 'SHA-256'   # must equal step 1.2
```

If the certificate says `CN=Android Debug` or does not match step 1.2: **stop**, it is the wrong APK.

3.4 **Install the release APK** (a fresh unit has no other copy; if a debug build is installed, `adb uninstall $APP` first — different signer):

```bash
adb install pos-tablet-release-<run>.apk
```

3.5 **Make it device owner:**

```bash
adb shell dpm set-device-owner $APP/pos.tablet.PosDeviceAdmin
```

Expect `Success: Device owner set to package ...`. "Not allowed to set the device owner because there are already some accounts on the device" → an account exists: remove it, or factory reset and redo 3.2. "already provisioned" → the setup wizard was finished long ago on some OEM builds; factory reset and run 3.3–3.5 right after the wizard.

3.6 **Battery allowlist** (N-12; device owner already exempts background service starts, this is the battery side):

```bash
adb shell dumpsys deviceidle whitelist +$APP
adb shell dumpsys deviceidle whitelist | grep $APP    # listed
```

3.7 **Full-screen intent** (Android 14+ only; device owner cannot grant it as a permission): check `fsi_allowed` in step 4.3; if false,

```bash
adb shell appops set $APP USE_FULL_SCREEN_INTENT allow
```

3.8 Turn **USB debugging off** (Developer options), unplug.

---

## 4. First run

4.1 Open **Arif POS**. Enter the hub address `host:port` → *Connect* (M-16 messages if it fails). Device owner: the notification permission is granted by the app itself (M-17), there are no permission steps.

4.2 **Pair** the tablet (05a pairing by request; approve it from a `listed` device with `manage-devices`). Assign the device profile:
- kitchen / floor tablet → audience **`everyone`** → the app locks itself (no Home, no Recents, status bar notifications only, power menu works) and becomes the Home app.
- manager / owner tablet → audience **`listed`** → not locked, normal launcher.

4.3 **Me → device health**: device owner **yes**; lock task **locked** (`everyone`) or **none** (`listed`); notifications allowed; full-screen intent allowed; battery exempt; exact alarms; service connected; app version = the release run number.

---

## 5. Checklist (spec §8 item 5)

Device-owner units cover some items by policy; every unit is still checked.

| # | Check | Device owner |
|---|---|---|
| 1 | Battery "No restrictions" + auto-start allowed + app locked in recents | battery by 3.6; auto-start / recents lock on OEM skins (TCL, Xiaomi …) still set by hand in the app's settings |
| 2 | Notifications on, urgent channel with sound, lock-screen content shown, Do Not Disturb off | permission self-granted; channels and DND checked by hand / health card |
| 3 | "Install unknown apps" allowed | not needed: device owner installs updates silently (M-15) |
| 4 | Wi-Fi: "Keep Wi-Fi on during sleep: Always", Wi-Fi power saving off, **other networks forgotten** (guest Wi-Fi especially) | by hand |
| 5 | The hub has its fixed IP; the router has **no AP / client isolation** on the staff Wi-Fi | router |
| 6 | Tablet stays on its charger | by hand |
| 7 | Never **Force stop** the app | staff briefing |
| D | **Daily:** the status notification shows "Connected"; a **test alert from a listed device** (05a Test alert, `manage-devices`) rings on this tablet | daily |

---

## 6. Manual test 20 (spec §10.3) — run on each pilot model and one Android 14+ unit

Record the model, Android version, build run and the result of each line in `docs/plans/05b-manual-checks.md`.

1. Provisioned with the release-signed APK on a factory-reset unit (sections 3–4); `isIgnoringBatteryOptimizations()` true (health "battery exempt").
2. `everyone` profile, locked in: a heads-up banner shows, the shade pulls down, a full-screen urgent alert shows with the screen off, the power menu opens (N-13). Home and Recents do nothing. Test 23 (tap → inbox with the card focused, still signed in) passes inside lock task.
3. Reboot → the app is in front and locked, and the service is connected within 60 s.
4. APK update (a higher release run served by the hub) → installs silently when signed out with no unseen urgent alert; the app comes back in front and locked.
5. Change the profile `everyone` → `listed` → at the next resume (screen off / on) the tablet is unlocked and the normal launcher is Home. Back to `everyone` → locked again and the app is Home.

---

## 7. Removing device owner / re-provisioning

- **Factory reset is the only way** (rule 0.4): Settings → Reset, or, if locked in, power off → recovery (model-specific key combo) → wipe data. Then start again at 3.1.
- Changing the application id or the release key = factory reset of every unit.
- A unit that leaves service: factory reset before it leaves the restaurant (it holds the device token, §5).
