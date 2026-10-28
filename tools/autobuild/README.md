# Autobuild — plan → code → review → fix, unattended

## Install (once)
```bash
cp -r tools/autobuild ~/pos/tools/
cp .claude/settings.json ~/pos/.claude/settings.json   # merge by hand if you already have one
chmod +x ~/pos/tools/autobuild/autobuild.sh
echo "tools/autobuild/logs/" >> ~/pos/.gitignore
```
Check your real test command (root `package.json`). If it isn't `pnpm test`, pass `TEST_CMD=...`.

## Run a module
```bash
cd ~/pos
tmux new -s build
MAX_ITER=1 tools/autobuild/autobuild.sh 01        # first time: ONE iteration, watch it
tools/autobuild/autobuild.sh 01                   # then the real run; detach with Ctrl-b d
```
Optional phone alerts: install the ntfy app, pick a random topic, run with `NTFY_TOPIC=arslan-pos-x7k2`.

## What happens each iteration (every step = fresh Claude session = fresh context)
1. preflight: Postgres 5433 up, pnpm install
2. implement: un-park answered items, next 3 eligible tasks, TDD, 1 commit each
3. review: hostile reviewer, writes VERDICT: PASS | BLOCKERS
4. fix: only if tests red or verdict BLOCKERS
5. tests green → tag `ab-green-<MOD>`; still red → hard reset to last green tag
6. no new commits for 2 iterations → stop + notify

Usage limit hit → waits 30 min and retries the same step.
After all tasks: final gate → `VERDICT: SHIP` + everything clean → local merge to main (never pushed).

## Your only manual job: the inbox
- `docs/reviews/<MOD>-parked.md` → write your choice after `ANSWER:` and rerun the script. It applies the answer and continues.
- `docs/reviews/<MOD>-auto-decisions.md` → skim once per module. If an AD is wrong, add it as a parked item with your answer.
- `docs/reviews/<MOD>-final-review.md` → "Human inbox" section.

## Safety
Default mode is `--permission-mode acceptEdits` + the allowlist in `.claude/settings.json`: anything not allowed is
refused instead of hanging. `BYPASS=1` (skip all permissions) only inside a container/VM, never on your laptop.
