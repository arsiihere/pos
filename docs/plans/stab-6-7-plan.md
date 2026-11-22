# STAB-6 + STAB-7 plan: batch rounds in arrival order, then max delay → priority

Source (all **APPROVED by the owner 2026-11-22, "all recommendations approve start working on it"**):

| Spec | Version | What it adds |
|---|---|---|
| 03a Timing Engine | v1.2.8 | STAB-6 BQ-1–BQ-6 (§3.3, §3.5.3, §3.5.6, §3.10; tests 143–151); STAB-7 PR-1–PR-8 (§3.5.7, §3.6, §3.8, §3.9, §4.2; tests 152–161); `ENGINE_STATE_VERSION` 5 |
| 02b Ordering | v1.0.23 | §3.2 step 4a splits batch-station piece lines (and deals with a batch part) per unit; tests 37, 45 (changed), 56, 57 |
| 02b Ordering | v1.0.24 | §3.2 step 4b copies the effective max delay onto `ItemAdded.max_delay_ms`; §6.19; test 58 |
| 01a Restaurant Setup | v2.7.4 | rows MD-1–MD-6: `menu_items.max_delay_ms`, `max_delay_unlimited`, `branch_engine_settings.max_delay_default_ms`, cloud `0017_max_delay.sql`, snapshot keys, owner-app fields; tests #202–#205 |
| 01c Menu Variants | v1.1.3 | §4.3 `ItemAdded.max_delay_ms?` (additive); test 130 |
| 03b KDS + Pass | v1.0.13 | one row per batch round, the "Priority · n min late" chip, `LinePrioritized` audiences, Pass `load_id` / `priority`; tests 91–96 |
| 00 Foundation | v1.15 | (post-review M-1, approved 2026-11-23) §4.7 lifecycle row "Priority": a second, bounded displacement beside boost; no code of its own |
| 01b Staff and Roles | v1.10.2 | (post-review M-9, approved 2026-11-23) §6.10 `BranchEngineSettings.max_delay_default_ms`; test 115 |

Proposals: `docs/plans/stab-6-batch-rounds-proposal.md` (§9 and §10 owner questions 1–14 and F-1, all answered with the
recommendation), `docs/plans/stab-7-max-delay-proposal.md`. Bug rows: `docs/plans/stab-bugs.md` STAB-6, STAB-7.
No foundation change for STAB-6 (F-1 confirmed: "re-planned within slack" = a waiting round is re-placed as one unit); STAB-7 is in foundation v1.15 (review M-1).

**Before the build:** the hostile review `docs/reviews/stab-6-7_hostile_review.md` (verdict FIX) is answered: every
recommendation accepted by the owner 2026-11-23 ("sab recommendations"), the fixes folded into the same spec versions
(not yet built) plus foundation v1.15 and 01b v1.10.2 (its "Resolution" table). **Re-review next**, in a fresh
session; then build here. *Post-review (M-13):* the tasks below are reordered so the gate stays green after every
task: the v5 state bump and all its fields come first (task 5), an event is on the replay list in the same task as
its fold (task 16), and no writer comes before its fold (task 23 after 16).

Rules (CLAUDE.md, owner 2026-11-22): one local branch `fix/stab-tablet-pairing`, no push, no PR until the owner asks.
TDD: the failing test first, then the code. One task per commit, the spec cited, e.g.
`feat(engine): batch queue walk in pass 1 [03a v1.2.8 §3.3 BQ-1, BQ-2; STAB-6]`. Each phase ends with the gate:
`TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`. No timing asserts in
the normal gate (03a AD-32).

## Release notes (owner answers)

- **One update, after hours (Q14).** STAB-6 and STAB-7 ship together as **one engine update**, installed on the hub
  after service. `ENGINE_STATE_VERSION` 5 makes the first boot skip the v4 snapshot and replay the whole log (D62;
  minutes at pilot volume). The cloud migration `0017_max_delay.sql` and the cloud build go out first (a hub on the old
  build ignores the new optional snapshot keys; R29), then the hub update.
- **Until it ships (Q8):** set the tandoor and the fryer (every batch station) to `single_tap` if the cook does not
  tap Start. That removes the slide, so the rounds stay in arrival order today (proposal §2, the single-tap run). The
  ×10 issue stays until phase 2 ships. Switch back to `two_tap` after the update if the owner wants.
