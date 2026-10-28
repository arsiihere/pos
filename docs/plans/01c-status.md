# 01c status board

Plan: `docs/plans/01c-plan.md`. Spec: `docs/specs/01c_Menu_Variants_Spec_v1.0.1.md`.

## Deviations (AD-n)

| # | Deviation | Kind | Goes to |
|---|---|---|---|
| AD-1 | §4.2 `dayDraws` gains `configStockUnits` (plan P-6, gap G3): `dayDraws(state, item, configStockUnits: Readonly<Record<string, Unit>>)`, needed for the V20 m14 fallback | signature | spec, at the as-built review |

## Tasks

| Task | Status | Commit | Tests | Note |
|---|---|---|---|---|
| 1 | DONE | `15eb7d5` | #27, [01c §5.1] | Constraint names read from the test DB match §5.1 (no deviation). Expectation-only edits to `staff-roles-migration.int.test.ts` and `migrate-ahead.int.test.ts` (hard-coded applied-migration list → includes 0006; fake future migration → 0007) |
| 2 | DONE | `5c91601` | [01c §9] | The four 404 codes; F §6.2 already carried them (`0d24760`) |

## Checkpoints

### Batch 1 (§11 steps 1–2) — 2026-10-29

- Tasks 1–2 done; both reviews clean (minors only, not looped).
- Gate: `pnpm -w typecheck && pnpm -w lint && pnpm -w test` → 219 files, 919 tests passing.
- Tests closed: 01c #27. Re-keyed: none.
- AD added: AD-1 (recorded on the developer's instruction; applies from task 8).
- Open seams: none.
- Watch: one non-reproducible Postgres `57P01` teardown error from the scratch-db helper in task 1's first full run, and 17 cloud failures in task 2's first full run caused by two test runs overlapping on the shared Postgres; both reran green.
