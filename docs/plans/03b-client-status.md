# 03b KDS + Pass and 03c Printing — CLIENT build board

Plan: `03b-client-plan.md`. Gaps + rulings: `03b-client-gaps.md` (Q-42…Q-58; process Q-39, Q-41, Q-60, Q-61). Hub gaps: `03b-hub-gaps-plan.md` (HK1–HK6, branch `module-03b-hub-gaps`). Specs: 03b v1.0.8 §8, 03c v1.0.9 §8, 00 v1.9.2 §8.2. MINOR review findings: `03b-client-cleanup.md` (Q-60). Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-13: 02 W0 `main` pe hai (02a bhi, #187). `module-03b-client` ko `main` se sync kiya (#189, ek linear commit `243f691`, tree == `main`). W0.1 board shuru. Labels `needs-ruling`, `lane:W0`, `lane:A` pehle se; `lane:K`, `lane:P` naye bane.

## Branches

| Branch | Cut from | Takes PRs from | Merges into (owner) | State |
|---|---|---|---|---|
| `module-03b-client` | `main` after 02 W0 on `main` (Q-58); synced from `main` by #189 (`243f691`) | `lane-W0/<task>` (integrator), then `lane-{K,P,A}/<task>` | `main` | open, W0 done (#190 #191 #194, #212) |
| `module-03b-hub-gaps` | `origin/main` | `lane-K{A,B,C}/<task>` | `main` — any time, except HK4: with or after client W0.4 + K1 | HK1–HK6 merged into the branch; → `main` waits for K1 |

## Wave 0 (integrator, `module-03b-client`)

| Task | Title | RISK | Needs | PR | State |
|---|---|---|---|---|---|
| W0.1 | Branch, labels, board | — | 02 W0 on `main` | #190 | **merged** |
| W0.2 | `pulse-03.css`, `admin-03.css` into ui-kit + KDS kit | NORMAL | W0.1 | #190 | **merged** |
| W0.3 | Strings, both modules | NORMAL | W0.1 | #190 | **merged** |
| W0.4 | Entries `kds`, `admin-kitchen-screens`, `admin-printers` | NORMAL | W0.1 | #191 | **merged** |
| W0.5 | Contracts, slots extension, stubs | **HIGH** | W0.4 | #194 | **merged** |
| W0.6 | Pass route in the 02 shell + alerts labels hook (+ Q-66, IR-17, IR-17b, IR-22) | NORMAL | W0.5; 02b on `main` (#209); A5 (#210, IR-20b) | #212 | **merged** |

**W0 done** = W0.1–W0.6 merged into `module-03b-client`, CI green. Lanes K and A (A1–A4) start after W0.5; lane P and task A5 after W0.6.

## Lanes

| Lane | Tasks (in order) | Label | Owns (beyond the W0 stubs it replaces) | State |
|---|---|---|---|---|
| K (KDS) | K1 → K2 → K3 → K4 → K5 | `lane:K` | `K/**` except `K/contracts.ts`, `K/slots.ts`; `apps/client/kds/` | waits for W0.5 |
| P (Pass) | P1 → P2 → P3 → P4 → P5 | `lane:P` | `P/**` except `P/contracts.ts` | waits for W0.6 |
| A (admin, print, alert cards) | A1 → A2 → A3 → A4 → A5 | `lane:A` | `AK/**`, `AP/**`, `PR/**`, `A/labels-03b.ts`; `apps/client/admin-kitchen-screens/`, `apps/client/admin-printers/` | waits for W0.5 (A5: W0.6) |
| integrator | W0.1–W0.6, Z1, Z2 | `lane:W0` | docs, results | W0 done (#190 #191 #194, #212) |

Paths: `K/` = `apps/client/src/features/kds/`, `P/` = `…/pass/`, `PR/` = `…/print/`, `AK/` = `…/admin/kitchen-screens/`, `AP/` = `…/admin/printers/`, `A/` = `…/alerts/`, `S/` = `…/staff/`, `I/` = `apps/client/src/i18n/`.

## Lane K tasks

| Task | Title | RISK | Needs | Hub gap → fallback | PR | State |
|---|---|---|---|---|---|---|
| K1 | KDS entry, station session, socket, store | **HIGH** | W0.5 | HK4 → open `/kds/` by hand | #196 | done |
| K2 | Line card, Now / Next / Later, layouts | NORMAL | K1 | HK3 → identifier stale until reconnect | #200 | done |
| K3 | Start / Done / Undo, Give me more, batch, inline errors | NORMAL | K2 | — | #200 | done |
| K4 | Header, lanes, coming-up, day / archived / loading states | NORMAL | K3 | HK1 → lanes from own `SetLaneState` result; day state at next reconnect | #200 | done |
| K5 | Sounds and lock lines | NORMAL | K4 | HK1 → volume at next reconnect | #200 | done |

## Lane P tasks

| Task | Title | RISK | Needs | Hub gap → fallback | PR | State |
|---|---|---|---|---|---|---|
| P1 | Pass store, live frames, names | **HIGH** | W0.6 | HK2 → optional fields kept when present | #203 | done |
| P2 | Cards, readiness, station strip | NORMAL | P1 | HK2 → no HOLD hint; HK1 / HK3 as in the row | #204 | done |
| P3 | Ready / Undo, Hand over, screenless Start / Done | **HIGH** | P2 | HK2 → no screenless Start / Done | #205 | done |
| P4 | Takeover sections | NORMAL | P3; K2 merged | — | #208 | done |
| P5 | Pass states | NORMAL | P4 | — | #208 | done |

## Lane A tasks

| Task | Title | RISK | Needs | Hub gap → fallback | PR | State |
|---|---|---|---|---|---|---|
| A1 | Kitchen screens page | NORMAL | W0.5 | HK6 → ids; HK5 → open by URL | #195 | done |
| A2 | Printers page: printers, add / edit, archive, test | **HIGH** | A1 | HK5 → open by URL | #197 | done |
| A3 | Station outputs, print queue, warnings, paper preview | **HIGH** | A2 | HK6 → id | #198 | done |
| A4 | `printed` tag and Reprint through the slots (+ test helper `PR/test-fakes.ts`) | **HIGH** | A3; W0.5 slots | — | #199 | done |
| A5 | Alert cards and lock lines for 03b / 03c kinds | **HIGH** | A4; W0.6 | HK3 → "Moved" | #210 | done |

## Close (integrator)

| Task | What | Needs | State |
|---|---|---|---|
| Z1 | E2E (02 W0.7 Playwright, `pnpm test:e2e`, not in the gate): KDS 1920 / 1280, Pass landscape / portrait, admin laptop / phone, en + ur → `docs/reviews/03b-client-e2e.md` | K5, P5, A5 | done: 185 passed, 0 failed, 50 skipped (close PR; `docs/reviews/03b-client-e2e.md`) |
| Z2 | Board: E3-KDS AC1–AC10 client column, 03b #70–#76, 03c §8; README rows → Implemented after the owner merges; manual checks on pilot hardware only | Z1 | done in the close PR except the README rows (they wait for the owner's merge); MINORs in `03b-client-cleanup.md`, the engine gap in `03b-client-gaps.md`, hand checks in `03b-manual-checks.md` |

## Hub gaps (`03b-hub-gaps-plan.md`, branch `module-03b-hub-gaps`)

| Task | Ruling | Title | Lane | Client consumer → fallback until on `main` | State |
|---|---|---|---|---|---|
| HK1 (+HK1b) | Q-44, Q-49, Q-62 | Config frames (`LanesSet`, `StationScreenSet`, `BusinessDay*`) to station sockets + audience comment | KA | K4, K5, P2 → own command result / next reconnect | merged into `module-03b-hub-gaps` |
| HK2 | Q-45, Q-46 | `screenless`, `group_id`, `serve_mode` on the Pass view | KB | P2, P3 → no HOLD hint, no screenless Start / Done | merged into `module-03b-hub-gaps` |
| HK3 | Q-47 | Re-send details on table moves | KB | K2, P2, A5 → stale identifier until reconnect; "Moved" | merged into `module-03b-hub-gaps` |
| HK4 | Q-42 | `/kds/` entry and pair-page hand-off | KC | K1 → open `/kds/` by hand; **ships to `main` with or after W0.4 + K1** | merged into `module-03b-hub-gaps` |
| HK5 | Q-43 | Admin entries, side-nav, tiles, "Use as Pass tablet" | KC | A1, A2 → open by URL | merged into `module-03b-hub-gaps` |
| HK6 | Q-48 | Names in `kds-config` and `print-config` | KA | A1, A3 → ids | merged into `module-03b-hub-gaps` |

## Readings (AD rows, proposed — owner confirms; AD-K14…K29 are the integrator rulings IR-14…IR-25 and the lane close items)

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
| AD-K10 | **Q-66 (owner 2026-11-13 17:24 PKT, = (a)):** W0.6 edits, all additive: `S/shell/routes.tsx` (`{ name: 'pass' }`, `'/pass'`), `S/shell/slots.tsx` (one case → `P/PassScreen.tsx`), `S/tables/TopBar.tsx` (optional `pass` prop → "Pass" first in the nav), `S/StaffApp.tsx` (Pass live, nav state, landing on `#/pass`, the print-skip sender), `A/labels.ts` (import + `text03b` / `title03b` in `textOf` / `titleText`, `closedText03b` first in `closedText` with optional `kind` / `problem` / `moved_to`), `A/ui.tsx` (`PrintSkipContext`, card help line + Dismiss / "Stays until day close", closed line for the 03b kinds, `kind` / `problem` to `closedText`), `A/AnswerSheet.tsx` (`kind` / `problem` to `closedText`), `A/Banner.tsx` (IR-22 who line). No `A/labels-03b.ts` stub: A5 (#210) ships the real file first (IR-20b). | W0.6 | proposed (owner ruled Q-66) |
| AD-K11 | **IR-17 / IR-17b:** `StaffApp` makes the page's one `passLiveOf({ live, clock, api })` before the socket (its `useMemo` precedes the connection's), so the Pass sees the first catch-up; the socket's `onFrame` feeds `liveBus.frame(f)` then `pass.frame(f)` (point_lines, station_takeover, station_notice, station_plan, printed_lines). Clock and api are read at call time. | W0.6 | proposed (integrator) |
| AD-K12 | The landing on `#/pass` (handoff Q-6): a tablet's socket opens with the session, so its catch-up comes after sign-in's `navigate('/tables')`; the first `point_view` of the session moves the page to `#/pass` only while it is still on the `#/tables` landing (never away from a screen the person chose). | W0.6 | proposed |
| AD-K13 | `createPrintSkipDismiss` is made once per signed-in session (memo keyed on `api` + the session token); its refresh re-reads the inbox. A 03b / 03c action alert's closed row shows its closed line (`RowCard` showed it for requests only). | W0.6 | proposed |
| AD-K14 (IR-14) | The KDS 1280 layout's frame-inline rules live in `packages/ui-kit/components/kds-03-additions.css` (only frame-inline rules, e.g. `.kl--1280`), imported in `ui-kit-kds.ts` after `pulse-03.css`; `pulse-03.css` stays a byte copy. | integrator ruling IR-14, 2026-11-13 18:20 | proposed |
| AD-K15 (IR-15) | `registerPrintSlots(transport?: { command, orderTickets, canReprint })` is additive: the KDS (`KdsApp`) and the Pass (`PassScreen`) pass their session's transport after A4 merged; no argument = the `printed` tag only. | integrator ruling IR-15, 2026-11-13 19:00; #202, #204 | proposed |
| AD-K16 (IR-16) | Lane P starts before W0.6 and may merge before it; W0.6 holds only the `slots.tsx` route and the `labels.ts` hook. Owner Q-67: finish all of 03b and merge to `main`, then pause until Thursday. | integrator ruling IR-16, 2026-11-13 21:00 | proposed |
| AD-K17 (IR-17, IR-17b) | The Pass frame wiring is W0.6's, not lane P's: StaffApp creates `const pass = passLiveOf({ live: liveBus, clock, api })` once per page and `onFrame: f => { liveBus.frame(f); pass.frame(f); }`; a test proves `point_lines`, `station_takeover`, `station_notice`, `station_plan` and `printed_lines` reach the Pass. The Pass live is created BEFORE the socket opens (a Pass live created after a catch-up starts empty, no replay); W0.6 has a test for that order. | integrator rulings IR-17, IR-17b, 2026-11-13 | proposed |
| AD-K18 (IR-18, IR-18b) | Pass CSS is one `/* Pass (lane P), IR-18 */` block appended to `kds-03-additions.css` (`.pcards--1 {--pcols:1}`, the `PassLoading` size classes, `.pl__a--1`); no new file. Lane P adds one import of `kds-03-additions.css` to `ui-kit-staff.ts` (P2); every selector in the file is KDS / Pass scoped so nothing leaks onto the 02 screens (the reviewer checks it). | integrator rulings IR-18, IR-18b | proposed |
| AD-K19 (IR-19) | Additive optional `transport.session?()` in `PR/reprint.ts`; the `denied` flag is kept per session; the KDS is unchanged; open ids are kept. | integrator ruling IR-19; #204 | proposed |
| AD-K20 (IR-20, IR-20b) | A5 (#210) starts at once and merges BEFORE W0.6; W0.6 builds on top of it (hooks in labels / ui / AnswerSheet / Banner). W0.6 creates the Dismiss handler (`createPrintSkipDismiss`) once per signed-in session, not per render. | integrator rulings IR-20, IR-20b | proposed |
| AD-K21 (IR-21) | The Pass passes `hasPrinter={false}` to `K/LineRow` and renders the takeover actions (Reprint) itself; an optional `surface` prop on `LineRow` goes to the cleanup list. | integrator ruling IR-21; #208 | proposed |
| AD-K22 (IR-22) | The escalated-Ready banner on the Pass tablet is StaffApp's Banners plus A5's labels (lane A), not a Pass component. | integrator ruling IR-22 | proposed |
| AD-K23 (IR-13 for 03b) | Sync PR #209 (main with 02b into `module-03b-client`, 3d80592) was merged by the integrator on a green gate and a Sonnet APPROVE. PRs stacked on it were rebased onto it. | #209 | proposed |
| AD-K24 | A4's `order-tickets` cache reading (AD-K1) holds for the Pass as well: a catch-up makes every visible card read once more, an accepted burst. | #199, #204 | proposed |
| AD-K25 | KDS: the 1280 layout is chosen by `max-width: 1400px` (`COMPACT_QUERY`); the sound gain is the 01d gain times the station volume; a row error line lasts 5 s; buttons are two-tap until the station config is read; the branch config is re-read on every catch-up. | #200 (lane K close items) | proposed |
| AD-K26 | Command ids are kept across sign-out on the Pass (03c precedent): a second person's retry of the first person's lost tap replays the first command, and the Ready band names the second person. Known behaviour. | #205 re-check | proposed |
| AD-K27 | AD-C21 (02b, owner question at the 02b bump): the idle-lock Sign in has a 5 s bound in the client while the spec sets no limit. Same question carries to 03b's screens. | #206 | open question |
| AD-K28 (IR-23) | The KDS page's body class is `pos-root`, not `pos-staff`: bundle.css's `.pos-staff` is the name-tile grid and covered `main.kgrid` (Start / Done could not be clicked). Found by the Z1 e2e. | integrator ruling IR-23; #211 (c27981e) | proposed |
| AD-K29 (IR-25) | The printer card's ⋯ menu is anchored to its button (`admin-03-additions.css`; `admin-03.css` stays equal to the handoff file), so Archive is reachable by a real click. Found by the Z1 e2e. | integrator ruling IR-25; #213 (ec9f464d) | proposed |

## Acceptance (Z2; client column)

"Test" = vitest in the normal gate (`apps/client/src/features/...`, paths below are relative to it); "e2e" = `docs/reviews/03b-client-e2e.md` (not in the gate). Hub columns (tests 1–68) are the hub's own board `03b-status.md`.

### E3-KDS AC1–AC10 (03b v1.0.8 §10 Acceptance; story `stories-refined.md` E3-KDS)

| AC | Client proof | State |
|---|---|---|
| AC1 station view by URL; "all stations" = the Pass | `kds/KdsApp.test.tsx` (station session, page, StrictMode), `kds/session.test.ts`, `kds/store.test.ts`; Pass: `pass/store.test.ts`, `pass/cards/PassCard.test.tsx`; e2e `03b-kds` (pair → `/kds/`) | done |
| AC2 order (Now / Next / Later, never re-sorted) | `kds/station/StationView.test.tsx`, `kds/header/ComingUp.test.ts`; test #70 | done |
| AC3 ticket content and countdown | `kds/station/LineRow.test.tsx`, `kds/station/LineTimer.test.ts`; test #71 (skewed clock) | done |
| AC4 Start / Done big targets, inline confirm only | `kds/actions/actions.test.ts(x)`; e2e `03b-kds` (Start, "Done already?" inline, Done, Undo at 1920 and 1280) | done |
| AC5 sound + colour change | `kds/sound/sound.test.ts`, `kds/states/states.test.tsx` (lock line "Tap to turn on sound"); volume page: `admin/kitchen-screens/KitchenScreens.test.tsx`; e2e `03b-admin` (volume saved) | done; sound on real speakers is a hand check |
| AC6 late colouring | `kds/station/LineTimer.test.ts`, `LineRow.test.tsx` (word + colour); slip warning is 03a's | done |
| AC7 boosted ticket marker | `kds/station/LineRow.test.tsx` (mark tags: BOOST, RETURN, EXPEDITE on top) | done |
| AC8 batch station view | `kds/actions/actions.test.tsx` (one tap starts the load), `StationView.test.tsx` (`kgrid--batch`) | done |
| AC9 completion modes | `kds/actions/actions.test.ts` (`buttonFor` by mode) | done |
| AC10 HOLD AT PASS | `pass/cards/readiness.test.ts` (client readiness from `group_id` / `serve_mode`; AD-K6 fallback when absent); tests #67, #74 | done |

### 03b §10 client tests #70–#76

| # | Where | State |
|---|---|---|
| 70 station view order rules, `moved` tag, placeholders | `kds/station/StationView.test.tsx`, `LineRow.test.tsx` (#196, #200) | done |
| 71 late colouring with a skewed clock | `kds/station/LineTimer.test.ts` (#200) | done |
| 72 offline banner disables taps; `done` loser shows no error | `kds/KdsApp.test.tsx` "socket down → Reconnecting banner…", `kds/actions/actions.test.tsx` (#196, #200); e2e `03b-takeover` (second window, 4401 `replaced`) | done |
| 73 coming-up strip | `kds/header/ComingUp.test.ts` (#200) | done |
| 74 Pass readiness, HOLD hint, immediate green, takeover section renders and taps | `pass/cards/readiness.test.ts`, `PassCard.test.tsx`, `pass/takeover/takeover.test.tsx` (#204, #205, #208) | done; e2e: `03b-pass.spec.ts`, `03b-pass-takeover.spec.ts` |
| 75 config refetch on `BranchConfigApplied` | `kds/config.test.ts` (#200); Pass: `pass/store.test.ts` | done |
| 76 stores ignore line events of unknown ids | `kds/store.test.ts`, `pass/store.test.ts` (#196, #203) | done |

### 03c v1.0.9 §8 (client contract)

| §8 bullet | Client proof | State |
|---|---|---|
| Printers admin page (add, edit, archive, test; outputs; queue; warnings; no timer, Q-54) | `admin/printers/*.test.tsx`, `api.test.ts`, `output-modes.test.ts` (#197, #198); e2e `03b-admin` (fake LAN printer: Test print, add, loopback refused, archive) | done; one menu bug found (see e2e review) |
| KDS Reprint on `has_printer` stations, `printed` tag through the slots | `print/reprint.test.ts`, `printed.test.ts`, `tickets-cache.test.ts` (#199, #202); e2e `03b-kds` (Reprint answers on the card) | done |
| Pass card Reprint + takeover row Reprint | `print/reprint.test.ts`, `pass/takeover/takeover.test.tsx` (#204, #208) | done; e2e: `03b-pass-takeover.spec.ts` (takeover Reprint) |
| Printer alert card "{printer} · {problem}" (Q-57), Dismiss (Q-53) | A5 #210 | done |

## Process notes (integrator)

- For HIGH PRs where both first reviewers gave CHANGES, or one APPROVE and one CHANGES, the "second approval" was a fresh re-check reviewer who mutation-verified every MAJOR of both reviews (02 precedent: #156, #159, #161, #162, #164, #165, #168, #171; 03b: #202, #203, #205, #210).
- Reviewer prompts use a unique scratch path per reviewer (two reviewers shared `/tmp/rev-202` once).
- Q-65: at most 4 agents at once; Opus for HIGH print / reconnect paths, Sonnet for NORMAL.
- Hub gaps (HK1–HK7, branch `module-03b-hub-gaps`) are not on `module-03b-client`: the e2e (Z1) runs in the combined tree (client + hub-gaps hub files). `module-03b-hub-gaps` goes to `main` with or after this branch (HK4: the `/kds/` entry; HK7: `ship-client.sh` ships the three new builds, a pilot blocker).
- README 03b / 03c rows are NOT marked Implemented here; the integrator does that after the owner merges.

## STOPs / needs-ruling

Owner questions raised at close (details in `03b-client-cleanup.md` and `03b-manual-checks.md`): (1) admin pages have no page meta, so "checked / last printed / last seen" times are omitted: keep (00 v1.9.2 §8.2 as written) or add `pageMeta` (a 00 bump and a 2-line hub change); (2) `ForceMovedToMe` / SavePrinter without a version (concurrent admin edits) / the KDS old-window 4401 with no reason: spec or hub changes; (3) the printer card menu bug and the KDS body class bug found by Z1 (`03b-client-e2e.md`).
