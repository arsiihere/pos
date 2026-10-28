# STEP: FIX

Inputs: docs/reviews/{{MOD}}-autoreview-latest.md (may say PASS) and the current result of `{{TEST_CMD}}`.

1. Run `{{TEST_CMD}}`. Every failing test is a Class A problem: fix the cause, never the assertion (unless the
   assertion contradicts the spec — then that's Class B/C per the rules).
2. For each Blocker and Should-fix in the review:
   - Verify it against the code yourself. If the finding is wrong, append `R-n: REJECTED — <evidence file:line>` to the review file.
   - If real: classify A/B/C and act. Class A/B → fix with a test that would have caught it, one commit per finding:
     `fix({{MOD}}): R-n <short desc>`. Class C → park it (and set affected tasks PARKED/WAITING).
3. Nits: ignore.
4. Run `{{TEST_CMD}}`. It must be green when you stop. If you cannot get it green, revert only your own uncommitted
   changes, write the diagnosis in build-log, and stop — the loop will roll back to the last green commit.
Summary: findings fixed / rejected / parked, test count. Stop.
