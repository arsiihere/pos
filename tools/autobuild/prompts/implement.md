# STEP: IMPLEMENT (next batch)

## 0. Un-park answered questions first
Open docs/reviews/{{MOD}}-parked.md. For every P-n whose `ANSWER:` line is filled in by the human:
- apply the answer (spec minor patch if needed, record as AD-n "from human answer P-n"),
- set that task back to TODO (attempts 0) and its WAITING dependents back to TODO,
- mark the P-n heading "(RESOLVED)". Commit: `docs({{MOD}}): apply answers to parked P-n`.

## 1. Pick the batch
From docs/plans/{{MOD}}-status.md take the first {{BATCH}} tasks that are TODO and whose "Depends on" tasks are all DONE.
If none are eligible but TODO tasks exist, they must depend on PARKED/BLOCKED work: set them to WAITING and stop.

## 2. For each task in the batch, in order
1. Read the task in the plan + the cited spec sections + the files it lists.
2. Write the failing test(s) using the spec test numbers. Run only that test file — confirm it fails for the right reason.
3. Implement. Run that test file until green.
4. Run only the tests of the package(s) you touched (e.g. `pnpm --filter <pkg> test`). Do NOT run the full suite per task; the full suite runs once at the end of the batch (step 3). If something broke, fix it (Class A) before moving on.
5. Commit (one commit per task). Update the status board row → DONE. Append build-log entry.
If you hit a problem, classify it (A/B/C) per the rules and act. A task you cannot finish this step:
increment attempts, write what you tried in its note, leave it TODO (or BLOCKED at 3, PARKED if Class C), and continue with the next eligible task.

## 3. Finish
Run `{{TEST_CMD}}` once more. Commit the status board if it changed. Summary: tasks done, tests passing, anything parked/blocked/auto-decided. Stop.
