# Open questions — everything still left (2026-10-26)

One list of every question that is not closed yet, gathered from:
- `docs/design/open-questions/00-hub-platform.md` (00 Q…)
- `docs/design/open-questions/01a-setup.md` (01a Q…)
- `docs/specs/00_Hub_Platform_Access_Spec_v1.4.md` §12.3 (MQ…)
- `docs/specs/01_Restaurant_Setup_Spec_v1.2.md` §12.6 (owner questions; v1.2 answered q5, q10, q13)

The source files stay the place to answer: edit the question's **Decision** line there and set **Status** to `answered`. This page is only the overview.

---

## 1. Needs your answer before it is built

| # | Question | Suggested answer | Waits on | Blocks |
|---|---|---|---|---|
| 01a Q9 | Use the design's wording for labels the spec quotes (e.g. "Counted in" instead of "Stock unit", "Cook more" instead of "Cook fresh")? | Yes. Needs a one-line editorial spec bump (01a v1.1.1), then string changes only. | You | Nothing; labels stay as the spec's words until then |
| 01a Q10 | Item counts the API cannot give (per category, per tax rate, menu total, floor/station counts per branch, station filter)? | Leave them out for the pilot; add a small summary to §6.11 only if the owner misses them. | You | Nothing |
| 01a Q11 | Show only people with the stock job on the stock sign-in? | Keep as built (everyone listed) until 01b assigns jobs; then add the permission to the roster answer. | You | 01b |
| 01a Q12 / 00 Q14 | Who translates and checks the Urdu? | A native speaker fills `docs/design/handoff/01a/urdu-todo.md` (447 keys) and `docs/design/handoff/00/urdu-todo.md`, then reads every screen in Urdu once. | A translator | Pilot in Urdu |
| 00 Q5 | Pair waiter tablets as a third shared screen type, `waiter_tablet`? | Yes. Needs a spec enum change first; until then the approve page has two types. | Spec approval | Waiter tablets (02) |
| 00 Q13 | Should `HOST_NOT_ALLOWED` tell the installer which address to use? | Add `details.advertised_host`, but only after a security look, since it is a frozen foundation code. | Security review | Nothing; the page shows a general message |

## 2. Open developer questions in spec 00 (§12.3)

| # | Question | Blocks |
|---|---|---|
| MQ5 | Default role session lengths: confirm with the owner. | Pilot comfort |
| MQ6 | What happens to a device's unsent commands after its session ends (M19)? | 02 spec |
| MQ7 | Capacitor LAN transport: check `androidScheme: 'http'` plus cleartext to private addresses against current docs. | 02 client build |
| MQ8 | Is the backup key available for a USB restore on a replacement hub (M21)? | 06 spec |
| MQ9 | Vitest 5: stay on 4.x or record an upgrade. | Nothing now |
| MQ10 | iPhone checks on a real phone (saved URL keeps `?t=`, standalone flag, storage past 7 days, flow inside 10 min). | Phone client work |
| MQ11 | Owner sign-off on the LAN plaintext risk and the phone Wi-Fi requirement (M54, README R16). | Installation |

## 3. Built with the suggested answer; owner has not confirmed

These work today. Change one only if the owner disagrees.

| # | What was built |
|---|---|
| 01a Q1 | Bulk add tables ("T1 to T12, 4 seats") in the page, one request per table, no API change. |
| 01a Q2 | Confirm before archiving items, categories, stations, tax rates, floors; tables and batch recipes archive at once with an 8 s Undo; "Discard your changes?" on leaving a changed form. |
| 01a Q3 | "Signed in as … · Sign out" on the stock page. |
| 01a Q4 | Typed stock counts survive an idle sign-out on the same tablet, for the same person and the same open day. |
| 01a Q5 | "All N are still right" confirms last night's carried counts in one tap. |
| 01a Q6.3 (spec q3) | Sold out vs cook more is chosen per item ("When it runs out"). Owner still to say which items are which. |
| 01a Q6.12 (spec q12) | An item switched On by hand outside its hours stays off: hours win (S47). |
| 01a Q7 | The Menu tab needs no branch picked. |
| 01a Q8 | The branch picker remembers its choice; with one branch it is skipped. |
| 00 Q1 | Module 00 owns the hub admin home `/admin` and its side menu. |
| 00 Q2 | `/setup` after set-up shows a styled "already set up" page with status 404. |
| 00 Q3 | Lockouts list query `GET /admin/queries/lockouts`. |
| 00 Q6 | The guest Wi-Fi message works without a network name; the optional `staff_wifi_name` field comes with 01b branch settings. |
| 00 Q7 | Setup page offers the hub's addresses as a pick-list, with a typed fallback. |
| 00 Q8 | Kitchen screen shows "Not seen" after 2 minutes. |
| 00 Q9 | Devices list shows why and by whom a device was removed. |

