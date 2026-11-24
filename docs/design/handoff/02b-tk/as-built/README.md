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
