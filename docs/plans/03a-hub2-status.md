# 03a hub2 lane status (R1, R1b, A14, R2)

Plan: `docs/plans/03a-plan.md`. Branch `module-03a-hub2`, cut from `origin/module-03a` at `258812d`. Decisions and AD rows of the engine lane stay in `docs/plans/03a-status.md`.

## End report: R1 and A14 done, merged with module-03a; gate red on engine perf only

**Result:** R1 and A14 are built, reviewed and pushed. R2 and R1b moved to the engine lane (developer ruling 4). The developer merged `origin/module-03a` (head `369c508`, tasks 18d–20, hub `0007`). The only conflict was the imports of `business-day.int.test.ts`, resolved keeping both sides in merge commit `3373d73`.

**Gate at `3373d73`, under the lock: red on 1 test.** Typecheck and lint pass; 3030 tests passed, 1 failed, 6 skipped, 1 todo. The failure is `[03a BF-7]` in `packages/engine/test/sim/day.perf.test.ts`, at max 63.0 ms against 50 ms.

**Rerun of that file alone, under the lock, with no other heavy process on the machine (8 cores, load average 2.8): 2 failed.**
- `[03a BF-7]`: 51.3 ms against 50 ms.
- `[03a §7.1 "stations-live"]`: 6.8 ms against 5 ms.

Both are wall-clock bounds in engine code. `packages/engine` here is identical to `369c508`, and this lane changed nothing there. The engine board last recorded BF-7 at 39.8 ms, before 18d–20. The slowdown is therefore in the merged engine commits, or is noise on this machine. It is not fixed here, because `packages/engine/src/**` belongs to the engine lane. **Needs the engine lane:** re-measure BF-7 and `stations-live` at `369c508`.

| Task | Status | Commits | Review |
|---|---|---|---|
| R1 | DONE | `9d037dd`, `5d7f3ab` | 1 Important (scope help for `manage-stations`) fixed and verified |
| A14 | DONE | `56d049d` | Full opus review: approved, 0 Critical, 0 Important, 7 Minor |
| R2 | MOVED | | Moved to the engine lane (ruling 4) |
| R1b | MOVED | | Moved to the engine lane (ruling 4); cloud `0008` and hub `0009` still free |

**Gate at `0de24d5`: red on 2 tests, neither from this lane.** Typecheck and lint pass; 2933 tests passed, 2 failed, 2 skipped, 1 todo. Both failures are `[03a AD-27]` in `packages/engine/test/sim/day.perf.test.ts`: degh 86.24 and karahi 89.89 against the 90 % floor. This branch changes nothing under `packages/engine`. `6e92e59` on `origin/module-03a` moves that test to the 10-minute window (AD-29 Q1) and is not on this branch, so the gate has not been shown green here.

## Developer rulings (2026-11-07)

1. **Stock frames:** `StockReserved`, `StockReleased` and `StockConsumed` go to every staff socket of the branch, the same audience as the other stock events. **Carried row To 02:** the ordering tiles fold them. Not built in this lane.
2. **`mark-served` default scope:** `branch` is accepted.
3. **BF-9 / AD-29 Q6:** keep what was built: held lines are consumed and not re-reserved. AD-2 is marked "superseded by AD-29 (developer)" in `docs/reviews/03a-auto-decisions.md`. The AD-2 row in `docs/plans/03a-status.md` belongs to the engine lane and still needs the same mark.
4. **R2 and R1b move to the engine lane,** because they need hub `0007`. Not started here.

## Open items

- **Stock frames (ruling 1):** the audience entries are not built yet. They are carried To 02.
- **Choices no spec states, to confirm:** Labels and the `manage-stations` scope help are implementer or controller copy. No owner-app screen assigns `run_station` yet (R1b's open item).
- **Release note (B-2):** no backfill, so dev and pilot tenants must be re-seeded with this release.
- **For task 29:** 01b §3.3 still says `own_tables` is offered by no permission, and the §4.2 group list omits both new permissions.
- **After the lanes merge:** pin absolute statement counts in the A14 tests. They only compare relative counts today.
- **Other A14 test Minors:** id order masks newest-first and deadline order in the hub tests; a same-unit invalid Add below reserved is untested; the old-unit reserve cost is unnamed; the helper block is repeated in 3 files; the double fold is unmeasured.
- **Other R1 Minors:** the `manage-stations` label omits capacity; the statement-count test is cloud only and had no real RED.
