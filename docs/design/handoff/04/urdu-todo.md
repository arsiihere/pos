# Urdu to-do (module 04)

One section per lane (`## VU1`, `## VU2`); whoever merges second rebases and keeps both sections.

## VU2

Audit log (04-S03, 04-C04–C06, 04-D09).

Keys in `apps/client/src/i18n/en.ts` added by lane VU2 with no entry in `ur.ts`; they show in English on an Urdu page until translated (01a S49 fallback). `ur.ts` holds what the Urdu frames show (`AuditUrdu`, and `VoidSheetUrdu` for the void reason words). `apps/client/src/features/audit/strings.test.ts` checks that every `audit.*` key is either in `ur.ts` or listed here (not both).

Needs native review as well: the `audit.*` entries of `ur.ts` (from AuditUrdu; the date formats `audit.date`, `audit.date_short`, `audit.date_long` are only the order "day month", month names from `alerts.months`, integrator O12).

109 keys.

| Key | English | Note |
|---|---|---|
| `audit.f.yesterday` | Yesterday · {date} |  |
| `audit.f.range` | {from} – {to} | en dash between two dates |
| `audit.f.n_actions` | {n} actions |  |
| `audit.f.preset.voids` | Voids |  |
| `audit.col.what` | What |  |
| `audit.col.outcome_amount` | Outcome · amount |  |
| `audit.weekdays` | Sun,Mon,Tue,Wed,Thu,Fri,Sat | comma list, Sun first; not shown on Urdu pages (ur `audit.date` has no weekday, frame AuditUrdu) |
| `audit.day.today` | Today · {date} |  |
| `audit.action.comp_answered` | Comp answered |  |
| `audit.action.request_answered` | Request answered |  |
| `audit.action.request_withdrawn` | Request withdrawn |  |
| `audit.action.request_pin_failed` | PIN failed on a request |  |
| `audit.action.comp_requested` | Comp asked |  |
| `audit.action.line_comped` | Item comped |  |
| `audit.action.item_returned` | Item returned |  |
| `audit.action.line_weight_set` | Weight entered |  |
| `audit.action.order_boosted` | Order boosted |  |
| `audit.action.order_cancelled` | Order cancelled |  |
| `audit.action.day_opened` | Day opened |  |
| `audit.action.day_closed` | Day closed |  |
| `audit.action.table_lock_force_released` | Table lock released by force |  |
| `audit.action.table_holder_changed` | Table holder changed |  |
| `audit.action.pin_locked_out` | PIN locked |  |
| `audit.action.device_pin_locked_out` | Screen PIN locked |  |
| `audit.action.pin_lockout_cleared` | PIN lock cleared |  |
| `audit.action.device_paired` | Screen paired |  |
| `audit.action.device_revoked` | Screen removed |  |
| `audit.action.pairing_token_generated` | Pairing code made |  |
| `audit.action.station_paused` | Station paused |  |
| `audit.action.station_capacity_set` | Station capacity changed |  |
| `audit.action.item_availability_set` | Item turned on or off |  |
| `audit.action.request_closed` | Request closed |  |
| `audit.action.stock_set` | Stock counted |  |
| `audit.action.stock_added` | Stock added |  |
| `audit.action.zone_stock_set` | Zone stock counted |  |
| `audit.action.zone_stock_added` | Zone stock added |  |
| `audit.action.stock_transferred_out` | Stock sent out |  |
| `audit.out.staff_meal` | Staff meal |  |
| `audit.out.other` | Other |  |
| `audit.out.accepted` | Accepted |  |
| `audit.out.rejected` | Rejected |  |
| `audit.out.declined` | Declined |  |
| `audit.out.withdrawn` | Withdrawn |  |
| `audit.out.pin_invalid` | Wrong PIN |  |
| `audit.out.answer_failed` | Not answered |  |
| `audit.out.done` | Done |  |
| `audit.out.obsolete` | No longer needed |  |
| `audit.out.overridden` | Overridden |  |
| `audit.out.undone` | Undone |  |
| `audit.out.expired` | Expired |  |
| `audit.out.remake` | Remake |  |
| `audit.out.fix` | Fix |  |
| `audit.out.manual` | Removed here |  |
| `audit.out.owner_removed` | Removed by owner |  |
| `audit.out.paused` | Paused |  |
| `audit.out.resumed` | Resumed |  |
| `audit.out.available` | On |  |
| `audit.out.unavailable` | Off |  |
| `audit.reason.with_note` | {reason}: {note} | reason, colon, the staff note as typed |
| `audit.reason.take_over` | Taken over |  |
| `audit.reason.handover` | Handed over |  |
| `audit.reason.force_move` | Moved by force |  |
| `audit.method.on_requester_device` | On requester's device |  |
| `audit.method.in_person.inline` | in person | inside a sentence (§8 lower case); the tag is `audit.method.in_person` |
| `audit.method.on_requester_device.inline` | on requester's device |  |
| `audit.approver_line` | Approver {name} | {name} is bold |
| `audit.approver_line.method` | Approver {name} · {method} | {name} is bold; {method} = `audit.method.*.inline` |
| `audit.loading_more` | Loading more… |  |
| `audit.more_failed` | Couldn't load more |  |
| `audit.end` | That's everything |  |
| `audit.empty.title` | Nothing for these filters |  |
| `audit.empty.body` | No {actions} by {name} on {date}. Try another day or Everyone. |  |
| `audit.empty.body_all` | No {actions} on {date}. Try another day. |  |
| `audit.empty.entries` | entries |  |
| `audit.empty.voids` | voids |  |
| `audit.empty.n_actions` | entries of {n} actions |  |
| `audit.empty.clear` | Clear filters |  |
| `audit.err.title` | The hub can't be reached |  |
| `audit.err.body` | Check the Wi-Fi. Your filters are kept. |  |
| `audit.err.refused` | The hub refused this search. Your filters are kept. |  |
| `audit.err.retry` | Try again |  |
| `audit.range.today` | Today |  |
| `audit.range.yesterday` | Yesterday |  |
| `audit.range.last7` | Last 7 days |  |
| `audit.range.month` | This month |  |
| `audit.staff.find` | Find a name |  |
| `audit.staff.left` | left |  |
| `audit.staff.hint` | Matches what they did and what they approved. "left" = no longer on the staff list. |  |
| `audit.staff.failed` | Couldn't load the names |  |
| `audit.actions.group.voids_comps` | Voids and comps |  |
| `audit.actions.group.requests` | Requests |  |
| `audit.actions.group.orders_tables` | Orders and tables |  |
| `audit.actions.group.day_stock` | Day and stock |  |
| `audit.actions.group.kitchen` | Kitchen and menu |  |
| `audit.actions.group.screens_pins` | Screens and PINs |  |
| `audit.actions.all` | All |  |
| `audit.actions.clear` | Clear |  |
| `audit.actions.show` | Show {n} actions |  |
| `audit.actions.show_one` | Show 1 action |  |
| `audit.actions.show_all` | Show all actions |  |
| `audit.range.from` | From |  |
| `audit.range.to` | To (whole day) |  |
| `audit.range.limit` | Up to 31 days. Days later than that can't be picked. |  |
| `audit.range.cancel` | Cancel |  |
| `audit.range.show` | Show {n} days |  |
| `audit.range.show_one` | Show 1 day |  |
| `audit.range.prev` | Previous month |  |
| `audit.range.next` | Next month |  |
| `audit.range.weekheads` | M,T,W,T,F,S,S |  |
