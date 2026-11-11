# 03b + 03c — what to set up, what to open, what to paste

Plans: `docs/plans/03b-plan.md`, `docs/plans/03c-plan.md`. Board: `docs/plans/03b-status.md`. Everything runs in **claude.ai/code cloud sessions**; the gate runs in **GitHub Actions**. Your machine is needed only for `test:perf` and the printer / hardware checks.

---

## §0. One-time setup (owner, ~15 min, before 02b finishes)

**A. Merge `spec-03b` into `main`** (it carries the approved specs, these plans, `.github/workflows/gate.yml`, `tools/cloud/`, the CLAUDE.md rules). After the merge, open the repo's **Actions** tab once and check that "gate" ran on `main` and is green.

**B. GitHub ruleset** (repo → Settings → Rules → Rulesets → New branch ruleset):
- Name `module branches`, target branches `module-*` (add `main` too if you want the same on main).
- Turn on: "Require a pull request before merging" (0 approvals), "Require status checks to pass" → add check **`gate`**, "Block force pushes".
- Allowed merge methods: **Rebase** only.

**C. claude.ai/code cloud environment** — nothing required: the repo's SessionStart hook (`tools/cloud/session-start.sh`) configures Postgres on 5433, pins pnpm 12.15.0 and runs `pnpm install` in any cloud session or remote agent. Optional, for faster session starts: add an environment `pos` (network **Trusted**), variable `BASH_MAX_TIMEOUT_MS=1800000`, and paste `tools/cloud/environment-setup.sh` as its setup script (then the VM is cached with Postgres and pnpm ready).

**D. Check it** — open one session in `pos` on `main` and paste:
```
Run: service postgresql status; psql postgres://pos:pos@127.0.0.1:5433/pos_test -c "show fsync"; TMPDIR=/dev/shm pnpm vitest run apps/cloud/test/helpers/scratch-db.int.test.ts. Report the three results in one line each. Change nothing.
```
Expected: Postgres running, `fsync` = off, 1 test passed.

---

## §1. Gap sweep (one session, the day 02b is merged into main)

```
I'm Arslan Ahmed Arif. Restaurant POS, repo arsiihere/pos. Reply in Hinglish, short and direct.

Job: GAP SWEEP before building 03b + 03c. Read only; write one file.
Read CLAUDE.md, docs/plans/03b-plan.md, docs/plans/03c-plan.md, docs/specs/03b_KDS_Pass_Spec_v1.0.md, docs/specs/03c_Printing_Spec_v1.0.md.
For EVERY name the plans' tasks use — functions, exports, signatures, event types and fields, tables and columns, config / settings keys, registry hooks (defineCommand, registerProjection order, registerBootStep, registerTick, registerCatchUp, registerEventAudience, WsHub), test helpers (createTestHub, statementCounter, fixtures), 02b exports (scopedOrders, checkOrderScope, registerOrdersProjection, its tick file), 03a engine exports, 01d alert APIs, next free migration number — find it in the code on main (file:line) and check it matches the spec.
Write docs/plans/03b-03c-gaps.md:
1) "Exact names" table: need → name and file:line (the plans use it).
2) G-rows for every mismatch or missing piece: id, task(s), spec ref, code evidence, problem, options (a)/(b), your recommendation. Only real ones; no style notes.
Commit only that file on a branch gaps-03b, open a PR into main titled "03b/03c gap sweep", author "Arslan Ahmed Arif" <arsiiahmi@gmail.com>.
Then tell me in chat: count of G-rows, each in one line with your recommendation, numbered, so I can answer all at once.
```

You answer all G-rows in one message (e.g. "sab Rec, G-3 (b)"). Then:

```
Owner rulings on docs/plans/03b-03c-gaps.md: <paste my answer>. Record them in that file (column "Ruling"), patch docs/plans/03b-plan.md and 03c-plan.md where a ruling changes a task (and the "Exact names"), commit "docs(03b): gap rulings and plan patch", merge the PR (rebase) once gate is green.
```

---

## §2. Phase 0 — integrator (one session; it stays the integrator till the end)

