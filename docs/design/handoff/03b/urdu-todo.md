# 03b + 03c — Urdu still to translate

Keys in `apps/client/src/i18n/en.ts` added for 03b / 03c by the client task W0.3 (brief `docs/design/inventory/03b-03c-design-brief.md` §6.1–§6.7 and handoff `CHANGES.md` §5, with owner rulings Q-53 and Q-57) with no entry in `ur.ts`. They show in English on an Urdu page until translated (01a S49 fallback). W0.3 filled `ur.ts` from the Urdu frames (`PassUrdu`, `PassHandOverUrdu`, `PassTakeoverUrdu`, `AlertCardsUrdu`, `KitchenScreensUrdu`, `PrintersUrdu`). `apps/client/src/i18n/i18n.test.ts` checks that every 03b key is either in `ur.ts` or listed here. A lane that appends a 03b key without Urdu lists it here too (under its own heading).

## KDS (English only in P1, brief §6.1)

The KDS shows English only in P1 (story E3). Listed so the Urdu pass has the full set; `kds.car.*` also show on the Pass (`kds.car.sedan` is on `PassUrdu`).

48 keys.

| Key | English | Note |
|---|---|---|
| `kds.now` | Now |  |
| `kds.next` | Next |  |
| `kds.later` | Later: {n} |  |
| `kds.start` | Start |  |
| `kds.done` | Done |  |
| `kds.undo` | Undo {time} |  |
| `kds.waiting` | waiting {time} |  |
| `kds.cooking` | cooking {time} |  |
| `kds.late` | late +{n} min |  |
| `kds.in` | in {time} |  |
| `kds.done_early` | Done already? {elapsed} of {cook} — tap again |  |
| `kds.start_first` | Tap Start first |  |
| `kds.tap_done` | Tap Done when ready — it won't finish by itself |  |
| `kds.undo_closed` | Too late to undo |  |
| `kds.handed_over` | Already handed over — can't undo |  |
| `kds.gone` | This order is no longer in the kitchen |  |
| `kds.changed` | Already {stage} |  |
| `kds.changed.served` | served |  |
| `kds.changed.removed` | removed |  |
| `kds.not_this_station` | Not this station's line |  |
| `kds.give_more` | Give me more |  |
| `kds.nothing_to_pull` | Nothing to pull right now |  |
| `kds.lanes` | Lanes: {on} of {count} on |  |
| `kds.lanes_custom` | Custom capacity |  |
| `kds.lane_off` | Lane Off |  |
| `kds.lane_on` | Lane On |  |
| `kds.reconnecting` | Reconnecting… |  |
| `kds.archived` | Station archived — finish open tickets · {n} open |  |
| `kds.day_not_started` | Day not started |  |
| `kds.empty` | Nothing to cook right now |  |
| `kds.coming_up` | Coming up |  |
| `kds.mark.return` | RETURN |  |
| `kds.mark.fix` | Fix |  |
| `kds.mark.remake` | Remake |  |
| `kds.mark.was` | was {identifier} {item} |  |
| `kds.mark.boost` | Boost |  |
| `kds.mark.expedite` | Expedite |  |
| `kds.mark.pulled` | Pulled |  |
| `kds.mark.moved` | Moved |  |
| `kds.for_parent` | for {item} |  |
| `kds.deal` | ({deal}) |  |
| `kds.car.mini` | Mini |  |
| `kds.car.large` | Large |  |
| `kds.loading` | Loading… |  |
| `kds.append_hint` | new lines join at the end |  |
| `kds.batch_started` | One tap started the whole load ({n} lines) |  |
| `kds.batch_done` | One tap finished the whole load — Undo on any line undoes all |  |
| `kds.ready_made` | Ready-made |  |

## Pass, alert cards, hub admin (brief §6.2–§6.7, CHANGES §5)

87 keys.

