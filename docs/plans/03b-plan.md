# 03b KDS + Pass — Implementation Plan (spec v1.0) — and the shared start for 03c

> **For agentic workers:** every task is TDD (failing test first, record the failure, then implement). One task = one branch = one PR into `module-03b` = one commit after review. Lanes run in **claude.ai/code cloud sessions**, the gate runs in **GitHub Actions** (`.github/workflows/gate.yml`). Prompts: `docs/plans/03b-03c-prompts.md`. Board: `docs/plans/03b-status.md`. 03c's lanes are in `docs/plans/03c-plan.md`; both modules share phase 0 and one integration branch.

**Goal:** build 03b v1.0 on the hub (station commands, KDS station view data, Pass / assembler data, Ready to serve / Handover / Served card, lanes, presence + Pass takeover, device roles, config reactions) and the upstream rows 0a–0g, then the clients once the design handoff exists.

**Spec:** `docs/specs/03b_KDS_Pass_Spec_v1.0.md` (APPROVED 2026-11-11; cited "§x", tests "#n"). Context: 03c v1.0 (shares phase 0), 02b v1.0.3 + its merged code, 03a v1.2, 01d v1.2.1, 00 v1.8. Read the cited section before each task; the plan never repeats spec rules.

**Starting point:** `main` after **both** `module-02b` and `spec-03b` are merged (02b code; this plan, CI, cloud setup, CLAUDE.md). `module-03b` is cut from that `main` by the integrator in phase 0.

**What is different from 02b's plan (and why):**

| 02b did | 03b / 03c do | Why |
|---|---|---|
| Gaps found by lanes mid-build (AD-1–AD-36, ≥ 6 lane STOPs) | **Gap sweep before phase 0** (`03b-03c-gaps.md`), owner rules once | The biggest time sink in 02b was lanes waiting on rulings |
| Waves: every lane waits for the whole previous wave | **Dependencies per task** (column "Needs"); a task starts when its needs are merged | Fewer idle lanes |
| Lanes edited shared wiring under markers | **Phase 0 writes every shared file once** (contracts, register files per lane, boot lines, fixtures, schemas, migrations, kinds) | No merge conflicts; more lanes at once |
| Local worktrees, local tags polled every 2 min, cherry-picks | **One PR per task**, CI gate per PR, rebase-merge | No manual landing; works across cloud VMs |
| Gate only by the integrator, ~10 min, serial | **Gate on every PR in GitHub Actions**, in parallel | Lanes never wait for a gate slot |
| Rulings in the lane terminal | **`needs-ruling` label + STOP block on the PR**, answered from the GitHub app | Owner answers from the phone; other lanes go on |

---

## Global rules (every task)

- **Branches:** integration branch `module-03b` (both modules). Task branch `lane-<L>/<task>` (e.g. `lane-B3/b11`). Base = `origin/module-03b`, or the lane's previous **unmerged** task branch (stacked; PR body says `Stacked on #<n>`). After a lower PR merges, rebase: `git rebase --onto origin/module-03b <old-base> <branch>` and `git push --force-with-lease` — **only on your own task branches**. Never push to `module-03b` or `main`; never force-push anything else.
- **PR:** title `<task>: <title> [03b §x]`; body: spec sections, tests added (with their failing-first output line), statement counts asserted, readings, `Needs: #…`. Label `lane:<L>`. Rebase-merge only (keeps the one task commit).
- **Commit:** one per task after review: `feat(03b): <title> [03b §x; §11 step N]` (03c: `feat(03c)`), author `Arslan Ahmed Arif <arsiiahmi@gmail.com>`. Review fixes are squashed into it before the PR is marked ready.
- **Review:** after the implementation, a **fresh reviewer subagent** (opus) reads the cited spec sections, the diff and these rules; RISK HIGH tasks get a second fresh reviewer focused on races / R8 / statement counts. Fix rounds > 2 → STOP.
- **Tests you run:** your own files (`TMPDIR=/dev/shm pnpm vitest run <files>`), `pnpm --filter @pos/hub typecheck` and `pnpm --filter @pos/hub typecheck:tests` (or the package you touched). **The full gate runs in CI**; do not run it in the lane.
- **Tests:** names cite the spec: `it('[03b #13] …')`; real tables and real events, never a mock of another lane's code (use `apps/hub/test/kds/fixtures.ts`, `apps/hub/test/print/fixtures.ts`); statement counts with `statementCounter(db)` wherever the spec states one; **no timing asserts** (inject clocks / timeouts).
- **Files:** only the files of your task row. Anything else, a contract change, a spec–code mismatch, two specs disagreeing → **STOP**: put a STOP block in the PR body (what, where, options, your recommendation), add label `needs-ruling`, commit nothing for that clause, continue tasks that do not depend on it, and end the session when nothing is left. Never wait on an interactive question.
- **Readings** (you chose between two reasonable readings): list them in the PR body under "Readings"; the integrator copies them to the board as AD rows; the owner rules.
- **Events:** schema version 1, no session ids, times = `recorded_at`. **Logs:** ids and counts only, never names or phones.

