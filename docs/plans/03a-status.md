# 03a status board

Plan: `docs/plans/03a-plan.md` (53 tasks, batches 0–11). Spec: `docs/specs/03a_Timing_Engine_Spec_v1.0.md`, with foundation v1.9, 00 v1.7 (H-1, H-5, H-6), 01a v2.1 (A-1–A-20; §12.3 Q-v2.1-1 / Q-v2.1-2 answered 2026-11-03), 01b v1.5 (B-1–B-8). Branch `module-03a`.

> **Short Hinglish summary — padhein yahan se**
>
> **Decision 2 check (2026-11-07, der raat):** aapke faislay ke mutabiq AD-35 ke baqi readings check kiye. 6 accept, lekin 3 spec ke text se takrate hain (22b-1 sender, 22b-4 test 83, 24-4 catch-up back-off). Aapke kehne par koi side nahi li aur ruk gaya: 01d bump aur task 23 abhi shuru nahi kiye. Upar MORNING REPORT mein teeno quotes hain.
>
> **Batch 9 ke baad (2026-11-07, raat):** tasks 19–22b aur 24 mukammal, gate green, clean §7.1 run poora pass (BF-7 38.7 ms, stations-live 2.5 ms). **Task 23 ruka hua hai:** 03a ka slip `details` (minutes_late, lines) 01d ke `AlertDetailsBase` mein fit nahi hota. Yeh spec ka faisla hai, aapka. Upar MORNING REPORT parhein.
>
> **Batch 5 ke baad (2026-11-07):** engine core poora (tasks 0–18). Gate ke tamam §7.1 numbers normal peak day par pass: re-plan p99 10.6 ms, replay 11.5 s. Sirf 2 test red hain: AD-27 ka 90 % floor (degh, karahi): yeh aapka faisla hai. Upar MORNING REPORT parhein. Batch 8 ke liye "go" ka intezaar hai.

## MORNING REPORT (2026-11-07, late night): STOPPED on your Decision 2 check, before the 01d bump

**What happened.** You ruled Decision 1 (widen 01d, v1.1.2) and Decision 2 (24-1 accepted; check the other AD-35 readings and stop on any contradiction). I checked every other AD-35 reading against 03a v1.0 and AD-1..AD-34.
- **Accepted, nothing contradicts them:** 22b-2, 22b-3, 22b-5, 24-2, 24-3, 24-5.
- **Three readings contradict the spec's text.** As instructed, I took no side and stopped, so the 01d bump, task 23, task 27 and the gates are not started. Nothing was built or changed since `9f2622d` apart from this board.

**The three contradictions (quotes from 03a v1.0):**
1. **22b-1, the plan-frame sender.**
   - §3.6.3 (line 441): the freeze-entry frame goes "through `ws.sendToDevices` (00 H-4)".
   - The code sends both freeze-entry and after-commit frames with `ws.sendToSessions` (00 AD-74).
   - Reason in code: `sendToDevices` also reaches a device's alert-mode socket, which 00 H-1 / F-6 limits to alert frames. So 03a §3.6.3's sender and 00 H-1's alert-mode rule conflict.
2. **22b-4, frames for unchanged plans.**
   - Test 83 (line 1057): "none for an unchanged station".
   - The fix for the line-only gap frames a station when any of its lines' references changed. That includes changes outside the plan body (draws, `reserved_seq`, a fired or cooking line), so a station whose `station_plan` is unchanged can get a frame.
   - The other way, framing only on station-reference changes, misses the frozen-line expedite. A body-field filter would meet both, but that is a choice for you.
3. **24-4, the catch-up back-off.**
   - §6.2 (line 852): "`due`: `firesDue(…).intents_due || configStale`"; step 1: "`configStale` → one `EngineConfigApplied` draft and **nothing else** in this pass … intents follow next pass on the folded state".
   - The code: after 3 non-committing catch-ups, `due` stops gating on `configStale` and ordinary passes compute intents on the pre-config state while the flag stays true; the catch-up retries every 60 s.
   - The batch 9 carried item ("a repeated catch-up throw must not block fires forever") came from the controller after the task 22 review, not from you. Read literally, the spec blocks fires for as long as E() or the append keeps failing.

**Ready for when you say go (recorded, not built):**
- **AD-36.** `AlertRaised` goes to **v2 + upcaster**: foundation §4.1 D46 says "when a payload shape changes, the new version gets a new Zod schema and an upcaster". Foundation §6 has no versioning rule of its own (§6.7 asks for a fixture per version).
- **The plan after your answers:**
  1. 01d v1.1.2 (changelog row, 'Changed by 03a' markers, "02p task 0 carries this into 01d v1.2"), plus the 'Changed by' note on 03a §3.8.
  2. Task 23 with `AlertDetailsBase` + `AlertRaised` v2 + `StrictCard` in its commit (TDD).
  3. Gate.
  4. Task 27.
  5. Gate.
  6. MORNING REPORT, then stop. Task 29 is not started; its as-built is 03a **v1.0.1**.

**Exact next step:** rule 1–3 above, for example "keep the code, fold at task 29" or "change the code to the spec". Then say go.

**Earlier for-you items still stand:**
- The cloud `stash@{0}` (commit `a621fdc`, restorable).
- The cloud pg `57P01` flake.
- Task 21's edit to hub2's A-14 test.
- Task 24's edits to 01a's sync tests.

Details are in the batch 9 entry and the previous report below.

## Earlier MORNING REPORT (2026-11-07, night): batches 8 and 9 done except task 23, STOPPED (stop rules 2 and 5)

**Head:** the docs commit at the top of `module-03a`, pushed. Code head `7b45d1b`.

**Stop reason.** Task 23 cannot be built without a spec change that crosses a module contract.
- 03a §3.8 (spec line 479) gives `slip_warning` `details_schema { minutes_late, lines: [{ name, quantity, state }] }`, citing 01d §3.12.
- 01d v1.1.1 §3.12 says every kind's `details_schema` "picks and requires fields from" `AlertDetailsBase = { item?, quantity?, amount?, reason? }`.
- The code enforces 01d. The `AlertRaised` v1 payload `details: AlertDetailsBase.nullable()` silently strips both fields (checked by parse). `ws-frames.ts:42` `StrictCard` (`AlertDetailsBase.strict()`) refuses them, so every slip card would fail `frame_invalid`.
- No reading keeps both rules. The implementer stopped and made no commit (stop rules 2 and 5).

**Your ruling, pick one:**
1. **(Recommended) Widen 01d and 03a by a spec bump.** `AlertDetailsBase` gains optional `minutes_late: int ≥ 0` and `lines: [{ name, quantity ≥ 1, state }]` (≤ some cap). They stay signed-in-card only, never in lock, alert-mode, device frames or logs (01d §7). The same change goes into `AlertRaised` v1 and `StrictCard`. You also decide whether adding optional nested fields keeps the event at v1 (old rows still parse) or needs `AlertRaised` v2.
2. **Re-word 03a §3.8 into the existing base.** `item` = the line names joined (≤ the string limit), `quantity` = the line count, `reason` = "N min late". 01d is untouched, but the per-line `state` is lost from the card.

**Done in batch 8 (19, 20, 21, 22, 22a; AD-34 follow-ups) and batch 9 (22b, 24):** every task passed a fresh opus review. Fix rounds:
- 22a: 2 rounds (the dropped-line alert across a crash and across a graceful restart).
- 22b: 1 round (frames for line-only changes).
- 24: 1 round (the catch-up kept clearing `configStale`).
- AD-34: none.

**Gate:** green at `7b45d1b`: 357 files passed (1 skipped), 3139 tests passed (1 skipped, 1 todo), 14 m 24 s. The batch 8 gate's first run had one cloud-lane flake (below).

**Clean §7.1 measurement (batch 8, idle machine):** every row passes.
- BF-7 max 38.7 ms and stations-live max 2.5 ms, so there is no 18d–20 slowdown and nothing to fix.
- Fires pass p99 11.2 ms; fires_alerts p99 10.6 ms; idle `due` 2.2 ms; re-plan p99 9.5 ms; replay 11.8 s.
- See the §7.1 table and the batch 8 entry.

**Questions for you:**
1. **Task 23's details contract** (above): it blocks 23 and therefore 27's full run.
2. **AD-35 (24-1).** Every forward config apply writes one `EngineConfigApplied`, a price-only one too, because §3.11's E() includes `config_version`. The fold then re-plans nothing and frames nothing. Test 70's "a price change → none" holds only at an equal version.
   - Recommendation: keep the literal reading and add an editorial note to test 70 at task 29.
   - Excluding the version would make boot step 6 see "stale" after every price change.
3. **AD-35 (22b-1).** The `station_plan` frame uses `sendToSessions`, not §3.6.3's `sendToDevices`, which would reach alert-mode sockets (00 H-1). Fold this at task 29?
4. **The rest of AD-35:** readings 22b-2 … 22b-5 and 24-2 … 24-5, proposed.

**For you, not blocking:**
- **The cloud lane's `stash@{0}` is gone from the stash list.** It was "On module-03a-cloud: partial before power cut 2". Its commit `a621fdc` is intact (dangling). If it is needed: `git stash store -m "On module-03a-cloud: partial before power cut 2" a621fdc`. The likely cause is the 22a implementer's `git stash push/pop -- apps/hub/src` during its RED run. Batch 9 implementers were told never to stash.
- **Cloud test flake.** `apps/cloud/test/db/staff-roles-migration.int.test.ts` once raised an unhandled pg `57P01` ("terminating connection due to administrator command"), most likely the scratch-DB helper's `DROP DATABASE … WITH (FORCE)` on an open client. The file passes alone, 3 of 3. It belongs to the cloud lane.
- **Task 21's fix edited hub2's A-14 test** in `business-day.int.test.ts`: it now subtracts the checkpoint statements.
- **Task 24 edited 01a's sync tests** (`config-hook`, `poller`, `poller-apply-failure`, `poller-directory`) to expect the new `EngineConfigApplied`. 01a §4.2 / S40 N2 allow the hook's append, so no 01a contract change.

**Exact next step:**
1. Rule on question 1 and bump the spec(s). Then task 23 runs: the real kinds in `engine-host/kinds.ts`, `details` in the slip input, the accept `apply` with goes-with pre-ticks.
   - Notes for 23: `test/engine/fakes.ts` kinds are skipped once the real ones register. #76 relies on the fake's `table_key max(64)`. `resetEngineKindFakes()` would unregister the real kinds. Move the fakes into `kinds.ts`.
2. Then batch 9's gate again, and task 27. The hub3 merge (`d4ee16a`) is present, so 27's precondition is met.
3. Answer questions 2–4 when convenient.

## Previous MORNING REPORT (2026-11-07, batch 5): answered by AD-29

**Result:** every §7.1 target measured so far passes on the normal peak day and the overload day. §12.5's incremental-insertion trigger did **not** fire. The gate is **red on exactly 2 tests**, both AD-27's measured 90 % utilisation floor: degh 86.24, karahi 89.89 (question 1).

### Simulator gate vs §7.1 (one official run, lanes idle, dev laptop, engine only)

| Target | Limit | Normal peak day | Overload day | Old day (before AD-27 / AD-28) |
|---|---|---|---|---|
| Re-plan per submit p99 | ≤ 50 ms | **10.6 ms** | **8.9 ms** | 448.1 ms |
| Overload probes | ≤ 16 | 7 | **7** (355 searches) | 3 |
| One day's replay from a checkpoint | ≤ 45 s | **11.5 s** | not asserted | 433.9 s |
| 2-day replay | ≤ 80 s | **26.0 s** | not asserted | 348.7 s |
| 20-line `StockAdded` at peak | ≤ 50 ms | **39.8 ms** | not asserted | 376.5 ms |
| Snapshot serialise | ≤ 50 ms | **4.8 ms** | not asserted | 36.5 ms |
| Events per day | 36k–54k | 38 304 | 39 181 | 51 134 |
| Live = replayed | equal | equal | not asserted | equal |
| Lines re-placed per station p99 | reported | 223 | 360 | 1 841 |

Extra, not gates: `stationsLive` 1.3 ms, `getTickIntents` 4.5 ms at peak (the real rows are tests 66 and 62, with host statements). `applyEvents` = per-event fold on the full day, same value and text.

**What these numbers do not say:**
- Dev laptop, engine only: no SQLite, WebSocket or alerts. The pilot box is task 28. BF-7's 39.8 ms has the least margin.
- One seed. A reviewer's slices on seeds 8, 11, 3 gave re-plan p99 12–15 ms and up to 13 probes, but these are slices, not gate numbers.
- A pass covers a day with one 125 % hour, not sustained overload. The old day (about 2.5× capacity at peak) would still be far slower, and it was not re-measured with `applyEvents`.
- Replay was measured at 38k events, 15 % below R6, and §7.1's row says ≈ 66k. Fold cost grows with state size, so do not scale 11.5 s linearly. Task 29 has to reconcile that row.

