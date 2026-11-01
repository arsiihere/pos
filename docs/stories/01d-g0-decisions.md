# 01d G0: decisions from the design session (draft)

| | |
|---|---|
| Status | **Proposed — needs approval.** Every row is a developer decision from the 2026-10-31 / 2026-11-01 design session unless marked otherwise. Rows marked **[owner]** must be confirmed by the owner (or the restaurant) before G1. Nothing here changes an approved spec yet: each change lands through a version bump (R26). |
| Sources | Developer design session 2026-10-31 and 2026-11-01; restaurant manager input on pre-placed items (zone stock, §5); repo research of 2026-10-31 and 2026-11-01 (facts cited by file in the session notes). |
| Supersedes | The 01d parts of `01d-notifications-teams-refined.md` where they disagree (that file stays as the 2026-10-27 owner record). |
| Pilot | One branch, named only in installation, never in a spec. Every feature below is used at the pilot branch, so all are pilot scope unless §11 defers them. |

Words used here: **station** = where food is cooked (01a); **assembler point** (point) = where food is collected and handed to a waiter; **zone** = a group of tables; **lane** = one chef's device at a station.

---

## 1. Scope of 01d

| ID | Decision |
|---|---|
| S1 | 01d is renamed **Notifications, requests and devices**. It owns: notification targets and routes, requests (approve / accept), delivery receipts and audit, the **device gateway** for headless devices (§3), and the pager route. |
| S2 | 01d does **not** own the kitchen and serving model (§4), zones and zone stock (§5) or the screens that drive them. Those are carried rows to 00, 01a, 01b, 02, 03a, 03b and 05 (§10). 01d delivers what those modules raise. |
| S3 | Build order stays 01d → 03a → 02 → 04 → 03b → 05 (R21 as amended by R27). A hardware spike (§9) runs **before** the 01d spec reaches G2. |

## 2. Devices

**H0 Tablet first, hardware optional (developer, 2026-11-01).** The POS is a product for sale. Every flow in this file works with tablets alone: the assembler tablet changes every state, the order taker's tablet shows every waiter alert. The pager watch, pager bridge and station button devices are **optional add-ons per branch** for a restaurant that wants more speed. No flow may depend on them, and the build delivers the tablet path first.

