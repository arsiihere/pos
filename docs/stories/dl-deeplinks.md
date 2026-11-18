# Notification deep links — story (owner, 2026-11-18)

**Owner's request, as he said it:** "notification par click karo to os jaga le jae aur wo highlight ho"

(When I click a notification, take me to that place and highlight it.)

## Owner rulings (2026-11-18)

- **Where:** the staff app (waiter / cashier / manager on tablet and phone) and the Windows cashier kiosk. The KDS is out of scope.
- **Which:** every alert kind that has a place to open in the staff app.
- **Q1 (a):** kinds with no staff-app screen keep today's tap. `station_overload`, `kds_offline`, `printer_problem` and `no_approver` open the detail card as now, with no deep link.
- **Q2 (a):** existing notifications only. Telling waiters "food ready" is a separate future feature.
- **Tap:** opens the target's place, scrolls the target into view, and gives it a soft brand-colour glow for 2 s. If the target no longer exists or is no longer open (order cancelled or billed, line served or voided, request closed), show "This item is no longer open." and stay put. A target inside a folded (fully served) round unfolds that round.
- **Integrator ruling:** after navigating, the tap still marks the alert seen (`MarkAlertsSeen`, 01d §8.1).

## Acceptance

1. Tapping a notification whose kind has a staff-app place opens that place (table sheet, the order or line in it, a takeaway / parking order, the zone stock row), scrolls to the target and glows it for 2 s (a static ring with reduced motion).
2. A target that is no longer open shows "This item is no longer open." and the screen does not change.
3. `station_overload`, `kds_offline`, `printer_problem`, `no_approver` (and `test_alert`) behave as today.
4. Every tap marks the alert seen.
5. The same on tablet (landscape and portrait), phone and the cashier kiosk; never on the KDS.

Spec: `docs/specs/01d_Notifications_Requests_Spec_v1.3.md` §3.13 (rulings DL Q-1 (a), Q-2 (a) of 2026-11-18 09:18 in §12.8).