## 4. Decided, but built in a later module

| # | Where |
|---|---|
| 00 Q4 | "Add a hub / Replace a hub" in the owner app: module 06. |
| 00 Q10 | Kitchen screen "stopped" state with a Start button: module 03b. |

## 5. From the 02a plan (owner, 2026-11-09) — later work, not in 02a

| # | Item | Decided | Where it goes |
|---|---|---|---|
| 02a SG-1 | **One owner per zone.** A table that is inside a zone is never assigned to a person on its own; the zone's order taker owns all its tables. A table with no zone may be assigned directly. To give one table to someone else, make a one-table zone. | Yes (owner). 02a already reads it this way. | 01b bump: cloud refuses a table assignment for a zoned table (`422 CONFIG_REFERENCE_INVALID`, new reason), owner app disables those checkboxes; 01d one-line text ("zone order taker" = the table's assignee). Next platform batch. |
| 02a SG-4 | **Archive only an empty table.** The cloud cannot see who is seated, so it cannot refuse; the owner app shows a warning on Archive ("Archive only an empty table; bill and clean it first"). The hub keeps a safety net (02a): a seated table that was archived shows in an "Archived tables" group until it is cleaned. | Yes (owner, warning; safety net in 02a). | 01a: owner-app warning text. |
| 02a-N1 | **On-site table management.** A manager at the restaurant should be able to add or archive a table (and similar small setup) from the hub, without phoning the owner; the owner can override anything. | Wanted (owner). Not designed. | New story → small spec after 02a. Open points: which permission (manager only?), hub → cloud sync (today config flows cloud → hub only), conflict rule (owner / cloud wins), offline edits, which setup items qualify. |
| 02a-N2 | **Owner-app hint: take-over needs a wider scope.** Staff with assigned zones or tables need `take-order` scope `my_floors` or `branch`; `own_tables` (only the seatings you hold, T8) cannot take over someone else's table. | Yes (owner, 2026-11-10; 02a AD-22). | 01b owner app, next platform batch. |
| 02a-N3 | **05 must register the `BillClosed` audience** (staff sockets + cashier kiosks) so NEEDS_CLEANING reaches the map live; 02a registers none (§6.19 does not list it). | Yes (owner, 2026-11-10; 02a AD-25). | 05 Billing spec / build. |
| 02b AD-31 | **03b G0: should a remake (`ReturnToKitchen`) bypass a station pause?** Today a return to a paused station with no allowed alternate is refused with `409 STATION_PAUSED` (02b AD-31), so a sent-back dish gets no ticket until the station is unpaused. | Open (owner, 2026-11-11: refuse for now). | 03b G0 / spec. |
| 02b G-7 perf | **03a `fires_alerts` perf flake.** `pnpm test:perf` on the dev laptop fails one case at random. p50 is flat across `2fa2db0` / `main` / `module-02b` (about 9.5 ms work, about 15 ms slips), and the baseline `2fa2db0` already fails the slips case (p99 36 ms). With 31 samples p99 is the largest sample, so one GC or fsync spike fails it. Not a 02a / 02b regression. 02b's own perf passes (submit p99 28 ms, preview 6.6, seating-orders 3.0). | Owner, 2026-11-11: raise the sample count (e.g. 200+) so p99 is not the max; bound unchanged; the authoritative run stays on the pilot box (03a task 28). | Next platform batch (03a perf tests). |
| 02b AD-5 | **A bill close writes both events.** When 05 closes a bill it writes 02b's `OrdersBilled { order_ids, bill_id }` (sets `billed_at` on every order of the bill, 02b §6.19, §3.3) **and** 02a's `BillClosed { seating_id }` (table state NEEDS_CLEANING). One does not replace the other. | Yes (owner, 2026-11-11, AD-5 accepted as read). | 05 Billing spec / build. |

