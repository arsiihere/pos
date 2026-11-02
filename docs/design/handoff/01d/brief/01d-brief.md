01d — Notifications and requests: screen inventory

Spec: docs/specs/01d_Notifications_Requests_Spec_v1.0.md (APPROVED 2026-11-01, with foundation v1.8, 00 v1.6 and 01b v1.4). Every API name, field, limit and error code below comes from that spec; section numbers are cited as §. Where the spec gives no wording, the text is marked (proposed copy) and the designer may change it, but not the behaviour. Decisions behind it: docs/stories/01d-g0-decisions.md (G0) and docs/stories/01d-g1-decisions.md (G1). Build-time rulings: docs/plans/01d-status.md (AD-n). Conventions in 00-index.md.

Status: spec approved; backend being built (plan docs/plans/01d-plan.md, batches 0–8); the staff entry /staff/ is built in batch 9a (tasks 39–42) with the Pulse ui-kit, functional, not designed. This inventory is for the designed pass. No first hand-off exists for 01d, so §10 lists every frame as new.

What 01d does not draw:

The requester's waiting card and my requests screen — built by 02 / 04 with their first request kind (AD-1). Listed in §9.
The Android notification with the screen off, lock-task and the app-update screens — tablet app, batch 9b (docs/plans/01d-tablet-plan.md).
The alert kinds of later modules (void, discount, comp, table accept, zone transfer, Ready to serve, Call, slip warning). They reuse every component here with their own label and details; this file uses a void as the sample request because it is the first one the pilot will see.
"Present today", pager and lane assignment (01e shift-start screen; 01d only has the SetPresence command).
1. Who and where
Who	Device	Network	How often	Conditions
Approver — manager (Imran), or anyone whose role approves (01b approver roles)	Restaurant tablet T (1280, portrait and landscape, locked, R33); cashier kiosk K	Hub LAN only, no internet needed	In the pilot: many times per shift (voids, discounts, comps from 04 / 05)	Rush, standing, one hand, noisy, often walking the floor
Requester — order taker (Hamza), cashier (Sana)	T, K	Hub LAN	Raises requests in 02 / 04 / 05; gets the result here	Rush; waits for the answer with a customer in front
Lead of a team (an order taker with waiters under them)	T	Hub LAN	Gets alerts "for" team members who have no device	Rush
Always-on screens — cashier kiosk, kitchen screens (KDS), point tablets	K, W	Hub LAN	See escalations and the "no one can approve" warning, lock text only	KDS: dark, read at 1–3 m, greasy hands
Manager doing setup or support	T, K	Hub LAN	Test alerts at installation; checking "it never came to me"	Calm
Staff phone (optional, R33)	P (360–390, browser)	Hub LAN	Only where a restaurant uses personal phones; browser only in the pilot	Pocket
Owner (Arif)	—	—	Not in 01d (the money view is 05 / 07)	—

Every 01d screen is designed at T 1280 (landscape and portrait) and K 1920 × 1080, in English and in Urdu (RTL). The banner, inbox and answer sheet also at P 390. W (KDS) only needs the lock-text banner (B06, F01) in the dark theme. Tablet layouts are touch-first (48 px targets); the kiosk has no browser back, so every screen needs its own way back.

