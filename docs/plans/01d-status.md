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

### Developer rulings after batch 4 (2026-11-02)
- **`request_result` outcome, option (b), AD-82:** an additive `outcome` view field (`approved | rejected | withdrawn | obsolete | overridden`). It never carries amounts, items or reasons, and it may go on alert-mode frames for `request_result`, which is consistent with G1-13 e. Applied in task 34.
- **AD-46:** BF-3 is correct. Align the §3.7 / §5.2 wording at the as-built review.
- **AD-49:** reword #27 to "no active binding is left".
- **00 #53** (cloud `login.int` timing ratio): a known flaky 00 test and a 00 open item, not caused by 01d. When it fails under full-suite load, re-running it alone is acceptable for the gate. It is not fixed.

## Batch 5 — Receipts and the request commands (2026-11-02)

- **Tasks:**
  - 21: receipt buffer and `receipt` frames (§3.6, A11).
  - 22: `AnswerRequest` rules, session answers, first answer wins.
  - 23: `AnswerRequest` with PIN and in person, counted failures, `pin_use_failed` (BF-1, BF-2).
  - 24: `approval_receipt`, `answered_on_requester_device`, hidden from the answering seat.
  - 25: `WithdrawRequest`.
- **Commits:** `d83360a` (21), `3a0687a` (22), `bf56a68` + `f2b04ee` ruling fix (23), `229635e` (24), `ff632b1` (25).
- **Reviews:**
  - HIGH tasks 22, 23 and 24 were each reviewed alone; NORMAL tasks 21 and 25 were reviewed as a pair. All reviews were by opus and all approved with 0 Critical and 0 Important.
  - Task 22: no PIN-free path.
  - Task 23: no PIN leak and no reachable counter bypass. One spec gap, ruled by the controller (AD-99): the `pin_use_failed` raise inside `onPrepareFailed` is caught, so a matched PIN keeps its count (rule 4 (d)). Fixed in `f2b04ee`, and the re-review found it addressed.
  - Task 24: no details leak.
- **Temporary guard:** task 22's temporary `in_person` guard was removed in task 23, as planned.
- **Gate:** green on the first run, 272 files and 1680 tests.
- **Tests closed:**
  - task 21: #23, #30
  - task 22: #6, #7, #8, #9, #18
  - task 23: #11, #44, #54, #56 (hub), #60, #66
  - task 24: #12
  - task 25: #13
- **AD rows (proposed):** AD-83 to AD-105.
- **For the developer to confirm:** AD-88. Receipts for closed alerts are accepted; a duplicate `AlertDelivered` after a restart is harmless, and task 38 prunes per alert.
- **Carried to later tasks:**
  - Task 26: re-assert #23 ("a rolled-back `MarkAlertsSeen` buffers no `AlertSeen`") with the real command. A seen from the hidden seat closes nothing.
  - Tasks 32 / 34 / 35: hiding in the inbox, catch-up and `alerts_open`.
  - Task 38: prune the receipt recorded and `sentVia` sets per alert.
  - 00 (not 01d): `@fastify/websocket` is registered with no `maxPayload`, so the 100 MiB default applies before auth.
- **Deferred minors (for the final review):**
  - (21) The `active` singleton.
  - (22) A test assertion `>= 1` that should be `=== 2`; `recheckAuth` duplicated; a likely flake source in the ws-client 1 s window under argon2 load.
  - (23) RF-2 lacks the cases with no PIN; WS hiding is asserted only through DB columns.
  - (24) The `{}` details fallback is untested; an accept kind answered by PIN on the raising device is untested.
  - (25) A 2-line station guard is duplicated.

## Batch 6 — Seen and the tick (2026-11-02)

- **Tasks:**
  - 26: `MarkAlertsSeen`, `RequestSeen`, answering-seat rule
  - 27: tick loop and `registerTick`
  - 28: alerts tick steps, superseded skips, restart and answer race
  - 29: expiry and day close
  - 30: statement bounds and timed tick
- **Commits:**
  - `be948e9` (26)
  - `4141e87` (task 17 follow-up fix, found in task 26)
  - `8455a73` (27)
  - `7a8510e` + `361ca1c` review fix (28)
  - `bc4b400` (29)
  - `04942fd` (30)
