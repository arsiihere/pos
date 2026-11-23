# Module 02b-TK · Takeaway — design decisions

The takeaway experience for the cashier kiosk, as the pilot will run it (owner ruling 2026-11-24: **all 16 proposed features are in the pilot**). It's drawn on spec 02b v1.0.24, 03a v1.2.10, 05 v1.0.34, 05a v1.0.5, 01d v1.3.6 and 03b v1.0.15. Sample data: Arif Chatkhara Lake City, lunch at 1:20 PM. Sana is on the kiosk, Usman is the walk-in (token 57), Saima is a phone order for 2:00 PM.

## 0. Owner answers used (Phase 2)

| Question | Answer | Where it shows |
|---|---|---|
| When does the takeaway customer pay? | **Mixed — the cashier decides** | Two send buttons (Send & pay = primary, Send · pay later), a **Paid / Due** chip on every token, pay from any token or ready tile, and the queue keeps paid orders until they're handed over (GAPS G-1) |
| Who hands over the bag? | **Sometimes cashier + packer, sometimes the kitchen pass** | One "handed over" state whoever taps it: the ready tile (cashier), the Pass card (packer, PackerPass), or Pass Handover. Unpaid can't be handed over (G-7) |
| How are customers called? TV at the pilot? | **Token shouted; a TV is possible** | Pickup board (Board*), with a voice call-out in Urdu (G-9) |
| Phone-ahead orders? | **Common, taken at the kiosk** | Pickup time chips, name and phone required when the pickup is later, Repeat by phone (PickupLater, PhoneRepeat) |

## 1. Information architecture

- **The Takeaway tab *is* the order screen.** No home list and no "New order" button. The cart is always ready for the next customer. The cashier only ever leaves it to pay, and the pay panel opens *over the cart*, not on another tab.
- **Three columns on the kiosk:** queue rail 440 px | menu | cart 560 px (mirrored in Urdu).
  - The **queue rail** has search (token / name / last 4 phone digits), then **Ready — hand over** (big tiles), **Cooking** (rows by time), **Phone orders — later**, and at the foot **Held (n)** and **All orders**.
  - **Always visible:** the token queue, the cart total, **Ready by**, Live / Offline, the clock.
- **One primary action per layer:** cart → *Send & pay*; pay panel → *Paid · print receipt*; token view → the next thing that token needs (pay, or hand over, or nothing until ready); dialogs → the safe choice (Hold it).
- **Tablet 1280×800:** the rail becomes a **ready strip** above the menu plus a queue drawer. Menu has 3 columns, cart 440.
- **Phone 390×844:** tabs Menu / Cart / Queue, sticky bar with the total, Ready by and Pay.

## 2. Rules applied everywhere

| Rule | How |
|---|---|
| One selected style | `.is-sel`: accent edge + accent tint for cards and tiles; the tab and segmented chip are filled with a saffron underline. Nothing else signals selection |
| One empty style | `.tk-empty` (grey ring icon, bold line, one sentence) |
| One badge style | `.tk-chip` with tone modifiers. Counts on icons are `.tk-count` only |
| Text ≥ 14 px | Smallest staff text 14 px (hints, sub-lines). Body 16–18 px. Tokens 24–150 px |
| Touch 56–72 px | Buttons 56 / 64 / 72; steppers 48–56; tiles ≥ 112 |
| Numbers LTR | Tokens, money, times, phones, plates in `dir="ltr"` / `.num` spans with `unicode-bidi: isolate`. "Rs 1,190" never wraps (`white-space: nowrap`, non-breaking space) |
| Plain cashier words | No "fire", "round", "as the menu says", "Together / As ready". Instead: "Ready by", "Paye is ready now. Give it now?", "Hand over", "Take payment", "Hold it" |
| State never by colour alone | Icon + word + colour (Paid ✓, Due, Waiting 17 min · Call) |

## 3. Per screen

