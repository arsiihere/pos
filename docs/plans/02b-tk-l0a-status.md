# 02b-TK L0a status

| Task | Commit | Checks |
|---|---|---|
| B1-0 | `36b44c3b` on `module-02b-tk` | Confirmed cloud migration `0020_cashier_mark_served.sql` is present on the base branch. |
| B1-1 | `e95a9fd5` | Red then green for the 600,000 ms lead and 422 catalogue entry (02b §3.2 step 2b, §9, F §6.2). |
| H-1 catalogue entries | `d4946c5f` | Red then green for display, tracking, and rate-limit statuses (00 HPA §9, F §6.2). |
| S-3 catalogue entry | `15a3416b` | Red then green for the takeaway slip refusal (03c §9, F §6.2). |
| C-2 catalogue entry | `ee31a88e` | Red then green for the short-code conflict (01a §9, F §6.2). |

B1-6 is done. Tests 214 (BD-3), 218 (domain and hub schema) failed before implementation and passed after it. The lanes doc said business-day.ts; spec says availability-windows.ts; spec followed (owner 2026-11-24).

The implementation diff adds no SQL or migrations. The catalogue suite passed all 27 tests.

The pre-B1-6 full gate exited 0. Typecheck and lint passed. Vitest reported 8,751 passed, two skipped, and one todo. The inventory race suite passed all seven tests after fetching `origin/main`, including the previously skipped [08a #26]. The pilot-hardware skip and parked [03a BF-9] todo are existing repository conditions.

The full gate after B1-6 exited 0. Typecheck, lint, and the client build passed. Vitest reported 8,770 passed, one pilot-hardware skip, and one parked todo. The two focused test files passed all 129 tests.

Next after L0a merges are L-CLOUD-1 and L-PRINT in parallel.
