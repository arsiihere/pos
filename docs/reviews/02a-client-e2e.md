# 02a client — Playwright flows (task 24)

Spec: 02a v1.1.6 §12.1 "§8 flows pass on a tablet and a phone", §8. Plan: `docs/plans/02-client-plan.md` task 24.
Branch `lane-A/24` on `module-02a-client` (58f620d7). Not part of the gate (`pnpm test:e2e` only; never in CI or the cloud).

## Run

```
pnpm --filter @pos/client test:e2e          # builds the client, then playwright test
```

Chromium was already installed on the machine that ran this (`playwright install` was not run). Its folder was
named for this run only, through the environment of the command (no machine path is committed):
`PLAYWRIGHT_BROWSERS_PATH=<dir> TMPDIR=/dev/shm pnpm exec playwright test`. One worker, one test hub for the whole run.

**Result: 65 passed, 0 failed, 0 skipped** — 6 flows × 5 viewports × en + ur = 60, plus the W0.7 smoke at 5 viewports.
Viewports: 1280×800, 800×1280, 1920×1080 (the kiosk size; the paired device is a tablet, see "Differs" 6), 390×844, 360×740.
Urdu runs open `/staff/?lang=ur` and look for the Urdu words from `src/i18n/ur.ts`.

## Fixture (outside the plan row's file list)

`apps/client/e2e/global-setup.ts` was extended (the plan row names only the specs and the review): two floors
("Ground floor" G001–G060, "Rooftop" R001–R060, one zone each), people Ali and Sara (take-order, clean-table,
mark-served; PIN 1234) and Bilal (the fixture's waiter role, reports to Ali, so a call from Ali's table reaches him),
three paired tablets (`device`, `device2`, `device3`), and, for the offline flow, tables seeded as events (one with
an order, one with its bill closed) because the 02b ordering screen is a stub. `E2eHub` keeps `device`, so `smoke.spec.ts` is unchanged.
Every (flow, viewport, language) run takes its own two tables (`tablePair`), so runs never meet on the one hub.

## Flows

| File | Flow | Driven |
|---|---|---|
| `02a-map.spec.ts` | sign-in → map → other floor (floor control / chips) → table sheet → Take order → `#/order/dine_in/…` (02b slot stub) → back; the tile is Seated | all 10 |
| `02a-busy.spec.ts` | Ali holds the lock; the manager (second tablet) sees "Take order — Ali is ordering" → Table busy → Release Ali's lock → reason required → Release; "is ordering" is gone | all 10 |
| `02a-handover.spec.ts` | Ali hands one table to Sara (second tablet): she opens the banner, **Accept**; Ali sees "Sara accepted"; then a second table, **Decline**; Ali sees "Sara declined" and "The table stays yours." Answer-sheet buttons measured | all 10 |
| `02a-tables.spec.ts` | Move party A→B, Join A to B ("A + B"), Split A off ("No orders — just free A") | all 10 |
| `02a-call.spec.ts` | Call waiter → Water → "Waiter called" (not "Nobody else is working"); the tile shows "Call sent" | all 10 |
| `02a-offline.spec.ts` | the page's socket is closed and the network refused: sheet says "Hub offline…"; Hand over tapped → "Needs the hub", no dialog; Ask for bill → confirm → "Needs the hub"; Clean on a table waiting for cleaning → "Needs the hub" | all 10 |

## The 72 px phone answer sheet, measured

Accept / Decline in the handover answer sheet (`getByRole('button').boundingBox().height`):

| Viewport | Decline | Accept |
|---|---|---|
| 1280×800, 800×1280, 1920×1080 | 72 | 72 |
| 390×844, 360×740 | **64** | **64** |

The plan (task 23a) says 72 px on the phone. Cause: `packages/ui-kit/components/pulse-02.css:394`
`.pu.phone .acts .btn { min-height: 64px; }` beats `pulse-staff.css:699`. **Ruled IR-10: accepted.** The spec's phone floor is
56 px and `pulse-02.css` is the handoff's byte copy. The spec asserts >= 72 px on tablet and kiosk viewports and >= 56 px on phones.

## Screen ID → done / differs

"Done" = seen working in a committed flow. "Not driven" = built and covered by vitest, but no e2e flow drives it
(it needs a state the flows cannot reach: a revoked device, a second holder, real orders from 02b, a clock).

