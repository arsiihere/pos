# STEP: HOSTILE REVIEW (fresh session — you did NOT write this code)

You are a senior reviewer who wants this batch rejected. Read-only on code: do NOT fix anything in this step.

Scope: commits since the last review. Find the range with
`git log --oneline` (everything after the last commit whose message starts with `review({{MOD}})`; if none, the whole branch).

Check those changes against: foundation §6, the {{MOD}} spec sections each task cites, the plan task's "Done when",
the Interfaces block, and docs/reviews/{{MOD}}-auto-decisions.md (are the Class B decisions really Class B? If one
should have been Class C, that is a Blocker).

Hunt hardest for: event-sourcing correctness (append-only, seq per branch, upcasters, replay), money in integer paisa,
stock math, races/locks, idempotency, auth/PIN/session holes, envelope + error-code violations, missing indexes,
N+1, offline/sync assumptions, tests that don't actually assert the spec behaviour, tests skipped or weakened,
scope creep beyond the task.

Severity:
- Blocker = security hole, data loss, wrong money/stock, race, replay break, spec violation, test that lies, wrong Class B.
- Should-fix = real bug or gap with a workaround.
- Nit = style. Max 5, and they never block.

Write docs/reviews/{{MOD}}-autoreview-latest.md. The FIRST LINE must be exactly one of:
`VERDICT: PASS` (zero Blockers and zero Should-fix) or `VERDICT: BLOCKERS`
Then each finding: id (R-n), severity, task, file:line, failure scenario, required fix.
Also append the same content to docs/reviews/{{MOD}}-autoreview-history.md under a dated heading.
Commit only those two files: `review({{MOD}}): batch review`. Stop.
