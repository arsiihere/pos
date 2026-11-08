# 02p status board

Plan: `docs/plans/02p-plan.md` (18 tasks + 17b, batches 0–6, three lanes; owner, 2026-11-08). This board covers platform A (tasks 1–10) and the engine lane; platform B (tasks 11–13) keeps `docs/plans/02p-status-hub.md`. Spec: `docs/specs/02p_Platform_Changes_Spec_v1.0.md`, with 00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 01d v1.2.1, 03a v1.2 (all APPROVED). Branches: `module-02p-engine` (engine lane, `~/pos`), `module-02p` (platform A, `~/pos-cloud`), `module-02p-hub` (platform B, own worktree).

> **Short Hinglish summary — padhein yahan se**
>
> **Plan likh diya (2026-11-08):**
> - Task 0 mukammal hai: 03a v1.2 aur 01d v1.2.1 APPROVED.
> - Plan mein 18 tasks hain, do lanes mein: platform (tasks 1–13) aur engine (14–17, saath mein 03a ke purane gaps, task 17b).
> - Task 18 dono lanes merge hone ke baad chalega.
> - Aapki approval ka intezar hai. Approval ke baad platform lane ka prompt neeche hai.

## MORNING REPORT (2026-11-08): task 0 done; plan written; STOPPED for plan approval

**Head:** `module-02p-engine`, plan commit (see the git log). Nothing merged.

**Done:**
- Task 0: 03a v1.2 and 01d v1.2.1 APPROVED (owner, 2026-11-08), at `4bffa9e`.
- Targeted check: `docs/reviews/02p_task0_targeted_check.md`. Re-check: `docs/reviews/02p_task0_recheck.md`.
- Plan `docs/plans/02p-plan.md` and this board.

**Blocks:** none. The plan is waiting for approval.

**Next, after approval:**
1. You open platform A and platform B with the two prompts below.
2. The engine lane runs task 17b; it needs no schema.
3. When the platform lane pushes task 1, you merge `module-02p` into `module-02p-engine`.
4. The engine lane then runs tasks 14–17.

**Decisions for the owner:** none open.

## PLATFORM A REPORT (2026-11-08): batch 1 done (tasks 1, 2), gate green, pushed

> **Hinglish:** Batch 1 mukammal. Task 1 (`3db9ce1`) pehle push hua — engine lane mein merge kar sakte hain. Task 2 (`a4a6f73`, `a49d8cc`) bhi done. Gate green (3227 tests). Teen AD rows aapke faisle ke liye (AD-1, AD-2, AD-3). Agla: batch 2 (tasks 3–6).

**Head:** `module-02p`. **Blocks:** none. **Decisions for the owner:** none open (AD-1–AD-3 ruled 2026-11-08; AD-1 fix `0205a24`, AD-3 `b55c7d9`). Batch 2 in progress.

## Task table

| # | Task | Lane | Risk | Status | Commit |
|---|---|---|---|---|---|
| 0 | 03a v1.2, 01d v1.2.1, text patches | engine | — | **done** | `73ff815`…`4bffa9e` |
| 1 | Event schemas: additive fields, `StockTransferredOut` | platform A | NORMAL | **done** (pushed) | `3db9ce1` |
| 2 | Permissions, `my_zones`, ranks, labels | platform A | NORMAL | **done** | `a4a6f73`, `a49d8cc` |
| 3 | Cloud zones, routes, stock items, `is_ready_item`, settings columns | platform A | HIGH | todo | |
| 4 | Snapshot V4, hub apply | platform A | HIGH | todo | |
| 5 | `StockTransferredOut` in `stock_version`, stock frame | platform A | NORMAL | todo | |
| 6 | Owner app: zones, ready item, settings | platform A | NORMAL (UI) | todo | |
| 7 | Assignments, directory v3, `assignedOrderTaker` | platform A | HIGH | todo | |
| 8 | `my_zones` CHECK expand, `zonesOf` | platform A | HIGH | todo | |
| 9 | Default grants, re-seed, settings `PATCH` | platform A | NORMAL | todo | |
| 10 | Owner app: assigned tables | platform A | NORMAL (UI) | todo | |
| 11 | 00 M95 paused idle clock | platform A (batch 4; B not opened) | NORMAL | todo | |
| 12 | `X-Queued-At`, `queueable`, CORS | platform A (batch 4; B not opened) | NORMAL | todo | |
| 13 | 01d D-1, D-3 | platform A (batch 4; B not opened) | NORMAL | todo | |
| 17b | 03a carry-over (open item 13: gaps 1, 2, 4, 5, 7) | engine | NORMAL | todo | |
| 14 | Q-1 reader pair, Q-2 key, label, bound | engine | NORMAL | todo (needs task 1 merged) | |
| 15 | Q-3 zone lines, filter, boot id set | engine | HIGH | todo (needs task 1 merged) | |
| 16 | Q-4 partial `ItemRemoved` | engine | NORMAL | todo (needs task 1 merged) | |
| 17 | Q-5 `StockTransferredOut` fold, Q-6 `ItemServed` | engine | HIGH | todo (needs task 1 merged) | |
| 18 | Simulator gate, full gate, README | engine | NORMAL | todo (needs all three lanes merged) | |

