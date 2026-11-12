# Module 02a — Tables · design decisions (core set, 60 frames)

All frames are new, drawn from `brief/02a-brief.md` (spec 02a v1.1.4) after the hostile review (`brief/02-brief-review.md`). The sample shift: **Ali** (order taker) on **Tablet 3**, Saturday 8:15 PM, **Family hall** (his zone, F1–F7) and **Cabins** (Sara's zone, F8–F12). F4 + F5 is a joined party of 9.

## 0. Owner decisions taken before drawing (2026-11-11)

| Question | Answer |
|---|---|
| Unslop A / B | **Neither.** Pulse Chatkhara maroon as in 01d, unchanged. |
| Table colours (brief Q1) | **Pulse palette**: Free beige, Seated blue, Ordered purple, Eating green, Bill red, To clean grey. **Update the 02a spec to match.** One token per state (`--s-*`), so a swap stays trivial. |
| Floor plan vs grid | **Puck+ tiles in a zone grid.** The setup has no table positions, so there is no floor plan. Each tile keeps the Puck+ language: a puck with a ring, holder initials, a status tint with a bottom bar, and a loud style for urgent tiles. |

## 1. UX review (clutter report)

| Brief | Frames | Why |
|---|---|---|
| Side column: Mine filter + legend + Needs you + **New takeaway · New parking · Open orders** | **One `New order` primary** (opens 02-S04: Takeaway / Parking) + `Open orders (n)` + `Held (n)` | Three new-order buttons became one, so the layer keeps a single primary. |
| Assignee shown on every tile ("Sara's zone") | Shown **once per zone heading** ("Cabins · S Sara's zone"). A tile shows a hollow avatar only when its holder ≠ the zone's assignee. | Puts the assignee in one place instead of on every tile. Answers Q7 (assignee on free tiles) the same way. |
| 9 action buttons on the table sheet | **Take order (primary) + 4 actions**: Ask for bill · Call waiter · Hand over · **More** (Move party, Join a table, Split the party, Release my lock). Managers see Release lock and Force move in the first four. | The most frequent actions stay visible; the rest go behind one More. |
| 02b "Add items" at the bottom of the table view **and** 02a "Take order" in the header | **One button in the header.** It says "Take order" when there are no orders and "Add items · Round n" once orders exist. | They are the same command (`open-table` → order screen). |
| Ask for bill confirm as a dialog | **Confirm in place.** The action row turns into "Ask for the bill for F4 + F5? · Cancel · Ask". | Keeps it to one tap plus one confirmation, with no scrim. |
| Handover note field (Q11) | **Removed.** | The hub accepts the note but nobody ever sees it. |
| Busy sheet repeating "Bilal is taking an order here" in the title and the body | Title only. The body says what you *can* still do. | Less text. |
| Call-waiter "Other" needing a typed text | Chip only, one tap sends. "Come to the table" is outlined as the default. | The API has no text field. |
| Time-open text ("since 7:42 PM") on tiles | Only "32 min" on the tile. "Open 32 min · since 7:42 PM" appears in the sheet. | Tiles stay readable at a glance. |

## 2. Owner questions §7 — answers used in the frames

| # | Decision |
|---|---|
| Q1 | Pulse palette (owner, above). |
| Q2 Mine | Tables I **hold** or am **assigned** to. The filter is a segmented "All tables · Mine (n)" at the top of the side column. |
| Q3 Party size | Not asked at open. The sheet shows "9 guests" only when the value was set. |
| Q4 Waiter taps a free table | Toast "Free table". There is no New order button for waiters (`TableMapWaiter`). |
| Q5 Bill paid → To clean | Refetch `table-map` every 30 s while visible and on every order/table frame. |
| Q6 `my_floors` greying | Not drawn (data gap). Handle the 403 with "This table is outside your floors". |
| Q7 Assignee on free tiles | Shown in the zone heading (see §1). |
| Q8 Phone tabs | **Tables · Orders · Inbox · Me.** "Orders" holds open orders + New order (02b). |
| Q9 Reason chips | Force release: Went home · Tablet dead · Left the table · Other. Force move: Shift ended · Went home · Rebalance · Other. Move (optional): AC · Bigger table · Guest asked · Other. Plus an optional note ≤ 120. |
| Q10 Move/Join/Split on phone | Allowed, under **More** (same menu as the tablet). |
| Q11 Handover note | Field hidden. |
| Q12 Force move to myself | A "Me" row at the top of the list (client-side). |
| Q13 Result copy | Kind-specific: "Sara accepted F4 + F5" / "Sara declined F4 + F5" (+ "Hand over to someone else"). |
| Q14 Call card content | "F4 · Call" + time only, until the hub sends the caller and the chip. |
| Q15 Ask for bill | Confirm in place (see §1). |
| Q16 Needs you | My tables with Bill asked, To clean, late food; plus "Bilal is ordering" on a table in my zone, and my waiting handover. |
| Q17 Others' tables | All equal. "Mine" is the focus tool. |
| Q18 0-recipient call | Kept as built. Warning toast: "Nobody else is working — you can call again in 5 min · Go yourself or ask a manager". |
| Q19 Accept in person | Not offered on the sender's card. |
| Q20 Waiting card data | Keep the picked name on the client. After a reload: "Waiting for an answer". |
| Q21 Force-move notices | Yes. The new holder gets an info banner "A manager gave you F2 · Shift ended". The old holder gets the 02a-B10 banner. |
| Q22 Clean while ordering | Allowed after a danger confirm, "Clean anyway". |

## 3. Per screen

| Screen | Decision |
|---|---|
| 02a-C10 top bar | 80 px maroon. Start: brand block + the 01d B05 alerts line. Middle: floor segmented control with counts. End: Live, clock, **Requests** (shield), **Inbox** (tray), person chip. Kiosk: no B05 line. Portrait: floors on their own full-width row. |
| 02-S03 map | Zones on the cream floor card (dotted ground). Each zone heading reads "name · assignee's zone · n tables". Tiles sit in a 5-column grid (kiosk 6, portrait 4, phone 2). Side column 340 px (kiosk 420): All/Mine, Needs you (+ legend counts), Open orders / Held, New order. |
| 02a-C01 tile | 136 px. **Puck** (44 px; its ring fills over 60 min open; solid in the state colour when urgent: Bill, late, void). **Holder avatar** top-end (maroon = you), plus a hollow assignee avatar when that differs. Then the **name** (30 px, LTR; a joined tile reads "F4 + F5" at 23 px), a **state word · minutes** line, and **one footer**: a padlock pill with the name ("You" in maroon), or one flag (late, void waiting, call sent, waiting to send, archived). A free tile is dashed and shows the seats. Urgent tiles get a 2.5 px edge, a 16 % tint and a 7 px bottom bar. Offline: the whole floor is desaturated. |
| 02-B01 busy | Dialog: table chip, "Bilal is taking an order here", a line on what you can still do, **See the table** + **Release Bilal's lock** (danger tone, managers only). When it's your own lock on another screen: "You're ordering on F7 on another screen" + **Open here** (primary). |
| 02-D12 | Reason chips (required) + an optional note, Cancel / **Release** (solid danger). |
| 02-S06 table sheet | A side panel 600 px wide from the end edge (720 px on kiosk) over the dimmed map. Portrait: bottom sheet. Phone: full screen. **Header**: table chip, "Your table / Ali's table", state pill, "Open 32 min · since 7:42 PM", guests/seats, zone, padlock line. **Main**: one block primary (Take order / Add items / Take over from Bilal / Mark clean). **Actions**: a 4-up grid of 76 px icon + word tiles. Orders (02b) sit below and scroll. Offline: a warning line, plus a small wifi-off mark on every "Needs the hub" action. |
| Permission variants | Holder, assignee, another order taker, waiter, manager and to-clean each have their own frame (`TableSheet*`). |
| 02a-D20 hand over | Radio list: avatar, name, Working dot, "Has n tables", "Assigned here" tag. People who are not signed in are greyed. Send request (primary). A 409 shows as a message at the top and the list refreshes. |
| 02a-D21 force move | The same list with a "Me" row, required reason chips, and a danger button **Give table**. |
| 02-D09 move | Free-table mini tiles grouped by floor. A tile assigned to someone else carries an orange "Sara's" tag, warning that a hand-over will be needed. Optional reason chips. The primary names the target ("Move to T4"). |
| 02a-D25 | "F9 is Sara's table. Hand F2 over to Sara; she can move it." → **Hand over to Sara** (opens D20 preset). In the null/me case: text + OK only. |
| 02-D10 join | Two groups, Free tables and Other parties (tinted in the party's state). A summary line: "F3's party (1 order) joins F4 + F5. One bill." |
| 02-D11 split | Step 1 done (target shown), step 2 is a checklist of whole rounds, plus "No orders — just free F5". A summary line: "1 order goes to F5. 2 stay on F4." |
| 02a-D23 call waiter | Four 104 px chips. **One tap sends**; the only other button is Cancel. The sub line names who gets the call. |
| 02-D13 clean | A plain confirm. Locked: "Clean anyway" (danger). Open orders: an error message + OK. |
| 02a-C02 handover (receiver) | 01d action banner → Requests card → 01d answer sheet with facts: Orders, Running total (30 px), Table. **Decline / Accept**, no PIN. Stale: a warning message, buttons off, the card stays. **New phone answer sheet**: bottom sheet with 64 px buttons. |
| 02a-C03 waiting (sender) | An info-tinted card in the sheet header: a ring with the live count, "Waiting for Sara", and **Withdraw** (tone). After 2 min: "ask her in person · Your lead was told". It also shows as the first Needs you row. |
| 02a-C04 result | Info banner, max 2 stacked (01d rules). Declined → **Hand over to someone else**; accepted → OK, hides after 4 s. |
| 02a-C05 call card | Waiter's phone: action banner "F4 · Call" with zone and time, plus Inbox rows. Closed calls are greyed. |
| 02a-B10 lock banners | Warning-toned banner at the top end of the **order screen**, sticky, one tinted **Keep as draft**. Send is turned off underneath. Four frames: released by a manager, holder changed, other device, lock time. On the map, a force-move notice goes to the receiver. |
| 02-B02 offline | A sticky warning bar under the top bar ("Reconnecting… 2 waiting to send" / "…showing the last known tables" + "Ask for bill, Clean and Mark served still work"). Live pill reads "Hub offline". Queued tiles show a "Waiting to send" flag. |
| Sign-in | Reuses 01d tiles (104 px). A locked person is greyed with "Locked · 14 min". The 02b queue line sits under the grid. PIN pad (104 × 64 keys). 02-D01 and 02a-S00 are plain dialogs/pages. |

## 4. New string keys (English; Urdu drafts are on the Urdu frames)

| Key | English |
|---|---|
| `tables.zone.mine` / `.other` / `.count` | your zone / {name}'s zone / {n} tables |
| `tables.filter.all` / `.mine` | All tables / Mine |
| `tables.needs_you` | Needs you |
| `tables.state.free` / `.seated` / `.ordered` / `.eating` / `.bill` / `.clean` | Free / Seated / Ordered / Eating / Bill / To clean |
| `tables.lock.you` / `.name` | You / {name} |
| `tables.flag.waiting_to_send` / `.call_sent` / `.archived` | Waiting to send / Call sent · {n} min / Archived |
| `tables.archived_group` | Archived tables |
| `tables.empty` / `.empty_floor` / `.mine_empty` | No tables yet / No tables on this floor / You have no tables right now. |
| `sheet.your_table` / `.their_table` / `.open_for` / `.since` | Your table / {name}'s table / Open {n} min / since {time} |
| `sheet.take_order` / `.add_items_round` / `.take_over_from` / `.mark_clean` | Take order / Add items · Round {n} / Take over from {name} / Mark clean |
| `sheet.act.bill` / `.call` / `.hand` / `.more` / `.move` / `.join` / `.split` / `.release_mine` / `.release_other` / `.force_move` | Ask for bill / Call waiter / Hand over / More / Move party / Join a table / Split the party / Release my lock / Release {name}'s lock / Force move |
| `sheet.read_only_holder` | {name} has this table. Only {name} or a manager can take orders or hand it over. |
| `sheet.waiter_note` | You can mark food served and clean tables. |
| `sheet.offline` | Hub offline. Ask for bill and Clean will be sent when it's back. |
| `busy.title` / `.still_can` / `.own_other_screen` / `.open_here` / `.see_table` | {name} is taking an order here / You can still ask for the bill, call a waiter or clean. / You're ordering on {table} on another screen / Open here / See the table |
| `release.title` / `.body` / `.reason` / chips | Release {name}'s lock on {table}? / Anything he hasn't sent stays on his screen. / Reason / Went home · Tablet dead · Left the table · Other |
| `handover.title` / `.sub` / `.assigned_here` / `.working` / `.not_signed_in` / `.has_tables` / `.send` | Hand {table} to… / They must accept. Working people first. / Assigned here / Working / Not signed in / Has {n} tables / Send request |
| `handover.waiting` / `.waiting_late` / `.lead_told` / `.withdraw` | Waiting for {name} / Waiting for {name} — {n} min · ask her in person / Your lead was told / Withdraw |
| `handover.result.accepted` / `.declined` / `.closed` / `.to_someone_else` | {name} accepted {table} / {name} declined {table} / Handover of {table} closed: the table changed / Hand over to someone else |
| `forcemove.title` / `.sub` / `.give` / chips | Give {table} to {name} now? / {name} is not asked. This is logged. / Give table / Shift ended · Went home · Rebalance · Other |
| `forcemove.notice_receiver` | A manager gave you {table} |
| `move.title` / `.sub` / `.to` / `.tag_owner` / chips | Move {table} to… / Orders, holder and lock go with the party. / Move to {table} / {name}'s / AC · Bigger table · Guest asked · Other |
| `join.title` / `.free` / `.parties` / `.summary_absorb` | Join to {table} / Free tables / Other parties / {table}'s party ({n} order) joins {into}. One bill. |
| `split.title` / `.sub` / `.step_target` / `.step_orders` / `.just_free` / `.summary` | Split {table} / Orders move whole. Splitting a bill is at the cashier. / Target / Tick the orders that go to {table} / No orders — just free {table} / {n} order goes to {to}. {m} stay on {from}. |
| `call.title` / `.sub` / chips | Call a waiter to {table} / One tap sends. {names} get it; your screen stays quiet. / Water · Clear the table · Come to the table · Other |
| `call.nobody` / `.nobody_sub` | Nobody else is working — you can call again in 5 min / Go yourself or ask a manager |
| `bill.confirm` / `.ask` | Ask for the bill for {table}? / Ask |
| `clean.title` / `.body` / `.anyway_body` / `.anyway` | Mark {table} clean? / The table becomes free. / Clean anyway? His order stays on his screen as a draft. {table} becomes free. / Clean anyway |
| `lock.released_by` / `.released_ttl` / `.holder_changed` / `.other_device` / `.keep_draft` | Your table {table} was released by {name} / Your table {table} was released after {n} min without activity / {name} now has this table / Opened on another device / Keep as draft |
| `offline.bar` / `.bar_queue` / `.bar_hint` | Reconnecting… showing the last known tables / Reconnecting… {n} waiting to send / Ask for bill, Clean and Mark served still work |
| `pair.again` / `.again_sub` / `.show_code` | This screen must be paired again / Ask a manager. Unsent orders stay on this screen. / Show pairing code |
| `alert.table_handover.card` / `.lock` | Table handover / {table} · Table handover · {name} |
| `alert.call_waiter.card` / `.lock` | Call / {table} · Call waiter |
| Toasts | as in 02a-T01 (frame `Toasts`) |

## 5. Still open (owner)

- **Spec palette update**: 02a §8 must take the Pulse palette (owner chose it today).
- **Hub gaps** that keep frames generic: call card without the caller or chip (Q14), `my-requests` without the receiver/table (Q20), `my_floors` with no floor list (Q6), bill paid not pushed live (Q5).
- **01d shared change**: a phone answer sheet now exists (`HandoverAnswerPhone`). 01d's approval kinds can reuse it.
- **Next frame set** (after review): Urdu for every remaining screen, the portrait/phone variants of each dialog, kiosk dialogs, the queue-log rows for Bill/Clean (drawn in 02b), and `426 Update the app`.
