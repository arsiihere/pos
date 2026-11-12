# 04 Voids + Audit — build board

Plan: `04-plan.md`. Gaps: `04-gaps.md` (ruled). Spec: `04_Voids_Audit_Spec_v1.0.3.md` (v1.0.1 landed in P0.2; v1.0.2 adds the Q-12 and Q-13 known gaps; v1.0.3 adds the rulings Q-14, Q-15, Q-16 and Q-17 and gap AD-14, PR #137). Integration branch: `module-04`. Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-13: every hub task is merged (phase 0, u1–u11, v3–v9, v6b, a1–a3, t1, t2, p1, UA). 36/42 done. Z1 acceptance map is in this PR. Baqi: VU1 and VU2 (wait on `docs/design/handoff/04/`), Z2 (owner, tablet; `04-manual-checks.md`), Z3 / Z3a. Hub tests `test/voids` + `test/audit`: 17 files, 215 green. One §10 half has no test (MISSING, see the map).
> - 2026-11-12 19:30: usage limit 16:40–19:30 PKT; lanes resumed. Saare upstream U (u1–u9) merged; a1 merged. V1 lane chal rahi (v5 #124 approved, v3 next). 20/37 done.
> - 2026-11-12 15:45: P0.9 spike GREEN (#102) → phase 0 complete. Lanes U1–U4, A1 khul gayi.
> - 2026-11-12: P0.2–P0.6 merged (#92, #94, #95, #96, #97); owner 'Dono rec' (15:05) — Q-12, Q-13 known gaps, 04 v1.0.2.
> - 2026-11-12: P0.1 — `module-04` cut from `main` @ ``3dee1b9``, labels `lane:U1–U4`, `lane:V1–V2`, `lane:A1`, `lane:T1` (`needs-ruling` already there), ye board.
> - 2026-11-12: gap sweep done (PR #89), 23 G-rows, owner "Your calls" (13:17) → har row Rec; plan patched.
> - 2026-11-12: spec 04 v1.0 APPROVED (11:58), plan ready.

## Owner rulings on how the build runs

Same as 03b (W-1–W-6, `03b-status.md`), for `module-04`:

| # | Ruling |
|---|---|
| W-1 | `module-04`: PR required, check `gate` required, rebase merge only, no force push. |
| W-2 | The integrator merges green, reviewed PRs into `module-04`. Stacked: top PR merged, the lower ones closed with a comment. |
| W-3 | The integrator merges green docs / spec PRs (incl. into `main`, e.g. the gap sweep). `module-04` → `main` is the owner's (merge commit); the integrator opens the PR. |
| W-4 | Lanes are background agents from the integrator session, ≤ 5–6 at once. |
| W-5 | Repo public: never commit a secret. |
| W-6 | HIGH tasks get two fresh reviewers (one on money, K-1 `alert_id`, races, statement counts). Fix rounds > 2 → STOP. |

## Owner rulings on the spec during the build

| # | Ruling | When | Where it landed |
|---|---|---|---|
| G-1 – G-23 | Gap sweep: every G-row takes its Rec ("Your calls") | 2026-11-12 13:17 PKT | `04-gaps.md`; plan patched; spec text in P0.2 (04 v1.0.1) |
| Q-12 | Rec: accept the gap. B-1 / backfill `0013` name Manager as the void approver without checking that Manager holds `approve-void` ("Dono rec") | 2026-11-12 15:05 PKT | 04 v1.0.2 §12.6; AD-5 |
| Q-13 | Rec: keep the station-less non-deal line rules as defensive rules, tested on a synthetic `ItemAdded { station_id: null }` ("Dono rec") | 2026-11-12 15:05 PKT | 04 v1.0.2 §12.6; AD-6 |
| Q-14 | (b): new column `order_lines.station_id`; the planner reads it in place of the v3 engine-state proxy ("haan") | 2026-11-12 20:21 PKT | 04 v1.0.3, 02b v1.0.12 (#137); u10 #145 |
| Q-15 | (b): a `moved` void share prints a MOVED TO STOCK slip in place of CANCELLED ("haan") | 2026-11-12 20:21 PKT | 04 v1.0.3, 03c v1.0.8 (#137); p1 #142 |
| Q-16 | A deal header's `details.lines` state = its most advanced part (`served > cooked > cooking > not_started`) ("haan") | 2026-11-12 20:21 PKT | 04 v1.0.3 §3.5 (#137); v6b #141 |
| Q-17 | English now. The slip prints `MOVED TO STOCK - FINISH & KEEP`. Multi-language slips are a future 03c feature (03c §12.7 F-1) ("filhal tw english mai") | 2026-11-12 20:42 PKT | 04 v1.0.3 §12.6; p1 #142; AD-24 |
| Q-19 | (b): a null-`option_quantity` option child cascades only with the last parent unit (`option_quantity` column + migration 0020) | 2026-11-12 21:03 PKT | 02b v1.0.13 (#143); u11 #146; AD-23 |

## Phase 0

| Task | PR | State |
|---|---|---|
| P0.0 | #89 | merged `3dee1b9` (into `main`, W-3) |
| P0.1 | #91 | merged `5c50a80` (`module-04` cut `3dee1b9`, labels, board; #90 closed, AD-4) |
| P0.2 | #92 | merged `066cd7c` |
| P0.3 | #94 | merged `9418a70` |
| P0.4 | #95 | merged `21990d8` |
| P0.5 | #97 | merged `0d5f1cb` |
| P0.6 | #96 | merged `d45db7a` |
| P0.7 | #99 | merged `ee4d675` |
| P0.8 | #100 | merged `f499a33` |
| P0.9 | #102 | merged `01074ce`, GATE green |
| docs | #101 | merged `f354627` (04 v1.0.2, Q-12 / Q-13) |
| board | #128 | merged `29c1ac3` |

## Upstream lanes (Cross)

| Lane | Task | Needs | PR | State |
|---|---|---|---|---|
| U1 | u1 | — | #104 | merged `3affdce` |
| U1 | u2 | — | #108 | merged `c1f5a40` |
| U1 | u3 | u1 | #114 | merged `7e41019` |
| U1 | u10 | v3 | #145 | merged `5ddb535` (Q-14) |
| U2 | u4 | — | #109 | merged `7c08aa6` |
| U2 | u5 | — | #117 | merged `cf19e98` |
| U3 | u6 | P0.6 | #105 | merged `ae69507` |
| U3 | u7 | — | #110 | merged `1302992` |
| U3 | u8 | P0.3 | #112 | merged `c78bc46` |
| U4 | u9 | P0.6 | #107 | merged `60035d5` |
| U5 | u11 | #138, #143 | #146 | merged `bcec150` (Q-19) |

## 04 lanes

| Lane | Task | Needs | PR | State |
|---|---|---|---|---|
| V1 | v3 | u1, u2, u4 | #130 → #136 | merged `d066d3f` (stack #130/#131/#132 merged through #136, W-2) |
| V1 | v4 | v3 | #131 → #136 | merged `9045583` (stack) |
| V1 | v5 | u1 | #124 | merged `419ead7` |
| V1 | v6 | v4, v5, P0.4 | #132 → #136 | merged `374a7ed` (stack) |
| V1 | v7 | v6, u2, u7 | #136 | merged `c521624` |
| V1 | v6b | v6 | #141 | merged `99bb11e` (Q-16) |
| V2 | v8 | v6, u3, u8 | #139 → #144 | merged `8bc7245` (#139 closed into #144) |
| V2 | v9 | v8 | #144 | merged `13ceef3` |
| A1 | a1 | P0.3 | #106 | merged `489beb1` |
| A1 | a2 | a1, P0.5, P0.6 | #111 | merged `0660d3c` |
| A1 | a3 | a2, u6 | #134 | merged `8c4b6c4` |
| T1 | t1 | v4, v7 | #138 | merged `f5a9a5d` |
| T1 | t2 | v7, u9 | #140 | merged `3da7000` |
| P | p1 | — | #142 | merged `f8c6630` (Q-15, Q-17) |

Spec PRs during the build: #137 merged `b632a2d` (04 v1.0.3, 02b v1.0.12, 03c v1.0.8: Q-14, Q-15, Q-16); #143 merged `40e63a3` (02b v1.0.13: Q-19).

## Client

| Lane | PR | State |
|---|---|---|
| UA | #135 | merged `2fc9c47` |
| VU1 | — | BLOCKED: `docs/design/handoff/04/` does not exist yet |
| VU2 | — | BLOCKED: `docs/design/handoff/04/` does not exist yet |

## Close

| # | State |
|---|---|
| Z1 | this PR: acceptance map below |
| Z2 | not started: owner, on a tablet, needs VU1. Steps in `04-manual-checks.md`, plus `01d-manual-checks.md` rows 1b, 4, sounds and request screens with `void_approval`, and `03c-manual-checks.md` Check 10 |
| Z3 | not started: PR `module-04` → `main` (owner merges) |
| Z3a | not started: 02b v1.0.14 = main's v1.0.11 + module v1.0.12 + v1.0.13 |

## Owner — laptop / pilot list

| # | What | When |
|---|---|---|
| 1 | 04 manual check: the reject notice reaches the table holder (owner depth); an absent holder gets nothing; the holder card names no item (u7 review, AD-26). Now check 5 of `04-manual-checks.md`. | Z2, after VU1 |

## AD rows (as-built decisions)

| # | Decision | Task | Approved |
|---|---|---|---|
| AD-1 | `apps/hub/src/projections/alerts.ts:204` still casts the `AlertRaised` payload as V3 (harmless; `details_json` keeps `disposition`); retype when a row touches it. | P0.4 | accepted (integrator) |
| AD-2 | The no-op `audit` projection writes its checkpoint at MAX(seq) with empty tables until a2. Only a hub booted on `module-04` between P0.7 and a2 would miss history, and none is real, because `module-04` reaches `main` only after a2. a2 adds `reset`. | P0.7 | accepted (integrator) |
| AD-3 | Reading: the 01d test `apps/hub/test/alerts/no-approver.int.test.ts` drops `VOID_KIND` in its second half (Cross edit; reviewer: legitimate, pins what this row changes). | P0.7 | accepted (integrator) |
| AD-4 | PR #90 was closed by mistake (opened on the old 03b branch `lane-P0/board`); 04 phase-0 branches are named `lane-P0/04-…`. | P0.1 | accepted (integrator) |
| AD-5 | Q-12: Manager named void approver by B-1 / backfill `0013` without an `approve-void` check — accepted gap, 04 v1.0.2 §12.6. | P0.6 | owner ruling 2026-11-12 15:05 |
| AD-6 | Q-13: station-less non-deal line rules stay defensive, tested on a synthetic `ItemAdded { station_id: null }` — accepted gap, 04 v1.0.2 §12.6. | P0.8 | owner ruling 2026-11-12 15:05 |
| AD-7 | 02b test #44 "1 statement" is the `lineChangeDrafts` count; `changeDrafts` with `keep` reads 0 (the caller passes the lines). Wording only, for the next 02b text bump. | u2 | accepted (integrator) |
| AD-8 | `staff_names.updated_at` = the last directory apply that saw the person ("last seen"). It is rewritten even when the name is unchanged. | u6 | accepted (integrator) |
| AD-9 | NIT follow-ups: `stock.ts:501` has an O(m²) set copy per move. No regression test of the ended set on a `StockAdded`/`StockSet` reserve inside a void array (a probe passed). Behaviour change: `StockAdded`/`StockSet` in an array with a void/remove skip ended lines. Correct by T-2 and unreachable today. | u4 | accepted (integrator) |
| AD-10 | When `result_also_to` throws on the PIN path, it records `RequestPinFailed { answer_failed }` and counts the PIN. An `apply` throw refused in `preRead` records nothing. Consequence of G-7 (the hook never runs in `preRead`). | u7 | accepted (integrator) |
| AD-11 | In the `boot-idset` "snapshot older than H" case, the void probe is now trivially quiet. NITs left. | u5 | accepted (integrator) |
| AD-12 | `resetLineGuard()` / `resetDayCloseGuard()` run right after `createTestHub()` in the 02b / 01a count tests, so v8's boot registration doesn't shift them. v8 must do the same for 02a merge-guard count tests. | u3, u8 | accepted (integrator) |
| AD-13 | Flaky pre-existing test `apps/cloud/test/…/leaving-race.int.test.ts` [01b B15] failed 2 of 5 runs during u9. Not caused by 04; watch it. | u9 | accepted (integrator) |
| AD-14 | The `audit-log` `action` filter validates against the fixed `AUDIT_ACTIONS`. An action registered later (03c, 05) would get 400. Follow-up: an `auditActions()` list before 03c / 05 register; add it to the next 04 text bump. (Already in 04 v1.0.3 §12.6.) | a3 | accepted (integrator) |
| AD-15 | §10 #52's MERGE wording cannot hold for single-branch shapes. The test asserts one ordered index search and no temp sort. `to` is exclusive, `[from, to)`; write this into §6.5 at the next bump. | a3 | accepted (integrator) |
| AD-16 | Reading: the 03a set-station-capacity and set-station-pause exact statement totals are +1, because those events are now audited. | a2 | accepted (integrator) |
| AD-17 | `sealAuditActions` is a new `@pos/domain` export that §4.2 does not list (next 04 bump). `audit.fixtures.ts` is compiled into the domain build; follow-up: add `src/**/*.fixtures.ts` to the tsconfig exclude. | a2 | accepted (integrator) |
| AD-18 | The §6.1 "3 + 2" statement count excludes closing a stale comp. With one stale comp closed, the real count is 12. A test pins it; fix the text at the next 04 bump. | v4 | accepted (integrator) |
| AD-19 | The P0.8 fixture `raiseVoid` passes the required `details.lines`. V1 edited a phase-0 file; the integrator allowed it. | v6 | accepted (integrator) |
| AD-20 | The shared `movableLine` lives in `voids/plan.ts`, a V1 file. v8 touched it at the integrator's request, so `pendingVoids.blocked` and the approve check cannot diverge. v8 also made comment-only edits in `voids/contracts.ts` and `index.ts`. | v8 | accepted (integrator) |
| AD-21 | v9 edited v8's `exports.ts` (`pendingVoidsOfSeating`, same lane) to keep the by-seating path at 1 statement. `comp_pending` is filled only on the approval path (§3.2 rule 6). `pending-voids` lists only orders with an open request. | v9 | accepted (integrator) |
| AD-22 | `apply`'s `day_closed` refusal can no longer happen now that the day-close guard is live. The code stays as a defence. | v8 | accepted (integrator) |
| AD-23 | Q-19: new column `order_lines.option_quantity`, hub migration 0020 and an `orders` refold. 02b v1.0.13 adds it, because `readOrder` had no field for it. The null rule applies only to an `option_child` of an `item` parent; deal parts keep the ratio cascade. | u11 | owner ruling 2026-11-12 21:03 |
| AD-24 | The manual print check is Check 10 in `docs/plans/03c-manual-checks.md` (the file the plan row and 03c §11 task 28 name), not a new 04 file. The plan's p1 row still says "i18n en / ur"; Q-17 ruled English only (multi-language slips are a future feature, 03c §12.7 F-1). | p1 | accepted (integrator); Q-17 owner 2026-11-12 20:42 |
| AD-25 | The flaky `leaving-race.int.test.ts` [01b B15] still fails 2 of 5 runs (pre-existing, not 04; same test as AD-13). | — | accepted (integrator) |
| AD-26 | The reject notice reaches the table holder (owner depth). An absent holder gets nothing. The holder's card names no item. `display.table_code` comes from raise time. Owner checks it on a tablet (Z2, `04-manual-checks.md` check 5). | u7 | accepted (integrator) |

## Acceptance map (Z1)

Built on `module-04` @ `bcec150`. Every name below was found with `git grep "[04 #"` (and the other 04 tags) in `apps` and `packages`. Results:

| Run | Files | Tests |
|---|---|---|
| `apps/hub`: `TMPDIR=/dev/shm pnpm vitest run test/voids test/audit` | 17 | 215 passed |
| `apps/hub`: the same plus `alerts/result-also-to`, `alerts/raise`, `db/audit-migration`, `db/order-line-option-quantity-migration`, `auth/apply-directory`, `projections/registry`, `orders/comp`, `orders/exports` | 25 | 337 passed |
| `packages/domain`: `audit`, `errors`, `voids` | 3 | 50 passed |
| `packages/engine`: `stock-effects` | 1 | 39 passed, 1 todo (03a BF-9, not 04) |
| `packages/events`: `alerts`, `order-events`, `stock-events` | 3 | 77 passed |
| `apps/client`: `RoleEditor`, `admin/stock` (UA) | 6 | 67 passed |
| `apps/cloud`: `seed-tenant`, `void-defaults-backfill`, `default-roles`, `allowed-only` | — | not run in this session (no Postgres on 5433). Green in CI: `gate` on `bcec150` = success |

No 04 test is `skip`, `todo` or `fails`. (T1's `it.fails` for #42 became normal tests in u11.)

**File keys.** Hub (`apps/hub/test/`): **VI** `voids/void-items.int.test.ts`, **PL** `voids/plan.int.test.ts`, **RA** `voids/raise.int.test.ts`, **AP** `voids/apply.int.test.ts`, **GU** `voids/guards.int.test.ts`, **QV** `voids/queries.int.test.ts`, **ID** `voids/identifier.int.test.ts`, **MO** `voids/money.int.test.ts`, **PP** `voids/money.property.int.test.ts`, **PE** `voids/permissions.int.test.ts`, **SP** `voids/spike.int.test.ts`, **WI** `voids/wiring.int.test.ts`, **AQ** `audit/queries.int.test.ts`, **AJ** `audit/projection.int.test.ts`, **AM** `db/audit-migration.int.test.ts`, **RT** `alerts/result-also-to.int.test.ts`, **CO** `orders/comp.int.test.ts`, **BU** `boot/boot-budget.int.test.ts`. Packages: **DA** `packages/domain/src/audit.test.ts`, **EN** `packages/engine/test/stock-effects.test.ts`, **OE** `packages/events/src/events/order/order-events.test.ts`, **SE** `packages/events/src/events/stock/stock-events.test.ts`. Cloud (`apps/cloud/test/`): **SD** `cli/seed-tenant.int.test.ts`, **BF** `db/void-defaults-backfill.int.test.ts`, **AO** `staff-roles/allowed-only.int.test.ts`, **DR** `default-roles.test.ts`. Client: **BD** `apps/client/src/features/admin/stock/BusinessDay.test.tsx`, **RE** `apps/client/src/features/owner/roles/RoleEditor.test.tsx`. `file:line` is the line of the `it(`.

### 1. Story ACs (spec §10 "Acceptance" and `docs/stories/04-g0.md` §4)

| Story / AC | Tests (green) | State |
|---|---|---|
| E6 lifecycle: stage 2 void with reason, to ready stock or wastage (story 1.1, 1.4, 1.5) | VI:64 `[04 #1]`, VI:178 `[04 #10]`, VI:200 / VI:215 `[04 #11]`, PL:353 `[04 #11b]`, VI:322 `[04 #15]` | green |
| E6 lifecycle: stage 3 move to stock, the next order takes it | VI:178 `[04 #10]`, PL:514 `[04 #10b plan half]`, EN:932–958 `[04 #10c]`–`[04 #10h]` | green |
| E6 lifecycle: served → void money / wastage (O20) | VI:91 `[04 #2]`, VI:115 `[04 #4, #4b]`, MO:366 `[04 #45]` | green |
| E6 lifecycle: "every transition logged" | DA:39–162 `[04 #50]`. Partial by owner Q14: Start / Done / Served stay events, not audit rows | green (partial by ruling) |
| Story 1.1: stage 1 → `ITEM_WRONG_STAGE`, billed → `ORDER_BILLED` | PL:141 `[04 #4]`, VI:151 `[04 #7]` | green |
| Story 1.2: partial by units; g / ml whole; `gml_deal_part_partial` | MO:84, MO:108 `[04 #41]`, MO:124, MO:144 `[04 #42]` | green |
| Story 1.3: money from 02b's ledger only (uncomped first, comped → `comp_voided_minor`, cascades with caps) | MO:45 `[04 #40]`, MO:326 `[04 #43]`, MO:338 `[04 #44]`, PP:309 `[04 #46]` | green |
| Story 1.6: online only, approvable, not queueable | VI:431 `[04 V15, §6.1]` | green |
| Story 1.7: a remade dish is voidable like a served line (O20) | VI:129 `[04 #5]`, MO:366 `[04 #45]` | green |
| D11 AC1: pending excluded from the total | GU:251 `[04 #35]`, GU:316 `[04 #36]`; #58 client: VU1; the bill itself is 05's | hub green; client not built (VU1) |
| D11 AC2: approvers alerted | RA:55 / RA:208 `[04 #20]` (routing to Manager and the requester's lead) | green; on-device delivery: Z2 |
| D11 AC3: table not closable while pending | GU:65 `[04 #33]`, GU:88 `[04 #34, #34b]`; 05 refuses bill close on `pendingVoids` (05) | green (split half: see MISSING) |
| D11 AC4: timeout override | — | not built (owner Q9, §12.6 G-1) |
| D11 AC5: approved → off the bill, reason logged | AP:165 `[04 #21]`, DA:125 `[04 #50]` | green |
| D11 AC6: rejected stays, requester and order taker told | AP:295, AP:315 `[04 #23]`, RT:223 `[01d #67] [04 #23 01d half]`; rejection reason not built (§12.6 G-4) | green; on-device: Z2 check 5 |
| Story 2.3: billed meanwhile → refused in `preRead` before any PIN | AP:239 `[04 #25]` | green |
| Story 2.5: withdraw = never asked | AP:331 `[04 #24]`, AP:360 `[04 §6.2] onWithdraw → []` | green |
| E6 audit AC1: append-only | AJ:184 `[04 #48]`, AJ:233 `[04 #55]`, AM:181 `[04 §5] 0018 adds no trigger` | green |
| E6 audit AC2: actions | DA:18 `[04 §3.6]`, DA:39 `[04 #50]`. Partial by owner Q14 (refund, discount, bill override, clock-in → 05; role changes → cloud `config_audit`) | green (partial by ruling) |
| E6 audit AC3: fields, name at read (story 3.2: approver, method, on the requester's device) | DA:99 `[04 #50] *_answered … on_requester_device`, AQ:213 `[04 #51, OQ-E]`, AM:60 `[04 #51b]` | green |
| E6 audit AC4: viewable + filters | AQ:121–268 `[04 #52]`; #60 client: VU2 | hub green; client not built (VU2) |
| E6 audit AC5: CSV | #60 client | not built (VU2) |
| Story 3.4: `view-audit-log` only | AQ:268 `[04 #52] no view-audit-log → 403` | green |
| E0 refunds AC4: cancel a whole order | VI:265, VI:280 `[04 #14]`, RA:148 `[04 #29]`; #59 client: VU1 | hub green; client not built (VU1) |
| E0 refunds AC5: permission + audit | PE:153–338 `[04 #32]`, DA:39 `[04 #50]` | green |
| R22: answered on the approver's own device | AP:165 `[04 #21]`, AP:226 `[04 #22]` | green; on-device: Z2 check 2 |
| K-7: permission-based | PE `[04 #32]` (20 tests), AO:47 / AO:64, SD:299, DR:92, BF:122 / BF:173, RE:124 | green (cloud in CI) |

### 2. §12.2 endpoint checklist

| Item | Permission | Statements | Errors | State |
|---|---|---|---|---|
| `VoidItems` | VI:431 (approvable, `void-item`); PE:153 403 | VI:436 `3 + 2 = 5`; VI:474 with a stale comp closed (AD-18); RA:244 `3 + raiseMany` for 1 and 3 entries | 400 VI:161, VI:322; 403 PE:153, VI:215; 404 VI:161; `ORDER_BILLED` VI:151; `ITEM_WRONG_STAGE` VI:115, VI:248; `VOID_PENDING` VI:399, RA:148; `COMP_PENDING` RA:186; `VOID_NOT_ALLOWED` VI:200 | green |
| `void_approval` apply / onWithdraw | PE:211–254 (ranges, self, `not_approver`) | AP:440 `[04 #31] apply = 1 + 1`; RT:264, RT:284 bound | AP:239, AP:255 | green |
| `GET /queries/void-preview` | QV:172 403 | QV:159 3 statements for 1 and 40 ids | QV:172 400 / 404 / 409 billed | green |
| `GET /queries/pending-voids` | QV:227 (any of three grants, else 403) | QV:202 1 statement each form | QV:227 400 | green |
| `GET /queries/audit-staff` | AQ:268 403 | AQ:307 1 statement | AQ:268 | green |
| `GET /queries/audit-log` | AQ:268 403 | AQ:121, AQ:165, AQ:182 1 statement | AQ:247 400s | green |
| merge guard / line guard | — | GU:105 merge 1, GU:224 every guard 1, WI:107 | `MERGE_BLOCKED_BY_VOID` GU:65; `VOID_PENDING` GU:122, CO:571, CO:639 | green |
| projection `audit` | — | AJ:206 `[04 #54]` own tables only | — | green |

### 3. §10 tests 0–60b

| # | Test (file:line, name) | State |
|---|---|---|
| 0 | SP:195 `[04 #0] 2 of 4 %s stock naan moved …`, SP:236 §6.8 deal variant, SP:311 risk row, SP:334 audit rows, SP:362 `[04 R-2]` | green |
| 1 | VI:64 `[04 #1] cooking line, wastage → refund, engine line ended` | green |
| 2 | VI:91 `[04 #2] served engine line → money only` | green |
| 3 | VI:103 `[04 #3] order out of the engine`; PL:232 `[04 #3 plan half]` | green |
| 4 | PL:141 `[04 #4]`; VI:115 `[04 #4, #4b]` | green |
| 4b | PL:147 `[04 #4b]`; VI:115 | green |
| 4c | PL:161 `[04 #4c] option child alone (i) / (ii)` | green |
| 4d | PL:184 `[04 #4d] item at added with its option child cooking` | green |
| 4e | PL:196 `[04 #4e] no-engine option child … staff_meal` | green |
| 4f | PL:202 `[04 #4f] served drink + its option child, wastage → both` | green |
| 4g | PL:261 `[04 #4g, Q-14]`; `orders/exports.int.test.ts:355` `[02b #51]` | green |
| 5 | VI:129 `[04 #5]`; PL:213 `[04 #5]` | green |
| 6 | VI:140 `[04 #6]`; PL:223 `[04 #6]` | green |
| 7 | VI:151 `[04 #7] billed order → 409 ORDER_BILLED` | green |
| 8 | VI:161 `[04 #8, #9]`; PL:468 foreign line | green |
| 9 | VI:161 `[04 #8, #9] repeated id → 400` | green |
| 10 | VI:178 `[04 #10] moved partial: 2 of 4 …` | green |
| 10b | PL:514 `[04 #10b plan half] … exactly one StockReserved` | green (plan level; no VoidItems-level test, see "Partial") |
| 10c | EN:932 `[04 #10c]`; SP:394 `[04 R-2 → u4, test 10c]` | green |
| 10d | EN:936 `[04 #10d]` | green (engine level only) |
| 10e | EN:942 `[04 #10e]` | green (engine level only) |
| 10f | EN:946 `[04 #10f] strict` | green (engine level only) |
| 10g | EN:952 `[04 #10g] strict, pure array` | green (pure test, as the spec asks) |
| 10h | EN:958 `[04 #10h] strict` | green (engine level only) |
| 11 | VI:200, VI:215 `[04 #11]`; PL:339 `[04 #11]` | green |
| 11b | PL:353 `[04 #11b] deal partly cooked, moved (OQ-C)` | green |
| 12 | VI:227 `[04 #12] a still-reserved line voided → StockReleased { voided }` | green |
| 13 | VI:248 `[04 #13]`; PL:322 `[04 #13]` | green |
| 14 | VI:265, VI:280 `[04 #14]`; PL:548 `[04 #14 plan half]` | green |
| 14b | VI:306 `[04 #14b]`; PL:419 `[04 #14b]` | green |
| 15 | VI:322 `[04 #15]` | green |
| 16 | VI:337 `[04 #16] retransmit (D32)` | green |
| 17 | VI:349 `[04 #17] COMMIT failure (D45)` | green |
| 18 | VI:366 `[04 #18] scope branch last (C8)` | green |
| 19 | VI:381 `[04 #19] direct void on a line with an open comp request` | green |
| 19b | VI:399 `[04 #19b]`; PL:478 `[04 #19b, #27 plan half]` | green |
| 20 | RA:55, RA:86, RA:111, RA:208 `[04 #20]` | green |
| 20b | RA:135 `[04 #20b]` | green |
| 20c | ID:44, ID:76 `[04 #20c]` | green |
| 20d | RA:298, RA:310, RA:323, RA:337 `[04 #20d]` | green |
| 21 | AP:165 `[04 #21] approve → applied: alert_id on every draft` | green |
| 22 | AP:226 `[04 #22] approve in_person` | green |
| 23 | AP:295, AP:315 `[04 #23]`; RT:223 | green |
| 24 | AP:331 `[04 #24] withdraw → [], lock lifted, re-ask with another disposition` | green |
| 24b | GU:194 `[04 #24b] 41 open → 40 listed, count 41 … → closes`; GU:173 `[04 A-1 end to end]`; client BD:353, BD:377, BD:419 | green |
| 25 | AP:239 `[04 #25] approve after billed → refused in preRead before any PIN` | green |
| 26 | removed in v0.8 | — |
| 26b | AP:255 `[04 #26b]`; GU:279, GU:302 `[04 #26b]`; PL:611 plan half; QV:202 blocked row | green |
| 26c | AP:272 `[04 #26c] … also on a partial portion`; PL:600 plan half | green |
| 27 | AP:72, AP:93, AP:114 `[04 #21/#27]`; PL:478 `[04 #19b, #27 plan half]`; CO:639 `[02b #43] applyComp` | green |
| 28 | RA:186 `[04 #28]`; PL:493 `[04 #28 plan half]` | green |
| 29 | RA:148 `[04 #29] three entries → three requests; one deduped → rollback` | green |
| 29b | RA:173, PL:452 `[04 #29b]` | green |
| 30 | AP:366 `[04 #30]`; PL:575 `[04 #30 plan half]` | green |
| 30b | AP:417 `[04 #30b]`; CO:877 `[02b #44] RemoveItems of line N2 leaves the stale comp open` | green |
| 30c | AP:426 `[04 #30c]` | green |
| 31 | AP:440 `[04 #31]`; RT:264, RT:284 `[01d #67] [04 #31]` | green |
| 32 | PE:153–338 `[04 #32]` (20 tests); cloud AO:47, AO:64, SD:299, DR:92, BF:122, BF:173; client RE:124, RE:135 | green (cloud in CI) |
| 33 | GU:65 `[04 #33] … after approve / reject / withdraw → allowed` | green |
| 34 | GU:88 `[04 #34, #34b] split: moving the order with a pending void → blocked` | green, **except the split half of "after approve / reject / withdraw → allowed" (MISSING)** |
| 34b | GU:88 `[04 #34, #34b] … moving another order of that seating → allowed` | green |
| 35 | GU:251 `[04 #35] 1 statement for 40 orders` | green |
| 36 | GU:316 `[04 #36] bill with a pending void of a comped unit` | green |
| 40 | MO:45 `[04 #40]` | green |
| 41 | MO:84, MO:108 `[04 #41]` | green |
| 42 | MO:124, MO:144, MO:167, MO:181, MO:211, MO:314 `[04 #42]` (MO:167–296 also `[02b #39]`) | green |
| 43 | MO:326, MO:350 `[04 #43]` | green |
| 44 | MO:338, MO:350 `[04 #44]` | green |
| 45 | MO:366 `[04 #45]` | green |
| 46 | PP:309 `[04 #46] property: 500 random sequences` | green |
| 47 | MO:390 `[04 #47]`; AP:149 `[04 #47]` | green |
| 48 | MO:496 `[04 §6.8]`, MO:507 `[04 #48]`; AJ:126, AJ:184 `[04 #48]` | green |
| 49 | MO:520, MO:539 `[04 #49]`; OE:502–532, SE:98 `[04 #49]`; `packages/engine/test/void-fields-fold.test.ts:59` | green |
| 50 | DA:39–162 `[04 #50]` (16 tests); `audit/fixtures-parse.int.test.ts:11` | green |
| 51 | AQ:213 `[04 #51, OQ-E]` | green |
| 51b | AM:60 `[04 #51b]` | green |
| 52 | AQ:121, AQ:137, AQ:165, AQ:182, AQ:226, AQ:247, AQ:268 `[04 #52]`; AQ:285 `[04 #52, H4-4, H4-6]` EXPLAIN in 5 shapes (single-branch wording: AD-15) | green |
| 53 | DA:186, DA:194, DA:200, DA:210 `[04 #53]`; AJ:115 `[04 #53, §6.6]` | green |
| 54 | AJ:206 `[04 #54]` | green |
| 55 | AJ:233 `[04 #55, H1-8]` | green |
| 55b | AJ:348 `[04 #55b]` (it.each, with and without a forced boot-time ClockAlarm), AJ:373 control | green |
| 55c | AJ:322 `[04 #55c, H8-1]`; BU:93 `[00 §10 #162; 04 §4.5 H-2]` | green |
| 56 | DA:74 `[04 #56] OrderContactSet is never mapped` | green |
| 57 | — | client (VU1) |
| 58 | — (hub half: GU:316 `[04 #36]`) | client (VU1) |
| 59 | — (hub half: VI:265 `[04 #14]`, RA:148 `[04 #29]`) | client (VU1) |
| 60 | — | client (VU2) |
| 60b | AQ:307 `[04 #60b, H6-3]` (server half) | server green; client (VU2) |

**MISSING** (a §10 sentence with no test):

1. **#34, split half of "after approve / reject / withdraw → allowed".** GU:88 checks only that the split is blocked and that another order may move. The lift after an answer is tested for merge only (GU:65 loops approve, reject, withdraw). Add a split loop to GU:88.

**Partial** (a test exists, but not at the level the plan row named):

- **10b, 10d, 10e, 10f, 10h:** the plan's v4 row lists "#1–#19b" for `VoidItems`, but VI has only #10. 10b is proved on `voidDrafts` (PL:514), 10d–10h on the pure `stockEffects` array in strict mode (EN). 10c also runs through a hub apply (SP:394). Every T-2 rule is covered. No end-to-end `VoidItems` call covers 10b or 10d–10h.
- **32, "the hub directory after the backfill lists Manager in `approver_role_ids`":** this is tested in two halves. BF:122 checks that the backfill writes the approver rows, and PE:320 checks that the hub directory built from `DEFAULT_ROLES` resolves them. No single test runs the backfill output into a hub directory.

### 4. §12.6 known gaps and §12.4 deferred items (not built)

| # | Gap | State |
|---|---|---|
| G-1 | Override of a stuck pending void (D11 AC4) | not built (Q9) |
| G-2 | The kitchen sees nothing while a void is pending | not built (Q8) |
| G-3 | Remote / cloud audit view | not built (06) |
| G-4 | Rejection reason | not built (01d has none) |
| G-5 | Owner-editable reasons | not built (Q4) |
| G-6 | The approver cannot change the disposition at approve | not built (OQ-D) |
| G-7 | Resell a served item | not built |
| G-8 | Wastage / staff-meal / moved reports | not built (05, 07, 08; `ItemVoided.disposition` is recorded) |
| Q-12 | No `approve-void` check on the B-1 / backfill approver | not built (accepted gap, AD-5) |
| Q-13 | A real "no kitchen" item | not built. The defensive rules are built and tested on a synthetic line (4b, 4e, 4f, 4g) |
| AD-14 | `auditActions()` list for registered actions | not built (AD-14 above) |
| Q-17 | Multi-language slips | not built. The slip prints English (p1); 03c §12.7 F-1 |
| §12.4 | Audit table retention; VOID? tag on KDS / Pass; editable reasons; approver-side disposition; rejection reasons; cloud audit view; resell; reports; override | not built (deferred) |

The accepted limits L-1 – L-9 are built as the rules describe; no task changes them.
