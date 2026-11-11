# Project rules for Claude

## Stack

Monorepo: pnpm + Turborepo

| Layer | Technology |
|-------|------------|
| Monorepo | pnpm + Turborepo |
| Hub runtime | Node.js 22 LTS + Fastify 5 |
| Hub database | SQLite 3 (WAL, synchronous=FULL) via better-sqlite3 |
| Hub deployment | systemd service on headless Ubuntu LTS mini PC; no Docker on restaurant hardware |
| Cloud runtime | Node.js 22 LTS + Fastify 5 — same framework as the hub (D55) |
| Cloud database | PostgreSQL 16 — smallest single-AZ managed tier; free tier or credits where eligible (D57) |
| Cloud hosting | AWS ap-south-1 (Mumbai), chosen on cost (D57) |
| Real-time (LAN) | WebSocket (ws://) hub → devices |
| Real-time (cloud) | @fastify/websocket (wss://) for owner dashboard |
| Client — Android | React + Capacitor (bundled assets + local SQLite command queue) |
| Client — Windows cashier | Hub-served React app in Chrome or Edge kiosk mode, auto-start at login; IndexedDB command queue (D56) |
| Client — KDS | React served by hub (browser, no offline shell needed) |
| Shared packages | @pos/domain (types), @pos/events (Zod schemas), @pos/engine (pure timing engine) |
| Event IDs | ULID |
| Schema validation | Zod everywhere (Fastify via fastify-type-provider-zod) |
| Language | TypeScript throughout |
| Tests | Vitest (root `test.projects`) |

## Rigor tier
T2 Production. Justification: real concurrency races exist in P1 (stock reservation, table locking, void approvals); immutable audit log is a story requirement; but scale is small (3 branches, ~10 concurrent devices/branch, ~200 orders/rush) — T3 patterns are not justified until P3/P4.

## Source of truth
- The only source of truth is **docs/specs/00_Foundation_Spec_v1.11.md** (APPROVED), extended by the module specs listed in docs/specs/README.md. This file, the stories and the plans summarise it; if anything here disagrees with the spec, the spec wins.
- The foundation changes only through a version bump approved by the owner, with a changelog and 'Changed by' markers (README R34). Appending an error code that a module spec defines (§6.2) needs no bump.
- Every module spec follows the Shared Standards in foundation §6 and does not redefine them.
- If code and spec disagree, STOP and ask; never silently diverge.
- Any behaviour change goes spec-first: update the spec version, then the plan, then the code.
- Every task/commit cites the spec section(s) it implements, e.g. `feat(orders): cancel order [spec §42]`.

## Pipeline (follow in order)
1. Refine stories → docs/stories/<module>-refined.md      (superpowers: brainstorming)
2. Foundation spec (Phase 0-1, fixes stack + tier) → STOP for human review (backend-spec-writer)
3. Module spec → docs/specs/NN_<Module>_Spec_vX.Y.md + update docs/specs/README.md  (backend-spec-writer)
4. Hostile review in a FRESH session → docs/reviews/, then fix and bump the spec version
5. Plan → docs/plans/<module>-plan.md                      (superpowers: writing-plans)
6. Build in batches of ~5 tasks, TDD                        (superpowers: subagent-driven-development + test-driven-development)
7. Debug                                                    (superpowers: systematic-debugging)
8. Review against the spec's endpoint checklist + Definition of Done
9. E2E flows, if there is a web UI                          (webapp-testing)

## Engineering rules
- TDD: failing test first. A task is not done without passing tests.
- Build only what the spec asks for. No extra patterns, layers or dependencies "for later".
- Never change API contracts, error codes, folder structure or merged migrations without asking.
- New error codes: define them in the module spec, then append them to the foundation §6.2 list and `@pos/domain/src/errors.ts`.
- No N+1: list/batch endpoints use a fixed number of queries.
- Small commits, one task per commit. Don't touch files outside the current task.

## Test environment (owner rule, 2026-11-08)
- The normal gate runs on RAM. Hub SQLite test files go under `TMPDIR=/dev/shm`: `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`. These tests check behaviour, not speed or durability.
- The Postgres test container `pos-pg-test` (port 5433) runs with `fsync=off`, `synchronous_commit=off` and `full_page_writes=off`, set via `ALTER SYSTEM` + `pg_reload_conf()` (no restart). Its data stays on the Docker volume. This is the accepted form for the test-only container. Never stop, restart or `compose down` it.
- `pnpm test:perf` (the 03a §7.1 numbers) always runs on the real disk, alone on a quiet machine. Never run it with `TMPDIR=/dev/shm` or on tmpfs.
- Power-loss and crash-durability proof happens only on the pilot hardware (03a task 28 style manual checks), never on a dev laptop.
- Production never changes: the hub stays SQLite WAL + `synchronous=FULL`, and cloud Postgres keeps fsync on.
- No timing asserts in the normal gate (03a AD-32). Timing lives in `test:perf`.

## Cloud sessions and CI (owner rule, 2026-11-11)
- **CI:** `.github/workflows/gate.yml` runs the normal gate on every PR into `main` or a `module-*` branch and on every push to them: a `postgres:16` service on port 5433 with the same three test-only settings, SQLite under `TMPDIR=/dev/shm`. A PR merges only with the gate green.
- **claude.ai/code cloud sessions:** the environment's setup script is `tools/cloud/environment-setup.sh` (pre-installed PostgreSQL 16 moved to port 5433, user `pos`, db `pos_test`, the same three settings); the repo's SessionStart hook `tools/cloud/session-start.sh` starts Postgres and runs `pnpm install` (cloud only; it does nothing locally). This is the cloud form of `pos-pg-test`; the local container rules above stay as they are. The cloud environment also sets `npm_config_manage_package_manager_versions=false` and `TURBO_TELEMETRY_DISABLED=1` (without the first, turbo's parallel `pnpm` spawns race on pnpm's own version switch and fail with "Exec format error").
- **Never in the cloud or CI:** `pnpm test:perf`, printer and hardware checks, power-loss checks. They run on the owner's machine or the pilot hardware.
