# 05a acceptance map (plan Z1, DRAFT)

Plan: `05a-plan.md` (Z1, §4, Review Focus). Spec: `05a_Device_Access_Screens_Spec_v1.0.4.md` (§10, §4.5, §12.4). Board: `05a-status.md`. Hand checks: `05a-manual-checks.md` (Z2).

Read from `origin/build/05a` @ `d4b094b6` (board: all 36 build tasks merged; tasks 25 and 30 and the #15 refusal test are in). Test locations are `file:line` of the `it(` / `describe(` line, found by grepping the `[05a #N` citation in the titles under `apps/` and `packages/`. "Covered" means a test with that citation exists on the branch. **No test was run locally for this map.** CI: the `gate` workflow run `45147531268` on `build/05a` @ `f127d074` (the #15 refusal merge) is **completed / success**. Later pushes (`c72a8b8a`, `123eccb7`) show `cancelled` (superseded runs); **no gate run for `59459ab2` (task 25 merge) or `d4b094b6` was seen when this was written**, so a green gate at the tip is not yet confirmed. Titles below were re-grepped in full at `d4b094b6`. Paths below are relative to `apps/hub/test/` unless they start with `client/`.

## MISSING / PENDING (read this first)

**MISSING: none. PENDING: none.** All 43 §10 cases have at least one test citing them on `build/05a` @ `d4b094b6`. Counts: **43 covered, 0 pending, 0 missing.** Three items are not code tests and stay with the owner or the plan:

| Item | State |
|---|---|
| #15 hand half and "every action visible before the upgrade is visible after" | Z2 (plan §4: "28 (hub), Z2 (hand)"); the hub test `:220` asserts "every other action stays, money ones as Confirm on your phone" per its title |
| #21 client copy for `device_waiting` | Proposed wording, owner to confirm (section 5) |
| Gate at the tip | Green run seen only at `f127d074` (see above); re-check after the last push |

## 1. §10 tests → test titles

| # | Status | Test title (shortened) and `file:line` |
|---|---|---|
| 1 | covered | `[05a #1] phone, tablet, kiosk and kds pair through /pair/requests + approve …; the token routes answer 404 ROUTE_NOT_FOUND` — `commands/approve-pairing-request-v2.int.test.ts:114`. Also `[05a #1] [05a H-1] an old token link /pair?t=tok&d=tablet …` — `auth/pairing.int.test.ts:225` |
| 2 | covered | `[05a #2] a wrong display code → 404 PAIRING_REQUEST_NOT_FOUND …; a request id from the QR with no code → 400` — `commands/approve-pairing-request-v2.int.test.ts:205` |
| 3 | covered | **PIN half:** `[05a #3] Bilal's correct PIN on Ali's listed phone → 403 DEVICE_ACCESS_DENIED; argon2 not called; no counter changed` — `auth/sign-in-check.int.test.ts:34`. **Roster half:** `[05a #3] roster: a listed device shows only its people, an everyone device the whole directory; 2 statements` — `queries/access-queries.int.test.ts:242`. Also `[05a #3] login-roster: everyone or no profile → 403 listed_device_only; listed → its allowed admins only` — `auth/admin-session.int.test.ts:40` |
| 4 | covered | Four titles `[05a #4] everyone device: …` / `listed device and bootstrap session …` / `another staff id is never masked …` — `auth/session-directory.int.test.ts:77, 81, 91, 96` |
| 4a | covered | `[05a #4a] pipeline: a listed-only command (SetPresence, manage-staff) from an everyone device → 403 … listed_device_only` — `auth/session-directory-call-sites.int.test.ts:66`; `[05a #4a] ApprovePairingRequest on /commands … from an everyone device → 403 listed_device_only` — `commands/approve-pairing-request-v2.int.test.ts:280` |
| 4b | covered | **fiscal:** `[05a #4b] fiscal credentials from an admin session on an everyone device → 403, no reason …` — `auth/session-directory-call-sites.int.test.ts:80` (title notes the admin guard answers first since task 11). **printer:** `[05a #4b] printer route on an everyone device → 403 with no reason …` — `auth/admin-guard-mask.int.test.ts:66`. **in-handler checks:** `[05a #4b] the in-handler checks read the view too …` — `auth/admin-guard-mask.int.test.ts:75` |
| 4c | covered | `[05a #4c] query: the audit query on an everyone device → 403 …; listed device → 200` — `auth/session-directory-call-sites.int.test.ts:93` |
| 4d | covered | **403 half:** `[05a #4d] an admin session bound to a device switched to everyone: the next /admin/queries/devices → 403` — `auth/admin-guard-mask.int.test.ts:42`; no-profile / bootstrap — `:54`. **ended half:** `[05a #11] [05a #4d] switching another device to everyone ends its admin sessions forced …` — `commands/set-device-profile.int.test.ts:271` |
| 4e | covered | `[05a #4e] /admin/auth on an everyone device → 403 listed_device_only, no PIN verified, no counter` — `auth/sign-in-check.int.test.ts:61` |
| 4f | covered | `[05a #4f] a void answer on an everyone device → 403 listed_device_only from preRead … argon2 not called; counters unchanged` — `alerts/answer-device-access.int.test.ts:106` |
| 4g | covered | `[05a #4g] everyone device: …` and `[05a #4g] listed device: nothing masked …` — `queries/session-device.int.test.ts:27, 59` |
| 5 | covered | `[05a #5] the same manager on their listed phone answers the void` — `alerts/answer-device-access.int.test.ts:123` |
| 6 | covered | `[05a #6, §3.4] floor tablet listed [floor manager, waiter]: the floor manager answers a void there` — `alerts/answer-device-access.int.test.ts:137` |
| 7 | covered | `[05a #7] a cashier on an everyone counter raises a void: it rings the manager's listed phone, not his everyone tablet session; requests-to-answer there omits it` — `alerts/listed-routing.int.test.ts:115`. Also `[05a #7] the drop is for money kinds only: a non-money alert to the manager still reaches his everyone tablet` — `:144`; replay side `[05a M-5, 01d §3.7 Reconnect] alerts_open on an everyone tablet …` — `:271`, `:286`, `:247`, `:260` |
| 7a | covered | `[05a #7a, 01d §3.5 G1-9d] the only approver reachable only on everyone devices (screen and alert connection) → no route: the raise takes the shortcut to the escalation step` — `alerts/listed-routing.int.test.ts:165`; control `:183`. Q-1 `no_approver`: `[05a §3.9 rule 3, 01d #32 note, Q-1 (a)] money permission: approvers signed in only on everyone devices …` — `alerts/no-approver.int.test.ts:265`; `[05a Q-1 (a)] …` — `:286` |
| 7b | covered | `[05a #7b, §3.9 rule 3] a cashier's ReopenBill (requires_approval) on an everyone counter raises the request: an approval request, stored as such (no downgrade), pending` — `billing/reopen-bill.int.test.ts:631` |
| 7c | covered | `[05a #7c] the Manager takes over the Cashier's everyone kiosk: opens the drawer, records petty cash, removes the Cashier's payment, counts and closes the Cashier's shift, closes the day, prints the Z report — all succeed` — `device-access/counter.int.test.ts:149` (`describe` `:125`; permission-list check `:126`). Earlier partial `billing/shift-close.int.test.ts:751` is #28 |
| 8 | covered | `[01d #44; 05a #8] … in person … → 403 in_person_removed, not counted` — `alerts/answer-pin.int.test.ts:269`; `[05a #8; 01d v1.3.5 §3.3 rule 2] in person, on the raising device or another … 403 in_person_removed from preRead, no PIN verified` — `:295`; `[05a #8] in_person → 403 in_person_removed from preRead, before argon2 …` — `alerts/answer-device-access.int.test.ts:91` |
| 9 | covered | `[05a #9] removing the signed-in person ends their staff and admin sessions forced …, closes their socket 4401 and pushes device_profile; the next /admin/…` — `commands/set-device-profile.int.test.ts:180` |
| 10 | covered | `[05a #10] two admins edit one device from version 1: the second gets 409 CONFIG_STALE { device_id, profile_version }` — `commands/set-device-profile.int.test.ts:239` |
| 11 | covered | `[05a #11] an admin removing themself … → 422 DEVICE_ACCESS_SELF; switching it to everyone → 422; on /commands too` — `commands/set-device-profile.int.test.ts:253`; `[05a #11] [05a #4d] switching another device to everyone ends its admin sessions …` — `:271` |
| 12 | covered | `auth/directory-apply-profiles.int.test.ts`: `:100` list left non-empty; `:126` two-person phone keeping one; `:135` N-1 sessions end; `:151` one-person phone emptied → revoked `owner_removed`; `:165` N-9 two-person phone, both leave; `:173` tablet emptied → `everyone` + `needs_review`; `:187` no event for `everyone` / unaffected / revoked; `:215` N-4 `CONFIG_STALE` after an apply; `:241` listed Pass tablet emptied; `:253` / `:254` one-person kiosk with an open drawer shift. (N-4 `profile_version + 1` is asserted in `:100`'s title) |
| 13 | covered | **approve half:** `[05a #13 approve half] [05a §6.3 step 3] pass without point_id → 400 …; cashier on a phone → 400 …` — `commands/approve-pairing-request-v2.int.test.ts:220`. **edit half:** `[05a #13] pass without point_id → 400 point_id; cashier on a phone → 400 screens; an archived or unknown point → 404 POINT_NOT_FOUND` — `commands/set-device-profile.int.test.ts:303`. Fixture titles `[05a #13 fixture]` at `helpers/pair-by-request.int.test.ts:14, 32` are not the test |
| 14 | covered | `[05a #14] replay rebuilds device_profiles / device_people exactly, including needs_review` — `projections/device-profiles.int.test.ts:122` |
| 14a | covered | `[05a #14a §3.8] a one-person listed tablet binds permanently; 1 → 2 …; 2 → everyone on a phone …` — `alerts/bindings.int.test.ts:415`; `[05a #14a §3.8 D-1] a one-person listed kiosk binds its person permanently and routes …` — `alerts/alert-mode-delivery.int.test.ts:372`; `[05a #14a §3.8 D-1] a permanent row (session_id NULL) routes on any hardware …` — `src/alerts/routes.test.ts:233` (under `apps/hub/`, not `test/`) |
| 14b | covered | **replay half:** `[05a #14b §3.8] replay of an old phone: bound to DevicePaired.owner_staff_id until its first DeviceProfileSet, then by the profile` — `alerts/bindings.int.test.ts:465`. **upgrade half:** `[05a #14b] upgrade half: an old phone … gets listed [that owner] …` — `auth/device-upgrade.int.test.ts:193` |
| 15 | covered (hand half Z2) | **hub half (table):** `[05a #15] [05a RF-1] boot upgrades every unrevoked non-kds device with no profile per the §5.3 table, pass first with a point; actor_id null, device_id hub; a second boot appends nothing` — `auth/device-upgrade.int.test.ts:92`. **Refusal half:** `[05a #15] [05a §5.3 N-2] on an upgraded kiosk and tablet Test alert, printer setup and Kitchen screens setup are refused; they work from the upgraded (listed) phone; every other action stays, money ones as "Confirm on your phone"` — `auth/device-upgrade.int.test.ts:220` (merge `f127d074`). The `it.todo` is gone. **Hand half:** Z2 |
| 16 | covered | **`admin_warning`:** `[05a #16] admin_warning is 0 with no listed admin device, 1 with one, null with two` — `queries/devices-access.int.test.ts:38`. **`recovery_available`:** `[05a #16] login-roster recovery_available: true with no listed admin device, false with one` — `auth/admin-session.int.test.ts:74` |
| 16a | covered | `[05a #16a] at 0 a bootstrap token is issued (issued_by recovery, device_id = caller); the link signs in with a PIN; a second press … already_issued_until …; at ≥ 1 → 403 recovery_not_needed` — `auth/recovery-link.int.test.ts:17`; `[05a #16a] approve half: the owner approves their phone from the recovery session …` — `:57`; `[05a #16a] any live bootstrap token … already_issued_until …` — `:98` |
| 17 | covered | `describe('[05a #17] downgrade with a listed device connected now → named to the requester')` — `alerts/downgraded-raise.int.test.ts:90` (tests `:91, :120, :127`) |
| 17a | covered | `[05a #17a] the manager's only listed device (a phone) is not connected → holders of approve-void; another manager answers …; the requester cannot (self)` — `alerts/downgraded-raise.int.test.ts:141` |
| 18 | covered | `[05a #18] no listed device at all → holders of approve-void; another manager answers …; the requester cannot (self)` — `alerts/downgraded-raise.int.test.ts:155` |
| 19 | covered | `describe('[05a #19] downgraded discount, comp and reopen follow tests 17–18')` — `alerts/downgraded-raise.int.test.ts:199`; per kind `:249` (named) and `:259` (holders of the kind's permission) |
| 20 | covered | `[05a #20] a command queued on a listed device and replayed after the device became everyone is masked (fail-closed)` — `auth/session-directory-call-sites.int.test.ts:103` |
| 21 | covered | **hub half** `describe('[05a #21] device_waiting (hub half)')` — `auth/device-waiting.int.test.ts:84`: kind and link `{ type: devices }` `:85`; one notice for two requests `:96`; closed `done` when the last is approved `:113`; closed `obsolete` by the sweeper `:131`; never the code `:190` (statement counts `:153, :168`). **Delivery half:** `[05a #21 delivery, §3.10] device_waiting reaches a manage-devices holder on a listed phone only, never his everyone tablet session` — `alerts/listed-routing.int.test.ts:199`; replay `:271`. **Link half (client):** `[05a §3.10] a tap on a row whose target is { type: "devices" } opens #/devices, no sheet and no read` — `client/src/features/devices/DeviceList.test.tsx:127` (`describe` `:126`) |
| 22 | covered | `[05a #22] a phone with pass + point_id receives ready_to_serve, is in always_on, and is listed in kds-config.pass_tablets` — `kds/pass-device.int.test.ts:54` |
| 23 | covered | `[05a #23] a deep link to #/tables/… on a device without dine_in falls back to #/inbox?focus=alert:<id> with the toast …` — `client/src/features/alerts/deeplink-tap.test.tsx:161` |
| 24 | covered | `[05a #24] on /commands from a listed staff session with manage-devices and no access-hub-admin → 200; the bootstrap admin session approves on /admin/commands` — `commands/approve-pairing-request-v2.int.test.ts:259` |
| 25 | covered | `[05a #25] hardware_hint outside the four values → 400 and nothing stored` — `auth/pair-requests.int.test.ts:52`; plus `[05a #25] hardware_hint is stored in the column …` — `:38` |
| 26 | covered | `[05a #26] takeover between two listed people works; an unlisted person gets 403 DEVICE_ACCESS_DENIED before any takeover` — `auth/sign-in-check.int.test.ts:90`; `… on an everyone device works for any directory staff` — `:115` |
| 27 | covered | `[05a #27] the DeviceProfileSet writes a device_profile_set audit row with the editor as actor` — `commands/set-device-profile.int.test.ts:390` |
| 28 | covered | `[05a #28, §3.3 N-8, §3.9 rule 2] on an everyone kiosk a Manager counts and closes another cashier's shift with a variance; the sign-off is raised and is answered from a listed device …` — `billing/shift-close.int.test.ts:751` |
| 29 | covered | `[05a #29] devices.point_id = the last DeviceProfileSet whatever the replay order; DeviceRoleSet writes the lane only` — `kds/pass-device.int.test.ts:114` |

## 2. §4.5 rows → landed spec version, code task, merge commit

"Spec" is the target spec version that carries the row (board "Version numbers" and P0.4–P0.8). Merge commits are the first-parent merges into `build/05a`; tasks 1–9 landed as direct commits (shown as the task commit). Where the board gives only a task commit, no merge sha is invented.

| Row | Landed spec version | Code task(s) | Merge / commit |
|---|---|---|---|
| H-1 pairing by request, token routes + STAB-1 views removed | 00 v1.12.3 (`0ddb82cb`) | 13 fixture, 14 request hint + poll, 15 approve v2 + removal (one commit), 16 pair page text, 33 hub admin pages | 13 `68dfc3aa`; 14 `fbab4c53`; 15 `76580857`; 16 `d867f342`; 33 `c0e3ad84` |
| H-2 sign-in checks, `DEVICE_ACCESS_DENIED`, login-roster | 00 v1.12.3; 05a v1.0.3 adds `recovery_available` to the 403 (00 v1.12.3 §6.13 note) | 2 errors, 17 sign-in checks, 18 roster / login roster, 33 (Recover admin access) | 2 `63bbc278`; 17 `02c2a0fc`; 18 `7b4ccffe`; 33 `c0e3ad84` |
| H-3 mask in `resolve()` session view | 00 v1.12.3 | 9 `forSession`, 10 call sites, 11 admin guard + print route, 12 `/queries/session` | 9 `42c4b122`; 10–12 `9be4d7fc` |
| H-4 `owner_staff_id` readers → profile, `device_count`, `pairing_source` dropped, roster | 00 v1.12.3 | 18 roster, 20 revoke + device list, 21 directory apply | 18 `7b4ccffe`; 20 `3791d28b`; 21 `e4eabf3c` |
| H-5 migration `0027` | 00 v1.12.3 | 5 migration, 6 projections, 7 memory map | 5 `d4b2e47c`; 6 `8259743d`; 7 `7f1190f8` (direct commits) |
| H-6 `sessionKind: 'both'` queries | 00 v1.12.3 | 20 (`devices` on both routes) | `3791d28b` |
| H-7 `AdminBootstrapTokenIssued` v2, `issueAdminBootstrap(…, deviceId)` | 00 v1.12.3 | 4 event v2, 29 recovery link | 4 `1d23c70c`; 29 `1b5b5c61` |
| D-1 bindings from the latest profile | 01d v1.3.5 (`df8532ee`) | 22 | `bbf0b08a` |
| D-2 `in_person` removed, downgraded money, answers | 01d v1.3.5 (incl. Q-1 – Q-3, `97e3847d`, `6207dae1`) | 23 answers, 24 downgraded raise, 25 routing (money and `device_waiting` only to listed devices, Q-1 `no_approver`; commits `a72eb6ac`, `c30f1604`, `ba0286c7`) | 23 `58cab77c`; 24 `89193dd9`; 25 `59459ab2` |
| D-3 `device_waiting`, link `{ type: 'devices' }` | 01d v1.3.5 | 26 kind; 31 client link; 25 (delivery to listed devices only) | 26 `9e1924ff`; 31 `0f06ad63`; 25 `59459ab2` |
| D-4 `always_on` = non-kds with `point_id` | 01d v1.3.5 | 27 | `05e3baf9` |
| K-1 Pass readers; `DeviceRoleSet` writes `lane_label` only | 03b v1.0.15 (`f45df89a`) | 27 (readers + writer), 28 (upgrade carries `point_id`); client `PassScreen` parse in 35 | 27–28 `05e3baf9`; 35 `df49a7b6` |
| K-2 "Use as Pass tablet" → edit-form link | 03b v1.0.15 | 33 (`BindDialog`, `admin/page.ts`) | `c0e3ad84` |
| A-1 audit action `device_profile_set` | 04 v1.0.8 (`f1cc15bc`) | 3 action, 36 client audit names (G-b) | 3 `652d2e01` (direct); 36 `df49a7b6` |
| B-1 05 counter: downgraded path via `ctx.permission`, "Confirm on your phone" | no bump (PL-2) | no single task; mask in 9–10, client buttons in 34; 30 counter check (`d4560510`; `device-access/counter.int.test.ts`, #7c); tests `[05a #28]`, `[05a #7b]` | 34 `453003fc`; 30 `16f988f4` |
| F-1 Foundation §6.2 append `DEVICE_ACCESS_DENIED` (403), `DEVICE_ACCESS_SELF` (422) | F v1.15 append, no bump (`855e87eb`) | 2 | `63bbc278` (direct) |
| C-1 client shell tabs from `screens` | no bump | 34 shell tabs (+ 35 deep-link fallback, 12 for the data) | 34 `453003fc`; 35 `df49a7b6` |

## 3. Review Focus RF-1 – RF-5 → tests

| RF | Test title and `file:line` |
|---|---|
| RF-1 no-profile staff device | **Mask half (task 9):** `describe('[05a RF-1] a staff device with no profile masks like everyone (v1.0.1 R-1)')` — `auth/session-directory.int.test.ts:125`; test `:138`. **Sign-in half (task 17):** `describe('[05a RF-1] a staff device with no profile keeps today's sign-in rule …')` — `auth/sign-in-check.int.test.ts:124`; tests `:125` (phone accepts Ali, refuses Bilal), `:141` (null owner refuses every PIN), `:155` (tablet and kiosk accept any directory staff), `:169` (`/admin/auth` → `403 listed_device_only`). **Invariant (task 15):** `[05a RF-1] every non-kds device approved has a profile; none is left without one` — `commands/approve-pairing-request-v2.int.test.ts:185`. **Task 28:** `[05a #15] [05a RF-1] boot upgrades every unrevoked non-kds device …` — `auth/device-upgrade.int.test.ts:92`. Known exception, by design: an ownerless phone (raw SQL) stays unprofiled, `device-upgrade.int.test.ts:206` |
| RF-2 revoked device | `[05a RF-2] after DeviceRevoked, deviceProfile(id) is undefined and the M-8 count drops the device` — `auth/device-profile.int.test.ts:95` |
| RF-3 double approve | `[05a RF-3] a double approve of one request: the same command_id → D32 replay; a second command (the other route) → 404; exactly one devices row and one DeviceProfileSet` — `commands/approve-pairing-request-v2.int.test.ts:295` |
| RF-4 drawer after removing `cashier` | `[05a RF-4] removing cashier from a kiosk with an open drawer shift: the shift stays open and the bill is payable from another cashier device` — `commands/set-device-profile.int.test.ts:404` (`describe` `:403`) |
| RF-5 offline during an edit | **Hub (task 12):** `[05a RF-5] a device offline during an edit: on reconnect GET /queries/session returns the current screens, access and masks …` — `queries/session-device.int.test.ts:69`. **Client (task 34):** `[05a RF-5] after a reconnect a fresh /queries/session redraws the tabs without the missed push` — `client/src/features/staff/StaffApp.screens.test.tsx:183` |

## 4. §12.4 deferred: not built

Sign-in alert with "Not me"; shuffled PIN pad on shared devices; PIN only while on shift (05 shifts + 01d presence); staff NFC card + PIN; "add me to this device" request; Delivery screen (with 02b delivery); customer pickup board; screens enforced on the hub (screens are a view boundary only, M-4); 6-digit PINs for some roles; the Capacitor app (9b).

## 5. Rulings and as-built notes a hand-checker should know

Owner rulings (board "Owner rulings" and status lines):

| Ruling | What to expect |
|---|---|
| R-1 (03:35 PKT, spec v1.0.1) | A staff device with no profile: permissions masked as `everyone`; sign-in by today's rule (a phone accepts only its owner, a tablet / kiosk any directory staff) |
| G-b (03:53, v1.0.1) | `device_profile_set` audit detail stores `staff_ids`; names are looked up when the log is read |
| D-7 | The 05a PR follows the stab PR; integration branch is `build/05a` |
| G-e (a), G-f (a) (v1.0.2) | Edit clears `point_id` when `pass` is dropped and `staff_ids` when switched to `everyone`; the forms pick people from the whole directory (`devices` returns `staff`) |
| G-g (a) (v1.0.3) | Login-roster's 403 carries `recovery_available`; the hub admin sign-in page shows **Recover admin access** on any paired non-kds device when true |
| G-h (a) (v1.0.4) | "Connected now" is route-level: a shared listed tablet with someone else signed in does not count for the requester; the request goes to `holders` |
| Q-1 (a), Q-2 (a), Q-3 (a) (01d v1.3.5) | A money kind on an `everyone` session does not count in the `no_approver` warning; `{ type: 'devices' }` link is always open; the G1-9d shortcut keys on the stored right, so a downgraded `named` / `holders` request gets no shortcut |
| PL-1 – PL-4 | Client screens use existing page patterns (no design handoff, no Pulse mapping yet); B-1 / C-1 are not version bumps |

Plan corrections (PC-*):

| PC | Note |
|---|---|
| PC-1 (task 2) | Denied reasons are plain strings in `details.reason`; no `PermissionDeniedReason` type |
| PC-2 (task 7) | Until task 27, `DeviceRoleSet` still wrote `devices.point_id`; task 27 removed that writer |
| PC-3 (task 28) | Upgrade runs inline in `boot()` as step 4c; an ownerless phone (raw SQL only) stays unprofiled and is warned each boot; the #15 refusal half landed later (lane K2, `f127d074`) |
| PC-4 (tasks 27, 33) | Between 27 and 33 `SetDeviceRole` dropped a sent `point_id` (old "Use as Pass tablet" did nothing); task 33 replaced it with the edit-form link, so it is not a check after 33 |
| PC-6 (task 25, owner note, not built) | The 01d §3.9 `no_approver` flag is set dirty only by session, directory and business-day events, not by `DeviceProfileSet`. With Q-1 (a), a manager whose only device flips listed ↔ `everyone` keeps a stale warning until the next such event. Fix would be one line (`DeviceProfileSet` in the `alert_flags` projection's event list) plus a 01d §3.9 text addition: **owner to decide** |
| PC-5 (task 19) | Session ends happen inside the command's transaction; the `device_profile` push reaches a removed session's socket just before its 4401 close; a no-profile staff device is edited from `expected_version: 0`; a kept archived point blocks any edit until `pass` is dropped or the point changed |

Other as-built notes that change what is seen:

| Task | Note |
|---|---|
| 14 | A no-profile poll returns `screens: []` (inference from §3.6) |
| 15 | `/admin/approve` gained Tablet / My phone until task 33; task 33 later removed the unauthenticated `?r=` hint read |
| 16 | iOS Safari outside the Home Screen shows "Add to Home Screen" and makes no request; the request is made from the home-screen app |
| 17 | #114: an unknown id on the list → 404; an unknown id off a listed device's list → `403 DEVICE_ACCESS_DENIED` first (§3.5 order); note for the next 00 bump |
| 18 | A no-profile phone's roster is its owner |
| 20 | A no-profile staff device lists as `everyone` v0 so it can be edited |
| 21 | A `directory` event clears an earlier `needs_review` (literal §4.2 / §6.9); no `device_profile` push for `directory` events |
| 23 | Named-self skip is reachable only through task 24's raise |
| 24 | A downgraded raise of a non-money kind throws (one carry-over test still to add) |
| 25 / 26 | Task 25 landed: money requests and `device_waiting` reach listed devices only (alert and replay, `listed-routing.int.test.ts`); the §3.9 `no_approver` warning ignores money approvers who are signed in only on `everyone` devices (Q-1). `device_waiting` carries label only: no code, name or count |
| 30 | Counter check found no production bug; follow-ups: comp / reopen cashier requests, N-8 cross-ref |
| 29 | Recovery-link carry-overs: #16a "owner approves their phone" was an `it.todo`, now present (`recovery-link.int.test.ts:57`); MINORs m1 (empty `advertised_host`), m2 (count-0 at the route), m3 (unprovisioned refusal) went to tasks 15 / 18, not checked here |
| 33 | `/admin/recovery-link` also returns `first_admin_qr_svg` (additive) |
| 34 | Downgraded money actions (void / cancel, comp, discount, reopen) keep their button with "Confirm on your phone"; `listed_only` ones are hidden |
| 35 | "Confirm on your phone" is not on the answer sheet (it belongs to task 34's buttons). Screen labels: Dine in, Takeaway, Parking, Cash desk, Pass, Manager tools (the spec names none) |

### Open owner notes (board, task 34, task 26)

| Note | State |
|---|---|
| The client has **no live-view screen** yet | `manager` holds reports, day close, audit, test alert, devices; §3.6 also lists "live view". Owner to decide |
| `parking` opens `#/orders` | As built; owner note |
| No client button gates on `apply-refund` | Refunds are bill payments out; owner note |
| `device_waiting` client copy proposed: "A device is waiting for approval" / "Device waiting" (`alert.device_waiting.card` / `.lock`, EN + UR) | Spec gives no wording; the board has no later task for it; still the proposed text unless the owner says otherwise |
| Task 25 nit (board) | Catch-up on an `everyone` device still shows a `device_waiting` inbox row as a card (01d §3.4.3 lets inbox rows show at next sign-in). A hand-checker on a kiosk or tablet may see that card |
| PC-6 | `no_approver` is not re-dirtied by `DeviceProfileSet`: owner to decide on the one-line fix |
| Task 26 carry-overs, folded into task 25 | MINOR-1, MINOR-2 (`deeplink-check` `devices` → open), MINOR-3; the board marks task 25 done with them |
| Plan A-7 assumption | `kiosk_home` retired, content is `takeaway`; confirm on the kiosk at the manual check |

## 6. Gaps

- Coverage means a test citing the number exists with a matching title; whether each title's assertions match the spec sentence line by line was not re-read for every row.
- Gate: see the header; a green run at the final tip is not confirmed.
