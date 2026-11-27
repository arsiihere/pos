# Urdu to check with staff (02b-TK)

The Urdu in `gen/strings.py` was written for this hand-off. Read it aloud with the Lake City counter staff before the build, especially these:

- `c.send_later` "بھیجیں · پیسے بعد میں" — staff may say "ادائیگی بعد میں"
- `q.collect` "حوالے کریں" (Hand over) — counter word may be "دے دیں"
- `v.hurry` "کچن کو جلدی" — check it doesn't read as rude
- `c.delta` (long sentence about the karahi station) — shorten if staff prefer
- `shell.day.closed` — long; a shorter version may fit the banner better
- Board voice clips: "ٹوکن نمبر …" numbers 1–999, recorded by a staff voice

## Strings written during the build (not in strings-table.md)

These keys were added to `apps/client/src/i18n/en.ts` and `ur.ts` while building 02b-TK Part A (batches C1–C3). Neither the English nor the Urdu comes from the hand-off: both need staff review. Source of truth stays `en.ts` / `ur.ts`; change them there, then tick the row here.

| Key | English | Urdu (to check) |
|---|---|---|
| `menu.now` | Now | ابھی |
| `menu.about` | about {n} min | تقریباً {n} منٹ |
| `menu.estimate_hint` | Estimate — the cart shows the promised time | اندازہ — وعدہ کا وقت کارٹ میں ہے |
| `pass.bag_ready` | Bag ready | بیگ تیار |
| `pass.pack_next` | Pack next | اگلا پیک کریں |
| `pass.ready_by` | Ready by {time} | تیار ہوگا {time} |
| `pass.filter.label` | Show orders | آرڈر دکھائیں |
| `pass.filter.all` | All | سب |
| `pass.filter.dine_in` | Dine-in | میز پر |
| `pass.filter.takeaway` | Takeaway | ٹیک اوے |
| `pass.filter.parking` | Parking | پارکنگ |
| `pass.empty.dine_in` | No dine-in orders at the Pass | پاس پر میز کا کوئی آرڈر نہیں |
| `pass.empty.takeaway` | No takeaway orders at the Pass | پاس پر ٹیک اوے کا کوئی آرڈر نہیں |
| `pass.empty.parking` | No parking orders at the Pass | پاس پر پارکنگ کا کوئی آرڈر نہیں |
| `opt.save` | Save changes | تبدیلیاں محفوظ کریں |
| `opt.more` | One more {option} | ایک اور {option} |
| `opt.less` | One less {option} | ایک کم {option} |
| `q.tab` | Queue | قطار |
| `v.pay_first` | Take payment first | پہلے پیسے لیں |
| `c.add_gone` | This token can’t take more items (closed, cancelled or another day) — send them as a new order | اس ٹوکن میں مزید آئٹم نہیں ڈل سکتے (بند، منسوخ یا دوسرے دن کا) — نیا آرڈر بھیجیں |
| `c.add_busy` | Send or hold this cart first, then add to the token | پہلے یہ کارٹ بھیجیں یا ہولڈ کریں، پھر ٹوکن میں ڈالیں |
| `v.refund_first` | Paid: reopen the bill first (Bill → Reopen), then take the item off here — the bill shows the refund to give | ادا ہو چکا: پہلے بل دوبارہ کھولیں (بل ← دوبارہ کھولیں)، پھر یہاں آئٹم ہٹائیں — بل واپسی کی رقم دکھائے گا |
| `line.err.closed_split` | This item is on a paid part of the bill — reopen the bill to refund it | یہ آئٹم بل کے ادا شدہ حصے پر ہے — واپسی کیلئے بل دوبارہ کھولیں |
| `line.err.void_not_allowed` | This item can’t be voided now — refreshed | یہ آئٹم ابھی void نہیں ہو سکتا — تازہ کر دیا |
| `h.by` | by {name} | {name} نے |
| `h.shared` | Everyone on this counter sees these. Table orders stay with who held them. | اس کاؤنٹر پر سب یہ دیکھتے ہیں۔ میز کے آرڈر اسی کے پاس رہتے ہیں جس نے ہولڈ کیے۔ |
| `p.err_kitchen` | Pay later keeps it Due — the order is already in the kitchen. | بعد میں لینے پر یہ باقی رہے گا — آرڈر کچن میں جا چکا ہے۔ |
| `p.err_day` | The day hasn’t started — start the day before taking money | دن شروع نہیں ہوا — پیسے لینے سے پہلے دن شروع کریں |
| `p.close_err` | The bill didn’t close | بل بند نہیں ہوا |
| `p.close_err_sub` | The payment is in. Try again, or open the bill to finish it. | ادائیگی ہو گئی ہے۔ دوبارہ کوشش کریں، یا بل کھول کر مکمل کریں۔ |
| `p.open_bill` | Open bill | بل کھولیں |
| `v.check_day` | The day hasn’t started — no check bill yet | دن شروع نہیں ہوا — ابھی چیک بل نہیں |
| `v.check_denied` | You can’t print the check bill for this order | آپ اس آرڈر کا چیک بل پرنٹ نہیں کر سکتے |
| `shell.me.shift_open` | Opened {time} · float {money} | {time} پر کھلی · فلوٹ {money} |
| `shell.locked` | Screen locked | اسکرین لاک ہے |
| `m.hint_qty` | 4 × naan | 4 × نان |
| `m.hint_initials` | half karahi | آدھی کڑاہی |
| `m.hint_add` | add | ڈالیں |
| `m.hint_clear` | clear | صاف کریں |
| `t.off_reason` | {item} — {reason} | {item} — {reason} |
| `m.not_now` (placeholder for the table's "From 7 PM") | From {time} | {time} سے |
| `m.paused` (placeholder for the table's "Tandoor paused") | {station} paused | {station} رکا ہوا |
| `t.sold_out` (placeholder for the table's "Chicken Tikka") | {item} is sold out — ask the kitchen | {item} ختم ہے — کچن سے پوچھیں |
| `c.delta` (placeholders for the table's "2nd karahi" / "karahi station") | {item} adds {n} min — the {station} station is full | {item} سے {n} منٹ بڑھ گئے — {station} اسٹیشن بھرا ہے |
| `c.delta_busy` | {item} adds {n} min — the {station} station is busy | {item} سے {n} منٹ بڑھ گئے — {station} اسٹیشن مصروف ہے |
| `c.delta_plain` | {item} adds {n} min | {item} سے {n} منٹ بڑھ گئے |
| `c.serve_q` (placeholder for the table's "Paye") | {item} is ready now. Give it now? | {item} ابھی تیار ہیں۔ ابھی دے دیں؟ |
| `c.serve_now` (placeholder for the table's "Paye") | {item} now, rest {t} | {item} ابھی، باقی {t} |
| `c.serve_q_many` | {item} are ready now. Give them now? | {item} ابھی تیار ہیں۔ ابھی دے دیں؟ |
| `cd.welcome` | Welcome | خوش آمدید |
| `cd.order` | Your order | آپ کا آرڈر |
| `cd.total` | Total | کل |
| `cd.paid` | Paid | ادا ہو گیا |
| `cd.change` | Change | بقایا رقم |
| `cd.open` | Customer screen | گاہک کی اسکرین |
| `cd.thanks` | Thank you! | شکریہ! اپنا ٹوکن پرچی پر دیکھیں |
| `q.search_token` | Token number | ٹوکن نمبر |
| `c.phone_pay` | Pay | ادائیگی |
| `billing.already_paid` (05 §6.3, R3-M-1) | Already paid | پہلے ادا شدہ |
| `billing.remaining_payable` (05 §6.3, R3-M-1) | Remaining payable | باقی قابلِ ادائیگی |
| `owner.points.edit` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Edit | ترمیم |
| `owner.points.edit_title` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Edit point | پوائنٹ میں ترمیم |
| `owner.points.receives` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Receives | کون سے آرڈر لیتا ہے |
| `owner.points.receives_all` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | All order types | تمام آرڈر کی قسمیں |
| `owner.points.receives_help` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Each line goes to the Pass that takes its order type; with none, to the station's Pass. | ہر آئٹم اس پاس پر جاتا ہے جو اس کے آرڈر کی قسم لیتا ہے؛ کوئی نہ ہو تو اسٹیشن کے پاس پر۔ |
| `owner.points.receives_n` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Receives: {types} | لیتا ہے: {types} |
| `owner.points.type.dine_in` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Dine-in | میز پر |
| `owner.points.type.takeaway` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Takeaway | ٹیک اوے |
| `owner.points.type.parking` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Parking | پارکنگ |
| `owner.points.type.delivery` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Delivery | ڈیلیوری |
| `owner.points.delivery_readonly` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Kept as saved. Delivery orders are not taken yet. | جیسا محفوظ تھا ویسا رہے گا۔ ڈیلیوری کے آرڈر ابھی نہیں لیے جاتے۔ |
| `owner.points.archive_moves_body` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Orders still waiting here move to the Pass that takes them now. You can restore it later. | یہاں انتظار کرنے والے آرڈر اس پاس پر چلے جائیں گے جو انہیں اب لیتا ہے۔ بعد میں بحال کر سکتے ہیں۔ |
| `owner.points.archive_refused` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Activate another Pass point first | پہلے کوئی اور پاس پوائنٹ فعال کریں |
| `owner.stations.default_pass` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Default Pass | بنیادی پاس |
| `owner.stations.default_pass_help` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Used when no Pass takes the order's type, and for ties. | جب کوئی پاس آرڈر کی قسم نہ لے، اور برابری کی صورت میں۔ |
| `kitchen_screens.gap.fallback` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | {type} orders from {station} have no {type} Pass — they go to {point} | {station} کے {type} آرڈرز کا کوئی {type} پاس نہیں — یہ {point} پر جاتے ہیں |
| `kitchen_screens.gap.tie` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | {type} orders from {station} match {n} Passes: {points} — they go to {point} | {station} کے {type} آرڈرز {n} پاس سے ملتے ہیں: {points} — یہ {point} پر جاتے ہیں |
| `kitchen_screens.gap.detail` (01a v2.11 §6.9a / 03b §3.8, L-CLIENT-1 item 4) | Change Receives on the owner app's Points page, then Reload here once the hub has the change. | مالک کی ایپ کے پوائنٹس صفحے پر "کون سے آرڈر لیتا ہے" بدلیں، پھر ہب پر تبدیلی آنے کے بعد یہاں دوبارہ لوڈ کریں۔ |
| `pass.handed_to_customer` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 1) | Handed to customer | گاہک کو دے دیا |
| `pass.take_payment_first` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 1) | Take payment first | پہلے پیسے لیں |
| `pass.other_items_not_ready` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 1) | Other items of this order are not ready yet | اس آرڈر کی باقی چیزیں ابھی تیار نہیں |
| `pass.handed_undo` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 1) | {identifier} handed to customer · Undo | {identifier} گاہک کو دے دیا · واپس کریں |
| `pass.offline_counter` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 1) | Offline — hand over at the counter | آف لائن — کاؤنٹر پر حوالے کریں |
| `pass.pickup_at` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 1) | Pickup at {time} — use 'Customer is here' at the counter | {time} پر لینا ہے — کاؤنٹر پر 'گاہک آ گیا' استعمال کریں |
| `pass.due` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 1) | Due — customer pays at counter | باقی — گاہک کاؤنٹر پر ادا کرے گا |
| `pass.waiting_bill` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 1) | Waiting for the bill | بل کا انتظار |
| `pass.pickup_label` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 1) | Pickup {time} | لینا ہے {time} |
| `pass.hand_at_counter` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 1) | Hand over at the counter | کاؤنٹر پر حوالے کریں |
| `pass.outside_scope` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 1) | This order is not one of yours — hand over at the counter | یہ آرڈر آپ کا نہیں — کاؤنٹر پر حوالے کریں |
| `pass.not_collected` (03b v1.0.16 §3.4 / §8, L-CLIENT-1 item 2) | Ready {n} min ago — not collected | {n} منٹ سے تیار — کوئی نہیں آیا |
| `alert.ready_to_serve.counter` (03b v1.0.16 §3.5 R8, L-CLIENT-1 item 2) | Bag ready — hand over at the counter | بیگ تیار — کاؤنٹر پر حوالے کریں |
| `alert.ready_to_serve.counter_escalated` (03b v1.0.16 §3.5 R8, L-CLIENT-1 item 2) | Not collected for {n} min — managers told | {n} منٹ سے کوئی نہیں آیا — مینیجر کو بتا دیا |
| `pass.point_retired` (03b v1.0.16 §6.16 R3-M-1, D7; L-CLIENT-2 item 1) | This point was retired — ask a manager to set this tablet to another point | یہ پوائنٹ ختم کر دیا گیا — مینیجر سے کہیں کہ یہ ٹیبلٹ کسی اور پوائنٹ پر لگائیں |
| `pass.moved_from` (03b v1.0.16 §3.10, §6.15 R3-M-1, D7; L-CLIENT-2 item 1) | Moved from {point} | {point} سے منتقل |
| `admin_stock.problem.archive_refused` (01a v2.11 §6.21 R3-B-1, D7; L-CLIENT-2 item 1) | Menu update refused: activate another Pass point first. | مینو کی تبدیلی رد ہوئی: پہلے کوئی اور پاس پوائنٹ فعال کریں۔ |
| `pass.ask_manager` (02b v1.0.25 §3.7a, §8 OR-7; 03b v1.0.16 §3.4; L-CLIENT-2 item 4) | Ask a manager | مینیجر سے پوچھیں |
| `pass.waiting_manager` (02b v1.0.25 §3.7a; L-CLIENT-2 item 4) | Waiting for a manager… | مینیجر کا انتظار… |
| `pass.manager_rejected` (02b v1.0.25 §3.7a; L-CLIENT-2 item 4) | Manager said no | مینیجر نے منع کر دیا |
| `unpaid.already_waiting` (02b v1.0.25 §3.7a; L-CLIENT-2 item 4) | Already waiting for a manager | مینیجر سے پہلے ہی پوچھا جا چکا ہے |
| `unpaid.withdraw` (02b v1.0.25 §3.7a; L-CLIENT-2 item 4) | Withdraw | واپس لیں |
| `unpaid.approved` (02b v1.0.25 §6.4a; L-CLIENT-2 item 4) | Manager approved — hand over | مینیجر نے اجازت دے دی — حوالے کریں |
| `unpaid.not_needed` (02b v1.0.25 §6.4a; L-CLIENT-2 item 4) | Nothing is due now — hand over | ابھی کچھ باقی نہیں — حوالے کریں |
| `unpaid.refused` (02b v1.0.25 §6.4; L-CLIENT-2 item 4) | Not paid — take payment first or ask a manager | ادائیگی نہیں ہوئی — پہلے پیسے لیں یا مینیجر سے پوچھیں |
| `unpaid.offline` (02b v1.0.25 §6.4a; L-CLIENT-2 item 4) | Offline — ask a manager once the hub is back | آف لائن — ہب واپس آنے پر مینیجر سے پوچھیں |
| `alert.hand_over_unpaid.card` (02b v1.0.25 §6.12a R3-m-4; L-CLIENT-2 item 4) | Hand over unpaid {identifier} | {identifier} بغیر ادائیگی حوالے کریں |
| `alert.hand_over_unpaid.lock` (02b v1.0.25 §6.12a R3-m-4; L-CLIENT-2 item 4) | Unpaid hand-over request | بغیر ادائیگی حوالگی کی درخواست |
| `alert.hand_over_unpaid.name` (01d §3.10 in-person title; L-CLIENT-2 item 4) | Unpaid hand-over | بغیر ادائیگی حوالگی |
| `billing.check_amounts` (05 v1.0.35 §6.3, §6.3a R3-M-1; L-CLIENT-3 item 1) | Gross total {gross} · Remaining payable {due} | کل رقم {gross} · باقی قابلِ ادائیگی {due} |
| `billing.check_not_printed` (05 v1.0.35 §6.3a line refusals; L-CLIENT-3 item 1) | Check bill not printed — {why} | چیک بل پرنٹ نہیں ہوا — {why} |
| `billing.receipt_again` (05 v1.0.35 §8 OR-5; L-CLIENT-3 item 1) | Print receipt again | رسید دوبارہ پرنٹ کریں |
| `takeaway.slip.printing` (03c v1.0.16 §8; L-CLIENT-3 item 2) | Slip printing | پرچی پرنٹ ہو رہی ہے |
| `takeaway.slip.not_printed` (03c v1.0.16 §8; L-CLIENT-3 item 2) | Slip not printed — Print slip | پرچی پرنٹ نہیں ہوئی — پرچی پرنٹ کریں |
| `takeaway.slip.no_printer` (03c v1.0.16 §8; L-CLIENT-3 item 2) | No slip printer is set up — the token is on the screen | پرچی کا پرنٹر نہیں لگا — ٹوکن اسکرین پر ہے |
| `takeaway.slip.off` (03c v1.0.16 §8; L-CLIENT-3 item 2) | Token slips are turned off | ٹوکن پرچی بند ہے |
| `errors.TAKEAWAY_SLIP_NOT_ALLOWED` (03c v1.0.16 §8; L-CLIENT-3 item 2) | No slip for this order — it is paid, cancelled or not a takeaway | اس آرڈر کی پرچی نہیں — ادائیگی ہو چکی، منسوخ ہے یا ٹیک اوے نہیں |
| `perm.hand-over-unpaid` (01b v1.12 B-5 R3-M-3; L-CLIENT-3 test 119) | Approve handing over an unpaid order | بغیر ادائیگی آرڈر حوالے کرنے کی اجازت دینا |
| `roles.out_of_date` (01b v1.12 §5.1c R3-M-3; L-CLIENT-3 test 119) | This app is out of date — reload to edit roles | یہ ایپ پرانی ہے — رولز بدلنے کے لیے دوبارہ لوڈ کریں |
| `roles.out_of_date_body` (01b v1.12 §5.1c R3-M-3; L-CLIENT-3 test 119) | This role has a permission this version of the app does not know. Saving now could remove it. | اس رول میں ایسی اجازت ہے جو ایپ کا یہ ورژن نہیں جانتا۔ ابھی محفوظ کرنے سے وہ ہٹ سکتی ہے۔ |
| `cart.items_label` (02b v1.0.25 §8; 05 v1.0.35 §6.3a, §8; L-CLIENT-4 item 3) | Items | آئٹم |
| `c.pick_range` (02b v1.0.25 §6.14, §8; L-CLIENT-5 item 1) | Pickup between {from} and {to} | لینے کا وقت {from} سے {to} تک |
| `c.pick_err.too_early` (02b v1.0.25 §3.2 step 2b; L-CLIENT-5 item 1) | Too soon — the earliest pickup is {t} | بہت جلدی — سب سے پہلے {t} پر لے سکتے ہیں |
| `c.pick_err.after_day_end` (02b v1.0.25 §3.2 step 2b; L-CLIENT-5 item 1) | Too late — the day ends at {t} | بہت دیر — دن {t} پر ختم ہوتا ہے |
| `c.pick_err.other_day` (02b v1.0.25 §3.2 step 2b; L-CLIENT-5 item 1) | That time is on another business day — pick a time today | یہ وقت کسی اور کاروباری دن کا ہے — آج کا وقت چنیں |
| `c.pick_err.no_time_left` (02b v1.0.25 §3.2 step 2b, §8; L-CLIENT-5 item 1) | No pickup time is left today — choose Now, or close the day first | آج لینے کا کوئی وقت باقی نہیں — ابھی چنیں، یا پہلے دن بند کریں |
| `queue.why.PICKUP_TIME_INVALID` (02b v1.0.25 §3.12; L-CLIENT-5 item 1) | the pickup time was not possible | لینے کا وقت ممکن نہیں تھا |
| `v.here` (02b v1.0.25 §8 02b-R4-3; L-CLIENT-5 item 2) | Customer is here — cook now | گاہک آ گیا — ابھی بنائیں |
| `v.here_done` (02b v1.0.25 §6.6; L-CLIENT-5 item 2) | The kitchen cooks it now | کچن اب بنا رہا ہے |
| `q.ready_planned` (02b v1.0.25 §6.16, ruling BR-1) | Ready ~{t} | تقریباً {t} تک تیار |