- **Open orders (Q6):** orders open at the update keep their lines and rounds (no re-split); only new orders are split
  per unit on batch stations.
- **Not split now (Q5, reworded post-review m-1):** an option child or a deal part of quantity > 1 within one line or one
  deal unit stays one line (AD-4 rounds); a deal of quantity n is still split per deal unit. Such a line is outside the
  arrival-order guarantee (03a BQ-1 scope).
- **Install only after the day close (post-review m-13):** start the v5 hub only after `BusinessDayClosed` and its
  day-close checkpoint are written (task 35 checks the checkpoint row first), so the v4 → v5 replay never rebuilds a
  mid-day log under BQ.
- `pnpm test:perf` (03a §7.1) is re-run by the owner on the real disk after phase 10 (more lines per order, the
  max-delay scenario 03a #172, review M-10); never in the cloud, never under `TMPDIR=/dev/shm`.

## Phase 0 — specs (done 2026-11-23)

0. **Post-review spec fixes** — foundation v1.15 (M-1), 01b v1.10.2 (M-9), and the in-place fixes of 03a v1.2.8, 02b
   v1.0.23 / v1.0.24, 01a v2.7.4, 01c v1.1.3, 03b v1.0.13; review "Resolution" table. Docs only.
   `[00 v1.15 §4.7; 01b v1.10.2 §6.10; review]`

## Phase 1 — events and types (`@pos/events`, `@pos/domain`)

1. **`ItemAdded.max_delay_ms?`** — `z.number().int().min(60000).max(7200000).nullable().optional()` on `ItemAdded.v1.ts`
   (additive, no upcaster). Test 01c #130 (parses with 60 000, 7 200 000, `null`, absent; refuses `0`, `59999`,
   `7200001`, `-1`, `1.5`). `[01c v1.1.3 §4.3; 03a v1.2.8 §3.5.7 PR-1; STAB-7; review M-7]`
2. **`LinePrioritized` v1 schema only** — `{ order_id, group_id, order_item_ids: string[] (≥ 1), delay_ms, at_ms }` on
   the order stream (`LinePrioritized.v1.ts`, registry, fixture). Not on `ENGINE_REPLAY_EVENTS` yet (task 16), and no
   writer yet (task 23), so test 94 stays green. Test 03a #160 (fixture parse part) and the events registry test.
   `[03a v1.2.8 §4.2, §3.5.7 PR-3; STAB-7]`
3. **Snapshot keys** — `items[].max_delay_ms` (`number | null`), `items[].max_delay_unlimited` (`boolean`),
   `engine_settings.max_delay_default_ms` (`number | null`), all optional in `config.ts` (V4). The hub reader in
   `branchConfig()`: a **missing** key → `null` / `false` / `300000`; an explicit `null` default stays `null` (never
   `?? 300000`). Test 01a #204 (parser and reader part, both fixtures). `[01a v2.7.4 §4.3 MD-5; STAB-7; review M-8]`
4. **`BranchEngineSettings` wire** (01b owner settings) and `BRANCH_ENGINE_SETTING_KEYS` gain
   `max_delay_default_ms: number | null` (60 000–7 200 000). Test 01b #115 (wire and versions part), 01a #204 (wire
   part). `[01b v1.10.2 §6.10; 01a v2.7.4 §5.2a MD-2; STAB-7; review M-9]`

## Phase 2 — engine state v5 first (`packages/engine`)

5. **`ENGINE_STATE_VERSION` 4 → 5 with every v5 field** — failing #160 (version part: a v4 snapshot is skipped and the
   log replayed) and #56 (v5 key set): `EngineLine.max_delay_ms` (the `ItemAdded` copy, absent → `null`),
   `EngineLine.priority_at` (`null`), `EngineLine.arrived_at` (the listing event's `recorded_at`),
   `groups[g].priority_land_ms` / `priority_delay_ms` (`null`), `EngineState.priority_due` (`{}`), all folded with these
   defaults and read by nothing yet; new fixtures `engine-log.v5.json` / `engine-state.v5.json` and the v5 key-set
   entry (v4 entries untouched). The v5 fixtures are regenerated by later tasks of this plan until it ships (v5 is
   unreleased). `[03a v1.2.8 §3.3, §3.12; review M-13, B-1, B-2, M-3, M-10]`

## Phase 3 — engine A: the batch round queue (`packages/engine`, 03a v1.2.8 STAB-6)

6. **Test kit + #145 "3 now, 7 next"** — extend `packages/engine/test/batch-kit.ts` (capacity 8, cook 3 min, freeze
   2 min, keep 1 min, freshness 2 min, per-unit parts). #145 passes on v1.2.7 with parts (proposal §2), so it pins C.
   `[03a v1.2.8 §3.3 BQ-6, §10.3g #145]`