## 6. From the 02b build (owner, 2026-11-11) — next platform batch

| # | Item | Decided | Where it goes |
|---|---|---|---|
| 02b AD-26 | **Hub HTTP `maxHeaderSize` = 64 KB.** 02b §6.14's eta-preview draft is GET-encoded and can exceed Node's 16 KB default, which gives `431` before the hub's own 400. Built in 02b as a 00 platform knob. | Yes (owner, 2026-11-11). | The next 00 / platform-batch spec text (00 server setup). |

## 7. From the 03b build (owner, 2026-11-11) — after the pilot

| # | Item | Decided | Where it goes |
|---|---|---|---|
| 03b-N1 | **Kitchen timing set on the hub, synced both ways.** Ready window, KDS offline and served estimate (03b §4.5 A-1, B-2) are per-branch owner settings: the owner app edits them, the cloud delivers them to the hub (F §3.3, one-way), the hub keeps the last delivered value and falls back to its defaults (60 s / 30 s / 3 min). Wanted later: a manager changes them on the hub too (also offline) and the owner app shows the change. | Keep one-way for the pilot (owner, 2026-11-11); look again after the pilot. | Same design as 02a-N1 (hub → cloud config sync, conflict rule, offline edits, permission) — one foundation bump for both. |
| 03b-N2 | **Strikethrough reprint** when a line is Done after its ticket already printed (story E3-PRT edge, Z1 GAP G5). | Deferred after the pilot (owner 2026-11-12). | 03c spec row + a print task. |
| 03b-N3 | **After pilot: show dismissed vs undismissed `ticket_not_built` skips in `print-config`** (a `dismissed_at` column on `print_fold_skips`, set by `DismissPrintSkip`; today the dismiss is satisfied by the existing `alerted_at`, 03c v1.0.6 §6.12). | Deferred after the pilot (owner 2026-11-12, Q-P22a, PR #84 review). | 03c spec row + a print task (migration + `print-config` warning field). |

## 8. From the 04 spec (owner, 2026-11-12) — Voids + Audit known gaps

Full list with reasons: `docs/specs/04_Voids_Audit_Spec_v1.0.md` §12.6.

| # | Item | Decided | Where it goes |
|---|---|---|---|
| 04-G1 | **No override of a stuck pending void** — no approver reachable → that bill and the day close stay blocked. | Not in the pilot (owner Q9). | After the pilot: 01a setting + 04 bump. |
| 04-G2 | **Kitchen sees nothing while a void is pending.** | Not in the pilot (owner Q8). | 03b slot + frame if the pilot asks. |
| 04-G3 | **Remote / cloud audit view** (owner away from the restaurant). | Moved to 06 (owner K-8). | 06 G0 decides milestone A. |
| 04-G4 | Rejection reason not captured. | Not built. | 01d bump if wanted. |
| 04-G5 | Owner-editable void reasons. | Fixed codes for now (owner Q4). | 01a setting when asked. |
| 04-G6 | Approver cannot change the disposition at approve (withdraw and re-ask instead). | Owner OQ-D. | Later 04 bump. |
| 04-G8 | Wastage / staff-meal / moved-to-stock reports. | Data recorded; no report. | 05 Z report, 07, 08. |
| 04-R1 | **Cross-module bumps approved but not applied** (F, 00, 01a, 01b, 01d, 02b, 03a). | Task 0 takes next free numbers, STOPs on conflict. | 04 build task 0. |
| 04-R4 | **05 must honour 04's four contracts** (refund_minor only, bill close refused while pending, keep the day-close guard, voided pending-weight lines). | §4.3 To 05. | 05 G0 / review. |

## 9. From the 02a / 02b client gap sweep (owner, 2026-11-12) — deferred

| # | Item | Decided | Where it goes |
|---|---|---|---|
| 02a Q-14 | **Handover result facts from 01d:** `request_alert_id`, `request_kind` on the `request_result` view and the receiver's name on `my-requests` rows. Until then the sender's device remembers its own sends; after a reload "Waiting for an answer". | Deferred (owner 2026-11-12, Rec (a)). | A later 01d bump. |
| 02a Q-15 | **`floor_ids` on `/queries/session`**, so buttons follow `my_floors` scope. Until then buttons by grant; `403 outside_scope` → "This table is outside your floors". | Deferred (owner 2026-11-12, Rec (a)). | A later 00 bump. |
| 02b Q-7 | **`option_id` in `order_lines.options_json`** (migration 0017, like 0016) for an exact "Send it as a new item". Until then the options sheet is preselected by option name. | Deferred unless name match fails (owner 2026-11-12, Rec (a)). | 02b bump + hub migration. |
| 02-F1 | **Fold with module-04 (same spec bases, same files).** Both branches bump 02b (v1.0.11 here, v1.0.10 on module-04; tests here #45–#50, module-04 #41–#44), 00 (v1.9.1 / v1.10 on v1.9), 01a (v2.4.4 / v2.5 on v2.4.3), 01b (v1.8.1 / v1.9 on v1.8; module-04's Cashier row has no `mark-served`), their README rows, and edit `apps/hub/src/orders/exports.ts` (H2 vs 04 `readOrder`) and `apps/hub/src/orders/commands/comp-line.ts` (H6 vs 04 `applyComp` line guard); cloud migrations 0013 (04), 0014 (H9), 0015 (H10). | Whichever reaches `main` second folds the other's changes into its spec files, README rows and the two code files; trial merge as soon as either is ready (owner 2026-11-12, Q-26 extended by the #103 review M1). | Integrator of the second branch (02 client / 02 hub gaps or 04). |

## 10. From the 03b / 03c client gap sweep (owner, 2026-11-13) — fold, open text, accepted limits

| # | Item | Decided | Where it goes |
|---|---|---|---|
| 03-F1 | **Fold with module-04 (same spec bases).** This batch bumps 03c to **v1.0.9** on `main`'s v1.0.7 (module-04 holds **v1.0.8**, MOVED TO STOCK slip, test 4b; ours test 55) and 00 to **v1.9.2** on v1.9.1 (module-04's v1.10 is on v1.9); README rows 00 / 03c; `apps/hub/src/server.ts` (04's `registerVoids` / `registerAudit` lines vs HK4 / HK5's client-dist block). Also `module-02-hub-gaps` (H1 `kds-audiences.int.test.ts`, H8 `pair-page.ts`) before HK4. | Owner 2026-11-13 (Rec (a)); the second to `main` folds the other, trial merge first. | `module-03b-hub-gaps` → `main` PR; module-04 → `main` PR. |
| 03-Q1 | **01a text vs Q-44:** 01a v2.4.4 §4.1 lists `BusinessDayOpened` / `BusinessDayClosed` for "staff sockets" and test 73 says "not to station sockets"; Q-44 adds station sockets (03b v1.0.8 §6.17, a second, additive registration in 03b's file; HK1 edits the `[01a §10 #73]` assertion). | **Open** — Rec: keep the 03b note now, add the 01a marker in the next 01a bump (module-04's v2.5 fold). | Owner answer in the 03b client specs PR. |
| 03-L1 | `DeviceRoleSet` (new point / lane label) takes effect at the device's next sign-in or reconnect (Q-44). | Accepted (owner 2026-11-13). | Revisit if the pilot rebinds tablets mid-shift. |
| 03-L2 | Live Ready / placed times are the hub clock at frame receipt and names come from the sender's device or `staff-roster` (Q-55); the "screen is back" toast shows only when rows remain (Q-56); the printer card has no waiting count (Q-57). | Accepted (owner 2026-11-13). | A hub frame field (`recorded_at` / `actor_id`, end `reason`, `details.waiting`) only if the pilot needs it. |
