# 02b-TK Part A2 batch 3 — brief for Codex

Self-contained brief. Build two client items of the 02b-TK Takeaway design: **item 6, the counter-facing customer display**, and **item 7, the tablet and phone layouts**. Client only: no hub, cloud, package (except ui-kit CSS), spec, migration, event or API change. If an item seems to need one, stop that item and write down why.

## 0. Ground rules

- **Base branch:** `claude/gracious-hawking-9670fy` (has Part A, rulings 1–5 and A2 batches 1–2). Work on a new branch `codex/02b-tk-a2-batch3` from its tip; open no PR unless the owner asks.
- **Read first:** `CLAUDE.md` (TDD, one task per commit, cite the spec, test environment), `docs/plans/02b-tk-plan.md`, `docs/plans/02b-tk-rulings.md` (owner rulings R1–R9 + audit corrections + owner rulings of 2026-11-24 — they win over the frames), `docs/design/handoff/02b-tk/CHANGES.md`, `MAPPING.md`, `strings-table.md`.
- **Specs as built** (do not implement DRAFT specs): 02b v1.0.24 §8, 05 v1.0.34 §6.1, 05a v1.0.6, 03a v1.2.10 §6.5.
- **TDD:** for every behaviour write the failing vitest first, run it, see it fail, then code. One item (or sub-item below) per commit. Commit message cites spec + frame, e.g. `feat(client): counter-facing customer display [02b v1.0.24 §8; 02b-tk A2 item 6, frame CustomerDisplay]`.
- **Privacy (R3, 02b O17):** the customer display never shows the customer's name or phone, the cashier's PIN pad, the session token, or any other order than the cart being built / paid. Tablet and phone layouts keep the existing masking (name/phone only for `view-customer-contact` holders).
- **Out of the pilot:** Raast QR, NFC card, "Most ordered this hour", pickup chips, the token slip — do not build them (Part B / 05c).

## 1. Item 6 — counter-facing customer display (frame `docs/design/handoff/02b-tk/design/CustomerDisplay.dc.html`)

**What:** a second browser window on the kiosk's second monitor, facing the customer: the cart lines (name, qty, line price), the total ("Rs 1,190", commas in threes, LTR), and the big "Ready by 1:42 PM" from the live eta-preview; an idle "Welcome" state when the cart is empty; a "Paid ✓ · change Rs N" state after Send & pay closes the bill; English + Urdu (follows the kiosk's language). Never phone or name. No Raast QR (frame `CustomerDisplayRaast` is out).

**How (no hub change):**
- Same origin, same staff entry: add a hash route `#/customer-display` to the staff app that renders **before** the sign-in gate (it needs no session and must not read the session token or call any hub endpoint). Files: `apps/client/src/features/staff/StaffApp.tsx` (route switch), new folder `apps/client/src/features/staff/orders/customer-display/` (`CustomerDisplay.tsx`, `channel.ts`, tests).
- Feed: a `BroadcastChannel('pos-customer-display')` posted from the takeaway order screen. Message shape (versioned, data only): `{ v: 1, kind: 'cart' | 'paid' | 'idle', lines: [{ name, qty, line_minor }], total_minor, ready_by_ms | null, change_minor? , lang: 'en' | 'ur' }`. Post on every cart / preview change (throttle ~150 ms) and on pay done. Build the payload from data the screen already has — never pass the customer row.
- Opener: a "Customer screen" button in the kiosk person menu or shell (kiosk only) that `window.open('/staff/#/customer-display', 'pos-customer-display')`; the display survives a reload (it shows idle until the next message).
- Reuse: cart model `apps/client/src/features/staff/orders/order-screen/cart.ts`, money format `apps/client/src/features/staff/orders/money.ts`, ready-by `readyBy()` in `order-screen/cart.ts` (fed by `order-screen/preview.ts`), existing BroadcastChannel pattern in `apps/client/src/features/staff/orders/queue/queue.ts` (wrap `new BroadcastChannel` in try/catch; no channel → do nothing), i18n `apps/client/src/i18n/en.ts` / `ur.ts`, styles: port the `.cd-*` classes from `docs/design/handoff/02b-tk/design/pulse-tk.css` into `packages/ui-kit/components/staff-02b-tk.css`.
- Tests (vitest): channel payload has no `customer_name` / `phone` keys even when the cart has them; the display renders lines, total and Ready by from a message; idle on no message; paid state; Urdu RTL with numbers LTR; a malformed / wrong-version message is ignored; the display route renders without a session and makes no fetch.

## 2. Item 7 — tablet 1280×800 and phone 390×844 layouts

Frames (`docs/design/handoff/02b-tk/design/`): `HomeTablet.dc.html`, `HomeTabletUrdu.dc.html`, `QueueTablet.dc.html`, `PhoneMenu.dc.html`, `PhoneCart.dc.html`, `PhoneCartUrdu.dc.html`, `PhoneQueue.dc.html`, `PhoneToken.dc.html`, `PhoneOffline.dc.html`.

