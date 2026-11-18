# Notification deep links — refined story (owner, 2026-11-18)

**Owner's request, as he said it:** "notification par click karo to os jaga le jae aur wo highlight ho"

(When I click a notification, take me to that place and highlight it.)

## Owner rulings (2026-11-18)

- **Where:** the staff app (waiter / cashier / manager on tablet and phone) and the Windows cashier kiosk. The KDS is out of scope.
- **Which:** every alert kind that has a place to open in the staff app.
- **DL Q-0a (a):** kinds with no staff-app screen keep today's tap. `station_overload`, `kds_offline`, `printer_problem` and `no_approver` open the detail card as now, with no deep link.
- **DL Q-0b (a):** existing notifications only. Telling waiters "food ready" is a separate future feature.
- **Tap:** opens the target's place, scrolls the target into view, and gives it a soft brand-colour glow for 2 s. If the target no longer exists or is no longer open (order cancelled or billed, line voided or removed, request closed), show "This item is no longer open." and stay put. A target inside a folded (fully served) round unfolds that round.
- **DL Q-1 (a)** (09:18): a request the viewer can answer opens the place, glows it, then the answer sheet on top. Only a closed request stops the sheet.
- **DL Q-2 (a)** (09:18): only `ready_to_serve` treats a served order as no longer open; elsewhere served lines and rounds stay reachable, unfold and glow.
- **DL Q-3 (a)** (10:05, "Theak ha jaise tm kaho"): a notice tap (all six notice kinds) glows the place, then shows the notice card with all its facts on top. The owner also accepted the kiosk "Back" chip and seen on every tap, and approved the spec set.
- **Integrator ruling:** after navigating, the tap still marks the alert seen (`MarkAlertsSeen`, 01d §8.1).

## Acceptance

1. Tapping a notification whose kind has a staff-app place opens that place (table sheet, the order or line in it, a takeaway / parking order, the zone stock row), scrolls to the target and glows it for 2 s (a static ring with reduced motion).
2. A target that is no longer open (a served order counts only for `ready_to_serve`) shows "This item is no longer open." and the screen does not change. An answerable request and a notice still open their sheet over the current screen.
3. `station_overload`, `kds_offline`, `printer_problem`, `no_approver` (and `test_alert`) behave as today.
4. Every tap marks the alert seen.
5. The same on tablet (landscape and portrait), phone and the cashier kiosk; never on the KDS.

Spec: `docs/specs/01d_Notifications_Requests_Spec_v1.3.md` §3.13 (rulings DL Q-0a, Q-0b, Q-1, Q-2, Q-3, the Back chip and the seen rule; approved 2026-11-18; §12.8). Review: `docs/reviews/dl-deeplinks-hostile-review.md`.
