# 02a — parallel waves: what to open and what to paste

Plan: `docs/plans/02a-plan.md` §"Parallel waves". Repo checkout: `~/pos` (the integrator's). Lane worktrees: `~/pos-02a-A` … `~/pos-02a-D` (the integrator creates them).

**Hand-off without the owner in the middle:** a lane that finishes sets a **local** tag `02a-lane-<N><X>-done` on its last commit. Lane B of wave 2 also tags its task 12 commit `02a-task12`. The integrator and lanes 2C / 2D wait for those tags themselves (check every 2 minutes). Tags are never pushed (only the branch `module-02a` is pushed).

## Terminals

| When | Terminals open | What runs |
|---|---|---|
| Wave 0 | **1** | Integrator (builds tasks 1, 1b, 2, 3, 3b itself) |
| Wave 1 | **4** | Integrator + lanes A, B, C |
| Wave 2 | **5** | Integrator + lanes A, B, C, D |
| Wave 3 | **1** | Integrator (builds task 19 itself) |

The integrator session stays open for the whole build. Lane sessions are new for each wave.

---

## §1. Integrator instructions

```text
You are the 02a INTEGRATOR. Repo ~/pos, branch module-02a (git fetch origin; git checkout module-02a; git pull --ff-only).
Read CLAUDE.md, docs/plans/02a-plan.md (especially "Spec gaps — ruled" and "Parallel waves") and docs/plans/02a-status.md.

Never push anything but the branch module-02a (git push origin module-02a; never push tags). No merge, rebase, reset or force-push. Never run pnpm test:perf. Never stop or restart the pos-pg-test container.

WAVE 0 now: build tasks 1, 1b, 2, 3, 3b yourself, in that order, with superpowers:subagent-driven-development + superpowers:test-driven-development (one fresh implementer and one fresh reviewer per task; opus for RISK: HIGH; failing test first; one task per commit, message as the task says; author "Arslan Ahmed Arif" <arsiiahmi@gmail.com>). Then run the gate:
TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"
Write "Wave 0" on the board, commit "docs(02a): checkpoint wave 0", push module-02a, STOP.

When I say "wave N" (1 or 2):
1. Remove last wave's worktrees if any (git worktree remove ~/pos-02a-<X>; git branch -D lane-<prev><X>).
2. For each lane X of wave N in the plan's ownership table: git worktree add -b lane-NX ~/pos-02a-X module-02a, then (cd ~/pos-02a-X && pnpm install --frozen-lockfile). Tell me the lanes are ready.
3. Then wait for the lanes yourself: every 2 minutes check the local tags (git tag -l '02a-*'). Wave 2: as soon as tag 02a-task12 exists, cherry-pick that commit onto module-02a first and push. As soon as tag 02a-lane-NX-done exists, land that lane: list its own commits with git cherry -v module-02a 02a-lane-NX-done (take only '+' lines, oldest first; '-' lines are patches already on module-02a, e.g. a cherry-picked task 12) and cherry-pick them onto module-02a in that order. Skip a lane's own copy of a shared task (e.g. its cherry-pick of task 12) when it matches the commit already on module-02a by content, even if git cherry shows it as '+' (a resolved index.ts hunk changes the patch-id); note the skip in the wave entry (owner, 2026-11-10, AD-21). Resolve only additive conflicts in apps/hub/src/tables/index.ts; also (owner standing rule, 2026-11-10) a conflict made only of added lines that are each already allowed by an owner ruling, with no existing line changed → keep all of them in lane order and note it in the wave entry; any other conflict → STOP and tell me. After each lane: that lane's test files and pnpm --filter @pos/hub typecheck on module-02a, then push module-02a.
4. When every lane of the wave is landed: the gate, the wave checkpoint per the plan's table (§12.2 rows, statement counts), "Wave N" on the board, commit "docs(02a): checkpoint wave N", push, STOP.
If a lane has not tagged after 3 hours, tell me and keep waiting.

When I say "wave 3": build task 19 yourself (same skills), then the wave 3 checkpoint, push, STOP.

Spec–code mismatch, a file outside the ownership table, a contract change in tables/contracts.ts, a changed bound or new behaviour → STOP and add a row to docs/plans/02a-status.md ("proposed (not yet ruled)").
```

## §2. Lane instructions

```text
You are lane <N><X> of the 02a parallel build. Your worktree is this directory, on local branch lane-<N><X>. Your tasks are in the plan's ownership table, row wave <N> lane <X>. Read CLAUDE.md, docs/plans/02a-plan.md ("Spec gaps — ruled", "Parallel waves" — rules 1–6 and the ownership table — and the text of your tasks) and docs/plans/02a-status.md.

Build only your tasks, in order, with superpowers:subagent-driven-development + superpowers:test-driven-development: one fresh implementer and one fresh reviewer per task (opus for RISK: HIGH), failing test first, one task per commit with the message the task gives, author "Arslan Ahmed Arif" <arsiiahmi@gmail.com>.

Hard rules:
- Edit only the files your lane owns in the ownership table, plus your own one-line registrations in apps/hub/src/tables/index.ts.
- Never edit apps/hub/src/tables/contracts.ts. If you need it changed: STOP, say why, and stop the lane.
- Tests run on the real 0012 tables (seed rows with SQL or append real events); never mock another lane's code.
- Run only your own test files, pnpm --filter @pos/hub typecheck and pnpm --filter @pos/hub typecheck:tests. Never run the full gate, never run pnpm test:perf, never stop or restart pos-pg-test.
- Never push, merge, rebase or reset. Commit only on lane-<N><X>. Tags are local only.
- Spec–code mismatch, a two-spec conflict, a changed bound or new behaviour → STOP and tell me.

Wave 2 lane B only: right after task 12's commit is reviewed, run git tag 02a-task12 <its sha>, then go on with task 13.
Wave 2 lanes C and D only: your "pending handover closed obsolete" clauses need task 12. Build everything else first; then wait for tag 02a-task12 (check git tag -l 02a-task12 every 2 minutes), wait until git cherry module-02a 02a-task12 shows the task 12 commit as '-' (it is on module-02a), then git cherry-pick 02a-task12 into your branch and finish those clauses. Do not finish before they pass.

When every task of yours is committed and reviewed: git tag 02a-lane-<N><X>-done (on your last commit), print "LANE <N><X> DONE", and stop.
```

---

## §3. Copy-paste sheet

Every block: open a new terminal, paste the shell lines, then when Claude Code opens, paste the one-line prompt under it.

### Wave 0 — 1 terminal

```bash
cd ~/pos && git fetch origin && git checkout module-02a && git pull --ff-only && claude
```
Prompt:
```text
Act as the integrator: follow docs/plans/02a-parallel-prompts.md §1 exactly. Start with wave 0.
```
Wait for its STOP ("checkpoint wave 0" pushed). Review, then type in the same terminal: `wave 1`. Wait until it says the lanes are ready.

### Wave 1 — 3 more terminals

```bash
cd ~/pos-02a-A && claude
```
```text
Follow docs/plans/02a-parallel-prompts.md §2 exactly as lane 1A (wave 1, lane A).
```

```bash
cd ~/pos-02a-B && claude
```
```text
Follow docs/plans/02a-parallel-prompts.md §2 exactly as lane 1B (wave 1, lane B).
```

```bash
cd ~/pos-02a-C && claude
```
```text
Follow docs/plans/02a-parallel-prompts.md §2 exactly as lane 1C (wave 1, lane C).
```

Nothing to relay: the integrator lands the lanes by itself. When it STOPs with "checkpoint wave 1", close the three lane terminals, review, then type in the integrator: `wave 2`. Wait until it says the lanes are ready.

### Wave 2 — 4 more terminals

```bash
cd ~/pos-02a-A && claude
```
```text
Follow docs/plans/02a-parallel-prompts.md §2 exactly as lane 2A (wave 2, lane A).
```

```bash
cd ~/pos-02a-B && claude
```
```text
Follow docs/plans/02a-parallel-prompts.md §2 exactly as lane 2B (wave 2, lane B).
```

```bash
cd ~/pos-02a-C && claude
```
```text
Follow docs/plans/02a-parallel-prompts.md §2 exactly as lane 2C (wave 2, lane C).
```

```bash
cd ~/pos-02a-D && claude
```
```text
Follow docs/plans/02a-parallel-prompts.md §2 exactly as lane 2D (wave 2, lane D).
```

When the integrator STOPs with "checkpoint wave 2", close the four lane terminals, review, then type in the integrator: `wave 3`.

### Wave 3 — integrator only

It builds task 19, writes "checkpoint wave 3" and STOPs. Hub done. (Client = batch 5, after the design handoff.)

### Only if a session STOPs with a question

Answer it in that terminal. If it is a ruling, also tell the integrator so it goes on the board.