| Screen | Decision |
|---|---|
| **Shell — proposed** (TK-SH01–03) | Top bar: Back (only off home), **context slot** (icon + "New takeaway · Usman" / "Token 57 · Usman" + one sub-line), screen tabs from the device profile with a clear selected state, Live / Hub offline / **Rush mode · 40** pill, clock, Requests and Inbox badges, a person chip that opens a **menu** (Switch user, Lock, My shift, Sign out). It never signs out on one tap. Day and shift banners sit under the bar **before** the first item |
| **Cart** | Customer row inline (name, +92 phone mask with a numeric pad, pickup Now / +15 / +30 / +45 / Time…). In rush mode it collapses to one "Name / phone" button. Lines are grouped *From the counter · Now* and *From the kitchen · 1:42 PM*, each line with a stepper, price and time. The note shows in saffron with "Edit note". **Ready by** is big and green, with a reason line when one item moves it ("2nd karahi adds 18 min — the karahi station is full") |
| **Menu** | 4 columns (rush: 4 dense without photos, the 12 most ordered this hour pinned). Every tile shows its wait ("Now" in green, "22 min" in amber at ≥ 20). Karahi has **Half / Full on the tile** (one tap). Off tiles show a reason chip, the price is **never struck through**, and a tap gives a toast with the reason. Keyboard: `/` focuses search, `4n` Enter adds 4 naan, F8 Send & pay, F9 Send · pay later, F4 Hold, Esc back |
| **Item sheet** | Size as big buttons, add-ons with **quantity steppers** (karahi + 4 naan works), "Half karahi usually: 4 naan" hint, cooking choices as buttons, kitchen note, quantity. When editing, the CTA reads **Save changes** and there is a Remove button |
| **Send** | No dialog. The cart clears at once, a toast shows the token ("57 · Usman · sent · ready 1:42 PM · Print again") and the token goes to the top of Cooking. Offline: "Not sent yet — token comes when the hub is back", with a dashed row |
| **Pay** | Panel over the cart. Cash: Exact / next notes / keypad, **change huge**, Short in red. Card: reference on the kiosk, NFC on a tablet. Raast: dynamic QR, also on the customer display, closes on its own. Paid → receipt prints → Enter = next customer |
| **Token view** | Drawer over menu + cart (the cart is kept), on the phone a full screen. Token big, Ready by / Bill / Phone facts, each item with a stage chip (Waiting / Cooking / Ready / Handed over). Actions: Give ready items now, Take payment or Hand over all, Add items (same token), Remove / cancel, Print token, Call, Hurry kitchen |
| **Ready tile** | Paid → "Hand over" (1 tap, 5 s Undo). Due → only "Take payment". 15+ min → amber with Call. Partial → dashed |
| **Leave guard** | Any exit with an unsent cart: **Hold it** (primary) / Throw away / Stay here. Sign out and idle lock hold automatically |
| **Held** | Per counter (everyone on this device), with who held it and when (GAPS G-6) |
| **Board (TV)** | Ready (green, 104 px tokens, first name or "Pay at counter") / Preparing (with ~time; phone orders by first name and pickup time). The call-out banner, chime and Urdu voice play once per newly ready token. Offline keeps the last list with "Updating…" |
| **Packer / Pass** | Takeaway filter, "Pack next" by time, **Bag ready** = `MarkReadyToServe`. A due order shows a red "Due — customer pays at counter" and can't be handed over |
| **Customer status page** | From the slip QR on restaurant Wi-Fi: token, "Ready around 1:42 PM", steps, items. Turns green and beeps when ready |
| **Token slip** | Token at 150 px, Urdu line, ~ready time per kind (paye now, karahi ~1:42), QR. Merged with the receipt when paid at Send |
| **Customer display** | A second monitor mirrors the cart, total and Ready by. During Raast it shows a 420 px QR |

## 4. Hostile review (frame `HostileReview`)

I ran it as a tired cashier at 1:30 PM with 15 in the queue: six ways an order or money could be lost or misread, each fixed in the frames.

1. Unpaid bag handed over → a Due tile has only "Take payment"; hub guard G-7.
2. Wrong send button → one primary; Pay later plain and narrower; Due stays red.
3. Packer hands over unpaid → Due on the Pass card, Handed over off.
4. Offline cash not recorded → offline the primary is Send only; the order stays Due.
5. Wrong token handed over → the toast repeats the token at 28 px with a 5 s Undo.
6. Quantity slip / lost cart → four quantity chips (×2–×8), leave guard on every exit, auto-hold on sign out.

Other misreads checked: the total and change never wrap ("Rs 3,650"); the token is never shown in the same colour as money; Due is always red text plus the word; Urdu frames keep numbers LTR.

## 5. New string keys (en + ur)

All new keys are under `shell.*`, `ctx.*`, `q.*`, `m.*`, `c.*`, `t.*`, `p.*`, `v.*`, `l.*`, `h.*`, `b.*` (list below, 165 keys). Numbers are never inside a string: they come in as `{n}` / `{t}` / `{money}` and render LTR. Urdu I'm unsure of → `urdu-todo.md`.