| Key | English | Note |
|---|---|---|
| `pass.undo_closed` | Too late to undo |  |
| `pass.handed_left` | {n} handed to {name} · {k} left — tap Hand over again |  |
| `pass.no_receivers` | Nobody signed in can take this order. Ask a waiter to sign in. |  |
| `pass.receiver_invalid` | {name} can't take this order now — pick someone else |  |
| `pass.nothing_done` | Nothing is done yet to hand over |  |
| `pass.nothing_left` | Nothing left to serve on this order |  |
| `pass.gone` | This order is no longer in the kitchen |  |
| `pass.not_due` | Not due yet |  |
| `pass.offline` | No connection to the hub — reconnecting… |  |
| `pass.read_only` | You can see the Pass but not run it. Ask a manager. |  |
| `pass.point_archived` | This Pass point is archived. Ask a manager to set up this tablet again. |  |
| `pass.empty` | No orders at the Pass |  |
| `pass.more_lines` | +{n} more lines |  |
| `print.reprint` | Reprint |  |
| `print.reprinting` | Reprinting {n} tickets |  |
| `print.reprint_queued` | It prints when the printer is back |  |
| `print.nothing_to_reprint` | Nothing to reprint |  |
| `print.no_tickets` | This order has no tickets |  |
| `kitchen_screens.volume_help` | How loud the kitchen screen chimes. 0 is silent. |  |
| `kitchen_screens.state.offline` | Offline |  |
| `kitchen_screens.dark` | Screen offline — its tickets are on the Pass |  |
| `kitchen_screens.lane_label_help` | Give each screen of a big station its own name, like Left or Right. |  |
| `kitchen_screens.bind` | Use as Pass tablet for… |  |
| `kitchen_screens.unbind` | Stop using as Pass tablet |  |
| `kitchen_screens.warn.archived_open_lines` | {station} is archived but still has open tickets |  |
| `kitchen_screens.warn.dark` | {station} screen is offline |  |
| `kitchen_screens.point_archived` | Point archived — bind to another point |  |
| `kitchen_screens.no_stations` | Add stations in the owner app first |  |
| `admin.ks.empty` | No stations yet |  |
| `admin.ks.empty_hint` | Add stations in the owner app first |  |
| `admin.ks.signed_out_normal` | “Signed out” is normal: a Pass tablet with nobody signed in still gets alerts. |  |
| `admin.ks.volume_saved` | Saved. {station} screens use it on the next sound. |  |
| `errors.STATION_NOT_FOUND` | This station is no longer there — reload |  |
| `errors.DEVICE_NOT_FOUND` | This device was removed — reload |  |
| `errors.POINT_NOT_FOUND` | That point no longer exists |  |
| `printers.add` | Add printer |  |
| `printers.none` | No printers. Every station works on its screen. Add a printer only if you want paper. |  |
| `printers.name` | Name |  |
| `printers.connection` | Connection |  |
| `printers.lan` | Network (LAN) |  |
| `printers.usb` | USB |  |
| `printers.address` | Address |  |
| `printers.paper` | Paper |  |
| `printers.address_help_lan` | Like 192.168.1.50:9100 |  |
| `printers.address_help_usb` | /dev/usb/lp0 or /dev/pos-printer-… from the install guide |  |
| `printers.status.paper_out` | Out of paper |  |
| `printers.status.offline` | Offline |  |
| `printers.suspect` | {n} may not have printed — they reprint by themselves when the printer is ready |  |
| `printers.error.connect` | Can't reach the printer |  |
| `printers.error.write_timeout` | The printer stopped taking paper |  |
| `printers.error.write_failed` | Sending failed |  |
| `printers.error.busy` | In use — try again in a moment |  |
| `printers.test_busy` | Printing a test… |  |
| `printers.test_ok` | Printed. Status works. |  |
| `printers.test_no_status` | Printed. This printer doesn't report status. |  |
| `printers.test_bad_status` | Printed, but the printer reports {status} |  |
| `printers.test_failed` | Couldn't print: {error} |  |
| `printers.test_recovered` | {n} tickets that may not have printed are being reprinted |  |
| `printers.archive_confirm` | Archive {name}? It stops printing. |  |
| `printers.in_use` | {stations} still use this printer. Change their output first. |  |
| `printers.used_by` | Used by {stations} |  |
| `printers.warn.lossy_name` | '{name}' has letters the printer can't print. They print as '?'. Use English letters for names that print. |  |
| `printers.warn.fold_skipped` | A ticket for {station} could not be built. Check that order on the screen. |  |
| `printers.warn.suspect_waiting` | {station}: tickets that may not have printed are waiting for the printer to be ready |  |
| `printers.warn.screen_unused` | {station} prints only, but a kitchen screen is paired to it. The screen shows nothing useful. |  |
| `printers.warn.no_screen` | {station} has a fallback printer but no kitchen screen. It never falls back to paper. Set it to 'Paper only' to print every ticket. |  |
| `outputs.show_taker` | Show order taker on the ticket |  |
| `outputs.show_order_id` | Show order number on the ticket |  |
| `outputs.need_printer` | Pick a printer for paper |  |
| `print_queue.kind.kitchen` | Ticket |  |
| `print_queue.kind.reprint` | Reprint |  |
| `print_queue.kind.cancel` | Cancelled slip |  |
| `print_queue.kind.first` | First slip |  |
| `print_queue.kind.coming_up` | Coming up |  |
| `print_queue.kind.document` | Bill / receipt |  |
| `print_queue.tried` | tried {n} times |  |
| `print_queue.no_printer` | No printer: this station has no printer now. This job will never print. Cancel it or give the station a printer. |  |
| `print_queue.no_printer_total` | {n} jobs have no printer |  |
| `print_queue.cancel_confirm` | Cancel this ticket? It will not print. |  |
| `print_queue.already_printed` | Already printed |  |
| `print_queue.already_cancelled` | Already cancelled |  |
| `admin.pr.none_hint` | Every station works on its screen. Add a printer only if you want paper. |  |
| `errors.PRINTER_NOT_FOUND` | This printer was removed or archived — reload |  |
| `errors.PRINT_JOB_NOT_FOUND` | This job is no longer there |  |
| `errors.PRINT_JOB_NOT_PENDING` | Already printed or cancelled |  |
| `errors.ITEM_UNDO_WINDOW_CLOSED` | Too late to undo |  |
| `errors.PASS_UNDO_WINDOW_CLOSED` | Too late to undo |  |

