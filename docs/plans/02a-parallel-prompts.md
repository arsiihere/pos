# 02a — parallel waves: what to open and what to paste

Plan: `docs/plans/02a-plan.md` §"Parallel waves". Repo checkout: `~/pos` (the integrator's). Lane worktrees: `~/pos-02a-A` … `~/pos-02a-D` (the integrator creates them).

## Terminals

| When | Terminals open | What runs |
|---|---|---|
| Wave 0 | **1** | Integrator (builds tasks 1, 1b, 2, 3, 3b itself) |
| Wave 1 | **4** | Integrator + lanes A, B, C |
| Wave 2 | **5** | Integrator + lanes A, B, C, D |
| Wave 3 | **1** | Integrator (builds task 19 itself) |

The integrator session stays open for the whole build. Lane sessions are new for each wave (close the old ones when the wave checkpoint is pushed). Between waves you review the checkpoint and say "go" to the integrator.

Your loop: paste the integrator prompt → it builds wave 0 and STOPs → you review → tell it "wave 1" → it creates the worktrees and tells you → open the lane terminals and paste the lane prompts → each lane ends with a line `LANE 1X DONE: <shas>` → copy that line into the integrator → when all lanes are in, it lands them, runs the gate, writes the checkpoint and STOPs → repeat.

---

## 1. Integrator (terminal 1, `cd ~/pos`)

```text
You are the 02a INTEGRATOR. Repo ~/pos, branch module-02a (git fetch origin; git checkout module-02a; git pull --ff-only).
Read CLAUDE.md, docs/plans/02a-plan.md (especially "Spec gaps — ruled" and "Parallel waves") and docs/plans/02a-status.md.

Never push anything but module-02a. No merge, rebase, reset or force-push. Never run pnpm test:perf. Never stop or restart the pos-pg-test container.

WAVE 0 now: build tasks 1, 1b, 2, 3, 3b yourself, in that order, with superpowers:subagent-driven-development + superpowers:test-driven-development (one fresh implementer and one fresh reviewer per task; opus for RISK: HIGH; failing test first; one task per commit, message as the task says; author "Arslan Ahmed Arif" <arsiiahmi@gmail.com>). Then run the gate:
TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"
Write "Wave 0" on the board, commit "docs(02a): checkpoint wave 0", push module-02a, STOP.

When I say "wave N" (1 or 2):
1. Remove last wave's worktrees (git worktree remove ~/pos-02a-<X>; git branch -D lane-<prev><X>).
2. For each lane X of wave N in the plan's ownership table: git worktree add -b lane-NX ~/pos-02a-X module-02a, then (cd ~/pos-02a-X && pnpm install --frozen-lockfile). Tell me which lanes are ready, then wait.
3. I will paste lines "LANE NX DONE: <sha> <sha> …". For each, in the plan's cherry-pick order (wave 2: lane B's task 12 first, as soon as it arrives): git cherry-pick <sha> onto module-02a. Resolve only additive conflicts in apps/hub/src/tables/index.ts; any other conflict → STOP and tell me. After each lane, run that lane's test files and pnpm --filter @pos/hub typecheck on module-02a; push module-02a.
4. When every lane of the wave is landed: the gate, the wave checkpoint per the plan's table (§12.2 rows, statement counts), "Wave N" on the board, commit "docs(02a): checkpoint wave N", push, STOP.

When I say "wave 3": build task 19 yourself (same skills), then the wave 3 checkpoint, push, STOP.

Spec–code mismatch, a file outside the ownership table, a contract change in tables/contracts.ts, a changed bound or new behaviour → STOP and add a row to docs/plans/02a-status.md ("proposed (not yet ruled)").
```

---

## 2. Lane prompt (one terminal per lane, `cd ~/pos-02a-<X>`)

Paste this and change only the first line (wave number, lane letter, tasks — from the table below).

```text
WAVE <N>, LANE <X>, TASKS <list>.
You are one lane of the 02a parallel build. Your worktree is this directory, on local branch lane-<N><X>. Read CLAUDE.md, docs/plans/02a-plan.md ("Spec gaps — ruled", "Parallel waves" — rules 1–6 and the ownership table — and the text of your tasks) and docs/plans/02a-status.md.

Build only your tasks, in order, with superpowers:subagent-driven-development + superpowers:test-driven-development: one fresh implementer and one fresh reviewer per task (opus for RISK: HIGH), failing test first, one task per commit with the message the task gives, author "Arslan Ahmed Arif" <arsiiahmi@gmail.com>.

Hard rules:
- Edit only the files your lane owns in the ownership table, plus your own one-line registrations in apps/hub/src/tables/index.ts.
- Never edit apps/hub/src/tables/contracts.ts. If you need it changed: STOP, say why, and stop the lane.
- Tests run on the real 0012 tables (seed rows with SQL or append real events); never mock another lane's code.
- Run only your own test files and pnpm --filter @pos/hub typecheck. Never run the full gate, never run pnpm test:perf, never stop or restart pos-pg-test.
- Never push, merge, rebase or reset. Commit only on lane-<N><X>.
- Spec–code mismatch, a two-spec conflict, a changed bound or new behaviour → STOP and tell me (I add the row to the board).
<WAVE 2, LANES C and D only:> Your "pending handover closed obsolete" clauses need lane B's task 12. When I tell you its sha is on module-02a, run git cherry-pick <sha> into your branch, then finish those clauses. Do not report DONE before they pass.

When every task of yours is committed and reviewed, print exactly one final line:
LANE <N><X> DONE: <sha of task 1> <sha of task 2> …
(your own task commits only, oldest first; not any commit you cherry-picked from module-02a). Then stop.
```

### What to put on the first line

| Wave | Lane | First line |
|---|---|---|
| 1 | A | `WAVE 1, LANE A, TASKS 4, 5.` |
| 1 | B | `WAVE 1, LANE B, TASKS 6, 8.` |
| 1 | C | `WAVE 1, LANE C, TASKS 7, 11.` |
| 2 | A | `WAVE 2, LANE A, TASKS 9, 10.` |
| 2 | B | `WAVE 2, LANE B, TASKS 12, 13.` |
| 2 | C | `WAVE 2, LANE C, TASKS 14, 15, 16.` |
| 2 | D | `WAVE 2, LANE D, TASKS 17, 18.` |

For wave 2 lanes C and D keep the "WAVE 2, LANES C and D only" paragraph (drop the angle-bracket label); for every other lane delete that paragraph.

---

## 3. Short messages you send

| To | When | Message |
|---|---|---|
| Integrator | wave 0 checkpoint reviewed | `wave 1` |
| Integrator | each lane finishes | paste its `LANE NX DONE: …` line |
| Lanes 2C, 2D | integrator has landed task 12 | `task 12 is on module-02a at <sha>` |
| Integrator | wave 1 checkpoint reviewed | `wave 2` |
| Integrator | wave 2 checkpoint reviewed | `wave 3` |
| Any session | it STOPped with a question | your answer; the integrator records rulings on the board |
