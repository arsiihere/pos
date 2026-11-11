#!/usr/bin/env bash
# Owner's machine only. Usage: tools/local/checks-report.sh <PR number> <checklist file>
# Posts a manual-check list you filled in (e.g. docs/plans/03c-manual-checks.md with [x] ticks and notes)
# as a PR comment, so the integrator chat can read it.
set -euo pipefail
PR="${1:?usage: tools/local/checks-report.sh <PR number> <checklist file>}"
FILE="${2:?usage: tools/local/checks-report.sh <PR number> <checklist file>}"
[ -f "$FILE" ] || { echo "no such file: $FILE"; exit 1; }
BODY="$(mktemp)"
{ echo "### Manual checks on the owner's machine — $(basename "$FILE") · $(date '+%Y-%m-%d %H:%M %Z')"; echo; cat "$FILE"; echo; echo "_Posted by tools/local/checks-report.sh_"; } > "$BODY"
gh pr comment "$PR" --repo arsiihere/pos --body-file "$BODY" >/dev/null
rm -f "$BODY"
echo "Posted $FILE on PR #$PR."