## Needs native review (in `ur.ts`, not on a frame, or worded beyond the frame)

Every `alert.*` / `alerts.*` key must be in `ur.ts` (the `[01d §3.12]` labels test), so these were written without a frame text:

- alert.served_card.lock
- alert.printer_problem.help.ticket_not_built
- pass.undo_ready
- pass.ready_at
- printers.last_printed
- printers.checked
- kitchen_screens.lanes

## Lane A (03b client) — A1 kitchen screens

Appended by task A1 under the lane A marker of `en.ts`; no Urdu frame text for these.

| Key | English | Note |
|---|---|---|
| `kitchen_screens.lane_label_for` | Lane label · {screen} | dialog title |
| `kitchen_screens.lane_label_limits` | 1–20 letters. Empty = not a lane. |  |
| `kitchen_screens.remove_label` | Remove label |  |
| `kitchen_screens.lane_label_kds_only` | Lane labels are only for kitchen screens | brief §3.4 |
| `kitchen_screens.tablet` | Tablet |  |
| `kitchen_screens.pick_tablet` | Pick a tablet |  |
| `kitchen_screens.bind_body` | “{name}” will show the Pass after sign-in and get always-on alerts. |  |
| `kitchen_screens.point_archived_short` | Point archived | bind picker tile |
| `kitchen_screens.save` | Save |  |
| `kitchen_screens.warn.dark_detail` | Its tickets are on the Pass tablet. |  |
| `kitchen_screens.warn.archived_detail` | They finish on its screen. |  |
| `kitchen_screens.sign_in` | Sign in to set up kitchen screens |  |
| `kitchen_screens.no_admins` | No one here can set up kitchen screens |  |

## Lane A (03b client) — A2 printers

| Key | English | Note |
|---|---|---|
| `printers.section_help` | Optional. Paper jobs never block the till or the kitchen screens. |  |
| `printers.none_title` | No printers |  |
| `printers.archived` | Archived | printer chip |
| `printers.used_by_nothing` | nothing | in `printers.used_by` |
| `printers.edit_title` | Edit {name} | dialog title |
| `printers.name_help` | 1–40 letters, different from your other printers |  |
| `printers.name_required` | Give the printer a name |  |
| `printers.name_taken` | Another printer has this name | CONFIG_NAME_TAKEN on the field |
| `printers.address_error_lan` | Use a private network address like 192.168.1.50:9100 |  |
| `printers.address_error_usb` | Use /dev/usb/lp0 or /dev/pos-printer-… from the install guide |  |
| `printers.paper_mm` | {n} mm |  |
| `printers.test_busy_detail` | Up to 8 seconds. It does not wait for the queue. |  |
| `printers.go_outputs` | Go to Station outputs |  |
| `printers.sign_in` | Sign in to set up printers |  |
| `printers.no_admins` | No one here can set up printers |  |
| `printers.test_in_use` | The printer is busy printing tickets. Try again in a moment. | frame PrinterTest (#197 review) |

## Lane K (03b client, KDS)

Appended by lane K (KDS English only in P1, brief §6.1).

| Key | English | Note |
|---|---|---|
| `kds.live` | Live | K1 |
| `kds.reconnecting_banner` | Reconnecting… buttons are off until the hub is back | K1, 03b-B06 |
| `kds.reconnecting_note` | Taps are not saved — tap again after | K1, 03b-B06 |
| `kds.hub_unreachable` | Can't reach the hub — retrying… | K1 |
| `kds.replaced` | This screen is open in another window | K1, 00 M53 |
| `kds.use_this_window` | Use this window | K1, 00 M53 |
| `kds.not_kitchen_screen` | This device isn't a kitchen screen | K1 |
| `kds.not_kitchen_screen_sub` | It is paired as another kind of device. | K1 |
| `kds.open_staff` | Open the staff screen | K1 |
| `kds.pair_again_sub` | Ask a manager to pair this screen again. | K1 |
| `kds.try_again` | Try again | K1 |
| `kds.reload` | Reload | K1 |
| `kds.wifi_title` | Connect to the staff Wi-Fi | K1, 00-F03 |
| `kds.wifi_body` | This screen is on the customer Wi-Fi. Switch it to the staff Wi-Fi. It opens by itself when it can reach the hub. | K1, 00-F03 |
| `kds.not_set_up_title` | The hub is being set up | K1, 00-F06 |
| `kds.not_set_up_body` | This screen opens by itself when setup is done. | K1, 00-F06 |
| `kds.wrong_host_title` | Open the hub by its address | K1, 00-F07 |
| `kds.wrong_host_body` | Type the number address in the browser, not a name. | K1, 00-F07 |
| `kds.update_title` | Update the app | K1, 00-F04 |
| `kds.update_body` | The hub has a newer version. Reload to get it. | K1, 00-F04 |
| `kds.busy` | Hub busy, try again. | K1, 00-F05 |
| `kds.busy_small` | Nothing was saved. | K1, 00-F05 |
| `kds.page_fault` | This page didn't load right | K1 |
| `kds.page_fault_body` | Reload it. If it happens again, ask a manager. | K1 |
