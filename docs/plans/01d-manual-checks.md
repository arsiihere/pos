# 01d manual checks (task 43 step 3)

Hand checks for 01d (spec `docs/specs/01d_Notifications_Requests_Spec_v1.0.md` §12.1, §12.2, §10.10), run by the developer on the pilot hardware, except check 6, which runs on the dev box. Nothing here is run or ticked by the build. Fill in each **Result:** line with **pass**, or **what you saw**, and the **Done by / date** line.

Checks 1–6 come from plan task 43. Checks 7–10 follow from the batch 9a work and its rulings (AD-123, AD-T42-2, the visual pass).

---

## 0. Before you start

### 0.1 What can and cannot be raised by hand today

01d ships six alert kinds (`apps/hub/src/alerts/kinds.ts`, §3.10). None of them is a request, an `urgent` kind or an `action` kind:

| Kind | Family | How it is raised by hand |
|---|---|---|
| `test_alert` | info, chime | **Test alert** tab in `/staff/` (needs `manage-devices`; Owner and Manager have it). Targets: a person, a team (direct or whole), or **This device** only (AD-T41-7). Closes `expired` after 10 min. |
| `no_approver` | info, chime | Open the business day, then make sure nobody with an approver role is signed in anywhere. On the seed, the Cashier's `apply-discount` needs a **Manager**, so the alert opens when the last Manager signs out. It closes `done` when a Manager signs in. |
| `request_result`, `pin_use_failed`, `approval_receipt`, `answered_on_requester_device` | info | Only as a side effect of a request. **Cannot be raised today.** |

The approval kind `t_approval` and the accept kind `t_accept` are registered **only inside the Vitest files** (spec §10, "registered only in tests"). There is **no test build, script or CLI** that registers them in a running hub. The production entry cannot register test commands or kinds (`apps/hub/test/smoke/README.md`). No production module raises a request yet: 02 and 04 add the first ones (AD-1: "no 01d kind is raised by staff in production").

So every step below that needs a request, an urgent sound, an `action` alert, a PIN answer or a silent receipt is marked **BLOCKED (no request kind)**. Run the rest now. The blocked steps run either when 02 or 04 ships its first request kind, or after the controller adds a harness that raises `t_approval` on a running hub. That harness does not exist; it would be a new task, written spec-first. The blocked steps are written out in full so they can be run without rework later.

### 0.2 Build and deploy

1. On the dev box, at the release commit of `module-01d`: `pnpm install && pnpm test` (this builds `apps/client/dist/`, including `dist/staff/`).
2. Stop the hub on the mini PC (`sudo systemctl stop hub`), check out the same commit in `/opt/pos-hub`, then ship the client from the dev box: `apps/hub/deploy/ship-client.sh <ssh-target>`. Start the hub again: `sudo systemctl start hub`.
3. `<hub>` below means `<hub-ip>:<http_port>`, from `http_port` in `/etc/pos-hub/config.json`. The hub serves **http** on the LAN (CLAUDE.md: `ws://` on the LAN). There is no https URL.
4. Check: `http://<hub>/health` answers, and `http://<hub>/staff/` loads on the laptop.

### 0.3 Devices

Pair each device at `http://<hub>/pair` and approve it in `http://<hub>/admin#devices` with the type shown. Pair the phone through `http://<hub>/admin#add-phone`, which names its owner.

| Name here | Hardware | Type | Opens |
|---|---|---|---|
| **TAB-A** | pilot tablet, Chrome | Tablet | `http://<hub>/staff/` |
| **TAB-B** | second tablet (or a laptop browser profile), Chrome | Tablet | `http://<hub>/staff/` |
| **KIOSK** | Windows cashier PC, Chrome or Edge in kiosk mode (D56) | Cashier screen | `http://<hub>/staff/` |
| **PHONE-W** | the waiter's own phone, Chrome | Phone, owner = waiter **W** | `http://<hub>/staff/` |
| **LAPTOP** | dev laptop on the restaurant LAN | — | `http://<hub>/admin`, `http://<hub>/admin/stock/` |

