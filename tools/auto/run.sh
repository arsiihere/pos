#!/usr/bin/env bash
# Overnight loop for plan 01a: implement 5 tasks -> fresh-session review -> fix blockers -> repeat.
# Stops when: .auto/STOP or .auto/DONE exists, a step fails repeatedly (usage limit), or MAX_BATCHES is reached.
# Usage (from repo root):  bash tools/auto/run.sh            # stop anytime: touch .auto/STOP
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

MAX_BATCHES="${MAX_BATCHES:-20}"     # 20 x 5 = 100 tasks max
RETRY_WAIT_MIN="${RETRY_WAIT_MIN:-30}" # wait after a failed step (usage limit resets)
MAX_RETRIES="${MAX_RETRIES:-8}"        # 8 x 30 min = 4 h of waiting, then give up
BRANCH="module-01"

mkdir -p .auto docs/reviews/01a-auto
LOG=".auto/run-$(date +%Y%m%d-%H%M).log"
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

# Safety: only ever run on the module branch.
if [ "$(git branch --show-current)" != "$BRANCH" ]; then
  log "Not on $BRANCH. Refusing to run."; exit 1
fi

run_step() {   # $1 = name, $2 = prompt file, $3 = batch number
  local name="$1" prompt_file="$2" batch="$3" tries=0
  local prompt; prompt="$(sed "s/{{BATCH}}/$batch/g" "$prompt_file")"
  while :; do
    [ -f .auto/STOP ] && { log "STOP file found."; return 2; }
    docker start pos-pg-test >/dev/null 2>&1 || true
    log "batch $batch: $name (try $((tries+1)))"
    if claude -p "$prompt" --permission-mode acceptEdits --max-turns 200 >>"$LOG" 2>&1; then
      return 0
    fi
    tries=$((tries+1))
    if [ "$tries" -ge "$MAX_RETRIES" ]; then log "$name failed $tries times. Giving up."; return 1; fi
    log "$name failed (usage limit or error). Waiting $RETRY_WAIT_MIN min."
    sleep $((RETRY_WAIT_MIN*60))
  done
}

for batch in $(seq -w 1 "$MAX_BATCHES"); do
  [ -f .auto/STOP ] && { log "Stopped: $(cat .auto/STOP)"; break; }
  [ -f .auto/DONE ] && { log "All tasks done."; break; }

  run_step "implement" tools/auto/implement.md "$batch" || break
  [ -f .auto/STOP ] && { log "Stopped by implementer: $(cat .auto/STOP)"; break; }

  run_step "review" tools/auto/review.md "$batch" || break

  if head -1 "docs/reviews/01a-auto/review-$batch.md" 2>/dev/null | grep -q "CHANGES NEEDED"; then
    run_step "fix" tools/auto/fix.md "$batch" || break
  fi
  git push origin "$BRANCH" >>"$LOG" 2>&1 || log "push failed (continuing; commits are local)"
done
log "Loop ended. Read docs/reviews/01a-auto/ and $LOG."