Part A already has the skeleton: kiosk rail | menu | cart, tablet ready strip + queue drawer, phone Menu / Cart / Queue tabs (`apps/client/src/features/staff/orders/takeaway/TakeawayHome.tsx`, `QueueRail.tsx`, `TokenView.tsx`, `PayPanel.tsx`, `order-screen/OrderScreen.tsx`, `order-screen/Cart.tsx`, `order-screen/MenuTiles.tsx`, `order-screen/CustomerRow.tsx`). This item brings each to its frame:
- **7a Tablet home (HomeTablet):** ready strip on top (tap = hand over / pay, same rules as the kiosk tile incl. ruling #1 "Hand over all only when every live line is ready" and ruling #2 "Due → Take payment first, no override"), menu 3 columns, cart 440 px; queue opens as a drawer.
- **7b Tablet queue drawer (QueueTablet):** full queue, search by token / name / last 4 (client-side, R3 masking), rush density.
- **7c Phone menu + cart (PhoneMenu, PhoneCart):** 2-column menu with the wait on every tile; sticky bottom bar with total + Ready by (+ Pay for take-payment holders); Cart tab with name / phone (+92 field, `inputMode="tel"`, hub rule 10–13 digits), lines with steppers and times.
- **7d Phone queue + token (PhoneQueue, PhoneToken):** Queue tab ready first (hand over / pay), then cooking; one token full screen with stages, Hand over / Give ready items now / Pay, Add items.
- **7e Phone offline (PhoneOffline):** times "—", Send queues, Pay hidden.
- Reuse the existing components; layout differences go in CSS (`packages/ui-kit/components/staff-02b-tk.css`, port `.tk-*` from `pulse-tk.css`) and small layout props — do not fork the components. Device class detection: reuse what `TakeawayHome.tsx` already uses.
- Tests (vitest, with `apps/client/src/features/staff/orders/takeaway/screen-harness.tsx` and its tablet/phone options): each layout renders its regions; the sticky bar shows total + Ready by; the drawer opens/closes; phone tabs switch; masking for a person without `view-customer-contact`.

## 3. Strings

Take every string from `docs/design/handoff/02b-tk/strings-table.md` (keys `cd.*`, `q.*`, `c.*`, `v.*`, `p.*`, `t.*` …) into `apps/client/src/i18n/en.ts` and `ur.ts`. A string you must invent: add en + ur, mark the line `// not in strings-table.md; Urdu to confirm`, and add a row (key | English | Urdu) to `docs/design/handoff/02b-tk/urdu-todo.md` in the same commit. The i18n tests require every key in both files.

## 4. e2e

- New specs: `apps/client/e2e/02b-tk-display.spec.ts` (item 6: open the display window, build a cart on the kiosk, the display shows lines/total/Ready by, no name/phone even when typed; Send & pay → Paid state) and `apps/client/e2e/02b-tk-layouts.spec.ts` (item 7: tablet home + drawer, phone menu → cart → send → queue → token → hand over, phone offline). Both **en + ur** (parametrise by language like `02b-tk-flows.spec.ts`).
- Projects (`apps/client/playwright.config.ts`): item 6 → `kiosk`; item 7 → `tablet-landscape` (1280×800) and `phone-390` (390×844). Use `test.skip` by project only for devices a layout doesn't target.
- Seed and hub: `apps/client/e2e/global-setup.ts` starts a real hub on free ports and seeds devices (with 05a profiles, rulings fix), staff (Ali, Owner…), menu (Naan, Kheer on station S-E2E). Helpers in `apps/client/e2e/02b-support.ts` (`newOrder`, `takeaway()`, `payCash`, `kitchenReady`, `kitchenPull`, sign-in) — reuse them, add new helpers there.
- Run: `pnpm --filter @pos/client build`, then from `apps/client`: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers TMPDIR=/dev/shm pnpm exec playwright test e2e/02b-tk-display.spec.ts e2e/02b-tk-layouts.spec.ts --trace off` (cloud sessions: the session-start hook installs the pinned Chromium; locally run `pnpm exec playwright install chromium` once). Only one Playwright run at a time per machine (the hub ports are shared). Then the whole takeaway set: `e2e/02b-takeaway.spec.ts e2e/02b-queue.spec.ts e2e/02b-tk-*.spec.ts` on all five projects.
- Checking the screens by eye: use the repo skill `.claude/skills/webapp-testing` (Playwright scripts against the running app) to take screenshots.

## 5. Done when

1. Gate green: `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` (if turbo fails with "Exec format error", the session-start hook's pnpm repair has not run: `bash tools/cloud/session-start.sh` with `CLAUDE_CODE_REMOTE_SESSION_ID` set, or see the hook).
2. e2e green in **en and ur**: the two new specs on their projects, and the whole takeaway set on all five projects, no new skips.
3. One commit per item / sub-item (6, 7a–7e), each with its tests seen failing first.
4. A screenshot of each screen next to its frame (`CustomerDisplay`, `HomeTablet`, `HomeTabletUrdu`, `QueueTablet`, `PhoneMenu`, `PhoneCart`, `PhoneCartUrdu`, `PhoneQueue`, `PhoneToken`, `PhoneOffline`) saved under `docs/design/handoff/02b-tk/as-built/` as `<Frame>.png` (left: frame render of the `.dc.html`, right: the app at the same viewport), and a short `docs/design/handoff/02b-tk/as-built/README.md` listing each deviation from the frame and why.
5. Branch pushed; a short report: commits, gate + e2e counts, deviations, strings added to urdu-todo.md.
