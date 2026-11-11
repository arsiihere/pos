# 03b + 03c — build board

Plans: `03b-plan.md`, `03c-plan.md`. Prompts: `03b-03c-prompts.md`. Gaps: `03b-03c-gaps.md`. Integration branch: `module-03b`. Only the integrator edits this file.

> **Test DB reset after P0.F** (P0.F edits `0012_kds_settings.sql`; a test db that already applied the old 0012 fails with `MigrationChecksumError: 0012_kds_settings.sql`). The integrator runs it at merge time:
> - cloud VM / remote agent: `psql postgres://pos:pos@127.0.0.1:5433/postgres -c 'DROP DATABASE IF EXISTS pos_test WITH (FORCE)' -c 'CREATE DATABASE pos_test OWNER pos'`
> - owner's laptop (container `pos-pg-test`, user `pos`, db `pos_test`; never stop or restart it): `docker exec pos-pg-test psql -U pos -d postgres -c 'DROP DATABASE IF EXISTS pos_test WITH (FORCE)' -c 'CREATE DATABASE pos_test OWNER pos'`
> - CI needs nothing (fresh `postgres:16` service per run).

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-11: phase 0 done except P0.F / P0.15; lanes run in parallel (integrator call, owner informed 2026-11-11).
> - 2026-11-11: owner rulings aa gayi — B-2 (a): teeno boxes ab owner page pe (P0.15); review fixes P0.F mein (0012 ab config_version bump karta hai, AlertRaisedPayloadV3, specs 03b / 03c v1.0.2 sirf wording). P0.12–P0.14 merged.
> - 2026-11-11: **phase 0 done** (P0.1–P0.14 merged). Ab lanes B1, B2, B3, B4, C1 khol sakte hain. Open: P0.4 ka B-2 STOP (#6, needs-ruling); CLAUDE.md ko Foundation v1.12 pe point karna owner ka kaam.
> - 2026-11-11: phase 0 P0.1–P0.11 merged; P0.4 ka B-2 (owner settings wire) STOP pe — ruling chahiye (rec (b)). Spec bumps P0.13 PR mein.
> - 2026-11-11: phase 0 shuru — `module-03b` cut, labels ban gaye, P0.1 (CI hygiene G-11 / G-12) PR mein. Owner: 03c poora rakhna hai (USB + LAN, suspect recovery, paper fallback), HIGH pe do reviewers (W-6).
> - 2026-11-11: gap sweep done, 14 G-rows ruled (a); spec v1.0.1. Next: phase 0.
> - 2026-11-11: specs 03b v1.0 + 03c v1.0 APPROVED; plans, CI gate and cloud setup ready. Waiting: 02b merge → gap sweep.

## Owner rulings on how the build runs (2026-11-11, 14:16 PKT: "Sab haan")

| # | Ruling |
|---|---|
| W-1 | The author chat (claude.ai, this build's integrator) creates the GitHub ruleset for `module-03b` via the API: PR required, check `gate` required, rebase merge only, no force push. **`module-02b` is excluded** (its own integrator pushes directly). |
| W-2 | The integrator merges green PRs into `module-03b` itself. |
| W-3 | The integrator opens `spec-03b` → `main` and merges it when `gate` is green. The final `module-03b` → `main` merge stays the owner's. |
| W-4 | Lanes run as remote agents launched from the integrator chat, at most 5 at once. |
| W-5 | Repo visibility: **public** (owner, 2026-11-11), so GitHub Actions minutes are free. Never commit a secret. |
| W-6 | (2026-11-11 16:38 PKT: "Pilot mein dono rakhni hain USB aur LAN; sab rakho") 03c stays as specced: suspect recovery, USB **and** LAN transports, paper fallback for dark screens — nothing cut for the pilot. RISK HIGH tasks keep two fresh reviewers. |
| B-2 | (2026-11-11) PR #6 STOP on B-2 ruled **(a)**: build the three kitchen-timing boxes now → task **P0.15**. Review rulings the same day: AD-3/6/8/10/13/15 accepted, AD-9 changed (0012 bumps `config_version`), AD-5 rejected (retype), AD-17 → CLAUDE.md names Foundation v1.12; new global "Files" rule for G-9-class pinned tests (`03b-plan.md`). |

## Phase 0

| Task | PR | State |
|---|---|---|
| P0.1 | #3 | merged `42bc184` |
| P0.2 | #4 | merged `8573511` |
| P0.3 | #5 | merged `43e52d9` |
| P0.4 | #6 | merged `1d8eb3c` (A-1 only; B-2 STOP ruled **(a)** by the owner 2026-11-11 → built in P0.15) |
| P0.5 | #7 | merged `a144367` |
| P0.6 | #8 | merged `ff1f767` |
| P0.7 | #9 | merged `dea6a60` |
| P0.8 | #10 | merged `36c17aa` |
| P0.9 | #11 | merged `78c8b02` |
| P0.10 | #12 | merged `6f748ad` |
| P0.11 | #13 | merged `c6f2656` |
| P0.12 | #14 | merged `491f549` |
| P0.13 | #15 | merged `9ac8bd5` |
| P0.14 | #16 | merged `0432673` |
| P0.F | #22 | in review (review fixes, owner rulings 2026-11-11) |
| P0.15 | #29 | in review (B-2 ruling (a): kitchen timing settings writable + owner page boxes) |

## Lanes

| Lane | Task | PR | Needs | State |
|---|---|---|---|---|
| B1 | b5, b6, b7, b10 | — | — | ready to open |
| B2 | b8, b9a | — | — | ready to open |
| B3 | b11, b18 | — | — | ready to open |
| B4 | b13, b14, b15, b9b | — | b11, P0.14 (b15) | ready to open (b13 first) |
| B5 | b16, b17, 0e | — | b13–b15 | not started |
| B6 | b20, b21, b22, b23 | — | b6, b11, b18 | not started |
| C1 | c4, c5, c7, c8, c9 | — | — | ready to open |
| C2 | c11, c10 | — | b11 | not started |
| C3 | c12, c13, c14, c15, c16 | — | c10, c11, c7 | not started |
| C4 | c17–c22 | — | b20, c7, c14 | not started |

## Readings and rulings (AD rows)

| # | Task | Reading | State |
|---|---|---|---|
| AD-1 | P0.1 | The new scratch-db tests sit in `apps/cloud/test/helpers/scratch-db.int.test.ts` (the helper's own test file, not in the row). | proposed |
| AD-2 | P0.1 | G-12 "log, ignore 57P01": every scratch / admin pool error is logged by code only and never rethrown. | proposed |
| AD-3 | P0.2 | Tests that pin AlertRaised's latest version / the fixture count follow the row (G-9 class): `packages/events/src/alerts.test.ts`, `fixtures.test.ts` (38 → 39), `apps/hub/test/engine/kinds.int.test.ts:339` (2 → 3). | accepted (owner 2026-11-11) |
| AD-4 | P0.2 | The four new detail fields are `max(40)` only, no `min(1)`. | proposed |
| AD-5 | P0.2 | `alerts/raise.ts` keeps its `AlertRaisedPayloadV2` type (plan: no hub change). | **rejected → retyped** (owner 2026-11-11): `raise.ts`, `projections/alerts.ts` use `AlertRaisedPayloadV3` (P0.F, no behaviour change) |
| AD-7 | P0.4 | **STOP (ruled):** B-2 puts three keys on `BranchEngineSettings`, which the owner page `KitchenTiming.tsx` types from; (a) add the three boxes, (b) wire keys now + exclude them in the client type (rec), (c) wait. | **ruled (a)** (owner 2026-11-11): built fully in P0.15 |
| AD-8 | P0.4 | Tests pinning engine_settings exactly follow A-1 (G-9 class): `config.test.ts`, cloud `builder*.int.test.ts`, `zones-migration.int.test.ts` (180 000 after the whole folder). | accepted (owner 2026-11-11) |
| AD-9 | P0.4 | `HUB_ENGINE_SETTING_DEFAULTS` in `@pos/events` `config.ts`; 0012 bumps no `config_version` (0007 / 0009 precedent). | **changed** (owner 2026-11-11): 0012 bumps `config_version` for every branch with a settings row (P0.F); `HUB_ENGINE_SETTING_DEFAULTS` in `@pos/events` accepted |
| AD-10 | P0.5 | `ConnectedSession` fakes in 01d tests gain `stationId` (required field). | accepted (owner 2026-11-11) |
| AD-11 | P0.7 | `Doc` block value types: `size 1 \| 2`, `align left \| center \| right`, `{ rule / cut / drawer: true }`, `{ feed: number }`; union exported as `DocBlock`. | proposed |
| AD-12 | P0.8 | Event value rules taken from the cited sections (Handover 1–40, sound 0–100, lane_label 1–20, printer name 1–40, paper 58 \| 80); `KdsStationBody.lanes.lanes_on` nullable (custom). | proposed |
| AD-13 | P0.9 | `alerts-migration.int.test.ts` pins the migration list; now 0001–0015. | accepted (owner 2026-11-11) |
| AD-14 | P0.11 | Contracts filled by `provideKds` / `providePrint` from the lane file; `undoReadyForLines` a no-op until b9b (b9a calls it first); slots hold data (`{ key, label }`, `{ key, label, run }`); hook homes `print/boot.ts` (c16), `print/retention.ts` (c22). | accepted, comment fixed (P0.F): B4 runs b13 → b14 → b15 → b9b, so until b9b an UndoDone does not undo Ready (plan rows b14 / b9b) |
| AD-15 | P0.13 | 02b's bump is **v1.0.6** (the specs named v1.0.4; 02b took v1.0.4 and v1.0.5 itself). | accepted (owner 2026-11-11); wording fixed in 03b / 03c **v1.0.2** (P0.F, no behaviour change) |
| AD-6 | P0.3 | Tests that pin the permission list, Cook = [] or the kitchen group count follow B-1 (G-9 class): `packages/domain/src/permissions.test.ts`, `apps/cloud/test/default-roles.test.ts`, `apps/cloud/test/cli/seed-tenant.int.test.ts`, `apps/client/src/features/owner/roles/RoleEditor.test.tsx`; #60's hub half is a new `apps/hub/test/auth/run-pass-default.int.test.ts`. | accepted (owner 2026-11-11) |
| AD-16 | all P0 | No subagent tool in the integrator session: every P0 task was self-reviewed, not by fresh reviewer subagents (two for HIGH: P0.9, P0.11). | owner informed; integrator now runs fresh reviewers before each merge |
| AD-17 | P0.13 | CLAUDE.md still names Foundation v1.11 as the source of truth; owner to point it at v1.12. | done |

## Gate times (CI, for the record)

| Date | Branch / PR | Wall | Tests |
|---|---|---|---|
