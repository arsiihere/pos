# Integrator handbook

A reusable process note for build sessions (Claude Code CLI or claude.ai). A new session reads this file, `CLAUDE.md`, the module's status board and nothing else it does not need. State lives in files, not in chat history.

The spec wins over this note. If this note and `CLAUDE.md` or a spec disagree, STOP and ask (CLAUDE.md "Source of truth").

## 1. Start lean

1. Read `CLAUDE.md`, then this file.
2. Read the module's status board: `docs/plans/02-client-status.md`, `docs/plans/03b-client-status.md`, `docs/plans/02b-status.md`, `docs/plans/03b-status.md` (or the board of the module you were given).
3. Read the plan task you were given and the spec sections it cites. Do not read the whole spec.
4. Work in a worktree (section 3). Write progress to the board, not to chat.

Usage economy:
- One integrator session per module. Its state is the board file, so a session can end and a new one can pick up.
- Sonnet for NORMAL work and docs. Opus for HIGH work and specs.
- Do not re-read what the board already says. Do not paste big files into chat; cite path and line.

## 2. Pipeline (from CLAUDE.md)

1. Refine stories -> `docs/stories/<module>-refined.md` (superpowers: brainstorming).
2. Foundation spec (phase 0-1, fixes stack and tier) -> STOP for human review (backend-spec-writer).
3. Module spec -> `docs/specs/NN_<Module>_Spec_vX.Y.md` and update `docs/specs/README.md`.
4. Hostile review in a FRESH session -> `docs/reviews/`, then fix and bump the spec version.
5. Plan -> `docs/plans/<module>-plan.md` (superpowers: writing-plans).
6. Build in batches of about 5 tasks, TDD (subagent-driven-development + test-driven-development).
7. Debug (systematic-debugging).
8. Review against the spec's endpoint checklist and Definition of Done.
9. E2E flows, if there is a web UI (webapp-testing).

Engineering rules that bite most often (full list in CLAUDE.md):
- Failing test first. A task is not done without passing tests.
- Build only what the spec asks for. No extra layers or dependencies "for later".
- Never change API contracts, error codes, folder structure or merged migrations without asking.
- Behaviour change goes spec-first: spec version, then plan, then code.
- Small commits, one task per commit, each citing the spec section: `feat(orders): cancel order [spec §42]`.
- Never edit a spec file other than `docs/specs/README.md` unless the owner approved a version bump.

## 3. Lanes and worktrees

- A module has a board with a Branches table: the module branch (`module-<id>-client`, `module-<id>-hub-gaps`), a lane prefix (`lane-A/<task>`) and which module merges first.
- One lane = one stream of tasks that touch separate files. Lanes work on `lane-X/<task>` branches and open PRs into the module branch.
- One worktree per lane or task, never two sessions in one checkout:
  `git fetch origin main:refs/remotes/origin/main && git worktree add <dir> origin/main`, then `git checkout -b <branch>`.
- The clone may be shallow. Fetch with explicit refspecs (`<branch>:refs/remotes/origin/<branch>`).
- Never `git stash`. Commit, or leave the worktree as it is.
- Never push to `main` or any `module-*` branch directly. Everything goes through a PR (REST: `gh api`; GraphQL and `gh pr create` may be blocked).
- The integrator owns the shared files (shell, routes, slots, wiring). Lanes add through the seams the board names (IR rulings, section 11) and do not edit shared files outside their task.
- Do not touch files outside the current task.

## 4. Risk tiers

Every task on the board carries a tier.

| Tier | When | Reviewers |
|------|------|-----------|
| NORMAL | everything else | 1 Sonnet reviewer |
| HIGH | money; queue / offline; lock / handover; approvals; station session; print retry | 2 Opus reviewers |

Pick the tier from what the diff can break, not from its size. If a NORMAL task turns out to touch a HIGH area (for example a table-map change that edits the lock banner), re-tier it and say so on the board.

