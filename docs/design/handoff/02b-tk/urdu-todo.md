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
| `v.pay_first` | Take payment first — a manager can hand over unpaid | پہلے پیسے لیں — مینیجر بغیر ادائیگی حوالے کر سکتا ہے |
| `v.override` | Hand over unpaid · manager | بغیر ادائیگی حوالے کریں · مینیجر |
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
