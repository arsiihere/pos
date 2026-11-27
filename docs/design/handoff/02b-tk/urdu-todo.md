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

Historical copy for Urdu review. OR-7 disabled the client override.

| Key | English | Urdu |
| --- | --- | --- |
| `v.override` | Hand over unpaid · manager | بغیر ادائیگی حوالے کریں · مینیجر |
