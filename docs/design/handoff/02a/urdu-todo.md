# 02a — Urdu still to translate

Keys in `apps/client/src/i18n/en.ts` added for 02a by the client task W0.3 (handoff `CHANGES.md` §4 + §6, the toast frame, the §9 error toasts and the Q-18 reason tokens) with no entry in `ur.ts`. They show in English on an Urdu page until translated (01a S49 fallback). W0.3 filled `ur.ts` from the Urdu frames (`TableMapUrdu`, `TilesUrdu`, `TableSheetUrdu`). `apps/client/src/i18n/i18n.test.ts` checks that every 02a key is either in `ur.ts` or listed here. A lane that appends a 02a key without Urdu lists it here too.

Needs native review as well: the 02a entries of `ur.ts` that are not on a frame (below the table).

117 keys.

| Key | English | Note |
|---|---|---|
| `tables.archived_group` | Archived tables |  |
| `tables.empty` | No tables yet |  |
| `tables.empty_floor` | No tables on this floor |  |
| `tables.mine_empty` | You have no tables right now. |  |
| `sheet.their_table` | {name}'s table |  |
| `sheet.open_for` | Open {n} min |  |
| `sheet.since` | since {time} |  |
| `sheet.take_over_from` | Take over from {name} |  |
| `sheet.mark_clean` | Mark clean |  |
| `sheet.act.move` | Move party |  |
| `sheet.act.join` | Join a table |  |
| `sheet.act.split` | Split the party |  |
| `sheet.act.release_mine` | Release my lock |  |
| `sheet.act.release_other` | Release {name}'s lock |  |
| `sheet.act.force_move` | Force move |  |
| `sheet.read_only_holder` | {name} has this table. Only {name} or a manager can take orders or hand it over. |  |
| `sheet.waiter_note` | You can mark food served and clean tables. |  |
| `sheet.offline` | Hub offline. Ask for bill and Clean will be sent when it's back. |  |
| `busy.still_can` | You can still ask for the bill, call a waiter or clean. |  |
| `busy.own_other_screen` | You're ordering on {table} on another screen |  |
| `busy.open_here` | Open here |  |
| `busy.see_table` | See the table |  |
| `release.title` | Release {name}'s lock on {table}? |  |
| `release.body` | Anything he hasn't sent stays on his screen. |  |
| `release.reason` | Reason |  |
| `handover.title` | Hand {table} to… |  |
| `handover.sub` | They must accept. Working people first. |  |
| `handover.assigned_here` | Assigned here |  |
| `handover.working` | Working |  |
| `handover.not_signed_in` | Not signed in |  |
| `handover.has_tables` | Has {n} tables |  |
| `handover.send` | Send request |  |
| `handover.waiting` | Waiting for {name} |  |
| `handover.waiting_late` | Waiting for {name} — {n} min · ask her in person |  |
| `handover.lead_told` | Your lead was told |  |
| `handover.withdraw` | Withdraw |  |
| `handover.result.accepted` | {name} accepted {table} |  |
| `handover.result.declined` | {name} declined {table} |  |
| `handover.result.closed` | Handover of {table} closed: the table changed |  |
| `handover.result.to_someone_else` | Hand over to someone else |  |
| `handover.waiting_answer` | Waiting for an answer |  |
| `forcemove.title` | Give {table} to {name} now? |  |
| `forcemove.sub` | {name} is not asked. This is logged. |  |
| `forcemove.give` | Give table |  |
| `forcemove.notice_receiver` | A manager gave you {table} |  |
| `forcemove.me` | Me |  |
| `move.title` | Move {table} to… |  |
| `move.sub` | Orders, holder and lock go with the party. |  |
| `move.to` | Move to {table} |  |
| `move.tag_owner` | {name}'s |  |
| `join.title` | Join to {table} |  |
| `join.free` | Free tables |  |
| `join.parties` | Other parties |  |
| `join.summary_absorb` | {table}'s party ({n} order) joins {into}. One bill. |  |
| `split.title` | Split {table} |  |
| `split.sub` | Orders move whole. Splitting a bill is at the cashier. |  |
| `split.step_target` | Target |  |
| `split.step_orders` | Tick the orders that go to {table} |  |
| `split.just_free` | No orders — just free {table} |  |
| `split.summary` | {n} order goes to {to}. {m} stay on {from}. |  |
| `call.title` | Call a waiter to {table} |  |
| `call.sub` | One tap sends. Its waiters get it; your screen stays quiet. |  |
| `call.chip.water` | Water |  |
| `call.chip.clear` | Clear the table |  |
| `call.chip.come` | Come to the table |  |
| `call.chip.other` | Other |  |
| `call.nobody` | Nobody else is working — you can call again in 5 min |  |
| `call.nobody_sub` | Go yourself or ask a manager |  |
| `bill.confirm` | Ask for the bill for {table}? |  |
| `bill.ask` | Ask |  |
| `clean.title` | Mark {table} clean? |  |
| `clean.body` | The table becomes free. |  |
| `clean.anyway_body` | Clean anyway? His order stays on his screen as a draft. {table} becomes free. |  |
| `clean.anyway` | Clean anyway |  |
| `offline.bar` | Reconnecting… showing the last known tables |  |
| `offline.bar_queue` | Reconnecting… {n} waiting to send |  |
| `offline.bar_hint` | Ask for bill, Clean and Mark served still work |  |
| `pair.again` | This screen must be paired again |  |
| `pair.again_sub` | Ask a manager. Unsent orders stay on this screen. |  |
| `pair.show_code` | Show pairing code |  |
| `tables.reason.note` | Note (optional) |  |
| `tables.changed` | This table changed — refreshed |  |
| `tables.toast.sent_to` | Sent to {name} |  |
| `tables.toast.waiter_called` | Waiter called |  |
| `tables.toast.already_called` | Already called |  |
| `tables.toast.queued` | Will be sent when the hub is back |  |
| `tables.toast.cleaned` | Clean {table} |  |
| `tables.toast.needs_hub` | Needs the hub |  |
| `tables.toast.moved` | Moved to {table} |  |
| `tables.toast.orders_moved` | {n} orders moved to {table} |  |
| `tables.toast.free` | {table} is free |  |
| `tables.toast.back_online` | Back online |  |
| `tables.toast.already_asked` | Already asked |  |
| `tables.toast.forced_released` | Lock released |  |
| `tables.err.TABLE_NEEDS_CLEANING` | This table must be cleaned first |  |
| `tables.err.TABLE_NOT_OPEN` | This table is free — nothing to do here |  |
| `tables.err.TABLE_HANDOVER_PENDING` | A handover is already waiting for an answer |  |
| `tables.err.TABLE_HANDOVER_STALE` | Bill paid, waiting for cleaning |  |
| `tables.err.HANDOVER_TARGET_INVALID` | This person cannot take the table |  |
| `tables.err.HANDOVER_TARGET_UNAVAILABLE` | This person is not working now |  |
| `tables.err.TABLE_NOT_FREE` | That table is not free any more |  |
| `tables.err.TABLE_MERGED` | Joined tables move together — split them first |  |
| `tables.err.MERGE_BLOCKED_BY_VOID` | A void is waiting on this table |  |
| `tables.err.SPLIT_INVALID` | Pick at least one order, and leave one behind |  |
| `tables.err.TABLE_NO_ORDERS` | No orders on this table yet |  |
| `tables.err.TABLE_HAS_OPEN_ORDERS` | The bill must be paid first |  |
| `tables.err.TABLE_NOT_FOUND` | This table is not in the setup any more |  |
| `tables.err.TABLE_ALREADY_LOCKED` | Someone is taking an order here |  |
| `tables.err.TABLE_LOCK_NOT_HELD` | You no longer hold this table |  |
| `tables.err.PERMISSION_DENIED` | You do not have permission for this |  |
| `tables.err.VALIDATION_FAILED` | Something in this request was not accepted |  |
| `tables.err.outside_scope` | This table is outside your floors |  |
| `tables.err.not_holder` | Only the person who has this table can do this |  |
| `tables.err.not_assigned` | This table is not assigned to you |  |
| `tables.err.other_owner` | Hand it over to {name}; they move it |  |
| `tables.err.other_owner_holder` | {name} has this table. Ask {name} to do it. |  |
| `tables.err.unknown` | That did not work. Try again. |  |

## In `ur.ts` but not on a frame (needs native review)

- `lock.released_by`
- `lock.released_ttl`
- `lock.holder_changed`
- `lock.other_device`
- `lock.keep_draft`
- `lock.holder_changed_can_send`
- `alert.table_handover.card`
- `alert.table_handover.lock`
- `alert.call_waiter.card`
- `alert.call_waiter.lock`
- `tables.reason.went_home`
- `tables.reason.tablet_dead`
- `tables.reason.left_table`
- `tables.reason.shift_ended`
- `tables.reason.rebalance`
- `tables.reason.ac`
- `tables.reason.bigger_table`
- `tables.reason.guest_asked`
- `tables.reason.other`
