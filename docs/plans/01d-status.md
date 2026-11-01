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

## Batch 2 — Pipeline, WS, migration, hub directory (2026-11-01)

- **Tasks:** 6 pipeline `preRead` / `pinCheck` through `checkPin` (H-3); 7 `sendToDevices` / `sendToStaff` / `connectedSessions`, catch-up socket context, sweeper guard (H-4, H-7, H-8); 8 alert-mode WS (H-1, H-13); 9 migration `0006_alerts.sql` (§5.1, H-5, H-12, H-14); 10 hub directory `no_pin_staff`, `teamOf({ includeNoPin })` (B-1, B-3, B-6).
- **Order:** 6, 7, 9, 8, 10. Task 9 ran while task 7 was in review, because it does not depend on the WS work.
- **Commits:** `b9818c1` (6), `dbb1805` (7), `6ff7037` (9), `6f1fb71` + `2d79ff7` review fix (8), `19a9691` (10). The AD-22 / AD-23 rulings are in `921efec`.
- **Reviews:**
  - Every HIGH task (6, 8, 9, 10) had a full opus review; NORMAL task 7 had its own review. All approved.
  - Task 8, fix round 1: a throwing `alerts_open` or catch-up builder inside the ws message handler crashed the hub (an uncaught exception, confirmed by a probe). Both builders are now guarded: log `{ err, device_id }` and close that socket `1011`. The built `alerts_open` is validated with `WsAlertsOpen.parse`, and `sendToAlertMode` accepts only alert frames. The re-review found it addressed.
  - Task 9: the SQL is byte-identical to §5.1.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` passed: 257 files, 1449 tests.
- **Tests closed:** 01d #31 (task 10). Batch 2 also adds section-cited tests: `[00 H-1]`, `[00 H-3]`, `[00 H-4]`, `[00 H-7]`, `[00 H-8]`, `[00 H-9]`, `[00 H-12]`, `[00 H-13]`, `[00 H-14]`, `[01d §5.1]`, `[01b B-1]`, `[01b B-3]`, `[01b B-6]`.
- **AD rows (proposed):**
  - AD-22, AD-23: developer rulings, applied in task 34.
  - AD-24–AD-27 (task 6): the fast-path peek (a replay without a valid token gets `401` instead of the stored `200`); `authGen` captured earlier; the hooks ctx has `permission: null`; a shared argon2 semaphore.
  - AD-28, AD-29 (task 7): the sweeper logs under the `err` key; `startSweeper(deps, log)`.
  - AD-30, AD-31 (task 8): `4409` / `1011` as local constants; the builder and listener guards.
  - AD-32, AD-33 (task 10): a duplicate `no_pin_staff` entry is skipped; `leadOf` applies to `staff` entries only.
- **Carried to later tasks:**
  - a Zod parse test for a directory with `no_pin_staff` (task 11);
  - `handle` must not append when `pinCheck` is set (tasks 22–23);
  - the big-fixture cache is not keyed on the schema version (task 14);
  - add `WS_CLOSE.REPLACED` (`4409`) to `packages/events` when the client needs it (tasks 40 / 9b).
- **Deferred minors (for the final review):**
  - (6) no test pins replay of a PIN command with an ended session or no token;
  - (6) `preCtxFor` is always built;
  - (7) a dead check and a fixed sleep in the H-4 test;
  - (7) a socket closed by `deliver` stays listed until its `close` event;
  - (8) a pong during a revoke close refreshes `deviceSeen`;
  - (10) the duplicate-entry test was not RED first;
  - (10) a `staff` entry with a bad hash is accepted via `no_pin_staff`.

## Batch 3 — Cloud directory, app update, kinds, projections (2026-11-02)

- **Tasks:**
  - 11: cloud `no_pin_staff` in `GET /v1/sync/config` (B-5)
  - 12: tablet app update endpoints and the `app-release` CLI (H-5)
  - 13: `defineAlertKind`, `APPROVAL_TIER_STEPS` and the test fakes
  - 14: `alerts` / `alert_flags` / `alert_receipts` / `presence_today` projections
  - 15: `device_bindings` projection (BF-3)
- **Commits:** `e564009` (11), `0de1d08` (12), `f3531fa` (13), `87d124d` (14), `fc2c1b7` (15).
- **Reviews:**
  - Every review was by opus.
  - HIGH tasks 11 and 15 were each reviewed alone, and the reviewer ran each task's tests.
  - NORMAL tasks 12 and 13 were reviewed as a pair; task 14 was reviewed alone.
  - All approved with 0 Critical / 0 Important findings, so no fix rounds.
- **Gate:** passed, 261 files / 1504 tests.
- **Tests closed:** 01d #48 (11), #40 (12), #27 (15). Section-cited tests were added for `[01b B-5]`, `[00 §6.36]`, `[01d §3.5]`, `[01d §5.2]`, `[01d P-8]`, `[01d BF-3]` and `[01d §3.7]`.
- **Sync bound:** `GET /v1/sync/config` with the directory is now 27 statements, exactly at its bound of 27 (R32 c). Any further directory read needs a spec bump.
- **AD rows (proposed):** AD-34 to AD-50.
  - AD-46: BF-3 governs over the §3.7 / §5.2 kiosk wording.
  - AD-49: the owner should confirm the wording of #27.
- **Carried to later tasks:**
  - Fakes: `fakeTableOwner` / `fakePoint` go to task 16, `fakePager` to task 17, `fakeFires` to task 30.
  - Production kinds must be defined at the top level of a module statically imported from boot.
  - Add a positive-control replay test for a registered kind (tasks 19 / 30).
- **Deferred minors (for the final review):**
  - (11) Stale comments: `repository.ts:102-104` and the sync test.
  - (11) No test shows an admin no-PIN change turning a 304 into a 200.
  - (12) The CLI reads the source twice to hash and copy it, and does not fsync. The app checks `sha256` anyway.
  - (12) A failed `rmSync` after commit exits 1 with no log.
  - (12) No test that an old client version gets 200 on `/app/*`.
  - (12) The spawn test is slow.
  - (13) `unregisterAlertKind` is exported from `src`.
  - (13) The freeze test is partial.
  - (14) The P-8 buffer is unbounded.
  - (14) Old big-fixture caches (about 180 MB each) pile up in /tmp.
  - (14) `AttemptSent` on a closed alert still writes recipient rows.
  - (15) The counting registry is duplicated in two tests.
  - (15) `taken_over` sits in the test's "keep" list.
  - (15) A comment is needed on why the in-memory type map is safe.

## Batch 4 — Targets, routes, raise, close, frames (2026-11-02)

- **Tasks:**
  - 16: targets, team walk, presence filter, `mayAnswer` (§3.4, rules 5–6, BF-8)
  - 17: routes and `registerRoute`, plus the §3.4.2 table-owner fallback (§3.4.3, §3.8, §3.4.2)
  - 18: `raise`, `raiseMany`, `batchReads`, G1-9d shortcut, BF-6
  - 19: `close`, `closeMany`, `listOpen`, `byDedupeKey`, `tickCtx`, `request_result`
  - 20: `ws-frames.ts`
- **Commits:**
  - `c44ebec` (16)
  - `409726e` (17)
  - `c6cb85f` + `f55cf7d` review fix (18)
  - `262bdfc` (19)
  - `7b1e68a` + `761d34a` review fix (20)
- **Reviews** (all opus):
  - HIGH tasks 16, 17 and 20 were each reviewed alone; NORMAL tasks 18 and 19 were reviewed as a pair.
  - Task 16, Important: the §3.4.2 fallback ("owner not signed in and has no route → zone order taker → managers") had no owner. Ruling: moved to task 17, which builds routes (AD-57). Built and reviewed there.
  - Task 18, Important: a raise inside the read-only PIN `prepare` view threw `env is not bound`, and tasks 23/24 need that path. Fixed with `rawDbOf` (AD-67). The BF-6 cache drop now also covers `DevicePaired` and `BusinessDayClosed` (AD-70). Re-review: addressed.
  - Task 20, Important: `alert_closed` did not reach the requester's sockets (§6.2 step 10). Fixed (AD-79). In the same round:
    - the frame error log no longer echoes the `JSON.parse` input, which could contain details (AD-80);
    - the lock frame schema now refuses the AD-23 fields (AD-81).

    Re-review: addressed. No `card` / `details` leak was found on any frame path.
- **Gate:**
  - Run 1: 1 failure, the cloud `login.int` #53 timing ratio under full-suite load. Batch 4 changed no cloud code, and the test passes when run alone (3/3).
  - Run 2: green, 267 files / 1623 tests.
- **Statement bounds measured:**
  - `raise`: 9 at R=1, T=2, which is exactly 6+R+T. `raiseMany(20)`: 9.
  - `closeMany`: 8 for both 1 and 10 requests.
  - `listOpen` / `byDedupeKey`: 1 each.
  - `alert_closed`: 1 for 3 alerts closed in one transaction.
- **Tests closed:** 01d #1, #2, #5 (16); #3 (17); #15, #20, #47 (18); #14 (19); #29, #49 (20).
- **AD rows (proposed):** AD-51 to AD-81.
- **Open question for the developer (needed before tasks 34 / 41):** the outcome of a `request_result` cannot be shown to clients. `AlertViewSchema` (§5.4) has no `values` or outcome field, but §3.10 promises "decision and answerer (or closer and reason)" and §6.12 asks for a rising or falling chime depending on the outcome. The options:
  - (a) a `display.kind_label_key` per outcome, which fits today's shapes;
  - (b) an additive view field `outcome`.
- **Carried to later tasks:**
  - Task 23: `onMatch` only appends the prepared drafts and never raises again. Task 23 must not resend `alert_closed`; ws-frames already sends it to the requester and to the may-answer sockets. Confirm whether "the requester's sockets" also covers alert-mode sockets on the requester's bound devices.
  - Task 24: `raise` has no `hidden_from` option yet.
  - Task 30: `fakeFires`.
  - Task 32:
    - re-assert #49 `alerts_open` with real rows;
    - the header must also check `route`, because `bindingIsRoute.until` is non-null even when (a)/(b) fail.
- **Deferred minors (for the final review):**
  - (16) `stepTargets` throws a plain Error on a non-string `from_value`.
  - (16) A dead depth cap in `walkTeam`.
  - (16) Fake reset without try/finally.
  - (17) No test for an absent person's phone binding, or for the `table_team` `from_value` marker path.
  - (18) `rawDbOf` is a public export.
  - (18) An O(keys) scan on each close.
  - (19) A test comment swaps R and T.
  - (19) The 200-character slice can split a surrogate pair.
  - (19) The positive-control test is structurally trivial.
  - (20) A kiosk alert-mode socket may get an `alert_closed` it never showed.
