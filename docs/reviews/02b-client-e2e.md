# 02b client — Playwright flows (task 28)

Spec: 02b v1.0.11 §8, §10 #35, #36 (browser parts); 02a v1.1.6 §8 (the gaps moved to task 28). Plan: `docs/plans/02-client-plan.md` task 28.
Branch `test/02b-flows` on `merge/02b-to-main` (after the wiring PR #193). Not part of the gate (`pnpm test:e2e` only; never in CI or the cloud).
Every 02b flow needs 02a's shell and 02a's table screens, so all of them run only in the combined tree. Flows that drive
02a and 02b in one test are tagged `@combined` in their titles.

## Run

```
pnpm --filter @pos/client test:e2e          # builds the client, then playwright test
```

Chromium was pre-installed one revision behind Playwright 1.65 (1243; 1.65 expects 1254). As lane A did for #186, the run used a
throwaway browsers folder whose `chromium-1254` / `chromium_headless_shell-1254` entries point at the installed 1243 builds. It was
passed through the command's environment only, and no machine path is committed:
`PLAYWRIGHT_BROWSERS_PATH=<dir> TMPDIR=/dev/shm pnpm exec playwright test`. One worker, one test hub for the whole run.

**Result: 161 passed, 0 failed, 14 skipped** (15.8 min, one clean full run after the fixes below).
That is 96 02b runs (10 flows; takeaway runs only at the kiosk viewport and parking only at the two phone sizes: those are the
14 skips) + 60 02a runs (6 flows × 5 viewports × en + ur, `02a-offline` now with the real queue) + 5 W0.7 smoke. Two earlier
full runs on the way failed 14 and then 5 tests; those failures led to the fixes below (the plate clash, the phone floor, the
fold race, and bug 2), and none was left open.

Viewports: 1280×800, 800×1280, 1920×1080 (the kiosk), 390×844, 360×740; en + ur (`/staff/?lang=ur`). Each run signs in on
**its own screen**: the paired cashier kiosk at 1920×1080, Ali's paired phone at the two phone sizes, a tablet otherwise.

## Fixture (`apps/client/e2e/global-setup.ts`, extended)

- The menu is the hub's 02b test menu (`apps/hub/test/orders/fixtures.ts` `fixtureMenu`: Naan, Cola, Chicken Karahi, Fish, Raita, Water,
  Karahi combo) on the e2e floors. The business day is opened with `openDay`, and Karahi stock is counted.
- Each floor's zone keeps Cola on its counter (warn at 2, 500 counted with `setZoneStock`).
- `FLOOR_SIZE` 60 → 120 per floor, and `FLOWS` gains `order`, `comp`, `zone`, `bill`. 02a's table pairs are unchanged (the slot index
  of the earlier flows is the same).
- Paired devices: a `cashier_kiosk` and a `phone` owned by Ali (`E2eHub.kiosk`, `.phone`).
- Ali's role gains `manage-zone-stock` and `apply-comp` **requires approval** (approver: Manager).
- One more seeded table waiting for cleaning per run, for the online Clean.

## Flows

