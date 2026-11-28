# 02b — Urdu still to translate

Keys in `apps/client/src/i18n/en.ts` added for 02b by the client task W0.3 (handoff `CHANGES.md` §4 + §6, the toast frame, the stage words (frame `Stages`)) with no entry in `ur.ts`. They show in English on an Urdu page until translated (01a S49 fallback). W0.3 filled `ur.ts` from the Urdu frames (`OrderUrdu`, `TableViewUrdu`). `apps/client/src/i18n/i18n.test.ts` checks that every 02b key is either in `ur.ts` or listed here. A lane that appends a 02b key without Urdu lists it here too.

Needs native review as well: the 02b entries of `ur.ts` that are not on a frame (below the table).

153 keys.

| Key | English | Note |
|---|---|---|
| `menu.here_kitchen` | 0 here · kitchen |  |
| `tv.food_at` | Food at {time} |  |
| `tv.progress` | Kitchen progress updated {time} |  |
| `tv.refresh` | Refresh |  |
| `tv.updated` | Updated {time} |  |
| `stage.served` | Served · {time} |  |
| `stage.served_closed` | Served · closed |  |
| `stage.not_tracked` | Not tracked |  |
| `stage.counter_served` | From the counter · Served |  |
| `stage.no_kitchen` | No kitchen — serve when ready |  |
| `stage.badge.comped` | Comped ×{n} |  |
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
| `boost.confirm` | Ask the kitchen to hurry order {id}? |  |
| `held.only_you` | Only {name} sees these. They don't keep the table locked. |  |
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
