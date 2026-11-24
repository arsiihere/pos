# 02b-TK client merge

Merged `claude/gracious-hawking-9670fy` (`62269db2`) into `lane-02b-tk/client-merge`, based on `module-02b-tk` (`dea33af1`).

## Conflicted files

| File | Resolution |
| --- | --- |
| `apps/client/e2e/02b-support.ts` | Client. Kept the kitchen helpers with the updated landing, shift and takeaway waits. |
| `apps/client/e2e/02b-tk-flows.spec.ts` | Client. Kept the counter-flow tests with the current Takeaway tab and rush handling. |
| `apps/client/e2e/02b-tk-handover.spec.ts` | Client. Kept the three hand-over scenarios, including the Due-to-Paid flow under OR-7. |
| `apps/client/e2e/global-setup.ts` | Client. Kept the kitchen fixture with explicit 05a profiles and the tile fixtures. |
| `apps/client/src/features/staff/orders/live/availability.ts` | Client. Kept the module’s order-type station routing and wait estimates with paused-station and pressure-band support. |
| `apps/client/src/features/staff/orders/order-screen/Cart.tsx` | Client. Kept the customer row, send and pay, check-bill actions and the responsive cart layout. |
| `apps/client/src/features/staff/orders/order-screen/CustomerRow.tsx` | Client. Kept the contact entry row with its rush and responsive presentation. |
| `apps/client/src/features/staff/orders/order-screen/LeaveGuard.tsx` | Client. Kept the takeaway leave and hold guard with the newer navigation handling. |
| `apps/client/src/features/staff/orders/order-screen/OrderScreen.tsx` | Client. Kept the Takeaway tab, held drafts, token actions and billing with the tablet and phone layouts, contact checks and customer display. |
| `apps/client/src/features/staff/orders/order-screen/preview.test.ts` | Client. Kept day-not-open coverage and the newer Ready-by delta tests. |
| `apps/client/src/features/staff/orders/order-screen/preview.ts` | Client. Kept day-not-open and catch-up behavior with the Ready-by delta calculation. |
| `apps/client/src/features/staff/orders/order-screen/takeaway-tk.test.tsx` | Client. Kept the original takeaway cart, hold and queue coverage and updated variant interactions for the new tiles. |
| `apps/client/src/features/staff/orders/queue/WaitingToSend.tsx` | Client. Kept waiting rows and the responsive layout and contact handling. |
| `apps/client/src/features/staff/orders/send/send.test.tsx` | Client. Kept background-send and add-on coverage with current selectors and permission-aware toast assertions. |
| `apps/client/src/features/staff/orders/takeaway/PayPanel.tsx` | Client. Kept cash-note Enter handling and the confirmed-close customer display callback. |
| `apps/client/src/features/staff/orders/takeaway/QueueRail.tsx` | Client. Kept queue search, ready tiles and Take payment with the responsive queue and contact checks. |
| `apps/client/src/features/staff/orders/takeaway/TokenView.tsx` | Client. Kept token actions, check-bill and hand-over checks with the responsive drawer. OR-7 keeps hand-over disabled while payment is due. |
| `apps/client/src/features/staff/orders/takeaway/screen-harness.tsx` | Client. Kept token and payment fixtures with the responsive and preview test inputs. |
| `apps/client/src/features/staff/orders/takeaway/token-screen.test.tsx` | Client. Kept hand-over delay and add-to-token refusal assertions, plus coverage for unsent lines. |
| `apps/client/src/features/staff/orders/takeaway/token-view.test.tsx` | Client. Kept the COMP_PENDING refusal coverage. The manager/Due regression case checks the OR-7 outcome, with Hand over disabled and no hand-over callback. |
| `apps/client/src/i18n/en.ts` | Union. Kept module Recipes keys and client takeaway keys. Used current OR-7 wording for the shared payment hint and retained the historical override key as unused copy. |
| `apps/client/src/i18n/ur.ts` | Union. Kept module Recipes translations and client takeaway translations. Used current OR-7 wording for the shared payment hint and retained the historical override key as unused copy. |
| `apps/cloud/src/modules/staff-roles/default-roles.ts` | Module. Kept approved default roles. |
| `apps/cloud/test/db/cashier-mark-served-migration.int.test.ts` | Module. Kept the test for migration 0020. |
| `docs/design/handoff/02b-tk/urdu-todo.md` | Union. Kept all review keys once, with the shorter payment hint and the historical override row marked separately. |
| `docs/plans/02b-tk-plan.md` | Module. Kept the approved version. |
| `docs/plans/02b-tk-rulings.md` | Module. Kept the approved version. |
| `docs/plans/02b-tk-spec-status.md` | Module. Kept the approved version. |
| `docs/specs/00_Foundation_Spec_v1.18.md` | Module. Kept the approved version. |
| `docs/specs/00_Hub_Platform_Access_Spec_v1.13.md` | Module. Kept the approved version. |
| `docs/specs/01_Restaurant_Setup_Spec_v2.11.md` | Module. Kept the approved version. |
| `docs/specs/01b_Staff_Roles_Spec_v1.12.md` | Module. Kept the approved version. |
| `docs/specs/01c_Menu_Variants_Spec_v1.5.md` | Module. Kept the approved version. |
| `docs/specs/01d_Notifications_Requests_Spec_v1.3.7.md` | Module. Kept the approved version. |
| `docs/specs/02b_Ordering_Spec_v1.0.25.md` | Module. Kept the approved version. |
| `docs/specs/03a_Timing_Engine_Spec_v1.2.11.md` | Module. Kept the approved version. |
| `docs/specs/03b_KDS_Pass_Spec_v1.0.16.md` | Module. Kept the approved version. |
| `docs/specs/03c_Printing_Spec_v1.0.16.md` | Module. Kept the approved version. |
| `docs/specs/05_Billing_Spec_v1.0.35.md` | Module. Kept the approved version. |
| `docs/specs/05a_Device_Access_Screens_Spec_v1.0.7.md` | Module. Kept the approved version. |
| `docs/specs/05c_Payments_Integration_Spec_v0.2.md` | Module. Kept the approved version. |
| `docs/specs/README.md` | Module. Kept the approved version. |
| `packages/ui-kit/components/staff-02b-tk.css` | Client. Kept the base takeaway styles, ready and payment states, and the A2 tablet and phone layout rules. |

