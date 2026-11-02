# 01d — Urdu still to translate

Keys in `apps/client/src/i18n/en.ts` added for 01d (task 39: §3.12 labels, §8.1 texts, the hand-off CHANGES §5 keys and the brief §6 error texts) with no entry in `ur.ts`. They show in English on an Urdu page until translated (01a S49 fallback). Task 39 filled `ur.ts` from the 01d Urdu frames (`design/AnswerUrdu`, `BannerUrdu`, `CardsUrdu`, `InboxUrdu`); the keys below have no Urdu on those frames, or the frame's Urdu says something the English key does not (noted). `apps/client/src/features/alerts/labels.test.ts` checks that every 01d key is either in `ur.ts` or listed here.

Needs native review as well: every 01d entry in `ur.ts` (frame drafts), and `alerts.months` (only نومبر is on a frame).

79 keys.

| Key | English | Note |
|---|---|---|
| `alert.request_result.card` | Request answered · {table} |  |
| `alert.request_result.lock` | Request answered · {table} |  |
| `alert.request_result.approved` | Request approved · {table} | frame: ووئڈ منظور ("Void approved"); the view carries no request kind |
| `alert.request_result.rejected` | Request rejected · {table} |  |
| `alert.request_result.withdrawn` | You withdrew the request · {table} |  |
| `alert.request_result.obsolete` | Request closed · {table} |  |
| `alert.request_result.overridden` | Request overridden · {table} |  |
| `alert.pin_use_failed.card` | Your PIN was entered on {device} and the answer failed |  |
| `alert.pin_use_failed.lock` | Your PIN was used on {device} |  |
| `alert.approval_receipt.card` | You answered a request · {table} · {requester} | frame: آپ نے منظور کیا ("You approved"); the view carries no decision, so the English is neutral |
| `alert.approval_receipt.lock` | You answered a request · {table} | as above |
| `alert.answered_on_requester_device.card` | You answered the request on {table} at {device} |  |
| `alert.answered_on_requester_device.lock` | You answered a request at {device} |  |
| `alert.no_approver.card` | No one can approve requests right now | frame: کوئی ووئڈ منظور نہیں کر سکتا names the permission; the view carries none |
| `alerts.unknown.request` | {table} · Request · {requester} |  |
| `alerts.unknown.alert` | {table} · Alert · {requester} |  |
| `alerts.kind_fallback` | request | review fix round 1: the `{kind}` word in `notice.in_person_title` when the kind has no name label |
| `alerts.table` | T{code} |  |
| `alerts.amount` | Rs {amount} |  |
| `alerts.closed.rejected` | Rejected by {name} {time} | pattern of alerts.closed.approved: {name} نے … کیا {time} |
| `alerts.closed.closed` | Closed |  |
| `alerts.more_new` | {n} more new |  |
| `alerts.open_inbox` | Open inbox |  |
| `alerts.empty` | Nothing needs you right now. |  |
| `alerts.for_group` | For {name} · {n} · no device |  |
| `requests.empty` | No requests waiting. |  |
| `answer.accept` | Accept |  |
| `answer.decline` | Decline |  |
| `answer.pin_title_approve` | {name}, enter your PIN to approve |  |
| `answer.pin_title_reject` | {name}, enter your PIN to reject |  |
| `answer.pin_not_kept` | Your PIN is not kept. |  |
| `answer.done_approved` | Approved |  |
| `answer.done_rejected` | Rejected |  |
| `answer.waiting_for` | Waiting for {name} or a manager. |  |
| `answer.here` | Approve here |  |
| `answer.who` | Who is approving? |  |
| `answer.their_pin` | {name}’s PIN |  |
| `answer.here_help` | {name} will be told on his own devices that he approved here. |  |
| `answer.ro_team` | You can’t approve this — not your team. Find {name} or a manager. |  |
| `answer.ro_informed` | For your information. {name} or a manager can approve. |  |
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
| `answer.error.busy` | Busy — try again. |  |
| `answer.error.failed` | Something went wrong. Try again. |  |
| `answer.error.offline` | No connection to the hub — try again. |  |
| `errors.ALERT_NOT_FOUND` | This request is no longer there. |  |
| `errors.REQUEST_NOT_PENDING` | This request is already closed. |  |
| `errors.REQUEST_PIN_REQUIRED` | Enter your PIN to answer this. |  |
| `notice.in_person_title` | You approved the {kind} on {table} at {requester}’s tablet |  |
| `notice.pin_failed_title` | Your PIN was entered on {device} and the answer failed |  |
| `notice.not_you` | Not you? Change your PIN and tell the owner. |  |
| `lock.title` | Alerts |  |
| `lock.sign_in` | Sign in to see details |  |
| `test.send_to` | Send to |  |
| `test.point_off` | Point: available after points are set up. |  |
| `test.summary` | Sends a test alert to |  |
| `test.send` | Send test |  |
| `test.after` | You see when it arrives and is seen, on which device. |  |
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