| File | Flow | Runs |
|---|---|---|
| `02b-order.spec.ts` | tablet: Take order → Naan → Send → "Sent" + "Food together at" → Done → the table's sheet → Add items · Round 2 → Naan; the manager (second tablet) releases Ali's lock → Ali's order screen shows **"Your table {table} was released by Manager"** + "Your order is kept as a draft." (02a-B10 on the real order screen) | 10 |
| `02b-takeaway.spec.ts` | kiosk home → Takeaway → Naan → Send → the big token (> 0) | kiosk ×2 (8 skipped) |
| `02b-parking.spec.ts` | Ali's phone: the map's **New order** (IR-5) → Parking → plate + Sedan → Next → Naan → Send (cart tab) → the plate on the sent card | phones ×4 (6 skipped) |
| `02b-queue.spec.ts` | (1) offline (socket closed, network off) Send → "Not sent yet" + "It will send when the hub is back", no token → OK → online → the queue sends it → the sticky **"Takeaway sent · Queued at …"** card with its token (IR-7: shell root) → OK. (2) the submit gets no answer → queued → reload → the entry is in the log as "this screen was restarted" (Q-2) → sign in → `#/queue` → **Send again as Ali** → "All sent", the log is empty | 20 |
| `02b-idle.spec.ts` | Playwright clock; signed in, offline, 61 min on → the first tap shows **"Signed out after 60 min idle"** (the TTL from the login reply) → online → the lock's Sign in → the names / PIN pad again | 10 |
| `02b-comp.spec.ts` | Ali sends Naan → the line → Comp ("Needs a manager's approval") → a reason → Ask for approval → "Comp asked — waiting for approval" + the waiting card; the manager (a 1280×800 tablet: phones have no Requests screen) → Requests → the request → Approve → PIN → "Approved"; Ali's waiting card goes | 10 |
| `02b-zone.spec.ts` | (1) zone undo: Cola at a zone table → Send → Done → the served round (folded) → the line → **Undo · m:ss** → "Removed". (2) zone refill: `#/zones` → Rooftop → Cola → Refill → Refill (1) → "Refilled · n now", the count is n | 20 |
| `02b-open-orders.spec.ts` | a parking order (New order; the kiosk goes to the map for it) → Send → `#/orders` → its row (plate, "Parking") → its order view with the Naan line | 10 |
| `02b-bill.spec.ts` | **online Ask for bill and Clean** (02a gap): order + Send → the sheet → Ask for bill → Ask → "Bill asked", the tile reads Bill; a table waiting for cleaning → Mark clean → the tile reads Free | 10 |
| `02a-offline.spec.ts` (changed) | **Bill / Clean queued** (02a + 02b's real queue): offline Ask for bill and Clean now answer **"Will be sent when the hub is back"** (was "Needs the hub" with the W0.6 stub); online again → the tiles read Bill and Free. Hand over offline still says "Needs the hub" | 10 |

The 02a flows (map, busy, handover, tables, call) and the W0.7 smoke run unchanged on the new fixture.

## Bugs found

1. **Fixed here (02b, trivial):** the order screen built the table name as `[tile.name, ...joined_table_names]`, but the hub's
   `joined_table_names` already lists every table of the seating, itself included (02a uses `length > 1 ? join : name`). Every
   dine-in Send showed **"R001 + R001"** in the Sent card and the queue label read "Order · R001 + R001"; a joined A + B would
   read "A + A + B". Fix: `OrderScreen.tsx` `tableCode()`; test in `send.test.tsx` (failed first: `'Order · F4 + F4'`).
2. **Fixed here (02b, small):** the table view's orders part (`OrdersPart.tsx`) reset itself whenever StaffApp re-rendered. Its
   reader effect depended on the whole `shell`, and StaffApp builds a new shell object on every render (the 15 s clock tick, any
   socket frame, a toast). Each StaffApp render dropped the read (an extra `seating-orders` query), closed the selected line's
   actions and folded a served round the waiter had just opened. Seen as "flaky" taps in the e2e (the Comp button and the zone
   Undo disappearing under the tap, mostly on phones). Fix: the effect depends on `shell.live` / `shell.orders` and reads the clock
   through a ref. Test in `OrdersPart.test.tsx` (failed first: 2 reads instead of 1). No other 02 screen depends on the whole
   `shell` (checked). With the fix the comp and zone flows pass at every viewport with ordinary taps.

## Not driven (and why)

| Item | Why |
|---|---|
| **Comp it?** (E-7, 02b-C03) | The prompt needs "Send it as a new item". That button is offered when the replacement of a sent-back line has 0 live units, which takes a Void (disabled until 04), or when the order closed > 30 min after serving (the hub's clock is not the browser's). Unit-tested: `send-back.test.tsx` (Send it as a new item) and `OrdersPart.test.tsx` (the Comp it? prompt). |
| Lock banners other than "released by" | other_device / holder_changed / released_ttl need a second device on the same table or the hub clock. Unit tests in 23a. |
| Takeaway with a customer name, the phone and plate validation errors | not asserted; unit tests in `new-order/new-order.test.tsx` |
| Held orders, drafts after a reload, deal / option / weight sheets, Send back, Boost, Mark served | screens exist; not in the task 28 list; vitest |
| A revoked device (Pair again) | needs a revoked token mid-run; StaffApp wiring tests (#193) and `docs/plans/02-client-manual-checks.md` |
| Urdu | the Urdu runs use `ur.ts`; most 02b strings are not translated yet (`docs/design/handoff/02b/urdu-todo.md`) and fall back to English, so some ur screens mix both (e.g. the comp waiting card "Waiting for approval — Rs 30 comp" in English beside Urdu chrome). Native review stays in the manual checks. |

## Method notes

- Offline = the page's `/ws` closed with `routeWebSocket` + `context.setOffline(true)` (as 02a). "No answer" for one command =
  `page.route('**/commands/submit-order', abort)`.
- The idle lock uses `page.clock.install()` + `fastForward('01:01:00')`. With the page's clock faked, `locator.click()` waits forever
  for actionability, so the first tap is a raw `page.mouse.click`.
- The two-person flows (order + lock banner, comp) run a second browser context. The comp flow has a 90 s budget (two sign-ins, a PIN, the answer's round trip).
- The test hub's clock is in-memory; no timing asserts. Phones show the cart as a tab: `sendCart` opens it when Send is not on screen.
- After Done, the app returns to the table's sheet (not the map); a served round is folded, so the zone flow opens it first.
- Each run's parking plate is unique per (viewport, language), because the hub keeps every run's orders open.
- The kiosk lands on its home (`#/`); flows that start at a table go to `#/tables` first.
