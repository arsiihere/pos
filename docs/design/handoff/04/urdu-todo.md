# Urdu to-do (module 04)

One section per lane (`## VU1`, `## VU2`); whoever merges second rebases and keeps both sections.

## VU2

Audit log (04-S03, 04-C04–C06, 04-D09).

Keys in `apps/client/src/i18n/en.ts` added by lane VU2 with no entry in `ur.ts`; they show in English on an Urdu page until translated (01a S49 fallback). `ur.ts` holds what the Urdu frames show (`AuditUrdu`, and `VoidSheetUrdu` for the void reason words). `apps/client/src/features/audit/strings.test.ts` checks that every `audit.*` key is either in `ur.ts` or listed here (not both).

Needs native review as well: the `audit.*` entries of `ur.ts` (from AuditUrdu; the date formats `audit.date`, `audit.date_short`, `audit.date_long` are only the order "day month", month names from `alerts.months`, integrator O12).

120 keys.

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
| `audit.export.running` | Exporting… |  |
| `audit.export.rows` | Exporting… {n} rows |  |
| `audit.export.stop` | Stop |  |
| `audit.export.saved` | Saved {file} |  |
| `audit.export.stopped` | Export stopped |  |
| `audit.export.failed` | Export stopped — the hub can't be reached |  |
| `audit.export.refused` | Export stopped — the hub refused the search |  |
| `audit.csv.table` | Table |  |
| `audit.csv.item` | Item |  |
| `audit.csv.units` | Units |  |
| `audit.csv.method` | Method |  |

## VU1 (voids)

Keys in `apps/client/src/i18n/en.ts` added by lane VU1 (handoff 04 CHANGES §2.1–§2.8) with no entry in `ur.ts`. They show in English on an Urdu page until translated (01a S49 fallback). The Urdu that frames `VoidSheetUrdu`, `VoidPendingUrdu` and `AnswerVoidUrdu` show is in `ur.ts`. `apps/client/test/voids-i18n.test.ts` checks that every VU1 key is either in `ur.ts` or listed here.

91 keys.