## AD rows

| # | Task | Reading | Options | Choice | Status |
|---|---|---|---|---|---|
| AD-1 | 1 | `StockTransferredOut.quantity` is `z.number().positive()` (plan "number > 0"). 01a v2.3 / 02b / 03a give no type; `StockAdded` v2 is `int().min(1).max(1_000_000)`, and 02b's refill is `draw × quantity` of ints | (a) keep `positive()`; (b) `int().min(1)` like `StockAdded` | (b) — fixed in `0205a24` (01a S44) | **ruled (owner, 2026-11-08)** |
| AD-2 | 2 | Files outside the brief's list, all forced by the task: `people.test.ts` (new, client half of the `WIDTH` test the brief names), `RoleEditor.test.tsx` (orders-group counts 4→9, 3→8: group grew 6→11), `docs/design/handoff/01b/urdu-todo.md` (Urdu goes to the to-do list, n-5); extra label `roles.scope_help.my_zones` (`RoleEditor.tsx` needs it to typecheck). English label wording is ours (no spec text) | (a) keep; (b) revert and re-plan | (a) | **accepted (owner, 2026-11-08)** |
| AD-3 | 2 | `ZONE_NOT_FOUND` is in `errors.ts` but not yet in the foundation §6.2 404 list (CLAUDE.md: "append them to the foundation §6.2 list"; R34: no bump). 02p task 2's file list names only `errors.ts` | (a) append it to foundation v1.11 §6.2 in a small docs commit now; (b) leave it to task 18's "spec text" | (a) — appended in `b55c7d9` | **accepted (owner, 2026-11-08)** |

New rows get status **"proposed (not yet ruled)"**. The owner rules them in batches.

## Owner rulings (this sprint)

| Date | Ruling | Where |
|---|---|---|
| 2026-11-08 | R-1 `registerSlipReaders`; `fires_alerts` bound 2 + ≤ 2 + ≤ 1 + 01d (test 121) | 03a v1.2 |
| 2026-11-08 | R-2 slip label = the primary table's **name** (field `table_code`); 01d P-1 chip `T…` only for all-digit values | 03a v1.2, 01d v1.2.1 |
| 2026-11-08 | R-3 one boot read, step 3 = 4 + 2 + 1, from the older of two **readable** checkpoints, else seq 0 (T-6, re-check R-2) | 03a v1.2 §3.12 |
| 2026-11-08 | Q-v1.2-2 (absent-id noise on exited orders) left for the 04 spec | 03a v1.2 §12.3 |
| 2026-11-08 | Plan APPROVED; three lanes (platform A 1–10, platform B 11–13, engine 14–17, 17b, 18); `boot.int.test.ts` owned by platform A, engine boot tests in `boot-idset.int.test.ts` | plan |
| 2026-11-08 | AD-1: `StockTransferredOut.quantity` = `int().min(1)` (01a S44), fixed now (`0205a24`); AD-2 accepted; AD-3 accepted, `ZONE_NOT_FOUND` appended to foundation v1.11 §6.2, no bump (`b55c7d9`); the `my_zones` 500 until task 8 accepted (transient on this branch) | board, foundation §6.2 |

## Batch entries

*(one per checkpoint, newest last)*

