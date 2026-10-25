APPROVE

# 01a auto review — batch 03

Reviewer: independent, fresh session. Inputs: `docs/reviews/01a-auto/batch-03.md`, plan task 14 (`docs/plans/01a-plan.md:537–543`), spec `01_Restaurant_Setup_Spec_v1.0.md` §5.2 (lines 382–543), `docs/reviews/01a-auto/decisions.md` (D1, commit `c25750a`).

## Scope

Batch 03 committed **no feature code**. Task 14 stopped under the plan's own stop rule (`01a-plan.md:542`: "if `schema.int.test.ts` asserts an exact table list and fails, stop and report"). Commits after batch 02's review are only `35325ba` (batch report) and `c25750a` (owner decision D1 plus loop instructions, made by the owner, not the agent). I reviewed the two untracked task-14 files the next run will pick up:

- `apps/cloud/src/db/migrations/0002_restaurant_setup.sql`
- `apps/cloud/test/db/restaurant-schema.int.test.ts`

## Checks

**Spec conformance (§5.2).** I compared the migration line by line with spec lines 387–540. It matches exactly: `config_version`, `tax_enabled`, `day_stale_after_hours` 16 (1–72), `day_min_gap_hours` 4 (0–24), `branches_day_settings` (migration:1–8); `config_audit` with the actor CHECK and the insert-only trigger (10–30); `idempotency_keys` (32–38, S7/M69); `menu_items` v0.7 columns and the S44 unit CHECK (98–124, including `menu_items_name_order`); `availability_windows` with the one-target and `start<>end` CHECKs (126–139, S47); `item_routes` (141–154). There is no `business_day_start_ms` and no `config_epoch`, which matches the plan's Files note. Every PK and index leads with `tenant_id` (D54), and the test checks this at runtime.

**Tests (plan Step 1).** Each of the 5 named tests appears once:
- `#84` (test:70): the trigger fires on both UPDATE and DELETE (75–80). The `pg_index` query covers all 11 tables (set-equality at 92), and every index's first column must be `tenant_id` (93–95).
- `§5.2` (test:99): NULL `tax_class_id` is accepted. `stock_time_ms` 60 001 > `cook_time_ms` 60 000 is rejected. A slot station with freshness 0 is rejected. In each case the rejecting CHECK is the only constraint the row breaks.
- `S44` (test:113): piece/g is rejected, g/g×2 is rejected, and g/piece×250 is accepted as the positive control.
- `S47` (test:121): a window with both targets is rejected, start = end is rejected, and a wrap-past-midnight window is accepted.
- `S33` (test:141): defaults 16/4, `config_version` '1' and `tax_enabled` false; 4/4 is rejected; neither `business_day_start_ms` nor `config_epoch` exists.

Every test fails without the migration because the tables and columns are missing.

**Foundation §6.** No envelopes, error codes or events in this task. Times are `BIGINT` ms and money is `BIGINT` `_minor`, as the spec preamble requires.

**Files and dependencies.** Only the two task files exist as untracked files. No `package.json` or lockfile changes. `c25750a` touches only `docs/reviews/01a-auto/decisions.md` and `tools/auto/implement.md`.

**Security.** SQL only. Tenant-scoped composite FKs everywhere (for example `menu_items → categories (tenant_id, category_id)`, `config_audit → owner_users (tenant_id, user_id)`), so no cross-tenant reference is possible. No logging and no client code.

**Process.** Stopping instead of editing `schema.int.test.ts`, which was outside the Files list, was the correct reading of the plan. The report is accurate. D1 now authorises that edit, so the next run can finish task 14: change the test to `toContain` each of the 13 tables from 0001, drop the `idempotency_keys` absence clause, and keep the name and the `[00 §5.2]` tag.

## Real numbers (this session, working tree with the untracked task-14 files)

- `pnpm test`: **86 files, 308 tests; 306 pass, 2 fail.**
  1. `apps/cloud/test/schema.int.test.ts:30` `[00 §5.2] all tables exist and idempotency_keys does not`: the expected failure that D1 resolves.
  2. `apps/cloud/test/owner-auth/login.int.test.ts:68` `[00 §10 #53]` timing assertion: `expected 39 to be less than or equal to 38`. This is a flake. It passed when rerun alone (`pnpm vitest run` on that file plus `restaurant-schema.int.test.ts`: 2 files, 8/8 pass). The test belongs to module 00 and was not touched by this batch. The batch report says "no flaky failures this run", which was true for its run but not for mine.
- `pnpm lint`: clean (`eslint .`, exit 0).

## Findings

### Blocker
None.

### Should-fix
None in this batch's scope. The only red test caused by the batch is the one D1 already resolves.

### Nit
1. `apps/cloud/test/db/restaurant-schema.int.test.ts:148`: the S33 rejection only checks SQLSTATE `23514`. If a future migration added another CHECK on `branches` that 4/4 also breaks, the test would still pass for the wrong reason. Fix: `.rejects.toMatchObject({ code: '23514', constraint: 'branches_day_settings' })`. The other CHECKs are unnamed in the spec (Postgres generates names like `menu_items_check1`), so leave those as they are.
2. `apps/cloud/test/owner-auth/login.int.test.ts:66–68` (module 00, outside this batch): the 2× ratio on single samples of ~20–40 ms is flaky under full-suite load (39 vs 38 ms this run). Fix in a module-00 follow-up: compare medians of 5 samples per path, or allow an absolute slack (for example `slower <= faster * 2 + 10`), and park it in the parked-findings file instead of letting the auto loop chase it.
3. `apps/cloud/test/db/restaurant-schema.int.test.ts:93–95`: the `toEqual({ index, first })` pattern shows the index name on failure, which is good. A one-line comment saying so would stop a later "simplify" from collapsing it to `expect(row.first_column).toBe('tenant_id')` and losing the name.