### Batches and commits (head of this report's commit on `module-03a`, pushed)
- **Batch 3:** `35ffd9d` … `f61ad5d`, **batch 4:** `afb53ef` … `dc92693`, see their entries below.
- **Batch 5:** 16 `3492171`, `ecc7c24` · 16b `ee9b076`, `83800d8` · 17 `2620148`, `3512fa5` · 18a `92b5965`, `c4bc1b0` · 18p `f22b88e`, `d00b7b3` · 18 `bb8595f`, `5846860`, `12022e5`, `d36375d` · 18b `78b2cdd`, `0caf794`, `7253e9b` · 18c `0e637a0`, `c678d6d` · 18t `91cc555` · docs `61feab3`, `d67dcc5`.

### Review fix rounds
| Task | Rounds | What the review caught |
|---|---|---|
| 8b, 9, 14 | 0 | 14 found two gaps no task owned → 14b |
| 13, 12, 12b, 15, 15b, 16, 17, 18a, 18p | 1 each | e.g. 15b an expedited plate landing 10+ min later; 16 a frozen line moving earlier; 17 a capacity drop over-booking |
| 16b | 1 (Minors) | a multi-line pull over-booking |
| 10, 14b | 2 each | 14b's second round fixed an error in the controller's own instruction |
| 18b, 18c | 18b 0, 18c 0 | Approved; cleanups went in `7253e9b`, `c678d6d` |

Not reviewed by a separate opus reviewer: **task 18's own commits** (`12022e5`, `d36375d`; the perf tests were read in 18b's review) and **18t's fix** `91cc555` (read by the controller; its fuzz was 6 000 legal seeds, 0 mismatches).

**Worth knowing:** 18t found a real bug legal events reach: a capacity change could lose a late-order alert key (1 seed in 1 000 under tight settings). Fixed.

### Gate
`flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`: typecheck and lint pass; 336 files passed, 1 failed, 1 skipped; 2 579 tests passed, **2 failed** (the two above), 2 skipped, 1 todo (`[03a BF-9]`); 30 m 43 s. The gate's perf numbers went to a scratch folder, so the official run stands.

### Questions for you
1. **Utilisation ruler (blocks a green gate).** Keep the clock-hour assert, or use the 10-minute window? Same run: clock hour bbq 90.63, degh **86.24**, karahi **89.89**, tandoor 92.52, tawa 92.13; window 93.43 / 93.61 / 90.78 / 92.53 / 92.13. A reviewer shifted the day's start by 20 min and the clock-hour reds disappeared, so they mostly show where the hour boundary falls. Recommendation: the window, as a ruling; nobody should "fix" this by moving the start.
2. **Confirm the day.** Degh 100 → 4 and tandoor 60 → 30 are within your ruling's words and make the day harder, but AD-27 names only lower demand. Degh 4 has no field basis (A14 still unknown), and the drill says two tandoors = 60. Only seed 7 of 20 meets the demand band; the mean wait 22 min and T − now < 2 h threshold are the implementer's. Report-only runs on seeds 8 and 11?
3. **AD-28 literal gap.** Not one copy per call: about 8–9 % of folds still copy `lines` (removal and re-plan). The purpose is met (fold 0.576 → 0.275 ms on a peak slice). Accept, or allow an in-place delete, which changes `slip_due` byte order but no result found (at most about 10 % more)?
4. **§7.1 upkeep row is still not fully met:** stage folds pass over all lines once (BF-14 (b); no index in v3), `ordersByKey` is O(open orders). Word it into §7.1 at task 29, or a spec-first index? Numbers now pass without it.
5. **Reused live line id.** Should `listLines` reject one (AD-8: strict throws, non-strict `invalid_event`)? Today it overwrites the line and leaves the state malformed. Recommendation: yes, and 02 should state who mints `order_item_id`.
6. **BF-9 / AD-2 vs tests #42, #118** (batch 4 entry): not built, `it.todo`. Rewrite those tests for AD-2, or take BF-9's accepted-cost option?
7. **Done or Served without a Start on a from-stock line:** no consume; units stay reserved up to 4 h. Should it consume?
8. **`sold_out` line when 0 < available < needed:** refused (AD-19), while 02 greys out only at 0. OK?
9. **Late-start rounding (AD-24 S1):** 03a §3.3 / F-20 say no rounding, F's pseudocode rounds. Which wins?
10. **§2 #5 "a config change never alters an open line" vs §3.11's "alternates, carry | from the next re-plan":** built per §3.11 (AD-25). Reconcile at task 29?
11. **Boost and marks (AD-23):** B3 a boosted delivery can land long before pickup; P8 a return queues on a FIFO station (vs Q15a); P9 a moved expedite line loses its follow-up weight; P4 an oversize load's slip estimate under-counts rounds.
12. **`pullEarly` returning `null` inside the limit (AD-24 E2):** 03b must handle it. OK?

### AD rows
- **Developer rulings:** AD-1, AD-2, AD-3, AD-4, AD-6, AD-12, AD-16, AD-27, AD-28.
- **Controller rulings, before the overnight rule (still proposed):** AD-5, AD-7, AD-8 (developer condition added), AD-9, AD-10 (developer note added), AD-11, AD-13, AD-14, AD-15.
- **Proposed (implementer, overnight), for you to rule on:** AD-17, AD-18, AD-19, AD-20, AD-21, AD-22, AD-23, AD-24, AD-25, AD-26.

### Open items
Open items list below (1–8). Carried to host tasks: 20 log and clear diagnostics, fold via `applyEvents` (`REPLAY_CHUNK` not yet exported); 22 check the checkpoint after the pass's fold; 22a `engine_line_dropped`, goes-with pre-ticks, dedupe `reserve_fallback`; 26 `stations-live` with in-flight lines; 29 fold AD rows, §10.6 days, §7.1 replay row, P-11 assert (270). Task 28 needs the pilot mini PC.

### Exact next step
1. Answer question 1 (the only one blocking a green gate) and tell me if question 2 changes the day.
2. **Allow the merge:** `.claude/settings.json:38` denies `Bash(git merge:*)`, which blocks your planned `git merge --no-ff origin/module-03a-cloud` before task 23. Allow it or run it yourself.
3. Say go for batch 8 (19–22a), 22b; before task 23 merge the cloud lane, resolve lockfile / test-registry conflicts only, rerun the gate; if C5 is not pushed yet, do 24 and R2 first.

**Stash note:** `stash@{0}` "partial before power cut 2" is on `module-03a-cloud`, the other lane's; I left it alone.

## Rules for this board

- One batch entry per checkpoint (format below), committed alone: `docs(03a): checkpoint batch N`, then `git push origin module-03a`.
- Gate per batch: `pnpm -w typecheck && pnpm -w lint && pnpm -w test` (controller only, one run at a time). The `perf` project is not part of `pnpm -w test`; it runs only via `pnpm test:perf`, inside a clean measurement (AD-32), and its numbers are copied into the §7.1 table at every checkpoint.
- **The gate (task 18):** no task of batch 6 or later starts until every §7.1 row below that task 18 measures is filled and green. A miss stops the build for a spec bump (03a §7.1, §12.5).
- Deviations are **proposed** `AD-n` rows here and in `docs/reviews/03a-auto-decisions.md`; folded into the spec only at task 29.

## §7.1 performance (gate: task 18; pilot box: task 28)

CI column: the one official run on the **normal peak day** (AD-27), 2026-11-07 09:23–09:28, head `91cc555`, other lanes idle, load 3.6 → 2.1, i7-4900MQ dev laptop; engine only, seed 7. Old-day figures in brackets are from before AD-27 / AD-28, on a shared machine. Raw: `.superpowers/sdd/03a-plan/task-18-numbers-normal-day-official.json` (its `day_policy_fifo` / `day_policy_edf` sections are stale old-day data: that step is off unless `POS_PERF_POLICY=1`).