- **Reviews:** every task is HIGH and was reviewed alone by opus. All are approved.
  - **Task 26:** the hidden seat cannot close a notice by any path.
  - **Task 17 follow-up (found in task 26):** the "for Ali" fallback gave Ali his own inbox row, against §3.4.3 line 285. Fixed and re-reviewed (AD-106).
  - **Task 28, Important:** a poisoned alert (stored values that cannot be stepped) rolled back the whole alerts tick on every pass, so all escalation on the branch stopped. Fixed with a per-alert guard, a scan that stops at the first step not yet due, and new startup checks (AD-116, AD-117). Re-review found it addressed.
  - **Task 29:** RF-1 holds (250 alerts close as 200 + 50, each exactly once). A poisoned alert still expires.
  - **Task 30:** every statement bound passed on the first run, with no src fix needed:
    - tick: 11, bound 12; read (2) arrives in task 31
    - projection: ≤ 2 reads per event
    - raise: 7 / 9
    - `raiseMany` and `closeMany` cost the same as a single call
- **Gate:** green on the first run. 277 files passed, 1 skipped; 1736 tests passed, 1 skipped (#58).
- **Tests closed:**
  - 26: #16, #33
  - 27: #22, #37
  - 28: #4, #19, #21, #25, #34, #50
  - 29: #24, #36, #51
  - 30: #35
  - #58 is written and skipped; it stays open until it runs on the pilot mini PC (AD-9).
- **AD rows (proposed):** AD-106 to AD-122.
- **Developer decisions needed:**
  1. **How a poisoned alert is retired (AD-116).** Today it is skipped and logged on every pass, about every 500 ms. Options:
     - (a) keep skip-and-log;
     - (b) close it, which needs a new close reason;
     - (c) the projection sets `next_due_at` NULL.
  2. **A request kind with `closes_on.after_ms`.** The spec allows it. Such a request never closes and keeps the tick pre-check true forever, and 200 of them would fill the `LIMIT 200` select. Options:
     - (a) a startup error (recommended);
     - (b) `next_due_at` ignores `after_ms` for requests.
  3. **#58 performance.** A forced run on the dev laptop (i7-4900MQ): tick `writer.run` takes 81.5 ms against the §7 target of 50 ms, while a raise takes 0.74 ms against 5 ms. Most of the time is per-call `db.prepare` in the projection, 5 per `AttemptSent`. Run #58 on the mini PC early. If it misses, rule on per-db prepared-statement caching, which would be a new hub pattern.
  4. **AD-88 (from batch 5):** receipts for closed alerts are accepted.
- **Carried to later tasks:**
  - **Task 31:**
    - Raise `TICK_TODAY` 11 → 12 (read (2)).
    - The flag pass must exclude ids closed `expired` in the same pass.
    - The `no_approver` flag is seeded dirty, which causes an empty `writer.run` every 500 ms until task 31. Task 31's test must show a booted hub reaching an idle pass.
  - **Task 32:** re-assert #49 `alerts_open` with real rows; the header must check `route`.
  - **Task 38:** prune the receipt sets.
- **Deferred minors (for the final review):**
  - (26) A vacuous "closes nothing for Ali" test.
  - (26) The 00 registry silently replaces a duplicate `register`.
  - (27) The boot "stops on close" check is vacuous.
  - (27) The EXPLAIN test uses a copy of the SQL.
  - (28) The projection NULLs `next_due_at` with no log line.
  - (28) A misleading skip log message.
  - (29) No tie-breaker in the due select.
  - (29) The mixed-pass statement count is not asserted.
  - (30) The fake pager assertion is loose.

## Batch 7 — Ruling follow-ups, warnings, alert mode, test alert, queries (2026-11-02)

- **Ruling follow-ups (before task 31):**
  - `717894d`: AD-124, a startup error for `after_ms` on a request kind.
  - `f30d252`: AD-123, a poisoned alert is retired with `next_due_at` NULL and one log line, plus a "Stuck alerts: N" count on `config-status`. This changes 01a §6.21, which is folded at task 44.
  - `43dead3`: AD-125, the per-db statement cache.
  - The two reviews (AD-123/124 together, then AD-125) both approved.
- **#58 numbers (AD-125), dev laptop i7-4900MQ:**
  - Tick `writer.run` for 200 due alerts and 10 sockets went from 78–89 ms to 36.6 / 38.4 / 40.4 ms; the review run gave 39.8 ms. The limit is 50 ms.
  - Raise median went from 0.74–1.06 ms to 0.47–0.53 ms. The limit is 5 ms.
  - The mini PC run is still open, with 00 #79.
- **Tasks:**
  - 31: `no_approver` and BF-7
  - 32: alert-mode delivery, `alerts_open`, `binding_route_until`
  - 33: `test_alert` / `SendTestAlert`
  - 34: `alerts-inbox` and the `alerts` catch-up part, carrying AD-22, AD-23, AD-82 and `seen_by_me`
  - 35: `my-requests` and `requests-to-answer`, carrying BF-4 `from_business_day`
- **Commits:**
  - 31: `05ac0a2`, then `1f72e07` (follow-up)
  - 32: `aecbcec`, then `0449dc7` (review fix)
  - 33: `66fb1e1`
  - 34: `085701b`, then `430acc1` (review fix)
  - 35: `9cc7da7`
- **Reviews** (all opus): 31, 32 and 34 are HIGH and were reviewed alone; 33 and 35 were reviewed as a pair. All approved.
  - **31:** m1 had a hole when more than 200 alerts are due. It is fixed, and the flag-pass count is pinned at 9 / 11.
  - **32, Important:** read (9) lacked the spec's `kind = 'staff'` and branch filter, so admin-session activity kept a binding a route. Fixed (AD-129). No secret leak in alert mode.
  - **34, Important:** a seen from the hidden answering seat showed the person's open notices as `seen_by_me: true` on their other devices. Fixed (AD-138). In the same round: safe error logs (AD-148), the notice's device name (AD-147), and the cache was kept off non-hot paths.
- **Gate:** green on the first run. 283 files passed, 1 skipped; 1818 tests passed, 1 skipped (#58).
- **Tests closed:**
  - 31: #32, #59 (hub)
  - 32: #26, #28, #64, #65, and #49's `alerts_open`
  - 33: #17, #52
  - 34: #39, #42, #43, #55
  - 35: #10, #41, #53, #61 (hub)
- **AD rows (proposed):** AD-126 to AD-152, plus the as-built notes for AD-123 and AD-125.
- **Developer decisions needed:**
  - **A:** `card` with `details` on may-answer rows (catch-up, `requests-to-answer`). §3.12 says "person recipients" only (AD-142).
  - **B:** on a device that is a device target, `alerts-inbox` gives the signed-in `card` while catch-up gives lock only.
  - **C:** #55 says the personal notices reach the pager, but §3.8 skips `short_code` routes for kinds without a `short` label, and §3.10 gives the notices none. Either add `short` labels or reword #55.
  - **D:** §8.1 "Approve here" only on the raising device, but no wire field carries `raised_device_id` (task 41).
  - **The §3.5 tick bound on a dirty-flag pass (AD-131).**
- **Carried to later tasks:**
  - Task 38: prune the receipt `recorded` / `sentVia` sets.
  - Task 39: `can_answer` wins over `set: 'informed'`.
  - Task 41: `raised_device_id` (gap D).
  - Task 42: `binding_route` `lastSent` is per device, not per socket.
- **Deferred minors (for the final review):**
  - (31) A no_approver warning can be missed after closing and reopening the day within about 500 ms.
  - (32) The bounds classifier relies on the unqualified text of read (9).
  - (32) A phone's first route sends one `binding_route: null`.
  - (33) A `payload.target` cast.
  - (34) `seen_by_me` lags up to 1 s for non-requests.
  - (34) The inbox's CASE sort is not ordered by the index.
  - (35) Before the first day opens, `my-requests` lists every closed request.
  - (35) The `FROM_DAY_COLUMN` subquery is not indexed.
  - (R-b) The stuck log can fire for a rolled-back transaction.
  - (R-c) Two comments are ambiguous.

## Batch 8 — Receipt view, presence, retention (2026-11-02)

- **Tasks:**
  - 36: `alert-receipts`
  - 37: `SetPresence`
  - 38: alert retention, which also prunes the receipt sets in memory (AD-88)
- **Commits:** `5363b7b` (36), `5f0cb7d` (37), `be9e10b` (38).
- **Reviews:**
  - 36 and 37 (both NORMAL) were reviewed as a pair; 38 (HIGH) was reviewed alone. All approved; none needed a fix round.
  - Task 38 has one Important finding outside its own code, parked for the developer (AD-161). §5.1 is missing an `alert_inbox (alert_id)` index, so each cascaded delete scans the inbox. Measured per 500-alert batch:
    - about 0.5 s in steady state;
    - 5.7 s at 105 000 inbox rows;
    - 5 ms with the index.

    No code-only fix exists. Adding the index means patching the approved spec first, then one line in the unmerged 0006.
- **Gate:** green on the first run. 286 files passed, 1 skipped; 1844 tests passed, 1 skipped (#58).
- **Tests closed:**
  - 36: #46, #57 (hub, all but vi), #62
  - 37: #45
  - 38: #38
- **AD rows (proposed):** AD-153 to AD-161.
- **Developer decisions needed:**
  - **AD-161:** the `alert_inbox (alert_id)` index. Proposed: an editorial §5.1 patch, then the unmerged 0006.
  - **Gap E (AD-156):** `business_day_id` is not defined anywhere.
  - **Gap F:** a receipt is keyed without its route. When a device delivers on both its session socket and its alert-mode socket, the first one kept decides whether §6.10 shows "bound to Ali (not signed in)" or "delivered to Ali".
  - **Still open from batch 7:** gaps A–D and AD-131.
- **Deferred minors (for the final review):**
  - (36) The step-event read has no upper bound.
  - (36) `route ?? 'screen'` hides a missing audit event.
  - (37) A backward stream scan finds the open day.
  - (38) The receipt keys of an alert whose rows span two step-1 batches are dropped after the first batch (a late duplicate, harmless).
  - (00, pre-existing) The sweeper logs under the key `err` where the spec says `error`.
  - (00, pre-existing) After a failure, the sweeper retries every 15 s for the rest of the hour.
- **Next:** Batch 9a (tasks 39–42, the staff entry UI). Batch 9b is blocked on the tablet model (OQ2).

### Developer rulings after batch 8 (2026-11-02)
- AD-161: the `alert_inbox (alert_id)` index goes into the unmerged 0006, with no new migration. The §5.1 change is folded in at the as-built review.
- AD-162 (A) and AD-163 (B): one card rule everywhere (inbox, catch-up, frames). The card goes only to a person recipient, or to someone who can answer now, on their own staff session. Read-only and device-target-only viewers get the lock view.
- AD-164 (C): #55 is reworded. Personal notices are never sent on short-code routes.
- AD-165 (D): `raised_device_id` is added to the signed-in view, for requests only.
- AD-156 (E): confirmed. AD-166 (F): first-receipt-wins, noted in §6.10. AD-131: the tick bound is updated at the as-built review.
- Batch 9a design approvals: 12-hour times (AD-167). The 02 / 04 top-bar change is a carried row (AD-168).

## Batch 9a — Staff entry in the Pulse design (2026-11-02/03)

- **Server follow-ups for the rulings:**
  - `39b0ac6` AD-161: the `alert_inbox (alert_id)` index in 0006. A retention batch of 500 alerts against 105k inbox rows went from 4.87 s to 13.4 ms.
  - `fda27d6` AD-162/163: one `cardRule` for inbox, catch-up, requests-to-answer and frames.
  - `9199808` AD-165: `raised_device_id` on the signed-in view, for requests only.
  - `dc1ac99` AD-164: the #55 test now asserts that the personal notices never go to the pager.
  - Review: approved.
- **Design hand-off:** `4fa6b65` (59 frames).
- **Kit:** `2b80eb6` + `99c9089`. The Pulse staff layer (`packages/ui-kit/components/pulse-staff.css`, all rules under `:where(.pu)`, brand colours via `--brand-*`, bundled fonts, no CDN) is loaded only by the staff entry through `apps/client/src/app/ui-kit-staff.ts`. *Unattended ruling:* kit-additions.css has no 01d section, so the hand-off's pulse.css, v-brand.css and pulse-01d.css were merged instead.
- **Tasks:**
  - 39: store, sounds, labels. `fa200a2`.
  - 40: socket, alert mode, online-only PIN answers. `c9a4a3a`, `e3de05e`.
  - 39–40 fixes `3e37eca`:
    - the silent kind is now decided by kind;
    - 4409 is final;
    - an answer in flight is guarded;
    - a full reset on every session change;
    - the latest server view wins everywhere.
  - 41: `/staff/` entry and screens, hub serving, ship script. `8def8f3`.
  - 42: tablet header. `41ba3e4`.
  - 41–42 fixes `5a69e8a`:
    - the open sheet now follows the live view;
    - the inbox retries after a failure;
    - the header is approximate (AD-T42-2);
    - a focus trap;
    - toast tones;
    - a session counter;
    - Zod-parsed responses;
    - ship stages all builds before swapping.
- **Visual pass** (webapp-testing, Playwright, mocked hub): 85 states at 1280×800, 800×1280, 1920×1080 and 390×844, in English and Urdu.
  - 15 frames fixed (`1f5430a`), tests added (`042ead7`).
  - 21 frames still differ, each because of missing data, a ruling or copy: see `.superpowers` task-visual-report.
  - No page scroll at ≥1280, no horizontal scroll at 390 or 360, every target ≥ 56 px.
  - No CDN request: the fonts come from the bundle.
  - Screenshots of the main screens are in `docs/design/handoff/01d/build-screens/`.
- **Reviews** (opus):
  - Every task was reviewed, with one fix round each where needed.
  - No PIN storage or queueing, and no details leak, was found.
- **Gate:** green on the first run. 304 files and 2014 tests passed; 1 file and 1 test skipped (#58).
- **Tests closed:** #56 client, #57 client, #59 client, #61 client.
- **AD rows:** all 9a rows are in `01d-auto-decisions.md` under "Batch 9a", **unattended — developer to confirm**.
- **States built without a frame** (for the designer):
1. The sign-in PIN step: a dialog with the D02 pad and a "Sign in" key, on tablet and kiosk.
2. Sign-in roster offline: a retry line and Retry now. Roster empty: "Nobody can sign in here yet."
3. Device not paired, or the page has no meta: one read-only line.
4. Sign-in errors: DEVICE_SESSION_ACTIVE ("{name} is signed in on this device. Enter your PIN again to take over.", then the next PIN sends `takeover: true`), plus wrong PIN, locked and busy on the pad.
5. 4409 "This page is open on another tab or screen." with "Use it here" (a warnbar).
6. The Rejected / Declined done state: a red ring with an x.
7. A closed request opened from the inbox: no buttons, Close.
8. D01 for a lock-only request (no card): no fact tiles.
9. D01 B04 PERMISSION_DENIED from the PIN step: back to the detail with the danger line.
10. Approve here: the D03 loading skeleton, and in_person_elsewhere / PIN errors on the in-person PIN step.
11. Test alert: the error line (not found / denied / offline / failed), the disabled Send while nothing is picked, and the "This device" row.
12. Receipts: loading skeleton, ALERT_NOT_FOUND text, the "for {name}" note on a lead's row, and listed routes without a delivery.
13. Phone inbox: the two list cards stacked (the frame lists cards straight in `ph-body`).
14. Phone signed-out header: the branch name instead of the owner's name.
15. B06 warnbar placement in the staff entry (light, under the top bar).
16. Tablet signed out: no Live chip (no socket is open; §3.7).
17. Urdu for every new string (it falls back to English; see the todo list).
  18. S02 RequestsEmpty can't be reached: the Requests tab hides when the list is empty.
  19. B07: the stuck count stays in the /admin/stock More menu (AD-123). No banner on the 00 /admin home.
- **Known data gaps** (need an additive field or 9b; developer ruling):
  - the tablet header deadline is approximate (an absent person still shows a deadline);
  - test-alert lists show only PIN holders and "This device";
  - no approver name in the B02/D03 copy;
  - no sender in the receipts header;
  - no tenant or device name in the brand block;
  - 79 Urdu strings are still English (`docs/design/handoff/01d/urdu-todo.md`).
- **Carried rows:**
  - to 02 and 04: the Requests (n) / Inbox (n) top-bar buttons (AD-168);
  - to 9b: the Android service, notifications, lock-task, and the header source.
