# 05a Device Access + Screens — Module Spec

| | |
|---|---|
| Module | 05a Device Access + Screens (hub + client) |
| Version | **v1.0.7 DRAFT (pending hostile review + owner)** (2026-11-24; 02b-TK owner rulings R3, R7 and hand-off owner answer Q4; with 00 HPA v1.13 and Foundation v1.18, both DRAFT): the TV **pickup board** — screen key `board` on a paired kiosk PC or tablet, the `display` session (00 M96), `GET /queries/pickup-board`, display hints, voice settings — "⚠️ Changed by v1.0.7 (B-n)" markers; **hostile run 1** (`docs/reviews/00_v1.13_hostile_run1.md`) fixed in place, "⚠️ Changed by v1.0.7 hostile run 1 (<id>)" markers — **v1.0.6 APPROVED** (owner, 2026-11-24 00:23 PKT, with 08d v1.0 / module 08 v1.2, row D-1: screen key `inventory`, `close-daily-sheet` listed-only) — **v1.0.5 APPROVED** (owner, 2026-11-23 12:24 PKT, with 05b v1.0, row A-1: "9b" → "05b") — v1.0.4 APPROVED (owner, 2026-11-23, build ruling G-h (a)) — v1.0.3 APPROVED (owner, 2026-11-23, build ruling G-g (a)) — v1.0.2 APPROVED (owner, 2026-11-23, build rulings G-e (a), G-f (a)) — v1.0.1 APPROVED (owner, 2026-11-23 03:35 and 03:53 PKT: gap-sweep rulings R-1 and G-b) — v1.0 (APPROVED 2026-11-23 03:24 PKT, "approve!") with two owner-ruled notes; every §4.5 row is applied by the 05a plan's phase 0 (as 04 P0.2 and 05 P0.2 did) |
| Inherits | Shared Standards from **Foundation v1.15** §6; not redefined here. ⚠️ Changed by v1.0.7: v1.0.7 is written against **Foundation v1.18** (DRAFT, same change; §6.2 codes, §5.7 session kinds) |
| Depends on | Foundation v1.15; **00 v1.12.2** (devices, pairing M44, the STAB-1 tablet token flow M86, sessions, §3.5 PIN order, §3.6 resolve, §3.7 pipeline, M42 / M72 bootstrap); **01b v1.10.3** (directory); **01d v1.3.4** (bindings §3.7, routes §3.4, kinds, requests §3.3, links §3.13); 02b v1.0.24 (kiosk home, audiences); **03b v1.0.14** (`SetDeviceRole`, `devices.point_id`, Pass readers); 04 v1.0.7 (audit actions); **05 v1.0.34** (money commands, shifts). ⚠️ Changed by v1.0.7: **00 v1.13** (DRAFT, same change: `display` session M96, `POST /auth/display` §6.39, WS display mode §6.21, `registerDisplayCatchUp` / `registerDisplayHint`, migration ~~`0029`~~ `00NN_display_sessions.sql` (⚠️ Changed by v1.0.7 (integration, 02b-TK): the next free hub number at merge, as 00 HPA v1.13 §5.1)); **02b v1.0.25** (DRAFT, separate bump, run 1 at `6419003a`: §4.2 export `takeawayProgress` with its one line-`ready_at` rule, `pickup_at_ms`; row Q-1 answered by 02b row TK-7); **03b v1.0.16** (`LINE_READY_AT_SQL`, 02b row TK-3); **01d v1.3.7** (DRAFT, row D-5 written: boards never alert recipients); 03a v1.2.10 (`EngineOrder.promise_ms`, in memory) |
| Read by | 06 (sync carries `DeviceProfileSet`), 01e (headless pairing uses the same request flow), 9b (Capacitor app) ⚠️ Changed by 05b (row A-1): **05b** (Staff Tablet App, `docs/specs/05b_Staff_Tablet_App_Spec_v1.0.md`) |
| Stories | Owner rulings in chat 2026-11-23 (rows O-1–O-17); the owner's note "Restaurant POS — how devices and screens work TODAY" |
| Number | `05a` = after 05, before 06 (owner 2026-11-21). Its 00 / 01d / 03b / 04 rows become their next bumps |

### Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-23 | First draft (solo devices, role entries, sign-in notice). |
| v0.2 | 2026-11-23 | **Owner: "bht complex ban raha ha"** → three rules only. Removed: solo concept, role entries, sign-in notice / Not me, shuffled keypad, access request, solo-only guard on hub admin by count. Owner rulings: OQ-4 in-person answers **removed**; OQ-3 floor managers keep approving their floor from a listed device; OQ-6 any listed device can approve, so one broken device never blocks; the shared-list risk (§3.4) **accepted** ("itna risk theak ha"). |
| v0.3 | 2026-11-23 | Owner "yes fix it": corrections only, no rule change. Hub migration `0026` → `0027_device_profiles.sql`; spec versions brought to the current ones; §4.5 H-1 names the STAB-1 **Add a tablet** flow it removes. |
| **v0.4** | 2026-11-23 | **Hostile review `docs/reviews/05a_v0.3_hostile_review.md` fixed** (owner rulings 02:39 PKT, rows O-9–O-15). **BLOCKERS:** B-1 the listed-only rule moves **into `resolve()`** through a session-bound directory view (§3.3, §3.3a); B-2 "nothing is taken away" replaced by the list of what is lost, M-8 warns at 0 or 1, and at 0 the hub admin home offers a recovery link from `issueAdminBootstrap` (§3.2 M-8, §5.3, §6.11); B-3 bindings derived from the latest profile (§3.8). **MAJORS:** M-1 money `allowed` grants downgraded to "Confirm on your phone" on `everyone` devices (§3.3a, §3.9); M-2 `close-shift-for-others` leaves the list, requests always raised (§3.3); M-3 approve / revoke / edit / list on both routes (§6.3, §6.4, §6.8); M-4 `device_waiting` lifecycle (§3.10); M-5 money requests never ring where they cannot be answered (§3.9); M-6 self-guard extended, admin sessions ended on a switch to `everyone` (§6.4); M-7 revoke only a one-person phone, others → `everyone` + needs review (§3.2 M-5, §6.9); M-8 cause `owner_removed` kept, 04 audit action `device_profile_set` (§4.2, §4.5 A-1); M-9 kiosks and tablets keep the `manager` screen (§5.3); M-10 all six "tablet only" Pass readers (§4.5 K-1, K-2, D-4); M-11 deep links to a missing screen fall back to the inbox, read-only screens removed (§3.6, §8); M-12 `needs_review` in the event and the projection, rebuild steps, upgrade step placement (§5); M-13 tests (§10). **MINORS:** m-1 – m-16 (§6.1, §6.3, §6.5, §6.8, §6.13, §8, §9, §4.5 H-1, D-2). Assumptions in §12.3. Marked "⚠️ Changed by v0.4 (<id>)". |
| **v0.5** | 2026-11-23 | **Targeted check `docs/reviews/05a_v0.4_targeted_check.md` fixed** (owner rulings 02:55 PKT, rows O-16, O-17). Owner: §3.6 **KEEP** (no read-only screens; M-11 FIXED). **MAJOR:** N-1 removal from a still-listed device ends staff **and** admin sessions (§6.4, §6.9); N-2 Test alert, printer and Kitchen screens setup are in the "taken away" list (§5.3, §3.6); N-3 a downgraded request is `named` to the requester only while one of their listed devices is connected now (§3.9). **MINOR:** N-4 every `DeviceProfileSet` bumps `profile_version` (§4.2, §6.9, §6.10); N-5 upgrade carries `point_id` and puts `pass` first on any hardware (§5.3); N-6 only `authorize`, the §3.5 checks and `AnswerRequest` add `reason` (§3.3a); N-7 recovery link: one live link, `admin-device-public` group, caller's `device_id` (§6.11); N-8 variance sign-off and petty-cash approvals named (§3.3). **NIT:** N-9 an emptied **phone** is always revoked (O-17, §3.2 M-5, §6.9); N-10 D-1 names its three code points; N-11 one writer of `devices.point_id` (§5.1, K-1). STAB-1 removal ordering stated (§11, H-1). Marked "⚠️ Changed by v0.5 (<id>)". |
| **v0.5.1** | 2026-11-23 | **Final check `docs/reviews/05a_v0.5_final_check.md` fixed** (text only, no rule change). **R-1** §6.11: the "live link" read is **any** live admin bootstrap token (`consumed_at IS NULL AND expires_at > now`), so it needs no column and no migration. **R-2** H-7, §6.11: `issueAdminBootstrap` gains a trailing `deviceId` parameter (default `'hub'` for setup, CLI and restore). **R-3** §3.3: 05 cite → v1.0.32 (the version on this branch; same rows). **R-4** §6.4 step 5 and §6.10 get their v0.5 markers. Marked "⚠️ Changed by v0.5.1 (R-n)". |
| **v1.0** | 2026-11-23 | **APPROVED by the owner** ("approve!", 03:24 PKT) as v0.5.1, with every §4.5 row (H-1–H-7, D-1–D-4, K-1, K-2, A-1, B-1, F-1, C-1). No rule changed. The rows become the next versions of 00, 01d, 03b and 04 (and F §6.2 appends), applied by the 05a plan's phase 0 against the versions on `main` at that time; re-check each target's version number then, because `fix/stab-tablet-pairing` already carries 00 v1.12.2, 03b v1.0.14 and 05 v1.0.34. |
| **v1.0.1** | 2026-11-23 | **Gap sweep rulings** (`docs/plans/05a-gaps.md`, read at the stab tip `44112286`; owner 03:35 and 03:53 PKT). Status stays APPROVED. **R-1** (gap G-a) — a staff device with no profile: permissions as `everyone` (§3.3a note), sign-in by today's rule (§3.5 note). **G-b** — the `device_profile_set` audit detail stores `staff_ids`; display names are looked up when the log is read, as 04 does (§4.2). Plan phase 0 takes the versions 00 v1.12.3, 01d v1.3.5, 03b v1.0.15, 04 v1.0.8 and the Foundation v1.15 §6.2 append. Moved code cites are listed in the gap file, and the spec text keeps the v1.0 cites. Marked "⚠️ Changed by v1.0.1 (R-1 / G-b)". |
| **v1.0.2** | 2026-11-23 | **Build rulings** (owner, cloud integrator session, from the task 32 review). Status stays APPROVED. **G-e (a)** — clearing by derivation in `SetDeviceProfile` (§6.4): the merged profile drops `point_id` when its `screens` have no `pass`, and drops `staff_ids` when its `access` is `everyone`; the payload is unchanged (no null values). **G-f (a)** — the approve and edit forms pick people from the whole directory: the device list `devices` (§6.8) adds `staff: [{ staff_id, display_name }]` (every directory person, from memory, no statement). Marked "⚠️ Changed by v1.0.2 (G-e / G-f)"; the 00 §6.17 note in 00 v1.12.3 carries the G-f field. |
| **v1.0.3** | 2026-11-23 | **Build ruling G-g (a)** (owner, from the task 33 review). Status stays APPROVED. The recovery signal must reach the case it exists for: after the upgrade every staff device is `everyone` (§5.3), and `/admin/login-roster` refuses `everyone` devices (H-2). So that `403 PERMISSION_DENIED { permission: 'access-hub-admin', reason: 'listed_device_only' }` also carries `recovery_available` (the same boolean; `POST /admin/recovery-link` already reveals it). The hub admin sign-in page shows **Recover admin access** when it is true, on any paired non-kds device. Marked "⚠️ Changed by v1.0.3 (G-g)"; 00 v1.12.3 §6.13 carries the note. |
| **v1.0.5** | 2026-11-23 | **05b row A-1** (owner approved with 05b v1.0, 12:24 PKT; applied by the 05b plan phase B task P0.1). Status stays APPROVED. "9b" → "05b" in the header, §1 out of scope, §3.8 client, §6.1 and §8; the hub address is typed as `host:port` (05b M-16); 05b's native service is the alert socket of a one-person listed tablet. No rule change. |
| v1.0.4 | 2026-11-23 | **Build ruling G-h (a)** (owner, from the task 24 review). Status stays APPROVED. §3.9 rule 1 (a) "connected now" is **route-level**: a listed device counts only if it would reach the requester now (their own open session on it, or its alert socket when it is permanently bound to them). Was readable as device-level, which on a shared listed tablet with someone else signed in left a `named` request ringing nobody. 01d v1.3.5 §3.3 carries the same note. Marked "⚠️ Changed by v1.0.4 (G-h)". |
| **v1.0.6** | 2026-11-24 | **08d row D-1** (`docs/specs/08_Inventory_Costing_Spec_v1.2.md` Part D §4.5, owner "8d approve!"): `SCREEN_KEYS` gains `inventory` (§3.6), offered on every staff device type, shown to a person holding any 08d permission; no existing profile gets it automatically; `close-daily-sheet` joins `LISTED_ONLY_PERMISSIONS` (§3.3). Not yet built (08d plan). |
| **v1.0.7** | 2026-11-24 | **DRAFT (pending hostile review + owner).** 02b-TK owner rulings (`docs/plans/02b-tk-rulings.md`, 24 Nov 2026) **R7** — the pickup board is a display session kind on a paired device, no person, not a new device type — and **R3** — the TV shows tokens only; hand-off answer **Q4** — voice "Urdu then English, chime first" (`docs/design/handoff/02b-tk/CHANGES.md`); GAPS G-8, G-9. **B-1** screen key `board` (§3.6): only on `cashier_kiosk` / `tablet`, alone (`screens = ['board']`), `access = 'everyone'`, no people, no point; board settings `{ voice }` in the profile (`DeviceProfileSet` **v2**, §4.2). **B-2** staff sign-in refused on a board device: `403 DEVICE_ACCESS_DENIED { reason: 'display_device' }` (§3.5, §9). **B-3** approve / edit rules and session ends on a switch to or from the board (§6.3, §6.4). **B-4** pickup-board derivation (§3.11) and **`GET /queries/pickup-board`** (§6.12, 2 statements, tokens only). **B-5** display catch-up part and display hints (§6.13). **B-6** board client: `/board/`, call-outs, recorded voice clips 1–999 (ur, en) as static assets, offline rules (§8). **B-7** migration step: `device_profiles.board_json` in 00's `0029` (§5.4) (⚠️ Changed by v1.0.7 (integration, 02b-TK): its own file `00NN_device_profiles_board.sql`, numbered at merge, hostile run 1 m-4). **B-8** rows for other specs (§4.5 v1.0.7). Hand-off owner answer Q1 ("first name on the TV") is overridden by R3. Marked "⚠️ Changed by v1.0.7 (B-n)". |

### Hostile run 1 fixes (`docs/reviews/00_v1.13_hostile_run1.md`)

Reviewed with 00 HPA v1.13 and Foundation v1.18. Status stays DRAFT.

