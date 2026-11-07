# 03a hub2 lane status (R1, R1b, A14, R2)

Plan: `docs/plans/03a-plan.md`. Branch `module-03a-hub2`, cut from `origin/module-03a` at `258812d`. Decisions and AD rows of the engine lane stay in `docs/plans/03a-status.md`.

## Stopped: R2 and R1b wait for hub `0007`

`listMigrations` (`apps/hub/src/db/migrate.ts`) throws unless versions run 1, 2, 3 with no gap. R2's `0008` and R1b's `0009` cannot exist on this branch until task 19's `0007_engine.sql` does. Task 19 was not on `origin/module-03a` or in `~/pos` at `b7a8fde`. Waiting for a developer decision.

| Task | Status | Commits | Review |
|---|---|---|---|
| R1 | DONE | `9d037dd`, `5d7f3ab` | 1 Important (scope help for `manage-stations`) fixed and verified |
| A14 | DONE | `56d049d` | Full opus review: approved, 0 Critical, 0 Important, 7 Minor |
| R2 | BLOCKED | | Needs hub `0007` |
| R1b | BLOCKED | | Needs hub `0007` and `0008`; not started, cloud half included |

**Gate at `0de24d5`: red on 2 tests, neither from this lane.** Typecheck and lint pass; 2933 tests passed, 2 failed, 2 skipped, 1 todo. Both failures are `[03a AD-27]` in `packages/engine/test/sim/day.perf.test.ts`: degh 86.24 and karahi 89.89 against the 90 % floor. This branch changes nothing under `packages/engine`. `6e92e59` on `origin/module-03a` moves that test to the 10-minute window (AD-29 Q1) and is not on this branch, so the gate has not been shown green here.

## Open items

- **WS audience (needs a ruling before 02):** `StockReserved`, `StockReleased` and `StockConsumed` have no audience entry, so clients get no frames for them. No spec section assigns them, although 03a P-4 and §3.7 say clients fold stock frames. No client reads these events yet.
- **Choices no spec states, to confirm:** new default grants take scope `branch`, including Waiter and Order taker `mark-served`. Labels and the `manage-stations` scope help are implementer or controller copy. No owner-app screen assigns `run_station` yet (R1b's open item).
- **Interim until task 20 (A-15, A-17):** boot's fold reads only stock and day events, so a restart would not rebuild reservations. No production writer creates orders yet.
- **BF-9:** held lines are consumed and not re-reserved, per AD-29 Q6, which is still "developer to confirm". AD-2 still reads option (a). The brief's "BF-9 re-reserve after" was not built.
- **Release note (B-2):** no backfill, so dev and pilot tenants must be re-seeded with this release.
- **For task 29:** 01b §3.3 still says `own_tables` is offered by no permission, and the §4.2 group list omits both new permissions.
- **After the lanes merge:** pin absolute statement counts in the A14 tests. They only compare relative counts today.
- **Other A14 test Minors:** id order masks newest-first and deadline order in the hub tests; a same-unit invalid Add below reserved is untested; the old-unit reserve cost is unnamed; the helper block is repeated in 3 files; the double fold is unmeasured.
- **Other R1 Minors:** the `manage-stations` label omits capacity; the statement-count test is cloud only and had no real RED.
