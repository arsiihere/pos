# 01d build status

## Batch 0 — Setup (2026-11-01)

- **Tasks:** 0 (autobuild rules and settings for foundation v1.8, R34).
- **Commits:** `0b57e35` task 0; `70ba874` tablet plan answers (TQ1 OkHttp approved, Gradle, 9b only; TQ2 Kotlin; AD-1's two calls confirmed: no requester waiting card in 9a, `test_alert` sender includes the receipts view).
- **Review:** one opus reviewer over the batch. Text matches the brief.
- **Gate:** not run (no code; task 0 "Done when").
- **Tests closed:** none.
- **AD rows:** none new. AD-1–AD-9 are written to `docs/reviews/01d-auto-decisions.md` at the batch 1 checkpoint.
- **Open items:**
  1. ~~Checkpoint push blocked by `.claude/settings.local.json:47` deny `Bash(git push:*)`~~ — removed by the developer (2026-11-01).
  2. ~~Allow `Bash(git push origin module-*)` too broad~~ — tightened (developer approved, 2026-11-01): allow only the exact command `Bash(git push origin module-01d)`; deny `Bash(git push *:main*)`, `Bash(git push * main*)`, `Bash(git push * --force*)`, `Bash(git push * -f*)`, `Bash(git push * --delete*)`, `Bash(git push * +*)`.

**Note:** the allow line `Bash(git push origin module-01d)` in `.claude/settings.json` must be updated to the new branch name for each module branch (e.g. `module-01e`).

## Batch 1 — Shared packages, pipeline hooks (2026-11-01)

- **Tasks:** 1 domain codes and `ALERT_CONSTANTS`; 2 alert events and wire shapes; 3 WS frames (H-2, BF-5 frame); 4 `payload_hash` without the PIN, `'checked-in-handler'` (H-9, H-3); 5 `checkPin` hooks, read-only tx view, BF-2 (H-3).
- **Commits:** `5f54533` (1), `5458710` + `6ec48c8` lint (2), `c2da312` + `5d5d47c` lint (3), `fec0c9b` (4), `e2e0964` + `a14b555` review fix (5).
- **Reviews:**
  - Tasks 1 + 2 were reviewed as a pair; task 3 alone. All approved.
  - Tasks 4 and 5 had full opus reviews; task 4 was approved first time.
  - Task 5, fix round 1: the read-only view let `COMMIT` / `ROLLBACK` / `BEGIN` / `SAVEPOINT` / `RELEASE` / `ATTACH` / `DETACH` through, which would break R1. It now requires `readonly && reader`. The re-review found it addressed.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` passed: 254 files, 1404 tests. The first run failed lint (two unused vars in task 2 / 3 test files), fixed in `6ec48c8` and `5d5d47c`.
- **Tests closed:** none of §10 (batch 1 has section-cited tests only: `[01d §9]`, `[01d A14]`, `[01d §4.2]`, `[01d §6.x]`, `[00 H-2]`, `[00 H-3]`, `[00 H-9]`, `[01d BF-2]`, `[01d BF-5]`).
- **AD rows:** AD-1–AD-9 (developer decisions) and AD-10–AD-21 (build) are written to `docs/reviews/01d-auto-decisions.md`, all proposed.
  - AD-10: `preRead` follows the 00 §4.2 spec signature `preRead(db, payload, ctx)`; task 6 changes the type.
  - AD-4: the `binding_route` frame takes §6.11 to 6 frames.
- **Open items for the developer:**
  1. **Spec gap (before task 34):** §6.7 inbox rows (view + `seen_by_me`, `moved_to_name`, `for_staff_name`) have no `state` / `close_reason`, yet the inbox lists today's closed alerts.
  2. **Spec gap (before task 41):** the alert view does not carry `answers`, `needs_pin` or `silent`, which the answer sheet and §8.1 need. The client would have to map them from `kind`.
  3. **Plan text:** the `pnpm --filter X typecheck typecheck:tests` step command is wrong (pnpm passes the second name to tsc). Implementers run `… typecheck && … typecheck:tests`.
  4. **Deferred minors** (for the final review):
     - (5) the `stmt.database` of the read-only view exposes the raw db;
     - (5) the BF-2 log `phase` label;
     - (5) the BF-2 test does not assert the counters after rollback;
     - (4) unreachable `staff_id === null` branch in `authorize`;
     - (4) test-only `MarkAlertsSeen` stand-in (note for task 26);
     - (2) `MyRequestRow` has both `raised_at` and `waiting_ms`;
     - (2) the lock schema strips `details` instead of refusing it.
