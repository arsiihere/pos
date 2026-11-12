# 02a + 02b CLIENT — build board

Plan: `02-client-plan.md`. Gaps + rulings: `02-client-gaps.md`. Hub gaps: `02-hub-gaps-plan.md` (H1–H10, branch `module-02-hub-gaps`). Specs: 02a v1.1.6 §8, 02b v1.0.11 §8 / §3.12 / §10. Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-12: W0 shuru — `module-02-client-shell` (= `main` @ `1961adf`) pe W0.1 board. Labels `needs-ruling`, `lane:W0`, `lane:A…D`, `lane:Q/O/T/L`, `lane:HA…HD` pehle se bane hue hain.

## Branches

| Branch | Cut from | Takes PRs from | Merges into (owner) | State |
|---|---|---|---|---|
| `module-02-client-shell` | `origin/main` @ `1961adf` | `lane-W0/<task>` | `main`, right after W0.7 | open |
| `module-02a-client` | `main` after the shell merge (Q-30) | `lane-{A,B,C,D}/<task>` | `main`, first | not cut |
| `module-02b-client` | the same `main` | `lane-{Q,O,T,L}/<task>` | `main`, after `module-02a-client` | not cut |
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
| 20a | Login resume and pair again | NORMAL | A | W0 (H8 hub) | | todo |
| 20b | Top bar and phone tabs | NORMAL | A | 20a | | todo |
| 21a | Map store and live refresh | NORMAL | B | W0 | | todo |
| 21b | Table map and tiles | NORMAL | B | 21a | | todo |
| 22a | Table sheet, busy, force release, take over | HIGH | C | W0 | | todo |
| 22b | Hand over, force move, move, join, split | HIGH | C | 22a | | todo |
| 22c | Call waiter, ask for bill, clean | HIGH | C | 22a | | todo |
| 23a | Lock hook and lock banners | HIGH | D | W0 | | todo |
| 23b | Handover cards, call card, all alerts edits | HIGH | D | 23a (H7 hub) | | todo |
| 23c | Offline bar and "Needs the hub" marks | NORMAL | D | 23a | | todo |
| 24 | 02a flows (Playwright) | NORMAL | A | 20a–23c | | todo |

## 02b tasks (`module-02b-client`)

| Task | Title | RISK | Lane | Needs | PR | State |
|---|---|---|---|---|---|---|
| 25a | Queue and draft stores (IndexedDB + memory) | HIGH | Q | W0 (incl. W0.7) | | todo |
| 25b | Queue core, replay and Enqueue | HIGH | Q | 25a | | todo |
| 25c | Queue log, sign-in line, shell hooks | HIGH | Q | 25b | | todo |
| 25d | Device idle lock and pending logout | HIGH | Q | 25c | | todo |
| 26a | Stock mirror and availability | NORMAL | O | W0 | | todo |
| 26b | Order screen, cart, live times | HIGH | O | 26a; (02a) 23a | | todo |
| 26c | Options, deal, weight, note sheets | HIGH | O | 26b | | todo |
| 26d | New order, Send, Hold, day not started | HIGH | O | 26c; (02b) 25b (H2 hub) | | todo |
| 27a1 | Order view, line rows, simple line actions | HIGH | T | W0 (H2, H3, H10 hub) | | todo |
| 27a2 | Send back, comp, "Comp it?", waiting card | HIGH | T | 27a1; (02b) 26d (H6, H9 hub) | | todo |
| 27a3 | Table view orders part, zone undo, late cards | HIGH | T | 27a2; (02a) 22a (H1, H2, H5 hub) | | todo |
| 27b1 | Open orders and kiosk home | NORMAL | L | W0 (H1, H4 hub) | | todo |
| 27b2 | Zone stock | NORMAL | L | 27b1 | | todo |
| 28 | 02b flows (Playwright, combined worktree) | NORMAL | integrator | 25a–27b2, 20a–23c | | todo |

## Close (integrator)

| Task | What | Needs | State |
|---|---|---|---|
| Z1 | Acceptance map (§8 bullets, §10 #35 / #36, 02a §12.1, H tasks or fallback) | 24, 28 | todo |
| Z2 | Manual checks on pilot hardware (`02-client-manual-checks.md`) | Z1 | todo |
| Z3 | PR `module-02a-client` → `main`, then `module-02b-client` → `main` (owner merges); `@combined` e2e on `main` | Z1 | todo |

## Hub gaps (`02-hub-gaps-plan.md`, branch `module-02-hub-gaps`)

| Task | Ruling | Title | Lane | Client fallback until merged | PR | State |
|---|---|---|---|---|---|---|
| H1 | Q-6 | Kitchen progress frames to staff + kiosks | HA | 27a3, 27b1: refetch on the order frames that do arrive + reconnect / visible | | todo |
| H2 | Q-7 | `options` on `LineView`, `order_note` on `SeatingOrder` | HB | 27a1, 27a3, 26d: no options line / no note / item only | | todo |
| H3 | Q-8, Q-27 | `GET /queries/order-view?order_id=` | HB | 27a1: Served / Not served from catch-up lines | | todo |
| H4 | Q-9 | `placed_by` and `table_id` on open-orders | HC | 27b1: roster join; table via the map tile | | todo |
| H5 | Q-10 | `SlipWarned` audience + catch-up `open_slips` | HA | 27a3: each late card answered alone | | todo |
| H6 | Q-11 | Pending comp value and `pending_comp` per line | HB | 27a2: waiting card on this device only | | todo |
| H7 | Q-12 | Caller name on the call-waiter display | HC | 23b: generic "F4 · Call" | | todo |
| H8 | Q-13, Q-29 | Pair page sends non-KDS devices to `/staff/` | HC | 20a: none (manual open of `/staff/`) | | todo |
| H9 | Q-19, Q-28 | Cloud comp chips without "Other" | HD | 27a2: a config chip `other` is not drawn | | todo |
| H10 | Q-23, Q-34 | Cashier default `mark-served` + backfill | HD | 27a1: none (buttons by permission) | | todo (Q-34 pending owner OK) |

## Readings (AD rows, proposed — owner confirms)

| # | Reading | Where | State |
|---|---|---|---|
| AD-C1 | The zone / comp alert cards (02b-C03 `CompRequests`, 02b-C05 `ZoneAlert`) are built in 23b (lane D, which owns every `A/*` edit, Q-25) instead of lane L. | plan 23b, Self-review | proposed |
| AD-C2 | 27a3 and 26b start once a merged 02a task proves the contract (22a, 23a in `module-02a-client`), without importing its code; they test against fakes of the W0 contract. | plan Branches "Cross-module rule" | proposed |
| AD-C3 | The review m7 refetch filter for the map (which frames trigger a `table-map` read) needs a Q-5 text ruling; 21a ships the plan's list (Q-5, Q-35). | plan 21a, Self-review | proposed |

## STOPs / needs-ruling

| PR | Task | Question | State |
|---|---|---|---|
| — | — | none yet | — |