| Screen | State |
|---|---|
| 02-S01 Sign-in names | done (every flow). SignInOffline, locked person: not driven |
| 02-S02 PIN pad | done (every flow); wrong-PIN text: not driven |
| 02-D01 Signed in here already | handled in the `signIn` helper (a session left on the device asks for the PIN again to take over); only hit when a run leaves one behind, not asserted |
| 02a-S00 Pair again | not driven (needs a revoked token) |
| 02a-C10 Top bar | done on tablets (floor control, live, clock, person) and phones (title, avatar). Differs: 4 below |
| 02-S03 Table map | done at 5 viewports, en + ur; floors, 60 tables a floor. TableMapMine / Empty / Loading / Waiter / Offline bar: not driven |
| 02a-C01 Table tile | done: Free, Seated, Bill, Call sent, lock name, joined "A + B". Other states: unit tests |
| 02-B01 Table busy | done. TableBusyOwn: not driven |
| 02-D12 Force release | done (reason required, Release) |
| 02-S06 Table sheet | done: Take order, grid, More, busy primary, offline note, Clean. Assignee / Other / Waiter variants: not driven |
| 02a-D22 Take over | not driven |
| 02a-D20 Hand over | done. HandOverGone: not driven |
| 02a-D21 Force move | not driven |
| 02-D09 Move | done |
| 02-D10 Join | done (free-table path; absorb-a-party path: not driven) |
| 02-D11 Split | done for "No orders — just free"; ticking orders needs 02b orders: not driven |
| 02a-D23 Call a waiter | done; CallWaiterNobody seen while building, not asserted |
| 02a-D24 Ask for the bill | done offline (confirm → Needs the hub). Online ask: not driven |
| 02-D13 Mark clean | done offline (Needs the hub). Online, CleanOpenOrders, CleanWhileLocked: not driven |
| 02a-D25 Other owner | not driven |
| 02a-C02 Handover card (receiver) | done: banner → Open → answer sheet → Accept / Decline, no PIN. HandoverStale: not driven. Differs: 1 |
| 02a-C03 Waiting card | done ("Waiting for Sara"). WaitingLate: not driven |
| 02a-C04 Result notice | done (accepted, declined + "stays yours") |
| 02a-C05 Call-waiter card | not asserted on Bilal's page |
| 02a-B10 Lock banners | not driven (they sit on the 02b order screen) |
| 02-B02 Offline bar / Needs the hub | sheet note and "Needs the hub" on Hand over, Ask for bill, Clean: done. Map offline bar: not asserted |
| 02a-T01 Toasts | done: Waiter called, Needs the hub |

## Differs

1. **Phone answer-sheet buttons are 64 px, not 72** (above). Accepted, IR-10.
2. **Ask for bill is drawn off on a seated table with no order** ("tables.err.TABLE_NO_ORDERS"). Right by the actions matrix, but it means the online Ask for bill / Clean cannot be driven until 02b can place orders (task 28's combined worktree).
3. **02b order screen renders nothing** (slot stub): after Take order only the route `#/order/dine_in/<seating>` is asserted, and the lock banners (02a-B10) cannot be reached.
4. Top bar, from the 20b PR (unchanged): "Test alert" stays as an icon button for people who manage devices (frames omit it); the role subtitle under names on the sign-in grid is absent (the roster has no role); the queue line is warn-toned, not the frame's info tint (no style props).
5. Pair-again card is not the frame's 560 px centred card (needs CSS outside the row).
6. **The 1920×1080 "kiosk" run uses a tablet-type device.** The viewport is the kiosk's, but a paired `cashier_kiosk` lands on 02b's KioskHome slot, so the 02a flows (which start on the map) run on a tablet there.
7. Held buttons: Playwright refuses to click an `aria-disabled` button, but the sheet's busy primary ("Take order — Ali is ordering") and Hand over offline are drawn off and still answer a tap on purpose. The specs click them with `force: true`.

## Method notes

- The offline flow closes the page's `/ws` socket (`routeWebSocket`) and sets the context offline; `setOffline` alone leaves an open socket up.
- The test hub's clock is in-memory (3:40 AM in the screens); nothing here depends on wall time. No timing asserts.
- Logs and assertions carry table codes and staff first names from the fixture only.