7. **Queue walk in `batchPass1`** — failing #143 (rounds in arrival order through a slide), #144 (a hidden load is
   never broken up; snapshot + replay = full replay), #147 (late queue keeps order whatever the weights; `capped`,
   `station_overload`). Rewrite `replan.ts` `batchPass1` as the BQ-2 walk over `(booked.start, load_id)`: `d(b)` (J7),
   `lo(b)`, `latestFit(lo, d − keep) ?? latestFit(lo, d) ?? earliestFit(max(t, s_prev − max_prep))`; drop the batch
   `overloadPlace` path. Replace exactly the tests named in 03a "Changes in v1.2.8" row 8 (m-12): `batch.test.ts`
   "a re-plan re-forms hidden loads …" and "the overload search keeps loads whole …"; rewrite `stock-folds.test.ts`
   "a partial void … re-forms the load …" and `fold-cost.test.ts` "naming: a batch flip re-forms …".
   `[03a v1.2.8 §3.3 BQ-1, BQ-2, §3.5.3, §3.5.6, §12.3 G4-1 #10; review m-12]`
8. **Membership and pull-in** — #146 (new lines never jump the queue; the idle-gap case before a pickup-held load,
   Q2), #148 (a void keeps the load; room not refilled from later loads, Q1; the pull-in order: queue order, then the
   arrival key, M-12), #150 (`StockAdded` program flip). Fix what fails.
   `[03a v1.2.8 §3.3 BQ-3, BQ-4, §3.6.1 item 1; review M-12]`
9. **Capacity shed as a cascade** — failing #149 (non-priority part): BQ-5 keeps members by the arrival key
   (`arrived_at`, `order_id`, index in `line_ids`) up to the capacity; the rest cascade down the queue, each over-full
   load passing its latest member on; a new load after the last queued load; a frozen load stays whole (P4) (Q4).
   `[03a v1.2.8 §3.10 BQ-5; review M-2, M-3, m-14]`
10. **Regression** — #151 (`single_tap` gives the same rounds), the arrival-order property of #143 on the #59 harness
    (with its BQ-1 scope exemptions, m-2), the full engine suite, the simulator scenarios.
    `[03a v1.2.8 §10.3g #143, #151; review m-2]`

## Phase 4 — 02b C: split per unit on batch stations (`apps/hub/src/orders/expand-parts.ts`)

11. **Batch line split** — failing #37 (batch case now split) and #56 (`eta-preview` and `SubmitOrder`: naan ×10 on a
    batch station whose next load holds 5 → 3 parts at the earlier `eta_ms`, 7 at the next); `expandParts` station
    type `=== 'slot'` → `∈ {slot, batch}`. `[02b v1.0.23 §3.2 step 4a; 03a v1.2.8 To 02 #12; STAB-6]`
12. **Deal with a batch part** — failing #45 (a deal ×2 whose chosen part cooks on a batch station is split per deal
    unit); same change for the deal's chosen part. A part of quantity > 1 inside one deal unit and an option child of
    quantity > 1 are not split (Q5, m-1). `[02b v1.0.23 §3.2 step 4a; STAB-6]`
13. **Cart row** — #57 client (naan ×10 → "3 ready ~2:10 PM · 7 ready ~2:14 PM"); expected to pass with the v1.0.21
    code. `[02b v1.0.23 §8, #57]`

## Phase 5 — engine STAB-7: due map, fold, placement, ordering (`packages/engine`, 03a v1.2.8 §3.5.7)

