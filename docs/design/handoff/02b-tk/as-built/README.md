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
