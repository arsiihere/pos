# 05a manual checks (05a plan Z2; spec 05a v1.0 §12.1)

These are hand checks for 05a Device Access + Screens. The spec is `docs/specs/05a_Device_Access_Screens_Spec_v1.0.md`. The owner runs them **on the pilot devices**: the hub mini PC, a **tablet**, the Windows **kiosk PC** (Chrome or Edge kiosk mode), a **KDS screen**, an **Android phone** and an **iPhone**.

They check what the gate cannot: real browsers, real screens, iOS "Add to Home Screen", and how the screens read to staff. The logic behind each check is already covered by the §10 tests.

**How to fill it in:** tick `[x]` when a step behaves as written. When it does not, leave `[ ]` and write what you saw in **Notes**. A screenshot is the best note. Fill in the **Done by / date** line under each check.

**How to report it:** `tools/local/checks-report.sh <PR> docs/plans/05a-manual-checks.md` posts the filled-in list as a comment on PR `<PR>`. Use the `module-05a` → `main` PR.

---

## 0. Before you start

- [ ] The hub runs a `module-05a` build with every hub task merged (plan B1–B7) and the client batch B8.
- [ ] The cloud directory has at least: **Owner** (`access-hub-admin`, `manage-devices`), **Manager A** and **Manager B** (`approve-void`, `void-item` allowed), **Cashier** (`take-payment`, `void-item` requires approval by Manager), **Waiter**.
- [ ] For check 7 only: one device left from before the upgrade, or a hub restored from a pre-05a backup.
- [ ] Write the hub address and the build sha here: ____________________

---

## Check 1. Pair every device type (§6.1–§6.3, §8 pair page, test 1)

| Device | Steps | OK |
|---|---|---|
| Tablet | Open the pair page. A big code + QR and "Ask someone with hub access to approve this screen" show. The approve form opens with **no** hint (iPadOS / Android tablet), so the type is chosen on the form. Pick `tablet`, `everyone`, `dine_in` + `manager`, and approve. The tablet opens `/staff/` on `dine_in` | [ ] |
| Kiosk PC | Open the pair page in kiosk mode. On the form, the default is `everyone` with `takeaway` + `cashier` + `manager`. Approve. The kiosk opens on `takeaway` | [ ] |
| KDS screen | Open the pair page. Pick `kds` and a station on the form (no screens, no people). Approve. The screen opens `/kds/` | [ ] |
| Android phone | Open the pair page in Chrome. The form arrives with the `phone` hint: `listed`, one person to pick, `dine_in`. Pick Manager A and approve | [ ] |
| iPhone | Safari shows "Add to Home Screen" first. Add it, open from the home screen, and the request code shows. The form has the `phone` hint. Pick the Owner and approve | [ ] |

- [ ] On the approving device, the display code field is **empty** even after scanning the QR; you type the code yourself.
- [ ] While a request waits, the Owner's phone shows a "device waiting" notice with **no code** in it, and its link opens the device list (Waiting group).
- [ ] The old **Add a phone** and **Add a tablet** views are gone from the hub admin page.

Notes: ____________________ Done by / date: ____________________

## Check 2. Sign in (§3.5, §6.5, test 26)

- [ ] On the tablet (`everyone`), the Waiter and Manager A both sign in with their PINs.
- [ ] On Manager A's phone (`listed` [Manager A]), Manager A signs in.
- [ ] Two people on the same listed tablet: edit it to `listed` [Manager A, Waiter], then take over from one to the other with a PIN. The takeover works.

Notes: ____________________ Done by / date: ____________________

## Check 3. Refused PIN (§3.5, test 3)

- [ ] On Manager A's phone, enter the **Cashier's correct PIN**. It shows "This device is not set up for you".
- [ ] Back on the hub admin lockouts, nothing is counted for the Cashier (no failed attempt).
- [ ] The sign-in list on Manager A's phone shows only Manager A.
- [ ] On the kiosk (`everyone`), open the hub admin sign-in. It refuses with "Do this on your own phone", before any PIN is checked.

Notes: ____________________ Done by / date: ____________________

## Check 4. Live tab change (§6.4, §8 shell, C-1)

- [ ] While the Waiter is signed in on the tablet, the Owner (on their iPhone) edits the tablet: add `takeaway`, remove `manager`. The tablet's tabs change **without a reload or re-pair**.
- [ ] Edit again to remove the tab the Waiter is on. The tablet moves to the first remaining tab and shows a toast.
- [ ] Edit the tablet to `listed` [Manager A] while the Waiter is signed in. The Waiter is signed out at once.
- [ ] Turn the tablet to portrait and landscape. The layout changes (bottom tabs / top bar), but the tabs and actions stay the same.
- [ ] Two admins open the same device's edit form; both save. The second sees "Changed elsewhere" with Reload.

Notes: ____________________ Done by / date: ____________________

## Check 5. "Confirm on your phone" (§3.3a, §3.9, tests 17, 17a)

- [ ] Manager A signs in on the kiosk and voids a line. The kiosk shows **"Confirm on your phone"**, and nothing is voided yet.
- [ ] Manager A's phone (screen on, app open) rings. Manager A approves there with their PIN, and the void lands on the kiosk's order.
- [ ] On the kiosk, the request card shows "Approve on a listed device" with no Approve button.
- [ ] Turn Manager A's phone off (or close the app). Void again from the kiosk. This time the request goes to **Manager B**, who approves it on their own listed device.
- [ ] Do the same for a discount and a bill reopen: the same two paths.
- [ ] On the kiosk, the Cashier closes and counts another cashier's shift, opens the drawer, records petty cash, and prints the X / Z. All work as before (counter work is not masked).

Notes: ____________________ Done by / date: ____________________

## Check 6. Recovery link (§6.11, test 16a)

- [ ] Make a state with **0** listed admin devices: revoke the Owner's iPhone, and edit any other admin device so no listed device names an admin.
- [ ] The hub admin home (on the kiosk) shows "No device can manage devices" and **Recover admin access**.
- [ ] Press it. A QR link shows. Press again: "A recovery link was already made — it works until <time>", and the first QR still works.
- [ ] Open the link, sign in as the Owner with their PIN, and approve a new pairing request from the Owner's phone. The warning goes away once that phone is listed.
- [ ] With 1 admin device, the warning reads "Only one device can manage devices — add a backup".

Notes: ____________________ Done by / date: ____________________

## Check 7. A-7: `kiosk_home` → `takeaway` screen (§5.3, §12.3 A-7)

Run this on the kiosk PC that was paired **before** the 05a upgrade (or on a restored pre-05a hub).

- [ ] After the upgrade, the kiosk opens on the **`takeaway`** screen. Everything the old kiosk home showed is there (takeaway queue, New order, paying takeaway bills).
- [ ] The kiosk's tabs are `takeaway`, `parking`, `dine_in`, `cashier`, `manager`, and the device list shows it with a **needs review** chip.
- [ ] Hub admin, Test alert, printer setup and Kitchen screens setup are no longer offered on the kiosk; they work from the Owner's phone.
- [ ] Owner's verdict: is the `takeaway` screen a full replacement for the old kiosk home? Yes / No: ____________________ (No → a STOP row on the board.)

Notes: ____________________ Done by / date: ____________________
