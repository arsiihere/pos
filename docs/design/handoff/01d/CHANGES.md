# Module 01d — design decisions in the Pulse frames (core set)

01d had no frames. Every frame here is new and designed from the 01d inventory (spec v1.0, approved 2026-11-01). The sample request is a **void on T12** raised by Hamza (Rs 2,200, “Customer changed mind”). Imran (manager) is the approver.

**Look:** the chosen staff-app direction is **Pulse Chatkhara** with **Puck+** tables: maroon top bar, cream ground, white rounded cards, saffron primary, Bricolage Grotesque + Figtree. The banner frames sit over the real Puck+ tables screen.

**Styles:** `design/pulse.css` (structure), `design/v-brand.css` (Chatkhara tokens; white-label inputs are the brand colours), and `design/pulse-01d.css` (the new 01d patterns). Owner and hub-admin screens keep `ds/pos` + `kit-additions.css`.

## 1. UX review: what the brief asked for vs what the frames do (less clutter)

| Brief | Frames | Why |
|---|---|---|
| Inbox filter chips All · Open · Requests · Notices (proposed) | **Dropped.** The Inbox is one list: open items first, then newest. | “Requests” already has its own tab, so the chips repeated it. |
| Banner with Open (the old 04 toast also had **Later**) | **Open only.** There is no Later, snooze or close on an urgent banner. | G1-14 e: no snooze. Info and action banners hide by themselves. |
| Banner shows the sound behaviour | Not shown on screen. The sound rules are in §4 below. | Keeps the banner short. |
| Touch targets 48 px (brief §1) | **56 px** on tablet, kiosk and phone; the kitchen screen keeps 72 px. | Pulse rule for every module. |
| Times “14:02” | **12-hour, “2:02 PM”** | Matches the 02, 03b and 04 screens already in the kit. Says “use the app’s time format”, not a fixed 24-hour one. |
| A “You approved” receipt on the answering device | Never shown there. The sheet shows a short **Approved**, then closes. | §3.10 hidden-seat rule. |

## 2. Designer questions (DQ1–DQ6) — answered

| # | Decision |
|---|---|
| **DQ1** Banner and badge position | **Badge:** on 01d’s own screens it sits in a segmented nav in the maroon top bar: Inbox (red count), Requests (red count, approvers only), Test alert (manage-devices only). On 02 / 05 screens it sits in two icon buttons in the top bar, **Requests** (shield) and **Inbox** (tray), each with a red badge; these replace the single bell. **Banner:** drops in at the top-end corner under the top bar (`top: 92px; inset-inline-end: 20px; width: 470px`). It covers part of the “Needs you” panel but never the New order, Send or Pay buttons at the bottom. On portrait tablet it spans the width below the nav row; on the phone, below the header. |
| **DQ2** Requests: a screen or an Inbox tab? | **Its own screen** (`#/requests`) with its own nav tab and badge. Its list is computed now, not taken from the inbox (J5), so it stays a separate screen. |
| **DQ3** Stacking | **At most 2 banners**, newest on top. Anything beyond that collapses into a dark bar: “**{n} more new** · Open inbox”. |
| **DQ4** Family colours and icons | Every mark is **icon + word**, and each family has a different shape: **Urgent** = filled red pill with a ringing bell; **Action** = blue outlined pill with a hand; **Info** = neutral outlined pill with “i”; **Receipt** (the silent kind) = no fill, bell-off icon. The card’s start edge uses the same colour. Dark theme (KDS) uses the dark tokens; see `CardsDark`. |
| **DQ5** “For Ali” group | One collapsible group per person: “For Ali · 2 · no device”, holding their cards. The first group is open and the rest are closed. Requests never appear in these groups. |
| **DQ6** Tones | Web Audio, no files. See §4. |

## 3. Per screen