## Markers

| Marker | Meaning |
|---|---|
| **HIGH** | migration, projection, command with alerts / money / races, tick, worker. Two fresh reviewers. |
| **Shared** | `packages/domain`, `packages/events`, `packages/engine`. **Phase 0 only.** |
| **Cross** | An owner-approved file of another module (OQ-2 / R-4 list). Phase 0 or the named task only. |
| **UI** | Client. BLOCKED until `docs/design/handoff/03b/` exists. |

---

## Pre-flight — gap sweep (before phase 0; one cloud session)

Prompt §1 of `03b-03c-prompts.md`. Reads 03b / 03c v1.0 against `main` (02b merged) and writes `docs/plans/03b-03c-gaps.md`: every spec name, signature, export, event field, table, setting and test helper the tasks below use, checked against the code (file:line), and every mismatch as a G-row with options and a recommendation. The owner rules all G-rows in one pass. The integrator then writes the "Exact names" table into this plan (plan patch, commit `docs(03b): plan patch from gap sweep`).

---

## Phase 0 — contracts and shared files (integrator, one session, sequential)

Everything any two lanes would both touch is written here, once. Each task is still one PR with CI.

| # | Task | Spec | Files | Tests first | Marker |
|---|---|---|---|---|---|
| P0.1 | Cut `module-03b` from `main`; labels `needs-ruling`, `lane:B1…B6`, `lane:C1…C4`; board | — | `docs/plans/03b-status.md` | — | — |
| P0.2 | **D-2 + D-3:** freeze `AlertDetailsBaseV2`, widen `AlertDetailsBase` (`identifier`, `station_name`, `printer_name`, `problem`, ≤ 40), `AlertRaised` v3 + identity upcaster + fixture; `ALERT_CONSTANTS.printer_alert_ms` | 03b §4.5 D-2; 03c §4.4 D-3 | `packages/events/src/alerts.ts`, `packages/events/src/events/alert/`, `packages/domain/src/alert-constants.ts` | v2 fixture still parses to the old shape; v3 keeps the four fields; upcaster v2 → v3 | Shared, Cross |
| P0.3 | **B-1:** `run-pass` (kitchen, `branch`), Cook `run-pass` + `reprint-ticket` defaults, CHECK-expand migrations, re-seed | 03b §4.5 B-1 | `packages/domain/src/permissions.ts`, `apps/cloud/src/modules/staff-roles/default-roles.ts`, hub + cloud migrations | #60 | Shared, Cross |
| P0.4 | **A-1 + B-2:** `ready_window_ms`, `kds_offline_ms` optional in `engine_settings` with hub defaults; `served_estimate_ms` range; owner settings PATCH / GET; cloud migration 180 000 on existing rows | 03b §4.5 A-1, B-2 | `packages/events/src/config.ts`, `packages/events/src/admin/staff.ts`, 01a / 01b settings files, cloud migration | defaults when absent; ranges 400; existing rows = 180 000 | Shared, Cross |
| P0.5 | **H-9:** `ConnectedSession.stationId` | 03b §4.5 H-9 | `apps/hub/src/ws/server.ts` | a station socket lists its `stationId` | Cross |
| P0.6 | Error codes of 03b §9 and 03c §9 | §9 | `packages/domain/src/errors.ts` | codes + HTTP | Shared |
| P0.7 | Types: `kds.ts` (`UNDO_DONE_MS`, `LineDetail`, `Identifier`), `print.ts` (`Doc`) | 03b §4.4; 03c §3.6 | `packages/domain/src/{kds,print}.ts` | type tests | Shared |
| P0.8 | Event schemas (03b ×7 incl. `LanesSet`; 03c ×3) and WS frames (`kds_lines`, `point_lines`, `station_takeover`, `station_notice`, `printed_lines`) | 03b §6.22; 03c §6.11 | `packages/events/src/events/{order,station,hub}/`, `packages/events/src/ws.ts`, index | round-trip parse per event | Shared |
| P0.9 | Migrations `NNNN_kds_pass.sql`, `NNNN+1_print.sql` | 03b §5; 03c §5 | `apps/hub/src/db/migrations/` | schema test: every index exists, CHECKs hold (`open_lines >= 0`, one live kitchen job) | HIGH |
| P0.10 | Kinds `ready_to_serve`, `served_card`, `kds_offline`, `printer_problem` (module top level) | 03b §6.21; 03c §6.10 | `apps/hub/src/kds/kinds.ts`, `apps/hub/src/print/kinds.ts` | #53 / 03c #54: register at boot without throwing; details survive append | — |
| P0.11 | **Skeleton + contracts + wiring:** `kds/contracts.ts`, `print/contracts.ts` (every export of 03b §4.2 / 03c §4.2 as a typed function that throws `not built` until its task); `kds/index.ts` and `print/index.ts` importing one register file per lane (`kds/lanes/B1.ts … B6.ts`, `print/lanes/C1.ts … C4.ts`, empty); `lib/boot.ts` + `test/helpers/test-hub.ts`: projection order 02b `orders` → kds → print, `registerBootStep('5', resumePrintQueue)` call site, print worker start **after listen** (H-11, no-op until c16); client slots stub `apps/client/src/features/kds/slots.ts` | 03b §5 note, D12; 03c §3.7 | as listed | boot order assertion (#53 / 03c #10); slots render nothing when empty | HIGH, Cross |
| P0.12 | Test fixtures: `test/kds/fixtures.ts` (open day, fire a line at a station, pair a `kds` device with / without `lane_label`, bind a tablet to a point, sign in a `run-pass` cook, serve / remove / void helpers); `test/print/fixtures.ts` (fake LAN printer with scripted status / stall / slow read; fake blocking USB device; fake clock) | — | as listed | fixtures self-test | — |
| P0.13 | **0d:** spec bumps with markers, one per target: Foundation v1.12, 00 v1.9, 01a v2.4, 01b v1.8, 01d v1.2.2, 02b v1.0.4, 03a v1.2.1; README; S-1 | 03b §4.5; 03c §4.4 | `docs/specs/*`, `docs/stories/stories-refined.md` | — (docs) | Cross |

**Phase 0 done** when all 13 PRs are merged and CI on `module-03b` is green. Then open the lanes (prompts §3–§4).

---

## 03b lanes

"Needs" = tasks whose PR must be **merged** before this task starts (phase 0 is assumed). A lane runs its tasks top to bottom.

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Marker |
|---|---|---|---|---|---|---|---|
| **B1** config & devices | b5 | Projection `kds_config`: sound, lane mirror (exact `LanesSet`, inverse + ties, `custom`), day-open reset | §3.7, §3.8, §5 | `kds/config-projection.ts`, `kds/lanes/B1.ts` | #13 (mirror half), rebuild = live | — | HIGH |
| | b6 | Projection `device_roles` + memory maps (`devicePoint`, screen stations) | §3.1, §3.8 | `kds/device-roles.ts` | #50 map refresh on role / pairing / revoke | — | HIGH |
| | b7 | `SetStationScreen`, `SetDeviceRole` (admin) | §6.9–6.10 | `kds/commands/screen.ts`, `kds/commands/device-role.ts` | #50 | b6 | — |
| | b10 | `SetLaneState` (imports `liveStation`) | §3.7, §6.5 | `kds/commands/lane-state.ts` | #11, #12, #13 (command half, append order) | b5 | — |
| **B2** station commands | b8 | `StartItem`, `DoneItem` | §3.2, §6.1–6.2 | `kds/commands/start-done.ts`, `kds/lanes/B2.ts` | #1–#6, #10 | — | HIGH |
| | b9a | `UndoDone` (line part; calls contract `undoReadyForLines`), `GiveMeMore` | §3.2, §6.3–6.4 | `kds/commands/undo-done.ts`, `kds/commands/give-me-more.ts` | #7, #9 | b8 | — |
| **B3** details & KDS data | b11 | `buildLineDetails`, `pointOfLine`, identifier rules | §3.1, §4.2, §4.4 | `kds/details.ts`, `kds/lanes/B3.ts` | identifier per order type and P-1 "T" rule; parent / deal / options; 2 statements | — | — |
| | b18 | Catch-up `kds_station` (body builder exported for takeover), frame `kds_lines` | §6.14, §6.16 | `ws/kds-catch-up.ts` | #65 (kds half), #66 | b11 | — |
| **B4** Pass core | b13 | Projection `pass` (idempotent settling, `open_lines` by rows changed) | §3.5, §5 | `kds/pass-projection.ts`, `kds/lanes/B4.ts` | #30 | — | HIGH |
| | b14 | `MarkReadyToServe`, `UndoReadyToServe` | §3.5, §6.6–6.7 | `kds/commands/ready.ts` | #20, #21, #23, #28 | b11, b13 | HIGH |
| | b15 | `Handover` (02b `checkOrderScope` parity), `pass-receivers` query | §3.5, §6.8, §6.11 | `kds/commands/handover.ts`, `queries/pass-receivers.ts` | #24, #25, #28 | b14 | HIGH |
| | b9b | `undoReadyForLines` (the Ready part of UndoDone) | §3.2 step 5 | `kds/undo-ready.ts` | #8 | b9a, b14 | — |
| **B5** Pass ticks | b16 | Ticks `ready_retarget`, `pass_closures` | §3.5, §6.18–6.19 | `kds/ticks.ts`, `kds/lanes/B5.ts` | #22, #26, #27 (card half) | b14, b15 | HIGH |
| | b17 | `handoversDue` | §4.2 | `kds/exports.ts` | #27 (export half) | b13 | — |
| | 0e | **To 02b:** tick `served_estimate` over `handoversDue` | 03b §4.3 | 02b's `apps/hub/src/orders/` tick file | estimate serves only unsettled handed lines; null setting = not due | b17 | HIGH, Cross |
| **B6** presence & WS | b20 | Tick `kds_presence`, `stationPresence()`, takeover frames (`tx.onCommit` / `due`) | §3.6, §6.20 | `kds/presence.ts`, `kds/lanes/B6.ts` | #40–#44 | b6, b18 | HIGH |
| | b21 | Catch-up `point_view`, frames `point_lines`, `station_takeover` | §6.15–6.16 | `ws/point-catch-up.ts` | #65 (point half), #29 | b11, b13, b20 | — |
| | b22 | Event audiences (incl. takeover set) | §6.17 | `ws/kds-audiences.ts` | each event reaches exactly its sockets | b6, b20 | — |
| | b23 | Config hook (archived) + `station_notice`; `kds-config` query | §3.10, §6.12 | `kds/config-hook.ts`, `queries/kds-config.ts` | #51, #52 | b6, b20 | — |

**03b hub: 13 phase-0 tasks (shared with 03c) + 19 lane tasks.**

## 03b client — BLOCKED on `docs/design/handoff/03b/`

| Lane | Tasks | Files | Spec |
|---|---|---|---|
| BU1 KDS | shell + session, station view, line row + timers, marks / moved / placeholders, Start / Done / Undo / Give me more, sounds, banners + config refetch, coming-up strip, lane screen | `apps/client/src/features/kds/` | §3.3, §8; #70–#73, #75 |
| BU2 Pass | cards, readiness, Ready / Undo, hand-over tiles, screenless Start / Done + lanes, takeover sections | `apps/client/src/features/pass/` | §3.4, §3.6, §8; #74 |
| BU3 Admin | Kitchen screens page | `apps/client/src/features/admin/kitchen-screens/` | §3.8 |

Ask the designer now for: KDS station view, Pass screen (cards, hand-over tiles, takeover section), Kitchen screens admin page — the screen-first pitch rests on them.

## Close (integrator)

| # | Task | Needs |
|---|---|---|
| Z1 | Acceptance map in the board (every story AC and §12.2 row → green test names); README carried rows closed where the spec says | all 03b + 03c hub tasks |
| Z2 | `docs/plans/03b-manual-checks.md` (03b #41: pull a KDS cable mid-rush → takeover + alert, reconnect, lanes at day open) | Z1 |
| Z3 | PR `module-03b` → `main` (owner merges) | Z1, Z2 |

---

## Lane launch schedule (at most 5 lanes at once — plan usage)

| Step | Open | When |
|---|---|---|
| 1 | B1, B2, B3, B4, C1 | phase 0 merged |
| 2 | C2 (c11 encoder first) | as soon as one lane ends |
| 3 | B5 | b13 merged |
| 4 | B6 | b6 and b18 merged |
| 5 | C3 | c10 / c11 merged (c12, c13 may start earlier if a slot is free) |
| 6 | C4 | b20, c7, c14 merged |

## Self-review (writer, 2026-11-11)

- **Coverage:** 03b §11 0a–0g, 1–23 → P0.2–P0.13 and lanes B1–B6 (b12 kinds → P0.10; b19 split into b15 / b23); 24–41 → BU1–BU3, Z2. Every §10 test 1–75 is named in a row (client tests in BU rows).
- **No shared file in a lane:** each lane writes its own `lanes/<L>.ts` register file; boot lines, contracts, fixtures, schemas and migrations are phase 0.
- **Open until the gap sweep:** exact names of 02b's merged exports (`scopedOrders`, `checkOrderScope`, `registerOrdersProjection`, 02b tick file name), fixtures' helpers, migration numbers.
