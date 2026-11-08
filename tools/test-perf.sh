#!/usr/bin/env bash
# 03a §10.6, AD-32: the perf project runs only here, inside a clean measurement.
# Marker /tmp/pos-perf.running exists for the whole run (deleted on exit, failure or Ctrl-C);
# /tmp/pos-gate.lock keeps it from overlapping the workspace gate.
# POS_PERF_OUT, POS_PERF_SEEDS and POS_PERF_POLICY pass through from the caller's environment.
set -euo pipefail
cd "$(dirname "$0")/.."

MARK=/tmp/pos-perf.running
if [ -e "$MARK" ]; then
  echo "test:perf: $MARK exists; another measurement is running (or a stale marker). Refusing." >&2
  exit 1
fi
echo "$$" > "$MARK"
trap 'rm -f "$MARK"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

exec 9>/tmp/pos-gate.lock
flock 9

vitest run --config vitest.perf.config.ts --project perf --project perf-hub "$@"
