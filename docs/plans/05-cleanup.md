# 05 Billing — cleanup list (deferred MINOR review findings)

Owner ruling Q-60: fix rounds only for BLOCKER / MAJOR; MINOR findings land here and are fixed in the close tasks (Z) or the next change to the file. **Money MINORs are fixed before merge** (W-6) and never land here. Lanes list MINORs in the PR body under "Cleanup candidates"; the integrator copies them here. `#n` = the PR whose review found it.

"Owner?" = the spec is silent or a contract change is needed: ask before fixing.

## Phase 0a

| # | PR | File:line | Finding → action | Who fixes |
|---|---|---|---|---|
| C-1 | #266 | `packages/domain/src/billing/types.test.ts` | Runtime values only: dropping `as const` (type widens to `string[]`) still passes. Add an `expectTypeOf` pin per constant. | next change to the file / Z |
| C-2 | #266 | `packages/domain/src/billing/types.test.ts` | No test reaches the constants through the `@pos/domain` root barrel; a dropped re-export line shows only when a later task imports it. | next change to the file / Z |
