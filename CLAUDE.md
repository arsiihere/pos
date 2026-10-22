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
- The only source of truth is **docs/specs/00_Foundation_Spec_v1.7.md** (APPROVED — FINAL), extended by the module specs listed in docs/specs/README.md. This file, the stories and the plans summarise it; if anything here disagrees with the spec, the spec wins.
- The foundation is frozen (D64): later issues go into module specs or unit tests, not foundation edits. The one allowed foundation edit is appending a new error code that a module spec defines (§6.2).
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
