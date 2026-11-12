# 03b + 03c — build board

Plans: `03b-plan.md`, `03c-plan.md`. Prompts: `03b-03c-prompts.md`. Gaps: `03b-03c-gaps.md`. Integration branch: `module-03b`. Only the integrator edits this file.

> **Test DB reset after P0.F** (P0.F edits `0012_kds_settings.sql`; a test db that already applied the old 0012 fails with `MigrationChecksumError: 0012_kds_settings.sql`). The integrator runs it at merge time:
> - cloud VM / remote agent: `psql postgres://pos:pos@127.0.0.1:5433/postgres -c 'DROP DATABASE IF EXISTS pos_test WITH (FORCE)' -c 'CREATE DATABASE pos_test OWNER pos'`
> - owner's laptop (container `pos-pg-test`, user `pos`, db `pos_test`; never stop or restart it): `docker exec pos-pg-test psql -U pos -d postgres -c 'DROP DATABASE IF EXISTS pos_test WITH (FORCE)' -c 'CREATE DATABASE pos_test OWNER pos'`
> - CI needs nothing (fresh `postgres:16` service per run).

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-12: owner "sab rec" on #84 — Q-P22b (output notice Pass takeover ko bhi; 03b / 03c v1.0.7, code P0.23), Q-P22a (no change; 03b-N3 after pilot), Q-P22 (point-catch-up.ts edit accepted).
> - 2026-11-12: owner "teeno Rec" (11:00) — design brief Q-14 (DismissPrintSkip), Q-18 (archived station printer chhorta hai), Q-20 (KDS `has_printer`); 03b v1.0.6, 03c v1.0.6; code P0.22.
> - 2026-11-12: **saare 03b + 03c hub tasks merged** (PR #73 aakhri). Close: acceptance map (Z1) neeche, GAPs upar; manual-check lists (Z2); PR `module-03b` → `main` aapke merge ke liye (Z3). GAPs sirf client (BU / CU) aur do story lines (G5, G6).
> - 2026-11-12: owner "sab Rec" (07:39) — C3-2, C3-3 (c15), C4-1 (c17), B2-3 + P18-1 (P0.21); 03b v1.0.5, 03c v1.0.5, 01d v1.2.4.
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

## Close (Z1) — known GAPs (read first)

Acceptance map below, made on `module-03b` @ `14f9b6d` (all 03b + 03c hub tasks merged, PR #73 last). Tests found by grepping test titles for `[03b #n]` / `[03c #n]` and the ruling ids; every hub row has at least one test. **GAP** = no test in the repo. No code was written for any of them (close task rule).

| # | GAP | Why | Where it goes |
|---|---|---|---|
| G1 | 03b §10 tests **70–75** (station view order / `moved` / placeholders, late colouring, offline banner, coming-up strip, Pass readiness + takeover section, config refetch) | client tests; the KDS, Pass and Kitchen-screens pages are not built (`apps/client/src/features/kds/` holds only `slots.ts`) | BU1–BU3 (`03b-plan.md` client rows, prompts §6) |
| G2 | 03b acceptance **E3-KDS AC5** "client sound test" | client | BU1 |
| G3 | Client halves of **E3-KDS AC1–AC4, AC6–AC8, AC10** (what the screen shows) | hub halves are proven (map below); the screens are client | BU1–BU3 |
| G4 | 03c §8 client (Printers admin page, `printed` tag, Reprint action; 03c tasks 23–27) | not built | CU1–CU2 |
| G5 | **E3-PRT edge** "Done on screen after the ticket **already printed** → a strikethrough reprint" | not in 03c (§1.1 covers only the unsent half: an empty render is cancelled, #6); no test | **owner 2026-11-12: deferred to after the pilot** (KDS/Pass show printed + Done; add a strikethrough reprint later if the kitchen needs it) |
| G6 | **E3-KDS edge** "multiple cooks at one station → each tap logged under the logged-in cook" | superseded: station sessions write `actor_id = null` + the KDS `device_id` (00 M30, README carried row :171); proven the other way by 03b #1 | none (spec wins); story wording could follow |
| G7 | Manual checks 03b #41, 03c #28 | hardware; never in the cloud | owner, after merge: `03b-manual-checks.md`, `03c-manual-checks.md` |
| G8 | DoD line "README 03b / 03c row → Implemented" | the module rows stay as they are until the client lanes land (G1, G4); only the carried rows are closed (Z1) | after BU / CU |

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
| board | #17 | merged `07b080e` |
| P0.F | #22 | merged `bfcbb55` |
| P0.15 | #29 | merged `15bf89b` |
| P0.16 | #47 | merged `4a9a097` |
| P0.17 | #51 | merged `095bb36` |
| P0.18 | #59 | merged `f45ddc4` |
| P0.19 | #64 | merged `ccbfcf2` |
| P0.20 | #58 | merged `71cf05e` |
| P0.21 | #71 | merged `f69b5b7` |
| P0.22 | — | not started — Q-14 `DismissPrintSkip`, Q-18 printer released on station archive, Q-20 `has_printer` on the KDS (03c v1.0.6, 03b v1.0.6). Needs: this spec PR |
| P0.23 | — | not started — Q-P22b `output` notice also to the Pass tablets holding the station's takeover (03c v1.0.7, 03b v1.0.7). Needs: this spec PR, P0.22 (#84) |

## Lanes (final: every hub task on `module-03b`)

"landed" = the PR shows closed, not merged, and the task's commit is on `module-03b` under that sha.

| Lane | Task | PR | Commit on `module-03b` |
|---|---|---|---|
| B1 | b5 | #26 | landed `bc9c5af` |
| B1 | b6 | #32 | merged `09455f8` |
| B1 | b7 | #36 | landed `73b08f1` |
| B1 | b10 | #40 | merged `c971bd0` |
| B2 | b8 | #19, fixes #27, #39 | merged `709a01c`, `5d5afc9`, `f81fe6c` |
| B2 | b9a | #23 | merged `816b395` |
| B3 | b11 | #20 | merged `515ed0a` |
| B3 | b18 | #30 | merged `999ccf3` |
| B4 | b13 | #21 | landed `3810ca4` |
| B4 | b14 | #31 | merged `4d9be2c` |
| B4 | b15 | #35 | landed `661f343` |
| B4 | b9b | #38 | merged `a9b61c1` |
| B5 | b16 | #49 | landed `5ad7f9d` |
| B5 | b17 | #50 | merged `c88ca84` |
| B5 | 0e | #60, tests #63 | merged `bea070e`, `566342f` |
| B6 | b20 | #52 | landed `f04f2c8` |
| B6 | b21 | #54 | landed `ed88abb` |
| B6 | b22 | #56 | landed `ec95c17` |
| B6 | b23 | #57 | merged `86b6a5d` |
| C1 | c4 | #24 | merged `2fdcad4` |
| C1 | c5 | #28 | landed `d6674bf` |
| C1 | c7 | #34 | landed `fb4cc7b` |
| C1 | c8 | #41 | landed `eeb2fca` |
| C1 | c9 | #43 | merged `7e4ff0c` |
| C2 | c11 | #25 | merged `3c73ebb` |
| C2 | c10 | #33, follow-up #46 | merged `a8483e3`, `38be0c8` |
| C3 | c12 | #37 | landed `cb54302` |
| C3 | c13 | #44 | merged `59dca10` |
| C3 | c14 | #55 | merged `4e29f0a` |
| C3 | c15 | #61 | landed `6275b08` |
| C3 | c16 | #62 | merged `3b5b726` |
| C4 | c17 | #65 | merged `d8852a5` |
| C4 | c18 | #66 | landed `b647ca3` |
| C4 | c21 | #67 | merged `e658962` |
| C4 | c22 | #68 | merged `05e741d` |
| C4 | wire (fallback + `printed_lines` into the worker) | #69 | merged `c0124f0` |
| C4 | c19 | #72 (closed) → in #73 | merged `a907991` |
| C4 | c20 | #73 | merged `14f9b6d` |
| BU1–BU3, CU1–CU2 | client | — | not started (prompts §6, needs `docs/design/handoff/03b/`) |

**Spec PRs into `module-03b`:** #42 `a667723` (03b v1.0.3, 03c v1.0.3, 02b v1.0.7, 03a v1.2.2, 01d v1.2.3, 01a v2.4.3), #45 `f8fea2b` (03c v1.0.4), #48 `6679c01` (03b v1.0.4, 03a v1.2.3, 02b v1.0.8), #53 `b4bbb2e` (02b v1.0.9), #70 `b261e87` (03b v1.0.5, 03c v1.0.5, 01d v1.2.4). **Into `main`:** #1 `f1a46b9` (specs v1.0, plans, CI), #2 `45828a7` (gap sweep), #18 `1fd76a3` (03b-N1 note).

## Readings and rulings (AD rows)

**Final status at close (2026-11-12):** AD-1, 2, 4, 11, 12 proposed and never ruled (built as read; in the PR to main for the owner); AD-16 owner informed; every other row accepted, ruled or done as shown, and each ruled code task is merged (tests in "Owner rulings → tests").

| # | Task | Reading | State |
|---|---|---|---|
| AD-1 | P0.1 | The new scratch-db tests sit in `apps/cloud/test/helpers/scratch-db.int.test.ts` (the helper's own test file, not in the row). | final: **accepted (owner 2026-11-12)** — built as read (P0.1 #3); listed for the owner in the PR to main |
| AD-2 | P0.1 | G-12 "log, ignore 57P01": every scratch / admin pool error is logged by code only and never rethrown. | final: **accepted (owner 2026-11-12)** — built as read (P0.1 #3); listed for the owner |
| AD-3 | P0.2 | Tests that pin AlertRaised's latest version / the fixture count follow the row (G-9 class): `packages/events/src/alerts.test.ts`, `fixtures.test.ts` (38 → 39), `apps/hub/test/engine/kinds.int.test.ts:339` (2 → 3). | accepted (owner 2026-11-11) |
| AD-4 | P0.2 | The four new detail fields are `max(40)` only, no `min(1)`. | final: **accepted (owner 2026-11-12)** — built as read (P0.2 #4); listed for the owner |
| AD-5 | P0.2 | `alerts/raise.ts` keeps its `AlertRaisedPayloadV2` type (plan: no hub change). | **rejected → retyped** (owner 2026-11-11): `raise.ts`, `projections/alerts.ts` use `AlertRaisedPayloadV3` (P0.F, no behaviour change) |
| AD-7 | P0.4 | **STOP (ruled):** B-2 puts three keys on `BranchEngineSettings`, which the owner page `KitchenTiming.tsx` types from; (a) add the three boxes, (b) wire keys now + exclude them in the client type (rec), (c) wait. | **ruled (a)** (owner 2026-11-11): built fully in P0.15 |
| AD-8 | P0.4 | Tests pinning engine_settings exactly follow A-1 (G-9 class): `config.test.ts`, cloud `builder*.int.test.ts`, `zones-migration.int.test.ts` (180 000 after the whole folder). | accepted (owner 2026-11-11) |
| AD-9 | P0.4 | `HUB_ENGINE_SETTING_DEFAULTS` in `@pos/events` `config.ts`; 0012 bumps no `config_version` (0007 / 0009 precedent). | **changed** (owner 2026-11-11): 0012 bumps `config_version` for every branch with a settings row (P0.F); `HUB_ENGINE_SETTING_DEFAULTS` in `@pos/events` accepted |
| AD-10 | P0.5 | `ConnectedSession` fakes in 01d tests gain `stationId` (required field). | accepted (owner 2026-11-11) |
| AD-11 | P0.7 | `Doc` block value types: `size 1 \| 2`, `align left \| center \| right`, `{ rule / cut / drawer: true }`, `{ feed: number }`; union exported as `DocBlock`. | final: **accepted (owner 2026-11-12)** — built as read (P0.7 #9); listed for the owner |
| AD-12 | P0.8 | Event value rules taken from the cited sections (Handover 1–40, sound 0–100, lane_label 1–20, printer name 1–40, paper 58 \| 80); `KdsStationBody.lanes.lanes_on` nullable (custom). | final: **accepted (owner 2026-11-12)** — built as read (P0.8 #10); listed for the owner |
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
| AD-34 | c15 #61 (C3-2) | Suspect recovery: which kind when a ticket has both kitchen / reprint and slip suspects? | **ruled (Rec)** (owner 2026-11-12 07:39, "sab Rec"): any suspect kitchen / reprint → one `reprint` of the ticket, plus its FIRST slip again if that slip is also suspect; slips only → the latest slip again (as built) (03c v1.0.5 §3.5) |
| AD-35 | c15 #61 (C3-3) | `printer_problem { problem: 'ticket_not_built' }`: auto-close and dedupe? | **ruled (Rec)** (owner 2026-11-12 07:39, "sab Rec"): never auto-closed (not at the next ack, not obsolete), only a manager closes it; always its own alert, never absorbed into another open `printer_problem` (03c v1.0.5 §3.7) |
| AD-36 | P0.17 (B2-3) | An undone `auto_done` line holds its station until a tapped Done. | **ruled (Rec)** (owner 2026-11-12 07:39, "sab Rec"): accepted as built (03a v1.2.2); the KDS line view carries `done_undone: true` for a "tap Done" cue (03b v1.0.5 §3.3, §6.14); code P0.21, client text later |
| AD-37 | P0.18 (P18-1) | `always_on` and tablets of an archived point. | **ruled (Rec)** (owner 2026-11-12 07:39, "sab Rec"): point-bound tablets join `always_on` only when the point is active in `branchConfig().points` (01d v1.2.4); code P0.21 |
| AD-38 | c17 #65 (C4-1) | Repeated COMING UP slips on a flapping screen. | **ruled (Rec)** (owner 2026-11-12 07:39, "sab Rec"): at most one COMING UP per station per 5 min; a new outage within 5 min of the last prints none (03c v1.0.5 §3.4 step 2) |
| AD-39 | P0.18 (review LOW) | 01d §6.5 Errors row lacked `404 POINT_NOT_FOUND`. | done: 01d v1.2.4 |
| AD-40 | design brief §7 (Q-14) | 03c C3-3 says only a manager closes a `ticket_not_built` alert, but no close command existed. | **ruled (Rec)** (owner 2026-11-12 11:00, "teeno Rec"): new `DismissPrintSkip { alert_id }`, permission `force-release-table-lock` (01d's `managers` set), `AlertClosed` reason `done`, 404 for any other alert / problem, 409 `ALERT_ALREADY_CLOSED` (03c v1.0.6 §6.12); code P0.22 |
| AD-41 | design brief §7 (Q-18) | An archived station's output row still holds a printer, so the printer cannot be archived. | **ruled (Rec)** (owner 2026-11-12 11:00, "teeno Rec"): a config apply that archives / removes a station appends `StationOutputSet { mode: 'screen', printer_id: null, source: 'config' }` in the same apply; pending jobs follow the no-printer rule; `SavePrinter` archive then succeeds (03c v1.0.6 §3.2); code P0.22 |
| AD-42 | design brief §7 (Q-20) | The KDS cannot know whether its station prints, so it cannot decide to show Reprint. | **ruled (Rec)** (owner 2026-11-12 11:00, "teeno Rec"): `kds_station.has_printer` (03b v1.0.6 §6.14, statements 4) from 03c `stationHasPrinter`, `station_notice { kind: 'output' }` on change; code P0.22 |
| AD-43 | P0.22 #84 (Q-P22b) | The `output` station_notice went only to the station's own sockets; a Pass tablet holding the station's takeover kept a stale `has_printer`. | **ruled (a)** (owner 2026-11-12, "sab rec", PR #84 review): the notice also goes to the point's Pass tablets that hold that station's takeover view, exactly like the `archived` notice; the Pass updates the takeover's `has_printer` (03c v1.0.7 §3.8, 03b v1.0.7 §3.10, §6.15); code P0.23 |
| AD-44 | P0.22 #84 (Q-P22a) | `DismissPrintSkip` "marks its `print_fold_skips` row resolved" — the row has no dismissed column. | **ruled (a)** (owner 2026-11-12, "sab rec", PR #84 review): no spec change; the step is satisfied by the existing `alerted_at` (alerted = resolved). After the pilot: `docs/OPEN-QUESTIONS.md` §7 **03b-N3** (`dismissed_at` column, dismissed vs undismissed skips in `print-config`) |
| AD-45 | P0.22 #84 (Q-P22) | P0.22 edited `apps/hub/src/ws/point-catch-up.ts`, outside its row. | **ruled (a)** (owner 2026-11-12, "sab rec", PR #84 review): accepted (P0.21 precedent) |
| AD-46 | design handoff PR #93 (M-3, brief Q-3) | Lane Off / On while lanes show "Custom capacity": which `lanes_on` to send, and when Lane Off is shown, was not written down. | **ruled (a)** (owner 2026-11-12, "M sab rec"): Lane Off → `lane_count − 1`, Lane On → `lane_count`; Lane Off hidden when `lane_count = 1` or `lanes_on = 1`. Client behaviour within 03b v1.0.7 §3.7 `SetLaneState`; no spec bump; brief §7 Q-3 Decided; built in client BU1/BU2 |

## Acceptance map (Z1)

Made on `module-03b` @ `14f9b6d`. "Green" = the test is in the gate, which passed on every merged PR. Titles are shortened; the full title is in the file.

### Story acceptance criteria → tests

| Story AC | Hub test(s) (spec §10 number or file) | Client | State |
|---|---|---|---|
| E3-KDS AC1 station view by URL; "all stations" = assembler view per point (S-1) | 03b #65 (`kds-catch-up`, `point-catch-up`), #29, #44 | #70, #74 | hub green; client **GAP G1** |
| E3-KDS AC2 order = 03a contract (Now / Next / Later) | 03b #65 (Now matches `stationView` after removals, voids, move to stock) | #70, #71 | hub green; client **GAP G1** |
| E3-KDS AC3 ticket shows item, modifiers, notes, table / type, times | `kds/details.int.test.ts` (identifier, options B3-2, notes, `return_of`), 03b #65, #66 | #70 | hub green; client **GAP G1** |
| E3-KDS AC4 Start / Done one tap, inline confirm only | 03b #1, #5, #6 | #70 | hub green; client **GAP G1** |
| E3-KDS AC5 volume per station on the hub admin | 03b #50 (`SetStationScreen`), #51 (`kds-config`) | sound test | hub green; client **GAP G2** |
| E3-KDS AC6 late colouring (slip warning is 03a's) | — (client rule) | #71 | **GAP G1** |
| E3-KDS AC7 boosted marker | `mark` comes from 03a `stationPlan` (03a module tests) | #70 | client **GAP G1** |
| E3-KDS AC8 batch station view | 03b #3 (the load is one unit, AD-22) | #70 | hub green; client **GAP G1** |
| E3-KDS AC9 completion modes | 03b #2 (`single_tap` → cooking), #5 (`two_tap`), #6 (from-stock / `auto_done`), B2-2 (`kds/undo-more.int.test.ts`), B2-3 (`kds/kds-catch-up.int.test.ts` `done_undone`) | — | green |
| E3-KDS AC10 HOLD AT PASS hint | readiness in `point_view` (03b #65, `kds/point-catch-up.int.test.ts`) | #74 | hub green; client **GAP G1** |
| E3-KDS edges: Done before Start, auto-done, single-tap, two taps, undo, archived station | 03b #5, #6, #2, #10, #7, #52 | — | green |
| E3-KDS edge: multiple cooks logged per cook | — | — | **GAP G6** (superseded by 00 M30) |
| E3-KDS edge / E0-HW AC4 / E3-PRT AC2: screen offline → paper | 03c #40, #41, #42; C4-1 (`print/fallback.int.test.ts`, one COMING UP per 5 min) | — | green |
| E5 dark screen (R-3 Pass takeover) | 03b #40, #41, #42, #43, #44 | #74 | hub green; client **GAP G1** |
| E3-PRT AC1 / E0-HW AC1 per-station output screen / printer / both | 03c #2, #51 | — | green |
| E3-PRT AC3 / E0-HW AC5 / D24 persistent queue, in order after restart, REPRINT header | 03c #20, #22, #24 (`print/boot.int.test.ts`, `print/worker.int.test.ts`), #30 | — | green |
| E3-PRT AC4 / E0-ORD AC4 reprint by permission, logged (`TicketReprinted`) | 03c #9 (`print/reprint.int.test.ts`); 03b #60 (Cook `reprint-ticket`) | Reprint button (CU) | hub green; client **GAP G4** |
| E3-PRT edge: paper out → stays queued, prints later, manager alert | 03c #21 (`print/status.int.test.ts`, `not_printing` at 30 s), #25, #26 | — | green |
| E3-PRT edge: Done cancels an unsent print | 03c #6 | — | green |
| E3-PRT edge: Done after print → strikethrough reprint | — | — | **GAP G5** (not in spec) |
| E0-ORD AC2 notes verbatim on the kitchen ticket | 03c #1 (kitchen note, order note wrapped) | — | green |
| E0-ORD edge: reprint while the printer is offline → queued | 03c #9 + #21 (retry, no limit), #23 | — | green |
| E0-TPL AC2 kitchen ticket (fixed layout, G1-14; toggles `show_taker`, `show_order_id`) | 03c #1; `print/render.int.test.ts` "… station toggles"; 03c #51 | — | green |
| 02b O14 estimate input (`handoversDue`) | 03b #27; 0e served-estimate tests (PRs #60, #63) | — | green |
| 02b To 03b ticket rows (token + date, parking, notes, no COMP / zone-served, CANCELLED delta, RETURN) | 03c #1, #3, #4 | — | green |

### 03b §10 tests → green tests

| # | File(s) | Test title(s) |
|---|---|---|
| 1 | `hub/test/kds/start-done.int.test.ts` | “a station session starts a fired line of its own station: ItemStarted { source: tap }, actor_id null, KDS dev…” |
| 2 | `hub/test/kds/start-done.int.test.ts` | “unfired → added; single_tap → cooking; exited order → out_of_engine; unknown → ORDER_NOT_FOUND { order_id: nu…” |
| 3 | `hub/test/kds/start-done.int.test.ts`, `hub/test/kds/undo-more.int.test.ts` | “batch: Start and Done on one member act on the whole load”<br>“batch: Undo acts on every done line of the load inside the window” |
| 4 | `hub/test/kds/start-done.int.test.ts` | “a late Start → ReservationsShifted (lateStartShift, same batch); a from-stock Start → StockConsumed”<br>“batch late Start: one ReservationsShifted = lateStartShift on the state with every member started; rebuild =…” |
| 5 | `hub/test/kds/start-done.int.test.ts` | “two_tap Done before Start → ITEM_WRONG_STAGE added; under 50 % → ITEM_DONE_CONFIRM_REQUIRED, nothing written;…”<br>“at exactly 50 % of the cook time Done needs no confirm” |
| 6 | `hub/test/kds/start-done.int.test.ts` | “from-stock line: Done with no Start succeeds, consumes, no 50 % check; auto_done: Done from fired added” |
| 7 | `hub/test/kds/undo-more.int.test.ts` | “30 000 ms after done_at → undone (ItemDoneUndone, back to cooking); 30 001 → ITEM_UNDO_WINDOW_CLOSED, nothing…”<br>“an inferred Done is undoable only within 30 s of its done_at (not of its append)” (+1) |
| 8 | `hub/test/pass/undo-ready.int.test.ts` | “→ ReadyToServeUndone + alert closed undone, station envelope; result ready_undone; §6.3 2 statements” |
| 9 | `hub/test/kds/undo-more.int.test.ts` | “pulls: FireDispatched { reason: pulled } = pullEarly; nothing to pull → { pulled: null }, no event”<br>“single_tap: the pull carries the inferred ItemStarted; a run-pass staff session pulls for any station” (+2) |
| 10 | `hub/test/kds/start-done.int.test.ts` | “two Done taps → the second is ITEM_WRONG_STAGE { stage: done }; other station → PERMISSION_DENIED; unknown →…” |
| 11 | `hub/test/kds/lane-state.int.test.ts` | “2 → 1 of 2: StationCapacitySet { lane_off, capacityForLanes } then LanesSet (order asserted); same value → no…”<br>“3 of 2 and 0 → 400 VALIDATION_FAILED; nothing written” (+2) |
| 12 | `hub/test/kds/config-projection.int.test.ts`, `hub/test/kds/lane-state.int.test.ts` | “laneCount: labelled, unrevoked kds devices of the station (1 statement); none → 1”<br>“lane_count from labelled, unrevoked kds devices; none → 1 (1 of 1 is all on: no-op; 2 → 400)” |
| 13 | `hub/test/kds/config-projection.int.test.ts`, `hub/test/kds/lane-state.int.test.ts` | “StationCapacitySet then LanesSet in one commit: LanesSet stores lanes_on exactly (clamped tie k = 1 / k = 2)”<br>“a KDS calling SetStationCapacity { lane_off } directly: tie → smallest k; { lane_on } tie → largest k” (+5) |
| 20 | `hub/test/pass/ready.int.test.ts` | “dine-in → table_team direct on the current primary table, window_ms from settings; the alert row and the card…”<br>“all-digit table name → table_code and identifier "T4"; default window_ms 60 000” |
| 21 | `hub/test/pass/ready.int.test.ts` | “takeaway → person placed_by; the card shows the token "#1"; 3 statements (no currentTableOf)” |
| 22 | `hub/test/pass/ticks.int.test.ts` | “TableMoved → old alert obsolete, a new open alert on the new table; move back → a third, open alert; 2 + 2 st…”<br>“a merge moving 3 Readies uses one closeMany + one raiseMany; one ReadyRetargeted per Ready” |
| 23 | `hub/test/pass/ready.int.test.ts` | “a Handover since the Ready of a line added after it (not one of its own lines) → PASS_UNDO_WINDOW_CLOSED”<br>“≤ 30 s → ReadyToServeUndone + alert closed undone; 2 statements; the Ready is gone” (+1) |
| 24 | `hub/test/pass/handover.int.test.ts` | “without a Ready → ReadyToServe { alert_id: null } + Handover (hub-minted id) + served_card to the receiver; 4…”<br>“a partial hand-over keeps the Ready open; the last one closes it done (ready_alert_closed); a served line cou…” |
| 24a | `hub/test/pass/handover.int.test.ts` | “45 done lines, no list → 40 handed (line order) + remaining 5, the event validates; second call → 5, remainin…” |
| 25 | `hub/test/orders/order-covered.int.test.ts`, `hub/test/pass/handover.int.test.ts` | “orderCovered checks the scope only: a requires_approval resolution is covered, so callers check grant first”<br>“per scope (branch, own_tables, my_floors) × order type (dine-in, takeaway, parking): Handover accepts iff che…” (+1) |
| 26 | `hub/test/pass/ticks.int.test.ts` | “Ready → the waiter's own MarkServed (no Handover) → closed done before step 1; 2 + 2 statements”<br>“Ready → a new round at the same point → MarkServed of the ready lines → closed done (new lines do not hold it)” (+2) |
| 27 | `hub/test/pass/handovers-due.int.test.ts`, `hub/test/pass/ticks.int.test.ts` | “only hand-overs with unsettled lines handed at or before the cut-off, with only their unsettled ids; 2 statem…”<br>“a Served card expired at day close does not stop the estimate: its unsettled lines stay due” (+1) |
| 28 | `hub/test/pass/handover.int.test.ts`, `hub/test/pass/ready.int.test.ts` | “a station session calling Handover → PERMISSION_DENIED { session_kind: station }”<br>“a station session calling MarkReadyToServe / UndoReadyToServe → PERMISSION_DENIED { session_kind: station };…” |
| 29 | `hub/test/kds/point-catch-up.int.test.ts` | “point membership: a line whose station moved to another point stays on its home point (EngineLine.point_id)” |
| 30 | `hub/test/pass/pass-projection.int.test.ts` | “hand over → serve → 02b remake return: the return command succeeds, open_lines stays 0”<br>“hand over → serve → void: no change the second time, open_lines stays 0” (+4) |
| 40 | `hub/test/kds/presence.int.test.ts` | “screen closed with lines in Now: nothing before kds_offline_ms, then kds_offline to managers once and, after…”<br>“an intents failure (the pass rolls back) sends no takeover frame and leaves the station out of the set” |
| 41 | `hub/test/kds/presence.int.test.ts` | “screen reconnects → takeover ends at once (no write); the alert closes done after 60 s connected; blips while…” |
| 42 | `hub/test/kds/presence.int.test.ts` | “a dark station whose last kds device is revoked → takeover ends, the alert closes obsolete (next tick, throug…”<br>“an idle screen station never goes dark; a dark station whose lines all go ends its takeover and keeps its ale…” (+1) |
| 43 | `hub/test/kds/presence.int.test.ts` | “the grace starts at the first kds_presence pass: lines older than it do not make the station dark at once; a…” |
| 44 | `hub/test/kds/presence.int.test.ts` | “stationPresence() matches the tick view (screen / screenless, connected, offline_since, dark)” |
| 50 | `hub/test/kds/admin-commands.int.test.ts`, `hub/test/kds/device-roles.int.test.ts` | “SetStationScreen: StationScreenSet { station_id, sound_volume }, kds_config row; 0 handler statements”<br>“both commands via /admin/commands/ only: the device route → ROUTE_NOT_FOUND” (+5) |
| 51 | `hub/test/kds/kds-config.int.test.ts` | “stations with screens (connected / signed_out / offline), lanes and sound volume; Pass tablets incl. a signed…” |
| 52 | `hub/test/kds/kds-config.int.test.ts` | “archived with open lines: station_notice to its sockets and its Pass; lines still render; the warning clears…”<br>“no notice without open lines; the hook never throws on an odd config” |
| 53 | `hub/test/kds/kinds.int.test.ts` | “ready_to_serve, served_card, kds_offline, printer_problem are registered as specced”<br>“a booted hub raises each kind; the details survive the append (AlertRaised v3) and the projection” |
| 60 | `apps/cloud/test/cli/seed-tenant.int.test.ts`, `apps/cloud/test/default-roles.test.ts`, `hub/test/auth/run-pass-default.int.test.ts` | “seed creates the roles; password and PIN hashes verify; the owner staff holds access-hub-admin and manage-dev…”<br>“run-pass defaults to Owner, Manager and Cook; Cook also gets reprint-ticket; both allowed at branch scope” (+2) |
| 65 | `hub/test/kds/kds-catch-up.int.test.ts`, `hub/test/kds/point-catch-up.int.test.ts` | “a station socket gets its own station body (Now with details and stage, Next details, defaults); a staff sock…”<br>“≤ 3 statements with 50 lines; Now matches stationView after removals, voids and a move to stock” (+3) |
| 66 | `hub/test/kds/kds-catch-up.int.test.ts` | “kds_lines once per new id per socket; 2 statements per commit that adds lines, 0 otherwise; only its station”<br>“a reconnect on the same session token: the new socket gets every line it shows, from its catch-up or a later…” (+1) |
| 70 | **GAP** — client test, not built (BU1–BU3 lanes, `03b-03c-prompts.md` §6) | station view order rules, `moved` tag, placeholders |
| 71 | **GAP** — client test, not built (BU1–BU3 lanes, `03b-03c-prompts.md` §6) | late colouring with a skewed clock (hub_time) |
| 72 | **GAP** — client test, not built (BU1–BU3 lanes, `03b-03c-prompts.md` §6) | offline banner disables taps; `done` loser shows no error |
| 73 | **GAP** — client test, not built (BU1–BU3 lanes, `03b-03c-prompts.md` §6) | coming-up strip |
| 74 | **GAP** — client test, not built (BU1–BU3 lanes, `03b-03c-prompts.md` §6) | Pass readiness, HOLD hint, takeover section |
| 75 | **GAP** — client test, not built (BU1–BU3 lanes, `03b-03c-prompts.md` §6) | config refetch on `BranchConfigApplied` |

### 03c §10 tests → green tests

| # | File(s) | Test title(s) |
|---|---|---|
| 1 | `hub/test/print/render.int.test.ts` | “dine-in: item, option child, kitchen note, deal parts; child at another station on its own ticket; exact ESC/…”<br>“takeaway token with its earlier date, order note (wrapped at 32), kitchen note mapping of — × −” (+2) |
| 2 | `hub/test/print/tickets-projection.int.test.ts` | “one fire, two orders → two tickets; output both → two kitchen jobs (live, station-routed)”<br>“the jobs are written in the fire's own transaction: a rolled-back fire leaves no ticket and no job” (+1) |
| 3 | `hub/test/print/slips.int.test.ts` | “partial removal of a printed line → cancel { units }; whole removal → units null; job station-routed, live”<br>“removal of an unprinted line (job not yet sent, or no printer at all) → no slip” |
| 4 | `hub/test/print/slips.int.test.ts` | “void of a printed, not-done line → CANCELLED with its units; a done (or served) line → nothing” |
| 5 | `hub/test/print/slips.int.test.ts` | “boost on a printed ticket at a printer station → FIRST with its not-done lines; both / screen → none”<br>“ItemsReleased { expedite } → FIRST for the expedited printed lines only; an unprinted ticket → none; a pull n…” |
| 6 | `hub/test/print/fallback.int.test.ts`, `hub/test/print/slips.int.test.ts`, `hub/test/print/worker.int.test.ts` | “Done before send → empty cancel; held (no row per loop) until UndoDone → ticket_id:kitchen:2, once”<br>“after a cancelled kitchen job a new one takes ticket_id:kitchen:2, then :3; never two live kitchen jobs” (+2) |
| 7 | `hub/test/print/tickets-projection.int.test.ts` | “500 historical fires, no checkpoint → catch-up folds every ticket and writes 0 jobs; same for a restored tail” |
| 8 | `hub/test/print/status.int.test.ts`, `hub/test/print/tickets-projection.int.test.ts` | “an unalerted fold skip of a both station → ticket_not_built at once (once); a screen station that is not dark…”<br>“a fire id missing from order_lines at a both station → the fire commits, no ticket, a print_fold_skips row, p…” (+2) |
| 9 | `hub/test/print/render.int.test.ts`, `hub/test/print/reprint.int.test.ts` | “a reprint of an order no longer in the engine prints its plain options from order_lines.options_json”<br>“a KDS reprints its own station: by order → only its station's tickets; another station's ticket → 403” (+2) |
| 9b | `hub/test/print/worker.int.test.ts` | “render vs removal: a removal committed after the render sees the ticket printed and queues the CANCELLED slip” |
| 10 | `hub/test/kds/wiring.int.test.ts`, `hub/test/print/tickets-projection.int.test.ts` | “test hub: kds then print projections register right after 02b orders”<br>“boot order: 02b orders → 03b kds → 03c print_config, kitchen_tickets (last)” |
| 20 | `hub/test/print/lan-transport.int.test.ts`, `hub/test/print/worker.int.test.ts` | “written and flushed → ok; the printer got every byte; the socket is closed afterwards”<br>“a printer that talks back on connect and reads late still gets the whole document (no RST truncation)” (+1) |
| 21 | `hub/test/print/fixtures.int.test.ts`, `hub/test/print/lan-transport.int.test.ts`, `hub/test/print/status.int.test.ts` | “stall: a large write does not drain; resume lets it through”<br>“slowRead(1): one byte per tick” (+3) |
| 22 | `hub/test/print/fixtures.int.test.ts`, `hub/test/print/usb-transport.int.test.ts` | “opening the device for write blocks until it is drained; drain returns the bytes”<br>“a device that blocks: a PIN login resolves meanwhile; the child is killed at the injected timeout and respawn…” |
| 23 | `hub/test/print/worker.int.test.ts` | “two printers: one down never delays the other” |
| 24 | `hub/test/print/boot.int.test.ts`, `hub/test/print/worker.int.test.ts` | “sent-not-acked → is_reprint = 1, sent_at NULL; acked / cancelled / unsent rows untouched; 1 statement”<br>“a hub that stopped mid-print boots, re-sends the job once with REPRINT through the worker it started after li…” (+1) |
| 25 | `hub/test/print/status.int.test.ts` | “clean read → 3 jobs acked → paper-end read → all 3 suspect (1 statement)”<br>“no clean read yet (new printer) → jobs acked → paper-end read → all suspect” (+5) |
| 26 | `hub/test/print/status.int.test.ts` | “unknown-status printer: never suspect; supports_status stays unknown” |
| 27 | `hub/test/print/routes.int.test.ts` | “bypasses a stuck head: the head job stays in flight, the test prints on its own connection; clean → supports_…”<br>“a clean test print triggers suspect recovery: one REPRINT per ticket with a live line” |
| 28 | `hub/test/print/worker.int.test.ts` | “printer back: stale cancel / first / coming_up and an empty kitchen job are cancelled, not sent” |
| 29 | `hub/test/print/config-projection.int.test.ts`, `hub/test/print/worker.int.test.ts` | “a print_config rebuild keeps printer_runtime (worker facts outside the projection)”<br>“station output changed → pending station jobs follow the new printer; a document job stays on its printer” (+1) |
| 30 | `hub/test/print/escpos.test.ts` | “every listed command has its Epson bytes”<br>“init, then per block only the state that changes; rule = width dashes; feed = LFs; cut; drawer” (+5) |
| 40 | `hub/test/print/fallback.int.test.ts`, `hub/test/print/worker-wiring.int.test.ts` | “screen + printer, 03b marks dark: Now tickets + one COMING UP; new fires print; screen back → stop, nothing c…”<br>“a new outage prints a new COMING UP; tickets already printed are not printed again” (+1) |
| 41 | `hub/test/print/fallback.int.test.ts` | “slow printer (5 s per job) during 10 s dark → one kitchen job per ticket” |
| 42 | `hub/test/print/fallback.int.test.ts` | “idle loop statements ≤ 2 + 1 per dark station (worker 1 + fallback 0 idle, 1 per dark station)” |
| 50 | `hub/test/print/config-commands.int.test.ts` | “a new LAN printer: hub id, port 9100 by default, PrinterSaved on hub / branch_id, print_config folded; edit b…”<br>“address, name and paper validation → 400 VALIDATION_FAILED, nothing written” (+4) |
| 51 | `hub/test/print/config-commands.int.test.ts` | “both / printer without a printer → 400 VALIDATION_FAILED { field: printer_id }; screen without one is fine”<br>“writes StationOutputSet on hub / branch_id; toggles default true; print_config folded; unknown / archived sta…” |
| 52 | `hub/test/print/routes.int.test.ts` | “unknown → 404 PRINT_JOB_NOT_FOUND; acked / cancelled → 409 PRINT_JOB_NOT_PENDING { state }; pending → cancell…” |
| 53 | `hub/test/print/api.int.test.ts` | “a document job in the caller's transaction: 2 statements; committed with it”<br>“rolled back with the caller's transaction: no job” |
| 54 | `hub/test/kds/kinds.int.test.ts` | “ready_to_serve, served_card, kds_offline, printer_problem are registered as specced”<br>“a booted hub raises each kind; the details survive the append (AlertRaised v3) and the projection” |

### §12.2 endpoint checklists

**03b §12.2**: every row's tests are green above. 1 `StartItem` (1–4), 2 `DoneItem` (5, 6, 10), 3 `UndoDone` (7, 8), 4 `GiveMeMore` (9), 5 `SetLaneState` (11–13), 6 `MarkReadyToServe` (20, 21), 7 `UndoReadyToServe` (23), 8 `Handover` (24, 24a, 25, 28; 5 / 4 statements, B4-3), 9 `SetStationScreen` (50), 10 `SetDeviceRole` (50), 11 `pass-receivers` (25), 12 `kds-config` (51), 13 `kds_station` + `kds_lines` (65, 66; 3 / 2 statements asserted), 14 `point_view` + `point_lines` + `station_takeover` (40, 65), 15 tick `ready_retarget` (22), 16 tick `pass_closures` (26, 27), 17 tick `kds_presence` (40–43), 18 kinds ×3 (53), 19 projections ×3 (13, 26, 50). The DoD statement counts (65, 27) are asserted in `kds-catch-up.int.test.ts`, `point-catch-up.int.test.ts` and `handovers-due.int.test.ts`. **All ticked.**

**03c §12.2**: 1 `ReprintTicket` (9), 2 `SavePrinter` (50), 3 `SetStationOutput` (51), 4 `POST /admin/print/test` (27, `print/routes.int.test.ts`; USB read-back and `busy`, C3-1: `print/usb-status.int.test.ts`), 5 job cancel (52), 6 `print-config` (50; `print/print-queries.int.test.ts` §6.6: 4 statements, every warning kind incl. `no_screen`, `lossy_name`), 7 `print-queue` (23; `print/print-queries.int.test.ts` §6.7: 2 statements), 8 `order-tickets` (9), 9 `kds_printed` + `printed_lines` (40), 10 kind `printer_problem` (54), 11 projections ×2 (2–8), 12 worker / fallback (42). **All ticked.**

### Owner rulings → tests (code tasks)

| Ruling | Test(s) |
|---|---|
| AD-18 B4-1 (pass folds 3 statements) | `pass/pass-projection.int.test.ts` (03b #30) |
| AD-19 B2-2, AD-36 B2-3 (auto_done undo; `done_undone` on the Now row) | `kds/undo-more.int.test.ts` "auto_done: the tick infers Done, UndoDone undoes it …", `packages/engine/test/lifecycle.test.ts`, `kds/kds-catch-up.int.test.ts` "an undone Done: its Now row carries done_undone true …" |
| AD-20 B3-2, AD-31 B3-3, AD-33 B3-5 (plain options; re-send on unit change; 0016 SQL backfill) | `kds/details.int.test.ts`, `orders/projection.int.test.ts`, `kds/kds-catch-up.int.test.ts`, `kds/point-catch-up.int.test.ts`, `db/order-line-options-migration.int.test.ts`, `print/render.int.test.ts` "plain options print under their line …" |
| AD-21 C1-1 (archived printer keeps `archived_at`) | `print/config-projection.int.test.ts` "archive keeps its first time …" |
| AD-22 B2-1 (Done marks the load) | 03b #3 |
| AD-23 B4-3, AD-27 B4-2 (receiver signed in; 40 per call + `remaining`) | `pass/handover.int.test.ts` "[03b B4-3] …", "[03b B4-2] 45 done lines …" |
| AD-24 B1-1, AD-25 B1-2, AD-37 P18-1 (point 404; `always_on` point tablets, active points only) | `alerts/send-test-alert.int.test.ts`, `alerts/targets.int.test.ts` |
| AD-26 P15-1 (seconds on the owner page) | `apps/client/src/features/owner/branches/BranchSettings.test.tsx` "[03b §4.5 A-2] …" |
| AD-28 C1-2 (whole-form CANCELLED) | `print/render.int.test.ts` "… whole form (C1-2) …" |
| AD-29 C1-3 (render test asserts c7's ticket) | `print/render.int.test.ts` (no manual ticket inserts) |
| AD-30 C3-1 (USB status read-back) | `print/usb-status.int.test.ts`, `print/routes.int.test.ts` |
| AD-32 B3-4 (return line copies options) | `orders/return-to-kitchen.int.test.ts`, `packages/engine/test/returns.test.ts` |
| AD-34 C3-2, AD-35 C3-3 (recovery kind per ticket; `ticket_not_built` never auto-closed) | `print/status.int.test.ts` |
| AD-38 C4-1 (one COMING UP per 5 min) | `print/fallback.int.test.ts` |
| AD-9 (0012 bumps `config_version`) | `apps/cloud/test/db/kds-settings-migration.int.test.ts` |

## Gate times (CI, for the record)

| Date | Branch / PR | Wall | Tests |
|---|---|---|---|