## 5. Reviewer rules

- NORMAL: one Sonnet reviewer. HIGH: two Opus reviewers, independent, each with the spec section and the diff.
- A reviewer returns BLOCKER / MAJOR / MINOR with file and line. "Looks fine" without evidence is not a review.
- Fix rounds are only for BLOCKER and MAJOR (owner ruling Q-60).
- A re-check after a fix only mutation-verifies the MAJORs: break the fixed line, see the new test fail, restore it. It does not re-review the whole diff.
- At most 2 fix rounds. If a MAJOR is still open after round 2, STOP, write the finding on the board under STOPs / needs-ruling and ask the owner.
- If both HIGH reviewers ask for changes (or one approves and one asks), the "second approval" is a fresh re-check reviewer who mutation-verifies every MAJOR (02-client-status.md AD-C18).
- Money MINORs are fixed before merge. Other MINORs are not.

## 6. MINORs go to the cleanup file (Q-60)

- MINOR findings do not trigger a fix round. Append them to the module's cleanup file:
  `docs/plans/02-client-cleanup.md` (02a, 02b, shared shell) or `docs/plans/03b-client-cleanup.md` (03b, 03c).
- Each entry: file and line, the finding, the PR it came from, and who fixes it. They are fixed in the close tasks (Z) or the next change to that file.
- Do not let a MINOR block a merge.

## 7. Branch patterns for module -> main

### 7.1 Release branch when syncs were linear

When the module branch took `main` in by linear syncs (no merge commits), a plain PR from the module would show a history that does not match `main`. Build a release branch instead:

```
TREE=$(git rev-parse origin/<module>^{tree})
C=$(git commit-tree "$TREE" -p origin/main -p origin/<module> -m "merge <module> into main [spec refs]")
git branch merge/<module>-to-main "$C"
```

The commit has the module's tree and two parents: `main` and the module tip. **Only valid when the module tree already contains all of `main`**, i.e. `main` has not moved since the last sync into the module (`git log origin/<module>..origin/main` shows only merge commits whose trees the module already has). If `main` moved, sync first (7.2); otherwise this commit silently drops main's newer changes. Check before pushing: `git diff origin/<module> merge/<module>-to-main` must be empty and `git merge-base --is-ancestor origin/main merge/<module>-to-main` must succeed. Push the branch and open the PR into `main`. Examples: `merge/02a-to-main`, `merge/02b-to-main`, `merge/03b-client-to-main`.

### 7.2 Linear sync of main into a module branch

```
TREE=$(git merge-tree --write-tree origin/<module> origin/main)   # resolve conflicts in a scratch worktree if it fails
C=$(git commit-tree "$TREE" -p origin/<module> -m "sync main into <module> [spec refs]")
```