| Finding | Resolution | Where |
|---|---|---|
| B-1 export unowned, readiness disputed | Row Q-1 is answered by **02b v1.0.25 §4.2 `takeawayProgress`** (02b run 1, `6419003a`; 02b row TK-7): 2 statements, one entry per token group, and 02b's **one** line-`ready_at` rule (Pass ready time from 03b `LINE_READY_AT_SQL`, closed `done` Readies included; else the engine line's `done_at`; else a no-station line's `added_at`, held until the pickup on a pickup order). §3.11 cites it and restates nothing; the "Pass mark only where a Pass exists" alternative is owner decision OD-1 (00 HPA §12.3) | §3.11, §4.1, §4.5 Q-1, §6.12, §6.13, test 37 |
| M-2 alert targets, alert socket, 05b | 01d v1.3.7 row D-5 is written (row D-5 below points to it). 00 v1.13 §6.21 refuses a board's alert-mode `auth` (`4403 display_device`) and §6.4 here closes the device's alert-mode socket on a switch to the board. **Pilot boards are `cashier_kiosk` only** (Chrome / Edge kiosk mode): `screensOffered` offers `board` on `cashier_kiosk` alone; a tablet board (05b app, R33 lock-task) is deferred, owner decision OQ-B7 / OD-2; no 05b bump | §3.2 M-9, §3.6, §4.2, §4.5 D-5, T-1, §6.3, §6.4, tests 30, 32, 45 |
| M-3 `statusLink` | Row P-1: `statusLink(order_id) → { path, url } \| null` (00 v1.13 M98), 03c reads `?.url` | §4.5 P-1 |
| m-4 migration numbers | the ALTER is its own file `00NN_device_profiles_board.sql`, numbered at merge | §5.4, §11 |
| m-5 clips not servable | path `apps/client/board/public/voice/` (Vite root is the entry folder); `.mp3` added to the hub's `client-dist` types (00 v1.13 §7.10); new entry folder `apps/client/board/` and the `board` key in `vite.config.ts` `ENTRIES` listed for the owner (OD-6) | §7, §8, §11 |
| m-6 clip count | clips 1–300 (≈ 600 files, ≈ 3 MB); above 300 chime and banner only | §8, OQ-B3 |
| m-10 kiosk queue stranded | `/staff/` on `display_device` first sends its IndexedDB command queue under the queued session (02b §3.12 rule), then opens `/board/`; the edit form warns when the device has unsent commands it reported (client); risk in OQ-B9 | §8, test 47 |
| m-11 code reuse | kept `DEVICE_ACCESS_DENIED` + `reason`; every `/staff/` client branches on `reason` before text; client test 48; the alternative code `DISPLAY_DEVICE` is owner decision OQ-B8 | §9, test 48 |
| m-12 R33 | folded into M-2: no tablet board in the pilot | OQ-B7 |
| m-14 tests | tests 45–50 | §10 |
| m-15 owner list | OQ-B rows marked; the BLOCKER-for-approval list is 00 HPA v1.13 §12.3 "Owner decisions" | §12.3 |

#### Integration pass (02b-TK cross-spec rows)

⚠️ Changed by v1.0.7 (integration, 02b-TK), 2026-11-24; still DRAFT.

| Source row | Change here | Where |
|---|---|---|
| 01d v1.3.7 C-F-37 (owner decision Q-37c) | A board's alert-mode socket is closed with **`4413` `DISPLAY_DEVICE`** (reason `display_device`; not a revoke, the device keeps its token), not `4403` | §4.5 D-5, §6.4 step (board switch), test 45 |
| 01d v1.3.7 C-05b-37 | Recorded in row T-1 as **deferred with tablet boards** (pilot boards are kiosk-only; no 05b bump) | §4.5 T-1 |
| 03c v1.0.16 (row P-1) | 03c now reads `statusLink(root_order_id)?.url` with the url on `public_status.port` (its Depends line, §3.11, §4.1, test 57); P-1 is carried | §4.5 P-1 |
| 02b v1.0.25 TK-7 | Checked: Q-1 answered by 02b §4.2 `takeawayProgress` with the same signature, filter, 2 statements and line `ready_at` rule as §3.11 cites | — |

#### Owner review of the 02b-TK Part B package (24 Nov 2026)

⚠️ Changed by v1.0.7 owner review, 2026-11-24; still DRAFT (hostile run 2 owed). Every other recommended default in §12.3 is **accepted** as written.

| Row | Owner answer | Change here | Where |
|---|---|---|---|
| OR-1 (OQ-B3, O-20, 00 OD-7) | **English only, no Urdu clips.** Tokens pass 300 by mid-morning (1,500–2,000 orders a day), so numbers are **composed from pieces**: chime, "token number", one … nineteen, twenty … ninety, "hundred", "thousand"; every token 1–2000 is spoken ("token number two hundred fifty seven") | `BOARD_VOICES = ['off', 'en']`, default `en`; 31 clips (≈ 160 KB); the composer; tests 42, 49, 51 | O-20, M-11, §3.6, §4.2, §6.3, §6.4, §6.12, §7, §8, §10, §11, §12 |
| OR-6 (OD-2) | The board runs on a PC the owner provides; tablet board stays deferred | none (plan `docs/plans/02b-tk-plan.md` "Before go-live") | — |
| **L-1** (OR-7; 02b v1.0.25 §3.7a) | The unpaid hand-over is approved by a manager "on 'only these people' devices" | `hand-over-unpaid` (01b v1.12 B-5) joins **`LISTED_ONLY_PERMISSIONS`**; its 01d kind `hand_over_unpaid` is a money kind (`needs_pin: 'always'`), so `AnswerRequest` already needs a listed device (§3.9); test 52 | §3.3, §10 |


---

## §1. Header

### The three rules

1. **One attach flow.** Every device shows a code; someone with `manage-devices` approves it on one form (name, kitchen station **or** screens, who may use it).
2. **"Who may use it" is `everyone` or `listed`.** On a `listed` device only the listed staff can sign in; any other PIN, even correct, is refused before it is checked.
3. **Approvals and admin only on `listed` devices.** On an `everyone` device the sensitive permissions (§3.3) never work, and a money action a person is allowed to do directly needs their own confirmation from a listed device (§3.3a). So a leaked PIN used at a shared counter or tablet cannot approve, void, discount, comp, reopen or open hub admin. ⚠️ Changed by v0.4 (M-1)

### In scope

Pairing by request for every device type (token pairing removed), device profile (name, screens, access, point), the sign-in check, the listed-only mask in `resolve()`, money downgrades, 01d binding, routing and in-person changes, 03b Pass binding through screens, staff shell tabs, migration of paired devices, admin recovery at zero admin devices.

⚠️ Changed by v1.0.7 (B-1, B-4, B-6): **the TV pickup board** (R7): a screen key `board` that turns a paired kiosk PC into a board (run 1 M-2: tablet boards deferred) with a `display` session (00 v1.13 M96), the `pickup-board` query, display hints, voice call-outs (§3.6, §3.11, §6.12, §6.13, §8).

### Out of scope / deferred (§12.4)

Sign-in alert with "Not me", shuffled PIN pad, PIN only while on shift, staff NFC cards, "add me to this device" request, Delivery screen, enforcing screens on the hub, 01e headless devices, the Capacitor app itself (9b; §8 states what 9b must do; ⚠️ Changed by 05b (row A-1): built by **05b**).

---

## §2. Existing architecture that must not change