## Other merge decisions

- Kept the client branch’s e2e job and required gate dependency in `.github/workflows/gate.yml`.
- Kept the client-only plans `docs/plans/e2e-baseline.md` and `docs/plans/02b-tk-a2-batch3-codex.md`.
- Removed the incoming duplicate `apps/cloud/src/db/migrations/0019_cashier_mark_served.sql`. Its SQL is identical to the module’s `0020_cashier_mark_served.sql`. The module’s `0019_recipes.sql` and subsequent migrations remain in place.
- The automatically merged `apps/client/src/features/billing/nav.test.tsx` still verifies that My shift mounts the shift screen. The test now opens the person menu to reach the action.

## Browser verification

The full Playwright run exercised kiosk, landscape tablet and portrait tablet, including English and Urdu cases. It finished with 218 passing, 110 project exclusions and two failures. Both failed cases passed when rerun individually against a fresh test hub.

| Project | Passed | Excluded by project | Failed on first run |
| --- | ---: | ---: | --- |
| Kiosk | 90 | 19 | Urdu partial hand-over. The kitchen helper found no line to pull. |
| Tablet landscape | 90 | 20 | None |
| Tablet portrait | 38 | 71 | Inbox focus through sign-in. The sign-in choices did not appear within the five-second assertion timeout after sign-out. |

## Workspace verification

The initial gate reached the cloud tests, where the reused test database rejected migration 0019 because it had already recorded the client branch’s cashier migration at that number. Verification moved to fresh databases on the same test Postgres instance. The standalone cloud suite passed with 998 passing and one pre-existing skip.

The full gate passed on the fresh database with `TMPDIR=/dev/shm`: typecheck, lint and 8,883 passing tests, with two skips and one todo.
