#!/bin/bash
# SessionStart hook (.claude/settings.json). Does nothing on a local machine.
# In a claude.ai/code cloud session (or a remote agent): configure Postgres like pos-pg-test if the
# environment has not (port 5433, pos/pos_test, test-only settings), start it, match pnpm to
# package.json "packageManager" (and repair pnpm's managed copy of itself), install deps and Playwright's browsers.
[ -n "${CLAUDE_CODE_REMOTE_SESSION_ID:-}" ] || exit 0
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
if ! grep -q '^port = 5433' /etc/postgresql/16/main/postgresql.conf 2>/dev/null; then
  bash "$DIR/tools/cloud/environment-setup.sh" >/dev/null 2>&1 || echo "session-start: Postgres setup failed"
fi
$SUDO service postgresql start >/dev/null 2>&1 || true
WANT=$(node -p "require('$DIR/package.json').packageManager.split('@')[1]" 2>/dev/null)
[ -z "$WANT" ] || [ "$(pnpm --version 2>/dev/null)" = "$WANT" ] || npm install -g "pnpm@$WANT" >/dev/null 2>&1
# pnpm keeps a managed copy of the packageManager version in ~/.local/share/pnpm/.tools and runs it (the lockfile's
# first document is that copy's entry, so the switch must stay on: with manage-package-manager-versions=false,
# `pnpm install --frozen-lockfile` calls the lockfile broken). When that copy was installed with lifecycle scripts
# blocked, its bins stay text placeholders: a shell can run them, but turbo exec()s them directly and fails with
# "Exec format error" (os error 8). Make pnpm fetch the copy once, serially, then run its own install.js, which swaps
# the placeholders for the native binary.
cd "$DIR" && pnpm --version >/dev/null 2>&1
for wrapper in "$HOME"/.local/share/pnpm/.tools/pnpm/*/node_modules/pnpm; do
  [ -f "$wrapper/install.js" ] && [ -f "$wrapper/pnpm" ] || continue
  head -c 4 "$wrapper/pnpm" | grep -q 'ELF' && continue
  (cd "$wrapper" && node install.js >/dev/null 2>&1) || echo "session-start: could not repair $wrapper (turbo may fail with Exec format error)"
done
cd "$DIR" && pnpm install --frozen-lockfile >/dev/null 2>&1 || echo "session-start: pnpm install failed; run it by hand"
# Playwright's browsers for `pnpm test:e2e`: the build apps/client's @playwright/test pins (the container's
# pre-installed one may be older). Needs the environment to allow cdn.playwright.dev; a no-op when already there.
pnpm --filter @pos/client exec playwright install chromium >/dev/null 2>&1 \
  || echo "session-start: playwright install failed (is cdn.playwright.dev allowed?); pnpm test:e2e will not start a browser"
exit 0
