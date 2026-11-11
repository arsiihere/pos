# 03b KDS + Pass — Implementation Plan (spec v1.0) — and the shared start for 03c

> **For agentic workers:** every task is TDD (failing test first, record the failure, then implement). One task = one branch = one PR into `module-03b` = one commit after review. Lanes run in **claude.ai/code cloud sessions**, the gate runs in **GitHub Actions** (`.github/workflows/gate.yml`). Prompts: `docs/plans/03b-03c-prompts.md`. Board: `docs/plans/03b-status.md`. 03c's lanes are in `docs/plans/03c-plan.md`; both modules share phase 0 and one integration branch.

**Goal:** build 03b v1.0.2 on the hub (station commands, KDS station view data, Pass / assembler data, Ready to serve / Handover / Served card, lanes, presence + Pass takeover, device roles, config reactions) and the upstream rows 0a–0g, then the clients once the design handoff exists.

**Spec:** `docs/specs/03b_KDS_Pass_Spec_v1.0.2.md` (APPROVED 2026-11-11; v1.0.1 = v1.0 + the gap-sweep wording G-1, G-3, G-4, G-5, G-10, G-13, G-14, owner 2026-11-11; v1.0.2 = v1.0.1 + wording only, 02b's bump is v1.0.6, AD-15; cited "§x", tests "#n"). Context: 03c v1.0.2 (shares phase 0), 02b v1.0.3 + its merged code, 03a v1.2, 01d v1.2.1, 00 v1.8. Read the cited section before each task; the plan never repeats spec rules. **Names:** `docs/plans/03b-03c-gaps.md` §1 "Exact names" is the truth for every function, signature, table, file and line; its G-rows (all ruled (a), owner 2026-11-11) are patched into the rows below.

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
- **Tests:** names cite the spec: `it('[03b #13] …')`; real tables and real events, never a mock of another lane's code (use `apps/hub/test/kds/fixtures.ts`, `apps/hub/test/print/fixtures.ts`, both built on 02b's `apps/hub/test/orders/fixtures.ts`: `FX`, `fixtureMenu`, `openDay`, `openSeating`, `appendOrder`); statement counts with `statementCounter(db)` wherever the spec states one; **no timing asserts** (inject clocks / timeouts).
- **Files:** only the files of your task row. A test that only pins a value an approved row changes (version, count, key list — G-9 class) may be edited by that row; list it under Readings in the PR body (owner 2026-11-11, AD-3 / AD-6 / AD-8 / AD-10 / AD-13). Anything else, a contract change, a spec–code mismatch, two specs disagreeing → **STOP**: put a STOP block in the PR body (what, where, options, your recommendation), add label `needs-ruling`, commit nothing for that clause, continue tasks that do not depend on it, and end the session when nothing is left. Never wait on an interactive question.
- **Readings** (you chose between two reasonable readings): list them in the PR body under "Readings"; the integrator copies them to the board as AD rows; the owner rules.
- **Events:** schema version 1, no session ids, times = `recorded_at`. **Logs:** ids and counts only, never names or phones.
- **Hub API names (gap sweep §1):** projections register with `projections.register({ name, eventTypes, apply(tx, e, mode), reset? })`, `mode` is `'live' | 'catchup'` (there is no `registerProjection`); `alerts.closeMany(ctx, [{ alert_id, reason }])` takes the reason per item; queries have no `permission` field — check the right inside `handle` (`ctx.directory.resolve(ctx.session.staff_id, …)`, pattern `queries/stock.ts:175-176`); station numbers come from `branchConfig().stations[]` (`capacity`, `lane_units`, `is_archived`, `point_id`), never from `StationLive` (no `lane_units`); per-commit work with the committed events uses `deps.writer.addAfterCommit((appended) => …)`; alert step targets are objects (`{ target: { kind: 'managers' }, set }`, G-14).

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

