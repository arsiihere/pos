# Project rules for Claude

## Stack

Monorepo: pnpm + Turborepo

| Layer | Technology |
|-------|------------|
| Monorepo | pnpm + Turborepo |
| Hub runtime | Node.js 22 LTS + Fastify 5 |
| Hub database | SQLite 3 (WAL, synchronous=FULL) via better-sqlite3 |
| Hub deployment | systemd service on headless Ubuntu LTS mini PC; no Docker on restaurant hardware |
| Cloud runtime | NestJS 10 |
| Cloud database | PostgreSQL 16 (AWS RDS or managed) |
| Cloud hosting | AWS ap-south-1 (Mumbai) — nearest to Pakistan; see OQ10 |
| Real-time (LAN) | WebSocket (ws://) hub → devices |
| Real-time (cloud) | NestJS Gateway (wss://) for owner dashboard |
| Client — Android | React + Capacitor (bundled assets + local SQLite event queue) |
| Client — Windows | React + Tauri (kiosk shell, auto-start) |
| Client — KDS | React served by hub (browser, no offline shell needed) |
| Shared packages | @pos/domain (types), @pos/events (Zod schemas), @pos/engine (pure timing engine) |
| Event IDs | ULID |
| Schema validation | Zod everywhere |
| Language | TypeScript throughout |

## Rigor tier
T2 Production. Justification: real concurrency races exist in P1 (stock reservation, table locking, void approvals); immutable audit log is a story requirement; but scale is small (3 branches, ~10 concurrent devices/branch, ~200 orders/rush) — T3 patterns are not justified until P3/P4.

## Source of truth
- Specs live in docs/specs/. If code and spec disagree, STOP and ask; never silently diverge.
- Any behaviour change goes spec-first: update the spec version, then the plan, then the code.
- Every task/commit cites the spec section(s) it implements, e.g. `feat(orders): cancel order [spec §42]`.

## Pipeline (follow in order)
1. Refine stories → docs/stories/<module>-refined.md      (superpowers: brainstorming)
2. Foundation spec (Phase 0-1, fixes stack + tier) → STOP for human review (backend-spec-writer)
3. Full spec → docs/specs/<Module>_Spec_vX.md              (backend-spec-writer)
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
- No N+1: list/batch endpoints use a fixed number of queries.
- Small commits, one task per commit. Don't touch files outside the current task.
