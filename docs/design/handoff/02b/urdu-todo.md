# 02b — Urdu still to translate

Keys in `apps/client/src/i18n/en.ts` added for 02b by the client task W0.3 (handoff `CHANGES.md` §4 + §6, the toast frame, the stage words (frame `Stages`)) with no entry in `ur.ts`. They show in English on an Urdu page until translated (01a S49 fallback). W0.3 filled `ur.ts` from the Urdu frames (`OrderUrdu`, `TableViewUrdu`). `apps/client/src/i18n/i18n.test.ts` checks that every 02b key is either in `ur.ts` or listed here. A lane that appends a 02b key without Urdu lists it here too.

Needs native review as well: the 02b entries of `ur.ts` that are not on a frame (below the table).

153 keys.

| Key | English | Note |
|---|---|---|
| `order.takeaway` | Takeaway |  |
| `order.parking` | Parking |  |
| `order.dinein_hint` | Dine-in starts from a table on the map. |  |
| `order.takeaway.sub` | Both optional. The token comes after Send. |  |
| `order.takeaway.name` | Customer name |  |
| `order.takeaway.phone` | Phone |  |
| `order.takeaway.phone_err` | Enter 10 to 13 digits |  |
| `order.takeaway.skip` | Skip |  |
| `order.takeaway.next` | Next |  |
| `order.parking.plate` | Car plate |  |
| `order.parking.plate_hint` | required · English letters |  |
| `order.parking.type` | Car type |  |
| `order.parking.small` | Small car |  |
| `order.parking.sedan` | Sedan |  |
| `order.parking.large` | Large |  |
| `menu.not_available` | Not available |  |
| `menu.here` | {n} here |  |
| `menu.here_kitchen` | 0 here · kitchen |  |
| `cart.items` | {n} items |  |
| `cart.empty` | Tap items to add them |  |
| `cart.times_later` | Times will be set when sent |  |
| `cart.fix_first` | Fix {n} item first |  |
| `cart.cant_send` | {n} item can't be sent — fix it first |  |
| `cart.prob.only_left` | Only {n} left |  |
| `cart.prob.station_paused` | Kitchen station paused |  |
| `cart.prob.set_to` | Set to {n} |  |
| `day.not_started` | The day hasn't started |  |
| `day.ask_manager` | Ask the manager to start the day. Your order is kept. |  |
| `day.start` | Start day |  |
| `draft.back` | Your unsent order is back |  |
| `draft.kept_since` | Kept on this screen since {time} |  |
| `opt.choose` | Choose {n} |  |
| `opt.up_to` | Up to {n} |  |
| `opt.choose_missing` | Choose {n} in {group} |  |
| `opt.add` | Add to order |  |
| `opt.kitchen_note` | Kitchen note |  |
| `weight.now` | Enter weight now |  |
| `weight.later` | Weigh later |  |
| `weight.later_note` | Added with “Weight pending”. The cashier or a manager enters the weight before the bill. |  |
| `weight.after_weighing` | Price after weighing |  |
| `send.sending` | Sending to the kitchen… |  |
| `send.sent` | Sent |  |
| `send.time_updated` | Time updated: {item} {time} |  |
| `send.token` | Token |  |
| `send.not_yet` | Not sent yet |  |
| `send.not_yet_sub` | It will send when the hub is back. Token after sending. |  |
| `send.done` | Done |  |
| `send.new_takeaway` | New takeaway |  |
| `send.new_parking` | New parking |  |
| `send.queued_sent` | Takeaway sent |  |
| `tv.food_at` | Food at {time} |  |
| `tv.progress` | Kitchen progress updated {time} |  |
| `tv.refresh` | Refresh |  |
| `tv.updated` | Updated {time} |  |
| `stage.served` | Served · {time} |  |
| `stage.sent_back` | Sent back |  |
| `stage.served_closed` | Served · closed |  |
| `stage.not_tracked` | Not tracked |  |
| `stage.counter_served` | From the counter · Served |  |
| `stage.no_kitchen` | No kitchen — serve when ready |  |
| `stage.badge.comped` | Comped ×{n} |  |
| `stage.badge.removed` | Removed |  |
| `stage.badge.sent_back` | Sent back |  |
| `stage.badge.replacement` | Replacement |  |
| `stage.badge.from_counter` | From the counter |  |
| `stage.badge.billed` | Billed |  |
| `late.title` | {table} — about {n} min late |  |
| `late.wait` | Wait |  |
| `late.send_ready` | Send what's ready |  |
| `served.title` | Mark served |  |
| `served.sub` | Ready lines are ticked. Lines the kitchen hasn't got yet can't be served. |  |
| `served.mark_n` | Mark {n} served |  |
| `remove.title` | Remove items |  |
| `remove.sub` | Only before the kitchen starts. Free, no approval. |  |
| `remove.of` | Remove {n} of {m} · not cooking yet |  |
| `remove.use_void` | Already cooking — use Void |  |
| `return.title` | Send back {item}? |  |
| `return.sub` | No reason, no charge. A remade dish stays on the bill unless comped. |  |
| `return.fix` | Fix |  |
| `return.fix_sub` | Same plate · reheat, add salt |  |
| `return.remake` | Remake |  |
| `return.remake_sub` | New plate · full cook time |  |
| `return.closed` | This order is closed |  |
| `return.new_item` | Send it as a new item |  |
| `comp.title` | Give {item} free? |  |
| `comp.needs_manager` | Needs a manager's approval · online only |  |
| `comp.units` | Units |  |
| `comp.ask` | Ask for approval |  |
| `comp.do` | Comp |  |
| `comp.waiting` | Waiting for approval — {amount} comp |  |
| `comp.withdraw` | Withdraw |  |
| `comp.takeaway_card` | Comp · Takeaway order |  |
| `comp.pick_reason` | Pick a reason |  |
| `comp.other` | Other |  |
| `comp.note` | Note |  |
| `contact.title` | Customer contact |  |
| `contact.logged` | this look is logged |  |
| `boost.confirm` | Ask the kitchen to hurry order {id}? |  |
| `orders.abandoned` | Abandoned |  |
| `orders.ready` | Ready {n}/{m} |  |
| `orders.promise` | promise |  |
| `orders.from_date` | from {date} |  |
| `orders.no_tap` | No kitchen tap for {n} h |  |
| `orders.stage_gap` | Kitchen stages aren't sent for takeaway yet: lines show Served / Not served. |  |
| `orders.served` | Served |  |
| `orders.not_served` | Not served |  |
| `held.title` | Held on this screen |  |
| `held.only_you` | Only {name} sees these. They don't keep the table locked. |  |
| `held.resume` | Resume |  |
| `held.discard` | Discard |  |
| `zone.title` | Zone stock |  |
| `zone.warn_at` | warn at {n} |  |
| `zone.low` | Low |  |
| `zone.empty` | Empty |  |
| `zone.refill` | Refill |  |
| `zone.count` | Count |  |
| `zone.refill_title` | Add {item} to {zone} |  |
| `zone.alert_low` | A zone item is running low |  |
| `zone.empty_sent` | Zone empty — {item} sent to the {place} |  |
| `zone.place.kitchen` | kitchen |  |
| `zone.place.counter` | counter |  |
| `zone.undo` | Undo · {time} |  |
| `zone.undo_hint` | Puts {n} back in the {zone} count |  |
| `zone.too_late` | Too late to undo here. Fix the count on the zone screen. |  |
| `queue.title` | Not sent |  |
| `queue.sub` | Things this screen tried to send and the hub refused. |  |
| `queue.signed_out` | Not sent: {name} was signed out |  |
| `queue.changed` | Not sent: the table had changed |  |
| `queue.send_again_as` | Send again as {name} |  |
| `queue.copy` | Copy to a new order |  |
| `queue.discard` | Discard |  |
| `queue.waiting` | {n} waiting to send |  |
| `idle.title` | Signed out after {n} min idle |  |
| `idle.sub` | Your order is kept. {n} waiting item was sent first. |  |
| `compit.title` | Comp the new {item}? |  |
| `compit.body` | Sent again for a dish the guest already had. It’s on the bill unless you comp it. |  |
| `compit.yes_hint` | Yes opens Comp with the item and units filled in. You pick the reason. |  |
| `compit.no` | No, keep on the bill |  |
| `compit.yes` | Yes, comp it |  |
| `compit.kept` | Kept on the bill |  |
| `compit.kept_sub` | You can still comp it from the line. |  |
| `compit.cart_info` | {item} is in a new round for {table}. After Send you’ll be asked to comp it. |  |
| `compit.badge` | Sent again · asks to comp |  |
| `order.toast.sent` | Sent |  |
| `order.toast.queued` | Not sent yet — will send when the hub is back |  |
| `order.toast.time_updated` | Time updated |  |
| `order.toast.served` | Served |  |
| `order.toast.sent_back` | Sent back · ready at {time} |  |
| `order.toast.comp_asked` | Comp asked — waiting for approval |  |
| `order.toast.boosted` | Kitchen told to hurry |  |
| `order.toast.refilled` | Refilled · {n} now |  |
| `order.toast.all_sent` | All sent |  |
| `order.toast.some_not_sent` | {n} not sent — see the queue log |  |
| `queue.reloaded` | Not sent: this screen was restarted |  |
| `queue.too_old` | Not sent: it waited too long |  |
| `queue.refused` | Not sent: {reason} |  |
| `queue.sent_card_sub` | Queued at {time} · call the token |  |
| `queue.ok` | OK |  |
| `queue.why.ITEM_SOLD_OUT` | {item} sold out |  |
| `queue.why.ITEM_UNAVAILABLE` | {item} is not available |  |
| `queue.why.ITEM_OUT_OF_HOURS` | {item} is not served now |  |
| `queue.why.STATION_PAUSED` | a kitchen station is paused |  |
| `queue.why.BUSINESS_DAY_NOT_OPEN` | the day hasn’t started |  |
| `queue.why.MENU_ITEM_NOT_FOUND` | an item is no longer on the menu |  |
| `queue.why.DEAL_NOT_FOUND` | a deal is no longer on the menu |  |
| `queue.why.OPTION_CHOICE_INVALID` | the choices of an item changed |  |
| `queue.why.ORDER_ITEM_ID_IN_USE` | it clashed with another order |  |
| `queue.why.ORDER_NOT_FOUND` | the order is no longer open |  |
| `queue.why.ORDER_BILLED` | the bill is already closed |  |
| `queue.why.ITEM_WRONG_STAGE` | the item was not ready to serve |  |
| `queue.why.TABLE_NEEDS_CLEANING` | the table needs cleaning |  |
| `queue.why.TABLE_ALREADY_LOCKED` | someone else is ordering at the table |  |
| `queue.why.TABLE_NO_ORDERS` | the table has no orders |  |
| `queue.why.TABLE_HAS_OPEN_ORDERS` | the bill must be paid first |  |
| `queue.why.PERMISSION_DENIED` | not allowed for that person |  |
| `queue.why.VALIDATION_FAILED` | the order was not complete |  |
| `queue.why.other` | the hub refused it |  |
| `queue.item` | an item |  |
| `queue.copied` | Copied |  |
| `queue.copy_failed` | Could not keep the copy on this screen |  |
| `idle.sub_none` | Your order is kept. |  |

## In `ur.ts` but not on a frame (needs native review)

- `alert.comp.card`
- `alert.comp.lock`
- `alert.slip_warning.card`
- `alert.slip_warning.lock`
- `alert.zone_stock_low.card`
- `alert.zone_stock_low.lock`
- `alert.zone_stock_out.card`
- `alert.zone_stock_out.lock`
