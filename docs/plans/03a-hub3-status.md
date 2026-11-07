# 03a hub3 lane status (R2, R1b, 25, 25b, 26)

Plan: `docs/plans/03a-plan.md`. Branch `module-03a-hub3`, cut from `origin/module-03a` at `52d5b31` (includes the hub2 merge `9c7a75d`). Decisions and AD rows of the engine lane stay in `docs/plans/03a-status.md`.

| Task | Status | Commits | Review |
|---|---|---|---|
| R2 | TODO | | |
| R1b | TODO | | |
| 25 | TODO | | |
| 25b | TODO | | |
| 26 | TODO | | |

## Controller rulings

- **Task 26 wiring:** the audiences of `EngineConfigApplied`, `StationCapacitySet`, `StationPauseSet` and the `stations_live` catch-up part are registered in a new `apps/hub/src/ws/engine-audiences.ts` (the 01a pattern of `ws/restaurant-audiences.ts` and `ws/restaurant-catch-up.ts`), called from `server.ts`, not in `engine-host/index.ts` (owned by the engine lane). §6.4 names no file. Cost if wrong: move about 10 lines into `registerEngineHost` at the merge.
