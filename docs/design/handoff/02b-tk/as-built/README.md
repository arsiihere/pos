# 02b-TK Item 6 customer display

[Frame comparison](CustomerDisplay.png) places the hand-off on the left and the built display on the right. Both were rendered at 1920 × 1080. The frame ends at its content height. The live display fills the monitor.

- [Idle](CustomerDisplay-idle.png)
- [Cart](CustomerDisplay-cart.png)
- [Paid](CustomerDisplay-paid.png)

The captures use the frame’s five menu lines and prices through the display’s BroadcastChannel. The kiosk end-to-end tests exercise the live cart and bill close separately. The badge uses the branch initial from the staff page. Welcome and Paid retain the badge and bilingual footer as requested.

The current branch-config menu supplies one name per item or deal. Existing bilingual menu labels are displayed as configured, with Urdu set RTL. An English-only menu label remains English. The footer uses the frame copy.