```
I'm Arslan Ahmed Arif. Restaurant POS, repo arsiihere/pos. Reply in Hinglish, short and direct.

You are the 03b/03c INTEGRATOR. Read CLAUDE.md, docs/plans/03b-plan.md (all of it: global rules, phase 0, lanes, launch schedule), docs/plans/03c-plan.md, docs/plans/03b-03c-gaps.md (rulings), the specs 03b v1.0 and 03c v1.0.
1. Task P0.1: create branch module-03b from origin/main and push it; create the GitHub labels; create docs/plans/03b-status.md from the template in that file if missing.
2. Then tasks P0.2 … P0.13 in order. Each: branch lane-P0/<task> from module-03b, TDD (failing test first), a fresh reviewer subagent (opus; two for HIGH), one commit, PR into module-03b with the plan's PR body, wait for the gate check, rebase-merge it yourself, update the board. Run only the touched files' tests and typechecks locally; CI runs the full gate.
3. Never push to main. Never force-push anything but your own lane-P0/* branches.
4. Need a ruling? STOP block in the PR body + label needs-ruling, tell me in chat, continue tasks that do not depend on it.
When P0.13 is merged and gate on module-03b is green: tell me "PHASE 0 DONE" and which lanes to open now (plan "Lane launch schedule").
```

Keep this session. Later, whenever lanes are running, paste into it:

```
Integrator round: check open PRs into module-03b. For each with gate green and no needs-ruling label: re-read its diff against the plan row (files only its own, tests named, commit message), rebase-merge it, update the board (merged tasks, readings as AD rows "proposed"). For each needs-ruling PR: quote its STOP block to me. Then tell me which lanes / tasks are now unblocked per the plan's Needs column, and which lane sessions I should open next (max 5 running).
```

---

## §3. Lane prompt (one new session per lane; replace `<L>`)

```
I'm Arslan Ahmed Arif. Restaurant POS, repo arsiihere/pos. Reply in Hinglish, short and direct.

You are LANE <L> of the 03b/03c build. Read CLAUDE.md, docs/plans/03b-plan.md "Global rules" and "Markers", your lane's rows (in 03b-plan.md or 03c-plan.md), docs/plans/03b-03c-gaps.md (exact names + rulings), and for each task the spec sections it cites.
For each task of your lane, top to bottom:
- Check its "Needs" are merged into origin/module-03b (git fetch). If not, stop and tell me which task you are waiting for.
- Branch lane-<L>/<task> from origin/module-03b (or stacked on your previous unmerged task branch, as the plan says).
- TDD: write the failing tests named in the row, run them, keep the failing line for the PR body; implement; run your files' tests + `pnpm --filter <pkg> typecheck` and `typecheck:tests`.
- Review: a fresh reviewer subagent (opus) against the cited spec sections, the diff and the global rules; for HIGH a second fresh reviewer (races, R8, statement counts). Fix; more than 2 fix rounds → STOP.
- One commit (message from the plan), push the branch, open the PR into module-03b with the plan's PR body and label lane:<L>. Do not wait for the merge; go to the next task (stack if it builds on this one).
- Only your row's files. Anything else, a contract change, a spec–code mismatch → STOP block in the PR body + label needs-ruling, skip that clause, continue what does not depend on it.
Never push to module-03b or main; never force-push except your own lane-<L>/* branches; never run pnpm test:perf.
When all your tasks have PRs: print "LANE <L> DONE" with the PR numbers, readings and any STOPs.
```

Per lane, paste the prompt above with `<L>` = **B1, B2, B3, B4, B5, B6, C1, C2, C3, C4** when the integrator says it is unblocked.

---

## §4. When a lane STOPs

You get the STOP block from the integrator (or see label `needs-ruling` in the GitHub app). Answer as a PR comment: `RULING: (a)` (+ one line if needed). Then in that lane's session (or a new one with the lane prompt):

```
Rulings are on PR #<n> (comment "RULING: …"). Apply them to the open clause, finish that task, continue your lane.
```

---

## §5. Close (integrator session)

```
All 03b/03c hub tasks are merged. Do plan tasks Z1 and Z2 (03b-plan.md "Close") and write docs/plans/03c-manual-checks.md (03c-plan.md "Close"). PR each into module-03b, merge when green. Then open the PR module-03b → main titled "03b KDS + Pass and 03c Printing (hub)" with the acceptance map in the body, and tell me it is ready for my merge. Do not merge it.
```

After your merge: on your own machine run `pnpm test:perf` (if any perf file changed) and the two manual-check lists with the pilot printers and a KDS tablet.

---

## §6. Client (later)

When `docs/design/handoff/03b/` exists, the integrator patches the plans' BU / CU rows into tasks (same format) and you open lanes BU1–BU3, CU1–CU2 the same way.
