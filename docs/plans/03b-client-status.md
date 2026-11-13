# 03b KDS + Pass and 03c Printing — CLIENT build board

Plan: `03b-client-plan.md`. Gaps + rulings: `03b-client-gaps.md` (Q-42…Q-58; process Q-39, Q-41, Q-60, Q-61). Hub gaps: `03b-hub-gaps-plan.md` (HK1–HK6, branch `module-03b-hub-gaps`). Specs: 03b v1.0.8 §8, 03c v1.0.9 §8, 00 v1.9.2 §8.2. MINOR review findings: `03b-client-cleanup.md` (Q-60). Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-13: 02 W0 `main` pe hai (02a bhi, #187). `module-03b-client` ko `main` se sync kiya (#189, ek linear commit `243f691`, tree == `main`). W0.1 board shuru. Labels `needs-ruling`, `lane:W0`, `lane:A` pehle se; `lane:K`, `lane:P` naye bane.

## Branches

| Branch | Cut from | Takes PRs from | Merges into (owner) | State |
|---|---|---|---|---|
| `module-03b-client` | `main` after 02 W0 on `main` (Q-58); synced from `main` by #189 (`243f691`) | `lane-W0/<task>` (integrator), then `lane-{K,P,A}/<task>` | `main` | open, W0 in progress |
| `module-03b-hub-gaps` | `origin/main` | `lane-K{A,B,C}/<task>` | `main` — any time, except HK4: with or after client W0.4 + K1 | HK1–HK6 merged into the branch; → `main` waits for K1 |

## Wave 0 (integrator, `module-03b-client`)

| Task | Title | RISK | Needs | PR | State |
|---|---|---|---|---|---|
| W0.1 | Branch, labels, board | — | 02 W0 on `main` | | in progress |
| W0.2 | `pulse-03.css`, `admin-03.css` into ui-kit + KDS kit | NORMAL | W0.1 | | todo |
| W0.3 | Strings, both modules | NORMAL | W0.1 | | todo |
| W0.4 | Entries `kds`, `admin-kitchen-screens`, `admin-printers` | NORMAL | W0.1 | | todo |
| W0.5 | Contracts, slots extension, stubs | **HIGH** | W0.4 | | todo |
| W0.6 | Pass route in the 02 shell + alerts labels hook | NORMAL | W0.5; 02 W0.6 + 02a 23b on `main` | | todo |

**W0 done** = W0.1–W0.6 merged into `module-03b-client`, CI green. Lanes K and A (A1–A4) start after W0.5; lane P and task A5 after W0.6.

## Lanes

| Lane | Tasks (in order) | Label | Owns (beyond the W0 stubs it replaces) | State |
|---|---|---|---|---|
| K (KDS) | K1 → K2 → K3 → K4 → K5 | `lane:K` | `K/**` except `K/contracts.ts`, `K/slots.ts`; `apps/client/kds/` | waits for W0.5 |
| P (Pass) | P1 → P2 → P3 → P4 → P5 | `lane:P` | `P/**` except `P/contracts.ts` | waits for W0.6 |
| A (admin, print, alert cards) | A1 → A2 → A3 → A4 → A5 | `lane:A` | `AK/**`, `AP/**`, `PR/**`, `A/labels-03b.ts`; `apps/client/admin-kitchen-screens/`, `apps/client/admin-printers/` | waits for W0.5 (A5: W0.6) |
| integrator | W0.1–W0.6, Z1, Z2 | `lane:W0` | docs, results | W0 in progress |

Paths: `K/` = `apps/client/src/features/kds/`, `P/` = `…/pass/`, `PR/` = `…/print/`, `AK/` = `…/admin/kitchen-screens/`, `AP/` = `…/admin/printers/`, `A/` = `…/alerts/`, `S/` = `…/staff/`, `I/` = `apps/client/src/i18n/`.

## Lane K tasks

| Task | Title | RISK | Needs | Hub gap → fallback | PR | State |
|---|---|---|---|---|---|---|
| K1 | KDS entry, station session, socket, store | **HIGH** | W0.5 | HK4 → open `/kds/` by hand | | todo |
| K2 | Line card, Now / Next / Later, layouts | NORMAL | K1 | HK3 → identifier stale until reconnect | | todo |
| K3 | Start / Done / Undo, Give me more, batch, inline errors | NORMAL | K2 | — | | todo |
| K4 | Header, lanes, coming-up, day / archived / loading states | NORMAL | K3 | HK1 → lanes from own `SetLaneState` result; day state at next reconnect | | todo |
| K5 | Sounds and lock lines | NORMAL | K4 | HK1 → volume at next reconnect | | todo |

## Lane P tasks

| Task | Title | RISK | Needs | Hub gap → fallback | PR | State |
|---|---|---|---|---|---|---|
| P1 | Pass store, live frames, names | **HIGH** | W0.6 | HK2 → optional fields kept when present | | todo |
| P2 | Cards, readiness, station strip | NORMAL | P1 | HK2 → no HOLD hint; HK1 / HK3 as in the row | | todo |
| P3 | Ready / Undo, Hand over, screenless Start / Done | **HIGH** | P2 | HK2 → no screenless Start / Done | | todo |
| P4 | Takeover sections | NORMAL | P3; K2 merged | — | | todo |
| P5 | Pass states | NORMAL | P4 | — | | todo |

## Lane A tasks

| Task | Title | RISK | Needs | Hub gap → fallback | PR | State |
|---|---|---|---|---|---|---|
| A1 | Kitchen screens page | NORMAL | W0.5 | HK6 → ids; HK5 → open by URL | | todo |
| A2 | Printers page: printers, add / edit, archive, test | **HIGH** | A1 | HK5 → open by URL | | todo |
| A3 | Station outputs, print queue, warnings, paper preview | **HIGH** | A2 | HK6 → id | | todo |
| A4 | `printed` tag and Reprint through the slots (+ test helper `PR/test-fakes.ts`) | **HIGH** | A3; W0.5 slots | — | | todo |
| A5 | Alert cards and lock lines for 03b / 03c kinds | **HIGH** | A4; W0.6 | HK3 → "Moved" | | todo |

## Close (integrator)

| Task | What | Needs | State |
|---|---|---|---|
| Z1 | E2E (02 W0.7 Playwright, `pnpm test:e2e`, not in the gate): KDS 1920 / 1280, Pass landscape / portrait, admin laptop / phone, en + ur → `docs/reviews/03b-client-e2e.md` | K5, P5, A5 | todo |
| Z2 | Board: E3-KDS AC1–AC10 client column, 03b #70–#76, 03c §8; README rows → Implemented after the owner merges; manual checks on pilot hardware only | Z1 | todo |

## Hub gaps (`03b-hub-gaps-plan.md`, branch `module-03b-hub-gaps`)

| Task | Ruling | Title | Lane | Client consumer → fallback until on `main` | State |
|---|---|---|---|---|---|
| HK1 (+HK1b) | Q-44, Q-49, Q-62 | Config frames (`LanesSet`, `StationScreenSet`, `BusinessDay*`) to station sockets + audience comment | KA | K4, K5, P2 → own command result / next reconnect | merged into `module-03b-hub-gaps` |
| HK2 | Q-45, Q-46 | `screenless`, `group_id`, `serve_mode` on the Pass view | KB | P2, P3 → no HOLD hint, no screenless Start / Done | merged into `module-03b-hub-gaps` |
| HK3 | Q-47 | Re-send details on table moves | KB | K2, P2, A5 → stale identifier until reconnect; "Moved" | merged into `module-03b-hub-gaps` |
| HK4 | Q-42 | `/kds/` entry and pair-page hand-off | KC | K1 → open `/kds/` by hand; **ships to `main` with or after W0.4 + K1** | merged into `module-03b-hub-gaps` |
| HK5 | Q-43 | Admin entries, side-nav, tiles, "Use as Pass tablet" | KC | A1, A2 → open by URL | merged into `module-03b-hub-gaps` |
| HK6 | Q-48 | Names in `kds-config` and `print-config` | KA | A1, A3 → ids | merged into `module-03b-hub-gaps` |

## Readings (AD rows, proposed — owner confirms)

| AD | Reading | Where | State |
|---|---|---|---|
| AD-K1 | A4's `order-tickets` cache key is the order id (Q-52). An order is re-read on a `FireDispatched` naming one of its lines. A catch-up (every reconnect) clears the whole cache, because fires can be missed while offline: each visible card then reads once more, an accepted burst. No timer. Entries are kept until the next catch-up (day scale). | plan A4, Self-review | proposed |
| AD-K2 | P2's fallback without HK2 (`group_id` / `serve_mode` absent) shows no HOLD AT PASS hint; each done line is green alone. | plan P2, Self-review | proposed |
| AD-K3 | W0.5 renames nothing in `K/slots.ts`: `PassCardAction.run` becomes async in place (`Promise<{ toast?: string } \| void>`). | plan W0.5, Self-review | proposed |
| AD-K4 | `apps/client/src/app/ui-kit-admin.ts` (tokens, bundle, `admin-03.css`) is the admin kit of the two 03b / 03c admin entries; `admin-03.css` is unscoped, so it is never in `ui-kit.ts`, the staff or the KDS kit. | W0.2 (#190) | proposed (integrator, review #190 accepted) |
| AD-K5 | The brief §6.6 print-queue keys `queue.*` are `print_queue.*` (02b owns `queue.*`, the queue log, `queue.title` "Not sent"). | W0.3 (#190) | proposed (integrator, review #190 accepted) |
| AD-K6 | The brief's `{m:ss}` placeholders are `{time}` (`kds.undo`, `kds.waiting`, `kds.cooking`, `kds.in`, `pass.undo_ready`): `fill()` takes `\w+` names (as 02 W0.3). `kds.changed` = "Already {stage}" + `kds.changed.served` / `.removed`. | W0.3 (#190) | proposed |
| AD-K7 | W0.4 creates the three entry stubs `K/main.tsx`, `AK/main.tsx`, `AP/main.tsx` (header "stub (W0.5)") because each `index.html` needs a module to build; W0.5 keeps them. | W0.4 (#191) | proposed |
| AD-K8 | W0.5 contracts: `KdsStore` / `PassStore` add `snapshot()` to the plan's `hold(ids)`, `apply(frame)`, `subscribe`; `hold(ids)` returns the held subset (Q-49). The Pass's Start / Done / Undo / Give me more / Lane use `KdsApi` on the staff session. `PR/register.ts` exports `registerPrintSlots()`, called once at module scope by each 03b screen entry (KDS: K1; Pass: P1). The catch-up part list is K1's / P1's (no shared constant). A catch-up replaces a store whole (`arrived_at` / `seen_at` emptied); `PointLinesFrame` is built on `WsPointLines`. | W0.5 | proposed |
| AD-K9 | `K/slots.ts` readers skip a slot function that throws, and `publishFrame` isolates a throwing subscriber; `runSlotAction(action)` is 03b's one caller of `run()` (`{}` when no toast; a throw → rejected promise). | W0.5 | proposed |

## STOPs / needs-ruling

None yet.
