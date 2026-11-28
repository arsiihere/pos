# 01d — Urdu still to translate

Keys in `apps/client/src/i18n/en.ts` added for 01d (task 39: §3.12 labels, §8.1 texts, the hand-off CHANGES §5 keys and the brief §6 error texts) with no entry in `ur.ts`. They show in English on an Urdu page until translated (01a S49 fallback). Task 39 filled `ur.ts` from the 01d Urdu frames (`design/AnswerUrdu`, `BannerUrdu`, `CardsUrdu`, `InboxUrdu`); the keys below have no Urdu on those frames, or the frame's Urdu says something the English key does not (noted). `apps/client/src/features/alerts/labels.test.ts` checks that every 01d key is either in `ur.ts` or listed here.

Needs native review as well: every 01d entry in `ur.ts` (frame drafts), and `alerts.months` (only نومبر is on a frame).

134 keys.

| Key | English | Note |
|---|---|---|
| `alerts.table` | T{code} |  |
| `alerts.amount` | Rs {amount} |  |
| `requests.empty` | No requests waiting. |  |
| `answer.accept` | Accept |  |
| `answer.decline` | Decline |  |
| `answer.pin_title_approve` | {name}, enter your PIN to approve |  |
| `answer.pin_title_reject` | {name}, enter your PIN to reject |  |
| `answer.done_approved` | Approved |  |
| `answer.done_rejected` | Rejected |  |
| `answer.waiting_for` | Waiting for {name} or a manager. |  |
| `answer.ro_team` | You can’t approve this — not your team. Find {name} or a manager. |  |
| `answer.ro_informed` | For your information. Find {name} or a manager. | task 41: spec §8.1 / brief B02 copy ("Find <approver> or a manager") |
| `answer.ro_removed` | You can’t approve this any more. |  |
| `answer.error.already_approved` | Already approved by {name}. |  |
| `answer.error.already_rejected` | Already rejected by {name}. |  |
| `answer.error.withdrawn_by` | Withdrawn by {requester}. |  |
| `answer.error.closed` | This request is already closed. |  |
| `answer.error.out_of_range` | Not your team — a manager can approve. |  |
| `answer.error.in_person_elsewhere` | In person only on the requester's device. |  |
| `answer.error.self` | You can't approve your own request. |  |
| `answer.error.not_approver` | You can't approve this. |  |
| `answer.error.pin_invalid` | Wrong PIN. |  |
| `answer.error.locked_out` | Too many tries — wait {n} min. |  |
| `answer.error.not_found` | This request is no longer there. |  |
| `answer.error.staff_not_found` | That person can't approve here. |  |
| `errors.ALERT_NOT_FOUND` | This request is no longer there. |  |
| `errors.REQUEST_NOT_PENDING` | This request is already closed. |  |
| `errors.REQUEST_PIN_REQUIRED` | Enter your PIN to answer this. |  |
| `notice.in_person_title` | You approved the {kind} on {table} at {requester}’s tablet |  |
| `notice.pin_failed_title` | Your PIN was entered on {device} and the answer failed |  |
| `notice.not_you` | Not you? Change your PIN and tell the owner. |  |
| `lock.title` | Alerts |  |
| `lock.sign_in` | Sign in to see details |  |
| `receipts.person` | Person |  |
| `receipts.route` | Device / route |  |
| `receipts.delivered` | Delivered |  |
| `receipts.seen` | Seen |  |
| `receipts.note` | Note |  |
| `receipts.updating` | Updating |  |
| `receipts.nobody` | Nobody could be reached. |  |
| `receipts.no_route` | No route |  |
| `receipts.hidden_seat` | Hidden (answering seat) |  |
| `admin.stuck` | Stuck alerts: {n} — an alert stopped sending reminders. It can still be answered. |  |
| `requests.empty_sub` | Requests you can answer appear here, oldest first. | task 41 (staff entry) |
| `answer.an_approver` | an approver | task 41 (staff entry) |
| `answer.fact.when` | When | task 41 (staff entry) |
| `answer.fact.device` | Device | task 41 (staff entry) |
| `answer.fact.request` | Request | task 41 (staff entry) |
| `receipts.sent_by` | Sent {time} by {name} · to {target} | task 41 (staff entry) |
| `receipts.step.sent` | Sent | task 41 (staff entry) |
| `receipts.step.reminder` | Reminder | task 41 (staff entry) |
| `receipts.step.escalated` | Escalated | task 41 (staff entry) |
| `receipts.people` | · {n} people | task 41 (staff entry) |
| `receipts.route.screen` | {device} (signed in) | task 41 (staff entry) |
| `receipts.route.bound` | {device}, bound to {name} (not signed in) | task 41 (staff entry) |
| `receipts.route.device` | {device} (screen) | task 41 (staff entry) |
| `receipts.route.other` | {route} · {ref} | task 41 (staff entry) |
| `receipts.not_found` | This alert is no longer there. | task 41 (staff entry) |
| `receipts.for` | for {name} | task 41 (staff entry) |

