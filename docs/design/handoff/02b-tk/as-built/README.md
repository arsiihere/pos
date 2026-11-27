# 02b-TK Item 6 customer display

[Frame comparison](CustomerDisplay.png) places the hand-off on the left and the built display on the right. Both were rendered at 1920 × 1080. The frame ends at its content height. The live display fills the monitor.

- [Idle](CustomerDisplay-idle.png)
- [Cart](CustomerDisplay-cart.png)
- [Paid](CustomerDisplay-paid.png)

The captures use the frame’s five menu lines and prices through the display’s BroadcastChannel. The kiosk end-to-end tests exercise the live cart and bill close separately. The badge uses the branch initial from the staff page. Welcome and Paid retain the badge and bilingual footer as requested.

The current branch-config menu supplies one name per item or deal. Existing bilingual menu labels are displayed as configured, with Urdu set RTL. An English-only menu label remains English. The footer uses the frame copy.

## Item 7 tablet and phone

Each image shows the hand-off frame on the left and the running client on the right. Tablet captures use 1280 × 800. Phone captures use 390 × 844.

| Screen | English | Urdu |
| --- | --- | --- |
| Tablet home | [HomeTablet](HomeTablet.png) | [HomeTabletUrdu](HomeTabletUrdu.png) |
| Tablet queue | [QueueTablet](QueueTablet.png) | |
| Phone menu | [PhoneMenu](PhoneMenu.png) | |
| Phone cart | [PhoneCart](PhoneCart.png) | [PhoneCartUrdu](PhoneCartUrdu.png) |
| Phone queue | [PhoneQueue](PhoneQueue.png) | |
| Phone token | [PhoneToken](PhoneToken.png) | |
| Phone offline | [PhoneOffline](PhoneOffline.png) | |

- Menu items, stock, token numbers, and estimates come from the real test hub. The fixture uses menu monograms in place of the frame’s food artwork. The existing staff navigation remains available.
- Tablet and phone queue search for staff without contact access matches token numbers only. Such staff see no customer name or phone on the selected token. The phone fixture is signed in as Ali, who can send and hand over and has no payment grant. The kiosk checks that the Due token can be paid before Ali hands it over.
- The frames include scheduled pickup and token-slip controls. The pilot rulings defer those controls. The phone’s optional telephone field keeps the existing typed value and +92 example.
- The token screen retains the existing bill details and permitted order actions. A Due token shows Take payment first. Hand over all becomes available only when all live lines are ready and the bill is paid.

## L-CLIENT-1 item 1 Pass pickup card and "Handed to customer"

Each image shows the hand-off frame on the left (PackerPass, 1280 × 800) and the running Pass card on the right (landscape tablet, captured from `apps/client/e2e/02b-tk-pass.spec.ts` at device scale 2 with a taller landscape viewport so the whole card shows).

| State | English | Urdu |
| --- | --- | --- |
| Pickup card, Pass role, bill not known | [PackerPass-pickup](PackerPass-pickup.png) | [PackerPass-pickup-Urdu](PackerPass-pickup-Urdu.png) |

- The card shows "Pickup {time}" (hub clock, 12-hour) above "placed {time}"; a pickup card's station-less lines show under "From the counter" (unit tests; the e2e order has none).
- "Handed to customer" shows only on takeaway / parking cards for a person holding `run-pass` and `mark-served` (the e2e Pass person Pervez); Cook has no button. Today's hub sends no `bill` on `open-orders`, so the button stays greyed with "Waiting for the bill". It enables by itself for a Paid row, and a Due row shows "Due — customer pays at counter" with "Take payment first" (unit tests).
- The frame's Due chip sits under the token; the build puts it in the card's message band (red), the same place as the other card messages. The 5 s "{identifier} handed to customer · Undo" toast (frame HandoverUndo) reuses the takeaway screen's `tk-toast`; no e2e capture, because no e2e order can be Paid until the hub sends `bill`.
- The "Ask a manager" request for a Due card (OR-7) is not built: its backend has not shipped.

## L-CLIENT-1 item 2 "Not collected" amber and the counter Ready

Each image shows the hand-off frame on the left and the running client on the right, captured from `apps/client/e2e/02b-tk-pass.spec.ts` at device scale 2.

