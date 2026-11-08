# 02p status board

Plan: `docs/plans/02p-plan.md` (18 tasks + 17b, batches 0–6, two lanes). Spec: `docs/specs/02p_Platform_Changes_Spec_v1.0.md`, with 00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 01d v1.2.1, 03a v1.2 (all APPROVED). Branches: `module-02p-engine` (engine lane, `~/pos`) and `module-02p` (platform lane, `~/pos-cloud`).

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
1. You open the platform lane with the prompt below.
2. The engine lane runs task 17b; it needs no schema.
3. When the platform lane pushes task 1, you merge `module-02p` into `module-02p-engine`.
4. The engine lane then runs tasks 14–17.

**Decisions for the owner:** none open.

## Task table

| # | Task | Lane | Risk | Status | Commit |
|---|---|---|---|---|---|
| 0 | 03a v1.2, 01d v1.2.1, text patches | engine | — | **done** | `73ff815`…`4bffa9e` |
| 1 | Event schemas: additive fields, `StockTransferredOut` | platform | NORMAL | todo | |
| 2 | Permissions, `my_zones`, ranks, labels | platform | NORMAL | todo | |
| 3 | Cloud zones, routes, stock items, `is_ready_item`, settings columns | platform | HIGH | todo | |
| 4 | Snapshot V4, hub apply | platform | HIGH | todo | |
| 5 | `StockTransferredOut` in `stock_version`, stock frame | platform | NORMAL | todo | |
| 6 | Owner app: zones, ready item, settings | platform | NORMAL (UI) | todo | |
| 7 | Assignments, directory v3, `assignedOrderTaker` | platform | HIGH | todo | |
| 8 | `my_zones` CHECK expand, `zonesOf` | platform | HIGH | todo | |
| 9 | Default grants, re-seed, settings `PATCH` | platform | NORMAL | todo | |
| 10 | Owner app: assigned tables | platform | NORMAL (UI) | todo | |
| 11 | 00 M95 paused idle clock | platform | NORMAL | todo | |
| 12 | `X-Queued-At`, `queueable`, CORS | platform | NORMAL | todo | |
| 13 | 01d D-1, D-3 | platform | NORMAL | todo | |
| 17b | 03a carry-over (open item 13: gaps 1, 2, 4, 5, 7) | engine | NORMAL | todo | |
| 14 | Q-1 reader pair, Q-2 key, label, bound | engine | NORMAL | todo (needs task 1 merged) | |
| 15 | Q-3 zone lines, filter, boot id set | engine | HIGH | todo (needs task 1 merged) | |
| 16 | Q-4 partial `ItemRemoved` | engine | NORMAL | todo (needs task 1 merged) | |
| 17 | Q-5 `StockTransferredOut` fold, Q-6 `ItemServed` | engine | HIGH | todo (needs task 1 merged) | |
| 18 | Simulator gate, full gate, README | engine | NORMAL | todo (needs both lanes merged) | |

## AD rows

| # | Task | Reading | Options | Choice | Status |
|---|---|---|---|---|---|
| — | | *(none yet)* | | | |

New rows get status **"proposed (not yet ruled)"**. The owner rules them in batches.

## Owner rulings (this sprint)

| Date | Ruling | Where |
|---|---|---|
| 2026-11-08 | R-1 `registerSlipReaders`; `fires_alerts` bound 2 + ≤ 2 + ≤ 1 + 01d (test 121) | 03a v1.2 |
| 2026-11-08 | R-2 slip label = the primary table's **name** (field `table_code`); 01d P-1 chip `T…` only for all-digit values | 03a v1.2, 01d v1.2.1 |
| 2026-11-08 | R-3 one boot read, step 3 = 4 + 2 + 1, from the older of two **readable** checkpoints, else seq 0 (T-6, re-check R-2) | 03a v1.2 §3.12 |
| 2026-11-08 | Q-v1.2-2 (absent-id noise on exited orders) left for the 04 spec | 03a v1.2 §12.3 |

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

## Platform-lane prompt (for the owner to paste into a new session)

```
You are the lead of the PLATFORM LANE of sprint 02p (Platform Changes) of the restaurant POS (arsiihere/pos).

Setup:
- Work in the worktree ~/pos-cloud. It is on module-03a-hub3 today. Run:
  `cd ~/pos-cloud && git fetch origin && git switch -c module-02p origin/module-02p-engine`
  (the plan and the approved specs are on that branch).
- Branch module-02p. Push only with `git push origin module-02p`. Never merge, force-push, push to main, reset or rebase: merges are the owner's.
- Cloud tests use DATABASE_URL=postgres://pos:pos@127.0.0.1:5433/pos_test_cloud. The engine lane uses …/pos_test; never touch it.
  If pos_test_cloud does not exist, create it once:
  `docker exec pos-pg-test psql -U pos -c 'CREATE DATABASE pos_test_cloud'`.
  The test container `pos-pg-test` runs with fsync off. Never stop, restart or `compose down` it.
- The full gate is shared with the engine lane. Run it only as:
  `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` (≈ 9 min).
  Never run `pnpm test:perf`.

Read first, in order:
1. CLAUDE.md (incl. "Test environment")
2. docs/specs/README.md
3. docs/specs/02p_Platform_Changes_Spec_v1.0.md
4. docs/plans/02p-plan.md: your tasks are 1–13 (batches 1–4)
5. docs/plans/02p-status.md
6. the bumped spec each task cites (00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 01d v1.2.1, 03a v1.2 §4.2 for the event fields)

Build:
- superpowers:subagent-driven-development + superpowers:test-driven-development.
- One fresh implementer and one fresh reviewer per task; an opus reviewer for HIGH tasks (3, 4, 7, 8).
- One task per commit, citing the row and §, e.g. `feat(01b): my_zones scope [01b v1.7 B-3; 02p §11 #8]`.
- Full gate after each batch. Then write the batch entry in docs/plans/02p-status.md, commit it alone, and push.
- **Push task 1 as soon as it is green and tell the owner.** The owner merges it into module-02p-engine so the engine lane can start tasks 14–17.
- Edit only the files of your tasks. The engine lane owns packages/engine and apps/hub/src/engine-host; never touch them.

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