## v1.3 deep links — Urdu drafted, to check

01d v1.3 §3.13.2 rules 2 and 6, §3.13.6 n4 (dl cs2). These keys **have** a draft in `ur.ts` (the spec gives `alerts.target_closed`; the rest are drafts). A native speaker checks each line; `{name}` is the table chip or item name the screen shows and stays as is. `apps/client/src/i18n/i18n.test.ts` (test 93) checks every line below matches `en.ts` and `ur.ts`.

| Key | English | Urdu draft |
|---|---|---|
| `alerts.target_closed` | This item is no longer open. | یہ آئٹم اب کھلا نہیں ہے۔ |
| `alerts.back` | Back | واپس |
| `alerts.opened.table` | Opened table {name} | ٹیبل {name} کھولی گئی |
| `alerts.opened.order` | Opened order {name} | آرڈر {name} کھولا گیا |
| `alerts.opened.line` | Opened item {name} | آئٹم {name} کھولا گیا |
| `alerts.opened.late` | Opened late order {name} | تاخیر والا آرڈر {name} کھولا گیا |
| `alerts.opened.zone_item` | Opened stock row {name} | اسٹاک {name} کھولا گیا |
| `alerts.opened.pass` | Opened Pass card {name} | پاس کارڈ {name} کھولا گیا |
| `alerts.opened.inbox` | Opened alert {name} | الرٹ {name} کھولا گیا |

## 05a client (task 35) — no Urdu yet

05a §8 (D-2, M-11): the answer sheet without "Approve here", the everyone-device money card, the requester text, the error texts and the deep-link fallback. No entry in `ur.ts`; they show in English until a native speaker translates them. `answer.here`, `answer.who`, `answer.their_pin` and `answer.here_help` are gone (the in-person path is removed).

| Key | English | Note |
|---|---|---|
| `answer.approve_on_listed` | Approve on a listed device | everyone device, money card, no button |
| `answer.confirm_on_phone` | Confirm on your phone | downgraded request, named to its requester |
| `answer.error.device_not_set_up` | This device is not set up for you | `DEVICE_ACCESS_DENIED`, `DEVICE_NOT_OWNED` |
| `answer.error.listed_device_only` | Do this on your own phone | `PERMISSION_DENIED { reason: 'listed_device_only' }` |
| `answer.error.device_access_self` | You would lose access on this device | `DEVICE_ACCESS_SELF` |

## 05a client (task 25, carry-over from the task 26 review) — `device_waiting`, no Urdu yet

05a §3.10 (row D-3): the `device_waiting` kind's labels. No spec wording: proposed at the task 26 review (the owner may change them). No entry in `ur.ts`; they show in English until a native speaker translates them.

| Key | English | Note |
|---|---|---|