**Done 2026-11-11** (PR #2): 14 G-rows, all ruled (a) by the owner (G-3, G-12, G-14 explicitly approved); "Exact names" stay in `03b-03c-gaps.md` §1 (this plan points there); the rows below carry the rulings; specs 03b / 03c bumped to v1.0.1 with every ruling that changes their text (03b: G-1, G-3, G-4, G-5, G-10, G-13, G-14; 03c: G-7, G-8, G-14).

---

## Phase 0 — contracts and shared files (integrator, one session, sequential)

Everything any two lanes would both touch is written here, once. Each task is still one PR with CI.

| # | Task | Spec | Files | Tests first | Marker |
|---|---|---|---|---|---|
| P0.1 | Cut `module-03b` from `main`; labels `needs-ruling`, `lane:B1…B6`, `lane:C1…C4`; board. **CI hygiene (test-only, owner rulings G-11, G-12):** skip #124 when the run is root (`it.skipIf(process.getuid?.() === 0)` with a comment; CI as non-root still proves it); scratch-db pools get `pool.on('error', …)` (admin pool too; log, ignore 57P01) and the db name `pos_test_0005_<pid>_<counter>_<random>` (the sweep regex follows) | 00 §10 #124; 01b R-3 | `docs/plans/03b-status.md`; `apps/hub/test/db/pre-migrate-backup.int.test.ts` (Cross 00, G-11); `apps/cloud/test/helpers/scratch-db.ts` (Cross 01b, G-12) | #124 skipped as root, runs as non-root; scratch-db: a second `scratchDatabaseAt` in the same process never drops the first's db, an admin-terminated connection raises no unhandled error | Cross |
| P0.2 | **D-2 + D-3:** freeze `AlertDetailsBaseV2`, widen `AlertDetailsBase` (`identifier`, `station_name`, `printer_name`, `problem`, ≤ 40), `AlertRaised` v3 + identity upcaster + fixture; `ALERT_CONSTANTS.printer_alert_ms` (raise already writes `latestVersion('AlertRaised')`, no hub change) | 03b §4.5 D-2; 03c §4.4 D-3 | `packages/events/src/alerts.ts`, `packages/events/src/events/alert/`, `packages/events/src/index.ts`, `packages/domain/src/alert-constants.ts`; approved edit (G-9): `packages/domain/src/alert-constants.test.ts` (exact-object test gains `printer_alert_ms`) | v2 fixture still parses to the old shape; v3 keeps the four fields; upcaster v2 → v3 | Shared, Cross |
| P0.3 | **B-1:** `run-pass` (group `kitchen`, scope `branch`) in `PERMISSIONS` (Owner / Manager get it through `DEFAULT_ROLES`); Cook default grants `run-pass` + `reprint-ticket`. **No migration** (G-5: no CHECK on permission names exists, hub grants come only from directory sync); dev / pilot tenants are **re-seeded** (R29, release note, as 02p task 9). Labels `perm.run-pass` (G-6) | 03b §4.5 B-1 | `packages/domain/src/permissions.ts`, `apps/cloud/src/modules/staff-roles/default-roles.ts`, `apps/client/src/i18n/en.ts`, `apps/client/src/i18n/ur.ts` | #60 on `DEFAULT_ROLES` + a seeded tenant + hub directory apply; `apps/client/src/i18n/i18n.test.ts` stays green | Shared, Cross |
| P0.4 | **A-1 + B-2:** `ready_window_ms`, `kds_offline_ms` optional in `engine_settings` with hub defaults (`branchConfig()?.engine_settings.<key> ?? <default>`); `served_estimate_ms` range; owner settings PATCH / GET; cloud migration **`0012_kds_settings.sql`** (two columns + CHECKs, `served_estimate_ms` range CHECK, 180 000 on existing rows) | 03b §4.5 A-1, B-2 | `packages/events/src/config.ts`, `packages/events/src/admin/staff.ts`, `apps/cloud/src/modules/staff-roles/repository.ts` (`BRANCH_ENGINE_SETTING_KEYS`), `apps/cloud/src/modules/config-sync/builder.ts` (`:577` column list), `apps/cloud/src/db/migrations/0012_kds_settings.sql`; approved edits (G-9): `apps/cloud/test/staff-roles/branch-settings-engine.int.test.ts` (`:107-108` key list, `:173-178` AD-20 test inverted: now writable and range-checked), `apps/hub/test/sync/config-v4.int.test.ts` (`:38` key list) | defaults when absent; ranges 400; existing rows = 180 000 | Shared, Cross |
| P0.5 | **H-9:** `ConnectedSession.stationId` (`ws/server.ts:36-41`, built `:154-161`) | 03b §4.5 H-9 | `apps/hub/src/ws/server.ts`; approved edit (G-9): `apps/hub/test/ws/ws-publish.int.test.ts` (`:233-240` objects gain `stationId`) | a station socket lists its `stationId` | Cross |
| P0.6 | Error codes of 03b §9 and 03c §9 | §9 | `packages/domain/src/errors.ts` | codes + HTTP | Shared |
| P0.7 | Types: `kds.ts` (`UNDO_DONE_MS`, `LineDetail`, `Identifier`), `print.ts` (`Doc`) | 03b §4.4; 03c §3.6 | `packages/domain/src/{kds,print}.ts` | type tests | Shared |
| P0.8 | Event schemas (03b ×7 incl. `LanesSet`; 03c ×3) and WS frames (`kds_lines`, `point_lines`, `station_takeover`, `station_notice`, `printed_lines`) | 03b §6.22; 03c §6.11 | `packages/events/src/events/{order,station,hub}/`, `packages/events/src/ws.ts`, `packages/events/src/index.ts` | round-trip parse per event | Shared |
| P0.9 | Migrations **`0014_kds_pass.sql`**, **`0015_print.sql`** (hub; last on `main` is `0013_orders.sql`) | 03b §5; 03c §5 | `apps/hub/src/db/migrations/` | schema test: every index exists, CHECKs hold (`open_lines >= 0`, one live kitchen job) | HIGH |
| P0.10 | Kinds `ready_to_serve`, `served_card`, `kds_offline`, `printer_problem` (module top level); manager steps written **`{ target: { kind: 'managers' }, set: 'recipient' }`** (G-14, spec v1.0.1) | 03b §6.21; 03c §6.10 | `apps/hub/src/kds/kinds.ts`, `apps/hub/src/print/kinds.ts` | #53 / 03c #54: register at boot without throwing; details survive append | — |
| P0.11 | **Skeleton + contracts + wiring:** `kds/contracts.ts`, `print/contracts.ts` (every export of 03b §4.2 / 03c §4.2 as a typed function that throws `not built` until its task; hooks called by boot, the sweeper or the server are **no-ops**, never throws, until their task); `kds/index.ts` and `print/index.ts` (`registerKds(app, deps)`, `registerPrint(app, deps)`, `registerKdsProjections(projections)`, `registerPrintProjections(projections)`) importing one register file per lane (`kds/lanes/B1.ts … B6.ts`, `print/lanes/C1.ts … C4.ts`, empty). **Call sites (G-7, G-8):** `server.ts` — `registerKds`, `registerPrint` right after `registerOrders` (`:208`); `lib/boot.ts` `createDeps` and `test/helpers/test-hub.ts` — `registerKdsProjections`, `registerPrintProjections` after `registerOrdersProjection` (`boot.ts:313`, `test-hub.ts:72`; order 02b `orders` → kds → print); `print/boot.ts` — once-guarded `registerPrintBootSteps()` holding `registerBootStep('5', resumePrintQueue)` (no-op until c16), called from `main.ts` after `registerRestaurantBootSteps()`; `lib/boot.ts` — print worker start after listen next to `startTickLoop` (`:236`), its stop joined in `beat.stop` (`:237-242`) (H-11, no-op until c16); `auth/session-sweeper.ts` `purge()` — one call to `print/retention.ts` (no-op until c22), like `purgeAlerts`; client slots stub `apps/client/src/features/kds/slots.ts` | 03b §5 note, D12; 03c §3.5, §3.7 | as listed: `apps/hub/src/{kds,print}/…`, `apps/hub/src/server.ts`, `apps/hub/src/main.ts`, `apps/hub/src/lib/boot.ts`, `apps/hub/src/auth/session-sweeper.ts`, `apps/hub/test/helpers/test-hub.ts`, `apps/client/src/features/kds/slots.ts` | boot order assertion (#53 / 03c #10) via `Object.keys(projections.catchUp(db, branchId).replayed)`; a booted hub with every stub starts, listens and stops; slots render nothing when empty | HIGH, Cross |
| P0.12 | Test fixtures: `test/kds/fixtures.ts` on 02b's `test/orders/fixtures.ts` (`openDay`, `appendOrder`, `FX`): fire a line at a station, pair a `kds` device with / without `lane_label` and a tablet bound to a point (`pairDevice` has no such options: set `devices.point_id` / `lane_label` directly), a directory with a **Cook** role holding `run-pass` (`aDirectory` has none) and sign it in, serve / remove / void helpers; `test/print/fixtures.ts` (fake LAN printer with scripted status / stall / slow read; fake blocking USB device; fake clock) | — | as listed | fixtures self-test | — |
| P0.13 | **0d:** spec bumps with markers, one per target: Foundation v1.12, 00 v1.9, 01a v2.4, 01b v1.8, 01d v1.2.2, 02b v1.0.6 (AD-15: the specs said v1.0.4; wording fixed in 03b / 03c v1.0.2), 03a v1.2.1; README; S-1. (03b / 03c's own gap wording is already in v1.0.1); 01b v1.8 B-1 without the CHECK migration (G-5); 02b v1.0.4 also notes `orderCovered` (G-3) and `servedDrafts` (G-2) | 03b §4.5; 03c §4.4 | `docs/specs/*`, `docs/stories/stories-refined.md` | — (docs) | Cross |
| P0.14 | **G-3 (owner-approved):** pure `orderCovered(o: ScopedOrder, who: { staffId: string \| null; resolution: Resolution \| null }, tables: ReturnType<CurrentTableOf> \| null, floorsOf: (staffId: string) => string[]): boolean` (0 statements) in 02b's `mark-served.ts`; `checkOrderScope` becomes a wrapper over it (reads `currentTableOf` once, throws as today) — **02b behaviour unchanged**. Used by b15 (`Handover` receiver, `pass-receivers` with one shared `currentTableOf`). Needs: — (phase 0, after P0.13) | 03b §3.5 step 2, §6.8, §6.11; 02b §3.14 | `apps/hub/src/orders/commands/mark-served.ts`, `apps/hub/test/orders/order-covered.int.test.ts` | per scope (`branch`, `own_tables`, `my_floors`) × order type (dine-in, takeaway, parking): `orderCovered` = `checkOrderScope`'s verdict; 0 statements (`statementCounter`); 02b's `mark-served`, `release-boost`, `return-to-kitchen` tests unchanged and green | Cross |
| P0.F | **Review fixes (owner 2026-11-11):** 0012 bumps `config_version` (AD-9); `undoReadyForLines` comment (AD-14); `orderCovered` caller rule (grant first, #25); #60 Cook from `DEFAULT_ROLES`; `AlertRaisedPayloadV3` in raise / projection (AD-5); specs 03b / 03c v1.0.2 (AD-15); README / 01b wording; CLAUDE.md Foundation v1.12 (AD-17) | 03b §3.2, §3.5, §4.5 A-1, #60; 01d D-2 | as in its PR | config-sync after 0012 delivers the three keys; `orderCovered` parity for `requires_approval` | Cross |
| P0.15 | **B-2 ruling (a):** `BranchEngineSettings` gains `ready_window_ms`, `kds_offline_ms`, `served_estimate_ms` (writable, null = Off); owner page "Kitchen timing" three boxes; 01a marker bump | 03b §4.5 B-2 | `packages/events/src/admin/staff.ts`, cloud staff-roles tests, `apps/client/src/features/owner/branches/KitchenTiming.tsx`, i18n, `BranchSettings.test.tsx`, `docs/specs/*` | PATCH ranges ±1 → 400; PATCH bumps `config_version`, snapshot carries the value; one box per wire key, Off sends null | Shared, Cross, UI |

**Phase 0 done** when all 16 PRs (P0.1–P0.15, P0.F) are merged and CI on `module-03b` is green. Then open the lanes (prompts §3–§4).

---

## 03b lanes

"Needs" = tasks whose PR must be **merged** before this task starts (phase 0 is assumed). A lane runs its tasks top to bottom.

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Marker |
|---|---|---|---|---|---|---|---|
| **B1** config & devices | b5 | Projection `kds_config` (`projections.register`, `reset`): sound, lane mirror (exact `LanesSet`, inverse + ties, `custom`; station numbers from `branchConfig().stations[]`), day-open reset | §3.7, §3.8, §5 | `kds/config-projection.ts`, `kds/lanes/B1.ts` | #13 (mirror half), rebuild = live | — | HIGH |
| | b6 | Projection `device_roles` + memory maps (`devicePoint`, screen stations; refreshed in `writer.addAfterCommit` on `DeviceRoleSet`, `DevicePaired`, `DeviceRevoked`); **`registerTargetResolver('point', …)`** (G-1): unrevoked `tablet` devices with `devices.point_id` + the staff signed in on them, 1 batch statement | §3.1, §3.8; 01d §3.4 `point` | `kds/device-roles.ts`; approved edit (G-1): `apps/hub/test/alerts/send-test-alert.int.test.ts` (01d #17: a point target now raises instead of `points_not_available`) | #50 map refresh on role / pairing / revoke; point resolver: 1 statement, the point's tablets and their staff; `ready_to_serve` step 3 reaches them; 01d #17 updated | — | HIGH |
| | b7 | `SetStationScreen`, `SetDeviceRole` (admin) | §6.9–6.10 | `kds/commands/screen.ts`, `kds/commands/device-role.ts` | #50 | b6 | — |
| | b10 | `SetLaneState` (imports `liveStation` only; **own-station check inline**, `station_id ≠ ctx.actor.stationId` → `403 PERMISSION_DENIED`, plus the 4-line cap check of `set-station-capacity.ts:28-38`; does **not** call `requireStationInScope`, G-4; `lane_units` / `capacity` from `branchConfig().stations[]`) | §3.7, §6.5 | `kds/commands/lane-state.ts` | #11 (incl. a station session on another station → `PERMISSION_DENIED`), #12, #13 (command half, append order) | b5 | — |
| **B2** station commands | b8 | `StartItem`, `DoneItem` | §3.2, §6.1–6.2 | `kds/commands/start-done.ts`, `kds/lanes/B2.ts` | #1–#6, #10 | — | HIGH |
| | b9a | `UndoDone` (line part; calls contract `undoReadyForLines`), `GiveMeMore` | §3.2, §6.3–6.4 | `kds/commands/undo-done.ts`, `kds/commands/give-me-more.ts` | #7, #9 | b8 | — |
| **B3** details & KDS data | b11 | `buildLineDetails`, `pointOfLine`, identifier rules | §3.1, §4.2, §4.4 | `kds/details.ts`, `kds/lanes/B3.ts` | identifier per order type and P-1 "T" rule; parent / deal / options; 2 statements | — | — |
| | b18 | Catch-up `kds_station` (body builder exported for takeover), frame `kds_lines` (sent from `writer.addAfterCommit`) | §6.14, §6.16 | `ws/kds-catch-up.ts` | #65 (kds half), #66 | b11 | — |
| **B4** Pass core | b13 | Projection `pass` (`projections.register`, `reset`; idempotent settling, `open_lines` by rows changed; live units = `units − removed_units − voided_units`) | §3.5, §5 | `kds/pass-projection.ts`, `kds/lanes/B4.ts` | #30 | — | HIGH |
| | b14 | `MarkReadyToServe`, `UndoReadyToServe`. **Note (AD-14, owner 2026-11-11):** until b9b lands, b9a's `UndoDone` calls the no-op `undoReadyForLines` stub, so an UndoDone does **not** undo Ready (a Ready card stays standing); no test of b14 relies on it | §3.5, §6.6–6.7 | `kds/commands/ready.ts` | #20, #21, #23, #28 | b11, b13 | HIGH |
| | b15 | `Handover` (receiver: `directory.resolve(receiver, 'mark-served')` must be `grant === 'allowed'` **first**, then P0.14 `orderCovered`; either fails → `PASS_RECEIVER_INVALID`; `orderCovered` checks scope only and says yes for `requires_approval`), `pass-receivers` query (`run-pass` checked inside `handle`; a candidate is listed only with `grant === 'allowed'` on `mark-served` and `orderCovered`; one `scopedOrders` + one shared `currentTableOf` for every candidate, 3 statements) | §3.5 step 2, §6.8, §6.11 | `kds/commands/handover.ts`, `queries/pass-receivers.ts` | #24, #25 (incl. "receiver with `mark-served` `requires_approval` → 422 `PASS_RECEIVER_INVALID` / not listed"), #28 | b14, P0.14 | HIGH |
| | b9b | `undoReadyForLines` (the Ready part of UndoDone) | §3.2 step 5 | `kds/undo-ready.ts` | #8; after `provideKds` the registered `undoReadyForLines` is the real function, not the P0.11 no-op stub (an UndoDone on a Ready line now undoes Ready through the contract) | b9a, b14 | — |
| **B5** Pass ticks | b16 | Ticks `ready_retarget`, `pass_closures` (`registerTick` once per process; `alerts.closeMany(ctx, [{ alert_id, reason }])`) | §3.5, §6.18–6.19 | `kds/ticks.ts`, `kds/lanes/B5.ts` | #22, #26, #27 (card half) | b14, b15 | HIGH |
| | b17 | `handoversDue` | §4.2 | `kds/exports.ts` | #27 (export half) | b13 | — |
| | 0e | **To 02b:** tick `served_estimate` over `handoversDue` (G-2: 02b has no tick yet). Extract MarkServed's draft building (`ItemServed` + `OrderFoodServed` + the `stockEffects` split, `mark-served.ts:107-174`) into an exported `servedDrafts(state, lines, serves, envelope, source)` that `markServed` calls; the new tick uses it with `source: 'estimated'`; one `registerTick` line (once per process) | 03b §4.3; 02b §3.7, §6.11 | `apps/hub/src/orders/commands/mark-served.ts`, `apps/hub/src/orders/served-estimate-tick.ts` (new), `apps/hub/src/orders/index.ts` | estimate serves only unsettled handed lines; null setting = not due; 02b's `mark-served` tests unchanged and green | b17 | HIGH, Cross |
| **B6** presence & WS | b20 | Tick `kds_presence`, `stationPresence()`, takeover frames (`tx.onCommit` / `due`). **G-13:** a per-db host bound in `registerKds(app, deps)` holding `wsHubFor(app)` (the `bindFiresTick` pattern, `fires-tick.ts:48-53`; `due` finds it by `rawDbOf(db)`, `intents` by `tx.db`); `offline_since` starts at the first `kds_presence` `due` (the tick loop starts only after listen); tests call `due` / `intents` with an injected `now`; `alerts.closeMany(ctx, [{ alert_id, reason }])` | §3.6, §6.20 | `kds/presence.ts`, `kds/lanes/B6.ts` | #40–#44 | b6, b18 | HIGH |
| | b21 | Catch-up `point_view`, frames `point_lines` (from `writer.addAfterCommit`), `station_takeover` | §6.15–6.16 | `ws/point-catch-up.ts` | #65 (point half), #29 | b11, b13, b20 | — |
| | b22 | Event audiences (incl. takeover set); audiences are OR-ed, 02b already sends `ItemRemoved`, `ItemVoided`, `ItemServed`, `ItemReturned`, `ItemsReleased`, `OrderBoosted`, `OrderCancelled` to every staff socket and 03a sends `StationCapacitySet` to every socket (G-10: superset accepted) | §6.17 | `ws/kds-audiences.ts` | every listed event reaches the line's station socket and its point's Pass sockets (and the takeover set); **exactly** its sockets only for the types 03b alone serves (`ItemStarted`, `ItemDone`, `ItemDoneUndone`, `FireDispatched`, the 03b events) | b6, b20 | — |
| | b23 | Config hook (archived) + `station_notice`; `kds-config` query (`manage-devices` checked inside `handle`) | §3.10, §6.12 | `kds/config-hook.ts`, `queries/kds-config.ts` | #51, #52 | b6, b20 | — |

**03b hub: 14 phase-0 tasks (shared with 03c) + 19 lane tasks.**

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
| 1 | B1, B2, B3, B4, C1 | phase 0 (P0.1–P0.14) merged; b15 needs P0.14 |
| 2 | C2 (c11 encoder first) | as soon as one lane ends |
| 3 | B5 | b13 merged |
| 4 | B6 | b6 and b18 merged |
| 5 | C3 | c10 / c11 merged (c12, c13 may start earlier if a slot is free) |
| 6 | C4 | b20, c7, c14 merged |

## Self-review (writer, 2026-11-11)

- **Coverage:** 03b §11 0a–0g, 1–23 → P0.2–P0.13 and lanes B1–B6 (b12 kinds → P0.10; b19 split into b15 / b23); 24–41 → BU1–BU3, Z2. Every §10 test 1–75 is named in a row (client tests in BU rows).
- **No shared file in a lane:** each lane writes its own `lanes/<L>.ts` register file; boot lines, contracts, fixtures, schemas and migrations are phase 0.
- **Gap sweep closed (2026-11-11):** exact names in `03b-03c-gaps.md` §1; 14 G-rows ruled (a) and patched here (P0.1 CI hygiene G-11 / G-12, P0.2–P0.5 approved edits G-9, P0.3 G-5 / G-6, P0.9 numbers, P0.10 G-14, P0.11 G-7 / G-8, P0.13 other specs' bumps, P0.14 G-3, b6 G-1, b10 G-4, b15 G-3, 0e G-2, b20 G-13, b22 G-10).