14. **`priority_due` and the crossing** — failing #153 (engine part, with the B-1 cases: a slip already open,
    `slip_threshold_ms: null`), #166 (boundary `>`, 60 000 minimum), #167 (far-cap part: `null` crosses at
    `MAX_DELAY_NO_LIMIT_MS`), #168 (only a waiting line drives: `E_w > F`), #171 (groups of additions and releases).
    `E_w`, `F`, `limit(g)`; the per-group map with `slip_due`'s upkeep, independent of every slip term;
    `getAlertIntents(...).prioritized` = the groups with `priority_due[g] ≤ now`; export `MAX_DELAY_NO_LIMIT_MS`.
    Extend #92 (property over `priority_due`) and #106 (per-group upkeep equals a full recompute). **Gate guard:**
    `next_alert_due_at` stays the slip minimum in this task; it takes the priority term in task 23, together with the
    writer, so no hub pass is due for a draft nobody writes (test 93 stays green).
    `[03a v1.2.8 §3.5.7 PR-1–PR-3, §3.8, §3.3; review B-1, M-7, M-10, M-11, m-3]`
15. **Priority order key** — unit test: the priority order (larger `priority_delay_ms`, then the arrival key, then
    `order_item_id`) as a pure comparator used by tasks 16–19. `[03a v1.2.8 §3.5.7 PR-4; review M-10]`
16. **`LinePrioritized` fold + replay list, slot placement with `priority_land_ms`** — failing #152 (the owner's
    example), #154 (sticky; no second event; `delay_ms` / `at_ms` not read; Start ends it), #155 (fragile and together
    across two re-plans, `priority_land_ms`), #157 (nothing cooking or frozen moves), #162 (slot part: a frozen line of
    another order is never moved), #169 (release keeps priority). In the **same task**: `LinePrioritized` on
    `ENGINE_REPLAY_EVENTS.order` and `ReplayEventType` (test 94 stays green because the fold case and the list land
    together), and `LinePrioritized` in #106's fold set (it moves other orders' hidden lines). `applyEvent` sets
    `priority_at`, `priority_delay_ms`, deletes `priority_due[g]`, runs one hold-and-fire loop per group against the
    fixed input (frozen lines included), stores `priority_land_ms`; `pass1Order` re-places priority groups first,
    each as one group toward `priority_land_ms`; a forced later land re-loops the group's other stations.
    `[03a v1.2.8 §3.5.7 PR-4, PR-5, PR-7, §3.5.3, §3.9, §3.12; review B-2, B-3, M-13]`
17. **Batch priority with the BQ walk** — failing #156 (cascade shed by arrival key), #162 (batch part: a frozen load
    keeps its members), #163 (arrival key, not join order), #164 (idle gap before a held round), #165 (fire, not end),
    #149 (priority part: BQ-5 keeps priority members first). `[03a v1.2.8 §3.5.7 PR-4 (batch), §3.10 BQ-5; review
    B-3, M-2–M-6]`
18. **Weights, boost and the order among priority groups** — failing #159 (weights order only non-priority lines; a
    boost may still go ahead, Q13) and #167 (order part: the larger delay first, ties by arrival).
    `[03a v1.2.8 §3.5.7 PR-4, PR-6; review M-10]`
19. **Auto-fill** — failing #158: `tick.ts` auto-fill takes eligible priority lines first, in the priority order, each
    from `d_p − max_early_ms`. `[03a v1.2.8 §3.6.1 item 2; review B-2, M-10]`
20. **Views** — failing #161: `stationView`, `stationPlan`, `groupReadiness` carry `priority { since_ms, minutes_late }`
    on priority lines only (`minutes_late = max(0, ceil((estimate − T) / 60 000))`, 0 for a group on time again).
    `[03a v1.2.8 §3.5.7 PR-8, §6.1h; review m-7]`
21. **Paused, stock, type change** — failing #170. `[03a v1.2.8 §3.5.7 PR-9; review m-15]`
22. **Simulator scenario** — #172 in the `test:perf` project only (report: priority share, p95 / max delay; assert only
    the far-cap bound and live = replay); its numbers go to the status board after the owner's run.
    `[03a v1.2.8 §10.6, #172; review M-10]`

## Phase 6 — hub writer (`apps/hub/src/engine-host/fires-alerts-tick.ts`), after the fold

23. **Write `LinePrioritized` in `fires_alerts`** — failing #153 (hub part: a `skipped` key still gets its
    `LinePrioritized`, `nextAlertDueAt` keeps the priority term) and #173 (the priority transaction is the pass's last;
    the slip carries the pre-priority estimate; isolation). Step 7 of 03a §6.2a: one transaction of its own, 0
    statements; an idle kitchen still opens none. In the same task `next_alert_due_at` becomes the minimum of
    `slip_due` and `priority_due` (#92 and #153 due parts). `[03a v1.2.8 §3.5.7 PR-3, §6.2a step 7; review B-1, m-5]`

## Phase 7 — 01a cloud setting and migration (`apps/cloud`)

24. **Migration `0017_max_delay.sql`** — failing #202: the three `ADD COLUMN`s with their CHECKs (60 000–7 200 000);
    existing rows `null` / `false` / `300000`; `config_version` + 1 for every branch; no audit row.
    `[01a v2.7.4 §5.2a MD-1–MD-3; review M-7]`
25. **Menu-item write and read** — failing #203: `POST` / `PATCH` `max_delay_ms`, `max_delay_unlimited` (range and the
    combination → `422 VALIDATION_FAILED { field: 'max_delay_ms' }`; every merged-row combination of MD-4; the no-op
    compare, bump, audit); `GET /v1/admin/menu`. `[01a v2.7.4 §6.14, §6.15, §6.11 MD-4; review M-7, m-11]`
