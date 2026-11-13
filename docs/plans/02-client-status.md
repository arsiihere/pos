# 02a + 02b CLIENT — build board

Plan: `02-client-plan.md`. Gaps + rulings: `02-client-gaps.md`. Hub gaps: `02-hub-gaps-plan.md` (H1–H10, branch `module-02-hub-gaps`). Specs: 02a v1.1.6 §8, 02b v1.0.11 §8 / §3.12 / §10. Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-13: 02b close — release branch `merge/02b-to-main` (02b + `main` with 02a), wiring #193, task 28 #201 (e2e 161 pass, 0 fail). Ab 02b → `main` PR, owner merge karega (merge commit).
> - 2026-11-12: W0 shuru — `module-02-client-shell` (= `main` @ `1961adf`) pe W0.1 board. Labels `needs-ruling`, `lane:W0`, `lane:A…D`, `lane:Q/O/T/L`, `lane:HA…HD` pehle se bane hue hain.

## Branches

| Branch | Cut from | Takes PRs from | Merges into (owner) | State |
|---|---|---|---|---|
| `module-02-client-shell` | `origin/main` @ `1961adf` | `lane-W0/<task>` | `main`, right after W0.7 | open |
| `module-02a-client` | the shell tip (#153, Q-40 / Q-59) | `lane-{A,B,C,D}/<task>` | `main`, first | 20a–24 merged; → `main` PR from `merge/02a-to-main` (Z3) |
| `module-02b-client` | the shell tip (#154, Q-40 / Q-59) | `lane-{Q,O,T,L}/<task>` | `main`, after `module-02a-client` | 25a–27b2 merged; release branch `merge/02b-to-main` (module + `main` with 02a #187 and H1–H8 #173; wiring #193, task 28 #201) → `main` PR (Z3) |
| `module-02-hub-gaps` | `origin/main` | `lane-H{A,B,C,D}/<task>` | `main` (any time) | — |

## Wave 0 (integrator, `module-02-client-shell`)

| Task | Title | RISK | PR | State |
|---|---|---|---|---|
| W0.1 | Branches, labels, board | — | | in progress |
| W0.2 | `pulse-02.css` into ui-kit + import | NORMAL | | todo |
| W0.3 | Strings, both modules | NORMAL | | todo |
| W0.4 | 02a contracts + Tables api | HIGH | | todo |
| W0.5 | 02b contracts + Orders api | HIGH | | todo |
| W0.6 | StaffApp route skeleton, slots, live bus, hooks, toasts | NORMAL | | todo |
| W0.7 | Test dependencies: Playwright and fake-indexeddb | NORMAL | | todo |

## Lanes

| Lane | Module branch | Tasks (in order) | Label | State |
|---|---|---|---|---|
| A | `module-02a-client` | 20a → 20b → 24 | `lane:A` | waits for W0 |
| B | `module-02a-client` | 21a → 21b | `lane:B` | waits for W0 |
| C | `module-02a-client` | 22a → 22b → 22c | `lane:C` | waits for W0 |
| D | `module-02a-client` | 23a → 23b → 23c | `lane:D` | waits for W0 |
| Q | `module-02b-client` | 25a → 25b → 25c → 25d | `lane:Q` | waits for W0 (incl. W0.7) |
| O | `module-02b-client` | 26a → 26b → 26c → 26d | `lane:O` | waits for W0 |
| T | `module-02b-client` | 27a1 → 27a2 → 27a3 | `lane:T` | after a lane finishes (launch schedule) |
| L | `module-02b-client` | 27b1 → 27b2 | `lane:L` | after T starts |
| integrator | both | 28, Z1–Z3 | — | after 25–27 |

## 02a tasks (`module-02a-client`)

| Task | Title | RISK | Lane | Needs | PR | State |
|---|---|---|---|---|---|---|
| 20a | Login resume and pair again | NORMAL | A | W0 (H8 hub) | #157 | **merged** |
| 20b | Top bar and phone tabs | NORMAL | A | 20a | #163 | **merged** |
| 21a | Map store and live refresh | NORMAL | B | W0 | #160 | **merged** |
| 21b | Table map and tiles | NORMAL | B | 21a | #160 (with 21a, Q-41); wiring #170 (IR-3, IR-5) | **merged** |
| 22a | Table sheet, busy, force release, take over | HIGH | C | W0 | #161 | **merged** |
| 22b | Hand over, force move, move, join, split | HIGH | C | 22a | #166; IR-4 #175 | **merged** |
| 22c | Call waiter, ask for bill, clean | HIGH | C | 22a | #172 | **merged** |
| 23a | Lock hook and lock banners | HIGH | D | W0 | #159 | **merged** |
| 23b | Handover cards, call card, all alerts edits | HIGH | D | 23a (H7 hub) | #168; follow-up #176 | **merged** |
| 23c | Offline bar and "Needs the hub" marks | NORMAL | D | 23a | #169 | **merged** |
| 24 | 02a flows (Playwright) | NORMAL | A | 20a–23c | #186 | **merged** |

## 02b tasks (`module-02b-client`)

| Task | Title | RISK | Lane | Needs | PR | State |
|---|---|---|---|---|---|---|
| 25a | Queue and draft stores (IndexedDB + memory) | HIGH | Q | W0 (incl. W0.7) | #156 | **merged** |
| 25b | Queue core, replay and Enqueue | HIGH | Q | 25a | #162 | **merged** |
| 25c | Queue log, sign-in line, shell hooks | HIGH | Q | 25b | #165 | **merged** |
| 25d | Device idle lock and pending logout | HIGH | Q | 25c | #171 | **merged** |
| 26a | Stock mirror and availability | NORMAL | O | W0 | #158 | **merged** |
| 26b | Order screen, cart, live times | HIGH | O | 26a; (02a) 23a | #164 | **merged** |
| 26c | Options, deal, weight, note sheets | HIGH | O | 26b | #167 | **merged** |
| 26c2 | Deal part options (01c V9, Q-64) | HIGH | O | 26c | #180 | **merged** |
| 26d | New order, Send, Hold, day not started | HIGH | O | 26c; (02b) 25b (H2 hub) | #174 | **merged** |
| 27a1 | Order view, line rows, simple line actions | HIGH | T | W0 (H2, H3, H10 hub) | #178 | **merged** |
| 27a2 | Send back, comp, "Comp it?", waiting card | HIGH | T | 27a1; (02b) 26d (H6, H9 hub) | #183 | **merged** |
| 27a3 | Table view orders part, zone undo, late cards | HIGH | T | 27a2; (02a) 22a (H1, H2, H5 hub) | #185 | **merged** |
| 27b1 | Open orders and kiosk home | NORMAL | L | W0 (H1, H4 hub) | #181 (with 27b2) | **merged** |
| 27b2 | Zone stock | NORMAL | L | 27b1 | #181 | **merged** |
| 28 | 02b flows (Playwright, combined worktree) | NORMAL | integrator | 25a–27b2, 20a–23c | wiring #193 (HIGH, IR-5, IR-7, IR-11, IR-12); flows #201 | **merged** into `merge/02b-to-main` |

## Close (integrator)

| Task | What | Needs | State |
|---|---|---|---|
| Z1 | Acceptance map (§8 bullets, §10 #35 / #36, 02a §12.1, H tasks or fallback) | 24, 28 | 02a done; 02b: task 28 result below |
| Z2 | Manual checks on pilot hardware (`02-client-manual-checks.md`) | Z1 | list written (02a + 02b, M1–M11); owner runs it on the pilot hardware |
| Z3 | PR `module-02a-client` → `main`, then `module-02b-client` → `main` (owner merges); `@combined` e2e on `main` | Z1 | 02a on `main` (#187); 02b: `merge/02b-to-main` → `main` PR (owner merges, merge commit) |

## Z1 — 02a acceptance map (02a v1.1.6 §8, §12.1; integrator, 2026-11-13)

Green = passes in the normal gate at the `merge/02a-to-main` tip (vitest), or in `pnpm test:e2e` (task 24, 65 passed, `docs/reviews/02a-client-e2e.md`; not in the gate, never in CI or the cloud). Test names are quoted from `apps/client/src/**` (`S/` = `src/features/staff/`, `A/` = `src/features/alerts/`) and `apps/client/e2e/02a-*.spec.ts`. "Gap" = not proved by a test yet; where it goes is named.

| §8 bullet | Green tests | H task / fallback | Gaps |
|---|---|---|---|
| **Login** (roster; 401 / 403 / WS 4403 wipe token, device_id, device_type → Pair again → `/pair`; Q-13) | `S/SignIn.test.tsx` "[02a §8 Login] 401 DEVICE_TOKEN_INVALID from staff-roster wipes token, device_id, device_type → PairAgain → location /pair", "… 403 DEVICE_REVOKED and WS close 4403 → same wipe and PairAgain", "… a network error on staff-roster does not wipe the pairing", "… the pair button is off until the wipe is done"; `S/tables/PairAgain.test.tsx` (3 tests); e2e every flow signs in (`02a-map.spec.ts` "[02a §12.1, §8] sign-in → map → floor → Take order → back") | **H8 on `main`** (#173): pair page sends non-KDS devices to `/staff/` (hub test `apps/hub/test/auth/pairing.int.test.ts`) | Pair again not driven in e2e (needs a revoked token) → manual check. `main.tsx` not-paired branch untested (cleanup #157-3). |
| **Table map** (zones, tiles, Mine, `seating_id`; Q-5 live refresh, no timer; Q-35 skip list; Q-17 flags; Q-25 zone heading) | `S/tables/map/map-store.test.ts` all 10 ("[02a Q-5] any table frame except TableLockTouched, … → one table-map read, debounced 250 ms", "[02a Q-35] ItemStarted, ItemDone, ItemDoneUndone, FireDispatched and SlipWarned trigger no read", "[02a Q-5] a reply older than a read-triggering frame seen meanwhile is dropped …", "[02a Q-5] no timer …"); `S/tables/map/TableMap.test.tsx` ("[02a Q-17] late flag from my own open slip_warning rows …", "[02a Q-17] \"Waiting to send\" when Enqueue.pendingFor(table_id) > 0", "[02a Q-25] zone heading names an assignee only when …", "[02a §8 Table map] Mine = tables I hold or am assigned", "… a tile tap opens #/tables/<table_id> …"); `S/tables/map/Tile.test.tsx`, `filters.test.ts`; `S/StaffApp.test.tsx` "[02a §8 Top bar] the floor control lists the map store floors with counts and writes #/tables?floor=" (IR-1, IR-3), "[02a §8 Table map] the alert store rows reach the map" (IR-5); e2e `02a-map.spec.ts` | none needed (H5 `open_slips` is used when present: filters.test.ts "[02a Q-17] once catch-up open_slips exists (H5) …") | "Waiting to send" shows only once 02b's queue registers (unit-tested with a fake `Enqueue`; live in task 28). Mine / empty / offline bar not driven in e2e. Tile flag visuals vs `Tiles.dc.html` → manual pulse-02 check (cleanup #160). |
| **Open** (`TABLE_ALREADY_LOCKED` → busy, Force release with reason, draft stays) | `S/tables/dialogs/busy-release.test.tsx` all 9 ("[02a §8 Open] 409 TABLE_ALREADY_LOCKED → …", "[02a Q-18] Force release sends …", "… two quick taps on Release send one ForceReleaseTableLock"); `S/tables/sheet/TableSheet.test.tsx` "[02a §8 Open] Take order → OpenTable with the shown seating_id, then #/order/dine_in/<seating_id>"; e2e `02a-busy.spec.ts` | — | Draft-stays part sits on 02b's order screen → task 28. |
| **Order screen** (`useTableLock`: Touch 1 / min, Release on leaving; Q-3 exports) | `S/tables/lock/useTableLock.test.tsx` "[02a §8 Order screen] TouchTableLock once a minute while mounted (fake timers); ReleaseTableLock on unmount; both dropped offline", "… after MoveTable the hook touches and releases the new table", "… StrictMode …" | — | Mounted by 02b 26b; not driven in e2e (02b order screen is a slot stub on this branch) → task 28. |
| **Banners** (released, other device, holder changed + Send with take-order-anywhere, never retakes the lock) | `S/tables/lock/useTableLock.test.tsx` "[02a §8 Banners] TableLockReleased force → …", "TableLocked replaced_device_id = this device → …", "TableHolderChanged away from me → …", "with take-order-anywhere canSend stays true; the hook never takes the lock again", "catch_up (after a gap) reconciles …"; `S/tables/lock/LockBanner.test.tsx` (6) | — | e2e not driven (02a-B10 sits on the 02b order screen) → task 28. ForceMovedToMe banner shows table only (contract carries table only; cleanup "ForceMovedToMe" row, owner question). |
| **Table sheet** (take over, hand over, force move, move, merge, split, bill, clean, call; `other_owner` preset Q-25; reasons Q-18; `TABLE_HANDOVER_STALE`) | `S/tables/sheet/TableSheet.test.tsx` (15), `actions.test.ts`, `reasons.test.ts`; `S/tables/dialogs/handover.test.tsx` "[02a §8 Table sheet] Hand over lists handover-candidates working first, …", "… Force move: …"; `move-join-split.test.tsx` "[02a Q-25] other_owner preset only when assigned_staff_id is set and ≠ me; else the holder text + OK", Join, Split; `call-bill-clean.test.tsx` (10); `A/AnswerSheet.test.tsx` "[02a §8 Table sheet] Accept 409 TABLE_HANDOVER_STALE → \"Bill paid, waiting for cleaning\"; card stays"; e2e `02a-handover.spec.ts`, `02a-tables.spec.ts`, `02a-call.spec.ts` | — | e2e not driven: Take over, Force move, other_owner, absorb-a-party Join, Split with orders, online Ask for bill / Clean (need 02b orders → task 28). |
| **Handover waiting card** (Q-14 remember on send, "Waiting for an answer" after reload, `request_result` → my-requests diff) | `S/tables/cards/pending-handovers.test.ts` (14), `cards.test.tsx` "[02a Q-14] after reload: …", "[02a Q-14] request_result frame → my-requests diff by alert_id → …", "[02a Q-14] a new person signing in never sees the previous person's …"; `handover.test.tsx` "IR-4: a sent handover is remembered …"; e2e `02a-handover.spec.ts` ("Waiting for Sara", accepted / declined) | 01d fields deferred (OPEN-QUESTIONS §9) | WaitingLate not driven in e2e. |
| **Top bar** (Requests (n) + Inbox (n); phone tabs) | `S/tables/TopBar.test.tsx` (6); `S/StaffApp.test.tsx` "[02a §8 Top bar] after sign-in the app lands on #/tables (kiosk: #/) …" (IR-2), "… phone: top bar + tabs Tables · Orders · Inbox · Me" | — | Phone approvers have no path to Requests (spec silent; cleanup #163, owner question). |
| **Offline** (disabled set "Needs the hub"; Bill / Clean through one `enqueue()`; Call waiter not queued; Q-3) | `S/tables/offline/offline.test.tsx` "[02a §8 Offline] needsHub(): true for Open, Take over, Hand over, Force, Move, Merge, Split, Call waiter; false for Ask for bill, Clean", "… hub offline: last known tables stay; bar …"; `call-bill-clean.test.tsx` "[02a §8 Offline] Ask for bill / Clean go through Enqueue with seating_id: needs_hub → …", "[02a §8 Offline] Call waiter offline → …"; `move-join-split.test.tsx` "[02a §8 Offline] Hand over, Force move, Move, Join, Split disabled …"; `S/tables/api.test.ts` "[02b §3.12] requestBill / cleanTable reuse a given command_id"; e2e `02a-offline.spec.ts` | Q-3 interim: on this branch alone `enqueue()` answers `needs_hub` (02b's queue flips it) | Queued Bill / Clean, `TABLE_SEATING_CHANGED` on replay → queue log: 02b (25b, 25c) + task 28. The "queued" answer when the entry went to the queue log needs an additive `EnqueueResult` field (cleanup, task 28 decision). |
| **Rules** (buttons by grant only, Q-15 outside_scope; Urdu / English, Latin digits; ULIDs from `getRandomValues`; no service worker, no secure-context APIs) | `S/tables/sheet/actions.test.ts` "[02a §8 Rules] actions matrix: each button only with its grant allowed; requires_approval = not shown (§3.15)"; `TableSheet.test.tsx` "[02a Q-15] 403 PERMISSION_DENIED outside_scope → …"; `S/tables/errors.test.ts` "[02a Q-15] PERMISSION_DENIED reasons …"; `src/i18n/i18n.test.ts` "[02a §8 Rules] every 02a CHANGES §4/§6 key is in en, and in ur or 02a/urdu-todo.md"; Urdu tests in `TopBar.test.tsx`, `Tile.test.tsx`, `TableMap.test.tsx`, `LockBanner.test.tsx`; `src/app/ulid.test.ts` "[01a §10 #125] … random from getRandomValues …"; every e2e flow runs en + ur | — | "No service worker / no secure-context API" holds by construction (no test). Urdu needs a native review (`docs/design/handoff/02a/urdu-todo.md`) + Urdu on the device → manual check. |
| **§3.13** "Call sent" on the calling device only (Q-16) | `TableMap.test.tsx` "[02a Q-16] \"Call sent · n min\" only from this device's local flag"; `call-bill-clean.test.tsx` "[02a Q-16] repeated: true → …"; e2e `02a-call.spec.ts` (tile shows "Call sent") | **H7 on `main`** (#173): `cards.test.tsx` "[02a Q-12] call card \"F4 · Call · Ali\" with requester_name, \"F4 · Call\" without; never a chip" | The call card on the receiver's page is not asserted in e2e. |

| §12.1 row | Proof | Gaps |
|---|---|---|
| "§8 flows pass on a tablet and a phone" | task 24: 6 flows × 1280×800, 800×1280, 1920×1080, 390×844, 360×740 × en + ur = 60 + 5 smoke = **65 passed** (`docs/reviews/02a-client-e2e.md`, #186) | Phone answer-sheet buttons are 64 px (IR-10, accepted). 1920×1080 runs a tablet-type device (a paired kiosk lands on 02b's KioskHome). Online Bill / Clean, lock banners, Pair again → task 28 + manual checks. Not run on real devices yet → `02-client-manual-checks.md`. |

**H tasks:** H1–H8 are on `main` (#173) and reach `module-02a-client` with this merge; 02a uses H7 (call card name) and H8 (pair page → `/staff/`), both with the fallbacks of the plan still correct when the field is absent. H9 / H10 are parked until module-04 is on `main` (Q-37); 02a does not need them.

## Z1 — 02b result (task 28; integrator, 2026-11-13)

`pnpm test:e2e` on `merge/02b-to-main` (#201; `docs/reviews/02b-client-e2e.md`; not in the gate, never in CI or the cloud): **161 passed, 0 failed, 14 skipped**. That is 96 02b runs (10 flows × 5 viewports × en + ur; takeaway runs at the kiosk viewport only and parking at the two phone sizes only, the 14 skips) + 60 02a runs (`02a-offline` now with the real queue: Bill / Clean queued, then sent) + 5 W0.7 smoke. Local gate on the #201 head: 530 files, 5153 tests passed.

| Plan 28 flow | Spec | Result |
|---|---|---|
| dine-in order + Send + lock banners | 02b §8 Ordering screen, Send; 02a §8 Banners (02a gap) | `02b-order.spec.ts` (released-by banner on the real order screen) |
| takeaway token (kiosk) | 02b §8 Types, 02-D07 | `02b-takeaway.spec.ts` |
| parking (phone) | 02b §8 Types; IR-5 | `02b-parking.spec.ts` (via the map's New order) |
| offline Send → queued → reconnect → sticky token | 02b §3.12, §8 Queue; §10 #35; IR-7 | `02b-queue.spec.ts` |
| queue log Send again | 02b §3.12 Q-2 | `02b-queue.spec.ts` (a reloaded entry) |
| idle lock offline | 02b §8 Device idle lock, Q-21 | `02b-idle.spec.ts` |
| comp with approval + Comp it? | 02b §8 Table view, 02b-D33, E-7 | comp with approval: `02b-comp.spec.ts`. **Comp it? not driven** (needs a Void, disabled until 04, or the hub clock 30 min on) → unit tests + manual M11 |
| zone undo; zone refill | 02b §8 Table view (02b-C04), Zone stock (02b-S12) | `02b-zone.spec.ts` |
| open orders | 02b §8 Open orders (02-S07) | `02b-open-orders.spec.ts` |
| Bill / Clean queued (02a); online Ask for bill / Clean (02a gaps) | 02a §8 Offline, §3.13 | `02a-offline.spec.ts` (queued, then sent), `02b-bill.spec.ts` (online) |

Bugs found by task 28 and fixed in #201 (02b files, failing-first tests): the order screen's table name doubled ("R001 + R001"); the table view's orders part reset on every `StaffApp` render (whole-`shell` effect deps), losing the selected line and re-folding an opened served round.

## Hub gaps (`02-hub-gaps-plan.md`, branch `module-02-hub-gaps`)

| Task | Ruling | Title | Lane | Client fallback until merged | PR | State |
|---|---|---|---|---|---|---|
| H1 | Q-6 | Kitchen progress frames to staff + kiosks | HA | 27a3, 27b1: refetch on the order frames that do arrive + reconnect / visible | → `main` #173 | **on `main`** |
| H2 | Q-7 | `options` on `LineView`, `order_note` on `SeatingOrder` | HB | 27a1, 27a3, 26d: no options line / no note / item only | → `main` #173 | **on `main`** |
| H3 | Q-8, Q-27 | `GET /queries/order-view?order_id=` | HB | 27a1: Served / Not served from catch-up lines | → `main` #173 | **on `main`** |
| H4 | Q-9 | `placed_by` and `table_id` on open-orders | HC | 27b1: roster join; table via the map tile | → `main` #173 | **on `main`** |
| H5 | Q-10 | `SlipWarned` audience + catch-up `open_slips` | HA | 27a3: each late card answered alone | → `main` #173 | **on `main`** |
| H6 | Q-11 | Pending comp value and `pending_comp` per line | HB | 27a2: waiting card on this device only | → `main` #173 | **on `main`** |
| H7 | Q-12 | Caller name on the call-waiter display | HC | 23b: generic "F4 · Call" | → `main` #173 | **on `main`** |
| H8 | Q-13, Q-29 | Pair page sends non-KDS devices to `/staff/` | HC | 20a: none (manual open of `/staff/`) | → `main` #173 | **on `main`** |
| H9 | Q-19, Q-28 | Cloud comp chips without "Other" | HD | 27a2: a config chip `other` is not drawn | #121 | parked until module-04 (cloud 0013) is on `main` (Q-37); client fallback stays |
| H10 | Q-23, Q-34 | Cashier default `mark-served` + backfill | HD | 27a1: none (buttons by permission) | #126 | parked until module-04 (cloud 0013) is on `main` (Q-37); client fallback stays |

## Readings (AD rows, proposed — owner confirms)

| # | Reading | Where | State |
|---|---|---|---|
| AD-C1 | The zone / comp alert cards (02b-C03 `CompRequests`, 02b-C05 `ZoneAlert`) are built in 23b (lane D, which owns every `A/*` edit, Q-25) instead of lane L. | plan 23b, Self-review | proposed |
| AD-C2 | 27a3 and 26b start once a merged 02a task proves the contract (22a, 23a in `module-02a-client`), without importing its code; they test against fakes of the W0 contract. | plan Branches "Cross-module rule" | proposed |
| AD-C3 | The review m7 refetch filter for the map (which frames trigger a `table-map` read) needs a Q-5 text ruling; 21a ships the plan's list (Q-5, Q-35). | plan 21a, Self-review | proposed |
| AD-C4 | `EnqueueResult` gains `{ status: 'refused', error }`: the hub's definitive 4xx to a direct online send, shown by the caller. A 5xx, 426, 403 DEVICE_REVOKED, a network error or a lost 2xx body is never `refused`: `queued` with a queue registered (the entry stays, 02b §3.12), else `needs_hub` (`tables/contracts.ts`, `tables/errors.ts` `definitiveRefusal`). | W0.4 (#133) | proposed (integrator, review #133) |
| AD-C5 | `command()` options gain `actorId`, paired with `sessionToken` (the hub refuses actor_id ≠ the session's staff, `commands/route.ts:106`); a token without its person is refused locally (`CLIENT_SESSION_WITHOUT_ACTOR`, nothing sent). 25b passes the entry's `staff_id` as `actorId`. `X-Queued-At` = `Math.round` of the hub-clock value. | W0.4 (#133) | proposed (integrator, review #133) |
| AD-C6 | `staffApi.staffId()`: the signed-in person's staff id, read by the queue at enqueue time (stored as the entry's `staff_id`, Q-2). | W0.4 (#133) | proposed (integrator, review #133) |
| AD-C7 | **IR-1:** the selected floor is the hash query `#/tables?floor=<id>` (lane A writes, lane B reads; no W0 router edit). | 20b, 21b (#163, #160) | proposed (integrator, 2026-11-13) |
| AD-C8 | **IR-2:** the staff app lands on `#/tables` after sign-in (kiosk `#/`), 02a §8 / 02-S03. | 20b (#163) | proposed (integrator) |
| AD-C9 | **IR-3:** floors are wired into `StaffApp` after 21a merges (lane A small PR). | #170 | proposed (integrator) |
| AD-C10 | **IR-4:** handover waiting card seam — lane D owns `cards/pending-handovers.ts` (`remember()`) + `cards/WaitingCard.tsx`; lane C calls `remember()` after `RequestTableHandover` 200 and mounts `WaitingCard` in `TableSheet`. | #168, #175 | proposed (integrator) |
| AD-C11 | **IR-5:** `alertRows` + `onNewOrder` props on `TableMap`; lane A wires them in `StaffApp` (with IR-3); `onNewOrder` after 26d. | #160, #170 | proposed (integrator) |
| AD-C12 | **IR-6:** a `table-map` reply is dropped only if a read-triggering frame came after its request; a triggering frame during an in-flight read schedules one follow-up read (Q-5 reading). | 21a (#160) | proposed (integrator) |
| AD-C13 | **IR-7:** copy-to-new-order `Draft.cart = { copy_of: SubmitOrderPayload }`, converted on load by 26d; `QueuedSentCard` is mounted once at the `StaffApp` root, above `SignIn`, so sign-in drain and reconnect sends are caught (task 28 wiring). | 02b 25c, 26d | proposed (integrator) |
| AD-C14 | **IR-8:** `QueueEntry` gains optional `log_details` (W0 `orders/contracts.ts`, additive) for queue-log reasons; a `{ copy_of }` draft cart may carry additive `from_entry_id`. | 02b 25b, 25c, 26d | proposed (integrator) |
| AD-C15 | **IR-9:** idle TTL comes from the login reply's `idle_ttl_ms` if reachable without a W0 `api.ts` edit, else `GET /queries/session` is retried on reconnect / resume until it succeeds; counted from mount. | 02b 25d | proposed (integrator) |
| AD-C16 | **IR-10:** phone answer-sheet buttons are 64 px (spec floor 56; handoff `pulse-02.css` sets 64); plan 23b's "72 px" phone text is corrected in the plan's Close notes. | 23b, 24 (#168, #186) | proposed (integrator) |
| AD-C17 | **IR-11:** `LateAlertsContext` (open + closed alert rows) is wired by lane A in the task-28 `StaffApp` wiring; covers slips closed without `ItemsReleased`. | 02b 27a3, task 28 | proposed (integrator) |
| AD-C18 | **Process (second approvals):** for a HIGH PR where both first reviewers asked for changes (or one approved and one asked for changes), the "second approval" was a fresh re-check reviewer who mutation-verified every MAJOR of both reviews (#156, #159, #161, #162, #164, #165, #168, #171). | review process (Q-60) | proposed (integrator) |
| AD-C19 | **Process (gate in cloud sessions):** when the cloud VM's pnpm self-switch leaves a half-installed `~/.local/share/pnpm/.tools/pnpm/<v>` (turbo: "Exec format error"), the gate is run with `npm_config_manage_package_manager_versions=false` (the installed pnpm already is the pinned version). Environment only; nothing in the repo changes. | close lane, 2026-11-13 | proposed (integrator) |
| AD-C20 | **IR-12:** `EnqueueResult` `queued` gains additive `logged?: true` when the entry went straight to the queue log (session ended, or a 4xx the log keeps); 02a / 02b callers show "Not sent — see the queue log" instead of "Will be sent when the hub is back" (closes cleanup A-19). | wiring #193 | proposed (integrator) |
| AD-C21 | **Shell (additive, task 28 wiring):** `Shell` gains optional `idleTtlMs` (the login reply's `idle_ttl_ms`; the `GET /queries/session` read stays the fallback, IR-9) and `signOut()` (local sign-out, no hub call). The idle lock's Sign in waits at most 5 s (`SIGN_IN_WAIT_MS`) for drain + owed logout, then signs the page out; the owed logout stays in memory for the sign-in hooks. Unpair is guarded by a ref (one wipe) and closes New order. | wiring #193 (reviews) | proposed (integrator) |
| AD-C22 | **Queue revoke path:** the queue's `onDeviceRevoked` is the shell's unpair path (hub-admin `wipeDeviceKeys`, Pair again); queue.ts's own `wipePosDeviceKeys` copy is gone. `maxAgeMs` = the shell config's `queue_auto_send_max_ms` (null until read → the 01a default). | wiring #193 | proposed (integrator) |
| AD-C23 | **IR-13 (process):** PRs into `merge/02b-to-main` use the local full gate (summary posted on the PR); CI's `gate` (main / `module-*` only, not dispatchable from the lane token) runs on the final `merge/02b-to-main` → `main` PR. | close lane | proposed (integrator) |
| AD-C24 | **e2e fixture (task 28):** `global-setup.ts` uses the hub's 02b `fixtureMenu` + `openDay`, zone Cola, a paired kiosk and Ali's phone, `apply-comp` requiring the manager's approval; `FLOOR_SIZE` 120 and four flows appended to `FLOWS` (02a's table pairs unchanged). Two-device flows run a second browser context; the comp flow has a 90 s budget. | #201 | proposed (integrator) |

## STOPs / needs-ruling

| PR | Task | Question | State |
|---|---|---|---|
| — | — | none yet | — |
