# 05a build — handover to the cloud integrator (2026-11-23 ~11:45 PKT)

The owner is away from the laptop, and the laptop will be offline. From now on a **cloud session is the integrator**. The owner watches and steers it from the Claude mobile app (claude.ai/code). This file is everything that session needs. Read it first, then `05a-status.md`, then `05a-plan.md`.

## 1. Where things are

| What | Where |
|---|---|
| Integration branch | **`build/05a`** on GitHub. It was the push target of the local `module-05a`; the cloud now works on `build/05a` directly. `module-*` branches are under a ruleset that needs PRs, and the owner said no PRs |
| Tip at handover | `build/05a` @ `151035cc` (+ this file's commit) |
| Unfinished task 10 | branch **`wip/05a-task10`** @ `50e189c6`: the call-site changes in `commands/registry.ts`, `commands/route.ts`, `queries/registry.ts` and a test file, from the stopped local agent. Not reviewed; may not pass. Finish it or redo it, then delete nothing (leave the branch) |
| Spec | `docs/specs/05a_Device_Access_Screens_Spec_v1.0.1.md` (APPROVED) |
| Plan / board / gaps / hand checks | `docs/plans/05a-plan.md`, `05a-status.md`, `05a-gaps.md`, `05a-manual-checks.md` |
| CI | `.github/workflows/gate.yml` runs on every push to `build/**` and `lane-05a*/**` (parallel jobs, sharded hub tests). The job named `gate` is the verdict |
| Stab branch | `fix/stab-tablet-pairing`. Bring its new work in **only by `git merge origin/fix/stab-tablet-pairing`**, never a rebase. Note: the laptop's local stab branch was 44+ commits ahead of `origin`, and `build/05a` already contains them; a merge of `origin/fix/stab-tablet-pairing` may bring nothing new until the stab session pushes |

## 2. Done

- Phase 0:
  - 05a v1.0.1 (rulings R-1, G-b).
  - Bumps: 00 v1.12.3, 03b v1.0.15, 04 v1.0.8, F §6.2 append.
  - 01d v1.3.5, committed with **Q-1 – Q-3 open**.
- B1 (tasks 1–4) and B2 (tasks 5–8): done and reviewed.
- Task 9 (`forSession`) is committed (`42c4b122`) but **not reviewed yet**.
- B2 review carry-over: `443084d8`.

## 3. Saved lane work (2026-11-23 ~12:10 PKT)

All the laptop agents were stopped. Their work as it stood was committed as `wip(05a): …` and pushed. Nothing below is reviewed, and the last commit on each branch may not pass. For each branch:
1. Check it out, run its tests, and finish the task.
2. Have a fresh reviewer check it.
3. Merge it into `build/05a` once CI is green.

| Branch | Tip | State |
|---|---|---|
| `lane-05aL1/05a-10-12` | `0a80fb86` | B3 task 10 (call sites) in progress; 11, 12 not started. Task 9 (`forSession`) is on `build/05a` (`42c4b122`), not yet reviewed |
| `lane-05aK/05a-27-28` | `a02b0ce8` | task 27 (K-1 + D-4) mostly written incl. test pins; task 28 (`auth/device-upgrade.ts`) started |
| `lane-05aR/05a-29` | `fd9bba83` | task 29 recovery link written (`auth/recovery-link.ts`, `bootstrap-tokens.ts`, test) |
| `lane-05aD/05a-22` | `4e8c93fc` | task 22 bindings written (`bindings.ts`, `routes.ts`, `alert-sockets.ts`, tests) |
| `lane-05aC1/05a-35-36` | `c9eeb04b` | task 36 committed (`c978d0fe`); task 35 in progress (answer sheet, `InPerson` removed, deep links) |
| `lane-05aC2/05a-31-32` | `99202a64` | tasks 31–32 in progress (`features/devices/`, i18n, an Urdu to-do file under `docs/design/handoff/05a/`) |

### Original lane brief (kept for reference)

| Lane | Branch | Tasks | Model |
|---|---|---|---|
| K | `lane-05aK/05a-27-28` | 27 (K-1 + D-4), 28 (upgrade boot step) | Opus |
| R | `lane-05aR/05a-29` | 29 (recovery link) | Opus |
| D | `lane-05aD/05a-22` | 22 (bindings D-1) | Opus |
| C1 | `lane-05aC1/05a-35-36` | 35 (deep links, answer sheet, Pass parse), 36 (audit names) | Sonnet |
| C2 | `lane-05aC2/05a-31-32` | 31 (device list), 32 (approve / edit forms) | Sonnet |

They were started from the laptop session, so **their reports go to the laptop, not to you**. Track them by their branches (`git fetch; git log origin/<lane>`) and CI (`gh run list --branch <lane>`). A lane is finished when its last commit has a green `gate` run and the commit log shows all its tasks. If a lane branch shows no new commit for 2 hours, treat it as stalled and redo its remaining tasks yourself or in a new lane.

## 4. What the integrator does, in order

1. **Finish B3** (tasks 10, 11, 12) on `build/05a`: start from `wip/05a-task10` or redo it. Then a fresh **Opus** review of tasks 9–12 (HIGH), fix, and push.
2. **Merge each finished cloud lane** into `build/05a`:
   - a fresh review first: Opus for K, R, D; Sonnet for C1, C2;
   - then `git merge --no-ff origin/<lane>`;
   - fix conflicts (expect `apps/client/src/i18n/en.ts` between C1 and C2; keep both blocks);
   - push, and CI must be green.
3. **B4** (13–16), then **B5** (17–21), as in the plan. B4 task 15 is one commit: `ApprovePairingRequest` accepts tablet + phone **and** the STAB-1 "Add a tablet" removal, after task 13's fixture.
4. Then 23–26 (01d answers / raise / routing / `device_waiting`), **only after the owner answers Q-1 – Q-3** (top of `05a-status.md`). If no answers yet, do 30, 33, 34 first.
5. Then 30 (counter tests, a fresh implementer), 33, 34. Then Z1 (acceptance map on the board). Z2 is the owner's hand checks. Z3 is the PR to `main`, after the stab PR, and only when the owner says so.
6. Up to **5–6 agents at once** (owner ruling). Give independent tasks to parallel lanes, each on `lane-05a<L>/05a-<task>` from `build/05a`, CI-green before merge.

## 5. Rules (owner)

- **Before each batch:**
  - merge the latest `origin/fix/stab-tablet-pairing`;
  - check it shows **no new version of 00, 01d, 03b or 04** (baseline: 00 v1.12.2, 01d v1.3.4, 03b v1.0.14, 04 v1.0.7; the 05a bumps are v1.12.3 / v1.3.5 / v1.0.15 / v1.0.8). A new version → **STOP**;
  - CI must be green.
- **Commits:** commit and push after every task. Keep `05a-status.md` current after each task (newest first in the summary). Messages cite the spec, e.g. `feat(05a): … [05a §x; §11 step N]`.
- **Never:** open a PR, merge to `main`, force-push, delete a branch, touch `~/pos`, run `pnpm test:perf` or hardware checks.
- **STOP and wait for the owner** when:
  - code and spec disagree, or a gap can't be fixed under an existing ruling;
  - the stab tip shows a new version of 00, 01d, 03b or 04;
  - a merge conflict or red CI can't be fixed in two tries;
  - any step would delete a branch, force-push or merge to `main`.

  When you stop, write the reason at the top of `05a-status.md` and push.
- **Reviewers (PL-4):** a fresh Opus reviewer for the migration, the permission mask, sign-in, approvals and the recovery link; Sonnet for the rest. Fix rounds ≤ 2.
- **Tests:** TDD, `TMPDIR=/dev/shm`, no timing asserts. A test that only pins a value an approved row changes may be updated (list it in the commit). Known pins that move: audit action count, projection lists, statement counts (+1 per registered projection, 00 M48).

## 6. Notes from the build so far

- PC-1:
  - The reason strings (`listed_device_only` etc.) are plain `details.reason` strings; there is no type.
- PC-2:
  - `deviceProfile` is wired in `server.ts` (`buildHubServer`).
  - Until task 27 lands, `DeviceRoleSet` still writes `point_id`.
  - Tests that build a hub without `buildHubServer` call `loadDeviceProfiles(db)` themselves.
- `signInOn` (test fixture) bypasses the PIN path. Tasks 17 and 18 must use the real `/auth/pin` and `/admin/auth`.
- The shared local test database clashed with the stab session twice. CI does not have this problem.