26. **Branch setting + snapshot builder** — failing #204 and 01b #115: `max_delay_default_ms` through the owner settings
    `PATCH` (S26 no-op, `422` on the field, explicit `null` kept); the builder always sends the three keys.
    `[01a v2.7.4 §4.3, §5.2a MD-2, MD-5; 01b v1.10.2 §6.10; review M-8, M-9]`
27. **Owner app fields** — failing #205: item form "Max delay" next to "Can be ready early by" (empty = "Branch default
    (n min)", 0 refused, "No limit (priority after 30 min)"); branch settings "Default max delay"; English and Urdu.
    `[01a v2.7.4 §8.1 MD-6; review M-7, M-10]`

## Phase 8 — 02b copy of max delay (`apps/hub/src/orders/build-submit.ts`)

28. **Step 4b** — failing #58: every engine line (parts, option children, deal parts, additions) gets the effective
    value (unlimited → `null`; item; else the branch default, an explicit `null` kept; only a snapshot **without** the
    key → 300 000); a `deal` header `null`; a remake copies the served line's value.
    `[02b v1.0.24 §3.2 step 4b, §6.19; 03a v1.2.8 To 02 #13; review M-8]`

## Phase 9 — 03b screens (`apps/hub/src/kds`, `apps/hub/src/pass`, `apps/client/src/features/kds`, `.../pass`)

29. **Hub: Pass lines and audiences** — failing #91 (`point_view` / `point_lines` lines carry `load_id`, `priority`;
    `load_id` set before a fire too; statements unchanged) and #92 (`LinePrioritized` audiences).
    `[03b v1.0.13 §6.15, §6.16, §6.17; review m-8]`
30. **KDS rows per round** — failing #93: grouping key + `load_id` at a batch station, the station-wide round tag,
    Start on a row acts on its load only; slot unchanged (Q7). `[03b v1.0.13 §3.3; 03a v1.2.8 To 03b #9; review m-8]`
31. **KDS priority chip** — failing #94, #95: "Priority · n min late", "Priority" alone at 0, set at once by a
    `LinePrioritized` frame; the row never moves; a boost mark stays above it. `[03b v1.0.13 §3.3, §8; review m-7]`
32. **Pass rows and chip** — failing #96: card rows per round, the pick sheet stepper per row, the chip on cards and
    takeover sections. `[03b v1.0.13 §3.4]`

## Phase 10 — replay check, full gate and hand-off

33. **Property test live = replay** — extend the 03a property test (#59) with batch parts, capacity drops and
    `LinePrioritized` events; snapshot + replay = full replay with priority groups (`priority_land_ms`,
    `priority_delay_ms`, `priority_due` equal); the hub boot replay test after an update from v4 state (from a
    day-close checkpoint). `[03a v1.2.8 §10.2, §10.3g #160; review m-13]`
34. **Gate** — `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` green;
    `docs/plans/stab-bugs.md` STAB-6, STAB-7 → "fixed (gate green <date>); owner to test"; README rows "built".
35. **Owner checks (manual, not in the cloud):** `pnpm test:perf` on the real disk (with #172's report); the after-hours
    update on the hub (Q14): **first confirm the day's `BusinessDayClosed` and its day-close checkpoint row exist**
    (m-13), then install and time the full replay; then switch the batch stations back from the interim `single_tap`
    if wanted (Q8).
