#!/usr/bin/env bash
# Autobuild: runs docs/plans/<MOD>-plan.md to completion with fresh Claude Code sessions.
# implement -> hostile review -> fix -> repeat, until no TODO tasks left, then final gate + merge.
# Usage:  tools/autobuild/autobuild.sh 01
# Env:    MAX_ITER=40 BATCH=3 MAX_TURNS=150 MODEL=opus TEST_CMD="pnpm test" BYPASS=0 NTFY_TOPIC=<optional>
set -uo pipefail

MOD="${1:?usage: autobuild.sh <MOD>   e.g. 01}"
MAX_ITER="${MAX_ITER:-40}"
BATCH="${BATCH:-3}"
MAX_TURNS="${MAX_TURNS:-150}"
MODEL="${MODEL:-opus}"
TEST_CMD="${TEST_CMD:-pnpm test}"
BYPASS="${BYPASS:-0}"            # 1 ONLY inside a container/VM

ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
DIR="tools/autobuild"
LOGS="$DIR/logs/$MOD"; mkdir -p "$LOGS"
PLAN="docs/plans/${MOD}-plan.md"
STATUS="docs/plans/${MOD}-status.md"
PARKED="docs/reviews/${MOD}-parked.md"
LATEST="docs/reviews/${MOD}-autoreview-latest.md"
FINAL="docs/reviews/${MOD}-final-review.md"
BRANCH="module-${MOD}"
TAG="ab-green-${MOD}"

log "autobuild start MOD=$MOD plan=$PLAN"
[ -f "$PLAN" ] || { echo "Missing $PLAN — run the plan gate first."; exit 1; }

log()    { echo "[$(date '+%F %T')] $*" | tee -a "$LOGS/run.log"; }
notify() { log "NOTIFY: $*"; if [ -n "${NTFY_TOPIC:-}" ]; then curl -s -d "$*" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null || true; fi; }

render() {   # shared rules + step prompt, with placeholders filled
  cat "$DIR/prompts/_rules.md" "$DIR/prompts/$1.md" \
    | sed -e "s|{{MOD}}|$MOD|g" -e "s|{{BATCH}}|$BATCH|g" -e "s|{{TEST_CMD}}|$TEST_CMD|g"
}

claude_run() {   # $1 = step name; each call is a FRESH session (fresh context)
  local name="$1" out rc perm
  if [ "$BYPASS" = 1 ]; then perm=(--dangerously-skip-permissions); else perm=(--permission-mode acceptEdits); fi
  while true; do
    out="$LOGS/$(date +%m%d-%H%M%S)-$name.log"
    claude -p "$(render "$name")" --model "$MODEL" --max-turns "$MAX_TURNS" "${perm[@]}" --verbose --output-format stream-json >"$out" 2>&1
    rc=$?
    # Max plan usage window hit: wait and retry the same step instead of dying
    if [ $rc -ne 0 ] && grep -qiE "usage limit|limit reached|resets at|try again later" "$out"; then
      log "usage limit during '$name' — sleeping 30 min then retrying"; sleep 1800; continue
    fi
    log "step '$name' done (rc=$rc) → $out"; return 0
  done
}

preflight() {
  docker start pos-pg-test >/dev/null 2>&1 || docker run -d --name pos-pg-test \
    -e POSTGRES_USER=pos -e POSTGRES_PASSWORD=pos -e POSTGRES_DB=pos_test -p 5433:5432 postgres:16 >/dev/null
  for _ in $(seq 1 30); do docker exec pos-pg-test pg_isready -U pos >/dev/null 2>&1 && break; sleep 1; done
  pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null 2>&1
}

count()      { grep -cE "^\| *T[0-9A-Za-z-]+ *\| *$1 *\|" "$STATUS" 2>/dev/null || true; }
green()      { $TEST_CMD >"$LOGS/last-test.log" 2>&1; }
clean_tree() { if [ -n "$(git status --porcelain)" ]; then git stash push -u -m "autobuild-$MOD-leftover-$(date +%s)" >/dev/null; log "stashed uncommitted leftovers (git stash list)"; fi; }
board()      { echo "TODO=$(count TODO) DONE=$(count DONE) WAITING=$(count WAITING) PARKED=$(count PARKED) BLOCKED=$(count BLOCKED)"; }

# ---------- start ----------
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH"
clean_tree
preflight

[ -f "$STATUS" ] || claude_run init
[ -f "$STATUS" ] || { notify "$MOD: init failed, no status board. See $LOGS"; exit 1; }

if green; then git tag -f "$TAG" >/dev/null
else
  log "suite red at start — running fix step"
  claude_run fix; clean_tree
  if green; then git tag -f "$TAG" >/dev/null; else notify "$MOD: suite red at start and fix failed. See $LOGS/last-test.log"; exit 1; fi
fi

stall=0
parked_seen="$(count PARKED)"
for ((i=1; i<=MAX_ITER; i++)); do
  log "iter $i — $(board)"
  now_parked="$(count PARKED)"
  if [ "$now_parked" -gt "$parked_seen" ]; then
    notify "$MOD: $((now_parked - parked_seen)) new decision(s) need you → $PARKED (loop keeps going on other tasks)"
  fi
  parked_seen="$now_parked"
  if [ "$(count TODO)" -eq 0 ]; then
    [ "$(count WAITING)" -gt 0 ] && notify "$MOD: only parked/waiting work left. Answer $PARKED and rerun."
    break
  fi

  preflight
  before="$(git rev-parse HEAD)"

  claude_run implement; clean_tree
  claude_run review;    clean_tree

  if ! green || ! head -1 "$LATEST" 2>/dev/null | grep -q "VERDICT: PASS"; then
    claude_run fix; clean_tree
  fi

  if green; then git tag -f "$TAG" >/dev/null
  else log "still red after fix — reverting to last green ($TAG)"; git reset --hard "$TAG" >/dev/null; fi

  if [ "$(git rev-parse HEAD)" = "$before" ]; then stall=$((stall+1)); else stall=0; fi
  if [ $stall -ge 2 ]; then notify "$MOD stalled: no progress in 2 iterations. $(board). See $LOGS"; exit 2; fi
done

# ---------- final gate ----------
preflight
claude_run final; clean_tree

if head -1 "$FINAL" 2>/dev/null | grep -q "VERDICT: SHIP" && green \
   && [ "$(count TODO)" -eq 0 ] && [ "$(count PARKED)" -eq 0 ] \
   && [ "$(count WAITING)" -eq 0 ] && [ "$(count BLOCKED)" -eq 0 ]; then
  git checkout main && git merge --no-ff "$BRANCH" -m "merge: module $MOD (autobuild)" && git checkout "$BRANCH"
  notify "$MOD done ✅ merged to main locally (not pushed). Read docs/reviews/${MOD}-auto-decisions.md"
else
  notify "$MOD loop finished but HOLD. $(board). Your inbox: $PARKED and $FINAL"
fi
