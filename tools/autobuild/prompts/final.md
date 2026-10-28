# STEP: FINAL MODULE GATE (fresh session, read-only on code)

You are deciding whether module {{MOD}} can merge. Do not fix code in this step.

Check and report each with evidence:
1. Coverage: every test number in the spec's test list exists in the code AND passes (`{{TEST_CMD}}`). List missing ones.
2. Every Definition-of-Done / acceptance item of the spec: met / not met (file:line).
3. Status board: counts of DONE / PARKED / WAITING / BLOCKED / TODO.
4. Every open Blocker in docs/reviews/{{MOD}}-autoreview-history.md is fixed or REJECTED with evidence.
5. Every AD-n in docs/reviews/{{MOD}}-auto-decisions.md: still Class B? Flag any that should have been Class C.
6. Skipped tests: list each with the reason; any skip not allowed by the spec is a Blocker.
7. Foundation §6 conformance spot-check: envelopes, error codes, naming, migrations, folder layout.

Write docs/reviews/{{MOD}}-final-review.md. FIRST LINE exactly:
`VERDICT: SHIP` only if 1–7 are all clean AND PARKED/WAITING/BLOCKED/TODO are all 0. Otherwise `VERDICT: HOLD`.
Then a "Human inbox" section: each parked item, each flagged AD-n, each blocker — one line each, newest decision needed first.
If SHIP: also update docs/specs/README.md module {{MOD}} status → "Implemented (autobuild)" (add "pending hardware smoke" if any hardware item is open in README).
Commit: `review({{MOD}}): final gate`. Stop.