| Key | English | Note |
|---|---|---|
| `void.can_void` | You can void this · comes off the bill now |  |
| `void.deal_portions` | Deal portions |  |
| `void.weighed_whole` | Weighed item — the whole line is voided. |  |
| `void.disposition.other.placeholder` | What happens to it? (required) |  |
| `void.disposition.moved_partly` | Cooked parts to stock, the rest released |  |
| `void.disposition.moved_partly.hint` | Cooking or cooked parts go to ready stock; parts not started are let go |  |
| `void.block.stock_not_tracked` | Stock not tracked for this item |  |
| `void.block.not_movable_stage` | Not cooking or cooked |  |
| `void.block.move_not_granted` | You can't move to stock |  |
| `void.block.day_closed` | Business day closed |  |
| `void.out.staff_meal` | Staff meal |  |
| `void.out.other` | Other |  |
| `void.out.parts_below` | Parts below |  |
| `void.stage.cooked` | Cooked |  |
| `void.note.label` | Why? |  |
| `void.note.count` | {n}/200 |  |
| `void.note.placeholder` | Write why |  |
| `void.note.required` | Write why — needed for Other |  |
| `void.amount.direct` | Leaves the bill and the kitchen at once. |  |
| `void.amount.not_weighed` | Not weighed yet, so nothing is on the bill for it. |  |
| `void.amount.still_answers` | A manager still answers. |  |
| `void.do` | Void |  |
| `void.write_why_first` | Write why first |  |
| `void.comp_waiting` | Comp waiting |  |
| `void.loading` | Reading what this void does… |  |
| `void.err.VOID_PENDING` | A void is already waiting on this item |  |
| `void.err.COMP_PENDING` | A comp is waiting on this item — decide it first |  |
| `void.err.COMP_PENDING.hint` | Ask a manager to answer the comp, or withdraw it from the line. |  |
| `void.err.ITEM_WRONG_STAGE` | Not started — use Remove |  |
| `void.err.ITEM_WRONG_STAGE.hint` | Removing is free and needs no approval. |  |
| `void.err.ORDER_BILLED` | Bill closed — refunds are at the counter |  |
| `void.err.not_allowed.again` | Choose where it goes again. |  |
| `void.err.offline.hint` | Voids need the hub; nothing was sent. |  |
| `void.toast.asked` | Void asked — waiting for approval |  |
| `void.toast.asked.sub` | {item} ×{n} |  |
| `void.toast.voided` | Voided |  |
| `void.toast.voided.sub` | {item} ×{n} · {amount} off the bill |  |
| `void.err.VALIDATION_FAILED` | This line changed — check the units and try again. |  |
| `void.pending.other` | Asked by {name} · {time} · waiting for a manager |  |
| `void.pending.other_noname` | Asked at {time} · waiting for a manager |  |
| `void.pending.blocked` | Can't be approved as stock any more — withdraw and ask again |  |
| `void.pending.blocked_why` | It was served while the void waited. |  |
| `void.toast.withdrawn` | Request withdrawn |  |
| `void.toast.withdrawn.sub` | {item} is back on the bill |  |
| `void.cancel_order` | Cancel order |  |
| `void_all.title` | Cancel the order? |  |
| `void_all.sub_one` | Removes what the kitchen hasn't started, voids the rest |  |
| `void_all.remove_group` | Remove |  |
| `void_all.remove_group.sub` | · not started · free, no approval |  |
| `void_all.lines` | {n} line |  |
| `void_all.lines_n` | {n} lines |  |
| `void_all.void_group` | Void |  |
| `void_all.void_group.sub` | · kitchen started · a manager answers each line |  |
| `void_all.void_group.sub_direct` | · kitchen started · off the bill at once |  |
| `void_all.waste_all` | Waste all |  |
| `void_all.with_child` | · with {child} |  |
| `void_all.dsel.moved` | To ready stock |  |
| `void_all.dsel.moved_partly` | Cooked parts to stock |  |
| `void_all.dsel.label` | Where {item} goes |  |
| `void_all.reason_sub` | required · one for all lines |  |
| `void_all.removed_now` | Removed lines go at once. |  |
| `void_all.each_waits` | Each voided line waits for a manager. |  |
| `void_all.keep` | Keep order |  |
| `void_all.go.remove` | Remove {n} |  |
| `void_all.go.ask` | ask to void {m} |  |
| `void_all.go.ask_first` | Ask to void {m} |  |
| `void_all.go.void` | void {m} |  |
| `void_all.go.void_first` | Void {m} |  |
| `void_all.nothing_cancelled` | {error} — nothing was cancelled |  |
| `void_all.reloaded` | The list is reloaded. Try again when the table is free. |  |
| `void_all.removed` | {item} ×{n} removed |  |
| `void_all.voids_not_sent` | The voids were not sent: {error} |  |
| `void_all.left_below` | What is left is below. Answer or withdraw the comp, then try again. |  |
| `void_all.retry` | Try again · void {m} |  |
| `void.toast.cancelled` | Order cancelled |  |
| `void.toast.cancelled.sub` | {removed} removed · {voids} voids waiting for approval |  |
| `void.toast.cancelled.sub_direct` | {removed} removed · {voids} voided |  |
| `void_table.menu` | Cancel table |  |
| `void_table.title` | Cancel the table? |  |
| `void_table.round` | Round {n} |  |
| `void_table.round_done` | Round {n} cancelled |  |
| `void_table.toast.cancelled` | Table cancelled |  |
| `void_table.toast.asked` | Voids asked |  |
| `void_table.toast.sub` | {removed} removed · {voided} voided · {asked} waiting for approval |  |
| `void_all.sub` | {rounds} · removes what the kitchen hasn't started, voids the rest |  |
| `void_all.child` | + {name} ×{n} |  |
| `void_all.disposition_note` | What happens to the Other lines? |  |
| `comp.needs_manager` | Needs a manager's approval · online only | Frame VoidSheetUrdu: مینیجر کی منظوری چاہیے · صرف آن لائن (02b key, listed in 02b/urdu-todo.md) |
| `comp.units` | Units | Frame VoidSheetUrdu: تعداد (02b key, listed in 02b/urdu-todo.md) |
| `comp.ask` | Ask for approval | Frame VoidSheetUrdu: منظوری مانگیں (02b key, listed in 02b/urdu-todo.md) |
| `comp.withdraw` | Withdraw | Frame VoidPendingUrdu: واپس لیں (02b key, listed in 02b/urdu-todo.md) |

Needs native review as well (in `ur.ts`, no frame shows them):

- `line.void` (ووئڈ, was منسوخ… for the 02b placeholder).
- `alert.void_approval.lock` ({table} · ووئڈ · {requester}, the 02b comp lock pattern; 01d's labels test needs every `alert.*` key in `ur.ts` or the 01d to-do list).
- `admin_stock.errors.DAY_CLOSE_BLOCKED_one` (the singular of the 01a plural, 04 v1.0.4 §8).
- `admin_stock.errors.DAY_CLOSE_BLOCKED` and `_one`: the 01a Urdu says آئٹم ہٹانے کی درخواستیں ("requests to remove an item") where the 04 frames say ووئڈ (void). One word for both, after native review.