Audio: the page creates its sound context on the first sound and resumes it if it is suspended (`apps/client/src/features/alerts/sounds.ts`). Browsers may hold audio back until the page has had one tap. On each device, tap the page once after it loads, then turn the device volume up. If a device plays nothing until it is tapped, write that down under check 8.

### 0.4 People

Use the pilot's real staff. The demo names from `docs/manual-test-e2e.md` are given as examples:

| Name here | Role | Example (seed) | Notes |
|---|---|---|---|
| **M1** | Manager | Hamza `2222` | has `manage-devices`; approver for the Cashier's `apply-discount` |
| **M2** | Owner | Arif `1234` | branch-scope; gets `managers` alerts |
| **L** | Order taker, the waiter's lead | Ali `4444` | idle timeout 15 min |
| **W** | Waiter, reports to **L** | Zain `5555` | idle timeout 5 min (Waiter role, `session_idle_ttl_ms` 300 000) |
| **C** | Cashier | Usman `3333` | |

Before you start, check in the owner app that **W** reports to **L**, that **W**'s role still has the 5-minute idle timeout, and who **L** reports to (that person is **L**'s lead in check 2). Nobody is ticked present or absent: 9a has no presence screen, so the safety rule (§3.11, nobody ticked → everyone present) applies throughout.

### 0.5 Reference frames

- Hand-off frames: `docs/design/handoff/01d/design/screens/*.png` (59 frames).
- Build screenshots from the visual pass: `docs/design/handoff/01d/build-screens/`.
- Known, accepted differences: `.superpowers/sdd/01d-plan/task-visual-report.md` (for example, only "This device" in the Test alert device list, and no role line on sign-in).

---

## Check 1 — Staff entry on a tablet browser and the kiosk

**Spec:** §8.1, §3.7, §8.3; DoD §12.1. The screen-off tablet (Android notification, the first half of DoD §12.1) is in the tablet plan (9b, AD-1), not here.

**Preconditions:** TAB-A, TAB-B and KIOSK paired; the business day open (`/admin/stock/` → **Start day**).

### 1a. Kiosk alert mode with no session (runnable now)

1. On KIOSK, open `http://<hub>/staff/` and make sure nobody is signed in. The page shows the lock view ("Alerts", "Sign in to see details").
2. On LAPTOP, sign out every Manager everywhere: `http://<hub>/admin#sessions` → log out **M1**'s sessions. Only the Owner, **M2**, may stay signed in.
3. Within about 1 s (one tick), check KIOSK.
4. On TAB-A, sign in as **M1** at `http://<hub>/staff/`.
5. Check KIOSK again.
6. On KIOSK, sign in as **M1**, open **Test alert** → **This device** → **Send test**. Then tap **M1 — sign out**.

**Expected:**
- After step 3: KIOSK shows the `no_approver` line in its lock view with the info chime. There are no names, amounts or reasons on the lock view (§3.12). **M2**'s `/staff/` inbox, if open, has the same alert.
- After step 5: the `no_approver` line goes away (closed `done`).
- After step 6: once signed out, KIOSK's lock view lists the test alert as a line (alert mode, `alerts_open`), with no details. The test alert closes by itself 10 min after it was sent.

**Result:**
**Done by / date:**

### 1b. Urgent request on a tablet: sound, banner, the 10 s repeat stops when opened elsewhere — BLOCKED (no request kind)

Run this when a request kind can be raised (see 0.1).

1. Sign in as **M1** on TAB-A and as **M1** again on TAB-B: one person on two tablets, both able to answer.
2. Raise one urgent approval request that **M1** may answer, from a third device.
3. On both tablets, listen for 30 s without touching anything.
4. On TAB-B, open the request from the banner.
5. Listen on TAB-A for 30 s more.

**Expected:** at step 2 both tablets show the urgent banner (frame BannerUrgent) and play the urgent sound, repeated every 10 s (§8.3). Opening it on TAB-B (`MarkAlertsSeen`) sends `alert_seen` to **M1**'s other sockets (test #39), so TAB-A's 10 s repeat stops within a second. A 2-min reminder carries on until the request closes. From step 1 (45 s) the kiosk, an always-on screen, shows the request too. While nobody is signed in on it, it shows a lock line only, with no details (frames BannerKiosk, LockKiosk).