| ID | Decision |
|---|---|
| D1 | **Order takers, managers, assemblers** use restaurant-owned Android tablets running the Capacitor app in **lock-task (kiosk) mode** as device owner: no other apps, no settings, no safe mode, no factory reset from the device. Reason: use of devices for anything else can't be enforced verbally. The app keeps a background service so alerts arrive with the screen off. |
| D2 | **Waiter route is a per-branch setting** (data, R18): **watch** (pager watch, §2 D3), **app** (the Android app on a phone, restaurant-owned and locked or the waiter's own), or **none** (the waiter's alerts show on their order taker's tablet). A branch can mix: a waiter with a watch gets the watch, others follow the branch default. |
| D3 | **Pager watch:** receive-only 433 MHz watch from a restaurant waiter-calling set. The hub drives it through an **ESP32 pager bridge** (hub → Wi-Fi → ESP32 → 433 MHz). The watch shows the table's pager code and a 1-letter kind or point code, e.g. `12 P`. It sends nothing back. One bridge per branch; more if the radio does not reach every floor. |
| D4 | **Station button device:** an ESP32 with a small display and two buttons at a station, one per chef (lane). Button 1 = **Being cooked** (Start), button 2 = **Cooked** (Done). Wall powered, on the staff Wi-Fi. It is paired as device type **`kds`** (it already requires a `station_id`; station sessions have no idle timeout, 00 M30), so it needs no new type. A station may have several. |
| D5 | **Pager bridge** gets a new device type **`pager_bridge`** (no station, no staff session): forward migration widening the device-type CHECK, `DevicePaired` v2 with upcaster, approval payload accepts it, 00 version bump. |
| D6 | **Personal phones stay possible, not required.** The `phone` type (R14, 00 M38) is kept; a branch may use it for the waiter "app" route. Nothing is removed from merged migrations. R14 is narrowed, not dropped. |
| D7 | **iPhones:** unchanged from R22 (no locked-screen alert). They matter only for the optional "app" route. |
| D8 | **Android client form (Q-A2):** a native Capacitor app is needed anyway for kiosk mode and the background service, so the foundation's bundled-assets client stays (foundation stack, 00 §8.1). Pages are not loaded from the hub. Final choice in G1. |

## 3. Device gateway (headless devices)

The ESP32 has about 300 KB of RAM, no clock and no durable storage. It cannot run the client protocol (2.5 MB snapshot at design size, ULID command ids, durable command queue). So the hub does the thinking and the device is a screen with buttons.

| ID | Decision |
|---|---|
| G1 | The hub exposes a **compact device protocol** over the LAN WebSocket for `kds` button devices and `pager_bridge`. The hub sends ready-to-show lines; the device sends only button presses. Example: hub → device `{"line1":"T12 Karahi Full x2","line2":"Next: T7 Tikka","ref":"a1"}`; device → hub `{"button":1,"ref":"a1"}`; hub → bridge `{"pager":5,"text":"12 P","pattern":"long3"}`. |
| G2 | **The `ref` names the item.** The device echoes the `ref` it was showing; the hub maps it to the `order_item_id` and sends the normal `StartItem` / `DoneItem`. If the item's stage has moved (`ITEM_WRONG_STAGE`), the hub sends fresh lines. No FIFO assumption: tickets stay ordered by latest start (D27). |
| G3 | **Time of a button press = hub receive time** (`recorded_at`, branch clock). The fact's `source` is `button`. A device sends no timestamp. |
| G4 | **No queue on the device.** If the device loses the hub it shows `OFFLINE` and ignores presses; the assembler tablet (§4 K6) is the fallback, and 03b's KDS auto-print fallback applies to button stations too. |
| G5 | **The hub never sends a snapshot or catch-up state to these devices**, only their lines. |
| G6 | **Pairing:** the M44 request flow (`POST /pair/requests`, display code, manager approval). A button device shows the 6-character code on its display. The bridge has no display: it starts in setup mode (its own Wi-Fi access point with a small page showing the code and taking the staff Wi-Fi and hub address). Firmware sends the hub's advertised Host header (00 M45). |
| G7 | **Device health:** the hub tracks each device's keepalive. A device that disappears is shown to the assembler of its point and to the manager. |

## 4. Kitchen and serving model

| ID | Decision |
|---|---|
| K1 | **Assembler points.** Each station either **is its own point** or **points to a shared point**. Example: karahi, tawa piece, anda tikki / qeema, BBQ, biryani → point "Pass"; tandoor → its own point; raita / salad → its own point. Config in 01a; any layout. |
| K2 | **Five states**, all recorded with hub time and actor or device: **Being cooked** (`ItemStarted`, stage COOKING), **Cooked** (`ItemDone`, stage COOKED), **Ready to serve** (new event, per order per point), **Handover** (new event: the food left the point with a named waiter), **Served** (`ItemServed`, food on the table). The item stage enum is unchanged: an item stays COOKED until Served, so D10's void stages stay as they are. |
| K3 | **Who changes what.** Being cooked / Cooked: the chef's button device, or anyone at the point's tablet with `tap-for-station`. Ready to serve and Handover: the point's assembler (tablet). Served: the table's **order taker** on their tablet (needs `mark-served`; foundation §4.2 already ties Served to "the relevant role permission"). At a one-person point (raita) the same person does every step on one tablet. |
| K4 | **Ready to serve is the assembler's tap**, per order per point. The assembler view shows the foundation's hold-at-pass hint (sync items "ready to run together", §4.7) and lets immediate items go alone (D16). Order READY (§4.4) is read as "every point of the order is Ready to serve" [foundation wording to update, §8]. |
| K5 | **Handover:** the assembler taps the waiter's tile when the waiter takes the food. This records who took it without a waiter PIN or a waiter device. |
| K6 | **One kitchen-screen app (03b), two views:** **station view** (one station's tickets, Start / Done) and **assembler view** (every station pointing to this point, table-wise, with every item's state changeable). A station has an ESP32 button device, a full screen, or nothing (the assembler taps for it). The button device is a small station view. The KDS is not removed; the foundation's expo / pass view (03b-S03) becomes the assembler view. |
| K7 | **Big stations (lanes).** A station stays one station with its capacity (stoves). Each chef has a button device (a lane). Button 1 **claims** the next unclaimed ticket for that lane; button 2 finishes that lane's oldest cooking ticket. Other lanes no longer show a claimed ticket. Per-lane counts and times come from the device id. |
| K8 | **Lane on / off at run time.** The assembler (or manager) switches a lane **Off** on the tablet when a chef or stove is out. The station's live capacity drops, the engine re-plans and late orders raise slip warnings (foundation §4.7 capacity change, already specified). The lane's claimed tickets become **unassigned** on the assembler view; the assembler gives them to another lane or back to the queue. A lane whose device disappears (G7) is offered for Off. |
| K9 | **Follow-up orders** (more food punched later for the same table) go through the same points and the same flow. ("Add-on" means a modifier such as extra cheese and has no flow of its own.) |
| K10 | **Walk times:** branch config holds, per zone and point, the expected walk **to** the point and **back** (e.g. outdoor → Pass 15 s, back 25 s). |
| K11 | **What is measured** (captured from day 1, events only, never typed): kitchen = submit → Cooked against the engine's plan; assembly = last Cooked → Ready to serve; pickup = Ready to serve → Handover against the walk-to time; return = Handover → Served against the walk-back time; plus the waiter's load at that moment (open tables, pending pickups) so a late pickup can be read as "too few staff" or "slow person". Reports show expected, actual and extra, never a bare "late". |

## 5. Zones and zone stock

| ID | Decision |
|---|---|
| Z1 | **Zone** = a named group of tables. Zones nest (floor → partition). Every table is in exactly one leaf zone. Config in 01a. |
| Z2 | **Order takers are assigned to zones** (fixed tables per order taker, as done today). This is the table owner for routing alerts (R25) and for zone stock. |
| Z3 | **Zone routing (floor kitchens):** an item route can be overridden per zone ("orders from First floor cook this item at the upstairs karahi"). Resolution: the most specific zone route, else the branch route (01a S11). |
| Z4 | **Zone stock:** an item marked *zone stock* can be held as a count in a zone (bottles, raita, salad, anything). Punching it at a table in that zone takes it from the zone's count: no station ticket, no waiter alert, the item goes straight to Served, and it is billed as usual. |
| Z5 | **Refill:** moving stock into a zone (from a station or the store) is a recorded action with who, how many and when. |
| Z6 | **Shortage:** zone empty → the order taker requests from a **sibling zone on the same floor**; that zone's order taker approves (an 01d request); the count moves and the log names the table. If the whole floor is out, the item follows its normal station route. |
| Z7 | **Threshold:** a zone count at or below its threshold notifies the manager. |
| Z8 | **Day-end count per zone** (and per shift if the branch wants): the counted value replaces the zone's count; the difference is shown to the manager as missing or extra. Without it the counts drift in days. |

## 5a. Complimentary items

Stories already have a cashier comp on the bill (`stories-refined.md` E-bills: price 0, "COMP" label, reason, logged; `apply-comp` in the catalogue; comps in the Z report). Two cases are missing.

| ID | Decision |
|---|---|
| C1 | **Standing complimentary:** an item the restaurant always gives (e.g. salad or raita per table, per guest, or with a chosen item). Config, per branch (data, R18): what, how many, per table / per guest / per item. Added to the order automatically at price 0, labelled COMP, cooked and served through the normal flow (or taken from zone stock, Z4), and counted in stock and in the Z report as comp. |
| C2 | **Goodwill comp at order time:** an order taker (or anyone) marks a line complimentary to please a customer, with a reason. Needs `apply-comp`; where the role says *requires approval*, it is an 01d request (N7) to an approver, recorded with requester, approver, item, value, reason, table and time. The kitchen cooks it as usual. |
| C3 | **Comp on the bill** (cashier, existing story) stays, through the same permission and request. |
| C4 | Comps never change the item's price in config; the bill shows the item at its price and the comp as a deduction, so reports show the value given away. [05 to confirm against its bill model.] |

## 6. Notifications and requests (01d core)

| ID | Decision |
|---|---|
| N1 | **Targets:** one person; everyone at the branch holding a permission; a person's team (`teamOf`, built in 01b, not yet used); the **table's team** (the zone's order taker and the waiters reporting to them); a **point's assembler**. |
| N2 | **Routes, all at once:** screen banner and sound on every signed-in screen (WebSocket); the tablet app's background service; the pager bridge (watch); **escalation** to always-on screens (assembler, cashier, KDS screens) when not answered in N seconds (branch setting) [owner: N]. |
| N3 | **A different sound / vibration per kind**, so staff learn them by habit [owner: the set]. |
| N4 | **Inbox:** each person sees the day's notifications; pickups stay open until handed over, so a waiter who forgot what was waiting can look. |
| N5 | **Delivery receipts:** per notification and route, sent / delivered / seen / answered with hub times, kept in the audit. The pager route records **sent** only (the watch is receive-only). This answers "it never came to me". |
| N6 | **Requests:** Approve / Reject or Accept / Decline; answered on the answerer's **signed-in tablet** with their own PIN; the right is checked when the answer arrives; first answer wins ("Already approved by Imran"); no expiry; the in-person PIN fallback always works. |
| N7 | **Request kinds in the pilot:** void approval (04), discount approval (05: every request records requester, approver, amount, reason, time), comp approval (§5a C2, C3), table handover accept (02), zone stock transfer (§5 Z6). |
| N8 | **Watch kinds** (only "go and do something"): **Ready to serve** `<table code> <point code>` e.g. `12 P`; **Call** `<table code> C` from the order taker's Call waiter button. Ready to serve goes to the table's team; on route "none" it shows on the order taker's tablet. |
| N9 | **Slip warning (D3) and rejected void** go to the **table's order taker** (tablet), not to waiters: they need a person who can talk to the customer [foundation wording, §8]. |
| N10 | **Table handover (02):** the receiver must accept; a holder of the force-move permission (normally the manager) moves without acceptance. |

## 7. People and permissions (01b)

| ID | Decision |
|---|---|
| P1 | **Watch-only waiters need no PIN.** The directory gains a separate additive array `no_pin_staff: [{ staff_id, display_name, lead_staff_id, pager_id }]` (older hubs ignore it; `pin_hash` stays required for signed-in staff, README additive-directory row). These people are never on sign-in screens. |
| P2 | **`pager_id`** per staff member (which watch). |
| P3 | **New permission `tap-for-station`**, scope `my_stations` (scope already exists): a staff session may send Start / Done for those stations, with `actor_id` set. Changes the "station-scoped, actor null" rule for this path only. |
| P4 | **`mark-served`** is a permission (not in the catalogue today); default grant to `order_taker`. |
| P5 | **Zone assignment** per order taker (with Z2). |
| P6 | "My team" approval scope (01b Q19, built in the catalogue, enforced by 04) [owner: confirm]. |

## 8. Changes to approved specs (to apply by version bump, R26)

The developer allows changes to any approved file, the foundation included, through a version bump. Proposed README row:

> **R30 Proposed — needs approval.** The foundation (D64 frozen) may change through a version bump with a changelog and "Changed by" markers, approved by the owner, like any module spec (R26). First use: 01d.

| Spec | Change |
|---|---|
| Foundation v1.7 → v1.8 | §4.2 / §4.4: Ready to serve and Handover events; order READY per point (K2, K4); zone-stock items go straight to Served (Z4). D3 and §4.5: slip warning and rejected void to the table's order taker (N9). §4.7 / D27: lanes claim tickets (K7). Stack table and device classes: tablets in kiosk mode, button device, pager bridge (D1, D4, D5). Envelope `stream_type` unchanged. |
| 00 v1.5 → v1.6 | `pager_bridge` type (D5); compact device protocol and headless pairing (G1–G7); R14 / M38 phones optional (D6); M54 phone SSID only where the phone route is used. |
| 01a v2.0 → v2.1 | Assembler points, `station.pickup_point_id`, point pager code (K1); table `pager_code` (1–3 digits) for the watch; item `short_name` (≤ 16 characters) for small displays; zones (Z1), zone routes (Z3), walk times (K10), zone-stock flag, par and threshold per zone (Z4, Z7). Stock gains a location (branch or zone). |
| 01b v1.3 → v1.4 | P1–P5. |
| README | Module map row 01d renamed (S1); R22 routes add the pager route; R28 device policy (D1–D7); R30 (above). |

## 9. Hardware spike (before the 01d spec's G2)

1. Buy one 433 MHz waiter-calling set (watches + transmitter), 3–4 ESP32 boards, 433 MHz TX/RX modules, and one ESP32 board with a display and buttons (e.g. LilyGO T-Display or M5Stack).
2. Prove: an ESP32 sends a code that shows on the watch (`12`, and whether letters show at all; how many characters; stored history on the watch).
3. Prove: a button device shows two lines from a test hub and sends a press back.
4. Note radio reach across the pilot branch's floors, and heat / grease exposure at stations (enclosure).
Outcome feeds D3, D4, G1 and the watch code format (letters vs number suffix).

## 10. Carried rows (to add to README "carried" table)

| To | Row |
|---|---|
| 00 | `pager_bridge`, compact device protocol, headless pairing, device health (D5, G1–G7). |
| 01a | Points, pager codes, short name, zones, zone routes, walk times, zone stock config (§8 row 01a). |
| 01b | `no_pin_staff`, `pager_id`, `tap-for-station`, `mark-served`, zone assignment (§7). |
| 02 | Served by the order taker (K3); Call waiter button (N8); handover accept and force move (N10); zone stock punch and sibling request (Z4, Z6); table owner = zone's order taker (Z2). |
| 03a | Ready to serve / Handover events; lanes and claims; live capacity and re-plan on lane Off (K7, K8); stock by location (Z4); capture for K11. |
| 03b | Kitchen-screen app with station and assembler views; button-device lines and press handling; lane Off and reassign; auto-print fallback for button stations (K6–K8, G4). |
| 02, 05 | Standing complimentary config and auto-add (C1); goodwill comp at order time (C2); comp shown as a deduction (C4). |
| 05 | Discount approval through 01d requests with full record (N7); zone refill and day-end count with variance (Z5, Z8) if 05 owns counts. |
| 07 (P2) | Reports for K11 (expected / actual / extra per stage, per point, per zone, per person, with load). |

## 11. Deferred (proposed for §12.4)

- Free-text or cross-team task messages beyond zone stock transfers (README "cross-team requests" row).
- Customer table call buttons.
- "No one can be reached" warning (Q-N5).
- Inbox history beyond the current day.
- Analysis reports and dashboards (07, P2); the pilot captures the data (K11) and shows a basic live view per point.
- Main / secondary roles and capacity fields (R25, already deferred by 01b B1).

## 12. Answers to the G0 questions (developer, 2026-11-01)

Answered by the developer for the owner (Q3, Q4, Q5, Q7 stated; Q1, Q2, Q6, Q8 delegated to the developer's judgement). All defaults below are branch settings (data, R18).

| # | Answer |
|---|---|
| G0-1 Escalation | **Tiered by kind, never a single timer; nothing expires.** *Approval requests* (void, discount, comp): t0 approvers in range (G0-7); **45 s** repeat sound on their tablets and show on the always-on screens (assembler, cashier); **2 min** every approver at the branch (out of range too) and the requester's screen says "Waiting 2 min — ask in person". *Ready to serve*: t0 the table's team; not handed over by **walk-to time + 30 s** → buzz again and the order taker's tablet; **+60 s** more → the point turns red on the assembler view and the manager is told. *Table handover accept*: **60 s** remind the receiver; **2 min** the sender's lead. *Zone stock transfer*: **60 s** to the manager. |
| G0-2 Sounds | **Three families told apart by rhythm, not pitch** (kitchens are loud): **Urgent** (approval requests) two-tone rising, repeats every 10 s until answered, vibration long-long; **Action** (Ready to serve, Call) bright double ding, once, re-sent by escalation; **Info** (slip warning, low zone stock, a request answered) single soft chime, no repeat. Answer to the requester: rising chime approved, falling tone rejected. Watch patterns: Ready to serve 3 long, Call 2 short (if the watch supports patterns, §9). Escalation raises the volume. At most five sounds in total. |
| G0-3 Chef by name | **By name.** At shift start the assembler sets "Karahi lane 2 → Imran" on the tablet; the device shows the name; it stays until changed. Chefs without a PIN are in `no_pin_staff` (P1). With no name set, work is recorded under the device only. |
| G0-4 Zone stock | Whoever holds a new permission **`manage-zone-stock`** (scope `my_zones`, new scope) refills and counts. |
| G0-5 Walk times | Config, editable at any time (K10). Measured at the branch with a stopwatch for the first values. |
| G0-6 Served | **Order taker taps, made almost free, with a safe fallback.** At Handover the order taker's tablet shows a card "T12 coming — Ali"; one tap when the food lands. Not tapped within **3 × walk-back time** → Served is set automatically as *estimated* (flagged). Table state uses both; the return-time measure (K11) uses only tapped ones, and reports show the tap rate per order taker. |
| G0-7 Approval range | **An approver approves only within their range** (their team, their zones, or the branch, by role scope; 01b "My team"). If no one in range answers, escalation (G0-1) reaches branch-wide approvers. |
| G0-8 Live manager view | **Exceptions first, numbers second.** (1) *Needs attention now*, oldest first: requests waiting; food Ready to serve and not picked up past walk time; tables past their promised time (slip); stations behind plan; lanes Off or devices offline; zone stock low. (2) *Points and stations strip*: per point cooking / ready / waiting pickup with the oldest age in colour; per station queue, late count, lanes on. (3) *People*: per order taker and team, open tables and pending pickups (who is overloaded). (4) *Today's money*: sales, covers, and voids, discounts, comps with count, value and who. Pilot builds (1) and (4) first; (2) and (3) next. Same numbers read-only on the owner's remote view (D22). |
| G0-9 | Tablet model and Android version (OQ2); hub PC (OQ1). **Open, installation.** |
| G0-10 | Watch model and code format. **Open, after the spike (§9).** |
