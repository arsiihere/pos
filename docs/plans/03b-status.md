# 03b + 03c — build board

Plans: `03b-plan.md`, `03c-plan.md`. Prompts: `03b-03c-prompts.md`. Gaps: `03b-03c-gaps.md`. Integration branch: `module-03b`. Only the integrator edits this file.

> **Test DB reset after P0.F** (P0.F edits `0012_kds_settings.sql`; a test db that already applied the old 0012 fails with `MigrationChecksumError: 0012_kds_settings.sql`). The integrator runs it at merge time:
> - cloud VM / remote agent: `psql postgres://pos:pos@127.0.0.1:5433/postgres -c 'DROP DATABASE IF EXISTS pos_test WITH (FORCE)' -c 'CREATE DATABASE pos_test OWNER pos'`
> - owner's laptop (container `pos-pg-test`, user `pos`, db `pos_test`; never stop or restart it): `docker exec pos-pg-test psql -U pos -d postgres -c 'DROP DATABASE IF EXISTS pos_test WITH (FORCE)' -c 'CREATE DATABASE pos_test OWNER pos'`
> - CI needs nothing (fresh `postgres:16` service per run).

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-11: owner ruling B3-5 (a) — 0016 ab options_json SQL se backfill karti hai (checkpoint delete nahi; 02b v1.0.9).
> - 2026-11-11: owner rulings B3-3 (a), B3-4 (a) — 03b v1.0.4: units badalne pe KDS details dobara; return line options copy karti hai (03a v1.2.3, 02b v1.0.8; task P0.20).
> - 2026-11-11: owner rulings C1-2 (a), C1-3 (a), C3-1 (yes) — 03c v1.0.4 (cancel slip 0 left → whole form), c7 test edit approved, c15 / c19 USB child file open.
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
| P0.16 | — | not started — B3-2 plain options on KDS / tickets (02b `order_lines.options_json`, migration 0016, SQL backfill per B3-5). Needs: spec batch #42, c10 (#33) |
| P0.17 | — | not started — B2-2 `auto_done` undo (03a `EngineLine.done_undone`, `ENGINE_STATE_VERSION` 4). Needs: spec batch #42 |
| P0.18 | — | not started — B1-1 `SendTestAlert` point id → 404 `POINT_NOT_FOUND`; B1-2 `always_on` reaches point-bound tablets (01d v1.2.3). Needs: spec batch #42, b6 (#32) |
| P0.19 | — | not started — P15-1 Ready window / KDS offline boxes in seconds (01a v2.4.3; client only). Needs: spec batch #42 (P0.15 merged) |
| P0.20 | — | not started — B3-4 return lines copy plain options + no-station option children (02b v1.0.8, 03a v1.2.3). Needs: this spec PR, P0.16 (#47) |

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
| AD-18 | b13 (B4-1) | 03b §7 "folds ≤ 2 statements per event" vs the pass folds that need 3. | **ruled (a)** (owner 2026-11-11): 03b v1.0.3 §7 — pass `ReadyToServe` 3, `Handover` 3, a settle 3, every other fold ≤ 2; R-3: a rebuild may set `settled_at` earlier for partial-unit settles, read only with `IS NULL` |
| AD-19 | b9a (B2-2) | At an `auto_done` station the fires tick re-infers Done after `ItemDoneUndone`. | **ruled (a)** (owner 2026-11-11): 03a v1.2.2 `EngineLine.done_undone`, the inference skips flagged lines; 03b v1.0.3 §3.2; code P0.17 |
| AD-20 | b11 (B3-2) | `LineDetail.options` had only option children; plain `ItemAdded.options` were not stored. | **ruled (a)** (owner 2026-11-11): 02b v1.0.7 `order_lines.options_json` (0016), 03b v1.0.3 §4.4, 03c v1.0.3 §3.3; code P0.16 |
| AD-21 | c5 (C1-1) | A later save of an archived printer: keep or overwrite `archived_at`? | **ruled (a)** (owner 2026-11-11): keeps its first `archived_at`; un-archive clears it (03c v1.0.3 §3.2) |
| AD-22 | b8 (B2-1) | At a batch station, does Done mark the whole load or only the tapped line? | **ruled (a)** (owner 2026-11-11): Done marks every line of the load that step 3's rule admits (cooking, or fired added from stock / at an `auto_done` station), the load is one unit (03a D14); 03b v1.0.3 §3.2 step 5; matches b8 as built (#19, reading 6) |
| AD-23 | b15 (B4-3) | Handover receiver "active": in the directory only, or also signed in? | **ruled (a)** (owner 2026-11-11): also an open staff session, else 422 `PASS_RECEIVER_INVALID`; §6.8 statements 5 dine-in / 4 otherwise (03b v1.0.3); code in b15 (#35) |
| AD-24 | b6 (B1-1) | `SendTestAlert` to a point id that is not a point. | **ruled (a)** (owner 2026-11-11): checked against active `branchConfig().points` → 404 `POINT_NOT_FOUND` (01d v1.2.3); code P0.18 |
| AD-25 | b6 (B1-2) | `always_on` and Pass tablets. | **ruled (a)** (owner 2026-11-11): `always_on` also reaches unrevoked tablets with `devices.point_id` (01d v1.2.3 §3.4); code P0.18 |
| AD-26 | P0.15 (P15-1) | KDS offline's 10 s floor cannot be typed in two-decimal minutes. | **ruled (a)** (owner 2026-11-11): Ready window and KDS offline in seconds, Served estimate in minutes (01a v2.4.3); code P0.19 |
| AD-27 | b15 (B4-2) | Handover with no list when more than 40 done lines wait at the point. | **ruled (a)** (owner 2026-11-11): take at most 40 in line order (`added_at`, `order_item_id`), result `remaining`, a second call takes the rest; named lists 1–40 as today (03b v1.0.3 §3.5 step 3, §6.8, test 24a); code in b15 (#35) |
| AD-28 | c8 (C1-2) | A cancel slip whose units leave 0 live units: "- n x Naan  0 left" or the whole form? | **ruled (a)** (owner 2026-11-11): whole form `CANCELLED  T7  <n> x Naan`, n = the job's units (02b sends `min(units, live)`); `units: null` and partials unchanged (03c v1.0.4 §3.5, test 3) |
| AD-29 | c7 / c10 (C1-3) | c10's `render.int.test.ts` inserts tickets by hand. | **ruled (a)** (owner 2026-11-11): c7 removes the manual ticket inserts from `apps/hub/test/print/render.int.test.ts` and asserts c7's `tickets` row exists — approved cross-lane test edit, done in c7 (#34) |
| AD-30 | c15 / c19 (C3-1) | The USB status read-back needs `print/transport/usb-child.ts` (c13's file). | **ruled yes** (owner 2026-11-11): c15 and c19 may edit `apps/hub/src/print/transport/usb-child.ts` (open for the status read-back, 03c §3.7 "only if its test print proved status"); added to both plan rows' Files |
| AD-31 | b18 / P0.16 (B3-3) | `kds_lines` sends a line's details once per id; a partial removal / void or a weight change leaves the scaled options stale. | **ruled (a)** (owner 2026-11-11): details are re-sent whenever live units change (`ItemRemoved` / `ItemVoided` with units, `LineWeightSet`), budget unchanged (03b v1.0.4 §6.16); code in P0.16 (#47), approved edit of `ws/kds-catch-up.ts` |
| AD-32 | 02b return (B3-4) | A return line had `options: []`, so the remake ticket lost "No onion". | **ruled (a)** (owner 2026-11-11): the return line copies plain options and option children with no station, money 0 (03a v1.2.3 §3.8a, 02b v1.0.8 §3.8, §6.7 3–4 statements); code P0.20 |
| AD-33 | P0.16 (B3-5) | 0016 deleted the `orders` checkpoint to force a rebuild, but a `ClockAlarm` at boot step 3a recreates it before catch-up (#47 review). | **ruled (a)** (owner 2026-11-11): 0016 backfills `order_lines.options_json` once in SQL from the stored `ItemAdded` events (same JSON as the live fold, `NULL` when none) and leaves the checkpoint alone (02b v1.0.9 §5); code in P0.16 (#47) |

## Gate times (CI, for the record)

| Date | Branch / PR | Wall | Tests |
|---|---|---|---|
