#!/bin/bash
# SessionStart hook (.claude/settings.json). Does nothing on a local machine.
# In a claude.ai/code cloud session: start Postgres (a cached VM has it configured but stopped) and install deps.
[ -n "${CLAUDE_CODE_REMOTE_SESSION_ID:-}" ] || exit 0
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
$SUDO service postgresql start >/dev/null 2>&1 || true
export npm_config_manage_package_manager_versions=false
cd "${CLAUDE_PROJECT_DIR:-.}" && pnpm install --frozen-lockfile >/dev/null 2>&1 || echo "session-start: pnpm install failed; run it by hand"
exit 0
