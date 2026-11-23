# 05a acceptance map (plan Z1, DRAFT)

Plan: `05a-plan.md` (Z1, §4, Review Focus). Spec: `05a_Device_Access_Screens_Spec_v1.0.4.md` (§10, §4.5, §12.4). Board: `05a-status.md`. Hand checks: `05a-manual-checks.md` (Z2).

Read from `origin/build/05a` @ `e48f2d8f` (board: task 24 merged; **tasks 25 and 30 not yet built**). Test locations are `file:line` of the `it(` / `describe(` line, found by grepping the `[05a #N` citation in the titles under `apps/` and `packages/`. "Covered" means a test with that citation exists on the branch. **Nothing was run for this draft; a green run per name is not claimed here.** Re-run the grep and the gate once tasks 25 and 30 land, before the final map. Paths below are relative to `apps/hub/test/` unless they start with `client/`.

## MISSING / PENDING (read this first)

| Item | State | Detail |
|---|---|---|
| #7, #7a, #7b | **PENDING task 25** | No test cites them. Nearest, not the #7 case: `alerts/downgraded-raise.int.test.ts:167` (a connected listed device that does not list the requester does not count), `alerts/answer-device-access.int.test.ts:207` (accept kinds unchanged on `everyone`) |
| #7c | **PENDING task 30** | No test cites it. Partial: `billing/shift-close.int.test.ts:751` (`[05a #28 …]`: a Manager counts and closes another cashier's shift on an `everyone` kiosk). Nothing found for removing another cashier's payment, drawer open, petty cash, Z report, close day |
| #21 delivery half ("delivered only to listed devices") | **PENDING task 25** | Board: until task 25, `device_waiting` also reaches `everyone` devices (label only). The other parts of #21 are covered (see table) |
| #15 refusal half (Test alert, printer, Kitchen screens setup refused on an upgraded kiosk / tablet, work from a listed device) | **MISSING** | Only `it.todo` at `auth/device-upgrade.int.test.ts:218` ("`[05a #15 mask half]` lands with task 9–11"). Tasks 10–11 are merged; no test replaced the todo. Nearest: `auth/admin-guard-mask.int.test.ts:66` (printer route on an `everyone` device → 403, not on an upgraded device). Board PC-3 says this half goes in Z1 under #15 |
| #15 "every action visible before the upgrade is visible after" and the hand half | Z2 (plan §4: "28 (hub), Z2 (hand)") | The hub test title covers the §5.3 table, `pass` first, actor / device, second boot; it does not name the visible-actions sentence. Not checked line by line |
| §4.5 rows D-2, D-3 (routing / drop) | Partly **PENDING task 25** | Board row 25 is empty; the `device_waiting` drop and the §3.9 rule 3 routing are task 25 |

