# 01a auto build — batch 03

Plan `docs/plans/01a-plan.md`, spec `docs/specs/01_Restaurant_Setup_Spec_v1.0.md`.

## Tasks done

None. The batch stopped at task 14 (cloud migration `0002_restaurant_setup.sql`). `.auto/STOP` is written.

| Task | Commit | Result |
|---|---|---|
| 14 Cloud migration `0002_restaurant_setup.sql` | not committed | STOP: plan stop rule triggered |

## Test count

- Before: 85 files, 303 tests (batch 02, all passing).
- With the uncommitted task-14 files: 86 files, 308 tests, **307 pass, 1 fails**.
- Committed tree: unchanged at 85 files, 303 tests.

## What happened

- `apps/cloud/test/db/restaurant-schema.int.test.ts` adds 5 tests: `[01a §10 #84]` (insert-only trigger on UPDATE and DELETE; every PK and index on the 11 new tables leads with `tenant_id`, checked via `pg_index`), `[01a §5.2]`, `[01a §5.2, S44]`, `[01a §5.2, S47]` and `[01a §5.2, S33]`. All 5 failed first because the tables were missing, and all 5 pass after the migration.
- `apps/cloud/src/db/migrations/0002_restaurant_setup.sql` is spec §5.2 lines 387–540 byte for byte (checked with `diff`).
- `pnpm test` then fails one existing module-00 test: `apps/cloud/test/schema.int.test.ts` › `[00 §5.2] all tables exist and idempotency_keys does not`. It asserts the exact 13-table list and that `idempotency_keys` is absent. Task 14's plan text says to stop and report in exactly this case. Fixing it needs an edit to `schema.int.test.ts`, which is not in task 14's Files list, so nothing was committed.
- Both task-14 files are left **untracked** in the working tree, so the next run can commit them once the decision is made.

## Decision needed

Allow task 14 to modify `apps/cloud/test/schema.int.test.ts`. Recommended: extend the expected list with the 11 01a tables (`availability_windows`, `batch_programs`, `categories`, `config_audit`, `dining_tables`, `floors`, `idempotency_keys`, `item_routes`, `menu_items`, `stations`, `tax_classes`) and drop the `not.toContain('idempotency_keys')` clause, which 01a S7 deliberately reverses. Then add the file to task 14's Files list and rerun the task.

## Anything odd

- Nothing else. No flaky failures this run: the one red test fails deterministically for the reason above.
- The untracked `.claude/settings.local.json.bak` is still untouched.