| Screen | Decision |
|---|---|
| 01d-C01 card | Two sizes. **Open card** (open requests and action alerts) shows:<br>• a **waiting ring** on the leading side: minutes inside, filling toward escalation (“1d” for an earlier day);<br>• a family pill and tags;<br>• the table chip (saffron, mono), then the kind;<br>• “from Hamza · 2:02 PM” and the details line;<br>• the amount (large), then **Answer**.<br>New: a coloured outline plus a red dot. Read only: no Answer button, chevron only.<br>**Row** (notices, receipts, closed): a tinted icon or table tile, family pill + title, one sub line, time and chevron. Closed rows are greyed and show the result line. In both sizes the **whole card** is the tap target. |
| Lock text | One line, “T12 · Void request · Hamza”, plus the family mark and the time. It never shows an amount, item or reason. |
| 01d-B01 banner | Floating white card with a coloured outline: waiting ring, family pill, tags, table chip, kind, from, and one details line. Its **Open** is a tinted button (not primary), so the screen keeps one primary. Above 2 banners, a maroon pill reads “{n} more new · Open inbox”. Always-on screens get lock text only. |
| 01d-B05 header | The third line of the brand block in the top bar, on every tablet screen, signed in or not: “🔔 Alerts: **Ali** — pauses at **2:05 PM**”, “Alerts paused”, or “Alerts: none”. Always visible and never inside a menu; the top bar itself stays at 80 px. |
| 01d-S00 | The 02 name tiles plus the B05 strip. The tablet page shows no lock text (9b handles that). |
| 01d-F01 | On a signed-out kiosk or phone, a dark panel above the tiles or PIN: “Alerts · Sign in to see details”, then up to 3 lock lines. |
| 01d-S01 | Two cards side by side: **Open · n** (big cards) and **Today · n** (rows, newest first, Load more). This keeps the brief’s order (open first). Portrait and phone stack them. A lead sees “For {name}” groups in Today. Offline: the last list stays, with the B03 line across the top. Empty: green ring, “Nothing needs you right now.” |
| 01d-S02 | Same two-card layout: **You can answer · n** (oldest first) and **For your information · n** (read-only cards). A row answered elsewhere turns into a closed row, “Approved by Sana”, then slides out. |
| 01d-D01 | **Centred dialog** (600 px) on tablet landscape and kiosk; **bottom sheet** on tablet portrait. The head has:<br>• the large saffron table chip (T12);<br>• the family pill and step tag;<br>• the kind (26 px);<br>• “from Hamza · 2:02 PM” with a red “waiting 2 min” tag.<br>Then four fact tiles: Item, Quantity, Amount (30 px), Reason. Then two 72 px buttons: **Reject** (red tint) and **Approve** (primary, wider). Accept kinds show **Decline / Accept** and need no PIN. |
| “Approve here” | Shown only on the raising device: a text link with an icon, under the line “Waiting for Imran or a manager.” Not shown on any other device. |
| 01d-D02 | Same dialog with Back. It shows “Imran, enter your PIN to approve / to reject”, the request in one line, 4 dots and a 3×4 pad (104×64 keys). The last key is the saffron **Approve** / **Reject**, the layer’s only primary. Below the pad: “Your PIN is not kept.” Each error shows as one line above the pad. Locked out or offline: keys turned off. |
| 01d-D03 | “Who is approving?” with the approver tiles (people without a PIN never appear), then “Imran’s PIN” with the line “Imran will be told on his own devices that he approved here.” |
| 01d-D04 | A notice sheet: family mark, the title line, a facts box (When / Device / Request / Amount), and for N01 / N03 the line “Not you? …”. **Close** is the only (primary) button. On the phone it is a bottom sheet. |
| 01d-B02 | The facts stay visible. A grey line replaces the buttons (“You can’t approve this — not your team. Find Imran or a manager.”), and Close is the only button. |
| 01d-B03 | A danger banner inside the dialog. The buttons and PIN pad are turned off and the sheet stays open. The top bar chip changes to Hub offline. |
| 01d-B04 | Danger banner in the dialog, or a one-line message in the PIN step. A 409 closes the sheet and shows a toast, “Already approved by Sana.” |
| 01d-B06 | A sticky warn banner under the top bar: “No one can approve voids right now.” On KDS it uses the dark banner and sits next to the escalation lock line. |
| 01d-B07 | A warn banner at the top of 00 hub admin home, above the tiles. Hidden at 0. |
| 01d-S03 | Segmented control: Person · Team · Device · Point. Point is off, with the help line “Point: available after points are set up.” Below it, a radio list (device rows show an online dot, person rows say “no PIN” where that applies). On the right, a summary card “Sends a test alert to …” with **Send test** (primary). |
| 01d-S04 | Header with family, kind, “Sent 2:10 PM by Imran · to …” and an **Updating** chip while live. Then one table per step (Sent, Reminder, Escalated) with columns Person · Device / route · Delivered · Seen · Note. Notes: No route, Hidden (answering seat). Nobody reached → empty state. |

## 4. Sounds (DQ6) — Web Audio, no files; volume follows the device