- Device token auth; REVOKED terminal; re-pair = new row (00 §3.3).
- **`devices.device_type` keeps its four values and never changes on a row**; it now means hardware only. Its readers are: 01d bindings (AD-47) and routes, the client alert-mode rule (`socket.ts`), catch-ups and audiences (02b O17, 05 bill audiences), `as_drawer` (05).
- M44 request mechanics: 6-char display code, poll secret, 10-minute expiry, caps (M76), **the code check on approval** (proves the approver sees the physical screen).
- 00 §3.5 PIN order; new checks go **before step 2** (as M38's check does today, `auth/staff-session.ts:33-35`): not a PIN failure, no argon2.
- Sessions, takeover (M20), replacement (M6).
- Bootstrap admin (M42) and the hub CLI `issue-admin-bootstrap` (M72): the last-resort way in. The token still needs staff + PIN + `access-hub-admin`, with failures counted per IP. §6.11 reuses the same `issueAdminBootstrap` function and adds no new sign-in path.
- Event sourcing: projections rebuild from events. ⚠️ Changed by v0.4 (M-12): `devices` itself is **not** a projection. Its rows are inserted by handlers, and its event folds are forward-only `UPDATE`s with no reset (`kds/device-roles.ts:64`). So the upgrade (§5.3) appends events, and the new `device_profiles` / `device_people` tables are true projections.
- Routing and approver reads use the hub's unmasked directory (`alertDirectoryOf`, `alerts/raise.ts:98`). Only the **session's own** grants are masked (§3.3a). ⚠️ Changed by v0.4 (B-1)

---

## §3. Domain rules

### 3.1 Owner rulings

| ID | Ruling | Source |
|---|---|---|
| O-1 | One attach flow for every device. | 2026-11-23 01:16, 01:24 |
| O-2 | Approving a device needs `manage-devices` ("jiskay pass hub ki access ho"), not a role. | 01:16 |
| O-3 | A device is used by the people it was added for, plus anyone added later; nobody else. | 01:28 |
| O-4 | A personal phone stays locked to its owner. | 01:24 ("ye cheez loose nahi karna") |
| O-5 | A leaked PIN must not approve from a shared tablet. | 01:26 |
| O-6 | Screens per device as tabs; screen decides what is visible, permission what is allowed. | 2026-11-21 |
| O-7 | 01d in-person answers are removed. | 01:49 (OQ-4 "khatam karo") |
| O-8 | Keep it simple: `everyone` / `listed`; a listed device with several people may approve for all of them, risk accepted. | 02:05, 02:07 |
| O-9 | The listed-only rule lives in the effective-permission resolver, one point for every check. | 02:39 (B-1) |
| O-10 | On an `everyone` device a direct money grant becomes a request the person confirms on their own listed device; with no listed device it goes to the normal approvers. | 02:39 (M-1) |
| O-11 | `close-shift-for-others` is counter work, not listed-only; raising a request is never masked. | 02:39 (M-2) |
| O-12 | State what the upgrade takes away; warn at 0 or 1 admin devices; at 0 show the bootstrap link on the hub admin home. | 02:39 (B-2) |
| O-13 | A binding follows the device's latest profile. | 02:39 (B-3) |
| O-14 | Editing your own device so you lose admin is refused; switching a device to `everyone` ends its admin sessions. | 02:39 (M-6) |
| O-15 | Only a personal phone (one person) is revoked when its list empties; any other device becomes `everyone` and needs review. Kiosks and tablets keep the `manager` screen. | 02:39 (M-7, M-9) |
| O-16 | No read-only screens: a screen is hidden when the person holds none of its permissions (KEEP). | 02:55 (§3.6) |
| O-17 | A "Confirm on your phone" request goes to the phone only while it is connected, else to the normal approvers; a phone whose list empties is always revoked; the recovery link is not reissued while one is live. | 02:55 (N-3, N-9, N-7) |
| O-18 | ⚠️ Changed by v1.0.7 (B-1): the pickup board is a **display session kind** on a paired device (no person), **not a new device type**. | 02b-TK R7, 2026-11-24 |
| O-19 | ⚠️ Changed by v1.0.7 (B-4): the TV board shows **tokens only, no names** (also no phone, items or amounts); overrides the hand-off answer Q1 ("first name only"). | 02b-TK R3, 2026-11-24 |
| O-20 | ⚠️ Changed by v1.0.7 (B-6): board voice ~~"Urdu then English, chime first"~~; ⚠️ Changed by v1.0.7 owner review (OR-1): **English only, chime first**; numbers composed from ~31 recorded pieces so every token 1–2000 is spoken; recorded clips, no TTS, works offline on the LAN. | hand-off CHANGES.md Q4; GAPS G-9 |

### 3.2 Decisions

| ID | Decision | Prevents |
|---|---|---|
| M-1 | The **approver picks the people** on the form; the unpaired device never shows a roster or takes a PIN. Each listed person proves themself at their first sign-in with their PIN. | Staff names shown to any LAN client, and PIN guessing from an unauthenticated device |
| M-2 | `device_type` comes from the device's hint, can be corrected on the form before approval, never after. | Breaking `device_type` readers (§2) |
| M-3 | Kitchen = `device_type = 'kds'` (station, no sign-in), unchanged. Every other type is a staff device with `access` and `screens`. | A mode column duplicating `kds` |
| M-4 | **Screens are a view boundary only.** The hub enforces access (rule 2) and the mask (rule 3); it does not map commands to screens. Audiences stay as today (by permission and hardware). | A command→screen map across 02a / 02b / 03b / 05 with no security gain |
| M-5 | ⚠️ Changed by v0.4 (M-7): when a directory removal empties a device's list: a **phone** is revoked (`cause: 'owner_removed'`, as M38 today), whatever its list size was before (⚠️ Changed by v0.5 (N-9, O-17): was "a phone whose list had exactly one person"; phone hardware is personal). **Any other device** becomes `access = 'everyone'` with `needs_review = true` and is never revoked, so its drawer shift, printer routes, device targets and point work keep running. | A personal phone left paired after its owner leaves; a counter or Pass device going dark mid-service on an unattended sync |
| M-6 | Pass is a screen with a point; `devices.point_id` is written by `SetDeviceProfile`; 03b `SetDeviceRole` keeps only `lane_label`. | Two writers of `point_id` |
| M-7 | Inbox, requests to answer, own shift, Me and sign out are on every staff device, outside the screens. | Approval requests hidden behind a screen (01d R22) |
| M-8 | ⚠️ Changed by v0.4 (B-2): the hub admin home and the device list warn when **0 or 1** unrevoked `listed` devices list a person whose `manage-devices` resolves `allowed`. With 1: "Only one device can manage devices — add a backup". With 0: "No device can manage devices" and the **recovery link** (§6.11). The count comes from the in-memory `deviceProfile` map and the directory; no statement. | Owner's only admin device breaks, or the upgrade leaves none (OQ-6) |
| M-9 | ⚠️ Changed by v1.0.7 (B-1): **A board is a profile, not a device type.** `screens = ['board']` on a `cashier_kiosk` (a kiosk PC driving the TV in Chrome / Edge kiosk mode; ⚠️ Changed by v1.0.7 hostile run 1 (M-2): a tablet board is deferred, OQ-B7); `access = 'everyone'`, no `staff_ids`, no `point_id`; its only session is `display` (00 M96). `device_type` keeps its four values (§2). | Touching every `device_type` reader (01d bindings and routes, catch-ups, audiences, `as_drawer`) for a screen that has no person |
| M-10 | ⚠️ Changed by v1.0.7 (B-2): **Nobody signs in on a board.** `POST /auth/pin`, `POST /admin/auth`, `GET /admin/login-roster`, `GET /queries/staff-roster` and `POST /admin/recovery-link` on a board device → `403 DEVICE_ACCESS_DENIED { device_id, reason: 'display_device' }`, first, from memory, no argon2, not counted. | A PIN typed on a public TV; a staff session left open on a public screen |
| M-11 | ⚠️ Changed by v1.0.7 (B-6): **Board settings live in the profile** (`board: { voice: 'off' \| 'en' }`, default `en`; ⚠️ Changed by v1.0.7 owner review (OR-1): was `'off' \| 'ur_en' \| 'ur' \| 'en'`, default `ur_en`), set on the device edit form, read by the board with each `pickup-board` read. | Settings lost with browser storage on an unattended TV; a settings panel on a public screen |

### 3.3 Listed-only and money permissions (rule 3)

⚠️ Changed by v0.4 (B-1, M-1, M-2, m-16). Two lists in `@pos/domain/src/permissions.ts`:

- **`LISTED_ONLY_PERMISSIONS`** (masked to `not_granted`): `access-hub-admin`, `manage-devices`, `manage-staff`, `manage-roles`, `manage-fiscal-settings`, `approve-void`, `view-audit-log`, `close-daily-sheet` (⚠️ Changed by 08d v1.0 (D-1): closing and correcting the daily sheet is a manager act, done on a listed person's session), `hand-over-unpaid` (⚠️ Changed by v1.0.7 owner review (L-1, OR-7): approving an unpaid hand-over, 02b §3.7a, is done on the manager's own listed device).
- **`MONEY_PERMISSIONS`** (an `allowed` grant is downgraded): `void-item`, `apply-discount`, `apply-comp`, `apply-refund` (no command today; refunds go through `reopen-bill`, 05 S-8), `reopen-bill`.
- **Answering a 01d request of a money kind** (`needs_pin: 'always'`) needs a listed device (§3.9). This is the one rule that is not a permission, so it lives in `AnswerRequest` (§4.5 D-2).

**Not in either list** (O-11, owner OQ-3: counter work never breaks): `close-shift-for-others`, `close-business-day`, `view-reports`, `take-payment`, `open-cash-drawer`, `record-petty-cash`, `remove-comp`, `remove-service-charge`, `close-without-buyer-id`, and every permission a cashier or order taker uses.

**Counter check (OQ-3)** on an `everyone` kiosk:
- Unchanged: taking payment, the drawer, petty cash, closing another cashier's shift and its count (05 §6.18–§6.21), removing another cashier's payment (05 §6.10), reports, day close.
- A cashier's void, discount, comp and reopen **requests** are raised as today.
- Changed: a manager's direct void, discount, comp or reopen becomes "Confirm on your phone" (§3.3a). Every money answer moves to a listed device.
- ⚠️ Changed by v0.5 (N-8): this includes the 05 request kinds (all `needs_pin: 'always'`, `billing/kinds/index.ts:53`): the **variance sign-off** raised when a shift is closed with a difference, and an **over-limit petty cash** approval (right: holders of `close-shift-for-others`, 05 v1.0.32 request kinds `shift_variance`, `petty_cash`, `05_Billing_Spec_v1.0.32.md:653-657`; ⚠️ v0.5.1 (R-3): was "v1.0.34", which is only on `fix/stab-tablet-pairing`). Closing and counting the shift stay at the counter; the sign-off is answered from a listed device.

### 3.3a The mask in `resolve()` (00 §3.6) ⚠️ Changed by v0.4 (B-1, M-1, M-2)

`resolve(staff_id, permission)` is unchanged. Every place that resolves **for a session** gets a session-bound view, `directory.forSession(session)`. Its `resolve(staff_id, permission)` applies the table below **only when `staff_id` is the session's own staff and the session's device has `access = 'everyone'`**. Other staff ids resolve unmasked (their device is not this one).

The view is what these places get, so each inherits the rule from one point:
- `ctx.directory` of commands (`commands/registry.ts:28,44`), queries (`queries/registry.ts:19,119`) and PIN hooks;
- `authorize` in the pipeline (`commands/route.ts:353-373`);
- the admin guard (`requireAdmin` → `hasAdmin`, `auth/guards.ts:246`), `adminPermissions` and `permissionsOf`;
- 01d `mayAnswer` (`alerts/targets.ts:516`, for the answerer);
- direct routes that resolve for their session against the raw directory, today `print/routes.ts:111` (`requireManageDevices`), which switch to the view. ⚠️ Changed by v0.4 (B-1: a call site the review did not list)

Other raw-directory reads (`orders/audiences.ts:61`, routing) are about sockets or other people and stay unmasked (M-4).

⚠️ Changed by v1.0.1 (R-1, owner 2026-11-23 03:35 PKT): **a staff device with no profile** (`deviceProfile(device_id)` is undefined: no non-kds device should be in that state, see §5.3 / §6.3) counts as `access = 'everyone'` for the view, so its sessions are masked (fail-closed). This applies to permissions only; sign-in is §3.5.

| Session's own grant | `access = 'everyone'` device | Listed device, or a session with no device (bootstrap admin) |
|---|---|---|
| permission in `LISTED_ONLY_PERMISSIONS`, `allowed` | `{ grant: 'not_granted', masked: 'listed_only' }` | unchanged |
| permission in `MONEY_PERMISSIONS`, `allowed` | `{ grant: 'requires_approval', approver_role_ids: [], scope, masked: 'downgraded' }` | unchanged |
| any permission, `requires_approval` | **unchanged** (raising a request is never masked) | unchanged |
| `denied`, `not_granted`, any other permission | unchanged | unchanged |

- ⚠️ Changed by v0.5 (N-6): only `authorize` (`route.ts:369`), the §3.5 sign-in checks and `AnswerRequest` (§3.9 rule 2) add `reason: 'listed_device_only'` to their `403`. The seven sites that throw their own details (`alert-receipts.ts:99`, `kds-config.ts:35`, `print-queue.ts:44`, `print-config.ts:77`, `print/routes.ts:112`, `credentials.ts:92`, the audit query) **do not change**: they return their `403` as today. The client takes the "Do this on your own phone" text from `GET /queries/session`'s `masked` flag, which it already holds.
- A `downgraded` resolution takes the command's existing request path (`approvable: true`, 00 §3.7). `alerts.raise` reads `ctx.permission.masked === 'downgraded'` and stores the right as §3.9 says. Handlers do not change: they pass `ctx.permission.approver_role_ids` as today (`void-items.ts:71`, `discount.ts:184`, `reopen-bill.ts:343`, `comp-line.ts`).
- `GET /queries/session` returns the view's result, so the client hides `listed_only` actions and shows `downgraded` ones as "Confirm on your phone" (§6.7).
- Queued commands are resolved at execution time (`route.ts:144-146`). A command queued on a listed device and replayed after the device became `everyone` is masked (fail-closed). A command from a session the edit ended gets `401` and goes to the 02b §3.12 queue log. ⚠️ Changed by v0.4 (m-13)
- WS audiences (02b, 05) are unchanged (M-4). ⚠️ Changed by v0.4 (m-12)
- Cost: no statement; the device profile and the directory are in memory.

### 3.4 Accepted risk (O-8)

On a listed device with several people (a floor tablet listing the floor manager and two waiters), a waiter who learns the manager's PIN can approve there. The owner chose who is on that list. Everywhere else a leaked PIN approves nothing, and its direct money actions need the owner's own listed device (§3.3a).

### 3.5 Sign-in check (`POST /auth/pin`, `POST /admin/auth`)

Before 00 §3.5 step 2, both checks are not counted, run no argon2 and read the in-memory `deviceProfile` map with no statement:
- device `listed` and `staff_id` not on its list → **`403 DEVICE_ACCESS_DENIED { device_id }`**;
- `/admin/auth` on an `everyone` device → `403 PERMISSION_DENIED { permission: 'access-hub-admin', reason: 'listed_device_only' }`.

⚠️ Changed by v1.0.1 (R-1, owner 2026-11-23 03:35 PKT): **a staff device with no profile** keeps **today's** sign-in rule, not `everyone`'s. A `phone` accepts only its `owner_staff_id` (another person, or any PIN when the owner is null → `403 DEVICE_ACCESS_DENIED { device_id }`, before step 2, not counted, no argon2). A `tablet` or `cashier_kiosk` accepts any directory staff. `/admin/auth` on such a device is refused as on an `everyone` device (§3.3a note).

⚠️ Changed by v0.4 (m-8): the hub returns `DEVICE_ACCESS_DENIED` only. `DEVICE_NOT_OWNED` stays in `errors.ts` and F §6.2 (a code is never renamed or reused) but is no longer returned; the client maps both codes to the same text.

⚠️ Changed by v0.4 (m-10): **Takeover (M20)** is allowed between two people on the same `listed` list and on `everyone` devices. An unlisted person never reaches it (the check above runs first). On a one-person device only that person signs in, so only replacement (M6) applies.

⚠️ Changed by v1.0.7 (B-2, M-10): **a board device** (`deviceProfile(device_id).screens` = `['board']`) → **`403 DEVICE_ACCESS_DENIED { device_id, reason: 'display_device' }`** for `POST /auth/pin`, `POST /admin/auth`, `GET /admin/login-roster`, `GET /queries/staff-roster` and `POST /admin/recovery-link`. This check runs **first** (before the listed check and before 00 §3.5 step 2): not counted, no argon2, no statement. The `/staff/` client follows the reason to `/board/` (00 v1.13 §8.2).

### 3.6 Screens

| Key | Shows | Acts (with the permission) | Offered on |
|---|---|---|---|
| `dine_in` | table map, table view | open table, take order, send, served, request bill | all staff hardware |
| `takeaway` | takeaway queue, New order | create order, pay takeaway bills | all |
| `parking` | car slots made at runtime, New car order | create order, served, pay parking bills | all |
| `cashier` | every open bill, Held | settle, split, reprint, drawer, petty cash | `cashier_kiosk`, `tablet` |
| `pass` | Pass view of the device's point | `run-pass` | all; needs `point_id` |
| `manager` | live view, reports, day close; audit, test alert, printers and Kitchen screens setup only where `view-audit-log` / `manage-devices` are unmasked (⚠️ Changed by v0.5 (N-2)) | (masked items hidden, §3.3a) | all |
| `inventory` (⚠️ Changed by 08d v1.0 (D-1)) | the A-item daily sheet's day view (08 Part D §6.6): receive, transfer-in, waste, closing count, my entries; Close for `close-daily-sheet` holders | `ReceiveGoods`, `ReceiveTransfer` (`receive-stock`), `RecordWaste` (`record-waste`), `RecordCount` (`count-inventory`), `ReverseInventoryEntry` (`reverse-inventory-entry`), `CloseDailySheet` (`close-daily-sheet`) | all staff hardware (`screensOffered` offers it everywhere); **no existing profile gets it automatically** — the manager adds it in Devices; hidden when the person holds none of the five permissions |
| `board` (⚠️ Changed by v1.0.7 (B-1)) | the TV pickup board (`/board/`, §8): Ready and Preparing tokens, call-outs | none: no person signs in; the device opens a `display` session (00 v1.13 M96) | `cashier_kiosk` only (⚠️ Changed by v1.0.7 hostile run 1 (M-2)); **alone** (`screens = ['board']`) |

- Tabs in list order; the device remembers its last tab.
- ⚠️ Changed by v0.4 (M-11), kept by the owner in v0.5 (O-16, KEEP): a screen is **hidden** when the person holds none of its permissions. There are no read-only screens: `cashier` needs `take-payment`; `manager` needs one of `view-reports`, `close-business-day`, `view-audit-log`, `manage-devices` (after the mask).
- 1–6 screens, unique, offered for the hardware; `pass` ⇔ `point_id` set. ⚠️ Changed by v1.0.7 (B-1): `board` ⇒ `screens = ['board']`, `access = 'everyone'`, no `staff_ids`, no `point_id`, and the profile's `board` settings set (default `{ voice: 'en' }`, ⚠️ Changed by v1.0.7 owner review (OR-1)); without `board` in `screens`, `board` settings are null. `screensOffered('cashier_kiosk')` adds `board` (⚠️ Changed by v1.0.7 hostile run 1 (M-2): not `tablet`); `phone` and `kds` never get it. `board` is a key, not a shell tab: the staff shell never shows it (a board device has no staff session).
- ⚠️ Changed by v0.4 (M-11, m-11): **hardware still decides three things.** Customer contact goes to `cashier_kiosk` hardware and the placer (02b O17), so a `tablet` with `cashier` does not see it. A drawer shift needs a kiosk or a tablet with a printer route (05 `as_drawer`, `DRAWER_DEVICE_INVALID`). Bill-stream audiences are `take-payment` holders and kiosks (05 H16-6).

### 3.7 Device lifecycle

```
 unpaired ─POST /pair/requests─► PENDING (code on screen, 10 min)
                                     │ ApprovePairingRequest (manage-devices, unmasked: a listed device or the bootstrap admin session; code typed)
                                     ▼
                                  ACTIVE ──SetDeviceProfile──► ACTIVE (name, screens, access, point; live, no re-pair)
                                     ├── RevokeDevice ─────────────────────────────────────► REVOKED
                                     ├── phone, list emptied (directory) ─────────────────► REVOKED 'owner_removed'   ⚠️ v0.5 (N-9)
                                     └── other device, list emptied (directory) ─────────► ACTIVE, everyone, needs_review
```

⚠️ Changed by v1.0.7 (B-3): a staff device **↔ board** is a `SetDeviceProfile` edit (§6.4), live, no re-pair: to the board ends its staff and admin sessions `'forced'`; away from the board ends its display session `'forced'`. A board is revoked like any device (00 §6.14). A directory apply never touches a board (it has no people, §6.9).

### 3.8 Alert binding (01d §3.7) ⚠️ Changed by v0.4 (B-3)

The binding of a device is derived from its **latest** profile, recomputed on every `DeviceProfileSet`:

| Latest profile | Bound person |
|---|---|
| `listed`, exactly one person P (any hardware) | P, permanent (`session_id` NULL); `SessionStarted` / `SessionEnded` never touch it; routes like today's phone row (connected and present, no idle check) |
| `tablet` hardware, any other profile | the last signed-in person (today's tablet rule) |
| `phone` hardware, `everyone` or several people | the tablet rule |
| `cashier_kiosk` hardware, any other profile | none (today's BF-3 rule) |
| `kds` | none (no profile) |
| **no profile yet** (replay before the device's first `DeviceProfileSet`) | today's rules by hardware: a phone is bound to `DevicePaired.owner_staff_id`; tablet, kiosk, kds as today |

**Transitions on `DeviceProfileSet`:**
- To one person P → upsert `(device_id, P, session_id NULL)`; this replaces any session row.
- Away from one person → delete the permanent row. The next `SessionStarted` binds by the hardware rule. A session still open on the device stays unbound until its next sign-in, so the header shows "Alerts: none".
- `DeviceRevoked` → delete the row, as today.

**Client:** alert mode stays by hardware (`socket.ts:90-94`): kiosk and phone pages open it while signed out; the tablet page never does (9b's service will). So a one-person listed tablet page has no alert socket until 9b (known 01d gap, unchanged). ⚠️ Changed by 05b (row A-1): **05b's native service does** (05b M-4): the one-person listed tablet's permanent binding reaches its alert-mode socket, signed in or not.

**Rebuild:** the projection keeps its own `device_id → latest profile` map from events and reads no `device_profiles` row, so `reset` + replay gives the same rows.

### 3.9 Money requests and answers (01d) ⚠️ Changed by v0.4 (M-1, M-5)

1. **Raise from a downgraded grant.** The request is raised as the kind's own request (same kind, values, details, steps), with the stored right chosen at raise:
   - **(a) the requester is on ≥ 1 unrevoked listed device that is connected now** (an open session or alert-mode socket of that device in the hub's in-memory socket lists, `ws.connectedSessions()` / `alertSockets()`, read at raise; no statement) ⚠️ Changed by v1.0.4 (G-h (a), owner 2026-11-23): **route-level** — a listed device counts only if it would reach the requester now: the requester's **own** open staff session on it, or its alert-mode socket when the device is bound to them permanently (a `listed` device with exactly one person, §3.8). A listed device that lists them with only someone else signed in does **not** count → `right_mode: 'named'`, `receiver_staff_id` = the requester. Card text "Confirm on your phone". The requester answers it with their own PIN from a listed device; 01d rule 5 ("self") is skipped only for a `named` request whose receiver is its requester.
   - **(b) no listed device, or none connected now** → `right_mode: 'holders'`, `permission` = the kind's `range_permission` if it has one (void: `approve-void`), else its `base_permission` (`apply-discount`, `apply-comp`, `reopen-bill`). The normal approvers answer: anyone holding that permission `allowed` with a scope covering the requester, never the requester (rule 5 applies). **[ASSUMPTION A-2]**

   Both reuse `AlertRaised` v5's right modes, so there is no event version change. ⚠️ Changed by v0.5 (N-3, O-17): the choice is made **once, at raise**, and the stored right never changes. A manager whose phone is off or left at home gets the holders path, so another manager approves and the counter is never stuck; if the phone disconnects after a `named` raise, the requester withdraws and raises again, which then takes the holders path.
2. **Answers:** a money-kind answer (`needs_pin: 'always'`) from a session on an `everyone` device → `403 PERMISSION_DENIED { reason: 'listed_device_only' }`. It is returned by `preRead`, right after rule 3 (PIN rule) and before argon2 (nothing counted, no PIN verified), and re-checked in `prepare`. Accept kinds are unchanged. No in-person answers (O-7).
3. **Routing (M-5):** for a money kind, a person route to an `everyone` device is dropped at resolve time (01d §3.4.3). Device targets keep their lock-only line, as today (they never answer). `requests-to-answer` on an `everyone` device omits money requests. The §3.9 "no one can approve" check counts an approver as reachable only through a listed-device route. So a request whose approvers are only on shared devices escalates as if they were away.
4. **Requester text:** `my-requests.ask_in_person` keeps its field; the client text becomes "Waiting — find a manager" (new key `request.find_approver`), because in-person answering is removed.

### 3.10 `device_waiting` (01d kind) ⚠️ Changed by v0.4 (M-4)

| | |
|---|---|
| Kind | `device_waiting`, family `info`, subject `hub` / branch_id, dedupe key `device_waiting`, `lead_fallback: false`, no request part |
| Target | `{ kind: 'permission', permission: 'manage-devices' }`, **listed devices only** (the §3.9 rule 3 drop applies to this kind too) |
| Raise | inside the `POST /pair/requests` transaction, only when no open `device_waiting` exists (1 statement); `actor_id` null, `device_id 'hub'`. 00 §6.30 "Events: none" becomes "`AlertRaised` (`device_waiting`) when none is open" |
| Update | none: a new request while it is open writes nothing. The alert carries no count and never the code; the device list shows the count |
| Close | `done` in the `ApprovePairingRequest` transaction when no other request is pending (the existing `pair_requests_pending` read); `obsolete` by the session sweeper (00 §7.3, existing 15 s timer) when no request is pending any more (expiry), in its existing write |
| Link | new 01d link type `{ type: 'devices' }` → staff route `#/devices` (the device list, Waiting group; §8) |

---

### 3.11 Pickup board ⚠️ Changed by v1.0.7 (B-4)

Read by `GET /queries/pickup-board` (§6.12) and by 00 v1.13 §6.41 (the customer status page uses the same line rules for one group).

- **Entries.** One entry per **token** of the **open business day**: a takeaway addition carries its root order's token (02b §3.11, row Q-6), so the root and its additions are **one group**. Orders of other types, and orders of an earlier business date (carried over, OQ-B4), are not on the board. No business day open → both lists empty.
- **Lines** of a group are **02b v1.0.25 §4.2 `takeawayProgress`**'s (⚠️ Changed by v1.0.7 hostile run 1 (B-1): cited, not restated): **live** = lines with `live_units` > 0, deal headers (`is_deal_header`) left out and their parts counted; **unserved** = live lines with `served_at` null; **ready** = unserved lines whose `ready_at` is set by **02b's one line-`ready_at` rule** (§4.2 there: the Pass ready time via 03b `LINE_READY_AT_SQL`, closed `done` Readies included; else the engine line's `done_at` while the order is in the engine; else a no-station line's `added_at`, held until the pickup on a pickup order). The same rule serves 02b's `open-orders` and 00 v1.13 §6.41. Owner decision OD-1 (00 HPA §12.3): engine `done` also counts at a point that has a Pass (02b's rule as written).
- **Column and state:**

| unserved | ready | Column | `state` |
|---|---|---|---|
| 0 | — | not on the board (handed over or cancelled) | — |
| ≥ 1 | 0 | Preparing | — |
| ≥ 1 | ≥ 1 | Ready | `pay` when any order of the group has `billed_at` null ("Pay at counter"); else `part` when ready < unserved ("Part ready"); else `ready` |

- **Ready:** `ready_at` = the latest `ready_at` of the group's ready lines; sorted by `ready_at` ascending (oldest first, BoardRush), then token.
- **Preparing:** `eta_ms` = the latest `orders[].promise_ms` of the group (02b export: `EngineOrder.promise_ms` while in the engine, else null), null when none; `pickup_at_ms` = the root order's `orders[].pickup_at_ms` (02b export; null after a boost), else null. Sorted by `pickup_at_ms ?? eta_ms` ascending, nulls last, then token.
- **Tokens only (R3, O-19):** no name, first name, phone, items, amounts, notes or staff. Hand-off frames that show a first name or "phone orders by first name" are overridden.
- **Size:** lists are returned whole (≤ about 200 orders in a rush, Foundation §1); the page shows at most 24 Ready and 16 Preparing tiles plus "+N more" and never scrolls (§8).

## §4. Contracts

### 4.1 Consumes

| From | What | Used for |
|---|---|---|
| 00 | `devices`, `pair_requests`, `defineCommand`, `ws.sendToDevices`, session events, `issueAdminBootstrap` | pairing, profile, sign-in, recovery |
| 01b | directory (staff ids, grants), `applyStaffDirectory` hook | access check, mask, M-5 |
| 01d | `raise` (permission target), `registerKind`, binding projection, `mayAnswer` | `device_waiting`, bindings, §3.9 |
| 03b | `branchConfig().points`, `point` resolver | Pass screen |
| 00 (⚠️ Changed by v1.0.7) | `display` session (M96), `POST /auth/display`, `registerDisplayCatchUp`, `registerDisplayHint`, `defineQuery({ allowDisplay })` | the board's session, catch-up part and hints (§6.12, §6.13) |
| 02b v1.0.25 (⚠️ Changed by v1.0.7) | `takeawayProgress(db, state, filter)` (row Q-1) | §3.11, §6.12 |
| 03a (⚠️ Changed by v1.0.7) | `EngineOrder.promise_ms` (memory, as 02b `open-orders` reads it) | Preparing `eta_ms` |

### 4.2 Exposes

| Export | Shape |
|---|---|
| Event `DeviceProfileSet` v1 (stream `hub`, id = device_id, like `DevicePaired`; ⚠️ Changed by v0.4 (m-9)) | `{ device_id, device_name, access: 'everyone' \| 'listed', staff_ids: string[] (empty for everyone), screens: ScreenKey[], point_id: string \| null, profile_version: int, cause: 'approved' \| 'edited' \| 'directory' \| 'upgrade', needs_review: boolean }`. The whole profile each time; replay = last event per device wins. `needs_review` is `true` for `upgrade` and for a `directory` event that switched the device to `everyone` (M-5); otherwise `false`. ⚠️ Changed by v0.4 (M-12). ⚠️ Changed by v0.5 (N-4): **every** `DeviceProfileSet`, whatever its `cause`, carries `profile_version` = the previous one + 1 (1 for the first), so an edit form opened before a directory apply gets `409 CONFIG_STALE` and cannot re-add a removed person |
| Audit action `device_profile_set` (04, row A-1) | detail `{ device_name, access, staff_ids, screens, point_id, cause }`; actor = the editor (null for `upgrade` / `directory`). ⚠️ Changed by v0.4 (M-8). ⚠️ Changed by v1.0.1 (G-b, owner 2026-11-23 03:53 PKT): the detail stores `staff_ids` (was "people: display names"); `audit-log` looks up the display names when the log is read, from `staff_names` as for every other action (04: names are never part of an entry) |
| `DeviceRevoked.cause` | unchanged enum `['manual', 'owner_removed']`: M-5's revoke is the M38 case and keeps `owner_removed`. No schema change. ⚠️ Changed by v0.4 (M-8) |
| `deviceProfile(device_id)` | memory `{ access, staff_ids: Set, screens, point_id, needs_review }`, refreshed after `DeviceProfileSet`, `DevicePaired`, `DeviceRevoked` commits |
| ⚠️ Changed by v1.0.7 (B-1, M-11): **`DeviceProfileSet` v2** | v1 + `board: { voice: 'off' \| 'en' } \| null` (⚠️ Changed by v1.0.7 owner review (OR-1)) (non-null exactly when `screens = ['board']`). Upcaster v1 → v2: `board: null`. Every writer (approve, edit, directory, upgrade) writes v2; `deviceProfile(device_id)` adds `board`. The `device_profile` push (§6.4) adds `board` |
| `directory.forSession(session)` | the masked view (§3.3a) |
| `LISTED_ONLY_PERMISSIONS`, `MONEY_PERMISSIONS`, `SCREEN_KEYS`, `screensOffered(device_type)` | `@pos/domain`. ⚠️ Changed by v1.0.7 (B-1): `SCREEN_KEYS` adds `board` (after `inventory`); `screensOffered` adds it for `cashier_kiosk` only (⚠️ Changed by v1.0.7 hostile run 1 (M-2)); `BOARD_VOICES = ['off', 'en']` (⚠️ Changed by v1.0.7 owner review (OR-1)); `isBoard(profile)` = `screens` is exactly `['board']` |
| ⚠️ Changed by v1.0.7 (B-4): `PickupBoardView` (`@pos/events`, Zod `.strict()`) | the §6.12 response shape |

### 4.5 Changes to other specs (R26) — *Approved 2026-11-23 with v1.0; applied by the 05a plan's phase 0*

| Row | Target | Change |
|---|---|---|
| H-1 | 00 §3.3, §6.7, §6.8, §6.30–§6.32, §8.1, §8.2, M14, M44, M86 | Every device pairs by request; approval takes the profile (§6.3). ⚠️ Changed by v0.4 (m-14): **removed**: `GenerateDevicePairingToken` (`commands/generate-device-pairing-token.ts`) and `POST /devices/pair` (`auth/pairing.ts`) with their registrations (`server.ts:36,177`; `pairing_token` stays in `SECRET_FIELDS`, `server.ts:92`); the pair page's `t` / `d` branch (`auth/pair-page.ts:359-374`); the hub admin views **Add a phone** (`#add-phone`) and **Add a tablet** (`#add-tablet`, STAB-1) (`admin/page.ts:33-34, 880-1025`); 00 tests 167, 168 (replaced by §10 test 1). `pairing_tokens` stays (unused; the sweeper purges it); the `DevicePaired` and `pairing_token_generated` audit mappers stay for history; `DeviceTokenRotated` (M14) is retired for devices (no path writes it). Pair page text "Ask someone with hub access to approve this screen". The Capacitor lines are 9b text (§8). ⚠️ Changed by v0.5: the STAB-1 removal lands in the same commit as tablet / phone approval (§11 step 4) |
| H-2 | 00 §3.5, §6.6, §6.9, §6.13 | §3.5 checks; `DEVICE_ACCESS_DENIED`; `/admin/auth` refused on `everyone` devices; `/admin/login-roster` (§6.13): `everyone` → `403 listed_device_only`; listed → its people whose `access-hub-admin` is `allowed`; response adds `recovery_available` (§6.11). ⚠️ Changed by v0.4 (m-4) |
| H-3 | 00 §3.6, §3.7, §6.20 | ⚠️ Changed by v0.4 (B-1): the mask lives in the session view of `resolve()` (§3.3a); the pipeline's `authorize`, `requireAdmin` and the query registry use the view; `403` reason `listed_device_only`. The pipeline gains no separate guard |
| H-4 | 00 M38, §6.13, §6.17, §6.18c, §6.19, `apply-directory.ts` | `owner_staff_id` readers → the profile's `staff_ids`; `phone_count` → `device_count` (listed devices naming the person); M38 revoke → M-5; roster on a listed device = its people only. ⚠️ Changed by v0.4 (m-3): §6.17 `pairing_source` (today a `CASE` on `device_type`, `queries/devices.ts:24`) is **dropped** from the response |
| H-5 | 00 §5.1 | Migration `0027` (§5.1) |
| H-6 | 00 §3.7, §6.2 | ⚠️ Changed by v0.4 (M-3): a query may be `sessionKind: 'both'` (registered on `GET /queries/` and `GET /admin/queries/`), like 05 row H-1 for commands; used by `devices` (§6.8) |
| H-7 | 00 §6.29 / M72, §4.2 events | ⚠️ Changed by v0.4 (B-2): `AdminBootstrapTokenIssued` **v2** adds `issued_by: 'recovery'` (upcaster v1 → v2 = identity); `issueAdminBootstrap(tx, 'recovery')` (§6.11). ⚠️ Changed by v0.5.1 (R-2): the function (`auth/bootstrap-tokens.ts:9-44`) gains a trailing parameter `deviceId: string = 'hub'`, written as the event's `device_id` (today hard-coded `'hub'`, line 40). Setup, the CLI and restore keep the default; §6.11 passes the caller's device id. Signature: `issueAdminBootstrap(tx, issuedBy: 'setup' \| 'cli' \| 'restore' \| 'recovery', deps, deviceId = 'hub')` |
| D-1 | 01d §3.7 bindings, §3.4.3 routes | ⚠️ Changed by v0.4 (B-3): §3.8 table and transitions replace the phone row; the projection consumes `DeviceProfileSet`; a one-person permanent row routes like the phone row on any hardware. ⚠️ Changed by v0.5 (N-10): the three code points: (1) `alerts/bindings.ts:97-99` stops skipping phone sessions, so a phone that is not one-person follows the tablet rule; (2) the permanent-row route in `alerts/routes.ts:115-119` keys on `session_id IS NULL`, not on `device_type = 'phone'`; (3) `binding_route_until` is null for every permanent row (01d §3.7's "always null for a phone" becomes "for a permanent row") |
| D-2 | 01d §3.3 rules 2, 4, 5; §6.2; §6.8 | **Method `in_person` removed** (O-7): the payload enum keeps the value, and `preRead` returns `403 PERMISSION_DENIED { reason: 'in_person_removed' }` before argon2. `RequestAnswered.method` / `RequestPinFailed.method` keep `in_person` for history. `answered_on_requester_device` stays (now only `pin` / `session` answers on the raising device). 00 §8.5's "`'in_person'`" sentence goes. The answer sheet drops "Approve here" (`AnswerSheet.tsx:412-415`, `InPerson.tsx`). ⚠️ Changed by v0.4 (m-5, M-1, M-5): §3.9 rules 1–4 (the downgraded right; rule 5 skipped for a named self request; the money-answer refusal placed after rule 3 in `preRead` / `prepare`; the routing drop; `request.find_approver` text) |
| D-3 | 01d §3.10, §3.13.1, §3.13.5 | New kind `device_waiting` (§3.10), link type `{ type: 'devices' }`, route `#/devices` added to the `focus`-free route list. ⚠️ Changed by v0.4 (M-4) |
| D-4 | 01d §3.4 `always_on` (from 03b D-5 / D-6) | ⚠️ Changed by v0.4 (M-10): "unrevoked `tablet` devices bound to an active point" → "unrevoked non-kds devices with `point_id` set to an active point" (`alerts/targets.ts:443`) |
| K-1 | 03b §3.4, §3.8, §6.10, §6.12, §6.15 | `SetDeviceRole.point_id` removed (M-6): new `DeviceRoleSet` events carry the device's current `point_id` unchanged (v1 shape kept). ⚠️ Changed by v0.5 (N-11): the `device_roles` fold (`kds/device-roles.ts:65-75`) **writes `lane_label` only** from now on; the `DeviceProfileSet` fold is the one writer of `devices.point_id`. Historic `DeviceRoleSet` point values are superseded by each device's upgrade `DeviceProfileSet`, which carries the device's current `point_id` (§5.3). ⚠️ Changed by v0.4 (M-10): "Pass tablet" (03b:100) = "a non-kds device with `point_id`" in **every** reader: the memory map (`device-roles.ts:36`, also refreshed after `DeviceProfileSet`), the `point` resolver (`device-roles.ts:78-82`), `kds-config.pass_tablets` (`queries/kds-config.ts:19-21, 89-91`) and `PassScreen.tsx:130` (route parsing with the device's own type). `always_on` is row D-4 |
| K-2 | 00 §8.2, 03b Kitchen screens page | "Use as Pass tablet" link (`admin/page.ts:774-777`) and the bind dialog (`BindDialog.tsx:45`) → a link to the device edit form (§8), shown on every non-kds row |
| A-1 | 04 audit (`packages/domain/src/audit.ts`) | ⚠️ Changed by v0.4 (M-8): new action `device_profile_set` (§4.2); existing `device_paired`, `device_revoked`, `pairing_token_generated` unchanged |
| B-1 | 05 §8 (counter), §6.13 | ⚠️ Changed by v0.4 (M-1, M-2): no rule change in 05; its approvable commands take the downgraded path through `ctx.permission` (§3.3a); the client shows "Confirm on your phone" |
| F-1 | Foundation §6.2 | ⚠️ Changed by v0.4 (m-8): append 403 `DEVICE_ACCESS_DENIED`, 422 `DEVICE_ACCESS_SELF` (R34, no bump) |
| C-1 | client staff shell | ⚠️ Changed by v0.4 (M-9, M-11, gating): tabs from `screens`; home = first screen (was kiosk → `kiosk_home`, else inbox / pass; `kiosk_home` is retired, its content is the `takeaway` screen); `device_profile` push redraws the tabs; **what is shown comes from the profile and the masked permissions, never from `device_type` or screen width**. Width only picks the layout (bottom tabs ≤ 760 px, top bar wider; `PHONE_QUERY`, `shell/layout.ts:4`); the width gates `!phone && …` (`StaffApp.tsx:500-510`) are removed |

### 4.5 v1.0.7 Changes to other specs (R26) — ⚠️ Changed by v1.0.7 (B-8); DRAFT, applied on approval

| Row | Target | Change |
|---|---|---|
| H-8 | 00 HPA **v1.13** (same change) | session kind `display` (M96), `POST /auth/display` (§6.39), WS display mode (§6.21), `registerDisplayCatchUp` / `registerDisplayHint`, `defineQuery({ allowDisplay })`, `/board/` entry and pair-page routing (§8.2), migration `00NN_display_sessions.sql` (§5.1); this spec's ALTER is its own file (§5.4, run 1 m-4) |
| F-2 | Foundation **v1.18** (same change) | §5.6 note (a board is a profile), §5.7 session kinds, §5.4 / §6.5 display mode, §6.2 reason `display_device` on `DEVICE_ACCESS_DENIED` |
| Q-1 | 02b **v1.0.25** (separate bump) | ⚠️ Changed by v1.0.7 hostile run 1 (B-1): **answered** by 02b v1.0.25 §4.2 `takeawayProgress(db, state, filter: { open_day: true } \| { group_of: order_id })` (`orders/exports.ts`; 02b row TK-7): the shape this row asked for, **2 statements** whatever the size (orders of the groups; their lines with 03b's `LINE_READY_AT_SQL`, 02b row TK-3), engine reads in memory, `group_of` → `[]` for an unknown or non-takeaway order, `open_day` → `[]` with no open day. Its line `ready_at` rule is the one rule §3.11 and 00 §6.41 use. Customer tracking un-deferred in 02b §12.4 |
| D-5 | **01d v1.3.7** (DRAFT, written; ⚠️ Changed by v1.0.7 hostile run 1 (M-2)) | **Board devices are never alert recipients** (01d v1.3.7 row D-5): skipped by `always_on`, `device`, `point` and `screen_devices` (`isBoard(deviceProfile(id))`, memory, 0 statements); `SendTestAlert` to a board → `400 VALIDATION_FAILED { field: 'target', issue: 'display_device' }`; no `alerts` catch-up part or frames for a display session; an alert-mode connection from a board is refused (~~`4403`~~ ⚠️ Changed by v1.0.7 (integration, 02b-TK): **`4413` `DISPLAY_DEVICE`**, 01d v1.3.7 row C-F-37, as 00 v1.13 §6.21 now says). 02b-TK R8's "reach the kiosks" means the counter kiosks, not a board |
| T-1 | 05b — **no bump** (⚠️ Changed by v1.0.7 hostile run 1 (M-2, m-12)) | Pilot boards are `cashier_kiosk` only (Chrome / Edge kiosk mode); a tablet board is deferred (OQ-B7). When it comes: the 05b AlertService stops when the approved profile is the board, and the shell loads `/board/` in lock-task mode (R33). ⚠️ Changed by v1.0.7 (integration, 02b-TK): **01d v1.3.7 row C-05b-37** ("the native alert service, on close `4413`, stops — no token check, no reconnect loop — and does not start while the approved profile is the board") is **deferred with tablet boards**: it lands in the 05b bump that brings a tablet board, not now |
| P-1 | 03c v1.0.16 (separate bump) | ⚠️ Changed by v1.0.7 hostile run 1 (M-3): the token slip QR encodes `statusLink(root_order_id)?.url`; `statusLink` returns `{ path, url } \| null` (00 v1.13 M98: `null` while `public_status.enabled` is off, without `advertised_host`, for a non-ULID order id, or with no key); the url is `http://<advertised_host>:<public_status.port>/t/<order_id>.<mac>` (~~03c v1.0.16 still names `http_port` in its Depends line: owed by 03c~~ ⚠️ Changed by v1.0.7 (integration, 02b-TK): carried by 03c v1.0.16, Depends line, §3.11 QR, §4.1, test 57) |
| A-2 | 04 audit | `device_profile_set` detail adds `board` (the voice setting); display sessions are not audit rows (as station sessions) |

---

## §5. Data model and migrations

### 5.1 Hub migration `0027_device_profiles.sql` ⚠️ Changed by v0.4 (M-12)

The file's first line is `-- migrate:foreign-keys-off` (the runner's rebuild recipe, `db/migrate.ts:66-79`; `foreign_key_check` runs before commit). Its steps, in order:

1. **Rebuild `devices`** without `CHECK ((device_type = 'phone') = (owner_staff_id IS NOT NULL))`:
   - `CREATE TABLE devices_v2` with every column of `0002` and `0008`, in order: `device_id TEXT PRIMARY KEY`, `branch_id`, `token_hash TEXT NOT NULL UNIQUE`, `device_name`, `device_type` (with its `IN` check), `station_id`, `owner_staff_id`, `paired_at`, `paired_by`, `last_seen_at`, `revoked_at`, `revoked_by`, `point_id`, `lane_label`, and `CHECK ((device_type = 'kds') = (station_id IS NOT NULL))`.
   - `INSERT INTO devices_v2 SELECT … FROM devices`; `DROP TABLE devices`; `ALTER TABLE devices_v2 RENAME TO devices`.
   - `devices` has no other index or trigger, and no FK refers to it today, so nothing else is recreated.
   - The merged `0002` is not edited. `owner_staff_id` stays as a column, null on new rows.
2. **Create the projections:**

```sql
CREATE TABLE device_profiles (           -- projection of DeviceProfileSet; staff devices only
  device_id       TEXT    PRIMARY KEY REFERENCES devices(device_id),
  access          TEXT    NOT NULL CHECK (access IN ('everyone','listed')),
  screens         TEXT    NOT NULL,      -- JSON array, ordered, 1–6
  profile_version INTEGER NOT NULL,      -- SetDeviceProfile expected_version
  needs_review    INTEGER NOT NULL CHECK (needs_review IN (0,1))   -- from DeviceProfileSet.needs_review
);

CREATE TABLE device_people (             -- projection of DeviceProfileSet.staff_ids (listed devices)
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  staff_id  TEXT NOT NULL,
  PRIMARY KEY (device_id, staff_id)
);
CREATE INDEX device_people_staff ON device_people (staff_id);   -- M-5 and H-4 device_count
```

3. **Add the hint column:**

```sql
ALTER TABLE pair_requests ADD COLUMN hardware_hint TEXT
  CHECK (hardware_hint IN ('tablet','cashier_kiosk','kds','phone'));
```

- `device_profiles` / `device_people` are projections (`registerHubProjections`, with `reset` = `DELETE` of both). They have no checkpoint at first boot, so `catchUp` resets them and replays from seq 0 (`projections/registry.ts:71,99`).
- The `DeviceProfileSet` fold also writes `devices.device_name` and `devices.point_id` as a **forward-only** `UPDATE` (the `device_roles` pattern): it is idempotent and is not part of the reset (§2). ⚠️ Changed by v0.5 (N-11): it is the **only** writer of `devices.point_id` (K-1).
- These FKs are the first that refer to `devices`. Any later rebuild of `devices` must use the FK-off recipe.

### 5.2 Invariants

- `access = 'everyone'` ⇔ no `device_people` rows; `listed` ⇒ 1–20 rows (M-5 never leaves a listed device empty: it switches to `everyone` or revokes).
- `kds` devices have no `device_profiles` row.
- ⚠️ Changed by v1.0.7 (B-1): a board (`screens = ['board']`) has `access = 'everyone'`, no `device_people` rows, no `point_id`, and `board_json` set; every other profile has `board_json` NULL.

### 5.3 Paired devices on upgrade ⚠️ Changed by v0.4 (B-2, M-9, M-12)

One boot step (§6.10) after the projection catch-up appends `DeviceProfileSet { cause: 'upgrade', needs_review: true }` for each unrevoked non-kds device without a profile. ⚠️ Changed by v0.5 (N-5): the event carries the device's current `devices.point_id`; when it is set, on **any** hardware (`SetDeviceRole` allows a point on any type today, `kds/commands/device-role.ts:39-44`), `pass` is the first screen, so `pass` ⇔ `point_id` holds after the upgrade.

| Today | Access | Screens |
|---|---|---|
| `cashier_kiosk` | `everyone` | `takeaway`, `parking`, `dine_in`, `cashier`, `manager` |
| `tablet` with `point_id` | `everyone` | `pass`, `dine_in`, `takeaway`, `parking`, `cashier`, `manager` |
| `cashier_kiosk` / `phone` with `point_id` ⚠️ v0.5 (N-5) | as its row | `pass` first, then its row's screens |
| `tablet` | `everyone` | `dine_in`, `takeaway`, `parking`, `cashier`, `manager` |
| `phone` | `listed` [owner] | `dine_in`, `takeaway`, `parking`, `manager` |

**What the upgrade takes away** (by design, rule 3):

- On **kiosks and tablets**:
  - hub admin (`/admin/auth` → `403`);
  - approving a pairing request (the Capacitor and browser admin screens);
  - device, staff and lockout admin;
  - fiscal settings;
  - audit view;
  - every **money answer**;
  - ⚠️ Changed by v0.5 (N-2): **Test alert** and its receipts (`send-test-alert.ts:79`, `alert-receipts`), **printer setup** (`print/commands/printer.ts:56`, `station-output.ts:25`, `bill-route.ts:38`, `print/routes.ts:111`, `print-queue`, `print-config`) and **Kitchen screens setup** (`kds/commands/screen.ts:21`, `device-role.ts:35`, `kds-config`): they all need `manage-devices`, which is listed-only. They are done from a listed device (the owner's or manager's phone or tablet).
- On kiosks and tablets, a manager's **direct** void, discount, comp and reopen become "Confirm on your phone".
- `kiosk_home` becomes the `takeaway` screen (C-1).

What stays: Reports, Day close and every counter action (§3.3), through the `manager` screen (M-9). ⚠️ Changed by v0.5 (N-2): "Test alert" removed from this line.

**Recovery:** after the upgrade, a branch whose admins own no paired phone has **0** listed admin devices. M-8 shows the recovery link on the hub admin home (§6.11), so the owner pairs their phone through the normal flow, approving it from the bootstrap session.

### 5.4 Migration step for the board ⚠️ Changed by v1.0.7 (B-7)

⚠️ Changed by v1.0.7 hostile run 1 (m-4): its **own** hub migration `00NN_device_profiles_board.sql` (the next free number at merge, after 00 v1.13's `00NN_display_sessions.sql`; `0028` is claimed twice today, by 08 Part D and 02b v1.0.25; 00 HPA §5.1 lists the clash). One statement:

```sql
ALTER TABLE device_profiles ADD COLUMN board_json TEXT;   -- DeviceProfileSet v2 .board as JSON; NULL unless screens = ["board"]
```

- `device_profiles` is a projection: the `DeviceProfileSet` fold writes `board_json` (v1 events upcast to `board: null`), and `reset` + replay gives the same rows (test 35).
- No backfill: no device is a board before v1.0.7, and the upgrade step (§5.3, §6.10) never makes one.

---

## §6. Endpoints

### 6.1 `POST /pair/requests` (changed, 00 §6.30)

⚠️ Changed by v0.4 (m-2): input adds `hardware_hint?`, a **default for the form only** (M-2):
- The pair page sends `phone` when the user agent matches `/iPhone|Android.*Mobile/`; otherwise it sends nothing. iPadOS reports a desktop agent and Android tablets omit `Mobile`, so those requests reach the form without a hint.
- The 9b app will send `tablet`. ⚠️ Changed by 05b (row A-1): the 05b app's pair page sends `tablet` (00 v1.12.4 H-2).

Processing: as today, plus the column and the `device_waiting` raise (§3.10). Statements: today's + 1 (open `device_waiting` read) + the raise when none is open. Response and errors unchanged.

### 6.2 `GET /pair/requests/:id` (changed, 00 §6.31)

`approved` adds `screens`. `kds` → `/kds/`, others → `/staff/` (unchanged). Query count unchanged (1).

### 6.3 `ApprovePairingRequest` (changed, 00 §6.32)

| | |
|---|---|
| Route | ⚠️ Changed by v0.4 (M-3): `sessionKind: 'both'` (`/commands/approve-pairing-request` and `/admin/commands/…`; today admin only, `approve-pairing-request.ts:379-382`) |
| Permission | `manage-devices`, resolved through the view, so it works only on a listed device or in the bootstrap admin session (O-2; `access-hub-admin` is not needed on `/commands`) |
| Payload | `{ request_id?, display_code, device_type, device_name: string(1–40), station_id?, access?, staff_ids?, screens?, point_id? }`. `kds` ⇒ `station_id` required, the rest absent. Else `access` and `screens` required; `listed` ⇒ `staff_ids` 1–20 unique; `everyone` ⇒ `staff_ids` absent |

Processing (`writer.run`):
1. Find the request (00 §6.32 rules: exact `display_code` match) → `404 PAIRING_REQUEST_NOT_FOUND`.
2. `kds`: station validator → `404 STATION_NOT_FOUND`.
3. Staff device:
   - each `staff_ids` entry must be in the directory → else `404 STAFF_NOT_FOUND { staff_id }`;
   - screens must be offered for the hardware → else `400 VALIDATION_FAILED { field: 'screens' }`;
   - `pass` ⇔ `point_id` → else `400 VALIDATION_FAILED { field: 'point_id' }`;
   - the point must be active → else `404 POINT_NOT_FOUND`.
   - ⚠️ Changed by v1.0.7 (B-1, B-3): `board` in `screens` ⇒ `screens` is exactly `['board']` → else `400 VALIDATION_FAILED { field: 'screens' }`; `device_type` is `cashier_kiosk` (`screensOffered`; ⚠️ Changed by v1.0.7 hostile run 1 (M-2)) → else `400 { field: 'screens' }`; `access = 'everyone'` → else `400 { field: 'access' }`; no `staff_ids`, no `point_id` → else `400 { field: 'staff_ids' \| 'point_id' }`; payload `board?: { voice }` (one of `BOARD_VOICES`), default `{ voice: 'en' }` when absent (⚠️ Changed by v1.0.7 owner review (OR-1)); `board` sent without the `board` screen → `400 { field: 'board' }`.
4. INSERT `devices` (no owner), mark the request approved, append `DevicePaired` (v1, unchanged; stream `hub` / device_id); staff device: append `DeviceProfileSet { cause: 'approved', profile_version: 1, needs_review: false }`. Close `device_waiting` if no other request is pending (§3.10).
5. Post-commit: refresh `deviceProfile`.

| | |
|---|---|
| Result | `{ device_id, device_type, station_id, screens, access }` (never the token) |
| Idempotency | D32 |
| Statements | ⚠️ Changed by v0.4 (m-6): request read (1), INSERT, UPDATE, appends (2–3), pending read for the close (1) + the close |
| Errors | §6.1; `400`, `403 PERMISSION_DENIED` (incl. `listed_device_only`), `404 PAIRING_REQUEST_NOT_FOUND` / `STATION_NOT_FOUND` / `STAFF_NOT_FOUND` / `POINT_NOT_FOUND` |
| Events | `DevicePaired`, `DeviceProfileSet`, `AlertClosed` |

⚠️ Changed by v1.0.2 (G-f (a), owner 2026-11-23): the forms pick people from the device list's `staff` (§6.8), the whole directory; never from `staff-roster`, which a listed device filters to its own people (§6.6).

Form defaults (client): `phone` hint → `listed`, one person to pick, screen `dine_in`; `cashier_kiosk` or no hint → `everyone`, `takeaway` + `cashier` + `manager`; `tablet` → `everyone`, `dine_in` + `manager`. Name suggested ("Counter 2", "Ali's phone").

⚠️ Changed by v1.0.7 (B-3, B-6): the form offers **"Pickup board (TV)"** for a `cashier_kiosk` hint or no hint (⚠️ Changed by v1.0.7 hostile run 1 (M-2): the device type must be `cashier_kiosk`): choosing it sets `screens: ['board']`, hides access, people, screens and point, and shows **Board voice**: Off / English (default) (⚠️ Changed by v1.0.7 owner review (OR-1): no Urdu choices). Name suggested "Pickup board".

### 6.4 `SetDeviceProfile` (new; `sessionKind: 'both'`)

| | |
|---|---|
| Permission | `manage-devices` (listed-only, through the view) |
| Board (⚠️ Changed by v1.0.7 (B-3)) | payload adds `board?: { voice }`; §6.3 step 3's board rules apply to the merged profile; the merge **drops `board` when the merged `screens` have no `board`**, and fills `{ voice: 'en' }` (⚠️ Changed by v1.0.7 owner review (OR-1)) when the merged `screens` are `['board']` and no setting exists; switching to the board also drops `staff_ids` / `point_id` and sets `access: 'everyone'` when they are **unsent** (sent values are still checked) |
| Payload | `{ device_id, expected_version, device_name?, access?, staff_ids?, screens?, point_id? }`; unsent fields kept; §6.3 step 3 rules on the merged profile. ⚠️ Changed by v1.0.2 (G-e (a), owner 2026-11-23): before the rules, the merge **drops `point_id` when the merged `screens` have no `pass`**, and **drops `staff_ids` when the merged `access` is `everyone`**; a sent `point_id` with no `pass`, or sent `staff_ids` with `everyone`, is still `400 VALIDATION_FAILED` |

Processing (`writer.run`):
1. Device missing, revoked or `kds` → `404 DEVICE_NOT_FOUND`.
2. `profile_version ≠ expected_version` → `409 CONFIG_STALE { device_id, profile_version }` (01b R32 "Changed elsewhere" + Reload). ⚠️ Changed by v0.4 (m-7)
3. Validate the merged profile.
4. ⚠️ Changed by v0.4 (M-6): **self-guard** → `422 DEVICE_ACCESS_SELF { device_id }`. It applies when the device is the one the editor's session is on (staff session device, or the device an admin session is bound to), and the edit either:
   - (a) leaves the editor off a `listed` list, or
   - (b) switches the device to `everyone` while the editor's `manage-devices` or `access-hub-admin` resolves `allowed` unmasked, which would cost them admin there.
   - ⚠️ Changed by v1.0.7 (B-3): (c) makes the device the board (`screens = ['board']`): nobody signs in on a board (M-10), so the editor would lose the device.
5. Append `DeviceProfileSet { cause: 'edited', profile_version + 1, needs_review: false }` (⚠️ Changed by v0.5 (N-4): every cause bumps it).
6. Post-commit, in order:
   - refresh `deviceProfile`;
   - ⚠️ Changed by v0.5 (N-1): every **staff and admin** session bound to the device of someone no longer allowed → end it `'forced'` (`ended_by` = editor) and close its sockets `4401` (the filter `kind === 'staff' || kind === 'admin'` that `endStaff` already uses, `apply-directory.ts:426`). The §3.5 check runs only at sign-in and the mask does nothing on a still-listed device, so this is the one place a removed person's admin session ends;
   - ⚠️ Changed by v0.4 (M-6): the device became `everyone` → end every **admin** session bound to it `'forced'`;
   - push `device_profile { screens, access, point_id }` to the device (a removed tab under the user → first remaining tab + toast).
   - ⚠️ Changed by v1.0.7 (B-3): the device **became the board** → end every staff and admin session bound to it `'forced'` (`ended_by` = editor) and close their sockets `4401`; the next `/staff/` load there follows `display_device` to `/board/`; ⚠️ Changed by v1.0.7 hostile run 1 (M-2): the same after-commit closes the device's alert-mode socket ~~`4403`~~ `4413` (⚠️ Changed by v1.0.7 (integration, 02b-TK): 01d v1.3.7 C-F-37) reason `display_device` (00 v1.13 §6.21);
   - ⚠️ Changed by v1.0.7 (B-3): the device **stopped being the board** → end its `display` session `'forced'` (its display socket closes `4401`, no frame, 00 §6.21); `/board/` then gets `403 DISPLAY_NOT_ENABLED` and goes to `/staff/`;
   - ⚠️ Changed by v1.0.7 (B-6): only the `board` settings changed → nothing ends; the `DeviceProfileSet` maps to a display hint `[]` (§6.13), so the board re-reads `pickup-board` and gets the new `voice` within a second.

| | |
|---|---|
| Result | `{ device_id, profile_version }` |
| Statements | ⚠️ Changed by v0.4 (m-6): device + profile read (1), people read (1), append, projection writes; session ends 1 per ended session (≤ 1 staff + admin sessions of one device) |
| Errors | §6.1; `400`, `403 PERMISSION_DENIED`, `404 DEVICE_NOT_FOUND` / `STAFF_NOT_FOUND` / `POINT_NOT_FOUND`, `409 CONFIG_STALE`, `422 DEVICE_ACCESS_SELF` |

`RevokeDevice` (00 §6.14) becomes `sessionKind: 'both'` too (M-3), with no other change.

### 6.5 `POST /auth/pin`, `POST /admin/auth` (changed, 00 §6.9, §6.6)

§3.5 checks before 00 §3.5 step 2. `/auth/pin` response adds `device: { screens, access, point_id }`. Statements unchanged (memory).

⚠️ Changed by v1.0.7 (B-2): on a board device both answer `403 DEVICE_ACCESS_DENIED { device_id, reason: 'display_device' }` first (§3.5, M-10). `POST /admin/recovery-link` (§6.11) answers the same on a board device.

### 6.6 `GET /queries/staff-roster` (changed, 00 §6.19)

`listed` device → only its people; `everyone` → the whole directory (unchanged). Query count unchanged (2).

⚠️ Changed by v1.0.7 (B-2): a board device → `403 DEVICE_ACCESS_DENIED { device_id, reason: 'display_device' }` before any statement (§3.5); `/staff/` follows it to `/board/`.

### 6.7 `GET /queries/session` (changed, 00 §6.20)

Adds `device: { device_id, screens, access, point_id }`. Each `permissions[p]` is the **view's** resolution (§3.3a), with `masked: 'listed_only' | 'downgraded'` when masked. The client hides `listed_only` and shows `downgraded` as "Confirm on your phone". Query count 0.

### 6.8 Device list `devices` (changed, 00 §6.17)

⚠️ Changed by v0.4 (M-3): `sessionKind: 'both'` (H-6), permission `manage-devices` (view).

Each row adds `access`, `people: [{ staff_id, display_name }]`, `screens`, `point_id`, `profile_version`, `needs_review` (from `device_profiles.needs_review`; M-12). `pairing_source` is dropped (m-3). The response adds `pending_requests: [{ request_id, device_name, hardware_hint, created_at }]` (never the code) and `admin_warning: 0 | 1 | null` (M-8: the count when it is 0 or 1, else null). ⚠️ Changed by v1.0.2 (G-f (a)): the response also adds `staff: [{ staff_id, display_name }]`, every directory person sorted by name, from the directory in memory (no statement), for the forms' people picker (§6.3).

Query count: today's 1–2, +1 for `device_profiles` ⋈ `device_people`, +1 for pending requests.

⚠️ Changed by v1.0.7 (B-1): rows add `board` (`{ voice }` or null); a board row's `active_session` is `{ kind: 'display', started_at }` (label "Pickup board", 00 v1.13 §8.2). Page group **Board** comes right after **Kitchen** (first match wins). Query count unchanged (`board_json` is a column of the `device_profiles` read).

⚠️ Changed by v0.4 (m-15): page groups, first match wins: **Waiting** (pending requests), **Kitchen** (kds), **Personal** (listed, one person), then by first screen: **Counter** (takeaway / cashier / parking), **Floor** (dine_in), **Pass**, **Back office** (manager). Hardware is an icon only. A **needs review** chip shows on flagged rows; any edit clears it.

### 6.9 Directory apply (changed, 00 `applyStaffDirectory` hook) ⚠️ Changed by v0.4 (M-7, m-6)

The removed staff's sessions, **staff and admin** (today's `endStaff` filter, `apply-directory.ts:426`; ⚠️ v0.5 (N-1)), end `'staff_removed'` first (today's order). Then, in the same apply transaction:
1. **1 statement:** `SELECT device_id, staff_id FROM device_people WHERE staff_id IN (<removed>)` (`device_people_staff`).
2. For each affected device:
   - **a list left non-empty** → `DeviceProfileSet { cause: 'directory', profile_version + 1, needs_review: false }` without them;
   - **phone hardware whose list is left empty** → the `RevokeDevice` path, `cause: 'owner_removed'`, whatever its list size was before (⚠️ Changed by v0.5 (N-9, O-17): was "whose list was exactly the removed person"; so a two-person phone whose people both leave in one apply is revoked, not opened to everyone);
   - **any other hardware whose list is left empty** → `DeviceProfileSet { cause: 'directory', profile_version + 1, access: 'everyone', staff_ids: [], needs_review: true }`.

⚠️ Changed by v0.5 (N-4): every directory `DeviceProfileSet` bumps `profile_version`, so an edit form opened before the sync gets `409 CONFIG_STALE` instead of re-adding the removed person.

The device's drawer shift, printer routes, device targets and point are untouched. Bounded: tens of devices, one append each.

### 6.10 Upgrade boot step (§5.3) ⚠️ Changed by v0.4 (M-12)

Runs at boot **after** the projection `catchUp` (so `device_profiles` is current) and before listen.

- **Reads:** 1 statement: `devices` LEFT JOIN `device_profiles`, unrevoked, non-kds, no profile.
- **Writes:** one `writer.run` appending one `DeviceProfileSet` per device, `profile_version: 1` (its first), carrying the device's `point_id` (⚠️ Changed by v0.5 (N-5)). `actor_id` null, `device_id 'hub'`, as other hub-written events (00 M72, 01d).
- **Idempotent:** a device with a profile is skipped, so a second boot appends nothing.

### 6.11 Admin recovery at zero admin devices ⚠️ Changed by v0.4 (B-2)

| | |
|---|---|
| Signal | `GET /admin/login-roster` (00 §6.13) adds `recovery_available: boolean` = M-8 count is 0 (memory, no statement). The hub admin home shows "No device can manage devices" and a **Recover admin access** button when it is true. ⚠️ Changed by v1.0.3 (G-g (a), owner 2026-11-23): the `403 listed_device_only` that `login-roster` returns on an `everyone` (or no-profile) device also carries `recovery_available` in its details, and the hub admin **sign-in** page shows the button when it is true, on any paired non-kds device |
| Route | `POST /admin/recovery-link`, auth as `/admin/login-roster` (device token of a paired non-kds device); no session. ⚠️ Changed by v0.5 (N-7): registered in the **`admin-device-public`** route group, like `/admin/auth` and `/admin/login-roster` (a plain `/admin/` route would need an admin session, `guards.ts:196-199, 239`) |
| Processing | count ≠ 0 → `403 PERMISSION_DENIED { reason: 'recovery_not_needed' }`. ⚠️ Changed by v0.5 (N-7, O-17): a live bootstrap token exists → `200 { already_issued_until }`, nothing written, so no device can keep expiring the owner's link. ⚠️ Changed by v0.5.1 (R-1): "live" = **any** row of `admin_bootstrap_tokens` with `consumed_at IS NULL AND expires_at > branchNow` (was "a live `recovery` token": the table has no issued-by column, only the event has it). Any live link signs in the same way, so it is the right answer whoever issued it; `already_issued_until` = its `expires_at`. No migration. Else `writer.run(tx ⇒ issueAdminBootstrap(tx, 'recovery', deps, callerDeviceId))` (⚠️ v0.5.1 (R-2)) (M72: expires every live bootstrap token, new single-use 30-min token, `AdminBootstrapTokenIssued` v2 with `device_id` = **the caller's device**, so the audit shows where the link was taken). Statements: 1 read of live bootstrap tokens (⚠️ v0.5.1 (R-1)) + the `issueAdminBootstrap` transaction |
| Response | `{ first_admin_url, expires_at }` on issue, or `{ already_issued_until }`; the page shows the link as a QR (as setup does, M42), or "A recovery link was already made — it works until <time>" |
| Security | the link is the existing bootstrap path: it still needs a staff member, their PIN and `access-hub-admin`, with failures counted per IP (M42). No new sign-in path. A second press while the link is live returns its expiry, never a new link (N-7) |
| Statements | 1 transaction of `issueAdminBootstrap` |

---

### 6.12 `GET /queries/pickup-board` (new) ⚠️ Changed by v1.0.7 (B-4)

| | |
|---|---|
| Registration | `defineQuery({ resource: 'pickup-board', sessionKind: 'device', session: 'required', allowDisplay: true })`: a `display` session (the board) or any `staff` session (a preview; no permission: tokens only, A-8). A `station` session, no session, or another device's session → `401 SESSION_INVALID` (00 §3.9) |
| Input | none |
| Response | `200 { data: PickupBoardView }` (below) |
| Statements | **2** (⚠️ Changed by v1.0.7 hostile run 1 (B-1): 02b v1.0.25 §4.2's count): `takeawayProgress(db, state, { open_day: true })` (row Q-1); 0 for the engine promise, the profile and the derivation (memory). Fixed whatever the number of orders |
| Errors | G-dev (`401 DEVICE_TOKEN_INVALID`, `403 DEVICE_REVOKED`, `403 GUEST_NETWORK_FORBIDDEN`, `426`), `401 SESSION_INVALID` / `SESSION_EXPIRED` |
| Catch-up | the display part `pickup_board` (§6.13) is this body |
| Audiences | none: the board learns of changes from display hints (§6.13) |

```ts
PickupBoardView = {                       // Zod .strict(): no other key can appear
  business_date: string | null;            // the open day; null → both lists empty
  voice: 'off' | 'en' | null;   // the calling device's board setting (memory); null on a non-board device (OR-1: English only)
  ready: Array<{ token: number; state: 'ready' | 'part' | 'pay'; ready_at: number }>;
  preparing: Array<{ token: number; eta_ms: number | null; pickup_at_ms: number | null }>;
}
```

Derivation, sort and the tokens-only rule: §3.11.

### 6.13 Display catch-up part and display hints (new) ⚠️ Changed by v1.0.7 (B-5)

- **Catch-up part** `registerDisplayCatchUp({ part: 'pickup_board', build })`: `build` returns the §6.12 body for the socket's device (2 statements; the whole display `catch_up` is 3 with 00's `hub` part, ⚠️ Changed by v1.0.7 hostile run 1 (m-1)). Display sockets only (00 v1.13 §6.21); never on a staff or station socket.
- **Hints** `registerDisplayHint(eventType, fn)` for:

| Event types | `order_ids` |
|---|---|
| `order` stream: `OrderPlaced`, `OrderLinesAdded`, `ItemAdded`, `ItemDone`, `ItemDoneUndone`, `ItemMovedToStock`, `ItemRemoved`, `ItemVoided`, `ItemServed`, `ItemReturned`, `ReadyToServe`, `ReadyToServeUndone`, `Handover`, `OrderCancelled`, `OrderBoosted`, `ItemsReleased`, `LinePrioritized` | `[event.stream_id]` (the order id) |
| `OrdersBilled`, `OrdersUnbilled` | `payload.order_ids` |
| `hub` stream: `BusinessDayOpened`, `BusinessDayClosed`, `OrdersCarriedOver`, `DeviceProfileSet` | `[]` (re-read everything) |

- A hint for an order that is not a takeaway costs the board one re-read: accepted (a filter would need an order-type map; the board debounces, §8). Engine re-plans that move a promise without one of these events are picked up by the board's 60 s re-read (§8).
- 0 statements; ids only (R3).

## §7. Cross-cutting

No new timer, cache, job or dependency. Every check reads the in-memory `deviceProfile` map and the directory, refreshed on commit (YAGNI: tens of devices per branch). The `device_waiting` close on expiry rides the existing session sweeper.

⚠️ Changed by v1.0.7 (B-4–B-6): still none on the hub. The board's debounce and its 60 s re-read are client timers. Static assets: the voice clips (⚠️ Changed by v1.0.7 hostile run 1 (m-5, m-6); ⚠️ Changed by v1.0.7 owner review (OR-1): **31** small MP3 files, ≈ 160 KB) ship in the new `board` entry of `apps/client` (`apps/client/board/`, a `board` key in `vite.config.ts` `ENTRIES`; new folder, owner decision OD-6), served by the hub like every client entry once `lib/client-dist.ts` `TYPES` maps `.mp3` to `audio/mpeg` (00 v1.13 §7.10). Load: ≤ 2 boards per branch, each ≤ 1 re-read per second in a rush (2 statements each).

## §8. Client contract

- **Pair page:** one flow for every device: big code + QR, "Ask someone with hub access to approve this screen". iOS keeps "Add to Home Screen" first, then the request from the home-screen app (00 §8.2 rule 2, now for the request).
- ⚠️ Changed by v0.4 (m-2): **Capacitor app (9b, future: no app code exists yet).** 9b shows the request code from `POST /pair/requests` with `hardware_hint: 'tablet'`. It must learn the hub address without a token QR (typed, or a QR of the hub address shown by setup or the admin home). 9b specifies how. ⚠️ Changed by 05b (row A-1): **05b** builds it: the hub address is **typed** as `host:port` on the app's first-run page and checked natively (05b M-16); a QR of the hub address is deferred (05b §12.3).
- **Approve form:** in `/staff/` (`#/devices`, M-3) on a listed device, opened from the `device_waiting` notice or the device list; `/admin/approve` stays for the bootstrap admin. ⚠️ Changed by v0.4 (m-1): the QR fills the request (`r`); **the display code is always typed** (the M44 proof), never prefilled.
- **Device list and edit form:** `#/devices` in `/staff/` and `/admin#devices`, the same query (§6.8) and commands (§6.3, §6.4, `RevokeDevice`); the Kitchen screens page links to the edit form (K-2).
- **Staff shell (C-1):** tabs from `screens`; inbox, requests, shift, Me, sign out in the top bar (M-7); redraw on `device_profile`. Items come from the profile and the masked permissions only; width picks the layout only.
- ⚠️ Changed by v0.4 (M-11): **deep links (01d §3.13)** to a place whose screen the device does not have (`#/tables/…` without `dine_in`, `#/orders/…` without `takeaway` / `parking`, `#/pass` without `pass`) **fall back to the inbox** with the alert selected (`#/inbox?focus=alert:<id>`), with a toast "Open this on a device with <screen>". Deep links only ever target the 01d §3.13.5 routes, so no other fallback is needed.
- **Answer sheet (01d):** no "Approve here" (in-person) path; on an `everyone` device a money card shows "Approve on a listed device" with no Approve button. A downgraded request shows "Confirm on your phone" to the requester at the counter, and the answer sheet on their phone.
- **Errors:** `DEVICE_ACCESS_DENIED` and `DEVICE_NOT_OWNED` → "This device is not set up for you"; `PERMISSION_DENIED { reason: 'listed_device_only' }` → "Do this on your own phone"; `DEVICE_ACCESS_SELF` → "You would lose access on this device".

- ⚠️ Changed by v1.0.7 (B-6): **Pickup board `/board/`** (a new `apps/client` entry `board`; frames Board, BoardCall, BoardRush, BoardEmpty, BoardOffline; 1920×1080, bilingual EN + UR on every frame, digits LTR):
  - **Start:** page meta as `/kds/` (00 v1.13 §8.2). The device token from IndexedDB `pos-device` (none → `/pair`). `POST /auth/display` → session token in memory only (a reload makes a new session, which replaces the old one). `/ws` `auth` with it → `catch_up.pickup_board` renders.
  - **Refresh:** on `display_hint`, re-read `GET /queries/pickup-board`, debounced (1 s trailing, at most 3 s after the first hint); also every 60 s. `voice` comes with each read.
  - **Layout:** Ready (green, 104 px tokens; `pay` → "Pay at counter / کاؤنٹر پر ادائیگی", `part` → "Part ready / کچھ تیار") and Preparing (token + "~1:42 PM" from `eta_ms`, or the pickup time with a clock icon from `pickup_at_ms`). Rush (BoardRush): ≤ 24 Ready, oldest first; ≤ 16 Preparing + "+N more"; no scrolling. Empty (BoardEmpty): a welcome in English and Urdu.
  - **Call-out (BoardCall):** a token that **enters Ready** (any state) and was not called before in this business day → tile flash and banner 3 s, then the **chime**, then the voice per `voice` (⚠️ Changed by v1.0.7 owner review (OR-1)): `en` = "token number" then the composed number (below); `off` = no sound (flash and banner still). One call at a time, FIFO, 1 s gap, at most 5 waiting (older ones lose the voice, keep the flash). Called tokens are kept per `business_date` in memory and `localStorage` (`pos-board-called`, try/catch), so a reload never calls again; the **first** list after a load or a reconnect calls nothing (only a diff from a list already shown calls).
  - **Voice clips (G-9; no TTS, offline on the LAN; ⚠️ Changed by v1.0.7 hostile run 1 (m-5, m-6); ⚠️ Changed by v1.0.7 owner review (OR-1): English only, composed numbers):** static files in the entry's public folder **`apps/client/board/public/voice/`** (Vite's root is the entry folder), **31 files**, mono MP3, ≈ 5 KB each (≈ 160 KB): `chime.mp3`, `token.mp3` ("token number"), `1.mp3` … `19.mp3`, `20.mp3`, `30.mp3` … `90.mp3`, `hundred.mp3`, `thousand.mp3`. **Composer** `tokenClips(n)` (pure, client): for 1 ≤ n ≤ 2000 — thousands `t = ⌊n / 1000⌋` → `<t>`, `thousand`; hundreds `h = ⌊(n mod 1000) / 100⌋` → `<h>`, `hundred`; rest `r = n mod 100`: `r` in 1–19 → `<r>`; else `<tens>` then `<units>` if units > 0; no "and". So 257 → `2 hundred 50 7`, 1000 → `1 thousand`, 1015 → `1 thousand 15`, 2000 → `2 thousand`. The call plays `chime`, `token`, then the pieces in order through one `HTMLAudioElement` (each piece starts on the previous one's `ended`); all 31 clips are loaded at start (they are small). A token outside 1–2000 or any clip that fails to load → chime and banner only (no half-spoken number). The old clip files ~~`ur/…`, `en/1.mp3` … `en/300.mp3`~~ are not made. Producing the clips: OQ-B3. Sound without a tap: the kiosk PC's browser starts with `--autoplay-policy=no-user-gesture-required` (installer flag, beside the kiosk flags, Foundation D56).
  - **Offline (BoardOffline):** socket down or a read fails → keep the last lists with "Updating… / اپ ڈیٹ ہو رہا ہے"; after **30 s** without the hub the Ready column greys and no call-out plays; nothing moves into Ready without a fresh read ("never shows a wrong Ready").
  - **Session:** 00 v1.13 §8.4 rows: `replaced` → stop screen with "Use this window"; other `4401` / `401` → `POST /auth/display` again after the backoff; `DISPLAY_NOT_ENABLED` → `/staff/`; `DEVICE_REVOKED` → pair again. The board opens **no** alert-mode socket.
  - **No controls on the TV:** voice is set in the device edit form (§6.3 form, §6.4).
- ⚠️ Changed by v1.0.7 (B-2): **Staff shell:** `/staff/` sign-in on `403 DEVICE_ACCESS_DENIED { reason: 'display_device' }` goes to `/board/` (no error text). ⚠️ Changed by v1.0.7 hostile run 1 (m-10, m-11): it reads `reason` **before** choosing any text (a `DEVICE_ACCESS_DENIED` without a reason keeps "This device is not set up for you"), and before leaving it sends its IndexedDB command queue under the queued session token (02b §3.12: accepted while the session's end is within `queue_auto_send_max_ms`), showing "Sending N waiting orders…"; commands that fail stay in the queue log and the page shows "N orders not sent — open on another counter" before opening `/board/`. The device edit form warns "This counter has unsent orders" when the device's last `/staff/` load reported a non-empty queue (client memory of the edit form's own device list, no hub field).
- ⚠️ Changed by v1.0.7 hostile run 1 (m-9): **Board retries:** `POST /auth/display` retries back off 5 s → 60 s; after 10 failed rounds the board shows "Board needs attention" (00 v1.13 §8.4).

## §9. Error catalogue additions

| Code | Status | Details |
|---|---|---|
| `DEVICE_ACCESS_DENIED` | 403 | `{ device_id }`; returned instead of `DEVICE_NOT_OWNED` (§3.5) |
| `DEVICE_ACCESS_SELF` | 422 | `{ device_id }`. A business rule on the editor's own device, independent of concurrent edits (those give `CONFIG_STALE`). ⚠️ Changed by v0.4 (m-7) |
| `PERMISSION_DENIED` reasons `listed_device_only`, `in_person_removed`, `recovery_not_needed` | 403 | existing code, new reasons |
| `DEVICE_ACCESS_DENIED` reason `display_device` (⚠️ Changed by v1.0.7 (B-2)) | 403 | `{ device_id, reason: 'display_device' }` (additive `reason`; without it the code means §3.5's listed check): staff sign-in, roster or recovery link on a board device (M-10). ⚠️ Changed by v1.0.7 hostile run 1 (m-11): clients branch on `reason` first (test 48); a dedicated code `DISPLAY_DEVICE` (403) instead is owner decision OQ-B8. `DISPLAY_NOT_ENABLED` (403) is 00 v1.13's (§9), returned by `POST /auth/display` on a device that is not a board |

Appended to Foundation §6.2 (row F-1) and `@pos/domain/src/errors.ts` (§11 step 1). ⚠️ Changed by v0.4 (m-8)

## §10. Tests

⚠️ Changed by v0.4 (M-13): renumbered and extended.

| # | Case |
|---|---|
| 1 | phone, tablet, kiosk and kds pair through `/pair/requests` + approve; the token routes answer `404 ROUTE_NOT_FOUND` |
| 2 | wrong display code → `404`, nothing written; a request id from the QR with no code → `400` |
| 3 | Bilal's correct PIN on Ali's listed phone → `403 DEVICE_ACCESS_DENIED`; no counter changed; argon2 not called; `staff-roster` on the phone lists only Ali |
| 4 | **resolver:** on an `everyone` device the session view returns `not_granted / listed_only` for each `LISTED_ONLY_PERMISSIONS` entry granted `allowed`, `requires_approval / downgraded` for each `MONEY_PERMISSIONS` entry granted `allowed`, everything else unchanged; on a listed device and in a bootstrap session nothing is masked; another staff id is never masked |
| 4a | call site **pipeline:** `ApprovePairingRequest` from an `everyone` device → `403 listed_device_only` |
| 4b | call site **check inside a handler:** the fiscal query's own `manage-fiscal-settings` check (`fiscal/credentials.ts:91`) and the printer route's `manage-devices` check (`print/routes.ts:111`) on an `everyone` device → `403` with their existing details (⚠️ v0.5 (N-6): no `reason` asserted) |
| 4c | call site **query:** the audit query (`audit/queries.ts:105`) on an `everyone` device → `403` (existing details) |
| 4d | call site **admin guard:** an admin session bound to a device switched to `everyone` is ended (`'forced'`); a racing `/admin/queries/devices` before the end → `403` |
| 4e | call site **`/admin/auth`** on an `everyone` device → `403 listed_device_only`, no PIN verified, no counter |
| 4f | call site **`AnswerRequest`:** a void answer on an `everyone` device → `403 listed_device_only` from `preRead`; argon2 not called; counters unchanged |
| 4g | `GET /queries/session` reports `masked` per §6.7 |
| 5 | the same manager on their listed phone answers the void |
| 6 | floor tablet listed [floor manager, waiter]: floor manager answers a void there (accepted risk §3.4) |
| 7 | a cashier on an `everyone` counter raises a void request: it is raised, rings the manager's **listed** phone, and does not ring the manager's `everyone` tablet session; `requests-to-answer` there omits it |
| 7a | approvers reachable only on `everyone` devices → the request escalates as unreachable (§3.9 rule 3) |
| 7b | a cashier's `ReopenBill` with `requires_approval` on an `everyone` counter raises the request |
| 7c | counter work on an `everyone` kiosk: a manager closes and counts another cashier's shift, removes another cashier's payment, opens the drawer, records petty cash, prints a Z report, closes the day — all succeed |
| 8 | `in_person` answer → `403 in_person_removed`, before argon2 |
| 9 | `SetDeviceProfile` removing the signed-in person ends the session `'forced'` and pushes `device_profile`; ⚠️ v0.5 (N-1): a removed person's **admin** session bound to the still-listed device is ended too, and their next `/admin/queries/devices` gets `401` |
| 10 | two admins edit one device → the second gets `409 CONFIG_STALE { device_id, profile_version }` |
| 11 | an admin removing themself from the device they are on → `422 DEVICE_ACCESS_SELF`; switching it to `everyone` → `422`; switching **another** device to `everyone` ends that device's admin sessions |
| 12 | directory removal: dropped from every list in one read; their staff and admin sessions end (N-1); a **phone** left empty → revoked `owner_removed`, also a two-person phone whose people both leave in one apply (N-9); every profile event bumps `profile_version` (N-4); a one-person **kiosk** with an open drawer shift → `everyone`, `needs_review`, shift still open and payable; a listed Pass tablet emptied → `everyone`, its Pass still works |
| 13 | `pass` without `point_id` → `400`; `cashier` on a phone → `400` |
| 14 | replay rebuilds `device_profiles` / `device_people` exactly, including `needs_review` |
| 14a | bindings: a one-person listed tablet binds its person permanently; edit 1 → 2 people drops the permanent row and the next sign-in binds (tablet rule); 2 → `everyone` on a phone follows the tablet rule; → 1 person binds permanently again; a one-person kiosk binds permanently and routes; `reset` + replay gives the same rows |
| 14b | replay of an old phone: bound to `DevicePaired.owner_staff_id` until its upgrade `DeviceProfileSet`, then by the profile |
| 15 | upgrade: a kiosk or phone with a `point_id` gets `pass` first and keeps its `point_id` (N-5); Test alert, printer and Kitchen screens setup are refused on an upgraded kiosk / tablet and work from a listed device (N-2); a phone becomes `listed` [owner]; a kiosk becomes `everyone` with its five screens; a tablet keeps `manager`; every action visible before the upgrade per hardware is visible after, except §5.3's list; events have `actor_id` null and `device_id 'hub'`; second boot appends nothing |
| 16 | admin warning: 0 listed admin devices → `admin_warning: 0`, `recovery_available: true`; 1 → `1`; 2 → `null` |
| 16a | recovery: `POST /admin/recovery-link` at 0 issues a bootstrap token (`issued_by: 'recovery'`, `device_id` = caller), the link signs in with PIN, the owner approves their phone; a second press while it is live → `200 { already_issued_until }` and the first link still works (N-7); the route needs no admin session (`admin-device-public`); at ≥ 1 → `403 recovery_not_needed` |
| 17a | ⚠️ v0.5 (N-3): the manager's only listed device (a phone) is not connected → the downgraded void is raised `holders` of `approve-void`; another manager answers it on a listed device; the requester cannot (`self`) |
| 17 | downgrade with a listed device **connected now**: a manager's direct void on an `everyone` kiosk raises a `named` request to themself; it rings only their listed phone; they approve it there with their PIN (rule 5 skipped); answering it from the kiosk → `403 listed_device_only` |
| 18 | downgrade with no listed device: the request is `holders` of `approve-void`; another manager answers on a listed device; the requester cannot (`self`) |
| 19 | downgraded discount, comp and reopen follow tests 17–18 (holders of `apply-discount`, `apply-comp`, `reopen-bill`) |
| 20 | a queued manager command replayed after the device became `everyone` is masked (fail-closed) |
| 21 | `device_waiting`: one notice for two requests; never the code; closed `done` when the last is approved; closed `obsolete` by the sweeper when the last expires; delivered only to listed devices; link opens `#/devices` |
| 22 | a phone with `pass` + `point_id` receives `ready_to_serve`, is in `always_on`, and is listed in `kds-config.pass_tablets` |
| 23 | deep link to `#/tables/…` on a device without `dine_in` → inbox with the alert selected |
| 24 | `ApprovePairingRequest` on `/commands` from a listed staff session with `manage-devices` and no `access-hub-admin` → `200`; the bootstrap admin session approves on `/admin/commands` |
| 25 | `hardware_hint` outside the four values → `400` |
| 26 | takeover between two listed people works; an unlisted person gets `403 DEVICE_ACCESS_DENIED` before any takeover |
| 27 | audit: `DeviceProfileSet` writes a `device_profile_set` row with the editor as actor |
| 28 | ⚠️ v0.5 (N-8): on an `everyone` kiosk a manager closes another cashier's shift with a variance; the variance sign-off is raised and is answered from a listed device, never from the kiosk |
| 29 | ⚠️ v0.5 (N-11): rebuilding the projections replays `DeviceRoleSet` (lane only) and `DeviceProfileSet` (point); `devices.point_id` ends equal to the last `DeviceProfileSet`, whatever the replay order |
| 30 | ⚠️ Changed by v1.0.7 (B-1): approving a request with `device_type: 'cashier_kiosk'`, `screens: ['board']`, no `board` → profile `everyone`, no people, `board: { voice: 'en' }` (⚠️ Changed by v1.0.7 owner review (OR-1)); `DeviceProfileSet` v2; ⚠️ Changed by v1.0.7 hostile run 1 (M-2): the same on a `tablet` → `400 { field: 'screens' }` |
| 31 | board rules: `['board', 'takeaway']` → `400 { field: 'screens' }`; `board` on a `phone` → `400 screens`; `listed` + board → `400 access`; `point_id` + board → `400 point_id`; `board` settings without the screen → `400 board`; an unknown voice → `400`; ⚠️ Changed by v1.0.7 owner review (OR-1): `voice: 'ur_en'` or `'ur'` → `400 { field: 'board' }` |
| 32 | `SetDeviceProfile` kiosk → board: its staff and admin sessions end `forced`, sockets `4401`; board → `takeaway` + `cashier`: its display session ends `forced`, display socket `4401` with zero frames; voice change only: no session ends, the board gets one `display_hint { order_ids: [] }` and its next read has the new `voice`; a sent `staff_ids` with board → `400` |
| 33 | self-guard: an admin turning the device their session is on into the board → `422 DEVICE_ACCESS_SELF` |
| 34 | on a board device `POST /auth/pin`, `POST /admin/auth`, `GET /admin/login-roster`, `GET /queries/staff-roster`, `POST /admin/recovery-link` → `403 DEVICE_ACCESS_DENIED { reason: 'display_device' }`; argon2 not called; no counter changed; 0 statements |
| 35 | `DeviceProfileSet` v1 events upcast to `board: null`; `reset` + replay rebuilds `device_profiles.board_json` exactly; the upgrade step never makes a board; a directory apply leaves a board untouched |
| 36 | §3.11 table: (a) all cooking → Preparing, `eta_ms` = engine promise; (b) one of two lines ready, paid → Ready `part`; (c) all ready, paid → `ready`; (d) any ready, unbilled → `pay`; (e) all served → absent; (f) cancelled → absent; (g) an addition with the root's token → one entry, an unbilled addition after a closed bill → `pay`; (h) an order of ready items only → Ready at once; (i) dine-in and parking orders absent; (j) an order of an earlier business date absent; (k) no open day → `business_date: null`, empty lists; (l) `pickup_at_ms` orders sorted by pickup time; Ready sorted oldest first |
| 37 | `pickup-board` runs 2 statements with 1 and with 200 open takeaway orders (statement counter; no N+1), with the real 02b export (⚠️ Changed by v1.0.7 hostile run 1 (B-1)) |
| 38 | the response matches `PickupBoardView` `.strict()`: no name, phone, items, amounts or notes, also when `OrderContactSet` set a name and phone |
| 39 | access: a display session → 200 with its `voice`; a staff session → 200 with `voice: null`; a station session → `401 SESSION_INVALID`; no session → `401` |
| 40 | §6.13: a display socket's `catch_up.pickup_board` equals the query body; `OrderPlaced`, `ReadyToServe`, `ItemServed`, `Handover` → one hint each with the order id; `OrdersBilled` → its `order_ids`; `BusinessDayClosed`, `DeviceProfileSet` → `[]`; a batch with only `OrderContactSet` → no hint |
| 41 | client (fake timers): 10 hints within 1 s → 1 re-read; a steady stream → at least one re-read every 3 s; a 60 s re-read without hints |
| 42 | client call-out (⚠️ Changed by v1.0.7 owner review (OR-1)): token 12 entering Ready → flash, then `chime`, `token`, `12` in order; `voice: 'off'` → flash and banner only; `part` → `ready` for the same token → no second call; reload → no call for tokens called today; the first list after a reconnect → no call; token 2001 → chime only; a missing clip → chime only, no partial number; 7 tokens at once → 5 voiced, all flashed |
| 43 | client offline: socket drop → "Updating…" and the last lists; at 30 s Ready greys and no call plays; recovery → a fresh read, no call for tokens that became ready while offline and are already in the list |
| 44 | client: `replaced` → stop screen and "Use this window"; `DISPLAY_NOT_ENABLED` → `/staff/`; `/staff/` with `display_device` → `/board/`; no alert-mode socket is opened by `/board/` |
| 45 | ⚠️ Changed by v1.0.7 hostile run 1 (M-2): `SetDeviceProfile` kiosk → board closes the kiosk's open alert-mode socket ~~`4403`~~ `4413` (⚠️ Changed by v1.0.7 (integration, 02b-TK)) `display_device` after commit, the kiosk's device token still valid; with 01d v1.3.7 D-5 the board is in no `alert_recipients` row of an `always_on` alert raised afterwards |
| 46 | ⚠️ Changed by v1.0.7 hostile run 1 (B-1): §3.11 on a pickup order: a no-station drink line is not ready before `pickup_at_ms` (02b's hold), the group stays in Preparing; at the pickup it counts as ready |
| 47 | ⚠️ Changed by v1.0.7 hostile run 1 (m-10, client): a kiosk with 3 queued commands switched to the board → `/staff/` sends them before opening `/board/`; one that fails stays in the queue log and the notice shows |
| 48 | ⚠️ Changed by v1.0.7 hostile run 1 (m-11, client): `DEVICE_ACCESS_DENIED` with `reason: 'display_device'` → `/board/`, without a reason → "This device is not set up for you" |
| 49 | ⚠️ Changed by v1.0.7 hostile run 1 (m-6, client); ⚠️ Changed by v1.0.7 owner review (OR-1): `tokenClips` (pure unit test): 1 → `[1]`; 19 → `[19]`; 20 → `[20]`; 21 → `[20, 1]`; 100 → `[1, hundred]`; 101 → `[1, hundred, 1]`; 257 → `[2, hundred, 50, 7]`; 999 → `[9, hundred, 90, 9]`; 1000 → `[1, thousand]`; 1015 → `[1, thousand, 15]`; 1999 → `[1, thousand, 9, hundred, 90, 9]`; 2000 → `[2, thousand]`; 0 and 2001 → `null`; every piece returned for 1–2000 is one of the 31 file names |
| 51 | ⚠️ Changed by v1.0.7 owner review (OR-1) (client): the built `board` entry ships exactly the 31 clip files of §8 under `voice/` (no `ur/` folder); the hub serves `voice/token.mp3` as `audio/mpeg` |
| 52 | ⚠️ Changed by v1.0.7 owner review (L-1, OR-7): a Manager's session on an `everyone` kiosk resolves `hand-over-unpaid` to `not_granted / listed_only`; `AnswerRequest` approve of a `hand_over_unpaid` request from there → `403 PERMISSION_DENIED { reason: 'listed_device_only' }`; the same Manager on their listed phone → approved |
| 50 | ⚠️ Changed by v1.0.7 hostile run 1 (m-14 f): a profile switch away from the board while the display socket's `catch_up` is being built → the socket closes `4401` after the `catch_up` frame and no hint follows |

## §11. Build order

1. `@pos/domain`: `SCREEN_KEYS`, `screensOffered`, `LISTED_ONLY_PERMISSIONS`, `MONEY_PERMISSIONS`; `errors.ts` (`DEVICE_ACCESS_DENIED`, `DEVICE_ACCESS_SELF`); audit action `device_profile_set`. `@pos/events`: `DeviceProfileSet` v1, `AdminBootstrapTokenIssued` v2. [§3.3, §3.6, §4.2, §9]
2. Migration `0027` with the `devices` rebuild; projections; `deviceProfile` memory. [§5]
3. The session view `forSession` and its call sites (pipeline, queries, admin guard, PIN hooks); `/queries/session`. [§3.3a, H-3]
4. Pairing (§6.1–§6.3) on both routes; remove token routes. [H-1, M-3] ⚠️ Changed by v0.5 (check §3): first replace the token-based pairing in the hub int tests with a request-based fixture (`test/commands/generate-pairing-token.int.test.ts`, `test/auth/pairing.int.test.ts`, `test/admin/admin-page.int.test.ts`, and the token use in the `log-redaction`, `cors`, `guards`, `provision`, `restore` int tests). Then remove the STAB-1 **Add a tablet** pieces **in the same commit** that makes `ApprovePairingRequest` accept `tablet` and `phone` (today `approve-pairing-request.ts:15-20` accepts `cashier_kiosk | kds` only), so a tablet is pairable at every commit.
5. Sign-in and roster (§6.5, §6.6, login-roster). [H-2]
6. `SetDeviceProfile` (§6.4), `RevokeDevice` both routes; device list (§6.8, H-6); directory apply (§6.9). [H-4]
7. 01d D-1–D-4 (bindings, §3.9 money rules, `device_waiting`); 03b K-1, K-2.
8. Upgrade boot step (§6.10); admin recovery (§6.11). [H-7]
9. Client: pair page, approve form, device list page, shell tabs (C-1), deep-link fallback, answer sheet. [§8, C-1, K-2]
10. ⚠️ Changed by v1.0.7 (B-1, B-2): `@pos/domain` `SCREEN_KEYS` + `board`, `screensOffered`, `BOARD_VOICES`, `isBoard`; `@pos/events` `DeviceProfileSet` v2 + upcaster, `PickupBoardView`. [§3.6, §4.2]
11. Migration `00NN_device_profiles_board.sql` (its own file, numbered at merge; ⚠️ Changed by v1.0.7 hostile run 1 (m-4)); the fold writes `board_json`. [§5.4]
12. Approve and `SetDeviceProfile` board rules, self-guard (c), session ends; the M-10 refusals. [§3.5, §6.3–§6.6, §6.8]
13. After 02b v1.0.25's `takeawayProgress` and 00 v1.13's display session and WS display mode: `pickup-board`, the `pickup_board` catch-up part, the hints. [§3.11, §6.12, §6.13]
14. Client: `/board/` entry (`apps/client/board/`, `ENTRIES` key; OD-6) and the 31 English voice pieces with `tokenClips` (⚠️ Changed by v1.0.7 owner review (OR-1)); approve / edit form board choice; `/staff/` queue flush and redirect; retry cap. [§8] (⚠️ Changed by v1.0.7 hostile run 1)

## §12. Done, open questions, deferred

### 12.1 Definition of Done

Every §10 test green in the normal gate. A manual check on a tablet, a kiosk PC, a KDS screen and an Android + iPhone phone covers: pair, sign in, refused PIN, live tab change, "Confirm on your phone", recovery link. ⚠️ Changed by v1.0.7 (B-6): plus, on the pilot TV (a kiosk PC in Chrome / Edge kiosk mode; run 1 M-2): turn a device into the board, a token called out in English (⚠️ OR-1: a three-digit and a four-digit token, e.g. 257 and 1015, sound right) after a Pass "Bag ready", "Pay at counter" on an unpaid order, unplug the hub network for 60 s (BoardOffline), and the voice switched Off from a phone. 00 / 01d / 03b / 04 are bumped with "Changed by 05a" markers, and F §6.2 is appended.

### 12.3 Open questions

| # | Question | Rec |
|---|---|---|
| OQ-1 | `close-business-day` and `view-reports` stay usable on `everyone` devices (counter)? | Yes (owner OQ-3, O-11) |
| OQ-2 | Up to 20 people on a listed device enough? | Yes |
| A-1 **[ASSUMPTION]** | `remove-comp`, `remove-service-charge` and `close-without-buyer-id` are not money-downgraded (the owner's M-1 list names five permissions) | Keep as ruled; add later if wanted |
| A-2 **[ASSUMPTION]** | With no listed device, a downgraded request goes to holders of the kind's `range_permission`, else its `base_permission` (§3.9 rule 1b) | The simplest "normal approvers" for a grant that has no approver roles |
| A-3 **[ASSUMPTION]** | No hard "last admin device" refusal; the M-8 warning and the recovery link cover it (M-6 asked only for the self-guard) | Keep |
| A-4 **[ASSUMPTION]** | After a profile edit away from one person, a still-open session stays unbound until its next sign-in (§3.8) | Keeps the binding projection free of session reads |
| A-5 **[ASSUMPTION]** | `device_waiting` carries no count ("update" writes nothing) | The device list shows the count |
| A-6 **[ASSUMPTION]** | `DEVICE_ACCESS_SELF` stays `422` as the owner's M-6 ruling names it (review m-7 offered `409`) | Keep |
| A-7 **[ASSUMPTION]** | `kiosk_home` is retired; its content is the `takeaway` screen | Confirm on the kiosk at the manual check |
| OQ-B1 | ⚠️ Changed by v1.0.7: a board only on a kiosk PC (not a phone; ⚠️ Changed by v1.0.7 hostile run 1 (M-2): not a tablet in the pilot)? | Yes |
| OQ-B2 | ⚠️ Changed by v1.0.7: voice default ~~`ur_en` and the Urdu words "ٹوکن نمبر"~~ before the number (Q4)? ⚠️ Changed by v1.0.7 owner review (OR-1): **ANSWERED** — default `en`, "token number" before the number | English; owner checks the recordings |
| OQ-B3 | ⚠️ Changed by v1.0.7; ⚠️ Changed by v1.0.7 hostile run 1 (m-6); ⚠️ Changed by v1.0.7 owner review (OR-1): **ANSWERED (owner 2026-11-24).** ~~≈ 600 clips 1–300 in Urdu and English~~ → **31 English pieces** (chime, "token number", 1–19, 20–90 by tens, "hundred", "thousand"), composed so every token 1–2000 is spoken | Render once with an offline voice tool (one voice for all 31 pieces so the joins sound even), owner listens to a sample of composed tokens; a token outside 1–2000 plays the chime only |
| OQ-B4 | ⚠️ Changed by v1.0.7: orders carried over from an earlier business date are not on the board (§3.11) | Accept (rare; the counter queue still shows them) |
| OQ-B5 | ⚠️ Changed by v1.0.7: an unpaid order with some items ready shows "Pay at counter", not "Part ready" (§3.11) | Accept (the customer must come to the counter anyway) |
| OQ-B6 | ⚠️ Changed by v1.0.7: Ready greys after 30 s without the hub (BoardOffline) | Accept |
| OQ-B7 | ⚠️ Changed by v1.0.7; ⚠️ Changed by v1.0.7 hostile run 1 (M-2, m-12): **BLOCKER-for-approval (00 OD-2).** A tablet board? | **Deferred**: pilot boards are kiosk PCs in Chrome / Edge kiosk mode, so no 05b bump and R33 is untouched; a later tablet board keeps the 05b app in lock-task mode with its AlertService off for a board and the shell loading `/board/` (a 05b bump then) |
| A-8 **[ASSUMPTION]** | ⚠️ Changed by v1.0.7: any staff session may read `pickup-board` (preview, tokens only) without a permission | Keeps the query simple; no data beyond the TV's |
| OQ-B8 | ⚠️ Changed by v1.0.7 hostile run 1 (m-11): **BLOCKER-for-approval (00 OD-8).** Keep `DEVICE_ACCESS_DENIED` + `reason: 'display_device'`, or a new 403 code `DISPLAY_DEVICE`? | Keep, with clients branching on `reason` first (test 48) |
| OQ-B9 | ⚠️ Changed by v1.0.7 hostile run 1 (m-10): turning a counter kiosk into the board while it holds unsent orders: the `/staff/` flush (§8) sends them first; ones that fail stay in the kiosk's queue log | Accept; switch boards outside service |
| OD-1 (00) | ⚠️ Changed by v1.0.7 hostile run 1 (B-1): **BLOCKER-for-approval.** Line readiness is 02b v1.0.25 §4.2's rule (engine `done` counts even where the point has a Pass) | Keep 02b's rule |

### 12.4 Deferred until needed

Sign-in alert with "Not me"; shuffled PIN pad on shared devices; PIN only while on shift (05 shifts + 01d presence); staff NFC card + PIN; "add me to this device" request; Delivery screen (with 02b delivery); ~~customer pickup board~~ (⚠️ Changed by v1.0.7 (B-1): now in scope, §3.6, §3.11, §6.12, §8); screens enforced on the hub; a board showing ads or the menu; more than one board layout; 6-digit PINs for some roles; the Capacitor app (9b).