One parent only: the module tip, because the module ruleset is rebase-only and `main` has merge commits. The tree is main merged into the module; when the merge base is too old (add/add conflicts on rebased copies), apply `git diff <last sync commit> origin/<module>` onto `origin/main` with `git apply -3` instead (as #209 did). Check the tree with `git diff` against the expected result before pushing. The sync goes in by PR like any other change (IR-13 in section 8).

## 8. CI and the local gate (IR-13)

- CI (`.github/workflows/gate.yml`) runs only on PRs into `main` or `module-*` and on pushes to them.
- PRs into a release branch (`merge/...`) or a lane stack get no CI. Use the local gate and post the summary on the PR:
  `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`.
- The final `merge/<module>-to-main` -> `main` PR gets CI. It must be green before merge.
- Never run `pnpm test:perf`, printer, hardware or power-loss checks in the cloud or in CI.
- The hub test files live on RAM (`TMPDIR=/dev/shm`). Do not stop, restart or `compose down` the `pos-pg-test` container.
- In cloud sessions, the pnpm version must be the one in `package.json` "packageManager". If turbo says "Exec format error", see AD-C19 in `docs/plans/02-client-status.md`.

## 9. Client tests and Playwright

- Client unit tests: `TMPDIR=/dev/shm pnpm vitest run apps/client` (a path or name filter after it narrows the run).
- Tests that read build output need the build first: `pnpm --filter @pos/client build`, then run them.
- E2E flows are not part of the gate: `pnpm --filter @pos/client test:e2e`. They run on the owner's or integrator's machine, never in CI or the cloud. Reference run: `docs/reviews/02b-client-e2e.md`.
- On this machine the installed Chromium can be one revision behind Playwright. Make a throwaway folder whose `chromium-<expected>` and `chromium_headless_shell-<expected>` entries are symlinks to the installed builds, and pass it only through the environment:
  `PLAYWRIGHT_BROWSERS_PATH=<dir> TMPDIR=/dev/shm pnpm exec playwright test`.
- Never commit a machine path (the symlink folder, a home directory, a browsers path). Check the diff for `/home/` and `/Users/` before every commit.
- Never `pkill` or `killall` browsers machine-wide. Stop only the process ids your own run started.

## 10. Recurring review lessons

These came up again and again in client reviews. Check them in every diff that touches the queue, sockets or sessions.

- **Retry after a lost reply reuses the same `command_id`.** The hub dedupes by it (M19 / M47). A new id on retry can double-apply a command.
- **Double-tap guards are refs**, not state. State updates are batched and a second tap can land before the re-render.
- **Transports and senders are stable for the page's lifetime and keyed per signed-in session.** Do not create a new socket or sender on every render; do not share one across sign-ins.
- **Stale replies never overwrite newer frames (IR-6).** A read reply is dropped if a frame that changes the same data arrived after the request was sent; a frame during an in-flight read schedules one follow-up read.
- **No names in logs or IndexedDB.** Store ids and codes. Names (staff, customers) stay in memory and on screen only.
- Related, from the boards: `session_token` is memory-only; the queue clock is the hub's; clients never trust the device clock for business rules.

## 11. Where the IR rulings live

Integrator rulings (IR-n) are recorded as AD rows. Do not copy them into plans or this file; link to the row.

- 02a / 02b client: AD rows in `docs/plans/02-client-status.md` (section "Readings"; AD-C7 = IR-1, AD-C12 = IR-6, AD-C23 = IR-13, and so on).
- 03b / 03c client: AD rows in `docs/plans/03b-client-status.md` (AD-K10, AD-K11, AD-K14...K29 = IR-14...IR-25 and the lane close items).
- A new ruling gets the next free IR number and an AD row on the board of the module it belongs to, status `proposed` until the owner confirms.
- Owner rulings (Q-n) are in the module's gaps file, for example `docs/plans/03b-client-gaps.md`; open questions are in `docs/OPEN-QUESTIONS.md`.

## 12. After merging two module branches

Run the full gate on `main` itself (a clean worktree of `origin/main`), not on either branch.

- Each branch was green alone. A schema or contract change in one can break the other's test fixtures. Example: 03b added `group_id` and `serve_mode` to `point_lines`, and fixtures written on the 02 side did not have them (PR #217).
- Fix it in a small PR from a `fix/...` branch, citing the spec section, and re-run the gate.
- Do the same after any sync that brings in another module's schema, event or fixture change.

## 13. Close checklist for a module

- Every board row is `merged`; no row waits on a review.
- The Z-tasks fixed or listed the cleanup file entries; the Z1 acceptance map covers the spec's test list.
- The e2e doc exists under `docs/reviews/` with its run result.
- `docs/specs/README.md` Status cell says IMPLEMENTED on `main`, with PR numbers, boards and e2e docs. Only add to the approved-version text.
- The release-branch PR into `main` had a green CI gate.
- Anything that is the owner's call (spec bump, new error code, contract change) is on the board under STOPs / needs-ruling, not decided by the session.