**Result:**
**Done by / date:**

---

## Check 2 — Alert mode after the session idles out

**Spec:** §3.7, §3.4.3 (stale binding, 2 h rule), BF-5; tests #27, #57.

**Preconditions:** PHONE-W paired as a phone owned by **W**; TAB-A paired; **M1** signed in on TAB-B at `http://<hub>/staff/`.

### 2a. Waiter's phone falls back to alert mode (runnable now with `test_alert`)

1. On PHONE-W, open `http://<hub>/staff/` and sign in as **W**. Note the time.
2. Leave PHONE-W untouched with the page open and the screen on, for at least 5 min 30 s.
3. Check PHONE-W.
4. On TAB-B (**M1**), open **Test alert** → **Person** → pick **W** → **Send test**.
5. Watch PHONE-W, then look at the receipts view on TAB-B.

**Expected:**
- Step 3: the session has ended (`idle_timeout`); PHONE-W shows the phone lock view (frame LockPhone): alert mode, no details.
- Step 5: PHONE-W plays the info chime and shows the test alert as a lock line. The receipts view on TAB-B lists **W** with PHONE-W as delivered (the phone's owner binding outlives the session, test #27).
- The brief asks for an **`action`** alert to ring here. No `action` kind exists (0.1), so the `test_alert` (info chime) stands in. Write down that the `action` sound is **BLOCKED (no action kind)**.

**Result:**
**Done by / date:**

### 2b. Tablet header "Alerts: <name> — pauses at h:mm" (runnable now)

1. On TAB-A, open `http://<hub>/staff/` with nobody signed in. Read the header.
2. Sign in as **L**. Note the hub time (shown at the top of the page).
3. Read the header.
4. Tap **Inbox** (a query: it must not move the deadline). Read the header.
5. A few minutes later, have **M1** on TAB-B send **Test alert** → **Person** → **L**. On TAB-A, open it, which sends `MarkAlertsSeen`. Read the header (AD-T42-2: an accepted command from this page moves the deadline to hub-now + 2 h).
6. With **L** signed in, leave TAB-A untouched until **L**'s session idles out (15 min for an Order taker).
7. Read the header.
8. Sign in as **L** again, then tap **L — sign out**. Read the header.

**Expected:**
- Step 1: "Alerts: none".
- Step 3: "Alerts: L — pauses at h:mm", where h:mm is the sign-in time + 2 h, in 12-hour time (AD-167), for example "pauses at 2:05 PM".
- Step 4: unchanged.
- Step 5: the time moves to the command time + 2 h.
- Step 7: the same line is kept after the idle sign-out (AD-T42-3: idle keeps the binding). When the time passes, the header shows "Alerts paused" with one info chime (frame SignInPaused; test #57 client). Leave the tablet on to see that, or check it at the next step 2c.
- Step 8: "Alerts: none" (logout ends the binding, test #27).

**Result:**
**Done by / date:**

### 2c. The alert goes "for" the lead (runnable now with `test_alert`)

9a's tablet page opens **no socket while signed out** (§8.2 m6; only the 9b background service does), so a signed-out TAB-A is **not connected**. A binding is a route only while its device is connected (`apps/hub/src/alerts/routes.ts`, §3.4.3). So, before 9b, an alert to **L** goes to **L**'s lead as soon as **L** idles out on TAB-A. It does not wait for the 2 h deadline. The 2 h rule itself is test #57 (hub) and is seen on hardware in 9b.

1. With **L** idled out on TAB-A (2b step 6) and **L** signed in nowhere else, have **L**'s lead signed in on TAB-B.
2. From any device signed in as **M1**, send **Test alert** → **Person** → **L**.
3. Look at the lead's inbox on TAB-B and at the receipts view.

**Expected:** the lead's inbox has the test alert marked "for L" (`for_staff_id`, frame InboxLead). The receipts view shows **L** reached through the lead, not TAB-A. TAB-A shows nothing.

**Result:**
**Done by / date:**

---

## Check 3 — `test_alert` to a person, a team and a device

**Spec:** §6.5, §6.10, §3.6; tests #17, #46. DoD §12.1: "the receipt view shows delivered and seen".

**Preconditions:** **M1** signed in on TAB-B; **L** signed in on TAB-A; **W** signed in on PHONE-W; KIOSK signed out (alert mode).

1. **Person.** On TAB-B: **Test alert** → **Person** → **W** → **Send test**. On PHONE-W, open the alert.
2. **Team (direct).** **Test alert** → **Team** → **L** → **Direct reports** → **Send test**. Open it on TAB-A only.
3. **Team (whole).** The same with **Whole team**.
4. **Device.** **Test alert** → **This device** → **Send test** (the only device choice, AD-T41-7). To test the kiosk as a device target, do it from KIOSK signed in as **M1** (check 1a step 6).
5. **Offline device.** Put PHONE-W in airplane mode and wait 1 min. Send **Person** → **W** again.
6. **Point.** Look at the **Point** option.

**Expected:**
- Every send lands on the receipts view (frame Receipts): "Sent h:mm by M1 · to …", one row per person and device or route, with **Delivered** and **Seen** filled as each device receives and opens it.
- Step 1: **W** / PHONE-W delivered, then seen after it is opened.
- Steps 2–3: direct = **L** and **L**'s direct reports; whole = everyone under **L**. **L**'s row on TAB-A is delivered and seen; the others are delivered only, or "No route" where a person has no device.
- Step 4: one row, this device, delivered.
- Step 5: PHONE-W gets **no** Delivered tick. **W** shows as reached through the lead ("for W", lead fallback) or as "No route", never as delivered on the offline phone.
- Step 6: Point is shown as not available (`points_not_available`, until 01a points exist).
- Each test alert disappears from the inboxes 10 min after it was sent (closed `expired`).

**Result:**
**Done by / date:**

---

## Check 4 — PIN lockout on answers — BLOCKED (no request kind)

**Spec:** §3.3 rules 2–4, M3, N1, R1; tests #12, #54, #60. Run this when a request kind can be raised (0.1). The sign-in PIN lockout is 01b's and is not this check.

**Preconditions:** an approval request that needs a PIN (money kind), raised on TAB-A by a requester; **M1** and **M2** can approve it; LAPTOP signed in at `http://<hub>/admin`.

1. **Staff lockout.** On TAB-A (the raising device), **In person** → pick **M1** → enter a wrong PIN, five times.
2. A sixth try with **M1**'s correct PIN.
3. On LAPTOP, open `http://<hub>/admin#lockouts`.
4. **Device lockout.** Wait out the staff lockout, or use other approvers. From TAB-A, enter wrong PINs for different approvers until 10 failures have come from TAB-A within 5 min.
5. Open `http://<hub>/admin#lockouts` again.
6. **Race.** Raise a new request. On TAB-A, start an in-person answer with **M1**'s correct PIN. At the same moment, **M2** approves it on TAB-B. Make **M2**'s approval land first: have **M2** tap **Approve**, then submit **M1**'s PIN.
7. On TAB-B, sign in as **M1** (or open **M1**'s phone).

**Expected:**
- Steps 1–2: tries 1–4 → "Wrong PIN."; the fifth locks **M1** (`429 PIN_LOCKED_OUT`, frame PinLocked, with the wait from `retry_after_ms`); the correct PIN is refused while locked.
- Step 3: **M1** is listed as locked out.
- Step 4: the 10th failure → `429 DEVICE_LOCKED_OUT`; TAB-A refuses any PIN until it expires.
- Step 5: TAB-A is listed as a device lockout.
- Step 6: **M1**'s answer fails with "already answered" (`409 REQUEST_NOT_PENDING`), and the attempt is counted once.
- Step 7: **M1** has a `pin_use_failed` card ("your PIN was used …", frame NoticePinFailed) on that other device. It is not shown on TAB-A, the seat that sent the PIN.

**Result:**
**Done by / date:**

---

## Check 5 — #58 timed tick on the pilot mini PC

**Spec:** §10 #58 (m9), §12.2 row 13; with 00 §10 #79 (AD-9). An open item, not a merge blocker.

**Preconditions:** the pilot mini PC, outside service hours. A **separate dev checkout** with dev dependencies, not `/opt/pos-hub` (the test imports `apps/hub/test/helpers`, as the 00 smoke run does). The test runs on a throwaway hub in a temp dir and never touches the live data dir.

```sh
git clone <repo> ~/pos-check && cd ~/pos-check && git switch module-01d
pnpm install
POS_PILOT_HW=1 pnpm vitest run apps/hub/test/alerts/timed-tick.int.test.ts
pnpm --filter @pos/hub smoke          # 00 §10 #79, the same session
```

**Expected:** the vitest run reports 1 test **passed**, not skipped, and prints `[01d #58] tick <t> ms (limit 50 ms); raise median <r> ms (limit 5 ms)` with t ≤ 50 and r ≤ 5. The smoke run prints `ok` on every line. Paste both outputs here, then remove `~/pos-check`.

**Result:**
**Done by / date:**

---

## Check 6 — APK endpoints by hand

**Spec:** 00 v1.6 §6.36–§6.38 (H-5), 01d §8.4; tests #40, #65. Installing on a real tablet is in the tablet plan (9b).

**Run on the dev box hub, not the pilot hub.** No CLI command removes a release. A dummy release left on the pilot hub would be offered to the 9b app later.

**Preconditions:** the dev box hub from `docs/manual-test-e2e.md` §4 (`http://<LAN_IP>:3000`, config in `$POS_HUB_CONFIG`). Three browser profiles on the laptop, paired at `http://<LAN_IP>:3000/pair` as **Tablet T1**, **Tablet T2** and a **Cashier screen K**.

1. **Device tokens and ids.** In each paired profile, open DevTools → Console on the hub's origin and run:

   ```js
   (() => { const r = indexedDB.open('pos-device', 1); r.onsuccess = () => { const s = r.result.transaction('device').objectStore('device'); for (const k of ['device_id', 'token', 'device_type']) s.get(k).onsuccess = (e) => console.log(k, e.target.result); }; })();
   ```

   In T3, set `T1_ID`, `T1_TOKEN`, `T2_TOKEN` and `K_TOKEN` from the output. The hub takes a device token as `Authorization: Bearer <token>` (`apps/hub/src/auth/guards.ts`).
2. **No release.**

   ```sh
   latest() { curl -sS -w ' [%{http_code}]\n' -H "Authorization: Bearer $1" "http://$LAN_IP:3000/app/android/latest"; }
   latest "$T1_TOKEN"
   ```

3. **Add, staged to T1.** Make a dummy APK, then add it (the flags are from `apps/hub/src/app-update/cli.ts`):

   ```sh
   head -c 65536 /dev/urandom > /tmp/dummy-1.apk
   cd ~/pos && pnpm --filter @pos/hub app-release add /tmp/dummy-1.apk --version-code 1 --version-name 0.0.1 --stage "$T1_ID"
   sha256sum /tmp/dummy-1.apk
   latest "$T1_TOKEN"; latest "$T2_TOKEN"
   ```

4. **Mark good.**

   ```sh
   pnpm --filter @pos/hub app-release mark-good 1
   latest "$T2_TOKEN"
   ```

5. **A second release, staged.**

   ```sh
   head -c 65536 /dev/urandom > /tmp/dummy-2.apk
   pnpm --filter @pos/hub app-release add /tmp/dummy-2.apk --version-code 2 --version-name 0.0.2 --stage "$T1_ID"
   latest "$T1_TOKEN"; latest "$T2_TOKEN"
   ```

6. **Download.**

   ```sh
   curl -sS -D - -o /tmp/got-2.apk -H "Authorization: Bearer $T1_TOKEN" "http://$LAN_IP:3000/app/android/2.apk" | grep -i '^content-type'
   sha256sum /tmp/got-2.apk /tmp/dummy-2.apk
   ```

7. **Not a tablet.** `latest "$K_TOKEN"`, and the same `.apk` URL with `$K_TOKEN`.
8. **No token.** `curl -sS -w ' [%{http_code}]\n' "http://$LAN_IP:3000/app/android/latest"`.

On the pilot mini PC, the same CLI runs as the hub's user: `cd /opt/pos-hub/apps/hub && sudo -u poshub env POS_HUB_CONFIG=/etc/pos-hub/config.json node --import tsx src/app-update/cli.ts add <apk> --version-code N --version-name X --stage <device_id>` (the unit's `ExecStart`, `apps/hub/deploy/hub.service`). Use it only with a real release.

**Expected:**
- Step 2: `404`, `ROUTE_NOT_FOUND`.
- Step 3: the CLI prints `app-release add 1 (0.0.1) staged to <T1_ID>; sha256 <hash>`, with the hash equal to `sha256sum`. T1 gets `200 { data: { version_code: 1, version_name: "0.0.1", sha256, staged_device_id: "<T1_ID>" } }`. T2 gets `404`.
- Step 4: `app-release mark-good 1: released to every tablet`; T2 now gets version 1 with `staged_device_id: null`.
- Step 5: T1 gets 2 (staged to it); T2 still gets 1.
- Step 6: `content-type: application/vnd.android.package-archive`; the two hashes are equal and match the `sha256` from `latest`.
- Step 7: `403`, `DEVICE_TYPE_NOT_ALLOWED` (#65).
- Step 8: `401` (`DEVICE_TOKEN_INVALID`).

**Result:**
**Done by / date:**

---

## Check 7 — Visual check on the real tablet, kiosk and phone, in EN and UR

**Spec:** §8.1; design hand-off 01d. Compare each screen with `docs/design/handoff/01d/design/screens/<Frame>.png`. Then switch to Urdu with `?lang=ur` on the URL (it is remembered; `?lang=en` switches back) and repeat.

**Preconditions:** check 3 running, so that there are test alerts in the inboxes; check 1a for `no_approver`. Accepted differences: `task-visual-report.md` (0.5).

| Device | Screens to compare now | Frames |
|---|---|---|
| TAB-A (landscape, then portrait) | sign-in, sign-in paused, inbox with test alerts, empty inbox, hub offline (unplug the hub's network for 10 s), Test alert (person, team), receipts, receipts with nobody reached | SignIn, SignInPaused, Inbox, InboxEmpty, InboxOffline, TestAlert, TestAlertPerson, TestAlertTeam, Receipts, ReceiptsNone, CardsUrdu, InboxUrdu |
| KIOSK (1920×1080) | lock view with lines, inbox signed in, `no_approver` warning | LockKiosk, InboxKiosk, NoApproverKiosk |
| PHONE-W | lock view, inbox, banner | LockPhone, InboxPhone, BannerPhone |
| KDS (if one is paired) | `no_approver` on the kitchen screen | NoApproverKds |

On each: nothing is cut off; there is no sideways scroll on the phone; Urdu is right-to-left, with Latin names in the same font as the frame; every touch target is easy to hit.

**BLOCKED (no request kind):** Answer*, Pin*, InPerson*, Notice*, Requests*, BannerUrgent, BannerStack, BannerResult, BannerPortrait, BannerUrdu, AnswerKiosk, and AdminStuck (see check 9).

**Result:**
**Done by / date:**

---

## Check 8 — Sounds on each device

**Spec:** §8.3 (at most five sounds: urgent, action, info, rising, falling); `apps/client/src/features/alerts/store.ts` (`URGENT_REPEAT_MS` 10 000, `REMINDER_MS` 120 000).

**Preconditions:** TAB-A, KIOSK and PHONE-W, volume up, each tapped once after loading (0.3).

| # | Sound | How | Expected | Now? |
|---|---|---|---|---|
| 8.1 | info chime | a `test_alert` to the person signed in on each device, or to **This device** (check 3) | one chime per alert, no repeat | runnable |
| 8.2 | info chime in alert mode | a `test_alert` to **W** with PHONE-W signed out (check 2a); `no_approver` on KIOSK signed out (check 1a) | one chime; lock line only | runnable |
| 8.3 | urgent, repeated | an urgent request, left unopened | the urgent sound at once, then every **10 s** until it is opened (seen) on any of the person's devices; after that a reminder every **2 min** until it closes; at the escalation step (2 min) it steps up once if still unseen | BLOCKED (no request kind) |
| 8.4 | action | an `action` alert | the action sound | BLOCKED (no action kind) |
| 8.5 | rising / falling | a `request_result` approved / rejected (AD-82) | rising on approved, falling on rejected | BLOCKED (no request kind) |
| 8.6 | silent receipt | **M1** approves a money request with the PIN | an `approval_receipt` in **M1**'s inbox, a badge, **no sound and no banner** on any device (#55 client part) | BLOCKED (no request kind) |

Write down per device: did each runnable sound play, at the right time, without a tap first?

**Result:**
**Done by / date:**

---

## Check 9 — "Stuck alerts: N" in /admin/stock (01a §6.21, AD-123)

**Preconditions:** LAPTOP signed in at `http://<hub>/admin/stock/`.

1. Open the **More** menu and read the status line.

**Expected:** with no stuck alerts, the status line has **no** "Stuck alerts" text.

**N > 0 cannot be produced by hand.** `stuck_alerts` counts open alerts whose `next_due_at` is NULL **before their last step** (`countStuckAlerts`, `apps/hub/src/projections/alerts.ts`). Every kind 01d ships has a single step, so none of them can ever count. The N > 0 display is covered by `[01d §3.5 AD-123]` in `apps/client/src/features/admin/stock/StockTable.test.tsx` and by `apps/hub/test/queries/config-status.int.test.ts`. Check it on hardware once a multi-step kind exists (02 / 04). Do not edit the hub database to fake one.

**Result:**
**Done by / date:**

---

## Check 10 — The tablet header is approximate (AD-T42-2)

**Spec:** §3.7, BF-5; AD-T42-1, AD-T42-2 (approximation: set at sign-in to hub-now + 2 h, moved by each accepted command from this page, replaced by any `binding_route` frame from the hub).

**Preconditions:** TAB-A and TAB-B; **L** can sign in on both.

1. Sign **L** in on TAB-A. Note the header time (H1 = sign-in + 2 h).
2. 10 min later, sign **L** in on TAB-B, then sign out there.
3. Read TAB-A's header.
4. On TAB-A, reload the page while **L** is signed out there.

**Expected and known gaps (write down what you see):**
- Step 3: TAB-A may still show H1, although the hub's real deadline moved with **L**'s activity on TAB-B. The page cannot see the hub's activity clock until a `binding_route` frame comes. That is the accepted approximation. The header must **never show a later time than the hub's real deadline**.
- Step 4: after a reload with no sign-in, the name is unknown: "Alerts: Someone — …" or "Alerts: none" (AD-T42-1).
- Known gap: when the hub has **L** as absent (`until` null), the page still shows a deadline until a `binding_route: null` frame arrives. Closing it needs an additive frame (a spec bump) or 9b.

**Result:**
**Done by / date:**

---

## Summary

| Check | Runnable now | Blocked part |
|---|---|---|
| 1 | 1a kiosk alert mode | 1b urgent request (no request kind) |
| 2 | 2a (with `test_alert`), 2b, 2c | the `action` sound; the 2 h rule on hardware (9b) |
| 3 | all | — |
| 4 | — | all (no request kind) |
| 5 | on the mini PC | — |
| 6 | all (dev box) | the install on a tablet (9b) |
| 7 | the screens listed | the request screens |
| 8 | 8.1, 8.2 | 8.3–8.6 |
| 9 | N = 0 | N > 0 (no multi-step kind) |
| 10 | all | — |