| Sound | When | Recipe (OscillatorNode, sine; gain 0 → 0.6 → 0 in 10 ms / 120 ms) |
|---|---|---|
| Urgent | approvals | 660 Hz for 150 ms, 40 ms gap, 880 Hz for 220 ms. Repeats every 10 s until seen, then once every 2 min. At escalation the gain steps up by one (0.6 → 0.8). |
| Action | later modules | 784 Hz for 120 ms, 80 ms gap, 784 Hz for 120 ms. Once. |
| Info | results, notices, warnings, test | 523 Hz for 300 ms, soft attack of 30 ms. Once. |
| Rising | N04 approved | 523 → 784 Hz glide over 260 ms. |
| Falling | N04 rejected | 784 → 523 Hz glide over 260 ms. |
| Silent | receipt (N02) | none |

Always-on screens (kiosk, KDS) play one sound per step, then show the badge only. The screen keeps no snooze and no mute.

## 5. New string keys (English; Urdu drafts on the Urdu frames)

| Key (suggested) | English |
|---|---|
| `alerts.family.urgent` / `.action` / `.info` / `.silent` | Urgent / Action / Info / Receipt |
| `alerts.from` | from {name} |
| `alerts.waiting` | waiting {n} min |
| `alerts.tag.reminder` / `.escalated` / `.for` / `.moved` / `.earlier` / `.read_only` | Reminder / Escalated / For {name} / Moved to {name} / from {date} / Read only |
| `alerts.closed.approved` / `.rejected` / `.withdrawn` / `.bill_closed` / `.expired` | Approved by {name} {time} / Rejected by {name} {time} / Withdrawn / Closed: bill closed / Expired |
| `alerts.open` / `alerts.more_new` / `alerts.open_inbox` | Open / {n} more new / Open inbox |
| `alerts.nav.inbox` / `.requests` / `.test` | Inbox / Requests / Test alert |
| `alerts.today` / `alerts.empty` | Today / Nothing needs you right now. |
| `requests.can_answer` / `.fyi` / `.empty` | You can answer / For your information / No requests waiting. |
| `alerts.for_group` | For {name} · {n} · no device |
| `answer.item` / `.quantity` / `.amount` / `.reason` | Item / Quantity / Amount / Reason |
| `answer.approve` / `.reject` / `.accept` / `.decline` | Approve / Reject / Accept / Decline |
| `answer.pin_title_approve` / `_reject` | {name}, enter your PIN to approve / {name}, enter your PIN to reject |
| `answer.pin_not_kept` | Your PIN is not kept. |
| `answer.done_approved` / `.done_rejected` | Approved / Rejected |
| `answer.waiting_for` | Waiting for {name} or a manager. |
| `answer.here` / `answer.who` / `answer.their_pin` / `answer.here_help` | Approve here / Who is approving? / {name}’s PIN / {name} will be told on his own devices that he approved here. |
| `answer.ro_team` / `.ro_informed` / `.ro_removed` | You can’t approve this — not your team. Find {name} or a manager. / For your information. {name} or a manager can approve. / You can’t approve this any more. |
| `notice.in_person_title` / `.pin_failed_title` / `.not_you` | You approved the {kind} on {table} at {requester}’s tablet / Your PIN was entered on {device} and the answer failed / Not you? Change your PIN and tell the owner. |
| `bind.active` / `.paused` / `.none` | Alerts: {name} — pauses at {time} / Alerts paused / Alerts: none |
| `lock.title` / `lock.sign_in` | Alerts / Sign in to see details |
| `test.send_to` / `.point_off` / `.summary` / `.send` / `.after` | Send to / Point: available after points are set up. / Sends a test alert to / Send test / You see when it arrives and is seen, on which device. |
| `receipts.person` / `.route` / `.delivered` / `.seen` / `.note` / `.updating` / `.nobody` | Person / Device / route / Delivered / Seen / Note / Updating / Nobody could be reached. |
| `receipts.no_route` / `.hidden_seat` | No route / Hidden (answering seat) |
| `admin.stuck` | Stuck alerts: {n} — an alert stopped sending reminders. It can still be answered. |
| Error texts | As in brief §6 (unchanged). |

## 6. Still open

- **Owner OK on 12-hour times** (the brief writes 14:02; the frames use 2:02 PM, as 02, 03b and 04 do).
- **Shared change to 02 / 04:** the old 04 frames have “Approvals” and “Alerts” buttons in the top bar. 01d replaces them with **Requests (n)** and **Inbox (n)**. The 04 approval screens become 01d-S02 / D01; the money-kind reason picker in 04 stays with the owning module.
- **Next frame set (after review):** Urdu for every remaining screen; portrait versions of S03 / S04; the phone inbox with an earlier-day notice; D01 states for each B04 error code; the N04 outcomes withdrawn, obsolete and overridden; the accept kind on the kiosk.