| State | Frame | English | Urdu |
| --- | --- | --- | --- |
| Pass card past the R8 window (landscape tablet) | ReadyTiles (the late tile) | [PassNotCollected](PassNotCollected.png) | [PassNotCollected-Urdu](PassNotCollected-Urdu.png) |
| Counter Ready at the kiosk (1920 × 1080) | TokenLate | [CounterReady](CounterReady.png) | [CounterReady-Urdu](CounterReady-Urdu.png) |

- Every Pass card of a takeaway / parking order shows "Ready {n} min ago — not collected" (amber message) once hub now ≥ `bag_ready_since` + `bag_ready_window_ms`; the pair comes from the catch-up, `point_lines.orders` and `PassBagReadyChanged`, and clears when the bag is incomplete again or collected. The e2e fast-forwards the page's clock past the hub's 60 s window. The card carries `pc--late`, which ui-kit does not style yet, so only the message is amber (the frames' amber card border needs a ui-kit rule).
- On a counter device (profile screens include takeaway / parking) the order-level `ready_to_serve` card reads "Bag ready — hand over at the counter" with the token chip and the ready lines; from 1× the window it is amber with "Ready {n} min ago — not collected", and at the 2× escalation "Not collected for {n} min — managers told" (unit tests; the e2e hub's clock is fixed, so only step 0 is captured). Other devices keep the Pass wording.
- The counter's ready tile amber clock (frames ReadyTiles, TokenLate) is not built: it needs `open-orders` `ready_at` (02b B2-1).

## L-CLIENT-2 item 1 D7: the Pass after a point archive, "Moved from", and the refused archive on config status

Captured from `apps/client/e2e/02b-tk-d7.spec.ts` (landscape tablet, device scale 2; the spec also runs at the kiosk viewport). The e2e hub applies a real config through its poller and stub cloud (`03b-fixture.ts` `startConfigDriver`): the run's own Pass point is archived and a second, receiving point becomes its station's default. The 02b-TK hand-off has no frame for these states, so the nearest frames are on the left: 03b PassArchived (03b-B15) for the retired point, PackerPass for the receiving Pass. The config status image is the capture alone.

| State | Frame (left) | English | Urdu |
| --- | --- | --- | --- |
| Archived point's tablet after `point_view_refresh { view: null }` | 03b PassArchived | [PassRetired](PassRetired.png) | [PassRetired-Urdu](PassRetired-Urdu.png) |
| Receiving Pass after its refreshed view | PackerPass | [PassMovedFrom](PassMovedFrom.png) | [PassMovedFrom-Urdu](PassMovedFrom-Urdu.png) |
| Hub admin config status, archive refused (`VALIDATION_FAILED`, issue path `archived`) | none | [ConfigArchiveRefused](ConfigArchiveRefused.png) | [ConfigArchiveRefused-Urdu](ConfigArchiveRefused-Urdu.png) |

- Retired: a full-screen state replaces the cards: "This point was retired — ask a manager to set this tablet to another point". It shows no station strip, filter or actions. The next catch-up brings the Pass back. 03b-B15 PassArchived (the 404 POINT_NOT_FOUND banner with the cards still on screen) stays as built for a command refused on an archived point.
- Moved from: each moved line shows "Moved from {old point name}" as a chip on its own line under the item. The hub sends `LineDetail.moved_from` as the name string, both live and on catch-up. The KDS shows no label: §3.10 names only the receiving Pass.
- Config status: the hub's danger banner reads "Menu update refused: activate another Pass point first." followed by the version still in use. Every other problem keeps its existing text.

## L-CLIENT-2 item 2 the counter Ready tile after the R8 window

Captured from `apps/client/e2e/02b-tk-late.spec.ts` at device scale 2: a paid takeaway token, its bag ready (the kitchen drives it through the hub), and the page's clock fast-forwarded past the e2e hub's 60 s window. The kiosk images put the hand-off frame on the left (ReadyTiles 1920 × 1080 and the tile capture; TokenLate and the screen capture). The landscape tablet strip's tile is shown alone.

| State | Frame (left) | English | Urdu |
| --- | --- | --- | --- |
| Ready tile, not collected (kiosk column) | ReadyTiles | [ReadyTileLate](ReadyTileLate.png) | [ReadyTileLate-Urdu](ReadyTileLate-Urdu.png) |
| Ready tile, not collected (landscape tablet strip) | none | [ReadyTileLate-tablet](ReadyTileLate-tablet.png) | [ReadyTileLate-tablet-Urdu](ReadyTileLate-tablet-Urdu.png) |
| Token drawer of the late token (kiosk) | TokenLate | [TokenLate](TokenLate.png) | [TokenLate-Urdu](TokenLate-Urdu.png) |

- The tile turns amber (`tk-rt--late`) once hub now ≥ open-orders `ready_at` + `bag_ready_window_ms`, the pair every Pass card uses. A token with an addition waits for the later of its orders. The rail checks the clock again every 15 s while a ready tile has the pair. When the hub clears the pair (bag incomplete again, D8) or the token is collected, the next open-orders read removes the amber.
- A paid late tile with a phone the person can see reads "{n} min · Call" (`q.waiting_min`), and the tap opens the token, where Call and Hand over all are. A late tile with no phone keeps its Hand over. A Due late tile is amber and keeps Take payment.
- The drawer shows "Ready {n} min ago — not collected" (`v.late`) with Call when the drawer's own read finds every live line still ready. Both strings come from strings-table.md.
## L-CLIENT-2 item 4 Unpaid hand-over: Ask a manager, waiting, approve with PIN

No hand-off frame shows the OR-7 request: the hand-off was drawn before OR-7 replaced R2's client override. The nearest frames are TokenDue (the Due drawer), ReadyTiles (the Due tile) and PackerPass (the Pass card). The images are the running client only, captured from `apps/client/e2e/02b-tk-unpaid.spec.ts` at device scale 2: the kiosk token drawer (1920 × 1080) and the Manager's answer sheet on the second listed tablet.

| State | Nearest frame | English | Urdu |
| --- | --- | --- | --- |
| Due token after "Ask a manager": waiting, Withdraw, Hand over all greyed (kiosk drawer) | TokenDue | [UnpaidWaiting](UnpaidWaiting.png) | [UnpaidWaiting-Urdu](UnpaidWaiting-Urdu.png) |
| Manager's request "Hand over unpaid #N" with the amount, before Approve + PIN (tablet) | (01d AnswerSheet) | [UnpaidAnswer](UnpaidAnswer.png) | [UnpaidAnswer-Urdu](UnpaidAnswer-Urdu.png) |

- One candidate check (`apps/client/src/features/staff/orders/unpaid/candidate.ts`) drives the ready tile, the token drawer, the parking / per-line Mark served sheet and the Pass card. A Due order without an effective approval cannot hand over its last live line. A partial serve that leaves a line is allowed. Unknown billing blocks the action.
- "Ask a manager" sends `RequestUnpaidHandover { order_id }` for the newest blocked order. The control shows the request's state: "Waiting for a manager…" with "Waiting — find a manager" and Withdraw for the requester, "Already waiting for a manager" for someone else's request, and "Manager said no" after a reject (read from my-requests on the requester's result).
- An approval (`UnpaidHandoverApproved`, or the open-orders `unpaid_handover_approved` flag once the hub sends it) unlocks only the named order, up to the approved amount (D2). Every customer hand-over sends `customer_handover: true`. The hub on this base drops the flag and has no refusal yet (U-5). The client's handling of `403 unpaid_handover_approval_required` is covered by unit tests only.
- ui-kit has no styles for the request control. It uses the existing `tk-msg`, `pc__msg` and `wcard` boxes, so on the ready tile it shows as a plain button.

## L-CLIENT-3 item 1 cart / Due check bill and Print receipt again (OR-5, R6, D9)

Captured from `apps/client/e2e/02b-tk-checkbill.spec.ts` at device scale 2 against the e2e hub. The run routes its device's bills to the e2e fake LAN printer ("Kitchen printer") with `SetBillRoute`, so every print really reaches the hub's queue. No hand-off frame shows the check bill actions (the hand-off was drawn before OR-5), so the kiosk images put the nearest frame on the left: HomeKiosk for the cart, TokenReady for the paid token drawer. The landscape tablet capture is shown alone.

| State | Nearest frame | English | Urdu |
| --- | --- | --- | --- |
| Unsent cart → Print check bill → "Check bill sent to … · Gross total … · Remaining payable …" (kiosk) | HomeKiosk | [CartCheckBill](CartCheckBill.png) | [CartCheckBill-Urdu](CartCheckBill-Urdu.png) |
| The same on the landscape tablet | none | [CartCheckBill-tablet](CartCheckBill-tablet.png) | [CartCheckBill-tablet-Urdu](CartCheckBill-tablet-Urdu.png) |
| Paid token drawer: Print receipt again → "Reprint sent to …" (kiosk) | TokenReady | [ReceiptAgain](ReceiptAgain.png) | [ReceiptAgain-Urdu](ReceiptAgain-Urdu.png) |

- A takeaway or parking cart with unsent lines sends `PrintCartCheckBill { draft }`. The draft is the cart's `eta-preview` draft: no ids and no customer contact. An addition cart adds `adds_to_order_id`, the root's id, as Send does. While a cart has unsent lines it never sends `PrintCheckBill`. The action is greyed while offline and never enters the queue. On a parking cart it is greyed until the car number is set.
- The toast shows where the paper printed ("No bill printer is set up — show the screen to the customer" without a route), followed by the paper's figures: Gross total `totals_default.total_minor` and Remaining payable `due_minor`. The Due token's `PrintCheckBill` toast shows the same two figures.
- A line refusal (`ITEM_UNAVAILABLE` and the others, with `details.key`) opens that cart line and names the item: "Check bill not printed — Naan is not available". An addition target the hub refuses (404 / 422 `adds_to_order_id`) reads as Send's "This token can't take more items…". Every other refusal uses its existing text.
- A paid token's drawer shows "Print receipt again" (`PrintBillDocument { doc: 'receipt', ref_id }`, the newest closed split's invoice) instead of Print check bill. It shows only to `take-payment` holders. An addition cart with no lines yet reads the token's newest bill once: Print check bill while money is due, Print receipt again once paid.
- The cart's own total keeps no "Items" label; the build left the cart footer as it was.

## L-CLIENT-3 item 2 the takeaway token slip: Send · pay later, the slip result, Print token (R6)

Captured from `apps/client/e2e/02b-tk-slip.spec.ts` at device scale 2 against the e2e hub. The run routes its device's bills to the e2e fake LAN printer with `SetBillRoute`, so the slip is a real `document` job ("Token slip"). The kiosk images put the frame on the left: SentToast for the toast after Send, TokenDue for the drawer. The landscape tablet drawer is shown alone.

| State | Frame (left) | English | Urdu |
| --- | --- | --- | --- |
| Send · pay later → "63 · sent · ready …" with "Slip printing" (kiosk) | SentToast | [SlipSent](SlipSent.png) | [SlipSent-Urdu](SlipSent-Urdu.png) |
| Due token: Print token → "Slip printing" (kiosk) | TokenDue | [SlipReprint](SlipReprint.png) | [SlipReprint-Urdu](SlipReprint-Urdu.png) |
| The same on the landscape tablet | none | [SlipReprint-tablet](SlipReprint-tablet.png) | [SlipReprint-tablet-Urdu](SlipReprint-tablet-Urdu.png) |

- Every takeaway Send that is not Send & pay sends `takeaway.print_slip: true`: Send · pay later, an addition's "Add to token", a Send by someone without `take-payment`, and a Send queued offline. Send & pay leaves the flag out, so the receipt is the only paper. The hub applies `takeaway_slip_on_send` itself, so the client sends the flag whatever the setting.
- The sent toast shows the result's `slip` on a second line. `printed` shows "Slip printing". `no_printer`, `failed` and `replay_late` show "Slip not printed — Print slip", and the token's queue row keeps that line in amber until a Print token prints. The hint is kept in memory, so it is gone after a reload. `setting_off`, `slip_held` and `null` show nothing. The result has no printer name, so the toast cannot say which printer it is queued on.
- The token view of a Due token shows Print token (`v.print`, strings-table.md) to `take-order` holders. It sends `PrintTakeawaySlip { order_id: <newest>, reason: 'reprint' }`. Only one request runs at a time, the button is greyed while offline, and the command is never queued. `no_printer` says "No slip printer is set up — the token is on the screen". `TAKEAWAY_SLIP_NOT_ALLOWED` shows its `errors.*` text and re-reads the token, which then hides the action.
- The frame's "Print again" button on the sent toast is not built. 03c §3.11 places the reprint in the token view only. There is no QR: the e2e hub is Tier 2, where `statusLink` returns null.

## L-CLIENT-3 item 3 the hub's unpaid hand-over refusal (U-5) from the UI

The images are the running client only, captured from `apps/client/e2e/02b-tk-unpaid.spec.ts` (the U-5 test, kiosk 1920 × 1080, device scale 2). They show the toast and the token drawer after the hub refused. The nearest frame is TokenDue. No frame shows OR-7.

| State | English | Urdu |
| --- | --- | --- |
| The refusal toast "Not paid — take payment first or ask a manager" | [UnpaidRefusedToast](UnpaidRefusedToast.png) | [UnpaidRefusedToast-Urdu](UnpaidRefusedToast-Urdu.png) |
| The token drawer after the refusal: Ask a manager again, Give ready items now greyed | [UnpaidRefused](UnpaidRefused.png) | [UnpaidRefused-Urdu](UnpaidRefused-Urdu.png) |

- U-5 is merged. `MarkServed { customer_handover: true }` rechecks the key's fresh due against the order's approval in the hub's writer transaction. It refuses with `403 PERMISSION_DENIED { reason: 'unpaid_handover_approval_required', order_id }`, the shape the client already mapped. The client needed no fix.
- The e2e reaches that refusal from the UI. Ali sends a Naan to pay later, the kitchen makes it ready, and the Manager approves the unpaid hand-over at its due, so the client's own check passes. Ali taps Hand over all. Inside the 5 s Undo window another counter adds a Kheer to the same token, through the hub's API (`SubmitOrder` with `adds_to_order_id`, as the Owner on the kitchen tablet). That raises the key's due above the approved amount. The hub refuses the send. The toast shows the refusal, and the token offers Ask a manager again for the larger due.
- This replaces the L-CLIENT-2 note above: the client's handling of the refusal is now covered end to end, not only by unit tests.

## L-CLIENT-4 item 2 Send & pay closed unpaid prints the token slip (pay_later)

Captured from `apps/client/e2e/02b-tk-slip.spec.ts` (the pay-later test) at device scale 2 against the e2e hub. The run routes its device's bills to the e2e fake LAN printer with `SetBillRoute`, so the slip is a real `document` job ("Token slip"). The images show the running client only, right after the pay panel closed. The nearest frames are PayCash (the panel) and SentToast (the toast); no frame shows this close.

| State | English | Urdu |
| --- | --- | --- |
| Send & pay → Pay later on the panel → "Slip printing" (kiosk) | [SlipPayLater](SlipPayLater.png) | [SlipPayLater-Urdu](SlipPayLater-Urdu.png) |
| The same on the landscape tablet | [SlipPayLater-tablet](SlipPayLater-tablet.png) | [SlipPayLater-tablet-Urdu](SlipPayLater-tablet-Urdu.png) |

- Send & pay sends no `print_slip` flag (its `slip` result is `null`). When the panel that Send & pay opened closes with the bill still open, the client sends `PrintTakeawaySlip { order_id: <the sent order>, reason: 'pay_later' }` once. The panel closes through Pay later, or through its ✕ before the bill closed. A partly paid bill counts as open. The command is never queued.
- A lost reply or a 5xx is sent again with the same `command_id`, after 1, 2, 5, 10, 20 and 30 s, while the page lives. It stops at a 2xx or a 4xx. If the last retry also fails, the token is marked "Slip not printed — Print slip" and the toast says so.
- Results: `printed` → "Slip printing". `no_printer` → "No slip printer is set up — the token is on the screen", and the token is marked. `setting_off`, `slip_held` and `already_printed` show nothing, as at Send. A 4xx shows its `errors.*` text. The exception is `TAKEAWAY_SLIP_NOT_ALLOWED { reason: 'billed' }`, which shows nothing because the token was paid meanwhile.
- A paid panel sends nothing: the receipt is the only paper, whether it closes with Next customer or with ✕. A pay panel opened by Take payment of a queued token also sends nothing, because that token got its slip at Send.
