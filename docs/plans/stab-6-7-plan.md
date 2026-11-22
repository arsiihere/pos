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

Proposals: `docs/plans/stab-6-batch-rounds-proposal.md` (§9 and §10 owner questions 1–14 and F-1, all answered with the
recommendation), `docs/plans/stab-7-max-delay-proposal.md`. Bug rows: `docs/plans/stab-bugs.md` STAB-6, STAB-7.
No foundation change (F-1 confirmed: "re-planned within slack" = a waiting round is re-placed as one unit).

**Before the build:** a hostile review of the six spec versions in a fresh session (`docs/reviews/`), fixes folded and
versions bumped if it finds anything. Then build here.

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
- **Not split now (Q5):** multi-unit option children and deal parts on a batch station stay one line (AD-4 rounds).
- `pnpm test:perf` (03a §7.1) is re-run by the owner on the real disk after phase 9 (more lines per order); never in
  the cloud, never under `TMPDIR=/dev/shm`.

## Phase 1 — events and types (`@pos/events`, `@pos/domain`)

1. **`ItemAdded.max_delay_ms?`** — `z.number().int().min(0).nullable().optional()` on `ItemAdded.v1.ts` (additive, no
   upcaster). Test 01c #130 (parses with a number, `null`, absent; refuses `-1`, `1.5`).
   `[01c v1.1.3 §4.3; 03a v1.2.8 §3.5.7 PR-1; STAB-7]`
2. **`LinePrioritized` v1** — `{ order_id, group_id, order_item_ids: string[] (≥ 1), delay_ms, at_ms }` on the order
   stream (`LinePrioritized.v1.ts`, registry, fixture). Test 03a #160 (fixture parse part) and the events registry
   test. `[03a v1.2.8 §4.2, §3.5.7 PR-3; STAB-7]`
3. **Snapshot keys** — `items[].max_delay_ms` (`number | null`), `items[].max_delay_unlimited` (`boolean`),
   `engine_settings.max_delay_default_ms` (`number | null`), all optional in `config.ts` (V4); the hub defaults
   (`null`, `false`, `300000`) in the `branchConfig()` reader. Test 01a #204 (parser part).
   `[01a v2.7.4 §4.3 MD-5; STAB-7]`
4. **`BranchEngineSettings` wire** (01b owner settings) gains `max_delay_default_ms: number | null`.
   Test 01a #204 (wire part). `[01a v2.7.4 §5.2a MD-2; STAB-7]`

## Phase 2 — engine A: the batch round queue (`packages/engine`, 03a v1.2.8 STAB-6)

5. **Test kit + #145 "3 now, 7 next"** — extend `packages/engine/test/batch-kit.ts` (capacity 8, cook 3 min, freeze
   2 min, keep 1 min, freshness 2 min, per-unit parts). #145 passes on v1.2.7 with parts (proposal §2), so it pins C.
   `[03a v1.2.8 §3.3 BQ-6, §10.3g #145]`
6. **Queue walk in `batchPass1`** — failing #143 (rounds in arrival order through a slide), #144 (a hidden load is
   never broken up; snapshot + replay = full replay), #147 (late queue keeps order whatever the weights; `capped`,
   `station_overload`). Rewrite `replan.ts` `batchPass1` as the BQ-2 walk over `(booked.start, load_id)`: `d(b)` (J7),
   `lo(b)`, `latestFit(lo, d − keep) ?? latestFit(lo, d) ?? earliestFit(max(t, s_prev − max_prep))`; drop the batch
   `overloadPlace` path; replace the two v1.2.7 tests that pinned the re-form and the batch Λ search.
   `[03a v1.2.8 §3.3 BQ-1, BQ-2, §3.5.3, §3.5.6, §12.3 G4-1 #10]`
7. **Membership cases** — #146 (new lines never jump the queue; the idle-gap case before a pickup-held load, Q2),
   #148 (a void keeps the load; room not refilled from later loads, Q1), #150 (`StockAdded` program flip). Expected to
   pass after task 6; fix what fails. `[03a v1.2.8 §3.3 BQ-3, BQ-4]`
8. **Capacity shed** — failing #149; the BQ-5 overflow walk (a hidden load over the new capacity keeps its first
   members by join order; the rest go to the next queued load with room, else a new load directly after; a frozen
   load stays whole, P4) (Q4). `[03a v1.2.8 §3.10 BQ-5]`
