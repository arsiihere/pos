# 02b — parallel waves: what to open and what to paste

Plan: `docs/plans/02b-plan.md` §"Parallel waves". Integrator checkout: `~/pos`. Lane worktrees: `~/pos-02b-A` … `~/pos-02b-D` (the integrator creates them).

**Hand-off by local tags (never pushed):** a lane that finishes tags its last commit `02b-lane-<N><X>-done`; a lane that needs a ruling tags `02b-lane-<N><X>-stop`. The integrator checks every 2 minutes.

## Terminals

| When | Terminals open | What runs |
|---|---|---|
| Wave 0 | **1** | Integrator (tasks 1–5) |
| Wave 1 | **4** | Integrator + lanes A, B, C |
| Wave 2 | **5** | Integrator + lanes A, B, C, D |
| Wave 3 | **4** | Integrator + lanes A, B, C (C only if G-1 is ruled (a)) |
| Wave 4 | **1** | Integrator (task 24) |

---

## §1. Integrator instructions

```text
You are the 02b INTEGRATOR. Repo ~/pos, branch module-02b (git fetch origin; git checkout module-02b; git pull --ff-only).
Read CLAUDE.md, docs/plans/02b-plan.md (gaps, Global Constraints, "Parallel waves") and docs/plans/02b-status.md. Apply the owner's G / AD rulings exactly as the board records them; a G row still "proposed" blocks the tasks it names.

Never push anything but the branch module-02b (git push origin module-02b; never push tags). No merge, rebase, reset or force-push. Never run pnpm test:perf. Never stop or restart the pos-pg-test container.

WAVE 0 now: build tasks 1, 2, 3, 4, 5 yourself, in that order, with superpowers:subagent-driven-development + superpowers:test-driven-development (one fresh implementer and one fresh reviewer per task; opus for RISK: HIGH; failing test first; one task per commit, message as the task says; author "Arslan Ahmed Arif" <arsiiahmi@gmail.com>). Then the gate:
TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"
Write "Wave 0" on the board, commit "docs(02b): checkpoint wave 0", push module-02b, STOP.

When I say "wave N" (1, 2 or 3):
1. Remove last wave's worktrees, lane branches and local lane tags.
2. For each lane X of wave N in the plan's ownership table: git worktree add -b lane-NX ~/pos-02b-X module-02b, then (cd ~/pos-02b-X && pnpm install --frozen-lockfile). Tell me the lanes are ready.
3. Wait for the lanes yourself: every 2 minutes run git tag -l '02b-*'.
   - A tag 02b-lane-NX-stop: tell me at once, quoting the lane's STOP block from its last message or its STOP file (.superpowers/sdd/02b-plan/stop.md in its worktree); keep landing the other lanes.
   - A tag 02b-lane-NX-done: land the lane: git cherry -v module-02b 02b-lane-NX-done ('+' lines, oldest first); skip a lane's copy of a commit already on module-02b when it matches by content (02a AD-21). Cherry-pick onto module-02b. Additive conflicts in apps/hub/src/orders/index.ts, and conflicts made only of added lines each allowed by an owner ruling (02a standing rule), keep every line in lane order and note it in the wave entry; any other conflict → STOP and tell me. After each lane: its test files, pnpm --filter @pos/hub typecheck and typecheck:tests on module-02b, then push.
4. When every lane of the wave is landed: the gate, the wave checkpoint per the plan (§12.2 rows, statement counts), "Wave N" on the board, commit "docs(02b): checkpoint wave N", push, STOP.
If a lane has not tagged after 3 hours, tell me and keep waiting.

When I say "wave 4": build task 24 yourself (same skills; the perf file is written and typechecked, never run), then the wave 4 checkpoint, push, STOP.

Spec–code mismatch, a file outside the ownership table, a change to apps/hub/src/orders/contracts.ts, a changed bound or new behaviour → STOP and add a row to docs/plans/02b-status.md ("proposed (not yet ruled)").
```

