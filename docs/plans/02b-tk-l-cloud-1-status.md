# 02b-TK L-CLOUD-1 status

| Task | Commit | Checks |
|---|---|---|
| C-1 | `c301fb15` | 01a #206 failed before migration 0021 and passed after it. All 83 cloud database tests passed. Historical migration tests expect the extra branch version bump when they run the full folder. |
| C-3, day-end snapshot | `57ef8d3c` | 01a #214 and #218 day-end snapshot checks failed before implementation. Both snapshot suites passed, including the existing 28-statement builder and 33-statement sync bounds. |
| C-4, day-end settings GET/PATCH | `3d045b69` | 01b #117 and 01a #218 settings checks failed before implementation. Settings and affected historical migration suites passed all 95 tests. Confirmed one audit row and one branch bump on change, and the existing 7-statement write and 3-statement no-op. |

Pending ownership decisions: the optional slip setting in the shared V4 parser, any compatibility changes to the client's kitchen timing type, and the restaurant branch-list query and response schema required by 01a #217–218 and 01b #116–117. 01a #216 is a client test outside this backend lane.

Hostile review and the first full gate found two stale integration assertions for the exact snapshot keys and the cumulative version bump. Both were corrected and rerun. The final full gate exited 0 with 8,777 tests passed, one pre-existing pilot-hardware skip, and one parked todo. Typecheck, lint, and the client build passed.
