#!/usr/bin/env bash
# Overnight loop for plan 01a: implement 5 tasks -> fresh-session review -> fix -> repeat.
# Only one instance can run (flock). Stop anytime: touch .auto/STOP
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
mkdir -p .auto docs/reviews/01a-auto
exec 9>.auto/lock
flock -n 9 || { echo "Another loop is already running."; exit 1; }

MAX_BATCHES="${MAX_BATCHES:-20}"
RETRY_WAIT_MIN="${RETRY_WAIT_MIN:-30}"
MAX_RETRIES="${MAX_RETRIES:-8}"
BRANCH="module-01"
LOG=".auto/run-$(date +%Y%m%d-%H%M).log"
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

[ "$(git branch --show-current)" = "$BRANCH" ] || { log "Not on $BRANCH."; exit 1; }

run_step() {   # name, prompt file, batch
  local name="$1" prompt; prompt="$(sed "s/{{BATCH}}/$3/g" "$2")"; local tries=0
  while :; do
    [ -f .auto/STOP ] && { log "STOP file found."; return 2; }
    docker start pos-pg-test >/dev/null 2>&1 || true
    log "batch $3: $name (try $((tries+1)))"
    claude -p "$prompt" --permission-mode acceptEdits --max-turns 200 >>"$LOG" 2>&1 && return 0
    tries=$((tries+1))
    [ "$tries" -ge "$MAX_RETRIES" ] && { log "$name failed $tries times. Giving up."; return 1; }
    log "$name failed. Waiting $RETRY_WAIT_MIN min."; sleep $((RETRY_WAIT_MIN*60))
  done
}

review_and_fix() {  # batch
  local b="$1"
  [ -f "docs/reviews/01a-auto/review-$b.md" ] || run_step "review" tools/auto/review.md "$b" || return 1
  if head -1 "docs/reviews/01a-auto/review-$b.md" 2>/dev/null | grep -q "CHANGES NEEDED" \
     && [ ! -f "docs/reviews/01a-auto/fix-$b.md" ]; then
    run_step "fix" tools/auto/fix.md "$b" || return 1
  fi
  git push origin "$BRANCH" >>"$LOG" 2>&1 || log "push failed (commits stay local)"
}

# Resume: review any finished batch that has no review yet.
for f in $(ls docs/reviews/01a-auto/batch-*.md 2>/dev/null | sort); do
  b="$(basename "$f" .md)"; b="${b#batch-}"
  review_and_fix "$b" || { log "Loop ended during resume."; exit 0; }
done

# Next batch number = last batch file + 1
last="$(ls docs/reviews/01a-auto/batch-*.md 2>/dev/null | sed 's/.*batch-\([0-9]*\)\.md/\1/' | sort -n | tail -1)"
start=$(( 10#${last:-0} + 1 ))

for n in $(seq "$start" $(( start + MAX_BATCHES - 1 ))); do
  batch="$(printf '%02d' "$n")"
  [ -f .auto/STOP ] && { log "Stopped: $(cat .auto/STOP)"; break; }
  [ -f .auto/DONE ] && { log "All tasks done."; break; }
  run_step "implement" tools/auto/implement.md "$batch" || break
  [ -f .auto/STOP ] && { log "Stopped by implementer: $(cat .auto/STOP)"; break; }
  review_and_fix "$batch" || break
done
log "Loop ended. Read docs/reviews/01a-auto/ and $LOG."
