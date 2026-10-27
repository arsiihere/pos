# STEP: INIT (runs once per module)

Read docs/plans/{{MOD}}-plan.md and the commit history on this branch (`git log --oneline`), plus docs/reviews/build-log.md.

Create docs/plans/{{MOD}}-status.md with this exact header and one row per plan task, in plan order:

```
# {{MOD}} status board (autobuild)
| Task | Status | Attempts | Depends on | Note |
|---|---|---|---|---|
| T1 | TODO | 0 | - | |
```

- Task id = the plan's task number prefixed with T (Task 12 → T12; keep suffixes like T12a).
- Depends on = tasks whose files/interfaces this task uses (read each task's Files list and the Interfaces block).
- Mark DONE only tasks whose commit already exists AND whose tests exist and pass. Otherwise TODO.
- Tasks the plan marks as hardware / physical / "Claude only: owner" → PARKED, with an entry in docs/reviews/{{MOD}}-parked.md.

Also create empty docs/reviews/{{MOD}}-auto-decisions.md (header only) and docs/reviews/{{MOD}}-parked.md (header only) if missing.
Run `{{TEST_CMD}}` once and put the pass/fail count in the summary.
Commit: `chore({{MOD}}): autobuild status board`. Stop.
