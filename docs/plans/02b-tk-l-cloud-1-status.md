# 02b-TK L-CLOUD-1 status

| Task | Commit | Checks |
|---|---|---|
| C-1 | `6a688231` (PR #495) | 01a #206 failed before migration 0021 and passed after it. All 83 cloud database tests passed. Historical migration tests expect the extra branch version bump when they run the full folder. |
| C-3, day-end snapshot | `f7b1aa02` (PR #495) | 01a #214 and #218 day-end snapshot checks failed before implementation. Both snapshot suites passed, including the existing 28-statement builder and 33-statement sync bounds. |
| C-4, day-end settings GET/PATCH | `d1cd07a7` (PR #495) | 01b #117 and 01a #218 settings checks failed before implementation. Settings and affected historical migration suites passed all 95 tests. Confirmed one audit row and one branch bump on change, and the existing 7-statement write and 3-statement no-op. |
| C-3, slip snapshot | `ae5b5bfa` | 01a #214 and #217 failed before implementation. All 147 focused tests passed after adding the optional V4 key and true default. Verified explicit false, canonical hash, and existing snapshot statement bounds. |
| C-4, slip settings and branch list | `5e055055` | 01a #217–218 and 01b #116–117 failed before implementation. Verified branch-specific values, invalid PATCH input, audit, versioning, hub sync, one-statement listing, seven-statement settings write, and three-statement no-op. |

The owner authorized the shared V4 parser and its tests, client type and fixture compatibility, and the branch-list query and response. 01a #216 covers client behavior outside this backend lane.

Hostile review and the first full gate found two stale integration assertions for the exact snapshot keys and the cumulative version bump. Both were corrected and rerun. The PR #495 full gate exited 0 with 8,777 tests passed, one pre-existing pilot-hardware skip, and one parked todo. Typecheck, lint, and the client build passed.

The first completion gate found that the billing snapshot fixture stopped at 0019 while the current builder reads a column from 0021. The fixture was advanced to 0021 and all 30 billing tests passed. The full rerun exited 0. Typecheck, lint, and client build passed, with 8,779 tests passed, one pre-existing pilot-hardware skip, and one parked todo.