```
## Batch N — <title> (<date>)

- **Lane / tasks:** …
- **Commits:** `<sha>` (task), …
- **Reviews:** per task; HIGH by opus. Findings and fix commits.
- **Gate:** TMPDIR=/dev/shm flock … — <files>, <tests>, <wall time>.
- **Tests closed:** …
- **AD rows (proposed):** …
- **Carried:** …
```

## Batch 1 — shared types and schemas (2026-11-08)

- **Lane / tasks:** platform A, tasks 1, 2.
- **Commits:** `3db9ce1` (task 1, pushed right away for the engine merge), `a4a6f73` (task 2), `a49d8cc` (task 2 review fix).
- **Reviews:** both by opus. Task 1: approved, no Critical / Important (minor: the fixture sweep asserts only "parses", a reject test carries the `#129` label, `quantity` type → AD-1). Task 2: approved; one Important, plan-mandated: a `my_zones` grant passes Zod and the service check but hits the old cloud CHECK (`0005_staff_roles.sql:68`) → 500 until task 8's expand migration; closes in batch 3. Fix round 1 (sonnet re-review, approved): `already_assigned` in `REASONS_01B`, `my_zones` help text names the lead.
- **Gate:** `TMPDIR=/dev/shm DATABASE_URL=…/pos_test_cloud flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` — exit 0; 362 files passed, 1 skipped; 3227 tests passed, 1 skipped, 1 todo; 8 m 44 s.
- **Tests closed:** U-5 schema part (C-1, E-1, Q-4, Q-6, Q-9, Q-5 schema), 03a #129; U-4 catalogue, scope sets, ranks, labels.
- **AD rows (proposed):** AD-1, AD-2, AD-3.
- **Carried:** the `my_zones` 500 until task 8.

## Platform A prompt (for the owner to paste into a new session)