2. Jobs to be done
#	Job	Source	Acceptance
J1	When something needs me, I am told on my own device, with a sound I recognise by its type.	E-NOTIF AC1–2, G0 N2–N3, §8.3	banner + family sound + inbox row; urgent repeats until seen
J2	I see what I am asked to approve (item, quantity, amount, reason) before I answer.	G0 N7, G1-21.5, §3.12	details on the signed-in card only
J3	I approve or reject on my own tablet with my PIN; accepts are one tap.	E-REQ AC1–2, G1-10, §3.3	PIN pad for money kinds; one tap for accept kinds
J4	Whoever answers first wins; the others see who did.	E-REQ AC6, §3.3 rule 1	"Already approved by Imran"
J5	When I come back from a break, I see every request I may still answer.	v0.5 N3, §6.9	list computed now, not from the inbox
J6	If I can't answer a request, I know why and who can.	G1-9 b, G1-23	read-only: "Find Imran or a manager"
J7	When I'm standing at the requester's tablet, I can approve there with my PIN.	E-REQ AC4, G1-7 d, v1.0 #2	"Approve here" only on the raising device
J8	If my PIN is used on someone else's device, or a PIN match fails, I am told — so a shared PIN is noticed.	R1, R2, §3.10	audible notice on my own devices; silent receipt for every money answer
J9	I can see whose alerts this tablet is getting and until when.	G1-13 c, v0.5 N6, §3.7	header line on every tablet screen
J10	I can't answer without the hub, and my PIN is never kept.	v0.4 M4, H-10, §8.1	PIN pad disabled offline; PIN dropped after the request
J11	As a manager, I send a test alert and see if it arrived and was seen, on which device.	G1-21.7, §6.5, §6.10	receipts per step, per device, with bound person
J12	As cashier / kitchen, I'm warned when nobody at the branch can approve right now.	G1-9 e, §3.9	sticky warning on always-on screens
J13	As a manager, I see if an alert has stopped sending reminders.	AD-116	"Stuck alerts: N" on the hub admin
J14	Every alert and answer is recorded (who, when, which device).	E-NOTIF AC6, G0 N5	no screen except receipts (J11); viewer in 05 / 07
3. Screen list
ID	Name	Kind	Route (proposed)	Device
01d-S00	Staff sign-in (reuses the PIN tiles + PIN pad from 00 / admin-stock)	screen	/staff/	T K P
01d-C01	Alert card (one alert)	component	—	T K P
01d-C02	Alert badge (unseen count)	component	app header	T K P
01d-B01	Alert banner (arrives over any staff screen)	banner	any	T K P
01d-S01	Inbox	screen	#/inbox	T K P
01d-S02	Requests to answer	screen (or Inbox tab, DQ2)	#/requests	T K
01d-D01	Request detail / answer sheet	sheet	over S01 / S02	T K
01d-D02	PIN step of the answer (reuses PinPad)	sheet step	in D01	T K
01d-D03	Approve here (in person): pick approver → their PIN	sheet	in D01	T K (raising device only)
01d-D04	Notice detail (N01, N03, N04, test alert)	sheet	over S01	T K P
01d-B02	Read-only request line	inline state	D01	T K
01d-B03	No connection to the hub	inline state	D01, D02	T K
01d-B04	Answer error states	inline / toast	D01, D02, D03	T K
01d-B05	Tablet alerts header	header strip	every tablet screen	T
01d-B06	"No one can approve … right now"	sticky banner	always-on screens + approvers	K W T
01d-N01	"You approved on Hamza's tablet" (answered on requester's device)	notice card	inbox + banner	T K P (own devices only)
01d-N02	Approval receipt (silent)	inbox row only	inbox	T K P
01d-N03	"Your PIN was used on Tablet 3 and the answer failed"	notice card	inbox + banner	T K P
01d-N04	Request result to the requester	notice card	inbox + banner	T K P
01d-F01	Lock text (signed-out overlay; later the Android notification)	text pattern	signed-out kiosk / phone	K P (T in 9b)
01d-S03	Send test alert	screen	#/test-alert	T K
01d-S04	Receipts	screen	#/receipts/:alert_id	T K
01d-B07	"Stuck alerts: N"	row on hub admin home (00 /admin)	/admin	K

Count: 23. The staff entry nav: Inbox (badge) · Requests (badge, only for people who can approve anything) · Test alert (only with manage-devices) · footer Sign out. 02 later adds its ordering screens to the same entry; the banner and badge must sit above them (DQ1).

4. Rules every screen follows
Rule	Source
Two text levels for every alert. Card (signed in, on the person's own staff session): kind label, table, point, requester, time and details (item, quantity, amount, reason). Lock (everything else: signed-out pages, kiosk and KDS as device targets, the tablet notification): kind label, table, point, requester only — never amounts, items or reasons. Design both for every alert.	G1-13 e, §3.12, §6 batch 3
Three families, told apart by icon + word and rhythm, never by colour alone: Urgent (approvals), Action (go and do something — later modules), Info (results, notices, warnings, test).	G0-2, §8.3
Silent kind (approval_receipt): no banner, no sound, never re-notified — an inbox row and the badge only.	§8.1, v1.0 #2
Hidden from the answering seat. The approval receipt (N02) and the "answered on requester's device" notice (N01) never appear on the session or device that gave the answer, until the business day closes. Never show a "you approved" receipt on that device; a short "Approved" confirmation on the sheet is enough.	§3.10, v1.0 #2
PIN only while online. While the hub socket is down the PIN pad and the answer buttons are disabled (B03). The PIN is held in memory only until the response, then cleared — also on an error. It is never saved or queued.	§8.1, H-10
No snooze, no mute. Volume follows the device.	G1-14 e
Always-on screens (kiosk, KDS, point tablets): one sound per step, then the badge only.	G1-14 d, §8.3
Re-notify once after a reconnect if an urgent / action alert arrived while offline and was not seen.	§8.1, m6
Never show a permission key or a kind key. Always the plain label (alert.<kind>.card / .lock).	§3.12
Urdu. Every string has EN and UR keys (00 M83). Tables, amounts, times, PINs, device names, codes are LTR (.pos-ltr). Latin digits in Urdu mode (R20).	§3.12
Queries never keep a session alive (countsAsActivity: false); tapping an alert (MarkAlertsSeen) does.	§6.4, §6.7–6.9
5. Per screen
01d-S00 Staff sign-in — /staff/

Purpose: sign in on a shared tablet or kiosk. Reuse: the 00 / admin-stock staff PIN flow (name tiles → PIN pad) — no new design except the header (B05) and the signed-out alert overlay (F01). Exit: S01.

Kiosk and phone pages show lock-text alerts while nobody is signed in (F01). The tablet page does not (the 9b service handles it).
People without a PIN (watch waiters, chefs) never appear on the tiles (01b B3, v1.4 B-1).
01d-C01 Alert card
Element	Content	Source / rule
Family mark	icon + word: Urgent / Action / Info	family
Kind label	"Void request", "Test alert", "Request approved", "No one can approve"	kind_label_key (EN/UR)
Table	"T12"	table_code, LTR; empty for test and warnings
Point	"Pass"	point_code; empty in 01d
Requester	"Hamza"	requester_name
Details (card only)	"Chicken Karahi — Full ×1 · Rs 2,200 · Customer changed mind"	details { item, quantity, amount, reason }, signed in, own session
Time	"14:02" and, for open requests, "waiting 2 min"	raised_at, LTR
Step marker	"Reminder" (step 1) · "Escalated" (step 2)	step, escalation
For tag	"For Ali" — a lead holding alerts for someone with no device; never on requests	for_staff_name (v0.5 N5)
Moved tag	"Moved to Bilal" (table handover, 02)	moved_to_name
From tag	"from 1 Nov" — open request or notice from an earlier business day, no sound	from_business_day (BF-4)
Seen dot	until opened	seen_by_me
Closed state	greyed + result: "Approved by Imran 14:03" · "Withdrawn" · "Closed: bill closed" · "Expired"	state, close_reason, outcome (AD rulings)

States to draw per family: new / seen / closed; card vs lock; with and without details; long names (40 chars) and Urdu.

01d-C02 Alert badge
Count of unseen inbox items, silent receipts included. Separate count on Requests = requests I can answer that are still open.
0 → hidden. Over 99 → "99+".
01d-B01 Alert banner

Purpose: get attention without stopping work. Shows: C01 card text (or lock text when that's all the device gets), family mark, Open.

Family	Banner behaviour	Sound
Urgent	stays until opened, or until the person sees it on another device (alert_seen)	two-tone rising, every 10 s until seen; then one reminder every 2 min; at the escalation step one volume step-up
Action	auto-hides into the badge after a few seconds (proposed: 6 s)	double ding, once
Info	auto-hides (proposed: 4 s)	soft chime, once
Silent	no banner	none
Several at once: stack, newest on top, then collapse to "3 new" (proposed copy; DQ3).
Always-on screens: lock text only, one sound per step, then badge only.
After a reconnect: an urgent / action alert not yet shown and not seen → shown once more.
01d-S01 Inbox — #/inbox

Purpose: everything that needed me today, and what's still open. Entry: nav, banner, badge. Exit: D01 (request), D04 (notice).

Data: GET /queries/alerts-inbox?cursor&limit (§6.7; default 50, max 200) → AlertView + seen_by_me, moved_to_name, for_staff_name, state, close_reason; today's alerts, alerts "for" my reports, my open personal notices from earlier days, minus anything hidden from this seat. Order: open action alerts first, then newest first.

Layout (T landscape / K): app bar "Inbox" + badge · optional filter chips All · Open · Requests · Notices (proposed) · list of C01 cards · "Load more". T portrait / P: stacked cards, full width.

State	What shows
Loading	skeleton cards
Empty	"Nothing needs you right now." (proposed copy)
"For" group (lead)	"For Ali (2)" collapsible group per person; their cards inside (G1-18 a)
Earlier day	open notices/requests from earlier days at the top with "from 1 Nov"
Closed alert	greyed, result line, still tappable for detail
Offline	list kept as last loaded + B03 line at the top; tapping still opens details
Signed out by idle	back to S00 (the tablet header keeps showing whose alerts it gets)
Tapping a card: opens D01 / D04 and sends MarkAlertsSeen (§6.4; batched up to 50 ids).
01d-S02 Requests to answer — #/requests

Purpose: every open request I may answer now, even if I signed in after it was sent (J5). Data: GET /queries/requests-to-answer (§6.9) → open requests with can_answer: true, plus read-only rows (informed, "for" rows, a right removed) with their set.

Layout: two sections — You can answer (count) and For your information (count). Each row: C01 + waiting time + chevron. Sorted oldest first (proposed: the longest wait on top).

State	What shows
Empty	"No requests waiting." (proposed)
Answered elsewhere	row slides out with "Approved by Imran" (from alert_closed)
Earlier day	"from 1 Nov", no sound
Offline	rows kept, answering disabled (B03)
Not an approver at all	nav item hidden
01d-D01 Request detail / answer sheet

Purpose: decide. Entry: S01, S02, B01. Exit: closes on answer.

Element	Money kind (void, discount, comp)	Accept kind (table handover, zone transfer)
Header	kind label · T12 · from Hamza · waiting 2 min	same
Details	item, quantity, amount, reason (card)	table, from whom, what moves
Buttons	Approve · Reject	Accept · Decline
PIN	always → D02 after choosing	none — one tap (method: 'session')
In person	link Approve here → D03, only on the device the request was raised on (raised_device_id)	—
Out of range / informed	B02 instead of the buttons	B02

Action: POST /commands/answer-request { alert_id, decision, method, answerer_staff_id?, pin? } (§6.2). After success: sheet closes with "Approved" / "Rejected" (proposed copy); the card shows the closed state. Nothing else on this device (hidden seat).

States: open · answering (buttons busy) · answered · answered elsewhere (B04 row 1) · offline (B03) · each error (B04).

01d-D02 PIN step
Title: "Imran, enter your PIN to approve" / "…to reject" (proposed). Reuses PinPad: 4–6 digits, masked, LTR, numeric.
Only the signed-in person's PIN here (method: 'pin'). In person uses D03.
Disabled with B03 when offline. The PIN is cleared after the request, success or error.
State	Text
Wrong PIN	"Wrong PIN."
Locked out	"Too many tries — wait {n} min." (proposed; 00 lockout)
Busy (503)	"Busy — try again." (proposed)
01d-D03 Approve here (in person)

When: the approver walks to the requester's device. Only on the raising device — other devices never show the link (the server would answer in_person_elsewhere).

"Who is approving?" — name tiles of people who may approve (reuses StaffTiles; people without a PIN never shown).
Their PIN: "Imran's PIN" (D02 pad).
AnswerRequest { method: 'in_person', answerer_staff_id, pin }.
Help line: "Imran will be told on his own devices that he approved here." (proposed copy; it is the anti-cheat deterrent, R2).
Errors: B04 (STAFF_NOT_FOUND → "That person can't approve here.").
01d-D04 Notice detail

Simple sheet for non-request alerts: full card text, time, device name where relevant, Close. Opening it marks it seen; a closes_on: seen notice (request result, PIN notices) closes — except on the answering seat, where it can't be seen or closed (§6.4).

01d-B02 Read-only request line
Case (set / reason)	Text
Out of range (other team, my_team scope)	"You can't approve this — not your team. Find Imran or a manager." (proposed; spec: "Find <approver> or a manager")
Informed after escalation	"For your information. Imran or a manager can approve." (proposed)
Right removed since	"You can't approve this any more." (proposed)
01d-B03 No connection to the hub

"No connection to the hub — try again." (§8.1). Answer buttons and PIN pad disabled; the sheet stays open; the typed PIN is cleared. Returns to normal by itself when the socket reconnects.

01d-B04 Answer errors
Code (details)	Where	Text
409 REQUEST_NOT_PENDING { answered_by_name, decision }	sheet → closes	"Already approved by {name}." / "Already rejected by {name}." / "Withdrawn by {requester}." (§8.1)
403 PERMISSION_DENIED { reason: 'out_of_range' }	sheet	"Not your team — a manager can approve." (§8.1)
403 { reason: 'in_person_elsewhere' }	D03	"In person only on the requester's device." (§8.1)
403 { reason: 'self' }	sheet	"You can't approve your own request." (proposed)
403 { reason: 'not_approver' }	sheet	"You can't approve this." (proposed)
422 REQUEST_PIN_REQUIRED	sheet	open D02
401 PIN_INVALID	D02	"Wrong PIN."
429 PIN_LOCKED_OUT / DEVICE_LOCKED_OUT	D02	"Too many tries — wait {n} min." (proposed)
404 ALERT_NOT_FOUND	sheet → closes	"This request is no longer there." (proposed)
404 STAFF_NOT_FOUND (in person)	D03	"That person can't approve here." (proposed)
400 VALIDATION_FAILED	sheet	"Something went wrong. Try again." (proposed)
503 SERVICE_UNAVAILABLE	D02	"Busy — try again." (proposed)
the kind's own refusal (e.g. bill already closed, from 04)	sheet	the owning module's text
network error	sheet	B03
01d-B05 Tablet alerts header (T only)

Always visible on every tablet screen, signed in or not (G1-13 c). Data: binding from the hub, binding_route_until, binding_route frames (BF-5).

State	Text (§8.1)
Bound, alerts active	"Alerts: Ali — pauses at 14:05"
Time passed	"Alerts paused" (one info chime when it changes)
No binding	"Alerts: none"
A sign-in on this tablet refreshes it. Small but readable; never inside a menu (it shows a wrong binding at a glance).
01d-B06 No one can approve

Sticky banner: "No one can approve voids right now." (one line per permission that needs approval; 01d only knows the permissions, the names come from 01b labels) (spec text: "No one can approve voids right now"). Shown on always-on screens and managers' devices; info family, one sound, no repeat. Clears by itself when an approver signs in; expires at day close.

01d-N01 Answered on the requester's device (audible)

On the approver's own devices only (never the device used, never a lead's "for" copy): "You approved the void on T12 at Hamza's tablet — 14:03." (proposed copy). Info family, audible. Stays until the approver opens it while signed in on another seat; survives day close (shows "from 1 Nov"). Why it exists: if Imran didn't do it, his PIN is shared (R2).

01d-N02 Approval receipt (silent)

Inbox row only, on the approver's own devices except the answering seat: "You approved: Void T12 · Rs 2,200 · 14:03." (proposed). No banner, no sound; badge only. Sent for every money answer (approve or reject).

01d-N03 PIN used, answer failed

"Your PIN was entered on Tablet 3 at 14:05 and the answer failed." (proposed). Own devices only, audible info.

01d-N04 Request result (requester)
outcome	Text (proposed)	Sound
approved	"Void T12 approved by Imran."	rising chime
rejected	"Void T12 rejected by Imran."	falling tone
withdrawn	"You withdrew the void request."	none
obsolete	"Void request closed: {owner's reason}."	info chime
overridden	"Void overridden by the manager."	info chime

Closes when the requester sees it. outcome is also on lock frames (no amounts), so the right chime plays even signed out.

01d-F01 Lock text

One line per alert, no details: "T12 · Void request · Hamza", "Test alert · from Imran", "No one can approve voids". Where: signed-out kiosk / phone overlay (01d), the Android notification (9b), and later KDS / point tablets as always-on screens. Design the overlay (list of up to 3 lines + "Sign in to see details") (proposed).

01d-S03 Send test alert — #/test-alert (needs manage-devices)

Purpose: prove delivery at installation and when someone says "it never came". Action: POST /commands/send-test-alert { target } (§6.5).

Field	UI	API	Rule
Send to	segmented Person · Team · Device · Point	target.kind	Point disabled: "Available after points are set up." (proposed; 422 points_not_available)
Person	staff picker, people without a PIN included	staff_id	active staff at this branch
Team	lead picker + Direct reports / Whole team	lead_staff_id, depth	default direct
Device	device list: name, type, online dot; revoked hidden	device_id	
Button	Send test		→ opens S04 for the new alert_id

Errors: 404 STAFF_NOT_FOUND / DEVICE_NOT_FOUND → "Not found — reload the list." (proposed); 403 → nav item hidden.

01d-S04 Receipts — #/receipts/:alert_id (needs manage-devices)

Data: GET /queries/alert-receipts?alert_id= (§6.10). Live-updating while open (proposed: re-fetch every 5 s).

Layout: header (kind, raised time, by whom) · one section per step (Sent, Reminder, Escalated) · rows:

Column	Example
Person	Ali
Device / route	"Tablet 3 (signed in)" · "Tablet 3, bound to Ali (not signed in)" · "Cashier kiosk (screen)" · "Pager 5" (01e)
Delivered	14:02:03 or —
Seen	14:02:40 or —
Note	"No route" (no device and not signed in) · "Hidden (answering seat)"

States: loading · not found (404) · no recipients ("Nobody could be reached." (proposed)).

01d-B07 Stuck alerts (hub admin home)

Row on 00's /admin: "Stuck alerts: 1 — an alert stopped sending reminders. It can still be answered." (proposed copy; AD-116). Hidden at 0.

6. Error texts (one place)
Code	Text (English)	Source
REQUEST_NOT_PENDING	Already approved by {name}.	§8.1
PERMISSION_DENIED out_of_range	Not your team — a manager can approve.	§8.1
PERMISSION_DENIED in_person_elsewhere	In person only on the requester's device.	§8.1
PERMISSION_DENIED self	You can't approve your own request.	proposed
PERMISSION_DENIED not_approver	You can't approve this.	proposed
REQUEST_PIN_REQUIRED	→ PIN pad	§8.1
PIN_INVALID	Wrong PIN.	00
PIN_LOCKED_OUT / DEVICE_LOCKED_OUT	Too many tries — wait {n} min.	proposed
ALERT_NOT_FOUND	This request is no longer there.	proposed
STAFF_NOT_FOUND (in person)	That person can't approve here.	proposed
SERVICE_UNAVAILABLE	Busy — try again.	proposed
network / socket down	No connection to the hub — try again.	§8.1

All strings in English and Urdu (alert.<kind>.card, alert.<kind>.lock, alerts.*, errors.<CODE>); missing Urdu goes to docs/design/handoff/01d/urdu-todo.md.

7. Flows (each is a page test)
Approve on own tablet: Hamza raises a void (04) → Imran's tablet: urgent banner, repeat every 10 s → Open → D01 shows Chicken Karahi Full ×1 Rs 2,200 → Approve → D02 PIN → closes "Approved" → Hamza: N04 rising chime → Imran's phone/other device: N02 (silent). Unhappy: wrong PIN; locked out; hub drops mid-PIN (B03); Sana answered first (B04 "Already approved by Sana").
Late approver: request escalated at 2 min; second manager signs in at 15:10 → S02 lists it under You can answer.
Out of range: Bilal (lead of another team) opens it → B02.
In person: Imran walks to Hamza's tablet → Approve here → picks Imran → PIN → done → Imran's own tablet later shows N01 (audible). Unhappy: tries "Approve here" on another tablet → link not shown.
Accept kind (02, later): Bilal gets a table handover → D01 → Accept (one tap).
Installation check: manager → S03 → Device "Tablet 3" → S04: delivered and seen times. Unhappy: "No route".
Nobody to approve: last manager signs out → B06 on kiosk and KDS → manager signs in → clears.
Tablet header: Ali signs in, idles out → header "Alerts: Ali — pauses at 16:05" → after 16:05 "Alerts paused".
Signed-out kiosk: kiosk idle, no session → F01 overlay shows "T12 · Void request · Hamza".
8. Data shown

AlertView: alert_id, kind, family, step, escalation, set, for_staff_id, lock { kind_label_key, table_code, point_code, requester_name, device_name }, card { … details { item, quantity, amount, reason } } (card only on the person's own staff session), raised_at, plus on the signed-in view answers, needs_pin, silent, state, close_reason, outcome, raised_device_id (AD rulings); inbox rows add seen_by_me, moved_to_name, for_staff_name, from_business_day. Header: binding person, binding_route_until. Receipts: per step recipients, routes, delivered / seen times, device names, bound person. Never shown or logged: PINs; amounts, items or reasons on lock text or signed-out screens.

9. Changes 01d makes to other modules' screens
Screen	Change	Source
Every tablet screen (00 shell, later 02 / 03b)	B05 header strip	§3.7
00 hub admin home /admin	B07 stuck alerts row	AD-116
00 sign-in tiles	people without a PIN never shown; signed-out kiosk / phone show F01	01b v1.4 B-1, §3.7
02 ordering (later)	banner and badge above the order screens; the requester's waiting card (waiting time, "Waiting 2 min — ask in person", "No approver reachable — ask in person", result chime) and my requests (GET /queries/my-requests) are built here	§8.1, AD-1
04 voids (later)	void request uses D01–D03; rejected-void notice to the table's order taker	G0 N9
05 billing / 07 owner (later)	money view lists approvals with method (in person / on requester's device), failed PIN attempts on requests, and who saw each notice on which device	R2, §4.3 To 05
03b KDS / point tablets (later)	lock-text banner B06 and escalations, one sound per step, dark theme	G1-14 d
10. Delta against the first hand-off

None exists for 01d. Every frame is new: S00 header variant · C01 (all families × new / seen / closed × card / lock, Urdu) · C02 · B01 (each family, stacked) · S01 (all states, "For" group, earlier day) · S02 · D01 (money and accept variants) · D02 · D03 · D04 · B02 · B03 · B04 (each error) · B05 (three states) · B06 (kiosk, KDS dark) · N01–N04 · F01 overlay · S03 · S04 · B07. Each at T landscape, T portrait, K, and P where §1 says, in English and Urdu.

11. Open questions
#	Question	For
DQ1	Where the banner and badge sit on T and K so they never cover Send / Pay buttons of 02 / 05 screens.	designer
DQ2	Requests to answer: its own screen, or a tab in the Inbox?	designer
DQ3	How many banners stack before "{n} new".	designer
DQ4	Family colours and icons in light and dark (KDS) themes, colour-blind safe.	designer
DQ5	The "For Ali" group on a lead's tablet with 3–4 people.	designer
DQ6	The tones themselves (urgent, action, info, rising, falling) — Web Audio, no files.	designer + developer

No owner questions (01d's were answered in G0 / G1). Deferred: requester waiting card (02 / 04), Android notification and app update (9b), personal-phone app (post-pilot), inbox history beyond today, snooze (decided no).

Story AC → screen IDs
Story AC	Screens
E-NOTIF AC1 targets (person, permission, team)	S01, C01 "For" tag, S03
E-NOTIF AC2 routes at once (screen, device, escalation)	B01, F01, B06, S04
E-NOTIF AC3 works with no internet	all (hub LAN), B03
E-NOTIF AC4 iPhones	P browser only (R33)
E-NOTIF AC5 warn when a target can't be reached	B06 (approvals only; general warning deferred)
E-NOTIF AC6 audited	S04 (viewer for money in 05 / 07)
E-REQ AC1 Approve / Reject, pending	D01, S02
E-REQ AC2 own device, own PIN	D01, D02
E-REQ AC3 requester sees the answer	N04 (waiting card in 02 / 04)
E-REQ AC4 in-person fallback	D03
E-REQ AC5 right checked on arrival	B04 (out_of_range, not_approver)
E-REQ AC6 first answer wins	B04 (REQUEST_NOT_PENDING)
E-REQ AC7 no expiry	S02 "from 1 Nov"
G1-13 c header	B05
R1 / R2 anti-cheat	N01, N02, N03, hidden-seat rule
G1-21.7 test alert	S03, S04
AD-116 stuck alerts	B07

ACs with no screen: the audit viewer (05 / 07), the Android lock-screen notification (9b).