Historical copy for Urdu review. OR-7 disabled the client override.

| Key | English | Urdu |
| --- | --- | --- |
| `v.override` | Hand over unpaid · manager | بغیر ادائیگی حوالے کریں · مینیجر |

## Strings drafted by L-CLIENT-6b (token drawer, pay panel, item / deal sheets, held drawer, shell Urdu)

Drafts for the owner and the Lake City staff to read aloud. Source of truth stays `en.ts` / `ur.ts`. Keys marked *was listed in …/urdu-todo.md* were moved out of that module's list (the i18n check allows a key in ur or in a to-do list, not both).

| Key | English | Urdu (draft, to check) | Note |
|---|---|---|---|
| `h.title` | Held on this counter | اس کاؤنٹر پر ہولڈ | new key (L-CLIENT-6b) |
| `h.resume` | Resume | جاری رکھیں | new key (L-CLIENT-6b) |
| `h.discard` | Throw away | ختم کریں | new key (L-CLIENT-6b) |
| `h.at` | Held {time} | {time} پر ہولڈ | new key (L-CLIENT-6b) |
| `h.not_kitchen` | Held orders are not in the kitchen. Resume one to send it. | ہولڈ آرڈر کچن میں نہیں گئے۔ بھیجنے کیلئے جاری رکھیں۔ | new key (L-CLIENT-6b) |
| `h.empty` | Nothing is held on this counter | اس کاؤنٹر پر کچھ ہولڈ نہیں | new key (L-CLIENT-6b) |
| `is.size` | Size | سائز | new key (L-CLIENT-6b) |
| `is.pick` | Pick {n} | {n} چنیں | new key (L-CLIENT-6b) |
| `is.up_to` | Pick up to {n} | {n} تک چنیں | new key (L-CLIENT-6b) |
| `is.any` | Any amount | جتنے چاہیں | new key (L-CLIENT-6b) |
| `is.each` | each | فی عدد | new key (L-CLIENT-6b) |
| `is.weight` | Weight | وزن | new key (L-CLIENT-6b) |
| `is.steps` | {n} g steps | {n} گرام کے حساب سے | new key (L-CLIENT-6b) |
| `is.weigh_later` | Weigh later — price after weighing | بعد میں تولیں — قیمت تولنے کے بعد | new key (L-CLIENT-6b) |
| `is.turned_off` | Kitchen turned it off | کچن نے بند کر دیا | new key (L-CLIENT-6b) |
| `is.note_ph` | Kitchen note ({n}) | کچن کیلئے نوٹ ({n}) | new key (L-CLIENT-6b) |
| `is.qty` | Qty | تعداد | new key (L-CLIENT-6b) |
| `is.save` | Save changes | تبدیلیاں محفوظ کریں | new key (L-CLIENT-6b) |
| `is.min` | {n} min | {n} منٹ | new key (L-CLIENT-6b) |
| `is.ready_now` | Ready now | ابھی تیار | new key (L-CLIENT-6b) |
| `is.ready_by` | Ready by {t} | {t} تک تیار | new key (L-CLIENT-6b) |
| `is.station_busy` | {station} station busy | {station} اسٹیشن مصروف | new key (L-CLIENT-6b) |
| `is.station_full` | {station} station full | {station} اسٹیشن بھرا ہوا | new key (L-CLIENT-6b) |
| `c.note_add` | Add note | نوٹ لکھیں | new key (L-CLIENT-6b) |
| `is.in_deal` | In this deal | اس ڈیل میں | new key (L-CLIENT-6b) |
| `is.part_pick` | {n}× — pick 1 | {n}× — ایک چنیں | new key (L-CLIENT-6b) |
| `deal.done` | Done | ہو گیا | existing key; had no Urdu |
| `deal.options` | Options | انتخاب | existing key; had no Urdu |
| `deal.part_n` | Part {n} | حصہ {n} | existing key; had no Urdu |
| `deal.options_missing` | Choose options for {part} | {part} کے انتخاب چنیں | existing key; had no Urdu |
| `c.add_delta` | Ready by {token}: | {token} کا تیار وقت: | new key (L-CLIENT-6b) |
| `c.counter` | From the counter | کاؤنٹر سے | new key (L-CLIENT-6b) |
| `v.late_chip` | Late | دیر | new key (L-CLIENT-6b) |
| `v.hurry` | Hurry kitchen | کچن کو جلدی | new key (L-CLIENT-6b) |
| `v.print_slip` | Print slip | پرچی پرنٹ کریں | new key (L-CLIENT-6b) |
| `tr.title` | Remove from token | ٹوکن سے ہٹائیں | new key (L-CLIENT-6b) |
| `tr.can_remove` | can be removed | ہٹایا جا سکتا ہے | new key (L-CLIENT-6b) |
| `tr.void_mgr` | Void needs a manager | void کیلئے مینیجر چاہیے | new key (L-CLIENT-6b) |
| `tr.void_ok` | can be voided | void ہو سکتا ہے | new key (L-CLIENT-6b) |
| `tr.void_chip` | Void · approval | Void · منظوری | new key (L-CLIENT-6b) |
| `tr.void` | Void | Void | new key (L-CLIENT-6b) |
| `tr.bill` | Bill goes from {from} to {to}. Not paid yet, so no refund. | بل {from} سے {to} ہو جائے گا۔ ابھی ادا نہیں ہوا، اس لیے کچھ واپس نہیں۔ | new key (L-CLIENT-6b) |
| `tr.go` | Remove {n} {item} | {n} {item} ہٹائیں | new key (L-CLIENT-6b) |
| `tr.go_n` | Remove {n} items | {n} آئٹم ہٹائیں | new key (L-CLIENT-6b) |
| `tr.keep` | Keep | رہنے دیں | new key (L-CLIENT-6b) |
| `p.card_hint` | The card is taken on the counter machine | کارڈ کاؤنٹر کی مشین پر لیا جاتا ہے | new key (L-CLIENT-6b) |
| `shell.manager.title` | Manager tools | مینیجر ٹولز | existing key; had no Urdu |
| `opt.add` | Add to order | آرڈر میں ڈالیں | existing key; was listed in 02b/urdu-todo.md |
| `opt.kitchen_note` | Kitchen note | کچن کیلئے نوٹ | existing key; was listed in 02b/urdu-todo.md |
| `opt.choose` | Choose {n} | {n} چنیں | existing key; was listed in 02b/urdu-todo.md |
| `opt.up_to` | Up to {n} | {n} تک | existing key; was listed in 02b/urdu-todo.md |
| `opt.choose_missing` | Choose {n} in {group} | {group} میں {n} چنیں | existing key; was listed in 02b/urdu-todo.md |
| `menu.not_available` | Not available | دستیاب نہیں | existing key; was listed in 02b/urdu-todo.md |
| `weight.after_weighing` | Price after weighing | قیمت تولنے کے بعد | existing key; was listed in 02b/urdu-todo.md |
| `weight.now` | Enter weight now | ابھی وزن لکھیں | existing key; was listed in 02b/urdu-todo.md |
| `weight.later` | Weigh later | بعد میں تولیں | existing key; was listed in 02b/urdu-todo.md |
| `weight.later_note` | Added with “Weight pending”. The cashier or a manager enters the weight before the bill. | “وزن باقی” کے ساتھ ڈال دیا۔ بل سے پہلے کیشیئر یا مینیجر وزن لکھے گا۔ | existing key; was listed in 02b/urdu-todo.md |
| `stage.sent_back` | Sent back | واپس بھیجا | existing key; was listed in 02b/urdu-todo.md |
| `order.toast.boosted` | Kitchen told to hurry | کچن کو جلدی کا کہہ دیا | existing key; was listed in 02b/urdu-todo.md |
| `stage.badge.removed` | Removed | ہٹا دیا | existing key; was listed in 02b/urdu-todo.md |
| `send.sending` | Sending to the kitchen… | کچن کو بھیج رہے ہیں… | existing key; was listed in 02b/urdu-todo.md |
| `billing.bill.load_failed` | Couldn't load the bill. | بل لوڈ نہیں ہوا۔ | existing key; was listed in 05/urdu-todo.md |
| `billing.closed_empty` | Closed · nothing billed · money given back | بند · کچھ بل نہیں · پیسے واپس | existing key; was listed in 05/urdu-todo.md |
| `billing.no_printer` | No bill printer is set up — show the screen to the customer | بل کا پرنٹر نہیں لگا — گاہک کو اسکرین دکھائیں | existing key; was listed in 05/urdu-todo.md |
| `billing.total_changed` | The total changed to {amount} — check it and close again | کل رقم {amount} ہو گئی — دیکھ کر دوبارہ بند کریں | existing key; was listed in 05/urdu-todo.md |
| `pad.maybe_in` | This payment may already be in — check the payments before taking it again | یہ ادائیگی شاید پہلے ہی ہو چکی ہے — دوبارہ لینے سے پہلے ادائیگیاں دیکھیں | existing key; was listed in 05/urdu-todo.md |
| `tables.toast.needs_hub` | Needs the hub | ہب چاہیے | existing key; was listed in 02a/urdu-todo.md |
| `billing.check_sent` | Check bill sent to {printer} | چیک بل {printer} پر بھیج دیا | existing key; was listed in 05/urdu-todo.md |
| `billing.print.reprint_sent` | Reprint sent to {printer} | دوبارہ پرنٹ {printer} پر بھیج دیا | existing key; was listed in 05/urdu-todo.md |
| `errors.INVOICE_NOT_FOUND` | This invoice can't be found | یہ انوائس نہیں ملی | existing key; was listed in 05/urdu-todo.md |
| `contact.title` | Customer contact | گاہک کا رابطہ | existing key; was listed in 02b/urdu-todo.md |
| `contact.logged` | this look is logged | یہ دیکھنا درج ہوتا ہے | existing key; was listed in 02b/urdu-todo.md |
| `request.find_approver` | Waiting — find a manager | انتظار — مینیجر کو ڈھونڈیں | existing key; was listed in 01d/urdu-todo.md |
| `order.takeaway` | Takeaway | ٹیک اوے | existing key; was listed in 02b/urdu-todo.md |
| `order.parking` | Parking | پارکنگ | existing key; was listed in 02b/urdu-todo.md |
| `tables.changed` | This table changed — refreshed | یہ میز بدل گئی — تازہ کر دیا | existing key; was listed in 02a/urdu-todo.md |
| `alerts.screen.dine_in` | Dine in | میزیں | existing key; was listed in 01d/urdu-todo.md |
| `alerts.screen.takeaway` | Takeaway | ٹیک اوے | existing key; was listed in 01d/urdu-todo.md |
| `alerts.screen.parking` | Parking | پارکنگ | existing key; was listed in 01d/urdu-todo.md |
| `alerts.screen.cashier` | Cash desk | کیش ڈیسک | existing key; was listed in 01d/urdu-todo.md |
| `alerts.screen.pass` | Pass | پاس | existing key; was listed in 01d/urdu-todo.md |
| `alerts.screen.manager` | Manager tools | مینیجر ٹولز | existing key; was listed in 01d/urdu-todo.md |
| `alerts.device.tablet` | Tablet | ٹیبلٹ | existing key; was listed in 01d/urdu-todo.md |
| `alerts.device.cashier_kiosk` | Cashier kiosk | کیشیئر کیوسک | existing key; was listed in 01d/urdu-todo.md |
| `alerts.device.phone` | Phone | فون | existing key; was listed in 01d/urdu-todo.md |
| `alerts.live` | Live | لائیو | existing key; was listed in 01d/urdu-todo.md |
| `alerts.hub_offline` | Hub offline | ہب بند ہے | existing key; was listed in 01d/urdu-todo.md |
| `alerts.more_new` | {n} more new | {n} اور نئے | existing key; was listed in 01d/urdu-todo.md |
| `alerts.open_inbox` | Open inbox | اِن باکس کھولیں | existing key; was listed in 01d/urdu-todo.md |
| `alerts.signin.who` | Who is signing in? | کون سائن اِن کر رہا ہے؟ | existing key; was listed in 01d/urdu-todo.md |
| `alerts.signin.pick` | Tap your name, then your PIN. | اپنا نام دبائیں، پھر اپنا PIN۔ | existing key; was listed in 01d/urdu-todo.md |
| `alerts.signin.submit` | Sign in | سائن اِن | existing key; was listed in 01d/urdu-todo.md |
| `alerts.signin.pin_for` | {name}, enter your PIN | {name}، اپنا PIN لکھیں | existing key; was listed in 01d/urdu-todo.md |
| `alerts.signin.none` | Nobody can sign in here yet. | ابھی یہاں کوئی سائن اِن نہیں کر سکتا۔ | existing key; was listed in 01d/urdu-todo.md |
| `alerts.signin.retry` | Retry now | ابھی دوبارہ کوشش کریں | existing key; was listed in 01d/urdu-todo.md |
| `alerts.signin.offline` | No connection to the hub — retrying… | ہب سے رابطہ نہیں — دوبارہ کوشش ہو رہی ہے… | existing key; was listed in 01d/urdu-todo.md |
| `alerts.signin.active` | {name} is signed in on this device. Enter your PIN again to take over. | {name} اس ڈیوائس پر سائن اِن ہے۔ لینے کیلئے اپنا PIN دوبارہ لکھیں۔ | existing key; was listed in 01d/urdu-todo.md |
| `alerts.sign_out_short` | Sign out | سائن آؤٹ | existing key; was listed in 01d/urdu-todo.md |
| `answer.back` | Back | واپس | existing key; was listed in 01d/urdu-todo.md |
| `answer.pin_not_kept` | Your PIN is not kept. | آپ کا PIN محفوظ نہیں رکھا جاتا۔ | existing key; was listed in 01d/urdu-todo.md |
| `answer.error.offline` | No connection to the hub — try again. | ہب سے رابطہ نہیں — دوبارہ کوشش کریں۔ | existing key; was listed in 01d/urdu-todo.md |
| `answer.error.failed` | Something went wrong. Try again. | کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔ | existing key; was listed in 01d/urdu-todo.md |
| `answer.error.busy` | Busy — try again. | مصروف — دوبارہ کوشش کریں۔ | existing key; was listed in 01d/urdu-todo.md |
| `staff.locked` | Locked | لاک | existing key; was listed in 01a/urdu-todo.md |
| `send.token` | Token | ٹوکن | existing key; was listed in 02b/urdu-todo.md |
| `send.sent` | Sent | بھیج دیا | existing key; was listed in 02b/urdu-todo.md |
| `send.done` | Done | ہو گیا | existing key; was listed in 02b/urdu-todo.md |
| `send.new_takeaway` | New takeaway | نیا ٹیک اوے | existing key; was listed in 02b/urdu-todo.md |
| `send.not_yet` | Not sent yet | ابھی نہیں گیا | existing key; was listed in 02b/urdu-todo.md |
| `send.time_updated` | Time updated: {item} {time} | وقت بدل گیا: {item} {time} | existing key; was listed in 02b/urdu-todo.md |
| `cart.empty` | Tap items to add them | آئٹم ڈالنے کیلئے دبائیں | existing key; was listed in 02b/urdu-todo.md |
| `cart.items` | {n} items | {n} آئٹم | existing key; was listed in 02b/urdu-todo.md |
| `cart.fix_first` | Fix {n} item first | پہلے {n} آئٹم ٹھیک کریں | existing key; was listed in 02b/urdu-todo.md |
| `cart.cant_send` | {n} item can't be sent — fix it first | {n} آئٹم نہیں جا سکتا — پہلے ٹھیک کریں | existing key; was listed in 02b/urdu-todo.md |
| `cart.times_later` | Times will be set when sent | بھیجنے پر وقت طے ہوگا | existing key; was listed in 02b/urdu-todo.md |
| `cart.prob.only_left` | Only {n} left | صرف {n} باقی | existing key; was listed in 02b/urdu-todo.md |
| `cart.prob.station_paused` | Kitchen station paused | کچن اسٹیشن رکا ہوا ہے | existing key; was listed in 02b/urdu-todo.md |
| `cart.prob.set_to` | Set to {n} | {n} کر دیں | existing key; was listed in 02b/urdu-todo.md |
| `day.not_started` | The day hasn't started | دن شروع نہیں ہوا | existing key; was listed in 02b/urdu-todo.md |
| `day.start` | Start day | دن شروع کریں | existing key; was listed in 02b/urdu-todo.md |
| `day.ask_manager` | Ask the manager to start the day. Your order is kept. | مینیجر سے دن شروع کروائیں۔ آپ کا آرڈر محفوظ ہے۔ | existing key; was listed in 02b/urdu-todo.md |
| `menu.here` | {n} here | {n} یہاں | existing key; was listed in 02b/urdu-todo.md |
| `draft.back` | Your unsent order is back | آپ کا نہ بھیجا آرڈر واپس آ گیا | existing key; was listed in 02b/urdu-todo.md |
| `draft.kept_since` | Kept on this screen since {time} | {time} سے اس اسکرین پر رکھا ہے | existing key; was listed in 02b/urdu-todo.md |
| `held.title` | Held on this screen | اس اسکرین پر ہولڈ | existing key; was listed in 02b/urdu-todo.md |
| `held.resume` | Resume | جاری رکھیں | existing key; was listed in 02b/urdu-todo.md |
| `held.discard` | Discard | ختم کریں | existing key; was listed in 02b/urdu-todo.md |
| `queue.in_log` | Not sent — see the queue log | نہیں گیا — قطار کا لاگ دیکھیں | existing key; was listed in 02b/urdu-todo.md |
| `queue.title` | Not sent | نہیں گیا | existing key; was listed in 02b/urdu-todo.md |
| `tr.pick` | Choose what to remove | جو ہٹانا ہے وہ چنیں | new key (L-CLIENT-6b) |

<!-- end L-CLIENT-6b -->