```
You are the lead of PLATFORM A of sprint 02p (Platform Changes) of the restaurant POS (arsiihere/pos).

Setup:
- Work in the worktree ~/pos-cloud. It is on module-03a-hub3 today. Run:
  `cd ~/pos-cloud && git fetch origin && git switch -c module-02p origin/module-02p-engine`
  (the plan and the approved specs are on that branch).
- Branch module-02p. Push only with `git push origin module-02p`. Two other lanes run in parallel: the engine lane (~/pos, module-02p-engine) and platform B (module-02p-hub, tasks 11–13). Never merge, force-push, push to main, reset or rebase: merges are the owner's.
- Cloud tests use DATABASE_URL=postgres://pos:pos@127.0.0.1:5433/pos_test_cloud. The engine lane uses …/pos_test and platform B …/pos_test_hub; never touch them.
  If pos_test_cloud does not exist, create it once:
  `docker exec pos-pg-test psql -U pos -c 'CREATE DATABASE pos_test_cloud'`.
  The test container `pos-pg-test` runs with fsync off. Never stop, restart or `compose down` it.
- The full gate is shared with the other two lanes. Run it only as:
  `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` (≈ 9 min).
  Never run `pnpm test:perf`.

Read first, in order:
1. CLAUDE.md (incl. "Test environment")
2. docs/specs/README.md
3. docs/specs/02p_Platform_Changes_Spec_v1.0.md
4. docs/plans/02p-plan.md: your tasks are 1–10 (batches 1–3); read its "File ownership" paragraph
5. docs/plans/02p-status.md
6. the bumped spec each task cites (00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 01d v1.2.1, 03a v1.2 §4.2 for the event fields)

Build:
- superpowers:subagent-driven-development + superpowers:test-driven-development.
- One fresh implementer and one fresh reviewer per task; an opus reviewer for HIGH tasks (3, 4, 7, 8).
- One task per commit, citing the row and §, e.g. `feat(01b): my_zones scope [01b v1.7 B-3; 02p §11 #8]`.
- Full gate after each batch. Then write the batch entry in docs/plans/02p-status.md, commit it alone, and push.
- **Push task 1 as soon as it is green and tell the owner.** The owner merges it into module-02p-engine so the engine lane can start tasks 14–17.
- **Tell the owner when task 4 is pushed.** The owner merges module-02p into module-02p-hub so platform B can start task 11.
- Edit only the files of your tasks (plan "File ownership"). Under apps/hub/test/engine/ you own exactly boot.int.test.ts and stock-audiences.int.test.ts (task 5). The engine lane owns packages/engine, apps/hub/src/engine-host and every other file under apps/hub/test/engine/. Platform B owns the session, command-route, CORS and alerts files of tasks 11–13. Never touch theirs.

Stop rules:
1. Spec and code disagree, or two specs disagree → STOP, ask with options and your recommendation.
2. A test needs a timeout raised or a bound changed → STOP.
3. You would edit a file outside the task (or outside 02p §10 Acceptance) → STOP.
4. A review fix round would go past 2 → STOP.
5. Any new behaviour not in a spec → STOP (spec-first).
Record readings you make without stopping as AD-n rows in docs/plans/02p-status.md, status "proposed (not yet ruled)". Never accept your own readings.

Reports: short. Commits done, what blocks, decisions for the owner as a numbered list, one line each, with your recommendation. The owner reads Hinglish; keep it plain.

Start with batch 1 (tasks 1, 2).
```

## Platform B prompt (for the owner to paste into a new session)

```
You are the lead of PLATFORM B of sprint 02p (Platform Changes) of the restaurant POS (arsiihere/pos).

Setup:
- Use your own worktree (suggested: `git -C ~/pos worktree add ~/pos-hub -b module-02p-hub origin/module-02p-engine`; the owner may pick another path). The plan and the approved specs are on that branch.
- Branch module-02p-hub. Push only with `git push origin module-02p-hub`. Never merge, force-push, push to main, reset or rebase: merges are the owner's. Two other lanes run in parallel: the engine lane (~/pos, module-02p-engine) and platform A (~/pos-cloud, module-02p, tasks 1–10).
- Tests that need Postgres use DATABASE_URL=postgres://pos:pos@127.0.0.1:5433/pos_test_hub. If it does not exist, create it once: `docker exec pos-pg-test psql -U pos -c 'CREATE DATABASE pos_test_hub'`. Never touch pos_test or pos_test_cloud. Never stop, restart or `compose down` pos-pg-test (fsync off).
- The full gate is shared with the other two lanes. Run it only as:
  `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` (≈ 9 min). Never run `pnpm test:perf`.

Read first, in order:
1. CLAUDE.md (incl. "Test environment")
2. docs/specs/README.md
3. docs/specs/02p_Platform_Changes_Spec_v1.0.md
4. docs/plans/02p-plan.md: your tasks are 11, 12, 13 (batch 4); read its "File ownership" paragraph
5. docs/specs/00_Hub_Platform_Access_Spec_v1.8.md (M95, tests 152–158) and docs/specs/01d_Notifications_Requests_Spec_v1.2.1.md (D-1, D-3, test 25)

Build:
- superpowers:subagent-driven-development + superpowers:test-driven-development. One fresh implementer and one fresh reviewer (opus) per task.
- Order: 12, 13, then 11. Task 11 reads BranchConfig.settings.queue_auto_send_max_ms, which platform A's task 4 adds: start 11 only after the owner has merged module-02p (with task 4) into module-02p-hub.
- One task per commit, citing the row and §, e.g. `feat(00): X-Queued-At and queueable commands [00 v1.8 H-1; 02p §11 #12]`.
- Full gate after the batch. Then write the batch entry in docs/plans/02p-status-hub.md (your own board; AD rows are numbered AD-H1, AD-H2, …), commit it alone, and push.
- Edit only the files of your tasks. Never touch packages/*, apps/cloud, apps/client, migrations, hub engine-host or apps/hub/test/engine/.

Stop rules:
1. Spec and code disagree, or two specs disagree → STOP, ask with options and your recommendation.
2. A test needs a timeout raised or a bound changed → STOP.
3. You would edit a file outside the task (or outside 02p §10 Acceptance) → STOP.
4. A review fix round would go past 2 → STOP.
5. Any new behaviour not in a spec → STOP (spec-first).
Record readings you make without stopping as AD-H rows in docs/plans/02p-status-hub.md, status "proposed (not yet ruled)". Never accept your own readings.

Reports: short. Commits done, what blocks, decisions for the owner as a numbered list, one line each, with your recommendation. The owner reads Hinglish; keep it plain.

Start with task 12.
```
