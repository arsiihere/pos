#!/usr/bin/env bash
# Owner's machine only (CLAUDE.md: test:perf runs on the real disk, alone on a quiet machine).
# Usage: tools/local/perf-report.sh <PR number>
# Checks out the PR in a temporary worktree, runs `pnpm test:perf`, and posts the result as a PR comment
# so the integrator chat can read it. Your own checkout is not touched.
set -euo pipefail
PR="${1:?usage: tools/local/perf-report.sh <PR number>}"
REPO="arsiihere/pos"
cd "$(dirname "$0")/../.."
command -v gh >/dev/null || { echo "gh is not installed"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "run: gh auth login"; exit 1; }
case "${TMPDIR:-}" in /dev/shm*) echo "TMPDIR is on /dev/shm; test:perf must run on the real disk. Unset TMPDIR."; exit 1;; esac

WT="$(mktemp -d "${HOME}/pos-perf-${PR}-XXXX")"
LOG="${WT}.log"
cleanup() { git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"; git branch -D "perf-pr-$PR" >/dev/null 2>&1 || true; }
trap cleanup EXIT

git fetch -q origin "pull/${PR}/head:perf-pr-${PR}"
git worktree add -q "$WT" "perf-pr-${PR}"
SHA="$(git -C "$WT" rev-parse --short HEAD)"

echo "PR #${PR} @ ${SHA}: installing deps, then test:perf (close other heavy programs)..."
( cd "$WT" && pnpm install --frozen-lockfile >/dev/null )
START=$(date +%s)
set +e
( cd "$WT" && env -u TMPDIR pnpm test:perf ) 2>&1 | tee "$LOG"
CODE=${PIPESTATUS[0]}
set -e
WALL=$(( $(date +%s) - START ))

RESULT="PASS"; [ "$CODE" -eq 0 ] || RESULT="FAIL (exit $CODE)"
CPU="$(lscpu 2>/dev/null | sed -n 's/^Model name:[[:space:]]*//p' | head -1)"
BODY="$(mktemp)"
{
  echo "### test:perf on the owner's machine — ${RESULT}"
  echo
  echo "- Commit: \`${SHA}\` · wall: ${WALL} s · machine: ${CPU:-unknown}, $(nproc) cores · $(date '+%Y-%m-%d %H:%M %Z')"
  echo
  echo '<details><summary>last 80 lines</summary>'
  echo
  echo '```'
  tail -n 80 "$LOG" | sed 's/\x1b\[[0-9;]*m//g'
  echo '```'
  echo '</details>'
  echo
  echo "_Posted by tools/local/perf-report.sh_"
} > "$BODY"
gh pr comment "$PR" --repo "$REPO" --body-file "$BODY" >/dev/null
rm -f "$BODY"
echo "Posted on PR #${PR}: ${RESULT} (${WALL} s). Full log: ${LOG}"