## §2. Lane instructions

```text
You are lane <N><X> of the 02b parallel build. Your worktree is this directory, on local branch lane-<N><X>. Your tasks are in the plan's ownership table, row wave <N> lane <X>. Read CLAUDE.md, docs/plans/02b-plan.md (gaps, Global Constraints — especially "Questions" — "Parallel waves" rules 1–6, the ownership table, and the text of your tasks) and docs/plans/02b-status.md.

Build only your tasks, in order, with superpowers:subagent-driven-development + superpowers:test-driven-development: one fresh implementer and one fresh reviewer per task (opus for RISK: HIGH), failing test first, one task per commit with the message the task gives, author "Arslan Ahmed Arif" <arsiiahmi@gmail.com>.

Hard rules:
- Edit only the files your lane owns, plus your own lines under your marker in apps/hub/src/orders/index.ts.
- Never edit apps/hub/src/orders/contracts.ts.
- Tests run on the real 0013 tables and real events (apps/hub/test/orders/fixtures.ts); never mock another lane's code.
- Run only your own test files, pnpm --filter @pos/hub typecheck and pnpm --filter @pos/hub typecheck:tests. Never the full gate, never pnpm test:perf, never stop or restart pos-pg-test.
- Never push, merge, rebase or reset. Commit only on lane-<N><X>. Tags are local only.
- NEVER wait on an interactive question menu (no AskUserQuestion). If you need a ruling (spec–code mismatch, two specs disagree, a changed bound, new behaviour, a file outside your ownership): write a STOP block (what, the spec section and code line, the options, your recommendation) to .superpowers/sdd/02b-plan/stop.md and print it, run git tag 02b-lane-<N><X>-stop, finish every clause that does not depend on it, then stop. When the owner answers, delete the stop tag, finish, and tag done.

When every task of yours is committed and reviewed: git tag 02b-lane-<N><X>-done (on your last commit), print "LANE <N><X> DONE" with a short list of commits, readings for the board and review leftovers, and stop.
```

---

## §3. Copy-paste sheet

Every block: open a new terminal, paste the shell line, then paste the one-line prompt when Claude Code opens.

### Wave 0 — 1 terminal

```bash
cd ~/pos && git fetch origin && git checkout module-02b && git pull --ff-only && claude
```
```text
Act as the integrator: follow docs/plans/02b-parallel-prompts.md §1 exactly. Start with wave 0.
```
At its STOP: review, then type `wave 1`; wait for "lanes ready".

### Wave 1 — 3 more terminals

```bash
cd ~/pos-02b-A && claude
```
```text
Follow docs/plans/02b-parallel-prompts.md §2 exactly as lane 1A (wave 1, lane A).
```
```bash
cd ~/pos-02b-B && claude
```
```text
Follow docs/plans/02b-parallel-prompts.md §2 exactly as lane 1B (wave 1, lane B).
```
```bash
cd ~/pos-02b-C && claude
```
```text
Follow docs/plans/02b-parallel-prompts.md §2 exactly as lane 1C (wave 1, lane C).
```
At the integrator's STOP ("checkpoint wave 1"): close the lane terminals, review, type `wave 2`.

### Wave 2 — 4 more terminals

Same as wave 1 with `~/pos-02b-A`…`D` and prompts `lane 2A (wave 2, lane A)` … `lane 2D (wave 2, lane D)`.

### Wave 3 — 2 or 3 more terminals

Same with `lane 3A`, `lane 3B`, and `lane 3C` only if G-1 was ruled (a).

### Wave 4 — integrator only

Type `wave 4`. It writes the perf file and the acceptance map and STOPs. Then run `pnpm test:perf` yourself on the real disk, alone (CLAUDE.md).

### If anything STOPs

The integrator quotes the lane's STOP block. Answer it in the integrator terminal (it records the ruling) and in that lane's terminal (it goes on).