| Path | Target | Drill (Python, seed 7) | CI (task 18) | Pilot box (task 28) |
|---|---|---|---|---|
| Re-plan per submit p99 | ≤ 50 ms | 641.3 ms (pessimistic, not the gate) | **pass 10.6 ms** (p50 3.5, max 20.6; n 2 000). Overload day p99 8.9 (old day: MISS 448.1) | — |
| Lines re-placed per station re-plan p50 / p99 / max | reported; CI bound set by P-11 | 60 / 650 / 685 | 23 / 223 / 240 (n 5 401). Overload day 39 / 360 / 385 (old day 414 / 1 841 / 1 894) | — |
| Re-placed-lines bound asserted (P-11) | `ceil(1.2 × p99 / 10) × 10` | — | 270 (`ceil(1.2 × 223 / 10) × 10`), asserted since task 18f (`6e92e59`) | — |
| Overload day (tandoor 125 %): probes / p99 | ≤ 16 / ≤ 50 ms | — | overload day per AD-27 (125 % for one hour): **pass** max 7 probes (355 searches) / **pass** 8.9 ms (max 55.6) (old definition: 3 / MISS 307.9) | — |
| 20-line `StockAdded` at peak (BF-7) | inside 50 ms | — | **pass** max 39.8 ms (p50 37.1; n 21; 20 flipped); batch 8 clean run max 38.7 ms (p50 36.7), so no slowdown from 18d–20 (old day: MISS 376.5) | — |
| Snapshot serialise (task 18) / full write (task 21) | ≤ 50 ms | — | **pass** max 4.8 ms (p50 3.5; 0.90 MB, 1 126 lines at peak) / full write (hub, `snapshots.perf.test.ts`, every sample ≤ 50 ms): **pass** in the batch 8 clean run (the value is not printed: the perf-hub setup swallows that `console.info`). Batch 8 serialise max 5.1 ms (old day 36.5, 4.54 MB) | — |
| Full-day replay from a checkpoint | ≤ 45 s | 284.7 s (Python) | **pass** 11.5 s (38 303 events, 0.30 ms per event) (old day, per-event fold: MISS 433.9) | — |
| 2-day replay (steps 2–3) | ≤ 80 s | — | **pass** 26.0 s (76 457 events; engine fold only, no SQLite read) (old day: MISS 348.7) | — |
| Events replayed per day | ≈ R6 ± 20 % | 65 876 | pass: 38 304 (−14.9 % on R6's 45k, AD-26) | — |
| Live = replayed (generated day) | equal | — | pass: end state and 76 mid-day digests equal; `applyEvents` = per-event fold, same value and same text, full day | — |
| `fires` pass with work p99 | ≤ 20 ms | — | **pass** p99 11.2 ms (p50 9.4; 31 passes; hub write + COMMIT, peak seq 26 609, 475 unfired, 4 drafts/pass), batch 8 clean run. Engine-only `getTickIntents` p99 7.0 ms | — |
| `fires_alerts` pass with work p99 | ≤ 20 ms | — | **pass** p99 10.6 ms (p50 7.3; 31 raise passes, 10 drafts each); idle `due` p99 2.2 ms (0 statements), batch 8 clean run | — |
| Crash restart ≤ 500 events (steps 2–3) | ≤ 2 s | — | (test 64) | — |
| `stations-live` | ≤ 5 ms, 0 statements | — | **pass** max 2.5 ms (p50 0.5; n 21; 98 in flight at the peak), batch 8 clean run; 0 statements (test 66) | — |
| Boot steps 4–8 | ≈ 10 s budget | — | — | — |
| `events_branch_stream` build over a month | ≈ 1 s / month | — | — | — |

## Tasks

| Task | Batch | RISK | Status | Commit | Tests | Note |
|---|---|---|---|---|---|---|
| 0 | 0 | NORMAL | DONE | `6fdf085` | — | autobuild rules, deny list, F §6.2 / 01a §9 appends |
| 1 | 1 | NORMAL | DONE | `2b317b5` | #103, #114 fixture | |
| 1b | 1 | NORMAL | DONE | `5b005d7` | [03a §4.2] | |
| 2 | 1 | NORMAL | DONE | `0bde005` | [03a §9] | |
| 3 | 1 | NORMAL | DONE | `462eb21`, `8f112be` | #56 | perf project created (P-4) |
| 4 | 1 | HIGH | DONE | `f0eba66` | [03a §3.3 profile], RF 1 | |
| 6 | 2 | HIGH | DONE | `f8826e6`, `0315dc1`, `316e9b6` | #16, #18, #19, #43, RF 4 | |
| 7 | 2 | HIGH | DONE | `ace2270` | #17, #31, F #1, #2, #5–#7, #10, BF-2 | |
| 8c | 2 | HIGH | DONE | `be5afc1`, `788c05d` | #51, #96, #115, #116, F #4, #8 | runs before 8 |
| 8 | 2 | HIGH | DONE | `aa1cc99`, `091b939` | #20–#23, #89, #91, #98, RF 2 | |
| 8a | 2 | HIGH | DONE | `8b2d209` | #75, #80, #114 engine | |
| 8b | 3 | HIGH | DONE | `35ffd9d` | #49, #78, #81, #99, #101 engine, #111 engine, BF-6 | |
| 9 | 3 | HIGH | DONE | `d1635e0` | #24, #25, #90 | |
| 10 | 3 | HIGH | DONE | `5bbf64b`, `b127a44`, `c9ebfc2` | #26, #27 | |
| 11 | 3 | HIGH | DONE | `2aee7e5`, `169d155` | #28–#30 | |
| 13 | 3 | HIGH | DONE | `565dcd3`, `f61ad5d` | #44, F #3, #9, #14, #15 | |
| 12 | 4 | HIGH | DONE | `afb53ef`, `4b4eb7b` | #39, #41, #74 engine, #102, #117, #119, 01a #129, BF-12, BF-13 | |
| 12b | 4 | HIGH | DONE | `ea6056c`, `51ef84a` | #40, #42, #84, #87, #88, #104, #105, #109, #118, BF-1, BF-7, BF-8, BF-9 | **BF-9 parked** (`it.todo`), developer question |
| 14 | 4 | HIGH | DONE | `f75d453` | #32, #52, #62 engine, #110, #111 tick, F #12, #13, BF-5, RF 3 | |
| 14b | 4 | HIGH | DONE | `1eb33e7`, `9e893c9`, `9bcd50a` | #62 boundary clause, F D42, `[03a AD-20]` | added overnight: `ReservationsShifted` fold, exited orders kept while reserved |
| 15 | 4 | HIGH | DONE | `249f91d`, `663ca0a` | #35, #36, #92, #106, BF-3, BF-4, BF-10, BF-14 | |
| 15b | 4 | NORMAL | DONE | `4e5fd86`, `dc92693` | #37, #38, #77 engine | |
| 16 | 5 | HIGH | DONE | `3492171`, `ecc7c24` | #34, #45, #97, #100, #107 engine, #108, F #11 | |
| 16b | 5 | NORMAL | DONE | `ee9b076`, `83800d8` | #33, #46–#48, #50 | |
| 17 | 5 | HIGH | DONE | `2620148`, `3512fa5` | #53–#55, #94 | |
| 18a | 5 | NORMAL | DONE | `92b5965`, `c4bc1b0` | [03a §10.6 harness] | |
| 18p | 5 | HIGH | DONE | `f22b88e`, `d00b7b3` | `[03a §7.1]` naming guard | added: fold cost per §7.1, no result changed |
| 18b | 5 | HIGH | DONE | `78b2cdd`, `0caf794`, `7253e9b` | AD-27 days | developer ruling: normal peak day, overload day |
| 18c | 5 | HIGH | DONE | `0e637a0`, `c678d6d` | `[03a AD-28]` | developer ruling: `applyEvents` |
| 18t | 5 | HIGH | DONE | `91cc555` | `[03a #106]` capacity touch | added: legal `slip_due` gap fixed (read by the controller, no separate reviewer) |
| 18d | 5 | HIGH | DONE | `6297d3f`, `f08ec18` | B3, P8, P9, P4 | developer ruling AD-29 Q11 |
| 18e | 5 | HIGH | DONE | `64880ac`, `f45475d` | Q5, Q7 | developer ruling AD-29 |
| 18f | 5 | NORMAL | DONE | `6e92e59` | Q1, Q2, P-11 assert | developer ruling AD-29 |
| 18 | 5 | HIGH | DONE | `bb8595f`, `5846860`, `12022e5`, `d36375d` | §10.6 perf asserts | **GATE**: every §7.1 target measured here passes on the normal peak day (AD-27); floor moved to the window by AD-29 Q1, perf project green at `6e92e59` |
| C1 | 6 | NORMAL | TODO | | [01a §5.2a] | cloud `0007_engine_config.sql` |
| C2 | 6 | NORMAL | TODO | | [01a §6.9 A-2–A-10] | |
| C3 | 6 | NORMAL | TODO | | [01a §6.9a], Q-v2.1-1, Q-v2.1-2 | |
| C4 | 6 | NORMAL | TODO | | [01a §6.13, §6.15] | |
| C5 | 6 | NORMAL | TODO | | [01a §4.3 V3] | |
| C6 | 7 | NORMAL | TODO | | [01b B-8], [01a §4.3 V3] | |
| C7 | 7 | NORMAL | TODO | | [01b B-6] | |
| C8 | 7 | NORMAL | TODO | | UI | |
| C9 | 7 | NORMAL | TODO | | UI | |
| 19 | 8 | NORMAL | DONE | `0403e4a` | [03a §5.1] | hub `0007_engine.sql` |
| 20 | 8 | HIGH | DONE | `369c508`, `6ff38d2` | #57, #58, #64, #85, [00 H-1], RF 5 | AD-31 |
| 21 | 8 | HIGH | DONE | `9ebf943`, `7531ec2` | #61, #112 | AD-33 (SIGTERM). The fix also edited hub2's A-14 test in `business-day.int.test.ts` (it subtracts the checkpoint statements) |
| 22 | 8 | HIGH | DONE | `2569ce7`, `111a906`, `8aaa49c` | #60, #62 hub, #63, #71, #73, #79, #95, #111 hub | AD-33 |
| 22a | 8 | HIGH | DONE | `f7e04dc`, `804e3b3`, `04284b0` | #76, #82, #86, #93, #113, BF-4 hub | AD-33; I4 (slip `details`) carried to 23 |
| 22b | 9 | NORMAL | DONE | `3372391`, `a74fefd` | #83 | AD-35 (22b-1 … 22b-5) |
| 23 | 9 | NORMAL | DONE | `6b3ddec`, `a556722` | #65, #67, #72, #77 hub | 01d v1.1.2 (`f7a16f2`), AlertRaised v2 (AD-36); AD-37 (two owner questions) |
| 24 | 9 | NORMAL | DONE | `950bc71`, `7b45d1b` | #70 | AD-35 (24-1 … 24-5); it also edited 01a sync tests |
| A14 | 9 | HIGH | TODO | | [01a §6.17, §6.17a, §6.18b A-14] | |
| R2 | 9 | NORMAL | DONE (hub3 lane, merged `d4ee16a`) | | [00 H-5, H-6] | hub `0008_device_point_lane.sql` |
| R1 | 10 | NORMAL | DONE (hub2 lane, merged `9c7a75d`) | | [01b B-1, B-2, B-3, B-5] | |
| R1b | 10 | NORMAL | DONE (hub3 lane, merged `d4ee16a`) | | [01b B-4] | cloud `0008`, hub `0009_run_station.sql` |
| 25 | 10 | NORMAL | DONE (hub3 lane, merged `d4ee16a`) | | #68 | |
| 25b | 10 | NORMAL | DONE (hub3 lane, merged `d4ee16a`) | | #69 | |
| 26 | 10 | NORMAL | DONE (hub3 lane, merged `d4ee16a`) | | #66 | |
| 27 | 11 | HIGH | TODO | | #59, #74 hub | |
| 28 | 11 | — | TODO | | manual | needs the pilot mini PC |
| 29 | 11 | — | TODO | | — | final review, as-built v1.1 draft |

## Deviations (AD-n, proposed)

| # | Task | Problem | Options | Choice | Why | Files |
|---|---|---|---|---|---|---|
| — | — | *(plan-time rows below are written to `docs/reviews/03a-auto-decisions.md` at the batch 1 checkpoint)* | | | | |
| AD-1 | C3 | Shape of `used_by` when archiving a point that active stations name | (a) 01a's floor shape `{ entity: 'station', ids }`; (b) a point-specific shape | (a) — developer ruling 2026-11-03 | Matches 01a v2.1 §6.9a Q-v2.1-2 and the floor → table precedent (§6.4); no new shape for the client | `apps/cloud/src/modules/restaurant/points.ts` (C3) |
| AD-2 | 12b | **Superseded by AD-29 (developer, 2026-11-07): held lines are consumed (Q14, tests #42 / #118), not re-reserved.** BF-9: held lines after a unit-changing `StockSet` | (a) re-reserve held lines in the new unit; (b) record the over-sell as an accepted cost | (a) — developer ruling 2026-11-03; a line whose count is not valid in the new unit goes full-cook (01a S41) | Keeps reserved ≤ on_hand in the new unit; S41 already defines the not-valid case | `packages/engine/src/stock.ts` (12b), extends #118 |
| AD-3 | 15, 29 | BF-10: "the order taker hears before the promise is blown" | (a) narrow the claim to Waada Guard (EDF / FIFO padding 0); (b) `level = min(T + slip_threshold_ms, P)` | (a) — developer ruling 2026-11-03; spec wording only, no code | Under EDF / FIFO the padding is 0 so the claim cannot hold; no behaviour change | as-built spec text (29); `[03a BF-10]` test in 15 |
| AD-4 | 4, 7 | Review Focus 1: a line whose `units` exceed the station's effective capacity (spec states no rule) | (a) occupy the whole capacity for one cook; (b) occupy the whole station for `ceil(units / capacity)` consecutive rounds | (b) — developer ruling 2026-11-03: the line holds all `capacity` for `cook_ms × ceil(units / capacity)`; a `warn { order_item_id, station_id, units, capacity }` is logged; tested | Real kitchens cook an over-size line in rounds; one cook would under-book the station | `packages/engine/src/profile.ts` (4), placement + warn (7; the warn is emitted outside the pure engine) |
| AD-5 | 3, 13 | §3.3 declares `loads: Record<LoadId, Load>` ("F §4.7 BatchStationState semantics") but never defines `Load` | (a) provisional shape from F §4.7, confirmed in task 13; (b) fix now; (c) opaque until 13 | (a) — controller ruling: `Load { load_id, program_id, order_item_ids, fire_ms, fired_at }` **Final (task 13, proposed (implementer, overnight)):** `Load = { load_id, program_id, order_item_ids, fire_ms, booked }` — `booked` for AD-7 exact removal (member lines `booked: null`), `fired_at` dropped (a load leaves `loads` when it fires; members keep `fired_at` / `load_id`); a name collision falls back to a `:k` suffix (outside §3.3's form). | F §4.7 carries the semantics; v3 unreleased, key set editable until 13 | `packages/engine/src/state.ts`, `test/state.test.ts` |
| AD-6 | 4 (follow-up), 7–8a, 12, 20, 21 | A profile underflow or a stock invariant breach in a fold: §3.7 says no stock fold throws (clamp at 0, `report` gets the breach, §6.1a `applyEvent(state, event, report?)`); task 4's `removeInterval` throws | (a) always clamp + `report`; (b) always throw; (c) a strict flag | (c) — developer ruling 2026-11-05: `@pos/engine` gets a strict flag. Tests run strict: an underflow or a stock breach throws. The hub runs non-strict: the value clamps at 0 and the breach is appended to `state.diagnostics` (`{ kind, event_id?, station_id?, stock_item_id?, detail }`), which the host logs at `warn` after commit and clears; replay never throws on these. `diagnostics` is not part of snapshots / checkpoints and is outside the `ENGINE_STATE_VERSION` key-set fixture. Controller: `applyEvent(state, event, opts?: { strict?: boolean })`, default strict; `diagnostics` replaces the `report` callback (§6.1a, §7.2 breach `warn` built from it) | Tests catch bookkeeping bugs loudly; the restaurant never stops on one | `packages/engine/src/{profile,state,apply-event}.ts`; hub reducer call sites (now); stock folds (12); host log + clear (20); snapshot exclusion (21) |
| AD-7 | 6–8, 16 | Removing a line from the profile must use exactly the booked interval and units (developer follow-up), but §3.3 `EngineLine` has no field for them; recomputing `occupancy(units, cap, cook)` after a capacity change gives a different interval | (a) store the booking on the line; (b) recompute from the capacity at booking time (not stored either) | (a) — controller ruling 2026-11-05: `EngineLine.booked: { start, end, units } \| null`, set at every `addInterval` of the line, used and cleared by its removal; v3 key set updated (unreleased) | Only (a) makes the removal exact; one field | `packages/engine/src/state.ts`, `test/state.test.ts`, the placing and removing folds |
| AD-8 | 6 | §3.3 has no place for `OrderPlaced.lines[]` engine fields until each `ItemAdded` arrives; `EngineOrder` has one `target_land_ms` / `promise_ms` while `OrderPlaced` has them per group; a writer-bug `ItemAdded` (null `serve_mode` / cook time, missing station, unlisted id) has no rule | placeholder line vs a new pending field; order T/P from the first group vs the max; throw vs no-op | Controller rulings 2026-11-05: (a) the line enters `lines` at `OrderPlaced` as a placeholder filled by its `ItemAdded`; **reader rule:** a line of an order with `awaiting > 0` that is still a placeholder is not yet a line (never placed, never in `unfired`); (b) order T/P = max over its groups (`recorded_at` with no groups); (c) writer bugs: strict throws; non-strict records `invalid_event` — a listed bad line still decrements `awaiting` and is dropped, so the rest of the order plans; an unlisted one changes nothing. The §3.3 absent-order `OrderLinesAdded` throw stays in both modes **Developer condition 2026-11-06:** a dropped line is never silent — it is appended to `state.diagnostics` (AD-6); the host logs it at `warn` **and** raises a 01d `info` alert to managers (kind `engine_line_dropped`, values `{ order_id, order_item_id, reason }`, dedupe per `order_item_id`) — in task 22a's scope with its test. | No new state field; one bad line never stalls an order in the hub | `packages/engine/src/{plan,apply-event,state}.ts`, `test/lines.test.ts` |
| AD-9 | 8c | A pulled / early-fill line (`FireDispatched` before its planned `fire_ms`) packs from `max(fire_ms, t)` (§3.3), so it cannot start earlier than planned — the pull does nothing until then | (a) the fold sets `fire_ms = min(fire_ms, recorded_at)`; (b) pack from `fired_at` but sort by planned `fire_ms` | (a) — controller ruling 2026-11-05; the planned fire stays in the event's `due_at` | One field, one meaning (the line's fire); packing and order agree | `packages/engine/src/{apply-event,live}.ts`, `test/live.test.ts` |
| AD-10 | 8c | Stage folds the spec leaves unstated (§3.4 shows only the main transitions) | throw / diagnostic / no-op per case | Controller ruling 2026-11-05 (task 8c review): a stage event from the wrong stage (double Start from two tablets, Served twice, Undo after Served) is a silent no-op that returns `state` (§3.3 absent-id spirit; realistic duplicates, not writer bugs); Done is allowed from `added`; Undo with no `started_at` falls back to `done_at`; Removed / Voided allowed from `added`, `cooking`, `done` **Developer note 2026-11-06:** this fold-level ignore does not replace 03b's command-level `ITEM_WRONG_STAGE`; carried row To 03b (below). | Duplicates from real devices never fail a log | `packages/engine/src/apply-event.ts` |
| AD-11 | 8 | Void / remove `T' = min(T, loop)` for a group spread over several stations (§3.5.3 says "that station; the group's T may move earlier") | (a) pass 1 on that station, then the group's loop re-places its hidden lines on all their stations; (b) re-loop only that station's lines | (a) — controller ruling 2026-11-05: floor = pickup and the land of each sibling that cannot move; promise never moves; only the ended line's group is re-looped (other groups of the order are not) | Moving T earlier necessarily moves siblings on other stations; they only take free capacity | `packages/engine/src/{plan,replan}.ts`, `test/replan.test.ts` |
| AD-12 | 7, 8 | Two lines of one group on one station that cannot cook both at once are queued back to back (F §4.7 D36), but §3.2's `d = T − carry − cook − prep` ignores the queue: a later submit's pass 1 pushes the first line later and makes the second late (review of task 8, Critical), breaking §3.5.3 "at submit no line is late by construction" | (a) queued deadline; (b) keep the current slot as a fallback; (c) re-place same-station siblings as a chain; (d) spec bump first | (a) — **developer ruling 2026-11-05** (source checked 2026-11-06: the developer chose "Queued deadline" when asked during task 8; not an implementer ruling): each line's deadline is its own slot in the queue (`d = slot end − cook − prep`, slot end ≤ `T − carry`), stored in `deadline_ms` and used by re-plans, slack and slips; recomputed when the group's T moves | The most correct; one formula changes (§3.2), folded at task 29 | `packages/engine/src/{plan,replan,apply-event}.ts` |
| AD-13 | 8b | BF-6 says "abandon clock from `max(last_line_fold_at, latest planned land)`" while §10 test 111 says the order leaves "at `last_line_fold_at + order_abandon_ms`"; read literally they disagree for a fired, never-tapped line | (A) `max(fold, land) + order_abandon_ms`; (B) `max(fold + order_abandon_ms, land)` | (B) — controller ruling 2026-11-06: abandoned ⇔ no unfired line ∧ `t ≥ max(last_line_fold_at + order_abandon_ms, latest planned land)`; planned land over open lines = `(started_at ?? fire_ms) + prep + occupancy cook + carry` | Satisfies test 111 as written and BF-6's own test and aim (a long cook is never abandoned before it lands) | `packages/engine/src/lifecycle.ts` |
| AD-14 | 9 | §3.5.3 FIFO: "each new line is placed at `earliestFit(t)` in submit order; its target is that land time", but targets exist only per group; a sync group can span a FIFO station and another | (a) FIFO sync line placed like an immediate, its land a floor for the group's T; (b) each FIFO line its own group (contract change); (c) group T from non-FIFO lines only (FIFO line late at submit) | (a) — controller ruling 2026-11-06: listing order, `earliestFit(t)`, no hold, ignores `pickup_at_ms`; deadline = fire; group T ≥ every FIFO land (and ≥ pickup); padding 0 for FIFO stations; `replanEnded` never re-loops FIFO lines **Amended 2026-11-06 (task 11, proposed (implementer, overnight)):** with routing, each station's policy applies to the lines placed on it; a line whose allowed stations are all FIFO keeps this path; a mixed-option line may land on a FIFO station at its earliest fit (never held), placed after the batch's all-FIFO lines in `syncOrder` (not strict listing order); a re-plan never moves a line onto or off a FIFO station (§3.5.3). | No `OrderPlaced` shape change; nothing late at submit | `packages/engine/src/{plan,replan}.ts`, `test/policies.test.ts` |
| AD-15 | 10 | §3.5.6 is ambiguous: "EDF order on `d_Λ`, `latestFit(…, hi = d_Λ)`" read literally is not Lawler-optimal on one slot (a probe needs Λ = 1.2 M where 600 k suffices), though the spec says it is; also which lines are re-placed, the success test with capped lines, the 16-probe fallback and where `capped` lives | per question | Controller rulings 2026-11-06: (1) place backward — descending `d_Λ`, each at `latestFit(hi = d_Λ)`, keep off (execution order is then EDF on `d_Λ`; Lawler holds); (2) re-place the free hidden lines of the station's pass-1 set (pruned and void-held lines fixed); (3) success(Λ) = every line not at its cap fits; capped lines that do not fit go to `earliestFit` after the others; Λ = 0 probed first; (4) no Λ within 16 probes → the largest Λ probed, leftovers capped; `EngineLine.capped: boolean` **Amended 2026-11-06 (task 10 review):** (3) "if it still cannot fit" = after every uncapped line gives way — a capped line leaves the search only if it cannot fit by `d + max_late_ms` against the base with the uncapped lines removed (one extra pass over the capped lines, not a Λ probe); otherwise it is held at its cap. | Matches the spec's stated optimality; a line-level flag disappears with its line | `packages/engine/src/{overload,replan,state}.ts` |
| AD-16 | 10 | §3.5.6's `latestFit(hi = d_Λ)` also pushes lines that could be on time: one slot, A and B due 12:00, C due 12:30 → Λ = 10 min and C fires at 12:40 though 12:30 is free; in a rush Λ can reach hours (task 10 review, Important) | (a) forward compaction after the search; (b) try `hi = d` before `d_Λ`; (c) keep; (d) spec bump | (a) — **developer ruling 2026-11-06:** after the Λ search, walk the re-placed lines in execution order and move each one earlier, never later: its latest fit by its own deadline `d` if one exists, else the earliest fit no later than its current fire; the order the search chose is kept; `capped` is recomputed from the final placement | No line is ever later than the search put it; lines with room land on time; Λ and the one-slot optimality are unchanged | `packages/engine/src/overload.ts`, `test/overload.test.ts` |
| AD-17 | 11 | §3.5.5 routing leaves bookkeeping and edge cases unstated | per reading | **Accepted by the developer 2026-11-07** (was proposed, implementer, overnight): R1 a line's `station_id` is its current station and `alternates` the other allowed stations (swapped on a move); `routed_station_id` (= `ItemAdded.station_id`, the D25 home route) is the station never carry-filtered; R3 a hidden line re-routes only when it fits neither by `d − keep` nor by `d` on its own station, or the reserve shuts it out; R6 the reserve's home order types are read per line; R7 a placed line keeps its paused station, nothing moves onto one; R9 lines of different home stations sharing a station queue in home-id order; a re-routed line is fixed input on its target (takes only free capacity); reserve fallback: a new or placed line with no allowed station left books its own station at full capacity with a `reserve_fallback` diagnostic; a placed line that fits nowhere goes late at its earliest fit on the first allowed station. Spec-literal after review: the routed station is never carry-filtered, every alternate (a home one too) must pass carry; `checkOrderable` refuses `STATION_PAUSED` when the allowed set has no unpaused station. **For 02:** `OrderPlaced.lines[]` must copy `PlanResult.lines[]` `station_id`, `alternates`, `carry_ms` verbatim | Keeps the §3.5.5 filters exactly; planOrder = fold holds by construction | `packages/engine/src/{route,plan,replan,overload,state}.ts` |
| AD-18 | 13 | F §4.7 batch loads in the 03a profile model leave joins and overload unstated | per reading | **Accepted by the developer 2026-11-07** (was proposed, implementer, overnight): a load books the whole station once (F \"capacity = M items per load\", \"no overlap against any existing load\", F test 14); J1 joining needs the same copied cook time; J2 a joiner must be prepped by the load's start (`start − prep ≥ t`) and the load's fire becomes `min(fire, start − prep)`; J3 an immediate joins the earliest load only if it lands no later than a new load; J4 the pass-1 keep cushion applies to the freshness target; J5/J6 in the §3.5.6 search each formed load (and the late lines of one stored load) is one unit; J7 a unit's deadline = min over members of `d(m) + prep(m) − max prep`, the binding member gives weight / cap / tie-break (exact form would take the min over members' own `d_Λ` — revisit at task 18); L1 a partly started load packs as one interval; N1 a re-formed load keeps its old name | Keeps D14 / D49 batching in normal and overload re-plans | `packages/engine/src/{batch,plan,replan,live,apply-event,state}.ts` |
| AD-19 | 12 | §3.7 stock folds leave details unstated | per reading | **Accepted by the developer 2026-11-07** (was proposed, implementer, overnight): engine drafts are `StockReservedDraft` (event part only, no envelope); `reserveStock` reads each line's own `stock_draws` (`configStockUnits` unread); a `sold_out` line that does not fit is refused even when 0 < available < needed (**developer to confirm**: 02 greys out only at 0); a stock item not in `stockItems` reads available 0; a whole void keeps units and draws; over-reserving clamps and is a breach; a stock event naming a draw the line lacks is an AD-8 writer bug; frozen-or-fired = `fired_at` or `fire_ms ≤ t + freeze_ms`; `StockReserved` for an absent / dropped line is a no-op, release / consume for an absent line still move the entry; a partial void re-plans its group like a void (§3.5.3, AD-11); 01a #66 runs non-strict (a count below reserved not held by frozen / fired lines is a §3.7 breach); 12b: `stockEffects` also has an array form for one command (BF-8), a unit-changing `StockSet` consumes every holding line (Q14), hidden / frozen judged at the draft's `occurred_at`; **BF-9 / AD-2 not built** — see MORNING REPORT | Keeps §3.7 and AD-6 | `packages/engine/src/{stock,apply-event}.ts` |
| AD-20 | 14b | An exited order can be removed before its abandon / close release is written, so its reservation stays held for good (task 14 review); `ReservationsShifted` had no fold, so the hub would re-write the same shift every 500 ms | (a) keep an exited order while a line holds a reservation; (b) spec change | (a) — **Accepted by the developer 2026-11-07** (was proposed, implementer, overnight): the removal step skips an exited order while any line has `reserved_seq ≠ null`; every order-stream fold treats it as absent (`activeLine`), except `OrderLinesAdded`, which re-opens it as a present order (§3.3, test 78); stock folds still find its lines; `noOrderInEngine` gains §3.6.1's second clause. The `ReservationsShifted` fold moves each listed unfired line / load by `by_ms` (F §4.7 D42), deadline and T unchanged, no re-plan; fired / started / absent targets skipped; a line on another station or a load with two `by_ms` (`shift_conflict`) is an AD-8 writer bug | Keeps §3.3 "removal never changes a result", §3.6.1, §3.7 close row, test 62 | `packages/engine/src/{apply-event,lifecycle,tick}.ts` |
| AD-21 | 14, 15 | Tick and slip details the spec leaves open | per reading | **Accepted by the developer 2026-11-07** (was proposed, implementer, overnight): tick: one `FireDispatched` per (station, planned fire), one per load (whole); a firing load pulls in lines by placement's join rule at now; auto-fill fits against others' planned bookings; inferred start at the pass's now, followed by its `StockConsumed`; the cascade shifts only unfired bookings, due at the first ms of overlap; `nextDueAt` tests listed candidate instants (a window opening between them is found ≤ 500 ms later); Waada Guard auto-fill urgency = `deadline_ms − fire_ms ≤ keep` (alternative `d − now ≤ keep`). Slip: R1 an estimate already over the level counts from the order's `placed_at` (spec: "the fold's recorded_at") so per-key = full recompute; R2 crossing = level − prep − cook − carry + 1; R3 only sync groups slip; R4 a slip resolves on its own `order_ids` (spec: "every group of the key"); R5 BF-4 due = latest AD-13 exit; R6 promise in the slip item = group T + the order's padding; R7 overload lists every station, `capped` read on unfired lines, pressure floored in bp; R8 touched keys by input / output comparison | Keeps §3.6.1, §3.8; R1, R4 replace literal wording (fold at task 29) | `packages/engine/src/{tick,slip,pressure}.ts` |
| AD-22 | 15b | `ItemsReleased` / goes-with details | per reading | **Accepted by the developer 2026-11-07** (was proposed, implementer, overnight): only open sync lines take part (a line in both lists = released); each leaving line becomes immediate in its own group `order_id:<next_group_index>`, an emptied group is removed, order T / P stay; an expedite line is placed by one pass 1 with the expedite lines held at their old bookings, then moved to its earliest fit only if that lands earlier (never later, task 15b review); queued deadlines of a changed group recomputed at its old T; a released line's new group keeps the source T; `goesWith`: the most specific row wins (item over category, then target item over category), an exclude wins a tie; `planRelease` pre-ticks nothing — **the caller (task 22a's `apply` / 02) computes the D12 goes-with pre-ticks** from snapshot V3 `goes_with[]` + `ItemAdded.item_id` / `category_id` and passes them as `ticks.expedite` (goes-with is not in `EngineConfigApplied`, §3.11) | Keeps D11 / D12 and §3.8 | `packages/engine/src/{slip,apply-event,plan}.ts` |
| AD-23 | 16 | Boost and capacity details §3.9 / §3.10 leave open | per reading | **Accepted by the developer 2026-11-07** (was proposed, implementer, overnight): B1 sync lines across the order's groups get one hold-and-fire, immediates their own earliest fit; B2 fired / COOKING / FIFO siblings floor `T_b`; B3 no pickup floor on a boost (**developer check:** a boosted delivery can land long before pickup); B4 boost leaves FIFO in place; B5 boosted batch lines join only boosted loads; B6 nothing movable only sets `boosted`; P1 late = fire changed and past deadline; P2 an overdue frozen line stays if it fits, else restarts from t; P3 FIFO on a capacity change pushed later only as needed; P4 an oversize frozen load stays whole in AD-4 rounds (**developer check:** the slip estimate and `auto_done` read per line, so they under-count rounds; store rounds or split the load?); P5 a pushed frozen line keeps deadline, T, promise; P7 capacity events re-plan even if effective capacity is unchanged; P8 a return on FIFO stays an ordinary immediate (**developer check:** vs Q15a "a returned plate never queues"); P9 `moved` / `boost` overwrite every mark except `return` (**developer check:** a moved expedite line loses its follow-up weight on later re-plans) | Keeps §3.4, §3.9, §3.10 | `packages/engine/src/{plan,replan,apply-event,live}.ts` |
| AD-24 | 16b | Views, pull and late-start details | per reading | **Accepted by the developer 2026-11-07** (was proposed, implementer, overnight): V1 Now includes COOKING lines until Done; V2 marked lines stay in fire order, the jump to the top is the screen's (To 03b); G1 `groupReadiness(state, order_id, now)` takes a **required** `now` (§6.1i shows two arguments; fold at 29); G2 a served line counts as done; SL1 archived stations left out of `stationsLive`; E1 `pullEarly` limited by `max_early_ms` only; E2 a line that would overrun another booking is passed over (`null` inside the limit, **03b must handle it**); E3 one draft, one `due_at`; E4 `pulled` overwrites any mark but `return`; S1 **no `cascade_step_ms` rounding on a late Start** (03a §3.3 and F-20 say "only by how far the Start came after its packed Start"; F §4.7's pseudocode and failure table quantise it: **a conflict inside the approved spec, developer to rule**); S2 the shift runs F's loop over all reservations; S3 "Start at s" uses s as of the moved line's placement; `station_plan.fire_ms` narrowed to `number` | Keeps §3.3, §3.10, §6.1 | `packages/engine/src/{view,pressure,tick}.ts`, `packages/events/src/ws.ts` |
| AD-25 | 17 | `EngineConfigApplied` effects | per reading | **Accepted by the developer 2026-11-07** (was proposed, implementer, overnight): a station-type change keeps open lines as fixed input (`placedUnderOldType`), with the exception §3.5.3 states: a capacity fold re-places them by shape (`oldType`, `blockShape`), moving only later; type + capacity in one event behaves as two; hidden lines' route fields are **written in the config fold** from `state.config` (`reachHiddenRoutes`, §3.11 row "alternates, carry | from the next re-plan / tick"; **developer: §2 #5 "a config change never alters an open line" sits beside this row, reconcile at 29**); FIFO lines keep their copies; a hidden line on a removed alternate stays until a re-plan moves it; a line frozen at the config keeps old route copies and could route back onto a removed alternate later (rare, not closed); a capacity rise does not widen a stored block but firing does (rare, surfaces as a slip); archived only-station falls back to it (D3); a recount does not release a fixed line. Deferred checkpoint: `slips` / `slip_due` can differ from full replay until the `AlertClosed` of a slip open at the cut (transient, narrow) | Keeps §3.5.3, §3.10, §3.11, tests 45, 54 | `packages/engine/src/{apply-event,plan,replan,batch,route,live,stock,tick,checkpoint}.ts` |
| AD-26 | 18a, 18p | Simulator readings; §7.1 upkeep cost | per reading | **Accepted by the developer 2026-11-07** (was proposed, implementer, overnight): every order carries `pickup_at_ms = at + max cook + 300 s` (the engine's only input for §10.6's target); order mix 55 / 33 / 12 with 60 tables (`tandoor_sim.py`); degh freshness window 60 s (§10.6 gives none); overload day = same orders, tandoor capacity so its busiest hour asks 125 %; R6 reference for "events ≈ R6": ≈ 45k on replayed streams (brief's parenthetical 65.9k counted 2 events per line). **§7.1 upkeep row not fully met after task 18p:** folds that change an in-flight line still pass over all lines once (BF-14 (b); v3 has no index, an index is a spec-first §3.3 change), one `lines` copy per fold is O(lines), `ordersByKey` is O(open orders) | Keeps §10.6; the cost gap is measured at task 18 | `packages/engine/test/sim/*`, `packages/engine/src/{slip,lifecycle,apply-event}.ts` |
| AD-27 | 18b | §10.6's generated day is not a peak: its formula gives karahi / BBQ / tawa 261 / 218 / 250 % at peak, 5 300 waiting lines and 2.6–3.7 h waits (about 300 % overload), so the §7.1 targets were measured on a day no kitchen runs | (a) keep the day; (b) raise capacities; (c) lower the demand | (c) — **developer ruling 2026-11-07:** the harness defines (1) a NORMAL PEAK DAY: R6 volume (≈ 45k events ± 20 %), peak utilisation 90–100 %, reached by lowering demand, never raising a capacity above 01a's limits; every §7.1 target is asserted on it; (2) an OVERLOAD DAY: the same day with demand at 125 % for ONE hour of the rush, then back to normal; only the overload targets (≤ 16 probes, ≤ 50 ms p99) are asserted on it. Folded into §10.6 at task 29 | A test day must be a day a kitchen can run; the old day's numbers stay on record below | `packages/engine/test/sim/*` |
| AD-28 | 18c | Replay miss: each fold copies `state.lines`, O(lines) per event | (a) state-shape change (spec-first); (b) batch fold | (b) — **developer ruling 2026-11-07:** `applyEvents(state, events[])` in `@pos/engine` copies the state once per call, folds the events into that private copy, returns the new state; pure at the boundary; no state-shape change. Replay folds in chunks of 500; the live writer folds one transaction's events with one call (host wiring: task 20). Test: `applyEvents(s, es)` deep-equals the per-event fold for the generated day. Folded into the as-built at task 29; no spec bump (no behaviour change) | One copy per batch removes the top fold cost with no change of result | `packages/engine/src/apply-event.ts` |
| AD-29 | 18d, 18e, 18f, 29 | The 12 questions of the batch 5 MORNING REPORT | as listed there | **Developer rulings 2026-11-07:** Q1 the 90 % utilisation floor uses the **10-minute window** (`peak_window_pct`). Q2 keep the normal peak day (degh 4, tandoor 30); add **report-only** runs on seeds 8 and 11. Q4 word the remaining reads into §7.1 at task 29 (no index). Q5 `listLines` **rejects a reused live `order_item_id`** (AD-8: strict throws, non-strict `invalid_event`, no write); **the device mints the id** (To 02). Q7 a from-stock line **consumes at Done (or Served) if there was no Start**. Q8 `sold_out` refused when 0 < available < needed stands. Q10 reconcile §2 #5 with §3.11 at task 29, built per §3.11. Q11 **fix now as task 18d:** B3 a boost keeps the pickup floor, P8 a return never queues on every policy, P9 a moved or boosted expedite line keeps its follow-up weight, P4 an oversize load's estimate and `auto_done` count its rounds. Q12 `pullEarly` `null` inside the limit stands (03b handles it). **As built, developer to confirm (the report made no recommendation on these three):** Q3 the AD-28 copy gap stays (no in-place delete); Q6 BF-9 stays parked, code follows #42 / #118; Q9 no `cascade_step_ms` rounding on a late Start | The developer's call, with the numbers in hand | `packages/engine/src`, `packages/engine/test/sim` |
| AD-30 | 18d, 18e | Readings inside the AD-29 fixes | per reading | **Proposed (controller and implementers, after AD-29), for the developer:** B3: an immediate line of a boosted pickup order keeps its earliest fit, as at submit. P8: FIFO alternates are offered to a boosted return; with `returns_boost` false a return can wait on every policy (the owner's explicit setting: developer to confirm). P4: rounds stored on a member line when it leaves its stored load (`rounds`, `occupiedCook`); a capacity change after the fire leaves them; a void before the fire or a partial void after it leaves them, so the station can stay booked up to one cook longer than the remaining units need. Q7: Undo after a consume at Done does not reverse it; at Served "no Start" = `started_at` null at any open stage; a Done or Served on an AD-20 kept line still consumes. Q5: "reused" covers every id in `order_item_ids`, an id listed twice in `lines[]` or across groups; an id whose order has left the state is free again; a `StockReserved` on a line past `added` is a writer bug; a fresh or fired line at `added` can't be told from a legal flip (known limit, pinned, closed by the To 02 row) | Keeps the rulings' words | `packages/engine/src/{apply-event,plan,profile,lifecycle,slip,tick,live,stock}.ts` |
| AD-31 | 20 | An `AlertClosed` on a non-order stream was folded live but never replayed (replay reads it only on the order stream), so live ran the §3.3 removal step at that event and replay did not | (a) fold `AlertClosed` only on `stream_type === 'order'`; (b) replay every stream | (a) — **proposed (controller)**: §3.3 says live and replay remove at the same point; §3.12 lists `AlertClosed` on the order stream; the `slip_warning` kind's subject is the order stream (01d closes on the subject stream) | Live = replay, no cost | `packages/engine/src/apply-event.ts`, task 23 |
| AD-32 | 22–26, R1b | Developer rulings 2026-11-07 (after the hub2 merge) | — | **Developer rulings:** (1) the stock frames for `StockReserved` / `StockReleased` / `StockConsumed` go to every staff socket of the branch; (2) `mark-served` default scope `'branch'`; (3) AD-2 superseded by AD-29: held lines consumed, not re-reserved; (4) **perf tests out of the normal gate:** the perf project no longer runs in `pnpm -w test`; it runs only as `pnpm test:perf` inside a clean measurement (create `/tmp/pos-perf.running`, trap to delete it); timing asserts on a shared laptop under load are noise; the official §10.6 gate is the clean run; (5) at the next batch checkpoint take one clean measurement and record BF-7 (39.8 ms official; hub2 saw 51–63 ms under load) and `stations-live` (hub2 saw 6.8 ms vs 5); if either misses on an idle machine, find which of 18d–20 slowed it and fix it before continuing | The developer's call | root `package.json`, `vitest.config.ts` |
| AD-33 | 21, 22, 22a | Host readings in batch 8 | per reading | **Accepted in full (developer, 2026-11-07):** (21) SIGTERM is caught with `process.once('SIGTERM')`, which checkpoints and then closes; the spec names a Fastify `onClose` hook, but the checkpoint needs the writer to still be open, which `onClose` does not guarantee. (22) The fires tick: a config catch-up runs before the fires and in the same transaction; a pass that commits nothing writes no `last_pass_ms`. (22a) (1) "Dropped a line" means an `ItemAdded` dropped for a reason other than `line_not_listed`, an `ItemAdded` refused with `stream_id_mismatch` (its placeholder stalls the order), or any refused `OrderPlaced` / `OrderLinesAdded`. (2) A refused batch gets the key `engine_line_dropped:<order_id>:<order_item_id>`; the drop of a single line keeps the per-id key. (3) The closes are appended before `raiseMany`, so a slip carried over the day close is a new alert (§3.8). (4) **A capped station below amber is not closed**: §3.10's "closed below amber" and its "capped and not open → raise" would otherwise close and re-raise on every pass, against §6.2a "never due again". This needs a spec fold at task 29. (5) A deduped slip key, or a resolved key with no open alert, joins `skipped`. (6) An unregistered kind is logged and skipped, never thrown. (7) The dropped-line alert's subject is the order stream. (8) Dropped-line facts are re-queued at boot from the step-3 replay diagnostics (0 statements). A drop whose alert managers already closed inside the replay window is raised again: noisy, not silent. (M2) The tick's own event on a skipped key gives one extra retry and a second log line. (M4) A station in `overload_skipped` is retried only after a restart. (Review 2) A wrong-stream `ItemAdded` for an absent or unlisted order also raises `engine_line_dropped` (noise, not silence). An open overload of a station deleted from the config closes `done` while it may still be red (it has no thresholds left). On SIGTERM a non-empty dropped-line queue is flushed by one `fires_alerts` pass before the snapshot; if that flush itself throws, the snapshot is still written and the drop stays only in the error log (narrow, logged). A stop without SIGTERM writes no shutdown snapshot, so boot re-queues the drop | Keeps the spec's rules; (4) picks the one consistent reading | `apps/hub/src/engine-host/*`, task 29 |
| AD-34 | hub3 merge, 29 | Developer rulings 2026-11-07 (after the hub3 merge) | — | **Developer rulings:** (1) commands 25 and 25b stay registered in `server.ts`, and task 26's audiences stay in `ws/engine-audiences.ts`; (2) `appendEvents` returns early when there is nothing to append (no `MAX(seq)` read); (3) `SetStationCapacity`'s statement test is tightened to an exact count; (4) the double re-plan on a capacity change is accepted, with a note for task 29; (5) the snapshot timing check in `snapshots.int.test.ts` moves to `pnpm test:perf` (it hit 60–91 ms under load); (6) for task 29's as-built and release notes: 01b §3.6 "no two entries for one station" applies within each responsibility kind; "upgrade every hub before anyone assigns run_station" | The developer's call | `apps/hub/src/events/*`, `apps/hub/test/engine/snapshots*.test.ts`, task 29 |
| AD-35 | 22b, 24 | Host readings in batch 9 | per reading | **Developer 2026-11-07:** 24-1 **accepted** (one `EngineConfigApplied` on every config apply, re-plans nothing; wording note on test 70 at task 29). **Controller check against the spec and AD-1..AD-34 (as the developer asked):** 22b-2, 22b-3, 22b-5, 24-2, 24-3, 24-5 **accepted** (nothing contradicts them). 22b-1, 22b-4 and 24-4 contradicted the spec's text. **Owner rulings 2026-11-07:** (a) 22b-1: **keep the code** (`sendToSessions`); 00 H-1 wins, so an alert-only connection never gets plan frames; fold into 03a §3.6.3 at task 29. (b) 22b-4: **change the code to a payload filter**: a station's plan frame is sent only when its payload differs from the last one sent to that station, which covers line-only changes, and test 83 means "no frame when nothing visible changed"; fold the test-83 wording at task 29. (c) 24-4: **keep the code**, so fires never stop because a catch-up fails; while `configStale` is still set after the back-off, log one warn line per pass with the failure count and the config version in use; no new alert kind; fold into 03a §6.2 at task 29. Readings as proposed: (22b-1) the `station_plan` frame is sent with `sendToSessions` (00 AD-74), not `sendToDevices` as §3.6.3 writes: `sendToDevices` also reaches a device's alert-mode socket, which 00 H-1 / F-6 limits to alert frames; the audience is exactly §3.6.3's (tested). (22b-2) A socket's station is noted when its catch-up part is built (`connectedSessions()` has no `stationId`); 0 statements. (22b-3) The catch-up part is an array of bodies, one per station in `state.stations` sorted by id, archived included; a station socket whose station is unknown gets its own empty body. (22b-4) "Plan changed" = the station's reference changed **or** any of its lines' references changed (a host diff, no engine change). This over-sends a little: a line change outside the plan body (draws, a fired or cooking line) also frames its station. The content is correct and the cost is small, so it is accepted; a filter on body fields is possible later. Open test gap: the StockReleased test does not pin `stations.S1` as unchanged. (22b-5) The frame goes out in the after-commit hook, before that commit's event frames (`writer.addAfterCommit` order): **for 03b**. (24-1) **Developer to confirm:** `config_version` is inside E() and the comparison (§3.11 "exactly the `EngineConfigAppliedV1` fields"), so every forward apply writes one `EngineConfigApplied`, even a price-only one. The fold then re-plans nothing and frames nothing (reviewed). Test 70's "a price change → none" holds only at an equal version; recommend an editorial note on test 70 at task 29. (24-2) `reference_cook_ms`: present in the snapshot, `variant_group_id === null`, `stock_time_ms` not read, lower median, clamped at 0. (24-3) A repeated `station_id` keeps its first row. (24-4) After 3 non-committing catch-up attempts, ordinary fires passes run, and the catch-up retries once per 60 s while `configStale` stays true. Each failed retry logs two error lines (the tick loop's `tick failed` plus the back-off line), bounded to about two a minute. Open test gap: a hook commit during the back-off (the `catchUps.delete` branch). (24-5) Task 24 also edited 01a's sync tests (`config-hook`, `poller`, `poller-apply-failure`, `poller-directory`) to expect the new `EngineConfigApplied`; 01a §4.2 / S40 N2 allow the hook's append, so no 01a contract change | Keeps the spec's rules; (24-1) is the literal §3.11 formula | `apps/hub/src/engine-host/{station-plan,reducer,config-hook,fires-tick}.ts`, test 70 |
| AD-36 | 23 | `AlertRaised` payload version for the widened `AlertDetailsBase` (developer decision 1, 01d v1.1.2) | v1 (additive) / v2 | **v2 + upcaster**, per **foundation §4.1 D46**: "When a payload shape changes, the new version gets a new Zod schema and an upcaster … A version may only add fields with defaults"; and §6.7: one fixture per schema version. The upcaster v1 → v2 is the identity on `details` (the new fields are absent). Foundation §6 has no versioning rule of its own; the rule lives in §4.1. **Accepted by the owner 2026-11-07** | The foundation's rule | `packages/events/src/events/alert/AlertRaised.v2.ts`, fixtures, 01d v1.1.2 |
| AD-37 | 23, 29 | Task 23 readings, and two spec gaps it exposed | per reading | **Proposed (controller and implementer), for the owner:** (1) **Statement bound, needs a ruling.** The slip details need each line's `name`, which the engine state does not hold (`EngineLine` has no name, `item_id` or `category_id`). So a slip pass makes one read of the slip orders' `ItemAdded` rows. §6.2a / §10.5 state "2 (`listOpen`) + ≤ 1 (`tableOwners`) + 01d's bounds". This is met numerically today only because `tableOwners` is stubbed (0 statements). Once 02's `tableOwners` lands, a pass with a `dine_in` slip costs 2 + 1 + 1 + 01d. Options: fold "+ ≤ 1 line facts" into §6.2a at task 29, or add `name` to `EngineLine` (engine state v3 and snapshot size: a §3.3 change). (2) **Spec gap, needs a ruling.** An answered slip keeps `slips[key].alert_id`, because 01d closes an answered request through `RequestAnswered` and the engine folds only `AlertClosed` (§3.8 re-raise needs `alert_id = null`; change row 1: "the engine no longer folds `RequestAnswered`"). So for a `dine_in` key, one answered slip at lunch silences every later slip of that table for the rest of the day, a new party at dinner included. The code and #72 follow the text. One option: fold a `RequestAnswered` on the order stream whose `alert_id` is a `slips[key].alert_id` as a close (a §3.12 replay-list and test 94 change). (3) `minutes_late` = ceil((estimate − promise) / 60 s), floored at 0. With the defaults (threshold 120 s below padding 180 s), most slips fire before the promise, so the card usually says 0; 01d `int ≥ 0` forbids a signed value. This is a card-wording question. (4) `lines` = the slip orders' sync lines in `added`, `cooking` or `done`; `state` = the engine stage; `quantity` = `EngineLine.units` (fix round 1). An empty `ItemAdded.name` falls back to the `order_item_id`. (5) Details that fail the schema are skipped and logged `details_invalid`; after fix round 1 this branch is defensive and unreachable. (6) Goes-with pre-ticks are taken across all orders of the slip. (7) `engine_line_dropped`: `closes_on: 'owner'`, no lead fallback, expires at day close. (8) The line-facts read has no `branch_id` predicate (one branch per hub; it uses the `events_stream` index). (9) The cloud has no event ingest yet; the module that builds cloud event sync must parse `AlertRaised` v2 through the shared registry | Keeps the spec's rules; (1) and (2) are the owner's | `apps/hub/src/engine-host/{kinds,fires-alerts-tick}.ts`, 03a §3.8, §6.2a, §3.12 |

Plan-time proposals (plan "Plan decisions" and "BF placement"), to become AD rows at the named checkpoint:

- P-5 `liveInterval(state, order_item_id, t)` (spec writes `liveInterval(line, t)`) — batch 2.
- Review Focus 1 → ruled as AD-4 (rounds), above.
- BF-9 → AD-2; BF-10 → AD-3 (ruled 2026-11-03, above).
- P-11 re-placed-lines bound rule — batch 5 (task 18).
- P-12 `@pos/engine/sim` test-only subpath export — batch 5.

## Carried rows (to README at task 29)

| To | Row | Source |
|---|---|---|
| 03b | The engine's fold ignores a stage event from the wrong stage (AD-10: duplicate taps never fail a log). That does **not** replace 03b's command-level check: `StartItem` / `DoneItem` / `UndoDone` / `MarkServed` still answer `409 ITEM_WRONG_STAGE` from the current stage before appending (foundation §4.2 stage guard). | AD-10, developer 2026-11-06 |
| 02 | **Binding:** the device mints `order_item_id`; 02 refuses a reused live id **before append**. The engine refuses it too (AD-29 Q5), but a refused batch's `StockReserved` carries no `order_id`, so on a fresh or fired line at `added` the fold cannot tell it from a legal flip (pinned as a known limit, task 18e). `OrderPlaced.lines[]` copies `PlanResult` route fields verbatim (AD-17). | AD-29 Q5, task 18e review |
| 03b, 02 | `DoneItem`, `MarkServed` append `stockEffects` too: a from-stock line consumes at Done or Served if there was no Start (AD-29 Q7). Draft from folded state, or use the array form for several causes in one command (two single-form calls from one state would double-draft). Fire a whole load before a Start or pull on one of its lines; `GiveMeMore` on a `single_tap` line writes the inferred start; `pullEarly` can answer `null` inside the limit. | AD-29 Q7, Q12, tasks 14, 18e |

## Open items

1. Command halves of #101, #103, #107 (`409 RETURN_ALREADY_OPEN`), #114 → 02 (README "To 02" #1, #8).
2. No owner-app screen to assign `run_station` (01b v1.5 defines none); API only until specified — **carried to the UI module** (developer, 2026-11-03).
3. H-5 / H-6 write-time checks → 03b's pairing / binding UI (and 01e).
4. Task 28 needs the pilot mini PC (like 00 #79; developer, 2026-11-03).
5. 03a §12.3 Q12 (customer's own wrong order) still open; 02 / 04, not blocking.
6. **BF-9 / AD-2 (developer question, see the batch 4 entry):** not built; `it.todo('[03a BF-9]')`.
7. **Done or Served without a Start on a from-stock line (developer question):** no consume is written, so its units stay reserved until the abandon pass (up to `order_abandon_ms`, default 4 h) or the next close; the spec has no consume at Done.
8. **For 01a's next bump:** the §9 intro "the only allowed foundation edit" is stale (R34 lets a module append its §9 codes to F §6.2) — developer note 2026-11-05.
9. **Task 29 reminder (owner, 2026-11-07):** 03a v1.0 is locked (`.claude/settings.json`). The 03a **v1.0.1** as-built (not v1.1; 02p task 0 later writes 03a v1.2 on top) must carry, on §3.8 `slip_warning` `details_schema`: "⚠️ Changed by 01d v1.1.2: `minutes_late` and `lines` are now in 01d §3.12 `AlertDetailsBase`; `AlertRaised` v2 (AD-36)". It must also fold the owner rulings AD-35 (a) into §3.6.3, (b) into the test 83 wording, (c) into §6.2, and 24-1's test 70 note.

## Batch entries

*(one per checkpoint, newest last)*

```
## Batch N — <title> (<date>)

- **Tasks:** …
- **Commits:** `<sha>` (task), …
- **Reviews:** HIGH tasks: full opus review each; NORMAL: paired. Findings and fix commits.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — <files>, <tests>, <wall time>; perf project numbers (from task 18) copied into §7.1 above.
- **Tests closed:** …
- **AD rows (proposed):** …
- **Carried to later tasks:** …
- **Open items:** …
```

## Batch 0 — Setup (2026-11-03)

- **Tasks:** 0.
- **Commits:** `07cf818` (AD-1–AD-4 developer rulings, open items 2 and 4), `6fdf085` (task 0).
- **Reviews:** task 0 alone, one fresh opus reviewer: spec ✅, Approved, 0 Critical / 0 Important; 3 Minor (F §6.2 note has no ⚠️ prefix; 01a §9 `POINT_NOT_FOUND` row sits after the 409 / 422 rows; `_rules.md:8` glob `{{MOD}}_*_Spec_v1.*.md` misses v2.x module specs). No fix round.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — green: 304 files passed (1 skipped), 2014 tests passed (1 skipped), 10 m 14 s.
- **Tests closed:** — (no code).
- **AD rows (proposed):** AD-1 (`used_by` floor shape), AD-2 (BF-9 re-reserve, S41 full-cook), AD-3 (BF-10 wording only), AD-4 (units > capacity → `ceil(units / capacity)` rounds + warn).
- **Carried to later tasks:** —
- **Open items:** `_rules.md:8` glob; 01a §9 intro "the only allowed foundation edit" wording is stale (pre-existing; spec text, for task 29 / developer).

## Batch 1 — Events, errors, state, profile (2026-11-03)

- **Tasks:** 1, 1b, 2, 3, 4.
- **Commits:** `2b317b5` (task 1), `5b005d7` (task 1b), `0bde005` (task 2), `462eb21` (task 3), `8f112be` (task 3 review fix), `f0eba66` (task 4).
- **Reviews:** one fresh opus reviewer per task (task 4 HIGH: full opus review with its invariants; NORMAL tasks reviewed one per reviewer, not paired). All five: spec ✅, Approved, 0 Critical / 0 Important. One fix round: task 3 (Minor 1, nested inline types added to the v3 key-set guard, `8f112be`; test-only, re-checked by the controller). Minors noted, not fixed: task 1 fixture polish (return line's engine station when the served line used an alternate; `seq` collisions in `aReturnLinesAdded`; `anOrderBatch` override order); task 1b `Id` strictness frame vs events, `station_plan.fire_ms` nullable; task 2 envelope test builds the envelope itself; task 3 payload cast in `apply-event.ts`, a station missing from a later `EngineConfigApplied` keeps its runtime (reading); task 4 `removeInterval` throws below 0 (kept: loud beats silent corruption), preconditions documented not guarded.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — green: 309 files passed (1 skipped), 2075 tests passed (1 skipped), 12 m 26 s. The `perf` project has no file yet (`--project perf` alone exits 1 until task 18; `pnpm -w test` passes).
- **Tests closed:** #56, #103 fixture, #114 fixture; `[03a §4.2]`, `[03a §4.2 A-19]`, `[03a §3.6.3]`, `[03a §9]`, `[03a §3.11]`, `[03a §3.3 profile]` incl. AD-4.
- **AD rows (proposed):** AD-1–AD-4 (developer rulings, before batch 1), AD-5 (`Load` provisional, controller ruling at task 3). Written to `docs/reviews/03a-auto-decisions.md`.
- **Carried to later tasks:** 7 — emit the AD-4 `warn` (outside the pure engine); 7 / 8 / 16 — store the booked `{ interval, units }` on the line and remove exactly that (a capacity change must not recompute `occupancy` for a removal); 8a — the return-line fold takes `serve_mode 'immediate'` / no draws from `return_of`, and the engine station from the served line; 13 — confirm `Load` (AD-5); 16b — decide whether `station_plan.fire_ms` narrows to `number`; 20 — snapshot load checks the profile is canonical; a later client task — `errors.STATION_PAUSED` / `STATION_PAUSE_DISABLED` keys (03a §8 item 5).
- **Open items:** unchanged (1–5 above); item 2 carried to the UI module, item 4 needs the pilot mini PC.

## Batch 2 — Placement core (2026-11-05)

- **Before task 6:** `cfaff6a` (autobuild spec lock matches every current version), `aba023e` (AD-6 recorded, open item 6), `6420934` (AD-6 code: strict flag, `state.diagnostics`, `removeInterval` underflow), `f9cf4a9` (AD-7).
- **Tasks:** 6, 7, 8c, 8, 8a.
- **Commits:** `f8826e6`, `0315dc1`, `316e9b6` (task 6 + 2 fix rounds), `ace2270` (task 7), `be5afc1`, `788c05d` (task 8c + AD-9 fix), `aa1cc99`, `091b939` (task 8 + review fix), `8b2d209` (task 8a); docs `2217837` (AD-8), `b29838f` (AD-9), `adfa6f0` (AD-11, AD-12).
- **Reviews:** a fresh opus reviewer per task (all HIGH), AD-6 reviewed as its own task. Results:
  - AD-6: Approved, 0 C / 0 I.
  - Task 6: Approved; one ruling-level Important (a bad `ItemAdded` stalled its order in non-strict mode) → fixed in round 2 with Minors (duplicate `ItemAdded`, null stock time, group ids); scoped re-review Approved. Round 1 was the controller's pre-review ruling (writer bugs → diagnostics).
  - Task 7: Approved, 0 C / 0 I; the fold re-running hold-and-fire at `recorded_at` confirmed against §3.5.1 / §3.5.3 (brute-force probe).
  - Task 8c: Approved, 0 C / 0 I (after the AD-9 pre-review fix).
  - Task 8: **Needs fixes** — Critical: a D36-queued group made late by an unrelated submit (spec gap in §3.2's deadline) → developer ruling AD-12 (queued deadline); Important: over-capacity deadline (AD-4) and re-plan cost (49 ms median on 700 hidden lines) → fixed in one round (5.7–7.3 ms median); re-review Approved.
  - Task 8a: Approved, 0 C / 0 I.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — green: 315 files passed (1 skipped), 2164 tests passed (1 skipped), 11 m 36 s.
- **Tests closed:** #16, #17, #18, #19, #20, #21, #22, #23, #31, #43, #51, #75, #80, #89, #91, #96 (live half), #98, #114 engine, #115 (live half), #116; F #1, #2, #4, #5, #6, #7, #8, #10; `[03a BF-2]`, Review Focus 1 (placement), 2, 4 (placement half); `[03a AD-4]`, `[03a AD-6]`, `[03a AD-9]`, `[03a AD-12]`.
- **Coverage split (controller):** #96 and #115's moved bookings after a late Start → `[03a #96 shift]` / `[03a #115 shift]` in task 16b (`lateStartShift`); #96's `getTickIntents` sameness → `[03a #96 tick]` in task 14.
- **AD rows (proposed):** AD-6 (developer), AD-7 (`booked` on the line), AD-8 (placeholder lines, order T / P, writer-bug `ItemAdded`), AD-9 (a fired line packs from its actual fire), AD-10 (stage-fold choices), AD-11 (void re-plan across stations), AD-12 (developer: queued deadline). **AD-6 and AD-12 change spec text** (§6.1a `report?` → `opts`; §3.7 "no stock fold throws" holds only non-strict; §3.2 deadline) — fold at task 29.
- **Carried to later tasks:** 8b — `last_line_fold_at` for `ItemReturned`, a return re-opening `last_served_at`, duplicate deal / no-station `ItemAdded` double-decrement, `listLines` ignoring ids not in `order_item_ids`, `FireDispatched` ignoring `payload.station_id` and naming a line of an order still awaiting, stream-id checks; 10 — the late-set stub's lateness; 11 — alternates use the unqueued `T_min − carry` in the pivot; 12 — `[03a #75]` `reserveStock` / `stockEffects` (incl. the `StockAdded` path) draft nothing for a return line, `StockReserved` for a dropped line is tolerated, strict / non-strict stock breach (AD-6); 14 — `[03a #96 tick]`; 16 / pull / boost — a return line keeps `mark 'return'` (its follow-up weight depends on it); 16b — `[03a #96 shift]`, `[03a #115 shift]`; 18 — remaining O(m²) array spreads in `holdAndFire` / `planNewLines`; 20 — log `diagnostics` at warn after commit and clear (hub restart tests compare a strict rebuild with live state); 21 — snapshots exclude `diagnostics`; 02 — `OrderPlaced.order_item_ids` listed in `proposed.lines` order.
- **Spec notes for task 29:** the D36 lower-bound gap is closed by AD-12; §3.7 / §6.1a / §3.2 wording per AD-6 / AD-12.
- **Open items:** 1–6 unchanged.

## Batch 3 — Lifecycle, policies, overload, routing, batch loads (2026-11-06)

- **Before batch 3:** `04d574f` (AD-8 developer condition → task 22a `engine_line_dropped`; AD-10 carried To 03b; AD-12 source checked = developer).
- **Tasks:** 8b, 9, 10, 11, 13.
- **Commits:** `35ffd9d` (8b), `d1635e0` (9), `5bbf64b`, `b127a44`, `c9ebfc2` (10 + 2 fix rounds), `2aee7e5`, `169d155` (11 + fix), `565dcd3`, `f61ad5d` (13 + fix); docs `55a6869` (AD-13), `35be27a` (AD-14), `52adc16` (AD-15), `94b1ca3` (AD-15 amended, AD-16).
- **Reviews:** a fresh opus reviewer per task (all HIGH).
  - 8b: Approved, 0 C / 0 I (after the AD-13 NEEDS_CONTEXT ruling).
  - 9: Approved, 0 C / 0 I (after the AD-14 NEEDS_CONTEXT ruling).
  - 10: Needs fixes — Important: backward `latestFit(hi = d_Λ)` pushes lines that could be on time → **developer ruling AD-16** (forward compaction), fix round 1; re-review Important: `capped` flagged a cap-0 on-time line → fix round 2 (lateness > 0); clean.
  - 11: Needs fixes — Important: a new line could land on a paused station (§3.10); three readings (R2, R4, R5) narrowed §3.5.5 rules → fix round 1 made them spec-literal (routed station never carry-filtered, reserve applies to the own station, FIFO-match filter dropped); re-review Approved.
  - 13: Needs fixes — Important: a joiner with more prep was refused (F step 3(a)); the overload search dropped batching → fix round 1 (prep-ready join, loads as units in the Λ search); re-review Approved.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — green: 320 files passed (1 skipped), 2243 tests passed (1 skipped), 12 m 18 s.
- **Tests closed:** #24, #25, #26, #27, #28, #29, #30, #44, #49, #78, #81 (ids, load names, snapshot + replay; split part → 15b), #90, #99, #101 engine, #111 engine; F #3, #9, #14, #15; `[03a BF-6]`, `[03a §3.5.6]`, `[03a AD-14]`, `[03a AD-16]`, Review Focus 4 (exit half).
- **AD rows:** AD-13 (abandon clock), AD-14 (FIFO line in a group; amended for routing), AD-15 (overload search readings; amended), AD-17, AD-18, AD-5 final — controller / **proposed (implementer, overnight)**; AD-16 — **developer ruling**.
- **Carried to later tasks:** 12 — AD-6 applies to the stock folds (strict throws, non-strict clamps + diagnostic; this overrides the plan's "no fold throws / `report`" wording), `[03a #75]` `reserveStock` drafts nothing for a return line, `StockReserved` for a dropped line tolerated; 14 — `[03a #96 tick]`, a partial `FireDispatched` / `ItemStarted` on an unfired load member over-books briefly, `packBatch` stale `load_id` on a COOKING member; 15b — drop `slips` / `slip_due` of removed orders, #81 split part; 16 — return line keeps `mark 'return'` (weight now from `return_of`), batch → slot config change with loads, capacity-drop version of the overload-load test, FIFO lines out of boost / capacity re-plans; 16b — pressure of a load with room, `[03a #96 shift]`, `[03a #115 shift]`; 18 — record the removal-scan cost, J7 unit weight (min over members' `d_Λ`), remaining O(m²) spreads, `tMin` max over a batch's groups; 20 / 22a — log diagnostics at warn and clear, dedupe `reserve_fallback`, `engine_line_dropped` alert; 24 — a FIFO → Waada Guard policy change keeps deadline = fire; 29 — spec notes (AD-6, AD-12 – AD-18 wording; follow-up weight from `return_of`); 02 — copy `PlanResult` route fields verbatim, `OrderPlaced.order_item_ids` in `proposed.lines` order, a batch line with no program → `InvalidEvent` mapping; 03b — `StartItem` / `pullEarly` on a batch station name the load; 01a / 02 — forbid two alternates both marked home. Known gaps: `live.ts` packs fired lines without the reserve.
- **Open items:** 1–6 unchanged.

## Batch 4 — Stock, tick, slip (2026-11-06)

- **Tasks:** 12, 12b, 14, 14b (added overnight), 15, 15b.
- **Commits:** `afb53ef`, `4b4eb7b` (12 + fix), `ea6056c`, `51ef84a` (12b + fix), `f75d453` (14), `1eb33e7`, `9e893c9`, `9bcd50a` (14b + 2 fixes), `249f91d`, `663ca0a` (15 + fix), `4e5fd86`, `dc92693` (15b + fix); docs `6e0a5e7` (AD-19 – AD-22).
- **Reviews:** a fresh opus reviewer per task.
  - 12: Needs fixes — Important: a partial void kept T (dropped §3.5.3 `T' = min`, AD-11) → round 1, a partial void re-plans its group like a void; Approved.
  - 12b: Needs fixes — Important: a `StockAdded` candidate filter §3.7 does not state → round 1 removed it (+ 3 Minors); Approved. BF-9 parked (below).
  - 14: Approved, 0 C / 0 I; found two plan-level gaps no task owned → task 14b.
  - 14b: Needs fixes — Important: a kept exited order was resurrected by a stage fold → round 1 (`activeLine` guard); re-review Important: `OrderLinesAdded` on a kept order threw, against §3.3 / test 78 (**caused by the controller's instruction in round 1**, and it could have stopped boot replay) → round 2, it re-opens; Approved.
  - 15: Needs fixes — Important: the slips drop at `BusinessDayClosed` had no test → round 1 (+ stronger oracle, abandon-time touch); Approved.
  - 15b: Needs fixes — Important: an expedited line could land 10+ min later than its sync slot (78 / 648 probe combinations) → round 1 (held at the old booking, moved only if earlier; probe now 0 / 648); Approved.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` — green: 326 files passed (1 skipped), 2348 tests passed (1 skipped, 1 todo = `[03a BF-9]`), 10 m 11 s. **Power cut during the first run:** the process was killed mid-gate; `git fsck` clean, no uncommitted code, nothing stashed, no task in progress. The re-run failed at `ECONNREFUSED 127.0.0.1:5433` before any test (the `pos-pg-test` container did not survive the cut; typecheck and lint had passed); `docker start pos-pg-test` per `docs/manual-test-e2e.md`, then green. No code change.
- **Tests closed:** #32, #35, #36, #37, #38, #39, #40, #41, #42, #52, #62 engine, #74 engine, #75 (reserve half), #77 engine, #81 (split part), #84, #87, #88, #91 (slip half), #92, #96 tick, #102, #104, #105, #106, #109, #110, #111 tick, #117, #118, #119; 01a #129; F #12, #13; BF-1, BF-3, BF-4, BF-5, BF-7, BF-8, BF-10, BF-12, BF-13, BF-14; Review Focus 3. **Not closed: BF-9.**
- **AD rows:** AD-19, AD-20, AD-21, AD-22 — all **proposed (implementer, overnight)**.
- **Developer questions:**
  1. **BF-9 vs tests #42 / #118.** AD-2 (yours) says re-reserve held lines in the new unit after a unit-changing `StockSet`. Tests #42 and #118 say those lines are consumed before the `StockSet` (Q14) and "their later `ItemStarted` drafts no `StockConsumed`". Re-reserving would make that later Start consume, so building AD-2 changes behaviour the spec states; it also needs `item_id` and the sale quantity on `EngineLine`, a new-unit quantity in the `StockReserved` fold, and a meaning for "full-cook" on an already-consumed frozen line. **The code follows #42 / #118.** Not treated as stop condition 2 because the code and the spec agree; the conflict is between the ruling and the spec, and it is an isolated edge (a unit change at the open with from-stock lines carried over the close). A hidden full-cook line carried over such a unit change can also be reserved with its old-unit draw. Decide: rewrite #42 / #118 for AD-2, or take BF-9's other option (accepted cost).
  2. Done or Served without a Start on a from-stock line (open item 7): should it consume?
  3. AD-19: refuse a `sold_out` line when 0 < available < needed? 02 greys an item out only at 0, so a short line looks orderable and is then refused.
- **Carried to later tasks:** 16 / 16b — `lateStartShift` writes `ReservationsShifted` (`late_start`, the fold exists), `[03a #96 shift]`, `[03a #115 shift]`, reuse `pressureBp`, the bands and #48; 17 — #94 static set; 18 — add a 20-line `StockAdded` at peak (≈ 44 ms at 1 200 hidden lines on the dev box), record upkeep cost (+37 µs per event), memoise packing per (station, t) if re-plan p99 is tight; 20 — log diagnostics and clear; 22 — evaluate `noOrderInEngine` / `checkpoint_pending` after the pass's fold (test 111 "that pass"); 22a — `engine_line_dropped`, dedupe `reserve_fallback`, the D12 goes-with pre-ticks (AD-22); A14 / hub — use the array form of `stockEffects`; 03b — fire a whole load before a Start or pull on one of its lines; `GiveMeMore` on a `single_tap` line writes the inferred start; 29 — §3.7 "no fold throws" per AD-6, an A-row for S14 `StockSet` below reserved / 01a #66, §6.1f wording, Q14 prose, 03a line 340 "fired never moves".
- **Open items:** see Open items above (6, 7 new).

## Batch 5 — Disturbances, views, config, the simulator gate (2026-11-07)

- **Tasks:** 16, 16b, 17, 18a, 18p (added), 18, 18b, 18c (developer rulings), 18t (added).
- **Commits, reviews, gate, gate numbers:** see MORNING REPORT and the §7.1 table above.
- **Power cuts:** two in this batch, none lost committed work; no code was stashed; interrupted reviews resumed or re-briefed.
- **Tests closed:** #33, #34, #45, #46, #47, #48, #50, #53, #54, #55, #94, #96 shift, #97, #100 (engine), #107 engine, #108, #115 shift; F #11; §10.6 perf asserts (AD-27 floor red); BF-7 measured. Hub clauses of #100 → 25, #107's 409 → 02.
- **AD rows:** AD-23 – AD-26 proposed (implementer, overnight); AD-27, AD-28 developer rulings.
- **Carried:** in the MORNING REPORT.

## Batch 8 — Engine host: migration, boot, snapshots, fires, fires_alerts (2026-11-07)

- **Tasks:** 19, 20, 21, 22, 22a; AD-34 follow-ups (developer). Parallel lanes merged in: hub2 (R1, A14) `9c7a75d`, hub3 (R2, R1b, 25, 25b, 26) `d4ee16a`.
- **Commits:** `0403e4a` (19); `369c508`, `6ff38d2` (20); `9ebf943`, `7531ec2` (21); `2569ce7`, `111a906`, `8aaa49c` (22); `f7e04dc`, `804e3b3`, `04284b0` (22a); `3eee52b` (AD-34: `appendEvents` early return, exact SetStationCapacity count of 16, snapshot timing moved to `snapshots.perf.test.ts`); docs `22ff90a`, `52d5b31`, `a34025d`.
- **Reviews:** a fresh opus HIGH review for every task.
  - 22a: Needs fixes. Important: a dropped line was lost on a restart (AD-8), a deviation was not recorded, `due` cost was unmeasured, slip `details` was missing (→ 23).
  - 22a round 1: boot re-queue, overload computed once, perf row, M1/M3/M5/M6. Re-review Important: a graceful restart still lost the queue.
  - 22a round 2: flush before the SIGTERM snapshot, state-free drop rule. **Approved.**
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` at `3eee52b`, under the lock.
  - First run: 3111 tests passed, but **1 unhandled error**: pg `57P01 terminating connection due to administrator command`, from `apps/cloud/test/db/staff-roles-migration.int.test.ts`. The likely cause is the cloud scratch-DB helper's `DROP DATABASE … WITH (FORCE)` hitting an open client. The file passes 3/3 alone. This is a cloud-lane flake and was reported.
  - Re-run **green**: 355 files passed (1 skipped), 3111 tests passed (1 skipped, 1 todo).
- **Clean measurement** (`pnpm test:perf`, idle machine, load 2.3 → 2.1, head `3eee52b`): 26 passed, 5 skipped (report-only seeds).
  - Every row passes. BF-7 max 38.7 ms (≤ 50); stations-live max 2.5 ms (≤ 5): **no 18d–20 slowdown**, so nothing to fix.
  - Re-plan p99 9.5 ms; replay 11.8 s; 2-day replay 27.0 s; overload day p99 10.2 ms with 7 probes; snapshot serialise max 5.1 ms; capacity drop p99 15.4 ms.
  - Fires pass p99 11.2 ms; fires_alerts with work p99 10.6 ms; idle `due` p99 2.2 ms.
  - Raw: `.superpowers/sdd/03a-plan/task-18-numbers-batch8.json`.
- **Tests closed:** #57, #58, #60, #61, #62 hub, #63, #64, #71, #73, #76, #79, #82, #85, #86, #93, #95, #111 hub, #112, #113; BF-4 hub; [00 H-1].
- **AD rows:** AD-31 (proposed); AD-32, AD-34 developer rulings; AD-33 accepted in full by the developer.
- **Carried:**
  - 22b: restore `host.crossed` and `last_pass_ms` on a failed commit.
  - 23: the slip `details` (`minutes_late`, `lines`) or `raiseMany` throws every pass; the real kinds `slip_warning`, `station_overload`, `engine_line_dropped`.
  - 29: the §3.10 at-cap-below-amber wording; the double re-plan on a capacity change; 01b §3.6 per responsibility kind; "upgrade every hub before anyone assigns run_station".
- **For the developer:**
  - The cloud lane's `stash@{0}` ("On module-03a-cloud: partial before power cut 2") is no longer in the stash list. Its commit `a621fdc` is intact. Restore it with `git stash store -m "On module-03a-cloud: partial before power cut 2" a621fdc` if it is still needed. The 22a implementer used `git stash push/pop -- apps/hub/src` for its RED run, which is the likely cause.
  - The cloud pg 57P01 flake (above).

## Batch 9 — station_plan, config hook; task 23 blocked (2026-11-07)

- **Tasks:** 22b and 24 done; 23 **BLOCKED** (see the MORNING REPORT).
- **Commits:** `3372391`, `a74fefd` (22b); `950bc71`, `7b45d1b` (24).
- **Reviews (fresh opus each):**
  - 22b: Needs fixes. Important: a line-only change (an expedite on a frozen line, a StockReleased deadline) got no frame. Round 1 fixed it with a host line diff. **Approved.**
  - 24: Needs fixes. Important: the catch-up give-up cleared `configStale` without the append (against §3.11). Round 1 keeps the flag and retries once per 60 s. **Approved.**
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` at `7b45d1b`, under the lock: **green**. 357 files passed (1 skipped), 3139 tests passed (1 skipped, 1 todo), 14 m 24 s. No perf re-run: the batch 8 clean run stands, and neither 22b nor 24 is on a measured path except the fires pass (one extra flag check).
- **Tests closed:** #70, #79 (real E()), #83.
- **AD rows:** AD-35 (proposed; 24-1 is a developer question).
- **Carried:**
  - 23: everything, once the details contract is ruled.
  - 29: the §3.6.3 `sendToSessions` wording; the test 70 note; the over-sending of `station_plan` frames (accepted).
- **Working-tree incidents:** the two batch 9 implementers worked in parallel. 22b committed only its own hunks of the shared `fires-tick.ts` / `index.ts` with `git hash-object` + `update-index` (reviewed: the committed files are self-consistent). No stash was used.
