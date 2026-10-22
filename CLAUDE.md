# Project rules for Claude

## Stack
TBD — decided in backend-spec-writer Phase 0. Do not assume a stack until this is filled.

## Rigor tier
TBD — T1 MVP / T2 Production / T3 Enterprise, decided in backend-spec-writer Phase 0.

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