| Key | English | Urdu |
|---|---|---|
| `shell.back` | Back | واپس |
| `shell.tab.takeaway` | Takeaway | ٹیک اوے |
| `shell.tab.parking` | Parking | پارکنگ |
| `shell.tab.dine_in` | Tables | میزیں |
| `shell.tab.cashier` | Bills | بل |
| `shell.live` | Live | لائیو |
| `shell.offline` | Hub offline | ہب بند ہے |
| `shell.rush` | Rush mode | رش موڈ |
| `shell.requests` | Requests | درخواستیں |
| `shell.inbox` | Inbox | اِن باکس |
| `shell.me.switch` | Switch user | یوزر بدلیں |
| `shell.me.switch_sub` | Hand the counter to someone else | کاؤنٹر کسی اور کو دیں |
| `shell.me.lock` | Lock screen | اسکرین لاک کریں |
| `shell.me.lock_sub` | Your orders stay as they are | آپ کے آرڈر ویسے ہی رہیں گے |
| `shell.me.shift` | My shift | میری شفٹ |
| `shell.me.signout` | Sign out | سائن آؤٹ |
| `shell.me.signout_sub` | Unsent orders are held first | نہ بھیجے آرڈر پہلے ہولڈ ہوں گے |
| `shell.day.closed` | Day not started — orders can’t be sent and times can’t show | دن شروع نہیں ہوا — آرڈر نہیں جا سکتے، وقت نہیں دکھ سکتا |
| `shell.day.start` | Start day | دن شروع کریں |
| `shell.day.ask` | Ask the manager to start the day | مینیجر سے دن شروع کروائیں |
| `shell.shift.closed` | No shift open — cash can’t be taken | شفٹ نہیں کھلی — کیش نہیں لے سکتے |
| `shell.shift.open` | Open my shift | میری شفٹ کھولیں |
| `ctx.new` | New takeaway | نیا ٹیک اوے |
| `ctx.token_after` | Token after Send | ٹوکن بھیجنے کے بعد |
| `ctx.adding` | Adding to token | ٹوکن میں اضافہ |
| `ctx.phone_order` | Phone order | فون آرڈر |
| `q.search` | Token, name or phone | ٹوکن، نام یا فون |
| `q.ready` | Ready — hand over | تیار — حوالے کریں |
| `q.cooking` | Cooking | بن رہا ہے |
| `q.later` | Phone orders — later | فون آرڈر — بعد میں |
| `q.waiting_send` | Waiting to send | بھیجنے کا انتظار |
| `q.collect` | Hand over | حوالے کریں |
| `q.collect_pay` | Take payment | پیسے لیں |
| `q.waiting_min` | {n} min · Call | {n} منٹ · فون |
| `q.part` | Part given · rest | کچھ دیا · باقی |
| `q.paid` | Paid | ادا |
| `q.due` | Due | باقی |
| `q.held` | Held | ہولڈ |
| `q.more` | +{n} more | +{n} اور |
| `c.who_add` | Name / phone | نام / فون |
| `q.all` | All orders | سب آرڈر |
| `q.empty_t` | No takeaway orders yet | ابھی کوئی ٹیک اوے آرڈر نہیں |
| `q.empty_p` | Orders you send show here until the customer collects them. | بھیجے گئے آرڈر یہاں رہیں گے جب تک گاہک لے نہ جائے۔ |
| `q.failed` | Couldn’t load orders | آرڈر لوڈ نہیں ہوئے |
| `q.retry` | Try again | دوبارہ کوشش |
| `q.as_of` | Last updated | آخری اپ ڈیٹ |
| `q.ready_at` | ready | تیار |
| `q.pickup` | pickup | لینے آئیں گے |
| `m.search` | Type item — e.g. 4 naan | آئٹم لکھیں — مثلاً 4 نان |
| `m.all` | Top now | ابھی سب سے زیادہ |
| `m.now` | Now | ابھی |
| `m.min` | {n} min | {n} منٹ |
| `m.sold_out` | Sold out | ختم |
| `m.not_now` | From 7 PM | شام 7 بجے سے |
| `m.paused` | Tandoor paused | تندور رکا ہوا |
| `m.left` | {n} left | {n} باقی |
| `m.here` | {n} ready | {n} تیار |
| `m.half` | Half | آدھی |
| `m.full` | Full | پوری |
| `m.kg` | By kg | کلو |
| `m.pinned` | Most ordered this hour | اس گھنٹے سب سے زیادہ |
| `m.keys` | Keys | کیز |
| `c.name` | Name | نام |
| `c.phone` | Phone | فون |
| `c.optional` | optional | اختیاری |
| `c.required` | needed for later pickup | بعد میں لینے کیلئے ضروری |
| `c.name_ph` | Customer name | گاہک کا نام |
| `c.pickup` | Pickup | کب لیں گے |
| `c.pick_now` | Now | ابھی |
| `c.pick_15` | +15 min | 15 منٹ بعد |
| `c.pick_30` | +30 min | 30 منٹ بعد |
| `c.pick_45` | +45 min | 45 منٹ بعد |
| `c.pick_time` | Time… | وقت… |
| `c.match` | Usman · 6 orders | عثمان · 6 آرڈر |
| `c.match_last` | Last: Half karahi, 4 roghni naan, 2 lassi · 12 Nov | پچھلا: آدھی کڑاہی، 4 روغنی نان، 2 لسی · 12 نومبر |
| `c.repeat` | Repeat | دوبارہ |
| `c.phone_err` | Enter 10 digits after +92 | +92 کے بعد 10 ہندسے لکھیں |
| `c.empty_t` | Tap an item or type it | آئٹم دبائیں یا لکھیں |
| `c.ask_time` | Kitna time? Right now: | کتنا وقت؟ ابھی: |
| `c.items` | {n} items | {n} آئٹم |
| `c.ready_by` | Ready by | تیار ہوگا |
| `c.ready_now` | Everything ready now | سب کچھ ابھی تیار |
| `c.ready_by_sub` | Tell the customer | گاہک کو بتائیں |
| `c.ready_later` | Kitchen times it for | کچن اس وقت کیلئے بنائے گا |
| `c.times_none` | Times show when the hub is back | ہب واپس آنے پر وقت دکھے گا |
| `c.times_day` | Times show after Start day | دن شروع ہونے پر وقت دکھے گا |
| `c.delta` | 2nd karahi adds {n} min — the karahi station is full | دوسری کڑاہی سے {n} منٹ بڑھ گئے — کڑاہی اسٹیشن بھرا ہے |
| `c.add_n` | +{n} {item} | +{n} {item} |
| `c.note_add` | Add note | نوٹ لکھیں |
| `c.note_edit` | Edit note | نوٹ بدلیں |
| `c.total` | Total | کل |
| `c.hold` | Hold | ہولڈ |
| `c.send_later` | Send · pay later | بھیجیں · پیسے بعد میں |
| `c.send_pay` | Send & pay | بھیجیں اور پیسے لیں |
| `c.schedule` | Schedule for | اس وقت کیلئے بھیجیں |
| `c.add_to` | Add to token | ٹوکن میں ڈالیں |
| `c.fix_first` | Fix 1 item first | پہلے 1 آئٹم ٹھیک کریں |
| `c.serve_q` | Paye is ready now. Give it now? | پائے ابھی تیار ہیں۔ ابھی دے دیں؟ |
| `c.serve_together` | All together {t} | سب ایک ساتھ {t} |
| `c.serve_now` | Paye now, rest {t} | پائے ابھی، باقی {t} |
| `c.counter` | From the counter | کاؤنٹر سے |
| `c.kitchen` | From the kitchen | کچن سے |
| `c.queued_pay` | Payment needs the hub. Send now; take payment when Live. | پیسوں کیلئے ہب چاہیے۔ ابھی بھیجیں، لائیو ہونے پر پیسے لیں۔ |
| `t.sent` | sent · ready | بھیج دیا · تیار |
| `t.print` | Print again | دوبارہ پرنٹ |
| `t.open` | Open | کھولیں |
| `t.queued` | Not sent yet — token comes when the hub is back | ابھی نہیں گیا — ہب واپس آنے پر ٹوکن ملے گا |
| `t.collected` | handed over | حوالے کر دیا |
| `t.undo` | Undo | واپس کریں |
| `t.sold_out` | Chicken Tikka is sold out — ask the kitchen | چکن تکہ ختم ہے — کچن سے پوچھیں |
| `p.title` | Take payment | پیسے لیں |
| `p.due` | To pay | ادا کرنا ہے |
| `p.cash` | Cash | کیش |
| `p.card` | Card | کارڈ |
| `p.raast` | Raast QR | راست QR |
| `p.given` | Customer gave | گاہک نے دیے |
| `p.exact` | Exact | پورے |
| `p.change` | Give change | بقایا دیں |
| `p.short` | Short by | کم ہیں |
| `p.done` | Paid · print receipt | ادا · رسید پرنٹ |
| `p.later` | Pay later | بعد میں |
| `p.nfc` | Tap the card on the back of this tablet | کارڈ ٹیبلٹ کی پشت پر لگائیں |
| `p.nfc_sub` | Waiting for card… Rs amount shows on the customer screen | کارڈ کا انتظار… |
| `p.machine` | Card machine approved? | کارڈ مشین سے منظور؟ |
| `p.ref` | Last 4 digits / slip no. | آخری 4 ہندسے / سلپ نمبر |
| `p.qr_t` | Customer scans with any bank app | گاہک کسی بھی بینک ایپ سے اسکین کرے |
| `p.qr_wait` | Waiting for payment… closes by itself when paid | ادائیگی کا انتظار… ادا ہوتے ہی خود بند ہوگا |
| `p.paid_t` | Paid | ادا ہو گیا |
| `p.change_big` | Give change | بقایا دیں |
| `p.receipt` | Receipt is printing | رسید پرنٹ ہو رہی ہے |
| `p.next` | Next customer | اگلا گاہک |
| `p.err` | Payment didn’t go through | ادائیگی نہیں ہوئی |
| `p.err_sub` | Nothing was charged. Try again or choose another way. | کچھ نہیں کٹا۔ دوبارہ کوشش کریں یا دوسرا طریقہ چنیں۔ |
| `p.offline` | Hub offline — payment can’t be recorded now | ہب بند — ابھی ادائیگی درج نہیں ہو سکتی |
| `v.placed` | Placed {t} by {who} | {t} پر {who} نے لیا |
| `v.status` | Status | حالت |
| `v.ready_at` | Ready by | تیار ہوگا |
| `v.bill` | Bill | بل |
| `v.waiting` | Waiting | انتظار |
| `v.cooking` | Cooking | بن رہا ہے |
| `v.ready` | Ready | تیار |
| `v.given` | Handed over | دے دیا |
| `v.collected` | Hand over all | سب حوالے کریں |
| `v.give_ready` | Give ready items now | تیار چیزیں ابھی دیں |
| `v.pay` | Take payment | پیسے لیں |
| `v.add` | Add items | مزید ڈالیں |
| `v.remove` | Remove / cancel | ہٹائیں / منسوخ |
| `v.call` | Call | فون |
| `v.print` | Print token | ٹوکن پرنٹ |
| `v.hurry` | Hurry kitchen | کچن کو جلدی |
| `v.note` | Note | نوٹ |
| `v.late` | Ready 17 min ago — not collected | 17 منٹ سے تیار — کوئی نہیں آیا |
| `l.title` | This order isn’t sent | یہ آرڈر نہیں گیا |
| `l.body` | {n} items · {money}. What should happen to it? | {n} آئٹم · {money}۔ اس کا کیا کریں؟ |
| `l.hold` | Hold it | ہولڈ کریں |
| `l.discard` | Throw away | ختم کریں |
| `l.stay` | Stay here | یہیں رہیں |
| `h.title` | Held on this counter | اس کاؤنٹر پر ہولڈ |
| `h.resume` | Resume | جاری رکھیں |
| `h.discard` | Throw away | ختم کریں |
| `b.ready` | Ready | تیار ہے |
| `b.prep` | Preparing | بن رہا ہے |
| `b.come` | please come to the counter | کاؤنٹر پر تشریف لائیں |
| `b.foot` | Find your token number on your slip | اپنا ٹوکن نمبر پرچی پر دیکھیں |
| `b.scan` | Scan the slip QR to follow your order | پرچی کا QR اسکین کریں |

## 6. Open items (owner)

| # | Question | Default in the frames |
|---|---|---|
| Q1 | Customer **names on the TV board**? | First name only. Unpaid shows "Pay at counter" instead of a name |
| Q2 | Unpaid hand-over: hard block, or a manager override? | Blocked, override with a new `hand-over-unpaid` permission (G-7) |
| Q3 | Paper: print a **token slip for every order**, or only for pay-later and on request? (Rs 50k / month paper) | Slip printed on Send; merged with the receipt when paid at Send (one paper) |
| Q4 | Board voice: Urdu only, or Urdu then English? | Urdu then English, chime first |
| Q5 | "Not collected" after how long? | 15 min (`takeaway_uncollected_ms`) |
| Q6 | Rush mode switches on at how many open takeaway orders? | 15 (`rush_open_orders`); also a manual toggle on the pill |
| Q7 | Phone-ahead latest time and slot size | +15 / +30 / +45 / any time up to day end, 5-minute steps |