9. **Regression** — #151 (`single_tap` gives the same rounds) and the full engine suite; the simulator scenarios.
   `[03a v1.2.8 §10.3g #151]`

## Phase 3 — 02b C: split per unit on batch stations (`apps/hub/src/orders/expand-parts.ts`)

10. **Batch line split** — failing #37 (batch case now split) and #56 (`eta-preview` and `SubmitOrder`: naan ×10 on a
    batch station whose next load holds 5 → 3 parts at the earlier `eta_ms`, 7 at the next); `expandParts` station
    type `=== 'slot'` → `∈ {slot, batch}`. `[02b v1.0.23 §3.2 step 4a; 03a v1.2.8 To 02 #12; STAB-6]`
11. **Deal with a batch part** — failing #45 (a deal ×2 whose chosen part cooks on a batch station is split per deal
    unit); same change for the deal's chosen part. Option children and deal parts of more than one unit are not split
    (Q5). `[02b v1.0.23 §3.2 step 4a; STAB-6]`
12. **Cart row** — #57 client (naan ×10 → "3 ready ~2:10 PM · 7 ready ~2:14 PM"); expected to pass with the v1.0.21
    code. `[02b v1.0.23 §8, #57]`

## Phase 4 — engine STAB-7: limit, delay, trigger, fold, ordering (`packages/engine`, 03a v1.2.8 §3.5.7)

13. **State fields + fold of `ItemAdded`** — `EngineLine.max_delay_ms` (D25 copy, absent → `null`) and
    `EngineLine.priority_at` (`null`); not yet the version bump (task 22). Unit test on the fold.
    `[03a v1.2.8 §3.3, §3.5.7 PR-1]`
14. **Delay and crossing in `getAlertIntents` / `slip_due`** — failing #153: `delay = estimate(g) − T(g)` (§3.8's
    estimate); the crossing `slipCrossing(level = T + min waiting max_delay_ms)` kept in `slip_due[key]` for sync and
    immediate groups; `next_alert_due_at` exact; drafts pure; `null` / absent never cross. `[03a v1.2.8 §3.5.7 PR-2,
    PR-3, §3.6, §3.8]`
15. **Write it in `fires_alerts`** — the hub tick (`apps/hub/src/engine-host/fires-tick.ts`) appends the
    `LinePrioritized` drafts in their own transaction beside the slips; an idle kitchen still opens no transaction.
    Hub test in `apps/hub/test/engine/` (#153 hub part). `[03a v1.2.8 §3.5.7 PR-3, §6.2a]`
16. **`LinePrioritized` fold, slot placement** — failing #152 (the owner's example: table A's BBQ takes the next free
    grill unit ahead of table B's later BBQ; A's other waiting lines land with it; `T` and the promise unchanged),
    #154 (sticky; no second event; pass 1 never moves it later; Start ends it), #155 (fragile: never before
    `d − max_early_ms`), #157 (nothing cooking pre-empted). `applyEvent` sets `priority_at` on listed `added` lines and
    runs the §3.9 boost path for those lines only; `pass1Order` puts priority lines first (earliest fit).
    `[03a v1.2.8 §3.5.7 PR-4, PR-5, PR-7, §3.5.3, §3.9]`
17. **Batch priority with the BQ walk** — failing #156: the line joins the first unfired load of its program whose end
    ≥ its lower bound; a full load sheds its latest non-priority member through BQ-5's walk (Q12); no fired round
    changes. `[03a v1.2.8 §3.5.7 PR-4 (batch), §3.3 BQ-5]`
18. **Weights and boost** — failing #159: weights order only non-priority lines; a priority dine-in line goes ahead of a
    follow-up line of twice the weight; a boost of another order may still go ahead (Q13). `[03a v1.2.8 §3.5.7 PR-6]`
19. **Auto-fill** — failing #158: `tick.ts` auto-fill takes an eligible priority line before an older non-priority one.
    `[03a v1.2.8 §3.6.1 item 2]`
