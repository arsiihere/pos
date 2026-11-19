# 05 Billing — cleanup list (deferred MINOR review findings)

Owner ruling Q-60: fix rounds only for BLOCKER / MAJOR; MINOR findings land here and are fixed in the close tasks (Z) or the next change to the file. **Money MINORs are fixed before merge** (W-6) and never land here. Lanes list MINORs in the PR body under "Cleanup candidates"; the integrator copies them here. `#n` = the PR whose review found it.

"Owner?" = the spec is silent or a contract change is needed: ask before fixing.

## Phase 0a

| # | PR | File:line | Finding → action | Who fixes |
|---|---|---|---|---|
| C-1 | #266 | `packages/domain/src/billing/types.test.ts` | Runtime values only: dropping `as const` (type widens to `string[]`) still passes. Add an `expectTypeOf` pin per constant. | next change to the file / Z |
| C-2 | #266 | `packages/domain/src/billing/types.test.ts` | No test reaches the constants through the `@pos/domain` root barrel; a dropped re-export line shows only when a later task imports it. | next change to the file / Z |
| C-3 | #281 | `packages/domain/src/currency.ts` | `UnknownCurrencyError` is not a `DomainError`; an HTTP / CLI path calling `currencyExponent` must catch it and map it to a §9 code before any write (else 500). | P0.9b / P0.3b (H-5) |
| C-4 | #277 | `packages/domain/src/billing/fiscal-snapshot.ts` | `order_type: string` → narrow to an order-type union once a shared `ORDER_TYPES` constant exists. | next change / Z |
| C-5 | #277 | `packages/domain/src/billing/fiscal-snapshot.test.ts` | Forbidden keys are exact names; a pattern-based deep-key helper on `z.output<typeof InvoiceIssued>` would catch `buyer_*`-style keys. | task 5 |
| C-6 | #278 | `apps/hub/test/billing/fiscal/outbox-db.ts` | After task 6, `fileURLToPath` may go unused. | task 6 |
| C-7 | #280 | `apps/hub/src/billing/fiscal/port.ts` `findSecret` | Credential-name collision check misses keys of `z.record(z.enum(['token']), …)` (`propertyNames.enum`); a marked field is still caught. | next change / Z |
| C-8 | #280 | `apps/hub/src/billing/fiscal/none.ts` | Switch to the shared `@pos/events` `fiscal-adapters/none.ts` schema once P0.9a (#276) merges (R-28a-9). | after #276 |
| C-9 | #283 | `apps/hub/src/billing/fiscal/worker.ts` | Statements prepared per row; prepare once per pass (count fixed, no N+1). | next change / Z |
