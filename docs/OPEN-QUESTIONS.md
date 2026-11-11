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