20. **Views** — failing #161: `stationView`, `stationPlan`, `groupReadiness` carry `priority { since_ms, minutes_late }`
    on priority lines only (`minutes_late = max(0, ceil(delay / 60 000))` at `now`). `[03a v1.2.8 §3.5.7 PR-8, §6.1h]`
21. **Replay filter** — `LinePrioritized` on `ENGINE_REPLAY_EVENTS.order` and `ReplayEventType` (test 94 list).
    `[03a v1.2.8 §3.12, §4.2]`

## Phase 5 — 01a cloud setting and migration (`apps/cloud`)

22. **Migration `0017_max_delay.sql`** — failing #202: the three `ADD COLUMN`s with their CHECKs; existing rows `null`
    / `false` / `300000`; `config_version` + 1 for every branch; no audit row. `[01a v2.7.4 §5.2a MD-1–MD-3]`
23. **Menu-item write and read** — failing #203: `POST` / `PATCH` `max_delay_ms`, `max_delay_unlimited` (the
    `422 VALIDATION_FAILED { field: 'max_delay_ms' }` combination, the no-op compare, bump, audit); `GET /v1/admin/menu`.
    `[01a v2.7.4 §6.14, §6.15, §6.11 MD-4]`
24. **Branch setting + snapshot builder** — failing #204: `max_delay_default_ms` through the owner settings `PATCH`
    (S26 no-op); the builder always sends the three keys. `[01a v2.7.4 §4.3, §5.2a MD-2, MD-5]`
25. **Owner app fields** — failing #205: item form "Max delay" next to "Can be ready early by" (empty = "Branch default
    (n min)", "No limit"); branch settings "Default max delay"; English and Urdu strings. `[01a v2.7.4 §8.1 MD-6]`

## Phase 6 — 02b copy of max delay (`apps/hub/src/orders/build-submit.ts`)

26. **Step 4b** — failing #58: every engine line (parts, option children, deal parts, additions) gets the effective
    value (unlimited → `null`; item; else branch default; snapshot without the key → 300 000); a `deal` header `null`;
    a remake copies the served line's value. `[02b v1.0.24 §3.2 step 4b, §6.19; 03a v1.2.8 To 02 #13]`

## Phase 7 — 03b screens (`apps/hub/src/kds`, `apps/hub/src/pass`, `apps/client/src/features/kds`, `.../pass`)

27. **Hub: Pass lines and audiences** — failing #91 (`point_view` / `point_lines` lines carry `load_id`, `priority`;
    statements unchanged) and #92 (`LinePrioritized` audiences: station sockets, point staff sockets, takeover point).
    `[03b v1.0.13 §6.15, §6.16, §6.17]`
28. **KDS rows per round** — failing #93: grouping key + `load_id` at a batch station, the round tag, Start on a row
    acts on its load only; slot unchanged (Q7). `[03b v1.0.13 §3.3; 03a v1.2.8 To 03b #9]`
29. **KDS priority chip** — failing #94, #95: "Priority · n min late" from `station_plan`, set at once by a
    `LinePrioritized` frame; the row never moves; a boost mark stays above it. `[03b v1.0.13 §3.3, §8; 03a To 03b #10]`
30. **Pass rows and chip** — failing #96: card rows per round, the pick sheet stepper per row, the chip on cards and
    takeover sections. `[03b v1.0.13 §3.4]`

## Phase 8 — state version 5 and the replay check

31. **`ENGINE_STATE_VERSION` 4 → 5** — failing #160: a v4 snapshot is skipped and the log replayed; the version
    key-set fixture lists `max_delay_ms`, `priority_at`; snapshot + replay = full replay with priority lines and with
    the batch queue. `[03a v1.2.8 §3.3, §3.12, §9, #160]`
32. **Property test live = replay** — extend the 03a property test (#59) with batch parts and `LinePrioritized`
    events; the hub boot replay test after an update from v4 state. `[03a v1.2.8 §10.2, §10.3g]`

## Phase 9 — full gate and hand-off

33. **Gate** — `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` green;
    `docs/plans/stab-bugs.md` STAB-6, STAB-7 → "fixed (gate green <date>); owner to test"; README rows "built".
34. **Owner checks (manual, not in the cloud):** `pnpm test:perf` on the real disk; the after-hours update on the hub
    (Q14) with the full replay timed; then switch the batch stations back from the interim `single_tap` if wanted (Q8).
