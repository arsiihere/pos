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
| C-10 | #282 | `apps/hub/test/auth/pin.int.test.ts:436` (+ `onMatch` twin) | Asserts `hub.logs()` lacks the PIN `'1234'`; the pino line's `"pid":12343` makes it fail whenever the pid contains 1234. Assert on parsed `msg` / `err`, or use a PIN no pid can contain. | Owner? (01d / auth, not 05) |
| C-11 | #282 | task 13 / §6.9 `AddPayment` | Should refuse a payment while the split has a `tax_unresolved` block (compute counts such lines as untaxed in the dues). | task 13 |
| C-12 | #276 | `packages/events/src/admin/billing.ts` `documentShape`, `Fiscal` | Unknown keys are stripped, not refused; `.strict()` on `fiscal` would tell the owner. | P0.9b |
| C-13 | #276 | `billing.ts` (`max_discount_pct`, `variance_threshold_minor`, `petty_cash_limit_minor`, `open_bill_flag_minutes`, `stuck_after_ms`) | Negatives accepted (no floor stated, R-4). | P0.9b after 01a v2.6 |
| C-14 | #276 | `billing.ts` `AdapterSettings` | 4 KB over the whole map vs per adapter (R-3); same for `none` / `PRA` (`{}`). | P0.9b |
| C-15 | #279 | `packages/domain/src/billing/docs.ts` `headerBlocks` | `show.tax_reg_no` on and `{tax_reg_no}` in a header line prints registrations twice; proposal: toggle controls only the fixed block (state it in 01a v2.6). | 4b |
| C-16 | #279 | `docs.ts` `spread` | Widths in UTF-16 units, not printer columns (Urdu / combining marks approximate), as 03c. | Owner? (receipt languages, later) |
| C-17 | — (owner request 2026-11-21) | 01a owner app tax-class form; owner Billing page; cloud tax-class route | When a tenant has any branch on a jurisdiction whose adapter is not `none` (e.g. PK-PB / PRA), the tax-class create / edit form asks for `fiscal_category`; it warns, never blocks (tax classes are tenant-wide, the jurisdiction is per branch). The owner Billing page lists the active tax classes with no mapping. Purpose: catch early the `tax_unresolved` setup gap behind C-11 (a tax class added after the billing settings were saved has no PRA mapping, so its bills cannot close). Owner's choice (2026-11-21): later, a separate small 01a lane after 05 closes (spec bump + cloud route check + owner-app form). C-11 stays a follow-up. | **01a** (not 05), later lane |
