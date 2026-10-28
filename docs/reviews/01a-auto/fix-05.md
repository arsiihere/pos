# 01a auto fix: batch 05

Review: `docs/reviews/01a-auto/review-05.md` (CHANGES NEEDED: 0 blockers, 1 should-fix, 5 nits).

## Blocker

None.

## Should-fix

| Id | Finding | Outcome |
|----|---------|---------|
| S1 | The window statement in `config-sync/builder.ts` read `item_routes` through `TenantLevelRepository` with only `branch_id = $2` | **Fixed** in `9d64905`. The statement now runs through `scoped.query`, and the `item_routes` subquery uses the full predicate `tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3`. Failing test first: `[01a D54] the window statement returns no item windows for a branch outside the caller’s branches`. It builds branch A with `branchIds = [branch B]` and failed with IT-0000's windows before the fix. #4, #5 (still 7 statements) and S47 stay green. |

## Nits

| Id | Finding | Outcome |
|----|---------|---------|
| N1 | Tautological wire-hash line in #114 | **Fixed** in `d2bb567`. The line is dropped. A comment now says the "hub applies it" clause lands with tasks 39–40 as `[01a §10 #114 hub part]`. |
| N2 | Station order (by name, then id) is not stated in §4.3 | **Fixed** in `b818f2a`. The rule is recorded in `parked.md` for the next spec version, and the code is unchanged. |
| N3 | A no-op PATCH still writes an audit row and bumps `config_version` | **Not changed.** The fix is optional, and the spec doesn't forbid the current behaviour. Skipping the write would change behaviour the spec doesn't define (audit and bump semantics in §6.4/S8), so it needs a spec decision first. The current behaviour is recorded here as intended until then. |
| N4 | The cross-tenant loop would pass a pre-guard 400 on branch-path routes | **Fixed** in `e40f005`. Routes whose path contains `:branch_id` must now return `404 BRANCH_NOT_FOUND`. |
| N5 | `pgCounter` adds an `acquire` listener on every call | **Fixed** in `50efca1`. There is now one counter per pool (a `WeakMap`), and a second call returns the first. A failing test came first: `a second pgCounter on the same pool reuses the first: one listener, one wrap`. |

## Verification

- `pnpm test`: **92 files, 344 tests, all passed** (was 342; +2 new tests).
- `pnpm lint`: clean.
