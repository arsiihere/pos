#!/bin/bash
# Paste this into the "Setup script" field of the claude.ai/code cloud environment "pos" (once).
# Runs before Claude Code starts in a NEW cloud session; the result is cached (~7 days).
# It configures the pre-installed PostgreSQL 16 like the local pos-pg-test container:
# port 5433, user/db pos/pos_test, test-only settings (CLAUDE.md "Test environment").
set -euo pipefail
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
CONF=/etc/postgresql/16/main/postgresql.conf
$SUDO sed -i 's/^#\?port = .*/port = 5433/' "$CONF"
grep -q '^fsync = off' "$CONF" || printf 'fsync = off\nsynchronous_commit = off\nfull_page_writes = off\n' | $SUDO tee -a "$CONF" >/dev/null
$SUDO service postgresql start
$SUDO su postgres -c "psql -p 5433 -tc \"SELECT 1 FROM pg_roles WHERE rolname='pos'\" | grep -q 1 || psql -p 5433 -c \"CREATE ROLE pos LOGIN SUPERUSER PASSWORD 'pos'\""
$SUDO su postgres -c "psql -p 5433 -tc \"SELECT 1 FROM pg_database WHERE datname='pos_test'\" | grep -q 1 || createdb -p 5433 -O pos pos_test"
$SUDO service postgresql stop
