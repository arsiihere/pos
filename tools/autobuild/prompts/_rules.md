# AUTOBUILD RULES (apply to every step)

You are running UNATTENDED inside an automated loop for module {{MOD}}. Nobody will answer questions.
Never ask the user anything. Never wait for confirmation. Decide using the policy below, record the decision, and keep going.

## Sources of truth (in this order; code wins over prose when they disagree on what EXISTS)
1. docs/specs/00_Foundation_Spec_v1.9.md §6 (Shared Standards) — changes only by an approved version bump (README R34)
2. The approved spec for {{MOD}} (latest docs/specs/{{MOD}}_*_Spec_v1.*.md)
3. docs/plans/{{MOD}}-plan.md (tasks, Interfaces block, coverage table, Global Constraints)
4. docs/specs/README.md (owner answers, carried requirements)
5. .cursor/rules/pos.mdc (coding conventions — follow them even though Cursor is not used)

## Files you maintain
- docs/plans/{{MOD}}-status.md — status board (the loop reads it; keep the exact table format)
  `| T<id> | <TODO|DONE|PARKED|WAITING|BLOCKED> | <attempts> | <depends on, e.g. T3,T4 or -> | <short note> |`
- docs/reviews/build-log.md — append one entry per task: task id, files, tests added (spec test numbers), result, "impl: Claude Code (autobuild)"
- docs/reviews/{{MOD}}-auto-decisions.md — every decision you made without a human (AD-1, AD-2, …)
- docs/reviews/{{MOD}}-parked.md — questions only the human can answer

## Blocker policy — classify EVERY problem before acting
**Class A — fix it yourself, no record needed beyond build-log:**
failing/flaky tests, type/lint errors, missing package.json deps, wrong file path or helper name in the plan,
plan task that forgot a file, test infra issues, reviewer findings in CODE (Blocker/Should-fix).

**Class B — decide yourself, then RECORD it:**
a spec/plan gap or ambiguity whose answer does NOT change any of: event schemas/upcasters, DB schema used by
another module, hub↔cloud sync contract, public API request/response shape or error codes already used by
another module, money/paisa or stock math rules, auth/PIN/session/security behaviour, anything marked
[ASSUMPTION] or "owner".
→ Pick the option most consistent with foundation §6 and the code that already exists (smallest change, YAGNI).
→ Append to {{MOD}}-auto-decisions.md: `AD-n | task | problem | options considered | choice | why | files touched`.
→ If the spec text itself must change, patch the spec as a minor version (v1.0 → v1.0.1 …) with a line in its
  change log "auto-patch AD-n". Never touch anything else in the spec.

**Class C — PARK it, do not guess:**
anything in the Class B exclusion list above, owner/business facts, hardware (#79 etc.), or a fix that needs
another module's spec to change.
→ Set the task to PARKED, set every task that depends on it to WAITING.
→ Append to {{MOD}}-parked.md:
  `## P-n (task Tx) <title>` / Problem / Why it can't be auto-decided / Options A/B/C with consequences /
  Recommendation / `ANSWER:` (leave empty for the human)
→ Continue with the next task that does NOT depend on it. Parking is not stopping.

**Attempts:** each time you try a task and it fails, increment its attempts. At attempts = 3 → BLOCKED,
with a diagnosis in the note and in build-log ("tried X, Y, Z; root cause guess; what would unblock").

## Hard rules
- TDD: failing test first (named with the spec test number), then implementation.
- One commit per task: `<type>({{MOD}}): task <id> <short desc> [spec §x.y]`. Commit only files you meant to change.
- Never `git push`, except the controller's `git push origin module-<MOD>` at a batch checkpoint; never push `main`; never touch branch `main`, never `git reset --hard`, never delete tests to make things pass,
  never `.skip` a test unless the spec says so (log it if you do).
- The foundation and every approved spec change only through a version bump approved by the owner, with a changelog and 'Changed by' markers (README R34); never edit them in a build step. Appending an error code that a module spec defines (F §6.2) needs no bump.
- Read only what the task needs (plan task text, files it touches, their tests, cited spec sections). Use Grep before
  opening big files. No repo-wide scans. No subagents.
- Postgres for cloud tests: postgres://pos:pos@localhost:5433/pos_test (the loop starts it before every step).
- Test command for the full suite: `{{TEST_CMD}}`.
- End every step with a SHORT summary (≤ 10 lines). The summary is logged, not read by a human in real time.

---