Counts of the 43 §10 cases (1–29 plus 4a–4g, 7a–7c, 14a, 14b, 16a, 17a): **37 covered, 5 pending (#7, #7a, #7b, #7c, #21 delivery half; #21 is otherwise covered), 1 missing half (#15 refusal)**. A "covered" case with halves lists each half.

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
| 7 | **PENDING task 25** | none (see top) |
| 7a | **PENDING task 25** | none |
| 7b | **PENDING task 25** | none |
| 7c | **PENDING task 30** | none; partial `billing/shift-close.int.test.ts:751` |
| 8 | covered | `[01d #44; 05a #8] … in person … → 403 in_person_removed, not counted` — `alerts/answer-pin.int.test.ts:269`; `[05a #8; 01d v1.3.5 §3.3 rule 2] in person, on the raising device or another … 403 in_person_removed from preRead, no PIN verified` — `:295`; `[05a #8] in_person → 403 in_person_removed from preRead, before argon2 …` — `alerts/answer-device-access.int.test.ts:91` |
| 9 | covered | `[05a #9] removing the signed-in person ends their staff and admin sessions forced …, closes their socket 4401 and pushes device_profile; the next /admin/…` — `commands/set-device-profile.int.test.ts:180` |
| 10 | covered | `[05a #10] two admins edit one device from version 1: the second gets 409 CONFIG_STALE { device_id, profile_version }` — `commands/set-device-profile.int.test.ts:239` |
| 11 | covered | `[05a #11] an admin removing themself … → 422 DEVICE_ACCESS_SELF; switching it to everyone → 422; on /commands too` — `commands/set-device-profile.int.test.ts:253`; `[05a #11] [05a #4d] switching another device to everyone ends its admin sessions …` — `:271` |
| 12 | covered | `auth/directory-apply-profiles.int.test.ts`: `:100` list left non-empty; `:126` two-person phone keeping one; `:135` N-1 sessions end; `:151` one-person phone emptied → revoked `owner_removed`; `:165` N-9 two-person phone, both leave; `:173` tablet emptied → `everyone` + `needs_review`; `:187` no event for `everyone` / unaffected / revoked; `:215` N-4 `CONFIG_STALE` after an apply; `:241` listed Pass tablet emptied; `:253` / `:254` one-person kiosk with an open drawer shift. (N-4 `profile_version + 1` is asserted in `:100`'s title) |
| 13 | covered | **approve half:** `[05a #13 approve half] [05a §6.3 step 3] pass without point_id → 400 …; cashier on a phone → 400 …` — `commands/approve-pairing-request-v2.int.test.ts:220`. **edit half:** `[05a #13] pass without point_id → 400 point_id; cashier on a phone → 400 screens; an archived or unknown point → 404 POINT_NOT_FOUND` — `commands/set-device-profile.int.test.ts:303`. Fixture titles `[05a #13 fixture]` at `helpers/pair-by-request.int.test.ts:14, 32` are not the test |
| 14 | covered | `[05a #14] replay rebuilds device_profiles / device_people exactly, including needs_review` — `projections/device-profiles.int.test.ts:122` |
| 14a | covered | `[05a #14a §3.8] a one-person listed tablet binds permanently; 1 → 2 …; 2 → everyone on a phone …` — `alerts/bindings.int.test.ts:415`; `[05a #14a §3.8 D-1] a one-person listed kiosk binds its person permanently and routes …` — `alerts/alert-mode-delivery.int.test.ts:372`; `[05a #14a §3.8 D-1] a permanent row (session_id NULL) routes on any hardware …` — `src/alerts/routes.test.ts:233` (under `apps/hub/`, not `test/`) |
| 14b | covered | **replay half:** `[05a #14b §3.8] replay of an old phone: bound to DevicePaired.owner_staff_id until its first DeviceProfileSet, then by the profile` — `alerts/bindings.int.test.ts:465`. **upgrade half:** `[05a #14b] upgrade half: an old phone … gets listed [that owner] …` — `auth/device-upgrade.int.test.ts:190` |
| 15 | **partial: refusal half MISSING** | **hub half (table):** `[05a #15] [05a RF-1] boot upgrades every unrevoked non-kds device with no profile per the §5.3 table, pass first with a point; actor_id null, device_id hub; a second boot appends …` — `auth/device-upgrade.int.test.ts:89`. **Refusal half:** `it.todo('[05a #15 mask half] …')` — `auth/device-upgrade.int.test.ts:218` (not a running test). **Hand half:** Z2 |
| 16 | covered | **`admin_warning`:** `[05a #16] admin_warning is 0 with no listed admin device, 1 with one, null with two` — `queries/devices-access.int.test.ts:38`. **`recovery_available`:** `[05a #16] login-roster recovery_available: true with no listed admin device, false with one` — `auth/admin-session.int.test.ts:74` |
| 16a | covered | `[05a #16a] at 0 a bootstrap token is issued (issued_by recovery, device_id = caller); the link signs in with a PIN; a second press … already_issued_until …; at ≥ 1 → 403 recovery_not_needed` — `auth/recovery-link.int.test.ts:17`; `[05a #16a] approve half: the owner approves their phone from the recovery session …` — `:57`; `[05a #16a] any live bootstrap token … already_issued_until …` — `:98` |
| 17 | covered | `describe('[05a #17] downgrade with a listed device connected now → named to the requester')` — `alerts/downgraded-raise.int.test.ts:88` (tests `:89, :118, :125`) |
| 17a | covered | `[05a #17a] the manager's only listed device (a phone) is not connected → holders of approve-void; another manager answers …; the requester cannot (self)` — `alerts/downgraded-raise.int.test.ts:139` |
| 18 | covered | `[05a #18] no listed device at all → holders of approve-void; another manager answers …; the requester cannot (self)` — `alerts/downgraded-raise.int.test.ts:153` |
| 19 | covered | `describe('[05a #19] downgraded discount, comp and reopen follow tests 17–18')` — `alerts/downgraded-raise.int.test.ts:197`; per kind `:247` (named) and `:257` (holders of the kind's permission) |
| 20 | covered | `[05a #20] a command queued on a listed device and replayed after the device became everyone is masked (fail-closed)` — `auth/session-directory-call-sites.int.test.ts:103` |
| 21 | covered except delivery half (**PENDING task 25**) | **hub half** `describe('[05a #21] device_waiting (hub half)')` — `auth/device-waiting.int.test.ts:84`: kind and link `{ type: devices }` `:85`; one notice for two requests (raised once, a second request writes nothing) `:96`; closed `done` when the last is approved `:113`; closed `obsolete` by the sweeper `:131`; never the code `:190` (statement counts `:153, :168`). **Link half (client):** `[05a §3.10] a tap on a row whose target is { type: "devices" } opens #/devices, no sheet and no read` — `client/src/features/devices/DeviceList.test.tsx:127` (`describe` `:126`; no `#21` in the title). **Delivery half ("only to listed devices"):** no test; task 25 |
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
| D-2 `in_person` removed, downgraded money, answers | 01d v1.3.5 (incl. Q-1 – Q-3, `97e3847d`, `6207dae1`) | 23 answers, 24 downgraded raise, **25 routing: not built** | 23 `58cab77c`; 24 `89193dd9`; 25 **pending** |
| D-3 `device_waiting`, link `{ type: 'devices' }` | 01d v1.3.5 | 26 kind; 31 client link; **25** (delivery to listed devices only) | 26 `9e1924ff`; 31 `0f06ad63`; 25 **pending** |
| D-4 `always_on` = non-kds with `point_id` | 01d v1.3.5 | 27 | `05e3baf9` |
| K-1 Pass readers; `DeviceRoleSet` writes `lane_label` only | 03b v1.0.15 (`f45df89a`) | 27 (readers + writer), 28 (upgrade carries `point_id`); client `PassScreen` parse in 35 | 27–28 `05e3baf9`; 35 `df49a7b6` |
| K-2 "Use as Pass tablet" → edit-form link | 03b v1.0.15 | 33 (`BindDialog`, `admin/page.ts`) | `c0e3ad84` |
| A-1 audit action `device_profile_set` | 04 v1.0.8 (`f1cc15bc`) | 3 action, 36 client audit names (G-b) | 3 `652d2e01` (direct); 36 `df49a7b6` |
| B-1 05 counter: downgraded path via `ctx.permission`, "Confirm on your phone" | no bump (PL-2) | no single task; mask in 9–10, client buttons in 34; test `[05a #28]` (shift-close) and `[05a #7c]` is task 30 (**pending**) | 34 `453003fc`; 30 **pending** |
| F-1 Foundation §6.2 append `DEVICE_ACCESS_DENIED` (403), `DEVICE_ACCESS_SELF` (422) | F v1.15 append, no bump (`855e87eb`) | 2 | `63bbc278` (direct) |
| C-1 client shell tabs from `screens` | no bump | 34 shell tabs (+ 35 deep-link fallback, 12 for the data) | 34 `453003fc`; 35 `df49a7b6` |

## 3. Review Focus RF-1 – RF-5 → tests

| RF | Test title and `file:line` |
|---|---|
| RF-1 no-profile staff device | **Mask half (task 9):** `describe('[05a RF-1] a staff device with no profile masks like everyone (v1.0.1 R-1)')` — `auth/session-directory.int.test.ts:125`; test `:138`. **Sign-in half (task 17):** `describe('[05a RF-1] a staff device with no profile keeps today's sign-in rule …')` — `auth/sign-in-check.int.test.ts:124`; tests `:125` (phone accepts Ali, refuses Bilal), `:141` (null owner refuses every PIN), `:155` (tablet and kiosk accept any directory staff), `:169` (`/admin/auth` → `403 listed_device_only`). **Invariant (task 15):** `[05a RF-1] every non-kds device approved has a profile; none is left without one` — `commands/approve-pairing-request-v2.int.test.ts:185`. **Task 28:** `[05a #15] [05a RF-1] boot upgrades every unrevoked non-kds device …` — `auth/device-upgrade.int.test.ts:89`. Known exception, by design: an ownerless phone (raw SQL) stays unprofiled, `device-upgrade.int.test.ts:203` |
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
| PC-3 (task 28) | Upgrade runs inline in `boot()` as step 4c; an ownerless phone (raw SQL only) stays unprofiled and is warned each boot; the #15 refusal half belongs here (still `it.todo`) |
| PC-4 (tasks 27, 33) | Between 27 and 33 `SetDeviceRole` dropped a sent `point_id` (old "Use as Pass tablet" did nothing); task 33 replaced it with the edit-form link, so it is not a check after 33 |
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
| 26 | Until task 25, `device_waiting` also reaches `everyone` devices (label only: no code, name or count). `manual-checks.md` check 1 ("Owner's phone shows a device waiting notice") may therefore also show it elsewhere |
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
| `device_waiting` client copy proposed: "A device is waiting for approval" / "Device waiting" (`alert.device_waiting.card` / `.lock`, EN + UR) | Spec gives no wording; goes in task 25's client follow-up unless the owner says otherwise |
| Carry-overs to task 25 | MINOR-1 raise without the extra pre-read; MINOR-2 `deeplink-check` `devices` → open, not `no_place`; MINOR-3 01d #69 counts 20 kinds |
| Plan A-7 assumption | `kiosk_home` retired, content is `takeaway`; confirm on the kiosk at the manual check |

## 6. Gaps in this draft

- Test titles were read from the grep output, truncated at about 230 characters. A title's later clauses were not read for every row.
- No test was run; the board states the gate was green at the last merge it records, not at `e48f2d8f`.
- #7 / #7a / #7b / #7c / #21 (delivery) wait on tasks 25 and 30; this file needs a re-grep when they land. The board's Task 25 and 30 rows are empty.
