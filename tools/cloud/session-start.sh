#!/bin/bash
# SessionStart hook (.claude/settings.json). Does nothing on a local machine.
# In a claude.ai/code cloud session (or a remote agent): configure Postgres like pos-pg-test if the
# environment has not (port 5433, pos/pos_test, test-only settings), start it, match pnpm to
# package.json "packageManager", and install deps.
[ -n "${CLAUDE_CODE_REMOTE_SESSION_ID:-}" ] || exit 0
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
if ! grep -q '^port = 5433' /etc/postgresql/16/main/postgresql.conf 2>/dev/null; then
  bash "$DIR/tools/cloud/environment-setup.sh" >/dev/null 2>&1 || echo "session-start: Postgres setup failed"
fi
$SUDO service postgresql start >/dev/null 2>&1 || true
WANT=$(node -p "require('$DIR/package.json').packageManager.split('@')[1]" 2>/dev/null)
[ -z "$WANT" ] || [ "$(pnpm --version 2>/dev/null)" = "$WANT" ] || npm install -g "pnpm@$WANT" >/dev/null 2>&1
cd "$DIR" && pnpm install --frozen-lockfile >/dev/null 2>&1 || echo "session-start: pnpm install failed; run it by hand"
exit 0
