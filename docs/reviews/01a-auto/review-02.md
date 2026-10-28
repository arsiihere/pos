APPROVE

# 01a auto build — independent review of batch 02

Reviewer: independent session. I did not write this code and changed none of it.
Scope: tasks 9–13 (`38f8ce8`, `392b1a4`, `d0d8172`, `7d3cb9d`, `4856528`), checked against `docs/plans/01a-plan.md` tasks 9–13 and spec v1.0 §4.2, §4.3, §6.1, S14, S15, S22, S27, S28, S33, S34, S35 k, S41, S44–S47 and §10 #66, #68, #127, #129, #148.

## Verification run (by this reviewer)

- `pnpm test`: **85 test files, 303 tests, all passed** (single run, green; the flaky failure mentioned in batch-02.md did not happen again).
- `pnpm lint` (`eslint .`): no output, clean.
- `pnpm typecheck`: 5/5 tasks successful (includes the new `@pos/engine`).
- Numbered tests, each cited exactly once: #66 `packages/engine/src/stock.test.ts:38`, #129 `stock.test.ts:57`, #148 `stock.test.ts:77`, #68 `packages/engine/src/business-day.test.ts:32`, #127 `packages/engine/src/lint.test.ts:16`. This matches the plan's coverage table (task 11: 66, 129, 148; task 12: 68; task 13: 127).

## Per task

**Task 9: snapshot schema (`packages/events/src/config.ts`).** The fields and nullability match the §4.3 JSON: `snapshot_schema_version` literal 1, `config_version` ≥ 1, `day_stale_after_hours` 1…72, `day_min_gap_hours` 0…24, item units, threshold, `carries_over`, windows, nullable `tax_class_id`, and `is_archived` on stations, programs and tax classes (S22, S34, S44–S47). There is no `business_day_start_ms`. The schema is not `.strict()`, so unknown fields are dropped (S28 c, tested). Numbers use `z.number().int()` with no coercion, so the `"120000"` string fails (S27, tested). `isStockTracked` follows the rule in the last paragraph of §4.3 (`config.ts:106-110`), and all four cases are tested. `SyncConfigEnvelopeSchema.snapshot` is `z.record(z.string(), z.unknown())`, as §6.1 and S27 iii require. Only the 3 planned files changed.

**Task 10: the seven events.** The payloads match the §4.2 table. Ranges are 0…1 000 000 for `on_hand` and 1…1 000 000 for `quantity`, `unit` is required, `business_date` must be `YYYY-MM-DD`, `snapshot_hash` must be 64 hex characters, and there are no epoch fields. The fixture count goes from 14 to 21 `.v1.json` files (14 new files in total, as the plan says). The builders use the stream types from §4.2 (`hub` for config and day events, `stock`/item_id for the rest). `aBranchConfig` has "Karahi" as the slot station, I1 (piece) and I3 (g/piece/250) are tracked, and I2 is not. It is tested in `testing/builders.test.ts`. The files match the plan's list.

**Task 11: engine stock slice.** The `StockSet` fold keeps `reserved` and sets `set_at = recorded_at` and the event's unit. `StockAdded` adds to `on_hand`, keeps `set_at` and `unit`, and throws `StockAdded unit mismatch` on a unit mismatch. Because the update is immutable, the prior state stays unchanged (`apply-event.ts`). This is tested in #129. `countIsValid`, `availableStock`, `saleUnitsAvailable` and `canServeFromStock` match S41, S44 and S14. An unknown event returns the same reference (S15, tested). `package.json` has only the two workspace dependencies. The lockfile diff adds only the `packages/engine` importer. There are no `node:*` imports in `src`.

**Task 12: business day, `dayUnits`, `stockLevel`.** `BusinessDayOpened` and `BusinessDayClosed` are folded from `recorded_at` (S33). A close with no open day is a no-op. `openDayStartMs` returns `opened_at` only while the day is open. `dayUnits` returns the frozen entry only while a day is open, otherwise the item's own fields (S44, tested with a changed snapshot). `stockLevel` returns `not_counted`, `out`, `low` (≤ threshold) or `ok` (S46, all cases tested). The fixture log has the day open, 4 `StockSet`, 1 `StockAdded`, `HubStarted` and the day close, and the expected state is arithmetically right (I3: 1500 + 500 = 2000 with `set_at` 4000). `state.ts` and `index.ts` needed no change, as the report says.

**Task 13: browser-safe lint.** A single block follows the root block (`eslint.config.js:90-108`). It repeats the four root patterns, adds `node:*`, and ignores `hash.ts` and `**/*.test.ts`. No later block re-sets `no-restricted-imports` for these paths except the test-file block, which is exempt by design. The #127 test covers every `lintText` case in §10.5e and runs `lintFiles` on both packages. No dependency was added.

**Cross-cutting.** Each commit touched only its task's files. Subjects follow `feat(01a): task N … [spec …]`. These packages have no clock, `Math.random` or ULID calls (F §6.7). Determinism is kept: `set_at`, `opened_at` and `closed_at` come from `recorded_at` only. Tenant scoping, envelopes and the error catalogue do not apply: there are no routes or errors in this batch. Security: there is no logging, no client code and no PIN or directory handling beyond reusing `DirectorySchema` as a type.

## Blocker

None.

## Should-fix

None.

## Nit

1. **`packages/engine/src/stock.ts:69`**: `stockLevel` compares `available`, which is in the *frozen* day unit, with `item.low_stock_threshold`, which is in the *current snapshot's* `stock_unit` (S46). Scenario: a day opens with I3 counted in `piece`. Mid-day the owner changes I3 to `g` with a threshold of 1000. Now 5 pieces read as `low` (5 ≤ 1000) until the next open. The spec does not decide this case. Fix: raise it as a spec question for 03a/01a, either freezing `low_stock_threshold` in `BusinessDayOpened.units` or treating the threshold as null when `dayUnits(...).stock_unit ≠ item.stock_unit`. Do not change the code before the spec decides.
2. **`packages/engine/src/apply-event.ts:40`**: `business_day.units` holds the event payload object by reference, so the engine state aliases the event. A caller that mutates `state.business_day.units` would also change the logged event's payload in memory. `dayUnits` already returns a copy, so the risk is low. Fix: `units: { ...p.units }`, or freeze the copy, before task 44 wires the state holder.
3. **`eslint.config.js:103`**: the block refuses only `node:*`. A bare built-in such as `import { createHash } from 'crypto'` or `'fs'` still passes in `packages/engine` and `packages/domain/src`. This matches S35 k word for word, so it is not a divergence. Fix (spec-first, optional): add the bare names of Node built-ins (`crypto`, `fs`, `path`, `os`, `zlib`, …) to the group in a later spec revision.
4. **`packages/engine/src/business-day.test.ts:35`**: `arrayContaining` checks only that the four event types are present. If the fixture were edited down to fewer `StockSet` events, this check would not notice. The plan names 4 `StockSet` and one `StockAdded` on 2 items. Fix: assert the exact `event_type` sequence, e.g. `toEqual(['BusinessDayOpened','StockSet','StockSet','StockSet','StockSet','StockAdded','HubStarted','BusinessDayClosed'])`.
5. **Flaky run reported in batch-02.md**: the failing test was not identified. My run was green. Fix: on the next full-suite failure, capture the test name with `pnpm test 2>&1 | grep -E "FAIL|×"` before rerunning, and record it in the next batch report.
